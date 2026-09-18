# 飞鹊字体（Roboto 400 / 700）

这两个文件**就是 MIC 线上正在用的那两份**，从线上 VO 页面的 `@font-face` 里逐字节取下来的：

| 文件 | 来源 | 字节 | 字形数 |
|---|---|---|---|
| `roboto-400.woff2` | `micstatic.com/common/fontastic/dist/assets/roboto/400-regular/Roboto-Regular_3ca9c03e.woff2` | 19832 | 234 |
| `roboto-700.woff2` | `micstatic.com/common/fontastic/dist/assets/roboto/700-bold/Roboto-Bold_66f23800.woff2` | 14552 | 214 |

## 为什么要有这两个文件

`DESIGN.md` §1 规定字体只用 Roboto、CJK 自动回落系统字体。但**只写 `font-family: Roboto` 是不够的**：

浏览器拿到 `font-weight: 400` 时，会去系统已装的 Roboto 家族里挑一张脸。装了多个静态 Roboto
（Thin/Light/Regular/Medium/Bold/Black 各一个 ttf，2011 版 name table 全部自称 family=Roboto）的机器上，
**Chrome 会挑中 Roboto-Black（900）**——实测于 2026-09-17，CDP `CSS.getPlatformFontsForNode` 读出来的。

于是同一行字里：西文 = Roboto-Black(900)，中文回落 PingFang SC Regular(400)，**差了 5 个字重档**，
看起来就是「英文数字明显比中文粗」。700 那档只差一档（Roboto-Bold vs PingFang-Semibold），所以标题不明显、正文最明显。

线上没有这个问题，因为线上写了 24 条 `@font-face` 把每个字重焊死到具体文件。
1:1 还原线上的页面把那 24 条一起克隆下来了，所以也没问题。
**只有 UW 自己从零做的页面，一条 `@font-face` 都没有** —— 这就是那个 bug 的全部。

## 另一半：这个 bug 是机器相关的

没装 Roboto 的机器上，西文落到 `-apple-system`（SF Pro），跟 PingFang 配得很好，**根本看不到这个问题**。
也就是说同一份 HTML 在不同同事的机器上长得不一样。把字体内嵌进页面，这条一起治了。

## 怎么用（不用人管）

应用会在预览刷新时**自动**把这两个文件以 base64 内嵌进 HTML（`main/feique-font.js`，幂等、带标记注释）。
手写页面的人和模型都不需要碰它。体检有一条 `font-pin` 规则兜底，注入没成功会报硬伤。

🔴 **别删页面里那段 `/* UW-FEIQUE-FONT */` 注释包起来的 CSS**，删了字重就又劈叉了。
🔴 克隆线上的页面**不会**被注入（它自带线上那 24 条），判据见 `feique-font.js` 的 `isClone()`。

## 已知边界

线上这两份是窄子集（234 / 214 字形），不覆盖 `→` `Ā` `Ž`，Bold 还不覆盖 `…` `™`。
页面上真用到这些字符时，那个字符会单独回落到下一档字体、跟旁边不一致。
体检 `glyph-range` 规则会把超范围的字符报出来（提醒级）。
**这跟线上的行为完全一致**——线上就是这么设的，不是我们引入的缺口。
