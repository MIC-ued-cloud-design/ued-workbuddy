'use strict';
/**
 * 飞鹊体检 —— 客户端里的机器门。
 *
 * 为什么要有：终端里出稿有一串 Stop 钩子（出稿门 / 视觉自检）兜底，客户端一个都没有，
 * 所以同一个模型在客户端里会把「全页只一个红按钮」「Alert 里不放按钮」这些写在 DESIGN.md 里的话当耳旁风。
 * 靠自觉不行，靠机器：每次预览文件落地就静态扫一遍，把违规摆在预览栏上，一键喂回给 Claude 改。
 *
 * 只做静态分析（不跑页面）：够抓住反复出现的那几类错，也不用起浏览器。
 * 权威源＝随包的 docs/飞鹊Web组件库.css（类名表、色值表、尺寸档都从它现读，不另抄一份）。
 */
const fs = require('fs');
const path = require('path');

let _lib = null;
function norm(h) { h = h.toUpperCase(); if (h.length === 4) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3]; return h; }
function lib(packDir) {
  if (_lib) return _lib;
  const css = fs.readFileSync(path.join(packDir, 'docs', '飞鹊Web组件库.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const classes = new Set(); for (const m of css.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)) classes.add(m[1]);
  const colors = new Set(); for (const m of css.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) colors.add(norm(m[0]));
  /* DESIGN.md 色表里有、CSS 里未必出现的几个（页面底、分割线、状态浅底、品牌红） */
  ['#DA291C', '#FFFFFF', '#000000', '#F5F7FA', '#DAE0E6', '#E6ECF2', '#E6E6E6', '#F0F1F2', '#FEF6E5', '#FFF2F2', '#EBFBF6', '#B3B3B3', '#FDF1F1', '#EBF5FF', '#222222', '#555555', '#888888'].forEach(c => colors.add(c));
  /* 飞鹊库自己有 5 处 font-weight:600（面包屑 current / Tabs 选中 / 骨架屏标题）。
     模型把官方 CSS 原样抄进页面是我们要求它做的事，不能反过来判它违规 —— 但也不能把 600 整个放行，
     否则模型自己写的 .my-title{font-weight:600} 就混过去了。所以只记下「官方哪个选择器是哪个值」，逐条对。 */
  const offW = new Map();
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const w = /font-weight\s*:\s*([^;}]+)/.exec(m[2]);
    if (!w || /^(400|700|normal|bold|inherit)$/.test(w[1].trim())) continue;
    for (const sel of m[1].split(',')) offW.set(sel.trim().replace(/\s+/g, ' '), w[1].trim());
  }
  /* 品牌标识的内容指纹：从 brand/*.svg 取 path 数据，用来判断页面里那个标是真资产还是手画的。
     只看有没有 <svg> 标签是不够的 —— 手画的也是 svg。 */
  const brand = [];
  try {
    const bd = path.join(packDir, 'brand');
    for (const f of fs.readdirSync(bd).filter(x => x.endsWith('.svg'))) {
      const t = fs.readFileSync(path.join(bd, f), 'utf8');
      const ds = [...t.matchAll(/\sd="([^"]{40,})"/g)].map(m => m[1].slice(0, 60));
      if (ds.length) brand.push({ file: f, marks: ds });
    }
  } catch (e) { /* 包里没有 brand/ 就不查这条，不因此把整个体检搞崩 */ }
  _lib = { classes, colors, offW, brand, prefixes: ['btn', 'inp', 'alert', 'tag', 'bdg', 'sel', 'pg', 'msg', 'tip', 'cb', 'rd', 'sw', 'skel', 'spin'] };
  return _lib;
}
/* 从某个开标签起，按 div/section 深度找到它的闭合，返回内部 HTML */
function blockAfter(html, start) {
  const re = /<\/?(div|section)\b[^>]*>/g; re.lastIndex = start;
  let depth = 0, m;
  while ((m = re.exec(html))) {
    if (m[0][1] === '/') { depth--; if (depth <= 0) return html.slice(start, m.index); }
    else if (!/\/>$/.test(m[0])) depth++;
  }
  return html.slice(start, start + 4000);
}

