'use strict';
/**
 * 飞鹊组件清册 —— 给编辑态「组件」面板用的可拖砖。
 *
 * 两类来源，都读随包的 packs/feique：
 *   ① 页面级片段 docs/blocks/*.html：注释 + <style> + 结构原样，SLOT 注释在这里就换成 brand/ 下的真 SVG
 *      （片段文件里写的规矩：「SLOT 位置必须换成真图，留着不换＝残缺交付」，所以拖进去的一律是换好的）。
 *   ② 原子控件：docs/css/<类>.css 是飞鹊给的真 CSS，HTML 结构在这里按那份 CSS 的类名写成样板。
 *      样板里{{text}} / {{href}} / {{src}}是占位，替换元素时用原元素的文字、链接、图片填进去（吉吉 2026-09-16 定：直接保留）。
 *
 * 每砖一个 styleId：拖进页面时把它的 CSS 以 <style data-feique="styleId"> 注进 <head>，一类只注一次，
 * 页面仍是单文件、能离线交付。_reset.css 随第一块控件一起注（INDEX.md 规矩①）。
 */
const fs = require('fs');
const path = require('path');

const BLOCKS = {
  'product-card-grid.html': { name: '主搜产品卡 · 网格', size: '350×585', keep: ['src', 'href'] },
  'product-card-list.html': { name: '主搜产品卡 · 列表', size: '1167×323', keep: ['src', 'href'] },
  'product-card-qp-grid.html': { name: 'QP产品卡 · 网格', size: '324×560', keep: ['src', 'href'] },
  'product-card-qp-list.html': { name: 'QP产品卡 · 列表', size: '1518×320', keep: ['src', 'href'] },
  'product-card-lv-grid.html': { name: 'LV产品卡 · 网格', size: '300×554', keep: ['src', 'href'] },
  'product-card-lv-list.html': { name: 'LV产品卡 · 列表', size: '1520×281', keep: ['src', 'href'] },
  'product-card-compare.html': { name: '简化产品卡 · 对比/推荐位', size: '253×367', keep: ['src', 'href'] },
  'mic-footer-product.html': { name: 'MIC页脚 · 产品详情页', size: '自适应 · 高205', keep: [] },
  'mic-footer-search.html': { name: 'MIC页脚 · 搜索结果页', size: '自适应 · 高280', keep: [] },
  'vo-header.html': { name: 'VO后台顶栏', size: '1600×85', keep: [] },
  'vo-nav.html': { name: 'VO后台二级导航', size: '1600×40', keep: [] },
  'vo-sider.html': { name: 'VO后台左侧栏', size: '210×782', keep: [] },
};

