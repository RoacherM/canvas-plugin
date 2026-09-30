import React from 'react';
import { Handle, NodeResizer, NodeToolbar, Position, useInternalNode, useStore } from '@xyflow/react';
import { ASSET_CATEGORIES, categoryOf, genOf, shownIndex, updateNode, versionsOf } from '../../shared/doc.js';
import { api, assetAbsolute, baseName } from '../shared.js';
import { Icon } from './icons.jsx';

export const CanvasContext = React.createContext(null);
const useCanvas = () => React.useContext(CanvasContext);

function commitSize(canvas, id) {
  return (_event, params) => canvas.change((doc) => updateNode(doc, id, { x: params.x, y: params.y, w: params.width, h: params.height }));
}

const Resizer = ({ canvas, id, selected, ...props }) => (
  <NodeResizer isVisible={selected} onResizeEnd={commitSize(canvas, id)} lineClassName="dshc-resize-line" handleClassName="dshc-resize-handle" {...props} />
);

/** Local edit buffer for a text field that commits after a pause and on blur. */
function useDraftField(value, commit, delay = 400) {
  const [draft, setDraft] = React.useState(value ?? '');
  const timer = React.useRef(null);
  const focused = React.useRef(false);
  React.useEffect(() => { if (!focused.current) setDraft(value ?? ''); }, [value]);
  React.useEffect(() => () => clearTimeout(timer.current), []);
  return {
    value: draft,
    onChange: (event) => {
      const next = event.target.value;
      setDraft(next);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => commit(next), delay);
    },
    onFocus: () => { focused.current = true; },
    onBlur: () => { focused.current = false; clearTimeout(timer.current); if (draft !== (value ?? '')) commit(draft); },
  };
}

function useElapsed(since, active) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return since ? Math.max(0, Math.round((now - since) / 1000)) : 0;
}

/** Status text of a run: elapsed time while running, the error after a failure. */
function useRunStatus(run, t) {
  const running = run.status === 'running';
  const elapsed = useElapsed(run.startedAt, running);
  if (running) return { running, text: t(run.taskStatus === 'queued' ? 'gen.queued' : 'gen.running', { s: elapsed }) };
  return { running, text: run.status === 'error' ? run.error : null };
}

/**
 * Horizontal shift (px) that keeps a bar of `width` px, centred under or over node `id`, inside the board.
 * Mounted only while the bar shows, so panning re-renders just the selected node's bars.
 */
function useKeepInView(id, width) {
  const node = useInternalNode(id);
  const [tx, zoom, boardWidth] = useStore((s) => [s.transform[0], s.transform[2], s.width], (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2]);
  if (!node || !boardWidth) return 0;
  const centre = node.internals.positionAbsolute.x * zoom + tx + ((node.measured?.width ?? node.width ?? 0) * zoom) / 2;
  const w = Math.min(width, boardWidth - 24);
  const left = centre - w / 2;
  if (left < 12) return Math.round(12 - left);
  if (left + w > boardWidth - 12) return Math.round(boardWidth - 12 - (left + w));
  return 0;
}

/** The node's name and facts, above the card (LibTV style). */
function NodeTitle({ icon, name, meta, generated, children }) {
  return (
    <div className="dshc-node-title">
      {icon ? <Icon name={icon} size={13} /> : null}
      {children ?? <span className="name">{name}</span>}
      {generated ? <span className="dshc-badge">AI</span> : null}
      {meta ? <span className="meta">{meta}</span> : null}
    </div>
  );
}

const dims = (d) => (d.naturalWidth > 0 && d.naturalHeight > 0 ? `${d.naturalWidth} × ${d.naturalHeight}` : '');

/** A select that looks like a rounded pill. */
function Pill({ label, value, onChange, children }) {
  return (
    <label className="dshc-pill">
      <select value={value} onChange={onChange} aria-label={label} title={label}>{children}</select>
      <Icon name="chevronDown" size={12} />
    </label>
  );
}

