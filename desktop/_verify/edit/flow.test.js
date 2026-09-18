/* 多页面流程的地基门：扫描器（页 / 态 / 跳转 / 说明）＋ 五道判漏的门。纯 node，在临时目录里造真文件跑。
   🔴 每道门都做**负向标定**：先造一个「该报」的场景看它红，再把那一处修好看它绿。
   只验「该报的报了」不算标定——判据写错（比如永远返回 true）在正向里长得跟对的一模一样。 */
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const flow = require(path.join(__dirname, '..', '..', 'main', 'flow.js'));
let pass = 0;
const ok = (n, f) => { try { f(); pass++; console.log('✅', n); } catch (e) { console.log('❌', n, '\n   ', e.message); process.exitCode = 1; } };

/* 造一个临时项目：files = { 相对路径: 内容 } */
function proj(files) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'uwflow-'));
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(base, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  return base;
}
const page = (o = {}) => `<!DOCTYPE html><html><head><title>${o.title || '页'}</title>
<style>${o.css || ''}</style></head><body class="${o.cls || 'state-default'}">${o.body || ''}</body></html>`;
const codes = r => r.issues.map(i => i.code);
const has = (r, code, rel) => r.issues.some(i => i.code === code && (!rel || i.page === rel));

/* ── 扫描器 ───────────────────────────────────────── */
ok('页面清单：只收 html，模板源 / 控制台自己的文件 / .uw / 附件都不算页面', () => {
  const b = proj({
    'index.html': page(), 'detail.html': page(), 'src/index.template.html': page(),
    '_flow.html': page(), '.uw/project.json': '{}', '附件/x.html': page(), 'a.css': 'x', 'sub/second.html': page(),
  });
  assert.deepStrictEqual(flow.listHtml(b), ['detail.html', 'index.html', 'sub/second.html']);
});

/* 🔴 2026-09-18 改判据（吉吉提「抽屉也算页面」那轮）：
   「要不要补一个 state-default」以前看的是「body 上挂没挂类」，现在看的是
   **body 上挂的那个态，CSS 里有没有它自己的规则**。
   原因：没规则的那个态渲染出来就等于「什么类都不挂」，再补个 default
   等于同一张图起两个名字 —— 对照表多一格、铺开并排出两张一模一样的缩略图，
   人的第一反应是「我是不是看漏了」。两种情形各一条，都要覆盖。 */
ok('状态：body 上挂的态 CSS 里没规则 = 它就是基准，不再另造一个 default', () => {
  const s = flow.statesOf('<body class="state-guest">', 'body.state-empty .l{display:none} .state-error b{color:red}');
  assert.deepStrictEqual(s.map(x => x.key), ['guest', 'empty', 'error']);
  assert.strictEqual(s.find(x => x.key === 'empty').name, '空');        // 常见态给人话名
  assert.strictEqual(s.find(x => x.key === 'guest').name, '未登录');
});
ok('状态：body 上挂的态自己有 CSS 规则时，基准是另一屏，default 必须留着', () => {
  /* body.state-guest .price{display:none} —— 登录后能看见价格的那个样子是真实存在的另一屏，
     页面只是没有以它的形态发布。这一格不留，那一屏就永远不会有人去看。 */
  const s = flow.statesOf('<body class="state-guest">', 'body.state-guest .price{display:none} body.state-empty{}');
  assert.deepStrictEqual(s.map(x => x.key), ['default', 'guest', 'empty']);
});
ok('状态：一个态都没写的页面 = 只有默认态，不是毛病', () => {
  assert.deepStrictEqual(flow.statesOf('<body>', '.btn{}').map(x => x.key), ['default']);
});
ok('状态：CSS 注释里的 @态 能带出人话名和触发条件', () => {
  const s = flow.statesOf('<body>', '/* @态 empty 一条都没有 · 搜索词没命中任何产品 */\nbody.state-empty{}');
  const e = s.find(x => x.key === 'empty');
  assert.strictEqual(e.name, '一条都没有'); assert.strictEqual(e.when, '搜索词没命中任何产品');
});

