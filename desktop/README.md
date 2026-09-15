# UED WorkBuddy桌面版（原型 · 2026-09-10）

给产品、设计、前端共用的AI工作台。**引擎是同事自己电脑里的Claude Code**（席位、代理、上报都跟平时敲 `claude` 一样），飞鹊设计系统随应用携带，产物落成文件、右侧实时预览，做完一键发给前端。

## 跑起来

```bash
cd desktop
npm install            # 只有 electron 一个依赖
npm start
```

如果Electron二进制下载失败（公司代理直连GitHub会被掐），用国内镜像补一次：

```bash
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" node node_modules/electron/install.js
```

前提：这台电脑上装了Claude Code并登录过（终端里能敲 `claude`）。应用按这个顺序找：`~/.fcf/bin/claude`（公司FCF启动器，优先）→ `~/.local/bin` → Homebrew → nvm。

## 结构

```
desktop/
├─ main/
│  ├─ main.js       Electron 主进程：窗口、项目文件夹、IPC、uwproj:// 预览协议
│  ├─ engine.js     引擎：一个项目一个常驻 `claude -p` 进程，stream-json 双向，权限请求走 host
│  ├─ handoff.js    发给前端：交付包 + zip + git 分支（配了 origin 就 push 并给 MR 链接）+ 给前端的话
│  └─ preload.js    渲染进程能用的 API（contextBridge）
├─ renderer/        界面（不依赖框架）：首页（角色 → 六大类场景卡 → 能力）· 工作区（左对话右预览）· 设置
├─ packs/
│  ├─ feique/       飞鹊设计系统包：DESIGN.md 速查 + tokens.json + 295 个 SVG 图标 + 组件清册 + 规范全文
│  ├─ kb/           部门知识库（线上 UW 同一份 kb.js，494 份文档 7315 段）+ 检索代码，向导第一步用它做实时检索
│  ├─ wizards.json  18 张场景卡的选项式向导（分步问题 / 任务单产出 / 要跑的检索），从线上 UW 的 patch-wizard.py 原样抽出
│  └─ capabilities.json  能力清单：角色 / 六大类 18 张场景卡 / 6 个随时可用的能力。加能力 = 加一条记录
└─ build/           应用图标（icon.icns / icon.png）
```

数据都在 `~/UW工作区/`：每个项目一个文件夹（元数据在 `.uw/project.json`，含Claude会话id，可续聊）；交付包落在 `_交付/`，交付仓库默认 `_交付仓库/`。设置在 `~/.uw-desktop/settings.json`。

## Claude是怎么接的（实测判据）

```
claude -p --input-format stream-json --output-format stream-json --verbose \
  --include-partial-messages --permission-mode acceptEdits --permission-prompt-tool stdio \
  --add-dir <packs/feique> <~/.claude/skills> --append-system-prompt <一段 UW 上下文> --session-id <uuid>
```

- **不加任何锁**：skill / MCP / hooks / CLAUDE.md / memory全在。这就是「终端里的Claude能力都有」。
- **权限**：必须带 `--permission-prompt-tool stdio`，而且进程一起来就先写一条 `initialize` 的 `control_request`，之后Claude每次要动手都会发 `can_use_tool`，应用弹卡让人点「允许 / 拒绝 / 本次任务全部放行」。少了握手Claude会直接 `permission_denied`。三档：每步都问 / 改文件自动放行跑命令问（默认）/ 全部放行。
- **FCF启动器**会先往stdout打彩色横幅，只认以 `{` 开头的行。
- 续聊：进程常驻，同一个stdin继续写user消息；关掉应用再打开，用 `--resume <session_id>` 接上。

## 首页与向导

首页 = 角色分段 → 六大类分段 → 场景胶囊 → 大输入框。点一个胶囊会弹出这张卡的向导（3到4步问题、右侧任务单、顶部知识库实时检索）；填完点「让Claude开始」，向导把已定项、待定项、要交出什么、知识库查到的段落拼成一段话，连同你的补充一起交给Claude开新项目。不想走向导就点「跳过向导，直接写需求」，输入框直接发也行（不选胶囊就是自由任务）。

## 打包分发

```bash
npm run dist          # 产出 dist/UED-WorkBuddy-<版本>-{arm64,x64}.{dmg,zip}
```

没有苹果开发者证书，`build/afterPack.js` 会打一个本机临时签名，同事首次打开要右键「打开」或在系统设置里「仍要打开」一次。飞鹊包、知识库、向导数据按 `asarUnpack` 解在 `app.asar.unpacked/packs/`，因为拉起的Claude是外部进程，读不到asar里的文件。同事版安装步骤见 `安装说明.md`。

## 一键发给前端做了什么

1. 把项目里的产物（跳过 `.uw` / `.git` / `node_modules`）复制到 `~/UW工作区/_交付/<时间>-<项目>/`，加 `manifest.json`，`ditto` 打成zip。
2. 在交付仓库开分支 `handoff/<时间>-<项目>`，把包放进 `<项目>/`，提交；仓库有origin就push并生成合并请求链接（GitLab / GitHub两种）。
3. 生成「给前端的话」（入口文件、交付说明、分支或链接、怎么用UED WorkBuddy接收）放进剪贴板，直接粘到飞书。
4. 前端在同一个应用里选「前端 → 接收交付包并还原」，Claude读 `交付说明.md` 落成组件代码。

项目里没有 `交付说明.md` 时会先提示「先整理交付说明」，那是一条能力卡，Claude会把页面结构、状态清单、token对照、交互决策的为什么写全。

## grill-me与CE怎么进来的

都是「随时可用的能力」里的一张卡：一段提示词让Claude用Skill工具调用 `grilling` / `compound-engineering:ce-*`，没装就按同样思路做。所以往后部门小组写的skill，接进来的成本就是往 `capabilities.json` 加一条记录。

## 已知边界

- 只在macOS上试过；Windows的终端拉起和zip要另写。
- 没打安装包、没签名。要分发得加electron-builder和开发者证书，否则同事首次要右键打开。
- 每个新任务Claude会先读飞鹊包和相关skill，首稿通常3到12分钟，取决于它读多少资料。
