// responsive-spec-extract.js — 「照线上 1:1 复刻响应式」的【穷举提取】工具（纯代码层·零截图）
// ─────────────────────────────────────────────────────────────────────────────
// 为什么有这个脚本（2026-07-02 沉淀·治「读了很多次线上还反复改」的病）：
//   老 online-spec.js 要你①手动传 --widths(猜断点) ②手写 targets ③只抽 x/w/padL/padR/count。
//   结果：随宽度变的值(logo margin-right 50/20)、无 max 的流式、断点到底在 1279 还是 1280、
//   组件 min/max 规范——这些【不会自动暴露】，全靠人肉一次次猜 → 就是反复改的根源。
//   本脚本做【穷举】：自动扫全宽度找断点 + 抓全属性(margin/min/max/gap/flex) + dump 带 media 的 CSS 规则。
//   铁律：随宽度变的值抓的是「函数」不是「点」——绝不在单一宽度读一次就当常量。
//
// ── 模式 1：extract（从线上抽完整规格）──────────────────────────────────────
//   node responsive-spec-extract.js --url "https://线上URL" --targets /abs/targets.json \
//     --range 375-1920 --step 20 --out /abs/<页面>-spec.json [--state cookie.json]
//   输出：断点清单(自动检测) + 每断点每元素全属性 + 命中的 CSS 规则(含 @media 条件) + 建议 --widths
//
// ── 模式 2：diff（本地 HTML 逐断点对线上答案·全属性·全绿写 geom-check.pass）─────
//   node responsive-spec-extract.js --diff "file:///abs/我的.html" --spec /abs/<页面>-spec.json \
//     [--map /abs/map.json] [--tol 2]
//   比 online 老 responsive-diff.js 多查 margin/min-width/max-width/gap/flex(就是老工具漏掉、害我反复改的那些)。
//
// targets.json：[{"key":"logo","sel":".nail-logo"},{"key":"actions","sel":".nail-actions .na-item","count":true}, ...]
//   count:true = 该 sel 下「可见」子元素个数 + 每行个数(perRow·抓「一行最少几个」的最小值规范)。
// map.json（diff 时线上 sel≠本地 sel）：{"logo":".nail-logo","actions":".nail-actions .na-item"}
const puppeteer = require(require('path').join(__dirname, 'node_modules', 'puppeteer-core'));
const fs = require('fs');
function arg(n, d){ const i=process.argv.indexOf('--'+n); if(i<0) return d; const v=process.argv[i+1]; return (v&&!v.startsWith('--'))?v:true; }

// 页面内测量：抓「全属性」。几何(x/w/right/h)是流式连续量；样式(margin/pad/min/max/gap/flex/display)是断点阶跃量。
const MEASURE = function(targets){
  const vis = el => { if(!el) return false; const cs=getComputedStyle(el); const r=el.getBoundingClientRect(); return cs.display!=='none'&&cs.visibility!=='hidden'&&r.width>0.5; };
  const n = v => Math.round((parseFloat(v)||0)*100)/100;
  const styleOf = el => { const cs=getComputedStyle(el), r=el.getBoundingClientRect();
    return { present:true, x:Math.round(r.x), w:Math.round(r.width), right:Math.round(r.right), h:Math.round(r.height), top:Math.round(r.top),
      mL:n(cs.marginLeft), mR:n(cs.marginRight), mT:n(cs.marginTop), mB:n(cs.marginBottom),
      pL:n(cs.paddingLeft), pR:n(cs.paddingRight), pT:n(cs.paddingTop), pB:n(cs.paddingBottom),
      gap:cs.columnGap==='normal'?(cs.gap||'0'):cs.columnGap, minW:cs.minWidth, maxW:cs.maxWidth,
      flex:cs.flex, fontSize:n(cs.fontSize), display:cs.display, position:cs.position }; };
  const o={};
  for(const t of targets){
    if(t.count){ const v=[...document.querySelectorAll(t.sel)].filter(vis);
      const tops={}; v.forEach(e=>{ const tp=Math.round(e.getBoundingClientRect().top); tops[tp]=(tops[tp]||0)+1; });
      o[t.key]={ present:v.length>0, count:v.length, perRow: v.length?Object.values(tops)[0]:0, rows:Object.keys(tops).length, first: v[0]?styleOf(v[0]):null };
    } else { const el=[...document.querySelectorAll(t.sel)].find(vis); o[t.key]= el?styleOf(el):{present:false}; }
  }
  // 整页横向溢出/锁定信号(抓 min-width 地板)
  o.__doc = { scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth, overflow: document.documentElement.scrollWidth>window.innerWidth+1 };
  return o;
};

