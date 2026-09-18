const path = require('path');
const assert = require('assert');
const H = require(path.join(__dirname, '..', '..', 'main', 'htmlmap.js'));

const src = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Demo <b> not a tag</title>
<style>.x{color:red} .y::before{content:"<div>"}</style>
<script>var s = "<div class='fake'>" + '</p>'; if (a < b) {}</script>
</head>
<body class="page">
  <!-- comment <div> -->
  <header id="hd" style='color: #222; font-size:14px'>
    <h1 class="title big">Hello &amp; welcome</h1>
    <img src="a.png" alt="x>y">
    <br/>
  </header>
  <ul class="list">
    <li>one
    <li>two</li>
  </ul>
  <section class="cards">
    <div class="card" data-k="1">A</div>
    <div class="card" data-k="2"><span>B</span></div>
    <div class="card" data-k="3">C</div>
  </section>
  <svg viewBox="0 0 10 10"><path d="M0 0h10"/><circle r="2"/></svg>
  <p>para <em>x</em> tail</p>
</body>
</html>`;

let pass = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log('✅', name); } catch (e) { console.log('❌', name, '\n   ', e.message); process.exitCode = 1; } };

const toks = H.tokenize(src);
const starts = toks.filter(t => t.type === 'start');
const names = starts.map(t => t.name);
ok('分词：script/style 正文里的假标签不算', () => {
  assert.deepStrictEqual(names, ['html', 'head', 'meta', 'title', 'style', 'script', 'body', 'header', 'h1', 'img', 'br', 'ul', 'li', 'li', 'section', 'div', 'div', 'span', 'div', 'svg', 'path', 'circle', 'p', 'em']);
});
ok('分词：属性值里的 > 不结束标签', () => { const img = starts.find(t => t.name === 'img'); assert.strictEqual(src.slice(img.start, img.end), '<img src="a.png" alt="x>y">'); });

const marked = H.mark(src);
ok('打编号：每个开标签一个 data-uw-i，编号连续', () => {
  const ids = [...marked.matchAll(/data-uw-i="(\d+)"/g)].map(m => +m[1]);
  assert.deepStrictEqual(ids, ids.map((_, k) => k));
  assert.strictEqual(ids.length, names.length);
  assert.ok(marked.includes('<br data-uw-i="10" />'), marked.match(/<br[^>]*>/)[0]);
  assert.ok(marked.includes('<path d="M0 0h10" data-uw-i="20" />'));
  assert.ok(marked.includes('<img src="a.png" alt="x>y" data-uw-i="9">'));
  assert.ok(!marked.includes('fake\' data-uw-i'), 'script 里不能被打编号');
});
ok('打编号：去掉编号后跟原文一字不差', () => {
  assert.strictEqual(marked.replace(/ data-uw-i="\d+"( (?=\/>))?/g, ''), src);
});

const idx = n => starts.findIndex(t => t.name === n);
ok('范围：普通元素闭合正确、子标签计数对', () => {
  const r = H.range(src, idx('header'));
  assert.strictEqual(src.slice(r.openStart, r.closeEnd).slice(-9), '</header>');
  assert.strictEqual(r.count, 4); assert.strictEqual(r.implicit, false);
});
ok('范围：没闭合的 <li> 标成 implicit', () => {
  const r = H.range(src, idx('li'));
  assert.strictEqual(r.implicit, true);
  assert.strictEqual(src.slice(r.innerStart, r.innerEnd).trim(), 'one');
});
ok('范围：自闭合 svg 子元素是叶子', () => { assert.strictEqual(H.range(src, idx('path')).leaf, true); });

ok('样式：合并进已有的单引号 style，改一个加一个删一个', () => {
  const { html, changes } = H.apply(src, [{ op: 'style', i: idx('header'), tag: 'header', set: { 'font-size': '16px', padding: '8px 12px', color: null } }]);
  assert.ok(html.includes('<header id="hd" style="font-size:16px;padding:8px 12px">'), html.match(/<header[^>]*>/)[0]);
  assert.strictEqual(changes.length, 1);
});
ok('样式：没有 style 属性时新增；自闭合标签保住 />', () => {
  const { html } = H.apply(src, [{ op: 'style', i: idx('path'), set: { fill: '#E64545' } }]);
  assert.ok(html.includes('<path d="M0 0h10" style="fill:#E64545" />'), html.match(/<path[^>]*>/)[0]);
});
ok('样式：全删光就把 style 属性整个去掉', () => {
  const { html } = H.apply(src, [{ op: 'style', i: idx('header'), set: { color: null, 'font-size': null } }]);
  assert.ok(html.includes('<header id="hd">'), html.match(/<header[^>]*>/)[0]);
});
ok('文字：核对旧文字（解实体）后替换，并转义新文字', () => {
  const { html } = H.apply(src, [{ op: 'text', i: idx('h1'), old: 'Hello & welcome', text: 'Hi <there> & bye' }]);
  assert.ok(html.includes('<h1 class="title big">Hi &lt;there&gt; &amp; bye</h1>'));
});
ok('文字：旧文字对不上要拒绝', () => {
  assert.throws(() => H.apply(src, [{ op: 'text', i: idx('h1'), old: 'Nope', text: 'x' }]), /不一样/);
});
ok('文字：里面有子标签的元素拒绝整段改字', () => {
  assert.throws(() => H.apply(src, [{ op: 'text', i: idx('p'), text: 'x' }]), /最里层/);
});
ok('标签名对不上要拒绝', () => {
  assert.throws(() => H.apply(src, [{ op: 'style', i: idx('h1'), tag: 'div', set: { color: 'red' } }]), /对不上/);
});

const cards = starts.map((t, k) => t.name === 'div' ? k : -1).filter(k => k >= 0);
ok('删除：整行连缩进一起删，别的行不动', () => {
  const { html, select } = H.apply(src, [{ op: 'remove', i: cards[0] }]);
  assert.ok(!html.includes('data-k="1"'));
  assert.ok(html.includes('<section class="cards">\n    <div class="card" data-k="2">'), JSON.stringify(html.slice(html.indexOf('<section'), html.indexOf('<section') + 80)));
  assert.strictEqual(select, null);
});
ok('复制：副本紧跟其后、同缩进；select 指到副本', () => {
  const { html, select } = H.apply(src, [{ op: 'duplicate', i: cards[1] }]);
  const seg = html.slice(html.indexOf('<section'), html.indexOf('</section>'));
  assert.strictEqual((seg.match(/data-k="2"/g) || []).length, 2);
  assert.ok(seg.includes('<div class="card" data-k="2"><span>B</span></div>\n    <div class="card" data-k="2"><span>B</span></div>\n    <div class="card" data-k="3">'), seg);
  /* 副本编号 = 原编号 + 原元素内开标签数(2) */
  assert.strictEqual(select, cards[1] + 2);
  const r = H.range(html, select); assert.strictEqual(html.slice(r.openStart, r.openStart + 30), '<div class="card" data-k="2"><');
});
ok('挪位置：第 3 张卡挪到第 1 张前面，select 跟着它', () => {
  const { html, select } = H.apply(src, [{ op: 'move', i: cards[2], to: cards[0], where: 'before' }]);
  const seg = html.slice(html.indexOf('<section'), html.indexOf('</section>'));
  assert.ok(seg.includes('<section class="cards">\n    <div class="card" data-k="3">C</div>\n    <div class="card" data-k="1">A</div>\n    <div class="card" data-k="2"><span>B</span></div>\n  '), JSON.stringify(seg));
  const r = H.range(html, select); assert.ok(html.slice(r.openStart, r.closeEnd).includes('data-k="3"'));
});
ok('挪位置：第 1 张卡挪到第 3 张后面', () => {
  const { html, select } = H.apply(src, [{ op: 'move', i: cards[0], to: cards[2], where: 'after' }]);
  const seg = html.slice(html.indexOf('<section'), html.indexOf('</section>'));
  assert.ok(seg.includes('<section class="cards">\n    <div class="card" data-k="2"><span>B</span></div>\n    <div class="card" data-k="3">C</div>\n    <div class="card" data-k="1">A</div>\n  '), JSON.stringify(seg));
  const r = H.range(html, select); assert.ok(html.slice(r.openStart, r.closeEnd).includes('data-k="1"'));
});
ok('挪位置：行内兄弟（不独占一行）也能挪', () => {
  const s2 = '<p><b>1</b><i>2</i><u>3</u></p>';
  const { html } = H.apply(s2, [{ op: 'move', i: 3, to: 1, where: 'before' }]);
  assert.strictEqual(html, '<p><u>3</u><b>1</b><i>2</i></p>');
});
ok('挪位置：不能挪进自己里面', () => {
  assert.throws(() => H.apply(src, [{ op: 'move', i: idx('section'), to: cards[0], where: 'before' }]), /自己/);
});
ok('结构性操作拒绝 implicit 元素', () => {
  assert.throws(() => H.apply(src, [{ op: 'remove', i: idx('li') }]), /闭合/);
});
ok('多步：先改样式再复制，第二步按新源码重新分词', () => {
  const { html } = H.apply(src, [{ op: 'style', i: cards[0], set: { color: '#555' } }, { op: 'duplicate', i: cards[0] }]);
  assert.strictEqual((html.match(/data-k="1" style="color:#555"/g) || []).length, 2);
});
ok('属性：改 alt、删 alt', () => {
  let { html } = H.apply(src, [{ op: 'attr', i: idx('img'), name: 'alt', value: 'new "q"' }]);
  assert.ok(html.includes('<img src="a.png" alt="new &quot;q&quot;">'));
  ({ html } = H.apply(src, [{ op: 'attr', i: idx('img'), name: 'alt', value: null }]));
  assert.ok(html.includes('<img src="a.png">'));
});
ok('压力：打编号后再分词，编号与属性对得上（1000 个元素）', () => {
  let big = '<div>' + Array.from({ length: 1000 }, (_, k) => `<p class="c${k}">t${k}<br></p>`).join('\n') + '</div>';
  const m = H.mark(big);
  const ts = H.tokenize(m).filter(t => t.type === 'start');
  for (const t of ts) { const seg = m.slice(t.start, t.end); assert.ok(seg.includes(`data-uw-i="${t.i}"`), seg); }
});
console.log(`\n${pass} 项通过`);

/* ── 第二批：替换 / 插入 / 类名 / 注样式（拖飞鹊组件进来） ── */
{
  const cards2 = starts.map((t, k) => t.name === 'div' ? k : -1).filter(k => k >= 0);
  ok('替换：整块换成多行片段，按原缩进重排，select 指到新块', () => {
    const { html, select } = H.apply(src, [{ op: 'replace', i: cards2[1], html: '<a class="btn btn-md btn-primary" href="#">\n  Send\n</a>', what: '按钮' }]);
    assert.ok(html.includes('<section class="cards">\n    <div class="card" data-k="1">A</div>\n    <a class="btn btn-md btn-primary" href="#">\n      Send\n    </a>\n    <div class="card" data-k="3">C</div>'), JSON.stringify(html.slice(html.indexOf('<section'), html.indexOf('</section>'))));
    const r = H.range(html, select); assert.strictEqual(r.name, 'a');
  });
  ok('插入：在第 1 张卡前面插一块，独占一行同缩进', () => {
    const { html, select } = H.apply(src, [{ op: 'insert', i: cards2[0], where: 'before', html: '<span class="tag tag-line-blue">Tag</span>' }]);
    assert.ok(html.includes('<section class="cards">\n    <span class="tag tag-line-blue">Tag</span>\n    <div class="card" data-k="1">A</div>'), JSON.stringify(html.slice(html.indexOf('<section'), html.indexOf('<section') + 120)));
    assert.strictEqual(H.range(html, select).name, 'span');
  });
  ok('插入：在最后一张卡后面插', () => {
    const { html, select } = H.apply(src, [{ op: 'insert', i: cards2[2], where: 'after', html: '<p>x</p>' }]);
    assert.ok(html.includes('<div class="card" data-k="3">C</div>\n    <p>x</p>\n  </section>'), JSON.stringify(html.slice(html.indexOf('data-k="3"') - 20, html.indexOf('</section>') + 10)));
    assert.strictEqual(H.range(html, select).name, 'p');
  });
  ok('类名：去掉一组加上一组，顺序保留', () => {
    const { html } = H.apply('<a class="btn btn-md btn-primary" href="#">x</a>', [{ op: 'class', i: 0, remove: ['btn-primary', 'btn-md'], add: ['btn-secondary-blue', 'btn-lg', ''] }]);
    assert.strictEqual(html, '<a class="btn btn-secondary-blue btn-lg" href="#">x</a>');
  });
  ok('类名：全删光就去掉 class 属性', () => {
    const { html } = H.apply('<a class="x" href="#">x</a>', [{ op: 'class', i: 0, remove: ['x'], add: [] }]);
    assert.strictEqual(html, '<a href="#">x</a>');
  });
  ok('注样式：注进 </head> 前，同 id 第二次不重复', () => {
    let h = H.ensureStyle(src, 'ctl-btn', '.btn{color:red}');
    assert.ok(h.includes('<style data-feique="ctl-btn">\n.btn{color:red}\n</style>\n</head>'));
    assert.strictEqual(H.ensureStyle(h, 'ctl-btn', '.btn{color:blue}'), h);
    assert.strictEqual(H.startCount(h), H.startCount(src) + 1);
  });
  ok('注样式：没有 head 就放 <body> 前；啥都没有放开头', () => {
    assert.strictEqual(H.ensureStyle('<body><p>a</p></body>', 'x', 'p{}'), '<style data-feique="x">\np{}\n</style>\n<body><p>a</p></body>');
    assert.strictEqual(H.ensureStyle('<p>a</p>', 'x', 'p{}'), '<style data-feique="x">\np{}\n</style>\n<p>a</p>');
  });
  ok('注脚本：注在 </body> 前、同 id 不重复、不动前面元素的编号', () => {
    const h = H.ensureScript(src, 'behaviors', 'window.x=1;');
    assert.ok(h.includes('<script data-feique="behaviors">\nwindow.x=1;\n</script>\n</body>'));
    assert.strictEqual(H.ensureScript(h, 'behaviors', 'window.x=2;'), h);
    const i = H.tokenize(src).filter(t => t.type === 'start').findIndex(t => t.name === 'h1');
    assert.strictEqual(H.range(h, i).name, 'h1');
  });
  ok('注样式后再替换：编号按注入后的源码算（主进程里就是这个顺序）', () => {
    const marked = H.mark(src); const i = +/<div class="card" data-k="2" data-uw-i="(\d+)"/.exec(marked)[1];
    const h = H.ensureStyle(src, 'ctl-btn', '.btn{}');
    const i2 = i + 1;   // 多了一个 <style> 开标签
    const { html } = H.apply(h, [{ op: 'replace', i: i2, tag: 'div', html: '<a class="btn">B</a>' }]);
    assert.ok(html.includes('<a class="btn">B</a>') && !html.includes('data-k="2"'));
  });
  ok('🔴 编号绝不许被写进源码：不管哪条路送来的 html，data-uw-i 一律洗掉', () => {
    /* 2026-09-17 真事：图标改色那条路把预览 DOM 的 outerHTML 原样写回文件，把探针编号烤进了源码。
       后果是下次编号重号，一改就报「元素对不上（预览里是 <svg>，源码里是 <span>）」，而且只能手工清。 */
    const marked = H.mark(src); const i = +/<div class="card" data-k="2" data-uw-i="(\d+)"/.exec(marked)[1];
    const dirty = '<svg data-uw-i="231" class="ic"><path d="M0 0" data-uw-i="232" fill="currentColor"/></svg>';
    const { html } = H.apply(src, [{ op: 'replace', i, tag: 'div', html: dirty }]);
    assert.ok(!/data-uw-i/.test(html), '编号被写进源码了：' + (/.{0,60}data-uw-i.{0,20}/.exec(html) || [''])[0]);
    assert.ok(html.includes('class="ic"') && html.includes('fill="currentColor"'), '把该留的也洗掉了');
    const ins = H.apply(src, [{ op: 'insert', i, tag: 'div', where: 'after', html: dirty }]).html;
    assert.ok(!/data-uw-i/.test(ins), '插入那条路没洗');
  });
  /* 组件清册：每块砖填完占位都是单根、无残留占位 */
  const C = require(path.join(__dirname, '..', '..', 'main', 'components.js'));
  const list = C.summary(path.join(__dirname, '..', '..', 'packs', 'feique'));
  ok('作用域：每条选择器都带三重 [data-fq]，伪元素在 :is() 外面，@keyframes 原样', () => {
    const css = C.byId(path.join(__dirname, '..', '..', 'packs', 'feique'), 'sw').css;
    assert.ok(css.includes('@keyframes sw-spin{to{transform:rotate(360deg)}}'));
    for (const sel of css.replace(/@keyframes[^{]*\{[^}]*\{[^}]*\}\s*\}/g, '').split('}').map(x => x.split('{')[0].trim()).filter(Boolean)) assert.ok(/^\[data-fq\]\[data-fq\]\[data-fq\]/.test(sel), sel);
    const bdg = C.byId(path.join(__dirname, '..', '..', 'packs', 'feique'), 'bdg-status').css;
    assert.ok(bdg.includes(':is(.bdg-status-success)::before'), bdg.slice(0, 300));
    assert.ok(!/:is\([^)]*::/.test(bdg), '伪元素混进 :is() 了');
    const reset = C.byId(path.join(__dirname, '..', '..', 'packs', 'feique'), 'btn-primary').reset;
    assert.ok(reset.includes('[data-fq][data-fq][data-fq], [data-fq][data-fq][data-fq] *'), reset.slice(0, 200));
    assert.ok(!/^\s*\*\s*[,{]/m.test(reset), 'reset 里还有裸 * 会打到整页');
  });
  ok('清册：12 片段 + 33 控件，每块单根、无 {{ 占位、有 CSS', () => {
    assert.strictEqual(list.filter(x => x.group === 'block').length, 12); assert.strictEqual(list.filter(x => x.group === 'control').length, 33);
    for (const c of list) { assert.ok(/^<[a-zA-Z]/.test(c.thumb), c.id); assert.ok(!/\{\{/.test(c.thumb), c.id); assert.ok(c.css.length > 100, c.id); assert.ok(!/cat\s+\S+\.svg 整段贴到这里/.test(c.thumb), c.id + ' 有没换的 SLOT'); }
  });
  ok('填样板：保留原文字与链接，文字转义；不在 keep 里的占位用默认值', () => {
    const btn = C.byId(path.join(__dirname, '..', '..', 'packs', 'feique'), 'btn-primary');
    assert.strictEqual(C.fill(btn, { text: 'Buy <now>', href: 'https://x.com/a?b=1&c=2' }), '<a data-fq class="btn btn-md btn-primary" href="https://x.com/a?b=1&amp;c=2">Buy &lt;now&gt;</a>');
    assert.strictEqual(C.fill(btn, {}), '<a data-fq class="btn btn-md btn-primary" href="#">Send Inquiry</a>');
    const inp = C.byId(path.join(__dirname, '..', '..', 'packs', 'feique'), 'inp');
    assert.ok(C.fill(inp, { text: '不该带过去' }).includes('placeholder="Please enter"'), 'inp 的 keep 为空，文字不带');
  });
  ok('填样板：产品卡片段第一张图与链接换成原元素的', () => {
    const pc = C.byId(path.join(__dirname, '..', '..', 'packs', 'feique'), 'block-product-card-grid');
    const h = C.fill(pc, { src: 'https://img/x.jpg', href: 'https://mic/p/1' });
    assert.ok(h.includes('<img src="https://img/x.jpg"')); assert.ok(h.includes('href="https://mic/p/1"')); assert.ok(!h.includes('href="#"'));
    assert.ok(!h.includes('data-node-id'), 'Figma 节点号要去掉'); assert.ok(h.includes('<svg'), 'SLOT 已换成真 SVG');
  });
}
/* ── 带 <base> 的克隆页：项目自己的图要在预览里指回项目，别被 base 带到线上去 ──
   吉吉 2026-09-17 换 VO 头像时撞的第二个原因：页面第 3 行是 <base href="https://membercenter.made-in-china.com/">，
   换进去的 images/x.png 被解析成线上地址 → 404 → 「传了图还是没反应」。 */
{
  const A = H.absolutizeForPreview;
  const has = r => r === 'images/a.png' || r === 'css/x.css';
  const res = r => has(r) ? 'uwproj://p/proj/' + r : null;
  const BASE = '<html><head><base href="https://x.com/"><link rel="stylesheet" href="css/x.css"></head><body>'
    + '<img src="images/a.png"><img src="https://y.com/b.png"><img src="images/nope.png"><img src="data:image/png;base64,AA">'
    + '<img src="//cdn.x.com/c.png"><div style="background:url(images/a.png)"></div><a href="images/a.png">链接</a></body></html>';
  const out = A(BASE, res);
  ok('带 base 的页面：项目里真有的那几个换成绝对地址', () => {
    assert.ok(out.includes('<img src="uwproj://p/proj/images/a.png">'), out.slice(0, 200));
    assert.ok(out.includes('href="uwproj://p/proj/css/x.css"'), '<link> 的样式表也要跟着走');
    assert.ok(/url\('uwproj:\/\/p\/proj\/images\/a\.png'\)/.test(out), 'CSS 里的 url() 也要换 · ' + out.slice(-260));
  });
  ok('不该动的一个都别动：线上地址 / data: / 协议相对 // / 项目里没有的 / <a href>', () => {
    assert.ok(out.includes('src="https://y.com/b.png"'), '别人的线上地址不许改');
    assert.ok(out.includes('src="images/nope.png"'), '项目里没有这个文件就别改（改了就是替页面做主）');
    assert.ok(out.includes('src="data:image/png;base64,AA"'), 'data: 不许改');
    assert.ok(out.includes('src="//cdn.x.com/c.png"'), '协议相对地址不许改');
    assert.ok(out.includes('<a href="images/a.png">'), '<a href> 是页面跳转，改了会把「点链接跳到另一页」打断');
  });
  ok('🔴 没有 base 的页面：一个字都不动（这条挡住的是「误伤所有页面」）', () => {
    const plain = '<html><body><img src="images/a.png"><div style="background:url(images/a.png)"></div></body></html>';
    assert.strictEqual(A(plain, res), plain);
  });
  ok('base 指向的不是外站（相对 base）：也不动', () => {
    const rel = '<html><head><base href="/sub/"></head><body><img src="images/a.png"></body></html>';
    assert.strictEqual(A(rel, res), rel);
  });
  ok('改写不破坏编号：data-uw-i 原样还在（探针靠它把点中的元素对回源码那一段）', () => {
    const m = H.mark('<html><head><base href="https://x.com/"></head><body><img src="images/a.png"></body></html>');
    const o2 = A(m, res);
    assert.strictEqual((m.match(/data-uw-i="/g) || []).length, (o2.match(/data-uw-i="/g) || []).length);
    assert.ok(o2.includes('uwproj://p/proj/images/a.png'));
  });
}
console.log(`\n${pass} 项通过（含第二批）`);
