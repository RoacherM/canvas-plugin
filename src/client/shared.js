/** Browser-side constants, copy, Host API, and resource-address helpers shared by the entry and the canvas chunk. */

export const PKG = '@local/dsh-canvas';
export const NS = 'local-canvas';
export const KIND = 'canvas';
export const CANVAS_EXT = '.dshcanvas';
export const CANVAS_TOOLS = ['canvas_read', 'canvas_edit', 'canvas_generate_image', 'canvas_generate_video'];

// ── Host API (document-relative, so it works on the Desktop dsh-app:// origin and on Web) ──

const endpoint = (path, query = {}) => {
  const url = new URL('api/canvas/' + path, document.baseURI);
  for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, value);
  return url;
};

async function request(method, path, { query, body, raw, signal } = {}) {
  const init = { method, credentials: 'same-origin', signal, headers: {} };
  if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  if (raw !== undefined) { init.body = raw; init.headers['Content-Type'] = 'application/octet-stream'; }
  const response = await fetch(endpoint(path, query), init);
  let json;
  try { json = await response.json(); } catch { json = undefined; }
  if (!response.ok) {
    const error = new Error(json?.error ?? `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return json;
}

export const api = {
  doc: (path, signal) => request('GET', 'doc', { query: { path }, signal }),
  version: (path, signal) => request('GET', 'version', { query: { path }, signal }),
  save: (path, doc, baseVersion) => request('POST', 'save', { body: { path, doc, baseVersion } }),
  importFile: (path, file) => request('POST', 'import', { query: { path, name: file.name || 'pasted.png' }, raw: file }),
  generate: (path, nodeId, mode) => request('POST', 'generate', { body: { path, nodeId, mode } }),
  list: (cwd) => request('GET', 'list', { query: { cwd } }),
  attach: (sessionId, path, ids) => request('POST', 'attach', { body: { sessionId, path, ids } }),
  focus: (path, cwd, selection) => request('POST', 'focus', { body: { path, cwd, selection } }),
  config: () => request('GET', 'config'),
  setKey: (apiKey) => request('POST', 'config', { body: { apiKey } }),
  mediaUrl: (absolute) => endpoint('media', { path: absolute }).href,
  library: (path) => request('GET', 'library', { query: { path } }),
  asset: (path, id) => request('GET', 'library/asset', { query: { path, id } }),
  libraryUpdate: (path, id, action, extra = {}) => request('POST', 'library/update', { body: { path, id, action, ...extra } }),
  saveToLibrary: (path, media) => request('POST', 'library/save', { body: { path, ...media } }),
  createLink: (path, url) => request('POST', 'library/link', { body: { path, url } }),
  history: (path, limit) => request('GET', 'history', { query: { path, limit } }),
};

// ── Paths and dsh-resource addresses ──

const FILE_PREFIX = 'dsh-resource://file/';
export function fileOfAddress(address) {
  if (typeof address !== 'string' || !address.startsWith(FILE_PREFIX)) return undefined;
  const end = address.search(/[?#]/);
  const [scope, ...rest] = address.slice(FILE_PREFIX.length, end === -1 ? undefined : end).split('/');
  try {
    if (scope === 'session') return { sessionId: decodeURIComponent(rest[0]), path: rest.slice(1).map(decodeURIComponent).join('/') };
    if (scope === 'absolute') return { path: '/' + rest.map(decodeURIComponent).join('/').replace(/^\/+/, '') };
  } catch { return undefined; }
  return undefined;
}
export const sessionFileAddress = (sessionId, path) => FILE_PREFIX + 'session/' + encodeURIComponent(sessionId) + '/' + path.split('/').map(encodeURIComponent).join('/');

export const isAbsolutePath = (path) => path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);
export const joinPath = (base, rel) => (isAbsolutePath(rel) ? rel : base.replace(/[\\/]+$/, '') + '/' + rel.replace(/^\.\//, ''));
export const dirOf = (path) => path.replace(/[\\/][^\\/]*$/, '');
export const baseName = (path) => path.replace(/^.*[\\/]/, '');
export const canvasName = (path) => baseName(path).replace(/\.dshcanvas$/i, '');
/** Absolute path of an asset reference stored in a canvas (relative to the canvas file). */
export const assetAbsolute = (canvasPath, ref) => joinPath(dirOf(canvasPath), ref);
/** Workspace-relative display of a path when it lives inside the workspace. */
export const relativeTo = (cwd, path) => (cwd && path.startsWith(cwd.replace(/[\\/]+$/, '') + '/') ? path.slice(cwd.replace(/[\\/]+$/, '').length + 1) : path);

// ── Copy ──

export const zh = {
  'type.label': '画布', 'guide.title': 'Canvas', 'guide.description': '无限画布：生图、生视频、情绪板与分镜',
  'picker.title': 'Canvas', 'picker.hint': '画布文件保存在工作区的 canvas/ 目录，Agent 也能读写它们。', 'picker.empty': '这个工作区还没有画布',
  'picker.new': '新建画布', 'picker.namePlaceholder': '画布名称，例如 角色设定', 'picker.create': '创建', 'picker.noWorkspace': '当前会话没有工作区，无法保存画布。',
  'picker.updated': '更新于 {time}', 'picker.loadFailed': '读取画布列表失败：{error}',
  loading: '正在加载画布…', 'load.failed': '画布加载失败：{error}', retry: '重试',
  'save.saved': '已保存', 'save.saving': '保存中…', 'save.merged': '已与 Agent 的修改合并', 'save.failed': '保存失败：{error}', 'save.pending': '有未保存的修改',
  'add.image': '图片', 'add.video': '视频', 'add.script': '分镜脚本', 'add.text': '文字', 'add.frame': '分组框', 'add.generator': '生成器', 'add.import': '导入素材', 'add.library': '素材库', fit: '适应视图',
  'menu.title': '添加节点', 'menu.image': '文生图 / 改图', 'menu.video': '文生 / 图生视频', 'menu.script': '镜头表', 'menu.text': '便签', 'menu.frame': '情绪板', 'menu.generator': '旧版，结果另起节点', 'menu.import': '图片或视频',
  'panel.image': '生成图片', 'panel.edit': '编辑这张图', 'panel.video': '生成视频', 'gen.promptEdit': '描述要怎么改这张图，例如：把背景改成雪夜…', 'gen.panelHint': '⌘↵', 'gen.runHint': '生成（⌘↵），结果成为这个节点的新版本', 'gen.countN': '{n} 张',
  'gen.useSelf': '参考当前图', 'gen.useSelfHint': '把节点当前显示的图片作为第一张参考图（改图）', 'gen.self': '当前图',
  'node.image': '图片节点', 'node.video': '视频节点', 'node.text': '文本',
  'hint.text2video': '文生视频', 'hint.firstFrame': '首帧生成视频', 'hint.firstLast': '首尾帧生成视频',
  'menu.fromTitle': '用这张图生成', 'menu.more': '更多',
  'lib.title': '素材库', 'lib.close': '关闭素材库', 'lib.count': '{n} 项', 'lib.search': '搜索名称、提示词、标签', 'lib.back': '返回', 'lib.name': '名称',
  'lib.tab.all': '全部', 'lib.tab.prompt': '提示词', 'lib.tab.image': '图片', 'lib.tab.video': '视频', 'lib.tab.link': '链接', 'lib.tab.history': '历史',
  'lib.kind.prompt': '提示词', 'lib.kind.image': '图片', 'lib.kind.video': '视频', 'lib.kind.link': '链接',
  'cat.all': '全部分类', 'cat.none': '未分类', 'cat.character': '角色', 'cat.scene': '场景', 'cat.prop': '道具', 'cat.style': '风格', 'cat.audio': '音频',
  'cat.filter': '按资产分类筛选', 'cat.assign': '资产分类', 'cat.save': '存入素材库', 'cat.saveHint': '把这张图存进素材库，并归入所选分类', 'cat.saved': '已存入素材库 · {cat}', 'cat.pick': '选择分类',
  'lib.emptyAll': '还没有素材。生成、导入或粘贴网址后会自动收进来。', 'lib.noMatch': '没有匹配的素材', 'lib.dragHint': '拖到画布上使用 · 点开看全部版本',
  'lib.versions': '{n} 个版本', 'lib.usedBy': '用在：{list}', 'lib.unused': '还没有画布用到', 'lib.noOutputs': '这个版本还没有生成过', 'lib.promptV': '提示词',
  'lib.apply': '用到选中节点', 'lib.place': '放到画布', 'lib.final': '设为定稿', 'lib.unfinal': '取消定稿', 'lib.finalLabel': '定稿', 'lib.imported': '导入',
  'lib.newVersionText': '新版本的提示词', 'lib.note': '版本备注', 'lib.notePlaceholder': '备注这一版改了什么（可选）', 'lib.saveAs': '存为 v{v}',
  'lib.linkPlaceholder': '粘贴网址，回车收藏', 'lib.addLink': '收藏', 'lib.linkAdding': '正在读取链接…', 'lib.noHistory': '还没有生成记录',
  'lib.justNow': '刚刚', 'lib.minutes': '{n} 分钟前', 'lib.hours': '{n} 小时前', 'lib.applied': '已把 v{v} 用到选中节点', 'lib.needTarget': '先选中一个图片或视频节点',
  'bind.title': '提示词「{name}」的 v{v}；改动后再生成会自动存成新版本', 'bind.modified': '已修改', 'bind.unbind': '解除绑定（下次生成另起新提示词）',
  'node.link': '链接', 'node.openLink': '打开链接',
  'guide.dbl': '双击画布', 'guide.free': '自由生成节点', 'guide.image': '图片生成', 'guide.video': '视频生成', 'guide.script': '分镜脚本', 'guide.text': '文本',
  'mode.select': '选择：拖动框选', 'mode.hand': '移动：拖动平移画布',
  'keys.title': '快捷键', 'keys.dblKey': '双击', 'keys.dbl': '添加节点', 'keys.gen': '生成', 'keys.del': '删除所选', 'keys.multi': '多选', 'keys.pan': '按住拖动平移', 'keys.zoom': '缩放',
  'ctl.minimap': '小地图', 'ctl.dragHint': '拖动工具栏 · 双击复位', 'ctl.mapDragHint': '拖动小地图 · 双击复位', 'ctl.edges': '隐藏节点连线', 'ctl.snap': '网格吸附', 'ctl.zoomIn': '放大', 'ctl.zoomOut': '缩小', 'ctl.zoomReset': '重置为 100%',
  'theme.toLight': '切换到浅色画布', 'theme.toDark': '切换到深色画布', 'node.empty': '选中后输入提示词生成', 'node.emptyVideo': '选中后输入提示词生成；左侧可连首帧、尾帧、参考图', 'node.emptySelected': '在下方面板输入提示词',
  'node.versions': '生成历史版本', 'node.prevVersion': '上一个版本', 'node.nextVersion': '下一个版本',
  'preset.upscale': '高清', 'preset.angle': '换角度', 'preset.light': '打光', 'preset.style': '风格', 'preset.grid': '九宫格',
  'script.title': '分镜脚本', 'script.summary': '{n} 镜 · {s} 秒', 'script.addRow': '加一镜', 'script.shootAll': '生成分镜图 ({n})', 'script.duration': '时长', 'script.description': '画面描述', 'script.prompt': '分镜提示词',
  'script.shoot': '生成', 'script.locate': '定位', 'script.generating': '生成中', 'script.removeRow': '删除这一镜', 'script.empty': '还没有镜头，点「加一镜」，或让 Agent 用 canvas_edit 写入分镜', 'script.shotLabel': '镜 {n}',
  fullscreen: '全屏', settings: '设置', 'send.selection': '附加到对话', 'send.none': '先在画布上选中卡片', 'send.done': '已附加 {n} 张卡片，会随你的下一条消息作为独立的画布上下文发送', 'attach.chip': '画布 {name} · {n} 张卡片', 'attach.hint': '随下一条消息以 <canvas_context> 独立发送，不会写进你的输入', 'attach.remove': '取消附加',
  'drop.hint': '松开以导入图片或视频', 'import.failed': '导入失败：{error}', 'import.progress': '正在导入 {n} 个文件…',
  'gen.image': '图片', 'gen.video': '视频', 'gen.prompt': '描述你想要的画面…', 'gen.promptVideo': '描述动作、镜头和声音…',
  'gen.model': '模型', 'gen.ratio': '比例', 'gen.count': '数量', 'gen.duration': '时长', 'gen.resolution': '分辨率', 'gen.audio': '声音', 'gen.watermark': '水印',
  'gen.run': '生成', 'gen.rerun': '再来一次', 'gen.running': '生成中… {s}s', 'gen.queued': '排队中… {s}s', 'gen.refs': '参考图 {n}', 'gen.first': '首帧', 'gen.last': '尾帧',
  'gen.noKey': '还没有配置 API Key', 'gen.connectHint': '把图片连到左侧圆点作为参考', 'gen.auto': '自动', 'gen.seconds': '{n} 秒',
  'node.useAsRef': '以此为参考生图', 'node.toVideo': '作为首帧生视频', 'node.continue': '用尾帧续写视频', 'node.open': '打开原图', 'node.delete': '删除',
  'node.prompt': '提示词', 'node.textPlaceholder': '输入文字…', 'frame.label': '分组',
  'settings.title': '火山方舟设置', 'settings.key': 'API Key', 'settings.configured': '已配置（来源：{source}）', 'settings.missing': '未配置',
  'settings.help': '在火山方舟控制台 → API Key 管理中创建长效 Key。Key 保存在 DSH 本地凭据库，不会写进画布或配置文件。',
  'settings.save': '保存', 'settings.clear': '清除', 'settings.close': '关闭', 'settings.saved': '已保存',
  'settings.models': '需要先在方舟控制台开通对应模型；Seedance 2.x 开通要求账户余额大于 200 元。',
  'tool.open': '在画布中打开', 'tool.canvas': '画布',
};

export const en = {
  'type.label': 'Canvas', 'guide.title': 'Canvas', 'guide.description': 'Infinite board for images, video, moodboards and storyboards',
  'picker.title': 'Canvas', 'picker.hint': 'Canvases live in the workspace canvas/ folder, where the agent can read and edit them too.', 'picker.empty': 'No canvases in this workspace yet',
  'picker.new': 'New canvas', 'picker.namePlaceholder': 'Canvas name, e.g. characters', 'picker.create': 'Create', 'picker.noWorkspace': 'This session has no workspace to save a canvas in.',
  'picker.updated': 'Updated {time}', 'picker.loadFailed': 'Could not list canvases: {error}',
  loading: 'Loading canvas…', 'load.failed': 'Could not load the canvas: {error}', retry: 'Retry',
  'save.saved': 'Saved', 'save.saving': 'Saving…', 'save.merged': 'Merged with the agent\'s changes', 'save.failed': 'Save failed: {error}', 'save.pending': 'Unsaved changes',
  'add.image': 'Image', 'add.video': 'Video', 'add.script': 'Storyboard', 'add.text': 'Text', 'add.frame': 'Frame', 'add.generator': 'Generator', 'add.import': 'Import', 'add.library': 'Library', fit: 'Fit view',
  'menu.title': 'Add node', 'menu.image': 'text to image / edit', 'menu.video': 'text / image to video', 'menu.script': 'shot list', 'menu.text': 'note', 'menu.frame': 'moodboard', 'menu.generator': 'legacy, results beside it', 'menu.import': 'image or video',
  'panel.image': 'Generate image', 'panel.edit': 'Edit this image', 'panel.video': 'Generate video', 'gen.promptEdit': 'Describe the change, e.g. make the background a snowy night…', 'gen.panelHint': '⌘↵', 'gen.runHint': 'Generate (⌘↵); results become new versions of this node', 'gen.countN': '×{n}',
  'gen.useSelf': 'Use current image', 'gen.useSelfHint': 'Send the image this node shows as the first reference (editing)', 'gen.self': 'current image',
  'node.image': 'Image node', 'node.video': 'Video node', 'node.text': 'Text',
  'hint.text2video': 'Text to video', 'hint.firstFrame': 'From a first frame', 'hint.firstLast': 'First + last frame',
  'menu.fromTitle': 'Make from this image', 'menu.more': 'More',
  'lib.title': 'Library', 'lib.close': 'Close library', 'lib.count': '{n} items', 'lib.search': 'Search names, prompts, labels', 'lib.back': 'Back', 'lib.name': 'Name',
  'lib.tab.all': 'All', 'lib.tab.prompt': 'Prompts', 'lib.tab.image': 'Images', 'lib.tab.video': 'Videos', 'lib.tab.link': 'Links', 'lib.tab.history': 'History',
  'lib.kind.prompt': 'Prompt', 'lib.kind.image': 'Image', 'lib.kind.video': 'Video', 'lib.kind.link': 'Link',
  'cat.all': 'All categories', 'cat.none': 'Uncategorised', 'cat.character': 'Character', 'cat.scene': 'Scene', 'cat.prop': 'Prop', 'cat.style': 'Style', 'cat.audio': 'Audio',
  'cat.filter': 'Filter by asset category', 'cat.assign': 'Asset category', 'cat.save': 'Save to library', 'cat.saveHint': 'Save this image to the library under the chosen category', 'cat.saved': 'Saved to library · {cat}', 'cat.pick': 'Choose a category',
  'lib.emptyAll': 'Nothing yet. Generations, imports and pasted links land here.', 'lib.noMatch': 'No matches', 'lib.dragHint': 'Drag onto the canvas · open for all versions',
  'lib.versions': '{n} versions', 'lib.usedBy': 'Used in: {list}', 'lib.unused': 'Not used by any canvas', 'lib.noOutputs': 'Nothing generated from this version yet', 'lib.promptV': 'Prompt',
  'lib.apply': 'Use on selected node', 'lib.place': 'Place on canvas', 'lib.final': 'Mark final', 'lib.unfinal': 'Unmark final', 'lib.finalLabel': 'final', 'lib.imported': 'Imported',
  'lib.newVersionText': 'Prompt of the new version', 'lib.note': 'Version note', 'lib.notePlaceholder': 'What changed (optional)', 'lib.saveAs': 'Save as v{v}',
  'lib.linkPlaceholder': 'Paste a URL and press Enter', 'lib.addLink': 'Save', 'lib.linkAdding': 'Reading the link…', 'lib.noHistory': 'No generations yet',
  'lib.justNow': 'just now', 'lib.minutes': '{n} min ago', 'lib.hours': '{n} h ago', 'lib.applied': 'v{v} is now on the selected node', 'lib.needTarget': 'Select an image or video node first',
  'bind.title': 'v{v} of prompt “{name}”; edit and generate to save a new version', 'bind.modified': 'edited', 'bind.unbind': 'Unbind (the next generation starts a new prompt)',
  'node.link': 'Link', 'node.openLink': 'Open link',
  'guide.dbl': 'Double-click the canvas', 'guide.free': 'to add any node', 'guide.image': 'Image', 'guide.video': 'Video', 'guide.script': 'Storyboard', 'guide.text': 'Text',
  'mode.select': 'Select: drag to box-select', 'mode.hand': 'Hand: drag to pan',
  'keys.title': 'Shortcuts', 'keys.dblKey': 'Double-click', 'keys.dbl': 'Add a node', 'keys.gen': 'Generate', 'keys.del': 'Delete selection', 'keys.multi': 'Multi-select', 'keys.pan': 'Hold and drag to pan', 'keys.zoom': 'Zoom',
  'ctl.minimap': 'Minimap', 'ctl.dragHint': 'Drag toolbar · Double-click to reset', 'ctl.mapDragHint': 'Drag minimap · Double-click to reset', 'ctl.edges': 'Hide connections', 'ctl.snap': 'Snap to grid', 'ctl.zoomIn': 'Zoom in', 'ctl.zoomOut': 'Zoom out', 'ctl.zoomReset': 'Reset to 100%',
  'theme.toLight': 'Light canvas', 'theme.toDark': 'Dark canvas', 'node.empty': 'Select it and type a prompt', 'node.emptyVideo': 'Select it and type a prompt; connect first/last frame or references on the left', 'node.emptySelected': 'Type a prompt in the panel below',
  'node.versions': 'Generated versions', 'node.prevVersion': 'Previous version', 'node.nextVersion': 'Next version',
  'preset.upscale': 'Upscale', 'preset.angle': 'New angle', 'preset.light': 'Relight', 'preset.style': 'Style', 'preset.grid': '3×3 grid',
  'script.title': 'Storyboard', 'script.summary': '{n} shots · {s}s', 'script.addRow': 'Add shot', 'script.shootAll': 'Make shot images ({n})', 'script.duration': 'Sec', 'script.description': 'Description', 'script.prompt': 'Image prompt',
  'script.shoot': 'Make', 'script.locate': 'Show', 'script.generating': 'Working', 'script.removeRow': 'Remove shot', 'script.empty': 'No shots yet: add one, or ask the agent to fill the storyboard with canvas_edit', 'script.shotLabel': 'Shot {n}',
  fullscreen: 'Fullscreen', settings: 'Settings', 'send.selection': 'Attach to chat', 'send.none': 'Select cards on the canvas first', 'send.done': 'Attached {n} cards; they go with your next message as separate canvas context', 'attach.chip': 'Canvas {name} · {n} cards', 'attach.hint': 'Sent with your next message as a separate <canvas_context>, never mixed into your text', 'attach.remove': 'Remove attachment',
  'drop.hint': 'Drop to import images or videos', 'import.failed': 'Import failed: {error}', 'import.progress': 'Importing {n} files…',
  'gen.image': 'Image', 'gen.video': 'Video', 'gen.prompt': 'Describe the image…', 'gen.promptVideo': 'Describe motion, camera and sound…',
  'gen.model': 'Model', 'gen.ratio': 'Ratio', 'gen.count': 'Count', 'gen.duration': 'Length', 'gen.resolution': 'Resolution', 'gen.audio': 'Sound', 'gen.watermark': 'Watermark',
  'gen.run': 'Generate', 'gen.rerun': 'Again', 'gen.running': 'Generating… {s}s', 'gen.queued': 'Queued… {s}s', 'gen.refs': '{n} refs', 'gen.first': 'First frame', 'gen.last': 'Last frame',
  'gen.noKey': 'No API key yet', 'gen.connectHint': 'Connect images to the left dot as references', 'gen.auto': 'Auto', 'gen.seconds': '{n}s',
  'node.useAsRef': 'Generate from this', 'node.toVideo': 'Animate as first frame', 'node.continue': 'Continue from last frame', 'node.open': 'Open original', 'node.delete': 'Delete',
  'node.prompt': 'Prompt', 'node.textPlaceholder': 'Type…', 'frame.label': 'Group',
  'settings.title': 'Volcengine Ark', 'settings.key': 'API key', 'settings.configured': 'Configured (source: {source})', 'settings.missing': 'Not configured',
  'settings.help': 'Create a long-lived key under Ark console → API Key management. It is kept in the DSH credential store, never in the canvas or config files.',
  'settings.save': 'Save', 'settings.clear': 'Clear', 'settings.close': 'Close', 'settings.saved': 'Saved',
  'settings.models': 'Enable the models in the Ark console first; Seedance 2.x requires an account balance above ¥200.',
  'tool.open': 'Open in canvas', 'tool.canvas': 'Canvas',
};

export const format = (template, params = {}) => String(template).replace(/\{(\w+)\}/g, (all, key) => (params[key] === undefined ? all : String(params[key])));
