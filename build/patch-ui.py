#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把资料库真数据视图注入 index.html（可重复运行，按标记替换）。"""
import re, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = os.path.join(os.path.dirname(HERE), 'index.html')

CSS_B, CSS_E = '/* ==FQ-UI-CSS:BEGIN== */', '/* ==FQ-UI-CSS:END== */'
JS_B,  JS_E  = '/* ==FQ-UI-JS:BEGIN== */',  '/* ==FQ-UI-JS:END== */'

CSS = r'''
/* ── 资料库真数据视图 ── */
.fqbar{display:flex;align-items:center;gap:10px;margin:0 0 16px}
.fqtabs{display:flex;gap:4px;background:var(--soft);padding:3px;border-radius:999px}
.fqtab{font:12px/1 inherit;color:var(--ink-2);background:none;border:0;padding:7px 13px;border-radius:999px;cursor:pointer;white-space:nowrap}
.fqtab:hover{color:var(--ink)}
.fqtab.on{background:var(--white);color:var(--ink);font-weight:700;box-shadow:0 1px 2px -2px rgba(0,0,0,.1),0 3px 6px 0 rgba(0,0,0,.06)}
.fqsr{flex:1;min-width:120px;display:flex;align-items:center;gap:7px;border:1px solid var(--line);border-radius:8px;padding:0 11px;height:32px;background:var(--white)}
.fqsr svg{color:var(--ink-3);flex:none}
.fqsr input{flex:1;border:0;outline:0;font:13px/1 inherit;color:var(--ink);background:none}
.fqsr input::placeholder{color:var(--ink-3)}
.fqcnt{font-size:12px;color:var(--ink-3);white-space:nowrap}

.fqsec{margin:0 0 28px}
.fqsec-h{font-size:13px;font-weight:700;color:var(--ink);margin:0 0 4px}
.fqsec-p{font-size:12px;color:var(--ink-2);line-height:1.7;margin:0 0 12px}

/* 图标网格 */
.icgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:8px}
.iccell{border:1px solid var(--line);border-radius:8px;padding:12px 6px 9px;text-align:center;cursor:pointer;background:var(--white)}
.iccell:hover{border-color:var(--accent-line);background:var(--accent-fill)}
.iccell svg{width:20px;height:20px;color:var(--ink);display:block;margin:0 auto 8px}
.iccell span{display:block;font-size:12px;color:var(--ink-2);word-break:break-all;line-height:1.4}

/* 色块 */
.swgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(178px,1fr));gap:10px}
.swcell{border:1px solid var(--line);border-radius:8px;overflow:hidden;cursor:pointer;background:var(--white)}
.swcell:hover{border-color:var(--accent-line)}
.swtop{height:52px}
.swbot{padding:9px 11px}
.swn{font-size:12px;color:var(--ink);line-height:1.5;word-break:break-all}
.swh{font-size:12px;color:var(--ink-3);margin-top:3px;font-variant-numeric:tabular-nums}

/* 刻度 */
.scale{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end}
.scitem{border:1px solid var(--line);border-radius:8px;padding:10px 12px;min-width:66px;text-align:center;background:var(--white)}
.scitem b{display:block;font-size:13px;color:var(--ink);font-variant-numeric:tabular-nums}
.scitem i{display:block;font-style:normal;font-size:12px;color:var(--ink-3);margin-top:3px}
.scbar{background:var(--accent);border-radius:2px;height:8px;margin:0 auto 8px}
.fsrow{display:flex;align-items:baseline;gap:14px;padding:9px 0;border-bottom:1px solid var(--line-2)}
.fsrow b{font-size:12px;color:var(--ink-3);width:52px;flex:none;font-variant-numeric:tabular-nums}
.fsrow span{color:var(--ink)}

/* 阴影演示 */
.shgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:16px}
.shcell{background:var(--white);border-radius:12px;padding:16px}
.shcell b{display:block;font-size:13px;color:var(--ink);margin-bottom:6px}
.shcell p{font-size:12px;color:var(--ink-2);line-height:1.7;margin:0 0 10px}
.shcell code{display:block;font-size:12px;color:var(--ink-3);word-break:break-all;line-height:1.6;cursor:pointer}

/* 键值表 */
.kv{width:100%;border-collapse:collapse}
.kv td{border-bottom:1px solid var(--line-2);padding:11px 12px 11px 0;font-size:13px;color:var(--ink);vertical-align:top;line-height:1.7}
.kv td.k{width:31%;font-weight:700;padding-right:20px}
.kv td.v{color:var(--ink-2)}
.mono{font-size:12px;color:var(--ink-2);word-break:break-all;cursor:pointer}
.mono:hover{color:var(--accent-ink)}

/* 自查表 */
.ckgrp{border:1px solid var(--line);border-radius:10px;margin:0 0 10px;overflow:hidden}
.ckh{display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:var(--white);border:0;padding:13px 15px;cursor:pointer;font:13px/1.5 inherit}
.ckh:hover{background:var(--soft)}
.ckh b{flex:1;font-weight:700;color:var(--ink)}
.ckh i{font-style:normal;font-size:12px;color:var(--ink-3);font-variant-numeric:tabular-nums}
.ckh svg{width:14px;height:14px;color:var(--ink-3);transition:transform .15s}
.ckh.open svg{transform:rotate(180deg)}
.ckbody{border-top:1px solid var(--line);padding:4px 15px 6px}
.ckrow{display:flex;gap:11px;padding:10px 15px;align-items:flex-start}
.ckrow:hover{background:var(--soft)}
.ckbox{width:15px;height:15px;flex:none;margin-top:2px;border:1px solid var(--ink-3);border-radius:4px;background:var(--white);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}
.ckbox.on{background:var(--accent);border-color:var(--accent)}
.ckbox svg{width:11px;height:11px;color:#fff}
.cktx{flex:1;font-size:13px;color:var(--ink);line-height:1.75}
.cktx em{font-style:normal;display:block;font-size:12px;color:var(--ink-3);margin-top:3px}
.cktx.done{color:var(--ink-3);text-decoration:line-through}
.prog{display:flex;align-items:center;gap:11px;margin:0 0 16px}
.progbar{flex:1;height:6px;background:var(--soft);border-radius:999px;overflow:hidden}
.progbar i{display:block;height:100%;background:var(--accent);border-radius:999px;transition:width .2s}

/* 重点标记：不引入新颜色（WorkBuddy 自己就不用底色块高亮），只用字重和深一档的文字色 */
.hot{font-weight:700;color:var(--ink);margin-right:6px}
/* 🔴 内边距要挂在 .ckbody 上，不能挂在 table 上 ——
   这张表是 border-collapse:collapse，CSS 规范规定这种模式下
   表格自身的 padding 被忽略。计算样式里查得到、实际没生效，
   结果文档名比组标题少缩进 15px（量出来 580 vs 595）。 */
.ckbody .kv{padding:0}
.ckbody .kv td{font-size:12px}
/* 最后一行不要底边框 —— 它会和折叠组自己的底边框贴成两条线 */
.ckbody .kv tr:last-child td{border-bottom:0}

/* 知识库更新提示卡：点过就收起。
   🔴 必须显式写 [hidden]{display:none} —— [hidden] 打不过元素自己的 display，
   本项目在 .col2 上已经栽过一次。 */
.sb-card[hidden]{display:none!important}

/* 复制提示 */
#toast{position:fixed;left:50%;bottom:38px;transform:translateX(-50%) translateY(14px);background:var(--dark);color:#fff;font-size:12px;padding:9px 16px;border-radius:999px;opacity:0;pointer-events:none;transition:opacity .18s,transform .18s;z-index:99}
#toast.on{opacity:1;transform:translateX(-50%) translateY(0)}
'''

