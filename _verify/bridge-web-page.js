// 页面侧「读网页 + 桥新旧」链路（不需要真桥、不需要真 Claude）：
//   假桥在 17398 上模拟三种 /health 和一个慢速 SSE；puppeteer 把页面发往 127.0.0.1:17331 的请求改道到假桥。
//   三种桥：new＝跟 bridge/uw-bridge.js 同版本、web 和 terminal 都有 ／ mid＝1.1.0 有 web 没 terminal ／ old＝1.0.0 什么都没有
//   查：①问题里的网址被抽出来放进 body.urls ②流式中间头部显示「正在用浏览器读取」③答完头部写「读了 1 个网页」
//       ④没读到的网址列在回答下面 ⑤老桥不发 urls
//       ⑥🆕 页面里的目标版本号跟 bridge/uw-bridge.js 的 VERSION 一致（构建注入的唯一源）
//       ⑦🆕 新桥不被误报旧版 ⑧🆕 旧桥：首次提示说旧版、设置里给出版本差 + 缺的功能 + 可复制的安装命令 + 「升级好了再探一次」
//       ⑨🆕 旧桥「再探一次」仍旧版时不给假绿、设置弹层还在 ⑩🆕 终端选择弹层：说清是哪版要哪版、有「复制升级命令」按钮
const http=require('http'), path=require('path'), fs=require('fs');
const pp=require('/Users/wanglixiang/.claude/skills/mic-fullstack/scripts/online-reach/node_modules/puppeteer-core');
const WANT=(fs.readFileSync(path.join(__dirname,'..','bridge','uw-bridge.js'),'utf8').match(/^const VERSION\s*=\s*'(\d+\.\d+\.\d+)'/m)||[])[1];
if(!WANT){ console.log('❌ 在 bridge/uw-bridge.js 里没抽到 VERSION'); process.exit(1); }
const FAKE=17398; let mode='new'; const seen=[];
const srv=http.createServer((req,res)=>{
  const cors={'Access-Control-Allow-Origin':req.headers.origin||'*','Access-Control-Allow-Headers':'content-type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
  if(req.method==='OPTIONS'){ res.writeHead(204,cors); return res.end(); }
  if(req.url.startsWith('/health')){
    const h={ok:true,name:'uw-bridge',version:mode==='new'?WANT:mode==='mid'?'1.1.0':'1.0.0',allowed:true,claude:{found:true,via:'fcf'},busy:0,max:2};
    if(mode!=='old') h.web={ok:true,running:false,allow:['made-in-china.com','vemic.com'],maxUrls:3};
    if(mode==='new') h.terminal={ok:true,external:true,workRoot:'~/UW工作区'};
    res.writeHead(200,{...cors,'Content-Type':'application/json'}); return res.end(JSON.stringify(h)); }
  if(req.url.startsWith('/terminal/sessions')){ res.writeHead(200,{...cors,'Content-Type':'application/json'}); return res.end('{"sessions":[]}'); }
  let b=''; req.on('data',d=>b+=d); req.on('end',()=>{
    let body={}; try{ body=JSON.parse(b);}catch(e){} seen.push(body);
    res.writeHead(200,{...cors,'Content-Type':'text/event-stream'}); res.write(': uw-bridge\n\n');
    const w=(o)=>res.write('data: '+JSON.stringify(o)+'\n\n');
    if(body.urls&&body.urls.length){ w({uw:{status:'正在用浏览器读取 www.made-in-china.com …'},choices:[{index:0,delta:{},finish_reason:null}]}); }
    setTimeout(()=>{ w({choices:[{index:0,delta:{content:'这是 LED 分类搜索页，'},finish_reason:null}]});
      setTimeout(()=>{ w({choices:[{index:0,delta:{content:'有 101 张产品卡。'},finish_reason:null}]});
        const last={choices:[{index:0,delta:{},finish_reason:'stop'}]};
        if(body.urls&&body.urls.length) last.uw={web:[{url:body.urls[0],title:'China LED',ok:true,len:12737},{url:'https://example.com/',ok:false,error:'not_allowed',message:'这个网址不在桥的白名单里'}]};
        w(last); res.write('data: [DONE]\n\n'); res.end(); },600); },1400);
  });
});
(async()=>{
await new Promise(r=>srv.listen(FAKE,'127.0.0.1',r));
const b=await pp.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',args:['--no-sandbox','--allow-file-access-from-files'],defaultViewport:{width:1440,height:900}});
const p=await b.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(String(e.message).slice(0,120)));
await p.setRequestInterception(true);
p.on('request',r=>{ const u=r.url(); if(u.startsWith('http://127.0.0.1:17331')) r.continue({url:u.replace('17331',String(FAKE))}); else r.continue(); });
await p.evaluateOnNewDocument(()=>{ try{ localStorage.setItem('wb.bridge.dev','1'); sessionStorage.removeItem('wb.bridge.toast'); }catch(e){} });
const results={}; const ok=(k,v,detail)=>{ results[k]=(v?'✅ ':'❌ ')+k+(detail?('  '+detail):''); };
const run=async(q)=>{ await p.evaluate(q=>{ if(window.wbRun) return wbRun(q); const ta=document.getElementById('ta'); ta.value=q; ta.dispatchEvent(new Event('input')); const btn=document.querySelector('.cbar .send,.send,button[title*=发送]'); btn&&btn.click(); }, q); };
const head=()=>p.evaluate(()=>{ const s=document.querySelector('.ahead span'); return s?s.textContent:''; });
const toastTx=()=>p.evaluate(()=>{ const t=document.getElementById('toast'); return t?t.textContent:''; });
const openSet=()=>p.evaluate(()=>{ const m=document.getElementById('wbmask'); if(m) m.remove(); wbSettings(); const d=document.querySelector('#wbmask .wbdlg'); return d?d.innerText:''; });
const load=async()=>{ await p.goto('file:///Users/wanglixiang/Desktop/UED%20workbuddy/index.html',{waitUntil:'networkidle0'}); await new Promise(r=>setTimeout(r,900)); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// ── 新桥（同版本，功能齐）──
await load();
const hasBridge=await p.evaluate(()=>document.body.innerText.includes('Claude Opus'));
ok('页面探到假桥（模型列表出现 Claude Opus）',hasBridge);
const pageWant=await p.evaluate(()=>window.wbBridgeWant);
ok('页面里的目标版本 = bridge/uw-bridge.js 的 VERSION（'+WANT+'）',pageWant===WANT,JSON.stringify(pageWant));
const staleNew=await p.evaluate(()=>window.wbBridgeStale());
const setNew=await openSet();
ok('新桥：不报旧版（wbBridgeStale=false，设置里没有「桥是旧版」）',staleNew===false&&!/桥是旧版/.test(setNew)&&/已连上/.test(setNew));
ok('新桥：首次提示是「已连上…问答走它」而不是升级提示',/问答走它/.test(await toastTx()),JSON.stringify(await toastTx()));
const Q='看看 https://www.made-in-china.com/products-search/hot-china-products/LED.html 这个页面有多少产品？顺便 https://example.com/ 也看下。';
await p.evaluate(()=>{ const m=document.getElementById('wbmask'); if(m) m.remove(); });
await run(Q); await sleep(800);
const mid=await head(); ok('流式中途头部显示读取状态',/正在用浏览器读取/.test(mid),JSON.stringify(mid));
await sleep(2600);
const done=await head(); ok('答完头部写「读了 1 个网页」',/读了 1 个网页/.test(done),JSON.stringify(done));
const body=seen[seen.length-1]||{}; ok('请求体带 urls 且抽到两个网址',Array.isArray(body.urls)&&body.urls.length===2&&/LED\.html$/.test(body.urls[0])&&body.urls[1]==='https://example.com/',JSON.stringify(body.urls));
const fail=await p.evaluate(()=>document.body.innerText.includes('有网页没读到')&&document.body.innerText.includes('example.com'));
ok('没读到的网址列在回答下面',fail);
const ans=await p.evaluate(()=>document.querySelector('.atx')?document.querySelector('.atx').textContent:'');
ok('回答正文完整到达',/101 张产品卡/.test(ans),JSON.stringify(ans.slice(0,40)));
await p.screenshot({path:path.join(__dirname,'out','bridge-web-page.png'),clip:{x:280,y:0,width:1160,height:700}});

// ── 中桥（1.1.0：有 web 没 terminal）──
mode='mid'; seen.length=0;
await load();
const t1=await toastTx();
ok('中桥：首次提示说「旧版1.1.0」并指向设置里的安装命令',/旧版1\.1\.0/.test(t1)&&/安装命令/.test(t1)&&t1.includes(WANT),JSON.stringify(t1));
const setMid=await openSet();
ok('中桥：设置写清「桥是旧版1.1.0 / 需要'+WANT+'」',/桥是旧版1\.1\.0/.test(setMid)&&setMid.includes('需要'+WANT),JSON.stringify(setMid.slice(0,160)));
ok('中桥：缺的功能只列「接力到终端」，不列「读网页」',/升上去才有：接力到终端/.test(setMid)&&!/升上去才有：读网页/.test(setMid));
ok('中桥：设置里有可点复制的安装命令',/install\.sh \| bash/.test(setMid) && await p.evaluate(()=>!!document.querySelector('#wbmask code[onclick*="BRIDGE_CMD_PUB"]')));
ok('中桥：有「升级好了，再探一次」按钮',/升级好了，再探一次/.test(setMid));
// 再探一次：假桥还是 1.1.0 → 不给假绿、弹层还在
await p.evaluate(()=>{ wbBridgeRecheck(); }); await sleep(700);
const t2=await toastTx(); const stillOpen=await p.evaluate(()=>!!document.querySelector('#wbmask .wbdlg'));
ok('中桥：再探仍旧版 → 提示「还是1.1.0」且设置弹层不关',/还是1\.1\.0/.test(t2)&&stillOpen,JSON.stringify(t2));
await p.screenshot({path:path.join(__dirname,'out','bridge-stale-settings.png'),clip:{x:280,y:0,width:1160,height:760}});
await p.evaluate(()=>{ const m=document.getElementById('wbmask'); if(m) m.remove(); });
// 终端选择弹层
await p.evaluate(()=>{ wbHandoff({card:'测试卡',prompt:'测试任务单',chars:5}); }); await sleep(600);
const ch=await p.evaluate(()=>{ const b=document.getElementById('uwtBox'); return b?b.innerText:''; });
const chBtn=await p.evaluate(()=>!!document.querySelector('#uwtBox button[onclick="uwtCopyCmd()"]'));
ok('中桥：终端选择弹层说清「旧版1.1.0 / 要'+WANT+'」',/旧版1\.1\.0/.test(ch)&&ch.includes('要'+WANT),JSON.stringify(ch.slice(-120)));
ok('中桥：终端选择弹层有「复制升级命令」按钮',chBtn&&/复制升级命令/.test(ch));
const disabled=await p.evaluate(()=>[...document.querySelectorAll('#uwtBox .uwt-opt')].filter(x=>x.disabled).length);
ok('中桥：两条终端路都灰掉（2 个 disabled）',disabled===2,String(disabled));
await p.screenshot({path:path.join(__dirname,'out','bridge-stale-chooser.png'),clip:{x:280,y:0,width:1160,height:760}});
await p.evaluate(()=>uwtCloseChooser());

// ── 老桥（1.0.0：health 没 web）──
mode='old'; seen.length=0;
await load();
const setOld=await openSet();
ok('老桥：设置列出缺「读网页」和「接力到终端」两项',/升上去才有：读网页、接力到终端/.test(setOld),JSON.stringify((setOld.match(/升上去才有[^。]*/)||[''])[0]));
await p.evaluate(()=>{ const m=document.getElementById('wbmask'); if(m) m.remove(); });
await run(Q); await sleep(700);
const toast=await toastTx();
ok('老桥：带网址提问弹「升到'+WANT+'：设置里有安装命令」',toast.includes('升到'+WANT)&&/安装命令/.test(toast),JSON.stringify(toast));
await sleep(2600);
const body2=seen[seen.length-1]||{}; ok('老桥：请求体不带 urls',!body2.urls,JSON.stringify(body2.urls));
const head2=await head(); ok('老桥：头部不写「读了网页」',!/读了/.test(head2),JSON.stringify(head2));
ok('无 JS 错误',errs.length===0,errs.join(' | '));
await b.close(); srv.close();
Object.values(results).forEach(l=>console.log(l));
const bad=Object.values(results).filter(l=>l.startsWith('❌')).length; console.log(bad?('❌ '+bad+' 项未通过'):'✅ 页面侧读网页 + 桥新旧链路全通'); process.exit(bad?1:0);
})().catch(e=>{ console.log('ERR',e); process.exit(1); });
