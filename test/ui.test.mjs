// End to end in a simulated browser: the built client.js (and its lazy canvas chunk) runs in jsdom,
// its fetches reach the real Host routes in-process, files land in a temp workspace, and only
// Volcengine Ark is faked. No DSH GUI is involved; the DSH services the plugin touches are stubbed.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://dsh.local/app/', pretendToBeVisual: true });
const w = dom.window;
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage', 'DOMParser', 'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'Event', 'CustomEvent', 'DragEvent', 'File', 'FileList']) {
  if (w[key] !== undefined) Object.defineProperty(globalThis, key, { value: w[key], configurable: true, writable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
class ResizeObserver { constructor(cb) { this.cb = cb; } observe(el) { this.cb([{ target: el, contentRect: { width: 1200, height: 800 } }]); } unobserve() {} disconnect() {} }
globalThis.ResizeObserver = w.ResizeObserver = ResizeObserver;
class DOMMatrixReadOnly { constructor(t) { const m = /matrix\(([^)]+)\)/.exec(t ?? ''); const v = m ? m[1].split(',').map(Number) : [1, 0, 0, 1, 0, 0]; this.m22 = v[3]; this.a = v[0]; } }
globalThis.DOMMatrixReadOnly = w.DOMMatrixReadOnly = DOMMatrixReadOnly;
Object.defineProperties(w.HTMLElement.prototype, { offsetWidth: { get() { return 1200; } }, offsetHeight: { get() { return 800; } } });
w.HTMLElement.prototype.getBoundingClientRect = function () { return { x: 0, y: 0, left: 0, top: 0, width: 1200, height: 800, right: 1200, bottom: 800 }; };
w.SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 10, height: 10 });

const React = (await import('react')).default;
const ReactDOM = await import('react-dom');
const { createRoot } = await import('react-dom/client');
const { act } = await import('react');
const { apply: applyHost } = await import('../index.js');
const D = await import('../src/shared/doc.js');

