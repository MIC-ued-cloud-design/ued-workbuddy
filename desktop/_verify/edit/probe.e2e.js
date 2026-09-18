/* 端到端：真 Chrome + CDP 真输入通道，验探针的选中 / 改字 / 复制 / 拖拽换序 / 手柄改尺寸 / 删除，
   每条操作再用 htmlmap 真的补进源码，看结果对不对。跑法：node run.js */
const path = require('path'), fs = require('fs'), assert = require('assert');
const puppeteer = require(path.join(__dirname, '..', '..', 'restore-tools', 'online-reach', 'node_modules', 'puppeteer-core'));
const H = require(path.join(__dirname, '..', '..', 'main', 'htmlmap.js'));
const PROBE = fs.readFileSync(path.join(__dirname, '..', '..', 'main', 'edit-probe.js'), 'utf8');
const DIR = path.join(require('os').tmpdir(), 'uw-edit-e2e'); fs.mkdirSync(DIR, { recursive: true });

/* 换图那一节用的图：40×20 的纯色块，做成 data URI 自带在页面里，测试不依赖任何外部文件。
   尺寸取 40×20 是为了能验 naturalWidth/Height 真采到了，而不是拿框的尺寸冒充。 */
const IMGDATA = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSIyMCI+PHJlY3Qgd2lkdGg9IjQwIiBoZWlnaHQ9IjIwIiBmaWxsPSIjRTY0NTQ1Ii8+PC9zdmc+';
let src = `<!doctype html>
<html><head><meta charset="utf-8"><title>t</title>
<style>body{margin:0;font-family:Roboto,sans-serif;padding:20px}.cards{display:flex;gap:16px}.card{width:200px;height:120px;background:#F5F7FA;padding:12px;box-sizing:border-box}h1{font-size:24px;margin:0 0 16px}a.btn{display:inline-block;padding:8px 16px;background:#E64545;color:#fff;border-radius:6px}a.btn:hover{background:#C93A3A}</style>
<script>document.addEventListener('DOMContentLoaded',function(){var d=document.createElement('div');d.className='gen';d.textContent='generated';d.style.cssText='position:fixed;right:12px;bottom:12px;width:90px;height:24px;background:#ffd';document.body.appendChild(d);});</script>
</head>
<body>
  <h1 class="title">Hello world</h1>
  <section class="cards">
    <div class="card" data-k="1">Card A</div>
    <div class="card" data-k="2"><span>Card B</span></div>
    <div class="card" data-k="3">Card C</div>
  </section>
  <div class="bleed" style="margin:0 -20px;height:40px;background:#eee">full bleed</div>
  <div class="rows" style="padding:24px;background:#fafafa">
    <div class="row1" style="height:30px;background:#ddd">A</div>
    <div class="row2" style="height:30px;background:#ddd;margin-top:20px">B</div>
    <div class="row3" style="height:30px;background:#ddd;margin-top:36px">C</div>
  </div>
  <a class="btn" href="https://example.com" id="cta">Buy now</a>
  <svg id="ico" width="24" height="24" viewBox="0 0 16 16" fill="none"><path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1z" fill="#222"/></svg>
  <img id="pic" alt="示例图" src="${IMGDATA}" style="width:120px;height:60px;object-fit:cover;object-position:left top">
  <div id="hero" style="width:200px;height:80px;background-image:url('${IMGDATA}');background-size:contain;background-position:right bottom">hero</div>
  <div id="hero2" style="width:200px;height:60px;background-image:linear-gradient(rgba(0,0,0,.4),rgba(0,0,0,.4)),url('${IMGDATA}');background-size:cover;background-position:center">压暗的</div>
  <div id="tint" style="position:absolute;right:20px;top:20px;width:200px;height:40px;background-color:#E64545;background-image:linear-gradient(rgba(0,0,0,.2),rgba(0,0,0,.2))">底色加20%黑</div>
  <div id="nest" style="display:flex;gap:12px;align-items:flex-start">
    <div id="av" style="position:relative;width:60px;height:60px"><img id="avimg" src="${IMGDATA}" style="width:60px;height:60px;object-fit:cover"><span id="avtxt" style="position:absolute;left:0;top:0;width:60px;height:60px;background:linear-gradient(0deg,rgba(0,0,0,.5),rgba(0,0,0,.5));color:#fff;font-size:12px">需要修改</span></div>
    <div id="card" style="width:120px;height:60px"><img id="cardimg" src="${IMGDATA}" style="width:120px;height:60px;object-fit:cover"></div>
    <div id="big" style="position:relative;width:200px;height:80px;background:#eee"><img id="badge" src="${IMGDATA}" style="position:absolute;right:4px;top:4px;width:16px;height:16px"></div>
    <div id="narrow" style="width:60px;height:60px;display:flex;align-items:center;justify-content:center"><img id="narrowimg" src="${IMGDATA}" style="width:40px;height:40px"></div>
    <img id="cssz" src="${IMGDATA}" style="max-width:40px;max-height:40px">
    <div id="banner" style="position:relative;width:200px;height:100px;background-image:url('${IMGDATA}');background-size:cover"><a id="smallbtn" href="#" style="position:absolute;left:8px;top:8px;width:40px;height:20px;background:#fff">按</a></div>
  </div>
</body></html>`;

