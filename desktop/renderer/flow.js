'use strict';
/* 流程控制台（第二个窗口）的界面。
   四个视图各管一件事，别混：
     对照表 → 有没有漏（页 × 态，一屏看完，空格子就是没做的）
     铺开   → 长什么样（所有视图所有态真渲染出来并排，抽屉也在里面）
     流程   → 怎么走（只画页面节点；状态是同一节点的切面，画进来就变一团毛线）
     剧本   → 给外部展示时走哪条线（100 页丢给对方自己点，他会点进半成品）
     检查   → 七道门的结果
   本窗口不渲染页面，只发「去这一页的这个态」；真页面永远在主窗口那一个，
   所以主窗口那边是 100% 的页面，没有任何控制条压着——这就是「沉浸」的定义。 */

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const S = { id: null, data: null, view: 'grid', at: { rel: '', state: '', on: [] }, show: false, play: null,
  /* on = 当前开着的叠加开关（OSS客服视角那种）。它跟主状态正交，所以单独存一份，
     而不是拼进 at.state —— 拼进去的话每个格子都要写成「出结果+oss」，对照表会直接翻倍。 */
  on: new Set(),
  wall: { mode: 'states', rel: '', zoom: 26, html: new Map(), narrow: null },
  /* 流程图上一次算出来的布局（形状 + 边 + 每屏在第几列 + 底部带子多高）。
     存着是为了窗口变大小时只重解缩放、不重建 DOM。 */
  map: null };

/* 这个项目一共声明了哪些叠加开关（按 key 去重，跨页合并） */
function allOverlays(d) {
  const m = new Map();
  for (const p of (d.pages || [])) for (const o of (p.overlays || [])) if (!m.has(o.key)) m.set(o.key, o);
  return [...m.values()];
}
/* 视图分组：主视图（空 key）永远第一，其余按各页声明顺序合并去重。
   🔴 用 key 合并不是用名字 —— 两页都有 forecast 抽屉但名字写得不完全一样时，
   按名字合并会分裂成两组列，跨页比对当场失效。 */
function allViews(d) {
  const m = new Map([['', { key: '', name: '主视图', how: '', sel: '' }]]);
  for (const p of (d.pages || [])) for (const v of (p.views || [])) if (!m.has(v.key)) m.set(v.key, v);
  return [...m.values()];
}
/* 某一页某个视图下的状态，按 sub 取 */
function statesIn(p, viewKey) { return (p.states || []).filter(st => (st.view || '') === viewKey); }

/* ── 数据 ─────────────────────────────── */
async function scan(quiet) {
  if (!S.id) return;
  if (!quiet) $('#projSub').textContent = '扫描中…';
  const r = await uw.flowScan({ id: S.id });
  S.data = r && r.ok ? r : null;
  render();
}

/* 列头：按**视图**分组，组内才是状态。
   🔴 为什么非分组不可（2026-09-18 吉吉指出抽屉也算页面之后才想明白的）：
   对照表的全部价值是「空格子＝还没做」。把主页面的 `empty` 和抽屉的 `forecast-result`
   摆进同一排列头，两者根本不可比，空格会大面积变成「这一格压根不适用」——
   那一刻这张表就从覆盖清单退化成一张花纹，人扫一眼就不再信它了。
   分组之后，空格只在同一个视图内部产生，语义才重新成立。

   组内列：default 永远第一，其余按「出现在多少页」排，常用的靠左。
   🔴 同一个 sub 在不同页面可能起了不同的人话名（详情页的 error 叫「出错」，表单的叫「校验没过」）。
   表头只有一个格子，随便取一个会把另一页的状态归到一个它不叫的名字底下——看表的人会当成两回事。
   所以：名字一致才用名字，不一致就退回 key，把各页各自的叫法放进悬停提示。 */
function stateCols(d, viewKey) {
  const n = new Map(), names = new Map();
  for (const p of d.pages) for (const st of statesIn(p, viewKey)) {
    const k = st.sub || st.key;
    n.set(k, (n.get(k) || 0) + 1);
    const set = names.get(k) || new Map();
    if (st.name && st.name !== k) set.set(st.name, (set.get(st.name) || 0) + 1);
    names.set(k, set);
  }
  /* 基准态（页面正常的样子）永远排第一列，哪怕它不叫 default、哪怕只有一页有它。
     其余按「出现在多少页」排，常用的靠左。 */
  const base = [];
  for (const p of d.pages) for (const st of statesIn(p, viewKey)) {
    const k = st.sub || st.key;
    if ((st.base || k === 'default') && !base.includes(k)) base.push(k);
  }
  const keys = [...n.keys()].filter(k => !base.includes(k)).sort((a, b) => n.get(b) - n.get(a) || a.localeCompare(b));
  const ordered = [...base, ...keys];
  return ordered.map(k => {
    const set = names.get(k) || new Map(), vs = [...set.keys()];
    return { key: k, name: vs.length === 1 ? vs[0] : k, alias: vs, n: n.get(k) || 0 };
  });
}

/* 视图 + 它的列，跳过一列都没有的视图（声明了但一个态都没做的，归门去报，别在表里占一格空位） */
function gridGroups(d) {
  return allViews(d).map(v => ({ v, cols: stateCols(d, v.key) })).filter(g => g.cols.length);
}

/* 根节点该挂的完整类串（主状态 + 叠加开关），铺开和走查包共用同一套算法 */
function classesFor(stateKey, ons) {
  return ['state-' + (stateKey || 'default')].concat([...(ons || [])].map(k => 'on-' + k));
}

