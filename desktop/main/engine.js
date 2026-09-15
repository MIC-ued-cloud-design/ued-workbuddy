'use strict';
/**
 * UED WorkBuddy 桌面版 · 引擎层
 *
 * 一个项目 = 一个常驻的 `claude -p` 进程（stream-json 双向）。
 *   · 用同事自己的 Claude Code：席位、代理、上报都跟平时敲 claude 一样；
 *   · 不加任何锁：skill / MCP / hooks / CLAUDE.md / memory 全在（这是「终端里的能力都有」的全部含义）；
 *   · 权限走 host：Claude 每次要动手先发 can_use_tool 给应用，应用弹卡让人点，或按设置自动放行。
 *
 * 实测判据（2026-09-10）：
 *   · 必须带 `--permission-prompt-tool stdio` 且进程一起来就先写一条 initialize 的 control_request，
 *     否则 Claude 不会发 can_use_tool，会直接 permission_denied。
 *   · FCF 启动器会先往 stdout 打彩色横幅，只认以 `{` 开头的行。
 *   · 检测和拉起都必须用登录 shell 的真实环境（见 shellenv.js）：从访达启动的应用只有最小 PATH，
 *     FCF 的 claude 脚本在那个 PATH 下找不到 npm，会直接失败。
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { loginEnv, whichAll } = require('./shellenv');

/* ── 找同事电脑上的 Claude Code ────────────────────────────
   优先 FCF 启动器（公司代理 + 上报），其次常见安装位置。 */
