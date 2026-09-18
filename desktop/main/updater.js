'use strict';
/**
 * 更新 —— 不签名版本能做到的最好形态：查到新版就提示，点一下自己下载、自己换掉自己、重开。
 *
 * 为什么不用 electron-updater：macOS 上它要求新旧两版都带同一个开发者签名，没签名直接拒绝（2026-09-16 吉吉定：开发者账号先不采购）。
 * 所以这里手写：
 *   ① 查版本：GitHub Releases 列表里 tag 以 desktop-v 开头的最新那条（网页版与桌面版共用一个仓库，靠前缀分开）
 *   ② 下载：Electron 自己的网络栈（net.fetch），走系统代理，落到 ~/.uw-desktop/updates/
 *   ③ 替换：写一个 shell 脚本脱离进程跑——等应用退出 → 挂载 dmg → ditto 覆盖 .app → 去隔离标记 → 弹出 → 重新打开。
 *      跟人手装的动作一模一样，只是同事不用再找 dmg、右键放行、拖进应用程序。
 *
 * Windows（2026-09-17 加）：同一条链，换的是包和脚本：
 *   ① 同一个 release 里挑 `-win-x64-setup.exe`（NSIS 一键安装包，electron-builder 打的）
 *   ② 下到 ~/.uw-desktop/updates/（Electron 的 net.fetch 写盘不带 Mark-of-the-Web，所以静默跑它不会被 SmartScreen 拦）
 *   ③ 写一个 PowerShell 脚本脱离进程跑：等应用退出 → `setup.exe /S` 静默装到原位置（NSIS 会先卸旧的）→ 重新打开。
 */
const { app, net } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const REPO = 'MIC-ued-cloud-design/ued-workbuddy';
const TAG_PREFIX = 'desktop-v';
const API = `https://api.github.com/repos/${REPO}/releases?per_page=15`;

function parseVer(s) { const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(s || '')); return m ? [+m[1], +m[2], +m[3]] : null; }
function cmpVer(a, b) { const x = parseVer(a), y = parseVer(b); if (!x || !y) return 0; for (let k = 0; k < 3; k++) if (x[k] !== y[k]) return x[k] > y[k] ? 1 : -1; return 0; }

/* 每个平台认哪种安装包。写成表，release.sh 的回查和这里用同一份。 */
const ASSET = {
  darwin: { pick: a => /-universal\.dmg$/i.test(a.name), loose: a => /\.dmg$/i.test(a.name), what: 'dmg' },
  win32: { pick: a => /-win-x64-setup\.exe$/i.test(a.name), loose: a => /\.exe$/i.test(a.name), what: 'Windows安装包（exe）' },
};
/* 从 releases 列表里挑桌面版最新那条，并找到本平台的安装包（Mac 通用 dmg / Windows setup.exe）。纯函数，方便测。 */
function pickLatest(releases, current, platform) {
  const A = ASSET[platform || process.platform] || ASSET.darwin;
  const list = (releases || []).filter(r => r && !r.draft && !r.prerelease && String(r.tag_name || '').startsWith(TAG_PREFIX));
  list.sort((a, b) => cmpVer(b.tag_name, a.tag_name));
  const r = list[0]; if (!r) return { ok: true, hasUpdate: false, reason: '仓库里还没有桌面版release' };
  const version = r.tag_name.slice(TAG_PREFIX.length);
  const asset = (r.assets || []).find(A.pick) || (r.assets || []).find(A.loose);
  if (!asset) return { ok: true, hasUpdate: false, reason: `release ${r.tag_name}里没有${A.what}` };
  return { ok: true, hasUpdate: cmpVer(version, current) > 0, version, current, url: asset.browser_download_url, size: asset.size, notes: String(r.body || '').trim(), publishedAt: r.published_at, page: r.html_url };
}

