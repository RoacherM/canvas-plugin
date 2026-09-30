import React from 'react';
import {
  Background, BackgroundVariant, MiniMap, Panel, ReactFlow, ReactFlowProvider, applyNodeChanges, useReactFlow, useStore,
} from '@xyflow/react';
import flowCss from '@xyflow/react/dist/style.css';
import { addEdge, addNodes, canGenerate, fitSize, genOf, modeOf, newId, removeEdges, removeNodes, selectVersion, updateNode } from '../../shared/doc.js';
import { PKG, api, canvasName } from '../shared.js';
import { Icon, KIND_ICON } from './icons.jsx';
import { ASSET_MIME, LibraryDrawer } from './library.jsx';
import { CanvasContext, nodeTypes } from './nodes.jsx';
import { css } from './theme.js';
import { useCanvasDoc } from './useDoc.js';

let styled = false;
function ensureStyles() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  for (const [suffix, text] of [['flow.css', flowCss], ['canvas.css', css]]) {
    const tag = document.createElement('style');
    tag.dataset.plugin = PKG;
    tag.dataset.pluginCss = PKG + '/' + suffix;
    tag.textContent = text;
    document.head.appendChild(tag);
  }
}

const ROLE_LABEL = { first_frame: 'gen.first', last_frame: 'gen.last' };
const MEDIA = /^(image|video)\//;
const imageDims = (file) => (typeof createImageBitmap === 'function'
  ? createImageBitmap(file).then((bitmap) => { const size = { w: bitmap.width, h: bitmap.height }; bitmap.close?.(); return size; }).catch(() => undefined)
  : Promise.resolve(undefined));

const UI_KEY = 'dsh-canvas:ui';
const UI_DEFAULTS = { theme: 'auto', minimap: false, edges: true, snap: false, mode: 'hand' };

/** Canvas chrome preferences (theme, minimap, edges, snapping, drag mode), kept across canvases. */
function useUiPrefs() {
  const [prefs, setPrefs] = React.useState(() => { try { return { ...UI_DEFAULTS, ...JSON.parse(localStorage.getItem(UI_KEY) ?? '{}') }; } catch { return UI_DEFAULTS; } });
  const update = React.useCallback((patch) => setPrefs((current) => {
    const next = { ...current, ...patch };
    try { localStorage.setItem(UI_KEY, JSON.stringify(next)); } catch { /* storage full */ }
    return next;
  }), []);
  return [prefs, update];
}