/* ── 渲染总入口 ─────────────────────────── */
function render() {
  const d = S.data;
  /* 报「屏」不报「页」：一个 html 带三个抽屉时，「1 页」这个数会让人以为没什么可看的，
     而实际上要走查的是 4 屏十几个态。数字要对得上工作量，不然人会照着它低估。 */
  $('#projSub').textContent = d
    ? `${d.n.pages} 页 / ${d.n.views != null ? d.n.views : d.n.pages} 屏 · ${d.n.states} 个状态 · 扫于 ${new Date(d.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
    : '扫不出来';
  $('#gateN').textContent = d && d.n.bad ? String(d.n.bad) : '';
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.v === S.view);
  for (const [v, el] of [['grid', '#vGrid'], ['wall', '#vWall'], ['map', '#vMap'], ['script', '#vScript'], ['gate', '#vGate']]) $(el).hidden = S.view !== v;
  if (!d) return;
  renderOns(d);
  if (S.view === 'grid') renderGrid(d);
  else if (S.view === 'wall') renderWall(d);
  else if (S.view === 'map') renderMap(d);
  else if (S.view === 'script') renderScript(d);
  else renderGate(d);
}

/* ── 叠加开关条 ───────────────────────────
   它跟状态是两回事：状态互斥（一次一个），开关正交（可以同时开几个）。
   摆在一起会让人以为「OSS视角」是第四个场景，而它其实叠在任意一个场景之上。 */
function renderOns(d) {
  const list = allOverlays(d), bar = $('#onsBar');
  bar.hidden = !list.length;
  if (!list.length) { if (S.on.size) { S.on.clear(); } return; }
  bar.innerHTML = '<span class="ons-lab">叠加</span>' + list.map(o =>
    `<button class="onb ${S.on.has(o.key) ? 'on' : ''}" data-on="${esc(o.key)}"
      title="${esc(o.when || 'on-' + o.key)}　叠在当前这个态之上，不是另一个态">${esc(o.name)}</button>`).join('');
}

/* ── 对照表 ─────────────────────────────── */
function renderGrid(d) {
  if (!d.pages.length) { $('#gridWrap').innerHTML = '<p class="empty">这个项目还没有 html 页面。<br>先让 Claude 做出第一页。</p>'; return; }
  const groups = gridGroups(d);
  /* 两层表头：上层是视图（抽屉 / 浮层也在这层），下层才是该视图里的状态 */
  let h = '<table class="grid"><thead><tr><th class="pg" rowspan="2">页面</th>';
  for (const g of groups) h += `<th class="vg" colspan="${g.cols.length}" title="${esc(g.v.how || (g.v.key ? 'state-' + g.v.key + '-*' : '页面本身，没有浮层盖着'))}">${esc(g.v.name)}</th>`;
  h += '</tr><tr>';
  for (const g of groups) for (const c of g.cols) {
    const full = g.v.key ? (c.key === 'default' ? g.v.key : g.v.key + '-' + c.key) : c.key;
    h += `<th title="state-${esc(full)}　${c.n} 页有这个态${c.alias.length > 1 ? '，各页叫法不一样：' + esc(c.alias.join(' / ')) : ''}">${esc(c.name)}</th>`;
  }
  h += '</tr></thead><tbody>';
  for (const p of d.pages) {
    const isAt = p.rel === S.at.rel;
    h += `<tr><td class="pg"><button data-rel="${esc(p.rel)}" data-state="default" class="${isAt ? 'at' : ''}" title="${esc(p.rel)}">
      <span class="t">${esc(p.title)}</span><span class="r">${esc(p.rel)}</span></button></td>`;
    for (const g of groups) {
      /* 这一页压根没声明这个视图 → 整组画成「不适用」，而不是一排空格子。
         🔴 这一条是分组之外的另一半：不区分的话，「没声明这个抽屉」和「声明了但这个态没做」
         长得一模一样，人只能挨个去源码里查是哪一种，这张表就不省事了。 */
      const hasView = !g.v.key || (p.views || []).some(v => v.key === g.v.key);
      for (const c of g.cols) {
        if (!hasView) { h += `<td><span class="cell na" title="这一页没有「${esc(g.v.name)}」这个视图">·</span></td>`; continue; }
        const st = statesIn(p, g.v.key).find(x => (x.sub || x.key) === c.key);
        const full = st ? st.key : (g.v.key ? (c.key === 'default' ? g.v.key : g.v.key + '-' + c.key) : c.key);
        const at = isAt && (S.at.state || 'default') === full;
        h += `<td>${st
          ? `<button class="cell has ${at ? 'at' : ''}" data-rel="${esc(p.rel)}" data-state="${esc(full)}" title="${esc(p.title)}　${esc(g.v.name)} · ${esc(st.name)}${st.when ? '：' + esc(st.when) : ''}">●</button>`
          : `<span class="cell gap" title="这一页的「${esc(g.v.name)}」没有「${esc(c.name)}」态"></span>`}</td>`;
      }
    }
    h += '</tr>';
  }
  $('#gridWrap').innerHTML = h + '</tbody></table>';
}

/* ── 铺开：把状态并排渲染出来 ────────────────────────────
   吉吉 2026-09-18：「可以把所有状态、页面都铺开来，让用户在独立控制台上切换、观看」。
   为什么对照表不够：圆点告诉你这一格**做了没有**，但做成什么样只有看见才知道。
   两个视图分工——对照表管「有没有漏」，铺开管「长什么样」。

   🔴 页面是整份内联进 srcdoc 的（跟走查包同一套）：只有同源才能在 iframe 外面换状态类，
   而换类不写文件正是「页面里不留演示代码」的前提。
   缩略图用 transform:scale 缩，不是把 iframe 做小 —— 做小会触发页面的响应式断点，
   量到的就不是它在 1240 下真正的样子了。 */
function bodyWithState(html, key, ons) {
  const add = classesFor(key, ons).join(' ');
  if (/<body\b[^>]*\bclass\s*=\s*["'][^"']*["']/i.test(html)) {
    return html.replace(/<body\b([^>]*)\bclass\s*=\s*("([^"]*)"|'([^']*)')/i, (m, pre, _q, a, b) => {
      /* 两族一起剥：只剥 state-* 的话，上一张缩略图留下的 on-oss 会挂到下一张身上，
         于是并排的两张里有一张是谁都没选过的组合，而它下面的标题写着另一件事。 */
      const keep = String(a ?? b ?? '').split(/\s+/).filter(c => c && c.indexOf('state-') !== 0 && c.indexOf('on-') !== 0);
      return `<body${pre}class="${keep.concat(add.split(' ')).join(' ')}"`;
    });
  }
  return html.replace(/<body\b/i, `<body class="${add}"`);
}
async function wallHtml(rels) {
  const want = rels.filter(r => !S.wall.html.has(r));
  if (want.length && uw.flowHtml) {
    const r = await uw.flowHtml({ id: S.id, rels: want });
    for (const p of (r.pages || [])) S.wall.html.set(p.rel, p.html);
  }
}
/* 进铺开要把窗口撑宽：460 摆不下两张。退出时还原成原来的宽度 */
async function wallResize(on) {
  if (!uw.flowResize) return;
  if (on) {
    if (S.wall.narrow == null) S.wall.narrow = { w: window.outerWidth, h: window.outerHeight };
    const want = {};
    if (window.outerWidth < 900) want.w = 1180;
    /* 🔴 高度也要撑，不只撑宽。流程图的缩略图是按**可用高度**反算大小的，
       窗口矮＝图小 —— 吉吉「现在的高度太低了」说的就是这个。
       实测账：684 高的窗口里，4 屏摆成两行，每张只分到 136px，比上一版写死的 0.18 还小。
       传个够大的值让主进程去钳这块屏的 workArea，别在渲染层猜屏幕有多高
       （猜错的那一头是「窗口跑到屏幕外面去」，比图小难受得多）。 */
    if (window.outerHeight < 860) want.h = 3000;
    if (want.w || want.h) await uw.flowResize(want);
  } else if (S.wall.narrow != null) {
    await uw.flowResize(S.wall.narrow);
    S.wall.narrow = null;
  }
}

/* 要铺哪些格子。三种模式，回答的是三个不同的问题：
     states 这一页的所有状态 —— 含它所有抽屉 / 浮层的所有态（吉吉要的「把所有抽屉样式展示」）
     pages  所有页面        —— 每页一张默认态，看的是「这个需求一共有哪些屏」
     all    整个需求        —— 页 × 视图 × 态 全铺，验收和交付前扫一遍用 */
function wallCells(d) {
  const out = [];
  const push = (p, st, vname) => out.push({
    rel: p.rel, state: st.key, group: vname,
    title: st.name,
    sub: st.when || (st.key === 'default' ? '正常情况' : 'state-' + st.key),
  });
  const vnameOf = (p, k) => k ? ((p.views || []).find(v => v.key === k) || { name: k }).name : '主视图';
  if (S.wall.mode === 'pages') {
    for (const p of d.pages) out.push({ rel: p.rel, state: 'default', group: '所有页面', title: p.title, sub: p.rel });
    return out;
  }
  const pages = S.wall.mode === 'all' ? d.pages : d.pages.filter(p => p.rel === S.wall.rel);
  for (const p of pages) {
    for (const v of allViews(d)) {
      const sts = statesIn(p, v.key);
      if (!sts.length) continue;
      const g = (S.wall.mode === 'all' ? p.title + ' · ' : '') + vnameOf(p, v.key);
      for (const st of sts) push(p, st, g);
    }
  }
  return out;
}

async function renderWall(d) {
  if (!d.pages.length) { $('#wallGrid').innerHTML = '<p class="empty">这个项目还没有 html 页面。</p>'; return; }
  const sel = $('#wallPage');
  if (!S.wall.rel || !d.pages.some(p => p.rel === S.wall.rel)) S.wall.rel = S.at.rel || d.entry || d.pages[0].rel;
  sel.innerHTML = d.pages.map(p => `<option value="${esc(p.rel)}"${p.rel === S.wall.rel ? ' selected' : ''}>${esc(p.title)}（${esc(p.rel)}）</option>`).join('');
  sel.hidden = S.wall.mode !== 'states';
  for (const b of document.querySelectorAll('#wallMode button')) b.classList.toggle('on', b.dataset.m === S.wall.mode);
  $('#wallZoom').value = String(S.wall.zoom);

  const cells = wallCells(d);
  await wallHtml([...new Set(cells.map(c => c.rel))]);

  const k = S.wall.zoom / 100, W = 1240, H = 860;
  const g = $('#wallGrid');
  /* 按视图分组，每组自己一块。
     🔴 分组不是为了好看，是因为「看得出差别」只在同一屏的几个态之间成立：
     主页面的空态紧挨着抽屉的加载态，眼睛得先花力气分清这是哪一屏，才谈得上比。
     分了组还白捡一件事——同组的格子可以统一高度，一行才排得齐（见下面 evenOut）。 */
  const groups = [];
  for (const c of cells) {
    if (!groups.length || groups[groups.length - 1].name !== c.group) groups.push({ name: c.group, cells: [] });
    groups[groups.length - 1].cells.push(c);
  }
  g.innerHTML = groups.map(gr => `<section class="wgrp">
      <div class="wall-sec"><span class="t">${esc(gr.name)}</span><span class="c">${gr.cells.length} 个</span></div>
      <div class="wtiles">${gr.cells.map(c => {
        const at = c.rel === S.at.rel && (S.at.state || 'default') === c.state;
        return `<div class="tile ${at ? 'at' : ''}" style="width:${Math.round(W * k)}px" data-rel="${esc(c.rel)}" data-state="${esc(c.state)}" title="点一下在主窗口里看这一态">
          <div class="tile-shot" style="width:${Math.round(W * k)}px;height:${Math.round(H * k)}px">
            <iframe data-cell="${esc(c.rel)}|${esc(c.state)}" style="width:${W}px;height:${H}px;transform:scale(${k})" sandbox="allow-same-origin" scrolling="no"></iframe>
            <div class="tile-hit"></div>
          </div>
          <div class="tile-cap"><div class="n">${esc(c.title)}</div><div class="w">${esc(c.sub)}</div></div>
        </div>`;
      }).join('')}</div>
    </section>`).join('')
    + `<p class="wall-note">缩略图是真页面按 1240 宽渲染再缩小的，不是截图——所以看到的就是它真实的样子。点任一张在主窗口里沉浸看。${S.on.size ? '　当前叠了：' + esc([...S.on].map(x => (allOverlays(d).find(o => o.key === x) || { name: x }).name).join(' / ')) : ''}</p>`;

  /* 同一组里所有格子取同一个高度（组内最高的那张）。
     🔴 高度参差不齐是「铺开看着乱」的头号原因：每张卡底边都错开，眼睛找不到基线，
     再加上换行时高的那张把整行撑开，右边就空出一大片。
     取最高而不是取固定值：内容真的很短的一组不该被撑出一片白。 */
  function evenOut() {
    for (const grp of g.querySelectorAll('.wtiles')) {
      const frs = [...grp.querySelectorAll('iframe[data-cell]')];
      if (!frs.length || frs.some(f => !f.dataset.h)) continue;        // 还没量完就先不动，免得跳一下
      const hh = Math.min(2400, Math.max(...frs.map(f => +f.dataset.h || H)));
      grp.dataset.h = String(hh);
      for (const f of frs) { f.style.height = hh + 'px'; f.parentElement.style.height = Math.round(hh * (S.wall.zoom / 100)) + 'px'; }
    }
  }

  /* srcdoc 单独填，别塞进模板字符串里（页面正文里带引号会把属性撑破） */
  for (const fr of g.querySelectorAll('iframe[data-cell]')) {
    const [rel, st] = fr.dataset.cell.split('|');
    const src = S.wall.html.get(rel);
    if (!src) continue;
    fr.onload = () => {
      try {
        const doc = fr.contentDocument;
        /* 量内容真正的底边——body 子元素里最靠下的那个。
           🔴 不能直接用 scrollHeight：它至少等于 iframe 的高（860），短页面量出来还是 860。
           🔴 position:fixed 的元素要跳过：抽屉是 fixed 的，量它等于量视口，
              一开抽屉整页就被撑回满高，同一组里就又参差了。 */
        let bottom = 0;
        for (const el of doc.body.children) {
          const cs = doc.defaultView.getComputedStyle(el);
          if (cs && cs.position === 'fixed') continue;
          const r = el.getBoundingClientRect();
          if (r.height > 0 || r.width > 0) bottom = Math.max(bottom, r.bottom + (doc.defaultView.scrollY || 0));
        }
        const sh = doc.documentElement.scrollHeight || H;
        const hh = Math.max(360, Math.min(2400, bottom > 0 ? Math.min(sh, Math.ceil(bottom) + 24) : sh));
        fr.dataset.h = String(hh);
        fr.style.height = hh + 'px';
        const shot = fr.parentElement;
        if (shot) shot.style.height = Math.round(hh * (S.wall.zoom / 100)) + 'px';
        evenOut();
      } catch (e) {}
    };
    fr.srcdoc = bodyWithState(src, st, S.on);
  }
}

/* ── 流程图：按离入口的步数分层 ──────────────
   为什么不画 SVG 连线：15 个节点、每个 3～5 条出边，连线在 460 宽的窗口里必然叠成一团。
   分层 + 每个节点底下列出它的出边，同样看得出「怎么走」，而且看得清「走到哪断了」。 */
function layers(d) {
  const by = new Map(d.pages.map(p => [p.rel, p]));
  const depth = new Map(), q = [];
  if (by.has(d.entry)) { depth.set(d.entry, 0); q.push(d.entry); }
  while (q.length) {
    const cur = q.shift(), p = by.get(cur);
    for (const l of (p ? p.links : [])) if (l.ok && !depth.has(l.to)) { depth.set(l.to, depth.get(cur) + 1); q.push(l.to); }
  }
  const out = [];
  for (const p of d.pages) { const k = depth.has(p.rel) ? depth.get(p.rel) : -1; (out[k + 1] = out[k + 1] || []).push(p); }
  return out;
}

/* 一排状态小按钮。吉吉 2026-09-18：「这个按钮可以按照线性图来构造」——
   就是这一条：流程图上每个节点底下直接挂它自己的态，点哪个进哪个，
   不用为了换个态先切回对照表。节点是「哪一屏」，按钮是「这一屏的哪个样子」。 */
function stateBtns(p, viewKey) {
  const sts = statesIn(p, viewKey);
  if (!sts.length) return '';
  return '<div class="nstates">' + sts.map(st => {
    const at = p.rel === S.at.rel && (S.at.state || 'default') === st.key;
    return `<button class="nst ${at ? 'at' : ''}" data-rel="${esc(p.rel)}" data-state="${esc(st.key)}"
      title="${esc(st.when || 'state-' + st.key)}">${esc(st.name)}</button>`;
  }).join('') + '</div>';
}

/* ── 流程图：编号卡片 ＋ 真缩略图 ＋ 正交折线 ──────────────────────────
   吉吉 2026-09-18 给了张 wireflow 海报：「我希望流程是这样的展示，这样人类看的很清楚」。

   🔴 这里推翻了我自己之前写在这个文件里的判据（「不画 SVG 连线：15 个节点、每个 3～5 条出边，
   连线在 460 宽的窗口里必然叠成一团」）。那条判据没错，错在它把「窄窗口 + 纯文字节点」
   当成了唯一前提 —— 海报之所以读得清，靠的是**缩略图认屏 + 宽画布 + 折线走通道**这三件事一起。
   所以进流程图也像铺开那样把窗口撑宽，节点换成带编号的真缩略图。

   🔴🔴 第二轮（同日 · 吉吉「这个页面现在所有线都绕在一起了」「希望你画流程的时候会根据不同项目，
   画不同的方式」「流程图区域可以不要滚动，直接撑满」「现在的高度太低了」）：
   线绕在一起的真因**不是画线算法，是布局**。上一版不管什么项目一律横排一行、线一律走卡片
   底下那条通道 —— 于是 PPC 那种「一个后台页开三个抽屉」的形状，三条边全得从 1 号右边出来、
   往下掉进 11px 间隔的窄通道、再横着穿过整排，看上去就是三根缠在一起的线。
   改法是**先认拓扑、再决定怎么摆**（planLayout）：链状横排、中枢分叉成竖列、其余按步数分列。
   摆对了之后，边走的是**列与列之间的空隙**，同一个源的几条共用一根主干 —— 长出来是树杈，不是毛线团。
   底部通道只留给回头边和跨列边（「返回」那种），数量少，不会再挤。

   ⚠️ 诚实的边界：海报是人手摆的位置。自动布局到几十屏时，走线不会有人摆的好看；
   到那个量级要重新想布局（比如让人拖），不是把主干数调大就行。 */

/* 一屏＝一张卡。页面本身是一屏，它的每个抽屉/浮层各是一屏。
   顺序＝按离入口的步数分层，视图紧跟在它所属的页面后面 —— 编号就是这个顺序，
   人报「第 7 屏」时两个人看的是同一张。 */
function screensOf(d) {
  const out = [];
  /* 🔴 layers() 把「跳不到的孤儿」放在数组第 0 位（它用的是 depth+1 当下标，孤儿 depth=-1）。
     直接按数组顺序编号的话，孤儿会拿到 1 号、入口变成 2 号 —— 而编号在这个视图里
     就是「第几屏」这个称呼本身，入口不是 1 号，整套号就没法用了。
     所以先走入口那一串（下标 1 往后），孤儿挪到最后，编号也就落在最大的几号上，
     跟它「不在主流程里」这件事正好对上。 */
  const ls = layers(d);
  for (const group of [...ls.slice(1), ls[0]]) {
    for (const p of (group || [])) {
      const main = statesIn(p, '');
      out.push({ kind: 'page', rel: p.rel, view: '', title: p.title, sub: p.rel,
        state: main.length ? main[0].key : 'default', page: p });
      for (const v of (p.views || [])) {
        const sts = statesIn(p, v.key);
        out.push({ kind: 'view', rel: p.rel, view: v.key, title: v.name, sub: v.how || '同页浮层',
          state: sts.length ? sts[0].key : v.key, page: p, sel: v.sel });
      }
    }
  }
  return out.map((sc, i) => ({ ...sc, n: i + 1, id: sc.rel + '|' + sc.view }));
}

/* 边有两种来源，都是真值、都不是人手连的：
     页 → 页   从 <a href> 扫出来
     页 → 抽屉 从 @视图 声明的入口选择器来
   断链不画线（画了就得画到一个不存在的节点上），改成挂在源卡片上报红。 */
function edgesOf(d, screens) {
  const has = new Set(screens.map(s => s.id));
  const out = [];
  for (const sc of screens) {
    if (sc.kind !== 'page') continue;
    for (const l of sc.page.links) {
      if (!l.ok) continue;
      const to = l.to + '|';
      if (has.has(to)) out.push({ from: sc.id, to, label: (l.text || l.sel || '').slice(0, 8) });
    }
    for (const v of (sc.page.views || [])) {
      const to = sc.rel + '|' + v.key;
      if (has.has(to)) out.push({ from: sc.id, to, label: v.name.replace(/（.*）$/, '').slice(0, 8) });
    }
  }
  return out;
}

/* 先认形状，再决定怎么摆 —— 这就是「根据不同项目画不同的方式」那句话的落点。
   🔴 三种形状的判据全部从真实拓扑算出来，不是让人在下拉框里挑一个：
   挑错了图会更乱，而且没人知道是挑错了还是画错了。
   返回 { kind, cols }：cols 是列，从左往右；列内从上往下。 */
function planLayout(screens, edges) {
  const od = new Map(), idg = new Map();
  for (const s of screens) { od.set(s.id, 0); idg.set(s.id, 0); }
  for (const e of edges) { od.set(e.from, (od.get(e.from) || 0) + 1); idg.set(e.to, (idg.get(e.to) || 0) + 1); }
  const entry = screens[0];                       // screensOf 保证 1 号永远是入口
  /* 孤儿单独占最后一列。混进正常的列里会让「第几列＝离入口第几步」这句话不成立 */
  const orphan = screens.filter(s => s !== entry && !idg.get(s.id));
  const orphanSet = new Set(orphan.map(s => s.id));
  const main = screens.filter(s => !orphanSet.has(s.id));
  const tail = orphan.length ? [orphan] : [];

  /* ① 中枢分叉：所有边都从同一屏出发，且落点各自没有下游。
       PPC 就是这个形状 —— 一个后台页开三个抽屉，它不是「四步」，是「一步，三个去处」。
       横排成一行等于在说「走完广告预测才到营销诊断」，那是假的。 */
  const froms = new Set(edges.map(e => e.from));
  if (edges.length >= 2 && froms.size === 1 && edges.every(e => !od.get(e.to))) {
    const hub = main.filter(s => s.id === edges[0].from);
    const arms = main.filter(s => s.id !== edges[0].from);
    /* 🔴 分叉走**纵向**（中枢一排在上，三个去处横排在下），不是「中枢在左、去处竖排在右」。
       第一版写成左右分叉，量出来缩放 0.163 —— 比上一版写死的 0.18 还小。
       原因：三张卡竖着摞，高度立刻变成瓶颈，而控制台窗口本来就是矮的
       （吉吉那台约 1000×684，图区只有 ~500 高，竖排会缩到 0.108＝缩略图 97px，
       正好跟他说的「高度太低」反着来）。横排 3 张吃的是宽度，而宽度是这个窗口富余的那一维。
       顺带它也更像吉吉给的那张 wireflow 海报：上面一个总页，下面一排去处。
       → 判据：**分叉往哪个方向长，看的是「空间哪一维富余」，不是「分叉看起来像往哪长」。** */
    if (hub.length && arms.length) return { kind: 'hub', dir: 'v', cols: [hub, arms, ...tail] };
  }

  /* ② 链状：每屏最多一进一出 —— 一屏一列横着排，边就是相邻两张之间的一根短横线。
       这种形状根本不需要往下绕通道（上一版所有形状共用那条路，链状用它纯属自找乱）。 */
  if (main.every(s => od.get(s.id) <= 1 && idg.get(s.id) <= 1)) {
    return { kind: 'chain', dir: 'h', cols: [...main.map(s => [s]), ...tail] };
  }

  /* ③ 兜底：按离入口的步数分列，同一步的竖着排。
       🔴 用 BFS 的首达深度，不是「谁指向我」—— 详情页上的「返回首页」是回头边，
       按它算的话首页会被推到最后一列，整张图的方向就反了。 */
  const adj = new Map();
  for (const e of edges) { if (!adj.has(e.from)) adj.set(e.from, []); adj.get(e.from).push(e.to); }
  const dep = new Map([[entry.id, 0]]), q = [entry.id];
  while (q.length) {
    const cur = q.shift();
    for (const to of (adj.get(cur) || [])) if (!dep.has(to)) { dep.set(to, dep.get(cur) + 1); q.push(to); }
  }
  const by = new Map();
  for (const s of main) {
    const c = dep.has(s.id) ? dep.get(s.id) : 0;
    if (!by.has(c)) by.set(c, []);
    by.get(c).push(s);
  }
  const cols = [...by.keys()].sort((a, b) => a - b).map(c => by.get(c));
  return { kind: 'layered', dir: 'h', cols: [...cols, ...tail] };
}

/* 正交折线 + 圆角。点列是「拐点」，r 是圆角半径。
   直接用 stroke-linejoin:round 圆不出这个半径（那只圆描边端头的接缝），得自己拐弯。 */
function elbow(pts, r) {
  /* 重合点会让 Q 控制点算出 NaN（d1=0），也会白画一段 —— 先去掉 */
  pts = pts.filter((p, i) => i === 0 || Math.abs(p.x - pts[i - 1].x) > .5 || Math.abs(p.y - pts[i - 1].y) > .5);
  if (pts.length < 2) return '';
  let dstr = `M${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const d1 = Math.hypot(b.x - a.x, b.y - a.y), d2 = Math.hypot(c.x - b.x, c.y - b.y);
    const rr = Math.max(0, Math.min(r, d1 / 2, d2 / 2));
    const p1 = { x: b.x + (a.x - b.x) / (d1 || 1) * rr, y: b.y + (a.y - b.y) / (d1 || 1) * rr };
    const p2 = { x: b.x + (c.x - b.x) / (d2 || 1) * rr, y: b.y + (c.y - b.y) / (d2 || 1) * rr };
    dstr += ` L${p1.x} ${p1.y} Q${b.x} ${b.y} ${p2.x} ${p2.y}`;
  }
  const e = pts[pts.length - 1];
  return dstr + ` L${e.x} ${e.y}`;
}

