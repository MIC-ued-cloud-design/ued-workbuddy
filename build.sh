#!/usr/bin/env bash
# build.sh — 从源头重建整个 WorkBuddy 页面，一条命令跑完。
#
# 为什么要有它（2026-09-09）：原来重建要按顺序手敲 8 条命令，中间任何一条挂了
# 后面还会接着跑，产物是半截的；而且只有吉吉这台电脑跑得出来。这两件都堵死了
# 「源头更新一次，页面自动更新」。本脚本负责前一半（顺序 + 失败即停 + 门 + 摘要），
# 跟托管平台无关 —— 将来接内网 GitLab CI，CI 那边只要调这一行。
#
# 用法：
#   bash build.sh              重建 + 跑门 + 出摘要，不提交
#   bash build.sh --push       上面都通过了再 commit + push（会问一次）
#   bash build.sh --full       额外跑 _verify/bridge.js（要开浏览器，慢）
#   bash build.sh --check-only 只做源头体检，不重建
#
# 🔴 顺序是焊死的，别调：patch-terminal 必须在 patch-wizard 之前，
#    patch-mobile 必须最后 —— 它的 CSS 靠「同优先级后来者胜」覆盖前面所有区。

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

PUSH=0; FULL=0; CHECK_ONLY=0
for a in "$@"; do
  case "$a" in
    --push) PUSH=1 ;;
    --full) FULL=1 ;;
    --check-only) CHECK_ONLY=1 ;;
    *) echo "不认识的参数：$a"; exit 2 ;;
  esac
done

SKILL="$(python3 -c "import os;print(os.path.realpath(os.path.expanduser('~/.claude/skills/mic-fullstack')))")"
SKILL_REPO="$(cd "$SKILL" && git rev-parse --show-toplevel 2>/dev/null || echo '')"

hr(){ printf '─%.0s' {1..64}; echo; }
step_no=0
fail(){ echo; echo "❌ 第 $step_no 步挂了：$1"; echo "   产物是半截的，别提交。修完重跑 build.sh。"; exit 1; }

# ── 0. 源头体检 ───────────────────────────────────────────────────
hr; echo "0/9  源头体检"
SRC_HOW="$(python3 -c "
import sys; sys.path.insert(0,'build'); import _src
print(_src.biz_dirs()[1])")" || fail "源头解析（build/_src.py）"
echo "  业务知识读的是：$SRC_HOW"

# payload 落后于 memory 的话，构建出来的是旧知识 —— 但这是对的行为：
# 仓库里没有的东西不该进发布产物，否则同事 pull 不到、CI 也构建不出同一份。
# 所以不静默用新的，报出来让人先跑 sync-to-repo.sh。
python3 - <<'PY'
import sys, os, glob, hashlib
sys.path.insert(0, 'build'); import _src
pay = os.path.join(os.path.realpath(os.path.expanduser(
    '~/.claude/skills/mic-fullstack')), 'biz-knowledge', 'payload')
mem = [d for d in sorted(glob.glob(os.path.expanduser('~/.claude/projects/*/memory')))
       if glob.glob(os.path.join(d, 'mic-biz-*.md'))]
if not (os.path.isdir(pay) and mem):
    print('  （payload 或 memory 缺一边，跳过新鲜度比对）'); raise SystemExit
def sig(ds):
    return {os.path.basename(f): hashlib.md5(open(f,'rb').read()).hexdigest()
            for f in _src.biz_files(ds)}
p, m = sig([pay]), sig(mem)
only_m = sorted(set(m) - set(p)); stale = sorted(k for k in set(m)&set(p) if m[k] != p[k])
if only_m or stale:
    print(f'  ⚠️ 本机 memory 比仓库里的 payload 新：新增 {len(only_m)} 份 · 内容变了 {len(stale)} 份')
    for n in (only_m + stale)[:6]: print('       ·', n)
    if len(only_m + stale) > 6: print(f'       … 还有 {len(only_m+stale)-6} 份')
    print('     这次构建用的是仓库那份（旧的）。要把新知识带上，先跑：')
    print('     bash ~/.claude/skills/mic-fullstack/scripts/sync-to-repo.sh "MIC-0 沉淀"')
else:
    print('  ✅ 仓库 payload 与本机 memory 逐份一致')
PY

if [ -n "$SKILL_REPO" ]; then
  dirty=$(cd "$SKILL_REPO" && git status --porcelain | wc -l | tr -d ' ')
  ahead=$(cd "$SKILL_REPO" && git rev-list --count @{u}..HEAD 2>/dev/null || echo '?')
  if [ "$dirty" != "0" ] || [ "$ahead" != "0" ]; then
    echo "  ⚠️ skill 仓有 $dirty 处未提交、$ahead 个未推送的提交"
    echo "     同事 git pull 拿不到这些 —— 页面会领先于源头，别人复现不出来。"
  else
    echo "  ✅ skill 仓干净且已推送"
  fi