/** Model and parameter pills shared by generator nodes and the inline panel of media nodes. */
function GenFields({ mode, gen, set }) {
  const { t, config } = useCanvas();
  const video = mode === 'video';
  const models = (video ? config?.videoModels : config?.imageModels) ?? [];
  const model = models.find((m) => m.id === gen.model) ?? models[0];
  return (
    <div className="dshc-pills nodrag">
      <Pill label={t('gen.model')} value={model?.id ?? ''} onChange={(event) => set({ model: event.target.value })}>
        {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </Pill>
      <Pill label={t('gen.ratio')} value={gen.ratio ?? (video ? 'adaptive' : 'auto')} onChange={(event) => set({ ratio: event.target.value })}>
        {((video ? config?.videoRatios : config?.imageRatios) ?? []).map((r) => <option key={r} value={r}>{r === 'auto' || r === 'adaptive' ? t('gen.auto') : r}</option>)}
      </Pill>
      {video ? (
        <>
          <Pill label={t('gen.duration')} value={gen.duration ?? 5} onChange={(event) => set({ duration: Number(event.target.value) })}>
            {Array.from({ length: (model?.durations?.[1] ?? 12) - (model?.durations?.[0] ?? 4) + 1 }, (_, i) => (model?.durations?.[0] ?? 4) + i)
              .map((s) => <option key={s} value={s}>{t('gen.seconds', { n: s })}</option>)}
          </Pill>
          <Pill label={t('gen.resolution')} value={gen.resolution ?? '720p'} onChange={(event) => set({ resolution: event.target.value })}>
            {(model?.resolutions ?? ['720p']).map((r) => <option key={r} value={r}>{r}</option>)}
          </Pill>
          {/seedance-2/.test(model?.id ?? '') ? (
            <label className="dshc-pill check"><input type="checkbox" checked={gen.generateAudio !== false} onChange={(event) => set({ generateAudio: event.target.checked })} />{t('gen.audio')}</label>
          ) : null}
        </>
      ) : (
        <Pill label={t('gen.count')} value={gen.count ?? 1} onChange={(event) => set({ count: Number(event.target.value) })}>
          {[1, 2, 3, 4, 6, 8].map((c) => <option key={c} value={c}>{t('gen.countN', { n: c })}</option>)}
        </Pill>
      )}
    </div>
  );
}

function InputChips({ inputs, children }) {
  const { t } = useCanvas();
  return (
    <span className="dshc-chips">
      {children}
      {inputs?.reference > 0 ? <span className="dshc-chip">{t('gen.refs', { n: inputs.reference })}</span> : null}
      {inputs?.first_frame ? <span className="dshc-chip">{t('gen.first')}</span> : null}
      {inputs?.last_frame ? <span className="dshc-chip">{t('gen.last')}</span> : null}
    </span>
  );
}

function SendButton({ running, busy, onClick }) {
  const { t } = useCanvas();
  return (
    <button type="button" className="dshc-send" disabled={running || busy} onClick={onClick} aria-label={t('gen.run')} title={t('gen.runHint')}>
      {running || busy ? <span className="dshc-spin" /> : <Icon name="arrowUp" size={16} strokeWidth={2.2} />}
    </button>
  );
}

/**
 * The generation panel of an image or video node, shown under the node while it is selected:
 * the node is its own generator, and each result becomes a new version of it.
 */
function GenPanel(props) {
  return props.visible ? <GenPanelBody {...props} /> : null;
}

function GenPanelBody({ id, node, run, inputs }) {
  const canvas = useCanvas();
  const shift = useKeepInView(id, 480);
  const { t } = canvas;
  const mode = node.type;
  const gen = genOf(node);
  const status = useRunStatus(run, t);
  const set = (patch) => canvas.setGen(id, patch);
  const prompt = useDraftField(gen.prompt, (value) => set({ prompt: value }));
  const [busy, setBusy] = React.useState(false);
  const hasSelf = mode === 'image' && typeof node.data.path === 'string';
  const start = async () => {
    setBusy(true);
    try { await canvas.run(id, prompt.value); } finally { setBusy(false); }
  };
  return (
    <NodeToolbar isVisible position={Position.Bottom} offset={14} className="nodrag nowheel">
     <div className="dshc-panel dshc-float" style={shift ? { transform: `translateX(${shift}px)` } : undefined}>
      <div className="dshc-panel-top">
        <strong>{t(mode === 'video' ? 'panel.video' : hasSelf ? 'panel.edit' : 'panel.image')}</strong>
        <InputChips inputs={inputs}>
          <BindChip bind={gen.bind} draft={prompt.value} onUnbind={() => set({ bind: { at: Date.now() } })} />
          {hasSelf ? (
            <button type="button" className="dshc-chip" aria-pressed={gen.useSelf !== false} title={t('gen.useSelfHint')} onClick={() => set({ useSelf: gen.useSelf === false })}>
              <Icon name="image" size={11} />{t('gen.self')}
            </button>
          ) : null}
        </InputChips>
        <span className={'status' + (run.status === 'error' ? ' error' : '')} title={status.text ?? ''}>{status.text ?? ''}</span>
      </div>
      <textarea rows={3} placeholder={t(mode === 'video' ? 'gen.promptVideo' : hasSelf ? 'gen.promptEdit' : 'gen.prompt')} {...prompt}
        onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !status.running) { event.preventDefault(); start(); } }} />
      <div className="dshc-panel-bottom">
        <GenFields mode={mode} gen={gen} set={set} />
        <span className="dshc-hint">{t('gen.panelHint')}</span>
        <SendButton running={status.running} busy={busy} onClick={start} />
      </div>
     </div>
    </NodeToolbar>
  );
}

