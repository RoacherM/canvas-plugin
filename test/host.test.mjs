import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import test from 'node:test';
import { apply, inject } from '../index.js';
import { createGenerator } from '../src/host/generate.js';
import { createStore } from '../src/host/store.js';
import { imageSize } from '../src/host/media.js';
import { arkcliKey, imageRequests, videoRequest } from '../src/host/ark.js';
import * as D from '../src/shared/doc.js';

/** A real PNG of the given size (solid color), so size sniffing and data URIs are exercised for real. */
function png(width, height) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(body)); return Buffer.concat([len, body, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height, 0x80); for (let y = 0; y < height; y++) raw[y * (width * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Fake Volcengine Ark: records requests, answers images with PNGs and video tasks with a scripted lifecycle. */
function fakeArk({ taskStates = ['running', 'succeeded'] } = {}) {
  const calls = [];
  let polls = 0;
  const fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url: String(url), method: init.method ?? 'GET', body, auth: init.headers?.Authorization });
    const ok = (value) => new Response(JSON.stringify(value), { status: 200 });
    if (String(url).endsWith('/images/generations')) {
      const n = body.sequential_image_generation === 'auto' ? body.sequential_image_generation_options.max_images : 1;
      return ok({ data: Array.from({ length: n }, () => ({ b64_json: png(64, 32).toString('base64'), size: '2048x1024' })) });
    }
    if (String(url).endsWith('/contents/generations/tasks')) return ok({ id: 'cgt-1' });
    if (String(url).includes('/contents/generations/tasks/')) {
      const status = taskStates[Math.min(polls++, taskStates.length - 1)];
      return ok({ id: 'cgt-1', status, model: 'doubao-seedance-2-0-fast-260128', ratio: '16:9', duration: 5, resolution: '720p',
        content: status === 'succeeded' ? { video_url: 'https://cdn.example/v.mp4', last_frame_url: 'https://cdn.example/l.png' } : undefined });
    }
    if (String(url) === 'https://cdn.example/v.mp4') return new Response(Buffer.from('fake-mp4-bytes'));
    if (String(url) === 'https://cdn.example/l.png') return new Response(png(16, 9));
    return new Response('not found', { status: 404 });
  };
  return { fetch, calls };
}

async function workspace() {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-canvas-'));
  await writeFile(join(cwd, 'ref.png'), png(300, 200));
  return { cwd, canvas: join(cwd, 'canvas', 'main.dshcanvas') };
}

function mount({ key = 'ark-test-key' } = {}) {
  if (key === null) key = undefined;
  const routes = new Map(), tools = new Map(), disposers = [], saved = [], events = new Map();
  const credentials = {
    resolve: async (ref) => (ref === 'ARK_API_KEY' && key ? { value: key, source: 'store' } : undefined),
    describe: async () => ({ configured: Boolean(key), writable: true }),
    set: async (ref, value) => { key = value; }, unset: async () => { key = undefined; },
  };
  const attachments = { saveImage: async ({ data, mediaType, name }) => { saved.push(name); const size = imageSize(Buffer.from(data)); return { attachmentId: 'att-' + saved.length, mediaType, bytes: data.byteLength, ...{ width: size?.width, height: size?.height } }; } };
  const ctx = {
    effect: (fn) => { disposers.push(fn()); },
    on: (name, fn) => { events.set(name, fn); },
    get: (name) => ({ credentials, attachments })[name],
    connection: { fetch: { register: (route) => { assert.ok(!routes.has(route.path), 'duplicate route ' + route.path); routes.set(route.path, route); return () => routes.delete(route.path); } } },
    tools: { register: (tool) => { tools.set(tool.name, tool); return () => tools.delete(tool.name); } },
  };
  apply(ctx);
  const call = async (method, path, { query = {}, body, headers = {}, raw } = {}) => {
    const url = new URL('http://dsh.internal' + path);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const route = routes.get(path);
    assert.ok(route, 'no route ' + path);
    assert.ok(route.methods.includes(method), `${method} not allowed on ${path}`);
    const init = { method, headers: { ...headers } };
    if (body !== undefined) { init.body = JSON.stringify(body); init.headers['content-type'] = 'application/json'; }
    if (raw !== undefined) { init.body = raw; init.duplex = 'half'; }
    return route.fetch(new Request(url, init));
  };
  const exec = (cwd) => ({ agent: { session: { header: { cwd } } }, signal: new AbortController().signal });
  return { routes, tools, disposers, saved, events, call, exec, dispose: () => disposers.forEach((d) => typeof d === 'function' && d()) };
}

async function until(check, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) { const value = await check(); if (value) return value; if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 20)); }
}

test('declares only ctx services and registers routes and four tools', () => {
  assert.deepEqual(inject, ['connection', 'tools']);
  const m = mount();
  assert.deepEqual([...m.routes.keys()].sort(), ['/api/canvas/attach', '/api/canvas/config', '/api/canvas/doc', '/api/canvas/focus', '/api/canvas/generate', '/api/canvas/history', '/api/canvas/import', '/api/canvas/library', '/api/canvas/library/asset', '/api/canvas/library/link', '/api/canvas/library/save', '/api/canvas/library/update', '/api/canvas/list', '/api/canvas/media', '/api/canvas/save', '/api/canvas/version']);
  assert.equal(m.routes.get('/api/canvas/import').requestBody, 'streaming');
  assert.deepEqual(m.routes.get('/api/canvas/media').methods, ['GET', 'HEAD']);
  assert.deepEqual([...m.tools.keys()], ['canvas_read', 'canvas_edit', 'canvas_generate_image', 'canvas_generate_video']);
  m.dispose();
  assert.equal(m.routes.size + m.tools.size, 0);
});

