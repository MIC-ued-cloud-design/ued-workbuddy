# 飞鹊 Web 组件 · 网页实现清单

做网页产物时的**砖表**。全部 28 类、加起来只有 73KB —— 挑这页要用的，`cat` 进 index.html 的 `<style>`。

**规矩三条**：① 一律带上 `_reset.css` ② 表里有的组件不许自己另写一套、也不许发明飞鹊没有的变体（`.btn-neutral` 这种）③ 表里没有的见文末，那些是**没有 CSS 实现**的，只能导出真资产或留占位，手画一个看着差不多的比留空更糟。

用法示例：做一个带表单和分页的列表页 →

```bash
cat docs/css/{_reset,btn,inp,sel,cb,pg,alert,empty}.css
```

## 有 CSS 实现的组件

| 组件 | 文件 | 主类名 | 规则 | 怎么用 |
|---|---|---|---|---|
| 全局 Reset（仅影响组件） | `css/_reset.css` | （无类名 · 全局生效） | 3 | 每个页面都要带：box-sizing 与 number input 箭头处理 |
| Alert 警告提示 | `css/alert.css` | `.alert` `.alert-body` `.alert-close` | 26 | 提示条。里面不放按钮，动作用 .alert-link 文字链 |
| 飞鹊 Badge 徽标 | `css/bdg.css` | `.bdg` `.bdg-dot` `.bdg-dot-blue` | 14 | 徽标：红点 / 数字 / 状态点 / 缎带 |
| Breadcrumb 面包屑 | `css/brd.css` | `.brd` `.brd-dark` `.brd-item` | 11 | 面包屑。分隔符是飞鹊 icon=right 的 16×16 内嵌 SVG |
| 飞鹊 Button | `css/btn.css` | `.btn` `.btn-dashed` `.btn-dashed-blue` | 36 | .btn + 尺寸 .btn-lg/md/sm + 变体 primary/secondary/text/link。全页只一个 .btn-primary |
| 飞鹊 Checkbox 复选框 | `css/cb.css` | `.cb` `.cb-blue` `.cb-box` | 25 | 复选框。勾是内嵌 SVG（icons/yes2.svg，纯勾那个），不是 border+rotate 拼的 |
| 飞鹊 Cascader 级联选择器 | `css/cscd.css` | `.cscd` `.cscd-arrow` `.cscd-cb` | 33 | 级联选择器（多级目录常用） |
| 飞鹊 Drawer 抽屉 | `css/dw.css` | `.dw` `.dw-body` `.dw-div` | 15 | 抽屉（侧滑面板） |
| 飞鹊 Empty 缺省图 | `css/empty.css` | `.empty` `.empty-desc` `.empty-img` | 6 | 空状态缺省图。插图用 .empty-img 占位，别自己画空状态 |
| 飞鹊 Input 文本输入框 | `css/inp.css` | `.inp` `.inp-body` `.inp-caption` | 60 | .inp > .inp-body > input（input 本身无边框）；状态 .inp-error/-warning/-success/-disabled |
| 飞鹊 InputNumber 数字输入框 | `css/inpn.css` | `.inp-num` `.inp-num-btn` `.inp-num-dis` | 43 | 数字输入框（带步进器） |
| 飞鹊 List 列表 | `css/lst.css` | `.lst` `.lst-arrow` `.lst-avatar` | 27 | 列表 |
| Message 全局提示 | `css/msg.css` | `.msg` `.msg-error` `.msg-icon` | 11 | 全局提示（顶部飘出那种） |
| 飞鹊 Pagination | `css/pg.css` | `.pg` `.pg-active` `.pg-arrow` | 22 | 分页：数字 + 箭头 + more。别自己拿 <a> 拼 |
| 飞鹊 Radio 圆形单选框 | `css/rd.css` | `.rd` `.rd-blue` `.rd-circle` | 21 | 圆形单选 |
| scrollbar (Figma 2019:24778) | `css/scr.css` | （无类名 · 全局生效） | 10 | 自定义滚动条 |
| 飞鹊 Select 选择器 | `css/sel.css` | `.sel` `.sel-chev` `.sel-demo-wrap` | 38 | 下拉：触发器 + 浮层 + 选项。多选项用 multiple selection item |
| 投影 Token | `css/shadow.css` | `.shadow` `.shadow-1` `.shadow-2` | 3 | .shadow-1/2/3 三级投影 |
| 飞鹊 Skeleton 骨架屏 | `css/skel.css` | （无类名 · 全局生效） | 92 | 骨架屏（列表/卡片/段落/头像） |
| Loading / Spin 加载 | `css/spin.css` | `.spin` `.spin-blue` `.spin-dark` | 18 | 加载转圈。别自己写 @keyframes |
| 飞鹊 Selector Single 按钮式选择器（买家端） | `css/ss.css` | `.ss` `.ss-blue` `.ss-dis` | 10 | 按钮式单选（买家端常用，长得像按钮不是圆点） |
| Steps Items (Figma 3035:451) | `css/stp.css` | `.stp` `.stp-body` `.stp-cur` | 112 | 步骤条（下单流程 / 多步表单） |
| Switch 开关 (Figma 2216:13236) | `css/sw.css` | `.sw` `.sw-disabled` `.sw-handle` | 14 | 开关 |
| 飞鹊 Textarea 文本域 | `css/ta.css` | `.ta` `.ta-count` `.ta-disabled` | 20 | 多行文本域，带字数计数位 |
| 飞鹊 Tabs 标签页 | `css/tab.css` | `.tab` `.tab-btm` `.tab-card` | 30 | 标签页。选中态是下划线，不是 chip |
| Tag 标签 | `css/tag.css` | `.tag` `.tag-areal-blue` `.tag-areal-green` | 16 | .tag + tag-line-*（描边）/ tag-areal-*（浅底） |
| Tooltip | `css/tip.css` | `.tip` `.tip-arrow` `.tip-arrow-dn` | 21 | 气泡提示 |
| Upload 上传 (Figma 0:11445) | `css/upl.css` | `.upl` `.upl-btn` `.upl-btn-disabled` | 60 | 上传：按钮式 / 拖拽区 / 文件列表 / 图片列表 / 上传中 |