function png(width, height) {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(body)); return Buffer.concat([l, body, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height, 0x40); for (let y = 0; y < height; y++) raw[y * (width * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ── Host in-process, plus a fetch that routes the page's api/canvas/* calls to it ──
const cwd = await mkdtemp(join(tmpdir(), 'dsh-canvas-ui-'));
const routes = new Map(), tools = new Map();
const arkCalls = [];
applyHost({
  effect: (fn) => fn(),
  on: () => {},
  get: (name) => ({
    credentials: { resolve: async () => ({ value: 'k' }), describe: async () => ({ configured: true, source: 'store', writable: true }), set: async () => {}, unset: async () => {} },
    attachments: { saveImage: async ({ data, mediaType }) => ({ attachmentId: 'a', mediaType, bytes: data.byteLength, width: 1, height: 1 }) },
  })[name],
  connection: { fetch: { register: (route) => { routes.set(route.path, route); return () => {}; } } },
  tools: { register: (tool) => { tools.set(tool.name, tool); return () => {}; } },
});
const pageFetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (url.hostname === 'ark.cn-beijing.volces.com') {
    const body = JSON.parse(init.body);
    arkCalls.push(body);
    return new Response(JSON.stringify({ data: [{ b64_json: png(80, 40).toString('base64'), size: '2048x1024' }] }));
  }
  const route = routes.get(url.pathname.replace(/^\/app/, ''));
  if (!route) return new Response('{"error":"no route"}', { status: 404 });
  const request = new Request('http://dsh.internal' + url.pathname.replace(/^\/app/, '') + url.search, {
    method: init.method ?? 'GET', headers: init.headers, body: init.body, ...(init.body instanceof w.Blob || init.body?.stream ? { duplex: 'half' } : {}),
  });
  return route.fetch(request);
};
globalThis.fetch = pageFetch;
w.fetch = pageFetch;

// ── Page module loader running the built bundles ──
const modules = new Map();
w.__ModuleLoader__ = { load: (entry) => modules.set(entry.chunk ?? 'main', entry) };
globalThis.window.__ModuleLoader__ = w.__ModuleLoader__;
const platform = { react: React, 'react/jsx-runtime': await import('react/jsx-runtime'), 'react-dom': ReactDOM, 'react-dom/client': { createRoot } };
const requireFn = (id) => { if (!(id in platform)) throw new Error('unexpected require ' + id); return platform[id]; };
requireFn.async = async (spec) => {
  const entry = modules.get(spec.replace('./', ''));
  assert.ok(entry, 'chunk not loaded: ' + spec);
  return entry.factory(requireFn);
};
new Function(await readFile(new URL('../client.js', import.meta.url), 'utf8'))();
new Function(await readFile(new URL('../client.canvas.js', import.meta.url), 'utf8'))();
const plugin = modules.get('main').factory(requireFn);

// ── Client plugin with stubbed DSH client services ──
const dictionaries = new Map(), views = new Map(), opened = [];
let tabType;
plugin.apply({
  effect: (fn) => fn(),
  locale: { register: (ns, d) => { dictionaries.set(ns, d); return () => {}; }, bind: (ns) => (key) => dictionaries.get(ns).zh[key] ?? key },
  slots: { inject: (_name, fn) => fn(), register: (options, view) => { views.set(options.name + ':' + (options.key ?? options.id), view); return () => {}; } },
  sidebarRightTabs: { register: (definition) => { tabType = definition; return () => {}; } },
  sidebarRight: { openResource: (address, options) => opened.push({ address, options }), toggleFullscreen: () => {}, commandTarget: () => undefined },
});

async function waitFor(check, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    let value;
    await act(async () => { value = check(); await new Promise((r) => setTimeout(r, 25)); });
    if (value) return value;
    if (Date.now() > end) throw new Error('timed out; body: ' + document.body.innerHTML.slice(0, 600));
  }
}
const address = (rel) => 'dsh-resource://file/session/s1/' + rel.split('/').map(encodeURIComponent).join('/');
function mountTab(contentId, extra = {}) {
  const container = document.createElement('div');
  document.body.replaceChildren(container);
  const root = createRoot(container);
  const Tab = views.get('sidebar.right.pane.tab:@local/dsh-canvas');
  const drafts = [];
  const props = {
    sessionId: 's1', useSessions: (sel) => sel({ byId: { s1: { cwd } } }), useInput: (sel) => sel({ draft: '' }),
    inputActions: { setDraft: (text) => drafts.push(text) }, useSessionStatus: (sel) => sel(new Map()),
    useTabInfo: () => ({ tab: { contentId, visible: true, actions: { openResource: (a, o) => opened.push({ address: a, options: o }) } }, sidebar: { expanded: true, fullscreen: false } }),
    ...extra,
  };
  act(() => root.render(React.createElement(Tab, props)));
  return { root, container, drafts };
}
const click = (element) => act(() => { element.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); });
const button = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(text));

test('tab type claims .dshcanvas files and names tabs after the canvas', () => {
  assert.equal(tabType.kind, 'canvas');
  assert.deepEqual(tabType.patterns, ['*.dshcanvas']);
  assert.equal(tabType.priority, 'extension');
  assert.equal(tabType.keepMounted, true);
  assert.equal(tabType.title(address('canvas/角色设定.dshcanvas')), '角色设定');
  assert.equal(tabType.title('sidebar://canvas'), '画布');
  for (const tool of ['canvas_read', 'canvas_edit', 'canvas_generate_image', 'canvas_generate_video']) assert.ok(views.has('tool.call.toolview:' + tool));
  assert.ok(views.has('conversation.input.dock:dsh-canvas-attachment'));
});

