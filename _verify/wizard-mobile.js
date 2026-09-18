/**
 * 向导层移动端探针 · 390px 真机尺寸，三张卡逐张跑。
 *
 * 🔴 为什么不是量「有没有横向溢出」：2026-09-08 实测，任务单把问题区整个盖住的时候，
 *    横向溢出是 0、元素一个不少、JS 零报错 —— 那版数字全绿，肉眼一看是废的。
 *    真正该量的是**盒子之间的位置关系**：竖排布局里，问题区和任务单不许在垂直方向重叠。
 *    （同族判据：漂亮数字先标定仪器。数字我当时拿到了，只是没算那一个关系。）
 *
 * 跑法：node _verify/wizard-mobile.js
 */
const puppeteer = require('/Users/wanglixiang/.claude/skills/mic-fullstack/scripts/online-reach/node_modules/puppeteer-core');
const path = require('path');
const FILE = 'file://' + path.resolve(__dirname, '..', 'index.html')   /* 2026-09-09 向导已并入线上那份，wizard.html 已删 */;
const OUT = path.resolve(__dirname, 'out');

let bad = 0;
const fail = m => { console.log('  ❌ ' + m); bad++; };
const ok = m => console.log('  ✅ ' + m);

(async () => {
  const b = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'],
    defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  });
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  await p.goto(FILE, { waitUntil: 'load' });
  const cards = await p.evaluate(() => Object.keys(WIZ));

  for (const key of cards) {
    const [sid, ci] = key.split('/');
    console.log('═══ ' + key + ' @390px ═══');
    await p.evaluate(s => setScene(s), sid);
    await p.evaluate(i => pick(+i), ci);
    await p.waitForFunction(() => typeof W !== 'undefined' && W.state === 'done', { timeout: 120000 }).catch(() => {});

    const m = await p.evaluate(() => {
      const r = s => { const e = document.querySelector(s); if (!e) return null;
        const q = e.getBoundingClientRect();
        return { t: Math.round(q.top), b: Math.round(q.bottom), l: Math.round(q.left), r: Math.round(q.right), h: Math.round(q.height) }; };
      return {
        main: r('.wz-main'), side: r('.wz-side'), q: r('.wz-q'), steps: r('.wz-rail'),
        body: r('.wz-body'),
        ft: r('.wz-ft'), hd: r('.wz-hd'),
        docW: document.documentElement.scrollWidth, vw: window.innerWidth,
        /* 问题区第一道题看得见吗 —— 这才是「能不能填」 */
        firstQ: (() => { const e = document.querySelector('.wz-item'); if (!e) return null;
          const q = e.getBoundingClientRect();
          return { t: Math.round(q.top), h: Math.round(q.height), 在视口内: q.top >= 0 && q.top < window.innerHeight }; })(),
      };
    });

    /* 1. 竖排下：问题区和任务单不许垂直重叠 */
    const ov = Math.min(m.q.b, m.side.b) - Math.max(m.q.t, m.side.t);
    ov > 0 ? fail(`问题区(${m.q.t}~${m.q.b}) 和任务单(${m.side.t}~${m.side.b}) 垂直重叠 ${ov}px —— 任务单盖住了问题`)
           : ok(`问题区在上、任务单在下，无重叠（间隔 ${-ov}px）`);

    /* 2. 步骤条不许被盖 */
    const ov2 = Math.min(m.steps.b, m.side.b) - Math.max(m.steps.t, m.side.t);
    ov2 > 0 ? fail(`步骤条和任务单重叠 ${ov2}px`) : ok('步骤条没被盖');

    /* 3. 主内容区不能被压塌（问题填不了） */
    m.main.h < 300 ? fail(`问题区所在的 .wz-main 只有 ${m.main.h}px 高 —— 被压塌了，填不了`)
                   : ok(`.wz-main ${m.main.h}px 高，填得下`);

    /* 4. 第一道题要在首屏看得见 */
    m.firstQ && m.firstQ.在视口内 ? ok(`第 1 道题在首屏（top ${m.firstQ.t}）`)
      : fail('第 1 道题不在首屏，打开就看不到要填什么');

    /* 5. 底栏（下一步）不许被压住 —— 它是每步唯一的主操作。
       🔴 这条第一版拿 `.wz-q` 跟底栏比，三张卡全报「重叠 70px」，是假红：
       `.wz-q` 在 `.wz-body` 这个滚动容器里面，它的 rect 会伸到可视区之外、
       被容器裁掉，只是数学上跟底栏的 y 区间相交。
       要比的是**滚动容器自己的可视盒**跟底栏（这两个才是 flex 兄弟、同一个坐标空间）。
       判据：拿两个盒子比位置之前，先确认它们在不在同一个滚动容器里。 */
    const ov3 = Math.min(m.body.b, m.ft.b) - Math.max(m.body.t, m.ft.t);
    ov3 > 0 ? fail(`滚动区和底栏重叠 ${ov3}px —— 主操作被压住`) : ok(`底栏没被压住（在滚动区下方 ${-ov3}px）`);
    m.ft.b <= 844 ? ok(`底栏整条在视口内（bottom ${m.ft.b}）`) : fail(`底栏被挤出视口（bottom ${m.ft.b} > 844）`);

    /* 6. 横向不溢出（保留，但它不是主判据） */
    m.docW > m.vw ? fail(`横向溢出 ${m.docW}>${m.vw}`) : ok('无横向溢出');

    await p.screenshot({ path: path.join(OUT, 'mobile-' + key.replace('/', '-') + '.png') });
    await p.evaluate(() => { W.open = false; W.tok++; document.getElementById('wizmask').classList.remove('wzon'); });
    console.log('');
  }
  console.log('══ JS 错误 ══');
  errs.length ? errs.forEach(e => fail(e)) : ok('0 个');
  console.log('\n' + (bad ? '══ ' + bad + ' 项没过 ══' : '══ 全部通过 ══'));
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('探针本身挂了：', e); process.exit(2); });