/** Which library prompt version the node generates from; "edited" when the draft differs from it. */
function BindChip({ bind, draft, onUnbind }) {
  const canvas = useCanvas();
  const { t } = canvas;
  if (!bind?.id) return null;
  const edited = typeof bind.text === 'string' && draft !== bind.text;
  return (
    <span className={'dshc-bind' + (edited ? ' edited' : '')}>
      <button type="button" className="dshc-chip" title={t('bind.title', { name: bind.name ?? bind.id, v: bind.v })} onClick={() => canvas.openLibrary(bind.id)}>
        <Icon name="library" size={11} /><span className="nm">{bind.name ?? bind.id}</span> · v{bind.v}{edited ? ' · ' + t('bind.modified') : ''}
      </button>
      <button type="button" className="dshc-chip x" aria-label={t('bind.unbind')} title={t('bind.unbind')} onClick={onUnbind}><Icon name="close" size={10} /></button>
    </span>
  );
}

/** ‹ 2/3 › switcher over a media node with more than one result. */
function Versions({ id, node }) {
  const canvas = useCanvas();
  const versions = versionsOf(node);
  if (versions.length < 2) return null;
  const index = shownIndex(node, versions);
  const go = (event, next) => { event.stopPropagation(); canvas.selectVersion(id, next); };
  return (
    <div className="dshc-versions nodrag" title={canvas.t('node.versions')}>
      <button type="button" disabled={index === 0} onClick={(event) => go(event, index - 1)} aria-label={canvas.t('node.prevVersion')}><Icon name="chevronLeft" size={13} /></button>
      <span>{index + 1}/{versions.length}</span>
      <button type="button" disabled={index === versions.length - 1} onClick={(event) => go(event, index + 1)} aria-label={canvas.t('node.nextVersion')}><Icon name="chevronRight" size={13} /></button>
    </div>
  );
}

function Running({ run }) {
  const { t } = useCanvas();
  const status = useRunStatus(run, t);
  if (!status.running) return null;
  return <div className="dshc-running"><span className="dshc-spin" />{status.text}</div>;
}

