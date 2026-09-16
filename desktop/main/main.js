'use strict';
/**
 * UED WorkBuddy 桌面版 · Electron 主进程
 *
 * 只做四件事：开窗口、管项目文件夹、管每个项目的 Claude 会话、把产物送出去。
 * 界面在 renderer/，引擎在 engine.js，交付在 handoff.js。
 */
const { app, BrowserWindow, ipcMain, protocol, net, shell, dialog, clipboard, Menu } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');
const { detectClaude, ClaudeSession } = require('./engine');
const { loginEnv } = require('./shellenv');
const { buildHandoff } = require('./handoff');
const { check: feiqueCheck } = require('./feique-check');

const ROOT = path.join(__dirname, '..');
/* 打包后代码住在 app.asar 里：应用自己读得到，但拉起的 Claude 是外部进程，读不到 asar。
   所以飞鹊包按 asarUnpack 解在 app.asar.unpacked 下，给 Claude 的路径必须指到那里。 */
const REAL_ROOT = ROOT.replace(/app\.asar(?=[\/\\]|$)/, 'app.asar.unpacked');
const PACK_DIR = path.join(fs.existsSync(path.join(REAL_ROOT, 'packs', 'feique', 'DESIGN.md')) ? REAL_ROOT : ROOT, 'packs', 'feique');
const CAPS = JSON.parse(fs.readFileSync(path.join(ROOT, 'packs', 'capabilities.json'), 'utf8'));
const WIZARDS = JSON.parse(fs.readFileSync(path.join(ROOT, 'packs', 'wizards.json'), 'utf8'));   // 线上 UW 的 18 张向导，原样搬
const SETTINGS_FILE = path.join(os.homedir(), '.uw-desktop', 'settings.json');

const DEFAULTS = {
  workspaceDir: path.join(os.homedir(), 'UW工作区'),
  permissionMode: 'acceptEdits',   // 文件改动自动放行，跑命令要问；这是 Claude Code 自己的档位
  model: '',
  claudePath: '',
  handoffRepoDir: path.join(os.homedir(), 'UW工作区', '_交付仓库'),
  frontendName: '',
  role: 'design',
};

let win = null;
let quitting = false;
let settings = loadSettings();
let engine = null;                 // detectClaude 结果
const sessions = new Map();        // projectId → ClaudeSession
const watchers = new Map();        // projectId → fs.FSWatcher

function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }; } catch (e) { return { ...DEFAULTS }; }
}
function saveSettings(s) {
  settings = { ...settings, ...s };
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  return settings;
}

/* 每次检测都把结果落一份到 ~/.uw-desktop/diagnostics.json。
   同事说「找不到Claude」时，让他把这个文件发过来就行，不用靠截图猜。 */
function writeDiagnostics() {
  try {
    const { info } = loginEnv();
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(path.join(path.dirname(SETTINGS_FILE), 'diagnostics.json'), JSON.stringify({
      at: new Date().toISOString(),
      app: app.getVersion(), electron: process.versions.electron, platform: process.platform, arch: process.arch,
      launchedFrom: /^\/usr\/bin:\/bin:\/usr\/sbin:\/sbin\/?$/.test(String(process.env.PATH || '')) ? 'GUI（访达/程序坞，PATH是最小集）' : '终端或已继承完整PATH',
      processPath: process.env.PATH || '',
      shellEnv: info,
      engine: engine ? { ok: engine.ok, path: engine.path || null, version: engine.version || null, viaFcf: !!engine.viaFcf, message: engine.message || null, tried: engine.tried || [] } : null,
      settingsClaudePath: settings.claudePath || '',
    }, null, 2));
  } catch (e) {}
}

/* ── 项目：~/UW工作区/<id>/，元数据在 .uw/project.json ── */
function projDir(id) { return path.join(settings.workspaceDir, id); }
function metaPath(id) { return path.join(projDir(id), '.uw', 'project.json'); }
function readMeta(id) { try { return JSON.parse(fs.readFileSync(metaPath(id), 'utf8')); } catch (e) { return null; } }
function writeMeta(id, m) { fs.mkdirSync(path.dirname(metaPath(id)), { recursive: true }); fs.writeFileSync(metaPath(id), JSON.stringify(m, null, 2)); }

