'use strict';
/**
 * 飞鹊缺省图 —— 把 31 张业务场景插图按需内嵌进页面。
 *
 * 为什么要有（吉吉 2026-09-18 报「UW 客户端不认识和不会使用飞鹊的缺省图」）：
 *   追下来不是模型不会用 —— 他那页 `.empty` / `.empty-img` / `.empty-title` / `.empty-desc` 全用对了。
 *   真因是**包里根本没有图**：DESIGN.md 原来白纸黑字写着「缺省图在 sprites（本包未带，需要时留空占位块 #F0F1F2）」。
 *   模型是照着规则做的，画出来就是一个灰方块。**规则让它这么做，它就这么做了。**
 *   → 判据：说「模型不会用 X」之前，先确认 X 在它够得着的地方。
 *
 * 为什么不让模型自己贴 base64：一张 webp 2–6KB，base64 出来 3–8KB，让模型原样搬既慢又容易搬错，
 *   而且「靠模型记得贴」就是赌自觉。跟字体那条一样，由主进程在确定的时点自动做。
 *
 * 模型只要写：  <div class="empty-img"><img data-feique-empty="no-product-result" alt=""></div>
 * 这里把 src 填进去（幂等）。**那个属性留在源码里是故意的** —— 它告诉前端「这是飞鹊缺省图哪一张」，
 * 跟交互流程说明里「可定位」是同一条道理；换成匿名的 data: 就谁也说不清这图是哪来的了。
 */
const fs = require('fs');
const path = require('path');

const MARK = 'data-feique-empty';
const DIR = 'sprites';
const cache = new Map();

function dataUri(packDir, name) {
  const key = packDir + '|' + name;
  if (cache.has(key)) return cache.get(key);
  const abs = path.join(packDir, DIR, name + '.webp');
  if (!fs.existsSync(abs)) return null;
  const uri = 'data:image/webp;base64,' + fs.readFileSync(abs).toString('base64');
  cache.set(key, uri);
  return uri;
}

/** 包里现有哪些（给体检和提示词用） */
function list(packDir) {
  try { return fs.readdirSync(path.join(packDir, DIR)).filter(f => f.endsWith('.webp')).map(f => f.slice(0, -5)).sort(); }
  catch (e) { return []; }
}

/**
 * 幂等：已经有 src 的不碰。返回 { html, changed, filled:[], missing:[] }。
 * 只认 <img ... data-feique-empty="名字" ...>，别的一律不动 —— 这是个很窄的口子，
 * 窄是故意的：自动改别人页面里的 <img> 是件危险的事，只改自己约定的那种。
 */
function ensure(html, packDir) {
  if (typeof html !== 'string' || !html) return { html, changed: false, filled: [], missing: [] };
  const filled = [], missing = [];
  const out = html.replace(/<img\b[^>]*>/gi, tag => {
    const m = tag.match(new RegExp(MARK + '\\s*=\\s*("([^"]*)"|\'([^\']*)\')', 'i'));
    if (!m) return tag;
    const name = (m[2] ?? m[3] ?? '').trim();
    if (!name) return tag;
    const uri = dataUri(packDir, name);
    if (!uri) { missing.push(name); return tag; }
    /* 已经填过就别再填（幂等）。注意不能用 /src\s*=/ 直接判——data-src 之类会误命中 */
    if (/(^|\s)src\s*=/i.test(tag)) return tag;
    filled.push(name);
    /* alt 没写就补一个空的：这是装饰性插图，读屏软件应当跳过，
       写成空 alt 比让它念一串文件名对用户好 */
    const alt = /(^|\s)alt\s*=/i.test(tag) ? '' : ' alt=""';
    return tag.replace(/^<img\b/i, '<img src="' + uri + '"') .replace(/\s*\/?>$/, alt + (/\/>$/.test(tag) ? '/>' : '>'));
  });
  return { html: out, changed: out !== html, filled, missing };
}

/** 落盘版：读→填→只在真变了的时候写回 */
function ensureFile(abs, packDir) {
  let src;
  try { src = fs.readFileSync(abs, 'utf8'); } catch (e) { return { changed: false, filled: [], missing: [], why: '读不到' }; }
  const r = ensure(src, packDir);
  if (r.changed) { try { fs.writeFileSync(abs, r.html); } catch (e) { return { changed: false, filled: [], missing: r.missing, why: '写不回：' + e.message }; } }
  return { changed: r.changed, filled: r.filled, missing: r.missing, why: r.changed ? `填了 ${r.filled.length} 张` : (r.missing.length ? '有名字对不上的' : '没有要填的') };
}

module.exports = { ensure, ensureFile, list, dataUri, MARK };
