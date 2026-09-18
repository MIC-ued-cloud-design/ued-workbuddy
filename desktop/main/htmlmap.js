'use strict';
/**
 * htmlmap —— 把「预览里点中的那个元素」对回「HTML 源文件里的那一段」，然后原地改写。
 *
 * 为什么不直接把 DOM 序列化回文件：页面若有脚本在加载时往 DOM 里塞内容，序列化会把跑出来的结果
 * 烤进源码，脚本再跑一遍就重复；而且源码格式会被冲掉。所以走「稳定编号 + 逐条补丁」：
 *   ① 协议层给源码里每个开标签按出现顺序编号（data-uw-i="N"，只在送去预览的那份上加，不落盘）
 *   ② 预览里改动只报「第 N 个元素的什么从 A 到 B」
 *   ③ 这里用同一套分词器重新数一遍源码，找到第 N 个开标签，原地补丁
 * 两边用的是同一个分词器、同一份源码，编号才对得上。结构性改动（删/复制/挪位置）之后编号会变，
 * 所以那类改动做完预览要重载一次。
 *
 * 分词只认「标签在哪」，不建 DOM 树：script/style/textarea/title 的正文整段跳过（里面可能有 < ），
 * 注释和 CDATA 跳过，属性值里的 > 不当标签结束。
 */

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'textarea', 'title']);
/* 浏览器会用「下一个同级开标签」隐式关掉的元素：li 遇 li、p 遇块级标签…… */
const IMPLICIT = (() => {
  const S = a => new Set(a.split(' '));
  const blocks = 'address article aside blockquote div dl fieldset figure footer form h1 h2 h3 h4 h5 h6 header hr main nav ol p pre section table ul';
  return { li: S('li'), dt: S('dt dd'), dd: S('dt dd'), tr: S('tr'), td: S('td th'), th: S('td th'), option: S('option optgroup'), p: S(blocks) };
})();
const ATTR_RE = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/* 把源码切成标签流。每个开标签带顺序编号 i（从 0 起）。 */
function tokenize(html) {
  const toks = [];
  let p = 0, i = 0;
  const n = html.length;
  while (p < n) {
    const lt = html.indexOf('<', p);
    if (lt < 0) break;
    const c = html[lt + 1];
    if (c === '!') {
      if (html.startsWith('<!--', lt)) { const e = html.indexOf('-->', lt + 4); p = e < 0 ? n : e + 3; continue; }
      if (html.startsWith('<![CDATA[', lt)) { const e = html.indexOf(']]>', lt); p = e < 0 ? n : e + 3; continue; }
      const e = html.indexOf('>', lt); p = e < 0 ? n : e + 1; continue;   // doctype
    }
    if (c === '?') { const e = html.indexOf('>', lt); p = e < 0 ? n : e + 1; continue; }
    if (c === '/') {
      const m = /^<\/([a-zA-Z][^\s>\/]*)\s*>/.exec(html.slice(lt, lt + 200));
      if (!m) { p = lt + 2; continue; }
      toks.push({ type: 'end', name: m[1].toLowerCase(), start: lt, end: lt + m[0].length });
      p = lt + m[0].length; continue;
    }
    if (!/[a-zA-Z]/.test(c || '')) { p = lt + 1; continue; }
    /* 开标签：逐字符扫到不在引号里的 > */
    let q = null, k = lt + 1;
    while (k < n) {
      const ch = html[k];
      if (q) { if (ch === q) q = null; }
      else if (ch === '"' || ch === "'") q = ch;
      else if (ch === '>') break;
      k++;
    }
    if (k >= n) break;
    const inner = html.slice(lt + 1, k);
    const nm = /^([a-zA-Z][^\s>\/]*)/.exec(inner);
    if (!nm) { p = lt + 1; continue; }
    const name = nm[1].toLowerCase();
    const selfClosing = /\/\s*$/.test(inner);
    const tok = { type: 'start', name, i: i++, start: lt, end: k + 1, selfClosing, void: VOID.has(name), attrStart: lt + 1 + nm[0].length, attrEnd: k - (selfClosing ? inner.length - inner.replace(/\/\s*$/, '').length : 0) };
    toks.push(tok);
    p = k + 1;
    if (RAW.has(name) && !selfClosing) {
      const close = new RegExp('</' + name + '\\s*>', 'ig'); close.lastIndex = p;
      const m = close.exec(html);
      if (!m) break;
      toks.push({ type: 'end', name, start: m.index, end: m.index + m[0].length });
      p = m.index + m[0].length;
    }
  }
  return toks;
}

