import React from 'react';
import { api, assetAbsolute } from '../shared.js';
import { Icon } from './icons.jsx';

/** Drag payload of a library card or version dropped on the canvas. */
export const ASSET_MIME = 'application/x-dshc-asset';
const KIND_ICON = { prompt: 'text', image: 'image', video: 'video', link: 'link' };
const TABS = ['all', 'prompt', 'image', 'video', 'link', 'history'];

function ago(t, at) {
  if (!at) return '';
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return t('lib.justNow');
  if (s < 3600) return t('lib.minutes', { n: Math.floor(s / 60) });
  if (s < 86400) return t('lib.hours', { n: Math.floor(s / 3600) });
  const d = new Date(at);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const dragProps = (id, v) => ({
  draggable: true,
  onDragStart: (event) => { event.dataTransfer.setData(ASSET_MIME, JSON.stringify({ id, v })); event.dataTransfer.effectAllowed = 'copy'; },
});

/** Thumbnail of a media file stored beside the canvas. */
function Thumb({ canvasPath, kind, path, className = 'thumb' }) {
  if (!path) return <div className={className + ' empty'}><Icon name={KIND_ICON[kind] ?? 'image'} size={20} strokeWidth={1.4} /></div>;
  const src = api.mediaUrl(assetAbsolute(canvasPath, path));
  return kind === 'video'
    ? <video className={className} src={src + '#t=0.1'} muted playsInline preload="metadata" />
    : <img className={className} src={src} alt="" loading="lazy" decoding="async" draggable={false} />;
}

function Labels({ asset, v, latest }) {
  const names = Object.entries(asset.labels ?? {}).filter(([, at]) => at === v).map(([name]) => name);
  return (
    <>
      {latest ? <span className="dshc-tag">latest</span> : null}
      {names.map((name) => <span key={name} className="dshc-tag on">{name}</span>)}
    </>
  );
}

function Card({ canvasPath, t, item, onOpen }) {
  const { latest } = item;
  const tagged = Object.keys(item.labels ?? {});
  return (
    <button type="button" className={'dshc-lib-card kind-' + item.kind} onClick={() => onOpen(item.id)} title={item.name} {...dragProps(item.id)}>
      {item.kind === 'prompt'
        ? <div className="text">{latest.text}</div>
        : item.kind === 'link'
          ? (latest.image ? <Thumb canvasPath={canvasPath} kind="image" path={latest.image} /> : <div className="thumb empty"><Icon name="link" size={20} /></div>)
          : <Thumb canvasPath={canvasPath} kind={item.kind} path={latest.path} />}
      <div className="foot">
        <Icon name={KIND_ICON[item.kind]} size={12} />
        <span className="name">{item.kind === 'link' ? (latest.title || item.name) : item.name}</span>
        <span className="ver">v{latest.v}{item.count > 1 ? `/${item.count}` : ''}</span>
      </div>
      {tagged.length ? <div className="tags">{tagged.slice(0, 2).map((name) => <span key={name} className="dshc-tag on">{name}</span>)}</div> : null}
      <span className="sr">{t('lib.kind.' + item.kind)}</span>
    </button>
  );
}

/** A prompt version composer: edit the text and save it as the next version, with a note. */
function Composer({ t, asset, onSave }) {
  const latest = asset.versions.at(-1);
  const [text, setText] = React.useState(latest.text ?? '');
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { setText(latest.text ?? ''); setNote(''); }, [asset.id, latest.v]);
  const changed = text.trim() !== '' && (text !== latest.text || note.trim() !== '');
  const save = async () => { setBusy(true); try { await onSave(text, note.trim()); } finally { setBusy(false); } };
  return (
    <div className="dshc-lib-composer">
      <textarea rows={4} value={text} onChange={(event) => setText(event.target.value)} aria-label={t('lib.newVersionText')} className="nowheel" />
      <div className="row">
        <input value={note} onChange={(event) => setNote(event.target.value)} placeholder={t('lib.notePlaceholder')} aria-label={t('lib.note')} />
        <button type="button" className="dshc-btn primary" disabled={!changed || busy} onClick={save}>{t('lib.saveAs', { v: latest.v + 1 })}</button>
      </div>
    </div>
  );
}

