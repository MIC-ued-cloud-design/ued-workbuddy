#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把「选择工作空间」从假按钮做成真功能，注入 index.html（可重复运行，按标记替换）。

形态照腾讯 WorkBuddy 的「选择工作空间」：搜索框 + 列表 + 分隔线 + 新建。
但不止做外壳 —— 选了要真的产生效果，否则只是把假按钮做得更精致：
  选工作空间 → 这次任务记上它 → 「工作空间」页看得到、点得开那条任务。

项目存在浏览器里（跟任务历史同一个地方）。等飞书登录接上服务端存储之后，
这部分可以整体搬到按人存，界面不用改。

用法：python3 build/patch-project.py
"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = os.path.join(os.path.dirname(HERE), 'index.html')

CSS_B, CSS_E = '/* ==WB-PROJ-CSS:BEGIN== */', '/* ==WB-PROJ-CSS:END== */'
JS_B,  JS_E  = '/* ==WB-PROJ-JS:BEGIN== */',  '/* ==WB-PROJ-JS:END== */'

CSS = r'''
/* ══════════ 选择工作空间 ══════════ */
.pjw{position:relative}
.cfoot .pjb.on{color:var(--accent-ink);background:var(--accent-fill)}
.cfoot .pjb.on .fq{color:var(--accent-ink)}
/* 下拉：照 + 菜单那套（.ppop），宽一点，因为项目名比菜单项长 */
.pjpop{position:absolute;bottom:calc(100% + 8px);left:0;width:268px;background:var(--glass);
  -webkit-backdrop-filter:var(--blur);backdrop-filter:var(--blur);
  border:1px solid var(--glass-line);border-radius:var(--box-r);box-shadow:var(--sh-2);
  padding:6px;z-index:30}
.pjsr{display:flex;align-items:center;gap:8px;margin:2px 2px 6px;padding:8px 10px;border-radius:var(--ctl-r);
  background:rgba(0,0,0,.05)}
.pjsr .fq{width:14px;height:14px;color:var(--ink-3);flex:0 0 14px}
.pjsr input{flex:1;min-width:0;border:0;outline:0;background:none;font:12.5px/1 inherit;color:var(--ink)}
.pjsr input::placeholder{color:var(--ink-3)}
.pjlist{max-height:212px;overflow-y:auto}
.pjrow{display:flex;align-items:center;gap:9px;width:100%;padding:8px;border-radius:var(--ctl-r);text-align:left}
.pjrow:hover{background:rgba(0,0,0,.05)}
.pjrow.on{background:var(--accent-fill);color:var(--accent-ink)}
.pjrow .fq{width:15px;height:15px;color:var(--ink-2);flex:0 0 15px}
.pjrow .n{flex:1;min-width:0;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pjempty{padding:14px 10px;text-align:center;font-size:12.5px;color:var(--ink-3);line-height:1.7}
.pjhr{height:1px;background:var(--line-2);margin:5px 2px}
.pjnew{display:flex;align-items:center;gap:9px;width:100%;padding:9px 8px;border-radius:var(--ctl-r);
  text-align:left;font-size:13px;color:var(--ink)}
.pjnew:hover{background:rgba(0,0,0,.05)}
.pjnew .fq{width:15px;height:15px;color:var(--ink-2);flex:0 0 15px}
.pjnew b{font-weight:600}

/* 「工作空间」页 */
.prow.on{border-color:var(--accent-line);background:var(--accent-fill)}
.pjtag{font-size:12px;color:var(--ink-3);background:var(--soft-2);border-radius:var(--r-xs);padding:2px 7px;margin-left:8px;
  font-weight:400;vertical-align:2px}
.pjdel{margin-left:12px;font-size:12px;color:var(--ink-3);padding:4px 8px;border-radius:var(--ctl-r)}
.pjdel:hover{background:var(--soft-2);color:var(--ink-2)}
'''

