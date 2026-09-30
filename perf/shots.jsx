// Screenshot harness: the real canvas (bundled from src) with a stubbed Host and a representative board.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { CanvasApp } from '../src/client/canvas/index.jsx';
import { format, zh } from '../src/client/shared.js';

const params = new URLSearchParams(location.search);
const PATH = '/ws/canvas/shots.dshcanvas';
const now = Date.now();
const img = (id, x, y, file, label, extra = {}) => ({ id, type: 'image', x, y, w: 260, h: 260, updatedAt: now,
  data: { path: 'assets/' + file, label, naturalWidth: 2048, naturalHeight: 2048, meta: { source: 'generated', prompt: label }, gen: { prompt: '', model: 'doubao-seedream-5-0-260128', ratio: 'auto', count: 1 }, ...extra } });
const nodes = params.get('empty') ? [] : [
  { ...img('chick', 0, 0, 'chick.png', 'chick.png', { naturalWidth: 1254, naturalHeight: 1254, meta: { source: 'imported' } }) },
  img('a', 360, -40, 'gen-1-mukuk8tfc8ba.jpeg', '角色 · 正面', {
    versions: [{ path: 'assets/gen-1-mukuk8tfc8ba.jpeg', naturalWidth: 2048, naturalHeight: 2048 }, { path: 'assets/gen-2-mukuk8tg5423.jpeg', naturalWidth: 2048, naturalHeight: 2048 }],
    shown: { path: 'assets/gen-1-mukuk8tfc8ba.jpeg', at: now }, asset: 'i_astro01', gen: { prompt: '同一只小鸡，穿上宇航服，站在月球表面', model: 'doubao-seedream-5-0-260128', ratio: '1:1', count: 1, bind: { id: 'p_chick01', v: 2, text: '同一只小鸡，穿上宇航服，站在月球表面', name: '小鸡 · 宇航员', at: now } } }),
  img('b', 360, 280, 'gen-3-mukuk8thf9cc.jpeg', '角色 · 侧面'),
  { id: 'v', type: 'video', x: 720, y: 60, w: 400, h: 225, updatedAt: now, data: { gen: { prompt: '', model: 'doubao-seedance-2-0-fast-260128', ratio: 'adaptive', duration: 5, resolution: '720p', generateAudio: true } } },
  { id: 's', type: 'script', x: 0, y: 620, w: 760, h: 300, updatedAt: now, data: { title: '雨夜 · 分镜', rows: [
    { id: 'r1', duration: 3, description: '雨夜十字路口，积水倒影', prompt: '低机位超广角，雨夜路口积水里的红绿灯倒影', imageId: 'b' },
    { id: 'r2', duration: 4, description: '车内后座，窗外霓虹', prompt: '车窗雨痕，蓝紫霓虹拉成光带' },
    { id: 'r3', duration: 3, description: '旧房间的书桌', prompt: '临窗书桌，未画完的植物标本' },
  ] } },
  { id: 't', type: 'text', x: 820, y: 360, w: 260, h: 120, updatedAt: now, data: { text: '主角：一只好奇的小鸡\n基调：低饱和、雨夜、电影感' } },
];
const edges = params.get('empty') ? [] : [
  { id: 'e1', source: 'chick', target: 'a', role: 'reference', updatedAt: now },
  { id: 'e2', source: 'a', target: 'v', role: 'first_frame', updatedAt: now },
  { id: 'e3', source: 's', target: 'b', role: 'shot', updatedAt: now },
];
const doc = { version: 1, createdAt: now, updatedAt: now, viewport: { x: 0, y: 0, zoom: 1 }, nodes, edges, runs: params.get('running') ? { b: { status: 'running', startedAt: now - 12000, updatedAt: now } } : {}, removed: {} };
const config = {
  configured: true,
  imageModels: [{ id: 'doubao-seedream-5-0-260128', label: 'Seedream 5.0' }],
  videoModels: [{ id: 'doubao-seedance-2-0-fast-260128', label: 'Seedance 2.0 fast', durations: [4, 15], resolutions: ['480p', '720p'] }],
  imageRatios: ['auto', '1:1', '16:9'], videoRatios: ['adaptive', '16:9'], defaults: {},
};
const H = 3600e3;
const P1 = '一只小鸡，穿上宇航服', P2 = '同一只小鸡，穿上宇航服，站在月球表面', P3 = '同一只小鸡，穿上宇航服，站在月球表面，身后是地球升起，电影感逆光';
const library = { assets: [
  { id: 'p_chick01', kind: 'prompt', name: '小鸡 · 宇航员', labels: { 定稿: 2 }, tags: [], count: 3, updatedAt: now, latest: { v: 3, at: now - 0.2 * H, text: P3 } },
  { id: 'i_astro01', kind: 'image', name: '小鸡 · 宇航员', labels: {}, tags: [], count: 2, updatedAt: now - H, latest: { v: 2, path: 'assets/gen-2-mukuk8tg5423.jpeg' } },
  { id: 'i_side01', kind: 'image', name: '角色 · 侧面', labels: { 定稿: 1 }, tags: [], count: 1, updatedAt: now - 2 * H, latest: { v: 1, path: 'assets/gen-3-mukuk8thf9cc.jpeg' } },
  { id: 'l_ref01', kind: 'link', name: '雨夜霓虹参考', labels: {}, tags: [], count: 1, updatedAt: now - 3 * H, latest: { v: 1, url: 'https://www.pinterest.com/pin/rainy-neon', title: '雨夜霓虹 · 电影感参考', site: 'Pinterest', image: 'assets/gen-1-mukust062d58.jpeg' } },
  { id: 'i_chick01', kind: 'image', name: 'chick.png', labels: {}, tags: [], count: 1, updatedAt: now - 5 * H, latest: { v: 1, path: 'assets/chick.png' } },
  { id: 'p_rain01', kind: 'prompt', name: '雨夜路口', labels: {}, tags: [], count: 1, updatedAt: now - 6 * H, latest: { v: 1, text: '低机位超广角，雨夜路口积水里的红绿灯倒影，蓝紫霓虹' } },
] };
const detail = { asset: { id: 'p_chick01', kind: 'prompt', name: '小鸡 · 宇航员', labels: { 定稿: 2 }, tags: [], versions: [
  { v: 1, at: now - 5 * H, text: P1, model: 'doubao-seedream-5-0-260128', params: { ratio: '1:1' } },
  { v: 2, at: now - 2 * H, text: P2, note: '加上月球表面', model: 'doubao-seedream-5-0-260128', params: { ratio: '1:1' } },
  { v: 3, at: now - 0.2 * H, text: P3, note: '加逆光和地球', model: 'doubao-seedream-5-0-260128', params: { ratio: '16:9' } },
] }, usedBy: ['shots', 'main'], outputs: {
  1: [{ id: 'i_astro01', v: 1, kind: 'image', name: 'x', path: 'assets/gen-1-mukuk8tfc8ba.jpeg' }],
  2: [{ id: 'i_astro01', v: 2, kind: 'image', name: 'x', path: 'assets/gen-2-mukuk8tg5423.jpeg' }, { id: 'i_side01', v: 1, kind: 'image', name: 'x', path: 'assets/gen-3-mukuk8thf9cc.jpeg' }],
} };
const json = (v) => new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = new URL(String(input), location.href);
  const name = url.pathname.replace(/^.*\/api\/canvas\//, '');
  if (!url.pathname.includes('/api/canvas/') || name === 'media') return realFetch(input, init);
  if (name === 'doc') return json({ doc, version: '1' });
  if (name === 'version') return json({ version: '1' });
  if (name === 'config') return json(config);
  if (name === 'library') return json(library);
  if (name === 'library/asset') return json(detail);
  if (name === 'history') return json({ runs: [] });
  return json({ ok: true, version: '1' });
};
localStorage.setItem('dsh-canvas:ui', JSON.stringify({ theme: params.get('theme') ?? 'dark' }));
localStorage.setItem('dsh-canvas:viewport:' + PATH, JSON.stringify({ x: 70, y: 110, zoom: Number(params.get('zoom') ?? 0.72) }));
const t = (key, p) => format(zh[key] ?? key, p);
createRoot(document.getElementById('root')).render(
  <div style={{ width: '100vw', height: '100vh' }}>
    <CanvasApp path={PATH} cwd="/ws" sessionId="s1" t={t} visible fullscreen={false} toggleFullscreen={() => {}} openFile={() => {}} onAttach={async () => {}} />
  </div>,
);
