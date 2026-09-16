// geom-check.js — Figma 还原「逐值机械核对」门
// 用途：把 Figma spec 的盒模型值喂进来，渲染 HTML，逐个量每个匹配元素，不符就报红。
//       「完成」= 全绿(diff 为空)，不靠肉眼看。
//
// ── 两种喂值方式 ──────────────────────────────────────────────────────────
// A) 手写 --checks（老方式，仍完全支持）：
//      node geom-check.js --port 9224 --url "file:///abs/x.html" --checks /abs/checks.json --vw 1920
//    checks.json 格式（每个元素一条；值=Figma spec 的 CSS px，留空=不查该项）：
//    [
//      {"sel":".hl-img .s2 img", "label":"金刚②SMART EXPO图", "w":69, "h":70},
//      {"sel":".ss-card", "all":true, "label":"Sourcing 4卡", "h":403},
//      {"sel":".ind-cell", "all":true, "label":"行业格", "w":285,"h":189,"br":1,"bb":1}
//    ]
//    支持键：w h（boundingRect）/ pt pr pb pl（padding）/ bt br bb bl（border宽）/ rad（圆角）/ fs（font-size）/ fw（font-weight）
//    all:true = 检查所有匹配元素（默认只查第 idx 个，idx 默认 0）
//
// B) 自动 --figma-spec（新·首选·免手抄值）：
//      node geom-check.js --port 9224 --url "file:///abs/x.html" --figma-spec /abs/<页面>-manifest.json --vw 1920
//    读 figma-restore-dump.snippet.js 产出的 nodes（Figma 每个节点的真值），
//    DOM-driven 对位：扫页面里所有 [data-node-id]，逐个跟 Figma 同 id 节点的真值比。
//    → 你只需还原时给元素打 data-node-id，无需手写 checks.json。
//    · DOM 里有 data-node-id 但 Figma 无 → ⚠️ 提示（多半是 id 写错/过期，不判失败）
//    · Figma 有但 DOM 没建 → ℹ️ 计数（完整性归 coverage-check 管，这里不判失败）
//    · TEXT 节点默认跳过 w/h 对比（文字盒受 line-height/padding 影响易假红），加 --text-wh 才查
//    · 🧩 手工注入的内联 <svg>（自己没有 node-id）单独核一维：实测盒必须等于**宿主节点**的 manifest 真值。
//      治「SVG 被宿主 padding 压扁 / 塞错层级溢出容器」这两类——三道门都够不着（2026-09-01）。--skip-inline-svg 关
//
// 自动侦测渲染缩放：用 --ref-sel/--ref-w（默认 .page=1440），把量到的值归一回 spec CSS px。

const puppeteer = require(require('path').join(__dirname, 'node_modules', 'puppeteer-core'));
const fs = require('fs');
function arg(n, d){ const i=process.argv.indexOf('--'+n); if(i<0) return d; const v=process.argv[i+1]; return (v&&!v.startsWith('--'))?v:true; }

// fs/fw 不在这里了（2026-07-28）：字号/字重是**离散的设计值**，不是量出来的几何，
// 套 ±1.6px 的几何容差等于放行「36 写成 35」（造错例实测漏网；飞鹊还禁奇数字号）。改到下面精确比。
const KEYS = ['w','h','pt','pr','pb','pl','bt','br','bb','bl','rad'];
const EXACT_KEYS = ['fs','fw'];   // 精确比（留 0.5 的浮点余量，仍抓得到差 1px）

function stampPass(mode, extra){
  // 记录「通过模式」：figma-spec=读 Figma 真值自动核(骗不了人)；checks=手写值(可能人肉抄错)。
  // 交付门据此只认 figma-spec 模式的绿(node-backed 还原)，杜绝「手抄错值也绿」。
  // extra（2026-07-21 根治多块残缝地基）：{url, spec(manifest绝对路径), topLevel} → 除全局 geom-check.pass
  //   外，另维护 per-spec 台账 geom-pass-by-spec.json，让门能判「改的这页 url·哪些 manifest·有没有顶层根被重验」。
  // sid（2026-07-26 根治并发会话假绿）：盖章时记下**哪个会话**跑绿的。Stop 门只认自己会话的 pass——
  //   微信桥的无头 claude -p 与手上这个会话并行、共用 ~/.online-reach-state/，原来它跑绿我也被算成核过。
  //   CLAUDE_CODE_SESSION_ID 是 Bash 工具环境里的会话 id，与 hook 收到的 session_id 同值。
  try{
    const sid=process.env.CLAUDE_CODE_SESSION_ID||'';
    const sd=require('os').homedir()+'/.online-reach-state'; fs.mkdirSync(sd,{recursive:true});
    const rec={t:Date.now(),mode:mode||'checks',sid};
    if(extra){ if(extra.url) rec.url=extra.url; if(extra.spec) rec.spec=extra.spec; if(extra.topLevel!=null) rec.topLevel=!!extra.topLevel; }
    fs.writeFileSync(sd+'/geom-check.pass', JSON.stringify(rec));
    if(extra && extra.spec){
      const lf=sd+'/geom-pass-by-spec.json'; let led={};
      try{ led=JSON.parse(fs.readFileSync(lf,'utf8'))||{}; }catch(e){}
      led[extra.spec]={t:rec.t, mode:rec.mode, url:extra.url||null, topLevel:!!extra.topLevel, sid};
      fs.writeFileSync(lf, JSON.stringify(led));
    }
  }catch(e){}
}

