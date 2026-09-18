const pp=require('/Users/wanglixiang/.claude/skills/mic-fullstack/scripts/online-reach/node_modules/puppeteer-core');
(async()=>{const b=await pp.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',args:['--no-sandbox','--allow-file-access-from-files'],defaultViewport:{width:1440,height:900}});
const p=await b.newPage();await p.goto('file:///Users/wanglixiang/Desktop/UED%20workbuddy/index.html',{waitUntil:'networkidle0'});
await p.evaluate(()=>[...document.querySelectorAll('.nav button')].find(b=>b.textContent.includes('资料库')).click());
await new Promise(r=>setTimeout(r,300));
console.log(await p.evaluate(()=>{
  const out=[];
  [...document.querySelectorAll('.tbl tbody tr')].slice(0,3).forEach(tr=>{
    const cols=[...tr.children].map(td=>{
      // Range 包住单元格全部内容 → 拿到内容真实的矩形（含多行）
      const rg=document.createRange(); rg.selectNodeContents(td);
      const rs=[...rg.getClientRects()].filter(r=>r.height>2);
      if(!rs.length) return null;
      const top=Math.min(...rs.map(r=>r.top)), bot=Math.max(...rs.map(r=>r.bottom));
      return {首行顶:Math.round(rs[0].top), 内容中心:Math.round((top+bot)/2), 行数:rs.length};
    }).filter(Boolean);
    const centers=cols.map(c=>c.内容中心), firstTops=cols.map(c=>c.首行顶);
    out.push({行:tr.children[0].textContent.trim().slice(0,9),
      内容中心:centers, 中心落差:Math.max(...centers)-Math.min(...centers),
      首行顶:firstTops, 各列行数:cols.map(c=>c.行数)});
  });
  return out;
}));
await b.close()})();