/* 缩略图里那张页面的尺寸（跟铺开同一套），和布局的几个常数 */
const MAP_W = 1240, MAP_H = 900;
const MAP_COL_GAP = 54, MAP_ROW_GAP = 18, MAP_PAD = 8;
/* 纵向布局里排与排之间要走横干还要放标签，18 不够 —— 实测标签会贴着上一排的状态按钮 */
const MAP_TIER_GAP = 44;
/* 🔴 下限不是随便定的：低于这个值缩略图就只剩色块、认不出是哪一屏，
   那时候「撑满」已经没有意义了，宁可让它滚。上限是别把两屏的项目放成两张海报。 */
const MAP_K_MIN = 0.085, MAP_K_MAX = 0.46;

/* 撑满：缩放比不再是写死的 0.18，是从「这个布局要几列几行」和「现在有多大地方」反算的。
   吉吉 2026-09-18：「流程图区域可以不要滚动，直接撑满就行，让用户看的更清楚」＋「现在的高度太低了」。
   🔴 卡片头和状态按钮那几行是文字，**不跟着缩放变** —— 所以要先把它们从可用高度里扣掉再解 k，
   不扣的话列里卡片一多就会溢出（而溢出正是「要滚动」的来源）。 */
function fitK(plan, availW, availH, chromeOf) {
  const cols = plan.cols, n = cols.length;
  const wide = Math.max(1, ...cols.map(c => c.length));     // 一段里最多几张
  let kW, kH;
  if (plan.dir === 'v') {
    /* 纵向：一段是一排 —— 宽度看最宽那一排，高度是各排叠起来 */
    kW = (availW - (wide - 1) * MAP_COL_GAP - MAP_PAD * 2) / (wide * MAP_W);
    const chrome = cols.reduce((a, c) => a + Math.max(...c.map(chromeOf)), 0) + (n - 1) * MAP_TIER_GAP;
    kH = (availH - MAP_PAD * 2 - chrome) / (n * MAP_H);
  } else {
    /* 横向：一段是一列 —— 宽度是各列排开，高度看最高那一列 */
    kW = (availW - (n - 1) * MAP_COL_GAP - MAP_PAD * 2) / (n * MAP_W);
    kH = Infinity;
    for (const col of cols) {
      const chrome = col.reduce((a, s) => a + chromeOf(s), 0) + (col.length - 1) * MAP_ROW_GAP;
      kH = Math.min(kH, (availH - MAP_PAD * 2 - chrome) / (col.length * MAP_H));
    }
  }
  return Math.max(MAP_K_MIN, Math.min(MAP_K_MAX, kW, kH));
}