/* 原子控件样板。css＝docs/css 里要带的文件；variants＝右侧面板「组件属性」能切的档，同一组里互斥。 */
function controls(icon) {
  const I = n => icon(n);   // 内嵌真图标，fill 换成 currentColor 跟着文字色走
  return [
    { id: 'btn-primary', group: 'control', family: 'btn', name: '按钮 · 主按钮', desc: '全页只一个红主按钮', css: ['btn'], keep: ['text', 'href'],
      html: '<a class="btn btn-md btn-primary" href="{{href}}">{{text|Send Inquiry}}</a>' },
    { id: 'btn-secondary', group: 'control', family: 'btn', name: '按钮 · 次按钮', css: ['btn'], keep: ['text', 'href'],
      html: '<a class="btn btn-md btn-secondary" href="{{href}}">{{text|Chat Now}}</a>' },
    { id: 'btn-text', group: 'control', family: 'btn', name: '按钮 · 文字按钮', css: ['btn'], keep: ['text', 'href'],
      html: '<a class="btn btn-md btn-text" href="{{href}}">{{text|View More}}</a>' },
    { id: 'inp', group: 'control', family: 'inp', name: '输入框', css: ['inp'], keep: [],
      html: '<div class="inp"><div class="inp-body"><input type="text" placeholder="{{text|Please enter}}"></div></div>' },
    { id: 'inp-search', group: 'control', family: 'inp', name: '搜索框', desc: '带红色搜索按钮', css: ['inp'], keep: [],
      html: '<div class="inp"><div class="inp-search-body"><input type="text" placeholder="{{text|What are you looking for?}}"></div><div class="inp-search-btn-primary">' + I('search') + '</div></div>' },
    { id: 'tag-line', group: 'control', family: 'tag', name: '标签 · 描边', css: ['tag'], keep: ['text'],
      html: '<span class="tag tag-line-blue">{{text|Tag}}</span>' },
    { id: 'tag-areal', group: 'control', family: 'tag', name: '标签 · 填充', css: ['tag'], keep: ['text'],
      html: '<span class="tag tag-areal-lightred">{{text|Hot}}</span>' },
    { id: 'bdg', group: 'control', family: 'bdg', name: '徽标 · 数字', css: ['bdg'], keep: ['text'],
      html: '<span class="bdg">{{text|8}}</span>' },
    { id: 'bdg-status', group: 'control', family: 'bdg', name: '徽标 · 状态点', css: ['bdg'], keep: ['text'],
      html: '<span class="bdg-status bdg-status-success">{{text|Online}}</span>' },
    { id: 'tab', group: 'control', family: 'tab', name: '标签页Tabs', desc: '选中态是下划线', css: ['tab'], keep: [],
      html: '<div class="tab">\n  <div class="tab-item active">Products</div>\n  <div class="tab-item">Suppliers</div>\n  <div class="tab-item">Reviews</div>\n</div>' },
    { id: 'pg', group: 'control', family: 'pg', name: '分页', css: ['pg'], keep: [],
      html: '<div class="pg">\n  <button class="pg-arrow pg-disabled" type="button">' + I('left') + '</button>\n  <span class="pg-item pg-active">1</span><span class="pg-item">2</span><span class="pg-item">3</span><span class="pg-more">···</span><span class="pg-item">20</span>\n  <button class="pg-arrow" type="button">' + I('right') + '</button>\n</div>' },
    { id: 'alert-sm', group: 'control', family: 'alert', name: '提示条 · 单行', desc: '里面不放按钮，动作用文字链', css: ['alert'], keep: ['text'],
      html: '<div class="alert alert-sm alert-info"><span class="alert-icon">' + I('info-f') + '</span><div class="alert-body"><span class="alert-msg">{{text|Your inquiry has been sent to the supplier.}}</span></div></div>' },
    { id: 'alert-lg', group: 'control', family: 'alert', name: '提示条 · 带标题', css: ['alert'], keep: ['text'],
      html: '<div class="alert alert-lg alert-warning">\n  <div class="alert-body">\n    <div class="alert-header"><span class="alert-icon">' + I('error-f') + '</span><span class="alert-title">{{text|Please verify your email}}</span></div>\n    <div class="alert-desc"><span class="alert-msg">We could not deliver messages to your inbox. Update your email to keep receiving quotations.</span><span class="alert-link">Update</span></div>\n  </div>\n</div>' },
    { id: 'sw', group: 'control', family: 'sw', name: '开关', css: ['sw'], keep: [],
      html: '<label class="sw"><input type="checkbox" checked><span class="sw-handle"></span></label>' },
    /* ── 第二批（2026-09-16 吉吉：把所有飞鹊组件都做进来）── */
    { id: 'brd', group: 'control', family: 'brd', name: '面包屑', css: ['brd'], keep: [],
      html: '<nav class="brd"><a class="brd-item" href="#">Home</a><span class="brd-sep">' + I('right') + '</span><a class="brd-item" href="#">Products</a><span class="brd-sep">' + I('right') + '</span><span class="brd-item-cur">{{text|Solar Panel}}</span></nav>' },
    { id: 'cb', group: 'control', family: 'cb', name: '复选框', desc: '勾是飞鹊yes2图标', css: ['cb'], keep: ['text'],
      html: '<label class="cb"><input type="checkbox" checked><span class="cb-box">' + icon('yes2', 'cb-icon-chk', '#fff') + '<svg class="cb-icon-half" width="8" height="2" viewBox="0 0 8 2"><rect width="8" height="2" rx="1" fill="#fff"/></svg></span><span class="cb-label">{{text|Option}}</span></label>' },
    { id: 'rd', group: 'control', family: 'rd', name: '单选框', css: ['rd'], keep: ['text'],
      html: '<label class="rd"><input type="radio" name="rd" checked><span class="rd-circle"></span><span class="rd-label">{{text|Option}}</span></label>' },
    { id: 'ss', group: 'control', family: 'ss', name: '按钮式选择器', desc: '买家端常用，长得像按钮不是圆点', css: ['ss'], keep: ['text'],
      html: '<label class="ss"><input type="radio" name="ss" checked>{{text|Option}}</label>' },
    { id: 'sel', group: 'control', family: 'sel', name: '下拉选择器', desc: '点触发器展开', css: ['sel'], keep: [],
      html: '<div class="sel-demo-wrap"><div class="sel"><span class="sel-text">{{text|Please select}}</span><span class="sel-chev">' + I('arrow-down') + '</span></div><ul class="sel-menu"><li class="sel-menu-item">Option A</li><li class="sel-menu-item">Option B</li><li class="sel-menu-item">Option C</li></ul></div>' },
    { id: 'inp-num', group: 'control', family: 'inp-num', name: '数字输入框', css: ['inpn'], keep: [],
      /* 飞鹊 295 个图标里没有「减号」（reduce3 是收缩箭头、narrow 是放大镜），减号是一根横线这种原语，不算自己画图标 */
      html: '<div class="inp-num"><button class="inp-num-btn" type="button" data-step="-1"><span class="inp-num-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 7.5h10v1H3z" fill="currentColor"/></svg></span></button><div class="inp-num-f"><input type="text" value="1"></div><button class="inp-num-btn" type="button" data-step="1"><span class="inp-num-icon">' + I('add') + '</span></button></div>' },
    { id: 'ta', group: 'control', family: 'ta', name: '文本域', css: ['ta'], keep: [],
      html: '<div class="ta"><textarea class="ta-input" placeholder="{{text|Please enter}}" maxlength="200"></textarea><div class="ta-footer"><span class="ta-count">0/200</span></div></div>' },
    { id: 'lst', group: 'control', family: 'lst', name: '列表', css: ['lst'], keep: [],
      html: '<div class="lst">\n  <div class="lst-item"><div class="lst-text"><div class="lst-title">Item one</div></div><span class="lst-meta">Detail</span><span class="lst-arrow">' + I('right') + '</span></div>\n  <div class="lst-item"><div class="lst-text"><div class="lst-title">Item two</div></div><span class="lst-meta">Detail</span><span class="lst-arrow">' + I('right') + '</span></div>\n  <div class="lst-item"><div class="lst-text"><div class="lst-title">Item three</div></div><span class="lst-meta">Detail</span><span class="lst-arrow">' + I('right') + '</span></div>\n</div>' },
    { id: 'msg', group: 'control', family: 'msg', name: '全局提示Message', desc: '顶部飘出那种', css: ['msg', 'shadow'], keep: ['text'],
      html: '<div class="msg msg-success shadow-2"><span class="msg-icon">' + I('yes-f') + '</span>{{text|Saved successfully}}</div>' },
    { id: 'spin', group: 'control', family: 'spin', name: '加载Spin', css: ['spin'], keep: [],
      html: '<span class="spin spin-md spin-red">' + I('Loading') + '</span>' },
    { id: 'stp', group: 'control', family: 'stp', name: '步骤条', desc: '下单流程 / 多步表单', css: ['stp', 'spin'], keep: [],
      html: '<div class="stp">\n  <div class="stp-item stp-done"><div class="stp-head"><span class="stp-node">' + I('yes2') + '</span><span class="stp-label">Details</span><span class="stp-tail"></span></div><div class="stp-body"><div class="stp-desc">Done</div></div></div>\n  <div class="stp-item stp-cur"><div class="stp-head"><span class="stp-node">2</span><span class="stp-label">Quotation</span><span class="stp-tail"></span></div><div class="stp-body"><div class="stp-desc">In progress</div></div></div>\n  <div class="stp-item"><div class="stp-head"><span class="stp-node">3</span><span class="stp-label">Confirm</span><span class="stp-tail"></span></div><div class="stp-body"><div class="stp-desc">Waiting</div></div></div>\n</div>' },
    { id: 'tip', group: 'control', family: 'tip', name: '气泡提示Tooltip', css: ['tip'], keep: ['text'],
      html: '<div class="tip tip-dark"><div class="tip-body">{{text|Tooltip text}}</div><div class="tip-arrow tip-arrow-tb tip-arrow-dn"></div></div>' },
    { id: 'upl-btn', group: 'control', family: 'upl-btn', name: '上传 · 按钮式', css: ['upl'], keep: ['text'],
      html: '<span class="upl-btn">' + I('upload') + '{{text|Upload file}}</span>' },
    { id: 'upl-dnd', group: 'control', family: 'upl-dnd', name: '上传 · 拖拽区', css: ['upl'], keep: ['text'],
      html: '<div class="upl-dnd"><span class="upl-dnd-icon">' + icon('upload', '', null, 48) + '</span><div class="upl-dnd-primary">{{text|Click or drag files here}}</div><div class="upl-dnd-secondary">PNG / JPG / PDF, up to 10 MB</div></div>' },
    { id: 'empty', group: 'control', family: 'empty', name: '缺省图Empty', desc: '空状态；插图位别自己画', css: ['empty'], keep: ['text'],
      html: '<div class="empty"><div class="empty-img">' + icon('picture', '', '#CED3D9', 64) + '</div><div class="empty-title">{{text|No results found}}</div><div class="empty-desc">Try another keyword or clear the filters.</div></div>' },
    { id: 'skel', group: 'control', family: 'skel-card', name: '骨架屏 · 卡片', css: ['skel'], keep: [],
      html: '<div class="skel-card"><div class="skel-bone skel-image"></div><div class="skel-card-body"><div class="skel-bone skel-line skel-w-75"></div><div class="skel-paragraph"><div class="skel-bone skel-line skel-w-full"></div><div class="skel-bone skel-line skel-w-full"></div><div class="skel-bone skel-line skel-w-61"></div></div></div></div>' },
    { id: 'clps', group: 'control', family: 'clps', name: '折叠面板Collapse', css: ['skel'], keep: [],
      html: '<div class="clps">\n  <div class="clps-item is-open"><div class="clps-hd"><span class="clps-arrow">' + I('down-big') + '</span><span class="clps-title">Product details</span></div><div class="clps-bd"><div class="clps-content">Material, size, packaging and lead time.</div></div></div>\n  <div class="clps-item"><div class="clps-hd"><span class="clps-arrow">' + I('down-big') + '</span><span class="clps-title">Shipping</span></div><div class="clps-bd"><div class="clps-content">Ships within 7 days.</div></div></div>\n</div>' },
    { id: 'stat', group: 'control', family: 'stat', name: '统计数值Statistic', css: ['skel'], keep: [],
      html: '<div class="stat"><div class="stat-title">Inquiries</div><div class="stat-row stat-row-baseline"><span class="stat-value">1,286</span><span class="stat-suffix">/ month</span></div><div class="stat-trend"><span class="stat-trend-up">+12.5%</span></div></div>' },
    { id: 'dw', group: 'control', family: 'dw', name: '抽屉Drawer', desc: '静态预览版，480高', css: ['dw', 'btn'], keep: ['text'],
      html: '<div class="dw-preview"><div class="dw"><div class="dw-hd"><span class="dw-hd-title">{{text|Drawer title}}</span><span class="dw-hd-close">' + I('X') + '</span></div><div class="dw-div"></div><div class="dw-body">Drawer content.</div><div class="dw-div"></div><div class="dw-ft"><a class="btn btn-md btn-secondary" href="#">Cancel</a><a class="btn btn-md btn-primary" href="#">Confirm</a></div></div></div>' },
  ];
}

