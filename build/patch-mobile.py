#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把移动端布局层注入 index.html（可重复运行，按标记替换）。

为什么单独一个脚本、而不是直接手改 index.html：
另外四个脚本各自只替换自己那对标记之间的内容，所以移动端层需要一块自己的地盘，
才能在任何一个脚本重跑之后仍然存在，也才不会被它们覆盖。

单一维护源：手机上看到的每一个字、每一条数据，都来自桌面版同一份 index.html。
本层只做三件事 —— 换布局、把悬停触发换成点击触发、把宽表格改成卡片。
不复制内容、不新增页面，所以桌面版改了什么，手机上自动就有。

用法：python3 build/patch-mobile.py
"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = os.path.join(os.path.dirname(HERE), 'index.html')

META_B, META_E = '<!-- ==WB-M-META:BEGIN== -->', '<!-- ==WB-M-META:END== -->'
CSS_B,  CSS_E  = '/* ==WB-M-CSS:BEGIN== */',      '/* ==WB-M-CSS:END== */'
JS_B,   JS_E   = '/* ==WB-M-JS:BEGIN== */',       '/* ==WB-M-JS:END== */'

META = """<meta name="theme-color" content="#FFFFFF">
<meta name="format-detection" content="telephone=no">
<!-- 添加到主屏幕：iOS 主屏幕不认 SVG 图标，必须给 PNG。
     图标是满幅的（没自己画圆角）—— iOS 和 Android 都会套自己的遮罩，
     自己再画一层就成了圆角套圆角。图形占画布 60%，落在 Android maskable 的安全圈内。 -->
<link rel="apple-touch-icon" href="icon-180.png">
<script>
/* manifest 只在真的用 http(s) 打开时才挂上。
   🔴 双击本地文件（file://）时浏览器读 manifest 会按 CORS 拒掉，
   在控制台留两条红字 —— 这页有「双击就能开、0 报错」这条承诺，不能被一个装机用的
   附属文件破掉。装到主屏幕本来就要先在线打开，所以 file:// 下不挂它没有任何损失。
   （iOS 加主屏幕靠的是 apple-touch-icon 那三行，不依赖 manifest。）
   写在 head 里同步执行，跟静态标签一个时机，不影响安装条件的判定。 */
if (location.protocol !== 'file:') {
  var l = document.createElement('link');
  l.rel = 'manifest'; l.href = 'manifest.json';
  document.head.appendChild(l);
}
</script>
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="WorkBuddy">
<meta name="apple-mobile-web-app-status-bar-style" content="default">"""

