#!/usr/bin/env python3
"""清掉 Figma 导出 SVG 里的画布杂质。

download_assets 的 export 会把画布上的东西一起带出来：
  · 组件集的紫色虚线框 stroke="#9747FF"（Figma 编辑器 UI，绝不属于图形本身）
  · 画布背景 rect（尺寸远大于 viewBox，或带负坐标，铺在图形下面）
  · 跟 viewBox 等大的纯色底（页面底色，不是标本身的底）
不清掉就会在页面上多出一块灰底和一个紫框 —— 2026-09-15 导 STS 标时实测。

🔴 保留判据：只删「能证明是画布」的，拿不准的一律留着，宁可多一个 rect 也不能削掉图形的一部分。
"""
import re, sys

FIGMA_UI_STROKE = '#9747FF'     # Figma 组件集边框的固定紫色

def clean(svg):
    m = re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', svg)
    vw, vh = (float(m.group(1)), float(m.group(2))) if m else (None, None)
    removed = []

    def drop(tag):
        # ① 组件集紫色虚线框
        if FIGMA_UI_STROKE.lower() in tag.lower():
            return 'figma组件框'
        a = dict(re.findall(r'(\w[\w-]*)="([^"]*)"', tag))
        try:
            x, y = float(a.get('x', 0)), float(a.get('y', 0))
            w, h = float(a.get('width', 0)), float(a.get('height', 0))
        except ValueError:
            return None
        # ② 画布背景：负坐标起手，或比 viewBox 大一圈
        if vw and (x < 0 or y < 0) and w > vw and h > vh:
            return '画布背景(负坐标且超出)'
        if vw and (w > vw * 1.5 and h > vh * 1.5):
            return '画布背景(远大于viewBox)'
        # ③ 跟 viewBox 等大的纯色底（页面底色）
        if vw and abs(w - vw) < 0.5 and abs(h - vh) < 0.5 and x == 0 and y == 0 \
           and a.get('fill') and 'none' not in a.get('fill', ''):
            return '整幅底色 %s' % a.get('fill')
        return None

    out = []
    for tag in re.split(r'(<rect[^>]*/>)', svg):
        if tag.startswith('<rect'):
            why = drop(tag)
            if why:
                removed.append((why, tag[:70]))
                continue
        out.append(tag)
    s = ''.join(out)
    # 清掉因此变空的 <g>（最多绕三轮，嵌套也就这么深）
    for _ in range(3):
        s = re.sub(r'<g[^>]*>\s*</g>', '', s)
    return s, removed

if __name__ == '__main__':
    for p in sys.argv[1:]:
        s = open(p, encoding='utf-8').read()
        new, rm = clean(s)
        open(p, 'w', encoding='utf-8').write(new)
        print('%-26s %6d → %5d bytes' % (p.split('/')[-1], len(s), len(new)))
        for why, frag in rm:
            print('    删 %-22s %s' % (why, frag))
