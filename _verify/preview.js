/* 产物预览探针：接力到终端之后，任务目录里做出来的网页能不能在页面里看见、
   它一改这儿跟不跟着变。

   🔴 端口 17331 得是空的。装了桥的机器先：
        launchctl bootout gui/$(id -u)/com.ued.uw-bridge
      跑完恢复：
        launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.ued.uw-bridge.plist

   量的是「人能不能看见」：iframe 真渲染出内容、文件改了页面真变，
   不是「代码在不在」——这个项目栽过八次只看数字。
   跑法：node _verify/preview.js out */
const pp = require('/Users/wanglixiang/.claude/skills/mic-fullstack/scripts/online-reach/node_modules/puppeteer-core');
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');

const OUT = process.argv[2] || 'out';
/* 🔴 页面必须走 http，不能 file://。
   file:// 发往 127.0.0.1 的请求会被 Chrome 的 Local Network Access 整条掐掉，
   症状是「Failed to fetch」——看着像桥没起来，其实是浏览器挡的。
   _verify/terminal.js 早为这条起过本地站，这里照抄。 */
const PORT_PAGE = 17391;
const ROOT = '/Users/wanglixiang/Desktop/UED workbuddy';
const PAGE = 'http://127.0.0.1:' + PORT_PAGE + '/index.html';
const BRIDGE = '/Users/wanglixiang/Desktop/UED workbuddy/bridge/uw-bridge.js';
const WORK = path.join(os.homedir(), 'UW工作区');
const REL = '_探针-产物预览';
const DIR = path.join(WORK, REL);

let red = 0;
const ok = (c, t, d) => { console.log((c ? '  ✅ ' : '  ❌ ') + t + (d ? ' — ' + d : '')); if (!c) red++; };
const wait = ms => new Promise(r => setTimeout(r, ms));

