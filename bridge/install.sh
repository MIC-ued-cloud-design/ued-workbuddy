#!/bin/bash
# UW 本机桥 · 一行安装（macOS）
#
#   curl -fsSL https://mic-ued-cloud-design.github.io/ued-workbuddy/bridge/install.sh | bash
#   bash install.sh --uninstall      卸载
#   bash install.sh --status         看它在不在跑
#
# 做四件事：找 Node 和 Claude Code → 把 uw-bridge.js 放到 ~/.uw-bridge → 真答一句确认能跑 → 设置成开机自动启动。
# 不需要 sudo，不改系统目录，只写你自己的 ~/Library/LaunchAgents。
set -u

BASE="${UW_BRIDGE_BASE:-https://mic-ued-cloud-design.github.io/ued-workbuddy/bridge}"
DIR="$HOME/.uw-bridge"
LABEL="com.ued.uw-bridge"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PORT=17331

say(){ printf '%s\n' "$*"; }
die(){ printf '❌ %s\n' "$*" >&2; exit 1; }

if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"; rm -rf "$DIR"
  say "✅ 已卸载。页面会自动退回部门共享通道。"
  exit 0
fi
if [ "${1:-}" = "--status" ]; then
  if curl -fsS -m 2 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then say "✅ 桥在跑：http://127.0.0.1:$PORT"; else say "⚪ 桥没在跑"; fi
  launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 && say "   开机自动启动：已设置" || say "   开机自动启动：没设置"
  exit 0
fi

# ── 1. Node ──────────────────────────────────────────────
NODE="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE" ]; then
  for d in "$HOME"/.nvm/versions/node/*/bin /opt/homebrew/bin /usr/local/bin; do
    [ -x "$d/node" ] && NODE="$d/node" && break
  done
fi
[ -n "$NODE" ] || die "没找到 Node.js。装了 Claude Code 的电脑一般都有，如果没有，先装 Node（nodejs.org），再回来跑这一行。"
NODE_MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
[ "$NODE_MAJOR" -ge 18 ] 2>/dev/null || die "Node 版本太老（$("$NODE" -v)），要 18 以上。"
NODE_DIR="$(dirname "$NODE")"

# ── 2. Claude Code（优先公司的 FCF 启动器）──────────────
if [ -x "$HOME/.fcf/bin/claude" ]; then
  CLAUDE="$HOME/.fcf/bin/claude"; VIA="FCF（走公司代理和上报）"
else
  CLAUDE="$(command -v claude 2>/dev/null || true)"; VIA="PATH 里的 claude"
fi
[ -n "$CLAUDE" ] || die "没找到 Claude Code。先确认终端里敲 claude 能用，再回来跑这一行。"
CLAUDE_DIR="$(dirname "$CLAUDE")"

# ── 3. 放脚本 ────────────────────────────────────────────
mkdir -p "$DIR"
SELF="${BASH_SOURCE[0]:-}"
if [ -n "$SELF" ] && [ -f "$SELF" ] && [ -f "$(dirname "$SELF")/uw-bridge.js" ]; then
  cp "$(dirname "$SELF")/uw-bridge.js" "$DIR/uw-bridge.js"; SRC="本地副本"
else
  curl -fsSL "$BASE/uw-bridge.js" -o "$DIR/uw-bridge.js" || die "下载 uw-bridge.js 失败（${BASE}）。公司网络能打开 UW 页面的话这一步不该失败，重试一次。"
  SRC="$BASE"
fi
"$NODE" --check "$DIR/uw-bridge.js" || die "下载到的脚本不完整，重试一次。"

# ── 4. 先真答一句确认能跑（在设置开机自启之前，失败了就不设）────
say "▶ 正在用你的 Claude Code 试答一句（约 5 秒）…"
PATH="$NODE_DIR:$CLAUDE_DIR:$PATH" "$NODE" "$DIR/uw-bridge.js" --check || die "Claude Code 这次没跑成。常见原因是登录过期：在终端敲一次 claude，看看要不要重新登录，然后再跑这一行。"

# ── 5. 设置开机自动启动 ────────────────────────────────────────
mkdir -p "$HOME/Library/LaunchAgents"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>$NODE</string>
    <string>$DIR/uw-bridge.js</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$NODE_DIR:$CLAUDE_DIR:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key><string>$HOME</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$DIR/log.txt</string>
  <key>StandardErrorPath</key><string>$DIR/log.txt</string>
</dict></plist>
EOF
launchctl bootstrap "gui/$(id -u)" "$PLIST" || die "设置开机自动启动失败。手动跑也行：$NODE $DIR/uw-bridge.js"

# ── 6. 确认它起来了 ──────────────────────────────────────
for i in 1 2 3 4 5 6 7 8 9 10; do
  curl -fsS -m 1 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break
  sleep 0.5
done
if curl -fsS -m 2 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
  say ""
  say "✅ 装好了。桥在 http://127.0.0.1:$PORT 上一直跑着，开机自动启动。"
  say "   Node：$NODE"
  say "   Claude：${CLAUDE}（${VIA}）"
  say "   脚本来源：$SRC"
  say "   日志：$DIR/log.txt"
  say ""
  say "现在刷新 UW 页面，模型处会出现「Claude Opus · 本机」，问答默认走它。"
  say "不想用了：bash <(curl -fsSL $BASE/install.sh) --uninstall"
else
  die "开机自动启动设置好了，但桥没响应。看日志：$DIR/log.txt"
fi