## 整块组件（HTML + CSS 一起给，在 docs/blocks/）

砖表给的是原子控件（按钮、输入框…），**整块业务组件在 `docs/blocks/`**：
`cat` 出来 → `<style>` 和结构原样贴 → 只换文案图片 → 填掉 SLOT。跟砖表一样，**里面的值一个都别改**。

| 组件 | 文件 | 单卡尺寸 | 备注 |
|---|---|---|---|
| ProductCard-主搜(List) 主搜产品卡·列表版 | `blocks/product-card-list.html` | 1167×323 | 已逐坐标对过 Figma 真值 |
| ProductCard-主搜 主搜产品卡·网格版 | `blocks/product-card-grid.html` | 350×585 | 已逐坐标对过 Figma 真值 |
| ProductCard-QP QP 产品卡·网格版 | `blocks/product-card-qp-grid.html` | 324×560 | 已逐坐标对过 Figma 真值 |
| ProductCard-QP(List) QP 产品卡·列表版 | `blocks/product-card-qp-list.html` | 1518×320 | 已逐坐标对过 Figma 真值 |
| ProductCard——LV LV 产品卡·网格版 | `blocks/product-card-lv-grid.html` | 300×554 | 已逐坐标对过 Figma 真值 |
| ProductCard——LV(List) LV 产品卡·列表版 | `blocks/product-card-lv-list.html` | 1520×281 | **三栏**，已逐坐标对过 Figma 真值 |
| product-card 简化卡（带 Select 勾选，对比/推荐位） | `blocks/product-card-compare.html` | 253×367 | 已逐坐标对过 Figma 真值 |
| MIC Footer Product 产品详情页脚 | `blocks/mic-footer-product.html` | 宽度自适应 · 高 205（1024 档 241） | 四断点一套实现，已逐坐标对过 |
| MIC Footer Search 搜索结果页脚 | `blocks/mic-footer-search.html` | 宽度自适应 · 高 280（1024 档 316） | 四断点一套实现，内联 11 个真图标 |
| vo-header VO 后台顶栏 | `blocks/vo-header.html` | 1600×85 | MIC LOGO 已内联 |
| vo-nav VO 后台二级导航 | `blocks/vo-nav.html` | 1600×40 | 换选中项＝挪 `von-on` 类 |
| vo-sider VO 后台左侧栏 | `blocks/vo-sider.html` | 210×782 | 两个 variant 只差选中项，一份实现够用 |

