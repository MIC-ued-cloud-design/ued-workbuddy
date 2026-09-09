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

## 读网页（1.1.0 起）

问题里带了网址，桥会用一个**独立的 Chrome**（独立 profile `~/.uw-bridge/chrome-profile`，不碰你日常的 Chrome）打开它，
把页面正文当资料附给 Claude。Claude 本身仍然一个工具都不开，三把锁不变。

- **只读白名单里的域名**：`made-in-china.com`、`vemic.com`（含子域）。别的网址原样告诉 Claude「不在白名单」，它会如实说读不到。白名单在桥里，不在页面上 —— 页面是公网静态页，谁都能改它发来的东西。
- **每次最多 3 个网址、每页正文最多 1.2 万字**。主搜结果页 101 张卡约 1.8 万字，截到 1.2 万够答。
- **Chrome 是带窗口的**，第一次读网页时会弹出来，之后一直开着复用。可以最小化，别关；关了下次读会再起。用 `--headless` 起同样参数 MIC 直接回 Forbidden，所以不能无头。
- **机器上不开调试端口**：桥用 `--remote-debugging-pipe` 走管道跟 Chrome 说话，别的程序接不进来。
- **没有网址就不碰 Chrome**：不带网址的问题跟 1.0 完全一样。
- 为什么不是让 Claude 自己开浏览器（chrome-devtools MCP）：实测 101 张卡的无障碍快照太大被存成文件，Claude 没有读文件的工具，只能回头要 `evaluate_script`，那等于放开在浏览器里跑任意脚本。桥自己取正文，少两三轮往返，锁也不用松。
- 为什么不是 WebFetch：MIC 搜索页对非浏览器请求一律 404 或跳验证码，只认真 Chrome。

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