/* 底部通道只给回头边和跨列边用，所以要留的地方按**这类边有几条**算，不是按总边数 */
function backEdges(edges, colOf) {
  return edges.filter(e => colOf.get(e.to) !== colOf.get(e.from) + 1);
}

function renderMap(d) {
  const screens = screensOf(d);
  if (screens.length < 2) {
    $('#mapWrap').innerHTML = '<p class="empty">只有一屏，没有流程可画。<br>页面之间用真的 <code>&lt;a href&gt;</code> 连起来，<br>同一页里的抽屉用 <code>/* @视图 key 名字 · 怎么进来 · 入口选择器 *&#47;</code> 声明，这里就有图了。</p>';
    return;
  }
  const edges = edgesOf(d, screens);
  const plan = planLayout(screens, edges);
  const colOf = new Map();
  plan.cols.forEach((col, ci) => col.forEach(s => colOf.set(s.id, ci)));

  const wrap = $('#mapWrap');
  /* 先把底部通道那条带子腾出来再算高度：卡片是垂直居中的，
     不腾的话居中会把卡片摆到正中间、通道压到最后一排卡片身上。 */
  const nBack = backEdges(edges, colOf).length;
  const band = nBack ? 16 + nBack * 11 : 10;
  wrap.style.paddingBottom = band + 'px';
  const availW = Math.max(320, wrap.clientWidth);
  const availH = Math.max(200, wrap.clientHeight - band);
  /* 第一趟用估出来的卡片外壳高度，第二趟（fitMap）拿真量到的重算。
     外壳高度不随缩放变，所以第二趟是精确解不是逼近 —— 只会算一次，不会来回抖。 */
  const est = sc => 27 + (statesIn(sc.page, sc.view).length ? 25 : 0);
  const k = fitK(plan, availW, availH, est);
  const cw = Math.round(MAP_W * k), chh = Math.round(MAP_H * k);

  const reached = new Set([d.entry]);
  for (const p of d.pages) for (const l of p.links) if (l.ok) reached.add(l.to);

  const cardHtml = sc => {
    const at = sc.rel === S.at.rel && (S.at.state || 'default') === sc.state;
    const orphan = sc.kind === 'page' && d.pages.length > 1 && !reached.has(sc.rel);
    const broken = sc.kind === 'page' ? sc.page.links.filter(l => !l.ok) : [];
    return `<div class="mcard ${at ? 'at' : ''} ${sc.kind === 'view' ? 'v' : ''}" data-id="${esc(sc.id)}" data-col="${colOf.get(sc.id)}" style="width:${cw}px">
      <div class="mcard-hd"><span class="num">${sc.n}</span><span class="t" title="${esc(sc.sub)}">${esc(sc.title)}</span></div>
      <div class="mcard-shot" data-rel="${esc(sc.rel)}" data-state="${esc(sc.state)}" style="height:${chh}px" title="点一下在主窗口里看这一屏">
        <iframe data-mcell="${esc(sc.rel)}|${esc(sc.state)}" style="width:${MAP_W}px;height:${MAP_H}px;transform:scale(${k})" sandbox="allow-same-origin" scrolling="no"></iframe>
        <div class="tile-hit"></div>
      </div>
      ${orphan ? '<div class="mtag warn">没人跳得到</div>' : ''}
      ${broken.length ? `<div class="mtag bad" title="${esc(broken.map(l => (l.text || l.sel) + ' → ' + l.to).join('\n'))}">${broken.length} 条断链</div>` : ''}
      ${stateBtns(sc.page, sc.view)}
    </div>`;
  };

  wrap.dataset.kind = plan.kind;                 // 给门和人看：这张图是按哪种形状摆的
  wrap.dataset.dir = plan.dir;
  /* 🔴 间距由 JS 写进 style，CSS 里不再写第二份数值：fitK 是拿这几个数算缩放的，
     两处各写一份迟早对不上 —— 而对不上的表现是「算出来说装得下，屏幕上却溢出一点点」，
     肉眼几乎看不出来，只有门会红。 */
  const outerGap = plan.dir === 'v' ? MAP_TIER_GAP : MAP_COL_GAP;
  const innerGap = plan.dir === 'v' ? MAP_COL_GAP : MAP_ROW_GAP;
  wrap.innerHTML = `<svg class="mconn" aria-hidden="true"></svg><div class="mcards dir-${plan.dir}" style="gap:${outerGap}px">` +
    plan.cols.map((col, ci) => `<div class="mcol" data-col="${ci}" style="gap:${innerGap}px">${col.map(cardHtml).join('')}</div>`).join('') +
    `</div>`;

  /* 缩略图：跟铺开共用同一份 html 缓存和同一套换态算法（两处各写一套，迟早对不上） */
  wallHtml([...new Set(screens.map(s => s.rel))]).then(() => {
    for (const fr of $('#mapWrap').querySelectorAll('iframe[data-mcell]')) {
      const [rel, st] = fr.dataset.mcell.split('|');
      const src = S.wall.html.get(rel);
      if (src) fr.srcdoc = bodyWithState(src, st, S.on);
    }
  });

  /* 存下来给 resize 用：窗口一变，只要重解 k 就行，不用重建 DOM
     （重建等于每张缩略图重新装一遍页面，拉窗口时会一直闪） */
  S.map = { plan, edges, colOf, band };
  fitMap(plan, edges, colOf, band);
}

