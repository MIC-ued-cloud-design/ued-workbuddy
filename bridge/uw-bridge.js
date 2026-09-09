#!/usr/bin/env node
/**
 * UW 本机桥 · 让 UED WorkBuddy 页面用上你电脑里的 Claude Code
 *
 * 它做一件事：在 127.0.0.1:17331 上听着，把页面发来的 OpenAI 兼容请求
 * 转成一次 `claude -p`（无界面的 Claude Code），再把回答一边生成一边传回页面。
 *
 * 为什么要经 Claude Code 而不是直接调 Anthropic 接口：
 *   · 用的是你自己的席位，不用另办密钥、不用掏钱
 *   · 出网走的是公司 FCF 给 Claude Code 配的代理和上报，跟你平时敲 claude 一模一样
 *
 * 三把锁（都在代码里，不靠自觉）：
 *   ① 只绑 127.0.0.1 —— 局域网里别的机器连不上
 *   ② 只认 UW 线上地址这一个来源 —— 别的网页、本地文件调它一律 403
 *   ③ 拉起 Claude 时关掉全部工具、不加载 MCP、不加载你的个人设置 ——
 *      它只能「读题回答」，读不了你电脑上的文件，也不会触发你自己装的钩子
 *
 * 用法：
 *   node uw-bridge.js            一直在后台跑（install.sh 会把它设置成开机自动启动）
 *   node uw-bridge.js --check    真答一句确认能跑通，打印结果后退出
 *   node uw-bridge.js --dev      开发用：额外放行 Origin 为 null / http://localhost 的请求
 *
 * 零依赖，Node 18+。
 */
'use strict';

const http   = require('http');
const { spawn, spawnSync } = require('child_process');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

/* 拉起终端那两条路住在隔壁文件里。用 try 包着：装到一半只下来一个文件时，
   桥照样能起、问答照样能用，只是终端标成不可用 —— 半装状态别让整个桥起不来。 */
let TERM = null, TERM_ERR = null;
try { TERM = require('./uw-terminal'); } catch (e) { TERM_ERR = e.message; }

const VERSION   = '1.3.0';   // 1.3.0（2026-09-09）：拉起终端两条路（系统终端 / 页面内终端）—— 见 uw-terminal.js
// 1.2.0（2026-09-09）：--effort low —— 首字 42 秒里有 37.7 秒是 extended thinking，页面那段全在转圈
// 1.1.0（2026-09-09）：读网页 —— 用独立 Chrome 取正文当资料，Claude 仍不开任何工具
const HOST      = '127.0.0.1';
const PORT      = Number(process.env.UW_BRIDGE_PORT) || 17331;   // 环境变量只给验证脚本用，正式装的都是 17331
const ALLOW     = ['https://mic-ued-cloud-design.github.io'];   // 锁②：只认这个来源
const DEV       = process.argv.includes('--dev');
const CHECK     = process.argv.includes('--check');
const MAX_BUSY  = 2;            // 同时最多跑几个 Claude；再来的排队会拖慢所有人，直接 429 让页面提示
const TIMEOUT   = 180000;       // 单次上限 3 分钟
/* 思考档位。2026-09-09 实测（同一张 GSSM 表、同一份 14 段资料）：
     默认档 首字 42.4s / 总 63.7s，其中 thinking 占 37.7s —— 页面只渲染 text_delta，那 37 秒同事看到的是纯转圈；
     medium 首字  9.4s / 总 31.1s；low 首字 7.1s / 总 26.2s。
   UW 的活是查资料和写表，不是做决策，low 够用；代价是它对格式类指令更松
   （实测会把出处标成「（资料 3）」这种只有模型看得见的序号），已在页面 SYS 规则 5 里写硬补回。
   要调档不用改代码：起桥前设 UW_EFFORT=medium。 */
