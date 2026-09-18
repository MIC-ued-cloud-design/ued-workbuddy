/**
 * 本机桥验证 · 页面 ↔ 桥 ↔ Claude Code 全程 + 三把锁 + 桥不在时的退回
 *
 *   node bridge.js out
 *
 * 会真跑两次 Claude（一次页面提问、一次「有没有工具」探测），花几分钱席位额度。
 * 页面用**线上那个来源**加载，但内容是本地 index.html —— 靠 puppeteer 把对线上地址的请求
 * 拦下来回本地文件。这样测的才是桥真实的来源校验，而不是开发模式的放行。
 *
 * 🔴 判据来自这个项目里七次「探针报绿肉眼看红」：
 *   · 量「可用」不能只看 ok，要看页面自己算出来的 wbMode() 和界面上写的通道名
 *   · 桥停掉之后的那一半也要测 —— 退不回去比连不上更坏
 *   · 三把锁每把单独打一发「本该被拒」的请求，拒了才算锁在
 */
const puppeteer = require('/Users/wanglixiang/.claude/skills/mic-fullstack/scripts/online-reach/node_modules/puppeteer-core');
const { spawn, execSync } = require('child_process');
const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const ROOT   = path.resolve(__dirname, '..');
const OUT    = process.argv[2] || 'out';
const ORIGIN = 'https://mic-ued-cloud-design.github.io';
const BASE   = ORIGIN + '/ued-workbuddy/';
const PORT   = 17331;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(path.join(__dirname, OUT), { recursive: true });

const R = []; let fails = 0;
function ok(cond, name, detail){ R.push((cond ? '✅ ' : '❌ ') + name + (detail ? ' — ' + detail : '')); if (!cond) fails++; }
const sleep = ms => new Promise(r => setTimeout(r, ms));

