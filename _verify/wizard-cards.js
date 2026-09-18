/**
 * 向导卡片功能探针 —— 三张卡逐张走完四步，在真浏览器里验。
 *
 * 为什么另建一份：`wizard.js` 量的是视觉计算值（对比度 / 圆角 / 真值对齐），
 * 它只看第 1 步。这份查的是「填得下去吗、检索真查到了吗、单选点得动吗」：
 *   1. 真检索逐条报命中的文档名 —— 🔴 只报「几段」没用，检索有命中不等于
 *      命中对的那句话（这是页面的已知天花板，不是这层能修的）。
 *      所以这里把文档名打出来，由人看一眼对不对。
 *   2. 🔴 单选圆点：`.wz-opt.rd.wzon .bx::after` 原来缺 content 和 position，
 *      在此之前没有任何一张卡用单选，所以从没被跑到过。这里量白点的真实尺寸。
 *   3. 四步全走完、每题填上、确定数要等于总题数。
 *   4. 拼给模型的那段话里，待定项必须在（不在的话模型会自己拿默认假设补）。
 *
 * 跑法：node _verify/wizard-cards.js
 */
const puppeteer = require('/Users/wanglixiang/.claude/skills/mic-fullstack/scripts/online-reach/node_modules/puppeteer-core');
const path = require('path');