function serve() {
  fs.writeFileSync(path.join(DIR, 'page.html'), H.mark(src) + '\n<script>' + PROBE + '</script>');
}
/* 换图那几条会把地址换成 images/ 下的文件。真放两个进去，否则浏览器报 ERR_FILE_NOT_FOUND，
   会混进「全程没有页面报错」那条里；放了还顺带验了换完真能加载出来。 */
fs.mkdirSync(path.join(DIR, 'images'), { recursive: true });
for (const n of ['new.png', 'bg.png']) fs.writeFileSync(path.join(DIR, 'images', n), Buffer.from(IMGDATA.split(',')[1], 'base64'));
fs.writeFileSync(path.join(DIR, 'parent.html'), `<!doctype html><html><body style="margin:0">
<iframe id="f" src="page.html" style="position:absolute;left:20px;top:20px;width:1000px;height:700px;border:0"></iframe>
<script>
window.__msgs=[];window.addEventListener('message',e=>{if(e.data&&e.data.__uwEdit)window.__msgs.push(e.data)});
window.cmd=m=>document.getElementById('f').contentWindow.postMessage(m,'*');
</script></body></html>`);
serve();

const OX = 20, OY = 20;
(async () => {
  const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--allow-file-access-from-files', '--window-size=1100,800'], defaultViewport: { width: 1100, height: 800 } });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  let pass = 0;
  const ok = (n, f) => { try { f(); pass++; console.log('✅', n); } catch (e) { console.log('❌', n, '\n   ', e.message); process.exitCode = 1; } };
  const load = async () => { await page.goto('file://' + path.join(DIR, 'parent.html')); await page.waitForFunction(() => window.__msgs.some(m => m.__uwEdit === 'ready')); };
  const frame = () => page.frames().find(f => f.url().endsWith('page.html'));
  const msgs = () => page.evaluate(() => window.__msgs);
  const clear = () => page.evaluate(() => { window.__msgs = []; });
  const last = async t => (await msgs()).filter(m => m.__uwEdit === t).pop();
  const rectOf = async sel => { const r = await frame().evaluate(s => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, i: e.getAttribute('data-uw-i') }; }, sel); return r; };
  const center = r => ({ x: OX + r.x + r.w / 2, y: OY + r.y + r.h / 2 });
  const on = async (select) => { await clear(); await page.evaluate(s => window.cmd({ __uwEditCmd: 'on', select: s }), select == null ? null : select); await new Promise(r => setTimeout(r, 80)); };
  const applyLast = async () => { const op = await last('op'); assert.ok(op, '没有收到op'); const r = H.apply(src, op.ops); src = r.html; serve(); return { op, r }; };

  await load();
  ok('探针就绪，编号数 = 源码开标签数', async () => {}); // 占位，下面真测
  const ready = await last('ready');
  ok('ready报告的编号数等于源码开标签数', () => assert.strictEqual(ready.n, H.startCount(src)));
  await on();

  /* 1 悬停 + 点选 */
  let r = await rectOf('h1'); let c = center(r);
  await page.mouse.move(c.x, c.y); await new Promise(x => setTimeout(x, 50));
  const hovShown = await frame().evaluate(() => { const b = document.getElementById('__uwEditRoot').shadowRoot.querySelector('.hov'); return b.style.display === 'block' && b.querySelector('.tag').textContent; });
  ok('悬停：出现悬停框并标出h1.title', () => assert.strictEqual(hovShown, 'h1.title'));
  await page.mouse.click(c.x, c.y); await new Promise(x => setTimeout(x, 80));
  let sel = await last('sel');
  ok('单击：选中h1，编号与data-uw-i一致，textOnly，父级路径是body', () => { assert.strictEqual(sel.info.tag, 'h1'); assert.strictEqual(String(sel.info.i), r.i); assert.strictEqual(sel.info.textOnly, true); assert.deepStrictEqual(sel.info.path.map(p => p.label), ['body']); assert.strictEqual(sel.info.cs.fontSize, '24px'); });
  /* 🔴 选框和手柄已经搬到 iframe 外面去画了（画布边界不该约束它们）。
     这一层的契约只剩一条：把选中元素的矩形如实报上去，而且别在 iframe 里留下自己画的框。 */
  const selMsg = await last('rect');
  const selHidden = await frame().evaluate(() => document.getElementById('__uwEditRoot').shadowRoot.querySelector('.sel').style.display);
  ok('选中后报上元素矩形（宽高、尺寸标签、圆角），iframe里不再自己画框', () => {
    assert.strictEqual(selHidden, 'none');
    assert.ok(Math.abs(selMsg.r.w - r.w) < 1 && Math.abs(selMsg.r.h - r.h) < 1, JSON.stringify(selMsg.r));
    assert.strictEqual(selMsg.r.lab, `${Math.round(r.w)} × ${Math.round(r.h)}`);
    assert.deepStrictEqual(selMsg.r.rad, [0, 0, 0, 0]);
  });
  {
    /* 鼠标划到一块上，直接把它跟上下左右的空隙标出来（吉吉 2026-09-17：「让用户看的更直接」）。
       夹具里 B 上面留 20、下面留 36，父容器左右各 24 —— 四个数都该被量出来。 */
    const rb = await rectOf('.row2'); await page.mouse.move(center(rb).x, center(rb).y); await new Promise(x => setTimeout(x, 150));
    const g = await frame().evaluate(() => [...document.getElementById('__uwEditRoot').shadowRoot.querySelectorAll('.msr')]
      .filter(m => m.style.display === 'block')
      .map(m => ({ n: m.querySelector('b').textContent, dir: m.classList.contains('v') ? 'v' : 'hz' })));
    ok('鼠标划过一块：四周的间距自动标出来（上20下36左右各24），竖着的走竖标尺、横着的走横标尺', () => {
      const v = g.filter(x => x.dir === 'v').map(x => x.n).sort(), hz = g.filter(x => x.dir === 'hz').map(x => x.n);
      assert.deepStrictEqual(v, ['20', '36'], JSON.stringify(g));
      assert.deepStrictEqual(hz, ['24', '24'], JSON.stringify(g));
    });
    const lbs = await frame().evaluate(() => [...document.getElementById('__uwEditRoot').shadowRoot.querySelectorAll('.msr')]
      .filter(m => m.style.display === 'block').map(m => { const r = m.querySelector('b').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; }));
    const vp = await frame().evaluate(() => ({ w: document.documentElement.clientWidth, h: document.documentElement.clientHeight }));
    ok('标尺上的数字不会被画布边裁掉（贴边的侧栏最容易撞上）', () => lbs.forEach(r => { assert.ok(r.l >= -0.5 && r.r <= vp.w + 0.5, `横向出界${r.l}~${r.r} / ${vp.w}`); assert.ok(r.t >= -0.5 && r.b <= vp.h + 0.5, `纵向出界${r.t}~${r.b} / ${vp.h}`); }));
    /* 开关：关掉就一根都不画，开回来又有（吉吉 2026-09-17 要能自己控制显不显示） */
    await page.evaluate(() => cmd({ __uwEditCmd: 'gaps', on: false })); await new Promise(x => setTimeout(x, 200));
    const off = await frame().evaluate(() => [...document.getElementById('__uwEditRoot').shadowRoot.querySelectorAll('.msr')].every(m => m.style.display === 'none'));
    await page.evaluate(() => cmd({ __uwEditCmd: 'gaps', on: true }));
    await page.mouse.move(center(rb).x, center(rb).y + 1); await new Promise(x => setTimeout(x, 250));
    const back = await frame().evaluate(() => [...document.getElementById('__uwEditRoot').shadowRoot.querySelectorAll('.msr')].filter(m => m.style.display === 'block').length);
    ok('间距标尺有开关：关掉一根都不画，开回来又有', () => { assert.strictEqual(off, true, '关了还在画'); assert.ok(back > 0, '开回来没画'); });
    await page.mouse.move(5, 5); await new Promise(x => setTimeout(x, 200));
    const gone = await frame().evaluate(() => ({ hidden: [...document.getElementById('__uwEditRoot').shadowRoot.querySelectorAll('.msr')].every(m => m.style.display === 'none'), hov: (window.__uwHov || null) }));
    ok('鼠标移开：标尺跟着收起来，不留在画布上', () => assert.strictEqual(gone.hidden, true, '还挂着，当时悬停在 ' + gone.hov));
  }
  {
    /* 编辑态下元素自己的 hover 还算不算数（吉吉 2026-09-17 问「元素要自带交互」）：
       编辑层只把光标和选字锁了，没给页面元素设 pointer-events:none，所以 :hover 照常命中。 */
    const rh = await rectOf('a#cta'); await page.mouse.move(center(rh).x, center(rh).y); await new Promise(x => setTimeout(x, 80));
    const hoverBg = await frame().evaluate(() => getComputedStyle(document.querySelector('a#cta')).backgroundColor);
    await page.mouse.move(5, 5); await new Promise(x => setTimeout(x, 60));
    const restBg = await frame().evaluate(() => getComputedStyle(document.querySelector('a#cta')).backgroundColor);
    ok('编辑态下页面元素自己的 :hover仍然生效（悬停变色，移开变回来）', () => { assert.strictEqual(hoverBg, 'rgb(201, 58, 58)'); assert.strictEqual(restBg, 'rgb(230, 69, 69)'); });
  }
  {
    /* 通栏元素（1440 档里的页头那种）贴着画布左右边。选框搬出去之后，这一层不许再做任何「夹回视口」的
       小动作 —— 报的必须是元素真实的矩形，负数也照报，外面那层才画得出「超出画布」的效果。 */
    const rf = await rectOf('.bleed'); await page.mouse.click(center(rf).x, center(rf).y); await new Promise(x => setTimeout(x, 80));
    const bleed = await last('rect');
    ok('通栏元素：报的是它真实的矩形（贴边也不夹、不缩），外面那层才画得出超出画布的手柄', () => {
      assert.ok(Math.abs(bleed.r.l - rf.x) < 1, `left被动过了：${bleed.r.l} vs ${rf.x}`);
      assert.ok(Math.abs(bleed.r.w - rf.w) < 1, `宽被动过了：${bleed.r.w} vs ${rf.w}`);
    });
    await page.keyboard.press('Escape'); await new Promise(x => setTimeout(x, 60));
  }
  {
    const rb = await rectOf('a#cta'); await page.mouse.click(center(rb).x, center(rb).y); await new Promise(x => setTimeout(x, 80));
    const rad = await last('rect');
    ok('选中有圆角的按钮：圆角原样报上去（外面那层再各加2px，不把圆角截平）', () => assert.deepStrictEqual(rad.r.rad, [6, 6, 6, 6]));
    await page.keyboard.press('Escape'); await new Promise(x => setTimeout(x, 60));   // 取消选中，别影响下一段「点链接」的测试（点已选中的元素不会再发 sel）
  }

  /* 2 点链接不跳转 */
  r = await rectOf('a#cta'); c = center(r); await clear(); await page.mouse.click(c.x, c.y); await new Promise(x => setTimeout(x, 100));
  ok('编辑态点链接：只选中，不跳走', () => assert.ok(frame().url().endsWith('page.html')));
  sel = await last('sel'); ok('链接选中信息带href', () => assert.strictEqual(sel.info.href, 'https://example.com'));

  /* 3 双击改字 → op text → 补进源码 */
  r = await rectOf('h1'); c = center(r); await clear();
  await page.mouse.click(c.x, c.y, { count: 2 }); await new Promise(x => setTimeout(x, 80));
  const editingOn = await frame().evaluate(() => !!document.querySelector('[data-uw-editing]'));
  ok('双击文字块：进入改字态', () => assert.strictEqual(editingOn, true));
  await page.keyboard.type('New <Title> & co'); await page.keyboard.press('Enter'); await new Promise(x => setTimeout(x, 80));
  let ap = await applyLast();
  ok('改字：op带旧文字核对，源码里替换并转义', () => { assert.strictEqual(ap.op.ops[0].op, 'text'); assert.strictEqual(ap.op.ops[0].old, 'Hello world'); assert.ok(src.includes('<h1 class="title">New &lt;Title&gt; &amp; co</h1>'), src.match(/<h1[^>]*>.*<\/h1>/)[0]); });

  /* 4 父窗口发样式（面板改字号）→ DOM 立刻变 */
  await page.evaluate(i => window.cmd({ __uwEditCmd: 'style', i: +i, set: { 'font-size': '32px', color: '#E64545' } }), r.i); await new Promise(x => setTimeout(x, 50));
  const fsNow = await frame().evaluate(() => getComputedStyle(document.querySelector('h1')).fontSize);
  ok('样式命令：iframe里字号立刻变成32px', () => assert.strictEqual(fsNow, '32px'));
  src = H.apply(src, [{ op: 'style', i: +r.i, tag: 'H1', set: { 'font-size': '32px', color: '#E64545' } }]).html; serve();
  ok('样式：同样的补丁进源码成为内联style', () => assert.ok(src.includes('<h1 class="title" style="font-size:32px;color:#E64545">')));

  /* 5 ⌘D 复制卡片 */
  r = await rectOf('.card[data-k="2"]'); c = center(r); await clear(); await page.mouse.click(c.x, c.y); await new Promise(x => setTimeout(x, 80));
  sel = await last('sel'); ok('选卡片B：prev/next指向A/C，structural', () => { assert.strictEqual(sel.info.tag, 'div'); assert.strictEqual(sel.info.structural, true); assert.ok(sel.info.prev != null && sel.info.next != null); assert.strictEqual(sel.info.parentFlex, true); });
  await clear(); await page.keyboard.down('Meta'); await page.keyboard.press('d'); await page.keyboard.up('Meta'); await new Promise(x => setTimeout(x, 60));
  ap = await applyLast();
  ok('⌘D：复制op，源码里多一张B，select指到副本', () => { assert.strictEqual(ap.op.ops[0].op, 'duplicate'); assert.strictEqual((src.match(/data-k="2"/g) || []).length, 2); const rr = H.range(src, ap.r.select); assert.ok(src.slice(rr.openStart, rr.closeEnd).includes('data-k="2"')); });
  await load(); await on(ap.r.select);
  sel = await last('sel'); ok('重载后按新编号恢复选中：选中的是副本（后一张B）', () => { assert.strictEqual(sel.info.tag, 'div'); assert.ok(sel.info.classes.includes('card')); assert.strictEqual(sel.info.prev != null && (String(sel.info.i) === String(ap.r.select)), true); });

  /* 6 拖拽：把 C 拖到 A 前面（现在顺序 A B B' C） */
  const rc = await rectOf('.card[data-k="3"]'), ra = await rectOf('.card[data-k="1"]');
  await clear(); await page.mouse.click(center(rc).x, center(rc).y); await new Promise(x => setTimeout(x, 40));
  const cc = center(rc);
  await page.mouse.move(cc.x, cc.y); await page.mouse.down(); await page.mouse.move(cc.x - 30, cc.y, { steps: 4 });
  await page.mouse.move(OX + ra.x + 10, OY + ra.y + 20, { steps: 8 }); await new Promise(x => setTimeout(x, 40));
  const insShown = await frame().evaluate(() => { const b = document.getElementById('__uwEditRoot').shadowRoot.querySelector('.ins'); return b.style.display === 'block' && b.className; });
  ok('拖拽中：出现竖向插入线（横排flex）', () => assert.strictEqual(insShown, 'ins v'));
  await page.mouse.up(); await new Promise(x => setTimeout(x, 60));
  ap = await applyLast();
  ok('拖拽松手：move op（C → A前面），源码顺序变成C A B B\'', () => {
    assert.strictEqual(ap.op.ops[0].op, 'move'); assert.strictEqual(ap.op.ops[0].where, 'before'); assert.strictEqual(String(ap.op.ops[0].to), ra.i);
    const ks = [...src.matchAll(/data-k="(\d)"/g)].map(m => m[1]); assert.deepStrictEqual(ks, ['3', '1', '2', '2']);
  });
  await load(); await on(ap.r.select);
  sel = await last('sel'); ok('重载后选中跟着C，且它现在没有prev', () => { assert.strictEqual(sel.info.prev, null); assert.ok(sel.info.next != null); });

  /* 7 改尺寸：拖手柄那一段归外面那层管了（手柄在画布外面，鼠标会走出 iframe），
     这一层只保证「外面算好宽高发进来，能落到 DOM、也能补进源码」。 */
  r = await rectOf('.card[data-k="3"]'); await clear(); await page.mouse.click(center(r).x, center(r).y); await new Promise(x => setTimeout(x, 40));
  const i3 = await frame().evaluate(() => +document.querySelector('.card[data-k="3"]').getAttribute('data-uw-i'));
  const want = { width: Math.round(r.w + 40) + 'px', height: Math.round(r.h + 20) + 'px' };
  await page.evaluate((i, w) => cmd({ __uwEditCmd: 'style', i, set: w, save: true }), i3, want);
  await new Promise(x => setTimeout(x, 100));
  ap = await applyLast();
  const live = await frame().evaluate(() => { const e = document.querySelector('.card[data-k="3"]'); return e.style.width + '/' + e.style.height; });
  ok('外面把宽高发进来：DOM立刻变，style op也进了源码', () => { assert.strictEqual(live, want.width + '/' + want.height, 'DOM没变：' + live); assert.strictEqual(ap.op.ops[0].op, 'style'); assert.strictEqual(ap.op.ops[0].set.width, want.width); assert.strictEqual(ap.op.ops[0].set.height, want.height); assert.ok(src.includes(`data-k="3" style="width:${want.width};height:${want.height}"`), src.match(/<div class="card" data-k="3"[^>]*>/)[0]); });

  /* 7b 点 svg 里的 path：选中的是整个 svg，info 带路径指纹与属性 */
  { const rp = await frame().evaluate(() => { const r = document.querySelector('#ico path').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await clear(); await page.mouse.click(OX + rp.x, OY + rp.y); await new Promise(x => setTimeout(x, 80));
    sel = await last('sel');
    ok('点图标里的path：选中整个svg，带paths指纹与width/height', () => { assert.strictEqual(sel.info.tag, 'svg'); assert.strictEqual(sel.info.svg.paths.length, 1); assert.ok(sel.info.svg.paths[0].startsWith('M8 1a7 7')); assert.strictEqual(sel.info.svg.attrs.width, '24'); assert.strictEqual(sel.info.svg.w, 24); });
    await page.keyboard.press('Escape'); await new Promise(x => setTimeout(x, 60)); }
  /* 8 脚本生成的元素：点到报 generated */
  const rg = await rectOf('.gen'); await clear(); await page.mouse.click(center(rg).x, center(rg).y);
  await new Promise(x => setTimeout(x, 80));   /* 🔴 别省这一句：同文件每条点选都等了，只有这条没等——2026-09-17 它间歇性红，
                                                  真因不是功能坏了，是 info() 多算几毫秒就赶不上，断言抢在消息到达之前 */
  sel = await last('sel'); ok('脚本生成的元素：generated=true，不能改', () => assert.strictEqual(sel.info.generated, true));

  /* 9 选中容器后单击其子元素 → 改选子元素；⇧Enter 回父级；Backspace 删除 */
  const rs = await rectOf('section.cards'); await page.evaluate(i => window.cmd({ __uwEditCmd: 'select', i: +i }), rs.i); await new Promise(x => setTimeout(x, 40));
  r = await rectOf('.card[data-k="1"]'); await clear(); await page.mouse.click(center(r).x, center(r).y); await new Promise(x => setTimeout(x, 40));
  sel = await last('sel'); ok('容器已选中时单击子卡片 → 改选那张卡片', () => assert.strictEqual(String(sel.info.i), r.i));
  const focusIn = await frame().evaluate(() => document.activeElement && document.activeElement.id);
  ok('点过页面后键盘焦点在iframe里（落在编辑层根上）', () => assert.strictEqual(focusIn, '__uwEditRoot'));
  await clear(); await page.keyboard.down('Shift'); await page.keyboard.press('Enter'); await page.keyboard.up('Shift'); await new Promise(x => setTimeout(x, 40));
  sel = await last('sel'); ok('⇧Enter：选到父级section.cards', () => assert.strictEqual(sel.info.tag, 'section'));
  await page.evaluate(i => window.cmd({ __uwEditCmd: 'select', i: +i }), r.i); await clear(); await page.keyboard.press('Backspace'); await new Promise(x => setTimeout(x, 40));
  ap = await applyLast();
  ok('Backspace：remove op，源码里卡片A没了', () => { assert.strictEqual(ap.op.ops[0].op, 'remove'); assert.ok(!src.includes('data-k="1"')); assert.strictEqual(ap.r.select, null); });

  /* 10 图片填充：<img> 和 CSS 背景图要被认成同一个形状——面板就是靠这个长成一样的。
     每改一次源码都要重新 load + rectOf：apply 之后编号会变，拿旧编号去操作是在改别的元素。 */
  await load(); await on();
  let pr = await rectOf('#pic'); await page.mouse.click(center(pr).x, center(pr).y); await new Promise(x => setTimeout(x, 80));
  const picSel = await last('sel');
  ok('选中 <img>：认出是图片填充，地址/摆法/位置/原图尺寸都采到', () => {
    const f = picSel.info.fill; assert.ok(f, '没采到fill');
    assert.strictEqual(f.kind, 'img'); assert.strictEqual(f.fit, 'cover');
    assert.ok(/left top|0% 0%/.test(f.pos), '位置采错了：' + f.pos);
    assert.strictEqual(f.nw, 40); assert.strictEqual(f.nh, 20);   // 原图40×20，不是框的120×60——采成框的尺寸就等于没采
  });
  let hr = await rectOf('#hero'); await page.mouse.click(center(hr).x, center(hr).y); await new Promise(x => setTimeout(x, 80));
  const heroSel = await last('sel');
  ok('选中背景图的元素：也认成图片填充，摆法取的是background-size', () => {
    const f = heroSel.info.fill; assert.ok(f, '背景图没被认出来');
    assert.strictEqual(f.kind, 'bg'); assert.strictEqual(f.fit, 'contain');
    assert.ok(/right bottom|100% 100%/.test(f.pos), '位置采错了：' + f.pos);
  });
  let br2 = await rectOf('.bleed'); await page.mouse.click(center(br2).x, center(br2).y); await new Promise(x => setTimeout(x, 80));
  const bleedSel = await last('sel');
  ok('没有图的元素：不报图片填充（面板上不该凭空冒出图片那一段）', () => assert.strictEqual(bleedSel.info.fill, null));

  let h2r = await rectOf('#hero2'); await page.mouse.click(center(h2r).x, center(h2r).y); await new Promise(x => setTimeout(x, 80));
  const hero2Sel = await last('sel');
  ok('带蒙版的分层背景：认出蒙版rgba(0,0,0,0.4)、摆法只取第一层（cover不是「cover, cover」）、地址取源码里的写法', () => {
    const f = hero2Sel.info.fill; assert.ok(f && f.kind === 'bg', JSON.stringify(f));
    assert.strictEqual(f.mask, 'rgba(0,0,0,0.4)'); assert.strictEqual(f.fit, 'cover'); assert.ok(/^data:/.test(f.src), f.src.slice(0, 40));
  });
  ok('没有蒙版的背景图：mask为null', () => assert.strictEqual(heroSel.info.fill.mask, null));

  let tr = await rectOf('#tint'); await page.mouse.click(center(tr).x, center(tr).y); await new Promise(x => setTimeout(x, 80));
  const tintSel = await last('sel');
  ok('底色上叠一层色（没有图）：bgMask认出rgba(0,0,0,0.2)，fill仍为null（不是图片元素）', () => { assert.strictEqual(tintSel.info.bgMask, 'rgba(0,0,0,0.2)'); assert.strictEqual(tintSel.info.fill, null); });
  ok('普通元素：bgMask为null', () => assert.strictEqual(bleedSel.info.bgMask, null));

  /* 10b 图不在选中的这层身上时，也要把它找出来 —— 否则面板会说「这层没有图」，
        人往这层加背景图只会看到「传了图没反应」（图写进去了，压在那张图底下）。
        夹具照 VO 供应商首页头像的真结构：一张 img + 盖在上面的半透明文字层（2026-09-17 吉吉就在这上面翻的车）。 */
  const idOf = async sel => (await rectOf(sel)).i;
  let avr = await rectOf('#avtxt'); await clear(); await page.mouse.click(center(avr).x, center(avr).y); await new Promise(x => setTimeout(x, 100));
  const avSel = await last('sel'); const avImgI = await idOf('#avimg');
  ok('头像那种「图 + 盖在上面的文字层」：点下去命中的是文字层（那张图确实点不到）', () => { assert.strictEqual(avSel.info.tag, 'span'); assert.strictEqual(avSel.info.fill, null); });
  ok('压在下面那张图被找出来：how=under，编号指向底下那个 <img>', () => {
    const N = avSel.info.innerFill; assert.ok(N, '没找到压在下面的图');
    assert.strictEqual(N.how, 'under'); assert.strictEqual(N.tag, 'img'); assert.strictEqual(String(N.i), String(avImgI));
    assert.ok(N.fill && N.fill.kind === 'img', JSON.stringify(N.fill));
  });

  await clear(); await page.evaluate(i => window.cmd({ __uwEditCmd: 'select', i: +i }), await idOf('#card'));
  await new Promise(x => setTimeout(x, 100)); const cardSel = await last('sel'); const cardImgI = await idOf('#cardimg');
  ok('图在里面那层（外层容器套一张图）：how=inner，编号指向里面那个 <img>', () => {
    const N = cardSel.info.innerFill; assert.ok(N, '没找到里面那张图');
    assert.strictEqual(N.how, 'inner'); assert.strictEqual(String(N.i), String(cardImgI));
  });

  await clear(); await page.evaluate(i => window.cmd({ __uwEditCmd: 'select', i: +i }), await idOf('#narrow'));
  await new Promise(x => setTimeout(x, 100)); const nSel = await last('sel');
  ok('窄图也要认出来（40×40 摆在 60×60 里＝44%）：真头像就是被 max-width 限成这样的，阈值卡 0.5 会漏', () => {
    const N = nSel.info.innerFill; assert.ok(N, '窄图漏了——VO 那个头像量出来是 41×54/60×60＝61%，再窄一点就是这条');
    assert.strictEqual(N.tag, 'img');
  });

  await clear(); await page.evaluate(i => window.cmd({ __uwEditCmd: 'select', i: +i }), await idOf('#cssz'));
  await new Promise(x => setTimeout(x, 100)); const czSel = await last('sel');
  ok('样式表在管尺寸的图（max-width/max-height）：标出 cssSized，换图时就不会把旧图的渲染尺寸写死成 inline', () => {
    assert.strictEqual(czSel.info.fill.cssSized, true);
    assert.strictEqual(picSel.info.fill.cssSized, false, '没有 CSS 约束的图仍要写死，不然新图会按原始尺寸把布局撑乱');
  });

  let br = await rectOf('#big'); await clear(); await page.mouse.click(OX + br.x + 20, OY + br.y + 55); await new Promise(x => setTimeout(x, 100));
  const bigSel = await last('sel');
  ok('小角标不算「这一层的图」（16×16 摆在 200×80 里）：innerFill 为 null', () => { assert.strictEqual(bigSel.info.tag, 'div'); assert.strictEqual(bigSel.info.innerFill, null); });

  let sbr = await rectOf('#smallbtn'); await clear(); await page.mouse.click(center(sbr).x, center(sbr).y); await new Promise(x => setTimeout(x, 100));
  const sbSel = await last('sel');
  ok('底下整页的大图不算「这个小按钮的图」（面积差 25 倍）：innerFill 为 null', () => { assert.strictEqual(sbSel.info.innerFill, null); });

  ok('自己就有图的元素：不再往里往下找（免得面板同时冒出两张图）', () => assert.strictEqual(picSel.info.innerFill, null));

  /* 改摆法走 style 通道、换图走 attr 通道——面板用的就是这两条，这里验它们真能补进源码 */
  await clear();
  await page.evaluate(i => window.cmd({ __uwEditCmd: 'style', i: +i, set: { 'object-fit': 'contain', 'object-position': 'center center' }, save: true }), pr.i);
  await new Promise(x => setTimeout(x, 80)); await applyLast();
  ok('改摆法：object-fit / object-position补进了源码', () => { assert.ok(/object-fit:\s*contain/.test(src) && /object-position:\s*center center/.test(src), src.slice(src.indexOf('<img'), src.indexOf('<img') + 240)); });

  await load(); await on();
  pr = await rectOf('#pic'); await clear();
  await page.evaluate(i => window.cmd({ __uwEditCmd: 'attr', i: +i, name: 'src', value: 'images/new.png', save: true }), pr.i);
  await new Promise(x => setTimeout(x, 80)); await applyLast();
  ok('换图：src换成images/ 下的相对路径，写进了源码', () => assert.ok(/<img[^>]*src="images\/new\.png"/.test(src), '源码里src没换成新图'));

  await load(); await on();
  hr = await rectOf('#hero'); await clear();
  await page.evaluate(i => window.cmd({ __uwEditCmd: 'style', i: +i, set: { 'background-image': "url('images/bg.png')", 'background-size': 'cover', 'background-repeat': 'no-repeat' }, save: true }), hr.i);
  await new Promise(x => setTimeout(x, 80)); await applyLast();
  ok('换背景图：url用单引号进源码，不被转义成 &quot;（前端拿到的要是能看的CSS）', () => {
    assert.ok(/background-image:\s*url\('images\/bg\.png'\)/.test(src), '背景图没换或引号被转义：' + (src.match(/background-image:[^;"]*/) || [''])[0]);
    assert.ok(!/&quot;/.test(src), '源码里出现了 &quot; 转义');
    assert.ok(/background-repeat:\s*no-repeat/.test(src), '没补no-repeat，原样档会平铺');
  });

  /* 右键：报出光标下整个命中栈（被盖住的底图、叠在下面的兄弟就是靠这个选的） */
  await load(); await on(); await clear();
  const spanR = await rectOf('.card[data-k="2"] span');
  await frame().evaluate(p => { const el = document.elementFromPoint(p.x, p.y); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 2 })); }, { x: spanR.x + spanR.w / 2, y: spanR.y + spanR.h / 2 });
  await new Promise(x => setTimeout(x, 80));
  const stack = await last('stack');
  ok('右键：报出这个位置下所有能选的层，从上到下，不重复，带坐标', () => {
    assert.ok(stack, '没收到stack'); const labs = stack.list.map(x => x.label);
    assert.ok(/^span/.test(labs[0]), labs.join(' > ')); assert.ok(labs.some(l => /card/.test(l)) && labs.some(l => /cards/.test(l)) && labs[labs.length - 1] === 'body', labs.join(' > '));
    assert.strictEqual(new Set(stack.list.map(x => x.i)).size, stack.list.length, '有重复');
    assert.ok(typeof stack.x === 'number' && typeof stack.y === 'number');
  });
  await clear();
  await page.evaluate(i => window.cmd({ __uwEditCmd: 'hint', i: +i }), stack.list[stack.list.length - 1].i); await new Promise(x => setTimeout(x, 300));   // 🔴 必须等过至少一个 120ms 重画周期：60ms 时绿的是假的
  const hintTag = await frame().evaluate(() => { const b = document.getElementById('__uwEditRoot').shadowRoot.querySelector('.hov'); return b.style.display === 'block' ? b.querySelector('.tag').textContent : null; });
  ok('hint：菜单里悬停body那层，页面上悬停框预亮到body', () => assert.strictEqual(hintTag, 'body'));
  await page.evaluate(() => window.cmd({ __uwEditCmd: 'hint', i: null })); await new Promise(x => setTimeout(x, 300));
  const hintOff = await frame().evaluate(() => document.getElementById('__uwEditRoot').shadowRoot.querySelector('.hov').style.display);
  ok('hint(null)：预亮框收起', () => assert.strictEqual(hintOff, 'none'));
  await load(); await on();
  /* 11 off 之后点链接要能正常工作（这里只验监听已卸、无覆盖层残留） */
  await page.evaluate(() => window.cmd({ __uwEditCmd: 'off' })); await new Promise(x => setTimeout(x, 40));
  const offState = await frame().evaluate(() => ({ sel: document.getElementById('__uwEditRoot').shadowRoot.querySelector('.sel').style.display, st: !!document.querySelector('style[data-uw-ui]') }));
  ok('off：选框收起、页面级样式移除', () => { assert.strictEqual(offState.sel, 'none'); assert.strictEqual(offState.st, false); });

  ok('全程没有页面报错', () => assert.deepStrictEqual(errors, []));
  console.log(`\n${pass}项通过`);
  console.log('\n最终源码body段：\n' + src.slice(src.indexOf('<body>'), src.indexOf('</body>')));
  await browser.close();
})().catch(e => { console.error('💥', e); process.exit(1); });
