/* 流程控制台窗口自己的界面门：真 renderer/flow.html + mock 的 uw 桥 + 一份真扫描结果（示例项目）。
   验四个视图各自渲染对不对、点了发出去的指令对不对、展示模式的上一步/下一步走得对不对。
   🔴 这一套跟 ui.e2e 是两回事：那边验「主窗口收到指令怎么反应」，这边验「控制台发什么指令」。
   两边各验一半，中间那条线（主进程转发）在真机点一遍——门全绿不等于功能对。 */
const path = require('path'), fs = require('fs'), assert = require('assert');
const puppeteer = require(path.join(__dirname, '..', '..', 'restore-tools', 'online-reach', 'node_modules', 'puppeteer-core'));
const DESK = path.join(__dirname, '..', '..');
const flow = require(DESK + '/main/flow.js');

/* 造一个四页十一态的项目当料。不用工作区里那份——测试不能依赖用户目录里有什么 */
const os = require('os');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'uwflowui-'));
const pg = (title, css, body, cls) => `<!DOCTYPE html><html><head><title>${title}</title><style>${css}</style></head><body class="${cls || 'state-default'}">${body}</body></html>`;
/* 🔴 料里必须有一份**内嵌成 data: 的字体**，否则「字体在缩略图里能不能用」这道门是空跑的。
   2026-09-18 实测：控制台的 CSP 只写了 img-src data:、没写 font-src，
   于是铺开里每张缩略图的飞鹊字体全部加载失败、退回系统字体 —— 而所有门都是绿的，
   因为 getComputedStyle 读到的 font-family / font-weight 全对（那是**请求侧**）。 */
const FONT_B64 = fs.readFileSync(path.join(DESK, 'packs', 'feique', 'fonts', 'roboto-400.woff2')).toString('base64');
const FONT_CSS = `@font-face{font-family:'Roboto';font-style:normal;font-weight:400;src:url(data:font/woff2;base64,${FONT_B64}) format('woff2')}body{font-family:'Roboto',sans-serif}`;
fs.writeFileSync(path.join(base, 'index.html'), pg('搜索结果页',
  FONT_CSS + '/* @态 empty 一条都没有 · 搜索词没命中 */ body.state-empty .l{display:none} body.state-guest .p{visibility:hidden}',
  '<a class="pd-card" href="detail.html">产品一</a><a href="lost.html">断的</a>'));
fs.writeFileSync(path.join(base, 'detail.html'), pg('产品详情页', 'body.state-error .buy{display:none}',
  '<a class="btn inq-btn" href="inquiry.html">Send Inquiry</a><a class="btn sec" href="index.html">返回</a>'));
fs.writeFileSync(path.join(base, 'inquiry.html'), pg('询盘表单', 'body.state-guest .g{display:block}',
  '<input name="qty"><a class="btn" href="index.html">回</a>'));
fs.writeFileSync(path.join(base, 'orphan.html'), pg('没人跳得到的页', '', '<a href="index.html">回</a>'));
fs.writeFileSync(path.join(base, 'index.说明.md'), '# 搜索结果页\n\n## 状态\n| 状态 | 类名 | 什么时候 |\n|---|---|---|\n| 一条都没有 | state-empty | 搜索词没命中 |\n| 未登录 | state-guest | 没登录就搜 |\n\n## 为什么\n价格用 visibility 不用 display，卡片高度才不塌。');
fs.writeFileSync(path.join(base, '剧本.md'), '## 买家从搜索到发询盘\n1. index.html · default · 搜 led\n2. detail.html · default · 点进第一个\n3. inquiry.html · guest · 没登录就发\n\n## 出错的样子\n1. index.html · empty · 搜了个没货的词\n');
const DATA = { ok: true, ...flow.scan(base) };
const walk = require(DESK + '/main/flow-walk.js');
const PAGES = DATA.pages.map(p => ({ rel: p.rel, html: walk.prep(fs.readFileSync(path.join(base, p.rel), 'utf8'), p.rel) }));