/* 给送去预览的那份源码打编号：每个开标签末尾插 data-uw-i="N" */
function mark(html) {
  const toks = tokenize(html).filter(t => t.type === 'start');
  let out = '', last = 0;
  for (const t of toks) {
    const at = t.attrEnd;
    out += html.slice(last, at) + (/\s$/.test(html.slice(t.attrStart, at)) ? '' : ' ') + 'data-uw-i="' + t.i + '"';
    if (t.selfClosing) out += ' ';
    last = at;
  }
  return out + html.slice(last);
}

/* 第 i 个元素在源码里的范围。找不到闭合时按「被父级闭合」处理（implicit），结构性操作不允许碰这种。 */
function range(html, i, toks) {
  toks = toks || tokenize(html);
  const at = toks.findIndex(t => t.type === 'start' && t.i === i);
  if (at < 0) return null;
  const open = toks[at];
  const r = { i, name: open.name, openStart: open.start, openEnd: open.end, attrStart: open.attrStart, attrEnd: open.attrEnd, selfClosing: open.selfClosing, void: open.void, implicit: false, count: 1 };
  if (open.void || open.selfClosing) { r.innerStart = r.innerEnd = r.closeEnd = open.end; r.leaf = true; return r; }
  let depth = 1;
  const closers = IMPLICIT[open.name];
  for (let k = at + 1; k < toks.length; k++) {
    const t = toks[k];
    if (t.type === 'start') {
      /* <li>one<li>two：同级又开了一个会把自己顶掉的标签，浏览器就在这儿把前一个关了 */
      if (depth === 1 && closers && closers.has(t.name)) { r.implicit = true; r.innerStart = open.end; r.innerEnd = t.start; r.closeEnd = t.start; return r; }
      r.count++; if (!t.void && !t.selfClosing) depth++; continue;
    }
    depth--;
    if (depth === 0) {
      if (t.name === open.name) { r.innerStart = open.end; r.innerEnd = t.start; r.closeEnd = t.end; return r; }
      /* 关掉的是父级：本元素没写闭合（<p>、<li> 之类），到这儿为止 */
      r.implicit = true; r.innerStart = open.end; r.innerEnd = t.start; r.closeEnd = t.start; r.count = countStarts(toks, at + 1, k); return r;
    }
  }
  r.implicit = true; r.innerStart = open.end; r.innerEnd = html.length; r.closeEnd = html.length; return r;
}
function countStarts(toks, a, b) { let c = 1; for (let k = a; k < b; k++) if (toks[k].type === 'start') c++; return c; }

/* 一段源码里有几个开标签（用来算复制之后新元素的编号） */
function startCount(html) { return tokenize(html).filter(t => t.type === 'start').length; }

/* ── 属性与内联样式 ─────────────────────────────── */
function parseAttrs(s) {
  const out = []; let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(s))) out.push({ name: m[1], value: m[2] != null ? m[2] : m[3] != null ? m[3] : m[4], raw: m[0], start: m.index, end: m.index + m[0].length, quote: m[2] != null ? '"' : m[3] != null ? "'" : '' });
  return out;
}
function parseStyle(s) {
  const out = [];
  for (const d of String(s || '').split(';')) {
    const k = d.indexOf(':'); if (k < 0) continue;
    const p = d.slice(0, k).trim(), v = d.slice(k + 1).trim();
    if (p) out.push([p.toLowerCase(), v]);
  }
  return out;
}
function serializeStyle(decls) { return decls.map(([p, v]) => p + ':' + v).join(';'); }