function check(html, packDir) {
  const L = lib(packDir);
  const issues = [];
  const css = ((html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || []).map(s => s.replace(/<\/?style[^>]*>/gi, '')).join('\n') + ' ' + (html.match(/style="[^"]*"/g) || []).join(' ')).replace(/\/\*[\s\S]*?\*\//g, '');

  /* 1 字体：只认 Roboto 首选 */
  const fams = [...css.matchAll(/font-family\s*:\s*([^;}]+)/g)].map(m => m[1].trim()).filter(f => !/^(inherit|initial|unset)$/.test(f) && !/^var\(/.test(f));
  const badFam = [...new Set(fams.filter(f => !/^['"]?Roboto/i.test(f) && !/monospace/i.test(f)))];
  if (badFam.length) issues.push({ rule: 'font', level: 'bad', msg: `字体不是 Roboto 首选：${badFam.slice(0, 3).join(' / ')}` });

  /* 2 字重：只有 400 / 700（官方库自己那几处 600 按选择器豁免，见 lib() 里的 offW） */
  const ok = w => /^(400|700|normal|bold|inherit)$/.test(w);
  const badW = new Set();
  for (const m of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const sels = m[1].split(',').map(x => x.trim().replace(/\s+/g, ' ')).filter(Boolean);
    for (const d of [...m[2].matchAll(/font-weight\s*:\s*([^;}]+)/g)].map(x => x[1].trim())) {
      if (ok(d)) continue;
      if (sels.length && sels.every(sel => L.offW.get(sel) === d)) continue;   // 原样抄自飞鹊库，放行
      badW.add(d.replace(/["';]/g, '').trim());
    }
  }
  /* 规则块外的（内联 style="font-weight:600"、font: 500 14px/22px 缩写）一律照判，没有选择器可豁免 */
  for (const d of [...css.replace(/\{[^{}]*\}/g, '').matchAll(/font-weight\s*:\s*([^;}"']+)/g)].map(x => x[1].trim())) if (!ok(d)) badW.add(d);
  for (const d of [...css.matchAll(/\bfont\s*:\s*(?:italic\s+|oblique\s+)?(\d{3}|bold|bolder|lighter)\s/g)].map(x => x[1])) if (!ok(d)) badW.add(d);
  if (badW.size) issues.push({ rule: 'weight', level: 'bad', msg: `字重只有 400 / 700，出现了 ${[...badW].join('、')}` });

  /* 3 色值：不在飞鹊表内的 */
  const cnt = {}; for (const m of css.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) { const c = norm(m[0]); cnt[c] = (cnt[c] || 0) + 1; }
  const badC = Object.keys(cnt).filter(c => !L.colors.has(c));
  if (badC.length) issues.push({ rule: 'color', level: 'warn', msg: `${badC.length}个色值不在飞鹊表内：${badC.slice(0, 6).join(' ')}${badC.length > 6 ? ' …' : ''}`, detail: badC });

  /* 4 自造组件：用了飞鹊的命名前缀、飞鹊却没有这个类（.btn-neutral 这种） */
  const used = new Set(); for (const m of html.matchAll(/class="([^"]*)"/g)) m[1].split(/\s+/).forEach(c => c && used.add(c));
  const fake = [...used].filter(c => L.prefixes.some(p => c === p || c.startsWith(p + '-')) && !L.classes.has(c));
  if (fake.length) issues.push({ rule: 'fake-class', level: 'bad', msg: `用了飞鹊命名、飞鹊里却没有的类：${fake.slice(0, 6).join(' ')}${fake.length > 6 ? ' …' : ''}。要么用真类名，要么别借飞鹊的前缀`, detail: fake });

  /* 5 覆写了飞鹊的尺寸档（先把 var(--x) 解开再比，变量最终等于飞鹊值就不算错） */
  const vars = {}; for (const m of css.matchAll(/(--[a-zA-Z0-9_-]+)\s*:\s*([^;}]+)/g)) vars[m[1]] = m[2].trim();
  const unvar = s => s.replace(/var\((--[a-zA-Z0-9_-]+)(?:\s*,\s*[^)]*)?\)/g, (_, k) => vars[k] != null ? unvar(vars[k]) : _);
  const sizeKeys = { 'btn-lg': ['height:40px', 'border-radius:8px', 'font-size:16px'], 'btn-md': ['height:32px', 'border-radius:6px'], 'btn-sm': ['height:24px', 'border-radius:4px'], 'btn-primary': ['background:#E64545'], 'btn-secondary': ['border-color:#222'] };
  for (const [k, need] of Object.entries(sizeKeys)) {
    const m = css.match(new RegExp('(?:^|[\\s,}])\\.' + k + '\\s*\\{([^}]*)\\}'));
    if (!m) continue;
    const body = unvar(m[1]).replace(/\s+/g, '').toUpperCase();
    const miss = need.filter(n => !body.includes(n.replace(/\s+/g, '').toUpperCase()));
    if (miss.length) issues.push({ rule: 'override', level: 'bad', msg: `.${k}的规格跟飞鹊不一致（飞鹊是 ${need.join('，')}），组件规则要原样从 docs/飞鹊Web组件库.css 复制` });
  }

  /* 6 实心红落点：全页只该有一个主 CTA */
  const redClasses = new Set();
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/background(-color)?\s*:\s*(#E64545\b|var\(--[a-z0-9-]*(red|primary|brand)[a-z0-9-]*\))/i.test(m[2]) && !/:hover/.test(m[1])) {
      m[1].split(',').forEach(s => { const k = s.trim().match(/^\.([a-zA-Z0-9_-]+)$/); if (k) redClasses.add(k[1]); });
    }
  }
  let redBtns = 0;
  for (const m of html.matchAll(/<(button|a)\b[^>]*class="([^"]*)"/g)) if (m[2].split(/\s+/).some(c => redClasses.has(c))) redBtns++;
  if (redBtns > 1) issues.push({ rule: 'red', level: 'warn', msg: `实心红按钮有${redBtns}个。飞鹊口径：全页强调色只落一处（主CTA），其它动作用 .btn-secondary（白底黑边黑字）或 .btn-link` });

  /* 7 提示条里塞按钮：飞鹊 Alert 没有按钮槽位。
     不只认 .alert 这个名——凡是底色是飞鹊那几个状态浅底（错误/警告/信息/成功）的块，就当提示条看。
     2026-09-10 那页两条带按钮的提示条 class 叫 .bar，只认类名一条都抓不到。 */
  const tints = new Set(['#FDF1F1', '#FEF6E5', '#EBF5FF', '#EBFBF6', '#FFF2F2']);
  const tintClasses = new Set(['alert']);
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const bg = (unvar(m[2]).match(/background(?:-color)?\s*:\s*(#[0-9a-fA-F]{3,6})\b/) || [])[1];
    if (bg && tints.has(norm(bg))) m[1].split(',').forEach(sel => { const k = sel.trim().match(/^\.([a-zA-Z0-9_-]+)(\.[a-zA-Z0-9_-]+)*$/); if (k) tintClasses.add(k[1]); });
  }
  let alertBtn = 0; const re = /<(div|section)\b[^>]*class="([^"]*)"[^>]*>/g; let m2;
  while ((m2 = re.exec(html))) {
    if (!m2[2].split(/\s+/).some(c => tintClasses.has(c) || /^alert/.test(c))) continue;
    if (/<button\b|<a\b[^>]*class="[^"]*\bbtn\b/.test(blockAfter(html, m2.index))) alertBtn++;
  }
  if (alertBtn) issues.push({ rule: 'alert-btn', level: 'bad', msg: `${alertBtn}条提示条（alert）里塞了按钮。飞鹊Alert没有按钮槽位，动作是 .alert-link文字链` });

  /* 8 有没有真的用上飞鹊的 CSS（一个飞鹊类都没出现＝整页手搓） */
  const fqUsed = [...used].filter(c => L.classes.has(c) && L.prefixes.some(p => c === p || c.startsWith(p + '-')));
  if (!fqUsed.length && /<button\b|<input\b/.test(html)) issues.push({ rule: 'no-feique', level: 'bad', msg: '页面里一个飞鹊组件类都没用到（.btn / .inp / .alert / .tag…），按钮输入框全是手搓的' });

  /* 9 价格写法（docs/MIC英文价格规范-AI友好型.md）：US$ 后不空格、区间用 - 、MOQ 写成 "(MOQ)" 不是 "(Min. Order)" */
  const text = html.replace(/<style[\s\S]*?<\/style>/gi, '');   // 价格常写在脚本数据里，script 不剥
  const priceBad = [];
  const sp = (text.match(/US\$\s+\d/g) || []).length; if (sp) priceBad.push(`「US$ 数字」之间多了空格${sp}处，规范是US$15.20紧挨着`);
  const mo = (html.match(/\(\s*Min\.?\s*Order\s*\)/gi) || []).length; if (mo) priceBad.push(`"(Min. Order)" ${mo}处，规范写 "(MOQ)"`);
  const dash = (text.match(/US\$\d[\d,.]*\s*[~–—]\s*\d/g) || []).length; if (dash) priceBad.push(`价格区间用了 ~ 或长横线${dash}处，规范是短横 -`);
  if (priceBad.length) issues.push({ rule: 'price', level: 'bad', msg: `价格写法不合规范：${priceBad.join('；')}（docs/MIC英文价格规范-AI友好型.md）` });

  /* 10 手画品牌资产：页面里出现这些专有名词，却没用 brand/ 里的真 SVG。
     这些标的字在飞鹊里是矢量图形不是文字节点，拿彩色文字拼出来足够像、以至于没人会再去核对。 */
  const BRANDS = [
    { name: 'Secured Trading', re: /secured\s*trading/i, files: /^sts-/ },
    { name: 'Audited',         re: /\bAudited\b/,         files: /^audited-/ },
    { name: 'Leading Factory', re: /leading\s*factory/i,  files: /^leading-factory-/ },
  ];
  /* 🔴 必须先剥标签再匹配：手画的标常常是 <span>Secured</span><span>Trading</span>
     这样拼出来的，正则按连续文本找就一个都抓不到（2026-09-15 第一版门就漏在这儿）。
     剥完标签「Secured」「Trading」会直接相邻，所以词间用 \s* 允许零间隔。 */
  const plain = html.replace(/<style[\s\S]*?<\/style>/gi, '')
                    .replace(/<script[\s\S]*?<\/script>/gi, '')
                    .replace(/<[^>]+>/g, '');
  for (const b of BRANDS) {
    if (!b.re.test(plain)) continue;
    const mine = (L.brand || []).filter(x => b.files.test(x.file));
    if (!mine.length) continue;                                  // 包里没有这个标就不判
    const used = mine.some(x => x.marks.some(d => html.includes(d)))   // 原样内联了真 SVG
              || mine.some(x => html.includes(x.file));               // 或用 <img src> 引了它
    if (!used) issues.push({ rule: 'fake-brand', level: 'bad',
      msg: `「${b.name}」是手画/文字拼的。它在飞鹊里是整体矢量（字也是画出来的，不是文字节点），` +
           `要用 brand/ 里的真 SVG：${mine.map(x => x.file).join(' / ')}（清单见 brand/INDEX.md）` });
  }

  const badN = issues.filter(i => i.level === 'bad').length;
  return { issues, ok: badN === 0, n: issues.length, badN, fqUsed: fqUsed.length };
}
module.exports = { check };
