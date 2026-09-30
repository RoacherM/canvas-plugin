/**
 * The canvas document: plain JSON shared by the Host routes, the agent tools, and the browser.
 *
 * Every node and edge carries `updatedAt`; deletions leave a tombstone in `removed`. Two copies
 * written concurrently (the user's tab and an agent tool) merge per item: the newer write wins and
 * a tombstone newer than an item deletes it.
 */

export const DOC_VERSION = 1;
export const NODE_TYPES = ['image', 'video', 'text', 'generator', 'frame', 'script', 'link'];
/** `shot` links a storyboard row of a script node to the image made for it. */
export const EDGE_ROLES = ['reference', 'first_frame', 'last_frame', 'output', 'shot'];
/**
 * Production asset categories (LibTV style): what a piece of media is *for* in a production, as opposed
 * to its media kind. Optional everywhere; documents and library assets without one stay valid.
 */
export const ASSET_CATEGORIES = ['character', 'scene', 'prop', 'style', 'audio'];
/** A known category, or undefined for anything else (absent, unknown, wrong type). */
export const categoryOf = (value) => (typeof value === 'string' && ASSET_CATEGORIES.includes(value) ? value : undefined);
/** Whether an asset (or node data) with `category` passes a filter: `all`, `none` (uncategorised) or one category. */
export function matchesCategory(item, filter = 'all') {
  if (filter === 'all') return true;
  const category = categoryOf(item?.category);
  return filter === 'none' ? category === undefined : category === filter;
}
const TOMBSTONE_TTL = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_SIZE = {
  image: { w: 320, h: 320 }, video: { w: 400, h: 225 }, text: { w: 240, h: 120 },
  generator: { w: 340, h: 300 }, frame: { w: 800, h: 520 }, script: { w: 760, h: 380 }, link: { w: 300, h: 250 },
};

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const text = (value, fallback = '') => (typeof value === 'string' ? value : fallback);

let counter = 0;
/** Short sortable id: time plus a per-process counter plus randomness. */
export function newId(prefix = 'n') {
  counter = (counter + 1) % 1296;
  return prefix + Date.now().toString(36) + counter.toString(36).padStart(2, '0') + Math.random().toString(36).slice(2, 6);
}

export function emptyDoc(now = Date.now()) {
  return { version: DOC_VERSION, createdAt: now, updatedAt: now, viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [], runs: {}, removed: {} };
}

/**
 * Generation state lives apart from node content in `runs[generatorId]` ({ status, error, taskId,
 * taskStatus, startedAt, finishedAt, updatedAt }). The Host owns it; the browser only edits content,
 * so a prompt edit can never overwrite a status the Host wrote.
 */
/** `source` is the library lineage of the run (prompt version, reference versions), recorded with its outputs. */
export const RUN_FIELDS = ['status', 'error', 'taskId', 'taskStatus', 'startedAt', 'finishedAt', 'source'];
export const runOf = (doc, id) => doc.runs?.[id] ?? { status: 'idle' };
export function setRun(doc, id, patch, now = Date.now()) {
  return { ...doc, updatedAt: now, runs: { ...doc.runs, [id]: { ...runOf(doc, id), ...patch, updatedAt: now } } };
}

function normalizeNode(raw, now) {
  if (!isRecord(raw) || typeof raw.id !== 'string' || raw.id === '' || !NODE_TYPES.includes(raw.type)) return null;
  const size = DEFAULT_SIZE[raw.type];
  const node = {
    id: raw.id, type: raw.type,
    x: finite(raw.x, 0), y: finite(raw.y, 0),
    w: Math.max(40, finite(raw.w, size.w)), h: Math.max(30, finite(raw.h, size.h)),
    data: isRecord(raw.data) ? { ...raw.data } : {},
    updatedAt: finite(raw.updatedAt, now),
  };
  if (typeof raw.parentId === 'string' && raw.parentId !== '') node.parentId = raw.parentId;
  if (node.data.category !== undefined && categoryOf(node.data.category) === undefined) delete node.data.category;
  return node.type === 'image' || node.type === 'video' ? mirrorShown(node) : node;
}

function normalizeEdge(raw, now) {
  if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.source !== 'string' || typeof raw.target !== 'string') return null;
  return { id: raw.id, source: raw.source, target: raw.target, role: EDGE_ROLES.includes(raw.role) ? raw.role : 'reference', updatedAt: finite(raw.updatedAt, now) };
}

