// figma-manifest.snippet.js — 还原防漏「节点清单」提取模板
// 用途：还原开工第一步。把整段贴进 use_figma 的 code 参数，改 ROOT_ID 为要还原的根节点 id，
//       它遍历节点树，机器枚举出「该出现的每一个可见叶子元素」→ 返回 manifest。
//       manifest = 「该有什么」的权威清单（Figma 机器生成，不会像人眼那样漏），
//       之后每一项都要在 coverage.json 里被显式核销（做了/合并了/跳过+原因），
//       用 coverage-check.js 卡「有没有没核销的」= 漏看漏做。
//
// 拿到返回的 JSON 后：写进项目里的 <页面>-manifest.json（文件名带 manifest 才会触发 Stop 门 stamp）。
//
// ⚠️ 边界（诚实）：节点树有噪音（隐藏层/纯装饰/分组），本模板按「可见 + 有面积 + 叶子或文字或带图/填充」收集，
//    会有少量装饰节点误入 —— 这些在 coverage.json 里标 status:"skip" + reason 即可，不算漏。

const ROOT_ID = "PUT_ROOT_NODE_ID_HERE";   // ← 改成要还原的根节点 id，如 "3007:464"

const root = await figma.getNodeByIdAsync(ROOT_ID);
if (!root) return { error: "root not found: " + ROOT_ID };

const leaves = [];
const seen = new Set();

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
function box(n) {
  const b = n.absoluteBoundingBox;
  return b ? { w: Math.round(b.width), h: Math.round(b.height) } : { w: null, h: null };
}
// 叶子判定：文字、带图填充、矢量类，或「无子节点但有可见填充/描边」的原子块
function isMeaningfulLeaf(n) {
  if (n.visible === false) return false;
  const t = n.type;
  if (t === "TEXT") return true;
  if (hasImageFill(n)) return true;
  if (["VECTOR","BOOLEAN_OPERATION","STAR","POLYGON","LINE","ELLIPSE"].includes(t)) return true;
  const kids = n.children || [];
  if (kids.length === 0 && (t === "RECTANGLE" || t === "FRAME" || t === "INSTANCE") && hasVisiblePaint(n)) return true;
  return false;
}

function walk(n) {
  if (!n || seen.has(n.id)) return;
  seen.add(n.id);
  if (n.visible === false) return;
  const { w, h } = box(n);
  if (w === 0 || h === 0) return;           // 无面积不计
  if (isMeaningfulLeaf(n)) {
    const item = { id: n.id, name: n.name, type: n.type, w, h };
    if (n.type === "TEXT" && typeof n.characters === "string") {
      item.text = n.characters.length > 40 ? n.characters.slice(0, 40) + "…" : n.characters;
    }
    if (hasImageFill(n)) item.img = true;
    leaves.push(item);
    return;                                  // 叶子不再下钻
  }
  for (const c of (n.children || [])) walk(c);
}
walk(root);

return {
  root: ROOT_ID,
  rootName: root.name,
  count: leaves.length,
  leaves,
};
