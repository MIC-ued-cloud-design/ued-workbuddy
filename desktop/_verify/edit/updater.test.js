/* 更新模块：① pickLatest 挑版本（纯函数）② 换包脚本对着一个假 .app 和真 dmg 跑一遍（真 hdiutil / ditto / xattr）
   ③ 下载加固：断流判死 / 断点续传 / 取消 / 大小不对（假 net.fetch 造网络情形）。
   跑法：node _verify/edit/updater.test.js */
process.env.UW_STALL_MS = process.env.UW_STALL_MS || '300';   // 真值 45 秒，测试等不起；updater.js 留了这个口子
process.env.UW_CHECK_MS = process.env.UW_CHECK_MS || '300';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), { execSync, spawnSync } = require('child_process');
/* updater.js 顶部 require('electron')；这里塞一个假的进 require 缓存 */
require.cache[require.resolve('electron')] = { id: 'electron', filename: 'electron', loaded: true, exports: { app: { getVersion: () => '0.1.25' }, net: {} } };
const U = require(path.join(__dirname, '..', '..', 'main', 'updater.js'));
let pass = 0, HEAL_ASYNC = Promise.resolve();   // ②b 的自愈用例是异步的，末尾统计前要等它
const ok = (n, f) => { try { f(); pass++; console.log('✅', n); } catch (e) { console.log('❌', n, '\n   ', e.message); process.exitCode = 1; } };

const rel = (tag, assets, extra) => ({ tag_name: tag, draft: false, prerelease: false, body: '修了A\n- 加了B', html_url: 'https://x/' + tag, published_at: '2026-09-16', assets: assets.map(n => ({ name: n, size: 1000, browser_download_url: 'https://dl/' + n })), ...(extra || {}) });
ok('挑版本：只认desktop-v前缀，取最高的，选universal dmg', () => {
  const r = U.pickLatest([rel('v2.0.0', ['web.zip']), rel('desktop-v0.1.26', ['UED-WorkBuddy-0.1.26-universal.dmg', 'UED-WorkBuddy-0.1.26-universal.zip']), rel('desktop-v0.1.9', ['UED-WorkBuddy-0.1.9-universal.dmg'])], '0.1.25');
  assert.strictEqual(r.hasUpdate, true); assert.strictEqual(r.version, '0.1.26'); assert.ok(r.url.endsWith('0.1.26-universal.dmg')); assert.strictEqual(r.notes, '修了A\n- 加了B');
});
ok('挑版本：0.1.9 < 0.1.25（按数字比不按字符串）；当前已最新就hasUpdate=false', () => {
  assert.strictEqual(U.cmpVer('0.1.9', '0.1.25'), -1); assert.strictEqual(U.cmpVer('0.2.0', '0.1.99'), 1);
  assert.strictEqual(U.pickLatest([rel('desktop-v0.1.25', ['a-universal.dmg'])], '0.1.25').hasUpdate, false);
});
ok('挑版本：草稿 / 预发布跳过；没有dmg的release说明原因', () => {
  assert.strictEqual(U.pickLatest([rel('desktop-v0.1.30', ['a-universal.dmg'], { draft: true }), rel('desktop-v0.1.26', ['a-universal.dmg'])], '0.1.25').version, '0.1.26');
  const r = U.pickLatest([rel('desktop-v0.1.26', ['only.zip'])], '0.1.25'); assert.strictEqual(r.hasUpdate, false); assert.ok(/没有 ?dmg/.test(r.reason));
  assert.ok(/还没有/.test(U.pickLatest([], '0.1.25').reason));
});
ok('反推 .app路径', () => { assert.strictEqual(U.appBundlePath.toString().includes('.app/Contents/'), true); });

