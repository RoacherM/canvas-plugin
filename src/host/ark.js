/**
 * Volcengine Ark (火山方舟) client for Seedream images and Seedance video tasks.
 * API reference (checked 2026-09-28): docs.volcengine.com/docs/82379/1541523 (images),
 * /1520757 (create video task), /1521309 (query video task).
 */

export const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
export const ARK_KEY_REF = 'ARK_API_KEY';

export const IMAGE_MODELS = [
  { id: 'doubao-seedream-5-0-260128', label: 'Seedream 5.0', maxRefs: 14, sequential: true },
  { id: 'doubao-seedream-5-0-pro-260628', label: 'Seedream 5.0 pro', maxRefs: 10, sequential: false },
  { id: 'doubao-seedream-5-0-flash-260915', label: 'Seedream 5.0 flash', maxRefs: 10, sequential: false },
  { id: 'doubao-seedream-4-5-251128', label: 'Seedream 4.5', maxRefs: 14, sequential: true },
];
export const VIDEO_MODELS = [
  { id: 'doubao-seedance-2-0-fast-260128', label: 'Seedance 2.0 fast', durations: [4, 15], resolutions: ['480p', '720p'], references: 9 },
  { id: 'doubao-seedance-2-0-260128', label: 'Seedance 2.0', durations: [4, 15], resolutions: ['480p', '720p', '1080p', '4k'], references: 9 },
  { id: 'doubao-seedance-2-5-260628', label: 'Seedance 2.5', durations: [4, 30], resolutions: ['480p', '720p', '1080p'], references: 30 },
  { id: 'doubao-seedance-2-0-mini-260615', label: 'Seedance 2.0 mini', durations: [4, 15], resolutions: ['480p', '720p'], references: 9 },
  { id: 'doubao-seedance-1-0-pro-fast-251015', label: 'Seedance 1.0 pro fast', durations: [2, 12], resolutions: ['480p', '720p', '1080p'], references: 0 },
];
export const DEFAULT_IMAGE_MODEL = IMAGE_MODELS[0].id;
export const DEFAULT_VIDEO_MODEL = VIDEO_MODELS[0].id;

/** 2K pixel sizes valid for every Seedream model above (total pixels within all their ranges). */
export const IMAGE_SIZES = {
  '1:1': '2048x2048', '4:3': '2304x1728', '3:4': '1728x2304', '16:9': '2848x1600',
  '9:16': '1600x2848', '3:2': '2496x1664', '2:3': '1664x2496', '21:9': '3136x1344',
};
export const VIDEO_RATIOS = ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'];

export class ArkError extends Error {
  constructor(message, { status, code } = {}) { super(message); this.name = 'ArkError'; this.status = status; this.code = code; }
}

const imageModel = (id) => IMAGE_MODELS.find((model) => model.id === id) ?? { id, maxRefs: 10, sequential: /seedream-(4-|5-0-2)/.test(id) };
const videoModel = (id) => VIDEO_MODELS.find((model) => model.id === id) ?? { id, durations: [2, 30], resolutions: ['480p', '720p', '1080p'], references: 9 };

/** Build the request bodies for one image generation: a single call, or parallel calls where a model lacks image sets. */
export function imageRequests({ model = DEFAULT_IMAGE_MODEL, prompt, images = [], ratio = 'auto', count = 1, watermark = false }) {
  if (typeof prompt !== 'string' || prompt.trim() === '') throw new ArkError('提示词不能为空');
  const spec = imageModel(model);
  if (images.length > spec.maxRefs) throw new ArkError(`${spec.label ?? model} 最多支持 ${spec.maxRefs} 张参考图，当前 ${images.length} 张`);
  const n = Math.max(1, Math.min(Math.floor(count), 15));
  const body = { model, prompt, size: IMAGE_SIZES[ratio] ?? '2K', response_format: 'b64_json', watermark };
  if (images.length === 1) body.image = images[0];
  else if (images.length > 1) body.image = images;
  if (spec.sequential) {
    if (n > 1) {
      if (images.length + n > 15) throw new ArkError(`参考图数量 + 生成数量不能超过 15（当前 ${images.length} + ${n}）`);
      body.sequential_image_generation = 'auto';
      body.sequential_image_generation_options = { max_images: n };
    } else {
      body.sequential_image_generation = 'disabled';
    }
    return [body];
  }
  return Array.from({ length: Math.min(n, 4) }, () => ({ ...body }));
}

