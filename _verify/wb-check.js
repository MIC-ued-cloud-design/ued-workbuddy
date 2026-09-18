const puppeteer = require('/Users/wanglixiang/.claude/skills/mic-fullstack/scripts/online-reach/node_modules/puppeteer-core');
const OUT = process.argv[2];
const URL = 'file:///Users/wanglixiang/Desktop/UED%20workbuddy/index.html';

(async () => {
  const b = await puppeteer.launch({
    executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless:'new', args:['--no-sandbox','--allow-file-access-from-files'],
    defaultViewport:{width:1440,height:900,deviceScaleFactor:1}
  });
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if(m.type()==='error') errs.push('console: ' + m.text()); });
  await p.goto(URL, {waitUntil:'networkidle0'});

  // 非空探针：脱网门只查抛错/外部请求/断图，查不出「页面渲染成空的」
  const boot = await p.evaluate(()=>({nav:document.querySelectorAll('.nav button').length,
    main:document.querySelector('main').innerHTML.length, fq:document.querySelectorAll('svg.fq').length}));
  if(!boot.nav || boot.main < 500){ console.log('❌ 页面没渲染出来：', JSON.stringify(boot)); process.exit(1); }
  console.log(`✅ 启动：导航 ${boot.nav} 项 · main ${boot.main} 字符 · 飞鹊图标 ${boot.fq} 个`);

  const clickText = async (t) => {
    const ok = await p.evaluate(txt => {
      const el = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === txt
        || b.textContent.replace(/\s+/g,'') === txt.replace(/\s+/g,''));
      if(el){ el.click(); return true; } return false;
    }, t);
    await new Promise(r=>setTimeout(r,260));
    if(!ok) errs.push('点不到按钮: ' + t);
    return ok;
  };
  const shot = async n => p.screenshot({path:`${OUT}/${n}.png`});

  // 几何探针
  const probe = async label => p.evaluate(l => {
    const cards = [...document.querySelectorAll('.pill')];
    const tops = [...new Set(cards.map(c=>Math.round(c.getBoundingClientRect().top)))];
    const de = document.documentElement;
    return { label:l, cards:cards.length, rows:tops.length,
      perRow: tops.length ? cards.length/tops.length : 0,
      hScroll: de.scrollWidth > de.clientWidth + 1,
      scrollW: de.scrollWidth, clientW: de.clientWidth };
  }, label);

  const R = [];
  R.push(await probe('场景1·前期调研(4卡)'));  await shot('01-home-scene1');

  await clickText('设计稿');
  R.push(await probe('场景2·设计稿(3卡)'));   await shot('02-scene2');

  await clickText('交付验收');
  R.push(await probe('场景4·交付验收(2卡)')); await shot('03-scene4');

  await clickText('前期调研');
  // 点第一张卡 → 填模板
  await p.evaluate(()=>document.querySelectorAll('.pill')[0].click());
  await new Promise(r=>setTimeout(r,320));
  const filled = await p.evaluate(()=>({ v:document.getElementById('ta').value,
    sendOn: !document.getElementById('send').disabled }));
  await shot('04-template-filled');

  // 输入框里的场景标签 + cfoot 资料库提示
  const chip = await p.evaluate(()=>({n:document.querySelectorAll('.tagchip').length,
    txt:document.querySelector('.tagchip span')?.textContent||'',
    foot:[...document.querySelectorAll('.cfoot button')].map(b=>b.textContent.trim()).join(' | ')}));
  // 案例区
  const cases = await p.evaluate(()=>({n:document.querySelectorAll('.case').length,
    first:document.querySelector('.case .t')?.textContent||''}));
  // 案例卡标题：必须一行，且不能被截断（换两批都量）
  let titleBad=[];
  for(let b=0;b<2;b++){
    const r = await p.evaluate(()=>[...document.querySelectorAll('.case .t')].map(el=>{
      const lh = parseFloat(getComputedStyle(el).lineHeight);
      return {t:el.textContent, lines:Math.round(el.offsetHeight/lh),
              clipped: el.scrollWidth > el.clientWidth + 1};
    }));
    r.forEach(x=>{ if(x.lines>1) titleBad.push(x.t+'→'+x.lines+'行');
                   if(x.clipped) titleBad.push(x.t+'→被截断'); });
    await p.evaluate(()=>{const b=[...document.querySelectorAll('.cases-h button')][0]; if(b) b.click();});
    await new Promise(r=>setTimeout(r,200));
  }

  // toast 是否真的没了
  const noToast = await p.evaluate(()=>!document.querySelector('.toast') && typeof window.toast==='undefined');

  // 模型下拉
  await p.evaluate(()=>document.querySelector('.model>button').click());
  await new Promise(r=>setTimeout(r,240));
  const mpop = await p.evaluate(()=>{
    const el=document.querySelector('.mpop'); if(!el) return null;
    const r=el.getBoundingClientRect();
    // 被祖先 overflow 剪掉时，可见高度 < 内容高度
    const clipped = Math.abs(r.height - el.scrollHeight) > 2 && el.scrollHeight > r.height;
    const firstRow = el.querySelector('.row'); const fr = firstRow && firstRow.getBoundingClientRect();
    return {rows:el.querySelectorAll('.row').length, maxSwitch:!!el.querySelector('.sw'),
      foot:!!el.querySelector('.mfoot'), h:Math.round(r.height), contentH:el.scrollHeight, clipped,
      firstRowVisible: fr ? (fr.top >= r.top - 1 && fr.bottom <= r.bottom + 1) : false,
      inView: r.top>=0 && r.left>=0 && r.right<=innerWidth};
  });
  await shot('05-model-open');

  // 发送 → 任务落到左栏
  await p.evaluate(()=>{ document.body.click(); });
  await new Promise(r=>setTimeout(r,200));
  await p.evaluate(()=>document.getElementById('send').click());
  await new Promise(r=>setTimeout(r,300));
  await shot('06-task-created');

  for(const [txt,name] of [['资料库7','07-libs'],['技能与规范17','08-skills']]){
    await clickText(txt); await shot(name);
    R.push(await probe(name));
  }
  // 资料库详情
  await clickText('资料库7');
  await new Promise(r=>setTimeout(r,260));
  const L=[];
  L.push(await p.evaluate(()=>({ 第二栏:!document.getElementById('col2').hidden,
    栏内项:document.querySelectorAll('.c2item').length,
    总览表行:document.querySelectorAll('.tbl tbody tr').length })));
  await shot('10-libs-3col');
  // 点一个有内容的库
  await p.evaluate(()=>[...document.querySelectorAll('.c2item')].find(b=>b.textContent.includes('飞鹊组件库')).click());
  await new Promise(r=>setTimeout(r,260));
  L.push(await p.evaluate(()=>({ 库名:document.querySelector('h2').textContent.trim().slice(0,8),
    表格行:document.querySelectorAll('.tbl tbody tr').length,
    选中项:document.querySelector('.c2item.on')?.textContent.trim().slice(0,7) })));
  await shot('11-lib-detail');
  // 点一个筹备中的库 → 该出空态
  await p.evaluate(()=>[...document.querySelectorAll('.c2item')].find(b=>b.textContent.includes('竞品库')).click());
  await new Promise(r=>setTimeout(r,260));
  L.push(await p.evaluate(()=>({ 库名:document.querySelector('h2').textContent.trim().slice(0,5),
    空态:!!document.querySelector('.libempty'), 表格:!!document.querySelector('.tbl') })));
  // 回到新建任务 → 第二栏该收起
  await clickText('新建任务'); await new Promise(r=>setTimeout(r,240));
  L.push(await p.evaluate(()=>{const c=document.getElementById('col2');
    return { 离开资料库后:{ hidden属性:c.hidden,
      实际占位宽度:Math.round(c.getBoundingClientRect().width),   // 只查 hidden 属性会假绿
      真的不占位:c.getBoundingClientRect().width===0 }};}));
  console.log('\n══ 资料库三栏 ══');
  L.forEach(x=>console.log('  ', JSON.stringify(x, null, 0)));

  // 窄窗
  await p.setViewport({width:1024,height:820,deviceScaleFactor:1});
  await clickText('新建任务');
  await new Promise(r=>setTimeout(r,260));
  R.push(await probe('1024 窄窗'));
  await shot('11-narrow-1024');

  console.log('\n══ 几何探针 ══');
  R.forEach(r=>console.log(`  ${r.label.padEnd(22)} 卡${r.cards} 行${r.rows} 每行${r.perRow}  横向滚动:${r.hScroll?'❌有':'✅无'} (${r.scrollW}/${r.clientW})`));
  console.log('\n══ 交互 ══');
  console.log('  点卡填模板:', filled.v ? '✅ 已填 ' + JSON.stringify(filled.v.split('\n')[0].slice(0,30)) : '❌ 空');
  console.log('  发送按钮激活:', filled.sendOn ? '✅' : '❌');
  console.log('  模型浮层:', mpop ? `${mpop.clipped?'❌ 被剪裁':'✅'} ${mpop.rows} 项 · 高 ${mpop.h}/${mpop.contentH}px`
    + ` · Max开关${mpop.maxSwitch?'✅':'❌'} · 配置自定义${mpop.foot?'✅':'❌'} · 首行可见${mpop.firstRowVisible?'✅':'❌'}`
    + `${mpop.inView?'':' ❌溢出视口'}` : '❌ 没出现');
  console.log('  输入框场景标签:', chip.n ? `✅ ${chip.n} 个「${chip.txt}」` : '❌ 无');
  console.log('  cfoot 资料库提示:', chip.foot);
  console.log('  案例标题行数:', titleBad.length ? '❌ '+titleBad.join(' / ') : '✅ 全部一行且未截断（两批都量过）');
  console.log('  最佳实践案例:', cases.n ? `✅ ${cases.n} 张 · 首张「${cases.first}」` : '❌ 无');
  // 量最终间距，不是量我设的 gap 值（gap 可能挂在没有兄弟元素的容器上）
  /* 2026-09-09 吉吉：登录入口和历史任务都去掉。左栏只剩 头 / 导航 / 更新卡 */
  const noSide = await p.evaluate(()=>!document.querySelector('.sb-foot,#taskList,#taskHead,.wblogin'));
  console.log('  底部 toast 已移除:', noToast ? '✅' : '❌ 还在');

  console.log('  左栏不再有任务历史/登录行:', (noSide? '✅' : '❌ 还在'));
  console.log('\n══ JS 错误 ══');
  console.log(errs.length ? errs.map(e=>'  ❌ '+e).join('\n') : '  ✅ 0 个');
  await b.close();
})();
