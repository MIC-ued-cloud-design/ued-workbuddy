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
      '- `docs/css/INDEX.md` —— **砖表**：飞鹊 28 类组件的网页实现，一类一个文件（按钮/分页/输入框/下拉/级联/勾选/单选/开关/上传/步骤条/抽屉/Tabs/列表/面包屑/气泡/全局提示/加载/骨架/空状态/滚动条/徽标/标签/提示条/文本域/数字输入/按钮式选择/投影/reset）。做网页**先读它**，按这一页要用的 `cat docs/css/{_reset,btn,inp,…}.css` 读出来（带上 `_reset.css`，28 个全抄也才 73KB），**原样贴进 `<style>`**。🔴 **别重定向到文件**——那样内容没进你眼里，只会凭印象重写；贴完**不许改值**。**不自己写一套按钮 / 输入框 / 提示条**，也不发明飞鹊没有的变体。用法铁律在 `docs/飞鹊组件使用经验和规范.md` 第零、一节；权威源是 `docs/飞鹊Web组件库.css`（砖表是它按组件切开的，内容一样）。',
      '- `web-components.json` / `mobile-components.json` —— 组件清册。按钮、输入框、卡片、**页头页脚、LOGO、认证标**都在里面，每条带 Figma 的 key 和节点号、尺寸、颜色规则。',
      '- `brand/` —— 品牌标识的现成 SVG（MIC LOGO 就在这儿，240×46）。',
      '- `icons/` —— 295 个 UI 小图标。', '',
      '**要放一个现成元素时的顺序：清册 → brand/ → icons/。**',
      '🔴 别只搜 `icons/` —— 那里只有 UI 图标，LOGO 和页头这类在清册里。',
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
    ...(knowledgeDir() ? [`【有部门知识库，别凭记忆答】路径${knowledgeDir().dir}（${knowledgeDir().from}），先读里面的${knowledgeDir().index} —— 那是一份索引，一行一个指针；按索引挑相关的几份读，别整个目录乱翻、也别用grep满硬盘找。做任何MIC业务相关的活（搜索/询盘/交易订单/TM/RFQ/商机融合/会员/运营）之前先走这一步。里面有业务知识、方法论判据、各专项做法三类。`] : []),
    `【要放一个现成元素时，按这个顺序找，别跳到"自己画"】① 先查组件清册 ${PACK_DIR}/web-components.json（移动端查mobile-components.json）——按钮、输入框、卡片、页头页脚、LOGO、认证标这些都在里面，条目里有Figma的key和节点号、尺寸、颜色规则 ② 品牌标识看 ${PACK_DIR}/brand/ 目录，LOGO已经是现成SVG，直接内联 ③ UI小图标看 ${PACK_DIR}/icons/（295个）。清册里给的是Figma节点号、不是图片，需要真SVG就用figma的download_assets按key导出。`,
    `【开工第一步·先看砖表】做任何网页产物，第一件事是读${PACK_DIR}/docs/css/INDEX.md——飞鹊28类组件的网页实现清单（按钮/分页/输入框/数字输入框/文本域/下拉/级联/单选/按钮式单选/勾选框/开关/上传/步骤条/抽屉/列表/Tabs/面包屑/气泡/全局提示/加载/骨架屏/空状态/徽标/标签/提示条/滚动条/投影）。看这一页要用哪几个，就用一条 cat ${PACK_DIR}/docs/css/{_reset,btn,inp,…}.css 把它们读出来（一律带上_reset.css，28个全部加起来也才73KB），**把读到的内容原样贴进index.html的<style>**。🔴 **别把cat重定向到文件**（写成 > xxx.css 那样）——重定向了你就一个字节也没看见，只能凭印象重写，那等于没取；2026-09-15实测就是这么把btn-lg的圆角8px写成6px、padding 16px写成24px、还自己编了两个hover色的。🔴 贴进去之后**不许改里面的任何值**（高度/圆角/padding/字号/hover色都是定死的），门会拿飞鹊真值逐条比对，改了就报红。这一步不做，写出来的按钮和表单就都不是飞鹊的——2026-09-10两次实测都是这么翻车的。`,
    `【砖表里有的照抄，没有的不许手画】砖表里有的组件：类名保持飞鹊的、规则原样复制进单文件。🔴 不许自己另写一套.btn/.inp/.alert，不许借飞鹊前缀发明.btn-neutral这种飞鹊没有的变体。组件的高度、圆角、描边、字号一律以css/里的为准，DESIGN.md只管颜色和排版口径。🔴 砖表里没有的那25个（ProductCard八个变体、MIC Footer页脚、FilterSidebar筛选侧栏、Supplier Ad、TM Bar、vo-header/nav/sider、mic-logo）＝只有Figma没有CSS实现，它们恰恰是MIC真实页面的主力：清单在INDEX.md末尾那张表，带Figma key和节点号，用figma的download_assets按key导出真资产；导不到就画灰色占位块并在交付说明里写明「待补真资产」，手画一个看着差不多的比留空更糟。`,

    `【多端与响应式】页面要适配多端就读${PACK_DIR}/docs/飞鹊响应式规则-AI友好型规范.md（断点、栅格、各端差异），别自己定断点。用法铁律读${PACK_DIR}/docs/飞鹊组件使用经验和规范.md第零、一节：参考页面只学布局，实现只能用飞鹊的砖。`,
    `【价格怎么写】页面上出现价格、起订量一律按${PACK_DIR}/docs/MIC英文价格规范-AI友好型.md：US$15.20-16.60（US$ 后不空格、区间用短横）、100 Pieces (MOQ)（不写Min. Order）。`,
    '【最常犯的三个组合错误，写完自查】① 实心红按钮全页只有一个（主CTA），其它动作用 .btn-secondary（白底黑边黑字）或 .btn-link，飞鹊没有「红描边按钮」 ② Alert提示条里不放按钮，动作是 .alert-link文字链 ③ 取消 / 次操作配 .btn-secondary，不是灰按钮。应用会在预览栏上跑一遍「飞鹊体检」，不过的会摆出来。',
    `【找不到就留占位，不许自己画】品牌标识（LOGO、商标、认证标、支付标）、页头页脚、导航——这些是MIC既有的东西，属于照抄范围，不是设计空间。三处都没找到就画个灰色占位块并在交付说明里写明"待补真资产"。手画一个看着差不多的，比留空更糟：它足够像，以至于没人会再去核对。`,
    /* ↓ 这三条治「应用做出来的页面不如终端像」。实测过：应用产出的页面 token 层面是满分（色值全在表内、
       字重只有400/700、字号与圆角全合规），差的不是规范，是**没有参照物、也从不回看自己做的东西**。
       终端里那套之所以像，是因为每次都先取真页面/真设计稿当参照，做完再截图并排比对。 */
    '【先拿参照物，再动手】只要这次是「还原 / 复刻 / 照着某个已有页面或设计稿做」：动手前必须先把参照物取到手——Figma稿用figma的MCP读真值，线上页面用chrome-devtools的MCP打开截图、或跑 ~/.claude/skills/mic-fullstack/scripts/online-reach/reach.sh。参照物拿不到就先问用户要，不要凭印象画一版当交付。就算用户没说「还原」，只要做的是MIC线上已有的页面类型（询盘、搜索、产详、发送成功页、登录注册……），也先用chrome-devtools打开线上同类页看一眼再动手——参照物先于灵感。只有明确是「从零设计、线上没有同类页」时，才按DESIGN.md的规范值自由发挥。',
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

/* 项目文件走自定义协议给预览 iframe 用：uwproj://p/<项目id>/<相对路径> */
protocol.registerSchemesAsPrivileged([{ scheme: 'uwproj', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

app.setName('UED WorkBuddy');
app.whenReady().then(() => {
  try { if (process.platform === 'darwin' && app.dock) app.dock.setIcon(path.join(ROOT, 'build', 'icon.png')); } catch (e) {}
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
