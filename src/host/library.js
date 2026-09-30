/**
 * The workspace asset library, beside the canvases (`<canvas dir>/library/`, one JSON file per asset)
 * with a generation log (`<canvas dir>/history.jsonl`, one line per run).
 *
 * Every asset — prompt, image, video, link — keeps all of its versions. Versions are immutable and
 * numbered from 1; `labels` name versions (e.g. 定稿) and `latest` is always the newest. A generated
 * image or video version records its `source`: the prompt version (`p_xxx@3`), the reference versions,
 * model and parameters, so the outputs of each prompt version can be found again.
 * Media paths are relative to the canvas dir, exactly like the paths inside canvas files.
 */
import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { imageSize } from './media.js';
import { CANVAS_EXT, CanvasError } from './store.js';

export const LIBRARY_DIR = 'library';
export const HISTORY_FILE = 'history.jsonl';
export const ASSET_KINDS = ['prompt', 'image', 'video', 'link'];
const PREFIX = { prompt: 'p', image: 'i', video: 'v', link: 'l' };
const ID = /^[pivl]_[a-z0-9]{6,24}$/;
const LINK_PAGE_BYTES = 1024 * 1024;
const LINK_IMAGE_BYTES = 5 * 1024 * 1024;

export const refOf = (id, v) => `${id}@${v}`;
/** `p_abc@3` → { id, v }; anything else → undefined. */
export function parseRef(ref) {
  const match = /^([pivl]_[a-z0-9]+)@(\d+)$/.exec(String(ref ?? ''));
  return match ? { id: match[1], v: Number(match[2]) } : undefined;
}
export const latestOf = (asset) => asset.versions.at(-1);
export const versionOf = (asset, v) => asset.versions.find((version) => version.v === v);

const newAssetId = (kind) => PREFIX[kind] + '_' + Date.now().toString(36) + randomBytes(3).toString('hex');
const clean = (value) => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
const snippet = (text, n = 24) => { const s = String(text).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };

