// 飞鹊 Figma 组件自检验证脚本
// 用法：在 use_figma 中执行此脚本内容，传入要检查的 Component Set ID
// 返回一份检查报告，列出所有违规项

// ====== 使用方法 ======
// 在 use_figma 里调用时，替换下面的 TARGET_ID 为实际的 Component Set 节点 ID
// const TARGET_ID = '3423:9157'; // 替换为实际 ID

async function verify(targetId, opts) {
  // opts（可选）：{ scene: 'ops' | 'ui' } —— 目前只有检查 11（阿语字体）看它。
  //   'ops' = 运营视觉素材（banner/EDM/Push/YML/专题），阿语字体必须 Amiri；
  //   'ui'  = 项目/UI/交互稿，阿语照飞鹊 SOT 用 Roboto，跳过字体判定（RTL 那半仍然查）。
  //   不传 = 靠节点名嗅探猜场景，猜不到按 'ui' 走（见检查 11 注释里的漏报边界）。
  const OPTS = opts || {};

  // 🔴 必须第一行：插件宿主默认 skipInvisibleInstanceChildren=true，实例内部隐藏节点会被 findAll/children 整个跳过。
  // 不关掉的话本脚本自己就有盲区（2026-07-27 栽过：误判「飞鹊 button 没有图标+文字变体」，其实只是槽位 visible=false 被跳过了）。
  figma.skipInvisibleInstanceChildren = false;

  // 🔴 必须用 Async 版（2026-07-27 修）：use_figma 每次调用 figma.currentPage 都重置到【第一个 page】，
  // 同步 figma.getNodeById() 拿不到未加载页面上的节点 → 直接返回 "Node not found"。
  // 后果极坏：门返回的是 error 而不是报告，看着像「跑过了」实则整个空转（假门）。
  // 只要目标稿不在文件首页就必现。getNodeByIdAsync 会自动加载所在页，跨 page 也拿得到。
  const node = await figma.getNodeByIdAsync(targetId);
  if (!node) return { error: `Node ${targetId} not found（已用 Async 版仍找不到 = ID 真的不存在，不是页面未加载）` };

  const report = {
    target: { name: node.name, id: node.id, type: node.type },
    violations: [],
    passed: [],
    notCovered: [],   // 这道检查这次一个对象都没扫到 —— 不是「通过」，是「没查」
    summary: '',
  };

  function addViolation(category, message, nodeId, nodeName) {
    report.violations.push({ category, message, nodeId, nodeName });
  }
  function addPass(category) {
    report.passed.push(category);
  }
  // 🔴 0 个对象上的「通过」必须跟真通过分开报（feedback-gate-coverage-must-be-declared）。
  // 为什么不做成「跳过」：跳过听起来像门变松了，而真相是「这次没有可查的东西」——
  // 后者信息量更大，也拦得住「14 项通过里 8 项其实一个对象都没扫到」这种假安全感。
  // 判据一律用「实际扫到的对象数」，不用节点类型猜。
  function addSkip(category, why) {
    report.notCovered.push(`⬜ ${category}（未覆盖：${why}）`);
  }

  // 获取所有变体
  const variants = node.type === 'COMPONENT_SET' ? node.children : [node];

  // 🔴🔴 性能（2026-08-13 实测立）：全量遍历只做一次，之后所有检查共用这份缓存。
  // 实测这张 6067 节点的稿：单次 findAll 要 1553ms，而门里 node.findAll 出现约 15 次 = 白烧 23 秒；
  // 而我原以为的瓶颈「表达重复 O(n²)」实测只占 8ms —— 别再照旧归因，先量。
  // 🔴 顺带补掉一个久欠的盲区：findAll 扫不到实例路径 ≥3 层的深层嵌套节点（实测 434 vs 419），
  //    自写 children 递归是 findAll 的超集 → 这次替换既更快又更严（违规数可能变多，那是本来就该报的）。
  const ALL = [];
  (function walk(n) { if (n !== node) ALL.push(n); if (n.children) for (const c of n.children) walk(c); })(node);
  function findAllCached(cb) { const out = []; for (const n of ALL) { if (!cb || cb(n)) out.push(n); } return out; }
  // mainComponent 同理只解析一次：实测 777 个实例首轮 4228ms，而 5 个检查各跑一遍全部实例。
  const _mcCache = new Map();
  async function mcOf(inst) {
    if (_mcCache.has(inst.id)) return _mcCache.get(inst.id);
    let mc = null;
    try { mc = await inst.getMainComponentAsync(); } catch (e) { mc = null; }
    _mcCache.set(inst.id, mc);
    return mc;
  }

  // ===== 1. 组件实例检查 =====
  let manualFrameButtons = 0;
  for (const variant of variants) {
    (variant === node ? findAllCached : variant.findAll.bind(variant))(n => {
      // 检查是否有手动创建的按钮（FRAME 类型，有 fills，名称像按钮）
      if (n.type === 'FRAME' && n.parent?.type !== 'COMPONENT_SET') {
        const btnNames = ['Submit', 'Reset', 'Search', 'Login', 'Log In', 'Next', 'Previous', 'Cancel', 'Confirm', 'Save', 'Delete', 'Add', 'Register'];
        if (btnNames.some(name => n.name === name) && n.fills?.length > 0) {
          // 检查是否真的是手动 Frame（不是 Instance）
          addViolation('组件实例', `手动 Frame 按钮: "${n.name}" 应用飞鹊 botton 组件实例`, n.id, n.name);
          manualFrameButtons++;
        }
      }
      return false;
    });
  }
  if (manualFrameButtons === 0) addPass('组件实例：未发现手动 Frame 按钮');

  // ===== 2. 零硬编码检查 =====
  // 向上追溯所有祖先，判断节点是否在某个 INSTANCE 内部（包括深层嵌套）
  function isInsideInstance(n) {
    let p = n.parent;
    while (p) {
      if (p.type === 'INSTANCE') return true;
      p = p.parent;
    }
    return false;
  }

  // 🔴 声明式豁免：`【现有元素·不用开发】` 区（线上页面抓取来的底图，前端不做，颜色不绑 token 是有意的）
  // 立这条的实测依据（2026-08-13）：PPC 稿上 2100+ 条零硬编码逐条查过祖先链，**只有 8 条不在这个区里**，
  // 门却每次把两千多条已定性的误报全吐出来（单次返回 20KB+）—— 而**门的返回值本身就是生成成本**
  // （要逐条判断哪条是误报 = 大量生成），它伪装成「只有一次调用」，比「调用次数多」更隐蔽。
  // 🔴 判据故意用**方括号标记前缀**，不用「现有元素」这几个字：memory 记过一次，
  //    图层名叫 `spec-10·现有元素不用开发` 的**说明文字**被关键词匹配误判成系统件跳过、漏改一处。
  //    说明文字不会以 `【现有元素·不用开发】` 开头 → 前缀判据能把「底图容器」和「讲底图的说明」分开。
  // 🔴 自身也算（那个容器自己的底色同样是抓来的）。这跟「拼祖先链别把节点自身算进去」不冲突 ——
  //    那条治的是**模糊关键词**匹配，这里是精确标记前缀。
  // 🔴 豁免必须**声明式**：豁免多少条一律写进报告（见下方 addPass），不许静默跳过变成假绿。
  const EXEMPT_MARK = '【现有元素·不用开发】';
  function inExemptZone(n) {
    for (let a = n; a; a = a.parent) {
      if (String(a.name || '').indexOf(EXEMPT_MARK) === 0) return true;
    }
    return false;
  }

  let hardcodedFills = 0;
  let hardcodedStrokes = 0;
  let exemptedHardcode = 0;
  for (const variant of variants) {
    (variant === node ? findAllCached : variant.findAll.bind(variant))(n => {
      // 检查 fills 硬编码
      if (n.fills && n.fills.length > 0 && n.fills[0].type === 'SOLID' && n.fills[0].visible !== false) {
        try {
          const styleId = n.fillStyleId;
          if (!styleId || styleId === '') {
            // 排除所有 Instance 内部节点（含深层嵌套），它们继承组件样式
            if (!isInsideInstance(n)) {
              if (inExemptZone(n)) { exemptedHardcode++; }
              else {
                const c = n.fills[0].color;
                const hex = `#${Math.round(c.r*255).toString(16).padStart(2,'0')}${Math.round(c.g*255).toString(16).padStart(2,'0')}${Math.round(c.b*255).toString(16).padStart(2,'0')}`;
                addViolation('零硬编码', `fills 未绑定 Paint Style: ${hex}`, n.id, n.name);
                hardcodedFills++;
              }
            }
          }
        } catch(e) {}
      }
      // 检查 strokes 硬编码
      if (n.strokes && n.strokes.length > 0 && n.strokes[0].type === 'SOLID') {
        try {
          const styleId = n.strokeStyleId;
          if (!styleId || styleId === '') {
            if (!isInsideInstance(n)) {
              if (inExemptZone(n)) { exemptedHardcode++; }
              else {
                const c = n.strokes[0].color;
                const hex = `#${Math.round(c.r*255).toString(16).padStart(2,'0')}${Math.round(c.g*255).toString(16).padStart(2,'0')}${Math.round(c.b*255).toString(16).padStart(2,'0')}`;
                addViolation('零硬编码', `strokes 未绑定 Paint Style: ${hex}`, n.id, n.name);
                hardcodedStrokes++;
              }
            }
          }
        } catch(e) {}
      }
      return false;
    });
  }
  const exemptNote = exemptedHardcode
    ? `（另有 ${exemptedHardcode} 条在 ${EXEMPT_MARK} 区内，声明式豁免：线上抓取底图·前端不做·颜色不绑 token 是有意的）`
    : '';
  if (hardcodedFills === 0 && hardcodedStrokes === 0) addPass('零硬编码：所有颜色已绑定 Paint Style' + exemptNote);
  else if (exemptedHardcode) addPass(`零硬编码·豁免声明：${exemptedHardcode} 条在 ${EXEMPT_MARK} 区内未计入违规（线上抓取底图·前端不做）；区外真违规 ${hardcodedFills + hardcodedStrokes} 条见上`);

  // ===== 3. 描边标识检查 =====
  if (node.type === 'COMPONENT_SET') {
    // Component Set 应有紫色描边
    const hasPurpleStroke = node.strokes.length > 0 && node.strokes[0].type === 'SOLID' &&
      Math.abs(node.strokes[0].color.r - 0.541) < 0.05 &&
      Math.abs(node.strokes[0].color.g - 0.220) < 0.05 &&
      Math.abs(node.strokes[0].color.b - 0.961) < 0.05;
    if (!hasPurpleStroke) {
      addViolation('描边标识', 'Component Set 缺少紫色描边 (#8A38F5)', node.id, node.name);
    } else {
      addPass('描边标识：Component Set 有紫色描边');
    }

    // 变体不应有描边 —— 但「描边就是这个变体的语义」时豁免（2026-08-26 修）：
    // badge 的 `Bordered=true`、卡片的 `outline=true` 这类轴，描边正是它存在的理由，
    // 无条件判红等于要求它别做自己（TM组件 badge SET 常驻 2 条假红）。
    // 判据：任一轴名命中 border/outline/stroke/描边/边框 且该轴值为真 → 跳过。
    const BORDER_AXIS = /border|outline|stroke|描边|边框/i;
    const AXIS_TRUTHY = /^(true|yes|on|1|有|是)$/i;
    for (const variant of variants) {
      if (!(variant.strokes && variant.strokes.length > 0)) continue;
      let byDesign = false, vp = null;
      try { vp = variant.variantProperties; } catch (e) { vp = null; }
      if (vp) for (const k of Object.keys(vp)) {
        if (BORDER_AXIS.test(k) && AXIS_TRUTHY.test(String(vp[k]))) { byDesign = true; break; }
      }
      if (byDesign) continue;
      addViolation('描边标识', `变体 "${variant.name}" 不应有描边`, variant.id, variant.name);
    }
  }

  // ===== 4/5. description + 变体命名检查 =====
  // 🔴 只对 COMPONENT_SET 跑（2026-07-27 修）：`variants` 在非组件集时退化成 [node] 本身，
  // 于是拿「组件变体」的标准去查一个普通画板/frame —— 交互稿画板叫「飞鹊·点开Categories弹窗」
  // 就会常驻报两条假红（"变体包含大写字母" + "变体描述过短"）。
  // 假红的真实代价：每次报告都有几条红的 → 人对门脱敏 → 真违规也被当噪音划过去，门等于失效。
  if (node.type === 'COMPONENT_SET') {
    for (const variant of variants) {
      if (!variant.description || variant.description.length < 50) {
        addViolation('description', `变体 "${variant.name}" 描述为空或过短 (${variant.description?.length || 0} 字符)`, variant.id, variant.name);
      }
    }
    const allHaveDesc = variants.every(v => v.description && v.description.length >= 50);
    if (allHaveDesc) addPass('description：所有变体描述完整');

    // 🔴 只查 variant 的「值」，不查轴名（2026-08-26 修）：变体名是 Figma 的 `轴名=值` schema。
    // 轴名的大小写在建集时就定了、改小写会直接破坏轴，所以拿整串比 toLowerCase() 等于
    // 对每个带大写轴名的组件集常驻报红（`Type=number, Bordered=false` 一次报 8 条）。
    // 要管的是值的命名规范；轴名不在本门管辖范围。
    for (const variant of variants) {
      const badVals = String(variant.name).split(',').map(x => x.trim()).filter(Boolean)
        .map(pair => { const i = pair.indexOf('='); return i === -1 ? null : pair.slice(i + 1).trim(); })
        .filter(v => v && v !== v.toLowerCase());
      if (badVals.length) {
        addViolation('命名', `变体 "${variant.name}" 的 variant 值含大写字母（${badVals.join('、')}）→ 值统一小写；轴名大小写本门不管`, variant.id, variant.name);
      }
    }
  }

  // ===== 6. 按钮顺序检查 =====
  for (const variant of variants) {
    const actionsFrames = (variant === node ? findAllCached : variant.findAll.bind(variant))(n => n.name === 'Actions' && n.type === 'FRAME');
    for (const actions of actionsFrames) {
      const btns = actions.children.filter(c => c.type === 'INSTANCE' || c.type === 'FRAME');
      if (btns.length >= 2) {
        const firstBtn = btns[0];
        const secondBtn = btns[1];
        // 检查是否主按钮在左
        const primaryNames = ['Submit', 'Search', 'Next', 'Register', 'Confirm', 'Save', 'Log In'];
        const secondaryNames = ['Reset', 'Cancel', 'Previous', 'Back'];
        if (secondaryNames.includes(firstBtn.name) && primaryNames.includes(secondBtn.name)) {
          addViolation('按钮顺序', `"${firstBtn.name}" 在 "${secondBtn.name}" 左边，应该主按钮在左`, actions.id, actions.name);
        }
      }
    }
  }

  // ===== 7. disabled 灰化检查 =====
  for (const variant of variants) {
    if (variant.name.includes('disabled')) {
      // 检查所有可见的 VECTOR/TEXT 节点颜色是否为灰色
      (variant === node ? findAllCached : variant.findAll.bind(variant))(n => {
        if (n.type === 'VECTOR' && n.visible && n.fills?.length > 0 && n.fills[0].type === 'SOLID') {
          const c = n.fills[0].color;
          const rgb = `rgb(${Math.round(c.r*255)},${Math.round(c.g*255)},${Math.round(c.b*255)})`;
          // 不是灰色(#B3B3B3)也不是白色也不是透明
          if (c.r < 0.6 && !(c.r === c.g && c.g === c.b)) {
            addViolation('disabled灰化', `disabled 变体内 "${n.name}" 颜色 ${rgb} 未灰化`, n.id, n.name);
          }
        }
        return false;
      });
    }
  }

  // ===== 8. 固高塌陷检测（根治反复出现的「resize 重置 sizing 未补 HUG/FILL」坑）=====
  // 原理：auto-layout 容器纵轴 FIXED + 实际高度 < 子内容所需高度 = 塌陷（几乎不误报）。
  // 覆盖：product-card 固高、resize(w,10) 表头/卡塌成 10、图片做成固高横条等历史 case。
  let collapseCount = 0, imgRatioCount = 0;
  // 图片比例的「查了几张 / 跳了几张 / 为什么跳」——跳过必须报出来（学 coverage 的 skip+reason·不许静默）
  let imgRatioChecked = 0, imgRatioSkipped = 0;
  const imgSkipWhy = {};
  // 🔴 2026-08-03 补 8a 的判据缺口（这道门本来就是为治「resize 重置 sizing」建的·却没抓住我）：
  //   原判据只报「已经塌了的」(height < need)。但 resize(w, n.height) 传的是**当前**高度，
  //   结果是「高度刚好、视觉看不出、sizing 已经是 FIXED」—— 改一次内容就塌，门却全绿。
  //   实测：GSSM 交付表调三次列宽，每次 resize 都把两轴打回 FIXED，门一声不响，靠吉吉眼看出来。
  //   所以补「固高未申报」档：纵轴 FIXED 且未 STRETCH/FILL，不管当前塌没塌都点名。
  //   ⚠️ 级（不是 🔴）+ 声明式豁免：真要固高就在图层名里申报，避免制造噪音让人对门脱敏。
  let fixedUndeclared = 0;
  const FIXED_DECLARED = /固高|定高|固定高|裁切|裁到|fixed\s*h|clip/i;
  findAllCached(n => {
    // 只查「手搭」节点：组件实例内部 / 实例本身的布局是组件定义的（含 rescale 后），不归本检测 policing
    if (isInsideInstance(n) || n.type === 'INSTANCE') return false;
    // 8a · auto-layout 容器纵轴 FIXED 且塌陷
    if ('layoutMode' in n && n.layoutMode && n.layoutMode !== 'NONE' && 'children' in n) {
      const isV = n.layoutMode === 'VERTICAL';
      const axisSizing = isV ? n.primaryAxisSizingMode : n.counterAxisSizingMode;
      // 纵轴 FIXED，且不是有意等高（LSV=FILL 是等高对齐，豁免）
      if (axisSizing === 'FIXED' && n.layoutSizingVertical !== 'FILL') {
        const pad = (n.paddingTop || 0) + (n.paddingBottom || 0);
        const kids = n.children.filter(c => c.visible !== false && c.layoutPositioning !== 'ABSOLUTE');
        let need;
        if (isV) {
          const gaps = Math.max(0, kids.length - 1) * (n.itemSpacing || 0);
          need = kids.reduce((s, c) => s + c.height, 0) + gaps + pad;
        } else {
          need = (kids.length ? Math.max(...kids.map(c => c.height)) : 0) + pad;
        }
        // 排除「图片裁切框」：子节点全是图片/实例时，FIXED 高 + clip 是有意裁切到尺寸（如把 136 图组件裁成 112 方图），非固高 bug。
        // 真 bug = 文字/内容容器被压裁（表头 h10 裁字、product-card 塌陷），其子节点含 TEXT/普通 FRAME。
        const allImgOrInstance = kids.length > 0 && kids.every(c => c.type === 'INSTANCE' || ((c.type === 'RECTANGLE' || c.type === 'FRAME') && Array.isArray(c.fills) && c.fills.some(f => f.type === 'IMAGE')));
        if (kids.length > 0 && n.height < need - 1 && !allImgOrInstance) {
          addViolation('固高塌陷', `容器纵轴 FIXED 高 ${Math.round(n.height)}px < 子内容需 ${Math.round(need)}px（疑 resize 重置 sizing 未补 HUG/FILL）`, n.id, n.name);
          collapseCount++;
        // ⚠️ 豁免只认外层那个 `layoutSizingVertical !== 'FILL'`。别再加 layoutAlign!=='STRETCH'：
        //    在 VERTICAL 父容器里 STRETCH 是**横向**撑满、跟纵轴固高无关，加了会错误豁免（写自测造反例时抓到的）。
        } else if (kids.length > 0 && !allImgOrInstance && !FIXED_DECLARED.test(String(n.name || ''))) {
          // 还没塌，但纵轴已是 FIXED = 改一次内容就塌（视觉上完全看不出，所以只能靠门）
          addViolation('固高未申报⚠️', `容器纵轴 FIXED（高 ${Math.round(n.height)}px·当前刚够放 ${Math.round(need)}px）→ 现在没塌，改一次内容就塌；resize() 会把两轴打回 FIXED，之后必须补回 HUG 或 layoutAlign='STRETCH'。确属有意固高：在图层名里申报（带「固高」/「定高」/「裁切」）`, n.id, n.name);
          fixedUndeclared++;
        }
      }
    }
    // 8b · 图片非 1:1（飞鹊产品图铁律 1:1·banner/横图请人工确认豁免，故标 ⚠️ 提示非硬违规）
    // 🔴 2026-07-27 收紧判据（吉吉「只去误报，不降检查强度」）：原判据「有 IMAGE 填充且宽≠高」
    // 在插画上会集体误报 —— 还原 banner 496:18122 时一次刷了 16 条，全打在购物篮插画内部的
    // 小矩形上（3×8 / 4×10 / 48×34…）。那些是插画零件，不是产品图，1:1 这条铁律对它们不成立。
    // 代价不是"多几条红字"：figma-verify 自己顶部就写过 ——「每次报告都有几条红 → 人对门脱敏 →
    // 真违规也被当噪音划过去，门等于失效」。所以排除三类**明确不是产品图**的：
    //   · scaleMode=CROP：手动裁切过的填充 = 从整张插画/雪碧图上抠的一块（产品图用 FILL/FIT）
    //   · 祖先链上有遮罩/裁剪组：那是插画的内部结构
    //   · 最长边 < 40px：产品图不会这么小
    // 三张真产品图（FILL·86/172/110 见方）仍照查。跳过的数量和原因在下方 addPass 里报出来，不静默。
    if ((n.type === 'RECTANGLE' || n.type === 'FRAME') && Array.isArray(n.fills) && n.fills.some(f => f.type === 'IMAGE' && f.visible !== false)) {
      const imgf = n.fills.find(f => f.type === 'IMAGE' && f.visible !== false);
      let inMask = false;
      for (let a = n.parent; a && a.id !== node.id; a = a.parent)
        if (/clip\s*path|clippath|mask|蒙版|遮罩/i.test(String(a.name || ''))) { inMask = true; break; }
      const tiny = Math.max(n.width, n.height) < 40;
      const cropped = imgf && imgf.scaleMode === 'CROP';
      if (cropped || inMask || tiny) {
        imgRatioSkipped++;
        if (cropped) imgSkipWhy.CROP裁切填充 = (imgSkipWhy.CROP裁切填充 || 0) + 1;
        else if (inMask) imgSkipWhy.遮罩裁剪组内 = (imgSkipWhy.遮罩裁剪组内 || 0) + 1;
        else imgSkipWhy['小于40px'] = (imgSkipWhy['小于40px'] || 0) + 1;
      } else if (Math.abs(n.width - n.height) > 1) {
        addViolation('图片比例⚠️', `图片 ${Math.round(n.width)}×${Math.round(n.height)} 非 1:1（飞鹊产品图默认 1:1·banner/横图请人工确认豁免）`, n.id, n.name);
        imgRatioCount++;
      } else imgRatioChecked++;
    }
    // 8c · TEXT 节点固高裁切（textAutoResize=NONE/TRUNCATE 且高度 < 行数所需 = 文字被压裁；如 resize(w,10) 重置了 textAutoResize 没补回 'HEIGHT'）
    if (n.type === 'TEXT' && (n.textAutoResize === 'NONE' || n.textAutoResize === 'TRUNCATE')) {
      let lh = 16;
      try { lh = (n.lineHeight && n.lineHeight.unit === 'PIXELS') ? n.lineHeight.value : (typeof n.fontSize === 'number' ? n.fontSize * 1.3 : 16); } catch (e) {}
      const explicitLines = (n.characters.match(/\n/g) || []).length + 1;
      const needH = explicitLines * lh;
      if (n.height < needH - 1) {
        addViolation('文字固高裁切', `TEXT autoResize=${n.textAutoResize} 高 ${Math.round(n.height)}px < ${explicitLines} 行需 ${Math.round(needH)}px（疑 resize 重置 textAutoResize·应设 'HEIGHT'）`, n.id, n.name);
        collapseCount++;
      }
    }
    return false;
  });
  if (collapseCount === 0 && fixedUndeclared === 0) addPass('固高：无 auto-layout 容器纵轴 FIXED（含"还没塌但迟早塌"的未申报固高）');
  else if (collapseCount === 0) addPass(`固高塌陷：无已塌陷容器（另有 ${fixedUndeclared} 处未申报固高，见违规项）`);
  if (imgRatioCount === 0) {
    if (imgRatioChecked === 0 && imgRatioSkipped === 0) addSkip('图片比例', '这张稿里一张图都没有');
    else addPass(`图片比例：${imgRatioChecked} 张按 1:1 核过`
      + (imgRatioSkipped ? `，${imgRatioSkipped} 张跳过（${Object.keys(imgSkipWhy).map(k => k + '×' + imgSkipWhy[k]).join('、')}：明确不是产品图）` : ''));
  }

  // ===== 9. 表达重复检测（⚠️ 提示·根治「同一个意思说两遍」的啰嗦·吉吉 2026-07-08 立）=====
  // 原理：把所有 TEXT 节点正文归一化(去空格/标点/数字/箭头)后，任意两节点间若有 ≥12 字的公共子串 = 高度疑似重复。
  // 只做 ⚠️ 提示、不当硬错（重复是语义判断·机器给候选、人拍板）；阈值 12 字足够高、极少误伤
  //（短的定义性术语复用如「供应商列表」「看了列表发出询盘」不触发）。整体「绕圈/过度解释」机器判不死，靠 MIC-表达 铁律 7。
  let dupCount = 0;
  {
    const norm = s => (s || '').replace(/[\s　。，、；：:！？!?…·\/／()（）"“”'‘’`\-—–→>#%\d.]/g, '');
    const texts = [];
    findAllCached(n => { if (n.type === 'TEXT') { const c = norm(n.characters); if (c.length >= 12) texts.push({ id: n.id, name: n.name, c }); } return false; });
    const MIN = 12, seen = new Set();
    // 🔴 性能：先用 MIN-gram 倒排索引筛候选对，只对候选精算最长公共子串。
    // **这是等价变换、不是近似**：任意 ≥MIN 字的公共子串必然包含至少一个长度恰好 MIN 的公共子串，
    // 所以「不共享任何 MIN-gram 的两条」不可能有 ≥MIN 的公共子串，跳过它们不会漏报。判据一个字没改。
    // 原写法是 O(n²·L³) 暴力（n 条两两比 × 每对再双重循环求最长公共子串），
    // 在 3 万节点的稿子上把整道门拖到 120s 超时 —— 实测同一失败模式挂过 4 次（PPC 稿 787:12959）。
    const gramIdx = new Map();
    for (let i = 0; i < texts.length; i++) {
      const c = texts[i].c, grams = new Set();
      for (let x = 0; x + MIN <= c.length; x++) grams.add(c.substr(x, MIN));
      for (const g of grams) {
        let arr = gramIdx.get(g);
        if (!arr) { arr = []; gramIdx.set(g, arr); }
        arr.push(i);   // arr 天然按 i 递增，故下面 p<q ⟹ arr[p]<arr[q]
      }
    }
    const candKeys = new Set();
    for (const arr of gramIdx.values()) {
      if (arr.length < 2) continue;
      for (let p = 0; p < arr.length; p++)
        for (let q = p + 1; q < arr.length; q++)
          candKeys.add(arr[p] * texts.length + arr[q]);
    }
    // 🔴 排序还原成原来的 (i 升序, j 升序) 遍历次序 —— `seen` 去重依赖顺序，
    //    不排序会让「哪一对被报、哪个串被 seen 吃掉」跟旧版不一致（判据没变但报告会变）。
    const pairs = [];
    for (const k of candKeys) pairs.push([Math.floor(k / texts.length), k % texts.length]);
    pairs.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    // 🔴 no silent caps：极端稿（同一句话复制上百份）候选对仍可能爆量，截断必须报出来，
    //    否则「只报了前 N 对」会被读成「只有这 N 对」。
    const CAND_CAP = 4000;
    let candTruncated = 0;
    if (pairs.length > CAND_CAP) { candTruncated = pairs.length - CAND_CAP; pairs.length = CAND_CAP; }
    for (const [i, j] of pairs) {
      const a = texts[i].c, b = texts[j].c;
      let best = '';
      for (let x = 0; x < a.length; x++) {
        for (let y = 0; y < b.length; y++) {
          let k = 0;
          while (x + k < a.length && y + k < b.length && a[x + k] === b[y + k]) k++;
          if (k > best.length) best = a.substr(x, k);
        }
      }
      if (best.length >= MIN && !seen.has(best)) {
        seen.add(best);
        addViolation('表达重复⚠️', `两处文字高度重复("${best}")，确认是不是说了两遍·删掉其中一处（重复系语义判断·请人工核）`, texts[j].id, `${texts[i].name} ↔ ${texts[j].name}`);
        dupCount++;
      }
    }
    if (candTruncated > 0) addViolation('表达重复⚠️', `候选对超过 ${CAND_CAP}，本次只算了前 ${CAND_CAP} 对、跳过 ${candTruncated} 对（覆盖不全·别读成「只有上面这些重复」）`, node.id, node.name);
  }
  if (dupCount === 0) addPass('表达重复：无 ≥12 字跨节点重复（注：通过≠不啰嗦·整体绕圈见 MIC-表达 铁律 7）');

  // ===== 10. 中英/中数/中% 空格检测（吉吉 2026-07-15 立·「Figma 里中英文数字之间不能有空格」硬门）=====
  // 依据 feedback-no-cn-en-space：CJK 与 拉丁/数字/% 之间不留空格（含普通空格 / 全角空格 / nbsp）。
  // 英文之间的合法空格(如 Trade Assurance)不误判——判定必须 CJK 在一侧。
  let spaceCount = 0, nameSpaceCount = 0;
  {
    const SP = '[ \\t\\u00a0\\u3000]+';
    const reCJKLat = new RegExp('[\\u4e00-\\u9fff]' + SP + '[A-Za-z0-9%]');
    const reLatCJK = new RegExp('[A-Za-z0-9%]' + SP + '[\\u4e00-\\u9fff]');
    const hitSpace = s => (typeof s === 'string') ? (s.match(reCJKLat) || s.match(reLatCJK)) : null;
    const excerpt = (s, m) => s.slice(Math.max(0, m.index - 4), m.index + m[0].length + 4).replace(/\n/g, ' ');
    // 10a · 文案层
    findAllCached(n => {
      if (n.type === 'TEXT' && typeof n.characters === 'string') {
        const m = hitSpace(n.characters);
        if (m) {
          addViolation('中英空格', `文字含中英/中数空格("${excerpt(n.characters, m)}")→删掉空格（「MIC平台」不是「MIC 平台」，「第12条」不是「第 12 条」）`, n.id, n.name);
          spaceCount++;
        }
      }
      return false;
    });
    // 10b · 🔴 图层名 / 区块名同样管（2026-08-03 补的缺口）
    //   原来只查 characters，图层名里的中英空格**全线漏检**。真栽过：为了"名字紧凑"
    //   把 `PPC营销助手V0.1` 改成 `PPC 营销助手 V0.1`（方向正好改反），门全绿，靠吉吉眼看出来。
    //   图层名同样是交付物 —— 前端读稿、AI 读稿都读它，跟文案一个标准。
    //   豁免：组件实例内部（飞鹊远程库的 `容器 57` 这类名字本文件改不了，报了也没法修）。
    const nameTargets = [node];
    findAllCached(n => { if (!isInsideInstance(n)) nameTargets.push(n); return false; });
    for (const n of nameTargets) {
      const m = hitSpace(String(n.name || ''));
      if (m) {
        addViolation('中英空格·图层名', `图层/区块名含中英中数空格("${excerpt(String(n.name), m)}")→删掉空格（图层名跟文案同标准·前端和 AI 都读它）`, n.id, n.name);
        nameSpaceCount++;
      }
    }
  }
  if (spaceCount === 0 && nameSpaceCount === 0) addPass('中英空格：文案与图层名均无中英/中数/中% 空格');
  else if (spaceCount === 0) addPass(`中英空格：文案层干净（图层名有 ${nameSpaceCount} 处，见违规项）`);

  // ===== 11. 阿语 RTL（全局）+ 阿语字体 Amiri（仅运营场景）=====
  // 吉吉 2026-07-24 立，**2026-08-06 收窄**：原写「阿语字体一律 Amiri」是把运营图的规范当成了全局规范。
  //   真规矩 = **Amiri 只用于运营视觉素材**（banner/EDM/Push/YML/专题）；
  //            做项目 / UI / 交互需求，阿语**照旧 Roboto**（飞鹊「全场景 Roboto」SOT 不破）。
  //   收窄前这道门会**误拦每一张含阿语的 UI/交互稿**——它是全局跑的，稿子没有场景可言。
  // 两半的作用域不同，别再合起来记：
  //   ① RTL 不许左对齐 → **全局**。右对齐是语言方向属性，跟运营/UI 无关，阿语 UI 稿同样要右对齐。
  //   ② 字体必须 Amiri → **仅运营**。见下方场景判定。
  // 机器判不了（留人核·台账二类）：RTL「产品图镜像换位」是版式语义。
  //
  // 场景判定（显式传参优先，名字嗅探兜底）：
  //   - `verify(id, {scene:'ops'})` → 查字体。MIC-运营 子 skill 里写死要传这个。
  //   - `verify(id, {scene:'ui'})`  → 明确不查字体。
  //   - 不传 → 嗅**自身 + 祖先链**的名字（画板/section/page 级）。
  // 🔴 嗅探故意**不看子孙节点**：UI 稿里有个叫 `banner` 的内部图层太常见了（首页改版稿必有），
  //    看子孙会把 UI 稿误判成运营图 —— 那正是这次要修的病，别用修法把病又引回来。
  // 🔴 已知漏报（声明式，不假装覆盖全）：运营图的顶层 frame / page 名如果不含下面任一关键词，
  //    又没显式传 scene:'ops' → 字体这半**不查**。兜底靠 MIC-运营 §4.3 死命令 + 传参约定。
  const OPS_NAME_RE = /banner|edm|push|yml|专题|活动|运营|坑位|招商|促销|大促|采洽会|焕新/i;
  let isOpsScene = false, sceneWhy = '';
  if (OPTS.scene === 'ops')      { isOpsScene = true;  sceneWhy = "显式传参 scene:'ops'"; }
  else if (OPTS.scene === 'ui')  { isOpsScene = false; sceneWhy = "显式传参 scene:'ui'"; }
  else {
    for (let a = node; a; a = a.parent) {
      if (OPS_NAME_RE.test(String(a.name || ''))) {
        isOpsScene = true; sceneWhy = `名字嗅探命中「${a.name}」`; break;
      }
    }
    if (!isOpsScene) sceneWhy = '名字嗅探未命中运营特征 → 按 UI/项目稿处理（阿语用 Roboto）';
  }

  let arNonAmiri = 0, arLeft = 0, arTextCount = 0, arRobotoInUi = 0;
  const reArabic = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
  findAllCached(n => {
    if (n.type === 'TEXT' && typeof n.characters === 'string' && reArabic.test(n.characters)) {
      arTextCount++;
      const fn = n.fontName; // 可能是 figma.mixed（混排）→ 只在拿得到 family 时判
      if (fn && typeof fn === 'object' && fn.family) {
        if (isOpsScene && fn.family !== 'Amiri') {
          addViolation('阿语字体', `运营素材的阿语文字应用 Amiri（现为 ${fn.family}）："${n.characters.slice(0,16)}"`, n.id, n.name);
          arNonAmiri++;
        }
        if (!isOpsScene && fn.family !== 'Roboto') arRobotoInUi++; // 只计数、不判违规（见下方 pass 文案）
      }
      if (n.textAlignHorizontal === 'LEFT') {
        addViolation('阿语RTL', `阿语文字不能左对齐（应 RIGHT）："${n.characters.slice(0,16)}"`, n.id, n.name);
        arLeft++;
      }
    }
    return false;
  });
  if (arTextCount === 0) {
    addSkip('阿语字体/RTL', '这张稿里没有阿语文字');
  } else if (arNonAmiri === 0 && arLeft === 0) {
    // 🔴 说门全绿之前先说清这道门比了什么（feedback-gate-coverage-must-be-declared）
    const fontScope = isOpsScene
      ? '字体已按运营场景查 Amiri'
      : `字体**未查**（${arRobotoInUi > 0 ? `其中 ${arRobotoInUi} 处非 Roboto，仅提示` : '非运营场景，阿语走 Roboto'}）`;
    addPass(`阿语 RTL：${arTextCount} 处阿语文字均未左对齐；${fontScope}｜场景=${isOpsScene ? 'ops' : 'ui'}（${sceneWhy}）`);
  }

  // ===== 12. 图标形变检测（吉吉 2026-07-27 立·根治「resize 当 rescale 用把图标压扁」）=====
  // 机理：飞鹊 icon 组件内部矢量的约束多为 CENTER/SCALE —— 横向 CENTER（不跟外框缩）、纵向 SCALE（跟着缩）。
  // 所以 resize(14,14) 把 16×16 母版压到 14 高时【只有高度缩了、宽度纹丝不动】→ 图形被单轴压扁（星星成一根尖刺）。
  // 🔴 为什么必须机器查：外框仍是标准正方形，查 width===height【查不出来】，肉眼在 14px 尺寸也看不出，只有比对内部矢量宽高比才暴露。
  // 正解：inst.rescale(目标/inst.width)，绝不 resize。已经压坏的修法：先 resize 回母版原生宽高让约束还原，再 rescale。
  // 嵌套实例（实例内的槽位）不能 rescale（报 cannot be overridden）→ 只能 resize，故必须靠本检测兜底。
  let iconWarped = 0, iconChecked = 0;
  {
    const insts = [];
    findAllCached(n => { if (n.type === 'INSTANCE') insts.push(n); return false; });
    for (const inst of insts) {
      let mc = null;
      try { mc = await mcOf(inst); } catch (e) { continue; }
      if (!mc) continue;
      const iv = inst.findOne(x => x.type === 'VECTOR' && x.width > 0.01 && x.height > 0.01);
      const mv = mc.findOne(x => x.type === 'VECTOR' && x.width > 0.01 && x.height > 0.01);
      if (!iv || !mv) continue;
      iconChecked++;
      const ra = iv.width / iv.height, rb = mv.width / mv.height;
      if (Math.abs(ra - rb) / rb > 0.04) {
        addViolation('图标形变', `实例内矢量宽高比 ${ra.toFixed(2)} ≠ 母版 ${rb.toFixed(2)}（疑 resize 当 rescale 用）→ 先 resize 回母版原生 ${Math.round(mc.width)}×${Math.round(mc.height)}，再 rescale(目标/原生)`, inst.id, inst.name);
        iconWarped++;
      }
    }
  }
  if (iconWarped === 0) {
    if (iconChecked === 0) addSkip('图标形变', '这张稿里没有「实例内含矢量」的图标可比');
    else addPass(`图标形变：${iconChecked} 个实例内矢量比例与母版一致（无 resize 压扁）`);
  }

  // ===== 13. 字体图标残留（吉吉 2026-07-27 立·图标一律用飞鹊 icon 组件，不用图标字体字形）=====
  // 判定用【码点】不用字符串：PUA(U+E000–U+F8FF) 字形在工具返回的 JSON 里序列化成空串，
  // 用 characters===''  判空会连错两次（2026-07-27 栽过：把图标节点误当文案节点，文案整个丢了）。
  // 也别用「字体族是不是 micon-2025」区分——同一份稿里可能混着 micon / micon-2025 两个字体族。
  let puaCount = 0;
  {
    const seen = {};
    findAllCached(n => {
      if (n.type !== 'TEXT' || typeof n.characters !== 'string') return false;
      for (const ch of n.characters) {
        const c = ch.codePointAt(0);
        if (c >= 0xE000 && c <= 0xF8FF) {
          const cp = 'U+' + c.toString(16);
          if (!seen[cp]) { seen[cp] = true;
            addViolation('字体图标', `TEXT 用图标字体字形 ${cp}（${n.fontName && n.fontName.family ? n.fontName.family : '?'}）→ 改用飞鹊 icon 组件实例，图层名按检查 15 格式写全：icon·<variant 全值>（如 icon·行业图标-ind-manufacture）`, n.id, n.name || '(无名)'); }
          puaCount++;
          return false;
        }
      }
      return false;
    });
  }
  if (puaCount === 0) addPass('字体图标：无 PUA 图标字形，图标均为组件实例');

  // ===== 14. 扫描盲区申报（吉吉 2026-07-27 立·根治「扫描口径错→整批漏掉」）=====
  // 血泪：同一次任务连漏两批 —— ① 按「组件引用关系」扫，漏掉从来不是实例的手搭 FRAME；
  // ② 改按「页面」扫，又漏掉母版已被删的孤儿组件、以及来自别的库文件的远程组件（它们的内容根本不在本页树里）。
  // 所以门不能只报「我查过的都干净」，必须把【我够不到的地方】显式报出来，交人工判断，不许静默通过。
  {
    const remote = {}, orphan = {};
    const insts = [];
    findAllCached(n => { if (n.type === 'INSTANCE') insts.push(n); return false; });
    for (const inst of insts) {
      let mc = null;
      try { mc = await mcOf(inst); } catch (e) { continue; }
      if (!mc) continue;
      if (mc.remote) { remote[mc.name] = (remote[mc.name] || 0) + 1; continue; }
      let hp = mc; while (hp && hp.type !== 'PAGE') hp = hp.parent;
      if (!hp) orphan[mc.name] = (orphan[mc.name] || 0) + 1;
    }
    const rk = Object.keys(remote), ok = Object.keys(orphan);
    if (rk.length) addViolation('扫描盲区⚠️', `${rk.length} 个远程组件（来自别的库文件·本文件改不了，内部若有手搭元素/字体图标须去源文件改）：${rk.map(k => k + '×' + remote[k]).join('、')}`, node.id, node.name);
    if (ok.length) addViolation('扫描盲区⚠️', `${ok.length} 个孤儿母版（母版已删·不在任何页面上·按页面 findAll 扫不到）：${ok.map(k => k + '×' + orphan[k]).join('、')}。修法：page.appendChild(母版) 挂回页面后即可编辑`, node.id, node.name);
    if (!rk.length && !ok.length) {
      if (!insts.length) addSkip('扫描盲区', '这张稿里没有组件实例，远程组件 / 孤儿母版无从谈起');
      else addPass(`扫描盲区：${insts.length} 个实例查过，无远程组件 / 无孤儿母版，本次扫描覆盖完整`);
    }
  }

  // ===== 15. variant 实例裸名（吉吉 2026-07-27 立·根治「引用飞鹊图标，图层名全叫 icon，前端读稿对不上」）=====
  // 根因是机制性的、不是偷懒：飞鹊图标库结构 = 一个 component set 就叫 `icon`，靠 variant 属性
  // `icon=行业图标-ind-xxx` 区分具体图标。importComponentByKeyAsync 拿到实例后，Figma 默认把实例名设成
  // 【set 名】而不是 variant 名 → 每次引用飞鹊图标，默认落地都叫 `icon`，「到底是哪个图标」在图层树里整个丢失。
  // 信息其实稿子里有（variant 值好好的），只是被图层名盖住；前端要么逐个点开 inspect，要么来问设计师。
  // 单页 500+ 图标时这条成本极高（实测 453:17609 所在页 681 个实例里 522 个是裸名 icon）。
  //
  // 判据分两档（用真实数据校准过，不是拍脑袋）：
  //  · 身份型 set —— set 名 == 唯一 variant 属性名（`icon :: [icon]` 命中）。variant 决定「这是哪一个」，
  //    丢了 = 致命信息缺失 → 严格档：裸名报违规；已人工命名但名里不含完整 variant 值 → ⚠️ 软提示待人工核。
  //  · 参数型 set —— set 名本身已识别身份，variant 只是状态/样式（button/scrollbar/footer-home/switch）。
  //    → 宽松档：只有裸名才报，且建议名只拼「非默认值」差分。button 有 6 个 variant 属性
  //      (type/size/State/content/color/shape)，全串拼出来图层树彻底没法看。
  //
  // 🔴 绝不覆盖人工命名：`鼠标悬停的时候才出现` / `Flip button left（鼠标悬停出现）` / `只有下滑滚动才出现`
  // 这类是交互稿最值钱的业务标注，也是 MIC-交互 §C「图层名 = 公共主键」的载体。机器一刀切覆盖 =
  // 拿设计系统真名去毁交互语义，得不偿失。分工要清楚：
  //   父容器名承载业务语义（`cat-row·selected`），叶子 instance 名承载设计系统真名（`icon·行业图标-ind-xxx`）。
  //
  // ⚠️ 软提示这一档专治「假名比无名更坏」：手写的 `close·飞鹊icon delete` 母版真名其实是 `功能图标-close`，
  // 前端拿 delete 去库里搜要么搜不到、要么搜到别的图标。裸名只是没信息，写错的名会让前端照着错下去。
  // 所以名字不能靠手写补，必须机器从 mainComponent 自动取。
  let bareNamed = 0, nameSoftHint = 0, variantInstChecked = 0;
  {
    const insts = [];
    findAllCached(n => { if (n.type === 'INSTANCE') insts.push(n); return false; });
    const fixes = [];
    for (const inst of insts) {
      let mc = null;
      try { mc = await mcOf(inst); } catch (e) { continue; }
      if (!mc || !mc.parent || mc.parent.type !== 'COMPONENT_SET') continue; // 单体组件（实例名=母版名）不归本条管
      const set = mc.parent;
      const setName = set.name;
      let vp = null;
      try { vp = inst.variantProperties; } catch (e) { continue; }
      if (!vp) continue;
      const keys = Object.keys(vp);
      if (!keys.length) continue;
      variantInstChecked++;

      const isIdentity = keys.length === 1 && keys[0].toLowerCase() === setName.toLowerCase();

      let parts;
      if (isIdentity) {
        parts = [vp[keys[0]]];
      } else {
        let defVP = null;
        try { defVP = set.defaultVariant ? set.defaultVariant.variantProperties : null; } catch (e) {}
        const nonDefault = defVP ? keys.filter(k => vp[k] !== defVP[k]) : keys;
        parts = nonDefault.length ? nonDefault.map(k => vp[k]) : ['default'];
      }
      const suggested = setName + '·' + parts.join('·');

      if (inst.name === setName) {
        // 裸名 = import 后没回写过名字 → 硬违规（可机器自动修，故聚合成一条 + 明细挂 renameFixes）
        fixes.push({ id: inst.id, from: inst.name, to: suggested });
        bareNamed++;
      } else if (isIdentity && inst.name.indexOf(vp[keys[0]]) === -1) {
        // 人工命名但不含 variant 真值 → 可能是手写错的假信息，逐条报（量少，且必须人工拍板）
        addViolation('图层名待核⚠️', `实例名 "${inst.name}" 不含母版 variant 真值 "${vp[keys[0]]}"（手写名可能写错·假名比无名更坏，前端会照着错下去）→ 核实后改成 "${suggested}"，确属有意标注则保留`, inst.id, inst.name);
        nameSoftHint++;
      }
    }
    if (bareNamed) {
      const sample = fixes.slice(0, 3).map(f => `${f.from} → ${f.to}`).join('；');
      addViolation('图层裸名', `${bareNamed} 个 variant 实例的图层名 = 母版 set 名，variant 语义丢失（前端读稿对不上是哪个图标 / 哪个态）→ 跑 assets/docs/figma-instance-rename.js 一键修，明细见 report.renameFixes。样例：${sample}`, node.id, node.name);
      report.renameFixes = fixes;
    }
  }
  if (bareNamed === 0 && nameSoftHint === 0) {
    if (variantInstChecked === 0) addSkip('图层命名·variant 实例', '这张稿里没有 variant 实例（手搭图层的命名归检查 19 管，那道跑了）');
    else addPass(`图层命名：${variantInstChecked} 个 variant 实例均已具名（无裸 set 名 / 无可疑手写名）`);
  }

  // ====== 页头 / 页脚声明豁免（前端 2026-07-28 提「页头页脚无需开发名称打标记」）======
  // 🔴 豁免范围写窄，别顺手扩大：前端要的是「不用给页头页脚打开发标记」，不是「这两块可以不守规范」。
  // 所以只豁免【命名 / 隐藏节点申报】这类"打标记"性质的检查，token / 布局 / 图标形变照查。
  // 也别把卡片内部那个叫 `header` 的行误当页头 —— 判据只认明确写了页头/页脚/page-header 的名字。
  const HEADFOOT = /页头|页脚|页尾|page-?header|page-?footer|底部固定栏/i;
  function inHeadFoot(n) {
    for (let p = n; p && p.id !== node.id; p = p.parent) if (HEADFOOT.test(String(p.name || ''))) return true;
    return false;
  }

  // ===== 16. 隐藏节点申报（前端 2026-07-28 提「组件化要明确母版，不能隐藏一些废弃设计」）=====
  // 🔴 为什么必须机器查、且只有我们查得到：远程只读工具（get_metadata / get_design_context）读不到
  // 实例内部 visible=false 的节点，所以那类报告永远发现不了「母版里藏着废弃设计」。本脚本函数第一行
  // 已关掉 skipInvisibleInstanceChildren，是这条检查成立的前提——那行别删。
  //
  // 🔴 关键护栏：飞鹊组件用隐藏槽位是【合法机制】，不是脏东西（button 的 content=basic 变体内部左右
  // 各有一个隐藏 18px icon 槽位，打开即图标+文字）。所以绝不能「隐藏就报红」，否则整个飞鹊库全线报错。
  // 判据分三档，只有命中【废弃语义命名】的那档算违规，其余只申报计数、交人工核：
  //   16a 违规 · 本文件能改的地方藏着【真废弃设计】（认证old / 废弃 / 备份…）→ 该清掉
  //   16b 申报 · 远程库母版里的隐藏残留 → 本文件改不了，要去源库改（同检查 14 的扫描盲区精神）
  //   16c 申报 · 交付画布里设计师自己关掉的节点 → 问一句「是废弃，还是漏开」
  //             （实测栽过：空态主文案 `Sorry! No matches were found.` 和一个 button 被关掉，
  //               远程只读的报告却判成"空态缺文案"，方向反了）
  //
  // 🔴 两条判据是拿真稿校准出来的，不是拍脑袋（2026-07-28 首跑刷了 10 条噪音才改对）：
  //  ① `栅格线（勿动）` 这类【构造辅助线】不算废弃设计 —— 它在几乎每个飞鹊组件里都有，是设计系统
  //     自己的对位辅助。跟 `认证old`（真的被弃用的设计）混成一类，会让报告刷满不可行动的红字。
  //  ② 远程库（mc.remote）里的隐藏残留【本文件改不了】，报成违规是让人干不可能的事 → 降为申报。
  let hidDep = 0, hidOwn = 0, hidInInst = 0, hidRemote = 0, hidAux = 0;
  {
    // `old` 不能裸匹配：Gold / Bold / Household 全会中。用「前后都不是英文字母」框住，
    // 这样 `认证old`（前面是中文）命中、`Gold`（前面是 G）不命中。不用 lookbehind（插件沙箱不保证支持）。
    const DEP_EN = /(^|[^a-zA-Z])(old|deprecated|obsolete|backup|discard)([^a-zA-Z]|$)/i;
    const DEP_CN = /废弃|弃用|旧版|备份|副本|拷贝|待删|不要了/;
    const AUX = /勿动|辅助线|栅格线|参考线|guide\s*line|baseline|标注线/i;   // 构造辅助，不是废弃设计
    const isDep = s => !AUX.test(s) && (DEP_EN.test(s) || DEP_CN.test(s));
    const depList = [], ownList = [], byMaster = {};
    findAllCached(n => {
      if (n.visible !== false) return false;
      // 取【最外层】实例祖先当归属：在实例内部 = 母版里的残留（要去母版清）；否则 = 本稿里设计师自己关的
      let inst = null;
      for (let p = n.parent; p && p.id !== node.id; p = p.parent) if (p.type === 'INSTANCE') inst = p;
      const nm = String(n.name || '');
      if (AUX.test(nm)) { hidAux++; if (!inst) return false; }
      if (inst) {
        hidInInst++;
        const key = inst.name;
        if (!byMaster[key]) byMaster[key] = { total: 0, dep: [], instId: inst.id, remote: null };
        byMaster[key].total++;
        if (isDep(nm) && byMaster[key].dep.indexOf(nm) === -1) byMaster[key].dep.push(nm);
      } else if (isDep(nm)) {
        if (depList.length < 12) depList.push({ id: n.id, name: nm, type: n.type });
        hidDep++;
      } else if (!inHeadFoot(n)) {
        if (ownList.length < 15) ownList.push({ id: n.id, name: nm, type: n.type, w: Math.round(n.width || 0), h: Math.round(n.height || 0) });
        hidOwn++;
      }
      return false;
    });

    for (const d of depList)
      addViolation('废弃隐藏', `隐藏节点名带废弃语义："${d.name}"（${d.type}）→ 交付稿里不该留关掉的废弃设计，删掉；确属还要用的先改名说明用途`, d.id, d.name);

    // 分「本文件能改」和「远程库改不了」两拨
    const dirty = Object.keys(byMaster).filter(k => byMaster[k].dep.length);
    const localDirty = [], remoteDirty = [];
    for (const k of dirty) {
      const m = byMaster[k];
      let isRemote = false;
      try { const inst = await figma.getNodeByIdAsync(m.instId); const mc = inst ? await mcOf(inst) : null; isRemote = mc ? !!mc.remote : false; } catch (e) {}
      (isRemote ? remoteDirty : localDirty).push({ k, m });
    }
    for (const d of localDirty) {
      addViolation('废弃隐藏', `母版「${d.k}」内部藏着废弃设计：${d.m.dep.join('、')}（该实例内共 ${d.m.total} 个隐藏节点）→ 去母版本体清掉，改实例没用。前端点开母版会看到这些，会来问哪个才是要做的`, d.m.instId, d.k);
      hidDep += d.m.dep.length;
    }
    if (remoteDirty.length) {
      addViolation('废弃隐藏⚠️', `${remoteDirty.length} 个【远程库】母版内部藏着废弃设计，本文件改不了、要去源库改：${remoteDirty.map(d => `${d.k}(${d.m.dep.join('、')})`).join('；')} → 交付时至少在说明里点一句「这些隐藏层不是本次范围」，否则前端点开母版会问`, remoteDirty[0].m.instId, remoteDirty[0].k);
      hidRemote = remoteDirty.length;
    }

    const clean = Object.keys(byMaster).filter(k => !byMaster[k].dep.length);
    if (clean.length)
      addPass(`隐藏槽位：${clean.length} 个母版共 ${clean.reduce((s, k) => s + byMaster[k].total, 0)} 个隐藏节点，无废弃语义命名（飞鹊组件用隐藏槽位是合法机制，未计违规）`);
    if (hidAux) addPass(`构造辅助线：${hidAux} 个隐藏的栅格线/辅助线/勿动层，按设计系统构造件处理，未计废弃`);

    if (ownList.length) {
      const sample = ownList.slice(0, 6).map(o => `${o.name}(${o.type} ${o.w}×${o.h})`).join('、');
      // 🔴 2026-07-28 吉吉「刚才稿子里的隐藏的元素都删掉」→ 这一档从「待核」升为违规：
      //    交付稿里不留关掉的元素，藏着的东西前端不知道该不该做。
      //    ⚠️ 删之前先看一眼：本次就删掉了空态里的操作按钮 button·medium（母版说明提过它），
      //    真要用得重建 —— 所以门报出来是让人过一眼，不是让人闭眼删。
      addViolation('隐藏残留', `交付稿里有 ${hidOwn} 个被关掉的节点（非组件实例内部·已跳过页头页脚）→ 交付稿不留隐藏元素，删掉；删前过一眼有没有「本该显示、只是漏开」的。明细见 report.hiddenOwn。样例：${sample}`, node.id, node.name);
      report.hiddenOwn = ownList;
    }
    if (hidDep === 0 && hidOwn === 0 && hidRemote === 0) addPass(`隐藏节点：${hidInInst} 个（全在母版隐藏槽位内·无废弃语义命名·交付画布内无自行关闭的节点）`);
  }

  // ===== 17. 母版来源对照（前端 2026-07-28 提「组件化需要明确母版」）=====
  // 🔴 为什么必须机器查：get_metadata 不返回 mainComponent，所以只读工具只能按「图层名 + 高度」猜形态，
  // 会把两个不同母版的实例按同高度归成一类 —— 实测栽过：同名 supplier-card-list 的 233px 实例其实
  // 来自两个不同母版（1:13516 / 1:14767），远程报告判成"三形态"，真相是三个母版 + 一个手搭 Frame。
  //
  // 🔴🔴 归一必须归到 COMPONENT_SET 这一层，不是 COMPONENT（2026-07-28 拿真稿校准出来的，首版就栽在这）：
  // 同一个 set 的不同 variant 本来就是不同的 COMPONENT 节点，mainComponent id 当然不一样。首版按
  // mainComponent 归一 → `checkbox` 的 state=selected/default/disabled 三个变体被判成"三个母版分叉"，
  // `button` / `icon` / `selecter-multiple` / `brand logo` 全线误报。**同 set 不同 variant 是正常用法**，
  // 报它等于让人把状态合并掉。判据同检查 15：有 set 就按 set.id 归，独立组件才按自己的 id。
  //
  // 判据分三档（第三档也是真稿校准出来的：首版把「同名组件集有两份引用」跟「真的不同组件」混成一档报，
  // 严重度不对等——前者多半是库版本升级/两个库都有同名组件留下的重复引用，后者才是前端真做不出来的歧义）：
  //   ① 实例指向 ≥2 个母版、且母版【名字不同】 → 🔴 母版分叉（真的不同组件，前端不知道按哪个做）
  //   ② 实例指向 ≥2 个母版、但母版【同名】 → ⚠️ 同名多份（同一组件两份引用来源，确认哪个是当前版本）
  //   ③ 同名的裸 FRAME / GROUP 与实例并存 → ⚠️ 申报（可能只是外层点击区跟组件同名，也可能是手搭件冒充组件）
  // 护栏：只看顶层出现（实例内部结构是母版定义的，不归本条管）；跳通用默认名；名字太短不判。
  // 这条给的是【线索+对照表】，不预设"必须合并成一个母版"——三个母版也可能真是三种业务形态，
  // 那就在交付说明里写清各自触发条件，同样算解决。人拍板，门只保证这事没被漏掉。
  let masterFork = 0, masterDup = 0, bareSameName = 0;
  {
    const norm = s => String(s || '').replace(/^【[^】]*】/, '').replace(/[·\-_\s]*\d+$/, '').trim().toLowerCase();
    const GENERIC = /^(frame|group|rectangle|container|ellipse|vector|line|slice|矩形|圆形|椭圆|编组|图层|组件)/i;
    const groups = {};
    findAllCached(n => {
      if (n.type !== 'INSTANCE' && n.type !== 'FRAME' && n.type !== 'GROUP') return false;
      for (let p = n.parent; p && p.id !== node.id; p = p.parent) if (p.type === 'INSTANCE') return false;
      const raw = String(n.name || ''), k = norm(raw);
      if (!k || k.length < 3 || GENERIC.test(k)) return false;
      if (!groups[k]) groups[k] = { insts: [], bare: [], masters: {} };
      if (n.type === 'INSTANCE') groups[k].insts.push(n);
      else groups[k].bare.push({ id: n.id, name: raw, type: n.type, h: Math.round(n.height || 0) });
      return false;
    });
    const map = [];
    for (const k of Object.keys(groups)) {
      const g = groups[k];
      for (const inst of g.insts) {
        let mc = null;
        try { mc = await mcOf(inst); } catch (e) {}
        // 🔴 归一到 set：同 set 不同 variant 不算分叉（见上方注释）
        const set = mc && mc.parent && mc.parent.type === 'COMPONENT_SET' ? mc.parent : null;
        const sid = set ? set.id : (mc ? mc.id : '(母版取不到)');
        if (!g.masters[sid]) g.masters[sid] = { name: set ? set.name : (mc ? mc.name : '?'), isSet: !!set, remote: mc ? !!mc.remote : false, insts: [], variants: [], h: Math.round(inst.height || 0) };
        g.masters[sid].insts.push(inst.id);
        if (mc && set && g.masters[sid].variants.indexOf(mc.name) === -1 && g.masters[sid].variants.length < 6) g.masters[sid].variants.push(mc.name);
      }
      const sids = Object.keys(g.masters);
      const mNames = sids.map(id => g.masters[id].name);
      const sameName = mNames.length > 1 && mNames.every(x => x === mNames[0]);
      const forked = sids.length > 1 && !sameName, dup = sids.length > 1 && sameName;
      const mixed = g.bare.length > 0 && g.insts.length > 0;
      if (!forked && !dup && !mixed) continue;
      const desc = sids.map(id => `${id}「${g.masters[id].name}」${g.masters[id].isSet ? '(组件集)' : '(独立组件)'} ${g.masters[id].h}px ×${g.masters[id].insts.length}${g.masters[id].remote ? '·远程库' : ''}`).join(' ｜ ');

      if (forked) {
        masterFork++;
        addViolation('母版分叉', `图层名「${k}」的实例指向 ${sids.length} 个【不同名】的母版（不是同一组件的不同状态，是真的不同组件），前端不知道该按哪个做：${desc}` +
          ` → 两条路都算解决：① 合成一个母版，差异部分用 Boolean 显隐；② 确属不同业务形态，就在交付说明里写清各自触发条件`, g.insts[0].id, k);
      }
      if (dup) {
        masterDup++;
        addViolation('同名多份⚠️', `图层名「${k}」的实例指向 ${sids.length} 个【同名】母版（同一个组件在本文件有两份引用来源，常见于库版本升级或两个库都有同名组件）：${desc}` +
          ` → 确认哪个是当前版本，把旧的那批实例换过去；确属两个库各自的同名组件，在交付说明里写清哪个场景用哪个`, g.insts[0].id, k);
      }
      if (mixed) {
        bareSameName++;
        addViolation('同名手搭件⚠️', `图层名「${k}」既有组件实例（×${g.insts.length}），又有 ${g.bare.length} 个同名的裸 ${g.bare[0].type}（${g.bare.map(b => b.id + ' ' + b.h + 'px').join('、')}）→ 确认裸件是「外层点击区/容器，只是重名」还是「手搭件冒充组件」；后者换成实例，前者改个名（如 ${k}-tap）好让前端分得清`, g.bare[0].id, k);
      }
      map.push({ name: k, masters: g.masters, bare: g.bare });
    }
    if (map.length) report.masterMap = map;
    if (masterFork === 0 && masterDup === 0 && bareSameName === 0) {
      // 这道门查的是「同名图层指向不同母版」——一个实例都没有时，它一个对象都没扫到
      const withInst = Object.keys(groups).filter(k => groups[k].insts.length).length;
      if (withInst === 0) addSkip('母版来源', `这张稿里没有组件实例（扫到 ${Object.keys(groups).length} 组同名图层，但全是手搭件，没有母版可比）`);
      else addPass(`母版来源：${withInst} 组带实例的同名元素各自单一母版（同 set 不同 variant 不计分叉）·无同名多份·无同名手搭件`);
    }
  }

  // ===== 18. 交互行为说明覆盖（前端 2026-07-28 提「存在交互类需要增加交互说明（如遮罩）」）=====
  // 真实问题不是"没写说明"，而是【说明写了却放在机器读不到的地方】——实测一份稿把弹层露出比例、
  // 骨架屏渐变、底部加载动效写得很清楚，全写在一个自己声明「AI 不读」的 Section 里。
  // 说明写得再好，声明了不读就等于没写；而这些恰恰是 figma 画不出来、前端只能靠说明拿到的必需行为。
  //
  // 18b 判据极干净（节点名里有"不读" + 区内文字有行为词）→ 算违规。
  // 18a 靠画布名匹配，命名口径多样 → 只做 ⚠️ 申报，给线索让人核，不硬判。
  let behaviorMisplaced = 0, interactUnspec = 0;
  {
    const INTERACT = /遮罩|蒙层|蒙版|overlay|弹层|浮层|弹窗|popup|modal|drawer|bottom\s*sheet|toast|tooltip|骨架屏|skeleton/i;
    const BEHAVIOR = /关闭|点击|收起|展开|露出|占屏|时长|动效|动画|轮播|吸顶|滑动|拖动|自动消失|层级|z-?index|触发|加载动效|下滑加载/;
    const NOREAD = /不读|勿读|仅供人|人看|不看/;
    const inNoRead = n => { for (let p = n; p && p.id !== node.id; p = p.parent) if (NOREAD.test(String(p.name || ''))) return true; return false; };
    // 交付画布 = 父节点是 SECTION 或就是被检根节点的那层 FRAME
    const canvasOf = n => { let c = null; for (let p = n; p && p.id !== node.id; p = p.parent) if (p.type === 'FRAME' && p.parent && (p.parent.type === 'SECTION' || p.parent.id === node.id)) c = p; return c; };

    // 18b · 行为契约被关在「AI 不读」区
    const noReadRoots = [];
    findAllCached(n => { if (NOREAD.test(String(n.name || '')) && (n.type === 'SECTION' || n.type === 'FRAME' || n.type === 'GROUP')) { if (!noReadRoots.some(r => { for (let p = n.parent; p; p = p.parent) if (p.id === r.id) return true; return false; })) noReadRoots.push(n); } return false; });
    for (const nr of noReadRoots) {
      const hits = [];
      nr.findAll(t => { if (t.type === 'TEXT' && typeof t.characters === 'string' && BEHAVIOR.test(t.characters)) hits.push(t.characters.replace(/\s+/g, ' ').slice(0, 30)); return false; });
      if (hits.length) {
        addViolation('行为契约错位', `「${nr.name}」声明不读，里面却有 ${hits.length} 条行为说明（如"${hits[0]}"）→ 这些是 figma 画不出来、前端只能靠文字拿到的必需行为；写在声明不读的区里等于没写，搬进交付说明区`, nr.id, nr.name);
        behaviorMisplaced += hits.length;
      }
    }

    // 18a · 交互类节点所在画布，有没有被说明点过名
    // 🔴 两条排除是拿真稿校准出来的（2026-07-28 首跑误报）：
    //  ① 排除 TEXT —— Figma 用文字内容当节点名，所以一段写着「filter按钮与右侧弹层」的说明文字，
    //     它的节点名就含"弹层"，会被当成交互元素。交互元素是图形/容器，不会是文字节点。
    //  ② 排除说明区自身（spec / note / 交付说明 / 批注 子树）—— 说明区谈论交互，不等于它有交互。
    const SPECAREA = /^(spec|note)[-·\d]|交付说明|批注|说明_|参考/i;
    const inSpecArea = n => { for (let p = n; p && p.id !== node.id; p = p.parent) if (SPECAREA.test(String(p.name || ''))) return true; return false; };
    const byCanvas = {};
    findAllCached(n => {
      if (n.type === 'TEXT') return false;
      if (!INTERACT.test(String(n.name || ''))) return false;
      const c = canvasOf(n);
      if (!c || inNoRead(n) || inSpecArea(n)) return false;
      if (!byCanvas[c.id]) byCanvas[c.id] = { canvas: c, hits: [] };
      // 画布自己命中（如画布名就叫「…_加载骨架屏」）不算它内部的交互元素，避免命中列表里出现自己
      if (n.id !== c.id && byCanvas[c.id].hits.length < 3) byCanvas[c.id].hits.push(String(n.name));
      return false;
    });
    const canvasIds = Object.keys(byCanvas);
    if (canvasIds.length) {
      // 说明索引：全树的节点名 + TEXT 正文，各自标「属于哪个画布」「是否在不读区」
      const refs = [];
      findAllCached(n => {
        const cid = (canvasOf(n) || {}).id, nr = inNoRead(n);
        if (n.name) refs.push({ s: String(n.name), cid, nr });
        if (n.type === 'TEXT' && typeof n.characters === 'string') refs.push({ s: n.characters, cid, nr });
        return false;
      });
      for (const cid of canvasIds) {
        const c = byCanvas[cid].canvas;
        const hits = byCanvas[cid].hits.length ? byCanvas[cid].hits : ['画布名本身标了交互态'];
        const outside = refs.filter(r => r.cid !== cid && r.s.indexOf(c.name) !== -1);
        if (!outside.length) {
          addViolation('交互说明⚠️', `画布「${c.name}」有交互元素（${hits.join('、')}）但全稿没有任何说明点到这张画布 → 补一条：触发方式 / 关闭方式 / 露出比例 / 层级，这些画不出来`, c.id, c.name);
          interactUnspec++;
        } else if (!outside.some(r => !r.nr)) {
          addViolation('交互说明⚠️', `画布「${c.name}」的交互元素（${hits.join('、')}）只在声明不读的区里被点名 → 说明搬进交付说明区，否则前端和 AI 都拿不到`, c.id, c.name);
          interactUnspec++;
        } else if (!outside.some(r => BEHAVIOR.test(r.s))) {
          addViolation('交互说明⚠️', `画布「${c.name}」被说明点了名，但点名处没写任何行为（关闭 / 触发 / 露出 / 层级 / 动效）→ 只写"有这个弹层"不够，前端要的是它怎么动`, c.id, c.name);
          interactUnspec++;
        }
      }
      if (interactUnspec === 0) addPass(`交互说明：${canvasIds.length} 张含交互元素的画布均被交付说明点名且写了行为`);
    } else if (behaviorMisplaced === 0) addSkip('交互说明', '这张稿里没有遮罩 / 弹层 / 骨架屏类交互元素');
  }

  // ===== 19. 默认名图层（吉吉 2026-07-28 焊死：不管出设计稿/交互稿/视觉稿，所有图层都要有语义名）=====
  // 🔴 为什么必须机器查：这条 2026-07-28 那一轮被吉吉**连指三次**才清干净——
  //   ① 我只扫了交付区，漏了说明区/批注区；② 又跳过了组件实例内部（那里藏着 347 个）；
  //   ③ 用 `/页尾/` 模糊匹配改名，级联污染 54 个。规矩当时全写在文档里，照样读漏。
  //   文档治不了「读漏」，所以升成每次 use_figma 后必跑的门。
  //
  // 判据分两档（不是偷懒，是让门「能过且有意义」）：
  //  · 🔴 容器类（Frame/Group/Rectangle/Container）→ 违规，发 summary 信号、Stop 门会拦。
  //    这类没名字 = 前端在图层树里完全看不出这块是什么，是真问题。
  //  · ⚠️ 纯矢量零件（Vector/Ellipse/Line/Slice）→ 只申报不拦。
  //    图标组件内部的 `Vector` 是画出来的形状零件，语义由父容器承载；一刀切会让每个 icon 组件都刷红，
  //    人对门脱敏比漏这一档更贵（本文件顶部反复写过这个代价）。出稿时我仍然全部命名，那是执行层的事。
  //  · 组件【实例内部】的默认名单独计数：改得动但 clone 一次就丢（Figma 不把子节点 name 当 override 复制），
  //    根治在源库 → 单列申报，不计入拦截信号。
  // 🔒 决定已定，别重议：吉吉 2026-07-28 明确「先不拦吧」——矢量零件与组件实例内部这两档
  //    保持「申报不硬拦」。先跑几份稿看矢量零件那档的真实噪音量，再决定要不要收紧。
  //    出稿时仍然全部命名（那是执行层要求），只是机器不在这两档上拦。
  let dfltOwn = 0, dfltShape = 0, dfltInInst = 0;
  {
    const BOX = /^(Frame|Group|Rectangle|Container)(\s+\d+)?$/i;
    const SHAPE = /^(Ellipse|Vector|Line|Slice)(\s+\d+)?$/i;
    const ownList = [], byInst = {};
    findAllCached(n => {
      const nm = String(n.name || '');
      const isBox = BOX.test(nm), isShape = SHAPE.test(nm);
      if (!isBox && !isShape) return false;
      let outer = null;
      for (let p = n.parent; p && p.id !== node.id; p = p.parent) if (p.type === 'INSTANCE') outer = p;
      if (outer) { dfltInInst++; byInst[outer.name] = (byInst[outer.name] || 0) + 1; return false; }
      if (isBox) { if (ownList.length < 15) ownList.push({ id: n.id, name: nm, type: n.type, parent: n.parent ? String(n.parent.name) : '?' }); dfltOwn++; }
      else dfltShape++;
      return false;
    });
    if (dfltOwn) {
      addViolation('默认名', `${dfltOwn} 个容器还是默认名（${ownList.slice(0, 5).map(o => o.name + '@' + o.parent).join('、')}）→ 名字从「结构位置＋内部首个文字」推，别留 Frame/Group/Rectangle/Container。明细见 report.defaultNamed。`
        + `⚠️改名三条：先全量选中再统一改名／选择器别用会被自己改出来的特征（用 name.indexOf(前缀)===0 锚定）／名字从结构推不从当前名推`, node.id, node.name);
      report.defaultNamed = ownList;
    }
    if (dfltShape) addViolation('默认名⚠️矢量零件', `${dfltShape} 个 Vector/Ellipse/Line 仍是默认名（图标内部形状零件属正常，语义由父容器承载）→ 交付稿建议一并命名，本档不拦`, node.id, node.name);
    if (dfltInInst) {
      const ks = Object.keys(byInst);
      addViolation('默认名⚠️组件内部', `组件实例内部 ${dfltInInst} 个默认名：${ks.slice(0, 5).map(k => k + '×' + byInst[k]).join('、')}${ks.length > 5 ? '…' : ''} → 改得动但 clone 一次就丢（name 不算 override），根治去源库改；交付稿要改的话每 clone 一次都得重跑`, node.id, node.name);
    }
    if (dfltOwn === 0) addPass(`默认名归零：稿自己的容器图层无 Frame/Group/Rectangle/Container 裸名`
      + (dfltShape ? `（另有 ${dfltShape} 个矢量零件默认名，申报不拦）` : '')
      + (dfltInInst ? `（组件实例内部 ${dfltInInst} 个另计）` : ''));
  }

  // ===== 20. 字号阶梯 =====
  // 🔴 2026-09-15 吉吉发现「相关问题标题是 13 号字」才加的 —— 在此之前门【压根不查字号】，
  //    13/15/17 这种随手写的奇数一路绿灯到交付。飞鹊两端字号阶梯都没有奇数，这条是绝对判据。
  // 分两档报（理由同「判据形式错就撤门」—— 不确定的那半不许伪装成硬违规）：
  //    · 奇数 / 小数 → 硬违规（奇数一定错；小数＝被 resize 缩放过，同样一定错）
  //    · 偶数但不在阶梯上 → ⚠️ 待核（26/28/30 这类在 banner、移动端可能是有意的，硬拦会误伤）
  // 白名单里 10 是移动端正文档、42/80 是营销 banner 档，都有出处。
  // 实例内部与【现有元素·不用开发】区跳过：前者字号由母版决定、本文件改不了，后者是线上抓取底图。
  const FONT_LADDER = [10, 12, 14, 16, 18, 20, 22, 24, 32, 36, 42, 80];
  let fontOdd = 0, fontOff = 0;
  {
    let fontChecked = 0;
    const oddAgg = {}, offAgg = {};
    findAllCached(n => {
      if (n.type !== 'TEXT') return false;
      if (isInsideInstance(n) || inExemptZone(n)) return false;
      let segs = null;
      try { segs = n.getStyledTextSegments(['fontSize']); } catch (e) { segs = null; }
      if (!segs) return false;
      for (const seg of segs) {
        const sz = seg.fontSize;
        if (typeof sz !== 'number') continue;
        fontChecked++;
        if (FONT_LADDER.indexOf(sz) > -1) continue;
        const bucket = (sz % 2 !== 0) ? oddAgg : offAgg;
        if (!bucket[sz]) bucket[sz] = { count: 0, sample: [] };
        bucket[sz].count++;
        if (bucket[sz].sample.length < 3) bucket[sz].sample.push(String(n.name || '(无名)').slice(0, 26));
      }
      return false;
    });
    for (const sz of Object.keys(oddAgg)) {
      const b = oddAgg[sz];
      fontOdd += b.count;
      const why = (Number(sz) % 1 !== 0)
        ? '小数字号＝这段文字被 resize 缩放过（飞鹊没有小数档）'
        : '飞鹊字号阶梯没有奇数';
      addViolation('字号越界', `${b.count} 处用了 ${sz}px：${why} → 就近取偶（12/14/16/18/20/22/24/32/36，移动端另有 10）。样例：${b.sample.join('、')}`, node.id, node.name);
    }
    for (const sz of Object.keys(offAgg)) {
      const b = offAgg[sz];
      fontOff += b.count;
      addViolation('字号越界⚠️待核', `${b.count} 处用了 ${sz}px：是偶数但不在飞鹊阶梯上 → banner 或移动端可能有意，UI 稿里一律改回阶梯值。样例：${b.sample.join('、')}`, node.id, node.name);
    }
    if (fontChecked === 0) addSkip('字号阶梯', '这张稿里没有稿自己的文字（实例内部字号由母版决定，不归本稿管）');
    else if (fontOdd === 0 && fontOff === 0) addPass(`字号阶梯：${fontChecked} 段文字字号全在飞鹊阶梯上（无奇数、无缩放小数）`);
  }

  // ===== 21. 样式绑定来源：飞鹊远程 vs 本文件自建 =====
  // 🔴 2026-09-15 立。检查 2「零硬编码」只查【绑没绑】，不查【绑的是谁】——
  //    VO 智搜那张稿我建了 12 个本文件 local paint style，违规从 252 掉到 41，看着全绿；
  //    其中「文字·正文 #1D1D1F」「文字·次级 #6E6E73」「图标·按钮内白」三条【飞鹊本来就有对应 token】，
  //    等于拿自建值盖掉了设计系统，而门一声不吭。→ 绑定必须分 remote/local 两维查。
  // 两档：自建值命中飞鹊色表 = 硬违规（明明有还自建）；没命中 = ⚠️ 申报（飞鹊真没有，如渐变），不拦。
  // 🔴 FEIQUE_HEX 是 assets/feique-tokens.json 的镜像，属第二维护源 —— 靠 scripts/self-check.js
  //    的「verify 内置飞鹊色表 ↔ tokens.json 一致性」那一项兜住，改了 tokens.json 这里会当场报红。
  const FEIQUE_HEX = {
    '#222222': 'text/title 或 primary/dark', '#555555': 'text/main', '#888888': 'text/auxiliary', '#b3b3b3': 'text/disable',
    '#ffffff': 'other/white 或 background/background 03', '#000000': 'other/black',
    '#e64545': 'primary/buyer', '#cf3e3e': 'primary/buyer hover', '#fdf1f1': 'primary/buyer background',
    '#007dfa': 'primary/supplier 或 function/normal', '#0071e1': 'primary/supplier hover', '#ebf5ff': 'function/normal background',
    '#f4f4f4': 'primary/dark background', '#f5f7fa': 'background/background 01', '#f0f1f2': 'background/background 02',
    '#dae0e6': 'dividing line/list', '#ced3d9': 'dividing line/button', '#e6ecf2': 'dividing line/border', '#e6e6e6': 'dividing line/module',
    '#00c88c': 'function/success', '#ebfbf6': 'function/success background',
    '#faaa00': 'function/warning', '#fef6e5': 'function/warning background',
    '#ff5252': 'function/error', '#fff2f2': 'function/error background',
    '#a3b8cc': 'function/file gray', '#00a170': 'function/tag green', '#bf8200': 'function/tag yellow'
  };
  let localStyleDup = 0, localStyleOwn = 0;
  {
    const styleCache = new Map();
    async function styleInfo(id) {
      if (!id || id === figma.mixed) return null;
      if (styleCache.has(id)) return styleCache.get(id);
      let info = null;
      try {
        const st = await figma.getStyleByIdAsync(id);
        if (st) info = { name: st.name, remote: !!st.remote, paints: st.paints || null };
      } catch (e) { info = null; }
      styleCache.set(id, info);
      return info;
    }
    const STYLE_KEYS = ['fillStyleId', 'strokeStyleId', 'textStyleId'];
    const styled = findAllCached(n => {
      if (isInsideInstance(n) || inExemptZone(n)) return false;
      for (const k of STYLE_KEYS) if (k in n && n[k] && n[k] !== figma.mixed) return true;
      return false;
    });
    const agg = {};
    for (const n of styled) {
      for (const k of STYLE_KEYS) {
        if (!(k in n)) continue;
        const id = n[k];
        if (!id || id === figma.mixed) continue;
        const si = await styleInfo(id);
        if (!si || si.remote) continue;
        if (!agg[si.name]) {
          let hex = null;
          // 🔴 只有【单层】纯色才做色值命中 —— 多层填充（如「白底叠三色渐变 6%」）的 paints[0] 是打底的白，
          //    按它判会把一个渐变样式误报成「撞 other/white」。2026-09-15 这档判据首跑就撞上了，当场修的。
          //    多层的一律走申报档：它到底等不等于某个飞鹊 token，机器判不了，交给人。
          if (si.paints && si.paints.length === 1 && si.paints[0].type === 'SOLID') {
            const c = si.paints[0].color;
            hex = '#' + [c.r, c.g, c.b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
          }
          agg[si.name] = { count: 0, hex: hex };
        }
        agg[si.name].count++;
      }
    }
    for (const nm of Object.keys(agg)) {
      const a = agg[nm];
      const hit = a.hex ? FEIQUE_HEX[a.hex.toLowerCase()] : null;
      if (hit) {
        localStyleDup += a.count;
        addViolation('自建样式撞飞鹊', `本文件自建样式「${nm}」${a.hex} 用了 ${a.count} 处，而飞鹊已有同值 token「${hit}」→ 改绑飞鹊的、删掉这条自建。自建样式能让检查 2 转绿，但绿的是「绑了样式」不是「绑了飞鹊」。`, node.id, node.name);
      } else {
        localStyleOwn += a.count;
        addViolation('自建样式⚠️申报', `本文件自建样式「${nm}」${a.hex ? a.hex : '（渐变或多层填充）'} 用了 ${a.count} 处，飞鹊色板里没有同值 → 属规范之外自行定义，确认是有意的并写进交付说明。本档不拦。`, node.id, node.name);
      }
    }
    if (styled.length === 0) addSkip('样式绑定来源', '这张稿里没有稿自己绑样式的节点');
    else if (localStyleDup === 0 && localStyleOwn === 0) addPass(`样式绑定来源：${styled.length} 个绑样式的节点全部指向飞鹊远程样式，无本文件自建`);
    else if (localStyleDup === 0) addPass(`样式绑定来源：无自建样式撞飞鹊 token（另有 ${localStyleOwn} 处自建，飞鹊确实没有这一档，已申报）`);
  }

  // 汇总
  // 🔴 裸名信号必须进 summary（2026-07-27）：Stop 门只能看到脚本 return 出去的内容，
  // 若报告 violations 被截断（如只返回前 8 条），门就瞎了。summary 是报告核心字段、几乎必然被返回，
  // 把「还有多少裸名没修」焊进这里，门才拿得到稳定信号。特征串 `图层裸名×N` 供 gate 匹配，别改格式。
  const bareTag = bareNamed ? `｜🔴图层裸名×${bareNamed} 未修（跑 figma-instance-rename.js）` : '';
  // 检查 16-18 的信号也焊进 summary，理由同上（violations 会被截断，summary 几乎必然返回）。
  // ⚠️ 诚实标注：这三条目前只到【报告层】，没接 Stop 硬拦 —— 探索期「三个母版」可能真是三种业务形态，
  // 硬拦会逼人为了过门去合并本该分开的东西。等口径跟前端定死了再考虑升硬门，届时同步登记强制力台账。
  const newTags = [
    hidDep ? `🔴废弃隐藏×${hidDep}` : '',
    hidRemote ? `⚠️远程库废弃隐藏×${hidRemote}` : '',
    hidOwn ? `🔴隐藏残留×${hidOwn}` : '',
    masterFork ? `🔴母版分叉×${masterFork}` : '',
    masterDup ? `⚠️同名多份×${masterDup}` : '',
    bareSameName ? `⚠️同名手搭件×${bareSameName}` : '',
    behaviorMisplaced ? `🔴行为契约错位×${behaviorMisplaced}` : '',
    interactUnspec ? `⚠️交互说明缺×${interactUnspec}` : '',
    dfltOwn ? `🔴默认名×${dfltOwn}` : '',
    dfltInInst ? `⚠️组件内默认名×${dfltInInst}` : '',
    fixedUndeclared ? `⚠️固高未申报×${fixedUndeclared}` : '',
    nameSpaceCount ? `🔴图层名中英空格×${nameSpaceCount}` : '',
    fontOdd ? `🔴字号越界×${fontOdd}` : '',
    fontOff ? `⚠️字号待核×${fontOff}` : '',
    localStyleDup ? `🔴自建撞飞鹊×${localStyleDup}` : '',
    localStyleOwn ? `⚠️自建样式×${localStyleOwn}` : '',
  ].filter(Boolean).join('｜');
  // 🔴 未覆盖必须写进 summary，别只躺在 report.notCovered 里没人看。
  // 实测（2026-08-09 一张纯文档型稿）：报「14 项通过」时，其中 6 项一个对象都没扫到 ——
  // 「通过」这个词让 0 对象冒充了安全网。现在它会自己说出来。
  const ncTag = report.notCovered.length ? `｜⬜${report.notCovered.length} 项未覆盖（这张稿没有可查的对象·明细见 report.notCovered）` : '';
  report.summary = report.violations.length === 0
    ? `✅ ${report.passed.length} 项通过、0 违规${ncTag}`
    : `❌ 发现 ${report.violations.length} 个违规项，${report.passed.length} 项通过${ncTag}${bareTag}${newTags ? '｜' + newTags : ''}`;

  return report;
}

// 导出供 use_figma 调用
// 使用示例：
// const report = await verify('3423:9157');
// return report;
