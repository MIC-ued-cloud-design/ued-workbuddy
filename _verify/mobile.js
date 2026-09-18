/* 移动端布局探针
 *
 * 本项目出过 6 次「探针报绿、肉眼看红」，每次都是量错了对象，所以这里的每一项
 * 都量真实几何（getBoundingClientRect / scrollWidth），不查 CSS 声明值；
 * 元素先按「祖先链全可见」过滤，隐藏元素几何全 0 会把重叠检查全判成过。
 *
 * 跑法：node mobile.js out
 * 截图落在 out/m-*.png，探针数字和截图两道都要看。
 */
const puppeteer = require('/Users/wanglixiang/.claude/skills/mic-fullstack/scripts/online-reach/node_modules/puppeteer-core');
const OUT = process.argv[2] || 'out';
const URL = 'file:///Users/wanglixiang/Desktop/UED%20workbuddy/index.html';

const DEVICES = [
  { name:'iphone14',  w:390, h:844, dpr:3 },   // 最主流
  { name:'android',   w:360, h:780, dpr:3 },   // 常见安卓
  { name:'iphonese',  w:320, h:568, dpr:2 },   // 现役最窄
];

/* 🔴 manifest 只在 http(s) 下挂载（file:// 读它会被 CORS 拒、留下控制台报错，
   而这一页有「双击本地文件也能开、0 报错」这条承诺）。所以「添加到主屏幕」这一档
   必须起一个本地 http 服务来验，用 file:// 验只会验出一个假失败。 */
const http = require('http'), fs = require('fs'), pathm = require('path');
const ROOT = pathm.join(__dirname, '..');
const MIME = {'.html':'text/html','.js':'text/javascript','.json':'application/manifest+json',
               '.png':'image/png','.svg':'image/svg+xml'};
const server = http.createServer((req, res) => {
  const f = pathm.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(f, (e, d) => {
    if(e){ res.writeHead(404); res.end(); return; }
    res.writeHead(200, {'Content-Type': MIME[pathm.extname(f)] || 'application/octet-stream'});
    res.end(d);
  });
});

let fails = [], warns = [];
const bad  = m => { fails.push(m); console.log('❌ ' + m); };
const warn = m => { warns.push(m); console.log('⚠️  ' + m); };
const ok   = m => console.log('✅ ' + m);