/* 「组件属性」：识别到元素带哪个基类，就给哪几组互斥类名。renderer 只做展示，改类名走 op:class。 */
const VARIANTS = {
  btn: { base: 'btn', dims: [
    { label: '样式', options: [['btn-primary', '主 · 红'], ['btn-primary-blue', '主 · 蓝'], ['btn-primary-dark', '主 · 深'], ['btn-secondary', '次 · 黑边'], ['btn-secondary-blue', '次 · 蓝边'], ['btn-secondary-dark', '次 · 灰'], ['btn-dashed', '虚线'], ['btn-dashed-blue', '虚线 · 蓝'], ['btn-text', '文字'], ['btn-link', '链接']] },
    { label: '尺寸', options: [['btn-lg', '大40'], ['btn-md', '中32'], ['btn-sm', '小24']] },
    { label: '形状', options: [['', '直角'], ['btn-round', '胶囊']] },
  ] },
  tag: { base: 'tag', dims: [
    { label: '样式', options: [['tag-line-red', '描边红'], ['tag-line-orange', '描边橙'], ['tag-line-blue', '描边蓝'], ['tag-line-green', '描边绿'], ['tag-line-darkgray', '描边灰'], ['tag-line-lightgray', '描边浅灰'], ['tag-areal-red', '填充红'], ['tag-areal-orange', '填充橙'], ['tag-areal-blue', '填充蓝'], ['tag-areal-green', '填充绿'], ['tag-areal-lightred', '浅红底'], ['tag-areal-lightorange', '浅橙底'], ['tag-areal-lightblue', '浅蓝底'], ['tag-areal-lightgreen', '浅绿底']] },
  ] },
  'bdg-status': { base: 'bdg-status', dims: [{ label: '状态', options: [['', '默认灰'], ['bdg-status-success', '成功'], ['bdg-status-processing', '进行中'], ['bdg-status-warning', '警告'], ['bdg-status-error', '错误']] }] },
  alert: { base: 'alert', dims: [
    { label: '类型', options: [['alert-info', '信息'], ['alert-success', '成功'], ['alert-warning', '警告'], ['alert-error', '错误']] },
    { label: '描边', options: [['', '有'], ['alert-noborder', '无']] },
  ] },
  tab: { base: 'tab', dims: [
    { label: '颜色', options: [['', '黑线'], ['tab-red', '红线']] },
    { label: '尺寸', options: [['tab-sm', '小'], ['', '中'], ['tab-lg', '大']] },
    { label: '样式', options: [['', '下划线'], ['tab-card', '卡片']] },
  ] },
  sw: { base: 'sw', dims: [
    { label: '状态', options: [['', '关'], ['sw-on', '开']] },
    { label: '尺寸', options: [['', '默认44'], ['sw-sm', '小28']] },
  ] },
  inp: { base: 'inp', dims: [
    { label: '尺寸', options: [['inp-sm', '小'], ['', '中'], ['inp-lg', '大']] },
    { label: '状态', options: [['', '默认'], ['inp-error', '错误'], ['inp-warning', '警告'], ['inp-success', '成功'], ['inp-disabled', '禁用']] },
  ] },
  pg: { base: 'pg', dims: [{ label: '尺寸', options: [['', '默认32'], ['pg-sm', '小24']] }] },
  brd: { base: 'brd', dims: [{ label: '尺寸', options: [['', '默认'], ['brd-sm', '小']] }, { label: '主题', options: [['', '浅底'], ['brd-dark', '深底']] }] },
  cb: { base: 'cb', dims: [{ label: '颜色', options: [['', '黑'], ['cb-blue', '蓝'], ['cb-red', '红']] }, { label: '状态', options: [['', '未选'], ['cb-sel', '选中'], ['cb-half', '半选'], ['cb-dis', '禁用']] }, { label: '尺寸', options: [['', '16'], ['cb-sm', '14']] }] },
  rd: { base: 'rd', dims: [{ label: '颜色', options: [['', '黑'], ['rd-blue', '蓝'], ['rd-red', '红']] }, { label: '状态', options: [['', '未选'], ['rd-sel', '选中'], ['rd-dis', '禁用']] }, { label: '尺寸', options: [['', '16'], ['rd-sm', '12']] }] },
  ss: { base: 'ss', dims: [{ label: '主题', options: [['', '黑'], ['ss-red', '红'], ['ss-blue', '蓝']] }, { label: '状态', options: [['', '未选'], ['ss-sel', '选中'], ['ss-dis', '禁用']] }, { label: '形状', options: [['', '直角'], ['ss-round', '胶囊']] }, { label: '尺寸', options: [['', '32'], ['ss-sm', '28']] }] },
  sel: { base: 'sel', dims: [{ label: '尺寸', options: [['sel-sm', '小'], ['', '中'], ['sel-lg', '大']] }, { label: '状态', options: [['', '默认'], ['sel-error', '错误'], ['sel-warning', '警告'], ['sel-disabled', '禁用']] }] },
  'inp-num': { base: 'inp-num', dims: [{ label: '尺寸', options: [['inp-num-sm', '小'], ['', '中'], ['inp-num-lg', '大']] }, { label: '状态', options: [['', '默认'], ['inp-num-err', '错误'], ['inp-num-dis', '禁用']] }] },
  ta: { base: 'ta', dims: [{ label: '尺寸', options: [['ta-sm', '小'], ['', '中'], ['ta-lg', '大']] }, { label: '状态', options: [['', '默认'], ['ta-error', '错误'], ['ta-disabled', '禁用']] }] },
  msg: { base: 'msg', dims: [{ label: '类型', options: [['msg-normal', '信息'], ['msg-success', '成功'], ['msg-warning', '警告'], ['msg-error', '错误']] }] },
  spin: { base: 'spin', dims: [{ label: '尺寸', options: [['spin-sm', '16'], ['spin-md', '20'], ['spin-lg', '32']] }, { label: '颜色', options: [['spin-red', '红'], ['spin-dark', '深'], ['spin-blue', '蓝'], ['spin-gray', '灰'], ['spin-light', '白']] }] },
  stp: { base: 'stp', dims: [{ label: '尺寸', options: [['', '默认32'], ['stp-sm', '小24']] }] },
  tip: { base: 'tip', dims: [{ label: '颜色', options: [['tip-dark', '深'], ['tip-light', '浅']] }] },
  'upl-btn': { base: 'upl-btn', dims: [{ label: '尺寸', options: [['upl-btn-sm', '小'], ['', '中'], ['upl-btn-lg', '大']] }, { label: '状态', options: [['', '默认'], ['upl-btn-loading', '上传中'], ['upl-btn-disabled', '禁用']] }] },
  clps: { base: 'clps', dims: [{ label: '颜色', options: [['', '默认'], ['clps-red', '红'], ['clps-blue', '蓝']] }, { label: '尺寸', options: [['clps-sm', '小'], ['', '中'], ['clps-lg', '大']] }, { label: '边框', options: [['', '有'], ['clps-borderless', '无']] }] },
  dw: { base: 'dw', dims: [{ label: '宽度', options: [['dw-narrow', '320'], ['', '400'], ['dw-wide', '560']] }] },
  'lst-item': { base: 'lst-item', dims: [{ label: '高度', options: [['lst-item-sm', '36'], ['', '44'], ['lst-item-lg', '64']] }, { label: '状态', options: [['', '默认'], ['lst-sel', '选中'], ['lst-dis', '禁用']] }] },
};

