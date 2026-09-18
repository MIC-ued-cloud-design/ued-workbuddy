'use strict';
/* ── 独立走查包 `_走查.html` ────────────────────────────────────
   吉吉 2026-09-17：「走查是我自己和给外部展示」。
   控制台的展示模式覆盖的是「他自己驱动着演示」；**对方拿不到 UW 就点不了**，所以还要一份能发出去的。

   🔴 为什么把页面**内联**进去，而不是 iframe src 指过去：
   走查页要在 iframe 外面换 `state-*` 类（这是「页面里不留切态代码」的前提）。
   用 `src=` 的话，对方双击打开是 `file://`，Chrome 一律禁止跨文档访问 —— 当场就废。
   `srcdoc` 继承父文档的源，同源，换类才成立。代价是这一份文件比较大（每页一份拷贝）。

   🔴 内联之后相对路径会以走查页自己的位置为基准算 —— 同目录时本来就对，
   但页面在子目录里就不对了，所以按页面自己的位置补一个 `<base>`（已经有 base 的不碰，克隆页几乎都有）。

   这一份是**交付时生成的产物**，不是维护源：页面改了重新生成一次就行，
   文件头会盖上生成时间和源文件的修改时间，一眼看得出它是不是旧的。 */

const fs = require('fs');
const path = require('path');

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const WALK_FILE = '_走查.html';

/* 把页面处理成能塞进 srcdoc 的样子 */
function prep(html, rel) {
  let out = String(html);
  const dir = path.posix.dirname(rel);
  if (!/<base\b/i.test(out) && dir && dir !== '.') {
    const base = `<base href="${esc(dir)}/">`;
    out = /<head[^>]*>/i.test(out) ? out.replace(/<head[^>]*>/i, m => m + '\n' + base) : base + out;
  }
  return out;
}

function build(d, opt) {
  opt = opt || {};
  const dir = opt.dir;
  const name = opt.projectName || '走查';
  const pages = [];
  let bytes = 0;
  for (const p of d.pages) {
    let html = '';
    try { html = fs.readFileSync(path.join(dir, p.rel), 'utf8'); } catch (e) { continue; }
    const body = prep(html, p.rel);
    bytes += Buffer.byteLength(body);
    let mtime = 0; try { mtime = fs.statSync(path.join(dir, p.rel)).mtimeMs; } catch (e) {}
    pages.push({ rel: p.rel, title: p.title, views: p.views || [], overlays: p.overlays || [],
      states: p.states.map(s => ({ key: s.key, name: s.name, when: s.when, view: s.view || '', sub: s.sub || s.key })), mtime, html: body });
  }
  const data = {
    name, at: Date.now(), entry: d.entry,
    scripts: (d.scripts || []).map(s => ({ name: s.name, steps: s.steps })),
    pages,
  };

  /* 页面正文用 JSON 塞进 script 标签：`</script>` 和 U+2028/2029 必须转义，不然会把宿主页面撕开 */
  /* `</script>` 会把宿主页面撕开；U+2028/2029 在 JS 源码里算换行，必须转义。
     这两个字符不能直接写进正则字面量（写进去当场就是语法错），用 charCode 构造。 */
  const LS = new RegExp(String.fromCharCode(0x2028), 'g'), PS = new RegExp(String.fromCharCode(0x2029), 'g');
  const json = JSON.stringify(data).replace(/<\/(script)/gi, '<\\/$1')
    .replace(LS, '\\u2028').replace(PS, '\\u2029');

  const doc = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(name)} · 走查</title>