/** Repair anything readable into a valid document; unknown or broken items are dropped, not fatal. */
export function normalizeDoc(raw, now = Date.now()) {
  const base = isRecord(raw) ? raw : {};
  const doc = emptyDoc(finite(base.createdAt, now));
  doc.updatedAt = finite(base.updatedAt, now);
  if (isRecord(base.viewport)) doc.viewport = { x: finite(base.viewport.x, 0), y: finite(base.viewport.y, 0), zoom: finite(base.viewport.zoom, 1) };
  const seen = new Set();
  for (const item of Array.isArray(base.nodes) ? base.nodes : []) {
    const node = normalizeNode(item, now);
    if (node !== null && !seen.has(node.id)) { seen.add(node.id); doc.nodes.push(node); }
  }
  for (const node of doc.nodes) if (node.parentId !== undefined && !seen.has(node.parentId)) delete node.parentId;
  const edgeIds = new Set();
  for (const item of Array.isArray(base.edges) ? base.edges : []) {
    const edge = normalizeEdge(item, now);
    if (edge !== null && !edgeIds.has(edge.id) && seen.has(edge.source) && seen.has(edge.target)) { edgeIds.add(edge.id); doc.edges.push(edge); }
  }
  if (isRecord(base.runs)) {
    for (const [id, run] of Object.entries(base.runs)) {
      if (!seen.has(id) || !isRecord(run)) continue;
      const clean = { updatedAt: finite(run.updatedAt, 0) };
      for (const key of RUN_FIELDS) if (run[key] !== undefined) clean[key] = run[key];
      doc.runs[id] = clean;
    }
  }
  if (isRecord(base.removed)) {
    for (const [id, at] of Object.entries(base.removed)) if (typeof at === 'number' && now - at < TOMBSTONE_TTL) doc.removed[id] = at;
  }
  return sortParentsFirst(doc);
}

/** React Flow requires a parent to precede its children. */
function sortParentsFirst(doc) {
  const byId = new Map(doc.nodes.map((node) => [node.id, node]));
  const depth = (node, guard = 0) => (node.parentId === undefined || guard > 32 ? 0 : 1 + depth(byId.get(node.parentId) ?? {}, guard + 1));
  doc.nodes = doc.nodes.map((node, index) => ({ node, index, d: depth(node) }))
    .sort((a, b) => a.d - b.d || a.index - b.index).map((entry) => entry.node);
  return doc;
}

function mergeItems(left, right, removed, combine = (_older, newer) => newer) {
  const byId = new Map();
  for (const item of [...left, ...right]) {
    const current = byId.get(item.id);
    if (current === undefined) byId.set(item.id, item);
    else byId.set(item.id, item.updatedAt > current.updatedAt ? combine(current, item) : combine(item, current));
  }
  const order = [];
  const seen = new Set();
  for (const item of [...left, ...right]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const winner = byId.get(item.id);
    const tomb = removed[item.id];
    if (tomb === undefined || tomb < winner.updatedAt) order.push(winner);
  }
  return order;
}

/** Merge two versions of one canvas; neither side's newer work is lost. `incoming` supplies the viewport. */
export function mergeDocs(current, incoming, now = Date.now()) {
  const removed = { ...current.removed };
  for (const [id, at] of Object.entries(incoming.removed)) if (removed[id] === undefined || at > removed[id]) removed[id] = at;
  const runs = { ...current.runs };
  for (const [id, run] of Object.entries(incoming.runs ?? {})) if (runs[id] === undefined || run.updatedAt > runs[id].updatedAt) runs[id] = run;
  return normalizeDoc({
    version: DOC_VERSION, createdAt: Math.min(current.createdAt, incoming.createdAt), updatedAt: now,
    viewport: incoming.viewport,
    nodes: mergeItems(current.nodes, incoming.nodes, removed, mergeNode),
    edges: mergeItems(current.edges, incoming.edges, removed),
    runs, removed,
  }, now);
}

// ── Editing helpers (pure: they return a new document). ──

export function addNodes(doc, nodes, now = Date.now()) {
  return normalizeDoc({ ...doc, updatedAt: now, nodes: [...doc.nodes, ...nodes.map((node) => ({ ...node, updatedAt: now }))] }, now);
}

