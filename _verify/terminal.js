/**
 * 「接力到终端」那一层的页面侧探针 —— 在真浏览器里跑完整条流程。
 *
 * 起一个假桥占住 17331，但**假的只有 claude 这一处**：
 * 直接 require bridge/uw-terminal.js 里真的 TerminalManager，只把 claude 换成 /bin/bash。
 * 所以 ws 握手、一次性票、node-pty、协议、xterm 渲染全是真的走了一遍，
 * 只是终端里跑的是 bash 不是 Claude Code —— 不烧 token，也不会撞 CC 的目录信任确认。
 *
 * 桥侧（真 claude + 真 open -a Terminal）2026-09-09 已在 node 层端到端验过：
 * ws OPEN → ready → pty 起 claude → 模型真答出字。这份探针不重复那件事，只管页面。
 *
 * 🔴 端口 17331 得是空的：装了桥的机器先
 *      launchctl bootout gui/$(id -u)/com.ued.uw-bridge
 *    跑完再
 *      launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.ued.uw-bridge.plist
 *
 * 跑法：node _verify/terminal.js [out目录]
 */
const puppeteer = require('/Users/wanglixiang/.claude/skills/mic-fullstack/scripts/online-reach/node_modules/puppeteer-core');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

/* 🔴 node-pty 和 ws 装在 ~/.uw-bridge/node_modules（install.sh 装的），
   仓库里没有 node_modules。不把这条路径接上，uw-terminal.js 里的
   require('ws') 就会失败，TerminalManager 报 ok:false，ws 升级回 503 ——
   然后路 B 那一整段全红，看起来像页面写错了，其实是探针的环境缺依赖。
   （第一次跑就是这样：13 条红全是这一个根因的下游。） */
process.env.NODE_PATH = [process.env.NODE_PATH, path.join(os.homedir(), '.uw-bridge', 'node_modules')]
  .filter(Boolean).join(path.delimiter);
require('module').Module._initPaths();

const ROOT = path.resolve(__dirname, '..');
const OUT = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (OUT && !fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const PORT_BRIDGE = 17331;      // 页面里写死的，不能改
const PORT_PAGE = 17390;        // 页面得走 http 才有正常的 origin（file:// 下 LNA 那一跳行为不一样）
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let pass = 0, fail = 0;
const ok = (n, c, extra) => { (c ? pass++ : fail++); console.log((c ? '  ✅ ' : '  ❌ ') + n + (extra ? '  ' + extra : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ── 假桥：真 TerminalManager + bash ───────────────────────── */
const TERM = require(path.join(ROOT, 'bridge', 'uw-terminal.js'));
const ALLOW = o => !!o && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(o);
/* 🔴 假 claude 不能直接用 /bin/bash：真 claude 吃「首条指令」那个位置参数，
   bash 会把它当脚本文件名 → No such file or directory → 退出码 127，
   终端一起来就死了。第一版就是这样，报出来像是页面的 bug。
   所以写一个吃掉全部参数、只开交互 shell 的壳。 */
const SHIM = path.join(os.tmpdir(), 'uw-fake-claude.sh');
fs.writeFileSync(SHIM, '#!/bin/bash\n# 探针用的假claude：忽略参数，开一个干净的交互shell\nexec /bin/bash --norc --noprofile -i\n', { mode: 0o755 });
const terminal = new TERM.TerminalManager({
  originOk: ALLOW,
  claude: () => ({ path: SHIM, via: 'fake' }),
  log: () => {},
});
const J = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
};
const bridge = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  if (ALLOW(origin)) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type');
    res.setHeader('access-control-allow-private-network', 'true');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = (req.url || '/').split('?')[0];

  if (url === '/health') return J(res, 200, {
    ok: true, name: 'uw-bridge', version: '1.3.0-fake', port: PORT_BRIDGE, allowed: true,
    claude: { found: true, via: 'fake' },
    web: { ok: false, running: false, allow: [], maxUrls: 3 },
    terminal: Object.assign({ external: true }, terminal.status()),
    busy: 0, max: 2,
  });
  if (url === '/terminal/sessions') return J(res, 200, { ok: true, sessions: terminal.list() });
  if (url === '/launch') {
    let raw = ''; req.on('data', c => raw += c);
    await new Promise(r => req.on('end', r));
    const body = JSON.parse(raw || '{}');
    const task = TERM.makeTaskDir(body.task || '探针');
    const taskFile = TERM.writeTaskFile(task.dir, body);
    if (body.method === 'builtin') {
      const t = terminal.issue({ ...task, title: body.card || '终端', cols: body.cols, rows: body.rows });
      return J(res, 200, { ok: true, method: 'builtin', ...task, taskFile, port: PORT_BRIDGE, ...t });
    }
    /* 系统终端那条不真 open（不想在跑门的时候往屏幕上弹窗口），只回成功 */
    return J(res, 200, { ok: true, method: 'external', ...task, taskFile, terminal: '（探针不真开）' });
  }
  if (url === '/terminal/attach') {
    let raw = ''; req.on('data', c => raw += c);
    await new Promise(r => req.on('end', r));
    const id = String(JSON.parse(raw || '{}').sessionId || '');
    if (!terminal.sessions.has(id)) return J(res, 404, { error: { message: 'gone' } });
    return J(res, 200, { ok: true, port: PORT_BRIDGE, ...terminal.issue({ attach: id }) });
  }
  J(res, 404, { error: { code: 'not_found' } });
});
bridge.on('upgrade', (req, s, h) => terminal.handleUpgrade(req, s, h));

/* ── 静态页 ───────────────────────────────────────────────── */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json' };
const site = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('no'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(res);
});