🔴🔴 **六张产品卡彼此差异极大，绝不能拿一张的经验套另一张**（2026-09-15 逐个量出来的）：
按钮宽度主搜 125/125、QP 108/102；按钮字重主搜和 QP 是 Bold、LV 是 Regular；
购物车只有主搜和 QP 有；收藏心形只有主搜和 QP 有，LV 是「找相似」且网格版在图左下、列表版在图右上；
底部信息行主搜是五颗星、QP 是「5.0/5 + 评价语」、LV 是「5.0 ★ (1) + 评价语」；
公司名颜色主搜网格 #888 / 主搜列表 #222 / QP 网格 #888 / QP 列表 #222。**每张卡照它自己的片段来。**

🔴🔴 **页头页脚这批（2026-09-15）有四条不能破的规矩**：

1. **两个 footer 不能互相抄**。分隔竖线 Footer Product 是 `#555555`、Footer Search 是 `#CED3D9`；
   链接清单也不同（Product 有 English、China Wholesale、Chinese Manufacturers/Suppliers；
   Search 没有 English，是 China Manufacturers/Suppliers ＋ Wholesale Products ＋ Continent Channel）。
   逐条核过，确认是真的不同，不是抄漏。
2. **响应式不用写 @media**。两个 footer 在 Figma 里各有 4 个断点 variant，但四档的差别只有
   「链接行在窄屏折成两行」一件事 —— `flex-wrap` 就够，宽度给多少自己排。
   实测一套实现同时对上 205/205/205/241 和 280/280/280/316 八个高度值。**断点是结果，不是输入。**
3. **Figma 的描边是 INSIDE，CSS 要用 `box-shadow:inset` 不是 `border`**。
   写成 border 会把盒子撑大 1px（footer 总高 205→206）或把内容推移 1px（vo-sider 按钮文字 44→45）。
   这 1px 容差能混过去，但四档全偏。
4. **footer 里的图标不能用 icons/ 的同名文件**。社媒在组件里是 28×28 带方框徽标，`icons/facebook.svg`
   是 16×16 纯字形；`tm` 组件里 24×24 品牌蓝 #007DFA，`icons/tm.svg` 是 16×16 #222222。
   所以那 11 个是从组件导出后内联的。（vo-header 的 down/basket-right/phone 三个逐段比对过，
   跟 icons/ 是同一字形同一颜色，可以互换 —— **同名能不能用要一个个查，没有通则**。）

🔴 做产品卡的认证标一律用 `brand/productcard/` 那四个（从组件直接导的）。
`brand/` 根目录那批尺寸对不上：sts 组件里 106×22 而根目录是 87×16、
品证 116×22 vs 182×22、Audited 46×16 vs 105×16。

## 没有 CSS 实现 —— 只有 Figma，不许手画

页头页脚、LOGO、产品卡、筛选侧栏这些是 MIC 既有资产，属于**照抄范围，不是设计空间**。
要真 SVG / 真结构：用 figma 的 `download_assets` 按 key 导出；导不到就画灰色占位块并在交付说明里写明「待补真资产」。
品牌 LOGO 已经是现成 SVG，在 `brand/` 目录，直接内联。

