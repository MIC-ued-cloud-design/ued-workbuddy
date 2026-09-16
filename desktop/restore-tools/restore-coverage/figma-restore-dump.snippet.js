// figma-restore-dump.snippet.js — 还原「一次遍历，两样真值」提取模板（figma-manifest 的超集）
// ─────────────────────────────────────────────────────────────────────────────
// 一次 Figma 遍历同时产出：
//   leaves — 与旧 figma-manifest.snippet.js 完全同格式 → 喂 coverage-check.js 查「完整性」（该有的块有没有漏）
//   nodes  — 每个可见节点的真值 → 喂 geom-check.js --figma-spec，按 data-node-id 自动逐值核对
//            · 盒模型：w/h/padding/border/圆角/字号字重（几何）
//            · 颜色（2026-07-09 加·治「颜色/底色错了 geom 还全绿」）：bg{背景SOLID色+透明度}/color{文字色}/bgKind:gradient
//            · 机器核不到、列成「必须目视」清单的：abs(绝对定位·位置核不到)/imgBox(带边框圆角的图片框·必须用rawImages源图别用export)/pAlign+cAlign(非默认对齐)
//            无需再手写 checks.json（消灭「人肉抄值」这个最大误差源）
//
// 用法：
//   1) 把整段贴进 use_figma 的 code 参数，改 ROOT_ID 为要还原的根节点 id（如 "3007:464"）
//   2) 拿返回的 JSON 写进项目里的 <页面>-manifest.json（文件名必须带 manifest → 触发 coverage Stop 门 stamp）
//   3) 还原时：给每个 HTML 元素打 data-node-id="<对应的 figma 节点 id>"（镜像 Figma）
//   4) 两道门都读同一个文件、同一次遍历的结果：
//        完整性门：node .../restore-coverage/coverage-check.js --manifest <页面>-manifest.json --coverage <页面>-coverage.json
//        精度门：  node .../online-reach/geom-check.js --figma-spec <页面>-manifest.json --url "file:///abs/x.html" --vw 1920
//
// ⚠️ 诚实边界：nodes 全树采集（含容器/装饰），会有噪音；但 geom-check 是 DOM-driven（只比你真打了
//    data-node-id 的元素），噪音节点匹配不到就自动忽略，无害。leaves 仍按「可见+有面积+叶子/文字/带图」
//    收敛，少量装饰误入的在 coverage.json 里标 skip+reason 即可。

const ROOT_ID = "PUT_ROOT_NODE_ID_HERE";   // ← 改成要还原的根节点 id

// ── 分块参数（2026-07-27 立·根治「大页面 dump 被静默截断」）─────────────────────
// 🔴 实测：use_figma 的返回超 ~20KB 会被直接截断（不会自动落盘）。本 dump 约 250 字节/节点，
//    即 **80 个节点以上就可能截**。截了以后落盘的是半截 manifest，coverage 只核那半截叶子、
//    geom 只核那半截节点，**照样报全绿** —— 扫历史 30 份 manifest，14 份就是这么残的。
// 用法：第一次原样跑（FROM_* 都是 0）。若返回里 `_part.more` 为 true，就把 FROM_LEAF / FROM_NODE
//    改成返回的 `_part.nextLeaf` / `_part.nextNode` 再跑一次，直到 more=false。
//    每一块都带**同一份全量 `_digest`**（对整套算的），所以合并后跑 manifest-merge.js 能校验完整性。
const FROM_LEAF = 0;      // ← 续抽时改成上一块返回的 _part.nextLeaf
const FROM_NODE = 0;      // ← 续抽时改成上一块返回的 _part.nextNode
// 每块 JSON 字符预算。**别再调低**（2026-07-27 实测代价）：原值 14000 把一份 17.2KB、
// 本来一次能抽完的 dump 硬切成两块 —— 续抽要把这 440 行 snippet 原样再贴进 use_figma 一次，
// 实测多花约 3 分钟（占那次 26 分钟还原的 12%）。20000 是返回被静默截断的硬上限，
// 19000 留 1KB 余量给 _digest/_part 外壳，是「不截断前提下最少的分块次数」。
const BUDGET    = 19000;

// 插画级矢量把 path 一起带出来的面积门槛（px²）。默认 1500 ≈ 39×39 以上：
//   箭头/手绘装饰这类(71×74=5254)带 → 省掉「为拿 path 再开一次 use_figma」这个来回；
//   16px 图标(256)/24px(576) 不带 → 不会把 icon 密集的页面撑爆。设 0 = 全带，设很大 = 都不带。
const VECTOR_PATH_MIN_AREA = 1500;
// 单条 path 字符上限 & 本次 dump 所有 path 的合计上限（2026-07-27 补·防「一个节点就撑爆 20KB」）：
//   插画矢量的 path 动辄几十 KB,一个节点就能超返回上限 → 那一块必被截断,而且静默。
//   超限的只记 pathLen(仍能核抄漏),并在 _part.pathSkipped 里点名,让你知道要单独去取哪个。
const VECTOR_PATH_MAX_CHARS = 12000;
const VECTOR_PATH_TOTAL_CHARS = 8000;
// 2026-07-28 立·治「图标/徽标组件实例被拆成几十个重叠矢量碎片」：
// 触屏搜索结果页实测——一个 59×12 的字形徽标在 manifest 里是 **20 个 VECTOR**，bx/by/w/h 全一样
// （它们是同一个字形的路径碎片）；433 个节点里这类占一大半。它们**不可能被独立建出来**
// （只能整体渲染成一张图/一个 SVG），却要逐个进 coverage 核销、逐个进 geom 比对 = 纯噪音，
// 还把 manifest 撑到 147KB（整页 manifest 双程过上下文是目前最贵的一步）。
// 判据：INSTANCE + 无 TEXT 后代 + 无图片填充后代 = 「它整体就是一张图」→ 记这个实例，不往里走。
// 反过来：带文字的卡片实例(supplier-card)、带文字的榜单卡都**不会**被折叠。
const FOLD_ATOMIC_INSTANCES = true;
const TEXT_MAX  = 240;    // 文案带多长（2026-08-02 从 40 提上来·40 字必然要再开一次调用去取全文）
const EXPORT_ATOMIC_SVG = true;   // 把折叠成一张图的图标实例顺手导成 SVG 存进 sharedPluginData（省一轮取素材）
const ATOMIC_SVG_BUDGET = 220000; // 导出总字符预算·超了就停并点名（别把一张大稿卡在导素材上）

const root = await figma.getNodeByIdAsync(ROOT_ID);
if (!root) return { error: "root not found: " + ROOT_ID };

