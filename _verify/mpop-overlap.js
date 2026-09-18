// 模型下拉（.mpop）每一行三段文字互不压字。2026-09-09 立：桥那一行「Claude · 你电脑上的 Claude Code」压到说明上，吉吉截图发现。
// 桥探测只在线上域名或 wb.bridge.dev=1 时发；这里用 dev 开关 + 拦截 /health 伪装「桥已连上」，让桥那一行真的渲染出来。
const path=require('path');
const OUTDIR=path.join(__dirname,'out');
const pp=require('/Users/wanglixiang/.claude/skills/mic-fullstack/scripts/online-reach/node_modules/puppeteer-core');
(async()=>{const b=await pp.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',args:['--no-sandbox','--allow-file-access-from-files'],defaultViewport:{width:1440,height:900,deviceScaleFactor:2}});
const p=await b.newPage();
await p.setRequestInterception(true);
p.on('request',r=>{ if(r.url().startsWith('http://127.0.0.1:17331/health')) r.respond({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({ok:true,allowed:true,claude:{found:true,version:'probe'}})}); else r.continue(); });
await p.evaluateOnNewDocument(()=>{ try{ localStorage.setItem('wb.bridge.dev','1'); }catch(e){} });
await p.goto(process.argv[2]? 'file://'+encodeURI(require('path').resolve(process.argv[2])) : 'file:///Users/wanglixiang/Desktop/UED%20workbuddy/index.html',{waitUntil:'networkidle0'});
await new Promise(r=>setTimeout(r,800));
await p.evaluate(()=>{ S.mopen=true; render(); });
await new Promise(r=>setTimeout(r,200));
const res=await p.evaluate(()=>{
  const pop=document.querySelector('.mpop'); if(!pop) return {错误:'模型弹层没打开'};
  const rows=[...pop.querySelectorAll('.row')];
  const out=[]; let bad=0;
  rows.forEach(r=>{
    const nm=r.querySelector('.nm>span:first-child'), bd=r.querySelector('.badge'), rt=r.querySelector('.rate'), tk=r.querySelector('.tick');
    const R=e=>e?e.getBoundingClientRect():null;
    const n=R(nm), g=R(bd), t=R(rt), k=R(tk);
    const seq=[n,g,t,k].filter(Boolean);
    let overlap=0; for(let i=1;i<seq.length;i++) if(seq[i].left < seq[i-1].right-0.5) overlap++;
    const clipped = nm.scrollWidth>nm.clientWidth+1 || (rt&&rt.scrollWidth>rt.clientWidth+1);
    if(overlap||clipped) bad++;
    out.push({名:nm.textContent, 标签:bd?bd.textContent:'', 说明:rt?rt.textContent:'', 压字:overlap, 被截:clipped, 余量px:Math.round((k?k.left:t.right)-(t?t.right:n.right))});
  });
  return {有桥行:rows.some(r=>/Claude (Code|Opus)/.test(r.textContent)), 行数:rows.length, 问题行:bad, 明细:out};
});
console.log(JSON.stringify(res,null,1));
const box=await p.evaluate(()=>{const r=document.querySelector('.mpop').getBoundingClientRect(); return {x:r.left-10,y:r.top-10,width:r.width+20,height:r.height+20};});
await p.screenshot({path:path.join(OUTDIR,'mpop-overlap.png'), clip:box});
await b.close();
if(!res.有桥行 || res.问题行) { console.log('❌ 未通过'); process.exit(1); } console.log('✅ 模型下拉三段互不压字');
})();