| 组件 | Figma key | 节点 |
|---|---|---|
| MIC FilterItem | `72506eff5619a1cef95d2b084f3d95ccae91b191` | `4453:551` |
| MIC FilterSidebar | `f53d86def06ac2b6d80cb8bc49a42c0016b802ea` | `4456:442` |
| MIC Footer Product / 产品详情页脚 | `0cf67c195a3246aec24f3092a3e5f06515fea972` | `6181:1549` |
| MIC Footer Search / 搜索结果页脚 | `82a1826d2b2f416e3e84d67ff7989cf5b2522cfe` | `6173:1330` |
| MIC Supplier Ad / 主搜页聚焦广告 | `0fbc3c51117e04842f0bf3671167940f06d6ac29` | `5265:2216` |
| MIC TM Bar / 主搜页贴底TM标 | `d32760ae0578ecdeba3a43bcfe7aee09bae6e3a9` | `5306:2554` |
| MIC brand logo with checkbox | `b774a95ab156da3d05fdfa0aba83d7734a1857ec` | `4466:824` |
| ~~ProductCard ——LV~~ 已有实现 → `blocks/product-card-lv-grid.html` | `dcd798335ef12b6f755ade543bf41ee0b277234b` | `6717:1481` |
| ~~ProductCard-QP~~ 已有实现 → `blocks/product-card-qp-grid.html` | `dc65800d98b1fc0dccf082213f75a3996ec1641e` | `7490:1338` |
| ~~ProductCard-QP(List)~~ 已有实现 → `blocks/product-card-qp-list.html` | `2a7119b4f75ee0d570e342aa6a331e722f89b6ae` | `7974:7315` |
| ProductCard-主搜 | `e9d2a2f857be9da599aa035eef5e36d7b28bd034` | `7490:1339` |
| ~~ProductCard-主搜(List)~~ 已有实现 → `blocks/product-card-list.html` | `ed698a0ad82597bb86184910097fc42b52cbeae7` | `7974:7314` |
| ~~ProductCard——LV(List)~~ 已有实现 → `blocks/product-card-lv-list.html` | `2a73e30c98d5a4c64407b42cd096aaf0028463a7` | `7490:3336` |
| attachment icon | `c3296c953d1cb604f305a2121d55e328cc0738a2` | `44:10322` |
| brand logo | `9fd7ad87678ed833acb3009c4c7a087de10dcfae` | `2005:9039` |
| mic-logo | `16b912f2a723fc29a132f2c1b05fae23cc2c25b0` | `4596:1086` |
| ~~product-card~~ 已有实现 → `blocks/product-card-compare.html` | `28b782a96cab654cfd7d9c0f37ac24058a67ed74` | `10752:2633` |
| product-image（图位子组件，已含在各卡 media 里，不用单独实现） | `0c3f8f4cf9a4b6c80cdac1ac26dfbdf5384c8ed3` | `8108:3514` |
| product-image(list) | `ca9cb3a253b2c3e46b8d4d22c730ee9c7d49ae1d` | `8108:3686` |
| product/QP-image | `02cba4a0aec20875c3861a5e52d968a903b0a59d` | `8108:4081` |
| product/QP-image(list) | `619c5169a6bda12a3e5cda8b4e5a5e4d1f6246b5` | `8108:4110` |
| similar Btn（已含在 LV 两版片段里） | `2612a77b3b8efabca77b53a82b00d73930af0790` | `8094:1666` |
| vo-header | `56bd0fd58dd6219ded4f62ab47db34db8f3f4b9b` | `4596:881` |
| vo-nav | `39dab5212ae12ec6520eb826e8d2c7ce00ef8cb5` | `4596:912` |
| vo-sider | `7d9470408f1b2b99d1c95e78c1f7601469b0964b` | `4596:973` |

## 库里提到、但没有 CSS 实现的

**Collapse 折叠面板**：权威源里只有一段注释描述它的 DOM 结构（`.clps > .clps-item > .clps-hd/.clps-bd`），没有任何一条规则。要用折叠面板得自己实现结构，或去 Figma 取。别照着那段注释写类名——那些类在页面里是空的。


---

由 `build/gen-feique-css-split.py` 从 `飞鹊Web组件库.css` 切出（权威源是后者，改了它重跑本脚本）。
那份里另有 508KB 是 335 个图标 data-URI，组件不依赖，没切进来；UI 图标用 `icons/` 下的 295 个 SVG。
