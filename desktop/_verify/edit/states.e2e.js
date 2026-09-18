/* 飞鹊控件的「自带交互」门：真 Chrome + CDP 真鼠标，量的是「人把鼠标放上去 / 点下去，颜色变没变」。
   🔴 为什么必须用真鼠标：dispatchEvent 造一个事件只能证明监听器写对了，证明不了事件到得了；
   而这里根本没有监听器 —— 全靠 CSS 的 :hover / :checked，只有真实指针才会命中。
   期望值全部抄自飞鹊源 CSS（docs/css/*.css），不是我定的。跑法：node _verify/edit/states.e2e.js

   🔴 两条仪器判据（第一版就栽在这两条上，报了一片假红）：
   ① 砖出厂就是「勾上/打开」的，所以**静止态不等于未选中态** —— 要量 hover 得另摆一份取消勾选的。
   ② 飞鹊这几个控件都写了 transition（cb 150ms / sw 200ms），动作后等 120ms 取色，
      取到的是过渡跑到一半的中间色（#9CACBC 这种查无此处的值）。必须等过渡结束再取。 */
const path = require('path'), fs = require('fs'), assert = require('assert');
const DESK = path.join(__dirname, '..', '..');
const puppeteer = require(path.join(DESK, 'restore-tools', 'online-reach', 'node_modules', 'puppeteer-core'));
const comps = require(path.join(DESK, 'main', 'components.js'));

const PACK = path.join(DESK, 'packs', 'feique');
const DIR = path.join(require('os').tmpdir(), 'uw-states-e2e');
fs.mkdirSync(DIR, { recursive: true });
const SETTLE = 400;                                   // 比最长的那条 transition（200ms）宽裕一倍

/* 期望值 = 飞鹊源 CSS 里写的那几个数（cb.css / rd.css / ss.css / sw.css / ta.css）。
   改了映射表或飞鹊重新导出，这里对不上就该红。 */
const CASES = [
  { id: 'cb', probe: '.cb-box', prop: 'borderColor',
    rest: 'rgb(136, 136, 136)', hover: 'rgb(85, 85, 85)', why: '勾选框：没勾时 #888 → 悬停 #555' },
  { id: 'rd', probe: '.rd-circle', prop: 'borderColor',
    rest: 'rgb(206, 211, 217)', hover: 'rgb(34, 34, 34)', why: '单选：没选时 #CED3D9 → 悬停 #222' },
  { id: 'ss', probe: '.ss', prop: 'backgroundColor',
    rest: 'rgb(255, 255, 255)', hover: 'rgb(244, 244, 244)', why: '按钮式选择器：没选时白 → 悬停 #F4F4F4' },
  { id: 'ta', probe: '.ta', prop: 'borderColor',
    rest: 'rgb(206, 211, 217)', hover: 'rgb(136, 136, 136)', why: '文本域：默认 #CED3D9 → 悬停 #888' },
  { id: 'cb', probe: '.cb-box', prop: 'backgroundColor', toggle: true,
    checked: 'rgb(34, 34, 34)', unchecked: 'rgb(255, 255, 255)', why: '勾选框：勾上 #222 / 取消 #fff' },
  { id: 'sw', probe: '.sw', prop: 'backgroundColor', toggle: true,
    checked: 'rgb(0, 125, 250)', unchecked: 'rgb(179, 179, 179)', why: '开关：开 #007DFA / 关 #B3B3B3' },
];

