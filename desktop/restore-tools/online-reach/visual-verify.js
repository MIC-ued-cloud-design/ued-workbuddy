// visual-verify.js — Figma 还原「逐元素像素比对」门（2026-07-16 立·根治「图形位置错 / 自定义 SVG 用错字形，geom-check 全绿也查不出」）
// ─────────────────────────────────────────────────────────────────────────────
// 为什么要它：geom-check 只核几何+颜色数值、coverage 只核有无——都证明不了「渲染出来的像素跟 Figma 一不一样」。
//   加号 vs 放大镜（都 24×24）、✨ 居中 vs 顶部（盒子一样大）——机器量不出差别，全绿也能是错的。
//   本工具拿 Figma 每个元素的真实位置(bbox)，在「我的渲染」和「Figma 渲染」两张图上按同一坐标裁下来逐个比像素，
//   差异超阈值就报是哪个 node 错。图形/图标(VECTOR/BOOLEAN/ELLIPSE/INSTANCE/image)硬判；文字(TEXT)因字体渲染差异走软判(只抓缺失/错位)。
//
// 用法：
//   node visual-verify.js --port 9224 \
//     --url "file:///abs/x.html" --root 62:6204 \      # 我的 HTML + 块根节点 data-node-id
//     --figma /abs/figma-block.png \                    # 该块在 Figma 的截图(get_screenshot 块根节点)
//     --spec /abs/<页面>-manifest.json \                # 含 nodes[].bx/by/w/h(figma-restore-dump 抽·相对块根)
//     [--gthresh 0.10] [--tthresh 0.28] [--out /tmp/vdiff] [--vw 1920]
//   全绿(无硬判失败) exit0 + 盖 restore-visual.pass 戳；有失败 exit1 并列出 node + 存并排/热力图。
//
// 依赖：puppeteer-core(复用 reach 的后台 chrome)。零 python/图像库依赖，比对在 chrome canvas 里做(data-URI 免污染 canvas)。

const puppeteer = require(require('path').join(__dirname, 'node_modules', 'puppeteer-core'));
const fs = require('fs');
const os = require('os');
const path = require('path');
function arg(n, d){ const i=process.argv.indexOf('--'+n); if(i<0) return d; const v=process.argv[i+1]; return (v&&!v.startsWith('--'))?v:true; }

const PORT = arg('port','9224');
const URL = arg('url');
const ROOT = arg('root');               // 块根节点 id（data-node-id）
const FIGMA = arg('figma');             // Figma 块截图 png 路径
const SPEC = arg('spec');               // manifest（含 nodes[].bx/by/w/h）
const GTHRESH = parseFloat(arg('gthresh','0.18'));  // 图形/图标 硬判阈值（归一化 0-1·细密图标[靶心/星芒]同一SVG两边光栅化残差可达0.17·故0.18；原来用错字形≥0.25会拦）
const TTHRESH = parseFloat(arg('tthresh','0.28'));  // 文字 软判阈值（字体渲染差异大·放宽）
const OUT = arg('out','/tmp/vdiff');
const VW = parseInt(arg('vw','1920'),10);

if(!URL||!ROOT||!FIGMA||!SPEC){ console.log('ERR 需要 --url --root --figma --spec'); process.exit(2); }
if(!fs.existsSync(FIGMA)){ console.log('ERR figma 图不存在: '+FIGMA); process.exit(2); }

const GRAPHIC = new Set(['VECTOR','BOOLEAN_OPERATION','ELLIPSE','STAR','POLYGON','LINE']);
// 2026-07-28 修：`n.img` 只存在于 manifest 的 **leaves**，nodes 数组里图片填充的标记是 `imgFit`。
// 所以「图片填充的 FRAME/RECTANGLE」（= 所有产品图卡）一直被判成非图形 → 走文字软阈值 0.28。
// 实测：把两张产品图对调，diff 只有 0.136/0.120，四道门全绿放行。
function isImageNode(n){ return n.img===true || n.imgFit!=null; }
function isGraphic(n){ return GRAPHIC.has(n.type) || isImageNode(n) || (n.type==='INSTANCE'); }

