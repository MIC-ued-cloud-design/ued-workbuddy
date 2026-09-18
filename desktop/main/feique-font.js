'use strict';
/**
 * 飞鹊字体焊死 —— 把 Roboto 400/700 以 base64 内嵌进页面的 @font-face。
 *
 * 为什么要有（2026-09-17 实测）：
 *   只写 `font-family: Roboto, -apple-system, "PingFang SC", …` 是不够的。
 *   浏览器拿到 font-weight:400 要去系统已装的 Roboto 家族里挑脸，装了 12 个 2011 版静态 Roboto
 *   （name table 全部自称 family=Roboto）的机器上 Chrome 挑中的是 **Roboto-Black(900)**，
 *   而中文回落 PingFang SC Regular(400) —— 同一行字里差 5 个字重档，就是「英文比中文粗」。
 *   用 CDP 的 CSS.getPlatformFontsForNode 量出来的；computed style 只会告诉你「你要了 400」，
 *   不会告诉你「浏览器给了 Black」，所以光看 computed 永远查不到这条。
 *
 * 为什么不写进提示词让模型自己加：base64 有 46KB，让模型原样搬运既慢又容易搬错，
 * 而且「靠模型记得加」就是赌自觉。这里由主进程在预览刷新时自动做，模型完全不参与。
 *
 * 为什么用线上那两份字体文件：吉吉要的是「自己做的页面跟 1:1 还原线上的产出质量一致」，
 * 用同一份文件才真一致。这两份是从线上 VO 页的 @font-face 里逐字节取下来的（见 packs/feique/fonts/INDEX.md）。
 */
const fs = require('fs');
const path = require('path');

const MARK = 'UW-FEIQUE-FONT';
const VER = 1;
let _css = null;

/* 两条 @font-face。只做 400 / 700，因为 DESIGN.md §1 规定飞鹊只有这两档；
   多焊一档就等于承认 500/600 合法，而体检第 2 条正在判它们违规。 */
function css(packDir) {
  if (_css) return _css;
  const b64 = f => fs.readFileSync(path.join(packDir, 'fonts', f)).toString('base64');
  const face = (w, f) => `@font-face{font-family:'Roboto';font-style:normal;font-weight:${w};font-display:block;`
    + `src:url(data:font/woff2;base64,${b64(f)}) format('woff2')}`;
  /* font-display:block 而不是 swap —— 页面是 file:// 或 uwproj:// 下的内嵌字体，解码是毫秒级的，
     不会真挡住渲染；而 swap 会先用回落字体画一帧，截图脚本正好抓到那一帧就会量出错的字重。 */
  _css = `/* ${MARK} v${VER} · 勿删 · 由 UED WorkBuddy 自动注入\n`
    + `   作用：把 Roboto 的 400/700 焊死到具体字体文件。不写这段的话，装了多个静态 Roboto 的机器上\n`
    + `   font-weight:400 会被匹配成 Roboto-Black(900)，而中文回落 PingFang-Regular(400)，中西文差 5 个字重档。\n`
    + `   字体文件＝MIC 线上正在用的那两份（micstatic.com/common/fontastic/…），来源见飞鹊包 fonts/INDEX.md。*/\n`
    + face(400, 'roboto-400.woff2') + '\n' + face(700, 'roboto-700.woff2') + `\n/* ${MARK} end */`;
  return _css;
}

/* 克隆线上的页面不注入：它自带线上那 24 条 @font-face，权重本来就是焊死的，
   再塞一份只会多 46KB 且可能跟线上那份打架（同 family 同 weight 后面的赢）。
   判据两条，任一命中即算克隆页：
     ① 有 <base href="http…>  —— 从线上克隆的页面几乎都有（整页的 CSS/图都靠它解析）
     ② 已经有 ≥4 条 Roboto 的 @font-face —— 线上是 24 条，自己写的页面一条都没有，4 是很宽的界 */
function isClone(html) {
  if (/<base\b[^>]*\bhref\s*=\s*["']https?:/i.test(html)) return true;
  const n = (html.match(/@font-face[^}]*font-family\s*:\s*["']?Roboto/gi) || []).length;
  return n >= 4;
}

/* 页面压根没声明 Roboto 就别管它（纯文档、纯 SVG、别人的页面）。 */
function usesRoboto(html) { return /font-family[^;}"']*Roboto/i.test(html); }

function has(html) { return html.includes(MARK); }

/**
 * 幂等：已经注入过就原样返回。返回 { html, changed, why }。
 * 插在 <head> 里第一个 <style> 之前 —— 必须在页面自己的样式之前，
 * 这样页面里万一自己写了同 family 同 weight 的 @font-face，它赢，我们不覆盖别人的意图。
 */
function ensure(html, packDir) {
  if (typeof html !== 'string' || !html) return { html, changed: false, why: '空' };
  if (has(html)) return { html, changed: false, why: '已注入' };
  if (!usesRoboto(html)) return { html, changed: false, why: '页面没用 Roboto' };
  if (isClone(html)) return { html, changed: false, why: '克隆线上的页面，自带线上 @font-face' };
  let block;
  try { block = css(packDir); } catch (e) { return { html, changed: false, why: '字体文件读不到：' + e.message }; }
  const style = `<style>\n${block}\n</style>\n`;
  /* 落点按优先级找：head 开头 → 第一个 style 之前 → html 开头 → 整个文件最前。
     放 <head> 最前面是对的：@font-face 早一点被发现，字体解码就早一点开始。 */
  const head = html.match(/<head\b[^>]*>/i);
  if (head) return { html: html.slice(0, head.index + head[0].length) + '\n' + style + html.slice(head.index + head[0].length), changed: true, why: '插在 <head> 后' };
  const st = html.search(/<style\b/i);
  if (st >= 0) return { html: html.slice(0, st) + style + html.slice(st), changed: true, why: '插在第一个 <style> 前' };
  const ht = html.match(/<html\b[^>]*>/i);
  if (ht) return { html: html.slice(0, ht.index + ht[0].length) + '\n' + style + html.slice(ht.index + ht[0].length), changed: true, why: '插在 <html> 后' };
  return { html: style + html, changed: true, why: '插在文件最前' };
}

/** 落盘版：读→注入→只在真变了的时候写回。返回 ensure 的结果（不含 html）。 */
function ensureFile(abs, packDir) {
  let src;
  try { src = fs.readFileSync(abs, 'utf8'); } catch (e) { return { changed: false, why: '读不到' }; }
  const r = ensure(src, packDir);
  if (!r.changed) return { changed: false, why: r.why };
  try { fs.writeFileSync(abs, r.html); } catch (e) { return { changed: false, why: '写不回：' + e.message }; }
  return { changed: true, why: r.why };
}

module.exports = { ensure, ensureFile, isClone, usesRoboto, has, MARK, VER, css };