<style>
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{font:13px/1.55 -apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",sans-serif;color:#1D1D1F;background:#F5F5F7;display:flex;flex-direction:column;overflow:hidden;-webkit-font-smoothing:antialiased}
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
[hidden]{display:none!important}
#bar{flex:0 0 auto;display:flex;align-items:center;gap:10px;padding:9px 14px;background:rgba(255,255,255,.82);backdrop-filter:saturate(180%) blur(20px);border-bottom:1px solid rgba(0,0,0,.07);position:relative;z-index:2}
#bar .nm{font-weight:600;white-space:nowrap}
#bar .sp{flex:1}
.sel{padding:5px 8px;border:1px solid #D2D2D7;border-radius:8px;background:#fff;font-size:12px;max-width:230px}
.b{padding:5px 12px;border:1px solid #D2D2D7;border-radius:8px;background:#fff;font-size:12px;white-space:nowrap}
.b:hover{background:#E8E8ED}
.b.pri{background:#0071E3;border-color:#0071E3;color:#fff}
.b.pri:hover{background:#0077ED}
.b:disabled{opacity:.4;cursor:default}
.at{font-size:11px;color:#86868B;font-family:ui-monospace,Menlo,monospace;min-width:44px;text-align:center}
#note{flex:0 0 auto;padding:10px 14px;background:#fff;border-bottom:1px solid #E8E8ED;font-size:13px;color:#1D1D1F}
#note:empty{display:none}
#stage{flex:1;min-height:0;position:relative;background:#F5F5F7;overflow:auto;display:flex;justify-content:center}
iframe{border:0;background:#fff;width:100%;height:100%;box-shadow:0 1px 2px rgba(0,0,0,.04),0 8px 30px rgba(0,0,0,.06)}
#hint{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);background:rgba(0,0,0,.78);color:#fff;font-size:12px;padding:7px 14px;border-radius:999px;z-index:3;opacity:0;transition:opacity .25s;pointer-events:none}
#hint.on{opacity:1}
#bar.hide{display:none}
.ons{display:inline-flex;gap:4px;align-items:center}
.ons .b{padding:2px 8px;font-size:11px}
</style></head>
<body>
<div id="bar">
  <span class="nm">${esc(name)}</span>
  <select id="pageSel" class="sel" title="选一个页面"></select>
  <select id="stateSel" class="sel" title="选一个状态（抽屉／浮层的态也在里面）"></select>
  <span id="onsBox" class="ons"></span>
  <span class="sp"></span>
  <select id="scSel" class="sel" title="按主线走"></select>
  <button id="prev" class="b">← 上一步</button>
  <span id="at" class="at">—</span>
  <button id="next" class="b pri">下一步 →</button>
  <button id="hideBar" class="b" title="把这条控制条收起来，只看页面（按 H 或 Esc 叫回来）">只看页面</button>
</div>
<div id="note"></div>
<div id="stage"><iframe id="fr" title="页面"></iframe></div>
<div id="hint">按 H 或 Esc 叫回控制条　·　← → 翻上一步下一步</div>

<script id="uwdata" type="application/json">${json}</script>
<script>
(function () {
  var D = JSON.parse(document.getElementById('uwdata').textContent);
  var fr = document.getElementById('fr'), bar = document.getElementById('bar'), note = document.getElementById('note');
  var pageSel = document.getElementById('pageSel'), stateSel = document.getElementById('stateSel'), scSel = document.getElementById('scSel');
  var at = document.getElementById('at'), prev = document.getElementById('prev'), next = document.getElementById('next');
  var play = { si: -1, i: -1 };

  for (var i = 0; i < D.pages.length; i++) pageSel.add(new Option(D.pages[i].title + '（' + D.pages[i].rel + '）', D.pages[i].rel));
  scSel.add(new Option('不走主线，自己点', '-1'));
  for (var k = 0; k < D.scripts.length; k++) scSel.add(new Option(D.scripts[k].name, String(k)));

  function pageOf(rel) { for (var i = 0; i < D.pages.length; i++) if (D.pages[i].rel === rel) return D.pages[i]; return null; }
  /* 抽屉／浮层的态也在这一个下拉里，但要带上它属于哪一屏。
     🔴 不带前缀的话，列表里会并排出现两个「默认」（主视图一个、抽屉一个），
     对方点哪个都不知道自己会看到什么 —— 走查包是发给没装 UW 的人用的，没有第二次解释的机会。 */
  function fillStates(p, cur) {
    stateSel.innerHTML = '';
    var vname = {};
    for (var j = 0; j < (p.views || []).length; j++) vname[p.views[j].key] = p.views[j].name;
    for (var i = 0; i < p.states.length; i++) {
      var s = p.states[i];
      var label = s.view ? (vname[s.view] || s.view) + ' · ' + s.name : s.name;
      var o = new Option(label, s.key);
      if (s.when) o.title = s.when;
      stateSel.add(o);
    }
    var has = cur && p.states.some(function (s) { return s.key === cur; });
    stateSel.value = has ? cur : (p.states[0] ? p.states[0].key : 'default');
  }
  /* 叠加开关：跟状态正交，可以同时开几个。没声明就整块不显示。 */
  var ONS = {};
  function fillOns(p) {
    var box = document.getElementById('onsBox'); if (!box) return;
    var list = p.overlays || [];
    box.innerHTML = '';
    box.style.display = list.length ? '' : 'none';
    for (var i = 0; i < list.length; i++) (function (o) {
      var b = document.createElement('button');
      b.className = 'b' + (ONS[o.key] ? ' pri' : '');
      b.textContent = o.name; b.title = o.when || ('on-' + o.key);
      b.onclick = function () { ONS[o.key] = !ONS[o.key]; b.className = 'b' + (ONS[o.key] ? ' pri' : ''); applyState(stateSel.value); };
      box.appendChild(b);
    })(list[i]);
  }
  /* 换态＝在 iframe 外面改根节点的类。页面自己一行切态的代码都没有，
     所以交付给前端的 HTML 是干净的，这些 state-* 类正好是他要用的真实状态类。 */
  function applyState(key) {
    try {
      var b = fr.contentDocument && fr.contentDocument.body; if (!b) return;
      /* 两族一起重算：state-* 互斥、on-* 正交。只剥一族的话，上一屏留下的叠加开关
         会挂到下一屏身上，而控制条上的按钮显示的还是另一回事。 */
      var keep = (b.className || '').split(/\\s+/).filter(function (c) {
        return c && c.indexOf('state-') !== 0 && c.indexOf('on-') !== 0;
      });
      keep.push('state-' + (key || 'default'));
      for (var k in ONS) if (ONS[k]) keep.push('on-' + k);
      b.className = keep.join(' ');
    } catch (e) {}
  }
  var pending = null, curRel = null;   /* 🔴 「现在装的是哪一页」得自己记：pageSel.value 在 change 事件里已经是新值了，
                                          拿它当「当前」来比，用下拉换页时会判成「没换」，iframe 根本不重装 */
  function show(rel, state, text) {
    var p = pageOf(rel); if (!p) return;
    note.textContent = text || '';
    if (curRel !== rel || !fr.srcdoc) {
      curRel = rel; pageSel.value = rel; fillStates(p, state); fillOns(p);
      pending = state || 'default';
      fr.onload = function () { applyState(pending); };
      fr.srcdoc = p.html;
    } else {
      fillStates(p, state); fillOns(p); applyState(state || 'default');
    }
  }
  pageSel.onchange = function () { show(pageSel.value, 'default', ''); play = { si: -1, i: -1 }; scSel.value = '-1'; sync(); };
  stateSel.onchange = function () { applyState(stateSel.value); };
  scSel.onchange = function () { play = { si: +scSel.value, i: -1 }; sync(); if (play.si >= 0) step(1); };

  function sync() {
    var sc = D.scripts[play.si];
    at.textContent = sc ? (play.i < 0 ? '—' : (play.i + 1) + ' / ' + sc.steps.length) : '—';
    prev.disabled = !sc || play.i <= 0;
    next.disabled = !sc || play.i >= sc.steps.length - 1;
  }
  function step(d) {
    var sc = D.scripts[play.si]; if (!sc) return;
    var n = play.i + d; if (n < 0 || n >= sc.steps.length) return;
    play.i = n; var s = sc.steps[n];
    show(s.rel, s.state, (n + 1) + '. ' + (s.note || s.rel));
    sync();
  }
  prev.onclick = function () { step(-1); };
  next.onclick = function () { step(1); };

  var hint = document.getElementById('hint'), hintT = null;
  function setBar(on) {
    bar.classList.toggle('hide', !on);
    if (!on) { hint.classList.add('on'); clearTimeout(hintT); hintT = setTimeout(function () { hint.classList.remove('on'); }, 2600); }
    else hint.classList.remove('on');
  }
  document.getElementById('hideBar').onclick = function () { setBar(false); };
  /* 键盘也要能用：演示时手不该离开键盘。iframe 拿到焦点时收不到，所以两边都挂 */
  function key(e) {
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key === 'h' || e.key === 'H' || e.key === 'Escape') { e.preventDefault(); setBar(bar.classList.contains('hide')); }
  }
  window.addEventListener('keydown', key);
  fr.addEventListener('load', function () { try { fr.contentDocument.addEventListener('keydown', key); } catch (e) {} });

  /* 开场：有主线就默认走第一条，没有就打开入口页 */
  if (D.scripts.length) { scSel.value = '0'; play = { si: 0, i: -1 }; step(1); }
  else { show(D.entry || (D.pages[0] && D.pages[0].rel), 'default', ''); sync(); }
})();
</script>
</body></html>`;
  return { html: doc, bytes: Buffer.byteLength(doc), pages: pages.length, inlined: bytes };
}

function writeInto(destDir, flowData, projectName) {
  const r = build(flowData, { dir: destDir, projectName });
  fs.writeFileSync(path.join(destDir, WALK_FILE), r.html);
  return { file: WALK_FILE, bytes: r.bytes, pages: r.pages };
}

module.exports = { build, writeInto, prep, WALK_FILE };