/* ② 真跑换包脚本：做一个假 .app（老版）和一个装着新版假 .app 的真 dmg。
   🔴 HOME 指到临时目录：新脚本的暂存 / 备份 / icon-heal.json 全在 ~/.uw-desktop 底下，
      不隔离这一跑就会动到用户真实的下载续传缓存。
   🔴 lsregister / killall / 图标缓存三样系统副作用接到假命令上，验的是「真调了、参数写对了」——
      不是把这三步 dry-run 掉。dry-run 只能证明代码走到了那一行，证明不了参数没写错，
      而这次白图标的根因恰恰就是一个路径参数（备份放错了地方）。 */
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'uw-upd-'));
const HOME = path.join(T, 'home'); fs.mkdirSync(HOME, { recursive: true });
const BIN = path.join(T, 'bin'); fs.mkdirSync(BIN, { recursive: true });
const CALLS = path.join(T, 'calls.log');
for (const n of ['lsregister', 'killall']) fs.writeFileSync(path.join(BIN, n), `#!/bin/bash\necho "${n} $*" >> "${CALLS}"\n`, { mode: 0o755 });
const ICONC = path.join(T, 'iconcache');
for (const n of ['com.apple.iconservices', 'com.apple.iconservicesagent']) fs.mkdirSync(path.join(ICONC, n), { recursive: true });
const ENV = { ...process.env, HOME, UW_LSREGISTER: path.join(BIN, 'lsregister'), UW_KILLALL: path.join(BIN, 'killall'), UW_ICON_CACHE_DIR: ICONC };
const plist = v => `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>${v}</string></dict></plist>\n`;

const appOld = path.join(T, 'Applications', 'UED WorkBuddy.app');
fs.mkdirSync(path.join(appOld, 'Contents'), { recursive: true });
fs.writeFileSync(path.join(appOld, 'Contents', 'v.txt'), 'old');
fs.writeFileSync(path.join(appOld, 'Contents', 'Info.plist'), plist('0.1.25'));
const stage = path.join(T, 'stage'); fs.mkdirSync(path.join(stage, 'UED WorkBuddy.app', 'Contents'), { recursive: true });
fs.writeFileSync(path.join(stage, 'UED WorkBuddy.app', 'Contents', 'v.txt'), 'new');
fs.writeFileSync(path.join(stage, 'UED WorkBuddy.app', 'Contents', 'Info.plist'), plist('9.9.9'));
const dmg = path.join(T, 'new.dmg');
execSync(`hdiutil create -quiet -srcfolder "${stage}" -volname UWTest -format UDZO "${dmg}"`);
execSync(`xattr -w com.apple.quarantine "0083;00000000;Safari;" "${appOld}"`);
/* 上一轮旧脚本留下的残骸：目录还在、LS 里也还挂着一条。新脚本该把这两样都收拾掉。 */
fs.mkdirSync(path.join(appOld + '.updating-bak', 'Contents'), { recursive: true });
const sh = path.join(T, 'install.sh'); fs.writeFileSync(sh, U.installScript(), { mode: 0o755 });
const log = path.join(T, 'install.log');
/* 起一个会活 1 秒的假「旧进程」，脚本要等它退了才动手 */
const fake = require('child_process').spawn('sleep', ['1']);
const t0 = Date.now();
const r = spawnSync('/bin/bash', [sh, dmg, appOld, String(fake.pid), '0', log], { encoding: 'utf8', env: ENV });
const dt = Date.now() - t0;
const calls = () => (fs.existsSync(CALLS) ? fs.readFileSync(CALLS, 'utf8') : '');
ok('换包脚本：等旧进程退出后才动手（耗时 ≥ 1秒）、退出码0', () => { assert.strictEqual(r.status, 0, fs.readFileSync(log, 'utf8')); assert.ok(dt >= 900, `${dt}ms`); });
ok('换包脚本：.app被新版覆盖、隔离标记已去', () => {
  assert.strictEqual(fs.readFileSync(path.join(appOld, 'Contents', 'v.txt'), 'utf8'), 'new');
  const x = spawnSync('xattr', ['-p', 'com.apple.quarantine', appOld], { encoding: 'utf8' }); assert.ok(x.status !== 0, '隔离标记还在');
});
/* 🔴 这条是 2026-09-18 白图标的根因门：备份只要在 .app 旁边落过地，LS 就会把它登记成同 id 的
   另一个应用，删掉之后记录留在库里，攒够了就轮到谁的 Dock 拿不到 icns。 */