export function updateNode(doc, id, patch, now = Date.now()) {
  return normalizeDoc({
    ...doc, updatedAt: now,
    nodes: doc.nodes.map((node) => (node.id === id ? { ...node, ...patch, data: { ...node.data, ...(patch.data ?? {}) }, updatedAt: now } : node)),
  }, now);
}

/**
 * Mirror a library asset's category onto every media node bound to it (`data.asset`), so re-filing an
 * asset in the library drawer (or saving it from one node) keeps all of its nodes' labels in step.
 * `category` null/unknown clears it. Returns `doc` itself when no node needs to change.
 */
export function setAssetCategory(doc, assetId, category, now = Date.now()) {
  const next = categoryOf(category);
  const stale = doc.nodes.filter((node) => (node.type === 'image' || node.type === 'video') && node.data.asset === assetId
    && categoryOf(node.data.category) !== next).map((node) => node.id);
  if (!assetId || stale.length === 0) return doc;
  const ids = new Set(stale);
  return normalizeDoc({
    ...doc, updatedAt: now,
    nodes: doc.nodes.map((node) => {
      if (!ids.has(node.id)) return node;
      const { category: _old, ...data } = node.data;
      return { ...node, data: next ? { ...data, category: next } : data, updatedAt: now };
    }),
  }, now);
}

/** Delete nodes, their children, and every edge touching them, leaving tombstones. */
export function removeNodes(doc, ids, now = Date.now()) {
  const doomed = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of doc.nodes) if (node.parentId !== undefined && doomed.has(node.parentId) && !doomed.has(node.id)) { doomed.add(node.id); grew = true; }
  }
  const removed = { ...doc.removed };
  const edges = [];
  for (const edge of doc.edges) {
    if (doomed.has(edge.source) || doomed.has(edge.target)) removed[edge.id] = now; else edges.push(edge);
  }
  for (const id of doomed) removed[id] = now;
  return normalizeDoc({ ...doc, updatedAt: now, nodes: doc.nodes.filter((node) => !doomed.has(node.id)), edges, removed }, now);
}

export function addEdge(doc, source, target, role = 'reference', now = Date.now()) {
  if (doc.edges.some((edge) => edge.source === source && edge.target === target && edge.role === role)) return doc;
  return normalizeDoc({ ...doc, updatedAt: now, edges: [...doc.edges, { id: newId('e'), source, target, role, updatedAt: now }] }, now);
}

export function removeEdges(doc, ids, now = Date.now()) {
  const doomed = new Set(ids);
  const removed = { ...doc.removed };
  for (const id of doomed) removed[id] = now;
  return normalizeDoc({ ...doc, updatedAt: now, edges: doc.edges.filter((edge) => !doomed.has(edge.id)), removed }, now);
}

/** Absolute canvas position of a node (children store positions relative to their frame). */
export function absolutePosition(doc, node) {
  let x = node.x, y = node.y, parent = node.parentId, guard = 0;
  while (parent !== undefined && guard++ < 32) {
    const frame = doc.nodes.find((candidate) => candidate.id === parent);
    if (frame === undefined) break;
    x += frame.x; y += frame.y; parent = frame.parentId;
  }
  return { x, y };
}

/** Fit a media box of natural size into `maxSide`, keeping the aspect ratio. */
export function fitSize(width, height, maxSide = 320) {
  if (!(width > 0 && height > 0)) return { w: maxSide, h: maxSide };
  const scale = maxSide / Math.max(width, height);
  return { w: Math.round(width * scale), h: Math.round(height * scale) };
}

/** Grid positions for `count` boxes starting at (x, y). */
export function gridLayout(boxes, { x = 0, y = 0, columns, gap = 24 } = {}) {
  const cols = Math.max(1, columns ?? Math.ceil(Math.sqrt(boxes.length)));
  const positions = [];
  let rowY = y, rowH = 0, colX = x;
  boxes.forEach((box, index) => {
    if (index > 0 && index % cols === 0) { rowY += rowH + gap; rowH = 0; colX = x; }
    positions.push({ x: colX, y: rowY });
    colX += box.w + gap;
    rowH = Math.max(rowH, box.h);
  });
  return positions;
}