/* ── 让组件在预览里能点能动（吉吉：每个组件都是可以交互的）──
   飞鹊 CSS 只有样子没有行为，这段脚本按类名做事件委托：Tabs 切换、开关、勾选、单选、分页、按钮式选择、下拉展开、
   折叠面板、列表选中、步骤条、数字加减、文本域计数、关闭提示条。拖第一块控件进页面时注一次（data-feique="behaviors"）。
   编辑态下探针在捕获阶段吞掉点击，所以编辑时不会误触发。 */
const BEHAVIORS = `(function(){
  if (window.__fqBehaviors) return; window.__fqBehaviors = 1;
  function sibs(el, sel) { var p = el.parentElement; return p ? Array.prototype.filter.call(p.children, function (c) { return c.matches(sel); }) : []; }
  function only(el, sel, cls) { sibs(el, sel).forEach(function (c) { c.classList.remove(cls); }); el.classList.add(cls); }
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target : e.target.parentElement; if (!t) return; var x;
    if ((x = t.closest('.tab-item'))) { only(x, '.tab-item', 'active'); return; }
    /* 🔴 砖里塞了原生 input 的（勾选框/单选/开关/按钮式选择器，2026-09-17 起），状态由原生控件说了算，
       这段脚本必须让路 —— 再 preventDefault 就把原生勾选挡掉了，两套状态各说各话（scope 门当场报红）。
       只有老写法（纯 class、没有 input）才还走下面这套 class 切换，免得打断以前做好的页面。 */
    if ((x = t.closest('.sw')) && !x.classList.contains('sw-disabled')) { if (x.querySelector('input')) return; x.classList.toggle('sw-on'); return; }
    if ((x = t.closest('.cb')) && !x.classList.contains('cb-dis')) { if (x.querySelector('input')) return; e.preventDefault(); x.classList.remove('cb-half'); x.classList.toggle('cb-sel'); return; }
    if ((x = t.closest('.rd')) && !x.classList.contains('rd-dis')) { if (x.querySelector('input')) return; e.preventDefault(); only(x, '.rd', 'rd-sel'); return; }
    if ((x = t.closest('.pg-item')) && !x.classList.contains('pg-disabled')) { e.preventDefault(); only(x, '.pg-item', 'pg-active'); return; }
    if ((x = t.closest('.ss')) && !x.classList.contains('ss-dis')) { if (x.querySelector('input')) return; only(x, '.ss', 'ss-sel'); return; }
    if ((x = t.closest('.sel-menu-item'))) { var w = x.closest('.sel-demo-wrap'); if (w) { var tx = w.querySelector('.sel-text'); if (tx) { tx.textContent = x.textContent.trim(); tx.classList.add('val'); } w.querySelectorAll('.sel-menu-item').forEach(function (i) { i.classList.remove('mselected'); }); x.classList.add('mselected'); w.classList.remove('open'); } return; }
    if ((x = t.closest('.sel-demo-wrap'))) { if (!x.querySelector('.sel').classList.contains('sel-disabled')) x.classList.toggle('open'); return; }
    if ((x = t.closest('.clps-hd'))) { var it = x.parentElement; if (it && !it.classList.contains('is-disabled')) it.classList.toggle('is-open'); return; }
    if ((x = t.closest('.lst-item')) && !x.classList.contains('lst-dis')) { only(x, '.lst-item', 'lst-sel'); return; }
    if ((x = t.closest('.stp-item'))) { var items = sibs(x, '.stp-item'), k = items.indexOf(x); items.forEach(function (it, i) { it.classList.remove('stp-done', 'stp-cur'); if (i < k) it.classList.add('stp-done'); if (i === k) it.classList.add('stp-cur'); }); return; }
    if ((x = t.closest('.inp-num-btn'))) { var box = x.closest('.inp-num'), inp = box && box.querySelector('input'); if (inp && !box.classList.contains('inp-num-dis')) { var n = parseFloat(inp.value) || 0, st = +x.getAttribute('data-step') || (x === box.firstElementChild ? -1 : 1); inp.value = n + st; } return; }
    if ((x = t.closest('.alert-close'))) { var a = x.closest('.alert'); if (a) a.remove(); return; }
    if ((x = t.closest('.upl-file-del, .upl-ing-close'))) { var row = x.closest('.upl-file-item, .upl-ing'); if (row) row.remove(); return; }
    if ((x = t.closest('.dw-hd-close'))) { var ov = x.closest('.dw-overlay'); if (ov) ov.remove(); return; }
  }, false);
  document.addEventListener('input', function (e) {
    var ta = e.target.closest && e.target.closest('.ta'); if (ta && e.target.classList.contains('ta-input')) { var c = ta.querySelector('.ta-count'); var max = e.target.getAttribute('maxlength'); if (c) c.textContent = e.target.value.length + (max ? '/' + max : ''); ta.classList.toggle('ta-typing', !!e.target.value.length); }
  }, false);
  document.addEventListener('click', function (e) { if (!e.target.closest || !e.target.closest('.sel-demo-wrap')) document.querySelectorAll('.sel-demo-wrap.open').forEach(function (w) { w.classList.remove('open'); }); }, false);
})();`;