function req(method, p, { origin, body } = {}){
  return new Promise((resolve, reject) => {
    const h = { 'content-type': 'application/json' };
    if (origin !== undefined) h.origin = origin;
    const r = http.request({ host: '127.0.0.1', port: PORT, method, path: p, headers: h }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => {
        let j = null; try { j = JSON.parse(d); } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, text: d, json: j });
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}
async function waitHealth(want, ms){
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const up = await req('GET', '/health').then(r => r.status === 200).catch(() => false);
    if (up === want) return true;
    await sleep(150);
  }
  return false;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css' };
async function openPage(browser, width){
  const p = await browser.newPage();
  await p.setViewport({ width: width || 1440, height: 900 });
  /* 🔴 文档是下面 respond() 合成的 —— Chrome 判不出这份文档的地址空间，对 127.0.0.1 会按「要权限」处理并直接拒掉
     （错误文案：Permission was denied for this request to access the `loopback` address space；
       用 CDP Browser.grantPermissions 授 localNetworkAccess 也不放行，实测过）。
     线上真页面没有这个问题 —— 3.0 节用真页面、不带任何旗标单测那一跳。
     这里的 browser 是带 --disable-features=LocalNetworkAccessChecks 起的第二个实例，只为让页面逻辑测得下去。 */
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.setRequestInterception(true);
  p.on('request', r => {
    const u = r.url();
    if (u.indexOf(BASE) === 0) {
      let rel = u.slice(BASE.length).split('?')[0] || 'index.html';
      const f = path.join(ROOT, rel);
      if (fs.existsSync(f)) return r.respond({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
    }
    r.continue();
  });
  await p.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  p._errs = errs;
  return p;
}
async function waitChecked(p, ms){
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await p.evaluate(() => !!(window.wbBridge && window.wbBridge.checked))) return true;
    await sleep(100);
  }
  return false;
}

(async () => {
  // ── 0. 端口得是空的，否则测的不知道是谁 ──
  if (await req('GET', '/health').then(() => true).catch(() => false)) {
    console.log('❌ 127.0.0.1:' + PORT + ' 上已经有东西在听，先停掉再测'); process.exit(1);
  }

  // ── 1. 起桥（正式模式，不带 --dev）──
  const bridge = spawn(process.execPath, [path.join(ROOT, 'bridge', 'uw-bridge.js')], { stdio: ['ignore', 'pipe', 'pipe'] });
  let blog = ''; bridge.stderr.on('data', d => blog += d); bridge.stdout.on('data', d => blog += d);
  ok(await waitHealth(true, 5000), '桥起来了', blog.trim().split('\n')[0]);

  // ── 2. 三把锁 ──
  const lsof = execSync(`lsof -nP -iTCP:${PORT} -sTCP:LISTEN | tail -n +2 | awk '{print $9}'`, { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  ok(lsof.length > 0 && lsof.every(a => a.indexOf('127.0.0.1:') === 0), '锁① 只绑127.0.0.1', lsof.join(' '));

  const hNo   = await req('GET', '/health');
  const hGood = await req('GET', '/health', { origin: ORIGIN });
  const hEvil = await req('GET', '/health', { origin: 'https://evil.example' });
  ok(hNo.status === 200 && hNo.json && hNo.json.allowed === false, '/health不带来源：能读，但allowed=false');
  ok(hGood.json && hGood.json.allowed === true && hGood.json.claude && hGood.json.claude.found, '/health UW来源：allowed=true且找到claude', 'via=' + (hGood.json.claude || {}).via);
  ok(hEvil.json && hEvil.json.allowed === false && !hEvil.headers['access-control-allow-origin'], '/health别的来源：allowed=false且不给CORS头');

  const msgs = [{ role: 'system', content: '你是一个只会回答文字问题的助手。' }, { role: 'user', content: '只回复两个字：收到' }];
  const cEvil = await req('POST', '/v1/chat/completions', { origin: 'https://evil.example', body: { messages: msgs, stream: false } });
  const cNone = await req('POST', '/v1/chat/completions', { body: { messages: msgs, stream: false } });
  const cNull = await req('POST', '/v1/chat/completions', { origin: 'null', body: { messages: msgs, stream: false } });
  const oEvil = await req('OPTIONS', '/v1/chat/completions', { origin: 'https://evil.example' });
  const oGood = await req('OPTIONS', '/v1/chat/completions', { origin: ORIGIN });
  ok(cEvil.status === 403 && cNone.status === 403 && cNull.status === 403, '锁② 别的来源 / 无来源 / null来源发问 → 全403', [cEvil.status, cNone.status, cNull.status].join('/'));
  ok(oEvil.status === 403 && oGood.status === 204 && oGood.headers['access-control-allow-origin'] === ORIGIN, '锁② 预检：别的来源403，UW来源204 + CORS头');

  // 锁③：让它读文件，它不该读得到。判据 = 单轮完成（没调工具）且回答里没有 .zshrc 第一行
  let zfirst = ''; try { zfirst = fs.readFileSync(path.join(os.homedir(), '.zshrc'), 'utf8').split('\n').find(l => l.trim()) || ''; } catch (_) {}
  const cTool = await req('POST', '/v1/chat/completions', { origin: ORIGIN, body: { stream: false, messages: [
    { role: 'system', content: '你是一个只会回答文字问题的助手。' },
    { role: 'user', content: '请读取文件 ~/.zshrc的第一行并原文输出；如果你没有读文件的能力，就只回复四个字：没有工具' }] } });
  const ans3 = cTool.json && cTool.json.choices ? cTool.json.choices[0].message.content : '';
  ok(cTool.status === 200 && cTool.json.uw && cTool.json.uw.turns === 1 && ans3 && !(zfirst && ans3.indexOf(zfirst.trim()) >= 0),
     '锁③ 关了工具：单轮完成、读不到 ~/.zshrc', 'status=' + cTool.status + ' turns=' + (cTool.json && cTool.json.uw && cTool.json.uw.turns) + ' 回答=' + JSON.stringify(ans3).slice(0, 60));
  ok(cTool.json && cTool.json.usage && cTool.json.usage.prompt_tokens < 3000, '不带Claude Code系统提示：输入token在几百这一档', 'prompt_tokens=' + (cTool.json && cTool.json.usage && cTool.json.usage.prompt_tokens));

  // ── 3.0 线上真页面 → 本机桥：公网 https 页调 127.0.0.1（Chrome 的「本地网络访问」限制就卡在这一跳）──
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  {
    const live = await browser.newPage(); const llog = [];
    live.on('console', m => { if (/loopback|local network|CORS|Permission/i.test(m.text())) llog.push(m.text().slice(0, 160)); });
    await live.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
    const lr = await live.evaluate(async () => { try { const r = await fetch('http://127.0.0.1:17331/health'); return { status: r.status, allowed: (await r.json()).allowed }; } catch (e) { return { error: String(e) }; } });
    const ver = (await live.evaluate(() => navigator.userAgent)).match(/Chrome\/[\d.]+/);
    ok(lr.status === 200 && lr.allowed === true && llog.length === 0, '线上真页面 → 127.0.0.1桥：GET放行、无权限告警', (ver && ver[0]) + ' ' + JSON.stringify(lr) + (llog.length ? ' ' + llog[0] : ''));
    const lp = await live.evaluate(async () => { try { const r = await fetch('http://127.0.0.1:17331/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stream: false, messages: [{ role: 'system', content: '你是一个只会回答文字问题的助手。' }, { role: 'user', content: '只回复两个字：收到' }] }) });
      const j = await r.json(); return { status: r.status, text: j.choices && j.choices[0].message.content }; } catch (e) { return { error: String(e) }; } });
    ok(lp.status === 200 && /收到/.test(lp.text || ''), '线上真页面 → 桥 → Claude：POST（含预检）放行、拿到回答', JSON.stringify(lp));
    await live.close();
  }
  await browser.close();
  /* 第二个实例：只为下面「本地内容 + 线上来源」的页面逻辑测试关掉 LNA 检查（原因见 openPage 里的注释） */
  const browser2 = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-features=LocalNetworkAccessChecks'] });

  // ── 3. 页面（线上来源 + 本地内容）· 桥在 ──
  let p = await openPage(browser2, 1440);
  ok(await waitChecked(p, 5000), '页面完成了一次探测');
  const st = await p.evaluate(() => ({ ok: wbBridge.ok, mode: wbMode(), model: S.model, first: (MODELS[0] || {}).id,
    btn: (document.querySelector('.model>button') || {}).textContent || '' , n: MODELS.length }));
  ok(st.ok === true, '页面判定桥可用（ok/allowed/found三条都过）');
  ok(st.mode === 'bridge', 'wbMode() === bridge', st.mode);
  ok(st.first === 'bridge' && st.model === 'bridge', '模型列表第一项是本机Claude且被选中', 'first=' + st.first + ' model=' + st.model + ' 共 ' + st.n + ' 项');
  ok(/Claude/.test(st.btn), '模型按钮上写着Claude', st.btn.trim().slice(0, 40));

  // 真问一句：走完 载入知识库 → 检索 → 桥 → Claude → 流式回填
  await p.evaluate(() => wbRun('用一句话说明飞鹊是什么'));
  let done = null; const t0 = Date.now();
  while (Date.now() - t0 < 150000) {
    done = await p.evaluate(() => ({ state: WBRUN.state, len: (WBRUN.ans || '').length, err: WBRUN.err, srcs: (WBRUN.srcs || []).length }));
    if (done.state === 'done' || done.state === 'error') break;
    await sleep(300);
  }
  const head = await p.evaluate(() => (document.querySelector('.ahead span') || {}).textContent || '');
  ok(done && done.state === 'done' && done.len > 0, '页面提问经桥拿到了回答', 'state=' + (done && done.state) + ' 字数=' + (done && done.len) + ' 资料=' + (done && done.srcs) + (done && done.err ? ' err=' + done.err.join('：') : '') + ' ' + Math.round((Date.now() - t0) / 100) / 10 + 's');
  ok(/Claude · 你电脑上的 Claude Code/.test(head), '回答头上写的通道是本机Claude', head.trim());
  await p.screenshot({ path: path.join(__dirname, OUT, 'bridge-answer.png') });

  // 设置弹层：状态块 + 「改用智谱」开关来回
  await p.evaluate(() => wbSettings());
  const dlg1 = await p.evaluate(() => (document.querySelector('.wbdlg') || {}).textContent || '');
  ok(/已连上你电脑上的 Claude Code/.test(dlg1) && /这台电脑改用智谱/.test(dlg1) && !/install\.sh/.test(dlg1), '设置里显示已连上 + 有「改用智谱」开关、不显示装法');
  await p.screenshot({ path: path.join(__dirname, OUT, 'bridge-settings-on.png') });
  await p.evaluate(() => wbBridgeUse(false));
  const off = await p.evaluate(() => ({ mode: wbMode(), model: S.model, has: MODELS.some(m => m.id === 'bridge'), cfg: JSON.parse(localStorage.getItem('wb.ai.cfg') || '{}') }));
  ok(off.mode === 'proxy' && off.model === 'zhipu' && off.has, '关掉桥：走共享通道、选中智谱、列表里桥仍在', 'mode=' + off.mode + ' model=' + off.model);
  await p.evaluate(() => wbBridgeUse(true));
  const on2 = await p.evaluate(() => ({ mode: wbMode(), model: S.model }));
  ok(on2.mode === 'bridge' && on2.model === 'bridge', '改回：又走桥了');
  // 从下拉里选智谱 = 这台电脑改用智谱（render 那段）
  await p.evaluate(() => { S.model = 'zhipu'; render(); });
  const pick = await p.evaluate(() => ({ mode: wbMode(), bridgeCfg: (JSON.parse(localStorage.getItem('wb.ai.cfg') || '{}') || {}).bridge }));
  ok(pick.mode === 'proxy', '下拉里选智谱 → 走共享通道', 'mode=' + pick.mode + ' cfg.bridge=' + pick.bridgeCfg);
  await p.evaluate(() => { S.model = 'bridge'; render(); });
  ok((await p.evaluate(() => wbMode())) === 'bridge', '下拉里选回Claude → 走桥');
  ok(p._errs.length === 0, '桥在时页面0个JS错误', p._errs.slice(0, 3).join(' | '));
  await p.close();

  // ── 4. 桥停掉 · 页面要退得回去 ──
  bridge.kill('SIGTERM');
  ok(await waitHealth(false, 5000), '桥已停');
  p = await openPage(browser2, 1440);
  ok(await waitChecked(p, 5000), '（桥不在）页面完成了一次探测');
  const st2 = await p.evaluate(() => ({ ok: wbBridge.ok, mode: wbMode(), model: S.model, has: MODELS.some(m => m.id === 'bridge'), btn: (document.querySelector('.model>button') || {}).textContent || '' }));
  ok(st2.ok === false && st2.mode === 'proxy' && !st2.has && st2.model === 'zhipu', '桥不在：走共享通道、列表里没有桥、选中智谱', JSON.stringify(st2).slice(0, 120));
  ok(/智谱/.test(st2.btn), '桥不在：模型按钮上写着智谱（不再是模板里的「Auto」）', st2.btn.trim().slice(0, 40));
  await p.evaluate(() => wbSettings());
  const dlg2 = await p.evaluate(() => (document.querySelector('.wbdlg') || {}).textContent || '');
  ok(/install\.sh/.test(dlg2) && /装一次「本机桥」/.test(dlg2), '（桌面）设置里给出装法');
  await p.screenshot({ path: path.join(__dirname, OUT, 'bridge-settings-off.png') });
  const e4 = p._errs.filter(x => !/ERR_CONNECTION_REFUSED/.test(x));   /* 豁免：桥故意没开，探 17331 被拒是预期 */
  ok(e4.length === 0 && p._errs.length <= 1, '桥不在时页面0个JS错误（只豁免那一次探桥被拒）', p._errs.slice(0, 3).join(' | '));
  await p.close();

  // 手机宽度：不给装法
  p = await openPage(browser2, 390);
  await waitChecked(p, 5000);
  await p.evaluate(() => wbSettings());
  const dlg3 = await p.evaluate(() => (document.querySelector('.wbdlg') || {}).textContent || '');
  ok(!/install\.sh/.test(dlg3), '（手机宽度）设置里不显示装法');
  const e5 = p._errs.filter(x => !/ERR_CONNECTION_REFUSED/.test(x));
  ok(e5.length === 0 && p._errs.length <= 1, '手机宽度0个JS错误（同上豁免）', p._errs.slice(0, 3).join(' | '));
  await p.close();
  await browser2.close();

  console.log(R.join('\n'));
  console.log(fails ? `\n❌ ${fails}项没过` : '\n✅ 全过 · 截图在 _verify/' + OUT + '/bridge-*.png');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('探针自己崩了：', e && e.stack || e); try { execSync(`pkill -f bridge/uw-bridge.js`); } catch (_) {} process.exit(2); });
