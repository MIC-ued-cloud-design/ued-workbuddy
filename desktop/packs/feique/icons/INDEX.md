# 飞鹊 UI 图标 · 检索索引（295 个）

🔴 **按用途找，别靠文件名猜** —— 文件名多是 MIC 内部缩写。
最典型的：要「Chat Now」的图标时 `grep chat` 只会命中 `wechat`（微信），
真正的聊天图标叫 **`tm.svg`**（TM = Trade Manager）。2026-09-15 就这么画错过一次。

用法：`cat icons/<名>.svg` 拿到 SVG 原文，整段内联进页面（别用 <img>，要能跟着文字改色）。

## 高频业务图标（做 MIC 页面先看这张表）

| 文件 | 是什么 | 搜这些词都该找到它 |
|---|---|---|
| `attachment.svg` | 附件 | attachment, file, 附件, 上传文件 |
| `buyer-sourcing.svg` | 买家采购 | buyer, sourcing, 买家, 寻源 |
| `cart.svg` | 购物车 | cart, 购物车 |
| `cart-add.svg` | 加入购物车 | add to cart, 加购 |
| `cart-success.svg` | 加购成功 | cart success, 加购成功 |
| `filter.svg` | 筛选 | filter, 筛选 |
| `ind-STS.svg` | STS 行业图标 🔴 这是行业分类图标，不是 STS 品牌标 | STS icon；要品牌标去 brand/sts-*.svg，别拿这个 |
| `mail.svg` | 邮件 | email, mail, inquiry, 邮件, 站内信, 询盘 |
| `maill-send.svg` | 发送邮件 🔴 文件名是双 l 的 maill | send email, 发送邮件, 发送询盘 |
| `medal.svg` | 奖章 / 资质 | medal, badge, award, 奖章, 资质 |
| `mic.svg` | MIC 字标图标 🔴 16px 单色 M 字标，**不是 LOGO** | 要 MIC LOGO 用 brand/mic-logo.svg（240×46 彩色），别拿这个当 LOGO |
| `negotiate.svg` | 议价 / 谈判 | negotiate, bargain, 议价, 还价 |
| `product.svg` | 商品 | product, item, 商品, 产品 |
| `purchase.svg` | 采购 | purchase, procurement, 采购 |
| `quick-reply.svg` | 快捷回复 | quick reply, 快捷回复, 模板回复 |
| `refund.svg` | 退款 | refund, return money, 退款 |
| `safeguard.svg` | 担保 / 保障 | guarantee, secured, protection, 担保交易, 保障 |
| `search.svg` | 搜索 | search, 搜索 |
| `star.svg` | 星（线框） | star outline, 空心星, 评分 |
| `star-f.svg` | 星（实心） | star filled, 实心星, 评分 |
| `talk.svg` | 对话气泡（线框） | comment, message, 留言, 咨询, 评论 |
| `talk-f.svg` | 对话气泡（实心） | comment filled, 留言实心 |
| `tm.svg` | TM（Trade Manager）MIC 买卖家即时沟通工具 | chat, chat now, message, im, contact supplier, 聊天, 沟通, 联系供应商 |
| `truck.svg` | 物流 / 发货 | shipping, logistics, delivery, 物流, 发货 |
| `verification-supplier.svg` | 供应商认证 | verified supplier, 认证供应商 |
| `yes.svg` | 勾 · 圆圈+勾 | check circle, 圆圈勾 |
| `yes-f.svg` | 勾 · 实心圆挖勾 | check filled, 实心勾 |
| `yes2.svg` | 勾 · 纯勾 🔴 checkbox 用这个 | checkmark, tick, 纯勾, 复选框的勾 |

## 🔴 文件名拼错的（搜正确拼写一个都搜不到）

| 实际文件名 | 本该是 |
|---|---|
| `ind-agriculture-hardwar.svg` | hardware（少了结尾的 e） |
| `ind-apprel.svg` | apparel 服装（少一个 a） |
| `ind-industrail-equipment.svg` | industrial（rai 写成了 rail） |
| `ind-lightIndusty.svg` | light-industry（少 r，且是唯一的驼峰命名） |
| `instagrame.svg` | instagram（多了结尾的 e） |
| `instagrame2.svg` | instagram（多了结尾的 e） |
| `maill-send.svg` | mail-send（文件名多了一个 l） |

