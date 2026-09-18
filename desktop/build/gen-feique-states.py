#!/usr/bin/env python3
"""把飞鹊「写在 class 上」的状态真值，接到浏览器真实的 :hover / :checked 上。

为什么要这一层：飞鹊的组件 CSS 是从 Figma 的 variant 导出来的，所以状态长这样——
    .cb-hv .cb-box{border-color:#555;}      ← 悬停态
    .cb-sel .cb-box{background:#222;}       ← 勾选态
值是真的、也是全的，但它要靠人手动加 class 才出现：鼠标放上去不会变，点一下也不会勾上。
吉吉 2026-09-17：「我希望内容区里的元素自带交互，悬停 hover 等各种状态」。

这里**一个数都不新造**，只把上面那些规则的选择器换个挂法：
    .cb-hv  .cb-box  →  .cb:not(.cb-dis):hover .cb-box
    .cb-sel .cb-box  →  .cb:has(input:checked) .cb-box
声明块整段照搬，改完还会逐条断言「搬过来的值跟源文件一字不差」。

🔴 三条边界：
  ① 权威源 docs/飞鹊Web组件库.css 和它的切片一个字不动，本脚本只**另外生成** <族>.states.css。
     飞鹊哪天重新导出，重跑本脚本即可；改坏了也只坏在这一层。
  ② 只做「飞鹊自己已经给了值」的族。tab 的 hover 在 Figma 的 tab item 里是有的
     （state=hover → 文字 #555），但它跟导出 CSS 的默认态撞了（.tab-item 本来就是 #555），
     两个源打架，不猜，留给人定。tag 在 Figma 里的 state 是 closeable/add new，**根本没有 hover 态**，
     所以不给它编一个。
  ③ 不给任何元素起新类名 —— 体检有条 fake-class 硬伤规则，凡是 cb-/rd-/sw- 开头又不在飞鹊里的类
     都会被判硬伤。所以隐藏的原生控件一律按 `.cb > input` 这种结构选，不挂 class。
"""
import re, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
CSS = os.path.join(HERE, '..', 'packs', 'feique', 'docs', 'css')

# 映射表（judgment：哪个状态类等于哪个真实状态）。值从源文件整段搬，这里只定义怎么挂。
#   base   = 这一族的根类
#   rules  = [(状态类, 接到什么, 一句话说明)]
#   native = 需要塞一个原生控件才点得动的（checkbox / radio），None 表示不用
MAP = [
    dict(file='cb', base='cb', native='checkbox', rules=[
        ('cb-hv', ':not(.cb-dis):hover', '鼠标悬停'),
        ('cb-sel', ':has(> input:checked)', '勾上了'),
        ('cb-half', ':has(> input:indeterminate)', '半选'),
    ]),
    dict(file='rd', base='rd', native='radio', rules=[
        ('rd-hv', ':not(.rd-dis):hover', '鼠标悬停'),
        ('rd-sel', ':has(> input:checked)', '选中'),
    ]),
    dict(file='ss', base='ss', native='radio', rules=[
        ('ss-hv', ':not(.ss-dis):hover', '鼠标悬停'),
        ('ss-sel', ':has(> input:checked)', '选中'),
    ]),
    dict(file='sw', base='sw', native='checkbox', rules=[
        ('sw-on', ':has(> input:checked)', '打开'),
    ]),
    dict(file='ta', base='ta', native=None, rules=[
        ('ta-hover', ':hover', '鼠标悬停'),
    ]),
    dict(file='inpn', base='inp-num', native=None, rules=[
        ('inp-num-hv', ':not(.inp-num-dis):hover', '鼠标悬停'),
    ]),
]


