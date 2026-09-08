#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""在 WorkBuddy 页面上加一层「选项式向导」，输出到 wizard.html。

🔴 跟其他 patch-*.py 不一样的两点：
  1. 它不改 index.html —— 读 index.html，写 wizard.html。吉吉说先不部署，
     所以线上那份一个字不动。以后要上线，把 OUT 改成 PAGE 就行。
  2. 所以它必须在其他所有 patch 之后跑（它吃的是成品）。

做的事：点场景卡片的时候，除了照旧把模板填进输入框，再弹一层分步向导：
左边一步一步勾选和填空，右边任务单实时长出来，填完直接让 WorkBuddy 回答
（不是复制到别处 —— WorkBuddy 自己就有知识库和模型）。
"""
import os, sys, subprocess, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PAGE = os.path.join(ROOT, 'index.html')
OUT  = os.path.join(ROOT, 'wizard.html')

CSS_B, CSS_E = '/* ==WB-WIZ-CSS:BEGIN== */', '/* ==WB-WIZ-CSS:END== */'
JS_B,  JS_E  = '/* ==WB-WIZ-JS:BEGIN== */',  '/* ==WB-WIZ-JS:END== */'

# ═══════════════════════════════════════════════════════════
# 视觉：全部用 WorkBuddy 自己的 token
# 🔴 不照搬那份 demo 的红按钮蓝步骤条 —— 底座是 WorkBuddy，
#    一个页面两套配色是最容易被同事一眼看出「拼起来的」。
# ═══════════════════════════════════════════════════════════
CSS = r'''
/* ═══ 向导层的色值全部按飞鹊 SOT 走，不用 WorkBuddy 那套 ═══
   吉吉 2026-09-08 走查：「很多 UI 有点太淡了」。
   查过 feique-tokens.json 才知道根因不是「浅了几个色阶」，是分档丢了 ——
   WorkBuddy 的 --line 是 #EBEBEB 一个值包打天下（那套照 Claude 界面采样，
   Claude 不区分「能点的」和「装饰的」），而飞鹊分三档：
     #CED3D9  按钮描边，也是输入框描边的实测值（1px INSIDE）← 最深，给能点的
     #DAE0E6  列表分割线
     #E6ECF2  模块 / 边框描边                              ← 最浅，给装饰的
   在 .wizmask 里重定义，靠 CSS 变量作用域圈住 —— WorkBuddy 本体一个像素不受影响。

   🔴 `.wz-peek`（点文档名弹的浮层）必须一起列在这里。它挂在 <body> 下、
   跟 .wizmask 平级不是后代（那样挂是为了不被 WorkBuddy 的 render() 重写 #main），
   所以拿不到 .wizmask 上的变量 —— 实测它的 border-radius 直接失效成 0px、
   描边和文字色还留在 WorkBuddy 的原值上。而圆角门查不出来：
   字面量写的是 var(--box-r)，看着完全合法。
   → 往后再往 <body> 下加顶层元素，记得加进下面这个选择器列表。 */
.wizmask,.wz-peek{
  --line:#DAE0E6;      /* 原 #EBEBEB */
  --line-2:#E6ECF2;    /* 原 #F0F0F0 */
  --ink:#222;          /* 原 #333 · text/title */
  --ink-2:#555;        /* 原 #666 · text/main */
  --ink-3:#888;        /* 原 #A0A0A0 · text/auxiliary —— 之前浅了一档半，大面积灰字最费眼 */
  --dark:#222;         /* 原 #1A1A1A · primary/dark */
  --ctl:#CED3D9;       /* 🔴 能点的东西专用：输入框 / 按钮 / 选项 / 勾选框 */
  --ctl-r:4px;         /* 控件级圆角 · 输入框/勾选框/选项/标签 —— 飞鹊「输入类全族」实测值 */
  --box-r:8px;         /* 容器级圆角 · 问题区/绿条/步骤条/模态/浮层 —— 飞鹊「表单卡片容器」「Alert/Message」实测值 */
}
.wizmask{position:fixed;inset:0;z-index:200;background:rgba(26,26,26,.34);
  display:none;align-items:center;justify-content:center;padding:28px}
.wizmask.wzon{display:flex}
.wiz{width:min(1180px,100%);height:min(860px,calc(100vh - 56px));background:var(--white);
  border-radius:var(--box-r);box-shadow:0 24px 80px rgba(0,0,0,.22);
  display:flex;flex-direction:column;overflow:hidden}

/* ── 头 ── */
.wz-hd{display:flex;align-items:center;gap:10px;padding:16px 20px;border-bottom:1px solid var(--line);flex:0 0 auto}
.wz-tag{font-size:12px;color:var(--accent-ink);background:var(--accent-fill);
  border:1px solid var(--accent-line);border-radius:999px;padding:2px 10px;flex:0 0 auto}
.wz-t{font-size:16px;font-weight:600;color:var(--ink)}
.wz-x{margin-left:auto;border:0;background:none;font-size:22px;line-height:1;color:var(--ink-3);
  cursor:pointer;padding:0 4px;border-radius:var(--ctl-r)}
/* 吉吉 2026-09-08：关闭键悬停「应该是高亮，不要底色」。
   原来那块 var(--soft) 灰底看着像多了个方块。去掉底色、只把图标本身从
   #888 提到 #222 —— 这也跟 WorkBuddy 自己的惯例一致：它的关闭键是
   `.x:hover{opacity:1}`，其余次级按钮一律 `:hover{color:var(--ink)}`，都不加底色。 */
.wz-x:hover{color:var(--ink)}

.wz-body{flex:1;display:flex;min-height:0}
.wz-main{flex:1;overflow:auto;padding:18px 22px 26px;background:var(--soft);min-width:0}
.wz-side{width:340px;flex:0 0 auto;border-left:1px solid var(--line);overflow:auto;
  padding:18px 18px 26px;background:var(--white)}

/* ── 步骤条 ── */
.wz-steps{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 16px}
.wz-steps .wzs{flex:1 1 150px;display:flex;align-items:center;gap:8px;padding:11px 13px;
  border:1px solid var(--line);border-radius:var(--box-r);background:var(--white);
  font-size:13px;color:var(--ink-3);cursor:pointer;text-align:left}
.wz-steps .wzs .i{width:19px;height:19px;flex:0 0 auto;border-radius:50%;border:1px solid var(--line);
  display:grid;place-items:center;font-size:11px}
.wz-steps .wzs.wzon{border-color:var(--accent-line);background:var(--accent-fill);color:var(--accent-ink);font-weight:500}
.wz-steps .wzs.wzon .i{background:var(--accent);border-color:var(--accent);color:#fff}
.wz-steps .wzs.wzdone{color:var(--ink-2)}
.wz-steps .wzs.wzdone .i{background:var(--accent-fill);border-color:var(--accent-line);color:var(--accent-ink)}

/* ── 「已经替你查了」那条 ── */
.wz-auto{border:1px solid var(--line);border-radius:var(--box-r);background:var(--white);
  margin:0 0 16px;overflow:hidden}
.wz-auto.bad{border-color:#F0DCB4}
.wz-ah{width:100%;display:flex;align-items:center;gap:9px;padding:13px 15px;border:0;
  background:none;cursor:pointer;text-align:left;font-size:13px;color:var(--ink)}
.wz-ah .wzspin{width:14px;height:14px;border:2px solid var(--accent-line);border-top-color:var(--accent);
  border-radius:50%;animation:wzsp .7s linear infinite;flex:0 0 auto}
@keyframes wzsp{to{transform:rotate(360deg)}}
.wz-ah .ok{color:var(--accent-ink);font-size:14px;flex:0 0 auto}
.wz-ah .wzn{font-size:12px;color:var(--ink-3);margin-left:auto;flex:0 0 auto}
.wz-ah .real{font-size:11px;color:var(--accent-ink);background:var(--accent-fill);
  border:1px solid var(--accent-line);border-radius:999px;padding:1px 7px;flex:0 0 auto}
.wz-al{list-style:none;margin:0;padding:0 15px 13px;border-top:1px solid var(--line-2)}
.wz-auto.fold .wz-al{display:none}
.wz-al li{display:flex;gap:9px;padding:9px 0;font-size:13px;color:var(--ink-2);
  border-bottom:1px solid var(--line-2);line-height:1.7}
.wz-al li:last-child{border-bottom:0}
.wz-al li .wzd{width:6px;height:6px;border-radius:50%;background:var(--line);margin-top:7px;flex:0 0 auto}
.wz-al li.ok .wzd{background:var(--accent)}
/* 「没查到」用琥珀不用红：那不是报错，是需要人看见的一件事实 */
.wz-al li.miss .wzd{background:#C77700}
.wz-al li .bd{flex:1;min-width:0}
.wz-dt{display:block;margin-top:5px;font-size:12px;color:var(--ink-3);line-height:1.8}
.wz-dt b{color:#C77700;font-weight:500}
a.wz-doc{display:inline-block;margin:3px 5px 0 0;padding:2px 8px;border-radius:var(--ctl-r);
  background:var(--soft);border:1px solid var(--line);color:var(--ink-2);font-size:12px;
  text-decoration:none;max-width:250px;overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap;vertical-align:middle}
a.wz-doc:hover{border-color:var(--accent-line);background:var(--accent-fill);color:var(--accent-ink)}
.wz-more{font-size:12px;color:var(--ink-3)}

/* ── 问题区 ── */
.wz-q{background:var(--white);border:1px solid var(--line);border-radius:var(--box-r);padding:20px 22px 4px}
.wz-qt{font-size:15px;font-weight:600;color:var(--ink);margin:0 0 3px}
.wz-qh{font-size:13px;color:var(--ink-3);margin:0 0 20px}
.wz-item{margin:0 0 22px}
.wz-lbl{display:flex;gap:7px;font-size:14px;color:var(--ink);font-weight:500;margin:0 0 4px}
.wz-lbl .no{color:var(--ink);font-weight:400;flex:0 0 auto}   /* #222 · 吉吉 09-08 指定题号也用 222 */
.wz-hint{font-size:12px;color:var(--ink-3);line-height:1.75;margin:0 0 10px}
.wz-item input[type=text],.wz-item textarea{width:100%;box-sizing:border-box;font:inherit;
  font-size:14px;color:var(--ink);padding:10px 13px;border:1px solid var(--ctl);
  border-radius:var(--ctl-r);background:var(--white);outline:none;resize:vertical}
/* 🔴 placeholder 之前吃浏览器默认色（约 #757575），深得像已经填好的内容 ——
   这是「看不出是输入框」的真因，比描边更要紧。飞鹊 text/disable = #B3B3B3。 */
.wz-item input[type=text]::placeholder,.wz-item textarea::placeholder{color:#B3B3B3}
/* focus 态：吉吉 09-08「不要用投影，就用渐变描边就行」。
   原来是 box-shadow 3px 光晕，那圈柔光让输入框看着像个浮层。
   🔴 飞鹊没有 gradient token（查过 feique-tokens：阴影三级、hover 色都有，渐变一条没有），
   所以这个渐变是按吉吉要求做的，不是规范值。用 WorkBuddy 的 accent 起头
   （不用飞鹊蓝 #007DFA —— 向导叠在 WorkBuddy 上，蓝要跟本体一致）。 */
.wz-item input[type=text]:focus,.wz-item textarea:focus{
  border-color:transparent;
  background:linear-gradient(var(--white),var(--white)) padding-box,
             linear-gradient(150deg,var(--accent-ink) 0%,var(--accent) 60%,#5FB0FF 100%) border-box}
/* 🔴 渐变两端都要够深。第一版收在 --accent-line #BDDCFF（对白底 1.3:1），
   1px 描边上那一端等于消失 —— 又做出一个「太淡」。现在 #1682E8→#3B9EFF→#5FB0FF，
   最浅那端也有 2.3:1。 */
/* 🔴 原来这里给已填态套 --accent-line（#BDDCFF），比 #CED3D9 还淡 ——
   填了字反而边框变浅，正反馈做成了负反馈。已填不再改描边：
   框里有字本身就是反馈，右栏任务单还会把它列进「确定」。 */
.wz-opts{display:flex;flex-direction:column;gap:8px}
.wz-opt{display:flex;gap:11px;align-items:flex-start;padding:12px 14px;border:1px solid var(--ctl);
  border-radius:var(--ctl-r);background:var(--white);cursor:pointer;font-size:14px;color:var(--ink)}
.wz-opt:hover{border-color:var(--accent-line);background:var(--accent-fill)}
.wz-opt.wzon{border-color:var(--accent);background:var(--accent-fill)}
.wz-opt .bx{width:16px;height:16px;flex:0 0 auto;margin-top:2px;border:1px solid var(--ctl);
  border-radius:var(--ctl-r);background:var(--white);position:relative}
.wz-opt.rd .bx{border-radius:50%}
.wz-opt.wzon .bx{border-color:var(--accent);background:var(--accent)}
/* 飞鹊勾（yes2.svg）在四个地方用，尺寸各不同，统一在这里给 */
.wz-ck{display:block;flex:0 0 auto}
.wz-steps .wzs .i .wz-ck{width:11px;height:11px;color:var(--accent-ink)}
.wz-ah .ok .wz-ck{width:13px;height:13px;color:var(--accent-ink)}
.rc-item .mk .wz-ck{width:11px;height:11px;color:var(--accent-ink);margin-top:3px}
/* 勾用飞鹊 yes2.svg，不再用 border+rotate 拼 */
.wz-opt .bx .wz-ck{display:none}
.wz-opt.wzon .bx .wz-ck{display:block;width:12px;height:12px;color:#fff;
  position:absolute;left:1px;top:1px}
/* 🔴 单选圆点：原来这条只有位置没有 content 和 position —— 那是「勾用 border+rotate 拼」
   那个年代的残留，换成 yes2.svg 之后基础规则被删掉、这条覆盖规则留下来了。
   在此之前没有任何一张卡用单选，所以一直没被发现（选中会是一个没有白点的蓝圆）。
   视觉稿第 2 步「三种基准」是真的单选，所以补齐。 */
.wz-opt.rd.wzon .bx::after{content:'';position:absolute;
  left:4px;top:4px;width:6px;height:6px;border:0;border-radius:50%;
  background:#fff;transform:none}
.wz-opt .od{display:block;font-size:12px;color:var(--ink-3);margin-top:3px;line-height:1.7}

/* ── 右侧任务单 ── */
.rcpt-t{text-align:center;font-size:15px;font-weight:600;color:var(--ink);letter-spacing:3px}
.rcpt-sub{text-align:center;font-size:12px;color:var(--ink-3);line-height:1.8;margin:5px 0 0}
.rcpt-div{display:flex;align-items:center;gap:9px;font-size:12px;color:var(--ink-3);margin:18px 0 10px}
.rcpt-div::before,.rcpt-div::after{content:'';flex:1;border-top:1px dashed var(--line)}
.rc-list{list-style:none;margin:0;padding:0}
.rc-item{display:flex;gap:8px;padding:8px 0;border-bottom:1px solid var(--line-2);font-size:12px}
.rc-item:last-child{border-bottom:0}
.rc-item .mk{color:var(--accent-ink);flex:0 0 auto}
.rc-item.off .mk{color:var(--ink-3)}
.rc-item .wznm{display:block;color:var(--ink-2);line-height:1.7}
.rc-item.off .wznm{color:var(--ink-3)}
.rc-item .vl{display:block;color:var(--ink);margin-top:2px;line-height:1.7;word-break:break-word}
.rc-empty{font-size:12px;color:var(--ink-3);line-height:1.9;text-align:center;padding:10px 6px}
.rc-sum{display:flex;align-items:baseline;margin:16px 0 0;padding-top:14px;border-top:1px solid var(--line)}
.rc-sum .lb{font-size:13px;color:var(--ink)}
.rc-sum .wzn{margin-left:auto;font-size:22px;font-weight:600;color:var(--ink)}
.rc-out,.rc-kit{list-style:none;margin:0;padding:0}
.rc-out li,.rc-kit li{font-size:12px;color:var(--ink-2);padding:5px 0 5px 12px;position:relative;line-height:1.7}
.rc-out li::before,.rc-kit li::before{content:'';position:absolute;left:2px;top:12px;
  width:4px;height:4px;border-radius:50%;background:var(--line)}
.rc-kit li .sn{color:var(--ink);font-weight:500}
.rc-kit li .wzsw{display:block;color:var(--ink-3);margin-top:1px}

/* ── 底 ── */
.wz-ft{display:flex;align-items:center;gap:10px;padding:14px 20px;border-top:1px solid var(--line);flex:0 0 auto}
.wz-prog{font-size:13px;color:var(--ink-2)}
.wz-btn{font:inherit;font-size:13px;padding:9px 18px;border-radius:999px;cursor:pointer;
  border:1px solid var(--ctl);background:var(--white);color:var(--ink)}
.wz-btn:hover{background:var(--soft)}
.wz-btn.wzpri{background:var(--dark);border-color:var(--dark);color:#fff}
.wz-btn.wzpri:hover{background:#000;border-color:#000}   /* primary/dark hover 真值 */
.wz-btn:disabled{opacity:.4;cursor:default}
.wz-tip{font-size:12px;color:var(--ink-3)}

/* ── 点文档名看原文 ── */
.wz-peek{position:fixed;right:26px;bottom:26px;width:430px;max-height:50vh;z-index:220;
  background:var(--white);border:1px solid var(--line);border-radius:var(--box-r);
  box-shadow:0 18px 60px rgba(0,0,0,.2);display:none;flex-direction:column;overflow:hidden}
.wz-peek.wzon{display:flex}
.wz-ph{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--line-2);
  font-size:13px;color:var(--ink);flex:0 0 auto}
.wz-ph b{font-weight:600}
.wz-ph .wzst{font-size:12px;color:var(--ink-3)}
.wz-ph .wzx{margin-left:auto;border:0;background:none;font-size:18px;color:var(--ink-3);cursor:pointer}
.wz-pb{padding:12px 14px;overflow:auto;font-size:12px;line-height:1.85;color:var(--ink-2);word-break:break-word}

@media (max-width:900px){
  .wizmask{padding:0}
  .wiz{height:100vh;border-radius:0;width:100%}
  /* 🔴 光写 flex-direction:column 不够 —— 实测 390px 下任务单直接盖住了问题区。
     真因是两个 flex-basis 打架：`.wz-main` 是 flex:1（basis 0%），而 `.wz-side`
     是 flex:0 1 auto（basis = 它自己 1100 多 px 的内容高）。竖排之后容器高度固定、
     可分配空间是负的，于是按 basis 收缩 —— main 的 basis 是 0，被压到只剩一条，
     side 占掉整屏。而横向并没有溢出，所以「有没有横向溢出」这类检查一个字都报不出来。
     改成整列一起滚：问题在上，任务单在下面接着，谁都不压谁。 */
  .wz-body{flex-direction:column;overflow:auto}
  .wz-main{flex:0 0 auto;overflow:visible}
  .wz-side{flex:0 0 auto;width:auto;border-left:0;border-top:1px solid var(--line)}
  .wz-peek{right:8px;left:8px;bottom:8px;width:auto}
}
'''

# ═══════════════════════════════════════════════════════════
# JS
# ═══════════════════════════════════════════════════════════
JS = r'''
/* =========================================================
   选项式向导
   为什么加这一层：WorkBuddy 原来只有一个万能输入框 —— 万能，也空。
   点场景卡片给你一句模板，但「该说到什么程度」还是靠自己。
   这一层把「该确定哪几件事」写死成分步选项，答完直接交给
   WorkBuddy 自己的知识库和模型 —— 不是复制到别处去。
   ========================================================= */

/* WIZ · key = 场景id/卡片序号。这里没登记的卡片照旧只填模板，不弹向导。
   🔴 故意跟 SCENES 分开：铺开别的卡片只往这里加条目，不动上面那份场景数据。 */
const WIZ = {
  'design/0': {
    file:'docs/ued/MIC-XXX/04-交互稿.md',
    /* 这三条会真跑（下面 wzAuto）。原来那份 demo 里它是纯动画：
       写着「已经替你跑完了」，其实一件都没查。 */
    auto:[
      { kind:'kb', q:'UED 交互自查表 交互自查 自查表',            label:'检索 UED 交互自查表' },
      { kind:'kb', q:'交互专家 七维度 脑回路 问题定义 信息架构',    label:'检索交互专家 7 维度脑回路' },
      { kind:'kb', q:'状态枚举 空态 加载态 错误态 极限值 未登录',    label:'检索状态与极限值清单' }
    ],
    steps:[
      { t:'确认输入', h:'输入越全，越不会边画边发明',
        qs:[
          { k:'i1', type:'check', q:'手上有哪些输入？',
            opts:[['PRD 文档',''],['上一步的业务分析',''],['竞品分析结论',''],
                  ['已有的 Figma 参考稿',''],['线上现有页面',''],
                  ['只有一句口头需求','那先回「前期调研」把业务问清楚']] },
          { k:'i2', type:'text', q:'如果 PRD 和视觉稿冲突，以哪个为准？',
            ph:'默认以需求文档为准，并把差异同步回另一份' }
        ]},
      { t:'圈定范围', h:'范围不圈，画到一半才发现漏了一个端',
        qs:[
          { k:'i3', type:'check', q:'要覆盖哪些端？',
            opts:[['PC 英文主站',''],['触屏站',''],['买家 App',''],['供应商 App',''],
                  ['多语站','多语版常是简化版，规则跟主站不一样']] },
          { k:'i4', type:'text', q:'涉及哪几个页面？从哪进、从哪出？',
            ph:'把入口和出口写清楚，中间才不会漏页' }
        ]},
      { t:'过 7 维度', h:'挑相关的认真过。答不上的那一维，就是稿子的洞',
        qs:[
          { k:'i5', type:'check', q:'本次需要重点过哪几维？',
            opts:[['01 问题定义','这是需求还是真实问题，翻译过了吗'],
                  ['02 用户研究','用户在什么条件下会做这个行为'],
                  ['03 信息架构','信息按决策路径排了吗'],
                  ['04 任务流程','认知/操作/决策/情绪/信任五类阻力怎么应对'],
                  ['05 反馈与状态','11 态想全了吗'],
                  ['06 空间与导航','Push 还是 Modal 还是 Drawer，依据是什么'],
                  ['07 验证迭代','方案背后的假设怎么验']] },
          { k:'i6', type:'area', q:'这次最没把握的一维，卡在哪？',
            hint:'写出来。答不上的要去问 PM 或业务，不要含糊带过 —— 含糊带过的问题会在验收时集中暴露。' }
        ]},
      { t:'状态枚举', h:'人和模型都爱只画成功态，真实用户更常遇到别的',
        qs:[
          { k:'i7', type:'check', q:'哪些状态本次必须画？',
            opts:[['默认态',''],['加载态','200ms 内不展示 / 300ms 骨架屏 / 超时给重试'],
                  ['空态',''],['错误态',''],['无权限',''],
                  ['未登录','MIC 有 4 层登录态，别只画一种'],
                  ['超时',''],['禁用态',''],['首次使用',''],
                  ['极值','超长文案、超多条目'],['弱网','']] }
        ]}
    ],
    out:['交互说明（每个决策带「为什么」）','完整状态清单','页面流转图（含异常分支）',
         'GSSM 设计目标表','追问清单（答不上的标出来）','交付前自检表'],
    skills:[['MIC-交互','7 维度 + UED 交互自查表 + 上游追问'],
            ['UX-Figma-MD','交互稿转结构化文档'],
            ['figma-feique-first','交互稿直接做到视觉级，真组件绑 token'],
            ['MIC-表达','正面写、具体、可验证']]
  },

  /* ── 设计稿 · 视觉稿 ─────────────────────────────────────────
     跟交互稿栽的地方不一样：交互稿栽在「状态没枚举」，视觉稿栽在「基准没定」——
     照线上还原 / 在现有页面上改局部 / 全新页面，这三种的做法完全不同，
     选错了是整套重来。所以第 2 步是它独有的，而且是单选。 */
  'design/1': {
    file:'docs/ued/MIC-XXX/05-视觉稿交付说明.md',
    /* 三条都验过命中的是哪几份文档，不是只看段数 —— 检索有命中不等于命中对的那句话 */
    auto:[
      { kind:'kb', q:'飞鹊视觉规范 字号阶梯 色值 间距 token', label:'检索飞鹊视觉规范真值（字号 / 色值 / 间距）' },
      { kind:'kb', q:'视觉稿 状态 独立画布 状态墙 空态 加载态', label:'检索状态墙与独立画布的做法' },
      { kind:'kb', q:'图层命名 组件真名回写 交付给前端 规范', label:'检索交付给前端的命名与组件真名规则' }
    ],
    steps:[
      { t:'确认输入', h:'视觉稿最常见的返工，是没等交互稿定下来就先画',
        qs:[
          { k:'v1', type:'check', q:'手上有哪些输入？',
            opts:[['已定稿的交互稿',''],['PRD 文档',''],['线上现有页面',''],
                  ['GSSM 设计目标表',''],['已有的飞鹊参考稿',''],
                  ['交互稿还没定','那先回「交互稿」把流程和状态定下来，否则画完流程一变就得重画']] },
          { k:'v2', type:'text', q:'参考的线上页面是哪一个？',
            ph:'贴网址。没有线上参照就写「新页面，无线上参照」' }
        ]},
      { t:'定基准', h:'这一问决定整套做法。三种基准的工作方法不一样，选错要重来',
        qs:[
          { k:'v3', type:'radio', q:'这次的视觉基准是哪一种？',
            opts:[['照线上 1:1 还原','按测量值复刻，差异逐项对齐。线上设计本身有问题的地方单独标出来，不顺手改'],
                  ['在现有页面上改局部','只动要改的那块，其余保持线上现状'],
                  ['全新页面','没有线上参照，用飞鹊组件从零搭']] },
          { k:'v4', type:'check', q:'要覆盖哪些端？',
            hint:'Web 端和移动端是两套飞鹊组件库，编号不通用 —— 这一问决定用哪套。',
            opts:[['PC 英文主站',''],['触屏站',''],['买家 App',''],['供应商 App',''],
                  ['多语站','多语版常是简化版，规则跟主站不一样'],
                  ['阿语（RTL）','整段镜像，字体另有规范']] }
        ]},
      { t:'组件与取值', h:'飞鹊有的就用真组件，别手画 —— 手画的那个前端对不上名字',
        qs:[
          { k:'v5', type:'radio', q:'飞鹊组件够用吗？',
            opts:[['够用，全部用现成组件',''],
                  ['有一两个要用现有组件拼','拼的时候不新造样式，取值仍走规范'],
                  ['有飞鹊完全没有的','写清是哪个。先确认是不是换个形态就能解决，别急着新造']] },
          { k:'v6', type:'area', q:'哪些取值需要先确认？',
            hint:'字号、颜色、间距只要拿不准就写出来。飞鹊正文最大 18px、不用奇数字号，色值取规范真值不自己调 —— 拿不准的写出来比自己定一个更省事。' }
        ]},
      { t:'状态画布与交付', h:'每个状态一张独立画布。只画成功态的稿，前端做到一半才发现没得参照',
        qs:[
          { k:'v7', type:'check', q:'哪些状态要各出一张画布？',
            opts:[['默认态',''],['加载态','200ms 内不展示 / 300ms 骨架屏 / 超时给重试'],
                  ['空态',''],['错误态',''],['无权限',''],
                  ['未登录','MIC 有 4 层登录态，别只画一种'],
                  ['超时',''],['禁用态',''],['首次使用',''],
                  ['极值','超长标题、超长价格、超多条目'],['弱网','']] },
          { k:'v8', type:'check', q:'交付前要过哪几道检查？',
            opts:[['图层命名全部做完','不留 Frame / Rectangle 这类默认名'],
                  ['组件真名回写','实例默认叫 set 名，一页几百个都叫 icon，前端对不上'],
                  ['颜色和文字绑到样式','不留硬编码色值'],
                  ['用 auto-layout 搭','不用绝对定位摆位置'],
                  ['出交付说明区','给前端的尺寸、间距、色值规格']] }
        ]}
    ],
    out:['各状态的视觉稿画布（每个状态一张）','飞鹊组件与样式的绑定情况',
         '交付说明（尺寸、间距、色值的规格）','图层命名与组件真名的检查结果',
         '与线上页面的差异清单','待确认取值清单（答不上的标出来）'],
    skills:[['figma-feique-first','用飞鹊真组件出稿，绑定设计变量'],
            ['MIC-视觉自检','检查是否符合飞鹊规范'],
            ['MIC-交付规范','交付文档结构与图层命名'],
            ['MIC-验收','跟线上页面逐项对比找差异']]
  },

  /* ── 设计稿 · 设计策略与提案 ──────────────────────────────────
     这张卡的问题跟另两张不同：提案没法靠枚举做全，它栽的地方是
     「没说清给谁看、要他定什么」就开始做材料。所以四步是判断题不是清单题，
     第 2 步是核心。 */
  'design/2': {
    file:'docs/ued/MIC-XXX/03-设计策略与提案.md',
    auto:[
      { kind:'kb', q:'MIC 平台级设计原则 既有实践 论证成本', label:'检索 MIC 平台级设计原则' },
      { kind:'kb', q:'方案写作 工艺 提案 结论先行 表达', label:'检索方案写作工艺与表达原则' },
      { kind:'kb', q:'跟现有业务冲突 重复建设 自查', label:'检索「跟现有业务重复或冲突」自查' },
      { kind:'kb', q:'竞品分析 参考竞品 阿里国际站 海外 B2B 平台', label:'检索竞品分析方法与已有结论' }
    ],
    steps:[
      { t:'说清真实问题', h:'提案最容易被问倒的一句，是「你要解决的到底是什么问题」',
        qs:[
          { k:'p1', type:'area', q:'一句话说清要解决的问题',
            hint:'写用户或业务遇到的困难，不要写「要做一个某某功能」—— 那是方案不是问题。如果手上只有别人给的需求原话，先追问几轮：他要这个，是为了解决什么。' },
          { k:'p2', type:'check', q:'这个问题有什么支撑？',
            opts:[['用研或访谈结论',''],['线上数据',''],['客服或销售反馈',''],
                  ['真实用户会话记录',''],
                  ['只是业务方口头提的','那先补一条支撑，不然几个方向都站不住']] }
        ]},
      { t:'给谁看、要他定什么', h:'读者不同，同一份内容的写法完全不同。这步不定，材料会写成谁都不针对',
        qs:[
          { k:'p3', type:'check', q:'这份提案给谁看？',
            opts:[['直属领导',''],['UED 部门评审',''],['PM 或业务方',''],
                  ['前端或开发',''],['更上层的决策会','']] },
          { k:'p4', type:'radio', q:'这次要拿到什么？',
            opts:[['选定一个方向',''],['先对齐认知，这次不做决定',''],
                  ['批排期或资源',''],['否掉一个已经在推的方向','']] },
          { k:'p5', type:'text', q:'什么时候要、以什么形式过？',
            ph:'例如：周四设计评审，口头过 20 分钟，外加一份飞书文档' }
        ]},
      { t:'约束与边界', h:'先说清哪些东西不能动，方向才不会白想',
        qs:[
          { k:'p6', type:'check', q:'哪些是不能动的？',
            opts:[['搜索算法或排序逻辑',''],['后端接口和数据结构',''],
                  ['现有页面的整体框架',''],['业务规则（价格、权限、审核）',''],
                  ['排期很紧，只能做小改',''],
                  ['没有明确约束','那也写一句「已确认无约束」，别留空']] },
          { k:'p7', type:'area', q:'有没有已经被否过的方案？',
            hint:'写出来，并写清为什么被否。不写清楚，容易在提案里重提一个已经否过的方向。' }
        ]},
      { t:'方向与比较标准', h:'给几个方向不是重点，方向之间怎么比才是',
        qs:[
          { k:'p8', type:'radio', q:'给几个方向？',
            opts:[['2 个：一个稳的、一个激进的',''],
                  ['3 个：覆盖不同的投入量级',''],
                  ['1 个：只推荐一个，把取舍写透','']] },
          { k:'p9', type:'check', q:'用什么标准比这几个方向？',
            hint:'比完记得给推荐意见并写清理由 —— 只摆几个方向不表态，等于把判断推回给评审。',
            opts:[['用户体验是否真的变好','排在最前。其余标准跟它冲突时，以它为准'],
                  ['开发投入和排期',''],
                  ['能不能量化验证（GSSM 指标）',''],
                  ['跟现有业务有没有重复或冲突',''],
                  ['风险和能不能回退','']] }
        ]}
    ],
    out:['几个方向的提案（各自的取舍写清楚）','方向对比表（按你定的比较标准）',
         '推荐意见与理由','每个方向的已知风险','待确认清单（答不上的标出来）'],
    skills:[['MIC-表达','正面写、具体、可验证'],
            ['MIC-交互','上游追问，把需求翻译成真实问题'],
            ['CC-clarity','要拿真实用户行为当论据时'],
            ['figma-feique-first','方向需要出示意图时，用飞鹊真组件']]
  }
};

/* 飞鹊 yes2.svg 的真实 path（295 个 SVG 里的纯勾，另外 yes / yes-f 都带圆圈）。
   原来 checkbox 的勾是用 border + rotate(40deg) 拼的，不是飞鹊那一笔。 */
const FQ_YES = '<svg class="wz-ck" viewBox="0 0 16 16" fill="none" aria-hidden="true">'
  + '<path d="M1.98836 6.94178L1.28125 7.64889L6.231 12.5986L14.7163 4.11336'
  + 'L14.0092 3.40625L6.231 11.1844L1.98836 6.94178Z" fill="currentColor"/></svg>';

let W = { open:false, key:null, step:0, ans:{}, rows:[], hits:[], state:'idle', tok:0, fold:false };

function wzKey(sceneId, ci){ return sceneId+'/'+ci; }
function wzDef(){ return WIZ[W.key]; }
function wzCard(){ const [sid,ci]=W.key.split('/'); return sceneById(sid).cards[+ci]; }
function wzScene(){ return sceneById(W.key.split('/')[0]); }
function wzAllQs(){ return wzDef().steps.reduce((a,s)=>a.concat(s.qs),[]); }
function wzFilled(q){
  const v=W.ans[q.k];
  return Array.isArray(v) ? v.length>0 : !!(v&&String(v).trim());
}
function wzEsc(s){ return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

function wzOpen(sceneId, ci){
  const k=wzKey(sceneId,ci);
  if(!WIZ[k]) return false;                     // 没登记的卡片不弹，照旧只填模板
  W={ open:true, key:k, step:0, ans:{}, rows:[], hits:[], state:'idle', tok:W.tok+1, fold:false };
  document.getElementById('wizmask').classList.add('wzon');
  wzDraw();
  return true;
}
function wzClose(){
  const n=wzAllQs().filter(wzFilled).length;
  /* 填了东西再关，问一句 —— 关掉就没了 */
  if(n && !confirm('已填写 '+n+' 项，关闭后不保留。确定放弃？')) return;
  W.tok++; W.open=false;
  document.getElementById('wizmask').classList.remove('wzon');
  document.getElementById('wizpeek').classList.remove('wzon');
  /* 模板早就填进输入框了，关掉向导可以直接自己改着打 */
}

function wzDraw(){
  const d=wzDef(), c=wzCard(), sc=wzScene(), st=d.steps[W.step];
  document.getElementById('wzTag').textContent = sc.name;
  document.getElementById('wzT').textContent   = c.n;

  document.getElementById('wzMain').innerHTML = `
    <div class="wz-steps">${d.steps.map((s,i)=>`
      <button class="wzs ${i===W.step?'wzon':(i<W.step?'wzdone':'')}" onclick="wzGo(${i})">
        <span class="i">${i<W.step?FQ_YES:i+1}</span>${s.t}</button>`).join('')}
    </div>
    ${W.step===0 ? wzAutoHTML() : ''}
    <div class="wz-q">
      <div class="wz-qt">第 ${W.step+1} 步 · ${st.t}</div>
      <div class="wz-qh">${st.h||''}</div>
      ${st.qs.map((q,i)=>wzQHTML(q,i)).join('')}
    </div>`;

  wzSide(); wzProg();
  const last = W.step===d.steps.length-1;
  /* 🔴 最后一步隐藏「下一步」。原来它改文案成「完成填写」，可 wzNext() 里
     `W.step < steps.length-1` 才前进 —— 那一步点它什么也不会发生，是个死按钮。
     每一步只留一个主操作：前三步是「下一步」，最后一步是「交给 WorkBuddy 回答」。 */
  document.getElementById('wzNext').hidden = last;
  document.getElementById('wzPrev').style.visibility = W.step>0 ? 'visible' : 'hidden';
  document.getElementById('wzAsk').hidden = !last;
  document.getElementById('wzCopy').hidden = !last;
  document.getElementById('wzMain').scrollTop=0;
  if(W.step===0 && W.state==='idle') wzAuto();
}
function wzGo(i){ if(i<=W.step || wzAllQs().length){ W.step=i; wzDraw(); } }

/* ── 「已经替你查了」：真查 ───────────────────────────── */
function wzAutoHTML(){
  const d=wzDef(), done=W.state==='done';
  const rows = W.rows.length ? W.rows : d.auto.map(a=>({label:a.label,state:'',detail:''}));
  const miss = rows.filter(r=>r.state==='miss').length;
  return `<div class="wz-auto ${miss?'bad':''} ${done&&W.fold?'fold':''}" id="wzAuto">
    <button class="wz-ah" onclick="wzFold()">
      ${done?'<span class="ok">'+FQ_YES+'</span>':'<span class="wzspin"></span>'}
      <span>${done ? (miss? '检索完成，其中 '+miss+' 项无匹配' : '以下资料已完成知识库检索')
                   : '正在检索知识库'}</span>
      <span class="real">实时检索</span>
      <span class="wzn">${rows.length} 项${done?(W.fold?' · 展开':' · 收起'):''}</span>
    </button>
    <ul class="wz-al">${rows.map(r=>`<li class="${r.state||''}">
      <span class="wzd"></span>
      <span class="bd">${r.label}${r.detail?`<span class="wz-dt">${r.detail}</span>`:''}</span>
    </li>`).join('')}</ul>
  </div>`;
}
function wzFold(){ if(W.state!=='done') return; W.fold=!W.fold; wzRepaintAuto(); }
function wzRepaintAuto(){
  const el=document.getElementById('wzAuto'); if(!el) return;
  el.outerHTML = wzAutoHTML();
}
/* 🔴 向导必须自己加载知识库，不能靠 window.wbRetrieve 顺手带起来。
   实测过：index.html 里一个 <script src> 都没有，kb-search.js 和 kb.js
   全是 WorkBuddy 在闭包里动态插的，而那个 loadKB 没暴露到 window。
   wbRetrieve 只做检索、假设 WBKB 已经在了 —— 直接调它会静默返回 0 段，
   于是绿条上三条全报「没查到」，看起来像知识库里真没有。假红比不跑更坏。 */
let wzKBp = null;
function wzLoadKB(){
  if(wzKBp) return wzKBp;
  wzKBp = new Promise((res,rej)=>{
    if(window.WBKB && window.WBSearch) return res(true);
    function one(src){
      return new Promise((ok,no)=>{
        const s=document.createElement('script');
        s.src=src; s.onload=ok; s.onerror=()=>no(new Error('同目录找不到 '+src));
        document.head.appendChild(s);
      });
    }
    one('kb-search.js').then(()=>one('kb.js')).then(()=>{
      if(window.WBKB && window.WBSearch) res(true);
      else rej(new Error('kb.js 加载了但 WBKB / WBSearch 没挂上'));
    }).catch(rej);
  });
  return wzKBp;
}

async function wzAuto(){
  const tok=W.tok, alive=()=>tok===W.tok && W.open && W.step===0;
  const d=wzDef();
  W.state='running'; W.hits=[];
  W.rows = d.auto.map(a=>({label:a.label, state:'', detail:''}));
  wzRepaintAuto();

  /* 知识库 7.6MB，第一次用到才加载 */
  let kbErr = null;
  try{ await wzLoadKB(); }catch(e){ kbErr = e.message || String(e); }
  if(!alive()) return;

  for(let i=0;i<d.auto.length;i++){
    const job=d.auto[i];
    if(!alive()) return;
    let hits=[];
    if(kbErr){
      /* 分清「知识库没打开」和「知识库里没有」—— 两件事，话不能说成一样 */
      W.rows[i].state='miss';
      W.rows[i].detail='<b>未执行</b> · '+wzEsc(kbErr)
        +'（wizard.html 需与 kb.js、kb-search.js 置于同一目录）';
      wzRepaintAuto();
      continue;
    }
    try{ hits = window.WBSearch.retrieve(window.WBKB, job.q, 2600) || []; }
    catch(e){ hits=[]; }
    if(!alive()) return;
    W.hits = W.hits.concat(hits);
    if(!hits.length){
      /* 🔴 查不到就说查不到。原来那份 demo 不管有没有都打勾 —— 那是一句没做到的承诺。 */
      W.rows[i].state='miss';
      W.rows[i].detail='<b>无匹配</b> · 知识库中没有相关段落（关键词：'+wzEsc(job.q)+'）';
    }else{
      const docs=[]; hits.forEach(h=>{ if(docs.indexOf(h.d)<0) docs.push(h.d); });
      W.rows[i].state='ok';
      W.rows[i].detail='检索到 '+hits.length+' 段 · '
        + docs.slice(0,4).map(x=>`<a class="wz-doc" href="#" onclick="return wzPeek('${wzEsc(x).replace(/'/g,"\\'")}')">${wzEsc(x)}</a>`).join('')
        + (docs.length>4? `<span class="wz-more">还有 ${docs.length-4} 份</span>`:'');
    }
    wzRepaintAuto();
  }
  if(!alive()) return;
  W.state='done';
  /* 有没查到的就不收起 —— 那条恰恰是需要人看见的 */
  W.fold = W.rows.every(r=>r.state==='ok');
  wzRepaintAuto();
}
/* 点文档名看原文。不给原文的「参考了 N 份文档」是假线索。 */
function wzPeek(d){
  const box=document.getElementById('wizpeek');
  const hit=W.hits.filter(h=>h.d===d)[0];
  box.innerHTML=`<div class="wz-ph"><b>${wzEsc(d)}</b>${hit&&hit.t?`<span class="wzst">${wzEsc(hit.t)}</span>`:''}
      <button class="wzx" onclick="document.getElementById('wizpeek').classList.remove('wzon')">&times;</button></div>
    <div class="wz-pb">${hit? wzEsc(hit.x).replace(/\n/g,'<br>') : '（该段原文未保留）'}</div>`;
  box.classList.add('wzon');
  return false;
}

/* ── 问题 ───────────────────────────────────────────── */
function wzQHTML(q,i){
  const v=W.ans[q.k];
  let body='';
  if(q.type==='text')
    body=`<input type="text" class="${v?'has':''}" oninput="wzSet('${q.k}',this.value,this)"
      value="${wzEsc(v||'')}" placeholder="${wzEsc(q.ph||'')}">`;
  else if(q.type==='area')
    body=`<textarea rows="3" class="${v?'has':''}" oninput="wzSet('${q.k}',this.value,this)"
      placeholder="${wzEsc(q.ph||'')}">${wzEsc(v||'')}</textarea>`;
  else{
    const multi = q.type==='check';
    body=`<div class="wz-opts">${q.opts.map(o=>{
      const on = multi ? (v||[]).includes(o[0]) : v===o[0];
      return `<label class="wz-opt ${multi?'':'rd'} ${on?'wzon':''}"
        onclick="wzPickOpt('${q.k}',${multi?1:0},this)" data-v="${wzEsc(o[0])}">
        <span class="bx">${multi?FQ_YES:''}</span><span>${wzEsc(o[0])}${o[1]?`<span class="od">${wzEsc(o[1])}</span>`:''}</span>
      </label>`;
    }).join('')}</div>`;
  }
  return `<div class="wz-item">
    <div class="wz-lbl"><span class="no">${i+1}.</span><span>${wzEsc(q.q)}</span></div>
    ${q.hint?`<div class="wz-hint">${wzEsc(q.hint)}</div>`:''}
    ${body}</div>`;
}
function wzSet(k,v,el){
  W.ans[k]=v;
  if(el) el.classList.toggle('has', !!String(v).trim());
  wzSide(); wzProg();                 /* 🔴 只重画右栏和计数，不重画整个 main —— 否则输入框会失焦 */
}
function wzPickOpt(k,multi,el){
  const v=el.dataset.v;
  if(multi){
    const cur=W.ans[k]||[];
    const i=cur.indexOf(v);
    W.ans[k] = i<0 ? cur.concat([v]) : cur.filter(x=>x!==v);
    el.classList.toggle('wzon', W.ans[k].includes(v));
  }else{
    W.ans[k]=v;
    [...el.parentNode.children].forEach(x=>x.classList.toggle('wzon', x===el));
  }
  wzSide(); wzProg();
}

/* ── 右侧任务单 ─────────────────────────────────────── */
function wzSide(){
  const d=wzDef(), c=wzCard(), sc=wzScene(), all=wzAllQs();
  const f=all.filter(wzFilled), b=all.filter(q=>!wzFilled(q));
  document.getElementById('wzSide').innerHTML=`
    <div class="rcpt-t">任 务 单</div>
    <div class="rcpt-sub">${wzEsc(sc.name)} / ${wzEsc(c.n)}</div>

    <div class="rcpt-div">确定</div>
    ${f.length ? `<ul class="rc-list">${f.map(q=>{
        let v=W.ans[q.k]; if(Array.isArray(v)) v=v.join('、');
        return `<li class="rc-item"><span class="mk">${FQ_YES}</span><span>
          <span class="wznm">${wzEsc(q.q)}</span><span class="vl">${wzEsc(v)}</span></span></li>`;
      }).join('')}</ul>`
      : '<p class="rc-empty">尚未确定任何一项。<br>左侧填写后，此处同步生成。</p>'}

    ${b.length?`<div class="rcpt-div">待定</div>
    <ul class="rc-list">${b.map(q=>`<li class="rc-item off"><span class="mk">&#9675;</span>
      <span><span class="wznm">${wzEsc(q.q)}</span></span></li>`).join('')}</ul>`:''}

    <div class="rc-sum"><span class="lb">确定</span><span class="wzn">${f.length} / ${all.length}</span></div>

    <div class="rcpt-div">交付物</div>
    <ul class="rc-out">${d.out.map(o=>`<li>${wzEsc(o)}</li>`).join('')}</ul>

    <div class="rcpt-div">调用的能力</div>
    <ul class="rc-kit">${d.skills.map(k=>`<li><span class="sn">${wzEsc(k[0])}</span>
      ${k[1]?`<span class="wzsw">${wzEsc(k[1])}</span>`:''}</li>`).join('')}</ul>`;
}
function wzProg(){
  const all=wzAllQs(), n=all.filter(wzFilled).length;
  document.getElementById('wzProg').textContent='确定 '+n+' / '+all.length;
  document.getElementById('wzAsk').disabled = n===0;
}

/* ── 填完之后 ───────────────────────────────────────── */
/* 拼成一段给 WorkBuddy 自己问的话。
   🔴 待定项必须写进去 —— 不写，模型会拿默认假设替你补上，
      而问题不会消失，只会推迟到验收那天一起爆出来。 */
function wzText(forModel){
  const d=wzDef(), c=wzCard(), sc=wzScene(), all=wzAllQs();
  const f=all.filter(wzFilled), b=all.filter(q=>!wzFilled(q));
  const L=[];
  L.push('我要做「'+sc.name+' · '+c.n+'」。');
  L.push('');
  L.push('已经确定的：');
  f.forEach(q=>{
    let v=W.ans[q.k]; if(Array.isArray(v)) v=v.join('、');
    L.push('- '+q.q+' ' + v);
  });
  if(b.length){
    L.push('');
    L.push('还没定的 '+b.length+' 项（不要替我拿默认假设补上，需要问 PM 或业务的直接标出来）：');
    b.forEach(q=>L.push('- '+q.q));
  }
  L.push('');
  L.push('要交出：'+d.out.join('；'));
  if(!forModel){
    L.push('');
    L.push('用这些能力：'+d.skills.map(k=>k[0]).join('、'));
    L.push('产出落到 '+d.file);
    const docs=[]; W.hits.forEach(h=>{ if(docs.indexOf(h.d)<0) docs.push(h.d); });
    if(docs.length){
      L.push('');
      L.push('向导已经在知识库里查到这些相关文档（'+docs.length+' 份）：');
      docs.forEach(x=>L.push('- '+x));
    }
  }
  return L.join('\n');
}
/* 交给 WorkBuddy 自己回答 —— 这是底座换成 WorkBuddy 才有的一步。
   那份 demo 填完只能复制到别处去，因为它手里没有知识库也没有模型。 */
function wzAsk(){
  const q=wzText(true);
  const [sid,ci]=W.key.split('/');
  W.open=false; W.tok++;
  document.getElementById('wizmask').classList.remove('wzon');
  document.getElementById('wizpeek').classList.remove('wzon');
  S.scene=sid; S.sel=+ci; S.text=q; S.chips=[{n:wzCard().n, i:wzCard().i}];
  window.wbRun(q);
}
async function wzCopy(){
  const t=wzText(false);
  const tip=document.getElementById('wzTip');
  try{ await navigator.clipboard.writeText(t); tip.textContent='已复制 '+t.length+' 字'; }
  catch(e){
    /* 本地 file:// 下剪贴板可能被拦。别只说失败，把文本摊出来让人手动选。 */
    const ta=document.createElement('textarea');
    ta.value=t; ta.style.cssText='position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);'
      +'width:min(680px,90vw);height:50vh;z-index:300;padding:14px;font-size:12px;border-radius:8px';
    document.body.appendChild(ta); ta.select();
    ta.onblur=()=>ta.remove();
    tip.textContent='浏览器已阻止自动复制，请按 Cmd+C 手动复制';
  }
}

/* ── 接到 WorkBuddy 的卡片点击上 ─────────────────────── */
/* 保留原来的 pick()：模板照旧填进输入框，所以关掉向导可以直接自己改着打。
   熟手那条快路不拿走，向导是给「不知道该说到什么程度」的人。 */
(function(){
  const orig = window.pick || pick;
  window.pick = function(x){
    orig(x);
    wzOpen(S.scene, x);
  };
  const origCase = window.pickCase || pickCase;
  window.pickCase = function(sc, ci){
    origCase(sc, ci);
    wzOpen(sc, ci);
  };
})();

document.addEventListener('keydown', e=>{
  if(!W.open) return;
  if(e.key==='Escape') wzClose();
});
'''

MASK = '''
<div class="wizmask" id="wizmask">
  <div class="wiz">
    <div class="wz-hd">
      <span class="wz-tag" id="wzTag">场景</span>
      <span class="wz-t" id="wzT">卡片</span>
      <button class="wz-x" onclick="wzClose()">&times;</button>
    </div>
    <div class="wz-body">
      <div class="wz-main" id="wzMain"></div>
      <div class="wz-side" id="wzSide"></div>
    </div>
    <div class="wz-ft">
      <span class="wz-prog" id="wzProg">确定 0 / 0</span>
      <span class="wz-tip" id="wzTip"></span>
      <div style="margin-left:auto;display:flex;gap:8px">
        <button class="wz-btn" id="wzPrev" onclick="W.step--;wzDraw()">上一步</button>
        <button class="wz-btn" id="wzCopy" onclick="wzCopy()" hidden>复制给 Claude Code</button>
        <button class="wz-btn wzpri" id="wzNext" onclick="wzNext()">下一步</button>
        <button class="wz-btn wzpri" id="wzAsk" onclick="wzAsk()" hidden>交给 WorkBuddy 回答</button>
      </div>
    </div>
  </div>
</div>
<div class="wz-peek" id="wizpeek"></div>
'''


def _css_code():
    """把 CSS 注释剥掉再交给下面两道门。

    🔴 2026-09-08 立：我在注释里引用了 WorkBuddy 自己的 `.x:hover{opacity:1}`
    当依据，撞名门当场把注释里那个 `.x` 当成我的 class 报红。
    注释里的文字不是选择器，也不可能造成属性泄漏 —— 门扫的输入错了，不是判据错了，
    所以这里修的是输入，没有加豁免名单（加名单等于拿准确性换绿灯）。
    顺带把圆角门也一起收口：注释里写 `border-radius:8px` 举例同样会被误当字面量。
    """
    import re
    return re.sub(r'/\*.*?\*/', '', CSS, flags=re.S)


def radius_gate():
    """圆角门。2026-09-08 立（吉吉走查「这几个圆角度数都没统一」）。

    量出来我用了 7 个值：16 / 12 / 10 / 8 / 6 / 4 / pill。而飞鹊
    `cornerRadiusConclusion` 写得很清楚：真组件的圆角只有 4 / 6 / 8 三个值，
    加 pill 和整圆；2 · 12 · 16 · 20 · 24 各 0 次 —— 我用的 16/12/10 一次都没出现过。

    这道门只放行两档 + 三个特例：
      var(--ctl-r) = 4   控件级（输入框 / 勾选框 / 选项 / 标签 / 关闭键）
      var(--box-r) = 8   容器级（问题区 / 绿条 / 步骤条 / 模态 / 浮层）
      999px · 50% · 0    药丸 / 整圆 / 全屏
    写死的数字一律拦（除了上面三个特例）—— 硬编码就是下一次不统一的起点。
    """
    import re
    ok = {'var(--ctl-r)', 'var(--box-r)', '999px', '50%', '0'}
    code = _css_code()
    bad = []
    for m in re.finditer(r'border-radius:\s*([^;}\n]+)', code):
        v = m.group(1).strip()
        if v not in ok:
            line = code[:m.start()].count('\n') + 1
            bad.append((line, v))
    if bad:
        print('❌ 圆角门：这些值不在飞鹊阶梯里（只允许 4 控件 / 8 容器 / pill / 整圆 / 0）')
        for l, v in bad:
            print('   CSS 第 %d 行： border-radius:%s' % (l, v))
        sys.exit(1)
    print('✅ 圆角门通过 · %d 处 border-radius 全部落在 4 / 8 / pill / 整圆 / 0'
          % len(re.findall(r'border-radius:', code)))

    # 🔴 这道门只查字面量，查不出「变量拿不到」——
    #    `.wz-peek` 写 var(--box-r) 字面量完全合法，但它挂在 <body> 下、
    #    不是 .wizmask 的后代，实测 border-radius 静默失效成 0px。
    #    我试过在这里加一道「变量作用域」静态检查，19 条里 18 条是误报：
    #    `.rc-item` 这些选择器没写 .wizmask，可它们的 DOM 确实在里面。
    #    **CSS 选择器的书写形式推不出 DOM 归属** —— 判据形式错，撤掉了，
    #    没有改成加豁免名单（那是拿准确性换绿灯）。
    #    真要查这个只能在浏览器里量计算值 → `_verify/wizard.js`。


def collision_gate(page):
    """撞名门。2026-09-08 立。

    向导是叠在一个 758KB 的成品页上的，WorkBuddy 自己有一堆两三个字母的
    class（.s .d .n .on .sw .sp .st .x .nm .pri .done…）。我的后代选择器
    只能覆盖「我显式设过」的属性，没设的会从它那儿漏进来 ——
    实测 .sw 把任务单文字压成 38px 竖排，还带出 #DEDEDE 的开关底色，
    .nm 的 white-space:nowrap 会让长问题被截断。

    这些都是肉眼才发现的。所以往后由这道门当场拦：我的 CSS 里出现的
    class，只要 WorkBuddy 自己也有 `.同名{` 定义，就中止。
    豁免只有一条：`--` 开头的自定义属性不算 class。
    """
    import re
    mine = set(re.findall(r'\.([a-zA-Z][\w-]*)', _css_code()))
    base = page.split(CSS_B)[0]                  # 只看 WorkBuddy 自己那部分
    clash = sorted(c for c in mine if re.search(r'\.' + re.escape(c) + r'\s*\{', base))
    if clash:
        print('❌ 撞名门：这些 class 跟 WorkBuddy 自己的同名，会漏属性进来')
        for c in clash:
            d = re.search(r'\.' + re.escape(c) + r'\s*\{([^}]*)\}', base)
            print('   .%-10s WorkBuddy 定义： %s' % (c, (d.group(1) if d else '?')[:80]))
        print('   → 给它们加 wz 前缀，别靠特异性打架（没覆盖到的属性照样漏）')
        sys.exit(1)
    print('✅ 撞名门通过 · 我的 %d 个 class 没有一个跟 WorkBuddy 同名' % len(mine))


def syntax_gate(js):
    """注入前先验 JS 语法 —— 少一个括号整页就废，而 patch 脚本自己不会报错。
    这道门是 patch-ai.py 那边 2026-09-08 立的，这里照抄。"""
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f:
        f.write(js); tmp = f.name
    r = subprocess.run(['node', '--check', tmp], capture_output=True, text=True)
    os.unlink(tmp)
    if r.returncode != 0:
        print('❌ JS 语法门：注入的脚本语法错，已中止（wizard.html 没被写出）')
        print(r.stderr.strip()[:900]); sys.exit(1)
    print('✅ JS 语法门通过')


def main():
    import re
    if not os.path.exists(PAGE):
        print('❌ 找不到 index.html'); sys.exit(1)
    page = open(PAGE, encoding='utf-8').read()

    # wzNext 要看得到 wzDraw，放在 JS 末尾统一声明
    js = JS + '''
function wzNext(){
  const d=wzDef();
  if(W.step < d.steps.length-1){ W.step++; wzDraw(); }
}
'''
    radius_gate()
    collision_gate(page)
    syntax_gate(js)

    # CSS 进 </style> 前
    i = page.rindex('</style>')
    page = page[:i] + CSS_B + '\n' + CSS + '\n' + CSS_E + '\n' + page[i:]

    # 弹层 DOM 进 </body> 前（要在 body 下，不能进 #main —— render() 会重写 #main）
    j = page.rindex('</body>')
    page = page[:j] + MASK + page[j:]

    # JS 进最后一个 </script> 前（这样 SCENES / S / pick / wbRun 都已经声明过了）
    k = page.rindex('</script>')
    page = page[:k] + '\n' + JS_B + '\n' + js + '\n' + JS_E + '\n' + page[k:]

    open(OUT, 'w', encoding='utf-8').write(page)
    print('✅ wizard.html 写出 · %.0f KB（index.html 一个字没动）' % (os.path.getsize(OUT)/1024))
    # 🔴 原来这行写死了「design/0」，加了卡它还是这么报 —— 改了 A 忘了绑定的 B。
    #    现在从 JS 里的 WIZ 表抽，单一维护源。
    keys = re.findall(r"^  '([a-z]+/\d+)':\s*\{", JS, re.M)
    print('   已登记向导的卡片（%d 张）：%s' % (len(keys), '、'.join(keys)))


if __name__ == '__main__':
    main()
