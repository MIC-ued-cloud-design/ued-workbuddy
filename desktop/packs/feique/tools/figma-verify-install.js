#!/usr/bin/env node
/**
 * figma-verify-install.js — 把 figma-verify.js 装进 Figma 文档，之后每次跑门只贴一行
 *
 * 治什么：figma-verify.js 原文 43KB、剥注释后仍 31KB，而 use_figma 的 code 上限 50KB。
 * 以前每跑一次门就得把 31KB 整个贴进 code 参数 —— 一轮出稿跑 2-3 次门 = 白写 6-9 万 token
 * 的纯生成时间。实测这是「出一张稿」耗时里最大的单点。
 *
 * 怎么治：Figma 沙箱实测支持 new Function / eval / sharedPluginData 存 40KB（2026-08-09 探针验过，
 * 见下方 PROBE 注释）。所以把剥注释版存进「文档」自己的 sharedPluginData，之后每次只贴几百字节的调用。
 *
 * PROBE（别再重验，也别假设换个文件就不行 —— 换文件要重装，但能力是 Figma 级的）：
 *   new Function('a','return a*2')(21) → 42        eval('1+1') → 2
 *   sharedPluginData 存取 40000 字符 → 40000        new Function 造 async 函数并 await → 7
 *
 * 用法：
 *   node figma-verify-install.js                 # 只生成安装片段
 *   node figma-verify-install.js --node 116:2    # 同时生成带节点 id 的调用片段
 *
 * 产出两个文件（路径会打印出来）：
 *   /tmp/fv-install.js  ← 每个 Figma 文件只贴一次（31KB）
 *   /tmp/fv-call.js     ← 之后每次跑门贴这个（<1KB）
 *
 * 🔴 版本指纹：调用片段里写死了当前 figma-verify.js 的 hash。改了 verify 之后不重装，
 *    调用片段会直接报「文档里装的是旧版」并拒绝跑 —— 不会拿旧门给出假绿。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SKILL_DIR = path.resolve(__dirname, '..');
const SRC_PATH = [
  path.join(__dirname, 'figma-verify.js'),                 // 随客户端分发时：跟本脚本同目录
  path.join(SKILL_DIR, 'assets/docs/figma-verify.js'),     // 装了 skill 的机器上：原来的位置
].find(p => fs.existsSync(p)) || path.join(SKILL_DIR, 'assets/docs/figma-verify.js');
const NS = 'micfullstack';

function stripComments(src) {
  const out = [];
  for (const line of src.split('\n')) {
    const t = line.trim();
    if (t.startsWith('//')) continue;
    let l = line;
    const i = l.indexOf('//');
    if (i > 0) {
      const before = l.slice(0, i);
      // 行尾 // 只在其前不含引号时才当注释剥（否则会切坏 URL / 字符串里的 //）
      if (!/['"`]/.test(before)) l = before.replace(/\s+$/, '');
    }
    if (l.trim() === '') continue;
    out.push(l);
  }
  return out.join('\n');
}

function main() {
  const argv = process.argv.slice(2);
  const nodeIdx = argv.indexOf('--node');
  const nodeId = nodeIdx >= 0 ? argv[nodeIdx + 1] : '<节点ID>';

  if (!fs.existsSync(SRC_PATH)) {
    console.error('❌ 找不到权威脚本：' + SRC_PATH);
    process.exit(1);
  }
  const raw = fs.readFileSync(SRC_PATH, 'utf8');
  const slim = stripComments(raw);

  // 语法自检 —— 剥注释切坏了就在这里炸，别等贴进 Figma 才发现
  try {
    new Function(slim);
  } catch (e) {
    console.error('❌ 剥注释后语法不合法，拒绝产出：' + e.message);
    process.exit(1);
  }
  if (!/function\s+verify\s*\(/.test(slim)) {
    console.error('❌ 剥注释后找不到 verify 函数定义，拒绝产出');
    process.exit(1);
  }

  // 🔴 指纹必须【从实际内容算】，绝不能手填一个常量。
  // 2026-08-09 踩过：install 时我手工重打了一个精简版贴进去，却照抄了权威版的 hash ——
  // 内容是精简版、指纹说是权威版，版本门于是把它当「已装最新」放行 = 标准假绿，比不装还危险。
  // 现在 install 片段自己算指纹、call 片段用同一个算法算本地的，贴错了必然对不上。
  // 算法故意用最土的 32 位滚动哈希：Figma 沙箱里没有 crypto，两边必须能跑同一段代码。
  const FP_FN = "(function(s){var h=0;for(var i=0;i<s.length;i++){h=(h*31+s.charCodeAt(i))>>>0;}return s.length+'-'+h.toString(16);})";
  const fingerprint = eval(FP_FN)(slim);

  // 🔴 分块传，别一次塞 32KB。
  // 2026-08-09 实测：单次 33KB 的 install payload 让 use_figma 的 socket 直接断了
  // （23KB 那次是通的，所以断点在两者之间）。use_figma 是原子的，断了不会写坏，
  // 但一次也装不进去 —— 于是切块。每块 12KB，宁可多一个来回也别赌那条连接。
  // 切在 UTF-16 code unit 上是安全的：拆开存、拼回来无损，就算切在代理对中间也能还原；
  // 真走样了指纹会对不上，不靠「切得准」兜底。
  const CHUNK = 12000;
  const chunks = [];
  for (let i = 0; i < slim.length; i += CHUNK) chunks.push(slim.slice(i, i + CHUNK));
  const N = chunks.length;

  const installFiles = chunks.map((c, i) => {
    const isLast = i === N - 1;
    let s = "figma.root.setSharedPluginData('" + NS + "','verify-src-" + i + "', " + JSON.stringify(c) + ");\n";
    if (!isLast) {
      s += 'return { part: ' + (i + 1) + ', of: ' + N + ', bytes: ' + c.length + ', next: "贴 /tmp/fv-install-' + (i + 2) + '.js" };\n';
    } else {
      s += "figma.root.setSharedPluginData('" + NS + "','verify-parts','" + N + "');\n" +
        'let all = "";\n' +
        'for (let k = 0; k < ' + N + '; k++) all += figma.root.getSharedPluginData(' + JSON.stringify(NS) + ", 'verify-src-' + k);\n" +
        'const FP = ' + FP_FN + '(all);\n' +
        "figma.root.setSharedPluginData('" + NS + "','verify-fp', FP);\n" +
        '// 装完立刻回报【拼回来之后】实测的指纹 —— 跟脚本打印的对不上就是某一块贴走样了\n' +
        'return { installed: true, parts: ' + N + ', bytes: all.length, fingerprintInDoc: FP, fingerprintExpected: ' + JSON.stringify(fingerprint) + ', match: FP === ' + JSON.stringify(fingerprint) + ' };\n';
    }
    return s;
  });

  const call =
    "const n = parseInt(figma.root.getSharedPluginData('" + NS + "','verify-parts') || '0', 10);\n" +
    "if (!n) return { error: '本 Figma 文件还没装 verify → 跑 node scripts/figma-verify-install.js，依次贴 /tmp/fv-install-1..N.js' };\n" +
    "let src = '';\n" +
    "for (let k = 0; k < n; k++) src += figma.root.getSharedPluginData('" + NS + "', 'verify-src-' + k);\n" +
    '// 指纹当场从拼回来的内容算，不信任存下来的那个字段（存的可能是贴错时一起写错的）\n' +
    'const actual = ' + FP_FN + '(src);\n' +
    'const want = ' + JSON.stringify(fingerprint) + ';\n' +
    "if (actual !== want) return { error: '文档里装的 verify 跟本地权威脚本对不上（文档 ' + actual + ' / 本地 ' + want + '）→ 重装。别跑，跑了就是拿不知道哪一版的门当绿' };\n" +
    "const verify = new Function('figma', src + '\\nreturn verify;')(figma);\n" +
    "return await verify('" + nodeId + "');\n";

  installFiles.forEach((s, i) => fs.writeFileSync('/tmp/fv-install-' + (i + 1) + '.js', s));
  fs.writeFileSync('/tmp/fv-call.js', call);

  console.log('权威脚本 ' + (raw.length / 1024).toFixed(1) + 'KB → 剥注释 ' + (slim.length / 1024).toFixed(1) + 'KB ｜ 指纹 ' + fingerprint);
  console.log('');
  console.log('① 每个 Figma 文件装一次，按顺序贴 ' + N + ' 块（每块约 ' + (installFiles[0].length / 1024).toFixed(1) + 'KB，切块是因为单次 33KB 会把 socket 挤断）：');
  installFiles.forEach((s, i) => console.log('     /tmp/fv-install-' + (i + 1) + '.js  (' + s.length + ' 字节)'));
  console.log('   🔴 贴完最后一块，核对返回值里 match:true —— false 就是某块贴走样了，别往下跑。');
  console.log('② 之后每次跑门只贴这个（' + call.length + ' 字节）：/tmp/fv-call.js');
  console.log('');
  console.log('省的账：以前每次跑门贴 ' + (slim.length / 1024).toFixed(1) + 'KB，装完之后每次 ' + call.length + ' 字节 —— 一轮出稿通常跑 2-3 次门。');
}

main();