const MIXED = figma.mixed;
const numOr = (v) => (typeof v === "number" ? Math.round(v * 100) / 100 : null);
// Figma blendMode → CSS mix-blend-mode 标准关键词（NORMAL/PASS_THROUGH=默认·不记）
const BLEND = { MULTIPLY:"multiply", SCREEN:"screen", OVERLAY:"overlay", DARKEN:"darken", LIGHTEN:"lighten",
  COLOR_DODGE:"color-dodge", COLOR_BURN:"color-burn", HARD_LIGHT:"hard-light", SOFT_LIGHT:"soft-light",
  DIFFERENCE:"difference", EXCLUSION:"exclusion", HUE:"hue", SATURATION:"saturation", COLOR:"color", LUMINOSITY:"luminosity" };

// 字重：优先 node.fontWeight 数字；拿不到再按 fontName.style 文案映射
function styleToWeight(style) {
  if (!style) return null;
  const s = String(style).toLowerCase().replace(/\s+/g, "");
  if (s.includes("extralight") || s.includes("ultralight")) return 200;
  if (s.includes("semibold") || s.includes("demibold") || s.includes("demi")) return 600;
  if (s.includes("extrabold") || s.includes("ultrabold")) return 800;
  if (s.includes("thin")) return 100;
  if (s.includes("light")) return 300;
  if (s.includes("medium")) return 500;
  if (s.includes("black") || s.includes("heavy")) return 900;
  if (s.includes("bold")) return 700;
  if (s.includes("regular") || s.includes("normal") || s.includes("book")) return 400;
  return null;
}

function box(n) {
  const b = n.absoluteBoundingBox;
  return b ? { w: Math.round(b.width), h: Math.round(b.height) } : { w: null, h: null };
}
function hasImageFill(n) {
  const f = n.fills;
  return Array.isArray(f) && f.some(p => p.visible !== false && p.type === "IMAGE");
}
function hasVisiblePaint(n) {
  const f = n.fills, s = n.strokes;
  const fill = Array.isArray(f) && f.some(p => p.visible !== false && p.type !== "IMAGE");
  const stroke = Array.isArray(s) && s.some(p => p.visible !== false);
  return fill || stroke;
}
function hasVisibleStroke(n) {
  const s = n.strokes;
  return Array.isArray(s) && s.length > 0 && s.some(p => p.visible !== false);
}
// 颜色真值（geom-check 自动比背景/文字色 → 治「颜色/底色错了 geom 还全绿」）
function hexOf(c) {
  if (!c) return null;
  const h = x => Math.round(x * 255).toString(16).padStart(2, "0");
  return "#" + h(c.r) + h(c.g) + h(c.b);
}
function firstVisibleFill(n) {
  let f = null; try { f = n.fills; } catch (e) { return null; }
  if (!Array.isArray(f)) return null;
  return f.find(p => p.visible !== false) || null;
}
function firstVisibleStroke(n) {
  let s = null; try { s = n.strokes; } catch (e) { return null; }
  if (!Array.isArray(s)) return null;
  return s.find(p => p.visible !== false) || null;
}
// 渐变真值（2026-07-21 根治「渐变方向/停靠错了三门全绿」·✨90°当45°、radial 没做都靠肉眼）：
// 记 type(linear/radial/angular/diamond)+stops(位置+色)+原始 transform。geom-check 据此：CSS 背景渐变元素
// 硬比 type/停靠位置/色；SVG fill / 伪元素这类 computed 读不到的 → 列「必须核渐变」清单打印真值(不静默跳过)。
function gradOf(paint) {
  if (!paint || !String(paint.type).includes("GRADIENT")) return null;
  const kind = paint.type.replace("GRADIENT_", "").toLowerCase(); // linear / radial / angular / diamond
  const stops = (paint.gradientStops || []).map(s => ({
    p: Math.round(s.position * 1000) / 1000,
    c: hexOf(s.color),
    a: (s.color && s.color.a != null) ? Math.round(s.color.a * 100) / 100 : 1
  }));
  const g = { kind, stops };
  if (paint.gradientTransform) g.tf = paint.gradientTransform; // 原始变换·CSS 角度换算易错·只当参考不硬判角度
  return g;
}
// 叶子判定（与 figma-manifest.snippet.js 一致，保证 leaves 格式兼容 coverage-check）
function isMeaningfulLeaf(n) {
  if (n.visible === false) return false;
  const t = n.type;
  if (t === "TEXT") return true;
  if (hasImageFill(n)) return true;
  if (["VECTOR", "BOOLEAN_OPERATION", "STAR", "POLYGON", "LINE", "ELLIPSE"].includes(t)) return true;
  const kids = n.children || [];
  if (kids.length === 0 && (t === "RECTANGLE" || t === "FRAME" || t === "INSTANCE") && hasVisiblePaint(n)) return true;
  return false;
}

// 图标真实字形色（2026-07-16 根治「图标色靠猜/看变体名·geom 没这项可核·visual 细线又低于阈值」）：
// 挖 INSTANCE 内部第一个 SOLID 填充的字形色 → 写进 g.color，让 geom-check 现成的 s.color↔computed color 比对自动生效。
// 跳过设计辅助层（栅格线/勿动/grid/guide），这些是组件里的对齐参考、非真实字形。
function isGuideNode(x){ return /栅格线|勿动|grid|guide|标注/i.test(String(x && x.name || '')); }
function glyphColor(node){
  let found = null;
  (function walk(x){
    if (found || !x || x.visible === false || isGuideNode(x)) return;
    const t = x.type;
    if (["VECTOR","BOOLEAN_OPERATION","RECTANGLE","ELLIPSE","STAR","POLYGON","LINE"].includes(t)) {
      let f = null; try { f = x.fills; } catch(e){}
      if (Array.isArray(f)) { const p = f.find(v => v.visible !== false && v.type === "SOLID"); if (p) { found = hexOf(p.color); return; } }
    }
    for (const c of (x.children || [])) walk(c);
  })(node);
  return found;
}
function hasTextDescendant(node){
  let yes = false;
  (function walk(x){ if (yes || !x || x.visible === false) return; if (x.type === "TEXT") { yes = true; return; } for (const c of (x.children || [])) walk(c); })(node);
  return yes;
}
function hasImageDescendant(node){
  let yes = false;
  (function walk(x){ if (yes || !x || x.visible === false) return; if (hasImageFill(x)) { yes = true; return; } for (const c of (x.children || [])) walk(c); })(node);
  return yes;
}
// 「整体就是一张图」的组件实例：有子节点、但里面既没有文字也没有图片填充 → 只可能整体渲染
function isAtomicInstance(n){
  if (!FOLD_ATOMIC_INSTANCES) return false;
  if (!n || n.type !== "INSTANCE") return false;
  const kids = n.children || [];
  if (!kids.length) return false;
  return !hasTextDescendant(n) && !hasImageDescendant(n);
}


