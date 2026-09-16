// online-spec.js — 「照线上 1:1 还原响应式」第 1 步：把线上真值抽成机器可读答案(纯代码层·零截图)
// 为什么：照线上还原时，靠「脑子里对线上的印象 + 截图眼测」必漏(漏元素/间距错/断点错)。
//        先把线上每个断点的「元素在不在 + 精确几何 + 数量」抽成 spec.json 当答案 key，
//        再用 responsive-diff.js 逐断点对答案。全程 getBoundingClientRect/computedStyle，不看图。
//
// 用法：
//   1) 起后台 Chrome（同 reach.sh，端口 9224）
//   2) node online-spec.js --url "https://线上URL" --targets /abs/targets.json \
//        --widths "1600,1440,1280,1024,768" --out /abs/<页面>-online-spec.json [--state cookie.json]
//
// targets.json 格式（你要 1:1 对齐的元素清单，key=逻辑名·sel=线上选择器）：
// [
//   {"key":"header",   "sel":".nail-header"},
//   {"key":"headContent","sel":".nail-common"},           // 量左右间距(x/w)看内容内缩
//   {"key":"navGrid",  "sel":".nail-grid"},
//   {"key":"navItems", "sel":".nail-grid .business-item", "count":true},  // 各断点几个导航项可见
//   {"key":"logo",     "sel":".nail-logo"},
//   {"key":"search",   "sel":".nail-search-bar"},
//   {"key":"actions",  "sel":".nail-actions-wrap .nail-action-item", "count":true}, // 几个动作可见
//   {"key":"kingkong", "sel":".spotlight-wrap > *", "count":true}       // 金刚区几张卡
// ]
//
// 输出 spec.json：{ url, widths, targets:{key:sel}, data:{ 宽度:{ key:{present,x,w,right,padL,padR,padT,padB,count?} } } }
// present = 存在 && display!=none && 宽>0。count = 该 sel 下「可见」子元素个数(用于 4→3 卡 / 导航掉字段)。

const puppeteer = require(require('path').join(__dirname, 'node_modules', 'puppeteer-core'));
const fs = require('fs');
function arg(n, d){ const i=process.argv.indexOf('--'+n); if(i<0) return d; const v=process.argv[i+1]; return (v&&!v.startsWith('--'))?v:true; }

(async () => {
  const port=arg('port','9224'), url=arg('url'), targetsPath=arg('targets'), out=arg('out'), state=arg('state');
  const widths=String(arg('widths','1600,1440,1280,1024,768')).split(',').map(s=>parseInt(s,10)).filter(Boolean);
  if(!url||!targetsPath||!out){ console.log('ERR need --url --targets --out'); process.exit(2); }
  const targets=JSON.parse(fs.readFileSync(targetsPath,'utf8'));

  const b=await puppeteer.connect({ browserURL:'http://localhost:'+port, defaultViewport:null });
  const p=await b.newPage();
  if(state){ try{ const cs=JSON.parse(fs.readFileSync(state,'utf8')); await p.setCookie(...cs); }catch(e){ console.log('COOKIE_ERR '+e.message); } }
  await p.setViewport({ width:widths[0], height:900 });
  await p.goto(url,{ waitUntil:'domcontentloaded', timeout:60000 }).catch(e=>console.log('goto warn '+e.message));
  await new Promise(r=>setTimeout(r,3500));
  await p.evaluate(async()=>{ for(let y=0;y<2400;y+=600){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,300));} window.scrollTo(0,0); });
  await new Promise(r=>setTimeout(r,600));

  const measure = (targets) => {
    const vis = el => { if(!el) return false; const cs=getComputedStyle(el); const r=el.getBoundingClientRect(); return cs.display!=='none' && cs.visibility!=='hidden' && r.width>0.5; };
    const g = el => { const r=el.getBoundingClientRect(); const cs=getComputedStyle(el); const n=v=>Math.round((parseFloat(v)||0));
      return { present:true, x:Math.round(r.x), w:Math.round(r.width), right:Math.round(r.right),
        padL:n(cs.paddingLeft), padR:n(cs.paddingRight), padT:n(cs.paddingTop), padB:n(cs.paddingBottom) }; };
    const o={};
    for(const t of targets){
      if(t.count){ const all=[...document.querySelectorAll(t.sel)]; const v=all.filter(vis); o[t.key]={ present:v.length>0, count:v.length,
        x:v[0]?Math.round(v[0].getBoundingClientRect().x):null, right:v[v.length-1]?Math.round(v[v.length-1].getBoundingClientRect().right):null }; }
      else { const el=[...document.querySelectorAll(t.sel)].find(vis); o[t.key]= el? g(el) : { present:false }; }
    }
    return o;
  };

  const data={};
  for(const w of widths){
    await p.setViewport({ width:w, height:900 });
    await new Promise(r=>setTimeout(r,600));
    data[w]=await p.evaluate(measure, targets);
    const box=data[w];
    const brief=targets.map(t=>{ const e=box[t.key]; if(!e.present) return t.key+':✗无'; if(e.count!=null) return t.key+':×'+e.count; return t.key+':@'+e.x+'/w'+e.w; }).join('  ');
    console.log('抽 vp'+w+':', brief);
  }
  const spec={ url, widths, targets:Object.fromEntries(targets.map(t=>[t.key, t.sel])), counts:Object.fromEntries(targets.filter(t=>t.count).map(t=>[t.key,true])), data };
  fs.writeFileSync(out, JSON.stringify(spec,null,1));
  console.log('\n✅ 线上答案已抽 → '+out+'（'+widths.length+' 档 × '+targets.length+' 元素）');
  await p.close(); await b.disconnect(); process.exit(0);
})().catch(e=>{ console.log('ERR '+e.message); process.exit(2); });
