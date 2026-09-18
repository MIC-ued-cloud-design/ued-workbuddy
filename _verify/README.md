# UED WorkBuddy · 验证脚本

改完 `../index.html`（就是发布到线上的那一份）跑这些，截图落在 `out/`。

```bash
cd "~/Desktop/UED workbuddy/_verify"
node wb-check.js out          # 主检查：启动非空 / 场景切换 / 模板填充 / 模型浮层 / 案例标题行数 /
                            #        资料库三栏 / toast 已移除 / JS 错误
node three.js out             # + 的两级菜单：4 个二级菜单的行内重叠 / 行间重叠 / 行被压扁
node upload.js out            # 附件标签 + hover 图片预览（用 test-shot.png / test-doc.txt）
node align2.js              # 资料库表格各列垂直对齐（用 Range 量真实内容，不是量 td）
node overlap.js             # 二级菜单标题/描述重叠专项
node mpop-overlap.js        # 模型下拉每行「名字 / 标签 / 说明 / 勾」四段互不压字、不被裁（拦截 /health 伪装桥已连上，桥那一行才会出现；可传旧版 html 路径做对照）
node swatch-top.js          # 视觉规范·颜色 29 张色卡：色块必须贴卡片顶边、通宽（button 在等高网格里会把内容垂直居中，色块下坠 10px）
node bridge-web-page.js     # 读网页 + 桥新旧·页面侧（23项）：假桥 17398 模拟三种桥（同版本 / 1.1.0 / 1.0.0），查 urls 抽取 / 读取中状态 / 「读了 N 个网页」/ 没读到的列出
                            #    + 🆕 页面里的目标版本号 = bridge/uw-bridge.js 的 VERSION（构建注入）/ 新桥不误报 / 旧桥：首次提示 + 设置里版本差 + 缺的功能 + 可复制命令 + 再探不给假绿 / 终端弹层「复制升级命令」
                            #    🔴 改了 bridge/uw-bridge.js 的 VERSION 要重跑 build/patch-ai.py，否则页面还认旧号（这条门会红）
                            #    桥侧（真 Chrome 真 Claude）：UW_BRIDGE_PORT=17399 node bridge/uw-bridge.js --dev 后按 bridge/README「读网页」五条逐项 curl；2026-09-09 五项全过
node mobile.js out          # 移动端：三种屏宽 × 12 组检查 + 桌面回归（改过版式就跑它）
node bridge.js out          # 🆕 本机桥：三把锁（只监听本机 127.0.0.1 / 只认 UW 来源 / Claude 关工具）+ 线上真页面→127.0.0.1 允许通过
                            #    + 页面↔桥↔Claude 真问一句 + 设置开关来回 + 桥停掉后退回共享通道。会真跑 3 次 Claude。
                            #    🔴 端口 17331 得是空的：装了桥的机器先 launchctl bootout gui/$(id -u)/com.ued.uw-bridge
node wiz-kb.js              # 🆕 18张卡的检索词体检：55条auto查询必须真命中，
                            #    而且写了 want 的必须命中**那一份**文档（只查段数=只知道有东西、
                            #    不知道是对的东西）＋每张卡结构完整（≥3步/≥3交付物/有能力清单）
                            #    可只跑一个场景：node wiz-kb.js research
node terminal.js out        # 🆕 接力到终端（41项）：桥能力/向导收尾按钮/三条路的文案与灰态/
                            #    页面内终端真ws真pty真xterm（跑bash不烧token）/敲命令有回显/
                            #    粘任务单不被拆/收起≠结束/接回去/结束/桥不在时灰掉/JS错误
                            #    🔴 端口17331得空：launchctl bootout gui/$(id -u)/com.ued.uw-bridge
                            #       跑完 launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.ued.uw-bridge.plist
node wizard.js out          # 🆕 向导层视觉（现在量的是index.html，向导已上线）：圆角统一 / 对比度 / 飞鹊真值对齐 /
                            #    勾是不是 yes2.svg / focus 无投影+有渐变 / class 撞名后果 / JS 错误
                            #    🔴 改过 build/patch-wizard.py 就跑它 —— 吉吉三轮走查（太淡/错位/
                            #    圆角不统一）全是肉眼发现的，这三类本来都可量

# 脱网三项（外部请求 / JS 错误 / 断图）
node ~/.claude/skills/mic-fullstack/scripts/online-reach/clone-offline-check.js \
  --file "../index.html"
```

