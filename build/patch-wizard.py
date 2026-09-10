#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""在 WorkBuddy 页面上加一层「选项式向导」。

🔴 2026-09-09 起就地改 index.html（上线）。在此之前它写的是 wizard.html、线上不动，
   因为吉吉说先不部署；这轮他定了「做在线上版本里」，所以 OUT 换成了 PAGE。
   换完必须配一件事：**幂等**。原来是纯 append（每次都从干净的 index.html 重新生成
   wizard.html，所以无所谓），就地写之后跑两次就注入两遍，
   `const WIZ` 重复声明 → 整页 JS 全废，而 patch 脚本自己不会报错。
   → strip_between()：BEGIN/END 之间先删再插。

🔴 它必须在其他所有 patch 之后跑（它吃的是成品），且在 patch-terminal.py 之后
   —— 收尾按钮调的是那边提供的 window.wbHandoff。

做的事：点场景卡片的时候，除了照旧把模板填进输入框，再弹一层分步向导：
左边一步一步勾选和填空，右边任务单实时长出来，填完选「交给谁做」：
开系统终端 / 在页面里开终端 / 就让 WorkBuddy 答（见 patch-terminal.py）。
"""
import os, sys, subprocess, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PAGE = os.path.join(ROOT, 'index.html')
OUT  = PAGE          # 2026-09-09 上线：就地改 index.html（配 strip_between 保幂等）

CSS_B, CSS_E = '/* ==WB-WIZ-CSS:BEGIN== */', '/* ==WB-WIZ-CSS:END== */'
JS_B,  JS_E  = '/* ==WB-WIZ-JS:BEGIN== */',  '/* ==WB-WIZ-JS:END== */'
DOM_B, DOM_E = '<!-- ==WB-WIZ-DOM:BEGIN== -->', '<!-- ==WB-WIZ-DOM:END== -->'


def strip_between(page, b, e):
    """先删再插。就地写index.html之后，这道是幂等的全部 ——
    不删就跑两次注入两遍，const WIZ重复声明整页JS全废，而脚本自己不报错。"""
    n = 0
    while True:
        i = page.find(b)
        if i < 0:
            break
        j = page.find(e, i)
        if j < 0:
            print('❌ 找到 %s但没找到配对的 %s，页面被手改过？已中止' % (b, e))
            sys.exit(1)
        page = page[:i] + page[j + len(e):]
        n += 1
    return page, n

# ═══════════════════════════════════════════════════════════
# 视觉：全部用 WorkBuddy 自己的 token
# 🔴 不照搬那份 demo 的红按钮蓝步骤条 —— 底座是 WorkBuddy，
#    一个页面两套配色是最容易被同事一眼看出「拼起来的」。
# ═══════════════════════════════════════════════════════════
CSS = r'''
/* ═══ 向导层：用全站那一套 token（:root），只写结构 ═══
   2026-09-10 吉吉：「流程卡片的 UI 样式整体重新设计下，结构参考 CE，UI 按 Apple」。
   结构上借了 CE 两条：① 左侧一根步骤栏，每一步下面挂这一步已定的答案（每步交一份耐久产物）
   ② 右侧任务单把「这一单会交出什么」放最前（入口先看清产物契约），确定 / 待定跟在后面。
   视觉：浅灰画布上三栏 —— 白色步骤栏 / 灰底＋白色问题卡 / 白色任务单；头尾磨砂。 */
.wizmask{position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.28);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);
  display:none;align-items:center;justify-content:center;padding:28px}
.wizmask.wzon{display:flex}
.wiz{width:min(1240px,100%);height:min(880px,calc(100vh - 56px));background:var(--canvas);
  border-radius:var(--r-lg);box-shadow:var(--sh-3);
  display:flex;flex-direction:column;overflow:hidden}

/* ── 头 ── */
.wz-hd{display:flex;align-items:center;gap:12px;padding:18px 24px;flex:0 0 auto;
  background:var(--glass);-webkit-backdrop-filter:var(--blur);backdrop-filter:var(--blur);
  border-bottom:1px solid var(--glass-line)}
.wz-tag{font-size:12px;color:var(--accent-ink);background:var(--accent-fill);
  border-radius:var(--r-pill);padding:3px 10px;flex:0 0 auto;font-weight:500}
.wz-t{font-size:17px;font-weight:600;color:var(--ink);letter-spacing:-.3px}
.wz-x{margin-left:auto;border:0;background:none;font-size:22px;line-height:1;color:var(--ink-3);
  cursor:pointer;padding:0 4px;border-radius:var(--ctl-r)}
/* 关闭键悬停只提亮不加底（吉吉 2026-09-08） */
.wz-x:hover{color:var(--ink)}

.wz-body{flex:1;display:flex;min-height:0}

/* ── 左：步骤栏 ── */
.wz-rail{width:236px;flex:0 0 auto;padding:18px 12px;overflow:auto;background:var(--white);
  border-right:1px solid var(--line-2);display:flex;flex-direction:column;gap:2px}
.wz-rail .wzs{position:relative;display:flex;gap:12px;align-items:flex-start;width:100%;text-align:left;
  padding:12px;border:0;border-radius:var(--box-r);background:var(--white);cursor:pointer;
  font-size:14px;color:var(--ink-3);line-height:1.45}
.wz-rail .wzs:hover{background:var(--soft)}
.wz-rail .wzs .i{width:22px;height:22px;flex:0 0 auto;border-radius:50%;border:1px solid var(--line);
  display:grid;place-items:center;font-size:12px;color:var(--ink-3);background:var(--white);position:relative;z-index:1}
/* 步骤之间那根竖线 */
.wz-rail .wzs::before{content:'';position:absolute;left:23px;top:36px;bottom:-4px;width:1px;background:var(--line-2)}
.wz-rail .wzs:last-child::before{display:none}
.wz-rail .wzs .wzs-tx{min-width:0;display:flex;flex-direction:column;gap:4px;padding-top:1px}
.wz-rail .wzs .wzs-tt{font-weight:500}
.wz-rail .wzs .wzs-got{display:flex;flex-direction:column;gap:2px}
.wz-rail .wzs .wzs-got span{font-size:12px;color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:168px;line-height:1.5}
.wz-rail .wzs.wzon{background:var(--accent-fill);color:var(--accent-ink)}
.wz-rail .wzs.wzon .i{background:var(--accent);border-color:var(--accent);color:#fff}
.wz-rail .wzs.wzdone{color:var(--ink)}
.wz-rail .wzs.wzdone .i{background:var(--accent-fill);border-color:var(--accent-line);color:var(--accent-ink)}

/* ── 中：问题区 ── */
.wz-main{flex:1;overflow:auto;padding:24px 28px 32px;background:var(--canvas);min-width:0}
.wz-side{width:320px;flex:0 0 auto;border-left:1px solid var(--line-2);overflow:auto;
  padding:24px 22px 30px;background:var(--white)}

/* 「已经替你查了」那条 */
.wz-auto{border-radius:var(--r-lg);background:var(--white);margin:0 0 16px;overflow:hidden;border:1px solid transparent;box-shadow:var(--sh-1)}
.wz-auto.bad{border-color:#F0DCB4}
.wz-ah{width:100%;display:flex;align-items:center;gap:9px;padding:14px 18px;border:0;
  background:none;cursor:pointer;text-align:left;font-size:13px;color:var(--ink)}
.wz-ah .wzspin{width:14px;height:14px;border:2px solid var(--accent-line);border-top-color:var(--accent);
  border-radius:50%;animation:wzsp .7s linear infinite;flex:0 0 auto}
@keyframes wzsp{to{transform:rotate(360deg)}}
.wz-ah .ok{color:var(--accent-ink);font-size:14px;flex:0 0 auto}
.wz-ah .wzn{font-size:12px;color:var(--ink-3);margin-left:auto;flex:0 0 auto}
.wz-ah .real{font-size:11px;color:var(--accent-ink);background:var(--accent-fill);
  border-radius:var(--r-pill);padding:1px 8px;flex:0 0 auto}
.wz-al{list-style:none;margin:0;padding:0 18px 14px;border-top:1px solid var(--line-2)}
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
a.wz-doc{display:inline-block;margin:3px 5px 0 0;padding:2px 9px;border-radius:var(--ctl-r);
  background:var(--soft);color:var(--ink-2);font-size:12px;
  text-decoration:none;max-width:250px;overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap;vertical-align:middle}
a.wz-doc:hover{background:var(--accent-fill);color:var(--accent-ink)}
.wz-more{font-size:12px;color:var(--ink-3)}

/* 问题卡 */
.wz-q{background:var(--white);border-radius:var(--r-lg);padding:28px 30px 10px;box-shadow:var(--sh-1)}
.wz-qn{font-size:12px;color:var(--ink-3);font-weight:500;margin:0 0 6px}
.wz-qt{font-size:28px;font-weight:600;color:var(--ink);margin:0 0 6px;letter-spacing:-.7px;line-height:1.15}
.wz-qh{font-size:15px;color:var(--ink-2);margin:0 0 28px;line-height:1.6}
.wz-item{margin:0 0 28px}
.wz-lbl{display:flex;gap:7px;font-size:15px;color:var(--ink);font-weight:600;margin:0 0 4px}
.wz-lbl .no{color:var(--ink);font-weight:400;flex:0 0 auto}
.wz-hint{font-size:13px;color:var(--ink-3);line-height:1.7;margin:0 0 12px}
.wz-item input[type=text],.wz-item textarea{width:100%;box-sizing:border-box;font:inherit;
  font-size:15px;color:var(--ink);padding:12px 14px;border:1px solid var(--ctl);
  border-radius:var(--box-r);background:var(--white);outline:none;resize:vertical;
  transition:border-color .12s}
/* placeholder 用 --ink-3，别吃浏览器默认色（约 #757575，深得像已填内容） */
.wz-item input[type=text]::placeholder,.wz-item textarea::placeholder{color:var(--ink-3)}
/* focus：只换主色描边，不要光环和投影（吉吉 2026-09-10） */
.wz-item input[type=text]:focus,.wz-item textarea:focus{border-color:var(--accent)}
/* 选项：灰底行，选中换主色浅底（Apple 的分组列表） */
.wz-opts{display:flex;flex-direction:column;gap:8px}
.wz-opt{display:flex;gap:12px;align-items:flex-start;padding:13px 16px;border:1px solid transparent;
  border-radius:var(--box-r);background:var(--soft);cursor:pointer;font-size:15px;color:var(--ink);
  transition:background .12s,border-color .12s}
.wz-opt:hover{background:var(--soft-2)}
.wz-opt.wzon{background:var(--accent-fill);border-color:var(--accent-line)}
.wz-opt .bx{width:18px;height:18px;flex:0 0 auto;margin-top:2px;border:1px solid var(--ctl);
  border-radius:var(--r-xs);background:var(--white);position:relative}
.wz-opt.rd .bx{border-radius:50%}
.wz-opt.wzon .bx{border-color:var(--accent);background:var(--accent)}
/* 飞鹊勾（yes2.svg）在四个地方用，尺寸各不同，统一在这里给 */
.wz-ck{display:block;flex:0 0 auto}
.wz-rail .wzs .i .wz-ck{width:12px;height:12px;color:var(--accent-ink)}
.wz-ah .ok .wz-ck{width:13px;height:13px;color:var(--accent-ink)}
.rc-item .mk .wz-ck{width:11px;height:11px;color:var(--accent-ink);margin-top:3px}
.wz-opt .bx .wz-ck{display:none}
.wz-opt.wzon .bx .wz-ck{display:block;width:13px;height:13px;color:#fff;
  position:absolute;left:2px;top:2px}
/* 单选圆点 */
.wz-opt.rd.wzon .bx::after{content:'';position:absolute;
  left:5px;top:5px;width:6px;height:6px;border:0;border-radius:50%;
  background:#fff;transform:none}
.wz-opt .od{display:block;font-size:13px;color:var(--ink-3);margin-top:3px;line-height:1.6}

/* ── 右：任务单 ── */
.rcpt-t{font-size:20px;font-weight:600;color:var(--ink);letter-spacing:-.4px}
.rcpt-sub{font-size:13px;color:var(--ink-3);line-height:1.6;margin:3px 0 0}
.rc-sum{display:flex;align-items:center;gap:10px;margin:16px 0 6px}
.rc-sum .rc-bar{flex:1;height:4px;border-radius:var(--r-pill);background:var(--soft-2);overflow:hidden;display:block}
.rc-sum .rc-bar b{display:block;height:100%;background:var(--accent);border-radius:var(--r-pill);transition:width .2s}
.rc-sum .lb{font-size:12px;color:var(--ink-3)}
.rc-sum .wzn{font-size:13px;font-weight:600;color:var(--ink);font-variant-numeric:tabular-nums}
.rcpt-div{font-size:12px;color:var(--ink-3);font-weight:500;margin:24px 0 8px}
.rc-list{list-style:none;margin:0;padding:0}
.rc-item{display:flex;gap:8px;padding:9px 0;border-bottom:1px solid var(--line-2);font-size:13px}
.rc-item:last-child{border-bottom:0}
.rc-item .mk{color:var(--accent-ink);flex:0 0 auto}
.rc-item.off .mk{color:var(--ink-3)}
.rc-item .wznm{display:block;color:var(--ink-2);line-height:1.6}
.rc-item.off .wznm{color:var(--ink-3)}
.rc-item .vl{display:block;color:var(--ink);margin-top:2px;line-height:1.6;word-break:break-word;font-weight:500}
.rc-empty{font-size:13px;color:var(--ink-3);line-height:1.8;padding:6px 0}
.rc-out,.rc-kit{list-style:none;margin:0;padding:0}
.rc-out li,.rc-kit li{font-size:13px;color:var(--ink);padding:6px 0 6px 14px;position:relative;line-height:1.6}
.rc-out li::before,.rc-kit li::before{content:'';position:absolute;left:2px;top:13px;
  width:5px;height:5px;border-radius:50%;background:var(--accent)}
.rc-kit li{color:var(--ink-2)}
.rc-kit li::before{background:var(--line)}
.rc-kit li .sn{color:var(--ink);font-weight:500}
.rc-kit li .wzsw{display:block;color:var(--ink-3);margin-top:1px;font-size:12px}

/* ── 底 ── */
.wz-ft{display:flex;align-items:center;gap:10px;padding:16px 24px;flex:0 0 auto;
  background:var(--glass);-webkit-backdrop-filter:var(--blur);backdrop-filter:var(--blur);
  border-top:1px solid var(--glass-line)}
.wz-prog{font-size:13px;color:var(--ink-2)}
.wz-btn{font:inherit;font-size:14px;padding:10px 20px;border-radius:var(--r-pill);cursor:pointer;
  border:0;background:var(--white);color:var(--ink);box-shadow:var(--sh-1)}
.wz-btn:hover{background:var(--soft)}
.wz-btn.wzpri{background:var(--accent);color:#fff;box-shadow:none}
.wz-btn.wzpri:hover{background:var(--accent-hover)}
.wz-btn:disabled{opacity:.4;cursor:default}
.wz-tip{font-size:12px;color:var(--ink-3)}

/* ── 点文档名看原文 ── */
.wz-peek{position:fixed;right:26px;bottom:26px;width:430px;max-height:50vh;z-index:220;
  background:var(--glass);-webkit-backdrop-filter:var(--blur);backdrop-filter:var(--blur);
  border:1px solid var(--glass-line);border-radius:var(--box-r);
  box-shadow:var(--sh-2);display:none;flex-direction:column;overflow:hidden}
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
     side 占掉整屏。改成整列一起滚：问题在上，任务单在下面接着，谁都不压谁。 */
  .wz-body{flex-direction:column;overflow:auto}
  .wz-rail{flex:0 0 auto;width:auto;flex-direction:row;overflow-x:auto;border-right:0;
    border-bottom:1px solid var(--line-2);padding:10px 12px;gap:6px;scrollbar-width:none}
  .wz-rail::-webkit-scrollbar{display:none}
  .wz-rail .wzs{flex:0 0 auto;width:auto;padding:8px 12px;align-items:center;font-size:13px}
  .wz-rail .wzs::before{display:none}
  .wz-rail .wzs .wzs-got{display:none}
  .wz-main{flex:0 0 auto;overflow:visible;padding:16px}
  .wz-q{padding:20px 18px 6px}
  .wz-qt{font-size:22px}
  .wz-side{flex:0 0 auto;width:auto;border-left:0;border-top:1px solid var(--line-2)}
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
      { kind:'kb', q:'UED交互自查表 交互自查 自查表',            label:'检索UED交互自查表' },
      { kind:'kb', q:'交互专家 七维度 脑回路 问题定义 信息架构',    label:'检索交互专家7维度脑回路' },
      { kind:'kb', q:'状态枚举 空态 加载态 错误态 极限值 未登录',    label:'检索状态与极限值清单' }
    ],
    steps:[
      { t:'确认输入', h:'输入越全，越不会边画边发明',
        qs:[
          { k:'i1', type:'check', q:'手上有哪些输入？',
            opts:[['PRD文档',''],['上一步的业务分析',''],['竞品分析结论',''],
                  ['已有的Figma参考稿',''],['线上现有页面',''],
                  ['只有一句口头需求','那先回「前期调研」把业务问清楚']] },
          { k:'i2', type:'text', q:'如果PRD和视觉稿冲突，以哪个为准？',
            ph:'默认以需求文档为准，并把差异同步回另一份' }
        ]},
      { t:'圈定范围', h:'范围不圈，画到一半才发现漏了一个端',
        qs:[
          { k:'i3', type:'check', q:'要覆盖哪些端？',
            opts:[['PC英文主站',''],['触屏站',''],['买家App',''],['供应商App',''],
                  ['多语站','多语版常是简化版，规则跟主站不一样']] },
          { k:'i4', type:'text', q:'涉及哪几个页面？从哪进、从哪出？',
            ph:'把入口和出口写清楚，中间才不会漏页' }
        ]},
      { t:'过7维度', h:'挑相关的认真过。答不上的那一维，就是稿子的洞',
        qs:[
          { k:'i5', type:'check', q:'本次需要重点过哪几维？',
            opts:[['01问题定义','这是需求还是真实问题，翻译过了吗'],
                  ['02用户研究','用户在什么条件下会做这个行为'],
                  ['03信息架构','信息按决策路径排了吗'],
                  ['04任务流程','认知/操作/决策/情绪/信任五类阻力怎么应对'],
                  ['05反馈与状态','11态想全了吗'],
                  ['06空间与导航','Push还是Modal还是Drawer，依据是什么'],
                  ['07验证迭代','方案背后的假设怎么验']] },
          { k:'i6', type:'area', q:'这次最没把握的一维，卡在哪？',
            hint:'写出来。答不上的要去问PM或业务，不要含糊带过 —— 含糊带过的问题会在验收时集中暴露。' }
        ]},
      { t:'状态枚举', h:'人和模型都爱只画成功态，真实用户更常遇到别的',
        qs:[
          { k:'i7', type:'check', q:'哪些状态本次必须画？',
            opts:[['默认态',''],['加载态','200ms内不展示 / 300ms骨架屏 / 超时给重试'],
                  ['空态',''],['错误态',''],['无权限',''],
                  ['未登录','MIC有4层登录态，别只画一种'],
                  ['超时',''],['禁用态',''],['首次使用',''],
                  ['极值','超长文案、超多条目'],['弱网','']] }
        ]}
    ],
    out:['交互说明（每个决策带「为什么」）','完整状态清单','页面流转图（含异常分支）',
         'GSSM设计目标表','追问清单（答不上的标出来）','交付前自检表'],
    skills:[['MIC-交互','7维度 + UED交互自查表 + 上游追问'],
            ['UX-Figma-MD','交互稿转成分章节的文档'],
            ['figma-feique-first','交互稿直接做到视觉级，真组件绑token'],
            ['MIC-表达','正面写、具体、可验证']]
  },


  /* ══ 前期调研 · 竞品分析 ═══════════════════════════════════
     栽的地方：不是「没看竞品」，是**没定为什么比这家** ——
     出来一张谁都不针对的大对照表，读的人问一句「所以呢」就答不上。
     所以第1步不是列竞品，是先说清「你要拿它回答哪个问题」。 */
  'research/0': {
    file:'docs/ued/MIC-XXX/01-竞品分析.md',
    auto:[
      { kind:'kb', q:'竞品分析 阿里国际站 对比 B2B 竞品取证', label:'检索竞品分析方法与取证SOP' },
      { kind:'kb', q:'平台设计原则 MIC 既有实践 8条', want:'platform-design-principles', label:'检索MIC平台级设计原则（判断能不能照搬）' },
      { kind:'kb', q:'用户研究 买家痛点 占比 用研论据', label:'检索本环节的买家痛点占比' }
    ],
    steps:[
      { t:'这次要回答什么问题', h:'先有问题再去比。没有问题的对照表，写完没人用',
        qs:[
          { k:'c1', type:'area', q:'你想拿竞品回答哪个具体问题？',
            ph:'例：筛选项有二十多个时，怎么收纳还能让买家找得到' ,
            hint:'写成一个能被证伪的问题。写「看看别人怎么做的」等于没定问题，出来的表也就没有结论。' },
          { k:'c2', type:'check', q:'这个问题现在卡在哪？',
            opts:[['我们的方案想不出来',''],['方案有几个、选不出来','那顺手记下比较标准，后面直接用'],
                  ['要说服别人','那结论要能落到一句话，不是一张表'],
                  ['只是想看看','那先回上一格把问题写出来，否则这一趟白跑']] }
        ]},
      { t:'比谁、比哪一屏', h:'范围不圈，最后会变成把整个网站抄一遍',
        qs:[
          { k:'c3', type:'check', q:'比哪些对象？',
            opts:[['阿里国际站','优先。同赛道同角色，结论最能直接用'],
                  ['国内外其他B2B',''],['现代SaaS','交互模式可借，业务逻辑不可借'],
                  ['亚马逊等B2C','B2C的决策链比B2B短得多，别把它的转化路径直接搬过来'],
                  ['MIC自己的其他页面','平台内既有实践，论证成本为零']] },
          { k:'c4', type:'text', q:'具体哪个页面、哪一步？',
            ph:'例：搜索结果页的筛选区，从展开筛选到看到结果这一步' }
        ]},
      { t:'竞品数据怎么取证', h:'截图估不出数值。要么进真页面量，要么就别写精确值',
        qs:[
          { k:'c5', type:'check', q:'取证方式？',
            opts:[['进真页面看','默认。别凭截图和记忆'],
                  ['需要登录态才看得到','那要先确认有没有测试账号'],
                  ['只有截图','那结论里别出现精确数值，写「明显更宽」而不是「宽32px」'],
                  ['要留档给评审用','那把截图和URL一起存，评审时能回溯']] },
          { k:'c6', type:'check', q:'比哪几个维度？',
            opts:[['信息密度与层级',''],['操作步数',''],['默认值与预设',''],
                  ['出错与空态怎么给',''],['移动端怎么放得下',''],
                  ['文案与措辞',''],['视觉样式','只比样式最容易变成抄皮不抄机制']] }
        ]},
      { t:'竞品结论要长成什么样', h:'「可借鉴」和「不能照搬」要分开写，后者更值钱',
        qs:[
          { k:'c7', type:'area', q:'哪些约束决定了我们不能照搬？',
            hint:'例：他们的类目结构比我们浅一层／他们没有多语站／他们的供应商侧规则不一样。写不出来，结论就会被业务方一句「我们不一样」推翻。' }
        ]}
    ],
    out:['竞品对比表（按你定的维度，不是万能表）','可借鉴的做法清单','不能照搬的原因',
         '取证留档（URL＋截图）','对最初那个问题的直接回答'],
    skills:[['b2b-page-study','B2B竞品页面怎么看'],
            ['MIC-交互','把竞品做法翻成我们的交互决策'],
            ['MIC-表达','结论说人话、不堆形容词']]
  },

  /* ══ 前期调研 · 业务知识查询 ═══════════════════════════════
     栽的地方：把知识库的答案当结论直接写进PRD。
     知识库是**假设生成器不是真理库** —— 它记的是当时的规则，业务改了它不会自己更新。
     所以第4步专门问「拿到之后当假设还是当结论」。 */
  'research/1': {
    file:'docs/ued/MIC-XXX/00-业务背景.md',
    auto:[
      { kind:'kb', q:'业务知识 灵活关联 跨业务 横切 涌现', want:'business-knowledge-cross-link', label:'检索跨业务关联的方法' },
      { kind:'kb', q:'知识库 假设生成器 不是真理库 刹车', want:'mic-fullstack', label:'检索「知识库不能当结论」那条刹车' },
      { kind:'kb', q:'用户研究 买家痛点 占比 客服反馈', label:'检索用研痛点占比' }
    ],
    steps:[
      { t:'要查哪条线、什么问题', h:'问题越具体，查出来的越能用',
        qs:[
          { k:'b1', type:'check', q:'哪条业务线？',
            opts:[['搜索／SERP',''],['询盘',''],['TM与商机融合',''],['交易订单',''],
                  ['RFQ',''],['会员与成长体系',''],['运营与变现',''],['不确定','那先描述你看到的页面，反过来定位业务线']] },
          { k:'b2', type:'area', q:'具体要弄清什么？',
            ph:'例：买家发完询盘之后，供应商多久没回会触发提醒？提醒走哪些渠道？',
            hint:'写「介绍一下询盘业务」会得到一篇概述，写不进PRD。问一个能落到规则的问题。' }
        ]},
      { t:'圈定范围', h:'同一条规则在不同端、不同角色下经常不一样',
        qs:[
          { k:'b3', type:'check', q:'哪些角色？',
            opts:[['买家',''],['供应商',''],['平台运营',''],['内部销售／CRM',''],['客服','']] },
          { k:'b4', type:'check', q:'哪些端？',
            opts:[['PC英文主站',''],['触屏站',''],['买家App',''],['供应商App／VO',''],
                  ['多语站','多语常是简化版，规则跟主站不一样']] }
        ]},
      { t:'要不要带用研', h:'买家的痛点几乎都在用研里，光看规则看不到',
        qs:[
          { k:'b5', type:'check', q:'除了规则，还要什么？',
            opts:[['买家痛点占比','强烈建议。规则说的是「系统怎么做」，痛点说的是「用户为此吃了什么苦」'],
                  ['客服与用户反馈',''],['真实用户行为数据','那顺手看CC-clarity那张'],
                  ['历史case与踩过的坑',''],['只要规则','只拿规则做出来的方案，评审时最容易被「用户根本不这么用」问倒']] }
        ]},
      { t:'拿到之后怎么用', h:'这一步决定查到的东西会不会害你',
        qs:[
          { k:'b6', type:'check', q:'查到的内容准备怎么用？',
            opts:[['当假设，后面找业务方核','默认。知识库记的是当时的规则'],
                  ['直接写进PRD／交互稿','那必须先跟业务方对一遍，尤其涉及金额、时效、权限这三类'],
                  ['只是自己理解业务','那放宽点没关系']] },
          { k:'b7', type:'area', q:'哪些点如果记错了会出事？',
            hint:'金额口径、时效、权限边界这三类错了返工最贵。列出来，核的时候优先核这几条。' }
        ]}
    ],
    out:['这条业务线的现行规则（带出处）','MIC内部的常用叫法','买家在这一步的痛点占比',
         '要找业务方核的清单（标出优先核哪几条）','跟其他业务线的横切点'],
    skills:[['MIC-交互','业务规则怎么翻成交互约束'],
            ['MIC-表达','术语要给出内部叫法，别自造']]
  },

  /* ══ 前期调研 · 设计目标GSSM ═══════════════════════════════
     栽的地方两个，都很贵：
     ① G是**设计目标**不是业务目标（业务目标是模型的输入，四个字母只覆盖后四列）；
     ② 定完指标的下一个动作不是画稿，是**确认旧版数据取不取得到** ——
        上线后再想补before，补不回来。 */
  'research/2': {
    file:'docs/ued/MIC-XXX/02-GSSM设计目标表.md',
    auto:[
      { kind:'kb', q:'GSSM 设计目标 信号 指标 五列', want:'gssm-model', label:'检索GSSM模型与五列写法' },
      { kind:'kb', q:'GSSM 表格 构造 规格 黑底 header 1240', want:'gssm-table-construction-spec', label:'检索GSSM表的排版规格' },
      { kind:'kb', q:'数据 口径 时间戳 指标 取不取得到', want:'order-funds', label:'检索指标口径与数据可得性那条判据' }
    ],
    steps:[
      { t:'业务目标是谁定的', h:'业务目标是输入，不是你写的那一列',
        qs:[
          { k:'g1', type:'area', q:'业务方给的目标原话是什么？',
            ph:'例：提升搜索结果页的询盘转化率',
            hint:'写原话，别自己润色。润色过的目标后面对不上账。' },
          { k:'g2', type:'check', q:'这个目标是怎么来的？',
            opts:[['有数据支撑（哪个指标掉了）','那把那个数字记下来，它就是before'],
                  ['领导要求',''],['对标竞品',''],['业务方拍的','那先把「为什么是这个目标」问清楚，否则设计目标也会跟着虚']] }
        ]},
      { t:'业务目标翻成设计目标', h:'G那一列写的是「界面上要达成什么」，不是「业务上要涨什么」',
        qs:[
          { k:'g3', type:'area', q:'用户在这一步现在被什么挡住了？',
            ph:'例：筛选项太多，买家不知道先用哪个，直接翻页',
            hint:'这一句是整张表的地基。答不上来就回「业务知识查询」和用研痛点，别硬编。' },
          { k:'g4', type:'check', q:'设计策略往哪个方向使劲？',
            opts:[['降低认知负荷',''],['减少操作步数',''],['给更好的默认值',''],
                  ['提高信息可信度',''],['把关键信息放到前面',''],['补上缺失的反馈与状态','']] }
        ]},
      { t:'信号与指标', h:'信号是「看得见的用户行为」，指标是「能取到的数」——两回事',
        qs:[
          { k:'g5', type:'area', q:'方案生效的话，用户行为上会看到什么变化？',
            ph:'例：筛选区的点击更集中在前三项、翻页次数下降' },
          { k:'g6', type:'text', q:'对应哪2-3个指标？',
            ph:'斜杠分隔，例：筛选使用率／人均翻页数／结果页发询盘率' }
        ]},
      { t:'数据取不取得到', h:'这一步比画稿更急。上线后再想补before，补不回来',
        qs:[
          { k:'g7', type:'check', q:'旧版数据现在能拿到吗？',
            opts:[['能，已经确认过',''],
                  ['不确定','那现在就去问数据同学，别等上线'],
                  ['拿不到','那要么换一个能取到的指标，要么在上线前先埋点跑一段'],
                  ['要新埋点','那把埋点需求写进交互稿的度量那一节，别口头说']] },
          { k:'g8', type:'area', q:'同一个数有几种口径？选哪个？',
            hint:'一笔业务往往挂着多个时间戳（发起／确认／完成），选哪个当口径会得出不同的数。定完写下来，复盘时才对得上账。' }
        ]}
    ],
    out:['GSSM设计目标表（5列，1240宽，黑底header白字，第一列灰底）',
         '每格≤35字（策略≤50），指标2-3个斜杠分隔','设计目标与设计策略不重叠',
         '数据可得性结论（能取／要埋点／换指标）','口径说明（用哪个时间戳）'],
    skills:[['MIC-交互','GSSM是交互层的前置动作'],
            ['figma-feique-first','表要按规格画进Figma'],
            ['MIC-表达','每格话说短，不堆形容词']]
  },

  /* ══ 前期调研 · 设计案例参考 ═══════════════════════════════
     栽的地方：**说不出差在哪就一直出版本**。
     MIC LOGO片头连做七版，猜「精致」猜了六版全否，给了谷歌官方动画SVG之后一次就对。
     所以第1步先逼出「这次要定的是哪一维」，第3步管参照物的形式。 */
  'research/3': {
    file:'docs/ued/MIC-XXX/03-参考与借鉴.md',
    auto:[
      { kind:'kb', q:'参照物 说不出差在哪 别猜 精致 源文件优先', want:'ask-for-reference', label:'检索「去要参照物」那条判据' },
      { kind:'kb', q:'低保真 测不了 精致 伪造 维度 原型', label:'检索「别伪造你正在测的那一维」' },
      { kind:'kb', q:'反复被否 先诊断 别埋头 下一版 微调', want:'diagnose-before-iterate',
        label:'检索「反复被否时先诊断，别再出微调版」' }
    ],
    steps:[
      { t:'这次要定哪一维', h:'一次只定一维。「整体感觉」不是一维',
        qs:[
          { k:'r1', type:'check', q:'要参考的是哪一维？',
            opts:[['信息密度与排布',''],['动效的节奏与质感','那参照物必须是能播的，静态图测不了'],
                  ['文案与语气',''],['视觉风格与配色',''],['交互模式（放哪、怎么出现）',''],
                  ['说不清','那先别找参考。先去要一个「你觉得对」的例子，比看一百个案例快']] },
          { k:'r2', type:'area', q:'现在的版本差在哪？（能说多细说多细）',
            hint:'如果只能写出「不够精致 / 不太对」，那说明该去要参照物，不是再出一版。反复微调换不来方向。' }
        ]},
      { t:'场景约束', h:'同一个做法换了端和语言经常就不成立',
        qs:[
          { k:'r3', type:'check', q:'要用在什么条件下？',
            opts:[['PC大屏',''],['1024窄窗','1024几乎永远跟桌面不一样，别套桌面格式'],
                  ['触屏站／App',''],['多语（含阿语RTL）','那要一起看长文案和镜像后还成不成立'],
                  ['数据量极大时',''],['弱网／低端机','']] }
        ]},
      { t:'参照物要什么形式', h:'源文件 > 能播的视频 > 截图 > 口头描述。往下一档，猜的成分就多一档',
        qs:[
          { k:'r4', type:'check', q:'手上有什么？',
            opts:[['源文件（SVG／Figma／代码）','最好。可以量真值'],
                  ['视频／录屏','动效够用'],['截图',''],
                  ['只有一句口头描述','那第一件事是去要一个具体例子，别开始画']] },
          { k:'r5', type:'text', q:'参照物在哪？',
            ph:'贴链接或文件路径。写进来，评审时能回溯到「当初对标的是这个」' }
        ]},
      { t:'借鉴边界', h:'借形式不借机制，最后会做出一个像但不работает的东西',
        qs:[
          { k:'r6', type:'area', q:'借的是它的什么？哪些不借？',
            hint:'例：借它的分组逻辑，不借它的配色（我们有飞鹊规范）。前后要一致 —— 借了一半又混自己的一半，出来的东西两边都不像。' }
        ]}
    ],
    out:['这一维的参照物（带链接或文件）','借什么／不借什么，各写一句为什么',
         '换到我们的场景后要改的地方','如果参照物本身有可用性问题，标出来别照抄'],
    skills:[['b2b-page-study','同类页面怎么拆'],
            ['CC-animation','动效类参考要按「每帧都要成立」看'],
            ['figma-feique-first','落地要换成飞鹊真值']]
  },

  /* ── 设计稿 · 视觉稿 ─────────────────────────────────────────
     跟交互稿栽的地方不一样：交互稿栽在「状态没枚举」，视觉稿栽在「基准没定」——
     照线上还原 / 在现有页面上改局部 / 全新页面，这三种的做法完全不同，
     选错了是整套重来。所以第 2 步是它独有的，而且是单选。 */
  'design/1': {
    file:'docs/ued/MIC-XXX/05-视觉稿交付说明.md',
    /* 三条都验过命中的是哪几份文档，不是只看段数 —— 检索有命中不等于命中对的那句话 */
    auto:[
      { kind:'kb', q:'飞鹊视觉规范 字号阶梯 色值 间距token', label:'检索飞鹊视觉规范真值（字号 / 色值 / 间距）' },
      { kind:'kb', q:'视觉稿 状态 独立画布 状态墙 空态 加载态', label:'检索状态墙与独立画布的做法' },
      { kind:'kb', q:'图层命名 组件真名回写 交付给前端 规范', label:'检索交付给前端的命名与组件真名规则' }
    ],
    steps:[
      { t:'确认输入', h:'视觉稿最常见的返工，是没等交互稿定下来就先画',
        qs:[
          { k:'v1', type:'check', q:'手上有哪些输入？',
            opts:[['已定稿的交互稿',''],['PRD文档',''],['线上现有页面',''],
                  ['GSSM设计目标表',''],['已有的飞鹊参考稿',''],
                  ['交互稿还没定','那先回「交互稿」把流程和状态定下来，否则画完流程一变就得重画']] },
          { k:'v2', type:'text', q:'参考的线上页面是哪一个？',
            ph:'贴网址。没有线上参照就写「新页面，无线上参照」' }
        ]},
      { t:'定基准', h:'这一问决定整套做法。三种基准的工作方法不一样，选错要重来',
        qs:[
          { k:'v3', type:'radio', q:'这次的视觉基准是哪一种？',
            opts:[['照线上1:1还原','按测量值复刻，差异逐项核对。线上设计本身有问题的地方单独标出来，不顺手改'],
                  ['在现有页面上改局部','只动要改的那块，其余保持线上现状'],
                  ['全新页面','没有线上参照，用飞鹊组件从零搭']] },
          { k:'v4', type:'check', q:'要覆盖哪些端？',
            hint:'Web端和移动端是两套飞鹊组件库，编号不通用 —— 这一问决定用哪套。',
            opts:[['PC英文主站',''],['触屏站',''],['买家App',''],['供应商App',''],
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
            hint:'字号、颜色、间距只要拿不准就写出来。飞鹊正文最大18px、不用奇数字号，色值取规范真值不自己调 —— 拿不准的写出来比自己定一个更省事。' }
        ]},
      { t:'状态画布与交付', h:'每个状态一张独立画布。只画成功态的稿，前端做到一半才发现没得参照',
        qs:[
          { k:'v7', type:'check', q:'哪些状态要各出一张画布？',
            opts:[['默认态',''],['加载态','200ms内不展示 / 300ms骨架屏 / 超时给重试'],
                  ['空态',''],['错误态',''],['无权限',''],
                  ['未登录','MIC有4层登录态，别只画一种'],
                  ['超时',''],['禁用态',''],['首次使用',''],
                  ['极值','超长标题、超长价格、超多条目'],['弱网','']] },
          { k:'v8', type:'check', q:'交付前要过哪几道检查？',
            opts:[['图层命名全部做完','不留Frame / Rectangle这类默认名'],
                  ['组件真名回写','实例默认叫set名，一页几百个都叫icon，前端对不上'],
                  ['颜色和文字绑到样式','不留硬编码色值'],
                  ['用auto-layout搭','不用绝对定位摆位置'],
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
      { kind:'kb', q:'MIC平台级设计原则 既有实践 论证成本', label:'检索MIC平台级设计原则' },
      { kind:'kb', q:'方案写作 工艺 提案 结论先行 表达', label:'检索方案写作工艺与表达原则' },
      { kind:'kb', q:'跟现有业务冲突 重复建设 自查', label:'检索「跟现有业务重复或冲突」自查' },
      { kind:'kb', q:'竞品分析 参考竞品 阿里国际站 海外B2B平台', label:'检索竞品分析方法与已有结论' }
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
            opts:[['直属领导',''],['UED部门评审',''],['PM或业务方',''],
                  ['前端或开发',''],['更上层的决策会','']] },
          { k:'p4', type:'radio', q:'这次要拿到什么？',
            opts:[['选定一个方向',''],['先把大家的理解统一，这次不做决定',''],
                  ['批排期或资源',''],['否掉一个已经在推的方向','']] },
          { k:'p5', type:'text', q:'什么时候要、以什么形式过？',
            ph:'例如：周四设计评审，口头过20分钟，外加一份飞书文档' }
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
            opts:[['2个：一个稳的、一个激进的',''],
                  ['3个：覆盖不同的投入量级',''],
                  ['1个：只推荐一个，把取舍写透','']] },
          { k:'p9', type:'check', q:'用什么标准比这几个方向？',
            hint:'比完记得给推荐意见并写清理由 —— 只摆几个方向不表态，等于把判断推回给评审。',
            opts:[['用户体验是否真的变好','排在最前。其余标准跟它冲突时，以它为准'],
                  ['开发投入和排期',''],
                  ['能不能量化验证（GSSM指标）',''],
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
  },

  /* ══ 制作Demo · 设计稿还原成网页 ═════════════════════════
     栽的地方：还原度不是「细心」出来的，是**把每类不对称点变成机器默认**攒出来的。
     最常见那条：1024几乎永远跟桌面不一样，套桌面格式就错。 */
  'demo/0': {
    file:'docs/ued/MIC-XXX/06-demo说明.md',
    auto:[
      { kind:'kb', q:'1:1 还原 Figma CSS 不对称 判据 攒', want:'restore-accuracy-compounding', label:'检索Figma↔CSS不对称点清单' },
      { kind:'kb', q:'响应式 断点 1024 桌面 不一样 还原', label:'检索响应式断点与1024那条' },
      { kind:'kb', q:'内联 SVG 注入 图标 还原 覆盖', label:'检索SVG注入器（别手写注入代码）' }
    ],
    steps:[
      { t:'还原哪一块', h:'范围锁到该改的子树，别整画板扫',
        qs:[
          { k:'d1', type:'text', q:'Figma链接或节点id？',
            ph:'贴链接。传具体节点，不要传整个分区（实测286节点5秒 vs 8981节点85秒）' },
          { k:'d2', type:'check', q:'这份demo拿来干什么？',
            opts:[['评审给人看','那先保证一眼像，长尾细节可以后补'],
                  ['给前端当参照','那图层名、组件真名、精确值都要对得上'],
                  ['做用户测试','那要想清楚测的是哪一维——低保真测不了「精致」'],
                  ['给领导演示','那准备好真实数据，别用Lorem']] }
        ]},
      { t:'响应式与断点', h:'这一格错了要整套重做',
        qs:[
          { k:'d3', type:'check', q:'要几档？',
            opts:[['只要桌面1440',''],['1440＋1024','1024要单独跟桌面对比，禁止套桌面格式'],
                  ['加触屏（≤768）',''],['要一直响应到320','那顺手确认最窄档不出横向滚动']] },
          { k:'d4', type:'text', q:'稿子里给了哪几档？没给的怎么办？',
            ph:'稿里没有的档位，是我推还是回去要？推的话在说明里标出来' }
        ]},
      { t:'素材与图标', h:'手画的图标前端对不上名字，也常常缺一整圈白描边',
        qs:[
          { k:'d5', type:'check', q:'图标和图片怎么来？',
            opts:[['从Figma直接导（exportAsync）','默认。别拿库里同名的顶替'],
                  ['用飞鹊295个SVG',''],
                  ['要往DOM里塞内联SVG','那用注入器脚本，别手写注入代码'],
                  ['产品图用占位','那说明里写清哪些是占位']] },
          { k:'d6', type:'check', q:'有没有这几类容易漏的？',
            opts:[['MICON字体图标','一律换成造型一样的飞鹊icon——没装那份字体的电脑上它是一片空白'],
                  ['渐变／阴影',''],['视频或动效',''],['真实的长文案',''],['都没有','']] }
        ]},
      { t:'状态与门', h:'只做成功态的demo，评审当场就会被问到空态',
        qs:[
          { k:'d7', type:'check', q:'要做哪些状态？',
            opts:[['默认态',''],['空态',''],['加载态',''],['错误态',''],
                  ['极限文案（超长标题／US$1999999.00）',''],['多态切换的控制条','多态demo要有个切换器，不然评审看不到']] }
        ]}
    ],
    out:['双击就能打开的单文件网页','各断点逐档核过（1024单独比过）',
         '状态齐全（不只有成功态）','五道门跑过（几何／覆盖／视觉／状态重排／脱网）',
         '说明里标出哪些是我推的、哪些是占位'],
    skills:[['figma-to-html-feique','1:1还原的整套做法'],
            ['figma-feique-first','飞鹊真值与组件'],
            ['MIC-验收','还原完自己先按13维度对一遍']]
  },

  /* ══ 制作Demo · 线上页面克隆成底板 ═══════════════════════
     栽的地方两个：① 把「还原Figma」的判据搬到「还原线上」，那是自己造失真；
     ② 换了页型继承上一个页型的「全绿」——每种页型都得整套重验。 */
  'demo/1': {
    file:'docs/ued/MIC-XXX/06-demo说明.md',
    auto:[
      { kind:'kb', q:'线上 克隆 live-clone 离线 单文件 坑', want:'live-page-clone-method', label:'检索线上克隆方法与实测坑' },
      { kind:'kb', q:'还原线上 不是 Figma 判据 别搬 失真', label:'检索「别把还原Figma的判据搬到还原线上」' },
      { kind:'kb', q:'MIC URL 注册表 线上页面 清单 页型', label:'检索MIC线上页面清单' }
    ],
    steps:[
      { t:'克隆哪一页', h:'先确认这一页型有没有人克过。没克过就要整套重验',
        qs:[
          { k:'k1', type:'text', q:'目标URL？',
            ph:'例：www.made-in-china.com/products-search/hot-china-products/led.html',
            hint:'主搜别用 productSearch?word= —— 对未登录的新浏览器它返回「信息不可用」页，不是被拦，是入口不对。' },
          { k:'k2', type:'check', q:'这是什么页型？',
            opts:[['搜索结果页／列表',''],['产品详情页',''],['首页',''],['后台／控制台',''],
                  ['第一次克这个页型','那所有检查项都要重跑一遍，别继承上次的全绿']] }
        ]},
      { t:'登录态与数据', h:'要不要登录，决定了能不能自动化',
        qs:[
          { k:'k3', type:'check', q:'这页要登录才看得到吗？',
            opts:[['公开页，不用登录',''],['要买家登录态',''],['要供应商／后台登录态','那先确认有可用的测试账号'],
                  ['不确定','那先用无痕窗口打一次看看']] },
          { k:'k4', type:'check', q:'动态列表页要注意的？',
            opts:[['用有货的热门词（led／bag／solar panel）','别用生僻词，会拿到空结果页'],
                  ['读到之后先验不是空结果／Forbidden错误页','这条必做'],
                  ['一次只读一页，别循环连刷','MIC有WAF限流'],
                  ['不是列表页','']] }
        ]},
      { t:'要在上面改什么', h:'这决定保留多少。全保留的克隆最重，改起来最费劲',
        qs:[
          { k:'k5', type:'area', q:'你要在这个底板上改哪一块？',
            ph:'例：只改筛选区的收纳方式，其余保持线上原样' },
          { k:'k6', type:'check', q:'底板的用法？',
            opts:[['在上面直接改方案',''],['当before／after对照',''],
                  ['给评审看真实上下文',''],['要嵌进别的demo里','']] }
        ]},
      { t:'脱网与验收', h:'离不了网的「离线单文件」等于没做',
        qs:[
          { k:'k7', type:'check', q:'验收要过哪些？',
            opts:[['0个外部请求',''],['0个JS错误',''],['0张断图',''],
                  ['断网真打开一次','机器门之外自己也点一遍'],
                  ['改动处跟线上并排比','']] }
        ]}
    ],
    out:['可离线打开的单文件底板','脱网三项全过（外部请求／JS错误／断图）',
         '改动处与线上的对照','这一页型的检查记录（下次同页型照着跑）'],
    skills:[['figma-to-html-feique','还原与门'],
            ['MIC-验收','改完跟线上比'],
            ['b2b-page-study','页面结构怎么拆']]
  },

  /* ══ 制作Demo · 飞鹊组件查询 ═══════════════════════════════
     栽的地方：**Web端和移动端两套库，key一个都不通用**，而且认key不认名。
     只有三步，不硬凑四步。 */
  'demo/2': {
    file:'',
    auto:[
      { kind:'kb', q:'飞鹊组件库 清册 key 认key不认名 两套', label:'检索组件清册与「认key不认名」' },
      { kind:'kb', q:'飞鹊 移动端 组件 45 页 库 不通用', want:'feique-web-vs-mobile', label:'检索移动端组件库差异' },
      { kind:'kb', q:'飞鹊 token styles variables 绑定', label:'检索token与样式绑定（styles≠variables）' }
    ],
    steps:[
      { t:'组件用在哪一端', h:'这一问必须先答。两套库的key一个都不通用，用错了稿子导不进去',
        qs:[
          { k:'f1', type:'check', q:'这个组件要用在哪？',
            opts:[['Web端（PC主站）',''],['移动端（触屏／App）',''],
                  ['两端都要','那要分别查两次，拿两个不同的key'],
                  ['不确定','那先定端再来——这一问不定，后面全是白工']] }
        ]},
      { t:'要什么组件', h:'先描述它的行为，再去找名字。按名字猜最容易拿错',
        qs:[
          { k:'f2', type:'area', q:'这个组件是干什么的？长什么样？',
            ph:'例：一行里放若干可删除的标签，超出换行；点×移除',
            hint:'描述行为比说名字准。飞鹊里同一个造型常有好几个变体（比如三个不同的勾：圆圈+勾／实心圆挖勾／纯勾），名字近但用途不同。' },
          { k:'f3', type:'check', q:'要这个组件的什么？',
            opts:[['组件真名和key（要导进稿里）',''],
                  ['有哪些variant和状态',''],
                  ['绑的是哪个样式／token',''],
                  ['这一档有没有auto-layout','换variant前先查这个——同一个组件不同档，有的有有的没有'],
                  ['就想知道有没有这个组件','']] }
        ]},
      { t:'飞鹊里没有这个组件怎么办', h:'手画的那个前端对不上名字',
        qs:[
          { k:'f4', type:'check', q:'如果飞鹊里没有？',
            opts:[['用相近的组件改','那在交付说明里写清改了哪里'],
                  ['用基础元素拼','那图层命名要能让前端看懂'],
                  ['手画','最后选择。手画的前端对不上名字，而且容易缺细节（比如图标少一圈白描边环）'],
                  ['回去问设计系统的人','']] }
        ]}
    ],
    out:['组件真名＋key（分端）','可选的variant与状态','绑定的样式或token',
         '这一档有没有auto-layout','没有对应组件时的替代方案'],
    skills:[['figma-feique-first','组件优先，search→import'],
            ['feique-mobile-icon-lookup','图标查找（三套命名）'],
            ['MIC-交付规范','实例名要回写成真名']]
  },

  /* ══ 交付验收 · 交付前检查 ═══════════════════════════════
     栽的地方：① 传整分区跑门，5秒变85秒；② 实例名全叫set名，一页522个都叫icon。 */
  'deliver/0': {
    file:'docs/ued/MIC-XXX/09-交付自检报告.md',
    auto:[
      { kind:'kb', q:'交付规范 前端 图层命名 组件真名 回写', label:'检索交付规范与真名回写' },
      { kind:'kb', q:'figma-verify 19 项 机器门 图层命名 默认名', want:'resources-and-commands',
        label:'检索figma-verify的检查项' },
      { kind:'kb', q:'描边 strokes length strokeWeight 静默 不渲染', label:'检索「查描边看strokes.length」那条' }
    ],
    steps:[
      { t:'查哪份稿', h:'传改动的那个块，别传整分区',
        qs:[
          { k:'v1', type:'text', q:'Figma链接或节点id？',
            ph:'贴具体节点。实测286节点5秒、8981节点85秒，差17倍' },
          { k:'v2', type:'check', q:'这次改了什么？',
            opts:[['新出的整页稿','那全套都要查'],['只改了几个值','那查改动那块就够'],
                  ['换了组件',''],['加了新状态／画布',''],['不确定改了哪些','那用git或版本历史先对一遍']] }
        ]},
      { t:'交给谁、怎么交', h:'交付对象不同，要保证的东西不一样',
        qs:[
          { k:'v3', type:'check', q:'前端怎么用这份稿？',
            opts:[['开发模式里读',''],['照着切图',''],['自己按规范实现',''],
                  ['要能对上代码里的组件名','那真名回写这一项必须过']] },
          { k:'v4', type:'check', q:'有没有行为契约要一起交？',
            opts:[['有，写在稿里的说明区','那要确认它在AI能读到的区域'],
                  ['有，在单独的交互文档里','那两边的规格要对得上'],
                  ['纯视觉稿，不出行为','那把这个边界写清楚，别让前端猜']] }
        ]},
      { t:'要查哪几类问题', h:'挑相关的认真查，不相关的标出来说明为什么不查',
        qs:[
          { k:'v5', type:'check', q:'本次要查？',
            opts:[['图层命名（Frame／Rectangle一个不留）','出稿默认必查'],
                  ['组件真名回写（set名·variant值）','机器从mainComponent取，手写会造假信息'],
                  ['auto-layout（没用absolute）',''],
                  ['颜色／字号绑了飞鹊样式','文字样式绑了≠颜色绑了，两维都要查'],
                  ['状态画布齐不齐',''],['描边真的渲染出来了','weight有值+paint空=静默不渲染'],
                  ['圆角统一',''],['SECTION有没有被内容顶出去','往展示态加内容必重排']] }
        ]},
      { t:'查出的问题谁改', h:'报告不落到人，就没人改',
        qs:[
          { k:'v6', type:'check', q:'查出问题怎么处理？',
            opts:[['我自己当场改完再交','默认'],
                  ['有些是历史遗留，本次不改','那在报告里标出来并写为什么'],
                  ['有些要业务方定','那单独列一张待确认清单']] }
        ]}
    ],
    out:['检查报告（逐项，过的和没过的都列）','没过的已经改完，或标明为什么本次不改',
         '待业务方确认的清单','跑门用的节点id（下次能复跑）'],
    skills:[['MIC-交付规范','四段骨架＋默认名归零＋variant真名'],
            ['MIC-视觉自检','飞鹊规范四层引擎'],
            ['figma-feique-first','真值来源']]
  },

  /* ══ 交付验收 · 稿与线上对比 ═══════════════════════════════
     栽的地方：模糊描述。「稍微偏一点」「感觉窄了」前端没法改，
     所以每条差异必须带精确数值，而且要分清「线上错」还是「稿错」。 */
  'deliver/1': {
    file:'docs/ued/MIC-XXX/10-视觉验收差异清单.md',
    auto:[
      { kind:'kb', q:'验收 13 维度 精确值 线上 Figma 对比', want:'MIC-验收', label:'检索验收13个维度与精确值表' },
      { kind:'kb', q:'模糊描述 zero tolerance 差异 数值', label:'检索「差异必须带精确数值」' },
      { kind:'kb', q:'MIC 线上页面 URL 注册表 后台 截图', label:'检索线上页面清单与取图方式' }
    ],
    steps:[
      { t:'拿哪两个来比', h:'两边都要能回溯，否则差异清单过两周就没人认得',
        qs:[
          { k:'a1', type:'text', q:'线上URL？',
            ph:'完整地址。要登录态的话写清用哪个账号看的' },
          { k:'a2', type:'text', q:'Figma节点？',
            ph:'贴链接或节点id' },
          { k:'a3', type:'check', q:'这次对比是为了什么？',
            opts:[['上线后验收，看前端实现对不对','那差异默认「以稿为准」'],
                  ['改版前记录现状（before基线）','那不是找错，是存档'],
                  ['稿是照线上做的，检查还原度','那差异默认「以线上为准」'],
                  ['两边都可能不对','那每条差异都要单独判归属']] }
        ]},
      { t:'按哪些维度比', h:'13维度挑相关的，不相关的标出来',
        qs:[
          { k:'a4', type:'check', q:'本次比？',
            opts:[['尺寸与间距',''],['字号／字重／行高',''],['颜色（含描边和底色）',''],
                  ['圆角',''],['图标（造型和尺寸）',''],['文案逐字',''],
                  ['状态与交互反馈',''],['响应式各档',''],['层级与顺序','']] }
        ]},
      { t:'差异怎么记', h:'不许出现「稍微」「有点」「差不多」',
        qs:[
          { k:'a5', type:'check', q:'记录形式？',
            opts:[['每条带两边的精确值（线上X／稿Y／差Z）','必须'],
                  ['带截图对照',''],['要回填飞书表格','那按表格的列结构组织'],
                  ['按严重度分级','那先说清分级标准是什么']] },
          { k:'a6', type:'area', q:'如果线上本身有可用性问题，怎么处理？',
            hint:'别僵化还原烂设计。线上的问题单独标出来给改进建议，但不要混在「还原差异」里 —— 那是两类东西。' }
        ]}
    ],
    out:['差异清单（每条带两边精确值）','每条标明归属（线上错／稿错／本次不改）',
         '截图对照','线上自身可用性问题（单独一节，不混进差异）'],
    skills:[['MIC-验收','13维度精确值表'],
            ['MIC-表达','不许模糊描述'],
            ['MIC-交付规范','差异要能落到前端能改的粒度']]
  },

  /* ══ 走查复盘 · 线上页面体验走查 ═══════════════════════════
     栽的地方：以设计师视角扫一遍，看不到断点。
     必须站进一个具体角色的具体情境里，才会撞上真实的犹豫点。 */
  'review/0': {
    file:'docs/ued/MIC-XXX/11-走查报告.md',
    auto:[
      { kind:'kb', q:'用户走查 角色 情境 断点 犹豫 预演', label:'检索用户走查的做法（角色＋情境）' },
      { kind:'kb', q:'UED 交互自查表 80 条 14 范围', label:'检索UED交互自查表' },
      { kind:'kb', q:'买家 痛点 全周期 用研 占比', label:'检索买家全周期痛点' }
    ],
    steps:[
      { t:'你是谁、在什么情境', h:'这一步不填，走查会退化成「我觉得这里不好看」',
        qs:[
          { k:'w1', type:'check', q:'扮演哪个角色？',
            opts:[['第一次来的海外买家',''],['来过几次、有明确采购需求的买家',''],
                  ['正在比价的买家',''],['供应商（后台）',''],['平台运营','']] },
          { k:'w2', type:'area', q:'他此刻的情境是什么？',
            ph:'例：手机上，网络不好，刚从谷歌搜索点进来，只想知道这家能不能做定制',
            hint:'情境决定他会不会等、会不会读、愿不愿意填。没有情境的走查测不出放弃点。' }
        ]},
      { t:'走查走哪条路径', h:'一条完整路径，从进到出。别东点一下西点一下',
        qs:[
          { k:'w3', type:'text', q:'从哪进、到哪算成功？',
            ph:'例：从谷歌落地到产品详情页 → 发出一条询盘算成功' },
          { k:'w4', type:'check', q:'哪些端要走？',
            opts:[['PC英文主站',''],['触屏站',''],['买家App',''],
                  ['1024窄窗','常被跳过，而它跟桌面不一样'],['多语站','']] }
        ]},
      { t:'走查要找什么', h:'找的是「他会停下来的地方」，不是「不好看的地方」',
        qs:[
          { k:'w5', type:'check', q:'重点找？',
            opts:[['断点（走不下去了）',''],['犹豫点（不知道点哪个）',''],
                  ['要hover或点开才懂的地方','移动端根本没有hover'],
                  ['需要他先知道某个前提才能继续',''],
                  ['等待时没有反馈',''],['出错了不知道怎么办',''],
                  ['跳转之后落到的地方不符合预期','']] },
          { k:'w6', type:'check', q:'要不要一起过自查表？',
            opts:[['过（80+条14范围）','建议。人眼容易漏系统性的那几类'],
                  ['只过反馈与状态那一范围',''],['不过','']] }
        ]},
      { t:'走查结论要落成什么', h:'「体验不好」不是结论，「他在这一步不知道下一步点哪」才是',
        qs:[
          { k:'w7', type:'check', q:'走查完要什么？',
            opts:[['问题清单＋每条的改进建议',''],
                  ['按严重度排序','那说清分级标准'],
                  ['要提给业务方的','那把「这是设计能改的」和「这要业务定」分开'],
                  ['要接着出改版方案','那顺手把GSSM也起个头']] }
        ]}
    ],
    out:['走查报告（角色＋情境写在最前面）','断点／犹豫点清单，每条带截图或位置',
         '每条的改进建议','分开：设计能改的 vs 要业务定的','UED自查表结果（没过的项必须有下文）'],
    skills:[['MIC-交互','7维度＋UED自查表'],
            ['CC-clarity','想用真实行为数据印证时'],
            ['MIC-表达','说人话，别用体验黑话']]
  },

  /* ══ 走查复盘 · 用户行为分析（Clarity）═══════════════════
     栽的地方：不先看采样率就下结论。
     采样率没看，样本量再大也不知道代表什么；而且这条通道有十五条已经被证伪的判据。 */
  'review/1': {
    file:'docs/ued/MIC-XXX/12-会话走查表.md',
    auto:[
      { kind:'kb', q:'Clarity 采样率 起手 三件事 接口 记账', want:'CC-clarity', label:'检索Clarity起手三件事' },
      { kind:'kb', q:'Clarity 已证伪 判据 十五条', label:'检索已证伪的判据（别重踩）' },
      { kind:'kb', q:'Clarity 正则 页面 全站 筛选', want:'clarity-page-regex', label:'检索全站页面正则表' }
    ],
    steps:[
      { t:'看哪个页面、哪段时间', h:'页面得用正则圈准，时间窗要覆盖到有量的那几天',
        qs:[
          { k:'y1', type:'text', q:'要看哪个页面？',
            ph:'页面名或URL特征。全站页面正则表里有现成的写法' },
          { k:'y2', type:'text', q:'时间窗？',
            ph:'例：最近7天。改版类问题要覆盖上线前后两段' },
          { k:'y3', type:'check', q:'有没有现成的筛选链接？',
            opts:[['有，是别人给我的clarity链接','那直接按那个链接的条件走'],
                  ['没有，要自己定条件',''],['不确定该怎么筛','那先看页面维度的总量，再往下切']] }
        ]},
      { t:'这次要回答什么问题', h:'行为数据只能回答「他们做了什么」，回答不了「为什么」',
        qs:[
          { k:'y4', type:'area', q:'你想弄清什么？',
            ph:'例：买家点了筛选之后，有多少人继续往下翻，有多少直接走',
            hint:'能被会话回放和点击数据回答的问题：点没点、点了几次、点完去哪、在哪停住、有没有死点。回答不了动机 —— 那要用研。' },
          { k:'y5', type:'check', q:'要哪种产出？',
            opts:[['汇总数字（多少人怎么做）',''],['会话走查表（逐条看录屏）','那要一起定取数层级和列分工'],
                  ['找具体的坏case给评审看',''],['印证某个假设','那先把假设写下来，别边看边改假设']] }
        ]},
      { t:'数据样本够不够', h:'先读采样率，再定接口。顺序反了，后面的数都不知道代表什么',
        qs:[
          { k:'y6', type:'check', q:'采样率确认了吗？',
            opts:[['已经看过',''],
                  ['还没','那第一件事去看它，不是先拉数'],
                  ['量很小（几十条）','那只能当线索，不能当结论。报的时候要写清样本量']] },
          { k:'y7', type:'check', q:'结论的边界？',
            opts:[['只当线索，后面要别的数据印证',''],
                  ['要写进复盘当论据','那样本量和采样率必须一起写出来'],
                  ['要拿去说服人','那更要写清边界——被质疑一次，整份材料的可信度就没了']] }
        ]}
    ],
    out:['要回答的问题（写在最前面）','采样率与样本量（跟结论放在一起，不藏在附录）',
         '数据结论','会话走查表（如需，含截图）','这份数据回答不了什么'],
    skills:[['CC-clarity','起手三件事＋已证伪的判据'],
            ['MIC-交互','行为怎么翻成交互问题'],
            ['MIC-表达','认知诚实：说清边界']]
  },

  /* ══ 走查复盘 · 项目数据复盘 ═══════════════════════════════
     栽的地方两个：① 把相关当因果；② 口径没定 ——
     一笔业务挂着多个时间戳，选哪个当口径会得出不同的数。 */
  'review/2': {
    file:'docs/ued/MIC-XXX/13-复盘.md',
    auto:[
      { kind:'kb', q:'复盘 方法论 设计视角 我做了哪些设计 数据检验', want:'fupan-method', label:'检索复盘方法论与模板' },
      { kind:'kb', q:'复盘 认知诚实 克制 别宣称 完成式', want:'retro-honesty-restraint', label:'检索复盘的认知诚实与克制' },
      { kind:'kb', q:'口径 时间戳 一笔钱 多个 指标', want:'order-funds', label:'检索指标口径那条跨域判据' }
    ],
    steps:[
      { t:'我做了哪些设计', h:'先把设计动作列清楚。列不出来，后面的数就没有归因对象',
        qs:[
          { k:'p1', type:'area', q:'这次改了哪几件事？',
            ph:'一件一行。例：筛选区从平铺改成收纳／询盘入口从底部移到右侧浮层',
            hint:'一次改了多件事的话，数据涨了也说不清是哪件起的作用 —— 这个限制要在复盘里写出来，别装作能归因。' },
          { k:'p2', type:'check', q:'当初的GSSM表还在吗？',
            opts:[['在，直接拿来对账','最好。设计目标→信号→指标逐行核'],
                  ['当时没写','那这次补一张，至少把「当初想达成什么」写清楚'],
                  ['写了但没留',''],]}
        ]},
      { t:'数据与口径', h:'同一个指标，取不同的时间戳会得出不同的数',
        qs:[
          { k:'p3', type:'check', q:'数据从哪来？',
            opts:[['业务方给的报表',''],['自己拉的埋点',''],['AB实验结果','那要看清实验组和对照组的分流'],
                  ['Clarity行为数据','那要带采样率'],['还没有','那先去要，别先写结论']] },
          { k:'p4', type:'area', q:'关键指标用的是哪个口径？',
            ph:'例：询盘数按「发起」还是按「送达」算？按哪一天归属？',
            hint:'定完写下来。下一次复盘换了口径，两次的数就没法比。' },
          { k:'p5', type:'check', q:'有before吗？',
            opts:[['有，同口径的',''],['有，但口径不完全一样','那要说明差异'],
                  ['没有','那这次只能报绝对值，不能报「提升了多少」']] }
        ]},
      { t:'用户行为验证', h:'数字涨了，还要看用户是不是真按你设计的方式在用',
        qs:[
          { k:'p6', type:'check', q:'行为层面看了什么？',
            opts:[['新交互的使用率',''],['旧路径有没有被放弃',''],
                  ['有没有出现意料之外的用法','这一条最值钱'],
                  ['会话回放看过几条',''],['没看','那结论里别说「用户更愿意…」，那是猜的']] }
        ]},
      { t:'诚实边界', h:'说不清的地方写「说不清」，比编一个解释可信',
        qs:[
          { k:'p7', type:'area', q:'哪些结论其实站不太住？',
            hint:'例：同期还有大促／同时改了三处／样本只有两周。写出来。复盘的可信度来自敢标不确定，不来自结论漂亮。' },
          { k:'p8', type:'check', q:'这份复盘给谁看？',
            opts:[['团队内部',''],['向上汇报','那要过表达那一层：说人话、不堆黑话'],
                  ['跨部门',''],['当模板给别人用','那口径和方法要写得别人能照着用']] }
        ]}
    ],
    out:['设计动作清单','GSSM对账（设计目标→信号→指标逐行）',
         '数据结论＋口径说明（用哪个时间戳）','用户行为验证',
         '站不住的地方（明写）','下一步的设计优化'],
    skills:[['MIC-表达','汇报口吻＋版式铁律＋认知诚实'],
            ['CC-clarity','行为层论据'],
            ['MIC-交互','把数据结论翻回交互决策']]
  },

  /* ══ 运营专项 · 运营坑位图 ═══════════════════════════════
     栽的地方：每个语言各画一套，改一次改十遍。
     母版加实例是这类活的地基，不是可选项。 */
  'ops/0': {
    file:'docs/ued/MIC-XXX/20-运营坑位说明.md',
    auto:[
      { kind:'kb', q:'运营 Master Instance 母版 实例 坑位', label:'检索Master-Instance模式' },
      { kind:'kb', q:'坑位图 规范 尺寸 banner 运营', label:'检索坑位图规范与尺寸' },
      { kind:'kb', q:'banner 造错例 体检 门 运营图', label:'检索banner体检门' }
    ],
    steps:[
      { t:'投放在哪、什么尺寸', h:'尺寸清单先定死，中途加尺寸最费时间',
        qs:[
          { k:'o1', type:'text', q:'投放位与尺寸？',
            ph:'例：首页轮播1200×400、类目页顶部970×250',
            hint:'把所有要出的尺寸一次列全。母版结构要照最复杂那个尺寸搭，缩到小尺寸才不散。' },
          { k:'o2', type:'text', q:'活动是什么、什么时候上？',
            ph:'例：9月大促，9/20上线' }
        ]},
      { t:'几个语言版本', h:'语言数×尺寸数=实例数。这个数决定了要不要母版',
        qs:[
          { k:'o3', type:'check', q:'要哪些语言？',
            opts:[['英语',''],['西语',''],['阿语','阿语要整段镜像，母版里要预留RTL'],
                  ['俄语','长词多，文案框要留余量'],['法语／葡语',''],['只有英语','']] },
          { k:'o4', type:'check', q:'各语言之间会变的是什么？',
            opts:[['只有文案',''],['文案＋按钮宽度',''],['还要换图',''],
                  ['布局要跟着变','那母版要按最长文案搭，别按英语搭']] }
        ]},
      { t:'母版怎么搭', h:'改一处全套跟着变——这是这类活唯一的省法',
        qs:[
          { k:'o5', type:'check', q:'哪些元素要做成母版里的可替换槽位？',
            opts:[['主标题',''],['副标题／卖点',''],['按钮文案',''],
                  ['产品图',''],['价格／折扣数字',''],['背景与装饰','']] },
          { k:'o6', type:'check', q:'哪些是固定的、不许各实例自己改？',
            opts:[['品牌红#E64545',''],['字体（全场景Roboto）',''],
                  ['安全边距',''],['LOGO位置和大小','']] }
        ]},
      { t:'导出与验收', h:'导出规格错了要全套重导',
        qs:[
          { k:'o7', type:'check', q:'导出要求？',
            opts:[['PNG／JPG各要哪些',''],['倍图（1x／2x）',''],
                  ['体积上限','运营图常有KB限制，超了要压'],
                  ['命名规则','按投放位＋语言＋尺寸，别随手命名'],
                  ['要不要留可编辑源文件','']] }
        ]}
    ],
    out:['母版＋各语言各尺寸的实例（改母版全套跟着变）','固定项清单（不许实例改的）',
         '导出成品（按命名规则）','阿语版单独确认过镜像'],
    skills:[['MIC-运营','Master-Instance模式'],
            ['figma-feique-first','飞鹊真值'],
            ['MIC-交付规范','母版唯一，实例不许各自改']]
  },

  /* ══ 运营专项 · 阿语与RTL ═════════════════════════════════
     栽的地方：**字体选错了整套白做**。
     Amiri只在运营图用；项目稿／UI稿／交互稿的阿语仍然用Roboto（2026-08-06纠正过一次）。
     所以第1步就问「这是运营图还是UI稿」。 */
  'ops/1': {
    file:'docs/ued/MIC-XXX/21-阿语版说明.md',
    auto:[
      { kind:'kb', q:'阿语 RTL Amiri 运营图 Roboto 视觉规范', want:'arabic-rtl-amiri', label:'检索阿语视觉规范（字体分场景）' },
      { kind:'kb', q:'RTL 镜像 整段 布局 方向', label:'检索RTL镜像规则' },
      { kind:'kb', q:'多语 站点 简化版 规则 不一样', label:'检索多语站与主站的差异' }
    ],
    steps:[
      { t:'要出阿语版的是什么稿', h:'第一问就是字体的分岔口，选错整套重做',
        qs:[
          { k:'ar1', type:'check', q:'要出阿语版的是？',
            opts:[['运营图／坑位图／海报','那用Amiri'],
                  ['UI稿／交互稿／项目稿','那阿语仍然用Roboto，不是Amiri'],
                  ['HTML页面／demo','那按UI稿走，Roboto'],
                  ['不确定','那先定——这一问不定后面全白做']] }
        ]},
      { t:'镜像哪些', h:'RTL是整段镜像，不是只把文字右对齐',
        qs:[
          { k:'ar2', type:'check', q:'要镜像的？',
            opts:[['整体布局左右翻转','默认。RTL整段镜像全场景生效'],
                  ['图标方向（箭头／返回）','方向性图标要翻，品牌LOGO不翻'],
                  ['进度／步骤条方向',''],['轮播和滑动方向',''],
                  ['表格列顺序',''],['阴影方向','']] },
          { k:'ar3', type:'check', q:'哪些不翻？',
            opts:[['LOGO',''],['数字',''],['英文品牌名与型号',''],
                  ['电话号码',''],['产品图','']] }
        ]},
      { t:'混排与长度', h:'阿语句子跟英语的长度差得多，框子会被顶开',
        qs:[
          { k:'ar4', type:'check', q:'有没有这几类混排？',
            opts:[['阿语里夹英文品牌／型号',''],['阿语里夹数字和价格',''],
                  ['阿语里夹URL',''],['都没有','']] },
          { k:'ar5', type:'text', q:'最长的那段文案有多长？',
            ph:'拿真实翻译量一下，别用英文长度估' }
        ]}
    ],
    out:['阿语版（字体按稿的类型选对：运营图Amiri／UI稿Roboto）',
         '镜像清单：翻了哪些、哪些故意没翻','混排处的处理方式','最长文案下不破版'],
    skills:[['MIC-运营','运营图的阿语走这条'],
            ['figma-feique-first','UI稿的阿语用Roboto'],
            ['MIC-交付规范','镜像规则要写给前端']]
  },

  /* ══ 运营专项 · 应用市场图片 ═══════════════════════════════
     栽的地方：不同商店的尺寸和安全区不一样，按一家的规格出全套会被驳回。 */
  'ops/2': {
    file:'docs/ued/MIC-XXX/22-应用市场素材说明.md',
    auto:[
      { kind:'kb', q:'图片 批量 导出 尺寸 倍图 命名', want:'batch-copy-banner-ops',
        label:'检索批量导出与命名规格' },
      { kind:'kb', q:'运营 Master Instance 母版 实例 坑位', want:'master-instance-mode',
        label:'检索母版加实例（改一次文案不用改几十张）' },
      { kind:'kb', q:'飞鹊 视觉规范 字号 色值 品牌红', want:'飞鹊视觉规范', label:'检索飞鹊视觉真值' }
    ],
    steps:[
      { t:'要投哪个商店', h:'先定商店，尺寸清单才有意义',
        qs:[
          { k:'m1', type:'check', q:'要投哪些？',
            opts:[['App Store（iOS）',''],['Google Play',''],
                  ['国内安卓商店','各家规格不统一，要逐家确认'],
                  ['自有落地页下载区',''],['不确定','那先去问运营，别先动手']] },
          { k:'m2', type:'check', q:'要出哪几类素材？',
            opts:[['应用截图（多尺寸）',''],['应用图标',''],
                  ['特色图／宣传图',''],['预览视频封面','']] }
        ]},
      { t:'源图与安全区', h:'源图不够大，放大后糊；安全区没留，文字会被裁',
        qs:[
          { k:'m3', type:'check', q:'源图从哪来？',
            opts:[['App里真实截的','那要确认状态栏、时间、电量这些要不要处理'],
                  ['设计稿导出的',''],['已有的成品图再改尺寸','那要先确认最大那一档够不够清晰'],
                  ['要新画','']] },
          { k:'m4', type:'text', q:'各档尺寸与安全区？',
            ph:'把每个商店要求的尺寸和安全边距列出来。不同商店不一样，别按一家的套全部' }
        ]},
      { t:'批量与命名', h:'几十张图靠手改，改一轮文案就要重来一轮',
        qs:[
          { k:'m5', type:'check', q:'怎么产出？',
            opts:[['母版＋批量导出','默认。文案要改时只改母版'],
                  ['脚本批量处理',''],['手工逐张','只在张数很少时']] },
          { k:'m6', type:'text', q:'命名规则？',
            ph:'例：store-lang-size.png。规则先定，别导完再改名' }
        ]}
    ],
    out:['各商店各尺寸的成品图（按命名规则）','安全区都留够，文字没被裁',
         '母版（下次改文案只改这里）','最大档的清晰度确认过'],
    skills:[['MIC-运营','母版加实例'],
            ['figma-feique-first','视觉真值'],
            ['MIC-交付规范','命名与导出规格']]
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
  if(n && !confirm('已填写'+n+'项，关闭后不保留。确定放弃？')) return;
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
    ${W.step===0 ? wzAutoHTML() : ''}
    <div class="wz-q">
      <div class="wz-qn">第${W.step+1}步 / 共${d.steps.length}步</div>
      <div class="wz-qt">${st.t}</div>
      <div class="wz-qh">${st.h||''}</div>
      ${st.qs.map((q,i)=>wzQHTML(q,i)).join('')}
    </div>`;

  wzRail(); wzSide(); wzProg();
  const last = W.step===d.steps.length-1;
  /* 🔴 最后一步隐藏「下一步」。原来它改文案成「完成填写」，可wzNext() 里
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
/* 左侧步骤栏：每一步下面挂着这一步已经定下来的答案 ——
   参考 CE 的做法「每一步交一份耐久产物」，走到第 3 步时前两步定了什么一眼可见，不用翻回去。 */
function wzRail(){
  const d=wzDef();
  document.getElementById('wzRail').innerHTML = d.steps.map((s,i)=>{
    const done=i<W.step, on=i===W.step;
    const got=(s.qs||[]).filter(wzFilled).map(q=>{ let v=W.ans[q.k]; if(Array.isArray(v)) v=v.join('、'); return wzEsc(String(v)); });
    return `<button class="wzs ${on?'wzon':(done?'wzdone':'')}" onclick="wzGo(${i})">
      <span class="i">${done?FQ_YES:i+1}</span>
      <span class="wzs-tx"><span class="wzs-tt">${s.t}</span>${got.length?`<span class="wzs-got">${got.map(g=>`<span>${g}</span>`).join('')}</span>`:''}</span>
    </button>`;
  }).join('');
}

/* ── 「已经替你查了」：真查 ───────────────────────────── */
function wzAutoHTML(){
  const d=wzDef(), done=W.state==='done';
  const rows = W.rows.length ? W.rows : d.auto.map(a=>({label:a.label,state:'',detail:''}));
  const miss = rows.filter(r=>r.state==='miss').length;
  return `<div class="wz-auto ${miss?'bad':''} ${done&&W.fold?'fold':''}" id="wzAuto">
    <button class="wz-ah" onclick="wzFold()">
      ${done?'<span class="ok">'+FQ_YES+'</span>':'<span class="wzspin"></span>'}
      <span>${done ? (miss? '检索完成，其中'+miss+'项无匹配' : '以下资料已完成知识库检索')
                   : '正在检索知识库'}</span>
      <span class="real">实时检索</span>
      <span class="wzn">${rows.length}项${done?(W.fold?' · 展开':' · 收起'):''}</span>
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
        s.src=src; s.onload=ok; s.onerror=()=>no(new Error('同目录找不到'+src));
        document.head.appendChild(s);
      });
    }
    one('kb-search.js').then(()=>one('kb.js')).then(()=>{
      if(window.WBKB && window.WBSearch) res(true);
      else rej(new Error('kb.js加载了但WBKB / WBSearch没挂上'));
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
        +'（页面需与kb.js、kb-search.js置于同一目录）';
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
      W.rows[i].detail='检索到'+hits.length+'段 · '
        + docs.slice(0,4).map(x=>`<a class="wz-doc" href="#" onclick="return wzPeek('${wzEsc(x).replace(/'/g,"\\'")}')">${wzEsc(x)}</a>`).join('')
        + (docs.length>4? `<span class="wz-more">还有${docs.length-4}份</span>`:'');
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
  wzRail(); wzSide(); wzProg();       /* 🔴 只重画左右两栏和计数，不重画整个 main —— 否则输入框会失焦 */
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
  wzRail(); wzSide(); wzProg();
}

/* ── 右侧任务单 ─────────────────────────────────────── */
function wzSide(){
  const d=wzDef(), c=wzCard(), sc=wzScene(), all=wzAllQs();
  const f=all.filter(wzFilled), b=all.filter(q=>!wzFilled(q));
  const pct = all.length ? Math.round(f.length/all.length*100) : 0;
  document.getElementById('wzSide').innerHTML=`
    <div class="rcpt-t">任务单</div>
    <div class="rcpt-sub">${wzEsc(sc.name)} / ${wzEsc(c.n)}</div>
    <div class="rc-sum"><i class="rc-bar"><b style="width:${pct}%"></b></i><span class="lb">确定</span><span class="wzn">${f.length} / ${all.length}</span></div>

    <div class="rcpt-div">这一单会交出</div>
    <ul class="rc-out">${d.out.map(o=>`<li>${wzEsc(o)}</li>`).join('')}</ul>

    <div class="rcpt-div">确定</div>
    ${f.length ? `<ul class="rc-list">${f.map(q=>{
        let v=W.ans[q.k]; if(Array.isArray(v)) v=v.join('、');
        return `<li class="rc-item"><span class="mk">${FQ_YES}</span><span>
          <span class="wznm">${wzEsc(q.q)}</span><span class="vl">${wzEsc(v)}</span></span></li>`;
      }).join('')}</ul>`
      : '<p class="rc-empty">尚未确定任何一项。左侧填写后，此处同步生成。</p>'}

    ${b.length?`<div class="rcpt-div">待定</div>
    <ul class="rc-list">${b.map(q=>`<li class="rc-item off"><span class="mk">&#9675;</span>
      <span><span class="wznm">${wzEsc(q.q)}</span></span></li>`).join('')}</ul>`:''}

    <div class="rcpt-div">调用的能力</div>
    <ul class="rc-kit">${d.skills.map(k=>`<li><span class="sn">${wzEsc(k[0])}</span>
      ${k[1]?`<span class="wzsw">${wzEsc(k[1])}</span>`:''}</li>`).join('')}</ul>`;
}
function wzProg(){
  const all=wzAllQs(), n=all.filter(wzFilled).length;
  document.getElementById('wzProg').textContent='确定'+n+' / '+all.length;
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
    L.push('还没定的'+b.length+'项（不要替我拿默认假设补上，需要问PM或业务的直接标出来）：');
    b.forEach(q=>L.push('- '+q.q));
  }
  L.push('');
  L.push('要交出：'+d.out.join('；'));
  if(!forModel){
    L.push('');
    L.push('用这些能力：'+d.skills.map(k=>k[0]).join('、'));
    L.push('产出落到'+d.file);
    const docs=[]; W.hits.forEach(h=>{ if(docs.indexOf(h.d)<0) docs.push(h.d); });
    if(docs.length){
      L.push('');
      L.push('向导已经在知识库里查到这些相关文档（'+docs.length+'份）：');
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
/* 收尾：不再直接送进页面内问答，改成先问「交给谁做」。
   三条路的差别不是「换个地方回答」—— 前两条拉起的是完整 Claude Code（有工具、有技能、
   有门），第三条是页面内问答（关了全部工具）。差别写在选择界面里，见 patch-terminal.py。
   桥不在 / 那一层没注入时退回原来的行为，别把人卡在这一步。 */
function wzHandoff(){
  var d = wzDef(), c = wzCard(), sc = wzScene();
  if(typeof window.wbHandoff !== 'function'){ wzAsk(); return; }
  var docs = []; W.hits.forEach(function(h){ if(docs.indexOf(h.d) < 0) docs.push(h.d); });
  var q = wzText(true);
  window.wbHandoff({
    task: c.n, card: c.n, scene: sc.name,
    prompt: q, chars: q.length,
    docs: docs, out: d.out || [], skills: d.skills || [], file: d.file || ''
  });
}
async function wzCopy(){
  const t=wzText(false);
  const tip=document.getElementById('wzTip');
  try{ await navigator.clipboard.writeText(t); tip.textContent='已复制'+t.length+'字'; }
  catch(e){
    /* 本地 file:// 下剪贴板可能被拦。别只说失败，把文本摊出来让人手动选。 */
    const ta=document.createElement('textarea');
    ta.value=t; ta.style.cssText='position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);'
      +'width:min(680px,90vw);height:50vh;z-index:300;padding:14px;font-size:12px;border-radius:8px';
    document.body.appendChild(ta); ta.select();
    ta.onblur=()=>ta.remove();
    tip.textContent='浏览器已阻止自动复制，请按Cmd+C手动复制';
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
      <nav class="wz-rail" id="wzRail"></nav>
      <div class="wz-main" id="wzMain"></div>
      <div class="wz-side" id="wzSide"></div>
    </div>
    <div class="wz-ft">
      <span class="wz-prog" id="wzProg">确定0 / 0</span>
      <span class="wz-tip" id="wzTip"></span>
      <div style="margin-left:auto;display:flex;gap:8px">
        <button class="wz-btn" id="wzPrev" onclick="W.step--;wzDraw()">上一步</button>
        <button class="wz-btn" id="wzCopy" onclick="wzCopy()" hidden>复制给Claude Code</button>
        <button class="wz-btn wzpri" id="wzNext" onclick="wzNext()">下一步</button>
        <button class="wz-btn wzpri" id="wzAsk" onclick="wzHandoff()" hidden>下一步：交给谁做</button>
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
    ok = {'var(--r-xs)', 'var(--ctl-r)', 'var(--box-r)', 'var(--r-lg)', 'var(--r-pill)', '999px', '50%', '0'}
    code = _css_code()
    bad = []
    for m in re.finditer(r'border-radius:\s*([^;}\n]+)', code):
        v = m.group(1).strip()
        if v not in ok:
            line = code[:m.start()].count('\n') + 1
            bad.append((line, v))
    if bad:
        print('❌ 圆角门：这些值不是全站 token（只允许 --r-xs / --ctl-r / --box-r / --r-lg / 胶囊 / 整圆 / 0）')
        for l, v in bad:
            print('   CSS第 %d行：border-radius:%s' % (l, v))
        sys.exit(1)
    print('✅ 圆角门通过 · %d处border-radius全部是全站 token（4 / 8 / 12 / 18 / 胶囊 / 整圆 / 0）'
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
    # 🔴 2026-09-09：还要把「接力到终端」那一层剥掉。它注入在 </style> 前、
    #    排在向导 CSS 之前，所以会落进 base 里；而它为了分区**有意**用带作用域的
    #    选择器改了 .wizmask / .wz-peek（`html.uwt-split .wizmask{right:…}`）。
    #    不剥的话这道门会把「我另一层有意改的」报成「本体撞名」——
    #    对照范围没圈准，报出来的红是假的。（同族：先把 population 圈准）
    if '==WB-TERM-CSS:BEGIN==' in base:
        import re as _re
        base = _re.sub(r'/\* ==WB-TERM-CSS:BEGIN== \*/.*?/\* ==WB-TERM-CSS:END== \*/',
                       '', base, flags=_re.S)
    clash = sorted(c for c in mine if re.search(r'\.' + re.escape(c) + r'\s*\{', base))
    if clash:
        print('❌ 撞名门：这些class跟WorkBuddy自己的同名，会漏属性进来')
        for c in clash:
            d = re.search(r'\.' + re.escape(c) + r'\s*\{([^}]*)\}', base)
            print('   .%-10s WorkBuddy定义： %s' % (c, (d.group(1) if d else '?')[:80]))
        print('   → 给它们加wz前缀，别靠特异性打架（没覆盖到的属性照样漏）')
        sys.exit(1)
    print('✅ 撞名门通过 · 我的 %d个class没有一个跟WorkBuddy同名' % len(mine))



def emoji_gate():
    """页面可见文案里不许出现 🔴 ⚠️ 这类记笔记用的记号。

    🔴 2026-09-09 立（铺完 15 张卡后自己看截图发现的）：
    我写 memory 习惯用 🔴 标重点，铺卡的时候把这个习惯直接带进了产品文案 ——
    页面上出现「🔴 第一问就是字体的分岔口」「⚠️ 最后选择」，一共 31 处。
    memory 是给自己的笔记，页面是给同事用的产品，两者的写法不是一回事；
    做 MIC 业务沙盘时栽的就是这同一条，这次是第二遍。

    只扫会渲染到页面的字段（h / q / ph / hint / t / opts 两个元素 / out / skills 说明），
    **注释里的记号一律不动** —— 那是给写代码的人看的，不进页面。
    重点还是要标，改用文字标（「这一问不定，后面全是白工」），不用图形记号。
    """
    import re
    i = JS.index('const WIZ = {')
    j = JS.index("\n};", JS.index("'ops/2'"))
    blk = JS[i:j]
    # 剥注释行，注释里的记号不算
    lines = []
    for line in blk.split('\n'):
        st = line.lstrip()
        if st.startswith(('/*', '*', '//')) or st.startswith('*/'):
            continue
        lines.append(line)
    code = '\n'.join(lines)
    vis = re.findall(r"(?:h|q|ph|hint|t):'((?:[^'\\]|\\.)*)'", code)
    vis += [x for pair in re.findall(r"\['((?:[^'\\]|\\.)*)','((?:[^'\\]|\\.)*)'\]", code) for x in pair]
    for m in re.finditer(r"(?:out|skills):\[(.*?)\]\n", code, re.S):
        vis += re.findall(r"'((?:[^'\\]|\\.)*)'", m.group(1))
    BAD = ['\U0001F534', '\u26a0\ufe0f', '\u26a0', '\u2705', '\u274c', '\U0001F195', '\U0001F31F']
    hit = []
    for t in vis:
        for e in BAD:
            if e in t:
                hit.append(e + ' → ' + t[:44])
    if hit:
        print('❌ 记号门：页面可见文案里出现了记笔记用的记号（%d 处）' % len(hit))
        for h in hit[:8]:
            print('   ' + h)
        print('   → memory 用记号，产品文案用文字。重点改成一句话说清，别用图形')
        sys.exit(1)
    print('✅ 记号门通过 · %d 条页面文案里没有 🔴/⚠️ 这类记号' % len(vis))



JARGON = os.path.expanduser('~/.claude/skills/mic-fullstack/assets/express-jargon.json')


def jargon_gate():
    """页面文案不许出现黑话。词典用 MIC-表达 那份 express-jargon.json，**不在这儿抄第二份**
    （同一个量只写一处；那份词典是被抓到一次就往里加的，越喂越准）。

    hard = 任何场景都不该出现，硬报；soft = 语境词（内部可用、对外别用），只提示不拦。
    向导文案是给同事天天用的产品界面，按对外算 —— 2026-08-21 吉吉把「产品界面也算对外材料」
    写进了 MIC-表达 的触发范围，栽的实例正是「把 memory 的写法直接搬进产品界面」。

    词典拿不到就跳过、不阻断：门不能把人锁在门外，换台机器没这份 skill 也得能出稿。
    """
    import json, re
    if not os.path.exists(JARGON):
        print('⚪ 黑话门跳过 · 找不到 express-jargon.json（换机器了？不阻断）')
        return
    d = json.load(open(JARGON, encoding='utf-8'))
    i = JS.index('const WIZ = {')
    j = JS.index("\n};", JS.index("'ops/2'"))
    lines = [l for l in JS[i:j].split('\n') if not l.lstrip().startswith(('/*', '*', '//'))]
    code = '\n'.join(lines)
    vis = re.findall(r"(?:h|q|ph|hint|t):'((?:[^'\\]|\\.)*)'", code)
    vis += [x for pair in re.findall(r"\['((?:[^'\\]|\\.)*)','((?:[^'\\]|\\.)*)'\]", code) for x in pair]
    for m in re.finditer(r"(?:out|skills):\[(.*?)\]\n", code, re.S):
        vis += re.findall(r"'((?:[^'\\]|\\.)*)'", m.group(1))
    hard, soft = [], []
    for t in vis:
        for e in d.get('hard', []):
            if e['w'] in t:
                hard.append('%s → 改说「%s」  ｜ %s' % (e['w'], e.get('say', ''), t[:40]))
        for e in d.get('soft', []):
            if e['w'] in t:
                soft.append('%s（%s）｜ %s' % (e['w'], e.get('say', ''), t[:34]))
    if soft:
        print('⚠️ 黑话门 · %d 处语境词（内部可用、对外别用，自己判一下）' % len(soft))
        for x in soft[:5]:
            print('   ' + x)
    if hard:
        print('❌ 黑话门：页面文案里有 %d 处硬黑话' % len(hard))
        for x in hard[:8]:
            print('   ' + x)
        sys.exit(1)
    print('✅ 黑话门通过 · %d 条页面文案对了 %d 个 hard 词' % (len(vis), len(d.get('hard', []))))


def syntax_gate(js):
    """注入前先验 JS 语法 —— 少一个括号整页就废，而 patch 脚本自己不会报错。
    这道门是 patch-ai.py 那边 2026-09-08 立的，这里照抄。"""
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f:
        f.write(js); tmp = f.name
    r = subprocess.run(['node', '--check', tmp], capture_output=True, text=True)
    os.unlink(tmp)
    if r.returncode != 0:
        print('❌ JS语法门：注入的脚本语法错，已中止（index.html没被动）')
        print(r.stderr.strip()[:900]); sys.exit(1)
    print('✅ JS语法门通过')


def main():
    import re
    if not os.path.exists(PAGE):
        print('❌ 找不到index.html'); sys.exit(1)
    page = open(PAGE, encoding='utf-8').read()

    # wzNext 要看得到 wzDraw，放在 JS 末尾统一声明
    js = JS + '''
function wzNext(){
  const d=wzDef();
  if(W.step < d.steps.length-1){ W.step++; wzDraw(); }
}
'''
    # 🔴 先删掉上一次注入的，再跑门，再插。
    #    顺序不能反：撞名门是拿「页面本体」当对照的，不先清掉上一次注入的自己，
    #    第二次跑就会把自己的 class 报成撞名（自己跟自己撞）。
    page, n1 = strip_between(page, CSS_B, CSS_E)
    page, n2 = strip_between(page, DOM_B, DOM_E)
    page, n3 = strip_between(page, JS_B, JS_E)
    if n1 or n2 or n3:
        print('   （先清掉上一次注入的 %d/%d/%d块）' % (n1, n2, n3))

    radius_gate()
    collision_gate(page)
    emoji_gate()
    jargon_gate()
    syntax_gate(js)

    # CSS 进 </style> 前
    i = page.rindex('</style>')
    page = page[:i] + CSS_B + '\n' + CSS + '\n' + CSS_E + '\n' + page[i:]

    # 弹层DOM进 </body> 前（要在body下，不能进 #main —— render() 会重写 #main）
    j = page.rindex('</body>')
    page = page[:j] + DOM_B + MASK + DOM_E + '\n' + page[j:]

    # JS进最后一个 </script> 前（这样SCENES / S / pick / wbRun都已经声明过了）
    k = page.rindex('</script>')
    page = page[:k] + '\n' + JS_B + '\n' + js + '\n' + JS_E + '\n' + page[k:]

    open(OUT, 'w', encoding='utf-8').write(page)
    print('✅ 向导层已注入index.html · %.0f KB' % (os.path.getsize(OUT)/1024))
    # 🔴 原来这行写死了「design/0」，加了卡它还是这么报 —— 改了 A 忘了绑定的 B。
    #    现在从 JS 里的 WIZ 表抽，单一维护源。
    keys = re.findall(r"^  '([a-z]+/\d+)':\s*\{", JS, re.M)
    print('   已登记向导的卡片（%d张）：%s' % (len(keys), '、'.join(keys)))


if __name__ == '__main__':
    main()
