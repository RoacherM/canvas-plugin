/**
 * Generation runs: a generator node on a canvas turns into result nodes beside it; an image or video
 * node generates in place, and its results become new versions of that node.
 * Images finish within one request; videos are Ark tasks polled until they settle, and a canvas
 * opened after a restart resumes polling its unfinished tasks.
 *
 * With a library, every run also commits the prompt version it used (binding the node to it), records
 * its outputs as image/video asset versions whose `source` names that prompt version and the reference
 * versions, and appends a line to history.jsonl.
 */
import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname } from 'node:path';
import { addEdge, addNodes, appendVersions, canGenerate, fitSize, genOf, generatorInputs, gridLayout, modeOf, newId, runOf, setRun, updateNode } from '../shared/doc.js';
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL } from './ark.js';
import { CanvasError, MEDIA_TYPES, assetPath, assetRef } from './store.js';

const MAX_REF_BYTES = 10 * 1024 * 1024;
const POLL_MS = 8000;
const VIDEO_BOX = { '16:9': [400, 225], '4:3': [400, 300], '1:1': [320, 320], '3:4': [300, 400], '9:16': [225, 400], '21:9': [420, 180] };

async function dataUri(path) {
  const type = MEDIA_TYPES[extname(path).toLowerCase()];
  if (type === undefined || !type.startsWith('image/')) throw new CanvasError(`不是可用作参考的图片：${path}`);
  const info = await stat(path).catch(() => undefined);
  if (info === undefined) throw new CanvasError(`参考图不存在：${path}`, 404);
  if (info.size > MAX_REF_BYTES) throw new CanvasError(`参考图超过 10MB：${path}`);
  return `data:${type};base64,${(await readFile(path)).toString('base64')}`;
}

/** Where a generator's next results go: to its right, below any earlier results. */
function resultOrigin(doc, generator) {
  const outputs = new Set(doc.edges.filter((edge) => edge.source === generator.id && edge.role === 'output').map((edge) => edge.target));
  const previous = doc.nodes.filter((node) => outputs.has(node.id));
  const x = generator.x + generator.w + 60;
  const y = previous.length === 0 ? generator.y : Math.max(...previous.map((node) => node.y + node.h)) + 40;
  return { x, y };
}

function placeResults(doc, generator, items, now) {
  const origin = resultOrigin(doc, generator);
  const positions = gridLayout(items.map((item) => item.box), { ...origin, columns: Math.min(items.length, 2), gap: 24 });
  const nodes = items.map((item, index) => ({
    id: newId(item.type === 'video' ? 'v' : 'i'), type: item.type, ...positions[index], ...item.box,
    ...(generator.parentId ? { parentId: generator.parentId } : {}),
    data: item.data,
  }));
  let next = addNodes(doc, nodes, now);
  for (const node of nodes) next = addEdge(next, generator.id, node.id, 'output', now);
  return { doc: next, ids: nodes.map((node) => node.id) };
}

/** A generator gets result nodes beside it; a media node gets the results as its new versions (of library asset `asset`). */
function deliver(doc, target, items, now, asset) {
  if (target.type === 'generator') return placeResults(doc, target, items, now);
  const next = appendVersions(doc, target.id, items.map((item) => item.data), now);
  return { doc: asset ? updateNode(next, target.id, { data: { asset } }, now) : next, ids: [target.id] };
}

const clean = (value) => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
const pickParams = (kind, d) => clean(kind === 'video'
  ? { ratio: d.ratio, duration: d.duration, resolution: d.resolution, generateAudio: d.generateAudio }
  : { ratio: d.ratio, count: d.count });

