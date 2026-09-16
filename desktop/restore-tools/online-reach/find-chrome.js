#!/usr/bin/env node
// find-chrome.js —— 找出本机可用的 Chrome/Chromium 内核浏览器
//
// 为什么有这个文件（2026-09-15 立）：reach.sh / shot-node.js / capture-login-state.js
// 三处各自把路径写死成 /Applications/Google Chrome.app。用户本机装了所以一直没事，
// **同事那台没装 Chrome，整条还原工具链直接跑不起来**，而且报错信息只说「Chrome/CDP 没起来」，
// 看不出是「没装」还是「装了但起不来」。
//
// 用法：
//   node find-chrome.js              → 打印可执行文件路径（找到才 exit 0）
//   node find-chrome.js --json       → 打印 {path, name, isRealChrome}
//   require('./find-chrome.js').find()  → 同上，给 node 脚本用
//   环境变量 CHROME_PATH 优先于一切（装在别处/想指定某个版本时用）
//
// 🔴 为什么排序是「真 Chrome 优先」：reach.sh 的注释写了「真实 Chrome.app 过反爬指纹」。
//    MIC 站点有 WAF，换成 Chromium/Edge **可能被拦**。所以回落时会在 stderr 明确警告，
//    让人知道「读不出来可能是浏览器换了，不是页面的问题」——别让回落变成一个静默的坑。

const fs = require('fs');
const path = require('path');

// 顺序＝优先级。真 Chrome 在前，Chromium 内核的替代品在后。
const CANDIDATES = [
  ['Google Chrome',        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',                true ],
  ['Google Chrome',        '~/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',               true ],
  ['Google Chrome Beta',   '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',      true ],
  ['Google Chrome Canary', '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',  true ],
  ['Microsoft Edge',       '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',              false],
  ['Brave',                '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',                false],
  ['Chromium',             '/Applications/Chromium.app/Contents/MacOS/Chromium',                          false],
];

function expand(p) { return p.startsWith('~') ? path.join(process.env.HOME || '', p.slice(1)) : p; }

function find() {
  // ① 显式指定优先
  const env = process.env.CHROME_PATH;
  if (env) {
    const p = expand(env);
    if (fs.existsSync(p)) return { path: p, name: '(CHROME_PATH 指定)', isRealChrome: /Google Chrome/.test(p) };
    throw new Error('CHROME_PATH 指到了 ' + p + '，但这个文件不存在。改对它，或者把它取消掉让脚本自己找。');
  }
  // ② 常见安装位置
  for (const [name, p, real] of CANDIDATES) {
    const full = expand(p);
    if (fs.existsSync(full)) return { path: full, name, isRealChrome: real };
  }
  // ③ 全盘找一次（慢，所以放最后；只找 Chrome 自己）
  try {
    const out = require('child_process')
      .execSync('mdfind "kMDItemCFBundleIdentifier == \'com.google.Chrome\'" 2>/dev/null | head -1', { encoding: 'utf8' })
      .trim();
    if (out) {
      const full = path.join(out, 'Contents/MacOS/Google Chrome');
      if (fs.existsSync(full)) return { path: full, name: 'Google Chrome（装在非常规位置）', isRealChrome: true };
    }
  } catch (e) { /* mdfind 不可用就算了 */ }

  throw new Error(
    '本机找不到 Chrome。这套还原工具链要一个 Chromium 内核的浏览器才能跑。\n' +
    '  三条路，挑一条：\n' +
    '  ① 装 Google Chrome（推荐，站点反爬对它最宽松）：https://www.google.com/chrome/\n' +
    '  ② 已经装了但在别处 → 设环境变量：export CHROME_PATH="/你的/路径/Google Chrome"\n' +
    '  ③ 不想装 → 改用 chrome-devtools 的 MCP 去读页面，别用这套脚本（提示词里有这条兜底指引）'
  );
}

module.exports = { find };

if (require.main === module) {
  try {
    const r = find();
    if (!r.isRealChrome) {
      process.stderr.write('⚠️  没找到 Google Chrome，回落用 ' + r.name + '。\n' +
        '    MIC 站点有反爬，换内核**可能被拦**（读回来是验证码页或 Forbidden）。\n' +
        '    如果读不出内容，先怀疑这一条，不是页面的问题。\n');
    }
    process.stdout.write(process.argv.includes('--json') ? JSON.stringify(r) : r.path);
  } catch (e) {
    process.stderr.write(e.message + '\n');
    process.exit(1);
  }
}
