/* global __dshRequire */
import React from 'react';
import {
  CANVAS_EXT, CANVAS_TOOLS, KIND, NS, PKG, api, baseName, canvasName, en, fileOfAddress, format, joinPath, relativeTo, sessionFileAddress, zh,
} from './shared.js';

// The canvas engine (React Flow + UI) is a separate chunk, fetched the first time a canvas opens.
const CanvasApp = React.lazy(async () => ({ default: (await __dshRequire.async('./client.canvas.js')).CanvasApp }));

const css = `
  .dshc-center { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; height:100%; padding:24px; color:var(--dsw-alias-label-secondary); font-size:13px; text-align:center; }
  .dshc-picker { display:flex; flex-direction:column; gap:14px; max-width:520px; margin:0 auto; padding:28px 20px; color:var(--dsw-alias-label-primary); font-size:13px; }
  .dshc-picker h2 { margin:0; font-size:16px; font-weight:600; }
  .dshc-picker p { margin:0; color:var(--dsw-alias-label-tertiary); line-height:1.5; }
  .dshc-list { display:flex; flex-direction:column; gap:6px; }
  .dshc-item { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:10px 12px; border:1px solid var(--dsw-alias-border-l2); border-radius:10px; background:var(--dsw-alias-bg-layer-1); color:inherit; font:inherit; text-align:left; cursor:pointer; }
  .dshc-item:hover { background:var(--dsw-alias-interactive-bg-hover); }
  .dshc-item small { color:var(--dsw-alias-label-tertiary); }
  .dshc-new { display:flex; gap:8px; }
  .dshc-new input { flex:1; min-width:0; padding:7px 10px; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; background:var(--dsw-alias-bg-layer-1); color:inherit; font:inherit; }
  .dshc-btn { padding:6px 12px; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); font:inherit; cursor:pointer; white-space:nowrap; }
  .dshc-btn:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); }
  .dshc-btn:disabled { opacity:.5; cursor:not-allowed; }
  .dshc-btn.primary { border-color:var(--dsw-alias-brand-primary); background:var(--dsw-alias-brand-primary); color:#fff; }
  .dshc-btn:focus-visible, .dshc-item:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:1px; }
  .dshc-error { color:var(--dsw-alias-state-error-primary); }
  .dshc-attach { display:flex; align-items:center; gap:8px; padding:6px 10px; border:1px solid var(--dsw-alias-border-l2); border-radius:10px; background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); font-size:12px; }
  .dshc-attach small { flex:1; min-width:0; overflow:hidden; color:var(--dsw-alias-label-tertiary); white-space:nowrap; text-overflow:ellipsis; }
  .dshc-attach button { border:none; background:transparent; color:var(--dsw-alias-label-secondary); font-size:14px; cursor:pointer; }
  .dshc-toolcard { display:flex; align-items:center; gap:8px; padding:4px 0; color:var(--dsw-alias-label-secondary); font-size:13px; }
  .dshc-toolcard b { color:var(--dsw-alias-label-primary); font-weight:500; }
  .dshc-toolcard .dshc-btn { padding:2px 10px; font-size:12px; }
  .dshc-toolcard .dshc-error { flex:1; }
`;

function useT(props, bound) {
  const t = typeof props.t === 'function' ? props.t : bound;
  return (key, params) => format(t(key), params);
}

/** Choose or create a canvas when the tab was opened from the guide rather than from a file. */
function CanvasPicker({ cwd, t, open }) {
  const [state, setState] = React.useState({ loading: true, canvases: [], error: null });
  const [name, setName] = React.useState('');
  React.useEffect(() => {
    if (!cwd) return undefined;
    let live = true;
    api.list(cwd).then(
      (result) => live && setState({ loading: false, canvases: result.canvases, error: null }),
      (error) => live && setState({ loading: false, canvases: [], error: error.message }),
    );
    return () => { live = false; };
  }, [cwd]);
  if (!cwd) return <div className="dshc-center">{t('picker.noWorkspace')}</div>;
  const create = () => {
    const clean = name.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\.dshcanvas$/i, '') || 'main';
    open(joinPath(cwd, 'canvas/' + clean + CANVAS_EXT));
  };
  return (
    <div className="dshc-picker">
      <h2>{t('picker.title')}</h2>
      <p>{t('picker.hint')}</p>
      {state.error ? <p className="dshc-error">{t('picker.loadFailed', { error: state.error })}</p> : null}
      <div className="dshc-list">
        {state.canvases.map((canvas) => (
          <button key={canvas.path} type="button" className="dshc-item" onClick={() => open(canvas.path)}>
            <span>{canvas.name}</span>
            <small>{t('picker.updated', { time: new Date(canvas.updatedAt).toLocaleString() })}</small>
          </button>
        ))}
        {!state.loading && state.canvases.length === 0 && !state.error ? <p>{t('picker.empty')}</p> : null}
      </div>
      <form className="dshc-new" onSubmit={(event) => { event.preventDefault(); create(); }}>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder={t('picker.namePlaceholder')} aria-label={t('picker.new')} />
        <button type="submit" className="dshc-btn primary">{state.canvases.length === 0 ? t('picker.create') : t('picker.new')}</button>
      </form>
    </div>
  );
}

class Boundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="dshc-center">
          <span className="dshc-error">{this.props.t('load.failed', { error: this.state.error.message })}</span>
          <button type="button" className="dshc-btn" onClick={() => this.setState({ error: null })}>{this.props.t('retry')}</button>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Per-session canvas attachments shown above the composer until the next message consumes them. */
