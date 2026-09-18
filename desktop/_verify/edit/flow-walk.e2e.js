/* 独立走查包 `_走查.html` 的门：真 Chrome、真 file:// 打开，跟对方双击的情形一样。
   🔴 非要走 file:// 不可：这一份就是发给没装 UW 的人的，
   而 file:// 下 Chrome 禁止跨文档访问——「iframe 外面换状态类」这条路在那里成不成立，只有这么测才知道。
   （所以页面是整份内联进 srcdoc 的，不是 src= 指过去；这一条是整个做法的前提，红了就说明做法得换。） */
const path = require('path'), fs = require('fs'), os = require('os'), assert = require('assert');
const puppeteer = require(path.join(__dirname, '..', '..', 'restore-tools', 'online-reach', 'node_modules', 'puppeteer-core'));
const DESK = path.join(__dirname, '..', '..');
const flow = require(DESK + '/main/flow.js');
const walk = require(DESK + '/main/flow-walk.js');

/* 自带料，不依赖用户工作区里有什么 */
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'uwwalk-'));
fs.mkdirSync(path.join(base, 'sub'), { recursive: true });
fs.writeFileSync(path.join(base, 'index.html'), `<!DOCTYPE html><html><head><title>列表页</title><style>
/* @态 empty 一条都没有 · 没命中 */
body.state-empty .list{display:none} body.state-empty .none{display:block} .none{display:none}
body.state-guest .price{visibility:hidden}
</style></head><body class="state-default">
<div class="list">有货 <span class="price">US$12</span></div><div class="none">没找到</div>
<a href="sub/detail.html">看详情</a></body></html>`);
fs.writeFileSync(path.join(base, 'sub', 'detail.html'), `<!DOCTYPE html><html><head><title>详情页</title><style>
body.state-error .buy{display:none}</style></head><body class="state-default">
<img src="pic.svg" width="20" height="20" alt=""><div class="buy">发询盘</div><a href="../index.html">回</a></body></html>`);
fs.writeFileSync(path.join(base, 'sub', 'pic.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#E64545"/></svg>');
fs.writeFileSync(path.join(base, '剧本.md'), '## 正常\n1. index.html · default · 有货的样子\n2. sub/detail.html · default · 点进详情\n\n## 出错\n1. index.html · empty · 没命中\n2. sub/detail.html · error · 下架了\n');
const d = flow.scan(base);
const info = walk.writeInto(base, d, '走查门');
const URL = 'file://' + path.join(base, walk.WALK_FILE);

(async () => {
  const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, defaultViewport: { width: 1200, height: 820 } });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(URL, { waitUntil: 'networkidle2' });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  await wait(700);

  let pass = 0;
  const ok = (n, f) => { try { f(); pass++; console.log('✅', n); } catch (e) { console.log('❌', n, '\n   ', e.message); process.exitCode = 1; } };
  const st = () => page.evaluate(() => {
    const f = document.getElementById('fr'), d = f.contentDocument;
    return { note: document.getElementById('note').textContent, at: document.getElementById('at').textContent,
      page: document.getElementById('pageSel').value, state: document.getElementById('stateSel').value,
      cls: d ? d.body.className : '?', title: d ? d.title : '?' };
  });

  ok('生成的是一个文件，双击就能开（不用起服务器、不用装东西）', () => {
    assert.ok(fs.existsSync(path.join(base, walk.WALK_FILE)));
    assert.strictEqual(info.pages, 2);
  });

  const s0 = await st();
  ok('开场默认走第一条主线的第一步', () => {
    assert.strictEqual(s0.at, '1 / 2');
    assert.strictEqual(s0.page, 'index.html');
    assert.strictEqual(s0.title, '列表页');
    assert.ok(/有货的样子/.test(s0.note), s0.note);
  });

  await page.click('#next'); await wait(500);
  const s1 = await st();
  ok('下一步：换到另一页，而且是子目录里那一页', () => {
    assert.strictEqual(s1.page, 'sub/detail.html');
    assert.strictEqual(s1.title, '详情页');
  });
  const img = await page.evaluate(() => { const d = document.getElementById('fr').contentDocument; const i = d.querySelector('img'); return { w: i.naturalWidth, src: i.currentSrc || i.src }; });
  ok('🔴 子目录页面里的相对路径图还能显示（内联之后基准会变，靠补 <base> 救回来）', () => {
    assert.strictEqual(img.w, 20, '图没加载出来：' + JSON.stringify(img));
    assert.ok(/sub\/pic\.svg$/.test(img.src), img.src);
  });

  /* 🔴 这条是整个做法成不成立的那一条 */
  await page.select('#scSel', '1'); await wait(700);
  const s2 = await st();
  ok('🔴 file:// 下换得动状态类（换不动的话这一份就白做了，做法得换）', () => {
    assert.strictEqual(s2.state, 'empty');
    assert.ok(/state-empty/.test(s2.cls), '根节点类没换成：' + s2.cls);
  });
  const vis = await page.evaluate(() => { const d = document.getElementById('fr').contentDocument; return { list: getComputedStyle(d.querySelector('.list')).display, none: getComputedStyle(d.querySelector('.none')).display }; });
  ok('🔴 换的是类，样式真的跟着生效了（不是只把 class 写上去好看）', () => {
    assert.strictEqual(vis.list, 'none');
    assert.strictEqual(vis.none, 'block');
  });

  await page.click('#next'); await wait(600);
  const s3 = await page.evaluate(() => { const d = document.getElementById('fr').contentDocument; return { cls: d.body.className, buy: getComputedStyle(d.querySelector('.buy')).display }; });
  ok('跨页带状态：走到下一步时新页面装好了才换类，不是换了个寂寞', () => {
    assert.ok(/state-error/.test(s3.cls), s3.cls);
    assert.strictEqual(s3.buy, 'none');
  });

  await page.select('#pageSel', 'index.html'); await wait(600);
  await page.select('#stateSel', 'guest'); await wait(300);
  const s4 = await page.evaluate(() => { const d = document.getElementById('fr').contentDocument; return { cls: d.body.className, vis: getComputedStyle(d.querySelector('.price')).visibility }; });
  ok('也能不走主线，自己选页面和状态（对方想乱点就让他乱点）', () => {
    assert.ok(/state-guest/.test(s4.cls), s4.cls);
    assert.strictEqual(s4.vis, 'hidden');
  });

  await page.click('#hideBar'); await wait(400);
  const hid = await page.evaluate(() => ({ bar: document.getElementById('bar').classList.contains('hide'), hint: document.getElementById('hint').classList.contains('on') }));
  ok('「只看页面」：控制条整条收掉，只留一句提示告诉人怎么叫回来', () => { assert.strictEqual(hid.bar, true); assert.strictEqual(hid.hint, true); });
  await page.keyboard.press('Escape'); await wait(300);
  ok('Esc 把控制条叫回来（收起来找不回来是最糟的）', async () => {});
  const back = await page.evaluate(() => document.getElementById('bar').classList.contains('hide'));
  ok('Esc 叫得回来', () => assert.strictEqual(back, false));

  /* 页面正文里带 </script> 时不能把宿主页面撕开 */
  const b2 = fs.mkdtempSync(path.join(os.tmpdir(), 'uwwalk2-'));
  fs.writeFileSync(path.join(b2, 'index.html'), '<!DOCTYPE html><html><head><title>带脚本的页</title></head><body class="state-default"><script>var a="</scr"+"ipt>";<\/script><p>正文还在</p><a href="b.html">b</a></body></html>');
  fs.writeFileSync(path.join(b2, 'b.html'), '<!DOCTYPE html><html><head><title>B</title></head><body class="state-default"><a href="index.html">回</a></body></html>');
  walk.writeInto(b2, flow.scan(b2), 'x');
  const p2 = await browser.newPage();
  const e2 = []; p2.on('pageerror', e => e2.push(e.message));
  await p2.goto('file://' + path.join(b2, walk.WALK_FILE), { waitUntil: 'networkidle2' });
  await wait(600);
  const t2 = await p2.evaluate(() => { const d = document.getElementById('fr').contentDocument; return { title: d ? d.title : '?', p: d ? !!d.querySelector('p') : false }; });
  ok('页面正文里有 </script> 也不会把走查页撕开', () => { assert.strictEqual(t2.title, '带脚本的页'); assert.strictEqual(t2.p, true); assert.deepStrictEqual(e2, []); });
  await p2.close();

  ok('全程没有页面报错', () => assert.deepStrictEqual(errors, []));
  console.log(`\n${pass} 项通过 · 走查包 ${Math.round(info.bytes / 1024)}KB`);
  await browser.close();
})().catch(e => { console.error('💥', e); process.exit(1); });
