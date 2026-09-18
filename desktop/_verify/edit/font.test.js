'use strict';
/**
 * 第十套门 · 字体焊死 + 「该用现成的地方用了没有」
 *
 * 治的是 2026-09-17 吉吉报的两件事：
 *   ① 自己做的页面里英文数字比中文粗，1:1 还原线上的页面却没这问题
 *   ② 做新需求时还是会自己画组件
 *
 * 🔴 这套门的核心判据不是「HTML 里有没有那段字符串」，是**真渲染出来用的是哪张脸**。
 *    只验字符串会全绿而字还是粗的 —— 字符串在不在和浏览器挑哪张脸是两件事。
 *    所以后半段起真 Chrome，用 CDP 的 CSS.getPlatformFontsForNode 读实际落地的 PostScript 名。
 *    （上一轮就是栽在量错仪器上：查 computed style 得到 400，就判定「字重没设错」，
 *      而 computed 只说明你要了 400，不说明浏览器给了你 Black。）
 */
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..');
const PACK = path.join(ROOT, 'packs', 'feique');
const F = require(path.join(ROOT, 'main', 'feique-font.js'));
const { check } = require(path.join(ROOT, 'main', 'feique-check.js'));
const E = require(path.join(ROOT, 'main', 'feique-empty.js'));

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); } };
const ta = async (name, fn) => { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); } };

const page = (body, head = '') => `<!doctype html><html><head>${head}</head><body style="font-family:Roboto,-apple-system,'PingFang SC',sans-serif">${body}</body></html>`;

console.log('\n字体焊死 —— 注入器');
t('普通页面会注入', () => { const r = F.ensure(page('hi'), PACK); assert(r.changed); assert(r.html.includes(F.MARK)); });
t('注入的是两条 @font-face（400 / 700），不多不少', () => {
  const r = F.ensure(page('hi'), PACK);
  const n = (r.html.match(/@font-face/g) || []).length;
  assert.strictEqual(n, 2, '应该正好 2 条，实际 ' + n);
  assert(/font-weight:400/.test(r.html) && /font-weight:700/.test(r.html));
  assert(!/font-weight:(100|300|500|900)/.test(r.html), 'DESIGN.md §1 只有 400/700，多焊一档等于承认 500/600 合法');
});
t('幂等：第二次不重复注入', () => { const a = F.ensure(page('hi'), PACK); assert.strictEqual(F.ensure(a.html, PACK).changed, false); });
t('克隆页不注入 —— 判据①有 <base href="http', () => {
  assert.strictEqual(F.ensure(page('x', '<base href="https://membercenter.made-in-china.com/">'), PACK).changed, false);
});
t('克隆页不注入 —— 判据②已有 ≥4 条 Roboto 的 @font-face', () => {
  const ff = Array(4).fill(`@font-face{font-family:"Roboto";src:url(a.woff2)}`).join('');
  assert.strictEqual(F.ensure(page('x', `<style>${ff}</style>`), PACK).changed, false);
});
t('3 条 Roboto @font-face 还不算克隆页（界要宽，别把自己写了几条的页面漏掉）', () => {
  const ff = Array(3).fill(`@font-face{font-family:"Roboto";src:url(a.woff2)}`).join('');
  assert.strictEqual(F.ensure(page('x', `<style>${ff}</style>`), PACK).changed, true);
});
t('页面没用 Roboto 就不碰它', () => {
  assert.strictEqual(F.ensure('<html><head></head><body>纯中文文档</body></html>', PACK).changed, false);
});
t('插在 <head> 之后（要早于页面自己的样式，页面写了同名同档的就该它赢）', () => {
  const r = F.ensure(page('hi', '<style>body{color:red}</style>'), PACK);
  assert(r.html.indexOf(F.MARK) < r.html.indexOf('body{color:red}'), '注入的块必须在页面样式之前');
});
t('没有 <head> 时退到第一个 <style> 之前', () => {
  const r = F.ensure(`<html><style>body{font-family:Roboto}</style><body>x</body></html>`, PACK);
  assert(r.changed && r.html.indexOf(F.MARK) < r.html.indexOf('body{color') ? true : r.html.includes(F.MARK));
});
t('落盘版会写回文件，且第二次不再写', () => {
  const tmp = path.join(require('os').tmpdir(), 'uw-font-' + Date.now() + '.html');
  fs.writeFileSync(tmp, page('hi'));
  assert.strictEqual(F.ensureFile(tmp, PACK).changed, true);
  assert(fs.readFileSync(tmp, 'utf8').includes(F.MARK));
  assert.strictEqual(F.ensureFile(tmp, PACK).changed, false);
  fs.unlinkSync(tmp);
});
t('随包字体就是线上那两份（字节数对得上，换掉了要重导 coverage.json）', () => {
  assert.strictEqual(fs.statSync(path.join(PACK, 'fonts', 'roboto-400.woff2')).size, 19832);
  assert.strictEqual(fs.statSync(path.join(PACK, 'fonts', 'roboto-700.woff2')).size, 14552);
  const cov = JSON.parse(fs.readFileSync(path.join(PACK, 'fonts', 'coverage.json'), 'utf8'));
  assert(cov['400'] && cov['700'], 'coverage.json 要有 400 和 700 两档');
});