test('doc round trip: empty canvas, save, and a merge when another writer got in first', async () => {
  const { canvas } = await workspace();
  const m = mount();
  const first = await (await m.call('GET', '/api/canvas/doc', { query: { path: canvas } })).json();
  assert.equal(first.version, null);
  const doc = D.addNodes(first.doc, [{ id: 'a', type: 'text', x: 0, y: 0, data: { text: 'hi' } }]);
  const saved = await (await m.call('POST', '/api/canvas/save', { body: { path: canvas, doc, baseVersion: null } })).json();
  assert.equal(saved.merged, false);
  await new Promise((r) => setTimeout(r, 5));
  // The agent adds a node through the tool; the tab then saves from the old version.
  await m.tools.get('canvas_edit').execute({ ops: [{ op: 'add_text', text: 'from agent' }] }, m.exec(join(canvas, '..', '..')));
  const moved = D.updateNode(doc, 'a', { x: 300 });
  const second = await (await m.call('POST', '/api/canvas/save', { body: { path: canvas, doc: moved, baseVersion: saved.version } })).json();
  assert.equal(second.merged, true);
  assert.deepEqual(second.doc.nodes.map((n) => n.data.text).sort(), ['from agent', 'hi']);
  assert.equal(second.doc.nodes.find((n) => n.id === 'a').x, 300);
  const bad = await m.call('POST', '/api/canvas/save', { body: { path: '/etc/passwd', doc } });
  assert.equal(bad.status, 400);
});