test('opened from the guide: the picker creates a canvas in the workspace canvas/ folder', async () => {
  const { root } = mountTab('sidebar://canvas');
  await waitFor(() => document.body.textContent.includes('这个工作区还没有画布'));
  const input = document.querySelector('input[aria-label="新建画布"]');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set;
    setter.call(input, '角色 设定');
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
  });
  await act(async () => { document.querySelector('form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); });
  assert.equal(opened.at(-1).address, address('canvas/角色 设定.dshcanvas'));
  assert.equal(opened.at(-1).options.replaceTab, true);
  act(() => root.unmount());
});

test('canvas: add a generator, run it, results appear; agent edits show up live', async () => {
  const canvasPath = join(cwd, 'canvas', 'main.dshcanvas');
  await writeFile(join(cwd, 'ref.png'), png(300, 200));
  const { root, drafts } = mountTab(address('canvas/main.dshcanvas'));
  await waitFor(() => document.querySelector('.dshc-topbar'));
  assert.equal(document.querySelector('.dshc-topbar .name').textContent, 'main');
  assert.ok(document.querySelector('style[data-plugin-css="@local/dsh-canvas/flow.css"]'), 'React Flow CSS injected');

  // Add a (legacy) generator from the double-click menu; it is saved to the canvas file.
  await act(async () => { document.querySelector('.react-flow__pane').dispatchEvent(new w.MouseEvent('dblclick', { bubbles: true, clientX: 300, clientY: 300 })); });
  await waitFor(() => document.querySelector('.dshc-menu'));
  await click([...document.querySelectorAll('.dshc-menu button')].find((b) => b.textContent.startsWith('生成器')));
  assert.equal(document.querySelector('.dshc-menu'), null, 'the menu closes after adding');
  await waitFor(() => document.querySelector('.dshc-gen'));
  const doc = await (async () => { for (let i = 0; i < 60; i++) { try { const d = JSON.parse(await readFile(canvasPath, 'utf8')); if (d.nodes.length) return d; } catch {} await act(async () => { await new Promise((r) => setTimeout(r, 50)); }); } throw new Error('never saved'); })();
  const generator = doc.nodes.find((n) => n.type === 'generator');
  assert.equal(generator.data.mode, 'image');
  assert.equal(generator.data.model, 'doubao-seedream-5-0-260128');

  // The agent drops a reference image and wires it to the generator through its tool.
  const exec = { agent: { session: { header: { cwd } } }, signal: new AbortController().signal };
  await tools.get('canvas_edit').execute({ canvas: 'canvas/main.dshcanvas', ops: [{ op: 'add_image', path: 'ref.png', x: -400, y: 0 }, { op: 'connect', source: '$0', target: generator.id }] }, exec);
  await waitFor(() => document.querySelectorAll('.dshc-media img').length === 1 && document.body.textContent.includes('参考图 1'));
  const img = document.querySelector('.dshc-media img');
  assert.match(img.getAttribute('src'), /^http:\/\/dsh\.local\/app\/api\/canvas\/media\?path=.*ref\.png$/);

  // Type a prompt and generate from the node.
  const prompt = document.querySelector('.dshc-prompt');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(prompt, '同一角色，赛博朋克夜景');
    prompt.dispatchEvent(new w.Event('input', { bubbles: true }));
  });
  await click(document.querySelector('.dshc-gen .dshc-btn.primary'));
  await waitFor(() => document.querySelectorAll('.dshc-media img').length === 2, 8000);
  assert.equal(arkCalls.at(-1).prompt, '同一角色，赛博朋克夜景');
  assert.match(arkCalls.at(-1).image, /^data:image\/png;base64,/);
  assert.ok(document.querySelector('.dshc-badge'), 'generated image carries the AI badge');
  await waitFor(() => button('再来一次')).catch((error) => { throw new Error('rerun missing; gen card: ' + document.querySelector('.dshc-gen')?.outerHTML.slice(0, 1500)); });

  // On disk: the result, its provenance edge, and a finished run that the typed prompt did not undo.
  await act(async () => { await new Promise((r) => setTimeout(r, 900)); });
  const final = JSON.parse(await readFile(canvasPath, 'utf8'));
  assert.equal(final.nodes.filter((n) => n.type === 'image').length, 2);
  assert.equal(final.edges.filter((e) => e.role === 'output').length, 1);
  assert.equal(final.runs[generator.id].status, 'done');
  assert.equal(final.nodes.find((n) => n.id === generator.id).data.prompt, '同一角色，赛博朋克夜景');

  // Select the result and attach it: the Host holds it for the next turn; the draft is never touched.
  const resultId = final.nodes.find((n) => n.type === 'image' && n.data.meta?.source === 'generated').id;
  await act(async () => { document.querySelector(`[data-id="${resultId}"]`).dispatchEvent(new w.MouseEvent('click', { bubbles: true })); });
  await waitFor(() => document.querySelector('.dshc-actions .count')?.textContent === '1');
  await click(button('附加到对话'));
  await waitFor(() => document.body.textContent.includes('已附加 1 张卡片'));
  assert.equal(drafts.length, 0, 'the composer draft is not written');
  const held = await (await routes.get('/api/canvas/attach').fetch(new Request('http://dsh.internal/api/canvas/attach?sessionId=s1'))).json();
  assert.equal(held.attached, 1);
  act(() => root.unmount());
});