/** One-click edits of an image: each makes a new image node referencing this one and runs it. */
export const IMAGE_PRESETS = [
  { key: 'upscale', icon: 'sparkles', prompt: '高清修复：保持画面内容、构图和人物完全一致，提升清晰度与细节，去除噪点和模糊。' },
  { key: 'angle', icon: 'rotate', prompt: '保持同一主体、服装、场景和画风，把镜头换成另一个角度（例如侧面或俯视）重新拍摄这一画面。' },
  { key: 'style', icon: 'palette', prompt: '保持画面内容、构图和主体完全一致，只改变整体美术风格：统一为一种鲜明的风格化画风（例如水彩、赛璐璐动画或胶片质感），色彩与笔触风格一致。' },
  { key: 'light', icon: 'sun', prompt: '保持画面内容与构图不变，改为电影感的戏剧性打光：明确的主光方向、柔和的轮廓光和有层次的阴影。' },
  { key: 'grid', icon: 'grid', prompt: '基于这张图，生成同一角色与场景的九宫格分镜（3x3），每格一个连续的镜头，风格统一。' },
];

/**
 * "Save to library": pick a production category and file the image the node shows in the library
 * under it (LibTV-style asset categories). Re-saving with another category re-files the same asset.
 */
function SaveToLibrary({ id, node }) {
  const canvas = useCanvas();
  const { t } = canvas;
  const current = categoryOf(node.data.category) ?? '';
  const [category, setCategory] = React.useState(current);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => setCategory(current), [current]);
  const save = async () => {
    setBusy(true);
    try { await canvas.saveToLibrary(id, category || null); } finally { setBusy(false); }
  };
  return (
    <span className="dshc-save-lib">
      <Pill label={t('cat.assign')} value={category} onChange={(event) => setCategory(event.target.value)}>
        <option value="">{t('cat.none')}</option>
        {ASSET_CATEGORIES.map((key) => <option key={key} value={key}>{t('cat.' + key)}</option>)}
      </Pill>
      <button type="button" className="dshc-tbtn" disabled={busy} title={t('cat.saveHint')} onClick={save}>
        <Icon name="library" size={15} /><span className="lbl">{t('cat.save')}</span>
      </button>
    </span>
  );
}

/** The floating bar above a selected node; clears the title line above the card. */
function NodeBar({ id, visible, width = 320, children }) {
  return visible ? <NodeBarBody id={id} width={width}>{children}</NodeBarBody> : null;
}
function NodeBarBody({ id, width, children }) {
  const shift = useKeepInView(id, width);
  return (
    <NodeToolbar isVisible position={Position.Top} offset={32}>
      <div className="dshc-nodebar dshc-float" style={shift ? { transform: `translateX(${shift}px)` } : undefined}>{children}</div>
    </NodeToolbar>
  );
}

const SourceHandle = () => <Handle type="source" id="out" position={Position.Right} className="dshc-handle" />;
const HiddenIn = () => <Handle type="target" id="in" position={Position.Left} isConnectable={false} className="dshc-handle dshc-handle-in" />;

