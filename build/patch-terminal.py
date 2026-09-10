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
/* ═══ 接力到终端 · 用全站那一套 token（:root 上定义，这一层不再自己定色）═══
   吉吉 2026-09-09：「内嵌式终端我希望不是完全分成两个区域，而是包在 UW 的风格里面」。
   上一版是一根黑色半屏柱子直接贴到视口右边，跟左边的白页面是两个世界。
   现在终端是页面里的一张圆角卡片：浅色卡头（标题 / 状态 / 按钮都是页面的样式），
   卡片里再嵌一块深色终端区。分区机制不变（.uwt-split 收窄 .app），变的是外观。 */

/* ── 选择界面 ─────────────────────────────────── */
.uwt-mask{position:fixed;inset:0;z-index:240;background:rgba(0,0,0,.28);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);
  display:none;align-items:center;justify-content:center;padding:28px}
.uwt-mask.uwt-on{display:flex}
.uwt-box{width:min(560px,100%);background:var(--white);border-radius:var(--r-lg);
  box-shadow:var(--sh-3);overflow:hidden;
  font:14px/1.6 -apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC",sans-serif;color:var(--ink)}
.uwt-hd{padding:22px 24px 4px}
.uwt-hd h3{margin:0;font-size:22px;font-weight:600;color:var(--ink);letter-spacing:-.5px}
.uwt-hd p{margin:6px 0 0;font-size:13px;color:var(--ink-2)}
.uwt-opts{padding:14px 24px 4px;display:flex;flex-direction:column;gap:8px}
.uwt-opt{display:flex;gap:12px;align-items:flex-start;width:100%;text-align:left;
  padding:13px 14px;border:1px solid var(--line);border-radius:var(--box-r);
  background:var(--white);cursor:pointer;font:inherit;color:inherit;transition:border-color .12s,background .12s}
.uwt-opt:hover:not(:disabled){border-color:var(--accent-line);background:var(--accent-fill)}
.uwt-opt:disabled{cursor:not-allowed;border-color:transparent;background:var(--soft)}
.uwt-opt:disabled .uwt-on1,.uwt-opt:disabled .uwt-on2{color:var(--ink-3)}
.uwt-oi{flex:0 0 auto;width:18px;height:18px;margin-top:2px;color:var(--ink-2)}
.uwt-opt:disabled .uwt-oi{color:var(--ink-4)}
.uwt-ot{flex:1 1 auto;min-width:0}
.uwt-on1{display:flex;align-items:center;gap:7px;font-size:14px;font-weight:600;color:var(--ink)}
.uwt-on2{margin:3px 0 0;font-size:13px;color:var(--ink-2)}
.uwt-on3{margin:3px 0 0;font-size:12px;color:var(--ink-3)}
.uwt-rec{flex:0 0 auto;font-size:11px;font-weight:500;padding:1px 8px;border-radius:var(--r-pill);
  background:var(--accent-fill);color:var(--accent-ink)}
.uwt-ft{display:flex;align-items:center;gap:8px;padding:14px 24px 22px}
.uwt-note{flex:1 1 auto;min-width:0;font-size:12px;color:var(--ink-3)}
.uwt-btn{flex:0 0 auto;white-space:nowrap;padding:8px 16px;border:0;border-radius:var(--r-pill);background:var(--soft);
  cursor:pointer;font:13px/1.4 inherit;color:var(--ink)}
.uwt-btn:hover{background:var(--soft-2)}
.uwt-btn.uwt-pri{background:var(--accent);color:#fff}
.uwt-btn.uwt-pri:hover{background:var(--accent-hover)}

/* ── 终端那一栏 ───────────────────────────────────
   真分区：开终端 → <html> 挂 .uwt-split → 主容器 .app 和向导弹层一起收窄，两边都完整可见。
   宽度用 --uwt-w 一个变量驱动，分隔条拖它，卡片和被收窄的两边同时跟着变。
   这一栏自己是页面的白底，卡片留 12px 边距 —— 所以看起来是「页面里放了一张卡」。 */
:root{--uwt-w:min(46vw,860px)}
.uwt-drawer{position:fixed;top:0;right:0;bottom:0;z-index:250;
  width:var(--uwt-w);padding:12px 12px 12px 6px;
  background:var(--canvas);
  display:none;flex-direction:column;
  font:13px/1.6 -apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC",sans-serif;color:var(--ink)}
.uwt-drawer.uwt-on{display:flex}
.uwt-panel{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;
  background:var(--white);border:1px solid var(--line-2);border-radius:var(--r-lg);
  box-shadow:var(--sh-1);overflow:hidden}

/* 分区：主内容和两个弹层都让出右边那一栏。
   .uwt-mask（选三条路那个弹层）也要列 —— 它 inset:0 在整个视口里居中，不列就压在终端底下。 */
html.uwt-split .app{width:calc(100% - var(--uwt-w))}
html.uwt-split .wizmask{right:var(--uwt-w)}
html.uwt-split .uwt-mask{right:var(--uwt-w)}
html.uwt-split .wz-peek{max-width:calc(100vw - var(--uwt-w) - 40px)}

/* 分隔条：卡片左边那 12px 空隙就是抓取区，中间一枚常驻的小握把（看得见才知道能拖）。 */
.uwt-grip{position:absolute;left:-6px;top:0;bottom:0;width:12px;cursor:col-resize;z-index:3;
  display:flex;align-items:center;justify-content:center}
.uwt-grip::before{content:"";width:4px;height:44px;border-radius:var(--r-pill);
  background:var(--ink-4);transition:background .12s}
.uwt-grip:hover::before,.uwt-grip.uwt-drag::before{background:var(--ink-3)}
html.uwt-dragging{cursor:col-resize;user-select:none}

/* 收起之后回去的入口：右下角一枚白色胶囊（会话在桥上还活着 30 分钟，没入口就等于活丢了）。
   只在真有活着的会话时出现。 */
.uwt-reopen{position:fixed;right:20px;bottom:20px;z-index:230;
  display:none;align-items:center;gap:8px;padding:9px 14px 9px 12px;
  border:1px solid var(--glass-line);border-radius:var(--r-pill);
  background:var(--glass);-webkit-backdrop-filter:var(--blur);backdrop-filter:var(--blur);color:var(--ink);cursor:pointer;
  font:13px/1.4 -apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC",sans-serif;
  box-shadow:var(--sh-2)}
.uwt-reopen.uwt-on{display:flex}
.uwt-reopen:hover{background:rgba(255,255,255,.95)}
.uwt-reopen .uwt-rdot{width:8px;height:8px;border-radius:50%;background:var(--ok);flex:0 0 auto}
.uwt-reopen .uwt-rdot.uwt-run{background:var(--busy);animation:uwt-pulse 1.1s ease-in-out infinite}
.uwt-reopen b{font-weight:500;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.uwt-reopen .uwt-rgo{color:var(--accent-ink);font-size:12px;flex:0 0 auto}

/* 🔴 向导开着的时候它要让开：向导右下角就是「下一步」，胶囊落在 20px 处正好盖住它
   （2026-09-09 截图撞上）。压到遮罩底下也不行 —— 从向导起的终端、收起后就再点不到它。
   所以向导开着时抬高到页脚之上（z 230 > 向导 200，< 选三条路那个弹层 240）。 */
body:has(.wizmask.wzon) .uwt-reopen{bottom:92px}

/* 卡头：跟页面同一套字号与色 */
.uwt-dhd{flex:0 0 auto;display:flex;align-items:center;gap:10px;
  padding:12px 14px 12px 16px;border-bottom:1px solid var(--line-2);background:var(--white)}
.uwt-dot{flex:0 0 auto;width:8px;height:8px;border-radius:50%;background:var(--ok)}
.uwt-dot.uwt-run{background:var(--busy);animation:uwt-pulse 1.1s ease-in-out infinite}
.uwt-dot.uwt-dead{background:var(--ink-4)}
@keyframes uwt-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.uwt-dtt{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px}
.uwt-dt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:600;color:var(--ink)}
.uwt-dsub{font-size:12px;color:var(--ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.uwt-dbtn{flex:0 0 auto;padding:5px 12px;border:0;border-radius:var(--r-pill);
  background:var(--soft);color:var(--ink);cursor:pointer;font:12px/1.4 inherit}
.uwt-dbtn:hover{background:var(--soft-2)}
/* 终端区：深色块嵌在白卡里，四边留 12px */
.uwt-dbody{flex:1 1 auto;min-height:0;position:relative;margin:12px 12px 10px;
  border-radius:var(--box-r);background:#1D1D1F;overflow:hidden}
.uwt-xt{position:absolute;inset:10px 6px 10px 12px}
.uwt-dtip{flex:0 0 auto;padding:0 16px 12px;color:var(--ink-3);font-size:12px;display:flex;align-items:center;gap:10px}
.uwt-dtip b{color:var(--ink-2);font-weight:500}
.uwt-boot{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  color:#A1A1A6;font-size:13px;text-align:center;padding:24px;line-height:1.8}
/* 🔴 必须显式写。`[hidden]` 的 display:none 是浏览器默认样式表里的，
   优先级低于上面这条 class 里的 display:flex —— 不写的话 el.hidden=true 之后
   「正在起终端…」照样铺在终端上。 */
.uwt-boot[hidden]{display:none}

/* 🔴 视口不够宽就别硬分区：1100px 以下分完两边都不够用，
   终端占满、主内容照旧留在底下。判据是「分完之后左边还够不够干活」，不是屏幕类别。 */
@media (max-width:1100px){
  .uwt-drawer{width:100vw;padding:8px}
  html.uwt-split .app{width:100%}
  html.uwt-split .wizmask{right:0}
  html.uwt-split .uwt-mask{right:0}
  .uwt-grip{display:none}
}
@media (max-width:760px){
  .uwt-box{width:100%}
  .uwt-dsub{display:none}
  .uwt-reopen{right:12px;bottom:calc(12px + env(safe-area-inset-bottom))}
}
'''

# ══════════════════════════════════════════════════════════════
#  DOM
# ══════════════════════════════════════════════════════════════
DOM = '''
<div class="uwt-mask" id="uwtMask"><div class="uwt-box" id="uwtBox"></div></div>
<button class="uwt-reopen" id="uwtReopen" onclick="uwtReopen()" title="回到那个终端">
  <span class="uwt-rdot" id="uwtRdot"></span><b id="uwtRlabel">终端还在跑</b><span class="uwt-rgo">回到终端</span>
</button>
<div class="uwt-drawer" id="uwtDrawer">
  <div class="uwt-grip" id="uwtGrip" title="拖动改宽度"></div>
  <div class="uwt-panel">
    <div class="uwt-dhd">
      <span class="uwt-dot" id="uwtDot"></span>
      <span class="uwt-dtt"><span class="uwt-dt" id="uwtDt">终端</span><span class="uwt-dsub" id="uwtDsub"></span></span>
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
            payload:null, alive:false, ro:null, live:null };

function uwtBridge(){ return window.wbBridge || null; }
/* 两条路各自能不能用。别把「桥没装」和「桥旧了」混成一句话 —— 同事要据此知道该干什么。 */
function uwtCan(){
  var B = uwtBridge();
  if(!B || !B.ok || !B.info) return { external:false, builtin:false,
    why:'要先把你电脑上的Claude Code接上（设置里有一行安装命令）' };
  var t = B.info.terminal;
  /* 桥旧了：说清是哪版、要哪版，命令由底下的「复制升级命令」按钮给 —— 光说「重跑一次安装命令」同事不知道命令是什么 */
  if(!t) return { external:false, builtin:false, stale:true,
    why:'桥是旧版'+(B.info.version||'1.0.0')+'，这个功能要'+(window.wbBridgeWant||'新版')+'：重跑一次安装命令就有' };
  return { external:!!t.external, builtin:!!t.ok, why:t.reason || '', root:t.workRoot || '' };
}
function uwtCopyCmd(){
  if(window.copyTx && window.BRIDGE_CMD_PUB) copyTx(BRIDGE_CMD_PUB, '安装命令');
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
    + '<p>' + uwtEsc(p.card || '任务') + (p.chars ? ' · 已经拼好' + p.chars + '字' : '') + '</p></div>');
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
           : (c.root ? '任务单会落到' + uwtEsc(c.root) + '/' : '');
  H.push('<div class="uwt-ft"><span class="uwt-note">' + note + '</span>'
    + (c.stale ? '<button class="uwt-btn" onclick="uwtCopyCmd()">复制升级命令</button>' : '')
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
    if(window.fqToast) fqToast('任务单已复制' + t.length + '字');
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
      if(!list.length){
        uwtKillUI();
        if(window.fqToast) fqToast('那个终端已经结束了');
        return;
      }
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
  var where = j.terminal ? ('已经在' + j.terminal + '里开好了') : '已经开好了';
  if(window.fqToast) fqToast(where + ' · 任务单在' + (j.rel || j.dir));
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
/* ── 分区开关与分隔条 ───────────────────────────────
   开终端 = 给 <html> 挂 .uwt-split，主内容和向导弹层一起收窄；关掉就摘掉。
   宽度只有 --uwt-w 一个源，拖分隔条改它，抽屉和被收窄的两边同时跟着变。 */
function uwtSplitOn(){
  document.documentElement.classList.add('uwt-split');
  var w = null; try { w = localStorage.getItem('wb.term.w'); } catch(e){}
  if(w) document.documentElement.style.setProperty('--uwt-w', w);
  uwtFit();
}
function uwtSplitOff(){ document.documentElement.classList.remove('uwt-split'); }
/* 拖分隔条。上下限：终端不小于 380（80 列放不下就没意义），
   左边至少留 520（少于这个数向导弹层就没法看了）。 */
function uwtGripInit(){
  var g = document.getElementById('uwtGrip');
  if(!g || g.dataset.on) return;
  g.dataset.on = '1';
  g.addEventListener('mousedown', function(e){
    e.preventDefault();
    g.classList.add('uwt-drag');
    document.documentElement.classList.add('uwt-dragging');
    function move(ev){
      var w = window.innerWidth - ev.clientX;
      w = Math.max(380, Math.min(w, window.innerWidth - 520));
      document.documentElement.style.setProperty('--uwt-w', w + 'px');
      uwtFit();
    }
    function up(){
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      g.classList.remove('uwt-drag');
      document.documentElement.classList.remove('uwt-dragging');
      try { localStorage.setItem('wb.term.w',
        getComputedStyle(document.documentElement).getPropertyValue('--uwt-w').trim()); } catch(e){}
      uwtFit();
    }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

function uwtOpenDrawer(j, isAttach){
  document.getElementById('uwtDrawer').classList.add('uwt-on');
  uwtSplitOn();
  uwtGripInit();
  document.getElementById('uwtBoot').hidden = false;
  document.getElementById('uwtBoot').textContent = '正在起终端…';
  UWT.dir = j.rel || j.dir || '';
  /* 从右边缘把手接回来时没走向导、payload 是空的 —— 用会话自己的标题兜住，
     别让标题栏显示 undefined */
  uwtHead((UWT.payload && UWT.payload.card) || (UWT.live && UWT.live.title) || '终端', UWT.dir, null);
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
    /* 底色跟 .uwt-dbody 一致（#1D1D1F），不然滚到底会露出 xterm 自己的黑 */
    theme: { background:'#1D1D1F', foreground:'#F5F5F7', cursor:'#F5F5F7',
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
        (d.exitCode ? '（退出码' + d.exitCode + '）' : '') + ' ]\x1b[0m\r\n');
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
    '第一次会问 <b>Is this a project you trust?</b> —— 按 <b>↓</b> 选'
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
  uwtSplitOff();
  if(UWT.ws){ try { UWT.ws.close(); } catch(e){} UWT.ws = null; }
  /* 收起 ≠ 结束，所以收起之后必须留一条回去的路。桥那边会话还留 30 分钟。 */
  uwtCheckLive();
}
function uwtKillUI(){
  var b = document.getElementById('uwtReopen');
  if(b) b.classList.remove('uwt-on');
}
/* 桥上还有活着的会话吗？有就亮出右边缘那个把手。
   刷新页面之后也走这条 —— 不然刷一下就再也回不去了。 */
function uwtCheckLive(){
  return uwtSessions().then(function(list){
    var b = document.getElementById('uwtReopen');
    if(!b) return;
    var open = document.getElementById('uwtDrawer').classList.contains('uwt-on');
    if(!list.length || open){ b.classList.remove('uwt-on'); return; }
    var s = list[0];
    UWT.live = s;
    document.getElementById('uwtRlabel').textContent = (s.title || '终端') + '还在跑';
    document.getElementById('uwtRdot').className = 'uwt-rdot' + (s.busy ? ' uwt-run' : '');
    b.classList.add('uwt-on');
    b.title = '回到「' + (s.title || '终端') + '」' + (s.rel ? '（' + s.rel + '）' : '');
  });
}
function uwtReopen(){
  document.getElementById('uwtReopen').classList.remove('uwt-on');
  uwtGo('attach');
}
function uwtKill(){
  if(UWT.ws && UWT.ws.readyState === 1) UWT.ws.send(JSON.stringify({ type:'close' }));
  UWT.sid = null; UWT.alive = false;
  document.getElementById('uwtDrawer').classList.remove('uwt-on');
  uwtSplitOff();
  if(UWT.ws){ try { UWT.ws.close(); } catch(e){} UWT.ws = null; }
  uwtKillUI();          /* 真结束了就别再亮把手 */
}
document.addEventListener('keydown', function(e){
  if(e.key === 'Escape' && document.getElementById('uwtMask').classList.contains('uwt-on')) uwtCloseChooser();
});
/* 窗口宽度变了要重算列数：46vw 是相对视口的，缩窗口时抽屉自己会变窄 */
window.addEventListener('resize', function(){
  if(document.documentElement.classList.contains('uwt-split')) uwtFit();
});
/* 页面一打开、以及之后每 30 秒，看桥上有没有还活着的会话。
   刷新页面丢的只是这一头的连接，活还在跑 —— 不查就再也回不去了。 */
(function(){
  function tick(){
    var B = window.wbBridge;
    if(B && B.ok && !document.getElementById('uwtDrawer').classList.contains('uwt-on')) uwtCheckLive();
  }
  setTimeout(tick, 2500);
  setInterval(tick, 30000);
})();
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
        # 🔴 连着把标记外面紧挨的空行一起吃掉。注入时在标记前后各加了 '\n'，
        #    只删标记之间的内容，那些换行每跑一轮就留一个 —— 页面每次构建长 8 字节，
        #    源头一个字没改也会产生 git diff。自动构建天天跑，那就是天天一个假提交。
        head = page[:i].rstrip('\n')
        tail = page[j + len(e):].lstrip('\n')
        page = head + '\n' + tail
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
    """两件事，判据不同，别混成一条。

    ① **命名冲突**：我给自己元素起的 class 跟页面本体重名 —— 后代选择器只覆盖我显式设过的
       属性，没设的照样从本体漏进来，表现是「错位 / 变形」，看着像布局问题。
       2026-09-08 栽过（向导的 .sw 撞了 WorkBuddy 自己的开关组件）。
       → 判据：我的 DOM 里出现的 class **必须全部带 uwt- 前缀**。

    ② **有意选中别人的元素**：分区要收窄 .app 和 .wizmask，这是故意的，不是冲突。
       🔴 第一版判据把这两件事混成「CSS 里不许出现别人的 class」，于是分区一写就报红。
       判据形式不够精确，**修判据、不加豁免名单**（加名单等于拿准确性换绿灯）。
       → 判据：非 uwt- 的 class 允许出现，但**必须被我的作用域限定** ——
         同一条选择器里要出现 uwt-（`html.uwt-split .app`）。
         裸写 `.app{…}` 照样红：那会污染整站，而且改完没人知道是我改的。
    """
    # ① 我的 DOM 里的 class 必须全带前缀
    dom_cls = set()
    for grp in re.findall(r'class="([^"]+)"', DOM):
        dom_cls.update(grp.split())
    off = sorted(c for c in dom_cls if not c.startswith('uwt-'))
    if off:
        print('❌ 前缀门：我的 DOM 里有不带 uwt- 前缀的 class —— %s' % '、'.join(off))
        sys.exit(1)

    # ② CSS 里出现的别人的 class，逐条选择器查有没有被我的作用域限定
    css = _css_code()
    naked = []
    for block in re.finditer(r'([^{}]+)\{', css):
        sel = block.group(1).strip()
        if not sel or sel.startswith('@') or sel.startswith(':root'):
            continue
        for one in sel.split(','):
            one = one.strip()
            if not one:
                continue
            cls = re.findall(r'\.([a-zA-Z][\w-]*)', one)
            foreign = [c for c in cls if not c.startswith('uwt-')]
            if foreign and 'uwt-' not in one:
                naked.append(one + '  ← 用到' + '、'.join(foreign))
    if naked:
        print('❌ 作用域门：这些选择器动了别人的 class，却没有我的作用域限定')
        for x in naked[:8]:
            print('   ' + x)
        print('   → 写成 html.uwt-split .xxx 这种带 uwt- 作用域的形式，别裸改全站')
        sys.exit(1)

    mine = {c for c in re.findall(r'\.(uwt-[\w-]*)', css)}
    scoped = sorted({c for blk in re.finditer(r'([^{}]+)\{', css)
                     for one in blk.group(1).split(',')
                     for c in re.findall(r'\.([a-zA-Z][\w-]*)', one)
                     if not c.startswith('uwt-') and 'uwt-' in one})
    print('✅ 撞名门通过 · 自己的 %d 个 uwt- class 全带前缀'
          '%s' % (len(mine), ('；另有 %d 个别人的 class 被作用域限定后有意改动（%s）'
                              % (len(scoped), '、'.join(scoped))) if scoped else ''))


def radius_gate():
    """圆角只准写 :root 上那几个 token（4 小件 / 8 控件 / 12 卡片 / 18 大容器 / 胶囊 / 整圆）。
    2026-09-09 全站换 Apple 那套之后，档位从飞鹊的 4/8 改成 8/12/18，
    但原则不变：写死的数字一律拦 —— 硬编码就是下一次不统一的起点。"""
    # 🔴 要认四角简写。`border-radius:var(--box-r) 0 0 var(--box-r)` 是右边缘那个
    #    把手必须的写法（贴着屏幕右沿，右侧两角不该圆），第一版判据只认单值、
    #    把它当违规拦下来了。判据形式不完整 → 改成拆开逐值判，不加豁免。
    OK = ('50%', 'var(--r-xs)', 'var(--ctl-r)', 'var(--box-r)', 'var(--r-lg)', 'var(--r-pill)', '0', '0px')
    lits = re.findall(r'border-radius:\s*([^;}]+)', _css_code())
    bad = []
    for v in lits:
        parts = [x for x in v.replace('/', ' ').split() if x]
        offend = [x for x in parts if x not in OK]
        if offend:
            bad.append(v.strip() + '（不认的值：' + '、'.join(offend) + '）')
    if bad:
        print('❌ 圆角门：出现了不在两档里的写法 —— %s' % '、'.join(bad))
        sys.exit(1)
    print('✅ 圆角门通过 · 只用了全站 token（--r-xs 4 / --ctl-r 8 / --box-r 12 / --r-lg 18 / 胶囊 / 整圆）')


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
