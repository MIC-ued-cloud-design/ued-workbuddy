/* 角色层探针：设计 / 产品 / 前端 三个角色 + 能力卡进「+」菜单。
   量的是「人能不能用上」，不是「代码在不在」——
   这个项目栽过八次「探针报绿肉眼看红」，所以：
     · 一律在默认态量（不 hover、不预先点开）
     · 可见性看 getBoundingClientRect，不看 hidden 属性
     · 交互项必须有 onclick，光渲染出来不算数
   跑法：node _verify/roles.js out */
const pp = require('/Users/wanglixiang/.claude/skills/mic-fullstack/scripts/online-reach/node_modules/puppeteer-core');
const OUT = process.argv[2] || 'out';
const PAGE = 'file://' + encodeURI('/Users/wanglixiang/Desktop/UED workbuddy/index.html');
let red = 0;
const ok = (c, t, d) => { console.log((c ? '  ✅ ' : '  ❌ ') + t + (d ? ' — ' + d : '')); if (!c) red++; };
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const b = await pp.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'],
    defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 } });
  const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(PAGE, { waitUntil: 'networkidle0' });

  const vis = s => p.evaluate(s2 => { const e = document.querySelector(s2);
    if (!e) return null; const r = e.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) }; }, s);

  console.log('\n1 角色条（默认态）');
  const roles = await p.evaluate(() => [...document.querySelectorAll('.roles button')]
    .map(e => ({ n: e.textContent.trim(), on: e.classList.contains('on'),
                 vis: e.getBoundingClientRect().width > 0 })));
  /* 🔴 角色数不写死在这儿：正本是 desktop/packs/capabilities.json，
     2026-09-16 吉吉定「网页版也去掉前端角色」跟客户端对齐，就是改那个 json。
     这里跟着页面自己的数据比，json 改了这道门不会假红，
     但少于两个角色（角色层整个没渲染出来）仍然要红。 */
  const want = await p.evaluate(() => ['设计'].concat((window.WBROLES.roles || []).map(r => r.n)));
  ok(roles.map(r => r.n).join() === want.join(), '角色跟 capabilities.json 对得上',
     '页面 ' + roles.map(r => r.n).join(' / ') + '  ·  数据 ' + want.join(' / '));
  ok(roles.length >= 2, '角色层渲染出来了', roles.length + ' 个');
  ok(roles.every(r => r.vis), '每个都真的看得见');
  ok(roles[0] && roles[0].on && roles[0].n === '设计', '默认停在「设计」');

  console.log('\n2 两层长得不一样（治「分不出谁管谁」）');
  const look = await p.evaluate(() => {
    const rb = document.querySelector('.roles button.on'), tw = document.querySelector('.tabs');
    if (!rb || !tw) return null;
    const rs = getComputedStyle(rb), ts = getComputedStyle(tw);
    return { roleBg: rs.backgroundColor, roleRadius: rs.borderRadius,
             tabsBg: ts.backgroundColor, tabsRadius: ts.borderRadius,
             roleUnderline: getComputedStyle(rb, '::after').height };
  });
  const trans = c => /rgba\(0, 0, 0, 0\)|transparent/.test(c);
  ok(look && trans(look.roleBg), '选中的角色没有底色胶囊', look && look.roleBg);
  ok(look && !trans(look.tabsBg), '六类仍是灰轨分段控件', look && look.tabsBg);
  ok(look && look.roleUnderline === '2px', '选中的角色有下划线', look && look.roleUnderline);

  console.log('\n3 切到「产品」');
  await p.evaluate(() => [...document.querySelectorAll('.roles button')].find(e => e.textContent.trim() === '产品').click());
  await new Promise(r => setTimeout(r, 120));
  ok(!(await vis('.tabs')), '六类分段控件收起来了（产品不分阶段）');
  let cards = await p.evaluate(() => [...document.querySelectorAll('.pill')].map(e => e.textContent.replace(/↘/g, '').trim()));
  ok(cards.length === 3, '产品是 3 张卡', cards.join(' / '));
  ok(cards.join() === ['写 PRD', '拷问这个方案', '拆成任务单'].join(), '卡名跟桌面版对得上', cards.join(' / '));

  console.log('\n4 说明行');
  const note = await p.evaluate(() => (document.querySelector('.scene-note') || {}).textContent || '');
  ok(note.length > 8, '产品角色有说明行', note.slice(0, 46));

  console.log('\n5 点一张卡 → 输入框被填上');
  await p.evaluate(() => document.querySelector('.pill').click());
  await wait(120);
  const ta = await p.evaluate(() => document.getElementById('ta').value);
  ok(ta.length > 10, '模板文案填进去了', ta.split('\n')[0].slice(0, 32));
  ok(!(await p.evaluate(() => document.getElementById('send').disabled)), '发送按钮可点');

  console.log('\n6 该走终端的活，发送时先问「交给谁做」');
  /* 🔴 用能力卡来验这条路，不用场景卡。
     2026-09-16 去掉前端角色之后，场景卡里已经没有 need:'term' 的了
     （要终端的三张都在前端角色下），拿场景卡验会红 —— 那是产品变了不是坏了。
     能力卡（拷问方案 / CE 那几个）一律走终端，这条分流的活样本现在只剩它们。 */
  await p.evaluate(() => {
    const a = (window.WBROLES.abilities || [])[0];
    window.useAbility(a.id);
    S.text = '这是一段用来验分流的输入，够长才点得动发送。';
    document.getElementById('ta').value = S.text;
  });
  await wait(150);
  await p.evaluate(() => document.getElementById('send').click());
  await wait(500);
  const chooser = await p.evaluate(() => {
    const m = document.getElementById('uwtMask');
    if (!m) return { on: false, why: '没有 uwtMask' };
    return { on: m.classList.contains('uwt-on') && m.getBoundingClientRect().width > 0,
             title: (document.querySelector('#uwtBox h3') || {}).textContent || '',
             opts: [...document.querySelectorAll('#uwtBox .uwt-opt')].length };
  });
  ok(chooser.on, '弹出了「交给谁做」', chooser.title);
  ok(chooser.opts >= 3, '给了几条路可选', chooser.opts + ' 条');
  /* 🔴 别拍一个字数阈值：能力卡的提示词本来就比场景卡短，我第一版写 >200 就假红了。
     跟数据里的真值比 —— 带过去的必须是那张卡自己的提示词（{{input}} 已替换掉），
     而不是输入框里那几个字。 */
  const carried = await p.evaluate(() => {
    const a = (window.WBROLES.abilities || [])[0];
    const got = (window.UWT && UWT.payload && UWT.payload.prompt) || '';
    const head = a.prompt.split('{{input}}')[0].slice(0, 30);
    return { len: got.length, want: a.prompt.length, hasHead: got.indexOf(head) >= 0,
             noPlaceholder: got.indexOf('{{input}}') < 0, hasInput: got.indexOf('验分流') >= 0 };
  });
  ok(carried.hasHead, '带过去的是那张卡自己的提示词', carried.len + ' 字（模板 ' + carried.want + '）');
  ok(carried.noPlaceholder && carried.hasInput, '{{input}} 已经换成我写的内容');

  console.log('\n7 能力卡进了「+」菜单');
  /* 🔴 重新载入再量：上一节开过「交给谁做」的弹层，它盖在页面上，
     带着残留去点「+」会点到遮罩上、然后得出「菜单里没这一组」这种假红。
     每一节从干净态起，比在脏状态里猜哪儿被挡住便宜。 */
  await p.goto(PAGE, { waitUntil: 'networkidle0' });
  /* 🔴 量真 DOM，不量 window.PLUS_MENU —— 那是脚本作用域的 const，页面上根本取不到，
     照着它量只会得出「没有」这种假红。菜单是二级的：先看那一行在默认态露没露头，再 hover 展开看条目。 */
  await p.click('.plusw .plus');
  await new Promise(r => setTimeout(r, 200));
  const row = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('.ppop .pitem')];
    const hit = rows.find(e => /能力/.test(e.textContent));
    if (!hit) return { found: false, rows: rows.map(e => e.querySelector('.row').textContent.trim()) };
    const r = hit.querySelector('.row').getBoundingClientRect();
    return { found: true, vis: r.width > 0 && r.height > 0 };
  });
  ok(row.found, '「+」菜单里有「能力」这一行', row.found ? '' : '只有：' + (row.rows || []).join(' / '));
  ok(row.found && row.vis, '这一行默认态就看得见（不用先 hover 才知道有）');
  if (row.found) {
    await p.evaluate(() => [...document.querySelectorAll('.ppop .pitem')].find(e => /能力/.test(e.textContent)).querySelector('.row').dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    await p.hover('.ppop .pitem:nth-child(1) .row').catch(() => {});
    const abi = await p.evaluate(() => {
      const it = [...document.querySelectorAll('.ppop .pitem')].find(e => /能力/.test(e.textContent));
      const rows = [...it.querySelectorAll('.ppop2 .p2row')];
      return { n: rows.length, names: rows.map(e => (e.querySelector('.n') || {}).textContent || ''),
               全都能点: rows.length > 0 && rows.every(e => !!e.getAttribute('onclick')) };
    });
    ok(abi.n === 6, '6 张能力卡都在', abi.names.join(' / '));
    ok(abi.全都能点, '每一张都真的能点（不是摆着看的）');
  }

  console.log('\n8 JS 错误');
  ok(errs.length === 0, '没有 JS 报错', errs.join(' | '));

  /* 🔴 拍照前显式切到该拍的那个角色再拍。
     上一版是在末尾连拍两张，而第 7 节重新载入已经把角色打回「设计」——
     文件名叫 roles-frontend.png、画面上却是设计页，照着它走查等于验了个没看过的东西。 */
  const shoot = async (role, file) => {
    await p.evaluate(r => [...document.querySelectorAll('.roles button')]
      .find(e => e.textContent.trim() === r).click(), role);
    await new Promise(r => setTimeout(r, 180));
    const now = await p.evaluate(() => (document.querySelector('.roles button.on') || {}).textContent || '');
    ok(now.trim() === role, '拍 ' + file + ' 时确实停在「' + role + '」', '实际在「' + now.trim() + '」');
    await p.screenshot({ path: OUT + '/' + file });
  };
  console.log('\n9 卡片不折行（1440 宽下每组都在一行）');
  /* 🔴 折行不报错、也不难看到，但它是「名字起长了」的唯一信号。
     2026-09-15 吉吉指出制作 Demo 那组折成两行 —— 把卡名改短就好了，
     可下次再加一张长名字的卡，同样的事会再发生一遍。所以做成断言。 */
  await p.evaluate(() => [...document.querySelectorAll('.roles button')]
    .find(e => e.textContent.trim() === '设计').click());
  await wait(200);
  for (const g of ['前期调研', '设计稿', '制作 Demo', '交付验收', '走查复盘', '运营专项']) {
    await p.evaluate(x => [...document.querySelectorAll('.tabs button')]
      .find(e => e.textContent.trim() === x).click(), g);
    await wait(150);
    const r = await p.evaluate(() => {
      const ps = [...document.querySelectorAll('.pill')].map(e => e.getBoundingClientRect());
      const tops = ps.map(b => b.top), h = ps[0] ? ps[0].height : 0;
      /* 🔴 别拿「有几个不同的 top 值」当行数：实测同一行里第一张会比其余低 1px
         （subpixel），照那个判据每组都报「2 行」—— 全是假红。
         真折行的落差是一整个卡片高（44px）＋间距，拿它当尺子。 */
      return { n: ps.length, spread: +(Math.max(...tops) - Math.min(...tops)).toFixed(1), h: +h.toFixed(1),
               boxW: Math.round(document.querySelector('.pills').getBoundingClientRect().width),
               sum: ps.reduce((a, b) => a + b.width, 0) | 0,
               names: [...document.querySelectorAll('.pill')].map(e => e.textContent.replace(/↘/g, '').trim()) };
    });
    ok(r.spread < r.h / 2, g + ' 一行放得下',
       r.n + ' 张 · 高低差 ' + r.spread + 'px（卡片高 ' + r.h + '）· 容器' + r.boxW + ' 卡片合计' + r.sum
       + ' · ' + r.names.join(' / '));
  }

  console.log('\n10 各角色的标题停在同一高度（切角色不跳）');
  const tops = {};
  for (const r of ['设计'].concat(await p.evaluate(() => (window.WBROLES.roles || []).map(x => x.n)))) {
    await p.evaluate(x => [...document.querySelectorAll('.roles button')].find(e => e.textContent.trim() === x).click(), r);
    await new Promise(z => setTimeout(z, 180));
    tops[r] = await p.evaluate(() => Math.round(document.querySelector('h1').getBoundingClientRect().top));
  }
  const vals = Object.values(tops);
  ok(Math.max(...vals) - Math.min(...vals) <= 2, '各角色 h1 距顶一致',
     Object.entries(tops).map(([k, v]) => k + ' ' + v).join(' / '));
  /* 🔴 这条红了是去重量 --home-min-h（设计那一屏内容改过了），不是调这里的容差 */

  console.log('\n11 截图');
  await shoot('设计', 'roles-design.png');
  for (const r of await p.evaluate(() => (window.WBROLES.roles || []).map(x => x.n))) {
    await shoot(r, 'roles-' + r + '.png');
  }
  await b.close();
  console.log('\n' + (red ? '❌ ' + red + ' 项红' : '✅ 全绿') + ' · 截图在 ' + OUT + '/roles-*.png（三个角色各一张，拍之前都核过停在谁身上）');
  process.exit(red ? 1 : 0);
})();