// 从节点抽「可核对的盒模型真值」→ geom-check 项（只放确实拿得到的键，null 的不放）
async function geomOf(n, rootBB) {
  const { w, h } = box(n);
  const g = { id: n.id, name: n.name, type: n.type };
  if (n.parent && n.parent.id) g.parentId = n.parent.id;   // 所有节点记父 id（2026-07-15·居中对齐校验按父分组用；绝对定位另在下方复用）
  // 旋转（2026-07-21 根治·正方形/圆形等对称元素的旋转「符号翻转」是 w/h/aabb/像素门全抓不到的盲区）：
  // 记 Figma 节点自身旋转角(度·逆时针为正)。geom-check 据此解 DOM 元素 transform 矩阵角，比 CSS 约定 −rotation，符号反了直接报红。
  if (typeof n.rotation === "number" && Math.abs(n.rotation) >= 0.5) g.rot = Math.round(n.rotation * 100) / 100;
  // 镜像翻转（2026-07-27 根治「箭头 det=-1 被竖向镜像·geom 的旋转判据用 atan2(b,a)·加不加 scaleY(-1) 算出同一个角
  //   → 镜像漏了三门照样全绿·只能靠肉眼看出朝向反」）：relativeTransform 行列式<0 = 被镜像过，CSS 要补 scaleX/scaleY(-1)。
  //   两个值都写（true/false），让 geom-check 双向硬判：该翻没翻 / 不该翻却翻了。
  try { const _rt = n.relativeTransform; if (_rt) g.mirror = (_rt[0][0]*_rt[1][1] - _rt[0][1]*_rt[1][0]) < 0; } catch (e) {}
  if (w != null) g.w = w;
  if (h != null) g.h = h;
  // 未旋转内在尺寸（2026-07-22 根治「旋转元素 w/h 用了 absoluteBoundingBox 的 AABB 膨胀值→比 CSS offsetWidth 永远对不上/假红→我反复拿 122/217 当真实尺寸做太大」）：
  // 有旋转才额外记 uw/uh = node.width/height（旋转前的真实盒·= CSS width/height + transform:rotate 里该填的值）。geom-check 旋转元素用 uw/uh 比 offsetWidth。
  // uw/uh 无条件记（2026-07-27 从「只在有旋转时记」改成全记）：w/h 是 absoluteBoundingBox 的 AABB，
  // **只要祖先链上有旋转，它就是膨胀值**，而 CSS 的 offsetWidth 永远是本地未旋转盒 → 对不上=假红。
  // 实测：购物篮自己没旋转，但父白卡转了 -10°，w/h 记成 88×77(AABB)，本地真身是 78×64 → 门报「期望88 实际100」。
  // node.width/height 恒为本地未变换尺寸；无旋转场景下 uw==w，等于没变化，所以全记是安全的。
  try { g.uw = Math.round(n.width); g.uh = Math.round(n.height); } catch (e) {}
  // bx/by：相对「块根」的左上角偏移（2026-07-16·visual-verify.js 逐元素裁剪比对用·治图形位置/字形错）
  const _bb = n.absoluteBoundingBox;
  if (_bb && rootBB) { g.bx = Math.round(_bb.x - rootBB.x); g.by = Math.round(_bb.y - rootBB.y); }
  // cx/cy：中心点相对「块根」（2026-07-22 根治「geom 原来只核 abs 定位元素的 relX/relY·普通/旋转卡的绝对位置根本没核→我摆偏 9px 门全绿」）：
  // 中心点旋转不变（AABB 中心=真中心），geom-check 对每个 data-node-id 元素机器核 DOM 中心 vs 此值。
  if (_bb && rootBB) { g.cx = Math.round(_bb.x + _bb.width/2 - rootBB.x); g.cy = Math.round(_bb.y + _bb.height/2 - rootBB.y); }
  // z：paint 顺序秩（2026-07-22 根治「图层顺序反了没有任何门核·靠用户一遍遍指」）：DFS 前序遍历序=Figma 上色顺序(父先/子后·子按 index)。秩大=后画=更靠上。
  g.z = _paintRank++;
  // iconName：INSTANCE 对应的飞鹊主组件名（2026-07-16·让还原时按名选对 svg·别再想当然）
  if (n.type === 'INSTANCE') { try { const _mc = await n.getMainComponentAsync(); if (_mc && _mc.name) g.iconName = _mc.name; } catch (e) {} }
  // 图标字形真色（2026-07-16 根治·纯图标 INSTANCE·非按钮那种含文字的）：写 g.color → geom-check 核 computed color（图标用 currentColor 渲染·元素 color 即字形色）。
  // 含 TEXT 的按钮类 INSTANCE 跳过——它的色以内部 TEXT 节点为准（还原时给 label 单独打 data-node-id 才核得到）。
  if (n.type === 'INSTANCE' && !hasTextDescendant(n)) { const _gc = glyphColor(n); if (_gc) g.color = _gc; }

  // padding：只有 auto-layout 容器有。
  // 🔴 图片填充的框跳过 padding（2026-07-09 产品图缩小翻车根治）：图片是「填充(paint)」·铺满整框·
  //    框的 padding 对填充不生效——输出它只会误导还原时做成真实内边距 → 图片被缩小、同排大小不一。
  if (n.layoutMode && n.layoutMode !== "NONE" && !hasImageFill(n)) {
    if (typeof n.paddingTop === "number") g.pt = n.paddingTop;
    if (typeof n.paddingRight === "number") g.pr = n.paddingRight;
    if (typeof n.paddingBottom === "number") g.pb = n.paddingBottom;
    if (typeof n.paddingLeft === "number") g.pl = n.paddingLeft;
    // itemSpacing / clipsContent（2026-07-27 补·治「一次 dump 拿不全·还得再开一次 use_figma 单独问」，
    // 这两项是搭 flex 时必需的：gap 直接对应 itemSpacing，clips 决定子元素能不能溢出（篮子就是溢出白卡的）。）
    if (typeof n.itemSpacing === "number") g.gap = Math.round(n.itemSpacing * 100) / 100;
    // dir 无条件记（2026-07-27 补）：原来只在「对齐非默认」时才记(见下方 pAlign 那段)，于是 MIN/MIN 的
    // auto-layout 容器拿不到方向 —— 骨架生成器只能靠子元素坐标猜横竖。方向是搭 flex 的第一必需品，别让人猜。
    g.dir = n.layoutMode;
  }
  // 两轴 sizing（2026-07-27 补·骨架生成器要它才能出「清爽」的 CSS 而不是一堆写死尺寸）：
  //   FIXED → 写显式 px；HUG → 不写尺寸让内容撑（等价 Figma 的 HUG）；FILL → flex:1 / align-self:stretch。
  //   缺了它只能一律写死 w/h —— geom 是会绿，但产出的是开发不敢改、设计师也改不动的僵硬盒子，
  //   违背分则1「真代码·清爽 auto-layout」。
  try { if (n.layoutSizingHorizontal) g.hSize = n.layoutSizingHorizontal; } catch (e) {}
  try { if (n.layoutSizingVertical) g.vSize = n.layoutSizingVertical; } catch (e) {}
  if ("clipsContent" in n) g.clips = !!n.clipsContent;

  // border：有可见描边才记；优先四边独立权重（如只右+下描边的分割格）
  if (hasVisibleStroke(n)) {
    if (typeof n.strokeTopWeight === "number") {
      g.bt = numOr(n.strokeTopWeight) || 0;
      g.br = numOr(n.strokeRightWeight) || 0;
      g.bb = numOr(n.strokeBottomWeight) || 0;
      g.bl = numOr(n.strokeLeftWeight) || 0;
    } else if (typeof n.strokeWeight === "number") {
      g.bt = g.br = g.bb = g.bl = numOr(n.strokeWeight);
    }
    // 描边颜色（2026-07-09 主动补·治「只核 border 宽度不核颜色→分割线错色绿着过」）
    const st = firstVisibleStroke(n);
    if (st && st.type === "SOLID") g.borderColor = hexOf(st.color);
    // 🔴 渐变描边（2026-07-29 补·此前是盲区）：上面那行只记实色描边，描边是渐变时 dump 里**一个字都没有**，
    //   还原时只能凭渲染图猜，或者额外开一次 use_figma 去读 strokes（测试稿 121:15577 的搜索框就这么栽的·
    //   那圈是 #ff6c65 → #ffb7b7@49.5% → #ff6c65 的横向三停靠）。填充渐变早就记成 grad 了，描边照抄一遍。
    //   computed style 读不到渐变描边（CSS 得靠 background-clip 双层或 border-image 实现）→ geom 不硬判，
    //   只列进「必须核渐变」清单，跟 SVG fill 渐变一个待遇。
    else if (st && String(st.type).includes("GRADIENT")) g.borderGrad = gradOf(st);
    // 描边位置（2026-07-28 补·治「内描边的按钮照抄 padding → CSS 盒子大 2px」）：
    //   Figma 的 INSIDE 描边画在盒子内部，padding 是从**外沿**量的；CSS 的 border 却在 padding 之外
    //   另占宽度 → 直接抄 padding 会让整盒 = 内容+padding+border，比 Figma 大一圈（实测 Source Now
    //   按钮 108×32 变成 110×34，geom 当场报红）。记下来让 scaffold 自动减掉 border 那一份。
    if (typeof n.strokeAlign === "string") g.bAlign = n.strokeAlign;   // INSIDE / OUTSIDE / CENTER
    // 🔴 描边到底占不占布局，只有这个字段说得清（2026-07-29 补·此前 geom 只能「pad 或 pad−描边二者之一都放行」）：
    //   strokesIncludedInLayout=true  → Figma 的内容内缩 = padding + 描边宽（描边把内容挤进去了）
    //   strokesIncludedInLayout=false → 内容内缩 = padding（描边只是画在上面，不动布局）
    //   两次真实测量本来是矛盾的：测试稿 121:15577（pad16/INSIDE 2px）实测内缩 18=16+2，
    //   而触屏激活页签 1:15954（pb10/INSIDE 3px）实测内缩 10。差别就在这个字段。
    //   没有它，门只能两种都放行 → 写错一侧照样全绿，内容整块偏一个描边宽（实测偏 2px）。
    if (typeof n.strokesIncludedInLayout === "boolean") g.bInLayout = n.strokesIncludedInLayout;
  }

  // 圆角：统一圆角才记（个别角 mixed 跳过，geom-check 只查 borderTopLeftRadius）
  if (typeof n.cornerRadius === "number" && n.cornerRadius > 0) g.rad = n.cornerRadius;

  // 文字：字号 + 字重 + 文字色 + 水平对齐
  if (n.type === "TEXT") {
    if (typeof n.fontSize === "number") g.fs = n.fontSize;
    let fw = null;
    if (typeof n.fontWeight === "number") fw = n.fontWeight;
    if (fw == null && n.fontName && n.fontName !== MIXED && n.fontName.style) fw = styleToWeight(n.fontName.style);
    if (fw != null) g.fw = fw;
    // 文字色：单色→g.color；多色(一个TEXT节点内多段不同色·如「4.3」深「/5.0」灰)→g.segColors 逐色核
    //   （2026-07-16 根治「多色文字漏色」·firstVisibleFill 只取第一段·别的色必漏·geom 也只比元素单色→评分双色栽过）
    let segCols = [];
    try {
      const segs = n.getStyledTextSegments(["fills"]);
      if (Array.isArray(segs)) for (const sg of segs) {
        const p = Array.isArray(sg.fills) ? sg.fills.find(f => f.visible !== false && f.type === "SOLID") : null;
        if (p) { const hc = hexOf(p.color); if (hc && !segCols.includes(hc)) segCols.push(hc); }
      }
    } catch (e) {}
    if (segCols.length > 1) { g.segColors = segCols; g.color = segCols[0]; }   // geom 逐色核·每色都得在 DOM 里出现
    else { const tf = firstVisibleFill(n); if (tf && tf.type === "SOLID") g.color = hexOf(tf.color); else if (tf && String(tf.type).includes("GRADIENT")) g.grad = gradOf(tf); }  // 文字实色比 color·文字渐变(如 AI Mode)记 grad
    if (typeof n.textAlignHorizontal === "string") g.talign = n.textAlignHorizontal; // LEFT/CENTER/RIGHT/JUSTIFIED
    // 字体族（2026-07-09 主动补）：geom-check 比 computed fontFamily 首项·飞鹊恒 Roboto·偏了即报
    if (n.fontName && n.fontName !== MIXED && n.fontName.family) g.font = n.fontName.family;
    // 行高（2026-07-09 主动补·文字 w/h 默认跳过·行高才是文字盒可靠核值）：转 px；AUTO 跳过
    const lh = n.lineHeight;
    if (lh && lh !== MIXED) {
      if (lh.unit === "PIXELS") g.lh = Math.round(lh.value);
      else if (lh.unit === "PERCENT" && typeof n.fontSize === "number") g.lh = Math.round(lh.value / 100 * n.fontSize);
    }
  }

  // 背景/填充色（非文字）：只记「单一 SOLID 可比色」；渐变/图片另标，交给人核
  if (n.type !== "TEXT") {
    const ff = firstVisibleFill(n);
    if (ff) {
      if (ff.type === "SOLID") g.bg = { c: hexOf(ff.color), op: (typeof ff.opacity === "number" ? Math.round(ff.opacity * 100) / 100 : 1) };
      else if (String(ff.type).includes("GRADIENT")) { g.bgKind = "gradient"; g.grad = gradOf(ff); }   // 渐变真值→geom-check 核 type/停靠/色
      // IMAGE 由下面 imgBox 逻辑处理
    }
    // 🔴 多层填充栈（2026-07-28 加·治「bg 只记第一层 → 多层叠色/混合模式对 dump 完全隐形」）：
    //   血泪：触屏 supplier 卡的 thumb-img 是**4 层**——① SOLID #f0f1f2 底 ② 图(visible:false)
    //   ③ 图(blendMode=DARKEN) ④ SOLID #000 @3% 罩。只按 bg+imgFit 还原会整体偏亮
    //   （白底区 Figma 是 min(255,240)×0.97≈232.8，实测 232，照抄出来是 255），
    //   而 dump 里一个字都看不出来 —— 当时是靠 visual 的「图片内容比」报红、再做了一轮像素取证
    //   (8692 个裁切位置网格搜索/bbox 反解/6 种重采样/ICC) 才想到去读 n.fills，白烧约 6 分钟。
    //   只在「确实不止一层可见 paint，或有非 NORMAL 混合模式」时才记 → 单层节点一个字节不多加。
    try {
      const _fs = n.fills;
      if (Array.isArray(_fs) && _fs.length) {
        const _vis = _fs.filter(p => p.visible !== false);
        const _hasBlend = _fs.some(p => p.blendMode && p.blendMode !== "NORMAL" && p.blendMode !== "PASS_THROUGH");
        if (_vis.length > 1 || _hasBlend) {
          g.fillStack = _fs.map(p => {
            const o = { t: p.type === "SOLID" ? "S" : (p.type === "IMAGE" ? "I" : "G") };   // S=实色 I=图 G=渐变
            if (p.visible === false) o.off = 1;                                             // 隐藏层：别照着做
            if (typeof p.opacity === "number" && p.opacity < 0.999) o.op = Math.round(p.opacity * 1000) / 1000;
            if (p.blendMode && p.blendMode !== "NORMAL") o.bl = p.blendMode;                // DARKEN/MULTIPLY… CSS 用 mix-blend-mode
            if (p.type === "SOLID") o.c = hexOf(p.color);
            if (p.type === "IMAGE" && p.scaleMode) o.fit = p.scaleMode;
            return o;
          });
        }
      }
    } catch (e) {}
  }

  // 绝对定位：记 parentId + 相对父 x/y → geom-check 拿同 id 父节点当锚点机器核（2026-07-09 升级·父没建才回退目视）
  if (n.layoutPositioning === "ABSOLUTE") {
    g.abs = true;
    const b = n.absoluteBoundingBox, pb = n.parent && n.parent.absoluteBoundingBox;
    if (b && pb) { g.relX = Math.round(b.x - pb.x); g.relY = Math.round(b.y - pb.y); }
    if (n.parent && n.parent.id) g.parentId = n.parent.id;
  }

  // 图片填充框（2026-07-09 产品图缩小翻车根治）：只要是 IMAGE 填充就一律记 imgFit（FILL=cover / FIT=contain）
  //   → geom-check 据此硬查「FILL 的图必须铺满整框」（治「误加 padding/object-contain 把图缩小」这一画面盲区）。
  //   imgBox：再自带边框/圆角的 → 额外提醒「用 rawImages 源图·绝不用 download_assets 的 export（会把边框+缩放烤成死图）」。
  if (hasImageFill(n)) {
    // 🔴 扫**全部** fills 找 IMAGE，别只看 firstVisibleFill（2026-07-27 修：产品卡的 fills 是 [白底 SOLID, IMAGE]，
    //    first 拿到 SOLID → imgFit 丢了 → 还原时不知道该 cover 还是 contain，得再开一次 use_figma 单独问）。
    let imgf = null;
    try { const _f = n.fills; if (Array.isArray(_f)) imgf = _f.find(p => p.visible !== false && p.type === "IMAGE") || null; } catch (e) {}
    if (imgf && imgf.scaleMode) g.imgFit = imgf.scaleMode; // FIT=contain / FILL=cover / TILE / CROP
    // 2026-08-02 补：CROP 的裁切矩形全在 imageTransform 里，没它只能再开一次 use_figma 去问。
    // 单位矩阵 [[1,0,0],[0,1,0]] = 整张图铺满框（CSS 的 object-fit:fill），不是 cover——实测 RMSE 13.05 vs 45.78。
    if (imgf && imgf.imageTransform) g.imgTf = imgf.imageTransform;
    if (hasVisibleStroke(n) || (typeof n.cornerRadius === "number" && n.cornerRadius > 0)) g.imgBox = true;
  }
  // 矢量：记 path 字符数 + 缠绕规则（2026-07-27 补·治「手抄 path data 漏抄第二个子路径→回环变实心，
  //   来回渲染三轮才发现」）。还原时用 use_figma 取 vectorPaths[0].data，**先核字符数对不对**再往下走。
  if (n.type === "VECTOR") {
    try {
      const vp = n.vectorPaths;
      if (Array.isArray(vp) && vp.length) {
        g.pathLen = vp.map(x => x.data.length);
        g.winding = vp[0].windingRule;
        // 🔴 插画级矢量（面积 > VECTOR_PATH_MIN_AREA）连 path 一起带出来（2026-07-27 补）：
        //   否则还原时要为了拿 path 再单独开一次 use_figma —— 每多问一次 Figma 就是一个来回，
        //   而来回正是「还原慢」的主要成本（复盘：一个 714×300 的 banner 花了 70 次工具调用）。
        //   带出来还有第二个好处：path 进了 _digest 的计算范围，**抄漏立刻被 manifest-verify 抓**
        //   （真栽过：手抄箭头 path 漏了第二个子路径，回环从空心变实心，渲染比对三轮才发现）。
        //   16px 小图标（面积 256）不带 → 不会把 icon 密集的页面撑爆；大页面另有分块兜着。
        const _a = (n.width || 0) * (n.height || 0);
        // 🔴 排除「遮罩/裁剪组里的矢量」（2026-07-27 实测：篮子插画内部 3 个 clip mask 矢量面积也够门槛，
        //    但它们最终会被拍进一张 PNG、path 根本用不上，白白多 9KB）。按祖先链的组名判。
        let _inMask = false;
        for (let _a2 = n.parent; _a2 && _a2.id !== ROOT_ID; _a2 = _a2.parent)
          if (/clip\s*path|clippath|mask|蒙版|遮罩/i.test(String(_a2.name || ''))) { _inMask = true; break; }
        const _tot = vp.reduce((t, x) => t + x.data.length, 0);
        if (_a <= VECTOR_PATH_MIN_AREA) { /* 小图标不带 */ }
        else if (_inMask) _pathSkipped.push(n.id + "(遮罩组内)");
        else if (_tot > VECTOR_PATH_MAX_CHARS) _pathSkipped.push(n.id + "(单条" + _tot + "字符超上限·单独去取)");
        else if (_tot > _pathBudget) _pathSkipped.push(n.id + "(本次 path 合计预算已用完·单独去取)");
        else { g.paths = vp.map(x => ({ w: x.windingRule, d: x.data })); _pathBudget -= _tot; }
      }
    } catch (e) {}
  }

  // 对齐方式（auto-layout 容器·非默认才记）：geom-check 列出让人核 justify/align，不硬判（方向/flex 差异易假红）
  if (n.layoutMode && n.layoutMode !== "NONE") {
    const pa = n.primaryAxisAlignItems, ca = n.counterAxisAlignItems;
    if ((pa && pa !== "MIN") || (ca && ca !== "MIN")) { g.pAlign = pa || "MIN"; g.cAlign = ca || "MIN"; g.dir = n.layoutMode; }
  }
  // 效果（2026-07-09 页头投影漏做沉淀·治「dump 不抽 effects→阴影是整条流水线盲区」）：
  // DROP/INNER_SHADOW → box-shadow 字符串（geom-check 核「该有却 none」）；LAYER_BLUR → blur 半径。
  const fx = Array.isArray(n.effects) ? n.effects.filter(e => e.visible !== false) : [];
  const shadows = fx.filter(e => e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW").map(e => {
    const c = e.color || { r: 0, g: 0, b: 0, a: 1 };
    const rgba = `rgba(${Math.round(c.r*255)},${Math.round(c.g*255)},${Math.round(c.b*255)},${Math.round((c.a==null?1:c.a)*100)/100})`;
    const ox = numOr(e.offset && e.offset.x) || 0, oy = numOr(e.offset && e.offset.y) || 0;
    return (e.type === "INNER_SHADOW" ? "inset " : "") + `${ox}px ${oy}px ${numOr(e.radius)||0}px ${numOr(e.spread)||0}px ${rgba}`;
  });
  if (shadows.length) g.shadow = shadows.join(", ");
  // 反向（2026-07-21 补·治「Figma 去了投影 demo 没跟着改·三门全绿也漏」）：能承载 box-shadow 的类
  // 若显式无投影 → g.noShadow=true，让 geom-check 反向核「DOM 不该有 box-shadow」（forward g.shadow 一直就有）。
  else if (["FRAME","RECTANGLE","COMPONENT","COMPONENT_SET","INSTANCE","GROUP","TEXT","ELLIPSE"].includes(n.type)) g.noShadow = true;
  const lb = fx.find(e => e.type === "LAYER_BLUR");
  if (lb) g.blur = numOr(lb.radius);
  // 混合模式（2026-07-09 主动补）：非 NORMAL/PASS_THROUGH 才记 → CSS mix-blend-mode 标准关键词
  if (n.blendMode && BLEND[n.blendMode]) g.blend = BLEND[n.blendMode];
  // 元素整体透明度（2026-07-09 主动补）：<1 才记（1=默认）。注意区别于「半透明底色」(bg 的 alpha)
  if (typeof n.opacity === "number" && n.opacity < 0.999) g.opacity = Math.round(n.opacity * 100) / 100;
  return g;
}

