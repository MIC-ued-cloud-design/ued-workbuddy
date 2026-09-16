#!/usr/bin/env node
/* 打包前的最后一道门：把 main.js 里那几段长提示词真求值一次。
   为什么要有（2026-09-15 一天栽两次）：往模板字符串里写中文说明时带了一个反引号，
   字符串被**提前闭合**，后面的文字变成代码表达式 —— `node --check` 是绿的（语法合法），
   但一调用 systemPrompt() 就抛 ReferenceError，客户端每次建会话都会崩。
   语法门查不出这种，只有真求值才行。 */
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'main', 'main.js'), 'utf8');
let bad = 0;

function evalBlock(name, start, endMark, args, includeEnd = true) {
  const i = src.indexOf(start);
  if (i < 0) { console.log(`❌ ${name}: 找不到起点，锚点变了`); bad++; return; }
  const k = src.indexOf(endMark, i);
  if (k < 0) { console.log(`❌ ${name}: 找不到终点`); bad++; return; }
  const seg = src.slice(i, includeEnd ? k + endMark.length : k) + ';';
  try {
    const out = new Function(...Object.keys(args), seg + ` return ${name === 'systemPrompt' ? 'systemPrompt({name:"t"})' : 'txt'};`)
      (...Object.values(args));
    console.log(`✅ ${name} 求值通过（${String(out).length} 字节）`);
  } catch (e) { console.log(`❌ ${name} 求值失败：${e.message}`); bad++; }
}

/* 🔴 边界别用 '\n}' —— 函数体里有嵌套的 }（那个 knowledgeDir() 三元），会提前截断，
   于是门求值的是「半截 systemPrompt」还报绿。2026-09-15 靠对字节数才发现。
   用「下一个顶层 function 定义」当终点才对。 */
evalBlock('systemPrompt', 'function systemPrompt(', '\nfunction ', { PACK_DIR: '/x', knowledgeDir: () => null, restoreToolsDir: () => null }, false);
evalBlock('工作区约定', 'const txt = [GUIDE_MARK', "].join('\\n')", { GUIDE_MARK: '<!--m-->', PACK_DIR: '/x', kb: null });

/* 顺带数一遍：提示词数组里每条模板字符串的反引号必须首尾各一个 */
const lines = src.split('\n');
lines.forEach((l, n) => {
  const t = l.trim();
  if (!t.startsWith('`【') ) return;
  const c = (l.match(/`/g) || []).length;
  if (c !== 2) { console.log(`❌ 第 ${n + 1} 行提示词含 ${c} 个反引号（应为 2＝首尾），内部反引号会提前闭合字符串`); bad++; }
});
if (bad) { console.log(`\n${bad} 项不通过，别打包`); process.exit(1); }
console.log('\n全部通过');