/* 终端屏幕上的字（xterm 画在 canvas 上，读不出来 —— 只能从它自己的 buffer 拿） */
const screen = p => p.evaluate(() => {
  if (!window.UWT || !UWT.term) return '';
  const b = UWT.term.buffer.active, L = [];
  for (let i = 0; i < b.length; i++) { const l = b.getLine(i); if (l) L.push(l.translateToString(true)); }
  return L.join('\n');
});

(async () => {
  await new Promise((r, j) => { bridge.once('error', j); bridge.listen(PORT_BRIDGE, '127.0.0.1', r); })
    .catch(e => {
      console.log('❌ 端口 ' + PORT_BRIDGE + ' 被占用（' + e.code + '）—— 真桥还在跑。先：');
      console.log('   launchctl bootout gui/$(id -u)/com.ued.uw-bridge');
      process.exit(2);
    });
  await new Promise(r => site.listen(PORT_PAGE, '127.0.0.1', r));

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--window-size=1440,900'] });
  const p = await browser.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e.message || e)));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  /* dev 开关要在页面脚本跑之前塞进去，不然 probeBridge 那一次已经过了 */
  await p.evaluateOnNewDocument(() => { try { localStorage.setItem('wb.bridge.dev', '1'); } catch (e) {} });
  await p.goto('http://127.0.0.1:' + PORT_PAGE + '/index.html', { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1800);

  console.log('\n【1】桥与终端能力');
  const cap = await p.evaluate(() => {
    const B = window.wbBridge;
    return { ok: !!(B && B.ok), t: (B && B.info && B.info.terminal) || null, can: typeof window.wbHandoff === 'function' };
  });
  ok('页面探到桥', cap.ok);
  ok('读到terminal能力', !!cap.t, cap.t ? JSON.stringify(cap.t).slice(0, 90) : '');
  ok('两条路都报可用', !!(cap.t && cap.t.external && cap.t.ok));
  ok('window.wbHandoff已注入', cap.can);

  console.log('\n【2】向导走到收尾');
  await p.evaluate(() => { S.scene = 'design'; if (window.render) render(); });
  await sleep(400);
  await p.evaluate(() => window.pick(0));           // design/0 = 交互稿
  await sleep(1500);
  const openWiz = await p.evaluate(() => document.getElementById('wizmask').classList.contains('wzon'));
  ok('向导弹层打开', openWiz);
  const steps = await p.evaluate(() => wzDef().steps.length);
  for (let i = 0; i < steps - 1; i++) { await p.evaluate(() => wzNext()); await sleep(150); }
  const fin = await p.evaluate(() => {
    const b = document.getElementById('wzAsk');
    return { shown: !b.hidden, label: b.textContent.trim(), onclick: b.getAttribute('onclick') };
  });
  ok('最后一步出现收尾按钮', fin.shown);
  ok('按钮文案是「下一步：交给谁做」', fin.label === '下一步：交给谁做', '实际「' + fin.label + '」');
  ok('按钮接的是wzHandoff', /wzHandoff/.test(fin.onclick || ''));

  /* 🔴 向导本来的规则：一项都没答不许接力（wzAsk.disabled = n===0）。
     第一版探针直接 evaluate(wzHandoff()) 把按钮状态绕过去了 —— 截图里才看出它是灰的。
     绕过按钮的探针测不到「同事到底点不点得动」。 */
  const gate0 = await p.evaluate(() => document.getElementById('wzAsk').disabled);
  ok('一项都没答时收尾按钮点不动', gate0 === true);
  await p.evaluate(() => { /* 选项是 <label class="wz-opt"> 挂 onclick，不是 input[type=checkbox] —— 第一版选错了 */
    const b = document.querySelector('.wizmask .wz-opt'); if (b) b.click(); });
  await sleep(400);
  const gate1 = await p.evaluate(() => document.getElementById('wzAsk').disabled);
  ok('答了一项之后能点了', gate1 === false);

  console.log('\n【3】选择界面');
  await p.evaluate(() => wzHandoff());
  await sleep(900);
  const ch = await p.evaluate(() => {
    const m = document.getElementById('uwtMask');
    const opts = [...m.querySelectorAll('.uwt-opt')].map(b => ({
      t1: (b.querySelector('.uwt-on1') || {}).textContent || '',
      t2: (b.querySelector('.uwt-on2') || {}).textContent || '',
      t3: (b.querySelector('.uwt-on3') || {}).textContent || '',
      dis: b.disabled, r: b.getBoundingClientRect(),
      radius: getComputedStyle(b).borderTopLeftRadius,
    }));
    return { on: m.classList.contains('uwt-on'), opts, note: (m.querySelector('.uwt-note') || {}).textContent || '' };
  });
  ok('选择界面打开', ch.on);
  ok('给出3条路', ch.opts.length === 3, '实际 ' + ch.opts.length + ' 条');
  ok('三条都没被灰掉', ch.opts.every(o => !o.dis), ch.opts.map(o => (o.dis ? '灰' : '亮')).join('/'));
  ok('每条都有「在哪跑」和「代价」两行', ch.opts.every(o => o.t2.trim() && o.t3.trim()));
  ok('三条文案互不重复', new Set(ch.opts.map(o => o.t1)).size === 3);
  /* 🔴 「代价」那一行必须真的说出代价，不能只是夸自己。三条各自的关键词写死在这儿。 */
  ok('系统终端说了「关掉页面也不影响」', /关掉这个页面/.test(ch.opts.map(o => o.t3).join()));
  ok('页面内终端说了「桥重启会带走」', /桥重启/.test(ch.opts.map(o => o.t3).join()));
  ok('页面内问答说了「没有工具、出不了稿」', /没有工具|出不了稿/.test(ch.opts.map(o => o.t3).join()));
  ok('选项圆角是卡片级12px（全站 --box-r）', ch.opts.every(o => o.radius === '12px'), ch.opts.map(o => o.radius).join('/'));
  const overlap = ch.opts.some((o, i) => i && o.r.top < ch.opts[i - 1].r.bottom - 0.5);
  ok('选项之间不重叠', !overlap);
  ok('底部说了任务单落到哪', /UW工作区/.test(ch.note), ch.note.slice(0, 60));

  console.log('\n【4】页面内终端（真ws + 真pty，跑的是bash）');
  await p.evaluate(() => uwtGo('builtin'));
  await sleep(3500);
  const dr = await p.evaluate(() => {
    const d = document.getElementById('uwtDrawer');
    return {
      on: d.classList.contains('uwt-on'),
      /* 🔴 别查 .hidden 属性 —— [hidden] 的 display:none 优先级低于 class 里的
         display:flex，属性是 true 但东西还铺在屏幕上。量实际几何。 */
      boot: document.getElementById('uwtBoot').getBoundingClientRect().height === 0,
      cols: (window.UWT && UWT.term) ? UWT.term.cols : 0,
      rows: (window.UWT && UWT.term) ? UWT.term.rows : 0,
      sid: (window.UWT && UWT.sid) || null,
      sub: document.getElementById('uwtDsub').textContent,
      w: d.getBoundingClientRect().width,
      /* 🔴 xterm 5.5 默认是 DOM 渲染器，canvas 要另装 addon —— 第一版查 canvas 数量
         报 0，那是探针断言错，不是页面坏。查它真正会渲出来的 .xterm-rows。 */
      rows_el: d.querySelectorAll('.xterm-rows').length,
    };
  });
  ok('抽屉打开', dr.on);
  ok('「正在起终端」真的不占地方了（量几何不查属性）', dr.boot);
  ok('xterm真的建起来了', dr.rows_el > 0, dr.rows_el + ' 个 .xterm-rows');
  ok('列数按抽屉宽度算过（不是默认80）', dr.cols > 40, dr.cols + '×' + dr.rows);
  ok('拿到sessionId', !!dr.sid);
  ok('标题栏显示任务目录', /^20\d{6}-/.test(dr.sub.trim()), dr.sub);
  ok('抽屉宽度在560~980之间', dr.w >= 560 && dr.w <= 980, Math.round(dr.w) + 'px');

  /* ── 分区（吉吉 2026-09-09 走查：终端不许遮挡页面原有内容区）──
     这一组量的是几何，不是看截图：终端左边缘必须落在主内容右边缘之外，
     一像素重叠都算遮挡。 */
  console.log('\n【4.5】分区 · 终端不许压住主内容');
  const sp = await p.evaluate(() => {
    const app = document.querySelector('.app').getBoundingClientRect();
    const dr = document.getElementById('uwtDrawer').getBoundingClientRect();
    const wm = document.getElementById('wizmask');
    const wmOn = wm.classList.contains('wzon');
    const wmr = wm.getBoundingClientRect();
    return { split: document.documentElement.classList.contains('uwt-split'),
             appW: Math.round(app.width), appRight: Math.round(app.right),
             drLeft: Math.round(dr.left), drW: Math.round(dr.width),
             vw: window.innerWidth, wmOn, wmRight: Math.round(wmr.right),
             grip: !!document.getElementById('uwtGrip') };
  });
  ok('<html> 挂上了 .uwt-split', sp.split);
  ok('主内容收窄了（不再是整个视口宽）', sp.appW < sp.vw - 200, sp.appW + ' / 视口 ' + sp.vw);
  ok('终端左边缘不压主内容右边缘', sp.drLeft >= sp.appRight - 1,
     '主内容右 ' + sp.appRight + ' · 终端左 ' + sp.drLeft);
  ok('两栏加起来正好铺满视口', Math.abs(sp.appW + sp.drW - sp.vw) <= 2,
     sp.appW + ' + ' + sp.drW + ' = ' + (sp.appW + sp.drW) + ' vs ' + sp.vw);
  ok('向导弹层也让出了那一栏', !sp.wmOn || sp.wmRight <= sp.drLeft + 1,
     sp.wmOn ? '弹层右 ' + sp.wmRight : '（弹层没开）');

  /* 🔴 逐个列举分区规则会漏。第一版只给 .app 和 .wizmask 加了偏移、漏了 .uwt-mask
     （选三条路那个弹层），它自己在整个视口居中、白框右边 216px 压在终端底下，
     吉吉走查才发现 —— 而当时探针只断言了 .wizmask，覆盖不全。
     所以这条改成**通用**的：body 下每一个可见层、以及弹层里居中的白框，
     右边界都不许越过终端左边缘。以后再加浮层，漏了这条门就会红。 */
  await p.evaluate(() => { UWT.payload = { card: '交互稿', prompt: 'x' }; return window.wbHandoff(UWT.payload); });
  await sleep(700);
  const cover = await p.evaluate(() => {
    const dr = document.getElementById('uwtDrawer').getBoundingClientRect();
    const bad = [];
    [...document.body.children].forEach(el => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (cs.display === 'none' || r.width < 40 || r.height < 20) return;
      if (el.id === 'uwtDrawer') return;
      if (Math.round(r.right) > Math.round(dr.left) + 1)
        bad.push((el.id || el.className) + ' 右' + Math.round(r.right));
    });
    /* 铺满型遮罩即使自己铺满也无所谓，真正会被压的是里面居中的那个白框 */
    const boxes = ['uwtBox', 'wiz'];
    boxes.forEach(k => {
      const el = document.getElementById(k) || document.querySelector('.' + k);
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width > 40 && Math.round(r.right) > Math.round(dr.left) + 1)
        bad.push('白框 ' + k + ' 右' + Math.round(r.right));
    });
    return { bad, drLeft: Math.round(dr.left) };
  });
  ok('开着终端时没有任何浮层被压住（含选三条路那个弹层）', cover.bad.length === 0,
     cover.bad.length ? cover.bad.join('，') + ' vs终端左 ' + cover.drLeft : '终端左 ' + cover.drLeft);
  await p.evaluate(() => uwtCloseChooser());
  await sleep(300);

  /* 分隔条要「看得见能拖」，不是只有 hover 才显形 —— 吉吉看不出那儿能拖，等于没做 */
  const gripVis = await p.evaluate(() => {
    const g = document.getElementById('uwtGrip');
    const line = getComputedStyle(g, '::after').backgroundColor;
    const knob = getComputedStyle(g, '::before');
    const tr = v => /rgba\(0, 0, 0, 0\)|transparent/.test(v);
    return { line, knobBg: knob.backgroundColor, knobH: knob.height,
             lineOn: !tr(line), knobOn: !tr(knob.backgroundColor) };
  });
  /* 2026-09-09 终端改成页面里的一张卡之后，分界由卡片边承担，不再画整条线；能拖的信号只靠常驻握把 */
  ok('分隔条不再画整条线（卡片边就是分界）', !gripVis.lineOn, gripVis.line);
  ok('分隔条常态就有握把（让人看出能拖）', gripVis.knobOn, gripVis.knobBg + ' 高' + gripVis.knobH);
  ok('有分隔条可以拖', sp.grip);

  /* 拖一下，看宽度真的变了并且存住 */
  const before = sp.drW;
  const gb = await p.evaluate(() => {
    const r = document.getElementById('uwtGrip').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  await p.mouse.move(gb.x, gb.y);
  await p.mouse.down();
  await p.mouse.move(gb.x - 160, gb.y, { steps: 8 });
  await p.mouse.up();
  await sleep(500);
  const after = await p.evaluate(() => ({
    drW: Math.round(document.getElementById('uwtDrawer').getBoundingClientRect().width),
    appW: Math.round(document.querySelector('.app').getBoundingClientRect().width),
    saved: (() => { try { return localStorage.getItem('wb.term.w'); } catch (e) { return null; } })(),
    cols: (window.UWT && UWT.term) ? UWT.term.cols : 0,
  }));
  ok('拖分隔条改宽了终端', after.drW > before + 100, before + ' → ' + after.drW);
  ok('主内容跟着变窄', after.appW < sp.appW, sp.appW + ' → ' + after.appW);
  ok('宽度存进了localStorage', !!after.saved, String(after.saved));
  ok('终端列数跟着重算了', after.cols > 40, after.cols + ' 列');

  /* 往终端里真敲一句，看回显 —— 这一条打通的是 onData → ws → pty → onData → xterm 整条 */
  await p.evaluate(() => { UWT.ws.send(JSON.stringify({ type: 'input', data: 'echo UWT-ROUNDTRIP-OK\n' })); });
  await sleep(1500);
  const sc = await screen(p);
  ok('敲进去的命令有回显（整条链路通）', /UWT-ROUNDTRIP-OK/.test(sc), sc.split('\n').filter(l => l.trim()).slice(-2).join(' / ').slice(0, 80));

  console.log('\n【5】粘任务单（bracketed paste）');
  await p.evaluate(() => { UWT.ws.send(JSON.stringify({ type: 'input', data: 'cat > /dev/null\n' })); });
  await sleep(500);
  await p.evaluate(() => uwtPasteTask());
  await sleep(1200);
  const sc2 = await screen(p);
  /* 任务单是多行的。没套 bracketed paste 的话 bash 会把每个换行当回车执行，
     屏幕上会冒出一串 command not found；套上了就是整段进到同一次输入里。 */
  ok('粘进去了', /要做什么|做交互稿|自测/.test(sc2) || sc2.length > sc.length);
  ok('没被拆成一堆命令（bracketed paste生效）', !/command not found/.test(sc2),
    (sc2.match(/command not found/g) || []).length + ' 次command not found');

  console.log('\n【6】收起 ≠ 结束');
  await p.evaluate(() => uwtHide());
  await sleep(600);
  const afterHide = await p.evaluate(() => ({
    on: document.getElementById('uwtDrawer').classList.contains('uwt-on'),
    split: document.documentElement.classList.contains('uwt-split'),
    appW: Math.round(document.querySelector('.app').getBoundingClientRect().width),
    vw: window.innerWidth,
  }));
  ok('抽屉收起了', !afterHide.on);
  ok('分区也撤了，主内容恢复整宽', !afterHide.split && Math.abs(afterHide.appW - afterHide.vw) <= 2,
     afterHide.appW + ' / ' + afterHide.vw);
  ok('会话还活着（收起不杀进程）', terminal.list().length === 1, terminal.list().length + ' 个会话');
  /* 🔴 吉吉：「点了收起终端的按钮，但没有再打开的按钮和途径」。
     会话还活着却没有入口 = 活丢了。右边缘要亮出把手。 */
  await sleep(900);
  const re = await p.evaluate(() => {
    const b = document.getElementById('uwtReopen');
    const r = b.getBoundingClientRect();
    return { on: b.classList.contains('uwt-on'), w: Math.round(r.width), h: Math.round(r.height),
             right: Math.round(r.right), vw: window.innerWidth,
             label: (document.getElementById('uwtRlabel') || {}).textContent || '' };
  });
  ok('收起后右边缘亮出「回去」的把手', re.on && re.w > 10 && re.h > 20, re.w + '×' + re.h + ' 「' + re.label + '」');
  /* 2026-09-09 换成右下角的胶囊（不再是贴右边缘的竖条）：右边距 20px，要在视口内 */
  ok('把手在视口内、贴右下角', re.right <= re.vw - 8 && re.right >= re.vw - 60, re.right + ' / ' + re.vw);

  console.log('\n【7】接回去（点右边缘那个把手，不是调函数）');
  await p.evaluate(() => { UWT.payload = null; });
  await p.click('#uwtReopen');
  await sleep(2500);
  const reat = await p.evaluate(() => ({
    on: document.getElementById('uwtDrawer').classList.contains('uwt-on'),
    boot: document.getElementById('uwtBoot').getBoundingClientRect().height === 0,
  }));
  ok('抽屉又开了', reat.on);
  ok('接上了（不是卡在起终端）', reat.boot);
  const sc3 = await screen(p);
  ok('把断开之前的内容重放回来了', /UWT-ROUNDTRIP-OK/.test(sc3));

  console.log('\n【8】结束');
  await p.evaluate(() => uwtKill());
  await sleep(1200);
  ok('会话被收掉了', terminal.list().length === 0, terminal.list().length + ' 个会话');
  await sleep(400);
  const gone = await p.evaluate(() => ({
    reopen: document.getElementById('uwtReopen').classList.contains('uwt-on'),
    split: document.documentElement.classList.contains('uwt-split'),
  }));
  ok('结束之后把手也收掉了（别指向一个不存在的会话）', !gone.reopen);
  ok('结束之后分区也撤了', !gone.split);

  console.log('\n【9】桥不在的时候');
  await p.evaluate(() => { window.wbBridge.ok = false; });
  await p.evaluate(() => { UWT.payload = { card: '交互稿', prompt: 'x' }; return window.wbHandoff(UWT.payload); });
  await sleep(800);
  const off = await p.evaluate(() => {
    const m = document.getElementById('uwtMask');
    const opts = [...m.querySelectorAll('.uwt-opt')];
    return { dis: opts.map(o => o.disabled), note: (m.querySelector('.uwt-note') || {}).textContent || '' };
  });
  ok('前两条灰掉', off.dis[0] === true && off.dis[1] === true, off.dis.join('/'));
  ok('第三条（页面内问答）还能点', off.dis[2] === false);
  ok('说清了为什么不能用', /安装命令|接上/.test(off.note), off.note.slice(0, 50));

  console.log('\n【10】JS错误');
  /* 抽屉关的时候 xterm 有时会抱怨尺寸为 0，那不是真错，单独放掉 */
  const real = errs.filter(e => !/dimensions|renderer|Cannot read properties of null \(reading 'dimensions'\)/i.test(e));
  ok('没有JS错误', real.length === 0, real.slice(0, 3).join(' | ').slice(0, 200));

  if (OUT) {
    await p.evaluate(() => { window.wbBridge.ok = true; uwtCloseChooser(); });
    await p.evaluate(() => { UWT.payload = { card: '交互稿', prompt: '截图用', chars: 812 }; return window.wbHandoff(UWT.payload); });
    await sleep(700);
    await p.screenshot({ path: path.join(OUT, 'terminal-chooser.png') });
    console.log('\n截图：' + path.join(OUT, 'terminal-chooser.png'));
  }

  await browser.close();
  terminal.closeAll();
  bridge.close(); site.close();
  console.log('\n═══ ' + pass + ' 过 / ' + fail + ' 红 ═══');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('探针自己挂了：', e); try { terminal.closeAll(); } catch (x) {} process.exit(3); });
