#!/usr/bin/env python3
"""生成 packs/feique/brand/INDEX.md —— 品牌与认证标识清单。

为什么要有（2026-09-15 实测）：客户端做产品卡时，把 STS 担保交易标画成了
「绿色 Secured + 深绿 Trading」两段文字，Audited 画成「蓝色 A + udited」，
LeadingFactory 画成蓝框里塞文字。清册里其实写得很清楚：这些是飞鹊 brand logo
组件的 variant，**内部没有文字节点，字是矢量图形画出来的**；但 SVG 文件不在包里，
它只能画。现在 17 个 variant 都导出来了，这份索引告诉模型哪个是哪个。
"""
import os, re, json

HERE = os.path.dirname(os.path.abspath(__file__))
P = os.path.join(HERE, '..', 'packs', 'feique')
B = os.path.join(P, 'brand')

WHAT = {
 'mic-logo':                 ('MIC 站点 LOGO', '页头、页脚、邮件抬头。品牌红 #DA291C —— 跟界面主色 #E64545 不是一个红'),
 'sts-icon':                 ('STS 担保交易 · 纯盾牌', '空间窄时只放盾'),
 'sts-with-text':            ('STS · 盾 +「Secured Trading」', '🔴 产品卡/列表页最常用的就是这个'),
 'sts-wordmark':             ('STS · 纯字标', '已有盾时不重复放盾'),
 'sts-with-desc':            ('STS · 盾 + 字标 + 说明', '详情页展开说明时'),
 'sts-wordmark-box':         ('STS · 字标带底框', '深色底或需要更强存在感时'),
 'audited-icon':             ('Audited 认证 · 纯图标', '供应商名旁的小标'),
 'audited-with-text':        ('Audited · 图标 + 字标', '供应商信息行'),
 'audited-wordmark':         ('Audited · 纯字标', '🔴 就是这个，别用蓝色 A 加文字拼'),
 'leading-factory-wordmark': ('Leading Factory 标杆工厂 · 字标',
                              '🔴 这个 brand **只有 wordmark 一种形态，没有 icon**'),
 'diamond-icon':             ('钻石会员 · 图标', '会员等级'),
 'diamond-with-text':        ('钻石会员 · 图标 + 字标', '会员等级带文字'),
 'gold-icon':                ('金牌会员 · 图标', '会员等级'),
 'gold-with-text':           ('金牌会员 · 图标 + 字标', '会员等级带文字'),
 'certificate-group':        ('资质证书组', '含 3 张内嵌位图（已 base64 内嵌，离线可用）'),
 'supplier-star-icon':       ('供应商星级 · 单星', ''),
 'supplier-star-stars':      ('供应商星级 · 五星', '供应商评级行'),
 'rating-score':             ('评分条', '带分值的评分展示'),
}

def main():
    cat = json.load(open(os.path.join(P, 'web-components.json'), encoding='utf-8'))
    bl = cat['components']['brand logo']
    files = sorted(f for f in os.listdir(B) if f.endswith('.svg'))
    rows = []
    for f in files:
        s = open(os.path.join(B, f), encoding='utf-8').read()
        m = re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', s)
        wh = '%gx%g' % (float(m.group(1)), float(m.group(2))) if m else '?'
        key = f[:-4]
        if key not in WHAT:
            raise SystemExit('FATAL: brand/%s 没写说明，补进 WHAT 再跑' % f)
        what, when = WHAT[key]
        rows.append((f, wh, what, when))

    L = []
    L.append('# 飞鹊品牌与认证标识（%d 个）\n' % len(rows))
    L.append('🔴🔴 **一律内联真 SVG，一个都不许自己画、不许用文字拼。**')
    L.append('这些标里的字**是矢量图形，不是文字节点** —— 拿两段彩色文字拼出来的「Secured Trading」')
    L.append('看着像、其实一眼假，而且它足够像，以至于没人会再去核对。2026-09-15 实测栽过一次。\n')
    L.append('用法：`cat brand/<名>.svg` 拿到原文整段内联，按比例缩放，**不要改颜色**。\n')
    L.append('| 文件 | 尺寸 | 是什么 | 什么时候用 |')
    L.append('|---|---|---|---|')
    for f, wh, what, when in rows:
        L.append('| `%s` | %s | %s | %s |' % (f, wh, what, when))
    L.append('\n## 来源\n')
    L.append('全部取自飞鹊 `brand logo` 组件（key `%s` · node `%s` · page「%s」· %d 个 variant），'
             % (bl['key'], bl['nodeId'], bl['page'], bl['variantCount']))
    L.append('用 figma `download_assets` 逐个导出，并跑 `build/clean-figma-svg.py` 清掉画布杂质')
    L.append('（Figma 组件集的紫色虚线框、画布底色）。尺寸与清册 `existingVariants` 逐个核对过。\n')
    L.append('🔴 **形态是稀疏的**：8 个 brand × 8 个 form 只做了 %d 个组合。' % bl['variantCount'])
    L.append('别拿一个 brand 的经验套另一个 —— 最典型的是 `leading-factory` **只有 wordmark、没有 icon**。\n')
    L.append('🔴 **`icons/mic.svg` 不是 LOGO**：那是 16px 单色 M 字标；要 MIC LOGO 用 `mic-logo.svg`。\n')
    L.append('由 `build/gen-brand-index.py` 生成。')
    open(os.path.join(B, 'INDEX.md'), 'w', encoding='utf-8').write('\n'.join(L) + '\n')
    print('写出 brand/INDEX.md（%d 个标识）' % len(rows))

main()
