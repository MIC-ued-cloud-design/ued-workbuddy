#!/usr/bin/env python3
"""从 docs/飞鹊Web组件库.css（600KB，含图标 data-URI）抽一份「网页速用」核心：
按钮 / 输入框基础 / 提示条 / 标签 / 徽标 / 投影 / 骨架屏，去掉 data-URI 与图标变量，
体量控制在十几 KB，让模型一条 cat 就能整段内联进单文件。权威仍是完整版，本文件是它的子集，重跑即同步。"""
import re, os, sys
here = os.path.dirname(os.path.abspath(__file__))
src = os.path.join(here, '..', 'packs', 'feique', 'docs', '飞鹊Web组件库.css')
dst = os.path.join(here, '..', 'packs', 'feique', 'docs', '飞鹊组件-网页速用.css')
css = re.sub(r'/\*.*?\*/', '', open(src, encoding='utf-8').read(), flags=re.S)
rules = re.findall(r'([^{}]+)\{([^{}]*)\}', css)
KEEP = re.compile(r'^\.(btn|alert|tag|bdg|shadow|skel)(?![a-zA-Z0-9])|^\.inp(?:-(?:body|lg|sm|disabled|error|warning|success|reminder|caption|tab|row|icon))?(?![a-zA-Z0-9-])')
out = []
for sel, body in rules:
    s = ' '.join(sel.split())
    if not all(KEEP.match(x.strip()) for x in s.split(',')): continue
    decls = [d.strip() for d in body.split(';') if d.strip() and 'data:' not in d and '--ico' not in d]
    if not decls: continue
    out.append(s + '{' + ';'.join(' '.join(d.split()) for d in decls) + '}')
head = ('/* 飞鹊组件 · 网页速用核心（由 build/gen-feique-core-css.py 从 飞鹊Web组件库.css 抽出，%d 条规则）\n'
        '   用法：整段内联进单文件的 <style> 里，然后按钮 / 输入框 / 提示条 / 标签只用这些类名，别再自己写一套。\n'
        '   按钮：.btn + 尺寸 .btn-lg/.btn-md/.btn-sm + 变体 .btn-primary/.btn-secondary/.btn-secondary-blue/.btn-secondary-dark/.btn-text/.btn-link（全页只一个 .btn-primary）\n'
        '   输入框：.inp > .inp-body > input（无边框）；状态 .inp-error/.inp-warning/.inp-success/.inp-disabled\n'
        '   提示条：.alert.alert-sm.alert-error/-info/-success/-warning > .alert-icon + .alert-body > .alert-msg + .alert-link（没有按钮槽位）\n'
        '   标签：.tag.tag-line-red 等；投影 .shadow-1/2/3；骨架 .skel */\n') % len(out)
open(dst, 'w', encoding='utf-8').write(head + '\n'.join(out) + '\n')
print('wrote', dst, len(out), 'rules', os.path.getsize(dst), 'bytes')
