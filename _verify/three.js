const pp=require('/Users/wanglixiang/.claude/skills/mic-fullstack/scripts/online-reach/node_modules/puppeteer-core');
const SP=process.argv[2];
(async()=>{
const b=await pp.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless:false, args:['--no-sandbox','--allow-file-access-from-files'], defaultViewport:{width:1440,height:900,deviceScaleFactor:2}});
const p=await b.newPage();
await p.goto('file:///Users/wanglixiang/Desktop/UED%20workbuddy/index.html',{waitUntil:'networkidle0'});
const names=['添加文件','模式','专家','技能'];
for(let i=0;i<4;i++){
  await p.evaluate(()=>{const pl=document.querySelector('.cbar .plus'); if(!document.querySelector('.ppop')) pl.click();});
  await new Promise(r=>setTimeout(r,240));
  await p.hover(`.ppop .pitem:nth-child(${i<1?i+1:i+2}) > .row`);   // 第 2 个位置是 <hr>
  await new Promise(r=>setTimeout(r,340));
  const r=await p.evaluate(()=>{
    const vis=[...document.querySelectorAll('.ppop2')].find(e=>getComputedStyle(e).display!=='none');
    if(!vis) return {无可见菜单:true};
    const rows=[...vis.querySelectorAll('.p2row')];
    let bad=0, gap=0, squash=0;
    rows.forEach((rw,i)=>{const n=rw.querySelector('.n').getBoundingClientRect(),
      d=rw.querySelector('.d').getBoundingClientRect(), rc=rw.getBoundingClientRect();
      if(d.top < n.bottom - 0.5) bad++;                                  // 行内：标题压描述
      if(i>0 && rc.top < rows[i-1].getBoundingClientRect().bottom-0.5) gap++;  // 行间：上下两行压一起
      if(rw.scrollHeight > rc.height + 1) squash++;                      // 行被压扁、内容溢出
    });
    const tx=rows[0].querySelector('.tx');
    return {行数:rows.length, 行内重叠:bad, 行间重叠:gap, 行被压扁:squash, tx的display:getComputedStyle(tx).display,
      tx的flexDirection:getComputedStyle(tx).flexDirection,
      首行:{标题底:Math.round(rows[0].querySelector('.n').getBoundingClientRect().bottom),
            描述顶:Math.round(rows[0].querySelector('.d').getBoundingClientRect().top)}};
  });
  console.log(`[${names[i]}]`, JSON.stringify(r));
  await p.screenshot({path:`${SP}/menu-${i}-${names[i]}.png`, clip:{x:480,y:330,width:640,height:470}});
}
await b.close();})();