(async () => {
  const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, defaultViewport: { width: 460, height: 900 } });
  const page = await browser.newPage();
  /* 🔴 这里**不能**开 setBypassCSP。原来开着（从 ui.e2e 抄来的，那边确实需要），
     结果就是：控制台的 CSP 在测试里根本不生效，任何 CSP 问题这套门都看不见。
     2026-09-18 实测代价 —— font-src 漏写导致铺开里所有缩略图的字体退回系统字体，
     35 项门全绿，是吉吉用肉眼看出来的。
     负向标定：注掉下面这行 ＋ 从 flow.html 拿掉 font-src → 本文件应红 3 条。
     实测 flow-ui 不开绕开也全绿，所以没有保留它的理由。 */
  // await page.setBypassCSP(true);   ← 别加回来
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.evaluateOnNewDocument((DATA, PAGES) => {
    window.__goto = []; window.__scans = 0; window.__resize = []; window.__walk = 0; window.__walkResp = { ok: true, file: '_走查.html', bytes: 20480, pages: 4, bad: 0 };
    /* 🔴 料放在 window 上、不闭包进 mock：底下要换一份「一个页面开三个抽屉」的项目再扫一遍，
       验的就是**同一套代码换个形状的项目会不会换个画法**（这一版的全部意思）。 */
    window.__D = DATA; window.__P = PAGES;
    window.uw = {
      flowScan: async () => { window.__scans++; return window.__D; },
      flowGoto: async (m) => { window.__goto.push(m); return { ok: true }; },
      flowWalk: async () => { window.__walk++; return window.__walkResp; },
      flowHtml: async ({ rels }) => ({ ok: true, pages: window.__P.filter(p => rels.includes(p.rel)) }),
      flowResize: async (m) => { window.__resize.push(m); return { ok: true }; },
      onFlowProject: (fn) => { window.__proj = fn; return () => {}; },
      onFlowAt: (fn) => { window.__at = fn; return () => {}; },
    };
  }, DATA, PAGES);
  await page.goto('file://' + path.join(DESK, 'renderer', 'flow.html'), { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => window.__proj({ id: 'p' }));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  await wait(300);

  let pass = 0;
  const ok = (n, f) => { try { f(); pass++; console.log('✅', n); } catch (e) { console.log('❌', n, '\n   ', e.message); process.exitCode = 1; } };
  const q = (sel, fn) => page.evaluate((s, f) => eval('(' + f + ')')(document.querySelectorAll(s)), sel, String(fn));

  /* ── 对照表 ────────────────────────── */
  const grid = await page.evaluate(() => {
    const head = [...document.querySelectorAll('table.grid thead tr:last-child th')].map(t => t.textContent.trim());
    const vhead = [...document.querySelectorAll('table.grid thead th.vg')].map(t => t.textContent.trim());
    const pgHead = (document.querySelector('table.grid thead th.pg') || {}).textContent || '';
    const rows = [...document.querySelectorAll('table.grid tbody tr')].map(tr => ({
      page: tr.querySelector('td.pg .t').textContent.trim(),
      cells: [...tr.querySelectorAll('td:not(.pg)')].map(td => td.querySelector('.cell.has') ? '●' : '·'),
    }));
    return { head, vhead, pgHead: pgHead.trim(), rows };
  });
  /* 🔴 2026-09-18 起表头有两层：上层是视图（页面本身 / 抽屉浮层），下层才是状态。
     「第一个状态列＝正常的样子」这条没变，只是它现在在第二行、而且可以不叫 default
     （页面挂 state-guest 且 CSS 里没有 .state-guest 规则时，guest 就是那个正常的样子）。 */
  ok('对照表：第一列是页面，第一个状态列固定是「基准」（人从左往右读＝正常 → 各种不正常）', () => {
    assert.strictEqual(grid.pgHead, '页面');
    assert.strictEqual(grid.head[0], '默认');              // 这份料里 guest 自己有 CSS 规则，所以基准另有其样
    assert.strictEqual(grid.vhead[0], '主视图');            // 上层第一组永远是页面本身
  });
  ok('对照表：所有页面出现过的状态并成表头，一页一行', () => {
    assert.strictEqual(grid.rows.length, 4, JSON.stringify(grid.rows.map(r => r.page)));
    assert.ok(grid.head.includes('一条都没有'), JSON.stringify(grid.head));
    assert.ok(grid.head.includes('未登录') && grid.head.includes('出错'), JSON.stringify(grid.head));
  });
  ok('对照表：没有这个态的格子是空的——空格子就是「还没做」，这是整张表存在的理由', () => {
    const r = grid.rows.find(x => x.page === '产品详情页');
    assert.ok(r.cells.filter(c => c === '·').length >= 2, JSON.stringify(r));
    assert.strictEqual(r.cells[0], '●', '默认态必须有');
  });

  await page.evaluate(() => {
    const th = [...document.querySelectorAll('table.grid thead tr:last-child th')].findIndex(t => t.textContent.trim() === '未登录');
    const tr = [...document.querySelectorAll('table.grid tbody tr')].find(x => x.querySelector('td.pg .t').textContent.trim() === '搜索结果页');
    tr.querySelectorAll('td')[th + 1].querySelector('.cell.has').click();   /* +1：第 0 格是页面名那一列 */
  });
  await wait(150);
  const g1 = await page.evaluate(() => window.__goto.slice(-1)[0]);
  ok('对照表：点一个格子 = 去那一页的那个态（指令里带上当前叠加开关）', () => assert.deepStrictEqual(g1, { id: 'p', rel: 'index.html', state: 'guest', on: [] }));
  const atMark = await page.evaluate(() => !!document.querySelector('table.grid .cell.at'));
  ok('对照表：当前在哪一格，那一格高亮（两个窗口说的必须是同一件事）', () => assert.strictEqual(atMark, true));

  /* ── 铺开 ──────────────────────────
     对照表回答「有没有」，铺开回答「长什么样」。两个视图分工，别互相替代。 */
  await page.evaluate(() => { S.wall.rel = 'index.html'; });
  await page.click('#tabs button[data-v="wall"]'); await wait(1600);
  const wall = await page.evaluate(() => ({
    tiles: document.querySelectorAll('.tile').length,
    caps: [...document.querySelectorAll('.tile-cap .n')].map(x => x.textContent.trim()),
    cls: [...document.querySelectorAll('.tile iframe')].map(f => { try { return f.contentDocument.body.className; } catch (e) { return 'x'; } }),
    resize: window.__resize.slice(),
  }));
  ok('铺开：这一页有几个态就铺几张', () => {
    assert.strictEqual(wall.tiles, 3, JSON.stringify(wall.caps));
    assert.deepStrictEqual(wall.caps, ['默认', '一条都没有', '未登录']);
  });
  ok('🔴 每一张真的换成了那个态（不是三张一模一样的图）', () => {
    assert.ok(/state-default/.test(wall.cls[0]), wall.cls[0]);
    assert.ok(/state-empty/.test(wall.cls[1]), wall.cls[1]);
    assert.ok(/state-guest/.test(wall.cls[2]), wall.cls[2]);
  });
  ok('进铺开把窗口撑宽（460 宽摆不下两张）', () => {
    assert.ok(wall.resize.some(r => r.w >= 900), JSON.stringify(wall.resize));
  });
  /* 🔴 结果侧的量：document.fonts 的 status。请求侧（font-family/font-weight）永远是对的，
     所以只看 computed style 的门，对「字体被 CSP 挡掉」这类问题是完全瞎的。
     这一条是 2026-09-18 吉吉报「缩略图字重又不对了」之后补的 —— 同一类毛病第三次犯。 */
  const fonts = await page.evaluate(() => {
    const fr = document.querySelector('.tile iframe'); if (!fr) return null;
    try { return [...fr.contentDocument.fonts].map(f => f.family + '/' + f.weight + '/' + f.status); } catch (e) { return 'X:' + e.message; }
  });
  ok('🔴 缩略图里的内嵌字体真的加载上了（不是退回系统字体）', () => {
    assert.ok(Array.isArray(fonts) && fonts.length, '一个 @font-face 都没量到，料坏了：' + JSON.stringify(fonts));
    assert.ok(fonts.every(f => /\/loaded$/.test(f)), JSON.stringify(fonts));
  });
  ok('🔴 控制台的 CSP 没有挡掉任何东西（srcdoc 的 iframe 继承本文档的 CSP）', () => {
    const blocked = errors.filter(e => /Content Security|Refused to load/i.test(e));
    assert.deepStrictEqual(blocked, [], blocked.join(' | '));
  });

  const fit = await page.evaluate(() => [...document.querySelectorAll('.tile iframe')].map(f => +f.dataset.h || 0));
  ok('格子按页面真实内容高度裁，不是钉死 860（底下拖白就看不出差别了）', () => {
    assert.ok(fit.every(h => h > 0), JSON.stringify(fit));
    assert.ok(fit.some(h => h < 860), '一张都没量出来：' + JSON.stringify(fit));
  });

  await page.evaluate(() => { window.__goto = []; document.querySelector('.tile[data-state="empty"]').click(); });
  await wait(200);
  const wg = await page.evaluate(() => window.__goto.slice(-1)[0]);
  ok('铺开：点一张 = 去主窗口沉浸看那一态', () => assert.deepStrictEqual(wg, { id: 'p', rel: 'index.html', state: 'empty', on: [] }));

  await page.click('#wallMode button[data-m="pages"]'); await wait(1600);
  const wp = await page.evaluate(() => ({ n: document.querySelectorAll('.tile').length, sel: document.getElementById('wallPage').hidden }));
  ok('铺开：切到「所有页面」，一页一张，页面下拉收起来', () => {
    assert.strictEqual(wp.n, DATA.pages.length);
    assert.strictEqual(wp.sel, true);
  });

  const z0 = await page.evaluate(() => document.querySelector('.tile-shot').getBoundingClientRect().width);
  await page.evaluate(() => { const r = document.getElementById('wallZoom'); r.value = '60'; r.dispatchEvent(new Event('input')); });
  await wait(300);
  const z1 = await page.evaluate(() => document.querySelector('.tile-shot').getBoundingClientRect().width);
  ok('拖大小滑条只改尺寸、不重装页面（重装一次就卡住了）', () => assert.ok(z1 > z0 * 1.4, z0 + ' → ' + z1));

  /* 🔴 从铺开切到流程**不**还原宽度：流程图也要宽画布（卡片一行摆不下三张就没了全貌）。
     切到对照表这种列表型视图才还原。改判据的原因写在 flow.js 的标签事件那一节。 */
  await page.click('#tabs button[data-v="grid"]'); await wait(300);
  const back = await page.evaluate(() => window.__resize.slice(-1)[0]);
  ok('离开宽画布的视图（铺开/流程）才把窗口还原回原来的宽度', () => assert.ok(back && back.w < 900, JSON.stringify(back)));

  /* ── 流程 ────────────────────────── */
  /* 🔴 先把窗口弄矮，验「进流程图时既撑宽也撑高」。
     上一版只撑宽 —— 实测账：684 高的窗口里 4 屏摆成两行，每张缩略图只分到 136px，
     比写死的 0.18 还小，正好跟吉吉说的「现在的高度太低了」反着来。 */
  await page.setViewport({ width: 460, height: 700 });
  await page.click('#tabs button[data-v="map"]'); await wait(300);
  const rq = await page.evaluate(() => window.__resize.slice(-1)[0]);
  ok('🔴 进流程图时窗口既撑宽也撑高（图是按可用高度反算的，窗口矮＝图小）', () => {
    assert.ok(rq && rq.w >= 1100, '宽度没撑：' + JSON.stringify(rq));
    assert.ok(rq && rq.h >= 1200, '高度没撑：' + JSON.stringify(rq) + '（主进程会钳到这块屏的 workArea）');
  });
  /* 🔴 mock 的 flowResize 只记账、不真改窗口 —— 但真机进流程图时窗口是会撑宽的。
     不跟着改的话这套门永远在 460 宽的画布上量，而「撑满不滚」这条判据在窄画布下
     本来就该是滚的：门会去量一个现实中不存在的情形，量出来的绿或红都不作数。 */
  const wantW = await page.evaluate(() => (window.__resize.slice(-1)[0] || {}).w || 1400);
  await page.setViewport({ width: Math.max(1200, wantW), height: 900 });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await wait(700);

  /* 走线有没有压在卡片上：沿着 path 采样，看采到的点落不落进任何一张卡的矩形里。
     两头各留 10px 不算（线本来就是从卡片边上出发、到卡片边上结束的）。
     🔴 这条比「线画出来了」值钱得多 —— 上一版线是画出来了的，问题正是它从卡片身上压过去。 */
  const probeMap = () => page.evaluate(() => {
    const wrap = document.getElementById('mapWrap');
    const wb = wrap.getBoundingClientRect();
    const R = el => { const r = el.getBoundingClientRect(); return { x: r.left - wb.left + wrap.scrollLeft, y: r.top - wb.top + wrap.scrollTop, w: r.width, h: r.height }; };
    const cards = [...wrap.querySelectorAll('.mcard')];
    const rects = cards.map(c => R(c));
    let hits = 0;
    for (const p of wrap.querySelectorAll('svg.mconn .mline')) {
      const L = p.getTotalLength();
      for (let d = 10; d <= L - 10; d += 4) {
        const pt = p.getPointAtLength(d);
        /* 内缩 3px：线贴着卡片边走不算压卡，穿进去才算 */
        if (rects.some(r => pt.x > r.x + 3 && pt.x < r.x + r.w - 3 && pt.y > r.y + 3 && pt.y < r.y + r.h - 3)) { hits++; break; }
      }
    }
    const svg = wrap.querySelector('svg.mconn');
    return {
      kind: wrap.dataset.kind,
      dir: wrap.dataset.dir,
      k: +wrap.dataset.k,
      cols: [...wrap.querySelectorAll('.mcol')].map(c => c.querySelectorAll('.mcard').length),
      scrolls: wrap.classList.contains('scrolls'),
      overflowY: wrap.scrollHeight - wrap.clientHeight,
      overflowX: wrap.scrollWidth - wrap.clientWidth,
      fill: Math.round(wrap.querySelector('.mcards').getBoundingClientRect().height / wrap.clientHeight * 100),
      shotH: Math.round((cards[0].querySelector('.mcard-shot') || {}).getBoundingClientRect ? cards[0].querySelector('.mcard-shot').getBoundingClientRect().height : 0),
      crossing: hits,
      cards: cards.map(c => ({
        n: c.querySelector('.num').textContent.trim(),
        t: c.querySelector('.mcard-hd .t').textContent.trim(),
        view: c.classList.contains('v'),
        states: [...c.querySelectorAll('.nst')].length,
        tags: [...c.querySelectorAll('.mtag')].map(x => x.textContent.trim()),
      })),
      lines: wrap.querySelectorAll('svg.mconn .mline').length,
      fwd: +svg.dataset.fwd,
      svgH: +svg.getAttribute('height'),
      need: +svg.dataset.need,
      pathMaxY: Math.max(0, ...[...wrap.querySelectorAll('svg.mconn .mline')]
        .flatMap(p => { const L = p.getTotalLength(); const ys = []; for (let d = 0; d <= L; d += 6) ys.push(p.getPointAtLength(d).y); return ys; })),
      frames: wrap.querySelectorAll('.mcard-shot iframe').length,
      zIndex: getComputedStyle(svg).zIndex,
    };
  });
  const map = await probeMap();
  if (process.env.DBG) console.log(JSON.stringify(await page.evaluate(() => {
    const w = document.getElementById('mapWrap'), cs = w.querySelector('.mcards');
    return { wrapCW: w.clientWidth, wrapSW: w.scrollWidth, cardsW: cs.getBoundingClientRect().width,
      cols: [...w.querySelectorAll('.mcol')].map(c => Math.round(c.getBoundingClientRect().width)),
      card0: Math.round(w.querySelector('.mcard').getBoundingClientRect().width),
      k: w.dataset.k, pad: getComputedStyle(w).padding };
  }), null, 1));
  ok('流程：一屏一张卡，编号从 1 连续排（编号是两个人报「第几屏」的共同称呼）', () => {
    assert.ok(map.cards.length >= 4, JSON.stringify(map.cards.map(c => c.t)));
    assert.deepStrictEqual(map.cards.map(c => +c.n), map.cards.map((_, i) => i + 1));
  });
  ok('流程：编号顺序＝离入口的步数，入口永远是 1 号', () => {
    assert.strictEqual(map.cards[0].t, '搜索结果页', JSON.stringify(map.cards.map(c => c.t)));
  });
  ok('流程：谁都跳不到的页面挂「没人跳得到」的标，不是混在正常流程里', () => {
    const orphan = map.cards.find(c => c.t === '没人跳得到的页');
    assert.ok(orphan && orphan.tags.some(t => /没人跳得到/.test(t)), JSON.stringify(map.cards));
  });
  ok('流程：断链在卡片上看得见（不画到一个不存在的节点上去）', () => {
    const src = map.cards.find(c => c.tags.some(t => /断链/.test(t)));
    assert.ok(src, JSON.stringify(map.cards.map(c => c.tags)));
  });
  ok('流程：状态不占卡片，是挂在卡片下面的按钮（11 个态混成 11 张卡就是一团毛线）', () => {
    assert.ok(map.cards.every(c => c.states >= 1), JSON.stringify(map.cards));
    assert.ok(map.cards.length < 8, '卡片数应该是屏数不是态数：' + map.cards.length);
  });
  ok('🔴 流程：连线真的画出来了（画不出来这个视图就退化成一堆没关系的卡片）', () => {
    assert.ok(map.lines >= 3, '只画出 ' + map.lines + ' 条线');
  });
  /* 🔴 走线的通道画在卡片**下面**，而 scrollHeight 只算到卡片底 ——
     不主动腾地方的话，横着走的那一整段会被 svg 的 width/height 裁掉，
     屏幕上只剩几根垂下来的短竖线，看着像「线画歪了」，其实是画布不够高。
     2026-09-18 实测踩过：画布 263，通道在 265/276/287，三条线的横段全没了。
     `overflow:visible` 救不了 —— 外层 <svg> 的裁剪由 width/height 决定。 */
  ok('🔴 画布装得下所有走线（不够高的话横向那段会被静默裁掉，看起来像线画歪了）', () => {
    assert.ok(map.svgH >= map.need, `画布 ${map.svgH} < 需要 ${map.need}`);
    assert.ok(map.svgH >= map.pathMaxY, `画布 ${map.svgH} < 走线最低点 ${map.pathMaxY}`);
  });
  ok('🔴 连线那层在卡片底下（盖在上面会挡住缩略图、还会把点击吃掉）', () => {
    assert.strictEqual(map.zIndex, '0');
  });
  ok('流程：每张卡都有真缩略图的位置（认屏靠图，不靠名字）', () => {
    assert.strictEqual(map.frames, map.cards.length);
  });
  /* ── 这一版新加的四条（吉吉 2026-09-18「所有线都绕在一起」「不要滚动直接撑满」「高度太低」）── */
  ok('🔴 这个料是分层形状（有回头边、有分叉），所以摆成按步数分的多列', () => {
    assert.strictEqual(map.kind, 'layered', '认成了 ' + map.kind);
    assert.ok(map.cols.length >= 3, JSON.stringify(map.cols));
  });
  ok('🔴 撑满：装得下就不滚（吉吉「流程图区域可以不要滚动，直接撑满就行」）', () => {
    assert.strictEqual(map.scrolls, false, `还在滚：纵 ${map.overflowY} 横 ${map.overflowX}`);
    assert.ok(map.overflowY <= 1 && map.overflowX <= 1, `纵 ${map.overflowY} 横 ${map.overflowX}`);
  });
  ok('🔴 撑满：缩略图按可用空间反算，不是写死的一档小尺寸（「现在的高度太低了」）', () => {
    assert.ok(map.k > 0.18, '缩放 ' + map.k + ' 没比上一版写死的 0.18 大，等于没撑满');
    assert.ok(map.shotH >= 170, '缩略图只有 ' + map.shotH + 'px 高');
    assert.ok(map.fill >= 55, '图只占了这块地方的 ' + map.fill + '%');
  });
  ok('🔴 走线不从卡片身上压过去（上一版线是画出来了，问题正是它穿卡）', () => {
    assert.strictEqual(map.crossing, 0, map.crossing + ' 条线压在卡片上');
  });

  /* ── 形状矩阵：换任何一种形状的项目，都得画得出一张适配的图 ────────────────
     吉吉 2026-09-18：「我们要确保以后做不同项目，也要能画出适配的流线图」。
     🔴 这件事不能靠「我觉得 planLayout 写得够通用」—— 靠自觉的东西迟早会破，
        而且破了没人看得见（画歪一点点，人只会觉得「这图有点乱」，不会来报 bug）。
     下面每一行是一种真会碰到的形状：造成真文件 → 真扫描 → 真渲染 → 真量。
     每一种都要同时满足：形状认对 / 编号连续 / 线不穿卡 / 画布装得下走线 /
     装得下就不滚 / 缩略图不低于认得出的下限。
     🔴 以后碰到画不好的形状，往这张表里**加一行**，别在代码里补一个 if。 */
  const mkProj = files => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uwshape-'));
    for (const f of files) fs.writeFileSync(path.join(dir, f.name), pg(f.title, (f.font ? FONT_CSS : '') + (f.css || ''), f.body || '', f.cls));
    const D = { ok: true, ...flow.scan(dir) };
    const P = D.pages.map(p => ({ rel: p.rel, html: walk.prep(fs.readFileSync(path.join(dir, p.rel), 'utf8'), p.rel) }));
    return { D, P };
  };
  const view = (k, n, sel) => `/* @视图 ${k} ${n} · 点一下打开 · ${sel} */\nbody.state-${k}-open .dw{display:block}\n`;
  const link = (t, to) => `<a class="btn" href="${to}">${t}</a>`;
  const opener = k => `<button class="btn" data-open="${k}">开${k}</button>`;

  const SHAPES = [
    { why: 'PPC 的真形状：一个后台页开三个抽屉 —— 不是四步，是一步的三个去处',
      kind: 'hub', dir: 'v', cols: [1, 3], allFwd: true,
      files: [{ name: 'index.html', title: 'MIC VO后台 · 精点投', font: true, cls: 'state-running',
        css: view('forecast', '广告预测', '.btn[data-open="forecast"]') + view('diagnose', '营销诊断', '.btn[data-open="diagnose"]') +
             view('report', '数据分析', '.btn[data-open="report"]') + '/* @态 running 有投放中的计划 · 账户有在跑的计划 */\nbody.state-running .p{display:block}\nbody.state-never .p{display:none}\n',
        body: opener('forecast') + opener('diagnose') + opener('report') + '<div class="p">计划</div><div class="dw">抽屉</div>' }] },

    { why: '一条路走到底（搜索 → 详情 → 询盘）：横着排一行，边是相邻两张之间的短横线',
      kind: 'chain', dir: 'h', cols: [1, 1, 1], allFwd: true,
      files: [{ name: 'index.html', title: '搜索结果', font: true, body: link('看详情', 'a.html') },
              { name: 'a.html', title: '产品详情', body: link('发询盘', 'b.html') },
              { name: 'b.html', title: '询盘表单', body: '<input>' }] },

    { why: '两个页面各带两个抽屉（多页多抽屉的常见形状）：按离入口的步数分列',
      kind: 'layered', dir: 'h',
      files: [{ name: 'index.html', title: '列表页',
                css: view('filter', '筛选', '.btn[data-open="filter"]') + view('sort', '排序', '.btn[data-open="sort"]'),
                body: opener('filter') + opener('sort') + link('去详情', 'a.html') + '<div class="dw">抽屉</div>' },
              { name: 'a.html', title: '详情页',
                css: view('spec', '规格', '.btn[data-open="spec"]') + view('ship', '物流', '.btn[data-open="ship"]'),
                body: opener('spec') + opener('ship') + '<div class="dw">抽屉</div>' }] },

    { why: '六页长链（走查一条长流程时会出现）：列多了也不许穿卡，缩到下限之前不许滚',
      kind: 'chain', dir: 'h',
      files: Array.from({ length: 6 }, (_, i) => ({
        name: i ? 's' + i + '.html' : 'index.html', title: '第' + (i + 1) + '步',
        body: i < 5 ? link('下一步', 's' + (i + 1) + '.html') : '<p>完</p>' })) },

    { why: '一页开五个抽屉（抽屉多到一排排不下时，别让它挤成一团）',
      kind: 'hub', dir: 'v', allFwd: true,
      files: [{ name: 'index.html', title: '工作台',
        css: [1, 2, 3, 4, 5].map(i => view('d' + i, '抽屉' + i, '.btn[data-open="d' + i + '"]')).join(''),
        body: [1, 2, 3, 4, 5].map(i => opener('d' + i)).join('') + '<div class="dw">抽屉</div>' }] },

    { why: '两个页面谁也跳不到谁（半成品常见）：没有边也得画得出，不能白屏或报错',
      kind: 'chain', dir: 'h', noEdges: true,
      files: [{ name: 'index.html', title: '页甲', body: '<p>甲</p>' },
              { name: 'b.html', title: '页乙', body: '<p>乙</p>' }] },
  ];

  for (const c of SHAPES) {
    const { D, P } = mkProj(c.files);
    await page.evaluate((d, p) => { window.__D = d; window.__P = p; }, D, P);
    await page.click('#btnScan'); await wait(800);
    const m = await probeMap();
    ok(`🔴 形状矩阵 · ${c.why}`, () => {
      assert.strictEqual(m.kind, c.kind, `认成了 ${m.kind}（卡片：${JSON.stringify(m.cards.map(x => x.t))}）`);
      assert.strictEqual(m.dir, c.dir, `方向是 ${m.dir}，应该是 ${c.dir}`);
      if (c.cols) assert.deepStrictEqual(m.cols, c.cols, '分段成了 ' + JSON.stringify(m.cols));
      /* 编号是两个人报「第几屏」的共同称呼，DOM 顺序必须跟它一致 */
      assert.deepStrictEqual(m.cards.map(x => +x.n), m.cards.map((_, i) => i + 1), '编号乱了：' + JSON.stringify(m.cards.map(x => x.n)));
      assert.strictEqual(m.crossing, 0, m.crossing + ' 条线压在卡片上');
      assert.ok(m.svgH >= m.need, `画布 ${m.svgH} < 需要 ${m.need}`);
      assert.ok(m.svgH >= Math.floor(m.pathMaxY), `画布 ${m.svgH} < 走线最低点 ${m.pathMaxY}`);
      assert.strictEqual(m.scrolls, false, `还在滚：纵 ${m.overflowY} 横 ${m.overflowX}`);
      assert.ok(m.k >= 0.085, '缩到 ' + m.k + '，缩略图已经认不出是哪一屏');
      if (c.noEdges) assert.strictEqual(m.lines, 0, '没有跳转却画出了 ' + m.lines + ' 条线');
      else assert.ok(m.lines >= 1, '一条线都没画出来');
      /* 分叉形状的全部意思就是「一条都不往底下绕」——绕了就是吉吉说的那团毛线 */
      if (c.allFwd) assert.strictEqual(m.fwd, m.lines, `${m.lines} 条里只有 ${m.fwd} 条走段间主干，其余绕到了底下`);
    });
  }

  /* 换回原来那份料，后面的剧本/检查/展示模式几节验的是它 */
  await page.evaluate((D, P) => { window.__D = D; window.__P = P; }, DATA, PAGES);
  await page.click('#btnScan'); await wait(900);

  /* ── 剧本 ────────────────────────── */
  await page.click('#tabs button[data-v="script"]'); await wait(150);
  const sc = await page.evaluate(() => ({
    names: [...document.querySelectorAll('.sc-h .n')].map(x => x.textContent.trim()),
    steps: [...document.querySelectorAll('.sc')[0].querySelectorAll('.sc-steps li')].map(li => li.querySelector('.p').textContent.trim()),
  }));
  ok('剧本：一个二级标题一条主线，步骤按顺序列出来', () => {
    assert.deepStrictEqual(sc.names, ['买家从搜索到发询盘', '出错的样子']);
    assert.strictEqual(sc.steps.length, 3);
    assert.ok(/inquiry\.html · guest/.test(sc.steps[2]), sc.steps[2]);
  });
  await page.evaluate(() => { window.__goto = []; document.querySelector('.sc-steps li[data-step="1"]').click(); });
  await wait(150);
  const g2 = await page.evaluate(() => window.__goto.slice(-1)[0]);
  ok('剧本：点某一步 = 直接去那一步', () => assert.deepStrictEqual(g2, { id: 'p', rel: 'detail.html', state: 'default', on: [] }));

  /* ── 展示模式 ────────────────────────── */
  /* 上面点过剧本第 2 步，S.play 已经停在那儿——进展示模式会正确地从那儿接着走。
     这里要验的是「从头开始」那条路，所以先清掉进度（这是测试的前置条件，不是产品行为） */
  await page.evaluate(() => { window.__goto = []; S.play = null; });
  await page.click('#btnShow'); await wait(200);
  const show1 = await page.evaluate(() => ({ hidden: document.getElementById('player').hidden, calls: window.__goto.slice() }));
  ok('展示模式：控制台只剩剧本播放条，并让主窗口把画布腾干净', () => {
    assert.strictEqual(show1.hidden, false);
    assert.ok(show1.calls.some(c => c.show === true), JSON.stringify(show1.calls));
  });
  const p0 = await page.evaluate(() => ({ at: document.getElementById('plAt').textContent.trim(), prev: document.getElementById('plPrev').disabled }));
  ok('展示模式：还没开始时上一步是灰的（第一步之前没有东西可退）', () => { assert.strictEqual(p0.at, '—'); assert.strictEqual(p0.prev, true); });

  await page.click('#plNext'); await wait(200);
  const p1 = await page.evaluate(() => ({ at: document.getElementById('plAt').textContent.trim(), note: document.getElementById('plNote').textContent.trim(), goto: window.__goto.slice(-1)[0] }));
  ok('展示模式：下一步 = 走到第 1 步，页面跟着跳，屏上写这一步在干什么', () => {
    assert.strictEqual(p1.at, '1 / 3');
    assert.strictEqual(p1.note, '搜 led');
    assert.deepStrictEqual(p1.goto, { id: 'p', rel: 'index.html', state: 'default', on: [] });
  });
  await page.click('#plNext'); await page.click('#plNext'); await wait(250);
  const p3 = await page.evaluate(() => ({ at: document.getElementById('plAt').textContent.trim(), next: document.getElementById('plNext').disabled, goto: window.__goto.slice(-1)[0] }));
  ok('展示模式：走到最后一步，下一步变灰（别让人点空）', () => {
    assert.strictEqual(p3.at, '3 / 3');
    assert.strictEqual(p3.next, true);
    assert.deepStrictEqual(p3.goto, { id: 'p', rel: 'inquiry.html', state: 'guest', on: [] });
  });
  await page.keyboard.press('ArrowLeft'); await wait(200);
  const p2 = await page.evaluate(() => document.getElementById('plAt').textContent.trim());
  ok('展示模式：方向键也能翻（演示时手不用离开键盘）', () => assert.strictEqual(p2, '2 / 3'));

  /* ── 自动走（吉吉 2026-09-18「开了自动化后，AI 能自动带我体验全部流程」）────────── */
  /* 把节奏调到测试能等得起的档：往 select 里塞一个临时 option，不动产品代码。
     这条顺带验了「速度档真的改了节奏」—— 选了没用是这类控件最常见的坏法。 */
  /* 🔴 先把前提摆明：上面几条门走到了第 1 条剧本的第 2 步。
     不声明前提就写「自动走应该走 >=4 步」，红的时候分不清是功能坏了还是前提变了 ——
     第一版就是这么红的（它只走了 2 步，而那 2 步完全正确）。 */
  await page.click('#plPrev'); await wait(150);          // 退到 1/3，从这条剧本的头上开始
  await page.evaluate(() => {
    window.__goto = [];
    const sel = document.getElementById('plSpeed');
    sel.insertAdjacentHTML('beforeend', '<option value="150">t</option>');
    sel.value = '150'; sel.dispatchEvent(new Event('change'));
  });
  await page.click('#plAuto'); await wait(2600);
  const au = await page.evaluate(() => ({
    label: document.getElementById('plAuto').textContent.trim(),
    on: document.getElementById('plAuto').classList.contains('on'),
    tail: document.getElementById('plAutoAt').textContent.trim(),
    at: document.getElementById('plAt').textContent.trim(),
    rels: window.__goto.map(g => g.rel),
    last: (g => g && { rel: g.rel, state: g.state })(window.__goto.filter(x => x.rel).slice(-1)[0]),
    ids: [...new Set(window.__goto.map(g => g.id))],
  }));
  ok('🔴 自动走：开了之后自己一步步往下走，不用人点', () => {
    assert.ok(au.rels.length >= 3, '只走了 ' + au.rels.length + ' 步：' + JSON.stringify(au.rels));
  });
  ok('🔴 自动走：一条剧本走完接下一条（「全部流程」＝所有剧本，不是当前这条）', () => {
    /* 🔴 用**落到哪儿**判，不用走了几步判：步数会跟着前提变（从第几步开的自动），
       而「最后停在第二条剧本上」是这件事本身的指纹，前提怎么变它都成立。
       第一条剧本是 index→detail→inquiry，第二条只有 index·empty ——
       落在 index.html·empty 上，才说明它接着走了第二条。 */
    assert.deepStrictEqual(au.last, { rel: 'index.html', state: 'empty' },
      '没接上第二条剧本，停在了 ' + JSON.stringify(au.last) + '；整条路径：' + JSON.stringify(au.rels));
    assert.strictEqual(au.tail, '全部走完了', '走完了却没说一声：「' + au.tail + '」');
    assert.strictEqual(au.on, false, '全部走完之后按钮还停在「自动走中」');
    assert.strictEqual(au.label, '▶ 自动走');
  });
  ok('🔴 自动走：每一步的指令照样带项目 id（自动走也可能从首页开始）', () => {
    assert.deepStrictEqual(au.ids, ['p'], JSON.stringify(au.ids));
  });

  /* 人一动手就停：自动走时点一下「上一步」，之后页面不许再自己翻 */
  await page.evaluate(() => { window.__goto = []; });
  await page.click('#plAuto'); await wait(400);
  await page.click('#plPrev');
  const n1 = await page.evaluate(() => window.__goto.length);
  await wait(1200);
  const stop = await page.evaluate(() => ({ n: window.__goto.length, on: document.getElementById('plAuto').classList.contains('on') }));
  ok('🔴 自动走：人一动手就停（他要停下来看这一屏，自动走会在他看的时候把页面翻掉）', () => {
    assert.strictEqual(stop.on, false, '点了「上一步」之后自动还开着');
    assert.strictEqual(stop.n, n1, `停不下来：点完是 ${n1} 条指令，1.2 秒后变成 ${stop.n} 条`);
  });
  /* 剧本那一屏也能直接开自动（不用先进展示模式再点一次） */
  await page.keyboard.press('Escape'); await wait(150);
  await page.click('#tabs button[data-v="script"]'); await wait(200);
  await page.evaluate(() => { window.__goto = []; });
  await page.click('.sc [data-autoplay]'); await wait(900);
  const sa = await page.evaluate(() => ({
    player: !document.getElementById('player').hidden,
    on: document.getElementById('plAuto').classList.contains('on'),
    n: window.__goto.filter(g => g.rel).length,
  }));
  ok('🔴 剧本那一屏点「自动走」＝直接进展示模式并开始走', () => {
    assert.strictEqual(sa.player, true, '没进展示模式');
    assert.ok(sa.on || sa.n >= 2, `自动没开起来（on=${sa.on} 走了 ${sa.n} 步）`);
  });
  await page.evaluate(() => { document.getElementById('plAuto').classList.contains('on') && document.getElementById('plAuto').click(); });
  await page.keyboard.press('Escape'); await wait(150);
  await page.keyboard.press('Escape'); await wait(200);
  const off = await page.evaluate(() => ({ hidden: document.getElementById('player').hidden, calls: window.__goto.filter(c => c.show === false) }));
  ok('展示模式：Esc 退出，并让主窗口把对话区放回来', () => { assert.strictEqual(off.hidden, true); assert.strictEqual(off.calls.length, 1); });

  /* ── 检查 ────────────────────────── */
  await page.click('#tabs button[data-v="gate"]'); await wait(150);
  const gate = await page.evaluate(() => ({
    sum: document.querySelector('.gate-sum').textContent.replace(/\s+/g, ' ').trim(),
    bad: [...document.querySelectorAll('.iss.bad .p')].map(x => x.textContent.replace(/\s+/g, ' ').trim()),
    warn: [...document.querySelectorAll('.iss.warn .p')].map(x => x.textContent.replace(/\s+/g, ' ').trim()),
    tabN: document.getElementById('gateN').textContent.trim(),
  }));
  ok('检查：硬伤和「看一眼」分开数，硬伤数挂在标签上', () => {
    assert.ok(/条硬伤/.test(gate.sum), gate.sum);
    assert.ok(gate.bad.some(x => /断链/.test(x)), JSON.stringify(gate.bad));
    assert.ok(gate.warn.some(x => /没人跳得到/.test(x)), JSON.stringify(gate.warn));
    assert.ok(+gate.tabN >= 1, gate.tabN);
  });
  /* 只看门的名字那一段。整行里还有页面文件名，而 orphan.html 这种名字本身就含 'orphan'——
     拿整行做断言会假红（第一版就是这么红的，判据错和真问题长得一模一样） */
  const gateNames = gate.bad.concat(gate.warn).map(x => x.split(/\s+/).slice(1).join(' '));
  ok('检查：门的名字是人话，不是代号（deadlink 这种词读者要停下来猜）', () => {
    assert.ok(gateNames.every(n => n && !/^[a-z-]+$/.test(n)), JSON.stringify(gateNames));
  });
  await page.evaluate(() => { window.__goto = []; document.querySelector('.iss.bad .t button').click(); });
  await wait(150);
  const g3 = await page.evaluate(() => window.__goto.slice(-1)[0]);
  ok('检查：点一条问题 = 去那一页看（报了问题却不给路，人还得自己找）', () => assert.strictEqual(g3.rel, 'index.html'));

  /* ── 空项目不能白屏 ────────────────────────── */
  await page.evaluate(() => { uw.flowScan = async () => ({ ok: true, at: Date.now(), entry: '', pages: [], issues: [], scripts: [], scriptFile: '剧本.md', n: { pages: 0, states: 0, bad: 0, warn: 0 } }); });
  await page.click('#btnScan'); await wait(250);
  const empties = await page.evaluate(() => {
    const out = {};
    for (const v of ['grid', 'map', 'script', 'gate']) {
      document.querySelector(`#tabs button[data-v="${v}"]`).click();
      const el = document.querySelector('.view:not([hidden])');
      out[v] = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    }
    return out;
  });
  ok('空项目：四个视图都给人话，不白屏（白屏时人分不清是没数据还是坏了）', () => {
    for (const [v, t] of Object.entries(empties)) assert.ok(t.length > 6, v + ' 是空的：「' + t + '」');
  });

  /* 导出走查包：展示模式是「我自己驱动着演示」，走查包是「对方自己点」，两件事 */
  await page.evaluate(() => { window.__walk = 0; window.__walkResp = { ok: true, file: '_走查.html', bytes: 20480, pages: 4, bad: 0 }; });
  await page.click('#btnWalk'); await wait(300);
  const w1 = await page.evaluate(() => ({ n: window.__walk, sub: document.getElementById('projSub').textContent, dis: document.getElementById('btnWalk').disabled }));
  ok('导出走查包：导完在副标题上说清导到哪、多大、几页，按钮解锁', () => {
    assert.strictEqual(w1.n, 1);
    assert.ok(/_走查\.html/.test(w1.sub) && /20KB/.test(w1.sub) && /4 页/.test(w1.sub), w1.sub);
    assert.strictEqual(w1.dis, false);
  });
  await page.evaluate(() => { window.__walkResp = { ok: true, file: '_走查.html', bytes: 20480, pages: 4, bad: 3 }; });
  await page.click('#btnWalk'); await wait(300);
  const w2 = await page.evaluate(() => document.getElementById('projSub').textContent);
  ok('🔴 有硬伤也照导，但要说一声——发出去之前他该知道对方会点到什么', () => assert.ok(/3 条硬伤/.test(w2), w2));
  await page.evaluate(() => { window.__walkResp = { ok: false, error: '只有一页，用不着走查包；直接把那个 html 发给对方就行。' }; });
  await page.click('#btnWalk'); await wait(300);
  const w3 = await page.evaluate(() => document.getElementById('projSub').textContent);
  ok('导不出来时给的是人话，不是错误码', () => assert.ok(/只有一页/.test(w3), w3));

  ok('全程没有页面报错', () => assert.deepStrictEqual(errors, []));
  await page.screenshot({ path: path.join(os.tmpdir(), 'uw-flow-shot.png'), fullPage: true });
  console.log(`\n${pass}项通过 · 截图 ${path.join(os.tmpdir(), 'uw-flow-shot.png')}`);
  await browser.close();
})().catch(e => { console.error('💥', e); process.exit(1); });