const attachments = { bySession: new Map(), listeners: new Set() };
function setAttachment(sessionId, value) {
  if (value === undefined) attachments.bySession.delete(sessionId); else attachments.bySession.set(sessionId, value);
  attachments.listeners.forEach((listener) => listener());
}
const subscribeAttachments = (listener) => { attachments.listeners.add(listener); return () => attachments.listeners.delete(listener); };

export const inject = ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs'];

export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-canvas: dictionaries');
  const bound = ctx.locale.bind(NS);

  ctx.effect(() => {
    const tag = document.createElement('style');
    tag.dataset.plugin = PKG;
    tag.dataset.pluginCss = PKG + '/entry.css';
    tag.textContent = css;
    document.head.appendChild(tag);
    return () => tag.remove();
  }, 'dsh-canvas: styles');

  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: PKG, kind: KIND, patterns: ['*' + CANVAS_EXT], priority: 'extension', keepMounted: true,
    title: (address) => { const file = fileOfAddress(address); return file ? canvasName(file.path) : bound('type.label'); },
    guide: [{ id: 'open', order: 40, title: () => bound('guide.title'), description: () => bound('guide.description') }],
  }), 'dsh-canvas: tab type');

  function CanvasTab(props) {
    const t = useT(props, bound);
    const { tab, sidebar } = props.useTabInfo();
    const sessionId = props.sessionId;
    const cwd = props.useSessions((s) => (sessionId === undefined ? undefined : s.byId[sessionId]?.cwd));
    const file = fileOfAddress(tab.contentId);
    const path = file && cwd !== undefined ? joinPath(cwd, file.path) : file?.path;
    const openCanvas = (absolute) => tab.actions.openResource(sessionFileAddress(sessionId, relativeTo(cwd, absolute)), { replaceTab: true });
    if (!file) return <CanvasPicker cwd={cwd} t={t} open={openCanvas} />;
    if (!path || (!cwd && !path.startsWith('/'))) return <div className="dshc-center">{t('loading')}</div>;
    return (
      <Boundary t={t}>
        <React.Suspense fallback={<div className="dshc-center">{t('loading')}</div>}>
          <CanvasApp
            path={path} cwd={cwd} sessionId={sessionId} t={t} visible={tab.visible !== false}
            fullscreen={sidebar?.fullscreen === true}
            toggleFullscreen={(element) => {
              const target = ctx.sidebarRight.commandTarget(element);
              if (target !== undefined) ctx.sidebarRight.toggleFullscreen(target);
            }}
            openFile={(absolute) => ctx.sidebarRight.openResource(sessionFileAddress(sessionId, relativeTo(cwd, absolute)), { preferNewPane: true })}
            onAttach={async (canvas, ids) => {
              await api.attach(sessionId, canvas, ids);
              setAttachment(sessionId, { path: canvas, count: ids.length });
            }}
          />
        </React.Suspense>
      </Boundary>
    );
  }

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: PKG, locale: NS,
  }, CanvasTab)), 'dsh-canvas: tab body');

  // A chip above the composer for the pending attachment; the Host consumes it when the next turn starts.
  function AttachmentChip(props) {
    const t = useT(props, bound);
    const sessionId = props.sessionId;
    const value = React.useSyncExternalStore(subscribeAttachments, () => attachments.bySession.get(sessionId), () => undefined);
    const running = props.useSessionStatus((s) => (sessionId === undefined ? false : s.get(sessionId)?.running === true));
    React.useEffect(() => { if (running && value !== undefined) setAttachment(sessionId, undefined); }, [running]);
    if (value === undefined) return null;
    return (
      <div className="dshc-attach" title={t('attach.hint')}>
        <span>📎 {t('attach.chip', { name: canvasName(value.path), n: value.count })}</span>
        <small>{t('attach.hint')}</small>
        <button type="button" aria-label={t('attach.remove')} onClick={() => { api.attach(sessionId, value.path, []).catch(() => {}); setAttachment(sessionId, undefined); }}>×</button>
      </div>
    );
  }
  ctx.effect(() => ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock', id: 'dsh-canvas-attachment', order: 20, locale: NS, label: () => bound('type.label'),
  }, AttachmentChip)), 'dsh-canvas: attachment chip');

  // Chat cards for the agent's canvas tools: one line plus a jump to the canvas.
  function CanvasToolCard(props) {
    const t = useT(props, bound);
    const block = props.block ?? {};
    const result = props.phase === 'result' ? block : undefined;
    let canvas;
    for (const part of Array.isArray(result?.content) ? result.content : []) {
      const match = part?.type === 'text' && /(\/[^\s"'（）()]+\.dshcanvas)/.exec(part.text);
      if (match) { canvas = match[1]; break; }
    }
    const failed = result?.isError === true;
    const firstText = (result?.content ?? []).find((part) => part?.type === 'text')?.text ?? '';
    const summary = failed ? firstText.split('\n')[0] : props.toolName === 'canvas_read' ? '' : firstText.split('\n')[0];
    return (
      <div className="dshc-toolcard">
        <b>{props.toolName}</b>
        {props.phase !== 'result' ? <span>…</span> : <span className={failed ? 'dshc-error' : undefined}>{summary.replace(/^已更新画布 \S+/, '已更新画布').slice(0, 120)}</span>}
        {canvas ? (
          <button type="button" className="dshc-btn" onClick={() => ctx.sidebarRight.openResource(sessionFileAddress(props.sessionId, relativeTo(props.cwd, canvas)))}>
            {t('tool.open')} · {baseName(canvas)}
          </button>
        ) : null}
      </div>
    );
  }
  for (const toolName of CANVAS_TOOLS) {
    ctx.effect(() => ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
      name: 'tool.call.toolview', key: toolName, locale: NS,
    }, CanvasToolCard)), 'dsh-canvas: tool card ' + toolName);
  }
}