## 全部 295 个（按飞鹊分类）

### 功能图标（56）
通用 UI 动作（搜索/筛选/收藏/设置…）

```
ad bell bookmark calendar call category category2 clean clock compass compass-f cooperation coordinate drag eye eye-close eye-close-f eye-f filter fire fire-f flag flag-f gallery headsets heart heart-f history home home-f label label-f list lock medal more phone points preview prohibit qr recycle refresh report reservation scan search setting setting2 share shop sign-out star star-f unlock vs
```

### 符号&箭头（45）
箭头、状态符号、勾叉、排序

```
add add-l arrow-down arrow-left arrow-right arrow-up bottom caution caution-f deduct down down-big download error error-f info info-f left left-big left-rotation left-rotation-f left-round left-round-f problem-f right right-big right-rotation right-rotation-f right-round right-round-f rotate-left rotate-right sort sort1 sort2 top up up-big upload vector yes yes-f yes2 大于等于 小于等于
```

### 行业图标（33）
MIC 的 33 个行业分类，`ind-` 前缀

```
ind-STS ind-agriculture ind-agriculture-hardwar ind-apprel ind-artcraft ind-auto ind-bag ind-bathroom ind-beauty ind-building-material ind-chemical ind-computer ind-construction ind-consumer-electronics ind-electrical ind-furniture ind-health ind-industrail-equipment ind-instrument ind-light ind-manufacture ind-metallurgy ind-office-supplies ind-outdoor ind-packaging ind-pet ind-security ind-service ind-sporting ind-textile ind-tool ind-toy ind-transportation
```

### 媒体（29）
图片、视频、音频、缩放

```
camera camera-f camera-off camera-off-f crop enlarge enlarge2 enlarge2-f enlarge3 flip flip-f music narrow panorama pause picture play reduce3 rotate-image scaling similarity video video2 voice voice-f voice-off voice-off-f volume-off volume-up
```

### 富文本（25）
编辑器工具条

```
add-row-down add-row-left add-row-right add-row-up align-center align-left align-right back bold color delete-column delete-row font-color foward fullscreen fullscreen-out italic link merge sub-script super-script symbol table text-style underline
```

### 询价询盘（22）
inquiry / RFQ 询盘·沟通·附件·文件类型 —— **做 inquiry 相关页面先翻这一类**

```
attachment batch chart copy distribution file fill folder gif keyboard mail maill-send negotiate pdf picture-gallery print quick-reply save tableedit talk talk-f zip
```

### 交易（19）
购物车、订单、支付、物流、退款

```
basket basket-right card cart cart-add cart-success coupon dollar gift product product-add product-caution product-main product-prohibit product-returns refund safeguard sale truck
```

### 社媒（方）（15）
社交平台方形标

```
VK X facebook googleplus instagrame linkedin pinterest qzone share-mail tencentweibo tiktok wechat weibo whatsapp youtube
```

### 社媒（圆）（15）
社交平台圆形标

```
VK2 X2 facebook2 google2 instagrame2 linkedin2 pinterest2 qzone2 share-mail2 tencentweibo2 tiktok2 wechat2 weibo2 whatsapp2 youtube2
```

### 账户（10）
用户、身份、通讯录

```
active add-friend buyer-sourcing collection-person group personal personal-f phonebook prohibit-person verification-supplier
```

### 评价（10）
评分、表情、问卷

```
female fill-text general happy male survey survey2 thumb-down thumb-up unhappy
```

### 品牌图形&标准功能图标（9）
平台标识类（android/apple/mic/tm/mei）

```
android android-f apple apple-f mei mei-f mic purchase tm
```

### (未分类)（7）
icon-variants.txt 里对不上的，多半是旧图或临时图

```
Loading delete ic_image ind-lightIndusty vector2 vector_left vector_right
```

---

🔴 **品牌标识不在这里**：MIC LOGO、STS 担保交易、Audited 认证、Leading Factory、
会员等级（Diamond/Gold）、供应商星级 —— 全在 `brand/` 目录，是**整体矢量**，
字是画出来的不是文字节点，**一律内联真 SVG，不许用文字拼**。清单见 `brand/INDEX.md`。

由 `build/gen-icon-index.py` 生成（分类取自 icon-variants.txt，业务语义与检索词是人写的）。
