/**
 * Canvas files on disk. Every write of one canvas runs through a per-path queue in this process,
 * so browser saves, agent tools, and finishing generations never interleave read-modify-write.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { emptyDoc, mergeDocs, normalizeDoc } from '../shared/doc.js';

export const CANVAS_EXT = '.dshcanvas';
export const CANVAS_DIR = 'canvas';
export const ASSET_DIR = 'assets';
export const MEDIA_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.m4v': 'video/mp4',
};
export const kindOfPath = (path) => {
  const type = MEDIA_TYPES[extname(path).toLowerCase()];
  return type === undefined ? undefined : type.startsWith('video/') ? 'video' : 'image';
};

export class CanvasError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'CanvasError'; this.status = status; }
}

/** A canvas path the routes may write: absolute and ending in .dshcanvas. */
export function assertCanvasPath(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) throw new CanvasError('画布路径必须是绝对路径');
  if (extname(path).toLowerCase() !== CANVAS_EXT) throw new CanvasError('画布文件必须以 .dshcanvas 结尾');
  return resolve(path);
}

/** Resolve an asset reference stored in a canvas (relative to the canvas file) to an absolute path. */
export const assetPath = (canvasPath, ref) => (isAbsolute(ref) ? ref : resolve(dirname(canvasPath), ref));
/** Store asset paths relative to the canvas when they live beside it, so the folder can move. */
export function assetRef(canvasPath, absolute) {
  const rel = relative(dirname(canvasPath), absolute);
  return rel.startsWith('..') || isAbsolute(rel) ? absolute : rel.split(sep).join('/');
}

export const defaultCanvasPath = (cwd, name = 'main') => join(cwd, CANVAS_DIR, safeName(name) + CANVAS_EXT);
export function safeName(name) {
  const cleaned = String(name).trim().replace(/\.dshcanvas$/i, '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').slice(0, 80);
  return cleaned === '' || cleaned === '.' || cleaned === '..' ? 'main' : cleaned;
}

async function versionOf(path) {
  try {
    const info = await stat(path);
    return `${Math.round(info.mtimeMs)}-${info.size}`;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function atomicWrite(path, data) {
  await mkdir(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${basename(path)}.${randomBytes(4).toString('hex')}.tmp`);
  await writeFile(temp, data);
  await rename(temp, path);
}

export function createStore({ now = () => Date.now() } = {}) {
  const queues = new Map();
  /** Run `fn` after every earlier task on the same path. */
  function exclusive(path, fn) {
    const previous = queues.get(path) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    const tail = run.catch(() => {});
    queues.set(path, tail);
    tail.then(() => { if (queues.get(path) === tail) queues.delete(path); });
    return run;
  }

  async function read(path) {
    let raw;
    try { raw = await readFile(path, 'utf8'); } catch (error) {
      if (error.code === 'ENOENT') return { doc: emptyDoc(now()), version: null };
      throw error;
    }
    let parsed;
    try { parsed = JSON.parse(raw); } catch { throw new CanvasError(`画布文件不是有效的 JSON：${path}`, 422); }
    return { doc: normalizeDoc(parsed, now()), version: await versionOf(path) };
  }

  async function write(path, doc) {
    await atomicWrite(path, JSON.stringify(doc, null, 1));
    return versionOf(path);
  }

  return {
    read, versionOf, exclusive,
    /** Read-modify-write under the path's queue. `fn` returns the new doc (or the same one to skip writing). */
    mutate(path, fn) {
      return exclusive(path, async () => {
        const { doc, version } = await read(path);
        const next = await fn(doc);
        if (next === doc && version !== null) return { doc, version, changed: false };
        return { doc: next, version: await write(path, { ...next, updatedAt: now() }), changed: true };
      });
    },
    /** Save the browser's copy; merges when someone else wrote since `baseVersion`. */
    save(path, incoming, baseVersion) {
      return exclusive(path, async () => {
        const current = await read(path);
        const doc = normalizeDoc(incoming, now());
        if (current.version === baseVersion || current.version === null) return { doc, version: await write(path, doc), merged: false };
        const merged = mergeDocs(current.doc, doc, now());
        return { doc: merged, version: await write(path, merged), merged: true };
      });
    },
    /** Write bytes into the canvas's asset folder under a fresh, collision-free name. */
    async saveAsset(canvasPath, name, data) {
      const dir = join(dirname(canvasPath), ASSET_DIR);
      const ext = extname(name).toLowerCase();
      const stem = safeName(basename(name, extname(name))).slice(0, 40) || 'asset';
      const file = join(dir, `${stem}-${now().toString(36)}${randomBytes(2).toString('hex')}${ext}`);
      await atomicWrite(file, data);
      return file;
    },
    /** Canvases in the workspace's canvas folder, newest first. */
    async list(cwd) {
      const dir = join(cwd, CANVAS_DIR);
      let entries;
      try { entries = await readdir(dir, { withFileTypes: true }); } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
      }
      const items = await Promise.all(entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(CANVAS_EXT))
        .map(async (entry) => {
          const path = join(dir, entry.name);
          const info = await stat(path);
          return { path, name: basename(entry.name, CANVAS_EXT), updatedAt: Math.round(info.mtimeMs), bytes: info.size };
        }));
      return items.sort((a, b) => b.updatedAt - a.updatedAt);
    },
  };
}