/** A free spot to the right of everything, for nodes added without a position. */
export function freeSpot(doc, gap = 80) {
  const top = doc.nodes.filter((node) => node.parentId === undefined);
  if (top.length === 0) return { x: 0, y: 0 };
  const right = Math.max(...top.map((node) => node.x + node.w));
  const minY = Math.min(...top.map((node) => node.y));
  return { x: right + gap, y: minY };
}

/** Incoming references of a generator (or a generative media node), ordered by role then position. */
export function generatorInputs(doc, generatorId) {
  const byId = new Map(doc.nodes.map((node) => [node.id, node]));
  const inputs = { reference: [], first_frame: undefined, last_frame: undefined };
  const edges = doc.edges.filter((edge) => edge.target === generatorId && edge.role !== 'output' && edge.role !== 'shot');
  for (const edge of edges) {
    const node = byId.get(edge.source);
    if (node === undefined) continue;
    if (edge.role === 'first_frame' || edge.role === 'last_frame') inputs[edge.role] = node;
    else inputs.reference.push(node);
  }
  inputs.reference.sort((a, b) => a.y - b.y || a.x - b.x);
  return inputs;
}

// ── Generative media nodes: an image or video node is its own generator (params in data.gen) and keeps
//    every result it produced in data.versions. data.shown = { path, at } names the version on display;
//    the top-level media fields always mirror it (normalizeDoc derives them). Merges union the versions
//    and keep the newer `shown`, so a stale copy of the node can never drop a result. ──

/** Media fields that make up one version of an image or video node. */
export const VERSION_FIELDS = ['path', 'naturalWidth', 'naturalHeight', 'lastFrame', 'duration', 'ratio', 'resolution', 'meta'];
export const canGenerate = (node) => node?.type === 'generator' || node?.type === 'image' || node?.type === 'video';
/** The generation mode of a node that can generate. */
export const modeOf = (node) => (node.type === 'generator' ? (node.data.mode === 'video' ? 'video' : 'image') : node.type);
/** Generation parameters of a node, whichever kind it is. */
export const genOf = (node) => (node.type === 'generator' ? node.data : node.data.gen ?? {});

const versionOf = (data) => {
  const version = {};
  for (const key of VERSION_FIELDS) if (data[key] !== undefined) version[key] = data[key];
  return version;
};
const storedVersions = (data) => (Array.isArray(data.versions) ? data.versions.filter((v) => isRecord(v) && typeof v.path === 'string') : []);
export const versionsOf = (node) => {
  const list = storedVersions(node.data);
  return list.length === 0 && typeof node.data.path === 'string' ? [versionOf(node.data)] : list;
};
/** Index of the version on display. */
export const shownIndex = (node, versions = versionsOf(node)) => {
  const index = versions.findIndex((version) => version.path === node.data.path);
  return index === -1 ? versions.length - 1 : index;
};

/** Mirror the shown version into the top-level fields; resize the box to its aspect ratio, keeping the width. */
function mirrorShown(node) {
  const versions = storedVersions(node.data);
  if (versions.length === 0) return node;
  const want = isRecord(node.data.shown) ? node.data.shown.path : undefined;
  const version = versions.find((candidate) => candidate.path === want) ?? versions[versions.length - 1];
  if (version.path === node.data.path) return node;
  const data = { ...node.data };
  for (const key of VERSION_FIELDS) delete data[key];
  Object.assign(data, version);
  const { naturalWidth: w, naturalHeight: h } = version;
  return { ...node, data, ...(w > 0 && h > 0 ? { h: Math.max(30, Math.round((node.w * h) / w)) } : {}) };
}

/** Union of two version lists by path, in first-seen order. */
function unionVersions(a, b) {
  const seen = new Set();
  const out = [];
  for (const version of [...a, ...b]) if (!seen.has(version.path)) { seen.add(version.path); out.push(version); }
  return out;
}
const newerShown = (a, b) => (!isRecord(a) ? b : !isRecord(b) ? a : finite(b.at, 0) > finite(a.at, 0) ? b : a);

/**
 * Library links of a node: its prompt binding (`bind` = { id, v, text, name, at } in the generation
 * parameters; an entry without `id` records an unbind) and its media asset id (`data.asset`).
 * The Host sets them while the browser may hold an older copy, so they merge on their own clocks.
 */