const EFFORT    = process.env.UW_EFFORT || 'low';
const MAX_BODY  = 1024 * 1024;  // 请求体上限 1MB（资料段落 + 4 轮历史远小于这个数）
const MODEL_DEF = 'opus';     // 页面没指定时的兜底；页面自己发的是 opus（2026-09-09 起）
const MODEL_OK  = /^(sonnet|haiku|opus|claude-[a-z0-9-]+)$/;   // 只放行这几种写法，别让页面拿它跑别的

/* ── 读网页：用一个独立的 Chrome 取页面正文，当资料喂给 Claude ──
   为什么不是 WebFetch / 不是让 Claude 自己开浏览器（2026-09-09 三条都实测过）：
     · WebFetch / curl 打 MIC 搜索页一律 404 或跳验证码 —— MIC 只认真浏览器；
     · 让 Claude 经 chrome-devtools MCP 自己开页：101 张产品卡的无障碍快照太大被存成文件，
       它没有读文件的工具，只能回头要 evaluate_script —— 那等于放开在浏览器里跑任意脚本；
     · 桥自己用 DevTools 协议开页取 innerText，Claude 一个工具都不开，锁不变，还少两三轮往返。
   Chrome 用独立 profile（~/.uw-bridge/chrome-profile），不碰同事日常的 Chrome；
   用 --remote-debugging-pipe 走管道，机器上不开调试端口，别的程序接不进来。
   🔴 必须带窗口：--headless=new 同样的参数 MIC 直接回{"message":"Forbidden"}（实测）。
   🔴 网址白名单在这里而不在页面上：页面是公网静态页，谁都能改它发来的东西。 */
