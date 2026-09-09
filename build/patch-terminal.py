#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""往 WorkBuddy 页面加「把任务单接力到终端」这一层。就地改 index.html。

两条路（桥 1.3.0 起，见 bridge/uw-terminal.js）：
  external → 桥写一个自删的 .command，用 open -a 交给 iTerm / 终端
  builtin  → 桥起 node-pty，页面用 xterm.js 在右侧抽屉里跑同一个 Claude Code

🔴 跟 patch-wizard.py 的先后：**这个先跑**。向导的收尾按钮调的是这里提供的
   window.wbHandoff，反过来跑虽然运行时也能对上（都是点击时才调），
   但装配顺序写死一个方向，省得以后有人改成同步调用踩坑。

🔴 幂等：BEGIN/END 之间先删再插。原来的 patch-wizard.py 是纯 append
   （写 wizard.html 时无所谓，因为每次都从干净的 index.html 重新生成），
   改成就地写 index.html 之后，不幂等就是跑两次注入两遍、const 重复声明整页 JS 全废。

class 一律 uwt- 前缀。2026-09-08 那次「错位」的真因是 class 撞名（向导的 .sw 撞了
WorkBuddy 自己的开关组件），判据是：往成品页叠一层，class 必须带唯一前缀，
绝不靠选择器特异性打架。下面 collision_gate() 机器拦。
"""
import os, re, sys, subprocess, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PAGE = os.path.join(ROOT, 'index.html')

CSS_B, CSS_E = '/* ==WB-TERM-CSS:BEGIN== */', '/* ==WB-TERM-CSS:END== */'
JS_B,  JS_E  = '/* ==WB-TERM-JS:BEGIN== */',  '/* ==WB-TERM-JS:END== */'
DOM_B, DOM_E = '<!-- ==WB-TERM-DOM:BEGIN== -->', '<!-- ==WB-TERM-DOM:END== -->'

# ══════════════════════════════════════════════════════════════
#  CSS
# ══════════════════════════════════════════════════════════════
CSS = r'''
/* ═══ 接力到终端 · 色值与圆角跟向导层同一套飞鹊 SOT ═══
   .uwt-mask / .uwt-drawer 都挂 <body> 下、互不为后代，所以两个都要列 ——
   2026-09-08 栽过：.wz-peek 挂在 body 下拿不到 .wizmask 上的变量，
   var(--box-r) 静默失效成 0px，而圆角门查字面量查不出来。 */
.uwt-mask,.uwt-drawer{
  --line:#DAE0E6; --line-2:#E6ECF2;
  --ink:#222; --ink-2:#555; --ink-3:#888;
  --ctl:#CED3D9; --dark:#222;
  --ctl-r:4px;         /* 控件级 · 选项卡片 / 按钮 / chip */
  --box-r:8px;         /* 容器级 · 模态 / 抽屉 / 代码块 */
}

/* ── 选择界面 ─────────────────────────────────── */
.uwt-mask{position:fixed;inset:0;z-index:240;background:rgba(26,26,26,.34);
  display:none;align-items:center;justify-content:center;padding:28px}
.uwt-mask.uwt-on{display:flex}
.uwt-box{width:min(560px,100%);background:#fff;border-radius:var(--box-r);
  box-shadow:0 12px 40px rgba(0,0,0,.16);overflow:hidden;
  font:14px/1.6 Roboto,-apple-system,"PingFang SC",sans-serif;color:var(--ink)}
.uwt-hd{padding:20px 22px 4px}
.uwt-hd h3{margin:0;font-size:18px;font-weight:500;color:var(--ink)}
.uwt-hd p{margin:6px 0 0;font-size:13px;color:var(--ink-3)}
.uwt-opts{padding:14px 22px 4px;display:flex;flex-direction:column;gap:8px}
.uwt-opt{display:flex;gap:12px;align-items:flex-start;width:100%;text-align:left;
  padding:13px 14px;border:1px solid var(--ctl);border-radius:var(--ctl-r);
  background:#fff;cursor:pointer;font:inherit;color:inherit;transition:border-color .12s,background .12s}
.uwt-opt:hover:not(:disabled){border-color:var(--dark);background:#FAFAFA}
.uwt-opt:disabled{cursor:not-allowed;border-color:var(--line-2);background:#FAFAFA}
.uwt-opt:disabled .uwt-on1,.uwt-opt:disabled .uwt-on2{color:var(--ink-3)}
.uwt-oi{flex:0 0 auto;width:18px;height:18px;margin-top:2px;color:var(--ink-2)}
.uwt-opt:disabled .uwt-oi{color:#B3B3B3}
.uwt-ot{flex:1 1 auto;min-width:0}
.uwt-on1{display:flex;align-items:center;gap:7px;font-size:14px;font-weight:500;color:var(--ink)}
.uwt-on2{margin:3px 0 0;font-size:13px;color:var(--ink-2)}
.uwt-on3{margin:3px 0 0;font-size:12px;color:var(--ink-3)}
.uwt-rec{flex:0 0 auto;font-size:11px;font-weight:400;padding:1px 6px;border-radius:var(--ctl-r);
  background:#F0F1F2;color:var(--ink-2)}
.uwt-ft{display:flex;align-items:center;gap:8px;padding:14px 22px 20px}
.uwt-note{flex:1 1 auto;min-width:0;font-size:12px;color:var(--ink-3)}
.uwt-btn{padding:8px 15px;border:1px solid var(--ctl);border-radius:var(--ctl-r);background:#fff;
  cursor:pointer;font:14px/1.4 inherit;color:var(--ink-2)}
.uwt-btn:hover{border-color:var(--dark);color:var(--ink)}
.uwt-btn.uwt-pri{background:var(--dark);border-color:var(--dark);color:#fff}

/* ── 终端抽屉 ─────────────────────────────────── */
.uwt-drawer{position:fixed;top:0;right:0;bottom:0;z-index:250;
  width:min(58vw,980px);min-width:min(100vw,560px);
  background:#1A1A1A;box-shadow:-8px 0 32px rgba(0,0,0,.28);
  display:none;flex-direction:column;
  font:13px/1.6 Roboto,-apple-system,"PingFang SC",sans-serif}
.uwt-drawer.uwt-on{display:flex}
.uwt-dhd{flex:0 0 auto;display:flex;align-items:center;gap:10px;
  padding:11px 14px;background:#222;border-bottom:1px solid #333;color:#EDEDED}
.uwt-dot{flex:0 0 auto;width:8px;height:8px;border-radius:50%;background:#4B9E5F}
.uwt-dot.uwt-run{background:#E6A23C;animation:uwt-pulse 1.1s ease-in-out infinite}
.uwt-dot.uwt-dead{background:#777}
@keyframes uwt-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.uwt-dt{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-size:13px;font-weight:500}
.uwt-dsub{flex:0 0 auto;font-size:11px;color:#8C8C8C;max-width:38%;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.uwt-dbtn{flex:0 0 auto;padding:4px 9px;border:1px solid #3A3A3A;border-radius:var(--ctl-r);
  background:transparent;color:#BDBDBD;cursor:pointer;font:12px/1.4 inherit}
.uwt-dbtn:hover{border-color:#5A5A5A;color:#fff}
.uwt-dbody{flex:1 1 auto;min-height:0;position:relative;padding:8px 4px 8px 10px;background:#1A1A1A}
.uwt-xt{position:absolute;inset:8px 4px 8px 10px}
.uwt-dtip{flex:0 0 auto;padding:8px 14px;background:#222;border-top:1px solid #333;
  color:#8C8C8C;font-size:11px;display:flex;align-items:center;gap:10px}
.uwt-dtip b{color:#BDBDBD;font-weight:400}
.uwt-boot{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  color:#8C8C8C;font-size:13px;text-align:center;padding:24px;line-height:1.8}

/* 手机上抽屉占满，终端字号调小一档，不然 80 列放不下 */
@media (max-width:760px){
  .uwt-drawer{width:100vw;min-width:0}
  .uwt-box{width:100%}
  .uwt-dsub{display:none}
}
'''

# ══════════════════════════════════════════════════════════════
#  DOM
# ══════════════════════════════════════════════════════════════
DOM = '''
<div class="uwt-mask" id="uwtMask"><div class="uwt-box" id="uwtBox"></div></div>
<div class="uwt-drawer" id="uwtDrawer">
  <div class="uwt-dhd">
    <span class="uwt-dot" id="uwtDot"></span>
    <span class="uwt-dt" id="uwtDt">终端</span>
    <span class="uwt-dsub" id="uwtDsub"></span>
    <button class="uwt-dbtn" id="uwtPaste" onclick="uwtPasteTask()">粘任务单</button>
    <button class="uwt-dbtn" onclick="uwtHide()">收起</button>
    <button class="uwt-dbtn" onclick="uwtKill()">结束</button>
  </div>
  <div class="uwt-dbody" id="uwtBody">
    <div class="uwt-xt" id="uwtXt"></div>
    <div class="uwt-boot" id="uwtBoot">正在起终端…</div>
  </div>
  <div class="uwt-dtip">
    <span id="uwtTip">跟你自己在终端里敲 <b>claude</b> 是同一个东西：工具、MCP、钩子、技能全在。</span>
  </div>
</div>
'''

# ══════════════════════════════════════════════════════════════
#  JS
# ══════════════════════════════════════════════════════════════
JS = r'''
/* ══════════════════════════════════════════════════════════
   把任务单接力到终端 · 两条路
   —— 跟页面内问答（/v1/chat/completions）不是一回事：那条路的 Claude 关了全部工具、
      不加载 MCP、不读个人设置，只会读题回答；这两条路拉起的是完整的 Claude Code。
      所以选择界面里必须把这个差别说出来，别让人以为只是「换个地方回答」。
   ══════════════════════════════════════════════════════════ */
var UWT = { ws:null, term:null, fit:null, loaded:false, sid:null, dir:null,
            payload:null, alive:false, ro:null };

function uwtBridge(){ return window.wbBridge || null; }
/* 两条路各自能不能用。别把「桥没装」和「桥旧了」混成一句话 —— 同事要据此知道该干什么。 */
function uwtCan(){
  var B = uwtBridge();
  if(!B || !B.ok || !B.info) return { external:false, builtin:false,
    why:'要先把你电脑上的Claude Code接上（设置里有一行安装命令）' };
  var t = B.info.terminal;
  if(!t) return { external:false, builtin:false, why:'桥的版本太旧，重跑一次安装命令就有这个功能' };
  return { external:!!t.external, builtin:!!t.ok, why:t.reason || '', root:t.workRoot || '' };
}
function uwtIcon(n){
  var P = {
    ext:'<path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h11A1.5 1.5 0 0 1 16 3.5v11A1.5 1.5 0 0 1 14.5 16h-11A1.5 1.5 0 0 1 2 14.5v-11Zm1.5-.5a.5.5 0 0 0-.5.5V5h12V3.5a.5.5 0 0 0-.5-.5h-11ZM3 6v8.5a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5V6H3Zm2 2.5 2 2-2 2-.7-.7L5.6 10.5 4.3 9.2 5 8.5Zm3.5 3.5h4v1h-4v-1Z" fill="currentColor"/>',
    tab:'<path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h11A1.5 1.5 0 0 1 16 4.5v9A1.5 1.5 0 0 1 14.5 15h-11A1.5 1.5 0 0 1 2 13.5v-9ZM9 4v10h5.5a.5.5 0 0 0 .5-.5v-9a.5.5 0 0 0-.5-.5H9ZM3.5 4a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5H8V4H3.5Zm1 2.5 1.5 1.5-1.5 1.5-.7-.7L4.9 8 3.8 7.2 4.5 6.5Z" fill="currentColor"/>',
    chat:'<path d="M8 2c3.6 0 6.5 2.4 6.5 5.4 0 3-2.9 5.4-6.5 5.4-.7 0-1.4-.1-2-.3L3.2 14a.4.4 0 0 1-.6-.4l.5-2.2C2.1 10.4 1.5 9 1.5 7.4 1.5 4.4 4.4 2 8 2Zm0 1C5 3 2.5 5 2.5 7.4c0 1.3.6 2.5 1.6 3.4l.3.2-.3 1.4 1.6-.7.3.1c.6.2 1.3.3 2 .3 3 0 5.5-2 5.5-4.4S11 3 8 3Z" fill="currentColor"/>',
    back:'<path d="M8 2a6 6 0 1 1-5.9 7.1l1-.2A5 5 0 1 0 8 3a5 5 0 0 0-3.9 1.9h2v1H2.5V2.6h1v1.6A6 6 0 0 1 8 2Zm.5 3v3.3l2.4 1.4-.5.9-2.9-1.7V5h1Z" fill="currentColor"/>'
  };
  return '<svg class="uwt-oi" viewBox="0 0 16 16" fill="none" aria-hidden="true">'+(P[n]||'')+'</svg>';
}

/* ── 选择界面 ─────────────────────────────────────────
   文案形式参考 foder Studio：每条给「名字 + 在哪执行 + 一句代价」。
   foder 把系统终端设成默认、面板内终端排第二 —— 我们同样把系统终端排第一，
   因为页面内终端是桥的子进程：桥重启（比如重跑安装命令）会把正在跑的活带走。 */
window.wbHandoff = function(payload){
  UWT.payload = payload || {};
  var c = uwtCan(), live = null;
  uwtSessions().then(function(list){
    live = (list && list.length) ? list[0] : null;
    uwtRenderChooser(c, live);
  }, function(){ uwtRenderChooser(c, null); });
  document.getElementById('uwtMask').classList.add('uwt-on');
};
function uwtRenderChooser(c, live){
  var p = UWT.payload || {}, H = [];
  H.push('<div class="uwt-hd"><h3>这份任务单交给谁做？</h3>'
    + '<p>' + uwtEsc(p.card || '任务') + (p.chars ? ' · 已经拼好 ' + p.chars + ' 字' : '') + '</p></div>');
  H.push('<div class="uwt-opts">');

  if(live){
    H.push(uwtOpt('back', '接回正在跑的那个终端', '「' + uwtEsc(live.title || '终端') + '」还开着'
      + (live.busy ? ' · 正在干活' : ''), '这次的任务单会粘进去，不新开一个', false, "uwtGo('attach')", ''));
  }
  H.push(uwtOpt('ext', '打开系统终端', '在iTerm / 终端里开一个Claude Code',
    '完整能力 · 关掉这个页面也不影响它', !c.external,
    "uwtGo('external')", live ? '' : '推荐'));
  H.push(uwtOpt('tab', '在这个页面里开终端', '右边拉出一个抽屉，跑的是同一个Claude Code',
    '不用切窗口 · 但桥重启会把它带走，长任务用上面那条', !c.builtin, "uwtGo('builtin')", ''));
  H.push(uwtOpt('chat', '不开终端，就让WorkBuddy答', '在这个页面里直接回答，用知识库检索到的资料',
    '快 · 但它没有工具，写不了文件、出不了稿', false, 'uwtAskHere()', ''));
  H.push('</div>');

  var note = (!c.external && !c.builtin) ? uwtEsc(c.why)
           : (!c.builtin && c.why) ? uwtEsc(c.why)
           : (c.root ? '任务单会落到 ' + uwtEsc(c.root) + '/' : '');
  H.push('<div class="uwt-ft"><span class="uwt-note">' + note + '</span>'
    + '<button class="uwt-btn" onclick="uwtCopyTask()">复制任务单</button>'
    + '<button class="uwt-btn" onclick="uwtCloseChooser()">取消</button></div>');
  document.getElementById('uwtBox').innerHTML = H.join('');
}
function uwtOpt(icon, t1, t2, t3, dis, onclick, rec){
  return '<button class="uwt-opt" ' + (dis ? 'disabled' : 'onclick="' + onclick + '"') + '>'
    + uwtIcon(icon)
    + '<span class="uwt-ot"><span class="uwt-on1">' + uwtEsc(t1)
    + (rec ? '<span class="uwt-rec">' + rec + '</span>' : '') + '</span>'
    + '<p class="uwt-on2">' + uwtEsc(t2) + '</p>'
    + '<p class="uwt-on3">' + uwtEsc(t3) + '</p></span></button>';
}
function uwtEsc(s){ return String(s==null?'':s).replace(/[&<>"]/g, function(c){
  return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; }); }
function uwtCloseChooser(){ document.getElementById('uwtMask').classList.remove('uwt-on'); }

/* 「就让 WorkBuddy 答」= 走原来那条页面内问答。向导自己有 wzAsk，别在这儿重复一份。 */
function uwtAskHere(){
  uwtCloseChooser();
  if(typeof window.wzAsk === 'function') window.wzAsk();
  else if(window.wbRun && UWT.payload && UWT.payload.prompt) window.wbRun(UWT.payload.prompt);
}
function uwtCopyTask(){
  var t = (UWT.payload && UWT.payload.prompt) || '';
  if(!t) return;
  if(navigator.clipboard) navigator.clipboard.writeText(t).then(function(){
    if(window.fqToast) fqToast('任务单已复制 ' + t.length + ' 字');
  }, function(){ if(window.fqToast) fqToast('浏览器拦了自动复制，用「复制给Claude Code」那个按钮'); });
}

/* ── 打到桥上 ───────────────────────────────────────── */
function uwtSessions(){
  var B = uwtBridge();
  if(!B || !B.ok) return Promise.resolve([]);
  return fetch(B.url + '/terminal/sessions', { cache:'no-store' })
    .then(function(r){ return r.json(); })
    .then(function(j){ return (j && j.sessions) || []; })
    .catch(function(){ return []; });
}
function uwtGo(method){
  var B = uwtBridge(), p = UWT.payload || {};
  if(!B || !B.ok){ if(window.fqToast) fqToast('没连上你电脑上的Claude Code'); return; }
  uwtCloseChooser();

  if(method === 'attach'){
    uwtSessions().then(function(list){
      if(!list.length){ if(window.fqToast) fqToast('那个终端已经结束了，重新选一次'); return; }
      fetch(B.url + '/terminal/attach', { method:'POST',
        headers:{ 'content-type':'application/json' },
        body: JSON.stringify({ sessionId: list[0].id }) })
        .then(function(r){ return r.json(); })
        .then(function(j){ if(j && j.ok) uwtOpenDrawer(j, true); else uwtFail(j); });
    });
    return;
  }

  var body = {
    method: method,
    task: p.task || p.card || '任务',
    card: p.card || '', scene: p.scene || '',
    prompt: p.prompt || '', docs: p.docs || [], out: p.out || [],
    skills: p.skills || [], file: p.file || ''
  };
  if(method === 'builtin'){ body.cols = 100; body.rows = 30; }
  if(window.fqToast) fqToast(method === 'external' ? '正在打开终端…' : '正在起终端…');

  fetch(B.url + '/launch', { method:'POST', headers:{ 'content-type':'application/json' },
                             body: JSON.stringify(body) })
    .then(function(r){ return r.json(); })
    .then(function(j){
      if(!j || (!j.ok && !j.dir)) return uwtFail(j);
      if(method === 'builtin'){ if(j.ok) uwtOpenDrawer(j, false); else uwtFail(j); return; }
      /* 系统终端：桥已经把窗口开出来了，页面只负责说清去哪儿看 */
      if(j.ok) uwtDone(j);
      else uwtFail(j, j.manual);
    })
    .catch(function(e){ uwtFail({ error:{ message: e && e.message || '连不上桥' } }); });
}
function uwtDone(j){
  var where = j.terminal ? ('已经在 ' + j.terminal + ' 里开好了') : '已经开好了';
  if(window.fqToast) fqToast(where + ' · 任务单在 ' + (j.rel || j.dir));
}
function uwtFail(j, manual){
  var m = (j && j.error && j.error.message) || '没能拉起终端';
  if(window.fqToast) fqToast(manual ? (m + '。自己开终端敲：' + manual) : m);
}

/* ── 页面内终端 ─────────────────────────────────────
   xterm.js 自托管在 vendor/xterm/，不走 cdnjs：
   公司网络可能拦外部 CDN，而这会是页面唯一的外部依赖来源，拦了整个终端就没了。
   点了才加载（289KB），别拖首屏。 */
function uwtLoadXterm(){
  if(UWT.loaded) return Promise.resolve(true);
  return new Promise(function(res){
    var base = 'vendor/xterm/';
    var css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = base + 'xterm.css';
    document.head.appendChild(css);
    var s = document.createElement('script');
    s.src = base + 'xterm.js';
    s.onerror = function(){ res(false); };
    s.onload = function(){
      var f = document.createElement('script');
      f.src = base + 'addon-fit.js';
      f.onerror = function(){ res(false); };
      f.onload = function(){ UWT.loaded = true; res(true); };
      document.head.appendChild(f);
    };
    document.head.appendChild(s);
  });
}
function uwtOpenDrawer(j, isAttach){
  document.getElementById('uwtDrawer').classList.add('uwt-on');
  document.getElementById('uwtBoot').hidden = false;
  document.getElementById('uwtBoot').textContent = '正在起终端…';
  UWT.dir = j.rel || j.dir || '';
  uwtHead((UWT.payload && UWT.payload.card) || '终端', UWT.dir, null);
  uwtLoadXterm().then(function(ok){
    if(!ok){
      document.getElementById('uwtBoot').textContent =
        '终端界面没加载出来（vendor/xterm/ 取不到）。改用「打开系统终端」那条路。';
      return;
    }
    uwtMakeTerm();
    uwtConnect(j, isAttach);
  });
}
function uwtMakeTerm(){
  if(UWT.term) return;
  var narrow = window.matchMedia && window.matchMedia('(max-width:760px)').matches;
  UWT.term = new window.Terminal({
    fontSize: narrow ? 11 : 13,
    fontFamily: 'SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace',
    lineHeight: 1.25, cursorBlink: true, scrollback: 5000,
    /* 底色跟抽屉一致，不然滚到底会露出 xterm 自己的黑 */
    theme: { background:'#1A1A1A', foreground:'#EDEDED', cursor:'#EDEDED',
             selectionBackground:'rgba(255,255,255,.22)' }
  });
  UWT.fit = new window.FitAddon.FitAddon();
  UWT.term.loadAddon(UWT.fit);
  UWT.term.open(document.getElementById('uwtXt'));
  /* 抽屉宽度变了（转屏 / 缩窗口）要重算列数，不然 CC 的框线会断 */
  if(window.ResizeObserver){
    UWT.ro = new ResizeObserver(function(){ uwtFit(); });
    UWT.ro.observe(document.getElementById('uwtBody'));
  } else window.addEventListener('resize', uwtFit);
}
function uwtFit(){
  if(!UWT.fit || !UWT.term) return;
  try { UWT.fit.fit(); } catch(e){ return; }
  if(UWT.ws && UWT.ws.readyState === 1)
    UWT.ws.send(JSON.stringify({ type:'resize', cols:UWT.term.cols, rows:UWT.term.rows }));
}
function uwtConnect(j, isAttach){
  var port = j.port || 17331;
  var ws;
  try { ws = new WebSocket('ws://127.0.0.1:' + port + j.wsPath); }
  catch(e){ document.getElementById('uwtBoot').textContent = '连不上本机终端：' + e.message; return; }
  UWT.ws = ws;
  ws.onopen = function(){ uwtFit(); };
  ws.onmessage = function(ev){
    var d; try { d = JSON.parse(ev.data); } catch(e){ return; }
    if(d.type === 'ready'){
      UWT.sid = d.sessionId; UWT.alive = true;
      UWT.dir = d.rel || UWT.dir;      /* 用子目录名不用绝对路径 —— 标题栏只有 38% 宽 */
      document.getElementById('uwtBoot').hidden = true;
      uwtHead(d.title || '终端', UWT.dir, d.busy);
      uwtFit();
      if(!d.replay) uwtFirstRunHint();
    } else if(d.type === 'output'){
      UWT.term.write(d.data);
    } else if(d.type === 'title'){
      uwtHead(d.title, UWT.dir, d.busy);
    } else if(d.type === 'exit'){
      UWT.alive = false;
      uwtHead(null, UWT.dir, 'dead');
      UWT.term.write('\r\n\x1b[38;5;244m[ 这个终端结束了' +
        (d.exitCode ? '（退出码 ' + d.exitCode + '）' : '') + ' ]\x1b[0m\r\n');
    } else if(d.type === 'error'){
      document.getElementById('uwtBoot').hidden = false;
      document.getElementById('uwtBoot').textContent = d.message || '终端出错了';
    }
  };
  ws.onclose = function(){ UWT.alive = false; uwtHead(null, UWT.dir, 'dead'); };
  ws.onerror = function(){
    if(!UWT.sid){
      document.getElementById('uwtBoot').hidden = false;
      document.getElementById('uwtBoot').textContent =
        '连不上本机终端。桥可能刚重启过 —— 关掉重新选一次。';
    }
  };
  /* 键盘、粘贴都从这里进 pty。xterm 会自己处理 CC 开的 bracketed paste（?2004h）。 */
  UWT.term.onData(function(data){
    if(ws.readyState === 1) ws.send(JSON.stringify({ type:'input', data:data }));
  });
}
/* 第一次用会撞 Claude Code 的目录信任确认，而它默认高亮在「No, exit」上 ——
   回车就退出了。工作目录固定成同一个，所以这一屏一辈子只出现一次；
   但那一次必须提前说，不然同事以为坏了。 */
function uwtFirstRunHint(){
  var k = 'wb.term.trusted';
  var seen = false; try { seen = localStorage.getItem(k) === '1'; } catch(e){}
  if(seen) return;
  document.getElementById('uwtTip').innerHTML =
    '第一次会问 <b>Is this a project you trust?</b> —— 按 <b>↓</b> 选 '
    + '<b>Yes, I trust this folder</b> 再回车。默认那项是No，直接回车会退出。这一屏只出现一次。';
  try { localStorage.setItem(k, '1'); } catch(e){}
}
function uwtHead(title, dir, busy){
  if(title != null) document.getElementById('uwtDt').textContent = title;
  document.getElementById('uwtDsub').textContent = dir || '';
  var dot = document.getElementById('uwtDot');
  dot.className = 'uwt-dot' + (busy === 'dead' ? ' uwt-dead' : busy ? ' uwt-run' : '');
}
function uwtPasteTask(){
  var t = (UWT.payload && UWT.payload.prompt) || '';
  if(!t || !UWT.ws || UWT.ws.readyState !== 1) return;
  /* 走 paste 而不是 input：桥那边会套 bracketed paste，
     不套的话多行文本的每个换行都被 CC 当回车提交，一段话被切成十几次提问。 */
  UWT.ws.send(JSON.stringify({ type:'paste', data:t }));
  if(window.fqToast) fqToast('任务单已粘进终端，回车发出去');
}
/* 收起 ≠ 结束：只断开页面这一头，CC 还在跑（桥那边留 30 分钟，回来能接上）。 */
function uwtHide(){
  document.getElementById('uwtDrawer').classList.remove('uwt-on');
  if(UWT.ws){ try { UWT.ws.close(); } catch(e){} UWT.ws = null; }
}
function uwtKill(){
  if(UWT.ws && UWT.ws.readyState === 1) UWT.ws.send(JSON.stringify({ type:'close' }));
  UWT.sid = null; UWT.alive = false;
  uwtHide();
}
document.addEventListener('keydown', function(e){
  if(e.key === 'Escape' && document.getElementById('uwtMask').classList.contains('uwt-on')) uwtCloseChooser();
});
'''

# ══════════════════════════════════════════════════════════════
#  门
# ══════════════════════════════════════════════════════════════
def strip_between(page, b, e):
    """先删再插 —— 这道是幂等的全部。跑两次不删就注入两遍，const重复声明整页JS全废。"""
    n = 0
    while True:
        i = page.find(b)
        if i < 0:
            break
        j = page.find(e, i)
        if j < 0:
            print('❌ 找到 %s但没找到配对的 %s，页面被手改过？已中止' % (b, e))
            sys.exit(1)
        page = page[:i] + page[j + len(e):]
        n += 1
    return page, n


def _css_code():
    """把 CSS 注释剥掉再交给下面两道门。

    🔴 patch-wizard.py 2026-09-08 就立过这条，我写这份新门时又踩了一遍：
    注释里引用了 `.wizmask` / `.wz-peek` 当依据，前缀门当场把注释里那两个
    当成我的 class 报红。注释里的文字不是选择器、不可能造成属性泄漏 ——
    **门扫的输入错了，不是判据错了**，所以修的是输入，没加豁免名单
    （加名单等于拿准确性换绿灯）。圆角门同理：注释里写 `border-radius:8px`
    举例也会被误当字面量。
    → 判据：任何扫源码文本的门，第一件事是剥注释。
    """
    return re.sub(r'/\*.*?\*/', '', CSS, flags=re.S)


def collision_gate(page):
    """我加的 class 有没有跟 WorkBuddy 本体撞名。
    2026-09-08 立：撞名之后后代选择器只覆盖显式设过的属性，没设的照样从本体漏进来，
    表现是「错位 / 变形」，看着像布局问题，其实是撞名。前缀比特异性可靠。"""
    # 我在 CSS 里写到的所有 class（自己的 + 万一手滑写了别人的）
    mine = set(re.findall(r'\.([a-zA-Z][\w-]*)', _css_code()))
    # page 进来时已经 strip 过了，里面不含上一次注入的自己 —— 所以整页都能当对照
    clash = sorted(c for c in mine if re.search(r'\.' + re.escape(c) + r'\s*\{', page))
    if clash:
        print('❌ 撞名门：这些class页面本体已经有同名定义，属性会漏进来')
        for c in clash:
            d = re.search(r'\.' + re.escape(c) + r'\s*\{([^}]*)\}', page)
            print('   .%-14s本体定义： %s' % (c, (d.group(1) if d else '?')[:70]))
        print('   → 加uwt- 前缀，别靠特异性打架（没覆盖到的属性照样漏）')
        sys.exit(1)
    flat = {c for c in mine if c.startswith('uwt-')}
    off = sorted(c for c in mine if not c.startswith('uwt-'))
    if off:
        print('❌ 前缀门：CSS里有不带uwt- 前缀的class —— %s' % '、'.join(off))
        sys.exit(1)
    stray = sorted(set(re.findall(r'class="([^"]*)"', DOM)))
    off = [c for grp in stray for c in grp.split() if not c.startswith('uwt-')]
    if off:
        print('❌ 前缀门：DOM里有不带uwt- 前缀的class —— %s' % '、'.join(sorted(set(off))))
        sys.exit(1)
    print('✅ 撞名门通过 · %d个uwt- class没有一个跟页面本体同名' % len(flat))


def radius_gate():
    """圆角只准 4（控件）和 8（容器）+ 整圆。2026-09-08 量过飞鹊真组件：
    只有 4/6/8/pill/整圆，12/16/20/24 各 0 次。写死量成的两档，别再冒出第三档。"""
    lits = re.findall(r'border-radius:\s*([^;}]+)', _css_code())
    bad = []
    for v in lits:
        v = v.strip()
        if v in ('50%', 'var(--ctl-r)', 'var(--box-r)'):
            continue
        bad.append(v)
    if bad:
        print('❌ 圆角门：出现了不在两档里的写法 —— %s' % '、'.join(bad))
        sys.exit(1)
    print('✅ 圆角门通过 · 只用了var(--ctl-r)=4 / var(--box-r)=8 / 50%')


def syntax_gate(js):
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f:
        f.write(js)
        tmp = f.name
    r = subprocess.run(['node', '--check', tmp], capture_output=True, text=True)
    os.unlink(tmp)
    if r.returncode != 0:
        print('❌ JS语法门：注入的脚本语法错，已中止（index.html没被动）')
        print(r.stderr.strip()[:900])
        sys.exit(1)
    print('✅ JS语法门通过')


def vendor_gate():
    """xterm 得真在仓库里 —— 页面引 vendor/xterm/ 而文件不在，
    表现是抽屉永远停在「正在起终端…」，而所有别的门都是绿的。"""
    need = ['xterm.js', 'xterm.css', 'addon-fit.js']
    d = os.path.join(ROOT, 'vendor', 'xterm')
    miss = [n for n in need if not os.path.exists(os.path.join(d, n))]
    if miss:
        print('❌ vendor门：vendor/xterm/ 缺 %s' % '、'.join(miss))
        sys.exit(1)
    print('✅ vendor门通过 · xterm三个文件都在（自托管，不依赖cdnjs）')


def main():
    if not os.path.exists(PAGE):
        print('❌ 找不到index.html')
        sys.exit(1)
    page = open(PAGE, encoding='utf-8').read()

    # 🔴 先删再跑门再插。顺序不能反：撞名门拿「页面本体」当对照，
    #    不先清掉上一次注入的自己，第二次跑就会把自己的 class 报成撞名。
    page, n1 = strip_between(page, CSS_B, CSS_E)
    page, n2 = strip_between(page, DOM_B, DOM_E)
    page, n3 = strip_between(page, JS_B, JS_E)
    if n1 or n2 or n3:
        print('   （先清掉上一次注入的 %d/%d/%d块 —— 这道是幂等的全部）' % (n1, n2, n3))

    vendor_gate()
    radius_gate()
    collision_gate(page)
    syntax_gate(JS)

    i = page.rindex('</style>')
    page = page[:i] + CSS_B + '\n' + CSS + '\n' + CSS_E + '\n' + page[i:]

    j = page.rindex('</body>')
    page = page[:j] + DOM_B + DOM + DOM_E + '\n' + page[j:]

    k = page.rindex('</script>')
    page = page[:k] + '\n' + JS_B + '\n' + JS + '\n' + JS_E + '\n' + page[k:]

    open(PAGE, 'w', encoding='utf-8').write(page)
    print('✅ 接力到终端那一层已注入index.html · %.0f KB' % (os.path.getsize(PAGE) / 1024))


if __name__ == '__main__':
    main()
