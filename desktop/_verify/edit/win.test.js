/* Windows 分支（2026-09-17 加）：在 Mac 上把 process.platform 假装成 win32，把纯逻辑跑一遍。
   验的是：① shellenv 不探 shell、PATH 用 `;`、键名 Path 不分大小写、按 PATHEXT 找可执行文件
          ② engine 的候选位置含原生安装器与 npm 垫片；.cmd 垫片能拆成 node.exe + cli.js（不走 cmd.exe，长提示词不会被切坏）
          ③ updater 按平台挑包（win32 挑 setup.exe、darwin 挑 dmg）；PowerShell 换包脚本不用保留变量 $pid、带 /S 静默、等旧进程
   跑法：node _verify/edit/win.test.js（纯 node）。🔴 这道门证明不了「在 Windows 上能跑」，只证明逻辑分支没写错；真机点一遍另算。 */
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
let pass = 0;
const ok = (n, f) => { try { f(); pass++; console.log('✅', n); } catch (e) { console.log('❌', n, '\n   ', e.message); process.exitCode = 1; } };

const realPlatform = process.platform;
const setPlatform = v => Object.defineProperty(process, 'platform', { value: v, configurable: true });
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'uw-win-'));
const home = path.join(T, 'home'), appdata = path.join(home, 'AppData', 'Roaming'), npmDir = path.join(appdata, 'npm');
fs.mkdirSync(path.join(home, '.local', 'bin'), { recursive: true }); fs.mkdirSync(npmDir, { recursive: true });
/* npm 的 .cmd 垫片（原样抄 npm 生成的形状）+ 它指向的 cli.js + 旁边的 node.exe */
fs.mkdirSync(path.join(npmDir, 'node_modules', '@anthropic-ai', 'claude-code'), { recursive: true });
fs.writeFileSync(path.join(npmDir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'), 'console.log("2.1.0 (Claude Code)")');
fs.writeFileSync(path.join(npmDir, 'claude.cmd'), '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n');
fs.writeFileSync(path.join(npmDir, 'node.exe'), '');
fs.writeFileSync(path.join(home, '.local', 'bin', 'claude.exe'), '');

const realEnv = process.env, realHome = os.homedir;
process.env = { Path: `${T}${path.delimiter}${npmDir}${path.delimiter}${npmDir.toUpperCase()}`, PATHEXT: '.COM;.EXE;.BAT;.CMD;.VBS;.JS', APPDATA: appdata, LOCALAPPDATA: path.join(home, 'AppData', 'Local'), USERPROFILE: home, HOME: home };
os.homedir = () => home;
setPlatform('win32');
for (const k of Object.keys(require.cache)) if (/main[\\/](shellenv|engine|updater)\.js$/.test(k)) delete require.cache[k];
require.cache[require.resolve('electron')] = { id: 'electron', filename: 'electron', loaded: true, exports: { app: { getVersion: () => '0.1.45' }, net: {} } };
const SE = require(path.join(__dirname, '..', '..', 'main', 'shellenv.js'));
const E = require(path.join(__dirname, '..', '..', 'main', 'engine.js'));
const U = require(path.join(__dirname, '..', '..', 'main', 'updater.js'));

/* ① shellenv */
ok('Windows：PATH 键名不分大小写（Path）、分隔符是 ;、同一目录大小写不同只算一条', () => {
  assert.strictEqual(SE.pathKey(process.env), 'Path');
  const m = SE.mergePath('C:\\a;c:\\A\\', 'C:\\b');
  assert.strictEqual(m, 'C:\\a;C:\\b');
});
ok('Windows：不探登录 shell，直接用进程环境；兜底目录里有 ~\\.local\\bin 和 %APPDATA%\\npm', () => {
  const { env, info } = SE.loginEnv(true);
  assert.strictEqual(info.source, 'process-env'); assert.strictEqual(info.gotLoginPath, true); assert.strictEqual(info.guiMinimalPath, false);
  assert.ok(env.Path && !env.PATH, '该改 Path 这个键，不该另造一个 PATH：' + Object.keys(env).filter(k => /^path$/i.test(k)));
  const dirs = SE.fallbackDirs();
  assert.ok(dirs.includes(path.join(home, '.local', 'bin')), dirs.join('\n')); assert.ok(dirs.includes(npmDir), dirs.join('\n'));
});
ok('Windows：按 PATHEXT 找可执行文件，.EXE/.CMD 排前面，找到的是 claude.cmd', () => {
  assert.deepStrictEqual(SE.winExts().slice(0, 2), ['.EXE', '.CMD']);
  const hits = SE.whichAll('claude');
  assert.ok(hits.some(h => h.toLowerCase() === path.join(npmDir, 'claude.cmd').toLowerCase()), JSON.stringify(hits));
});

/* ② engine */
ok('Windows：候选位置含原生安装器 ~\\.local\\bin\\claude.exe 与 npm 的 claude.cmd，且不含 /opt/homebrew 这种 Mac 路径', () => {
  const c = E.candidates();
  assert.ok(c.includes(path.join(home, '.local', 'bin', 'claude.exe')), c.join('\n'));
  assert.ok(c.includes(path.join(npmDir, 'claude.cmd')), c.join('\n'));
  assert.ok(!c.some(x => /homebrew|\/usr\/local/.test(x)), c.join('\n'));
});
ok('Windows：.cmd 垫片拆成 node.exe + cli.js，不经 cmd.exe（长提示词参数才不会被切坏）', () => {
  const L = E.resolveLauncher(path.join(npmDir, 'claude.cmd'));
  assert.strictEqual(L.via, 'node+cli.js', JSON.stringify(L));
  assert.strictEqual(L.file, path.join(npmDir, 'node.exe'));
  assert.deepStrictEqual(L.pre, [path.join(npmDir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js')]);
});
ok('Windows：.exe 原样直接跑；坏掉的 .cmd 说清为什么', () => {
  assert.deepStrictEqual(E.resolveLauncher('C:\\x\\claude.exe'), { file: 'C:\\x\\claude.exe', pre: [] });
  fs.writeFileSync(path.join(T, 'bad.cmd'), '@echo nothing here');
  assert.ok(/没找到/.test(E.resolveLauncher(path.join(T, 'bad.cmd')).unresolved));
});

/* ③ updater */
const rel = (tag, assets) => ({ tag_name: tag, draft: false, prerelease: false, body: 'x', html_url: 'https://x/' + tag, published_at: '2026-09-17', assets: assets.map(n => ({ name: n, size: 1000, browser_download_url: 'https://dl/' + n })) });
const both = [rel('desktop-v0.1.46', ['UED-WorkBuddy-0.1.46-universal.dmg', 'UED-WorkBuddy-0.1.46-win-x64-setup.exe', 'UED-WorkBuddy-0.1.46-universal.zip'])];
ok('挑包按平台：win32 挑 setup.exe，darwin 挑 universal dmg，同一条 release', () => {
  const w = U.pickLatest(both, '0.1.45', 'win32'), d = U.pickLatest(both, '0.1.45', 'darwin');
  assert.ok(w.hasUpdate && w.url.endsWith('-win-x64-setup.exe'), JSON.stringify(w));
  assert.ok(d.hasUpdate && d.url.endsWith('-universal.dmg'), JSON.stringify(d));
  assert.strictEqual(U.pickLatest(both, '0.1.45').url, w.url, '不传平台时按 process.platform（此刻是 win32）');
});
ok('Windows 客户端遇到只有 dmg 的老 release：不报更新、原因说清没有 exe', () => {
  const r = U.pickLatest([rel('desktop-v0.1.45', ['UED-WorkBuddy-0.1.45-universal.dmg'])], '0.1.40', 'win32');
  assert.strictEqual(r.hasUpdate, false); assert.ok(/exe/i.test(r.reason), r.reason);
});
ok('PowerShell 换包脚本：不用保留变量 $pid、静默 /S、先等旧进程、失败不重开', () => {
  const s = U.installScriptWin();
  assert.ok(!/\$pid\b/i.test(s), '用了 $pid（PowerShell 保留变量）');
  assert.ok(/Wait-Process -Id \$ProcId/.test(s)); assert.ok(/-ArgumentList '\/S'/.test(s));
  assert.ok(s.indexOf('Wait-Process') < s.indexOf('Start-Process -FilePath $Setup'), '要先等旧进程退了再装');
  assert.ok(/ExitCode -ne 0[^\n]*exit 1/.test(s), '安装失败要退出，不能接着重开');
});
ok('Windows：目标就是可执行文件本身（没有 .app 这一层）', () => { assert.strictEqual(U.appBundlePath(), process.execPath); });

/* 收尾：换回真平台，确认 Mac 分支没被动到 */
setPlatform(realPlatform); process.env = realEnv; os.homedir = realHome;
for (const k of Object.keys(require.cache)) if (/main[\\/](shellenv|engine|updater)\.js$/.test(k)) delete require.cache[k];
const SE2 = require(path.join(__dirname, '..', '..', 'main', 'shellenv.js'));
ok('换回 Mac：PATH 用 :、兜底目录还是 Mac 那套', () => {
  assert.strictEqual(SE2.mergePath('/a', '/b'), '/a:/b');
  assert.ok(SE2.fallbackDirs().some(d => /\/(opt\/homebrew|usr\/local)\/bin$/.test(d)));
});
fs.rmSync(T, { recursive: true, force: true });
console.log(`\n${pass}项通过`);