const typeInto = (element, text) => act(async () => {
  const proto = element.tagName === 'TEXTAREA' ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, text);
  element.dispatchEvent(new w.Event('input', { bubbles: true }));
});
const readDoc = async (file) => JSON.parse(await readFile(file, 'utf8'));
async function waitDoc(file, check) {
  for (let i = 0; i < 100; i++) {
    try { const d = await readDoc(file); if (check(d)) return d; } catch {}
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  }
  throw new Error('file never matched: ' + (await readFile(file, 'utf8').catch(() => '(none)')).slice(0, 800));
}

test('image node generates in place: inline panel, results become versions, presets derive new nodes', async () => {
  const canvasPath = join(cwd, 'canvas', 'nodes.dshcanvas');
  const { root } = mountTab(address('canvas/nodes.dshcanvas'));
  await waitFor(() => document.querySelector('.dshc-topbar'));
  assert.ok(document.querySelector('.dshc-root.dshc-dark, .dshc-root.dshc-light'), 'a canvas theme is applied');
  assert.match(document.querySelector('.dshc-guide').textContent, /双击画布/);
  await click(document.querySelector('[aria-label="添加节点"]'));
  await click([...document.querySelectorAll('.dshc-menu button')].find((b) => b.querySelector('.label')?.textContent === '图片'));
  assert.equal(document.querySelector('.dshc-guide'), null, 'the empty-canvas guide goes away');
  const empty = await waitFor(() => document.querySelector('.dshc-media.is-empty'));
  assert.match(empty.textContent, /图片节点/);
  const saved = await waitDoc(canvasPath, (d) => d.nodes.length === 1);
  const id = saved.nodes[0].id;
  assert.equal(saved.nodes[0].type, 'image');
  assert.equal(saved.nodes[0].data.gen.model, 'doubao-seedream-5-0-260128');

  // Selected on creation: the inline panel is open under the node.
  const panel = await waitFor(() => document.querySelector('.dshc-panel'));
  assert.match(panel.textContent, /生成图片/);
  await typeInto(panel.querySelector('textarea'), '一只橘猫坐在窗台');
  const calls = arkCalls.length;
  await click(panel.querySelector('.dshc-send'));
  await waitFor(() => document.querySelector(`[data-id="${id}"] img`), 8000);
  assert.equal(arkCalls.length, calls + 1);
  assert.equal(arkCalls.at(-1).prompt, '一只橘猫坐在窗台');
  assert.equal(arkCalls.at(-1).image, undefined, 'an empty node has no reference');

  // Again: now it edits its own picture, and the result is version 2 of the same node.
  await waitFor(() => !document.querySelector('.dshc-panel .dshc-send')?.disabled);
  await waitFor(() => document.querySelector('.dshc-panel')?.textContent.includes('编辑这张图'));
  await typeInto(document.querySelector('.dshc-panel textarea'), '换成夜景');
  await click(document.querySelector('.dshc-panel .dshc-send'));
  await waitFor(() => document.querySelector('.dshc-versions')?.textContent.includes('2/2'), 8000);
  assert.match(String(arkCalls.at(-1).image), /^data:image\/(png|jpeg);base64,/, 'the current picture is the reference');
  let doc = await waitDoc(canvasPath, (d) => d.nodes[0].data.versions?.length === 2);
  assert.equal(doc.nodes.length, 1, 'no extra result nodes');
  const [v1, v2] = doc.nodes[0].data.versions;
  assert.notEqual(v1.path, v2.path);
  assert.equal(doc.nodes[0].data.path, v2.path);

  // Step back to version 1.
  await click(document.querySelector('.dshc-versions button'));
  doc = await waitDoc(canvasPath, (d) => d.nodes[0].data.shown?.path === v1.path);
  assert.equal(doc.nodes[0].data.path, v1.path);

  // The title above the card names the node and its pixel size.
  assert.match(document.querySelector(`[data-id="${id}"] .dshc-node-title`).textContent, /64 × 32|80 × 40|2048 × 1024/);

  // A preset makes a new node referencing this one and runs it.
  await click(button('高清'));
  doc = await waitDoc(canvasPath, (d) => d.nodes.length === 2 && d.nodes[1].data.path);
  assert.deepEqual(doc.edges.map((e) => [e.source, e.target, e.role]), [[id, doc.nodes[1].id, 'reference']]);
  assert.match(arkCalls.at(-1).prompt, /高清修复/);
  act(() => root.unmount());
});