// 断点签名：只用「阶跃量」(样式/present/count/perRow)，排除流式几何(x/w/right/h/top) → 签名变化处 = 真断点
function sig(box){
  return Object.keys(box).filter(k=>k!=='__doc').sort().map(k=>{
    const e=box[k]; if(!e||!e.present) return k+':✗';
    if(e.count!=null){ const f=e.first; return `${k}:n${e.count}/row${e.perRow}`+(f?`/mL${f.mL}/pL${f.pL}/pR${f.pR}`:''); }
    return `${k}:mL${e.mL}/mR${e.mR}/pL${e.pL}/pR${e.pR}/gap${e.gap}/min${e.minW}/max${e.maxW}/flex${e.flex}/${e.display}/${e.position}/fs${e.fontSize}`;
  }).join(' | ') + (box.__doc? ` |lock:${box.__doc.overflow}` : '');
}

async function connect(){ return puppeteer.connect({ browserURL:'http://localhost:'+arg('port','9224'), defaultViewport:null }); }
async function load(p, url, state){
  if(state){ try{ const cs=JSON.parse(fs.readFileSync(state,'utf8')).cookies||JSON.parse(fs.readFileSync(state,'utf8')); await p.setCookie(...cs); }catch(e){ console.log('COOKIE_ERR '+e.message); } }
  await p.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36');
  await p.goto(url,{ waitUntil:'domcontentloaded', timeout:60000 }).catch(e=>console.log('goto warn '+e.message));
  await new Promise(r=>setTimeout(r,1800));
  await p.evaluate(async()=>{ for(let y=0;y<3000;y+=700){ scrollTo(0,y); await new Promise(r=>setTimeout(r,120)); } scrollTo(0,0); });
  await new Promise(r=>setTimeout(r,500));
}
async function measureAt(p, w, targets){ await p.setViewport({ width:w, height:900 }); await new Promise(r=>setTimeout(r,220)); return p.evaluate(MEASURE, targets); }