ok('换包脚本：.app 旁边不留任何残骸（备份走 ~/.uw-desktop，不是 .updating-bak）', () => {
  assert.ok(!fs.existsSync(appOld + '.updating-bak'), '旧残骸没清掉');
  const sib = fs.readdirSync(path.dirname(appOld));
  assert.deepStrictEqual(sib, ['UED WorkBuddy.app'], `.app 同级多出了东西：${sib.join(' / ')}`);
  assert.ok(!fs.existsSync(path.join(HOME, '.uw-desktop', 'updates', 'staging')), '暂存区没清');
  assert.ok(!fs.existsSync(path.join(HOME, '.uw-desktop', 'updates', 'rollback-bundle')), '回滚备份没清');
});
ok('换包脚本：装完把脏记录注销、正主重新登记（参数带的是 .app 全路径）', () => {
  const c = calls();
  assert.ok(c.includes(`lsregister -u ${appOld}.updating-bak`), `没注销脏记录：\n${c}`);
  assert.ok(c.includes(`lsregister -f ${appOld}`), `没重新登记正主：\n${c}`);
});
ok('换包脚本：图标缓存已清、Dock 已重启（不重启 Dock 的话 LS 修好了画面还是那张白图）', () => {
  assert.ok(!fs.existsSync(path.join(ICONC, 'com.apple.iconservices')), '用户级图标缓存没清');
  assert.ok(!fs.existsSync(path.join(ICONC, 'com.apple.iconservicesagent')), 'iconservicesagent 缓存没清');
  assert.ok(/killall Dock/.test(calls()), '没重启 Dock');
});
ok('换包脚本：记一笔 icon-heal.json，版本号取自新装上的那份 Info.plist', () => {
  const f = path.join(HOME, '.uw-desktop', 'icon-heal.json');
  assert.ok(fs.existsSync(f), '没记账，新版启动时会再治一遍、Dock 白闪两回');
  assert.strictEqual(JSON.parse(fs.readFileSync(f, 'utf8')).version, '9.9.9');
});
/* 🔴 变量后面紧跟中文要写 ${VER}。这脚本是 detached 进程跑的、LANG 常常没设，写成 $VER） 时
   bash 会把「）」的首字节 EF 当成变量名吞掉，日志里只剩「图标已刷新（版本 ▒」。
   2026-09-18 拿真 dmg 跑才露出来 —— 假 app 那轮日志同样是错的，只是没人去读那一行。 */
ok('换包脚本：日志里版本号完整（变量后面跟中文不能写成 $VER）', () => {
  const l = fs.readFileSync(log, 'utf8');
  assert.ok(/图标已刷新（版本 9\.9\.9）/.test(l), `版本号被吃了：${l.split('\n').filter(x => /图标已刷新/.test(x)).join('')}`);
});
ok('换包脚本：dmg已弹出、日志有始有终', () => { const l = fs.readFileSync(log, 'utf8'); assert.ok(/开始/.test(l) && /完成/.test(l), l); assert.ok(!/uw-update/.test(execSync('hdiutil info').toString()), '还有挂着的测试卷'); });
ok('换包脚本：dmg里没有 .app时报错退出、原 .app不动', () => {
  const bad = path.join(T, 'bad.dmg'); const e = path.join(T, 'empty'); fs.mkdirSync(e); fs.writeFileSync(path.join(e, 'x.txt'), 'x');
  execSync(`hdiutil create -quiet -srcfolder "${e}" -volname UWBad -format UDZO "${bad}"`);
  const r2 = spawnSync('/bin/bash', [sh, bad, appOld, '1', '0', log], { encoding: 'utf8', env: ENV });
  assert.notStrictEqual(r2.status, 0); assert.strictEqual(fs.readFileSync(path.join(appOld, 'Contents', 'v.txt'), 'utf8'), 'new');
});
/* 拷贝这一步失败时，新流程里旧的那份根本还没被挪过 —— 「先挪走再拷」的老写法到这儿要靠回滚才能救回来。 */
ok('换包脚本：拷贝失败时原 .app 原封不动，也不留暂存', () => {
  const ro = path.join(T, 'home-ro'); fs.mkdirSync(ro, { recursive: true });
  fs.mkdirSync(path.join(ro, '.uw-desktop', 'updates'), { recursive: true });
  fs.chmodSync(path.join(ro, '.uw-desktop', 'updates'), 0o500);          // 建得了目录名、写不进文件 → ditto 必失败
  const r3 = spawnSync('/bin/bash', [sh, dmg, appOld, '1', '0', log], { encoding: 'utf8', env: { ...ENV, HOME: ro } });
  fs.chmodSync(path.join(ro, '.uw-desktop', 'updates'), 0o700);
  assert.notStrictEqual(r3.status, 0, '拷贝失败了却报成功');
  assert.strictEqual(fs.readFileSync(path.join(appOld, 'Contents', 'v.txt'), 'utf8'), 'new', '原 .app 被动过了');
  assert.ok(fs.existsSync(appOld), '原 .app 没了');
});