export function createGenerator({ store, getArk, library, now = () => Date.now(), timers = { set: setTimeout, clear: clearTimeout }, log = () => {} }) {
  const running = new Map();          // `${canvas}#${generator}` → { kind, timer?, abort }
  let disposed = false;
  const keyOf = (canvas, id) => canvas + '#' + id;

  /** Mark the generator running and collect its inputs; refuses a generator that is already running. */
  async function begin(canvasPath, generatorId, kind, patch = {}) {
    const key = keyOf(canvasPath, generatorId);
    let snapshot;
    try {
      await store.mutate(canvasPath, (doc) => {
        const generator = doc.nodes.find((node) => node.id === generatorId && canGenerate(node));
        if (generator === undefined) throw new CanvasError('找不到可生成的节点：' + generatorId, 404);
        if (generator.type !== 'generator' && modeOf(generator) !== kind) throw new CanvasError(`${generator.type === 'video' ? '视频' : '图片'}节点只能生成${generator.type === 'video' ? '视频' : '图片'}`);
        if (running.has(key)) throw new CanvasError('这个节点正在生成中', 409);
        // Claimed inside the canvas queue, so a second start of the same node cannot slip in.
        running.set(key, { kind });
        const inputs = generatorInputs(doc, generatorId);
        const params = { ...genOf(generator), ...patch };
        // An image node that already shows a picture edits it: the picture leads the references.
        if (generator.type === 'image' && typeof generator.data.path === 'string' && params.useSelf !== false) inputs.reference.unshift(generator);
        snapshot = { generator, params, inputs };
        const merged = generator.type === 'generator' ? { data: patch } : { data: { gen: params } };
        const next = Object.keys(patch).length > 0 ? updateNode(doc, generatorId, merged, now()) : doc;
        return setRun(next, generatorId, { status: 'running', error: null, startedAt: now(), finishedAt: null, taskId: null, taskStatus: null }, now());
      });
    } catch (error) {
      if (snapshot !== undefined) running.delete(key);
      throw error;
    }
    return snapshot;
  }

  const fail = (canvasPath, generatorId, error) => {
    history(canvasPath, { node: generatorId, status: 'error', error: error?.message ?? String(error) });
    return store.mutate(canvasPath, (doc) => (doc.nodes.some((node) => node.id === generatorId)
      ? setRun(doc, generatorId, { status: 'error', error: error?.message ?? String(error), finishedAt: now() }, now())
      : doc)).catch((writeError) => log('canvas: could not record failure', writeError));
  };

  const history = (canvasPath, entry) => {
    library?.appendHistory(dirname(canvasPath), { canvas: basename(canvasPath), ...entry }).catch((error) => log('canvas: could not write history', error));
  };

  /**
   * Library lineage of a run: commits the prompt version it uses and binds the node to it (the node keeps
   * its own clock, so a concurrent browser edit still wins; the binding merges on its own `at`), and
   * resolves the reference nodes to asset versions.
   */
  async function lineage(canvasPath, node, kind, d, inputs) {
    if (library === undefined) return undefined;
    const root = dirname(canvasPath);
    const model = d.model || (kind === 'video' ? DEFAULT_VIDEO_MODEL : DEFAULT_IMAGE_MODEL);
    const params = pickParams(kind, d);
    const prompt = await library.commitPrompt(root, { bind: d.bind, text: d.prompt, name: node.data.label, model, params });
    const refNodes = [inputs.first_frame, inputs.last_frame, ...inputs.reference].filter(Boolean);
    const refs = (await Promise.all(refNodes.map((ref) => library.refOfMedia(root, ref)))).filter(Boolean);
    if (prompt && (d.bind?.id !== prompt.id || d.bind?.v !== prompt.v)) {
      const bind = { id: prompt.id, v: prompt.v, text: prompt.text, name: prompt.name, at: now() };
      await store.mutate(canvasPath, (doc) => {
        const current = doc.nodes.find((candidate) => candidate.id === node.id);
        if (current === undefined) return doc;
        const patch = current.type === 'generator' ? { data: { bind } } : { data: { gen: { ...genOf(current), bind } } };
        return updateNode(doc, node.id, patch, current.updatedAt);
      });
    }
    return clean({ prompt: prompt ? `${prompt.id}@${prompt.v}` : undefined, promptName: prompt?.name, text: d.prompt || undefined, refs: refs.length ? refs : undefined, model, params });
  }

  /** Record results as library versions: one asset per result node of a generator, or new versions of a media node's asset. */
  async function record(canvasPath, target, kind, items, source) {
    if (library === undefined || items.length === 0) return { outputs: [] };
    const root = dirname(canvasPath);
    const { promptName, ...lineageOnly } = source ?? {};
    const versionOf = (item) => clean({
      path: item.data.path, naturalWidth: item.data.naturalWidth, naturalHeight: item.data.naturalHeight, duration: item.data.duration,
      lastFrame: item.data.lastFrame, ratio: item.data.ratio, resolution: item.data.resolution,
      source: clean({ ...lineageOnly, canvas: basename(canvasPath), node: target.id }),
    });
    const name = target.data.label || promptName || (kind === 'video' ? '视频' : '图片');
    try {
      if (target.type === 'generator') {
        const outputs = [];
        for (const item of items) {
          const made = await library.recordMedia(root, { kind, name, versions: [versionOf(item)] });
          item.data.asset = made.id;
          outputs.push(`${made.id}@${made.vs[0]}`);
        }
        return { outputs };
      }
      const made = await library.recordMedia(root, { kind, id: target.data.asset, name, versions: items.map(versionOf) });
      return { asset: made.id, outputs: made.vs.map((v) => `${made.id}@${v}`) };
    } catch (error) {
      log('canvas: could not record outputs in the library', error);
      return { outputs: [] };
    }
  }

  async function runImage(canvasPath, generatorId, patch = {}) {
    const key = keyOf(canvasPath, generatorId);
    const { generator, params: d, inputs } = await begin(canvasPath, generatorId, 'image', patch);
    const abort = new AbortController();
    running.set(key, { kind: 'image', abort });
    const startedAt = now();
    try {
      const source = await lineage(canvasPath, generator, 'image', d, inputs).catch((error) => { log('canvas: library lineage failed', error); return undefined; });
      const images = await Promise.all(inputs.reference.map((node) => dataUri(assetPath(canvasPath, node.data.path))));
      const ark = await getArk();
      const model = d.model || DEFAULT_IMAGE_MODEL;
      const result = await ark.generateImages({ model, prompt: d.prompt ?? '', images, ratio: d.ratio ?? 'auto', count: d.count ?? 1, watermark: d.watermark === true }, abort.signal);
      const items = [];
      for (const [index, image] of result.images.entries()) {
        const file = await store.saveAsset(canvasPath, `gen-${index + 1}.${image.format === 'png' ? 'png' : 'jpeg'}`, image.data);
        const [w, h] = String(image.size ?? '').split('x').map(Number);
        items.push({ type: 'image', box: fitSize(w, h, 300), data: {
          path: assetRef(canvasPath, file), naturalWidth: w || undefined, naturalHeight: h || undefined,
          meta: clean({ source: 'generated', prompt: d.prompt, promptRef: source?.prompt, model, ratio: d.ratio ?? 'auto', refs: inputs.reference.map((node) => node.id), generatorId, createdAt: now() }),
        } });
      }
      let ids = [];
      let outputs = [];
      await store.mutate(canvasPath, async (doc) => {
        const current = doc.nodes.find((node) => node.id === generatorId) ?? generator;
        const recorded = await record(canvasPath, current, 'image', items, source);
        outputs = recorded.outputs;
        const placed = deliver(doc, current, items, now(), recorded.asset);
        ids = placed.ids;
        return setRun(placed.doc, generatorId, { status: 'done', error: result.errors[0] ?? null, finishedAt: now(), source: source && clean({ prompt: source.prompt, refs: source.refs }) }, now());
      });
      history(canvasPath, clean({ node: generatorId, kind: 'image', status: 'done', prompt: source?.prompt, text: d.prompt || undefined, refs: source?.refs, model: source?.model, params: source?.params, outputs, ms: now() - startedAt, warning: result.errors[0] }));
      return { ids, files: items.map((item) => assetPath(canvasPath, item.data.path)), warnings: result.errors };
    } catch (error) {
      await fail(canvasPath, generatorId, error);
      throw error;
    } finally {
      running.delete(key);
    }
  }

  async function runVideo(canvasPath, generatorId, patch = {}) {
    const key = keyOf(canvasPath, generatorId);
    const { generator, params: d, inputs } = await begin(canvasPath, generatorId, 'video', patch);
    try {
      const source = await lineage(canvasPath, generator, 'video', d, inputs).catch((error) => { log('canvas: library lineage failed', error); return undefined; });
      const image = (node) => (node === undefined ? undefined : dataUri(assetPath(canvasPath, node.data.path)));
      const [firstFrame, lastFrame, references] = await Promise.all([
        image(inputs.first_frame), image(inputs.last_frame), Promise.all(inputs.reference.map((node) => image(node))),
      ]);
      const ark = await getArk();
      const taskId = await ark.createVideoTask({
        model: d.model || DEFAULT_VIDEO_MODEL, prompt: d.prompt ?? '', firstFrame, lastFrame, references,
        ratio: d.ratio ?? 'adaptive', duration: d.duration ?? 5, resolution: d.resolution ?? '720p',
        generateAudio: d.generateAudio !== false, watermark: d.watermark === true,
      });
      await store.mutate(canvasPath, (doc) => setRun(doc, generatorId, { taskId, taskStatus: 'queued', ...(source ? { source } : {}) }, now()));
      schedule(canvasPath, generatorId, taskId, 0);
      return { taskId };
    } catch (error) {
      running.delete(key);
      await fail(canvasPath, generatorId, error);
      throw error;
    }
  }

  function schedule(canvasPath, generatorId, taskId, delay = POLL_MS) {
    if (disposed) return;
    const key = keyOf(canvasPath, generatorId);
    const timer = timers.set(() => poll(canvasPath, generatorId, taskId).catch((error) => log('canvas: poll failed', error)), delay);
    running.set(key, { kind: 'video', timer, taskId });
  }

  async function poll(canvasPath, generatorId, taskId) {
    const key = keyOf(canvasPath, generatorId);
    if (disposed || running.get(key)?.taskId !== taskId) return;
    let task;
    try {
      task = await (await getArk()).getVideoTask(taskId);
    } catch (error) {
      // A network blip should not lose a paid task; keep polling unless the key is gone.
      if (error?.status === 401 || error?.status === 404) { running.delete(key); await fail(canvasPath, generatorId, error); return; }
      schedule(canvasPath, generatorId, taskId, POLL_MS * 2);
      return;
    }
    const status = task.status;
    if (status === 'queued' || status === 'running') {
      await store.mutate(canvasPath, (doc) => {
        const node = doc.nodes.find((candidate) => candidate.id === generatorId);
        return node === undefined || runOf(doc, generatorId).taskStatus === status ? doc : setRun(doc, generatorId, { taskStatus: status }, now());
      });
      schedule(canvasPath, generatorId, taskId);
      return;
    }
    running.delete(key);
    if (status !== 'succeeded') {
      await fail(canvasPath, generatorId, new Error(task.error?.message ? `视频生成失败：${task.error.message}` : `视频任务状态：${status}`));
      return;
    }
    try {
      const ark = await getArk();
      const video = await store.saveAsset(canvasPath, 'video.mp4', await ark.download(task.content.video_url));
      let lastFrame;
      if (typeof task.content?.last_frame_url === 'string') {
        lastFrame = await store.saveAsset(canvasPath, 'last-frame.png', await ark.download(task.content.last_frame_url)).catch(() => undefined);
      }
      let done;
      await store.mutate(canvasPath, async (doc) => {
        const generator = doc.nodes.find((node) => node.id === generatorId);
        if (generator === undefined) return doc;
        const [w, h] = VIDEO_BOX[task.ratio] ?? VIDEO_BOX['16:9'];
        const d = genOf(generator);
        const run = runOf(doc, generatorId);
        const source = run.source ? { ...run.source, model: task.model ?? run.source.model } : undefined;
        const items = [{ type: 'video', box: { w, h }, data: {
          path: assetRef(canvasPath, video), ...(lastFrame ? { lastFrame: assetRef(canvasPath, lastFrame) } : {}),
          duration: task.duration, ratio: task.ratio, resolution: task.resolution,
          meta: clean({ source: 'generated', prompt: source?.text ?? d.prompt, promptRef: source?.prompt, model: task.model ?? d.model, taskId, seed: task.seed, generatorId, createdAt: now() }),
        } }];
        const recorded = await record(canvasPath, generator, 'video', items, source);
        done = { source, outputs: recorded.outputs, ms: now() - (run.startedAt ?? now()) };
        const placed = deliver(doc, generator, items, now(), recorded.asset);
        return setRun(placed.doc, generatorId, { status: 'done', taskStatus: status, error: null, finishedAt: now(), source: source && clean({ prompt: source.prompt, refs: source.refs }) }, now());
      });
      if (done) history(canvasPath, clean({ node: generatorId, kind: 'video', status: 'done', prompt: done.source?.prompt, text: done.source?.text, refs: done.source?.refs, model: done.source?.model, params: done.source?.params, outputs: done.outputs, ms: done.ms, taskId }));
    } catch (error) {
      await fail(canvasPath, generatorId, error);
    }
  }

  return {
    runImage, runVideo,
    /** Start a generator from the browser; completion is observed through the canvas file. */
    start(canvasPath, generatorId, mode, patch) {
      const run = mode === 'video' ? runVideo(canvasPath, generatorId, patch) : runImage(canvasPath, generatorId, patch);
      run.catch((error) => log('canvas: generation failed', error));
      return run;
    },
    /** After a restart: resume unfinished video tasks and release image runs that died with the process. */
    async resume(canvasPath, doc) {
      const stale = [];
      for (const node of doc.nodes) {
        const run = runOf(doc, node.id);
        if (!canGenerate(node) || run.status !== 'running' || running.has(keyOf(canvasPath, node.id))) continue;
        if (modeOf(node) === 'video' && typeof run.taskId === 'string') schedule(canvasPath, node.id, run.taskId, 0);
        else stale.push(node.id);
      }
      if (stale.length > 0) {
        await store.mutate(canvasPath, (current) => stale.reduce((next, id) => setRun(next, id, { status: 'error', error: '生成被中断（应用重启或插件重载），请重新运行' }, now()), current));
      }
    },
    isRunning: (canvasPath, generatorId) => running.has(keyOf(canvasPath, generatorId)),
    dispose() {
      disposed = true;
      for (const job of running.values()) {
        if (job.timer !== undefined) timers.clear(job.timer);
        job.abort?.abort();
      }
      running.clear();
    },
  };
}
