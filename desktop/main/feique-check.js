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
  /* 随包字体的真实覆盖区间（build 时从 woff2 的 cmap 导出，不是手列的）。
     超出这个范围的字符会单独回落到下一档字体，跟旁边的 Roboto 不是一套。 */
  let cov = null;
  try { cov = JSON.parse(fs.readFileSync(path.join(packDir, 'fonts', 'coverage.json'), 'utf8')); } catch (e) {}
  _lib = { classes, colors, offW, brand, cov, prefixes: ['btn', 'inp', 'alert', 'tag', 'bdg', 'sel', 'pg', 'msg', 'tip', 'cb', 'rd', 'sw', 'skel', 'spin'] };
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
  /* 克隆线上的页面要豁免「该用飞鹊砖」那几条：它的类名本来就是线上的，
     99% 自造是正常的，判它等于要求它别还原。判据跟 feique-font.js 的 isClone 同一套。 */
  const isClone = /<base\b[^>]*\bhref\s*=\s*["']https?:/i.test(html)
    || (html.match(/@font-face[^}]*font-family\s*:\s*["']?Roboto/gi) || []).length >= 4;
  const css = ((html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || []).map(s => s.replace(/<\/?style[^>]*>/gi, '')).join('\n') + ' ' + (html.match(/style="[^"]*"/g) || []).join(' ')).replace(/\/\*[\s\S]*?\*\//g, '');

  /* 克隆页的「值层」规则（字体 / 字重 / 色值 / 类名 / 尺寸覆写）一律豁免 ——
     它的每一个值都该跟线上一样，判它等于要求它别还原。2026-09-17 实测：1:1 还原 VO 那页
     被判 213 个野色 + 8 个非法字重 + 3 个自造类，全部来自线上本身。
     🔴 豁免是声明式的：豁免了哪几条写在这条 info 里，摆在体检面板上，不是悄悄跳过。
     内容层规则（价格写法 / 手画品牌标）照判 —— 那两条克隆页也该对。 */
  if (isClone) issues.push({ rule: 'clone', level: 'info',
    msg: '这是克隆线上的页面（有 <base href> 或自带线上的 Roboto @font-face）。字体、字重、色值、类名、组件尺寸、裸控件、手搓占比、字符覆盖这 8 条已豁免——它的值本来就该跟线上一样。价格写法和手画品牌标两条照判' });

  /* 页面用到的全部类名 + var(--x) 解包：克隆豁免块内外都要用，所以提到这儿 */
  const used = new Set(); for (const m of html.matchAll(/class="([^"]*)"/g)) m[1].split(/\s+/).forEach(c => c && used.add(c));

  const vars = {}; for (const m of css.matchAll(/(--[a-zA-Z0-9_-]+)\s*:\s*([^;}]+)/g)) vars[m[1]] = m[2].trim();
  const unvar = s2 => s2.replace(/var\((--[a-zA-Z0-9_-]+)(?:\s*,\s*[^)]*)?\)/g, (_, k) => vars[k] != null ? unvar(vars[k]) : _);

  /* 1 字体：只认 Roboto 首选 */
  if (!isClone) {
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
  const fake = [...used].filter(c => L.prefixes.some(p => c === p || c.startsWith(p + '-')) && !L.classes.has(c));
  if (fake.length) issues.push({ rule: 'fake-class', level: 'bad', msg: `用了飞鹊命名、飞鹊里却没有的类：${fake.slice(0, 6).join(' ')}${fake.length > 6 ? ' …' : ''}。要么用真类名，要么别借飞鹊的前缀`, detail: fake });

  /* 5 覆写了飞鹊的尺寸档（先把 var(--x) 解开再比，变量最终等于飞鹊值就不算错） */
  const sizeKeys = { 'btn-lg': ['height:40px', 'border-radius:8px', 'font-size:16px'], 'btn-md': ['height:32px', 'border-radius:6px'], 'btn-sm': ['height:24px', 'border-radius:4px'], 'btn-primary': ['background:#E64545'], 'btn-secondary': ['border-color:#222'] };
  for (const [k, need] of Object.entries(sizeKeys)) {
    const m = css.match(new RegExp('(?:^|[\\s,}])\\.' + k + '\\s*\\{([^}]*)\\}'));
    if (!m) continue;
    const body = unvar(m[1]).replace(/\s+/g, '').toUpperCase();
    const miss = need.filter(n => !body.includes(n.replace(/\s+/g, '').toUpperCase()));
    if (miss.length) issues.push({ rule: 'override', level: 'bad', msg: `.${k}的规格跟飞鹊不一致（飞鹊是 ${need.join('，')}），组件规则要原样从 docs/飞鹊Web组件库.css 复制` });
  }

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


  /* 11 字重焊死：只写 font-family:Roboto 不够。装了多个静态 Roboto 的机器上 font-weight:400
     会被 Chrome 匹配成 Roboto-Black(900)，中文却回落 PingFang-Regular(400)，中西文差 5 个字重档。
     应用会在预览与交付两个时点自动注入（main/feique-font.js），这条是兜底——它报红就说明注入没跑成。 */
  if (!isClone && /font-family[^;}"']*Roboto/i.test(html)) {
    const pinned = html.includes('UW-FEIQUE-FONT')
      || [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)]
           .filter(m => /font-family\s*:\s*["']?Roboto/i.test(m[1]))
           .some(m => /font-weight\s*:\s*(400|normal)\b/.test(m[1]));
    if (!pinned) issues.push({ rule: 'font-pin', level: 'bad',
      msg: '页面用了 Roboto，却没有把 400/700 焊死的 @font-face。只写 font-family 的话，装了多个静态 Roboto 的机器上 400 会被匹配成 Roboto-Black(900)、中文回落 PingFang-Regular(400)，中西文差 5 个字重档。应用本该自动注入这段，报到这条说明注入没生效，去看 main/feique-font.js' });
  }

  /* 12 裸控件：原生控件没穿飞鹊的衣服。砖表 28 类里这几样都有现成实现，手搓一套是最常见的「自己画组件」。
     判法按族计数而不是解析嵌套：原生控件数 > 对应飞鹊容器类数，差的那些就是裸的。
     <button> 例外，它的类写在自己身上，可以逐个精确判。 */
  if (!isClone) {
    const clsCount = re => (html.match(re) || []).length;
    const naked = [];
    const btns = [...html.matchAll(/<button\b[^>]*>/g)];
    const nakedBtn = btns.filter(m => !/class\s*=\s*"[^"]*\bbtn\b/.test(m[0])).length;
    if (nakedBtn) naked.push(`${nakedBtn}/${btns.length} 个 <button> 没有用 .btn（砖在 docs/css/btn.css）`);
    const fam = [
      { name: '输入框',   n: (html.match(/<input\b[^>]*type\s*=\s*"(?:text|search|email|tel|url|password|date|time)"/gi) || []).length
                             + (html.match(/<input\b(?![^>]*\btype\s*=)[^>]*>/gi) || []).length,
        c: clsCount(/class\s*=\s*"[^"]*\binp(?:-body|-lg|-sm)?\b/g), brick: '.inp（docs/css/inp.css）' },
      /* 🔴 `type=number` ≠ 「必须用 .inp-num」。飞鹊的 .inp-num 是**带加减号的步进器**，
         适合份数、件数这种小数量；而「自定义金额 ____ 元」这种带单位后缀的金额字段，
         正确的砖是 .inp ＋ .inp-tab-post（20,000 元也不该配一对上下箭头）。
         所以已经穿着 .inp 的 number 输入框不算裸奔 —— 2026-09-18 在 PPC 那页实测：
         门要求把预算字段换成步进器，换了反而是错的。
         **门判错方向时，改门，别照着门把对的改坏**（这类错最贵：它带着一套理由）。 */
      { name: '数字输入框', n: [...html.matchAll(/<input\b[^>]*type\s*=\s*"number"[^>]*>/gi)]
          .filter(m => { const i = html.indexOf(m[0]); return !/class\s*=\s*"[^"]*\binp(?:-body)?\b[^"]*"[^>]*>(?:(?!<\/div>)[\s\S]){0,200}$/.test(html.slice(Math.max(0, i - 300), i)); }).length,
        c: clsCount(/class\s*=\s*"[^"]*\binp-num\b/g), brick: '.inp-num（docs/css/inpn.css）；如果是带单位后缀的金额/数量，用 .inp ＋ .inp-tab-post 才对，别套步进器' },
      { name: '勾选框',   n: (html.match(/<input\b[^>]*type\s*=\s*"checkbox"/gi) || []).length,
        c: clsCount(/class\s*=\s*"[^"]*\b(?:cb|sw)\b/g), brick: '.cb / .sw（docs/css/cb.css、sw.css）' },
      { name: '单选',     n: (html.match(/<input\b[^>]*type\s*=\s*"radio"/gi) || []).length,
        c: clsCount(/class\s*=\s*"[^"]*\b(?:rd|ss)\b/g), brick: '.rd / .ss（docs/css/rd.css、ss.css）' },
      { name: '下拉',     n: (html.match(/<select\b/gi) || []).length,
        c: clsCount(/class\s*=\s*"[^"]*\bsel\b/g), brick: '.sel（docs/css/sel.css）' },
      { name: '文本域',   n: (html.match(/<textarea\b/gi) || []).length,
        c: clsCount(/class\s*=\s*"[^"]*\bta\b/g), brick: '.ta（docs/css/ta.css）' },
    ];
    for (const f of fam) if (f.n > f.c) naked.push(`${f.n - f.c} 个${f.name}没有用 ${f.brick}`);
    if (naked.length) issues.push({ rule: 'naked-ctrl', level: 'bad',
      msg: `原生控件手搓、没穿飞鹊的衣服：${naked.join('；')}。这些砖表里都有现成的，整段 cat 进 <style>、类名保持飞鹊的，别自己写一套`, detail: naked });
  }

  /* 12.4 demo 控制条做进了页面里 —— 硬伤。
     吉吉 2026-09-18 焊死：「我希望做需求的时候，demo 控制台不要做在页面里，而是放在独立控制台里」。
     两条理由，第二条更硬：
       ① 页面里挂一条工具栏，评审和给外部看的时候没有沉浸感；
       ② **那段东西会跟着交付给前端** —— 他还得自己判断哪些是产品、哪些是演示脚手架。
     正确做法：状态写成根节点上的 `state-*` 类（`<body class="state-empty">`），
     切换归流程控制台管（预览栏「流程」那个窗口），页面里一行演示代码都不留。
     🔴 判据要准，别把产品自己的筛选栏误判成演示栏：只认「类名像 demobar」
     或「明写了 Demo 控制台」这两种，都是作者自己声明过「这是演示用的」。 */
  if (!isClone) {
    /* 🔴 先剥 HTML 注释：一句「这里原来有一条 demo 控制台，已删除」是**说明**，不是控制台。
       不剥的话，越是老老实实写清楚为什么删的人，越会被这道门判成硬伤。 */
    /* 🔴 HTML 注释和 CSS 注释都要剥。
       实测：bar 早删了，只剩 <style> 里一句「页面里没有任何 demo 控制条」的注释，门照报硬伤 ——
       越是老老实实写清楚为什么删的人，越会被判。 */
    const noCmt = html.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const hit = noCmt.match(/<[^>]*class\s*=\s*["'][^"']*demo-?bar[^"']*["'][^>]*>/i)
             || noCmt.match(/Demo\s*控制台/i) || noCmt.match(/Demo\s*控制条/i);
    if (hit) issues.push({ rule: 'demobar-in-page', level: 'bad',
      msg: '页面里做了 demo 控制条。状态不要在页面里切——写成根节点上的 state-* 类（<body class="state-empty">，CSS 里 body.state-empty .list{display:none}），切换交给流程控制台那个独立窗口。这样交付给前端的 HTML 里一行演示代码都没有，而那些 state-* 类正好是他要用的真实状态类',
      detail: [String(hit[0]).slice(0, 80)] });
  }

  /* 12.5 空态留了空占位块：飞鹊 31 张业务缺省图都做好了，自己画一个灰方块是白费力气还不对版。
     吉吉 2026-09-18 报「UW 不认识和不会使用飞鹊的缺省图」，追下来模型其实用对了 .empty 那套类，
     是**包里没带图**（DESIGN.md 当时写着「留空占位块」）。图已经带上了，这条门防它再回去。
     🔴 只判「看得出是空态、但插图位是空的」，不判「你该不该有空态」—— 后者机器判不了。 */
  /* 缺省图的插图位不许有底色。飞鹊缺省图是透明的，底下垫一块灰就多出一个方块。
     🔴 这条不是审美：`empty.css` 里那句 background 是「包里还没带图、先放占位块」时代的，
     图带进来之后没人回去拆 —— 占位块一旦活过了它要占的那个位，就变成了错误本身。
     （吉吉 2026-09-18 截图指出。判据只看 .empty-img 这一条选择器上有没有 background 色值，
     背景图 url(...) 不算 —— 那是有人在用自己的插图。） */
  if (!isClone) {
    const bg = [];
    for (const m of css.matchAll(/\.empty-img\b[^{]*\{([^}]*)\}/g)) {
      const body = m[1];
      if (!/background(-color)?\s*:/.test(body)) continue;
      if (/background(-image)?\s*:\s*[^;]*url\(/.test(body)) continue;      // 自己放的插图，不管
      const v = (body.match(/background(-color)?\s*:\s*([^;]+)/) || [])[2] || '';
      if (/^\s*(none|transparent|0\s*0)\s*$/i.test(v)) continue;            // 明确写了透明，正是我们要的
      bg.push(v.trim());
    }
    if (bg.length) issues.push({ rule: 'empty-img-bg', level: 'bad',
      msg: `缺省图的插图位加了底色（${bg.slice(0, 2).join(' / ')}）。飞鹊缺省图是透明的，加底色会在图后面露出一个灰方块。把 .empty-img 的 background 去掉，尺寸用 packs/feique/docs/css/empty.css 里的 296×280`,
      detail: bg });
  }

  /* 自己做的滚动容器要用飞鹊滚动条。
     🔴 级别给 warn 不给 bad：`overflow:auto` 的容器在运行时到底会不会真的滚，静态看不出来
     （内容没超出就不出滚动条）。门宁可说轻一点也不能错报——错报一次人就不信它了。
     飞鹊组件自带的滚动区（.dw-body）已经在 scr.css 里处理过，不算在内。 */
  if (!isClone) {
    /* 🔴 判据是「这一页给滚动条上过样式没有」，不是「有没有挂 use-scr 这个类」。
       第一版我按类名放行，结果 .dw-body（飞鹊抽屉正文，自带 overflow-y:auto）被整个跳过，
       而这一页恰恰是把 dw.css 内联进来、却没把 scr.css 内联进来 —— 屏幕上就是系统滚动条，
       门却一声不吭。**放行条件写成「属于某个已知的好类名」，等于假设它一定带着那套样式。** */
    const scrollers = [];
    for (const m of css.matchAll(/([^{}]+)\{([^}]*overflow(-[xy])?\s*:\s*(auto|scroll)[^}]*)\}/g)) {
      const sel = m[1].trim().split('\n').pop().trim();
      if (/::-webkit-scrollbar|^html\b|^body\b|^\*$/.test(sel)) continue;
      scrollers.push(sel.slice(0, 40));
    }
    /* 🔴 判据要落到「这一个容器会不会真的拿到飞鹊滚动条」，不能只问「这一页上过滚动条样式没有」。
       实测第二版就栽在这儿：页面把 scr.css 整段内联了（`.use-scr::-webkit-scrollbar` 都在），
       但**没有任何元素挂 use-scr 这个类** —— 样式在、没人用，屏幕上还是系统滚动条，门却说没问题。
       「样式存在」离「样式生效」差着一个类名，判据不许在这一步偷懒。 */
    const scrClasses = new Set();
    for (const m of css.matchAll(/\.([A-Za-z0-9_-]+)\s*::-webkit-scrollbar/g)) scrClasses.add(m[1]);
    const classLists = [...html.matchAll(/class\s*=\s*["']([^"']*)["']/g)].map(m => m[1].split(/\s+/).filter(Boolean));
    const naked = scrollers.filter(sel => {
      const cls = (sel.match(/\.([A-Za-z0-9_-]+)\s*$/) || [])[1];
      if (!cls) return false;                                   // 复杂选择器判不了，放过（宁可漏报不错报）
      if (scrClasses.has(cls)) return false;                    // 它自己那条选择器就带着滚动条样式
      const usedOn = classLists.filter(l => l.includes(cls));
      if (!usedOn.length) return false;                         // 类定义了但页面上没用，不算问题
      return !usedOn.every(l => l.some(c => scrClasses.has(c)));
    });
    if (naked.length) issues.push({ rule: 'scrollbar', level: 'warn',
      msg: `${naked.length} 处会滚动的容器用的还是系统滚动条（${naked.slice(0, 2).join(' / ')}）。飞鹊滚动条在 packs/feique/docs/css/scr.css —— 整段 cat 进 <style> 之后，还要在**那个会滚的元素**上加 use-scr 类才生效（样式内联了没人挂类 = 白内联）。飞鹊组件自带的滚动区（.dw-body 等）scr.css 里已经直接写死了`,
      detail: naked });
  }

  if (!isClone && /class="[^"]*\bempty-img\b/.test(html)) {
    const blocks = [...html.matchAll(/<div[^>]*class="[^"]*\bempty-img\b[^"]*"[^>]*>([\s\S]{0,400}?)<\/div>/gi)];
    const bare = blocks.filter(m => {
      const inner = m[1];
      if (/data-feique-empty/i.test(inner)) return false;          // 写了名字，src 由主进程填
      if (/<img\b[^>]*\bsrc\s*=/i.test(inner)) return false;        // 自己放了真图
      if (/<svg\b/i.test(inner)) return false;                      // 用了图标（不理想但不是空的）
      if (/background(-image)?\s*:\s*url/i.test(m[0])) return false; // 内联背景图
      return true;
    });
    if (bare.length) issues.push({ rule: 'empty-img', level: 'bad',
      msg: `${bare.length} 处空态的插图位是空的（就是个灰方块）。飞鹊有 31 张现成的业务缺省图，写 <img data-feique-empty="图名" alt="">，src 会自动填上。挑哪张看 packs/feique/sprites/INDEX.md —— 🔴 供应商侧用 -supplier 那套蓝的，买家侧用 -buyer 那套红的`,
      detail: [`${bare.length} 处 .empty-img 里没有图`] });
  }

  /* 12.6 空态整个手搓：连 .empty 那套类都没用。
     判据要窄，宁可漏报不错报——「居中的一句话 + 一个按钮」在正常页面里太常见了。
     只在页面里出现「空/没有/暂无/no data」这类词、且完全没有 .empty 类时才提醒一句。 */
  if (!isClone && !/class="[^"]*\bempty(-|")/.test(html)) {
    const hint = html.match(/(暂无|没有找到|没找到|一条都没有|空空如也|还没有|no\s+(data|result|record))/i);
    if (hint) issues.push({ rule: 'empty-handmade', level: 'warn',
      msg: `页面里有「${hint[1]}」这样的空态文案，但没用飞鹊的 .empty 那套（docs/css/empty.css）。空态的壳和插图飞鹊都有现成的，别自己搭`, detail: [hint[1]] });
  }

  /* 13 手搓占比：不判错，只把事实摆出来。
     「该不该手写」机器判不了（新功能的业务块本来就得设计），但占比高到什么程度是人能看见的。
     2026-09-17 扫工作区 9 个项目：自造类占比 55%～99%，其中一张 41/45 个按钮手搓、体检却全绿。 */
  if (!isClone) {
    const all = new Set(); for (const m of html.matchAll(/class="([^"]*)"/g)) m[1].split(/\s+/).forEach(c => c && all.add(c));
    if (all.size) {
      const mineN = [...all].filter(c => !L.classes.has(c)).length;
      /* 自己写的 CSS 字节：选择器里一个飞鹊类都不沾的那些规则块加起来 */
      let ownBytes = 0;
      for (const m of css.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
        const cls = [...m[1].matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map(x => x[1]);
        if (cls.length && !cls.some(c => L.classes.has(c))) ownBytes += m[0].length;
      }
      issues.push({ rule: 'handmade', level: 'info',
        msg: `手搓占比：自造类 ${mineN}/${all.size}（${Math.round(mineN / all.size * 100)}%），自己写的 CSS 约 ${Math.round(ownBytes / 1024)}KB，用到飞鹊砖 ${all.size - mineN} 种。新功能的业务块本来就要设计，但通用控件、页头页脚、产品卡这类不该在这个数里` });
    }
  }

  /* 14 字符超出随包字体的覆盖：那个字符会单独掉到下一档字体，跟旁边的 Roboto 不是一套。
     覆盖区间是 build 时从 woff2 的 cmap 导出的真值（fonts/coverage.json），不是手列的。
     随包字体＝线上正在用的那两份，所以这个缺口线上也有，不是我们引入的。 */
  if (!isClone && L.cov) {
    const inCov = (cp, w) => (L.cov[w] || []).some(r => cp >= r[0] && cp <= r[1]);
    const plain = html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '')
                      .replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, ' ');
    const out = new Set();
    for (const ch of plain) {
      const cp = ch.codePointAt(0);
      /* 只报「换得掉」的：拉丁扩展 + 标点符号 + 箭头 + 几何形 + 带圈数字。
         俄语/希腊语/阿拉伯语这些是真实内容（多语言切换菜单），报出来也改不了＝纯噪音。
         2026-09-17 第一版就是这么把 Русский язык 报成 28 个「缺口」的。 */
      const symbolish = (cp >= 0x0100 && cp <= 0x024F) || (cp >= 0x2000 && cp <= 0x2BFF);
      if (!symbolish) continue;
      if (!inCov(cp, '400')) out.add(ch);
    }
    if (out.size) issues.push({ rule: 'glyph-range', level: 'warn',
      msg: `${out.size}个字符不在随包 Roboto 的覆盖内（${[...out].slice(0, 8).join(' ')}），它们会单独回落到系统字体、跟旁边的西文不是一套。换成覆盖内的写法（比如 → 写成 -> 或用飞鹊图标），或接受这点不一致（线上也一样）` });
  }

  const badN = issues.filter(i => i.level === 'bad').length;
  /* info 是「摆事实」不是「不合规」：不进 n、不进自动修复文案，但照样显示在面板上。
     混进去的话 pill 上的数字会虚高，模型还会拿着「手搓占比 55%」当一条要修的问题去改。 */
  const infoN = issues.filter(i => i.level === 'info').length;
  return { issues, ok: badN === 0, n: issues.length - infoN, badN, infoN, fqUsed: fqUsed.length };
}
module.exports = { check };
