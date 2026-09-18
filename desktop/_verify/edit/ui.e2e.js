/* 界面半边的集成测试：真 renderer/index.html + mock 的 window.uw（IPC 桥）+ 真探针页面。
   验：编辑按钮 → 工具栏/面板出现 → 点 iframe 选中 → 面板显示真值 → 改字号/色 → editApply 收到 op、iframe 立刻变
       → 面板改字 → op text → ⌘Z 冲突提示 → 发消息时带手改记录。最后截图看版面。 */
const path = require('path'), fs = require('fs'), assert = require('assert');
const puppeteer = require(path.join(__dirname, '..', '..', 'restore-tools', 'online-reach', 'node_modules', 'puppeteer-core'));
const DESK = path.join(__dirname, '..', '..');
const H = require(DESK + '/main/htmlmap.js');
const PROBE = fs.readFileSync(DESK + '/main/edit-probe.js', 'utf8');
const caps = JSON.parse(fs.readFileSync(DESK + '/packs/capabilities.json', 'utf8'));
const comps = require(DESK + '/main/components.js').summary(DESK + '/packs/feique');
const kbmod = require(DESK + '/main/kb.js');
const kbIdx = { ok: true, root: DESK + '/kbdocs', groups: kbmod.index(DESK + '/kbdocs') };
const kbFq = { ok: true, ...kbmod.feique(DESK + '/packs/feique') };
const kbRead = rel => { const abs = path.join(DESK, 'kbdocs', rel); return fs.existsSync(abs) ? { ok: true, rel, abs, size: fs.statSync(abs).size, text: fs.readFileSync(abs, 'utf8') } : { ok: false, error: '没有 ' + rel }; };
const src = fs.readFileSync(path.join(__dirname, 'sample.html'), 'utf8');
fs.writeFileSync(path.join(require('os').tmpdir(), 'uw-ui-page.html'), H.mark(src) + '\n<script>' + PROBE + '</script>');
const PAGE = 'file://' + path.join(require('os').tmpdir(), 'uw-ui-page.html');