test('import streams a file into canvas/assets and media serves it with Range', async () => {
  const { canvas } = await workspace();
  const m = mount();
  const bytes = png(40, 20);
  const res = await m.call('POST', '/api/canvas/import', { query: { path: canvas, name: 'My Photo.PNG' }, raw: new Blob([bytes]).stream() });
  const out = await res.json();
  assert.equal(res.status, 200, JSON.stringify(out));
  assert.match(out.path, /^assets\/My Photo-[a-z0-9]+\.png$/);
  assert.deepEqual(await readFile(out.absolute), bytes);
  const refused = await m.call('POST', '/api/canvas/import', { query: { path: canvas, name: 'x.exe' }, raw: new Blob(['x']).stream() });
  assert.equal(refused.status, 415);
  const part = await m.call('GET', '/api/canvas/media', { query: { path: out.absolute }, headers: { range: 'bytes=0-7' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), `bytes 0-7/${bytes.length}`);
  assert.deepEqual(Buffer.from(await part.arrayBuffer()), bytes.subarray(0, 8));
  const whole = await m.call('GET', '/api/canvas/media', { query: { path: out.absolute } });
  assert.equal(whole.status, 200);
  assert.equal((await whole.arrayBuffer()).byteLength, bytes.length);
  assert.equal((await m.call('GET', '/api/canvas/media', { query: { path: '/etc/hosts' } })).status, 415);
});

test('generate route: reference images go to Seedream, results land beside the generator', async (t) => {
  const { cwd, canvas } = await workspace();
  const ark = fakeArk();
  t.mock.method(globalThis, 'fetch', ark.fetch);
  const m = mount();
  let doc = D.addNodes(D.emptyDoc(), [
    { id: 'r', type: 'image', x: 0, y: 0, w: 300, h: 200, data: { path: join(cwd, 'ref.png') } },
    { id: 'g', type: 'generator', x: 400, y: 0, data: { mode: 'image', prompt: '换成水彩风格', model: 'doubao-seedream-5-0-260128', ratio: '16:9', count: 3 } },
  ]);
  doc = D.addEdge(doc, 'r', 'g', 'reference');
  await m.call('POST', '/api/canvas/save', { body: { path: canvas, doc, baseVersion: null } });
  const res = await m.call('POST', '/api/canvas/generate', { body: { path: canvas, nodeId: 'g', mode: 'image' } });
  assert.equal(res.status, 202);
  const final = await until(async () => { const d = (await (await m.call('GET', '/api/canvas/doc', { query: { path: canvas } })).json()).doc; return d.runs.g?.status === 'done' && d; });
  const request = ark.calls.find((c) => c.url.endsWith('/images/generations'));
  assert.equal(request.url, 'https://ark.cn-beijing.volces.com/api/v3/images/generations');
  assert.equal(request.auth, 'Bearer ark-test-key');
  assert.equal(request.body.size, '2848x1600');
  assert.equal(request.body.response_format, 'b64_json');
  assert.equal(request.body.sequential_image_generation, 'auto');
  assert.equal(request.body.sequential_image_generation_options.max_images, 3);
  assert.match(request.body.image, /^data:image\/png;base64,/);
  const results = final.nodes.filter((n) => n.type === 'image' && n.id !== 'r');
  assert.equal(results.length, 3);
  assert.ok(results.every((n) => n.x >= 400 + 340 && n.data.meta.prompt === '换成水彩风格' && n.data.meta.refs[0] === 'r'));
  assert.deepEqual({ w: results[0].w, h: results[0].h }, { w: 300, h: 150 });
  assert.equal(final.edges.filter((e) => e.role === 'output').length, 3);
  const assets = await readdir(join(cwd, 'canvas', 'assets'));
  assert.equal(assets.filter((f) => f.startsWith('gen-')).length, 3);
});

test('without an API key the generate route fails fast with a clear message', async () => {
  const { canvas } = await workspace();
  const m = mount({ key: null });
  const saved = process.env.ARK_API_KEY; delete process.env.ARK_API_KEY;
  const home = process.env.HOME; process.env.HOME = await mkdtemp(join(tmpdir(), 'nohome-'));   // no ~/.arkcli either
  const doc = D.addNodes(D.emptyDoc(), [{ id: 'g', type: 'generator', x: 0, y: 0, data: { mode: 'image', prompt: 'cat' } }]);
  await m.call('POST', '/api/canvas/save', { body: { path: canvas, doc, baseVersion: null } });
  const res = await m.call('POST', '/api/canvas/generate', { body: { path: canvas, nodeId: 'g' } });
  assert.equal(res.status, 412);
  assert.match((await res.json()).error, /API Key/);
  const after = (await (await m.call('GET', '/api/canvas/doc', { query: { path: canvas } })).json()).doc;
  assert.equal(after.runs.g.status, 'error');
  if (saved !== undefined) process.env.ARK_API_KEY = saved;
  process.env.HOME = home;
  process.env.HOME = await mkdtemp(join(tmpdir(), 'nohome-'));
  const config = await (await m.call('GET', '/api/canvas/config')).json();
  assert.equal(config.configured, false);
  process.env.HOME = home;
  await m.call('POST', '/api/canvas/config', { body: { apiKey: ' sk-new ' } });
  assert.equal((await (await m.call('GET', '/api/canvas/config')).json()).configured, true);
});

test('video: task created with frame roles, polled to completion, video and last frame saved', async () => {
  const { cwd, canvas } = await workspace();
  const ark = fakeArk({ taskStates: ['queued', 'running', 'succeeded'] });
  const { createArk } = await import('../src/host/ark.js');
  const pending = [];
  const timers = { set: (fn) => { pending.push(fn); return pending.length; }, clear: () => {} };
  const store = createStore();
  const gen = createGenerator({ store, getArk: async () => createArk({ apiKey: 'k', fetchImpl: ark.fetch }), timers });
  let doc = D.addNodes(D.emptyDoc(), [
    { id: 'f', type: 'image', x: 0, y: 0, data: { path: join(cwd, 'ref.png') } },
    { id: 'g', type: 'generator', x: 400, y: 0, data: { mode: 'video', prompt: '镜头缓缓推进', duration: 99, resolution: '4k' } },
  ]);
  doc = D.addEdge(doc, 'f', 'g', 'first_frame');
  await store.save(canvas, doc, null);
  const { taskId } = await gen.runVideo(canvas, 'g');
  assert.equal(taskId, 'cgt-1');
  const create = ark.calls.find((c) => c.url.endsWith('/contents/generations/tasks'));
  assert.deepEqual(create.body.content.map((c) => c.role ?? c.type), ['text', 'first_frame']);
  assert.equal(create.body.duration, 15);            // clamped to Seedance 2.0 fast's 4-15 s
  assert.equal(create.body.resolution, '720p');      // 4k is not offered by 2.0 fast
  assert.equal(create.body.return_last_frame, true);
  assert.equal(gen.isRunning(canvas, 'g'), true);
  while (pending.length > 0) await pending.shift()();
  const { doc: final } = await store.read(canvas);
  const video = final.nodes.find((n) => n.type === 'video');
  assert.ok(video, 'video node added');
  assert.match(video.data.path, /^assets\/video-.*\.mp4$/);
  assert.match(video.data.lastFrame, /^assets\/last-frame-.*\.png$/);
  assert.equal(final.runs.g.status, 'done');
  assert.equal(await readFile(join(cwd, 'canvas', video.data.path), 'utf8'), 'fake-mp4-bytes');
  assert.equal(gen.isRunning(canvas, 'g'), false);
});

test('after a restart, running video tasks resume and dead image runs are released', async () => {
  const { canvas } = await workspace();
  const ark = fakeArk({ taskStates: ['succeeded'] });
  const { createArk } = await import('../src/host/ark.js');
  const store = createStore();
  const doc = D.addNodes(D.emptyDoc(), [
    { id: 'gv', type: 'generator', x: 0, y: 0, data: { mode: 'video' } },
    { id: 'gi', type: 'generator', x: 0, y: 400, data: { mode: 'image' } },
  ]);
  doc.runs = { gv: { status: 'running', taskId: 'cgt-1', updatedAt: 1 }, gi: { status: 'running', updatedAt: 1 } };
  await store.save(canvas, doc, null);
  const pending = [];
  const gen = createGenerator({ store, getArk: async () => createArk({ apiKey: 'k', fetchImpl: ark.fetch }), timers: { set: (fn) => pending.push(fn), clear() {} } });
  await gen.resume(canvas, (await store.read(canvas)).doc);
  while (pending.length > 0) await pending.shift()();
  const { doc: final } = await store.read(canvas);
  assert.equal(final.runs.gv.status, 'done');
  assert.equal(final.runs.gi.status, 'error');
  assert.ok(final.nodes.some((n) => n.type === 'video'));
});

test('a second start of a running generator is refused', async () => {
  const { canvas } = await workspace();
  const store = createStore();
  let release;
  const gate = new Promise((r) => { release = r; });
  const gen = createGenerator({ store, getArk: async () => { await gate; throw new Error('stop'); } });
  await store.save(canvas, D.addNodes(D.emptyDoc(), [{ id: 'g', type: 'generator', x: 0, y: 0, data: { mode: 'image', prompt: 'x' } }]), null);
  const first = gen.runImage(canvas, 'g').catch((e) => e);
  await until(() => gen.isRunning(canvas, 'g'));
  await assert.rejects(gen.runImage(canvas, 'g'), /正在生成中/);
  release();
  assert.match((await first).message, /stop/);
});

test('agent tools: edit with $refs and frames, read with images, generate images', async (t) => {
  const { cwd } = await workspace();
  const ark = fakeArk();
  t.mock.method(globalThis, 'fetch', ark.fetch);
  const m = mount();
  const exec = m.exec(cwd);
  const edit = await m.tools.get('canvas_edit').execute({ ops: [
    { op: 'add_image', path: 'ref.png', x: 0, y: 0 },
    { op: 'add_text', text: '主角设定', x: 0, y: 300 },
    { op: 'add_frame', label: '情绪板', ids: ['$0', '$1'] },
    { op: 'add_generator', mode: 'image', prompt: '同一角色，侧面', references: ['$0'], x: 900, y: 0 },
  ] }, exec);
  assert.match(edit.text, /#3 add_generator → g/);
  const read = await m.tools.get('canvas_read').execute({}, exec);
  const summary = JSON.parse(read.text);
  const frame = summary.nodes.find((n) => n.type === 'frame');
  const image = summary.nodes.find((n) => n.type === 'image');
  assert.equal(image.parent, frame.id);
  assert.deepEqual({ w: image.w, h: image.h }, { w: 300, h: 200 });
  assert.deepEqual(summary.edges, [{ from: image.id, to: summary.nodes.find((n) => n.type === 'generator').id, role: 'reference' }]);
  // The user selects the image in the tab; canvas_read then shows it to the model.
  await m.call('POST', '/api/canvas/focus', { body: { path: join(cwd, 'canvas', 'main.dshcanvas'), cwd, selection: [image.id] } });
  const seen = await m.tools.get('canvas_read').execute({}, exec);
  assert.equal(seen.images.length, 1);
  const blocks = m.tools.get('canvas_read').output.render({}, seen);
  assert.deepEqual(blocks.map((b) => b.type), ['text', 'image']);
  assert.equal(blocks[1].attachment.attachmentId, 'att-1');
  assert.equal('nodeId' in blocks[1].attachment, false);

  const generated = await m.tools.get('canvas_generate_image').execute({ prompt: '海报', references: [image.id, 'ref.png'], count: 2, near: image.id }, exec);
  assert.equal(generated.images.length, 2);
  assert.match(generated.text, /已生成 2 张图片/);
  const body = ark.calls.filter((c) => c.url.endsWith('/images/generations')).at(-1).body;
  assert.equal(body.image.length, 2);   // node reference + a path that was added to the canvas
  await assert.rejects(m.tools.get('canvas_edit').execute({ ops: [{ op: 'update', id: 'nope', x: 1 }] }, exec), /找不到节点/);
  await assert.rejects(m.tools.get('canvas_edit').execute({ ops: [] }, { agent: undefined, signal: new AbortController().signal }), /工作区/);
});

test('request builders follow the Ark contract', () => {
  assert.equal(imageRequests({ model: 'doubao-seedream-5-0-pro-260628', prompt: 'x', count: 3 }).length, 3);   // pro: parallel singles
  assert.equal(imageRequests({ prompt: 'x', count: 1 })[0].sequential_image_generation, 'disabled');
  assert.throws(() => imageRequests({ prompt: 'x', images: Array(11).fill('d'), model: 'doubao-seedream-5-0-flash-260915' }), /最多支持 10 张/);
  assert.throws(() => imageRequests({ prompt: 'x', images: Array(10).fill('d'), count: 6 }), /不能超过 15/);
  assert.throws(() => imageRequests({ prompt: ' ' }), /提示词/);
  const refs = videoRequest({ prompt: 'p', references: ['a', 'b'] });
  assert.deepEqual(refs.content.map((c) => c.role ?? c.type), ['text', 'reference_image', 'reference_image']);
  assert.equal(refs.generate_audio, true);
  assert.throws(() => videoRequest({ lastFrame: 'x' }), /首帧/);
  assert.throws(() => videoRequest({ model: 'doubao-seedance-1-0-pro-fast-251015', references: ['a'] }), /不支持参考图/);
  assert.equal('generate_audio' in videoRequest({ model: 'doubao-seedance-1-0-pro-fast-251015', prompt: 'p' }), false);
});

test('image size sniffing', () => {
  assert.deepEqual(imageSize(png(123, 45)), { width: 123, height: 45 });
  assert.equal(imageSize(Buffer.from('nope')), undefined);
});

test('reads the ark CLI default profile key', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'arkcli-'));
  const file = join(dir, 'config.yaml');
  await writeFile(file, 'default_profile: b\nprofiles:\n  a:\n    api_key: ark-a\n  b:\n    region: cn-beijing\n    api_key: "ark-b"\n    available_api_keys:\n    - ark-x\n');
  assert.equal(await arkcliKey(file), 'ark-b');
  assert.equal(await arkcliKey(join(dir, 'missing.yaml')), undefined);
});

