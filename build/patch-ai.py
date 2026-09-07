#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把「真接模型 + 真检索知识库」注入 index.html（可重复运行）。"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = os.path.join(os.path.dirname(HERE), 'index.html')
CSS_B, CSS_E = '/* ==WB-AI-CSS:BEGIN== */', '/* ==WB-AI-CSS:END== */'
JS_B,  JS_E  = '/* ==WB-AI-JS:BEGIN== */',  '/* ==WB-AI-JS:END== */'

CSS = r'''
/* ── 跑任务：回答区 ── */
.runwrap{max-width:824px;margin:0 auto;padding:34px 0 60px}
.qbox{display:flex;gap:12px;align-items:flex-start;margin:0 0 22px}
.qava{width:26px;height:26px;flex:none;border-radius:999px;background:var(--accent);color:#fff;display:grid;place-items:center;font-size:12px;font-weight:700}
.qtx{flex:1;font-size:15px;color:var(--ink);line-height:1.75;white-space:pre-wrap;word-break:break-word;padding-top:2px}
.abox{border-top:1px solid var(--line);padding:22px 0 0}
.ahead{display:flex;align-items:center;gap:9px;margin:0 0 14px}
.ahead b{font-size:13px;color:var(--ink)}
.ahead span{font-size:12px;color:var(--ink-3)}
.atx{font-size:15px;color:var(--ink);line-height:1.85;word-break:break-word}
.atx h3{font-size:15px;margin:22px 0 8px;color:var(--ink)}
.atx p{margin:0 0 12px}
.atx ul,.atx ol{margin:0 0 12px;padding-left:22px}
.atx li{margin:0 0 5px}
.atx table{width:100%;border-collapse:collapse;margin:0 0 16px;font-size:13px}
.atx th{background:var(--dark);color:#fff;font-weight:700;text-align:left;padding:10px 12px;font-size:12px}
.atx td{border-bottom:1px solid var(--line);padding:10px 12px;color:var(--ink);vertical-align:top;line-height:1.7}
.atx tr:first-child td:first-child,.atx td.c1{background:#F0F1F2}
.atx code{background:var(--soft);padding:2px 6px;border-radius:4px;font-size:13px}
.atx b{font-weight:700}
.caret{display:inline-block;width:7px;height:15px;background:var(--accent);vertical-align:-2px;animation:cb 1s steps(2) infinite}
@keyframes cb{0%,50%{opacity:1}51%,100%{opacity:0}}
.srcs{margin:22px 0 0;padding:14px 0 0;border-top:1px solid var(--line-2)}
.srcs-h{font-size:12px;color:var(--ink-3);margin:0 0 9px}
.srcs-l{display:flex;flex-wrap:wrap;gap:6px}
.srcchip{font-size:12px;color:var(--ink-2);background:var(--soft);border:0;border-radius:999px;padding:6px 12px;cursor:pointer;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.srcchip:hover{background:var(--accent-fill);color:var(--accent-ink)}
.runfoot{margin:30px 0 0;display:flex;gap:9px;flex-wrap:wrap}
.rbtn{font:13px/1 inherit;color:var(--ink);background:var(--white);border:1px solid var(--line);border-radius:8px;padding:10px 16px;cursor:pointer}
.rbtn:hover{border-color:var(--accent-line);background:var(--accent-fill);color:var(--accent-ink)}
.rbtn.pri{background:var(--dark);color:#fff;border-color:var(--dark)}
.rbtn.pri:hover{background:#000;color:#fff}

/* 提示条 / 报错 */
.nbox{border:1px solid var(--line);border-radius:10px;padding:17px 19px;margin:0 0 20px;background:var(--white)}
.nbox b{display:block;font-size:13px;color:var(--ink);margin:0 0 6px}
.nbox p{font-size:13px;color:var(--ink-2);line-height:1.8;margin:0 0 10px}
.nbox p:last-child{margin:0}
.nbox.warn{background:var(--soft)}
.nbox ol{margin:6px 0 10px;padding-left:20px;font-size:13px;color:var(--ink-2);line-height:1.9}

/* 设置弹层 */
#wbmask{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:80;display:grid;place-items:center;padding:24px}
.wbdlg{background:var(--white);border-radius:16px;width:100%;max-width:520px;max-height:88vh;overflow:auto;padding:26px 28px}
.wbdlg h3{font-size:16px;color:var(--ink);margin:0 0 8px}
.wbdlg .sub{font-size:13px;color:var(--ink-2);line-height:1.8;margin:0 0 20px}
.fld{margin:0 0 16px}
.fld label{display:block;font-size:13px;font-weight:700;color:var(--ink);margin:0 0 7px}
.fld .hint{font-size:12px;color:var(--ink-3);line-height:1.7;margin:6px 0 0}
.fld input,.fld select{width:100%;box-sizing:border-box;font:13px/1 inherit;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:0 12px;height:38px;background:var(--white);outline:0}
.fld input:focus,.fld select:focus{border-color:var(--accent)}
.dfoot{display:flex;gap:9px;justify-content:flex-end;margin:22px 0 0;align-items:center}
.dfoot .msg{flex:1;font-size:12px;color:var(--ink-2);line-height:1.6}
.prov{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.provb{text-align:left;background:var(--white);border:1px solid var(--line);border-radius:10px;padding:11px 13px;cursor:pointer}
.provb.on{border-color:var(--accent);background:var(--accent-fill)}
.provb b{display:block;font-size:13px;color:var(--ink);font-weight:700;margin:0 0 3px}
.provb span{display:block;font-size:12px;color:var(--ink-3);line-height:1.5}
'''