ok('跳转：只认项目内的 .html，外站 / # / mailto / 图片一律不算流程', () => {
  const l = flow.linksOf(`<a href="detail.html" class="pd-card">看详情</a>
    <a href="https://made-in-china.com/x.html">外站</a><a href="#top">回顶</a>
    <a href="mailto:a@b.c">写信</a><a href="x.pdf">下载</a><a href="javascript:void(0)">空</a>`,
    '', 'index.html', ['index.html', 'detail.html']);
  assert.strictEqual(l.length, 1);
  assert.strictEqual(l[0].to, 'detail.html'); assert.strictEqual(l[0].sel, 'a.pd-card'); assert.strictEqual(l[0].text, '看详情');
});
ok('跳转：页脚里 20 个链接指同一页，只留一条但记次数', () => {
  const src = Array(3).fill('<a href="a.html" class="f">关于</a>').join('');
  const l = flow.linksOf(src, '', 'index.html', ['index.html', 'a.html']);
  assert.strictEqual(l.length, 1); assert.strictEqual(l[0].n, 3);
});
ok('跳转：子目录里的相对路径算得对（sub/a.html 里写 ../b.html → b.html）', () => {
  const l = flow.linksOf('<a href="../b.html">b</a>', '', 'sub/a.html', ['sub/a.html', 'b.html']);
  assert.strictEqual(l[0].to, 'b.html'); assert.strictEqual(l[0].ok, true);
});
ok('跳转：注释掉的链接不算', () => {
  assert.strictEqual(flow.linksOf('<!-- <a href="a.html">x</a> -->', '', 'i.html', ['i.html', 'a.html']).length, 0);
});

ok('说明：三张表各自解析，散文不碰', () => {
  const s = flow.parseSpec(`# 搜索结果页
## 这一页干什么
随便写点散文，不该被当成表。
## 状态
| 状态 | 类名 | 什么时候出现 |
|---|---|---|
| 空 | state-empty | 一条结果都没有 |
| 未登录 | \`state-guest\` | 没登录就搜 |
## 跳转
| 从哪个元素 | 跳到哪 | 什么时候 |
|---|---|---|
| .pd-card | detail.html | 点产品卡 |
## 规则
| 挂在哪 | 规则 |
|---|---|
| input[name=qty] | 只收正整数 |`);
  assert.deepStrictEqual(s.states.map(x => x.key), ['empty', 'guest']);
  assert.strictEqual(s.states[0].when, '一条结果都没有');
  assert.deepStrictEqual(s.links.map(x => x.to), ['detail.html']);
  assert.deepStrictEqual(s.rules.map(x => x.sel), ['input[name=qty]']);
});

ok('选择器核验：认得出的判真假，认不出的返回 null（宁可不判也不错判）', () => {
  const h = '<div class="pd-card"><input name="qty"><b id="tot">1</b></div>';
  assert.strictEqual(flow.selectorIn(h, '.pd-card'), true);
  assert.strictEqual(flow.selectorIn(h, '.nope'), false);
  assert.strictEqual(flow.selectorIn(h, '#tot'), true);
  assert.strictEqual(flow.selectorIn(h, 'input[name=qty]'), true);
  assert.strictEqual(flow.selectorIn(h, 'input[name=other]'), false);
  assert.strictEqual(flow.selectorIn(h, '.a:hover::after'), null, '认不出的应当不判');
});

/* ── 五道门：每道都先红后绿 ───────────────────────── */
ok('① 断链：指向不存在的文件报红；把文件建出来就绿（负向标定）', () => {
  const bad = flow.scan(proj({ 'index.html': page({ body: '<a href="detail.html">看</a>' }) }));
  assert.ok(has(bad, 'deadlink', 'index.html'), '断链没报：' + codes(bad));
  const good = flow.scan(proj({ 'index.html': page({ body: '<a href="detail.html">看</a>' }), 'detail.html': page() }));
  assert.ok(!has(good, 'deadlink'), '文件建出来了还报断链：' + codes(good));
});