export function ImageNode({ id, data, selected }) {
  const canvas = useCanvas();
  const { t } = canvas;
  const n = data.node;
  const run = data.run ?? { status: 'idle' };
  const hasImage = typeof n.data.path === 'string';
  const absolute = hasImage ? assetAbsolute(canvas.path, n.data.path) : '';
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [absolute]);
  const meta = n.data.meta ?? {};
  const only = canvas.selectionCount === 1;
  return (
    <div className={'dshc-card dshc-media' + (selected ? ' is-selected' : '') + (hasImage ? '' : ' is-empty')} title={meta.prompt ?? ''}>
      <NodeTitle icon="image" name={n.data.label || (hasImage ? baseName(absolute) : t('node.image'))} meta={[categoryOf(n.data.category) ? t('cat.' + n.data.category) : '', dims(n.data)].filter(Boolean).join(' · ')} generated={meta.source === 'generated'} />
      <Resizer canvas={canvas} id={id} selected={selected} keepAspectRatio={hasImage} minWidth={60} minHeight={40} />
      <NodeBar id={id} visible={selected && only && hasImage} width={760}>
        {IMAGE_PRESETS.map((preset) => (
          <button key={preset.key} type="button" className="dshc-tbtn" title={t('preset.' + preset.key) + '：' + preset.prompt} onClick={() => canvas.derive(id, preset.prompt)}>
            <Icon name={preset.icon} size={15} /><span className="lbl">{t('preset.' + preset.key)}</span>
          </button>
        ))}
        <span className="dshc-sep" />
        <button type="button" className="dshc-tbtn" title={t('node.toVideo')} onClick={() => canvas.spawnVideo(id)}><Icon name="video" size={15} /><span className="lbl">{t('node.toVideo')}</span></button>
        <span className="dshc-sep" />
        <SaveToLibrary id={id} node={n} />
        <button type="button" className="dshc-ibtn" onClick={() => canvas.openFile(absolute)} aria-label={t('node.open')} title={t('node.open')}><Icon name="external" size={15} /></button>
      </NodeBar>
      {!hasImage
        ? <div className="dshc-placeholder"><Icon name="image" size={28} strokeWidth={1.4} /><span>{t(selected ? 'node.emptySelected' : 'node.empty')}</span></div>
        : failed
          ? <div className="dshc-missing">{baseName(absolute)}</div>
          : <img src={api.mediaUrl(absolute)} alt={n.data.label ?? ''} draggable={false} loading="lazy" decoding="async" onError={() => setFailed(true)} />}
      <Versions id={id} node={n} />
      <Running run={run} />
      <GenPanel id={id} node={n} run={run} inputs={data.inputs} visible={selected && only} />
      <HiddenIn />
      <Handle type="target" id="reference" position={Position.Left} className="dshc-handle dshc-handle-ref" title={t('gen.refs', { n: '' })} />
      <SourceHandle />
    </div>
  );
}

export function VideoNode({ id, data, selected }) {
  const canvas = useCanvas();
  const n = data.node;
  const run = data.run ?? { status: 'idle' };
  const hasVideo = typeof n.data.path === 'string';
  const absolute = hasVideo ? assetAbsolute(canvas.path, n.data.path) : '';
  const only = canvas.selectionCount === 1;
  const { t } = canvas;
  const meta = [dims(n.data), n.data.duration ? t('gen.seconds', { n: n.data.duration }) : ''].filter(Boolean).join(' · ');
  return (
    <div className={'dshc-card dshc-media dshc-video' + (selected ? ' is-selected' : '') + (hasVideo ? '' : ' is-empty')} title={n.data.meta?.prompt ?? ''}>
      <NodeTitle icon="video" name={n.data.label || (hasVideo ? baseName(absolute) : t('node.video'))} meta={meta} generated={n.data.meta?.source === 'generated'} />
      <Resizer canvas={canvas} id={id} selected={selected} keepAspectRatio={hasVideo} minWidth={120} minHeight={68} />
      <NodeBar id={id} visible={selected && only && hasVideo} width={200}>
        {n.data.lastFrame ? <button type="button" className="dshc-tbtn" title={t('node.continue')} onClick={() => canvas.continueVideo(id)}><Icon name="play" size={14} /><span className="lbl">{t('node.continue')}</span></button> : null}
        <button type="button" className="dshc-ibtn" onClick={() => canvas.openFile(absolute)} aria-label={t('node.open')} title={t('node.open')}><Icon name="external" size={15} /></button>
      </NodeBar>
      {hasVideo ? (
        <video
          key={absolute} className="nodrag" src={api.mediaUrl(absolute)} controls muted loop playsInline preload="metadata"
          onLoadedMetadata={(event) => {
            const { videoWidth, videoHeight } = event.currentTarget;
            if (videoWidth > 0 && n.data.naturalWidth !== videoWidth) {
              canvas.change((doc) => updateNode(doc, id, { h: Math.round((n.w * videoHeight) / videoWidth), data: { naturalWidth: videoWidth, naturalHeight: videoHeight } }));
            }
          }}
        />
      ) : (
        <div className="dshc-placeholder">
          <Icon name="video" size={28} strokeWidth={1.4} />
          <span>{t(selected ? 'node.emptySelected' : 'node.emptyVideo')}</span>
          <div className="dshc-hints"><span>{t('hint.text2video')}</span><span>{t('hint.firstFrame')}</span><span>{t('hint.firstLast')}</span></div>
        </div>
      )}
      <Versions id={id} node={n} />
      <Running run={run} />
      <GenPanel id={id} node={n} run={run} inputs={data.inputs} visible={selected && only} />
      <HiddenIn />
      <Handle type="target" id="first_frame" position={Position.Left} style={{ top: '28%' }} className="dshc-handle dshc-handle-first" title={t('gen.first')} />
      <Handle type="target" id="last_frame" position={Position.Left} style={{ top: '50%' }} className="dshc-handle dshc-handle-last" title={t('gen.last')} />
      <Handle type="target" id="reference" position={Position.Left} style={{ top: '72%' }} className="dshc-handle dshc-handle-ref" title={t('gen.refs', { n: '' })} />
      <SourceHandle />
    </div>
  );
}