test('attached cards reach the next turn as a separate <canvas_context> message, once', async () => {
  const { cwd, canvas } = await workspace();
  const m = mount();
  let doc = D.addNodes(D.emptyDoc(), [
    { id: 'f', type: 'frame', x: 100, y: 100, data: { label: '情绪板' } },
    { id: 'r', type: 'image', x: 10, y: 20, w: 300, h: 200, parentId: 'f', data: { path: join(cwd, 'ref.png'), meta: { prompt: 'a <cute> chick & "sprout"', model: 'seedream' } } },
    { id: 'n', type: 'text', x: 0, y: 400, data: { text: '主角' } },
  ]);
  await m.call('POST', '/api/canvas/save', { body: { path: canvas, doc, baseVersion: null } });
  const attached = await (await m.call('POST', '/api/canvas/attach', { body: { sessionId: 's1', path: canvas, ids: ['r', 'n', 'ghost'] } })).json();
  assert.equal(attached.attached, 3);
  assert.equal((await (await m.call('GET', '/api/canvas/attach', { query: { sessionId: 's1' } })).json()).attached, 3);

  const preStep = m.events.get('agent/pre-step');
  const user = { id: 'u', role: 'user', content: [{ type: 'text', text: '把它做成海报' }] };
  const run = (step, sessionId = 's1') => preStep({ agent: { session: { id: sessionId } }, step, signal: new AbortController().signal }, async () => ({ kind: 'accept', messages: [user] }));
  assert.deepEqual((await run(2)).messages, [user], 'only the first step of a turn injects');
  assert.deepEqual((await run(1, 'other')).messages, [user], 'other sessions are untouched');
  const decision = await run(1);
  assert.equal(decision.messages.length, 2);
  assert.equal(decision.messages[0], user, 'the user message is untouched');
  const injected = decision.messages[1];
  assert.equal(injected.role, 'user');
  assert.deepEqual({ kind: injected.source.kind, form: injected.source.form }, { kind: 'dsh-canvas', form: 'snapshot' });
  const text = injected.content[0].text;
  assert.match(text, /^<canvas_context canvas=".*main\.dshcanvas" name="main" cards="2">/);
  assert.match(text, /<card id="r" type="image" x="110" y="120" w="300" h="200" group="情绪板" path=".*ref\.png" model="seedream">a &lt;cute&gt; chick &amp; "sprout"<\/card>/);
  assert.match(text, /<card id="n" type="text"[^>]*>主角<\/card>/);
  assert.match(text, /<\/canvas_context>$/);
  assert.deepEqual(injected.content.slice(1).map((b) => b.type), ['text', 'image'], 'the selected image follows, tagged');
  assert.equal(injected.content[1].text, '<canvas_image id="r"/>');
  assert.deepEqual((await run(1)).messages, [user], 'consumed after one turn');
  await m.call('POST', '/api/canvas/attach', { body: { sessionId: 's1', path: canvas, ids: ['r'] } });
  await m.call('POST', '/api/canvas/attach', { body: { sessionId: 's1', ids: [] } });
  assert.deepEqual((await run(1)).messages, [user], 'removing the chip cancels it');
});