ok('② 状态：说明写了页面没做 = 红；页面有说明没写 = 黄；两边对上就全绿（负向标定）', () => {
  const spec = (rows) => `## 状态\n| 状态 | 类名 | 什么时候 |\n|---|---|---|\n${rows}`;
  const r1 = flow.scan(proj({ 'index.html': page(), 'index.说明.md': spec('| 空 | state-empty | 没结果 |') }));
  assert.ok(has(r1, 'state-missing'), '声明了没实现，应当报红：' + codes(r1));

  const r2 = flow.scan(proj({ 'index.html': page({ css: 'body.state-empty{}' }), 'index.说明.md': spec('| 满 | state-max | 极限 |\nbody.state-max{}') }));
  assert.ok(has(r2, 'state-undocumented'), '实现了没声明，应当报黄：' + codes(r2));

  const r3 = flow.scan(proj({ 'index.html': page({ css: 'body.state-empty{}' }), 'index.说明.md': spec('| 空 | state-empty | 没结果 |') }));
  assert.ok(!has(r3, 'state-missing') && !has(r3, 'state-undocumented'), '两边对上了还报：' + JSON.stringify(r3.issues));
});

ok('③ 说明缺失：没有 .说明.md 报黄；建出来就绿（负向标定）', () => {
  const bad = flow.scan(proj({ 'index.html': page() }));
  assert.ok(has(bad, 'spec-missing'), '没说明应当报：' + codes(bad));
  const good = flow.scan(proj({ 'index.html': page(), 'index.说明.md': '# 页\n说明在这儿' }));
  assert.ok(!has(good, 'spec-missing'), '有说明还报：' + codes(good));
});

ok('④ 说明脱节：说明里的选择器页面里没有 = 红；改对就绿（负向标定）', () => {
  const md = sel => `## 规则\n| 挂在哪 | 规则 |\n|---|---|\n| ${sel} | 只收正整数 |`;
  const body = '<input name="qty">';
  const bad = flow.scan(proj({ 'index.html': page({ body }), 'index.说明.md': md('input[name=amount]') }));
  assert.ok(has(bad, 'spec-drift'), '选择器对不上应当报红：' + codes(bad));
  const good = flow.scan(proj({ 'index.html': page({ body }), 'index.说明.md': md('input[name=qty]') }));
  assert.ok(!has(good, 'spec-drift'), '对上了还报：' + codes(good));
});

ok('⑤ 字段没规则：有 name 的字段说明里没提 = 黄；隐藏域和按钮不算（负向标定）', () => {
  const bad = flow.scan(proj({ 'index.html': page({ body: '<input name="qty">' }), 'index.说明.md': '# 页' }));
  assert.ok(has(bad, 'field-undocumented'), '字段没规则应当报：' + codes(bad));
  const skip = flow.scan(proj({ 'index.html': page({ body: '<input type="hidden" name="tok"><input type="submit" name="go">' }), 'index.说明.md': '# 页' }));
  assert.ok(!has(skip, 'field-undocumented'), '隐藏域/提交键不该算字段：' + codes(skip));
});

ok('⑥ 孤儿与死路：多页项目才判，单页项目一声不吭（负向标定）', () => {
  const one = flow.scan(proj({ 'index.html': page() }));
  assert.ok(!has(one, 'orphan') && !has(one, 'deadend'), '单页项目不该判流程：' + codes(one));

  const many = flow.scan(proj({
    'index.html': page({ body: '<a href="detail.html">看</a>' }),
    'detail.html': page({ body: '<a href="index.html">回</a>' }),
    'lost.html': page({ body: '<a href="index.html">回</a>' }),   // 谁都跳不到它
    'trap.html': page(),                                          // 有人跳得到？没有，且没出口
  }));
  assert.ok(has(many, 'orphan', 'lost.html'), '孤儿没报：' + JSON.stringify(many.issues.map(i => i.code + ':' + i.page)));
  assert.ok(has(many, 'deadend', 'trap.html'), '死路没报');
  assert.ok(!has(many, 'orphan', 'detail.html'), 'index 跳得到 detail，不该算孤儿');
  assert.ok(!has(many, 'deadend', 'index.html'), 'index 有出口，不该算死路');
});

ok('入口：默认 index.html，它自己永远不算孤儿', () => {
  const r = flow.scan(proj({ 'index.html': page({ body: '<a href="a.html">a</a>' }), 'a.html': page({ body: '<a href="index.html">回</a>' }) }));
  assert.strictEqual(r.entry, 'index.html');
  assert.ok(!has(r, 'orphan'), '互相跳得到，不该有孤儿：' + codes(r));
});

