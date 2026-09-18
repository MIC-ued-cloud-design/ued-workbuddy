/**
 * 向导层视觉探针 —— 在真浏览器里量计算值。
 *
 * 为什么要它：吉吉三轮走查（「很多 UI 有点太淡了」/「这边错位了」/
 * 「这几个圆角度数都没统一」）全是他肉眼发现、我没发现。而这三类都是可量的：
 *   · 太淡  → 算对比度
 *   · 错位  → 量几何 + 查 class 撞名的后果
 *   · 不统一 → 收集所有值看有几个
 *
 * 🔴 构建期的门查不了这些：
 *   圆角门只看 CSS 字面量，`.wz-peek` 写 var(--box-r) 完全合法，
 *   但它挂在 <body> 下拿不到 .wizmask 的变量 → 实测失效成 0px。
 *   CSS 静态分析推不出 DOM 归属，只有浏览器知道。
 *
 * 跑法：node _verify/wizard.js [out目录]
 */
/* 跟 wb-check.js 同一条路：借 mic-fullstack 那份 puppeteer-core，本目录不装依赖 */
const puppeteer = require('/Users/wanglixiang/.claude/skills/mic-fullstack/scripts/online-reach/node_modules/puppeteer-core');
const path = require('path');
const fs = require('fs');

const FILE = 'file://' + path.resolve(__dirname, '..', 'index.html')   /* 2026-09-09 向导已并入线上那份，wizard.html 已删 */;
const OUT = process.argv[2] ? path.resolve(process.argv[2]) : null;
/* 🔴 原来这里写死 pick(0) —— 探针只覆盖过「交互稿」那一张卡。
   2026-09-08 加了视觉稿 / 设计策略与提案之后，视觉量值要能逐张跑：
     WZ_CARD=1 node _verify/wizard.js   （0 交互稿 · 1 视觉稿 · 2 设计策略与提案） */
