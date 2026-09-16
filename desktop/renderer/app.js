'use strict';
/* UED WorkBuddy 桌面版 · 界面逻辑（不依赖框架） */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const S = {
  boot: null, caps: null, settings: null, engine: null,
  role: 'design', view: 'home',
  project: null,          // { id, name, role, scene, files, dir, sessionId }
  logs: new Map(),        // id → { items: [], busy, startedAt, textOpen }
  pendingScene: null, pendingAbility: null,
  tab: 'preview', width: 'auto', zoom: 1, previewFile: null, codeFile: null, contentW: 0,
  figma: null,            // 这个项目动过的 Figma 记录（主进程从工具调用里抓的，不靠模型自觉写）
  timer: null,
};

/* ── 启动 ─────────────────────────────────────────── */
async function boot() {
  S.boot = await uw.boot();
  S.caps = S.boot.caps; S.settings = S.boot.settings; S.engine = S.boot.engine;
  S.role = S.settings.role || 'design';
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
    for (const m of (p.messages || [])) items.push(m.role === 'user' ? { k: 'user', text: m.display || m.text, label: m.label } : { k: 'text', text: m.text, closed: true });
    if (items.length) items.push({ k: 'sys', text: '以上是之前的记录。继续说，会接着同一个会话。' });
    S.logs.set(id, { items, busy: !!p.busy, startedAt: null });
  }
  setView('work');
  $('#wkName').title = String(p.name || ''); $('#wkName').textContent = p.name;
  $('#wkChips').innerHTML = `<span class="chip">${esc((roleOf(p.role) || {}).name || '')}</span><span class="chip">${esc(sceneTitle(p))}</span>${p.sessionId ? '<span class="chip" title="Claude Code会话">会话已接上</span>' : ''}`;
  renderLog(); renderProjects(S.projects || []);
  S.previewFile = null; S.codeFile = null;
  S.figma = p.figma || { changes: [], files: {} };
  await refreshFiles(false);
  /* 这个项目只动过 Figma、没产出网页 → 默认就停在设计稿那页，别让人看一块空白 */
  const hasHtml = (p.files || []).some(f => /\.html?$/i.test(f.rel));
  setTab(figmaTabVisible() && !hasHtml ? 'design' : 'preview');
  updateStatus();
}
function setView(v) {
  S.view = v;
  $('#viewHome').hidden = v !== 'home'; $('#viewWork').hidden = v !== 'work';
  $$('.nav[data-nav]').forEach(b => b.classList.toggle('on', v === 'home'));
  if (v === 'home') { S.project = null; uw.listProjects().then(renderProjects); }
}
$('.nav[data-nav="home"]').onclick = () => setView('home');
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
  const b = $('.wk-body'); const on = b.classList.toggle('solo');
  $('#btnCollapse').textContent = on ? '显示内容区' : '只看对话';
  if (!on) setTimeout(fitPreview, 30);
};

function fmtSize(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? Math.round(n / 1024) + ' KB' : n + ' B'; }
function loadPreview() {
  if (!S.project || !S.previewFile) return;
  const fr = $('#preview');
  S.contentW = 0;   // 上一个页面的宽度不能带到下一个
  fr.src = `uwproj://p/${encodeURIComponent(S.project.id)}/${S.previewFile.split('/').map(encodeURIComponent).join('/')}?t=${Date.now()}`;
  fitPreview();
  fqCheck();
}
/* ── 飞鹊体检：客户端自己的机器门 ──────────────────
   终端里有 Stop 钩子兜底，客户端没有；这里每次预览文件落地就静态扫一遍，
   结果摆在预览栏上，一键喂回给 Claude。不自动替用户发，改不改他定。 */
async function fqCheck(announce) {
  const pill = $('#fqPill'); if (!S.project || !S.previewFile) { pill.hidden = true; return; }
  const r = await uw.checkFile({ id: S.project.id, rel: S.previewFile });
  S.fq = { rel: S.previewFile, ...r };
  pill.hidden = false; pill.className = 'fq-pill ' + (r.badN ? 'bad' : r.n ? 'warn' : 'ok');
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
    + (r.issues.length ? r.issues.map(i => `<div class="fq-i lv-${i.level}"><i></i><span>${esc(i.msg)}</span></div>`).join('') : '<div class="fq-i lv-ok"><i></i><span>字体、字重、色值、组件类名、红按钮数、提示条用法都合规</span></div>')
    + (r.issues.length ? `<div class="fq-f"><span class="muted">静态扫描，只抓机器能判的那几类；像不像还得你看</span><button class="btn sm pri" id="fqFix">让Claude照着改</button></div>` : '');
  m.hidden = false;
  const fix = $('#fqFix'); if (fix) fix.onclick = () => { m.hidden = true; send(fqFixText(r), '飞鹊体检', `按飞鹊体检的${r.n}条改${r.rel}`); };
};
function fqFixText(r) {
  return [`「飞鹊体检」对${r.rel}扫出${r.n}处不合规，逐条改掉，改完自己再对一遍：`, '',
    ...r.issues.map((i, k) => `${k + 1}. ${i.msg}`), '',
    `规则来源：${S.boot.packDir}/DESIGN.md第5、5b节；组件规则从${S.boot.packDir}/docs/css/里对应的文件整段复制（28类组件一类一个文件，清单见同目录INDEX.md），类名保持飞鹊的，不自己写一套。改完在回答里说清每条改成了什么。`].join('\n');
}
/* 宽度和缩放是两回事：宽度决定按多宽的画布渲染（自适应/1240/375），缩放只决定看多大。
   自适应档把用户缩放乘进 fit 系数里；定宽两档用 CSS zoom（它会重排、滚动条才对，transform 不会）。 */