def rules_of(css, state_cls):
    """把源文件里所有「选择器里含这个状态类」的规则整条取出来（选择器, 声明块）。

    两个坑：① 注释要先剥掉，不然 /* Hover */ 会被当成选择器的一部分跟着搬过来；
    ② 一条规则的选择器列表里常常混着别的状态（.cb-dis.cb-sel X, .cb-dis.cb-half X），
       只留含本状态的那几个，剩下的归它自己那一组，不然会吐出没换干净的选择器。"""
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
    out = []
    for m in re.finditer(r'([^{}]+)\{([^{}]*)\}', css):
        sel, decl = m.group(1).strip(), m.group(2).strip()
        if sel.startswith('@') or not decl:
            continue
        mine = [s.strip() for s in sel.split(',') if re.search(r'\.' + re.escape(state_cls) + r'(?![\w-])', s)]
        if mine:
            out.append((', '.join(mine), decl))
    return out


def remap(sel, state_cls, base, pseudo):
    """把选择器里的状态类换成真实状态。状态类所在的那一节被换空了就补上根类。"""
    parts = re.split(r'(\s*[>+~]\s*|\s+)', sel)          # 保留组合符
    for i, p in enumerate(parts):
        if not re.search(r'\.' + re.escape(state_cls) + r'(?![\w-])', p):
            continue
        left = re.sub(r'\.' + re.escape(state_cls) + r'(?![\w-])', '', p, count=1)
        pe = ''.join(re.findall(r'::[a-z-]+', left))      # 伪元素要留在最末尾
        left = re.sub(r'::[a-z-]+', '', left)
        if left.strip() == '':                            # 整节只剩状态类 → 用根类兜底
            left = '.' + base
        parts[i] = left + pseudo + pe
    return ''.join(parts)


def main():
    made, checked = [], 0
    for fam in MAP:
        path = os.path.join(CSS, fam['file'] + '.css')
        css = open(path, encoding='utf-8').read()
        lines = [f"/* ===== {fam['file']}.css 的状态接线（build/gen-feique-states.py 生成，别手改） =====",
                 "   值全部原样搬自飞鹊，只是把「加 class 才出现」改成「鼠标/勾选自动出现」 */"]
        if fam['native']:
            lines.append(f"/* 点得动：{fam['base']} 里塞一个原生 {fam['native']}，藏起来但仍然接管键盘与点击 */")
            lines.append(f".{fam['base']} > input[type={fam['native']}]{{position:absolute;opacity:0;width:0;height:0;margin:0;pointer-events:none;}}")
        for state_cls, pseudo, note in fam['rules']:
            got = rules_of(css, state_cls)
            if not got:
                print(f"❌ {fam['file']}.css 里找不到 .{state_cls} 的规则——飞鹊可能改过导出，映射表要跟着改")
                return 1
            lines.append(f"/* {note}（原来写作 .{state_cls}） */")
            for sel, decl in got:
                new = ', '.join(remap(x.strip(), state_cls, fam['base'], pseudo) for x in sel.split(','))
                assert state_cls not in new, f'{sel} 没换干净：{new}'
                lines.append(f"{new}{{{decl}}}")
                checked += 1
        out = os.path.join(CSS, fam['file'] + '.states.css')
        open(out, 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
        made.append(os.path.basename(out))

    # 断言：搬过来的每一条声明，必须在源文件里一字不差地存在过
    for fam in MAP:
        src = open(os.path.join(CSS, fam['file'] + '.css'), encoding='utf-8').read()
        gen = open(os.path.join(CSS, fam['file'] + '.states.css'), encoding='utf-8').read()
        for m in re.finditer(r'\{([^{}]*)\}', gen):
            d = m.group(1).strip()
            if not d or 'opacity:0;width:0' in d:      # 藏原生控件那条是机制不是设计值
                continue
            if d not in src.replace(' ', '') and d not in src:
                print(f"❌ {fam['file']}.states.css 里的 {{{d}}} 在源文件里找不到——值被改动过了")
                return 1
    print(f"✅ 生成 {len(made)} 份状态接线：{' '.join(made)}（共 {checked} 条规则，值与源文件逐条对过）")
    return 0


if __name__ == '__main__':
    sys.exit(main())
