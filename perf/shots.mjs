// Screenshots of the real canvas in headless Chrome: node perf/shots.mjs [outDir]
// Serves perf/shots.jsx with media from ../canvas/assets and saves PNGs of a few states.
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const here = new URL('.', import.meta.url);
const out = process.argv[2] ?? new URL('shots/', here).pathname;
mkdirSync(out, { recursive: true });
const bundle = (await build({
  entryPoints: [new URL('shots.jsx', here).pathname], bundle: true, write: false, format: 'iife', jsx: 'automatic',
  loader: { '.css': 'text' }, minify: true, define: { 'process.env.NODE_ENV': '"production"' },
})).outputFiles[0].text;
const assets = new URL('../../canvas/assets/', here).pathname;
const html = readFileSync(new URL('harness.html', here), 'utf8').replace('--dsw-alias-label-primary:#111', '--dsw-alias-label-primary:#f2f2f2');
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/bundle.js') return res.end(bundle);
  if (url.pathname.endsWith('/api/canvas/media')) {
    const file = basename(url.searchParams.get('path') ?? '');
    try { res.setHeader('content-type', /\.png$/.test(file) ? 'image/png' : 'image/jpeg'); return res.end(readFileSync(join(assets, file))); } catch { res.statusCode = 404; return res.end(); }
  }
  res.setHeader('content-type', 'text/html'); res.end(html);
}).listen(0);
const port = server.address().port;

const W = 1280, H = 820;
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'dshc-shots-'))}`, `--window-size=${W},${H}`, '--hide-scrollbars', '--no-first-run', 'about:blank',
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
await cdp('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false });

async function open(query) {
  await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/app/?${query}` });
  for (let i = 0; i < 100 && !(await evaluate('!!document.querySelector(".dshc-topbar")')); i++) await sleep(100);
  for (let i = 0; i < 100 && !(await evaluate('[...document.images].every((i) => i.complete)')); i++) await sleep(100);
  await sleep(500);
}
const mouse = (type, x, y, extra = {}) => cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });
async function clickAt(x, y, count = 1) {
  await mouse('mouseMoved', x, y, { buttons: 0 });
  for (let n = 1; n <= count; n++) { await mouse('mousePressed', x, y, { clickCount: n }); await mouse('mouseReleased', x, y, { clickCount: n }); }
  await sleep(400);
}
const centerOf = (sel) => evaluate(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
async function shot(name) {
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(out, name + '.png'), Buffer.from(data, 'base64'));
  console.log('saved', join(out, name + '.png'));
}

// Layout facts for review without eyes: boxes, overlaps with the node title, what is off screen, applied colors.
async function report(label) {
  const r = await evaluate(`(() => {
    const box = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
    const q = (s) => document.querySelector(s);
    const cs = (s, p) => q(s) && getComputedStyle(q(s))[p];
    const sel = q('.react-flow__node.selected');
    const overlap = (a, b) => a && b && !(a[0] + a[2] <= b[0] || b[0] + b[2] <= a[0] || a[1] + a[3] <= b[1] || b[1] + b[3] <= a[1]);
    const title = box(sel?.querySelector('.dshc-node-title')), bar = box(q('.dshc-nodebar')), panel = box(q('.dshc-panel'));
    const off = [...document.querySelectorAll('.dshc-float, .dshc-menu')].map((el) => [el.className.split(' ')[0], box(el)]).filter(([, b]) => b[2] > 0 && (b[0] < 0 || b[1] < 0 || b[0] + b[2] > innerWidth + 1 || b[1] + b[3] > innerHeight));
    return {
      root: q('.dshc-root').className, bg: cs('.react-flow', 'backgroundColor'), nodeBg: cs('.dshc-card', 'backgroundColor'), nodeBorder: cs('.dshc-card', 'borderColor'),
      topbar: box(q('.dshc-topbar')), actions: box(q('.dshc-actions')), dock: box(q('.dshc-dock')), controls: box(q('.dshc-controls')), menu: box(q('.dshc-menu')), drawer: box(q('.dshc-drawer')), cards: document.querySelectorAll('.dshc-lib-card').length, versions: document.querySelectorAll('.dshc-lib-version').length,
      selected: sel?.dataset.id, node: box(sel), title, bar, panel, barOverTitle: overlap(bar, title), panelOverNode: overlap(panel, box(sel)),
      handles: [...(sel?.querySelectorAll('.dshc-handle:not(.dshc-handle-in)') ?? [])].map((h) => [h.dataset.handleid, getComputedStyle(h).opacity, box(h)]),
      offscreen: off, sendBg: cs('.dshc-send', 'backgroundColor'), fonts: cs('.dshc-root', 'fontFamily')?.slice(0, 40),
    };
  })()`);
  console.log(label, JSON.stringify(r));
}

await open('theme=dark');
await shot('1-dark-board');
await report('board');
let p = await centerOf('.react-flow__node[data-id="a"] img');
await clickAt(p.x, p.y);
await shot('2-dark-selected-image');
await report('image');
p = await centerOf('.react-flow__node[data-id="v"]');
await clickAt(p.x, p.y);
await shot('3-dark-selected-video');
await report('video');
await clickAt(1100, 700, 2);
await shot('4-dark-add-menu');
await report('menu');
await open('theme=light');
p = await centerOf('.react-flow__node[data-id="a"] img');
await clickAt(p.x, p.y);
await shot('5-light-selected-image');
await report('light');
await open('theme=dark&empty=1');
await shot('6-dark-empty');

const clickSel = async (sel) => { const c = await centerOf(sel); await clickAt(c.x, c.y); };
await open('theme=dark');
await clickSel('[aria-label="素材库"]');
await sleep(400);
await shot('8-library-list');
await report('library');
await clickSel('.dshc-lib-card.kind-prompt');
await sleep(500);
await shot('9-library-prompt-versions');
await report('library-detail');
p = await centerOf('.react-flow__node[data-id="a"] img');
await clickAt(p.x, p.y);
await shot('10-bound-prompt-chip');
await cdp('Emulation.setDeviceMetricsOverride', { width: 560, height: 820, deviceScaleFactor: 2, mobile: false });
await open('theme=dark&zoom=0.55');
p = await centerOf('.react-flow__node[data-id="a"] img');
await clickAt(p.x, p.y);
await shot('7-narrow-selected-image');
await report('narrow');
await clickAt(520, 700, 2);
await report('narrow-menu');
await open('theme=dark&zoom=0.55');
await clickSel('[aria-label="素材库"]');
await sleep(400);
await shot('11-narrow-library');
await report('narrow-library');

ws.close(); chrome.kill(); server.close();