export function TextNode({ id, data, selected }) {
  const canvas = useCanvas();
  const n = data.node;
  const field = useDraftField(n.data.text, (text) => canvas.change((doc) => updateNode(doc, id, { data: { text } })));
  return (
    <div className={'dshc-card dshc-text' + (selected ? ' is-selected' : '') + (n.data.color ? ' colored' : '')} style={n.data.color ? { background: n.data.color } : undefined}>
      <NodeTitle icon="text" name={n.data.label || canvas.t('node.text')} />
      <Resizer canvas={canvas} id={id} selected={selected} minWidth={120} minHeight={60} />
      {/* The textarea swallows drags, so the note moves by this strip. */}
      <div className="dshc-grip" aria-hidden="true" />
      <textarea className="nodrag nowheel" placeholder={canvas.t('node.textPlaceholder')} {...field} />
      <SourceHandle />
    </div>
  );
}

export function FrameNode({ id, data, selected }) {
  const canvas = useCanvas();
  const n = data.node;
  const field = useDraftField(n.data.label ?? canvas.t('frame.label'), (label) => canvas.change((doc) => updateNode(doc, id, { data: { label } })));
  return (
    <div className={'dshc-frame' + (selected ? ' is-selected' : '')} style={n.data.color ? { '--dshc-frame': n.data.color } : undefined}>
      <Resizer canvas={canvas} id={id} selected={selected} minWidth={160} minHeight={120} />
      <input className="dshc-frame-label nodrag" {...field} aria-label={canvas.t('frame.label')} />
    </div>
  );
}

function Cell({ value, commit, label, rows = 2 }) {
  const field = useDraftField(value, commit);
  return <textarea className="nodrag nowheel" rows={rows} aria-label={label} {...field} />;
}