const bindOf = (node) => (node.type === 'generator' ? node.data.bind : node.data.gen?.bind);
function withBind(node, bind) {
  if (!isRecord(bind)) return node;
  return node.type === 'generator' ? { ...node, data: { ...node.data, bind } } : { ...node, data: { ...node.data, gen: { ...(node.data.gen ?? {}), bind } } };
}

/** Merge rule for one node present on both sides: newer wins, but versions, `shown` and library links merge. */
function mergeNode(current, winner) {
  let out = winner;
  const a = storedVersions(current.data), b = storedVersions(winner.data);
  if (a.length > 0 || b.length > 0) {
    const shown = newerShown(current.data.shown, winner.data.shown);
    out = { ...out, data: { ...out.data, versions: unionVersions(a, b), ...(shown ? { shown } : {}) } };
  }
  out = withBind(out, newerShown(bindOf(current), bindOf(winner)));
  if (out.data.asset === undefined && typeof current.data.asset === 'string') out = { ...out, data: { ...out.data, asset: current.data.asset } };
  return out;
}

/** `p_xxx@3` of the prompt version a node is bound to. */
export const promptRefOf = (node) => { const bind = bindOf(node); return bind?.id ? `${bind.id}@${bind.v}` : undefined; };

/** Show version `index` of a media node. */
export function selectVersion(doc, id, index, now = Date.now()) {
  const node = doc.nodes.find((candidate) => candidate.id === id);
  const versions = node ? versionsOf(node) : [];
  if (versions[index] === undefined) return doc;
  return updateNode(doc, id, { data: { versions, shown: { path: versions[index].path, at: now } } }, now);
}

/** Add generated results to a media node as new versions and show the first of them. */
export function appendVersions(doc, id, added, now = Date.now()) {
  const node = doc.nodes.find((candidate) => candidate.id === id);
  if (node === undefined || added.length === 0) return doc;
  return updateNode(doc, id, { data: { versions: [...versionsOf(node), ...added], shown: { path: added[0].path, at: now } } }, now);
}

/** Compact, model-friendly description of the canvas. */
export function summarize(doc, selection = []) {
  const selected = new Set(selection);
  return {
    nodes: doc.nodes.map((node) => {
      const out = { id: node.id, type: node.type, x: Math.round(node.x), y: Math.round(node.y), w: Math.round(node.w), h: Math.round(node.h) };
      if (node.parentId) out.parent = node.parentId;
      if (selected.has(node.id)) out.selected = true;
      const d = node.data;
      if (d.label) out.label = d.label;
      if (node.type === 'image' || node.type === 'video') {
        if (d.path) out.path = d.path; else out.empty = true;
        if (d.meta?.prompt) out.prompt = text(d.meta.prompt).slice(0, 300);
        if (d.meta?.model) out.model = d.meta.model;
        if (d.gen?.prompt) out.gen_prompt = text(d.gen.prompt).slice(0, 300);
        if (promptRefOf(node)) out.prompt_ref = promptRefOf(node);
        if (d.asset) out.asset = d.asset;
        if (categoryOf(d.category)) out.category = d.category;
        const versions = versionsOf(node);
        if (versions.length > 1) out.version = `${shownIndex(node, versions) + 1}/${versions.length}`;
        const run = runOf(doc, node.id);
        if (run.status !== 'idle') out.status = run.status;
        if (run.error) out.error = run.error;
      }
      if (node.type === 'script') {
        if (d.title) out.title = d.title;
        out.rows = (Array.isArray(d.rows) ? d.rows : []).map((row, index) => ({ n: index + 1, id: row.id, duration: row.duration, description: text(row.description).slice(0, 200), prompt: text(row.prompt).slice(0, 300), ...(row.imageId ? { image: row.imageId } : {}) }));
      }
      if (node.type === 'text') out.text = text(d.text).slice(0, 500);
      if (node.type === 'link') Object.assign(out, { url: d.url, title: d.title, asset: d.asset });
      if (node.type === 'generator') {
        const run = runOf(doc, node.id);
        Object.assign(out, { mode: d.mode, prompt: text(d.prompt).slice(0, 300), status: run.status ?? 'idle' });
        if (run.error) out.error = run.error;
      }
      return out;
    }),
    edges: doc.edges.map((edge) => ({ from: edge.source, to: edge.target, role: edge.role })),
    selection: [...selected],
  };
}
