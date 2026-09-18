'use strict';
/* ── 多页面流程：把一个项目扫成「页 × 态 × 跳转 × 说明」四件事 ────────────────
   为什么要这个：一个需求上到十几个页面、每页六七个状态之后，「有没有漏」就不能靠人点一遍了
   （吉吉 2026-09-17：「100 页包含各种极限值、各种错误、未登录这种状态」）。Figma 到这个量级也
   不是靠看画布，是靠命名和检索——所以这里不复刻画布，只做一件事：**把真值扫出来，让机器判漏**。

   🔴 三条地基约定（改这三条 = 六个模块一起返工，动之前先想清楚）：

   ① 状态是**页面级**的，落在根节点的一个类上：`<body class="state-default">`。
      CSS 里写 `body.state-empty .list{display:none}`。
      为什么是类不是文件：重复率高（吉吉原话），15 个页面 × 6 态如果拆 100 个文件，
      改一次页头要改 100 遍，第三次改动就没人维护了。类还有个白捡的好处——
      **控制台在 iframe 外面换这个类就能切态，页面里一行 demo 代码都不用留**，交付给前端的就是干净的。
      而且这些类名本身就是前端要用的真实状态类，不是脚手架。

   ② 状态的**人话名和触发条件**写在说明里（人写意图），CSS 里有没有那条规则是**实现真值**。
      两边都留，门负责比对——这是故意的双源，不是漏设计：
      只有一个源的话，「声明了没实现」和「实现了没声明」这两种漏都发现不了。

   ③ 说明住在页面旁边：`index.html` → `index.说明.md`。
      单一维护源那条铁律在这儿的含义是：**同一件事只写一遍**。
      跳转关系不用人写（从 `<a href>` 扫得到），人只写机器扫不出来的那部分（为什么、什么时候、校验规则）。

   扫出来的东西落 `.uw/flow.json`，**机器生成、不给人手编**（人编的都在 .说明.md 里）。 */

const fs = require('fs');
const path = require('path');

const SKIP_DIR = new Set(['.uw', '.git', 'node_modules', '附件', '_交付', 'dist', 'build']);
const SPEC_SUFFIX = '.说明.md';
/* 控制台自己生成的文件不算页面，不然会自己跳自己 */
const NOT_PAGE = /^_flow\.html$|^_走查\.html$/i;
/* 模板源文件不是页面：它是 build 脚本的输入，跳转和状态都还没渲染出来，当页面算会一路误报 */
const NOT_PAGE2 = /template|\.tpl\./i;

/* ── 小工具 ───────────────────────────────────────── */
function listHtml(base) {
  const out = [];
  (function walk(d, pre) {
    let names; try { names = fs.readdirSync(d); } catch (e) { return; }
    for (const n of names) {
      if (n.startsWith('.') || SKIP_DIR.has(n)) continue;
      const p = path.join(d, n), rel = pre ? pre + '/' + n : n;
      let st; try { st = fs.statSync(p); } catch (e) { continue; }
      if (st.isDirectory()) walk(p, rel);
      else if (/\.html?$/i.test(n) && !NOT_PAGE.test(n) && !NOT_PAGE2.test(n)) out.push(rel);
    }
  })(base, '');
  return out.sort((a, b) => a.localeCompare(b, 'zh'));
}

/* 去掉注释和字符串里的东西再做正则，省得把 <!-- 注掉的 --> 也算进来 */
function stripComments(s) { return String(s).replace(/<!--[\s\S]*?-->/g, ''); }

function titleOf(html) {
  let m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (m && m[1].trim()) return m[1].replace(/\s+/g, ' ').trim();
  m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (m) { const t = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); if (t) return t; }
  return '';
}