function ScriptRow({ scriptId, row, index, runOf }) {
  const canvas = useCanvas();
  const { t } = canvas;
  const set = (patch) => canvas.updateRow(scriptId, row.id, patch);
  const run = row.imageId ? runOf(row.imageId) : undefined;
  return (
    <tr>
      <td className="num">{index + 1}</td>
      <td className="dur"><input className="nodrag" type="number" min="0" step="0.5" value={row.duration ?? ''} aria-label={t('script.duration')}
        onChange={(event) => set({ duration: event.target.value === '' ? undefined : Number(event.target.value) })} /></td>
      <td><Cell value={row.description} commit={(description) => set({ description })} label={t('script.description')} /></td>
      <td><Cell value={row.prompt} commit={(prompt) => set({ prompt })} label={t('script.prompt')} /></td>
      <td className="ops">
        {row.imageId && canvas.exists(row.imageId)
          ? <button type="button" onClick={() => canvas.focusNode(row.imageId)}>{run?.status === 'running' ? t('script.generating') : t('script.locate')}</button>
          : <button type="button" onClick={() => canvas.shoot(scriptId, [row.id])} disabled={!(row.prompt || row.description)}>{t('script.shoot')}</button>}
        <button type="button" className="del" aria-label={t('script.removeRow')} title={t('script.removeRow')} onClick={() => canvas.removeRow(scriptId, row.id)}><Icon name="close" size={13} /></button>
      </td>
    </tr>
  );
}

/** A storyboard table: one row per shot; each row can make its shot image beside the table. */
export function ScriptNode({ id, data, selected }) {
  const canvas = useCanvas();
  const { t } = canvas;
  const n = data.node;
  const rows = Array.isArray(n.data.rows) ? n.data.rows : [];
  const title = useDraftField(n.data.title ?? t('script.title'), (value) => canvas.change((doc) => updateNode(doc, id, { data: { title: value } })));
  const pending = rows.filter((row) => (row.prompt || row.description) && !(row.imageId && canvas.exists(row.imageId)));
  const total = rows.reduce((sum, row) => sum + (Number(row.duration) || 0), 0);
  return (
    <div className={'dshc-card dshc-script' + (selected ? ' is-selected' : '')}>
      <NodeTitle icon="script"><input className="nodrag" {...title} aria-label={t('script.title')} size={Math.max(4, (title.value ?? '').length + 2)} /></NodeTitle>
      <Resizer canvas={canvas} id={id} selected={selected} minWidth={480} minHeight={200} />
      <div className="dshc-script-head">
        <span className="meta">{t('script.summary', { n: rows.length, s: Math.round(total * 10) / 10 })}</span>
        <button type="button" className="dshc-btn nodrag" onClick={() => canvas.addRow(id)}><Icon name="plus" size={13} />{t('script.addRow')}</button>
        <button type="button" className="dshc-btn primary nodrag" disabled={pending.length === 0} onClick={() => canvas.shoot(id, pending.map((row) => row.id))}>{t('script.shootAll', { n: pending.length })}</button>
      </div>
      <div className="dshc-script-body nowheel">
        <table>
          <thead><tr><th>#</th><th>{t('script.duration')}</th><th>{t('script.description')}</th><th>{t('script.prompt')}</th><th /></tr></thead>
          <tbody>{rows.map((row, index) => <ScriptRow key={row.id} scriptId={id} row={row} index={index} runOf={canvas.runOf} />)}</tbody>
        </table>
        {rows.length === 0 ? <div className="dshc-script-empty">{t('script.empty')}</div> : null}
      </div>
      <Handle type="source" id="out" position={Position.Right} isConnectable={false} className="dshc-handle dshc-handle-in" />
    </div>
  );
}

