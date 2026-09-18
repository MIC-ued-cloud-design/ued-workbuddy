const pp=require('/Users/wanglixiang/.claude/skills/mic-fullstack/scripts/online-reach/node_modules/puppeteer-core');
const SP=process.argv[2];
(async()=>{
for(const W of [1440,1024]){
  const b=await pp.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless:'new',args:['--no-sandbox','--allow-file-access-from-files'],defaultViewport:{width:W,height:900,deviceScaleFactor:W===1440?2:1}});
  const p=await b.newPage(); const E=[]; p.on('pageerror',e=>E.push(e.message));
  await p.goto('file:///Users/wanglixiang/Desktop/UED%20workbuddy/index.html',{waitUntil:'networkidle0'});
  await p.evaluate(()=>document.querySelector('.cbar .plus').click());
  await new Promise(r=>setTimeout(r,260));
  const lvl1=await p.evaluate(()=>[...document.querySelectorAll('.ppop .pitem > .row')].map(b=>b.textContent.trim()));
  console.log(`\n[${W}px] 一级菜单:`, lvl1, lvl1.some(x=>x.includes('连接器'))?'❌ 还有连接器':'✅ 无连接器');
  // hover「技能」→ 二级展开
  await p.hover('.ppop .pitem:last-child > .row');
  await new Promise(r=>setTimeout(r,320));
  const r=await p.evaluate(()=>{
    const pi=[...document.querySelectorAll('.pitem')].pop(), el=pi.querySelector('.ppop2');
    const cs=getComputedStyle(el), rc=el.getBoundingClientRect();
    const list=el.querySelector('.p2list');
    return {display:cs.display, 宽:Math.round(rc.width), 高:Math.round(rc.height),
      右沿:Math.round(rc.right), 视口宽:innerWidth, 溢出视口:rc.right>innerWidth+1 || rc.top<0,
      搜索框:!!el.querySelector('.p2search'), 技能项:list.querySelectorAll('.p2row').length,
      列表可滚动:list.scrollHeight>list.clientHeight+1, 底部项:[...el.querySelectorAll('hr ~ .row')].map(b=>b.textContent.trim())};
  });
  console.log(`[${W}px] 技能二级菜单:`, JSON.stringify(r));
  if(W===1440) await p.screenshot({path:SP+'/plus-2level.png', clip:{x:480,y:390,width:600,height:480}});
  console.log(`[${W}px] JS 错误:`, E.length?E:'✅ 0');
  await b.close();
}})();