JS = r'''
/* ══════════ 选择工作空间 · 从假按钮做成真功能 ══════════ */
(function(){
  var LSK = 'wb_projects';

  function load(){
    try{ var a = JSON.parse(localStorage.getItem(LSK) || '[]'); return Array.isArray(a) ? a : []; }
    catch(e){ return []; }
  }
  function save(a){ try{ localStorage.setItem(LSK, JSON.stringify(a)); }catch(e){} }
  function esc(t){ return String(t == null ? '' : t).replace(/[&<>"]/g, function(c){
    return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]; }); }
  function icon(n, px){ return window.fqIcon ? (fqIcon(n, px || 15) || '') : ''; }

  window.wbProjects = load;

  /* ── 下拉 ── */
  window.wbPjToggle = function(e){
    if(e) e.stopPropagation();
    S.pjopen = !S.pjopen; S.mopen = false; S.popen = false; S.pjq = '';
    render();
    if(S.pjopen){ var i = document.getElementById('pjq'); if(i) i.focus(); }
  };
  window.wbPjSearch = function(el){
    S.pjq = el.value;
    /* 只重画列表，不走整页 render —— 整页重画会把输入框连同焦点和光标位置一起换掉，
       打第二个字就得重新点一次输入框。 */
    var box = document.getElementById('pjlist');
    if(box) box.innerHTML = listHtml();
    var nb = document.getElementById('pjnew');
    if(nb) nb.innerHTML = newHtml();
  };
  window.wbPjPick = function(name){
    S.proj = (S.proj === name) ? '' : name;
    S.pjopen = false; render();
  };
  window.wbPjNew = function(){
    var name = (S.pjq || '').trim();
    if(!name){ var i = document.getElementById('pjq'); if(i){ i.focus(); i.placeholder = '先输入名字'; } return; }
    var a = load();
    for(var i2 = 0; i2 < a.length; i2++) if(a[i2].n === name){ wbPjPick(name); return; }
    a.unshift({ n:name, t:Date.now() });
    save(a);
    S.proj = name; S.pjopen = false; render();
    if(window.fqToast) fqToast('已新建工作空间「' + name + '」');
  };
  window.wbPjDel = function(name, e){
    if(e) e.stopPropagation();
    var msg = '确定删掉工作空间「' + name + '」？';
    if(!confirm(msg)) return;
    save(load().filter(function(p){ return p.n !== name; }));
    if(S.proj === name) S.proj = '';
    render();
  };

  function listHtml(){
    var q = (S.pjq || '').trim().toLowerCase();
    var a = load().filter(function(p){ return !q || p.n.toLowerCase().indexOf(q) >= 0; });
    if(!a.length)
      return '<div class="pjempty">' + (q ? '未找到工作空间' : '还没有工作空间<br>在上面输入名字新建一个') + '</div>';
    return a.map(function(p){
      return '<button class="pjrow' + (S.proj === p.n ? ' on' : '') + '" onclick="wbPjPick(\'' +
        esc(p.n).replace(/'/g, "\\'") + '\')">' + icon('folder') +
        '<span class="n">' + esc(p.n) + '</span></button>';
    }).join('');
  }
  function newHtml(){
    var q = (S.pjq || '').trim();
    return icon('add') + (q ? '<span>新建「<b>' + esc(q) + '</b>」</span>' : '<span>新建工作空间</span>');
  }

  /* ── 把 .cfoot 里那个假按钮换掉 ──
     没有去改 viewNew 的模板（它在手工维护的那半，改了跟这个脚本就成了两个维护源），
     而是在每次渲染之后替换掉它。 */
  function paintFoot(){
    if(S.view !== 'new') return;
    var foot = document.querySelector('.cfoot');
    if(!foot) return;
    var btn = foot.children[0];
    if(!btn || btn.getAttribute('data-pj') === '1') return;
    var w = document.createElement('div');
    w.className = 'pjw';
    w.innerHTML =
      '<button class="pjb' + (S.proj ? ' on' : '') + '" data-pj="1" onclick="wbPjToggle(event)">' +
        icon('folder', 16) + '<span>' + (S.proj ? esc(S.proj) : '选择工作空间') + '</span>' + icon('down', 16) +
      '</button>' +
      (S.pjopen ?
        '<div class="pjpop">' +
          '<div class="pjsr">' + icon('search', 14) +
            '<input id="pjq" placeholder="搜索工作空间" oninput="wbPjSearch(this)" ' +
            'onclick="event.stopPropagation()" autocomplete="off"></div>' +
          '<div class="pjlist" id="pjlist">' + listHtml() + '</div>' +
          '<div class="pjhr"></div>' +
          '<button class="pjnew" id="pjnew" onclick="wbPjNew()">' + newHtml() + '</button>' +
        '</div>' : '');
    btn.replaceWith(w);
  }

  /* ── 「工作空间」页：自建的排前面，预置的三个标成示例 ── */
  if(typeof viewProjects === 'function'){
    var origProjects = viewProjects;
    viewProjects = window.viewProjects = function(){
      var mine = load();
      var head = '<div class="page">' +
        '<div class="ph"><h2>工作空间</h2>' +
        '<p>一个需求从调研到复盘的产出物都收在这里，继续上次的进度不用重新说明背景。</p></div>';

      var body = mine.length ? mine.map(function(p){
        return '<div class="prow' + (S.proj === p.n ? ' on' : '') + '">' +
            '<div><div class="nm">' + esc(p.n) + '</div>' +
            '<div class="m">' + (S.proj === p.n ? '当前选中' : '在输入框下方「选择工作空间」里可以选它') + '</div></div>' +
            '<span class="pjdel" onclick="wbPjDel(\'' + esc(p.n).replace(/'/g, "\\'") + '\',event)">删除</span>' +
          '</div>';
      }).join('') :
        '<div class="libempty"><b>还没有工作空间。</b><br>' +
        '回到新建任务页，在输入框下面的「选择工作空间」里输入名字就能建一个。</div>';

      /* 预置那三个保留，但明确标成示例，也不进「选择工作空间」的下拉 ——
         真的和示例混在一起选，任务就会归到一个假空间上。 */
      var demo = '<div class="grp" style="margin-top:30px">' +
        '<div class="grp-t">示例（预置内容，不参与归属）</div>' +
        PROJECTS.map(function(p){
          return '<div class="prow" style="cursor:default">' +
            '<div><div class="nm">' + esc(p.n) + '<span class="pjtag">示例</span></div>' +
            '<div class="m">' + p.out + ' 项产出 · 负责人 ' + esc(p.mem) + '</div>' +
            '<div class="bar">' + [1,2,3,4,5].map(function(i){
              return '<i class="' + (i <= p.stage ? 'd' : '') + '"></i>'; }).join('') + '</div></div>' +
            '<div class="st"><div class="s">' + STAGE_NAMES[p.stage] + '</div>' +
            '<div class="u">' + esc(p.upd) + '</div></div></div>';
        }).join('') + '</div>';

      return head + body + demo + '</div>';
    };
  }

  /* 点空白关掉下拉，跟页面里另外两个浮层一个行为 */
  document.addEventListener('click', function(e){
    if(S.pjopen && !(e.target.closest && e.target.closest('.pjw'))){ S.pjopen = false; render(); }
  });

  if(typeof render === 'function'){
    var orig = render;
    render = window.render = function(){ orig(); paintFoot(); };
  }
  paintFoot();
})();
'''


def block(page, begin, end, body, anchor, last=False):
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
    # CSS 放在移动端层之前（移动端层必须是最后一段，靠「后来者胜」覆盖前面所有区）
    page = block(page, CSS_B, CSS_E, CSS, '/* ==WB-M-CSS:BEGIN== */')
    # JS 放最后：要包在 patch-ai 重载过的 render / viewProjects 外面
    page = block(page, JS_B, JS_E, JS, '</script>', last=True)
    open(PAGE, 'w', encoding='utf-8').write(page)
    print('「归到项目」已注入')
    print('  CSS %d 字符 · JS %d 字符 · %d → %d' % (len(CSS), len(JS), before, len(page)))


if __name__ == '__main__':
    main()