JS = r'''
/* ══════════ 真接模型 + 真检索知识库 ══════════ */
(function(){
  var LS='wb.ai.cfg';

  /* 都是 OpenAI 兼容接口。免费与否已实测标注，别改成猜的 */
  var PROV = {
    zhipu:  {n:'智谱 GLM-4-Flash', tip:'官方标免费 · 国内直连',
             u:'https://open.bigmodel.cn/api/paas/v4/chat/completions', m:'glm-4-flash',
             get:'open.bigmodel.cn 注册后在「API 密钥」页新建'},
    silicon:{n:'硅基流动', tip:'部分小模型免费 · 国内直连',
             u:'https://api.siliconflow.cn/v1/chat/completions', m:'Qwen/Qwen2.5-7B-Instruct',
             get:'cloud.siliconflow.cn 注册后在「API 密钥」页新建'},
    deepseek:{n:'DeepSeek', tip:'按量付费，很便宜 · 国内直连',
             u:'https://api.deepseek.com/chat/completions', m:'deepseek-chat',
             get:'platform.deepseek.com 注册后在「API keys」页新建'},
    custom: {n:'自己填', tip:'任何 OpenAI 兼容接口', u:'', m:'', get:''}
  };

  function cfg(){
    try{ var o=JSON.parse(localStorage.getItem(LS)||'{}'); return o&&typeof o==='object'?o:{}; }
    catch(e){ return {}; }
  }
  function saveCfg(o){ try{ localStorage.setItem(LS, JSON.stringify(o)); }catch(e){} }
  function ready(){ var c=cfg(); return !!(c.key && (PROV[c.prov]||{}).u || (c.key&&c.url)); }
  function endpoint(){ var c=cfg(); return c.url || (PROV[c.prov]||{}).u || ''; }
  function modelName(){ var c=cfg(); return c.model || (PROV[c.prov]||{}).m || ''; }
  window.wbReady = ready;

  /* ── 知识库懒加载（script 标签，不是 fetch —— file:// 下 fetch 会被 CORS 拦） ── */
  var kbP=null;
  function loadKB(){
    if(window.WBKB) return Promise.resolve(window.WBKB);
    if(kbP) return kbP;
    kbP=new Promise(function(res,rej){
      var el=document.createElement('script');
      el.src='kb.js';
      el.onload=function(){ window.WBKB? res(window.WBKB) : rej(new Error('kb.js 载入了但没有数据')); };
      el.onerror=function(){ rej(new Error('kb.js 载不到')); };
      document.head.appendChild(el);
    });
    return kbP;
  }
  window.wbLoadKB = loadKB;

  /* ── 检索 ──
     中文没有空格，所以切 2/3/4 字的滑窗当检索词。长的词更能区分意思
     （「痛点」「退款流程」有信息量，「是什」「大的」没有），所以按长度加权。
     再按词的稀有程度加权，并要求命中至少两个稀有词——否则「今天天气怎么样」
     这种问题会靠噪音词捞回一万字无关资料，反过来诱导模型编答案。 */
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
  window.wbRetrieve = retrieve;

  /* ── system prompt：这里是「结合 fullstack skill 的能力」的落地处 ── */
  var SYS = [
    '你是 MIC（Made-in-China.com）UED 部门的设计助手。用户是做交互和视觉的设计师。',
    '你的知识只来自下面「参考资料」——那是 MIC 的业务文档和 UED 团队沉淀的设计方法。',
    '',
    '回答规则：',
    '1. 只用参考资料里的内容回答。资料里没有的就直说「资料里没有这一条」，不要推测，不要用通用互联网知识补。',
    '2. 说人话。不用技术腔：零历史 / 无数据 / 行为信号 / 冷启动 / 埋点 / 漏斗 / 闭环 / 链路 / 召回 / 结构化 这类词一律换成大白话。',
    '3. 不自造缩写。主体点名，别用「它」「这个」「该功能」指代。',
    '4. 专业、精炼、看得懂三条同时成立：名词用需求文档里的正式名，一句话只说一件事，词保持完整形态不缩写。',
    '5. 用到哪份资料，就在那句话末尾用括号标出文档名。',
    '',
    '写 GSSM 设计目标表时：五列固定是 业务目标 / 设计目标 / 设计策略 / 信号 / 指标。',
    'G 指的是设计目标，不是业务目标，业务目标是这张表的输入。每格不超过 35 字，设计策略不超过 50 字，指标写 2 到 3 个。',
    '写完要提醒一句：定完指标的下一个动作不是画稿，是先确认旧版数据现在取不取得到——上线之后补不回来。',
    '',
    '列状态与极限值清单时，按这七类逐项过：空态（无数据 / 无权限）；满态（最少 / 1 项 / 几项 / 几十项 / 极多）；',
    '极限文本（超长标题 / 超长价格 / 超长地址）；加载中、报错、禁用、断网；状态之间的衔接；',
    '跨端差异（手机应用 / 触屏网页 / 电脑小窗 / 电脑大窗）；业务异常（产品失效 / 库存为零 / 价格变更 / 账号过期）。',
    '',
    '遇到取舍，按这个顺序判断：用户做这件事是否真的更顺 > 能不能观察到用户行为 > 指标能不能量化 > 是否对齐线上视觉 > 结构是否清爽 > 是否符合既有规范。',
    '',
    '你做不到的事要直接说明，不要假装做了：你不能写入 Figma、不能运行脚本、不能打开线上页面、不能导出文件。',
    '这些要设计师在 Claude Code 里用 mic-fullstack 技能做，这个页面只帮忙想清楚和写出来。'
  ].join('\n');

  function ctxOf(chunks){
    if(!chunks.length) return '（这次没检索到相关资料。请如实告诉用户资料库里没有这一条，不要凭常识回答。）';
    return chunks.map(function(c,i){
      return '【资料 '+(i+1)+'｜'+c.d+(c.t? ' › '+c.t : '')+'】\n'+c.x;
    }).join('\n\n');
  }

  /* ── 调模型（流式） ── */
  function callModel(q, chunks, onDelta, signal){
    var c=cfg(), url=endpoint(), mdl=modelName();
    var body={ model:mdl, stream:true, temperature:0.3,
      messages:[ {role:'system', content:SYS},
                 {role:'user', content:'参考资料：\n\n'+ctxOf(chunks)+'\n\n──────────\n\n我的问题：'+q} ] };
    return fetch(url,{ method:'POST', signal:signal,
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+c.key},
        body:JSON.stringify(body) })
      .then(function(res){
        if(!res.ok){
          return res.text().then(function(t){
            var e=new Error(t||''); e.status=res.status; throw e; });
        }
        var reader=res.body.getReader(), dec=new TextDecoder(), buf='', full='';
        function pump(){
          return reader.read().then(function(r){
            if(r.done){ return full; }
            buf += dec.decode(r.value,{stream:true});
            var lines=buf.split('\n'); buf=lines.pop();
            lines.forEach(function(ln){
              ln=ln.trim();
              if(!ln || ln.indexOf('data:')!==0) return;
              var d=ln.slice(5).trim();
              if(d==='[DONE]') return;
              try{
                var o=JSON.parse(d);
                var t=((o.choices||[{}])[0].delta||{}).content;
                if(t){ full+=t; onDelta(full); }
              }catch(e){}
            });
            return pump();
          });
        }
        return pump();
      });
  }

  function errText(e){
    var s=e&&e.status;
    if(s===401||s===403) return ['密钥没通过', '这个密钥被拒了。检查是不是复制时少了字符，或者这个密钥属于另一个平台。'];
    if(s===429)          return ['被限流了', '免费额度用完，或者短时间请求太多。等一会儿再试，或者换一个平台。'];
    if(s===400)          return ['模型名不对', '这个平台上没有当前填的模型名。到设置里换一个，或者填平台文档里写的名字。'];
    if(s===404)          return ['接口地址不对', '设置里的接口地址在这个平台上不存在。'];
    if(s>=500)           return ['平台那边出错了', '不是你的问题，稍后再试。'];
    if(e&&e.name==='AbortError') return ['已停止', '这次回答被你中断了。'];
    return ['请求发不出去', '请求没能送到平台。最常见的原因是公司网络挡了这个域名——'
            + '智谱、硅基流动、DeepSeek 都是国内服务，一般直连可达，但公司代理可能有自己的名单。'
            + '换手机热点试一次就能分清是网络策略还是别的问题。'];
  }

  /* ── 跑任务视图 ── */
  var R = { q:'', ans:'', srcs:[], state:'idle', err:null, ctl:null, task:'' };
  window.WBRUN = R;

  function mdToHtml(t){
    var esc=function(x){ return x.replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c];}); };
    var lines=esc(t).split('\n'), out=[], i=0;
    while(i<lines.length){
      var ln=lines[i];
      if(/^\s*\|/.test(ln)){
        var rows=[];
        while(i<lines.length && /^\s*\|/.test(lines[i])){
          var cells=lines[i].trim().replace(/^\||\|$/g,'').split('|').map(function(x){return x.trim();});
          if(!cells.every(function(c){ return /^:?-{2,}:?$/.test(c)||c===''; })) rows.push(cells);
          i++;
        }
        if(rows.length){
          out.push('<table><thead><tr>'+rows[0].map(function(c){return '<th>'+inline(c)+'</th>';}).join('')+'</tr></thead><tbody>'
            + rows.slice(1).map(function(r){ return '<tr>'+r.map(function(c,ci){return '<td'+(ci===0?' class="c1"':'')+'>'+inline(c)+'</td>';}).join('')+'</tr>'; }).join('')
            + '</tbody></table>');
        }
        continue;
      }
      var h=ln.match(/^#{1,6}\s*(.+)$/);
      if(h){ out.push('<h3>'+inline(h[1])+'</h3>'); i++; continue; }
      if(/^\s*[-*]\s+/.test(ln)||/^\s*\d+[.)]\s+/.test(ln)){
        var ord=/^\s*\d/.test(ln), items=[];
        while(i<lines.length && (/^\s*[-*]\s+/.test(lines[i])||/^\s*\d+[.)]\s+/.test(lines[i]))){
          items.push('<li>'+inline(lines[i].replace(/^\s*(?:[-*]|\d+[.)])\s+/,''))+'</li>'); i++;
        }
        out.push((ord?'<ol>':'<ul>')+items.join('')+(ord?'</ol>':'</ul>')); continue;
      }
      if(!ln.trim()){ i++; continue; }
      var para=[];
      while(i<lines.length && lines[i].trim() && !/^\s*[-*\d|#]/.test(lines[i])){ para.push(lines[i]); i++; }
      out.push('<p>'+inline(para.join(' '))+'</p>');
    }
    function inline(x){
      return x.replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>')
              .replace(/`([^`]+)`/g,'<code>$1</code>');
    }
    return out.join('');
  }

  window.viewRun = function(){
    var st=R.state;
    return '<div class="runwrap">'+
      '<div class="qbox"><span class="qava">王</span><div class="qtx">'+
        String(R.q).replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c];})+'</div></div>'+
      (st==='needkey' ? needKeyBox() :
       st==='error'   ? errBox() :
      '<div class="abox"><div class="ahead">'+
        (window.fqIcon? fqIcon('robot',15)||'' : '')+
        '<b>WorkBuddy</b><span>'+
          (st==='loadkb'?'正在载入知识库…':
           st==='search'?'正在从知识库里找相关资料…':
           st==='run'  ?'正在回答（'+PROVN()+'）':
           R.srcs.length? '参考了 '+R.srcs.length+' 段资料 · '+PROVN() : PROVN())+
        '</span></div>'+
        '<div class="atx">'+(R.ans? mdToHtml(R.ans) : '')+
          (st==='run'||st==='search'||st==='loadkb'? '<span class="caret"></span>':'')+'</div>'+
        (R.srcs.length? '<div class="srcs"><div class="srcs-h">这次回答参考了知识库里这些文档（点一下看它在资料库的哪个位置）</div>'+
          '<div class="srcs-l">'+dedupSrc().map(function(d){
            return '<button class="srcchip" onclick="wbOpenSrc(\''+d.replace(/'/g,"\\'")+'\')">'+d+'</button>'; }).join('')+
          '</div></div>' : '')+
        '<div class="runfoot">'+
          (st==='run'? '<button class="rbtn" onclick="wbStop()">停止</button>'
                     : '<button class="rbtn pri" onclick="go(\'new\')">再问一个</button>'+
                       (R.ans? '<button class="rbtn" onclick="copyTx(WBRUN.ans,\'回答\')">复制回答</button>'+
                               '<button class="rbtn" onclick="wbRetry()">重新回答</button>' : ''))+
        '</div></div>')+
    '</div>';
  };
  function PROVN(){ var c=cfg(); return (PROV[c.prov]||{}).n || c.model || '已配置的模型'; }
  function dedupSrc(){ var o=[],s=R.srcs; s.forEach(function(c){ if(o.indexOf(c.d)<0) o.push(c.d); }); return o; }

  function needKeyBox(){
    return '<div class="nbox"><b>先填一个模型密钥，这个页面才能真的回答你</b>'+
      '<p>WorkBuddy 的知识库已经装在页面里了（'+(window.WBKB? WBKB.docs+' 份文档、'+WBKB.chunks+' 段' : '478 份文档')+
      '），但要有人来读它、组织成答案。这一步用的是你自己的模型密钥，存在你这台电脑的浏览器里，不上传、别人拿不到。</p>'+
      '<ol><li>去 open.bigmodel.cn 注册（智谱，GLM-4-Flash 官方标免费）</li>'+
      '<li>在「API 密钥」页新建一个，复制</li>'+
      '<li>回来点下面的按钮粘进去</li></ol>'+
      '<p><button class="rbtn pri" onclick="wbSettings()">填密钥</button> '+
      '<button class="rbtn" onclick="go(\'libs\')">先只看资料库</button></p></div>';
  }
  function errBox(){
    var e=R.err||['出错了',''];
    return '<div class="nbox warn"><b>'+e[0]+'</b><p>'+e[1]+'</p>'+
      (R.raw? '<p style="color:var(--ink-3);font-size:12px">平台返回：'+String(R.raw).slice(0,220)+'</p>':'')+
      '<p><button class="rbtn pri" onclick="wbRetry()">再试一次</button> '+
      '<button class="rbtn" onclick="wbSettings()">改设置</button> '+
      '<button class="rbtn" onclick="go(\'new\')">回去改问题</button></p></div>';
  }

  window.wbOpenSrc = function(d){
    var kb=window.WBKB; if(!kb) return;
    var c=kb.c.filter(function(x){ return x.d===d; })[0];
    var src=c? c.s : 'biz';
    var target = src==='biz'? 'MIC 业务知识库' : src==='method'? 'MIC 项目经验' : '技能与规范';
    if(target==='技能与规范'){ go('skills'); return; }
    for(var i=0;i<LIBS.length;i++) if(LIBS[i].n===target){ openLib(i); setTimeout(function(){ fqSearch(d); },80); return; }
  };
  window.wbStop = function(){ if(R.ctl) R.ctl.abort(); };
  window.wbRetry = function(){ runQuery(R.q); };

  /* ── 主流程 ── */
  function paint(){ if(S.view==='run') document.getElementById('main').innerHTML = viewRun(); }

  function runQuery(q){
    R.q=q; R.ans=''; R.srcs=[]; R.err=null; R.raw='';
    S.view='run';
    if(!ready()){ R.state='needkey'; render(); return; }
    R.state='loadkb'; render();
    loadKB().then(function(){
      R.state='search'; paint();
      return new Promise(function(res){ setTimeout(res,10); });
    }).then(function(){
      R.srcs = retrieve(q);
      R.state='run'; paint();
      R.ctl = (window.AbortController? new AbortController() : null);
      return callModel(q, R.srcs, function(full){ R.ans=full; paint(); }, R.ctl?R.ctl.signal:undefined);
    }).then(function(){
      R.state='done';
      if(!R.ans){ R.state='error'; R.err=['没收到内容','平台接受了请求但没返回文字。换个模型或稍后再试。']; }
      paint();
      S.tasks.unshift({ n:q.slice(0,40), scene:(sceneById(S.scene)||{}).name||'任务',
                        time:new Date().toTimeString().slice(0,5) });
      if(S.tasks.length>12) S.tasks.pop();
      renderNav();
    }).catch(function(e){
      R.state = (e&&e.name==='AbortError' && R.ans)? 'done' : 'error';
      if(R.state==='error'){ R.err=errText(e); R.raw=(e&&e.message)||''; }
      paint();
    });
  }
  window.wbRun = runQuery;

  /* 接到已有的发送按钮上 */
  window.submitTask = function(){
    var t=(S.text||'').trim();
    if(!t) return;
    var card = (S.sel!=null) ? (sceneById(S.scene).cards[S.sel]||null) : null;
    runQuery(card? (card.n+'：\n'+t) : t);
    S.text=''; S.sel=null; S.chips=[];
  };

  /* ── 设置弹层 ── */
  window.wbSettings = function(){
    var c=cfg(), prov=c.prov||'zhipu';
    var el=document.createElement('div'); el.id='wbmask';
    el.onclick=function(e){ if(e.target===el) close(); };
    el.innerHTML='<div class="wbdlg">'+
      '<h3>连一个模型</h3>'+
      '<p class="sub">密钥只存在你这台电脑的浏览器里，不会上传，也不会跟同事共享。'+
      '用的是你自己的额度，所以不会有人替你花钱、也不会被别人刷。</p>'+
      '<div class="fld"><label>选平台</label><div class="prov">'+
        Object.keys(PROV).map(function(k){
          return '<button class="provb'+(k===prov?' on':'')+'" data-p="'+k+'"><b>'+PROV[k].n+'</b><span>'+PROV[k].tip+'</span></button>';
        }).join('')+'</div>'+
        '<div class="hint" id="pgh">'+(PROV[prov].get||'')+'</div></div>'+
      '<div class="fld"><label>密钥</label><input id="wbk" type="password" placeholder="粘贴平台给你的 API 密钥" value="'+(c.key||'')+'">'+
        '<div class="hint">粘完可以先点「测试连接」，确认通了再保存。</div></div>'+
      '<div class="fld" id="cf" style="display:'+(prov==='custom'?'block':'none')+'">'+
        '<label>接口地址</label><input id="wbu" placeholder="https://…/chat/completions" value="'+(c.url||'')+'">'+
        '<div class="hint" style="margin-bottom:12px">要是 OpenAI 兼容的对话接口。</div>'+
        '<label>模型名</label><input id="wbm" placeholder="模型名" value="'+(c.model||'')+'"></div>'+
      '<div class="dfoot"><span class="msg" id="wbmsg"></span>'+
        '<button class="rbtn" onclick="wbCloseSet()">取消</button>'+
        '<button class="rbtn" id="wbtest">测试连接</button>'+
        '<button class="rbtn pri" id="wbsave">保存</button></div></div>';
    document.body.appendChild(el);
    var sel=prov;
    el.querySelectorAll('.provb').forEach(function(b){
      b.onclick=function(){
        sel=b.getAttribute('data-p');
        el.querySelectorAll('.provb').forEach(function(x){ x.classList.toggle('on', x===b); });
        document.getElementById('cf').style.display = sel==='custom'?'block':'none';
        document.getElementById('pgh').textContent = PROV[sel].get||'';
      };
    });
    function collect(){
      var o={ prov:sel, key:(document.getElementById('wbk').value||'').trim() };
      if(sel==='custom'){ o.url=(document.getElementById('wbu').value||'').trim();
                          o.model=(document.getElementById('wbm').value||'').trim(); }
      return o;
    }
    function msg(t){ document.getElementById('wbmsg').textContent=t; }
    document.getElementById('wbtest').onclick=function(){
      var o=collect();
      if(!o.key){ msg('先把密钥粘进来。'); return; }
      var url=o.url||PROV[o.prov].u, mdl=o.model||PROV[o.prov].m;
      if(!url||!mdl){ msg('自定义平台要把接口地址和模型名都填上。'); return; }
      msg('正在测…');
      fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+o.key},
        body:JSON.stringify({model:mdl,messages:[{role:'user',content:'你好'}],max_tokens:8})})
        .then(function(r){ return r.ok? msg('通了，可以保存。')
          : r.text().then(function(t){ var e=new Error(t); e.status=r.status; msg(errText(e).join('：')); }); })
        .catch(function(e){ msg(errText(e).join('：')); });
    };
    document.getElementById('wbsave').onclick=function(){
      var o=collect();
      if(!o.key){ msg('先把密钥粘进来。'); return; }
      saveCfg(o); close(); fqToast('已保存，密钥只在这台电脑上');
      if(S.view==='run' && R.state==='needkey') runQuery(R.q); else render();
    };
    function close(){ var m=document.getElementById('wbmask'); if(m) m.remove(); }
    window.wbCloseSet=close;
  };

/* ── 模型选择器换成真的（原来列的是 Claude / GPT / 豆包，页面实际调的是这几家，
        名单不换就是误导）── */
  var REAL=[
    {id:'zhipu',   n:'智谱 GLM-4-Flash', badge:['rec','免费'], good:'官方标免费 · 国内直连'},
    {id:'silicon', n:'硅基流动',                              good:'部分小模型免费'},
    {id:'deepseek',n:'DeepSeek',                              good:'按量付费 · 很便宜'},
    {id:'custom',  n:'自己填',                                 good:'任何 OpenAI 兼容接口'}
  ];
  MODELS.length=0; REAL.forEach(function(m){ MODELS.push(m); });
  S.model = cfg().prov || 'zhipu';

  /* 「配置自定义模型」那个按钮原来没接东西，接到设置上 */
  document.addEventListener('click', function(e){
    var b=e.target.closest && e.target.closest('.mfoot');
    if(b){ e.stopPropagation(); S.mopen=false; render(); wbSettings(); }
  });

  /* ── 装机引导：让同事把同一套能力装到自己电脑上 ── */
  var origViewSkills = viewSkills;
  viewSkills = function(){
    var html = origViewSkills();
    var card = '<div class="nbox" style="margin-bottom:26px">'+
      '<b>把这一整套装到自己电脑上</b>'+
      '<p>这个页面能查资料、能回答问题，但它写不进 Figma、跑不了脚本、打不开线上页面。'+
      '真要出设计稿、还原页面、做交付检查，得在自己电脑的 Claude Code 里装这套技能。'+
      '装完之后，下面这些能力就都是你自己的了。</p>'+
      '<p style="font-weight:700;color:var(--ink);margin-bottom:4px">在 Claude Code 里依次跑这两条</p>'+
      '<p><code class="mono" style="cursor:pointer;font-size:12px" onclick="copyTx(\'/plugin marketplace add https://git.vemic.com/MIC/UED/ued-skill.git\',\'第一条命令\')">'+
        '/plugin marketplace add https://git.vemic.com/MIC/UED/ued-skill.git</code></p>'+
      '<p><code class="mono" style="cursor:pointer;font-size:12px" onclick="copyTx(\'/plugin install mic-fullstack@mic-ued\',\'第二条命令\')">'+
        '/plugin install mic-fullstack@mic-ued</code></p>'+
      '<p style="font-weight:700;color:var(--ink);margin:12px 0 4px">还有第三步，省不掉</p>'+
      '<p>在终端跑一次装好的包里的 <code>biz-knowledge/install-biz-knowledge.sh</code>。'+
      '业务知识要落进你自己的记忆库，才会在你干活时自动被想起来；只装前两步的话，'+
      '技能在、业务知识不在。仓库地址 git.vemic.com/MIC/UED/ued-skill，README 里有完整说明。</p>'+
      '</div>';
    /* 插在页头之后、技能分组之前。找不到锚点就退回原样，别把整页搞没了 */
    var anchor = '<div class="grp">';
    return html.indexOf(anchor)>0 ? html.replace(anchor, card + anchor) : html;
  };

  /* 把路由和入口接上 */
  var lastModel = S.model;
  var origRender = render;
  render = function(){
    if(S.model !== lastModel){
      lastModel = S.model;
      var c0=cfg();
      if(c0.prov !== S.model){ c0.prov = S.model; saveCfg(c0);
        fqToast(c0.key? '已切到 '+(PROV[S.model]||{}).n : '还没填这个平台的密钥'); }
    }
    if(S.view==='run'){
      renderNav();
      var c2=document.getElementById('col2'); if(c2) c2.hidden=true;
      document.getElementById('main').innerHTML = viewRun();
      document.getElementById('main').scrollTop=0;
      return;
    }
    origRender();
  };
})();
'''


def splice(page, begin, end, payload, anchor):
    block = begin + '\n' + payload.strip() + '\n' + end
    if begin in page and end in page:
        a = page.index(begin); b = page.index(end) + len(end)
        return page[:a] + block + page[b:], '替换'
    if anchor not in page:
        print('❌ 找不到锚点 ' + anchor); sys.exit(1)
    i = page.index(anchor)
    return page[:i] + block + '\n' + page[i:], '插入'


def main():
    page = open(PAGE, encoding='utf-8').read()
    page, a1 = splice(page, CSS_B, CSS_E, CSS, '</style>')
    page, a2 = splice(page, JS_B, JS_E, JS, '</script>')
    open(PAGE, 'w', encoding='utf-8').write(page)
    print(f'CSS {a1} · JS {a2} · index.html {os.path.getsize(PAGE)/1024:.0f} KB')


if __name__ == '__main__':
    main()
