#!/bin/bash
# 发完版之后清掉 dist 里的旧包。由 build/release.sh 在 release 确认成功之后调。
# 用法：build/clean-dist.sh <当前版本> <repo> [dist目录]
#
# 为什么要有这个：每发一版 dist 就攒 ~600M，2026-09-18 攒到 19G 才被人看见
# （吉吉「把 dist 里的清一下，只留最新版本就行」）。靠记性清＝迟早又攒到 19G。
#
# 🔴 判据（这一条比省空间重要）：**只删「GitHub 上已经有的那些版本」的本地包**。
#    没发布过的开发包，本地这一份就是最后一份 —— 机器不替人做那个决定，只打印出来让人自己删。
#    清理和销毁最后一份，在命令行上长得一模一样；2026-09-18 手工清那次，
#    38 个版本里就有 9 个（0.1.17–0.1.25）是从没发布过的。
# 🔴 中间产物 mac-universal/ 和 win-unpacked/ 不动：它们下次发版会被原地覆盖，不会累积，
#    而且 release.sh 要拿 win-unpacked 核对 Windows 包内代码。
set -euo pipefail
VER="${1:?要传当前版本号}"
REPO="${2:?要传 owner/repo}"
DIST="${3:-dist}"

[ -d "$DIST" ] || { echo "   （没有 $DIST，不用清）"; exit 0; }

REMOTE=$(gh release list -R "$REPO" -L 100 --json tagName -q '.[].tagName' 2>/dev/null | sed 's/^desktop-v//' || true)
if [ -z "$REMOTE" ]; then
  echo "   ⚠️ 查不到 GitHub 上有哪些版本，这次不清（宁可多占盘，也不删可能是最后一份的包）"
  exit 0
fi

freed=0; kept=""
for f in "$DIST"/UED-WorkBuddy-*; do
  [ -e "$f" ] || continue
  fv=$(basename "$f" | sed -E 's/^UED-WorkBuddy-([0-9]+\.[0-9]+\.[0-9]+)-.*/\1/')
  [ "$fv" = "$VER" ] && continue                      # 当前版留着
  if printf '%s\n' "$REMOTE" | grep -qx "$fv"; then
    freed=$((freed + $(stat -f%z "$f")))
    rm -f "$f"
  else
    case " $kept " in *" $fv "*) ;; *) kept="$kept $fv" ;; esac
  fi
done

if [ "$freed" -gt 0 ]; then
  echo "   清掉 $((freed / 1048576))MB —— 这些版本 GitHub 上都有，什么时候想要都下得回来"
else
  echo "   没有可清的（dist 里只剩当前版）"
fi
if [ -n "$kept" ]; then
  echo "   ⚠️ 留着没动：$kept"
  echo "      这几版 GitHub 上没有，本地是最后一份。要删请自己删 —— 机器不做这个决定。"
fi
