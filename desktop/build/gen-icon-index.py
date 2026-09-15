#!/usr/bin/env python3
"""给 295 个飞鹊图标生成检索索引 packs/feique/icons/INDEX.md。

为什么要有（2026-09-15 实测）：客户端做产品卡时要放「Chat Now」的图标，
它 grep 'chat' 只命中 wechat.svg（微信），grep message/inquiry/contact 全空 ——
真正的聊天图标叫 tm.svg（TM = Trade Manager，MIC 内部缩写）。于是它画了个圆圈勾。
295 个图标一直没有任何一份「这图标是干什么用的」索引，只能靠文件名猜。

索引里必须写进**常见检索词**，这样 grep 'chat' 能命中 tm.svg 那一行。
分类来自 icon-variants.txt（288/295 能对上），业务语义和检索词是人写的。
"""
import os, re, json

HERE = os.path.dirname(os.path.abspath(__file__))
P = os.path.join(HERE, '..', 'packs', 'feique')
ICONS = os.path.join(P, 'icons')

# 高频业务图标：{文件名: (是什么, 搜这些词该命中它)}
BIZ = {
 'tm':        ('TM（Trade Manager）MIC 买卖家即时沟通工具',
               'chat, chat now, message, im, contact supplier, 聊天, 沟通, 联系供应商'),
 'talk':      ('对话气泡（线框）', 'comment, message, 留言, 咨询, 评论'),
 'talk-f':    ('对话气泡（实心）', 'comment filled, 留言实心'),
 'mail':      ('邮件', 'email, mail, inquiry, 邮件, 站内信, 询盘'),
 'maill-send':('发送邮件 🔴 文件名是双 l 的 maill', 'send email, 发送邮件, 发送询盘'),
 'negotiate': ('议价 / 谈判', 'negotiate, bargain, 议价, 还价'),
 'attachment':('附件', 'attachment, file, 附件, 上传文件'),
 'quick-reply':('快捷回复', 'quick reply, 快捷回复, 模板回复'),
 'safeguard': ('担保 / 保障', 'guarantee, secured, protection, 担保交易, 保障'),
 'ind-STS':   ('STS 行业图标 🔴 这是行业分类图标，不是 STS 品牌标',
               'STS icon；要品牌标去 brand/sts-*.svg，别拿这个'),
 'refund':    ('退款', 'refund, return money, 退款'),
 'truck':     ('物流 / 发货', 'shipping, logistics, delivery, 物流, 发货'),
 'cart':      ('购物车', 'cart, 购物车'),
 'cart-add':  ('加入购物车', 'add to cart, 加购'),
 'cart-success':('加购成功', 'cart success, 加购成功'),
 'product':   ('商品', 'product, item, 商品, 产品'),
 'purchase':  ('采购', 'purchase, procurement, 采购'),
 'buyer-sourcing':('买家采购', 'buyer, sourcing, 买家, 寻源'),
 'verification-supplier':('供应商认证', 'verified supplier, 认证供应商'),
 'medal':     ('奖章 / 资质', 'medal, badge, award, 奖章, 资质'),
 'star':      ('星（线框）', 'star outline, 空心星, 评分'),
 'star-f':    ('星（实心）', 'star filled, 实心星, 评分'),
 'yes':       ('勾 · 圆圈+勾', 'check circle, 圆圈勾'),
 'yes-f':     ('勾 · 实心圆挖勾', 'check filled, 实心勾'),
 'yes2':      ('勾 · 纯勾 🔴 checkbox 用这个', 'checkmark, tick, 纯勾, 复选框的勾'),
 'search':    ('搜索', 'search, 搜索'),
 'filter':    ('筛选', 'filter, 筛选'),
 'mic':       ('MIC 字标图标 🔴 16px 单色 M 字标，**不是 LOGO**',
               '要 MIC LOGO 用 brand/mic-logo.svg（240×46 彩色），别拿这个当 LOGO'),
}

# 文件名拼错了的：搜正确拼写一个都找不到，必须点名
TYPO = {
 'maill-send': 'mail-send（文件名多了一个 l）',
 'ind-apprel': 'apparel 服装（少一个 a）',
 'ind-industrail-equipment': 'industrial（rai 写成了 rail）',
 'ind-agriculture-hardwar': 'hardware（少了结尾的 e）',
 'ind-lightIndusty': 'light-industry（少 r，且是唯一的驼峰命名）',
 'instagrame': 'instagram（多了结尾的 e）',
 'instagrame2': 'instagram（多了结尾的 e）',
}

