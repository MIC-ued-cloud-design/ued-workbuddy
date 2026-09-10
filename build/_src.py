#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""业务知识正文从哪里读 —— gen-kb.py 和 gen-data.py 共用这一份。

为什么要有这一层：这两个脚本原来直接读 ~/.claude/projects/*/memory，
那是吉吉这台电脑上的私人目录，不在任何仓库里。只要输入还在私人目录，
构建就只有一台机器跑得出来，「源头更新一次页面自动更新」永远做不到。

同一批业务知识其实早就有仓库副本了：ued-skill 仓的 biz-knowledge/payload/，
由 skill 的 build-dist-payload.sh 从 memory 抽出来，跟着 git 走。
优先读它，构建就跟「在谁的电脑上」无关了。

优先级：
  ① 环境变量 UW_KB_SRC —— CI 上显式指定，说了算
  ② ued-skill 仓的 biz-knowledge/payload —— 跟着 git 走，换机器结果一样
  ③ 本机 auto-memory —— 兜底，只有吉吉这台有

🔴 ② 优先于 ③ 是有意的：仓库里没有的东西本来就不该进发布产物，
   否则同事 pull 不到、CI 也构建不出同一份。memory 比 payload 新时不是静默用新的，
   是让 build.sh 的源头体检报出来，提示先跑 sync-to-repo.sh。
"""
import os, glob

PATS = ['mic-biz-*.md', 'reference-mic-*.md', '_index-mic-*.md']


def _memory_dirs():
    return sorted(glob.glob(os.path.expanduser('~/.claude/projects/*/memory')))


def _payload_dir():
    """skill 是软链，realpath 之后才是 SkillManager 里那份 clone。"""
    sk = os.path.realpath(os.path.expanduser('~/.claude/skills/mic-fullstack'))
    p = os.path.join(sk, 'biz-knowledge', 'payload')
    return p if os.path.isdir(p) else None


def biz_dirs():
    """返回 (目录列表, 这次用的是哪一档)。列表形态是为了兼容原来 for base in MEM 的写法。"""
    env = os.environ.get('UW_KB_SRC')
    if env:
        ds = [d for d in env.split(':') if os.path.isdir(d)]
        if ds:
            return ds, 'UW_KB_SRC'
    p = _payload_dir()
    if p and glob.glob(os.path.join(p, 'mic-biz-*.md')):
        return [p], 'skill 仓 biz-knowledge/payload'
    ds = _memory_dirs()
    return ds, '本机 auto-memory（只有这台电脑有·CI 上会构建不出）'


def biz_files(dirs):
    """按三类模式取文件，同名只取第一次出现的（沿用原脚本的去重规则）。"""
    seen, out = set(), []
    for base in dirs:
        for pat in PATS:
            for f in sorted(glob.glob(os.path.join(base, pat))):
                n = os.path.basename(f)[:-3]
                if n in seen:
                    continue
                seen.add(n)
                out.append(f)
    return out