test('media nodes generate in place: an image edits itself, a video node gets its video as a version', async (t) => {
  const { cwd, canvas } = await workspace();
  const ark = fakeArk({ taskStates: ['succeeded'] });
  t.mock.method(globalThis, 'fetch', ark.fetch);
  const m = mount();
  const exec = m.exec(cwd);
  // The agent adds an imported image, an empty image node wired to it, and an empty video node, and runs both.
  const out = await m.tools.get('canvas_edit').execute({ canvas: 'canvas/main.dshcanvas', ops: [
    { op: 'add_image', path: 'ref.png', x: 0, y: 0 },
    { op: 'add_image', prompt: '同一角色，水彩', references: ['$0'], x: 400, y: 0 },
    { op: 'add_video', prompt: '缓缓推进', first_frame: '$0', x: 800, y: 0 },
    { op: 'run', id: '$1' }, { op: 'run', id: '$2' },
  ] }, exec);
  assert.match(out.text, /已开始生成/);
  const final = await until(async () => {
    const d = (await (await m.call('GET', '/api/canvas/doc', { query: { path: canvas } })).json()).doc;
    return d.nodes.every((n) => n.data.path) && d.runs[d.nodes[1].id]?.status === 'done' && d;
  }, 6000);
  assert.equal(final.nodes.length, 3, 'results land in the nodes themselves');
  const [ref, image, video] = final.nodes;
  assert.equal(image.data.meta.prompt, '同一角色，水彩');
  assert.deepEqual(image.data.meta.refs, [ref.id]);
  assert.match(video.data.path, /\.mp4$/);
  const create = ark.calls.find((c) => c.url.endsWith('/contents/generations/tasks'));
  assert.deepEqual(create.body.content.map((c) => c.role ?? c.type), ['text', 'first_frame']);

  // Running the finished image again edits it: its own picture is the first reference, the result is version 2.
  const before = ark.calls.filter((c) => c.url.endsWith('/images/generations')).length;
  await m.call('POST', '/api/canvas/generate', { body: { path: canvas, nodeId: image.id, mode: 'image', patch: { prompt: '加上雪' } } });
  const again = await until(async () => {
    const d = (await (await m.call('GET', '/api/canvas/doc', { query: { path: canvas } })).json()).doc;
    return D.versionsOf(d.nodes[1]).length === 2 && d;
  });
  const calls = ark.calls.filter((c) => c.url.endsWith('/images/generations'));
  assert.equal(calls.length, before + 1);
  assert.ok(Array.isArray(calls.at(-1).body.image) && calls.at(-1).body.image.length === 2, 'self plus the wired reference');
  assert.equal(again.nodes[1].data.gen.prompt, '加上雪');

  // A video node only makes video.
  const wrong = await m.call('POST', '/api/canvas/generate', { body: { path: canvas, nodeId: video.id, mode: 'image' } });
  assert.equal(wrong.status, 400);
});