/* ②b Dock 图标自愈（main/icon-heal.js）。换包脚本只管得了「下一次更新」——
   这一次升级跑的还是旧版写出来的旧脚本，所以新版启动时得自己再治一遍。 */
const IH = require(path.join(__dirname, '..', '..', 'main', 'icon-heal.js'));
ok('自愈：mac 上五步齐全（注销脏记录 / 删残骸 / 重新登记 / 清图标缓存 / 重启 Dock）', () => {
  const plan = IH.healPlan({ appPath: '/Applications/UED WorkBuddy.app', platform: 'darwin' });
  assert.deepStrictEqual(plan.map(s => s.kind), ['unregister', 'rmdir', 'register', 'iconcache', 'dock']);
  assert.strictEqual(plan[0].path, '/Applications/UED WorkBuddy.app.updating-bak');
  assert.strictEqual(plan[2].path, '/Applications/UED WorkBuddy.app');
});
ok('自愈：Windows 不做（NSIS 装回原位，图标是 exe 里的资源，没有这个毛病）', () => {
  assert.deepStrictEqual(IH.healPlan({ appPath: 'C:\\x\\UW.exe', platform: 'win32' }), []);
});
(() => {
  /* 🔴 这里不碰 os.homedir：③ 段也在 mock 它，两边收尾时互相覆盖，测试数据就会落进用户真实的
     ~/.uw-desktop —— 第一版这道门就漏了个假 dmg 进去。记账位置改成显式传 stateDir。 */
  const H2 = path.join(T, 'heal-home'); fs.mkdirSync(H2, { recursive: true });
  const appH = path.join(T, 'HealApp.app'); fs.mkdirSync(path.join(appH, 'Contents'), { recursive: true });
  fs.mkdirSync(path.join(appH + '.updating-bak', 'Contents'), { recursive: true });
  const ic2 = path.join(T, 'iconcache2'); fs.mkdirSync(path.join(ic2, 'com.apple.iconservices'), { recursive: true });
  const saved = [process.env.UW_LSREGISTER, process.env.UW_KILLALL, process.env.UW_ICON_CACHE_DIR];
  process.env.UW_LSREGISTER = path.join(BIN, 'lsregister'); process.env.UW_KILLALL = path.join(BIN, 'killall'); process.env.UW_ICON_CACHE_DIR = ic2;
  HEAL_ASYNC = (async () => {
    const before = calls().length;
    const r1 = await IH.heal({ appPath: appH, version: '9.9.9', platform: 'darwin', stateDir: H2 });
    ok('自愈：真跑一遍 —— 五步都成，残骸删了，缓存清了，Dock 重启了', () => {
      assert.strictEqual(r1.ran, true, r1.why);
      assert.deepStrictEqual(r1.steps.map(s => s.ok), [true, true, true, true, true], JSON.stringify(r1.steps));
      assert.ok(!fs.existsSync(appH + '.updating-bak'), '残骸没删');
      assert.ok(!fs.existsSync(path.join(ic2, 'com.apple.iconservices')), '缓存没清');
      const c = calls().slice(before);
      assert.ok(c.includes(`lsregister -u ${appH}.updating-bak`) && c.includes(`lsregister -f ${appH}`) && /killall Dock/.test(c), c);
    });
    ok('自愈：记账写在自己的 stateDir 里，没碰用户真实的 ~/.uw-desktop', () => {
      assert.ok(fs.existsSync(path.join(H2, 'icon-heal.json')));
      assert.strictEqual(JSON.parse(fs.readFileSync(path.join(H2, 'icon-heal.json'), 'utf8')).version, '9.9.9');
    });
    const r2 = await IH.heal({ appPath: appH, version: '9.9.9', platform: 'darwin', stateDir: H2 });
    ok('自愈：同一版本第二次启动跳过（不让 Dock 每次开机都闪），force 能强跑', async () => {
      assert.strictEqual(r2.ran, false); assert.strictEqual(r2.why, 'already-healed');
    });
    const r3 = await IH.heal({ appPath: appH, version: '9.9.9', force: true, platform: 'darwin', stateDir: H2 });
    const r4 = await IH.heal({ appPath: '/Users/x/repo/desktop', version: '9.9.9', platform: 'darwin', stateDir: H2 });
    const r5 = await IH.heal({ appPath: appH, version: '9.9.9', platform: 'win32', stateDir: H2 });
    /* 🔴 开发态那条单独验：npm start 时 appBundlePath() 反推出来的是 node_modules 里的 Electron.app，
       长得完全合法（真存在、真是 .app），只有 app.isPackaged 分得开。挡不住就会每次起开发实例
       都往 LS 里登记一次 Electron.app 并重启 Dock —— 拿这次要治的病去治病。 */
    const elec = path.join(T, 'node_modules', 'electron', 'dist', 'Electron.app');
    fs.mkdirSync(path.join(elec, 'Contents'), { recursive: true });
    const r7 = await IH.heal({ appPath: elec, version: '9.9.9', platform: 'darwin', stateDir: H2, packaged: false, force: true });
    ok('自愈：force 强跑 / 开发态（不是 .app）跳过 / 非 mac 跳过 / 未打包（npm start）跳过', () => {
      assert.strictEqual(r3.ran, true);
      assert.strictEqual(r4.ran, false); assert.strictEqual(r4.why, 'no-bundle');
      assert.strictEqual(r5.ran, false); assert.strictEqual(r5.why, 'not-darwin');
      assert.strictEqual(r7.ran, false, '开发态没挡住，会去动 node_modules 里的 Electron.app');
      assert.strictEqual(r7.why, 'not-packaged');
    });
    /* 版本一换就该再治一次 —— 每次更新都可能又埋一条脏记录 */
    const r6 = await IH.heal({ appPath: appH, version: '9.9.10', platform: 'darwin', stateDir: H2 });
    ok('自愈：换了版本号会再治一次', () => { assert.strictEqual(r6.ran, true); });
    process.env.UW_LSREGISTER = saved[0] || ''; process.env.UW_KILLALL = saved[1] || ''; process.env.UW_ICON_CACHE_DIR = saved[2] || '';
    if (!saved[0]) delete process.env.UW_LSREGISTER; if (!saved[1]) delete process.env.UW_KILLALL; if (!saved[2]) delete process.env.UW_ICON_CACHE_DIR;
  })();
})();