const html = (title, color) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="margin:0;background:${color};font:600 64px/1.4 system-ui;color:#fff;` +
  `display:flex;align-items:center;justify-content:center;height:100vh"><div id="mark">${title}</div></body>`;

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, 'index.html'), html('第一版', '#0071E3'), 'utf8');

  /* 把仓库目录当静态站发出去 —— 只发本地、只发这一个目录 */
  const site = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const abs = path.resolve(ROOT, rel);
    if (!abs.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(abs, (e, buf) => {
      if (e) { res.writeHead(404); return res.end(); }
      const t = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
                  '.css':'text/css; charset=utf-8', '.json':'application/json' }[path.extname(abs)] || 'application/octet-stream';
      res.writeHead(200, { 'content-type': t }); res.end(buf);
    });
  });
  await new Promise(r => site.listen(PORT_PAGE, '127.0.0.1', r));

  const br = spawn('node', [BRIDGE, '--dev'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let brLog = ''; br.stdout.on('data', d => brLog += d); br.stderr.on('data', d => brLog += d);
  await wait(1500);
  if (/EADDRINUSE|already/i.test(brLog)) {
    console.log('❌ 17331 被占住了 —— 先 launchctl bootout gui/$(id -u)/com.ued.uw-bridge');
    br.kill(); process.exit(2);
  }

  const b = await pp.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'],
    defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 } });
  const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.evaluateOnNewDocument(() => { try { localStorage.setItem('wb.bridge.dev', '1'); } catch (e) {} });
  await p.goto(PAGE, { waitUntil: 'networkidle0' });
  await wait(1800);   // 等页面探桥

  console.log('\n1 页面认得出这个桥能看产物');
  const info = await p.evaluate(() => {
    const B = window.wbBridge;
    return { ok: !!(B && B.ok), pv: !!(B && B.info && B.info.preview && B.info.preview.ok),
             ver: B && B.info && B.info.version };
  });
  ok(info.ok, '桥连上了', '版本 ' + info.ver);
  ok(info.pv, '桥报了 preview.ok（1.4.0 才有）');
  if (!info.ok) { console.log('桥没连上，后面不用测了'); br.kill(); await b.close(); process.exit(1); }

  console.log('\n2 盯住任务目录 → 预览卡出现');
  await p.evaluate(r => window.uwPreviewWatch(r), REL);
  /* 🔴 轮询等它出现，别只等一个拍脑袋的固定时长 ——
     固定时长量出来的红分不清「功能没有」和「比我等得久」，两者要改的东西完全不同。 */
  let card = { on: false }, ms = -1;
  for (let i = 0; i < 40; i++) {
    await wait(250);
    card = await p.evaluate(() => {
      const c = document.getElementById('uwpCard');
      if (!c) return { on: false };
      const r = c.getBoundingClientRect();
      return { on: r.width > 0 && r.height > 0, w: Math.round(r.width), h: Math.round(r.height),
               title: (c.querySelector('.uwp-hd b') || {}).textContent || '' };
    });
    if (card.on) { ms = (i + 1) * 250; break; }
  }
  ok(card.on, '预览卡真的显示出来了',
     card.on ? card.w + '×' + card.h + ' · 「' + card.title + '」· 约 ' + ms + 'ms' : '10 秒都没出现');
  ok(card.on && ms <= 3000, '出现得够快（3 秒内）', ms > 0 ? ms + 'ms' : '');

  console.log('\n3 iframe 里是真内容，不是空白');
  /* 🔴 不能用 fr.contentDocument：页面在 17391、产物由 17331 发，跨源读不到，
     会抛异常然后被我自己的 try 吞掉、报成「没渲染出来」的假红。
     走 puppeteer 的 frame API，它不受同源限制。 */
  const markIn = async (want, tries) => {
    for (let i = 0; i < tries; i++) {
      for (const f of p.frames()) {
        if (!/\/work\/file\//.test(f.url())) continue;
        try { const t = await f.$eval('#mark', e => e.textContent); if (t === want) return i * 200; } catch (e) {}
      }
      await wait(200);
    }
    return -1;
  };
  const t1 = await markIn('第一版', 30);
  ok(t1 >= 0, 'iframe 里渲染出了产物本身', t1 >= 0 ? '约 ' + t1 + 'ms' : '6 秒都没渲染出内容');

  console.log('\n4 文件改了，页面跟着变（这才叫「实时」）');
  fs.writeFileSync(path.join(DIR, 'index.html'), html('第二版', '#34C759'), 'utf8');
  const t2 = await markIn('第二版', 40);
  ok(t2 >= 0, '改完之后预览自己更新了', t2 >= 0 ? '用了约 ' + t2 + 'ms' : '8 秒都没变');

  console.log('\n5 多个网页时给得了下拉');
  fs.writeFileSync(path.join(DIR, '另一版.html'), html('另一版', '#FF9F0A'), 'utf8');
  await wait(2200);
  const sel = await p.evaluate(() => {
    const s = document.querySelector('#uwpCard .uwp-sel');
    if (!s || s.tagName !== 'SELECT') return { n: 0 };
    return { n: s.options.length, names: [...s.options].map(o => o.value) };
  });
  ok(sel.n === 2, '两个网页都列出来了', (sel.names || []).join(' / '));

  console.log('\n6 拖高度那条握把默认就看得见');
  const grip = await p.evaluate(() => {
    const g = document.getElementById('uwpGrip');
    if (!g) return null;
    const r = g.getBoundingClientRect(), i = g.querySelector('i');
    const ir = i ? i.getBoundingClientRect() : { width: 0, height: 0 };
    return { h: Math.round(r.height), barW: Math.round(ir.width), barH: Math.round(ir.height),
             color: i ? getComputedStyle(i).backgroundColor : '' };
  });
  ok(grip && grip.barW > 20 && grip.barH >= 3, '不 hover 也有一条看得见的握把',
     grip ? grip.barW + '×' + grip.barH + ' · ' + grip.color : '没有握把');

  console.log('\n7 页面重画之后预览卡还在（切角色、发问题都会重画）');
  await p.evaluate(() => [...document.querySelectorAll('.roles button')]
    .find(e => e.textContent.trim() === '产品').click());
  await wait(600);
  ok(await p.evaluate(() => !!document.getElementById('uwpCard')), '切角色没把预览卡冲掉');

  console.log('\n8 安全边界（桥那头）');
  const guard = await p.evaluate(async rel => {
    const r = {};
    const B = window.wbBridge.url;
    const bad = await fetch(B + '/work/file/' + encodeURIComponent(rel) + '/index.html').then(x => x.status).catch(() => 0);
    r.noTicket = bad;
    return r;
  }, REL);
  ok(guard.noTicket === 403, '不带票读文件被挡住', 'HTTP ' + guard.noTicket);

  console.log('\n9 JS 错误');
  ok(errs.length === 0, '没有 JS 报错', errs.join(' | '));

  await p.screenshot({ path: OUT + '/preview-card.png' });
  await b.close(); br.kill(); site.close();
  try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (e) {}
  console.log('\n' + (red ? '❌ ' + red + ' 项红' : '✅ 全绿') + ' · 截图 ' + OUT + '/preview-card.png');
  console.log('🔴 别忘了恢复真桥：launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.ued.uw-bridge.plist');
  process.exit(red ? 1 : 0);
})();