## 这些探针为什么长这样

这一版里出现过6次「探针报绿、肉眼看红」，每次都是**量错了对象**：

| 现象 | 探针错在哪 | 现在怎么量 |
|---|---|---|
| 页面空白 | 脱网门只查抛错/请求/断图 | 加「启动非空」：导航项数 + main字符数 |
| 表格错位 | 选择器fallback到 `td`，量成单元格中心 | 用 `Range.selectNodeContents` 量真实内容 |
| 第二栏占位 | 只查 `hidden` 属性是true | 量 `getBoundingClientRect().width === 0` |
| 图标间距0 | 只查CSS里的 `gap` 值 | 量两个svg之间的实际像素 |
| 菜单重叠 | `querySelectorAll` 抓了隐藏元素（几何全0） | 先筛 `display !== 'none'` |
| 菜单行压扁 | 只查行内重叠，没查行间 | 加行间重叠 + `scrollHeight > height` |

**判据：探针给出0 / 100% / 完全一致这类漂亮数字时，先标定仪器再信数字。** 每次改完都要探针 + 截图两道。


## mobile.js查什么（改过index.html的版式就要跑）

三种屏宽各跑一遍：iPhone 14（390）· 常见安卓（360）· iPhone SE（320），
最后再用1440跑一遍桌面回归 —— 移动端层是纯覆盖，**最容易的翻车方式是把桌面版改坏了没发现**。

每种屏宽12组：顶栏与标题 / 左栏收起 / 主区占满 / 横向溢出（每换一页都量一次）/
抽屉开合与遮罩关闭 / 输入控件字号 ≥16px / 点击区 ≥34px / 场景tab单行横滑 /
+ 菜单与二级菜单（点击展开，不是hover）/ 模型浮层在屏内 / 资料库第二栏不占位 +
表格摊成卡片 / 详情页返回路径 / 设置弹层在屏内 / 回答区版式 / 最小字号 / JS错误。

### 🔴 这道门自己踩过一次（第7次「仪器自己是bug」）

第一版用 `p.click('.wbm-scrim')` 关抽屉。puppeteer点的是**元素中心**，
而遮罩铺满全屏、中心恰好落在抽屉里 —— 点下去命中的是抽屉本体，抽屉根本没关。
抽屉没关，后面每一次点击都被遮罩吃掉，于是连报三条假失败：
「遮罩点击没关掉抽屉」「+ 菜单没打开」「设置弹层没打开」，三种屏宽共9条。
代码其实全是对的。

**两条判据**：
1. 点覆盖全屏的元素要点**真人会点的坐标**（`p.mouse.click(w-20, h/2)`），不要用选择器让工具自己挑中心。
2. 每一组点击检查之前先断言「上一个浮层/抽屉已经关了」——
   否则报出来的失败原因会被上一步污染，你会去查一个不存在的bug。

同一批还修了 `overlap.js`：第27行把 `${OUTDIR}` 写在单引号里，
模板变量没求值，这道门**一直是抛错状态**，等于没在跑。


## 删掉的门

**`gap2.js`（2026-09-08删）** —— 它量的是左下角铃铛和键盘两个图标之间的真实像素间距。
那两个图标是假的（没绑任何事件），吉吉让删，删完这道门就没有量的对象了。

**删门而不是留着让它红**：一道永远红的门，红几次之后就没人看了，
连带旁边真的红也会被一起忽略。守的东西没了就把门撤掉，在这里记一笔为什么。
（它当初解决的问题——「只查CSS里的gap值，不查两个图标之间的实际像素」——
仍然是有效的判据，换个地方还会用上。）
