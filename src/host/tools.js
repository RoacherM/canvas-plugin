/**
 * Model-callable canvas tools. They edit the same `.dshcanvas` file the user's tab shows,
 * so every change appears on the open canvas within a second or two.
 */
import { readFile, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, resolve } from 'node:path';
import { absolutePosition, addEdge, addNodes, canGenerate, fitSize, freeSpot, gridLayout, modeOf, newId, removeNodes, summarize, updateNode } from '../shared/doc.js';
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, IMAGE_MODELS, IMAGE_SIZES, VIDEO_MODELS, VIDEO_RATIOS } from './ark.js';
import { imageSize } from './media.js';
import { CANVAS_EXT, CanvasError, assetPath, assetRef, defaultCanvasPath, kindOfPath } from './store.js';

const MODEL_IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const num = (description) => ({ type: 'number', description });
const ids = (description) => ({ type: 'array', items: { type: 'string' }, description });
const CANVAS_ARG = str('Canvas file (.dshcanvas, relative to the workspace) or a canvas name. Default: the canvas the user has open, else canvas/main.dshcanvas.');

const IMAGE_BLOCK = {
  type: 'object', additionalProperties: false,
  properties: {
    attachmentId: { type: 'string' }, mediaType: { type: 'string' }, bytes: { type: 'number' },
    width: { type: 'number' }, height: { type: 'number' }, name: { type: 'string' }, nodeId: { type: 'string' },
  },
};
const RESULT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { canvas: { type: 'string' }, text: { type: 'string' }, images: { type: 'array', items: IMAGE_BLOCK } },
  required: ['canvas', 'text'],
};
const render = (_args, value) => [
  { type: 'text', text: value.text },
  ...(value.images ?? []).map(({ nodeId, ...image }) => ({ type: 'image', attachment: image })),
];

const defaultGen = (mode, prompt = '') => (mode === 'video'
  ? { prompt, model: DEFAULT_VIDEO_MODEL, ratio: 'adaptive', duration: 5, resolution: '720p', generateAudio: true }
  : { prompt, model: DEFAULT_IMAGE_MODEL, ratio: 'auto', count: 1 });

const scriptRows = (rows) => (Array.isArray(rows) ? rows : []).map((row) => ({
  id: newId('r'), description: typeof row?.description === 'string' ? row.description : '',
  prompt: typeof row?.prompt === 'string' ? row.prompt : '', duration: typeof row?.duration === 'number' ? row.duration : undefined,
}));

/** Reference / first-frame / last-frame edges named by an op. */
function connectInputs(doc, id, op, exists) {
  let next = doc;
  for (const source of op.references ?? []) next = addEdge(next, exists(source).id, id, 'reference');
  if (op.first_frame) next = addEdge(next, exists(op.first_frame).id, id, 'first_frame');
  if (op.last_frame) next = addEdge(next, exists(op.last_frame).id, id, 'last_frame');
  return next;
}

