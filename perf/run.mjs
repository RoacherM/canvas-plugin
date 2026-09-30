// Perf loop: bundle the real canvas from src, serve it, drive headless Chrome over CDP with real input
// events, and report React commit costs and frame gaps per interaction.
// Usage: node perf/run.mjs [images=0] [--json]
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';

const images = Number(process.argv[2] ?? 0);
const here = new URL('.', import.meta.url);
const bundle = (await build({
  entryPoints: [new URL('harness.jsx', here).pathname], bundle: true, write: false, format: 'iife', jsx: 'automatic',
  loader: { '.css': 'text' }, minify: true, define: { 'process.env.NODE_ENV': '"production"' },
  // The profiling build of react-dom, so the Profiler reports real commit durations in production mode.
  plugins: [{ name: 'profiling', setup(b) {
    b.onResolve({ filter: /^react-dom(\/client)?$/ }, () => ({ path: new URL('../node_modules/react-dom/profiling.js', here).pathname }));
  } }],
})).outputFiles[0].text;

// A 2048² noise PNG: the size Seedream returns, and expensive to decode like a real photo.
function noisePng(size) {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(body)); return Buffer.concat([l, body, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = randomBytes((size * 3 + 1) * size); for (let y = 0; y < size; y++) raw[y * (size * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 1 })), chunk('IEND', Buffer.alloc(0))]);
}
const png = images > 0 ? noisePng(2048) : null;
const html = readFileSync(new URL('harness.html', here));
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/bundle.js') return res.end(bundle);
  if (url.pathname.endsWith('/api/canvas/media')) { res.setHeader('content-type', 'image/png'); return res.end(png); }
  res.setHeader('content-type', 'text/html'); res.end(html);
}).listen(0);
const port = server.address().port;

const profile = mkdtempSync(join(tmpdir(), 'dshc-perf-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1200,800', '--no-first-run', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((resolve) => chrome.stderr.on('data', (d) => { const m = /ws:\/\/\S+/.exec(String(d)); if (m) resolve(m[0]); }));
const targets = await (await fetch(wsUrl.replace('ws://', 'http://').replace(/\/devtools.*/, '/json'))).json();
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let seq = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, (m) => (m.error ? reject(new Error(method + ': ' + m.error.message)) : resolve(m.result))); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => (await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/app/?images=${images}` });
for (let i = 0; i < 100 && !(await evaluate('!!document.querySelector(".dshc-topbar")')); i++) await sleep(100);
if (images > 0) for (let i = 0; i < 300 && !(await evaluate('[...document.images].every((i) => i.complete)')); i++) await sleep(100);
await sleep(800);

// Frame recorder + commit window around each scenario.
await evaluate(`window.__frames = []; (function loop(t) { window.__frames.push(t); requestAnimationFrame(loop); })(performance.now()); true`);
async function measure(name, action) {
  await evaluate('window.__commits.length = 0; window.__frames.length = 0; window.__imgAdds = 0; window.__req0 = window.__requests; true');
  await evaluate(`window.__mo?.disconnect(); window.__mo = new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeName === 'IMG' || n.querySelector?.('img')) window.__imgAdds++; }); window.__mo.observe(document.body, { childList: true, subtree: true }); true`);
  const t0 = Date.now();
  await action();
  await sleep(150);
  const r = await evaluate(`(() => {
    const c = window.__commits, f = window.__frames;
    const gaps = f.slice(1).map((t, i) => t - f[i]);
    return { commits: c.length, renderMs: +c.reduce((s, x) => s + x.actual, 0).toFixed(1), maxCommitMs: +Math.max(0, ...c.map((x) => x.actual)).toFixed(1),
      frames: f.length, longFrames: gaps.filter((g) => g > 50).length, worstFrameMs: +Math.max(0, ...gaps).toFixed(0), imgRemounts: window.__imgAdds, requests: window.__requests - window.__req0 };
  })()`);
  results.push({ scenario: name, ms: Date.now() - t0, ...r });
}
const results = [];
const center = async (sel) => evaluate(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 12 }; })()`);
const mouse = (type, x, y, extra = {}) => cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });

await measure('idle 3s', () => sleep(3000));
await measure('drag a card (60 moves)', async () => {
  const p = await evaluate(`(() => { const r = document.querySelector('.react-flow__node[data-id="g1"]').getBoundingClientRect(); return { x: r.x + r.width - 30, y: r.y + 6 }; })()`);
  await mouse('mousePressed', p.x, p.y);
  for (let i = 1; i <= 60; i++) { await mouse('mouseMoved', p.x + i * 4, p.y + i * 2); await sleep(8); }
  await mouse('mouseReleased', p.x + 240, p.y + 120);
  await sleep(900);   // debounced save
});
await measure('drag a note by its grip (60 moves)', async () => {
  const p = await center('.react-flow__node[data-id="t1"] .dshc-grip');
  await mouse('mousePressed', p.x, p.y - 6);
  for (let i = 1; i <= 60; i++) { await mouse('mouseMoved', p.x + i * 4, p.y - 6 + i * 2); await sleep(8); }
  await mouse('mouseReleased', p.x + 240, p.y + 114);
  await sleep(900);
});
await measure('type 30 chars in a prompt', async () => {
  const p = await center('.react-flow__node[data-id="g2"] .dshc-prompt');
  await mouse('mousePressed', p.x, p.y + 20); await mouse('mouseReleased', p.x, p.y + 20);
  for (const ch of 'a cat walking on the moon, 4k.') { await cdp('Input.insertText', { text: ch }); await sleep(30); }
  await sleep(1000);
});
await measure('pan with trackpad (40 wheel events)', async () => {
  for (let i = 0; i < 40; i++) { await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 900, y: 600, deltaX: 20, deltaY: 15 }); await sleep(12); }
});
await measure('pinch zoom (30 ctrl+wheel)', async () => {
  for (let i = 0; i < 30; i++) { await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 900, y: 600, deltaX: 0, deltaY: i < 15 ? 8 : -8, modifiers: 2 }); await sleep(12); }
});
await measure('DSH re-renders the tab 20× (e.g. while the agent streams)', async () => {
  for (let i = 0; i < 20; i++) { await evaluate('window.__renderTab(); true'); await sleep(16); }
});
await measure('agent edits the file (poll picks it up)', async () => { await evaluate('window.__external(); true'); await sleep(2000); });

ws.close(); chrome.kill(); server.close();
if (process.argv.includes('--json')) console.log(JSON.stringify(results));
else console.table(results);
// --check: fail when an interaction drops frames, remounts images, or a drag does not move anything.
if (process.argv.includes('--check')) {
  const bad = results.filter((r) => r.longFrames > 0 || r.imgRemounts > 0 || (r.scenario.startsWith('drag') && r.commits < 30));
  for (const r of bad) console.error('FAIL', r.scenario, JSON.stringify(r));
  process.exitCode = bad.length > 0 ? 1 : 0;
}