test('storyboard: the agent writes a script node, one click makes every shot image', async () => {
  const canvasPath = join(cwd, 'canvas', 'story.dshcanvas');
  const exec = { agent: { session: { header: { cwd } } }, signal: new AbortController().signal };
  await tools.get('canvas_edit').execute({ canvas: 'canvas/story.dshcanvas', ops: [{ op: 'add_script', label: '雨夜', rows: [
    { description: '雨夜十字路口', prompt: '低机位，雨夜路口积水倒影', duration: 3 },
    { description: '车内后座', prompt: '车窗雨痕，霓虹光斑', duration: 4 },
  ] }] }, exec);
  const { root } = mountTab(address('canvas/story.dshcanvas'));
  await waitFor(() => document.querySelector('.dshc-script'));
  assert.match(document.querySelector('.dshc-script').textContent, /2 镜 · 7 秒/);
  const calls = arkCalls.length;
  await click(button('生成分镜图 (2)'));
  const doc = await waitDoc(canvasPath, (d) => d.nodes.filter((n) => n.type === 'image' && n.data.path).length === 2);
  assert.equal(arkCalls.length, calls + 2);
  const script = doc.nodes.find((n) => n.type === 'script');
  assert.deepEqual(doc.edges.filter((e) => e.role === 'shot').map((e) => e.source), [script.id, script.id]);
  assert.ok(script.data.rows.every((row) => doc.nodes.some((n) => n.id === row.imageId)));
  await waitFor(() => button('生成分镜图 (0)'));
  act(() => root.unmount());
});

test('chrome: shortcuts, drag mode, edges, snapping and theme are remembered', async () => {
  localStorage.removeItem('dsh-canvas:ui');
  const { root } = mountTab(address('canvas/chrome.dshcanvas'));
  await waitFor(() => document.querySelector('.dshc-dock'));
  await click(document.querySelector('[aria-label="快捷键"]'));
  assert.match(document.querySelector('.dshc-pop').textContent, /添加节点/);
  await click(document.querySelector('[aria-label="选择：拖动框选"]'));
  await click(document.querySelector('[aria-label="隐藏节点连线"]'));
  await click(document.querySelector('[aria-label="网格吸附"]'));
  const dark = document.querySelector('.dshc-root').classList.contains('dshc-dark');
  await click(document.querySelector(`[aria-label="${dark ? '切换到浅色画布' : '切换到深色画布'}"]`));
  assert.ok(document.querySelector('.dshc-root').classList.contains(dark ? 'dshc-light' : 'dshc-dark'));
  assert.deepEqual(JSON.parse(localStorage.getItem('dsh-canvas:ui')), { theme: dark ? 'light' : 'dark', minimap: false, edges: false, snap: true, mode: 'select' });
  assert.equal(document.querySelector('[aria-label="选择：拖动框选"]').getAttribute('aria-pressed'), 'true');
  act(() => root.unmount());
  localStorage.removeItem('dsh-canvas:ui');
});