function PromptVersions({ t, canvasPath, data, actions }) {
  const { asset, outputs } = data;
  const latestV = asset.versions.at(-1).v;
  return [...asset.versions].reverse().map((version) => {
    const made = outputs?.[version.v] ?? [];
    const final = asset.labels?.[actions.finalLabel] === version.v;
    return (
      <section key={version.v} className="dshc-lib-version" data-version={version.v}>
        <header>
          <b>v{version.v}</b><Labels asset={asset} v={version.v} latest={version.v === latestV} />
          <span className="when">{ago(t, version.at)}</span>
        </header>
        {version.note ? <div className="note">{version.note}</div> : null}
        <div className="text">{version.text}</div>
        {version.model ? <div className="meta">{version.model}{version.params?.ratio ? ' · ' + version.params.ratio : ''}</div> : null}
        {made.length ? (
          <div className="outputs">
            {made.map((output) => (
              <button key={output.id + '@' + output.v} type="button" className="out" title={`${output.name} v${output.v}`} onClick={() => actions.open(output.id)} {...dragProps(output.id, output.v)}>
                <Thumb canvasPath={canvasPath} kind={output.kind} path={output.path} />
              </button>
            ))}
          </div>
        ) : <div className="meta">{t('lib.noOutputs')}</div>}
        <div className="acts">
          {actions.canApply ? <button type="button" className="dshc-btn" onClick={() => actions.apply(asset, version)}>{t('lib.apply')}</button> : null}
          <button type="button" className="dshc-btn" onClick={() => actions.place(asset.id, version.v)}>{t('lib.place')}</button>
          <button type="button" className="dshc-btn" aria-pressed={final} onClick={() => actions.label(asset.id, final ? null : version.v)}>{final ? t('lib.unfinal') : t('lib.final')}</button>
        </div>
      </section>
    );
  });
}

