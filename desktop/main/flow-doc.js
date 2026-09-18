'use strict';
/* ── 把扫描结果编译成「交互流程说明」──────────────────────────────
   吉吉 2026-09-17：「前端拿到的不仅是 html，还要自带全部交互流程说明」「人和 AI 都能读取」。

   🔴「给 AI 读」不等于「输出 JSON」。读文档的时候最怕的不是格式不结构化，是**找不到对应位置**——
   说明里写「点击立即询盘后校验手机号」，得在十几个页面里猜哪个按钮是「立即询盘」，猜错了就开始编。
   所以这份文档的两条硬要求跟格式无关：
     ① 可定位：每条规则都指得到真实的选择器 / 类名 / 文件名，不靠文字描述让人猜
     ② 可核验：说明里提到的选择器，页面里必须真的存在（flow.js 的 spec-drift 门盯着）

   一份文件、两层内容，不出两份（两个维护源必打架）：
     契约层 —— 页面清单 / 跳转矩阵 / 状态清单 / 字段规则，**全部机器生成**，前端和他的 AI 主要吃这层
     意图层 —— 为什么这么设计、异常怎么想的，人写在各页的 .说明.md 里，这里原样搬过来
   另外附一份 flow.json，要精确解析的走它。 */

const fs = require('fs');
const path = require('path');

const cell = s => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n+/g, ' ').trim();
const code = s => s ? '`' + cell(s) + '`' : '';

