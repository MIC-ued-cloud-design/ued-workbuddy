#!/bin/bash
# reach.sh — 一条命令后台读取一个页面（起独立 Chrome → reach.js → 清理）
# 用法: reach.sh <URL> [截图路径] [cookie-state.json] [CSS选择器]
#   公开页:   reach.sh "https://www.made-in-china.com/xxx" /tmp/x.png
#   登录态页: reach.sh "<VO页url>" /tmp/x.png ~/.online-reach-state/mic.json
#   取精确CSS: reach.sh "<url>" /tmp/x.png "" ".some-selector"
#   触屏真值: reach.sh "<url>" /tmp/x.png "" "" "" "" "<JS>" iphone 375 812
#   🔴 第7参 <JS> 会被包进 `async () => { <JS> }`，所以脚本必须自己 `return`；
#      写成裸 IIFE（(()=>{...})()）返回值会被丢掉，表现是 RESULT 里 evalResult 和 evalErr 都没有。
# 用的是独立 user-data-dir + 独立端口，绝不碰你日常 Chrome（不占用前置页面）。
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
URL="$1"; SHOT="${2:-/tmp/reach-shot.png}"; STATE="$3"; CSS="$4"; LINKS="$5"; ANNOTATE="$6"; EVALJS="$7"; UA="$8"; VW="$9"; VH="${10}"
PORT=9224
# Chrome 路径不再写死（2026-09-15）：同事那台没装在标准位置就整条链跑不起来。
# find-chrome.js 会依次试 CHROME_PATH → 常见安装位置 → mdfind 全盘找，找不到会打印三条自救路径。
CHROME="$(node "$DIR/find-chrome.js")" || exit 1

[ -z "$URL" ] && { echo "用法: reach.sh <URL> [截图] [cookie.json] [CSS选择器]"; exit 1; }

# 起独立后台 Chrome（真实 Chrome.app 过反爬指纹 + 独立 profile 不占日常）
pkill -f online-reach-debug 2>/dev/null || true; rm -rf /tmp/online-reach-debug; sleep 1
"$CHROME" --remote-debugging-port=$PORT --user-data-dir=/tmp/online-reach-debug \
  --no-first-run --no-default-browser-check --disable-blink-features=AutomationControlled \
  about:blank >/tmp/reach-chrome.log 2>&1 &
sleep 8
curl -s "http://localhost:$PORT/json/version" >/dev/null || { echo "ERR Chrome/CDP 没起来"; exit 1; }

# 读取（reach.js 输出 RESULT {...}）
ARGS=(--port "$PORT" --url "$URL" --shot "$SHOT")
[ -n "$STATE" ] && ARGS+=(--state "$STATE")
[ -n "$CSS" ] && ARGS+=(--css "$CSS")
[ -n "$LINKS" ] && ARGS+=(--links "$LINKS")
[ -n "$ANNOTATE" ] && ARGS+=(--annotate "$ANNOTATE")
[ -n "$EVALJS" ] && ARGS+=(--eval "$EVALJS")
# 触屏/移动端真值：第8参 UA（iphone|android|mac|自定义串），第9/10参 视口宽高
[ -n "$UA" ] && ARGS+=(--ua "$UA")
[ -n "$VW" ] && ARGS+=(--vw "$VW")
[ -n "$VH" ] && ARGS+=(--vh "$VH")
node "$DIR/reach.js" "${ARGS[@]}"

# 清理（独立 Chrome 关掉，state 文件保留复用）
pkill -f online-reach-debug 2>/dev/null || true; sleep 1