const leaves = [];
const nodes = [];
const seenLeaf = new Set();
let _pathBudget = VECTOR_PATH_TOTAL_CHARS;   // 2026-07-27·path 合计预算
const _pathSkipped = [];                     // 因超限/是遮罩而没带 path 的矢量 id
let _paintRank = 0;   // 2026-07-22·paint 顺序秩(DFS前序=Figma上色序)·geomOf 里递增写进 g.z

function walkLeaves(n) {
  if (!n || seenLeaf.has(n.id)) return;
  seenLeaf.add(n.id);
  if (n.visible === false) return;
  const { w, h } = box(n);
  if (w === 0 || h === 0) return;
  if (isAtomicInstance(n)) {           // 图标/徽标实例：整体一张图·不拆碎片
    leaves.push({ id: n.id, name: n.name, type: n.type, w, h, atomic: true });
    return;
  }
  if (isMeaningfulLeaf(n)) {
    const item = { id: n.id, name: n.name, type: n.type, w, h };
    if (n.type === "TEXT" && typeof n.characters === "string") {
      // 2026-08-02：上限从 40 提到 TEXT_MAX（240）。40 字太短，还原时几乎每张稿都要为「取文案全文」
      // 额外开一次 use_figma（图层名靠不住：实测图层名 "US$ 10,000"、真文案 "Monthly Deals CNC Lase..."）。
      // 🔴 截断与否**显式标记**，别让下游靠 `endsWith("…")` 猜（2026-08-02 实测撞上）：
      //    文案自己就可能以 … 结尾（"Mgmt. Certification: ISO9001:2015, ISO45001:2018, …" 51 字，一个字没截），
      //    靠末尾字符猜 → geom 的文案逐字核会以为被截了、于是只比前半段 → 后半段写错也不报。
      // 🔴 **总是**写 textCut（0/1，不是只在截断时写）：只写 1 的话，消费端看到「没有这个字段」时
      //    分不清是「老 manifest 根本没这功能」还是「新 manifest 说没截断」，就只能退回猜 —— 白修。
      if (n.characters.length > TEXT_MAX) { item.text = n.characters.slice(0, TEXT_MAX) + "…"; item.textCut = 1; }
      else { item.text = n.characters; item.textCut = 0; }
    }
    if (hasImageFill(n)) item.img = true;
    leaves.push(item);
    return;
  }
  for (const c of (n.children || [])) walkLeaves(c);
}

