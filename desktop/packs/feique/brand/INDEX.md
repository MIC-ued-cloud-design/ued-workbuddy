# 飞鹊品牌与认证标识（18 个）

🔴🔴 **一律内联真 SVG，一个都不许自己画、不许用文字拼。**
这些标里的字**是矢量图形，不是文字节点** —— 拿两段彩色文字拼出来的「Secured Trading」
看着像、其实一眼假，而且它足够像，以至于没人会再去核对。2026-09-15 实测栽过一次。

用法：`cat brand/<名>.svg` 拿到原文整段内联，按比例缩放，**不要改颜色**。

| 文件 | 尺寸 | 是什么 | 什么时候用 |
|---|---|---|---|
| `audited-icon.svg` | 16x16 | Audited 认证 · 纯图标 | 供应商名旁的小标 |
| `audited-with-text.svg` | 105x16 | Audited · 图标 + 字标 | 供应商信息行 |
| `audited-wordmark.svg` | 46x16 | Audited · 纯字标 | 🔴 就是这个，别用蓝色 A 加文字拼 |
| `certificate-group.svg` | 182x22 | 资质证书组 | 含 3 张内嵌位图（已 base64 内嵌，离线可用） |
| `diamond-icon.svg` | 16x16 | 钻石会员 · 图标 | 会员等级 |
| `diamond-with-text.svg` | 114x16 | 钻石会员 · 图标 + 字标 | 会员等级带文字 |
| `gold-icon.svg` | 16x16 | 金牌会员 · 图标 | 会员等级 |
| `gold-with-text.svg` | 91x16 | 金牌会员 · 图标 + 字标 | 会员等级带文字 |
| `leading-factory-wordmark.svg` | 70x16 | Leading Factory 标杆工厂 · 字标 | 🔴 这个 brand **只有 wordmark 一种形态，没有 icon** |
| `mic-logo.svg` | 240x46 | MIC 站点 LOGO | 页头、页脚、邮件抬头。品牌红 #DA291C —— 跟界面主色 #E64545 不是一个红 |
| `rating-score.svg` | 92x13 | 评分条 | 带分值的评分展示 |
| `sts-icon.svg` | 16x16 | STS 担保交易 · 纯盾牌 | 空间窄时只放盾 |
| `sts-with-desc.svg` | 148x16 | STS · 盾 + 字标 + 说明 | 详情页展开说明时 |
| `sts-with-text.svg` | 87x16 | STS · 盾 +「Secured Trading」 | 🔴 产品卡/列表页最常用的就是这个 |
| `sts-wordmark-box.svg` | 113x22 | STS · 字标带底框 | 深色底或需要更强存在感时 |
| `sts-wordmark.svg` | 94x16 | STS · 纯字标 | 已有盾时不重复放盾 |
| `supplier-star-icon.svg` | 16x16 | 供应商星级 · 单星 |  |
| `supplier-star-stars.svg` | 76x16 | 供应商星级 · 五星 | 供应商评级行 |

## 来源

全部取自飞鹊 `brand logo` 组件（key `9fd7ad87678ed833acb3009c4c7a087de10dcfae` · node `2005:9039` · page「icon图标✅」· 17 个 variant），
用 figma `download_assets` 逐个导出，并跑 `build/clean-figma-svg.py` 清掉画布杂质
（Figma 组件集的紫色虚线框、画布底色）。尺寸与清册 `existingVariants` 逐个核对过。

🔴 **形态是稀疏的**：8 个 brand × 8 个 form 只做了 17 个组合。
别拿一个 brand 的经验套另一个 —— 最典型的是 `leading-factory` **只有 wordmark、没有 icon**。

🔴 **`icons/mic.svg` 不是 LOGO**：那是 16px 单色 M 字标；要 MIC LOGO 用 `mic-logo.svg`。

由 `build/gen-brand-index.py` 生成。
