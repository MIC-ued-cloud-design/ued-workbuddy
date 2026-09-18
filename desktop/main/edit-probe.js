/* UED WorkBuddy · 预览页里的「像 Figma 那样改」编辑层
 *
 * 由主进程在协议层注进每个预览 HTML（只在送去预览的那份上，不落盘）。默认沉默；
 * 父窗口（客户端界面）发{__uwEditCmd:'on'}才亮起来。
 *
 * 分工：这里只管「页面里看得见摸得着」的那半 —— 选中、悬停框、尺寸标签、双击改字、
 * 拖着在同级之间换顺序、拉手柄改宽高、快捷键；每个动作最后都变成一条「第 N 个元素怎么改」
 * 的操作发给父窗口，父窗口去写文件。样式改动先在这儿实时生效（用户立刻看到），文件那边
 * 同步补同样的内联样式，所以不用重载；结构性改动（删/复制/挪位置）编号会变，父窗口会重载。
 *
 * 能编辑的只有源码里就有的元素（带 data-uw-i）。脚本跑出来的元素点到了会告诉父窗口
 * 「这块是脚本生成的」，别装作能改。
 */
(function () {
  if (window.parent === window) return;
  var ON = false, sel = null, hov = null, editing = null, drag = null, resize = null;
  var root, sh, boxSel, boxHov, insLine, ghost, dropBox, styleEl, tick = null, dropState = null;
  var msrs = [], GAPS = true, lastRect = null;   // 间距标尺开着还是关着，由外面的开关说了算（吉吉 2026-09-17 要能自己控制）
  var LEAF = { img: 1, input: 1, br: 1, hr: 1, svg: 1, video: 1, iframe: 1, canvas: 1, select: 1, textarea: 1 };
  var post = function (m) { try { window.parent.postMessage(m, '*'); } catch (e) { try { console.error('[uw-edit] postMessage失败：' + e.message); } catch (x) {} } };
  var idx = function (el) { var v = el && el.getAttribute && el.getAttribute('data-uw-i'); return v == null ? null : +v; };

  /* ── 覆盖层（shadow root 里，页面样式碰不到它） ── */
  function ensureUI() {
    if (root) return;
    root = document.createElement('div'); root.id = '__uwEditRoot'; root.setAttribute('data-uw-ui', '1');
    root.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none;outline:none';
    root.tabIndex = -1;   // 点页面时把键盘焦点收到这儿：mousedown 被 preventDefault 后浏览器不会自己把焦点挪进 iframe，快捷键就会落到外面
    sh = root.attachShadow({ mode: 'open' });
    var st = document.createElement('style');
    st.textContent = [
      '.box{position:fixed;box-sizing:border-box;pointer-events:none;display:none}',
      '.hov{border:1px solid rgba(0,113,227,.75)}',
      '.hov .tag{position:absolute;left:-1px;bottom:100%;margin-bottom:3px;background:#0071E3;color:#fff;font:11px/1 -apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;padding:3px 6px;border-radius:3px;white-space:nowrap;max-width:320px;overflow:hidden;text-overflow:ellipsis}',
      '.sel{border:1.5px solid #0071E3}',
      '.sel .lab{position:absolute;left:50%;top:100%;transform:translateX(-50%);margin-top:5px;background:#0071E3;color:#fff;font:11px/1 -apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;padding:3px 6px;border-radius:3px;white-space:nowrap;font-variant-numeric:tabular-nums}',
      '.sel.top .lab{top:auto;bottom:100%;margin:0 0 5px}',
      '.h{position:absolute;width:8px;height:8px;background:#fff;border:1.5px solid #0071E3;box-sizing:border-box;pointer-events:auto}',
      '.h.e{right:-5px;top:50%;margin-top:-4px;cursor:ew-resize}.h.s{bottom:-5px;left:50%;margin-left:-4px;cursor:ns-resize}.h.se{right:-5px;bottom:-5px;cursor:nwse-resize}',
      '.h.nw{left:-5px;top:-5px}.h.ne{right:-5px;top:-5px}.h.sw{left:-5px;bottom:-5px}',
      '.sel.inl .h{display:none}.sel.editing .h,.sel.editing .lab{display:none}.sel.editing{border-color:#34C759}',
      /* 贴着画布边时，挂在框外的手柄和标签一律收进框里 —— 露在视口外的部分是会被裁掉的 */
      '.box.cl-l .h.nw,.box.cl-l .h.sw{left:0}',
      '.box.cl-r .h.ne,.box.cl-r .h.se,.box.cl-r .h.e{right:0}',
      '.box.cl-t .h.nw,.box.cl-t .h.ne{top:0}',
      '.box.cl-b .h.sw,.box.cl-b .h.se,.box.cl-b .h.s{bottom:0}',
      '.hov.cl-t .tag{bottom:auto;top:1px}',
      '.sel.cl-b .lab{top:auto;bottom:1px}',
      '.ins{position:fixed;background:#0071E3;pointer-events:none;display:none;border-radius:1px}',
      '.ins::before,.ins::after{content:"";position:absolute;width:6px;height:6px;border-radius:50%;background:#0071E3}',
      '.ins.v::before{left:-2px;top:-3px}.ins.v::after{left:-2px;bottom:-3px}.ins.hz::before{top:-2px;left:-3px}.ins.hz::after{top:-2px;right:-3px}',
      '.ghost{position:fixed;border:1px dashed #0071E3;background:rgba(0,113,227,.08);pointer-events:none;display:none;box-sizing:border-box}',
      '.dropbox{position:fixed;border:2px solid #0071E3;background:rgba(0,113,227,.14);pointer-events:none;display:none;box-sizing:border-box}',
      '.dropbox .tag{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:#0071E3;color:#fff;font:11px/1 -apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;padding:4px 8px;border-radius:4px;white-space:nowrap}',
      /* 间距标尺：鼠标划到哪一块，就直接把它跟上下左右邻居的空隙标出来（吉吉 2026-09-17）。
         用红粉色，跟蓝色的选框/悬停框分开 —— 一眼能认出「这是量出来的数，不是选中框」。 */
      '.msr{position:fixed;display:none;pointer-events:none}',
      '.msr i{position:absolute;background:#FF2D6F}',
      '.msr i::before,.msr i::after{content:"";position:absolute;background:#FF2D6F}',
      '.msr b{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:#FF2D6F;color:#fff;font:10px/1 -apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;padding:2px 4px;border-radius:3px;white-space:nowrap;font-variant-numeric:tabular-nums}',
      '.msr.v i{left:8px;top:0;width:1px;height:100%}',
      '.msr.v i::before{left:-4px;top:0;width:9px;height:1px}.msr.v i::after{left:-4px;bottom:0;width:9px;height:1px}',
      '.msr.hz i{left:0;top:8px;height:1px;width:100%}',
      '.msr.hz i::before{top:-4px;left:0;height:9px;width:1px}.msr.hz i::after{top:-4px;right:0;height:9px;width:1px}'
    ].join('');
    sh.appendChild(st);
    boxHov = mk('div', 'box hov'); boxHov.innerHTML = '<span class="tag"></span>';
    boxSel = mk('div', 'box sel'); boxSel.innerHTML = '<span class="lab"></span><i class="h nw"></i><i class="h ne"></i><i class="h sw"></i><i class="h e" data-dir="e"></i><i class="h s" data-dir="s"></i><i class="h se" data-dir="se"></i>';
    insLine = mk('div', 'ins'); ghost = mk('div', 'ghost'); dropBox = mk('div', 'dropbox'); dropBox.innerHTML = '<span class="tag"></span>';
    sh.appendChild(boxHov); sh.appendChild(boxSel); sh.appendChild(insLine); sh.appendChild(ghost); sh.appendChild(dropBox);
    for (var mi = 0; mi < 4; mi++) { var m = mk('div', 'msr'); m.innerHTML = '<i></i><b></b>'; msrs.push(m); sh.appendChild(m); }
    document.documentElement.appendChild(root);
    /* 手柄：拉宽高 */
    Array.prototype.forEach.call(boxSel.querySelectorAll('.h[data-dir]'), function (h) {
      h.addEventListener('mousedown', function (e) {
        if (!sel) return; e.preventDefault(); e.stopPropagation();
        var r = sel.getBoundingClientRect();
        resize = { dir: h.getAttribute('data-dir'), x: e.clientX, y: e.clientY, w: r.width, h: r.height, set: {} };
      }, true);
    });
  }
  function mk(t, c) { var d = document.createElement(t); d.className = c; return d; }
  function place(box, r) { box.style.display = 'block'; box.style.left = r.left + 'px'; box.style.top = r.top + 'px'; box.style.width = Math.max(0, r.width) + 'px'; box.style.height = Math.max(0, r.height) + 'px'; }
  /* 选框 / 悬停框：往外让 pad 像素，别盖住元素自己的描边；圆角跟着元素走（外扩后半径也要加 pad） */
  function placeAround(box, el, pad) {
    var r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    /* 选框往外让 pad，但元素贴着画布边（整屏宽的页头、1440 档里的 1440 通栏）时，
       让出去的那一边就落到视口外被裁掉，看着像「蓝框断了一截」（吉吉 2026-09-17）。
       所以把选框夹回视口里：贴边那条线画在里侧，四条边都看得见。 */
    var vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    var L = Math.max(0, r.left - pad), T = Math.max(0, r.top - pad);
    var R = Math.min(vw, r.right + pad), B = Math.min(vh, r.bottom + pad);
    place(box, { left: L, top: T, width: Math.max(0, R - L), height: Math.max(0, B - T) });
    /* 哪几条边贴住了视口：手柄和标签挂在框外面，贴边那侧要收进来，不然被裁成半块（吉吉 2026-09-17 第二次报） */
    box.classList.toggle('cl-l', L <= 0.5);
    box.classList.toggle('cl-t', T <= 0.5);
    box.classList.toggle('cl-r', R >= vw - 0.5);
    box.classList.toggle('cl-b', B >= vh - 0.5);
    var rad = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map(function (v) {
      var n = parseFloat(v) || 0; if (/%/.test(v)) n = Math.min(r.width, r.height) * n / 100; return n ? (n + pad) + 'px' : '0';
    });
    box.style.borderRadius = rad.join(' ');
    return r;
  }

  /* 编辑态下页面自己的光标和选字都关掉，别跟编辑层打架 */
  function pageStyle(on) {
    if (on && !styleEl) {
      styleEl = document.createElement('style'); styleEl.setAttribute('data-uw-ui', '1');
      styleEl.textContent = 'html,body,body *{cursor:default!important;-webkit-user-select:none!important;user-select:none!important}[data-uw-editing]{cursor:text!important;-webkit-user-select:text!important;user-select:text!important;outline:none!important}a,button{pointer-events:auto}';
      document.head ? document.head.appendChild(styleEl) : document.documentElement.appendChild(styleEl);
    } else if (!on && styleEl) { styleEl.remove(); styleEl = null; }
  }

  /* ── 命中 ── */
  function fromUI(e) { var p = e.composedPath ? e.composedPath() : []; for (var k = 0; k < p.length; k++) if (p[k] === root) return true; return false; }
  function pick(x, y) {
    var list = document.elementsFromPoint(x, y);
    for (var k = 0; k < list.length; k++) {
      var el = list[k];
      if (root && (el === root || root.contains(el))) continue;
      if (el === document.documentElement) return null;
      /* svg 里的 path / g 不单独选：图标是一个整体，跟 Figma 的实例一样 */
      while (el.ownerSVGElement) el = el.ownerSVGElement;
      return el;
    }
    return null;
  }
  function editable(el) { return !!(el && el.nodeType === 1 && idx(el) != null && el !== document.documentElement); }
  function structural(el) { return !!(editable(el) && el !== document.body && el.tagName !== 'HEAD' && el.tagName !== 'HTML' && el.parentElement); }
  function isTextOnly(el) {
    if (!el || LEAF[el.tagName.toLowerCase()]) return false;
    for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1 && !(n.tagName === 'BR')) return false;
    return true;
  }
  function label(el) {
    var t = el.tagName.toLowerCase(), id = el.id ? '#' + el.id : '', c = '';
    if (el.classList && el.classList.length) c = '.' + Array.prototype.slice.call(el.classList, 0, 2).join('.');
    return t + id + c;
  }
  function sibs(el) {
    var out = []; if (!el || !el.parentElement) return out;
    var ch = el.parentElement.children;
    for (var k = 0; k < ch.length; k++) if (ch[k] !== el && editable(ch[k]) && !(root && ch[k] === root)) out.push(ch[k]);
    return out;
  }
  function prevSib(el) { var p = el.previousElementSibling; while (p && !editable(p)) p = p.previousElementSibling; return p; }
  function nextSib(el) { var n = el.nextElementSibling; while (n && (!editable(n) || n === root)) n = n.nextElementSibling; return n; }

  /* 图片填充。Figma 里图片就是一种「填充」，HTML 里却是两套写法：<img src> 和 CSS 的 background-image。
     面板上要长成一样，所以在这儿就归一成同一个形状，面板不必再分叉。
     🔴 背景图的 url 从 computed style 里拿到的是绝对地址（uwproj://…），能直接用来显示缩略图，
        但它不是源码里的写法——写回一律写新的相对路径，别拿这个绝对地址回写。 */
  /* 蒙版层＝background-image 最前面那个两端同色的 linear-gradient。有图时它压在图上，没图时它压在底色上（比如底色 + 20% 黑）。 */
  function maskOf(bi) {
    var g = /^linear-gradient\(\s*(rgba?\([^)]*\))\s*,\s*(rgba?\([^)]*\))\s*\)/.exec(bi || '');
    return g && g[1].replace(/\s+/g, '') === g[2].replace(/\s+/g, '') ? g[1].replace(/\s+/g, '') : null;
  }
  function imgFill(el, cs) {
    var tag = el.tagName.toLowerCase();
    if (tag === 'img') {
      return { kind: 'img', src: el.getAttribute('src') || '', shown: el.currentSrc || el.src || '',
        fit: cs.objectFit || 'fill', pos: cs.objectPosition || '50% 50%',
        /* 样式表已经在管这张图的尺寸了（max-width/max-height）：换图时就别再把当前渲染尺寸写死成 inline。
           🔴 头像就是这么被拉变形的 —— VO 那张图被 max-width 限成 41×54，换成方图后仍被按 41×54 写死
              （2026-09-17 真机撞到，门是绿的）。没有 CSS 约束的图才需要写死，否则新图会按原始尺寸把布局撑乱。 */
        cssSized: cs.maxWidth !== 'none' || cs.maxHeight !== 'none',
        nw: el.naturalWidth || 0, nh: el.naturalHeight || 0 };
    }
    var bi = cs.backgroundImage || '';
    var m = /url\((['"]?)([^'")]+)\1\)/.exec(bi);
    if (!m) return null;
    /* 蒙版＝叠在图上面的一层纯色渐变（两端同色），这是前端给 banner 压暗的标准写法：
       background-image: linear-gradient(rgba(0,0,0,.4), rgba(0,0,0,.4)), url(x.jpg)。认出来面板才能显示当前浓度。 */
    var mask = maskOf(bi);
    /* 地址优先取源码里的写法（inline style 才拿得到）；拿不到就给 computed 的绝对地址，外面按项目路径换算回相对 */
    var au = /url\((['"]?)([^'")]+)\1\)/.exec(el.style.backgroundImage || '');
    /* 分层背景的 size / position 是逗号列表（"cover, cover"），只取第一层的 */
    return { kind: 'bg', src: au ? au[2] : m[2], shown: m[2], mask: mask,
      fit: String(cs.backgroundSize || 'auto').split(',')[0].trim(), pos: String(cs.backgroundPosition || '0% 0%').split(',')[0].trim(), nw: 0, nh: 0 };
  }

  /* 选中的这层自己没有图、里面却有一张图把它铺满时（头像、图片卡这类「外层画圆/描边、内层放 img」的写法），
     把里面那张图当成「这一层的图」露给面板。
     🔴 这不是锦上添花：外层的 background-image / 底色 / 蒙版全都会被里面那张图盖住，
        人往外层加图只会看到「传了图没反应」（图其实写进去了，压在底下）。2026-09-17 吉吉换 VO 头像时踩的。
     判据：候选得是源码里的元素（有编号才下得了命令），且面积占这层四分之一以上 —— 小角标、小图标不算「这层的图」。
     🔴 下限是拿真页面量出来的，不是拍的：VO 那个头像 60×60 的框里，图被 max-width 限成 41×54＝61%；
        再窄一点（比如 30×54＝45%）就会漏 —— 所以 0.5 太紧，落到 0.25。往回调之前先去量一张真的。
     只往下看三层：再深就不该算作「这一层的图」了。 */
  function innerFill(el, r) {
    if (!el || !el.children || !el.children.length) return null;
    var area = (r.width || 0) * (r.height || 0); if (area < 16) return null;
    var best = null, bestA = 0, q = [[el, 0]], seen = 0;
    while (q.length && seen < 200) {
      var cur = q.shift(), node = cur[0], d = cur[1];
      for (var k = 0; k < node.children.length && seen < 200; k++) {
        var c = node.children[k]; seen++;
        if (d + 1 < 3) q.push([c, d + 1]);
        if (!editable(c)) continue;
        var ccs = getComputedStyle(c);
        if (ccs.display === 'none' || ccs.visibility === 'hidden') continue;
        var f = imgFill(c, ccs); if (!f) continue;
        var cr = c.getBoundingClientRect(), a = cr.width * cr.height;
        if (a / area < 0.25) continue;
        /* 平局取靠后的那个：DOM 里靠后＝压在上面＝人眼看见的那张 */
        if (a >= bestA) {
          bestA = a;
          best = { i: idx(c), tag: c.tagName.toLowerCase(), label: label(c), depth: d + 1, how: 'inner', fill: f,
            alt: c.tagName.toLowerCase() === 'img' ? (c.getAttribute('alt') || '') : null,
            classes: Array.prototype.slice.call(c.classList || []),
            rect: { w: Math.round(cr.width), h: Math.round(cr.height) } };
        }
      }
    }
    return best;
  }

  /* 第二条路：图既不在这层身上、也不在它里面，而是压在它**下面**。
     头像就是这么写的：一张 <img>，上面盖一层 absolute 的半透明遮罩（写着「需要修改」），
     鼠标点下去命中的永远是遮罩，那张图点都点不到（吉吉 2026-09-17 原话：「压在底下，我鼠标点击不到」）。
     用命中栈找 —— elementsFromPoint 连被挡住的也一并返回，顺序就是从上到下。
     🔴 面积必须跟这层差不多（0.25～4 倍）：不卡这一条，选中一个小按钮时会把它底下整页的大 banner
        当成「这个按钮的图」。 */
  function underFill(el, r) {
    if (!document.elementsFromPoint || !r.width || !r.height) return null;
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cx < 0 || cy < 0 || cx > (window.innerWidth || 0) || cy > (window.innerHeight || 0)) return null;
    var st = document.elementsFromPoint(cx, cy) || [];
    var k = Array.prototype.indexOf.call(st, el); if (k < 0) return null;
    var area = Math.max(1, r.width * r.height);
    for (var j = k + 1; j < st.length; j++) {
      var c = st[j];
      if (c === document.body || c === document.documentElement) break;
      if (!editable(c)) continue;
      var f = imgFill(c, getComputedStyle(c)); if (!f) continue;
      var cr = c.getBoundingClientRect(), ratio = (cr.width * cr.height) / area;
      if (ratio < 0.25 || ratio > 4) continue;
      return { i: idx(c), tag: c.tagName.toLowerCase(), label: label(c), how: 'under', fill: f,
        alt: c.tagName.toLowerCase() === 'img' ? (c.getAttribute('alt') || '') : null,
        classes: Array.prototype.slice.call(c.classList || []),
        rect: { w: Math.round(cr.width), h: Math.round(cr.height) } };
    }
    return null;
  }

  /* ── 选中信息（发给右侧属性面板） ── */
  function info(el) {
    if (!el) return null;
    var cs = getComputedStyle(el), r = el.getBoundingClientRect(), tag = el.tagName.toLowerCase();
    var path = []; for (var p = el.parentElement; p && p !== document.documentElement && path.length < 6; p = p.parentElement) if (editable(p)) path.unshift({ i: idx(p), label: label(p) });
    var pcs = el.parentElement ? getComputedStyle(el.parentElement) : null;
    var textOnly = isTextOnly(el);
    var inl = {}; for (var k = 0; k < el.style.length; k++) { var pn = el.style[k]; inl[pn] = el.style.getPropertyValue(pn); }
    var ps = prevSib(el), ns = nextSib(el);
    var myFill = imgFill(el, cs);
    return {
      i: idx(el), tag: tag, label: label(el), id: el.id || '', classes: Array.prototype.slice.call(el.classList || []),
      generated: idx(el) == null, textOnly: textOnly, text: textOnly ? el.textContent : null,
      leaf: !!LEAF[tag], isImg: tag === 'img', src: tag === 'img' ? el.getAttribute('src') : null, alt: tag === 'img' ? el.getAttribute('alt') : null,
      fill: myFill, innerFill: myFill ? null : (innerFill(el, r) || underFill(el, r)), bgMask: maskOf(cs.backgroundImage),
      href: tag === 'a' ? el.getAttribute('href') : null,
      textAll: (el.innerText || el.textContent || '').trim().slice(0, 300),
      svg: tag === 'svg' ? { paths: Array.prototype.map.call(el.querySelectorAll('path[d]'), function (p) { return p.getAttribute('d').replace(/\s+/g, ' ').trim().slice(0, 4000); }), attrs: { width: el.getAttribute('width'), height: el.getAttribute('height'), viewBox: el.getAttribute('viewBox'), class: el.getAttribute('class'), style: el.getAttribute('style'), fill: el.getAttribute('fill') }, usesCurrentColor: /currentColor/i.test(el.outerHTML), html: el.outerHTML.slice(0, 60000), w: Math.round(r.width), h: Math.round(r.height) } : null,
      firstHref: tag === 'a' ? el.getAttribute('href') : (function () { var a = el.querySelector && el.querySelector('a[href]'); return a ? a.getAttribute('href') : null; })(),
      firstImg: tag === 'img' ? el.getAttribute('src') : (function () { var m = el.querySelector && el.querySelector('img[src]'); return m ? m.getAttribute('src') : null; })(),
      structural: structural(el), prev: ps ? idx(ps) : null, next: ns ? idx(ns) : null, path: path,
      rect: { w: Math.round(r.width), h: Math.round(r.height) },
      inline: inl,
      cs: {
        display: cs.display, position: cs.position, flexDirection: cs.flexDirection, justifyContent: cs.justifyContent, alignItems: cs.alignItems, gap: cs.gap, flexWrap: cs.flexWrap,
        width: cs.width, height: cs.height, boxSizing: cs.boxSizing,
        fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, lineHeight: cs.lineHeight, color: cs.color, textAlign: cs.textAlign, letterSpacing: cs.letterSpacing,
        backgroundColor: cs.backgroundColor, opacity: cs.opacity,
        paddingTop: cs.paddingTop, paddingRight: cs.paddingRight, paddingBottom: cs.paddingBottom, paddingLeft: cs.paddingLeft,
        marginTop: cs.marginTop, marginRight: cs.marginRight, marginBottom: cs.marginBottom, marginLeft: cs.marginLeft,
        borderTopWidth: cs.borderTopWidth, borderTopColor: cs.borderTopColor, borderTopStyle: cs.borderTopStyle, borderRadius: cs.borderTopLeftRadius,
        boxShadow: cs.boxShadow
      },
      parentFlex: !!(pcs && /flex|grid/.test(pcs.display)), parentDir: pcs ? pcs.flexDirection : ''
    };
  }

  /* ── 选中 / 悬停 ── */
  function select(el, quiet) {
    if (editing && editing !== el) stopEdit(true);
    sel = editable(el) || (el && idx(el) == null && el !== document.documentElement) ? el : null;
    draw();
    if (!quiet) post({ __uwEdit: 'sel', info: info(sel) });
  }
  function selectByIndex(i) {
    if (i == null) { select(null); return; }
    var el = document.querySelector('[data-uw-i="' + i + '"]');
    if (el) { select(el); try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {} draw(); }
    else select(null);
  }
  /* 🔴 选框和手柄不在这一层画了，改由外面（renderer）画在画布外面。
     原因：这一层的东西一律画在页面视口里，贴边的元素选中后，往外让的那 2px 和挂在框外的手柄
     统统落到视口外被裁掉 —— 先后打了三个补丁（夹回视口 / 手柄收进来 / 画布改直角）都是治标。
     搬出去之后画布边界对它不再是约束，吉吉 2026-09-17 要的「直接超出、不局限在页面里」也就成立了。
     这里只负责把选中元素的位置尺寸报上去，位置变了才报。 */
  function selRect() {
    if (!sel || !document.documentElement.contains(sel)) return null;
    var r = sel.getBoundingClientRect(), cs = getComputedStyle(sel);
    var rad = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map(function (v) {
      var n = parseFloat(v) || 0; if (/%/.test(v)) n = Math.min(r.width, r.height) * n / 100; return n;
    });
    return { l: r.left, t: r.top, w: r.width, h: r.height, rad: rad, lab: Math.round(r.width) + ' × ' + Math.round(r.height),
      inl: cs.display === 'inline' || (!!LEAF[sel.tagName.toLowerCase()] && sel.tagName !== 'IMG'), editing: !!editing };
  }
  function draw() {
    if (!root) return;
    if (sel && !document.documentElement.contains(sel)) { sel = null; post({ __uwEdit: 'sel', info: null }); }
    boxSel.style.display = 'none';
    var rc = selRect(), key = rc ? [rc.l, rc.t, rc.w, rc.h, rc.editing, rc.inl].join(',') : '';
    if (key !== lastRect) { lastRect = key; post({ __uwEdit: 'rect', r: rc }); }
    if (hov && hov !== sel && !drag && !resize && !editing) {
      placeAround(boxHov, hov, 1);
      boxHov.querySelector('.tag').textContent = label(hov) + (idx(hov) == null ? ' · 脚本生成' : '');
    } else boxHov.style.display = 'none';
    drawGaps(GAPS && hov && !drag && !resize && !editing ? hov : null);
    try { window.__uwHov = hov ? label(hov) : null; } catch (e) {}   // 只给门用，方便定位「标尺没收起来」时鼠标其实停在哪
  }
  /* 这一块跟上下左右最近的邻居各差多少。没有邻居的那一侧，量到**父容器的边**，
     不是量到 padding 以内 —— 人眼看到的那段空白包含 padding，量到内边的话满宽的块会一律报 0，等于没量。
     只取同一父级里、在这个方向上确实有重叠的兄弟 —— 斜着的那些量出来没有意义。 */
  function gapsOf(el) {
    var out = [], p = el.parentElement; if (!p) return out;
    if (el === document.body || el === document.documentElement) return out;
    var r = el.getBoundingClientRect(); if (!r.width && !r.height) return out;
    var pr = p.getBoundingClientRect();
    var up = null, dn = null, lf = null, rt = null;
    for (var c = p.firstElementChild; c; c = c.nextElementSibling) {
      if (c === el || !editable(c) || (root && c === root)) continue;
      var q = c.getBoundingClientRect(); if (!q.width && !q.height) continue;
      var xOver = Math.min(r.right, q.right) - Math.max(r.left, q.left) > 1;
      var yOver = Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top) > 1;
      if (xOver && q.bottom <= r.top + 0.5 && (!up || q.bottom > up.bottom)) up = q;
      if (xOver && q.top >= r.bottom - 0.5 && (!dn || q.top < dn.top)) dn = q;
      if (yOver && q.right <= r.left + 0.5 && (!lf || q.right > lf.right)) lf = q;
      if (yOver && q.left >= r.right - 0.5 && (!rt || q.left < rt.left)) rt = q;
    }
    var cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    out.push({ v: 1, a: up ? up.bottom : pr.top, b: r.top, c: up ? (Math.max(r.left, up.left) + Math.min(r.right, up.right)) / 2 : cx });
    out.push({ v: 1, a: r.bottom, b: dn ? dn.top : pr.bottom, c: dn ? (Math.max(r.left, dn.left) + Math.min(r.right, dn.right)) / 2 : cx });
    out.push({ v: 0, a: lf ? lf.right : pr.left, b: r.left, c: lf ? (Math.max(r.top, lf.top) + Math.min(r.bottom, lf.bottom)) / 2 : cy });
    out.push({ v: 0, a: r.right, b: rt ? rt.left : pr.right, c: rt ? (Math.max(r.top, rt.top) + Math.min(r.bottom, rt.bottom)) / 2 : cy });
    return out;
  }
  function drawGaps(el) {
    var list = el ? gapsOf(el) : [];
    for (var i = 0; i < msrs.length; i++) {
      var m = msrs[i], g = list[i], d = g ? g.b - g.a : 0;
      /* 0 和贴着的不画（没什么可看的），特别远的也不画（多半不是同一组东西，画了只是噪音） */
      if (!g || d < 1.5 || d > 600) { m.style.display = 'none'; continue; }
      m.className = 'msr ' + (g.v ? 'v' : 'hz');
      m.style.display = 'block';
      if (g.v) { m.style.left = (g.c - 8) + 'px'; m.style.top = g.a + 'px'; m.style.width = '17px'; m.style.height = d + 'px'; }
      else { m.style.left = g.a + 'px'; m.style.top = (g.c - 8) + 'px'; m.style.width = d + 'px'; m.style.height = '17px'; }
      var lb = m.querySelector('b');
      lb.textContent = String(Math.round(d));
      lb.style.left = ''; lb.style.top = '';
      var vw2 = document.documentElement.clientWidth, vh2 = document.documentElement.clientHeight, PAD = 18;
      if (g.v) { var cy2 = g.a + d / 2; if (cy2 < PAD) lb.style.top = (PAD - g.a) + 'px'; else if (cy2 > vh2 - PAD) lb.style.top = (vh2 - PAD - g.a) + 'px'; }
      else { var cx2 = g.a + d / 2; if (cx2 < PAD) lb.style.left = (PAD - g.a) + 'px'; else if (cx2 > vw2 - PAD) lb.style.left = (vw2 - PAD - g.a) + 'px'; }
    }
  }
  function startTick() { if (tick) return; tick = setInterval(draw, 120); window.addEventListener('scroll', draw, true); window.addEventListener('resize', draw); }
  function stopTick() { if (!tick) return; clearInterval(tick); tick = null; window.removeEventListener('scroll', draw, true); window.removeEventListener('resize', draw); }

  /* ── 双击改字 ── */
  function startEdit(el) {
    if (!isTextOnly(el) || !editable(el)) return false;
    editing = el; el.__uwOld = el.textContent;
    el.setAttribute('data-uw-editing', '1');
    try { el.contentEditable = 'plaintext-only'; } catch (e) { el.contentEditable = 'true'; }
    if (el.contentEditable !== 'plaintext-only' && el.contentEditable !== 'true') el.contentEditable = 'true';
    el.focus();
    try { var rg = document.createRange(); rg.selectNodeContents(el); var s = getSelection(); s.removeAllRanges(); s.addRange(rg); } catch (e) {}
    el.addEventListener('blur', onEditBlur);
    draw(); post({ __uwEdit: 'editing', on: true });
    return true;
  }
  function onEditBlur() { if (editing) stopEdit(true); }
  function stopEdit(commit) {
    var el = editing; if (!el) return; editing = null;
    el.removeEventListener('blur', onEditBlur);
    el.contentEditable = 'false'; el.removeAttribute('contenteditable'); el.removeAttribute('data-uw-editing');
    try { getSelection().removeAllRanges(); } catch (e) {}
    var old = el.__uwOld; delete el.__uwOld;
    var now = el.textContent;
    if (commit && now !== old) post({ __uwEdit: 'op', ops: [{ op: 'text', i: idx(el), tag: el.tagName, text: now, old: old, label: label(el) }], kind: 'text' });
    else if (!commit) el.textContent = old;
    draw(); post({ __uwEdit: 'editing', on: false }); post({ __uwEdit: 'sel', info: info(sel) });
  }

  /* ── 结构操作 ── */
  function opRemove() { if (!sel || !structural(sel)) return; post({ __uwEdit: 'op', ops: [{ op: 'remove', i: idx(sel), tag: sel.tagName, label: label(sel) }], kind: 'remove', scroll: window.scrollY }); }
  function opDup() { if (!sel || !structural(sel)) return; post({ __uwEdit: 'op', ops: [{ op: 'duplicate', i: idx(sel), tag: sel.tagName, label: label(sel) }], kind: 'duplicate', scroll: window.scrollY }); }
  function opMove(to, where) { if (!sel || !structural(sel) || !to) return; post({ __uwEdit: 'op', ops: [{ op: 'move', i: idx(sel), tag: sel.tagName, to: idx(to), where: where, label: label(sel) }], kind: 'move', scroll: window.scrollY }); }
  /* 图标改色。飞鹊的 svg 把 fill 写死在 path 上，CSS 的 color 推不动它，所以要就地把主墨色换成 currentColor。
     🔴 为什么放在探针里做，不在外面拼字符串：① 在真 DOM 上改，预览当场就变 ② 写回文件的是**克隆体**，
     能把探针自己加的 data-uw-i 洗掉 —— 编号写进源码会造成重号，之后一改就报「元素对不上」，而且是永久的
     ③ style 用元素当前真实的那一条，不会被展开成 border-top-color 这种一长串长写法。 */
  function svgColor(i, hex) {
    var el = i === idx(sel) ? sel : document.querySelector('[data-uw-i="' + i + '"]');
    if (!el || el.tagName.toLowerCase() !== 'svg') return;
    var nodes = [el].concat(Array.prototype.slice.call(el.querySelectorAll('*')));
    var ATTR = ['fill', 'stroke'], cnt = {}, j, k, v;
    for (j = 0; j < nodes.length; j++) for (k = 0; k < 2; k++) {
      v = nodes[j].getAttribute(ATTR[k]);
      if (!v || /^(none|currentcolor|transparent|inherit)$/i.test(v) || v.slice(0, 4) === 'url(') continue;
      cnt[v] = (cnt[v] || 0) + 1;
    }
    var keys = Object.keys(cnt).sort(function (x, y) { return cnt[y] - cnt[x]; });
    if (!keys.length) { post({ __uwEdit: 'note', text: '这个图标的颜色不写在图标里（多半在CSS里），面板改不动，让Claude改样式' }); return; }
    var main = keys[0];
    for (j = 0; j < nodes.length; j++) for (k = 0; k < 2; k++) if (nodes[j].getAttribute(ATTR[k]) === main) nodes[j].setAttribute(ATTR[k], 'currentColor');
    var st = (el.getAttribute('style') || '').replace(/(^|;)\s*color\s*:[^;]*/i, '$1').replace(/;{2,}/g, ';').replace(/^;|;$/g, '');
    el.setAttribute('style', (st ? st + ';' : '') + 'color:' + hex);
    var clone = el.cloneNode(true), all = [clone].concat(Array.prototype.slice.call(clone.querySelectorAll('*')));
    for (j = 0; j < all.length; j++) { all[j].removeAttribute('data-uw-i'); all[j].removeAttribute('data-uw-editing'); }
    draw();
    post({ __uwEdit: 'op', ops: [{ op: 'replace', i: i, tag: 'svg', html: clone.outerHTML, what: '图标颜色 ' + hex, label: label(el) }], kind: 'replace' });
    if (keys.length > 1) post({ __uwEdit: 'note', text: '这个图标有 ' + keys.length + ' 种颜色，只改了主色 ' + main + '，其余留着' });
  }
  function applyStyle(i, set, save) {
    var el = i === idx(sel) ? sel : document.querySelector('[data-uw-i="' + i + '"]'); if (!el) return;
    for (var p in set) { if (set[p] == null || set[p] === '') el.style.removeProperty(p); else el.style.setProperty(p, String(set[p])); }
    draw();
    if (save) post({ __uwEdit: 'op', ops: [{ op: 'style', i: i, tag: el.tagName, set: set, label: label(el) }], kind: 'style' });
  }

  /* ── 鼠标 ── */
  function onMove(e) {
    if (!ON) return;
    if (resize) {
      var dx = e.clientX - resize.x, dy = e.clientY - resize.y, set = {};
      if (/e/.test(resize.dir)) set.width = Math.max(1, Math.round(resize.w + dx)) + 'px';
      if (/s/.test(resize.dir)) set.height = Math.max(1, Math.round(resize.h + dy)) + 'px';
      resize.set = set; applyStyle(idx(sel), set, false); return;
    }
    if (drag) {
      if (!drag.sibs.length) return;
      if (!drag.on) { if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < 6) return; drag.on = true; hov = null; }
      var r0 = sel.getBoundingClientRect();
      place(ghost, { left: e.clientX - drag.ox, top: e.clientY - drag.oy, width: r0.width, height: r0.height });
      var best = null, bd = 1e9, list = drag.sibs;
      for (var k = 0; k < list.length; k++) {
        var r = list[k].getBoundingClientRect(); if (!r.width && !r.height) continue;
        var cx = Math.max(r.left, Math.min(e.clientX, r.right)), cy = Math.max(r.top, Math.min(e.clientY, r.bottom));
        var d = Math.hypot(e.clientX - cx, e.clientY - cy);
        if (d < bd) { bd = d; best = { el: list[k], r: r }; }
      }
      drag.to = null; insLine.style.display = 'none';
      if (!best || bd > 120) return;
      var horiz = drag.horiz, before = horiz ? e.clientX < (best.r.left + best.r.right) / 2 : e.clientY < (best.r.top + best.r.bottom) / 2;
      drag.to = best.el; drag.where = before ? 'before' : 'after';
      insLine.className = 'ins ' + (horiz ? 'v' : 'hz');
      if (horiz) place(insLine, { left: (before ? best.r.left : best.r.right) - 1, top: best.r.top, width: 2, height: best.r.height });
      else place(insLine, { left: best.r.left, top: (before ? best.r.top : best.r.bottom) - 1, width: best.r.width, height: 2 });
      return;
    }
    if (editing) return;
    var el = pick(e.clientX, e.clientY);
    if (el !== hov) { hov = el; draw(); }
  }
  function onDown(e) {
    if (!ON || fromUI(e) || e.button !== 0) return;
    var el = pick(e.clientX, e.clientY);
    /* 编辑态下点链接默认只选中、不跳走（不然改稿时一点就跑）。多页面的稿子要走流程时，
       按住 ⌘（Windows 是 ctrl）再点＝真的跳过去，外面的「当前文件」会跟着换（吉吉 2026-09-17 问的）。 */
    if ((e.metaKey || e.ctrlKey) && el) {
      var a = el.closest ? el.closest('a[href]') : null;
      var href = a && a.getAttribute('href');
      if (href && !/^(#|javascript:|mailto:|tel:)/i.test(href)) { e.preventDefault(); e.stopPropagation(); location.href = a.href; return; }
    }
    if (editing) { if (el && editing.contains(el)) return; stopEdit(true); }
    e.preventDefault(); e.stopPropagation();
    try { root.focus({ preventScroll: true }); } catch (x) {}
    if (!el) { select(null); return; }
    var child = null;
    /* 已经选中某块，再按在它身上 → 准备拖它换位置（没拖动、松手时就改选按到的那个子元素）；按在别处 → 换选中 */
    if (sel && (el === sel || sel.contains(el))) { if (el !== sel) child = el; } else select(el);
    if (!sel) return;
    drag = { x: e.clientX, y: e.clientY, sibs: [], on: false, to: null, child: child };
    if (structural(sel) && sibs(sel).length) {
      var r = sel.getBoundingClientRect(), list = sibs(sel), horiz = false;
      if (list.length) { var a = list[0].getBoundingClientRect(); horiz = Math.abs(a.top - r.top) < Math.max(4, Math.min(a.height, r.height) / 2) && a.left !== r.left; }
      var pcs = getComputedStyle(sel.parentElement); if (/flex/.test(pcs.display)) horiz = !/column/.test(pcs.flexDirection);
      drag.ox = e.clientX - r.left; drag.oy = e.clientY - r.top; drag.sibs = list; drag.horiz = horiz;
    }
  }
  function onUp(e) {
    if (!ON) return;
    if (resize) { var rs = resize; resize = null; if (rs.set && (rs.set.width || rs.set.height)) applyStyle(idx(sel), rs.set, true); post({ __uwEdit: 'sel', info: info(sel) }); return; }
    if (drag) {
      var d = drag; drag = null; ghost.style.display = 'none'; insLine.style.display = 'none';
      if (d.on) { e.preventDefault(); e.stopPropagation(); if (d.to) opMove(d.to, d.where); }
      else if (d.child && editable(d.child)) select(d.child);
      return;
    }
  }
  /* 鼠标移出预览区（比如挪到右边的面板上）：悬停框和间距标尺要跟着收，不然会挂在画布上不走 */
  function onLeave(e) { if (!ON || (e && e.relatedTarget)) return; if (hov) { hov = null; draw(); } }
  function onClick(e) { if (!ON || fromUI(e)) return; if (editing && editing.contains(e.target)) return; e.preventDefault(); e.stopPropagation(); }
  function onDbl(e) {
    if (!ON || fromUI(e)) return; e.preventDefault(); e.stopPropagation();
    if (editing) return;
    var el = pick(e.clientX, e.clientY); if (!el) return;
    /* 双击：文字块直接进入改字；容器则钻进去选最里层被点到的元素 */
    var t = el; while (t && t !== document.body && !isTextOnly(t)) { if (editable(t)) break; t = t.parentElement; }
    if (isTextOnly(el) && editable(el)) { select(el, true); startEdit(el); }
    else select(el);
  }
  function onKey(e) {
    if (!ON) return;
    var meta = e.metaKey || e.ctrlKey;
    if (editing) {
      if (e.key === 'Escape') { e.preventDefault(); stopEdit(false); }
      else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); stopEdit(true); }
      return;
    }
    if (meta && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); post({ __uwEdit: e.shiftKey ? 'redo' : 'undo' }); return; }
    if (meta && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); opDup(); return; }
    if (meta && e.key === 'ArrowUp') { e.preventDefault(); if (sel) opMove(prevSib(sel), 'before'); return; }
    if (meta && e.key === 'ArrowDown') { e.preventDefault(); if (sel) opMove(nextSib(sel), 'after'); return; }
    if (meta) return;
    if (!sel) return;
    if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); opRemove(); }
    else if (e.key === 'Escape') { e.preventDefault(); select(null); }
    else if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); var p = sel.parentElement; while (p && !editable(p)) p = p.parentElement; if (p && p !== document.documentElement) select(p); }
    else if (e.key === 'Enter') { e.preventDefault(); if (!startEdit(sel)) { var c = sel.firstElementChild; while (c && !editable(c)) c = c.nextElementSibling; if (c) select(c); } }
    else if (e.key === 'Tab') { e.preventDefault(); var n = e.shiftKey ? prevSib(sel) : nextSib(sel); if (n) select(n); }
  }
  function swallow(e) { if (ON && !fromUI(e)) { e.preventDefault(); e.stopPropagation(); } }
  /* 右键 = 「这个位置下面都有什么」。点哪选哪只能选到最上层，被盖住的底图、叠在下面的兄弟永远点不到
     （吉吉 2026-09-17 的头像盖底图那张）。Figma 的解法是右键 → Select layer 列出光标下所有层，这里照做：
     把 elementsFromPoint 的整个命中栈（只留源码里有编号的、svg 收成一个、去重）报给外面弹菜单。 */
  function onCtx(e) {
    if (!ON || fromUI(e)) return;
    e.preventDefault(); e.stopPropagation();
    var list = document.elementsFromPoint(e.clientX, e.clientY), out = [], seen = {};
    for (var k = 0; k < list.length && out.length < 12; k++) {
      var el = list[k];
      if (root && (el === root || root.contains(el))) continue;
      if (el === document.documentElement) break;
      while (el.ownerSVGElement) el = el.ownerSVGElement;
      if (!editable(el)) continue;
      var i = idx(el); if (seen[i]) continue; seen[i] = 1;
      out.push({ i: i, label: label(el), tag: el.tagName.toLowerCase(), on: el === sel });
    }
    post({ __uwEdit: 'stack', x: e.clientX, y: e.clientY, list: out });
  }
  /* 🔴 要改 hov 这个状态再 draw()，不能绕开它直接摆框：draw() 每 120ms 按 hov 重画悬停框，
        直接摆的框下一帧就被画回右键前最后悬停的那个元素（真机测出来的：菜单悬停 hero，页面亮的还是 avatar；
        e2e 里 60ms 内断言恰好抢在重画之前，绿得是假的）。 */
  function hint(i) {
    var el = i == null ? null : document.querySelector('[data-uw-i="' + i + '"]');
    hov = el || null; draw();
  }

  /* ── 从组件栏拖砖进来 ──
     dataTransfer 里带 text/uw-component。落点判定：指针在元素中间 60% ＝ 替换（整块高亮），靠边 ＝ 插到前/后（插入线）。
     判定跟拖拽换序共用一套感觉，用户不用学第二套。 */
  function isCompDrag(e) { var t = e.dataTransfer && e.dataTransfer.types; if (!t) return false; for (var k = 0; k < t.length; k++) if (t[k] === 'text/uw-component') return true; return false; }
  function dropTarget(e) {
    var el = pick(e.clientX, e.clientY);
    while (el && !editable(el)) el = el.parentElement;
    if (!el || el === document.body || el === document.documentElement) return el === document.body ? { el: el, mode: 'append' } : null;
    var r = el.getBoundingClientRect();
    var pcs = el.parentElement ? getComputedStyle(el.parentElement) : null;
    var horiz = !!(pcs && /flex/.test(pcs.display) && !/column/.test(pcs.flexDirection)) || getComputedStyle(el).display === 'inline-block' || getComputedStyle(el).display === 'inline';
    var t = horiz ? (e.clientX - r.left) / Math.max(1, r.width) : (e.clientY - r.top) / Math.max(1, r.height);
    if (t < 0.2) return { el: el, mode: 'before', horiz: horiz, r: r };
    if (t > 0.8) return { el: el, mode: 'after', horiz: horiz, r: r };
    return { el: el, mode: 'replace', r: r };
  }
  function showDrop(t) {
    insLine.style.display = 'none'; dropBox.style.display = 'none'; boxHov.style.display = 'none'; drawGaps(null);
    if (!t) return;
    if (t.mode === 'replace') { place(dropBox, t.r); dropBox.querySelector('.tag').textContent = '替换 ' + label(t.el); return; }
    if (t.mode === 'append') { var b = document.body.getBoundingClientRect(); place(dropBox, { left: b.left, top: Math.max(0, b.bottom - 40), width: b.width, height: 40 }); dropBox.querySelector('.tag').textContent = '加到页面末尾'; return; }
    insLine.className = 'ins ' + (t.horiz ? 'v' : 'hz');
    var before = t.mode === 'before', r = t.r;
    if (t.horiz) place(insLine, { left: (before ? r.left : r.right) - 1, top: r.top, width: 2, height: r.height });
    else place(insLine, { left: r.left, top: (before ? r.top : r.bottom) - 1, width: r.width, height: 2 });
  }
  function onDragOver(e) {
    if (!ON || !isCompDrag(e)) return;
    e.preventDefault(); e.stopPropagation();
    try { e.dataTransfer.dropEffect = 'copy'; } catch (x) {}
    dropState = dropTarget(e); showDrop(dropState);
  }
  function onDragLeave(e) { if (!ON) return; if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) { dropState = null; showDrop(null); } }
  function onDrop(e) {
    if (!ON || !isCompDrag(e)) return;
    e.preventDefault(); e.stopPropagation();
    var id = ''; try { id = e.dataTransfer.getData('text/uw-component'); } catch (x) {}
    var t = dropTarget(e); dropState = null; showDrop(null);
    if (!id || !t) return;
    if (t.mode === 'append') { var last = document.body.lastElementChild; while (last && (!editable(last) || last === root)) last = last.previousElementSibling; if (!last) return; post({ __uwEdit: 'drop', component: id, i: idx(last), tag: last.tagName, mode: 'after', scroll: window.scrollY }); return; }
    var inf = t.mode === 'replace' ? info(t.el) : null;
    post({ __uwEdit: 'drop', component: id, i: idx(t.el), tag: t.el.tagName, mode: t.mode, label: label(t.el), scroll: window.scrollY,
      keep: inf ? { text: inf.textOnly ? inf.text : inf.textAll, href: inf.firstHref, src: inf.firstImg } : null });
  }
  /* 组件属性切档：换类名，立刻生效 */
  function applyClass(i, add, remove, save) {
    var el = document.querySelector('[data-uw-i="' + i + '"]'); if (!el) return;
    (remove || []).forEach(function (c) { if (c) el.classList.remove(c); });
    (add || []).forEach(function (c) { if (c) el.classList.add(c); });
    draw();
    if (save) post({ __uwEdit: 'op', ops: [{ op: 'class', i: i, tag: el.tagName, add: add || [], remove: remove || [], label: label(el) }], kind: 'class' });
  }

  function enable() {
    if (ON) return; ON = true; ensureUI(); pageStyle(true); startTick();
    window.addEventListener('mousemove', onMove, true); window.addEventListener('mousedown', onDown, true);
    document.addEventListener('mouseleave', onLeave, true);
    window.addEventListener('mouseup', onUp, true); window.addEventListener('click', onClick, true);
    window.addEventListener('dblclick', onDbl, true); window.addEventListener('keydown', onKey, true);
    window.addEventListener('submit', swallow, true); window.addEventListener('contextmenu', onCtx, true);
    window.addEventListener('dragstart', swallow, true);
    window.addEventListener('dragover', onDragOver, true); window.addEventListener('drop', onDrop, true); window.addEventListener('dragleave', onDragLeave, true);
  }
  function disable() {
    if (!ON) return; if (editing) stopEdit(true); ON = false; sel = null; hov = null; drag = null; resize = null; draw(); pageStyle(false); stopTick();
    window.removeEventListener('mousemove', onMove, true); window.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('mouseleave', onLeave, true);
    window.removeEventListener('mouseup', onUp, true); window.removeEventListener('click', onClick, true);
    window.removeEventListener('dblclick', onDbl, true); window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('submit', swallow, true); window.removeEventListener('contextmenu', onCtx, true);
    window.removeEventListener('dragstart', swallow, true);
    window.removeEventListener('dragover', onDragOver, true); window.removeEventListener('drop', onDrop, true); window.removeEventListener('dragleave', onDragLeave, true);
    if (dropBox) dropBox.style.display = 'none';
  }

  window.addEventListener('message', function (e) {
    var d = e.data; if (!d || d.__uwEditCmd == null || e.source !== window.parent) return;
    switch (d.__uwEditCmd) {
      case 'on': enable(); if (d.scroll != null) try { window.scrollTo(0, d.scroll); } catch (x) {} if (d.select != null) selectByIndex(d.select); break;
      case 'off': disable(); break;
      case 'select': selectByIndex(d.i); break;
      case 'hint': hint(d.i); break;   // 右键菜单里悬停某一层，页面上预亮它
      case 'style': applyStyle(d.i, d.set || {}, !!d.save); break;
      case 'svgcolor': svgColor(d.i, d.hex); break;
      case 'gaps': GAPS = !!d.on; draw(); break;
      case 'text': { var el = document.querySelector('[data-uw-i="' + d.i + '"]'); if (el && isTextOnly(el)) { var old = el.textContent; el.textContent = d.text; if (d.save && old !== d.text) post({ __uwEdit: 'op', ops: [{ op: 'text', i: d.i, tag: el.tagName, text: d.text, old: old, label: label(el) }], kind: 'text' }); draw(); } break; }
      case 'attr': { var a = document.querySelector('[data-uw-i="' + d.i + '"]'); if (a) { if (d.value == null) a.removeAttribute(d.name); else a.setAttribute(d.name, d.value); draw(); if (d.save) post({ __uwEdit: 'op', ops: [{ op: 'attr', i: d.i, tag: a.tagName, name: d.name, value: d.value, label: label(a) }], kind: 'attr' }); } break; }
      case 'remove': opRemove(); break;
      case 'duplicate': opDup(); break;
      case 'moveUp': if (sel) opMove(prevSib(sel), 'before'); break;
      case 'moveDown': if (sel) opMove(nextSib(sel), 'after'); break;
      case 'edit': if (sel) startEdit(sel); break;
      case 'parent': if (sel) { var p = sel.parentElement; while (p && !editable(p)) p = p.parentElement; if (p && p !== document.documentElement) select(p); } break;
      case 'refresh': post({ __uwEdit: 'sel', info: info(sel) }); break;
      case 'class': applyClass(d.i, d.add, d.remove, !!d.save); if (d.i === idx(sel)) post({ __uwEdit: 'sel', info: info(sel) }); break;
      /* 换页面状态：只动预览里 body 的 state-* 类，**绝不写文件**。
         这一条是「控制台住在页面外面」的技术前提——页面自己不需要任何切态代码，
         交付给前端的就是干干净净的 HTML，那些 state-* 类正好是他要用的真实状态类。 */
      case 'state': setState(d.key, d.on); break;
      /* 演示用的假光标：把「这一步是点了哪儿」演出来。绝不写文件（跟 data-uw-i 同一条铁律）。 */
      case 'cursor': cursorTo(d.sel, d.ms || 600); break;
      case 'cursorOff': cursorOff(); break;
    }
  });
  /* 换态：互斥的主状态 state-*（一次一个）＋ 正交的叠加开关 on-*（可以同时挂几个）。
     🔴 两族一起重算，不能只动一族：只剥 state-* 的话，从「出结果＋OSS」切到「填写中」时
     on-oss 会留在身上，屏幕上出现一个谁都没选过的组合，而控制台还显示着「填写中」。
     绝不写文件（真机验过：换完源码里 body 还是 state-default）—— 交付给前端的必须是干净的。 */
  function setState(key, ons) {
    var b = document.body; if (!b) return;
    var keep = (b.className || '').split(/\s+/).filter(function (c) {
      return c && c.indexOf('state-') !== 0 && c.indexOf('on-') !== 0;
    });
    keep.push('state-' + (key || 'default'));
    /* ons 没传（老版本控制台、或者只想换主状态）就保留原来挂着的那些，别悄悄把人家关掉 */
    var list = ons;
    if (!list) { list = []; (b.className || '').split(/\s+/).forEach(function (c) { if (c.indexOf('on-') === 0) list.push(c.slice(3)); }); }
    for (var i = 0; i < list.length; i++) if (list[i]) keep.push('on-' + list[i]);
    b.className = keep.join(' ');
    post({ __uwEdit: 'state', key: key || '', on: list });
    draw();
  }
  /* ── 演示光标 ──────────────────────────────
     吉吉 2026-09-18：「剧本模式在展示操作的时候，应该配个鼠标移动的效果，
     让我看到他怎么点击操作，要不然没有什么实感」＋「让用户能感知到模拟操作的路径」。
     🔴 关键是**路径**不是终点：直接让光标闪现到目标，人看到的还是「页面自己变了」。
        要看见它从哪儿走到哪儿，才知道刚才那一下点的是哪个东西。
     🔴 这个元素绝不许进源码（跟 data-uw-i 同一条铁律）—— 它只活在预览的 DOM 里，
        编辑操作走的是 htmlmap 对源文件动刀，不读 DOM，所以碰不到它。 */
  var CUR = null, CURX = -1, CURY = -1;
  function cursorEl() {
    if (CUR && CUR.parentNode) return CUR;
    var w = document.createElement('div');
    w.setAttribute('data-uw-cursor', '1');
    w.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483646;pointer-events:none;' +
      'transition:transform .6s cubic-bezier(.33,.9,.3,1);will-change:transform;';
    w.innerHTML =
      '<svg width="22" height="30" viewBox="0 0 22 30" style="position:absolute;left:-2px;top:-2px;' +
      'filter:drop-shadow(0 2px 5px rgba(0,0,0,.35))"><path d="M2 2 L2 22 L7.5 17 L11 25.5 L14.5 24 L11 15.8 L18 15.2 Z" ' +
      'fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>' +
      '<i data-ring style="position:absolute;left:-17px;top:-17px;width:34px;height:34px;border-radius:50%;' +
      'border:2px solid #0071E3;opacity:0;transform:scale(.3)"></i>';
    (document.body || document.documentElement).appendChild(w);
    CUR = w;
    return w;
  }
  function cursorOff() { if (CUR && CUR.parentNode) CUR.parentNode.removeChild(CUR); CUR = null; CURX = CURY = -1; }
  function ring() {
    var el = cursorEl(), r = el.querySelector('[data-ring]');
    if (!r) return;
    r.style.transition = 'none'; r.style.opacity = '.9'; r.style.transform = 'scale(.3)';
    /* 强制回流，否则两次赋值会被合并成一次，动效整个不出现 */
    void r.offsetWidth;
    r.style.transition = 'transform .42s ease-out, opacity .42s ease-out';
    r.style.opacity = '0'; r.style.transform = 'scale(1.5)';
  }
  function cursorTo(sel, ms) {
    var t = null;
    try { t = sel ? document.querySelector(sel) : null; } catch (x) {}
    if (!t) { post({ __uwEdit: 'cursor', ok: false, why: 'nosel' }); return; }   // 找不到就不演，别演到一个错的地方去
    var wait = 0;
    var r0 = t.getBoundingClientRect();
    /* 目标在视口外时先滚过去 —— 不滚的话光标会移到屏幕外，人只看见它飞走了 */
    if (r0.bottom < 40 || r0.top > (window.innerHeight || 0) - 40) {
      try { t.scrollIntoView({ behavior: 'smooth', block: 'center' }); wait = 340; } catch (x) { try { t.scrollIntoView(); } catch (y) {} }
    }
    setTimeout(function () {
      var r = t.getBoundingClientRect();
      var x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
      var el = cursorEl();
      /* 第一次出现：从目标的左下方一段距离起步，让它「走」过来而不是凭空长在那儿 */
      if (CURX < 0) {
        CURX = Math.max(12, x - 160); CURY = Math.min((window.innerHeight || 600) - 12, y + 120);
        el.style.transition = 'none';
        el.style.transform = 'translate(' + CURX + 'px,' + CURY + 'px)';
        void el.offsetWidth;
      }
      /* 🔴 目标值必须**下一帧**再设。同一帧里连着设起点和终点，浏览器会把两次合并成一次，
         transition 压根不触发 —— 屏幕上就是「闪现」，而闪现的最终位置跟走过去是一样的，
         只验终点的门照样全绿（2026-09-18 实测：300ms 采样时它已经在终点了）。
         `void offsetWidth` 那一下回流救不了新建元素这种情形，rAF 才稳。 */
      requestAnimationFrame(function () {
        el.style.transition = 'transform ' + ms + 'ms cubic-bezier(.33,.9,.3,1)';
        el.style.transform = 'translate(' + x + 'px,' + y + 'px)';
        CURX = x; CURY = y;
        setTimeout(function () {
          ring();
          post({ __uwEdit: 'cursor', ok: true, x: x, y: y });
        }, ms);
      });
    }, wait);
  }

  function curState() {
    var b = document.body, out = '';
    if (b) (b.className || '').split(/\s+/).forEach(function (c) { if (c.indexOf('state-') === 0) out = c.slice(6); });
    return out;
  }
  function curOns() {
    var b = document.body, out = [];
    if (b) (b.className || '').split(/\s+/).forEach(function (c) { if (c.indexOf('on-') === 0) out.push(c.slice(3)); });
    return out;
  }
  var ready = function () { post({ __uwEdit: 'ready', n: document.querySelectorAll('[data-uw-i]').length, path: location.pathname, state: curState(), on: curOns() }); };
  if (document.readyState === 'complete') setTimeout(ready, 0); else window.addEventListener('load', ready);
})();