JS = r'''
/* ══════════ 资料库真数据（数据来自 window.FQ，由 build/gen-data.py 生成） ══════════ */
(function(){
  var FQD = window.WBDATA;   // 注意：页面顶层已有 const FQ（图标工厂），不能再占这个名字
  if(!FQD){ console.warn('WBDATA 数据块缺失'); return; }
  var M = FQD.m;

  /* 把资料库那 7 格的收录数字换成真实数字 */
  function setLib(name, cnt, d){
    for(var i=0;i<LIBS.length;i++) if(LIBS[i].n===name){
      if(cnt) LIBS[i].cnt = cnt;
      if(d)   LIBS[i].d = d;
    }
  }
  setLib('飞鹊组件库', 'Web '+M.web+' 个 · 移动端 '+M.mob+' 个 · 图标 '+M.icons+' 个');
  setLib('交互经验库', '自查表 '+M.cl+' 条 · 技能 '+M.ss+' 项');
  setLib('视觉与交付规范', '颜色 '+FQD.tk.col.length+' · 样式 '+(FQD.tk.st.paint.length+FQD.tk.st.text.length)+' 个');
  setLib('MIC 业务知识库', '八条业务线 · '+M.bz+' 份文档');
  setLib('MIC 项目经验', M.mr+' 份判断与做法');

  /* ── 小工具 ── */
  function esc(t){ return String(t==null?'':t).replace(/[&<>"]/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

  window.copyTx = function(t, label){
    var done = function(){ toast((label||'已复制')+'：'+t); };
    try{
      if(navigator.clipboard && location.protocol!=='file:'){
        navigator.clipboard.writeText(t).then(done, fallback);
      } else fallback();
    }catch(e){ fallback(); }
    function fallback(){
      var ta=document.createElement('textarea'); ta.value=t;
      ta.style.cssText='position:fixed;left:-9999px'; document.body.appendChild(ta);
      ta.select();
      try{ document.execCommand('copy'); done(); }
      catch(e){ toast('这个浏览器不允许自动复制，请手动选中'); }
      document.body.removeChild(ta);
    }
  };
  var tt;
  function toast(m){
    var el=document.getElementById('toast');
    if(!el){ el=document.createElement('div'); el.id='toast'; document.body.appendChild(el); }
    el.textContent=m; el.classList.add('on');
    clearTimeout(tt); tt=setTimeout(function(){ el.classList.remove('on'); },1900);
  }
  window.fqToast = toast;

  function svgOf(name, px){
    var inner=FQD.ic[name]; if(!inner) return '';
    var vb=FQD.icv[name]||'0 0 16 16';
    return '<svg viewBox="'+vb+'" width="'+(px||16)+'" height="'+(px||16)+'" fill="none">'+inner+'</svg>';
  }
  window.fqIcon = svgOf;

  function bar(label, count, tabs, cur, fn){
    return '<div class="fqbar">'+
      (tabs?'<div class="fqtabs">'+tabs.map(function(t){
        return '<button class="fqtab'+(t[0]===cur?' on':'')+'" onclick="'+fn+'(\''+t[0]+'\')">'+esc(t[1])+'</button>';
      }).join('')+'</div>':'')+
      '<label class="fqsr">'+svgOf('search',14)+
        '<input value="'+esc(S.fqQ||'')+'" placeholder="'+esc(label)+'" oninput="fqSearch(this.value)">'+
      '</label>'+
      '<span class="fqcnt">'+count+'</span></div>';
  }
  window.fqSearch = function(v){
    S.fqQ = v; var m=document.getElementById('fqhost');
    if(m) m.innerHTML = LIB_BODY[LIBS[S.lib].n]();
  };
  window.fqTab = function(t){ S.fqTab=t; S.fqQ=''; render(); };
  function hit(q, arr){ if(!q) return true; q=q.toLowerCase();
    return arr.some(function(x){ return String(x==null?'':x).toLowerCase().indexOf(q)>=0; }); }

  /* ── 飞鹊组件库 ── */
  function compTable(rows){
    if(!rows.length) return '<div class="libempty"><b>没有匹配的组件。</b><br>换个关键词试试，或者清空搜索框看全部。</div>';
    return '<table class="tbl"><thead><tr>'+
      '<th style="width:23%">组件名（Figma 里的真名）</th><th style="width:8%">状态数</th>'+
      '<th style="width:22%">默认状态</th><th style="width:16%">组件 key</th><th>要注意的地方</th>'+
      '</tr></thead><tbody>'+rows.map(function(c){
        return '<tr><td class="nm">'+esc(c.n)+'</td>'+
          '<td class="dim">'+(c.vc||'—')+'</td>'+
          '<td class="dim">'+esc(c.dv||'—')+'</td>'+
          '<td><span class="mono" onclick="copyTx(\''+esc(c.k)+'\',\'组件 key\')" title="点击复制完整 key">'+
            esc((c.k||'').slice(0,10))+(c.k?'…':'')+'</span></td>'+
          '<td class="dim">'+(c.hi? '<span class="hot">'+(c.hi>1?'重点':'注意')+'</span>':'')+esc(c.note||'')+'</td></tr>';
      }).join('')+'</tbody></table>';
  }
  function viewComps(){
    var t = S.fqTab||'web', q=S.fqQ||'';
    var tabs=[['web','Web 端 '+M.web],['mob','移动端 '+M.mob],['ico','图标 '+M.icons],
              ['trap','命名坑 '+FQD.xm.traps.length],['diff','两端差异 '+FQD.xm.wvm.length]];
    var body='', cnt='';
    if(t==='web'||t==='mob'){
      var src=(t==='web'?FQD.cw:FQD.cm).filter(function(c){ return hit(q,[c.n,c.dv,c.note,c.p]); });
      cnt=src.length+' / '+(t==='web'?M.web:M.mob)+' 个';
      body=compTable(src);
    } else if(t==='ico'){
      var names=Object.keys(FQD.ic).filter(function(n){ return hit(q,[n]); });
      cnt=names.length+' / '+M.icons+' 个';
      body = names.length
        ? '<div class="fqsec-p">点任意图标复制它的文件名。飞鹊 Figma 里的图标名带中文分类前缀（比如 <b>符号&amp;箭头-arrow-down</b>），这里显示的是去掉前缀之后的名字。</div>'
          +'<div class="icgrid">'+names.map(function(n){
            return '<button class="iccell" onclick="copyTx(\''+n+'\',\'图标名\')">'+svgOf(n,20)+'<span>'+esc(n)+'</span></button>';
          }).join('')+'</div>'
        : '<div class="libempty"><b>没有叫这个名字的图标。</b><br>试试英文关键词，比如 arrow / search / delete。</div>';
    } else {
      var src2=(t==='trap'?FQD.xm.traps:FQD.xm.wvm).filter(function(r){ return hit(q,[r.k,r.v]); });
      cnt=src2.length+' 条';
      body = src2.length
        ? '<table class="kv">'+src2.map(function(r){
            return '<tr><td class="k">'+esc(r.k)+'</td><td class="v">'+esc(r.v)+'</td></tr>'; }).join('')+'</table>'
        : '<div class="libempty"><b>没有匹配内容。</b></div>';
    }
    return bar('搜组件名、状态名或说明', cnt, tabs, t, 'fqTab') + body;
  }

  /* ── 视觉与交付规范（token） ── */
  function viewTokens(){
    var tk=FQD.tk, q=S.fqQ||'';
    var tabs=[['col','颜色 '+tk.col.length],['type','字号与间距'],['sh','阴影 '+tk.sh.length],
              ['st','Figma 样式 '+(tk.st.paint.length+tk.st.text.length+tk.st.eff.length)]];
    var t=S.fqTab||'col', body='', cnt='';
    if(t==='col'){
      var cs=tk.col.filter(function(c){ return hit(q,[c.n,c.hex,c.note]); });
      cnt=cs.length+' 个';
      body='<div class="fqsec-p">点色块复制色值。做 Figma 稿要绑样式，不要直接填色值 —— 样式 ID 在「Figma 样式」那一栏。</div>'
        +'<div class="swgrid">'+cs.map(function(c){
          return '<button class="swcell" onclick="copyTx(\''+c.hex+'\',\'色值\')">'+
            '<div class="swtop" style="background:'+c.hex+'"></div>'+
            '<div class="swbot"><div class="swn">'+esc(c.n)+'</div><div class="swh">'+esc(c.hex)+
            (c.note?' · '+esc(c.note):'')+'</div></div></button>';
        }).join('')+'</div>';
    } else if(t==='type'){
      cnt='';
      body='<div class="fqsec"><div class="fqsec-h">Web 端字号</div><div class="fqsec-p">'+esc(tk.fs.webNote)+'</div>'
        + tk.fs.web.map(function(n){ return '<div class="fsrow"><b>'+n+'px</b><span style="font-size:'+n+'px">飞鹊设计规范 Feique</span></div>'; }).join('')
        +'</div><div class="fqsec"><div class="fqsec-h">移动端字号</div><div class="fqsec-p">'+esc(tk.fs.mobNote)+'</div>'
        + tk.fs.mob.map(function(n){ return '<div class="fsrow"><b>'+n+'px</b><span style="font-size:'+n+'px">飞鹊设计规范 Feique</span></div>'; }).join('')
        +'</div><div class="fqsec"><div class="fqsec-h">间距</div><div class="fqsec-p">4px 阶梯。</div><div class="scale">'
        + tk.sp.map(function(n){ return '<div class="scitem"><div class="scbar" style="width:'+Math.max(n,2)+'px"></div><b>'+n+'</b></div>'; }).join('')
        +'</div></div><div class="fqsec"><div class="fqsec-h">圆角</div><div class="scale">'
        + tk.rd.map(function(n){ return '<div class="scitem"><div style="width:34px;height:34px;background:var(--soft);border:1px solid var(--line);border-radius:'+n+'px;margin:0 auto 8px"></div><b>'+n+'</b></div>'; }).join('')
        +'</div></div>';
    } else if(t==='sh'){
      cnt=tk.sh.length+' 级';
      body='<div class="fqsec-p">点 CSS 复制。三级都是三层叠加，纯黑，横向偏移一律 0。</div><div class="shgrid">'
        + tk.sh.map(function(s){
          return '<div class="shcell" style="box-shadow:'+s.css+'"><b>'+esc(s.lvl)+'</b><p>'+esc(s.mean)+'</p>'+
            '<code onclick="copyTx(\''+esc(s.css).replace(/'/g,"\\'")+'\',\'阴影 CSS\')">'+esc(s.css)+'</code></div>';
        }).join('')+'</div>';
    } else {
      var all=[].concat(
        tk.st.paint.map(function(r){ return ['颜色样式',r]; }),
        tk.st.text.map(function(r){ return ['文字样式',r]; }),
        tk.st.eff.map(function(r){ return ['效果样式',r]; }))
        .filter(function(p){ return hit(q,[p[1].n,p[1].hex,p[1].x]); });
      cnt=all.length+' 个';
      body='<div class="fqsec-p">这一层才是真正的设计变量。做 Figma 稿把这些 ID 交给 setFillStyleIdAsync / setTextStyleIdAsync，别硬写色值和字号。点 ID 复制。</div>'
        +'<table class="tbl"><thead><tr><th style="width:14%">类别</th><th style="width:26%">样式名</th>'
        +'<th style="width:14%">取值</th><th>样式 ID（点击复制）</th></tr></thead><tbody>'
        + all.map(function(p){
          var r=p[1];
          return '<tr><td class="dim">'+p[0]+'</td><td class="nm">'+esc(r.n)+'</td>'+
            '<td class="dim">'+(r.hex?(/^#/.test(r.hex)?'<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:'+r.hex+';margin-right:6px;vertical-align:-1px"></span>':'')+esc(r.hex):esc(r.x||'—'))+'</td>'+
            '<td><span class="mono" onclick="copyTx(\''+esc(r.id)+'\',\'样式 ID\')">'+esc(r.id||'—')+'</span></td></tr>';
        }).join('')+'</tbody></table>';
    }
    return bar('搜样式名或色值', cnt, tabs, t, 'fqTab') + body;
  }

  /* ── 交互经验库（自查表） ── */
  var CKKEY='wb.checked';
  function readCk(){ try{ return JSON.parse(localStorage.getItem(CKKEY)||'{}'); }catch(e){ return {}; } }
  function writeCk(o){ try{ localStorage.setItem(CKKEY, JSON.stringify(o)); }catch(e){} }
  window.ckToggle = function(id){
    var o=readCk(); if(o[id]) delete o[id]; else o[id]=1; writeCk(o);
    var host=document.getElementById('fqhost'); if(host) host.innerHTML=LIB_BODY[LIBS[S.lib].n]();
  };
  window.ckOpen = function(i){ S.ckOpen = (S.ckOpen===i? -1 : i);
    var host=document.getElementById('fqhost'); if(host) host.innerHTML=LIB_BODY[LIBS[S.lib].n](); };
  window.ckReset = function(){ writeCk({}); fqToast('已清空勾选记录');
    var host=document.getElementById('fqhost'); if(host) host.innerHTML=LIB_BODY[LIBS[S.lib].n](); };

  function viewChecklist(){
    var q=S.fqQ||'', ck=readCk(), open=(S.ckOpen==null?0:S.ckOpen);
    var groups=FQD.cl.map(function(g,gi){
      var items=g.items.map(function(it,ii){ return {it:it, id:gi+'-'+ii}; })
                       .filter(function(x){ return hit(q,[x.it.t,x.it.d,x.it.g]); });
      return {g:g, gi:gi, items:items};
    }).filter(function(x){ return x.items.length; });
    var total=0, done=0;
    FQD.cl.forEach(function(g,gi){ g.items.forEach(function(_,ii){ total++; if(ck[gi+'-'+ii]) done++; }); });
    var pct = total? Math.round(done*100/total) : 0;
    var head = bar('搜自查条目', (q? groups.reduce(function(a,x){return a+x.items.length;},0)+' 条命中' : M.cl+' 条'), null, null, 'fqTab')
      + '<div class="prog"><span class="fqcnt">已过 '+done+' / '+total+'</span>'
      + '<span class="progbar"><i style="width:'+pct+'%"></i></span>'
      + '<button class="fqtab" onclick="ckReset()">清空勾选</button></div>'
      + '<div class="fqsec-p">这份表有两个用法：交互稿做完了逐条自查；接需求时反过来当跟产品经理对话的清单，问到的答案直接填进 GSSM 设计目标表。勾选只存在你自己这台电脑的浏览器里。</div>';
    if(!groups.length) return head + '<div class="libempty"><b>没有匹配的条目。</b></div>';
    return head + groups.map(function(x){
      var gdone=x.items.filter(function(y){ return ck[y.id]; }).length;
      var isOpen = q? true : (open===x.gi);
      return '<div class="ckgrp"><button class="ckh'+(isOpen?' open':'')+'" onclick="ckOpen('+x.gi+')">'+
        '<b>'+esc(x.g.s)+'</b><i>'+gdone+' / '+x.items.length+'</i>'+svgOf('down-big',14)+'</button>'+
        (isOpen? '<div class="ckbody">'+x.items.map(function(y){
          var on=!!ck[y.id];
          return '<div class="ckrow"><button class="ckbox'+(on?' on':'')+'" onclick="ckToggle(\''+y.id+'\')" aria-label="标记已检查">'+
            (on?svgOf('yes2',11):'')+'</button>'+
            '<div class="cktx'+(on?' done':'')+'">'+esc(y.it.d)+
            (y.it.t&&y.it.t!==y.it.d? '<em>'+esc(y.it.t)+(y.it.g? ' · 对应 GSSM：'+esc(y.it.g):'')+'</em>':'')+
            '</div></div>';
        }).join('')+'</div>' : '')+'</div>';
    }).join('');
  }

  /* ── 共用：可折叠分组（长名单不平铺，否则一页两万像素滚不到底） ── */
  window.fqFold = function(i){ S.foldOpen = (S.foldOpen===i? -1 : i);
    var h=document.getElementById('fqhost'); if(h) h.innerHTML=LIB_BODY[LIBS[S.lib].n](); };

  function foldGroups(groups, forceOpen){
    var open = (S.foldOpen==null? -1 : S.foldOpen);
    return groups.map(function(g, i){
      var isOpen = forceOpen || open===i;
      return '<div class="ckgrp"><button class="ckh'+(isOpen?' open':'')+'" onclick="fqFold('+i+')">'+
        '<b>'+esc(g.t)+'</b><i>'+g.rows.length+' 份</i>'+svgOf('down-big',14)+'</button>'+
        (isOpen? '<div class="ckbody"><table class="kv">'+g.rows.map(function(f){
            return '<tr><td class="k">'+esc(f.n)+'</td><td class="v">'+
              (f.hi? '<span class="hot">'+(f.hi>1?'重点':'注意')+'</span>':'')+
              esc(f.d||'（这份没写摘要）')+'</td></tr>';
          }).join('')+'</table></div>' : '')+'</div>';
    }).join('');
  }

  /* ── 业务知识库（目录级） ── */
  function viewBiz(){
    var q=S.fqQ||'', lines=FQD.bl, used={}, groups=[];
    lines.forEach(function(pr){
      var re=new RegExp(pr[1],'i');
      var rows=FQD.bz.filter(function(f){ if(used[f.n]||!re.test(f.n)) return false; used[f.n]=1; return true; });
      if(rows.length) groups.push({t:pr[0], rows:rows});
    });
    var rest=FQD.bz.filter(function(f){ return !used[f.n]; });
    if(rest.length) groups.push({t:'跨业务与通用', rows:rest});
    if(q){
      groups = groups.map(function(g){ return {t:g.t, rows:g.rows.filter(function(f){ return hit(q,[f.n,f.d]); })}; })
                     .filter(function(g){ return g.rows.length; });
    }
    var shown=groups.reduce(function(a,g){ return a+g.rows.length; },0);
    return bar('搜业务线、模块或术语', (q? shown+' 份命中' : M.bz+' 份文档 · 分 '+groups.length+' 组'), null, null, 'fqTab')
      + '<div class="fqsec-p">这里是目录，不是正文。列出每条业务线现在有哪些文档、各自讲什么，让你知道 WorkBuddy 执行任务时能查到什么。'
      + '具体规则要看原始需求文档和 wiki，那才是会更新的正本。</div>'
      + (groups.length? foldGroups(groups, !!q) : '<div class="libempty"><b>没有匹配的文档。</b><br>换个关键词，或者清空搜索框看全部。</div>');
  }

  /* ── MIC 项目经验（方法论目录级） ── */
  var EXP_KIND=[['feedback-','做事方式与纠正过的判断'],['reference-','方法与参照资料'],
                ['project-','具体项目留下的经验'],['','其他']];
  function viewExp(){
    var q=S.fqQ||'', used={}, groups=[];
    EXP_KIND.forEach(function(pr){
      var rows=FQD.mr.filter(function(f){
        if(used[f.n]) return false;
        if(pr[0] && f.n.indexOf(pr[0])!==0) return false;
        used[f.n]=1; return true; });
      if(rows.length) groups.push({t:pr[1], rows:rows});
    });
    if(q){
      groups = groups.map(function(g){ return {t:g.t, rows:g.rows.filter(function(f){ return hit(q,[f.n,f.d]); })}; })
                     .filter(function(g){ return g.rows.length; });
    }
    var shown=groups.reduce(function(a,g){ return a+g.rows.length; },0);
    return bar('搜做法、判断或出过的问题', (q? shown+' 份命中' : M.mr+' 份 · 分 '+groups.length+' 组'), null, null, 'fqTab')
      + '<div class="fqsec-p">做过的项目留下来的判断：哪些做法有效、哪些地方出过问题、下次该怎么做。换一个项目仍然成立的才收进来。</div>'
      + (groups.length? foldGroups(groups, !!q) : '<div class="libempty"><b>没有匹配内容。</b><br>换个关键词，或者清空搜索框看全部。</div>');
  }

  /* ── 知识库更新提示卡：点「查看更新」之后收起 ──
     原来那个按钮只 go('libs')，提示一直挂着，下次打开还在 —— 等于按钮没意义。
     记住的是「批次」而不是「点过了」：用知识库生成日期的年月，
     所以下个月知识库真的更新了会再提示一次，而不是永久消失。 */
  (function(){
    var UKEY='wb.updSeen';
    var card=document.querySelector('.sb-card');
    if(!card) return;
    var id=String((FQD.m&&FQD.m.gen)||'').slice(0,7) || 'x';
    var seen='';
    try{ seen=localStorage.getItem(UKEY)||''; }catch(e){}
    if(seen===id){ card.hidden=true; return; }
    var btn=card.querySelector('.b');
    if(!btn) return;
    btn.removeAttribute('onclick');
    btn.addEventListener('click', function(e){
      e.stopPropagation();
      try{ localStorage.setItem(UKEY, id); }catch(e2){}
      card.hidden=true;
      go('libs');
      fqToast('已收起。下次知识库更新会再提示');
    });
  })();

  /* ── 挂上去 ── */
  var LIB_BODY = window.LIB_BODY = {
    '飞鹊组件库': viewComps,
    '视觉与交付规范': viewTokens,
    '交互经验库': viewChecklist,
    'MIC 业务知识库': viewBiz,
    'MIC 项目经验': viewExp
  };

  var origViewLib = viewLib;
  viewLib = function(){
    var l=LIBS[S.lib], f=LIB_BODY[l.n];
    if(!f) return origViewLib();
    return '<div class="page"><div class="ph"><h2>'+esc(l.n)+
      '<span class="tag" style="margin-left:10px;vertical-align:3px">已就绪</span></h2><p>'+esc(l.d)+'</p></div>'+
      '<div id="fqhost">'+f()+'</div></div>';
  };

  var origOpenLib = openLib;
  openLib = function(x){ S.fqQ=''; S.fqTab=null; S.ckOpen=null; S.foldOpen=null; origOpenLib(x); };
})();
'''


def splice(page, begin, end, payload, anchor, before=True):
    block = begin + '\n' + payload.strip() + '\n' + end
    if begin in page and end in page:
        a = page.index(begin); b = page.index(end) + len(end)
        return page[:a] + block + page[b:], '替换'
    if anchor not in page:
        print('❌ 找不到锚点：' + anchor); sys.exit(1)
    i = page.index(anchor)
    return (page[:i] + block + '\n' + page[i:], '插入') if before else \
           (page[:i+len(anchor)] + '\n' + block + page[i+len(anchor):], '插入')


def main():
    page = open(PAGE, encoding='utf-8').read()
    page, a1 = splice(page, CSS_B, CSS_E, CSS, '</style>', True)
    page, a2 = splice(page, JS_B, JS_E, JS, '</script>', True)
    open(PAGE, 'w', encoding='utf-8').write(page)
    print(f'CSS {a1} · JS {a2} · index.html 现 {os.path.getsize(PAGE)/1024:.0f} KB')


if __name__ == '__main__':
    main()