test('library: the node shows its prompt version, the drawer lists versions with outputs, a version goes back on the canvas', async () => {
  const canvasPath = join(cwd, 'canvas', 'lib.dshcanvas');
  const { root } = mountTab(address('canvas/lib.dshcanvas'));
  await waitFor(() => document.querySelector('.dshc-topbar'));
  await click(document.querySelector('[aria-label="添加节点"]'));
  await click([...document.querySelectorAll('.dshc-menu button')].find((b) => b.querySelector('.label')?.textContent === '图片'));
  const panel = await waitFor(() => document.querySelector('.dshc-panel'));
  await typeInto(panel.querySelector('textarea'), '一只柴犬');
  await click(panel.querySelector('.dshc-send'));
  await waitFor(() => /一只柴犬 · v1/.test(document.querySelector('.dshc-bind')?.textContent ?? ''), 8000);
  await waitFor(() => !document.querySelector('.dshc-panel .dshc-send')?.disabled);

  // Editing marks the binding edited; generating commits version 2 of the same prompt.
  await typeInto(document.querySelector('.dshc-panel textarea'), '一只柴犬，戴墨镜');
  await waitFor(() => document.querySelector('.dshc-bind.edited'));
  await click(document.querySelector('.dshc-panel .dshc-send'));
  await waitFor(() => /v2$/.test(document.querySelector('.dshc-bind .dshc-chip')?.textContent ?? ''), 8000);

  // The chip opens the prompt in the library: both versions, each with the image it produced.
  await click(document.querySelector('.dshc-bind .dshc-chip'));
  const drawer = await waitFor(() => document.querySelector('.dshc-drawer [data-version="2"]') && document.querySelector('.dshc-drawer'));
  await waitFor(() => drawer.querySelectorAll('[data-version] .out').length === 2);
  assert.equal(drawer.querySelector('[data-version="2"] .text').textContent, '一只柴犬，戴墨镜');
  assert.match(drawer.querySelector('[data-version="2"]').textContent, /latest/);

  // Mark v1 final, then place v1 on the canvas: an empty image node bound to it.
  const inV1 = (label) => [...drawer.querySelectorAll('[data-version="1"] button')].find((b) => b.textContent === label);
  await click(inV1('设为定稿'));
  await waitFor(() => /定稿/.test(drawer.querySelector('[data-version="1"] header').textContent));
  await click(inV1('放到画布'));
  const doc = await waitDoc(canvasPath, (d) => d.nodes.length === 2);
  const placed = doc.nodes[1];
  assert.equal(placed.data.gen.prompt, '一只柴犬');
  assert.equal(placed.data.gen.bind.v, 1);
  assert.equal(placed.data.path, undefined);

  // The list: back, search, the image tab.
  await click(drawer.querySelector('[aria-label="返回"]'));
  const search = await waitFor(() => drawer.querySelector('input[aria-label="搜索名称、提示词、标签"]'));
  await typeInto(search, '柴犬');
  await waitFor(() => drawer.querySelectorAll('.dshc-lib-card').length >= 2);
  assert.ok([...drawer.querySelectorAll('.dshc-lib-card.kind-prompt')].some((c) => c.textContent.includes('一只柴犬，戴墨镜')));
  await click([...drawer.querySelectorAll('[role=tab]')].find((b) => b.textContent === '历史'));
  await waitFor(() => drawer.querySelectorAll('.dshc-lib-run').length >= 2);
  act(() => root.unmount());
});

