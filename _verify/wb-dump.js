const puppeteer = require('/Users/wanglixiang/.claude/skills/mic-fullstack/scripts/online-reach/node_modules/puppeteer-core');
(async () => {
  const b = await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless:'new', args:['--no-sandbox','--allow-file-access-from-files'], defaultViewport:{width:1440,height:900}});
  const p = await b.newPage();
  await p.goto('file:///Users/wanglixiang/Desktop/UED%20workbuddy/index.html',{waitUntil:'networkidle0'});
  const txt = async () => p.evaluate(()=>{
    const out=[];
    document.querySelectorAll('main *, .sb *').forEach(el=>{
      if(el.children.length) return;
      const t=el.textContent.trim(); if(t) out.push(t);
    });
    document.querySelectorAll('textarea').forEach(el=>{ if(el.placeholder) out.push(el.placeholder); if(el.value) out.push(el.value); });
    return [...new Set(out)];
  });
  const all = new Set();
  const click = async t => { await p.evaluate(txt=>{
      const el=[...document.querySelectorAll('button')].find(b=>b.textContent.replace(/\s+/g,'')===txt.replace(/\s+/g,''));
      if(el) el.click(); }, t); await new Promise(r=>setTimeout(r,240)); };
  // 六个场景 + 每个场景所有卡的模板
  for(const s of ['前期调研','设计稿','制作 Demo','交付验收','走查复盘','运营专项']){
    await click(s);
    (await txt()).forEach(x=>all.add(x));
    const n = await p.evaluate(()=>document.querySelectorAll('.card').length);
    for(let i=0;i<n;i++){ await p.evaluate(i=>document.querySelectorAll('.card')[i].click(), i);
      await new Promise(r=>setTimeout(r,150)); (await txt()).forEach(x=>all.add(x)); }
  }
  // 模型浮层
  await p.evaluate(()=>document.querySelector('.model>button').click()); await new Promise(r=>setTimeout(r,200));
  (await txt()).forEach(x=>all.add(x));
  // 四个视图 + 资料库详情
  for(const v of ['资料库7','技能与规范17','我的项目']){ await click(v); (await txt()).forEach(x=>all.add(x)); }
  await click('资料库7');
  for(let i=0;i<7;i++){ await p.evaluate(i=>document.querySelectorAll('.tile')[i].click(), i);
    await new Promise(r=>setTimeout(r,180)); (await txt()).forEach(x=>all.add(x));
    await click('资料库'); }
  console.log([...all].join('\n'));
  await b.close();
})();