(async () => {
  const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--allow-file-access-from-files'], defaultViewport: { width: 1500, height: 900 } });
  const page = await browser.newPage();
  await page.setBypassCSP(true);   // renderer 的 CSP 只放 uwproj: 的 iframe，测试用 file:// 得绕开
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.evaluateOnNewDocument((caps, comps, kbIdx, kbFq, kbDocs, kbIcons, kbSvgs) => {
    if (window.parent !== window) return;   // 只给顶层 renderer 装桥
    window.__ops = []; window.__undo = []; window.__sent = []; window.__undoResp = { ok: true }; window.__imports = []; window.__blobs = [];
    window.__flow = []; window.__flowAt = []; window.__flowOpen = false;
    const noop = () => () => {};
    window.uw = {
      boot: async () => ({ version: '0.1.25', caps, settings: { role: 'design', model: '', permissionMode: 'acceptEdits', workspaceDir: '/x', handoffRepoDir: '/x/r', frontendName: '' }, engine: { ok: true, version: '2.0.0' }, projects: [], packDir: '/x/packs/feique' }),
      onRunEvent: noop(), onFilesChanged: noop(), onAltKey: noop(), onFigmaChanged: noop(),
      /* 这两个要把回调抓住：测试得能模拟「控制台窗口发来一条跳转指令」 */
      onFlowProject: noop(), onFlowAt: noop(),
      onFlowGoto: (fn) => { window.__onFlowGoto = fn; return () => {}; },
      onFlowClosed: (fn) => { window.__onFlowClosed = fn; return () => {}; },
      flowScan: async () => ({ ok: true, at: Date.now(), entry: 'index.html', pages: [], issues: [], scripts: [], scriptFile: '剧本.md', n: { pages: 0, states: 0, bad: 0, warn: 0 } }),
      flowOpen: async () => { window.__flow.push('open'); return { ok: true }; },
      flowClose: async () => { window.__flow.push('close'); return { ok: true }; },
      flowIsOpen: async () => ({ open: window.__flowOpen }),
      flowGoto: async (m) => { window.__flow.push(m); return { ok: true }; },
      flowAt: async (m) => { window.__flowAt.push(m); return { ok: true }; },
      /* 控制台点节点时，主窗口可能停在首页 —— 那时候它要自己把项目打开，所以桥上得有这个 */
      openProject: async (id) => ({ id, name: '测试项目', dir: '/x/' + id, role: 'design', files: [{ rel: 'index.html' }], messages: [] }),
      listProjects: async () => [], saveSettings: async () => true, detectEngine: async () => ({ ok: true }),
      listFiles: async () => [{ rel: 'index.html', size: 1, mtime: 1 }], checkFile: async () => ({ issues: [], n: 0, badN: 0, ok: true }),
      readFile: async () => ({ text: '' }), readFigma: async () => ({ changes: [], files: {} }),
      editApply: async (a) => { window.__ops.push(a); return { ok: true, select: a.ops[0].i, changes: a.ops.map(o => o.op + ':' + o.i) }; },
      editUndo: async (a) => { window.__undo.push(a); return window.__undoResp; }, editRedo: async () => ({ ok: true }),
      send: async (a) => { window.__sent.push(a); return { ok: true }; },
      editComponents: async () => ({ ok: true, list: comps }),
      kbIndex: async () => kbIdx, kbFeique: async () => kbFq, kbRead: async (rel) => kbDocs[rel] || { ok: false, error: '没有 ' + rel },
      iconIdentify: async (ds) => ({ ok: true, hit: (window.__iconIdx || (window.__iconIdx = kbIcons)).find ? null : null, ...(function () { const want = ds.map(d => String(d).replace(/\s+/g, ' ').trim()); for (const [n, l] of Object.entries(kbIcons)) if (l.length === want.length && want.every(d => l.includes(d))) return { hit: { name: n, exact: true } }; return { hit: null }; })() }),
      iconSvg: async (name) => ({ ok: true, name, svg: kbSvgs[name] || '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M0 0h16v16H0z" fill="#222222"/></svg>' }),
      copy: async (t) => { window.__copied = t; return true; }, reveal: async () => true, openExternal: async () => true, openPath: async () => true,
      kbAdd: async (a) => { window.__kbAdded = a; const rel = 'user/' + (a.kind === 'skill' ? 'skills' : 'docs') + '/' + (a.title || 'x') + '.md'; kbDocs[rel] = { ok: true, rel, abs: '/Users/me/.uw-desktop/kb/' + rel.slice(5), size: 10, text: '# ' + a.title + '\n\n' + (a.text || '来自文件') }; const g = kbIdx.groups.find(x => x.title === (a.kind === 'skill' ? '我添加的技能' : '我添加的资料')) || (kbIdx.groups.push({ title: a.kind === 'skill' ? '我添加的技能' : '我添加的资料', n: 0, items: [], user: true }), kbIdx.groups[kbIdx.groups.length - 1]); g.items.push({ id: a.title, rel, summary: a.summary || '第一句', user: true }); g.n = g.items.length; return { ok: true, entry: { id: a.title, rel } }; },
      kbRemove: async (rel) => { for (const g of kbIdx.groups) g.items = g.items.filter(i => i.rel !== rel); return { ok: true }; },
      checkUpdate: async () => window.__upd || { ok: true, hasUpdate: false, version: '0.1.25', current: '0.1.25' },
      downloadUpdate: async (a) => { window.__dl = a; for (const d of [30, 60, 100]) { window.__progressCb && window.__progressCb({ done: d, total: 100 }); await new Promise(r => setTimeout(r, 30)); } return { ok: true, file: '/Users/me/.uw-desktop/updates/x.dmg' }; },
      installUpdate: async (a) => { window.__inst = a; return window.__instResp || { ok: true }; },
      onUpdateProgress: (fn) => { window.__progressCb = fn; return () => { window.__progressCb = null; }; },
      importFiles: async (a) => { window.__imports.push(a); return { ok: true, files: a.paths.map(p => ({ rel: '附件/' + p.split('/').pop(), abs: '/x/p/附件/' + p.split('/').pop(), name: p.split('/').pop(), isImage: /\.(png|jpe?g)$/i.test(p), size: 1 })), errors: [] }; },
      importBlob: async (a) => { window.__blobs.push({ name: a.name, bytes: a.data.length || a.data.byteLength }); return { ok: true, file: { rel: '附件/' + a.name, abs: '/x/p/附件/' + a.name, name: a.name, isImage: true, size: 1 } }; },
      pathForFile: (f) => f.name === 'nopath.png' ? '' : '/Users/me/Desktop/' + f.name,
      pickAny: async () => '/Users/me/Desktop/规范.pdf',
    };
  }, caps, comps, kbIdx, kbFq, Object.fromEntries(kbIdx.groups.flatMap(g => g.items).slice(0, 600).map(it => [it.rel, kbRead(it.rel)])), kbmod.iconIndex(DESK + '/packs/feique'), Object.fromEntries(['personal', 'search', 'arrow-down'].map(n => [n, kbmod.iconSvg(DESK + '/packs/feique', n)])));
  await page.goto('file://' + DESK + '/renderer/index.html');
  await new Promise(r => setTimeout(r, 300));
  let pass = 0;
  const ok = (n, f) => { try { f(); pass++; console.log('✅', n); } catch (e) { console.log('❌', n, '\n   ', e.message); process.exitCode = 1; } };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  /* 进工作区、装上预览页 */
  await page.evaluate((PAGE) => {
    S.project = { id: 'p', name: '测试项目', dir: '/x/p', files: [{ rel: 'index.html' }] }; S.logs.set('p', { items: [], busy: false });
    S.view = 'work'; document.getElementById('viewHome').hidden = true; document.getElementById('viewWork').hidden = false;
    S.previewFile = 'index.html'; document.getElementById('previewEmpty').hidden = true; document.getElementById('frameWrap').hidden = false;
    setTab('preview'); setEdit(true);
    document.getElementById('preview').src = PAGE;
  }, PAGE);
  await wait(600);
  const st = await page.evaluate(() => ({ bar: !document.getElementById('editBar').hidden, panel: !document.getElementById('editPanel').hidden, on: document.getElementById('btnEdit').classList.contains('on'), editing: document.getElementById('stagePreview').classList.contains('editing'), probeOn: ED.on, ready: ED.ready }));
  ok('点「编辑」：工具栏与面板出现、按钮亮起、探针握手完成', () => { assert.deepStrictEqual(st, { bar: true, panel: true, on: true, editing: true, probeOn: true, ready: true }); assert.strictEqual(st.bar, true); assert.strictEqual(st.panel, true); assert.strictEqual(st.on, true); assert.strictEqual(st.editing, true); assert.strictEqual(st.ready, true); });

  const frame = () => page.frames().find(f => f.url() === PAGE);
  /* iframe 在 fit 模式下被 transform 缩放，把元素坐标换算到窗口坐标 */
  const at = async sel => {
    const ir = await page.evaluate(() => { const f = document.getElementById('preview'); const r = f.getBoundingClientRect(); return { l: r.left, t: r.top, s: r.width / f.offsetWidth }; });
    const er = await frame().evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }, sel);
    return { x: ir.l + (er.x + er.w / 2) * ir.s, y: ir.t + (er.y + er.h / 2) * ir.s };
  };
  let c = await at('h1'); await page.mouse.click(c.x, c.y); await wait(150);
  const panel = await page.evaluate(() => ({ cur: document.querySelector('#editPanel .ep-cur b').textContent, text: (document.querySelector('#editPanel [data-text]') || {}).value, fs: (document.querySelector('#editPanel select[data-prop="font-size"]') || {}).value, fw: (document.querySelector('#editPanel select[data-prop="font-weight"]') || {}).value, color: (document.querySelector('#editPanel input[data-hex="color"]') || {}).value, crumb: [...document.querySelectorAll('#editPanel .ep-crumb button')].map(b => b.textContent) }));
  ok('点选h1：面板显示元素名、文字、字号24、字重700、颜色 #222222、面包屑body', () => { assert.strictEqual(panel.cur, 'h1.title'); assert.strictEqual(panel.text, 'Hello world'); assert.strictEqual(panel.fs, '24'); assert.strictEqual(panel.fw, '700'); assert.strictEqual(panel.color, '#222222'); assert.deepStrictEqual(panel.crumb, ['body']); });

  /* 改字号 → iframe 立刻变、350ms 后写文件 */
  await page.select('#editPanel select[data-prop="font-size"]', '32'); await wait(80);
  const fsLive = await frame().evaluate(() => getComputedStyle(document.querySelector('h1')).fontSize);
  ok('面板改字号32：iframe里立刻生效', () => assert.strictEqual(fsLive, '32px'));
  await wait(450);
  let ops = await page.evaluate(() => window.__ops);
  ok('350ms后editApply收到style op（font-size:32px）', () => { assert.strictEqual(ops.length, 1); assert.deepStrictEqual(ops[0].ops[0], { op: 'style', i: ops[0].ops[0].i, tag: 'h1', set: { 'font-size': '32px' } }); assert.strictEqual(ops[0].rel, 'index.html'); });
  /* 连点两个色板：合并成一次写 */
  await page.click('#editPanel .ep-sw button[data-prop="color"][data-v="#E64545"]'); await wait(100);
  await page.click('#editPanel .ep-sw button[data-prop="color"][data-v="#007DFA"]'); await wait(500);
  ops = await page.evaluate(() => window.__ops);
  ok('连点两个色板：只写一次、取最后那个（#007DFA）', () => { assert.strictEqual(ops.length, 2); assert.deepStrictEqual(ops[1].ops[0].set, { color: '#007DFA' }); });
  const colLive = await frame().evaluate(() => getComputedStyle(document.querySelector('h1')).color);
  ok('色板改色：iframe里h1变蓝', () => assert.strictEqual(colLive, 'rgb(0, 125, 250)'));
  const hexBad = await page.evaluate(() => document.querySelector('#editPanel input[data-hex="color"]').classList.contains('bad'));
  ok('飞鹊色板内的值：色值框不标橙', () => assert.strictEqual(hexBad, false));

  /* 面板改字 */
  await page.click('#editPanel [data-text]'); await page.evaluate(() => document.querySelector('#editPanel [data-text]').select()); await page.keyboard.type('新标题'); await page.keyboard.press('Enter'); await wait(300);
  ops = await page.evaluate(() => window.__ops);
  const h1Text = await frame().evaluate(() => document.querySelector('h1').textContent);
  ok('面板改字回车：iframe文字变、editApply收到text op（带旧文字）', () => { assert.strictEqual(h1Text, '新标题'); const o = ops[ops.length - 1].ops[0]; assert.strictEqual(o.op, 'text'); assert.strictEqual(o.text, '新标题'); assert.strictEqual(o.old, 'Hello world'); });

  /* 工具栏按钮：删除 → 走结构性路径（reselect + 重载） */
  c = await at('.card[data-k="2"]'); await page.mouse.click(c.x, c.y); await wait(150);
  const before = await page.evaluate(() => window.__ops.length);
  await page.click('#ebDel'); await wait(300);
  ops = await page.evaluate(() => window.__ops);
  ok('工具栏「删除」：发出remove op', () => { assert.strictEqual(ops.length, before + 1); assert.strictEqual(ops[ops.length - 1].ops[0].op, 'remove'); });

  /* ⌘Z 冲突：先提示，再按一次才强制 */
  await page.evaluate(() => { window.__undoResp = { ok: false, conflict: true }; document.body.focus(); });
  await page.keyboard.down('Meta'); await page.keyboard.press('z'); await page.keyboard.up('Meta'); await wait(120);
  const toastText = await page.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.textContent).join('|'));
  const undo1 = await page.evaluate(() => window.__undo);
  ok('⌘Z遇到Claude改过文件：不撤、弹提示、force=false', () => { assert.ok(/被Claude改过/.test(toastText), toastText); assert.strictEqual(undo1[0].force, false); });
  await page.evaluate(() => { window.__undoResp = { ok: true }; });
  await page.keyboard.down('Meta'); await page.keyboard.press('z'); await page.keyboard.up('Meta'); await wait(120);
  const undo2 = await page.evaluate(() => window.__undo);
  ok('再按一次 ⌘Z：force=true', () => assert.strictEqual(undo2[1].force, true));

  /* 发消息带手改记录 */
  await page.evaluate(() => { document.getElementById('composer').value = '再把按钮放大一点'; document.getElementById('btnSend').click(); });
  await wait(150);
  const sent = await page.evaluate(() => window.__sent);
  ok('发消息：正文前带「用户刚在预览里手动改了index.html」记录，界面显示原话', () => { assert.strictEqual(sent.length, 1); assert.ok(sent[0].text.startsWith('【用户刚在预览里手动改了index.html'), sent[0].text.slice(0, 60)); assert.ok(sent[0].text.includes('style:'), sent[0].text); assert.strictEqual(sent[0].display, '再把按钮放大一点'); });
  const edits = await page.evaluate(() => ED.edits.length);
  ok('发完清空手改记录', () => assert.strictEqual(edits, 0));

  /* ── 跑着的时候也能说话（跟终端一样）。2026-09-17 实测 Claude Code 会把中途写进 stdin 的消息注入当前 turn，
     所以界面这边只要「不拦」：按钮不灰、发出去、气泡标成补充、不当成新一轮。 */
  await page.evaluate(() => { const L = S.logs.get('p'); L.busy = true; L.startedAt = Date.now() - 65000; updateStatus(); });
  const busyUI = await page.evaluate(() => ({ dis: document.getElementById('btnSend').disabled, ph: document.getElementById('composer').placeholder, st: document.getElementById('statusText').textContent }));
  ok('Claude在跑：发送按钮不灰，输入框提示改成「你照样能说」，状态条仍显示执行中', () => { assert.strictEqual(busyUI.dis, false); assert.ok(/照样能说/.test(busyUI.ph), busyUI.ph); assert.ok(/执行中/.test(busyUI.st), busyUI.st); });
  const nBefore = await page.evaluate(() => window.__sent.length);
  await page.evaluate(() => { document.getElementById('composer').value = '记得响应式也要跟线上一样'; document.getElementById('btnSend').click(); });
  await wait(150);
  const inter = await page.evaluate(() => { const L = S.logs.get('p'); const last = L.items[L.items.length - 1]; const el = [...document.querySelectorAll('#chatLog .msg-user')].pop(); return { n: window.__sent.length, sentText: window.__sent[window.__sent.length - 1].text, item: last, busy: L.busy, started: L.startedAt, cls: el && el.className, lbl: el && (el.querySelector('.lbl') || {}).textContent, body: el && el.textContent }; });
  ok('跑着发一句：真的发出去了（uw.send被调），不再toast「上一条还在跑」', () => { assert.strictEqual(inter.n, nBefore + 1); assert.ok(/记得响应式/.test(inter.sentText), inter.sentText); });
  ok('那句在对话里标成「补充」气泡，说明它做完手上这一步才会看到', () => { assert.strictEqual(inter.item.k, 'user'); assert.strictEqual(inter.item.inter, true); assert.ok(/inter/.test(inter.cls), inter.cls); assert.ok(/补充/.test(inter.lbl) && /这一步/.test(inter.lbl), inter.lbl); assert.ok(/记得响应式/.test(inter.body)); });
  ok('补充不算新一轮：busy仍为true，计时没被重置（还是60多秒前开始的）', () => { assert.strictEqual(inter.busy, true); assert.ok(Date.now() - inter.started > 60000, String(Date.now() - inter.started)); });
  await page.evaluate(() => onRunEvent('p', { t: 'turn_start', resumed: true, interjected: true, reason: 'interject' }));
  await wait(60);
  const sysTxt = await page.evaluate(() => { const L = S.logs.get('p'); return [...L.items].reverse().find(x => x.k === 'sys').text; });
  ok('上一轮刚结束才处理补充：系统提示说「接着处理你刚补的那句」，不说成后台任务', () => assert.ok(/刚补的那句/.test(sysTxt), sysTxt));
  await page.evaluate(() => { const L = S.logs.get('p'); L.busy = false; updateStatus(); });
  const idlePh = await page.evaluate(() => document.getElementById('composer').placeholder);
  ok('跑完：输入框提示恢复成平时那句', () => assert.ok(/接着说/.test(idlePh), idlePh));

  /* ── 飞鹊组件栏 ── */
  await page.click('#ebComps'); await wait(400);
  const cp = await page.evaluate(() => ({ shown: !document.getElementById('compPanel').hidden, cls: document.getElementById('stagePreview').classList.contains('comps'), cards: document.querySelectorAll('#compPanel .cp-card').length, ctl: document.querySelectorAll('#compPanel .cp-card.control').length, blk: document.querySelectorAll('#compPanel .cp-card.block').length, frames: document.querySelectorAll('#compPanel iframe').length, left: getComputedStyle(document.getElementById('frameWrap')).left }));
  ok('点「飞鹊组件」：组件栏出现，33控件 + 12片段，每张卡一个缩略图iframe，预览区让位244px', () => { assert.strictEqual(cp.shown, true); assert.strictEqual(cp.cards, 45); assert.strictEqual(cp.ctl, 33); assert.strictEqual(cp.blk, 12); assert.strictEqual(cp.frames, 45); assert.strictEqual(cp.left, '244px'); });
  const thumbOk = await page.evaluate(() => { const fr = document.querySelector('#compPanel .cp-card[data-id="btn-primary"] iframe'); const d = fr.contentDocument; const a = d && d.querySelector('a.btn'); if (!a) return 'no-a'; const cs = d.defaultView.getComputedStyle(a); return cs.backgroundColor + '|' + cs.height; });
  ok('缩略图真渲染：主按钮底色 #E64545、高32', () => { const [bg, h] = thumbOk.split('|'); assert.strictEqual(bg, 'rgb(230, 69, 69)'); assert.strictEqual(Math.round(parseFloat(h)), 32); });
  const thumbFont = await page.evaluate(() => { const fr = document.querySelector('#compPanel .cp-card[data-id="tag-line"] iframe'); const d = fr.contentDocument; const t = d.querySelector('.tag'); const cs = d.defaultView.getComputedStyle(t); return { fam: cs.fontFamily, w: cs.fontWeight }; });
  ok('缩略图不依赖本机Roboto（这台机子的Roboto各字重解析到同一张粗脸）：走系统字体、字重400', () => { assert.ok(/-apple-system/.test(thumbFont.fam), thumbFont.fam); assert.strictEqual(thumbFont.w, '400'); });
  await page.type('#cpQ', '产品卡'); await wait(120);
  const filtered = await page.evaluate(() => document.querySelectorAll('#compPanel .cp-card').length);
  ok('搜索「产品卡」只剩7张', () => assert.strictEqual(filtered, 7));
  await page.evaluate(() => { const q = document.getElementById('cpQ'); q.value = ''; q.dispatchEvent(new Event('input')); }); await wait(120);
  /* 中文输入法：组字期间不能把输入框重建掉，否则拼音被打断、只能打出字母（吉吉 2026-09-17 报的） */
  const ime = await page.evaluate(async () => {
    const q0 = document.getElementById('cpQ'); q0.__mark = 1; q0.focus();
    q0.dispatchEvent(new CompositionEvent('compositionstart'));
    for (const t of ['a', 'an', 'ann', 'anniu']) { q0.value = t; q0.dispatchEvent(new InputEvent('input', { data: t.slice(-1), isComposing: true })); }
    const mid = { same: document.getElementById('cpQ') === q0, mark: !!document.getElementById('cpQ').__mark };
    q0.value = '按钮'; q0.dispatchEvent(new CompositionEvent('compositionend', { data: '按钮' }));
    await new Promise(r => setTimeout(r, 120));
    const after = document.getElementById('cpQ');
    return { mid, same: after === q0, mark: !!after.__mark, val: after.value, cards: document.querySelectorAll('#compPanel .cp-card').length };
  });
  ok('中文输入法：组字期间输入框不被重建（同一个DOM节点活到最后），落字后才过滤，搜「按钮」有结果', () => { assert.strictEqual(ime.mid.same, true); assert.strictEqual(ime.mid.mark, true); assert.strictEqual(ime.same, true); assert.strictEqual(ime.mark, true); assert.strictEqual(ime.val, '按钮'); assert.ok(ime.cards > 0 && ime.cards < 45, String(ime.cards)); });
  await page.evaluate(() => { const q = document.getElementById('cpQ'); q.value = ''; q.dispatchEvent(new Event('input')); }); await wait(150);

  /* 拖「主按钮」到自造按钮 a#cta 中间 → replace op，带原文字与链接 */
  const cardBox = await page.evaluate(() => { const r = document.querySelector('#compPanel .cp-card[data-id="btn-primary"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 20 }; });
  c = await at('a#cta');
  await page.evaluate(() => { window.__ops = []; });
  /* 🔴 puppeteer 25 的 mouse.dragAndDrop 靠 Input.setInterceptDrags，跨到 iframe 会挂死（实测 5 秒不回、还把左键留在按下态）。
     所以拖放这一段不走 CDP 输入通道，改在 iframe 里派发带 DataTransfer 的真 DragEvent，走的是探针同一套 dragover/drop 逻辑。
     真拖放的手感（拖影、跨 iframe 投递）只能真机点。 */
  let dragOk = false;
  {
    void cardBox;
    await frame().evaluate(() => { const el = document.querySelector('a#cta'); const r = el.getBoundingClientRect(); const dt = new DataTransfer(); dt.setData('text/uw-component', 'btn-primary'); const mk = t => new DragEvent(t, { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, dataTransfer: dt }); el.dispatchEvent(mk('dragover')); el.dispatchEvent(mk('drop')); });
    await wait(400); ops = await page.evaluate(() => window.__ops);
  }
  ok(`拖主按钮到自造按钮中间${dragOk ? '（CDP真拖放）' : '（iframe内DragEvent）'}：replace op 带 component 与原文字、链接`, () => { const o = ops[ops.length - 1].ops[0]; assert.strictEqual(o.op, 'replace'); assert.strictEqual(o.component, 'btn-primary'); assert.deepStrictEqual(o.keep, { text: 'Send Inquiry', href: 'https://example.com', src: null }); });
  await wait(600);   // 结构性改动 → 重载，等探针回来

  /* 拖到卡片上边缘 → insert before */
  /* 卡片在横排 flex 里：前/后是左右边缘（上下边缘按中间算＝替换），跟拖拽换序的方向判定一致 */
  const cr = await frame().evaluate(() => { const r = document.querySelector('.card[data-k="1"]').getBoundingClientRect(); return { x: r.left + 4, y: r.top + r.height / 2, i: document.querySelector('.card[data-k="1"]').getAttribute('data-uw-i') }; });
  await page.evaluate(() => { window.__ops = []; });
  await frame().evaluate((p) => { const el = document.elementFromPoint(p.x, p.y); const dt = new DataTransfer(); dt.setData('text/uw-component', 'tag-line'); const mk = t => new DragEvent(t, { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, dataTransfer: dt }); el.dispatchEvent(mk('dragover')); window.__insShown = document.getElementById('__uwEditRoot').shadowRoot.querySelector('.ins').style.display; el.dispatchEvent(mk('drop')); }, cr);
  await wait(400); ops = await page.evaluate(() => window.__ops);
  const insShown2 = await frame().evaluate(() => window.__insShown).catch(() => 'reloaded');
  ok('拖标签到卡片左边缘：dragover出插入线，drop是insert before那张卡', () => { assert.strictEqual(insShown2, 'block'); const o = ops[ops.length - 1].ops[0]; assert.strictEqual(o.op, 'insert'); assert.strictEqual(o.where, 'before'); assert.strictEqual(String(o.i), cr.i); assert.strictEqual(o.component, 'tag-line'); });
  await wait(600);

  /* 组件属性：选中带飞鹊类名的按钮 → 面板出「组件属性」，切成蓝边次按钮 */
  c = await at('a#fqbtn'); await page.mouse.click(c.x, c.y); await wait(200);
  const varSec = await page.evaluate(() => { const s = document.querySelector('#editPanel .ep-var'); if (!s) return null; return { fam: s.dataset.fam, on: [...s.querySelectorAll('button.on')].map(b => b.textContent), sel: [...s.querySelectorAll('select')].map(x => x.value), dims: s.querySelectorAll('.ep-row').length }; });
  ok('选中飞鹊按钮：面板出现「组件属性」，十档的样式是下拉（当前主·红），尺寸与形状是分段（中32 / 直角）', () => { assert.ok(varSec, '没有组件属性段'); assert.strictEqual(varSec.fam, 'btn'); assert.deepStrictEqual(varSec.sel, ['btn-primary']); assert.deepStrictEqual(varSec.on, ['中32', '直角']); assert.strictEqual(varSec.dims, 3); });
  await page.evaluate(() => { window.__ops = []; });
  await page.select('#editPanel .ep-var select[data-var="0"]', 'btn-secondary-blue'); await wait(300);
  ops = await page.evaluate(() => window.__ops);
  const clsNow = await frame().evaluate(() => document.querySelector('a#fqbtn').className);
  ok('切成「次 · 蓝边」：iframe类名立刻变，class op只换样式那一组', () => { assert.strictEqual(clsNow, 'btn btn-md btn-secondary-blue'); const o = ops[ops.length - 1].ops[0]; assert.strictEqual(o.op, 'class'); assert.deepStrictEqual(o.add, ['btn-secondary-blue']); assert.ok(o.remove.includes('btn-primary') && !o.remove.includes('btn-md')); });
  await page.click('#editPanel .ep-var button[data-cls="btn-lg"]'); await wait(300);
  const clsNow2 = await frame().evaluate(() => document.querySelector('a#fqbtn').className);
  ok('再切尺寸「大40」：样式那组不动', () => assert.strictEqual(clsNow2, 'btn btn-secondary-blue btn-lg'));
  await page.screenshot({ path: path.join(require('os').tmpdir(), 'uw-ui-shot-comps.png') });

  /* ── 收起对话：工具栏最左的侧栏开关 ── */
  const wBefore = await page.evaluate(() => document.getElementById('frameWrap').getBoundingClientRect().width);
  const noOld = await page.evaluate(() => !document.getElementById('btnCanvas') && !document.getElementById('ebCanvas') && !!document.querySelector('.wk-head #chatHandle'));
  ok('收起对话的入口只在工具栏最左（返回箭头旁），编辑工具栏与右上都没有', () => assert.strictEqual(noOld, true));
  await page.click('#chatHandle'); await wait(150);
  const cv = await page.evaluate(() => ({ cls: document.querySelector('.wk-body').classList.contains('canvas'), chat: getComputedStyle(document.querySelector('.chat')).display, cols: getComputedStyle(document.querySelector('.wk-body')).gridTemplateColumns.split(' ').length, on: document.getElementById('chatHandle').classList.contains('on'), w: document.getElementById('frameWrap').getBoundingClientRect().width, title: document.getElementById('chatHandle').title }));
  ok('点侧栏开关：对话区隐藏、画布独占一列且变宽、开关高亮、提示改成「展开对话」', () => { assert.strictEqual(cv.cls, true); assert.strictEqual(cv.chat, 'none'); assert.strictEqual(cv.cols, 1); assert.strictEqual(cv.on, true); assert.ok(cv.w > wBefore + 300, `${wBefore} → ${cv.w}`); assert.ok(cv.title.startsWith('展开对话')); });
  await page.evaluate(() => { const L = S.logs.get('p'); L.busy = true; updateStatus(); });
  const busyDot = await page.evaluate(() => { const h = document.getElementById('chatHandle'); return h.classList.contains('busy') && getComputedStyle(h.querySelector('.dot')).display === 'block'; });
  await page.evaluate(() => { const L = S.logs.get('p'); L.busy = false; updateStatus(); });
  const unread = await page.evaluate(() => { const h = document.getElementById('chatHandle'); return h.classList.contains('unread') && !h.classList.contains('busy'); });
  ok('开关上的状态点：Claude在跑时亮，跑完标未读', () => { assert.strictEqual(busyDot, true); assert.strictEqual(unread, true); });
  await page.click('#chatHandle'); await wait(150);
  const back = await page.evaluate(() => ({ cls: document.querySelector('.wk-body').classList.contains('canvas'), chat: getComputedStyle(document.querySelector('.chat')).display, unread: document.getElementById('chatHandle').classList.contains('unread'), dot: getComputedStyle(document.querySelector('#chatHandle .dot')).display }));
  ok('再点：对话回来、未读清掉、状态点隐藏', () => { assert.strictEqual(back.cls, false); assert.strictEqual(back.chat, 'flex'); assert.strictEqual(back.unread, false); assert.strictEqual(back.dot, 'none'); });
  await page.click('#btnCollapse'); await wait(100);
  await page.click('#chatHandle'); await wait(100);
  const excl = await page.evaluate(() => ({ solo: document.querySelector('.wk-body').classList.contains('solo'), canvas: document.querySelector('.wk-body').classList.contains('canvas'), t: document.getElementById('btnCollapse').textContent }));
  ok('「只看对话」开着时收起对话：互斥，只剩画布', () => { assert.strictEqual(excl.solo, false); assert.strictEqual(excl.canvas, true); assert.strictEqual(excl.t, '只看对话'); });
  await page.screenshot({ path: path.join(require('os').tmpdir(), 'uw-ui-shot-canvas.png') });
  await page.evaluate(() => setCanvasOnly(false)); await wait(100);

  /* ── 更新条 ── */
  const noBar = await page.evaluate(() => document.getElementById('updBar').hidden);
  ok('启动查更新：已是最新时不出条', () => assert.strictEqual(noBar, true));
  await page.evaluate(() => { window.__upd = { ok: true, hasUpdate: true, version: '0.1.26', current: '0.1.25', size: 240 * 1048576, url: 'https://github.com/x/UED-WorkBuddy-0.1.26-universal.dmg', notes: '## 更新\n- 能拖图进对话\n- 收起对话改成侧栏开关\n- 第三条不显示' }; return checkUpdate(false); });
  await wait(100);
  const bar = await page.evaluate(() => { const c = document.getElementById('updBar'); const r = c.getBoundingClientRect(); return { shown: !c.hidden, t: document.getElementById('updText').textContent, s: document.getElementById('updSub').textContent, n: document.getElementById('updNotes').textContent, title: document.getElementById('updNotes').title, w: Math.round(r.width), right: Math.round(innerWidth - r.right), top: Math.round(r.top), later: document.getElementById('updLater').textContent, go: document.getElementById('updGo').textContent }; });
  ok('有新版：右上角浮出352px小卡，标题「可以更新了」、副行当前版本与体积、说明只取第一条（全部在title里）', () => { assert.strictEqual(bar.shown, true); assert.strictEqual(bar.t, 'UED WorkBuddy 0.1.26可以更新了'); assert.strictEqual(bar.s, '当前0.1.25 · 240 MB'); assert.strictEqual(bar.n, '能拖图进对话'); assert.ok(/收起对话/.test(bar.title)); assert.strictEqual(bar.w, 352); assert.strictEqual(bar.right, 20); assert.ok(bar.top < 40, String(bar.top)); assert.strictEqual(bar.later, '以后再说'); assert.strictEqual(bar.go, '更新'); });
  await page.evaluate(() => { const L = S.logs.get('p'); L.busy = true; });
  await page.click('#updGo'); await wait(80);
  const blocked = await page.evaluate(() => ({ dl: !!window.__dl, toast: [...document.querySelectorAll('.toast')].map(t => t.textContent).join('|') }));
  ok('有会话在跑时点更新：不下载，提示等结束（再点一次强制）', () => { assert.strictEqual(blocked.dl, false); assert.ok(/还在跑/.test(blocked.toast), blocked.toast); });
  await page.evaluate(() => { const L = S.logs.get('p'); L.busy = false; UP.forceAt = 0; });
  await page.click('#updGo'); await wait(400);
  const done = await page.evaluate(() => ({ dl: window.__dl, inst: window.__inst, go: document.getElementById('updGo').textContent, sub: document.getElementById('updSub').textContent, later: document.getElementById('updLater').hidden, w: document.querySelector('#updProg i').style.width, progShown: !document.getElementById('updProg').hidden }));
  ok('没会话在跑：下载（卡内进度条走到100%）→ 调installUpdate → 副行写「正在换包」、按钮「正在重开…」', () => { assert.strictEqual(done.dl.url, 'https://github.com/x/UED-WorkBuddy-0.1.26-universal.dmg'); assert.strictEqual(done.w, '100%'); assert.strictEqual(done.progShown, true); assert.strictEqual(done.inst.file, '/Users/me/.uw-desktop/updates/x.dmg'); assert.strictEqual(done.inst.force, false); assert.ok(/重开/.test(done.go)); assert.ok(/换包/.test(done.sub)); assert.strictEqual(done.later, true); });
  const icAnim = await page.evaluate(() => { const b = document.getElementById('updBar'); b.hidden = false; b.classList.add('busy'); const a = getComputedStyle(document.querySelector('#updBar .upd-ic')).animationName; b.classList.remove('busy'); return a; });
  ok('下载中：左边那个下载图标静止不闪（吉吉2026-09-17要的）', () => assert.strictEqual(icAnim, 'none'));
  await page.evaluate(() => { UP.busy = false; showUpdBar(UP.info); });
  await page.click('#updLater'); await wait(50);
  const later = await page.evaluate(() => ({ hidden: document.getElementById('updBar').hidden, skip: S.settings.skipVersion }));
  ok('「这次先不更」：条收起，记住跳过这一版', () => { assert.strictEqual(later.hidden, true); assert.strictEqual(later.skip, '0.1.26'); });
  await page.evaluate(() => checkUpdate(false)); await wait(60);
  const stillHidden = await page.evaluate(() => document.getElementById('updBar').hidden);
  ok('跳过的版本自动检查不再弹', () => assert.strictEqual(stillHidden, true));
  await page.evaluate(() => { window.__upd = { ok: false, error: 'GitHub回了403' }; return checkUpdate(true); }); await wait(60);
  const failToast = await page.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.textContent).join('|'));
  ok('手动检查失败：提示没查到与原因', () => assert.ok(/没查到：GitHub回了403/.test(failToast), failToast));

  /* ── 资料库 / 技能与规范 ── */
  await page.click('.nav[data-nav="libs"]'); await wait(300);
  const kb1 = await page.evaluate(() => ({ shown: !document.getElementById('viewKb').hidden, work: document.getElementById('viewWork').hidden, rows: document.querySelectorAll('#kbMain tr.row').length, side: [...document.querySelectorAll('#kbSide .kb-i span:first-child')].map(x => x.textContent), n1: document.getElementById('navLibsN').textContent, n2: document.getElementById('navSkillsN').textContent, on: document.querySelector('.nav.on').dataset.nav }));
  ok('点侧栏「资料库」：两栏视图出现，表里6个库，左栏6库 + 「我添加的资料」，侧栏数字6 / 17', () => { assert.strictEqual(kb1.shown, true); assert.strictEqual(kb1.rows, 6); assert.strictEqual(kb1.side.length, 7); assert.strictEqual(kb1.n1, '6'); assert.strictEqual(kb1.n2, '17'); assert.strictEqual(kb1.on, 'libs'); });
  await page.click('#kbSide .kb-i[data-lib="1"]'); await wait(200);
  const biz = await page.evaluate(() => ({ h: document.querySelector('#kbMain h2').textContent.trim(), rows: document.querySelectorAll('#kbMain tr.row').length, cnt: document.querySelector('#kbMain .cnt').textContent }));
  ok('打开「MIC业务知识库」：211份全列出来', () => { assert.ok(biz.h.startsWith('MIC业务知识库')); assert.strictEqual(biz.rows, 211); assert.strictEqual(biz.cnt, '211 / 211份'); });
  await page.type('#kbQ', '询盘'); await wait(150);
  const filt = await page.evaluate(() => ({ rows: document.querySelectorAll('#kbMain tr.row').length, focus: document.activeElement && document.activeElement.id, val: document.getElementById('kbQ').value }));
  ok('搜「询盘」：过滤生效、输入框不丢焦点', () => { assert.ok(filt.rows > 0 && filt.rows < 211, String(filt.rows)); assert.strictEqual(filt.focus, 'kbQ'); assert.strictEqual(filt.val, '询盘'); });
  await page.click('#kbMain tr.row'); await wait(250);
  const doc = await page.evaluate(() => ({ md: !!document.querySelector('#kbMain .md'), h: document.querySelectorAll('#kbMain .md h1, #kbMain .md h2, #kbMain .md h3').length, back: !!document.getElementById('kbBack'), copy: document.querySelector('#kbMain [data-copy]').dataset.copy }));
  ok('点一份文档：Markdown渲染出标题、有返回、有「复制给Claude」', () => { assert.strictEqual(doc.md, true); assert.ok(doc.h > 0); assert.strictEqual(doc.back, true); assert.ok(doc.copy.startsWith('先读这份文档再动手：/')); });
  await page.click('#kbMain [data-copy]'); await wait(50);
  const copied = await page.evaluate(() => window.__copied);
  ok('复制给Claude：剪贴板里是绝对路径那句话', () => assert.ok(/^先读这份文档再动手：\/.*\.md$/.test(copied), copied));
  await page.click('#kbBack'); await wait(100);
  await page.click('#kbSide .kb-i[data-lib="0"]'); await wait(200);
  const comps1 = await page.evaluate(() => ({ rows: document.querySelectorAll('#kbMain table tbody tr').length, tabs: [...document.querySelectorAll('#kbTabs button')].map(b => b.textContent) }));
  ok('飞鹊组件库：Web端108个组件成表，三个tab', () => { assert.strictEqual(comps1.rows, 108); assert.deepStrictEqual(comps1.tabs, ['Web端108', '移动端76', '图标295']); });
  await page.click('#kbTabs button[data-tab="ico"]'); await wait(200);
  const ico = await page.evaluate(() => ({ n: document.querySelectorAll('#kbMain .kb-icons button').length, img: document.querySelector('#kbMain .kb-icons img').getAttribute('src') }));
  ok('图标tab：295个图标格，图从随包icons目录读', () => { assert.strictEqual(ico.n, 295); assert.ok(ico.img.startsWith('../packs/feique/icons/')); });
  await page.click('#kbSide .kb-i[data-lib="3"]'); await wait(200);
  const vis = await page.evaluate(() => ({ sw: document.querySelectorAll('#kbMain .kb-sw button').length, first: document.querySelector('#kbMain .kb-sw .h').textContent }));
  ok('视觉与交付规范：34个颜色色卡', () => { assert.strictEqual(vis.sw, 34); assert.ok(/^#/.test(vis.first)); });
  await page.click('#kbTabs button[data-tab="type"]'); await wait(150);
  const typ = await page.evaluate(() => ({ fs: [...document.querySelectorAll('#kbMain .kb-fs .row b')].map(b => b.textContent), sp: document.querySelectorAll('#kbMain .kb-scale')[0].children.length }));
  ok('字号与间距tab：阶梯12–36九档、间距八档', () => { assert.deepStrictEqual(typ.fs, ['12px', '14px', '16px', '18px', '20px', '22px', '24px', '32px', '36px']); assert.strictEqual(typ.sp, 8); });
  await page.screenshot({ path: path.join(require('os').tmpdir(), 'uw-ui-shot-kb.png') });
  await page.click('.nav[data-nav="skills"]'); await wait(200);
  const sk = await page.evaluate(() => ({ groups: document.querySelectorAll('#kbMain .kb-grp').length, rows: document.querySelectorAll('#kbMain .kb-srow').length, missing: document.querySelectorAll('#kbMain .kb-srow .code').length && [...document.querySelectorAll('#kbMain .kb-srow .code')].filter(c => /没有/.test(c.textContent)).length, side: document.querySelectorAll('#kbSide .kb-i').length }));
  ok('技能与规范：17项全部列出、没有「包里没有这份」、左栏17项', () => { assert.strictEqual(sk.rows, 17); assert.strictEqual(sk.missing, 0); assert.strictEqual(sk.side, 17); assert.ok(sk.groups >= 4); });
  await page.click('#kbMain .kb-srow'); await wait(250);
  const skd = await page.evaluate(() => ({ h1: (document.querySelector('#kbMain .md h1') || {}).textContent, fm: !!document.querySelector('#kbMain .md .fm'), on: (document.querySelector('#kbSide .kb-i.on') || {}).textContent }));
  ok('点一项技能：全文渲染出来（frontmatter折成小块、有一级标题），左栏对应项高亮', () => { assert.ok(skd.h1 && skd.h1.includes('MIC-交互'), skd.h1); assert.strictEqual(skd.fm, true); assert.strictEqual(skd.on, '交互判断与业务规则'); });
  await page.screenshot({ path: path.join(require('os').tmpdir(), 'uw-ui-shot-skill.png') });
  /* ── 可添加：粘贴一段文字当资料，再删掉 ── */
  await page.click('.nav[data-nav="libs"]'); await wait(200);
  const hasAdd = await page.evaluate(() => ({ libs: !!document.querySelector('#kbSide .kb-add[data-add="doc"]'), code: !document.querySelector('#kbMain .code') }));
  ok('资料库标题旁有 +；技能代号不再用会撞车的 .code类', () => { assert.strictEqual(hasAdd.libs, true); assert.strictEqual(hasAdd.code, true); });
  await page.click('#kbSide .kb-add[data-add="doc"]'); await wait(120);
  await page.click('#kaMode button[data-mode="text"]'); await page.type('#kaName', '询盘频控规则'); await page.type('#kaText', '每个买家每天最多20条。'); await page.type('#kaSummary', '2026-09 生效');
  await page.click('#kaSave'); await wait(400);
  const added = await page.evaluate(() => ({ req: window.__kbAdded, modal: document.getElementById('modalKbAdd').hidden, view: KB.view, rows: document.querySelectorAll('#kbMain tr.row').length, nm: (document.querySelector('#kbMain tr.row .nm') || {}).textContent, side: (document.querySelector('#kbSide button[data-mine] .n') || {}).textContent, n1: document.getElementById('navLibsN').textContent }));
  ok('添加资料（粘贴文字）：发kbAdd、弹窗关、跳到「我添加的资料」列出一行、侧栏计数1、资料库数字变7', () => { assert.strictEqual(added.req.kind, 'doc'); assert.strictEqual(added.req.title, '询盘频控规则'); assert.strictEqual(added.req.text.trim(), '每个买家每天最多20条。'); assert.strictEqual(added.modal, true); assert.strictEqual(added.view, 'mine'); assert.strictEqual(added.rows, 1); assert.strictEqual(added.nm, '询盘频控规则'); assert.strictEqual(added.side, '1'); assert.strictEqual(added.n1, '7'); });
  await page.click('#kbMain tr.row'); await wait(200);
  const userDoc = await page.evaluate(() => ({ h1: (document.querySelector('#kbMain .md h1') || {}).textContent, rm: !!document.querySelector('#kbMain .kb-doc [data-rm]') }));
  ok('打开自己加的那份：正文渲染、有「删除」', () => { assert.strictEqual(userDoc.h1, '询盘频控规则'); assert.strictEqual(userDoc.rm, true); });
  await page.click('#kbMain .kb-doc [data-rm]'); await wait(300);
  const afterRm = await page.evaluate(() => ({ items: kbGroup('我添加的资料').items.length, empty: !!document.querySelector('#kbMain .kb-empty') }));
  ok('删除：条目没了，回到「还没有添加过」的空态', () => { assert.strictEqual(afterRm.items, 0); assert.strictEqual(afterRm.empty, true); });
  /* 「给个网址就能加进资料库」（吉吉 2026-09-17：内网上的规范越来越多，给 URL 就该能认） */
  await page.evaluate(() => openKbAdd("doc")); await wait(150);
  const kaModes = await page.evaluate(() => [...document.querySelectorAll('#kaMode button')].map(b => b.textContent));
  ok('添加资料有三种来源：选文件 / 网页链接 / 粘贴文字', () => assert.deepStrictEqual(kaModes, ['选一个文件', '网页链接', '粘贴文字']));
  const kaRows = await page.evaluate(() => {
    document.querySelector('#kaMode button[data-mode="url"]').click();
    return { url: !document.getElementById('kaUrlRow').hidden, file: document.getElementById('kaFileRow').hidden, text: document.getElementById('kaTextRow').hidden };
  });
  ok('切到「网页链接」：只露网址那一行，另外两行收起来', () => assert.deepStrictEqual(kaRows, { url: true, file: true, text: true }));
  await page.evaluate(() => { window.__kbAdded = null; document.getElementById('kaSave').click(); }); await wait(150);
  const kaEmpty = await page.evaluate(() => ({ added: window.__kbAdded, toast: [...document.querySelectorAll('.toast')].map(t => t.textContent).join('|') }));
  ok('网址空着点添加：不发出去，提示先贴网址', () => { assert.strictEqual(kaEmpty.added, null); assert.ok(/网址/.test(kaEmpty.toast), kaEmpty.toast); });
  await page.evaluate(() => { document.getElementById('kaUrl').value = 'https://wiki.example.com/规范'; document.getElementById('kaSave').click(); }); await wait(300);
  const kaUrl = await page.evaluate(() => window.__kbAdded);
  ok('填了网址点添加：把url交给主进程去抓（名称留空由网页标题兜底）', () => { assert.strictEqual(kaUrl.url, 'https://wiki.example.com/规范'); assert.strictEqual(kaUrl.kind, 'doc'); assert.strictEqual(kaUrl.path, null); assert.strictEqual(kaUrl.text, null); });
  await page.evaluate(() => { document.getElementById('modalKbAdd').hidden = true; });
  await page.click('.nav[data-nav="skills"]'); await wait(150);
  const skAdd = await page.evaluate(() => !!document.querySelector('#kbSide .kb-add[data-add="skill"]'));
  ok('技能与规范标题旁也有 +', () => assert.strictEqual(skAdd, true));
  /* 回工作区继续下面的收尾测试 */
  await page.evaluate(() => { S.view = 'work'; document.getElementById('viewKb').hidden = true; document.getElementById('viewWork').hidden = false; });

  /* ── 透明度数值框 ＋ 飞鹊图标替换 ── */
  c = await at('.card[data-k="3"]'); await page.mouse.click(c.x, c.y); await wait(200);
  await page.evaluate(() => { window.__ops = []; const n = document.querySelector('#editPanel [data-opn]'); n.value = '60'; n.dispatchEvent(new Event('change')); }); await wait(500);
  const op60 = await page.evaluate(() => ({ ops: window.__ops, range: document.querySelector('#editPanel .ep-range').value, live: (function () { const f = document.getElementById('preview'); return f.contentDocument ? getComputedStyle(f.contentDocument.querySelector('.card[data-k="3"]')).opacity : null; })() }));
  ok('透明度数值框填60：滑条跟到60、写opacity:0.6', () => { assert.strictEqual(op60.range, '60'); const o = op60.ops[op60.ops.length - 1].ops[0]; assert.deepStrictEqual(o.set, { opacity: '0.6' }); });
  await page.evaluate(() => { window.__ops = []; const n = document.querySelector('#editPanel [data-opn]'); n.value = '100'; n.dispatchEvent(new Event('change')); }); await wait(500);
  const op100 = await page.evaluate(() => window.__ops[window.__ops.length - 1].ops[0].set);
  ok('填回100：去掉opacity内联（不留opacity:1垃圾）', () => assert.deepStrictEqual(op100, { opacity: null }));
  /* 点图标里的路径 → 选中的是整个 svg；面板认出 search */
  const ir = await frame().evaluate(() => { const p = document.querySelector('#icowrap svg path'); const r = p.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const irr = await page.evaluate(() => { const f = document.getElementById('preview'); const r = f.getBoundingClientRect(); return { l: r.left, t: r.top, s: r.width / f.offsetWidth }; });
  await page.mouse.click(irr.l + ir.x * irr.s, irr.t + ir.y * irr.s); await wait(400);
  const ico1 = await page.evaluate(() => ({ tag: ED.info && ED.info.tag, sec: !!document.querySelector('#editPanel .ep-icon'), t: (document.querySelector('#editPanel .ep-icon .ep-t small') || {}).textContent, grid: document.querySelectorAll('#editPanel .ep-icgrid button').length, on: (document.querySelector('#editPanel .ep-icgrid button.on') || { dataset: {} }).dataset.ic, first: document.querySelector('#editPanel .ep-icgrid button').dataset.ic }));
  ok('点图标里的路径：选中的是整个svg，面板认出「飞鹊search」，295个UI图标 + 18个品牌与认证标都在格子里、search排第一且高亮，没有那两句注释', () => { assert.strictEqual(ico1.tag, 'svg'); assert.strictEqual(ico1.sec, true); assert.ok(/飞鹊「search」/.test(ico1.t), ico1.t); assert.strictEqual(ico1.grid, 295 + 18); assert.strictEqual(ico1.on, 'search'); assert.strictEqual(ico1.first, 'search'); });
  const brandCells = await page.evaluate(() => ({ n: document.querySelectorAll('#editPanel .ep-icgrid button.br').length, grp: (document.querySelector('#editPanel .ep-icgrid .ep-icg') || {}).textContent, src: (document.querySelector('#editPanel .ep-icgrid button.br img') || {}).getAttribute('src') }));
  ok('品牌与认证那18个单独成一组（认证标svg.bmark那种原来一个都选不到 · 吉吉2026-09-17）', () => { assert.strictEqual(brandCells.n, 18); assert.ok(/品牌与认证/.test(brandCells.grp), brandCells.grp); assert.ok(/packs\/feique\/brand\//.test(brandCells.src), brandCells.src); });
  await page.evaluate(() => { const g = document.querySelector('#editPanel .ep-icgrid'); g.scrollTop = g.scrollHeight; }); await wait(300);
  await page.screenshot({ path: path.join(require('os').tmpdir(), 'uw-brand-shot.png'), clip: { x: 1220, y: 180, width: 280, height: 420 } });
  await page.evaluate(() => { document.querySelector('#editPanel .ep-icgrid').scrollTop = 0; });
  const byUse = await page.evaluate(() => { IC.q = '附件'; const g = document.querySelector('#editPanel .ep-icgrid'); g.innerHTML = iconGrid(); const names = [...g.querySelectorAll('button[data-ic]')].map(b => b.dataset.ic); IC.q = ''; g.innerHTML = iconGrid(); return names; });
  ok('按用途搜得到：搜「附件」第一个就是attachment（原来只按文件名搜，中文一个都搜不到）', () => { assert.strictEqual(byUse[0], 'attachment', JSON.stringify(byUse.slice(0, 5))); });
  const byUse2 = await page.evaluate(() => { IC.q = '聊天'; const g = document.querySelector('#editPanel .ep-icgrid'); g.innerHTML = iconGrid(); const n = [...g.querySelectorAll('button[data-ic]')].map(b => b.dataset.ic); IC.q = ''; g.innerHTML = iconGrid(); return n; });
  ok('搜「聊天」找得到tm（飞鹊把聊天图标叫tm＝Trade Manager，只按文件名一辈子搜不到）', () => { assert.ok(byUse2.includes('tm'), JSON.stringify(byUse2.slice(0, 5))); });
  const polish = await page.evaluate(() => { const g = document.querySelector('#editPanel .ep-icgrid'); const gs = getComputedStyle(g); const n = document.querySelector('#editPanel .ep-quad input') || document.querySelector('#editPanel input[type=number]'); const t = document.querySelector('#editPanel .ep-icon .ep-t'); return { note: !!document.querySelector('#editPanel .ep-icn'), gridH: gs.height, gridOverflow: gs.overflowY, spin: n ? getComputedStyle(n, '::-webkit-inner-spin-button').webkitAppearance || getComputedStyle(n, '::-webkit-inner-spin-button').appearance : 'none', tWrap: getComputedStyle(t).whiteSpace, tH: t.getBoundingClientRect().height, ph: [...document.styleSheets].flatMap(ss => { try { return [...ss.cssRules]; } catch (e) { return []; } }).some(r => /::placeholder/.test(r.selectorText || '') && /ellipsis/.test(r.style && r.style.textOverflow) && /\.ep input/.test(r.selectorText)) ? 'ellipsis' : 'clip' }; });   // Chrome 对 ::placeholder 的 getComputedStyle 一律回 clip，只能查样式表里有没有这条规则
  ok('面板走查：没有注释行、图标格固高224可滚、数字框没有原生上下箭头、小节标题单行不竖排、占位文案省略号', () => { assert.strictEqual(polish.note, false); assert.strictEqual(polish.gridH, '224px'); assert.strictEqual(polish.gridOverflow, 'auto'); assert.ok(polish.spin === 'none' || polish.spin === 'textfield', polish.spin); assert.strictEqual(polish.tWrap, 'nowrap'); assert.ok(polish.tH < 24, String(polish.tH)); assert.strictEqual(polish.ph, 'ellipsis'); });
  await page.type('#editPanel [data-icq]', 'personal'); await wait(150);
  const ico2 = await page.evaluate(() => ({ n: document.querySelectorAll('#editPanel .ep-icgrid button').length, focus: document.activeElement && document.activeElement.hasAttribute('data-icq') }));
  ok('搜「personal」：格子缩小、输入框不丢焦点', () => { assert.ok(ico2.n > 0 && ico2.n < 295, String(ico2.n)); assert.strictEqual(ico2.focus, true); });
  await page.evaluate(() => { window.__ops = []; });
  await page.click('#editPanel .ep-icgrid button[data-ic="personal"]'); await wait(400);
  const swap = await page.evaluate(() => window.__ops[window.__ops.length - 1].ops[0]);
  ok('点「personal」：replace op换成personal的svg，接住原来的width/height/class/style，fill跟原来一样用currentColor', () => {
    assert.strictEqual(swap.op, 'replace'); assert.strictEqual(swap.tag, 'svg'); assert.ok(/data-fq-icon="personal"/.test(swap.html));
    assert.ok(/ class="ico"/.test(swap.html) && / style="color:#555"/.test(swap.html) && / width="16"/.test(swap.html), swap.html.slice(0, 200));
    assert.ok(/fill="currentColor"/.test(swap.html) && !/fill="#222222"/.test(swap.html), swap.html);
    assert.ok(!/M(11\.6\d|11\.5)\d* 10\.5/.test(swap.html), '还是search的路径');
    assert.ok(!/data-uw-i/.test(swap.html), '把探针编号写进文件了 —— 源码会重号，之后一改就报「元素对不上」');
  });
  const quiet = await page.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.textContent));
  ok('换图标不弹提示：图标当场就变了，再用一行字复述一遍是噪音，连点几个还会堆一摞（吉吉2026-09-17）', () => assert.deepStrictEqual(quiet.filter(t => /图标/.test(t)), []));
  await wait(600);

  /* ── 描边：两个控件互相牵着，面板不能显示旧值（吉吉 2026-09-17 报的「描边去不掉」）── */
  c = await at('.card[data-k="1"]'); await page.mouse.click(c.x, c.y); await wait(200);
  const bd0 = await page.evaluate(() => ({ sel: document.querySelector('#editPanel select[data-border]').value, none: document.querySelector('#editPanel .ep-sw button[data-prop="border-color"].none').classList.contains('on') }));
  ok('选中没描边的卡片：描边下拉＝无、描边色那行「无描边」亮着', () => { assert.strictEqual(bd0.sel, '0'); assert.strictEqual(bd0.none, true); });
  await page.evaluate(() => { window.__ops = []; });
  await page.click('#editPanel .ep-sw button[data-prop="border-color"][data-v="#DAE0E6"]'); await wait(500);
  const bd1 = await page.evaluate(() => ({ sel: document.querySelector('#editPanel select[data-border]').value, hex: document.querySelector('#editPanel .ep-sw input[data-hex="border-color"]').value, set: window.__ops[0].ops[0].set, live: (function () { const f = document.getElementById('preview'); return getComputedStyle(f.contentDocument.querySelector('.card[data-k="1"]')).borderTopWidth; })() }));
  ok('点描边色：描边真的加上了1px，下拉同步跳到1px（原来还停在「无」，再选「无」浏览器不发change，描边就去不掉）', () => { assert.strictEqual(bd1.set['border-color'], '#DAE0E6'); assert.strictEqual(bd1.set['border-width'], '1px'); assert.strictEqual(bd1.live, '1px'); assert.strictEqual(bd1.sel, '1'); assert.strictEqual(bd1.hex, '#DAE0E6'); });
  await page.evaluate(() => { window.__ops = []; });
  await page.select('#editPanel select[data-border]', '0'); await wait(500);
  const bd2 = await page.evaluate(() => ({ set: window.__ops[0].ops[0].set, live: getComputedStyle(document.getElementById('preview').contentDocument.querySelector('.card[data-k="1"]')).borderTopWidth, none: document.querySelector('#editPanel .ep-sw button[data-prop="border-color"].none').classList.contains('on'), hex: document.querySelector('#editPanel .ep-sw input[data-hex="border-color"]').value }));
  ok('下拉选「无」：描边真的没了，描边色那行退回「无描边」', () => { assert.strictEqual(bd2.live, '0px'); assert.strictEqual(bd2.set['border-style'], null); assert.strictEqual(bd2.none, true); assert.strictEqual(bd2.hex, ''); });
  await page.evaluate(() => { window.__ops = []; });
  await page.click('#editPanel .ep-sw button[data-prop="border-color"][data-v="#E64545"]'); await wait(400);
  await page.click('#editPanel .ep-sw button[data-prop="border-color"].none'); await wait(500);
  const bd3 = await page.evaluate(() => ({ set: window.__ops[window.__ops.length - 1].ops[0].set, live: getComputedStyle(document.getElementById('preview').contentDocument.querySelector('.card[data-k="1"]')).borderTopWidth, sel: document.querySelector('#editPanel select[data-border]').value }));
  ok('点「无描边」那格：一步去掉描边，宽度归零、style与颜色的内联一起撤掉', () => { assert.strictEqual(bd3.live, '0px'); assert.strictEqual(bd3.set['border-width'], '0'); assert.strictEqual(bd3.set['border-style'], null); assert.strictEqual(bd3.set['border-color'], null); assert.strictEqual(bd3.sel, '0'); });

  /* ── 图标改颜色：fill 写死在 path 上时，光写 color 是没反应的（吉吉 2026-09-17 报的第一条）── */
  c = await at('#icohard svg'); await page.mouse.click(c.x, c.y); await wait(400);
  const ih0 = await page.evaluate(() => ({ tag: ED.info && ED.info.tag, hard: ED.info && ED.info.svg && !ED.info.svg.usesCurrentColor, hex: (document.querySelector('#editPanel input[data-hex="color"]') || {}).value, fs: !!document.querySelector('#editPanel select[data-prop="font-size"]'), t: [...document.querySelectorAll('#editPanel .ep-t')].map(e => e.textContent.trim().split(' ')[0]) }));
  ok('选中写死颜色的图标：面板显示的是图标真正的墨色 #222222（不是继承来的文字色），不再给字号/字重/对齐', () => { assert.strictEqual(ih0.tag, 'svg'); assert.strictEqual(ih0.hard, true); assert.strictEqual(ih0.hex, '#222222'); assert.strictEqual(ih0.fs, false); assert.ok(ih0.t.includes('颜色'), ih0.t.join('/')); });
  await page.evaluate(() => { window.__ops = []; });
  await page.click('#editPanel .ep-sw button[data-prop="color"][data-v="#E64545"]'); await wait(500);
  const ih1 = await page.evaluate(() => window.__ops[window.__ops.length - 1].ops[0]);
  ok('点红色：不是光写一条没用的 color，而是把写死的 fill="#222222" 就地换成 currentColor 再写 color:#E64545', () => {
    assert.strictEqual(ih1.op, 'replace'); assert.strictEqual(ih1.tag, 'svg');
    assert.ok(!/fill="#222222"/.test(ih1.html), ih1.html.slice(0, 160));
    assert.strictEqual((ih1.html.match(/fill="currentColor"/g) || []).length, 2, ih1.html.slice(0, 160));
    assert.ok(/ style="color:#E64545"/.test(ih1.html), ih1.html.slice(0, 160));
    assert.ok(/ fill="none"/.test(ih1.html) && / width="24"/.test(ih1.html), '原来的 fill="none" 与尺寸要留着');
  });

  /* ── 响应式断点档（吉吉 2026-09-17 要的 MIC 节点）── */
  const wsel = await page.evaluate(() => ({
    groups: [...document.querySelectorAll('#widthSel optgroup')].map(g => g.label),
    web: [...document.querySelectorAll('#widthSel optgroup[label="Web端"] option')].map(o => o.value),
    mob: [...document.querySelectorAll('#widthSel optgroup[label="移动端"] option')].map(o => o.value),
    first: document.querySelector('#widthSel option').value,
    label1366: [...document.querySelectorAll('#widthSel option')].find(o => o.value === '1366').textContent,
  }));
  ok('宽度档按飞鹊响应式规范分两组：Web端1920/1440/1366/1280/1024/768、移动端375，第一项仍是自适应，档位上标着该断点的内容区宽度', () => {
    assert.deepStrictEqual(wsel.groups, ['Web端', '移动端']);
    assert.deepStrictEqual(wsel.web, ['1920', '1440', '1366', '1280', '1024', '768']);
    assert.deepStrictEqual(wsel.mob, ['375']);
    assert.strictEqual(wsel.first, 'auto');
    assert.ok(/内容区 1326/.test(wsel.label1366), wsel.label1366);
  });
  await page.select('#widthSel', '1366'); await wait(200);
  const bp = await page.evaluate(() => ({ w: document.getElementById('fitBox').style.width, cls: document.getElementById('frameWrap').className, gd: !document.getElementById('guides').hidden, l: document.querySelector('#guides .gl').style.left, r: document.querySelector('#guides .gr').style.left, t: document.querySelector('#guides b').textContent, iw: document.getElementById('preview').getBoundingClientRect().width > 0 }));
  ok('选1366：画布按1366渲染，内容区参考线画在规范的1326上（两边各让20）', () => { assert.strictEqual(bp.w, '1366px'); assert.ok(/fixed/.test(bp.cls), bp.cls); assert.strictEqual(bp.gd, true); assert.strictEqual(bp.l, '20px'); assert.strictEqual(bp.r, '1346px'); assert.strictEqual(bp.t, '内容区1326'); });
  await page.select('#widthSel', '1920'); await wait(200);
  const bp19 = await page.evaluate(() => ({ w: document.getElementById('fitBox').style.width, gd: !document.getElementById('guides').hidden, l: document.querySelector('#guides .gl').style.left, r: document.querySelector('#guides .gr').style.left, t: document.querySelector('#guides b').textContent }));
  ok('1920档也画参考线：规范是「≥1440同档、内容区1440」，所以两边各让240（吉吉2026-09-17确认要画）', () => { assert.strictEqual(bp19.w, '1920px'); assert.strictEqual(bp19.gd, true); assert.strictEqual(bp19.l, '240px'); assert.strictEqual(bp19.r, '1680px'); assert.strictEqual(bp19.t, '内容区1440'); });
  await page.select('#widthSel', '1366'); await wait(200);
  await page.click('#btnGuide'); await wait(120);
  const gdOff = await page.evaluate(() => document.getElementById('guides').hidden);
  ok('参考线可以关掉', () => assert.strictEqual(gdOff, true));
  await page.click('#btnGuide'); await wait(120);
  await page.select('#widthSel', '375'); await wait(200);
  const mob = await page.evaluate(() => ({ w: document.getElementById('fitBox').style.width, h: document.getElementById('fitBox').style.height, cls: document.getElementById('frameWrap').className, gd: document.getElementById('guides').hidden }));
  ok('选移动端375：画布375×812一台机器的样子，不画内容区参考线（WAP没有这条规范值）', () => { assert.strictEqual(mob.w, '375px'); assert.strictEqual(mob.h, '812px'); assert.ok(/mob/.test(mob.cls), mob.cls); assert.strictEqual(mob.gd, true); });
  await page.select('#widthSel', 'auto'); await wait(200);
  const bk = await page.evaluate(() => ({ cls: document.getElementById('frameWrap').className, gd: document.getElementById('guides').hidden }));
  ok('回自适应：定宽那套外观和参考线都撤掉', () => { assert.ok(!/fixed|mob/.test(bk.cls), bk.cls); assert.strictEqual(bk.gd, true); });

  /* ── 宽度模式 ＋ 透明度数值居中（吉吉 2026-09-17）── */
  c = await at('.card[data-k="2"]'); await page.mouse.click(c.x, c.y); await wait(200);
  const wm0 = await page.evaluate(() => ({ modes: [...document.querySelectorAll('#editPanel .ep-seg button[data-prop="__wmode"]')].map(b => b.textContent), on: (document.querySelector('#editPanel .ep-seg button[data-prop="__wmode"].on') || {}).textContent, align: getComputedStyle(document.querySelector('#editPanel .ep-opn')).textAlign }));
  ok('尺寸区有「自动 / 撑满 / 固定」三档，卡片没写内联宽时停在「自动」；透明度数值框居中', () => { assert.deepStrictEqual(wm0.modes, ['自动', '撑满', '固定']); assert.strictEqual(wm0.on, '自动'); assert.strictEqual(wm0.align, 'center'); });
  await page.evaluate(() => { window.__ops = []; });
  await page.click('#editPanel .ep-seg button[data-prop="__wmode"][data-v="fill"]'); await wait(500);
  const wm1 = await page.evaluate(() => ({ set: window.__ops[window.__ops.length - 1].ops[0].set, live: getComputedStyle(document.getElementById('preview').contentDocument.querySelector('.card[data-k="2"]')).flexGrow }));
  ok('点「撑满」：父级是横排flex，写的是flex:1而不是没用的width:100%', () => { assert.strictEqual(wm1.set.flex, '1 1 auto'); assert.strictEqual(wm1.set.width, null); assert.strictEqual(wm1.live, '1'); });
  await page.evaluate(() => { window.__ops = []; });
  await page.click('#editPanel .ep-seg button[data-prop="__wmode"][data-v="fix"]'); await wait(500);
  const wm2 = await page.evaluate(() => window.__ops[window.__ops.length - 1].ops[0].set);
  ok('点「固定」：把当前量到的宽度锁成像素，flex撤掉', () => { assert.ok(/^\d+(\.\d+)?px$/.test(wm2.width), String(wm2.width)); assert.strictEqual(wm2.flex, null); });

  /* 画布圆角会把探针画在边角的选框切掉（12px 的圆角吃掉整个直角）→ 编辑态下改直角 */
  const rad = await page.evaluate(() => {
    const box = document.getElementById('fitBox'), pane = document.getElementById('stagePreview');
    const on = getComputedStyle(box).borderTopLeftRadius;
    const was = pane.classList.contains('editing'); pane.classList.remove('editing');
    const off = getComputedStyle(box).borderTopLeftRadius;
    if (was) pane.classList.add('editing');
    return { on, off, editing: was };
  });
  ok('编辑态下画布改直角，贴边元素的选框不再被圆角切掉；退出编辑态圆角回来', () => { assert.strictEqual(rad.editing, true); assert.strictEqual(rad.on, '0px'); assert.strictEqual(rad.off, '12px'); });

  /* ── 回写 Figma（吉吉 2026-09-17：用户自己给一个 Figma URL，写进那个 page）── */
  const urls = await page.evaluate(() => ({
    good: parseFigmaUrl('https://www.figma.com/design/gcanH38jg2SMmXwrcC6FP8/飞鹊?node-id=2771-579&t=x'),
    branch: parseFigmaUrl('https://www.figma.com/design/AAAAAAAAAAAAAAAAAAAAAA/branch/BBBBBBBBBBBBBBBBBBBBBB/稿?node-id=1-2'),
    noNode: parseFigmaUrl('https://www.figma.com/design/gcanH38jg2SMmXwrcC6FP8/飞鹊'),
    notFigma: parseFigmaUrl('https://example.com/x'),
    empty: parseFigmaUrl('  '),
  }));
  ok('Figma链接解析：取到fileKey与page节点（node-id的1-2要换成1:2）；分支链接写进分支；没有node-id、不是Figma链接、空的，各自给一句人话', () => {
    assert.deepStrictEqual(urls.good, { fileKey: 'gcanH38jg2SMmXwrcC6FP8', branch: false, nodeId: '2771:579' });
    assert.strictEqual(urls.branch.fileKey, 'BBBBBBBBBBBBBBBBBBBBBB'); assert.strictEqual(urls.branch.branch, true);
    assert.ok(/node-id/.test(urls.noNode.err), urls.noNode.err);
    assert.ok(/Figma/.test(urls.notFigma.err), urls.notFigma.err);
    assert.ok(/贴进来/.test(urls.empty.err), urls.empty.err);
  });
  const tfp = await page.evaluate(() => { S.previewFile = 'index.html'; S.project.dir = '/x/p'; return toFigmaPrompt({ fileKey: 'FK', branch: false, nodeId: '9:9' }, '1440 · 内容区1440', 1440); });
  ok('回写指令把规矩写死在里面：先加载figma-use、飞鹊的用真组件实例不许画矩形、自定义块也要写、新建一版不覆盖、图层命名、跑完自检再交，还带上源文件绝对路径与宽度', () => {
    assert.ok(/figma-use/.test(tfp), '缺前置技能');
    assert.ok(/importComponentByKeyAsync/.test(tfp) && /矩形/.test(tfp), '缺真组件实例那条');
    assert.ok(/不许跳过/.test(tfp), '缺自定义块照写那条');
    assert.ok(/新建一版/.test(tfp) && /一个都不许动/.test(tfp), '缺不覆盖那条');
    assert.ok(/Frame 123/.test(tfp), '缺图层命名那条');
    assert.ok(/figma-verify-install\.js --node 9:9/.test(tfp) && /稍后验证/.test(tfp), '缺自检那条');
    assert.ok(/一块一块贴/.test(tfp) && /match:true/.test(tfp), '自检那条没说清要分块贴与怎么核对');
    assert.ok(/\/x\/p\/index\.html/.test(tfp) && /1440px宽/.test(tfp), '缺源文件路径或宽度');
    assert.ok(/FK/.test(tfp) && /9:9/.test(tfp), '缺目标文件或页面');
  });
  await page.evaluate(() => { openToFigma(); document.getElementById('tfUrl').value = 'https://www.figma.com/design/gcanH38jg2SMmXwrcC6FP8/飞鹊?node-id=2771-579'; });
  await wait(200);
  await page.screenshot({ path: path.join(require('os').tmpdir(), 'uw-tofigma-shot.png') });
  await page.evaluate(() => hide('#modalToFigma')); await wait(120);
  const tfUi = await page.evaluate(() => {
    openToFigma();
    const shown = !document.getElementById('modalToFigma').hidden;
    const opts = [...document.querySelectorAll('#tfWidth option')].map(o => o.value);
    document.getElementById('tfUrl').value = 'https://example.com/nope';
    document.getElementById('tfGo').click();
    const bad = document.getElementById('tfHint').classList.contains('bad') && !document.getElementById('modalToFigma').hidden;
    document.querySelector('[data-close="modalToFigma"]').click();
    return { shown, opts, bad, closed: document.getElementById('modalToFigma').hidden };
  });
  ok('回写弹窗：七个宽度档可挑、链接不对时当场标红且不发出去、取消能关', () => { assert.strictEqual(tfUi.shown, true); assert.deepStrictEqual(tfUi.opts, ['1920', '1440', '1366', '1280', '1024', '768', '375']); assert.strictEqual(tfUi.bad, true); assert.strictEqual(tfUi.closed, true); });

  /* 完成 → 关掉 */
  await page.click('#ebDone'); await wait(100);
  const off = await page.evaluate(() => ({ bar: document.getElementById('editBar').hidden, panel: document.getElementById('editPanel').hidden, cls: document.getElementById('stagePreview').classList.contains('editing') }));
  ok('点「完成」：工具栏面板收起', () => { assert.strictEqual(off.bar, true); assert.strictEqual(off.panel, true); assert.strictEqual(off.cls, false); });
  const cpOff = await page.evaluate(() => ({ hidden: document.getElementById('compPanel').hidden, cls: document.getElementById('stagePreview').classList.contains('comps') }));
  ok('点「完成」：组件栏也收起', () => { assert.strictEqual(cpOff.hidden, true); assert.strictEqual(cpOff.cls, false); });

  /* 截图：重新打开编辑态并选中一张卡片，看版面 */
  await page.evaluate(() => setEdit(true)); await wait(200);
  c = await at('.card[data-k="3"]'); await page.mouse.click(c.x, c.y); await wait(200);
  await page.screenshot({ path: path.join(require('os').tmpdir(), 'uw-ui-shot.png') });
  /* ── 选框搬到画布外面：手柄要能超出画布边界（吉吉 2026-09-17：「直接超出吧，不局限在页面里」）── */
  await page.evaluate(() => { S.width = 'auto'; setEdit(true); }); await wait(200);
  c = await at('.bleed'); await page.mouse.click(c.x, c.y); await wait(250);
  const outBox = await page.evaluate(() => {
    const b = document.getElementById('selBox'), fb = document.getElementById('fitBox');
    if (b.hidden) return { hidden: true };
    const br = b.getBoundingClientRect(), fr = fb.getBoundingClientRect();
    const hs = [...b.querySelectorAll('.h')].map(h => { const r = h.getBoundingClientRect(); return { l: r.left, r: r.right, out: r.left < fr.left - 0.5 || r.right > fr.right + 0.5 }; });
    return { hidden: false, inFitBox: fb.contains(b), clipped: getComputedStyle(fb).overflow, anyOut: hs.some(h => h.out), n: hs.length, boxL: br.left, fbL: fr.left };
  });
  ok('通栏元素选中：选框画在fit-box外面（fit-box是overflow:hidden，画在里面必被裁），手柄真的探出了画布边', () => {
    assert.strictEqual(outBox.hidden, false, '选框没出来');
    assert.strictEqual(outBox.inFitBox, false, '还画在会裁东西的那层里');
    assert.strictEqual(outBox.n, 6);
    assert.strictEqual(outBox.anyOut, true, `手柄没有一个探出画布：boxL=${outBox.boxL} fitBoxL=${outBox.fbL}`);
  });
  await page.screenshot({ path: path.join(require('os').tmpdir(), 'uw-handle-shot.png'), clip: { x: 690, y: 190, width: 240, height: 200 } });
  /* 拉手柄改尺寸：手柄在 iframe 外面，整段拖拽归 renderer 管 */
  const hRect = await page.evaluate(() => { const h = document.querySelector('#selBox .h.se'); const r = h.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.evaluate(() => { window.__ops = []; });
  await page.mouse.move(hRect.x, hRect.y); await page.mouse.down();
  await page.mouse.move(hRect.x + 60, hRect.y + 30, { steps: 6 }); await page.mouse.up();
  await wait(600);
  const resized = await page.evaluate(() => (window.__ops[window.__ops.length - 1] || {}).ops);
  ok('拉画布外面那个手柄：真的改到了元素尺寸，并按style op写进文件（屏幕位移要先除以缩放倍率）', () => {
    assert.ok(resized && resized[0] && resized[0].op === 'style', JSON.stringify(resized));
    assert.ok(/^\d+px$/.test(resized[0].set.width || '') || /^\d+px$/.test(resized[0].set.height || ''), JSON.stringify(resized[0].set));
  });
  await page.keyboard.press('Escape'); await wait(150);

  /* ── 双缓冲：换图标这类结构改动要重装页面，不许让人看见闪一下（吉吉 2026-09-17：要无感）── */
  const pv0 = await page.evaluate(() => ({ cur: PV.cur, on: document.querySelector('.frame-wrap iframe.on').id }));
  ok('两张画布，台上的那张才on', () => { assert.strictEqual(pv0.cur, 'preview'); assert.strictEqual(pv0.on, 'preview'); });
  await page.evaluate(PAGE => { PV.pending = document.getElementById('preview2'); document.getElementById('preview2').src = PAGE + '?second'; }, PAGE);
  await wait(900);
  const pv1 = await page.evaluate(() => ({ cur: PV.cur, on: [...document.querySelectorAll('.frame-wrap iframe.on')].map(f => f.id), pending: PV.pending, blank: document.getElementById(PV.other).src }));
  ok('后台那张装好（探针ready）→ 整帧换上台，同一时刻只有一张在显示，换下来的那张腾空', () => {
    assert.strictEqual(pv1.cur, 'preview2');
    assert.deepStrictEqual(pv1.on, ['preview2']);
    assert.strictEqual(pv1.pending, null);
    assert.ok(/about:blank/.test(pv1.blank), pv1.blank);
  });
  /* 图片填充面板：最容易错的是归一——computed 给的是 0% 0% / 50% 50% 这种百分比，
     要认回九宫格的「左上」「中」；认错了用户点一下位置会跳到别处。直接调 fillSection 验它吐的 HTML。 */
  const BLANKPX = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';   // 1×1 透明，设进 innerHTML 不发请求
  const fillImg = await page.evaluate(PX => {
    const d = document.createElement('div');
    d.innerHTML = fillSection({ i: 1, alt: '示例图', rect: { w: 120, h: 60 }, fill: { kind: 'img', src: 'images/a.png', shown: PX, fit: 'cover', pos: '0% 0%', nw: 40, nh: 20 } });
    return { fits: [...d.querySelectorAll('[data-fillfit] option')].map(o => o.textContent), fitSel: d.querySelector('[data-fillfit]').value,
      pos9: d.querySelectorAll('[data-fillpos]').length, posOn: (d.querySelector('[data-fillpos].on') || {}).dataset.fillpos,
      pv: !!d.querySelector('[data-fillpv]'), posOff: !!d.querySelector('.fill-pos.off'), alt: !!d.querySelector('[data-attr="alt"]'), t: d.querySelector('.ep-t').textContent };
  }, BLANKPX);
  ok('图片面板：三档摆法 + 九宫格九个格子，0% 0% 认回左上，原图尺寸显示出来', () => {
    assert.deepStrictEqual(fillImg.fits, ['撑满', '完整显示', '拉伸']);
    assert.strictEqual(fillImg.fitSel, 'cover');
    assert.strictEqual(fillImg.pos9, 9);
    assert.strictEqual(fillImg.posOn, 'left top', '0% 0% 应该认成左上');
    assert.ok(fillImg.pv, '没有缩略图，就等于看不见换成什么样');
    assert.ok(!fillImg.posOff, '撑满时位置该可点');
    assert.ok(fillImg.alt, '<img> 要有alt那一行');
    assert.ok(/原图40×20/.test(fillImg.t), fillImg.t);
  });
  const fillBg = await page.evaluate(PX => {
    const d = document.createElement('div');
    d.innerHTML = fillSection({ i: 2, rect: { w: 200, h: 80 }, fill: { kind: 'bg', src: 'images/b.png', shown: PX, fit: 'auto', pos: '50% 50%', nw: 0, nh: 0 } });
    return { fits: [...d.querySelectorAll('[data-fillfit] option')].map(o => o.textContent), fitSel: d.querySelector('[data-fillfit]').value,
      posOn: (d.querySelector('[data-fillpos].on') || {}).dataset.fillpos, alt: !!d.querySelector('[data-attr="alt"]'), t: d.querySelector('.ep-t').textContent };
  }, BLANKPX);
  ok('背景图面板：第三档是「原样」不是「拉伸」，50% 认回中间，背景图没有alt那一行', () => {
    assert.deepStrictEqual(fillBg.fits, ['撑满', '完整显示', '原样']);
    assert.strictEqual(fillBg.fitSel, 'auto', 'background-size:auto不该被归成撑满骗人');
    assert.strictEqual(fillBg.posOn, 'center center');
    assert.ok(!fillBg.alt, '背景图没有alt可填');
    assert.ok(/背景图/.test(fillBg.t), fillBg.t);
  });
  const fillStretch = await page.evaluate(PX => {
    const d = document.createElement('div');
    d.innerHTML = fillSection({ i: 3, rect: { w: 10, h: 10 }, fill: { kind: 'img', src: 'a.png', shown: PX, fit: 'fill', pos: '50% 50%', nw: 1, nh: 1 } });
    return !!d.querySelector('.fill-pos.off');
  }, BLANKPX);
  ok('拉伸档：位置那行压暗不可点（拉满了框，选裁哪块没有意义）', () => assert.ok(fillStretch));

  /* 图不在选中的这层身上时，面板要把它露出来 —— 不露，人就只能自己去猜该选哪一层，
     误往这层加背景图还会被那张图完全盖住（看着像「传了图没反应」）。吉吉 2026-09-17 换 VO 头像时踩的。 */
  const fillUnder = await page.evaluate(PX => {
    const d = document.createElement('div');
    const IN = { i: 9, tag: 'img', label: 'img', how: 'under', alt: '', classes: [], rect: { w: 60, h: 60 },
      fill: { kind: 'img', src: 'images/av.png', shown: PX, fit: 'cover', pos: '50% 50%', nw: 60, nh: 60 } };
    d.innerHTML = fillSection({ i: 5, rect: { w: 60, h: 60 }, fill: null, innerFill: IN }, IN);
    return { t: d.querySelector('.ep-t').textContent, go: (d.querySelector('[data-sel]') || {}).dataset && d.querySelector('[data-sel]').dataset.sel,
      pv: !!d.querySelector('[data-fillpv]'), alt: !!d.querySelector('[data-attr="alt"]') };
  }, BLANKPX);
  ok('压在下面那张图：面板照样给缩略图和换图入口，标题说清「压在这层下面」，并给一个「选中它」指向那张图的编号', () => {
    assert.ok(/压在这层下面/.test(fillUnder.t), fillUnder.t);
    assert.ok(/&lt;img&gt;|<img>/.test(fillUnder.t) || /img/.test(fillUnder.t), fillUnder.t);
    assert.strictEqual(fillUnder.go, '9', '「选中它」要指向底下那张图的编号，不是选中的这层');
    assert.ok(fillUnder.pv, '没有缩略图＝还是看不见那张图');
    assert.ok(!fillUnder.alt, '改的不是选中的这层，alt 那行别在这儿给（要改点「选中它」）');
  });
  const fillInner = await page.evaluate(PX => {
    const d = document.createElement('div');
    const IN = { i: 7, tag: 'img', label: 'img', how: 'inner', alt: '', classes: [], rect: { w: 120, h: 60 },
      fill: { kind: 'img', src: 'images/c.png', shown: PX, fit: 'cover', pos: '50% 50%', nw: 0, nh: 0 } };
    d.innerHTML = fillSection({ i: 6, rect: { w: 120, h: 60 }, fill: null, innerFill: IN }, IN);
    return d.querySelector('.ep-t').textContent;
  }, BLANKPX);
  ok('图在里面那层：标题说的是「在里面那层」，不是「压在这层下面」（两种情形别混着说）', () => {
    assert.ok(/在里面那层/.test(fillInner) && !/压在这层下面/.test(fillInner), fillInner);
  });
  /* 🔴 这条是吉吉真正踩的那一步：这层已经被一张图盖着了，就别再给「＋加一张背景图」——
        加了也看不见（写进去了，压在那张图底下），人只会以为「传了图没反应」。 */
  const addBox = await page.evaluate(PX => {
    const base = { i: 5, label: 'span.avatar-txt', tag: 'span', classes: [], rect: { w: 60, h: 60 }, cs: getComputedStyle(document.body), inline: {}, path: [], fill: null, bgMask: null };
    const IN = { i: 9, tag: 'img', label: 'img', how: 'under', alt: '', classes: [], rect: { w: 60, h: 60 },
      fill: { kind: 'img', src: 'images/av.png', shown: PX, fit: 'cover', pos: '50% 50%', nw: 60, nh: 60 } };
    const P = document.getElementById('editPanel'), keep = ED.info;
    const read = () => ({ add: !!P.querySelector('[data-filladd]'), pv: !!P.querySelector('[data-fillpv]') });
    ED.info = { ...base, innerFill: IN }; renderPanel(); const withImg = read();
    ED.info = { ...base, innerFill: null }; renderPanel(); const plain = read();
    ED.info = keep; renderPanel();
    return { withImg, plain };
  }, BLANKPX);
  ok('已经被一张图盖着的这层：不再给「＋加一张背景图」（加了也看不见），改成直接换那张图', () => {
    assert.ok(!addBox.withImg.add, '还留着「加一张背景图」——这正是吉吉误点、然后以为「传了图没反应」的那个入口');
    assert.ok(addBox.withImg.pv, '该给的换图缩略图没给');
  });
  ok('真的没有图的元素：「＋加一张背景图」照旧在（别把好的入口一起砍了）', () => {
    assert.ok(addBox.plain.add, '普通元素的加背景图入口不该被这次改动带走');
    assert.ok(!addBox.plain.pv);
  });

  /* 源码写相对路径（干净、可交付），DOM 上补一份绝对地址 —— 带 <base href="外站"> 的克隆页里，
     相对地址会被解析到那个站上去，图当场看不见。previewAbs 就是 fillSrcRel 的逆运算。 */
  const pabs = await page.evaluate(() => {
    const keep = S.previewFile, kp = S.project;
    S.previewFile = 'pages/detail.html'; S.project = { id: '我的 项目/A' };
    const r = { 同级: previewAbs('images/a.png'), 上一级: previewAbs('../images/b.png'),
      已经是绝对的: previewAbs('uwproj://p/x/y.png'), 线上的: previewAbs('https://x.com/a.png'),
      协议相对: previewAbs('//cdn/a.png'), 空的: previewAbs('') };
    S.previewFile = keep; S.project = kp; return r;
  });
  ok('previewAbs：相对路径换成预览态绝对地址，项目名和目录都按 URL 规矩编码', () => {
    assert.strictEqual(pabs.同级, 'uwproj://p/%E6%88%91%E7%9A%84%20%E9%A1%B9%E7%9B%AE%2FA/pages/images/a.png');
    assert.strictEqual(pabs.上一级, 'uwproj://p/%E6%88%91%E7%9A%84%20%E9%A1%B9%E7%9B%AE%2FA/images/b.png');
  });
  ok('previewAbs：已经是绝对地址 / 线上地址 / 协议相对 / 空的，一律不碰（返回 null）', () => {
    assert.strictEqual(pabs.已经是绝对的, null); assert.strictEqual(pabs.线上的, null);
    assert.strictEqual(pabs.协议相对, null); assert.strictEqual(pabs.空的, null);
  });
  /* 右键选被盖住的层：在真 iframe 里右键一个嵌得深的元素 → 渲染层弹「这个位置下面有」→ 点最底那层 → 选中的换成它 */
  await page.evaluate(() => { if (!ED.on) document.getElementById('btnEdit').click(); }); await wait(300);
  const liveFrame = async () => { const src = await page.evaluate(() => curFrame().src); return page.frames().find(f => f.url() === src); };   // 双缓冲换台后台上那张是 PAGE?second，不能按 PAGE 写死
  const ctxPt = await (await liveFrame()).evaluate(() => { const el = document.querySelector('.card span, .card b, .card p, .card') || document.body.firstElementChild; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, tag: el.tagName.toLowerCase() }; });
  await (await liveFrame()).evaluate(p => { const el = document.elementFromPoint(p.x, p.y); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 2 })); }, ctxPt);
  await wait(200);
  const menu = await page.evaluate(() => { const m = document.getElementById('stackMenu'); if (!m) return null; const r = m.getBoundingClientRect(); return { n: m.querySelectorAll('button[data-i]').length, labels: [...m.querySelectorAll('button[data-i] b')].map(b => b.textContent), inView: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, title: m.querySelector('.sm-t').textContent }; });
  ok('右键：弹出「这个位置下面有」菜单，至少两层，最底是body，整个菜单在窗口内', () => { assert.ok(menu, '没弹菜单'); assert.ok(menu.n >= 2, String(menu.n)); assert.strictEqual(menu.labels[menu.labels.length - 1], 'body'); assert.ok(menu.inView); assert.ok(/下面有/.test(menu.title)); });
  await page.click('#stackMenu button[data-i]:last-child'); await wait(250);
  const picked = await page.evaluate(() => ({ tag: ED.info && ED.info.tag, menuGone: !document.getElementById('stackMenu') }));
  ok('点最底那层：选中的变成body（被盖住的层选到了），菜单关掉', () => { assert.strictEqual(picked.tag, 'body'); assert.strictEqual(picked.menuGone, true); });
  await (await liveFrame()).evaluate(p => { const el = document.elementFromPoint(p.x, p.y); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 2 })); }, ctxPt);
  await wait(200); await page.keyboard.press('Escape'); await wait(80);
  const escGone = await page.evaluate(() => !document.getElementById('stackMenu'));
  ok('Esc关掉右键菜单', () => assert.strictEqual(escGone, true));
  /* 填充三层：底色 → 图片 → 蒙版。先验工具函数，再在真 iframe 里给一个只有底色的块加图、叠蒙版 */
  const fx = await page.evaluate(() => ({
    parts: maskParts('rgba(0, 0, 0, 0.4)'), partsNone: maskParts(null),
    rgba: maskRgba('#E64545', 40), bad: maskRgba('zzz', 40),
    layers: bgLayers('images/a.png', 'rgba(0,0,0,0.4)'), plain: bgLayers('images/a.png', null),
    rel: (() => { const pf = S.previewFile, pid = S.project && S.project.id; S.previewFile = 'pages/a.html'; const r = fillSrcRel({ src: `uwproj://p/${encodeURIComponent(pid)}/images/x.png` }); S.previewFile = pf; return r; })(),
  }));
  ok('蒙版换算：rgba↔hex+浓度、分层背景拼接、绝对地址换回相对页面的路径', () => {
    assert.deepStrictEqual(fx.parts, { hex: '#000000', alpha: 40 }); assert.strictEqual(fx.partsNone, null);
    assert.strictEqual(fx.rgba, 'rgba(230,69,69,0.4)'); assert.strictEqual(fx.bad, null);
    assert.strictEqual(fx.layers, "linear-gradient(rgba(0,0,0,0.4), rgba(0,0,0,0.4)), url('images/a.png')"); assert.strictEqual(fx.plain, "url('images/a.png')");
    assert.strictEqual(fx.rel, '../images/x.png');
  });
  const mkUI = await page.evaluate(PX => {
    const d = document.createElement('div'); d.innerHTML = fillSection({ i: 9, rect: { w: 10, h: 10 }, fill: { kind: 'bg', src: 'a.png', shown: PX, fit: 'cover', pos: '50% 50%', mask: 'rgba(0,0,0,0.4)', nw: 0, nh: 0 } });
    const d2 = document.createElement('div'); d2.innerHTML = fillSection({ i: 9, rect: { w: 10, h: 10 }, fill: { kind: 'bg', src: 'a.png', shown: PX, fit: 'cover', pos: '50% 50%', mask: null, nw: 0, nh: 0 } });
    const d3 = document.createElement('div'); d3.innerHTML = fillSection({ i: 9, alt: '', rect: { w: 10, h: 10 }, fill: { kind: 'img', src: 'a.png', shown: PX, fit: 'cover', pos: '50% 50%', nw: 1, nh: 1 } });
    return { on: (d.querySelector('[data-fillmask].on') || {}).dataset.fillmask, hex: d.querySelector('[data-fillmaskhex]').value, alpha: d.querySelector('[data-fillmaskalpha]').value, off: !!d.querySelector('.fill-alpha.off'),
      noneOn: d2.querySelector('[data-fillmask].on').classList.contains('none'), off2: !!d2.querySelector('.fill-alpha.off'), img2bg: !!d3.querySelector('[data-fill2bg]'), imgNoMask: !d3.querySelector('[data-fillmask]') };
  }, BLANKPX);
  ok('蒙版行：有蒙版时黑色块高亮、hex/浓度回填、浓度可拖；没蒙版时「无」高亮、浓度压暗；<img> 给「转成背景图」而不是蒙版', () => {
    assert.strictEqual(mkUI.on, '#000000'); assert.strictEqual(mkUI.hex, '#000000'); assert.strictEqual(mkUI.alpha, '40'); assert.strictEqual(mkUI.off, false);   // 有蒙版时回填它自己的 40
    assert.strictEqual(mkUI.noneOn, true); assert.strictEqual(mkUI.off2, true); assert.strictEqual(mkUI.img2bg, true); assert.strictEqual(mkUI.imgNoMask, true);
  });
  /* 真 iframe：选一个只有底色的 .card → 面板有「加一张背景图」→ 加上 → 面板刷成图片段 → 点黑色蒙版 → 页面上真叠了一层 */
  const lf2 = async () => { const src = await page.evaluate(() => curFrame().src); return page.frames().find(f => f.url() === src); };
  const cardI = await (await lf2()).evaluate(() => document.querySelector('.card').getAttribute('data-uw-i'));
  await page.evaluate(i => probe({ __uwEditCmd: 'select', i: +i }), cardI); await wait(250);
  const addEntry = await page.evaluate(() => ({ fill: ED.info && ED.info.fill, has: !!document.querySelector('#editPanel [data-filladd]'), noPv: !document.querySelector('#editPanel [data-fillpv]'), maskRow: !!document.querySelector('#editPanel [data-fillmask]'), title: (([...document.querySelectorAll('#editPanel .ep-sec')].find(x => /^填充/.test((x.querySelector('.ep-t') || {}).textContent || '')) || document.createElement('div')).querySelector('.ep-t small') || {}).textContent }));
  ok('只有底色的块：填充段有「蒙版」两行和「加一张背景图」，没有图片段，标题说明「底色 → 蒙版」', () => { assert.strictEqual(addEntry.fill, null); assert.strictEqual(addEntry.has, true); assert.strictEqual(addEntry.noPv, true); assert.strictEqual(addEntry.maskRow, true); assert.ok(/底色 → 蒙版/.test(addEntry.title || ''), addEntry.title); });
  /* 底色上叠 20% 黑：没有图，只写一层渐变 */
  await page.click('#editPanel [data-fillmask="#000000"]'); await wait(300);
  const tinted = await (await lf2()).evaluate(i => getComputedStyle(document.querySelector(`[data-uw-i="${i}"]`)).backgroundImage, cardI);
  const tintOp = await page.evaluate(() => { const o = window.__ops[window.__ops.length - 1]; return o && o.ops && o.ops[0]; });
  ok('底色上叠20% 黑：写回只有一层linear-gradient（没有url），页面上computed也是', () => {
    assert.strictEqual(tintOp && tintOp.set['background-image'], 'linear-gradient(rgba(0,0,0,0.2), rgba(0,0,0,0.2))', JSON.stringify(tintOp && tintOp.set));
    assert.ok(/^linear-gradient\(rgba\(0, 0, 0, 0\.2\), rgba\(0, 0, 0, 0\.2\)\)$/.test(tinted), tinted);
  });
  /* 再加一张图：蒙版要留在图上面 */
  await page.evaluate(PX => fillAddBgRel(PX), BLANKPX); await wait(500);
  const afterAdd = await page.evaluate(() => ({ kind: ED.info && ED.info.fill && ED.info.fill.kind, mask: ED.info && ED.info.fill && ED.info.fill.mask, pv: !!document.querySelector('#editPanel [data-fillpv]'), alpha: (document.querySelector('#editPanel [data-fillmaskalpha]') || {}).value, title: (([...document.querySelectorAll('#editPanel .ep-sec')].find(x => /^填充/.test((x.querySelector('.ep-t') || {}).textContent || '')) || document.createElement('div')).querySelector('.ep-t small') || {}).textContent }));
  ok('加上背景图：先叠好的蒙版留在图上（rgba 0.2）、面板刷出图片段、浓度回填20、标题变「底色 → 图片 → 蒙版」', () => { assert.strictEqual(afterAdd.kind, 'bg'); assert.strictEqual(afterAdd.mask, 'rgba(0,0,0,0.2)'); assert.ok(afterAdd.pv); assert.strictEqual(afterAdd.alpha, '20'); assert.ok(/图片 → 蒙版/.test(afterAdd.title || ''), afterAdd.title); });
  const layered = await (await lf2()).evaluate(i => getComputedStyle(document.querySelector(`[data-uw-i="${i}"]`)).backgroundImage, cardI);
  ok('页面上：渐变在前、图在后', () => assert.ok(/^linear-gradient\(rgba\(0, 0, 0, 0\.2\), rgba\(0, 0, 0, 0\.2\)\), url\(/.test(layered), layered.slice(0, 120)));
  await page.click('#editPanel [data-fillmask=""]'); await wait(300);
  const unmasked = await (await lf2()).evaluate(i => getComputedStyle(document.querySelector(`[data-uw-i="${i}"]`)).backgroundImage, cardI);
  ok('点「无」：蒙版去掉，只剩图', () => assert.ok(/^url\(/.test(unmasked), unmasked.slice(0, 80)));
  /* ⌥ 滚轮缩放：按住 ⌥ 时两张画布都得让路（双缓冲后轮换上台，只放行 #preview 就坏一半时间） */
  const altPE = await page.evaluate(() => { document.body.classList.add('altzoom'); const r = ['preview', 'preview2'].map(id => getComputedStyle(document.getElementById(id)).pointerEvents); document.body.classList.remove('altzoom'); return r; });
  ok('按住 ⌥：两张预览画布都pointer-events:none，滚轮能到外层缩放（不只 #preview）', () => assert.deepStrictEqual(altPE, ['none', 'none']));
  const altOff = await page.evaluate(() => ['preview', 'preview2'].map(id => getComputedStyle(document.getElementById(id)).pointerEvents));
  ok('松开 ⌥：两张画布恢复可点', () => assert.ok(altOff.every(v => v !== 'none'), JSON.stringify(altOff)));
  /* ── 流程控制台（第二个窗口）那一半 ────────────────────────────
     这边只验「主窗口该怎么反应」：开关窗口、收到跳转指令换页换态、展示模式腾画布。
     控制台窗口自己的界面在 flow-ui.e2e.js 里验。 */
  await page.evaluate(() => { window.__flow = []; window.__flowAt = []; window.__flowOpen = false; if (window.ED && window.ED.on) setEdit(false); });
  ok('预览栏上有「流程」按钮', async () => {});
  const hasBtn = await page.evaluate(() => !!document.getElementById('btnFlow'));
  ok('预览栏上有「流程」按钮（入口不在编辑工具栏里——那是编辑态才有的东西）', () => assert.strictEqual(hasBtn, true));

  await page.click('#btnFlow'); await wait(200);
  const opened = await page.evaluate(() => { const b = document.getElementById('btnFlow'); const cs = getComputedStyle(b); return { calls: window.__flow.slice(), on: b.classList.contains('on'), bg: cs.backgroundColor, color: cs.color }; });
  ok('点「流程」：请主进程开控制台窗口，按钮进高亮态', () => { assert.deepStrictEqual(opened.calls, ['open']); assert.strictEqual(opened.on, true); });
  /* 🔴 只验 class 加上了没用：app.css 里本来根本没有 .btn.sm.on 这条规则，
     class 加得好好的、屏幕上一点变化都没有（2026-09-17 真机截图才看出来）。要验算出来的样子。 */
  ok('「流程」按钮的高亮真的画出来了（验计算样式，不是验 class 加上没）', () => {
    assert.notStrictEqual(opened.bg, 'rgba(0, 0, 0, 0)', '背景还是透明的，说明 .btn.sm.on 这条样式不存在');
    assert.strictEqual(opened.color, 'rgb(0, 113, 227)', '文字没变成强调蓝：' + opened.color);
  });

  await page.evaluate(() => { window.__flowOpen = true; });
  await page.click('#btnFlow'); await wait(200);
  const closed = await page.evaluate(() => ({ calls: window.__flow.slice(), on: document.getElementById('btnFlow').classList.contains('on') }));
  ok('再点一次：关掉窗口，高亮也撤（同一个按钮开关，不另设关闭入口）', () => { assert.deepStrictEqual(closed.calls, ['open', 'close']); assert.strictEqual(closed.on, false); });

  /* 控制台发「去某一页的某个态」。换页走 loadPreview，换态走探针命令——两条路不一样，各验一次 */
  await page.evaluate(() => {
    window.__flowOpen = false; window.__probeMsgs = [];
    const fr = document.getElementById(PV.cur);
    if (fr && fr.contentWindow) { const o = fr.contentWindow.postMessage.bind(fr.contentWindow); fr.contentWindow.postMessage = (m, t) => { window.__probeMsgs.push(m); return o(m, t); }; }
    FLOW.on = true; FLOW.state = 'default';
  });
  await page.evaluate(() => { probe({ __uwEditCmd: 'state', key: 'empty' }); });   // 先确认这条命令本身发得出去
  await wait(120);
  await page.evaluate(() => { window.__probeMsgs = []; FLOW.state = 'default'; S.previewFile = 'index.html'; });
  await page.evaluate(() => { const h = window.__onFlowGoto; if (h) h({ rel: 'index.html', state: 'guest' }); });
  await wait(200);
  const sameFile = await page.evaluate(() => ({ msgs: window.__probeMsgs.slice(), rel: S.previewFile, st: FLOW.state }));
  ok('控制台点同一页的另一个态：只给探针发换类命令，不重装页面（重装会白一下，走查时很刺眼）', () => {
    assert.strictEqual(sameFile.rel, 'index.html');
    assert.strictEqual(sameFile.st, 'guest');
    assert.ok(sameFile.msgs.some(m => m && m.__uwEditCmd === 'state' && m.key === 'guest'), JSON.stringify(sameFile.msgs));
  });

  await page.evaluate(() => { const h = window.__onFlowGoto; if (h) h({ rel: 'detail.html', state: 'error' }); });
  await wait(200);
  const otherFile = await page.evaluate(() => ({ rel: S.previewFile, st: FLOW.state, opt: [...document.getElementById('previewFile').options].map(o => o.value), val: document.getElementById('previewFile').value }));
  ok('控制台点另一页：当前文件跟着换，下拉里没有的自动补上（不然改动会按新页的编号写进旧文件）', () => {
    assert.strictEqual(otherFile.rel, 'detail.html');
    assert.strictEqual(otherFile.st, 'error');
    assert.ok(otherFile.opt.includes('detail.html'), JSON.stringify(otherFile.opt));
    assert.strictEqual(otherFile.val, 'detail.html');
  });

  await page.evaluate(() => { const h = window.__onFlowGoto; if (h) h({ show: true }); });
  await wait(200);
  const showOn = await page.evaluate(() => ({ canvas: document.querySelector('.wk-body').classList.contains('canvas'), ed: ED.on }));
  ok('展示模式：主窗口进「只看画布」，编辑态自动退掉（给外部看的时候不该有选框和工具栏）', () => { assert.strictEqual(showOn.canvas, true); assert.strictEqual(showOn.ed, false); });
  await page.evaluate(() => { const h = window.__onFlowGoto; if (h) h({ show: false }); });
  await wait(200);
  const showOff = await page.evaluate(() => document.querySelector('.wk-body').classList.contains('canvas'));
  ok('退出展示模式：对话区回来', () => assert.strictEqual(showOff, false));

  /* 🔴 吉吉 2026-09-18 报的 bug：「我点了流程里面一些节点，但 UW 客户端此时在首页，
     那就不会跳转过去」。原来这里一句 `if (!S.project) return` 就把指令吞了 ——
     屏幕上什么都不发生，也没有任何提示。**「点了没反应」比「报个错」糟得多。** */
  await page.evaluate(() => { setView('home'); });
  await wait(150);
  const atHome = await page.evaluate(() => ({ view: S.view, proj: !!S.project }));
  await page.evaluate(() => { const h = window.__onFlowGoto; if (h) h({ id: 'p', rel: 'index.html', state: 'guest' }); });
  await wait(400);
  const jumped = await page.evaluate(() => ({ view: S.view, id: S.project && S.project.id, rel: S.previewFile, st: FLOW.state }));
  ok('🔴 主窗口停在首页时点流程里的节点：它自己把项目打开再跳过去（不是一声不吭地什么都不做）', () => {
    assert.strictEqual(atHome.proj, false, '前提没摆好：本来就该是「首页、没开项目」');
    assert.strictEqual(jumped.view, 'work', '还停在 ' + jumped.view);
    assert.strictEqual(jumped.id, 'p');
    assert.strictEqual(jumped.rel, 'index.html');
    assert.strictEqual(jumped.st, 'guest');
  });
  /* 开着**别的**项目时也要切过去——只判「有没有开项目」会漏掉这一半 */
  await page.evaluate(() => { S.project = { id: 'other', name: '别的项目', files: [] }; S.previewFile = null; });
  await page.evaluate(() => { const h = window.__onFlowGoto; if (h) h({ id: 'p', rel: 'detail.html', state: 'error' }); });
  await wait(400);
  const swapped = await page.evaluate(() => ({ id: S.project && S.project.id, rel: S.previewFile }));
  ok('🔴 主窗口开着别的项目时点流程里的节点：切到控制台那个项目（只判「有没有开项目」会漏掉这一半）', () => {
    assert.strictEqual(swapped.id, 'p', '还停在 ' + swapped.id);
    assert.strictEqual(swapped.rel, 'detail.html');
  });

  /* 🔴 版本号：吉吉 2026-09-18「每次更新完，同事也不知道自己是什么版本」。
     同事报「这个功能我这儿没有」时，第一件要问的就是版本号。
     值必须来自 boot（主进程的 app.getVersion()），写死在页面里的迟早会忘了改。 */
  const ver = await page.evaluate(() => {
    const el = document.getElementById('appVer');
    return { txt: el ? el.textContent.trim() : null, shown: !!(el && el.offsetParent !== null) };
  });
  ok('🔴 侧边栏一直显示版本号，值取自主进程不是写死的', () => {
    assert.strictEqual(ver.txt, 'v0.1.25', '显示的是「' + ver.txt + '」（mock 的 boot 给的是 0.1.25）');
    assert.strictEqual(ver.shown, true, '元素在但没显示出来');
  });

  /* 🔴 这条是回归门，不是功能门。2026-09-17 加流程控制台时栽过：
     顶层一句 `uw.onFlowClosed(...)` 在桥上没这个方法时抛异常，它**后面**所有 const 全留在 TDZ，
     报错却指向 setEdit 里的 `CP`，完全指不到真凶。所以：桥上少方法，界面可以少功能，不能整体半死。 */
  const page2 = await browser.newPage();
  await page2.setBypassCSP(true);
  const err2 = []; page2.on('pageerror', e => err2.push(e.message));
  await page2.evaluateOnNewDocument(() => {
    if (window.parent !== window) return;
    const noop = () => () => {};
    window.uw = { boot: async () => ({ settings: {}, projects: [], engine: {} }), listProjects: async () => [], listFiles: async () => [],
      onRunEvent: noop(), onFilesChanged: noop(), onAltKey: noop(), onFigmaChanged: noop(),
      checkUpdate: async () => ({ has: false }), kbIndex: async () => ({ ok: true, groups: [] }), kbFeique: async () => ({ ok: true }) };
  });
  await page2.goto('file://' + path.join(DESK, 'renderer', 'index.html'), { waitUntil: 'domcontentloaded' });
  await wait(600);
  const survived = await page2.evaluate(() => { try { setEdit(false); return 'ok'; } catch (e) { return e.message; } });
  ok('桥上少了 flow 那几个方法时，渲染层照常起得来（顶层抛一次会让它后面所有 const 留在 TDZ）', () => {
    assert.strictEqual(survived, 'ok', '渲染层被一句顶层异常打断了：' + survived + ' ／ ' + err2.join(' | '));
  });
  await page2.close();

  /* uwproj: 在普通 Chrome 里是未知协议，loadPreview 走到它必报「external protocol blocked」；Electron 里它是注册过的，不算 */
  ok('全程没有页面报错（uwproj: 协议在Chrome里的拦截除外）', () => assert.deepStrictEqual(errors.filter(e => !/external protocol|ERR_UNKNOWN_URL_SCHEME/.test(e)), []));
  console.log(`\n${pass}项通过 · 截图 ${path.join(require('os').tmpdir(), 'uw-ui-shot.png')}`);
  await browser.close();
})().catch(e => { console.error('💥', e); process.exit(1); });
