#!/bin/bash
# 发一版桌面端到 GitHub Releases：打包（Mac dmg + Windows exe）→ 核对包内代码与源码一致 → gh release create desktop-vX.Y.Z 挂两个包
# 用法：build/release.sh "一句话更新说明（可多行，用 \n）"
# 环境变量：SKIP_BUILD=1 用 dist/ 里已有的包；SKIP_WIN=1 这次不出 Windows 包（只发 dmg）
# 前提：gh 已登录（gh auth status）。tag 前缀 desktop-v 是给客户端里的更新检查认的，别改。
# 🔴 上传 230MB dmg + 150MB exe 要 15–25 分钟，前台跑会超时：后台跑，守 release 的 draft:false（gh 先建草稿、传完才转正式）。
set -euo pipefail
cd "$(dirname "$0")/.."
VER=$(node -p "require('./package.json').version")
TAG="desktop-v$VER"
NOTES="${1:-}"
DMG="dist/UED-WorkBuddy-$VER-universal.dmg"
EXE="dist/UED-WorkBuddy-$VER-win-x64-setup.exe"
REPO="MIC-ued-cloud-design/ued-workbuddy"
# Windows 打包工具（makensis、winCodeSign）默认从 GitHub 拉，公司网络掐 GitHub 时走国内镜像
export ELECTRON_BUILDER_BINARIES_MIRROR="${ELECTRON_BUILDER_BINARIES_MIRROR:-https://npmmirror.com/mirrors/electron-builder-binaries/}"

if gh release view "$TAG" -R "$REPO" >/dev/null 2>&1; then echo "❌ $TAG 已经发过了。改 package.json 的 version 再发"; exit 1; fi
[ -n "$NOTES" ] || { echo "❌ 要写一句更新说明（同事会在更新条上看到）"; exit 1; }

if [ "${SKIP_BUILD:-}" = "1" ] && [ -f "$DMG" ]; then echo "▶ 跳过打包，用已有的 ${DMG}（SKIP_BUILD=1）"; else
echo "▶ 打包 Mac $VER"
npm run dist >/tmp/uw-release-dist.log 2>&1 || { tail -20 /tmp/uw-release-dist.log; exit 1; }
fi
[ -f "$DMG" ] || { echo "❌ 没找到 $DMG"; exit 1; }
# 🔴 清掉 electron-builder 的两个中间 .app（mac-universal-{x64,arm64}-temp）。
# 它们跟正式包是同一个 bundle id，在盘上待过就会被 LaunchServices 登记一条，删掉后记录留在库里；
# 同一个 id 攒了一堆指向不存在路径的记录，Dock 挑中哪条就拿不到 icns、退回白图标
# （2026-09-18 吉吉那台就是这么来的，六条记录里四条是死的）。dist/mac-universal 下的成品留着，release 要用。
rm -rf dist/mac-universal-x64-temp dist/mac-universal-arm64-temp
if [ "${SKIP_WIN:-}" != "1" ]; then
  if [ "${SKIP_BUILD:-}" = "1" ] && [ -f "$EXE" ]; then echo "▶ 跳过打包，用已有的 ${EXE}（SKIP_BUILD=1）"; else
  echo "▶ 打包 Windows $VER"
  npm run dist:win >/tmp/uw-release-dist-win.log 2>&1 || { tail -20 /tmp/uw-release-dist-win.log; exit 1; }
  fi
  [ -f "$EXE" ] || { echo "❌ 没找到 $EXE"; exit 1; }
fi

