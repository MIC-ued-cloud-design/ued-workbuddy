# 编辑层（像 Figma 那样改预览）＋ 多页面流程的十四套门

## 第一次 clone 下来要做什么

**下面这个分档是真的 clone 到临时目录跑出来的，不是读 require 猜的** ——
`win.test.js` 看源码像是零依赖，实跑却因为间接 require 挂在 electron 上。

| 装什么 | 跑得了哪几套 | 项数 |
|---|---|---|
| **什么都不用装**，clone 完直接跑 | htmlmap 43 · kb-url 4 · engine 8 · flow 36 | **91** |
| `cd desktop && npm i` | ＋ updater 29 · win 11 · flow-iso 19（`npx electron` 跑） | **59** |
| `cd desktop/restore-tools/online-reach && npm i` | ＋ font 51 · probe 60 · scope 15 · states 12 · ui 136 · flow-ui 58 · flow-walk 13 | **351** |

第三档只装 `puppeteer-core`，**不下载 Chromium** —— 它用的是本机已装的 Google Chrome
（`/Applications/Google Chrome.app/…`）。没装 Chrome 的机器跑不了这一档。

🔴 `node_modules` 不进仓，所以**这份 README 是唯一写着「要装什么」的地方**。
2026-09-18 之前 `_verify/` 整个在 .gitignore 里，门只活在一台机器上；移进仓那天才发现
依赖压根没有任何声明，等于「文件进了远端、能力没进」。加依赖就往这张表加一行。

```bash
node _verify/edit/htmlmap.test.js   # 源码定位与补丁：分词 / 编号 / 范围 / 样式 / 文字 / 删 / 复制 / 挪 / 隐式闭合 + 替换 / 插入 / 类名 / 注样式 + 组件清册 26 块砖（纯 node，1 秒）
node _verify/edit/probe.e2e.js      # 探针：真 Chrome + CDP 真输入通道（悬停 / 点选 / 双击改字 / ⌘D / 拖拽换序 / 手柄 / 焦点 / ⌫ / off）
node _verify/edit/kb-url.test.js    # 「给个网址就能加进资料库」：网页转文字 / 网址写错给人话（纯 node，抓取本身要 Electron，见文件头）
node _verify/edit/states.e2e.js     # 飞鹊控件自带交互：真鼠标悬停/点击，量颜色变没变（期望值抄自飞鹊源 CSS）
node _verify/edit/engine.test.js    # Claude 会话：跑着的时候也能说话——忙时 send 照写 stdin 不另开一轮 / result 后又动起来归到「补充」/ 进程没了报得清楚（纯 node，假进程）
node _verify/edit/win.test.js       # Windows 分支：在 Mac 上假装成 win32 跑纯逻辑（找 claude / .cmd 垫片拆解 / 按平台挑包 / PowerShell 换包脚本）——证明分支没写错，证明不了真机能跑
node _verify/edit/font.test.js      # 字体焊死 + 「该用现成的地方用了没有」：注入器（幂等 / 克隆页豁免 / 落点）＋ 体检四条新规则 ＋ 🔴 **真 Chrome 读实际落地的 PostScript 名**（只验字符串会全绿而字还是粗的）
node _verify/edit/flow.test.js       # 多页面流程的地基：扫描器（页 / **视图** / 态 / **叠加开关** / 跳转 / 说明 / 剧本）＋ 判漏的门 ＋ 交付说明编译（纯 node，在临时目录造真文件，1 秒）
node _verify/edit/flow-ui.e2e.js    # 流程控制台窗口自己的界面：对照表 / 铺开 / 流程 / 剧本 / 检查五视图 + 展示模式，出一张截图。🔴 **这套门不许开 setBypassCSP**——开着的话 CSP 问题一律看不见（2026-09-18 字体就是这么漏的）
node _verify/edit/flow-walk.e2e.js  # 独立走查包 `_走查.html`：真 file:// 打开（对方双击就是这个情形）——🔴 file:// 下换不换得动状态类，是整个做法成不成立的那一条
npx electron _verify/edit/flow-iso.e2e.js   # 🔴 真 Electron 隔离实例：控制台 → 主进程 → 主窗口 → 探针 → 真页面这一整条线（上面两套各验一半，中间这段只有真跑才验得到）
node _verify/edit/ui.e2e.js         # 界面：真 renderer + mock 掉 uw 桥（面板真值 / 即时生效 / 合并写 / ⌘Z 冲突两段式 / 发消息带手改记录 / 组件栏 26 卡 + 缩略图真渲染 / 拖放替换与插入 / 组件属性切档），出两张截图
```

