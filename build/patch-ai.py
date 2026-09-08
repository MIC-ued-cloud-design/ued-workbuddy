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
/* 统一身份：内部工具没有登录态，所以不显示某个人的名字和姓氏首字，
   用飞鹊的 person 图标 + 「UED 设计师」这个中性称呼。 */
.qava{width:26px;height:26px;flex:none;border-radius:999px;background:var(--accent);color:#fff;display:grid;place-items:center}
.qava svg{width:14px;height:14px;display:block}
.ava svg{width:15px;height:15px;display:block}
.qtx{flex:1;font-size:15px;color:var(--ink);line-height:1.75;white-space:pre-wrap;word-break:break-word;padding-top:2px}
.abox{border-top:1px solid var(--line);padding:22px 0 0}
.ahead{display:flex;align-items:center;gap:9px;margin:0 0 14px}
.ahead b{font-size:13px;color:var(--accent-ink)}   /* 主题色。用 accent-ink 不用 accent —— 后者 13px 加粗在白底偏浅，token 里也标了 ink 那档是文字用 */
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
.atx .raw{white-space:pre-wrap;word-break:break-word}
.caret{display:inline-block;width:7px;height:15px;background:var(--accent);vertical-align:-2px;animation:cb 1s steps(2) infinite}
@keyframes cb{0%,50%{opacity:1}51%,100%{opacity:0}}
.srcs{margin:22px 0 0;padding:14px 0 0;border-top:1px solid var(--line-2)}
.srcs-h{font-size:12px;color:var(--ink-3);margin:0 0 9px}
.srcs-l{display:flex;flex-wrap:wrap;gap:6px}
.srcchip{font-size:12px;color:var(--ink-2);background:var(--soft);border:0;border-radius:999px;padding:6px 12px;cursor:pointer;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.srcchip:hover{background:var(--accent-fill);color:var(--accent-ink)}
.runfoot{margin:30px 0 0;display:flex;gap:9px;flex-wrap:wrap}
.rbtn{font:13px/1 inherit;color:var(--ink);background:var(--white);border:1px solid var(--line);border-radius:999px;padding:10px 18px;cursor:pointer}
.rbtn:hover{border-color:var(--accent-line);background:var(--accent-fill);color:var(--accent-ink)}
.rbtn.pri{background:var(--dark);color:#fff;border-color:var(--dark)}
.rbtn.pri:hover{background:#000;color:#fff}

/* 任务区折叠：原来那个箭头是纯装饰，taskHead 没绑任何事件 */
.sb-sec-h{cursor:pointer;user-select:none}
.sb-sec-h:hover{color:var(--ink)}
.sb-sec-h svg{transition:transform .18s}
.sb-sec-h.closed svg{transform:rotate(-90deg)}
/* 🔴 显式写 —— [hidden] 打不过 .sb-list 自己的 display:flex，本项目栽过两次 */
.sb-list[hidden]{display:none!important}

/* 任务历史：选中态 + 清空入口 */
.sb-item.on{background:var(--nav-on)}
.sb-item.clr{text-align:left}
.sb-item.clr .m{color:var(--ink-3)}

/* 接着问 */
.askmore{margin:26px 0 0;border:1px solid var(--line);border-radius:14px;background:var(--soft);padding:8px}
.askmore.focus{border-color:var(--accent-line)}
.askin{background:var(--white);border-radius:10px;padding:12px 14px;display:flex;align-items:flex-end;gap:10px}
.askin textarea{flex:1;border:0;outline:0;resize:none;font:14px/1.65 inherit;color:var(--ink);background:none;min-height:24px;max-height:180px}
.askin textarea::placeholder{color:var(--ink-3)}
.asksend{flex:none;width:30px;height:30px;border-radius:999px;border:0;background:var(--dark);color:#fff;display:grid;place-items:center;cursor:pointer}
.asksend:disabled{background:#E0E0E0;cursor:default}
.asksend svg{width:14px;height:14px}
.asksend svg path{fill:currentColor}
.askhint{font-size:12px;color:var(--ink-3);padding:7px 14px 3px}
.turn{border-top:1px solid var(--line);padding:22px 0 0;margin:22px 0 0}

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
.prov{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.provb{text-align:left;background:var(--white);border:1px solid var(--line);border-radius:10px;padding:11px 13px;cursor:pointer}
.provb.on{border-color:var(--accent);background:var(--accent-fill)}
.provb b{display:block;font-size:13px;color:var(--ink);font-weight:700;margin:0 0 3px}
.provb span{display:block;font-size:12px;color:var(--ink-3);line-height:1.5}
'''

JS = r'''
/* ══════════ 真接模型 + 真检索知识库 ══════════ */
(function(){
  var LS='wb.ai.cfg';

  /* 部门共享代理：密钥藏在 Netlify 边缘函数的环境变量里，页面不知道密钥。
     所以同事打开就能问，不用注册也不用填密钥。
     🔴 下面这个口令是写在公开页面里的，查看源码就能看到 —— 它只挡随手拿 curl 打的，
     真正的防线是代理侧的速率限制。这一点在 proxy/README.md 里记了账。 */
  var PROXY = {
    url:  'https://eloquent-semifreddo-38ac62.netlify.app/chat',
    pass: 'ued2026'
  };

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
             get:'platform.deepseek.com 注册后在「API keys」页新建'}
  };

  function cfg(){
    try{ var o=JSON.parse(localStorage.getItem(LS)||'{}'); return o&&typeof o==='object'?o:{}; }
    catch(e){ return {}; }
  }
  function saveCfg(o){ try{ localStorage.setItem(LS, JSON.stringify(o)); }catch(e){} }
  /* 两种模式：填了自己的密钥就直连智谱（own），否则走部门共享代理（proxy）。
     留着 own 这条是为了自救 —— 代理挂了或额度用完时，各人可以填自己的密钥继续用。 */
  /* 🔴 本地双击打开（file://）时浏览器发出的 Origin 是 null，代理会按来源校验拒掉。
     这是对的，不该为了图方便去放行 null —— 那等于任何人存一个本地网页就能用这条通道。
     所以本地打开时只有「填自己密钥」这一条路；资料库不受影响，照样能查。 */
  function localFile(){ return location.protocol === 'file:'; }
  function mode(){
    var c=cfg();
    if(c.key) return 'own';
    if(PROXY.url && !localFile()) return 'proxy';
    return 'none';
  }
  function ready(){ return mode()!=='none'; }
  window.wbMode = mode;
  function endpoint(){ var c=cfg(); return c.url || (PROV[c.prov]||{}).u || ''; }
  function modelName(){ var c=cfg(); return c.model || (PROV[c.prov]||{}).m || ''; }
  window.wbReady = ready;

  /* ── 知识库：优先放进 Web Worker ──
     kb.js 有 7.2 MB，在主线程解析要 1686ms（实测），界面会冻住；
     语料对象加上小写缓存还会把主线程堆推到 18MB。放进 Worker 后主线程既不解析也不持有。
     🔴 file:// 本地打开时浏览器不允许建 Worker，所以留了主线程兜底那条路；
        两条路共用 kb-search.js 这一份检索代码，不写两份。 */
  var KB = { p:null, mode:null, worker:null, meta:null, seq:0, waits:{} };

  function loadMain(){
    /* 兜底：把检索代码和语料都拉进主线程。
       用 <script src> 不用 fetch —— file:// 下 fetch 会被 CORS 拦，script 标签不会。 */
    function inject(src){
      return new Promise(function(res,rej){
        var el=document.createElement('script'); el.src=src;
        el.onload=function(){ res(); };
        el.onerror=function(){ rej(new Error(src+' 载不到')); };
        document.head.appendChild(el);
      });
    }
    return inject('kb-search.js').then(function(){ return inject('kb.js'); }).then(function(){
      if(!window.WBKB || !window.WBSearch) throw new Error('语料或检索代码没就位');
      KB.mode='main'; KB.meta={docs:WBKB.docs, chunks:WBKB.chunks, chars:WBKB.chars, by:WBKB.by, gen:WBKB.gen};
      return KB.meta;
    });
  }

  function loadKB(){
    if(KB.p) return KB.p;
    KB.p = new Promise(function(res, rej){
      var settled=false;
      function toMain(why){
        if(settled) return; settled=true;
        KB.why = why;                       // 记下来 —— 原来只收参数不用，出问题查不出原因
        if(KB.worker){ try{ KB.worker.terminate(); }catch(e){} KB.worker=null; }
        loadMain().then(res, rej);
      }
      if(location.protocol==='file:' || !window.Worker){ toMain('本地文件或不支持 Worker'); return; }
      var w;
      try{ w=new Worker('kb-worker.js'); }
      catch(e){ toMain('Worker 建不起来：'+(e&&e.message||e)); return; }
      w.onmessage=function(e){
        var d=e.data||{};
        if(d.type==='ready'){
          if(!d.meta){ toMain('Worker 里没拿到语料'); return; }
          if(settled) return; settled=true;
          KB.mode='worker'; KB.worker=w; KB.meta=d.meta; res(d.meta); return;
        }
        if(d.type==='result'){ var f=KB.waits[d.id]; if(f){ delete KB.waits[d.id]; f.res(d.chunks||[]); } return; }
        if(d.type==='error'){ var g=KB.waits[d.id]; if(g){ delete KB.waits[d.id]; g.rej(new Error(d.message||'Worker 出错')); } return; }
      };
      w.onerror=function(ev){ toMain('Worker 报错：'+((ev&&(ev.message||ev.filename))||'没给信息')); };
      w.postMessage({type:'ping'});
      setTimeout(function(){ toMain('Worker 20 秒没应答'); }, 20000);
    });
    return KB.p;
  }
  window.wbLoadKB = loadKB;
  window.wbKBInfo = function(){ return {mode:KB.mode, meta:KB.meta, why:KB.why||null}; };

  /* 检索现在是异步的（Worker 要跨线程来回一趟） */
  function retrieveAsync(q, budget){
    if(KB.mode==='worker'){
      return new Promise(function(res,rej){
        var id=++KB.seq;
        KB.waits[id]={res:res,rej:rej};
        KB.worker.postMessage({type:'query', id:id, q:q, budget:budget});
        setTimeout(function(){ if(KB.waits[id]){ delete KB.waits[id]; res([]); } }, 15000);
      });
    }
    try{ return Promise.resolve(window.WBSearch.retrieve(window.WBKB, q, budget)); }
    catch(e){ return Promise.resolve([]); }
  }
  window.wbRetrieve = retrieveAsync;

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
    '6. 中文和英文、中文和数字之间加一个半角空格：写「有 540 个状态」不写「有540个状态」，'
      + '写「用 Figma 打开」不写「用Figma打开」。标点前后不加。',
    '7. 🔴 数字、组件名、key、字号、比例这类具体值，必须从资料里逐字照抄，一个字符都不要改，也不要自己归纳或换算。',
    '   资料里写「状态（variant）总数：540」，你就说 540，不要因为觉得这个数不合理而改小。',
    '   拿不准就直接引用资料原句，让用户自己看。说出来的数字和列出来的项数必须对得上。',
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
    var c=cfg(), m=mode();
    var url = (m==='own') ? endpoint() : PROXY.url;
    var mdl = (m==='own') ? modelName() : 'glm-4-flash';
    var head = {'Content-Type':'application/json'};
    if(m==='own') head['Authorization'] = 'Bearer '+c.key;
    else if(PROXY.pass) head['X-WB-Pass'] = PROXY.pass;
    /* 多轮：历史只带问答文本，不重复带资料——资料每轮重新检索，
       否则几轮下来上下文会被十几段资料撑爆，而且旧资料会干扰新问题。
       只留最近 4 轮，每条截到 1200 字。 */
    var msgs=[{role:'system', content:SYS}];
    (R.turns||[]).slice(-4).forEach(function(t){
      if(!t.q || !t.ans) return;
      msgs.push({role:'user',      content:String(t.q).slice(0,1200)});
      msgs.push({role:'assistant', content:String(t.ans).slice(0,1200)});
    });
    msgs.push({role:'user', content:'参考资料：\n\n'+ctxOf(chunks)+'\n\n──────────\n\n我的问题：'+q});
    var body={ model:mdl, stream:true, temperature:0.1, messages:msgs };   // 低温：这类问答要准不要花
    return fetch(url,{ method:'POST', signal:signal, headers:head, body:JSON.stringify(body) })
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
    var s=e&&e.status, isProxy = (mode()==='proxy');
    if(s===401||s===403){
      return isProxy
        ? ['共享服务暂时用不了', '部门共享的那条通道没放行这次请求。可以先填自己的智谱密钥继续用，'
           + '或者把这条报错告诉做这个页面的人。']
        : ['密钥没通过', '这个密钥被拒了。检查是不是复制时少了字符，或者这个密钥属于另一个平台。'];
    }
    if(s===429)          return isProxy
      ? ['大家问得太密了', '部门共享的这条通道有速率上限，同一时间用的人多就会排到。'
         + '等一会儿再试，或者填自己的智谱密钥走自己的额度。']
      : ['被限流了', '免费额度用完，或者短时间请求太多。等一会儿再试。'];
    if(s===400)          return ['模型名不对', '这个平台上没有当前填的模型名。到设置里换一个，或者填平台文档里写的名字。'];
    if(s===404)          return ['接口地址不对', '设置里的接口地址在这个平台上不存在。'];
    if(s>=500)           return ['平台那边出错了', '不是你的问题，稍后再试。'];
    if(e&&e.name==='AbortError') return ['已停止', '这次回答被你中断了。'];
    return ['请求发不出去', '请求没能送到平台。最常见的原因是公司网络挡了这个域名——'
            + '智谱、硅基流动、DeepSeek 都是国内服务，一般直连可达，但公司代理可能有自己的名单。'
            + '换手机热点试一次就能分清是网络策略还是别的问题。'];
  }

  /* ── 任务历史 ──
     原来三层都不对：条目没绑点击（点了没反应）、只存了标题不存问答内容、
     只在内存里刷新就丢。这三条一起修。 */
  var TKEY='wb.tasks', TMAX=20;
  function esc(t){ return String(t==null?'':t).replace(/[&<>"]/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function loadTasks(){
    try{ var a=JSON.parse(localStorage.getItem(TKEY)||'[]'); return Array.isArray(a)? a : []; }
    catch(e){ return []; }
  }
  function saveTasks(a){
    /* localStorage 有 5MB 上限，所以只留最近 TMAX 条，
       而且参考资料只存文档名不存正文（正文在 kb.js 里，要用再检索）。 */
    try{ localStorage.setItem(TKEY, JSON.stringify(a.slice(0,TMAX))); }catch(e){}
  }
  window.wbOpenTask = function(x){
    var t=(S.tasks||[])[x]; if(!t) return;
    R.q=t.q||t.n||''; R.ans=t.ans||''; R.err=null; R.raw='';
    R.srcs=(t.docs||[]).map(function(d){ return {d:d, t:'', x:'', s:t.srcKind&&t.srcKind[d]||'biz'}; });
    R.state = t.ans? 'done' : 'error';
    if(!t.ans) R.err=['这条没有存下回答','它是在加回放功能之前问的，或者当时没答完。重新问一次就会存了。'];
    R.taskIdx=x; S.view='run'; render();
    document.getElementById('main').scrollTop=0;
  };
  window.wbClearTasks = function(){
    S.tasks=[]; saveTasks([]); fqToast('任务记录已清空'); renderNav();
    if(S.view==='run') go('new');
  };

  /* ── 跑任务视图 ── */
  var R = { q:'', ans:'', srcs:[], state:'idle', err:null, ctl:null, task:'', turns:[] };
  window.WBRUN = R;

  /* 🔴 小模型不听格式类指令 —— prompt 里写了「中英之间加空格」「不要 emoji」，
     它照样输出「有540个状态」和「📝」。所以这两件事在前端机器修，不赌它自觉。
     反引号里的内容原样保留（那里面是代码和 key，加空格会改坏）。 */
  var EMO=/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F0FF}\u{FE0F}\u{20E3}]/gu;
  function tidy(t){
    return String(t||'').split(/(`[^`]*`)/).map(function(seg,i){
      if(i%2) return seg;                       // 反引号内原样
      return seg.replace(EMO,'')
                .replace(/([\u4e00-\u9fa5])([A-Za-z0-9])/g,'$1 $2')
                .replace(/([A-Za-z0-9])([\u4e00-\u9fa5])/g,'$1 $2')
                .replace(/ {2,}/g,' ');
    }).join('');
  }
  window.wbTidy = tidy;

  /* 🔴 这个函数曾经把浏览器搞崩（3.1 GB 堆、渲染进程被杀）。
     根因：段落分支的 while 条件里用 [-*\d|#] 排除「块的开头」，
     但一行以数字开头（「2026 年…」「540 个状态…」）既不匹配列表格式（要求 1. 后跟空格）、
     也被 while 条件排除 → para 为空、i 不前进 → 无限循环往数组里塞空串 → 吃光内存。
     中文回答里以数字开头的行极常见，所以长回答几乎必崩。

     两道修：① 块开头改成精确判断，不用粗糙字符类
             ② 加循环护栏：无论判据怎么写，每一轮都必须保证 i 前进 */
  function mdToHtml(t){
    t = tidy(t);
    var esc=function(x){ return x.replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c];}); };
    var lines=esc(t).split('\n'), out=[], i=0, guard=0, cap=lines.length*4+64;

    function isTable(ln){ return /^\s*\|/.test(ln); }
    function isHead(ln){  return /^#{1,6}\s+\S/.test(ln); }
    function isUl(ln){    return /^\s*[-*+]\s+\S/.test(ln); }
    function isOl(ln){    return /^\s*\d{1,3}[.)]\s+\S/.test(ln); }
    function isBlock(ln){ return isTable(ln)||isHead(ln)||isUl(ln)||isOl(ln); }

    function inline(x){
      return x.replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>')
              .replace(/`([^`]+)`/g,'<code>$1</code>');
    }

    while(i<lines.length){
      if(++guard>cap) break;              // 护栏：判据再怎么错也不会锁死浏览器
      var before=i, ln=lines[i];

      if(!ln.trim()){ i++; continue; }

      if(isTable(ln)){
        var rows=[];
        while(i<lines.length && isTable(lines[i])){
          var cells=lines[i].trim().replace(/^\||\|$/g,'').split('|').map(function(x){return x.trim();});
          if(!cells.every(function(c){ return /^:?-{2,}:?$/.test(c)||c===''; })) rows.push(cells);
          i++;
        }
        if(rows.length){
          out.push('<table><thead><tr>'+rows[0].map(function(c){return '<th>'+inline(c)+'</th>';}).join('')+'</tr></thead><tbody>'
            + rows.slice(1).map(function(r){ return '<tr>'+r.map(function(c,ci){return '<td'+(ci===0?' class="c1"':'')+'>'+inline(c)+'</td>';}).join('')+'</tr>'; }).join('')
            + '</tbody></table>');
        }
        if(i===before) i++;               // 表格没吃掉任何行也要前进
        continue;
      }

      if(isHead(ln)){
        out.push('<h3>'+inline(ln.replace(/^#{1,6}\s+/,''))+'</h3>'); i++; continue;
      }

      if(isUl(ln)||isOl(ln)){
        var ord=isOl(ln), items=[];
        while(i<lines.length && (isUl(lines[i])||isOl(lines[i]))){
          items.push('<li>'+inline(lines[i].replace(/^\s*(?:[-*+]|\d{1,3}[.)])\s+/,''))+'</li>'); i++;
        }
        out.push((ord?'<ol>':'<ul>')+items.join('')+(ord?'</ol>':'</ul>'));
        if(i===before) i++;
        continue;
      }

      // 普通段落：吃到下一个块开头或空行为止
      var para=[];
      while(i<lines.length && lines[i].trim() && !isBlock(lines[i])){ para.push(lines[i]); i++; }
      if(i===before){ para.push(lines[i]); i++; }   // 🔴 兜底：一行都没吃到也强制前进
      out.push('<p>'+inline(para.join(' '))+'</p>');
    }
    return out.join('');
  }

  function qblock(q){
    return '<div class="qbox"><span class="qava">'+(window.fqIcon? fqIcon('personal-f',14)||'' : '')+
      '</span><div class="qtx">'+esc(q)+'</div></div>';
  }
  function pastTurns(){
    /* 已经答完的前几轮，让人看得见对话是连着的 */
    return (R.turns||[]).map(function(t){
      return '<div class="turn">'+qblock(t.q)+
        '<div class="ahead"><b>WorkBuddy</b></div><div class="atx">'+mdToHtml(t.ans)+'</div></div>';
    }).join('');
  }
  function askMoreBox(){
    if(R.state==='run'||R.state==='search'||R.state==='loadkb') return '';
    return '<div class="askmore" id="am"><div class="askin">'+
      '<textarea id="ta2" rows="1" placeholder="接着问 —— 它记得上面聊过什么"'+
        ' oninput="wbAmInput(this)"></textarea>'+
      '<button class="asksend" id="am-send" onclick="wbAskMore()" disabled>'+
        (typeof ic!=='undefined' && ic.wb_send ? ic.wb_send : '↑')+'</button></div>'+
      '<div class="askhint">回车发送，Shift + 回车换行</div></div>';
  }

  window.wbAmInput = function(el){
    el.style.height='auto'; el.style.height=Math.min(el.scrollHeight,180)+'px';
    var b=document.getElementById('am-send'); if(b) b.disabled = !el.value.trim();
  };
  window.wbAskMore = function(){
    var el=document.getElementById('ta2'); if(!el) return;
    var v=(el.value||'').trim(); if(!v) return;
    el.value=''; runQuery(v, true);
  };

  window.viewRun = function(){
    var st=R.state;
    return '<div class="runwrap">'+
      pastTurns()+
      (R.turns&&R.turns.length? '<div class="turn">':'')+
      qblock(R.q)+
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
                     : '<button class="rbtn pri" onclick="go(\'new\')">开个新话题</button>'+
                       (R.ans? '<button class="rbtn" onclick="copyTx(WBRUN.ans,\'回答\')">复制回答</button>'+
                               '<button class="rbtn" onclick="wbRetry()">重新回答</button>' : ''))+
        '</div></div>')+
      (R.turns&&R.turns.length? '</div>':'')+
      askMoreBox()+
    '</div>';
  };
  function PROVN(){
    return mode()==='own' ? '智谱 GLM-4-Flash · 你自己的密钥'
                          : '智谱 GLM-4-Flash · 部门共享';
  }
  function dedupSrc(){ var o=[],s=R.srcs; s.forEach(function(c){ if(o.indexOf(c.d)<0) o.push(c.d); }); return o; }

  function needKeyBox(){
    var kb = KB.meta? (KB.meta.docs+' 份文档、'+KB.meta.chunks+' 段') : '482 份文档';
    if(localFile()){
      return '<div class="nbox warn"><b>这是本地打开的文件，问答要用线上地址</b>'+
        '<p>部门共享的模型通道只认线上那个地址，本地文件打开时浏览器不带来源信息，会被挡掉。'+
        '这是有意的：不然任何人存一份网页就能用这条通道。</p>'+
        '<p>两条路都行：打开线上地址（那边不用配置，直接问）；或者在这里填自己的智谱密钥，本地也能问。</p>'+
        '<p><button class="rbtn pri" onclick="window.open(\'https://mic-ued-cloud-design.github.io/ued-workbuddy/\',\'_blank\')">打开线上地址</button> '+
        '<button class="rbtn" onclick="wbSettings()">填自己的密钥</button> '+
        '<button class="rbtn" onclick="go(\'libs\')">先只看资料库</button></p></div>';
    }
    return '<div class="nbox warn"><b>暂时问不了 —— 共享通道没配置</b>'+
      '<p>知识库已经装在页面里了（'+kb+'），但没有模型来读它、组织成答案。'+
      '可以填自己的智谱密钥先用起来，密钥只存在你这台设备的浏览器里。</p>'+
      '<p><button class="rbtn pri" onclick="wbSettings()">填自己的密钥</button> '+
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
    /* 🔴 不能查 window.WBKB —— Worker 模式下主线程没有语料。
       用这次返回的块自带的来源标记就够了。 */
    var c=(R.srcs||[]).filter(function(x){ return x.d===d; })[0];
    var src=c? c.s : 'biz';
    var target = src==='biz'? 'MIC 业务知识库' : src==='method'? 'MIC 项目经验' : '技能与规范';
    if(target==='技能与规范'){ go('skills'); return; }
    for(var i=0;i<LIBS.length;i++) if(LIBS[i].n===target){ openLib(i); setTimeout(function(){ fqSearch(d); },80); return; }
  };
  window.wbStop = function(){ if(R.ctl) R.ctl.abort(); };
  window.wbRetry = function(){ runQuery(R.q); };

  /* ── 主流程 ── */
  function paint(){ if(S.view==='run') document.getElementById('main').innerHTML = viewRun(); }

  /* 🔴 流式期间不解析 markdown，只往末尾追加纯文本。
     这是第二次修这个地方 —— 第一次我只把频率从「每个 token」降到「每 120ms」，
     但每次仍然重解析全文，复杂度还是平方级：答案越长越卡，
     长输出（比如竞品分析）撞得最狠。现在改成：
       流式中 → textContent 追加，单次开销跟答案长度无关
       生成完 → 一次性解析成 markdown（表格、列表这时才出来）
     代价是流式期间看到的是纯文本、表格不成形，几秒后成形 —— 这个代价换的是不卡。 */
  var streamTimer=null, lastPaint=0, txtEl=null, shown=0;
  function paintStream(){
    if(S.view!=='run') return;
    var now=Date.now(), gap=now-lastPaint;
    if(gap<100){
      if(!streamTimer) streamTimer=setTimeout(function(){ streamTimer=null; paintStream(); }, 110-gap);
      return;
    }
    lastPaint=now;
    if(!txtEl || !txtEl.isConnected){
      var host=document.querySelector('#main .atx');
      if(!host){ paint(); return; }
      host.innerHTML='<div class="raw"></div><span class="caret"></span>';
      txtEl=host.querySelector('.raw'); shown=0;
    }
    if(R.ans.length>shown){
      txtEl.appendChild(document.createTextNode(R.ans.slice(shown)));
      shown=R.ans.length;
    }
  }
  function stopStream(){
    if(streamTimer){ clearTimeout(streamTimer); streamTimer=null; }
    txtEl=null; shown=0;
  }

  function runQuery(q, keepTurns){
    /* 轮次在「开始新一轮」时收进历史，不是在「答完」时收 ——
       答完就 push 会让 pastTurns() 和当前这一轮同时渲染同一条，界面上重复一遍。
       这样 R.turns 永远只装「已经翻页过去的」，当前轮由 R.q / R.ans 单独渲染。 */
    if(!keepTurns){ R.turns=[]; }
    else if(R.q && R.ans){
      R.turns.push({q:R.q, ans:R.ans});
      if(R.turns.length>8) R.turns.shift();
    }
    R.q=q; R.ans=''; R.srcs=[]; R.err=null; R.raw='';
    S.view='run';
    if(!ready()){ R.state='needkey'; render(); return; }
    R.state='loadkb'; render();
    loadKB().then(function(){
      R.state='search'; paint();
      return retrieveAsync(q);
    }).then(function(chunks){
      R.srcs = chunks || [];
      R.state='run'; paint();
      R.ctl = (window.AbortController? new AbortController() : null);
      return callModel(q, R.srcs, function(full){ R.ans=full; paintStream(); }, R.ctl?R.ctl.signal:undefined);
    }).then(function(){
      stopStream();          // 到这里才做唯一一次完整 markdown 解析（在 paint 里）
      R.state='done';
      if(!R.ans){ R.state='error'; R.err=['没收到内容','平台接受了请求但没返回文字。换个模型或稍后再试。']; }
      paint();
      var kinds={};
      (R.srcs||[]).forEach(function(c){ kinds[c.d]=c.s; });
      S.tasks.unshift({
        q: q, n: q.slice(0,40), ans: R.ans,
        proj: S.proj || '',                    // 「选择工作空间」选了哪个（build/patch-project.py）
                                               // 🔴 不能写 window.S —— 顶层 const 不会挂到 window 上
        docs: [].concat.apply([], [[]].concat((R.srcs||[]).map(function(c){ return c.d; })))
                .filter(function(d,i,a){ return d && a.indexOf(d)===i; }),
        srcKind: kinds,
        scene: (sceneById(S.scene)||{}).name||'任务',
        time: new Date().toTimeString().slice(0,5)
      });
      if(S.tasks.length>TMAX) S.tasks.length=TMAX;
      saveTasks(S.tasks);
      R.taskIdx=0;
      renderNav();
    }).catch(function(e){
      stopStream();
      R.state = (e&&e.name==='AbortError' && R.ans)? 'done' : 'error';
      if(R.state==='error'){ R.err=errText(e); R.raw=(e&&e.message)||''; }
      paint();
    });
  }
  window.wbRun = runQuery;

  /* 首页输入框补一句回车提示（原来的 placeholder 没说） */
  (function(){
    var el=document.getElementById('ta');
    if(el && el.placeholder && el.placeholder.indexOf('回车')<0)
      el.placeholder = el.placeholder.replace(/…$/,'') + '（回车发送，Shift + 回车换行）';
  })();

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
      '<h3>用自己的密钥（可选）</h3>'+
      '<p class="sub">这个页面默认走部门共享的通道，不填也能问。'+
      '填了就改走你自己的额度 —— 共享通道排队或者额度用完时，这是自救的办法。'+
      '密钥只存在你这台设备的浏览器里，不会上传，也不会跟同事共享。</p>'+
      '<div class="fld"><label>智谱 API 密钥</label><input id="wbk" type="password" placeholder="粘贴平台给你的 API 密钥" value="'+(c.key||'')+'">'+
        '<div class="hint">用的是智谱 GLM-4-Flash，官方标免费。'+
        '还没有密钥就去 open.bigmodel.cn 注册，在用户中心的「API 密钥」页新建一个。'+
        '粘完先点「测试连接」，确认通了再保存。</div></div>'+

      '<div class="dfoot"><span class="msg" id="wbmsg"></span>'+
        (cfg().key? '<button class="rbtn" onclick="wbClearKey()">清除，退回共享通道</button>':'')+
        '<button class="rbtn" onclick="wbCloseSet()">取消</button>'+
        '<button class="rbtn" id="wbtest">测试连接</button>'+
        '<button class="rbtn pri" id="wbsave">保存</button></div></div>';
    document.body.appendChild(el);
    var sel='zhipu';
    function collect(){
      return { prov:sel, key:(document.getElementById('wbk').value||'').trim() };
    }
    function msg(t){ document.getElementById('wbmsg').textContent=t; }
    document.getElementById('wbtest').onclick=function(){
      var o=collect();
      if(!o.key){ msg('先把密钥粘进来。'); return; }
      var url=o.url||PROV[o.prov].u, mdl=o.model||PROV[o.prov].m;
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
      saveCfg(o); close(); fqToast('已保存，密钥只在这台设备上');
      if(S.view==='run' && R.state==='needkey') runQuery(R.q); else render();
    };
    function close(){ var m=document.getElementById('wbmask'); if(m) m.remove(); }
    window.wbCloseSet=close;
    window.wbClearKey=function(){ saveCfg({}); close(); fqToast('已清除，回到部门共享通道'); render(); };
  };

/* ── 模型选择器换成真的（原来列的是 Claude / GPT / 豆包，页面实际调的是这几家，
        名单不换就是误导）── */
  var REAL=[
    {id:'zhipu', n:'智谱 GLM-4-Flash', badge:['rec','免费'], good:'官方标免费 · 国内直连'}
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

  /* 侧栏头像：静态 HTML 里拿不到 ic，在这里注入。
     🔴 只能用 window.fqIcon —— svgOf 住在资料库那个 IIFE 里，这里取不到。
     上一版我直接写 svgOf，抛 ReferenceError 把整个模块后半段（含 render 重载）
     全带崩了，而且报错位置离真凶很远。跨模块只走 window 上暴露的那个。 */
  (function(){
    var a=document.getElementById('sbAva');
    if(a && window.fqIcon) a.innerHTML = fqIcon('personal-f',15) || '';
  })();

  /* 任务区折叠。状态存起来，下次打开保持 */
  var FKEY='wb.taskFold';
  function foldClosed(){ try{ return localStorage.getItem(FKEY)==='1'; }catch(e){ return false; } }
  window.wbToggleTasks = function(){
    var closed = !foldClosed();
    try{ localStorage.setItem(FKEY, closed?'1':'0'); }catch(e){}
    applyFold();
  };
  function applyFold(){
    var h=document.getElementById('taskHead'), l=document.getElementById('taskList');
    var sec=h&&h.parentNode;
    if(!h||!l) return;
    var closed=foldClosed();
    h.classList.toggle('closed', closed);
    l.hidden = closed;
    /* 🔴 不要动 .sb-sec 的 flex —— 它 flex:1 占着剩余空间，
       正是它把下面的用户行推到底部的。收起时把它压掉，用户行会跟着上移 474px（实测）。
       所以只隐藏列表，空白留在原处，用户行保持置底。 */
  }

  /* 任务列表补点击行为（原来那个 button 没绑任何事件），并从 localStorage 恢复 */
  var origRenderNav = renderNav;
  renderNav = function(){
    origRenderNav();
    var head=document.getElementById('taskHead');
    if(head && !head.getAttribute('data-bound')){
      head.setAttribute('data-bound','1');
      head.setAttribute('title','点一下收起或展开');
      head.addEventListener('click', wbToggleTasks);
    }
    applyFold();
    var el=document.getElementById('taskList');
    if(!el || !S.tasks.length) return;
    el.innerHTML = S.tasks.map(function(t,x){
      var on = (S.view==='run' && R.taskIdx===x);
      return '<button class="sb-item'+(on?' on':'')+'" onclick="wbOpenTask('+x+')" title="点开看这次的问答">'+
        '<div class="t">'+esc(t.q||t.n||'')+'</div>'+
        '<div class="m"><span>'+esc(t.scene||'')+'</span><span>·</span><span>'+esc(t.time||'')+'</span></div>'+
        '</button>';
    }).join('') + '<button class="sb-item clr" onclick="wbClearTasks()"><div class="m">清空记录</div></button>';
  };
  S.tasks = loadTasks();          // 刷新之后任务还在
  renderNav();                    // 🔴 恢复了数据必须重渲染 —— 脚本末尾那次 render() 跑在本模块之前，
                                  //    那时 S.tasks 还是空的，所以侧栏显示的是空态。

  /* 回车发送、Shift + 回车换行。
     🔴 必须判 e.isComposing —— 中文输入法拼字时按回车是「确认候选词」，
     不判的话你打「筛选」按回车选词，消息就被发出去了，句子还只写了一半。
     用事件委托，不去改原始 HTML 里那个 textarea 的属性。 */
  document.addEventListener('keydown', function(e){
    if(e.key!=='Enter' || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
    if(e.isComposing || e.keyCode===229) return;      // 229 是老浏览器的输入法组合态
    var t=e.target;
    if(!t || t.tagName!=='TEXTAREA') return;
    if(t.id==='ta'){                                   // 首页输入框
      if(!(S.text||'').trim()) return;
      e.preventDefault(); submitTask();
    } else if(t.id==='ta2'){                            // 回答页的追问框
      if(!(t.value||'').trim()) return;
      e.preventDefault(); wbAskMore();
    }
  });

  /* 追问框渲染出来之后自动聚焦，省一次点击 */
  var origPaint2 = paint;
  paint = function(){
    origPaint2();
    var el=document.getElementById('ta2');
    if(el && R.state==='done' && document.activeElement!==el) el.focus();
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