const FILE = 'file://' + path.resolve(__dirname, '..', 'index.html')   /* 2026-09-09 向导已并入线上那份，wizard.html 已删 */;
let bad = 0;
const fail = m => { console.log('  ❌ ' + m); bad++; };
const ok = m => console.log('  ✅ ' + m);
const info = m => console.log('     ' + m);

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'],
    defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await page.goto(FILE, { waitUntil: 'load' });

  const cards = await page.evaluate(() => Object.keys(WIZ));
  console.log('■ 已登记 ' + cards.length + ' 张卡：' + cards.join('、') + '\n');

  for (const key of cards) {
    const [sid, ci] = key.split('/');
    console.log('═══════════ ' + key + ' ═══════════');

    await page.evaluate(s => { setScene(s); }, sid);
    await page.evaluate(i => { pick(+i); }, ci);

    const head = await page.evaluate(() => ({
      tag: document.getElementById('wzTag').textContent,
      name: document.getElementById('wzT').textContent,
      steps: [...document.querySelectorAll('.wz-rail .wzs')].map(x => x.textContent.trim()),
      qs: W ? wzAllQs().length : -1,
    }));
    console.log('  ' + head.tag + ' / ' + head.name);
    info(head.steps.length + ' 步：' + head.steps.join(' → '));
    /* 🔴 别写死 4 步。铺满 18 张卡之后，简单的活是 3 步（飞鹊组件查询 / 用户行为分析 /
       阿语版 / 应用市场图），硬凑第 4 步就是往里灌废话。
       第一版写死 `=== 4`，跑到 demo/2 直接把探针本身弄挂了（步进循环越界）。 */
    head.steps.length >= 3 ? ok(head.steps.length + ' 步（≥3）')
                           : fail('只有 ' + head.steps.length + ' 步，太薄');

    /* ── 1. 真检索：等它跑完，逐条报命中的文档名 ── */
    await page.waitForFunction(() => typeof W !== 'undefined' && W.state === 'done', { timeout: 120000 })
      .catch(() => fail('auto 检索 120 秒没跑完'));
    const rows = await page.evaluate(() => W.rows.map(r => ({
      label: r.label, state: r.state,
      docs: [...r.detail.matchAll(/class="wz-doc"[^>]*>([^<]+)</g)].map(m => m[1]),
      raw: r.detail.replace(/<[^>]+>/g, '').slice(0, 90),
    })));
    console.log('  检索 ' + rows.length + ' 条：');
    rows.forEach(r => {
      if (r.state === 'ok') { ok(r.label); info('→ ' + r.docs.join(' · ')); }
      else fail(r.label + ' —— ' + r.raw);
    });

    /* ── 2. 走完每一步，每题都填 ── */
    const NS = head.steps.length;
    for (let s = 0; s < NS; s++) {
      await page.evaluate(i => { W.step = i; wzDraw(); }, s);
      await new Promise(r => setTimeout(r, 120));
      /* 每题：选项点第一个；输入框和文本域打字 */
      await page.evaluate(() => {
        document.querySelectorAll('#wzMain .wz-item').forEach(item => {
          const opt = item.querySelector('.wz-opt');
          if (opt) { opt.click(); return; }
          const el = item.querySelector('input[type=text], textarea');
          if (el) { el.value = '探针填的'; el.dispatchEvent(new Event('input', { bubbles: true })); }
        });
      });
    }
    const prog = await page.evaluate(() => ({
      txt: document.getElementById('wzProg').textContent,
      n: wzAllQs().filter(wzFilled).length, all: wzAllQs().length,
      askHidden: document.getElementById('wzAsk').hidden,
      nextHidden: document.getElementById('wzNext').hidden,
    }));
    prog.n === prog.all ? ok('填满 ' + prog.txt) : fail('只填到 ' + prog.txt + '（有题没填上）');
    (!prog.askHidden && prog.nextHidden) ? ok('最后一步：只剩收尾那一个主按钮，没有死按钮')
      : fail('最后一步按钮不对（ask隐藏=' + prog.askHidden + ' next隐藏=' + prog.nextHidden + '）');

    /* ── 3. 单选圆点（本轮修的那个 bug）── */
    /* 🔴 第一版这里直接量当前步 —— 填完停在第 4 步，那步只有多选，
       于是对 design/1 报了「这张卡没有单选题」，而它第 2 步明明有两道。
       探针说「没有」和「我没看到」是两件事，措辞不实比漏检更坏。
       改成：先从 WIZ 定义里找出单选题在第几步，切过去再量。 */
    const rdStep = await page.evaluate(() => {
      const st = wzDef().steps;
      for (let i = 0; i < st.length; i++)
        if (st[i].qs.some(q => q.type !== 'check' && q.type !== 'text' && q.type !== 'area')) return i;
      return -1;
    });
    if (rdStep >= 0) { await page.evaluate(i => { W.step = i; wzDraw(); }, rdStep); await new Promise(r => setTimeout(r, 120)); }
    const rd = await page.evaluate(() => {
      const on = document.querySelector('.wz-opt.rd.wzon .bx');
      if (!on) return null;
      const cs = getComputedStyle(on, '::after');
      return { content: cs.content, pos: cs.position, w: cs.width, h: cs.height, bg: cs.backgroundColor };
    });
    if (rdStep < 0) info('这张卡确实没有单选题（已查 WIZ 定义），跳过圆点检查');
    else if (!rd) fail('第 ' + (rdStep + 1) + ' 步有单选题，却没量到选中的圆点');
    else if (rd.content === 'none' || rd.pos !== 'absolute' || parseFloat(rd.w) < 4)
      fail('单选圆点没渲染出来：content=' + rd.content + ' position=' + rd.pos + ' 尺寸=' + rd.w + '×' + rd.h);
    else ok('单选圆点 ' + rd.w + '×' + rd.h + ' ' + rd.bg + '（content/position 都在）');

    /* ── 4. 拼给模型的话 ── */
    const t = await page.evaluate(() => ({ model: wzText(true), cc: wzText(false) }));
    t.model.includes('已经确定的：') ? ok('给模型那段带「已经确定的」') : fail('给模型那段缺「已经确定的」');
    t.cc.includes('产出落到') ? ok('给 Claude Code 那段带落盘路径') : fail('给 CC 那段缺落盘路径');
    info('给模型 ' + t.model.length + ' 字 · 给 Claude Code ' + t.cc.length + ' 字');

    /* 留一题不填，验「还没定的」那段在不在 —— 不写进去，模型会自己拿默认假设补 */
    const pend = await page.evaluate(() => {
      const k = wzAllQs()[0].k; delete W.ans[k];
      return { txt: wzText(true), q: wzAllQs()[0].q };
    });
    /* 🔴 别写死空格形态。原来断言的是 '还没定的 1 项'，2026-09-09 按中英/中数
       不加空格的元铁律把文案改成「还没定的1项」之后，这道门 18 张卡全红 ——
       红的是门，不是产品。用正则容忍空白，文案微调不再误伤。 */
    (/还没定的\s*1\s*项/.test(pend.txt) && pend.txt.includes(pend.q))
      ? ok('留空一题 → 待定项进了给模型那段') : fail('待定项没进给模型那段');

    await page.evaluate(() => { W.open = false; W.tok++; document.getElementById('wizmask').classList.remove('wzon'); });
    console.log('');
  }

  console.log('══ JS 错误 ══');
  errs.length ? errs.forEach(e => fail(e)) : ok('0 个');
  console.log('\n' + (bad ? '══ ' + bad + ' 项没过 ══' : '══ 全部通过 ══'));
  await browser.close();
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('探针本身挂了：', e); process.exit(2); });