(async () => {
  const list = comps.loadCatalog(PACK);
  const want = [...new Set(CASES.map(c => c.id))];
  const bricks = want.map(id => {
    const c = list.find(x => x.id === id);
    if (!c) throw new Error('清册里没有 ' + id);
    return { id, html: comps.fill(c, {}), css: (c.reset || '') + '\n' + c.css };
  });
  /* 砖的 CSS 作用域是根元素上的 data-fq（fill 会自己盖上），外层包什么都不影响。
     每块摆两份：#box-* 保持出厂态（勾上的），#off-* 在 setup 里取消勾选。 */
  const body = bricks.map(b => `<div id="box-${b.id}" style="padding:24px">${b.html}</div>\n<div id="off-${b.id}" style="padding:24px">${b.html.replace(/name="([^"]+)"/g, 'name="$1-off"')}</div>`).join('\n');
  /* 🔴 两份拷贝要是共用同一个 name，就成了一个单选组，后一份的 checked 会把前一份顶掉，
     「出厂是选中的」这件事就量不出来了（第一版截图里两个单选都是空心圈，就是这么来的）。 */
  const group = bricks.filter(b => /type="radio"/.test(b.html)).map(b => { const g = b.html.replace(/name="([^"]+)"/g, 'name="$1-grp"'); return `<div id="grp-${b.id}" style="padding:24px">${g}${g}</div>`; }).join('\n');
  const css = bricks.map(b => b.css).join('\n');
  fs.writeFileSync(path.join(DIR, 'page.html'),
    `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#fff}\n${css}</style></head><body>${body}\n${group}</body></html>`);

  const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, defaultViewport: { width: 900, height: 900 } });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('file://' + path.join(DIR, 'page.html'));
  await page.evaluate(() => document.querySelectorAll('[id^=off-] input').forEach(i => { i.checked = false; }));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  await wait(SETTLE);

  let pass = 0;
  const ok = (n, f) => { try { f(); pass++; console.log('✅', n); } catch (e) { console.log('❌', n, '\n   ', e.message); process.exitCode = 1; } };
  const colorOf = (box, probe, prop) => page.evaluate((b, p, k) => {
    const root = document.querySelector(b);
    const el = root.querySelector(p) || (root.firstElementChild.matches(p) ? root.firstElementChild : null);
    return getComputedStyle(el)[k];
  }, box, probe, prop);
  const centerOf = box => page.evaluate(b => { const r = document.querySelector(b + ' >*').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, box);
  const AWAY = { x: 5, y: 880 };

  for (const c of CASES) {
    const box = (c.toggle ? '#box-' : '#off-') + c.id;      // 悬停量没勾的那份，切换量出厂那份
    const at = await centerOf(box);
    if (c.toggle) {
      await page.mouse.click(at.x, at.y); await wait(SETTLE);          // 真点一下 → 取消
      const off = await colorOf(box, c.probe, c.prop);
      await page.mouse.click(at.x, at.y); await wait(SETTLE);          // 再点回来
      const on = await colorOf(box, c.probe, c.prop);
      await page.mouse.move(AWAY.x, AWAY.y); await wait(SETTLE);
      ok(`${c.why} —— 真鼠标点一下就切，不用加class、不用JS`, () => {
        assert.strictEqual(off, c.unchecked, `点掉之后应是${c.unchecked}，实际${off}`);
        assert.strictEqual(on, c.checked, `再点回来应是${c.checked}，实际${on}`);
      });
    } else {
      await page.mouse.move(AWAY.x, AWAY.y); await wait(SETTLE);
      const rest = await colorOf(box, c.probe, c.prop);
      await page.mouse.move(at.x, at.y); await wait(SETTLE);
      const hov = await colorOf(box, c.probe, c.prop);
      await page.mouse.move(AWAY.x, AWAY.y); await wait(SETTLE);
      const back = await colorOf(box, c.probe, c.prop);
      ok(`${c.why} —— 真鼠标悬停就变，移开就回去`, () => {
        assert.strictEqual(rest, c.rest, `静止态应是${c.rest}，实际${rest}`);
        assert.strictEqual(hov, c.hover, `悬停态应是${c.hover}，实际${hov}`);
        assert.strictEqual(back, c.rest, `移开应回到${c.rest}，实际${back}`);
      });
    }
  }

  /* 出厂就是「已选中」的那份，真的得是选中的样子（不是空心圈） */
  const shipped = await page.evaluate(() => ({
    rd: getComputedStyle(document.querySelector('#box-rd .rd-circle')).borderColor,
    ss: getComputedStyle(document.querySelector('#box-ss .ss')).borderWidth,
    cb: getComputedStyle(document.querySelector('#box-cb .cb-box')).backgroundColor,
  }));
  ok('拖进页面时就是选中的样子：单选描边 #222、按钮式选择器描边加粗到2px、勾选框填 #222', () => {
    assert.strictEqual(shipped.rd, 'rgb(34, 34, 34)'); assert.strictEqual(shipped.ss, '2px'); assert.strictEqual(shipped.cb, 'rgb(34, 34, 34)');
  });

  /* 同一组里的单选要互斥：点第二个，第一个得松开 */
  for (const id of ['rd', 'ss']) {
    const two = await page.evaluate(i => [...document.querySelectorAll('#grp-' + i + ' >*')].map(el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }), id);
    await page.mouse.click(two[1].x, two[1].y); await wait(SETTLE);
    const st = await page.evaluate(i => [...document.querySelectorAll('#grp-' + i + ' input')].map(x => x.checked), id);
    ok(`${id === 'rd' ? '单选' : '按钮式选择器'}：同名的几个是一组，点了第二个第一个自动松开`, () => assert.deepStrictEqual(st, [false, true]));
  }

  /* 塞进去的原生控件不能被看见，也不能把布局撑开，但键盘还要能选到 */
  const hidden = await page.evaluate(() => [...document.querySelectorAll('#box-cb input,#box-rd input,#box-sw input,#box-ss input')].map(i => { const cs = getComputedStyle(i); const r = i.getBoundingClientRect(); return { op: cs.opacity, w: r.width, h: r.height, focusable: i.tabIndex >= 0 }; }));
  ok('藏起来的原生控件：看不见、不占地方，但仍然能用键盘选到', () => { assert.ok(hidden.length >= 4, '只找到 ' + hidden.length + ' 个'); hidden.forEach(h => { assert.strictEqual(h.op, '0'); assert.ok(h.w < 1 && h.h < 1, `${h.w}×${h.h}`); assert.strictEqual(h.focusable, true); }); });

  /* 老写法不能被打断：已经落在别人页面里的 .cb-sel / .sw-on 还得照样显示 */
  const legacy = await page.evaluate(() => {
    const d = document.createElement('div');
    d.innerHTML = '<label class="cb cb-sel" data-fq><span class="cb-box"></span><span class="cb-label">old</span></label>'
      + '<span class="sw sw-on" data-fq><span class="sw-handle"></span></span>';
    document.body.appendChild(d);
    return { cb: getComputedStyle(d.querySelector('.cb-box')).backgroundColor, sw: getComputedStyle(d.querySelector('.sw')).backgroundColor };
  });
  ok('老写法（手动加 .cb-sel / .sw-on）仍然有效：以前做的页面不会被这次改动打断', () => { assert.strictEqual(legacy.cb, 'rgb(34, 34, 34)'); assert.strictEqual(legacy.sw, 'rgb(0, 125, 250)'); });

  ok('全程没有页面报错', () => assert.deepStrictEqual(errors, []));
  console.log(`\n${pass}项通过 · 页面 ${path.join(DIR, 'page.html')}`);
  await browser.close();
})().catch(e => { console.error('💥', e); process.exit(1); });