test('library: each generation commits its prompt version, outputs remember it, history keeps every run', async (t) => {
  const { cwd, canvas } = await workspace();
  const ark = fakeArk();
  t.mock.method(globalThis, 'fetch', ark.fetch);
  const m = mount();
  const json = async (res) => { const value = await res.json(); assert.ok(res.ok, JSON.stringify(value)); return value; };
  const lib = async () => (await json(await m.call('GET', '/api/canvas/library', { query: { path: canvas } }))).assets;
  const readDoc = async () => (await json(await m.call('GET', '/api/canvas/doc', { query: { path: canvas } }))).doc;

  // An import is a library asset.
  const bytes = await readFile(join(cwd, 'ref.png'));
  const imported = await json(await m.call('POST', '/api/canvas/import', { query: { path: canvas, name: 'ref.png' }, raw: new Blob([bytes]).stream() }));
  assert.match(imported.asset, /^i_/);
  assert.deepEqual([imported.naturalWidth, imported.naturalHeight], [300, 200]);

  let doc = D.addNodes(D.emptyDoc(), [
    { id: 'r', type: 'image', x: 0, y: 0, w: 300, h: 200, data: { path: imported.path, asset: imported.asset } },
    { id: 'm', type: 'image', x: 400, y: 0, w: 300, h: 300, data: { label: '橘猫', gen: { prompt: '一只橘猫', model: 'doubao-seedream-5-0-260128', ratio: '1:1', count: 1 } } },
  ]);
  doc = D.addEdge(doc, 'r', 'm', 'reference');
  await m.call('POST', '/api/canvas/save', { body: { path: canvas, doc, baseVersion: null } });
  const generate = async (prompt) => {
    const before = (await readDoc()).runs.m?.finishedAt ?? 0;
    await json(await m.call('POST', '/api/canvas/generate', { body: { path: canvas, nodeId: 'm', mode: 'image', ...(prompt ? { patch: { prompt } } : {}) } }));
    return until(async () => { const d = await readDoc(); return (d.runs.m?.finishedAt ?? 0) > before && d.runs.m.status === 'done' && d; });
  };

  doc = await generate();
  let assets = await lib();
  const prompt = assets.find((a) => a.kind === 'prompt');
  assert.equal(prompt.latest.text, '一只橘猫');
  assert.equal(prompt.name, '橘猫', 'a new prompt is named after the node');
  let node = doc.nodes.find((n) => n.id === 'm');
  assert.deepEqual([node.data.gen.bind.id, node.data.gen.bind.v], [prompt.id, 1]);
  assert.match(node.data.asset, /^i_/);
  assert.equal(node.data.meta.promptRef, `${prompt.id}@1`);
  assert.deepEqual(doc.runs.m.source, { prompt: `${prompt.id}@1`, refs: [`${imported.asset}@1`] });

  // Edited prompt → version 2 of the same prompt; the result is version 2 of the node's image asset.
  doc = await generate('一只橘猫，雪夜');
  // The same text again → back on version 1, no duplicate version.
  doc = await generate('一只橘猫');
  assets = await lib();
  assert.equal(assets.filter((a) => a.kind === 'prompt').length, 1);
  assert.equal(assets.find((a) => a.id === prompt.id).count, 2);
  node = doc.nodes.find((n) => n.id === 'm');
  assert.equal(node.data.gen.bind.v, 1);
  const image = await json(await m.call('GET', '/api/canvas/library/asset', { query: { path: canvas, id: node.data.asset } }));
  assert.deepEqual(image.asset.versions.map((v) => v.source.prompt), [`${prompt.id}@1`, `${prompt.id}@2`, `${prompt.id}@1`]);
  assert.equal(image.asset.versions[1].source.refs[0], `${image.asset.id}@1`, 'the edit referenced the node\'s own first version first');
  assert.deepEqual(image.usedBy, ['main']);

  // The prompt's detail lists what each version produced.
  const detail = await json(await m.call('GET', '/api/canvas/library/asset', { query: { path: canvas, id: prompt.id } }));
  assert.deepEqual(Object.fromEntries(Object.entries(detail.outputs).map(([v, list]) => [v, list.map((o) => o.v)])), { 1: [1, 3], 2: [2] });

  // Labels, a hand-saved version with a note, rename.
  let res = await json(await m.call('POST', '/api/canvas/library/update', { body: { path: canvas, id: prompt.id, action: 'label', label: '定稿', v: 2 } }));
  assert.deepEqual(res.asset.labels, { 定稿: 2 });
  res = await json(await m.call('POST', '/api/canvas/library/update', { body: { path: canvas, id: prompt.id, action: 'commit', text: '一只橘猫，黄昏', note: '改成黄昏' } }));
  assert.deepEqual(res.asset.versions.at(-1), { ...res.asset.versions.at(-1), v: 3, text: '一只橘猫，黄昏', note: '改成黄昏' });
  res = await json(await m.call('POST', '/api/canvas/library/update', { body: { path: canvas, id: prompt.id, action: 'rename', name: '橘猫 · 主视觉' } }));
  assert.equal(res.asset.name, '橘猫 · 主视觉');

  const runs = (await json(await m.call('GET', '/api/canvas/history', { query: { path: canvas } }))).runs;
  assert.equal(runs.length, 3);
  assert.deepEqual(runs.map((r) => r.prompt), [`${prompt.id}@1`, `${prompt.id}@2`, `${prompt.id}@1`]);
  assert.ok(runs.every((r) => r.status === 'done' && r.outputs.length === 1 && r.canvas === 'main.dshcanvas'));
  const files = await readdir(join(cwd, 'canvas', 'library'));
  assert.equal(files.filter((f) => f.endsWith('.json')).length, 3, 'one file per asset: ref image, prompt, generated image');
});