const WEB_ALLOW     = ['made-in-china.com', 'vemic.com'];   // 含所有子域
const WEB_MAX_URLS  = 3;
const WEB_MAX_CHARS = 12000;     // 每页正文上限：主搜结果页 101 张卡约 1.8 万字，截到这里够回答，也不把 Claude 的输入撑爆
const WEB_LOAD_MS   = 20000;     // 等 load 事件的上限
const WEB_SETTLE_MS = 1500;      // load 之后再等一下懒加载
const CHROME_PATHS  = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                       path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')];
const CHROME_PROFILE = path.join(os.homedir(), '.uw-bridge', 'chrome-profile');
function findChrome(){ return CHROME_PATHS.find(p => fs.existsSync(p)) || null; }
function webAllowed(u){
  let h; try { const x = new URL(u); if (!/^https?:$/.test(x.protocol)) return false; h = x.hostname.toLowerCase(); } catch (e) { return false; }
  return WEB_ALLOW.some(d => h === d || h.endsWith('.' + d));
}
let chrome = null;   // { proc, send(), listeners, alive }
function launchChrome(){
  return new Promise((resolve, reject) => {
    const exe = findChrome();
    if (!exe) return reject(Object.assign(new Error('这台电脑上没找到Google Chrome'), { code: 'no_chrome' }));
    fs.mkdirSync(CHROME_PROFILE, { recursive: true });
    const proc = spawn(exe, ['--remote-debugging-pipe', '--user-data-dir=' + CHROME_PROFILE,
      '--no-first-run', '--no-default-browser-check', '--disable-blink-features=AutomationControlled',
      '--window-size=1200,860', '--window-position=60,60', 'about:blank'],
      { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
    const c = { proc, id: 0, pending: new Map(), listeners: new Set(), alive: true };
    let buf = '';
    proc.stdio[4].on('data', d => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\0')) >= 0) {
        const raw = buf.slice(0, i); buf = buf.slice(i + 1);
        let m; try { m = JSON.parse(raw); } catch (e) { continue; }
        if (m.id && c.pending.has(m.id)) {
          const { res, rej } = c.pending.get(m.id); c.pending.delete(m.id);
          m.error ? rej(new Error(m.error.message || 'CDP错误')) : res(m.result || {});
        } else if (m.method) { for (const h of c.listeners) { try { h(m); } catch (e) {} } }
      }
    });
    c.send = (method, params, sessionId) => new Promise((res, rej) => {
      if (!c.alive) return rej(new Error('Chrome已退出'));
      const id = ++c.id; c.pending.set(id, { res, rej });
      const o = { id, method, params: params || {} }; if (sessionId) o.sessionId = sessionId;
      proc.stdio[3].write(JSON.stringify(o) + '\0');
      setTimeout(() => { if (c.pending.has(id)) { c.pending.delete(id); rej(new Error('Chrome没在30秒内响应 ' + method)); } }, 30000);
    });
    proc.on('exit', () => {
      c.alive = false; if (chrome === c) chrome = null;
      for (const { rej } of c.pending.values()) rej(new Error('Chrome已退出'));
      c.pending.clear(); log('chrome退出');
    });
    proc.on('error', e => { c.alive = false; reject(e); });
    c.send('Browser.getVersion').then(v => { c.version = v.product; log('chrome起了', v.product || ''); resolve(c); }, reject);
  });
}
async function getChrome(){ if (chrome && chrome.alive) return chrome; chrome = await launchChrome(); return chrome; }
function closeChrome(){ if (chrome && chrome.alive) { try { chrome.proc.kill(); } catch (e) {} } chrome = null; }
async function fetchPage(url){
  const c = await getChrome();
  const { targetId } = await c.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await c.send('Target.attachToTarget', { targetId, flatten: true });
  try {
    await c.send('Page.enable', {}, sessionId);
    const loaded = new Promise(res => {
      const h = m => { if (m.sessionId === sessionId && m.method === 'Page.loadEventFired') { c.listeners.delete(h); res(true); } };
      c.listeners.add(h);
      setTimeout(() => { c.listeners.delete(h); res(false); }, WEB_LOAD_MS);
    });
    const nav = await c.send('Page.navigate', { url }, sessionId);
    if (nav.errorText) throw new Error('打不开：' + nav.errorText);
    const ok = await loaded;
    await new Promise(r => setTimeout(r, WEB_SETTLE_MS));
    const r = await c.send('Runtime.evaluate', { returnByValue: true, expression:
      '(function(){var t=document.body?document.body.innerText:"";' +
      't=t.replace(/[ \\t\\u00a0]+/g," ").replace(/\\s*\\n\\s*/g,"\\n").replace(/\\n{3,}/g,"\\n\\n");' +
      'return JSON.stringify({url:location.href,title:document.title,len:t.length,text:t.slice(0,' + WEB_MAX_CHARS + ')})})()' }, sessionId);
    const out = JSON.parse(r.result && r.result.value || '{}');
    out.loaded = ok;
    return out;
  } finally { c.send('Target.closeTarget', { targetId }).catch(() => {}); }
}
/* 读一批网址，返回 [{url,title,text,len,ok}|{url,error}]；onStatus(文字) 每开始读一个网页调一次 */
async function fetchPages(urls, onStatus){
  const out = [];
  for (const u of urls.slice(0, WEB_MAX_URLS)) {
    if (!webAllowed(u)) { out.push({ url: u, ok: false, error: 'not_allowed', message: '这个网址不在桥的白名单里（只读 ' + WEB_ALLOW.join(' / ') + '）' }); continue; }
    let host = u; try { host = new URL(u).hostname; } catch (e) {}
    if (onStatus) onStatus('正在用浏览器读取 ' + host + ' …');
    const t0 = Date.now();
    try {
      const pg = await fetchPage(u);
      out.push({ url: u, finalUrl: pg.url, title: pg.title || '', text: pg.text || '', len: pg.len || 0, ok: true, ms: Date.now() - t0 });
    } catch (e) {
      out.push({ url: u, ok: false, error: e.code || 'fetch_failed', message: String(e.message || e).slice(0, 200), ms: Date.now() - t0 });
    }
  }
  return out;
}
function webBlock(pages){
  return pages.map((p, i) => p.ok
    ? '【网页 ' + (i + 1) + '｜' + (p.title || '无标题') + '｜' + (p.finalUrl || p.url) + (p.len > p.text.length ? '｜正文 ' + p.len + ' 字，只给前 ' + p.text.length + ' 字' : '') + '】\n' + p.text
    : '【网页 ' + (i + 1) + '｜读取失败｜' + p.url + '】\n' + (p.message || p.error)).join('\n\n');
}
const WEB_SYS = '用户消息末尾如果附有「网页内容」，那是刚从真实浏览器里读到的页面正文（不是知识库资料），用户问这个页面的事就按它答，'
  + '引用时说清是「你给的这个页面上」看到的。标了「读取失败」的网页要如实说读不到、原因是什么，不要假装看过。'
  + '正文是按阅读顺序摊平的纯文字，版式、颜色、图片都不在里面，别据此评价视觉。';