function fitPreview() {
  const w = $('#frameWrap'), fr = $('#preview'), box = $('#fitBox');
  const z = S.zoom || 1;
  if (S.width !== 'auto') {
    fr.style.transform = ''; fr.style.width = ''; fr.style.height = '';
    box.style.width = ''; box.style.height = ''; box.style.zoom = z === 1 ? '' : String(z);
    w.classList.remove('fit');
    centerOrPin(w, box);
    return;
  }
  box.style.zoom = '';
  const pane = w.clientWidth - 32, ph = w.clientHeight - 32;
  /* 🔴 base 曾写死 1240，页面宽过它就被 iframe 裁掉（1400px 的产品列表页右边整条栏看不见）。
     现在用协议层探针报上来的真实内容宽度，封顶 2560 防止某个溢出元素把整页缩成米粒。 */
  const base = Math.min(2560, Math.max(1240, S.contentW || 0));
  const scale = Math.min(1, pane / base) * z;
  w.classList.add('fit');
  box.style.width = Math.round(base * scale) + 'px'; box.style.height = ph + 'px';
  fr.style.width = base + 'px'; fr.style.height = Math.round(ph / scale) + 'px';
  fr.style.transform = `scale(${scale})`;
  centerOrPin(w, box);
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
  const fr = $('#preview');
  if (!e.data || e.data.__uwFit !== 1 || !fr || e.source !== fr.contentWindow) return;
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
  if (t === 'code') loadCode();
  if (t === 'design') renderDesign();
}
$$('#stageTabs button').forEach(b => b.onclick = () => setTab(b.dataset.tab));
$('#previewFile').onchange = e => { S.previewFile = e.target.value; loadPreview(); };
$('#codeFile').onchange = e => { S.codeFile = e.target.value; loadCode(); };
$$('#widthSeg button').forEach(b => b.onclick = () => { S.width = b.dataset.w; $$('#widthSeg button').forEach(x => x.classList.toggle('on', x === b)); const w = $('#frameWrap'); w.className = 'frame-wrap' + (S.width === 'auto' ? '' : ' w' + S.width); fitPreview(); });
$('#btnRefresh').onclick = () => { loadPreview(); refreshFiles(true); };
$('#btnOpenExt').onclick = () => { if (S.project && S.previewFile) uw.openPath(S.project.dir + '/' + S.previewFile); };
$('#btnFolder').onclick = () => S.project && uw.openPath(S.project.dir);
$('#btnTerminal').onclick = async () => { if (!S.project) return; await uw.openTerminal(S.project.id); toast('已在系统终端里打开这个项目的Claude Code会话'); };

/* ── 对话与事件流 ─────────────────────────────────── */
function log() { return S.project ? S.logs.get(S.project.id) : null; }
async function send(text, label, display) {
  if (!S.project) return;
  const L = log();
  if (L.busy) { toast('上一条还在跑，先等它结束或点停止。'); return; }
  const r = await uw.send({ id: S.project.id, text, label: label || null, display: display || null });
  if (!r.ok) { toast(r.message || '发不出去'); return; }
  L.items.push({ k: 'user', text: display || text, label }); L.busy = true; L.startedAt = Date.now(); L.textOpen = false;
  if (label !== '飞鹊体检·自动') L.autoFixed = false;
  renderLog(); updateStatus(); renderProjects(S.projects || []);
}
$('#btnSend').onclick = () => { const t = $('#composer'); const v = t.value.trim(); if (!v) return; t.value = ''; autoGrow(t); send(v); };
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
      if (ev.resumed) it.push({ k: 'sys', text: '后台任务有结果回来了，Claude接着往下做（不用你再发消息）。' });
      if (S.project && S.project.id === id) setAct(ev.resumed ? '后台任务回来了，接着做…' : '正在理解你的要求…');
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
    case 'user': d.className = 'msg-user'; d.innerHTML = (x.label ? `<span class="lbl">${esc(x.label)}</span>` : '') + esc(x.text.length > 1200 ? x.text.slice(0, 1200) + '\n…（已折叠，完整内容在项目的 需求输入.md）' : x.text); break;
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
  const L = log(); const st = $('#chatStatus');
  if (!L || !L.busy) { st.hidden = true; if (S.timer) { clearInterval(S.timer); S.timer = null; } $('#btnSend').disabled = false; $('#stageAct').hidden = true; if (L) L.act = null; renderLive(); return; }
  st.hidden = false; $('#btnSend').disabled = true;
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
function toast(t) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; $('#toasts').appendChild(d); setTimeout(() => d.remove(), 3200); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') $$('.mask').forEach(m => m.hidden = true); });

boot().catch(e => { toast('启动出错：' + e.message); console.error(e); });