function MediaVersions({ t, canvasPath, data, actions }) {
  const { asset } = data;
  const latestV = asset.versions.at(-1).v;
  return (
    <div className="dshc-lib-grid">
      {[...asset.versions].reverse().map((version) => {
        const prompt = version.source?.prompt;
        const final = asset.labels?.[actions.finalLabel] === version.v;
        return (
          <section key={version.v} className="dshc-lib-media" data-version={version.v} {...dragProps(asset.id, version.v)}>
            <Thumb canvasPath={canvasPath} kind={asset.kind} path={version.path} />
            <header><b>v{version.v}</b><Labels asset={asset} v={version.v} latest={version.v === latestV} /><span className="when">{ago(t, version.at)}</span></header>
            {prompt ? <button type="button" className="dshc-chip" title={version.source.text ?? ''} onClick={() => actions.open(prompt.split('@')[0])}><Icon name="text" size={11} />{prompt.replace(/^.*@/, t('lib.promptV') + ' v')}</button>
              : version.imported ? <span className="meta">{t('lib.imported')}</span> : null}
            <div className="acts">
              <button type="button" className="dshc-btn" onClick={() => actions.place(asset.id, version.v)}>{t('lib.place')}</button>
              <button type="button" className="dshc-btn" aria-pressed={final} onClick={() => actions.label(asset.id, final ? null : version.v)}>{final ? t('lib.unfinal') : t('lib.final')}</button>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Detail({ t, canvasPath, id, reload, actions, onBack }) {
  const [data, setData] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [name, setName] = React.useState('');
  const load = React.useCallback(() => api.asset(canvasPath, id).then((next) => { setData(next); setName(next.asset.name); setError(null); }, (e) => setError(e.message)), [canvasPath, id]);
  React.useEffect(() => { load(); }, [load, reload]);
  const act = (fn) => async (...args) => { try { await fn(...args); await load(); actions.changed(); } catch (e) { actions.toast(e.message); } };
  const local = {
    ...actions,
    label: act((assetId, v) => api.libraryUpdate(canvasPath, assetId, 'label', { label: actions.finalLabel, v })),
  };
  if (error) return <div className="dshc-lib-empty dshc-error">{error}</div>;
  if (!data) return <div className="dshc-lib-empty">…</div>;
  const { asset } = data;
  const rename = act(() => (name.trim() && name !== asset.name ? api.libraryUpdate(canvasPath, asset.id, 'rename', { name }) : undefined));
  const link = asset.kind === 'link' ? asset.versions.at(-1) : undefined;
  return (
    <div className="dshc-lib-detail nowheel">
      <div className="dshc-lib-head">
        <button type="button" className="dshc-ibtn" onClick={onBack} aria-label={t('lib.back')} title={t('lib.back')}><Icon name="chevronLeft" size={16} /></button>
        <Icon name={KIND_ICON[asset.kind]} size={14} />
        <input className="title" value={name} onChange={(event) => setName(event.target.value)} onBlur={rename} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} aria-label={t('lib.name')} />
        <span className="count">{t('lib.versions', { n: asset.versions.length })}</span>
      </div>
      <div className="dshc-lib-sub">
        <code>{asset.id}</code>
        {data.usedBy?.length ? <span>{t('lib.usedBy', { list: data.usedBy.join('、') })}</span> : <span>{t('lib.unused')}</span>}
      </div>
      <div className="dshc-lib-scroll">
        {asset.kind === 'prompt' ? (
          <>
            <Composer t={t} asset={asset} onSave={act((text, note) => api.libraryUpdate(canvasPath, asset.id, 'commit', { text, note }))} />
            <PromptVersions t={t} canvasPath={canvasPath} data={data} actions={local} />
          </>
        ) : link ? (
          <section className="dshc-lib-version">
            {link.image ? <Thumb canvasPath={canvasPath} kind="image" path={link.image} className="cover" /> : null}
            <div className="text"><b>{link.title || link.url}</b></div>
            {link.description ? <div className="note">{link.description}</div> : null}
            <a className="url" href={link.url} target="_blank" rel="noreferrer noopener">{link.url}</a>
            <div className="acts"><button type="button" className="dshc-btn" onClick={() => actions.place(asset.id, link.v)}>{t('lib.place')}</button></div>
          </section>
        ) : <MediaVersions t={t} canvasPath={canvasPath} data={data} actions={local} />}
      </div>
    </div>
  );
}

function History({ t, canvasPath, reload, open }) {
  const [runs, setRuns] = React.useState(null);
  React.useEffect(() => { api.history(canvasPath, 200).then((result) => setRuns(result?.runs ?? []), () => setRuns([])); }, [canvasPath, reload]);
  if (runs === null) return <div className="dshc-lib-empty">…</div>;
  if (runs.length === 0) return <div className="dshc-lib-empty">{t('lib.noHistory')}</div>;
  return (
    <div className="dshc-lib-scroll">
      {runs.map((run, index) => (
        <section key={run.at + ':' + index} className={'dshc-lib-run' + (run.status === 'error' ? ' failed' : '')}>
          <header>
            <Icon name={run.kind === 'video' ? 'video' : 'image'} size={12} />
            <span className="when">{ago(t, run.at)}</span>
            <span className="meta">{run.canvas?.replace(/\.dshcanvas$/, '')}{run.ms ? ` · ${Math.round(run.ms / 1000)}s` : ''}</span>
          </header>
          {run.text ? <div className="text">{run.text}</div> : null}
          {run.error ? <div className="dshc-error">{run.error}</div> : null}
          <div className="chips">
            {run.prompt ? <button type="button" className="dshc-chip" onClick={() => open(run.prompt.split('@')[0])}><Icon name="text" size={11} />{t('lib.promptV')} v{run.prompt.split('@')[1]}</button> : null}
            {(run.outputs ?? []).map((ref) => <button key={ref} type="button" className="dshc-chip" onClick={() => open(ref.split('@')[0])}><Icon name={ref.startsWith('v_') ? 'video' : 'image'} size={11} />v{ref.split('@')[1]}</button>)}
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * The asset library of the canvas's folder: prompts, images, videos and links with all their versions,
 * and the generation history. Cards drag onto the canvas; details show a prompt's versions with what
 * each produced.
 */
export function LibraryDrawer({ t, canvasPath, refresh, focus, onClose, actions }) {
  const [tab, setTab] = React.useState('all');
  const [query, setQuery] = React.useState('');
  const [items, setItems] = React.useState(null);
  const [open, setOpen] = React.useState(null);
  const [tick, setTick] = React.useState(0);
  const [url, setUrl] = React.useState('');
  React.useEffect(() => { if (focus?.id) { setOpen(focus.id); setTab('all'); } }, [focus]);
  // Refetch after edits on the canvas (a finished generation adds versions), debounced.
  React.useEffect(() => {
    const timer = setTimeout(() => { api.library(canvasPath).then((result) => setItems(result?.assets ?? []), () => setItems([])); setTick((n) => n + 1); }, items === null ? 0 : 500);
    return () => clearTimeout(timer);
  }, [canvasPath, refresh]);
  const changed = () => { api.library(canvasPath).then((result) => setItems(result?.assets ?? []), () => {}); actions.changed?.(); };
  const all = { ...actions, open: setOpen, changed };
  const q = query.trim().toLowerCase();
  const shown = (items ?? []).filter((item) => !item.archived && (tab === 'all' || item.kind === tab)
    && (!q || [item.name, item.latest.text, item.latest.title, item.latest.url, item.latest.prompt, ...Object.keys(item.labels ?? {})].some((s) => s && String(s).toLowerCase().includes(q))));
  const addLink = async () => { if (!url.trim()) return; const ok = await actions.addLink(url.trim()); if (ok) { setUrl(''); changed(); } };
  return (
    <aside className="dshc-drawer dshc-float nodrag nowheel" aria-label={t('lib.title')} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); if (open) setOpen(null); else onClose(); } }}>
      {open ? <Detail t={t} canvasPath={canvasPath} id={open} reload={tick} actions={all} onBack={() => setOpen(null)} /> : (
        <>
          <div className="dshc-lib-head">
            <Icon name="library" size={15} />
            <strong>{t('lib.title')}</strong>
            <span className="count">{items ? t('lib.count', { n: shown.length }) : ''}</span>
            <button type="button" className="dshc-ibtn" onClick={onClose} aria-label={t('lib.close')} title={t('lib.close')}><Icon name="close" size={15} /></button>
          </div>
          <div className="dshc-lib-tabs" role="tablist">
            {TABS.map((key) => <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'on' : ''} onClick={() => setTab(key)}>{t('lib.tab.' + key)}</button>)}
          </div>
          {tab === 'history' ? <History t={t} canvasPath={canvasPath} reload={tick} open={setOpen} /> : (
            <>
              <div className="dshc-lib-search">
                <Icon name="search" size={14} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('lib.search')} aria-label={t('lib.search')} />
              </div>
              {tab === 'link' ? (
                <form className="dshc-lib-search" onSubmit={(event) => { event.preventDefault(); addLink(); }}>
                  <Icon name="link" size={14} />
                  <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder={t('lib.linkPlaceholder')} aria-label={t('lib.addLink')} />
                  <button type="submit" className="dshc-btn" disabled={!url.trim()}>{t('lib.addLink')}</button>
                </form>
              ) : null}
              {items === null ? <div className="dshc-lib-empty">…</div>
                : shown.length === 0 ? <div className="dshc-lib-empty">{t(items.length === 0 ? 'lib.emptyAll' : 'lib.noMatch')}</div>
                  : <div className="dshc-lib-list dshc-lib-scroll">{shown.map((item) => <Card key={item.id} canvasPath={canvasPath} t={t} item={item} onOpen={setOpen} />)}</div>}
              <div className="dshc-lib-hint">{t('lib.dragHint')}</div>
            </>
          )}
        </>
      )}
    </aside>
  );
}