export function GeneratorNode({ id, data, selected }) {
  const canvas = useCanvas();
  const { t } = canvas;
  const n = data.node;
  const d = n.data;
  const run = data.run ?? { status: 'idle' };
  const video = d.mode === 'video';
  const status = useRunStatus(run, t);
  const set = (patch) => canvas.change((doc) => updateNode(doc, id, { data: patch }));
  const prompt = useDraftField(d.prompt, (value) => set({ prompt: value }));
  const [busy, setBusy] = React.useState(false);
  const inputs = data.inputs ?? { reference: 0, first_frame: false, last_frame: false };
  const start = async () => {
    setBusy(true);
    try { await canvas.run(id, prompt.value); } finally { setBusy(false); }
  };
  const switchMode = (mode) => {
    if (mode === d.mode) return;
    const list = (mode === 'video' ? canvas.config?.videoModels : canvas.config?.imageModels) ?? [];
    set({ mode, model: list[0]?.id, ratio: mode === 'video' ? 'adaptive' : 'auto' });
  };
  return (
    <div className={'dshc-card dshc-gen' + (selected ? ' is-selected' : '') + (status.running ? ' is-running' : '')}>
      <NodeTitle icon="wand" name={d.label || t('add.generator')} />
      <Resizer canvas={canvas} id={id} selected={selected} minWidth={280} minHeight={220} />
      <div className="dshc-gen-head">
        <div className="dshc-seg nodrag" role="tablist">
          <button type="button" role="tab" aria-selected={!video} className={!video ? 'on' : ''} onClick={() => switchMode('image')}>{t('gen.image')}</button>
          <button type="button" role="tab" aria-selected={video} className={video ? 'on' : ''} onClick={() => switchMode('video')}>{t('gen.video')}</button>
        </div>
        <InputChips inputs={inputs} />
      </div>
      <textarea className="dshc-prompt nodrag nowheel" placeholder={t(video ? 'gen.promptVideo' : 'gen.prompt')} {...prompt}
        onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !status.running) { event.preventDefault(); start(); } }} />
      <GenFields mode={video ? 'video' : 'image'} gen={d} set={set} />
      <div className="dshc-gen-foot">
        <span className={'dshc-gen-status' + (run.status === 'error' ? ' dshc-error' : '')} title={status.text ?? ''}>
          {status.text ?? (inputs.reference === 0 && !inputs.first_frame ? t('gen.connectHint') : '')}
        </span>
        <button type="button" className="dshc-btn primary nodrag" disabled={status.running || busy} onClick={start}>
          {status.running || busy ? '…' : run.status === 'done' ? t('gen.rerun') : t('gen.run')}
        </button>
      </div>
      {video ? (
        <>
          <Handle type="target" id="first_frame" position={Position.Left} style={{ top: '30%' }} className="dshc-handle dshc-handle-first" title={t('gen.first')} />
          <Handle type="target" id="last_frame" position={Position.Left} style={{ top: '50%' }} className="dshc-handle dshc-handle-last" title={t('gen.last')} />
          <Handle type="target" id="reference" position={Position.Left} style={{ top: '70%' }} className="dshc-handle dshc-handle-ref" title={t('gen.refs', { n: '' })} />
        </>
      ) : <Handle type="target" id="reference" position={Position.Left} className="dshc-handle dshc-handle-ref" />}
      <Handle type="source" id="out" position={Position.Right} isConnectable={false} className="dshc-handle dshc-handle-in" />
    </div>
  );
}

/** A saved web link (library asset): preview image, title, description, the address. */
export function LinkNode({ id, data, selected }) {
  const canvas = useCanvas();
  const { t } = canvas;
  const d = data.node.data;
  let host = '';
  try { host = new URL(d.url).hostname; } catch { /* not a URL */ }
  return (
    <div className={'dshc-card dshc-link' + (selected ? ' is-selected' : '')} title={d.url}>
      <NodeTitle icon="link" name={d.site || host || t('node.link')} />
      <Resizer canvas={canvas} id={id} selected={selected} minWidth={180} minHeight={90} />
      {d.image ? <img src={api.mediaUrl(assetAbsolute(canvas.path, d.image))} alt="" draggable={false} loading="lazy" /> : null}
      <div className="body">
        <b>{d.title || d.url}</b>
        {d.description ? <p>{d.description}</p> : null}
        <a className="nodrag" href={d.url} target="_blank" rel="noreferrer noopener" title={t('node.openLink')}><Icon name="external" size={11} />{host || d.url}</a>
      </div>
    </div>
  );
}

export const nodeTypes = { image: ImageNode, video: VideoNode, text: TextNode, frame: FrameNode, generator: GeneratorNode, script: ScriptNode, link: LinkNode };
