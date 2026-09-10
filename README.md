# UED WorkBuddy

UED部门的AI设计工作台。

**在线打开**：https://mic-ued-cloud-design.github.io/ued-workbuddy/

## 这个页面能做什么

**查资料，不用配置，打开就能用。** 飞鹊组件的真实名称、状态数量和import用的key（Web端97个、移动端72个）、
295个图标、颜色与字号与阴影的规范值、Figma样式ID、UED交互自查表137条、
八条业务线现有哪些文档、做过的项目留下的259份判断。这些都是真实数据，从技能库直接生成，不是示意内容。

**回答问题，需要先连一个模型。** 页面里装了482份文档、7000多段内容。
提问的时候页面先从里面找出最相关的几段，再交给模型组织成答案，答完会列出参考了哪些文档。
模型用的是你自己的密钥，存在你这台电脑的浏览器里，不上传、不共享。
智谱的GLM-4-Flash官方标注免费，在open.bigmodel.cn注册后新建一个密钥即可；
也可以换成硅基流动、DeepSeek，或者填任何OpenAI兼容的接口。

能问的是这一类：某条业务线现在的规则是什么、买家在这一步的主要问题和占比、
飞鹊的某个组件叫什么有几个状态、正文字号最大能用多少、
帮我写一张GSSM设计目标表、出视觉稿之前要枚举哪些状态、交付给前端要检查什么。

## 这个页面做不到什么

写不进Figma、跑不了脚本、打不开线上页面、导不出文件。这些要在自己电脑的Claude Code里装
`mic-fullstack` 技能来做，页面的「技能与规范」那一页有安装步骤。
走默认的部门共享通道时，问答用的是免费的小模型（智谱GLM-4-Flash），判断力和出稿质量跟Claude不在一个档，
它的作用是帮你把问题想清楚、把已有的知识找出来。装了下面的「本机桥」之后走的是你自己电脑上的Claude Opus 5，
这一条就不适用了。

答案里的引用可能不准，回答之前请对着列出的参考文档核一眼。

## 文件

| | |
|---|---|
| `index.html` | 页面本体。资料库的数据内嵌在里面，双击就能打开，不联网也能查资料 |
| `kb.js` | 供模型检索的知识库正文（7.2 MB）。只在你第一次提问时才加载，不影响打开速度 |
| `manifest.json` `icon-*.png` | 「添加到主屏幕」用的。存到手机主屏之后点开没有地址栏，跟App一样 |
| `build/` | 生成上面几个文件的脚本 |
| `bridge/` | 「本机桥」：让页面用你电脑上的Claude Code来回答。装法、三把锁、验证范围见 `bridge/README.md` |

手机上直接打开同一个网址就能用 —— 版面会自己换成手机版（左栏收成抽屉、宽表格摊成卡片、
悬停出现的菜单改成点击）。**页面只有这一份，手机和电脑看到的内容永远一致。**

## 用你电脑上的Claude Code来回答（本机桥）

页面默认走部门共享的智谱通道。电脑上装了Claude Code的同事，在终端粘 `bridge/README.md` 里那一行装一次「本机桥」，
之后这个页面的问答就走他自己电脑上的Claude Code：模型强、用自己的席位、对外联网仍然经过公司的FCF。
桥不在（或在手机上）时页面自动退回智谱，什么都不用配。

## 怎么更新

页面里的数据**不要手改** —— 它是从 `mic-fullstack` 技能库生成的，技能库才是正本。
技能库更新之后重跑生成脚本：

```bash
python3 build/gen-data.py    # 组件清册 / token / 自查表 / 目录 → 写进 index.html
python3 build/gen-kb.py      # 业务知识与方法论正文 → 写成 kb.js
python3 build/patch-ui.py    # 资料库界面
python3 build/patch-ai.py    # 检索与模型接入
python3 build/patch-terminal.py # 接力到终端（两条路）—— 要在 patch-wizard 之前
python3 build/patch-wizard.py  # 选项式向导（18 张卡）
python3 build/patch-mobile.py # 手机版版面 —— 必须最后跑
python3 build/secret-check.py # 提交前扫一遍有没有混进密钥
node _verify/bridge.js out     # 动过模型接入或 bridge/ 就跑：三把锁 + 页面↔桥↔Claude 全程 + 桥不在时的退回
git commit -am "说明这次改了什么" && git push
```

界面代码改 `build/patch-*.py` 里的CSS与JS，
不要直接改 `index.html` 里标记之间的内容 —— 重跑脚本会覆盖掉。

**全站只有一套视觉token**，定义在 `index.html` 开头 `<style>` 里的 `:root`
（2026-09-09换成apple.com那套：文字 `#1D1D1F/#6E6E73/#86868B`、底 `#F5F5F7/#E8E8ED`、
分隔 `#D2D2D7`、主色 `#0071E3`；圆角 `--r-xs 4 / --ctl-r 8 / --box-r 12 / --r-lg 18 / --r-pill`）。
各层CSS只准引用这些变量，不准自己写颜色和圆角数字 —— `patch-terminal.py` 和 `patch-wizard.py`
的圆角门会拦硬编码。要换主题只改 `:root` 那一处。

飞书登录（`build/_弃-patch-auth.py` + `proxy/`）和左栏的任务历史2026-09-09已下线，页面不再有登录入口。
每个脚本只替换自己那对标记之间的内容，互不干扰。
**只有一条顺序要求：`patch-mobile.py` 最后跑** —— 它的CSS靠「同优先级后来者胜」
覆盖前面所有区，位置被挤到中间就会失效。

推送之后GitHub Pages约一分钟自动更新。
