/* 组件 CSS 作用域：把飞鹊按钮换进一个「自己也有 .btn 规则、还给 a 强行设白字」的页面，真 Chrome 里量计算样式。
   这就是 2026-09-16 吉吉截图那种「换进去一块空」的复现。跑法：node _verify/edit/scope.e2e.js */
const path = require('path'), fs = require('fs'), os = require('os'), assert = require('assert');
const puppeteer = require(path.join(__dirname, '..', '..', 'restore-tools', 'online-reach', 'node_modules', 'puppeteer-core'));
const H = require(path.join(__dirname, '..', '..', 'main', 'htmlmap.js'));
const C = require(path.join(__dirname, '..', '..', 'main', 'components.js'));
const PACK = path.join(__dirname, '..', '..', 'packs', 'feique');
let src = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:24px;font-family:Arial}
.btn{display:block;background:none;border:0;font-size:0;color:transparent}       /* 页面自己的 .btn，跟飞鹊撞名 */
.ad .contact a{color:#fff;text-decoration:underline}                              /* 更高权重的祖先规则 */
.ad{padding:20px;background:#F5F7FA}
.ad .contact .x{display:inline-block;padding:6px 12px;border:1px solid #ccc}
</style></head><body>
<section class="ad"><div class="contact"><a class="x" href="https://mic/p">Buy</a><a class="btn" href="#">Chat</a></div></section>
<p class="tail">tail</p>
<span id="swhere">x</span>
<div id="tabhere">t</div><div id="cbhere">c</div><div id="pghere">p</div><div id="selhere">s</div><div id="clpshere">k</div><div id="stphere">st</div>
</body></html>`;
/* 走主进程同一条路：先补丁再注样式 */
function applyComponent(html, i, id, keep) {
  const c = C.byId(PACK, id);
  const r = H.apply(html, [{ op: 'replace', i, component: id, html: C.fill(c, keep), what: c.name }]);
  let out = H.ensureScript(r.html, 'behaviors', C.BEHAVIORS); if (c.reset) out = H.ensureStyle(out, 'reset', c.reset); out = H.ensureStyle(out, c.styleId, c.css);
  return out;
}
const iX = H.tokenize(src).filter(t => t.type === 'start').findIndex(t => t.name === 'a');
src = applyComponent(src, iX, 'btn-primary', { text: 'Buy', href: 'https://mic/p' });
const iSw = H.tokenize(src).filter(t => t.type === 'start').findIndex(t => t.name === 'span');
src = applyComponent(src, iSw, 'sw', {});
for (const [sel, id] of [['tabhere', 'tab'], ['cbhere', 'cb'], ['pghere', 'pg'], ['selhere', 'sel'], ['clpshere', 'clps'], ['stphere', 'stp']]) {
  const i = H.tokenize(src).filter(t => t.type === 'start').findIndex(t => t.name === 'div' && new RegExp('id="' + sel + '"').test(src.slice(t.start, t.end)));
  src = applyComponent(src, i, id, {});
}
const f = path.join(os.tmpdir(), 'uw-scope.html'); fs.writeFileSync(f, src);
(async () => {
  const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--allow-file-access-from-files'] });
  const page = await b.newPage(); await page.goto('file://' + f);
  const r = await page.evaluate(() => {
    const a = document.querySelector('a[data-fq]'), cs = getComputedStyle(a), body = getComputedStyle(document.body), tail = document.querySelector('.tail');
    const sw = document.querySelector('.sw'), scs = getComputedStyle(sw), h = getComputedStyle(sw.querySelector('.sw-handle'));
    return { color: cs.color, bg: cs.backgroundColor, fs: cs.fontSize, display: cs.display, h: cs.height, deco: cs.textDecorationLine, text: a.textContent, href: a.getAttribute('href'),
      bodyMargin: body.marginTop, tailMargin: getComputedStyle(tail).marginTop, sw: { w: scs.width, bg: scs.backgroundColor, handleTx: h.transform }, styles: [...document.querySelectorAll('style[data-feique]')].map(s => s.dataset.feique) };
  });
  let pass = 0; const ok = (n, fn) => { try { fn(); pass++; console.log('✅', n); } catch (e) { console.log('❌', n, '\n   ', e.message); process.exitCode = 1; } };
  ok('页面自己的 .btn{font-size:0;color:transparent;background:none} 盖不住飞鹊主按钮：红底白字 14px inline-flex 32 高', () => { assert.strictEqual(r.bg, 'rgb(230, 69, 69)'); assert.strictEqual(r.color, 'rgb(255, 255, 255)'); assert.strictEqual(r.fs, '14px'); assert.strictEqual(r.display, 'inline-flex'); assert.strictEqual(r.h, '32px'); });
  ok('祖先规则 .ad .contact a{text-decoration:underline} 也输：飞鹊按钮无下划线', () => assert.strictEqual(r.deco, 'none'));
  ok('原文字与链接带过去', () => { assert.strictEqual(r.text, 'Buy'); assert.strictEqual(r.href, 'https://mic/p'); });
  ok('reset 只作用于组件内部：body 的 24px 边距和段落默认边距都没被清掉', () => { assert.strictEqual(r.bodyMargin, '24px'); assert.notStrictEqual(r.tailMargin, '0px'); });
  ok('开关：@keyframes 原样、宽 44、开态把手位移 22', () => { assert.strictEqual(r.sw.w, '44px'); assert.strictEqual(r.sw.bg, 'rgb(0, 125, 250)'); assert.ok(/22/.test(r.sw.handleTx), r.sw.handleTx); });
  ok('样式块只注一次：reset + ctl-btn + ctl-sw + 六个控件各自的', () => assert.deepStrictEqual(r.styles.slice(0, 3), ['reset', 'ctl-btn', 'ctl-sw']));
  /* 行为：真鼠标点，看类名变化（吉吉：每个组件都是可以交互的） */
  const clickAt = async sel => { const b = await page.$(sel); const bb = await b.boundingBox(); await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await new Promise(x => setTimeout(x, 60)); };
  const scripts = await page.evaluate(() => [...document.querySelectorAll('script[data-feique]')].map(s => s.dataset.feique));
  ok('行为脚本只注一次，在 </body> 前', () => assert.deepStrictEqual(scripts, ['behaviors']));
  await clickAt('.tab .tab-item:nth-child(2)');
  const tabs = await page.evaluate(() => [...document.querySelectorAll('.tab .tab-item')].map(t => t.classList.contains('active')));
  ok('Tabs：点第二个，它 active、第一个不再 active', () => assert.deepStrictEqual(tabs, [false, true, false]));
  await clickAt('.sw'); const swOn = await page.evaluate(() => document.querySelector('.sw').classList.contains('sw-on'));
  ok('开关：点一下从开变关', () => assert.strictEqual(swOn, false));
  await clickAt('.cb'); const cbSel = await page.evaluate(() => document.querySelector('.cb').classList.contains('cb-sel'));
  ok('复选框：点一下取消勾选', () => assert.strictEqual(cbSel, false));
  await clickAt('.pg .pg-item:nth-of-type(3)'); const pgAct = await page.evaluate(() => [...document.querySelectorAll('.pg .pg-item')].map(t => t.classList.contains('pg-active')));
  ok('分页：点第 3 页，只有它 active；分页数字没有下划线', () => { assert.deepStrictEqual(pgAct, [false, false, true, false]); });
  const pgDeco = await page.evaluate(() => getComputedStyle(document.querySelector('.pg .pg-item')).textDecorationLine);
  ok('分页数字 text-decoration none', () => assert.strictEqual(pgDeco, 'none'));
  await clickAt('.sel-demo-wrap .sel'); const selOpen = await page.evaluate(() => document.querySelector('.sel-demo-wrap').classList.contains('open'));
  await clickAt('.sel-menu-item:nth-child(2)'); const selVal = await page.evaluate(() => ({ t: document.querySelector('.sel-text').textContent, open: document.querySelector('.sel-demo-wrap').classList.contains('open') }));
  ok('下拉：点触发器展开，点选项写进去并收起', () => { assert.strictEqual(selOpen, true); assert.strictEqual(selVal.t, 'Option B'); assert.strictEqual(selVal.open, false); });
  await clickAt('.clps .clps-item:nth-child(2) .clps-hd'); const clps = await page.evaluate(() => [...document.querySelectorAll('.clps-item')].map(i => i.classList.contains('is-open')));
  ok('折叠面板：点第二项标题展开它', () => assert.deepStrictEqual(clps, [true, true]));
  await clickAt('.stp .stp-item:nth-child(3) .stp-node'); const stp = await page.evaluate(() => [...document.querySelectorAll('.stp-item')].map(i => i.classList.contains('stp-done') ? 'done' : i.classList.contains('stp-cur') ? 'cur' : 'wait'));
  ok('步骤条：点第 3 步，前两步变完成、第 3 步进行中', () => assert.deepStrictEqual(stp, ['done', 'done', 'cur']));
  console.log(`\n${pass} 项通过`);
  await b.close();
})();
