// 视觉与交付规范 → 颜色：每张色卡的色块都要贴着卡片顶边、跟卡片一样宽。
// 2026-09-09 立：29 张里 5 张色块低了 10px —— .swcell 是 button，网格把同行卡片拉等高后，Chrome 默认把按钮内容垂直居中。
const pp=require('/Users/wanglixiang/.claude/skills/mic-fullstack/scripts/online-reach/node_modules/puppeteer-core');
(async()=>{const b=await pp.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',args:['--no-sandbox','--allow-file-access-from-files'],defaultViewport:{width:1440,height:900,deviceScaleFactor:2}});
const p=await b.newPage();
await p.goto(process.argv[2]? 'file://'+encodeURI(require('path').resolve(process.argv[2])) : 'file:///Users/wanglixiang/Desktop/UED%20workbuddy/index.html',{waitUntil:'networkidle0'});
const r=await p.evaluate(()=>{
  const x=LIBS.findIndex(l=>/视觉与交付规范/.test(l.n)); if(x<0) return {错误:'找不到视觉与交付规范'}; openLib(x); S.fqTab='col'; render();
  const cells=[...document.querySelectorAll('.swcell')];
  const bad=[];
  cells.forEach(c=>{const t=c.querySelector('.swtop'); const R=c.getBoundingClientRect(), T=t.getBoundingClientRect();
    const bw=parseFloat(getComputedStyle(c).borderTopWidth)||0;
    const dy=T.top-R.top-bw, dx=T.left-R.left-bw, dw=(R.width-2*bw)-T.width;
    if(Math.abs(dy)>0.5||Math.abs(dx)>0.5||Math.abs(dw)>0.5) bad.push({名:c.querySelector('.swn').textContent, 顶边差:Math.round(dy), 左边差:Math.round(dx), 宽差:Math.round(dw)});});
  return {色卡数:cells.length, 不贴边:bad.length, 明细:bad};
});
console.log(JSON.stringify(r,null,1));
await b.close();
if(r.错误||!r.色卡数||r.不贴边){ console.log('❌ 未通过'); process.exit(1);} console.log('✅ 色块全部贴顶通宽');
})();
