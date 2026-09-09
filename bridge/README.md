# UW本机桥

「本机桥」是装在你自己电脑上的一个小服务，让UW（UED WorkBuddy）页面用上你电脑里的Claude Code。
桥开着，页面的问答就走Claude，用的是你自己的Claude Team席位；
桥没开（或者在手机上），页面自动退回部门共享的智谱通道，什么都不用配。

## 装

电脑上要先有Claude Code（终端敲 `claude` 能用）。然后在终端粘这一行：

```bash
curl -fsSL https://mic-ued-cloud-design.github.io/ued-workbuddy/bridge/install.sh | bash
```

它会先用你的Claude Code真答一句，确认能答出来，才把桥设置成开机自动启动。之后刷新UW页面就行。

```bash
bash <(curl -fsSL https://mic-ued-cloud-design.github.io/ued-workbuddy/bridge/install.sh) --status      # 在不在跑
bash <(curl -fsSL https://mic-ued-cloud-design.github.io/ued-workbuddy/bridge/install.sh) --uninstall   # 卸载
```

## 它是什么、不是什么

- 一个几百行的Node脚本，一直在后台跑着，只监听本机的 `127.0.0.1:17331`。
- 页面每问一句，它就启动一次 `claude -p`（没有界面、答完就退出的Claude Code），把回答一边生成一边传回页面。
- 它**不是**另一条对外联网的路径：它启动的是 `~/.fcf/bin/claude`，跟你平时敲 `claude` 是同一个入口，
  对外联网经过公司FCF配的代理和使用上报。桥本身只在本机内部收发，不出这台电脑。

## 三把锁

| 锁 | 怎么做的 | 挡的是什么 |
|---|---|---|
| 只监听本机127.0.0.1 | `server.listen(PORT, '127.0.0.1')` | 局域网里别的机器 |
| 只认UW线上地址 | 校验浏览器带来的来源（请求头 `Origin`），别的一律403 | 任何别的网页、本地保存的html借你的Claude |
| 启动Claude时关掉全部工具 | `--tools "" --strict-mcp-config --setting-sources ""` | 它读你电脑上的文件、触发你装的钩子、加载MCP |

第三把锁顺带把每次请求的开销从四万多token降到几百：不带Claude Code自己那套系统提示，只带页面给的题和资料。

## 读网页（1.1.0起）

问题里带了网址，桥会用一个**独立的Chrome**（独立profile `~/.uw-bridge/chrome-profile`，不碰你日常的Chrome）打开它，
把页面正文当资料附给Claude。Claude本身仍然一个工具都不开，三把锁不变。

- **只读白名单里的域名**：`made-in-china.com`、`vemic.com`（含子域）。别的网址原样告诉Claude「不在白名单」，它会如实说读不到。白名单在桥里，不在页面上 —— 页面是公网静态页，谁都能改它发来的东西。
- **每次最多3个网址、每页正文最多1.2万字**。主搜结果页101张卡约1.8万字，截到1.2万够答。
- **Chrome是带窗口的**，第一次读网页时会弹出来，之后一直开着复用。可以最小化，别关；关了下次读会再起。用 `--headless` 起同样参数MIC直接回Forbidden，所以不能无头。
- **机器上不开调试端口**：桥用 `--remote-debugging-pipe` 走管道跟Chrome说话，别的程序接不进来。
- **没有网址就不碰Chrome**：不带网址的问题跟1.0完全一样。
- 为什么不是让Claude自己开浏览器（chrome-devtools MCP）：实测101张卡的无障碍快照太大被存成文件，Claude没有读文件的工具，只能回头要 `evaluate_script`，那等于放开在浏览器里跑任意脚本。桥自己取正文，少两三轮往返，锁也不用松。
- 为什么不是WebFetch：MIC搜索页对非浏览器请求一律404或跳验证码，只认真Chrome。

## 拉起终端（1.3.0起）

向导填完之后，页面给三条路。前两条拉起的是**完整的Claude Code**——有工具、有MCP、有钩子、有CLAUDE.md、有mic-fullstack那套技能和门。
跟页面内问答不是一回事：那条路是`claude -p`加三把锁，只会读题回答。

- **打开系统终端**：桥在临时目录写一个跑完自删的`.command`，用`open -a`交给iTerm或终端。装了iTerm优先用iTerm。
- **在页面里开终端**：桥用node-pty起一个常驻会话，WebSocket把字节流转给页面里的xterm.js。
  - 要两个可选依赖（`node-pty`、`ws`），`install.sh`会装。装不上不阻断——桥照样起，页面把这条标成不可用。node-pty带N-API prebuild，不用编译器。
  - **收起≠结束**：关掉抽屉只断页面这一头，Claude还在跑，30分钟内回来能接上（页面上有「接回正在跑的那个终端」）。
  - **桥重启会带走它**：它是桥的子进程。重跑安装命令、改设置、重启电脑都会中断。长任务用系统终端。
  - 图片显示不了（xterm不支持iTerm2的图片协议）；`Cmd+W`/`Cmd+T`会被浏览器抢走。

### 任务单落在哪

`~/UW工作区/<日期-任务名>/task.md`。向导问出来的内容、检索到的资料清单、要交出什么、建议用哪些能力，都在里面；
末尾留了一节「收尾写回」，干完填一下，下一轮同类任务的向导要靠它。

🔴 **Claude的cwd是`~/UW工作区`本身，不是任务子目录**。因为Claude Code对每个没见过的目录都会弹一次
`Is this a project you trust?`，而且默认高亮在`No, exit`上——一个任务一个cwd就等于每次接力都先给人一个英文安全问题，回车就退出。
cwd固定成同一个，就只在第一次问一次。（另一条路是桥去改`~/.claude.json`的`hasTrustDialogAccepted`把它预设成已信任，那是替人点掉一个安全确认，不做。）

WebSocket那一跳的鉴权跟foder不一样，**照抄它的必403**：foder Studio的页面是本地服务器自己发的、同源，
所以它要求`Origin`必须等于`127.0.0.1:<port>`；UW的页面在公网GitHub Pages，天生不同源。
这里换成「回环socket＋来源白名单＋一次性票」，票在HTTP那一跳发（那跳有CORS把着），30秒内用掉、用完即删。

线上主搜结果页的正确地址形式是 `/products-search/hot-china-products/<词>.html`；`productSearch?word=` / `?keyword=` 对未登录的新浏览器返回「信息不可用」页，不是被拦，是入口不对。

## 文件

```
bridge/
  uw-bridge.js   桥的主程序（零依赖，Node 18+；读网页要电脑上装了 Google Chrome）
  install.sh     安装 / --status / --uninstall
  README.md      这份
```

页面那一半在 `build/patch-ai.py`（搜「本机桥」）：页面打开时先请求一次 `/health` 看桥在不在，
在就把模型列表顶上加一项并默认选中；设置弹层里有装法和「这台电脑改用智谱」开关。验证脚本是 `_verify/bridge.js`。

## 已验证与未验证

- ✅ Chrome 152：公网https页面调本机http服务，允许通过，没有弹出任何授权提示（2026-09-08实测，无头 / 有窗口都过）
- ✅ FCF启动器会先往标准输出打一段文字横幅，桥只解析以 `{` 开头的行
- ⚪ Safari未测。同事用Safari的话这条路可能走不通，页面会照常退回共享通道
- ⚪ Windows未做（开机自启用的launchd是macOS的；桥的主程序是跨平台的Node）
