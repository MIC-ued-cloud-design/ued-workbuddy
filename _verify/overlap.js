const path=require('path');
const OUTDIR=path.join(__dirname,'out');
const pp=require('/Users/wanglixiang/.claude/skills/mic-fullstack/scripts/online-reach/node_modules/puppeteer-core');
(async()=>{const b=await pp.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',args:['--no-sandbox','--allow-file-access-from-files'],defaultViewport:{width:1440,height:900,deviceScaleFactor:2}});
const p=await b.newPage();await p.goto('file:///Users/wanglixiang/Desktop/UED%20workbuddy/index.html',{waitUntil:'networkidle0'});
await p.evaluate(()=>document.querySelector('.cbar .plus').click());
await new Promise(r=>setTimeout(r,240));
await p.hover('.ppop .pitem:last-child > .row');
await new Promise(r=>setTimeout(r,300));
console.log(await p.evaluate(()=>{
  const vis=[...document.querySelectorAll('.ppop2')].find(e=>getComputedStyle(e).display!=='none');
  if(!vis) return {错误:'没有可见的二级菜单'};
  const rows=[...vis.querySelectorAll('.p2row')];   // 只量可见那个，隐藏元素几何全是 0 会假绿
  let bad=0, over=0;
  const sample=[];
  rows.forEach((r,i)=>{
    const n=r.querySelector('.n').getBoundingClientRect(), d=r.querySelector('.d').getBoundingClientRect();
    if(d.top < n.bottom - 0.5) bad++;                         // 标题与描述重叠
    if(i>0){ const prev=rows[i-1].getBoundingClientRect();
      if(r.getBoundingClientRect().top < prev.bottom - 0.5) over++; }   // 行与行重叠
    if(i<2) sample.push({名:r.querySelector('.n').textContent.slice(0,10),
      标题底:Math.round(n.bottom), 描述顶:Math.round(d.top)});
  });
  return {行数:rows.length, 标题描述重叠:bad, 行间重叠:over, 抽样:sample,
    行高:Math.round(rows[0].getBoundingClientRect().height)};
}));
await p.screenshot({path:path.join(OUTDIR,'plus-fixed.png'), clip:{x:900,y:600,width:700,height:460}});
await b.close()})();
