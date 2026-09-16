#!/usr/bin/env node
// verify-block.js —— 组件片段「逐坐标对数」门
//
// 为什么在仓库里而不是临时目录：2026-09-15 那批产品卡的验证器写在会话 scratchpad 里，
// 会话一结束就没了 —— 七张卡从此无法复验。写在这儿是为了「下次还能跑」。
//
// 用法：
//   node build/verify-block.js --block packs/feique/docs/blocks/x.html --truth build/blocks-truth/x.json
//   node build/verify-block.js --block … --truth … --only 1440      只跑某一档宽度
//   node build/verify-block.js --block … --truth … --shot /tmp/x.png 顺便截图
//
// truth JSON 格式（值都来自 Figma 组件的真值，不是人估的）：
//   { "name": "...", "node": "6180:1342",
//     "widths": {
//       "1440": { "_rootH": 205, "6180:1345": {"h":46}, "6180:1347": {"w":71,"x":197} , ... },
//       "1024": { "_rootH": 241, ... } } }
//   每个键是 data-node-id，值里写哪项就查哪项（x/y/w/h/fs/fw/color/bg）。
//   🔴 随文案长度变的宽度要么不写、要么写 null —— 校验的是布局约束，不是内容量。
//
// 退出码：0 全绿；1 有不符；2 跑不起来。

const path = require('path');
const fs = require('fs');
const puppeteer = require(path.join(__dirname, '..', 'restore-tools', 'online-reach', 'node_modules', 'puppeteer-core'));

function arg(n, d){ const i = process.argv.indexOf('--'+n); if (i<0) return d; const v = process.argv[i+1]; return (v && !v.startsWith('--')) ? v : true; }

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// 两档容差，理由不同，别合并成一个数：
// · y / h ＝ 行高与内边距算出来的，两边都是整数运算 → 1.2px 只放过亚像素舍入。
// · x / w ＝ 吃文字宽度。Figma 有自己的排版引擎，跟浏览器对同一串字算出的宽度本就差约 1%
//   （实测「Focus Technology Co., Ltd.」12px Roboto：Figma 144 / Chrome 145.9）。
//   居中容器的 x 会把这个差累加进来，所以放到 2.5px。**这不是给还原错误开的口子** ——
//   真排错了差的是几十上百 px，不是 2px。
const TOL = 1.2;
const TOL_X = 2.5;
const MEASURABLE = new Set(['x','y','w','h','fs','fw','color','bg']);

(async () => {
  const blockPath = path.resolve(arg('block'));
  const truthPath = path.resolve(arg('truth'));
  if (!fs.existsSync(blockPath)) { console.error('片段不存在：'+blockPath); process.exit(2); }
  if (!fs.existsSync(truthPath)) { console.error('真值表不存在：'+truthPath); process.exit(2); }
  if (!fs.existsSync(CHROME)) {
    console.error('Chrome 不在 '+CHROME+'。装了别处就设 CHROME_PATH 环境变量再跑。');
    process.exit(2);
  }
  const frag  = fs.readFileSync(blockPath, 'utf8');
  const truth = JSON.parse(fs.readFileSync(truthPath, 'utf8'));
  const only  = arg('only', null);

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--font-render-hinting=none'] });
  const page = await browser.newPage();

  let fails = 0, checks = 0;
  const widths = Object.keys(truth.widths).filter(w => !only || String(w) === String(only));

  for (const w of widths) {
    const spec = truth.widths[w];
    const html = '<!doctype html><html><head><meta charset="utf-8">'
      + '<style>html,body{margin:0;padding:0;background:#fff}#vp{width:'+w+'px}</style>'
      + '</head><body><div id="vp">' + frag + '</div></body></html>';
    await page.setViewport({ width: Number(w) + 40, height: 1200, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.evaluate(async () => { if (document.fonts) await document.fonts.ready; });

    const measured = await page.evaluate(() => {
      const out = {};
      const vp = document.getElementById('vp').getBoundingClientRect();
      document.querySelectorAll('[data-node-id]').forEach(el => {
        const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
        const id = el.getAttribute('data-node-id');
        if (out[id]) return;          // 同 id 只取第一个
        out[id] = { x: r.x - vp.x, y: r.y - vp.y, w: r.width, h: r.height,
                    fs: parseFloat(cs.fontSize), fw: cs.fontWeight,
                    color: cs.color, bg: cs.backgroundColor };
      });
      const root = document.querySelector('#vp > *:not(style):not(script):not(link)');
      out._rootH = root ? root.getBoundingClientRect().height : null;
      out._rootW = root ? root.getBoundingClientRect().width : null;
      return out;
    });

    console.log('\n━━ 宽度 ' + w + 'px ━━');
    for (const [id, want] of Object.entries(spec)) {
      if (id === '_rootH' || id === '_rootW') {
        checks++;
        const got = measured[id];
        const ok = got != null && Math.abs(got - want) <= (id==='_rootW' ? TOL_X : TOL);
        if (!ok) fails++;
        console.log((ok?'  ✅':'  ❌') + ' ' + id + '  期望 ' + want + '  实测 ' + (got==null?'—':got.toFixed(1)));
        continue;
      }
      const got = measured[id];
      if (!got) { fails++; checks++; console.log('  ❌ ' + id + '  DOM 里没有这个 data-node-id'); continue; }
      for (const [k, v] of Object.entries(want)) {
        if (v === null || v === undefined) continue;
        // 白名单：只有这几个键是「要量的」，其余（xtol / why / why_fix / 任何备注）一律当注释。
        // 用白名单不用黑名单 —— 往真值表里加一句说明，不该把门弄红。
        if (!MEASURABLE.has(k)) continue;
        checks++;
        let ok, shown;
        if (k === 'fs' || k === 'fw') { ok = String(got[k]) === String(v) || Math.abs(parseFloat(got[k]) - parseFloat(v)) < 0.5; shown = got[k]; }
        else if (k === 'color' || k === 'bg') { ok = String(got[k]).replace(/\s/g,'') === String(v).replace(/\s/g,''); shown = got[k]; }
        else {
          // 逐项容差覆盖：只在真值表里写了 xtol 时生效，而且必须同时写 why 说明为什么放宽。
          // 这样每一次「放宽」都留在文件里看得见，不会变成偷偷调松全局阈值。
          let t = (k==='x'||k==='w') ? TOL_X : TOL;
          if (want.xtol != null && (k==='x'||k==='w')) t = want.xtol;
          ok = Math.abs(got[k] - v) <= t;
          shown = (got[k] == null ? '—' : got[k].toFixed(1)) + (want.xtol!=null && (k==='x'||k==='w') ? '  〔容差放宽到 '+t+'：'+(want.why||'未写理由')+'〕' : '');
        }
        if (!ok) fails++;
        console.log((ok?'  ✅':'  ❌') + ' ' + id + ' · ' + k + '  期望 ' + v + '  实测 ' + shown);
      }
    }
    const shot = arg('shot', null);
    if (shot) { await page.screenshot({ path: shot.replace(/\.png$/, '') + '-' + w + '.png', fullPage: true }); }
  }

  await browser.close();
  console.log('\n' + (fails ? '❌ ' + fails + ' / ' + checks + ' 项不符' : '✅ 全绿 ' + checks + ' / ' + checks + ' 项')
              + '  —— ' + (truth.name || path.basename(blockPath)));
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('跑不起来：' + e.message); process.exit(2); });