/** Whether DSH around the canvas is dark: its primary label colour, read off a probe element, is light. */
function useHostDark(probe, ready) {
  const [dark, setDark] = React.useState(true);
  React.useEffect(() => {
    const read = () => {
      const match = probe.current && /rgba?\(([^)]+)\)/.exec(getComputedStyle(probe.current).color);
      if (!match) return;
      const [r, g, b] = match[1].split(',').map(Number);
      setDark((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5);
    };
    read();
    const observer = new MutationObserver(read);
    for (const el of [document.documentElement, document.body]) if (el) observer.observe(el, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-color-scheme'] });
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener?.('change', read);
    return () => { observer.disconnect(); media?.removeEventListener?.('change', read); };
  }, [probe, ready]);
  return dark;
}

const pointOf = (event) => (event.changedTouches?.[0] ?? event);

function Shortcuts({ t }) {
  const rows = [['dblclick', 'keys.dbl'], ['⌘ ↵', 'keys.gen'], ['⌫', 'keys.del'], ['⇧ / ⌘', 'keys.multi'], ['Space', 'keys.pan'], ['⌘ scroll', 'keys.zoom']];
  return (
    <div className="dshc-pop dshc-float" role="dialog" aria-label={t('keys.title')}>
      <h4>{t('keys.title')}</h4>
      <dl>{rows.map(([key, label]) => <React.Fragment key={label}><dt><kbd>{key === 'dblclick' ? t('keys.dblKey') : key}</kbd></dt><dd>{t(label)}</dd></React.Fragment>)}</dl>
    </div>
  );
}

function Settings({ t, onClose, onSaved }) {
  const [info, setInfo] = React.useState(null);
  const [key, setKey] = React.useState('');
  const [message, setMessage] = React.useState('');
  React.useEffect(() => { api.config().then(setInfo, (error) => setMessage(error.message)); }, []);
  const save = async (value) => {
    try { await api.setKey(value); setMessage(t('settings.saved')); setKey(''); const next = await api.config(); setInfo(next); onSaved(next); } catch (error) { setMessage(error.message); }
  };
  return (
    <div className="dshc-modal-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="dshc-modal dshc-float" role="dialog" aria-label={t('settings.title')} onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}>
        <h3>{t('settings.title')}</h3>
        <div className="status">{info ? (info.configured ? t('settings.configured', { source: info.source ?? '—' }) : t('settings.missing')) : '…'}</div>
        <input type="password" autoFocus value={key} onChange={(event) => setKey(event.target.value)} placeholder={t('settings.key')} aria-label={t('settings.key')}
          onKeyDown={(event) => { if (event.key === 'Enter' && key.trim()) save(key); }} />
        <p>{t('settings.help')}</p>
        <p>{t('settings.models')}</p>
        {message ? <div className="status">{message}</div> : null}
        <div className="row">
          {info?.configured && info.writable ? <button type="button" className="dshc-btn" onClick={() => save('')}>{t('settings.clear')}</button> : null}
          <button type="button" className="dshc-btn" onClick={onClose}>{t('settings.close')}</button>
          <button type="button" className="dshc-btn primary" disabled={!key.trim()} onClick={() => save(key)}>{t('settings.save')}</button>
        </div>
      </div>
    </div>
  );
}

function Board({ path, cwd, t, visible, fullscreen, toggleFullscreen, openFile, onAttach }) {
  const doc = useCanvasDoc(path, visible);
  const flow = useReactFlow();
  const wrapper = React.useRef(null);
  const fileInput = React.useRef(null);
  const [config, setConfig] = React.useState(null);
  const [nodes, setNodes] = React.useState([]);
  const [selection, setSelection] = React.useState([]);
  const [toast, setToast] = React.useState(null);
  const [settings, setSettings] = React.useState(false);
  const [dropping, setDropping] = React.useState(false);
  const [prefs, setPrefs] = useUiPrefs();
  const probe = React.useRef(null);
  const hostDark = useHostDark(probe, doc.status);
  const dark = prefs.theme === 'auto' ? hostDark : prefs.theme === 'dark';
  const [connecting, setConnecting] = React.useState(false);
  const [keys, setKeys] = React.useState(false);
  // The library drawer: null while closed; `focus` opens one asset's details.
  const [library, setLibrary] = React.useState(null);
  const zoom = useStore((state) => state.transform[2]);
  const draggingIds = React.useRef(new Set());
  const selectionRef = React.useRef(selection);
  selectionRef.current = selection;
  const viewportKey = 'dsh-canvas:viewport:' + path;
  const [initialViewport] = React.useState(() => { try { return JSON.parse(localStorage.getItem(viewportKey) ?? 'null'); } catch { return null; } });

  React.useEffect(() => { api.config().then(setConfig, () => {}); }, []);
  React.useEffect(() => {
    if (toast === null) return undefined;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  // React Flow's node list mirrors the document; positions of nodes mid-drag stay with React Flow.
  React.useEffect(() => {
    if (doc.doc === null) return;
    const selected = new Set(selectionRef.current);
    const incoming = new Map();
    for (const edge of doc.doc.edges) {
      if (edge.role === 'output') continue;
      const entry = incoming.get(edge.target) ?? { reference: 0, first_frame: false, last_frame: false };
      if (edge.role === 'reference') entry.reference += 1; else entry[edge.role] = true;
      incoming.set(edge.target, entry);
    }
    setNodes((previous) => {
      const old = new Map(previous.map((node) => [node.id, node]));
      return doc.doc.nodes.map((node) => {
        const current = old.get(node.id);
        const held = draggingIds.current.has(node.id) && current !== undefined;
        return {
          id: node.id, type: node.type,
          position: held ? current.position : { x: node.x, y: node.y },
          width: node.w, height: node.h,
          ...(node.parentId ? { parentId: node.parentId } : {}),
          ...(node.type === 'frame' ? { zIndex: -1 } : {}),
          data: { node, inputs: incoming.get(node.id), run: doc.doc.runs?.[node.id] },
          selected: selected.has(node.id),
        };
      });
    });
  }, [doc.doc]);

  const edges = React.useMemo(() => (doc.doc?.edges ?? []).map((edge) => ({
    id: edge.id, source: edge.source, target: edge.target,
    sourceHandle: 'out', targetHandle: edge.role === 'output' || edge.role === 'shot' ? 'in' : edge.role,
    className: 'role-' + edge.role, selectable: edge.role !== 'output' && edge.role !== 'shot',
    ...(ROLE_LABEL[edge.role] ? { label: t(ROLE_LABEL[edge.role]), labelBgPadding: [6, 3], labelBgBorderRadius: 6 } : {}),
    animated: edge.role !== 'output' && doc.doc.runs?.[edge.target]?.status === 'running',
    hidden: !prefs.edges,
  })), [doc.doc, t, prefs.edges]);

  // Tell the Host which canvas is open and what is selected: the agent tools default to it.
  React.useEffect(() => {
    if (!visible || !cwd) return undefined;
    const timer = setTimeout(() => { api.focus(path, cwd, selection).catch(() => {}); }, 300);
    return () => clearTimeout(timer);
  }, [visible, path, cwd, selection]);

  const center = () => {
    const rect = wrapper.current?.getBoundingClientRect();
    return rect ? flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }) : { x: 0, y: 0 };
  };

  const defaults = (mode) => (mode === 'video'
    ? { mode, prompt: '', model: config?.defaults?.videoModel, ratio: 'adaptive', duration: 5, resolution: '720p', generateAudio: true }
    : { mode, prompt: '', model: config?.defaults?.imageModel, ratio: 'auto', count: 1 });
  /** Parameters of an image/video node that generates itself. */
  const genDefaults = (mode, prompt = '') => { const { mode: _mode, ...gen } = defaults(mode); return { ...gen, prompt }; };
  const [menu, setMenu] = React.useState(null);

  const select = (ids) => { setSelection(ids); setNodes((current) => current.map((node) => ({ ...node, selected: ids.includes(node.id) }))); };

  /**
   * Add a node of a kind from the dock, the double-click menu or the empty-canvas guide, centred on `at`.
   * With `from` (a connection dragged out of an image into empty space) the node starts at `at` and takes that image as input.
   */
  const addKind = (kind, at = center(), from) => {
    const make = {
      image: () => ({ id: newId('i'), type: 'image', w: 320, h: 320, data: { gen: genDefaults('image') } }),
      video: () => ({ id: newId('v'), type: 'video', w: 400, h: 225, data: { gen: genDefaults('video') } }),
      script: () => ({ id: newId('s'), type: 'script', w: 760, h: 380, data: { title: t('script.title'), rows: [newRow(), newRow(), newRow()] } }),
      text: () => ({ id: newId('t'), type: 'text', w: 240, h: 120, data: { text: '' } }),
      frame: () => ({ id: newId('f'), type: 'frame', w: 800, h: 520, data: { label: t('frame.label') } }),
      generator: () => ({ id: newId('g'), type: 'generator', w: 340, h: 300, data: defaults('image') }),
    }[kind];
    if (make === undefined) return undefined;
    const node = make();
    const x = from ? at.x + 20 : at.x - node.w / 2;
    doc.change((d) => {
      const next = addNodes(d, [{ ...node, x: Math.round(x), y: Math.round(at.y - node.h / 2) }]);
      return from && canGenerate(node) ? addEdge(next, from, node.id, node.type === 'video' ? 'first_frame' : 'reference') : next;
    });
    select([node.id]);
    return node.id;
  };
  const newRow = () => ({ id: newId('r'), description: '', prompt: '', duration: 3 });

  const absoluteOf = (id) => flow.getInternalNode(id)?.internals.positionAbsolute ?? { x: 0, y: 0 };

  const nodeOf = (id) => doc.doc?.nodes.find((node) => node.id === id);
  /** Save the latest edits, then ask the Host to generate each node; results arrive through the file. */
  const startRuns = async (ids) => {
    await doc.settle();
    for (const id of ids) {
      const node = nodeOf(id) ?? { id, type: 'image', data: {} };
      try { await api.generate(path, id, modeOf(node)); } catch (error) {
        setToast(error.message);
        if (error.status === 412) { setSettings(true); return; }
      }
    }
  };
  const rowsOf = (d, scriptId) => { const node = d.nodes.find((candidate) => candidate.id === scriptId); return Array.isArray(node?.data.rows) ? node.data.rows : []; };
  const setRows = (scriptId, update) => doc.change((d) => updateNode(d, scriptId, { data: { rows: update(rowsOf(d, scriptId)) } }));

  const FINAL = '定稿';
  /** A library asset version as a new node at `at` (a prompt becomes an empty node bound to it). */
  const placeAsset = async (id, v, at = center()) => {
    let asset;
    try { ({ asset } = await api.asset(path, id)); } catch (error) { setToast(error.message); return; }
    const version = (v && asset.versions.find((candidate) => candidate.v === v)) || asset.versions.at(-1);
    let node;
    if (asset.kind === 'prompt') {
      const kind = /seedance/i.test(version.model ?? '') ? 'video' : 'image';
      node = { id: newId(kind === 'video' ? 'v' : 'i'), type: kind, w: kind === 'video' ? 400 : 320, h: kind === 'video' ? 225 : 320,
        data: { label: asset.name, gen: { ...genDefaults(kind, version.text), ...(version.model ? { model: version.model } : {}), bind: { id: asset.id, v: version.v, text: version.text, name: asset.name, at: Date.now() } } } };
    } else if (asset.kind === 'link') {
      node = { id: newId('l'), type: 'link', w: 300, h: version.image ? 250 : 130, data: { asset: asset.id, url: version.url, title: version.title, description: version.description, site: version.site, image: version.image } };
    } else {
      const video = asset.kind === 'video';
      const box = video ? { w: 400, h: 225 } : fitSize(version.naturalWidth, version.naturalHeight, 300);
      node = { id: newId(video ? 'v' : 'i'), type: asset.kind, ...box, data: {
        path: version.path, label: asset.name, asset: asset.id, naturalWidth: version.naturalWidth, naturalHeight: version.naturalHeight,
        ...(video ? { duration: version.duration, lastFrame: version.lastFrame, ratio: version.ratio, resolution: version.resolution } : {}),
        meta: { source: version.source ? 'generated' : 'imported', prompt: version.source?.text, promptRef: version.source?.prompt, model: version.source?.model },
      } };
    }
    doc.change((d) => addNodes(d, [{ ...node, x: Math.round(at.x - node.w / 2), y: Math.round(at.y - node.h / 2) }]));
    select([node.id]);
  };
  const applyTarget = () => (selection.length === 1 ? nodeOf(selection[0]) : undefined);
  /** Put a prompt version on the selected node (its text and the binding, so the next run continues that prompt). */
  const applyPrompt = (asset, version) => {
    const target = applyTarget();
    if (!target || !canGenerate(target)) { setToast(t('lib.needTarget')); return; }
    const bind = { id: asset.id, v: version.v, text: version.text, name: asset.name, at: Date.now() };
    doc.change((d) => updateNode(d, target.id, target.type === 'generator'
      ? { data: { prompt: version.text, bind } }
      : { data: { gen: { ...genDefaults(target.type), ...genOf(target), prompt: version.text, bind } } }));
    setToast(t('lib.applied', { v: version.v }));
  };
  /** Save a web link in the library and put its card on the canvas. */
  const addLink = async (url, at = center()) => {
    setToast(t('lib.linkAdding'));
    try {
      const { asset } = await api.createLink(path, url);
      await placeAsset(asset.id, asset.versions[0].v, at);
      setToast(null);
      return true;
    } catch (error) { setToast(error.message); return false; }
  };

  const canvas = React.useMemo(() => ({
    path, cwd, t, config, openFile,
    openLibrary: (id) => { setKeys(false); setMenu(null); setLibrary({ focus: id ? { id, n: Date.now() } : undefined }); },
    selectionCount: selection.length,
    change: doc.change,
    exists: (id) => nodeOf(id) !== undefined,
    runOf: (id) => doc.doc?.runs?.[id],
    focusNode: (id) => { select([id]); flow.fitView({ nodes: [{ id }], maxZoom: 1, padding: 0.4, duration: 300 }); },
    /** Commit the typed prompt, then generate. Works for generator nodes and for image/video nodes. */
    run: async (id, prompt) => {
      const node = nodeOf(id);
      if (!node) return;
      doc.change((d) => updateNode(d, id, node.type === 'generator' ? { data: { prompt } } : { data: { gen: { ...genOf(node), prompt } } }));
      await startRuns([id]);
    },
    setGen: (id, patch) => doc.change((d) => {
      const node = d.nodes.find((candidate) => candidate.id === id);
      return node ? updateNode(d, id, { data: { gen: { ...genDefaults(node.type), ...genOf(node), ...patch } } }) : d;
    }),
    selectVersion: (id, index) => doc.change((d) => selectVersion(d, id, index)),
    /** A preset edit: a new image node beside `sourceId`, referencing it, generated right away. */
    derive: async (sourceId, prompt) => {
      const source = nodeOf(sourceId);
      if (!source) return;
      const at = absoluteOf(sourceId);
      const id = newId('i');
      doc.change((d) => addEdge(addNodes(d, [{ id, type: 'image', x: at.x + source.w + 80, y: at.y, w: source.w, h: source.h, data: { gen: genDefaults('image', prompt) } }]), sourceId, id, 'reference'));
      select([id]);
      await startRuns([id]);
    },
    addRow: (scriptId) => setRows(scriptId, (rows) => [...rows, newRow()]),
    removeRow: (scriptId, rowId) => setRows(scriptId, (rows) => rows.filter((row) => row.id !== rowId)),
    updateRow: (scriptId, rowId, patch) => setRows(scriptId, (rows) => rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row))),
    /** Make the shot images of storyboard rows: one image node per row in a grid right of the table. */
    shoot: async (scriptId, rowIds) => {
      const script = nodeOf(scriptId);
      if (!script || rowIds.length === 0) return;
      const at = absoluteOf(scriptId);
      const rows = rowsOf(doc.doc, scriptId);
      const made = [];
      for (const rowId of rowIds) {
        const index = rows.findIndex((row) => row.id === rowId);
        const row = rows[index];
        if (!row) continue;
        const col = index % 3, line = Math.floor(index / 3);
        made.push({ rowId, node: { id: newId('i'), type: 'image', x: at.x + script.w + 80 + col * 300, y: at.y + line * 300, w: 260, h: 260,
          data: { label: t('script.shotLabel', { n: index + 1 }), gen: genDefaults('image', row.prompt || row.description) } } });
      }
      doc.change((d) => {
        let next = addNodes(d, made.map((entry) => entry.node));
        for (const entry of made) next = addEdge(next, scriptId, entry.node.id, 'shot');
        const byRow = new Map(made.map((entry) => [entry.rowId, entry.node.id]));
        return updateNode(next, scriptId, { data: { rows: rowsOf(next, scriptId).map((row) => (byRow.has(row.id) ? { ...row, imageId: byRow.get(row.id) } : row)) } });
      });
      await startRuns(made.map((entry) => entry.node.id));
    },
    /** An empty video node right of an image, with the image as its first frame. */
    spawnVideo: (sourceId) => {
      const source = nodeOf(sourceId);
      if (!source) return;
      const at = absoluteOf(sourceId);
      const id = newId('v');
      doc.change((d) => addEdge(addNodes(d, [{ id, type: 'video', x: at.x + source.w + 80, y: at.y, w: 400, h: 225, data: { gen: genDefaults('video') } }]), sourceId, id, 'first_frame'));
      select([id]);
    },
    /** Continue a video: its last frame becomes an image, first frame of a new empty video node. */
    continueVideo: (videoId) => {
      const video = nodeOf(videoId);
      if (!video?.data.lastFrame) return;
      const at = absoluteOf(videoId);
      const frameId = newId('i'), nextId = newId('v');
      const frameBox = fitSize(video.data.naturalWidth ?? 16, video.data.naturalHeight ?? 9, 240);
      doc.change((d) => addEdge(addNodes(d, [
        { id: frameId, type: 'image', x: at.x + video.w + 60, y: at.y, ...frameBox, data: { path: video.data.lastFrame, label: t('gen.last'), meta: { source: 'generated' } } },
        { id: nextId, type: 'video', x: at.x + video.w + 60 + frameBox.w + 80, y: at.y, w: video.w, h: video.h, data: { gen: { ...genDefaults('video'), model: video.data.meta?.model ?? genOf(video).model } } },
      ]), frameId, nextId, 'first_frame'));
      select([nextId]);
    },
  }), [path, cwd, t, config, openFile, doc.change, doc.settle, doc.doc, selection.length]);

  const onNodesChange = React.useCallback((changes) => {
    setNodes((current) => {
      const next = applyNodeChanges(changes, current);
      if (changes.some((change) => change.type === 'select')) {
        const ids = next.filter((node) => node.selected).map((node) => node.id);
        setSelection((previous) => (previous.length === ids.length && previous.every((id, i) => id === ids[i]) ? previous : ids));
      }
      return next;
    });
    const removed = changes.filter((change) => change.type === 'remove').map((change) => change.id);
    if (removed.length > 0) doc.change((d) => removeNodes(d, removed));
  }, [doc.change]);

  const onNodeDragStart = React.useCallback((_event, _node, dragged) => { for (const node of dragged) draggingIds.current.add(node.id); }, []);

  /** Commit moved nodes; dropping a card into a frame adopts it, dragging it out releases it. */
  const onNodeDragStop = React.useCallback((_event, _node, dragged) => {
    const moves = dragged.map((node) => {
      const abs = flow.getInternalNode(node.id)?.internals.positionAbsolute ?? node.position;
      if (node.type === 'frame') return { id: node.id, x: node.position.x, y: node.position.y, parentId: node.parentId };
      const cx = abs.x + (node.width ?? node.measured?.width ?? 0) / 2, cy = abs.y + (node.height ?? node.measured?.height ?? 0) / 2;
      const frames = flow.getNodes().filter((candidate) => candidate.type === 'frame' && candidate.id !== node.id && !dragged.some((d) => d.id === candidate.id))
        .map((frame) => ({ frame, abs: flow.getInternalNode(frame.id)?.internals.positionAbsolute ?? frame.position }))
        .filter(({ frame, abs: f }) => cx >= f.x && cx <= f.x + (frame.width ?? 0) && cy >= f.y && cy <= f.y + (frame.height ?? 0))
        .sort((a, b) => (a.frame.width * a.frame.height) - (b.frame.width * b.frame.height));
      const target = frames[0];
      if (target && target.frame.id !== node.parentId) return { id: node.id, x: abs.x - target.abs.x, y: abs.y - target.abs.y, parentId: target.frame.id };
      if (!target && node.parentId) return { id: node.id, x: abs.x, y: abs.y, parentId: undefined };
      return { id: node.id, x: node.position.x, y: node.position.y, parentId: node.parentId };
    });
    doc.change((d) => moves.reduce((next, move) => updateNode(next, move.id, { x: Math.round(move.x), y: Math.round(move.y), parentId: move.parentId }), d));
    for (const node of dragged) draggingIds.current.delete(node.id);
  }, [flow, doc.change]);

  const onEdgesChange = React.useCallback((changes) => {
    const removed = changes.filter((change) => change.type === 'remove').map((change) => change.id);
    if (removed.length > 0) doc.change((d) => removeEdges(d, removed));
  }, [doc.change]);

  const isValidConnection = React.useCallback((connection) => {
    const source = flow.getNode(connection.source), target = flow.getNode(connection.target);
    return source?.type === 'image' && source.id !== target?.id && canGenerate(target);
  }, [flow]);

  const onConnect = React.useCallback((connection) => {
    doc.change((d) => addEdge(d, connection.source, connection.target, connection.targetHandle || 'reference'));
  }, [doc.change]);

  /** Opens the add menu at a screen point; `extra` carries the dock anchor or the node a connection came from. */
  const openMenu = (clientX, clientY, extra = {}) => {
    const rect = wrapper.current.getBoundingClientRect();
    setKeys(false);
    const height = extra.from ? 150 : 380;
    setMenu({ left: Math.max(8, Math.min(clientX - rect.left, rect.width - 256)), top: Math.max(8, Math.min(clientY - rect.top, rect.height - height - 8)),
      at: flow.screenToFlowPosition({ x: clientX, y: clientY }), ...extra });
  };
  const onConnectStart = React.useCallback(() => { setConnecting(true); setMenu(null); }, []);
  // A connection dropped on empty canvas asks what to make from the image (LibTV's "+" handle).
  const onConnectEnd = React.useCallback((event, state) => {
    setConnecting(false);
    if (state?.isValid || state?.toNode || state?.fromNode?.type !== 'image' || state?.fromHandle?.type !== 'source') return;
    const point = pointOf(event);
    openMenu(point.clientX, point.clientY, { from: state.fromNode.id });
  }, [flow]);

  const importFiles = async (files, at = center()) => {
    const media = [...files].filter((file) => MEDIA.test(file.type) || /\.(png|jpe?g|webp|gif|mp4|mov|webm|m4v)$/i.test(file.name));
    if (media.length === 0) return;
    setToast(t('import.progress', { n: media.length }));
    const added = [];
    for (const [index, file] of media.entries()) {
      try {
        const [measured, result] = await Promise.all([file.type.startsWith('video/') ? undefined : imageDims(file), api.importFile(path, file)]);
        const dims = measured ?? (result.naturalWidth ? { w: result.naturalWidth, h: result.naturalHeight } : undefined);
        const box = result.kind === 'video' ? { w: 400, h: 225 } : fitSize(dims?.w, dims?.h, 300);
        added.push({ id: newId(result.kind === 'video' ? 'v' : 'i'), type: result.kind, x: at.x + (index % 4) * 330, y: at.y + Math.floor(index / 4) * 340, ...box,
          data: { path: result.path, label: file.name, ...(result.asset ? { asset: result.asset } : {}), ...(dims ? { naturalWidth: dims.w, naturalHeight: dims.h } : {}), meta: { source: 'imported', createdAt: Date.now() } } });
      } catch (error) {
        setToast(t('import.failed', { error: error.message }));
      }
    }
    if (added.length > 0) { doc.change((d) => addNodes(d, added)); setToast(null); }
  };

  // Pasted images land at the canvas centre while the canvas is visible and hovered.
  const hovered = React.useRef(false);
  React.useEffect(() => {
    if (!visible) return undefined;
    const onPaste = (event) => {
      if (!hovered.current || /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '')) return;
      const files = [...(event.clipboardData?.files ?? [])];
      if (files.length > 0) { event.preventDefault(); importFiles(files); return; }
      const text = event.clipboardData?.getData('text/plain')?.trim() ?? '';
      if (/^https?:\/\/\S+$/i.test(text)) { event.preventDefault(); addLink(text); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  // Attach the selection as separate context for the next message; the user's draft is never touched.
  const attach = async () => {
    if (!onAttach || selection.length === 0) { setToast(t('send.none')); return; }
    try { await onAttach(path, selection); setToast(t('send.done', { n: selection.length })); } catch (error) { setToast(error.message); }
  };

  const saveLabel = { saved: t('save.saved'), saving: t('save.saving'), pending: t('save.pending'), merged: t('save.merged'), failed: t('save.failed', { error: doc.saveError ?? '' }) }[doc.save];

  if (doc.status === 'loading') return <div className="dshc-center">{t('loading')}</div>;
  if (doc.status === 'error') {
    return (
      <div className="dshc-center">
        <span className="dshc-error">{t('load.failed', { error: doc.error })}</span>
        <button type="button" className="dshc-btn" onClick={doc.reload}>{t('retry')}</button>
      </div>
    );
  }

  const kinds = menu?.from ? ['image', 'video'] : ['image', 'video', 'script', 'text', 'frame'];
  const menuStyle = menu?.anchor === 'dock' ? { left: '50%', bottom: 64, transform: 'translateX(-50%)' } : menu ? { left: menu.left, top: menu.top } : undefined;
  const closeFloats = () => { setMenu(null); setKeys(false); };

  return (
    <CanvasContext.Provider value={canvas}>
      <div
        ref={wrapper} className={'dshc-root ' + (dark ? 'dshc-dark' : 'dshc-light') + (dropping ? ' dshc-dropping' : '') + (connecting ? ' is-connecting' : '')} data-drop={t('drop.hint')}
        onPointerEnter={() => { hovered.current = true; }} onPointerLeave={() => { hovered.current = false; }}
        onKeyDown={(event) => { if (event.key === 'Escape') closeFloats(); }}
        onDragOver={(event) => {
          const types = [...event.dataTransfer.types];
          if (types.includes(ASSET_MIME)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }
          else if (types.includes('Files')) { event.preventDefault(); setDropping(true); }
        }}
        onDragLeave={(event) => { if (event.currentTarget === event.target) setDropping(false); }}
        onDoubleClick={(event) => { if (event.target.closest?.('.react-flow__pane')) openMenu(event.clientX, event.clientY); }}
        onDrop={(event) => {
          setDropping(false);
          const item = event.dataTransfer.getData(ASSET_MIME);
          if (item) {
            event.preventDefault();
            try { const { id, v } = JSON.parse(item); placeAsset(id, v, flow.screenToFlowPosition({ x: event.clientX, y: event.clientY })); } catch { /* not ours */ }
            return;
          }
          if (event.dataTransfer.files.length === 0) return;
          event.preventDefault();
          importFiles(event.dataTransfer.files, flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
        }}
      >
        <span ref={probe} aria-hidden="true" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', color: 'var(--dsw-alias-label-primary, #fff)' }} />
        <ReactFlow
          nodes={nodes} edges={edges} nodeTypes={nodeTypes} colorMode={dark ? 'dark' : 'light'}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} isValidConnection={isValidConnection}
          onConnectStart={onConnectStart} onConnectEnd={onConnectEnd}
          onNodeDragStart={onNodeDragStart} onNodeDragStop={onNodeDragStop}
          defaultViewport={initialViewport ?? undefined} fitView={initialViewport === null} fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
          onMoveEnd={(_event, viewport) => { try { localStorage.setItem(viewportKey, JSON.stringify(viewport)); } catch { /* storage full */ } }}
          minZoom={0.05} maxZoom={4} deleteKeyCode={['Backspace', 'Delete']} multiSelectionKeyCode={['Meta', 'Shift']} zoomOnDoubleClick={false}
          onPaneClick={closeFloats} onMoveStart={closeFloats}
          panOnScroll panOnScrollSpeed={1} selectionOnDrag={prefs.mode === 'select'} panOnDrag={prefs.mode === 'select' ? [1, 2] : true}
          snapToGrid={prefs.snap} snapGrid={[20, 20]} proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.3} />
          {prefs.minimap ? <MiniMap className="dshc-minimap" pannable zoomable position="bottom-left" nodeBorderRadius={4} nodeStrokeWidth={0} ariaLabel={t('ctl.minimap')} /> : null}
          <Panel position="top-left">
            <div className="dshc-topbar dshc-float">
              <span className="name" title={path}>{canvasName(path)}</span>
              <span className={'dshc-save ' + doc.save} title={saveLabel}><i />{saveLabel}</span>
            </div>
          </Panel>
          <Panel position="top-right">
            <div className="dshc-actions dshc-float">
              <button type="button" className="dshc-tbtn" onClick={attach} disabled={selection.length === 0 || !onAttach} title={selection.length === 0 ? t('send.none') : t('attach.hint')}>
                <Icon name="paperclip" size={15} /><span className="lbl">{t('send.selection')}</span>{selection.length ? <span className="count">{selection.length}</span> : null}
              </button>
              <span className="dshc-sep" />
              <button type="button" className="dshc-ibtn" onClick={() => setPrefs({ theme: dark ? 'light' : 'dark' })} aria-label={t(dark ? 'theme.toLight' : 'theme.toDark')} title={t(dark ? 'theme.toLight' : 'theme.toDark')}>
                <Icon name={dark ? 'sun' : 'moon'} size={16} />
              </button>
              <button type="button" className="dshc-ibtn" onClick={() => setSettings(true)} aria-label={t('settings')} title={config && !config.configured ? t('gen.noKey') : t('settings')}>
                <Icon name="settings" size={16} />{config && !config.configured ? <span className="dot" /> : null}
              </button>
              <button type="button" className="dshc-ibtn" aria-pressed={fullscreen} onClick={(event) => toggleFullscreen(event.currentTarget)} aria-label={t('fullscreen')} title={t('fullscreen')}>
                <Icon name="maximize" size={16} />
              </button>
            </div>
          </Panel>
          <Panel position="bottom-center">
            <div className="dshc-bottom">
              {toast ? <div className="dshc-toast dshc-float" role="status">{toast}</div> : null}
              <div className="dshc-dock dshc-float" style={{ position: 'relative' }}>
                <button type="button" className="dshc-ibtn add" aria-expanded={menu?.anchor === 'dock'} aria-label={t('menu.title')}
                  onClick={() => { setKeys(false); setMenu(menu?.anchor === 'dock' ? null : { anchor: 'dock', at: center() }); }}>
                  <Icon name="plus" size={16} /><span className="lbl">{t('menu.title')}</span>
                </button>
                <span className="dshc-sep" />
                <button type="button" className="dshc-ibtn" aria-pressed={prefs.mode === 'select'} onClick={() => setPrefs({ mode: 'select' })} aria-label={t('mode.select')} title={t('mode.select')}><Icon name="pointer" size={16} /></button>
                <button type="button" className="dshc-ibtn" aria-pressed={prefs.mode === 'hand'} onClick={() => setPrefs({ mode: 'hand' })} aria-label={t('mode.hand')} title={t('mode.hand')}><Icon name="hand" size={16} /></button>
                <span className="dshc-sep" />
                <button type="button" className="dshc-ibtn" aria-pressed={library !== null} onClick={() => (library ? setLibrary(null) : canvas.openLibrary())} aria-label={t('add.library')} title={t('add.library')}><Icon name="library" size={16} /></button>
                <button type="button" className="dshc-ibtn" onClick={() => fileInput.current?.click()} aria-label={t('add.import')} title={t('add.import')}><Icon name="upload" size={16} /></button>
                <button type="button" className="dshc-ibtn" aria-pressed={keys} onClick={() => { setMenu(null); setKeys(!keys); }} aria-label={t('keys.title')} title={t('keys.title')}><Icon name="keyboard" size={16} /></button>
                {keys ? <Shortcuts t={t} /> : null}
              </div>
            </div>
          </Panel>
          <Panel position="bottom-left">
            <div className="dshc-controls dshc-float">
              <button type="button" className="dshc-ibtn" aria-pressed={prefs.minimap} onClick={() => setPrefs({ minimap: !prefs.minimap })} aria-label={t('ctl.minimap')} title={t('ctl.minimap')}><Icon name="map" size={16} /></button>
              <button type="button" className="dshc-ibtn" aria-pressed={!prefs.edges} onClick={() => setPrefs({ edges: !prefs.edges })} aria-label={t('ctl.edges')} title={t('ctl.edges')}><Icon name="edges" size={16} /></button>
              <button type="button" className="dshc-ibtn" aria-pressed={prefs.snap} onClick={() => setPrefs({ snap: !prefs.snap })} aria-label={t('ctl.snap')} title={t('ctl.snap')}><Icon name="grid" size={16} /></button>
              <span className="dshc-sep" />
              <button type="button" className="dshc-ibtn" onClick={() => flow.zoomOut({ duration: 200 })} aria-label={t('ctl.zoomOut')} title={t('ctl.zoomOut')}><Icon name="minus" size={16} /></button>
              <button type="button" className="dshc-zoom" onClick={() => flow.zoomTo(1, { duration: 200 })} title={t('ctl.zoomReset')}>{Math.round(zoom * 100)}%</button>
              <button type="button" className="dshc-ibtn" onClick={() => flow.zoomIn({ duration: 200 })} aria-label={t('ctl.zoomIn')} title={t('ctl.zoomIn')}><Icon name="plus" size={16} /></button>
              <button type="button" className="dshc-ibtn" onClick={() => flow.fitView({ padding: 0.2, maxZoom: 1, duration: 300 })} aria-label={t('fit')} title={t('fit')}><Icon name="fit" size={16} /></button>
            </div>
          </Panel>
        </ReactFlow>
        {nodes.length === 0 ? (
          <div className="dshc-guide">
            <strong>{t('guide.dbl')}</strong>
            <span>{t('guide.free')}</span>
            <div className="chips">
              {['image', 'video', 'script', 'text'].map((kind) => <button key={kind} type="button" onClick={() => addKind(kind)}><Icon name={KIND_ICON[kind]} size={15} />{t('guide.' + kind)}</button>)}
              <button type="button" onClick={() => fileInput.current?.click()}><Icon name="upload" size={15} />{t('add.import')}</button>
            </div>
          </div>
        ) : null}
        <input ref={fileInput} type="file" multiple accept="image/*,video/*" hidden onChange={(event) => { importFiles(event.target.files); event.target.value = ''; }} />
        {menu ? (
          <div className="dshc-menu dshc-float" role="menu" style={menuStyle}>
            <div className="title">{t(menu.from ? 'menu.fromTitle' : 'menu.title')}</div>
            {kinds.map((kind, index) => (
              <button key={kind} type="button" role="menuitem" autoFocus={index === 0} onClick={() => { addKind(kind, menu.at, menu.from); setMenu(null); }}>
                <span className="ico"><Icon name={KIND_ICON[kind]} size={15} /></span><span className="label">{t('add.' + kind)}</span><small>{t('menu.' + kind)}</small>
              </button>
            ))}
            {menu.from ? null : (
              <>
                <div className="group">{t('menu.more')}</div>
                <button type="button" role="menuitem" onClick={() => { setMenu(null); fileInput.current?.click(); }}>
                  <span className="ico"><Icon name="upload" size={15} /></span><span className="label">{t('add.import')}</span><small>{t('menu.import')}</small>
                </button>
                <button type="button" role="menuitem" onClick={() => { addKind('generator', menu.at); setMenu(null); }}>
                  <span className="ico"><Icon name={KIND_ICON.generator} size={15} /></span><span className="label">{t('add.generator')}</span><small>{t('menu.generator')}</small>
                </button>
              </>
            )}
          </div>
        ) : null}
        {library ? (
          <LibraryDrawer t={t} canvasPath={path} refresh={doc.doc?.updatedAt} focus={library.focus} onClose={() => setLibrary(null)}
            actions={{ place: (id, v) => placeAsset(id, v), apply: applyPrompt, canApply: canGenerate(applyTarget()), addLink: (url) => addLink(url), toast: setToast, finalLabel: FINAL }} />
        ) : null}
        {settings ? <Settings t={t} onClose={() => setSettings(false)} onSaved={setConfig} /> : null}
      </div>
    </CanvasContext.Provider>
  );
}

export function CanvasApp(props) {
  ensureStyles();
  return <ReactFlowProvider><Board {...props} /></ReactFlowProvider>;
}