CAT_NOTE = {
 '功能图标': '通用 UI 动作（搜索/筛选/收藏/设置…）',
 '符号&箭头': '箭头、状态符号、勾叉、排序',
 '行业图标': 'MIC 的 33 个行业分类，`ind-` 前缀',
 '媒体': '图片、视频、音频、缩放',
 '富文本': '编辑器工具条',
 '询价询盘': 'inquiry / RFQ 询盘·沟通·附件·文件类型 —— **做 inquiry 相关页面先翻这一类**',
 '交易': '购物车、订单、支付、物流、退款',
 '社媒（方）': '社交平台方形标',
 '社媒（圆）': '社交平台圆形标',
 '账户': '用户、身份、通讯录',
 '评价': '评分、表情、问卷',
 '品牌图形&标准功能图标': '平台标识类（android/apple/mic/tm/mei）',
 '(未分类)': 'icon-variants.txt 里对不上的，多半是旧图或临时图',
}

def main():
    vs = [l.strip() for l in open(os.path.join(P, 'icon-variants.txt'), encoding='utf-8')
          if l.strip() and not l.startswith('#')]
    cat = {}
    for v in vs:
        if '-' in v:
            c, n = v.split('-', 1)
            cat[n] = c
    files = sorted(f[:-4] for f in os.listdir(ICONS) if f.endswith('.svg'))
    groups = {}
    for f in files:
        groups.setdefault(cat.get(f, '(未分类)'), []).append(f)

    L = []
    L.append('# 飞鹊 UI 图标 · 检索索引（%d 个）\n' % len(files))
    L.append('🔴 **按用途找，别靠文件名猜** —— 文件名多是 MIC 内部缩写。')
    L.append('最典型的：要「Chat Now」的图标时 `grep chat` 只会命中 `wechat`（微信），')
    L.append('真正的聊天图标叫 **`tm.svg`**（TM = Trade Manager）。2026-09-15 就这么画错过一次。\n')
    L.append('用法：`cat icons/<名>.svg` 拿到 SVG 原文，整段内联进页面（别用 <img>，要能跟着文字改色）。\n')
    L.append('## 高频业务图标（做 MIC 页面先看这张表）\n')
    L.append('| 文件 | 是什么 | 搜这些词都该找到它 |')
    L.append('|---|---|---|')
    for k in sorted(BIZ):
        if k not in files:
            raise SystemExit('FATAL: BIZ 里写了 %s.svg，但 icons/ 里没有这个文件' % k)
        what, kw = BIZ[k]
        L.append('| `%s.svg` | %s | %s |' % (k, what, kw))
    L.append('\n## 🔴 文件名拼错的（搜正确拼写一个都搜不到）\n')
    L.append('| 实际文件名 | 本该是 |')
    L.append('|---|---|')
    for k in sorted(TYPO):
        if k not in files:
            raise SystemExit('FATAL: TYPO 里写了 %s.svg，但 icons/ 里没有' % k)
        L.append('| `%s.svg` | %s |' % (k, TYPO[k]))
    L.append('\n## 全部 %d 个（按飞鹊分类）\n' % len(files))
    for c in sorted(groups, key=lambda k: -len(groups[k])):
        L.append('### %s（%d）' % (c, len(groups[c])))
        note = CAT_NOTE.get(c)
        if note:
            L.append('%s\n' % note)
        L.append('```\n%s\n```\n' % ' '.join(groups[c]))
    L.append('---\n')
    L.append('🔴 **品牌标识不在这里**：MIC LOGO、STS 担保交易、Audited 认证、Leading Factory、')
    L.append('会员等级（Diamond/Gold）、供应商星级 —— 全在 `brand/` 目录，是**整体矢量**，')
    L.append('字是画出来的不是文字节点，**一律内联真 SVG，不许用文字拼**。清单见 `brand/INDEX.md`。\n')
    L.append('由 `build/gen-icon-index.py` 生成（分类取自 icon-variants.txt，业务语义与检索词是人写的）。')

    out = os.path.join(ICONS, 'INDEX.md')
    open(out, 'w', encoding='utf-8').write('\n'.join(L) + '\n')
    print('写出 %s（%d 个图标 / %d 条业务语义 / %d 条拼写陷阱）'
          % (out.split('feique/')[-1], len(files), len(BIZ), len(TYPO)))

main()
