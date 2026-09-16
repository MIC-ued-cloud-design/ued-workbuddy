#!/usr/bin/env node
// manifest-verify.js — manifest 落盘正确性门（2026-07-27 立）
// ─────────────────────────────────────────────────────────────────────────────
// 治两件事，都是「静默出错、三门还全绿」的类型：
//
// ① **手抄错/抄漏**：figma-restore-dump 的结果要经模型上下文再写进文件，这是整条还原链上
//    唯一会凭空产生错值的环节。真栽过：抄箭头 vectorPath 漏了第二个子路径 → 回环从空心变实心，
//    渲染比对三轮才发现。manifest 一旦错，下游 coverage/geom/visual 全是「照着错答案自查」。
//
// ② **静默截断**（更隐蔽）：**实测 use_figma 的返回超 20KB 会被直接截断**（不会自动落盘，试过）。
//    47 节点的小 banner 就已经 11.5KB，页面稍大必超 → 落盘的是半截 manifest，
//    coverage 只核那半截叶子、geom 只核那半截节点，**照样报全绿**。今天没有任何门拦这个。
//
// 判据：dump 自带的 `_digest` 八项 vs 本地对落盘文件重算的八项，全等才过。
//   八项都与键顺序无关（计数 / 全部数值求和 / 排序后的字符串集合长度），所以手写时键序不同也不影响。
//
// ③ **核的不是你要的那个块**（2026-08-20 立·PPC 真事故）：digest 八项验的是「这份文件忠实抄自
//    **某一份** dump」，验不了「那份 dump 抽的是哪个节点」。两者的差别能吃掉整轮工作：
//    PPC 第八轮新建的 board-C4 是 `2008:5558`，而第三轮留下的同名文件 `ppc-c4-manifest.json`
//    抽的是旧编号 C4 `787:9892`；`manifest-pack --unpack` 忽略第二个参数自己命名，于是覆盖没发生，
//    verify/scaffold 核的全是旧文件、**还报「八项全等」**——报告是真自洽的，只是核错了对象。
//    🔴 光比 rootName 不管用：那两份的 rootName 一字不差（都叫 `panel-body·抽屉内容槽位（各模块填充）`），
//    只有 root **id** 不同。判据只能是 id。
//
// 用法：
//   node manifest-verify.js /abs/<页面>-manifest.json [--expect-root 2008:5558]
//   全等 exit0；不等 exit1 并逐项列出差在哪；manifest 里没有 _digest → exit2 提示换新版 snippet 重抽。
//   带 --expect-root 时先对账身份（restore-gates.sh 会自动把它的 --root 传进来，不用手写）。

const fs = require('fs');

const p = process.argv[2];
if (!p) { console.log('ERR 用法: node manifest-verify.js /abs/<页面>-manifest.json'); process.exit(2); }

let m;
try { m = JSON.parse(fs.readFileSync(p, 'utf8')); }
catch (e) {
  console.log('❌ manifest 解析失败: ' + e.message);
  console.log('   最常见原因 = **返回被截断**（use_figma 超 20KB 会截）。对大页面分块 dump（按子树分几次抽），别硬塞一次。');
  process.exit(1);
}

// ── 第〇层 · 身份：这份 manifest 抽的到底是哪个节点（2026-08-20 立）──────────────
// 放在最前面的理由跟 restore-gates.sh 里「manifest 错了后面全是照错答案自查」一样：
// 块认错了，下面八项全等也只是证明「你忠实地核对了另一个块」。
const ri = process.argv.indexOf('--expect-root');
const expectRoot = ri > 0 ? process.argv[ri + 1] : null;
console.log(`\nmanifest 身份 · root=${m.root || '（这份没记 root，是旧版 snippet 抽的）'}` +
            (m.rootName ? ` · ${m.rootName}` : ''));
if (expectRoot) {
  if (!m.root) {
    console.log(`\n❌ 要求核对 root=${expectRoot}，但这份 manifest 没记 root —— 无法证明它抽的是哪个节点。`);
    console.log('   用新版 figma-restore-dump.snippet.js 重抽一次（它会写 root/rootName）。');
    process.exit(1);
  }
  if (m.root !== expectRoot) {
    console.log(`\n❌ 身份不符：你要核的是 ${expectRoot}，这份 manifest 抽的是 ${m.root}`);
    console.log(`   文件：${p}`);
    console.log('   🔴 别往下做，也别相信后面的「八项全等」—— 那只证明这份文件抄得忠实，');
    console.log('   不证明它是你要的块。最常见成因：同名 manifest 跨轮撞车（`--unpack` 自己命名、');
    console.log('   覆盖没发生），旧文件被当成新的核了一整轮。改法：把旧的改名归档，重抽当前节点。');
    process.exit(1);
  }
  console.log(`  ✅ 身份对账通过（root 与 --expect-root 一致）`);
}

