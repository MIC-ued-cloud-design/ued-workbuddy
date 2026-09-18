const pp=require('/Users/wanglixiang/.claude/skills/mic-fullstack/scripts/online-reach/node_modules/puppeteer-core');
const SP=process.argv[2];
(async()=>{const b=await pp.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',args:['--no-sandbox','--allow-file-access-from-files'],defaultViewport:{width:1440,height:900,deviceScaleFactor:2}});
const p=await b.newPage(); const E=[]; p.on('pageerror',e=>E.push(e.message));
await p.goto('file:///Users/wanglixiang/Desktop/UED%20workbuddy/index.html',{waitUntil:'networkidle0'});
// 上传一张图 + 一个非图片文件
await (await p.$('#ipick')).uploadFile(SP+'/test-shot.png');
await new Promise(r=>setTimeout(r,300));
await (await p.$('#fpick')).uploadFile(SP+'/test-doc.txt');
await new Promise(r=>setTimeout(r,300));
console.log('附件标签:', await p.evaluate(()=>[...document.querySelectorAll('.filechip .nm')].map(e=>e.textContent)));
console.log('图片有预览节点:', await p.evaluate(()=>{
  const cs=[...document.querySelectorAll('.filechip')];
  return cs.map(c=>({名:c.querySelector('.nm').textContent.slice(0,14), 有预览:!!c.querySelector('.fprev img')}));}));
console.log('发送按钮（只有附件没文字时）:', await p.evaluate(()=>!document.getElementById('send').disabled) ? '✅ 可点' : '❌ 灰的');
// hover 图片标签 → 预览该可见
await p.hover('.filechip');
await new Promise(r=>setTimeout(r,350));
const pv=await p.evaluate(()=>{const e=document.querySelector('.fprev');
  if(!e) return null; const r=e.getBoundingClientRect(); const cs=getComputedStyle(e);
  return {display:cs.display, 宽:Math.round(r.width), 高:Math.round(r.height),
    在视口内:r.top>=0&&r.left>=0&&r.right<=1440};});
console.log('hover 后预览:', pv);
if(pv&&pv.display!=='none') await p.screenshot({path:SP+'/file-preview.png', clip:{x:470,y:250,width:700,height:400}});
// 点 × 删掉
await p.evaluate(()=>document.querySelector('.filechip .x').click());
await new Promise(r=>setTimeout(r,220));
console.log('点 × 后剩:', await p.evaluate(()=>document.querySelectorAll('.filechip').length), '个');
console.log('JS 错误:', E.length?E:'✅ 0');
await b.close()})();