# 包内九个关键文件必须跟源码逐字一致（打包用的是工作区，忘存盘 / 打错目录都会在这儿露出来）
# 🔴 加了新的源文件就要往这里加一条，不然这道门会全绿而文件其实没进包（门只核对它认识的那几个）
SRC_FILES="main/main.js main/preload.js main/updater.js main/icon-heal.js main/htmlmap.js main/edit-probe.js main/components.js main/engine.js main/shellenv.js main/feique-font.js main/feique-check.js main/handoff.js main/flow.js main/flow-doc.js main/flow-walk.js main/feique-empty.js renderer/app.js renderer/index.html renderer/app.css renderer/flow.html renderer/flow.js renderer/flow.css"
check_asar() { # $1=解出来的目录 $2=标签
  local T="$1" tag="$2" f
  for f in $SRC_FILES; do
    [ "$(md5 -q "$f")" = "$(md5 -q "$T/$f")" ] || { echo "❌ ${tag}包里的 $f 跟源码不一致"; BAD=1; }
  done
}
BAD=0
echo "▶ 核对 Mac 包内代码与源码一致"
T=$(mktemp -d); M=$(mktemp -d)
hdiutil attach -quiet -nobrowse -mountpoint "$M" "$DMG"
npx --yes @electron/asar extract "$M/UED WorkBuddy.app/Contents/Resources/app.asar" "$T" >/dev/null 2>&1
check_asar "$T" "Mac "
PKGV=$(defaults read "$M/UED WorkBuddy.app/Contents/Info.plist" CFBundleShortVersionString)
hdiutil detach -quiet "$M"; rm -rf "$T"
[ "$PKGV" = "$VER" ] || { echo "❌ Mac 包版本 $PKGV ≠ $VER"; BAD=1; }
if [ "${SKIP_WIN:-}" != "1" ]; then
  echo "▶ 核对 Windows 包内代码与源码一致"
  W="dist/win-unpacked"
  [ -f "$W/resources/app.asar" ] || { echo "❌ 没有 $W/resources/app.asar（electron-builder 没留 win-unpacked？）"; BAD=1; }
  if [ -f "$W/resources/app.asar" ]; then
    T=$(mktemp -d); npx --yes @electron/asar extract "$W/resources/app.asar" "$T" >/dev/null 2>&1
    check_asar "$T" "Windows "
    WV=$(node -p "require('$T/package.json').version"); rm -rf "$T"
    [ "$WV" = "$VER" ] || { echo "❌ Windows 包版本 $WV ≠ $VER"; BAD=1; }
    [ -f "$W/resources/kbdocs/INDEX.md" ] || { echo "❌ Windows 包里没带 kbdocs（同事的应用会「什么都不懂」）"; BAD=1; }
    [ -d "$W/resources/app.asar.unpacked/packs/feique" ] || { echo "❌ Windows 包里没带飞鹊包"; BAD=1; }
    [ -s "$W/resources/app.asar.unpacked/packs/feique/fonts/roboto-400.woff2" ] || { echo "❌ Windows 包里没带 Roboto 字体（字重会劈叉）"; BAD=1; }
  fi
fi
[ "$BAD" = 0 ] || exit 1

ASSETS=("$DMG"); [ "${SKIP_WIN:-}" != "1" ] && ASSETS+=("$EXE")
echo "▶ 发 release ${TAG}（$(for a in "${ASSETS[@]}"; do printf '%s %s  ' "$(basename "$a")" "$(du -h "$a" | cut -f1)"; done)）"
gh release create "$TAG" "${ASSETS[@]}" -R "$REPO" --title "UED WorkBuddy 桌面版 $VER" --notes "$(printf '%b' "$NOTES")"
echo "▶ 核对 GitHub 上那条能被客户端认出来（Mac 与 Windows 各挑一次）"
node -e '
const U = (()=>{ require.cache[require.resolve("electron")]={id:"electron",filename:"electron",loaded:true,exports:{app:{getVersion:()=>"0.0.0"},net:{}}}; return require("./main/updater.js"); })();
const { execSync } = require("child_process");
const rels = JSON.parse(execSync("gh api repos/'"$REPO"'/releases?per_page=15", {encoding:"utf8"}));
let bad = 0;
for (const pf of ["darwin", ...(process.env.SKIP_WIN === "1" ? [] : ["win32"])]) {
  const r = U.pickLatest(rels, "0.0.0", pf);
  if (!r.hasUpdate || r.version !== "'"$VER"'") { console.log("❌", pf, "客户端会挑到：", r); bad = 1; continue; }
  console.log("✅", pf, "客户端会挑到", r.version, r.url, (r.size/1048576).toFixed(0)+"MB");
}
process.exit(bad);
'
# 🔴 清旧包放在这儿，不能更早：要等 release 建好、而且两个平台的 pickLatest 都回查过，
# 本地那些旧包才真的可以扔。清早了万一发失败，手里就什么都没有了。
echo "▶ 清 dist 里的旧包"
build/clean-dist.sh "$VER" "$REPO"

echo "✅ 发完：https://github.com/$REPO/releases/tag/$TAG"
echo "   永久下载页：https://github.com/$REPO/releases/latest（永远指向最新版，给同事发这个）"
echo "   同事那边的客户端（Mac ≥0.1.26 / Windows ≥0.1.46）启动 3 秒后会看到更新条。"
