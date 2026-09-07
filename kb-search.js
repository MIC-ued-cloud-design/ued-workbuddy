/**
 * WorkBuddy 检索逻辑 · 单一维护源
 *
 * 同一份代码跑在两个地方：
 *   kb-worker.js 里 importScripts 它（线上走这条，主线程完全不碰 7.2MB 语料）
 *   主线程直接 <script src> 引它（file:// 本地打开时 Worker 建不起来，走这条兜底）
 *
 * 所以这里不能碰 window / document —— 只用入参和纯计算。
 * 判据与踩过的坑见 memory 的 reference-static-page-free-llm-rag。
 */
(function (root) {
  'use strict';

/* 中文虚词字。全部由虚词组成的滑窗（「能用多少」「是什么」）稀有但没有意思，
   不过滤掉的话会把无关文档捞上来——实测「飞鹊正文字号最大能用多少」曾命中「红包组合」。 */
var STOPCH = {};
'的了是在有和就都而及与或一个什么怎么哪些多少最大最小可以需要能不能是不是我你他她它们这那些么呢吧啊把被给让对从向到于为以及其此该等再又还只也很太更如果因为所以但然后先前后上下里外中间时候样子事情东西地方问题办法开始结束现在已经正要会想做用去来看说讲写读点条份个次种类些边�`'
  .split('').forEach(function(c){ STOPCH[c]=1; });
function allStop(g){
  for(var i=0;i<g.length;i++) if(!STOPCH[g[i]]) return false;
  return true;
}

function terms(q){
  var map={}, str=String(q||'').toLowerCase();
  (str.match(/[a-z0-9][a-z0-9_\-\.\/]{1,}/g)||[]).forEach(function(w){
    if(w.length>=2) map[w]=Math.min(w.length+1,6);   // 英文词一般是专名，比同长中文更可信
  });
  str.replace(/[^一-龥]+/g,' ').split(/\s+/).forEach(function(seg){
    if(!seg) return;
    if(seg.length===1){ map[seg]=1; return; }
    for(var L=2;L<=3;L++)          // 只切 2/3 字：4 字窗几乎全是跨虚词的噪音
      for(var i=0;i+L<=seg.length;i++){
        var g=seg.slice(i,i+L);
        if(allStop(g)) continue;
        if(!map[g] || map[g]<L) map[g]=L;
      }
  });
  var ks=Object.keys(map);
  ks.sort(function(a,b){ return map[b]-map[a]; });      // 长词优先，被截断也先留长的
  return ks.slice(0,140).map(function(t){ return {t:t, L:map[t]}; });
}

var LC=null;   // 小写正文缓存，只算一次
function lcOf(kb){
  if(LC) return LC;
  LC=kb.c.map(function(c){ return [c.x.toLowerCase(), ((c.t||'')+' '+(c.d||'')).toLowerCase()]; });
  return LC;
}

function retrieve(q, budget){
  var kb=window.WBKB; if(!kb) return [];
  var TS=terms(q); if(!TS.length) return [];

  /* 先查实体字典：组件真名、中文常叫法、token 小节名这些有唯一答案的，
     直接把对应的块钉在最前面，不参与模糊打分。 */
  var pinned=[], pinSet={};
  if(kb.dict){
    var ql=String(q||'').toLowerCase();
    var keys=Object.keys(kb.dict);
    keys.sort(function(a,b){ return b.length-a.length; });   // 长词优先，「输入框」赢过「输入」
    for(var pk=0; pk<keys.length && pinned.length<6; pk++){
      if(ql.indexOf(keys[pk])<0) continue;
      kb.dict[keys[pk]].forEach(function(ix){
        if(!pinSet[ix] && pinned.length<6 && kb.c[ix]){ pinSet[ix]=1; pinned.push(kb.c[ix]); }
      });
    }
  }
  var C=kb.c, N=C.length, lc=lcOf(kb);

  // 一遍扫完：同时拿到每个词的 df 和每块命中了哪些词
  var df=new Array(TS.length).fill(0), hits=new Array(N);
  for(var i=0;i<N;i++){
    var body=lc[i][0], head=lc[i][1], rec=null;
    for(var j=0;j<TS.length;j++){
      var t=TS[j].t;
      var inB=body.indexOf(t)>=0, inH=head.indexOf(t)>=0;
      if(!inB && !inH) continue;
      df[j]++;
      var tf=0;
      if(inB){ var p=body.indexOf(t); while(p>=0 && tf<3){ tf++; p=body.indexOf(t,p+t.length); } }
      (rec||(rec=[])).push([j, tf, inH?1:0]);
    }
    hits[i]=rec;
  }

  // 出现在超过 12% 的块里的词当停用词处理，权重归零
  var STOP=N*0.12, RARE=N*0.02;
  var w=[], rareIdx=[];
  for(j=0;j<TS.length;j++){
    if(!df[j] || df[j]>STOP){ w[j]=0; continue; }
    w[j] = Math.pow(TS[j].L, 1.6) * Math.log(N/(1+df[j]));
    if(df[j]<=RARE) rareIdx.push(j);
  }
  var needRare = Math.min(2, rareIdx.length);
  if(!rareIdx.length) return out_pinnedOnly(pinned);   // 没有稀有词，只靠字典

  var scored=[];
  for(i=0;i<N;i++){
    var r=hits[i]; if(!r) continue;
    var sc=0, distinct=0, rareHit=0;
    for(var k=0;k<r.length;k++){
      var idx=r[k][0]; if(!w[idx]) continue;
      sc += w[idx] * (1 + 0.4*Math.min(r[k][1],3)) + w[idx]*r[k][2]*4;
      distinct++;
      if(rareIdx.indexOf(idx)>=0) rareHit++;
    }
    if(!sc || rareHit<needRare) continue;              // 相关性下限
    sc *= Math.sqrt(distinct);                          // 覆盖到的不同词越多越可信
    /* 不做长度归一化：试过 BM25 那套（除以块长），结果长块的偏置换成了短块的偏置，
       「字号」「按钮」两题都变差。长块的问题改由「实体字典钉住正确块」来治。 */
    scored.push([sc, i]);
  }
  if(!scored.length) return out_pinnedOnly(pinned);
  scored.sort(function(a,b){ return b[0]-a[0]; });

  // 去重：同一份文档同一节只取一次，同一份文档最多 3 段
  var seen={}, perDoc={}, out=[], used=0;
  budget=budget||11000;
  pinned.forEach(function(c){
    var sig=c.d+'|'+(c.t||'');
    if(seen[sig]) return;
    seen[sig]=1; perDoc[c.d]=(perDoc[c.d]||0)+1;
    var x = c.x.length>2600? {d:c.d,t:c.t,s:c.s,x:c.x.slice(0,2600)+'\n…（这一段更长，只取了前面部分）'} : c;
    out.push(x); used += Math.min(c.x.length,2600);
  });
  var CAP=2600;              // 单块进上下文的上限，长表格取前半段就够定位
  for(k=0;k<scored.length;k++){
    if(out.length>=14) break;
    var c=C[scored[k][1]], sig=c.d+'|'+(c.t||'');
    if(seen[sig]) continue;
    if((perDoc[c.d]||0)>=3) continue;
    var take=Math.min(c.x.length, CAP);
    if(used+take>budget && out.length>=4) continue;   // 装不下就跳过，别撑爆上下文
    seen[sig]=1; perDoc[c.d]=(perDoc[c.d]||0)+1;
    out.push(take<c.x.length? {d:c.d,t:c.t,s:c.s,x:c.x.slice(0,CAP)+'\n…（这一段更长，只取了前面部分）'} : c);
    used+=take;
    if(used>=budget) break;
  }
  return out;
}
function out_pinnedOnly(pinned){
  return pinned.slice(0,6).map(function(c){
    return c.x.length>2600? {d:c.d,t:c.t,s:c.s,x:c.x.slice(0,2600)+'\n…（这一段更长，只取了前面部分）'} : c; });
}
  root.WBSearch = { terms: terms, retrieve: retrieve };
})(typeof self !== 'undefined' ? self : this);