ok('汇总数：页数 / 态数 / 红黄各多少，对得上 issues 本身', () => {
  const r = flow.scan(proj({
    'index.html': page({ css: 'body.state-empty{}', body: '<a href="x.html">断的</a>' }),
    'detail.html': page({ body: '<a href="index.html">回</a>' }),
  }));
  assert.strictEqual(r.n.pages, 2);
  assert.strictEqual(r.n.states, 3);                                  // index: default+empty, detail: default
  assert.strictEqual(r.n.bad, r.issues.filter(i => i.level === 'bad').length);
  assert.strictEqual(r.n.warn, r.issues.filter(i => i.level === 'warn').length);
  assert.ok(r.n.bad >= 1, '那条断链应当计进 bad');
});

ok('落盘：flow.json 写进 .uw/，内容能原样读回来', () => {
  const b = proj({ 'index.html': page() });
  const r = flow.scanAndSave(b);
  const back = JSON.parse(fs.readFileSync(path.join(b, '.uw', 'flow.json'), 'utf8'));
  assert.strictEqual(back.n.pages, r.n.pages);
  assert.strictEqual(back.pages[0].rel, 'index.html');
});

/* ── 剧本 ─────────────────────────────────────────── */
ok('剧本：一个二级标题一条主线，「页 · 态 · 说明」三段，态留空算默认', () => {
  const sc = flow.parseScripts(`# 剧本
## 买家从搜索到发出询盘
1. index.html · default · 搜 led
2. detail.html ·  · 点进第一个
3. \`inquiry.html\` · guest · 没登录就点询盘
## 另一条
- index.html · empty · 搜了个没货的词
这行不是步骤，没有 html`);
  assert.strictEqual(sc.length, 2);
  assert.deepStrictEqual(sc[0].steps.map(x => x.rel), ['index.html', 'detail.html', 'inquiry.html']);
  assert.strictEqual(sc[0].steps[1].state, 'default', '态留空应当算默认');
  assert.strictEqual(sc[0].steps[2].state, 'guest');
  assert.strictEqual(sc[0].steps[0].note, '搜 led');
  assert.strictEqual(sc[1].steps.length, 1);
});

ok('⑦ 剧本指空：步骤指向不存在的页或不存在的态 = 红；都对就绿（负向标定）', () => {
  const html = { 'index.html': page({ css: 'body.state-empty{}', body: '<a href="a.html">a</a>' }), 'a.html': page({ body: '<a href="index.html">回</a>' }) };
  const bad = flow.scan(proj({ ...html, '剧本.md': '## 线\n1. index.html · empty · 有\n2. nope.html · default · 没这页\n3. a.html · guest · 没这个态' }));
  assert.ok(has(bad, 'script-deadstep'), '指向不存在的页没报：' + codes(bad));
  assert.ok(has(bad, 'script-deadstate'), '指向不存在的态没报：' + codes(bad));
  const good = flow.scan(proj({ ...html, '剧本.md': '## 线\n1. index.html · empty · 有\n2. a.html · default · 也有' }));
  assert.ok(!has(good, 'script-deadstep') && !has(good, 'script-deadstate'), '都对了还报：' + codes(good));
});

ok('剧本没写不是毛病：没有剧本.md 时 scripts 是空数组，不报任何门', () => {
  const r = flow.scan(proj({ 'index.html': page() }));
  assert.deepStrictEqual(r.scripts, []);
  assert.ok(!codes(r).some(c => c.startsWith('script-')), '不该有剧本门：' + codes(r));
});

/* ── 交付编译（人和 AI 都要读的那份说明） ─────────────── */
const fdoc = require(path.join(__dirname, '..', '..', 'main', 'flow-doc.js'));