/* 第二趟：拿真量到的外壳高度重解 k，应用到已经在屏幕上的卡片上（**不重建 DOM**——
   重建会让每张缩略图重新装一遍页面，看起来像闪了一下）。完事才画线。 */
function fitMap(plan, edges, colOf, band) {
  requestAnimationFrame(() => {
    const wrap = $('#mapWrap');
    const cards = [...wrap.querySelectorAll('.mcard')];
    if (!cards.length) return;
    const chrome = new Map();
    for (const el of cards) {
      const shot = el.querySelector('.mcard-shot');
      chrome.set(el.dataset.id, Math.round(el.getBoundingClientRect().height - shot.getBoundingClientRect().height));
    }
    const availW = Math.max(320, wrap.clientWidth);
    const availH = Math.max(200, wrap.clientHeight - band);
    const k = fitK(plan, availW, availH, s => chrome.get(s.id) != null ? chrome.get(s.id) : 30);
    const cw = Math.round(MAP_W * k), chh = Math.round(MAP_H * k);
    for (const el of cards) {
      el.style.width = cw + 'px';
      const shot = el.querySelector('.mcard-shot');
      shot.style.height = chh + 'px';
      const fr = shot.querySelector('iframe');
      if (fr) fr.style.transform = 'scale(' + k + ')';
    }
    wrap.dataset.k = k.toFixed(4);
    requestAnimationFrame(() => {
      /* 装得下就一定不滚 —— 只有缩到下限还装不下（屏数太多）才把滚动放回来。
         这个类就是「这次到底滚没滚」的证据，门直接查它，不用去猜。 */
      wrap.classList.toggle('scrolls',
        wrap.scrollHeight > wrap.clientHeight + 1 || wrap.scrollWidth > wrap.clientWidth + 1);
      drawConn(wrap, edges, colOf, plan);
    });
  });
}

