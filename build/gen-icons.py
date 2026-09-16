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
SRC  = os.path.join(ROOT, 'icon-source.png')            # 网页版用
# 客户端单独一张：吉吉 2026-09-16 定「只换客户端的」。
# 网页版那张外面带一圈光晕，按实心方块缩到 80.5% 之后光晕还铺在方块外面，
# 在 Dock 里看着像多了一块底色；客户端这张没有光晕，缩完更利落。
# 🔴 两张图别互换 —— 网页那张是 favicon 满幅用的，客户端这张是按网格留白用的。
SRC_DESK = os.path.join(ROOT, 'icon-source-desktop.png')
DESK = os.path.join(ROOT, 'desktop', 'build')

# 🔴 客户端图标要**按 macOS 网格留白**：1024 画布里图稿占 824（80.5%）。
# 2026-09-16 在 macOS 26.5.1 上用「全新 bundle id + 全新路径 + 全新 Dock 格子」
# 对照实测（同一张源图，只改这一个变量）：
#   留白 80.5% → Dock 里干净、跟邻居等大 ✅
#   铺满 100%  → 系统给它套一圈浅灰框、还把图标缩小 ❌
# 也就是说 macOS 26 仍按老规矩预期你留白；你铺满它就当超框，自己补一层底。
#
# 🔴🔴 中途我一度改成「铺满」，是被缓存骗的：Dock 的图标缓存按 bundle id 存，
# 极其顽固（清缓存目录 / 杀 iconservicesagent / 重登记 / 换路径 全都没用），
# 于是「改了没变化」被我误读成「这个方向不对」。
# **判据：验图标改动必须换一个全新 bundle id 去看，在原 app 上看到的是旧贴图。**
#
# 🔴 换完图标怎么让本机 Dock 真的更新（2026-09-16 实测出来的唯一有效顺序）：
#   ① 先把那一格从 Dock 摘掉（defaults 改 persistent-apps）→ killall Dock
#   ② **在摘掉的状态下**清 $(getconf DARWIN_USER_CACHE_DIR)com.apple.iconservices*
#      ＋ killall -9 iconservicesagent ＋ lsregister -f
#   ③ 用一个**新 GUID** 把那一格放回去 → killall Dock
#   带着那一格清缓存无效（试过七八轮）；只 killall Dock 无效；换路径无效（缓存按 bundle id）。
MAC_TARGET = 0.805
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
    for p in (SRC, SRC_DESK):
        if not os.path.exists(p):
            die('找不到主图：' + p)
    im = Image.open(SRC).convert('RGBA')          # 网页版
    imd = Image.open(SRC_DESK).convert('RGBA')    # 客户端
    W = im.size[0]
    x0, y0, x1, y1 = solid_bbox(im)
    cur = (x1 - x0 + 1) / W
    print('  网页版主图 %dx%d · 实心方块占 %.1f%%' % (im.size[0], im.size[1], 100 * cur))

    # ── 客户端：把实心方块裁出来，按网格缩到 80.5% 居中 ──
    dx0, dy0, dx1, dy1 = solid_bbox(imd)
    print('  客户端主图 %dx%d · 实心方块占 %.1f%%'
          % (imd.size[0], imd.size[1], 100.0 * (dx1 - dx0 + 1) / imd.size[0]))
    crop = imd.crop((dx0, dy0, dx1 + 1, dy1 + 1))
    inner = round(MASTER * MAC_TARGET)
    mac = Image.new('RGBA', (MASTER, MASTER), (0, 0, 0, 0))
    mac.alpha_composite(crop.resize((inner, inner), Image.LANCZOS), ((MASTER - inner) // 2,) * 2)
    mx0, my0, mx1, my1 = solid_bbox(mac)
    got = 100.0 * (mx1 - mx0 + 1) / MASTER
    if abs(got - MAC_TARGET * 100) > 1.0:
        die('客户端图标没落在网格上：%.1f%%，目标 %.1f%% —— 铺满会被系统套一圈浅灰框'
            % (got, MAC_TARGET * 100))
    print('  客户端 · 图稿占 %.1f%%（目标 %.1f%%·铺满会被系统套框）' % (got, MAC_TARGET * 100))

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
