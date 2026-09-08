#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把飞书登录的页面这一半注入 index.html（可重复运行，按标记替换）。

服务端那一半在 proxy/auth-core.js（换令牌要用 App Secret，只能在服务端做）。
这里只做四件事：接住回调带回来的令牌、存起来、把左下角换成真实身份、退出。

单一维护源：跟另外五个脚本一样，只替换自己那对标记之间的内容。

用法：python3 build/patch-auth.py
"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = os.path.join(os.path.dirname(HERE), 'index.html')

CSS_B, CSS_E = '/* ==WB-AUTH-CSS:BEGIN== */', '/* ==WB-AUTH-CSS:END== */'
JS_B,  JS_E  = '/* ==WB-AUTH-JS:BEGIN== */',  '/* ==WB-AUTH-JS:END== */'

CSS = r'''
/* ══════════ 飞书登录 ══════════ */
.sb-foot{cursor:default}
.sb-foot .ava,.qava{overflow:hidden;position:relative}
.sb-foot .ava img,.qava img{position:absolute;inset:0;width:100%;height:100%;
  border-radius:999px;display:block;object-fit:cover}
/* 未登录时左下角是一个可点的整行 */
.wblogin{display:flex;align-items:center;gap:9px;width:100%;padding:8px;border-radius:10px;text-align:left}
.wblogin:hover{background:#E9E9E9}
.wblogin .ico{width:28px;height:28px;flex:0 0 28px;border-radius:999px;background:var(--white);
  border:1px solid var(--line);display:grid;place-items:center;color:var(--ink-2)}
.wblogin .ico .fq{width:15px;height:15px}
.wblogin .t{font-size:13px;color:var(--ink)}
.wblogin .d{font-size:12px;color:var(--ink-3);margin-top:1px}
/* 已登录：名字右边一个退出 */
.wbout{margin-left:auto;font-size:12px;color:var(--ink-3);padding:4px 6px;border-radius:6px}
.wbout:hover{background:#E9E9E9;color:var(--ink-2)}
.sb-foot .n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
'''