改 `main/htmlmap.js`、`main/edit-probe.js`、`main/components.js` 或 `renderer/app.js` 的「编辑层」一节，
🔴 **十四套一套都不许漏**（htmlmap 43 / kb-url 4 / updater 29 / engine 8 / win 11 / **font** 51 / probe 60 / scope 15 / states 12 / ui 136 / **flow** 36 / **flow-ui** 58 / **flow-walk** 13 / **flow-iso** 19 ＝ **495**）。
改了 `main/flow.js`、`main/flow-doc.js`、`main/flow-walk.js`、`renderer/flow.*` 或 `renderer/app.js` 的「流程控制台」一节，后四套必跑。
🖱️ **演示光标那几条门验的是「路径」不是「终点」**（2026-09-18 立）：让光标**闪现**到目标，
「停在目标中心」那条照样全绿 —— 而屏幕上人看到的还是「页面自己变了」，正是吉吉说的「没有实感」。
所以中途要采一次样：那一刻它必须既不在起点也不在终点。**这条门当场抓到了真 bug**
（同一帧里连着设起点和终点，浏览器会合并成一次，transition 压根不触发；要下一帧再设目标值）。

🧹 **发版会顺手清 dist**（`build/clean-dist.sh`，2026-09-18 加·起因是攒到了 19G）。
🔴 它**只删「GitHub 上已经有的那些版本」的本地包** —— 没发布过的开发包，本地这一份就是最后一份，
机器不替人做那个决定，只打印出来让人自己删。**清理和销毁最后一份，在命令行上长得一模一样**
（那次手工清，38 个版本里就有 9 个是从没发布过的）。查不到远端列表时整个跳过，宁可多占盘。
清理挂在 `pickLatest` 回查**之后**：清早了万一发失败，手里就什么都没有了。

🔴 **`flow-ui` 里有一组「形状矩阵」**（2026-09-18 立）：六种真实会碰到的流程形状各造一份真项目，
逐个验「认对形状 / 编号连续 / 线不穿卡 / 画布装得下 / 装得下就不滚 / 缩略图不低于可读下限」。
**以后碰到画不好的形状，往那张表里加一行，别在 `planLayout` 里补一个 if** ——
补 if 治的是那一个项目，加一行治的是这一类形状，而且下次改布局时它会替你挡住回归。
🔴 **`flow-iso` 不能用 `node` 跑，要 `npx electron`**——它验的就是两个真窗口之间那条线。
🔴 它的料是工作区里的「20260917-多页面流程示例」，那个项目被删了这套门会**跳过而不是红**（会打一行 ⚠️，别当全绿）。
改了 `main/feique-font.js`、`main/feique-check.js` 或 `packs/feique/fonts/` 就必须跑 font 那套；
🔴 **换了 `fonts/*.woff2` 要重跑 `python3 -c` 导 `coverage.json`**（体检的 glyph-range 拿它当判据），font 门会核字节数。
🔴 **顶层代码抛一次异常，它后面所有的 `const` 都留在 TDZ**——2026-09-17 加流程控制台时，
一句 `uw.onFlowClosed(...)`（mock 桥上没这个方法）就让 `CP` 变成「未初始化」，而报错指向 `setEdit`，完全指不到真凶。
`ui.e2e` 末尾那条「桥上少了 flow 那几个方法时渲染层照常起得来」就是为这一类立的回归门。
2026-09-17 还栽过：只跑了其中五套、漏了 `scope.e2e`，「勾选框点一下取消勾选」红了一整轮没发现 ——
砖的 HTML 换成原生控件后，行为脚本的 preventDefault 把原生勾选挡掉了，两套状态各说各话。
改了 `packs/feique/docs/css/` 或 `build/gen-feique-states.py`，先重跑 `python3 build/gen-feique-states.py` 再跑 states 那套。
🔴 states 那套的两条仪器判据：砖出厂就是勾上的（要另摆一份取消勾选的才量得到 hover）；飞鹊控件带 150–200ms 的 transition，
动作后立刻取色会拿到过渡中间值（#9CACBC 这种查无此处的数），必须等过渡结束。
🔴 仪器判据：puppeteer 双击是 `{ count: 2 }` 不是 `clickCount`；renderer 的 CSP 只放 `uwproj:` 的 iframe，测试里要 `setBypassCSP(true)`；`uwproj:` 在普通 Chrome 里会报 external protocol blocked，是环境不是 bug。
🔴 puppeteer 25 的 `mouse.dragAndDrop` 跨到 iframe 会挂死（Input.setInterceptDrags 不回、左键留在按下态），所以拖放那两条在 iframe 里派发带 DataTransfer 的真 DragEvent，走探针同一套 dragover/drop；**真拖放手感只能真机点**。