/* 人写的说明里，把三张结构化表之外的散文摘出来——那部分是「为什么」，机器生不出来，也不该动 */
function proseOf(md) {
  const out = [];
  let sec = '', buf = [];
  const flush = () => { const t = buf.join('\n').trim(); if (sec && t) out.push({ h: sec, body: t }); buf = []; };
  for (const line of String(md).split(/\r?\n/)) {
    const h = line.match(/^#{1,6}\s*(.+?)\s*$/);
    if (h) { flush(); sec = h[1]; continue; }
    buf.push(line);
  }
  flush();
  /* 三张契约表在下面会机器重出一遍，这里不重复搬；
     一级标题那节是页面名 ＋「> 文件：… 角色：…」的元信息，下面的逐页小节已经给过了，也不重复 */
  return out.filter(x => !/^(状态|跳转|规则|校验|字段)/.test(x.h))
            .filter((x, i) => !(i === 0 && /^>/.test(x.body.trim())));
}

/* 说明里写的是 `a.inq-btn`，页面上是 class="btn inq-btn"（扫出来 `a.btn.inq-btn`）——
   字面相等匹配不上，按**类名子集**匹配：说明点名的那几个类，扫出来的那条都有，就算同一条。
   说明没写类名时，只有这一条指向那一页才认（有多条就说不准是哪条，宁可留空也不错配）。 */
function matchWhen(specLinks, l) {
  const list = (specLinks || []).filter(x => x.to === l.to);
  if (!list.length) return null;
  const have = new Set(l.cls || []);
  const hit = list.find(x => {
    const want = String(x.sel || '').split('.').filter(Boolean).filter(c => c !== 'a');
    return want.length ? want.every(c => have.has(c)) : false;
  });
  if (hit) return hit;
  const bare = list.filter(x => !String(x.sel || '').includes('.'));
  return (bare.length === 1 && list.length === 1) ? bare[0] : null;
}

function build(d, opt) {
  opt = opt || {};
  const name = opt.projectName || '这个需求';
  const L = [];
  const p = s => L.push(s);

  p(`# ${name} · 交互流程说明`);
  p('');
  p(`> 这份说明和同目录的页面是一体的，由 UED WorkBuddy 从页面代码里扫出来再合上人写的意图，${new Date(d.at).toLocaleString('zh-CN')} 生成。`);
  p('>');
  p('> **怎么读**：');
  p('> - 要知道「这个按钮跳哪」「这个字段怎么校验」——查下面的跳转矩阵和字段规则表，每行都带真实的选择器或文件名。');
  p('> - 要知道「为什么这么设计」——看每一页的「意图」那节，那是人写的。');
  p('> - 要程序精确解析——读同目录的 `flow.json`，这份 md 的表格是它的人类可读版，两份同源。');
  p('>');
  p('> **状态怎么看**：页面状态是根节点上的一个类（`<body class="state-xxx">`）。');
  p('> 这些类就是要用的真实状态类，不是演示用的脚手架——页面里没有任何切换状态的代码。');
  p('> 同一个文件里的抽屉 / 浮层 / 弹窗算**另一屏**（下面叫「视图」），它的状态写成 `state-<视图>-<态>`；');
  p('> 另有一族 `on-*` 是**叠加开关**，跟状态正交、可以同时挂几个（比如客服视角）。');
  p('');

  /* ── 一、页面清单 ───────────────────── */
  p('## 一、页面清单');
  p('');
  /* 报「屏」不报「页」：一个 html 带三个抽屉时，「1 个页面」会让人低估工作量，
     而前端要实现的是 4 屏十一个态。 */
  p(`入口是 \`${d.entry || '（没定）'}\`，一共 ${d.pages.length} 个页面 / ${d.n.views != null ? d.n.views : d.pages.length} 屏（含抽屉、浮层）、${d.n.states} 个状态。`);
  p('');
  p('| 页面 | 文件 | 状态数 | 进来的路 | 出去的路 |');
  p('|---|---|---|---|---|');
  for (const pg of d.pages) p(`| ${cell(pg.title)} | ${code(pg.rel)} | ${pg.states.length} | ${pg.in} | ${pg.out} |`);
  p('');

  /* ── 二、跳转矩阵 ───────────────────── */
  p('## 二、跳转矩阵');
  p('');
  const anyLink = d.pages.some(x => x.links.length);
  if (!anyLink) p('页面之间还没有链接。');
  else {
    p('从页面代码里的 `<a href>` 扫出来的，不是手画的，所以不会跟页面脱节。');
    p('');
    p('| 从哪一页 | 点什么 | 选择器 | 跳到哪一页 | 什么时候 |');
    p('|---|---|---|---|---|');
    for (const pg of d.pages) for (const l of pg.links) {
      const to = d.pages.find(x => x.rel === l.to);
      const when = matchWhen(pg.spec.links, l);
      p(`| ${code(pg.rel)} | ${cell(l.text || '（没有文字）')} | ${code(l.sel)} | ${code(l.to)}${l.ok ? '' : ' ⚠️ 项目里没有这一页'} | ${cell(when ? when.when : '')} |`);
    }
  }
  p('');

  /* ── 三、逐页 ───────────────────── */
  p('## 三、逐页');
  p('');
  for (const pg of d.pages) {
    p(`### ${pg.title}　\`${pg.rel}\``);
    p('');
    p('**状态**');
    p('');
    p('| 在哪一屏 | 状态 | 根节点类名 | 什么时候出现 |');
    p('|---|---|---|---|');
    const vn = new Map((pg.views || []).map(v => [v.key, v.name]));
    for (const s of pg.states) p(`| ${cell(s.view ? (vn.get(s.view) || s.view) : '页面本身')} | ${cell(s.name)} | ${code('state-' + s.key)} | ${cell(s.when || (s.key === 'default' ? '正常情况' : '（说明里还没写）'))} |`);
    /* 视图的入口选择器要进交付物：前端和他的 AI 要知道「这个抽屉是点哪个元素出来的」，
       光给一个类名，他还得回页面里猜是哪个按钮 —— 猜错就开始编。 */
    if ((pg.views || []).length) {
      p('');
      p('**这一页里的抽屉 / 浮层**');
      p('');
      p('| 哪一屏 | 怎么打开 | 入口元素 |');
      p('|---|---|---|');
      for (const v of pg.views) p(`| ${cell(v.name)} | ${cell(v.how || '（说明里还没写）')} | ${v.sel ? code(v.sel) : '（没写）'} |`);
    }
    if ((pg.overlays || []).length) {
      p('');
      p('**叠加开关**（跟上面的状态正交，可以同时挂几个）');
      p('');
      p('| 开关 | 根节点类名 | 什么时候开 |');
      p('|---|---|---|');
      for (const o of pg.overlays) p(`| ${cell(o.name)} | ${code('on-' + o.key)} | ${cell(o.when || '（说明里还没写）')} |`);
    }
    p('');
    if (pg.fields.length) {
      p('**字段与校验**');
      p('');
      p('| 字段 | 规则 |');
      p('|---|---|');
      for (const f of pg.fields) {
        const r = (pg.spec.rules || []).find(x => x.sel.includes(f.name));
        p(`| ${code(f.tag + '[name=' + f.name + ']')} | ${cell(r ? r.text : '（说明里还没写）')} |`);
      }
      p('');
    }
    const extra = (pg.spec.rules || []).filter(r => !pg.fields.some(f => r.sel.includes(f.name)));
    if (extra.length) {
      p('**其它规则**');
      p('');
      p('| 挂在哪 | 规则 |');
      p('|---|---|');
      for (const r of extra) p(`| ${code(r.sel)} | ${cell(r.text)} |`);
      p('');
    }
    if (pg._prose && pg._prose.length) {
      p('**意图（设计的人写的）**');
      p('');
      for (const x of pg._prose) { p(`*${x.h}*`); p(''); p(x.body); p(''); }
    } else {
      p('> 这一页还没有人写的说明。前端只能照代码猜「为什么这么做」。');
      p('');
    }
  }

  /* ── 四、主线 ───────────────────── */
  if (d.scripts && d.scripts.length) {
    p('## 四、主线（按这个顺序走一遍就是完整流程）');
    p('');
    for (const sc of d.scripts) {
      p(`**${sc.name}**`);
      p('');
      p('| # | 页面 | 状态 | 这一步发生了什么 |');
      p('|---|---|---|---|');
      sc.steps.forEach((st, i) => p(`| ${i + 1} | ${code(st.rel)} | ${code('state-' + st.state)} | ${cell(st.note)} |`));
      p('');
    }
  }

  /* ── 五、还没做完的 ─────────────────
     🔴 这一节必须留在交付物里。把没做完的藏起来，前端会当成「设计就是这样」照着实现。 */
  const bad = d.issues.filter(i => i.level === 'bad'), warn = d.issues.filter(i => i.level === 'warn');
  p('## 五、交付时还没闭合的地方');
  p('');
  if (!d.issues.length) p('七道自动检查（断链 / 孤儿 / 死路 / 状态说了没做 / 状态做了没说 / 说明对不上页面 / 字段没规则）全过了。');
  else {
    p(`自动检查报了 ${bad.length} 条硬伤、${warn.length} 条要看一眼。**列在这里是故意的**——藏起来的话，前端会把没做完的当成设计本身照着实现。`);
    p('');
    p('| 严重度 | 页面 | 是什么 |');
    p('|---|---|---|');
    for (const i of [...bad, ...warn]) p(`| ${i.level === 'bad' ? '硬伤' : '看一眼'} | ${code(i.page)} | ${cell(i.text)} |`);
  }
  p('');
  return L.join('\n');
}

/* 给 handoff 用：读项目、扫、编译、写进交付副本 */
function writeInto(destDir, flowData, projectName) {
  const d = JSON.parse(JSON.stringify(flowData));
  /* 意图层从各页的 .说明.md 里搬 */
  for (const pg of d.pages) {
    pg._prose = [];
    const abs = path.join(destDir, pg.spec.rel);
    if (fs.existsSync(abs)) { try { pg._prose = proseOf(fs.readFileSync(abs, 'utf8')); } catch (e) {} }
  }
  const md = build(d, { projectName });
  fs.writeFileSync(path.join(destDir, '交互流程说明.md'), md);
  const clean = JSON.parse(JSON.stringify(flowData));
  fs.writeFileSync(path.join(destDir, 'flow.json'), JSON.stringify(clean, null, 2));
  return { md: '交互流程说明.md', json: 'flow.json', bytes: Buffer.byteLength(md) };
}

module.exports = { build, writeInto, proseOf };