(async () => {
  const PORT = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
  const HTTP_URL = 'http://127.0.0.1:' + PORT + '/index.html';

  const b = await puppeteer.launch({
    executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless:'new', args:['--no-sandbox','--allow-file-access-from-files'],
  });

  for(const d of DEVICES){
    console.log('\n════ ' + d.name + ' ' + d.w + '×' + d.h + ' ════');
    const p = await b.newPage();
    await p.setViewport({width:d.w, height:d.h, deviceScaleFactor:1, isMobile:true, hasTouch:true});
    const errs = [];
    p.on('pageerror', e => errs.push('pageerror: ' + e.message));
    p.on('console', m => { if(m.type()==='error') errs.push('console: ' + m.text()); });
    await p.goto(URL, {waitUntil:'networkidle0'});
    await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));

    // 共用工具注入页面
    await p.evaluate(() => {
      window.__vis = el => {
        for(let n = el; n && n !== document.documentElement; n = n.parentElement){
          const s = getComputedStyle(n);
          if(s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
        }
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      // 找真正把文档撑宽的元素：右边界超出视口、且自己不是被父级裁掉的
      window.__overflowers = () => {
        const W = window.innerWidth, out = [];
        document.querySelectorAll('*').forEach(el => {
          if(!window.__vis(el)) return;
          const r = el.getBoundingClientRect();
          if(r.right > W + 1 || r.left < -1){
            const s = getComputedStyle(el);
            // 自己或祖先在横向滚动的容器里，不算撑宽文档
            let inScroller = false;
            for(let n = el.parentElement; n; n = n.parentElement){
              const ss = getComputedStyle(n);
              if(ss.overflowX === 'auto' || ss.overflowX === 'scroll'){ inScroller = true; break; }
            }
            if(inScroller || s.position === 'fixed') return;
            out.push({ tag:el.tagName.toLowerCase(), cls:el.className.toString().slice(0,44),
                       left:Math.round(r.left), right:Math.round(r.right) });
          }
        });
        return out.slice(0, 6);
      };
      window.__minFont = () => {
        let min = 99, who = '';
        document.querySelectorAll('*').forEach(el => {
          if(!window.__vis(el)) return;
          if(!el.textContent || !el.textContent.trim()) return;
          if(el.children.length) return;                 // 只看真正承载文字的叶子
          const f = parseFloat(getComputedStyle(el).fontSize);
          if(f && f < min){ min = f; who = el.className.toString().slice(0,30) || el.tagName; }
        });
        return { min, who };
      };
      // 兄弟元素之间的真实重叠（行内 + 行间）
      window.__overlap = sel => {
        const els = [...document.querySelectorAll(sel)].filter(window.__vis);
        const hits = [];
        for(let i = 0; i < els.length; i++) for(let j = i + 1; j < els.length; j++){
          if(els[i].contains(els[j]) || els[j].contains(els[i])) continue;
          const a = els[i].getBoundingClientRect(), c = els[j].getBoundingClientRect();
          const ox = Math.min(a.right, c.right) - Math.max(a.left, c.left);
          const oy = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
          if(ox > 1 && oy > 1) hits.push({ a:els[i].className.toString().slice(0,26),
                                           b:els[j].className.toString().slice(0,26),
                                           ox:Math.round(ox), oy:Math.round(oy) });
        }
        return hits.slice(0, 5);
      };
      // 文字被容器裁掉（scrollWidth 超出 clientWidth）
      window.__clipped = sel => [...document.querySelectorAll(sel)].filter(window.__vis)
        .filter(el => el.scrollWidth > el.clientWidth + 1)
        .map(el => ({ cls:el.className.toString().slice(0,30),
                      txt:(el.textContent||'').trim().slice(0,26),
                      sw:el.scrollWidth, cw:el.clientWidth })).slice(0, 5);
      // 点击区尺寸
      window.__taps = sel => [...document.querySelectorAll(sel)].filter(window.__vis)
        .map(el => { const r = el.getBoundingClientRect();
                     return { cls:el.className.toString().slice(0,26),
                              w:Math.round(r.width), h:Math.round(r.height) }; });
    });

    const shot = n => p.screenshot({path:`${OUT}/m-${d.name}-${n}.png`, fullPage:false});
    const shotFull = n => p.screenshot({path:`${OUT}/m-${d.name}-${n}-full.png`, fullPage:true});
    const tag = s => `[${d.name}] ${s}`;

    const checkOverflow = async label => {
      const r = await p.evaluate(() => ({
        docW: document.documentElement.scrollWidth,
        winW: window.innerWidth,
        who: window.__overflowers(),
      }));
      if(r.docW > r.winW + 1){
        bad(tag(`${label} 横向溢出 ${r.docW}>${r.winW}：` + JSON.stringify(r.who)));
      } else ok(tag(`${label} 无横向溢出（${r.docW}=${r.winW}）`));
    };

    /* ── 1. 首页：顶栏 / 左栏收起 / 溢出 ── */
    const boot = await p.evaluate(() => {
      const top = document.querySelector('.wbm-top'), sb = document.querySelector('.sb');
      const tr = top ? top.getBoundingClientRect() : null, sr = sb.getBoundingClientRect();
      return {
        topShown: !!(tr && tr.height > 0), topH: tr ? Math.round(tr.height) : 0,
        title: (document.getElementById('wbmTitle')||{}).textContent || '',
        sbRight: Math.round(sr.right), sbW: Math.round(sr.width),
        mainW: Math.round(document.querySelector('main').getBoundingClientRect().width),
        navCount: document.querySelectorAll('.nav button').length,
        mainChars: document.querySelector('main').innerHTML.length,
        suggest: document.body.innerHTML.indexOf('提个建议') >= 0 || !!document.querySelector('.topr'),
      };
    });
    if(!boot.topShown) bad(tag('顶栏没出现'));
    else ok(tag(`顶栏 ${boot.topH}px · 标题「${boot.title}」`));
    if(boot.sbRight > 0) bad(tag(`左栏没收起：右边界 ${boot.sbRight}（应 ≤0）`));
    else ok(tag(`左栏已收起（右边界 ${boot.sbRight}）`));
    if(boot.mainW < d.w - 2) bad(tag(`主区没占满宽度：${boot.mainW} / ${d.w}`));
    else ok(tag(`主区占满 ${boot.mainW}px`));
    if(!boot.navCount || boot.mainChars < 500) bad(tag('页面没渲染出来'));
    if(boot.suggest) bad(tag('「提个建议」还在（这是个没绑事件的假按钮，两端都该删干净）'));
    else ok(tag('「提个建议」已删干净'));
    await checkOverflow('首页');
    await shot('01-home');
    await shotFull('01-home');

    /* ── 2. 抽屉开合 ── */
    await p.click('#wbmMenu');
    await new Promise(r => setTimeout(r, 380));
    const dr = await p.evaluate(() => {
      const sr = document.querySelector('.sb').getBoundingClientRect();
      const sc = document.querySelector('.wbm-scrim');
      return { left:Math.round(sr.left), w:Math.round(sr.width),
               scrimOpacity: getComputedStyle(sc).opacity,
               bodyLocked: getComputedStyle(document.body).overflow === 'hidden' };
    });
    if(dr.left < -1) bad(tag(`抽屉没滑进来：left ${dr.left}`));
    else ok(tag(`抽屉打开 left=${dr.left} 宽 ${dr.w} · 遮罩 ${dr.scrimOpacity} · 页面锁滚 ${dr.bodyLocked}`));
    const dov = await p.evaluate(() => window.__overlap('.sb .nav button, .sb .sb-card, .sb .sb-foot'));
    if(dov.length) bad(tag('抽屉内元素重叠：' + JSON.stringify(dov)));
    else ok(tag('抽屉内无重叠'));
    await shot('02-drawer');
    // 🔴 不能用 p.click('.wbm-scrim') —— 它点元素中心，而遮罩铺满全屏、中心正落在抽屉里，
    //    点下去命中的是抽屉本体。抽屉没关，后面每一次点击都被遮罩吃掉，
    //    连带报出「+ 菜单没打开」「设置弹层没打开」这些假失败（本项目第 7 次「仪器自己是 bug」）。
    //    要点真人会点的地方：抽屉右边那条露出来的空白。
    const hitRight = await p.evaluate(() => {
      const el = document.elementFromPoint(window.innerWidth - 20, Math.round(window.innerHeight / 2));
      return el ? el.className.toString() : '';
    });
    if(!/wbm-scrim/.test(hitRight)) bad(tag(`抽屉右侧空白处命中的不是遮罩，而是 ${hitRight}`));
    await p.mouse.click(d.w - 20, Math.round(d.h / 2));
    await new Promise(r => setTimeout(r, 400));
    const closed = await p.evaluate(() => ({
      right: Math.round(document.querySelector('.sb').getBoundingClientRect().right),
      cls: document.body.classList.contains('wbm-open'),
    }));
    if(closed.right > 0 || closed.cls) bad(tag(`遮罩点击没关掉抽屉（右边界 ${closed.right}）`));
    else ok(tag('遮罩点击已关闭抽屉'));

    /* ── 3. 输入控件字号（iOS 聚焦放大） ── */
    const fs = await p.evaluate(() => {
      const out = [];
      document.querySelectorAll('textarea, input[type=text], input:not([type]), select').forEach(el => {
        if(!window.__vis(el)) return;
        out.push({ cls:(el.className||el.id||el.tagName).toString().slice(0,24),
                   fs: parseFloat(getComputedStyle(el).fontSize) });
      });
      return out;
    });
    const small = fs.filter(x => x.fs < 16);
    if(small.length) bad(tag('输入控件字号 <16px（iOS 会自动放大页面）：' + JSON.stringify(small)));
    else ok(tag(`输入控件字号全 ≥16px（共 ${fs.length} 个）`));

    /* ── 4. 点击区尺寸 ── */
    const taps = await p.evaluate(() => window.__taps('.nav button, .tabs button, .pill, .send, .cbar .plus, .mic, .wbm-top .wbm-ic'));
    const tiny = taps.filter(t => t.h < 34 || t.w < 28);
    if(tiny.length) warn(tag('点击区偏小（<34px 高）：' + JSON.stringify(tiny.slice(0,5))));
    else ok(tag(`主要点击区全 ≥34px（共 ${taps.length} 个，最小 ${Math.min(...taps.map(t=>t.h))}px）`));

    /* ── 5. 场景 tab 单行横滑 ── */
    const tabs = await p.evaluate(() => {
      const box = document.querySelector('.tabs');
      const bs = [...box.querySelectorAll('button')];
      const tops = [...new Set(bs.map(x => Math.round(x.getBoundingClientRect().top)))];
      return { rows:tops.length, n:bs.length,
               scrollable: box.scrollWidth > box.clientWidth + 2,
               scrollLeft: Math.round(box.scrollLeft) };
    });
    if(tabs.rows !== 1) bad(tag(`场景 tab 折成了 ${tabs.rows} 行（应 1 行横滑）`));
    else ok(tag(`场景 tab ${tabs.n} 个单行横滑（可滑=${tabs.scrollable}）`));

    /* ── 6. + 菜单：底部抽屉 + 点击展开二级 ── */
    // 前置断言：抽屉必须是关的，否则下面点不到任何东西，报出来的失败是假的
    if(await p.evaluate(() => document.body.classList.contains('wbm-open')))
      bad(tag('进入 + 菜单检查时抽屉还开着 —— 下面的结果不可信'));
    await p.click('.cbar .plus');
    await new Promise(r => setTimeout(r, 220));
    const pp = await p.evaluate(() => {
      const el = document.querySelector('.ppop');
      if(!el) return null;
      const r = el.getBoundingClientRect();
      return { left:Math.round(r.left), right:Math.round(r.right), bottom:Math.round(r.bottom),
               W:window.innerWidth, H:window.innerHeight,
               second: [...document.querySelectorAll('.ppop2')].filter(window.__vis).length };
    });
    if(!pp) bad(tag('+ 菜单没打开'));
    else {
      if(pp.right > pp.W + 1 || pp.left < -1) bad(tag(`+ 菜单出屏：${pp.left}~${pp.right} / ${pp.W}`));
      else ok(tag(`+ 菜单贴底占满宽（${pp.left}~${pp.right}，底 ${pp.bottom}/${pp.H}）`));
      if(pp.second !== 0) bad(tag(`没点就展开了 ${pp.second} 个二级菜单（桌面版靠 hover，手机不该自动展开）`));
      else ok(tag('二级菜单默认收起'));
    }
    await shot('03-plusmenu');
    // 点一级项展开二级
    await p.evaluate(() => { const r = document.querySelector('.pitem > .row'); if(r) r.click(); });
    await new Promise(r => setTimeout(r, 220));
    const pp2 = await p.evaluate(() => {
      const opened = [...document.querySelectorAll('.ppop2')].filter(window.__vis);
      if(!opened.length) return { n:0 };
      const r = opened[0].getBoundingClientRect();
      return { n:opened.length, left:Math.round(r.left), right:Math.round(r.right), W:window.innerWidth,
               rows: opened[0].querySelectorAll('.p2row').length,
               ov: window.__overlap('.ppop2 .p2row') };
    });
    if(!pp2.n) bad(tag('点一级项没展开二级菜单（触屏没有 hover，这是最容易漏的一处）'));
    else if(pp2.right > pp2.W + 1) bad(tag(`二级菜单出屏：${pp2.left}~${pp2.right} / ${pp2.W}`));
    else if(pp2.ov.length) bad(tag('二级菜单行重叠：' + JSON.stringify(pp2.ov)));
    else ok(tag(`点击展开二级菜单 ${pp2.rows} 行，在屏内（${pp2.left}~${pp2.right}），无重叠`));
    await shot('04-submenu');
    await p.evaluate(() => document.body.click());
    await new Promise(r => setTimeout(r, 200));

    /* ── 7. 模型选择器 ── */
    await p.evaluate(() => { const b = document.querySelector('.model > button'); if(b) b.click(); });
    await new Promise(r => setTimeout(r, 220));
    const mp = await p.evaluate(() => {
      const el = document.querySelector('.mpop');
      if(!el) return null;
      const r = el.getBoundingClientRect();
      return { left:Math.round(r.left), right:Math.round(r.right), W:window.innerWidth,
               rows: el.querySelectorAll('.row').length,
               clip: window.__clipped('.mpop .row .nm > span, .mpop .rate') };
    });
    if(!mp) bad(tag('模型浮层没打开'));
    else if(mp.right > mp.W + 1) bad(tag(`模型浮层出屏：${mp.left}~${mp.right} / ${mp.W}`));
    else if(mp.clip.length) warn(tag('模型浮层文字被裁：' + JSON.stringify(mp.clip)));
    else ok(tag(`模型浮层贴底 ${mp.rows} 行在屏内（${mp.left}~${mp.right}）`));
    await shot('05-models');
    await p.evaluate(() => document.body.click());
    await new Promise(r => setTimeout(r, 200));

    /* （工作空间 2026-09-10 已删，原 7.5「归到项目」下拉那段随之去掉） */
    /* ── 8. 资料库：第二栏不占位 / 表格摊成卡片 ── */
    await p.evaluate(() => go('libs'));
    await new Promise(r => setTimeout(r, 320));
    const libs = await p.evaluate(() => {
      const c2 = document.getElementById('col2');
      const tds = [...document.querySelectorAll('.tbl tbody td')].filter(window.__vis);
      return {
        col2W: Math.round(c2.getBoundingClientRect().width),
        theadShown: [...document.querySelectorAll('.tbl thead')].filter(window.__vis).length,
        labelled: tds.filter(t => t.hasAttribute('data-label')).length,
        totalTd: tds.length,
        clipped: window.__clipped('.tbl tbody td'),
        rowsBlock: getComputedStyle(document.querySelector('.tbl tbody tr')).display,
      };
    });
    if(libs.col2W !== 0) bad(tag(`第二栏还占 ${libs.col2W}px（要量真实宽度，查 hidden 属性查不出来）`));
    else ok(tag('第二栏宽度 0，没占位'));
    if(libs.theadShown) bad(tag('表头没收起，表格没摊成卡片'));
    else if(libs.rowsBlock !== 'block') bad(tag(`表格行 display=${libs.rowsBlock}，没变卡片`));
    else if(libs.labelled !== libs.totalTd) bad(tag(`${libs.totalTd} 个单元格里只有 ${libs.labelled} 个带列名标签`));
    else if(libs.clipped.length) bad(tag('卡片里文字被裁：' + JSON.stringify(libs.clipped)));
    else ok(tag(`表格已摊成卡片：${libs.totalTd} 个单元格全带列名，0 处裁切`));
    await checkOverflow('资料库');
    await shot('06-libs');
    await shotFull('06-libs');

    /* ── 9. 进一个库 + 返回路径 ── */
    const opened2 = await p.evaluate(() => {
      const tr = document.querySelector('.tbl tbody tr');
      if(!tr) return false; tr.click(); return true;
    });
    await new Promise(r => setTimeout(r, 400));
    if(opened2){
      const lib = await p.evaluate(() => ({
        view: S.view,
        back: !!document.querySelector('.wbm-back'),
        title: (document.getElementById('wbmTitle')||{}).textContent || '',
        scrollY: Math.round(window.scrollY),
        clipped: window.__clipped('.tbl tbody td, .kv td, .iccell span, .srow .code'),
      }));
      if(lib.view !== 'lib') warn(tag('点表格行没进详情页（可能这一行不可点）'));
      else if(!lib.back) bad(tag('详情页没有返回入口 —— 手机上第二栏不显示，没返回就出不去'));
      else ok(tag(`进入「${lib.title}」，有返回入口，滚动已回顶（scrollY=${lib.scrollY}）`));
      if(lib.clipped.length) bad(tag('详情页文字被裁：' + JSON.stringify(lib.clipped)));
      await checkOverflow('资料库详情');
      await shot('07-lib');
      await shotFull('07-lib');
      const backOk = await p.evaluate(() => {
        const b = document.querySelector('.wbm-back'); if(!b) return null; b.click(); return true;
      });
      await new Promise(r => setTimeout(r, 300));
      if(backOk){
        const v = await p.evaluate(() => S.view);
        if(v !== 'libs') bad(tag('返回没回到全部资料'));
        else ok(tag('返回回到全部资料'));
      }
    }

    /* ── 10. 技能与规范 ── */
    for(const [view, label, sel] of [['skills','技能与规范','.srow']]){
      await p.evaluate(v => go(v), view);
      await new Promise(r => setTimeout(r, 300));
      const r = await p.evaluate(s => ({
        n: document.querySelectorAll(s).length,
        ov: window.__overlap(s + ' > *'),
        clip: window.__clipped(s + ' .code, ' + s + ' .nm, ' + s + ' .ds'),
      }), sel);
      if(r.ov.length) bad(tag(`${label} 行内元素重叠：` + JSON.stringify(r.ov)));
      else if(r.clip.length) bad(tag(`${label} 文字被裁：` + JSON.stringify(r.clip)));
      else ok(tag(`${label} ${r.n} 行，无重叠无裁切`));
      await checkOverflow(label);
      await shotFull('08-' + view);
    }

    /* ── 11. 设置弹层 ── */
    await p.evaluate(() => go('new'));
    await new Promise(r => setTimeout(r, 260));
    if(await p.evaluate(() => document.body.classList.contains('wbm-open')))
      bad(tag('进入设置检查时抽屉还开着 —— 下面的结果不可信'));
    await p.click('#wbmSet');
    await new Promise(r => setTimeout(r, 320));
    const dlg = await p.evaluate(() => {
      const m = document.getElementById('wbmask');
      if(!m) return null;
      const dr = m.querySelector('.wbdlg').getBoundingClientRect();
      return { left:Math.round(dr.left), right:Math.round(dr.right), h:Math.round(dr.height),
               W:window.innerWidth, H:window.innerHeight,
               fits: dr.height <= window.innerHeight + 1,
               provCols: getComputedStyle(m.querySelector('.prov')||document.body).gridTemplateColumns };
    });
    if(!dlg) warn(tag('设置弹层没打开（页面可能走的是共享代理、没有设置入口）'));
    else if(dlg.right > dlg.W + 1) bad(tag(`设置弹层出屏：${dlg.left}~${dlg.right} / ${dlg.W}`));
    else if(!dlg.fits) bad(tag(`设置弹层高 ${dlg.h} 超过屏高 ${dlg.H}`));
    else ok(tag(`设置弹层 ${dlg.left}~${dlg.right} 高 ${dlg.h}/${dlg.H} 在屏内`));
    await shot('09-settings');
    await p.evaluate(() => { if(window.wbCloseSet) window.wbCloseSet(); });
    await new Promise(r => setTimeout(r, 220));

    /* ── 11.5 回答区（含 AI 答案里的表格） ──
       真问答要密钥、file:// 下也调不到代理，所以这里只灌一段答案 HTML，
       量的是版式层：表格有没有摊成卡片、代码块和长串会不会撑破屏幕、追问框字号够不够。
       🔴 这一项验的是 CSS，不是问答链路本身 —— 问答链路要在手机上真问一次才算验过。 */
    await p.evaluate(() => {
      S.view = 'run';
      document.getElementById('main').innerHTML =
        '<div class="runwrap">' +
        '<div class="qbox"><div class="qava"></div><div class="qtx">帮我看看飞鹊移动端有没有可以直接用的通知组件</div></div>' +
        '<div class="abox"><div class="ahead"><b>WorkBuddy</b><span>查了 3 份资料</span></div>' +
        '<div class="atx"><p>移动端组件库里有两档可以直接用，区别在有没有自动布局：</p>' +
        '<table><thead><tr><th>组件名（Figma 里的真名）</th><th>状态</th><th>组件 key</th><th>要注意的地方</th></tr></thead>' +
        '<tbody>' +
        '<tr><td>badge</td><td>count</td><td><code>a1b2c3d4e5f60718293a4b5c6d7e8f9012345678</code></td>' +
        '<td>这一档带 auto-layout，数字变长会自己撑开，推荐用它</td></tr>' +
        '<tr><td>badge</td><td>number</td><td><code>0f1e2d3c4b5a69788796a5b4c3d2e1f001234567</code></td>' +
        '<td>这一档没有 auto-layout，改数字要手动调宽度</td></tr>' +
        '</tbody></table>' +
        '<h3>怎么选</h3><ul><li>消息数会变的用 count</li><li>固定角标用 number</li></ul></div>' +
        '<div class="srcs"><div class="srcs-h">参考了这些资料</div><div class="srcs-l">' +
        '<button class="srcchip">project-feique-library-page-by-page-learning.md</button>' +
        '<button class="srcchip">feique-mobile-component-catalog.json</button></div></div>' +
        '<div class="runfoot"><button class="rbtn pri">存成任务</button><button class="rbtn">重新回答</button></div>' +
        '<div class="askmore"><div class="askin"><textarea id="ta2" placeholder="接着问…"></textarea>' +
        '<button class="asksend"></button></div><div class="askhint">回车发送，Shift + 回车换行</div></div>' +
        '</div>';
    });
    await new Promise(r => setTimeout(r, 260));
    const run = await p.evaluate(() => ({
      thead: [...document.querySelectorAll('.atx thead')].filter(window.__vis).length,
      trDisp: getComputedStyle(document.querySelector('.atx tbody tr')).display,
      labelled: [...document.querySelectorAll('.atx tbody td')].every(t => t.hasAttribute('data-label')),
      clipped: window.__clipped('.atx td, .atx code, .srcchip, .qtx'),
      hint: (document.querySelector('.askhint') || {}).textContent || '',
      ta2fs: parseFloat(getComputedStyle(document.getElementById('ta2')).fontSize),
      ov: window.__overlap('.runfoot .rbtn'),
    }));
    if(run.thead) bad(tag('回答里的表格没摊成卡片（表头还在）'));
    else if(run.trDisp !== 'block') bad(tag(`回答里的表格行 display=${run.trDisp}`));
    else if(!run.labelled) bad(tag('回答里的表格单元格缺列名标签'));
    else if(run.clipped.length) bad(tag('回答区文字被裁：' + JSON.stringify(run.clipped)));
    else if(run.ov.length) bad(tag('回答区按钮重叠：' + JSON.stringify(run.ov)));
    else ok(tag('回答区版式正常：表格成卡片、40 位 key 不撑屏、按钮不重叠'));
    if(run.ta2fs < 16) bad(tag(`追问框字号 ${run.ta2fs}px < 16（iOS 会放大页面）`));
    else ok(tag(`追问框字号 ${run.ta2fs}px`));
    if(/回车/.test(run.hint)) bad(tag(`键盘提示在手机上是错的：「${run.hint}」`));
    else ok(tag(`键盘提示已换成手机上的说法：「${run.hint}」`));
    await checkOverflow('回答区');
    await shot('10-answer');
    await shotFull('10-answer');
    await p.evaluate(() => go('new'));
    await new Promise(r => setTimeout(r, 240));

    /* ── 11.8 添加到主屏幕（PWA）· 走本地 http，不走 file:// ── */
    const hp = await b.newPage();
    await hp.setViewport({width:d.w, height:d.h, isMobile:true, hasTouch:true});
    const hperrs = [];
    hp.on('pageerror', e => hperrs.push(e.message));
    hp.on('console', m => { if(m.type()==='error') hperrs.push(m.text()); });
    await hp.goto(HTTP_URL, {waitUntil:'networkidle0'});
    const pwa = await hp.evaluate(async () => {
      const link = document.querySelector('link[rel=manifest]');
      const apple = document.querySelector('link[rel=apple-touch-icon]');
      const vp = (document.querySelector('meta[name=viewport]') || {}).content || '';
      let mf = null, err = null;
      try { mf = await (await fetch(link.href)).json(); } catch(e){ err = String(e); }
      return {
        hasLink: !!link, hasApple: !!apple, apple: apple ? apple.getAttribute('href') : '',
        cover: /viewport-fit=cover/.test(vp),
        capable: !!document.querySelector('meta[name="apple-mobile-web-app-capable"][content=yes]'),
        title: (document.querySelector('meta[name="apple-mobile-web-app-title"]')||{}).content||'',
        mf, err,
      };
    });
    if(!pwa.hasLink || !pwa.hasApple) bad(tag('缺 manifest 或 apple-touch-icon'));
    else if(pwa.err) bad(tag('manifest 读不出来：' + pwa.err));
    else if(!pwa.mf || pwa.mf.display !== 'standalone') bad(tag('manifest 的 display 不是 standalone'));
    else if(!pwa.cover) bad(tag('viewport 少了 viewport-fit=cover —— 主屏幕启动时刘海区会盖住内容'));
    else if(!pwa.capable) bad(tag('少了 apple-mobile-web-app-capable'));
    else ok(tag(`主屏幕配置齐：「${pwa.mf.short_name}」· ${pwa.mf.icons.length} 个图标 · 主屏名「${pwa.title}」· ${pwa.apple}`));
    // 图标文件真的在、尺寸真的对（manifest 里写什么不算数）
    const icons = await hp.evaluate(() => Promise.all(
      ['icon-180.png','icon-192.png','icon-512.png'].map(f => new Promise(res => {
        const im = new Image();
        im.onload = () => res({f, w:im.naturalWidth, h:im.naturalHeight});
        im.onerror = () => res({f, w:0, h:0});
        im.src = f;
      }))));
    const wantSize = {'icon-180.png':180,'icon-192.png':192,'icon-512.png':512};
    const badIcon = icons.filter(i => i.w !== wantSize[i.f] || i.h !== wantSize[i.f]);
    if(badIcon.length) bad(tag('图标缺失或尺寸不对：' + JSON.stringify(badIcon)));
    else ok(tag('三个图标都在且尺寸对：' + icons.map(i => i.f + ' ' + i.w).join(' · ')));
    if(hperrs.length) bad(tag('http 打开时有报错 ' + hperrs.length + ' 条：' + hperrs.slice(0,2).join(' | ')));
    else ok(tag('http 打开 0 报错（挂了 manifest 也没多出 CORS 报错）'));
    await hp.close();

    /* 模拟刘海：真机的 env(safe-area-inset-*) 在桌面 Chrome 里恒等于 0，量不出来。
       退一步量「版面能不能扛住左右各多出 44px 的内缩」—— 这是横屏刘海的真实量级。
       🔴 这是代理指标，不等于真机验过。 */
    await p.addStyleTag({content:
      '@media (max-width:768px){.wrap,.page,.runwrap{padding-left:44px!important;padding-right:44px!important}}'});
    await new Promise(r => setTimeout(r, 220));
    await checkOverflow('模拟刘海（左右各 44px）');
    await p.evaluate(() => { const t=[...document.querySelectorAll('style')].pop(); if(t) t.remove(); });
    await new Promise(r => setTimeout(r, 180));

    /* ── 12. 最小字号 + JS 错误 ── */
    const mf = await p.evaluate(() => window.__minFont());
    if(mf.min < 12) bad(tag(`最小字号 ${mf.min}px < 12（${mf.who}）`));
    else ok(tag(`最小字号 ${mf.min}px（${mf.who}）`));

    if(errs.length) bad(tag('JS 报错 ' + errs.length + ' 条：' + errs.slice(0,3).join(' | ')));
    else ok(tag('0 个 JS 错误'));

    await p.close();
  }

  /* ── 13. 桌面版没被改坏（回归） ── */
  console.log('\n════ 桌面回归 1440×900 ════');
  const p = await b.newPage();
  await p.setViewport({width:1440, height:900});
  const derrs = [];
  p.on('pageerror', e => derrs.push(e.message));
  await p.goto(URL, {waitUntil:'networkidle0'});
  await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const desk = await p.evaluate(() => {
    const sb = document.querySelector('.sb').getBoundingClientRect();
    const top = document.querySelector('.wbm-top');
    return {
      sbLeft: Math.round(sb.left), sbW: Math.round(sb.width),
      topHidden: getComputedStyle(top).display === 'none',
      scrimHidden: getComputedStyle(document.querySelector('.wbm-scrim')).display === 'none',
      h1: parseFloat(getComputedStyle(document.querySelector('h1')).fontSize),
      cgrid: getComputedStyle(document.querySelector('.cgrid')).gridTemplateColumns.split(' ').length,
      appH: getComputedStyle(document.querySelector('.app')).height,
      theadShown: getComputedStyle(document.querySelector('main')).display,
    };
  });
  if(desk.sbLeft !== 0 || desk.sbW !== 256) bad(`桌面左栏被改坏：left ${desk.sbLeft} 宽 ${desk.sbW}（应 0 / 256）`);
  else ok(`桌面左栏原样 256px 在位`);
  if(!desk.topHidden || !desk.scrimHidden) bad('桌面版看得见移动端顶栏/遮罩');
  else ok('桌面版不显示移动端顶栏和遮罩');
  if(desk.h1 !== 56) bad(`桌面 h1 字号变了：${desk.h1}（应 56）`);
  else ok('桌面 h1 仍 56px');
  if(desk.cgrid !== 5) bad(`桌面案例区列数变了：${desk.cgrid}（应 5）`);
  else ok('桌面案例区仍 5 列');
  await p.evaluate(() => go('libs'));
  await new Promise(r => setTimeout(r, 300));
  const dlibs = await p.evaluate(() => ({
    col2W: Math.round(document.getElementById('col2').getBoundingClientRect().width),
    thead: getComputedStyle(document.querySelector('.tbl thead')).display,
    trDisp: getComputedStyle(document.querySelector('.tbl tbody tr')).display,
  }));
  if(dlibs.col2W !== 244) bad(`桌面第二栏宽度变了：${dlibs.col2W}（应 244）`);
  else if(dlibs.thead === 'none' || dlibs.trDisp === 'block') bad('桌面表格被改成了卡片');
  else ok(`桌面资料库仍是三栏 + 真表格（第二栏 ${dlibs.col2W}px）`);
  if(derrs.length) bad('桌面 JS 报错：' + derrs.slice(0,2).join(' | '));
  else ok('桌面 0 个 JS 错误');
  const dsug = await p.evaluate(() => document.body.innerHTML.indexOf('提个建议') >= 0);
  if(dsug) bad('桌面上「提个建议」还在');
  else ok('桌面上「提个建议」也删干净了');

  /* ── 13.5 桌面首页内容垂直居中 ── */
  await p.evaluate(() => go('new'));
  await new Promise(r => setTimeout(r, 260));
  /* 🔴 量的是「看得见的内容」到视口上下的距离，不是 .wrap 这个盒子的上下外边距 ——
     上移 30px 是靠给 .wrap 加 60px 底部内边距实现的，量盒子边缘会一直是对称的，
     这条检查就永远绿、也就永远测不出上移有没有生效。 */
  const UP = 30;   // 视觉重心比几何中心高多少（吉吉定的值）
  const ctr = await p.evaluate(() => {
    const m = document.querySelector('main').getBoundingClientRect();
    const w = document.querySelector('.wrap').getBoundingClientRect();
    const h1 = document.querySelector('h1').getBoundingClientRect();
    const last = document.querySelector('.cases').getBoundingClientRect();
    return { top:Math.round(h1.top - m.top), bottom:Math.round(m.bottom - last.bottom),
             left:Math.round(w.left - m.left), right:Math.round(m.right - w.right) };
  });
  const up = Math.round((ctr.bottom - ctr.top) / 2);
  /* 2026-09-10 版式拉开之后 900 高的视口里内容已经顶满（.wrap 上下 padding 40/100 之外没有富余），
     margin:auto 分不到空间、「上移 30」无从谈起。这时判据改成「上下就是 padding 本身」——
     富余空间 ≥ 40px 才量上移。 */
  const spare = await p.evaluate(() => document.querySelector('main').clientHeight - document.querySelector('.wrap').getBoundingClientRect().height);
  if(spare < 40) ok(`首页内容已占满视口（富余 ${Math.round(spare)}px），居中规则不适用（上 ${ctr.top} / 下 ${ctr.bottom}）`);
  else if(Math.abs(up - UP) > 2) bad(`首页内容不是「居中再上移 ${UP}px」：实际上移 ${up}px（上 ${ctr.top} / 下 ${ctr.bottom}）`);
  else ok(`首页内容居中后上移 ${up}px（内容距顶 ${ctr.top} · 距底 ${ctr.bottom}）`);
  if(Math.abs(ctr.left - ctr.right) > 2) bad(`首页内容没水平居中：左 ${ctr.left} / 右 ${ctr.right}`);
  else ok(`首页内容水平居中（左右各 ${ctr.left}px）`);
  /* 🔴 内容比视口高的时候，居中不能把顶部裁掉、也不能滚不上去 ——
     这是 flex 居中的经典坑（justify-content:center 会裁，margin:auto 不会）。 */
  await p.setViewport({width:1280, height:620});
  await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await new Promise(r => setTimeout(r, 220));
  const tall = await p.evaluate(() => {
    const mainEl = document.querySelector('main');
    mainEl.scrollTop = 0;
    const m = mainEl.getBoundingClientRect();
    const w = document.querySelector('.wrap').getBoundingClientRect();
    const h1 = document.querySelector('h1').getBoundingClientRect();
    return { overflow: mainEl.scrollHeight > mainEl.clientHeight,
             wrapTop: Math.round(w.top - m.top), h1Top: Math.round(h1.top - m.top) };
  });
  if(!tall.overflow) warn('620px 高时内容没溢出，这一档没测到');
  else if(tall.wrapTop < -1 || tall.h1Top < 0) bad(`内容超过视口时顶部被裁：wrap ${tall.wrapTop} / h1 ${tall.h1Top}`);
  else ok(`内容超过视口时顶部完好、滚得上去（h1 距顶 ${tall.h1Top}px）`);
  await p.setViewport({width:1440, height:900});
  await new Promise(r => setTimeout(r, 200));

  /* ── 14. 断点边界：768 是移动端，769 是桌面 ── */
  console.log('\n════ 断点边界 ════');
  // 🔴 必须先切回首页：上一步为了查资料库停在 libs 视图，那一页没有 .cgrid / .wrap，
  //    量出来会是 null，而我给了 ''/0 的兜底值 —— 于是两边都"相等"，报绿。
  //    第一版就是这么过的（1024 下报"主区 510 · 案例 1 列"，真值是 762 和 5 列）。
  await p.evaluate(() => go('new'));
  await new Promise(r => setTimeout(r, 300));
  const shape = async w => {
    await p.setViewport({width:w, height:900});
    await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await new Promise(r => setTimeout(r, 200));
    return p.evaluate(() => {
      const sb = document.querySelector('.sb').getBoundingClientRect();
      const m  = document.querySelector('main').getBoundingClientRect();
      const wr = document.querySelector('.wrap');
      const cg = document.querySelector('.cgrid');
      // 量不到就直接说量不到，别给兜底值 —— 兜底值会让两边"相等"，把测试变成假绿
      if(!wr || !cg) return { missing: (!wr ? '.wrap ' : '') + (!cg ? '.cgrid' : '') };
      return {
        mobile: getComputedStyle(document.querySelector('.wbm-top')).display !== 'none',
        sbLeft: Math.round(sb.left), sbW: Math.round(sb.width),
        mainL: Math.round(m.left), mainW: Math.round(m.width),
        wrapW: Math.round(wr.getBoundingClientRect().width),
        cgCols: getComputedStyle(cg).gridTemplateColumns,
        bodyW: Math.round(document.body.getBoundingClientRect().width),
        docW: document.documentElement.scrollWidth,
      };
    });
  };
  const s768 = await shape(768), s769 = await shape(769), s1023 = await shape(1023), s1024 = await shape(1024);
  const miss = [['768',s768],['769',s769],['1023',s1023],['1024',s1024]].filter(([,v]) => v.missing);
  if(miss.length) bad('断点测试量不到元素（不在首页？）：' + miss.map(([w,v]) => w + ':' + v.missing).join(' / '));
  if(!s768.mobile) bad(`768px 不是移动端（顶栏没出来）`);
  else ok('768px = 移动端');
  if(s769.mobile) bad(`769px 变成了移动端（应该还是桌面）`);
  else ok('769px = 桌面');

  /* 769~1023 必须跟 1024 一模一样 —— 「低于 1024 不再变化」就是这个意思。
     量的是真实几何，不是「有没有写 media query」。 */
  const same = (a, b) => a.sbW === b.sbW && a.mainW === b.mainW && a.wrapW === b.wrapW
                      && a.cgCols === b.cgCols && a.bodyW === b.bodyW;
  if(!same(s769, s1024)) bad('769px 的版面跟 1024px 不一样：' + JSON.stringify({s769, s1024}));
  else ok(`769px 版面 = 1024px 版面（左栏 ${s769.sbW} · 主区 ${s769.mainW} · 案例 ${s769.cgCols.split(' ').length} 列 · body ${s769.bodyW}）`);
  if(!same(s1023, s1024)) bad('1023px 的版面跟 1024px 不一样：' + JSON.stringify({s1023, s1024}));
  else ok('1023px 版面 = 1024px 版面');
  if(s769.bodyW !== 1024) bad(`769px 下 body 宽 ${s769.bodyW}，没冻在 1024`);
  else ok('版面冻在 1024，窗口再窄就出横向滚动条（这是「不再变化」的落地方式）');
  await p.setViewport({width:1440, height:900});
  await p.screenshot({path:`${OUT}/m-desktop-regression.png`});
  await p.close();

  await b.close();
  server.close();

  console.log('\n════════════════════════════');
  console.log(fails.length ? `❌ ${fails.length} 项不过：\n  ` + fails.join('\n  ')
                           : '✅ 全部通过');
  if(warns.length) console.log(`⚠️  ${warns.length} 项提示：\n  ` + warns.join('\n  '));
  console.log('截图在 ' + OUT + '/m-*.png —— 探针数字和截图两道都要看');
  process.exit(fails.length ? 1 : 0);
})();