/* ── 给组件 CSS 加作用域 ──
   拖进别人的页面里，页面自己的 `.btn`、`.ad a{color:#fff}` 这类规则跟飞鹊的撞名或权重更高，就把组件盖没了
   （2026-09-16 吉吉截图：换进去的按钮白字落在白底上、一块空）。注入顺序靠不住，只能提权重：
   每条选择器前面加三个属性选择器 [data-fq][data-fq][data-fq]（权重 0,3,0），组件根元素带 data-fq。
   页面里三个类以内的规则全输给它，!important 除外。伪元素不能进 :is()，单独拆到外面。 */
const SCOPE = '[data-fq][data-fq][data-fq]';
function scopeSelector(sel) {
  sel = sel.trim(); if (!sel) return sel;
  const m = /^(.*?)(::?(?:before|after|placeholder|selection|marker|first-line|first-letter|-webkit-[\w-]+|-moz-[\w-]+))$/.exec(sel);
  const base = m ? m[1].trim() : sel, pseudo = m ? m[2] : '';
  if (base === '*' || base === '') return `${SCOPE}${pseudo}, ${SCOPE} *${pseudo}`;
  return `${SCOPE}:is(${base})${pseudo}, ${SCOPE} :is(${base})${pseudo}`;
}
function scopeCss(css) {
  let out = '', i = 0; const n = css.length;
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  while (i < css.length) {
    const open = css.indexOf('{', i); if (open < 0) { out += css.slice(i); break; }
    const head = css.slice(i, open);
    /* 找到这条规则的闭合（@media 里有嵌套花括号，按深度数） */
    let depth = 1, k = open + 1; while (k < css.length && depth) { if (css[k] === '{') depth++; else if (css[k] === '}') depth--; k++; }
    const body = css.slice(open + 1, k - 1);
    const h = head.trim();
    if (/^@(media|supports|container)/.test(h)) out += `${h}{${scopeCss(body)}}\n`;
    else if (h.startsWith('@')) out += `${h}{${body}}\n`;                      // @keyframes / @font-face 原样
    else if (h) out += `${h.split(',').map(scopeSelector).join(',\n')}{${body.trim()}}\n`;
    i = k;
  }
  return out;
}
/* 根元素带上 data-fq（只加在第一个开标签上） */
function markRoot(html) { return html.replace(/^(\s*<[a-zA-Z][\w-]*)(\s|>)/, (m, a, b) => `${a} data-fq${b === '>' ? '' : ''}${b}`); }

