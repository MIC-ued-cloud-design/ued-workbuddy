/* Claude 会话（engine.js）：跑着的时候也能说话。用一个假进程顶替 spawn，验三件事：
   ① 忙时 send 不再拒绝，消息照样写进 stdin，且不另开一轮（不发 turn_start、busy 不变）
   ② 空闲时 send 行为不变（开新一轮）
   ③ 上一轮 result 之后 20 秒内如果 Claude 又动起来，turn_start 标成「补充」而不是「后台任务」
   跑法：node _verify/edit/engine.test.js（纯 node，不拉真 Claude） */
process.env.UW_ENGINE_TEST = '1';
const assert = require('assert'), path = require('path');
const Module = require('module'); const realLoad = Module._load;
/* 顶替 child_process.spawn：给一个能写的 stdin、可触发的 stdout */
const { EventEmitter } = require('events');
function fakeProc() { const p = new EventEmitter(); p.pid = 4242; p.stdin = { writable: true, chunks: [], write(s) { this.chunks.push(String(s)); }, end() {} }; p.stdout = new EventEmitter(); p.stderr = new EventEmitter(); p.kill = () => {}; return p; }
let lastProc = null;
Module._load = function (req, ...a) { if (req === 'child_process') { const cp = realLoad.call(this, req, ...a); return { ...cp, spawn: () => (lastProc = fakeProc()), execSync: () => '' }; } return realLoad.call(this, req, ...a); };
const E = require(path.join(__dirname, '..', '..', 'main', 'engine.js'));
Module._load = realLoad;
let pass = 0;
const ok = (n, f) => { try { f(); pass++; console.log('✅', n); } catch (e) { console.log('❌', n, '\n   ', e.message); process.exitCode = 1; } };
const events = [];
const s = new E.ClaudeSession({ claudePath: '/bin/false', projectDir: __dirname, onEvent: e => events.push(e) });
if (!s.loginEnv) {}   // loginEnv 在模块里自己拿，不影响
const written = () => lastProc.stdin.chunks.map(c => JSON.parse(c)).filter(m => m.type === 'user').map(m => m.message.content);

const r1 = s.send('第一条：开新一轮');
ok('空闲时发：开新一轮（busy=true、发 turn_start、消息进 stdin）', () => { assert.strictEqual(r1.ok, true); assert.ok(!r1.interjected); assert.strictEqual(s.busy, true); assert.ok(events.some(e => e.t === 'turn_start' && !e.resumed)); assert.deepStrictEqual(written(), ['第一条：开新一轮']); });

const nTurnStart = events.filter(e => e.t === 'turn_start').length;
const r2 = s.send('第二条：跑着的时候补一句');
ok('忙时发：不拒绝、照写进 stdin、标 interjected、不另开一轮', () => {
  assert.strictEqual(r2.ok, true, JSON.stringify(r2)); assert.strictEqual(r2.interjected, true);
  assert.deepStrictEqual(written(), ['第一条：开新一轮', '第二条：跑着的时候补一句']);
  assert.strictEqual(s.busy, true);
  assert.strictEqual(events.filter(e => e.t === 'turn_start').length, nTurnStart, '不该再发 turn_start');
  assert.ok(events.some(e => e.t === 'interject'), '该发 interject 事件让界面知道');
});

/* 上一轮结束（result），紧接着模型又开始产出：这一次要归到「补充」头上 */
s.handle({ type: 'result', subtype: 'success', num_turns: 2, duration_ms: 1 });
ok('result 后 busy 归零', () => assert.strictEqual(s.busy, false));
s.handle({ type: 'stream_event', event: { type: 'message_start' } });
const ts = events.filter(e => e.t === 'turn_start').pop();
ok('result 后 20 秒内又动起来：turn_start 标 interjected（不是「后台任务回来了」）', () => { assert.strictEqual(ts.resumed, true); assert.strictEqual(ts.interjected, true); assert.strictEqual(ts.reason, 'interject'); });

/* 没补过话时自己动起来，仍然是后台任务那条老路 */
s.handle({ type: 'result', subtype: 'success', num_turns: 1, duration_ms: 1 });
s.lastInterjectAt = Date.now() - 60000;
s.handle({ type: 'assistant', message: { content: [] } });
const ts2 = events.filter(e => e.t === 'turn_start').pop();
ok('很久没补过话时自己动起来：还是标后台任务（interjected=false）', () => { assert.strictEqual(ts2.resumed, true); assert.strictEqual(ts2.interjected, false); });

/* 进程没了：忙时发要报得清楚，而不是假装成功 */
s.busy = true; lastProc.stdin.writable = false;
const r3 = s.send('进程死了还发');
ok('进程 stdin 不可写时忙时发：报「进程不在了」而不是 ok', () => { assert.strictEqual(r3.ok, false); assert.ok(/进程/.test(r3.message), r3.message); });
/* 没登录：Claude Code 回 subtype=success 但 is_error=true，正文是「Not logged in」——要当失败并把正文透出来 */
s.busy = true; events.length = 0;
s.handle({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login', num_turns: 1, duration_ms: 1 });
const rr = events.find(e => e.t === 'result');
ok('subtype=success 但 is_error=true：ok=false，error 带上「Not logged in」原话', () => { assert.strictEqual(rr.ok, false); assert.ok(/Not logged in/.test(rr.error), rr.error); });
s.handle({ type: 'result', subtype: 'success', is_error: false, result: 'DONE', num_turns: 1, duration_ms: 1 });
ok('真成功：ok=true、error=null', () => { const r = events.filter(e => e.t === 'result').pop(); assert.strictEqual(r.ok, true); assert.strictEqual(r.error, null); });
console.log(`\n${pass}项通过`);
