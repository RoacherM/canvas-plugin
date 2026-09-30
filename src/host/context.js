/**
 * Canvas context attached to the next message, kept apart from what the user types.
 *
 * The tab records an attachment per session; when that session's next turn starts, an
 * `agent/pre-step` listener appends one source-attributed user-role message (the same mechanism
 * dsh-time-context uses) whose text is wrapped in <canvas_context>, followed by the selected
 * images. The chat shows it as an injected row, separate from the user's bubble.
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { absolutePosition, runOf } from '../shared/doc.js';
import { assetPath } from './store.js';

const MODEL_IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
const MAX_CARDS = 40;
const MAX_IMAGES = 6;
export const CONTEXT_SOURCE = 'dsh-canvas';

const escapeText = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (value) => escapeText(value).replace(/"/g, '&quot;');
const attrs = (record) => Object.entries(record)
  .filter(([, value]) => value !== undefined && value !== null && value !== '')
  .map(([key, value]) => ` ${key}="${escapeAttr(value)}"`).join('');

/** The <canvas_context> text for the selected cards of one canvas document. */
export function renderContext(canvasPath, doc, ids) {
  const byId = new Map(doc.nodes.map((node) => [node.id, node]));
  const cards = ids.map((id) => byId.get(id)).filter(Boolean).slice(0, MAX_CARDS);
  const lines = [`<canvas_context${attrs({ canvas: canvasPath, name: basename(canvasPath, '.dshcanvas'), cards: cards.length })}>`];
  lines.push('Cards the user attached from the canvas. Use canvas_read / canvas_edit with these ids to inspect or change them.');
  for (const node of cards) {
    const d = node.data;
    const pos = absolutePosition(doc, node);
    const base = { id: node.id, type: node.type, x: Math.round(pos.x), y: Math.round(pos.y), w: Math.round(node.w), h: Math.round(node.h), group: node.parentId ? byId.get(node.parentId)?.data.label ?? node.parentId : undefined };
    if (node.type === 'image' || node.type === 'video') {
      const card = { ...base, path: d.path ? assetPath(canvasPath, d.path) : undefined, label: d.label, model: d.meta?.model, source: d.meta?.source };
      lines.push(d.meta?.prompt ? `  <card${attrs(card)}>${escapeText(d.meta.prompt)}</card>` : `  <card${attrs(card)}/>`);
    } else if (node.type === 'generator') {
      const run = runOf(doc, node.id);
      const inputs = doc.edges.filter((edge) => edge.target === node.id && edge.role !== 'output').map((edge) => `${edge.role}:${edge.source}`).join(' ');
      lines.push(`  <card${attrs({ ...base, mode: d.mode, model: d.model, status: run.status, inputs })}>${escapeText(d.prompt ?? '')}</card>`);
    } else if (node.type === 'text') {
      lines.push(`  <card${attrs(base)}>${escapeText(d.text ?? '')}</card>`);
    } else {
      const children = doc.nodes.filter((child) => child.parentId === node.id).map((child) => child.id).join(' ');
      lines.push(`  <card${attrs({ ...base, label: d.label, children })}/>`);
    }
  }
  lines.push('</canvas_context>');
  return { text: lines.join('\n'), cards };
}

/**
 * @param deps.store - canvas file store.
 * @param deps.attachments - DSH attachment service (optional; without it no images are attached).
 */
export function createContext({ store, attachments, log = () => {} }) {
  const pending = new Map();   // sessionId → { path, ids, at }

  async function imageBlocks(canvasPath, cards) {
    if (attachments === undefined) return [];
    const blocks = [];
    for (const node of cards) {
      if (blocks.length >= MAX_IMAGES) break;
      const ref = node.type === 'image' ? node.data.path : node.type === 'video' ? node.data.lastFrame : undefined;
      if (!ref) continue;
      const file = assetPath(canvasPath, ref);
      const mediaType = MODEL_IMAGE_TYPES[extname(file).toLowerCase()];
      if (!mediaType) continue;
      try {
        const saved = await attachments.saveImage({ data: new Uint8Array(await readFile(file)), mediaType, name: `${node.id}${extname(file)}` });
        blocks.push({ type: 'text', text: `<canvas_image id="${escapeAttr(node.id)}"/>` }, { type: 'image', attachment: saved });
      } catch (error) { log('canvas: could not attach image', error); }
    }
    return blocks;
  }

  return {
    set(sessionId, path, ids) {
      if (ids.length === 0) pending.delete(sessionId);
      else pending.set(sessionId, { path, ids: ids.slice(0, MAX_CARDS), at: Date.now() });
    },
    get: (sessionId) => pending.get(sessionId),
    /** Build the context message for a session's pending attachment, consuming it. */
    async take(sessionId) {
      const entry = pending.get(sessionId);
      if (entry === undefined) return undefined;
      pending.delete(sessionId);
      const { doc } = await store.read(entry.path);
      const { text, cards } = renderContext(entry.path, doc, entry.ids);
      if (cards.length === 0) return undefined;
      const images = await imageBlocks(entry.path, cards);
      return Object.freeze({
        id: randomUUID(), role: 'user',
        content: [{ type: 'text', text }, ...images],
        source: { kind: CONTEXT_SOURCE, form: 'snapshot', sections: [{ name: CONTEXT_SOURCE, text }] },
      });
    },
  };
}

/** Append the pending canvas context as its own message when a turn starts. */
export function registerContextInjection(ctx, context) {
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next();
    if (decision.kind === 'reject' || payload.signal?.aborted || payload.step !== 1) return decision;
    const sessionId = payload.agent?.session?.id;
    if (sessionId === undefined || context.get(String(sessionId)) === undefined) return decision;
    const message = await context.take(String(sessionId));
    return message === undefined ? decision : { ...decision, messages: [...decision.messages, message] };
  }, { prepend: true });
}
