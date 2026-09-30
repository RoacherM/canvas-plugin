/**
 * Authenticated `/api/canvas/*` routes for the browser half. Registered through
 * `ctx.connection.fetch`, so every request passes DSH's cookie and origin checks first.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { isAbsolute, extname, resolve as resolvePath } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ArkError, ARK_KEY_REF, arkcliKey, DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, IMAGE_MODELS, IMAGE_SIZES, VIDEO_MODELS, VIDEO_RATIOS } from './ark.js';
import { summarize as summarizeAsset } from './library.js';
import { ASSET_DIR, CanvasError, MEDIA_TYPES, assertCanvasPath, assetRef, defaultCanvasPath, kindOfPath, safeName } from './store.js';

const MAX_IMPORT_BYTES = 512 * 1024 * 1024;
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

function failure(error) {
  if (error instanceof CanvasError) return json({ error: error.message }, error.status);
  if (error instanceof ArkError) return json({ error: error.message, code: error.code }, error.status === 401 ? 401 : 502);
  if (error?.code === 'ENOENT') return json({ error: '文件不存在' }, 404);
  if (error?.code === 'EACCES' || error?.code === 'EPERM') return json({ error: '没有权限访问该文件' }, 403);
  return json({ error: error?.message ?? String(error) }, 500);
}

const handle = (fn) => async (request) => {
  try { return await fn(request, new URL(request.url)); } catch (error) { return failure(error); }
};

async function body(request) {
  try { return await request.json(); } catch { throw new CanvasError('请求体不是有效的 JSON'); }
}

function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header ?? '');
  if (match === null) return undefined;
  let start = match[1] === '' ? undefined : Number(match[1]);
  let end = match[2] === '' ? undefined : Number(match[2]);
  if (start === undefined) { if (end === undefined) return undefined; start = Math.max(0, size - end); end = size - 1; }
  if (end === undefined || end >= size) end = size - 1;
  return start > end || start >= size ? null : { start, end };
}

/** Serve a local image or video with Range support (video seeking needs it). */
async function serveMedia(request, url) {
  const path = url.searchParams.get('path');
  if (path === null || !isAbsolute(path) || path.includes('\0')) throw new CanvasError('需要绝对路径');
  const type = MEDIA_TYPES[extname(path).toLowerCase()];
  if (type === undefined) throw new CanvasError('只提供图片和视频文件', 415);
  const info = await stat(path);
  if (!info.isFile()) throw new CanvasError('不是文件', 403);
  const headers = {
    'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'",
  };
  const range = parseRange(request.headers.get('range'), info.size);
  if (range === null) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${info.size}` } });
  const { start, end } = range ?? { start: 0, end: info.size - 1 };
  const length = info.size === 0 ? 0 : end - start + 1;
  const partial = range !== undefined;
  const responseHeaders = { ...headers, 'Content-Length': String(length), ...(partial ? { 'Content-Range': `bytes ${start}-${end}/${info.size}` } : {}) };
  if (request.method === 'HEAD' || length === 0) return new Response(null, { status: partial ? 206 : 200, headers: responseHeaders });
  const stream = createReadStream(path, { start, end });
  request.signal?.addEventListener('abort', () => stream.destroy(), { once: true });
  return new Response(Readable.toWeb(stream), { status: partial ? 206 : 200, headers: responseHeaders });
}

/** Stream an uploaded file into the canvas's asset folder. */
async function importAsset(request, url, now) {
  const canvasPath = assertCanvasPath(url.searchParams.get('path'));
  const name = url.searchParams.get('name') ?? 'file';
  const kind = kindOfPath(name);
  if (kind === undefined) throw new CanvasError('只能导入图片或视频（png/jpg/webp/gif/mp4/mov/webm…）', 415);
  if (request.body === null) throw new CanvasError('没有收到文件内容');
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_IMPORT_BYTES) throw new CanvasError('文件超过 512MB', 413);
  const dir = join(dirname(canvasPath), ASSET_DIR);
  await mkdir(dir, { recursive: true });
  const stem = safeName(name.replace(/\.[^.]+$/, '')).slice(0, 40) || 'asset';
  const file = join(dir, `${stem}-${now().toString(36)}${randomBytes(2).toString('hex')}${extname(name).toLowerCase()}`);
  const temp = file + '.part';
  let bytes = 0;
  const source = Readable.fromWeb(request.body);
  source.on('data', (chunk) => {
    bytes += chunk.length;
    if (bytes > MAX_IMPORT_BYTES) source.destroy(new CanvasError('文件超过 512MB', 413));
  });
  try {
    await pipeline(source, createWriteStream(temp));
    await rename(temp, file);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
  return { path: assetRef(canvasPath, file), absolute: file, kind, bytes };
}

/**
 * @param deps.focus - per-workspace memory of the canvas the user has open and its selection, read by the agent tools.
 */
export function registerRoutes(ctx, { store, generator, library, focus, credentials, context, now = () => Date.now() }) {
  const rootOf = (value) => dirname(assertCanvasPath(value));
  const routes = [
    ['GET', '/api/canvas/doc', async (request, url) => {
      const path = assertCanvasPath(url.searchParams.get('path'));
      const result = await store.read(path);
      generator.resume(path, result.doc).catch(() => {});
      return json(result);
    }],
    ['GET', '/api/canvas/version', async (request, url) => json({ version: await store.versionOf(assertCanvasPath(url.searchParams.get('path'))) })],
    ['POST', '/api/canvas/save', async (request) => {
      const input = await body(request);
      const path = assertCanvasPath(input.path);
      const result = await store.save(path, input.doc, input.baseVersion ?? null);
      return json({ version: result.version, merged: result.merged, ...(result.merged ? { doc: result.doc } : {}) });
    }],
    ['POST', '/api/canvas/import', async (request, url) => {
      const result = await importAsset(request, url, now);
      if (library === undefined) return json(result);
      // Every import is also a library asset, so it can be found and placed again from the library.
      const canvasRoot = dirname(assertCanvasPath(url.searchParams.get('path')));
      const size = result.kind === 'image' ? await library.sizeOf(result.absolute) : {};
      const name = (url.searchParams.get('name') ?? 'file').slice(0, 80);
      const made = await library.recordMedia(canvasRoot, { kind: result.kind, name, versions: [{ path: result.path, ...size, imported: name }] }).catch(() => undefined);
      return json({ ...result, ...size, ...(made ? { asset: made.id } : {}) });
    }],
    ['GET', '/api/canvas/library', async (request, url) => {
      const assets = library === undefined ? [] : await library.list(rootOf(url.searchParams.get('path')));
      return json({ assets: assets.map(summarizeAsset) });
    }],
    ['GET', '/api/canvas/library/asset', async (request, url) => {
      if (library === undefined) throw new CanvasError('素材库不可用', 503);
      return json(await library.detail(rootOf(url.searchParams.get('path')), url.searchParams.get('id') ?? ''));
    }],
    ['POST', '/api/canvas/library/update', async (request) => {
      if (library === undefined) throw new CanvasError('素材库不可用', 503);
      const input = await body(request);
      const root = rootOf(input.path);
      const id = String(input.id ?? '');
      switch (input.action) {
        case 'rename': return json({ asset: await library.update(root, id, { name: input.name }) });
        case 'tags': return json({ asset: await library.update(root, id, { tags: input.tags }) });
        case 'archive': return json({ asset: await library.update(root, id, { archived: input.archived !== false }) });
        case 'label': return json({ asset: await library.label(root, id, input.label, Number.isInteger(input.v) ? input.v : null) });
        case 'commit': {
          // A prompt version saved by hand, with an optional note.
          const current = await library.read(root, id);
          if (current?.kind !== 'prompt') throw new CanvasError('只能给提示词保存新版本');
          const text = String(input.text ?? '');
          if (text.trim() === '') throw new CanvasError('提示词不能为空');
          if (current.versions.at(-1).text === text && !input.note) return json({ asset: current });
          return json({ asset: await library.addVersions(root, id, [{ text, ...(input.note ? { note: String(input.note).slice(0, 200) } : {}) }]) });
        }
        case 'create': {
          const text = String(input.text ?? '');
          if (text.trim() === '') throw new CanvasError('提示词不能为空');
          return json({ asset: await library.create(root, 'prompt', { name: String(input.name ?? '').trim() || text.replace(/\s+/g, ' ').slice(0, 24), versions: [{ text }] }) });
        }
        default: throw new CanvasError('未知操作：' + input.action);
      }
    }],
    ['POST', '/api/canvas/library/link', async (request) => {
      if (library === undefined) throw new CanvasError('素材库不可用', 503);
      const input = await body(request);
      const canvasPath = assertCanvasPath(input.path);
      const asset = await library.createLink(dirname(canvasPath), input.url, async (name, data) => assetRef(canvasPath, await store.saveAsset(canvasPath, name, data)));
      return json({ asset });
    }],
    ['GET', '/api/canvas/history', async (request, url) => {
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') ?? 100) || 100));
      return json({ runs: library === undefined ? [] : await library.history(rootOf(url.searchParams.get('path')), limit) });
    }],
    ['GET', '/api/canvas/media', serveMedia],
    ['HEAD', '/api/canvas/media', serveMedia],
    ['POST', '/api/canvas/generate', async (request) => {
      const input = await body(request);
      const path = assertCanvasPath(input.path);
      if (typeof input.nodeId !== 'string') throw new CanvasError('缺少 nodeId');
      const run = generator.start(path, input.nodeId, input.mode === 'video' ? 'video' : 'image', input.patch ?? {});
      // Surface fast failures (no key, bad inputs) directly; long runs report through the canvas file.
      const early = await Promise.race([run.then(() => null, (error) => error), new Promise((resolve) => setTimeout(() => resolve(null), 1500))]);
      if (early instanceof Error) throw early;
      return json({ started: true }, 202);
    }],
    ['GET', '/api/canvas/list', async (request, url) => {
      const cwd = url.searchParams.get('cwd');
      if (cwd === null || !isAbsolute(cwd)) throw new CanvasError('需要工作区绝对路径');
      return json({ canvases: await store.list(cwd), defaultPath: defaultCanvasPath(cwd) });
    }],
    ['POST', '/api/canvas/focus', async (request) => {
      const input = await body(request);
      const path = assertCanvasPath(input.path);
      if (typeof input.cwd === 'string' && isAbsolute(input.cwd)) {
        focus.set(resolvePath(input.cwd), { path, selection: Array.isArray(input.selection) ? input.selection.filter((id) => typeof id === 'string').slice(0, 200) : [], at: now() });
      }
      return json({ ok: true });
    }],
    ['POST', '/api/canvas/attach', async (request) => {
      const input = await body(request);
      if (typeof input.sessionId !== 'string' || input.sessionId === '') throw new CanvasError('缺少 sessionId');
      const ids = Array.isArray(input.ids) ? input.ids.filter((id) => typeof id === 'string') : [];
      context.set(input.sessionId, ids.length > 0 ? assertCanvasPath(input.path) : undefined, ids);
      return json({ attached: context.get(input.sessionId)?.ids.length ?? 0 });
    }],
    ['GET', '/api/canvas/attach', async (request, url) => json({ attached: context.get(url.searchParams.get('sessionId') ?? '')?.ids.length ?? 0 })],
    ['GET', '/api/canvas/config', async () => {
      let info = credentials === undefined ? { configured: false, writable: false } : await credentials.describe(ARK_KEY_REF);
      if (info.configured !== true && process.env[ARK_KEY_REF]) info = { ...info, configured: true, source: 'env' };
      if (info.configured !== true && await arkcliKey()) info = { ...info, configured: true, source: '~/.arkcli/config.yaml' };
      return json({
        configured: info.configured === true, source: info.source ?? null, writable: info.writable !== false,
        imageModels: IMAGE_MODELS, videoModels: VIDEO_MODELS, imageRatios: ['auto', ...Object.keys(IMAGE_SIZES)], videoRatios: VIDEO_RATIOS,
        defaults: { imageModel: DEFAULT_IMAGE_MODEL, videoModel: DEFAULT_VIDEO_MODEL },
      });
    }],
    ['POST', '/api/canvas/config', async (request) => {
      if (credentials === undefined) throw new CanvasError('DSH 凭据服务不可用', 503);
      const input = await body(request);
      const key = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
      if (key === '') await credentials.unset(ARK_KEY_REF); else await credentials.set(ARK_KEY_REF, key);
      return json({ configured: key !== '' });
    }],
  ];

  // One registration per path with every method it serves (duplicate paths throw).
  const byPath = new Map();
  for (const [method, path, fn] of routes) {
    const entry = byPath.get(path) ?? { methods: [], handlers: new Map() };
    entry.methods.push(method);
    entry.handlers.set(method, handle(fn));
    byPath.set(path, entry);
  }
  for (const [path, entry] of byPath) {
    ctx.effect(() => ctx.connection.fetch.register({
      path, methods: entry.methods,
      requestBody: path === '/api/canvas/import' ? 'streaming' : 'buffered',
      fetch: (request) => entry.handlers.get(request.method)(request),
    }), 'dsh-canvas: ' + path);
  }
}
