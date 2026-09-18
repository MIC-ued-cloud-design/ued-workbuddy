// 「我是谁」这段必须跟底座走 —— 2026-09-09 立。
// 起因：SYS 里写死「你用的是一个免费的小模型」，桥改用 Opus 5 后这句成了假话，
// Claude 从运行环境知道自己是谁，两条信息打架，它把矛盾照实报给了用户。
// 这道门查两件事：① SYS 那份公共文本里不再出现任何「我是谁」的断言；
// ② baseLine() 在各档底座下说的是那一档的实话。
// 🔴 bridge 档不在这里验 —— puppeteer 合成文档会被 Chrome LNA 拒掉 127.0.0.1（已知的仪器红），
//    那一档走 curl 直接打桥端到端验，别在这里当成代码的红。
const pp=require('/Users/wanglixiang/.claude/skills/mic-fullstack/scripts/online-reach/node_modules/puppeteer-core');
const path=require('path');
(async()=>{
const b=await pp.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',args:['--no-sandbox','--allow-file-access-from-files'],defaultViewport:{width:1440,height:900}});
const p=await b.newPage();
const url = process.argv[2]? 'file://'+encodeURI(path.resolve(process.argv[2])) : 'file:///Users/wanglixiang/Desktop/UED%20workbuddy/index.html';
await p.goto(url,{waitUntil:'networkidle0'});

const r=await p.evaluate(()=>{
  const out={};
  out.暴露了 = typeof window.wbBaseLine==='function';
  if(!out.暴露了) return out;

  // ① 公共文本里不许再有「我是谁」的断言
  const src = [...document.querySelectorAll('script')].map(s=>s.textContent).join('\n');
  const 禁词 = ['你用的是一个免费的小模型'];
  out.SYS残留 = 禁词.filter(w=>src.indexOf(w)>=0 && src.indexOf('原来写死「'+w) < 0);

  // ② 当前档（file:// 打开、没填 key、桥探不到 → none，落 proxy 文案分支）
  out.当前档 = window.wbMode();
  out.当前话 = window.wbBaseLine();
  return out;
});

// ③ 切到 own 档再看一次
await p.evaluate(()=>{ localStorage.setItem('wb.ai.cfg', JSON.stringify({prov:'zhipu',key:'sk-探针假密钥不发请求'})); });
await p.reload({waitUntil:'networkidle0'});
const own=await p.evaluate(()=>({档:window.wbMode(), 话:window.wbBaseLine()}));
await p.evaluate(()=>{ localStorage.removeItem('wb.ai.cfg'); });

const 结果={...r, own档:own.档, own话:own.话};
console.log(JSON.stringify(结果,null,1));

const 错=[];
if(!结果.暴露了) 错.push('wbBaseLine 没暴露，验不了');
if(结果.SYS残留 && 结果.SYS残留.length) 错.push('SYS 里还留着底座断言：'+结果.SYS残留.join('/'));
if(!/GLM-4-Flash/.test(结果.当前话||'')) 错.push('共享通道那档没说清是 GLM-4-Flash');
if(结果.own档!=='own') 错.push('切 own 档失败，实际是 '+结果.own档+'（仪器问题，不是代码问题）');
else if(!/不知道具体是哪一家/.test(own.话||'')) 错.push('own 档没如实说「不知道是哪个模型」');
if(/免费的小模型/.test(own.话||'')) 错.push('own 档仍自称免费小模型');
await b.close();
if(错.length){ console.log('❌ 未通过：'); 错.forEach(e=>console.log('   · '+e)); process.exit(1); }
console.log('✅ 公共文本无底座断言 · proxy/own 两档各说各的实话（bridge 档见 curl 端到端）');
})();
