# 飞鹊组件 · 用法清册（从 Figma 读出来的真值）

**飞鹊最准的源头是 Figma 文件本身**，这份是从组件库里逐页读出来的：
每个组件的 key、节点号、尺寸、**全部 variant 维度**、以及设计师写的组件说明。

## 先读这三条

1. 🔴 **props / variant 是机器读的，永远以它为准；description 是人写的，会过时。**
   实例：`header-home` 的说明写「断点 768/1024/1280/1366/1440」，而实际 props 是
   「1024/1280/1366/1440/**1920**」—— 说明少了 1920、多了个已经不存在的 768。
   还有一些组件的 description 只是占位（形如 `fd_<组件名>`），等于没有说明。
2. 🔴 **组件库页名里的符号：`✅` 和 `🤖` 都表示「已做完」，`❌` 表示「不需要做」**，
   不是「没做」。别因为看到 ❌ 就以为不能用。
3. 🔴 **这里列的是「有什么、什么规格」，不是「能直接抄的代码」。**
   要真资产（页脚、产品卡、认证标的 SVG）得去 Figma 导，四步在文末。

## 组件

### 页头页脚（8）

- **header-home**  `4027x1062`  SET · 10 个 variant
  - variant：pageType(home/search-result) × breakpoint(1024/1280/1366/1440/1920)
  - MIC 首页页头 — 响应式组件集。<1280(1024)：移动堆叠 header h=167，logo 整行 + middle 横排(categories+search+actions)；>=1280：桌面单行 header h=123，logo 218 + middle(search+actions 489)。响应式公式：1280 search-bar 513/common 1240(贴边20) · 1366 search-bar 599/common 1326 · 1440 search-bar 673/common 1400。⚠️说明里写的断点是 768/1024/1280/1366/1440，实际 props 是 1024/1280/1366/1440/1920 —— 以 props 为准
  - `key a168336023dc8795873a6627825cd89a9a492e07` · `node 5920:3448`
- **footer-home**  `1520x2356`  SET · 4 个 variant
  - variant：breakpoint(1440/1366/1280/1024)
  - `key 376bc4609d45779c42f5c6772e7477578d346f3c` · `node 6070:1174`
- **MIC Footer Search / 搜索结果页脚**  `1488x1316`  SET · 4 个 variant
  - variant：breakpoint(1440/1366/1280/1024)
  - 4 个断点各高 280/280/280/316
  - `key 82a1826d2b2f416e3e84d67ff7989cf5b2522cfe` · `node 6173:1330`
  - 🔴 **已有网页实现，别自己拼**：`cat docs/blocks/mic-footer-search.html`（已对过真值 95 项·一套 flex-wrap 覆盖四档）
- **MIC Footer Product / 产品详情页脚**  `1488x1027`  SET · 4 个 variant
  - variant：breakpoint(1440/1366/1280/1024)
  - 4 个断点各高 205/205/205/241
  - 🔴 **2026-09-15 补录** —— 这个组件原来整条不在清册里（footer 族只收了 footer-home / Footer Search / footer-activity）
  - 🔴 **已有网页实现，别自己拼**：`cat docs/blocks/mic-footer-product.html`（已对过真值 64 项）
  - 🔴 分隔竖线 **#555555**，跟 Footer Search 的 #CED3D9 不一样；链接清单也不同（这里有 English，那边没有）
  - `node 6181:1549`
- **footer-activity**  `1440x169`  单组件
  - 活动搜索页脚·自适应单组件(拖宽即可适配任意 viewport)。结构 2 group(group1 6 link；group2 row1 Privacy/Declaration/User Agreement + row2 Copyright 含蓝 Focus link)。height 169 = pt30+g1(18)+20+g2(41)+pb40。font 全 12 · link text/main #555 · Focus Technology 用 primary/supplier 蓝 · bg background/background 01 #F5F7FA
  - `key 6a98eb240195a4443388086e660609c7d05c10f0` · `node 6187:1342`
- **header-simple**  `1520x540`  SET · 4 个 variant
  - variant：breakpoint(1440/1366/1280/1024)
  - `key fd00dd16f7a7ec10496216fac0b232d19118770d` · `node 6800:1440`
- **header-activity**  `1488x388`  SET · 3 个 variant
  - variant：breakpoint(768/1024/1440)
  - `key 1e0be819ae6ebcf30742e8e33fc4f968d292e627` · `node 5938:1059`
- **footer-mlan**  `1488x1065`  SET · 4 个 variant
  - variant：breakpoint(1440/1366/1280/1024)
  - 多语版页脚
  - `key 5fd4fc78b2bbff7748d00744258b918558eaca3c` · `node 6191:1547`
- **header-mlan（西语示例）**  `1517x692`  SET · 4 个 variant
  - variant：breakpoint(1280/1366/1440/1024)
  - 多语版页头
  - `key 986de30bb85133aea614d51ae529b8e4a1c712b3` · `node 5920:4083`

### 供应商列表（8）

- **标杆工厂产品列表/w**  `1130x382`  单组件
  - 标杆工厂卡片 1130×374 固定。圆角4 + dividing line/list 边框。(1)header 1130×75 渐变 #F5F7FA→#FFF，内嵌 com-header/w；(2)com-content 1130×299 padding 20/20/10/10 gap10，含 com-capabilities/w + 2×prod-item/w + prod-video/w。颜色全绑 Paint Style。字号 12/14/16（Web 端禁用 10px）
  - `key cefc953b161251be785b100e3c01118acd2abbcf` · `node 6501:593`
- **QF供应商列表/w**  `1170x410`  单组件
  - QF(Qualified Factory)供应商列表卡，1130 宽 HUG 高。com-title(logo60+公司名 body/xl_bold+audited brand+年份+business-type+chevron+Send Inquiry secondary/large/red/round) + com-content(4×prod-item/w 160 + 1×qf-prod-video/w 294，SPACE_BETWEEN)
  - `key 764ca1200b8580e175d30e88756c025c24432473` · `node 6623:990`
- **一级目录供应商列表/w**  `1138x326`  单组件
  - 一级目录页 Supplier List，1130 宽 HUG 高 VERTICAL。上 company-logo-wrap(logo80×80+公司名 body/xl_bold+Audited 标识+Follow 按钮) + 下 HORIZONTAL(左 company-info 4 行 tr-box + Contact Now 红边圆角含 mail icon + Chat 蓝 link；右 3×prod-item/w 160 显示完整 price+moq + 1×prod-video/w 280×256)
  - `key ced430cb8783685a320293fac5dfb1cdc8dbbc08` · `node 6672:1158`
- **二级目录供应商列表/w**  `928x254`  单组件
  - 二级目录页 Supplier List，1130 宽 HUG 高 HORIZONTAL。左 company-info FILL(公司名 body/xl_bold + Audited 标识 + 3 行 key:value：Business Type/Main Products/City-Province + Contact Now 红边圆角 + Chat with Supplier 蓝 link)；右 3×prod-item/w size=default（隐藏 price/moq，prod-name 3 行 truncate）
  - `key 67ed0624345165d5eef01470ef8f3b7a3742293b` · `node 6645:1038`
- **prod-item/w**  `468x354`  SET · 2 个 variant
  - variant：size(default/large)
  - 产品卡子组件。size=default(160宽，标杆工厂 2 列用) / large(178宽，QF 4 列用)。结构 prod-pic 1:1 占位 + prod-info VERTICAL paddingTop8：prod-name body/base 2 行 truncate + prod-price body/lg_bold + prod-moq footnote/sm text/aux
  - `key 3df7f2f28b83fa72ef792d9559ae41e2d5ad9c1c` · `node 6633:407`
- **com-capabilities/w**  `1142x240`  SET · 3 个 variant
  - variant：类型(info/detail) × verified(yes/no)
  - 公司能力区，248 宽 HUG 高。3 变体：类型=info+verified=yes(4 项 diamond-marker 列表+Verified by SGS+Sign In) / 类型=detail+verified=yes(3 项绿✓ key:value 无 SignIn) / 类型=info+verified=no(4 项 diamond 无 Verified 无 SignIn)。都含 response-time 行。diamond-marker=primary/buyer 红 5×5 rotate45；✓=function/success 绿
  - `key ed0d48d63e9685f23251171cf7bcc5a872ce5c54` · `node 6496:461`
- **com-header/w**  `1154x208`  SET · 2 个 variant
  - variant：chat状态(online/offline)
  - 公司 header，1106 宽 HUG 高。左 com-title-left(logo60×60+公司名 body/lg_bold+LeadingFactory tag 蓝+com-detail footnote/sm) + 右 com-btn(Chat link+Contact Now secondary red round+About Us link dark+chevron-right)。SPACE_BETWEEN 分边。chat状态=online 蓝 Chat / offline 灰 Chat
  - `key ce7864f6a0559bd4bcf0298d249f886338678f71` · `node 6498:623`
- **prod-video/w**  `612x311`  SET · 2 个 variant
  - variant：tabs(video-pic/pic-only)
  - 视频卡 262×259。底层 video-thumbnail 占位 + 中央 play 按钮 64×64 黑半透明圆 + 媒体-play icon 32×32 white + 底部 controls pill(黑60%圆角11)。tabs=video-pic(Video 角标 active + 1/N) / pic-only(仅 1/N)
  - `key 27e6fdb0c8017ef2b4d89dbd7d5d6d01dae6b538` · `node 6494:343`

### 搜索结果页筛选（6）

- **MIC FilterSidebar-侧边筛选栏组合**  `880x2018`  SET · 3 个 variant
  - variant：Property 1(1280～1024/1440～1280/1920～1440)
  - 整条侧边筛选栏，按视口区间给了 3 档
  - `key 004ac7b7c7735bffcc655e29171b07aa55397be1` · `node 7454:2954`
- **MIC FilterSidebar-侧边筛选栏部件**  `594x284`  SET · 7 个 variant
  - variant：Property 1(title/input-ok/price-range/checkbox-M/radio-S/brand-logos/Line 1)
  - 筛选栏的 7 种行部件：标题/输入确认/价格区间/复选/单选/品牌图标/分隔线
  - `key 42b17308b58062d9bce2cff9ad23b3e97f947ad0` · `node 7302:3095`
- **MIC FilterSidebar-more/less**  `180x62`  SET · 2 个 variant
  - variant：Property 1(Less/more)
  - 筛选项展开/收起
  - `key 25d077d2afd76bdf23b432614df83e4f8660bbbc` · `node 7454:1473`
- **filter-title**  `163x61`  SET · 2 个 variant
  - variant：Property 1(big/small)
  - 筛选分组标题两档
  - `key a3772173aca5362807a6a982865f06aabfd057eb` · `node 7330:1715`
- **MIC Header + Tab / 主搜页顶部组合**  `1488x1044`  SET · 4 个 variant
  - variant：breakpoint(1024/1280/1366/1440)
  - 主搜页顶部＝页头+Tab 的组合件
  - `key c8fe82b741eb6c6e5ff7337d9149b8ed2e7a3447` · `node 5920:4070`
- **MIC Tab Switch / 主搜页 tab**  `1488x342`  SET · 4 个 variant
  - variant：breakpoint(1024/1280/1366/1440)
  - Product List / Supplier List / Audited Factory 那排 tab
  - `key c9645ea298f9866362660b41dc1ad6b3bf852d19` · `node 5920:4037`

### 买供VO后台（8）

- **header-supplier-vo**  `1600x85`  单组件
  - VO 后台顶栏 1600×85 固定。MIC LOGO(左 240×46) + 右 m-header-menu(账户/消息/通知/询盘篮/App/语言)。菜单辅助文字 12px、账户主文字 14px、badge 18px 红底白字 12px。🔴 LOGO 保留 #DA291C 品牌红不绑 Paint Style；菜单全 12px 与 vo-nav 的 14px 区分
  - `key 3e64367d00c21eebe36c736b6e88c995a54b4d0c` · `node 7304:13374`
- **vo-supplier-nav**  `1600x40`  单组件
  - 供应商后台横向导航。bg #406080，选中 bg #284159，14px Roboto 白字
  - `key a6c0fa9cf7be300e1d6d5d91daf30f02157e1dae` · `node 7304:12782`
- **vo-supplier-sider**  `210x782`  单组件
  - 供应商后台左侧栏 210 宽。选中 bg #E6ECF2 + 文字 #222，常态 #555
  - `key f5ca29c97c3c4ddebc0dc3ffa48a9cdb9980d3d3` · `node 7304:12544`
- **header-buyer-vo**  `1600x82`  单组件
  - 买家后台顶栏 1600×82
  - `key 4675a9edae685204832a048c255895eb4bbd0f2e` · `node 7304:14104`
- **vo-buyer-nav**  `1600x42`  单组件
  - 买家后台横向导航
  - `key b0cd1d7c2a95a711f95354ba80e96873a8125348` · `node 7304:9944`
- **vo-buyer-sider**  `210x584`  单组件
  - 买家后台左侧栏 210 宽
  - `key 77080854fe9b9dbd3a9dc76d017d5cafbb2e1ec7` · `node 7304:5656`
- **vo-supplier-nav（行部件）**  `367x80`  SET · 3 个 variant
  - variant：state(default/hover/button)
  - 导航单项三态
  - `key 74e6600f90e70c2cb0456dc1e1dcdde7fd9161fd` · `node 7297:296`
- **vo-supplier-sider（行部件）**  `250x229`  SET · 3 个 variant
  - variant：state(default/hover/button)
  - 侧栏单项三态
  - `key 6d9d84db3a7991af86913021d4a1964300473bb6` · `node 7304:2515`

### 弹层与选择器（9）

- **fd_dialog box**  `1448x1196`  SET · 7 个 variant
  - variant：state(default/info/warning/success/error/自定义弹框（最大高度）/自定义弹框（最大宽度）)
  - 对话框 7 态，含两种自定义尺寸档
  - `key f3fa1a35e9fc5c3a90e7f5fef2a8770147041bea` · `node 2274:6785`
- **popover**  `2572x421`  SET · 24 个 variant
  - variant：placement(bottom/bottom left/bottom right/top/top left/top right/left/left top/left bottom/right/right top/right bottom) × close(yes) × color(dark/light)
  - 气泡卡片。12 个方位 × 明暗两色。挑方位别自己写箭头
  - `key e3dcbf4ecf3cd48ae9d11771d94c194e8d90fc57` · `node 2519:533`
- **date picker input / basic**  `1732x1380`  SET · 108 个 variant
  - variant：status(default/warning/error) × size(default/small/large) × state(default/hover/focused/selected/filled/disabled) × range(false/true)
  - 日期输入框，四维 108 个组合（状态×尺寸×交互态×是否区间）
  - `key db5ed2ac7821f6414b52400d21adef0357885fe3` · `node 3083:5205`
- **date picker menu**  `998x2230`  SET · 10 个 variant
  - variant：type(day/date and time/time/month/year/quarter) × range(false/true)
  - 日期面板 6 种粒度 × 是否区间
  - `key 7d0abdaa639d7824b992fef50c71b327cbe096c8` · `node 3623:7317`
- **datepicker input / borderless**  `1169x520`  SET · 18 个 variant
  - variant：size(small/default/large) × state(default/focused/filled) × range(false/true)
  - 无边框日期输入
  - `key fbf7dc8214ed2366ccf6c0bd86888b555b676e5a` · `node 3126:6962`
- **date picker**  `954x583`  SET · 6 个 variant
  - variant：qctive(yes/no) × size(default/large/small)
  - 日期选择器整体
  - `key e2cc9445974ab9a7b6e35b1c493f17e67afa9943` · `node 3623:11161`
- **date picker / menu item**  `64x240`  SET · 5 个 variant
  - variant：state(default/inactive/hover/current/selected)
  - 日历单元格五态
  - `key 8d287d3635e5e3a9bd064a2e749ca843e68d7a37` · `node 3023:10105`
- **time picker menu cell**  `88x164`  SET · 3 个 variant
  - variant：state(default/hover/selected)
  - 时间列单元格三态
  - `key c242fe4caf878e9b598ff5fdd40cac2a1949a40a` · `node 3023:10106`
- **close**  `100x60`  SET · 2 个 variant
  - variant：state(default/hover)
  - 弹层关闭按钮两态
  - `key b0a2dd3be39281d78dc69be68d1431868b850855` · `node 2267:4139`

### 表单（9）

- **form**  `1500x3694`  SET · 10 个 variant
  - variant：type(vertical states/horizontal states/inline/login/registration/disabled/size variants/advanced search/step form/dynamic fields)
  - 整表单，10 种场景：vertical/horizontal states(6/5 态+按钮区) · inline(多项横排+搜索按钮) · login(紧凑+全宽登录按钮) · registration(供应商注册，含 Input/Select/DatePicker/Textarea/Radio/Switch/Checkbox/Upload) · disabled(全禁用) · size variants(40/32/24 三档) · dynamic fields(动态增删行) · advanced search(多列网格+折叠) · step form(分步向导+步骤条)。间距：项间 16 · padding 24 · 按钮间 12 · 圆角 8。主按钮 #E64545，禁用 40% 透明
  - `key ebebc54dd8d1504526e9eececcceeeb2a6aed81c` · `node 3423:9157`
- **form item vertical**  `1200x578`  SET · 12 个 variant
  - variant：state(default/error/warning/success/validating/disabled) × required(true/false)
  - 垂直表单项＝Label + Input + [Message]。error 红框红 caption · warning 黄 · success 绿框+Verification passed. · validating 正常框+蓝 Validating... · disabled label 灰化。间距 label→input 4px，input→message 4px
  - `key f4c8648d032479244ddc2308eacdaf3c4672581d` · `node 3417:7486`
- **form item horizontal**  `1428x612`  SET · 12 个 variant
  - variant：state(default/error/warning/success/validating/disabled) × required(true/false)
  - 水平表单项＝Label(左) + Control(Input+Message，右 FILL)。状态同垂直版。间距 label→control 16px，input→message 4px
  - `key d722cc9cb4f482c142aa7c34d6774d68f663fb66` · `node 3418:7649`
- **form / basic**  `2157x1300`  SET · 3 个 variant
  - variant：size(default/small/large)
  - 水平布局表单，18 行，含 input/password/pre-post tab(Phone+86 / Currency$)/textarea/select/date picker/time picker/inputNumber/switch/button/rate/upload drag/radio group/checkbox group/Add Field dashed/Agreement/Actions。下拉面板默认 hidden，展开时向下推。行间距 24 · 标签右对齐 · paddingLeft 16(容纳*号)
  - `key 96cd5c7ba78beaf95c0817f353b0af4231c4289a` · `node 3616:15158`
- **form/vertical**  `1320x1750`  SET · 3 个 variant
  - variant：size(default/small/large)
  - 垂直布局表单，标签在上输入在下，15 种控件 + Add Field + Agreement + Actions。select 用 select input
  - `key f52f1463c298158be1615850a9d1e695c093aba8` · `node 3662:12737`
- **form/inline**  `1829x336`  SET · 3 个 variant
  - variant：size(default/small/large)
  - 行内表单，单行水平：2 个 form item + Checkbox + Actions。用于筛选栏、搜索条件、简单查询
  - `key a61f050abe6f0347e17025ff8114bf24f3b70bdb` · `node 3645:9787`
- **form item / validation**  `1740x246`  SET · 4 个 variant
  - variant：status(default/error/warning/success)
  - 表单验证提示四态：default 灰提示 · error 红框+灰提示+红报错 · warning 黄框+黄警告 · success 正常框+灰提示
  - `key 50a3e7c05146b82d55cdc50c4ff4c46fd7ccac4f` · `node 3677:7588`
- **form item / <控件>（14 个同构组件）**  `580x296`  SET · 3 个 variant
  - variant：size(default/small/large)
  - 水平标签表单项的控件族，每个都是 size=default/small/large 三档：input · password · phone · textarea · select · datepicker · timepicker · inputnumber · switch · button · currency · rate · upload · radio · checkbox。结构都是 Input Label Horizontal + 对应输入组件，子组件全用飞鹊正版实例
  - `key 见清册 web-components.json` · `node 3663:10212 起`
- **form item vertical / <控件>（14 个同构组件）**  `266x386`  SET · 3 个 variant
  - variant：size(default/small/large)
  - 垂直标签版的同一族控件，结构 Input Label Vertical(上) + 输入组件(下)，同样三档尺寸
  - `key 见清册 web-components.json` · `node 3670:11095 起`

### 输入与选择（12）

- **input/basic**  `1254x2112`  SET · 90 个 variant
  - variant：status(default/error/warning/success/reminder) × size(default/large/small) × state(default/hover/disabled/focused/typing/filled)
  - 基础输入框，三维 90 个组合。注意 status 有 reminder 这一档（砖表 CSS 里是 .inp-reminder）
  - `key 5e9ac766dafd7b0560d6e2236c6ebf718e7b3180` · `node 2200:3601`
- **input/password**  `2160x432`  SET · 36 个 variant
  - variant：size(small/default/large) × state(default/hover/focused/typing/filled/disabled) × hide(true/false)
  - 密码框，hide 控制明文/密文
  - `key 49bdd5cfa14049a6356f327922cf6454ce73c10a` · `node 2161:2022`
- **input/search**  `1512x216`  SET · 9 个 variant
  - variant：size(small/default/large) × button type(default/primary with Icon/primary with Text)
  - 搜索框，右侧按钮三档：灰底默认 / 红底图标 / 红底文字
  - `key 44bcf44d4fa0a693dfcff4f62b5fc611ae2723bf` · `node 2138:11996`
- **input pre post tab**  `234x511`  SET · 18 个 variant
  - variant：type(basic/icon/select) × tab(pre/post) × size(default/large/small)
  - 输入框前后缀（如 Phone +86、Currency $）。tab=pre 前缀 / post 后缀
  - `key b9b1b207e56bd714bcb0b2140d8b23ad7a7a4396` · `node 2092:16178`
- **input label vertical**  `513x125`  SET · 6 个 variant
  - variant：tooltip(true/false) × mark(optional/none/required)
  - 垂直标签，mark 控制必填星号/optional 字样
  - `key b294449b44aa15655065785871392715323dbfab` · `node 2089:12232`
- **input label horizontal**  `147x176`  SET · 3 个 variant
  - variant：size(default/large/small)
  - 水平标签
  - `key 8a82b8a65f086a2d1d3450b3d5e5ee9c55ef1fca` · `node 2089:12160`
- **input caption**  `272x152`  SET · 3 个 variant
  - variant：status(default/error/warning)
  - 输入框下方的说明/报错文字
  - `key 695fd5b483d52eaf86fac6ad36dd8aacf31818da` · `node 2091:12233`
- **select input**  `3304x1268`  SET · 135 个 variant
  - variant：status(default/warning/error) × size(default/large/small) × type(basic/multiple/search) × state(default/disabled/filled/focused/hover)
  - 下拉触发器，四维 135 个组合。type=multiple 多选 / search 可搜索
  - `key 50139b12d702b8e0382d3f13a85d300f2a5e3dcb` · `node 2517:3289`
- **select menu item**  `188x258`  SET · 5 个 variant
  - variant：state(default/hover/selected/selected multiple/disabled)
  - 下拉选项行五态
  - `key 2f619c4f10fa5ca78c5a6b1d07fbd5cec6feec20` · `node 2250:2586`
- **multiple Selection Item**  `295x154`  SET · 9 个 variant
  - variant：size(default/large/small) × state(default/disabled/hover)
  - 多选后在输入框里显示的那颗 chip
  - `key c57e5d5d6a3d8ca24821876a6b01b06339aee126` · `node 2250:2587`
- **select**  `1152x160`  SET · 6 个 variant
  - variant：active(yes/no) × size(default/small/large)
  - 选择器整体（触发器+面板）
  - `key 7a82c8f3d7722ee2dfa4a9d45126abc110677b43` · `node 2558:2506`
- **select menu**  `320x220`  单组件
  - 下拉浮层容器
  - `key eb05e75a51e4dcf83f191014852ad597645baf2c` · `node 0:89482`

### 上传（5）

- **upload / button**  `632x176`  SET · 15 个 variant
  - variant：state(default/hover/pressed/loading/disabled) × size(default/large/small)
  - 按钮式上传
  - `key f7fd0677aaa4b8700134e8d179e07c25311834a5` · `node 2460:6695`
- **upload / drag and drop**  `520x359`  SET · 2 个 variant
  - variant：state(default/hover)
  - 拖拽上传区
  - `key ffefd64bf7ae37dab4c777d8eca19b5a7f7ba378` · `node 2460:6889`
- **upload / files list**  `316x149`  SET · 3 个 variant
  - variant：state(default/hover/error)
  - 已传文件列表行
  - `key 898c57b1260c69337de15d8dd461d3325d975272` · `node 2460:28551`
- **upload list item / picture**  `448x904`  SET · 14 个 variant
  - variant：status(upload/error/uploaded) × state(default/hover/progress) × type(card/circle)
  - 图片上传卡，card 方形 / circle 圆形（头像场景）
  - `key 1a5f4dc56d8d5bfeea8a2f3e8bd9eedc3b4be2e5` · `node 2518:31057`
- **uploading**  `1058x186`  SET · 9 个 variant
  - variant：state(uploading/error/finished) × size(default/small) × background(yes/no)
  - 上传中进度条
  - `key 852a877d96641e78735dacbf6372602940614258` · `node 2518:31491`

### 导航与步骤（7）

- **tabs / basic**  `1967x1184`  SET · 24 个 variant
  - variant：position(top/bottom/left/right) × color(black/red) × size(default/large/small)
  - 标签页整体。position 四向 × 黑/红两色 × 三尺寸
  - `key 28b699bb0526bef34974dc37a169a9a73660bc28` · `node 2710:5389`
- **tab item**  `452x346`  SET · 12 个 variant
  - variant：state(default/hover/active) × size(default/large/small) × color(red/black)
  - 单个 tab 项。🔴 选中态是下划线不是 chip
  - `key baa9fc1c92e8bb216a13541d931d7c59fea0fc5d` · `node 2771:579`
- **tab item / card / tabs**  `726x536`  SET · 6 个 variant
  - variant：color(red/black) × size(default/large/small)
  - 卡片式 tab
  - `key ee0c5c961a4823d6a8356cd31c6ec8b949e4ad66` · `node 2801:1397`
- ***Steps***  `2496x1122`  SET · 10 个 variant
  - variant：Type(Basic/Custom Icon/Dot/Navigation/Inline) × Size(Default/Small) × Direction(Horizontal/Vertical/Steps) × Time(BOOLEAN) × Description(BOOLEAN)
  - 步骤条整体。🔴 除 variant 外还有两个 BOOLEAN 开关（Time / Description）控制显不显示时间与描述
  - `key 4177fbd1c92231e4742b16c192f2eda8a9d372cf` · `node 3035:347`
- **Steps Item / Horizontal**  `934x1008`  SET · 24 个 variant
  - variant：Status(Finish/Process/Wait/Error) × State(Default/Hover) × Style(Basic/Basic Small/Custom Icon) × Description(BOOLEAN) × Time(BOOLEAN)
  - 横向步骤项四状态
  - `key b6535dbfadad4b5fd38c8d06b60065e30c803cd2` · `node 3035:665`
- **Steps Item / Vertical**  `1792x668`  SET · 24 个 variant
  - variant：Type(Basic/Basic Small/Dot) × Status(Finish/Process/Wait/Error) × State(Default/Hover)
  - 纵向步骤项
  - `key f9116ddd631daa875d523d111ee3e7507f912489` · `node 3035:899`
- **Steps Item / Progress Icon**  `435x211`  SET · 14 个 variant
  - variant：Type(Basic Default/Basic Small/Dot) × State(Finish/Process/Wait/Error/Progress)
  - 步骤圆点/图标
  - `key f3630c4c093511b35fd45fdaa913924cf265f10d` · `node 3035:491`

### 反馈与标识（8）

- **button**  `2233x3511`  SET · 540 个 variant
  - variant：type(text/link/secondary/dashed/primary) × size(default/small/large) × State(default/disabled/hover) × content(basic/icon only) × color(red/blue/dark) × shape(default/round)
  - 飞鹊按钮总集，**540 = 5×3×3×2×3×2** 六个维度全组合。🔴🔴 **每个按钮里有前后两个 `icon` 图层，默认隐藏** —— 要带图标就把对应那个打开并换成需要的图标，不是自己在按钮旁边另加一个 svg。槽位尺寸随 size：default/small 16×16、large 22×22。🔴 **content=icon only 是纯图标按钮**（只有一个 icon 图层、没有文字），网页对应砖表的 .btn-icon-lg/md/sm。⚠️ 这个组件集在 Figma 里带错误标记、componentPropertyDefinitions 读不出来，上面这些维度是**从 540 个 variant 的名字反推**的。网页实现在砖表 docs/css/btn.css（.btn + 尺寸 + 变体），图标本身从 icons/ 取（查 icons/INDEX.md）。
  - `key 763190f9f69421d390401bb5eecc289e617c7c72` · `node 2019:24969`
- **alert**  `1354x1055`  SET · 16 个 variant
  - variant：type(error/info/success/warning) × banner(false/true) × description(false/true)
  - 提示条。banner=true 是通栏样式；description=true 多一行说明文字。🔴 里面不放按钮，动作用文字链
  - `key 5ac0ac007568d956827424e258f8698b130f4390` · `node 3041:740`
- **message**  `226x360`  SET · 5 个 variant
  - variant：type(normal/error/loading/success/warning)
  - 全局提示（顶部飘出）五种类型
  - `key 2325b8985121a6c1d35619667370622a83039087` · `node 2216:65`
- **tag / basic**  `383x144`  SET · 9 个 variant
  - variant：size(small/default/large) × state(default/closeable/add new)
  - 标签。state=closeable 带关闭叉 / add new 是虚线加号
  - `key c44a41460290b598c57def4c76082e5f84ecb8fb` · `node 2325:894`
- **tag / colorful (legacy)**  `930x100`  SET · 15 个 variant
  - variant：type(areal/line) × preset(red/orange/blue/green/deep blue/dark gray/light gray/light blue/light green/light orange/light red)
  - ⚠️ 名字带 legacy＝遗留版。areal 浅底 / line 描边 × 11 个预设色
  - `key e9c801c049ea12baf44a6eb1d33ee0c1a5cd0f91` · `node 2325:895`
- **badge**  `196x36`  SET · 7 个 variant
  - variant：_err(props 读不出，维度见说明)
  - 徽标。type（dot/number/overflow/text）× color（dot 专属 red/blue/green/orange），共 7 个变体。dot 8×8 圆点；number 16×16 圆形数字；overflow 胶囊 99+；text 胶囊文字（如 NEW）。字体 Roboto Regular 10px
  - `key 0611df2763a34eaa0c1ad53fd7dc2a06ab49ab59` · `node 3934:29`
- **badge-status**  `90x138`  SET · 5 个 variant
  - variant：state(success/error/warning/processing/default)
  - 状态徽标＝彩色圆点+文字标签，用于表格/列表里展示数据状态
  - `key 042aaea30ff6fdaf60f30d5ed2e6834549bbda95` · `node 3945:35`
- **switch**  `276x190`  SET · 16 个 variant
  - variant：size(default/small) × state(default/loading/disabled/pressed) × active(true/false)
  - 开关，含 loading 态
  - `key a6d91beed41f0fe72f757590f47b0192accfff30` · `node 2216:13236`

### 空状态（2）

- **Empty 缺省图**  `1796x2116`  SET · 31 个 variant
  - variant：场景(基础通用/个性选用) × 颜色(通用/买家/供应商) × 主题(无记录/无结果/空收件箱/空数据/筛选无结果/产品搜索无结果/公司搜索无结果/无收藏记录/空询盘篮/暂无消息/暂无图片/暂无商品/订单/没有权限/没有下载内容/任务成功/任务等待中/任务失败/错误/订单提交成功/询盘发送成功/初始页面（完成）/初始页面（下载）/引导主站/网络错误404/网络错误500/网络错误/接口异常/链接/账号/买家app下载/供应商app下载)
  - 🔴🔴 **26 种现成缺省图，做 MIC 页面遇到空状态先在这里找有没有对得上的主题**，别自己画也别只放个灰块。基础通用档 256×256，颜色统一中性（「没有权限」例外＝买家色）。个性选用档按买家/供应商分色
  - `key e0f7179a27282955ee16b50ced38fd8e0d451596` · `node 4208:974`
- **empty-state**  `1471x1306`  SET · 12 个 variant
  - variant：size(large/default/small) × type(basic/button/horizontal/link)
  - 组合型空状态块＝插画 + 主文案 + 辅助文案 + 可选操作。size：大(插画200/主文 body-xl) · 中(120/lg) · 小(72/base) · 迷你(48/footnote)。type：basic / button(飞鹊 primary Button) / link(辅助文案内蓝色 primary-supplier 链接) / horizontal(插画左+文案右)。插画引用上面那个缺省图 SET
  - `key 3e8a379cd88ab541fecee431f110253828d3e10d` · `node 7752:35`

### 导航与容器（10）

- **pagination**  `711x456`  SET · 6 个 variant
  - variant：variant(basic/simple/mini/jumper/mini jumper/more)
  - 分页器 6 种形态：basic 完整 / simple 精简 / mini 小号 / jumper 带跳页输入 / mini jumper / more 带省略
  - `key 49e53189be78455c025999d11cac2a8f76704d3b` · `node 2062:359`
- **pagination item / number**  `243x296`  SET · 12 个 variant
  - variant：size(default/small) × state(default/hover/active) × disabled(false/true)
  - 页码格
  - `key f189d5a1e5f529b750689dc2c1c8e5f9d57ab1d1` · `node 2062:320`
- **pagination item / arrow**  `364x472`  SET · 18 个 variant
  - variant：type(arrow/text) × size(default/small) × state(default/hover/disabled) × direction(left/right)
  - 翻页箭头。type=text 时显示 Previous/Next 文字
  - `key ed144cafe448674abdf45b56a962e0aabfba94f1` · `node 2062:345`
- **pagination item / more**  `152x72`  SET · 2 个 variant
  - variant：state(default) × direction(left/right)
  - 省略号格
  - `key aafbc2d01ca976cab0cb358bf71e99d0cbb76b79` · `node 2062:358`
- **breadcrumb light mode**  `448x106`  SET · 4 个 variant
  - variant：type(small/large) × statue(default/hover)
  - 浅色底面包屑（注意属性名拼成了 statue 不是 state）
  - `key 3dc5ff892e5ad53dcb323a4112ce94f3f0033047` · `node 2169:170`
- **breadcrumb dark mode**  `448x106`  SET · 4 个 variant
  - variant：type(small/large) × statue(default/hover)
  - 深色底面包屑
  - `key f194585ba079d889a793f157f70739da43fc2b75` · `node 3227:2500`
- **breadcrumb Link**  `141x140`  SET · 6 个 variant
  - variant：state(default/current/hover) × type(large/small)
  - 面包屑单项。current＝最后一级（不可点）
  - `key 49171688d5974c2172eca2a0e31a10decf7c2f16` · `node 2164:85`
- **drawer**  `1920x3120`  SET · 9 个 variant
  - variant：width(narrow/default/wide) × button(no/header/footer)
  - 抽屉。width＝narrow 320 / default 400 / wide 560。button 控制按钮放页头还是页脚。Header body/xl + text/title，关闭用飞鹊 icon=delete；按钮用飞鹊 Button 实例（secondary-red + primary-red）
  - `key 256078b04a707acf2cbae006706ed43e8b97993f` · `node 3207:48`
- **table**  `966x1278`  SET · 4 个 variant
  - variant：type(basic/selectable/sortable/bordered)
  - 表格 4 种：basic 标准(Tags+Action+分页) / selectable 带选择列(Checkbox 或 Radio) / sortable 表头排序图标 / bordered 单元格边框+Footer+竖向滚动条
  - `key bc8b5b2c838670972889877f675111f8e6156cd4` · `node 3760:410`
- **tooltip**  `2572x421`  SET · 24 个 variant
  - variant：placement(bottom/bottom left/bottom right/top/top left/top right/left/left top/left bottom/right/right top/right bottom) × close(yes) × color(dark/light)
  - 文字提示。12 个方位 × 明暗两色，跟 popover 同构（popover 能放富内容，tooltip 只放文字）
  - `key 3d6cde110f5ac6e23b4a97e80ee7fb2cb18ce7f9` · `node 2576:1709`

### 勾选与选择器（6）

- **MIC brand logo with checkbox**  `448x96`  SET · 3 个 variant
  - variant：brand(audited/STS/leading factory)
  - 🔴 **LV/搜索结果页左侧 filter 栏顶部的「品牌认证快选行」**。每行＝16×16 checkbox + 10px gap + 品牌 logo。线上 DOM：a.filter-item-link > span.input-checkbox + img。**别自己拿文字拼认证标**，logo 用 brand/ 里的真 SVG
  - `key 0fc622b6be8f293b93cadd7ff2d67f3e39285c0e` · `node 4465:2650`
- **checkbox**  `264x580`  SET · 42 个 variant
  - variant：statues(inactive/active/indeterminate) × state(default/hover/disabled) × size(default/small) × color(neutral/blue/red/disabled)
  - 复选框。statues 有 indeterminate（半选）；属性名拼成了 statues
  - `key 66ff587827f0e49648104454243300c08f8fe200` · `node 2211:477`
- **radio**  `177x580`  SET · 28 个 variant
  - variant：statues(inactive/active) × size(default/small) × color(neutral/bule/red/disabled) × state(default/hover/disabled)
  - 单选框。⚠️ color 里 blue 拼成了 bule，setProperties 要照错的拼
  - `key e02daf42d50fe77bcd491fb8ad1adb86a032579b` · `node 2211:479`
- **selecter-single**  `612x620`  SET · 60 个 variant
  - variant：state(default/hover/Selected) × shape(default/round) × size(default/small) × color(default/red/blue) × disabled(no/yes)
  - 按钮式单选（买家端常用，长得像按钮不是圆点）。⚠️ state 的 Selected 是大写 S
  - `key 06c562c37ea54813c355eb7d0b72e54e16c2ce9c` · `node 2211:480`
- **selecter-multiple**  `612x620`  SET · 60 个 variant
  - variant：state(default/hover/selected) × shape(default/round) × size(large/small) × color(default/red/blue) × disabled(no/yes)
  - 按钮式多选。⚠️ size 是 large/small（没有 default），跟 selecter-single 不一样
  - `key 3f3fbb2a1723cc0ba3045f8b8f122b7bea96a0a0` · `node 2211:478`
- **selecter-multiple2**  `736x296`  SET · 16 个 variant
  - variant：type(text/dropdown/badge/icon) × state(default/selected) × disabled(no/yes)
  - 第二版按钮式多选，多了 dropdown/badge/icon 三种形态。隐藏槽位：icon·符号&箭头-down-big
  - `key c0998d4628fbba697442cbb23bf01a7cebd58d14` · `node 10514:11866`

### 文本与数字（2）

- **textarea**  `2400x338`  SET · 21 个 variant
  - variant：size(default/large/small) × state(default/hover/focused/typing/filled/disabled/error)
  - 多行文本域，7 种状态
  - `key e71dc8a8b9ca19a10de2047e454acd4a01d5e952` · `node 2135:201`
- **inputNumber**  `1007x706`  SET · 45 个 variant
  - variant：size(default/large/small) × state(default/hover/typing/disable/error) × button(bilateral/left/none)
  - 数字输入。button＝bilateral 左右各一个步进器 / left 只在左边 / none 无步进器
  - `key 4b6f1e31370f9736b9c415f8b6590337a308c284` · `node 2290:348`

### 级联与加载（5）

- **cascader**  `1600x1020`  SET · 11 个 variant
  - variant：open(no/yes) × size(small/default/large) × style(default/checkbox-neutral/checkbox-blue/scroll) × value(filled/filled-hover/default)
  - 级联选择器。闭合态复用飞鹊 Select 组件实例；展开态＝Select 触发器 + 3 列级联菜单。style 控制勾选样式（黑/蓝）与滚动
  - `key 44e382cdf6ebe3ce305f1d6fbad932532a0a43dd` · `node 3254:3788`
- **cascader menu item**  `1200x268`  SET · 24 个 variant
  - variant：state(default/hover/selected/disabled) × expand(true/false) × checkbox(false/true) × color(neutral/blue/none)
  - 级联菜单项＝[展开箭头 right] + [勾选框] + 文字 14px。hover 底色 #F5F7F*
  - `key 3afdf63118f0bbed459b94b5826ff221a51d354d` · `node 3251:843`
- **cascader menu（面板四种）**  `533x136`  单组件
  - 级联菜单面板四个独立组件：基础 / 勾选黑 / 勾选蓝 / 滚动
  - `key e1bae901c946c5a797be4a0b3ceb1d3b07a51a6e 等` · `node 3252:767 / 3277:1333 / 3277:1554 / 3277:1847`
- **spin basic**  `72x650`  SET · 15 个 variant
  - variant：size(small/default/large) × color(light/red/dark/blue/gray)
  - 加载转圈，5 种颜色。🔴 别自己写 @keyframes
  - `key 301cd183a8546443fc60293e072a72ace2e5c86c` · `node 2216:10100`
- **spin description**  `454x229`  SET · 6 个 variant
  - variant：arrange(horizontal/vertical) × Size(default/small/large)
  - 带文字说明的加载。arrange 控制文字在右还是在下
  - `key f63ac5cca378d954c548c2f42f121713219bd70e` · `node 3170:1043`

### 列表与卡片（7）

- **list**  `2160x484`  SET · 5 个 variant
  - variant：type(simple/meta/description/avatar/avatar tag)
  - 列表 5 种场景：simple 纯文字导航（侧边栏/设置菜单）· meta 带右侧辅助数字 #888（选中时标题+数字+箭头全蓝）· description large 尺寸标题16+描述12 行高64（功能模块入口）· avatar 36px 圆形头像(首字母)+标题+描述（供应商/联系人列表）· avatar tag
  - `key bb27a7255c497930bf160ea9e96d1e8fa8601c26` · `node 3346:164`
- **list item**  `760x454`  SET · 12 个 variant
  - variant：size(small/default/large) × state(default/hover/selected/disabled)
  - 列表项。高度 small 36 / default 44 / large 64（含 12px 描述）。hover #F5F7FA · selected #F5F7FA+蓝字 · disabled #B3B3B3。结构＝标题14px #222 + 描述12px #888(仅 large) + 右箭头
  - `key b77e00cace121e16fd6dda54540fd64753c33cc8` · `node 3320:270`
- **card**  `1200x916`  SET · 8 个 variant
  - variant：type(default/borderless/simple/picture/with-actions/inner/tabs/meta)
  - 卡片 8 种形态
  - `key 3de2d6c687a11c1ca03ee2bfe9923cb9133fdc8f` · `node 3743:117`
- **Collapse**  `5687x4967`  SET · 108 个 variant
  - variant：Item Count(2/3/4) × Secondary project(1/2/3/4) × color(red/blue/default) × Borderless(yes/no) × Size(small/default/large)
  - 折叠面板 108 个组合。Item Count 控制几个面板、Secondary project 控制二级项数量
  - `key 9cef895e6121a0ec2b9893bb66921d68b4433f10` · `node 3160:5458`
- **Collapse-Item**  `2752x2582`  SET · 68 个 variant
  - variant：Color(red/blue/default) × Size(small/default/large) × Borderless(yes/no) × Active(yes/no) × State(default/hover/disable)
  - 折叠单项。🔴 注意：砖表 CSS 里**没有** clps 的实现（权威源里只有一段注释），要折叠面板得自己实现结构或从这里导
  - `key 710f3c4c2335bd4ffb7f3df2bc99b9dfae51cb01` · `node 3160:1418`
- **skeleton**  `480x1130`  SET · 4 个 variant
  - variant：type(text/avatar-text/card/list)
  - 骨架屏。line 统一 16px 高、圆角 4px、最后一行 61% 宽。色绑 background/background 01 #F5F7FA
  - `key fd3f4d26922e533d08e9045186f29c62f0b1d269` · `node 3893:68`
- **image**  `1269x215`  SET · 6 个 variant
  - variant：state(with image/hover/loading/placeholder image/no image/Supplier without logo)
  - 🔴 图片占位组件。**state 里有 `Supplier without logo`（供应商没传 logo 时用它）、`no image`、`placeholder image`** —— 做产品卡/供应商卡的图位直接用这个，别自己画灰块
  - `key 1460693f3993b46ef2a780e1ffc2e18d8bc4f12b` · `node 5703:119`

### 轮播（4）

- **swiper**  `1240x1576`  SET · 4 个 variant
  - variant：Property 1(Top/Bottom/Left/Right)
  - 轮播整体，指示点四个方位
  - `key 70ef4845b231e40fed01a8e8a67d8ab933bd19bb` · `node 2290:10833`
- **carousel dots**  `716x140`  SET · 16 个 variant
  - variant：vertical(false/True) × shape(line/round) × color(light/dark/red/bule)
  - 指示点组。⚠️ color 里 blue 拼成 bule、vertical 的 True 是大写
  - `key 6586450dcc1972ee3d37bb254ecd29d9734325cd` · `node 2290:10794`
- **carousel dot**  `464x80`  SET · 24 个 variant
  - variant：state(default/hover/active) × shape(line/round) × color(light/dark/red/blue)
  - 单个指示点
  - `key c07e264fff7d8767603ba082f8dbc664f134e01f` · `node 2290:10793`
- **flip button**  `1158x80`  SET · 24 个 variant
  - variant：state(default/hover) × color(light/dark) × position(left/right) × size(default/big/small)
  - 轮播左右翻页按钮
  - `key c6ac42a17dc67701e5c12aba10f7ee1dd4fd3b80` · `node 2290:10832`

### 产品卡（主搜/QP/LV）（11）

- **ProductCard-主搜**  `804x625`  SET · 2 个 variant
  - variant：Property 1(ProductCard——主搜/ProductCard-hover——主搜)
  - 主搜结果页产品卡（网格版），默认态+hover 态
  - 🔴 **已有网页实现，别自己拼**：`cat docs/blocks/product-card-grid.html`（HTML+CSS 一起给，已对过真值）
  - 🔴 跟列表版三处不同别照抄：标题 14px 两行 / 价格 20px / **公司名 #888 不是 #222**
  - `key e9d2a2f857be9da599aa035eef5e36d7b28bd034` · `node 7490:1339`
- **ProductCard-主搜(List)**  `1207x832`  SET · 2 个 variant
  - variant：Property 1(ProductCard—— 主搜(List)/ProductCard—— 主搜(List)-hover)
  - 主搜结果页产品卡（列表版）
  - 🔴 **已有网页实现，别自己拼**：`cat docs/blocks/product-card-list.html`（HTML+CSS 一起给，已对过真值）
  - `key ed698a0ad82597bb86184910097fc42b52cbeae7` · `node 7974:7314`
- **ProductCard-QP**  `778x600`  SET · 2 个 variant
  - variant：Property 1(ProductCard——QP/ProductCard-hover——QP)
  - 🔴 QP 产品卡。**隐藏槽位 `ic_STS单个`** —— 担保交易标在卡里是默认隐藏的图层，要显示就打开它，**别自己拿文字拼一个 Secured Trading**
  - `key dc65800d98b1fc0dccf082213f75a3996ec1641e` · `node 7490:1338`
- 🔴 **已有网页实现**：`cat docs/blocks/product-card-qp-grid.html`（QP 网格版，已对过真值）
- **ProductCard-QP(List)**  `1558x826`  SET · 2 个 variant
  - variant：Property 1(ProductCard-QP(List)/ProductCard-QP(List)-hover)
  - QP 产品卡列表版
  - 🔴 **已有网页实现**：`cat docs/blocks/product-card-qp-list.html`（已对过真值）
  - 🔴 跟主搜列表版四处不同：根顶对齐 / 价格无 (FOB Price) / 属性区是一整段两行描述 / 底行是 Audited+5.0/5+评价语不是星级
  - `key 2a7119b4f75ee0d570e342aa6a331e722f89b6ae` · `node 7974:7315`
- 🔴 **已有网页实现**：`cat docs/blocks/product-card-lv-grid.html`（已对过真值·无购物车无心形·按钮 Regular）
- **ProductCard ——LV**  `708x594`  SET · 2 个 variant
  - variant：state(Default/Find similar items)
  - 🔴 LV 产品卡。state=Find similar items 是「找相似」展开态；**隐藏槽位 `similar Btn/icon`**
  - `key dcd798335ef12b6f755ade543bf41ee0b277234b` · `node 6717:1481`
- **ProductCard——LV(List)**  `1560x705`  SET · 2 个 variant
  - variant：Property 1(ProductCard——LV(List)/ProductCard——LV(List)-hover)
  - LV 产品卡列表版
  - 🔴 **已有网页实现**：`cat docs/blocks/product-card-lv-list.html`（**三栏**：图｜产品信息｜公司信息·已对过真值）
  - `key 2a73e30c98d5a4c64407b42cd096aaf0028463a7` · `node 7490:3336`
- **similar Btn**  `351x80`  SET · 2 个 variant
  - variant：Property 1(similar icon/similar icon-expand)
  - 「找相似」按钮，收起/展开两态
  - `key 2612a77b3b8efabca77b53a82b00d73930af0790` · `node 8094:1666`
- **product-image**  `729x350`  SET · 2 个 variant
  - variant：Property 1(default/hover)
  - 产品图位（网格版）
  - `key 0c3f8f4cf9a4b6c80cdac1ac26dfbdf5384c8ed3` · `node 8108:3514`
- **product-image(list)**  `710x320`  SET · 2 个 variant
  - variant：Property 1(Default/hover)
  - 产品图位（列表版）
  - `key ca9cb3a253b2c3e46b8d4d22c730ee9c7d49ae1d` · `node 8108:3686`
- **product/QP-image**  `699x324`  SET · 2 个 variant
  - variant：Property 1(QP-image/QP-image-hover)
  - QP 产品图位
  - `key 02cba4a0aec20875c3861a5e52d968a903b0a59d` · `node 8108:4081`
- **product-card**  `253x367`  单组件
  - 🔴 通用产品卡，**隐藏槽位一大排**：[ Product Image ] · select-pill(选择态胶囊) · 左右标切 · 选择20 · 轮播指示器 · 删除 · botton · icon-right-big。做询盘篮/批量选择这类场景时按需打开，别另画
  - `key 28b782a96cab654cfd7d9c0f37ac24058a67ed74` · `node 10752:2633`

### 买家登录（7）

- **email input**  `396x671`  SET · 6 个 variant
  - variant：status(default/hover/focused/typing/error/disabled)
  - 登录页邮箱输入
  - `key a4b45b4fa911dc62d72602664a3393e544b3ce4d` · `node 7041:1980`
- **password entry**  `396x1016`  SET · 8 个 variant
  - variant：status(default/hover/focused/typing/filled/error/disabled/Password Display)
  - 密码输入，Password Display＝明文态
  - `key e6f4b61ff539aed1d171dd5d12a71738c56eb130` · `node 7148:928`
- **verified code entry**  `405x719`  SET · 5 个 variant
  - variant：status(default/input/error/expire/disabled)
  - 验证码输入（expire＝已过期态）。另有阿语 RTL 版 key 07690b0be14d2508e87b1208f0256f2475ceede7
  - `key dc78c14f4332868e10173bbf87fb7328fb0fda00` · `node 7148:1791`
- **verification code input box**  `98x323`  SET · 4 个 variant
  - variant：state(default/pressed/error/disabled)
  - 单个验证码格子
  - `key 20a03f0239f5306b2e5eda47f17005514cc1f0ca` · `node 6451:8632`
- **resend**  `131x142`  SET · 3 个 variant
  - variant：state(default/hover/press)
  - 重发验证码按钮
  - `key 1de6084eebb59c55cf1344495befea123e2fde24` · `node 6451:8625`
- **social**  `396x165`  SET · 2 个 variant
  - variant：status(default/hover)
  - 第三方登录行，隐藏槽位「社媒logo 2」
  - `key 95865bc06aef84a59f6a1d2db9e514c08dbbc1ea` · `node 6451:8606`
- **登录页整页（4 个）**  `420x560`  单组件
  - 整页组合：登录 / 输入验证码 / 登录-验证码（阿语）/ 登录-上次社媒登录。隐藏槽位 qr wrap（扫码登录区）
  - `key 87c32da526f4119215576f608c5f37e64e596786 等` · `node 7415:1729 / 7415:12102 / 7415:12670 / 7415:12101`

### 其它业务（1）

- **amount range**  `362x218`  SET · 3 个 variant
  - variant：size(default/large/small)
  - 金额区间输入（筛选栏价格区间用）
  - `key 3eec388eec885bb6af84a4ef402c4f5e239881ee` · `node 7213:5009`

### 浮动与统计（6）

- **affix**  `649x346`  SET · 28 个 variant
  - variant：icon(rfg/help/suggestion/top/calendar/category/app) × state(default/hover) × text(yes/no) × platform(pc/all) × round(no/yes) × size(large/small)
  - 🔴 页面右侧固定的浮动按钮。**icon 维度就是 MIC 的 7 个固定入口：rfg(发布询价) · help · suggestion · top(回顶部) · calendar · category · app**。做主搜/列表页右侧那排按钮直接用它
  - `key 1ef1674d6e92137f5affa39eb28ddd6f52b58c86` · `node 2189:670`
- **statistic-items**  `1075x158`  SET · 8 个 variant
  - variant：_err(props 读不出，维度见说明)
  - 统计数值 8 种：basic / with-suffix / with-prefix / trend-up / trend-down / countdown / countdown-day / countdown-millisecond。数值 heading3 24px，标题 body/base 14px
  - `key 4cef1f9314d002e6e86f35dee7ebc8e58c9e52e5` · `node 3959:24`
- **statistic**  `2169x207`  SET · 4 个 variant
  - variant：Property 1(countdown-bar/countdown-end/exposure-stats/ranking-list)
  - 业务统计块：倒计时条 / 倒计时结束 / 曝光数据 / 排行榜
  - `key 22b830cdc45ea96bb18600a7a7fb8752487692c0` · `node 4001:932`
- **Popconfirm**  `1636x806`  SET · 12 个 variant
  - variant：placement(top/top left/top right/bottom/bottom left/bottom right/left/left top/left bottom/right/right top/right bottom)
  - 气泡确认框，12 个方位（比 popover 少了明暗维度）
  - `key 2ea4ba71382da99675cd98814c968772770ff83b` · `node 3024:7465`
- **popover（Popconfirm 页的另一个）**  `1028x1391`  SET · 24 个 variant
  - variant：state(T/B/L/R) × position(L/T/C/B/R) × Button(no/yes)
  - ⚠️ 跟 Popover 页那个 popover 是两个不同组件，这个用 T/B/L/R 缩写且带 Button 开关。选用前确认是哪一个
  - `key ddbc1d2758a16d6f3d4808b6533b9286369dae66` · `node 3026:8471`
- **scrollbar**  `70x80`  SET · 2 个 variant
  - variant：size(auto/thin)
  - 自定义滚动条。🔴 飞鹊 scrollbar 的滑块位置与约束不可覆盖，滑块恒在轨道正中＝组件行为，稿上表达不了「滚到哪儿」
  - `key 307dcf89b7f71ee6e416e03ad4e4de4df46c79f3` · `node 2019:24778`

### 头像与地区（3）

- **avatar default/w**  `1256x288`  SET · 42 个 variant
  - variant：size(small/default/large) × role(buyer/saler/supplier/none) × gender(female/male/none) × circular(yes/no)
  - 默认头像。🔴 role 分 buyer/saler/supplier，配不同底色；circular 控制圆形/方形
  - `key 898686caa6a7b32e3ec21746bcac8ffa78403682` · `node 7101:6387`
- **avatar text/w**  `728x288`  SET · 24 个 variant
  - variant：size(small/default/large) × language(latin/chinese/japanese/korean/arabic/russian/thai/hindi)
  - 🔴 首字母头像，**按 8 种语言分了字形**（拉丁/中/日/韩/阿拉伯/俄/泰/印地）—— 多语页面别只用拉丁那档
  - `key f1e4308168cede5b41d2a88001540e553d172a13` · `node 7101:6338`
- **area picker**  `360x630`  单组件
  - 国家&地区选择器面板 360×630
  - `key 4e0bd2347545eb276c29edc6d25d9001de4b5ed6` · `node 3065:12144`

### 菜单与树（8）

- **menu**  `1076x459`  SET · 3 个 variant
  - variant：mode(inline/horizontal/vertical) × theme(light)
  - 菜单容器。inline 垂直可展开子菜单、宽 240，适合侧边栏 · horizontal 水平、底部 1px 边框+选中指示条，适合顶部导航 · vertical 垂直、右侧 1px 边框、宽 200，适合侧栏快捷导航
  - `key f268d97bcf85589ed3b9d9ae12c282c969b246ac` · `node 3817:1640`
- **menu item**  `1620x160`  SET · 8 个 variant
  - variant：state(default/hover/selected/disabled) × icon(yes/no)
  - 菜单项。高 40，水平 padding 12，icon-text gap 8，icon 16px 飞鹊图标实例
  - `key fe82cabfa6d77a9759a12990d85cad2c15ff1af1` · `node 3804:1421`
- **menu submenu title**  `3420x160`  SET · 16 个 variant
  - variant：state(default/hover/selected/disabled) × expand(yes/no) × icon(yes/no)
  - 子菜单标题＝icon(可选) + label FILL + arrow 16px
  - `key eca4390092d4224e6d6d451ec128cbda97481fd9` · `node 3809:1729`
- **menu horizontal item**  `1332x166`  SET · 8 个 variant
  - variant：state(default/hover/selected/disabled) × color(blue/red)
  - 水平菜单项＝文字 + 2px 底部指示条。隐藏槽位 indicator（未选中时藏起来）
  - `key 2ed67c31e74c6a5c17c420f8a5131c1f7a59a367` · `node 3815:1449`
- **menu group title / menu divider**  `141x42 / 200x9`  单组件
  - 分组标题（14px #888，高 42）与分割线（1px #E6ECF2，上下 4px 留白）
  - `key 469465aa1a9249f87107cf3bb9c735a01fd35bca / 5c30f9f272712f0dba0f6eead85c22b78cbe3f42` · `node 3813:1433 / 3813:1435`
- **menu demo（5 个现成范例）**  `多种`  单组件
  - 🔴 **5 个直接对应 MIC 场景的现成 demo**：two-level horizontal（一级 Products/Suppliers/Trade Shows/Services + 二级品类，模拟 MIC 顶部导航）· multi-level collapsible（三级 inline 缩进展开）· sidebar right popover（200px 侧栏 + 右侧 180px 弹出面板）· sidebar inline expand（240px 当列展开）· sidebar with group titles（分组+分割线）。做导航先看这几个
  - `key f9994302c1dda3569c8c437751979eec45688827 等` · `node 3836:1655~1659`
- **tree**  `1400x424`  SET · 4 个 variant
  - variant：_err(props 读不出，维度见说明)
  - 树形控件 4 种场景：basic+blue（选中蓝字 #007DFA，功能导航/文件浏览）· basic+dark（选中 Semi Bold #222，内容浏览/筛选）· checkbox+blue（蓝勾+蓝字+半选）· checkbox+neutral
  - `key dc97f3e733a7afc6516ae129a48d41482e33247e` · `node 3351:335`
- **tree node**  `800x364`  SET · 36 个 variant
  - variant：_err(state × expanded/leaf × checkbox 共 36)
  - 树节点＝[展开箭头 down/right] + [勾选框] + 文字 14px。展开用 down、收起用 right、叶子 16px 占位
  - `key 70134db7abd184810eae658f6090a484e51e2da4` · `node 3302:178`

### 评分与其它（6）

- **rate**  `220x740`  SET · 11 个 variant
  - variant：score(0/0.5/1/1.5/2/2.5/3/3.5/4/4.5/5)
  - 评分，**支持半星 0.5 步进共 11 档**。5 个 rate star 水平排列 gap 4px。star 满星＝primary/buyer 红
  - `key 3a8241e231f6fbb18832bb6bcb980ef3ce3dbc9b` · `node 3566:1657`
- **rate star**  `140x260`  SET · 3 个 variant
  - variant：state(zero/half/full)
  - 单颗星三态（空/半/满）
  - `key 023c76625c51d0079bbc9a594cfd4b14183bda28` · `node 3565:809`
- **mask**  `3948x840`  SET · 3 个 variant
  - variant：opacity(0.35/0.55/0.75)
  - 背景蒙版三档透明度。弹层/抽屉的遮罩用它，别自己定 rgba
  - `key b3404b635905359fe72c1b410c8c45d620f1e5f8` · `node 8433:916`
- **autocomplete**  `1200x992`  SET · 15 个 variant
  - variant：state(empty/focused/typing/filled/filled hover) × size(small/default/large)
  - 自动完成。高度 small 24 / default 32 / large 40。empty 占位 #B3B3B3 灰边 · focused 蓝边 #007DFA 显示全部建议 · typing 蓝边显示过滤匹配 · filled 已选
  - `key 2420b68edf8fb0bf824469e18672bd01d75fc55e` · `node 3366:71`
- **autocomplete option**  `1060x276`  SET · 9 个 variant
  - variant：state(default/hover/disabled) × size(small/default/large)
  - 建议项。small 24 高文字 12 · default 32 高文字 14 · large 40
  - `key c910bdf48fbbda9cdfe634c67ba0c070495fd060` · `node 3366:8`
- **address picker**  `360x316`  单组件
  - 地址选择器面板 360×316
  - `key 1e7044bafba15d251b3ec9f2d5a915cf9c7b7b27` · `node 3089:1563`

### MIC 业务组件（探索页·带完整说明）（7）

- **MIC FilterItem**  `1605x471`  SET · 5 个 variant
  - variant：type(checkbox-list/checkbox-list-more/input-ok/price-range/brand-logos)
  - 🔴 LV 搜索结果页左侧筛选项 v2。来源＝2026-04-19 实测 made-in-china.com sofa 搜索页的 .filter-item，每块统一顶部 1px #E6E6E6 分割线。做筛选栏直接用这 5 种块，别自己排
  - `key 72506eff5619a1cef95d2b084f3d95ccae91b191` · `node 4453:551`
- **MIC FilterSidebar**  `308x1368`  单组件
  - 🔴 整条筛选侧栏。**width 308，padding 0/19/10/10，内容区宽 273**（与内部 FilterItem 等宽）。来源＝实测线上 .filter 完整结构 20 个分组，组件取了代表性 7 项
  - `key f53d86def06ac2b6d80cb8bc49a42c0016b802ea` · `node 4456:442`
- **MIC Supplier Ad / 主搜页聚焦广告**  `1580x1882`  SET · 5 个 variant
  - variant：breakpoint(2100/1920/1440/1366/1280)
  - 🔴 主搜页供应商视频广告位，5 断点。**≥1920 锁 1500×342；<1920 跟 wrapper 缩到 1130×312 / 1056×294 / 970×272**。AD 标识在右下角，12px Roboto
  - `key 0fbc3c51117e04842f0bf3671167940f06d6ac29` · `node 5265:2216`
- **mic-logo**  `240x46`  SET · 1 个 variant
  - variant：state(default)
  - MIC 品牌 LOGO，240×46 固定。Vector 文字「Made in China」+ 下划线。品牌红 #DA291C（**允许硬编码、不绑 Paint Style**）。包里已有现成 SVG：brand/mic-logo.svg
  - `key 16b912f2a723fc29a132f2c1b05fae23cc2c25b0` · `node 4596:1086`
- **vo-header**  `1600x85`  SET · 1 个 variant
  - variant：state(default)
  - VO 后台顶栏 1600×85。MIC LOGO(240×46) + 右侧菜单(账户/消息/通知/询盘篮/App/语言)。
    🔴 **2026-09-15 逐节点实测订正**：菜单**六项全是 12px**，没有「账户 14px」这一档（原记 14px 是错的）；
    badge 高 **20px**（padding 1/6·圆角 8），不是 18px —— 18px 那个是 vo-sider 的 count-badge，两者规格不同
  - 🔴 **已有网页实现，别自己拼**：`cat docs/blocks/vo-header.html`（已对过真值 47 项·LOGO 已内联）
  - `key 56bd0fd58dd6219ded4f62ab47db34db8f3f4b9b` · `node 4596:881`
- **vo-nav**  `1600x40`  SET · 3 个 variant
  - variant：selected(business/showroom/product)
  - VO 后台二级导航 1600×40。8 个 nav-item + 数据罗盘 quick 入口。14px Roboto 白字
  - 🔴 底色 #406080 / 选中 #284159 / 数据罗盘胶囊 #5B80A6 —— 这三个蓝是 VO 后台专用，不是飞鹊 primary #007DFA，别拿 token 替换
  - 🔴 **已有网页实现，别自己拼**：`cat docs/blocks/vo-nav.html`（已对过真值 37 项·换选中项＝挪 von-on 类）
  - `key 39dab5212ae12ec6520eb826e8d2c7ce00ef8cb5` · `node 4596:912`
- **vo-sider**  `210x782`  SET · 2 个 variant
  - variant：group(inquiry/settings)
  - VO 后台左侧栏 210 宽。分组标题 #888、普通项 #555、选中项用 MIC/VO sidebar selected bg
  - 🔴 两个 variant（inquiry / settings）**逐节点完全相同，只差哪一项选中**，不是两份结构
  - 🔴 **已有网页实现，别自己拼**：`cat docs/blocks/vo-sider.html`（已对过真值 68 项）
  - `key 7d9470408f1b2b99d1c95e78c1f7601469b0964b` · `node 4596:973`

### 响应式规范（1）

- **responsive**  `2100x2957`  SET · 4 个 variant
  - variant：type(breakpoint table/card grid/left-right ratio/font scale)
  - 🔴🔴 **响应式断点规范的可视化母版，做任何多端页面先看它**。四张：① breakpoint table＝6 断点总览（内容区宽 + 间距 token + 字号 + 卡片列数）② **card grid＝产品卡列数：1920→6 列 / 1440→5 列 / 1366→4 列 / 1280→4 列 / 1024→3 列 / 768→2 列** ③ left-right ratio＝左右结构比例 48:52→50:50→52:48→100% 堆叠 ④ font scale＝8 级字号缩放。配套文档 docs/飞鹊响应式规则-AI友好型规范.md
  - `key 4bded5f9f78e1171b2c2573d80a99f9880a5edc3` · `node 3403:2`

### 日历与锚点（7）

- **calendar / monthly**  `1206x1023`  单组件
  - 常规月历＝Header(年月+导航) + 星期行 + 5×7 日期网格
  - `key 7374548000e4d21c7d12cb408f417eef252619ac` · `node 3685:804`
- **calendar / card**  `282x346`  单组件
  - 卡片日历 282 宽。当天标记＝蓝圆 primary/supplier + 白字。另有 custom header 版（多一个下拉选择器）
  - `key 97107700ea158a2843f813ccc52b22bba68121cf` · `node 3691:844`
- **calendar / activity**  `1206x1146`  单组件
  - 活动日历＝月历 + Legend(活动/培训) + 单元格内放 event tag
  - `key 201871684300531e52a3ecf87a20125b28c06e22` · `node 3710:456`
- **calendar cell**  `652x260`  SET · 3 个 variant
  - variant：state(default/othermonth/today)
  - 日历格三态：本月(白底+#E6ECF2 边框+#222) / 非本月(灰字) / 当天(粉底+红框+红圈白字)
  - `key 19e951de4113d1e67b1a544fad6add861d96eb0f` · `node 3684:811`
- **calendar event tag**  `243x160`  SET · 4 个 variant
  - variant：color(blue/lightblue/orange/more)
  - 日历事件标签＝4px 左侧色条 + 背景色 + 12px 文字。blue 活动 / lightblue 即将开启 / orange 培训 / more 更多
  - `key d4504ca4643bdbe4c59f8204c9d2917cc6aa1105` · `node 3708:468`
- **anchor**  `559x303`  SET · 2 个 variant
  - variant：direction(vertical/horizontal)
  - 锚点导航容器。vertical 右侧 1px 分隔线；horizontal 底部 1px 分隔线 + 选中项底部指示条
  - `key b087c5a59074e5031416a99c718bf51651be52ce` · `node 3918:99`
- **anchor item**  `314x204`  SET · 6 个 variant
  - variant：state(default/active) × level(1/2) × direction(vertical/horizontal)
  - 锚点单项。高 30（active horizontal 为 32，含底部指示线）。default 文字 #222，active 绑 primary
  - `key 4eb89be4fdaa0d9c2c58af922d91096b530d8a02` · `node 3916:88`

---

## 要真资产怎么取（四步，别跳到「留占位」）

```
① ToolSearch("select:mcp__plugin_figma_figma__get_metadata,mcp__plugin_figma_figma__download_assets")
   🔴 figma 的工具是延迟加载的，一开始不在工具表里，不先捞出来直接调会失败
② get_metadata(fileKey, nodeId)        看结构，挑你要的那个 breakpoint 子节点 id
③ download_assets(fileKey, 子节点id, defaultFormat 传 svg)
④ curl -sL -o 文件 "URL"               URL 短命，立刻下
   python3 tools/clean-figma-svg.py 文件   清掉 Figma 画布杂质（紫色虚线框、画布底色）
```

fileKey 是 `gcanH38jg2SMmXwrcC6FP8`。

🔴 **「留灰色占位块」是导不到时的兜底，不是第一选择。没试过就留占位＝没做。**

## 覆盖范围

抓完 53 个有组件的页 / 组件库共 80 页。没抓的是：纯规范页（color/字体/间距/圆角/阴影/无障碍/检查表/封面）、5 个分隔页、icon 图标页（已单独做成 icons/INDEX.md 检索索引）、以及 TM组件/商机按钮/品牌标识三个顶层无组件的页

补抓方法：用 `use_figma` 对目标 page 跑一段只读脚本，取 `findAllWithCriteria({types:["COMPONENT_SET","COMPONENT"]})`
里 `parent.type !== "COMPONENT_SET"` 的顶层节点，读 name/key/id/width/height/componentPropertyDefinitions/description，
追加进 `figma-usage.json` 后重跑本脚本。**一个脚本只切一次页**，多页要并行发多个 use_figma 调用。

由 `build/gen-component-usage.py` 生成。数据源 `packs/feique/figma-usage.json`（2026-09-15）。