(async ()=>{
  let manifest; try{ manifest=JSON.parse(fs.readFileSync(SPEC,'utf8')); }catch(e){ console.log('ERR 读不了 spec: '+e.message); process.exit(2); }
  const nodes=(manifest.nodes||[]).filter(n=>typeof n.bx==='number' && typeof n.by==='number' && n.w>0 && n.h>0);
  const rootNode=(manifest.nodes||[]).find(n=>n.id===ROOT) || (manifest.nodes||[]).find(n=>n.id===ROOT.replace('-',':'));
  if(!rootNode){ console.log('ERR spec 里找不到块根 '+ROOT+'（先用 figma-restore-dump 抽含 bx/by 的 manifest）'); process.exit(2); }
  const ROOTW=rootNode.w, ROOTH=rootNode.h;
  const ROOTRAD=rootNode.rad||0;   // 块根圆角：圆角外不属于设计稿，下面两张图同样地排除掉

  const b = await puppeteer.connect({ browserURL:'http://localhost:'+PORT, defaultViewport:{width:VW,height:Math.max(1080,ROOTH+200)} });
  let out={};
  try{
    const p = await b.newPage();
    await p.goto(URL, {waitUntil:'networkidle2', timeout:60000}).catch(()=>{});
    await new Promise(r=>setTimeout(r,800));
    // 我的渲染：定位块根 → 截该区域
    const box = await p.evaluate((rootId)=>{
      const el=document.querySelector('[data-node-id="'+rootId+'"]'); if(!el) return null;
      const r=el.getBoundingClientRect(); return {x:r.x+scrollX,y:r.y+scrollY,w:r.width,h:r.height};
    }, ROOT);
    if(!box){ console.log('ERR 我的 HTML 里没有 [data-node-id="'+ROOT+'"]'); await b.disconnect(); process.exit(2); }
    // hover/隐藏元素跳过像素比对（2026-07-16 根治「为躲 visual 假红而摘 node-id → 连 geom 都逃了·手填假设无人核」）：
    // 默认不可见的(opacity0/display none/visibility hidden/祖先隐藏/零尺寸)本就不在静态帧里·跳过像素比即可；
    // 但它们保留 data-node-id → geom-check 仍核其几何/颜色/字重。不再靠「摘 node-id」躲门。
    const hiddenSet = new Set(await p.evaluate(()=>{
      const h=[];
      document.querySelectorAll('[data-node-id]').forEach(el=>{
        const r=el.getBoundingClientRect(); let hid=(r.width===0||r.height===0), a=el;
        while(a && !hid){ const cs=getComputedStyle(a); if(cs.display==='none'||cs.visibility==='hidden'||parseFloat(cs.opacity)===0) hid=true; a=a.parentElement; }
        if(hid) h.push(el.getAttribute('data-node-id'));
      });
      return [...new Set(h)];
    }));
    const visNodes = nodes.filter(n=>!hiddenSet.has(n.id));
    const skipped = nodes.length - visNodes.length;
    // ── 纯色底净区取样（2026-07-27 根治「半透明层压在白底上把按钮洗成淡蓝·三门全绿也看不出」）──
    // 🔴 为什么整体 diff 抓不到：5% 的整体色洗算下来 diff 只有 0.055，远低于图形阈值 0.18 → 全绿放行。
    //    这类错要用「纯色区均值 + 三通道落差」这种定点判据，不能靠整块平均差。
    // 🔴 为什么比 Figma 渲染图而不是比节点填充值：稿子里本来就有的蒙层会让「节点填充=#fff」但渲染就该是灰的，
    //    拿节点值当真值必误报。两张图取同一块净区互比，稿里有的蒙层两边都有 → 天然不误报。
    // 净区 = 元素内部避开 border/padding、且不与任何**后代**元素相交的一小块（后代=文字/图标，抗锯齿会干扰）。
    //    上层遮挡**不排除**——那正是要抓的东西。旋转元素按短边 18% 内缩以保证落在旋转后的形状内。
    const SOLID_TYPES = new Set(['FRAME','RECTANGLE','INSTANCE','COMPONENT','ELLIPSE']);
    const solidSpots = await p.evaluate((specNodes, ox, oy, TYPES)=>{
      const out=[];
      for(const s of specNodes){
        if(!s.bg || !s.bg.c) continue;
        if(s.bg.op!=null && s.bg.op<0.99) continue;                  // 半透明底：computed 那边已硬查
        if(s.bgKind==='gradient' || s.imgFit || s.imgBox) continue;  // 渐变/图片填充框：底色本就被盖
        if(!TYPES.includes(s.type)) continue;                        // 矢量/星形/线：fill 只覆盖路径不覆盖盒子·采样必落空
        const el=document.querySelector('[data-node-id="'+CSS.escape(s.id)+'"]');
        if(!el) continue;
        const cs=getComputedStyle(el); const r=el.getBoundingClientRect();
        if(r.width<10||r.height<10) continue;
        const num=k=>parseFloat(cs[k])||0;
        const rot = cs.transform && cs.transform!=='none';
        const pad = rot ? Math.min(r.width,r.height)*0.18 : 2;       // 旋转元素往里收·保证落在旋转后的形状内
        const bL=num('borderLeftWidth'), bR=num('borderRightWidth'), bT=num('borderTopWidth'), bB=num('borderBottomWidth');
        const S=5;
        const rect=(l,t,ri,bo)=>({l,t,r:ri,b:bo});
        // 两圈候选：① 内容区内缩（避开 padding）② 只避开 border 的「内边距环」——
        //    按钮这种文字占满内容区的，净区只可能在 padding 环上（这是第一版把按钮判成"取不到净区"的原因）
        const boxes=[
          rect(r.left+bL+num('paddingLeft')+pad, r.top+bT+num('paddingTop')+pad, r.right-bR-num('paddingRight')-pad, r.bottom-bB-num('paddingBottom')-pad),
          rect(r.left+bL+pad, r.top+bT+pad, r.right-bR-pad, r.bottom-bB-pad)
        ];
        const kids=[...el.querySelectorAll('*')].map(k=>k.getBoundingClientRect()).filter(k=>k.width>0&&k.height>0);
        let pick=null;
        for(const bx of boxes){
          if(bx.r-bx.l<S||bx.b-bx.t<S) continue;
          const cxm=(bx.l+bx.r)/2-S/2, cym=(bx.t+bx.b)/2-S/2;
          // 圆角/胶囊：四角落在弧边上（不平·两图 1px 错位就假报），所以**先取四边中点**再取角，
          // 且角按圆角半径再内缩（2026-07-27：按钮 radius:1000 的胶囊就是栽在这，第一版四角全落弧上）。
          const rad=Math.min(parseFloat(cs.borderTopLeftRadius)||0, (bx.r-bx.l)/2, (bx.b-bx.t)/2);
          const spots = s.type==='ELLIPSE' ? [[cxm,cym]] : [
            [bx.l, cym], [bx.r-S, cym], [cxm, bx.t], [cxm, bx.b-S], [cxm, cym],
            [bx.l+rad, bx.t+rad], [bx.r-S-rad, bx.t+rad], [bx.l+rad, bx.b-S-rad], [bx.r-S-rad, bx.b-S-rad]
          ];
          for(const [sx,sy] of spots){
            if(sx<bx.l-0.5||sy<bx.t-0.5||sx+S>bx.r+0.5||sy+S>bx.b+0.5) continue;
            if(kids.some(k=>!(k.right<=sx||k.left>=sx+S||k.bottom<=sy||k.top>=sy+S))) continue;  // 后代=文字/图标·抗锯齿会干扰
            pick=[sx,sy]; break;
          }
          if(pick) break;
        }
        if(!pick){ out.push({id:s.id,name:s.name,nosample:'后代元素占满·取不到净区'}); continue; }
        // 换算成「相对块根」的坐标（块根 box 是页面坐标，这里是视口坐标，补上滚动量）→ 两张图共用
        out.push({id:s.id, name:s.name, x:Math.round(pick[0]+scrollX-ox), y:Math.round(pick[1]+scrollY-oy), s:S});
      }
      return out;
    }, visNodes, box.x, box.y, [...SOLID_TYPES]);
    const mineBuf = await p.screenshot({clip:{x:box.x,y:box.y,width:Math.round(box.w),height:Math.round(box.h)}});
    const mineB64 = 'data:image/png;base64,'+mineBuf.toString('base64');
    const figmaB64 = 'data:image/png;base64,'+fs.readFileSync(FIGMA).toString('base64');

    // canvas 逐元素比对（在 chrome 内做，data-URI 不污染 canvas → 可 getImageData）
    const res = await p.evaluate(async (figmaSrc, mineSrc, W, H, nodes, SPOTS, RAD)=>{
      function load(src){ return new Promise((res,rej)=>{ const im=new Image(); im.onload=()=>res(im); im.onerror=rej; im.src=src; }); }
      const [fi,mi]=await Promise.all([load(figmaSrc),load(mineSrc)]);
      // 🔴 块根有圆角 → 圆角外那几百个像素**不属于设计稿**，两边各画各的（Figma 那边常被烤进
      //    画布底色 rgb(30,30,30)，我这边是页面 body 底色），拿去比必然是假红。
      //    实测代价：banner 那张四角共 333px，落进图片内容比某一格 → 报「格差 24.4」，
      //    而那道门的提示语指向「你挑错图了」→ 两个独立执行者都为此白跑一轮（一个换图、一个换底片）。
      //    做法：两边同样地把圆角外填成同一中性色 → 那部分差异恒为 0，圆角内一个像素不动。
      //    🔴 分工要写清：这样一来「圆角半径写错」在这道门就看不见了，那一维**由 geom 的 rad 硬核**
      //       （±0.5px，2026-07-29 收紧过）。别以为 visual 还在管圆角。
      const MASKC='#808080';
      let maskedPx=0, maskWhy='';
      function ctxOf(img){
        const c=document.createElement('canvas'); c.width=W; c.height=H; const x=c.getContext('2d');
        const canRound = RAD>0 && typeof x.roundRect==='function';
        if(canRound){ x.fillStyle=MASKC; x.fillRect(0,0,W,H); x.save(); x.beginPath(); x.roundRect(0,0,W,H,RAD); x.clip(); }
        else if(RAD>0 && !maskWhy) maskWhy='这个 Chrome 没有 ctx.roundRect，圆角外没排除（圆角外的假红仍可能出现）';
        x.drawImage(img,0,0,W,H);
        if(canRound) x.restore();
        return x;
      }
      const fx=ctxOf(fi), mx=ctxOf(mi);
      if(RAD>0 && !maskWhy) maskedPx=Math.round(4*RAD*RAD*(1-Math.PI/4));
      const fD=fx.getImageData(0,0,W,H).data, mD=mx.getImageData(0,0,W,H).data;
      // 局部对齐容差：figma 固定，mine 在 ±WIN px 窗口里平移取最小差
      // → 容忍字体渲染宽度差导致的几px漂移(2-3px)，但字形用错(任何位移都对不上)/真实位置错(超窗口)照样报
      const WIN=4;
      function diffAt(bx,by,w,h,dx,dy){
        let sum=0,cnt=0;
        for(let y=0;y<h;y++){ for(let x=0;x<w;x++){
          const fx=bx+x, fy=by+y, mx=bx+x+dx, my=by+y+dy;
          if(fx<0||fy<0||fx>=W||fy>=H||mx<0||my<0||mx>=W||my>=H) continue;
          const fi=(fy*W+fx)*4, mi=(my*W+mx)*4;
          sum+=(Math.abs(fD[fi]-mD[mi])+Math.abs(fD[fi+1]-mD[mi+1])+Math.abs(fD[fi+2]-mD[mi+2]))/3; cnt++;
        }}
        return cnt? sum/cnt/255 : 1;
      }
      function regionDiff(bx,by,w,h){
        bx=Math.round(bx); by=Math.round(by); w=Math.round(w); h=Math.round(h);
        let best=1;
        for(let dy=-WIN;dy<=WIN;dy++){ for(let dx=-WIN;dx<=WIN;dx++){ const d=diffAt(bx,by,w,h,dx,dy); if(d<best){best=d; if(best<0.01) return best;} } }
        return best;
      }
      const per=nodes.map(n=>({id:n.id,name:n.name,type:n.type,graphic:n.__g,diff:Math.round(regionDiff(n.bx,n.by,n.w,n.h)*1000)/1000}));

      // 🖼 图片内容比（2026-07-28 新增·根治「换错图/图放错位置·四门全绿」）：
      // 上面的 regionDiff 是**整框求平均**——产品图大半是白底，只有中间那个东西不一样，
      // 一平均就被摊没了（实测红包↔米色包对调只有 0.136，连图形阈值 0.18 都够不到）。
      // 这里改成**分格比**：4×4 网格各求均色，取「差得最狠的那一格」。
      // 白底那些格两边都一样、贡献 0，主体那几格差多少就报多少 —— 专抓「同一个框里装了另一张图」。
      // 用 regionDiff 找到的最佳位移采样，跟像素门共用同一套 ±4px 对齐容差，不会因为几 px 漂移误报。
      function bestOff(bx,by,w,h){
        let best=1,bd=[0,0];
        for(let dy=-WIN;dy<=WIN;dy++){ for(let dx=-WIN;dx<=WIN;dx++){ const d=diffAt(bx,by,w,h,dx,dy); if(d<best){best=d; bd=[dx,dy];} } }
        return bd;
      }
      const GRID=4, IMG_MIN=64;
      function gridMaxCell(bx,by,w,h){
        bx=Math.round(bx); by=Math.round(by); w=Math.round(w); h=Math.round(h);
        // 🔴 只核「照片尺寸」的图（≥64×64）。实测这个指标随框变小而失真：同一张正确的稿里，
        //    105×105 以上的真产品图是 0.8-3.1，而插画内部 9×16 那些碎片高到 35.8（格只剩 2×4 px，
        //    一点重采样模糊就把均色拉飞）。它们本来也不是独立摆的图（已并进一张拍平的插画 PNG）。
        //    所以这道门的适用范围 = 独立摆放的照片；更小的图仍由像素硬判(0.18)兜着。
        if(w<IMG_MIN||h<IMG_MIN) return null;
        const [ox,oy]=bestOff(bx,by,w,h);
        let worst=0, worstCell=null;
        for(let gy=0;gy<GRID;gy++){ for(let gx=0;gx<GRID;gx++){
          const x0=Math.floor(gx*w/GRID), x1=Math.floor((gx+1)*w/GRID);
          const y0=Math.floor(gy*h/GRID), y1=Math.floor((gy+1)*h/GRID);
          let fr=0,fg=0,fb=0,mr=0,mg=0,mb=0,cnt=0;
          for(let y=y0;y<y1;y++){ for(let x=x0;x<x1;x++){
            const FX=bx+x, FY=by+y, MX=bx+x+ox, MY=by+y+oy;
            if(FX<0||FY<0||FX>=W||FY>=H||MX<0||MY<0||MX>=W||MY>=H) continue;
            const fi=(FY*W+FX)*4, mi=(MY*W+MX)*4;
            fr+=fD[fi]; fg+=fD[fi+1]; fb+=fD[fi+2];
            mr+=mD[mi]; mg+=mD[mi+1]; mb+=mD[mi+2]; cnt++;
          }}
          if(!cnt) continue;
          const d=Math.sqrt(((fr-mr)/cnt)**2+((fg-mg)/cnt)**2+((fb-mb)/cnt)**2)/Math.sqrt(3);
          if(d>worst){ worst=d; worstCell=gx+','+gy; }
        }}
        return { max:Math.round(worst*10)/10, cell:worstCell };
      }
      const imgcmp=[];
      // 2026-07-28 扩到**所有图形节点**（不只图片）：造错例时把箭头矢量换成一个三角形，
      // 整框 diff 只有 0.1x（细箭头在 93×94 的框里大半是背景，一平均就摊没了）→ 硬阈值 0.18 照样放行。
      // 分格比对这类「稀疏图形被换掉」同样有效：图形占的那几格差多少就报多少。
      for(const n of nodes){ if(!n.__img && !n.__g) continue; const g=gridMaxCell(n.bx,n.by,n.w,n.h); if(g) imgcmp.push({id:n.id,name:n.name,max:g.max,cell:g.cell,img:!!n.__img}); }
      // 文字墨水量比（2026-07-27 新增·根治「字重错了三门全绿」）：
      // 上面的 regionDiff 对 TEXT 走软判(0.28)，为的是容忍字体渲染差异 —— 但「400 被渲染成 700」
      // 也一起被容忍进去了（实测那次 Keep Sourcing 墨水多 63%，coverage/geom/visual 三门照样全绿，
      // 是人眼在并排图上看出来的）。墨水量 = 框内相对最亮处的暗度总和：对抗锯齿不敏感（±5%），
      // 对字重/字号/缺字敏感（差一档字重 ≈ 60%），正好补这一维。
      const ink=[], inkSkip=[];
      for(const n of nodes){
        if(n.type!=='TEXT') continue;
        const bx=Math.round(n.bx), by=Math.round(n.by), w=Math.round(n.w), h=Math.round(n.h);
        if(w<4||h<4) continue;
        const sum=(D)=>{ let mx=0; const v=[];
          for(let y=0;y<h;y++) for(let x=0;x<w;x++){
            const px=bx+x, py=by+y; if(px<0||py<0||px>=W||py>=H){ v.push(null); continue; }
            const i=(py*W+px)*4; const l=(D[i]+D[i+1]+D[i+2])/3; v.push(l); if(l>mx) mx=l;
          }
          let s=0; for(const l of v) if(l!=null) s+=Math.max(0,mx-l); return s; };
        const fInk=sum(fD), mInk=sum(mD);
        // 该框几乎没墨水 → 比值是两个噪声底相除，无意义。
        // 🔴 判据必须按**密度**、不能只看绝对值（2026-07-29 修·原来只有 fInk<200 这个绝对阈值）：
        //   触屏 SERP 的「in Liquid Fertilizer」整个被 Safari 底栏盖住，两图该框最大像素差只有 0.7/255，
        //   但框大（95×18=1710px）→ fInk=1140 越过了 200，于是拿 1140 和 1650 求比 = 报「墨水比 1.45」假红。
        //   实测密度标定（同一页）：可见文字 4.95 / 30.8 / 30.0 每像素，被完全遮住的框 0.67 / 1.22 每像素
        //   → 取 2.0/px 一刀，离最低的真文字还有 2.5 倍余量，离最高的噪声底有 1.6 倍余量。
        //   跳过的方向是安全的（漏判不误判），且这些框的形状差异仍由逐元素像素 diff 兜着。
        const area=w*h, dens=fInk/area;
        if(fInk<200 || dens<2.0){ inkSkip.push({id:n.id,name:n.name,dens:Math.round(dens*100)/100}); continue; }
        ink.push({id:n.id,name:n.name,ratio:Math.round(mInk/fInk*1000)/1000});
      }
      // 纯色净区：两图同坐标取均值比（不做位移搜索——平色块不需要对齐，且位移搜索会把色偏"搜没"）
      const solid=[];
      for(const sp of (SPOTS||[])){
        if(sp.nosample){ solid.push(sp); continue; }
        const mean=(D)=>{ let r=0,g=0,b=0,c=0;
          for(let y=0;y<sp.s;y++) for(let x=0;x<sp.s;x++){
            const px=sp.x+x, py=sp.y+y; if(px<0||py<0||px>=W||py>=H) continue;
            const i=(py*W+px)*4; r+=D[i]; g+=D[i+1]; b+=D[i+2]; c++;
          }
          return c?[Math.round(r/c),Math.round(g/c),Math.round(b/c)]:null; };
        // 平坦度守门（治「采样点落在柔边/渐变上→两图 1px 亚像素错位就报大差异」这类误报）：
        // Figma 那边该点必须确实是「平色」，否则说明这不是纯色底区域，判不了，老实标未核。
        const range=(D)=>{ let mn=[255,255,255], mx=[0,0,0], c=0;
          for(let y=0;y<sp.s;y++) for(let x=0;x<sp.s;x++){
            const px=sp.x+x, py=sp.y+y; if(px<0||py<0||px>=W||py>=H) continue;
            const i=(py*W+px)*4; for(let k=0;k<3;k++){ if(D[i+k]<mn[k])mn[k]=D[i+k]; if(D[i+k]>mx[k])mx[k]=D[i+k]; } c++;
          }
          return c?Math.max(mx[0]-mn[0],mx[1]-mn[1],mx[2]-mn[2]):999; };
        const fm=mean(fD), mm=mean(mD);
        if(!fm||!mm){ solid.push({id:sp.id,name:sp.name,nosample:'净区落在块外'}); continue; }
        if(range(fD)>8){ solid.push({id:sp.id,name:sp.name,nosample:'Figma 同位置不是平色（被别的元素/柔边盖住）·判不了'}); continue; }
        const dev=Math.max(Math.abs(fm[0]-mm[0]),Math.abs(fm[1]-mm[1]),Math.abs(fm[2]-mm[2]));
        const cast=Math.abs((Math.max(...mm)-Math.min(...mm))-(Math.max(...fm)-Math.min(...fm)));
        solid.push({id:sp.id,name:sp.name,fig:fm,mine:mm,dev,cast});
      }
      // 整块热力图（放大差异）
      const dc=document.createElement('canvas'); dc.width=W; dc.height=H; const dx=dc.getContext('2d'); const di=dx.createImageData(W,H);
      for(let i=0;i<fD.length;i+=4){ const d=(Math.abs(fD[i]-mD[i])+Math.abs(fD[i+1]-mD[i+1])+Math.abs(fD[i+2]-mD[i+2]))/3; const v=Math.min(255,d*3); di.data[i]=v; di.data[i+1]=0; di.data[i+2]=0; di.data[i+3]=Math.min(255,d*3+40); }
      dx.putImageData(di,0,0);
      // 并排：figma | mine | heat
      const sc=document.createElement('canvas'); sc.width=W; sc.height=H*3+20; const sx=sc.getContext('2d');
      sx.fillStyle='#fff'; sx.fillRect(0,0,sc.width,sc.height);
      sx.drawImage(fi,0,0,W,H); sx.drawImage(mi,0,H+10,W,H); sx.drawImage(dc,0,(H+10)*2,W,H);
      // 单独再落一份 figma.png / mine.png（2026-07-28 加）：诊断时几乎总要「拿某块区域逐像素量一量」，
      // 而以前只落 sidebyside 三联图 → 只能自己从并排图里按 y 偏移抠。抠出来的中间产物**会跨轮串味**：
      // 那次拿上一轮的旧抠图量出 28.88（真值 14.05），据此推错一整轮。这两张已归一到块尺寸(W×H)，
      // 跟 manifest 的 bx/by/w/h 同坐标系 → 直接 crop((bx,by,bx+w,by+h)) 就能比，不用再算偏移。
      const mc=document.createElement('canvas'); mc.width=W; mc.height=H; mc.getContext('2d').drawImage(mi,0,0,W,H);
      const fc=document.createElement('canvas'); fc.width=W; fc.height=H; fc.getContext('2d').drawImage(fi,0,0,W,H);
      return { per, solid, ink, inkSkip, imgcmp, maskedPx, maskWhy, heat:dc.toDataURL('image/png'), side:sc.toDataURL('image/png'),
               mine:mc.toDataURL('image/png'), figma:fc.toDataURL('image/png') };
    }, figmaB64, mineB64, ROOTW, ROOTH, visNodes.map(n=>({id:n.id,name:n.name,type:n.type,bx:n.bx,by:n.by,w:n.w,h:n.h,__g:isGraphic(n),__img:isImageNode(n)})), solidSpots, ROOTRAD);

    fs.mkdirSync(OUT,{recursive:true});
    const saveDataUrl=(du,f)=>{ fs.writeFileSync(path.join(OUT,f), Buffer.from(du.split(',')[1],'base64')); };
    saveDataUrl(res.side, 'sidebyside.png'); saveDataUrl(res.heat, 'heatmap.png');
    if(res.mine) saveDataUrl(res.mine, 'mine.png');
    if(res.figma) saveDataUrl(res.figma, 'figma.png');

    const fails = res.per.filter(r=> r.graphic ? r.diff>GTHRESH : r.diff>TTHRESH).sort((a,b)=>b.diff-a.diff);
    const worst = res.per.slice().sort((a,b)=>b.diff-a.diff).slice(0,8);
    const SOLID_TOL=parseFloat(arg('solid-tol','5')), CAST_TOL=parseFloat(arg('solid-cast-tol','4'));
    const solidAll=res.solid||[];
    const solidBad=solidAll.filter(x=>!x.nosample && (x.dev>SOLID_TOL || x.cast>CAST_TOL));
    const solidNo=solidAll.filter(x=>x.nosample);
    const INK_TOL=parseFloat(arg('ink-tol','0.25'));   // ±25%：抗锯齿差异 ~5%·差一档字重 ~60%·中间留足余量
    const inkAll=res.ink||[];
    const inkBad=arg('skip-textink')?[]:inkAll.filter(x=>Math.abs(x.ratio-1)>INK_TOL);
      const IMG_TOL=parseFloat(arg('img-tol','12'));   // 0-255·见下方标定
    const imgAll=res.imgcmp||[];
    const imgBad=arg('skip-imgcmp')?[]:imgAll.filter(x=>x.max>IMG_TOL);
    out={ root:ROOT, maskedPx:res.maskedPx||0, maskWhy:res.maskWhy||'', rootRad:ROOTRAD, inkSkip:res.inkSkip||[], checked:res.per.length, skipped, fails, worst, solidChecked:solidAll.length-solidNo.length, solidBad:(arg('skip-solidfill')?[]:solidBad), solidNo, inkChecked:inkAll.length, inkBad, imgChecked:imgAll.length, imgBad, imgWorst:imgAll.slice().sort((a,b)=>b.max-a.max)[0] };
  }catch(e){ out={error:e.message}; }
  await b.disconnect();

  console.log('\n视觉比对 · 块 '+ROOT+'  元素='+(out.checked||0)+(out.skipped?'  (hover/隐藏跳过像素 '+out.skipped+'·几何仍由 geom-check 核)':'')+'  图形阈值 '+GTHRESH+' / 文字阈值 '+TTHRESH);
  console.log('  并排图: '+path.join(OUT,'sidebyside.png')+'  热力图: '+path.join(OUT,'heatmap.png'));
  console.log('  单张(要逐像素量某块时用这两张·跟 manifest 的 bx/by/w/h 同坐标系·别从并排图里抠): '
    +path.join(OUT,'figma.png')+' / '+path.join(OUT,'mine.png'));
  if(out.error){ console.log('ERR '+out.error); process.exit(2); }
  // 0 元素可比 = 假绿漏洞（2026-07-22 根治·治「manifest 只有 cx/cy 没 bx/by → 一个都没比却报全绿」）：必须报错不放行。
  if((out.checked||0)===0){ console.log('\n❌ ERR 一个元素都没比对到（多半 manifest 缺 bx/by·visual-verify 靠 bx/by 裁剪）——这不是"全绿"，是没跑成。补 bx/by(figma-restore-dump 已带)再跑。'); process.exit(2); }
  if(out.rootRad>0){
    if(out.maskedPx) console.log('  块根圆角 '+out.rootRad+'px → 已把圆角外约 '+out.maskedPx+'px 排除出比对'
      +'（那部分不属于设计稿：Figma 侧常被烤进画布底色、我这侧是页面底色）·**圆角半径这一维改由 geom 的 rad 硬核**');
    else if(out.maskWhy) console.log('  ⚠️ 圆角外没能排除 —— '+out.maskWhy);
  }
  if(out.worst&&out.worst.length){ console.log('\n差异最大的元素(diff 0-1)：'); out.worst.forEach(r=>console.log('   '+(r.graphic?'▩':'·')+' '+r.diff.toFixed(3)+'  '+r.id+' 「'+r.name+'」'+r.type)); }
  if(out.solidChecked!=null) console.log('  纯色底净区实渲比对：核了 '+out.solidChecked+' 块'+((out.solidNo&&out.solidNo.length)?('·'+out.solidNo.length+' 块取不到净区未核'):''));
  if(out.solidNo&&out.solidNo.length) out.solidNo.forEach(x=>console.log('     ○ '+x.id+' 「'+x.name+'」未核 —— '+x.nosample));
  if(out.solidBad&&out.solidBad.length){
    console.log('\n🪣 '+out.solidBad.length+' 块纯色底跟 Figma 渲染不一致（多半是半透明层压在它上面把底色洗了·整块 diff 抓不到这种）：');
    out.solidBad.forEach(x=>console.log('   ❌ '+x.id+' 「'+x.name+'」Figma rgb('+x.fig.join(',')+') → 我的 rgb('+x.mine.join(',')+')  最大偏差'+x.dev+(x.cast>4?('·三通道落差多了'+x.cast+'=有彩色层压在上面'):'')));
    console.log('   🔴 头号根因：CSS 绘制顺序里 position:absolute 恒在普通流内容之上，跟 DOM 先后无关——把光团/蒙层挪到 DOM 最前面只压得住同为 absolute 的兄弟，压不住普通流的文案/按钮。正解：容器 isolation:isolate + 该层 z-index:-1。其它：底色没写 / 父级 opacity 拖累 / 图层序反。确属预期可加 --skip-solidfill。');
    console.log('\n结果：视觉比对不通过 ❌（纯色底被洗色）');
    process.exit(1);
  }
  if(out.inkChecked) console.log('  文字墨水量比对：核了 '+out.inkChecked+' 处文字（抓字重/字号错·像素软判抓不到）'
    +((out.inkSkip&&out.inkSkip.length)?('·跳过 '+out.inkSkip.length+' 处空框(墨水密度<2/px·多半被别的层完全盖住·比值是噪声)'):''));
  // 不静默截断：跳过了哪几处要点名，否则「核了 20 处」读起来像全覆盖（见 skill「No silent caps」）
  if(out.inkSkip&&out.inkSkip.length) out.inkSkip.forEach(x=>console.log('     ○ '+x.id+' 「'+x.name+'」跳过·墨水密度 '+x.dens+'/px'));
  if(out.inkBad&&out.inkBad.length){
    console.log('\n🖋 '+out.inkBad.length+' 处文字的墨水量跟 Figma 对不上（1.00=一致·>1 偏粗/偏大·<1 偏细/缺字）：');
    out.inkBad.forEach(x=>console.log('   ❌ '+x.id+' 「'+x.name+'」墨水比 '+x.ratio.toFixed(2)));
    console.log('   🔴 头号根因：**系统字体的字重匹配不可信**。实测 macOS 上装了 Roboto 静态字重全家桶时，');
    console.log('      Chrome 里 font-weight 400/500/700/900 会匹配到同一张粗体脸（量出的字符宽度几乎相同），');
    console.log('      于是 CSS 写 400、渲染出来是 700。正解：用 @font-face 把每个字重锁死到具体字体文件并内联，');
    console.log('      别靠 font-family 让系统去挑（顺带让单文件 demo 不依赖收方机器装没装该字体）。');
    console.log('      其次：macOS Chrome 的 stem darkening 会让字普遍偏粗 ~7-18% → body 加 -webkit-font-smoothing:antialiased；');
    console.log('      再次：字号/行高抄错、文字缺失/被截断。确属预期可加 --skip-textink 或调 --ink-tol。');
    console.log('\n结果：视觉比对不通过 ❌（文字墨水量不符）');
    process.exit(1);
  }
  if(out.imgChecked) console.log('  图片内容比对：核了 '+out.imgChecked+' 张图（4×4 分格取最差格·抓「换错图/图放错位置」·整框求平均抓不到）'
    + (out.imgWorst?('·最大格差 '+out.imgWorst.max):''));
  if(out.imgBad&&out.imgBad.length){
    console.log('\n🖼 '+out.imgBad.length+' 张图跟 Figma 装的不是同一张（4×4 分格·数字=最差那格的均色距离 0-255）：');
    out.imgBad.forEach(x=>console.log('   ❌ '+x.id+' 「'+x.name+'」最差格差 '+x.max+'（第 '+x.cell+' 格）'));
    // 🔴 2026-07-30 改：这条提示语把两个独立执行者都推错了方向。
    //    它一上来就断言「你挑错图了」，而实测**同样的红**可以由「参照底片本身脏了」造成
    //    （Figma 把画布底色烤进圆角外 → 落进某一格 → 报 24.4），此时怎么换图都不对。
    //    而且这道判据早已扩到所有图形节点，报红的可能压根不是图（上次红的是个 ELLIPSE 光团）。
    //    所以先给「怀疑参照物」，再给「怀疑素材」。
    console.log('   ⓪ 先怀疑参照物，别急着换图（同一个红有两种成因，换错方向会反复返工）：');
    console.log('      · 底片圆角外/边界外被烤进画布底色 → 跑 figma-render-probe.py crop 会点名；');
    console.log('        本门已自动把块根圆角外排除，但**其它形状的设计边界之外仍可能脏**。');
    console.log('      · 报红元素的盒子大幅跨出画板（如 360×320 的光团只有 1/4 在 714×300 内）= 强信号。');
    console.log('      · 底片是不是上一轮的旧图 / 出血没裁干净 / JPEG 块噪声。');
    console.log('      · 判断方法见 memory-refs/feedback-verify-instrument-before-trusting-numbers.md（先验仪器再信数字）。');
    console.log('   ① 排除参照物之后，才怀疑素材：**download_assets 一个节点常返回多张 rawImages（同图不同画质／甚至不同图），挑错了**。');
    console.log('      产品图大半是白底，挑错图整框求平均只有 0.1 出头，像素门放行 —— 只有分格比抓得到。');
    console.log('      正解：每个图位对**该图位的叶子节点**单独 download_assets，按返回顺序一一落地，别凭小样眼选；');
    console.log('      🥇 一排同尺寸同色系的图（asset-claim 会给出一样的分、分不开）→ 用底片配位，别猜：');
    console.log('         python3 restore-coverage/figma-render-probe.py asset-match --figma <底片> --manifest <m> --dir <素材目录>');
    console.log('      多候选时取文件更大的那张（通常是高画质版），落地后靠这道门验。');
    console.log('      确属预期（如 Figma 里就是占位图）可加 --skip-imgcmp 或调 --img-tol。');
    console.log('\n结果：视觉比对不通过 ❌（图片内容不符）');
    process.exit(1);
  }
  if(out.fails.length){
    console.log('\n❌ '+out.fails.length+' 个元素像素差异超阈值（图形▩=硬判/文字·=软判·多半是用错字形/位置错/缺失）：');
    out.fails.forEach(r=>console.log('   '+(r.graphic?'▩':'·')+' diff='+r.diff.toFixed(3)+'  '+r.id+' 「'+r.name+'」'+r.type));
    console.log('\n结果：视觉比对不通过 ❌（看 sidebyside.png 逐个核·改到超阈值元素清零）');
    process.exit(1);
  }
  // 通过 → 盖戳
  // sid（2026-07-26）：记下哪个会话跑绿的——Stop 门只认自己会话的 pass，防并发会话互相盖章。
  try{ const sd=os.homedir()+'/.online-reach-state'; fs.mkdirSync(sd,{recursive:true}); fs.writeFileSync(sd+'/restore-visual.pass', JSON.stringify({t:Date.now(),root:ROOT,sid:process.env.CLAUDE_CODE_SESSION_ID||''})); }catch(e){}
  console.log('\n结果：视觉比对全绿 ✅ 每个元素像素跟 Figma 一致（已盖 restore-visual.pass）');
  process.exit(0);
})();
