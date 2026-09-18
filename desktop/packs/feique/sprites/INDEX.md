# 飞鹊缺省图（31 张）

空态**不用自己想、更不要自己画**。MIC 把 26 个业务场景的插图都做好了，买家侧和供应商侧还分了配色。

## 怎么用（一行就够）

```html
<div class="empty">
  <div class="empty-img"><img data-feique-empty="no-product-result" alt=""></div>
  <div class="empty-title">没找到 "led light" 相关的产品</div>
  <div class="empty-desc">换个关键词试试，或者看看下面的推荐类目</div>
</div>
```

`src` 不用写 —— UED WorkBuddy 会在预览刷新和交付打包两个时点自动把图内嵌进去（一张 2–6KB）。
`data-feique-empty` 这个属性**留在源码里是故意的**：它告诉前端这是飞鹊的哪一张，
换成一长串匿名的 `data:` 就谁也说不清图是哪来的了。

样式类走 `docs/css/empty.css`（`.empty` / `.empty-img` / `.empty-title` / `.empty-desc`），别自己写一套。

🔴 **别再留 `#F0F1F2` 的空占位块**。DESIGN.md 里那句「本包未带，需要时留空占位块」已经作废 —— 图现在带了。

## 挑哪一张

### 找不到 / 没有内容
| 名字 | 画的是什么 | 什么时候用 |
|---|---|---|
| `no-product-result` | 包裹 + 放大镜 | 产品搜索没结果 |
| `no-company-result` | 店铺 + 放大镜 | 公司 / 供应商搜索没结果 |
| `no-result` | 文件 + 放大镜 | 筛选没结果、通用的「查无记录」 |
| `empty-box` | 打开的空箱子 | 通用空数据，不知道选哪个就用它 |
| `empty-inbox` | 空托盘 + 飞出的纸飞机 | 空收件箱、还没有任何往来 |
| `no-favorite` | 文件夹 + 红星 | 没有收藏记录 |
| `empty-inquiry-basket` | 采购篮划掉 | 空询盘篮 |
| `no-image` | 相机 + 图片 | 暂无图片 |

### 出错 / 不让看
| 名字 | 画的是什么 | 什么时候用 |
|---|---|---|
| `error-404` | 404 星球 | 页面不存在 |
| `error-500` | 500 服务器 + 警告 | 服务端出错 |
| `error-network` | 信号断开 | 断网、接口超时 |
| `no-permission` | 文件夹 + 锁 | 没有权限看这块内容 |
| `no-download` | 文件夹 + 下箭头 | 没有可下载的内容 |

### 任务结果
| 名字 | 画的是什么 | 什么时候用 |
|---|---|---|
| `task-done` | 文件 + 绿勾 | 任务成功 |
| `task-failed` | 文件 + 红叉 | 任务失败 |
| `task-waiting` | 文件 + 黄时钟 | 任务排队中 / 处理中 |
| `inquiry-sent` | 信封 + 绿勾 | 询盘发送成功 |
| `order-submitted` | 窗口 + 绿勾 | 订单提交成功 |

### 分买家侧 / 供应商侧的六张（**同一张图两套配色，别用错边**）
买家侧是**红**（MIC 品牌红，图里带 `M B2B Trade`），供应商侧是**蓝**（图里带 `M 供应商`）。

| 买家侧 | 供应商侧 | 什么时候用 |
|---|---|---|
| `start-download-buyer` | `start-download-supplier` | 初始页面，引导去下载 / 导入 |
| `start-done-buyer` | `start-done-supplier` | 初始页面，这一步已经完成 |
| `link-account-buyer` | `link-account-supplier` | 关联账号 / 绑定链接 |
| `app-download-buyer` | `app-download-supplier` | 引导下载 App |
| `no-message-buyer` | `no-message-supplier` | 暂无消息 |
| `no-order-buyer` | `no-order-supplier` | 暂无商品 / 暂无订单 |

🔴 **做 VO 后台、供应商工作台一律用 `-supplier` 那套**（蓝）；做主站买家侧用 `-buyer`（红）。
用错边的后果不是「颜色不好看」，是**把供应商的页面做成了买家的样子**。

### 引导
| 名字 | 画的是什么 | 什么时候用 |
|---|---|---|
| `go-main-site` | 人 + Made-in-China 窗口 | 引导去主站 |

---

## 这份清单是怎么来的（判据，别当成官方命名）

图是从 `~/.claude/skills/mic-fullstack/assets/sprites/缺省图-透明.png`（1776×1680）切的，
**格子尺寸是量出来的**：6 列 × 6 行，每格 296×280（1776/6、1680/6 都整除），共 31 格，
跟 Figma 组件 `Empty 缺省图`（nodeId `4208:974`）的 `variantCount: 31` 对得上。

🔴 **上面每张图叫什么、用在哪，是我照着图片认的，不是从 Figma 的变体属性里读出来的。**
Figma 那边的 26 个「主题」属性值（中文、带全角括号）在
`assets/feique-component-catalog.json` 的 `components._emptyStates` 里。
要做 Figma 稿、要一字不差的变体名，以那份为准；这份清单管的是「做网页时挑哪张图」。
两边对不上的时候以 Figma 为准，并回来改这份。