(async () => {
  const targetsPath=arg('targets'), out=arg('out'), state=arg('state'), diffUrl=arg('diff');

  // ══════════ 模式 2：diff（本地对线上答案·全属性）══════════
  if(diffUrl){
    const spec=JSON.parse(fs.readFileSync(arg('spec'),'utf8'));
    const map = arg('map')? JSON.parse(fs.readFileSync(arg('map'),'utf8')) : {};
    const tol=parseFloat(arg('tol','2'));
    const b=await connect(); const p=await b.newPage(); await load(p, diffUrl, null);
    const targets=Object.keys(spec.targets).map(k=>({ key:k, sel: map[k]||spec.targets[k], count: spec.counts&&spec.counts[k] }));
    let fail=0; const out2=[];
    const GEO=['x','w'], STY=['mL','mR','pL','pR','minW','maxW','gap','flex','display'];
    for(const w of spec.widths){
      const mine=await measureAt(p, w, targets); out2.push('── vp'+w+' ──');
      for(const t of targets){ const want=spec.data[w][t.key], got=mine[t.key]; if(!want) continue;
        if(want.present!==got.present){ out2.push(`❌ ${t.key}: present 期望${want.present} 实际${got.present}`); fail++; continue; }
        if(!want.present){ out2.push(`✅ ${t.key}(两边都无)`); continue; }
        const d=[];
        if(t.count){ if(want.count!==got.count) d.push(`count ${want.count}→${got.count}`); if(want.perRow!==got.perRow) d.push(`perRow ${want.perRow}→${got.perRow}`);
          if(want.first&&got.first) for(const f of ['mL','pL','pR']){ if(Math.abs(want.first[f]-got.first[f])>tol) d.push(`${f} ${want.first[f]}→${got.first[f]}`); } }
        else { for(const f of GEO){ if(want[f]==null||got[f]==null)continue; if(Math.abs(want[f]-got[f])>tol) d.push(`${f} ${want[f]}→${got[f]}`); }
          for(const f of STY){ if(want[f]==null)continue; if(String(want[f])!==String(got[f])) d.push(`${f} 期望${want[f]} 实际${got[f]}`); } }
        if(d.length){ out2.push(`❌ ${t.key}: ${d.join(' | ')}`); fail++; } else out2.push(`✅ ${t.key}`);
      }
    }
    console.log('\n照线上·逐断点·全属性 diff  容差±'+tol+'px  spec='+arg('spec').split('/').pop()+'\n');
    console.log(out2.join('\n'));
    console.log(`\n结果：${fail===0?'全绿 ✅ 每个断点·每个属性(含 margin/min/max/gap)都跟线上对齐':'有 '+fail+' 项不符 ❌ 修完再跑·别靠截图'}\n`);
    if(fail===0){ try{ const sd=require('os').homedir()+'/.online-reach-state'; fs.mkdirSync(sd,{recursive:true}); fs.writeFileSync(sd+'/geom-check.pass', String(process.pid)); }catch(e){} }
    await p.close(); await b.disconnect(); process.exit(fail===0?0:1);
  }

  // ══════════ 模式 1：extract（线上穷举 → 完整规格 + 自动断点）══════════
  const url=arg('url'); if(!url||!targetsPath||!out){ console.log('ERR extract 需 --url --targets --out（或 diff 模式用 --diff --spec）'); process.exit(2); }
  const targets=JSON.parse(fs.readFileSync(targetsPath,'utf8'));
  const [rmin,rmax]=String(arg('range','375-1920')).split('-').map(Number);
  const step=parseInt(arg('step','20'),10);
  const b=await connect(); const p=await b.newPage(); await load(p, url, state);

  // 1) 粗扫（step 步长）拿每个宽度的签名
  console.log('穷举扫描 '+rmax+'→'+rmin+' 步长'+step+' …');
  const coarse=[]; for(let w=rmax; w>=rmin; w-=step){ const box=await measureAt(p,w,targets); coarse.push({ w, box, s:sig(box) }); }
  // 2) 相邻签名不同 = 断点区间 → 二分逼到 1px
  const bps=[];
  for(let i=0;i<coarse.length-1;i++){ if(coarse[i].s!==coarse[i+1].s){
    let hi=coarse[i].w, lo=coarse[i+1].w, sHi=coarse[i].s; // hi 保持 == sHi 的最大宽·lo 为已变
    while(hi-lo>1){ const mid=Math.floor((hi+lo)/2); const s=sig(await measureAt(p,mid,targets)); if(s===sHi) hi=mid; else lo=mid; }
    bps.push(lo); // lo = 「进入新布局」的最大宽度(断点), lo 与 lo+1(=hi) 分属两侧
  }}
  const breakpoints=[...new Set(bps)].sort((a,b2)=>a-b2);

  // 3) 采样宽度 = 每个断点两侧(bp / bp+1) + 各区间中点 + 端点，去重
  const sample=new Set([rmax,rmin]);
  breakpoints.forEach(bp=>{ sample.add(bp); sample.add(Math.min(rmax,bp+1)); });
  const bpsSorted=[rmax,...breakpoints,rmin].sort((a,b2)=>b2-a);
  for(let i=0;i<bpsSorted.length-1;i++){ sample.add(Math.round((bpsSorted[i]+bpsSorted[i+1])/2)); }
  const widths=[...sample].filter(w=>w>=rmin&&w<=rmax).sort((a,b2)=>b2-a);

  // 4) 在采样宽度抓全属性
  const data={}; for(const w of widths){ data[w]=await measureAt(p,w,targets); }

  // 5) dump 命中的 CSS 规则(含 @media 条件) —— 就是这一步当初才让我真正搞懂线上机制
  const tokens=[...new Set(targets.flatMap(t=>t.sel.split(/[\s>+~,]+/).filter(x=>/^[.#][\w-]+/.test(x)).map(x=>x.replace(/[.#]/,''))))];
  const cssRules=await p.evaluate((tokens)=>{
    const want=new RegExp(tokens.map(t=>t.replace(/[-\/\\^$*+?.()|[\]{}]/g,'\\$&')).join('|'),'i'); const res=[];
    for(const ss of document.styleSheets){ let list; try{ list=ss.cssRules; }catch(e){ continue; } if(!list) continue;
      const walk=(rl,media)=>{ for(const r of rl){ if(r.type===4) walk(r.cssRules, r.conditionText||r.media.mediaText);
        else if(r.selectorText && want.test(r.selectorText)){ const st=r.style; const props=[];
          for(const k of ['width','min-width','max-width','flex','flex-basis','margin','margin-left','margin-right','padding','padding-left','padding-right','gap','column-gap','display','position']){ const v=st.getPropertyValue(k); if(v) props.push(k+':'+v); }
          if(props.length) res.push({ media:media||'(base)', sel:r.selectorText, props:props.join('; ') }); } } };
      walk(list,''); }
    return res;
  }, tokens);

  // 6) 输出（spec.json 与 diff 模式互通）
  const spec={ url, range:[rmin,rmax], step, breakpoints, widths,
    targets:Object.fromEntries(targets.map(t=>[t.key,t.sel])), counts:Object.fromEntries(targets.filter(t=>t.count).map(t=>[t.key,true])),
    data, cssRules };
  fs.writeFileSync(out, JSON.stringify(spec,null,1));

  // 7) 人读报告
  console.log('\n🔎 自动检测到断点(px·左右分属两套样式)： '+(breakpoints.length?breakpoints.join(' / '):'无(全程流式无阶跃)'));
  console.log('   采样宽度： '+widths.join(', '));
  console.log('\n📐 各元素随宽度变化（挑关键属性·完整见 '+out.split('/').pop()+'）：');
  for(const t of targets){ const row=widths.map(w=>{ const e=data[w][t.key]; if(!e||!e.present) return 'vp'+w+':✗';
    return t.count? `vp${w}:n${e.count}/行${e.perRow}` : `vp${w}:w${e.w}/mL${e.first?e.first.mL:e[ 'mL']}`; });
    // 简洁行：非 count 显示 w + 关键 margin/min/max
    const line=widths.map(w=>{ const e=data[w][t.key]; if(!e||!e.present) return 'vp'+w+'✗';
      return t.count? `${w}:n${e.count}行${e.perRow}` : `${w}:w${e.w} mL${e.mL} min${e.minW} max${e.maxW}`; }).join('  |  ');
    console.log('  ['+t.key+'] '+line); }
  console.log('\n🎯 命中 CSS 规则(含 @media·真断点来源)：'+cssRules.length+' 条 →');
  cssRules.slice(0,40).forEach(r=>console.log('   @'+r.media+'  '+r.sel+'  { '+r.props+' }'));
  if(cssRules.length>40) console.log('   …(其余见 '+out.split('/').pop()+' 的 cssRules)');
  console.log('\n✅ 完整规格已抽 → '+out);
  console.log('   下一步：本地做完 → node responsive-spec-extract.js --diff "file:///abs/我的.html" --spec '+out+' [--map map.json]  逐断点全属性对答案·全绿才算 1:1');
  await p.close(); await b.disconnect(); process.exit(0);
})().catch(e=>{ console.log('ERR '+e.message); process.exit(2); });
