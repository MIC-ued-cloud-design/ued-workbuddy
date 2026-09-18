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
  wall: { mode: 'states', rel: '', zoom: 26, html: new Map(), narrow: null } };

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
    if (S.wall.narrow == null) S.wall.narrow = window.outerWidth;
    if (window.outerWidth < 900) await uw.flowResize({ w: 1180 });
  } else if (S.wall.narrow != null) {
    await uw.flowResize({ w: S.wall.narrow });
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

function renderMap(d) {
  /* 🔴 门槛从「至少两页」改成「至少两屏」：PPC 那种一个 html 带三个抽屉的页面，
     按页数算是 1，直接被判成「没有流程可画」——而它恰恰是流程最需要画出来的那一类
     （吉吉原话：主要在抽屉跳转）。屏＝页面 + 它声明的视图。 */
  const screens = d.pages.reduce((a, p) => a + 1 + (p.views || []).length, 0);
  if (screens < 2) { $('#mapWrap').innerHTML = '<p class="empty">只有一屏，没有流程可画。<br>页面之间用真的 <code>&lt;a href&gt;</code> 连起来，<br>同一页里的抽屉用 <code>/* @视图 key 名字 · 怎么进来 · 入口选择器 *&#47;</code> 声明，这里就有图了。</p>'; return; }
  const ls = layers(d);
  let h = '';
  ls.forEach((group, i) => {
    if (!group || !group.length) return;
    h += `<div class="map-lab">${i === 0 ? '跳不到的（孤儿）' : i === 1 ? '入口' : '第 ' + (i - 1) + ' 步'}</div>`;
    for (const p of group) {
      const broken = p.links.filter(l => !l.ok).length;
      const vs = p.views || [];
      h += `<div><button class="node ${p.rel === S.at.rel ? 'at' : ''}" data-rel="${esc(p.rel)}" data-state="default">
        <span class="t">${esc(p.title)}</span>
        <span class="m">${esc(p.rel)} · ${statesIn(p, '').length} 态${vs.length ? ` · ${vs.length} 个浮层` : ''}${broken ? ` · <span class="bad">${broken} 断</span>` : ''}</span></button>`;
      h += stateBtns(p, '');
      /* 视图（抽屉 / 浮层）作为这一页的子节点缩进挂着。
         它不另起一层：它跟页面是同一屏上的覆盖关系，不是走了一步。
         把它画成下一层会让「步数」这个刻度失真——第 3 步到底是跳了三次页，还是开了三次抽屉？ */
      for (const v of vs) {
        h += `<div class="vnode-wrap"><button class="node vnode ${p.rel === S.at.rel && (S.at.state || '').indexOf(v.key) === 0 ? 'at' : ''}"
          data-rel="${esc(p.rel)}" data-state="${esc(statesIn(p, v.key).length ? statesIn(p, v.key)[0].key : v.key)}">
          <span class="t">${esc(v.name)}</span>
          <span class="m">${esc(v.how || '同页浮层')}${v.sel ? ' · <code>' + esc(v.sel) + '</code>' : ''}</span></button>`;
        h += stateBtns(p, v.key);
        h += '</div>';
      }
      if (p.links.length) {
        h += '<ul class="edges">';
        for (const l of p.links) {
          const to = d.pages.find(x => x.rel === l.to);
          h += `<li class="${l.ok ? '' : 'broken'}">${esc(l.text || l.sel)} <span class="w">→ ${esc(to ? to.title : l.to)}${l.ok ? '' : '（没有这一页）'}</span></li>`;
        }
        h += '</ul>';
      }
      h += '</div>';
    }
  });
  $('#mapWrap').innerHTML = h;
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
  if (S.view === 'wall') await wallResize(true);
  else if (was === 'wall') await wallResize(false);
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