export function registerTools(ctx, { store, generator, focus, attachments }) {
  function cwdOf(exec) {
    const cwd = exec.agent?.session?.header?.cwd;
    if (typeof cwd !== 'string') throw new CanvasError('这个工具需要在有工作区的会话里使用');
    return cwd;
  }

  function canvasOf(exec, arg) {
    const cwd = cwdOf(exec);
    if (typeof arg === 'string' && arg.trim() !== '') {
      const value = arg.trim();
      return value.toLowerCase().endsWith(CANVAS_EXT) ? resolve(cwd, value) : defaultCanvasPath(cwd, value);
    }
    return focus.get(resolve(cwd))?.path ?? defaultCanvasPath(cwd);
  }

  /** A node id, or a workspace file path that becomes an image node on the canvas. */
  async function resolveInput(doc, canvasPath, cwd, value, place) {
    if (doc.nodes.some((node) => node.id === value)) return { doc, id: value };
    const absolute = isAbsolute(value) ? value : resolve(cwd, value);
    const node = await mediaNode(canvasPath, absolute, place);
    return { doc: addNodes(doc, [node]), id: node.id };
  }

  async function mediaNode(canvasPath, absolute, place, extra = {}) {
    const kind = kindOfPath(absolute);
    if (kind === undefined) throw new CanvasError(`不是图片或视频文件：${absolute}`);
    const info = await stat(absolute).catch(() => undefined);
    if (info === undefined || !info.isFile()) throw new CanvasError(`文件不存在：${absolute}`, 404);
    let box = kind === 'video' ? { w: 400, h: 225 } : { w: 300, h: 300 };
    let natural = {};
    if (kind === 'image') {
      const size = imageSize(await readFile(absolute));
      if (size) { box = fitSize(size.width, size.height, extra.w ?? 300); natural = { naturalWidth: size.width, naturalHeight: size.height }; }
    }
    return {
      id: newId(kind === 'video' ? 'v' : 'i'), type: kind, x: place.x, y: place.y, ...box,
      ...(extra.parent ? { parentId: extra.parent } : {}),
      data: { path: assetRef(canvasPath, absolute), label: extra.label ?? basename(absolute), ...natural, meta: { source: 'agent', createdAt: Date.now() } },
    };
  }

  /** Model-visible copies of up to `limit` image nodes. */
  async function imagesFor(canvasPath, doc, nodeIds, limit = 4) {
    if (attachments === undefined) return [];
    const blocks = [];
    for (const id of nodeIds) {
      if (blocks.length >= limit) break;
      const node = doc.nodes.find((candidate) => candidate.id === id);
      const path = node?.type === 'image' ? assetPath(canvasPath, node.data.path) : node?.type === 'video' && node.data.lastFrame ? assetPath(canvasPath, node.data.lastFrame) : undefined;
      const mediaType = path && MODEL_IMAGE_TYPES[extname(path).toLowerCase()];
      if (!mediaType) continue;
      try {
        const ref = await attachments.saveImage({ data: new Uint8Array(await readFile(path)), mediaType, name: basename(path) });
        blocks.push({ attachmentId: String(ref.attachmentId), mediaType: ref.mediaType, bytes: ref.bytes, width: ref.width, height: ref.height, name: basename(path), nodeId: id });
      } catch { /* an unreadable or oversized image is simply not shown */ }
    }
    return blocks;
  }

  const describeDoc = (canvasPath, doc, selection) => JSON.stringify({ canvas: canvasPath, ...summarize(doc, selection) });

  ctx.effect(() => ctx.tools.register({
    name: 'canvas_read',
    description: 'Read the canvas (the infinite board in the right sidebar): every node with id, type (image/video/text/generator/frame/script), position, size, asset path, prompt (gen_prompt: the prompt an image/video node generates itself from), version (shown/total results of a node), generation status, storyboard rows of script nodes, the edges between them, and which nodes the user has selected. Returns the selected images (or the ids you ask for) as images you can see. Call this before editing, and to check on running video generations.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        canvas: CANVAS_ARG,
        image_ids: ids('Node ids whose images to return. Default: the user\'s selected image/video nodes.'),
        max_images: { type: 'integer', description: 'Most images to return (default 4, max 8).' },
      },
    },
    output: { schema: RESULT_SCHEMA, render },
    async execute(args, exec) {
      const canvasPath = canvasOf(exec, args.canvas);
      const { doc, version } = await store.read(canvasPath);
      const remembered = focus.get(resolve(cwdOf(exec)));
      const selection = remembered?.path === canvasPath ? remembered.selection : [];
      const wanted = Array.isArray(args.image_ids) && args.image_ids.length > 0 ? args.image_ids : selection;
      const images = await imagesFor(canvasPath, doc, wanted, Math.min(8, Math.max(0, args.max_images ?? 4)));
      const text = version === null ? `画布 ${canvasPath} 还不存在（为空）。用 canvas_edit 或 canvas_generate_image 添加内容会自动创建它。` : describeDoc(canvasPath, doc, selection);
      return { canvas: canvasPath, text, images };
    },
  }), 'dsh-canvas: canvas_read');

  const OP = {
    type: 'object', additionalProperties: false,
    properties: {
      op: { type: 'string', enum: ['add_image', 'add_video', 'add_text', 'add_frame', 'add_script', 'add_generator', 'update', 'delete', 'connect', 'arrange', 'run'] },
      id: str('Target node id (update, run). Use "$N" to refer to the node created by op #N of this call.'),
      ids: ids('Target node ids (delete, arrange) or the children of a new frame (add_frame).'),
      path: str('Image or video file (add_image/add_video), absolute or relative to the workspace. Omit it and give a prompt to add an empty image/video node that generates itself.'),
      text: str('Note text (add_text/update).'),
      label: str('Display label.'),
      prompt: str('Prompt of a generator, or of an image/video node that generates itself (add_image/add_video/add_generator/update).'),
      rows: { type: 'array', description: 'Storyboard rows of a script node (add_script/update; update replaces all rows).', items: { type: 'object', additionalProperties: false, properties: { description: str('What happens in the shot.'), prompt: str('Image prompt for the shot.'), duration: num('Seconds.') } } },
      mode: { type: 'string', enum: ['image', 'video'], description: 'Generator mode (add_generator).' },
      references: ids('Reference image node ids for a generator or a generative image/video node.'),
      first_frame: str('First-frame image node id for a video generator or video node.'),
      last_frame: str('Last-frame image node id for a video generator or video node.'),
      source: str('connect: from node id.'), target: str('connect: to node id (a generator, or an image/video node).'),
      role: { type: 'string', enum: ['reference', 'first_frame', 'last_frame'] },
      layout: { type: 'string', enum: ['grid', 'row', 'column'] },
      columns: { type: 'integer' }, gap: num('Spacing in canvas units.'),
      x: num('X (canvas units; for children of a frame, relative to the frame).'), y: num('Y.'), w: num('Width.'), h: num('Height.'),
      parent: str('Frame node id to place the new node inside.'),
      color: str('Note or frame color, e.g. #ffd666.'),
    },
    required: ['op'],
  };

  ctx.effect(() => ctx.tools.register({
    name: 'canvas_edit',
    description: 'Edit the canvas with a list of operations applied in order: add images/videos from workspace files, or empty image/video nodes with a prompt that generate themselves (their results stack up as versions of the node); add text notes, frames (moodboards; pass ids to put existing nodes inside), script nodes (storyboard tables: rows with description, prompt, duration), and generator nodes; update, delete, connect references, arrange nodes into a grid/row/column, and run (start generating a node; images take ~10-60s, videos minutes; check with canvas_read). Positions are canvas units; omit x/y to place new nodes in free space. Returns the ids of created nodes.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { canvas: CANVAS_ARG, ops: { type: 'array', items: OP, description: 'Operations, applied in order.' } },
      required: ['ops'],
    },
    output: { schema: RESULT_SCHEMA, render },
    async execute(args, exec) {
      const cwd = cwdOf(exec);
      const canvasPath = canvasOf(exec, args.canvas);
      if (!Array.isArray(args.ops) || args.ops.length === 0) throw new CanvasError('ops 不能为空');
      const created = [];
      const toRun = [];
      const ref = (value) => (typeof value === 'string' && /^\$\d+$/.test(value) ? created[Number(value.slice(1))] ?? value : value);
      const { doc } = await store.mutate(canvasPath, async (start) => {
        let doc = start;
        for (const [index, op] of args.ops.entries()) {
          const need = (value, name) => { if (value === undefined || value === '') throw new CanvasError(`第 ${index} 个操作（${op.op}）缺少 ${name}`); return value; };
          const place = () => ({ x: op.x ?? freeSpot(doc).x, y: op.y ?? freeSpot(doc).y });
          const exists = (id) => { const node = doc.nodes.find((candidate) => candidate.id === id); if (!node) throw new CanvasError(`找不到节点 ${id}`, 404); return node; };
          let id;
          switch (op.op) {
            case 'add_image': case 'add_video': {
              const video = op.op === 'add_video';
              if (op.path) {
                const absolute = isAbsolute(op.path) ? op.path : resolve(cwd, op.path);
                const node = await mediaNode(canvasPath, absolute, place(), { label: op.label, parent: ref(op.parent), w: op.w });
                doc = addNodes(doc, [node]); id = node.id;
              } else {
                id = newId(video ? 'v' : 'i');
                doc = addNodes(doc, [{ id, type: video ? 'video' : 'image', ...place(), w: op.w ?? (video ? 400 : 320), h: op.h ?? (video ? 225 : 320),
                  ...(op.parent ? { parentId: ref(op.parent) } : {}), data: { label: op.label, gen: defaultGen(video ? 'video' : 'image', op.prompt) } }]);
              }
              doc = connectInputs(doc, id, op, (value) => exists(ref(value)));
              break;
            }
            case 'add_script': {
              id = newId('s');
              doc = addNodes(doc, [{ id, type: 'script', ...place(), w: op.w ?? 760, h: op.h ?? 380, ...(op.parent ? { parentId: ref(op.parent) } : {}),
                data: { title: op.label ?? '分镜脚本', rows: scriptRows(op.rows) } }]);
              break;
            }
            case 'add_text': {
              id = newId('t');
              doc = addNodes(doc, [{ id, type: 'text', ...place(), w: op.w ?? 240, h: op.h ?? 120, ...(op.parent ? { parentId: ref(op.parent) } : {}), data: { text: op.text ?? '', color: op.color } }]);
              break;
            }
            case 'add_frame': {
              id = newId('f');
              const children = (op.ids ?? []).map(ref).map(exists);
              let frame = { ...place(), w: op.w ?? 800, h: op.h ?? 520 };
              if (children.length > 0 && op.x === undefined) {
                const abs = children.map((child) => ({ ...absolutePosition(doc, child), w: child.w, h: child.h }));
                const minX = Math.min(...abs.map((a) => a.x)) - 40, minY = Math.min(...abs.map((a) => a.y)) - 60;
                frame = { x: minX, y: minY, w: Math.max(...abs.map((a) => a.x + a.w)) - minX + 40, h: Math.max(...abs.map((a) => a.y + a.h)) - minY + 40 };
              }
              doc = addNodes(doc, [{ id, type: 'frame', ...frame, data: { label: op.label ?? '分组', color: op.color } }]);
              for (const child of children) {
                const abs = absolutePosition(doc, child);
                doc = updateNode(doc, child.id, { parentId: id, x: abs.x - frame.x, y: abs.y - frame.y });
              }
              break;
            }
            case 'add_generator': {
              id = newId('g');
              const mode = op.mode === 'video' ? 'video' : 'image';
              doc = addNodes(doc, [{ id, type: 'generator', ...place(), w: 340, h: 300, ...(op.parent ? { parentId: ref(op.parent) } : {}),
                data: { mode, prompt: op.prompt ?? '', model: mode === 'video' ? DEFAULT_VIDEO_MODEL : DEFAULT_IMAGE_MODEL, label: op.label } }]);
              doc = connectInputs(doc, id, op, (value) => exists(ref(value)));
              break;
            }
            case 'update': {
              const node = exists(ref(need(op.id, 'id')));
              const patch = {};
              for (const key of ['x', 'y', 'w', 'h']) if (op[key] !== undefined) patch[key] = op[key];
              const data = {};
              if (op.label !== undefined) data.label = op.label;
              if (op.text !== undefined) data.text = op.text;
              if (op.prompt !== undefined) {
                if (node.type === 'image' || node.type === 'video') data.gen = { ...defaultGen(node.type), ...node.data.gen, prompt: op.prompt };
                else data.prompt = op.prompt;
              }
              if (op.rows !== undefined && node.type === 'script') data.rows = scriptRows(op.rows);
              if (op.color !== undefined) data.color = op.color;
              if (op.parent !== undefined) patch.parentId = ref(op.parent) || undefined;
              doc = updateNode(doc, node.id, { ...patch, data });
              id = node.id; break;
            }
            case 'delete': doc = removeNodes(doc, need(op.ids, 'ids').map(ref)); break;
            case 'connect': {
              const source = exists(ref(need(op.source, 'source'))).id, target = exists(ref(need(op.target, 'target')));
              if (!canGenerate(target)) throw new CanvasError('连线的目标必须是生成节点或图片/视频节点');
              doc = addEdge(doc, source, target.id, op.role ?? 'reference'); break;
            }
            case 'run': {
              const node = exists(ref(need(op.id, 'id')));
              if (!canGenerate(node)) throw new CanvasError(`节点 ${node.id} 不能生成（需要生成节点或图片/视频节点）`);
              toRun.push(node);
              id = node.id; break;
            }
            case 'arrange': {
              const nodes = need(op.ids, 'ids').map(ref).map(exists);
              const layout = op.layout ?? 'grid';
              const columns = layout === 'row' ? nodes.length : layout === 'column' ? 1 : op.columns;
              const origin = { x: op.x ?? nodes[0].x, y: op.y ?? nodes[0].y };
              gridLayout(nodes, { ...origin, columns, gap: op.gap ?? 24 }).forEach((position, i) => { doc = updateNode(doc, nodes[i].id, position); });
              break;
            }
            default: throw new CanvasError(`未知操作：${op.op}`);
          }
          created.push(id);
        }
        return doc;
      });
      const made = created.map((id, index) => (id ? `#${index} ${args.ops[index].op} → ${id}` : `#${index} ${args.ops[index].op} ✓`)).join('\n');
      // Started after the edit is on disk; completion shows up on the canvas (canvas_read reports status).
      const started = [];
      for (const node of toRun) {
        try { generator.start(canvasPath, node.id, modeOf(node)); started.push(node.id); }
        catch (error) { started.push(`${node.id}（启动失败：${error.message}）`); }
      }
      const runs = started.length ? `\n已开始生成：${started.join('、')}。用 canvas_read 查看 status。` : '';
      return { canvas: canvasPath, text: `已更新画布 ${canvasPath}（共 ${doc.nodes.length} 个节点）\n${made}${runs}` };
    },
  }), 'dsh-canvas: canvas_edit');

  async function prepareGenerator(exec, args, mode) {
    const cwd = cwdOf(exec);
    const canvasPath = canvasOf(exec, args.canvas);
    let generatorId;
    await store.mutate(canvasPath, async (start) => {
      let doc = start;
      const anchor = args.near ? doc.nodes.find((node) => node.id === args.near) : undefined;
      const spot = anchor ? { x: anchor.x + anchor.w + 80, y: anchor.y } : freeSpot(doc);
      const inputs = [];
      for (const [role, values] of [['reference', args.references ?? []], ['first_frame', args.first_frame ? [args.first_frame] : []], ['last_frame', args.last_frame ? [args.last_frame] : []]]) {
        for (const value of values) {
          const resolved = await resolveInput(doc, canvasPath, cwd, value, { x: spot.x - 380, y: spot.y + inputs.length * 340 });
          doc = resolved.doc;
          inputs.push([resolved.id, role]);
        }
      }
      generatorId = newId('g');
      const data = mode === 'video'
        ? { mode, prompt: args.prompt ?? '', model: args.model || DEFAULT_VIDEO_MODEL, ratio: args.ratio ?? 'adaptive', duration: args.duration ?? 5, resolution: args.resolution ?? '720p', generateAudio: args.generate_audio !== false, label: 'Agent' }
        : { mode, prompt: args.prompt, model: args.model || DEFAULT_IMAGE_MODEL, ratio: args.ratio ?? 'auto', count: args.count ?? 1, label: 'Agent' };
      doc = addNodes(doc, [{ id: generatorId, type: 'generator', x: args.x ?? spot.x, y: args.y ?? spot.y, w: 340, h: 300, data }]);
      for (const [source, role] of inputs) doc = addEdge(doc, source, generatorId, role);
      return doc;
    });
    return { canvasPath, generatorId };
  }

  ctx.effect(() => ctx.tools.register({
    name: 'canvas_generate_image',
    description: `Generate images with Volcengine Seedream and place them on the canvas next to a new generator node (the prompt, model, and references are recorded for later iterations). References may be canvas node ids or workspace image paths (they are added to the canvas). Returns the new image node ids and shows you the images. Models: ${IMAGE_MODELS.map((model) => model.id + ' (' + model.label + ')').join(', ')}.`,
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        canvas: CANVAS_ARG,
        prompt: str('What to generate. Chinese or English. Describe subject, style, composition, lighting; for edits, say what to change in the reference.'),
        references: ids('Reference images: node ids or image paths (up to 14; 10 for 5.0 pro/flash).'),
        count: { type: 'integer', description: 'How many images (1-15, default 1). Seedream 5.0 / 4.5 make a coherent set in one call.' },
        ratio: { type: 'string', enum: ['auto', ...Object.keys(IMAGE_SIZES)], description: 'Aspect ratio at 2K; auto lets the model decide from the prompt.' },
        model: str(`Model id, default ${DEFAULT_IMAGE_MODEL}.`),
        near: str('Place the generator next to this node id.'),
        x: num('Generator X.'), y: num('Generator Y.'),
      },
      required: ['prompt'],
    },
    output: { schema: RESULT_SCHEMA, render },
    timeoutMs: 10 * 60 * 1000,
    async execute(args, exec) {
      const { canvasPath, generatorId } = await prepareGenerator(exec, args, 'image');
      const result = await generator.runImage(canvasPath, generatorId);
      const { doc } = await store.read(canvasPath);
      const images = await imagesFor(canvasPath, doc, result.ids, 4);
      const lines = result.ids.map((id, index) => `${id}: ${result.files[index]}`).join('\n');
      return { canvas: canvasPath, images, text: `已生成 ${result.ids.length} 张图片（生成节点 ${generatorId}）：\n${lines}${result.warnings.length ? '\n部分失败：' + result.warnings.join('；') : ''}` };
    },
  }), 'dsh-canvas: canvas_generate_image');

  ctx.effect(() => ctx.tools.register({
    name: 'canvas_generate_video',
    description: `Start a Volcengine Seedance video generation on the canvas. Modes: text-to-video (prompt only), first frame (first_frame), first+last frame (both), or reference images (references; not combinable with frames). Inputs may be node ids or image paths. Video takes about 1-5 minutes: this returns immediately with the generator id; the video appears on the canvas when done — check with canvas_read (generator status). Models: ${VIDEO_MODELS.map((model) => model.id + ' (' + model.label + ', ' + model.durations.join('-') + 's)').join(', ')}.`,
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        canvas: CANVAS_ARG,
        prompt: str('Describe motion, camera, and sound. Chinese or English, under 500 characters.'),
        first_frame: str('First frame: node id or image path.'),
        last_frame: str('Last frame (needs first_frame): node id or image path.'),
        references: ids('Reference images (node ids or paths) for reference-to-video.'),
        duration: { type: 'integer', description: 'Seconds (Seedance 2.x: 4-15; 2.5: 4-30). Default 5.' },
        ratio: { type: 'string', enum: VIDEO_RATIOS, description: 'Aspect ratio; adaptive follows the first frame.' },
        resolution: { type: 'string', enum: ['480p', '720p', '1080p', '4k'] },
        generate_audio: { type: 'boolean', description: 'Seedance 2.x: generate synchronized sound (default true).' },
        model: str(`Model id, default ${DEFAULT_VIDEO_MODEL}.`),
        near: str('Place the generator next to this node id.'),
      },
    },
    output: { schema: RESULT_SCHEMA, render },
    async execute(args, exec) {
      if (!args.prompt && !args.first_frame && !(args.references ?? []).length) throw new CanvasError('需要提示词、首帧或参考图中的至少一项');
      const { canvasPath, generatorId } = await prepareGenerator(exec, args, 'video');
      const { taskId } = await generator.runVideo(canvasPath, generatorId);
      return { canvas: canvasPath, text: `视频生成已开始（生成节点 ${generatorId}，任务 ${taskId}），通常需要 1-5 分钟，完成后视频会出现在画布上。可稍后用 canvas_read 查看该节点的 status。` };
    },
  }), 'dsh-canvas: canvas_generate_video');
}

