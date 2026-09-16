// responsive-diff.js — 「照线上 1:1 还原响应式」第 3 步：本地产出「逐断点」对线上答案(纯代码层·零截图)
// 为什么：截图眼测抓不到「漏元素/差 20px 间距/断点错位」——这些看着「差不多」一量就错。
//        本脚本用同一套选择器，在 spec 的每个断点，量本地 HTML 的元素 present/x/w/padding/count，
//        跟线上答案逐项 diff，超容差报红。「完成」= 全绿 exit0，不靠肉眼。
//
// 用法：
//   1) 起后台 Chrome（同 reach.sh，端口 9224）
//   2) node responsive-diff.js --url "file:///abs/我的.html" --spec /abs/<页面>-online-spec.json \
//        [--map /abs/map.json] [--tol 3]
//
// map.json（可选）：线上选择器 ≠ 本地选择器时，给 {逻辑key: 本地选择器}。缺省用 spec 里的线上 sel。
//   { "navItems":".nail-grid .biz-side > *", "kingkong":".hero-list .hl-item", "actions":".nail-actions .na-item" }
//
// 判定：present 必须一致；count（如金刚区卡数/导航项数）必须一致；x/w/padL/padR 在 ±tol 内。
// 全绿 → 写 ~/.online-reach-state/geom-check.pass（复用 geom-check 的 Stop 门放行·不另立门）。

const puppeteer = require(require('path').join(__dirname, 'node_modules', 'puppeteer-core'));
const fs = require('fs');
function arg(n, d){ const i=process.argv.indexOf('--'+n); if(i<0) return d; const v=process.argv[i+1]; return (v&&!v.startsWith('--'))?v:true; }

(async () => {
  const port=arg('port','9224'), url=arg('url'), specPath=arg('spec'), mapPath=arg('map'), tol=parseFloat(arg('tol','3'));
  if(!url||!specPath){ console.log('ERR need --url --spec'); process.exit(2); }
  const spec=JSON.parse(fs.readFileSync(specPath,'utf8'));
  const map = mapPath? JSON.parse(fs.readFileSync(mapPath,'utf8')) : {};
  const localSel = key => map[key] || spec.targets[key];

  const b=await puppeteer.connect({ browserURL:'http://localhost:'+port, defaultViewport:null });
  const p=await b.newPage();
  await p.goto(url,{ waitUntil:'domcontentloaded', timeout:45000 }).catch(e=>console.log('goto warn '+e.message));
  await new Promise(r=>setTimeout(r,1200));

  const measure = (jobs) => {
    const vis = el => { if(!el) return false; const cs=getComputedStyle(el); const r=el.getBoundingClientRect(); return cs.display!=='none' && cs.visibility!=='hidden' && r.width>0.5; };
    const o={};
    for(const j of jobs){
      if(j.count){ const all=[...document.querySelectorAll(j.sel)]; const v=all.filter(vis); o[j.key]={ present:v.length>0, count:v.length, x:v[0]?Math.round(v[0].getBoundingClientRect().x):null }; }
      else { const el=[...document.querySelectorAll(j.sel)].find(vis); if(!el){ o[j.key]={present:false}; continue; }
        const r=el.getBoundingClientRect(), cs=getComputedStyle(el); const n=v=>Math.round(parseFloat(v)||0);
        o[j.key]={ present:true, x:Math.round(r.x), w:Math.round(r.width), right:Math.round(r.right), padL:n(cs.paddingLeft), padR:n(cs.paddingRight) }; }
    }
    return o;
  };

  let fail=0; const lines=[];
  for(const w of spec.widths){
    await p.setViewport({ width:w, height:900 });
    await new Promise(r=>setTimeout(r,500));
    const jobs = Object.keys(spec.targets).map(k=>({ key:k, sel:localSel(k), count: spec.counts && spec.counts[k] }));
    const mine = await p.evaluate(measure, jobs);
    lines.push('── vp'+w+' ──');
    for(const k of Object.keys(spec.targets)){
      const want=spec.data[w][k], got=mine[k];
      if(!want){ continue; }
      if(want.present!==got.present){ lines.push(`❌ ${k}: present 期望${want.present} 实际${got.present}`); fail++; continue; }
      if(!want.present){ lines.push(`✅ ${k} (两边都无·符合)`); continue; }
      const diffs=[];
      if(spec.counts && spec.counts[k]){ if(want.count!==got.count) diffs.push(`count 期望${want.count} 实际${got.count}`); }
      else { for(const f of ['x','w','padL','padR']){ if(want[f]==null||got[f]==null) continue; if(Math.abs(want[f]-got[f])>tol) diffs.push(`${f} 期望${want[f]} 实际${got[f]}`); } }
      if(diffs.length){ lines.push(`❌ ${k}: ${diffs.join(' | ')}`); fail++; }
      else lines.push(`✅ ${k}`);
    }
  }
  console.log('\n照线上响应式·逐断点代码层 diff  容差±'+tol+'px  spec='+specPath.split('/').pop()+'\n');
  console.log(lines.join('\n'));
  console.log(`\n结果：${fail===0?'全绿 ✅ 每个断点都跟线上对齐':'有 '+fail+' 项不符 ❌（修完再跑直到全绿·别靠截图看差不多）'}\n`);
  if(fail===0){ try{ const sd=require('os').homedir()+'/.online-reach-state'; fs.mkdirSync(sd,{recursive:true}); fs.writeFileSync(sd+'/geom-check.pass', String(Date.now())); }catch(e){} }
  await p.close(); await b.disconnect(); process.exit(fail===0?0:1);
})().catch(e=>{ console.log('ERR '+e.message); process.exit(2); });
