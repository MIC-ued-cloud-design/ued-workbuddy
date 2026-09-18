/* Dock 图标自愈（只管 macOS）。
   ── 为什么要有这个文件 ──
   2026-09-18 吉吉更新到 0.1.48 后 Dock 图标变成白框。查下来 app 包里的 icon.icns 完好（1.5MB、
   16→1024 十档齐全），Info.plist 的 CFBundleIconFile 也对，Dock 那一格指向的路径同样没错。
   坏的是 LaunchServices：同一个 bundle id `com.mic.ued.workbuddy` 底下注册了 6 条记录，
   其中 4 条指向已经被删掉的路径 —— `.app.updating-bak`、两个 electron-builder 的 *-temp、
   一个解包测试目录。Dock 按 bundle id 要图标时命中坏记录（Bundle node not found / fnfErr），
   拿不到 icns 就退回通用白图标。

   `.app.updating-bak` 是换包脚本自己造的：旧版 updater 走「旧的改名 → 拷新的 → 删备份」，
   备份存在的那一瞬间它在 /Applications 里，被 LS 当成同 id 的另一个应用注册了，
   目录删掉之后那条记录不会自己消失。**每更新一次积一条**，攒到某次被挑中就白图标 ——
   跟那一版改了什么无关，是更新这个动作本身埋的。

   🔴 换包脚本已经改成不再往 /Applications 里放备份（见 updater.js 的 installScript），
   但那只管得了「用新版 updater 发起的下一次更新」。macOS 的换包脚本是**发起更新的那一版**
   写出来的：装着 0.1.48 的同事升到 0.1.49，跑的仍是 0.1.48 里那段旧脚本，还会再埋一条。
   这个文件管的就是这一层 —— 新版第一次启动时，把上一轮留下的脏记录清掉、图标缓存重建。
   两层都要，只改 updater 的话，这一轮升级的人还是会看见白框。

   跑的时机：每个版本只跑一次（靠 ~/.uw-desktop/icon-heal.json 记账），换包脚本自己做过了就跳过，
   免得 Dock 白闪两回。全程静默，任何一步失败都不影响应用启动 —— 图标不对是难看，起不来是事故。 */
const fs = require('fs'), os = require('os'), path = require('path');
const { execFile, execFileSync } = require('child_process');

const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/'
  + 'LaunchServices.framework/Versions/A/Support/lsregister';

/* 记账文件。stateDir 是给门用的口子 —— 换包脚本那边写的是同一个位置（见 updater.js 里那句 printf）。
   🔴 不做成「测试时 mock 掉 os.homedir」：门里另一段也在 mock 它，两处收尾时互相覆盖，
      结果是测试数据落进用户真实的 ~/.uw-desktop（2026-09-18 写这道门时就这么漏过一个假 dmg 进去）。 */
function stateFile(stateDir) { return path.join(stateDir || path.join(os.homedir(), '.uw-desktop'), 'icon-heal.json'); }

/* 上次给哪个版本治过。文件没有 / 读坏了都当没治过 —— 多治一次只是 Dock 闪一下，漏治是白图标。 */
function lastHealed(stateDir) {
  try { return JSON.parse(fs.readFileSync(stateFile(stateDir), 'utf8')).version || null; } catch (e) { return null; }
}
function markHealed(version, stateDir) {
  try {
    fs.mkdirSync(path.dirname(stateFile(stateDir)), { recursive: true });
    fs.writeFileSync(stateFile(stateDir), JSON.stringify({ version, at: new Date().toISOString() }));
    return true;
  } catch (e) { return false; }
}

/* 用户级图标缓存目录（不需要 sudo 的那份）。getconf 给的路径末尾带斜杠，统一去掉。
   系统级的 /Library/Caches/com.apple.iconservices.store 要 sudo，应用不碰 —— 极少数清不掉的情形
   让人自己敲一条命令，比在这里要密码强。 */
function iconCacheDirs() {
  if (process.env.UW_ICON_CACHE_DIR) return [process.env.UW_ICON_CACHE_DIR];
  let base;
  try { base = execFileSync('getconf', ['DARWIN_USER_CACHE_DIR'], { encoding: 'utf8' }).trim(); } catch (e) { return []; }
  if (!base) return [];
  base = base.replace(/\/+$/, '');
  return ['com.apple.iconservices', 'com.apple.iconservicesagent'].map(n => path.join(base, n));
}

/* 该做哪几件事。做成纯函数是为了门能验「计划对不对」而不必真去动这台机器的 Dock。
   appPath 传 .app 目录；stale 是要从 LS 里注销的路径（旧换包脚本留下的备份名）。 */
function healPlan({ appPath, platform = process.platform } = {}) {
  if (platform !== 'darwin' || !appPath) return [];
  return [
    { kind: 'unregister', path: `${appPath}.updating-bak` },   // 旧脚本造的那条；路径已经不在磁盘上，-u 照样能把记录摘掉
    { kind: 'rmdir', path: `${appPath}.updating-bak` },        // 万一上一轮装到一半死了，目录还真在
    { kind: 'register', path: appPath },                        // 正主重新登记一次，盖掉同 id 的陈旧条目
    { kind: 'iconcache' },                                      // 缓存里那张白图也得扔掉，不然 LS 修好了画面还是旧的
    { kind: 'dock' },                                           // Dock 只在重启时重读图标
  ];
}

const run = (file, args) => new Promise(res => {
  try { execFile(file, args, { timeout: 20000 }, err => res(!err)); } catch (e) { res(false); }
});

/* 真做。返回 { ran, steps, why } —— ran=false 时 why 说明为什么跳过，方便日志里看明白。 */
async function heal({ appPath, version, force = false, platform = process.platform, stateDir, packaged = true } = {}) {
  if (platform !== 'darwin') return { ran: false, why: 'not-darwin', steps: [] };
  /* 🔴 开发态（npm start）必须挡在这里。那时 process.execPath 是 node_modules/electron/dist/Electron.app/
     Contents/MacOS/Electron，appBundlePath() 照样反推得出一个 .app —— 是 Electron 自己那个。
     不挡的话每次起开发实例都会去 lsregister -f 一次 Electron.app 再把 Dock 重启一遍，
     正好是在造这次要治的那种脏记录。判据用 app.isPackaged，不用路径长相去猜。 */
  if (!packaged) return { ran: false, why: 'not-packaged', steps: [] };
  if (!appPath || !/\.app$/.test(appPath)) return { ran: false, why: 'no-bundle', steps: [] };
  if (!force && version && lastHealed(stateDir) === version) return { ran: false, why: 'already-healed', steps: [] };

  const lsreg = process.env.UW_LSREGISTER || LSREGISTER;
  const killall = process.env.UW_KILLALL || 'killall';
  const steps = [];
  for (const s of healPlan({ appPath, platform })) {
    let ok = false;
    if (s.kind === 'unregister') ok = await run(lsreg, ['-u', s.path]);
    else if (s.kind === 'rmdir') { try { fs.rmSync(s.path, { recursive: true, force: true }); ok = true; } catch (e) { ok = false; } }
    else if (s.kind === 'register') ok = await run(lsreg, ['-f', s.path]);
    else if (s.kind === 'iconcache') { ok = true; for (const d of iconCacheDirs()) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { ok = false; } } }
    else if (s.kind === 'dock') ok = await run(killall, ['Dock']);
    steps.push({ ...s, ok });
  }
  if (version) markHealed(version, stateDir);
  return { ran: true, why: null, steps };
}

module.exports = { heal, healPlan, lastHealed, markHealed, stateFile, iconCacheDirs, LSREGISTER };