console.log('\n体检 —— 字体焊死那条');
t('没焊死判 bad', () => {
  const r = check(page('<button class="btn btn-md btn-primary">x</button>'), PACK);
  assert(r.issues.some(i => i.rule === 'font-pin' && i.level === 'bad'));
});
t('焊死了就不报', () => {
  const r = check(F.ensure(page('<button class="btn btn-md btn-primary">x</button>'), PACK).html, PACK);
  assert(!r.issues.some(i => i.rule === 'font-pin'));
});
t('页面自己写了 400 的 @font-face 也算焊死（不强迫走我们这套）', () => {
  const own = `<style>@font-face{font-family:'Roboto';font-weight:400;src:url(a.woff2)}</style>`;
  const r = check(page('<button class="btn">x</button>', own), PACK);
  assert(!r.issues.some(i => i.rule === 'font-pin'));
});

console.log('\n体检 —— 裸控件（该用现成的地方用了没有）');
t('<button> 没穿 .btn 判 bad，并报出几分之几', () => {
  const r = check(page('<button>a</button><button>b</button><button class="btn btn-md">c</button>'), PACK);
  const i = r.issues.find(x => x.rule === 'naked-ctrl');
  assert(i && i.level === 'bad', '应该判 bad');
  assert(/2\/3/.test(i.msg), '要写清 2/3，实际：' + i.msg);
});
t('全都穿了就不报', () => {
  const r = check(page('<button class="btn btn-md btn-primary">c</button>'), PACK);
  assert(!r.issues.some(x => x.rule === 'naked-ctrl'));
});
t('勾选框 / 单选 / 下拉 / 文本域各自认自己那块砖', () => {
  const r = check(page('<input type="checkbox"><input type="radio"><select></select><textarea></textarea>'), PACK);
  const m = (r.issues.find(x => x.rule === 'naked-ctrl') || {}).msg || '';
  for (const k of ['勾选框', '单选', '下拉', '文本域']) assert(m.includes(k), '漏了 ' + k + '：' + m);
});
t('穿了 .cb / .rd / .sel / .ta 就不报（数量对得上即可，不解析嵌套）', () => {
  const r = check(page('<label class="cb"><input type="checkbox"></label><label class="rd"><input type="radio"></label><div class="sel"><select></select></div><div class="ta"><textarea></textarea></div>'), PACK);
  assert(!r.issues.some(x => x.rule === 'naked-ctrl'), (r.issues.find(x => x.rule === 'naked-ctrl') || {}).msg);
});
t('按钮式单选 .ss 也算单选的砖', () => {
  const r = check(page('<label class="ss"><input type="radio"></label>'), PACK);
  assert(!r.issues.some(x => x.rule === 'naked-ctrl'));
});

console.log('\n体检 —— 手搓占比 / 克隆豁免 / 字符覆盖');
t('手搓占比是 info，不进「不合规」计数、也不判错', () => {
  const r = check(page('<div class="my-a"><div class="my-b">x</div></div>'), PACK);
  const i = r.issues.find(x => x.rule === 'handmade');
  assert(i && i.level === 'info', '必须是 info');
  assert.strictEqual(r.n, r.issues.length - r.infoN, 'n 不该把 info 算进去');
});
t('克隆页：值层 8 条全豁免，且豁免是声明出来的', () => {
  const clone = `<!doctype html><html><head><base href="https://x.made-in-china.com/">
    <style>.a{font-family:"Mic-icon";font-weight:500;color:#123456}</style></head>
    <body><button>裸的</button><input type="text"></body></html>`;
  const r = check(clone, PACK);
  for (const rule of ['font', 'weight', 'color', 'fake-class', 'override', 'naked-ctrl', 'handmade', 'glyph-range', 'font-pin'])
    assert(!r.issues.some(x => x.rule === rule), '克隆页不该报 ' + rule);
  assert(r.issues.some(x => x.rule === 'clone' && x.level === 'info'), '豁免必须声明式地摆出来');
});
t('克隆页的价格写法和手画品牌标照判（那两条跟还不还原无关）', () => {
  const clone = `<!doctype html><html><head><base href="https://x.made-in-china.com/"></head><body>US$ 15.20 (Min. Order)</body></html>`;
  assert(check(clone, PACK).issues.some(x => x.rule === 'price'));
});
t('字符超出随包字体覆盖 → warn（→ ≥ ▲ 这类换得掉的）', () => {
  const r = check(page('点这里 → 看详情，满 ≥ 100 件'), PACK);
  assert(r.issues.some(x => x.rule === 'glyph-range' && x.level === 'warn'));
});
t('别的文种不报（俄语是真实内容，报了也改不了＝纯噪音）', () => {
  const r = check(page('Русский язык 日本語 العربية'), PACK);
  const i = r.issues.find(x => x.rule === 'glyph-range');
  assert(!i, '不该报：' + (i || {}).msg);
});