function demo() {
  const b = proj({
    'index.html': page({ css: 'body.state-empty{}', body: '<a class="pd-card" href="detail.html">看详情</a>' }),
    'detail.html': page({ title: '详情', body: '<a class="btn inq-btn" href="index.html">回</a><input name="qty">' }),
    'index.说明.md': `# 搜索结果页
## 这一页干什么
买家在这儿挑产品。
## 状态
| 状态 | 类名 | 什么时候 |
|---|---|---|
| 空 | state-empty | 一条都没有 |
## 跳转
| 从哪个元素 | 跳到哪 | 什么时候 |
|---|---|---|
| a.pd-card | detail.html | 点产品卡 |
## 为什么这么设计
价格用 visibility，卡片高度才不塌。`,
    'detail.说明.md': `# 详情
## 规则
| 挂在哪 | 规则 |
|---|---|
| input[name=qty] | 正整数，小于起订量报「起订量是 10」 |`,
    '剧本.md': '## 主线\n1. index.html · default · 搜 led\n2. detail.html · default · 点进去',
  });
  const d = flow.scan(b);
  for (const pg of d.pages) { const a = path.join(b, pg.spec.rel); pg._prose = fs.existsSync(a) ? fdoc.proseOf(fs.readFileSync(a, 'utf8')) : []; }
  return { base: b, d, md: fdoc.build(d, { projectName: '示例' }) };
}

ok('交付说明：五节都在，开头先说怎么读（人和 AI 各走哪条路）', () => {
  const { md } = demo();
  for (const h of ['## 一、页面清单', '## 二、跳转矩阵', '## 三、逐页', '## 四、主线', '## 五、交付时还没闭合的地方'])
    assert.ok(md.includes(h), '缺 ' + h);
  assert.ok(/要程序精确解析.*flow\.json/.test(md), '没告诉读者精确解析走 flow.json');
});

ok('🔴 可定位：跳转矩阵里的选择器带全部类名，两条不同的跳转不会指到同一个选择器', () => {
  const { md } = demo();
  assert.ok(md.includes('`a.pd-card`'), '产品卡的选择器不对');
  assert.ok(md.includes('`a.btn.inq-btn`'), 'class="btn inq-btn" 应当出 a.btn.inq-btn，只取第一个类会跟别的 a.btn 撞');
});

ok('「什么时候」按类名子集匹配：说明写 a.pd-card，页面上是 class="pd-card"，对得上', () => {
  const { md } = demo();
  const row = md.split('\n').find(l => l.includes('a.pd-card'));
  assert.ok(/点产品卡/.test(row), '没把说明里的「什么时候」接上：' + row);
});

ok('字段规则进表；说明没写的标出来，不留空白让人以为不用管', () => {
  const { md } = demo();
  assert.ok(/input\[name=qty\]/.test(md));
  assert.ok(/起订量是 10/.test(md));
});

ok('意图层原样搬人写的散文，但不重复搬那三张契约表', () => {
  const { md } = demo();
  assert.ok(/价格用 visibility，卡片高度才不塌/.test(md), '人写的「为什么」没搬进来');
  const n = (md.match(/买家在这儿挑产品/g) || []).length;
  assert.strictEqual(n, 1, '意图层被搬了 ' + n + ' 遍');
});

ok('🔴 没闭合的地方原样写进交付物，不藏（藏起来前端会当成设计本身照着实现）', () => {
  const b = proj({ 'index.html': page({ body: '<a href="nope.html">断的</a><a href="d.html">d</a>' }), 'd.html': page({ body: '<a href="index.html">回</a>' }) });
  const d = flow.scan(b);
  const md = fdoc.build(d, { projectName: 'x' });
  assert.ok(/硬伤/.test(md), '硬伤没写进说明');
  assert.ok(/nope\.html/.test(md), '断链的具体去处没写出来');
});

ok('写进交付目录：md 和 flow.json 两份都落地，同源', () => {
  const { base, d } = demo();
  const r = fdoc.writeInto(base, d, '示例');
  const md = fs.readFileSync(path.join(base, r.md), 'utf8');
  const js = JSON.parse(fs.readFileSync(path.join(base, r.json), 'utf8'));
  assert.strictEqual(js.n.pages, d.n.pages);
  assert.ok(md.includes('# 示例 · 交互流程说明'));
});