# ────────────────────────────────────────────────────────────────
# CSS
# 断点 768px（吉吉 2026-09-07 定）：≤768 走移动端，≥769 走桌面。
# iPad 竖屏正好 768，所以 iPad 竖着拿也是移动端版面 —— 这是他要的。
# 本区必须是 <style> 的最后一段 —— 它要覆盖前面三个区（基础 / FQ-UI / WB-AI）的规则，
# 靠的是「同优先级后来者胜」，不靠 !important 堆。
# ────────────────────────────────────────────────────────────────
CSS = r'''
/* ══════════ 移动端布局层 ══════════ */

/* 顶栏和遮罩由 JS 一次性插入，桌面宽度下用 CSS 藏起来 ——
   这样转屏 / 改窗口宽度不需要重跑 JS，纯 CSS 切换。 */
.wbm-top,.wbm-scrim{display:none}

@media (max-width:768px){

/* ── 文档改成整页滚动 ──
   桌面版是 .app 撑满 100vh、main 自己滚。手机上这么做有两个问题：
   iOS 的 100vh 包含了会收起的地址栏（内容被截掉一截），
   而且内部滚动容器在 iOS 上不跟地址栏联动，滚起来别扭。
   所以手机上让文档本体滚。 */
html,body{height:auto;min-height:100%}
html{scroll-padding-top:64px}          /* 锚点/聚焦滚动时别被固定顶栏盖住 */
.app{display:block;height:auto;overflow:visible}
main{overflow:visible;min-height:calc(100vh - 52px)}
body{-webkit-tap-highlight-color:rgba(59,158,255,.14)}

/* ── 固定顶栏 ── */
.wbm-top{display:flex;position:fixed;top:0;left:0;right:0;z-index:60;
  height:calc(52px + env(safe-area-inset-top));padding:env(safe-area-inset-top) 6px 0 6px;
  align-items:center;gap:4px;
  background:rgba(255,255,255,.94);backdrop-filter:saturate(180%) blur(12px);
  -webkit-backdrop-filter:saturate(180%) blur(12px);
  border-bottom:1px solid var(--line)}
.wbm-top .wbm-ic{width:40px;height:40px;flex:0 0 40px;border-radius:8px;
  display:grid;place-items:center;color:var(--ink)}
.wbm-top .wbm-ic:active{background:var(--sel)}
.wbm-top .wbm-ic .fq{width:19px;height:19px}
.wbm-top .wbm-t{flex:1;min-width:0;font-size:15px;font-weight:600;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 2px}

/* ── 左栏改成抽屉 ──
   用的是桌面版那个 .sb 本体，不是复制一份，所以左栏里加了什么手机上自动有。 */
.sb{position:fixed;top:0;bottom:0;left:0;z-index:80;
  width:82vw;max-width:304px;
  padding:calc(14px + env(safe-area-inset-top)) 12px calc(12px + env(safe-area-inset-bottom));
  transform:translateX(-101%);transition:transform .24s ease;
  box-shadow:2px 0 24px rgba(0,0,0,.14)}
body.wbm-open .sb{transform:none}
.wbm-scrim{display:block;position:fixed;inset:0;z-index:75;background:rgba(0,0,0,.42);
  opacity:0;pointer-events:none;transition:opacity .22s}
body.wbm-open .wbm-scrim{opacity:1;pointer-events:auto}
/* 抽屉开着时锁住背景滚动。三层一起写是因为 iOS Safari 上只写 body 的 overflow
   历史上一直不可靠（背景照样能跟着手指滚）：
     · html 也加一层（:has 从 iOS 15.4 起支持）
     · 遮罩自己 touch-action:none，手指落在遮罩上不产生滚动
     · 抽屉内部 overscroll-behavior:contain，滚到底不把外层带着走
   🔴 这一条是照 iOS 已知行为写的，我手上只有桌面 Chrome 模拟器，**没在真机确认过**。 */
body.wbm-open{overflow:hidden}
html:has(body.wbm-open){overflow:hidden}
.wbm-scrim{touch-action:none}
.sb{overscroll-behavior:contain}
.sb-list{overscroll-behavior:contain}
.nav button{padding:11px 10px}                      /* 点击区从 36 提到 42 */
.sb-item{padding:10px}
.sb-foot{padding:10px 8px calc(4px + env(safe-area-inset-bottom))}

/* 第二栏（资料库中间那栏）在手机上不出现 ——
   它和主区的「全部资料」列表是同一批库，手机上留一份就够，
   靠主区列表点进去、靠顶栏返回退出来。 */
.col2{display:none!important}

/* ── 版面 ── */
.wrap{max-width:none;padding:calc(52px + env(safe-area-inset-top) + 18px) 16px 44px}
.page{max-width:none;padding:calc(52px + env(safe-area-inset-top) + 18px) 16px 44px}
.runwrap{max-width:none;padding:calc(52px + env(safe-area-inset-top) + 18px) 16px 46px}

/* 320px 上标题会折成两行，中文默认可以在任意字之间断，
   折出来是「…我帮 / 你」，第二行只剩一个字。balance 让两行长度接近，
   断在标点后面。不支持的浏览器退回普通折行，不会更差。 */
h1{font-size:26px;line-height:1.3;letter-spacing:-.2px;text-wrap:balance}
.sub{font-size:13.5px;margin-top:9px}
.ph h2{font-size:21px}
.ph p{font-size:13.5px;max-width:none}
.ph{margin-bottom:20px}

/* 场景 tab 一行横滑 ——
   6 个 tab 靠 flex-wrap 会折成两三行，外面那个 999px 的灰底包不住多行。 */
.tabs{margin-top:24px;justify-content:flex-start;flex-wrap:nowrap;
  overflow-x:auto;-webkit-overflow-scrolling:touch;
  scrollbar-width:none;scroll-snap-type:x proximity;max-width:100%}
.tabs::-webkit-scrollbar{display:none}
.tabs button{flex:0 0 auto;scroll-snap-align:center;padding:9px 14px}
.scene-note{margin-top:14px;font-size:12.5px;text-align:left}
.pills{justify-content:flex-start;margin-top:16px}
.pill{padding:10px 14px}

/* ── 输入区 ──
   ⚠️ 手机上输入类控件字号必须 ≥16px，否则 iOS Safari 一聚焦就整页放大，
   而且退出聚焦不会自动缩回去 —— 这是移动端最容易漏的一条。 */
.cwrap{margin-top:18px;border-radius:14px}
textarea{font-size:16px;min-height:88px;padding:14px 15px 6px}
.cbar{gap:6px;padding:6px 9px 10px}
.cbar .plus,.mic{width:34px;height:34px}        /* 桌面 30px，手机上偏小 */
.send{width:36px;height:36px;flex:0 0 36px}
.cfoot{flex-wrap:wrap;padding:8px 8px 4px}
.cfoot button{max-width:100%}
.cfoot button span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.model>button{padding:7px 9px;max-width:44vw}
.model>button span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chips{padding:12px 14px 0}
.tagchip button,.filechip .x{padding:5px;margin:-5px}   /* 图标 11-12px，点击区补到 22 以上 */
.askin textarea{font-size:16px}
.fqsr input{font-size:16px}
.fld input,.fld select{font-size:16px;height:44px}

/* ── 浮层改成底部抽屉 ──
   桌面版这两个浮层是 198px / 360px 宽、贴着按钮向上弹；
   手机屏只有 375 左右，贴着弹会顶出屏幕右侧。 */
.ppop,.mpop,.pjpop{position:fixed;left:0;right:0;bottom:0;top:auto;width:auto;
  border-radius:16px 16px 0 0;border:0;border-top:1px solid var(--line);
  padding:8px 8px calc(10px + env(safe-area-inset-bottom));
  max-height:76vh;overflow-y:auto;z-index:90;
  box-shadow:0 -8px 40px rgba(0,0,0,.18)}
.ppop .row,.mpop .row,.mpop .mfoot{height:44px}
.pjrow,.pjnew{padding:12px 10px}
.pjlist{max-height:52vh}
.pjsr input{font-size:16px}   /* 手机上 <16px 一聚焦就整页放大 */
/* 抽屉后面压暗一层：用伪元素而不是新插一个遮罩节点，因为「点空白关闭」
   靠的是页面上原有那个 document click 判 closest('.plusw') / closest('.model')，
   真插一个节点会挡住那次点击。pointer-events:none 让点击穿过去。 */
.ppop::before,.mpop::before,.pjpop::before{content:'';position:fixed;inset:0;z-index:-1;
  background:rgba(0,0,0,.3);pointer-events:none}
.mpop .max{padding:12px 10px 13px}
.mpop .row .nm{font-size:14px}

/* 二级菜单：桌面靠 :hover 从右侧弹出。手机没有 hover，
   而且右侧没地方弹 —— 改成点一级项在原地展开，向下推。 */
.pitem>.row{height:44px}
.pitem:hover>.row{background:none}
.pitem:hover>.ppop2{display:none}
.pitem.wbm-on>.row{background:var(--soft)}
.pitem.wbm-on>.row .ar{transform:rotate(90deg)}
.pitem>.row .ar{transition:transform .16s}
.ppop2{position:static;display:none;width:auto;padding:2px 0 8px 12px;
  margin:0 0 2px 14px;border:0;border-left:2px solid var(--line);
  border-radius:0;box-shadow:none;background:none}
.pitem.wbm-on>.ppop2{display:block}
.p2list{max-height:none}
.p2row{padding:9px 8px}

/* 附件图片预览：桌面是 hover 出小卡，手机改成点一下居中看大图 */
.filechip:hover .fprev{display:none}
.filechip.wbm-on .fprev{display:block;position:fixed;left:14px;right:14px;bottom:auto;
  top:50%;transform:translateY(-50%);z-index:95;text-align:center}
.filechip.wbm-on .fprev img{max-width:100%;max-height:60vh;margin:0 auto}

/* ── 宽表格改成卡片 ──
   四五列的表在 375px 宽里必然被 ellipsis 截掉，而组件 key、图标名这些
   恰恰是要整段看清、要长按复制的内容。thead 收起，每行摊成一张卡。
   列名由 JS 从 thead 抄进 data-label，不在这里写死。

   🔴 标签走「上下叠」不走「左右并排」，两个实测原因：
   ① td 一旦 display:flex，单元格里原有的 <b>、<span> 就变成了 flex 子项，
      会被并排挤成一列一列的 —— 飞鹊组件库那张表的「注意」两个字被压成了竖排。
   ② 列名长度差别很大（「状态」2 字 vs「组件名（Figma 里的真名）」14 字），
      固定宽的标签列要么把长列名折成 3 行，要么把短列名的空白浪费掉。
   上下叠对两者都免疫，代价是卡片高一些。 */
.tbl thead,.atx thead{display:none}
.tbl tbody tr,.atx tbody tr{display:block;background:var(--white);
  border:1px solid var(--line);border-radius:10px;padding:11px 13px;margin:0 0 8px}
.tbl tbody tr:hover,.atx tbody tr:hover{background:var(--white)}
.tbl td,.atx td{display:block;padding:5px 0;border:0;max-width:none;
  white-space:normal;overflow:visible;text-overflow:clip;
  overflow-wrap:anywhere;font-size:13px;line-height:1.7}
.tbl td::before,.atx td::before{content:attr(data-label);display:block;
  font-size:12px;color:var(--ink-3);line-height:1.5;margin:0 0 1px}
.tbl td[data-label=""]::before,.atx td[data-label=""]::before{display:none}
.tbl td.wbm-empty,.atx td.wbm-empty{display:none}
/* 桌面上「状态」列是 width:1% + nowrap 收缩到内容宽，那条规则到了卡片模式会失效成
   「父容器宽度的 1%」—— 实测「已就绪」被压到 18px。卡片里每格独占一行，不需要收缩。 */
.tbl td.st{width:auto;max-width:none;white-space:normal;padding-right:0}
/* 第一列当卡片标题：它就是这一行的身份，头上再顶一个「名称」是噪音 */
.tbl tbody td:first-child,.atx tbody td:first-child{font-size:14.5px;font-weight:600;
  padding:1px 0 7px}
.tbl tbody td:first-child::before,.atx tbody td:first-child::before{display:none}
.atx table{display:block}
.atx td.c1,.atx tr:first-child td:first-child{background:none}

/* 键值表本来就是两列，不用摊 —— 上下叠起来就行 */
.kv td{display:block;padding:8px 0}
.kv td.k{width:auto;padding-right:0;padding-bottom:2px}
.kv tr{display:block;border-bottom:1px solid var(--line-2);padding:3px 0}
.kv td{border:0}

/* ── 网格全部收成一列（或按内容放宽） ── */
.cgrid,.grid2,.grid3,.shgrid,.prov{grid-template-columns:1fr}
/* 案例卡在手机上横过来（图标 | 标题＋说明），竖着排 5 张要滑太久。
   用 grid 而不是 flex-direction:row —— 卡里是「图标 / 标题 / 说明」三个平级子元素，
   flex 会把三个并排成一行，标题和说明挤在一起。 */
.case{display:grid;grid-template-columns:30px 1fr;column-gap:11px;row-gap:3px;
  align-items:start;padding:12px}
.case .ico{grid-row:1 / span 2}
.case .t{grid-column:2;white-space:normal}   /* 手机上一行放不下，允许折行 */
.case .g{grid-column:2}
.icgrid{grid-template-columns:repeat(auto-fill,minmax(74px,1fr))}
.swgrid{grid-template-columns:repeat(auto-fill,minmax(148px,1fr))}
.cases{margin-top:32px}

/* 技能行 / 项目行：右对齐的说明列在窄屏挤成一条，改成上下叠 */
.srow{flex-direction:column;align-items:flex-start;gap:5px}
.srow .ds{margin-left:0;max-width:none;text-align:left}
.srow .code{overflow-wrap:anywhere}
.prow{flex-direction:column;align-items:stretch;gap:10px}
.prow .st{margin-left:0;text-align:left}
.prow .st .u{margin-top:2px}

/* 资料库工具条：搜索框占满一行，tab 横滑 */
.fqbar{flex-wrap:wrap;gap:8px}
.fqtabs{order:2;overflow-x:auto;scrollbar-width:none;max-width:100%}
.fqtabs::-webkit-scrollbar{display:none}
.fqtab{flex:0 0 auto}
.fqsr{order:1;flex:1 0 100%;height:40px}
.fqcnt{order:3;margin-left:auto}
.mono,.shcell code{overflow-wrap:anywhere}
/* 点一下复制的那些值（组件 key、样式 ID、阴影 CSS）在桌面上靠 title 提示，
   而 title 在触屏上永远不出现 —— 组件 key 还是截断显示的，
   不给可点的信号，手机上就是一串看不完又不知道能干什么的字符。
   用虚线下划线 + 链接色表示「这个能点」，不额外加文案。 */
.mono,.shcell code{color:var(--accent-ink);
  text-decoration:underline dotted;text-underline-offset:3px}
.fsrow{flex-wrap:wrap;gap:4px 14px}

/* 自查表：勾选框点击区放大 */
.ckrow{padding:11px 12px}
.ckbox{width:20px;height:20px;margin-top:0}
.ckbox svg{width:13px;height:13px}
.ckh{padding:14px 13px}
.ckbody{padding:2px 10px 4px}

/* 回答区 */
.qtx,.atx{font-size:15px}
.runfoot .rbtn{padding:11px 16px}
/* 参考资料的文件名本身就是要看的信息，窄屏上不截断、改折行。
   桌面版是 nowrap + 省略号（一行摆得下），320px 上会截成
   「project-feique-library-pag…」，看不出是哪份。 */
.srcchip{padding:8px 13px;white-space:normal;overflow:visible;text-overflow:clip;
  text-align:left;overflow-wrap:anywhere;border-radius:12px;line-height:1.55}

/* 设置弹层 */
#wbmask{padding:12px}
.wbdlg{padding:20px 18px;max-height:92vh;border-radius:14px}
.dfoot{flex-wrap:wrap;justify-content:stretch}
.dfoot .msg{flex:1 0 100%;order:3;margin-top:4px}
.dfoot .rbtn{flex:1}

#toast{bottom:calc(26px + env(safe-area-inset-bottom))}

/* 从主屏幕启动、或者横屏时，内容会一直铺到刘海和圆角下面 ——
   开了 viewport-fit=cover 之后浏览器不再自动内缩，左右两边得自己让出来。
   用 max() 而不是直接加，保证竖屏（安全区为 0）时还是原来的 16px。 */
.wrap,.page,.runwrap{padding-left:max(16px,env(safe-area-inset-left));
  padding-right:max(16px,env(safe-area-inset-right))}
.wbm-top{padding-left:max(6px,env(safe-area-inset-left));
  padding-right:max(6px,env(safe-area-inset-right))}
.sb{padding-left:max(12px,env(safe-area-inset-left))}
.ppop,.mpop,.pjpop{padding-left:max(8px,env(safe-area-inset-left));
  padding-right:max(8px,env(safe-area-inset-right))}
#wbmask{padding-left:max(12px,env(safe-area-inset-left));
  padding-right:max(12px,env(safe-area-inset-right))}

/* 返回上一层（资料库详情页用，JS 插入） */
.wbm-back{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--ink-2);
  margin:0 0 14px;padding:6px 0}
.wbm-back .fq{width:15px;height:15px}
}

/* 桌面版面的最小节点就是 1024，再窄不做变化（吉吉 2026-09-07 定）。
   「不做变化」用 min-width 落地：窗口窄过 1024 时版面原样保持、外面出横向滚动条，
   而不是让三栏继续压缩 —— 继续压缩本身就是一种变化，而且 769~1023 这一段
   没人为它画过稿，压出来的样子是没设计过的。
   768 及以下由上面那个 media 接管，直接换成移动端，不经过这个中间态。 */
@media (min-width:769px){
  body{min-width:1024px}

  /* 首页内容在视口里垂直居中（吉吉 2026-09-07：「现在有点向上移了」）。
     原来是固定 padding-top:96px 顶在上面，内容不满一屏时下面空一大片，整体偏高。
     🔴 用 margin:auto 而不是 justify-content:center —— 后者在内容比视口高的时候
     会把溢出的顶部裁掉、而且滚不上去（flex 居中的经典坑）。margin:auto 在没有
     富余空间时自动归零，退回普通的从上往下排。
     只作用于首页 .wrap：资料库、技能这些是长列表，从顶部排才对；
     回答页 .runwrap 是对话流，也必须顶部对齐。 */
  main{display:flex;flex-direction:column}
  /* 🔴 上面这行是为了让 .wrap 的 margin:auto 能做垂直居中，但它有个副作用：
     flex 容器里的元素只要带了 auto 的横向 margin，align-self:stretch 就失效，
     宽度从「撑满容器」变成「按内容收缩」。资料库那张表因此被压到 622px（本该 920），
     「已就绪」标签和「收录」列都被省略号截掉。
     显式写回 width:100% —— 配合各自的 max-width，宽度回到原来的行为，
     横向和纵向的 auto margin 都还在。 */
  main>.page,main>.runwrap,main>.wrap{width:100%}
  /* 上移 30px：视觉重心比几何中心高一点才不显得坠（吉吉 2026-09-07「视觉点有点靠下」）。
     做法是底部多留 60 —— margin:auto 把剩余空间上下均分，元素高 60，
     上下就各少分 30，内容整体正好上移 30px。
     🔴 不用 transform:translateY(-30px)：那个不参与布局，内容比视口高的时候
     会把顶部推到可视区外面、还滚不回去。 */
  .wrap{margin:auto;padding:40px 32px 100px}
}
'''

