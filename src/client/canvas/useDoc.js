import React from 'react';
import { mergeDocs, normalizeDoc } from '../../shared/doc.js';
import { api } from '../shared.js';

const SAVE_DELAY = 500;
const POLL_MS = 1200;

/**
 * The open canvas document, kept in sync with its file.
 * Local edits save after a short pause with the version they started from; the Host merges when an
 * agent tool or a finishing generation wrote in between. While nothing local is pending, the file's
 * version is polled so outside writes appear on the canvas.
 */
export function useCanvasDoc(path, visible) {
  const [state, setState] = React.useState({ status: 'loading', doc: null, error: null, save: 'saved', saveError: null });
  const live = React.useRef(null);
  if (live.current === null || live.current.path !== path) {
    live.current = { path, doc: null, version: null, dirty: false, saving: false, timer: null, disposed: false, flush: null };
  }

  const publish = React.useCallback((patch) => {
    if (!live.current.disposed) setState((current) => ({ ...current, doc: live.current.doc, ...patch }));
  }, []);

  const load = React.useCallback(async () => {
    const r = live.current;
    try {
      const result = await api.doc(path);
      if (r !== live.current) return;
      r.doc = normalizeDoc(result.doc);
      r.version = result.version;
      publish({ status: 'ready', error: null });
    } catch (error) {
      if (r === live.current) setState((current) => ({ ...current, status: 'error', error: error.message }));
    }
  }, [path, publish]);

  const flush = React.useCallback(async () => {
    const r = live.current;
    clearTimeout(r.timer);
    r.timer = null;
    if (r.saving || !r.dirty || r.doc === null) return;
    r.saving = true;
    const sent = r.doc;
    publish({ save: 'saving' });
    try {
      const result = await api.save(path, sent, r.version);
      r.version = result.version;
      // Edits made while the save was in flight still need their own save.
      const editedMeanwhile = r.doc !== sent;
      if (result.merged) {
        const merged = normalizeDoc(result.doc);
        r.doc = editedMeanwhile ? mergeDocs(merged, r.doc) : merged;
      }
      r.dirty = editedMeanwhile;
      r.saving = false;
      publish({ save: result.merged ? 'merged' : r.dirty ? 'pending' : 'saved', saveError: null });
      if (r.dirty) r.timer = setTimeout(() => r.flush?.(), SAVE_DELAY);
    } catch (error) {
      r.saving = false;
      publish({ save: 'failed', saveError: error.message });
      if (!r.disposed) r.timer = setTimeout(() => r.flush?.(), 3000);
    }
  }, [path, publish]);
  live.current.flush = flush;

  /** Apply a pure edit (doc → doc) and schedule a save. */
  const change = React.useCallback((edit) => {
    const r = live.current;
    if (r.doc === null) return;
    const next = edit(r.doc);
    if (next === r.doc) return;
    r.doc = next;
    r.dirty = true;
    publish({ save: 'pending' });
    clearTimeout(r.timer);
    r.timer = setTimeout(() => r.flush?.(), SAVE_DELAY);
  }, [publish]);

  React.useEffect(() => {
    load();
    const r = live.current;
    return () => {
      // Save what is pending before the tab lets go of this canvas.
      if (r.dirty) r.flush?.();
      r.disposed = true;
      clearTimeout(r.timer);
    };
  }, [load]);

  React.useEffect(() => {
    if (!visible) return undefined;
    let busy = false;
    const id = setInterval(async () => {
      const r = live.current;
      if (busy || r.doc === null || r.dirty || r.saving) return;
      busy = true;
      try {
        const { version } = await api.version(path);
        if (version !== r.version && !r.dirty && !r.saving) {
          const result = await api.doc(path);
          if (!r.dirty && !r.saving && r === live.current) {
            r.doc = normalizeDoc(result.doc);
            r.version = result.version;
            publish({ save: 'saved' });
          }
        }
      } catch { /* the next tick retries */ } finally { busy = false; }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [visible, path, publish]);

  /** Save now and wait until nothing local is pending (before asking the Host to read the file). */
  const settle = React.useCallback(async () => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const r = live.current;
      if (!r.dirty && !r.saving) return;
      if (!r.saving) await r.flush?.();
      else await new Promise((resolve) => setTimeout(resolve, 60));
    }
  }, []);

  return { ...state, change, flush, settle, reload: load };
}
