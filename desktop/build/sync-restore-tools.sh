#!/bin/bash
# 把 mic-fullstack skill 里的还原工具链同步进 restore-tools/（随应用发给同事的那份）。
# 🔴 restore-tools/ 是副本不是正本 —— 改脚本一律改 skill 里的正本，然后跑这个脚本同步，
#    别直接改 restore-tools/ 里的，否则两处会各漂各的。
# 🔴 走 extraResources 不走 packs/：packs 整个是 asarUnpack，
#    往里塞 node_modules 那几千个文件会让通用包合并报 pattern is too long 构建失败。
set -e
S="$HOME/.claude/skills/mic-fullstack/scripts"
D="$(cd "$(dirname "$0")/.." && pwd)/restore-tools"
[ -d "$S" ] || { echo "本机没装 mic-fullstack skill，跳过同步（用仓库里现有那份）"; exit 0; }
mkdir -p "$D/online-reach" "$D/restore-coverage"
# 🔴 find-chrome.js 必须在这份清单里：reach.sh / shot-node.js 都 require 它，
#    漏了的话同事拿到的包里这两个脚本会直接报「找不到模块」——比没改之前更糟。
for f in reach.js reach.sh find-chrome.js responsive-spec-extract.js responsive-diff.js geom-check.js \
         visual-verify.js live-clone.js clone-offline-check.js online-spec.js shot-node.js; do
  cp "$S/online-reach/$f" "$D/online-reach/"
done
for f in coverage-check.js figma-restore-dump.snippet.js figma-manifest.snippet.js \
         manifest-verify.js inject_svg.py; do
  cp "$S/restore-coverage/$f" "$D/restore-coverage/"
done
rsync -a --delete "$S/online-reach/node_modules/" "$D/online-reach/node_modules/"
chmod +x "$D/online-reach/reach.sh"
# ── 出口脱敏：这个仓是公开的（github.com/MIC-ued-cloud-design/ued-workbuddy）──
#    skill 正本里的注释会写「吉吉一眼看出来的」这类话，内部仓没问题，公开仓里就是把个人称呼发出去。
#    🔴 做成「生成器出口焊死」而不是手改副本 —— 跟 kb.js 那次脱敏（c6d7a29）同一个办法：
#    手改副本下次跑同步就被覆盖回去，焊在出口才不会回潮。
#    这是确定性替换、不是另起一份改动，所以不违反「副本不是正本」那条。
for f in "$D/online-reach"/*.js "$D/online-reach"/*.sh "$D/restore-coverage"/*.js "$D/restore-coverage"/*.py; do
  [ -f "$f" ] || continue
  LC_ALL=C sed -i '' 's/吉吉/用户/g' "$f"
done
left=$(grep -rl "吉吉" "$D" --include="*.js" --include="*.sh" --include="*.py" 2>/dev/null | grep -v node_modules | wc -l | tr -d ' ')
[ "$left" != "0" ] && { echo "❌ 脱敏没干净，还有 $left 个文件带个人称呼"; exit 1; }
echo "出口脱敏通过：副本里没有个人称呼"

# ── 同步后自检：别让「清单漏一个文件」变成同事那边才发现的坏 ──
#    做法是把每个脚本里 require 的兄弟文件名抠出来，逐个确认副本里真有。
miss=0
for f in "$D/online-reach"/*.js; do
  for dep in $(grep -oE "find-chrome\.js|require\(require\('path'\)\.join\(__dirname, *'[^']+'" "$f" 2>/dev/null | grep -oE "[a-z-]+\.js" | sort -u); do
    [ -f "$D/online-reach/$dep" ] || { echo "❌ $(basename "$f") 依赖 $dep，但副本里没有——把它加进上面的文件清单"; miss=1; }
  done
done
[ "$miss" = 1 ] && exit 1
# 🔴 *.snippet.js 不能用 node --check 量：它们是贴进 use_figma 的代码片段，
#    顶层 await 在那个环境里合法，在 Node 里必然报错。量错对象会得到一个假红。
for f in "$D/online-reach"/*.js "$D/restore-coverage"/*.js; do
  case "$f" in *.snippet.js) continue;; esac
  node --check "$f" >/dev/null 2>&1 || { echo "❌ $(basename "$f") 语法不过"; exit 1; }
done
echo "自检通过：依赖齐全 + 所有 js 语法可解析"

echo "已同步：$(ls "$D/online-reach"/*.js | wc -l | tr -d ' ') 个 online-reach 脚本 + $(ls "$D/restore-coverage" | wc -l | tr -d ' ') 个 restore-coverage 文件 · $(du -sh "$D" | cut -f1)"