function candidates() {
  const h = os.homedir();
  const list = [
    path.join(h, '.fcf/bin/claude'),          // 公司启动器优先：代理与上报跟终端一致
    ...whichAll('claude'),                    // 登录 shell 真实 PATH 上的（覆盖 nvm/volta/fnm/brew 等所有装法）
    path.join(h, '.local/bin/claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    path.join(h, '.claude/local/claude'),
  ];
  try {
    const nvm = path.join(h, '.nvm/versions/node');
    for (const v of fs.readdirSync(nvm)) list.push(path.join(nvm, v, 'bin/claude'));
  } catch (e) {}
  return [...new Set(list)];
}

function detectClaude(preferred) {
  const { env, info } = loginEnv();
  const tried = [];
  const paths = preferred ? [preferred, ...candidates()] : candidates();
  for (const p of paths) {
    if (!p || !fs.existsSync(p)) { tried.push({ path: p, why: '文件不存在' }); continue; }
    const r = spawnSync(p, ['--version'], { encoding: 'utf8', timeout: 20000, env });
    const out = String((r.stdout || '') + (r.stderr || ''));
    const m = out.match(/(\d+\.\d+\.\d+)[^\n]*/);
    if (r.status === 0 && m) {
      return { ok: true, path: p, version: m[0].trim(), viaFcf: p.includes('/.fcf/'), tried, shellEnv: info };
    }
    tried.push({ path: p, why: (out.trim().split('\n')[0] || `退出码${r.status}`).slice(0, 160) });
  }
  const hint = info.gotLoginPath
    ? '已经按你终端里的PATH找过一遍了。'
    : `没能从登录shell（${info.shell}）读到PATH，只用了兜底目录 —— 如果你的claude装在别处，去设置里手动指一下路径。`;
  return { ok: false, tried, shellEnv: info,
    message: `这台电脑上没找到能跑的Claude Code。${hint}先在终端里装好并登录（终端里能敲claude才行）。` };
}

/* ── 会话 ─────────────────────────────────────────────── */
class ClaudeSession {
  /**
   * @param {object} o
   *  o.projectDir   项目文件夹 = Claude 的 cwd
   *  o.claudePath   可执行文件
   *  o.permissionMode  'default' | 'acceptEdits' | 'bypassPermissions'
   *  o.addDirs      额外允许读的目录（飞鹊包）
   *  o.systemPrompt 追加的系统提示
   *  o.model        '' 用 CLI 自己的默认
   *  o.resume       上次的 session_id（有就续）
   *  o.onEvent(ev)  归一化后的事件
   */
  constructor(o) {
    Object.assign(this, o);
    this.proc = null;
    this.busy = false;
    this.sessionId = o.resume || null;
    this.blocks = new Map();      // stream index → 'text'|'thinking'|'tool_use'
    this.pendingPerms = new Map(); // request_id → request
    this.startedAt = null;
    this.buf = '';
  }

  args() {
    const a = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--include-partial-messages', '--permission-mode', this.permissionMode || 'acceptEdits',
      '--permission-prompt-tool', 'stdio'];
    for (const d of (this.addDirs || [])) a.push('--add-dir', d);
    if (this.systemPrompt) a.push('--append-system-prompt', this.systemPrompt);
    if (this.model) a.push('--model', this.model);
    if (this.resume) a.push('--resume', this.resume);
    else a.push('--session-id', (this.sessionId = crypto.randomUUID()));
    return a;
  }

  start() {
    if (this.proc) return;
    const env = { ...loginEnv().env };   // 登录shell的真实环境：FCF脚本要npm、nvm的node要在PATH上、公司代理变量也在这儿
    delete env.CLAUDECODE;        // 别让 Claude 以为自己嵌在另一个 Claude 里
    delete env.CLAUDE_CODE_ENTRYPOINT;
    const argv = this.args();   // 🔴 只算一次：args() 有副作用（新会话时会生成 --session-id），调两次会造出两个 UUID
    this.proc = spawn(this.claudePath, argv, { cwd: this.projectDir, stdio: ['pipe', 'pipe', 'pipe'], env });
    this.startedAt = Date.now();
    this.emit({ t: 'spawn', pid: this.proc.pid, args: argv });
    // 握手：告诉 Claude 这个 host 会答权限请求
    this.write({ type: 'control_request', request_id: 'init-' + Date.now(), request: { subtype: 'initialize' } });
    this.proc.stdout.on('data', d => this.onData(d));
    this.proc.stderr.on('data', d => {
      const s = d.toString();
      this.lastErr = (this.lastErr || []).concat([s]).slice(-8);   // 留最后几段，轮次异常结束时拿它说清楚为什么
      if (/error|Error|失败/.test(s)) this.emit({ t: 'stderr', text: s.slice(0, 2000) });
    });
    this.proc.on('exit', (code, sig) => {
      this.emit({ t: 'exit', code, signal: sig, busy: this.busy });
      this.proc = null; this.busy = false;
      for (const id of this.pendingPerms.keys()) this.emit({ t: 'perm_closed', requestId: id });
      this.pendingPerms.clear();
    });
    this.proc.on('error', e => this.emit({ t: 'error', message: '拉不起Claude Code：' + e.message }));
  }

  write(obj) {
    if (!this.proc || !this.proc.stdin.writable) return false;
    this.proc.stdin.write(JSON.stringify(obj) + '\n');
    return true;
  }

  send(text) {
    if (!this.proc) this.start();
    if (this.busy) return { ok: false, message: '上一条还在跑，先等它结束或点停止。' };
    this.busy = true;
    this.turnStartedAt = Date.now();
    this.emit({ t: 'turn_start' });
    this.write({ type: 'user', message: { role: 'user', content: text } });
    return { ok: true };
  }

  respondPermission(requestId, behavior, message, updatedInput) {
    const req = this.pendingPerms.get(requestId);
    if (!req) return false;
    this.pendingPerms.delete(requestId);
    const response = behavior === 'allow'
      ? { behavior: 'allow', updatedInput: updatedInput || req.input }
      : { behavior: 'deny', message: message || '用户在UW里拒绝了这一步' };
    return this.write({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } });
  }

  /** 中断当前这一轮（进程留着，下一条还能续） */
  interrupt() {
    if (!this.proc) return false;
    return this.write({ type: 'control_request', request_id: 'int-' + Date.now(), request: { subtype: 'interrupt' } });
  }

  stop() {
    if (!this.proc) return;
    try { this.proc.stdin.end(); } catch (e) {}
    const p = this.proc;
    setTimeout(() => { try { p.kill('SIGTERM'); } catch (e) {} }, 800);
  }

  onData(d) {
    this.buf += d.toString('utf8');
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
      if (!line.startsWith('{')) continue;          // FCF 横幅等非 JSON 行
      let m; try { m = JSON.parse(line); } catch (e) { continue; }
      if (this.rawLog && m.type !== 'stream_event') { try { fs.appendFileSync(this.rawLog, line + '\n'); } catch (e) {} }   // 排障用：完整事件留在项目 .uw/events.jsonl
      this.handle(m);
    }
  }

  /* 🔴 「在跑」不能只靠我们自己发的 turn_start / 收到的 result 来记。
     实测（2026-09-10）：轮次已经 result 结束之后，Claude Code 还会自己再开一轮——
     后台任务（run_in_background 的命令、子代理）有结果回来时它会自动被唤醒继续干，
     这一轮没有我们发的 user 消息、也没有 turn_start，只有 assistant / stream_event 直接冒出来。
     那段时间界面上 busy=false：没有状态条、直播区不动、发送按钮还亮着，看起来像「动画没出现」。
     所以：只要看到模型在产出内容而我们记的是空闲，就当作新一轮开始，补一个带 resumed 标记的 turn_start。 */
  wake(reason) {
    if (this.busy) return;
    this.busy = true;
    this.turnStartedAt = Date.now();
    this.emit({ t: 'turn_start', resumed: true, reason });
  }

  handle(m) {
    switch (m.type) {
      case 'system':
        if (m.subtype === 'init') {
          this.sessionId = m.session_id || this.sessionId;
          this.emit({ t: 'init', sessionId: this.sessionId, model: m.model, tools: (m.tools || []).length,
            mcp: (m.mcp_servers || []).map(s => s.name), skills: (m.skills || m.slash_commands || []).length, cwd: m.cwd });
        } else if (m.subtype === 'permission_denied') {
          this.emit({ t: 'denied', tool: m.tool_name, message: m.message });
        } else if (m.subtype === 'status') {
          this.emit({ t: 'status', status: m.status });
        } else if (m.subtype === 'notification') {
          /* Claude Code 自己的通知，最常见的是 `stop-hook-error`（收尾钩子报错）。
             以前它只进日志文件，界面上什么都不显示，用户看到的只有一句「执行中断了」——
             把它透出来，「为什么断」才说得清。 */
          this.lastNotice = { key: m.key, text: m.text };
          this.emit({ t: 'notice', key: m.key, text: m.text });
        }
        break;
      case 'control_request': {
        const r = m.request || {};
        if (r.subtype === 'can_use_tool') {
          if (this.autoAllow) {   // 用户点过「本次任务全部放行」：这个进程余下的请求直接放行，界面上留一行记录
            this.write({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id, response: { behavior: 'allow', updatedInput: r.input } } });
            this.emit({ t: 'perm_auto', tool: r.tool_name, description: r.description });
            break;
          }
          this.pendingPerms.set(m.request_id, r);
          this.emit({ t: 'perm', requestId: m.request_id, tool: r.tool_name, input: r.input, description: r.description,
            suggestions: r.permission_suggestions || [], toolUseId: r.tool_use_id });
        } else {
          // 其它 host 请求（hook 回调等）一律成功空应答，别让进程卡住
          this.write({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id, response: {} } });
        }
        break;
      }
      case 'stream_event': {
        const ev = m.event || {};
        if (ev.type === 'message_start' || ev.type === 'content_block_start') this.wake('stream');
        if (ev.type === 'content_block_start') {
          const b = ev.content_block || {};
          this.blocks.set(ev.index, b.type);
          if (b.type === 'thinking') this.emit({ t: 'thinking_start' });
          if (b.type === 'tool_use') this.emit({ t: 'tool_start', id: b.id, name: b.name });
        } else if (ev.type === 'content_block_delta') {
          const dl = ev.delta || {};
          if (dl.type === 'text_delta') this.emit({ t: 'text', delta: dl.text });
          else if (dl.type === 'thinking_delta') this.emit({ t: 'thinking', delta: dl.thinking || '' });
        } else if (ev.type === 'content_block_stop') {
          const kind = this.blocks.get(ev.index);
          if (kind === 'thinking') this.emit({ t: 'thinking_end' });
          if (kind === 'text') this.emit({ t: 'text_end' });
          this.blocks.delete(ev.index);
        }
        break;
      }
      case 'assistant': {
        this.wake('assistant');
        const c = (m.message && m.message.content) || [];
        for (const b of c) if (b.type === 'tool_use') this.emit({ t: 'tool_use', id: b.id, name: b.name, input: b.input });
        break;
      }
      case 'user': {
        const c = (m.message && m.message.content) || [];
        if (Array.isArray(c)) for (const b of c) if (b.type === 'tool_result') {
          const txt = typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map(x => x.text || '').join('\n') : '';
          this.emit({ t: 'tool_result', id: b.tool_use_id, error: !!b.is_error, preview: String(txt).slice(0, 400) });
        }
        break;
      }
      case 'result':
        this.busy = false;
        this.emit({ t: 'result', ok: m.subtype === 'success', subtype: m.subtype, turns: m.num_turns, durationMs: m.duration_ms,
          costUsd: m.total_cost_usd, sessionId: m.session_id, error: m.subtype === 'success' ? null : (m.result || m.error || m.subtype),
          why: m.subtype === 'success' ? null : ((this.lastNotice && this.lastNotice.text) || (this.lastErr || []).join('').trim().split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 300) || null),
          usage: m.usage ? { in: m.usage.input_tokens, cacheRead: m.usage.cache_read_input_tokens, out: m.usage.output_tokens } : null });
        break;
      default:
        break;
    }
  }

  emit(ev) { try { this.onEvent && this.onEvent(ev); } catch (e) {} }
}

module.exports = { detectClaude, ClaudeSession, loginEnv };
