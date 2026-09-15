#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把知识库的原文导进应用包，让 Claude 能直接 Read。

为什么要这一步：`packs/kb/kb.js` 是给网页版检索用的分块 JS，Claude 读不了整份文档。
而终端里之所以「懂飞鹊」，靠的就是能直接读到那批 md。同事机器上没有那批 md，
所以必须随应用带一份——取料跟 gen-kb.py 完全同源（build/_src.py 圈定的可分发子集），
不含吉吉的私人项目笔记。

用法：python3 build/gen-pack-docs.py
"""
import os, sys, glob, shutil, re

HERE = os.path.dirname(os.path.abspath(__file__))
WB   = os.path.dirname(os.path.dirname(HERE))          # ~/Desktop/UED workbuddy
sys.path.insert(0, os.path.join(WB, 'build'))
import _src                                            # 跟 gen-kb.py 同一个取料源

SK  = os.path.expanduser('~/.claude/skills/mic-fullstack')
# 🔴 别放进 packs/：那整个目录走 asarUnpack，通用包合并 asar 时会把所有不打包的
# 文件名拼成一个巨型匹配串，多几百份就报 "pattern is too long"。放外面走 extraResources。
OUT = os.path.join(os.path.dirname(HERE), 'kbdocs')

def head(p, n=180):
    """取正文第一句当一行摘要，给索引用"""
    try:
        t = open(p, encoding='utf-8').read()
    except Exception:
        return ''
    t = re.sub(r'^---.*?---', '', t, flags=re.S)            # 去 frontmatter
    for line in t.split('\n'):
        line = line.strip().lstrip('#').strip()
        if len(line) > 12 and not line.startswith(('```', '|', '>', '<!--')):
            return re.sub(r'\s+', ' ', line)[:n]
    return ''

def main():
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    groups = [
        ('业务知识', os.path.join(OUT, 'biz'),    _src.biz_files(_src.biz_dirs()[0])),
        ('方法论与判据', os.path.join(OUT, 'method'), [f for f in sorted(glob.glob(os.path.join(SK, 'memory-refs/*.md')))
                                                    if not os.path.basename(f).startswith('_')]),
        ('专项做法（子 skill）', os.path.join(OUT, 'skill'), sorted(glob.glob(os.path.join(SK, 'sub-skills/*/SKILL.md')))),
    ]
    index, total, bytes_ = [], 0, 0
    for label, d, files in groups:
        os.makedirs(d, exist_ok=True)
        index.append(f'\n## {label}（{len(files)} 份）\n')
        for f in files:
            name = os.path.basename(f)
            if name == 'SKILL.md':                           # 子 skill 用它所在目录名
                name = os.path.basename(os.path.dirname(f)) + '.md'
            dst = os.path.join(d, name)
            shutil.copyfile(f, dst)
            rel = os.path.relpath(dst, OUT)
            index.append(f'- [{name[:-3]}]({rel}) —— {head(f)}')
            total += 1; bytes_ += os.path.getsize(dst)
    idx = ['# 知识库索引', '',
           '这是一份**索引**，一行一个指针。按需要挑几份读，别整个目录通读、也别 grep 满硬盘。',
           '', f'共 {total} 份 · {bytes_/1048576:.1f} MB · 随应用分发，跟你终端里那套同源。', ''] + index
    open(os.path.join(OUT, 'INDEX.md'), 'w', encoding='utf-8').write('\n'.join(idx) + '\n')
    print(f'导出 {total} 份 · {bytes_/1048576:.1f} MB → {OUT}')

if __name__ == '__main__':
    main()