/* 改（或删）某元素的一个属性。value 为 null 表示删掉。 */
function setAttr(html, r, name, value) {
  const seg = html.slice(r.attrStart, r.attrEnd);
  const attrs = parseAttrs(seg);
  const hit = attrs.find(a => a.name.toLowerCase() === name.toLowerCase());
  const enc = v => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  if (hit) {
    const a = r.attrStart + hit.start, b = r.attrStart + hit.end;
    if (value == null) {
      let a2 = a; while (a2 > r.attrStart && /\s/.test(html[a2 - 1])) a2--;   // 连同前面的空格一起删
      return html.slice(0, a2) + html.slice(b);
    }
    return html.slice(0, a) + name + '="' + enc(value) + '"' + html.slice(b);
  }
  if (value == null) return html;
  const before = html.slice(0, r.attrEnd), sp = /\s$/.test(seg) ? '' : ' ';
  return before + sp + name + '="' + enc(value) + '"' + (r.selfClosing ? ' ' : '') + html.slice(r.attrEnd);
}
function getAttr(html, r, name) {
  const hit = parseAttrs(html.slice(r.attrStart, r.attrEnd)).find(a => a.name.toLowerCase() === name.toLowerCase());
  return hit ? decodeEntities(hit.value || '') : null;
}

/* 合并内联样式：set 里 value 为 null/'' 的删掉，其余覆盖或追加。 */
function mergeStyle(html, r, set) {
  const decls = parseStyle(getAttr(html, r, 'style'));
  for (const [p0, v] of Object.entries(set)) {
    const p = p0.toLowerCase();
    const k = decls.findIndex(d => d[0] === p);
    if (v == null || v === '') { if (k >= 0) decls.splice(k, 1); }
    else if (k >= 0) decls[k][1] = String(v);
    else decls.push([p, String(v)]);
  }
  return setAttr(html, r, 'style', decls.length ? serializeStyle(decls) : null);
}

