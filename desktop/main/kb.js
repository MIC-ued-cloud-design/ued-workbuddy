'use strict';
/* 资料库数据：解析随包 kbdocs/INDEX.md 成分组清单；从飞鹊包抽组件表 / 图标名单 / 颜色 token。纯函数，主进程与测试共用。 */
const fs = require('fs');
const path = require('path');

function index(root) {
  const idx = fs.readFileSync(path.join(root, 'INDEX.md'), 'utf8');
  const groups = []; let g = null;
  for (const line of idx.split('\n')) {
    const h = /^## (.+?)（(\d+) 份）/.exec(line) || /^## (.+)$/.exec(line);
    if (h) { g = { title: h[1].trim(), n: h[2] ? +h[2] : 0, items: [] }; groups.push(g); continue; }
    const m = /^- \[([^\]]+)\]\(([^)]+)\)\s*——\s*(.*)$/.exec(line);
    if (m && g) g.items.push({ id: m[1], rel: m[2], summary: m[3].replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}️⭐🔴🆕]/gu, '').replace(/\s{2,}/g, ' ').trim() });
  }
  for (const gr of groups) if (!gr.n) gr.n = gr.items.length;
  return groups;
}

/* 飞鹊包速览：图标名单 / Web 与移动端组件表 / 颜色 token / 字号间距圆角阶梯 */
function feique(packDir) {
  const rd = f => JSON.parse(fs.readFileSync(path.join(packDir, f), 'utf8'));
  const icons = fs.readdirSync(path.join(packDir, 'icons')).filter(f => f.endsWith('.svg')).map(f => f.replace(/\.svg$/, '')).sort();
  const pick = c => ({ page: c.page, name: String(c.page || c.name || '').replace(/[✅🤖❌\s]+$/g, '').trim(), key: c.key, nodeId: c.nodeId, variantCount: c.variantCount, props: c.props && typeof c.props === 'object' ? Object.keys(c.props) : [], defaultVariant: c.defaultVariant, note: c.criticalNote || c.note || '' });
  const web = rd('web-components.json'), mob = rd('mobile-components.json'), tk = rd('tokens.json');
  const flat = x => Array.isArray(x) ? x : Object.values(x || {});
  const colors = [];
  const walk = (o, pfx) => {
    for (const [k, v] of Object.entries(o || {})) {
      if (k.startsWith('_')) continue;
      const nm = pfx ? pfx + ' / ' + k : k;
      if (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v)) colors.push({ name: nm, hex: v.toUpperCase() });
      else if (v && typeof v === 'object') {
        if (typeof v.hex === 'string') colors.push({ name: nm, hex: v.hex.toUpperCase(), use: v.use || '' });
        else if (typeof v.main === 'string') { colors.push({ name: nm + ' / main', hex: v.main.toUpperCase() }); if (v.hover) colors.push({ name: nm + ' / hover', hex: v.hover.toUpperCase() }); if (v.lightBg) colors.push({ name: nm + ' / lightBg', hex: v.lightBg.toUpperCase() }); }
        else walk(v, nm);
      }
    }
  };
  walk(tk.color, '');
  return { icons, iconWords: iconWords(packDir), brand: brandList(packDir), web: flat(web.components).map(pick), mob: flat(mob.components).map(pick), colors, fontSize: tk.fontSize && tk.fontSize.web ? tk.fontSize.web.scale : [], spacing: tk.spacing ? tk.spacing.scale : [], radius: tk.radius ? tk.radius.scale : [] };
}
/* 图标的中文名与检索词：icons/INDEX.md 里一行一个，形如
   | `attachment.svg` | 附件 | attachment, file, 附件, 上传文件 |
   🔴 只按文件名搜是搜不到的 —— 文件名多是 MIC 内部缩写（聊天叫 tm、附件叫 attachment），
   吉吉 2026-09-17 就是搜不到「附件」才以为库里没有。 */
