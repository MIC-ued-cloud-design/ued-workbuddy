'use strict';
/* UED WorkBuddy 桌面版 · 界面逻辑（不依赖框架） */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* 快捷键文案按平台写：Mac 显示 ⌘ / ⇧⌘ / ⌥，Windows 显示 Ctrl+ / Ctrl+Shift+ / Alt。按键判断本来就是 metaKey || ctrlKey，这里只管给人看的字。 */
const IS_WIN = /Windows/i.test(navigator.userAgent);
function hk(str) { return IS_WIN ? String(str).replace(/⇧⌘/g, 'Ctrl+Shift+').replace(/⌘/g, 'Ctrl+').replace(/⌥/g, 'Alt') : str; }

const S = {
  boot: null, caps: null, settings: null, engine: null,
  role: 'design', view: 'home',
  project: null,          // { id, name, role, scene, files, dir, sessionId }
  logs: new Map(),        // id → { items: [], busy, startedAt, textOpen }
  pendingScene: null, pendingAbility: null,
  tab: 'preview', width: 'auto', zoom: 1, guides: true, previewFile: null, codeFile: null, contentW: 0,
  figma: null,            // 这个项目动过的 Figma 记录（主进程从工具调用里抓的，不靠模型自觉写）
  timer: null,
};
const AT = { list: [] };   // 附件（随下一条消息发）
/* 编辑层状态（像 Figma 那样改预览）。放这儿是因为 loadPreview 早就要读它 */
const ED = { on: false, info: null, pending: null, flush: null, reselect: null, scroll: null, edits: [], suppress: 0, undoWarnAt: 0, ready: false };

/* ── 启动 ─────────────────────────────────────────── */
async function boot() {
  S.boot = await uw.boot();
  S.caps = S.boot.caps; S.settings = S.boot.settings; S.engine = S.boot.engine;
  S.role = S.settings.role || 'design';
  if (!roleOf(S.role)) S.role = S.caps.roles[0].id;   // 设置里存的角色已经删了（2026-09-16 去掉前端）就退回第一个，别让首页整块画不出来
  /* 🔴 版本号要一直在屏幕上。吉吉 2026-09-18：「每次更新完，同事也不知道自己是什么版本」——
     同事报「这个功能我这儿没有」时，第一件要问的就是版本号；问不出来就得靠猜。
     值取自主进程的 app.getVersion()，不是写死在页面里的（写死必然有一天忘了改）。 */
  if ($('#appVer')) $('#appVer').textContent = S.boot.version ? 'v' + S.boot.version : '';
  renderEngine(); renderRoleSeg(); renderScenes(); renderAbilities(); renderHomeModel(); renderProjects(S.boot.projects);
  uw.onRunEvent(({ id, ev }) => onRunEvent(id, ev));
  uw.onFilesChanged(({ id }) => { if (S.project && S.project.id === id) refreshFiles(true); });
  /* 两条路都挂上：焦点在应用本身时走这条；焦点点进预览 iframe 之后，
     渲染层收不到按键，靠主进程的 before-input-event 那条兜底。 */
  const setAlt = d => document.body.classList.toggle('altzoom', !!d);
  window.addEventListener('keydown', e => { if (e.key === 'Alt' || e.altKey) setAlt(true); }, true);
  window.addEventListener('keyup', e => { if (e.key === 'Alt' || !e.altKey) setAlt(false); }, true);
  window.addEventListener('blur', () => setAlt(false));
  uw.onAltKey(setAlt);
  uw.onFigmaChanged(async ({ id }) => { if (S.project && S.project.id === id) { S.figma = await uw.readFigma(id); renderDesign(); } });
  const sv = $('#setVersion'); if (sv) sv.textContent = `当前 ${S.boot.version || ''}`;
  /* Windows：右上角是系统画的三个窗口按钮（见 main.js titleBarOverlay），浮层要让开；快捷键文案 ⌘ → Ctrl */
  if (S.boot.platform === 'win32') { document.body.classList.add('win'); document.querySelectorAll('[title*="⌘"],[title*="⌥"]').forEach(el => { el.title = hk(el.title); }); }
  $('#navLibsN').textContent = LIBS.length; kbLoad().catch(() => {});
  setTimeout(() => checkUpdate(false).catch(() => {}), 3000);
}

function renderEngine() {
  const pill = $('#enginePill'), t = $('#engineText');
  pill.classList.remove('ok', 'bad');
  if (S.engine && S.engine.ok) { pill.classList.add('ok'); t.textContent = `Claude Code ${S.engine.version.split(' ')[0]}${S.engine.viaFcf ? ' · 经FCF' : ''}`; }
  else { pill.classList.add('bad'); t.textContent = '没找到Claude Code'; }
}