/* 超时包装：net.fetch 自己不带超时，网络卡住时它会一直挂着，界面就永远停在「正在查…」。 */
function withTimeout(p, ms, what) {
  let t;
  return Promise.race([
    Promise.resolve(p).finally(() => clearTimeout(t)),
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${what}超过${Math.round(ms / 1000)}秒没反应`)), ms); }),
  ]);
}
function mb(n) { return (n / 1048576).toFixed(0) + ' MB'; }

async function fetchJson(url) {
  const r = await withTimeout(net.fetch(url, { headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'UED-WorkBuddy/' + app.getVersion() } }), CHECK_MS, '查更新');
  if (!r.ok) throw new Error(`GitHub回了${r.status}`);
  return withTimeout(r.json(), CHECK_MS, '读更新信息');
}
async function check() {
  try { return pickLatest(await fetchJson(API), app.getVersion()); }
  catch (e) { return { ok: false, error: e.message, current: app.getVersion() }; }
}

/* 下载到 ~/.uw-desktop/updates/，边下边报进度。同名已存在且大小对得上就直接用（断网重试不用再拉 240MB）。
 *
 * 🔴 这一段 2026-09-17 加固过，三条都对着同事真机上的真实情形（他连着更新卡下不动、界面永远停在「1 MB / 231 MB · 下载中 0%」）：
 *   ① 断流永不报错 —— 网络抖到 0 时 reader.read() 就一直挂着，没有超时、不报错、也没法取消，
 *      用户看到的就是一个静止的进度条，以为「一直无法下载」。现在每读一块都重置看门狗，
 *      STALL_MS 内没有新数据就判死，并且把「卡在第几 MB」说出来。
 *   ② 重试从零开始 —— .part 从来不复用（存在性查的是成品名不是 .part），231MB 在差网络下永远攒不满。
 *      现在带 Range 续传；服务端不认（回 200 而不是 206）才从头来。
 *   ③ 没法取消 —— 点下去只能干等。现在 cancelDownload() 能中断，已下的部分留着下次接着下。
 */
/* 两个时限。测试要验「卡住会判死」但不能真等 45 秒，所以留了环境变量口子 —— 只有 _verify 会设它。 */
const CHECK_MS = +process.env.UW_CHECK_MS || 20000;   // 查更新 / 连上下载地址的时限
const STALL_MS = +process.env.UW_STALL_MS || 45000;   // 这么久没有新数据就判死。注意：这不是总时长上限，只是「卡住了」的判据 —— 慢但一直在动的网络不会被误杀
let CUR = null;           // 当前这次下载，给 cancelDownload() 用

function updatesDir() { const d = path.join(os.homedir(), '.uw-desktop', 'updates'); fs.mkdirSync(d, { recursive: true }); return d; }

/* 中断当前下载。.part 故意留着 —— 下次点更新会接着下，不是从零。
   🔴 光调 reader.cancel() 不够：read() 已经挂死时它唤不醒，用户点了取消还得干等一个看门狗周期（45 秒）。
      所以另外备一个 wake()，让「取消」自己就能让那场赛跑立刻出结果。 */
function cancelDownload() {
  if (!CUR) return false;
  CUR.canceled = true;
  try { CUR.wake && CUR.wake(); } catch (e) { /* 还没进读循环 */ }
  try { CUR.reader && CUR.reader.cancel(); } catch (e) { /* 读不动了本来就要靠上面那下兜 */ }
  return true;
}

async function download(url, expectedSize, onProgress) {
  const dest = path.join(updatesDir(), path.basename(new URL(url).pathname));
  if (expectedSize && fs.existsSync(dest) && fs.statSync(dest).size === expectedSize) { onProgress && onProgress({ done: expectedSize, total: expectedSize, cached: true }); return dest; }
  const tmp = dest + '.part';

  /* 上次没下完的接着下。.part 比整包还大说明它脏了（或者服务器换了包），删掉重来。 */
  let from = 0;
  try { const st = fs.statSync(tmp); if (st.isFile()) { if (expectedSize && st.size >= expectedSize) fs.rmSync(tmp, { force: true }); else from = st.size; } } catch (e) { /* 没有 .part 就是全新下载 */ }

  const headers = { 'User-Agent': 'UED-WorkBuddy/' + app.getVersion() };
  if (from > 0) headers['Range'] = `bytes=${from}-`;

  const ctx = CUR = { canceled: false, reader: null, wake: null };
  let r;
  try { r = await withTimeout(net.fetch(url, { headers }), CHECK_MS, '连上下载地址'); }
  catch (e) { CUR = null; throw new Error(ctx.canceled ? '已取消' : `连不上下载地址：${e.message}。换个网络再试，或者点「打开下载页」自己下。`); }

  if (r.status === 416) { fs.rmSync(tmp, { force: true }); CUR = null; throw new Error('接着下的位置不对（服务器上的包可能换过了），已清掉，再点一次会从头下'); }
  if (!r.ok || !r.body) { CUR = null; throw new Error(`下载失败：服务器回了${r.status}`); }

  /* 回 206 才是真的认了续传；回 200 表示它要整包重发，那就从头写。 */
  let resumed = false;
  if (from > 0) { if (r.status === 206) resumed = true; else from = 0; }
  const cl = +r.headers.get('content-length') || 0;
  const total = (resumed ? from + cl : cl) || expectedSize || 0;

  const out = fs.createWriteStream(tmp, { flags: resumed ? 'a' : 'w' });
  const reader = r.body.getReader(); ctx.reader = reader;
  let done = from, lastAt = 0;
  onProgress && onProgress({ done, total, resumed });
  /* 「取消」那一路。整个下载共用一个，race 里每轮复用；挂个空 catch 免得正常下完时它变成没人管的 rejection。 */
  const canceledP = new Promise((_, rej) => { ctx.wake = () => rej(Object.assign(new Error('canceled'), { canceled: 1 })); });
  canceledP.catch(() => {});
  try {
    for (;;) {
      /* 三方赛跑：新数据 / 看门狗 / 取消。哪个先到听哪个。
         用 race 而不是只靠 reader.cancel()，是因为 read() 挂死时能不能被唤醒依赖底层实现，race 不依赖。 */
      let timer;
      const stall = new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error('stall'), { stall: 1 })), STALL_MS); });
      let chunk;
      try { chunk = await Promise.race([reader.read(), stall, canceledP]); } finally { clearTimeout(timer); }
      if (ctx.canceled) throw Object.assign(new Error('canceled'), { canceled: 1 });
      if (chunk.done) break;
      const buf = Buffer.from(chunk.value);
      if (!out.write(buf)) await new Promise(res => out.once('drain', res));   // 写盘跟不上就等一下，别把 231MB 堆在内存里
      done += buf.length;
      if (onProgress && Date.now() - lastAt > 120) { lastAt = Date.now(); onProgress({ done, total, resumed }); }
    }
  } catch (e) {
    out.destroy(); CUR = null;
    try { reader.cancel(); } catch (e2) { /* 已经断了 */ }
    let got = 0; try { got = fs.statSync(tmp).size; } catch (e2) { /* 一块都没落盘 */ }
    if (e.canceled || ctx.canceled) throw new Error(`已取消。已经下好的${mb(got)}留着了，下次会接着下。`);   // 取消优先于看门狗：两个同时到时报「取消」才对得上用户刚做的动作
    if (e.stall) throw new Error(`下载卡住了：${Math.max(1, Math.round(STALL_MS / 1000))}秒没收到新数据，停在${mb(got)} / ${mb(total)}。已下的留着了，网络好一点再点一次会接着下，不用从头来。`);
    throw e;
  }
  await new Promise((res, rej) => { out.end(); out.on('finish', res); out.on('error', rej); });
  CUR = null;
  const got = fs.statSync(tmp).size;
  if (expectedSize && got !== expectedSize) { fs.rmSync(tmp, { force: true }); throw new Error(`下载的文件大小不对（拿到${mb(got)}，应该是${mb(expectedSize)}），多半是被网络截断了。已清掉，再点一次重新下。`); }
  fs.renameSync(tmp, dest);
  onProgress && onProgress({ done: total || got, total: total || got });
  return dest;
}

/* 换包脚本。参数：dmg 路径、目标 .app 路径、要等的 pid、要不要重开。
   写成独立文件给 bash 跑，脱离父进程（setsid 不可用，靠 detached + unref），这样应用退出它还活着。

   🔴 2026-09-18 改掉了两件跟 Dock 图标有关的事（起因：吉吉升到 0.1.48 后图标变白框）：
   ① 备份不再叫 `<app>.updating-bak` 放在 /Applications 里。那个名字虽然不是 .app 结尾，
      LS 照样把它认成同一个 bundle id 的应用登记下来，目录删掉记录却留着 —— 每更新一次积一条，
      攒到某次被 Dock 挑中就拿不到 icns、退回白图标。现在备份和暂存都在 ~/.uw-desktop/updates 下。
   ② 改成「拷到暂存 → mv 就位」。ditto 是一个文件一个文件写的，直接往 /Applications 里 ditto，
      写到一半那份是残缺 bundle，Dock 和 LS 随时可能扫到；mv 同卷是 rename，/Applications 里
      永远只有完整的一份。顺带把「拷贝失败」变得更安全：失败时原来那份根本还没被动过。
   装完主动修一次图标（注销脏记录 / 重新登记 / 清图标缓存 / 重启 Dock），并记一笔到
   ~/.uw-desktop/icon-heal.json，让新版启动时的自愈知道这一版已经治过，别让 Dock 白闪两回。
   🔴 但这段脚本是**发起更新的那一版**写出来的 —— 装着旧版的同事这一次升级走的还是旧脚本，
   所以 main/icon-heal.js 那层启动自愈不能省。两层缺一层就有人看见白框。
   lsregister / killall / 图标缓存目录都留了环境变量口子，门靠它把系统副作用接到假命令上验。
   🔴 脚本里变量后面紧跟中文，一律写 ${VER} 别写 $VER：这段脚本是 detached 进程跑的，
      LANG 往往没设，bash 按字节解析时会把中文「）」的首字节 EF 当成变量名的一部分吞掉 ——
      2026-09-18 真跑时日志里就出现了「图标已刷新（版本 ▒」，版本号整个不见了。 */
function installScript() {
  return `#!/bin/bash
# UED WorkBuddy 自更新：等旧进程退出 → 挂 dmg → 换 .app → 去隔离标记 → 修图标 → 弹出 → 重开
DMG="$1"; APP="$2"; PID="$3"; RELAUNCH="$4"; LOG="$5"
exec >>"$LOG" 2>&1
echo "== $(date '+%F %T') 开始 dmg=$DMG app=$APP pid=$PID"
LSREG="\${UW_LSREGISTER:-/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister}"
KILLALL="\${UW_KILLALL:-killall}"
WORK="$HOME/.uw-desktop/updates"; STAGE="$WORK/staging"; BAK="$WORK/rollback-bundle"
for i in $(seq 1 60); do kill -0 "$PID" 2>/dev/null || break; sleep 0.5; done
kill -0 "$PID" 2>/dev/null && { echo "旧进程60秒没退，强制结束"; kill -9 "$PID" 2>/dev/null; sleep 1; }
MNT=$(mktemp -d /tmp/uw-update.XXXXXX)
hdiutil attach -quiet -nobrowse -noautoopen -mountpoint "$MNT" "$DMG" || { echo "挂载dmg失败"; exit 1; }
SRC=$(ls -d "$MNT"/*.app 2>/dev/null | head -1)
[ -n "$SRC" ] || { echo "dmg里没有 .app"; hdiutil detach -quiet "$MNT"; exit 1; }
mkdir -p "$WORK"; rm -rf "$STAGE" "$BAK"; mkdir -p "$STAGE"
# 先整个拷到暂存区。这一步失败时原来那份一个字都还没动，比「先挪走再拷」安全。
ditto "$SRC" "$STAGE/new.app" || { echo "拷贝失败，原来那份没动"; rm -rf "$STAGE"; hdiutil detach -quiet "$MNT"; exit 1; }
xattr -dr com.apple.quarantine "$STAGE/new.app" 2>/dev/null
[ -d "$APP" ] && { mv "$APP" "$BAK" || { echo "挪不开旧的"; rm -rf "$STAGE"; hdiutil detach -quiet "$MNT"; exit 1; }; }
if mv "$STAGE/new.app" "$APP"; then rm -rf "$BAK" "$STAGE"; echo "已换上$APP"; else echo "就位失败，回滚"; rm -rf "$APP" "$STAGE"; [ -d "$BAK" ] && mv "$BAK" "$APP"; hdiutil detach -quiet "$MNT"; exit 1; fi
hdiutil detach -quiet "$MNT" || { sleep 2; hdiutil detach -quiet -force "$MNT"; }
# 图标：把旧脚本留下的坏记录摘掉、正主重新登记、扔掉缓存里那张白图、Dock 重读。为什么 → main/icon-heal.js
"$LSREG" -u "$APP.updating-bak" >/dev/null 2>&1; rm -rf "$APP.updating-bak"
"$LSREG" -f "$APP" >/dev/null 2>&1
ICONC="\${UW_ICON_CACHE_DIR:-}"
[ -z "$ICONC" ] && { ICONC=$(getconf DARWIN_USER_CACHE_DIR 2>/dev/null); ICONC="\${ICONC%/}"; }
[ -n "$ICONC" ] && rm -rf "$ICONC/com.apple.iconservices" "$ICONC/com.apple.iconservicesagent"
"$KILLALL" Dock >/dev/null 2>&1
VER=$(defaults read "$APP/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null)
[ -n "$VER" ] && printf '{"version":"%s","at":"%s"}' "$VER" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$HOME/.uw-desktop/icon-heal.json"
echo "图标已刷新（版本 \${VER}）"
[ "$RELAUNCH" = "1" ] && open -a "$APP"
echo "== 完成"
`;
}
/* Windows 换包脚本（PowerShell）。参数：setup.exe、要重开的 exe、要等的 pid、要不要重开、日志。
   · 用 $ProcId 不用 $pid：$PID 是 PowerShell 的保留变量（当前进程号），覆盖它会报错。
   · setup.exe /S 是 NSIS 静默安装；electron-builder 的一键包会读注册表装回原位置、先卸旧的再装新的。
   · 下载到本地的文件没有 Zone.Identifier（不是浏览器下的），SmartScreen 不会弹。 */
function installScriptWin() {
  return `param([string]$Setup, [string]$Exe, [int]$ProcId, [string]$Relaunch, [string]$Log)
$ErrorActionPreference = 'Continue'
function L($m) { ("$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') " + $m) | Out-File -FilePath $Log -Append -Encoding utf8 }
L "== 开始 setup=$Setup exe=$Exe pid=$ProcId"
try { Wait-Process -Id $ProcId -Timeout 60 -ErrorAction SilentlyContinue } catch {}
if (Get-Process -Id $ProcId -ErrorAction SilentlyContinue) { L "旧进程60秒没退，强制结束"; Stop-Process -Id $ProcId -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 1 }
if (-not (Test-Path -LiteralPath $Setup)) { L "安装包不存在：$Setup"; exit 1 }
$p = Start-Process -FilePath $Setup -ArgumentList '/S' -Wait -PassThru
L "安装程序退出码 $($p.ExitCode)"
if ($p.ExitCode -ne 0) { L "安装失败"; exit 1 }
if ($Relaunch -eq '1') { if (Test-Path -LiteralPath $Exe) { Start-Process -FilePath $Exe } else { L "装完找不到 $Exe，请从开始菜单打开" } }
L "== 完成"
`;
}
/* 装：把脚本写到 ~/.uw-desktop/updates/，起进程，然后由调用方 app.quit()。脚本会等本进程真退了再动手。 */
function install(pkgPath, { relaunch = true, appPath } = {}) {
  const dir = updatesDir(), log = path.join(dir, 'install.log');
  if (process.platform === 'win32') {
    const exe = appPath || process.execPath;
    const ps1 = path.join(dir, 'install.ps1');
    fs.writeFileSync(ps1, installScriptWin());
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', ps1,
      '-Setup', pkgPath, '-Exe', exe, '-ProcId', String(process.pid), '-Relaunch', relaunch ? '1' : '0', '-Log', log],
      { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    return { ok: true, script: ps1, log, target: exe };
  }
  const target = appPath || appBundlePath();
  if (!target) throw new Error('找不到当前应用所在位置，只能手动装');
  const sh = path.join(dir, 'install.sh');
  fs.writeFileSync(sh, installScript(), { mode: 0o755 });
  const child = spawn('/bin/bash', [sh, pkgPath, target, String(process.pid), relaunch ? '1' : '0', log], { detached: true, stdio: 'ignore' });
  child.unref();
  return { ok: true, script: sh, log, target };
}
/* 从可执行文件路径反推 .app 目录：/Applications/UED WorkBuddy.app/Contents/MacOS/UED WorkBuddy → /Applications/UED WorkBuddy.app
   Windows 没有 .app 这层，可执行文件本身就是目标。 */
function appBundlePath() {
  if (process.platform === 'win32') return process.execPath;
  const exe = process.execPath; const k = exe.indexOf('.app/Contents/');
  return k > 0 ? exe.slice(0, k + 4) : null;
}

module.exports = { check, download, cancelDownload, install, pickLatest, cmpVer, installScript, installScriptWin, appBundlePath, updatesDir, withTimeout, ASSET, REPO, TAG_PREFIX, STALL_MS, CHECK_MS };