let _cat = null, _dir = null;
function loadCatalog(packDir) {
  if (_cat && _dir === packDir) return _cat;
  const rd = p => fs.readFileSync(path.join(packDir, p), 'utf8');
  const icon = (n, cls, fill, size) => {
    try {
      let t = rd('icons/' + n + '.svg').replace(/^\s*<\?xml[^>]*>\s*/, '').replace(/\s*\n\s*/g, '').replace(/fill="#222222"/gi, 'fill="' + (fill || 'currentColor') + '"');
      t = t.replace(/<svg\b([^>]*)>/, (m, a) => '<svg' + a.replace(/\s(width|height)="[^"]*"/g, '') + ' width="' + (size || 16) + '" height="' + (size || 16) + '"' + (cls ? ' class="' + cls + '"' : '') + '>');
      return t;
    } catch (e) { return ''; }
  };
  const out = [];
  /* ① 页面片段 */
  for (const [file, meta] of Object.entries(BLOCKS)) {
    let raw; try { raw = rd('docs/blocks/' + file); } catch (e) { continue; }
    raw = raw.replace(/^\s*<!--[\s\S]*?-->\s*/, '');                       // 顶部说明注释
    const css = []; raw = raw.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_m, c) => { css.push(c.trim()); return ''; });
    /* SLOT：cat brand/xxx.svg 整段贴到这里 → 真的贴进去 */
    raw = raw.replace(/<!--\s*SLOT[^>]*?cat\s+(\S+\.svg)[^>]*?-->/g, (m, p) => { try { return rd(p).replace(/^\s*<\?xml[^>]*>\s*/, '').trim(); } catch (e) { return m; } });
    raw = raw.replace(/\sdata-node-id="[^"]*"/g, '');                        // Figma 节点号是给还原门对账的，成品里不要
    const html = raw.trim();
    const id = 'block-' + file.replace(/\.html$/, '');
    out.push({ id, group: 'block', family: id, name: meta.name, desc: meta.size, size: meta.size, keep: meta.keep, html, css: scopeCss(css.join('\n')), styleId: id, root: (/^<([a-zA-Z][\w-]*)/.exec(html) || [])[1] || 'div' });
  }
  /* ② 原子控件 */
  let reset = ''; try { reset = rd('docs/css/_reset.css'); } catch (e) {}
  for (const c of controls(icon)) {
    /* 同名的 <族>.states.css 是状态接线层（build/gen-feique-states.py 生成）：
       把飞鹊写在 class 上的 hover / 选中真值接到真实的 :hover / :checked 上。有就带，没有就算。 */
    let css = ''; for (const f of c.css) { try { css += rd('docs/css/' + f + '.css') + '\n'; } catch (e) {} try { css += rd('docs/css/' + f + '.states.css') + '\n'; } catch (e) {} }
    out.push({ ...c, css: scopeCss(css.trim()), reset: scopeCss(reset), styleId: 'ctl-' + c.css.join('-'), variants: VARIANTS[c.family] || null, root: (/^<([a-zA-Z][\w-]*)/.exec(c.html) || [])[1] || 'div' });
  }
  _cat = out; _dir = packDir;
  return out;
}
function byId(packDir, id) { return loadCatalog(packDir).find(c => c.id === id) || null; }