test('library: a pasted link becomes an asset with its title and preview image', async (t) => {
  const { canvas } = await workspace();
  const page = '<html><head><title>fallback</title><meta property="og:title" content="雨夜 &amp; 霓虹 参考"><meta property="og:site_name" content="Example"><meta name="description" content="一段描述"><meta property="og:image" content="/cover.png"></head></html>';
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url) === 'https://example.com/ref') return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (String(url) === 'https://example.com/cover.png') return new Response(png(40, 20), { headers: { 'content-type': 'image/png' } });
    return new Response('no', { status: 404 });
  });
  const m = mount();
  const res = await m.call('POST', '/api/canvas/library/link', { body: { path: canvas, url: 'https://example.com/ref' } });
  const { asset } = await res.json();
  assert.equal(asset.kind, 'link');
  assert.equal(asset.name, '雨夜 & 霓虹 参考');
  assert.deepEqual({ ...asset.versions[0], at: 0, fetchedAt: 0 }, { v: 1, at: 0, fetchedAt: 0, url: 'https://example.com/ref', title: '雨夜 & 霓虹 参考', description: '一段描述', site: 'Example', image: asset.versions[0].image });
  assert.match(asset.versions[0].image, /^assets\/link-.*\.png$/);
  const bad = await m.call('POST', '/api/canvas/library/link', { body: { path: canvas, url: 'file:///etc/passwd' } });
  assert.equal(bad.status, 400);
});

