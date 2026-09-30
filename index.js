/**
 * Host half of the canvas: authenticated routes for the browser tab, Volcengine generation,
 * and the canvas_* agent tools. Only `ctx` services are used — no runtime @deepseek-ai imports —
 * so the plugin binds to whichever DSH build is running.
 */
import { ARK_KEY_REF, arkcliKey, createArk } from './src/host/ark.js';
import { createContext, registerContextInjection } from './src/host/context.js';
import { registerRoutes } from './src/host/routes.js';
import { createGenerator } from './src/host/generate.js';
import { createLibrary } from './src/host/library.js';
import { CanvasError, createStore } from './src/host/store.js';
import { registerTools } from './src/host/tools.js';

export const name = 'dsh-canvas';
export const inject = ['connection', 'tools'];

export function apply(ctx) {
  const credentials = ctx.get('credentials');
  const attachments = ctx.get('attachments');
  const log = (message, error) => ctx.logger?.warn?.(message, error);

  const store = createStore();
  const getArk = async () => {
    const hit = credentials === undefined ? undefined : await credentials.resolve(ARK_KEY_REF);
    const apiKey = hit?.value ?? process.env[ARK_KEY_REF] ?? await arkcliKey();
    if (!apiKey) throw new CanvasError('还没有配置火山方舟 API Key：点击画布右上角的「设置」填写，或用 arkcli 登录', 412);
    return createArk({ apiKey });
  };
  // Prompts, images, videos and links with their versions, beside the canvases (canvas/library/).
  const library = createLibrary();
  const generator = createGenerator({ store, getArk, library, log });
  ctx.effect(() => () => generator.dispose(), 'dsh-canvas: generation jobs');

  // The canvas each workspace has open, with its selection: the default target of the agent tools.
  const focus = new Map();

  // Canvas cards the user attached to their next message, injected as a separate <canvas_context> message.
  const context = createContext({ store, attachments, log });
  registerContextInjection(ctx, context);

  registerRoutes(ctx, { store, generator, library, focus, credentials, context });
  registerTools(ctx, { store, generator, focus, attachments, library });
}