/* 用原元素的文字/链接/图片填样板。keep 里没有的占位用默认值。 */
const escText = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
function fill(comp, keep) {
  keep = keep || {};
  let html = comp.html.replace(/\{\{(\w+)(?:\|([^}]*))?\}\}/g, (_m, k, dflt) => {
    const v = comp.keep.includes(k) && keep[k] != null && String(keep[k]).trim() !== '' ? String(keep[k]).trim() : (dflt != null ? dflt : (k === 'href' ? '#' : ''));
    return k === 'text' ? escText(v) : escAttr(v);
  });
  /* 页面片段：第一张图换成原元素的图，第一个链接换成原元素的链接 */
  if (comp.group === 'block') {
    if (comp.keep.includes('src') && keep.src) { let done = false; html = html.replace(/(<img\b[^>]*\bsrc=")[^"]*(")/, (m, a, b) => { if (done) return m; done = true; return a + escAttr(keep.src) + b; }); }
    if (comp.keep.includes('href') && keep.href) html = html.replace(/(<a\b[^>]*\bhref=")#?(")/g, (m, a, b) => a + escAttr(keep.href) + b);
  }
  return markRoot(html);
}
/* 面板用：不带 css 正文的清单（css 单独按 styleId 取），thumb 用来画缩略图 */
function summary(packDir) {
  return loadCatalog(packDir).map(c => ({ id: c.id, group: c.group, family: c.family, name: c.name, desc: c.desc || '', size: c.size || '', keep: c.keep, variants: c.variants || null, thumb: fill(c, {}), css: c.css, reset: c.reset || '' }));
}
module.exports = { loadCatalog, byId, fill, summary, VARIANTS, scopeCss, scopeSelector, SCOPE, BEHAVIORS };