async function atomicWrite(path, data) {
  await mkdir(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${basename(path)}.${randomBytes(4).toString('hex')}.tmp`);
  await writeFile(temp, data);
  await rename(temp, path);
}

/** A readable asset or undefined; broken files are skipped, never fatal. */
function normalizeAsset(raw) {
  if (raw === null || typeof raw !== 'object' || !ID.test(raw.id) || !ASSET_KINDS.includes(raw.kind)) return undefined;
  const versions = (Array.isArray(raw.versions) ? raw.versions : []).filter((v) => v && Number.isInteger(v.v) && v.v > 0).sort((a, b) => a.v - b.v);
  if (versions.length === 0) return undefined;
  const labels = {};
  for (const [name, v] of Object.entries(raw.labels ?? {})) if (typeof name === 'string' && name !== 'latest' && versions.some((x) => x.v === v)) labels[name] = v;
  return {
    id: raw.id, kind: raw.kind, name: typeof raw.name === 'string' && raw.name ? raw.name : raw.id,
    createdAt: Number(raw.createdAt) || 0, updatedAt: Number(raw.updatedAt) || 0,
    labels, tags: Array.isArray(raw.tags) ? raw.tags.filter((t) => typeof t === 'string') : [],
    ...(raw.archived === true ? { archived: true } : {}),
    versions,
  };
}

/** Compact view for the library list. */
export function summarize(asset) {
  const latest = latestOf(asset);
  const preview = asset.kind === 'prompt' ? { text: String(latest.text ?? '').slice(0, 300) }
    : asset.kind === 'link' ? { url: latest.url, title: latest.title, site: latest.site, image: latest.image }
      : { path: latest.path, naturalWidth: latest.naturalWidth, naturalHeight: latest.naturalHeight, prompt: latest.source?.text?.slice(0, 200) };
  return { id: asset.id, kind: asset.kind, name: asset.name, labels: asset.labels, tags: asset.tags, archived: asset.archived === true,
    createdAt: asset.createdAt, updatedAt: asset.updatedAt, count: asset.versions.length, latest: { v: latest.v, at: latest.at, ...clean(preview) } };
}

/** Title, description, site and preview image of an HTML page (Open Graph first). */
export function pageMeta(html, url) {
  const attr = (tag, name) => new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag)?.slice(2).find((x) => x !== undefined);
  const metas = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attr(tag, 'property') ?? attr(tag, 'name') ?? '').toLowerCase();
    const content = attr(tag, 'content');
    if (key && content !== undefined && metas[key] === undefined) metas[key] = content;
  }
  const decode = (s) => (s === undefined ? undefined : s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim());
  const title = decode(metas['og:title'] ?? metas['twitter:title'] ?? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]);
  const description = decode(metas['og:description'] ?? metas.description ?? metas['twitter:description']);
  let image = metas['og:image'] ?? metas['og:image:url'] ?? metas['twitter:image'];
  try { image = image ? new URL(decode(image), url).href : undefined; } catch { image = undefined; }
  return clean({ title: title || undefined, description: description?.slice(0, 500) || undefined, site: decode(metas['og:site_name']) || new URL(url).hostname, image });
}

async function readLimited(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel().catch(() => {}); throw new CanvasError('内容过大'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export function createLibrary({ now = () => Date.now(), fetchImpl = (...args) => globalThis.fetch(...args) } = {}) {
  const queues = new Map();
  function exclusive(key, fn) {
    const previous = queues.get(key) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    const tail = run.catch(() => {});
    queues.set(key, tail);
    tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
    return run;
  }
  const dirOf = (root) => join(root, LIBRARY_DIR);
  const fileOf = (root, id) => {
    if (!ID.test(id)) throw new CanvasError('资产 id 不合法：' + id);
    return join(dirOf(root), id + '.json');
  };

  async function read(root, id) {
    try { return normalizeAsset(JSON.parse(await readFile(fileOf(root, id), 'utf8'))); } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return undefined;
      throw error;
    }
  }

  async function list(root) {
    let names;
    try { names = await readdir(dirOf(root)); } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    const assets = await Promise.all(names.filter((name) => name.endsWith('.json') && !name.startsWith('.')).map((name) => read(root, name.slice(0, -5)).catch(() => undefined)));
    return assets.filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Read-modify-write one asset under its own queue. `fn(asset | undefined)` returns the next asset. */
  function mutate(root, id, fn) {
    const file = fileOf(root, id);
    return exclusive(file, async () => {
      const next = await fn(await read(root, id));
      const asset = normalizeAsset(next);
      if (asset === undefined) throw new CanvasError('资产数据无效：' + id);
      await atomicWrite(file, JSON.stringify(asset, null, 1));
      return asset;
    });
  }

  async function create(root, kind, { name, versions, tags = [] }) {
    if (!ASSET_KINDS.includes(kind)) throw new CanvasError('未知的资产类型：' + kind);
    const at = now();
    const id = newAssetId(kind);
    return mutate(root, id, () => ({ id, kind, name, createdAt: at, updatedAt: at, labels: {}, tags,
      versions: versions.map((version, index) => clean({ ...version, v: index + 1, at })) }));
  }

  /** Append versions (their content only; numbers and times are assigned here). */
  function addVersions(root, id, added) {
    return mutate(root, id, (asset) => {
      if (asset === undefined) throw new CanvasError('找不到资产：' + id, 404);
      const at = now();
      let v = latestOf(asset).v;
      return { ...asset, updatedAt: at, versions: [...asset.versions, ...added.map((version) => clean({ ...version, v: ++v, at }))] };
    });
  }

  /**
   * The prompt version a generation uses, committing a new one when the text changed.
   * `bind` ({ id, v }) is the prompt the node is bound to. Unbound text reuses any prompt
   * version with identical text, else starts a new prompt asset.
   * @returns { id, v, text, name }
   */
  async function commitPrompt(root, { bind, text, name, model, params, note }) {
    const body = String(text ?? '');
    if (body.trim() === '') return undefined;
    const pick = (asset, version) => ({ id: asset.id, v: version.v, text: version.text, name: asset.name });
    const bound = bind?.id && ID.test(bind.id) ? await read(root, bind.id) : undefined;
    if (bound?.kind === 'prompt') {
      const same = [...bound.versions].reverse().find((version) => version.text === body);
      if (same) return pick(bound, same);
      const asset = await addVersions(root, bound.id, [clean({ text: body, model, params, note })]);
      return pick(asset, latestOf(asset));
    }
    for (const asset of await list(root)) {
      if (asset.kind !== 'prompt' || asset.archived) continue;
      const same = [...asset.versions].reverse().find((version) => version.text === body);
      if (same) return pick(asset, same);
    }
    const asset = await create(root, 'prompt', { name: name || snippet(body), versions: [clean({ text: body, model, params, note })] });
    return pick(asset, latestOf(asset));
  }

  /**
   * Record media files as versions of an image/video asset (a new asset when `id` is absent or gone).
   * @returns { id, vs } - the asset and the version numbers given to `versions`.
   */
  async function recordMedia(root, { kind, id, name, versions }) {
    const existing = id && ID.test(id) ? await read(root, id) : undefined;
    const asset = existing?.kind === kind
      ? await addVersions(root, existing.id, versions)
      : await create(root, kind, { name: name || kind, versions });
    return { id: asset.id, vs: asset.versions.slice(-versions.length).map((version) => version.v) };
  }

  /** `id@v` of the version showing `path`, or the path itself for media outside the library. */
  async function refOfMedia(root, node) {
    const path = node?.data?.path;
    if (typeof path !== 'string') return undefined;
    const asset = node.data.asset && ID.test(node.data.asset) ? await read(root, node.data.asset) : undefined;
    const version = asset?.versions.find((candidate) => candidate.path === path);
    return version ? refOf(asset.id, version.v) : path;
  }

  /** The asset with, for prompts, the outputs of each version, and the canvases that use it. */
  async function detail(root, id) {
    const asset = await read(root, id);
    if (asset === undefined) throw new CanvasError('找不到资产：' + id, 404);
    const outputs = {};
    if (asset.kind === 'prompt') {
      for (const other of await list(root)) {
        if (other.kind !== 'image' && other.kind !== 'video') continue;
        for (const version of other.versions) {
          const ref = parseRef(version.source?.prompt);
          if (ref?.id !== id) continue;
          (outputs[ref.v] ??= []).push({ id: other.id, v: version.v, kind: other.kind, name: other.name, path: version.path, at: version.at });
        }
      }
    }
    const usedBy = [];
    let names = [];
    try { names = await readdir(root); } catch { /* no canvases */ }
    for (const name of names.filter((n) => n.endsWith(CANVAS_EXT))) {
      try { if ((await readFile(join(root, name), 'utf8')).includes(`"${id}`)) usedBy.push(name.slice(0, -CANVAS_EXT.length)); } catch { /* unreadable */ }
    }
    return { asset, outputs, usedBy };
  }

  function label(root, id, name, v) {
    const key = String(name ?? '').trim().slice(0, 32);
    if (key === '' || key === 'latest') throw new CanvasError('标签名不能为空，也不能是 latest');
    return mutate(root, id, (asset) => {
      if (asset === undefined) throw new CanvasError('找不到资产：' + id, 404);
      const labels = { ...asset.labels };
      if (v === null || v === undefined) delete labels[key];
      else if (!versionOf(asset, v)) throw new CanvasError(`没有 v${v}`);
      else labels[key] = v;
      return { ...asset, labels, updatedAt: now() };
    });
  }

  function update(root, id, patch) {
    return mutate(root, id, (asset) => {
      if (asset === undefined) throw new CanvasError('找不到资产：' + id, 404);
      const next = { ...asset, updatedAt: now() };
      if (typeof patch.name === 'string' && patch.name.trim()) next.name = patch.name.trim().slice(0, 80);
      if (Array.isArray(patch.tags)) next.tags = patch.tags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim().slice(0, 32)).slice(0, 20);
      if (typeof patch.archived === 'boolean') next.archived = patch.archived;
      return next;
    });
  }

  /** A link asset: the page's title, description and preview image (downloaded next to the canvases). */
  async function createLink(root, rawUrl, saveImage) {
    let url;
    try { url = new URL(String(rawUrl).trim()); } catch { throw new CanvasError('不是有效的网址'); }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new CanvasError('只支持 http(s) 网址');
    let meta = { site: url.hostname };
    try {
      const response = await fetchImpl(url.href, { redirect: 'follow', signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Mozilla/5.0 (DSH Canvas link preview)', Accept: 'text/html,*/*' } });
      if (response.ok && /html/i.test(response.headers.get('content-type') ?? 'text/html')) {
        meta = pageMeta((await readLimited(response, LINK_PAGE_BYTES)).toString('utf8'), response.url || url.href);
      }
    } catch { /* keep the bare link */ }
    let image;
    if (meta.image && saveImage) {
      try {
        const response = await fetchImpl(meta.image, { signal: AbortSignal.timeout(8000) });
        const type = response.headers.get('content-type') ?? '';
        if (response.ok && /^image\/(png|jpe?g|webp|gif)/i.test(type)) {
          const ext = /png/.test(type) ? '.png' : /webp/.test(type) ? '.webp' : /gif/.test(type) ? '.gif' : '.jpg';
          image = await saveImage('link' + ext, await readLimited(response, LINK_IMAGE_BYTES));
        }
      } catch { /* no preview */ }
    }
    return create(root, 'link', { name: meta.title || url.hostname, versions: [clean({ url: url.href, title: meta.title, description: meta.description, site: meta.site, image, fetchedAt: now() })] });
  }

  async function appendHistory(root, entry) {
    await mkdir(root, { recursive: true });
    await exclusive(join(root, HISTORY_FILE), () => appendFile(join(root, HISTORY_FILE), JSON.stringify({ at: now(), ...clean(entry) }) + '\n'));
  }

  /** The newest `limit` runs, newest first. */
  async function history(root, limit = 100) {
    let raw;
    try { raw = await readFile(join(root, HISTORY_FILE), 'utf8'); } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    return raw.split('\n').filter(Boolean).slice(-limit).reverse().map((line) => { try { return JSON.parse(line); } catch { return undefined; } }).filter(Boolean);
  }

  /** Pixel size of an image file, for recording imports. */
  async function sizeOf(absolute) {
    if (!/\.(png|jpe?g|webp|gif|bmp)$/i.test(extname(absolute))) return {};
    try {
      const info = await stat(absolute);
      if (info.size > 64 * 1024 * 1024) return {};
      const size = imageSize(await readFile(absolute));
      return size ? { naturalWidth: size.width, naturalHeight: size.height } : {};
    } catch { return {}; }
  }

  return { read, list, detail, create, addVersions, commitPrompt, recordMedia, refOfMedia, label, update, createLink, appendHistory, history, sizeOf };
}