/* ── 首页 ─────────────────────────────────────────── */
function renderRoleSeg() {
  const seg = $('#roleSeg'); seg.innerHTML = '';
  for (const r of S.caps.roles) {
    const b = document.createElement('button'); b.textContent = r.name; b.className = r.id === S.role ? 'on' : '';
    b.onclick = () => { S.role = r.id; S.settings.role = r.id; uw.saveSettings({ role: r.id }); S.scene = null; renderRoleSeg(); renderScenes(); };
    seg.appendChild(b);
  }
}
function roleOf(id) { return S.caps.roles.find(r => r.id === id); }
function cardsOf(role) { return role.groups ? role.groups.flatMap(g => g.cards.map(c => ({ ...c, group: g.name }))) : (role.scenes || []); }
function iconSrc(name) { return '../packs/feique/icons/' + (name || 'file') + '.svg'; }
/* 六大类 = 一条分段控件；下面一排该类的场景胶囊；点胶囊 = 选定场景（再点一次取消） */
function renderScenes() {
  const role = roleOf(S.role);
  const seg = $('#catSeg'), note = $('#catNote'), row = $('#sceneChips');
  seg.innerHTML = ''; row.innerHTML = '';
  const groups = role.groups || [{ id: 'all', name: role.name, note: role.placeholderNote || role.desc, cards: role.scenes || [] }];
  if (!S.group || !groups.some(g => g.id === S.group)) S.group = groups[0].id;
  seg.hidden = groups.length < 2;
  for (const g of groups) {
    const b = document.createElement('button'); b.textContent = g.name; b.className = g.id === S.group ? 'on' : '';
    b.onclick = () => { S.group = g.id; S.scene = null; renderScenes(); };
    seg.appendChild(b);
  }
  const grp = groups.find(g => g.id === S.group);
  note.textContent = grp.note || '';
  for (const sc of grp.cards) {
    const c = document.createElement('button'); c.className = 'chip-s' + (S.scene && S.scene.id === sc.id ? ' on' : '');
    c.innerHTML = `<img src="${iconSrc(sc.icon)}" alt=""><span>${esc(sc.title)}</span><span class="ar">↘</span>`;
    c.title = sc.out || sc.desc || '';
    c.onclick = () => { S.scene = { ...sc, role }; renderScenes(); renderHomeSel(); if (!wizOpen(role, sc)) $('#homeInput').focus(); };
    row.appendChild(c);
  }
  renderHomeSel();
}
function renderHomeSel() {
  const el = $('#homeSel'), ta = $('#homeInput');
  if (!S.scene) { el.hidden = true; ta.placeholder = '描述这次要做的事，或者先点上面一个场景…'; return; }
  el.hidden = false;
  el.innerHTML = `${esc(S.scene.title)}${S.scene.out ? ' <b>→ ' + esc(S.scene.out) + '</b>' : ''}<button title="取消选择">×</button>`;
  $('button', el).onclick = () => { S.scene = null; renderScenes(); };
  ta.placeholder = S.scene.example ? '比如：' + S.scene.example.replace(/\n/g, ' ') : (S.scene.desc || '把需求、链接、要改的点贴进来');
  ta.focus();
}
function renderAbilities() {
  const m = $('#homeAbilityMenu'); m.innerHTML = '';
  for (const a of S.caps.abilities) {
    const b = document.createElement('button'); b.innerHTML = `<b>${esc(a.title)}</b><small>${esc(a.desc)}</small>`;
    b.onclick = () => { m.hidden = true; S.scene = { ...a, role: roleOf(S.role), ability: true }; renderScenes(); };
    m.appendChild(b);
  }
}
const MODEL_LABELS = { '': 'Claude · 跟随默认', 'claude-fable-5-1': 'Claude Fable 5.1', 'claude-opus-5': 'Claude Opus 5', 'claude-sonnet-5': 'Claude Sonnet 5', 'claude-haiku-4-5-20251001': 'Claude Haiku 4.5', opus: 'Claude Opus', sonnet: 'Claude Sonnet', haiku: 'Claude Haiku' };
function renderHomeModel() { $('#homeModel').textContent = MODEL_LABELS[S.settings.model || ''] || ('Claude · ' + S.settings.model); }
$('#homeModel').onclick = e => {
  e.stopPropagation(); const m = $('#homeModelMenu'); if (!m.hidden) { m.hidden = true; return; }
  m.innerHTML = '';
  for (const [v, label] of Object.entries(MODEL_LABELS)) {
    const b = document.createElement('button'); b.innerHTML = `<div class="mrow"><b>${esc(label)}</b><small>${esc(v || '终端里 /model选的那个')}</small></div>`;
    b.onclick = async () => { m.hidden = true; S.settings = await uw.saveSettings({ model: v }); renderHomeModel(); toast('模型已切到 ' + label + '，新会话生效'); };
    m.appendChild(b);
  }
  m.hidden = false;
};
$('#homeAbility').onclick = e => { e.stopPropagation(); const m = $('#homeAbilityMenu'); m.hidden = !m.hidden; };
$('#homeRecent').onclick = e => {
  e.stopPropagation(); const m = $('#homeRecentMenu'); if (!m.hidden) { m.hidden = true; return; }
  m.innerHTML = '';
  const list = (S.projects || []).slice(0, 10);
  if (!list.length) m.innerHTML = '<button disabled><small>还没有项目</small></button>';
  for (const p of list) { const b = document.createElement('button'); b.innerHTML = `<div class="mrow"><b>${esc(p.name)}</b><small>${esc(sceneTitle(p))} · ${fmtTime(p.updatedAt || p.createdAt)}</small></div>`; b.onclick = () => { m.hidden = true; openProject(p.id); }; m.appendChild(b); }
  m.hidden = false;
};
$('#homeAttach').onclick = async () => { const p = await uw.pickAny('选择要附上的文件或文件夹'); if (p) { const t = $('#homeInput'); t.value = (t.value ? t.value + '\n' : '') + '附件路径：' + p; t.focus(); } };
$('#homeInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && (e.metaKey || e.ctrlKey || !e.isComposing && !$('#homeInput').value.includes('\n'))) { e.preventDefault(); startFromHome(); } });
$('#homeSend').onclick = startFromHome;
async function startFromHome() {
  const input = $('#homeInput').value.trim();
  if (!input && !S.scene) { toast('先说一句要做什么，或者点一个场景。'); return; }
  const role = roleOf(S.role);
  const item = S.scene || { id: 'free', title: '自由任务', kind: 'free', prompt: '你在UED WorkBuddy桌面版里工作，当前目录是项目「{{project}}」，产物一律写成文件放在这里。这台电脑上有mic-fullstack技能与MIC业务知识库，凡MIC / 飞鹊 / Figma相关先用它们；飞鹊设计系统速查版在{{pack}}/DESIGN.md。\n\n任务：\n\n{{input}}\n\n先用三五行说清你理解的目标和范围，有歧义按业务常识定并写明假设；做完说清做了什么、放在哪、还差什么。' };
  const text = input || ('就按这个场景的默认做法来，对象是我接下来会说的内容；先问我需要哪些输入。');
  const head = (text.split('\n').find(l => l.trim() && !l.startsWith('附件路径：')) || '').replace(/[，。！？、；：,.!?;:「」“”"'`]+/g, ' ').trim().slice(0, 14).trim();
  const name = S.scene ? (head ? `${item.title} · ${head}` : item.title) : (head || item.title);
  const p = await uw.createProject({ name, role: role.id, scene: item.id, input: text });
  $('#homeInput').value = ''; S.scene = null;
  await openProject(p.id);
  send(fill(item.prompt, { input: text, project: p.name }), item.title, text);
}
function fmtTime(ms) { const d = new Date(ms); const p = n => String(n).padStart(2, '0'); return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`; }
function renderProjects(list) {
  S.projects = list;
  const pl = $('#projList'); pl.innerHTML = '';
  for (const p of list.slice(0, 30)) {
    const b = document.createElement('button'); b.className = 'proj' + (S.project && S.project.id === p.id ? ' on' : '');
    const busy = S.logs.get(p.id)?.busy;
    b.title = p.name;   // 列表里放不下的长名字，鼠标停上去能看全
    b.innerHTML = `<span class="n">${esc(p.name)}</span><span class="m"><span class="dot${busy ? ' busy' : ''}"></span>${esc((roleOf(p.role) || {}).name || '')}${p.scene ? ' · ' + esc(sceneTitle(p)) : ''}</span>`;
    b.onclick = () => openProject(p.id);
    b.oncontextmenu = e => { e.preventDefault(); openCtx(e.clientX, e.clientY, p, b); };
    pl.appendChild(b);
  }
}
/* ── 项目右键菜单 ─────────────────────────────────── */
function openCtx(x, y, p, anchor) {
  const m = $('#ctxMenu'); closeCtx();
  const busy = !!(S.logs.get(p.id) || {}).busy || p.running;
  m.innerHTML = `<button data-a="open">打开</button><button data-a="folder">打开文件夹</button><button data-a="terminal">在终端打开</button><div class="sep"></div><button data-a="del" class="danger">删除项目…</button>`;
  $$('button', m).forEach(b => b.onclick = e => {
    e.stopPropagation(); closeCtx();
    const a = b.dataset.a;
    if (a === 'open') openProject(p.id);
    else if (a === 'folder') uw.openPath(S.settings.workspaceDir + '/' + p.id);
    else if (a === 'terminal') uw.openTerminal(p.id);
    else if (a === 'del') askDelete(p, busy);
  });
  m.hidden = false;
  if (anchor) { anchor.classList.add('ctx-on'); m._anchor = anchor; }
  /* 贴着鼠标弹，右边 / 下边放不下就往回折 */
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, window.innerWidth - r.width - 8) + 'px';
  m.style.top = Math.min(y, window.innerHeight - r.height - 8) + 'px';
}
function closeCtx() {
  const m = $('#ctxMenu'); if (!m) return;
  m.hidden = true;
  if (m._anchor) { m._anchor.classList.remove('ctx-on'); m._anchor = null; }
}
document.addEventListener('click', closeCtx);
document.addEventListener('contextmenu', e => { if (!e.target.closest('.proj')) closeCtx(); });
window.addEventListener('blur', closeCtx);
window.addEventListener('resize', closeCtx);
function askDelete(p, busy) {
  const n = ((S.logs.get(p.id) || {}).items || []).length;
  $('#delDesc').innerHTML = `<b>${esc(p.name)}</b> 的整个文件夹会移到废纸篓：里面的稿子、交付说明、对话记录一起走${busy ? '；<b>它现在还在跑，会先被停掉</b>' : ''}。后悔了可以从废纸篓里拖回「${esc(S.settings.workspaceDir.split('/').pop())}」。`;
  const go = $('#btnDelGo');
  go.onclick = async () => {
    go.disabled = true;
    try {
      const r = await uw.deleteProject(p.id);
      hide('#modalDelete');
      S.logs.delete(p.id);
      if (S.project && S.project.id === p.id) setView('home'); else uw.listProjects().then(renderProjects);
      toast(r && r.trashed === false ? '项目已删除' : '项目已移到废纸篓');
    } catch (e) { toast('删不掉：' + (e.message || e)); }
    go.disabled = false;
  };
  show('#modalDelete');
}
function sceneTitle(p) {
  for (const r of S.caps.roles) for (const s of cardsOf(r)) if (s.id === p.scene) return s.title;
  const a = S.caps.abilities.find(a => a.id === p.scene); return a ? a.title : (p.scene === 'free' ? '自由任务' : (p.scene || ''));
}

/* ── 新建项目 ─────────────────────────────────────── */
function openNew({ role, scene, ability }) {
  S.pendingScene = scene || null; S.pendingAbility = ability || null; S.pendingRole = role;
  const item = scene || ability;
  $('#newTitle').textContent = item.title; $('#newDesc').textContent = item.out ? '产出：' + item.out : (item.desc || '');
  $('#newName').value = ''; $('#newInput').value = ''; $('#pickedPath').textContent = '';
  $('#newInput').placeholder = item.example ? '比如：\n' + item.example : '把需求、PRD片段、参考链接、要改的点都贴进来。越具体，第一稿越准。';
  $('#newInputLabel').textContent = item.kind === 'grill' ? '要拷问的方案' : item.kind === 'code' ? '交付包位置或稿子路径 / 内容' : item.kind === 'review' ? '要走查的稿子（路径或内容）' : '需求 / 背景 / 链接';
  show('#modalNew'); setTimeout(() => $('#newInput').focus(), 50);
}
$('#btnPickAny').onclick = async () => { const p = await uw.pickAny('选择要附上的文件或文件夹'); if (p) { $('#pickedPath').textContent = p; const t = $('#newInput'); t.value = (t.value ? t.value + '\n' : '') + '附件路径：' + p; } };
$('#btnCreate').onclick = async () => {
  const item = S.pendingScene || S.pendingAbility;
  const input = $('#newInput').value.trim();
  let name = $('#newName').value.trim();
  if (!name) name = (input.split('\n')[0] || item.title).replace(/^附件路径：.*$/, '').slice(0, 24) || item.title;
  if (!input) { toast('先把需求或对象贴进来，不然Claude不知道做什么。'); return; }
  const p = await uw.createProject({ name, role: S.pendingRole.id, scene: item.id, input });
  hide('#modalNew');
  await openProject(p.id);
  const prompt = fill(item.prompt, { input, project: p.name });
  send(prompt, item.title, input);
};
function fill(tpl, v) { return tpl.replace(/\{\{input\}\}/g, v.input || '').replace(/\{\{project\}\}/g, v.project || '').replace(/\{\{pack\}\}/g, S.boot.packDir); }

/* ── 打开项目 / 视图切换 ──────────────────────────── */
async function openProject(id) {
  const p = await uw.openProject(id);
  if (!p) { toast('这个项目打不开了'); return; }
  S.project = p;
  if (!S.logs.has(id)) {
    const items = [];
    for (const m of (p.messages || [])) items.push(m.role === 'user' ? { k: 'user', text: m.display || m.text, label: m.label, inter: !!m.inter } : { k: 'text', text: m.text, closed: true });
    if (items.length) items.push({ k: 'sys', text: '以上是之前的记录。继续说，会接着同一个会话。' });
    S.logs.set(id, { items, busy: !!p.busy, startedAt: null });
  }
  setView('work');
  $('#wkName').title = String(p.name || ''); $('#wkName').textContent = p.name;
  $('#wkChips').innerHTML = `<span class="chip">${esc((roleOf(p.role) || {}).name || '')}</span><span class="chip">${esc(sceneTitle(p))}</span>${p.sessionId ? '<span class="chip" title="Claude Code会话">会话已接上</span>' : ''}`;
  renderLog(); renderProjects(S.projects || []);
  S.previewFile = null; S.codeFile = null;
  AT.list = []; renderAttach();
  S.figma = p.figma || { changes: [], files: {} };
  await refreshFiles(false);
  /* 这个项目只动过 Figma、没产出网页 → 默认就停在设计稿那页，别让人看一块空白 */
  const hasHtml = (p.files || []).some(f => /\.html?$/i.test(f.rel));
  setTab(figmaTabVisible() && !hasHtml ? 'design' : 'preview');
  updateStatus();
}
function setView(v) {
  S.view = v;
  $('#viewHome').hidden = v !== 'home'; $('#viewWork').hidden = v !== 'work'; $('#viewKb').hidden = !(v === 'libs' || v === 'skills');
  $$('.nav[data-nav]').forEach(b => b.classList.toggle('on', b.dataset.nav === v));
  if (v === 'home') { S.project = null; uw.listProjects().then(renderProjects); }
  if (v === 'libs' || v === 'skills') { if (v === 'libs' && KB.view !== 'lib' && KB.view !== 'search') KB.view = 'libs'; KB.doc = null; kbLoad(); renderKb(); }
}
$$('.nav[data-nav]').forEach(b => b.onclick = () => setView(b.dataset.nav));
$('#btnBack').onclick = () => setView('home');

/* ── 文件与预览 ───────────────────────────────────── */
async function refreshFiles(keep) {
  if (!S.project) return;
  const files = await uw.listFiles(S.project.id);
  S.project.files = files;
  const htmls = files.filter(f => /\.html?$/i.test(f.rel));
  const sel = $('#previewFile'); const prev = S.previewFile;
  sel.innerHTML = htmls.map(f => `<option value="${esc(f.rel)}">${esc(f.rel)}</option>`).join('');
  if (htmls.length) {
    const pend = S.pendingPreview && htmls.some(f => f.rel === S.pendingPreview) ? S.pendingPreview : null;
    S.previewFile = pend || ((keep && prev && htmls.some(f => f.rel === prev)) ? prev : (htmls.find(f => f.rel === 'index.html') || htmls[0]).rel);
    if (pend) S.pendingPreview = null;
    sel.value = S.previewFile;
    $('#previewEmpty').hidden = true; $('#frameWrap').hidden = false;
    sel.hidden = false;
    loadPreview();
  } else { S.previewFile = null; sel.hidden = true; $('#previewEmpty').hidden = false; $('#frameWrap').hidden = true; renderLive(); }
  const csel = $('#codeFile');
  const textish = files.filter(f => /\.(html?|css|js|ts|vue|jsx|tsx|md|json|txt|svg|csv)$/i.test(f.rel));
  csel.innerHTML = textish.map(f => `<option value="${esc(f.rel)}">${esc(f.rel)}</option>`).join('');
  if (textish.length) { S.codeFile = (keep && S.codeFile && textish.some(f => f.rel === S.codeFile)) ? S.codeFile : textish[0].rel; csel.value = S.codeFile; if (S.tab === 'code') loadCode(); }
  if (S.tab === 'design') renderDesign();
  const fl = $('#fileList'); fl.innerHTML = '';
  if (!files.length) fl.innerHTML = '<div class="none muted" style="padding:12px">还没有文件</div>';
  for (const f of files) {
    const b = document.createElement('button'); b.className = 'f-row-i';
    b.innerHTML = `<span class="n">${esc(f.rel)}</span><span>${fmtSize(f.size)}</span><span>${fmtTime(f.mtime)}</span>`;
    b.onclick = () => { S.codeFile = f.rel; csel.value = f.rel; setTab('code'); loadCode(); };
    fl.appendChild(b);
  }
}
/* ── 设计稿：这次动了什么 ───────────────────────────
   做 Figma 稿时产物在 Figma 里，不在项目目录。这一页不是实时预览（实时看去 Figma），
   是给回看和交付用的：改动记录 + 落到项目里的截图 + 一键跳回那个节点。 */
function figmaTabVisible() {
  const on = !!(S.figma && (S.figma.changes || []).length);
  $('#stageTabs button[data-tab="design"]').hidden = !on;
  return on;
}
function shotFiles() {
  return ((S.project && S.project.files) || []).filter(f => /\.(png|jpe?g|svg|webp)$/i.test(f.rel))
    .sort((a, b) => b.mtime - a.mtime);
}
function renderDesign() {
  if (!figmaTabVisible() || !S.project) return;
  const shots = shotFiles();
  const box = $('#dsnShots');
  box.innerHTML = shots.length ? shots.map(f => {
    const src = `uwproj://p/${encodeURIComponent(S.project.id)}/${f.rel.split('/').map(encodeURIComponent).join('/')}?t=${f.mtime}`;
    return `<button class="dsn-shot" data-src="${esc(src)}"><img src="${esc(src)}" alt=""><span class="cap">${esc(f.rel)}</span></button>`;
  }).join('') : '<div class="dsn-none">还没有截图。截图不只是给你看的，也是它自己核对用的。</div>';
  $$('#dsnShots .dsn-shot').forEach(b => b.onclick = () => bigShot(b.dataset.src));

  /* 动过 Figma 但一张截图都没有——这时候提示一句，并给一个按钮让它补上 */
  const hint = $('#dsnHint');
  hint.hidden = !!shots.length;
  if (!shots.length) hint.innerHTML = `<span>它改了Figma，但没往项目里存截图，这样你回看和交付都没有东西可指。</span><button class="btn sm" id="btnAskShot">让它补截图</button>`;
  const ask = $('#btnAskShot');
  if (ask) ask.onclick = () => send('把你刚才在Figma里改动的每个节点各截一张图，用get_screenshot拿到链接后curl存到项目的「设计稿」目录里，文件名用节点的名字。存完告诉我存了哪几张。');

  const log = (S.figma.changes || []).slice().reverse();
  $('#dsnLog').innerHTML = log.map(c => {
    const d = new Date(c.at); const p2 = n => String(n).padStart(2, '0');
    return `<li><span class="t">${p2(d.getHours())}:${p2(d.getMinutes())}</span><span class="d">${esc(c.desc || figmaVerb(c.tool))}</span><span class="n">${esc((c.nodeIds || []).slice(0, 3).join(' '))}</span></li>`;
  }).join('') || '<li><span class="d">还没有改动记录</span></li>';
}
/* 只有 use_figma 带 description（必填），其余 Figma 工具没有，用人话补上，别在界面上摆工具名 */
function figmaVerb(t) {
  return ({ use_figma: '改了稿子', get_screenshot: '截了一张图', download_assets: '导出了素材',
    get_design_context: '读了稿子的结构', get_metadata: '查了节点信息', get_variable_defs: '查了变量',
    search_design_system: '查了组件库', create_new_file: '新建了文件', upload_assets: '传了素材' })[t] || t;
}
function bigShot(src) {
  const m = document.createElement('div'); m.className = 'shotmask';
  m.innerHTML = `<img src="${esc(src)}" alt="">`;
  m.onclick = () => m.remove();
  document.body.appendChild(m);
}
$('#btnOpenFigma').onclick = () => {
  const f = S.figma && S.figma.files || {};
  const key = Object.keys(f).sort((a, b) => f[b].lastAt - f[a].lastAt)[0];
  if (!key) return toast('还不知道是哪个Figma文件');
  uw.openFigma({ fileKey: key, nodeId: f[key].lastNode || null });
};
$('#btnCollapse').onclick = () => {
  const b = $('.wk-body');
  if (b.classList.contains('canvas')) setCanvasOnly(false);   // 两个方向互斥：只看对话 / 只看画布
  const on = b.classList.toggle('solo');
  $('#btnCollapse').textContent = on ? '显示内容区' : '只看对话';
  if (!on) setTimeout(fitPreview, 30);
};
/* 收起对话：画布放大。左边缘留把手，Claude 在跑或有新回复时把手上的点会亮，收起了也不会错过 */
function setCanvasOnly(on) {
  const b = $('.wk-body');
  if (on && b.classList.contains('solo')) { b.classList.remove('solo'); $('#btnCollapse').textContent = '只看对话'; }
  b.classList.toggle('canvas', !!on);
  const h = $('#chatHandle'); h.classList.toggle('on', !!on);
  h.title = hk(on ? '展开对话（⇧⌘\\）' : '收起对话（⇧⌘\\）'); h.setAttribute('aria-label', on ? '展开对话' : '收起对话');
  if (!on) h.classList.remove('unread');
  setTimeout(fitPreview, 30);
}
function canvasOnly() { return $('.wk-body').classList.contains('canvas'); }
$('#chatHandle').onclick = () => setCanvasOnly(!canvasOnly());
window.addEventListener('keydown', e => { if (S.view === 'work' && (e.metaKey || e.ctrlKey) && e.shiftKey && e.key === '\\') { e.preventDefault(); setCanvasOnly(!canvasOnly()); } });

function fmtSize(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? Math.round(n / 1024) + ' KB' : n + ' B'; }
/* ── 预览是两张画布轮流上（双缓冲）─────────────────
   换图标、删元素、拖组件这类改动会改变源码里的编号，所以必须重新装一次页面。
   原来就一张画布，重装时先白一下、再跳回顶部，肉眼看着就是「晃一下」（吉吉 2026-09-17：要无感）。
   现在新页面先在**看不见的那张**上装，装好了（探针 ready）再整帧换过去，中间一帧白的都没有。 */
const PV = { cur: 'preview', other: 'preview2', pending: null, timer: null, loaded: false };
function curFrame() { return $('#' + PV.cur); }
function bothFrames() { return [$('#preview'), $('#preview2')]; }
function swapFrames() {
  const [a, b] = [PV.cur, PV.other]; PV.cur = b; PV.other = a;
  $('#' + PV.cur).classList.add('on'); $('#' + PV.other).classList.remove('on');
  $('#' + PV.other).src = 'about:blank';       // 后台那张腾空，别让它继续跑脚本、也别占内存
  SEL.r = null; drawSel();                     // 换帧了，旧选框先撤掉，等新页面的探针报上来
}
function loadPreview(force) {
  if (!S.project || !S.previewFile) return;
  /* 手改刚写完文件，监听器会跟着要重载；样式/文字改动 DOM 里已经是新的，重载只会闪一下、还丢选中，压掉 */
  if (!force && ED.suppress && Date.now() < ED.suppress) { fqCheck(); return; }
  const fr = $('#' + PV.other);
  S.contentW = 0;   // 上一个页面的宽度不能带到下一个
  PV.pending = fr; PV.loaded = false;
  clearTimeout(PV.timer);
  fr.onload = () => { PV.loaded = true; };
  PV.timer = setTimeout(() => { if (PV.pending === fr && PV.loaded) { PV.pending = null; swapFrames(); toast('这页的编辑探针没起来，手改用不了；刷新一次试试'); } }, 4000);
  fr.src = `uwproj://p/${encodeURIComponent(S.project.id)}/${S.previewFile.split('/').map(encodeURIComponent).join('/')}?t=${Date.now()}`;
  fitPreview();
  fqCheck();
}
/* ── 飞鹊体检：客户端自己的机器门 ──────────────────
   终端里有 Stop 钩子兜底，客户端没有；这里每次预览文件落地就静态扫一遍，
   结果摆在预览栏上，一键喂回给 Claude。不自动替用户发，改不改他定。 */
async function fqCheck(announce) {
  const pill = $('#fqPill'), tf = $('#btnToFigma');
  if (!S.project || !S.previewFile) { pill.hidden = true; if (tf) tf.hidden = true; return; }
  if (tf) tf.hidden = !/\.html?$/i.test(S.previewFile);
  const r = await uw.checkFile({ id: S.project.id, rel: S.previewFile });
  S.fq = { rel: S.previewFile, ...r };
  pill.hidden = false; pill.className = 'fq-pill ' + (r.badN ? 'bad' : r.n ? 'warn' : 'ok');
  /* 字体焊死是应用自动写进文件的，不是模型写的——得让人知道文件被动过，否则下次看 diff 会莫名其妙 */
  if (r.font && r.font.changed) { const L0 = log(); if (L0) { L0.items.push({ k: 'sys', text: `已把 Roboto 的 400/700 焊死写进${S.previewFile}（${r.font.why}）。不写这段的话，装了多个 Roboto 的机器上 400 会被匹配成 Black、中文却是 Regular，中西文差 5 个字重档。` }); renderLog(); } }
  pill.innerHTML = r.n ? `飞鹊体检 <b>${r.n}</b>` : '飞鹊体检 ✓';
  if (announce && r.n) {
    const L = log(); if (!L) return;
    /* 硬伤自动喂回去改一轮（像终端的 Stop 门）；每条用户消息最多自动一轮，改完还不过就摆出来给人看，别死循环 */
    if (r.badN && !L.autoFixed && !L.busy) {
      L.autoFixed = true;
      L.items.push({ k: 'sys', text: `飞鹊体检：${S.previewFile}有${r.badN}处硬伤、${r.n - r.badN}处提醒，已自动让它照着改一轮。` }); renderLog();
      send(fqFixText(S.fq), '飞鹊体检·自动', `按飞鹊体检的${r.n}条改${S.previewFile}`);
    } else {
      L.items.push({ k: 'sys', text: `飞鹊体检：${S.previewFile}还有 ${r.n}处不合规（${r.badN}处硬伤）${L.autoFixed ? '，自动改过一轮仍没过' : ''}。点预览栏上的「飞鹊体检」看明细。` }); renderLog();
    }
  }
}
$('#fqPill').onclick = e => {
  e.stopPropagation(); const m = $('#fqMenu'); if (!m.hidden) { m.hidden = true; return; }
  const r = S.fq || { issues: [] };
  m.innerHTML = `<div class="fq-h">${esc(r.rel || '')} · ${r.n ? `${r.n}处不合规` : '全部通过'}${r.fqUsed != null ? `<small>用到飞鹊类${r.fqUsed}个</small>` : ''}</div>`
    + (r.issues.length ? r.issues.map(i => `<div class="fq-i lv-${i.level}"><i></i><span>${esc(i.msg)}</span></div>`).join('') : '<div class="fq-i lv-ok"><i></i><span>字体与字重焊死、色值、组件类名与尺寸、裸控件、红按钮数、提示条用法、价格写法、品牌资产都合规</span></div>')
    + (r.issues.length ? `<div class="fq-f"><span class="muted">静态扫描，只抓机器能判的那几类；像不像还得你看</span><button class="btn sm pri" id="fqFix">让Claude照着改</button></div>` : '');
  m.hidden = false;
  const fix = $('#fqFix'); if (fix) fix.onclick = () => { m.hidden = true; send(fqFixText(r), '飞鹊体检', `按飞鹊体检的${r.n}条改${r.rel}`); };
};
function fqFixText(r) {
  /* info 级（手搓占比、克隆页豁免说明）是摆给人看的事实，不是要改的问题。
     喂进去模型会拿着「自造类 55%」去硬改，把该设计的业务块也塞进飞鹊砖里。 */
  const todo = r.issues.filter(i => i.level !== 'info');
  return [`「飞鹊体检」对${r.rel}扫出${todo.length}处不合规，逐条改掉，改完自己再对一遍：`, '',
    ...todo.map((i, k) => `${k + 1}. ${i.msg}`), '',
    `规则来源：${S.boot.packDir}/DESIGN.md第5、5b节；组件规则从${S.boot.packDir}/docs/css/里对应的文件整段复制（28类组件一类一个文件，清单见同目录INDEX.md），类名保持飞鹊的，不自己写一套。改完在回答里说清每条改成了什么。`].join('\n');
}
/* MIC / 飞鹊响应式断点（取自全栈规范 mic-responsive-spec：6 个断点 + 各自的内容区宽度）。
   基准设计宽度 1440。1240 曾经是个档，但它是「1280 断点的内容区宽度」不是视口宽度——
   按视口 1240 看，页面其实落在 1024-1279 这一档、内容区该是 984，摆在这儿会让人把两件事搞混，撤了。 */
const BPS = [
  { w: 1920, content: 1440, kind: 'web', note: '≥1440同档' },
  { w: 1440, content: 1440, kind: 'web', note: '基准设计宽度' },
  { w: 1366, content: 1326, kind: 'web' },
  { w: 1280, content: 1240, kind: 'web' },
  { w: 1024, content: 984, kind: 'web' },
  { w: 768, content: 728, kind: 'web', note: 'Pad' },
  { w: 375, content: 375, kind: 'mob', note: 'WAP' },
];
const bpOf = w => BPS.find(b => b.w === +w) || null;
function buildWidthSel() {
  const sel = $('#widthSel'); if (!sel) return;
  const grp = (label, kind) => `<optgroup label="${label}">${BPS.filter(b => b.kind === kind).map(b => `<option value="${b.w}">${b.w} · 内容区 ${b.content}${b.note ? ' · ' + b.note : ''}</option>`).join('')}</optgroup>`;
  sel.innerHTML = `<option value="auto">自适应</option>` + grp('Web端', 'web') + grp('移动端', 'mob');
  sel.value = String(S.width || 'auto');
}
/* 宽度和缩放是两回事：宽度决定按多宽的画布渲染，缩放只决定看多大。
   自适应档把用户缩放乘进 fit 系数里；定宽档用 CSS zoom（它会重排、滚动条才对，transform 不会）。 */
function fitPreview() {
  const w = $('#frameWrap'), frames = bothFrames(), box = $('#fitBox');
  const z = S.zoom || 1;
  const setFr = f => frames.forEach(fr => { for (const k in f) fr.style[k] = f[k]; });
  if (S.width !== 'auto') {
    const b = bpOf(S.width), wpx = +S.width;
    setFr({ transform: '', width: '', height: '' });
    box.style.width = wpx + 'px';
    box.style.height = b && b.kind === 'mob' ? '812px' : '';
    box.style.zoom = z === 1 ? '' : String(z);
    w.classList.remove('fit'); w.classList.add('fixed'); w.classList.toggle('mob', !!(b && b.kind === 'mob'));
    drawGuides(b, wpx);
    centerOrPin(w, box);
    drawSel();
    return;
  }
  w.classList.remove('fixed', 'mob'); box.style.zoom = ''; drawGuides(null);
  const pane = w.clientWidth - 32, ph = w.clientHeight - 32;
  /* 🔴 base 曾写死 1240，页面宽过它就被 iframe 裁掉（1400px 的产品列表页右边整条栏看不见）。
     现在用协议层探针报上来的真实内容宽度，封顶 2560 防止某个溢出元素把整页缩成米粒。 */
  const base = Math.min(2560, Math.max(1240, S.contentW || 0));
  const scale = Math.min(1, pane / base) * z;
  w.classList.add('fit');
  box.style.width = Math.round(base * scale) + 'px'; box.style.height = ph + 'px';
  setFr({ width: base + 'px', height: Math.round(ph / scale) + 'px', transform: `scale(${scale})` });
  centerOrPin(w, box);
  drawSel();
}
/* 内容区参考线：按飞鹊规范，这个断点的内容区该有多宽。页面自己的内容区对不对得上，一眼看得见。
   只在定宽档画——自适应档的视口宽度不是任何一个断点，画了就是假的。 */
function drawGuides(b, wpx) {
  const g = $('#guides'); if (!g) return;
  if (!b || !S.guides || b.kind === 'mob') { g.hidden = true; return; }
  const inset = Math.max(0, (wpx - b.content) / 2);
  g.hidden = false;
  g.querySelector('.gl').style.left = inset + 'px';
  g.querySelector('.gr').style.left = (wpx - inset) + 'px';
  g.querySelector('b').textContent = `内容区${b.content}`;
}
/* 居中的元素一旦比容器宽，左半边会被裁掉且滚不回去（overflow 容器 + margin:auto 的老问题）。
   所以只在放得下的时候才居中，放不下就靠左，让横向滚动条能把左边滚出来。 */
function centerOrPin(wrap, box) {
  const fits = box.getBoundingClientRect().width <= wrap.clientWidth - 32 + 1;
  box.style.marginLeft = fits ? 'auto' : '0';
  box.style.marginRight = fits ? 'auto' : 'auto';
}
const ZOOMS = [0.5, 0.67, 0.8, 0.9, 1, 1.25, 1.5, 2, 3];
function setZoom(z) {
  S.zoom = Math.min(3, Math.max(0.5, z));
  $('#btnZoomLvl').textContent = Math.round(S.zoom * 100) + '%';
  fitPreview();
}
function stepZoom(dir) {
  const i = ZOOMS.findIndex(z => z > S.zoom + 1e-6);
  const j = [...ZOOMS].reverse().find(z => z < S.zoom - 1e-6);
  setZoom(dir > 0 ? (i < 0 ? 3 : ZOOMS[i]) : (j == null ? 0.5 : j));
}
$('#btnZoomIn').onclick = () => stepZoom(1);
$('#btnZoomOut').onclick = () => stepZoom(-1);
$('#btnZoomLvl').onclick = () => setZoom(1);
/* 按住 option（⌥）滚轮缩放。不绑 ctrl：macOS 上 ctrl+滚轮是系统放大镜，会打架。 */
$('#stagePreview').addEventListener('wheel', e => {
  if (!(e.altKey || e.metaKey)) return;
  e.preventDefault();
  setZoom(S.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
}, { passive: false });
window.addEventListener('keydown', e => {
  if (!(e.metaKey || e.ctrlKey) || S.view !== 'work' || S.tab !== 'preview') return;
  if (e.key === '=' || e.key === '+') { e.preventDefault(); stepZoom(1); }
  else if (e.key === '-') { e.preventDefault(); stepZoom(-1); }
  else if (e.key === '0') { e.preventDefault(); setZoom(1); }
});
window.addEventListener('resize', () => { if (S.view === 'work') fitPreview(); });
/* 预览 iframe 跨源（uwproj:// vs file://），读不到 contentDocument，只能让页面自己把尺寸报上来。
   探针在 main.js 的协议层注入（FIT_PROBE）。只认预览那个 iframe 发的，别的一律不理。 */
window.addEventListener('message', e => {
  if (!e.data || e.data.__uwFit !== 1) return;
  if (!bothFrames().some(f => f && e.source === f.contentWindow)) return;
  const w = Math.ceil(e.data.w || 0);
  if (!w || w === S.contentW) return;
  S.contentW = w;
  if (S.width === 'auto') fitPreview();
});
async function loadCode() {
  if (!S.project || !S.codeFile) { $('#codeView').textContent = ''; return; }
  const r = await uw.readFile({ id: S.project.id, rel: S.codeFile });
  $('#codeView').textContent = r.tooBig ? `文件太大（${fmtSize(r.size)}），用「打开文件夹」看。` : r.text;
}
function setTab(t) {
  S.tab = t;
  $$('#stageTabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  $('#stagePreview').hidden = t !== 'preview'; $('#stageCode').hidden = t !== 'code';
  $('#stageFiles').hidden = t !== 'files'; $('#stageDesign').hidden = t !== 'design';
  $('#previewTools').hidden = t !== 'preview'; $('#codeTools').hidden = t !== 'code';
  $('#designTools').hidden = t !== 'design';
  if (t !== 'preview' && ED.on) setEdit(false);
  if (t === 'code') loadCode();
  if (t === 'design') renderDesign();
}
$$('#stageTabs button').forEach(b => b.onclick = () => setTab(b.dataset.tab));
$('#previewFile').onchange = e => { if (ED.on) setEdit(false); S.previewFile = e.target.value; FLOW.state = 'default'; loadPreview(true); };
$('#codeFile').onchange = e => { S.codeFile = e.target.value; loadCode(); };
buildWidthSel();
$('#widthSel').onchange = e => {
  S.width = e.target.value;
  /* 1920 这种比窗口还宽的档，默认按装得下的比例显示——不然一换过去就是右半边全在视口外
     （缩放读数照实写 57%，不骗人：100% 永远是 1:1） */
  if (S.width !== 'auto') {
    const pane = $('#frameWrap').clientWidth - 32;
    S.zoom = Math.min(1, Math.max(0.25, pane / +S.width));
    $('#btnZoomLvl').textContent = Math.round(S.zoom * 100) + '%';
  }
  fitPreview();
};
/* 间距标尺的开关：默认开着（多数时候就是想看间距），嫌碍事随时关。
   记在本机，下次打开还是你上次选的那样。 */
S.gaps = localStorage.getItem('uw.gaps') !== '0';
function setGaps(on) {
  S.gaps = !!on;
  localStorage.setItem('uw.gaps', S.gaps ? '1' : '0');
  const b = $('#ebGap'); if (b) b.classList.toggle('on', S.gaps);
  probe({ __uwEditCmd: 'gaps', on: S.gaps });
}
$('#ebGap').onclick = () => setGaps(!S.gaps);
$('#btnGuide').onclick = () => { S.guides = !S.guides; $('#btnGuide').classList.toggle('on', S.guides); fitPreview(); };
$('#btnRefresh').onclick = () => { loadPreview(true); refreshFiles(true); };
$('#btnOpenExt').onclick = () => { if (S.project && S.previewFile) uw.openPath(S.project.dir + '/' + S.previewFile); };
$('#btnFolder').onclick = () => S.project && uw.openPath(S.project.dir);
$('#btnTerminal').onclick = async () => { if (!S.project) return; await uw.openTerminal(S.project.id); toast('已在系统终端里打开这个项目的Claude Code会话'); };

/* ── 对话与事件流 ─────────────────────────────────── */
function log() { return S.project ? S.logs.get(S.project.id) : null; }
async function send(text, label, display) {
  if (!S.project) return;
  const L = log();
  /* 它在跑的时候照样能说（跟终端一样）：不拦、不排队，直接发进去，Claude 在下一步工具回来时就看到。
     以前这里 toast「上一条还在跑」拦掉了——用户想补一句「响应式也要跟线上一样」只能干等 6 分钟，等到能发多半已经晚了。 */
  const interjecting = !!L.busy;
  const note = edNoteForClaude(); if (note) { display = display || text; text = note + text; }
  const at = attachText(); if (at.text) { display = (display || text) + at.display; text = text + at.text; }
  const r = await uw.send({ id: S.project.id, text, label: label || null, display: display || null });
  if (!r.ok) { toast(r.message || '发不出去'); return; }
  L.items.push({ k: 'user', text: display || text, label, inter: interjecting });
  if (!interjecting) { L.busy = true; L.startedAt = Date.now(); }   // 补充的那句不算新一轮，计时接着上一轮走
  L.textOpen = false;
  if (AT.list.length) { AT.list = []; renderAttach(); }
  if (label !== '飞鹊体检·自动') L.autoFixed = false;
  renderLog(); updateStatus(); renderProjects(S.projects || []);
}
$('#btnSend').onclick = () => { const t = $('#composer'); const v = t.value.trim(); if (!v && !AT.list.length) return; t.value = ''; autoGrow(t); send(v || '看一下附件。'); };
$('#composer').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#btnSend').click(); } });
$('#composer').addEventListener('input', e => autoGrow(e.target));
function autoGrow(t) { t.style.height = 'auto'; t.style.height = Math.min(180, t.scrollHeight) + 'px'; }
$('#btnStop').onclick = async () => { if (!S.project) return; const L = log(); L.stopRequested = true; await uw.interrupt(S.project.id); L.items.push({ k: 'sys', text: '已请求停止，正在等Claude收手。' }); renderLog(); };
function friendlyErr(e) { return ({ error_during_execution: '执行中断了（多半是某一步被拒绝或被停止）', error_max_turns: '轮次到上限了', error_max_budget_usd: '预算到上限了' })[e] || e; }

function onRunEvent(id, ev) {
  let L = S.logs.get(id); if (!L) { L = { items: [], busy: false }; S.logs.set(id, L); }
  const it = L.items; const last = it[it.length - 1];
  switch (ev.t) {
    case 'init': S.runModel = ev.model || null; if (S.project && S.project.id === id) renderRunModel(); break;   // 不再播报整行，但当前用的哪个模型要看得见，正文里重复只是噪音
    case 'turn_start':
      L.busy = true; L.startedAt = Date.now(); L.stopRequested = false;
      L.act = { since: Date.now(), steps: 0, list: [] };
      /* 上一轮已经「完成」之后 Claude 自己又动起来了（后台命令或子任务有结果回来）——
         不是用户发的消息，界面上得说一句，不然像是凭空开始干活 */
      if (ev.resumed) it.push({ k: 'sys', text: ev.interjected ? '接着处理你刚补的那句。' : '后台任务有结果回来了，Claude接着往下做（不用你再发消息）。' });
      if (S.project && S.project.id === id) setAct(ev.resumed ? (ev.interjected ? '在看你刚补的那句…' : '后台任务回来了，接着做…') : '正在理解你的要求…');
      break;
    case 'thinking_start': it.push({ k: 'think', at: Date.now(), open: true }); if (S.project && S.project.id === id) setAct('正在想怎么做…'); break;
    case 'thinking_end': { const th = [...it].reverse().find(x => x.k === 'think' && x.open); if (th) { th.open = false; th.ms = Date.now() - th.at; } break; }
    case 'text': if (last && last.k === 'text' && !last.closed) last.text += ev.delta; else it.push({ k: 'text', text: ev.delta }); if (S.project && S.project.id === id) setAct('正在写给你的说明…'); break;
    case 'text_end': if (last && last.k === 'text') last.closed = true; break;
    case 'tool_start': it.push({ k: 'tool', id: ev.id, name: ev.name, desc: '', status: 'run' }); if (S.project && S.project.id === id) setAct(actVerb(ev.name)); break;
    case 'tool_use': {
      let t = it.find(x => x.k === 'tool' && x.id === ev.id);
      if (!t) { t = { k: 'tool', id: ev.id, name: ev.name, status: 'run' }; it.push(t); }
      t.desc = toolDesc(ev.name, ev.input);
      if (S.project && S.project.id === id) {
        setAct(actVerb(ev.name) + (t.desc ? '：' + t.desc : ''));
        /* 它正在写的那个网页，等文件落地后自动切到预览上——别让用户自己去下拉框里找 */
        const fp = (ev.input || {}).file_path || '';
        if (/^(Write|Edit|MultiEdit)$/.test(ev.name) && /\.html?$/i.test(fp) && S.project.dir && fp.startsWith(S.project.dir + '/')) {
          S.pendingPreview = fp.slice(S.project.dir.length + 1);
        }
      }
      break;
    }
    case 'tool_result': { const t = it.find(x => x.k === 'tool' && x.id === ev.id); if (t) { t.status = ev.error ? 'bad' : 'ok'; t.preview = ev.preview; } break; }
    case 'perm': it.push({ k: 'perm', requestId: ev.requestId, tool: ev.tool, input: ev.input, desc: ev.description || toolDesc(ev.tool, ev.input), status: 'open' }); if (S.project && S.project.id === id) { setAct('在等你点「允许」：' + (ev.tool || '')); setTimeout(() => { const el = $('#chatLog'); if (el) el.scrollTop = el.scrollHeight; }, 30); } break;
    case 'perm_closed': { const p = it.find(x => x.k === 'perm' && x.requestId === ev.requestId); if (p && p.status === 'open') p.status = 'closed'; break; }
    case 'perm_auto': it.push({ k: 'sys', text: `已按「本次任务全部放行」自动允许：${ev.tool}${ev.description ? ' · ' + ev.description : ''}` }); break;
    case 'denied': it.push({ k: 'sys', text: `这一步被拒绝了：${ev.tool}。${ev.message || ''}` }); break;
    case 'result': {
      L.busy = false;
      /* 存历史交给主进程边说边存（这里再存一遍会重复） */
      it.push({ k: 'result', ok: ev.ok, turns: ev.turns, ms: ev.durationMs, err: ev.error, why: ev.why || null, usage: ev.usage, stopped: !!L.stopRequested });
      L.stopRequested = false;
      /* 这一轮结束了就体检一次，有问题在对话里点一句（不自动发回去，改不改用户定） */
      if (S.project && S.project.id === id) refreshFiles(true).then(() => fqCheck(true));
      break;
    }
    case 'notice': it.push({ k: 'sys', text: (ev.key === 'stop-hook-error' ? '收尾钩子报错了（Stop hook）：' : '') + (ev.text || ev.key || '') }); break;
    case 'error': case 'stderr': it.push({ k: 'err', text: ev.message || ev.text }); break;
    case 'exit': L.busy = false; it.push({ k: 'sys', text: ev.code === 0 || ev.code == null ? 'Claude进程已结束。再发消息会用同一个会话重新接上。' : `Claude进程退出（代码${ev.code}）。再发消息会重新拉起。` }); break;
    default: return;
  }
  if (S.project && S.project.id === id) { renderLog(ev.t === 'text' || ev.t === 'thinking'); updateStatus(); }
  if (ev.t === 'result' || ev.t === 'turn_start' || ev.t === 'exit') renderProjects(S.projects || []);
}
/* MCP 工具名长得像 mcp__chrome-devtools__take_screenshot：拆成「来源 + 动作」，界面上别摆原样 */
function toolParts(name) {
  const m = String(name || '').match(/^mcp__(.+?)__(.+)$/);
  return m ? { src: m[1].replace(/^plugin_[^_]+_/, ''), op: m[2] } : { src: null, op: String(name || '') };
}
const MCP_VERBS = {
  navigate_page: '正在打开网页', new_page: '正在打开网页', take_screenshot: '正在给网页截图', take_snapshot: '正在读网页结构',
  evaluate_script: '正在网页里跑脚本', click: '正在操作网页', fill: '正在操作网页', fill_form: '正在操作网页', hover: '正在操作网页',
  wait_for: '正在等网页加载', list_pages: '正在看开着的网页', resize_page: '正在调网页尺寸', press_key: '正在操作网页',
  use_figma: '正在改Figma稿', get_screenshot: '正在给Figma稿截图', get_design_context: '正在读Figma稿', get_metadata: '正在读Figma稿',
  search_design_system: '正在查飞鹊组件库', download_assets: '正在导Figma素材', get_variable_defs: '正在查Figma变量',
};
function actVerb(name) {
  const { src, op } = toolParts(name);
  if (src) return MCP_VERBS[op] || ('正在用' + src.replace(/-/g, ' ') + '的' + op);
  return ({ Write: '正在写文件', Edit: '正在改文件', MultiEdit: '正在改文件', Read: '正在读文件',
    Bash: '正在跑命令', Glob: '正在找文件', Grep: '正在搜内容', WebFetch: '正在读网页', WebSearch: '正在搜网上',
    Task: '正在派子任务', Agent: '正在派子任务', TodoWrite: '正在理清步骤', Skill: '正在加载技能', ToolSearch: '正在找工具' })[name] || ('正在用 ' + name);
}
function toolDesc(name, input) {
  input = input || {};
  const base = p => String(p || '').split('/').pop();
  const { src, op } = toolParts(name);
  if (src) {
    if (input.url) return String(input.url).replace(/^https?:\/\//, '').slice(0, 80);
    if (input.description) return String(input.description).slice(0, 80);
    if (input.nodeId) return '节点 ' + input.nodeId;
    if (input.filePath) return base(input.filePath);
    if (op === 'evaluate_script') return String(input.function || '').replace(/\s+/g, ' ').slice(0, 80);
    if (input.query) return String(input.query).slice(0, 80);
    const keys = Object.keys(input).filter(k => !/^(pageId|fileKey)$/.test(k));
    return keys.length ? keys.map(k => k + '=' + String(typeof input[k] === 'object' ? JSON.stringify(input[k]) : input[k]).slice(0, 30)).join(' ').slice(0, 80) : '';
  }
  switch (name) {
    case 'Write': return '写入 ' + base(input.file_path);
    case 'Edit': case 'MultiEdit': return '修改 ' + base(input.file_path);
    case 'Read': return '读取 ' + base(input.file_path);
    case 'Bash': return input.description || (input.command || '').slice(0, 80);
    case 'Glob': case 'Grep': return input.pattern || '';
    case 'Skill': return '技能 ' + (input.skill || input.name || '');
    case 'WebFetch': return input.url || '';
    case 'Task': return input.description || '';
    case 'TodoWrite': return '更新待办';
    default: return JSON.stringify(input).slice(0, 80);
  }
}

/* 渲染对话（增量：只有流式文本时不重建整棵树） */
let lastRenderedCount = -1;
function renderLog(streaming) {
  const L = log(); const box = $('#chatLog');
  if (!L) { box.innerHTML = ''; return; }
  const it = L.items;
  if (streaming && lastRenderedCount === it.length && box.lastElementChild) {
    const last = it[it.length - 1];
    if (last.k === 'text') { box.lastElementChild.innerHTML = md(last.text); scrollBottom(box); return; }
    if (last.k === 'think') return;
  }
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  box.innerHTML = '';
  for (const x of it) box.appendChild(nodeFor(x));
  lastRenderedCount = it.length;
  if (atBottom || streaming) scrollBottom(box);
}
function scrollBottom(box) { box.scrollTop = box.scrollHeight; }
function nodeFor(x) {
  const d = document.createElement('div');
  switch (x.k) {
    case 'user': d.className = 'msg-user' + (x.inter ? ' inter' : ''); d.innerHTML = (x.inter ? `<span class="lbl">补充 · 它做完手上这一步就会看到</span>` : x.label ? `<span class="lbl">${esc(x.label)}</span>` : '') + esc(x.text.length > 1200 ? x.text.slice(0, 1200) + '\n…（已折叠，完整内容在项目的 需求输入.md）' : x.text); break;
    case 'text': d.className = 'msg-ai'; d.innerHTML = md(x.text); break;
    case 'think': d.className = 'row-think'; d.innerHTML = x.open ? '<span class="spin"></span>思考中…' : `已思考${Math.max(1, Math.round((x.ms || 0) / 1000))}秒`; break;
    case 'tool': { const tp = toolParts(x.name); d.className = 'row-tool'; d.innerHTML = `<i class="st ${x.status}">${x.status === 'ok' ? '✓' : x.status === 'bad' ? '!' : ''}</i><b title="${esc(x.name)}">${esc(tp.op)}</b>${tp.src ? `<em class="src">${esc(tp.src)}</em>` : ''}<span title="${esc(x.preview || '')}">${esc(x.desc || '')}</span>`; break; }
    case 'perm': {
      d.className = 'card-perm' + (x.status !== 'open' ? ' done' : '');
      const inputStr = x.tool === 'Bash' ? (x.input && x.input.command) : JSON.stringify(x.input || {}, null, 1);
      d.innerHTML = `<div class="h">Claude 想${x.tool === 'Bash' ? '运行命令' : x.tool === 'Write' || x.tool === 'Edit' ? '改文件' : '用 ' + esc(x.tool)}<small>${esc(x.desc || '')}</small></div><pre>${esc(String(inputStr || '').slice(0, 800))}</pre>`
        + (x.status === 'open' ? `<div class="acts"><button class="btn pri sm" data-p="allow">允许</button><button class="btn sm" data-p="deny">拒绝</button><button class="btn sm" data-p="all">本次任务全部放行</button></div>` : `<small class="muted">${x.status === 'allow' ? '已允许' : x.status === 'deny' ? '已拒绝' : x.status === 'all' ? '已放行本次任务全部操作' : '已关闭'}</small>`);
      $$('button[data-p]', d).forEach(b => b.onclick = () => respondPerm(x, b.dataset.p));
      break;
    }
    case 'result': d.className = 'row-result'; d.textContent = x.ok ? `完成 · ${x.turns || 0}轮 · ${Math.round((x.ms || 0) / 1000)}秒` : (x.stopped ? `已停止 · ${Math.round((x.ms || 0) / 1000)}秒。接着说就会继续。` : `这一轮没有正常结束${x.err ? '：' + friendlyErr(x.err) : ''}${x.why ? '（' + x.why + '）' : ''}。会话还在，接着说就能继续。`); break;
    case 'sys': d.className = 'row-sys'; d.textContent = x.text; break;
    case 'err': d.className = 'row-err'; d.textContent = x.text; break;
  }
  return d;
}
async function respondPerm(x, how) {
  if (!S.project) return;
  const behavior = how === 'deny' ? 'deny' : 'allow';
  await uw.respondPermission({ id: S.project.id, requestId: x.requestId, behavior, remember: how === 'all' ? 'session' : null, message: '用户在UW里拒绝了这一步，请换一种不需要它的做法或说明为什么必须要。' });
  x.status = how; renderLog();
}
/* 右侧活动条：Claude 在跑的时候，内容区不能一动不动 */
/* 活动记录挂在每个项目自己的 log 上（以前是全局一份，两个项目同时在跑会串） */
function setAct(text) {
  const L = log();
  const el = $('#stageAct'); if (!el) return;
  if (!L || !L.busy) { el.hidden = true; if (L) L.act = null; renderLive(); return; }
  if (!L.act) L.act = { since: L.startedAt || Date.now(), steps: 0, list: [] };
  if (!L.act.list) L.act.list = [];   // 兜一手：两处初始化的形状必须一致，缺一个字段整块直播就哑了
  const A = L.act;
  if (text && text !== A.text) {
    /* 工具先报名字（"正在跑命令"）、紧接着才带上说明（"正在跑命令：显示当前工作目录"），
       是同一步的两次播报——后一条覆盖前一条，别在列表里排成两行。 */
    const prev = A.list[A.list.length - 1];
    if (prev && text.startsWith(prev.text)) { prev.text = text; A.text = text; }
    else {
      A.text = text; A.steps++;
      A.list.push({ text, at: Date.now() });
      if (A.list.length > 40) A.list.shift();
    }
  }
  /* 直播区正在演的时候，顶部这条说的是同一句话——收起来，别重复 */
  const liveOn = S.tab === 'preview' && !$('#stagePreview').hidden && !$('#previewEmpty').hidden;
  el.hidden = liveOn;
  $('#stageActText').textContent = A.text || '正在开始…';
  $('#stageActMeta').textContent = `第${A.steps}步 · ${fmtDur(Date.now() - A.since)}`;
  renderLive();
}
/* 每一类活配一句人话短评，跟表情一起换 —— 等待的时候有点戏看 */
function actQuip(t) {
  t = String(t || '');
  const pick = a => a[Math.floor(Date.now() / 4000) % a.length];
  if (/等你点/.test(t)) return '举手等你点一下允许';
  if (/理解/.test(t)) return pick(['先把需求嚼碎', '看看你到底要什么']);
  if (/想怎么做/.test(t)) return pick(['在脑子里先排一版', '琢磨先搭哪一块', '想想飞鹊里有没有现成的']);
  if (/后台任务/.test(t)) return '后台那活干完了，接着搭';
  if (/读文件|找文件|搜内容/.test(t)) return pick(['翻飞鹊的组件清册', '查查知识库怎么说', '找找有没有现成的砖']);
  if (/写文件/.test(t)) return pick(['一行行码出来', '正在往页面里砌砖']);
  if (/改文件/.test(t)) return pick(['挑了个刺，补一下', '这块重新对齐']);
  if (/跑命令/.test(t)) return pick(['敲了几条命令', '让电脑干点体力活']);
  if (/截图/.test(t)) return pick(['拍张照自己挑刺', '退后两步看看像不像']);
  if (/打开网页|读网页|网页结构/.test(t)) return pick(['去线上看看真页面长啥样', '拿参照物']);
  if (/Figma|飞鹊/.test(t)) return pick(['在Figma里翻组件', '对着飞鹊的真值抄']);
  if (/写给你的说明/.test(t)) return '收尾，写几句给你看';
  if (/子任务/.test(t)) return '派了个帮手';
  return pick(['埋头干活中', '别急，在搭']);
}
/* 后台在干哪一类活，就换哪个表情——比一行字更快被看见 */
function actEmoji(t) {
  t = String(t || '');
  if (/等你点/.test(t)) return '🙋';
  if (/理解/.test(t)) return '👀';
  if (/想怎么做/.test(t)) return '💭';
  if (/读文件/.test(t)) return '📖';
  if (/写文件/.test(t)) return '✍️';
  if (/改文件/.test(t)) return '🔧';
  if (/跑命令/.test(t)) return '⚙️';
  if (/找文件|搜内容/.test(t)) return '🔍';
  if (/读网页|搜网上|打开网页|网页结构|操作网页|跑脚本|等网页/.test(t)) return '🌐';
  if (/截图/.test(t)) return '📸';
  if (/Figma|飞鹊/.test(t)) return '🎨';
  if (/技能|找工具/.test(t)) return '🧰';
  if (/后台任务/.test(t)) return '🔁';
  if (/写给你的说明/.test(t)) return '💬';
  if (/子任务/.test(t)) return '🧩';
  if (/理清步骤/.test(t)) return '🗂️';
  return '🛠️';
}
function fmtDur(ms) { const s = Math.round(ms / 1000); return s >= 60 ? Math.floor(s / 60) + '分' + (s % 60) + '秒' : s + '秒'; }
/* 还没出稿时，预览区那块大空白拿来播后台动作 */
function renderLive() {
  const wrap = $('#previewEmpty'); if (!wrap || wrap.hidden) return;
  const L = log(), on = !!(L && L.busy && L.act);
  $('#emptyIdle').hidden = on; $('#emptyLive').hidden = !on;
  if (!on) return;
  const A = L.act;
  const em = actEmoji(A.text), box = $('#liveEmoji');
  if (box.textContent !== em) {
    box.textContent = em;
    box.classList.remove('pop'); void box.offsetWidth; box.classList.add('pop');
    setTimeout(() => box.classList.remove('pop'), 460);
  }
  /* 小页面一块块亮起来：第几步就搭到第几块；搭满了进入「打磨」态（整页扫一遍光） */
  const page = $('#livePage'), blocks = $$('#livePage .lb');
  const n = Math.min(blocks.length, Math.max(1, A.steps));
  page.dataset.n = String(n);
  page.classList.toggle('done', A.steps > blocks.length);
  blocks.forEach((b, i) => { b.classList.toggle('on', i < n - 1 || A.steps > blocks.length); b.classList.toggle('now', i === n - 1 && A.steps <= blocks.length); });
  /* 小工人站到正在搭的那块上 */
  const cur = blocks[A.steps > blocks.length ? (Math.floor(Date.now() / 1600) % blocks.length) : n - 1];
  if (cur) { const pr = page.getBoundingClientRect(), br = cur.getBoundingClientRect(); box.style.left = (br.left - pr.left + br.width / 2) + 'px'; box.style.top = (br.top - pr.top) + 'px'; }
  $('#liveQuip').textContent = actQuip(A.text);
  $('#liveTime').textContent = `已用${fmtDur(Date.now() - A.since)}`;
  const list = A.list.slice(-9);
  $('#liveList').innerHTML = list.map((x, i) => {
    const now = i === list.length - 1;
    const next = list[i + 1];
    const ms = (next ? next.at : Date.now()) - x.at;
    const dur = now || ms < 1000 ? '' : fmtDur(ms);
    return `<li class="${now ? 'now' : ''}"><span class="s">${now ? '▸' : '✓'}</span><span class="x">${esc(x.text)}</span><span class="d">${dur}</span></li>`;
  }).join('');
}

function updateStatus() {
  { const L = log(); const h = $('#chatHandle'); if (h) { h.classList.toggle('busy', !!(L && L.busy)); if (canvasOnly() && L && !L.busy && h.dataset.wasBusy === '1') h.classList.add('unread'); h.dataset.wasBusy = L && L.busy ? '1' : '0'; } }
  const L = log(); const st = $('#chatStatus');
  const cp = $('#composer');
  if (!L || !L.busy) { st.hidden = true; if (S.timer) { clearInterval(S.timer); S.timer = null; } $('#btnSend').disabled = false; $('#stageAct').hidden = true; if (L) L.act = null; if (cp) cp.placeholder = cp.dataset.idle || cp.placeholder; renderLive(); return; }
  st.hidden = false; $('#btnSend').disabled = false;   // 跑着的时候照样能发（补充/纠方向），不灰
  if (cp) { if (!cp.dataset.idle) cp.dataset.idle = cp.placeholder; cp.placeholder = '它在跑，你照样能说：补一句要求、纠个方向…'; }
  const tick = () => {
    const s = Math.round((Date.now() - (L.startedAt || Date.now())) / 1000);
    const t = s >= 60 ? Math.floor(s / 60) + ' 分 ' + (s % 60) + ' 秒' : s + ' 秒';
    /* 卡在权限卡上跟真在干活，界面以前长得一模一样（都是灰输入框 + 「执行中」），
       用户会以为应用死了、发不出消息。这里点破它。 */
    const pend = L.items.filter(x => x.k === 'perm' && x.status === 'open').pop();
    $('#statusText').textContent = pend
      ? `在等你确认「${pend.tool || '这一步'}」 · 已等 ${t}`
      : `执行中${t}`;
    st.classList.toggle('waiting', !!pend);
    setAct(null);
  };
  tick(); if (!S.timer) S.timer = setInterval(tick, 1000);
}

/* 极简 markdown：段落、标题、列表、粗体、行内码、代码块 */
function md(src) {
  const lines = String(src || '').split('\n'); let out = '', inCode = false, list = null, para = [];
  const flushP = () => { if (para.length) { out += '<p>' + inline(para.join(' ')) + '</p>'; para = []; } };
  const flushL = () => { if (list) { out += `</${list}>`; list = null; } };
  for (const raw of lines) {
    if (raw.startsWith('```')) { flushP(); flushL(); if (inCode) { out += '</code></pre>'; inCode = false; } else { out += '<pre><code>'; inCode = true; } continue; }
    if (inCode) { out += esc(raw) + '\n'; continue; }
    const h = raw.match(/^(#{1,3})\s+(.*)/); const li = raw.match(/^\s*[-*•]\s+(.*)/); const ol = raw.match(/^\s*\d+[.、]\s+(.*)/);
    if (/^\s*\|.*\|\s*$/.test(raw)) {   // 表格：连续的 | 行；分隔行跳过
      flushP(); flushL();
      if (/^\s*\|?\s*:?-{2,}/.test(raw.replace(/\|/g, ''))) continue;
      const cells = raw.trim().replace(/^\||\|$/g, '').split('|').map(c => inline(c.trim()));
      if (!out.endsWith('</tr>')) { out += '<table><tr>' + cells.map(c => `<th>${c}</th>`).join('') + '</tr>'; }
      else out += '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>';
      continue;
    } else if (out.endsWith('</tr>')) out += '</table>';
    if (h) { flushP(); flushL(); out += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; }
    else if (li || ol) { flushP(); const kind = li ? 'ul' : 'ol'; if (list !== kind) { flushL(); out += `<${kind}>`; list = kind; } out += `<li>${inline((li || ol)[1])}</li>`; }
    else if (!raw.trim()) { flushP(); flushL(); }
    else { flushL(); para.push(raw); }
  }
  flushP(); flushL(); if (inCode) out += '</code></pre>'; if (out.endsWith('</tr>')) out += '</table>';
  return out;
}
function inline(s) { return esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>'); }

/* ── 加能力（工作区里的下拉） ─────────────────────── */
$('#btnAbility').onclick = e => { e.stopPropagation(); const m = $('#abilityMenu'); if (!m.hidden) { m.hidden = true; return; } m.innerHTML = ''; for (const a of S.caps.abilities) { const b = document.createElement('button'); b.innerHTML = `<b>${esc(a.title)}</b><small>${esc(a.desc)}</small>`; b.onclick = () => { m.hidden = true; askAbility(a); }; m.appendChild(b); } m.hidden = false; };
document.addEventListener('click', () => { $$('.menu').forEach(m => m.hidden = true); });
/* 菜单弹出方向：下方放不下就往上弹 */
new MutationObserver(muts => { for (const mu of muts) { const m = mu.target; if (m.classList.contains('menu') && !m.hidden) { m.classList.remove('up'); const r = m.getBoundingClientRect(); if (r.bottom > window.innerHeight - 12 && r.top > r.height + 60) m.classList.add('up'); } } })
  .observe(document.body, { attributes: true, subtree: true, attributeFilter: ['hidden'] });
function askAbility(a) {
  const t = $('#composer');
  const seed = a.kind === 'grill' ? '（把要拷问的方案写在这里，或直接写「就拷问这个项目现在的方案」）' : a.kind === 'doc' && a.id === 'handoff-note' ? '' : '（对象是这个项目当前的产物，可补充要求）';
  const input = seed ? '' : '';
  const shown = '对象：这个项目目录里现在的产物和对话。';
  const text = fill(a.prompt, { input: input || '就以这个项目目录里现在的产物和对话为对象。', project: S.project.name });
  send(text, a.title, shown);
}

/* ── 发给前端 ─────────────────────────────────────── */
$('#btnHandoff').onclick = () => {
  if (!S.project) return;
  const hasNote = (S.project.files || []).some(f => f.rel === '交付说明.md');
  const body = $('#handoffBody'), foot = $('#handoffFoot');
  body.innerHTML = `<div class="kv"><span>项目</span><b>${esc(S.project.name)}</b><span>文件</span><div>${(S.project.files || []).length}个${hasNote ? '，含交付说明.md' : ''}</div><span>交付仓库</span><code>${esc(S.settings.handoffRepoDir)}</code></div>`
    + (hasNote ? '' : `<div class="warn">项目里还没有「交付说明.md」。前端拿到只有稿子，会来回问。建议先让Claude整理一份再发（约一两分钟）。</div>`);
  foot.innerHTML = `<button class="btn" data-close>取消</button>${hasNote ? '' : '<button class="btn" id="hoNote">先整理交付说明</button>'}<button class="btn pri" id="hoGo">${hasNote ? '打包并发出' : '直接打包发出'}</button>`;
  $$('[data-close]', foot).forEach(b => b.onclick = () => hide('#modalHandoff'));
  const n = $('#hoNote'); if (n) n.onclick = () => { hide('#modalHandoff'); askAbility(S.caps.abilities.find(a => a.id === 'handoff-note')); };
  $('#hoGo').onclick = doHandoff;
  show('#modalHandoff');
};
async function doHandoff() {
  const body = $('#handoffBody'), foot = $('#handoffFoot');
  body.innerHTML = '<div class="row-think"><span class="spin"></span>正在复制产物、打包、提交到交付仓库…</div>'; foot.innerHTML = '';
  try {
    const r = await uw.buildHandoff({ id: S.project.id });
    body.innerHTML = `<div class="kv">
      <span>交付包</span><code>${esc(r.dest)}</code>
      ${r.zip ? `<span>压缩包</span><code>${esc(r.zip)}</code>` : ''}
      ${r.branch ? `<span>分支</span><code>${esc(r.branch)}${r.commit ? ' @ ' + esc(r.commit) : ''}</code>` : ''}
      ${r.mrUrl ? `<span>合并请求</span><a href="#" id="hoMr">${esc(r.mrUrl)}</a>` : ''}
      <span>文件</span><div>${r.files}个${r.note ? '，含交付说明' : ''}</div>
    </div>
    ${r.warnings.map(w => `<div class="warn">${esc(w)}</div>`).join('')}
    <div class="f"><span>给前端的话（已复制到剪贴板，直接粘到飞书）</span><div class="note">${esc(r.message)}</div></div>`;
    foot.innerHTML = `<button class="btn" id="hoReveal">在Finder中显示</button><button class="btn" id="hoCopy">再复制一次</button><button class="btn pri" data-close>完成</button>`;
    $('#hoReveal').onclick = () => uw.reveal(r.zip || r.dest);
    $('#hoCopy').onclick = () => { uw.copy(r.message); toast('已复制'); };
    const mr = $('#hoMr'); if (mr) mr.onclick = e => { e.preventDefault(); uw.openExternal(r.mrUrl); };
    $$('[data-close]', foot).forEach(b => b.onclick = () => hide('#modalHandoff'));
    toast('交付包已生成，「给前端的话」在剪贴板里');
    const L = log(); L.items.push({ k: 'sys', text: `已发给前端：${r.branch || r.dest}${r.mrUrl ? '（合并请求链接已在剪贴板）' : ''}` }); renderLog();
  } catch (e) {
    body.innerHTML = `<div class="row-err">${esc(e.message || String(e))}</div>`;
    foot.innerHTML = `<button class="btn" data-close>关闭</button>`;
    $$('[data-close]', foot).forEach(b => b.onclick = () => hide('#modalHandoff'));
  }
}

/* ── 设置 ─────────────────────────────────────────── */
/* ── 更新日志 ──────────────────────────────
   吉吉 2026-09-18：「设置旁边我觉得可以加个版本更新日志」。
   🔴 日志的内容就是**发版时写给同事看的那段说明**，直接从 GitHub 的 release 取。
      另写一份 CHANGELOG 等于两个维护源，迟早对不上 —— 而且对不上的时候没人看得出来。 */
$('#btnChangelog').onclick = openChangelog;
$('#clogClose').onclick = () => hide('#modalChangelog');
async function openChangelog() {
  show('#modalChangelog');
  $('#clogBody').innerHTML = '<div class="clog-empty">正在取…</div>';
  if (!uw.updateLog) { $('#clogBody').innerHTML = '<div class="clog-empty">这一版还没有这个功能，更新之后就有了。</div>'; return; }
  const r = await uw.updateLog();
  if (!r.ok) {
    /* 🔴 取不到就说人话 + 给一条自己能走的路，别只丢一句「失败」。
       连不上多半是网络（公司网络掐 GitHub 是常事），不是应用坏了。 */
    $('#clogBody').innerHTML = `<div class="clog-empty">取不到更新日志（${esc(r.error || '连不上')}）。<br>
      多半是这会儿连不上 GitHub。你现在用的是 <b>v${esc(r.current || '')}</b>，<br>
      也可以直接去看：<a href="#" id="clogOpen">发布页</a>。</div>`;
    const a = $('#clogOpen'); if (a) a.onclick = e => { e.preventDefault(); uw.openExternal && uw.openExternal('https://github.com/MIC-ued-cloud-design/ued-workbuddy/releases'); };
    return;
  }
  if (!r.list.length) { $('#clogBody').innerHTML = '<div class="clog-empty">还没有发布过版本。</div>'; return; }
  $('#clogBody').innerHTML = r.list.map(v => `<div class="clog-v">
    <div class="clog-h"><span class="v">v${esc(v.version)}</span>
      <span class="d">${esc(v.at ? new Date(v.at).toLocaleDateString('zh-CN') : '')}</span>
      ${v.current ? '<span class="now">当前</span>' : ''}</div>
    <div class="clog-n">${esc(v.notes || '（这一版没写说明）')}</div>
  </div>`).join('');
}

$('#btnSettings').onclick = openSettings; $('#enginePill').onclick = openSettings;
function openSettings() {
  renderEngineBox();
  $$('#permRadios input').forEach(r => r.checked = r.value === S.settings.permissionMode);
  const known = Array.from($('#setModel').options).map(o => o.value);
  const mv = S.settings.model || '';
  if (known.includes(mv)) { $('#setModel').value = mv; $('#setModelCustom').hidden = true; } else { $('#setModel').value = '__custom'; $('#setModelCustom').hidden = false; $('#setModelCustom').value = mv; }
  $('#setWorkspace').value = S.settings.workspaceDir; $('#setRepo').value = S.settings.handoffRepoDir; $('#setFrontend').value = S.settings.frontendName || '';
  show('#modalSettings');
}
/* 找不到引擎时，同事截图往往看不出所以然。把机器这边知道的都摊开，一键复制发回来。 */
function engineDiag() {
  const e = S.engine || {}, d = e.shellEnv || {};
  return [
    `UED WorkBuddy ${(S.boot && S.boot.version) || ''} · 引擎诊断`,
    `结果：${e.ok ? '找到 ' + e.path + '（' + e.version + '）' : '没找到'}`,
    `登录shell：${d.shell || '未知'} · 读PATH${d.gotLoginPath ? '成功（' + d.source + '，' + d.ms + 'ms）' : '失败，只用了兜底目录'}`,
    `应用自身PATH：${d.guiMinimalPath ? '访达启动的最小集（正常，已用登录shell补齐）' : '已继承完整PATH'}`,
    `合并后共${d.pathDirs || 0}个目录`,
    '找过这些位置：',
    ...(e.tried || []).map(t => (typeof t === 'string' ? '  · ' + t : `  · ${t.path} —— ${t.why}`)),
    d.path ? 'PATH=' + d.path : '',
  ].filter(Boolean).join('\n');
}

/* 这一轮实际跑在哪个模型上——「跟随默认」拿到的未必是你在终端 /model 选的那个，所以要显式摆出来 */
function renderRunModel() {
  const el = $('#runModel'); if (!el) return;
  const m = S.runModel;
  el.hidden = !m;
  if (m) { el.textContent = String(m).replace('claude-', '').replace('-20251001', ''); el.title = '这一轮实际用的模型：' + m; }
}

function renderEngineBox() {
  const b = $('#engineBox');
  const manual = `<div class="muted">装好了还是找不到，就把claude的位置直接指给它（终端里敲 <code>which claude</code> 看得到）：</div>
    <div class="f-row"><input id="engPath" placeholder="/Users/你/.fcf/bin/claude" value="${esc((S.settings && S.settings.claudePath) || '')}"><button class="btn sm" id="btnPickClaude">浏览…</button></div>`;
  const foot = `<div class="f-row"><button class="btn sm" id="btnRedetect">重新检测</button><button class="btn sm" id="btnCopyDiag">复制诊断信息</button></div>`;
  if (S.engine && S.engine.ok) {
    b.innerHTML = `<div><b>已找到 Claude Code ${esc(S.engine.version.split(' ')[0])}</b>${S.engine.viaFcf ? '，走公司FCF启动器（代理与上报跟终端一致）' : ''}</div><code>${esc(S.engine.path)}</code><div class="muted">技能、MCP、钩子、记忆都是这台电脑上Claude Code自己的配置，UED WorkBuddy不另加锁。</div>${foot}`;
  } else {
    b.innerHTML = `<div><b>没找到Claude Code</b></div><div class="muted">${esc((S.engine && S.engine.message) || '')}</div><div class="muted">先在终端里装好并登录：<code>npm i -g @anthropic-ai/claude-code</code>，然后敲一次 <code>claude</code> 完成登录。</div>${manual}${foot}`;
  }
  const pick = $('#btnPickClaude');
  if (pick) pick.onclick = async () => { const p = await uw.pickAny('选择claude可执行文件'); if (p) $('#engPath').value = p; };
  $('#btnCopyDiag').onclick = () => { uw.copy(engineDiag()); toast('诊断信息已复制，直接发给吉吉就行。'); };
  $('#btnRedetect').onclick = async () => {
    const ip = $('#engPath');
    if (ip && ip.value.trim() !== ((S.settings && S.settings.claudePath) || '')) S.settings = await uw.saveSettings({ claudePath: ip.value.trim() });
    S.engine = await uw.detectEngine(); renderEngine(); renderEngineBox();
  };
}
$('#setModel').onchange = e => { $('#setModelCustom').hidden = e.target.value !== '__custom'; if (e.target.value === '__custom') $('#setModelCustom').focus(); };
$$('[data-pick]').forEach(b => b.onclick = async () => { const p = await uw.pickDir('选择文件夹'); if (p) $('#' + b.dataset.pick).value = p; });
$('#btnSaveSettings').onclick = async () => {
  const perm = ($('#permRadios input:checked') || {}).value || 'acceptEdits';
  const modelSel = $('#setModel').value; const model = modelSel === '__custom' ? $('#setModelCustom').value.trim() : modelSel;
  S.settings = await uw.saveSettings({ permissionMode: perm, model, workspaceDir: $('#setWorkspace').value, handoffRepoDir: $('#setRepo').value, frontendName: $('#setFrontend').value.trim() });
  for (const L of S.logs.values()) L.busy = false;
  hide('#modalSettings'); toast('已保存。正在跑的会话已停，下一条消息会按新设置重新接上。');
  uw.listProjects().then(renderProjects); updateStatus();
};


/* ── 自绘下拉：把 select.sel 藏起来，用按钮 + 菜单代替；select 仍是数据源（value / change 不变） ── */
function enhanceSelect(sel) {
  if (sel._dd) return sel._dd;
  const wrap = document.createElement('div'); wrap.className = 'dd' + (sel.classList.contains('wide') ? ' wide' : '');
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'dd-btn'; btn.innerHTML = '<span class="lb"></span><i class="cv"></i>';
  const menu = document.createElement('div'); menu.className = 'dd-menu'; menu.hidden = true;
  sel.parentNode.insertBefore(wrap, sel); wrap.appendChild(sel); wrap.appendChild(btn); wrap.appendChild(menu);
  sel.style.display = 'none';
  const label = () => { const o = sel.options[sel.selectedIndex]; btn.querySelector('.lb').textContent = o ? o.textContent : '—'; btn.disabled = !sel.options.length; };
  const build = () => {
    menu.innerHTML = '';
    Array.from(sel.options).forEach((o, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = i === sel.selectedIndex ? 'on' : '';
      b.innerHTML = '<span class="ck"></span><span>' + esc(o.textContent) + '</span>';
      b.onclick = e => { e.stopPropagation(); sel.selectedIndex = i; sel.dispatchEvent(new Event('change', { bubbles: true })); label(); menu.hidden = true; };
      menu.appendChild(b);
    });
  };
  btn.onclick = e => {
    e.stopPropagation();
    $$('.dd-menu').forEach(m => { if (m !== menu) m.hidden = true; });
    if (!menu.hidden) { menu.hidden = true; return; }
    build();
    const r = btn.getBoundingClientRect(); menu.classList.toggle('up', window.innerHeight - r.bottom < 240);
    menu.hidden = false;
  };
  new MutationObserver(label).observe(sel, { childList: true, attributes: true, attributeFilter: ['value'] });
  sel.addEventListener('change', label);
  const _desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(sel, 'value', { get() { return _desc.get.call(this); }, set(v) { _desc.set.call(this, v); label(); } });
  label();
  sel._dd = { wrap, btn, menu, label };
  return sel._dd;
}
document.addEventListener('click', () => $$('.dd-menu').forEach(m => m.hidden = true));
$$('select.sel').forEach(enhanceSelect);


/* ── 选项式向导：线上 UW 那套四步问卡 + 任务单 + 知识库检索，原样搬进来 ── */
const W = { open: false, key: null, card: null, group: null, role: null, step: 0, ans: {}, rows: [], hits: [], state: 'idle', tok: 0, extra: '' };
const CK = '<svg viewBox="0 0 16 16" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.2 3L13 4.5"/></svg>';
function wizKeyFor(role, card) {
  /* 分组角色（设计）：键 = 分组id/序号。2026-09-16 补：产品/前端这两个角色用的是 role.scenes、
     没有 groups，原来第一行直接 return null —— 等于它们永远拿不到向导，写了也不触发。
     改成回落到 role.id/序号，数据结构和界面都不用动。 */
  if (role.groups) {
    for (const g of role.groups) { const i = g.cards.findIndex(c => c.id === card.id); if (i >= 0) return { key: g.id + '/' + i, group: g }; }
    return null;
  }
  const i = (role.scenes || []).findIndex(c => c.id === card.id);
  if (i >= 0) return { key: role.id + '/' + i, group: { id: role.id, name: role.name } };
  return null;
}
function wizDef() { return S.boot.wizards[W.key]; }
function wizAllQs() { return wizDef().steps.reduce((a, st) => a.concat(st.qs), []); }
function wizFilled(q) { const v = W.ans[q.k]; return Array.isArray(v) ? v.length > 0 : !!(v && String(v).trim()); }
function wizOpen(role, card) {
  const k = wizKeyFor(role, card); if (!k || !S.boot.wizards[k.key]) return false;
  Object.assign(W, { open: true, key: k.key, card, group: k.group, role, step: 0, ans: {}, rows: [], hits: [], state: 'idle', extra: $('#homeInput').value.trim() });
  W.tok++;
  $('#wizCat').textContent = k.group.name; $('#wizTitle').textContent = card.title;
  show('#wiz'); wizDraw(); wizAuto();
  return true;
}
function wizClose() { W.open = false; W.tok++; hide('#wiz'); }
$('#wizClose').onclick = wizClose;
$('#wizSkip').onclick = () => { wizClose(); $('#homeInput').focus(); };
$('#wizPrev').onclick = () => { if (W.step > 0) { W.step--; wizDraw(); } };
$('#wizNext').onclick = () => { const d = wizDef(); if (W.step < d.steps.length - 1) { W.step++; wizDraw(); } else wizAsk(); };
function wizDraw() {
  const d = wizDef(); const st = d.steps[W.step];
  // 左栏：步骤 + 每步已定的答案
  $('#wizRail').innerHTML = d.steps.map((x, i) => {
    const got = x.qs.filter(wizFilled).map(q => { let v = W.ans[q.k]; if (Array.isArray(v)) v = v.join('、'); return esc(String(v).slice(0, 40)); });
    return `<button class="wiz-step${i === W.step ? ' on' : ''}${got.length && i !== W.step ? ' done' : ''}" data-i="${i}"><span class="no">${i + 1}</span><span><span class="lb">${esc(x.t)}</span>${got.length ? `<span class="got">${got.join(' · ')}</span>` : ''}</span></button>`;
  }).join('');
  $$('#wizRail .wiz-step').forEach(b => b.onclick = () => { W.step = +b.dataset.i; wizDraw(); });
  // 中栏：第一步带检索面板；每步一张问题卡
  const main = $('#wizMain'); main.innerHTML = '';
  if (W.step === 0) main.appendChild(wizAutoNode());
  const card = document.createElement('div'); card.className = 'wiz-card';
  card.innerHTML = `<div class="wiz-stepno">第 ${W.step + 1}步 / 共 ${d.steps.length}步</div><div class="wiz-title2">${esc(st.t)}</div><div class="wiz-h2">${esc(st.h || '')}</div>` + st.qs.map((q, i) => wizQ(q, i)).join('')
    + (W.step === d.steps.length - 1 ? `<div class="wiz-item wiz-extra"><div class="wiz-lbl"><span class="no">补充</span><span>需求原文、链接、要附上的文件路径（可选）</span></div><textarea rows="3" id="wizExtra" placeholder="把PRD片段、参考链接、Figma节点、要改的点贴进来">${esc(W.extra)}</textarea></div>` : '');
  main.appendChild(card);
  const ex = $('#wizExtra'); if (ex) ex.oninput = () => { W.extra = ex.value; };
  $$('.wiz-opt', card).forEach(el => el.onclick = () => wizPick(el.dataset.k, el.dataset.multi === '1', el.dataset.v));
  $$('input[data-k],textarea[data-k]', card).forEach(el => el.oninput = () => { W.ans[el.dataset.k] = el.value; wizSide(); wizRailOnly(); });
  wizSide();
  $('#wizPrev').disabled = W.step === 0;
  $('#wizNext').textContent = W.step === d.steps.length - 1 ? '让Claude开始' : '下一步';
}
function wizRailOnly() { const d = wizDef(); $$('#wizRail .wiz-step').forEach((b, i) => { const got = d.steps[i].qs.filter(wizFilled).map(q => { let v = W.ans[q.k]; if (Array.isArray(v)) v = v.join('、'); return esc(String(v).slice(0, 40)); }); const g = b.querySelector('.got'); if (got.length) { if (g) g.innerHTML = got.join(' · '); else b.lastElementChild.insertAdjacentHTML('beforeend', `<span class="got">${got.join(' · ')}</span>`); } else if (g) g.remove(); }); }
function wizQ(q, i) {
  const v = W.ans[q.k]; let body = '';
  if (q.type === 'text') body = `<input type="text" data-k="${esc(q.k)}" value="${esc(v || '')}" placeholder="${esc(q.ph || '')}">`;
  else if (q.type === 'area') body = `<textarea rows="3" data-k="${esc(q.k)}" placeholder="${esc(q.ph || '')}">${esc(v || '')}</textarea>`;
  else {
    const multi = q.type === 'check';
    body = `<div class="wiz-opts">${q.opts.map(o => { const on = multi ? (v || []).includes(o[0]) : v === o[0];
      return `<button type="button" class="wiz-opt${multi ? '' : ' rd'}${on ? ' on' : ''}" data-k="${esc(q.k)}" data-multi="${multi ? 1 : 0}" data-v="${esc(o[0])}"><span class="bx">${multi ? CK : ''}</span><span class="ot">${esc(o[0])}${o[1] ? `<span class="od">${esc(o[1])}</span>` : ''}</span></button>`; }).join('')}</div>`;
  }
  return `<div class="wiz-item"><div class="wiz-lbl"><span class="no">${i + 1}.</span><span>${esc(q.q)}</span></div>${q.hint ? `<div class="wiz-hint">${esc(q.hint)}</div>` : ''}${body}</div>`;
}
function wizPick(k, multi, v) {
  if (multi) { const cur = Array.isArray(W.ans[k]) ? W.ans[k].slice() : []; const i = cur.indexOf(v); if (i >= 0) cur.splice(i, 1); else cur.push(v); W.ans[k] = cur; }
  else W.ans[k] = W.ans[k] === v ? '' : v;
  // 只重画这一题的选项，不动输入框焦点
  $$(`.wiz-opt[data-k="${k}"]`).forEach(el => { const on = multi ? (W.ans[k] || []).includes(el.dataset.v) : W.ans[k] === el.dataset.v; el.classList.toggle('on', on); });
  wizSide(); wizRailOnly();
}
function wizSide() {
  const d = wizDef(), all = wizAllQs(), f = all.filter(wizFilled), b = all.filter(q => !wizFilled(q));
  const pct = all.length ? Math.round(f.length / all.length * 100) : 0;
  $('#wizSide').innerHTML = `<div class="rt">任务单</div><div class="rs">${esc(W.group.name)} / ${esc(W.card.title)}</div>
    <div class="bar"><i><b style="width:${pct}%"></b></i>确定 <span class="n">${f.length} / ${all.length}</span></div>
    <div class="dv">这一单会交出</div><ul class="out">${d.out.map(o => `<li>${esc(o)}</li>`).join('')}</ul>
    <div class="dv">确定</div>${f.length ? `<ul>${f.map(q => { let v = W.ans[q.k]; if (Array.isArray(v)) v = v.join('、'); return `<li><span class="mk">✓</span><span>${esc(q.q)}<span class="vl">${esc(v)}</span></span></li>`; }).join('')}</ul>` : '<div class="empty2">尚未确定任何一项。左侧填写后，此处同步生成。</div>'}
    ${b.length ? `<div class="dv">待定</div><ul>${b.map(q => `<li class="off"><span class="mk">○</span><span>${esc(q.q)}</span></li>`).join('')}</ul>` : ''}
    <div class="dv">调用的能力</div><ul class="kit">${(d.skills || []).map(k => `<li><span class="sn">${esc(k[0])}</span>${k[1] ? `<small>${esc(k[1])}</small>` : ''}</li>`).join('')}</ul>`;
  $('#wizProg').textContent = `确定${f.length} / ${all.length}`;
}
/* 知识库：随应用带的 kb.js（7.6MB），第一次用到才加载 */
let kbP = null;
function wizLoadKB() {
  if (kbP) return kbP;
  kbP = new Promise((res, rej) => {
    if (window.WBKB && window.WBSearch) return res(true);
    const one = src => new Promise((ok, no) => { const el = document.createElement('script'); el.src = src; el.onload = ok; el.onerror = () => no(new Error('找不到 ' + src)); document.head.appendChild(el); });
    one('../packs/kb/kb-search.js').then(() => one('../packs/kb/kb.js')).then(() => (window.WBKB && window.WBSearch) ? res(true) : rej(new Error('kb.js加载了但没挂上'))).catch(rej);
  });
  return kbP;
}
function wizAutoNode() {
  const box = document.createElement('div'); box.className = 'wiz-card wiz-auto'; box.id = 'wizAuto';
  wizAutoPaint(box); return box;
}
function wizAutoPaint(box) {
  box = box || $('#wizAuto'); if (!box) return;
  const running = W.state === 'running';
  box.innerHTML = `<div class="ah">${running ? '<span class="spin"></span>正在检索知识库' : (W.state === 'done' ? '知识库检索完成' : '知识库检索')}<span class="tag">实时检索</span><span class="cnt">${W.rows.length}项</span></div>`
    + W.rows.map(r => `<div class="arow"><span class="st ${r.state || (running ? 'run' : '')}"></span><span>${esc(r.label)}${r.detail ? `<span class="dt">${r.detail}</span>` : ''}</span></div>`).join('');
}
async function wizAuto() {
  const tok = W.tok, alive = () => tok === W.tok && W.open;
  const d = wizDef(); W.state = 'running'; W.hits = []; W.rows = (d.auto || []).map(a => ({ label: a.label, state: '', detail: '' })); wizAutoPaint();
  let kbErr = null; try { await wizLoadKB(); } catch (e) { kbErr = e.message || String(e); }
  if (!alive()) return;
  for (let i = 0; i < (d.auto || []).length; i++) {
    const job = d.auto[i]; if (!alive()) return;
    if (kbErr) { W.rows[i].state = 'miss'; W.rows[i].detail = '<b>未执行</b> · ' + esc(kbErr); wizAutoPaint(); continue; }
    let hits = []; try { hits = window.WBSearch.retrieve(window.WBKB, job.q, 2600) || []; } catch (e) { hits = []; }
    if (!alive()) return;
    W.hits = W.hits.concat(hits);
    if (!hits.length) { W.rows[i].state = 'miss'; W.rows[i].detail = '<b>无匹配</b> · 知识库里没有相关段落（关键词：' + esc(job.q) + '）'; }
    else { const docs = []; hits.forEach(h => { if (!docs.includes(h.d)) docs.push(h.d); }); W.rows[i].state = 'ok'; W.rows[i].detail = `检索到${hits.length}段 · ` + docs.slice(0, 4).map(x => `<span class="adoc">${esc(x)}</span>`).join('') + (docs.length > 4 ? `<span class="muted">还有 ${docs.length - 4}份</span>` : ''); }
    wizAutoPaint();
  }
  if (!alive()) return; W.state = 'done'; wizAutoPaint();
}
/* 拼给 Claude 的话：已定 / 待定（待定必须写进去，不让模型拿默认假设补）/ 要交出 / 知识库查到的段落 */
function wizText() {
  const d = wizDef(), all = wizAllQs(), f = all.filter(wizFilled), b = all.filter(q => !wizFilled(q));
  const L = [`我要做「${W.group.name} · ${W.card.title}」。`, ''];
  if (W.extra.trim()) { L.push('需求与输入：', W.extra.trim(), ''); }
  L.push('已经确定的：');
  f.forEach(q => { let v = W.ans[q.k]; if (Array.isArray(v)) v = v.join('、'); L.push(`- ${q.q} ${v}`); });
  if (b.length) { L.push('', `还没定的${b.length}项（不要替我拿默认假设补上，需要问PM或业务的直接标出来）：`); b.forEach(q => L.push('- ' + q.q)); }
  L.push('', '要交出：' + d.out.join('；'));
  if (d.file) L.push('产出对应线上目录约定：' + d.file + '（在本项目里按同名文件落地即可）');
  if (W.hits.length) {
    L.push('', `向导已经在部门知识库里查到下面这些段落（${W.hits.length}段，先读它们再动手；跟你自己知道的冲突时以这些为准并指出冲突）：`);
    let used = 0;
    for (const h of W.hits) { const x = String(h.x || '').trim(); if (!x) continue; if (used + x.length > 9000) break; L.push('', `【${h.d}${h.t ? ' · ' + h.t : ''}】`, x); used += x.length; }
  }
  return L.join('\n');
}
async function wizAsk() {
  const all = wizAllQs(), n = all.filter(wizFilled).length;
  if (!n && !W.extra.trim()) { toast('一项都没填，Claude只能瞎猜。至少选几个，或者写一句需求。'); return; }
  const input = wizText();
  const item = W.card, role = W.role;
  const head = (W.extra.split('\n').find(l => l.trim() && !l.startsWith('附件路径：')) || '').replace(/[，。！？、；：,.!?;:「」“”"'`]+/g, ' ').trim().slice(0, 14).trim();
  const name = head ? `${item.title} · ${head}` : item.title;
  wizClose();
  const p = await uw.createProject({ name, role: role.id, scene: item.id, input });
  $('#homeInput').value = ''; S.scene = null;
  await openProject(p.id);
  send(fill(item.prompt, { input, project: p.name }), item.title, input);
}

/* ── 通用 ─────────────────────────────────────────── */
function show(sel) { $(sel).hidden = false; }
function hide(sel) { $(sel).hidden = true; }
$$('.mask').forEach(m => { m.addEventListener('click', e => { if (e.target === m) m.hidden = true; }); $$('[data-close]', m).forEach(b => b.onclick = () => m.hidden = true); });
/* ── 像 Figma 那样改：编辑层（界面这半） ─────────────────
   预览 iframe 里跑的是 main/edit-probe.js（协议层注入），这里只做三件事：
   ① 工具栏 / 右侧属性面板；② 把面板上的改动实时发给 iframe 并写进文件；③ 撤销重做与「手改记录」。
   改动直接写文件（uw.editApply），不经过 Claude。文件被写之后监听器会想重载预览，
   样式和文字的改动 DOM 里已经是新的了，重载只会闪，所以那类改动之后的重载压掉（ED.suppress）；
   删 / 复制 / 挪位置会让元素编号变，必须重载，重载完再按新编号把选中恢复回来。 */
/* 面板只给飞鹊的值：字号阶梯（禁奇数）、圆角、间距 4 的倍数、色板。来源 packs/feique/tokens.json（数值 SOT），这里是内联镜像。 */
const FQ = {
  fontSize: [12, 14, 16, 18, 20, 22, 24, 32, 36],
  radius: [[0, '0'], [4, '4 · 控件'], [6, '6 · 按钮'], [8, '8 · 容器'], [12, '12'], [16, '16'], [999, '胶囊']],
  text: [['#222222', '正文 / 标题'], ['#555555', '次强调'], ['#888888', '次要'], ['#B3B3B3', '禁用'], ['#FFFFFF', '反白'], ['#E64545', '品牌红'], ['#007DFA', '链接蓝'], ['#00C88C', '成功绿'], ['#FAAA00', '警告黄'], ['#FF5252', '错误红']],
  bg: [['#FFFFFF', '白'], ['#F5F7FA', '浅灰蓝 · background 01'], ['#F0F1F2', '浅灰 · background 02'], ['#F4F4F4', '中性浅底'], ['#FDF1F1', '红浅底'], ['#EBF5FF', '蓝浅底'], ['#EBFBF6', '绿浅底'], ['#FEF6E5', '黄浅底'], ['#FFF2F2', '错误浅底'], ['#E64545', '品牌红'], ['#007DFA', '蓝'], ['#222222', '深']],
  border: [['#DAE0E6', '列表分割线'], ['#CED3D9', '按钮 / 输入框描边'], ['#E6ECF2', '模块边框'], ['#E6E6E6', '模块分割'], ['#E64545', '品牌红'], ['#007DFA', '蓝'], ['#222222', '深']],
};
const FQ_ALL = new Set([...FQ.text, ...FQ.bg, ...FQ.border].map(x => x[0]));
/* ── 选中框画在画布外面 ────────────────────────────
   探针报上来的是「元素在页面视口里的位置」（CSS px），这里换算成画布外面那一层的坐标：
   画布可能被 transform 缩放（自适应档）或 CSS zoom 缩放（定宽档），两种都用同一个办法算倍率 ——
   iframe 在屏幕上的实际宽度 ÷ 它内部的 CSS 宽度。 */
const SEL = { r: null, drag: null };
function previewScale() {
  const fr = curFrame(); if (!fr) return 1;
  const w = fr.getBoundingClientRect().width;
  const css = S.width !== 'auto' ? +S.width : (parseFloat(fr.style.width) || w);
  return css > 0 ? w / css : 1;
}
/* ── 右键「这个位置下面有」菜单（照 Figma 的 Select layer）──
   探针报上来的是 iframe 里的坐标，要按当前缩放换到窗口坐标；菜单 fixed 定位、贴边翻转。
   悬停某一项 → 让探针在页面上预亮那一层（hint）；点 → 选中；点外面 / Esc / 滚动 → 关。 */
function closeStackMenu() { const m = $('#stackMenu'); if (m) { m.remove(); probe({ __uwEditCmd: 'hint', i: null }); } }
function showStackMenu(d) {
  closeStackMenu();
  const fr = curFrame(); if (!fr || !d.list || !d.list.length) return;
  const k = previewScale(), pr = fr.getBoundingClientRect();
  let X = pr.left + d.x * k, Y = pr.top + d.y * k;
  const m = document.createElement('div'); m.id = 'stackMenu'; m.className = 'stack-menu';
  m.innerHTML = `<div class="sm-t">这个位置下面有 <small>上面的盖着下面的</small></div>` +
    d.list.map((it, n) => `<button data-i="${it.i}" class="${it.on ? 'on' : ''}"><i>${n + 1}</i><b>${esc(it.label)}</b>${it.on ? '<small>当前</small>' : ''}</button>`).join('');
  document.body.appendChild(m);
  const r = m.getBoundingClientRect();
  if (X + r.width > innerWidth - 8) X = Math.max(8, innerWidth - r.width - 8);
  if (Y + r.height > innerHeight - 8) Y = Math.max(8, Y - r.height);
  m.style.left = X + 'px'; m.style.top = Y + 'px';
  $$('button[data-i]', m).forEach(b => {
    b.onmouseenter = () => probe({ __uwEditCmd: 'hint', i: +b.dataset.i });
    b.onclick = () => { probe({ __uwEditCmd: 'select', i: +b.dataset.i }); closeStackMenu(); };
  });
  m.onmouseleave = () => probe({ __uwEditCmd: 'hint', i: null });
  const off = ev => { if (ev.type === 'keydown' && ev.key !== 'Escape') return; if (ev.type === 'mousedown' && m.contains(ev.target)) return; closeStackMenu(); window.removeEventListener('mousedown', off, true); window.removeEventListener('keydown', off, true); window.removeEventListener('wheel', off, true); window.removeEventListener('blur', off); };
  setTimeout(() => { window.addEventListener('mousedown', off, true); window.addEventListener('keydown', off, true); window.addEventListener('wheel', off, true); window.addEventListener('blur', off); }, 0);
}
function drawSel() {
  const box = $('#selBox'), wrap = $('#frameWrap'), fr = curFrame();
  if (!box) return;
  const r = SEL.r;
  if (!r || !ED.on || !fr || wrap.hidden) { box.hidden = true; return; }
  const k = previewScale();
  const wr = wrap.getBoundingClientRect(), pr = fr.getBoundingClientRect();
  const x = (pr.left - wr.left) + wrap.scrollLeft + r.l * k;
  const y = (pr.top - wr.top) + wrap.scrollTop + r.t * k;
  const w = r.w * k, h = r.h * k, pad = 2;
  box.hidden = false;
  box.style.left = (x - pad) + 'px'; box.style.top = (y - pad) + 'px';
  box.style.width = (w + pad * 2) + 'px'; box.style.height = (h + pad * 2) + 'px';
  box.style.borderRadius = (r.rad || [0, 0, 0, 0]).map(n => (n ? n * k + pad : 0) + 'px').join(' ');
  box.querySelector('.lab').textContent = r.lab;
  box.classList.toggle('inl', !!r.inl);
  box.classList.toggle('editing', !!r.editing);
  box.classList.toggle('top', y + h > wr.height + wrap.scrollTop - 30);   // 贴着画布底就把尺寸标签翻到上面
}
/* 拉手柄改尺寸：手柄现在在画布外面，鼠标会走出 iframe，所以这一层自己接管整个拖拽，
   期间按屏幕位移 ÷ 缩放倍率换算回页面里的 CSS px，改动仍然走 edStyle（debounce 合并写文件）。 */
$$('#selBox .h[data-dir]').forEach(h => h.addEventListener('mousedown', e => {
  if (!ED.info || !SEL.r) return;
  e.preventDefault(); e.stopPropagation();
  SEL.drag = { dir: h.dataset.dir, x: e.clientX, y: e.clientY, w: SEL.r.w, h: SEL.r.h, k: previewScale() };
}));
window.addEventListener('mousemove', e => {
  const d = SEL.drag; if (!d) return;
  const set = {};
  if (/e/.test(d.dir)) set.width = Math.max(1, Math.round(d.w + (e.clientX - d.x) / d.k)) + 'px';
  if (/s/.test(d.dir)) set.height = Math.max(1, Math.round(d.h + (e.clientY - d.y) / d.k)) + 'px';
  if (set.width) SEL.r = { ...SEL.r, w: parseFloat(set.width), lab: `${parseFloat(set.width)} × ${Math.round(SEL.r.h)}` };
  if (set.height) SEL.r = { ...SEL.r, h: parseFloat(set.height), lab: `${Math.round(SEL.r.w)} × ${parseFloat(set.height)}` };
  drawSel();
  edStyle(set);
});
window.addEventListener('mouseup', () => { if (SEL.drag) { SEL.drag = null; edFlush(); } });
$('#frameWrap').addEventListener('scroll', drawSel);
function probe(msg) { const fr = curFrame(); if (fr && fr.contentWindow) try { fr.contentWindow.postMessage(msg, '*'); } catch (e) {} }
function setEdit(on) {
  ED.on = !!on;
  $('#btnEdit').classList.toggle('on', ED.on);
  $('#editBar').hidden = !ED.on || S.tab !== 'preview';
  $('#editPanel').hidden = !ED.on;
  $('#stagePreview').classList.toggle('editing', ED.on);
  if (ED.on) { probe({ __uwEditCmd: 'on' }); probe({ __uwEditCmd: 'gaps', on: S.gaps }); $('#ebGap').classList.toggle('on', S.gaps); renderPanel(); if (!CP.list) loadComps(); const g = generatedBy(); if (g) { $('#ebHint').textContent = `注意：这页由${g}生成，Claude重跑生成会把手改冲掉；下次对话我会提醒它先同步进模板`; $('#ebHint').classList.add('caution'); } else $('#ebHint').classList.remove('caution'); }
  else { probe({ __uwEditCmd: 'off' }); ED.info = null; SEL.r = null; if (CP.on) setComps(false); }
  drawSel();
  setTimeout(fitPreview, 30);
}
$('#btnEdit').onclick = () => { if (!S.previewFile) return toast('还没有可以改的页面'); setEdit(!ED.on); };
$('#ebDone').onclick = () => setEdit(false);
$('#ebParent').onclick = () => probe({ __uwEditCmd: 'parent' });
$('#ebText').onclick = () => probe({ __uwEditCmd: 'edit' });
$('#ebUp').onclick = () => probe({ __uwEditCmd: 'moveUp' });
$('#ebDown').onclick = () => probe({ __uwEditCmd: 'moveDown' });
$('#ebDup').onclick = () => probe({ __uwEditCmd: 'duplicate' });
$('#ebDel').onclick = () => probe({ __uwEditCmd: 'remove' });
$('#ebUndo').onclick = () => edUndo('undo');
$('#ebRedo').onclick = () => edUndo('redo');
/* 焦点在客户端本体（面板、工具栏）时的 ⌘Z；焦点在 iframe 里由探针发 undo/redo 消息过来 */
window.addEventListener('keydown', e => {
  if (!ED.on || S.view !== 'work' || S.tab !== 'preview' || !(e.metaKey || e.ctrlKey)) return;
  const t = e.target; if (t && /^(INPUT|TEXTAREA)$/.test(t.tagName)) return;
  if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); edUndo(e.shiftKey ? 'redo' : 'undo'); }
});
window.addEventListener('message', e => {
  const d = e.data; if (!d || !d.__uwEdit) return;
  const cur = curFrame(), pend = PV.pending;
  if (pend && e.source === pend.contentWindow && d.__uwEdit === 'ready') { PV.pending = null; clearTimeout(PV.timer); swapFrames(); }   // 装好了，整帧换上台
  else if (!cur || e.source !== cur.contentWindow) return;
  /* 演示光标走完了 —— 收到才继续换页，这样「点一下」和「页面变了」的先后是对的 */
  if (d.__uwEdit === 'cursor') { const f = CURSOR; CURSOR = null; if (f) f(); return; }
  switch (d.__uwEdit) {
    case 'ready':
      ED.ready = true;
      syncPreviewFile(d.path);
      /* 换页之后把控制台要的那个态补上（页面刚装好，body 上还是源码里写的那个） */
      /* 换页之后把控制台要的那个态＋那几个叠加开关补上（页面刚装好，body 上还是源码里写的那套）。
         🔴 两族都要比：只比主状态的话，从「出结果＋OSS」跳到另一页，OSS 会静悄悄地掉，
         而控制台的勾还勾着 —— 两边说的不是同一件事，这个窗口就白开了。 */
      if (FLOW.on) {
        const pOn = d.on || [], same = FLOW.state === (d.state || 'default') && pOn.length === FLOW.ons.length && FLOW.ons.every(k => pOn.includes(k));
        if (!same) probe({ __uwEditCmd: 'state', key: FLOW.state, on: FLOW.ons });
        else { FLOW.state = d.state || 'default'; FLOW.ons = pOn.slice(); }
        flowReport();
      }
      if (ED.on) { probe({ __uwEditCmd: 'on', select: ED.reselect, scroll: ED.scroll }); probe({ __uwEditCmd: 'gaps', on: S.gaps }); ED.reselect = null; ED.scroll = null; if (!d.n) toast('这页没有可编号的元素，不能手改'); }
      break;
    case 'sel': ED.info = d.info; renderPanel(); closeStackMenu(); break;
    case 'state': FLOW.state = d.key || 'default'; FLOW.ons = d.on || []; flowReport(); break;
    case 'rect': SEL.r = d.r; drawSel(); break;
    case 'note': toast(d.text); break;   // 探针里干完活要说一句人话（比如图标是多色的，只动了主色）
    case 'stack': showStackMenu(d); break;   // 右键：列出光标下所有层，选被盖住的那个
    case 'op': edApply(d.ops, d.kind, d.scroll); break;
    case 'undo': edUndo('undo'); break;
    case 'redo': edUndo('redo'); break;
    case 'drop': edDrop(d); break;
    case 'editing': $('#ebHint').textContent = d.on ? '正在改字：Enter确认 · Esc放弃' : '点选元素 · 双击改字 · 按住拖动换顺序 · 拉右下角改尺寸 · 改动直接写进文件'; break;
  }
});
/* 页面里点链接跳到项目里另一个 html，预览是真的跟着跳了（协议层对项目内任何 .html 都供，探针也照样注）。
   但外面的「当前文件」原来不会跟着变 —— 那之后的手改会按新页面的编号写进旧文件，
   编号对不上就乱改，而且一声不响。所以每次页面就绪都按探针报上来的真实路径对一次账。 */
/* ── 流程控制台（第二个窗口）────────────────────────────
   控制台自己不渲染页面，只发「去这一页的这个态」。页面永远只在这个窗口里渲染，
   而且控制台开着的时候这边不会多出任何控制条——「不做在页面里」这句话就是这么落地的。 */
/* on = 控制台开着没有；state = 互斥的主状态；ons = 正交的叠加开关（OSS客服视角那种，可以同时开几个） */
const FLOW = { on: false, state: 'default', ons: [] };
$('#btnFlow').onclick = async () => {
  if (!S.project) return toast('先打开一个项目');
  if (!uw.flowOpen) return toast('这个版本的客户端还没有流程控制台，更新一下');
  const r = await uw.flowIsOpen();
  if (r.open) { await uw.flowClose(); FLOW.on = false; $('#btnFlow').classList.remove('on'); return; }
  await uw.flowOpen({ id: S.project.id });
  FLOW.on = true; $('#btnFlow').classList.add('on');
  flowReport();
};
/* 🔴 桥上没有这几个方法时不能直接炸：顶层抛一次，它**后面**所有的 const 都留在 TDZ
   （2026-09-17 就是这么让 `CP` 变成「未初始化」的，而报错指向 setEdit，完全指不到真凶）。
   preload 比 renderer 旧就会撞上这种情况——少一个功能可以，整个界面半死不活不行。 */
if (uw.onFlowClosed) uw.onFlowClosed(() => { FLOW.on = false; $('#btnFlow').classList.remove('on'); });
/* 这边换了页或换了态，回头告诉控制台，让它的高亮跟着走。
   两边显示的必须是同一件事——各显示各的，人就得自己在脑子里对账，那这个窗口就白开了 */
function flowReport() {
  if (!FLOW.on || !S.project || !uw.flowAt) return;
  uw.flowAt({ rel: S.previewFile || '', state: FLOW.state, on: FLOW.ons, name: S.project.name || '' });
}
/* ── 演示光标 ─────────────────────────────
   吉吉 2026-09-18：「剧本模式在展示操作的时候，应该配个鼠标移动的效果，让我看到他怎么点击操作，
   要不然没有什么实感」＋「让用户能感知到模拟操作的路径」。
   🔴 演完再换页，不是一起来：先看见光标走到那个按钮上、点一下，页面才变 ——
      这个先后顺序就是「实感」本身。反过来（页面先变、光标后到）看着像页面自己跳的。
   🔴 探针不回也不能卡住：页面可能还没装好、选择器可能找不到。所以留了超时兜底。 */
let CURSOR = null;
function cursorDemo(sel, ms) {
  if (!sel || !uw.flowGoto) return Promise.resolve();
  return new Promise(res => {
    const done = () => { clearTimeout(t); CURSOR = null; res(); };
    CURSOR = done;
    const t = setTimeout(done, ms + 900);      // 兜底：探针没回话也得往下走
    probe({ __uwEditCmd: 'cursor', sel, ms });
  });
}

if (uw.onFlowGoto) uw.onFlowGoto(async msg => {
  /* 退出展示要把演示光标撤掉 —— 不撤的话它会一直停在页面上，
     而人已经回到自己改稿的状态了，那时候屏幕上多一个假鼠标很吓人。 */
  if (msg.show != null) { setCanvasOnly(!!msg.show); if (msg.show && ED.on) setEdit(false); if (!msg.show) probe({ __uwEditCmd: 'cursorOff' }); return; }
  if (!msg.rel) return;
  /* 🔴 主窗口可能停在首页、或者开着别的项目。原来这里一句 `if (!S.project) return` 就把指令吞了，
     屏幕上什么都不会发生、也没有任何提示 —— 吉吉 2026-09-18 报的就是这个
     （「我点了流程里的节点，但 UW 此时在首页，那就不会跳转过去」）。
     控制台一直知道自己是从哪个项目开出来的，现在它把 id 一起发过来，这边照着把项目打开就行。
     → 判据：**「用户点了没反应」比「报个错」糟得多** —— 后者至少告诉人发生了什么。 */
  if (msg.id != null && (!S.project || String(S.project.id) !== String(msg.id))) {
    await openProject(msg.id);
    if (!S.project || String(S.project.id) !== String(msg.id)) { toast('那个项目打不开了，跳不过去'); return; }
    setTab('preview');                 // 可能停在设计稿那页，流程图点过来是要看页面的
  }
  if (!S.project) return;
  /* 🔴 光标演示要发生在**旧页面**上：点的是这一页上的那个链接/按钮，点完才跳走。
     所以放在换 previewFile 之前 —— 换完再演就演到新页面上去了，那是错的。 */
  if (msg.via) await cursorDemo(msg.via, msg.viaMs || 600);
  FLOW.state = msg.state || 'default';
  if (msg.on) FLOW.ons = msg.on.slice();
  if (msg.rel !== S.previewFile) {
    if (ED.on) setEdit(false);
    S.previewFile = msg.rel;
    const sel = $('#previewFile');
    if (sel) { if (![...sel.options].some(o => o.value === msg.rel)) sel.insertAdjacentHTML('beforeend', `<option value="${esc(msg.rel)}">${esc(msg.rel)}</option>`); sel.value = msg.rel; }
    loadPreview(true);      // 换态靠下面 ready 那一步补，这里只管把页面装上
  } else {
    probe({ __uwEditCmd: 'state', key: FLOW.state, on: FLOW.ons });
  }
});

function syncPreviewFile(pathname) {
  if (!pathname || !S.project) return;
  const parts = decodeURIComponent(pathname).split('/').filter(Boolean);
  if (parts[0] !== 'p' || parts[1] !== String(S.project.id)) return;   // p/<项目id>/<相对路径>
  const rel = parts.slice(2).join('/') || 'index.html';
  if (rel === S.previewFile) return;
  const known = (S.project.files || []).some(f => f.rel === rel);
  S.previewFile = rel;
  const sel = $('#previewFile'); if (sel) { if (!known) sel.insertAdjacentHTML('beforeend', `<option value="${esc(rel)}">${esc(rel)}</option>`); sel.value = rel; }
  ED.edits = [];   // 换页了，上一页那批手改记录别记到这一页头上
  toast(`跳到了${rel}，现在改的是这一页`);
  FLOW.state = 'default'; FLOW.ons = [];
  flowReport();
  fqCheck();
}
async function edApply(ops, kind, scroll) {
  if (!S.project || !S.previewFile || !ops || !ops.length) return;
  const structural = /^(remove|duplicate|move|replace)$/.test(kind);
  ED.suppress = Date.now() + 2500;
  const r = await uw.editApply({ id: S.project.id, rel: S.previewFile, ops });
  if (!r.ok) { toast(r.error || '没改成'); ED.suppress = 0; loadPreview(true); return; }   // 出错就回到文件的真身，别让预览和文件两个样
  if (r.changes && r.changes.length) ED.edits.push(...r.changes);
  fqCheck();
  /* 结构变了必须重载（编号变了）。这里主动重载一次，文件监听器随后那次要压掉，不然第二次重载会把刚恢复的选中冲掉 */
  if (structural) { ED.reselect = r.select; ED.scroll = scroll; ED.suppress = Date.now() + 2500; loadPreview(true); }
  else if (kind === 'text' || kind === 'attr') probe({ __uwEditCmd: 'refresh' });
  else if (kind === 'class') { /* 探针切完类名会自己回一条 sel，面板跟着刷 */ }
  else if (ED.info) { ED.info.rect = null; }
}
/* 面板上的样式改动：iframe 里立刻生效，文件那边 350ms 合并写一次（拖滑条不会写几十次） */
function edStyle(set) {
  if (!ED.info || ED.info.generated) return;
  const i = ED.info.i;
  probe({ __uwEditCmd: 'style', i, set, save: false });
  for (const [p, v] of Object.entries(set)) { if (v == null || v === '') delete ED.info.inline[p]; else ED.info.inline[p] = String(v); }
  if (!ED.pending || ED.pending.i !== i) { if (ED.pending) edFlush(); ED.pending = { i, tag: ED.info.tag, set: {} }; }
  Object.assign(ED.pending.set, set);
  clearTimeout(ED.flush); ED.flush = setTimeout(edFlush, 350);
  if ('border-width' in set || 'border-color' in set || 'border-style' in set) syncBorder();
}
/* 描边的两个控件互相牵着：点一个描边色会顺手把描边打开成 1px，选一档宽度会顺手补个默认色。
   面板改完样式不重画，控件就留在旧值上——下拉还停在「无」时，再选一次「无」浏览器根本不发 change，
   描边就去不掉了（吉吉 2026-09-17 撞上）。所以每次动到描边，按 inline 的真值把这两个控件回写一遍。 */
function syncBorder() {
  const P = $('#editPanel'), I = ED.info; if (!P || !I) return;
  const inl = I.inline || {}, cs = I.cs || {};
  const bw = Math.round(parseFloat(inl['border-width'] != null ? inl['border-width'] : cs.borderTopWidth) || 0);
  const sel = $('select[data-border]', P);
  if (sel && sel !== document.activeElement && Array.prototype.some.call(sel.options, o => +o.value === bw)) sel.value = String(bw);
  const bc = rgb2hex(inl['border-color'] != null ? inl['border-color'] : cs.borderTopColor);
  const one = $('.ep-sw button[data-prop="border-color"]', P), wrap = one && one.parentElement; if (!wrap) return;
  wrap.querySelectorAll('button').forEach(x => x.classList.toggle('on', bw ? x.dataset.v === bc : x.classList.contains('none')));
  const hx = wrap.querySelector('input[data-hex]'); if (hx && hx !== document.activeElement) { hx.value = bw ? bc : ''; hx.classList.toggle('bad', !!(bw && bc && !FQ_ALL.has(bc))); }
}
function edFlush() { const p = ED.pending; ED.pending = null; clearTimeout(ED.flush); if (p) edApply([{ op: 'style', i: p.i, tag: p.tag, set: p.set }], 'style'); }
async function edUndo(dir) {
  if (!S.project || !S.previewFile) return;
  edFlush();
  const force = Date.now() - ED.undoWarnAt < 6000;
  const r = await (dir === 'undo' ? uw.editUndo : uw.editRedo)({ id: S.project.id, rel: S.previewFile, force });
  if (r.conflict) { ED.undoWarnAt = Date.now(); toast('这之后文件被Claude改过，再按一次会连它那次改动一起退掉'); return; }
  if (!r.ok) { toast(r.error || '没法撤销'); return; }
  ED.undoWarnAt = 0;
  ED.edits.push(dir === 'undo' ? '撤销了上一步手改' : '重做了一步手改');
  ED.reselect = ED.info ? ED.info.i : null; ED.suppress = Date.now() + 2500;
  loadPreview(true); fqCheck();
}
/* 当前预览页是不是由项目里的脚本 / 模板生成的：是的话手改会被下一次生成冲掉（2026-09-16 吉吉那页就是 build.py 从 src/index.template.html 生成的） */
function generatedBy() {
  const files = (S.project && S.project.files) || [];
  const b = files.find(f => /^(build|gen|make|render)[^/]*\.(py|js|mjs|sh)$/i.test(f.rel));
  const t = files.find(f => /template/i.test(f.rel) && /\.html?$/i.test(f.rel));
  return b ? b.rel + (t ? '（模板 ' + t.rel + '）' : '') : (t ? '模板 ' + t.rel : '');
}
/* 下一次跟 Claude 说话时，把这期间的手改告诉它，免得它按旧印象改回去 */
function edNoteForClaude() {
  if (!ED.edits.length || !S.previewFile) return '';
  const lines = ED.edits.slice(-40);
  const gen = generatedBy();
  const note = `【用户刚在预览里手动改了${S.previewFile}（改动已经写进文件，是最新真身，别按你上次写的印象改回去；这些是内联style / 文本 / 类名层面的改动，如果你要重写同一块，请保留这些值${gen ? `。🔴 这个文件是 ${gen}生成的，你重跑生成就会把这些手改冲掉——请先把同样的改动同步进模板源，再重新生成` : ''}）：\n${lines.map(l => '- ' + l).join('\n')}】`;
  ED.edits = [];
  return note + '\n\n';
}

/* ── 右侧属性面板 ── */
const rgb2hex = c => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(c || ''); if (!m) return c && c.startsWith('#') ? c.toUpperCase() : ''; if (m[4] != null && +m[4] === 0) return ''; return '#' + [m[1], m[2], m[3]].map(x => (+x).toString(16).padStart(2, '0')).join('').toUpperCase(); };
const px = v => { const n = parseFloat(v); return isNaN(n) ? '' : String(Math.round(n * 10) / 10); };
function renderPanel() {
  const P = $('#editPanel'); if (!ED.on) return;
  const I = ED.info;
  if (!I) { P.innerHTML = hk(`<div class="ep-none">点页面里的任何一块开始改。<br><br>单击选中 · <b>右键＝选被盖住的那层</b> · 双击改字 · 按住拖动在同级之间换顺序 · 拉右下角改宽高<br>⌫ 删除 · ⌘D复制 · ⌘↑⌘↓ 前后挪 · ⇧Enter选上一层 · Tab选下一个 · ⌘Z撤销</div>`); return; }
  const cs = I.cs, inl = I.inline || {};
  const cur = (p, fromCs) => inl[p] != null ? inl[p] : fromCs;
  const fs_ = px(cur('font-size', cs.fontSize)), fw = String(cur('font-weight', cs.fontWeight)).replace(/^normal$/, '400').replace(/^bold$/, '700');
  const color = I.svg && !I.svg.usesCurrentColor ? svgInkColor(I.svg.html) : rgb2hex(inl.color || cs.color), bg = rgb2hex(inl['background-color'] || cs.backgroundColor);
  const bw = px(cur('border-width', cs.borderTopWidth)), bc = rgb2hex(inl['border-color'] || cs.borderTopColor), br = px(cur('border-radius', cs.borderRadius));
  const isFlex = /flex/.test(cur('display', cs.display)), inlineEl = cs.display === 'inline';
  const swatches = (list, on, prop) => `<div class="ep-sw">${list.map(([h, n]) => `<button data-prop="${prop}" data-v="${h}" class="${on === h ? 'on' : ''}" style="background:${h}" title="${esc(n)} ${h}"></button>`).join('')}${prop === 'background-color' || prop === 'border-color' ? `<button data-prop="${prop}" data-v="" class="none ${(prop === 'border-color' ? !(parseFloat(bw) > 0) : !on) ? 'on' : ''}" title="${prop === 'border-color' ? '无描边' : '无填充'}"></button>` : ''}<input type="text" data-hex="${prop}" value="${esc(on)}" placeholder="#000000" spellcheck="false" class="${on && !FQ_ALL.has(on) ? 'bad' : ''}" title="${on && !FQ_ALL.has(on) ? '不是飞鹊色板里的值' : '也可以直接填色值'}"></div>`;
  const opt = (arr, v, fmt) => { const has = arr.some(x => String(Array.isArray(x) ? x[0] : x) === String(v)); return (has || !v ? '' : `<option value="${esc(v)}" selected>${esc(v)}（非飞鹊）</option>`) + arr.map(x => { const k = Array.isArray(x) ? x[0] : x, n = Array.isArray(x) ? x[1] : fmt(x); return `<option value="${k}" ${String(k) === String(v) ? 'selected' : ''}>${esc(n)}</option>`; }).join(''); };
  const seg = (prop, cur_, items) => `<div class="ep-seg">${items.map(([v, n]) => `<button data-prop="${prop}" data-v="${v}" class="${cur_ === v ? 'on' : ''}">${n}</button>`).join('')}</div>`;
  const quad = (name, prop, vals) => `<div class="ep-quad">${['上', '右', '下', '左'].map((lb, k) => `<div><input type="number" step="4" min="0" data-prop="${prop}-${['top', 'right', 'bottom', 'left'][k]}" value="${px(vals[k])}"><span>${lb}</span></div>`).join('')}</div>`;
  const path = (I.path || []).map(p => `<button data-sel="${p.i}" title="${esc(p.label)}">${esc(p.label)}</button><i>›</i>`).join('');
  let h = `<div class="ep-head"><div class="ep-crumb">${path}</div><div class="ep-cur"><b title="${esc(I.label)}">${esc(I.label)}</b>${I.rect ? `<small>${I.rect.w} × ${I.rect.h}</small>` : ''}</div></div>`;
  if (I.generated) { h += `<div class="ep-warn">这块是页面脚本生成的，源码里没有它，手改对不上位置。要改它得让Claude改脚本。</div>`; P.innerHTML = h; bindPanel(); return; }
  h += variantSection(I);
  if (I.svg) h += iconSection(I);
  if (I.textOnly) h += `<div class="ep-sec"><div class="ep-t">文字 <small>Enter确认</small></div><textarea class="ep-text" data-text spellcheck="false">${esc(I.text || '')}</textarea></div>`;
  if (I.fill) h += fillSection(I, null);
  else if (I.innerFill) h += fillSection(I, I.innerFill);
  if (I.href != null) h += `<div class="ep-sec"><div class="ep-t">链接</div><div class="ep-row"><label>去哪</label><input type="text" data-attr="href" value="${esc(I.href || '')}" spellcheck="false"></div></div>`;
  if (I.svg) h += `<div class="ep-sec"><div class="ep-t">颜色 <small>${I.svg.usesCurrentColor ? '跟着文字色走' : '颜色写死在图标里'}</small></div><div class="ep-row"><label>图标色</label>${swatches(FQ.text, color, 'color')}</div></div>`;
  else if (!I.isImg) h += `<div class="ep-sec"><div class="ep-t">文本样式 <small>飞鹊字号阶梯</small></div>
    <div class="ep-row two"><label>字号</label><select class="sel" data-prop="font-size" data-unit="px">${opt(FQ.fontSize, fs_, x => x)}</select><label>字重</label><select class="sel" data-prop="font-weight">${opt([[400, '常规'], [700, '加粗']], fw, x => x)}</select></div>
    <div class="ep-row"><label>对齐</label>${seg('text-align', cur('text-align', cs.textAlign).replace(/^start$/, 'left'), [['left', '左'], ['center', '中'], ['right', '右']])}</div>
    <div class="ep-row"><label>颜色</label>${swatches(FQ.text, color, 'color')}</div></div>`;
  /* 填充是一叠：底色 → 图片 → 蒙版（照 Figma 的 fills 栈）。没有图的元素在这儿能直接加一张图变成背景图，
     加完面板会刷成上面那段「图片」（换图 / 摆法 / 蒙版都在那儿）。图片元素和图标不给这个入口。 */
  h += `<div class="ep-sec"><div class="ep-t">填充 <small>${I.fill && I.fill.kind === 'bg' ? '底色 → 图片 → 蒙版' : '底色 → 蒙版'}</small></div><div class="ep-row"><label>背景</label>${swatches(FQ.bg, bg, 'background-color')}</div>${!I.fill && !I.innerFill && !I.svg && !I.isImg ? maskRowsHtml(I.bgMask) + `<div class="ep-row"><label>图片</label><div class="fill-add" data-filladd tabindex="0" title="${hk('拖一张图进来、点一下选文件、或者⌘V粘贴')}">＋ 加一张背景图<small>拖入 / 点选 / ${hk('⌘V')}</small></div></div>` : ''}</div>`;
  if (!inlineEl) {
    /* 拖进来的飞鹊砖（页头 1240、产品卡 280…）都是固定宽度，放进 1440 的页面里就缺一截。
       原来面板只有一个宽度输入框，看不出「现在是固定还是跟着容器走」，也没法一键切（吉吉 2026-09-17）。
       所以给宽度一个明确的档：自动＝跟内容走 / 撑满＝跟容器走 / 固定＝锁死像素。 */
    const wMode = /100%/.test(inl.width || '') || /^1[ ]/.test(inl.flex || '') ? 'fill' : (inl.width ? 'fix' : 'auto');
    h += `<div class="ep-sec"><div class="ep-t">尺寸 <small>${I.parentFlex ? '父级是自动布局' : '留空＝自动'}</small></div>
    <div class="ep-row"><label>宽度</label>${seg('__wmode', wMode, [['auto', '自动'], ['fill', '撑满'], ['fix', '固定']])}</div>
    <div class="ep-row two"><label>宽</label><input type="text" data-prop="width" data-unit="px" value="${esc(inl.width && !/100%/.test(inl.width) ? px(inl.width) : '')}" placeholder="${px(cs.width)}"><label>高</label><input type="text" data-prop="height" data-unit="px" value="${esc(inl.height ? px(inl.height) : '')}" placeholder="${px(cs.height)}"></div></div>`;
  }
  if (isFlex) h += `<div class="ep-sec"><div class="ep-t">自动布局 <small>flex</small></div>
    <div class="ep-row"><label>方向</label>${seg('flex-direction', cur('flex-direction', cs.flexDirection), [['row', '横排'], ['column', '竖排']])}</div>
    <div class="ep-row"><label>间距</label><input type="number" step="4" min="0" data-prop="gap" data-unit="px" value="${px(cur('gap', cs.gap))}"></div>
    <div class="ep-row"><label>主轴</label>${seg('justify-content', cur('justify-content', cs.justifyContent).replace(/^normal$/, 'flex-start'), [['flex-start', '起'], ['center', '中'], ['flex-end', '末'], ['space-between', '两端']])}</div>
    <div class="ep-row"><label>交叉</label>${seg('align-items', cur('align-items', cs.alignItems).replace(/^normal$/, 'stretch'), [['flex-start', '起'], ['center', '中'], ['flex-end', '末'], ['stretch', '拉伸']])}</div></div>`;
  if (!inlineEl) h += `<div class="ep-sec"><div class="ep-t">内边距 <small>4的倍数</small></div>${quad('padding', 'padding', [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft])}</div>
    <div class="ep-sec"><div class="ep-t">外边距</div>${quad('margin', 'margin', [cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft])}</div>`;
  h += `<div class="ep-sec"><div class="ep-t">描边与圆角</div>
    <div class="ep-row two"><label>描边</label><select class="sel" data-prop="border-width" data-unit="px" data-border>${opt([[0, '无'], [1, '1px'], [2, '2px']], bw === '' ? 0 : bw, x => x)}</select><label>圆角</label><select class="sel" data-prop="border-radius" data-unit="px">${opt(FQ.radius, br === '' ? 0 : br, x => x)}</select></div>
    <div class="ep-row"><label>描边色</label>${swatches(FQ.border, bc, 'border-color')}</div></div>`;
  const opv = Math.round(parseFloat(cur('opacity', cs.opacity)) * 100);
  h += `<div class="ep-sec"><div class="ep-t">透明度</div><div class="ep-op"><input type="range" class="ep-range" min="0" max="100" data-prop="opacity" data-scale="0.01" value="${opv}"><input type="number" class="ep-opn" min="0" max="100" step="1" data-opn value="${opv}"><span>%</span></div></div>`;
  P.innerHTML = h; bindPanel();
}
/* ── 图片填充：点中一张图，换成别的，并定它在框里怎么摆（照 Figma 那张填充卡）──
   <img> 和 CSS 背景图在面板上长一样，差别只在写回：前者改 src，后者改 background-image。
   🔴 Figma 的 Crop（手动拖裁切框）没做：HTML 里没有干净的对应，硬做只能靠负 margin / clip-path 拼，
      产出的是前端不想接的 CSS。要精确裁切就裁好图再放进来，别用样式假装裁过。 */
const FITS_IMG = [['cover', '撑满', '填满整个框，多出来的裁掉'], ['contain', '完整显示', '整张图都看得见，框里可能留白'], ['fill', '拉伸', '拉满整个框，图会变形']];
const FITS_BG = [['cover', '撑满', '填满整个框，多出来的裁掉'], ['contain', '完整显示', '整张图都看得见，框里可能留白'], ['auto', '原样', '按原图大小放，不缩放']];
const POS9 = [['left top', '左上'], ['center top', '上'], ['right top', '右上'], ['left center', '左'], ['center center', '中'], ['right center', '右'], ['left bottom', '左下'], ['center bottom', '下'], ['right bottom', '右下']];
/* 把computed值归到面板上的档。认不出来的一律显示成第三档，别硬塞进「撑满」骗人 */
function fitKey(v, isBg) { v = String(v || '').split(',')[0].trim(); return v === 'cover' || v === 'contain' ? v : (isBg ? 'auto' : 'fill'); }
/* computed的background-position/object-position是百分比（50% 50%），换算回九宫格 */
function posKey(v) {
  const s = String(v || '').split(',')[0].trim().replace(/50%/g, 'center').replace(/(^|\s)0%/g, '$1left-or-top').replace(/100%/g, 'right-or-bottom');
  const [a, b] = s.split(/\s+/);
  const x = /left/.test(a) ? 'left' : /right/.test(a) ? 'right' : 'center';
  const y = /top/.test(b || a) ? 'top' : /bottom/.test(b || a) ? 'bottom' : 'center';
  const k = `${x} ${y}`;
  return POS9.some(p => p[0] === k) ? k : 'center center';
}
/* 蒙版：面板上是 hex + 浓度，写进 CSS 是 rgba；computed 里回来的也是 rgba，要能来回换 */
function maskParts(rgba) {
  const m = /rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\)/.exec(rgba || ''); if (!m) return null;
  const hex = '#' + [m[1], m[2], m[3]].map(n => (+n).toString(16).padStart(2, '0')).join('').toUpperCase();
  return { hex, alpha: Math.round((m[4] == null ? 1 : +m[4]) * 100) };
}
function maskRgba(hex, alpha) { const h = String(hex || '').replace('#', ''); if (!/^[0-9a-f]{6}$/i.test(h)) return null; const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); return `rgba(${r},${g},${b},${(Math.max(0, Math.min(100, +alpha)) / 100).toFixed(2).replace(/\.?0+$/, '') || 0})`; }
/* 分层背景：蒙版在上、图在下。url() 用单引号（双引号进 inline style 会被转义成 &quot;） */
function bgLayers(src, mask) { const u = `url('${src}')`; return mask ? `linear-gradient(${mask}, ${mask}), ${u}` : u; }
/* fillSrcRel 的逆运算：把「相对当前页面文件」的写法换成预览态能直接显示的绝对地址。
   🔴 为什么要这一步：从线上克隆下来的页面第一行常有 <base href="https://某站/">，DOM 上写相对地址
      会被解析到那个站上去 —— 图当场看不见，得等页面重载（协议层那边才会改写）。
      所以源码写相对路径（干净、可交付），DOM 上补一份绝对地址让人立刻看见。 */
function previewAbs(rel) {
  const v = String(rel || '').trim();
  if (!v || /^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith('//') || v.startsWith('#') || !S.project) return null;
  const out = (S.previewFile || '').split('/').slice(0, -1);
  for (const seg of v.split('/')) { if (!seg || seg === '.') continue; if (seg === '..') out.pop(); else out.push(seg); }
  return `uwproj://p/${encodeURIComponent(S.project.id)}/${out.map(encodeURIComponent).join('/')}`;
}
/* 背景图地址如果是 computed 给的绝对地址（uwproj://p/<项目>/images/x.png），换回相对当前页面文件的写法再写进源码 */
function fillSrcRel(F) {
  const s = String(F.src || '');
  if (!/^[a-z]+:\/\//i.test(s)) return s;
  const pre = `uwproj://p/${encodeURIComponent(S.project.id)}/`;
  if (!s.startsWith(pre)) return s;
  const projRel = decodeURIComponent(s.slice(pre.length).split('?')[0]);
  const from = (S.previewFile || '').split('/').slice(0, -1), to = projRel.split('/');
  let k = 0; while (k < from.length && k < to.length - 1 && from[k] === to[k]) k++;
  return [...Array(from.length - k).fill('..'), ...to.slice(k)].join('/');
}
/* 蒙版两行（选色 + 浓度）。有图时压在图上，没图时压在底色上——同一套控件，写回时再分 */
function maskRowsHtml(mask) {
  const mk = maskParts(mask);
  return `<div class="ep-row"><label>蒙版</label><div class="mask-row">
      <button data-fillmask="" class="mk none${mk ? '' : ' on'}" title="不加蒙版"></button>
      ${[['#000000', '黑'], ['#FFFFFF', '白'], ['#E64545', '品牌红'], ['#1D1D1F', '墨']].map(([h, n]) => `<button data-fillmask="${h}" class="mk${mk && mk.hex.toUpperCase() === h ? ' on' : ''}" style="background:${h}" title="${n}"></button>`).join('')}
      <input type="text" data-fillmaskhex value="${mk ? mk.hex : ''}" placeholder="#000000" spellcheck="false"></div></div>
    <div class="ep-row fill-alpha${mk ? '' : ' off'}"><label>浓度</label><div class="alpha-row"><input type="range" data-fillmaskalpha min="0" max="100" value="${mk ? mk.alpha : 20}"><span data-fillmaskv>${mk ? mk.alpha : 20}%</span></div></div>`;
}
/* 填充这一段改的不一定是选中的这层：头像那种「外层画圆、内层放 img」的写法里，
   图在里面那层，外层的底色/背景图/蒙版全会被它盖住。所以操作目标统一从这儿取，
   下面每个绑定都不必再自己分叉一次。 */
function fillT() {
  const I = ED.info; if (!I) return null;
  if (I.fill) return { i: I.i, fill: I.fill, inner: null };
  if (I.innerFill) return { i: I.innerFill.i, fill: I.innerFill.fill, inner: I.innerFill };
  return null;
}
function fillSection(I, IN) {
  const F = IN ? IN.fill : I.fill, isBg = F.kind === 'bg', fits = isBg ? FITS_BG : FITS_IMG;
  const fitNow = fitKey(F.fit, isBg), posNow = posKey(F.pos);
  return `<div class="ep-sec ep-fill"><div class="ep-t">图片 <small>${IN ? `${IN.how === 'under' ? '压在这层下面' : '在里面那层'} &lt;${esc(IN.tag)}&gt;` : (isBg ? '背景图' : '图片元素')}${F.nw ? ` · 原图${F.nw}×${F.nh}` : ''}</small>${IN ? `<button class="link-btn" data-sel="${IN.i}" title="这张图点不到（被这层挡着）。点一下把选中切到它本身，改尺寸、链接、说明">选中它</button>` : ''}</div>
    <div class="fill-pv" data-fillpv tabindex="0" title="${hk('点一下换图，也可以把图拖进来、或者⌘V粘贴')}"><img src="${esc(F.shown || '')}" alt=""><span class="fill-hint">换图</span></div>
    <div class="ep-row"><label>摆法</label><select class="sel" data-fillfit>${fits.map(([v, n, t]) => `<option value="${v}"${v === fitNow ? ' selected' : ''} title="${esc(t)}">${n}</option>`).join('')}</select></div>
    <div class="ep-row fill-pos${fitNow === 'fill' ? ' off' : ''}"><label>位置</label><div class="pos9">${POS9.map(([v, n]) => `<button data-fillpos="${v}" class="${v === posNow ? 'on' : ''}" title="${n}"></button>`).join('')}</div></div>
    ${isBg ? maskRowsHtml(F.mask) : `<div class="ep-row"><label>蒙版</label><div class="fill-note">图片元素加不了蒙版 <button class="link-btn" data-fill2bg title="换成一个同尺寸、以这张图为背景的容器，之后就能加蒙版、往上放文字">转成背景图</button></div></div>`}
    <div class="ep-row"><label>地址</label><input type="text" data-fillsrc value="${esc(fillSrcRel(F))}" spellcheck="false"></div>
    ${isBg || IN ? '' : `<div class="ep-row"><label>说明</label><input type="text" data-attr="alt" value="${esc(I.alt || '')}" placeholder="alt"></div>`}</div>`;
}
/* 换图。图先落进项目的 images/，回来的是相对当前页面文件的路径，直接写进源码。
   🔴 换完要把显示尺寸接住：<img>换了src如果没写死宽高，会按新图原始尺寸把布局撑乱
      （跟换图标那条 keepSize 是同一个道理）。 */
function fillSwapTo(rel, natural) {
  const T = fillT(); if (!T) return;
  const I = ED.info, tw = T.inner ? T.inner.rect : I.rect;
  /* 🔴 url() 里用单引号，不能用双引号：inline style 本身是 style="…"，双引号会被转义成 &quot; 写进源码，
        浏览器虽然照样能解析，但交给前端的那行 CSS 会变成 url(&quot;images/bg.png&quot;)，没法看。 */
  const abs = previewAbs(rel);
  if (T.fill.kind === 'bg') {
    probe({ __uwEditCmd: 'style', i: T.i, set: { 'background-image': bgLayers(rel, T.fill.mask), 'background-repeat': 'no-repeat' }, save: true });
    if (abs) probe({ __uwEditCmd: 'style', i: T.i, set: { 'background-image': bgLayers(abs, T.fill.mask) }, save: false });   // 只改 DOM 让人立刻看见，源码留上面那份相对路径
    T.fill.src = rel; return;
  }
  const set = {};
  if (natural && !T.fill.cssSized && tw && tw.w && tw.h) { set.width = tw.w + 'px'; set.height = tw.h + 'px'; }   // 样式表已经在管尺寸的图别写死，否则新图按旧图比例变形
  if (Object.keys(set).length) probe({ __uwEditCmd: 'style', i: T.i, set, save: true });
  probe({ __uwEditCmd: 'attr', i: T.i, name: 'src', value: rel, save: true });
  if (abs) probe({ __uwEditCmd: 'attr', i: T.i, name: 'src', value: abs, save: false });
}
/* 给没有图的元素加背景图：撑满居中、不平铺，底色留在下面。写完重新选中一次，面板才会刷出「图片」段 */
function fillAddBgRel(rel) {
  const I = ED.info; if (!I) return;
  probe({ __uwEditCmd: 'style', i: I.i, set: { 'background-image': bgLayers(rel, I.bgMask || null), 'background-size': 'cover', 'background-position': 'center center', 'background-repeat': 'no-repeat' }, save: true });   // 先叠好的蒙版跟着留在图上面
  const abs0 = previewAbs(rel); if (abs0) probe({ __uwEditCmd: 'style', i: I.i, set: { 'background-image': bgLayers(abs0, I.bgMask || null) }, save: false });
  setTimeout(() => probe({ __uwEditCmd: 'select', i: I.i }), 80);
}
async function fillPick(srcPath, blob) {
  const I = ED.info; if (!I || !S.project) return;
  const r = srcPath
    ? await uw.putImage({ id: S.project.id, pageRel: S.previewFile, srcPath })
    : await uw.putImage({ id: S.project.id, pageRel: S.previewFile, name: blob.name, data: blob.data });
  if (!r || !r.ok) return toast((r && r.error) || '这张图没放进去');
  if (!I.fill && !I.innerFill) { fillAddBgRel(r.rel); toast(`加上了背景图${r.name}`); return; }
  fillSwapTo(r.rel, true);
  /* 面板自己也换成新图：缩略图走 uwproj 绝对地址（面板在主窗口，用相对路径找不到文件），
     带个时间戳绕掉缓存——换成同名不同内容的图时，不带它会一直显示旧的那张。 */
  const P = $('#editPanel');
  const abs = `uwproj://p/${encodeURIComponent(S.project.id)}/${r.projRel.split('/').map(encodeURIComponent).join('/')}?t=${Date.now()}`;
  const im = $('[data-fillpv] img', P); if (im) im.src = abs;
  const si2 = $('[data-fillsrc]', P); if (si2) si2.value = r.rel;
  const T0 = fillT(); if (T0) { T0.fill.src = r.rel; T0.fill.shown = abs; }
  toast(`换成了${r.name}`);
}
function bindFill(P) {
  const ad = $('[data-filladd]', P);
  if (ad) {
    ad.onclick = async () => { const p = await uw.pickImage('选一张图做背景'); if (p) fillPick(p); };
    ad.addEventListener('dragover', e => { e.preventDefault(); ad.classList.add('over'); });
    ad.addEventListener('dragleave', () => ad.classList.remove('over'));
    ad.addEventListener('drop', e => { e.preventDefault(); ad.classList.remove('over'); const f = [...(e.dataTransfer.files || [])][0]; if (!f) return; const p = uw.pathForFile(f); if (p) fillPick(p); else f.arrayBuffer().then(b => fillPick(null, { name: f.name, data: new Uint8Array(b) })); });
    ad.addEventListener('paste', e => { const it = [...(e.clipboardData.items || [])].find(x => x.type.startsWith('image/')); if (!it) return; e.preventDefault(); const f = it.getAsFile(); if (!f) return; const ext = String(f.type.split('/')[1] || 'png').split('+')[0].replace(/[^a-z0-9]/gi, '') || 'png'; f.arrayBuffer().then(b => fillPick(null, { name: `粘贴的图.${ext}`, data: new Uint8Array(b) })); });
  }
  /* 🔴 缩略图只在有图时才有，蒙版两行没图也有——所以不能在这儿 return，否则纯底色叠色那排色块点了没反应（2026-09-17 真机测出） */
  const pv = $('[data-fillpv]', P);
  if (pv) {
    pv.onclick = async () => { const p = await uw.pickImage('选一张图片'); if (p) fillPick(p); };
    pv.addEventListener('dragover', e => { e.preventDefault(); pv.classList.add('over'); });
    pv.addEventListener('dragleave', () => pv.classList.remove('over'));
    pv.addEventListener('drop', e => {
      e.preventDefault(); pv.classList.remove('over');
      const f = [...(e.dataTransfer.files || [])][0]; if (!f) return;
      const p = uw.pathForFile(f);
      if (p) fillPick(p); else f.arrayBuffer().then(b => fillPick(null, { name: f.name, data: new Uint8Array(b) }));
    });
    /* 粘贴只在缩略图拿到焦点时接管，否则会跟对话框那边的粘贴抢 */
    pv.addEventListener('paste', e => {
      const it = [...(e.clipboardData.items || [])].find(x => x.type.startsWith('image/')); if (!it) return;
      e.preventDefault(); const f = it.getAsFile(); if (!f) return;
      /* 🔴 MIME 的后半段不等于扩展名：SVG 是 image/svg+xml，直接拿会得到「粘贴的图.svg+xml」，
         落盘再被文件名清理换成 .svg-xml——一个浏览器认不出的扩展名，图就显示不出来了。
         PNG/JPG 恰好没这问题，所以这条只有粘贴 SVG 时才会踩到（2026-09-17 真机测出来的）。 */
      const ext = String(f.type.split('/')[1] || 'png').split('+')[0].replace(/[^a-z0-9]/gi, '') || 'png';
      f.arrayBuffer().then(b => fillPick(null, { name: `粘贴的图.${ext}`, data: new Uint8Array(b) }));
    });
    /* 🔴 改完要就地把面板自己的状态也更新掉。2026-09-17 真机测出来的：点九宫格右下，
          源码确实写对了，但高亮还停在中间——因为改样式走的是探针那条路，面板不会重画，
          ED.info 还是选中那一刻的旧值。用户看到的是「点了没反应」，于是会再点一次。 */
  }
  const fit = $('[data-fillfit]', P);
  if (fit) fit.onchange = () => {
    const T = fillT(); if (!T) return;
    const v = fit.value;
    probe({ __uwEditCmd: 'style', i: T.i, save: true,
      set: T.fill.kind === 'bg' ? { 'background-size': v, 'background-repeat': 'no-repeat' } : { 'object-fit': v } });
    T.fill.fit = v;
    const row = $('.fill-pos', P); if (row) row.classList.toggle('off', v === 'fill');   // 拉伸时选裁哪块没意义
  };
  $$('[data-fillpos]', P).forEach(b => b.onclick = () => {
    const T = fillT(); if (!T) return;
    const v = b.dataset.fillpos;
    probe({ __uwEditCmd: 'style', i: T.i, save: true,
      set: T.fill.kind === 'bg' ? { 'background-position': v } : { 'object-position': v } });
    T.fill.pos = v;
    $$('[data-fillpos]', P).forEach(x => x.classList.toggle('on', x === b));
  });
  const si = $('[data-fillsrc]', P);
  if (si) si.addEventListener('change', () => { if (si.value.trim()) fillSwapTo(si.value.trim(), false); });
  /* 蒙版：选色 / 填 hex / 拖浓度。拖的时候实时预览不落盘（save:false），松手才写进源码。 */
  const writeMask = (save) => {
    const I = ED.info; if (!I) return;
    const T = fillT(); if (T && T.fill.kind !== 'bg') return;   // <img> 走「转成背景图」，这里只管背景图和纯底色
    const hexEl = $('[data-fillmaskhex]', P), aEl = $('[data-fillmaskalpha]', P), vEl = $('[data-fillmaskv]', P);
    const hex = (hexEl.value || '').trim(), alpha = +aEl.value;
    const mask = hex ? maskRgba(hex, alpha) : null;
    if (hex && !mask) { hexEl.classList.add('bad'); return; } hexEl.classList.remove('bad');
    if (vEl) vEl.textContent = alpha + '%';
    $('.fill-alpha', P).classList.toggle('off', !mask);
    $$('[data-fillmask]', P).forEach(b => b.classList.toggle('on', (b.dataset.fillmask || '').toUpperCase() === (mask ? hex.toUpperCase() : '')));
    I.bgMask = mask;
    if (T) {
      T.fill.mask = mask; const r0 = fillSrcRel(T.fill), a0 = previewAbs(r0);
      probe({ __uwEditCmd: 'style', i: T.i, set: { 'background-image': bgLayers(r0, mask), 'background-repeat': 'no-repeat' }, save: !!save });
      if (a0) probe({ __uwEditCmd: 'style', i: T.i, set: { 'background-image': bgLayers(a0, mask) }, save: false });
    }
    else probe({ __uwEditCmd: 'style', i: I.i, set: { 'background-image': mask ? `linear-gradient(${mask}, ${mask})` : null }, save: !!save });   // 压在底色上；去掉＝整个属性删掉
  };
  $$('[data-fillmask]', P).forEach(b => b.onclick = () => { $('[data-fillmaskhex]', P).value = b.dataset.fillmask || ''; writeMask(true); });
  const mh = $('[data-fillmaskhex]', P); if (mh) mh.addEventListener('change', () => writeMask(true));
  const ma = $('[data-fillmaskalpha]', P); if (ma) { ma.addEventListener('input', () => writeMask(false)); ma.addEventListener('change', () => writeMask(true)); }
  /* <img> 转成背景图容器：同尺寸、同 class，这张图当背景、撑满居中。之后就能加蒙版、往里放文字 */
  const to = $('[data-fill2bg]', P);
  if (to) to.onclick = () => {
    const T = fillT(); if (!T || T.fill.kind !== 'img') return;
    const I = ED.info, src = T.inner || I;
    const w = src.rect ? src.rect.w : 0, h = src.rect ? src.rect.h : 0;
    const cls = (src.classes || []).length ? ` class="${esc((src.classes || []).join(' '))}"` : '';
    const html = `<div${cls} style="width:${w}px;height:${h}px;background-image:url('${fillSrcRel(T.fill)}');background-size:cover;background-position:center;background-repeat:no-repeat"></div>`;
    edApply([{ op: 'replace', i: T.i, tag: 'img', html, what: '图片转成背景图容器', label: src.label }], 'replace');
  };
}

/* ── 飞鹊图标：点中一个 svg，认出它是哪个飞鹊图标，一键换成别的（跟 Figma 的实例替换一样）── */
const IC = { q: '', hit: undefined, forI: null };
function iconSection(I) {
  if (IC.forI !== I.i) { IC.forI = I.i; IC.hit = undefined; IC.q = ''; uw.iconIdentify(I.svg.paths).then(r => { IC.hit = r.ok ? r.hit : null; if (ED.info && ED.info.i === I.i) renderPanel(); }); }
  const cur = IC.hit === undefined ? '正在认…' : IC.hit ? (IC.hit.exact ? `飞鹊「${IC.hit.name}」` : `像飞鹊「${IC.hit.name}」`) : '非飞鹊图标';
  return `<div class="ep-sec ep-icon"><div class="ep-t">图标 <small title="${esc(cur)} · ${I.svg.w}×${I.svg.h}">${esc(cur)} · ${I.svg.w}×${I.svg.h}</small></div>
    <input type="text" class="ep-icq" data-icq placeholder="搜名字或用途：附件、聊天、认证…" value="${esc(IC.q)}" spellcheck="false">
    <div class="ep-icgrid">${iconGrid()}</div></div>`;
}
/* 🔴 只按文件名搜是搜不到的：飞鹊的文件名多是 MIC 内部缩写（聊天叫 tm、附件叫 attachment），
   吉吉 2026-09-17 搜「附件」搜不到，以为库里没有 —— 其实一直都在。
   所以连 icons/INDEX.md 里的中文名与检索词一起搜，并按「名字命中 > 关键词命中」排。
   同一个选择器里还摆上 brand/ 的 18 个品牌与认证标（认证标 svg.bmark 那种，原来一个都选不到）。 */
function iconMatches() {
  const F = KB.fq || {}, words = F.iconWords || {}, q = IC.q.trim().toLowerCase();
  const icons = (F.icons || []).map(n => ({ name: n, kind: 'icon', words: words[n] || '' }));
  const brand = (F.brand || []).map(b => ({ name: b.name, kind: 'brand', words: b.words || '', size: b.size }));
  const score = it => {
    if (!q) return 0;
    const n = it.name.toLowerCase(), w = it.words.toLowerCase();
    if (n === q) return 100;
    if (n.startsWith(q)) return 80;
    if (n.includes(q)) return 60;
    const k = w.indexOf(q);
    return k < 0 ? -1 : 40 - Math.min(35, k / 4);     // 检索词越靠前越相关（表格里的词排在分类词前面）
  };
  const take = list => (q ? list.map(it => [score(it), it]).filter(x => x[0] >= 0).sort((a, b) => b[0] - a[0]).map(x => x[1]) : list);
  let ic = take(icons);
  if (IC.hit) { const me = ic.findIndex(x => x.name === IC.hit.name); if (me > 0) ic.unshift(ic.splice(me, 1)[0]); }   // 当前这个排第一，跟 Figma 实例面板一样
  return { icons: ic, brand: take(brand) };
}
function iconGrid() {
  const m = iconMatches();
  const cell = it => `<button data-ic="${esc(it.name)}" data-kind="${it.kind}" class="${it.kind === 'brand' ? 'br ' : ''}${IC.hit && IC.hit.name === it.name ? 'on' : ''}" title="${esc(it.name + (it.words ? ' · ' + it.words : ''))}"><img src="../packs/feique/${it.kind === 'brand' ? 'brand' : 'icons'}/${esc(it.name)}.svg" alt="" loading="lazy"></button>`;
  let h = m.icons.map(cell).join('');
  if (m.brand.length) h += `<div class="ep-icg">品牌与认证 · ${m.brand.length}</div>` + m.brand.map(cell).join('');
  return h || '<div class="ep-icg">没有对得上的</div>';
}
async function iconSwap(name, kind) {
  if (!ED.info || !ED.info.svg) return;
  const I = ED.info, r = await uw.iconSvg({ name, kind: kind || 'icon' }); if (!r.ok) return toast(r.error || '取不到图标');
  /* 新图标接住原来的尺寸 / class / style / 颜色写法：原来用 currentColor 跟文字走，新的也跟 */
  const keepSize = kind !== 'brand';   // 品牌标有自己的长宽比（105×16 这种），套用原元素的宽高会压扁
  let svg = r.svg.replace(/^<svg\b([^>]*)>/, (m, attrs) => {
    let a = attrs.replace(/\s(class|style|fill)="[^"]*"/g, '');
    if (keepSize) a = a.replace(/\s(width|height)="[^"]*"/g, '');
    const A = I.svg.attrs;
    if (keepSize && A.width) a += ` width="${esc(A.width)}"`; if (keepSize && A.height) a += ` height="${esc(A.height)}"`;
    if (A.class) a += ` class="${esc(A.class)}"`; if (A.style) a += ` style="${esc(A.style)}"`; if (A.fill) a += ` fill="${esc(A.fill)}"`;
    return `<svg${a} data-fq-${keepSize ? 'icon' : 'brand'}="${esc(name)}">`;
  });
  /* 🔴 品牌与认证标不许改颜色（brand/INDEX.md 第一条），所以只有 UI 图标才接手 currentColor 这套 */
  if (keepSize && I.svg.usesCurrentColor) svg = svg.replace(/fill="#222222"/gi, 'fill="currentColor"');
  edApply([{ op: 'replace', i: I.i, tag: 'svg', html: svg, what: (keepSize ? '飞鹊图标 ' : '飞鹊品牌标 ') + name, label: I.label }], 'replace');
}
/* 为什么点了颜色图标一动不动：飞鹊的 svg 把 fill 写死在 path 上（吉吉那页 65 处 fill="#222222"、currentColor 0 处），
   CSS 的 color 对它无效——面板照样把 color 写进去了，所以看着像「设置生效了但页面没反应」。
   第一次在面板上改图标颜色时，就地把主墨色换成 currentColor 再写 color，之后这个图标就跟着颜色走了
   （跟 iconSwap 换图标时保留 currentColor 是同一套写法）。多色图标只动占比最大的那一种，其余留着。 */
const rxEsc = t => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NAMED = { black: '#000000', white: '#FFFFFF', red: '#FF0000' };
function svgInk(html) {
  const cnt = {}, re = /\b(?:fill|stroke)="([^"]+)"/gi; let m;
  while ((m = re.exec(html || ''))) { const v = m[1].trim(); if (!v || /^(none|currentcolor|transparent|inherit)$/i.test(v) || v.slice(0, 4) === 'url(') continue; cnt[v] = (cnt[v] || 0) + 1; }
  return Object.entries(cnt).sort((a, b) => b[1] - a[1]);
}
function svgInkColor(html) { const k = svgInk(html); if (!k.length) return ''; const v = k[0][0]; return (NAMED[v.toLowerCase()] || (v[0] === '#' ? v.toUpperCase() : v)); }
function svgRecolor(hex) {
  const I = ED.info; if (!I || !I.svg) return false;
  /* 真正的改写在探针里做（见 edit-probe.js 的 svgColor）：在真 DOM 上改、预览当场就变，
     写回文件的是洗掉编号的克隆体。外面只管发指令，不再自己拼 HTML —— 上一版就是因为
     把带 data-uw-i 的 outerHTML 原样写回文件，把编号烤进了源码（吉吉 2026-09-17 撞上「元素对不上」）。 */
  probe({ __uwEditCmd: 'svgcolor', i: I.i, hex });
  return true;
}
function bindIconGrid(P) { $$('button[data-ic]', P).forEach(b => b.onclick = () => iconSwap(b.dataset.ic, b.dataset.kind)); }
function bindPanel() {
  const P = $('#editPanel');
  bindVariants(P);
  const icq = $('[data-icq]', P);
  if (icq) {
    /* 只换格子，不重画面板：输入框活着，中文输入法才组得成字（跟组件搜索框同一条） */
    const go = () => { IC.q = icq.value; const g = $('.ep-icgrid', P); if (!g) return; g.innerHTML = iconGrid(); bindIconGrid(P); };
    icq.addEventListener('compositionstart', () => { IC.composing = true; });
    icq.addEventListener('compositionend', () => { IC.composing = false; go(); });
    icq.addEventListener('input', () => { if (!IC.composing) go(); });
  }
  bindIconGrid(P);
  bindFill(P);
  $$('[data-sel]', P).forEach(b => b.onclick = () => probe({ __uwEditCmd: 'select', i: +b.dataset.sel }));
  const ta = $('[data-text]', P);
  if (ta) { ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ta.blur(); } }); ta.addEventListener('blur', () => { if (ED.info && ta.value !== ED.info.text) probe({ __uwEditCmd: 'text', i: ED.info.i, text: ta.value, save: true }); }); }
  $$('[data-attr]', P).forEach(inp => inp.addEventListener('change', () => { if (ED.info) probe({ __uwEditCmd: 'attr', i: ED.info.i, name: inp.dataset.attr, value: inp.value === '' ? null : inp.value, save: true }); }));
  $$('select[data-prop]', P).forEach(s => s.addEventListener('change', () => {
    const v = s.value, set = {};
    if (s.dataset.border != null) { set['border-width'] = +v ? v + 'px' : '0'; set['border-style'] = +v ? 'solid' : null; if (+v && !rgb2hex(ED.info.inline['border-color'] || ED.info.cs.borderTopColor)) set['border-color'] = '#CED3D9'; }
    else set[s.dataset.prop] = v === '' ? null : v + (s.dataset.unit || '');
    edStyle(set);
  }));
  $$('input[type=text][data-prop],input[type=number][data-prop]', P).forEach(inp => inp.addEventListener('change', () => {
    const raw = inp.value.trim(); const set = {};
    if (raw === '' || raw === 'auto') set[inp.dataset.prop] = inp.dataset.prop === 'width' || inp.dataset.prop === 'height' ? null : '0';
    else set[inp.dataset.prop] = /^-?[\d.]+$/.test(raw) ? raw + (inp.dataset.unit || 'px') : raw;
    edStyle(set);
  }));
  $$('input[type=range][data-prop]', P).forEach(inp => {
    const num = inp.parentElement.querySelector('[data-opn]');
    const go = v => { v = Math.max(0, Math.min(100, Math.round(+v || 0))); inp.value = v; if (num) num.value = v; edStyle({ [inp.dataset.prop]: v === 100 ? null : String(v * (+inp.dataset.scale || 1)) }); };
    inp.addEventListener('input', () => go(inp.value));
    if (num) { num.addEventListener('change', () => go(num.value)); num.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); num.blur(); } }); }
  });
  $$('.ep-seg button[data-prop]', P).forEach(b => b.onclick = () => {
    if (b.dataset.prop === '__wmode') {
      const I = ED.info, v = b.dataset.v;
      /* 「撑满」在横排的自动布局里光写 width:100% 不管用（flex 项目按 flex-basis 算），要给 flex:1 */
      const rowFlex = I.parentFlex && !/column/.test(I.parentDir || '');
      const set = v === 'auto' ? { width: null, flex: null }
        : v === 'fill' ? (rowFlex ? { width: null, flex: '1 1 auto' } : { width: '100%', flex: null })
        : { width: px(I.cs.width) + 'px', flex: null };
      edStyle(set);
      b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      const wi = $('input[data-prop="width"]', P); if (wi) wi.value = v === 'fix' ? px(I.cs.width) : '';
      return;
    }
    edStyle({ [b.dataset.prop]: b.dataset.v }); b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  });
  $$('.ep-sw button[data-prop]', P).forEach(b => b.onclick = () => {
    if (b.dataset.prop === 'border-color' && !b.dataset.v) {   // 「无描边」：宽度归零、把 style 和颜色一起撤掉，不留半截内联
      edStyle({ 'border-width': '0', 'border-style': null, 'border-color': null });
      b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); const h0 = b.parentElement.querySelector('input'); if (h0) { h0.value = ''; h0.classList.remove('bad'); }
      return;
    }
    if (b.dataset.prop === 'color' && b.dataset.v && ED.info.svg && !ED.info.svg.usesCurrentColor) { svgRecolor(b.dataset.v); return; }
    const set = { [b.dataset.prop]: b.dataset.v || (b.dataset.prop === 'background-color' ? 'transparent' : null) };
    if (b.dataset.prop === 'border-color' && b.dataset.v) { const bw = parseFloat(ED.info.inline['border-width'] || ED.info.cs.borderTopWidth) || 0; if (!bw) { set['border-width'] = '1px'; set['border-style'] = 'solid'; } }
    edStyle(set);
    const wrap = b.parentElement; wrap.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); const hx = wrap.querySelector('input'); if (hx) { hx.value = b.dataset.v; hx.classList.remove('bad'); }
  });
  $$('.ep-sw input[data-hex]', P).forEach(inp => inp.addEventListener('change', () => {
    let v = inp.value.trim().toUpperCase(); if (v && !v.startsWith('#')) v = '#' + v;
    if (v && !/^#([0-9A-F]{3}|[0-9A-F]{6}|[0-9A-F]{8})$/.test(v)) { toast('色值格式不对，像 #E64545这样'); return; }
    inp.classList.toggle('bad', !!v && !FQ_ALL.has(v.length === 4 ? '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3] : v));
    if (inp.dataset.hex === 'color' && v && ED.info.svg && !ED.info.svg.usesCurrentColor) { svgRecolor(v); return; }
    edStyle({ [inp.dataset.hex]: v || null });
    inp.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.v === v));
  }));
}