fi
[ "$CHECK_ONLY" = "1" ] && { hr; echo "（--check-only，到此为止）"; exit 0; }

# ── 记录改前指纹，最后出摘要用 ──
before_kb=$(python3 -c "
import re,sys
try: h=open('kb.js',encoding='utf-8').read(300)
except Exception: print('- - -'); sys.exit()
m=re.search(r'\"gen\":\"([\d-]+)\",\"docs\":(\d+),\"chunks\":(\d+)',h)
print(' '.join(m.groups()) if m else '- - -')")
before_sz=$(wc -c < index.html | tr -d ' ')

# ── 1-7. 重建 ────────────────────────────────────────────────────
run(){ step_no=$1; shift; echo; hr; echo "$step_no/9  $1"; shift; "$@" || fail "$*"; }

run 1 "组件清册 / token / 自查表 / 目录 → index.html" python3 build/gen-data.py
run 2 "业务知识与方法论正文 → kb.js"                  python3 build/gen-kb.py
run 3 "资料库界面"                                    python3 build/patch-ui.py
run 4 "检索与模型接入"                                python3 build/patch-ai.py
run 5 "接力到终端（必须在向导之前）"                  python3 build/patch-terminal.py
run 6 "选项式向导 → wizard.html（本地版·不部署）"     python3 build/patch-wizard.py
run 7 "手机版版面（必须最后）"                        python3 build/patch-mobile.py

# ── 8. 门 ────────────────────────────────────────────────────────
echo; hr; echo "8/9  门"
step_no=8
python3 build/secret-check.py || fail "secret-check：有东西像密钥，别推"
echo "  ✅ 没扫到密钥"

# index.html 里的内联 JS 过一遍语法 —— 数组少个逗号会整页 JS 全废，而 patch 脚本不报错
node -e '
const fs=require("fs"),h=fs.readFileSync("index.html","utf8");
let n=0,bad=0;
for(const m of h.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)){
  n++;
  try{ new (require("vm").Script)(m[1]); }
  catch(e){ bad++; console.log("  ❌ 第"+n+"个 <script> 有语法错："+e.message); }
}
console.log(bad? "":"  ✅ "+n+" 段内联 JS 语法都过");
process.exit(bad?1:0);' || fail "index.html 内联 JS 语法门"

if [ "$FULL" = "1" ]; then
  echo "  跑 _verify/bridge.js（开浏览器，慢）…"
  node _verify/bridge.js out || fail "_verify/bridge.js"
fi

# ── 9. 摘要 ──────────────────────────────────────────────────────
echo; hr; echo "9/9  这次构建改了什么"
after_kb=$(python3 -c "
import re
h=open('kb.js',encoding='utf-8').read(300)
m=re.search(r'\"gen\":\"([\d-]+)\",\"docs\":(\d+),\"chunks\":(\d+)',h)
print(' '.join(m.groups()))")
set -- $before_kb; b_gen=$1 b_doc=$2 b_chk=$3
set -- $after_kb;  a_gen=$1 a_doc=$2 a_chk=$3
after_sz=$(wc -c < index.html | tr -d ' ')
# 🔴 ${} 的花括号不能省：全角「）」紧跟在变量名后面时，macOS 自带的 bash 3.2
#    会把它的字节当成变量名的一部分，报 unbound variable。install.sh 上栽过一次（560999e）。
echo "  kb.js        $b_doc 份/$b_chk 块（${b_gen}） →  $a_doc 份/$a_chk 块（${a_gen}）"
echo "  index.html   $(( before_sz/1024 )) KB → $(( after_sz/1024 )) KB"
echo "  待提交       $(git status --porcelain | wc -l | tr -d ' ') 个文件"
git status --porcelain | sed 's/^/    /'

if [ "$PUSH" = "1" ]; then
  echo; hr
  read -r -p "上面这些推到线上？(y/N) " yn
  case "$yn" in
    [yY]*) git add -A && git commit -m "重建：知识库与页面数据同步到最新源头" && git push \
             && echo "✅ 已推送，GitHub Pages 约一分钟后生效" || fail "提交或推送" ;;
    *) echo "没推。要推自己跑：git add -A && git commit && git push" ;;
  esac
else
  echo; echo "没提交。确认无误后：bash build.sh --push（或自己 git commit）"
fi