/* 连线：按布局分型走两条不同的路。
   🔴 forward（下一列）走**列间空隙**里的一根竖直主干；同一个源的几条边共用一根，
      于是一屏开三个抽屉长出来的是树杈。上一版所有边一律往下绕通道，才会「绕在一起」。
   🔴 其余（回头边 / 跨列边）走底部那条带子 —— 它们本来就是少数，不值得为它们把主干让开。 */
function drawConn(wrap, edges, colOf, plan) {
  const svg = wrap.querySelector('svg.mconn');
  if (!svg) return;
  const wb = wrap.getBoundingClientRect(), sx = wrap.scrollLeft, sy = wrap.scrollTop;
  const R = el => { const r = el.getBoundingClientRect(); return { x: r.left - wb.left + sx, y: r.top - wb.top + sy, w: r.width, h: r.height }; };
  const box = {};
  for (const el of wrap.querySelectorAll('.mcard')) {
    box[el.dataset.id] = { card: R(el), shot: R(el.querySelector('.mcard-shot')), col: +el.dataset.col };
  }
  const vert = plan.dir === 'v';
  /* 每一段的边界：主干要落在两段之间的空隙里，不能压在任何一张卡上。
     横向布局量左右，纵向布局量上下 —— 两种方向共用同一套代码，只是量的轴不同。 */
  const colEdge = [];
  for (const id in box) {
    const c = box[id].col, b = box[id].card;
    const lo = vert ? b.y : b.x, hi = vert ? b.y + b.h : b.x + b.w;
    if (!colEdge[c]) colEdge[c] = { l: lo, r: hi };
    else { colEdge[c].l = Math.min(colEdge[c].l, lo); colEdge[c].r = Math.max(colEdge[c].r, hi); }
  }
  /* 同一条空隙里可能有好几个源（分层布局），各占一根主干，先排好次序免得两根重合 */
  const trunkIdx = new Map();
  for (const e of edges) {
    const a = box[e.from], b = box[e.to];
    if (!a || !b || b.col !== a.col + 1) continue;
    const key = b.col + '@' + e.from;
    if (!trunkIdx.has(key)) trunkIdx.set(key, []);
  }
  const perGap = new Map();
  for (const key of trunkIdx.keys()) {
    const gap = key.split('@')[0];
    if (!perGap.has(gap)) perGap.set(gap, []);
    perGap.get(gap).push(key);
  }
  for (const [, keys] of perGap) keys.forEach((key, i) => trunkIdx.set(key, { i, n: keys.length }));

  /* 底部那条带子：从最低的卡片底下开始，一条边一层 */
  let floor = 0;
  for (const id in box) floor = Math.max(floor, box[id].card.y + box[id].card.h);

  let out = '', maxY = 0, maxX = 0, lanes = 0, fwd = 0;
  const mark = p => { maxY = Math.max(maxY, p.y); maxX = Math.max(maxX, p.x); };

  for (const e of edges) {
    const a = box[e.from], b = box[e.to];
    if (!a || !b) continue;
    const ay = a.shot.y + a.shot.h / 2, by = b.shot.y + b.shot.h / 2;
    let pts, labX, labY, labAnchor;

    if (b.col === a.col + 1) {
      fwd++;
      const t = trunkIdx.get(b.col + '@' + e.from) || { i: 0, n: 1 };
      const gl = colEdge[a.col].r, gr = colEdge[b.col].l;
      /* 主干排在空隙中间，几根之间留 9px；空隙本来就窄时夹紧一点，但绝不越出空隙 */
      const span = Math.max(0, gr - gl), step = Math.min(9, span / (t.n + 1));
      const tc = Math.round(gl + span / 2 + (t.i - (t.n - 1) / 2) * step);
      if (vert) {
        /* 纵向：从上一排卡片的**底边**垂下来，走排间那条横干，再降进下一排卡片的**顶边**。
           🔴 端点接在 card 的上下边、不接 shot 的：卡片底下挂着一排状态按钮、顶上是编号和标题，
              接 shot 就会从这两处文字身上压过去。接卡片边＝落在卡片的外轮廓上，谁都不挡。 */
        const ax = Math.round(a.card.x + a.card.w / 2), bx = Math.round(b.card.x + b.card.w / 2);
        pts = [{ x: ax, y: a.card.y + a.card.h }, { x: ax, y: tc }, { x: bx, y: tc }, { x: bx, y: b.card.y }];
        /* 🔴 标签一律贴在**降进目标那一段**竖线的旁边，不放在横干上。
           放横干上实测是这样：三条边共用一根横干，标签就全挤在同一条水平线上，
           中间那条（ax≈bx，几乎没有横段）的标签直接被横干穿过去，还压到了中枢卡
           底下那排状态按钮 —— 屏幕上是「营销诊断」四个字上面划了一道线。
           贴竖线则每条边各有各的位置，天然不会撞（竖线是每条边自己的，横干是共用的）。 */
        const drop = b.card.y - tc;
        if (drop > 14) { labX = bx + 6; labY = tc + drop / 2 + 3; labAnchor = 'start'; }
        else { labX = (ax + bx) / 2; labY = tc - 5; labAnchor = 'middle'; }
      } else {
        pts = [{ x: a.shot.x + a.shot.w, y: ay }, { x: tc, y: ay }, { x: tc, y: by }, { x: b.shot.x, y: by }];
        /* 标签压在标题上是最难看的一处，所以只放在两段空白里：
           横段够长就放横段中间，不够长（同一行、主干贴着目标）就贴着主干放在竖段上。 */
        const runW = b.shot.x - tc;
        if (runW > 46) { labX = (tc + b.shot.x) / 2; labY = by - 6; labAnchor = 'middle'; }
        else { labX = tc + 5; labY = (ay + by) / 2; labAnchor = 'start'; }
      }
    } else {
      /* 回头边 / 跨列边（详情页上的「返回」那种）：从卡片**底边**垂下来，走底部带子，
         再从目标的底边升上去。
         🔴 不从右边出去：最右那一列的卡再往右 14px 就出了画布，svg 只能跟着加宽，
            于是横向多出十几个像素的滚动 —— 而这个视图刚立的规矩是「装得下就不滚」。
            量出来是 clientWidth 1176 / scrollWidth 1191，肉眼根本看不见，只有门看得见。
         🔴 从底边不从中心出：卡片底下还挂着一排状态按钮，走中心会从按钮身上压过去。
         上一版是**所有**边都走这条路，那才是「线都绕在一起」的来源；现在只有少数边走。 */
      const ch = lanes++;
      const gut = floor + 12 + ch * 11;
      const off = (ch % 2 ? 7 : -7);
      const ax2 = a.shot.x + a.shot.w / 2 + off, bx2 = b.shot.x + b.shot.w / 2 + off;
      pts = [{ x: ax2, y: a.card.y + a.card.h }, { x: ax2, y: gut },
             { x: bx2, y: gut }, { x: bx2, y: b.card.y + b.card.h }];
      const runW = Math.abs(bx2 - ax2);
      labX = (ax2 + bx2) / 2; labY = gut - 5; labAnchor = runW > 52 ? 'middle' : 'start';
    }

    pts.forEach(mark); mark({ x: labX, y: labY });
    out += `<path d="${elbow(pts, 8)}" class="mline" data-kind="${b.col === a.col + 1 ? 'fwd' : 'back'}"><title>${esc(e.label || '')}</title></path>`
      + `<circle cx="${pts[0].x}" cy="${pts[0].y}" r="3" class="mdot"/>`
      + `<circle cx="${pts[pts.length - 1].x}" cy="${pts[pts.length - 1].y}" r="3" class="mdot"/>`
      + (e.label ? `<text x="${labX}" y="${labY}" class="mlab" text-anchor="${labAnchor}">${esc(e.label)}</text>` : '');
  }

  /* 🔴 画布装不下的那一段会被**静默裁掉**，屏幕上看着像「线画歪了」（2026-09-18 实测：
     画布 263、通道在 265/276/287，三条线的横段全没了）。`overflow:visible` 指望不上，
     外层 <svg> 的裁剪由 width/height 决定。所以先算走线要到哪儿，再定画布。 */
  const need = Math.ceil(maxY + 12);
  if (need > wrap.clientHeight) wrap.style.paddingBottom = (need - wrap.clientHeight + 8) + 'px';
  svg.setAttribute('width', Math.max(wrap.scrollWidth, Math.ceil(maxX + 8), 1));
  svg.setAttribute('height', Math.max(wrap.scrollHeight, need));
  svg.dataset.need = String(need);        // 给门用：画布必须装得下所有走线
  svg.dataset.fwd = String(fwd);          // 给门用：走列间主干的有几条（不是全都往下绕）
  svg.innerHTML = out;
}