function iconWords(packDir) {
  const out = {};
  let md = ''; try { md = fs.readFileSync(path.join(packDir, 'icons', 'INDEX.md'), 'utf8'); } catch (e) { return out; }
  const re = /^\|\s*`([^`]+)\.svg`\s*\|([^|]*)\|([^|]*)\|/gm; let m;
  while ((m = re.exec(md))) {
    const use = m[2].trim(), kw = m[3].trim();
    out[m[1]] = (use + ' ' + kw).replace(/\s+/g, ' ').trim();
  }
  /* 表格只覆盖 31 个高频的；剩下 260 多个按分类段落收 —— 至少能按「询盘」「交易」这种类目搜到。
     结构：### 询价询盘（22） / 一行说明 / ```一堆用空格分开的文件名``` */
  const sec = /^###\s*(.+?)(?:（\d+）)?\s*$\n([^\n]*)\n+```\n([\s\S]*?)```/gm; let g;
  while ((g = sec.exec(md))) {
    const words = (g[1] + ' ' + g[2]).replace(/[*`—]/g, ' ').replace(/\s+/g, ' ').trim();
    for (const n of g[3].split(/\s+/)) { if (!n) continue; out[n] = ((out[n] || '') + ' ' + words).trim(); }
  }
  return out;
}
/* 品牌与认证标识：18 个现成 SVG，跟 UI 图标一起摆进选择器。
   吉吉 2026-09-17：选中页面里的认证标（svg.bmark）时，选择器里一个品牌标都没有，换不了。 */