test('asset categories: the image bar saves to the library under a category, the drawer filters and re-files it; the style preset derives', async () => {
  const canvasPath = join(cwd, 'canvas', 'cats.dshcanvas');
  const { root } = mountTab(address('canvas/cats.dshcanvas'));
  await waitFor(() => document.querySelector('.dshc-topbar'));
  await click(document.querySelector('[aria-label="添加节点"]'));
  await click([...document.querySelectorAll('.dshc-menu button')].find((b) => b.querySelector('.label')?.textContent === '图片'));
  const panel = await waitFor(() => document.querySelector('.dshc-panel'));
  await typeInto(panel.querySelector('textarea'), '红斗篷少女，全身立绘');
  await click(panel.querySelector('.dshc-send'));
  let doc = await waitDoc(canvasPath, (d) => d.nodes[0]?.data.path && d.nodes[0].data.asset);
  const id = doc.nodes[0].id;
  const generatedAsset = doc.nodes[0].data.asset;

  // The floating bar: pick 角色 and save; the node remembers its category, the asset is re-filed (not duplicated).
  const pick = await waitFor(() => document.querySelector('.dshc-nodebar select[aria-label="资产分类"]'));
  assert.deepEqual([...pick.options].map((o) => o.textContent), ['未分类', '角色', '场景', '道具', '风格', '音频']);
  await act(async () => { Object.getOwnPropertyDescriptor(w.HTMLSelectElement.prototype, 'value').set.call(pick, 'character'); pick.dispatchEvent(new w.Event('change', { bubbles: true })); });
  await click(button('存入素材库'));
  doc = await waitDoc(canvasPath, (d) => d.nodes[0].data.category === 'character');
  assert.equal(doc.nodes[0].data.asset, generatedAsset);
  await waitFor(() => document.body.textContent.includes('已存入素材库 · 角色'));
  assert.match(document.querySelector(`[data-id="${id}"] .dshc-node-title`).textContent, /角色/);

  // The drawer: the category chips filter the list; the card shows its category.
  await click(document.querySelector('[aria-label="素材库"]'));
  const drawer = await waitFor(() => document.querySelector('.dshc-drawer .dshc-lib-cats') && document.querySelector('.dshc-drawer'));
  const chip = (label) => [...drawer.querySelectorAll('.dshc-lib-cats button')].find((b) => b.textContent === label);
  await click(chip('角色'));
  await waitFor(() => drawer.querySelectorAll('.dshc-lib-card').length === 1);
  const card = drawer.querySelector('.dshc-lib-card');
  assert.ok(card.classList.contains('kind-image'));
  assert.match(card.querySelector('.tags').textContent, /角色/);
  await click(chip('场景'));
  await waitFor(() => drawer.querySelectorAll('.dshc-lib-card').length === 0);

  // Re-file from the detail view, then the 场景 filter finds it.
  await click(chip('全部分类'));
  await waitFor(() => drawer.querySelector('.dshc-lib-card.kind-image'));
  await click(drawer.querySelector('.dshc-lib-card.kind-image'));
  const assign = await waitFor(() => drawer.querySelector('.dshc-lib-sub select[aria-label="资产分类"]'));
  assert.equal(assign.value, 'character');
  await act(async () => { Object.getOwnPropertyDescriptor(w.HTMLSelectElement.prototype, 'value').set.call(assign, 'scene'); assign.dispatchEvent(new w.Event('change', { bubbles: true })); });
  await waitFor(() => drawer.querySelector('.dshc-lib-sub select')?.value === 'scene');
  await click(drawer.querySelector('[aria-label="返回"]'));
  await waitFor(() => drawer.querySelector('.dshc-lib-cats'));
  await click(chip('场景'));
  await waitFor(() => drawer.querySelectorAll('.dshc-lib-card.kind-image').length === 1);
  await click(drawer.querySelector('[aria-label="关闭素材库"]'));

  // The style preset makes a new node referencing this one, with a style-transfer prompt.
  await act(async () => { document.querySelector(`[data-id="${id}"]`).dispatchEvent(new w.MouseEvent('click', { bubbles: true })); });
  await click(await waitFor(() => button('风格')));
  doc = await waitDoc(canvasPath, (d) => d.nodes.length === 2 && d.nodes[1].data.path);
  assert.deepEqual(doc.edges.map((e) => [e.source, e.target, e.role]), [[id, doc.nodes[1].id, 'reference']]);
  assert.match(arkCalls.at(-1).prompt, /美术风格/);
  act(() => root.unmount());
});

test('tool card offers to open the canvas the tool touched', () => {
  const Card = views.get('tool.call.toolview:canvas_edit');
  const container = document.createElement('div');
  document.body.replaceChildren(container);
  const root = createRoot(container);
  act(() => root.render(React.createElement(Card, {
    toolName: 'canvas_edit', phase: 'result', sessionId: 's1', cwd,
    block: { isError: false, content: [{ type: 'text', text: `已更新画布 ${join(cwd, 'canvas', 'main.dshcanvas')}（共 3 个节点）` }] },
  })));
  const open = button('在画布中打开');
  assert.ok(open);
  click(open);
  assert.equal(opened.at(-1).address, address('canvas/main.dshcanvas'));
  act(() => root.unmount());
});

test('attachment chip shows above the composer and can be removed', async () => {
  const Chip = views.get('conversation.input.dock:dsh-canvas-attachment');
  const container = document.createElement('div');
  document.body.replaceChildren(container);
  const root = createRoot(container);
  const statuses = new Map([['s1', { running: false }]]);
  act(() => root.render(React.createElement(Chip, { sessionId: 's1', useSessionStatus: (sel) => sel(statuses) })));
  assert.match(document.body.textContent, /📎 画布 main · 1 张卡片/);
  assert.match(document.body.textContent, /<canvas_context>/);
  await click(document.querySelector('.dshc-attach button'));
  assert.equal(document.querySelector('.dshc-attach'), null);
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  const held = await (await routes.get('/api/canvas/attach').fetch(new Request('http://dsh.internal/api/canvas/attach?sessionId=s1'))).json();
  assert.equal(held.attached, 0);
  act(() => root.unmount());
});