# ────────────────────────────────────────────────────────────────
# JS
# 本区跑在脚本最末尾，此时 S / render / NAV / ic / LIBS 都在作用域里。
# 三条纪律：
#  1. 不改另外四个区里的任何一行 —— 只在它们渲染完之后加工 DOM。
#  2. 用 MutationObserver 而不是包装 render() —— 因为回答流式输出时
#     是直接写 main.innerHTML 的，不走 render()，包装抓不到那批表格。
#  3. 所有加工都是幂等的，同一段 DOM 被观察器重复处理不会叠加。
# ────────────────────────────────────────────────────────────────
JS = r'''
/* ══════════ 移动端布局层 ══════════ */
(function(){
  var MQ = '(max-width:768px)';
  function onPhone(){ return window.matchMedia(MQ).matches; }

  /* ── 顶栏 + 遮罩：插一次，之后靠 CSS 断点显隐 ── */
  var top = document.createElement('div');
  top.className = 'wbm-top';
  top.innerHTML =
    '<button class="wbm-ic" id="wbmMenu" aria-label="打开菜单">' + ic.fq_category + '</button>' +
    '<div class="wbm-t" id="wbmTitle">UED WorkBuddy</div>' +
    '<button class="wbm-ic" id="wbmSet" aria-label="设置">' + ic.fq_setting + '</button>';
  document.body.insertBefore(top, document.body.firstChild);

  var scrim = document.createElement('div');
  scrim.className = 'wbm-scrim';
  document.body.appendChild(scrim);

  function openDrawer(v){ document.body.classList.toggle('wbm-open', v !== false); }
  document.getElementById('wbmMenu').addEventListener('click', function(e){
    e.stopPropagation(); openDrawer(!document.body.classList.contains('wbm-open'));
  });
  document.getElementById('wbmSet').addEventListener('click', function(e){
    e.stopPropagation(); openDrawer(false);
    if(typeof window.wbSettings === 'function') window.wbSettings();
  });
  scrim.addEventListener('click', function(){ openDrawer(false); });
  /* 左栏里点任何导航都关抽屉 —— 点完停在原地看不到结果，是抽屉最常见的毛病 */
  document.querySelector('.sb').addEventListener('click', function(e){
    if(e.target.closest('button')) setTimeout(function(){ openDrawer(false); }, 90);
  });
  window.addEventListener('keydown', function(e){ if(e.key === 'Escape') openDrawer(false); });

  /* ── 顶栏标题跟着当前页 ── */
  var NAV_NAME = {};
  try{ NAV.forEach(function(r){ NAV_NAME[r[0]] = r[1]; }); }catch(e){}
  function titleNow(){
    if(S.view === 'new')  return 'UED WorkBuddy';
    if(S.view === 'run')  return '任务';
    if(S.view === 'lib'){
      try{ return LIBS[S.lib].n; }catch(e){ return '资料库'; }
    }
    return NAV_NAME[S.view] || 'UED WorkBuddy';
  }

  /* ── 宽表格摊成卡片：把 thead 的列名抄进每个 td 的 data-label ──
     列名不在 CSS 里写死，表结构改了这里自动跟着变。 */
  function labelTables(root){
    var tables = root.querySelectorAll('table.tbl, .atx table');
    for(var i = 0; i < tables.length; i++){
      var t = tables[i];
      if(t.getAttribute('data-wbm') === '1') continue;   /* 幂等：处理过就跳过 */
      var head = t.querySelector('thead tr');
      var names = [];
      if(head){
        var ths = head.children;
        for(var h = 0; h < ths.length; h++) names.push((ths[h].textContent || '').trim());
      }
      var rows = t.querySelectorAll('tbody tr');
      for(var r = 0; r < rows.length; r++){
        var tds = rows[r].children;
        for(var c = 0; c < tds.length; c++){
          var td = tds[c];
          td.setAttribute('data-label', names[c] || '');
          /* 空单元格在卡片里会留一条空行，标出来让 CSS 收掉 */
          if(!(td.textContent || '').trim() && !td.querySelector('svg,img')) td.classList.add('wbm-empty');
          else td.classList.remove('wbm-empty');
        }
      }
      t.setAttribute('data-wbm', '1');
    }
  }

  /* ── 资料库详情页补一个返回 ──
     桌面版是靠中间那栏切库的，手机上中间栏不出现，所以要给一条回去的路。 */
  function backLink(root){
    if(S.view !== 'lib') return;
    var ph = root.querySelector('.page');
    if(!ph || ph.querySelector('.wbm-back')) return;
    var b = document.createElement('button');
    b.className = 'wbm-back';
    b.innerHTML = ic.fq_left + '<span>全部资料</span>';
    b.addEventListener('click', function(){ S.lib = null; go('libs'); });
    ph.insertBefore(b, ph.firstChild);
  }

  /* ── 场景 tab 横滑：把选中的那个滚进视野 ── */
  function scrollTabIntoView(root){
    var on = root.querySelector('.tabs button.on');
    if(!on || !on.parentNode) return;
    var box = on.parentNode;
    if(box.scrollWidth <= box.clientWidth + 2) return;
    box.scrollLeft = on.offsetLeft - (box.clientWidth - on.offsetWidth) / 2;
  }

  function apply(){
    var main = document.getElementById('main');
    if(!main) return;
    var t = document.getElementById('wbmTitle');
    if(t) t.textContent = titleNow();
    if(!onPhone()) return;          /* 桌面宽度下不加工，省掉无用的 DOM 写入 */
    labelTables(main);
    backLink(main);
    scrollTabIntoView(main);
    fixHints();
  }

  /* 观察 main 的整棵子树 —— render() 和流式输出都会命中，
     用 rAF 合并，流式期间每帧最多跑一次。 */
  var pending = false;
  function schedule(){
    if(pending) return;
    pending = true;
    requestAnimationFrame(function(){ pending = false; apply(); });
  }
  new MutationObserver(schedule).observe(document.getElementById('main'),
    {childList:true, subtree:true});
  window.addEventListener('resize', schedule);
  apply();

  /* ── 换页要回到页顶 ──
     桌面版滚的是 main，手机上滚的是文档，原来那两句 main.scrollTop=0 / main.scrollTo
     在手机上是空操作，结果切页之后还停在上一页的位置。 */
  function toTop(smooth){
    if(!onPhone()) return;
    window.scrollTo(smooth ? {top:0, behavior:'smooth'} : {top:0});
  }
  if(typeof go === 'function'){
    var origGo = go;
    go = window.go = function(v){ origGo(v); toTop(false); };
  }
  if(typeof pickCase === 'function'){
    var origPickCase = pickCase;
    pickCase = window.pickCase = function(sc, ci){
      origPickCase(sc, ci);
      if(onPhone()){
        var c = document.querySelector('.cwrap');
        if(c) c.scrollIntoView({block:'center', behavior:'smooth'});
      }
    };
  }

  /* ── 回车键：手机上不发送，只换行 ──
     页面上原有的行为是「回车发送、Shift + 回车换行」，那是给物理键盘定的。
     手机软键盘没有能配合的 Shift，而场景模板本身就是多行、带【】占位符要逐个填，
     一按回车就发出去等于没法在手机上改模板。
     这里用捕获阶段先截住：原来那个监听挂在 document 的冒泡阶段，
     捕获阶段 stopPropagation 就到不了它，回车回落成 textarea 的默认换行。 */
  document.addEventListener('keydown', function(e){
    if(!onPhone()) return;
    if(e.key !== 'Enter' || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    if(t && t.tagName === 'TEXTAREA') e.stopPropagation();
  }, true);

  /* 那两句键盘提示在手机上是错的，换成手机上真实的操作 */
  function fixHints(){
    if(!onPhone()) return;
    var ta = document.getElementById('ta');
    if(ta && ta.placeholder.indexOf('回车') >= 0)
      ta.placeholder = ta.placeholder.replace(/（回车发送[^）]*）/, '');
    document.querySelectorAll('.askhint').forEach(function(h){
      if(h.textContent.indexOf('回车') >= 0) h.textContent = '写完点右边的发送键';
    });
  }

  /* ── 悬停触发改成点击触发 ──
     触屏没有 hover。这两处桌面版都只靠 CSS :hover，手机上等于点不开。 */
  document.addEventListener('click', function(e){
    if(!onPhone()) return;

    /* + 菜单的一级项：点开二级 */
    var row = e.target.closest('.pitem > .row');
    if(row){
      var item = row.parentNode, was = item.classList.contains('wbm-on');
      var sibs = item.parentNode.querySelectorAll('.pitem');
      for(var i = 0; i < sibs.length; i++) sibs[i].classList.remove('wbm-on');
      if(!was) item.classList.add('wbm-on');
      e.stopPropagation();
      return;
    }

    /* 附件标签：点一下看大图，再点收起（点 × 不算） */
    var chip = e.target.closest('.filechip');
    if(chip && !e.target.closest('.x')){
      if(chip.querySelector('.fprev')) chip.classList.toggle('wbm-on');
      e.stopPropagation();
      return;
    }
    var opened = document.querySelector('.filechip.wbm-on');
    if(opened) opened.classList.remove('wbm-on');
  }, true);
})();
'''


def block(page, begin, end, body, anchor):
    """替换标记之间的内容；没有标记就插到 anchor 之前。"""
    new = begin + '\n' + body.strip() + '\n' + end
    if begin in page and end in page:
        a = page.index(begin)
        b = page.index(end) + len(end)
        return page[:a] + new + page[b:]
    if anchor not in page:
        sys.exit('找不到插入位置：' + anchor)
    i = page.index(anchor)
    return page[:i] + new + '\n' + page[i:]


def main():
    page = open(PAGE, encoding='utf-8').read()
    before = len(page)

    page = block(page, META_B, META_E, META, '<title>')
    page = block(page, CSS_B, CSS_E, CSS, '</style>')
    page = block(page, JS_B, JS_E, JS, '</script>')

    open(PAGE, 'w', encoding='utf-8').write(page)
    print('移动端层已注入 index.html')
    print('  CSS %d 字符 · JS %d 字符 · 文件 %d → %d 字节'
          % (len(CSS), len(JS), before, len(page)))


if __name__ == '__main__':
    main()