/* ③ 下载加固（2026-09-17）。每一项都对着同事真机上那次「点更新，界面永远停在 1 MB / 231 MB」。
   用假 net.fetch 造网络情形：hang=true 表示吐完手上这几块就再也不出数据了——这正是断流的样子。 */
const electron = require.cache[require.resolve('electron')].exports;
const okA = async (n, f) => { try { await f(); pass++; console.log('✅', n); } catch (e) { console.log('❌', n, '\n   ', e.message); process.exitCode = 1; } };
function resp(status, chunks, { hang = false, headers = {} } = {}) {
  let i = 0;
  const h = {}; for (const k in headers) h[k.toLowerCase()] = String(headers[k]);
  return {
    ok: status >= 200 && status < 300, status,
    headers: { get: k => (k.toLowerCase() in h ? h[k.toLowerCase()] : null) },
    body: { getReader: () => ({
      read: async () => { if (i < chunks.length) return { done: false, value: chunks[i++] }; if (hang) return new Promise(() => {}); return { done: true }; },
      cancel: async () => {},
    }) },
  };
}
(async () => {
  const H = path.join(T, 'home'); fs.mkdirSync(H, { recursive: true });
  const realHome = os.homedir; os.homedir = () => H;          // 别往用户真实的 ~/.uw-desktop 里写
  const upd = path.join(H, '.uw-desktop', 'updates');
  const chunk = n => Buffer.alloc(n, 1);
  const URL_ = 'https://dl.example/UED-WorkBuddy-9.9.9-universal.dmg';
  const partOf = () => path.join(upd, 'UED-WorkBuddy-9.9.9-universal.dmg.part');
  const destOf = () => path.join(upd, 'UED-WorkBuddy-9.9.9-universal.dmg');

  await okA('断流：没有新数据就判死并说清卡在哪，不再无限挂着；已下的 .part留着', async () => {
    electron.net.fetch = async () => resp(200, [chunk(1000)], { hang: true, headers: { 'content-length': '5000' } });
    await assert.rejects(() => U.download(URL_, 5000, () => {}), /卡住/);
    assert.strictEqual(fs.statSync(partOf()).size, 1000, '.part应该留着给下次续传');
  });

  await okA('续传：.part有多少就带Range从哪接着下，206时追加而不是覆盖', async () => {
    let sent = null;
    electron.net.fetch = async (u, o) => { sent = o.headers; return resp(206, [chunk(4000)], { headers: { 'content-length': '4000' } }); };
    const f = await U.download(URL_, 5000, () => {});
    assert.strictEqual(sent.Range, 'bytes=1000-', '应该从 .part的末尾接着要');
    assert.strictEqual(fs.statSync(f).size, 5000, '旧1000 + 新4000');
    assert.ok(!fs.existsSync(partOf()), '下完 .part应该改名成成品');
  });

  await okA('缓存：成品已经在且大小对得上，直接用，不再拉一次', async () => {
    let called = 0; electron.net.fetch = async () => { called++; return resp(200, [chunk(5000)]); };
    let cached = false;
    await U.download(URL_, 5000, p => { if (p.cached) cached = true; });
    assert.strictEqual(called, 0, '不该再发请求'); assert.ok(cached, '该报cached');
  });

  await okA('服务端不认续传（回200不是206）：从头写，不会跟旧数据拼错', async () => {
    fs.rmSync(destOf(), { force: true });
    fs.writeFileSync(partOf(), chunk(1000));
    electron.net.fetch = async () => resp(200, [chunk(5000)], { headers: { 'content-length': '5000' } });
    const f = await U.download(URL_, 5000, () => {});
    assert.strictEqual(fs.statSync(f).size, 5000, '应该是5000而不是1000+5000');
  });

  await okA('取消：能中断，报「已取消」，已下的留着下次接着下', async () => {
    fs.rmSync(destOf(), { force: true }); fs.rmSync(partOf(), { force: true });
    electron.net.fetch = async () => resp(200, [chunk(800)], { hang: true, headers: { 'content-length': '5000' } });
    const p = U.download(URL_, 5000, () => {});
    setTimeout(() => U.cancelDownload(), 60);
    await assert.rejects(() => p, /已取消/);
    assert.strictEqual(fs.statSync(partOf()).size, 800, '.part要留着');
  });

  await okA('续传点不对（416）：清掉 .part并说明，下次从头下', async () => {
    electron.net.fetch = async () => resp(416, []);
    await assert.rejects(() => U.download(URL_, 5000, () => {}), /从头下/);
    assert.ok(!fs.existsSync(partOf()), '脏 .part应该被清掉');
  });

  await okA('被网络截断（大小对不上）：清掉重下，不留半截文件冒充成品', async () => {
    fs.rmSync(destOf(), { force: true });
    electron.net.fetch = async () => resp(200, [chunk(2000)], { headers: { 'content-length': '2000' } });
    await assert.rejects(() => U.download(URL_, 5000, () => {}), /大小不对/);
    assert.ok(!fs.existsSync(partOf()) && !fs.existsSync(destOf()), '半截文件不该留下');
  });

  await okA('查更新：接口卡住不再无限转圈，超时报错', async () => {
    electron.net.fetch = async () => new Promise(() => {});
    const r = await U.check();
    assert.strictEqual(r.ok, false); assert.ok(/没反应/.test(r.error), r.error);
  });

  os.homedir = realHome;
  await HEAL_ASYNC;                                    // ②b 还在用 T 下的假命令和假 app，删目录前必须等它跑完
  fs.rmSync(T, { recursive: true, force: true });
  console.log(`\n${pass}项通过`);
})();