JS = r'''
/* ══════════ 飞书登录 · 页面这一半 ══════════ */
(function(){
  var AUTH = 'https://eloquent-semifreddo-38ac62.netlify.app/auth';
  var LSK  = 'wb_session';

  /* 令牌是服务端用 HMAC 签过的，载荷是 base64 明文（不是加密）。
     🔴 页面这边只「读」不「信」—— 读出来是为了显示名字和头像，
     真正的校验在代理那边重新验签。前端改一改载荷只能骗到自己的界面。 */
  function decode(tok){
    try{
      var body = tok.split('.')[0].replace(/-/g,'+').replace(/_/g,'/');
      var p = JSON.parse(decodeURIComponent(escape(atob(body + '==='.slice((body.length + 3) % 4)))));
      if(!p || typeof p.e !== 'number' || Date.now() > p.e) return null;
      return p;
    }catch(e){ return null; }
  }
  function token(){ try{ return localStorage.getItem(LSK) || ''; }catch(e){ return ''; } }
  function save(t){ try{ localStorage.setItem(LSK, t); }catch(e){} }
  function clear(){ try{ localStorage.removeItem(LSK); }catch(e){} }

  /* 接住飞书回调带回来的令牌。
     令牌放在 # 后面是有意的：# 不会发给服务器、不进访问日志。
     读完立刻从地址栏抹掉，免得同事复制网址发给别人时把自己的会话一起发出去。 */
  var m = /[#&]wb=([^&]+)/.exec(location.hash || '');
  if(m){
    save(decodeURIComponent(m[1]));
    history.replaceState(null, '', location.pathname + location.search);
  }

  var USER = decode(token());
  if(token() && !USER) clear();          // 过期的就地清掉，别留个坏令牌反复解析

  window.wbUser  = function(){ return USER; };
  window.wbToken = function(){ return USER ? token() : ''; };
  window.wbLogin = function(){ location.href = AUTH + '/login'; };
  window.wbLogout = function(){ clear(); USER = null; location.reload(); };

  /* 头像：飞书给的是它自己图床的 https 地址。
     做法是「飞鹊图标垫在底下、真人头像盖在上面」，头像加载失败就把 img 自己删掉、
     露出下面的图标 —— 不留碎图框，也不用写兜底的拼接逻辑。
     referrerpolicy=no-referrer：不把我们的页面地址带给飞书图床。 */
  function avatar(px){
    var fb = window.fqIcon ? (fqIcon('personal-f', px) || '') : '';
    if(USER && USER.a)
      return fb + '<img src="' + esc(USER.a) + '" alt="" referrerpolicy="no-referrer" onerror="this.remove()">';
    return fb;
  }

  /* 左下角那一行：登录了显示真名，没登录显示「用飞书登录」 */
  function paintFoot(){
    var f = document.querySelector('.sb-foot');
    if(!f) return;
    if(USER){
      f.innerHTML =
        '<div class="ava">' + avatar(15) + '</div>' +
        '<div class="n" title="' + esc(USER.n) + '">' + esc(USER.n) + '</div>' +
        '<button class="wbout" onclick="wbLogout()">退出</button>';
    }else{
      f.innerHTML =
        '<button class="wblogin" onclick="wbLogin()">' +
        '<span class="ico">' + (window.fqIcon ? (fqIcon('personal-f', 15) || '') : '') + '</span>' +
        '<span><span class="t">用飞书登录</span>' +
        '<span class="d" style="display:block">登录后这里显示你的名字</span></span>' +
        '</button>';
    }
  }
  function esc(t){ return String(t == null ? '' : t).replace(/[&<>"]/g, function(c){
    return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]; }); }

  /* 提问那一行的小头像也换成真人的 */
  function paintQava(){
    if(!USER || !USER.a) return;
    var a = document.querySelectorAll('.qava');
    for(var i = 0; i < a.length; i++){
      if(a[i].getAttribute('data-wb') === '1') continue;
      a[i].innerHTML = '<img src="' + USER.a + '" alt="" referrerpolicy="no-referrer">';
      a[i].setAttribute('data-wb', '1');
    }
  }

  paintFoot();
  /* 左栏每次 renderNav 都会重画任务列表，但 .sb-foot 不在它的范围内，
     所以只在 render 之后补一次即可；回答区是流式写入的，用观察器盯着。 */
  if(typeof render === 'function'){
    var orig = render;
    render = window.render = function(){ orig(); paintFoot(); paintQava(); };
  }
  var mainEl = document.getElementById('main');
  if(mainEl && window.MutationObserver){
    var pend = false;
    new MutationObserver(function(){
      if(pend) return; pend = true;
      requestAnimationFrame(function(){ pend = false; paintQava(); });
    }).observe(mainEl, { childList:true, subtree:true });
  }
  paintQava();
})();
'''


def block(page, begin, end, body, anchor, last=False):
    """替换标记之间的内容；没有标记就插到 anchor 之前。

    🔴 last=True 用「最后一个」anchor。页面 head 里有一段挂 manifest 的内联脚本，
    直接找第一个 </script> 会把代码插进 head —— 那里 S / render / fqIcon 都还不存在。
    """
    new = begin + '\n' + body.strip() + '\n' + end
    if begin in page and end in page:
        a = page.index(begin); b = page.index(end) + len(end)
        return page[:a] + new + page[b:]
    if anchor not in page:
        sys.exit('找不到插入位置：' + anchor)
    i = page.rindex(anchor) if last else page.index(anchor)
    return page[:i] + new + '\n' + page[i:]


def main():
    page = open(PAGE, encoding='utf-8').read()
    before = len(page)
    # CSS 放在移动端层之前（移动端层必须是最后一段，它靠「后来者胜」覆盖前面所有区）
    page = block(page, CSS_B, CSS_E, CSS, '/* ==WB-M-CSS:BEGIN== */')
    page = block(page, JS_B, JS_E, JS, '</script>', last=True)
    open(PAGE, 'w', encoding='utf-8').write(page)
    print('飞书登录（页面这一半）已注入')
    print('  CSS %d 字符 · JS %d 字符 · %d → %d' % (len(CSS), len(JS), before, len(page)))


if __name__ == '__main__':
    main()