// ── 第一层 · 自洽性（不需要 _digest·老 manifest 也能查）────────────────────────
// dump 会把总数写进 count / geomCount，**它们在 JSON 前面、数组在后面**——所以抄了一半 / 被截断时，
// 总数往往还在、数组已经缺了一大截。比一下就露馅。
// 🔴 2026-07-27 扫历史：30 份 manifest 里 14 份不自洽，最狠的 pbn-slide1 声明 30 叶子/47 节点、
//    实际只有 11/13（少了 19 和 34），而三道门当时照着这份残缺 manifest 跑、照样报全绿。
//    （少数是故意的：leaves-only 的分工文件、fsv2「精简版」——那种加 --allow-partial 显式声明。）
const partialOK = process.argv.includes('--allow-partial');
const selfIssues = [];
if (typeof m.count === 'number' && m.count !== (m.leaves || []).length)
  selfIssues.push(`leaves: 声明 ${m.count} 实际 ${(m.leaves || []).length}（少 ${m.count - (m.leaves || []).length}）`);
if (typeof m.geomCount === 'number' && m.geomCount !== (m.nodes || []).length)
  selfIssues.push(`nodes: 声明 ${m.geomCount} 实际 ${(m.nodes || []).length}（少 ${m.geomCount - (m.nodes || []).length}）`);
if (selfIssues.length && !partialOK) {
  console.log('\n❌ manifest 自身对不上（dump 声明的总数 ≠ 实际数组长度）· ' + p);
  selfIssues.forEach(x => console.log('   ❌ ' + x));
  console.log('\n   多半是「抄了一半」或「返回被截断」。🔴 别往下做：coverage 只核那半截叶子、');
  console.log('   geom 只核那半截节点，**照样报全绿**——这正是「门全绿但没还原对」的典型来源。');
  console.log('   确属故意只留一部分（如 leaves 与 nodes 拆成两份文件）→ 加 --allow-partial 显式声明。');
  process.exit(1);
}
if (selfIssues.length && partialOK) {
  console.log('\n⚠️  已声明 --allow-partial，跳过自洽性：');
  selfIssues.forEach(x => console.log('   ○ ' + x));
}

if (!m._digest) {
  console.log((selfIssues.length ? '' : '\n✅ 自洽性通过（声明总数 = 实际数组长度）'));
  console.log('⚠️  但这份 manifest 没有 _digest —— 是用旧版 figma-restore-dump.snippet.js 抽的，');
  console.log('   只能查「数量对不对」，查不了「值抄对没」。要全查请用新版 snippet 重抽一次。');
  process.exit(2);
}

const s = JSON.stringify({ leaves: m.leaves || [], nodes: m.nodes || [] });
const nums = (s.match(/-?\d+\.?\d*(?:e-?\d+)?/g) || []).map(Number);
const ids = [...(m.leaves || []).map(x => x.id), ...(m.nodes || []).map(x => x.id)].sort();
const strs = (s.match(/"[^"]*"/g) || []).sort();

const mine = {
  leafCount: (m.leaves || []).length,
  nodeCount: (m.nodes || []).length,
  numCount: nums.length,
  numSum: Math.round(nums.reduce((a, b) => a + b, 0) * 100000) / 100000,
  idsJoinedLen: ids.join(',').length,
  strCount: strs.length,
  strTotalLen: strs.join('').length,
  jsonLen: s.length,
};

const LABEL = {
  leafCount: '叶子数(完整性基数)', nodeCount: '节点数(几何真值基数)',
  numCount: '数值个数', numSum: '全部数值之和',
  idsJoinedLen: 'id 串总长', strCount: '字符串个数',
  strTotalLen: '字符串总长', jsonLen: 'JSON 总长',
};

console.log('\nmanifest 落盘核对 · ' + p);
let bad = 0;
for (const k of Object.keys(mine)) {
  const exp = m._digest[k], got = mine[k];
  const ok = (typeof exp === 'number' && typeof got === 'number')
    ? Math.abs(exp - got) < 1e-4 : exp === got;
  if (!ok) bad++;
  console.log(`  ${ok ? '✅' : '❌'} ${LABEL[k]}  Figma=${exp}  落盘=${got}`);
}

if (bad) {
  console.log(`\n❌ ${bad} 项不符 —— 落盘的 manifest 跟 Figma 那侧抽到的不是同一份。`);
  console.log('   两种可能：① 抄的时候漏/改了内容 ② **返回被截断**（use_figma 超 20KB 会截·大页面要分块抽）。');
  console.log('   🔴 别带着不符的 manifest 往下做：coverage/geom/visual 会照着错答案自查，全绿也是假的。');
  process.exit(1);
}

console.log('\n✅ 八项全等 —— 落盘 manifest 与 Figma dump 一致（没抄漏、没被截断）\n');
process.exit(0);