/* ── 文本 ──────────────────────────────────────── */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(s) {
  return String(s).replace(/&(#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi, (m, _a, hx, dec, nm) => {
    if (hx) return String.fromCodePoint(parseInt(hx, 16));
    if (dec) return String.fromCodePoint(parseInt(dec, 10));
    return nm.toLowerCase() in ENT ? ENT[nm.toLowerCase()] : m;
  });
}
function encodeText(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
const collapse = s => String(s).replace(/\s+/g, ' ').trim();

/* 元素内部是不是「只有文字」（没有子标签；注释不算）。 */
function innerIsText(html, r) {
  if (r.leaf) return false;
  const inner = html.slice(r.innerStart, r.innerEnd).replace(/<!--[\s\S]*?-->/g, '');
  return !/<[a-zA-Z\/!]/.test(inner);
}

/* ── 整块（含它自己那一行的缩进）────────────────── */
function blockRange(html, r) {
  let a = r.openStart, b = r.closeEnd;
  let k = a; while (k > 0 && (html[k - 1] === ' ' || html[k - 1] === '\t')) k--;
  const ownLine = k === 0 || html[k - 1] === '\n';
  if (ownLine && k > 0) a = k - 1;            // 从前一个换行符起算，整行一起搬
  else if (ownLine) a = k;
  const indent = ownLine ? html.slice(k, r.openStart) : '';
  return { a, b, ownLine, indent };
}

/* ── 应用一批操作 ───────────────────────────────
   每条操作都对最新源码重新分词。返回{ html, select, changes }：
   select＝做完后建议选中的元素编号（结构性操作后编号会变，这里算好）；changes＝人话描述。 */
function apply(html, ops) {
  const changes = [];
  let select = null, focusPos = null;
  for (const op of ops) {
    /* 🔴 谁也不许把编号写进文件。data-uw-i 是送去预览的那份副本上临时加的，
       一旦被写回源码，下次编号就出现重号 —— 表现是「元素对不上（预览里是 <svg>，源码里是 <span>）」，
       而且是永久性的、只能手工清。2026-09-17 就是这么被一个「照搬 outerHTML」的改法埋进去的。
       这里是最后一道：不管哪条路送来的 html，一律先洗掉。 */
    if (op.html) op.html = String(op.html).replace(/\sdata-uw-i="\d+"/g, '').replace(/\sdata-uw-editing="[^"]*"/g, '');
    const toks = tokenize(html);
    const r = range(html, op.i, toks);
    if (!r) throw new Error(`找不到第${op.i}个元素，页面可能已经变了，刷新预览再试`);
    if (op.tag && r.name !== String(op.tag).toLowerCase()) throw new Error(`元素对不上（预览里是 <${op.tag}>，源码里是 <${r.name}>），刷新预览再试`);
    switch (op.op) {
      case 'style': {
        html = mergeStyle(html, r, op.set || {});
        select = op.i; focusPos = null;
        changes.push(`<${r.name}${labelOf(html, r)}> 样式 ${Object.entries(op.set || {}).map(([p, v]) => v == null || v === '' ? `去掉${p}` : `${p}=${v}`).join('、')}`);
        break;
      }
      case 'attr': {
        html = setAttr(html, r, op.name, op.value);
        select = op.i; focusPos = null;
        changes.push(`<${r.name}${labelOf(html, r)}> 属性 ${op.name}=${op.value == null ? '（删）' : op.value}`);
        break;
      }
      case 'text': {
        if (!innerIsText(html, r)) throw new Error('这块里面还有别的元素，不能整段改字；双击到最里层的文字再改');
        const cur = collapse(decodeEntities(html.slice(r.innerStart, r.innerEnd).replace(/<!--[\s\S]*?-->/g, '')));
        if (op.old != null && collapse(op.old) !== cur) throw new Error(`源码里的文字（「${cur.slice(0, 30)}」）跟预览里的不一样，文件可能刚被改过，刷新预览再试`);
        html = html.slice(0, r.innerStart) + encodeText(op.text) + html.slice(r.innerEnd);
        select = op.i; focusPos = null;
        changes.push(`<${r.name}${labelOf(html, r)}> 文字「${cur.slice(0, 20)}」→「${collapse(op.text).slice(0, 20)}」`);
        break;
      }
      case 'remove': {
        if (r.implicit) throw new Error('这个元素在源码里没写闭合标签，不能整块删，让Claude来改');
        const b = blockRange(html, r);
        html = html.slice(0, b.a) + html.slice(b.b);
        select = null; focusPos = null;
        changes.push(`删掉 <${r.name}${labelOf(null, null, op.label)}>`);
        break;
      }
      case 'duplicate': {
        if (r.implicit) throw new Error('这个元素在源码里没写闭合标签，不能复制，让Claude来改');
        const src = html.slice(r.openStart, r.closeEnd);
        const b = blockRange(html, r);
        const ins = b.ownLine ? '\n' + b.indent + src : src;
        html = html.slice(0, r.closeEnd) + ins + html.slice(r.closeEnd);
        focusPos = r.closeEnd + (b.ownLine ? 1 + b.indent.length : 0);
        changes.push(`复制了一份 <${r.name}${labelOf(html, r)}>`);
        break;
      }
      case 'move': {
        if (r.implicit) throw new Error('这个元素在源码里没写闭合标签，不能挪位置，让Claude来改');
        const t = range(html, op.to, toks);
        if (!t || t.implicit) throw new Error('目标位置对不上，刷新预览再试');
        if (t.openStart >= r.openStart && t.closeEnd <= r.closeEnd) throw new Error('不能把元素挪进它自己里面');
        const bs = blockRange(html, r), bt = blockRange(html, t);
        const src = html.slice(r.openStart, r.closeEnd);
        /* 先把自己剪掉，再算目标位置（目标在后面时它的坐标要减掉剪掉的长度） */
        const cut = bs.b - bs.a;
        let rest = html.slice(0, bs.a) + html.slice(bs.b);
        const shift = p => p > bs.a ? p - cut : p;
        let at, ins;
        if (op.where === 'before') {
          at = shift(bt.ownLine ? bt.a : bt.a);
          ins = bt.ownLine ? '\n' + bt.indent + src : src;
          if (!bt.ownLine) at = shift(t.openStart);
        } else {
          at = shift(t.closeEnd);
          ins = bt.ownLine ? '\n' + bt.indent + src : src;
        }
        html = rest.slice(0, at) + ins + rest.slice(at);
        focusPos = at + (bt.ownLine ? 1 + bt.indent.length : 0);
        changes.push(`把 <${r.name}${labelOf(null, null, op.label)}> 挪到 <${t.name}> ${op.where === 'before' ? '前面' : '后面'}`);
        break;
      }
      case 'replace': {
        /* 整块换成别的 HTML（拖飞鹊组件进来替换）。多行片段按原元素的缩进重排 */
        if (r.implicit) throw new Error('这个元素在源码里没写闭合标签，不能整块替换，让Claude来改');
        const b = blockRange(html, r);
        const piece = indent(op.html, b.indent);
        html = html.slice(0, r.openStart) + piece + html.slice(r.closeEnd);
        focusPos = r.openStart;
        changes.push(`把 <${r.name}${labelOf(null, null, op.label)}> 换成了${op.what ? '「' + op.what + '」' : '别的HTML'}`);
        break;
      }
      case 'insert': {
        const b = blockRange(html, r);
        if (op.where === 'before') {
          const at = b.ownLine ? b.a : r.openStart;
          const ins = b.ownLine ? '\n' + b.indent + indent(op.html, b.indent) : op.html;
          html = html.slice(0, at) + ins + html.slice(at);
          focusPos = at + (b.ownLine ? 1 + b.indent.length : 0);
        } else {
          if (r.implicit) throw new Error('这个元素在源码里没写闭合标签，定不准它后面在哪，换个位置放');
          const ins = b.ownLine ? '\n' + b.indent + indent(op.html, b.indent) : op.html;
          html = html.slice(0, r.closeEnd) + ins + html.slice(r.closeEnd);
          focusPos = r.closeEnd + (b.ownLine ? 1 + b.indent.length : 0);
        }
        changes.push(`在 <${r.name}${labelOf(null, null, op.label)}> ${op.where === 'before' ? '前面' : '后面'}插入了${op.what ? '「' + op.what + '」' : '一块HTML'}`);
        break;
      }
      case 'class': {
        /* 换类名（组件属性切档）：remove 里的去掉、add 里的加上，顺序保留 */
        const cur = (getAttr(html, r, 'class') || '').trim().split(/\s+/).filter(Boolean);
        const rm = new Set(op.remove || []);
        const next = cur.filter(c => !rm.has(c));
        for (const c of op.add || []) if (c && !next.includes(c)) next.push(c);
        html = setAttr(html, r, 'class', next.length ? next.join(' ') : null);
        select = op.i; focusPos = null;
        changes.push(`<${r.name}${labelOf(html, r)}> 类名 ${(op.remove || []).filter(Boolean).map(c => '-' + c).concat((op.add || []).filter(Boolean).map(c => '+' + c)).join(' ')}`);
        break;
      }
      default: throw new Error('不认识的操作：' + op.op);
    }
  }
  if (focusPos != null) {
    /* 结构变了，重新数：插入点之前有几个开标签，新元素就是第几个 */
    select = tokenize(html).filter(t => t.type === 'start' && t.start < focusPos).length;
  }
  return { html, select, changes };
}
/* 多行片段按目标缩进重排：第一行贴在原位，后面每行前面补缩进 */
function indent(piece, ind) {
  const lines = String(piece).replace(/\r\n?/g, '\n').split('\n');
  return lines.map((l, k) => k === 0 ? l : (l.trim() ? ind + l : l)).join('\n');
}
/* 保证页面里有某段样式：<style data-feique="id"> 已存在就不动，否则注进 </head> 前（没有head就放最前面的 <body> 之前，再不行放文件开头） */
function ensureStyle(html, id, css) { return ensureStyleAt(html, id, css).html; }
/* 同上，但把插入位置也交出来：注入会多一个开标签，插在目标元素前面时它的编号要 +1 */
function ensureStyleAt(html, id, css) {
  if (!css || !css.trim()) return { html, at: -1 };
  if (new RegExp('<style[^>]*data-feique="' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"', 'i').test(html)) return { html, at: -1 };
  const tag = '<style data-feique="' + id + '">\n' + css.trim() + '\n</style>\n';
  let m = /<\/head\s*>/i.exec(html);
  if (m) return { html: html.slice(0, m.index) + tag + html.slice(m.index), at: m.index };
  m = /<body\b[^>]*>/i.exec(html);
  if (m) return { html: html.slice(0, m.index) + tag + html.slice(m.index), at: m.index };
  return { html: tag + html, at: 0 };
}
/* 保证页面里有某段脚本（<script data-feique="id">）：注在 </body> 前，没有 body 就放末尾。放在文件尾部，不影响前面元素的编号 */
function ensureScript(html, id, js) {
  if (!js || !js.trim()) return html;
  if (new RegExp('<script[^>]*data-feique="' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"', 'i').test(html)) return html;
  const tag = '<script data-feique="' + id + '">\n' + js.trim() + '\n</script>\n';
  const m = /<\/body\s*>/i.exec(html);
  return m ? html.slice(0, m.index) + tag + html.slice(m.index) : html + '\n' + tag;
}
function labelOf(html, r, given) {
  if (given) return given;
  if (!html || !r) return '';
  const id = getAttr(html, r, 'id'), cls = getAttr(html, r, 'class');
  return (id ? '#' + id : '') + (cls ? '.' + cls.trim().split(/\s+/).slice(0, 2).join('.') : '');
}

/* 从线上克隆下来的页面第一行常常是 <base href="https://某站/">（整页的 CSS、图、字体都靠它指回线上）。
   后果：项目自己的 images/x.png 会被浏览器解析到那个站上去 → 404 → 换进来的图怎么都不显示。
   吉吉 2026-09-17 换 VO 头像时撞的第二个原因（第一个是图被上面一层遮罩盖着点不到）。

   🔴 只改送去预览的这一份副本，磁盘文件一个字不动；也只改「项目里真有这个文件」的那几条，
      其余（线上地址、data:、#锚点、协议相对 //）一个字不动 —— 改多了就是替页面做主。
   🔴 不碰 <a href>：那是页面跳转，UW 靠它认「点链接跳到另一页」，改成绝对地址会把那条路打断。
   resolve(raw) 由调用方给：能解析成项目内真实文件就回绝对地址，否则回 null。 */
function absolutizeForPreview(html, resolve) {
  if (!html || !/<base\s[^>]*href\s*=\s*["']?\s*https?:/i.test(html)) return html;   // 没有指向外站的 base，这一整套就不该动
  const swap = raw => {
    const v = String(raw || '').trim();
    if (!v || /^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith('//') || v.startsWith('#')) return null;
    return resolve(v);
  };
  html = html.replace(/(<(?:img|script|iframe|video|audio|source|embed|track)\b[^>]*?\ssrc\s*=\s*)(["'])([^"']*)\2/gi,
    (m, a, q, v) => { const u = swap(v); return u ? a + q + u + q : m; });
  html = html.replace(/(<link\b[^>]*?\shref\s*=\s*)(["'])([^"']*)\2/gi,
    (m, a, q, v) => { const u = swap(v); return u ? a + q + u + q : m; });
  html = html.replace(/url\((["']?)([^"')]+)\1\)/gi,
    (m, q, v) => { const u = swap(v); return u ? `url(${q || "'"}${u}${q || "'"})` : m; });
  return html;
}

module.exports = { tokenize, mark, range, apply, startCount, parseStyle, innerIsText, decodeEntities, ensureStyle, ensureStyleAt, ensureScript, absolutizeForPreview };