/* ── 真渲染：门的核心。上面全是字符串断言，证明不了「字真的不粗了」 ── */
(async () => {
  console.log('\n真渲染 —— 实际落地用的是哪张脸（CDP CSS.getPlatformFontsForNode）');
  const CH = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
              '/Applications/Chromium.app/Contents/MacOS/Chromium'].find(p => fs.existsSync(p));
  const PUP = path.join(ROOT, 'restore-tools', 'online-reach', 'node_modules', 'puppeteer-core');
  if (!CH || !fs.existsSync(PUP)) {
    console.log('  ⊘ 跳过：本机没有 Chrome 或 puppeteer-core（真渲染那半在有 Chrome 的机器上才跑）');
  } else {
    const puppeteer = require(PUP);
    const br = await puppeteer.launch({ executablePath: CH, headless: 'new', args: ['--no-sandbox'] });
    const faces = async html => {
      const p = await br.newPage();
      await p.setContent(html, { waitUntil: 'load' });
      await p.evaluate(() => document.fonts.ready);
      const cdp = await p.target().createCDPSession();
      await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
      const { root } = await cdp.send('DOM.getDocument');
      const out = {};
      for (const id of ['w4', 'w7', 'c4']) {
        const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#' + id });
        if (!nodeId) continue;
        const r = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
        out[id] = r.fonts.map(f => f.postScriptName || f.familyName);
      }
      await p.close(); return out;
    };
    const body = `<div id="w4" style="font-family:Roboto,-apple-system,'PingFang SC',sans-serif;font-weight:400">Demo AI 32</div>`
               + `<div id="w7" style="font-family:Roboto,-apple-system,'PingFang SC',sans-serif;font-weight:700">Demo AI 32</div>`
               + `<div id="c4" style="font-family:Roboto,-apple-system,'PingFang SC',sans-serif;font-weight:400">控制台速递</div>`;
    const before = await faces(page(body));
    const after = await faces(F.ensure(page(body), PACK).html);

    await ta('焊死后 400 落到 Roboto-Regular（不焊死时本机落 Roboto-Black）', () => {
      assert(after.w4.includes('Roboto-Regular'), '实际：' + after.w4.join('+'));
    });
    await ta('焊死后 700 落到 Roboto-Bold', () => {
      assert(after.w7.includes('Roboto-Bold'), '实际：' + after.w7.join('+'));
    });
    await ta('中文照常回落 PingFang-Regular —— 没把中文也换掉（DESIGN.md §1 禁显式声明 PingFang）', () => {
      assert(after.c4.some(f => /PingFang/i.test(f)), '实际：' + after.c4.join('+'));
    });
    await ta('中西文同档：西文 Regular 配中文 Regular，不再差 5 档', () => {
      assert(after.w4.includes('Roboto-Regular') && after.c4.some(f => /PingFangSC-Regular/i.test(f)),
        '西文 ' + after.w4.join('+') + ' / 中文 ' + after.c4.join('+'));
    });
    await ta('这台机器不焊死确实会挑错脸（判据本身的标定：挑不错就说明这条门在这台机器上测不到东西）', () => {
      if (before.w4.includes('Roboto-Regular')) {
        console.log('      ⚠ 本机没装会引发问题的 Roboto，这条门在这里测不出差异（在装了 12 个静态 Roboto 的机器上才复现）');
      } else {
        assert(before.w4.some(f => /Roboto-(Black|Bold|Medium)/.test(f)), '不焊死时实际：' + before.w4.join('+'));
      }
    });
    await br.close();
  }
console.log('\n缺省图 —— 包里的图 + 注入器');
t('31 张都在包里（Figma 那个组件 variantCount 就是 31）', () => {
  const l = E.list(PACK);
  assert.strictEqual(l.length, 31, '只有 ' + l.length + ' 张');
});
t('买家侧 / 供应商侧六对齐全，一边都不缺', () => {
  const l = new Set(E.list(PACK));
  for (const n of ['start-download', 'start-done', 'link-account', 'app-download', 'no-message', 'no-order'])
    for (const side of ['buyer', 'supplier'])
      assert.ok(l.has(n + '-' + side), '缺 ' + n + '-' + side);
});
t('单张都在 8KB 以内（要内嵌进单文件页面，大了就不能用）', () => {
  for (const n of E.list(PACK)) {
    const sz = fs.statSync(path.join(PACK, 'sprites', n + '.webp')).size;
    assert.ok(sz < 8 * 1024, n + ' 有 ' + Math.round(sz / 1024) + 'KB');
  }
});
t('模型只写名字，src 自动填进去', () => {
  const r = E.ensure('<div class="empty-img"><img data-feique-empty="no-product-result" alt=""></div>', PACK);
  assert.ok(r.changed);
  assert.ok(/src="data:image\/webp;base64,/.test(r.html), r.html.slice(0, 120));
  assert.deepStrictEqual(r.filled, ['no-product-result']);
});
t('幂等：第二次不再动它', () => {
  const a = E.ensure('<img data-feique-empty="empty-box">', PACK);
  const b = E.ensure(a.html, PACK);
  assert.strictEqual(b.changed, false);
});
t('已经自己放了 src 的不碰（别覆盖别人的意图）', () => {
  const r = E.ensure('<img data-feique-empty="empty-box" src="my.png">', PACK);
  assert.strictEqual(r.changed, false);
});
t('名字对不上时报出来，不静悄悄留个没有 src 的 img', () => {
  const r = E.ensure('<img data-feique-empty="没这张">', PACK);
  assert.deepStrictEqual(r.missing, ['没这张']);
  assert.strictEqual(r.changed, false);
});
t('没写 alt 的补一个空 alt（装饰性插图，读屏该跳过）', () => {
  const r = E.ensure('<img data-feique-empty="empty-box">', PACK);
  assert.ok(/alt=""/.test(r.html), r.html.slice(-80));
});
t('别的 <img> 一个都不许动（这个口子要窄）', () => {
  const src = '<img src="a.png"><img data-other="x">';
  assert.strictEqual(E.ensure(src, PACK).html, src);
});

console.log('\n缺省图底色 / 滚动条 / 金额字段 —— 2026-09-18 吉吉指出的三处遗漏（每条先红后绿）');
t('🔴 缺省图的插图位加了底色 = 硬伤（飞鹊缺省图是透明的，垫灰就露出个方块）', () => {
  const bad = check(page('<div class="empty"><div class="empty-img"><img data-feique-empty="empty-box" alt=""></div></div>',
    '<style>.empty-img{width:296px;height:280px;background:#F5F7FA;border-radius:8px}</style>'), PACK);
  assert.ok(bad.issues.find(x => x.rule === 'empty-img-bg'), '有底色却没报');
  const ok = check(page('<div class="empty"><div class="empty-img"><img data-feique-empty="empty-box" alt=""></div></div>',
    '<style>.empty-img{width:296px;height:280px}</style>'), PACK);
  assert.ok(!ok.issues.find(x => x.rule === 'empty-img-bg'), '去掉底色还在报（负向标定）');
});
t('自己放插图当背景图的不误伤（那是有人在用自己的图，不是占位块）', () => {
  const r = check(page('<div class="empty"><div class="empty-img"></div></div>',
    '<style>.empty-img{background:url(x.png) center/contain no-repeat}</style>'), PACK);
  assert.ok(!r.issues.find(x => x.rule === 'empty-img-bg'), JSON.stringify(r.issues.map(x => x.rule)));
});
t('🔴 会滚的容器没挂飞鹊滚动条 = 提醒；挂上就不报（负向标定）', () => {
  const css = '<style>.dw-body{overflow-y:auto}.use-scr::-webkit-scrollbar{width:6px}</style>';
  const bad = check(page('<div class="dw-body">内容</div>', css), PACK);
  assert.ok(bad.issues.find(x => x.rule === 'scrollbar'), '没挂 use-scr 却没报');
  const ok = check(page('<div class="dw-body use-scr">内容</div>', css), PACK);
  assert.ok(!ok.issues.find(x => x.rule === 'scrollbar'), '挂了还在报（负向标定）');
});
t('🔴 判据落在「这个容器会不会真拿到飞鹊滚动条」，不是「这一页上过滚动条样式没有」', () => {
  /* 实测栽过：scr.css 整段内联进来了，但没有任何元素挂 use-scr —— 样式在、没人用，
     屏幕上还是系统滚动条。按「页面上过样式没有」判会全绿。 */
  const r = check(page('<div class="dw-body">内容</div>',
    '<style>.dw-body{overflow-y:auto}.use-scr::-webkit-scrollbar{width:6px}.use-scr::-webkit-scrollbar-thumb{background:#888}</style>'), PACK);
  assert.ok(r.issues.find(x => x.rule === 'scrollbar'), '样式内联了没人挂类，门应该还是要报');
});
t('类定义了但页面上没用到的，不判（不是问题，只是死 CSS）', () => {
  const r = check(page('<p>没有滚动容器</p>', '<style>.somebox{overflow-y:auto}</style>'), PACK);
  assert.ok(!r.issues.find(x => x.rule === 'scrollbar'), JSON.stringify(r.issues.map(x => x.rule)));
});
t('🔴 带单位后缀的金额字段不该被要求换成步进器（门判错方向时改门，别照着门把对的改坏）', () => {
  const money = '<div class="inp"><div class="inp-body"><input type="number" id="b" placeholder="自定义金额"></div><span class="inp-tab inp-tab-post">元</span></div>';
  const ok = check(page(money), PACK);
  const hit = ok.issues.find(x => x.rule === 'naked-ctrl');
  assert.ok(!hit || !/数字输入框/.test(hit.msg), '已经穿着 .inp 的金额字段被当成裸奔：' + (hit && hit.msg));
  const bare = check(page('<input type="number" id="c">'), PACK);
  const h2 = bare.issues.find(x => x.rule === 'naked-ctrl');
  assert.ok(h2 && /数字输入框/.test(h2.msg), '真裸奔的 number 反而没报（负向标定）');
});

console.log('\n缺省图 —— 体检两条规则（每条先红后绿）');
const empt = (inner, extra = '') => page(`<div class="empty"><div class="empty-img">${inner}</div><div class="empty-title">当前没有投放中的计划</div></div>${extra}`, '<style>.empty{}</style>');
t('插图位空着 = 硬伤（就是吉吉截图里那个灰方块）', () => {
  const r = check(empt(''), PACK);
  const i = r.issues.find(x => x.rule === 'empty-img');
  assert.ok(i && i.level === 'bad', JSON.stringify(r.issues.map(x => x.rule)));
});
t('写了 data-feique-empty 就不报了（负向标定）', () => {
  const r = check(empt('<img data-feique-empty="no-order-supplier" alt="">'), PACK);
  assert.ok(!r.issues.some(x => x.rule === 'empty-img'), '改对了还报');
});
t('自己放了真图也不报（别逼人只能用我们这套）', () => {
  const r = check(empt('<img src="x.png">'), PACK);
  assert.ok(!r.issues.some(x => x.rule === 'empty-img'));
});
t('连 .empty 都没用、但有空态文案 = 提醒', () => {
  const r = check(page('<div class="box"><p>暂无数据</p></div>', '<style>.box{}</style>'), PACK);
  const i = r.issues.find(x => x.rule === 'empty-handmade');
  assert.ok(i && i.level === 'warn', JSON.stringify(r.issues.map(x => x.rule)));
});
t('用了 .empty 就不报手搓那条（负向标定）', () => {
  const r = check(empt('<img data-feique-empty="empty-box" alt="">'), PACK);
  assert.ok(!r.issues.some(x => x.rule === 'empty-handmade'));
});
t('🔴 没有空态文案的普通页面不许被这条误伤（判据要窄）', () => {
  const r = check(page('<div class="card"><p>产品列表</p></div>', '<style>.card{}</style>'), PACK);
  assert.ok(!r.issues.some(x => x.rule === 'empty-handmade'), '把正常页面判成空态了');
});
t('克隆线上的页面两条都豁免（那是别人的页，不归我们管）', () => {
  const clone = '<!doctype html><html><head><base href="https://made-in-china.com/"><style>.empty{}</style></head><body><div class="empty"><div class="empty-img"></div></div><p>暂无数据</p></body></html>';
  const r = check(clone, PACK);
  assert.ok(!r.issues.some(x => /^empty/.test(x.rule)), JSON.stringify(r.issues.map(x => x.rule)));
});

  console.log(`\n字体门：${pass} 过 / ${fail} 红`);
  process.exit(fail ? 1 : 0);
})();