function brandList(packDir) {
  const dir = path.join(packDir, 'brand');
  let md = ''; try { md = fs.readFileSync(path.join(dir, 'INDEX.md'), 'utf8'); } catch (e) {}
  const desc = {};
  const re = /^\|\s*`([^`]+)\.svg`\s*\|([^|]*)\|([^|]*)\|([^|]*)\|/gm; let m;
  while ((m = re.exec(md))) desc[m[1]] = { size: m[2].trim(), what: m[3].trim(), when: m[4].trim() };
  let files = []; try { files = fs.readdirSync(dir).filter(f => f.endsWith('.svg')); } catch (e) { return []; }
  return files.sort().map(f => { const n = f.replace(/\.svg$/, ''); const d = desc[n] || {}; return { name: n, size: d.size || '', what: d.what || '', words: ((d.what || '') + ' ' + (d.when || '') + ' ' + n).replace(/\s+/g, ' ').trim() }; });
}
/* 图标指纹：每个飞鹊图标取所有 <path d> 的完整串，用来认出页面里的 svg 是哪一个（Figma 认实例，这里认路径） */
let _fp = null, _fpDir = null;
function iconIndex(packDir) {
  if (_fp && _fpDir === packDir) return _fp;
  const dir = path.join(packDir, 'icons'); const out = {};
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.svg')) continue;
    const t = fs.readFileSync(path.join(dir, f), 'utf8');
    const ds = [...t.matchAll(/\sd="([^"]+)"/g)].map(m => m[1].replace(/\s+/g, ' ').trim());   // 全串：前 48 字符会有 91 组撞车（add-row-down / add-row-left 这种只差尾巴）
    if (ds.length) out[f.replace(/\.svg$/, '')] = ds;
  }
  _fp = out; _fpDir = packDir; return out;
}
function identifyIcon(packDir, ds) {
  if (!ds || !ds.length) return null;
  const want = ds.map(d => String(d).replace(/\s+/g, ' ').trim());
  const idx = iconIndex(packDir);
  let best = null, bestScore = 0;
  for (const [name, list] of Object.entries(idx)) {
    const hit = want.filter(d => list.includes(d)).length;
    const score = hit / Math.max(want.length, list.length);
    if (hit && score > bestScore) { best = name; bestScore = score; }
  }
  return bestScore >= 0.99 ? { name: best, exact: true } : best ? { name: best, exact: false, score: bestScore } : null;
}
function iconSvg(packDir, name, kind) {
  if (!/^[\w.-]+$/.test(name)) throw new Error('图标名不合法');
  const dir = kind === 'brand' ? 'brand' : 'icons';
  return fs.readFileSync(path.join(packDir, dir, name + '.svg'), 'utf8').replace(/^\s*<\?xml[^>]*>\s*/, '').trim();
}
/* ── 用户自己添加的资料 / 技能 ──
   随包的 kbdocs 每次更新都会被整个换掉，所以用户加的东西住在 ~/.uw-desktop/kb/，一份 index.json 记标题与说明。
   rel 以 user/ 开头，跟随包那份的 biz/ method/ skill/ 分开。 */
const os = require('os');
function userDir() { const d = path.join(os.homedir(), '.uw-desktop', 'kb'); fs.mkdirSync(path.join(d, 'docs'), { recursive: true }); fs.mkdirSync(path.join(d, 'skills'), { recursive: true }); return d; }
function userIndexFile() { return path.join(userDir(), 'index.json'); }
function readUserIndex() { try { return JSON.parse(fs.readFileSync(userIndexFile(), 'utf8')); } catch (e) { return []; } }
function writeUserIndex(list) { fs.writeFileSync(userIndexFile(), JSON.stringify(list, null, 2)); }
function safeName(name) { return String(name || '未命名').replace(/[\/\\:*?"<>|]/g, '_').trim().slice(0, 120) || '未命名'; }
function freeName(dir, name) { const ext = path.extname(name), base = name.slice(0, name.length - ext.length); let cand = name, k = 2; while (fs.existsSync(path.join(dir, cand))) cand = `${base}-${k++}${ext}`; return cand; }
function summaryOf(abs) {
  try {
    if (!/\.(md|markdown|txt)$/i.test(abs)) return path.extname(abs).replace('.', '').toUpperCase() + ' 文件';
    const t = fs.readFileSync(abs, 'utf8').replace(/^---[\s\S]*?---\s*/, '');
    const lines = t.split('\n'); if (/^#\s/.test(lines[0] || '')) lines.shift();   // 第一行是标题就跳过，说明该取正文第一句
    const line = lines.map(x => x.replace(/^[#>\-*\s]+/, '').trim()).find(x => x.length > 3) || '';
    return line.slice(0, 120);
  } catch (e) { return ''; }
}
/* kind: doc | skill；来源：path（拷进来）或 text（写成 md） */
/* ── 从网址抓一份资料 ────────────────────────────
   吉吉 2026-09-17：「未来很多知识库和规范都会集中在内网上，我可以直接给 URL 就能识别」。
   用 Electron 的 net.fetch 而不是 node 的 https：它走系统代理、认系统证书链、带上登录用的 cookie —— 内网就靠这几条。
   抓回来是 HTML，存进资料库的是**纯文本**（Claude 读的是文字，留一堆标签只会占地方还读不懂）。 */
function htmlToText(html) {
  let s = String(html || '');
  s = s.replace(/<!--[\s\S]*?-->/g, '')
       .replace(/<(script|style|noscript|svg|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
       .replace(/<(nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, '');   // 导航页脚不是正文
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (m, n, t) => '\n\n' + '#'.repeat(+n) + ' ' + t + '\n')
       .replace(/<li\b[^>]*>/gi, '\n- ')
       .replace(/<\/(p|div|tr|section|article|ul|ol|li|table|h[1-6])>/gi, '\n')
       .replace(/<br\s*\/?>/gi, '\n')
       .replace(/<\/t[dh]>/gi, ' | ')
       .replace(/<[^>]+>/g, '');
  const ENT = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", mdash: '—', ndash: '–', hellip: '…' };
  s = s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (ENT[k] != null) return ENT[k];
    if (k[0] === '#') { const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); return isFinite(n) ? String.fromCodePoint(n) : m; }
    return m;
  });
  return s.replace(/[ \t\u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n')
          .replace(/(\n- [^\n]*)\n{2,}(?=- )/g, '$1\n').trim();   // 一份清单别被拉成隔行的
}
async function fetchUrl(url) {
  let u;
  try { u = new URL(String(url).trim()); } catch (e) { throw new Error('这不像一个网址，要带上 http:// 或 https://'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('只支持 http / https 的网址');
  const { net } = require('electron');
  let r;
  try { r = await net.fetch(u.toString(), { headers: { 'User-Agent': 'UED-WorkBuddy', 'Accept': 'text/html,text/plain,*/*' }, redirect: 'follow' }); }
  catch (e) { throw new Error('打不开这个网址：' + e.message + '（内网的话先确认这台电脑连着内网）'); }
  if (r.status === 401 || r.status === 403) throw new Error('这个页面要登录才能看（回了 ' + r.status + '）。先在浏览器里打开、另存成文件，再用「选一个文件」加进来');
  if (!r.ok) throw new Error('打不开这个网址：服务器回了 ' + r.status);
  const ct = (r.headers.get('content-type') || '').toLowerCase();
  if (!/text\/html|text\/plain|application\/(xhtml|json)/.test(ct)) {
    throw new Error('这个链接不是网页（' + (ct.split(';')[0] || '未知类型') + '）。PDF、Word 这类先下载下来，用「选一个文件」加进来');
  }
  const raw = await r.text();
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw) || [])[1];
  const text = /json/.test(ct) ? raw : (/html|xhtml/.test(ct) ? htmlToText(raw) : raw.trim());
  if (!text || text.length < 40) throw new Error('这一页几乎没有正文，多半是要登录、或者内容是打开后才加载的。先在浏览器里打开、另存成文件再加');
  return { title: title ? htmlToText(title).trim() : '', text, url: u.toString() };
}
function addUser(kind, { path: src, title, text, summary, url }) {
  kind = kind === 'skill' ? 'skill' : 'doc';
  const dir = path.join(userDir(), kind === 'skill' ? 'skills' : 'docs');
  let file;
  if (src) {
    if (!fs.existsSync(src)) throw new Error('文件不存在：' + src);
    if (fs.statSync(src).isDirectory()) throw new Error('先选一个文件（文件夹里的 SKILL.md 或说明文档）');
    file = freeName(dir, safeName(title ? title + path.extname(src) : path.basename(src)));
    fs.copyFileSync(src, path.join(dir, file));
  } else {
    if (!String(text || '').trim()) throw new Error('内容是空的');
    file = freeName(dir, safeName(title || '未命名') + '.md');
    /* 从网址抓来的，把出处写在正文顶上：以后要核对、要重新抓，都指得到源头 */
    const head = (title ? '# ' + title + '\n\n' : '') + (url ? '> 来源：' + url + '（' + new Date().toLocaleDateString('zh-CN') + ' 抓取）\n\n' : '');
    fs.writeFileSync(path.join(dir, file), head + String(text).trim() + '\n');
  }
  const rel = 'user/' + (kind === 'skill' ? 'skills' : 'docs') + '/' + file;
  const entry = { id: (title || file.replace(/\.[^.]+$/, '')).trim(), rel, kind, summary: (summary || '').trim() || summaryOf(path.join(dir, file)), addedAt: Date.now(), src: src || url || null };
  const list = readUserIndex(); list.push(entry); writeUserIndex(list);
  return entry;
}
function removeUser(rel) {
  const list = readUserIndex(); const k = list.findIndex(e => e.rel === rel); if (k < 0) throw new Error('没有这一条');
  const abs = userAbs(rel); try { fs.rmSync(abs, { force: true }); } catch (e) {}
  list.splice(k, 1); writeUserIndex(list); return true;
}
function userAbs(rel) { const abs = path.normalize(path.join(userDir(), String(rel).replace(/^user\//, ''))); if (!abs.startsWith(userDir())) throw new Error('越界'); return abs; }
/* 并进索引：两个分组，空的不显示 */
function userGroups() {
  const list = readUserIndex();
  const mk = (kind, title) => { const items = list.filter(e => e.kind === kind).map(e => ({ id: e.id, rel: e.rel, summary: e.summary, user: true, addedAt: e.addedAt })); return items.length ? [{ title, n: items.length, items, user: true }] : []; };
  return [...mk('doc', '我添加的资料'), ...mk('skill', '我添加的技能')];
}
module.exports = { index, feique, iconIndex, identifyIcon, iconSvg, userDir, addUser, removeUser, userAbs, userGroups, readUserIndex, fetchUrl, htmlToText };