/* ── 剧本 ─────────────────────────────── */
function renderScript(d) {
  if (!d.scripts.length) {
    $('#scriptWrap').innerHTML = `<p class="empty">还没有剧本。<br><br>在项目根建一个 <code>${esc(d.scriptFile)}</code>，一个二级标题一条主线：<br><br>
      <code>## 买家从搜索到发出询盘</code><br><code>1. index.html · default · 搜 led</code><br><code>2. detail.html · · 点进第一个产品</code><br><code>3. inquiry.html · guest · 没登录就点询盘</code>
      <br><br>状态留空就是默认态。<br>剧本是给外部展示时走的路线——100 页让对方自己点，他会点进半成品。</p>`;
    return;
  }
  let h = '';
  d.scripts.forEach((sc, si) => {
    h += `<div class="sc"><div class="sc-h"><span class="n">${esc(sc.name)}</span>
      <span><span class="p" style="margin-right:8px">${sc.steps.length} 步</span><button class="btn sm primary" data-play="${si}">从头走一遍</button></span></div><ul class="sc-steps">`;
    sc.steps.forEach((st, i) => {
      const at = S.play && S.play.si === si && S.play.i === i;
      h += `<li class="${at ? 'at' : ''}" data-play="${si}" data-step="${i}"><span class="i">${i + 1}</span>
        <span class="p">${esc(st.rel)}${st.state && st.state !== 'default' ? ' · ' + esc(st.state) : ''}</span>
        <span class="note">${esc(st.note)}</span></li>`;
    });
    h += '</ul></div>';
  });
  $('#scriptWrap').innerHTML = h;
}

/* ── 检查（七道门） ───────────────────────── */
const GATE_NAME = {
  deadlink: '断链', orphan: '没人跳得到', deadend: '进去出不来',
  'state-missing': '说了没做', 'state-undocumented': '做了没说', 'spec-missing': '没有说明',
  'spec-drift': '说明对不上页面', 'field-undocumented': '字段没规则',
  'script-deadstep': '剧本指向不存在的页', 'script-deadstate': '剧本指向不存在的态',
  'view-noentry': '抽屉的入口找不到', 'view-nostate': '声明了抽屉但没做',
  'overlay-missing': '说了有这个开关但没做', 'overlay-undocumented': '有开关但说明没写',
};
function renderGate(d) {
  const bad = d.issues.filter(i => i.level === 'bad'), warn = d.issues.filter(i => i.level === 'warn');
  let h = `<div class="gate-sum">`;
  h += bad.length ? `<b class="r">${bad.length} 条硬伤</b>　` : `<b class="g">没有硬伤</b>　`;
  h += warn.length ? `<b class="y">${warn.length} 条要看一眼</b>` : `<b class="g">没有要看的</b>`;
  h += `<br>硬伤＝拿出去一定出事；要看一眼＝很可能漏了，也可能是故意的。</div>`;
  if (!d.issues.length) h += '<p class="empty">门全过了。<br>门全绿不等于做对了，收尾还是要自己走一遍。</p>';
  for (const i of [...bad, ...warn]) {
    h += `<div class="iss ${i.level}"><div class="p">${esc(i.page)}　${esc(GATE_NAME[i.code] || i.code)}</div>
      <div class="t"><button data-rel="${esc(i.page)}" data-state="default" style="text-align:left">${esc(i.text)}</button></div>
      ${i.fix ? `<div class="f">怎么办：${esc(i.fix)}</div>` : ''}</div>`;
  }
  $('#gateWrap').innerHTML = h;
}

/* ── 去某一页的某个态 ─────────────────────── */
function goto(rel, state) {
  if (!rel) return;
  S.at = { rel, state: state || 'default', on: [...S.on] };
  uw.flowGoto({ rel, state: S.at.state, on: [...S.on] });
  render();
  if (S.show) renderPlayer();
}