// geom：全树采集（不在叶子停），DOM-driven 匹配自动筛，噪音无害
async function walkGeom(n, rootBB) {
  if (!n || n.visible === false) return;
  const { w, h } = box(n);
  if (w !== 0 && h !== 0 && w != null && h != null) nodes.push(await geomOf(n, rootBB));
  if (isAtomicInstance(n)) return;     // 同上·几何也不往里走（碎片全是同一个 bbox·比了也没意义）
  for (const c of (n.children || [])) await walkGeom(c, rootBB);
}

walkLeaves(root);
const rootBB = root.absoluteBoundingBox;   // 块根锚点·bx/by 相对它
await walkGeom(root, rootBB);

// ── 自带校验和（2026-07-27 立·两个用途，都不靠自觉）────────────────────────────
// ① 防手抄错：dump 要经我的上下文再落盘，是整条链上唯一会凭空产生错值的环节
//    （真栽过：抄箭头 path 漏了第二个子路径，回环变实心，渲染三轮才发现）。
// ② 防静默截断：**实测 use_figma 的返回超 20KB 会被直接截断**（不会自动落盘，试过了）。
//    本次 47 节点的 banner 就 11.5KB，页面稍大必超 → 半截 JSON 写进 manifest，三道门只核那半截、照样全绿。
// 落盘后跑 `node manifest-verify.js <manifest>` 本地重算比对，八项全等才算抄对/没截断。
// 各分量都与键顺序无关（计数 / 数值求和 / 排序后的字符串集合），所以手写文件的键序不同也能比。
const _s = JSON.stringify({ leaves, nodes });
const _nums = (_s.match(/-?\d+\.?\d*(?:e-?\d+)?/g) || []).map(Number);
const _ids = [...leaves.map(x => x.id), ...nodes.map(x => x.id)].sort();
const _strs = (_s.match(/"[^"]*"/g) || []).sort();

// ── 列式打包（2026-07-27 立·自适应，不无条件用）────────────────────────────────
// manifest 必须**经过上下文再落盘**（Figma 返回值不能直接写文件），落盘那一步是整条链最贵的：
// 117KB 的整页 manifest ≈ 3.5 万 token。列式化把重复的键名收成一份 —— 实测 729 节点省 36.7%、
// 147 节点省 20%、47 节点只省 2.2%（小稿的字节大头是矢量 path 不是键名）。
// 所以算完两种、**只有列式明显更小（≥12%）才用**，小稿照旧返回普通对象，免得白添一步解包。
// 无损性由 digest 兜底：digest 的八项全部与键序无关，解包后跑 manifest-verify 八项全等即证无损。
function packPart(L, N) {
  const cols = (rows) => {
    const keys = [];
    for (const r of rows) for (const k of Object.keys(r)) if (keys.indexOf(k) < 0) keys.push(k);
    const vals = rows.map(r => { const a = keys.map(k => (k in r ? r[k] : null)); while (a.length && a[a.length - 1] === null) a.pop(); return a; });
    return { keys, vals };
  };
  const cl = cols(L), cn = cols(N);
  const packed = { _packed: 1, lk: cl.keys, lv: cl.vals, nk: cn.keys, nv: cn.vals };
  const plainLen = JSON.stringify({ leaves: L, nodes: N }).length;
  const packLen = JSON.stringify(packed).length;
  return (packLen <= plainLen * 0.88) ? { packed: packed, plainLen: plainLen, packLen: packLen } : null;
}

// ── 按预算切片（每块都带全量 _digest / count / geomCount，合并后可校验）──
let _used = 0;
const _outLeaves = [], _outNodes = [];
let _li = FROM_LEAF, _ni = FROM_NODE;
while (_li < leaves.length) {
  const _c = JSON.stringify(leaves[_li]).length + 1;
  if (_used + _c > BUDGET && _outLeaves.length) break;
  _outLeaves.push(leaves[_li]); _used += _c; _li++;
}
while (_ni < nodes.length) {
  const _c = JSON.stringify(nodes[_ni]).length + 1;
  if (_used + _c > BUDGET && (_outNodes.length || _outLeaves.length)) break;
  _outNodes.push(nodes[_ni]); _used += _c; _ni++;
}
const _part = {
  fromLeaf: FROM_LEAF, nextLeaf: _li, fromNode: FROM_NODE, nextNode: _ni,
  more: (_li < leaves.length) || (_ni < nodes.length),
  bytes: _used,
  // 单个元素就超预算时仍会被放进来（否则死循环）→ 这一块可能超 20KB 被截断，必须显式报出来
  oversize: _used > BUDGET,
  pathSkipped: _pathSkipped,
  hint: ((_li < leaves.length) || (_ni < nodes.length))
    ? ("还没抽完 → 把 FROM_LEAF 改成 " + _li + "、FROM_NODE 改成 " + _ni + " 再跑一次")
    : "已抽完（本块是最后一块）",
  warn: (_used > BUDGET ? "⚠️ 本块 " + _used + " 字符已超 BUDGET（多半是某个矢量 path 太大）→ 调小 BUDGET 或调高 VECTOR_PATH_MIN_AREA 重抽" : "")
        + (_pathSkipped.length ? " ⚠️ 有 " + _pathSkipped.length + " 个矢量没带 path（见 pathSkipped），要用就单独读那个节点" : ""),
};

// ── 分块接力（2026-07-27 立·根治「大页面每续抽一块，就要把这 440 行原样再贴一次」）──────
// 实测账：整页 manifest 常在 100-300KB（QC 侧栏那份 117KB / 729 节点），按 19KB 一块要 6-16 次调用。
// 返回值的 20KB 上限省不掉（那 6-16 趟输出是真数据），**但输入端的重复粘贴是纯浪费**：
// 每趟重贴 440 行 ≈ 7000 token ≈ 2.5 分钟，一份大页面光重贴就 15-40 分钟。
// 做法：第一趟就把整棵树走完、把后续每一块**预先存进根节点的 shared plugin data**
// （实测：单条上限 100KB、多条可并存、跨 use_figma 调用保留、置空即删）。
// 后续每块只要 3 行取回，440 行只贴这一次。
// 诚实边界：这会在设计文件上写一点不可见的元数据（会进版本历史）。所以——
//   · 只有真的分块了才写（单块 dump 一个字节都不写）；
//   · 写之前先清掉自己上次的残留；
//   · 取回的 3 行里带「解析成功才删」的自清理，最后一块取完文件就干净了。
// ── 图标实例顺手导 SVG（2026-08-02 立·省掉「取素材」那一整轮往返）──────────────
// 血泪账：折叠成一张图的实例（brand logo / audited / star / supplier-logo）id 长这样 `I191:...;163:3121`，
// `download_assets` 和 `get_screenshot` 的 nodeId 正则都不认，当场报 Invalid arguments；而 `getNodeByIdAsync`
// 对实例内部节点直接返回 null（只能从 root 用 children 递归找）。2026-08-02 为这 4 个徽标单独开了 4 次
// use_figma（找节点 → 导出 → 超 20KB 分块 → 取回两次）。本段把它并进 dump 这一次调用里。
// 顺带治一类判断错：改走「祖先一次全下 + 本地按尺寸/颜色认领」时，实测把 Audited 字标的颜色认成了黑色
// （真值 #34469B），手拼必错 —— 整体导出就没有认领这一步。
let _assets = null;
if (EXPORT_ATOMIC_SVG && FROM_LEAF === 0 && FROM_NODE === 0) {
  try {
    for (const k of root.getSharedPluginDataKeys("mfa")) root.setSharedPluginData("mfa", k, "");
    const _atomIds = new Set(leaves.filter(x => x.atomic).map(x => x.id));
    const _atomNodes = [];
    (function findAtoms(n) {
      if (!n || !_atomIds.size) return;
      if (_atomIds.has(n.id)) { _atomNodes.push(n); _atomIds.delete(n.id); return; }
      for (const c of (n.children || [])) findAtoms(c);
    })(root);
    const items = [], skipped = [];
    let used = 0;
    for (const n of _atomNodes) {
      if (used >= ATOMIC_SVG_BUDGET) { skipped.push(n.id + "(总预算用完)"); continue; }
      let svg = "";
      try {
        const buf = await n.exportAsync({ format: "SVG" });
        for (let i = 0; i < buf.length; i += 4096) svg += String.fromCharCode.apply(null, buf.subarray(i, i + 4096));
      } catch (e) { skipped.push(n.id + "(" + String(e && e.message || e).slice(0, 40) + ")"); continue; }
      used += svg.length;
      items.push({ id: n.id, name: n.name, w: Math.round(n.width), h: Math.round(n.height), svg: svg });
    }
    if (items.length) {
      const keys = []; let cur = [], curLen = 0, idx = 1;
      const flush = () => { if (!cur.length) return; root.setSharedPluginData("mfa", "a" + idx, JSON.stringify({ items: cur })); keys.push("a" + idx); idx++; cur = []; curLen = 0; };
      for (const it of items) {
        const L = JSON.stringify(it).length;
        if (curLen + L > 80000 && cur.length) flush();     // sharedPluginData 单条上限 100KB·留余量
        cur.push(it); curLen += L;
      }
      flush();
      _assets = {
        ns: "mfa", keys: keys, count: items.length, chars: used, skipped: skipped,
        取回脚本: '图标实例的 SVG 已导好存在这儿，别再单独 download_assets / exportAsync。按顺序把 ' + keys.join("/") +
          ' 各取一次，每次只贴这 3 行（KEY 换成 a1、a2…）：\n' +
          'const n = await figma.getNodeByIdAsync("' + ROOT_ID + '");\n' +
          'const d = JSON.parse(n.getSharedPluginData("mfa", "KEY"));   // 解析成功才删·失败可重取\n' +
          'n.setSharedPluginData("mfa", "KEY", ""); return d;',
        落盘: "每个 item 是 {id,name,w,h,svg}，svg 是**整体导出**（自带容器底色/描边/节点级 opacity）—— " +
          "直接内联，别按零件手拼。⚠️ 节点自身的 opacity 已被烤进最外层 <g>，若要在 CSS 上承载 opacity 就把那层的属性剥掉，别双份。",
      };
    } else if (skipped.length) {
      _assets = { skipped: skipped, note: "一个都没导成 → 退回逐节点 download_assets" };
    }
  } catch (e) { _assets = { failed: String(e && e.message || e).slice(0, 160) }; }
}

const RELAY = true;
if (_part.more && RELAY && FROM_LEAF === 0 && FROM_NODE === 0) {
  try {
    for (const k of root.getSharedPluginDataKeys("mfr")) root.setSharedPluginData("mfr", k, "");   // 清上次残留
    let li = _li, ni = _ni, idx = 1;
    const written = [];
    while (li < leaves.length || ni < nodes.length) {
      let used = 0; const L = [], N = [];
      while (li < leaves.length) { const c = JSON.stringify(leaves[li]).length + 1; if (used + c > BUDGET && L.length) break; L.push(leaves[li]); used += c; li++; }
      while (ni < nodes.length) { const c = JSON.stringify(nodes[ni]).length + 1; if (used + c > BUDGET && (N.length || L.length)) break; N.push(nodes[ni]); used += c; ni++; }
      if (!L.length && !N.length) break;
      const _pp = packPart(L, N);                                  // 大块通常列式更小 → 存列式（merge 会自动解包）
      root.setSharedPluginData("mfr", "p" + idx, JSON.stringify(_pp ? _pp.packed : { leaves: L, nodes: N }));
      written.push("p" + idx); idx++;
    }
    _part.relay = {
      node: ROOT_ID, ns: "mfr", keys: written, parts: written.length + 1,
      取回脚本: '按顺序把 ' + written.join("/") + ' 各取一次，每次只贴这 3 行（把 KEY 换成 p1、p2…）：\n' +
        'const n = await figma.getNodeByIdAsync("' + ROOT_ID + '");\n' +
        'const d = JSON.parse(n.getSharedPluginData("mfr", "KEY"));   // 解析成功才删·失败可重取\n' +
        'n.setSharedPluginData("mfr", "KEY", ""); return d;',
      落盘: "把各块的 leaves/nodes 按顺序拼进同一个 <页面>-manifest.json（本块已是第 1 块），" +
            "头部 _digest/_root/count/geomCount 用本次返回的；拼完跑 manifest-verify.js，八项全等才算没抄漏。",
    };
    _part.hint = "已把后续 " + written.length + " 块预存到根节点 shared plugin data —— 别再重贴这 440 行，照 _part.relay.取回脚本 走（3 行/块）。";
  } catch (e) {
    _part.relay = { failed: String(e && e.message || e).slice(0, 160), fallback: "接力没写成 → 退回老办法：改 FROM_LEAF/FROM_NODE 重贴 snippet 续抽" };
  }
}

const _ret = packPart(_outLeaves, _outNodes);   // null = 列式不划算，照旧发普通对象

return {
  root: ROOT_ID,
  rootName: root.name,
  // 🔴 落盘后必须跑 manifest-verify.js 核这八项（抄漏/截断都会被抓）
  _digest: {
    leafCount: leaves.length,
    nodeCount: nodes.length,
    numCount: _nums.length,
    numSum: Math.round(_nums.reduce((a, b) => a + b, 0) * 100000) / 100000,
    idsJoinedLen: _ids.join(",").length,
    strCount: _strs.length,
    strTotalLen: _strs.join("").length,
    jsonLen: _s.length,
  },
  // _root（2026-07-21 根治「多块混改残缝」地基）：记本次 dump 的根是不是「顶层帧」(parent 是 PAGE)。
  //   顶层根 = 整个交付页/帧 → coverage 逐叶核销能覆盖所有块；子块根(如单个亮点展台) = 只覆盖该块，
  //   多块混改时别的块漏无人拦。门据此判「你只 dump 了子块、没 dump 整页根」。
  _root: {
    id: ROOT_ID, name: root.name,
    w: rootBB ? Math.round(rootBB.width) : null,
    h: rootBB ? Math.round(rootBB.height) : null,
    topLevel: !!(root.parent && root.parent.type === "PAGE"),
  },
  count: leaves.length,       // coverage-check 读它（完整性·始终是**全量**总数）
  geomCount: nodes.length,    // 同上·全量总数（合并后 manifest-verify 拿它比实际数组长度）
  _part: _part,               // 分块信息：more=true 就按 nextLeaf/nextNode 续抽
  _assets: _assets,           // 图标实例的 SVG（已存 sharedPluginData·按 _assets.取回脚本 取，别再单独导）
  // 本块数据：列式明显更小就发列式（带 _packed:1），否则照旧发普通对象数组
  ...(_ret
    ? { _packed: 1, lk: _ret.packed.lk, lv: _ret.packed.lv, nk: _ret.packed.nk, nv: _ret.packed.nv,
        _packInfo: { 原始字符: _ret.plainLen, 列式字符: _ret.packLen,
          省: Math.round((1 - _ret.packLen / _ret.plainLen) * 1000) / 10 + "%",
          落盘: "这块是**列式传输格式**。单块：原样写 <页面>-packed.json → 跑 manifest-pack.js --unpack 得到正式 manifest → 再跑 manifest-verify（digest 八项全等即证无损）。多块：每块各写一个文件 → manifest-merge.js 会自动解包并合并校验。" } }
    : { leaves: _outLeaves,   // ← coverage-check.js 用（本块切片）
        nodes: _outNodes }),  // ← geom-check.js --figma-spec 用（本块切片）
};