/* 页面里所有的 CSS：内联 <style> ＋ 项目内的 <link rel=stylesheet>（外站的不管） */
function cssOf(html, base, rel) {
  let css = '';
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) css += '\n' + m[1];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/stylesheet/i.test(tag)) continue;
    const h = (tag.match(/href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i) || [])[0] || '';
    const href = h.replace(/^href\s*=\s*/i, '').replace(/^["']|["']$/g, '');
    if (!href || /^(https?:)?\/\/|^data:/i.test(href)) continue;
    const p = path.join(base, path.dirname(rel), href.split(/[?#]/)[0]);
    try { if (fs.existsSync(p) && fs.statSync(p).isFile()) css += '\n' + fs.readFileSync(p, 'utf8'); } catch (e) {}
  }
  return css;
}

/* ── 视图：同一个文件里的抽屉 / 浮层 / 弹窗，也算一个「页面」──────────────
   吉吉 2026-09-18：「PPC 营销助手里面的主要在抽屉跳转，你就应该把所有抽屉样式展示，
   这个也是算页面」。为什么不拆成独立 html：抽屉是**盖在页面上的**，拆文件就丢了背景，
   而且前端拿到的本来就该是一个文件里的抽屉。所以它在磁盘上仍是一页，在控制台上单独占一行。

   🔴 为什么非要有这一层，而不是把抽屉当成普通状态：对照表里「空格子＝还没做」这个语义
   全靠同一列的东西可比。把 `forecast-result` 和 `empty` 摆进同一排列头，两者根本不可比，
   空格会大面积变成「不适用」——那一刻这张表就不再是覆盖清单了。

   声明写在 CSS 注释里，跟 @态 一套写法：
     / * @视图 forecast 抽屉·广告预测 · 主页面点「广告预测」打开 · .btn[data-open=forecast] * /
   声明之后 `state-forecast-*` 这一族状态就归到这个视图底下。
   第三段（入口选择器）可选：写了就能在流程图上画出「主视图 → 这个抽屉」那条边，
   而且会被门核验（选择器页面里必须真存在，跟 spec-drift 同一套判据）。 */
function viewsOf(css) {
  const out = [], seen = new Set();
  for (const m of css.matchAll(/@视图\s+([A-Za-z0-9_-]+)\s*([^\n*]*)/g)) {
    const key = m[1];
    if (seen.has(key)) continue;
    seen.add(key);
    const parts = (m[2] || '').trim().split(/\s*[·|]\s*/).map(x => x.trim()).filter(Boolean);
    /* 🔴 最后一段「长得像选择器」才当入口，否则整段都算说明。
       实测栽过：视图名写成「抽屉·广告预测」时，· 被当字段分隔符，
       名字被切成「抽屉」、说明变成「广告预测」、入口吃掉了那句人话 ——
       而 selectorIn 对认不出的写法一律放过，所以门全绿、入口其实压根没验。
       判据宽一点没关系：认错了最多少画一条边，不会把对的判成错的。 */
    const looksSel = t => /^[.#a-zA-Z][\w.#\[\]="'~^$*|:>+\- ]*$/.test(t) && /[.#\[]/.test(t);
    const sel = parts.length > 1 && looksSel(parts[parts.length - 1]) ? parts.pop() : '';
    out.push({ key, name: parts[0] || key, how: parts.slice(1).join(' · '), sel });
  }
  return out;
}

/* 状态归哪个视图：按声明过的视图 key 做**最长**前缀匹配。
   🔴 必须最长优先 —— 同时声明了 `diag` 和 `diagnose` 时，`state-diagnose-empty`
   按短的匹配会被归到 `diag` 那一行，看表的人会在错误的行里找它，而且找得到一个空格子，
   于是得出「这个态没做」的结论。错行比不分行更糟。 */
function viewOfKey(key, views) {
  let best = '';
  for (const v of views) if (key === v.key || key.startsWith(v.key + '-')) { if (v.key.length > best.length) best = v.key; }
  return best;
}

/* ── 叠加开关：跟状态正交、可以同时开着的那一维 ──────────────────
   PPC 那页的「OSS客服视角」就是：它不是第四个场景，它叠在任意一个场景/抽屉之上
   （表格多一列、柱状图 2 组变 3 组）。
   🔴 拍平进 state 有两个代价，都不划算：格子数直接翻倍；而且语义是错的 ——
   「出结果」和「出结果-OSS」会被读成两个并列的态，实际上后者是前者的一个切面。
   根节点类是 `on-<key>`，可以同时挂任意多个。
     / * @叠加 oss OSS客服视角 · 客服才看得到「行业平均 / 行业优秀」 * / */
function overlaysOf(css, html) {
  const found = new Map();
  for (const m of css.matchAll(/\.on-([A-Za-z0-9_-]+)/g)) {
    const k = m[1]; if (!found.has(k)) found.set(k, { key: k, name: '', when: '' });
  }
  for (const m of css.matchAll(/@叠加\s+([A-Za-z0-9_-]+)\s*([^\n*]*)/g)) {
    const k = m[1];
    const [name, when] = (m[2] || '').trim().split(/\s*[·|]\s*/);
    const e = found.get(k) || { key: k, name: '', when: '' };
    if (name) e.name = name.trim(); if (when) e.when = when.trim();
    found.set(k, e);
  }
  /* 根节点上已经挂着的也算（CSS 里还没写规则时也能显示出来） */
  const bm = stripComments(html || '').match(/<body\b[^>]*\bclass\s*=\s*("([^"]*)"|'([^']*)')/i);
  for (const c of ((bm ? (bm[2] || bm[3] || '') : '').split(/\s+/))) {
    if (/^on-/.test(c)) { const k = c.slice(3); if (!found.has(k)) found.set(k, { key: k, name: '', when: '' }); }
  }
  return [...found.values()].map(o => ({ ...o, name: o.name || o.key }));
}

/* ── 状态：从 CSS 里扫 .state-xxx，顺手认一下 CSS 注释里的人话名 ──────────
   注释写法（可选，写了更好读）：  / * @态 empty 空 · 一条结果都没有 * /
   人话名的正本在 .说明.md，这儿认到只是为了「md 还没写时也能显示个名字」。 */
function statesOf(html, css, views) {
  views = views || [];
  const found = new Map();   // key → { key, name, when }
  /* 哪些态是 CSS 里真有规则的。下面判「默认」要用它 —— 有规则＝它是从基准偏离出来的一个样子，
     没规则＝它就是基准本身，只是作者给基准起了个名字。 */
  const styled = new Set();
  for (const m of css.matchAll(/\.state-([A-Za-z0-9_-]+)/g)) {
    const k = m[1]; styled.add(k); if (!found.has(k)) found.set(k, { key: k, name: '', when: '' });
  }
  for (const m of css.matchAll(/@态\s+([A-Za-z0-9_-]+)\s*([^\n*]*)/g)) {
    const k = m[1], rest = (m[2] || '').trim();
    const [name, when] = rest.split(/\s*[·|]\s*/);
    const e = found.get(k) || { key: k, name: '', when: '' };
    if (name) e.name = name.trim(); if (when) e.when = when.trim();
    found.set(k, e);
  }
  /* 页面当前挂着的那个态（<body class="state-xxx">）也算一个，哪怕 CSS 里没为它写规则 */
  const bm = stripComments(html).match(/<body\b[^>]*\bclass\s*=\s*("([^"]*)"|'([^']*)')/i);
  const cur = bm ? (bm[2] || bm[3] || '') : '';
  for (const c of cur.split(/\s+/)) if (/^state-/.test(c)) { const k = c.slice(6); if (!found.has(k)) found.set(k, { key: k, name: '', when: '' }); }
  /* 补不补一个 state-default，判据是**页面发布时挂着的那个主视图态有没有自己的 CSS 规则**：
       · 没有规则 → 它就是「什么类都不挂时的样子」，只是作者给它起了个名（PPC 的 state-running）。
         这时再补一个 default，对照表会多出一格跟它渲染完全一样的东西，铺开会并排出两张
         看不出差别的图 —— 人的第一反应是「我是不是看漏了」，而不是「哦这俩一样」。
       · 有规则 → 它是从基准偏离出来的（比如 body.state-guest .price{display:none}），
         那个基准（登录后能看见价格的样子）是真实存在的另一屏，必须单独占一格。
     🔴 不能只看「body 上挂没挂类」——那样两种情形长得一模一样，一定会判错一边。 */
  const curMain = cur.split(/\s+/).map(c => /^state-/.test(c) ? c.slice(6) : '').find(k => k && !viewOfKey(k, views)) || '';
  const baseIsNamed = curMain && !styled.has(curMain);
  const hasMain = [...found.keys()].some(k => !viewOfKey(k, views));
  if (!hasMain || !baseIsNamed) { if (!found.has('default')) found.set('default', { key: 'default', name: '默认', when: '' }); }
  /* 默认那个排第一：对照表第一列固定是「正常的样子」，人从左往右读才对得上「正常 → 各种不正常」 */
  const first = found.get('default') || found.get(curMain);
  const list = [...(first ? [first] : []), ...[...found.values()].filter(x => x !== first)];
  /* 🔴 标出「基准那一个」。对照表的列是跨页合并出来的，合并时按「几页有这个态」排序，
     基准态一旦不叫 default 就会被挤到中间去 —— 而人从左往右读的前提是第一列＝正常的样子。
     实测：guest 当基准时，第一列排成了 empty，点第一格进的是空态。 */
  /* view = 归哪个视图（主视图是空串）；sub = 去掉视图前缀之后的那一截，
     对照表的列头用 sub —— 列头写「出结果」而不是「forecast-result」，跨页才对得上。 */
  return list.map((s, i) => {
    const v = viewOfKey(s.key, views);
    const sub = v ? (s.key === v ? 'default' : s.key.slice(v.length + 1)) : s.key;
    return { ...s, view: v, sub, base: i === 0 && !v, name: s.name || defaultName(sub) };
  });
}
const NAME_HINT = { default: '默认', empty: '空', error: '出错', loading: '加载中', guest: '未登录', max: '极限值', disabled: '禁用', offline: '断网', denied: '没权限' };
function defaultName(k) { return NAME_HINT[k] || k; }

/* ── 页面里自带的 demo 控制条 ────────────────────────────────
   吉吉 2026-09-18：「我希望控制台也有像 demo 控制台这种选项」。
   他现有的页面（PPC 助手那张）状态不是用 state-* 类切的，是页面里一条
   `<div class="ppc-demobar">Demo控制台（不属于产品界面）· 账户场景：…</div>`
   带着几个 radio，脚本里 `style.display` 一改就换场景。
   🔴 所以控制台在他的存量项目上只认出「1 页 1 态」—— 等于没用。

   做法是**不改他的页面**：扫出这条 bar 里的选项，搬到控制台上显示；
   点的时候由探针在预览里真去点那个 input（页面自己的脚本照跑，行为完全一致），
   同时把这条 bar 在预览里藏起来 —— 「沉浸」和「不改页面」两件事一起成立。
   那条 bar 留在源码里也没坏处：他自己标了「不属于产品界面」，发给没装 UW 的人还能用。

   认它的判据（任一命中）：类名像 demobar / 里面的文字以「Demo控制台」开头 / 显式标了 data-uw-demobar。
   判据要宽一点没关系 —— 认错了最多是把一条工具栏搬到控制台上，不会改坏页面。 */
function demobarOf(html) {
  const src = stripComments(html);
  /* 先框出这条 bar 的范围。没有嵌套解析，按「开标签 → 同级闭合」粗切，够用 */
  let seg = null;
  const re = /<div\b[^>]*>/gi;
  let m;
  while ((m = re.exec(src))) {
    const tag = m[0];
    const looks = /class\s*=\s*["'][^"']*demo-?bar/i.test(tag) || /\bdata-uw-demobar\b/i.test(tag);
    if (!looks) continue;
    /* 往后取一段，到下一个同类块或 1 屏为止 */
    const chunk = src.slice(m.index, m.index + 4000);
    const end = chunk.search(/<\/div>\s*<(div|section|main|header|h1)/i);
    seg = end > 0 ? chunk.slice(0, end) : chunk;
    break;
  }
  if (!seg) {
    const i = src.search(/Demo\s*控制台/i);
    if (i < 0) return null;
    const from = src.lastIndexOf('<div', i);
    if (from < 0) return null;
    seg = src.slice(from, from + 4000);
    const end = seg.search(/<\/div>\s*<(div|section|main|header|h1)/i);
    if (end > 0) seg = seg.slice(0, end);
  }

  const groups = [];
  /* 一组 radio = 一组互斥场景；每个 checkbox 自己一组开关 */
  const radios = new Map();
  for (const mm of seg.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/gi)) {
    const inner = mm[1];
    const inp = inner.match(/<input\b[^>]*>/i);
    if (!inp) continue;
    const tag = inp[0];
    const type = (tag.match(/type\s*=\s*["']?(\w+)/i) || [])[1] || 'text';
    const name = (tag.match(/\bname\s*=\s*("([^"]*)"|'([^']*)')/i) || []).slice(2).find(Boolean) || '';
    const value = (tag.match(/\bvalue\s*=\s*("([^"]*)"|'([^']*)')/i) || []).slice(2).find(Boolean) || '';
    const id = (tag.match(/\bid\s*=\s*("([^"]*)"|'([^']*)')/i) || []).slice(2).find(Boolean) || '';
    const checked = /\bchecked\b/i.test(tag);
    const label = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!label) continue;
    if (/radio/i.test(type) && name) {
      if (!radios.has(name)) radios.set(name, { kind: 'radio', name, label: '', options: [] });
      radios.get(name).options.push({ value, label, checked });
    } else if (/checkbox/i.test(type)) {
      groups.push({ kind: 'checkbox', name: id || name, id, label, checked });
    }
  }
  /* 「账户场景：」这种前缀文字，给 radio 组当组名 */
  const lead = seg.match(/Demo\s*控制台[^<]*?[·:：]\s*([^<:：]{2,14})[:：]/i);
  for (const g of radios.values()) { g.label = (lead && lead[1].trim()) || '场景'; groups.push(g); }
  if (!groups.length) return null;
  return { groups };
}

/* ── 跳转：只认真的 <a href>，这是页面自己的真值，不用人写 ────────────── */
function linksOf(html, base, rel, pages) {
  const out = [];
  const src = stripComments(html);
  for (const m of src.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = m[1];
    const hm = attrs.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!hm) continue;
    const href = (hm[2] ?? hm[3] ?? hm[4] ?? '').trim();
    if (!href || /^(#|javascript:|mailto:|tel:)/i.test(href)) continue;
    if (/^(https?:)?\/\//i.test(href)) continue;           // 外站，不属于这个需求的流程
    const [file, hash] = href.split('#');
    if (!file) continue;
    const to = path.posix.normalize(path.posix.join(path.posix.dirname(rel), file.split('?')[0])).replace(/^\.\//, '');
    if (!/\.html?$/i.test(to)) continue;                   // 图片、下载之类的不是跳转
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);   /* 换成空格不是空串：<a><span>标题</span><span>价格</span></a> 直接剥会粘成「标题价格」 */
    const cm = attrs.match(/\bclass\s*=\s*("([^"]*)"|'([^']*)')/i);
    /* 🔴 类名要全带上。只取第一个的话 class="btn inq-btn"（发询盘）和 class="btn sec"（返回）
       都会变成 a.btn ——两条跳转指到同一个选择器，前端和他的 AI 就没法定位是哪一个了 */
    const cls = cm ? (cm[2] || cm[3] || '').trim().split(/\s+/).filter(Boolean) : [];
    out.push({ to, text, sel: 'a' + cls.map(c => '.' + c).join(''), cls, state: hash && /^state-/.test(hash) ? hash.slice(6) : '', ok: pages.includes(to) });
  }
  /* 同一个去处重复多次（页脚里 20 个链接指同一页）只留一条，但把次数记上 */
  const byKey = new Map();
  for (const l of out) { const k = l.to + '|' + l.sel + '|' + l.text; const e = byKey.get(k); if (e) e.n++; else byKey.set(k, { ...l, n: 1 }); }
  return [...byKey.values()];
}

/* ── 说明（人写的那份）：只解析结构化的三张表，散文部分原样不碰 ───────── */
/* 说明是 markdown，但状态名、触发条件这些会被原样印到控制台的格子标题、
   走查包的下拉、缩略图的说明上 —— 那些地方不渲染 markdown。
   🔴 实测：说明里写「**这是页面发布时的样子**」，铺开的格子标题就真的带着两对星号。
   所以读进来的时候把行内标记剥掉（结构性的 | 和换行另有处理，这儿只管强调和代码）。 */
function plain(t) {
  return String(t == null ? '' : t)
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1$2')
    .replace(/\s+/g, ' ').trim();
}
function parseSpec(md) {
  const spec = { states: [], overlays: [], links: [], rules: [], headings: [] };
  const lines = md.split(/\r?\n/);
  let sec = '';
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^#{1,6}\s*(.+?)\s*$/);
    if (h) {
      const t = h[1];
      spec.headings.push(t);
      sec = /状态/.test(t) ? 'states' : /跳转/.test(t) ? 'links' : /规则|校验|字段/.test(t) ? 'rules' : '';
      continue;
    }
    if (!sec || !/^\s*\|/.test(lines[i])) continue;
    const cells = lines[i].split('|').slice(1, -1).map(s => s.trim());
    if (!cells.length) continue;
    if (/^-{2,}|^:?-+:?$/.test(cells[0])) continue;                       // 分隔行
    if (sec === 'states') {
      if (/^状态$/.test(cells[0]) || /类名/.test(cells[1] || '')) continue;  // 表头
      const raw = (cells[1] || '').replace(/`/g, '').trim();
      /* 🔴 叠加开关（on-*）也写在「状态」这一节底下（它跟状态是同一件事的两半，
         分到两个章节去写，人写的时候会漏掉一半）。但它不是状态 —— 当成状态收进来的话，
         `state-missing` 门会报「说明里写了 on-oss 这个态，页面里没做」，
         而页面做得好好的。实测就是这么红的。按前缀分流，不靠章节标题。 */
      if (/^\.?on-/.test(raw)) {
        const ok = raw.replace(/^\.?on-/, '');
        if (ok) spec.overlays.push({ key: ok, name: plain(cells[0]), when: plain(cells[2]) });
        continue;
      }
      const key = raw.replace(/^\.?state-/, '');   /* 先剥反引号再去前缀，顺序反了 `state-x` 剥不掉 */
      if (key) spec.states.push({ key, name: plain(cells[0]), when: plain(cells[2]) });
    } else if (sec === 'links') {
      if (/跳到|目标/.test(cells[1] || '')) continue;
      const to = (cells[1] || '').replace(/`/g, '').trim();
      if (/\.html?$/i.test(to)) spec.links.push({ sel: (cells[0] || '').replace(/`/g, '').trim(), to, when: plain(cells[2]) });
    } else if (sec === 'rules') {
      if (/^挂在哪$/.test(cells[0]) || /^规则$/.test(cells[1] || '')) continue;
      const sel = (cells[0] || '').replace(/`/g, '').trim();
      if (sel) spec.rules.push({ sel, text: plain(cells[1]) });
    }
  }
  return spec;
}

/* 说明里提到的选择器，页面里到底有没有。
   只认得出最常见的三种写法（.类 / #id / 标签[属性=值]），认不出的一律当「验不了」放过——
   🔴 门宁可漏报也不能错报：错报一次，人就再也不信这道门了。 */
function selectorIn(html, sel) {
  const s = String(sel).trim();
  if (!s) return null;
  const src = stripComments(html);
  const one = s.split(/\s+/).pop();                       // 只验最后那一段，祖先链不验
  let m;
  if ((m = one.match(/^\.([A-Za-z0-9_-]+)$/))) return new RegExp(`class\\s*=\\s*["'][^"']*\\b${m[1]}\\b`).test(src);
  if ((m = one.match(/^#([A-Za-z0-9_-]+)$/))) return new RegExp(`id\\s*=\\s*["']${m[1]}["']`).test(src);
  if ((m = one.match(/^([a-z]+)\[([A-Za-z-]+)=["']?([^\]"']+)["']?\]$/i)))
    return new RegExp(`<${m[1]}\\b[^>]*\\b${m[2]}\\s*=\\s*["']?${m[3]}\\b`, 'i').test(src);
  if ((m = one.match(/^([a-z]+)$/i))) return new RegExp(`<${m[1]}\\b`, 'i').test(src);
  return null;                                            // 认不出，不判
}

/* 页面里带 name 的表单字段——前端最需要知道校验规则的就是这些 */
function fieldsOf(html) {
  const out = [];
  for (const m of stripComments(html).matchAll(/<(input|select|textarea)\b([^>]*)>/gi)) {
    if (/type\s*=\s*["']?(hidden|submit|button)/i.test(m[2])) continue;
    const nm = m[2].match(/\bname\s*=\s*("([^"]*)"|'([^']*)')/i);
    const name = nm ? (nm[2] || nm[3] || '').trim() : '';
    if (name) out.push({ tag: m[1].toLowerCase(), name });
  }
  const seen = new Set();
  return out.filter(f => { const k = f.tag + '[' + f.name + ']'; if (seen.has(k)) return false; seen.add(k); return true; });
}

/* ── 剧本：给外部展示用的主线 ──────────────────────────
   为什么要这个：100 页丢给对方自己点，他会点进半成品、点进死路（吉吉 2026-09-17 定「走查是我自己和给外部展示」）。
   展示态给的是**路线**不是地图。剧本也顺带能当门用——每一步指的页和态必须真的存在。
   写在项目根的 `剧本.md`，一个二级标题一条主线，下面是有序列表：
     ## 买家从搜索到发出询盘
     1. index.html · default · 买家搜 led，看到 20 条结果
     2. detail.html · · 点进第一个产品          ← 状态留空 = 默认态
     3. inquiry.html · guest · 没登录就点了询盘 */
const SCRIPT_FILE = '剧本.md';
function parseScripts(md) {
  const out = [];
  let cur = null;
  for (const line of String(md).split(/\r?\n/)) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) { cur = { name: plain(h[1]), steps: [] }; out.push(cur); continue; }
    if (!cur) continue;
    const it = line.match(/^\s*(?:\d+[.)]|[-*])\s+(.+?)\s*$/);
    if (!it) continue;
    const parts = it[1].split(/\s*·\s*/);
    const rel = (parts[0] || '').replace(/`/g, '').trim();
    if (!/\.html?$/i.test(rel)) continue;
    /* note 会被原样印在展示模式的大字提示和走查包上，那两处都不渲染 markdown —— 
       写剧本的人习惯性打的 **粗体** 会变成一对星号杵在屏幕中间。跟说明同一套处理。 */
    cur.steps.push({ rel, state: (parts[1] || '').trim() || 'default', note: plain(parts.slice(2).join(' · ')) });
  }
  return out.filter(s => s.steps.length);
}

/* ── 五道门 ───────────────────────────────────────────
   都从上面扫出来的真值算，没有一条靠人声明。
   分级：bad = 拿出去一定出事；warn = 很可能是漏了，但也可能是故意的。 */
function gates(pages, entry, scripts) {
  const issues = [];
  const add = (level, code, page, text, fix) => issues.push({ level, code, page, text, fix });
  const byRel = new Map(pages.map(p => [p.rel, p]));

  for (const p of pages) {
    /* ① 断链：点了会 404。Figma 里连线画错没人知道，这里是硬伤 */
    for (const l of p.links) if (!l.ok) add('bad', 'deadlink', p.rel, `「${l.text || l.sel}」指向 ${l.to}，项目里没有这个文件`, '要么建这一页，要么把链接改对');

    /* ② 状态：说明和实现对不对得上 */
    const cssKeys = new Set(p.states.map(s => s.key));
    const mdKeys = new Set((p.spec.states || []).map(s => s.key));
    if (p.spec.exists && mdKeys.size) {
      for (const k of mdKeys) if (!cssKeys.has(k)) add('bad', 'state-missing', p.rel, `说明里写了「${k}」这个态，页面里没做`, `CSS 里补 body.state-${k} 的规则`);
      for (const k of cssKeys) if (k !== 'default' && !mdKeys.has(k)) add('warn', 'state-undocumented', p.rel, `页面里有「${k}」态，说明里没写什么时候出现`, '在说明的状态表里补一行');
      /* 叠加开关同一套判据：说明写了页面没做 = 红，页面有说明没写 = 黄。
         只做状态不做开关的话，`on-*` 这一维就是「写了没人核」，跟没写一样。 */
      const cssOn = new Set((p.overlays || []).map(o => o.key));
      const mdOn = new Set((p.spec.overlays || []).map(o => o.key));
      for (const k of mdOn) if (!cssOn.has(k)) add('bad', 'overlay-missing', p.rel, `说明里写了「${k}」这个叠加开关，页面里没做`, `CSS 里补 body.on-${k} 的规则`);
      for (const k of cssOn) if (!mdOn.has(k)) add('warn', 'overlay-undocumented', p.rel, `页面里有「${k}」叠加开关，说明里没写什么时候开`, '在说明的状态那一节补一行');
    }

    /* ③ demo 控制条做进了页面里：状态该用 state-* 类，切换归这个控制台管 */
    if (p.demobar) {
      const n = p.demobar.groups.reduce((a, g) => a + (g.options ? g.options.length : 1), 0);
      add('bad', 'demobar-in-page', p.rel, `这一页把 demo 控制条做在页面里了（${n} 个选项）。状态改成根节点的 state-* 类，切换交给这个控制台`,
        '让 Claude 改一次：每个场景一个 state-*，CSS 里写 body.state-xxx 的规则，删掉那条 bar 和它的脚本');
    }

    /* ③′ 视图（抽屉 / 浮层）：声明了就得对得上页面
       —— 这两条跟 spec-drift 同一套判据：声明是人写的，页面是真值，门只负责比。 */
    for (const v of (p.views || [])) {
      if (v.sel) {
        const has = selectorIn(p._html, v.sel);
        if (has === false) add('bad', 'view-noentry', p.rel, `视图「${v.name}」写的入口 ${v.sel} 在页面里找不到`, '入口改名了，或者 @视图 那行的选择器写错了');
      }
      if (!p.states.some(st => st.view === v.key))
        add('warn', 'view-nostate', p.rel, `声明了视图「${v.name}」，但一个 state-${v.key}-* 都没做`, `CSS 里补 body.state-${v.key}-default 之类的规则，或者删掉这行 @视图`);
    }

    /* ④ 说明本身在不在、够不够 */
    if (!p.spec.exists) add('warn', 'spec-missing', p.rel, '这一页没有说明文件，前端拿到只有代码', `新建 ${p.rel.replace(/\.html?$/i, '')}${SPEC_SUFFIX}`);
    else {
      for (const r of p.spec.rules) { const has = selectorIn(p._html, r.sel); if (has === false) add('bad', 'spec-drift', p.rel, `说明里写了 ${r.sel} 的规则，页面里找不到这个元素`, '说明过期了，或者元素被改名了'); }
      for (const f of p.fields) {
        const hit = p.spec.rules.some(r => r.sel.includes('[' + f.name + ']') || r.sel.includes(f.name));
        if (!hit) add('warn', 'field-undocumented', p.rel, `字段 ${f.tag}[name=${f.name}] 没写校验规则，前端只能自己猜`, '在说明的规则表里补一行');
      }
    }
  }

  /* 剧本里指的页和态必须真的存在，不然展示当场翻车——这是「给外部看」那条路上最贵的一种错 */
  for (const sc of (scripts || [])) for (let i = 0; i < sc.steps.length; i++) {
    const st = sc.steps[i], p = byRel.get(st.rel);
    if (!p) { add('bad', 'script-deadstep', st.rel, `剧本「${sc.name}」第 ${i + 1} 步指向 ${st.rel}，项目里没有这一页`, '把这一页做出来，或者改剧本'); continue; }
    if (st.state && !p.states.some(x => x.key === st.state)) add('bad', 'script-deadstate', st.rel, `剧本「${sc.name}」第 ${i + 1} 步要的「${st.state}」态，这一页没有`, `CSS 里补 body.state-${st.state}，或者改剧本`);
  }

  /* ④⑤ 只有一页的项目没有「流程」可言，这两道门一律不跑——
     🔴 门在不该说话的时候说话，人就会开始忽略它，那比没有这道门更糟 */
  if (pages.length < 2) return issues;

  /* ④ 孤儿：谁都跳不到它。要么漏了入口，要么这页本来就是多余的 */
  const reached = new Set([entry]);
  for (const p of pages) for (const l of p.links) if (l.ok) reached.add(l.to);
  for (const p of pages) if (!reached.has(p.rel)) add('warn', 'orphan', p.rel, '没有任何一页跳得到它', '要么补入口，要么这页是不是不用做了');

  /* ⑤ 死路：进得去出不来。空态、错误态最容易忘留出口 */
  for (const p of pages) if (!p.links.length) add('warn', 'deadend', p.rel, '这一页一个出口都没有，用户进来就卡住了', '至少留一条返回或下一步');

  return issues;
}

/* ── 对外唯一入口：扫一个项目 ─────────────────────── */
function scan(base, opt) {
  opt = opt || {};
  const rels = listHtml(base);
  const pages = [];
  for (const rel of rels) {
    let html = ''; try { html = fs.readFileSync(path.join(base, rel), 'utf8'); } catch (e) { continue; }
    const css = cssOf(html, base, rel);
    const specRel = rel.replace(/\.html?$/i, '') + SPEC_SUFFIX;
    const specAbs = path.join(base, specRel);
    let spec = { exists: false, states: [], overlays: [], links: [], rules: [], headings: [] };
    if (fs.existsSync(specAbs)) { try { spec = { exists: true, ...parseSpec(fs.readFileSync(specAbs, 'utf8')) }; } catch (e) {} }
    const views = viewsOf(css);
    pages.push({
      rel, title: titleOf(html) || rel,
      demobar: demobarOf(html),
      views, overlays: overlaysOf(css, html),
      states: statesOf(html, css, views),
      links: linksOf(html, base, rel, rels),
      fields: fieldsOf(html),
      spec: { rel: specRel, ...spec },
      _html: html,
    });
  }
  /* 状态的人话名以说明里写的为准（人写的意图是正本，CSS 注释只是没写说明时的兜底） */
  for (const p of pages) for (const s of p.states) {
    const m = (p.spec.states || []).find(x => x.key === s.key);
    if (m) { if (m.name) s.name = m.name; if (m.when) s.when = m.when; }
  }
  for (const p of pages) for (const o of p.overlays) {
    const m = (p.spec.overlays || []).find(x => x.key === o.key);
    if (m) { if (m.name) o.name = m.name; if (m.when) o.when = m.when; }
  }
  const entry = opt.entry && rels.includes(opt.entry) ? opt.entry
    : rels.includes('index.html') ? 'index.html' : (rels[0] || '');
  let scripts = [];
  const scAbs = path.join(base, SCRIPT_FILE);
  if (fs.existsSync(scAbs)) { try { scripts = parseScripts(fs.readFileSync(scAbs, 'utf8')); } catch (e) {} }
  const issues = gates(pages, entry, scripts);
  /* 入度出度给流程图用 */
  const inN = new Map();
  for (const p of pages) for (const l of p.links) if (l.ok) inN.set(l.to, (inN.get(l.to) || 0) + 1);
  const out = {
    version: 1, at: Date.now(), entry, scripts, scriptFile: SCRIPT_FILE,
    pages: pages.map(p => ({
      rel: p.rel, title: p.title, states: p.states, links: p.links, fields: p.fields, demobar: p.demobar,
      views: p.views, overlays: p.overlays,
      spec: { rel: p.spec.rel, exists: p.spec.exists, headings: p.spec.headings, states: p.spec.states, overlays: p.spec.overlays, links: p.spec.links, rules: p.spec.rules },
      in: inN.get(p.rel) || 0, out: p.links.filter(l => l.ok).length,
    })),
    issues,
    n: {
      pages: pages.length,
      /* 视图数＝主视图（每页恒有一个）＋ 声明出来的抽屉 / 浮层。
         这是「这个需求一共有多少屏要看」的真值，比页面数更接近工作量。 */
      views: pages.reduce((a, p) => a + 1 + p.views.length, 0),
      states: pages.reduce((a, p) => a + p.states.length, 0),
      overlays: pages.reduce((a, p) => a + p.overlays.length, 0),
      bad: issues.filter(i => i.level === 'bad').length, warn: issues.filter(i => i.level === 'warn').length,
    },
  };
  return out;
}

/* 扫完落盘。放 .uw/ 里，fs.watch 那边已经过滤掉 .uw，不会自己触发自己重载 */
function scanAndSave(base, opt) {
  const r = scan(base, opt);
  try { fs.mkdirSync(path.join(base, '.uw'), { recursive: true }); fs.writeFileSync(path.join(base, '.uw', 'flow.json'), JSON.stringify(r, null, 2)); } catch (e) {}
  return r;
}

module.exports = { plain, scan, scanAndSave, parseSpec, parseScripts, selectorIn, statesOf, linksOf, listHtml, demobarOf, viewsOf, overlaysOf, viewOfKey, SPEC_SUFFIX, SCRIPT_FILE };
