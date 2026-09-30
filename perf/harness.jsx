// Perf harness: the real canvas (bundled from src) inside a React Profiler, with a stubbed Host.
import React, { Profiler } from 'react';
import { createRoot } from 'react-dom/client'; // resolved to react-dom/profiling by run.mjs
import { CanvasApp } from '../src/client/canvas/index.jsx';
import { format, zh } from '../src/client/shared.js';

const params = new URLSearchParams(location.search);
const N = Number(params.get('images') ?? 0);
const PATH = '/ws/canvas/perf.dshcanvas';
const now = Date.now();
const nodes = [
  { id: 'g1', type: 'generator', x: 74, y: 633, w: 340, h: 300, data: { mode: 'image', prompt: '', model: 'doubao-seedream-5-0-260128', ratio: 'auto', count: 1 }, updatedAt: now },
  { id: 'g2', type: 'generator', x: 128, y: 56, w: 340, h: 300, data: { mode: 'video', prompt: '', model: 'doubao-seedance-2-0-fast-260128', ratio: 'adaptive', duration: 5, resolution: '720p', generateAudio: true }, updatedAt: now },
  { id: 't1', type: 'text', x: 169, y: 358, w: 240, h: 120, data: { text: '' }, updatedAt: now },
];
for (let i = 0; i < N; i++) nodes.push({ id: 'i' + i, type: 'image', x: 520 + (i % 8) * 320, y: (i >> 3) * 320, w: 300, h: 300, data: { path: `assets/img${i}.png`, meta: { source: 'generated' } }, updatedAt: now });
let doc = { version: 1, createdAt: now, updatedAt: now, viewport: { x: 0, y: 0, zoom: 1 }, nodes, edges: [], runs: {}, removed: {} };
let version = 1;
const config = { configured: true, imageModels: [{ id: 'doubao-seedream-5-0-260128', label: 'Seedream 5.0' }], videoModels: [{ id: 'doubao-seedance-2-0-fast-260128', label: 'Seedance 2.0 fast', durations: [4, 15], resolutions: ['480p', '720p'] }], imageRatios: ['auto', '1:1'], videoRatios: ['adaptive', '16:9'], defaults: {} };
const json = (v) => new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } });
const realFetch = window.fetch.bind(window);
window.__requests = 0;
window.fetch = async (input, init = {}) => {
  const url = new URL(String(input), location.href);
  const name = url.pathname.replace(/^.*\/api\/canvas\//, '');
  if (!url.pathname.includes('/api/canvas/') || name === 'media') return realFetch(input, init);
  window.__requests++;
  if (name === 'doc') return json({ doc, version: String(version) });
  if (name === 'version') return json({ version: String(version) });
  if (name === 'save') { doc = JSON.parse(init.body).doc; return json({ version: String(++version), merged: false }); }
  if (name === 'config') return json(config);
  return json({ ok: true });
};
window.__external = () => { doc = { ...doc, nodes: doc.nodes.map((n) => (n.id === 't1' ? { ...n, x: n.x + 40, updatedAt: Date.now() } : n)) }; version++; };

localStorage.setItem('dsh-canvas:viewport:' + PATH, JSON.stringify({ x: 0, y: 0, zoom: 1 }));
window.__commits = [];
const onRender = (_id, phase, actual) => window.__commits.push({ phase, actual, at: performance.now() });
const root = createRoot(document.getElementById('root'));
// DSH re-renders the tab body on every slot-prop change; each render hands a fresh t and callbacks, as entry.jsx does.
window.__renderTab = () => {
  const t = (key, p) => format(zh[key] ?? key, p);
  root.render(
    <Profiler id="canvas" onRender={onRender}>
      <div style={{ width: 1200, height: 800 }}>
        <CanvasApp path={PATH} cwd="/ws" sessionId="s1" t={t} visible fullscreen={false}
          toggleFullscreen={() => {}} openFile={() => {}} useInput={(sel) => sel({ draft: '' })} inputActions={{ setDraft() {} }} />
      </div>
    </Profiler>,
  );
};
window.__renderTab();