const CARD = +(process.env.WZ_CARD || 0);
if (OUT && !fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

/* 全站主题真值 —— 2026-09-09 起向导层不再单独用飞鹊那套，跟 index.html :root 一致（apple.com 实测值）。
   这里写死一份是有意的：探针要对着「应该是什么」量，不能反过来从页面读 */
const FQ = {
  ctl: '#86868B',      // 能点的描边：输入框 / 勾选框（3.5:1）
  line: '#D2D2D7',     // 卡片描边（选项卡片）
  soft: '#F5F5F7',     // 次级按钮底 / 主区底
  white: '#FFFFFF',
  accent: '#0071E3',
  ink: ['#1D1D1F', '#6E6E73', '#86868B', '#AEAEB2'],
  radius: ['4px', '8px', '12px', '18px', '999px', '50%', '0px'],   // --r-xs / --ctl-r / --box-r / --r-lg / 胶囊 / 整圆
};

const lum = h => {
  const v = [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return +((x + 0.05) / (y + 0.05)).toFixed(2);
};

let bad = 0;
const fail = m => { console.log('  ❌ ' + m); bad++; };
const ok = m => console.log('  ✅ ' + m);

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'],
    defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  console.log('■ 量的是design/' + CARD + ' 这张卡');

  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  await page.goto(FILE, { waitUntil: 'load' });

  /* 开向导，等 auto 真检索跑完（kb.js 7.6MB 本地读盘，给足时间） */
  await page.evaluate(() => { setScene('design'); });
  await page.evaluate(ci => { pick(ci); }, CARD);
  /* 🔴 `let W` 顶层声明不挂 window —— 写 window.W 永远 undefined，等到超时 */
  await page.waitForFunction(() => typeof W !== 'undefined' && W.state === 'done', { timeout: 90000 })
    .catch(() => console.log('  ⚠️  auto检索90秒没跑完，后面的量值仍然有效'));
  await page.evaluate(() => {
    document.querySelectorAll('#wzMain .wz-opt').forEach((o, i) => { if (i < 2) o.click(); });
  });
  /* 让浮层出现，才量得到它 —— 它挂在 body 下，是圆角门的盲区所在 */
  await page.evaluate(() => { const a = document.querySelector('a.wz-doc'); if (a) a.click(); });
  await new Promise(r => setTimeout(r, 400));

  const data = await page.evaluate(() => {
    const hex = c => {
      const m = c.match(/[\d.]+/g);
      if (!m) return c;
      if (m.length > 3 && +m[3] === 0) return 'transparent';
      return '#' + m.slice(0, 3).map(x => (+x).toString(16).padStart(2, '0')).join('').toUpperCase();
    };
    const g = sel => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el), r = el.getBoundingClientRect();
      return {
        radius: cs.borderRadius, border: hex(cs.borderTopColor), color: hex(cs.color),
        bg: hex(cs.backgroundColor), shadow: cs.boxShadow === 'none' ? 'none' : '有',
        w: Math.round(r.width), h: Math.round(r.height), fw: cs.fontWeight,
      };
    };
    const S = {
      /* 🔴 一律取「未选中 / 未激活」态 —— 探针前面点过选项，取默认选择器会拿到
         选中态的 accent 蓝，然后误报「没对齐飞鹊真值」。第一版就栽在这。 */
      '模态': '.wiz', '步骤条项': '.wz-rail .wzs:not(.wzon)',
      '步骤序号圈': '.wz-rail .wzs:not(.wzon) .i',
      '绿条': '.wz-auto', '文档chip': 'a.wz-doc', '问题区': '.wz-q',
      '选项卡片': '.wz-opt:not(.wzon)', '选项选中': '.wz-opt.wzon',
      '勾选框': '.wz-opt:not(.wzon) .bx',
      '输入框': '.wz-item input[type=text]', '按钮次级': '.wz-btn:not(.wzpri)',
      '按钮主级': '.wz-btn.wzpri', '头部标签': '.wz-tag',
      '关闭键': '.wz-x', '浮层': '.wz-peek', '题号': '.wz-lbl .no', '提示语': '.wz-qh',
      '任务单待定圈': '.rc-item.off .mk', '任务单能力名': '.rc-kit li .sn',
      '任务单能力说明': '.rc-kit li .wzsw',
    };
    const out = {};
    for (const k in S) out[k] = g(S[k]);
    /* 勾是不是飞鹊 yes2.svg 的那一笔 */
    const ck = document.querySelector('.wz-opt.wzon .bx .wz-ck path');
    out._勾path = ck ? ck.getAttribute('d').slice(0, 24) : null;
    out._勾处数 = document.querySelectorAll('.wz-ck').length;
    out._浮层可见 = document.querySelector('.wz-peek').classList.contains('wzon');
    return out;
  });

  /* ── 输入框专项：先查清「单行输入框在第几步」，再切过去量 ────────────
     🔴 design/2 的第 1 步是文本域 + 多选，单行输入框在第 2 步。第一版在第 1 步
     硬量，拿到 null → 一边误报「输入框描边不对」，一边在 focus 那节对 null
     调 .focus()，把探针自己搞崩了（后面几节根本没跑）。
     判据跟单选圆点那条一样：量不到先分清是「页面没有」还是「我没走到那一步」。 */
  const inpStep = await page.evaluate(() => {
    const st = wzDef().steps;
    for (let i = 0; i < st.length; i++) if (st[i].qs.some(q => q.type === 'text')) return i;
    return -1;
  });
  let INP = null;
  if (inpStep >= 0) {
    const moved = await page.evaluate(i => {
      if (W.step === i) return false;
      W.step = i; wzDraw(); return true;
    }, inpStep);
    if (moved) await new Promise(r => setTimeout(r, 250));
    INP = await page.evaluate(async () => {
      const hex = c => {
        const m = c.match(/[\d.]+/g);
        if (!m) return c;
        if (m.length > 3 && +m[3] === 0) return 'transparent';
        return '#' + m.slice(0, 3).map(x => (+x).toString(16).padStart(2, '0')).join('').toUpperCase();
      };
      const inp = document.querySelector('.wz-item input[type=text]');
      if (!inp) return null;
      const c0 = getComputedStyle(inp);
      const out = { step: W.step, radius: c0.borderRadius, border: hex(c0.borderTopColor) };
      inp.focus();                       /* focus 会改描边色，所以先取静止态 */
      /* 🔴 描边和光环带 .12s transition：focus 之后立刻读计算值拿到的还是旧值（这一条
         2026-09-09 第一次跑就红了两项，页面其实是对的）。等过渡走完再读。 */
      await new Promise(r => setTimeout(r, 300));
      const c1 = getComputedStyle(inp);
      out.shadow = c1.boxShadow; out.bg = c1.backgroundImage; out.fborder = hex(c1.borderTopColor);
      return out;
    });
    /* 量完切回第 1 步 —— 否则末尾那张截图名叫 step1、拍的却是别的一步 */
    if (moved) { await page.evaluate(() => { document.activeElement.blur(); W.step = 0; wzDraw(); }); await new Promise(r => setTimeout(r, 250)); }
  }
  /* 补进 data，下面几节照旧按 data['输入框'] 用 */
  if (INP && !data['输入框']) data['输入框'] = { radius: INP.radius, border: INP.border, color: null, bg: null, shadow: null, w: 0, h: 0, fw: null };
  if (INP) console.log('\n（单行输入框在第 ' + (INP.step + 1) + ' 步，已切过去量再切回）');

  console.log('\n══ 1. 圆角统一 ══');
  const radii = {};
  /* 纯文本 span（题号/提示语/任务单条目）本来就没圆角，0px 混进来是噪音 */
  const TEXT_ONLY = ['题号', '提示语', '任务单待定圈', '任务单能力名', '任务单能力说明'];
  for (const k in data) {
    if (k.startsWith('_') || !data[k] || TEXT_ONLY.includes(k)) continue;
    (radii[data[k].radius] = radii[data[k].radius] || []).push(k);
  }
  const vals = Object.keys(radii);
  vals.forEach(v => console.log(`  ${v.padEnd(8)} ← ${radii[v].join('、')}`));
  const strays = vals.filter(v => !FQ.radius.includes(v));
  if (strays.length) fail(`这些值不是全站 token（4/8/12/18/胶囊/整圆）：${strays.join(' ')} —— 分别用在 ${strays.map(v => radii[v].join('、')).join(' ｜ ')}`);
  else ok(`${vals.length}个值全部是全站token`);
  /* 浮层专项：它挂在 body 下，是变量作用域的盲区 */
  if (data['浮层'] && data['浮层'].radius === '0px')
    fail('浮层圆角0px —— 十成是var() 拿不到（它挂在 <body> 下，不是 .wizmask的后代）');

  console.log('\n══ 2. 对比度（"太淡"是可量的）══');
  const CHECKS = [
    /* 能点的描边（输入框 / 勾选框）用 #86868B，够到 WCAG 3:1；
       选项卡片是卡片不是控件，描边 #D2D2D7 只要看得见（1.4）。 */
    ['输入框描边', data['输入框'] && data['输入框'].border, 3, '能点的要够3:1'],
    ['勾选框描边', data['勾选框'] && data['勾选框'].border, 3, '能点的要够3:1'],
    ['主按钮底色', data['按钮主级'] && data['按钮主级'].bg, 4.5, '主操作必须够重'],
    ['题号', data['题号'] && data['题号'].color, 4.5, ''],
    ['提示语', data['提示语'] && data['提示语'].color, 4.5, '次级文字 #6E6E73'],
  ];
  for (const [name, val, min, why] of CHECKS) {
    if (!val || val === 'transparent') { console.log(`  ⏭  ${name} = ${val}（跳过）`); continue; }
    const r = ratio(val, '#FFFFFF');
    const line = `${name.padEnd(12)} ${val}  vs 白底 ${String(r).padStart(5)}:1  (下限 ${min})${why ? ' · ' + why : ''}`;
    r >= min ? ok(line) : fail(line);
  }

  console.log('\n══ 3. 全站token对齐（向导层不许自己定色）══');
  const want = [
    ['输入框描边', data['输入框'] && data['输入框'].border, FQ.ctl],
    ['选项卡片底色', data['选项卡片'] && data['选项卡片'].bg, FQ.soft],
    ['勾选框描边', data['勾选框'] && data['勾选框'].border, FQ.ctl],
    ['次级按钮底色', data['按钮次级'] && data['按钮次级'].bg, FQ.white],   /* 2026-09-10 页脚改成磨砂底，次级按钮换白色浮起 */
    ['主按钮底色', data['按钮主级'] && data['按钮主级'].bg, FQ.accent],
    ['步骤条底色', data['步骤条项'] && data['步骤条项'].bg, FQ.white],
    ['题号', data['题号'] && data['题号'].color, FQ.ink[0]],
    ['提示语', data['提示语'] && data['提示语'].color, FQ.ink[1]],
    ['任务单待定圈', data['任务单待定圈'] && data['任务单待定圈'].color, FQ.ink[2]],
  ];
  for (const [name, got, exp] of want)
    got === exp ? ok(`${name.padEnd(12)} ${got}`)
                : fail(`${name.padEnd(12)}实测${got}，token值${exp}`);

  console.log('\n══ 4. 勾用的是飞鹊图标吗 ══');
  /* 飞鹊 yes2.svg（纯勾）；yes / yes-f 都带圆圈，别拿错 */
  if (data._勾path && data._勾path.startsWith('M1.98836 6.94178'))
    ok(`勾是飞鹊yes2.svg（${data._勾处数}处在用）`);
  else fail(`勾不是飞鹊yes2.svg，实测path开头：${data._勾path}`);

  console.log('\n══ 5. focus态：主色描边 + 3px光环（全站输入框统一这一种）══');
  if (!INP) console.log('  ⏭  这张卡没有单行输入框（已查WIZ定义确认），跳过');
  else {
    INP.fborder === FQ.accent ? ok('描边变主色 ' + INP.fborder) : fail('focus描边不是主色：' + INP.fborder);
    /* 吉吉 2026-09-10：聚焦只换颜色、不要投影/光环 */
    (INP.shadow === 'none') ? ok('无光环无投影') : fail('聚焦还带光环/投影：' + INP.shadow.slice(0, 60));
    /gradient/.test(INP.bg) ? fail('还残留着渐变描边（2026-09-09已撤）') : ok('无渐变残留');
  }

  console.log('\n══ 6. class撞名的后果（能力说明有没有被压窄）══');
  const sw = data['任务单能力说明'];
  if (!sw) fail('量不到任务单能力说明');
  else if (sw.w < 120) fail(`能力说明只有${sw.w}px宽 —— 十成是class撞了WorkBuddy的 .sw开关（38×22）`);
  else ok(`能力说明${sw.w}×${sw.h}，没被压窄`);

  console.log('\n══ 7. 关闭键hover：高亮但不要底色 ══');
  /* 吉吉 2026-09-08 提的。加成机器判据，免得下次改样式又把底色带回来。 */
  const x = await page.evaluate(async () => {
    const hex = c => {
      const m = c.match(/[\d.]+/g);
      if (!m) return c;
      if (m.length > 3 && +m[3] === 0) return 'transparent';
      return '#' + m.slice(0, 3).map(v => (+v).toString(16).padStart(2, '0')).join('').toUpperCase();
    };
    const el = document.querySelector('.wz-x');
    const rest = { bg: hex(getComputedStyle(el).backgroundColor), color: hex(getComputedStyle(el).color) };
    /* :hover 没法用 JS 触发，直接读样式表里那条规则 —— 查的是规则本身，不是某一帧的计算值 */
    let rule = null;
    for (const sh of document.styleSheets) {
      let rs; try { rs = sh.cssRules; } catch (e) { continue; }
      for (const r of rs) if (r.selectorText === '.wz-x:hover') rule = r.style.cssText;
    }
    return { rest, rule };
  });
  if (!x.rule) fail('找不到 .wz-x:hover规则');
  else {
    /(^|;|\s)background/.test(x.rule) ? fail('hover还带底色：' + x.rule) : ok('hover无底色');
    /color/.test(x.rule) ? ok('hover有高亮：' + x.rule.trim()) : fail('hover没有任何高亮');
  }
  console.log('     静止态 图标 ' + x.rest.color + ' · 底色 ' + x.rest.bg);

  console.log('\n══ 8. JS错误 ══');
  errs.length ? errs.forEach(e => fail(e)) : ok('0个');

  if (OUT) {
    const shot = path.join(OUT, 'wizard-card' + CARD + '-step1.png');
    await page.screenshot({ path: shot });
    console.log('\n截图 → ' + shot);
  }

  console.log('\n' + (bad ? `══ ${bad}项没过 ══` : '══ 全部通过 ══'));
  await browser.close();
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('探针本身挂了：', e); process.exit(2); });