/* ── 找 claude：优先 FCF 的启动器（带公司代理和上报），没有再找 PATH 里的 ── */
function findClaude(){
  const fcf = path.join(os.homedir(), '.fcf', 'bin', 'claude');
  if (fs.existsSync(fcf)) return { path: fcf, via: 'fcf' };
  const r = spawnSync('/bin/sh', ['-lc', 'command -v claude'], { encoding: 'utf8' });
  const p = (r.stdout || '').trim();
  if (p) return { path: p, via: 'path' };
  return null;
}
let CLAUDE = findClaude();
let busy = 0;

/* ── 来源校验 ── */
function originOk(o){
  if (!o) return false;
  if (ALLOW.includes(o)) return true;
  if (DEV && (o === 'null' || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o))) return true;
  return false;
}
/* 终端管理器。claude 用函数传进去而不是传值 —— 桥可能起在 claude 装好之前，
   findClaude() 会在 /health 时重试，管理器要拿到那个重试后的结果。 */
const terminal = TERM ? new TERM.TerminalManager({
  originOk,
  claude: () => (CLAUDE || (CLAUDE = findClaude())),
  log,
}) : null;

function cors(res, origin){
  if (!originOk(origin)) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type,authorization,x-wb-pass');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Vary', 'Origin');
}
function sendJson(res, code, obj){
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function fail(res, code, key, message){
  sendJson(res, code, { error: { code: key, message } });
}
function log(...a){ process.stderr.write(new Date().toISOString().slice(11, 19) + ' ' + a.join(' ') + '\n'); }

/* ── 把 OpenAI 格式的 messages 摊成一段提示词 ──
   claude -p 一次只吃一段输入，所以历史轮次写进正文；system 单独走 --system-prompt。 */
function flatten(messages){
  const sys = [], turns = [];
  for (const m of messages) {
    const c = typeof m.content === 'string' ? m.content
            : Array.isArray(m.content) ? m.content.map(x => x && x.text || '').join('\n') : '';
    if (m.role === 'system') sys.push(c);
    else if (m.role === 'user' || m.role === 'assistant') turns.push({ role: m.role, c });
  }
  if (!turns.length || turns[turns.length - 1].role !== 'user') throw new Error('最后一条必须是用户消息');
  const last = turns.pop().c;
  let prompt = last;
  if (turns.length) {
    prompt = '以下是这次对话之前的几轮，供你接着往下答（「用户」是提问的人，「助手」是你）：\n\n'
      + turns.map(t => (t.role === 'user' ? '用户：' : '助手：') + t.c).join('\n\n')
      + '\n\n──────────\n\n' + last;
  }
  return { system: sys.join('\n\n'), prompt };
}

/* ── 跑一次 Claude，边出边回调 ──
   onDelta(text) 每来一段文字调一次；resolve 整段回答；reject 带{code, message}。 */
function runClaude({ system, prompt, model }, onDelta, onSpawn){
  return new Promise((resolve, reject) => {
    if (!CLAUDE) { CLAUDE = findClaude(); }
    if (!CLAUDE) return reject({ code: 'no_claude', status: 503, message: '这台电脑上找不到claude命令' });

    const args = ['-p',
      '--output-format', 'stream-json', '--include-partial-messages', '--verbose',
      '--tools', '',                  // 锁③：关掉全部工具
      '--strict-mcp-config',          // 不加载任何 MCP
      '--setting-sources', '',        // 不加载个人 / 项目设置：没有钩子、没有 CLAUDE.md
      '--no-session-persistence',
      '--effort', EFFORT,            // 见文件头 EFFORT 那段：默认档的 thinking 要 37 秒，页面全程不显示
      '--model', model];
    if (system) args.push('--system-prompt', system);

    const child = spawn(CLAUDE.path, args, { stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
    if (onSpawn) onSpawn(child);
    let full = '', gotDelta = false, buf = '', err = '', done = false, result = null;
    const timer = setTimeout(() => { if (!done) { child.kill('SIGKILL'); finish({ code: 'timeout', status: 504, message: '三分钟没答完' }); } }, TIMEOUT);

    function finish(e){
      if (done) return; done = true; clearTimeout(timer);
      if (e) reject(e); else resolve({ text: full, result });
    }
    function handleLine(ln){
      if (ln[0] !== '{') return;               // FCF 启动器会先打一个横幅，横幅不是 JSON，跳过
      let ev; try { ev = JSON.parse(ln); } catch (_) { return; }
      if (ev.type === 'stream_event' && ev.event && ev.event.type === 'content_block_delta'
          && ev.event.delta && ev.event.delta.type === 'text_delta') {
        const t = ev.event.delta.text || '';
        if (t) { full += t; gotDelta = true; onDelta(t); }
      } else if (ev.type === 'result') {
        result = ev;
        if (ev.is_error) return finish({ code: 'claude_failed', status: 502, message: String(ev.result || ev.error || 'Claude报错').slice(0, 300) });
        if (!gotDelta && typeof ev.result === 'string' && ev.result) { full = ev.result; onDelta(ev.result); }
      }
    }
    child.stdout.on('data', d => {
      buf += d.toString('utf8');
      const lines = buf.split('\n'); buf = lines.pop();
      for (const ln of lines) handleLine(ln);
    });
    child.stderr.on('data', d => { err += d.toString('utf8'); if (err.length > 4000) err = err.slice(-4000); });
    child.on('error', e => finish({ code: 'spawn_failed', status: 502, message: '拉不起Claude：' + e.message }));
    child.on('close', code => {
      if (buf) handleLine(buf);
      if (done) return;
      if (code !== 0 && !full) return finish({ code: 'claude_failed', status: 502, message: (err.trim().split('\n').pop() || ('Claude退出码 ' + code)).slice(0, 300) });
      finish(null);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
  });
}

/* ── HTTP ── */
function readBody(req){
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > MAX_BODY) { reject(new Error('too_large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  cors(res, origin);
  const url = (req.url || '/').split('?')[0];

  if (req.method === 'OPTIONS') {
    if (!originOk(origin)) return fail(res, 403, 'bad_origin', '只接受UW页面发来的请求');
    res.writeHead(204); return res.end();
  }

  if (req.method === 'GET' && (url === '/health' || url === '/')) {
    if (!CLAUDE) CLAUDE = findClaude();
    return sendJson(res, 200, {
      ok: true, name: 'uw-bridge', version: VERSION, port: PORT, dev: DEV,
      allowed: originOk(origin),                       // 页面据此判断自己能不能用，别只看 ok
      claude: { found: !!CLAUDE, via: CLAUDE ? CLAUDE.via : null },
      web: { ok: !!findChrome(), running: !!(chrome && chrome.alive), allow: WEB_ALLOW, maxUrls: WEB_MAX_URLS },   // 页面据此决定要不要把问题里的网址发过来
      /* 页面据此决定「打开系统终端」和「页面内终端」两个按钮给不给、给了要不要灰。
         external 只要有 claude 就能用；builtin 还要两个可选依赖。 */
      terminal: terminal ? Object.assign({ external: !!CLAUDE }, terminal.status())
                         : { ok: false, external: false, reason: '桥没装全：' + (TERM_ERR || '缺uw-terminal.js') },
      busy, max: MAX_BUSY,
    });
  }

  if (req.method === 'POST' && url === '/v1/chat/completions') {
    if (!originOk(origin)) return fail(res, 403, 'bad_origin', '只接受UW页面发来的请求');
    if (busy >= MAX_BUSY) return fail(res, 429, 'busy', '本机Claude正忙，同时只接 ' + MAX_BUSY + ' 个问题');
    let body;
    try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return fail(res, 400, 'bad_request', '请求体不是合法JSON或超过1MB'); }
    if (!Array.isArray(body.messages) || !body.messages.length) return fail(res, 400, 'bad_request', '缺messages');
    let flat; try { flat = flatten(body.messages); } catch (e) { return fail(res, 400, 'bad_request', e.message); }
    const model = MODEL_OK.test(String(body.model || '')) ? String(body.model) : MODEL_DEF;
    const stream = body.stream !== false;
    const urls = Array.isArray(body.urls) ? body.urls.filter(u => typeof u === 'string' && u.length < 2048).slice(0, WEB_MAX_URLS) : [];
    const id = 'uw-' + Date.now().toString(36);
    const t0 = Date.now();
    busy++;
    let child = null, sent = 0;
    req.on('close', () => { if (child && child.exitCode === null) { child.kill('SIGKILL'); } });

    const chunk = (delta, finish) => JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(t0 / 1000), model,
      choices: [{ index: 0, delta, finish_reason: finish || null }] });

    if (stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(': uw-bridge\n\n');
    }
    let pages = [];
    try {
      if (urls.length) {
        pages = await fetchPages(urls, st => { if (stream) res.write('data: ' + JSON.stringify({ id, object: 'chat.completion.chunk', uw: { status: st }, choices: [{ index: 0, delta: {}, finish_reason: null }] }) + '\n\n'); });
        flat.prompt += '\n\n──────────\n\n网页内容：\n\n' + webBlock(pages);
        flat.system = (flat.system ? flat.system + '\n\n' : '') + WEB_SYS;
      }
      const webInfo = pages.map(p => ({ url: p.url, title: p.title || '', ok: p.ok, len: p.len || 0, error: p.error || null, message: p.message || null, ms: p.ms || 0 }));
      const out = await runClaude({ system: flat.system, prompt: flat.prompt, model },
        t => { sent += t.length; if (stream) res.write('data: ' + chunk({ content: t }) + '\n\n'); },
        c => { child = c; });
      const usage = out.result && out.result.usage ? {
        prompt_tokens: (out.result.usage.input_tokens || 0) + (out.result.usage.cache_read_input_tokens || 0) + (out.result.usage.cache_creation_input_tokens || 0),
        completion_tokens: out.result.usage.output_tokens || 0 } : undefined;
      if (stream) {
        const last = JSON.parse(chunk({}, 'stop')); if (pages.length) last.uw = { web: webInfo };
        res.write('data: ' + JSON.stringify(last) + '\n\n');
        res.write('data: [DONE]\n\n'); res.end();
      } else {
        sendJson(res, 200, { id, object: 'chat.completion', created: Math.floor(t0 / 1000), model,
          choices: [{ index: 0, message: { role: 'assistant', content: out.text }, finish_reason: 'stop' }],
          usage, uw: { turns: out.result ? out.result.num_turns : null, via: CLAUDE && CLAUDE.via, web: pages.length ? webInfo : undefined } });
      }
      log('200', model, (Date.now() - t0) + 'ms', sent + '字', pages.length ? ('web:' + pages.filter(p => p.ok).length + '/' + pages.length) : '');
    } catch (e) {
      const code = e.status || 500, key = e.code || 'error', msg = e.message || String(e);
      log(String(code), key, (Date.now() - t0) + 'ms');
      if (stream && res.headersSent) {
        // 流已经开了，只能在流里报错：页面读不到状态码，所以把错误也放进 delta 文本前面加标记
        res.write('data: ' + JSON.stringify({ id, object: 'chat.completion.chunk', error: { code: key, message: msg }, choices: [{ index: 0, delta: {}, finish_reason: 'error' }] }) + '\n\n');
        res.write('data: [DONE]\n\n'); res.end();
      } else if (!res.headersSent) {
        fail(res, code, key, msg);
      }
    } finally { busy--; }
    return;
  }

  /* ── 拉起终端 ──────────────────────────────────────────
     一个端点管两条路，method 决定走哪条：
       external → 建目录 + 写 task.md + 写自删脚本 + open -a，回「开在哪个终端里了」
       builtin  → 建目录 + 写 task.md + 发一张一次性票，页面拿票连 ws
     两条路的目录和 task.md 完全一样 —— 换路不换产物，同事换个方式打开看到的是同一份活。 */
  if (req.method === 'POST' && url === '/launch') {
    if (!originOk(origin)) return fail(res, 403, 'bad_origin', '只接受UW页面发来的请求');
    if (!terminal) return fail(res, 503, 'no_terminal', '这个桥没装终端功能，重跑一次安装命令');
    if (!CLAUDE) CLAUDE = findClaude();
    if (!CLAUDE) return fail(res, 503, 'no_claude', '这台电脑上没找到claude，先装Claude Code');

    let body;
    try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return fail(res, 400, 'bad_request', '请求体不是合法JSON或超过1MB'); }
    const method = body.method === 'builtin' ? 'builtin' : 'external';
    if (method === 'builtin' && !terminal.status().ok) {
      return fail(res, 503, 'no_pty', terminal.status().reason || '页面内终端不可用');
    }

    let task, taskFile;
    try {
      task = TERM.makeTaskDir(body.task || body.card || '任务');
      taskFile = TERM.writeTaskFile(task.dir, {
        card: body.card, scene: body.scene, prompt: body.prompt,
        docs: Array.isArray(body.docs) ? body.docs.slice(0, 60).map(String) : [],
        out:  Array.isArray(body.out)  ? body.out.slice(0, 30).map(String)  : [],
        skills: Array.isArray(body.skills) ? body.skills.slice(0, 20) : [],
        file: body.file ? String(body.file) : '',
      });
    } catch (e) { return fail(res, 500, 'mkdir_failed', '建任务目录失败：' + e.message); }
    log('任务目录 ' + task.dir + ' · 走' + (method === 'builtin' ? '页面内终端' : '系统终端'));
    const common = { method, dir: task.dir, rel: task.rel, root: task.root, taskFile };

    if (method === 'builtin') {
      const t = terminal.issue({ ...task, title: String(body.card || '任务终端').slice(0, 40),
                                 cols: body.cols | 0 || 100, rows: body.rows | 0 || 30 });
      return sendJson(res, 200, { ok: true, ...common, port: PORT, ...t });
    }

    let script;
    try { script = TERM.writeLaunchScript(task.root, task.rel, CLAUDE.path); }
    catch (e) { return fail(res, 500, 'script_failed', '写启动脚本失败：' + e.message); }
    const opened = await TERM.openSystemTerminal(script, task.root);
    return sendJson(res, 200, opened
      ? { ok: true, ...common, terminal: opened }
      /* 打不开也别只回个失败：把目录和该敲的命令给出去，同事自己开终端也能接着干 */
      : { ok: false, ...common, error: { code: 'open_failed', message: '没能自动打开终端' },
          manual: 'cd ' + JSON.stringify(task.root) + ' && claude' });
  }

  /* 正在跑的终端会话（页面刷新后据此问「要不要接回去」） */
  if (req.method === 'GET' && url === '/terminal/sessions') {
    if (!originOk(origin)) return fail(res, 403, 'bad_origin', '只接受UW页面发来的请求');
    if (!terminal) return sendJson(res, 200, { ok: true, sessions: [] });
    return sendJson(res, 200, { ok: true, sessions: terminal.list() });
  }

  /* 接回一个还活着的会话：同样要一张票，不让 ws 那一跳凭 id 直连 */
  if (req.method === 'POST' && url === '/terminal/attach') {
    if (!originOk(origin)) return fail(res, 403, 'bad_origin', '只接受UW页面发来的请求');
    if (!terminal) return fail(res, 503, 'no_terminal', '这个桥没装终端功能');
    let body; try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return fail(res, 400, 'bad_request', '请求体不合法'); }
    const id = String(body.sessionId || '');
    if (!terminal.sessions.has(id)) return fail(res, 404, 'gone', '这个终端会话已经结束了');
    return sendJson(res, 200, { ok: true, port: PORT, ...terminal.issue({ attach: id }) });
  }

  fail(res, 404, 'not_found', '没有这个路径');
});

/* ── WebSocket 升级只走 /terminal ──
   🔴 foder 那套鉴权（Origin 必须等于 host=127.0.0.1:port）照抄必 403：
   它的页面是本地服务器自己发的、同源；UW 的页面在公网 GitHub Pages，天生不同源。
   所以这里换成「回环 socket + 来源白名单 + 一次性票」，票在 HTTP 那一跳发（那跳有 CORS 把着）。 */
server.on('upgrade', (req, socket, head) => {
  if (!terminal) { try { socket.destroy(); } catch {} return; }
  terminal.handleUpgrade(req, socket, head);
});

/* ── 启动 / 自检 ── */
if (CHECK) {
  (async () => {
    console.log('claude：' + (CLAUDE ? CLAUDE.path + '（' + CLAUDE.via + '）' : '没找到'));
    if (!CLAUDE) process.exit(2);
    const t0 = Date.now();
    try {
      const out = await runClaude({ system: '你是一个只会回答文字问题的助手。', prompt: '只回复两个字：收到', model: MODEL_DEF }, () => {});
      const u = out.result && out.result.usage || {};
      console.log('回答：' + JSON.stringify(out.text) + ' · ' + (Date.now() - t0) + 'ms · 输入 ' + (u.input_tokens || 0) + ' token'
        + ' · 工具 ' + ((out.result && out.result.num_turns) === 1 ? '未用' : '?'));
      process.exit(out.text.indexOf('收到') >= 0 ? 0 : 3);
    } catch (e) { console.log('失败：' + (e.message || e)); process.exit(3); }
  })();
} else {
  server.on('error', e => {
    if (e.code === 'EADDRINUSE') { log('端口 ' + PORT + ' 已被占用 —— 可能桥已经在跑了'); process.exit(0); }
    log('启动失败：' + e.message); process.exit(1);
  });
  server.listen(PORT, HOST, () => {
    log('uw-bridge ' + VERSION + ' 听在http://' + HOST + ':' + PORT + (DEV ? '（开发模式：放行本地来源）' : '')
      + ' · claude ' + (CLAUDE ? CLAUDE.via : '没找到') + ' · 读网页 ' + (findChrome() ? '可用（' + WEB_ALLOW.join('/') + '）' : '不可用：没找到Chrome')
      + ' · 终端 ' + (!terminal ? '不可用：' + (TERM_ERR || '缺uw-terminal.js')
                     : terminal.status().ok ? '两条路都可用' : '只有系统终端（' + terminal.status().reason + '）'));
  });
  const bye = () => { closeChrome(); if (terminal) terminal.closeAll(); };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { bye(); process.exit(0); });
  process.on('exit', bye);
}
