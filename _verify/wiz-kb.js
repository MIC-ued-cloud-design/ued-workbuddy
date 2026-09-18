/**
 * 向导 18 张卡的检索词体检 —— 每张卡的 3 条 `auto` 查询必须真命中。
 *
 * 为什么要单独一道门：向导第 1 步顶上那条绿条写着「以下资料已完成知识库检索」。
 * 检索词写歪了它不会静默 —— 会明说「无匹配」，那比不检索更难看：
 * 同事第一眼看到的就是一条「查了但什么也没查到」。
 * 而检索词好不好，只有真跑一遍才知道，看着像的词经常一段都不命中。
 *
 * 顺带守两件：
 *   · 命中的文档跟这张卡该用的知识对不对得上（只看段数不看文档名 = 只知道「有东西」，
 *     不知道「是对的东西」。第六轮栽过：261 个 TEXT 被答成 261 个组件，还带出处标注）
 *   · 每张卡的 out / skills / steps 结构完整（漏一项页面上就少一块，肉眼未必看出来）
 *
 * 跑法：node _verify/wiz-kb.js          全部
 *       node _verify/wiz-kb.js research 只跑某个场景
 */
const puppeteer = require('/Users/wanglixiang/.claude/skills/mic-fullstack/scripts/online-reach/node_modules/puppeteer-core');
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const ONLY = process.argv[2] || '';
const PORT = 17391;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json' };

let pass = 0, fail = 0, warn = 0;
const ok = (n, c, extra) => { (c ? pass++ : fail++); console.log((c ? '  ✅ ' : '  ❌ ') + n + (extra ? '  ' + extra : '')); };

const site = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('no'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(res);
});

(async () => {
  await new Promise(r => site.listen(PORT, '127.0.0.1', r));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const p = await browser.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e.message || e)));
  await p.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'networkidle2', timeout: 60000 });

  /* 知识库 7.6MB，页面只在用到时才加载 —— 这里主动拉一次 */
  console.log('正在加载知识库（7.6MB，约10秒）…');
  const kb = await p.evaluate(async () => {
    const one = src => new Promise((ok2, no) => {
      const s = document.createElement('script'); s.src = src;
      s.onload = ok2; s.onerror = () => no(new Error('找不到 ' + src));
      document.head.appendChild(s);
    });
    try {
      if (!(window.WBKB && window.WBSearch)) { await one('kb-search.js'); await one('kb.js'); }
      return { ok: !!(window.WBKB && window.WBSearch),
               docs: (window.WBKB && window.WBKB.docs && window.WBKB.docs.length) || 0,
               segs: (window.WBKB && window.WBKB.segs && window.WBKB.segs.length) || 0 };
    } catch (e) { return { ok: false, err: e.message }; }
  });
  ok('知识库加载成功', kb.ok, kb.ok ? kb.docs + ' 份文档' : (kb.err || ''));
  if (!kb.ok) { await browser.close(); site.close(); process.exit(2); }

  const keys = await p.evaluate(() => Object.keys(WIZ));
  const use = ONLY ? keys.filter(k => k.startsWith(ONLY)) : keys;
  console.log('\n要体检 ' + use.length + ' 张卡' + (ONLY ? '（只看 ' + ONLY + '）' : '') + '\n');

  let qTotal = 0, qMiss = 0, thin = [], wrongDoc = [];
  for (const k of use) {
    const r = await p.evaluate(k2 => {
      const d = WIZ[k2];
      const [sid, ci] = k2.split('/');
      const sc = SCENES.find(s => s.id === sid);
      const card = sc && sc.cards[+ci];
      const rows = (d.auto || []).map(a => {
        let hits = [];
        try { hits = window.WBSearch.retrieve(window.WBKB, a.q, 2600) || []; } catch (e) {}
        const docs = [];
        hits.forEach(h => { if (docs.indexOf(h.d) < 0) docs.push(h.d); });
        /* 🔴 只查段数 = 只知道「有东西」，不知道「是对的东西」。
           写了 want 的，命中的文档名里必须真出现它 —— 否则就是「检索到了，但检索到的是别的」，
           那比查不到更坏（页面会带着出处标注把无关内容当依据摆出来）。 */
        const wantOk = !a.want || docs.some(d => d.indexOf(a.want) >= 0);
        return { q: a.q, label: a.label, n: hits.length, docs: docs.slice(0, 3),
                 want: a.want || '', wantOk };
      });
      return {
        name: card ? card.n : '(卡片对不上)',
        scene: sc ? sc.name : '?',
        rows,
        steps: (d.steps || []).length,
        qs: (d.steps || []).reduce((a, s) => a + (s.qs || []).length, 0),
        out: (d.out || []).length,
        skills: (d.skills || []).length,
        file: d.file,
        /* 每个问题都要有 k 和 q，opts 类要有选项 —— 漏了页面上就是一块空白 */
        broken: (d.steps || []).flatMap(s => (s.qs || []).filter(q =>
          !q.k || !q.q || ((q.type === 'check' || q.type === 'radio') && !(q.opts || []).length)).map(q => q.k || '(无k)')),
      };
    }, k);

    const bad = r.rows.filter(x => !x.n).length;
    qTotal += r.rows.length; qMiss += bad;
    console.log('── ' + k + '  ' + r.scene + ' / ' + r.name
      + '   ' + r.steps + ' 步 · ' + r.qs + ' 问 · ' + r.out + ' 交付物 · ' + r.skills + ' 能力');
    for (const x of r.rows) {
      const mark = !x.n ? '❌' : (x.wantOk ? '✅' : '🔶');
      console.log('   ' + mark + ' ' + String(x.n).padStart(2) + ' 段  '
        + x.label + (x.n ? '   → ' + x.docs.join(' · ') : '   查询词：' + x.q)
        + (x.n && !x.wantOk ? '   🔶 期望命中「' + x.want + '」，没在里面' : ''));
      if (x.n && !x.wantOk) wrongDoc.push(k + '：期望 ' + x.want);
    }
    if (r.broken.length) ok(k + ' 有问题项残缺', false, r.broken.join('/'));
    if (r.steps < 3) { thin.push(k + '（只有 ' + r.steps + ' 步）'); }
    if (r.out < 3) { thin.push(k + '（只有 ' + r.out + ' 个交付物）'); }
    if (!r.skills) { thin.push(k + '（没写用哪些能力）'); }
    console.log('');
  }

  console.log('════ 汇总 ════');
  ok('所有检索词都命中', qMiss === 0, qMiss + ' / ' + qTotal + ' 条无匹配');
  ok('写了期望文档的，都命中了那一份', wrongDoc.length === 0, wrongDoc.join('，'));
  ok('每张卡结构完整（≥3步 · ≥3交付物 · 有能力清单）', thin.length === 0, thin.join('，'));
  ok('全部18张卡都登记了', keys.length === 18, keys.length + ' 张');
  ok('没有JS错误', errs.length === 0, errs.slice(0, 2).join(' | ').slice(0, 160));

  await browser.close(); site.close();
  console.log('\n═══ ' + pass + ' 过 / ' + fail + ' 红 ═══');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('探针自己挂了：', e); process.exit(3); });