ok('表格里的竖线和换行会被转义，不把 markdown 表格撑破', () => {
  const b = proj({
    'index.html': page({ body: '<a href="d.html">a|b</a>' }), 'd.html': page({ body: '<a href="index.html">回</a>' }),
    'index.说明.md': '# x\n## 规则\n| 挂在哪 | 规则 |\n|---|---|\n| a | 含 \\| 竖线的规则 |',
  });
  const d = flow.scan(b);
  const md = fdoc.build(d, { projectName: 'x' });
  for (const line of md.split('\n')) {
    if (!/^\|/.test(line) || /^\|[\s:-]+\|/.test(line)) continue;
    const cells = line.split(/(?<!\\)\|/).length;
    assert.ok(cells >= 3, '这一行的格子被撑破了：' + line);
  }
});

/* ── 页面里自带的 demo 控制条 ─────────────────────────── */
const demobar = (inner) => page({ body: `<div class="ppc-demobar"><span class="ppc-demobar-label">Demo控制台（不属于产品界面）· 账户场景：</span>${inner}</div><div class="main">正文</div><a href="b.html">去</a>` });
const R = (v, l, ck) => `<label class="ss"><input type="radio" name="scene" value="${v}"${ck ? ' checked' : ''}>${l}</label>`;

ok('认出页面里的 demo 控制条：radio 归成一组场景，checkbox 各自一组', () => {
  const d = flow.demobarOf(demobar(R('new', '从未购买过') + R('ended', '只有已终止') + R('running', '有投放中', 1)
    + '<label class="cb"><input type="checkbox" id="ossView">OSS客服视角</label>'));
  assert.ok(d, '没认出来');
  const radio = d.groups.find(g => g.kind === 'radio');
  assert.strictEqual(radio.label, '账户场景', '组名没从「· 账户场景：」里取到：' + radio.label);
  assert.deepStrictEqual(radio.options.map(o => o.label), ['从未购买过', '只有已终止', '有投放中']);
  assert.strictEqual(radio.options[2].checked, true);
  const cb = d.groups.find(g => g.kind === 'checkbox');
  assert.strictEqual(cb.id, 'ossView');
  assert.ok(/OSS客服视角/.test(cb.label), cb.label);
});
ok('没有 demo 控制条的页面返回 null（别把产品自己的筛选栏当演示栏）', () => {
  assert.strictEqual(flow.demobarOf(page({ body: '<div class="filter-bar"><label><input type="radio" name="sort" value="new">最新</label></div>' })), null);
});
ok('只写了「Demo控制台」四个字、类名没带 demobar 的也认得出', () => {
  const d = flow.demobarOf(page({ body: '<div class="toolbar">Demo控制台 · 场景：<label><input type="radio" name="s" value="a">甲</label></div>' }));
  assert.ok(d && d.groups.length === 1, JSON.stringify(d));
});

ok('⑧ 控制条做进页面 = 硬伤；改成 state-* 类就绿（负向标定）', () => {
  const bad = flow.scan(proj({ 'index.html': demobar(R('new', '从未买过') + R('run', '有投放', 1)), 'b.html': page({ body: '<a href="index.html">回</a>' }) }));
  assert.ok(has(bad, 'demobar-in-page', 'index.html'), '没报：' + codes(bad));
  const i = bad.issues.find(x => x.code === 'demobar-in-page');
  assert.ok(/2 个选项/.test(i.text), '没说清有几个选项：' + i.text);
  const good = flow.scan(proj({
    'index.html': page({ css: 'body.state-new{} body.state-run{}', body: '<a href="b.html">去</a>' }),
    'b.html': page({ body: '<a href="index.html">回</a>' }),
  }));
  assert.ok(!has(good, 'demobar-in-page'), '改成 state-* 了还报：' + codes(good));
});

ok('扫描结果里带上 demobar，控制台才知道该提示谁去改', () => {
  const r = flow.scan(proj({ 'index.html': demobar(R('a', '甲', 1)), 'b.html': page({ body: '<a href="index.html">回</a>' }) }));
  const p = r.pages.find(x => x.rel === 'index.html');
  assert.ok(p.demobar && p.demobar.groups.length >= 1, JSON.stringify(p.demobar));
  const q = r.pages.find(x => x.rel === 'b.html');
  assert.strictEqual(q.demobar, null, '没有控制条的页面应当是 null');
});

console.log(`\n${pass} 项通过`);
