#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从一张主图生成网页版和客户端的全部图标。

单一维护源：主图是仓库根目录的 icon-source.png。换图标就换那一张再跑本脚本，
别手动导一堆尺寸 —— 两头的处理规则不一样，手动做一定会漏。

🔴 两头要的东西不一样，别混：
  · 客户端 Dock 图标 —— 必须按 macOS 网格留白：1024 画布里图稿只占 824（80.5%）。
    满幅的图在 Dock 里会比别的应用大一圈（实测苹果自家 81.2%、Figma 80.1%）。
  · 浏览器标签 favicon —— 反过来要满幅。16px 那么小，再留白就看不清了。
  · iOS 加到主屏 —— 必须整块不透明。留透明角会被合成到黑底上，露出四个黑角；
    系统自己会套圆角，所以角落填什么最后都会被切掉。
  · Android maskable —— 系统会再切一刀，图稿必须收进中央 80% 安全区，
    不能跟 any 那档共用一张（共用会被切秃）。

用法：python3 build/gen-icons.py
"""
import os, sys, shutil, subprocess
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC  = os.path.join(ROOT, 'icon-source.png')
DESK = os.path.join(ROOT, 'desktop', 'build')

MAC_TARGET = 0.805      # 苹果网格 824÷1024
MASTER     = 1024


def die(m):
    print('❌ ' + m); sys.exit(1)


def solid_bbox(im):
    """实心部分的范围。用 alpha>=250 而不是 getbbox()：
    getbbox 把图稿外面那圈很淡的光晕也算进去，会量出「占 100%」这种假数。"""
    a = np.asarray(im.convert('RGBA')).astype(int)
    m = a[:, :, 3] >= 250
    ys, xs = np.where(m)
    if not len(xs):
        die('主图里找不到实心像素')
    return xs.min(), ys.min(), xs.max(), ys.max()


def main():
    if not os.path.exists(SRC):
        die('找不到主图：' + SRC)
    im = Image.open(SRC).convert('RGBA')
    W = im.size[0]
    x0, y0, x1, y1 = solid_bbox(im)
    cur = (x1 - x0 + 1) / W
    print('  主图 %dx%d · 实心方块占 %.1f%%' % (im.size[0], im.size[1], 100 * cur))

    # ── 客户端：缩到 macOS 网格，四周留透明边 ──
    scale = (MAC_TARGET / cur) * (MASTER / W)
    nw = max(1, round(W * scale))
    small = im.resize((nw, nw), Image.LANCZOS)
    sx0, sy0, sx1, sy1 = solid_bbox(small)
    off = (round(MASTER / 2 - (sx0 + sx1) / 2), round(MASTER / 2 - (sy0 + sy1) / 2))
    mac = Image.new('RGBA', (MASTER, MASTER), (0, 0, 0, 0))
    mac.paste(small, off, small)
    mx0, my0, mx1, my1 = solid_bbox(mac)
    got = 100.0 * (mx1 - mx0 + 1) / MASTER
    if abs(got - MAC_TARGET * 100) > 1.0:
        die('客户端图标没落在网格上：%.1f%%，目标 %.1f%%' % (got, MAC_TARGET * 100))
    print('  客户端 · 实心方块 %.1f%%（目标 %.1f%%）' % (got, MAC_TARGET * 100))

    out = os.path.join(DESK, 'icon.iconset')
    shutil.rmtree(out, ignore_errors=True); os.makedirs(out)
    for s, x in [(16,1),(16,2),(32,1),(32,2),(128,1),(128,2),(256,1),(256,2),(512,1),(512,2)]:
        mac.resize((s*x, s*x), Image.LANCZOS).save(
            os.path.join(out, 'icon_%dx%d%s.png' % (s, s, '@2x' if x == 2 else '')))
    mac.save(os.path.join(DESK, 'icon.png'))
    r = subprocess.run(['iconutil', '-c', 'icns', out, '-o', os.path.join(DESK, 'icon.icns')])
    if r.returncode: die('iconutil 生成 icns 失败')
    print('  客户端 · iconset 10 档 + icon.png + icon.icns')

    # ── 网页版 ──
    # 填角用的深色：取方块下半部靠中间那块，那儿既不是外圈高光也不是文字。
    # 🔴 别去图稿最外一圈取色 —— 那是高光描边，拿它填角会把四角染亮（踩过两次）。
    a = np.asarray(im).astype(int)
    H = im.size[1]
    patch = a[int(H*0.80):int(H*0.88), int(W*0.42):int(W*0.58), :3]
    dark = tuple(np.median(patch.reshape(-1, 3), axis=0).astype(int))
    print('  网页版 · 填角深色 #%02X%02X%02X' % dark)

    im.resize((32, 32), Image.LANCZOS).save(os.path.join(ROOT, 'icon-32.png'))
    im.resize((192, 192), Image.LANCZOS).save(os.path.join(ROOT, 'icon-192.png'))
    im.resize((512, 512), Image.LANCZOS).save(os.path.join(ROOT, 'icon-512.png'))

    ios = Image.new('RGBA', (W, H), dark + (255,))
    ios.alpha_composite(im.crop((x0, y0, x1 + 1, y1 + 1)).resize((W, H), Image.LANCZOS))
    ios.convert('RGB').resize((180, 180), Image.LANCZOS).save(os.path.join(ROOT, 'icon-180.png'))

    mk = Image.new('RGBA', (512, 512), dark + (255,))
    inner = round(512 * 0.80)
    mk.alpha_composite(im.resize((inner, inner), Image.LANCZOS), ((512 - inner)//2,)*2)
    mk.convert('RGB').save(os.path.join(ROOT, 'icon-512-maskable.png'))
    print('  网页版 · 32 / 180(不透明) / 192 / 512 / 512-maskable')


if __name__ == '__main__':
    main()