/* ── 展示模式 ─────────────────────────── */
function setShow(on) {
  S.show = !!on;
  $('#player').hidden = !S.show;
  $('#btnShow').classList.toggle('on', S.show);
  uw.flowGoto({ show: S.show });                 // 主窗口那边进 / 出「只看画布」
  if (S.show) { if (!S.play && S.data && S.data.scripts.length) S.play = { si: 0, i: -1 }; renderPlayer(); }
}
function playStep(si, i) {
  const sc = S.data && S.data.scripts[si]; if (!sc) return;
  i = Math.max(0, Math.min(sc.steps.length - 1, i));
  S.play = { si, i };
  const st = sc.steps[i];
  goto(st.rel, st.state);
  if (!S.show) render();
}
function renderPlayer() {
  const d = S.data;
  if (!d || !d.scripts.length) {
    $('#plName').textContent = '还没有剧本';
    $('#plNote').textContent = '展示模式要走剧本。先在 ' + (d ? d.scriptFile : '剧本.md') + ' 里写一条主线。';
    $('#plAt').textContent = ''; $('#plPrev').disabled = $('#plNext').disabled = true; return;
  }
  const p = S.play || { si: 0, i: -1 }, sc = d.scripts[p.si];
  $('#plName').textContent = sc.name;
  $('#plAt').textContent = p.i < 0 ? '—' : `${p.i + 1} / ${sc.steps.length}`;
  $('#plNote').textContent = p.i < 0 ? '点「下一步」开始' : (sc.steps[p.i].note || sc.steps[p.i].rel);
  $('#plPrev').disabled = p.i <= 0;
  $('#plNext').disabled = p.i >= sc.steps.length - 1;
}

/* ── 事件 ─────────────────────────────── */
$('#tabs').addEventListener('click', async e => {
  const b = e.target.closest('button[data-v]'); if (!b) return;
  const was = S.view; S.view = b.dataset.v;
  /* 铺开和流程都要宽画布：流程图的卡片一行摆不下三张就失去「一眼看全貌」的意义了。
     其余三个视图是列表型的，窄窗口反而更好用 —— 所以进这两个撑宽、离开还原。 */
  const wide = v => v === 'wall' || v === 'map';
  if (wide(S.view) && !wide(was)) await wallResize(true);
  else if (!wide(S.view) && wide(was)) await wallResize(false);
  render();
});
$('#wallMode').addEventListener('click', e => { const b = e.target.closest('button[data-m]'); if (b) { S.wall.mode = b.dataset.m; render(); } });
/* 开关一动，主窗口那边也要跟着叠上——控制台和页面显示的必须是同一件事 */
$('#onsBar').addEventListener('click', e => {
  const b = e.target.closest('button[data-on]'); if (!b) return;
  const k = b.dataset.on;
  if (S.on.has(k)) S.on.delete(k); else S.on.add(k);
  if (S.at.rel) uw.flowGoto({ rel: S.at.rel, state: S.at.state || 'default', on: [...S.on] });
  render();
});
$('#wallPage').onchange = e => { S.wall.rel = e.target.value; render(); };
$('#wallZoom').oninput = e => {
  S.wall.zoom = +e.target.value;
  /* 只改尺寸不重建 iframe —— 重建会让每张缩略图重新装一遍页面，拖滑条就卡住了。
     高度取**这一组**统一后的那个值，不是各张自己量到的，否则一拖滑条卡片又错开了。 */
  const k = S.wall.zoom / 100, W = 1240;
  for (const grp of document.querySelectorAll('#wallGrid .wtiles')) {
    const gh = +grp.dataset.h || 0;
    for (const t of grp.querySelectorAll('.tile-shot')) {
      const fr = t.querySelector('iframe');
      const hh = gh || (fr && fr.dataset.h ? +fr.dataset.h : 860);
      t.style.width = Math.round(W * k) + 'px'; t.style.height = Math.round(hh * k) + 'px';
      if (t.parentElement) t.parentElement.style.width = Math.round(W * k) + 'px';   /* 卡片跟着一起变，别让说明文字决定宽度 */
      if (fr) fr.style.transform = 'scale(' + k + ')';
    }
  }
};
$('#btnScan').onclick = () => scan();
$('#btnShow').onclick = () => setShow(!S.show);
/* 展示模式是「我自己驱动着演示」；走查包是「对方自己点」。两件事都要，别只做一半 */
$('#btnWalk').onclick = async () => {
  if (!S.id || !uw.flowWalk) return;
  const b = $('#btnWalk'), old = b.textContent;
  b.disabled = true; b.textContent = '在导…';
  const r = await uw.flowWalk({ id: S.id });
  b.disabled = false; b.textContent = old;
  if (!r.ok) { $('#projSub').textContent = r.error; return; }
  /* 有硬伤也照导，但要说一声——发出去之前他该知道对方会点到什么 */
  $('#projSub').textContent = `已导出 ${r.file}（${Math.round(r.bytes / 1024)}KB，${r.pages} 页）` + (r.bad ? `　⚠️ 还有 ${r.bad} 条硬伤，对方会点到` : '');
};
$('#plExit').onclick = () => setShow(false);
$('#plPrev').onclick = () => S.play && playStep(S.play.si, S.play.i - 1);
$('#plNext').onclick = () => S.play && playStep(S.play.si, S.play.i + 1);
document.querySelector('.body').addEventListener('click', e => {
  const play = e.target.closest('[data-play]');
  if (play) {
    const si = +play.dataset.play;
    if (play.dataset.step != null) playStep(si, +play.dataset.step);
    else { S.play = { si, i: 0 }; playStep(si, 0); }
    return;
  }
  const g = e.target.closest('[data-rel]');
  if (g) goto(g.dataset.rel, g.dataset.state);
});
/* 说明展开/收起。收起时它只占一行，图就能多分到 37px 高 —— 这不是抠细节，
   4 屏摆两行的时候，37px 高会变成每张缩略图大 18px。 */
$('#mapTipT').onclick = () => {
  const more = $('#mapTip .tip-more'), t = $('#mapTipT');
  more.hidden = !more.hidden;
  t.textContent = more.hidden ? '怎么读 ▾' : '收起 ▴';
  if (S.view === 'map' && S.data && S.map) {
    $('#mapWrap').style.paddingBottom = S.map.band + 'px';
    fitMap(S.map.plan, S.map.edges, S.map.colOf, S.map.band);
  }
};

/* 🔴 窗口一变大小，「撑满」就得重算 —— 不重算的话把窗口拉大，图还是原来那么小，
   看着像卡住了。只有流程图是按窗口反算尺寸的，别的视图不用重画。
   走 fitMap 不走 render：后者会重建 DOM，每张缩略图重装一遍页面，拉窗口时一路闪。 */
let mapRz = null;
window.addEventListener('resize', () => {
  if (S.view !== 'map' || !S.data || !S.map) return;
  clearTimeout(mapRz);
  mapRz = setTimeout(() => {
    const w = $('#mapWrap');
    if (!w || !w.querySelector('.mcard')) return;
    w.style.paddingBottom = S.map.band + 'px';
    fitMap(S.map.plan, S.map.edges, S.map.colOf, S.map.band);
  }, 120);
});

/* 展示的时候用方向键翻页，省得每次去点按钮 */
window.addEventListener('keydown', e => {
  if (!S.show || !S.play) return;
  if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); playStep(S.play.si, S.play.i + 1); }
  if (e.key === 'ArrowLeft') { e.preventDefault(); playStep(S.play.si, S.play.i - 1); }
  if (e.key === 'Escape') setShow(false);
});

uw.onFlowProject(({ id, name }) => { S.id = id; if (name) $('#projName').textContent = name; scan(); });
/* 主窗口那边人自己换了页或换了态，高亮跟着走——两边说的是同一件事，不能各显示各的 */
uw.onFlowAt(({ rel, state, on, name }) => {
  if (name) $('#projName').textContent = name;
  /* 主窗口换页时叠加开关会被清掉（那是页面级的类），控制台的勾要跟着松，
     不然勾还亮着、屏幕上却没叠——人会以为开关坏了 */
  if (on) { S.on = new Set(on); }
  if (rel) { S.at = { rel, state: state || 'default', on: on || [] }; render(); }
});