/** Build the create-task body for one Seedance video. First/last frames and reference images are different task types. */
export function videoRequest({ model = DEFAULT_VIDEO_MODEL, prompt = '', firstFrame, lastFrame, references = [], ratio = 'adaptive', duration = 5, resolution = '720p', generateAudio = true, watermark = false }) {
  const spec = videoModel(model);
  const content = [];
  if (prompt.trim() !== '') content.push({ type: 'text', text: prompt });
  if (firstFrame !== undefined) {
    content.push({ type: 'image_url', image_url: { url: firstFrame }, role: 'first_frame' });
    if (lastFrame !== undefined) content.push({ type: 'image_url', image_url: { url: lastFrame }, role: 'last_frame' });
  } else if (lastFrame !== undefined) {
    throw new ArkError('尾帧需要同时提供首帧');
  } else if (references.length > 0) {
    if (spec.references === 0) throw new ArkError(`${spec.label ?? model} 不支持参考图生视频，请改用首帧或换模型`);
    if (references.length > spec.references) throw new ArkError(`${spec.label ?? model} 最多支持 ${spec.references} 张参考图`);
    for (const url of references) content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' });
  }
  if (content.length === 0) throw new ArkError('请提供提示词或图片');
  const [min, max] = spec.durations;
  const seconds = duration === -1 ? -1 : Math.max(min, Math.min(max, Math.round(duration)));
  return {
    model, content,
    ratio: VIDEO_RATIOS.includes(ratio) ? ratio : 'adaptive',
    duration: seconds,
    resolution: spec.resolutions.includes(resolution) ? resolution : spec.resolutions[Math.min(1, spec.resolutions.length - 1)],
    ...(/seedance-2/.test(model) ? { generate_audio: generateAudio } : {}),
    return_last_frame: true,
    watermark,
  };
}

/** Thin HTTP client; `fetchImpl` is injectable for tests. */
export function createArk({ apiKey, baseURL = ARK_BASE_URL, fetchImpl = globalThis.fetch }) {
  async function call(method, path, body, signal) {
    let response;
    try {
      response = await fetchImpl(baseURL + path, {
        method, signal,
        headers: { Authorization: 'Bearer ' + apiKey, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ArkError('无法连接火山方舟：' + (error?.message ?? String(error)));
    }
    const textBody = await response.text();
    let json;
    try { json = textBody ? JSON.parse(textBody) : {}; } catch { json = undefined; }
    if (!response.ok) {
      const code = json?.error?.code;
      const message = json?.error?.message ?? textBody.slice(0, 300);
      const hint = response.status === 401 ? '（API Key 无效或已过期）' : code === 'ModelNotOpen' || /not.*(open|activated)/i.test(message ?? '') ? '（请先在方舟控制台开通该模型）' : '';
      throw new ArkError(`火山方舟返回 ${response.status}${code ? ' ' + code : ''}：${message}${hint}`, { status: response.status, code });
    }
    if (json === undefined) throw new ArkError('火山方舟返回了无法解析的响应');
    return json;
  }

  return {
    /** Generate images; returns [{ data: Buffer, format, size }] plus per-image errors in image sets. */
    async generateImages(options, signal) {
      const results = await Promise.all(imageRequests(options).map((body) => call('POST', '/images/generations', body, signal)));
      const images = [], errors = [];
      for (const result of results) {
        for (const item of Array.isArray(result.data) ? result.data : []) {
          if (item.error) { errors.push(item.error.message ?? String(item.error.code)); continue; }
          if (typeof item.b64_json === 'string') images.push({ data: Buffer.from(item.b64_json, 'base64'), format: item.output_format ?? 'jpeg', size: item.size });
        }
      }
      if (images.length === 0) throw new ArkError(errors[0] ? '生成失败：' + errors[0] : '火山方舟没有返回图片');
      return { images, errors };
    },
    async createVideoTask(options, signal) {
      const result = await call('POST', '/contents/generations/tasks', videoRequest(options), signal);
      if (typeof result.id !== 'string') throw new ArkError('火山方舟没有返回任务 ID');
      return result.id;
    },
    async getVideoTask(id, signal) {
      return call('GET', '/contents/generations/tasks/' + encodeURIComponent(id), undefined, signal);
    },
    async download(url, signal) {
      const response = await fetchImpl(url, { signal });
      if (!response.ok) throw new ArkError(`下载生成结果失败（HTTP ${response.status}），链接 24 小时后会失效`);
      return Buffer.from(await response.arrayBuffer());
    },
  };
}

/**
 * The API key of the ark CLI's default profile (`~/.arkcli/config.yaml`), so a key configured
 * with `arkcli` works without entering it again. Returns undefined when absent or unreadable.
 */
export async function arkcliKey(file) {
  const { readFile } = await import('node:fs/promises');
  const { homedir } = await import('node:os');
  let text;
  try { text = await readFile(file ?? `${homedir()}/.arkcli/config.yaml`, 'utf8'); } catch { return undefined; }
  const unquote = (value) => value.trim().replace(/^(['"])(.*)\1$/, '$2');
  const profile = /^default_profile:\s*(.+)$/m.exec(text)?.[1];
  const lines = text.split('\n');
  let inProfile = false;
  for (const line of lines) {
    if (profile && /^ {2}\S/.test(line)) inProfile = unquote(line.trim().replace(/:$/, '')) === unquote(profile);
    const match = /^ {4}api_key:\s*(\S.*)$/.exec(line);
    if (match && (inProfile || !profile)) return unquote(match[1]) || undefined;
  }
  return undefined;
}
