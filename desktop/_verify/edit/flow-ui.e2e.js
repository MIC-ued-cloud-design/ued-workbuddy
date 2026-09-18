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
    window.uw = {
      flowScan: async () => { window.__scans++; return DATA; },
      flowGoto: async (m) => { window.__goto.push(m); return { ok: true }; },
      flowWalk: async () => { window.__walk++; return window.__walkResp; },
      flowHtml: async ({ rels }) => ({ ok: true, pages: PAGES.filter(p => rels.includes(p.rel)) }),
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
  ok('对照表：点一个格子 = 去那一页的那个态（指令里带上当前叠加开关）', () => assert.deepStrictEqual(g1, { rel: 'index.html', state: 'guest', on: [] }));
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
  ok('铺开：点一张 = 去主窗口沉浸看那一态', () => assert.deepStrictEqual(wg, { rel: 'index.html', state: 'empty', on: [] }));

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
  await page.click('#tabs button[data-v="map"]'); await wait(500);
  const map = await page.evaluate(() => ({
    cards: [...document.querySelectorAll('.mcard')].map(c => ({
      n: c.querySelector('.num').textContent.trim(),
      t: c.querySelector('.mcard-hd .t').textContent.trim(),
      view: c.classList.contains('v'),
      states: [...c.querySelectorAll('.nst')].length,
      tags: [...c.querySelectorAll('.mtag')].map(x => x.textContent.trim()),
    })),
    lines: document.querySelectorAll('svg.mconn .mline').length,
    svgH: +document.querySelector('svg.mconn').getAttribute('height'),
    need: +document.querySelector('svg.mconn').dataset.need,
    pathMaxY: Math.max(0, ...[...document.querySelectorAll('svg.mconn .mline')]
      .flatMap(p => (p.getAttribute('d').match(/[\d.]+(?=\s|$|,)/g) || []))
      .map(Number).filter((_, i) => i % 2 === 1)),
    frames: document.querySelectorAll('.mcard-shot iframe').length,
    zIndex: getComputedStyle(document.querySelector('svg.mconn')).zIndex,
  }));
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
  ok('剧本：点某一步 = 直接去那一步', () => assert.deepStrictEqual(g2, { rel: 'detail.html', state: 'default', on: [] }));

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
    assert.deepStrictEqual(p1.goto, { rel: 'index.html', state: 'default', on: [] });
  });
  await page.click('#plNext'); await page.click('#plNext'); await wait(250);
  const p3 = await page.evaluate(() => ({ at: document.getElementById('plAt').textContent.trim(), next: document.getElementById('plNext').disabled, goto: window.__goto.slice(-1)[0] }));
  ok('展示模式：走到最后一步，下一步变灰（别让人点空）', () => {
    assert.strictEqual(p3.at, '3 / 3');
    assert.strictEqual(p3.next, true);
    assert.deepStrictEqual(p3.goto, { rel: 'inquiry.html', state: 'guest', on: [] });
  });
  await page.keyboard.press('ArrowLeft'); await wait(200);
  const p2 = await page.evaluate(() => document.getElementById('plAt').textContent.trim());
  ok('展示模式：方向键也能翻（演示时手不用离开键盘）', () => assert.strictEqual(p2, '2 / 3'));
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