test('library: media is saved under a production category, re-filed, cleared; bad categories are refused', async () => {
  const { cwd, canvas } = await workspace();
  const m = mount();
  const json = async (res) => { const value = await res.json(); assert.ok(res.ok, JSON.stringify(value)); return value; };
  const lib = async () => (await json(await m.call('GET', '/api/canvas/library', { query: { path: canvas } }))).assets;

  // A file the library has never seen (e.g. placed by the agent) becomes a new categorised asset.
  const saved = (await json(await m.call('POST', '/api/canvas/library/save', { body: { path: canvas, kind: 'image', mediaPath: 'assets/hero.png', name: '主角', category: 'character', naturalWidth: 300, naturalHeight: 200 } }))).asset;
  assert.match(saved.id, /^i_/);
  assert.equal(saved.category, 'character');
  assert.equal(saved.name, '主角');
  assert.deepEqual([saved.versions[0].path, saved.versions[0].naturalWidth], ['assets/hero.png', 300]);

  // Saving the same file again re-files the same asset without adding a version.
  const again = (await json(await m.call('POST', '/api/canvas/library/save', { body: { path: canvas, kind: 'image', asset: saved.id, mediaPath: 'assets/hero.png', category: 'style' } }))).asset;
  assert.equal(again.id, saved.id);
  assert.equal(again.versions.length, 1);
  assert.equal(again.category, 'style');
  // A new file shown by the same node becomes the asset's next version.
  const next = (await json(await m.call('POST', '/api/canvas/library/save', { body: { path: canvas, kind: 'image', asset: saved.id, mediaPath: 'assets/hero-2.png', category: 'style' } }))).asset;
  assert.deepEqual([next.id, next.versions.length], [saved.id, 2]);

  // The list carries the category; the update route re-files and clears it.
  assert.equal((await lib()).find((a) => a.id === saved.id).category, 'style');
  let res = await json(await m.call('POST', '/api/canvas/library/update', { body: { path: canvas, id: saved.id, action: 'category', category: 'scene' } }));
  assert.equal(res.asset.category, 'scene');
  res = await json(await m.call('POST', '/api/canvas/library/update', { body: { path: canvas, id: saved.id, action: 'category', category: null } }));
  assert.equal(res.asset.category, undefined);
  assert.equal((await lib()).find((a) => a.id === saved.id).category, undefined);

  // Unknown categories and non-media kinds are refused; nothing is written for them.
  assert.equal((await m.call('POST', '/api/canvas/library/update', { body: { path: canvas, id: saved.id, action: 'category', category: 'monster' } })).status, 400);
  assert.equal((await m.call('POST', '/api/canvas/library/save', { body: { path: canvas, kind: 'image', mediaPath: 'assets/x.png', category: 'monster' } })).status, 400);
  assert.equal((await m.call('POST', '/api/canvas/library/save', { body: { path: canvas, kind: 'prompt', mediaPath: 'assets/x.png' } })).status, 400);
  assert.equal((await lib()).length, 1);

  // Asset files written before categories existed (and ones with a junk category) still load.
  const dir = join(cwd, 'canvas', 'library');
  await writeFile(join(dir, 'i_legacy01.json'), JSON.stringify({ id: 'i_legacy01', kind: 'image', name: 'old', versions: [{ v: 1, path: 'assets/old.png' }] }));
  await writeFile(join(dir, 'i_legacy02.json'), JSON.stringify({ id: 'i_legacy02', kind: 'image', name: 'odd', category: 'monster', versions: [{ v: 1, path: 'assets/odd.png' }] }));
  const all = await lib();
  assert.equal(all.length, 3);
  assert.ok(all.filter((a) => a.id.startsWith('i_legacy')).every((a) => a.category === undefined));
});

test('agent tools: canvas_edit files image/video nodes under a production category and re-files their library asset', async () => {
  const { cwd, canvas } = await workspace();
  const m = mount();
  const exec = m.exec(cwd);
  const json = async (res) => { const value = await res.json(); assert.ok(res.ok, JSON.stringify(value)); return value; };
  const read = async () => JSON.parse((await m.tools.get('canvas_read').execute({}, exec)).text).nodes;

  // A category given when adding; nodes without one (and notes) stay uncategorised.
  await m.tools.get('canvas_edit').execute({ ops: [
    { op: 'add_image', path: 'ref.png', category: 'character', x: 0, y: 0 },
    { op: 'add_image', prompt: '雨夜街道', category: 'scene', x: 400, y: 0 },
    { op: 'add_image', path: 'ref.png', x: 800, y: 0 },
    { op: 'add_text', text: 'note', x: 0, y: 400 },
  ] }, exec);
  let nodes = await read();
  assert.deepEqual(nodes.map((n) => n.category), ['character', 'scene', undefined, undefined]);

  // Two nodes bound to one library asset: re-filing either moves both, and the asset itself.
  const [hero, , twin] = nodes;
  const asset = (await json(await m.call('POST', '/api/canvas/library/save', { body: { path: canvas, kind: 'image', mediaPath: hero.path, category: 'character' } }))).asset;
  const { doc, version } = await json(await m.call('GET', '/api/canvas/doc', { query: { path: canvas } }));
  const bound = D.updateNode(D.updateNode(doc, hero.id, { data: { asset: asset.id } }), twin.id, { data: { asset: asset.id, category: 'character' } });
  await json(await m.call('POST', '/api/canvas/save', { body: { path: canvas, doc: bound, baseVersion: version } }));
  await m.tools.get('canvas_edit').execute({ ops: [{ op: 'update', id: hero.id, category: 'style' }] }, exec);
  nodes = await read();
  assert.deepEqual([nodes[0].category, nodes[2].category], ['style', 'style']);
  const lib = async () => (await json(await m.call('GET', '/api/canvas/library', { query: { path: canvas } }))).assets.find((a) => a.id === asset.id);
  assert.equal((await lib()).category, 'style');
  // "none" clears it everywhere.
  await m.tools.get('canvas_edit').execute({ ops: [{ op: 'update', id: twin.id, category: 'none' }] }, exec);
  nodes = await read();
  assert.deepEqual([nodes[0].category, nodes[2].category], [undefined, undefined]);
  assert.equal((await lib()).category, undefined);

  // Unknown categories and non-media nodes are refused, and the whole edit is dropped.
  await assert.rejects(m.tools.get('canvas_edit').execute({ ops: [{ op: 'update', id: nodes[1].id, category: 'monster' }] }, exec), /未知的资产分类：monster/);
  await assert.rejects(m.tools.get('canvas_edit').execute({ ops: [{ op: 'update', id: nodes[3].id, category: 'prop' }] }, exec), /只有图片\/视频节点/);
  await assert.rejects(m.tools.get('canvas_edit').execute({ ops: [{ op: 'add_text', text: 'x' }, { op: 'add_video', prompt: 'x', category: 'bogus' }] }, exec), /未知的资产分类/);
  assert.equal((await read()).length, 4);
  assert.equal((await read())[1].category, 'scene');
});