/* ── 回写 Figma ──────────────────────────────────────
   吉吉 2026-09-17 定的口径：**用户自己给一个 Figma URL，写进那个 page 里**。
   Figma 的 REST 接口只能读不能写，往文件里造节点只有插件那条路 —— 也就是 use_figma。
   所以这里不自己接 Figma，而是把「写进哪儿、按什么规矩写、写完怎么验」拼成一条指令交给 Claude，
   人只用干一件事：贴链接。 */
function parseFigmaUrl(u) {
  u = String(u || '').trim();
  if (!u) return { err: '先把Figma链接贴进来' };
  let m = /figma\.com\/(?:design|file|proto)\/([0-9a-zA-Z]{10,128})(?:\/branch\/([0-9a-zA-Z]{10,128}))?/.exec(u);
  if (!m) return { err: '这不像Figma的链接。要的是figma.com/design/... 那种' };
  const fileKey = m[2] || m[1];                       // 在分支里就写进分支，不是主干
  const branch = !!m[2];
  const n = /[?&]node-id=([0-9]+)[:-]([0-9]+)/.exec(u);
  if (!n) return { err: '链接里没有node-id，说不清写进哪一页。在Figma左边点中那个page，右键Copy link to page' };
  return { fileKey, branch, nodeId: n[1] + ':' + n[2] };
}
/* 回写的规矩写在这儿，不写在提示词里临时编：改口径改这一个函数 */
function toFigmaPrompt(f, widthLabel, width) {
  const abs = (S.project.dir || '') + '/' + S.previewFile;
  const pack = (S.boot && S.boot.packDir) || 'packs/feique';
  const stamp = new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(/\//g, '-');
  return [
    `【把这一页回写进 Figma】目标：文件 ${f.fileKey}${f.branch ? '（这是一个分支，就写进分支，别写主干）' : ''}的节点 ${f.nodeId} —— 用户指定的那个 page，写进它里面。`,
    `源文件：${abs}。先整份读一遍再动手，值以文件为准，别凭印象。按${width}px宽回写（用户选的是「${widthLabel}」档）。`,
    '',
    '按这个顺序做，一步都不许跳：',
    '① 先加载figma-use技能。这是use_figma的强制前置，跳过必踩坑。',
    `② 把页面拆成两类：用了飞鹊类名的（.btn .inp .cb .rd .sw .tab .pg .alert .tag …）和自己写的。`,
    `   飞鹊那些**必须用真组件实例**：importComponentByKeyAsync(key) 拿到组件再createInstance()，key查${pack}/COMPONENT-USAGE.md。`,
    '   🔴 画一个长得像的矩形不算数 —— 前端在Figma里点不开，设计师也改不动，等于白回写。',
    '③ 自己写的那些照样回写成frame / 文本 / 矩形，不许跳过、不许留空占位。',
    `④ **新建一版，不覆盖**：在目标page里量出现有内容的最右边界，往右留200摆一个新frame，命名「${S.previewFile} · ${stamp}」。原来的东西一个都不许动。`,
    '⑤ 图层命名全部做好：容器按它是什么命名（区块·页头 / 卡片·产品 / 按钮·主按钮），不许留Frame 123、Rectangle 5、Group 7这种默认名。',
    `⑥ 回写完**必须**跑自检，不许以「稍后验证」代替：先跑node ${pack}/tools/figma-verify-install.js --node ${f.nodeId}`,
    '   它会打印几个安装片段的路径（当前是4块，每块约12KB —— 一次贴太多会把socket挤断）。**按它打印的顺序一块一块贴进use_figma跑**，',
    '   贴完最后一块核对返回值里match:true，false就是哪块贴走样了，别往下跑。每个Figma文件只用装这一次。',
    '   装好之后，在你的use_figma脚本末尾贴 /tmp/fv-call.js（几百字节）调verify(\'新 frame 的 id\')，把完整报告贴给我，有红的先改完再说交付。',
    '⑦ 最后给我三样：这一版在Figma里的链接；一张清单说明哪些块是真飞鹊组件实例、哪些是自定义块（自定义块在Figma里不可维护，我要知道有哪些）；',
    '   再get_screenshot截一张存进项目的「设计稿」目录。',
  ].join('\n');
}
function openToFigma() {
  if (!S.project || !S.previewFile) return;
  const sel = $('#tfWidth');
  sel.innerHTML = BPS.filter(b => b.kind === 'web').map(b => `<option value="${b.w}">${b.w}${b.note ? ' · ' + b.note : ''}</option>`).join('')
    + `<option value="375">375 · 移动端</option>`;
  sel.value = String(S.width !== 'auto' ? S.width : 1440);        // 当前在看哪档就默认哪档，自适应时按基准 1440
  const inp = $('#tfUrl');
  inp.value = localStorage.getItem('uw.figmaUrl.' + S.project.id) || '';
  $('#tfHint').classList.remove('bad');
  show('#modalToFigma');
  setTimeout(() => inp.focus(), 30);
}
$$('[data-close]').forEach(b => { const t = b.dataset.close; if (t) b.onclick = () => hide('#' + t); });
$('#btnToFigma').onclick = openToFigma;
$('#tfGo').onclick = () => {
  const f = parseFigmaUrl($('#tfUrl').value);
  if (f.err) { const h = $('#tfHint'); h.textContent = f.err; h.classList.add('bad'); return; }
  localStorage.setItem('uw.figmaUrl.' + S.project.id, $('#tfUrl').value.trim());
  const w = +$('#tfWidth').value, b = bpOf(w);
  hide('#modalToFigma');
  send(toFigmaPrompt(f, b ? `${b.w} · 内容区${b.content}` : String(w), w), '回写Figma', `把${S.previewFile}回写进Figma`);
};

/* ── 飞鹊组件栏：像 Figma 的资产面板，拖砖到页面上替换或插入 ─────
   清册来自主进程（packs/feique 的 12 个页面片段 + 14 个控件样板）。卡片是原生 HTML5 拖拽源，
   落进预览 iframe 由探针接住（中间＝替换、边缘＝插入），回一条 drop 消息，这里变成 replace/insert 操作写文件。
   替换时把原元素的文字、链接、图片带过去（吉吉 2026-09-16 定）。 */
const CP = { on: false, list: null, q: '', byFamily: null };
$('#ebComps').onclick = () => setComps(!CP.on);
function setComps(on) {
  CP.on = !!on;
  $('#ebComps').classList.toggle('on', CP.on);
  $('#compPanel').hidden = !CP.on;
  $('#stagePreview').classList.toggle('comps', CP.on);
  if (CP.on) loadComps();
  setTimeout(fitPreview, 30);
}
async function loadComps() {
  if (!CP.list) {
    const r = await uw.editComponents();
    CP.list = (r && r.list) || [];
    CP.byFamily = {}; for (const c of CP.list) if (c.variants) CP.byFamily[c.family] = c.variants;
    if (ED.on) renderPanel();   // 清册到了，选中元素的「组件属性」才画得出来
  }
  if (CP.on) renderComps();
}
function compWidth(c) { const m = /^(\d+)×/.exec(c.size || ''); return m ? +m[1] : (c.group === 'block' ? 1240 : 0); }
function thumbDoc(c) {
  /* 缩略图用 transform 缩放而不是 zoom：zoom 会连带改变百分比与换行，越缩越高、量不准（2026-09-16 踩过）。
     结构：body > .__th（固定 CSS 宽度的 flex 居中容器）> 组件。装载后 fitThumb() 按容器与组件的未缩放尺寸算比例，再平移到正中。
     示意图片换成灰块；不用本机 Roboto（这台机子上各字重全是粗脸）。 */
  const w = compWidth(c);
  const PH = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="#E6ECF2"/></svg>');
  const thumb = c.thumb.replace(/(<img\b[^>]*\bsrc=")[^"]*(")/g, '$1' + PH + '$2');
  const wrapW = w || 320;
  const sysFont = 'body,body *{font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif !important}';
  return `<!doctype html><html><head><meta charset="utf-8"><style>${c.reset || ''}\n${c.css}\nhtml,body{margin:0;background:#fff;overflow:hidden;height:100%}.__th{position:absolute;left:0;top:0;width:${wrapW}px;display:flex;justify-content:${w ? 'flex-start' : 'center'};align-items:flex-start;transform-origin:0 0;visibility:hidden;color:#222}${sysFont}</style></head><body><div class="__th" data-w="${wrapW}" data-block="${w ? 1 : 0}">${thumb}</div></body></html>`;
}
function fitThumb(fr) {
  try {
    const d = fr.contentDocument, wrap = d && d.querySelector('.__th'); if (!wrap || !wrap.firstElementChild) return;
    const W = +wrap.dataset.w || 320, isBlock = wrap.dataset.block === '1';
    const el = wrap.firstElementChild, h = Math.max(1, el.offsetHeight);
    /* 特别高的控件（缺省图 / 抽屉 / 骨架卡）给个高一点的格子，别缩成米粒也别只露个头 */
    if (!isBlock && h > 150 && fr.parentElement) fr.parentElement.style.height = '128px';
    const boxW = fr.clientWidth, boxH = fr.clientHeight;
    let z = Math.min(1, (boxW - 16) / W);                       // 先按宽度装进去
    if (!isBlock) z = Math.min(z, (boxH - 16) / h);              // 控件再按高度缩，缩到下限为止
    z = Math.max(isBlock ? (boxW - 16) / W : (h > 150 ? 0.25 : 0.35), z);
    const dispH = h * z, top = dispH + 16 <= boxH ? (boxH - dispH) / 2 : 8;   // 装得下就居中，装不下就顶对齐露上半截
    const left = isBlock ? (boxW - W * z) / 2 : (boxW - W * z) / 2;
    wrap.style.transform = `scale(${z})`; wrap.style.left = left + 'px'; wrap.style.top = top + 'px'; wrap.style.visibility = 'visible';
    fr.dataset.fit = z.toFixed(2);
  } catch (e) { /* 还没渲染完就算了，缩略图只是看个样子 */ }
}
/* 🔴 中文输入法打字时，每敲一个字母都会触发 input。原来这里是「一敲就把整个面板 innerHTML 重画」，
   输入框连同它正在组字的状态一起被换掉，拼音就被打断了——只能打出字母，出不来汉字
   （吉吉 2026-09-17：「这个输入框不能输入中文」，截图里停在 anniu）。
   两条一起改：① 输入框只建一次，过滤只重画下面的列表 ② 组字期间（composing）先不过滤，等 compositionend。 */
function renderComps() {
  const P = $('#compPanel');
  if (!CP.list) { P.innerHTML = '<div class="cp-none">正在读飞鹊组件清册…</div>'; CP.built = false; return; }
  if (!CP.built || !$('#cpQ')) {
    P.innerHTML = `<div class="cp-head"><input type="text" id="cpQ" placeholder="搜组件：按钮、产品卡、页脚…" value="${esc(CP.q)}"></div><div class="cp-hint">拖到元素中间＝替换（原文字、链接、图带过去）；拖到边缘＝插到前后。</div><div id="cpBody"></div>`;
    CP.built = true;
    const qi = $('#cpQ');
    const go = () => { CP.q = qi.value; renderCompBody(); };
    qi.addEventListener('compositionstart', () => { CP.composing = true; });
    qi.addEventListener('compositionend', () => { CP.composing = false; go(); });
    qi.addEventListener('input', () => { if (!CP.composing) go(); });
  }
  renderCompBody();
}
function renderCompBody() {
  const body = $('#cpBody'); if (!body) return;
  const q = CP.q.trim().toLowerCase();
  const hit = c => !q || (c.name + ' ' + (c.desc || '') + ' ' + c.id).toLowerCase().includes(q);
  const groups = [['control', '控件'], ['block', '页面片段']];
  let h = '';
  let n = 0;
  for (const [g, gn] of groups) {
    const items = CP.list.filter(c => c.group === g && hit(c)); if (!items.length) continue; n += items.length;
    h += `<div class="cp-g">${gn} · ${items.length}</div><div class="cp-list">` + items.map(c => `<div class="cp-card ${c.group}" draggable="true" data-id="${esc(c.id)}" title="${esc(c.name)}${c.desc ? ' · ' + esc(c.desc) : ''}"><div class="cp-thumb"><iframe sandbox="allow-same-origin" tabindex="-1" srcdoc="${esc(thumbDoc(c))}"></iframe></div><div class="cp-meta"><div class="cp-name">${esc(c.name)}</div><div class="cp-desc">${esc(c.desc || c.size || '')}</div></div></div>`).join('') + '</div>';
  }
  if (!n) h += '<div class="cp-none">没有叫这个名字的组件</div>';
  body.innerHTML = h;
  /* 缩略图装不下的（带标题的提示条、三行列表、抽屉）按高度再缩一档，别被裁半截 */
  $$('.cp-thumb iframe', body).forEach(fr => fr.addEventListener('load', () => fitThumb(fr)));
  $$('.cp-card', body).forEach(card => {
    card.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/uw-component', card.dataset.id);
      e.dataTransfer.setData('text/plain', card.dataset.id);
      e.dataTransfer.effectAllowed = 'copy';
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
    card.addEventListener('dblclick', () => {
      /* 双击＝直接替换当前选中（没选中就插到 body 末尾）：不想拖的人的快路 */
      if (!ED.info) return toast('先在页面里选中要换的元素，或把组件拖到页面上');
      edDrop({ component: card.dataset.id, i: ED.info.i, tag: ED.info.tag, mode: 'replace', label: ED.info.label, keep: { text: ED.info.textOnly ? ED.info.text : ED.info.textAll, href: ED.info.firstHref, src: ED.info.firstImg } });
    });
  });
}
function edDrop(d) {
  if (!d || !d.component || d.i == null) return;
  const c = (CP.list || []).find(x => x.id === d.component);
  const op = d.mode === 'replace'
    ? { op: 'replace', i: d.i, tag: d.tag, component: d.component, keep: d.keep || {}, label: d.label }
    : { op: 'insert', i: d.i, tag: d.tag, where: d.mode, component: d.component, label: d.label };
  edApply([op], 'replace', d.scroll);
}
/* 组件属性：元素带哪个飞鹊基类，就给哪几组互斥档 */
function variantSection(I) {
  if (!CP.byFamily) return '';
  const cls = new Set(I.classes || []);
  const fam = Object.keys(CP.byFamily).sort((a, b) => b.length - a.length).find(f => cls.has(f));   // 长的先匹配：bdg-status 先于 bdg
  if (!fam) return '';
  const V = CP.byFamily[fam];
  /* Figma 的做法：一行一个属性，左标签右控件。三档以内用分段控件，多了用下拉——十个档硬塞分段控件就是之前那种丑法 */
  const dims = V.dims.map((d, k) => {
    const cur = d.options.find(([c]) => c && cls.has(c)); const curC = cur ? cur[0] : '';
    const ctl = d.options.length <= 3
      ? `<div class="ep-seg">${d.options.map(([c, n]) => `<button data-var="${k}" data-cls="${esc(c)}" class="${c === curC ? 'on' : ''}">${esc(n)}</button>`).join('')}</div>`
      : `<select class="sel" data-var="${k}">${d.options.map(([c, n]) => `<option value="${esc(c)}" ${c === curC ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
    return `<div class="ep-row"><label>${esc(d.label)}</label>${ctl}</div>`;
  }).join('');
  return `<div class="ep-sec ep-var" data-fam="${esc(fam)}"><div class="ep-t">组件属性 <small>飞鹊 ${esc(fam)}</small></div>${dims}</div>`;
}
function bindVariants(P) {
  const sec = $('.ep-var', P); if (!sec || !ED.info) return;
  const V = CP.byFamily[sec.dataset.fam]; if (!V) return;
  const pick = (k, cls) => {
    const d = V.dims[k]; const add = cls ? [cls] : [];
    const remove = d.options.map(([c]) => c).filter(c => c && c !== cls);
    probe({ __uwEditCmd: 'class', i: ED.info.i, add, remove, save: true });
  };
  $$('button[data-var]', sec).forEach(b => b.onclick = () => { pick(+b.dataset.var, b.dataset.cls); b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); });
  $$('select[data-var]', sec).forEach(sl => sl.addEventListener('change', () => pick(+sl.dataset.var, sl.value)));
}

/* ── 附件：拖进对话区 / ⌘V 粘贴截图 / 点回形针选文件 ────────────
   文件先拷进项目的「附件」目录（Claude 只读得到项目目录里的路径），在输入框上方摆成小卡，
   随下一条消息发出去：正文末尾列出路径，图片让它用 Read 看。发完清空。 */
function isFileDrag(e) { const t = e.dataTransfer && e.dataTransfer.types; if (!t) return false; for (const x of t) if (x === 'Files') return true; return false; }
function renderAttach() {
  const row = $('#attachRow'); row.hidden = !AT.list.length;
  row.innerHTML = AT.list.map((a, k) => `<span class="att" title="${esc(a.abs)}">${a.isImage && a.rel ? `<img class="th" src="uwproj://p/${encodeURIComponent(S.project.id)}/${a.rel.split('/').map(encodeURIComponent).join('/')}?t=${Date.now()}" alt="">` : `<i class="ic">${esc(a.isDir ? 'DIR' : (a.name.split('.').pop() || 'file').slice(0, 4).toUpperCase())}</i>`}<span class="n">${esc(a.name)}</span><button class="x" data-k="${k}" title="去掉">×</button></span>`).join('');
  $$('.att .x', row).forEach(b => b.onclick = () => { AT.list.splice(+b.dataset.k, 1); renderAttach(); });
}
async function addAttachPaths(paths) {
  if (!S.project || !paths.length) return;
  const r = await uw.importFiles({ id: S.project.id, paths });
  for (const f of (r.files || [])) if (!AT.list.some(a => a.abs === f.abs)) AT.list.push(f);
  for (const e of (r.errors || [])) toast(e);
  renderAttach();
  if (r.files && r.files.length) { $('#composer').focus(); refreshFiles(true); }
}
async function addAttachBlob(blob, name) {
  if (!S.project) return;
  const buf = new Uint8Array(await blob.arrayBuffer());
  const r = await uw.importBlob({ id: S.project.id, name, data: buf });
  if (!r.ok) return toast(r.error || '没存下来');
  AT.list.push(r.file); renderAttach(); refreshFiles(true);
}
function pasteName(type) { const ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' })[type] || 'png'; const d = new Date(), p2 = n => String(n).padStart(2, '0'); return `截图${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}.${p2(d.getMinutes())}.${p2(d.getSeconds())}.${ext}`; }
/* 消息里怎么带：路径列出来，图片点名让它 Read。display 只显示原话 + 📎 名字 */
function attachText() {
  if (!AT.list.length) return { text: '', display: '' };
  const lines = AT.list.map(a => `- ${a.abs}${a.isImage ? '（图片，用Read工具直接看）' : a.isDir ? '（文件夹）' : ''}`);
  return { text: `\n\n附件（已在项目目录里）：\n${lines.join('\n')}`, display: ' 📎 ' + AT.list.map(a => a.name).join('、') };
}
/* 拖：整个对话区都是落点。只认文件拖拽，飞鹊组件那种自定义拖拽不归这儿管 */
{
  const sec = $('#chatSec'), mask = $('#dropMask');
  let depth = 0;
  sec.addEventListener('dragenter', e => { if (!isFileDrag(e) || !S.project) return; e.preventDefault(); depth++; mask.hidden = false; });
  sec.addEventListener('dragover', e => { if (!isFileDrag(e) || !S.project) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  sec.addEventListener('dragleave', e => { if (!isFileDrag(e)) return; depth = Math.max(0, depth - 1); if (!depth) mask.hidden = true; });
  sec.addEventListener('drop', async e => {
    if (!isFileDrag(e) || !S.project) return; e.preventDefault(); depth = 0; mask.hidden = true;
    const files = Array.from(e.dataTransfer.files || []);
    const paths = files.map(f => uw.pathForFile(f)).filter(Boolean);
    if (paths.length) await addAttachPaths(paths);
    /* 从浏览器/别的应用拖过来的图没有本机路径，只有数据：当粘贴处理 */
    for (const f of files) if (!uw.pathForFile(f) && f.type.startsWith('image/')) await addAttachBlob(f, f.name || pasteName(f.type));
  });
  /* 粘贴：剪贴板里有图就存成文件，有文字照常进输入框 */
  $('#composer').addEventListener('paste', async e => {
    if (!S.project) return;
    const items = Array.from(e.clipboardData && e.clipboardData.items || []);
    const imgs = items.filter(it => it.kind === 'file' && it.type.startsWith('image/'));
    if (!imgs.length) return;
    e.preventDefault();
    for (const it of imgs) { const f = it.getAsFile(); if (f) await addAttachBlob(f, f.name && !/^image\.(png|jpe?g)$/i.test(f.name) ? f.name : pasteName(f.type)); }
  });
  $('#btnAttach').onclick = async () => { if (!S.project) return; const p = await uw.pickAny('选择要附上的文件或文件夹'); if (p) addAttachPaths([p]); };
  /* 首页输入框：项目还没建，拖进来就把路径写进文字（跟回形针按钮一个做法） */
  const card = $('.composer-card'), hi = $('#homeInput');
  if (card && hi) {
    card.addEventListener('dragover', e => { if (!isFileDrag(e)) return; e.preventDefault(); card.classList.add('dropping'); });
    card.addEventListener('dragleave', () => card.classList.remove('dropping'));
    card.addEventListener('drop', e => { if (!isFileDrag(e)) return; e.preventDefault(); card.classList.remove('dropping'); const ps = Array.from(e.dataTransfer.files || []).map(f => uw.pathForFile(f)).filter(Boolean); if (!ps.length) return toast('这张图没有本机路径，先建项目再拖进对话框'); hi.value = (hi.value ? hi.value + '\n' : '') + ps.map(p => '附件路径：' + p).join('\n'); hi.focus(); });
  }
}

/* ── 更新：启动后查一次 GitHub Releases，有新版顶部出条；点「现在更新」→ 下载 → 换包重开 ──
   不签名做不了静默更新（吉吉 2026-09-16 定：开发者账号先不采购），这一条就是同事那边跟着更新的全部路。 */
const UP = { info: null, busy: false };
function fmtMB(n) { return (n / 1048576).toFixed(0) + ' MB'; }
async function checkUpdate(manual) {
  const r = await uw.checkUpdate();
  const note = $('#setUpdateNote');
  if (!r.ok) { if (manual) toast('没查到：' + (r.error || '网络不通')); if (note) note.textContent = '没查到（' + (r.error || '网络不通') + '）'; return; }
  if (!r.hasUpdate) { if (manual) toast(r.reason ? '已是最新（' + r.reason + '）' : `已是最新版${S.boot.version}`); if (note) note.textContent = r.version ? `最新${r.version}，已是最新` : '已是最新'; return; }
  UP.info = r;
  if (note) note.textContent = `有新版本${r.version}`;
  if (!manual && S.settings.skipVersion === r.version) return;   // 这一版他说过「先不更」，下次再提
  showUpdBar(r);
}
function showUpdBar(r) {
  const bar = $('#updBar'); bar.hidden = false; bar.classList.remove('busy');
  $('#updText').textContent = `UED WorkBuddy ${r.version}可以更新了`;
  $('#updSub').textContent = `当前${r.current} · ${fmtMB(r.size)}`;
  const items = (r.notes || '').split('\n').filter(x => !/^\s*#/.test(x)).map(x => x.replace(/^[-*\s]+/, '').trim()).filter(Boolean);   // 标题行不算内容
  $('#updNotes').textContent = items[0] || ''; $('#updNotes').title = items.join('\n');
  $('#updNotes').hidden = !items.length;
  $('#updProg').hidden = true; $('#updProg i').style.width = '0%';
  $('#updGo').disabled = false; $('#updGo').textContent = '更新'; $('#updLater').hidden = false;
  $('#updLater').textContent = '以后再说'; $('#updPage').hidden = true;
}
/* 「以后再说」在下载中变成「取消」：取消只中断这次下载，已经下好的部分留着，下次接着下。 */
$('#updLater').onclick = () => {
  if (UP.busy) { uw.cancelUpdate(); return; }
  $('#updBar').hidden = true;
  if (UP.info) { S.settings.skipVersion = UP.info.version; uw.saveSettings({ skipVersion: UP.info.version }); }
};
$('#updPage').onclick = () => { if (UP.info && UP.info.page) uw.openExternal(UP.info.page); };
$('#updGo').onclick = () => doUpdate(false);
async function doUpdate(force) {
  if (!UP.info || UP.busy) return;
  /* 有会话在跑就别换：换包要退出应用，正在跑的 Claude 会被切断 */
  const running = [...S.logs.values()].filter(L => L.busy).length;
  if (running && !force) { toast(`有${running}个项目的Claude还在跑，等它们结束再更新（再点一次就强制）`); UP.forceAt = Date.now(); return; }
  UP.busy = true;
  const bar = $('#updBar'), go = $('#updGo'); bar.classList.add('busy'); go.disabled = true;
  /* 下载中「以后再说」变「取消」—— 以前这里是整个藏起来，网络卡住时用户连个能点的都没有 */
  $('#updLater').hidden = false; $('#updLater').textContent = '取消'; $('#updPage').hidden = true;
  const prog = $('#updProg'); prog.hidden = false;
  const off = uw.onUpdateProgress(p => {
    const pct = p.total ? Math.round(p.done / p.total * 100) : 0;
    prog.querySelector('i').style.width = pct + '%';
    go.textContent = p.cached ? '已下载好' : `下载中${pct}%`;
    $('#updSub').textContent = p.cached ? '已下载好，准备换包'
      : `正在下载 ${fmtMB(p.done)} / ${fmtMB(p.total || UP.info.size)}${p.resumed ? '（接着上次的下）' : ''}`;
  });
  const d = await uw.downloadUpdate({ url: UP.info.url, size: UP.info.size });
  off();
  if (!d.ok) {
    /* 失败要说清楚卡在哪、还能怎么办 —— 以前这里只把按钮改成「重试」，用户看不出发生了什么 */
    UP.busy = false; bar.classList.remove('busy'); go.disabled = false;
    go.textContent = /卡住|取消|截断/.test(d.error || '') ? '接着下' : '重试';
    $('#updLater').hidden = false; $('#updLater').textContent = '以后再说';
    $('#updPage').hidden = false;
    $('#updSub').textContent = d.error || '下载失败';
    toast(d.error || '下载失败');
    return;
  }
  go.textContent = '正在重开…'; $('#updSub').textContent = '正在换包，几秒后自动重新打开';
  $('#updLater').hidden = true;   // 换包已经开始了，这时候取消只会换到一半
  const r = await uw.installUpdate({ file: d.file, force: !!force || Date.now() - (UP.forceAt || 0) < 8000 });
  if (!r.ok) { UP.busy = false; bar.classList.remove('busy'); go.disabled = false; go.textContent = '更新'; $('#updLater').hidden = false; $('#updLater').textContent = '以后再说'; $('#updProg').hidden = true; toast(r.busy ? `有${r.busy}个会话还在跑，等它们结束再更新` : (r.error || '没装成')); }
}
$('#btnCheckUpdate').onclick = () => { $('#setUpdateNote').textContent = '正在查…'; checkUpdate(true); };

/* ── 资料库 / 技能与规范：照网页版 UW 那两块搬进客户端 ─────────
   左栏目录、右栏内容。数据全是真值：随包 kbdocs（业务 211 / 方法论 268 / 子 skill 17）+ 飞鹊包（组件表 / 295 图标 / token）。
   这一页只做「翻」和「读」，不做检索排序——那是 Claude 的活；每篇文档都能一键复制成给 Claude 的一句话。 */
const KB = { view: 'libs', lib: 0, tab: null, q: '', doc: null, idx: null, fq: null, loading: false };
const LIBS = [
  { id: 'comps', n: '飞鹊组件库', short: '组件真名、状态、key，图标295个', d: '组件的真实名称、状态数、Figma key都在这里。Web端和移动端是两套，编号不通用，开工前先确认用哪套。', ready: 1 },
  { id: 'biz', n: 'MIC业务知识库', short: '八条业务线的规则与术语', d: '搜索、询盘、交易订单、TM、商机融合、会员成长、运营、广告变现。每条业务线的规则、MIC内部叫法、买家痛点占比。', ready: 1, group: '业务知识' },
  { id: 'method', n: 'MIC项目经验与方法论', short: '做过的项目留下的判断与判据', d: '做过的项目留下的判断：哪些做法有效、哪些地方出过问题、下次该怎么做。也包括交互自查表、复盘方法这些做事的判据。', ready: 1, group: '方法论与判据' },
  { id: 'visual', n: '视觉与交付规范', short: '颜色、字号、间距、圆角与交付文档结构', d: '飞鹊的颜色token、字号阶梯、间距与圆角，以及交付给前端的文档结构、线上与设计稿对比验收的标准。', ready: 1 },
  { id: 'cases', n: '设计案例库', short: '优秀设计案例与视觉参考', d: '优秀设计案例、交互与视觉参考、美学素材。目前还在收集，欢迎提供你认为值得参考的案例。', ready: 0 },
  { id: 'rivals', n: '竞品库', short: '竞品网址与分析方法', d: '竞品网址、分析方法、对比流程。计划先覆盖阿里国际站和几家海外B2B平台。', ready: 0 },
];
/* 技能的人话名与分组（网页版那份）；没列进来的子 skill 归到「其他专项做法」 */
const SKILL_GROUPS = [
  ['设计与出稿', [['交互判断与业务规则', 'MIC-交互', '交互层的判断、业务规则、需求文档反向审视'], ['飞鹊视觉稿', 'figma-feique-first', '用飞鹊真组件出视觉稿，绑定设计变量'], ['运营坑位', 'MIC-运营', '母版加实例的坑位图做法'], ['静态图片改造成组件', 'SVG-figma-feique', '把SVG图片换成可维护的飞鹊组件'], ['飞鹊图标精确调用', 'feique-mobile-icon-lookup', 'Web与移动端两套图标怎么找、怎么调']]],
  ['做Demo与还原', [['设计稿还原成网页', 'figma-to-html-feique', 'Figma稿转成单文件网页，逐值核对'], ['线上页面还原到Figma', 'live-to-figma', '把线上页面测量后重建到Figma'], ['Claude Design稿还原', 'CD-CC-figma', '设计工具生成的稿转到Figma'], ['交互稿转说明文档', 'UX-Figma-MD', '带旁注的交互稿转成结构化文档']]],
  ['检查与验收', [['视觉规范自检', 'MIC-视觉自检', '检查设计稿是否符合飞鹊规范'], ['线上与设计稿对比', 'MIC-验收', '13个维度逐项对比找差异'], ['交付给前端', 'MIC-交付规范', '交付文档结构与行为契约'], ['对外表达', 'MIC-表达', '说人话、主体点名、视觉克制']]],
  ['动效、3D与数据', [['做动画', 'CC-animation', '动画的手艺与判据'], ['直控Blender做3D', 'CC-3D', '3D产出的做法'], ['读Clarity行为数据', 'CC-clarity', '把用户行为数据读成判断'], ['把Claude接进日常工具', 'AI-日常应用', '日常工具里怎么用Claude Code']]],
];
async function kbLoad() {
  if (KB.idx && KB.fq) return;
  KB.loading = true; renderKb();
  const [i, f] = await Promise.all([uw.kbIndex(), uw.kbFeique()]);
  KB.idx = i.ok ? i : { groups: [], error: i.error }; KB.fq = f.ok ? f : { icons: [], web: [], mob: [], colors: [], error: f.error };
  KB.loading = false;
  const n1 = $('#navLibsN'), n2 = $('#navSkillsN'); if (n1) n1.textContent = LIBS.length + (kbGroup('我添加的资料').items.length ? 1 : 0); if (n2) n2.textContent = (kbGroup('专项做法').items.length + kbGroup('我添加的技能').items.length) || '';
  renderKb();
}
function kbGroup(prefix) { return ((KB.idx && KB.idx.groups) || []).find(g => g.title.startsWith(prefix)) || { items: [], n: 0 }; }
function hitQ(q, ...xs) { if (!q) return true; q = q.toLowerCase(); return xs.some(x => String(x == null ? '' : x).toLowerCase().includes(q)); }
function kbGo(view, lib) { KB.view = view; if (lib != null) { KB.lib = lib; KB.tab = null; KB.q = ''; } KB.doc = null; renderKb(); $('#kbMain').scrollTop = 0; }
async function kbOpen(rel) {
  KB.doc = { rel, loading: true }; renderKb();
  const r = await uw.kbRead(rel);
  KB.doc = r.ok ? r : { rel, error: r.error }; renderKb(); $('#kbMain').scrollTop = 0;
}
function renderKb() {
  if (S.view !== 'libs' && S.view !== 'skills') return;
  const side = $('#kbSide'), main = $('#kbMain');
  if (KB.loading || !KB.idx) { side.innerHTML = '<div class="kb-h">资料库</div>'; main.innerHTML = '<div class="kb-ph"><p>正在读随包的知识库…</p></div>'; return; }
  /* 左栏 */
  const addBtn = kind => `<button class="kb-add" data-add="${kind}" title="${kind === 'skill' ? '添加技能或规范文档' : '添加资料'}"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>`;
  if (S.view === 'libs') {
    const mine = kbGroup('我添加的资料').items;
    side.innerHTML = `<div class="kb-h">资料库${addBtn('doc')}</div><input class="kb-q" id="kbSideQ" placeholder="搜全部资料" value="${esc(KB.q && KB.view === 'search' ? KB.q : '')}"><div class="kb-g">资料库</div>` + LIBS.map((l, k) => `<button class="kb-i ${KB.view === 'lib' && KB.lib === k ? 'on' : ''}" data-lib="${k}"><span>${esc(l.n)}</span>${l.ready ? `<span class="n">${libCount(l)}</span>` : '<span class="soon">筹备中</span>'}</button>`).join('')
      + `<div class="kb-g">我添加的</div><button class="kb-i ${KB.view === 'mine' ? 'on' : ''}" data-mine="1"><span>我添加的资料</span><span class="n">${mine.length || ''}</span></button>`;
    $$('button[data-lib]', side).forEach(b => b.onclick = () => kbGo('lib', +b.dataset.lib));
    const mb = $('button[data-mine]', side); if (mb) mb.onclick = () => { KB.view = 'mine'; KB.doc = null; KB.q = ''; renderKb(); };
    const q = $('#kbSideQ'); q.onkeydown = e => { if (e.key === 'Enter' && q.value.trim()) { KB.q = q.value.trim(); KB.view = 'search'; KB.doc = null; renderKb(); } };
  } else {
    const items = kbGroup('专项做法').items, mine = kbGroup('我添加的技能').items;
    side.innerHTML = `<div class="kb-h">技能与规范${addBtn('skill')}</div><div class="kb-g">${items.length + mine.length}项</div>` + SKILL_GROUPS.map(([g, rows]) => `<div class="kb-g">${esc(g)}</div>` + rows.map(([n, code]) => `<button class="kb-i ${KB.doc && KB.doc.rel === 'skill/' + code + '.md' ? 'on' : ''}" data-rel="skill/${esc(code)}.md"><span>${esc(n)}</span></button>`).join('')).join('')
      + (mine.length ? `<div class="kb-g">我添加的</div>` + mine.map(it => `<button class="kb-i ${KB.doc && KB.doc.rel === it.rel ? 'on' : ''}" data-rel="${esc(it.rel)}"><span>${esc(it.id)}</span></button>`).join('') : '');
    $$('button[data-rel]', side).forEach(b => b.onclick = () => kbOpen(b.dataset.rel));
  }
  $$('button[data-add]', side).forEach(b => b.onclick = () => openKbAdd(b.dataset.add));
  /* 右栏 */
  if (KB.doc) { main.innerHTML = renderDoc(KB.doc); bindDoc(main); return; }
  if (S.view === 'skills') { main.innerHTML = renderSkills(); bindKbMain(main); return; }
  if (KB.view === 'search') { main.innerHTML = renderSearch(); bindKbMain(main); return; }
  if (KB.view === 'mine') { main.innerHTML = renderMine(); bindKbMain(main); return; }
  if (KB.view === 'lib') { main.innerHTML = renderLib(LIBS[KB.lib]); bindKbMain(main); return; }
  main.innerHTML = renderLibs(); bindKbMain(main);
}
function libCount(l) {
  if (l.id === 'biz' || l.id === 'method') return kbGroup(l.group).items.length;
  if (l.id === 'comps') return KB.fq.web.length + KB.fq.mob.length;
  if (l.id === 'visual') return KB.fq.colors.length;
  return '';
}
function renderLibs() {
  return `<div class="kb-ph"><h2>全部资料</h2><p>这些是WorkBuddy执行任务时会查阅的资料，跟你终端里那套同源、随应用带着。选一个库就能直接翻，不一定要先建任务；每篇都能一键复制成给Claude的一句话。</p></div>
  <table class="kb-tbl"><thead><tr><th style="width:26%">名称</th><th style="width:10%">状态</th><th style="width:22%">收录</th><th>说明</th></tr></thead><tbody>${LIBS.map((l, k) => `<tr class="row" data-lib="${k}"><td class="nm">${esc(l.n)}</td><td><span class="tag ${l.ready ? '' : 'soon'}">${l.ready ? '已就绪' : '筹备中'}</span></td><td>${l.ready ? esc(String(libCount(l))) + (l.id === 'comps' ? ' 个组件 · ' + KB.fq.icons.length + ' 个图标' : l.id === 'visual' ? ' 个颜色' : ' 份') : '暂无收录'}</td><td>${esc(l.short)}</td></tr>`).join('')}</tbody></table>`;
}
function docTable(items, q) {
  const rows = items.filter(it => hitQ(q, it.id, it.summary));
  return { n: rows.length, html: rows.length ? `<table class="kb-tbl"><thead><tr><th style="width:34%">文档</th><th>说明</th></tr></thead><tbody>${rows.map(it => `<tr class="row" data-rel="${esc(it.rel)}"><td class="nm">${esc(it.id)}</td><td>${esc(it.summary)}</td></tr>`).join('')}</tbody></table>` : '<div class="kb-ph"><p>没有匹配的文档。换个词试试。</p></div>' };
}
function bar(ph, cnt, tabs) {
  return `<div class="kb-bar">${tabs ? `<div class="seg sm" id="kbTabs">${tabs.map(([k, n]) => `<button data-tab="${k}" class="${(KB.tab || tabs[0][0]) === k ? 'on' : ''}">${esc(n)}</button>`).join('')}</div>` : ''}<input id="kbQ" placeholder="${esc(ph)}" value="${esc(KB.q)}"><span class="cnt">${esc(cnt)}</span></div>`;
}
function renderLib(l) {
  const head = `<div class="kb-ph"><h2>${esc(l.n)} <span class="tag ${l.ready ? '' : 'soon'}" style="font-size:12px;vertical-align:3px">${l.ready ? '已就绪' : '筹备中'}</span></h2><p>${esc(l.d)}</p></div>`;
  if (!l.ready) return head + '<div class="kb-ph"><p>这个库还在筹备，暂时没有内容。相关的场景卡仍然可以用，只是查不到本库资料。有素材可以提供给我们。</p></div>';
  if (l.id === 'biz' || l.id === 'method') { const t = docTable(kbGroup(l.group).items, KB.q); return head + bar('搜文档名或说明', `${t.n} / ${kbGroup(l.group).items.length}份`) + t.html; }
  if (l.id === 'comps') {
    const tab = KB.tab || 'web', F = KB.fq;
    const tabs = [['web', `Web端${F.web.length}`], ['mob', `移动端${F.mob.length}`], ['ico', `图标${F.icons.length}`]];
    if (tab === 'ico') { const names = F.icons.filter(n => hitQ(KB.q, n)); return head + bar('搜图标名，比如arrow / search / delete', `${names.length} / ${F.icons.length}个`, tabs) + `<div class="kb-ph"><p>点任意图标复制它的文件名。在Figma里图标名带中文分类前缀，这里显示的是去掉前缀之后的名字。</p></div><div class="kb-icons">${names.map(n => `<button data-copy="${esc(n)}" data-what="图标名"><img src="../packs/feique/icons/${esc(n)}.svg" alt=""><span>${esc(n)}</span></button>`).join('')}</div>`; }
    const src = (tab === 'web' ? F.web : F.mob).filter(c => hitQ(KB.q, c.name, c.defaultVariant, c.note, c.props.join(' ')));
    return head + bar('搜组件名、状态名或说明', `${src.length} / ${(tab === 'web' ? F.web : F.mob).length}个`, tabs) + `<table class="kb-tbl"><thead><tr><th style="width:24%">组件名（Figma里的真名）</th><th style="width:8%">状态数</th><th style="width:22%">属性</th><th style="width:14%">组件key</th><th>要注意的地方</th></tr></thead><tbody>${src.map(c => `<tr><td class="nm">${esc(c.name)}</td><td>${c.variantCount || '—'}</td><td>${esc(c.props.join(' · ') || '—')}</td><td class="mono"><button class="link-btn" data-copy="${esc(c.key || '')}" data-what="组件 key" title="点击复制完整 key">${esc((c.key || '').slice(0, 10))}${c.key ? '…' : ''}</button></td><td>${esc((c.note || '').replace(/[🔴⚠️✅🤖]/g, '').trim())}</td></tr>`).join('')}</tbody></table>`;
  }
  if (l.id === 'visual') {
    const tab = KB.tab || 'col', F = KB.fq;
    const tabs = [['col', `颜色${F.colors.length}`], ['type', '字号与间距'], ['docs', '交付与验收']];
    if (tab === 'col') { const cs = F.colors.filter(c => hitQ(KB.q, c.name, c.hex, c.use)); return head + bar('搜颜色名或色值', `${cs.length}个`, tabs) + `<div class="kb-ph"><p>点色块复制色值。做Figma稿要绑样式，不要直接填色值。</p></div><div class="kb-sw">${cs.map(c => `<button data-copy="${esc(c.hex)}" data-what="色值"><div class="top" style="background:${esc(c.hex)}"></div><div class="bot"><div class="n">${esc(c.name)}</div><div class="h">${esc(c.hex)}${c.use ? ' · ' + esc(c.use) : ''}</div></div></button>`).join('')}</div>`; }
    if (tab === 'type') return head + bar('', '', tabs) + `<div class="kb-grp"><div class="g">Web端字号阶梯</div><div class="kb-ph"><p>正文级最大18，22以上是标题级。禁奇数字号，就近取偶。</p></div><div class="kb-fs">${F.fontSize.map(n => `<div class="row"><b>${n}px</b><span style="font-size:${n}px">飞鹊设计规范Feique</span></div>`).join('')}</div></div><div class="kb-grp"><div class="g">间距</div><div class="kb-ph"><p>4px阶梯，水平间距必须从这几档里选。</p></div><div class="kb-scale">${F.spacing.map(n => `<div><i style="width:${Math.max(n, 2)}px"></i>${n}</div>`).join('')}</div></div><div class="kb-grp"><div class="g">圆角</div><div class="kb-ph"><p>真组件里只有4 / 6 / 8三个值，加胶囊和整圆。</p></div><div class="kb-scale">${F.radius.map(n => `<div><i style="width:24px;height:24px;border-radius:${n}px;background:var(--soft-2);border:1px solid var(--line)"></i>${n}</div>`).join('')}</div></div>`;
    const docs = kbGroup('专项做法').items.filter(it => /视觉自检|交付规范|验收|表达/.test(it.id));
    return head + bar('', `${docs.length}份`, tabs) + docTable(docs, '').html;
  }
  return head;
}
function renderSearch() {
  const all = (KB.idx.groups || []).flatMap(g => g.items.map(it => ({ ...it, group: g.title })));
  const rows = all.filter(it => hitQ(KB.q, it.id, it.summary));
  return `<div class="kb-ph"><h2>搜「${esc(KB.q)}」</h2><p>在全部 ${all.length}份文档的名字和说明里找。要按内容找、还要排个先后，交给 Claude 更合适。</p></div>` + bar('换个词再搜', `${rows.length}份`) + (rows.length ? `<table class="kb-tbl"><thead><tr><th style="width:30%">文档</th><th style="width:14%">库</th><th>说明</th></tr></thead><tbody>${rows.map(it => `<tr class="row" data-rel="${esc(it.rel)}"><td class="nm">${esc(it.id)}</td><td>${esc(it.group.replace(/（.*$/, ''))}</td><td>${esc(it.summary)}</td></tr>`).join('')}</tbody></table>` : '<div class="kb-ph"><p>没有匹配的文档。</p></div>');
}
function renderMine() {
  const items = kbGroup('我添加的资料').items;
  const head = `<div class="kb-ph"><h2>我添加的资料</h2><p>你自己加进来的文档，住在 ~/.uw-desktop/kb/，应用更新不会覆盖；Claude开工时会被告知这些资料的位置。</p></div>`;
  if (!items.length) return head + `<div class="kb-empty"><b>还没有添加过。</b><span>点左上角的 + 加一份：选一个文件、给个网页链接，或直接粘贴一段文字。</span><button class="btn pri sm" data-add="doc">添加资料</button></div>`;
  return head + docTable(items, KB.q).html.replace(/<th>说明<\/th>/, '<th>说明</th><th style="width:60px"></th>').replace(/<tr class="row" data-rel="([^"]+)"><td class="nm">([^<]*)<\/td><td>([^<]*)<\/td><\/tr>/g, '<tr class="row" data-rel="$1"><td class="nm">$2</td><td>$3</td><td><button class="link-btn kb-rm" data-rm="$1">删除</button></td></tr>');
}
/* 添加资料 / 技能：选文件或粘贴文本 */
const KA = { kind: 'doc', mode: 'file', path: '' };
function openKbAdd(kind) {
  KA.kind = kind === 'skill' ? 'skill' : 'doc'; KA.mode = 'file'; KA.path = '';
  const m = $('#modalKbAdd'); m.hidden = false;
  $('#kaTitle').textContent = KA.kind === 'skill' ? '添加技能或规范' : '添加资料';
  $('#kaDesc').textContent = KA.kind === 'skill' ? '一份做法或规范文档（Markdown最好）。加进来后出现在「技能与规范」里，Claude做相关活时会先读它。' : '一份业务文档、PRD、会议纪要都行。加进来后出现在「资料库 › 我添加的资料」，Claude做相关活时会先读它。';
  $('#kaName').value = ''; $('#kaText').value = ''; $('#kaSummary').value = ''; $('#kaPath').textContent = ''; $('#kaUrl').value = '';
  $$('#kaMode button').forEach(b => b.classList.toggle('on', b.dataset.mode === 'file'));
  $('#kaFileRow').hidden = false; $('#kaUrlRow').hidden = true; $('#kaTextRow').hidden = true;
  setTimeout(() => $('#kaName').focus(), 50);
}
$$('#kaMode button').forEach(b => b.onclick = () => { KA.mode = b.dataset.mode; $$('#kaMode button').forEach(x => x.classList.toggle('on', x === b)); $('#kaFileRow').hidden = KA.mode !== 'file'; $('#kaUrlRow').hidden = KA.mode !== 'url'; $('#kaTextRow').hidden = KA.mode !== 'text'; });
$('#kaPick').onclick = async () => { const p = await uw.pickAny('选一份文档'); if (p) { KA.path = p; $('#kaPath').textContent = p; if (!$('#kaName').value.trim()) $('#kaName').value = p.split('/').pop().replace(/\.[^.]+$/, ''); } };
$('#kaSave').onclick = async () => {
  const title = $('#kaName').value.trim(), summary = $('#kaSummary').value.trim();
  if (KA.mode === 'file' && !KA.path) return toast('先选一个文件');
  if (KA.mode === 'text' && !$('#kaText').value.trim()) return toast('内容还是空的');
  if (KA.mode === 'url' && !$('#kaUrl').value.trim()) return toast('先把网址贴进来');
  /* 抓网页要走网络，慢的时候有几秒。按钮上说清在干嘛，别让人以为点没点上 */
  const btn = $('#kaSave'), was = btn.textContent;
  if (KA.mode === 'url') { btn.disabled = true; btn.textContent = '正在抓…'; }
  const r = await uw.kbAdd({ kind: KA.kind, path: KA.mode === 'file' ? KA.path : null, title, text: KA.mode === 'text' ? $('#kaText').value : null, url: KA.mode === 'url' ? $('#kaUrl').value.trim() : null, summary });
  btn.disabled = false; btn.textContent = was;
  if (!r.ok) return toast(r.error || '没加上');
  $('#modalKbAdd').hidden = true; toast(`已添加「${r.entry.id}」`);
  KB.idx = null; await kbLoad(); if (KA.kind === 'doc') { KB.view = 'mine'; KB.doc = null; } else kbOpen(r.entry.rel); renderKb();
};
async function kbRemove(rel) {
  const r = await uw.kbRemove(rel); if (!r.ok) return toast(r.error || '没删掉');
  toast('已删除'); KB.idx = null; KB.doc = null; await kbLoad(); renderKb();
}
function renderSkills() {
  const items = kbGroup('专项做法').items, listed = new Set(SKILL_GROUPS.flatMap(([, r]) => r.map(x => x[1])));
  const rest = items.filter(it => !listed.has(it.id));
  const row = (n, code, d) => { const it = items.find(x => x.id === code); return `<div class="kb-srow" data-rel="skill/${esc(code)}.md"><div><div class="nm">${esc(n)}</div><div class="kb-code">${esc(code)}${it ? '' : ' · 包里没有这份'}</div></div><div class="ds">${esc(d)}</div></div>`; };
  return `<div class="kb-ph"><h2>技能与规范</h2><p>每一项技能是一套做事方法，包含判断标准和检查步骤。建任务时按场景自动调用，不用自己记名字。这一页让你知道现在有哪些能力，点开能看全文。</p></div>` + SKILL_GROUPS.map(([g, rows]) => `<div class="kb-grp"><div class="g">${esc(g)}</div>${rows.map(([n, c, d]) => row(n, c, d)).join('')}</div>`).join('') + (rest.length ? `<div class="kb-grp"><div class="g">其他专项做法</div>${rest.map(it => row(it.id, it.id, it.summary)).join('')}</div>` : '');
}
function bindKbMain(main) {
  $$('tr.row[data-lib]', main).forEach(r => r.onclick = () => kbGo('lib', +r.dataset.lib));
  $$('[data-rel]', main).forEach(r => r.onclick = () => kbOpen(r.dataset.rel));
  $$('[data-copy]', main).forEach(b => b.onclick = e => { e.stopPropagation(); uw.copy(b.dataset.copy); toast(`已复制${b.dataset.what || ''}：${b.dataset.copy}`); });
  $$('[data-rm]', main).forEach(b => b.onclick = e => { e.stopPropagation(); kbRemove(b.dataset.rm); });
  $$('[data-add]', main).forEach(b => b.onclick = () => openKbAdd(b.dataset.add));
  const q = $('#kbQ'); if (q) { q.oninput = () => { KB.q = q.value; const pos = q.selectionStart; renderKb(); const q2 = $('#kbQ'); if (q2) { q2.focus(); q2.setSelectionRange(pos, pos); } }; }
  $$('#kbTabs button', main).forEach(b => b.onclick = () => { KB.tab = b.dataset.tab; KB.q = ''; renderKb(); });
}
/* ── 文档阅读 ── */
function renderDoc(d) {
  const back = `<button class="btn sm" id="kbBack">← 返回</button>`;
  if (d.loading) return `<div class="kb-doc"><div class="top">${back}<span class="path">${esc(d.rel)}</span></div><p class="muted">正在读…</p></div>`;
  if (d.error) return `<div class="kb-doc"><div class="top">${back}<span class="path">${esc(d.rel)}</span></div><p class="muted">读不出来：${esc(d.error)}</p></div>`;
  if (d.tooBig) return `<div class="kb-doc"><div class="top">${back}<span class="path">${esc(d.abs)}</span><button class="btn sm" data-open="${esc(d.abs)}">用系统应用打开</button></div><p class="muted">这份太大（${fmtSize(d.size)}），这里不展开。</p></div>`;
  return `<div class="kb-doc"><div class="top">${back}<span class="path" title="${esc(d.abs)}">${esc(d.rel)}</span><button class="btn sm" data-copy="先读这份文档再动手：${esc(d.abs)}" data-what="给Claude的一句话">复制给Claude</button><button class="btn sm" data-reveal="${esc(d.abs)}">在Finder显示</button>${/^user\//.test(d.rel) ? `<button class="btn sm" data-rm="${esc(d.rel)}">删除</button>` : ''}</div><div class="md">${mdToHtml(d.text)}</div></div>`;
}
function bindDoc(main) {
  const b = $('#kbBack'); if (b) b.onclick = () => { KB.doc = null; renderKb(); };
  $$('[data-copy]', main).forEach(x => x.onclick = () => { uw.copy(x.dataset.copy); toast('已复制' + (x.dataset.what || '') + '，贴到对话里就行'); });
  $$('[data-reveal]', main).forEach(x => x.onclick = () => uw.reveal(x.dataset.reveal));
  $$('[data-open]', main).forEach(x => x.onclick = () => uw.openPath(x.dataset.open));
  $$('[data-rm]', main).forEach(x => x.onclick = () => kbRemove(x.dataset.rm));
  $$('.md a[data-rel]', main).forEach(a => a.onclick = e => { e.preventDefault(); kbOpen(a.dataset.rel); });
  $$('.md a[href^="http"]', main).forEach(a => a.onclick = e => { e.preventDefault(); uw.openExternal(a.getAttribute('href')); });
}
/* 够用的 Markdown 渲染：标题 / 列表 / 代码 / 引用 / 表格 / 链接 / 粗体。知识库是给人读的笔记，不追求完备 */
function mdToHtml(src) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  let out = [], i = 0, fm = null;
  if (lines[0] === '---') { const e = lines.indexOf('---', 1); if (e > 0) { fm = lines.slice(1, e).join('\n'); i = e + 1; } }
  if (fm) out.push(`<div class="fm">${esc(fm)}</div>`);
  const inline = t => esc(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, a, u) => /\.md$/.test(u) && !/^https?:/.test(u) ? `<a href="#" data-rel="${esc(u.replace(/^\.\//, ''))}">${a}</a>` : `<a href="${esc(u)}">${a}</a>`);
  const cur = () => lines[i];
  while (i < lines.length) {
    const l = cur();
    if (/^```/.test(l)) { const buf = []; i++; while (i < lines.length && !/^```/.test(cur())) buf.push(cur()), i++; i++; out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`); continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(l); if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(l)) { out.push('<hr>'); i++; continue; }
    if (/^>/.test(l)) { const buf = []; while (i < lines.length && /^>/.test(cur())) buf.push(cur().replace(/^>\s?/, '')), i++; out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`); continue; }
    if (/^\|/.test(l) && i + 1 < lines.length && /^\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const cells = r => r.replace(/^\||\|$/g, '').split('|').map(c => c.trim()); const head = cells(l); i += 2; const rows = [];
      while (i < lines.length && /^\|/.test(cur())) rows.push(cells(cur())), i++;
      out.push(`<table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`); continue;
    }
    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(l);
    if (li) {
      const ordered = /\d/.test(li[2]); const items = []; const baseIndent = li[1].length;
      while (i < lines.length) { const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(cur()); if (!m) break; if (m[1].length < baseIndent) break; items.push({ ind: m[1].length, t: m[3] }); i++; while (i < lines.length && /^\s{2,}\S/.test(cur()) && !/^(\s*)([-*+]|\d+[.)])\s+/.test(cur())) items[items.length - 1].t += ' ' + cur().trim(), i++; }
      let html = '', depth = 0; const tag = ordered ? 'ol' : 'ul';
      for (const it of items) { const d = Math.min(3, Math.round((it.ind - baseIndent) / 2)); while (depth < d) html += `<${tag}>`, depth++; while (depth > d) html += `</${tag}>`, depth--; html += `<li>${inline(it.t)}</li>`; }
      while (depth > 0) html += `</${tag}>`, depth--;
      out.push(`<${tag}>${html}</${tag}>`); continue;
    }
    if (!l.trim()) { i++; continue; }
    const buf = []; while (i < lines.length && cur().trim() && !/^(#{1,6}\s|```|>|\||\s*([-*+]|\d+[.)])\s)/.test(cur())) buf.push(cur()), i++;
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  return out.join('\n');
}

function toast(t) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; $('#toasts').appendChild(d); setTimeout(() => d.remove(), 3200); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') $$('.mask').forEach(m => m.hidden = true); });

boot().catch(e => { toast('启动出错：' + e.message); console.error(e); });