function listProjects() {
  fs.mkdirSync(settings.workspaceDir, { recursive: true });
  const out = [];
  for (const name of fs.readdirSync(settings.workspaceDir)) {
    if (name.startsWith('_') || name.startsWith('.')) continue;
    const m = readMeta(name);
    if (!m) continue;
    out.push({ id: name, ...m, running: sessions.has(name) && sessions.get(name).busy });
  }
  return out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function listFiles(id) {
  const base = projDir(id);
  const out = [];
  (function walk(d) {
    for (const n of fs.readdirSync(d)) {
      if (n === '.uw' || n === '.git' || n === 'node_modules' || n === '.DS_Store') continue;
      const p = path.join(d, n); const st = fs.statSync(p);
      if (st.isDirectory()) walk(p); else out.push({ rel: path.relative(base, p), size: st.size, mtime: st.mtimeMs });
    }
  })(base);
  return out.sort((a, b) => a.rel.localeCompare(b.rel, 'zh'));
}

function watchProject(id) {
  if (watchers.has(id)) return;
  try {
    const w = fs.watch(projDir(id), { recursive: true }, (ev, fn) => {
      if (fn && String(fn).startsWith('.uw')) return;
      win && win.webContents.send('files:changed', { id });
    });
    watchers.set(id, w);
  } catch (e) {}
}

function createProject({ name, role, scene, input }) {
  const d = new Date(); const p = n => String(n).padStart(2, '0');
  let id = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${String(name).trim().replace(/[\/\\:*?"<>|]+/g, '-').slice(0, 30) || '项目'}`;
  let k = 2; const base = id;
  while (fs.existsSync(projDir(id))) id = `${base}-${k++}`;
  fs.mkdirSync(projDir(id), { recursive: true });
  const meta = { name: String(name).trim(), role, scene, input: input || '', createdAt: Date.now(), updatedAt: Date.now(), sessionId: null, messages: [] };
  writeMeta(id, meta);
  if (input && input.trim()) fs.writeFileSync(path.join(projDir(id), '需求输入.md'), `# ${meta.name}\n\n${input.trim()}\n`);
  return { id, ...meta };
}

function appendMessage(id, msg) {
  const m = readMeta(id); if (!m) return;
  m.messages = (m.messages || []).concat([{ ...msg, at: Date.now() }]).slice(-200);
  m.updatedAt = Date.now();
  writeMeta(id, m);
}

/* 在工作区根目录放一份 CLAUDE.md。
   系统提示词只在应用里有效——用户点「在终端打开」接力过去之后就没了，
   而 CLAUDE.md 是 Claude Code 自己从 cwd 往上找的，两条路都吃得到。
   带指纹：用户自己改过就不再覆盖。 */
const GUIDE_MARK = '<!-- uw-desktop-generated v1 -->';
function ensureWorkspaceGuide() {
  try {
    const f = path.join(settings.workspaceDir, 'CLAUDE.md');
    /* 这儿可能已经有别人（网页版那条路）写的 CLAUDE.md。不覆盖：
       把我们这段追加在后面，用指纹圈住自己那块，以后只替换自己这块。 */
    let head = '';
    if (fs.existsSync(f)) {
      const cur = fs.readFileSync(f, 'utf8');
      const i = cur.indexOf(GUIDE_MARK);
      head = (i >= 0 ? cur.slice(0, i) : cur).trimEnd();
      if (head) head += '\n\n---\n\n';
    }
    const kb = knowledgeDir();
    const txt = [GUIDE_MARK, '# 在这个工作区里干活的约定', '',
      '这里的每个子目录是一个任务，产物就落在那个子目录里。', '',
      '## 飞鹊设计系统（做任何MIC界面之前）', '',
      `飞鹊包在 \`${PACK_DIR}\`：`, '',
      '- `DESIGN.md` —— 字号、颜色、间距、圆角、按钮层级、视觉死命令。**先读它。**',
      '- `COMPONENT-USAGE.md` —— **组件用法清册**（从 Figma 组件库读出来的真值：48 个组件的 key／节点号／尺寸／全部 variant 维度／设计师说明）。做页头页脚、产品卡、筛选栏、表单、弹层先读它。🔴 props 永远准，description 会过时；页名里的 ✅🤖 都是做完了，❌ 是不需要做。',
      '- `docs/css/INDEX.md` —— **砖表**：飞鹊 28 类组件的网页实现，一类一个文件（按钮/分页/输入框/下拉/级联/勾选/单选/开关/上传/步骤条/抽屉/Tabs/列表/面包屑/气泡/全局提示/加载/骨架/空状态/滚动条/徽标/标签/提示条/文本域/数字输入/按钮式选择/投影/reset）。做网页**先读它**，按这一页要用的 `cat docs/css/{_reset,btn,inp,…}.css` 读出来（带上 `_reset.css`，28 个全抄也才 73KB），**原样贴进 `<style>`**。🔴 **别重定向到文件**——那样内容没进你眼里，只会凭印象重写；贴完**不许改值**。**不自己写一套按钮 / 输入框 / 提示条**，也不发明飞鹊没有的变体。用法铁律在 `docs/飞鹊组件使用经验和规范.md` 第零、一节；权威源是 `docs/飞鹊Web组件库.css`（砖表是它按组件切开的，内容一样）。',
      '- `web-components.json` / `mobile-components.json` —— 组件清册。按钮、输入框、卡片、**页头页脚、LOGO、认证标**都在里面，每条带 Figma 的 key 和节点号、尺寸、颜色规则。',
      '- `brand/INDEX.md` —— **品牌与认证标识 18 个**：MIC LOGO、STS 担保交易、Audited 认证、Leading Factory 标杆工厂、钻石/金牌会员、供应商星级、评分条。🔴 这些标里的字**是矢量图形不是文字**，一律内联真 SVG，**一个都不许自己画或用文字拼**。',
      '- `icons/INDEX.md` —— **295 个 UI 图标的检索索引**。🔴 按用途查这份，别靠文件名猜：要「Chat Now」的图标时搜 chat 只会命中 wechat（微信），真正的聊天图标叫 `tm.svg`（TM = Trade Manager）。索引里还列了 7 个文件名拼错的（`maill-send` 双 l、`ind-apprel` 少 a…），搜正确拼写一个都搜不到。', '',
      '**要放一个现成元素时的顺序：brand/INDEX.md（品牌认证标）→ icons/INDEX.md（UI 图标）→ 组件清册（页头页脚、产品卡这类）。**',
      '🔴 品牌红 `#DA291C` 只属于 LOGO，界面主色是 `#E64545`，两个别混。',
      '🔴 品牌标识、页头、页脚、导航是MIC既有的东西，属于照抄范围，不是设计空间。三处都找不到就留灰色占位块并写明「待补真资产」——**不许自己画一个看着差不多的**。', '',
      ...(kb ? ['## 部门知识库', '', `路径 \`${kb.dir}\`（${kb.from}）。先读里面的 \`${kb.index}\`（一份索引，一行一个指针），按索引挑相关的几份读。`,
                '做搜索 / 询盘 / 交易订单 / TM / RFQ / 商机融合 / 会员 / 运营相关的活，先走这一步，别凭记忆答、也别grep满硬盘找。', ''] : []),
      '## 交付', '',
      '产物一律落文件。做完写一份 `交付说明.md`：页面结构、状态清单、token 对照、每个决策的「为什么」、未定项。', '',
      '文案里中文与英文、数字之间不加空格（部门口径）。', ''].join('\n');
    fs.mkdirSync(settings.workspaceDir, { recursive: true });
    fs.writeFileSync(f, head + txt);
  } catch (e) {}
}

/* ── 部门知识库 ────────────────────────────────────
   Claude Code 的 memory 是按工作目录分的：终端里 cwd 是家目录，能拿到 542 份沉淀；
   应用的 cwd 是 ~/UW工作区/<项目>，那是个新路径，memory 目录是空的——
   所以应用里的 Claude 对飞鹊、对业务的「记忆」等于零，只能满硬盘 grep。
   这里主动把真正那个 memory 目录找出来，加进可读范围并在提示词里点名。 */
let _kb = undefined;
let _rt;
/* 还原工具链在哪。跟 knowledgeDir 同一个套路：本机装了 skill 就用本机的（脚本最新、
   puppeteer 依赖也齐），同事那台回落到随应用带的那份。两边都没有就返回 null，
   提示词会降级成「只守规矩、不指路径」。 */
function restoreToolsDir() {
  if (_rt !== undefined) return _rt;
  _rt = null;
  const local = path.join(os.homedir(), '.claude', 'skills', 'mic-fullstack', 'scripts');
  if (fs.existsSync(path.join(local, 'online-reach', 'geom-check.js'))) return (_rt = { dir: local, from: '本机 skill' });
  const packed = path.join(process.resourcesPath || '', 'restore-tools');
  if (fs.existsSync(path.join(packed, 'online-reach', 'geom-check.js'))) _rt = { dir: packed, from: '随应用携带' };
  return _rt;
}

function knowledgeDir() {
  if (_kb !== undefined) return _kb;
  _kb = null;
  /* ① 这台机器上有活的 auto-memory 就优先用它（内容最新、也最全）。
        只有把 skill 装全、并且自己在攒沉淀的人才有——实际上就吉吉那台。 */
  try {
    const base = path.join(os.homedir(), '.claude', 'projects');
    let best = null, bestN = 0;
    for (const d of fs.readdirSync(base)) {
      const m = path.join(base, d, 'memory');
      if (!fs.existsSync(path.join(m, 'MEMORY.md'))) continue;
      const n = fs.readdirSync(m).length;
      if (n > bestN) { bestN = n; best = m; }
    }
    if (best && bestN > 20) _kb = { dir: best, index: 'MEMORY.md', from: '本机知识库' };
  } catch (e) {}
  /* ② 同事机器上没有 ①，用随应用带的那份（跟 ① 同源，由 build/gen-pack-docs.py 导出）。
        没有这一层，同事的应用等于「什么都不懂」——这正是「客户端不如终端」的大头。 */
  if (!_kb) {
    /* 打包后走 extraResources（在 Contents/Resources/kbdocs，不在 asar 里）；开发时用仓库里那份 */
    const d = app.isPackaged ? path.join(process.resourcesPath, 'kbdocs') : path.join(ROOT, 'kbdocs');
    if (fs.existsSync(path.join(d, 'INDEX.md'))) _kb = { dir: d, index: 'INDEX.md', from: '随应用携带' };
  }
  return _kb;
}

/* ── Figma 改动记账 ─────────────────────────────────
   做 Figma 稿时产物不在项目目录里，应用本来什么都不知道，交付那条路也就断了。
   这里不靠模型自觉写记录，直接从工具调用里抓：`use_figma` 必带 fileKey 和一句 description，
   `get_screenshot` / `download_assets` 还必带 nodeId —— 都是必填参数，抓得到就是真的。 */
const FIGMA_TOOLS = /figma/i;
function figmaPath(id) { return path.join(projDir(id), '.uw', 'figma.json'); }
function readFigma(id) { try { return JSON.parse(fs.readFileSync(figmaPath(id), 'utf8')); } catch (e) { return { changes: [], files: {} }; } }
function recordFigma(id, name, input) {
  if (!FIGMA_TOOLS.test(name || '')) return null;
  const i = input || {};
  const fileKey = i.fileKey || null;
  if (!fileKey) return null;
  const nodeIds = [];
  if (i.nodeId) nodeIds.push(String(i.nodeId).replace('-', ':'));
  /* use_figma 没有 nodeId 参数，节点号写在脚本里。只认被引号包住、形如 123:456 的，
     宁可少抓也别把代码里别的数字当成节点。 */
  if (typeof i.code === 'string') {
    for (const m of i.code.matchAll(/['"](\d{1,7}[:-]\d{1,7})['"]/g)) {
      const v = m[1].replace('-', ':');
      if (!nodeIds.includes(v)) nodeIds.push(v);
    }
  }
  const short = String(name).split('__').pop();
  const rec = { at: Date.now(), tool: short, fileKey, nodeIds: nodeIds.slice(0, 12),
    desc: String(i.description || '').slice(0, 200) };
  const d = readFigma(id);
  d.changes = (d.changes || []).concat([rec]).slice(-200);
  d.files = d.files || {};
  d.files[fileKey] = { lastAt: rec.at, lastNode: nodeIds[0] || (d.files[fileKey] || {}).lastNode || null };
  try { fs.mkdirSync(path.dirname(figmaPath(id)), { recursive: true }); fs.writeFileSync(figmaPath(id), JSON.stringify(d, null, 2)); } catch (e) {}
  return rec;
}

/* ── 引擎会话 ── */
function systemPrompt(meta) {
  return [
    '你在「UED WorkBuddy桌面版」（UED WorkBuddy）里工作。这是一个给产品、设计、前端共用的工作台，用户在界面上看到的是你的回答、你每一步用了什么工具、以及当前目录里文件的实时预览。',
    `当前项目「${meta.name}」的文件夹就是你的工作目录；写到这里的HTML会自动出现在右侧预览，所以产物一律落文件，不要只在回答里贴代码。`,
    `飞鹊设计系统（MIC前台）随应用携带，路径${PACK_DIR}：做任何MIC界面先读DESIGN.md。`,
    /* ↓ 2026-09-10 加：上一版只写了「图标只用icons/里的SVG」，结果模型把「找现成资源」这件事
       框死在icons目录里——它13次打开飞鹊包，每次都只在icons/ grep图标名，从没想过去清册里查LOGO，
       最后照印象手画了一个品牌LOGO。清册里其实早就有 mic-logo 这条（连品牌红#DA291C都写了）。
       所以这里把查找顺序写死，并且点名「不是图标的那些东西」在哪。 */
    ...(knowledgeDir() ? [`【有部门知识库，别凭记忆答】路径${knowledgeDir().dir}（${knowledgeDir().from}），先读里面的${knowledgeDir().index} —— 那是一份索引，一行一个指针；按索引挑相关的几份读，别整个目录乱翻、也别用grep满硬盘找。做任何MIC业务相关的活（搜索/询盘/交易订单/TM/RFQ/商机融合/会员/运营）之前先走这一步。里面有业务知识、方法论判据、各专项做法三类。🔴🔴 **「各专项做法」那一类就是 17 个子 skill 的全文**，在该目录的 skill/ 子目录下（skill/figma-to-html-feique.md ／ skill/MIC-交互.md ／ skill/MIC-验收.md …），跟终端里那套同源、逐字节相同。**要读子 skill 一律从这儿读。**🔴 别去 cat ~/.claude/skills/mic-fullstack/…… —— 那个路径只在装了 skill 的机器上存在，同事机器上是空的，而 cat 一个不存在的文件不会报错、只会返回空，你会以为「读过了」然后凭印象裸做。`] : []),
    `【要放一个现成元素时，按这个顺序找，别跳到"自己画"】① **品牌与认证标识**看 ${PACK_DIR}/brand/INDEX.md（18 个：MIC LOGO、STS 担保交易、Audited 认证、Leading Factory、钻石/金牌会员、供应商星级、评分条）——🔴 这些标里的字**是矢量图形不是文字节点**，拿彩色文字拼出来足够像、以至于没人会再去核对，一律 cat 真 SVG 整段内联。🔴🔴 **同名不等于同一个**（2026-09-16 实测）：brand/mic-logo.svg 是 240×46、品牌红 #DA291C；而搜索结果页页头里那个 LOGO 是 218×42、界面红 #E64545 —— 两个都叫 mic-logo，字节数只差 12，拿错了尺寸和颜色全错、而且肉眼看不出来。**页面里的元素一律从它所在的那个节点导**（download_assets 传那个页头节点的 id），brand/ 只用于「页面上本来没有、要单独摆一个标识」的场合。🔴 品牌红 #DA291C ≠ 界面主色 #E64545，别混。② **UI 图标**查 ${PACK_DIR}/icons/INDEX.md（295 个的检索索引，按用途找）——🔴 别靠文件名猜：要 Chat Now 的图标时搜 chat 只命中 wechat（微信），真正的聊天图标是 tm.svg（TM＝Trade Manager）；另有 7 个文件名拼错的也在索引里点了名。③ **页头页脚、产品卡、筛选侧栏、表单、弹层、日期选择**这类业务组件：先读 ${PACK_DIR}/COMPONENT-USAGE.md（**组件用法清册**，从 Figma 组件库逐页读出来的真值：每个组件的 key／节点号／尺寸／**全部 variant 维度**／设计师写的说明，比如 MIC Footer Search 有 1440/1366/1280/1024 四个断点、date picker 是 status×size×state×range 共 108 个组合、popover 有 12 个方位）。🔴 **props／variant 是机器读的永远准；description 是人写的会过时**，两者打架以 props 为准。🔴 组件库页名里的 ✅ 和 🤖 都是「已做完」，❌ 是「不需要做」，不是没做。清册里没有的再查 ${PACK_DIR}/web-components.json（移动端 mobile-components.json）。🔴🔴 **figma 的工具是延迟加载的，一开始不在你的工具表里，直接调会失败** —— 必须先跑一次 ToolSearch("select:mcp__plugin_figma_figma__get_metadata,mcp__plugin_figma_figma__download_assets") 把它们捞出来。2026-09-15 实测：模型读懂了「用 download_assets 导出真资产」，却因为手边没这个工具，一次没试就直接跳到「留占位」那条兜底了。**取资产四步**：① ToolSearch 捞工具 ② get_metadata(fileKey, nodeId) 看结构（业务组件多是 component set，挑你要的那个子节点 id。🔴🔴 **variant 维度不止 breakpoint，而且组件名会骗人**（2026-09-16 实测）：header-home 听着像只有首页页头，实际是 pageType(home/**search-result**) × breakpoint(1024/1280/1366/1440/1920) 共 10 个 variant —— 做搜索结果页要挑 「pageType=search-result,breakpoint=1440」（1440×**142**），挑成 home 档（1440×123）就少了一整行 Related Searches，差的那 19px 不量是发现不了的。**先 get_metadata 把 variant 全列出来再挑，别按组件名猜库里有没有** —— 那次就是因为名字叫 header-home，直接判定「库里只有首页页头」，转头自己拿 .inp+.btn 拼了一个。）③ download_assets(fileKey, 子节点id, defaultFormat 传 svg) 拿到 URL ④ 立刻 curl -sL -o 文件 "URL"（URL 短命），再跑 python3 ${PACK_DIR}/tools/clean-figma-svg.py <文件> 清掉 Figma 画布杂质（组件集的紫色虚线框、画布底色，不清会在页面上多一块灰底加紫框）。🔴 **「留灰色占位块」是导不到时的兜底，不是第一选择；没试过就留占位＝没做。**`,

    /* ↓ 2026-09-16 加：治「做 MIC 已有页面还原不到 1:1」。
       真因不是缺指令 —— 下面 download_assets 四步、还原四步、参照物、geom-check 全都写着。
       真因是**缺一个分流判断**：场景卡（尤其 vibe）给的是一条具体、自洽、纯 Bash 就能走完的路
       （读砖表 → cat CSS → 贴 → 截图看一眼），阻力最小，于是把这些笼统的全局指令全盖掉了。
       2026-09-15 实测那次：它读到了 FilterItem/FilterSidebar 的存在，却一次 ToolSearch 都没捞、
       一次 download_assets 都没调，页头和搜索框从头到尾没取过一个像素值。
       所以这里把「这次到底是还原活还是设计活」提成开工第一问，并写明判错的代价不对称。 */
    '【开工先分流·这一步决定后面所有做法，不许跳】动手写网页之前先答一句，写在回答第一行：这次要做的页面，MIC线上有没有同类页？判断标准是「线上有没有这个页」，不是「我想不想做得像」。\n· **有**（搜索结果／询盘／产详／列表／店铺／登录注册／结算／消息…）＝ 这是**还原活，不是设计活**。页头、搜索框、筛选侧栏、产品卡、页脚这些**一个像素都不许自己定**：按下面【还原线上页面】那四步取真值 → 每个元素打 data-node-id → 跑 geom-check 到全绿 exit 0 才算完。还原活的第一步**不是读砖表拼装，是取真值建 manifest**；砖表只管通用控件（按钮／输入框／勾选／分页），业务组件一律按真节点导。\n  🔴 **此时场景卡里「先快速出一版」「打开线上看一眼当参照」「截图没明显错位就交」这类话一律作废** —— 那几句是给从零设计写的，照着做就会得到「看着像、每个值都不对」。\n· **没有**（线上没有同类页的新页面）＝ 设计活，照场景卡的做法走，按DESIGN.md的规范值自由发挥。\n🔴 **判错的代价不对称**：把还原活当设计活做，结果是每个值都不对，而且**没有任何门会报红**（门要先有manifest才有基准，没建就等于没有尺子）；反过来把设计活当还原活做，最多多花几分钟取真值。**拿不准就当还原活。**',
    `【开工第一步·先看砖表】做任何网页产物，第一件事是读${PACK_DIR}/docs/css/INDEX.md——飞鹊28类组件的网页实现清单（按钮/分页/输入框/数字输入框/文本域/下拉/级联/单选/按钮式单选/勾选框/开关/上传/步骤条/抽屉/列表/Tabs/面包屑/气泡/全局提示/加载/骨架屏/空状态/徽标/标签/提示条/滚动条/投影）。看这一页要用哪几个，就用一条 cat ${PACK_DIR}/docs/css/{_reset,btn,inp,…}.css 把它们读出来（一律带上_reset.css，28个全部加起来也才73KB），**把读到的内容原样贴进index.html的<style>**。🔴 **别把cat重定向到文件**（写成 > xxx.css 那样）——重定向了你就一个字节也没看见，只能凭印象重写，那等于没取；2026-09-15实测就是这么把btn-lg的圆角8px写成6px、padding 16px写成24px、还自己编了两个hover色的。🔴 贴进去之后**不许改里面的任何值**（高度/圆角/padding/字号/hover色都是定死的），门会拿飞鹊真值逐条比对，改了就报红。这一步不做，写出来的按钮和表单就都不是飞鹊的——2026-09-10两次实测都是这么翻车的。`,
    `【砖表里有的照抄，没有的不许手画】砖表里有的组件：类名保持飞鹊的、规则原样复制进单文件。🔴 不许自己另写一套.btn/.inp/.alert，不许借飞鹊前缀发明.btn-neutral这种飞鹊没有的变体。组件的高度、圆角、描边、字号一律以css/里的为准，DESIGN.md只管颜色和排版口径。🔴 **整块业务组件（产品卡、页头页脚、筛选侧栏这类）先看 docs/blocks/** —— 里面是 HTML+CSS 一起给的成品片段，cat 出来把 <style> 和结构原样贴进页面、只换文案图片、填掉标了 SLOT 的认证标，**里面的值一个都别改**（跟砖表同一个规矩）。2026-09-15 实测同一个产品卡：自己照截图拼＝按钮跑到右上角、认证标尺寸全错；cat 片段＝逐坐标对得上真值。**能 cat 到的就绝不自己拼。**blocks/ 里还没有的才走下面这条：🔴 blocks/ 里还没有的那些（ProductCard八个变体、MIC Footer页脚、FilterSidebar筛选侧栏、Supplier Ad、TM Bar、vo-header/nav/sider、mic-logo）＝只有Figma没有CSS实现，它们恰恰是MIC真实页面的主力：清单在INDEX.md末尾那张表，带Figma key和节点号，用figma的download_assets按key导出真资产；导不到就画灰色占位块并在交付说明里写明「待补真资产」，手画一个看着差不多的比留空更糟。`,

    `【规范怎么用·不只是值】${PACK_DIR}/docs/飞鹊设计规范-使用规则.md —— tokens.json 给的是值，这份给的是「什么时候用哪个」：7 级间距各自的场景（4=图标与文字 · 8=表单项 · 12=段落和label到输入框 · 16=卡片内padding · 24=区块 · 32=section · 48=首屏到内容），**禁止非 4px 倍数（5/10/15/25）**；圆角的等大公式 **外圆角＝内圆角＋padding**（4 标签小按钮 / 6 默认按钮输入框卡片 / 12 大卡片模态框）；阴影三级是**层级语义**不是深浅档（低＝下拉面板贴背景柔和 / 中＝卡片hover浮起 / 高＝对话框模态通知抽屉显著突出），全用或全不用；字阶控制在 3-5 种保持克制。♿ **无障碍是硬要求**：对比度≥4.5:1（大文本≥3:1）· 焦点样式不许 outline:none 且无替代（MIC 焦点＝2px #0071E1 50% 圆角4px 偏移1~2px）· 点击区域≥44×44px · 图片必有 Alt（装饰图 alt 留空）· 表单 label 绑 id · 纯色彩不能作唯一信息载体 · 语义化标签不用 div 模拟按钮。交付前过那份文档第 6 节的 10 条自查。`,
    `【多端与响应式】页面要适配多端就读${PACK_DIR}/docs/飞鹊响应式规则-AI友好型规范.md（断点、栅格、各端差异），别自己定断点。用法铁律读${PACK_DIR}/docs/飞鹊组件使用经验和规范.md第零、一节：参考页面只学布局，实现只能用飞鹊的砖。`,
    `【价格怎么写】页面上出现价格、起订量一律按${PACK_DIR}/docs/MIC英文价格规范-AI友好型.md：US$15.20-16.60（US$ 后不空格、区间用短横）、100 Pieces (MOQ)（不写Min. Order）。`,
    '【最常犯的三个组合错误，写完自查】① 实心红按钮全页只有一个（主CTA），其它动作用 .btn-secondary（白底黑边黑字）或 .btn-link，飞鹊没有「红描边按钮」 ② Alert提示条里不放按钮，动作是 .alert-link文字链 ③ 取消 / 次操作配 .btn-secondary，不是灰按钮。应用会在预览栏上跑一遍「飞鹊体检」，不过的会摆出来。',
    `【找不到就留占位，不许自己画】品牌标识（LOGO、商标、认证标、支付标）、页头页脚、导航——这些是MIC既有的东西，属于照抄范围，不是设计空间。三处都没找到就画个灰色占位块并在交付说明里写明"待补真资产"。手画一个看着差不多的，比留空更糟：它足够像，以至于没人会再去核对。`,
    /* ↓ 这三条治「应用做出来的页面不如终端像」。实测过：应用产出的页面 token 层面是满分（色值全在表内、
       字重只有400/700、字号与圆角全合规），差的不是规范，是**没有参照物、也从不回看自己做的东西**。
       终端里那套之所以像，是因为每次都先取真页面/真设计稿当参照，做完再截图并排比对。 */
    ...(restoreToolsDir() ? [`【还原线上页面·按这四步，别自己发明流程】做「照线上做 / 1:1 还原某个页面」这类活，工具在 ${restoreToolsDir().dir}（${restoreToolsDir().from}）：\n① **抽规格用 online-reach/responsive-spec-extract.js，别自己写 evaluate_script 刨 DOM** —— 它会二分逼出真实断点（不用猜 1279 还是 1280）、跨 375-1920 抓全 w/x/margin/padding/min-width/max-width/gap/flex 并 dump 命中的 @media 规则。随宽度变的值抓的是「函数」不是「点」，单一宽度读一次就当常量必错。\n② **写完用 online-reach/geom-check.js 逐值对位，全绿 exit 0 才算完**。「看一眼截图觉得差不多」不算验证 —— 参照物本身残缺的时候，回看只能发现你跟你自己不一致，发现不了参照缺了一块。\n③ 要把线上页面整个搬下来当离线底座，用 online-reach/live-clone.js，再跑 clone-offline-check.js 查外链/断图/JS 错。\n🔴 这套脚本要本机装了 Google Chrome（reach.sh 起的是独立 Chrome 实例，不碰用户日常浏览器）。报「Chrome/CDP 没起来」就是没装或路径不对，**这时候别自己写 evaluate_script 硬来**，改用 chrome-devtools 的 MCP，并且守住下面那三条禁令。\n④ 还原 Figma 稿则是另一套：restore-coverage/figma-restore-dump.snippet.js 贴进 use_figma 抽真值成 manifest，每个元素打 data-node-id，再跑 geom-check 按 node-id 自动对位；coverage-check.js 负责查有没有整块漏掉。`] : []),
    `【取参照物的三条禁令 · 2026-09-15 三条全栽过】不管有没有上面那套工具，这三条都得守：\n① **禁止 outerHTML.slice(N) 这种截断取样**。那次 slice(0,3000) 把产品卡切掉了后半截，按钮那段一个字节没读到，模型就自己编了个位置放到右上角。要么整段取全，要么按子节点分段取完再拼。\n② **截图要截目标元素本身，不是整页视口**。整页截图里目标只占一小块，还会被 fixed 侧栏、广告位盖住 —— 那次列表卡的按钮区正好被右侧 Sponsored 栏挡住，模型看到的「参照」本来就没有按钮。截完自问一句：这个组件的四条边都在画面里吗。\n③ **量哪个变体就只能做哪个变体**。那次点了列表/网格切换、量完网格就没切回来，后面全部精确测量都做在网格版上，交付的却是列表版。要出 N 个变体就对 N 个变体各量一遍。`,
    '【先拿参照物，再动手】只要这次是「还原 / 复刻 / 照着某个已有页面或设计稿做」：动手前必须先把参照物取到手——Figma稿用figma的MCP读真值，线上页面用chrome-devtools的MCP打开截图、或跑随应用带的 online-reach/reach.sh（路径见下面【还原线上页面】那条给的工具目录，不要去 ~/.claude/skills 找，同事机器上没有）。参照物拿不到就先问用户要，不要凭印象画一版当交付。就算用户没说「还原」，只要做的是MIC线上已有的页面类型（询盘、搜索、产详、发送成功页、登录注册……），也先用chrome-devtools打开线上同类页看一眼再动手——参照物先于灵感。只有明确是「从零设计、线上没有同类页」时，才按DESIGN.md的规范值自由发挥。',
    '【做完自己看一眼】页面写完不算完：用chrome-devtools的MCP把产物打开截图，自己看一遍，有参照物就并排比对，把对不上的地方改掉再交。没看过的成品不要交出去——用户在右边看到的就是你没检查过的那一版。',
    '【Figma稿怎么交】做Figma稿时产物在Figma文件里、不在项目目录，所以每做完一个节点要补两件事：①用get_screenshot拿到链接后curl存一张PNG到项目的「设计稿」目录，文件名用节点的名字 ②在回答里说清动了哪个文件的哪些节点。不做这两件，用户在应用里看不到你做了什么，交付给前端时也没有东西可指。',
    '【规范只是及格线】色值、字号、圆角对了只说明没犯错，不说明像MIC。像不像取决于版式密度、组件真实尺寸、文案口吻这些——所以更要靠参照物和回看，不要满足于「token全对」。',
    '回答用中文，中文与英文、数字之间不加空格（部门文案口径）；有歧义按业务常识定并写明假设，别停下来反复问；但「取参照物」和「做完回看」这两步不算歧义，不许跳。结束时用三五行说清做了什么、放在哪、还差什么。',
  ].join('\n');
}

function getSession(id) {
  if (sessions.has(id)) return sessions.get(id);
  const meta = readMeta(id);
  if (!meta) throw new Error('项目不存在：' + id);
  if (!engine || !engine.ok) engine = detectClaude(settings.claudePath);
  if (!engine.ok) throw new Error(engine.message);
  const s = new ClaudeSession({
    projectDir: projDir(id), claudePath: engine.path, permissionMode: settings.permissionMode, rawLog: path.join(projDir(id), '.uw', 'events.jsonl'),
    addDirs: [PACK_DIR, ...[path.join(os.homedir(), '.claude', 'skills'), (knowledgeDir() || {}).dir].filter(d => d && fs.existsSync(d))], systemPrompt: systemPrompt(meta), model: settings.model || '', resume: meta.sessionId || null,
    onEvent: ev => {
      /* 边说边存。以前只在 result 时存一次，一旦这轮没正常结束，它说过的话全没了 */
      if (ev.t === 'text') s._say = (s._say || '') + (ev.delta || '');
      if (ev.t === 'text_end' || ev.t === 'result' || ev.t === 'exit') {
        if (s._say && s._say.trim()) { appendMessage(id, { role: 'assistant', text: s._say }); }
        s._say = '';
      }
      if (ev.t === 'tool_use') { const r = recordFigma(id, ev.name, ev.input); if (r) win && win.webContents.send('figma:changed', { id }); }
      if (ev.t === 'init' || ev.t === 'result') {
        const m = readMeta(id); if (m && ev.sessionId && m.sessionId !== ev.sessionId) { m.sessionId = ev.sessionId; writeMeta(id, m); }
      }
      if (ev.t === 'exit') sessions.delete(id);
      win && win.webContents.send('run:event', { id, ev });
    },
  });
  sessions.set(id, s);
  watchProject(id);
  return s;
}

/* ── 窗口 ── */
function createWindow() {
  win = new BrowserWindow({
    width: 1480, height: 940, minWidth: 1100, minHeight: 700,
    title: 'UED WorkBuddy', backgroundColor: '#F5F5F7', icon: path.join(ROOT, 'build', 'icon.png'),
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 18 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  /* 预览用的是 iframe，鼠标滚轮会被 iframe 自己吞掉，外层监听不到。
     所以按住 option 时通知界面把 iframe 的 pointer-events 关掉，滚轮才落到外层。
     用 before-input-event 是因为焦点点进 iframe 之后，渲染层自己收不到 keydown。 */
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.key !== 'Alt') return;
    win.webContents.send('alt:key', input.type === 'keyDown');
  });
  win.on('blur', () => win.webContents.send('alt:key', false));
  win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  /* 关窗口＝杀掉正在跑的 Claude 子进程，做到一半的活直接没。先问一句。
     （2026-09-10 踩过：外部把应用进程杀了，一个跑了 14 分钟的任务无声消失） */
  win.on('close', e => {
    if (quitting) return;
    const n = [...sessions.values()].filter(s => s.busy).length;
    if (!n) return;
    e.preventDefault();
    const r = dialog.showMessageBoxSync(win, {
      type: 'warning', buttons: ['先不关', '还是关掉'], defaultId: 0, cancelId: 0,
      message: `还有${n}个任务在跑`,
      detail: '现在关掉会把正在做的活掐断。已经想到一半、还没写进文件的东西不会保留（会话记录还在，重开后接着说能续上）。',
    });
    if (r === 1) { quitting = true; win.destroy(); }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
}


/* 注入预览 iframe 的测量探针：把页面真实内容宽高报给父窗口，父窗口据此决定按多宽渲染。
   用 IIFE 不污染页面；只在被嵌进 iframe 时才跑；同值不重复上报，避免 resize 抖动。 */
const FIT_PROBE = `
<script>(function(){
  if (window.parent === window) return;
  var last = '';
  function report(){
    var d = document.documentElement, b = document.body || d;
    var w = Math.max(d.scrollWidth||0, b.scrollWidth||0, d.offsetWidth||0);
    var h = Math.max(d.scrollHeight||0, b.scrollHeight||0);
    if (!w) return;
    var k = w + 'x' + h;
    if (k === last) return;
    last = k;
    try { window.parent.postMessage({ __uwFit: 1, w: w, h: h }, '*'); } catch (e) {}
  }
  window.addEventListener('load', report);
  window.addEventListener('resize', report);
  try { new ResizeObserver(report).observe(document.documentElement); } catch (e) {}
  setTimeout(report, 0); setTimeout(report, 200); setTimeout(report, 800);
})();<\/script>`;

/* 项目文件走自定义协议给预览 iframe 用：uwproj://p/<项目id>/<相对路径> */
protocol.registerSchemesAsPrivileged([{ scheme: 'uwproj', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

app.setName('UED WorkBuddy');
app.whenReady().then(() => {
  /* 这里原来有一行 app.dock.setIcon(build/icon.png)，2026-09-15 删了。
     ① 多余：electron-builder 已经把 build/icon.icns 打进 app 包，Dock 本来就读它；
     ② 它是「一打开图标就变一下」唯一说得通的机制 —— 没跑时 Dock 画的是包里的 icns，
        一启动被换成这张 png。两张图我比过，逐像素平均差 0.76/255、就是同一张，
        所以严格说它不该改变画面；但既然是多余的，留着只是多一个可疑点。
     🔴 真正让图标「大一圈」的是图稿本身：实心方块原来占画布 90.7%，
        而苹果自家的是 80.5%（Figma 80.1%）。已按 824/1024 那张网格重做，
        四边各留 100px 透明边距。改图稿的地方是 build/icon.iconset，
        改完要 iconutil -c icns build/icon.iconset -o build/icon.icns 重新生成。 */
  protocol.handle('uwproj', req => {
    try {
      const u = new URL(req.url);
      const parts = decodeURIComponent(u.pathname).split('/').filter(Boolean);
      const id = parts.shift();
      const rel = parts.join('/') || 'index.html';
      const base = projDir(id);
      const abs = path.normalize(path.join(base, rel));
      if (!abs.startsWith(base)) return new Response('forbidden', { status: 403 });
      if (!fs.existsSync(abs)) return new Response('not found', { status: 404 });
      /* HTML 给预览用时注入一个测量探针：iframe 是 uwproj:// 而主窗口是 file://，跨源读不到
         contentDocument，所以预览「自适应」档一直按写死的 1240 渲染 —— 页面宽过 1240 就被裁掉
         （2026-09-15：一个 1400px 的产品列表页右边整条栏看不见）。探针只走协议层，不落盘，
         不影响体检和交付产物（那两处读的都是磁盘文件）。 */
      if (/\.html?$/i.test(abs)) {
        return net.fetch(pathToFileURL(abs).toString()).then(async r => {
          const html = await r.text();
          return new Response(html + FIT_PROBE, { headers: { 'content-type': 'text/html; charset=utf-8' } });
        });
      }
      return net.fetch(pathToFileURL(abs).toString());
    } catch (e) { return new Response(String(e), { status: 500 }); }
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'UED WorkBuddy', submenu: [{ role: 'about', label: '关于UED WorkBuddy' }, { type: 'separator' }, { role: 'quit', label: '退出' }] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '视图', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'close' }] },
  ]));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { app.quit(); });
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => { for (const s of sessions.values()) s.stop(); });

/* ── IPC ── */
ipcMain.handle('app:boot', () => {
  ensureWorkspaceGuide();
  engine = detectClaude(settings.claudePath);
  writeDiagnostics();
  return { settings, engine, caps: CAPS, wizards: WIZARDS, packDir: PACK_DIR, projects: listProjects(), version: app.getVersion(), platform: process.platform };
});
ipcMain.handle('settings:save', (_e, s) => { const r = saveSettings(s); ensureWorkspaceGuide(); for (const ses of sessions.values()) ses.stop(); sessions.clear(); return r; });
ipcMain.handle('engine:detect', () => { engine = detectClaude(settings.claudePath); writeDiagnostics(); return engine; });
ipcMain.handle('projects:list', () => listProjects());
ipcMain.handle('projects:create', (_e, o) => createProject(o));
ipcMain.handle('projects:open', (_e, id) => { const m = readMeta(id); if (!m) return null; watchProject(id); return { id, ...m, files: listFiles(id), dir: projDir(id), figma: readFigma(id), busy: sessions.has(id) && sessions.get(id).busy }; });
ipcMain.handle('figma:read', (_e, id) => readFigma(id));
ipcMain.handle('figma:open', (_e, { fileKey, nodeId }) => {
  const url = `https://www.figma.com/design/${fileKey}/x` + (nodeId ? `?node-id=${String(nodeId).replace(':', '-')}` : '');
  /* 装了桌面版就把链接丢给它（`open -a` 比猜 figma:// 的路径形式稳），没装才用浏览器 */
  if (fs.existsSync('/Applications/Figma.app')) { spawn('open', ['-a', 'Figma', url], { stdio: 'ignore', detached: true }).unref(); }
  else shell.openExternal(url);
  return true;
});
/* 删项目＝整个文件夹移到废纸篓（不是 rm）：手滑了还能从废纸篓捞回来。移不动（比如外置盘）再退回硬删。 */
ipcMain.handle('projects:delete', async (_e, id) => {
  const s = sessions.get(id); if (s) s.stop(); sessions.delete(id);
  const w = watchers.get(id); if (w) { try { w.close(); } catch (e) {} watchers.delete(id); }
  const dir = projDir(id);
  if (!fs.existsSync(dir)) return { ok: true, trashed: false };
  try { await shell.trashItem(dir); return { ok: true, trashed: true }; }
  catch (e) { fs.rmSync(dir, { recursive: true, force: true }); return { ok: true, trashed: false }; }
});
ipcMain.handle('files:list', (_e, id) => listFiles(id));
/* 飞鹊体检：对项目里某个 HTML 做静态扫描（字体 / 字重 / 色值 / 自造组件 / 红按钮数 / alert 里塞按钮） */
ipcMain.handle('files:check', (_e, { id, rel }) => {
  const abs = path.normalize(path.join(projDir(id), rel));
  if (!abs.startsWith(projDir(id))) throw new Error('越界');
  try { return feiqueCheck(fs.readFileSync(abs, 'utf8'), PACK_DIR); } catch (e) { return { issues: [], ok: true, n: 0, badN: 0, error: e.message }; }
});
ipcMain.handle('files:read', (_e, { id, rel }) => {
  const abs = path.normalize(path.join(projDir(id), rel));
  if (!abs.startsWith(projDir(id))) throw new Error('越界');
  const st = fs.statSync(abs);
  if (st.size > 2 * 1024 * 1024) return { rel, tooBig: true, size: st.size };
  return { rel, size: st.size, text: fs.readFileSync(abs, 'utf8') };
});
ipcMain.handle('run:send', (_e, { id, text, label, display }) => {
  const s = getSession(id);
  const r = s.send(text);
  if (r.ok) appendMessage(id, { role: 'user', text, label: label || null, display: display || null });
  return r;
});
ipcMain.handle('run:record', (_e, { id, text }) => { appendMessage(id, { role: 'assistant', text }); return true; });
ipcMain.handle('run:interrupt', (_e, id) => { const s = sessions.get(id); return s ? s.interrupt() : false; });
ipcMain.handle('run:stop', (_e, id) => { const s = sessions.get(id); if (s) s.stop(); sessions.delete(id); return true; });
ipcMain.handle('perm:respond', (_e, { id, requestId, behavior, message, remember }) => {
  const s = sessions.get(id); if (!s) return false;
  if (remember === 'session') s.autoAllow = true;   // 本次任务全部放行：只对这个进程有效，重开会话就恢复设置里的档位
  return s.respondPermission(requestId, behavior, message);
});
ipcMain.handle('handoff:build', (_e, { id }) => {
  const m = readMeta(id); if (!m) throw new Error('项目不存在');
  const r = buildHandoff({ projectDir: projDir(id), projectName: m.name, workspaceDir: settings.workspaceDir, repoDir: settings.handoffRepoDir, frontendName: settings.frontendName, author: os.userInfo().username });
  clipboard.writeText(r.message);
  m.handoffs = (m.handoffs || []).concat([{ at: Date.now(), dest: r.dest, zip: r.zip, branch: r.branch, commit: r.commit, mrUrl: r.mrUrl }]);
  writeMeta(id, m);
  return r;
});
ipcMain.handle('shell:reveal', (_e, p) => { shell.showItemInFolder(p); return true; });
ipcMain.handle('shell:open', (_e, p) => shell.openPath(p));
ipcMain.handle('shell:external', (_e, u) => { if (/^https?:/.test(u)) shell.openExternal(u); return true; });
ipcMain.handle('clipboard:write', (_e, t) => { clipboard.writeText(String(t)); return true; });
ipcMain.handle('dialog:pickDir', async (_e, title) => { const r = await dialog.showOpenDialog(win, { title: title || '选择文件夹', properties: ['openDirectory', 'createDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
ipcMain.handle('dialog:pickAny', async (_e, title) => { const r = await dialog.showOpenDialog(win, { title: title || '选择文件或文件夹', properties: ['openFile', 'openDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
/* 在系统终端里接着干：同一个项目目录、同一个会话（--resume），从应用无缝切到全屏的 Claude Code */
ipcMain.handle('shell:terminal', (_e, id) => {
  const m = readMeta(id); if (!m) return false;
  if (!engine || !engine.ok) engine = detectClaude(settings.claudePath);
  const dir = projDir(id).replace(/"/g, '\\"');
  const cmd = `cd \\"${dir}\\" && ${engine.ok ? engine.path : 'claude'}${m.sessionId ? ' --resume ' + m.sessionId : ''}`;
  const script = `tell application "Terminal" to do script "${cmd}"\ntell application "Terminal" to activate`;
  spawn('osascript', ['-e', script], { stdio: 'ignore', detached: true }).unref();
  return true;
});