// 图标颜色审计（2026-07-09 根治「Figma SVG 占位色不可信→图标颜色错了却全绿」）：
// 扫 HTML 引用/内联的 SVG 里 var(--fill/stroke-*,占位)，占位默认不可信 → 计入 fail，逼你拿 Figma 真值核实后硬编码。
function scanSvgColorsFromHtml(url){
  const path=require('path'); const out=[];
  if(!/^file:\/\//.test(url)) return out;
  const htmlPath=decodeURIComponent(url.replace(/^file:\/\//,'').split('#')[0].split('?')[0]);
  let html; try{ html=fs.readFileSync(htmlPath,'utf8'); }catch(e){ return out; }
  const dir=path.dirname(htmlPath);
  const VAR_RE=/(fill|stroke)\s*=\s*"var\(--(?:fill|stroke)-\d+,\s*([^)]*)\)"/gi;
  function scan(label,text){ let m; const f=[]; VAR_RE.lastIndex=0; while((m=VAR_RE.exec(text))!==null) f.push(`${m[1]}占位「${m[2].trim()}」`); if(f.length) out.push({label,defs:f}); }
  for(const s of new Set([...html.matchAll(/<img[^>]+src="([^"]+\.svg)"/gi)].map(x=>x[1]))){
    if(/^https?:|^data:/.test(s)) continue;
    try{ scan(s, fs.readFileSync(path.resolve(dir,s),'utf8')); }catch(e){}
  }
  (html.match(/<svg[\s\S]*?<\/svg>/gi)||[]).forEach((s,i)=>scan('inline svg#'+(i+1),s));
  (html.match(/data:image\/svg\+xml[^"')]+/gi)||[]).forEach((d,i)=>{ let dec=''; try{ dec=d.includes(';base64,')?Buffer.from(d.split(';base64,')[1],'base64').toString('utf8'):decodeURIComponent(d.split(',')[1]||''); }catch(e){} if(dec) scan('data-uri svg#'+(i+1),dec); });
  return out;
}

// SVG 宽高比修坑（2026-07-15 根治「Figma 下载 svg 带 preserveAspectRatio="none"→图标按容器强行拉伸变形·却全绿」）：
// 下载的 Figma svg 常带 preserveAspectRatio="none"（配 width/height="100%"），会撑满容器、破坏图标原始比例。
// 扫 HTML 引用/内联/data-uri 的 svg，命中即计入 fail，逼你改成真实 width/height（数值取 viewBox·见子 skill 第 3.2 节）。
function scanSvgAspectFromHtml(url){
  const path=require('path'); const out=[];
  if(!/^file:\/\//.test(url)) return out;
  const htmlPath=decodeURIComponent(url.replace(/^file:\/\//,'').split('#')[0].split('?')[0]);
  let html; try{ html=fs.readFileSync(htmlPath,'utf8'); }catch(e){ return out; }
  const dir=path.dirname(htmlPath);
  const RE=/preserveAspectRatio\s*=\s*["']none["']/i;
  const check=(label,text)=>{ if(RE.test(text)) out.push(label); };
  for(const s of new Set([...html.matchAll(/<img[^>]+src="([^"]+\.svg)"/gi)].map(x=>x[1]))){
    if(/^https?:|^data:/.test(s)) continue;
    try{ check(s, fs.readFileSync(path.resolve(dir,s),'utf8')); }catch(e){}
  }
  (html.match(/<svg[\s\S]*?<\/svg>/gi)||[]).forEach((s,i)=>check('inline svg#'+(i+1),s));
  (html.match(/data:image\/svg\+xml[^"')]+/gi)||[]).forEach((d,i)=>{ let dec=''; try{ dec=d.includes(';base64,')?Buffer.from(d.split(';base64,')[1],'base64').toString('utf8'):decodeURIComponent(d.split(',')[1]||''); }catch(e){} if(dec) check('data-uri svg#'+(i+1),dec); });
  return out;
}

(async () => {
  const port=arg('port','9224'), url=arg('url'), checksPath=arg('checks'), figmaSpecPath=arg('figma-spec');
  const refSel=arg('ref-sel','.page'), refW=parseFloat(arg('ref-w','1440')), tol=parseFloat(arg('tol','1.6'));
  const textWH = !!arg('text-wh');
  const cssCenterOnly = !!arg('css-center');
  if(!url || (!checksPath && !figmaSpecPath && !cssCenterOnly)){ console.log('ERR need --url and (--checks or --figma-spec or --css-center)'); process.exit(2); }

  const b=await puppeteer.connect({ browserURL:'http://localhost:'+port, defaultViewport:{ width:parseInt(arg('vw','1440'),10), height:parseInt(arg('vh','1000'),10) } });
  const p=await b.newPage();
  await p.goto(url,{ waitUntil:'networkidle2', timeout:45000 }).catch(()=>p.goto(url,{waitUntil:'domcontentloaded'}));
  await p.evaluate(async()=>{ for(let y=0;y<5000;y+=700){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,120));} window.scrollTo(0,0); });
  await new Promise(r=>setTimeout(r,600));

  // ── 模式 C：--css-center 纯 CSS 声明式居中自检（从零写的 HTML·无需 Figma manifest）──
  // 凡 flex 容器 align-items:center，验证直接子元素交叉轴中心真对齐了（横向→center-Y / 纵向→center-X）。
  // 治「从零写页面时中心点不在同一水平线」：抓「声明了居中却被别的 CSS 顶掉没生效」。
  // 护栏：子元素 align-self 覆盖了居中(flex-start/end/baseline)则排除·绝对定位排除·<2 子跳过·容差 3px。
  if(cssCenterOnly){
    const issues = await p.evaluate((ctol)=>{
      const out=[];
      const els=[...document.querySelectorAll('*')];
      for(const c of els){
        const cs=getComputedStyle(c);
        if(cs.display!=='flex' && cs.display!=='inline-flex') continue;
        if(cs.alignItems!=='center') continue;
        const row = !String(cs.flexDirection).startsWith('column');
        const kids=[...c.children].filter(k=>{
          const ks=getComputedStyle(k);
          if(ks.display==='none' || ks.position==='absolute') return false;
          if(['flex-start','flex-end','baseline','start','end','self-start','self-end'].includes(ks.alignSelf)) return false; // 自己覆盖了居中
          return true;
        });
        if(kids.length<2) continue;
        const centers=kids.map(k=>{ const r=k.getBoundingClientRect(); return row ? r.top+r.height/2 : r.left+r.width/2; });
        const spread=Math.max(...centers)-Math.min(...centers);
        if(spread>ctol){
          const sel=c.tagName.toLowerCase()+(c.className?('.'+String(c.className).trim().split(/\s+/)[0]):'')+(c.id?('#'+c.id):'');
          out.push({sel, axis: row?'Y(同一水平线)':'X(同一竖线)', spread: Math.round(spread*10)/10, n: kids.length});
        }
      }
      return out;
    }, 3);
    console.log(`\n[--css-center 声明式居中自检] 检查所有 align-items:center 的 flex 容器\n`);
    if(!issues.length){ console.log('全绿 ✅ 声明了居中的容器·子元素中心都对齐\n'); await p.close(); await b.disconnect(); process.exit(0); }
    console.log(`🎯 居中声明了却没生效（${issues.length} 处·子元素中心飘了）：`);
    for(const i of issues) console.log(`❌ ${i.sel}  ${i.n}个子元素 center-${i.axis} 偏差 ${i.spread}px（查是否被别的 CSS 顶掉·或该用 flex 别用 margin 凑）`);
    console.log('');
    await p.close(); await b.disconnect(); process.exit(1);
  }

  // ── 模式 B：--figma-spec 自动核值（DOM-driven，按 data-node-id 对位）──
  if(figmaSpecPath){
    const dump = JSON.parse(fs.readFileSync(figmaSpecPath,'utf8'));
    const specNodes = dump.nodes || [];
    if(!specNodes.length){ console.log('ERR figma-spec 文件里没有 nodes（是不是用了旧 manifest 快照？改用 figma-restore-dump.snippet.js）'); process.exit(2); }
    // 文案真值只存在 leaves 里（nodes 不带 text）→ 拼进 spec，供下面逐字比对。
    // 2026-07-28 造错例挖出来的洞：把 "Processing Machinery" 拼成 "Machinary"，五道门全绿放行
    //（geom 只核字号字重色，visual 对 TEXT 走软判 0.28、墨水量差一个字母也就 1-2%）。抄错文案是还原最常见的错之一。
    { const txt={}, cut={}; for(const l of (dump.leaves||[])) if(l.type==='TEXT' && typeof l.text==='string'){ txt[l.id]=l.text; if(l.textCut!=null) cut[l.id]=l.textCut?1:0; }
      for(const s of specNodes) if(txt[s.id]!=null) s.__text=txt[s.id]; 
      for(const s of specNodes) if(cut[s.id]!=null) s.__textCut=cut[s.id]; }
    // 标记「本会话在做 Figma 节点 1:1 还原」→ 业务关联门/照线上响应式门据此豁免（Figma 还原既不需业务关联·也非照线上响应式）
    try{ const sd=require('os').homedir()+'/.online-reach-state'; fs.mkdirSync(sd,{recursive:true}); fs.writeFileSync(sd+'/figma-restore.flag', JSON.stringify({t:Date.now(), sid:process.env.CLAUDE_CODE_SESSION_ID||''})); }catch(e){}

    const skipRot = !!arg('skip-rot');
    const result = await p.evaluate((specNodes, refSel, refW, tol, textWH, KEYS, EXACT_KEYS, skipRot, dumpRoot) => {
      const ref=document.querySelector(refSel);
      const scale = ref ? ref.getBoundingClientRect().width/refW : 1;
      // 位置/图层核用的「块根」锚点(2026-07-22)：优先 dump 根节点的 DOM 元素·退回 ref
      const rootEl = dumpRoot ? document.querySelector('[data-node-id="'+dumpRoot+'"]') : null;
      const rootRect = rootEl ? rootEl.getBoundingClientRect() : (ref?ref.getBoundingClientRect():null);
      const zItems=[]; const posIssues=[];
      const num=v=>parseFloat(v)||0;
      // 颜色比对：把 computed 的 rgb(a) 和 Figma hex+op 归一到 [r,g,b,a] 逐通道比（±6/255·±0.08 alpha）
      const parseRGB=str=>{ const m=String(str).match(/rgba?\(([^)]+)\)/); if(!m) return null; const q=m[1].split(',').map(x=>parseFloat(x)); return {r:q[0],g:q[1],b:q[2],a:q[3]==null?1:q[3]}; };
      const hexRGB=hex=>{ const h=String(hex).replace('#',''); return {r:parseInt(h.slice(0,2),16),g:parseInt(h.slice(2,4),16),b:parseInt(h.slice(4,6),16)}; };
      // alpha 容差改成**相对**（2026-07-28）：原来一律 ±0.08 绝对值，对遮罩层太松——
      // #000 的 scrim 期望 0.3、写成 0.38 在白底上差 20 个色阶（肉眼明显），却正好卡在边界放行。
      // 现在 tol = clamp(15% × 期望值, 0.02, 0.08)：0.3→±0.045(抓得到)、0.8→±0.08(同以前)、0.04→±0.02。
      // 处处不比原来松，只在中低透明度收紧。
      const alphaTol=sa=>Math.max(0.02, Math.min(0.08, 0.15*sa));
      const colorClose=(computed,specHex,specOp)=>{ const c=parseRGB(computed); if(!c) return false; const s=hexRGB(specHex); const sa=specOp==null?1:specOp; return Math.abs(c.r-s.r)<=6&&Math.abs(c.g-s.g)<=6&&Math.abs(c.b-s.b)<=6&&Math.abs((c.a==null?1:c.a)-sa)<=alphaTol(sa); };
      const fmtC=computed=>{ const c=parseRGB(computed); if(!c) return computed; const hx=x=>Math.round(x).toString(16).padStart(2,'0'); return '#'+hx(c.r)+hx(c.g)+hx(c.b)+(c.a<0.99?` @${Math.round(c.a*100)/100}`:''); };
      const map={}; for(const s of specNodes) map[s.id]=s;
      const textCutLegacy=[];   // 老 manifest 没 textCut、又恰好以 … 结尾 → 判据退化成猜，点名别静默（必须定义在 rows 循环之前·否则 TDZ）
      const rows=[]; const domIds=new Set();
      const manualAbs=[], manualImg=[], manualAlign=[], manualRot=[], manualGrad=[], manualFill=[], insideLegacy=[];
      // 去重同 data-node-id（2026-07-22·轮播克隆帧/隐藏帧会复制同一批 id→querySelector 抓到视口外克隆→位置/图层核全偏）：
      // 每个 id 只留「中心在视口内且有面积」的可见实例·没有则退回第一个。
      const _allEls=[...document.querySelectorAll('[data-node-id]')];
      const _byId={};
      for(const el of _allEls){ const id=el.getAttribute('data-node-id'); const r=el.getBoundingClientRect(); const cx0=r.left+r.width/2; const inVp=cx0>=0&&cx0<=window.innerWidth&&r.width>0&&r.height>0; (_byId[id]=_byId[id]||[]).push({el,inVp}); }
      const els=Object.values(_byId).map(list=>{ const vis=list.find(x=>x.inVp); return (vis||list[0]).el; });
      for(const el of els){
        const id=el.getAttribute('data-node-id'); domIds.add(id);
        const s=map[id];
        if(!s){ rows.push({label:(el.getAttribute('data-name')||el.className||id), id, domOnly:true}); continue; }
        const r=el.getBoundingClientRect(), cs=getComputedStyle(el);
        // w/h：旋转元素用 offsetWidth/Height(旋转前布局尺寸=Figma 内在 node.width)·不用 getBoundingClientRect(旋转膨胀 AABB·会把卡假红)。非旋转不变。
        const _rot = cs.transform && cs.transform!=='none' && /matrix/.test(cs.transform);
        // 🔴 祖先链上有 transform 时也要用 offsetWidth（2026-07-27 补）：getBoundingClientRect 给的是
        // 膨胀后的 AABB，而 Figma 的 uw/uh 是本地未旋转盒 → 元素自己没旋转、父级旋转了，就会假红。
        // 实测：购物篮自己不转、父白卡转 −10°，量出 100×91.1 去对期望 88×77（= 88×77 转 10° 的 AABB）。
        let _inRot=_rot; for(let _a=el.parentElement; _a && !_inRot; _a=_a.parentElement){ const _t=getComputedStyle(_a).transform; if(_t&&_t!=='none'&&/matrix/.test(_t)) _inRot=true; }
        const meas={ w:(_inRot&&typeof el.offsetWidth==='number'&&el.offsetWidth)?el.offsetWidth:r.width/scale, h:(_inRot&&typeof el.offsetHeight==='number'&&el.offsetHeight)?el.offsetHeight:r.height/scale,
          pt:num(cs.paddingTop)/scale, pr:num(cs.paddingRight)/scale, pb:num(cs.paddingBottom)/scale, pl:num(cs.paddingLeft)/scale,
          bt:num(cs.borderTopWidth)/scale, br:num(cs.borderRightWidth)/scale, bb:num(cs.borderBottomWidth)/scale, bl:num(cs.borderLeftWidth)/scale,
          rad:num(cs.borderTopLeftRadius)/scale, fs:num(cs.fontSize)/scale, fw:num(cs.fontWeight) };
        const diffs=[];
        for(const k of KEYS){
          if(s[k]==null) continue;
          if((k==='w'||k==='h') && s.type==='TEXT' && !textWH) continue;   // 文字盒默认不查 w/h
          // 烤进朝向的旋转矢量(Figma 节点有旋转·但 DOM 无 CSS transform=导出 svg 已把旋转烤进路径·紧包围)：
          //   它的 DOM 盒=svg 紧包围(如 103×61)·既非未旋转节点框(82×86)也非 AABB(107×109)→ w/h 盒核给不出正确基准·跳过·交 visual-verify 像素判(2026-07-22 箭头反复错根治)。
          if((k==='w'||k==='h') && s.rot!=null && !_rot) continue;
          // rad 跟 fs/fw 同类：圆角是**离散的设计值**（Figma 里就是整数/半整数），不是量出来的几何。
          // 套 ±1.6px 的几何容差 = 放行「rad 1→0」——2026-07-28 门体检在触屏稿(1:15935)上抓到这个漏网：
          // 信号格 1:15941 rad=1 被归零，偏差 1 < 1.6，geom 全绿放行。跟当天把 fs/fw 挪出几何容差修掉的
          // 「字号 36 写成 35 漏网」是同一个病，当时漏了 rad 这一维。只留 0.5 浮点余量。
          const t = (k==='rad') ? 0.5 : (k==='fw'?2:tol);
          // 旋转元素的 w/h 期望值用 uw/uh(未旋转真值)·不用 s.w/s.h(那是AABB膨胀值·2026-07-22治「旋转卡尺寸对不上/我拿AABB当真实尺寸做太大」)
          let expv = s[k];
          if(k==='w' && s.uw!=null) expv=s.uw;
          if(k==='h' && s.uh!=null) expv=s.uh;
          // 🔴 OUTSIDE 描边：Figma 的 width/absoluteBoundingBox **不含**外描边，CSS 的 border box **含**
          //   → 同一个正确实现必然差 2×描边宽，原来这一维对 OUTSIDE 描边**必然假红**
          //   （2026-07-28 触屏榜单卡 84×84+OUTSIDE 2px：报 w 期望84 实际88 / rad 期望42 实际44，
          //     像素实测 y=680 行 x=33/34=#d9d9d9、图边缘 x≈35.5 —— 环确实在图外，渲染是对的）。
          //   放行第二个期望值，但**只在 DOM 真有那么宽的边框时**才放行（用量到的 meas.b*，不是 spec 的）：
          //     · 盒子做大了却没画边框 → meas.b*=0 → alt 退回 expv → 照样红（没放松）
          //     · INSIDE / CENTER / 无描边 → 完全不走这条（判据不变）
          //   边框宽度/描边色本身仍严格比 → 「忘了画环」抓得到。
          let alt = null;
          if(s.bAlign==='OUTSIDE'){
            if(k==='w')   alt = expv + (meas.bl||0) + (meas.br||0);
            if(k==='h')   alt = expv + (meas.bt||0) + (meas.bb||0);
            if(k==='rad') alt = expv + Math.max(meas.bt||0, meas.br||0, meas.bb||0, meas.bl||0);
          }
          // 🔴 INSIDE 描边的 padding：上面 OUTSIDE 那条的对称面（2026-07-29 补·当天漏了这一侧）。
          //   Figma 的 INSIDE 描边画在盒**内**，padding 是从**外沿**量的 → 外沿到内容 = padding，描边占掉其中最外的 N px。
          //   CSS 的 border 恒在 padding 之外另占位 → 外沿到内容 = border + padding。
          //   所以同一个正确实现里 **Figma 的 pad == CSS 的 padding + border（同侧）**，直接照抄必然差一个描边宽。
          //   1px 描边差 1 落在 ±1.6 容差里没暴露；3px 就超差 —— 实测触屏激活页签 1:15954（pb=10/bb=3 INSIDE）
          //   报「pb 期望10 实际7」，而那个 7 恰恰是 scaffold 算对的值（7+3=10，文字落在 10~34 与 Figma 逐像素一致）。
          //   这不是放松：① 只在 DOM 真画了那么宽的边框时才成立（用量到的 meas.b*，没画则 alt==expv 照样红）
          //              ② 描边宽度 bt/br/bb/bl 本身仍逐项严格比 → 「忘了画那条线」抓得到。
          //   🔴 2026-07-29 收紧成**确定性判据**：上面那段「两个值都放行」本身是个洞——写错一侧照样全绿。
          //   真因是 Figma 的 `strokesIncludedInLayout`（dump 现在记成 bInLayout），它决定描边占不占布局：
          //     · bInLayout=true  → Figma 内容内缩 = pad + 描边 → CSS 只能写 padding = pad（border 另占的那层正好补上）
          //     · bInLayout=false → Figma 内容内缩 = pad       → CSS 只能写 padding = pad − 描边
          //   两次矛盾的实测由此统一：测试稿 121:15577(pad16/INSIDE2/true) 内缩 18；触屏 1:15954(pb10/INSIDE3/false) 内缩 10。
          //   老判据放行了前者写成 14 的真错（内容整块左移 2px，placeholder 本该起于 x=439 实际 437）。
          //   护栏：只在 DOM 真画了那么宽的边框时才换期望（用量到的 meas.b*）；描边宽本身仍逐项严格比。
          if(s.bAlign==='INSIDE' && (k==='pt'||k==='pr'||k==='pb'||k==='pl')){
            const _bw = {pt:meas.bt, pr:meas.br, pb:meas.bb, pl:meas.bl}[k] || 0;
            if(s.bInLayout===true){
              /* 描边参与布局 → 期望就是 pad 本身，不给第二个值 */
            } else if(s.bInLayout===false){
              expv = Math.max(0, expv - _bw);          // 唯一正确值
            } else {
              alt = Math.max(0, expv - _bw);           // 老 manifest 没这个字段 → 退回两者都放行，但点名（不静默）
              insideLegacy.push({id, label:s.name||id, k, pad:s[k], bw:_bw});
            }
          }
          if(Math.abs(meas[k]-expv)>t && !(alt!=null && Math.abs(meas[k]-alt)<=t)){
            // <svg>/SVGElement 没有 offsetWidth/Height → 上面只能退回 getBoundingClientRect(旋转膨胀的 AABB)，
            // 于是「旋转的矢量直接挂 node-id 在 <svg> 上」必然假红（2026-07-27 箭头 期望71 实际92.7 栽过）。
            // 把原因和改法一起报出来，别让人对着一个看不懂的数字反复试。
            const svgHint = ((k==='w'||k==='h') && _rot && typeof el.offsetWidth!=='number')
              ? ' —— 这是 <svg> 直接挂了 data-node-id：SVG 元素没有 offsetWidth，只能退回旋转后的 AABB=必假红。改法：外面套一层 div 承载 node-id/尺寸/transform，<svg> 放里面 width:100%;height:100%'
              : '';
            diffs.push(`${k}: 期望${expv} 实际${Math.round(meas[k]*10)/10}${svgHint}`);
          }
        }
        // 字号/字重精确比（2026-07-28·原来跟宽高共用 ±1.6px 容差，「36 写成 35」漏网）：
        // 它们是离散的设计值，不存在「量出来差一点」——只留 0.5 的浮点余量。
        for(const k of EXACT_KEYS){
          if(s[k]==null) continue;
          if(Math.abs(meas[k]-s[k])>0.5) diffs.push(`${k==='fs'?'字号':'字重'}: 期望${s[k]} 实际${Math.round(meas[k]*10)/10}`);
        }
        // 文字色 / 图标字形色（2026-07-16 图标色纳入·根治「图标色靠猜没得核」）：Figma fill 单色 vs computed color（图标用 currentColor·元素 color 即字形色）
        //   多色文字(s.segColors)走下面逐色核·此处跳过单色比（否则拿元素继承色比第一段易假报）
        if(s.color && !s.segColors && !colorClose(cs.color, s.color, 1)) diffs.push(`${s.type==='TEXT'?'文字色':'图标色'}: 期望${s.color} 实际${fmtC(cs.color)}`);
        // 文案逐字核（2026-07-28 新增）：dump 只存前 40 字、截断处补 "…" → 截断的只比前 40 字。
        // 空白统一折叠（Figma 的换行/缩进跟 HTML 排版无关），大小写与标点照比（"Machinary" 必须报）。
        if(s.__text!=null){
          const norm=t=>String(t).replace(/\s+/g,' ').trim();
          const want=norm(s.__text), got=norm(el.textContent);
          // 🔴 截断与否看 dump 的显式标记 `textCut`（2026-08-02）：文案自己就可能以 … 结尾
          //    （实测 "…ISO45001:2018, …" 51 字一个没截），靠末尾字符猜会把它当成「被截断」→ 只比前半段 → 后半段写错不报。
          //    老 manifest 没这个字段时退回旧判据，但只在真以 … 结尾时才退化，且下面会点名。
          const truncated = (s.__textCut!=null) ? !!s.__textCut : want.endsWith('…');
          if(s.__textCut==null && want.endsWith('…')) textCutLegacy.push(s.name||s.id);
          const wantCmp = truncated ? want.slice(0,-1) : want;
          const gotCmp  = truncated ? got.slice(0, wantCmp.length) : got;
          if(wantCmp && gotCmp!==wantCmp) diffs.push(`文案: 期望「${wantCmp}${truncated?'…':''}」实际「${got.slice(0,60)}${got.length>60?'…':''}」`);
        }
        // 多色文字（segColors·2026-07-16 根治「一个TEXT节点多段不同色·firstFill只取一段·别的色必漏」·评分4.3深//5.0灰栽过）：
        //   期望的每个色都必须出现在该元素或其后代的 computed color 里·缺一即报（漏色再也躲不过机器）
        if(Array.isArray(s.segColors) && s.segColors.length){
          const domCols=new Set(); (function collect(e){ domCols.add(getComputedStyle(e).color); for(const c of e.children) collect(c); })(el);
          const dc=[...domCols];
          const missing=s.segColors.filter(hex=>!dc.some(x=>colorClose(x,hex,1)));
          if(missing.length) diffs.push(`多色文字缺色: 期望含${s.segColors.join('/')} 缺${missing.join('/')} (实际:${dc.map(fmtC).join(',')})`);
        }
        // 背景色：只硬查「半透明底」(op<0.99)——遮罩/scrim/半透明药丸正是难目视、又最易错的类（Ad 0.3、价格条 0.8）。
        // 不透明底(op≥0.99)常被图片/子元素盖住或等于透明落白页 → 跳过防误报，交给目视。
        if(s.bg && s.bg.c && s.bg.op < 0.99){
          if(!colorClose(cs.backgroundColor, s.bg.c, s.bg.op)) diffs.push(`半透明底色: 期望${s.bg.c} @${s.bg.op} 实际${fmtC(cs.backgroundColor)}`);
        }
        // 阴影（2026-07-09 页头投影漏做沉淀 / 2026-07-21 加反向双向核）：
        //   ① Figma 有 DROP/INNER_SHADOW 却 DOM none = 整个漏了；
        //   ② Figma 此节点无投影(noShadow) 却 DOM 有 box-shadow = 该删没删（2026-07-21 亮点展台真 bug：Figma 去了投影 demo 还留着）。
        //   两边都有则列 Figma 值供目视核参数(字符串精确比太脆·不硬判)。
        if(s.shadow){
          const bs=(cs.boxShadow||'').trim();
          if(!bs || bs==='none') diffs.push(`阴影缺失: 期望 ${s.shadow}`);
        } else if(s.noShadow){
          const bs=(cs.boxShadow||'').trim();
          if(bs && bs!=='none') diffs.push(`多余阴影: Figma此节点无投影·DOM却有 box-shadow(${bs.slice(0,44)}) —— 该删没删`);
        }
        // 描边颜色（2026-07-09 主动补）：核有描边那一侧的 computed 颜色 vs Figma
        if(s.borderColor){
          const side = (s.bt>0)?'Top':(s.br>0)?'Right':(s.bb>0)?'Bottom':(s.bl>0)?'Left':'Top';
          const bc = cs['border'+side+'Color'];
          if(bc && !colorClose(bc, s.borderColor, 1)) diffs.push(`描边色: 期望${s.borderColor} 实际${fmtC(bc)}`);
        }
        // 渐变真值（2026-07-21 根治「渐变方向/停靠/type 错了三门全绿」·✨90°当45°、radial 漏做都靠肉眼）：
        //   CSS 背景渐变元素(text-clip/按钮/盒背景)→硬比 type + 停靠色(有序) + 停靠位置(两边都写了%才比)；
        //   SVG fill / 伪元素这类 computed 读不到渐变 → 收进 manualGrad 清单打印 Figma 真值(不静默跳过)。
        // 渐变**描边**（2026-07-29 补·dump 新记 borderGrad）：computed 读不到渐变描边（CSS 得靠
        //   background-clip 双层或 border-image 实现，`border-color` 那时是 transparent）→ 不硬判，
        //   收进必核清单打印 Figma 真值。此前 dump 连这个值都没有，只能凭渲染图猜或额外开一次 use_figma。
        if(s.borderGrad) manualGrad.push({id, label:(s.name||id)+'·**描边**渐变', kind:s.borderGrad.kind, stops:s.borderGrad.stops||[]});
        if(s.grad){
          const bgi=cs.backgroundImage||'';
          if(!/gradient/i.test(bgi)){ manualGrad.push({id, label:s.name||id, kind:s.grad.kind, stops:s.grad.stops||[]}); }
          else {
            const domKind=/radial-gradient/i.test(bgi)?'radial':/conic-gradient/i.test(bgi)?'angular':'linear';
            if(domKind!==s.grad.kind) diffs.push(`渐变类型: 期望${s.grad.kind} 实际${domKind}`);
            const ds=[]; const gre=/(rgba?\([\d.,\s]+\)|#[0-9a-fA-F]{3,8})(?:\s+([\d.]+)%)?/g; let gm;
            while((gm=gre.exec(bgi))!==null){ ds.push({c:gm[1], p: gm[2]!=null?parseFloat(gm[2])/100:null}); }
            const gfs=s.grad.stops||[];
            if(ds.length && gfs.length && ds.length!==gfs.length){ diffs.push(`渐变停靠数: 期望${gfs.length} 实际${ds.length}`); }
            else { for(let i=0;i<gfs.length&&i<ds.length;i++){
              if(!colorClose(ds[i].c, gfs[i].c, gfs[i].a)) diffs.push(`渐变停靠#${i+1}色: 期望${gfs[i].c} 实际${fmtC(ds[i].c)}`);
              // 停靠位置不硬判(2026-07-22)：Figma 渐变向量常内缩(gradientTransform)·dump 记的是节点停靠(如0/0.55/1)·CSS 实际渲染是内缩后(如7.7/84.6)·两者天然差一截→硬比必假红。type+色序已够抓"方向/配色错"·精确位置交 visual-verify 像素判。差>18%才软提示(可能真错)。
              if(ds[i].p!=null && gfs[i].p!=null && Math.abs(ds[i].p-gfs[i].p)>0.18) manualGrad.push({id, label:(s.name||id)+` 停靠#${i+1}位置 期望${Math.round(gfs[i].p*100)}%实际${Math.round(ds[i].p*100)}%(渐变向量内缩?核方向)`, kind:s.grad.kind, stops:[]});
            } }
          }
        }
        // 行高（2026-07-09 主动补）：文字盒可靠核值；computed 为 normal 则跳过
        if(s.lh){
          const clh=cs.lineHeight;
          if(clh && clh!=='normal'){ const v=num(clh)/scale; if(Math.abs(v-s.lh)>tol) diffs.push(`行高: 期望${s.lh} 实际${Math.round(v*10)/10}`); }
        }
        // 混合模式（2026-07-09 主动补）：CSS mix-blend-mode 关键词精确比
        if(s.blend){
          const mb=cs.mixBlendMode;
          if(mb!==s.blend) diffs.push(`混合模式: 期望${s.blend} 实际${mb||'normal'}`);
        }
        // 元素透明度（2026-07-09 主动补）：node.opacity<1 才有·比 computed opacity（±0.08）
        if(s.opacity!=null){
          const op=parseFloat(cs.opacity);
          if(!isNaN(op) && Math.abs(op-s.opacity)>0.08) diffs.push(`透明度: 期望${s.opacity} 实际${Math.round(op*100)/100}`);
        }
        // 字体族（2026-07-09 主动补）：比 computed fontFamily 首项（去引号·小写）vs Figma family
        if(s.font){
          const cf=(cs.fontFamily||'').split(',')[0].replace(/["']/g,'').trim().toLowerCase();
          if(cf && cf!==s.font.toLowerCase()) diffs.push(`字体: 期望${s.font} 实际${cf}`);
        }
        // 绝对定位（2026-07-09 主动补·治「每次都出现的角标/浮层/价格条位置」）：
        // 拿 Figma 父节点(同 data-node-id)当锚点比相对 x/y——父在 DOM 里就机器核，不在才回退目视。
        let absAnchored=false;
        if(s.abs && s.parentId!=null && s.relX!=null){
          const pe=document.querySelector('[data-node-id="'+s.parentId+'"]');
          if(pe){
            const pr=pe.getBoundingClientRect();
            const dx=(r.left-pr.left)/scale, dy=(r.top-pr.top)/scale;
            absAnchored=true;
            if(Math.abs(dx-s.relX)>tol+1) diffs.push(`绝对定位X: 期望${s.relX} 实际${Math.round(dx*10)/10}`);
            if(Math.abs(dy-s.relY)>tol+1) diffs.push(`绝对定位Y: 期望${s.relY} 实际${Math.round(dy*10)/10}`);
          }
        }
        // 图片填充铺满校验（2026-07-09 产品图缩小翻车根治·治 geom 量盒子·量不到「填充在框里铺多大」的画面盲区）：
        // imgFit=FILL → 内部 <img>/背景图必须铺满整框；被 padding/object-contain 缩小则报红（外框仍是原尺寸·只有内图变小·肉眼才看得出、盒模型看不出）。
        if(s.imgFit==='FILL'){
          const inner = el.querySelector('img');
          const target = inner || (getComputedStyle(el).backgroundImage!=='none' ? el : null);
          if(target){
            const ir=target.getBoundingClientRect(); const fw=ir.width/scale, fh=ir.height/scale;
            if(s.w!=null && fw < s.w - tol - 2) diffs.push(`图片填充未铺满宽(FILL应cover): 框${s.w} 实际图${Math.round(fw*10)/10}(查是否误加padding/object-contain)`);
            if(s.h!=null && fh < s.h - tol - 2) diffs.push(`图片填充未铺满高(FILL应cover): 框${s.h} 实际图${Math.round(fh*10)/10}(查是否误加padding/object-contain)`);
          }
        }
        // 旋转符号/角度（2026-07-21 根治·治「正方形卡 +15°/-15° aabb 相同→w/h/像素门全绿却方向反」的结构性盲区）：
        // Figma rotation 逆时针为正·CSS 顺时针为正 → 期望 CSS 角 = −s.rot。DOM 元素 transform 矩阵 atan2(b,a) 即其渲染旋转角。
        // 硬判仅当 DOM 确有旋转(角≠0·det>0)且与期望不符→报红(符号翻转必被抓)；DOM 无旋转但 Figma 有→软提醒(可能烤进 SVG/图·不误伤箭头那种)。
        if(s.rot!=null && !skipRot){
          const tf=cs.transform; let domAng=null, det=1;
          if(tf && tf!=='none'){ const m=tf.match(/matrix\(([^)]+)\)/); if(m){ const p=m[1].split(',').map(parseFloat); const a=p[0],b=p[1],c=p[2],d=p[3]; det=a*d-b*c; domAng=Math.atan2(b,a)*180/Math.PI; } }
          const expected=-s.rot;
          if(domAng===null || Math.abs(domAng)<0.5){ manualRot.push({id, label:s.name||id, rot:s.rot}); }
          else { let dd=((domAng-expected)%360+540)%360-180; if(Math.abs(dd)>2.5) diffs.push(`旋转: 期望CSS${Math.round(expected*10)/10}°(=−Figma${s.rot}°) 实际${Math.round(domAng*10)/10}°${det<0?'(含翻转)':''} —— 符号/角度不符`); }
        }
        // 镜像翻转（2026-07-27 根治「箭头 det=-1 被竖向镜像·上面这条旋转判据用 atan2(b,a)·加不加 scaleY(-1) 算出来同一个角
        //   → 漏掉镜像照样全绿·只能靠肉眼看出朝向反了」）：Figma relativeTransform 行列式<0 = 该节点被镜像过，
        //   CSS 必须补 scaleX(-1)/scaleY(-1)；反之 Figma 没镜像而 DOM 翻了也是错。两个方向都硬判。
        if(s.mirror!=null && !skipRot){
          let domDet=1; const tfm=cs.transform;
          if(tfm && tfm!=='none'){ const m=tfm.match(/matrix\(([^)]+)\)/); if(m){ const p=m[1].split(',').map(parseFloat); domDet=p[0]*p[3]-p[1]*p[2]; } }
          if(s.mirror===true && domDet>=0) diffs.push(`镜像: Figma 该节点被镜像过(det<0)·DOM 没翻 —— 只写 rotate 会上下/左右反·需补 scaleY(-1) 或 scaleX(-1)`);
          if(s.mirror===false && domDet<0) diffs.push(`镜像: Figma 没镜像·DOM 却翻了(det<0) —— 多写了 scaleX/scaleY(-1)`);
        }
        // 🕳️ 内联 <svg> 被基线推移（2026-07-29 补·这一维此前彻底瞎）：
        //   <svg> 默认是 **inline** 元素，底边贴文字基线 → 比行内 strut（16px/normal 时上升约 15px）矮的图标
        //   会被整体往下推。实测测试稿：12px 箭头容器 y=430 而里面的 svg y=433（低 3px）、14px 的低 1px，
        //   24/22/16px 恰好不受影响 —— 所以是**只有小图标中招**的隐性错位。
        //   为什么两道门都看不见它：geom 量的是外层带 node-id 的 div（宽高位置全对）；visual 对 12×12 的箭头
        //   墨水太少，3px 位移摊进整框平均也超不过阈值。是靠肉眼放大 + 墨水质心才发现的。
        //   判据只认**无歧义的那一种**：svg 尺寸铺满容器（说明本意就是撑满）却整体有偏移 → 必是被基线/行内布局推的。
        //   有意内缩（容器带 padding、svg 比容器小）不进这一维，不会假红。
        if(el.tagName!=='svg' && el.tagName!=='SVG'){
          const _sk = el.querySelector(':scope > svg');
          if(_sk){
            const _sr=_sk.getBoundingClientRect();
            const _fills = Math.abs(_sr.width-r.width)<=0.6 && Math.abs(_sr.height-r.height)<=0.6;
            const _dx=_sr.left-r.left, _dy=_sr.top-r.top;
            if(_fills && Math.max(Math.abs(_dx),Math.abs(_dy))>0.6){
              const _disp=getComputedStyle(_sk).display;
              diffs.push(`内联SVG错位: <svg> 铺满容器却整体偏了 x${Math.round(_dx*10)/10} y${Math.round(_dy*10)/10}px（它的 display 是 ${_disp}）`+
                         ` —— <svg> 默认 inline·底边贴基线，比行内 strut 矮的图标会被往下推。改法：CSS 里给它 display:block（别写内联 style，会撞 preflight）`);
            }
          }
        }
        // 绝对位置核（2026-07-22·治「旋转/绝对定位的装饰卡摆偏几px·geom 原来完全不核位置·靠用户一处处指」）：
        // 只核「位置关键」的元素=旋转 或 Figma绝对定位(其位置是显式指定·不是布局推导)·比中心点(旋转不变)。流式布局元素跳过(位置是布局结果·核了易假红)。
        if(s.cx!=null && rootRect && (s.rot!=null || s.abs)){
          const domCx=(r.left+r.width/2-rootRect.left)/scale, domCy=(r.top+r.height/2-rootRect.top)/scale;
          // 位置容差 2026-07-28 从 tol+3(4.6px) 收到 tol+1(2.6px)：造错例实测「整卡挪 3px」原来漏网
          //（visual 的 ±4px 局部对齐也吸收得掉，等于没有门看得见 ≤4px 的错位）。收紧后两张真稿仍全绿。
          const ptol=tol+1;
          if(Math.abs(domCx-s.cx)>ptol) diffs.push(`位置X(中心): 期望${s.cx} 实际${Math.round(domCx)}(偏${Math.round(domCx-s.cx)})`);
          if(Math.abs(domCy-s.cy)>ptol) diffs.push(`位置Y(中心): 期望${s.cy} 实际${Math.round(domCy)}(偏${Math.round(domCy-s.cy)})`);
        }
        // 收集 z-order 校验项（2026-07-22·非文字·可见·有 paint 秩 z·有渲染面积）
        // 排除 opacity:0（hover 才显的控件如翻页按钮·静态帧被盖属预期·交互态才浮上来·跟 visual-verify 一致跳过）
        if(s.z!=null && s.type!=='TEXT' && r.width>1 && r.height>1 && cs.visibility!=='hidden' && cs.display!=='none' && cs.opacity!=='0'){
          zItems.push({id, z:s.z, l:r.left, t:r.top, ri:r.right, b:r.bottom});
        }
        rows.push({label:s.name||id, id, ok:!diffs.length, diffs});
        // 机器核不到 → 收进「必须目视」清单（不判失败·只显式列出·治「盲区静默」）
        if(s.abs && !absAnchored) manualAbs.push({id, label:s.name||id, rel:(s.relX!=null?`相对父 x${s.relX} y${s.relY}(父${s.parentId||'?'}未建·目视)`:'')});
        if(s.imgBox) manualImg.push({id, label:s.name||id, fit:s.imgFit||''});
        // 多层填充栈：computed 只读得到一个 background-color / 一张图 → 叠色顺序、混合模式、顶上的
        //   半透明罩机器全核不到（2026-07-28 触屏 thumb-img 是 4 层：底色 + 图(DARKEN) + #000@3% 罩，
        //   dump 的 bg 只记了第一层 → 照抄整体偏亮，是 visual 的「图片内容比」报红才暴露的）。
        //   不判失败，但必须列出来逐条核，别让它静默。
        if(Array.isArray(s.fillStack) && s.fillStack.length>1)
          manualFill.push({id, label:s.name||id, layers:s.fillStack});
        if(s.pAlign) manualAlign.push({id, label:s.name||id, a:`${s.dir||''} 主轴${s.pAlign}/交叉${s.cAlign}`});
      }
      // 居中对齐校验（2026-07-15·治「做 HTML 页面时中心点不在同一水平线」老毛病）：
      // Figma auto-layout 容器 counterAxisAlignItems=CENTER → 直接子元素应共享同一中心
      // （横向容器→center-Y 同一水平线 / 纵向→center-X 同一竖线）。拿 Figma 明确 CENTER 意图当锚，
      // 只断言「该居中的这组子元素中心互相对齐」；护栏：绝对定位子元素排除·<2 个可比就跳过（结构不全不瞎判）·容差放宽吸收文字盒中心抖动。
      // 🔤 字体度量一致性（2026-07-29 立·全页中位数，不是逐个文字盒）：
      //   治的病：**用了同族但不同版本的字体，所有门都可能全绿**。实测本机装的是 2018 版 Roboto 静态字重，
      //   而 Figma 用的是 2024 改版后的新 Roboto（它有 SemiBold/Condensed 全家桶，经典 Roboto 没有）——
      //   字宽差约 1%，原来只能通过「HUG 父容器宽度累积偏 2~4px」间接暴露；而 scaffold 现在默认钉住
      //   文字盒宽度（复刻 Figma 的取整），那个间接症状就没了 → 需要一条直接判据。
      //   量法：只取 hSize=HUG（自动宽度→盒宽 == 字形宽，比值才有意义）、单行、未截断的文字，
      //   用 Range.getBoundingClientRect 拿**未被盒子夹住**的真实字形宽，除以 Figma 盒宽，取全页中位数。
      //   基线不是 1.000 而是约 0.995：Figma 把自动宽度盒取整，字形恒略窄于盒。
      //   实测标定（同一份稿只换字体）：正确可变字体 0.9951 / banner 0.9973 / 触屏 0.9997
      //                             本机 2018 静态 1.0043 / Arial 1.0179。
      const fontRatios=[];
      for(const t of specNodes){
        if(t.type!=='TEXT' || !t.w || !t.lh || !t.h) continue;
        if(t.hSize && t.hSize!=='HUG') continue;              // FIXED/FILL 的盒宽是设计师定的·比值无意义
        if(t.h > t.lh*1.5) continue;                          // 只量单行
        const e=document.querySelector('[data-node-id="'+t.id+'"]');
        if(!e || !e.firstChild) continue;
        const cs2=getComputedStyle(e);
        if(/hidden|clip/.test(cs2.overflow) || cs2.textOverflow==='ellipsis') continue;   // 故意截断的不量
        let gw=0;
        try{ const rg=document.createRange(); rg.selectNodeContents(e); gw=rg.getBoundingClientRect().width; }catch(e2){}
        if(!gw) continue;
        fontRatios.push({id:t.id, label:t.name||t.id, fs:t.fs, figma:t.w,
                         glyph:Math.round(gw*100)/100, ratio:Math.round(gw/t.w*10000)/10000});
      }
      // 🔤 字体字符覆盖（2026-08-02 立·治「内联字体缺字符 → 浏览器静默回退到系统字体 → 度量全错，而五道门全绿」）
      //   血泪：给单文件 demo 内联了 Google Fonts 的 woff2，那是**按 unicode-range 切好的 subset 分片**，
      //   cmap 里根本没有 `…`、`·`、`.`。浏览器不会报任何错，只是把这几个字悄悄交给系统字体渲染 —— 省略号
      //   因此宽了 4px（Figma 三点墨水跨 6px、实际渲染跨 10px），公司名的 ellipsis 截断点因此少吃一个字符，
      //   Mgmt 那行因此溢出 3px。当时 preflight/manifest/coverage/geom/visual **五道全绿**，是靠逐行量渲染图的
      //   墨水跨度才逮到的，光诊断就烧掉约 16 分钟。
      //   判据：只查页面自己 @font-face 声明的字族（系统字体缺字没这个字族的责任）。用 canvas 双基线交叉探测——
      //   两个 fallback 基线下宽度都没变，才算这个字族真没提供该字形（单基线会被「目标字形恰好与 fallback 同宽」骗）。
      const fontCoverage=(()=>{
        const declared=new Set();
        for(const ss of document.styleSheets){
          let rules=null; try{ rules=ss.cssRules; }catch(e){ continue; }   // 跨域样式表读不了·跳过
          for(const r of (rules||[])){
            if(r.type!==5) continue;                                       // 5 = CSSFontFaceRule
            const f=String(r.style.fontFamily||'').replace(/["']/g,'').trim();
            if(f) declared.add(f.toLowerCase());
          }
        }
        if(!declared.size) return null;                                    // 没内联字体 → 这一维不适用
        const cvs=document.createElement('canvas').getContext('2d');
        const probe=(fam,ch,base)=>{
          cvs.font='100px "'+base+'"';              const w0=cvs.measureText(ch).width;
          cvs.font='100px "'+fam+'","'+base+'"';    const w1=cvs.measureText(ch).width;
          return Math.abs(w1-w0)>0.01;                                     // 宽度变了 = 该字族真提供了这个字形
        };
        const pairs=new Map();                                             // fam\0char → 一个上下文样例
        (function walk(n){
          if(n.nodeType===3){
            const el=n.parentElement; if(!el) return;
            const cs2=getComputedStyle(el);
            if(cs2.display==='none'||cs2.visibility==='hidden') return;
            const fam=String(cs2.fontFamily||'').split(',')[0].replace(/["']/g,'').trim();
            if(!fam||!declared.has(fam.toLowerCase())) return;
            for(const ch of String(n.nodeValue)){
              if(/\s/.test(ch)) continue;
              const k=fam+'\u0000'+ch;
              if(!pairs.has(k)) pairs.set(k,{fam,ch,nid:(el.closest('[data-node-id]')||{getAttribute:()=>null}).getAttribute('data-node-id')||null,
                                             ctx:String(n.nodeValue).slice(0,28)});
            }
            return;
          }
          for(const kid of n.childNodes) walk(kid);
        })(document.body);
        const miss=[];
        for(const p of pairs.values())
          if(!probe(p.fam,p.ch,'__nofont_probe_a__') && !probe(p.fam,p.ch,'monospace'))
            miss.push({fam:p.fam, ch:p.ch, cp:'U+'+p.ch.codePointAt(0).toString(16).toUpperCase().padStart(4,'0'),
                       nid:p.nid, ctx:p.ctx});
        return {declared:[...declared], probed:pairs.size, miss};
      })();

      // 📏 文字行数（2026-08-02 立·治「折行差表现成祖先容器高度不对，人要反推五步」）
      //   实测账：一处 0.27px 的字宽差把 price 的 "..." 挤到第三行，门报出来的是
      //   「【母版】supplier-card-list h: 期望245 实际263」+「thumb-strip h: 期望147 实际165」——
      //   全是**祖先容器**，真正折行的那个文字节点一声不吭。从这些数字推到「price 多了一行」花了好几步。
      //   文字折行是还原里最高频的差异源，直接把它判出来：Figma 行数 = round(h/lh)，DOM 行数 = Range 的行 rect 数。
      const lineIssues=[];
      for(const t of specNodes){
        if(t.type!=='TEXT' || !t.lh || !t.h) continue;
        const figLines=Math.max(1, Math.round(t.h/t.lh));
        const e=document.querySelector('[data-node-id="'+t.id+'"]');
        if(!e || !e.firstChild) continue;
        // 🔴 别用 Range.getClientRects().length 数行：text-overflow:ellipsis 的元素会把**一行**切成两个 rect
        //    （实测公司名 nowrap 单行返回 325.78 + 196.72 两段 → 误报「2 行」）。用高度÷行高，不受此影响。
        const cs3=getComputedStyle(e);
        const domLH=parseFloat(cs3.lineHeight);
        if(!domLH || !isFinite(domLH)) continue;                       // lineHeight:normal 拿不到数值 → 不判
        const inner=e.getBoundingClientRect().height/scale
                    - (parseFloat(cs3.paddingTop)||0)/scale - (parseFloat(cs3.paddingBottom)||0)/scale;
        const domLines=Math.max(1, Math.round(inner/(domLH/scale)));
        if(domLines!==figLines)
          lineIssues.push({id:t.id, label:t.name||t.id, fig:figLines, dom:domLines, w:t.w, fs:t.fs, lh:t.lh,
                           text:String(e.textContent||'').replace(/\s+/g,' ').trim().slice(0,34)});
      }

      const centerIssues=[]; const ctol=tol+2;
      for(const c of specNodes){
        if(c.cAlign!=='CENTER' || !c.dir) continue;
        const horiz = c.dir==='HORIZONTAL';   // 横向→比 center-Y（同一水平线）；纵向→比 center-X（同一竖线）
        const centers=[];
        for(const k of specNodes){
          if(k.parentId!==c.id || k.abs) continue;   // 只直接子元素·排除绝对定位（其中心不受 counterAxis 约束）
          const ke=document.querySelector('[data-node-id="'+k.id+'"]');
          if(!ke) continue;
          const kr=ke.getBoundingClientRect();
          centers.push(horiz ? (kr.top+kr.height/2)/scale : (kr.left+kr.width/2)/scale);
        }
        if(centers.length<2) continue;   // 不足两个可比 → 跳过，不瞎判
        const spread=Math.max(...centers)-Math.min(...centers);
        if(spread>ctol) centerIssues.push({ container:c.name||c.id, axis:horiz?'Y(同一水平线)':'X(同一竖线)', spread:Math.round(spread*10)/10, n:centers.length });
      }
      // 图层顺序核（2026-07-22·治「大图盖小图 / 箭头在白卡下 —— 图层反了没任何门核·靠用户一遍遍指」）：
      // 对每对「渲染重叠」的已标注元素，在重叠区中点用 elementsFromPoint 定 DOM 谁在上，比 Figma paint 秩 z(大=该在上)。
      const zIssues=[];
      for(let i=0;i<zItems.length;i++)for(let j=i+1;j<zItems.length;j++){
        const A=zItems[i],B=zItems[j];
        const ox0=Math.max(A.l,B.l),ox1=Math.min(A.ri,B.ri),oy0=Math.max(A.t,B.t),oy1=Math.min(A.b,B.b);
        if(ox1-ox0<3||oy1-oy0<3) continue;   // 不重叠/仅擦边→跳
        const ea=document.querySelector('[data-node-id="'+A.id+'"]'), eb=document.querySelector('[data-node-id="'+B.id+'"]');
        if(!ea||!eb) continue;
        if(ea.contains(eb)||eb.contains(ea)) continue;   // 祖先-后代不是同层兄弟·没有可比的图层顺序(2026-07-22·治「根容器 vs 子元素」误报)
        let domATop;
        if(ea.parentElement===eb.parentElement){
          // 同父兄弟：按 z-index 数值比(相等按 DOM 顺序·后=上)——确定无疑，避开旋转/透明元素 elementsFromPoint 取样不到的假报(2026-07-22)
          const za=parseInt(getComputedStyle(ea).zIndex)||0, zb=parseInt(getComputedStyle(eb).zIndex)||0;
          if(za!==zb) domATop = za>zb;
          else { const sibs=[...ea.parentElement.children]; domATop = sibs.indexOf(ea)>sibs.indexOf(eb); }
        } else {
          // 跨堆叠上下文：像素取样定上下。三条(2026-07-28 根治「AABB 假重叠 + 祖先回退」判出的假红)：
          //  ① 不只取重叠区中点 —— 旋转元素的 AABB 比真实盒大一圈，中点常常两个盒都没盖到 → 改网格采样。
          //  ② 匹配只认「元素自己、或它的后代被直接命中」，**去掉原来的祖先回退** `stack[k].contains(el)`：
          //     那一支会拿 A 的祖先跟 B 的父级比出个假的上下关系。实测(箭头496:18164 vs 购物篮496:18134，
          //     两者各自都在旋转容器里)：AABB 只交出 3×74 的窄条，中点两个旋转盒谁都没盖到 → 回退到
          //     「箭头的祖先 vs 购物篮的父卡片」→ 判成「购物篮盖住箭头」。而真正两者同时命中的点上
          //     栈序是 箭头(1) → 购物篮(2)，箭头在上、与 Figma 一致。
          //  ③ 整个网格都找不到「两者同时被命中」的点 = 真实渲染里它们压根不重叠 → 层序不可观测 → 跳过不报。
          const hitIdx=(el,stack)=>{ for(let k=0;k<stack.length;k++){ if(stack[k]===el||el.contains(stack[k])) return k; } return -1; };
          let ia=-1, ib=-1;
          const NS=5;
          for(let gy=1;gy<=NS&&ia<0;gy++)for(let gx=1;gx<=NS;gx++){
            const st=document.elementsFromPoint(ox0+(ox1-ox0)*gx/(NS+1), oy0+(oy1-oy0)*gy/(NS+1));
            const a=hitIdx(ea,st), b=hitIdx(eb,st);
            if(a>=0&&b>=0){ ia=a; ib=b; break; }
          }
          if(ia<0||ib<0) continue;
          domATop = ia<ib;     // elementsFromPoint 越靠前=越上层
        }
        const figATop = A.z>B.z;   // paint 秩大=Figma 里更靠上
        if(domATop!==figATop) zIssues.push({top:(figATop?A.id:B.id), under:(figATop?B.id:A.id)});
      }
      let figmaOnly=0; for(const s of specNodes) if(!domIds.has(s.id)) figmaOnly++;
      return {scale, rows, figmaOnly, specTotal:specNodes.length, domCount:els.length, manualAbs, manualImg, manualAlign, manualRot, manualGrad, manualFill, insideLegacy, fontRatios, fontCoverage, lineIssues, textCutLegacy, centerIssues, zIssues};
    }, specNodes, refSel, refW, tol, textWH, KEYS, EXACT_KEYS, skipRot, dump.root);

    console.log(`\n[--figma-spec 自动核值] 渲染缩放 scale=${result.scale.toFixed(4)}  (ref ${refSel}=${refW})  容差±${tol}px`);
    console.log(`DOM 带 data-node-id 元素 ${result.domCount} 个 · Figma 真值节点 ${result.specTotal} 个\n`);
    let fail=0, warn=0;
    // 先红后绿，噪音提示垫底
    const reds=result.rows.filter(r=>r.ok===false), greens=result.rows.filter(r=>r.ok===true), warns=result.rows.filter(r=>r.domOnly);
    for(const r of reds){ console.log(`❌ ${r.label}  ${r.diffs.join(' | ')}`); fail++; }
    for(const r of greens){ console.log(`✅ ${r.label}`); }
    for(const r of warns){ console.log(`⚠️  ${r.label} (data-node-id=${r.id}) —— Figma 真值里没有这个 id（写错/过期？不判失败）`); warn++; }
    if(result.figmaOnly) console.log(`ℹ️  Figma 有 ${result.figmaOnly} 个节点在 DOM 里没建（完整性交给 coverage-check，这里不判失败）`);
    // 图标颜色审计（占位色不可信·计入 fail）
    const colorHits = arg('skip-svg-color') ? [] : scanSvgColorsFromHtml(url);
    if(colorHits.length){
      console.log(`\n🎨 图标颜色未解析（${colorHits.length} 个 SVG 带 Figma 变量占位色·占位默认不可信）：`);
      for(const c of colorHits) console.log(`❌ ${c.label}  ${c.defs.join(' , ')}`);
      console.log(`   核对：use_figma 读该图标节点 fills[0].color→hex，确认后把 SVG 占位默认改成真实 hex（或内联 svg 用 currentColor）。确属正确/无需还原可加 --skip-svg-color。`);
      fail += colorHits.length;
    }
    // SVG 宽高比修坑扫描（占位色同款·计入 fail·2026-07-15）
    const aspectHits = arg('skip-svg-aspect') ? [] : scanSvgAspectFromHtml(url);
    if(aspectHits.length){
      console.log(`\n📐 SVG 拉伸变形风险（${aspectHits.length} 个 svg 带 preserveAspectRatio="none"·会按容器强行拉伸破坏图标比例）：`);
      for(const a of aspectHits) console.log(`❌ ${a}`);
      console.log(`   修：把该 svg 根标签的 preserveAspectRatio="none" width="100%" height="100%" 改成真实 width/height（数值取 viewBox）。确需拉伸可加 --skip-svg-aspect。`);
      fail += aspectHits.length;
    }
    // 居中未对齐（2026-07-15·Figma counterAxis=CENTER 的子元素中心该在同一线上·计入 fail）
    const centerIssues = arg('skip-center-align') ? [] : (result.centerIssues||[]);
    if(centerIssues.length){
      console.log(`\n🎯 居中未对齐（Figma 标了 counterAxis=CENTER·子元素中心该在同一线上，实测飘了）：`);
      for(const ci of centerIssues) console.log(`❌ ${ci.container}  ${ci.n}个子元素 center-${ci.axis} 偏差 ${ci.spread}px（该≈0·查容器是否漏了 align-items:center / justify-content:center）`);
      console.log(`   修：让该容器用 flex+居中（横向 align-items:center / 纵向 justify-content:center），别靠手写 margin/padding 凑。确属误报（如文字盒 metrics）可加 --skip-center-align。`);
      fail += centerIssues.length;
    }
    // 图层顺序反了（2026-07-22·治「大产品图盖小图/箭头在白卡下·图层反了没门核·靠用户反复指5、6次」·计入 fail）
    const zIssues = arg('skip-zorder') ? [] : (result.zIssues||[]);
    if(zIssues.length){
      console.log(`\n🧱 图层顺序反了（重叠元素·DOM 的上下层跟 Figma 图层顺序不一致）：`);
      for(const z of zIssues) console.log(`❌ Figma 里 ${z.top} 该盖在 ${z.under} 上面·DOM 里却反了（${z.under} 盖住了 ${z.top}）`);
      console.log(`   修：按 Figma 图层顺序设 z-index（Figma 子节点 index 大=更靠上=z-index 大）。用 use_figma 读父节点 children 顺序定权威 z。确属误报可加 --skip-zorder。`);
      // 光团/蒙层这类「dump 的 z 序跟真实渲染相反」的争议节点，单跑 geom 时会刷一屏假红（2026-07-29 两次栽在这）：
      // restore-gates 的正规打法是 geom 带 --skip-zorder、层序交给 zorder-check.cjs 按 --zorder-exclude 单独核。
      // 判据：报红条目高度集中在少数几个节点上（典型就是几个光团反复出现）。
      {
        const cnt = {}; for(const z of zIssues){ cnt[z.top]=(cnt[z.top]||0)+1; }
        const hot = Object.entries(cnt).sort((a,b)=>b[1]-a[1]).filter(([,c])=>c>=3).map(([k])=>k);
        if(hot.length && zIssues.length >= 6)
          console.log(`   💡 报红集中在 ${hot.length} 个节点上（${hot.slice(0,4).join(' / ')}${hot.length>4?' …':''}）——`
            + `若它们是模糊光团/蒙层这类「z 序与真实渲染相反」的争议节点，别在这儿一条条改：\n`
            + `      · 先跑 figma-render-probe.py blob-order 定它们到底在内容之上还是之下（有结论才动手）\n`
            + `      · 然后走 restore-gates.sh --zorder-exclude ${hot.slice(0,6).join(',')}（它会让 geom 跳过这一维、交 zorder-check 只核其余重叠对）\n`
            + `      · 别用 --skip-zorder 一刀切放掉整维`);
      }
      fail += zIssues.length;
    }
    // 绝对定位锚错了父级（2026-07-29 立·治「内联 SVG 零件整个飞到页面左上角，五道门全绿放行」）：
    //   血泪：触屏 SERP 还原给 `.ph44 > svg` 写了 position:absolute，忘了给 `.ph44` 自己 position:relative
    //   → 两张供应商 M 水印跳过头像框、锚到页面根，落在状态栏上；头像框里是空的。用户一眼看出来，五道门一个没响。
    //   门为什么全瞎：data-node-id 打在 div 上、零件是 div 里的 <svg> → geom 只核带 node-id 的元素（div 位置是对的）；
    //   coverage 只核 Figma→DOM 单向（叶子确实"建了"）；visual 按节点框算归一化 diff（淡渐变水印 diff 才 8/255）。
    //   判据是结构性的、不靠像素：**Figma 的绝对定位语义永远是「相对直接父帧」**，所以 DOM 里
    //   absolute 元素的最近包含块必须就是它的直接父元素；不是 = 它已经飘到别处去了。
    //   （注意不能用 offsetParent —— 那是 HTMLElement 的属性，<svg> 上恒为 undefined/null，第一版探针因此报了 33 个假错。）
    const anchorIssues = arg('skip-anchor') ? [] : await p.evaluate((rootSel)=>{
      const root = document.querySelector(rootSel) || document.body;
      const nameOf = el => { const c=(el.getAttribute&&(el.getAttribute('class')||'').trim().split(/\s+/)[0])||''; return c?'.'+c:'<'+el.tagName.toLowerCase()+'>'; };
      // 构成包含块的条件（绝对定位会锚到最近的这种祖先）
      const isCB = el => { const c=getComputedStyle(el);
        if(c.position!=='static') return true;
        if(c.transform!=='none' || c.perspective!=='none' || (c.filter&&c.filter!=='none')) return true;
        if(c.willChange && /transform|perspective|filter/.test(c.willChange)) return true;
        if(c.contain && /paint|layout|strict|content/.test(c.contain)) return true;
        return false; };
      const out=[];
      for(const el of root.querySelectorAll('*')){
        const cs=getComputedStyle(el);
        if(cs.position!=='absolute') continue;
        // 四边都 auto = 只是脱流、没声明位置 → 锚到谁都不影响落点，不判
        if(cs.left==='auto'&&cs.top==='auto'&&cs.right==='auto'&&cs.bottom==='auto') continue;
        const pe=el.parentElement; if(!pe) continue;
        let anc=pe; while(anc && anc!==document.documentElement && !isCB(anc)) anc=anc.parentElement;
        if(anc===pe) continue;
        // 顺带量出实际偏了多少，省得人再自己算
        let off='';
        const q=el.getBoundingClientRect(), pr=pe.getBoundingClientRect(), pcs=getComputedStyle(pe);
        const L=parseFloat(cs.left), T=parseFloat(cs.top);
        const dx=isNaN(L)?null:Math.round((q.left-(pr.left+(parseFloat(pcs.borderLeftWidth)||0)+L))*10)/10;
        const dy=isNaN(T)?null:Math.round((q.top -(pr.top +(parseFloat(pcs.borderTopWidth) ||0)+T))*10)/10;
        if(dx||dy) off=`·实际偏离应在位置 ${dx==null?'-':dx},${dy==null?'-':dy}px`;
        out.push({ tag:el.tagName.toLowerCase(), cls:nameOf(el), nid:el.getAttribute('data-node-id')||'',
          parent:nameOf(pe), anchor:(anc&&anc!==document.documentElement)?nameOf(anc):'(页面初始包含块)', off });
      }
      return out;
    }, refSel);
    if(anchorIssues.length){
      console.log(`\n📍 绝对定位锚错了父级（${anchorIssues.length} 个·它没落在自己父元素里，而是飘到更外层去了）：`);
      for(const a of anchorIssues) console.log(`❌ <${a.tag}>${a.cls.startsWith('.')?' '+a.cls:''}${a.nid?' '+a.nid:''} 的父级是 ${a.parent}，却锚到了 ${a.anchor}${a.off}`);
      console.log(`   修：给直接父级加 position:relative（Figma 的绝对定位永远相对直接父帧）。`);
      console.log(`   🔴 这一维专治「内联 SVG/装饰零件没有 data-node-id → 另外四道门都够不着它」，别用 --skip-anchor 绕。`);
      fail += anchorIssues.length;
    }
    // 🧩 内联 SVG 塞错层级 / 被宿主盒压扁（2026-09-01 立·上面那一维的同族补丁）：
    //   血泪（AI Mode 金刚区 J/K 那一轮）：一轮里连犯两个同类错，coverage/geom/visual **三道门全绿**，
    //   全靠用户肉眼抓出来。用户原话「这种问题不应该犯的」。
    //     ① 翻页箭头：把 36×36 的整块图形塞进 flip button 自己的 div，而那个 div 自带 padding 10.5/13.5
    //        → border-box 下内容区只剩 9×15，SVG 作为 flex 子项被压没 = 屏幕上只有白圆、没有箭头。
    //     ② 星标：把 22×22 的**容器**图形塞进它的**子节点**（18 高）的 div
    //        → SVG 撑到 22 高、中心 cy=15 比同行文字 cy=13 低 2px。
    //   为什么老门全瞎：geom 是 DOM-driven，只遍历带 data-node-id 的元素；手工注入的 <svg> 自己没有 tag，
    //   而带 tag 的父 div 尺寸位置**都是对的** → 永远核不到它里面塞了什么。coverage 只核「叶子建了没」
    //   （父 div 在、tag 在，它就绿）。visual 那两处一个因 hover 态被跳过、一个 2px 被阈值吸收。
    //   判据（结构性·不靠像素）：**内联 SVG 的实测盒必须等于它宿主节点在 manifest 里的真值**。
    //     · 直接父元素就是宿主(hops=0) → 尺寸**双向**严格比：SVG 是那个节点的图形，就该正好铺满它。
    //       为免误伤「一个盒里图标+文字」，这一档只在「SVG 是宿主唯一可见内容」时才判小了（大了照判）。
    //     · 隔着非 node 容器(hops>0) → 只判**溢出**（比宿主还大必错）；比宿主小合法（图标嵌在大盒里）。
    //       这样「多包一层 div」不能把溢出这一类绕过去。
    //   🔴 声明覆盖边界（别把这一维绿当成「内联 SVG 全对」→ feedback-gate-coverage-must-be-declared）：
    //     · 只判尺寸，**不判位置/中心**（靠左的图标本来就不居中，位置判据必假红）
    //     · 实测 0 尺寸（display:none / 未展开态 / 克隆壳里的隐藏图标）跳过 —— 藏起来的量不到
    //     · 宿主在 Figma 里有旋转的跳过（AABB 膨胀，跟上面 w/h 那一维同一个理由）
    //     · 宿主不在 manifest 的记 ℹ️ 不判失败（多半属于别的块，或 live-clone 的页面壳）
    //     · 扫描范围锁在 **manifest 根节点的 DOM 子树**内，不是 --ref-sel —— live-clone 的稿子
    //       ref-sel 常是 .page-inner（整张克隆页），实测那样会扫出 81 个页面壳里的隐藏 <svg>。
    const inlineSvg = arg('skip-inline-svg') ? null : await p.evaluate((specNodes, rootId, refSel, refW, tol)=>{
      const map={}; for(const s of specNodes) map[s.id]=s;
      const ref=document.querySelector(refSel);
      const scale = ref ? ref.getBoundingClientRect().width/refW : 1;
      const root = (rootId && document.querySelector('[data-node-id="'+rootId+'"]')) || ref || document.body;
      const nid = el => (el && el.getAttribute) ? el.getAttribute('data-node-id') : null;
      const expOf = q => ({ w:(q.uw!=null?q.uw:q.w), h:(q.uh!=null?q.uh:q.h) });
      const out=[]; let zero=0, unknown=0, total=0;
      for(const s of root.querySelectorAll('svg')){
        if(nid(s)) continue;                       // 自己带 tag → 上面 w/h 那一维已经核过
        total++;
        const r=s.getBoundingClientRect();
        const mw=r.width/scale, mh=r.height/scale;
        if(mw<0.5 || mh<0.5){ zero++; continue; }
        let host=s.parentElement, hops=0;
        while(host && host!==document.documentElement && !nid(host)){ host=host.parentElement; hops++; }
        const hid = nid(host);
        const sp = hid ? map[hid] : null;
        if(!sp){ unknown++; continue; }
        if(sp.rot!=null){ unknown++; continue; }
        const e=expOf(sp);
        if(e.w==null || e.h==null){ unknown++; continue; }
        const over  = (mw-e.w)>tol || (mh-e.h)>tol;
        // 「SVG 是宿主唯一可见内容」= 宿主只有这一个元素子节点、且没有自己的文字
        const solo  = host.children.length===1 && host.children[0]===s && !(host.textContent||'').trim();
        const under = (e.w-mw)>tol || (e.h-mh)>tol;
        if(!over && !(hops===0 && solo && under)) continue;
        let hint='';
        if(under){
          const hcs=getComputedStyle(host);
          const px=((parseFloat(hcs.paddingLeft)||0)+(parseFloat(hcs.paddingRight)||0))/scale;
          const py=((parseFloat(hcs.paddingTop)||0)+(parseFloat(hcs.paddingBottom)||0))/scale;
          // 逐轴判（别要求两轴同时命中）：flex 常把其中一轴 stretch 回原高，只压另一轴——
          // 实测错例 A 的箭头就是 9×36（宽被 padding 压掉 27、高被 stretch 撑回 36），两轴同时命中的写法会漏掉这条病因。
          if((px>0 && Math.abs(mw-(e.w-px))<=tol) || (py>0 && Math.abs(mh-(e.h-py))<=tol))
            hint += `\n     病因：宿主自带 padding（横 ${Math.round(px*10)/10} · 纵 ${Math.round(py*10)/10}），border-box 下 SVG 只拿到内容区 ${Math.round((e.w-px)*10)/10}×${Math.round((e.h-py)*10)/10}。`
                 +  `\n     改法：这块图形是**整个节点**的（含底/环/阴影）就别让它吃 padding —— 宿主 position:relative + <svg> position:absolute;inset:0；`
                 +  `\n           它若真是内容区里的小图标，就该有自己的节点 div，别直接塞进带 padding 的父盒。`;
        }
        if(over){
          let a=host.parentElement, sug=null;
          while(a && a!==document.documentElement){
            const aid=nid(a), q=aid?map[aid]:null;
            if(q){ const qe=expOf(q); if(qe.w!=null && Math.abs(mw-qe.w)<=tol && Math.abs(mh-qe.h)<=tol){ sug={id:aid,name:q.name||'',w:qe.w,h:qe.h}; break; } }
            a=a.parentElement;
          }
          hint += sug
            ? `\n     病因：塞错层级了 —— 祖先 ${sug.id}「${sug.name}」正好是 ${sug.w}×${sug.h}，这块图形是**它**的，不该挂进子节点里。`
            + `\n     改法：把 <svg> 移到 ${sug.id} 的 div 下（往带子节点的 div 里塞内容用「插入」不用「替换」，别把子节点一起吃掉 —— coverage 要核销它们）。`
            : `\n     病因：SVG 比宿主盒还大，溢出了。多半是导出的 viewBox 带了出血/阴影，或该挂在更上层的容器节点上。`;
        }
        out.push({hid, name:sp.name||'', hops, mw:Math.round(mw*10)/10, mh:Math.round(mh*10)/10, ew:e.w, eh:e.h, hint});
      }
      return {bad:out, zero, unknown, total};
    }, specNodes, dump.root, refSel, refW, tol);
    if(inlineSvg && inlineSvg.bad.length){
      console.log(`\n🧩 内联 SVG 跟宿主节点对不上（${inlineSvg.bad.length} 个·这类错另外三道门一个都够不着）：`);
      for(const x of inlineSvg.bad)
        console.log(`❌ <svg> 挂在 ${x.hid}「${x.name}」${x.hops?`（隔了 ${x.hops} 层非 node 容器）`:''}　实测 ${x.mw}×${x.mh} · 宿主真值 ${x.ew}×${x.eh}${x.hint}`);
      console.log(`   🔴 别用 --skip-inline-svg 绕：这一维就是为「门全绿而错的东西摆在屏幕上」补的。`);
      fail += inlineSvg.bad.length;
    } else if(inlineSvg && inlineSvg.total){
      console.log(`\n🧩 内联 SVG 对位：${inlineSvg.total} 个 · ✅ 尺寸都跟宿主节点真值一致`
        + `（跳过 ${inlineSvg.zero} 个 0 尺寸/隐藏 · ${inlineSvg.unknown} 个宿主不在 manifest 或带旋转）`);
    }
    // 导出烤了屏幕底检测（2026-07-22·治「这个 Figma 文件的节点 export 把银幕背景/白卡烤进 PNG·当透明装饰素材用→双层白卡/蓝底矩形/互相遮挡」·反复栽）：
    // 扫带 data-node-id 的 <img>，canvas 读四角：全不透明 + 四角同色 + 偏淡蓝(屏幕底特征) = 疑似烤底。产品照片(四角杂色)/纯白卡(CSS非img)不误伤。
    const bakedBg = arg('skip-baked-bg') ? [] : await p.evaluate(()=>{
      const out=[];
      // 🔴 既扫 img 自己带 node-id 的，也扫「外层 div 带 node-id、img 在里面」的（2026-07-29 修）：
      //    scaffold 生成的页面一律是后一种（node-id 在 div 上），实测某页 11 个 <img> 里 0 个自己带 id
      //    → 这一维在所有骨架页面上**从来没真正跑过**，门体检造错例才暴露出来。
      document.querySelectorAll('img[data-node-id], [data-node-id] img').forEach(img=>{
        if(!img.complete||!img.naturalWidth) return;
        let ps; try{ const c=document.createElement('canvas'); c.width=img.naturalWidth; c.height=img.naturalHeight; const x=c.getContext('2d'); x.drawImage(img,0,0); const W=c.width,H=c.height; ps=[[2,2],[W-3,2],[2,H-3],[W-3,H-3]].map(([a,b])=>Array.from(x.getImageData(a,b,1,1).data)); }catch(e){ return; }
        if(!ps.every(p=>p[3]>250)) return;                 // 有透明角=没烤底·正常
        const avg=[0,1,2].map(i=>ps.reduce((s,p)=>s+p[i],0)/4);
        const spread=Math.max(...ps.map(p=>Math.max(Math.abs(p[0]-avg[0]),Math.abs(p[1]-avg[1]),Math.abs(p[2]-avg[2]))));
        const bluish = avg[2]>avg[0]+3 && avg[2]>200 && avg[0]>195 && avg[0]<252;  // 淡蓝屏幕底(非纯白·蓝略高)
        if(spread<14 && bluish){ const holder=img.closest('[data-node-id]');
          out.push({id:(img.getAttribute('data-node-id')||(holder&&holder.getAttribute('data-node-id'))||'(无 node-id)'),
                    color:'rgb('+avg.map(v=>Math.round(v)).join(',')+')'}); }
      });
      return out;
    });
    if(bakedBg.length){
      console.log(`\n🎨 疑似烤了屏幕背景的素材（${bakedBg.length}·这个 Figma 文件的节点 export 会把银幕底色/白卡烤进 PNG）：`);
      for(const x of bakedBg) console.log(`❌ ${x.id} 四角≈${x.color} 不透明淡蓝(该透明却是实色屏幕底)→别直接用节点 export·改用 raw 源图/干净透明素材(如从旧 demo 取)。`);
      console.log(`   确属正确(如本就是蓝底卡)可加 --skip-baked-bg。`);
      fail += bakedBg.length;
    }
    // 断链图检测（2026-07-16 根治·治「图标/图片没加载·尤其 download 返回 SVG 存成 .png 浏览器解不了」这一整类·不管有没有进 manifest 都扫）：
    //   扫全页每个 <img>，naturalWidth===0 / 加载失败 = 断链，计入 fail。用户两次栽在图标断链上。
    const brokenImgs = arg('skip-broken-img') ? [] : await p.evaluate(()=>{
      const out=[]; document.querySelectorAll('img').forEach(im=>{ if(!im.complete || im.naturalWidth===0){ out.push(im.getAttribute('src')||im.currentSrc||'(no src)'); } }); return out;
    });
    if(brokenImgs.length){
      console.log(`\n🖼️ 断链图片（${brokenImgs.length} 个 <img> 没加载出来·naturalWidth=0）：`);
      for(const s of brokenImgs) console.log(`❌ ${s}`);
      console.log(`   常见根因：① download_assets 对矢量图标返回的是 SVG·却存成了 .png（浏览器按扩展名当 PNG 解不了）→ 改存 .svg 并清 preserveAspectRatio="none" 坏头 ② 路径错/文件缺失。确属故意占位可加 --skip-broken-img。`);
      fail += brokenImgs.length;
    }
    // 机器核不到的三类 → 显式列成「必须目视/确认」清单（治「geom 绿了盲区还错着」·不判失败但逼你逐条核）
    const mAbs=result.manualAbs||[], mImg=result.manualImg||[], mAlign=result.manualAlign||[], mRot=result.manualRot||[];
    if(mAbs.length || mImg.length || mAlign.length || mRot.length){
      console.log(`\n🔍 geom-check 核不到·必须目视/确认（不判失败·但一条条核完才算 1:1）：`);
      if(mImg.length){ console.log(`  ▸ 带边框/圆角的图片框（${mImg.length}）——必须用 rawImages 源图重搭·绝不能用 download_assets 的 export（会把边框+缩放烤成死图）：`);
        for(const m of mImg) console.log(`     · ${m.label} (${m.id})${m.fit?` scaleMode=${m.fit}(${m.fit==='FIT'?'contain':m.fit==='FILL'?'cover':m.fit})`:''}`); }
      if(mAbs.length){ console.log(`  ▸ 绝对定位元素（${mAbs.length}）——位置/贴边 geom 核不到·目视核角落与浮层：`);
        for(const m of mAbs) console.log(`     · ${m.label} (${m.id}) ${m.rel}`); }
      if(mAlign.length){ console.log(`  ▸ 非默认对齐容器（${mAlign.length}）——核 justify/align 别默认左上：`);
        for(const m of mAlign) console.log(`     · ${m.label} (${m.id}) ${m.a}`); }
      if(mRot.length){ console.log(`  ▸ Figma 有旋转但 DOM 无 transform（${mRot.length}）——确认是否已把旋转烤进图/SVG（如箭头这类矢量·对；若该元素本应 CSS rotate 却没转=漏）：`);
        for(const m of mRot) console.log(`     · ${m.label} (${m.id}) Figma旋转${m.rot}°→ CSS应rotate(${-m.rot}°)·核它是烤进图还是漏了`); }
    }
    // 渐变机器核不到（SVG fill/伪元素·computed 读不到渐变串）→ 列 Figma 真值逐个核（治「✨90°当45°/radial漏做」·不判失败但别静默跳过）
    const mGrad=result.manualGrad||[];
    if(mGrad.length){
      console.log(`\n🌈 必须核渐变（${mGrad.length} 个·SVG fill/伪元素 computed 读不到·逐个核方向+停靠位置·别 90°当45°/0%当30%）：`);
      for(const m of mGrad) console.log(`     · ${m.label} (${m.id}) ${m.kind}·停靠 ${m.stops.map(x=>x.c+'@'+Math.round(x.p*100)+'%').join(' → ')}`);
    }
    // 🔤 字体度量一致性判决（2026-07-29·分两档，因为「正确」的上界 0.9997 离灰区只有 0.0023 余量，
    //    一刀硬拦会有假红风险；而「明显换错字体」离得很远，可以硬拦）：
    //      · 中位 >1.01 或 <0.97  → 判失败（Arial 那一档 1.0179 在这里）
    //      · 1.002~1.01 / 0.97~0.985 → 灰区，响亮告警并点名病因（本机 2018 静态 Roboto 那一档 1.0043 在这里）
    //      · 样本 <4 个 → 只报数不判（中位数没意义）
    {
      const tl = [...new Set(result.textCutLegacy || [])];
      if(tl.length) console.log(`\n⚠️ 判据退化 ${tl.length} 处：manifest 没有 textCut 字段（老版 dump），` +
        `而这些文案恰好以 … 结尾 —— 只能退回「末尾是 … 就当被截断」去猜，于是**最后一个字符写错也不报**。\n` +
        `   涉及：${tl.slice(0,4).join(' / ')}${tl.length>4?' …':''}　→ 重跑一次 dump 拿新 manifest 即可恢复严格比对。`);
    }
    // 📏 文字行数不符（2026-08-02 立）—— 放在最前面，因为它常常是下面一串「容器 h 不符」的**唯一病因**。
    {
      const li = result.lineIssues || [];
      if(li.length){
        console.log(`\n❌ 文字折行数跟 Figma 不一致 ${li.length} 处 —— 这通常就是上面那些「容器 h: 期望X 实际Y」的病因：`);
        for(const x of li){
          console.log(`   · ${x.label} (${x.id})  Figma ${x.fig} 行 / 实际 ${x.dom} 行` +
                      `　盒宽 ${x.w} · ${x.fs}px/lh${x.lh}　「${x.text}${x.text.length>=34?'…':''}」`);
        }
        console.log(`   多一行 = 有个词没放下（多半是字宽差零点几 px，去看上面的「字体字符覆盖 / 度量一致性」两维）；`);
        console.log(`   少一行 = 该折没折（多半是 nowrap 或盒宽比 Figma 宽）。`);
        console.log(`   🔴 别去调祖先容器的高度把它压回去 —— 那是把病因焊死在结果上，换个文案就又不对了。`);
        fail += li.length;
      }
    }
    // 🔤 字体字符覆盖（2026-08-02 立）—— 排在「度量一致性」前面，因为它是那一维的**上游病因之一**：
    //    字体缺字符时，缺的那几个字由系统字体渲染，度量比值反而可能看着正常（缺的字太少摊不进中位数），
    //    而真实后果是折行点/截断点整个不对。这一维直接判「这个字族到底有没有这个字形」，无歧义。
    {
      const fc = result.fontCoverage;
      if(fc && fc.miss && fc.miss.length){
        const byFam = new Map();
        for(const m of fc.miss){ if(!byFam.has(m.fam)) byFam.set(m.fam, []); byFam.get(m.fam).push(m); }
        console.log(`\n❌ 内联字体缺字符 —— 浏览器会把这些字**静默**交给系统字体渲染（不报任何错）：`);
        for(const [fam, list] of byFam){
          console.log(`   字族 "${fam}" 缺 ${list.length} 个字形：` +
            list.slice(0,12).map(m=>`${JSON.stringify(m.ch)}(${m.cp})`).join(' ') + (list.length>12?` …还有 ${list.length-12} 个`:''));
          const eg = list[0];
          console.log(`     例：${eg.nid?`节点 ${eg.nid} `:''}文本「${eg.ctx}${eg.ctx.length>=28?'…':''}」`);
        }
        console.log(`   为什么这是硬错：回退字体的 advance 跟目标字体不同 → 折行点、ellipsis 截断点、HUG 盒宽全跟着错，`);
        console.log(`   而几何/像素门都可能照样全绿（差异只有 1-4px、且表现为「某个祖先容器高度不对」）。`);
        console.log(`   头号来源：**Google Fonts 的 woff2 是按 unicode-range 切好的 subset 分片**，`);
        console.log(`   直接下来内联就会缺 … · 之类。改法：取完整字体（github.com/google/fonts 的 ofl/<family>/），`);
        console.log(`   自己用 fontTools subset 到本页字符集，并在打包脚本里断言这些码点还在 cmap 里。`);
        fail += 1;
      } else if(fc && fc.declared.length){
        console.log(`\n🔤 字体字符覆盖：@font-face 字族 ${fc.declared.join(' / ')} · 探了 ${fc.probed} 个「字族×字形」组合  ✅ 无缺字（不会静默回退）`);
      }
    }
    const fr = result.fontRatios || [];
    if(!arg('skip-fontmetric') && fr.length){
      const rs = fr.map(x=>x.ratio).sort((a2,b2)=>a2-b2);
      const med = rs[Math.floor(rs.length/2)];
      const worst = fr.slice().sort((a2,b2)=>Math.abs(b2.ratio-0.995)-Math.abs(a2.ratio-0.995)).slice(0,3);
      const hard = med>1.01 || med<0.97;
      const gray = !hard && (med>1.002 || med<0.985);
      const head = `\n🔤 字体度量一致性：可量 ${fr.length} 个「自动宽度·单行」文字，字形实测宽 / Figma 盒宽 中位 = ${med}`;
      if(fr.length<4){
        console.log(head + `（样本 <4，中位数不作判据，只报数）`);
      } else if(hard || gray){
        console.log(head + `　基线约 0.995（Figma 把自动宽度盒取整，字形恒略窄于盒）`);
        console.log(`   偏得最多的三处：` + worst.map(w=>`${w.label}(${w.id}) fs=${w.fs} figma=${w.figma} 字形=${w.glyph} 比值=${w.ratio}`).join(' ｜ '));
        console.log(`   病因几乎总是**字体来源不对**，而不是某个文字写错：`);
        console.log(`     · 偏宽（>1）→ 多半用了同族但不同版本的字体。实测本机装的是 2018 版 Roboto，Figma 用的是 2024 改版后的新 Roboto`);
        console.log(`       （判据：Figma 侧 listAvailableFontsAsync 里 Roboto 若有 SemiBold/Condensed，就是新版）→ 换 Google Fonts 的可变字体，一条 @font-face 覆盖 100-900`);
        console.log(`     · 偏窄（<0.985）→ 多半落到了 Condensed/别的字族，或 @font-face 根本没生效（离线/断链）`);
        console.log(`   ⚠️ 这一维只看**全页中位数**，个别文字偏多不算（截断/多行/FIXED 宽度的已排除）。确属误报可加 --skip-fontmetric。`);
        if(hard){ console.log(`❌ 中位 ${med} 落在「明显换错字体」区间（>1.01 或 <0.97）`); fail += 1; }
        else console.log(`⚠️ 中位 ${med} 落在灰区（1.002~1.01 / 0.97~0.985）—— 不判失败，但**大概率真的换错了版本**，值得去核字体来源`);
      } else {
        console.log(head + `　✅ 在正常区间（实测标定：正确 0.993~1.000 / 同族错版本 ≈1.004 / 换字族 ≈1.018）`);
      }
    }
    // 老 manifest 缺 bInLayout → 内描边那一维只能退回「pad 或 pad−描边都放行」，等于放行写错一侧（2026-07-29）
    const mLegacy=result.insideLegacy||[];
    if(mLegacy.length){
      const ids=[...new Set(mLegacy.map(x=>x.id))];
      console.log(`\n⚠️ 内描边判据退化成宽松模式（${ids.length} 个节点）——这份 manifest 没有 bInLayout 字段（dump 版本旧）：`);
      for(const m of mLegacy) console.log(`     · ${m.label} (${m.id}) ${m.k}=${m.pad}·描边${m.bw} → ${m.pad} 和 ${Math.max(0,m.pad-m.bw)} 两个值都放行`);
      console.log(`   这一维现在抓不到「padding 写错一侧」（内容整块偏一个描边宽·实测偏 2px 时 geom 全绿）。`);
      console.log(`   修：用当前版 figma-restore-dump.snippet.js 重新 dump 一次拿到 bInLayout，判据就变成确定的单值。`);
    }
    const mFill=result.manualFill||[];
    if(mFill.length){
      console.log(`\n🥞 必须核多层填充（${mFill.length} 个·computed 只读得到一层·叠色顺序/混合模式/顶层半透明罩机器核不到）：`);
      for(const m of mFill){
        const desc=m.layers.map(L=>{
          const kind = L.t==='S' ? (L.c||'实色') : (L.t==='I' ? ('图'+(L.fit?'('+L.fit+')':'')) : '渐变');
          return (L.off?'✗隐藏 ':'')+kind+(L.op!=null?' @'+L.op:'')+(L.bl?' ['+L.bl+']':'');
        }).join('  →  ');
        console.log(`     · ${m.label} (${m.id}) 自下而上：${desc}`);
      }
      console.log('       （✗隐藏=Figma 里关掉了·别照着做｜[DARKEN] 这类要用 CSS mix-blend-mode｜顶层半透明罩要单独一层·别并进底色）');
    }
    console.log(`\n结果：${fail===0?'全绿 ✅ 几何+颜色均符合 Figma 真值':'有 '+fail+' 项不符 ❌（修完再跑直到全绿）'}${warn?`  · ${warn} 项 node-id 待核`:''}${(mAbs.length||mImg.length||mAlign.length||mRot.length||mGrad.length||mFill.length)?`  · ${mAbs.length+mImg.length+mAlign.length+mRot.length+mGrad.length+mFill.length} 项需目视核`:''}\n`);
    if(fail===0) stampPass('figma-spec', { url, spec: require('path').resolve(figmaSpecPath), topLevel: !!(dump._root && dump._root.topLevel) });
    await p.close(); await b.disconnect();
    process.exit(fail===0?0:1);
  }

  // ── 模式 A：手写 --checks（原逻辑，保持不变）──
  const checks=JSON.parse(fs.readFileSync(checksPath,'utf8'));
  const result = await p.evaluate((checks, refSel, refW, tol, KEYS, EXACT_KEYS) => {
    const ref=document.querySelector(refSel);
    const scale = ref ? ref.getBoundingClientRect().width/refW : 1;
    const num=v=>parseFloat(v)||0;
    const rows=[];
    for(const c of checks){
      const els=[...document.querySelectorAll(c.sel)];
      if(!els.length){ rows.push({label:c.label||c.sel, sel:c.sel, miss:true}); continue; }
      const targets = c.all ? els : [els[c.idx||0]];
      targets.forEach((el,ti)=>{
        const r=el.getBoundingClientRect(), cs=getComputedStyle(el);
        // w/h：旋转元素用 offsetWidth/Height(旋转前布局尺寸=Figma 内在 node.width)·不用 getBoundingClientRect(旋转膨胀 AABB·会把卡假红)。非旋转不变。
        const _rot = cs.transform && cs.transform!=='none' && /matrix/.test(cs.transform);
        // 🔴 祖先链上有 transform 时也要用 offsetWidth（2026-07-27 补）：getBoundingClientRect 给的是
        // 膨胀后的 AABB，而 Figma 的 uw/uh 是本地未旋转盒 → 元素自己没旋转、父级旋转了，就会假红。
        // 实测：购物篮自己不转、父白卡转 −10°，量出 100×91.1 去对期望 88×77（= 88×77 转 10° 的 AABB）。
        let _inRot=_rot; for(let _a=el.parentElement; _a && !_inRot; _a=_a.parentElement){ const _t=getComputedStyle(_a).transform; if(_t&&_t!=='none'&&/matrix/.test(_t)) _inRot=true; }
        const meas={ w:(_inRot&&typeof el.offsetWidth==='number'&&el.offsetWidth)?el.offsetWidth:r.width/scale, h:(_inRot&&typeof el.offsetHeight==='number'&&el.offsetHeight)?el.offsetHeight:r.height/scale,
          pt:num(cs.paddingTop)/scale, pr:num(cs.paddingRight)/scale, pb:num(cs.paddingBottom)/scale, pl:num(cs.paddingLeft)/scale,
          bt:num(cs.borderTopWidth)/scale, br:num(cs.borderRightWidth)/scale, bb:num(cs.borderBottomWidth)/scale, bl:num(cs.borderLeftWidth)/scale,
          rad:num(cs.borderTopLeftRadius)/scale, fs:num(cs.fontSize)/scale, fw:num(cs.fontWeight) };
        const diffs=[];
        for(const k of KEYS){
          if(c[k]==null) continue;
          const t = k==='fw'?2:tol;
          if(Math.abs(meas[k]-c[k])>t) diffs.push(`${k}: 期望${c[k]} 实际${Math.round(meas[k]*10)/10}`);
        }
        for(const k of EXACT_KEYS){   // 字号/字重精确比·同模式 B
          if(c[k]==null) continue;
          if(Math.abs(meas[k]-c[k])>0.5) diffs.push(`${k}: 期望${c[k]} 实际${Math.round(meas[k]*10)/10}`);
        }
        rows.push({label:(c.label||c.sel)+(c.all?`[${ti}]`:''), sel:c.sel, ok:!diffs.length, diffs});
      });
    }
    return {scale, rows};
  }, checks, refSel, refW, tol, KEYS, EXACT_KEYS);

  console.log(`\n渲染缩放 scale=${result.scale.toFixed(4)}  (ref ${refSel}=${refW})  容差±${tol}px\n`);
  let fail=0;
  for(const r of result.rows){
    if(r.miss){ console.log(`❌ ${r.label}  —— 选择器没匹配到元素 (${r.sel})`); fail++; continue; }
    if(r.ok){ console.log(`✅ ${r.label}`); }
    else { console.log(`❌ ${r.label}  ${r.diffs.join(' | ')}`); fail++; }
  }
  console.log(`\n结果：${fail===0?'全绿 ✅ 全部符合 spec':'有 '+fail+' 项不符 ❌（修完再跑直到全绿）'}\n`);
  // 机器兜底警告（2026-07-09 tab 激活下划线翻车沉淀）：手写 --checks 只核你手挑的属性，
  // 必然漏你没想到的（本次漏了激活 tab 的 border-bottom·因为它被 ::after 近似、不在被核 id 上）。
  // 有 data-node-id 的元素应走 --figma-spec：dump 出该节点每个属性(含 border/盒高)逐个自动比对，漏不掉。
  const idCount = await p.evaluate(()=>document.querySelectorAll('[data-node-id]').length);
  if(idCount>0){
    console.log(`⚠️  盲区提醒：本次「手写 --checks」只核了你手挑的 ${result.rows.length} 项，但页面有 ${idCount} 个 [data-node-id] 元素。`);
    console.log(`   手挑检查项 = 你自己想到的那几项 → 漏你没想到的属性(border/盒高/圆角…)。tab 激活下划线就这么漏的。`);
    console.log(`   👉 有 node-id 的元素请改走 --figma-spec 全属性自动核；手写 checks 只配用于「无 node-id / 临时点查」。`);
  }
  if(fail===0) stampPass('checks');
  await p.close(); await b.disconnect();
  process.exit(fail===0?0:1);
})().catch(e=>{ console.log('ERR '+e.message); process.exit(2); });
