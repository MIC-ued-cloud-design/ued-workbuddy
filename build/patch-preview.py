#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
往 WorkBuddy 页面加「看产物」这一层：任务目录里做出来的网页，直接在页面里看着它长出来。
就地改 index.html。必须在 patch-terminal 之后跑（要用它的 UWT.dir 和 uwtOpenDrawer）。

治什么：接力到终端之后，页面这一头是瞎的 —— 同事要自己去 Finder 找那个目录、
双击打开、改一版再手动刷新。桌面版有右侧预览，网页版一直没有。

怎么做（跟桌面版的差别写在这儿，省得下次又去翻）：
  桌面版：fs.watch 即时 + uwproj:// 自定义协议
  网页版：页面轮询 /work/list（1.2 秒）+ /work/file 带票当 iframe 的 src
  🔴 轮询不是偷懒的替代品，是有意的：SSE 要在桥里管连接生命周期，
     而 Claude 写一个文件本来就要几十秒，1.2 秒的延迟在体感上分不出来。
     真嫌慢再换 SSE，别在没量之前先上复杂度。

用法：python3 build/patch-preview.py
"""
import os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = os.path.join(os.path.dirname(HERE), 'index.html')

CSS = r'''
/* ══════ 产物预览 ══════
   开着终端、任务目录里出现网页时，主区顶上浮一张卡。
   不抢主区原有布局 —— 插在最上面，下面该是什么还是什么。 */
.uwp-card{margin:28px 0;background:var(--white);border-radius:var(--r-lg);
  box-shadow:var(--sh-1);overflow:hidden;
  /* 🔴 flex:0 0 auto 和 width:100% 都不是装饰，缺一个这张卡就「在但看不见」：
     main 是纵向 flex 容器（patch-mobile 为了让 .wrap 能 margin:auto 居中设的），
     flex 子元素默认 flex-shrink:1 —— 首页 .wrap 有 970 的 min-height，
     加上这张卡就超过视口，于是卡被压成 0 高。
     DOM 里有、iframe 也照样加载、控制台一声不吭，只有量几何才看得出来。 */
  flex:0 0 auto;width:100%}
.uwp-hd{display:flex;align-items:center;gap:10px;padding:12px 16px;
  border-bottom:1px solid var(--line-2)}
.uwp-hd b{font-size:14px;font-weight:600;color:var(--ink);white-space:nowrap}
.uwp-dot{width:7px;height:7px;border-radius:50%;background:var(--ok);flex:0 0 auto}
.uwp-dot.busy{background:var(--busy)}
.uwp-sel{flex:1;min-width:0;font-size:13px;color:var(--ink-2);border:1px solid var(--line);
  border-radius:var(--ctl-r);padding:6px 10px;background:var(--white);max-width:340px}
.uwp-sp{flex:1}
.uwp-btn{display:inline-flex;align-items:center;gap:5px;padding:6px 12px;font-size:13px;
  color:var(--ink);border:1px solid var(--line);border-radius:var(--ctl-r);
  background:var(--white);white-space:nowrap;transition:.13s}
.uwp-btn:hover{background:var(--soft-2)}
.uwp-body{position:relative;background:var(--canvas);height:var(--uwp-h,520px);overflow:hidden}
.uwp-body iframe{position:absolute;top:0;left:0;border:0;background:#fff;
  transform-origin:0 0}
.uwp-empty{display:flex;align-items:center;justify-content:center;height:100%;
  font-size:14px;color:var(--ink-3);text-align:center;padding:0 24px;line-height:1.7}
/* 拖这条改预览高度。常驻可见 —— 只在 hover 才显线等于没做。 */
.uwp-grip{height:14px;display:flex;align-items:center;justify-content:center;cursor:ns-resize;
  border-top:1px solid var(--line-2);background:var(--canvas)}
.uwp-grip i{display:block;width:34px;height:4px;border-radius:2px;background:var(--ink-4)}
.uwp-grip:hover i{background:var(--ink-3)}
@media (max-width:768px){ .uwp-body{height:340px} .uwp-sel{max-width:140px} }
'''

JS = r'''
/* ══════════ 产物预览 ══════════
   在 patch-terminal 之后加载，所以 UWT / uwtOpenDrawer 都在。 */
(function(){
  var PV = { rel:null, ticket:null, file:null, files:[], sig:'', timer:null, h:520, zoom:1 };
  var POLL = 1200;

  function B(){ return window.wbBridge || null; }
  /* 桥支不支持看产物。1.4.0 以下没有这三条路由，别去问、也别显示这一栏。 */
  function canPreview(){
    var b = B();
    return !!(b && b.ok && b.info && b.info.preview && b.info.preview.ok);
  }

  /* 开始盯一个任务目录。接力到终端的两条路都调它（页面内终端 / 系统终端）。 */
  window.uwPreviewWatch = function(rel){
    if(!rel || !canPreview()){ return; }
    if(PV.rel === rel && PV.timer) return;
    uwPreviewStop();
    PV.rel = rel; PV.file = null; PV.files = []; PV.sig = '';
    fetch(B().url + '/work/session', { method:'POST', headers:{ 'content-type':'application/json' },
                                       body: JSON.stringify({ rel: rel }) })
      .then(function(r){ return r.json(); })
      .then(function(j){
        if(!j || !j.ok) return;
        PV.ticket = j.ticket;
        PV.timer = setInterval(poll, POLL);
        poll();
      }).catch(function(){});
  };
  window.uwPreviewStop = function(){
    if(PV.timer){ clearInterval(PV.timer); PV.timer = null; }
    PV.rel = null; PV.ticket = null; PV.files = []; PV.sig = ''; PV.file = null;
    var c = document.getElementById('uwpCard'); if(c) c.remove();
  };

  function poll(){
    if(!PV.rel || !canPreview()) return;
    fetch(B().url + '/work/list?rel=' + encodeURIComponent(PV.rel), { cache:'no-store' })
      .then(function(r){ return r.json(); })
      .then(function(j){
        if(!j || !j.ok) return;
        var htmls = (j.files||[]).filter(function(f){ return f.ext === '.html' || f.ext === '.htm'; });
        /* 指纹＝每个网页的路径＋改动时间。变了才动 DOM —— 每轮都重画会把
           正在看的位置和滚动条冲掉，而且 iframe 每 1.2 秒闪一次没法看。 */
        var sig = htmls.map(function(f){ return f.rel + ':' + f.mtime; }).join('|');
        if(sig === PV.sig) return;
        var first = !PV.files.length;
        PV.sig = sig; PV.files = htmls;
        if(!htmls.length){ var c = document.getElementById('uwpCard'); if(c) c.remove(); return; }
        /* 选哪一个：优先 index.html，其次最近改过的。人手选过就不抢。 */
        if(!PV.file || !htmls.some(function(f){ return f.rel === PV.file; })){
          var idx = htmls.find(function(f){ return f.rel === 'index.html'; });
          PV.file = (idx || htmls[0]).rel;
        }
        render(first);
      }).catch(function(){});
  }

  function fileUrl(){
    return B().url + '/work/file/' + PV.rel.split('/').map(encodeURIComponent).join('/')
         + '/' + PV.file.split('/').map(encodeURIComponent).join('/')
         + '?t=' + encodeURIComponent(PV.ticket) + '&_=' + Date.now();
  }

  function render(isFirst){
    var host = document.getElementById('main');
    if(!host) return;
    var card = document.getElementById('uwpCard');
    if(!card){
      card = document.createElement('div');
      card.id = 'uwpCard'; card.className = 'uwp-card';
      /* 插在主区最前面。.wrap 还在，下面该显示什么照旧。 */
      var anchor = host.querySelector('.wrap') || host.firstElementChild;
      if(anchor) host.insertBefore(card, anchor); else host.appendChild(card);
    }
    var busy = !!(window.UWT && UWT.live && UWT.live.busy);
    var opts = PV.files.map(function(f){
      return '<option value="' + esc(f.rel) + '"' + (f.rel === PV.file ? ' selected' : '') + '>'
           + esc(f.rel) + '</option>'; }).join('');
    card.innerHTML =
      '<div class="uwp-hd"><span class="uwp-dot' + (busy ? ' busy' : '') + '"></span>'
      + '<b>做出来的页面</b>'
      + (PV.files.length > 1 ? '<select class="uwp-sel" onchange="uwPreviewPick(this.value)">' + opts + '</select>'
                             : '<span class="uwp-sel" style="border:0;background:none">' + esc(PV.file) + '</span>')
      + '<span class="uwp-sp"></span>'
      + '<button class="uwp-btn" onclick="uwPreviewReload()">刷新</button>'
      + '<button class="uwp-btn" onclick="uwPreviewOpen()">在浏览器里打开</button></div>'
      + '<div class="uwp-body" id="uwpBody" style="--uwp-h:' + PV.h + 'px">'
      +   '<iframe id="uwpFrame" src="' + esc(fileUrl()) + '" sandbox="allow-scripts allow-same-origin"></iframe>'
      + '</div>'
      + '<div class="uwp-grip" id="uwpGrip" title="拖这里改高度"><i></i></div>';
    fit();
    if(isFirst && window.fqToast) fqToast('做出来的页面已经在上面了，它一改这儿就跟着变');
  }

  /* 产物多半按 1440 画，而主区只有 700 多 —— 整页缩放塞进来，
     别让人横着拖。缩放比按实际宽度算，不写死。 */
  function fit(){
    var body = document.getElementById('uwpBody'), fr = document.getElementById('uwpFrame');
    if(!body || !fr) return;
    var w = body.clientWidth || 700;
    var base = 1440;
    PV.zoom = Math.min(1, w / base);
    fr.style.width = base + 'px';
    fr.style.height = Math.round(PV.h / PV.zoom) + 'px';
    fr.style.transform = 'scale(' + PV.zoom + ')';
  }
  function esc(s){ return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  window.uwPreviewPick = function(rel){ PV.file = rel; render(false); };
  window.uwPreviewReload = function(){
    var fr = document.getElementById('uwpFrame'); if(fr) fr.src = fileUrl(); };
  window.uwPreviewOpen = function(){ if(PV.ticket) window.open(fileUrl(), '_blank', 'noopener'); };

  /* 拖高度。存起来，下次进来还是这么高。 */
  document.addEventListener('mousedown', function(e){
    var g = e.target.closest && e.target.closest('#uwpGrip'); if(!g) return;
    e.preventDefault();
    var y0 = e.clientY, h0 = PV.h;
    function mv(ev){
      PV.h = Math.max(240, Math.min(1200, h0 + (ev.clientY - y0)));
      var b = document.getElementById('uwpBody');
      if(b){ b.style.setProperty('--uwp-h', PV.h + 'px'); fit(); }
    }
    function up(){ document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up);
      try{ localStorage.setItem('wb.preview.h', String(PV.h)); }catch(e2){} }
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
  });
  try{ var sh = parseInt(localStorage.getItem('wb.preview.h'), 10); if(sh >= 240 && sh <= 1200) PV.h = sh; }catch(e){}
  window.addEventListener('resize', fit);

  /* 页面自己重画（切角色、发问题）会把卡片冲掉 —— 重画完补回来。
     🔴 不是在 render() 里防抖就够了：底座的 render() 直接换 main 的 innerHTML。 */
  var baseRender = window.render;
  if(typeof baseRender === 'function'){
    window.render = function(){
      var r = baseRender.apply(this, arguments);
      if(PV.rel && PV.files.length && !document.getElementById('uwpCard')) render(false);
      return r;
    };
  }
})();
'''

BEG_CSS, END_CSS = '/* ==WB-PV-CSS:BEGIN== */', '/* ==WB-PV-CSS:END== */'
BEG_JS,  END_JS  = '/* ==WB-PV-JS:BEGIN== */',  '/* ==WB-PV-JS:END== */'



def token_gate(page_text, css):
    """CSS 里 var(--x) 引用的 token，必须在 :root 里真的定义过。

    🔴 为什么要一道门：拼错或自己编一个 token 名，浏览器的行为是
    **整条声明作废、静默**——按钮的 border 直接消失、hover 没反应，
    控制台一声不吭，JS 语法门也管不着。写这一层时我就编了两个
    （--line-1 / --canvas-2），是看截图发现按钮没描边才倒查出来的。
    肉眼能发现纯属运气，所以做成机器检查。"""
    m = re.search(r':root\{(.*?)\n\}', page_text, re.S)
    if not m:
        print('❌ 找不到 :root'); sys.exit(1)
    have = set(re.findall(r'(--[\w-]+)\s*:', m.group(1)))
    # 🔴 只查「没有兜底值」的那种：var(--x) 拿不到就整条作废，
    # 而 var(--x, 520px) 拿不到会用兜底，是合法写法（--uwp-h 就是由 JS 内联设的）。
    # 第一版没分这两种，把带兜底的 --uwp-h 报成缺失 —— 判据写窄了，不是产品错。
    used = set(re.findall(r'var\((--[\w-]+)\s*\)', css))
    own = set(re.findall(r'(--[\w-]+)\s*:', css))
    miss = sorted(used - have - own)
    if miss:
        print('❌ 这些 token 在 :root 里没有，写了等于没写：' + '、'.join(miss))
        sys.exit(1)
    print('  token 门：%d 个 var() 引用全都对得上' % len(used))


def strip_between(t, a, b):
    """先删再插 —— 跑两次不删就注入两遍，函数重复声明整页 JS 全废，而脚本自己不报错。"""
    i = t.find(a)
    if i < 0:
        return t
    j = t.find(b)
    if j < 0:
        print('❌ 只找到开始标记没找到结束标记'); sys.exit(1)
    return t[:i] + t[j + len(b):]


def main():
    s = open(PAGE, encoding='utf-8').read()
    token_gate(s, CSS)
    s = strip_between(s, BEG_CSS, END_CSS)
    s = strip_between(s, BEG_JS, END_JS)

    if '</style>' not in s:
        print('❌ 找不到 </style>'); sys.exit(1)
    s = s.replace('</style>', BEG_CSS + '\n' + CSS + '\n' + END_CSS + '\n</style>', 1)

    # 挂在 patch-terminal 那段之后：它定义了 UWT / uwtOpenDrawer，我们要接上去
    anchor = '/* ==WB-TERM-JS:END== */'
    if anchor not in s:
        print('❌ 找不到 WB-TERM-JS:END —— patch-preview 必须在 patch-terminal 之后跑'); sys.exit(1)
    # 🔴 不要再套一层 <script>：这几个标记都在同一个大 script 块里
    # （向导那段紧跟在 WB-TERM-JS:END 后面），套了就等于在块中间插一个结束标签，
    # 整页 JS 从那儿断掉 —— 而且页面还能打开，只是什么都不响应。
    s = s.replace(anchor, anchor + '\n' + BEG_JS + '\n' + JS + '\n' + END_JS, 1)

    open(PAGE, 'w', encoding='utf-8').write(s)
    print('✅ 产物预览层已注入 index.html · CSS %d 字符 · JS %d 字符' % (len(CSS), len(JS)))


if __name__ == '__main__':
    main()
