// live-clone.js — 把 MIC 线上页面 1:1 克隆成可离线运行的本地页（demo 外壳底座）
//
// 为什么要它：以前做前台 demo 用「整页截图当底图 + 文字补丁」，代价是
//   ① 死的——没有响应式、没有 hover/transition、窗口一缩就废
//   ② 假的——改一句文案就露馅（标题写「床品四件套」底下是自行车）
//   ③ 贵的——每个场景要重新截图 + base64，一个 demo 2.2MB 全是图
// 克隆真页面则「响应式 + 交互动效」是白拿的：原样保留线上 CSS 的 @media / :hover / transition。
//
// 用法：
//   1) 起后台 Chrome（端口 9224，同 reach.sh）
//   2) node live-clone.js --url "<线上URL>" --name serp --out /abs/工作目录 [--width 1440]
//
// 产出（--out 目录下）：
//   <name>.html              克隆页（引用 assets/，开发时改这份）
//   <name>-assets/           图片 / 字体 / CSS 引用到的资源
//   <name>-clone-report.json 资源清单 + 图标映射 + 剥掉了什么（交付时要能交代）
//
// 单文件自包含版由 build-inline.js 生成，别手改（同 build-standalone.py 的单一维护源纪律）。

const puppeteer = require('./node_modules/puppeteer-core');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// 本脚本住在 <SKILL>/scripts/online-reach/ 下 —— 从自身位置推 skill 根，别写死绝对路径
// （写死本机家目录的话同事拉下来直接跑不了；self-check 有一道「脚本路径可移植」硬拦）
const SKILL = path.resolve(__dirname, '..', '..');
const SVG_DIR = path.join(SKILL, 'assets/svg');
const PORT = 9224;

function arg(n, d) {
  const i = process.argv.indexOf('--' + n);
  return i > -1 ? process.argv[i + 1] : d;
}
// 🔴 布尔开关一律走 `has()`，别用 `arg(...) === undefined` 判（2026-08-25 实测立）。
//   `arg` 返回的是 `argv[i+1]` —— 开关写在命令**末尾**时那就是 `undefined`，
//   跟「压根没传」完全同形。于是 `--no-interactions` 静默失效：
//   日志照打「注入交互层」，SERP 的筛选/chip 交互被注进了 PDP 底座（实测污染 8 处选择器）。
//   这类 bug 不报错、不改变退出码，只能靠读日志跟自己的意图对不上才发现。
function has(n) { return process.argv.includes('--' + n); }
const URL_ = arg('url');
const NAME = arg('name', 'page');
const OUT = arg('out');
const WIDTH = parseInt(arg('width', '1440'), 10);
if (!URL_ || !OUT) { console.log('ERR 需要 --url 和 --out'); process.exit(1); }

const ASSETS = path.join(OUT, NAME + '-assets');
fs.mkdirSync(ASSETS, { recursive: true });

// ── 下载（带并发闸 + 重试；MIC 有 WAF，别猛刷）────────────────────────────
// 🔴🔴 每个请求必须有**绝对**时限，别只靠 `timeout` 选项（2026-08-25 PDP 克隆挂死立）。
//   `http.get` 的 `timeout` 量的是 **socket 空闲**：响应一旦开始有数据流动就永远不再触发。
//   而 `res` 流上原本没有任何 error / aborted 处理 —— WAF 中途掐断连接、或响应是 chunked
//   但不发结束块时，`res.on('end')` 永不触发，这个 Promise 既不 resolve 也不 reject，
//   整个 `pool` 跟着停住。
//   🔴 **它的表现极具欺骗性**：进程活着、CPU 0%、零报错、目录里文件不再增加 ——
//   看起来像「页面太大所以慢」。判「卡了还是慢了」只有一个可靠判据：**产出量在不在长**
//   （实测卡死点：PDP 的 216 个 CSS 资源下到 173 个就再不动，等 10 分钟也一样）。
//   SERP 那次没触发纯属运气，不是这份代码当时是对的。
//   🔴🔴 光有单次硬超时**不够**：重定向那一支是 `fin(fetchBuf(下一跳))` ——
//   它把外层 Promise resolve 成**另一个 Promise**，`done` 当场置 true、硬超时随即失效。
//   于是只要重定向链上任何一跳卡住（或几跳互相绕回一个已在 cache 里、正等着自己的 URL
//   ＝**重定向环死锁**），整条链就一起永久挂起，单次超时一点忙都帮不上。
//   所以真正兜底的是下面两条：**整条链的绝对时限 `CHAIN_MS`** ＋ **跳数上限 `MAX_HOP`**。
const HARD_MS = 20000;                 // 单次请求绝对上限，到点必销毁 socket
const CHAIN_MS = 45000;                // 含重定向链的绝对上限，到点无条件放弃
const MAX_HOP = 5;                     // 重定向跳数上限，防环
const HARD = Symbol('hard-timeout');   // 硬超时不再重试（重试大概率还是卡）
const cache = new Map();
const inflight = new Map();            // 诊断：谁还没回来。卡住时点名，别再靠 lsof 猜
function fetchBuf(u, tries = 2, hop = 0) {
  if (u.startsWith('//')) u = 'https:' + u;
  if (cache.has(u)) return cache.get(u);
  if (hop > MAX_HOP) return Promise.resolve(null);
  let chainTimer;
  const p = Promise.race([
    fetchChain(u, tries, hop),
    new Promise(res => { chainTimer = setTimeout(() => res(null), CHAIN_MS); }),
  ]).then(r => { clearTimeout(chainTimer); inflight.delete(u); return r; });
  inflight.set(u, Date.now());
  cache.set(u, p);
  return p;
}
function fetchChain(u, tries, hop) {
  const p = new Promise((resolve) => {
    let done = false;
    const fin = v => { if (!done) { done = true; clearTimeout(hard); resolve(v); } };
    const lib = u.startsWith('https') ? https : http;
    const req = lib.get(u, {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Referer': URL_,
        'Accept': '*/*',
      },
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return fin(fetchBuf(new URL(res.headers.location, u).href, tries, hop + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return fin(null); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => fin({ buf: Buffer.concat(chunks), ct: res.headers['content-type'] || '' }));
      res.on('error', () => fin(null));      // ← 原来没有：响应流出错就永久挂起
      res.on('aborted', () => fin(null));    // ← 原来没有：连接被掐断就永久挂起
    });
    // 到点强制收摊。放在最后声明没关系 —— 回调必然晚于本轮同步代码执行。
    const hard = setTimeout(() => { try { req.destroy(); } catch (e) {} fin(HARD); }, HARD_MS);
    req.on('timeout', () => { req.destroy(); fin(null); });
    req.on('error', () => fin(null));
  }).then(r => {
    if (r === HARD) return null;           // 硬超时：直接判失败，不重试
    // 🔴🔴 重试只能调 `fetchChain`，**绝不能调 `fetchBuf`**（2026-08-25 真凶就是这一行）。
    //   `fetchBuf` 第一件事是查 cache，而本 URL 的 Promise 早已写进 cache ——
    //   于是「重试」拿回来的是**它自己**，成了 p 等 p 的自锁。
    //   后果：**只要任何一个资源第一次没拿到（非 200 / 网络错都算），800ms 后就永久卡死**，
    //   没有报错、没有堆栈、CPU 0%，整个克隆停在半路。这比重定向环常见得多。
    return r || tries <= 1 ? r : new Promise(res => setTimeout(() => res(fetchChain(u, tries - 1, hop)), 800));
  });
  // 🔴 这里**不能**再 `cache.set(u, p)` —— cache 由 fetchBuf 统一写，
  //   在这儿覆盖会把外层那个带 CHAIN_MS 兜底的 Promise 换成裸的，兜底当场失效。
  return p;
}

// 卡住时**点名**，别再靠 `lsof`/CPU 反推（那次为定位一个挂起的下载，从外部猜了三轮）。
// 只报告不干预：真正兜底的是 CHAIN_MS，这里纯粹是让「慢」和「卡」在日志里长得不一样。
const watchdog = setInterval(() => {
  const now = Date.now();
  const slow = [...inflight.entries()].filter(([, t]) => now - t > 25000);
  if (!slow.length) return;
  const oldest = Math.round((now - Math.min(...slow.map(s => s[1]))) / 1000);
  console.log(`  ⏳ ${slow.length} 个请求未返回（最久 ${oldest}s）：${slow.slice(0, 3).map(s => s[0].slice(-70)).join('  ')}`);
}, 30000);
if (watchdog.unref) watchdog.unref();   // 别让这个计时器拖住进程退出

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg', 'font/woff2': '.woff2', 'application/font-woff2': '.woff2', 'font/woff': '.woff', 'image/x-icon': '.ico', 'image/vnd.microsoft.icon': '.ico' };
const used = new Set();
function saveAsset(u, r) {
  let base = path.basename(new URL(u.startsWith('//') ? 'https:' + u : u).pathname).split('?')[0] || 'a';
  if (!path.extname(base)) base += (EXT[r.ct.split(';')[0].trim()] || '.bin');
  let f = base, k = 1;
  while (used.has(f)) { const e = path.extname(base); f = base.slice(0, -e.length) + '_' + (k++) + e; }
  used.add(f);
  fs.writeFileSync(path.join(ASSETS, f), r.buf);
  return f;
}

// ── 飞鹊图标：微 CSS 图标名 → 飞鹊 SVG ───────────────────────────────────
// 27 个一级行业逐个对到飞鹊 ind-*（不是「近似顶」，飞鹊本来就有这套）
const IND_BY_NAME = {
  'Agriculture & Food': 'ind-agriculture', 'Apparel & Accessories': 'ind-apprel',
  'Arts & Crafts': 'ind-artcraft', 'Auto, Motorcycle Parts & Accessories': 'ind-auto',
  'Bags, Cases & Boxes': 'ind-bag', 'Chemicals': 'ind-chemical',
  'Computer Products': 'ind-computer', 'Construction & Decoration': 'ind-construction',
  'Consumer Electronics': 'ind-consumer-electronics', 'Electrical & Electronics': 'ind-electrical',
  'Furniture': 'ind-furniture', 'Health & Medicine': 'ind-health',
  'Industrial Equipment & Components': 'ind-industrail-equipment', 'Instruments & Meters': 'ind-instrument',
  'Light Industry & Daily Use': 'ind-lightIndusty', 'Lights & Lighting': 'ind-light',
  'Manufacturing & Processing Machinery': 'ind-manufacture', 'Metallurgy, Mineral & Energy': 'ind-metallurgy',
  'Office Supplies': 'ind-office-supplies', 'Packaging & Printing': 'ind-packaging',
  'Security & Protection': 'ind-security', 'Service': 'ind-service',
  'Sporting Goods & Recreation': 'ind-sporting', 'Textile': 'ind-textile',
  'Tools & Hardware': 'ind-tool', 'Toys': 'ind-toy', 'Transportation': 'ind-transportation',
};
// 同名对不上、但语义唯一的手工桥（每条都写了理由，别默默加）
// 🔴 同名匹配会选错。飞鹊库里 `right`/`left` 的图形只占 16×16 框的 0.25×0.42（很小的一枚 ›），
// 而飞鹊 Figma 里做轮播/翻页用的那个是 `right-big`/`left-big`（0.45×0.83，竖向撑满）。
// 按名字匹配会拿到小的那个，然后靠 viewBox 放大 1.29x 去凑线上尺寸 ——
// **那是在用几何拉伸补救一个选错的图标**，代价是笔画变粗、不像飞鹊的设计。
// 判据：拿不准就把候选逐个 getBBox 量占框比例，跟目标字形的墨迹比例对，别只看名字。
const MANUAL = {
  'icon-twitter': 'X',            // 推特已改名 X，飞鹊库跟的是新名
  'icon-instagram': 'instagrame', // 飞鹊库拼成 instagrame
  'icon-right': 'right-big',      // 见上：轮播/翻页箭头是 big 那版
  'icon-left': 'left-big',
  'icon-right-red': 'right-big',  // 同一个箭头，红色由 CSS 的 color 给
  'icon-new': 'ad',
  'icon-new-loader': 'Loading',
  // 🔴 线上这两个是**实心**图标，同名匹配会默认选到描边版（飞鹊 `-f` 后缀＝filled）。
  //   2026-08-25 用户一眼看出来的：页脚 App Store 的苹果标线上是实心白，克隆成了描边轮廓。
  //   判据同坑 16 —— 名字对不代表图形对，成对存在 `x` / `x-f` 的都要确认线上是哪一版。
  'icon-apple': 'apple-f',
  'icon-android': 'android-f',
  // 页头账号图标：两边的 `-f` 后缀都表示实心，名字逐段对得上（i-personal-f → personal-f）
  'icon-i-personal-f': 'personal-f',
};

function loadSvg(name) {
  const f = path.join(SVG_DIR, name + '.svg');
  if (!fs.existsSync(f)) return null;
  let s = fs.readFileSync(f, 'utf8');
  const vb = (s.match(/viewBox="([^"]+)"/) || [])[1] || '0 0 16 16';
  let inner = s.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  // 写死的色换成 currentColor —— 这样图标的尺寸(1em)和颜色(color)完全由线上 CSS 决定 = 真 1:1
  inner = inner.replace(/fill="#[0-9A-Fa-f]{3,8}"/g, 'fill="currentColor"')
               .replace(/stroke="#[0-9A-Fa-f]{3,8}"/g, 'stroke="currentColor"');
  return { vb, inner };
}

(async () => {
  const report = { url: URL_, name: NAME, width: WIDTH, generated: null, stripped: {}, icons: {}, assets: {} };

  const b = await puppeteer.connect({ browserURL: 'http://localhost:' + PORT, defaultViewport: null });

  // ── 登录态（可选）──────────────────────────────────────────────────────
  // 询盘页 / VO 后台这类页面不登录看不到真内容；WAF 对匿名访问也更容易限流。
  // 格式同 reach.js：{ cookies:[{name,value,domain,path,httpOnly,secure}] }
  // 🔴 state 文件是凭据，只放 ~/.online-reach-state/（600），永远不要进仓。
  const STATE = arg('state');
  let injectCookies = async () => {};
  if (STATE) {
    const ck = (JSON.parse(fs.readFileSync(STATE, 'utf8')).cookies || [])
      .map(c => ({ name: c.name, value: c.value, domain: c.domain, path: c.path || '/', httpOnly: !!c.httpOnly, secure: !!c.secure }));
    if (ck.length) {
      injectCookies = async (pg) => { await pg.setCookie(...ck); };
      console.log(`→ 注入登录态 ${ck.length} 条 cookie`);
    }
  }

  const p = await b.newPage();
  await injectCookies(p);
  await p.setViewport({ width: WIDTH, height: 1000 });
  console.log('→ 打开', URL_);
  await p.goto(URL_, { waitUntil: 'networkidle2', timeout: 120000 });
  await new Promise(r => setTimeout(r, 3000));

  // ── 落地页体检：拿错页面就当场停，别克隆一个垃圾页 ────────────────────────
  // 🔴 WAF 限流时 MIC 返回的是一个 200 的「兜底页」，标题是 The information is not
  //    available right now，结构完整、不报错 —— 照着克隆会得到一个「看起来正常」的空壳。
  //    2026-08-25 实测：连着抓几页之后必现，只能等冷却。
  const landing = await p.evaluate(() => ({
    title: document.title,
    signIn: /(^|\s)(Sign In|Join Free)(\s|$)/i.test((document.querySelector('.nav-user,.head-user,header,.nail-header') || document.body).innerText || ''),
    user: (document.querySelector('.user-name,.nail-user-name,[class*="user-name"]') || {}).innerText || ''
  }));
  if (/not available right now|Access Denied|Forbidden/i.test(landing.title)) {
    console.error(`\n❌ 拿到的是 WAF 兜底页（标题：${landing.title}）。这不是目标页面。`);
    console.error(`   MIC 在连续抓取后会限流。等几分钟再跑，别连刷（一次一个页）。`);
    await p.close(); await b.disconnect(); process.exit(3);
  }
  if (STATE) {
    if (landing.signIn && !landing.user.trim()) {
      console.error(`\n❌ 传了 --state 但页面顶部仍是 Sign In —— 登录态没生效（cookie 过期或域不匹配）。`);
      console.error(`   继续克隆只会得到未登录版页面。先重新导出 cookie 再跑。`);
      await p.close(); await b.disconnect(); process.exit(4);
    }
    console.log(`   登录态生效${landing.user.trim() ? '（当前用户：' + landing.user.trim().slice(0, 30) + '）' : ''}`);
  }

  // ── 抓之前先点一下（可选）──────────────────────────────────────────────
  // 有些视图切不出 URL：SERP 的列表/Gallery 切换是 <a href="javascript:;">，
  // 靠 JS 换视图，地址栏一个字都不变 —— 只能在线上真点一下再抓
  // （同 --filter-states 的道理：不构造 URL，让页面自己走它真实的那条路）。
  const CLICK = arg('click');
  if (CLICK) {
    const nav = p.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).then(() => true).catch(() => false);
    const hit = await p.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      el.click();
      return (el.className || '') + '|' + (el.innerText || '').trim().slice(0, 20);
    }, CLICK);
    if (hit === null) {
      console.error(`\n❌ --click 的选择器在线上找不到：${CLICK}`);
      await p.close(); await b.disconnect(); process.exit(5);
    }
    const navigated = await nav;
    await new Promise(r => setTimeout(r, 4000));
    console.log(`→ 已点击 ${CLICK}（${navigated ? '触发了整页跳转' : '页内切换'}）`);
    // 点完可能撞上兜底页，再体检一次
    const t2 = await p.title();
    if (/not available right now|Access Denied|Forbidden/i.test(t2)) {
      console.error(`\n❌ 点击后拿到 WAF 兜底页（${t2}）。等冷却再跑。`);
      await p.close(); await b.disconnect(); process.exit(3);
    }
  }

  // 滚到底触发懒加载，再滚回顶（不滚的话 179 张 data-original 全是占位）
  console.log('→ 滚动触发懒加载');
  await p.evaluate(async () => {
    const H = document.body.scrollHeight;
    for (let y = 0; y < H; y += 700) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 150)); }
    window.scrollTo(0, 0);
  });
  await new Promise(r => setTimeout(r, 4000));

  // ── 页内清理：这一步决定「剥掉了什么」，报告里要如实交代 ──────────────
  console.log('→ 页内清理 + 标记图标');
  const inpage = await p.evaluate(() => {
    const st = { scripts: 0, iframes: 0, lazyResolved: 0, noscript: 0, baseTags: 0, resHints: 0 };

    // 🔴 必须先干掉 <base>。MIC 页头写着 <base href="//www.made-in-china.com">，
    // 它会把 src="serp-assets/x.png" 解析成 file://www.made-in-china.com/serp-assets/x.png
    // → net::ERR_INVALID_URL，表现是「图全断」，但文件其实好好躺在本地。
    // （2026-08-25 实测：481/483 图片文件都在，全断的唯一原因就是这一个标签。）
    document.querySelectorAll('base').forEach(b => { b.remove(); st.baseTags++; });

    // 懒加载图落实成真 src（否则离线打开一片空）
    document.querySelectorAll('img[data-original]').forEach(im => {
      const d = im.getAttribute('data-original');
      if (d && (!im.getAttribute('src') || /blank|placeholder|data:image\/gif/.test(im.getAttribute('src') || ''))) {
        im.setAttribute('src', d); st.lazyResolved++;
      }
    });
    // 背景图懒加载
    document.querySelectorAll('[data-bg],[data-background]').forEach(el => {
      const d = el.getAttribute('data-bg') || el.getAttribute('data-background');
      if (d) el.style.backgroundImage = `url(${d})`;
    });

    // 🔴 表单状态要写回属性再序列化。outerHTML 只带 value/checked/selected 这几个**属性**，
    // 不带 JS 设进去的 property —— MIC 搜索框的关键词就是 JS 填的，
    // 不写回的话克隆里显示的是 HTML 里那个默认值（实测是 "hunt"），一眼假。
    document.querySelectorAll('input').forEach(el => {
      if (el.type === 'checkbox' || el.type === 'radio') {
        if (el.checked) el.setAttribute('checked', ''); else el.removeAttribute('checked');
      } else if (el.type !== 'password') {
        el.setAttribute('value', el.value);
      }
    });
    document.querySelectorAll('textarea').forEach(el => { el.textContent = el.value; });
    document.querySelectorAll('option').forEach(el => {
      if (el.selected) el.setAttribute('selected', ''); else el.removeAttribute('selected');
    });

    // 剥脚本：埋点 / 广告 / TM / 客服 —— 它们跟视觉和交互动效无关，
    // 留着会往外发请求、离线报错、甚至弹真的客服窗
    document.querySelectorAll('script').forEach(s => { s.remove(); st.scripts++; });
    document.querySelectorAll('noscript').forEach(s => { s.remove(); st.noscript++; });
    document.querySelectorAll('iframe').forEach(f => { f.remove(); st.iframes++; });
    // 🔴 资源提示类 <link> 也要剥（2026-08-25 PDP 立）：它们不渲染任何东西，**却照样发真实请求**。
    //   实测剥掉 92 个 <script> 之后，PDP 仍有 2 个 async 模块 JS 从
    //   `<link rel="modulepreload">` 出网；`<link rel="preload" as="font">` 又拖了一个 woff2；
    //   而 `<link rel="dns-prefetch" href="//host">` 在 file:// 下被解析成 `file://host`
    //   → console 报 `ERR_INVALID_URL`（同「<base href> 劫持相对路径」那一族）。
    //   🔴 SERP 上没有这些标签，所以这个洞一直到换页型才暴露 ——
    //   **换页型就要重跑一遍脱网门，别拿上一个页型的「全绿」当结论。**
    document.querySelectorAll(
      'link[rel~="preload"],link[rel~="modulepreload"],link[rel~="prefetch"],link[rel~="dns-prefetch"],link[rel~="preconnect"]'
    ).forEach(l => { l.remove(); st.resHints++; });

    // 字体图标：打标记，交给 node 端换飞鹊 SVG
    // 顺手记下每个图标类的**字形码点 + 字体族**，后面要拿它量「字形在 em 框里占多大」。
    // 🔴 必须在这儿取：micon 字体只有在线上这个页面里才是加载好的，克隆完就没了。
    const glyphCp = {};
    const iconClasses = {};
    // 🔴🔴 字体图标有**两种写法**，老逻辑只认第一种（2026-08-25 页脚图标全空立）：
    //   ① 有语义类名 + `::before` 给字符 —— `<i class="ob-icon icon-search">`，老逻辑认这种
    //   ② **没有语义类名，图标字符直接写在元素文本里** —— `<i class="ob-icon svelte-jurczo"></i>`
    //      里塞一个私有区字符（如 U+E056）。实测一个 PDP 上有 8 个、其中 5 个可见：
    //      页脚 App Store / Google Play / Trade Messenger ＋ 发消息 ＋ 侧边搜索。
    //   第二种整批漏掉 → 又因为克隆会删掉 micon 字体（图标已换飞鹊 SVG）→ **渲染成空白**。
    //   🔴 反查办法：全站 CSS 里 `.icon-apple:before{content:"<同一个字符>"}` 就是它的语义名
    //      （实测 U+E056→icon-apple、U+E00E→icon-tm，280 个码点都反查得到）。
    //      **别按位置或按 title 猜名字。**
    //   🔴🔴 但**反查必须放在 node 端做，不能在页内做** —— 页内那版我写过、不生效，两个原因：
    //      ① MIC 的 CSS 来自 micstatic.com，**跨域** → `ss.cssRules` 直接抛 SecurityError；
    //      ② 就算读得到，浏览器 `cssText` 会把私有区字符转义成 `\e056` 六个字符，单字符正则也匹配不上。
    //      node 端拿的是**下载好的 CSS 原文**，两个问题都不存在。
    //      所以页内只给一个临时名 `pua-<hex>`（墨迹量测只要码点+字体族，不需要真名），
    //      等 CSS 下完在 node 端改回 `icon-xxx`。
    const puaChar = s => {
      const t = (s || '').trim();
      if (Array.from(t).length !== 1) return '';
      const n = t.codePointAt(0);
      return (n >= 0xE000 && n <= 0xF8FF) ? t : '';
    };
    // 🔴 选择器**只保留这三类，别扩成 `i[class*="icon"]`**（2026-08-25 扩过一次，当场回归）：
    //   扩了之后把 `st-icon` 这类本来不该动的图标也换成了飞鹊 SVG ——
    //   产品图右上角的收藏/分享按钮，线上是小图标居中，换完撑满整个圆圈还带重影。
    //   页脚那三个漏掉**跟选择器无关**（它们本来就是 ob-icon），是因为没有 `icon-` 类名，
    //   由下面那条码点反查修掉。**改 A 的时候顺手动 B，就是这么把回归引进来的。**
    document.querySelectorAll('i.ob-icon, i.micon, i.ft-icon').forEach(el => {
      if (el.children.length) return;
      let n = Array.from(el.classList).find(c => /^icon-/.test(c) && !/^icon-(right-red)$/.test(c))
             || Array.from(el.classList).find(c => /^icon-/.test(c));
      const pua = puaChar(el.textContent);
      if (!n && pua) n = 'pua-' + pua.codePointAt(0).toString(16);   // ← 写法②：临时名，node 端改回真名
      if (!n) return;
      iconClasses[n] = (iconClasses[n] || 0) + 1;
      if (!glyphCp[n]) {
        const c = getComputedStyle(el, '::before').content || '';
        const ch = c.replace(/^["']|["']$/g, '');
        if (ch && ch !== 'none') glyphCp[n] = { cp: ch.codePointAt(0), ff: getComputedStyle(el).fontFamily };
        else if (pua) glyphCp[n] = { cp: pua.codePointAt(0), ff: getComputedStyle(el).fontFamily };
      }
      el.setAttribute('data-fq-icon', n);
      // 🔴 有些图标 `<i>` 的**基础规则会丢**（2026-08-25 页脚图标压字上立）：
      //   实测线上 `.m-app-store i` 是 `inline-block / 16px`，克隆后变成 `inline / 14px`。
      //   **`inline` 元素的 `width` 属性无效** → 我们注入的 `width:1em !important` 被忽略
      //   → 盒子塌成 0 宽 → 绝对定位的 SVG 直接压在文字上（图标和文字重叠）。
      //   规则怎么丢的没查到（12 份 CSS 全下载成功、里面确实没有这条），
      //   所以这里**把线上量到的 display 固化下来**。
      //   🔴 判据不能写成「克隆后塌了才补」—— 线上 CSS 是完整的，页内量到的永远是 inline-block，
      //   那个条件一次都不会成立（我第一版就这么写错的）。塌陷发生在克隆之后，页内量不到。
      //   🔴 只固化 display、**不固化 font-size**：图标尺寸是 `width:1em`，把字号焊成内联样式
      //   会盖掉响应式断点里的字号变化，为修一个 2px 偏差赔掉整条响应式，不划算。
      //   线上 inline 的那些也一律给 inline-block —— 字体图标靠字形自带宽度，换成绝对定位的 SVG 后
      //   必须有个成立的盒子（坑 5 禁的是改成 flex/inline-flex，那才会脱离行内流）。
      //   🔴🔴 **高度也要固化，而且这才是图标错位的真凶**（2026-08-25 第二轮）：
      //   `::before{content:"\200B"}` 那条撑高度的规则**实测没生效**（computed content 是 none），
      //   于是 `<i>` 高度塌成 0，绝对定位的 svg 在一个 0 高的盒子里居中，位置必然错。
      //   固化线上真实高度比写 `height:1em` 准得多 —— 轮播箭头线上是 22×40（line-height 给的），
      //   `1em` 会把它压成 22×22（坑 11）。量到多少写多少，不做假设。
      const csI = getComputedStyle(el);
      const rI = el.getBoundingClientRect();
      el.style.display = (csI.display === 'inline') ? 'inline-block' : csI.display;
      if (rI.height > 0) el.style.height = rI.height + 'px';
      // 品类图标要靠旁边的行业名去认领对应的飞鹊 ind-*
      const label = el.parentElement && el.parentElement.querySelector('.m-cate-name');
      if (label) el.setAttribute('data-fq-label', label.textContent.trim());
      el.textContent = '';
    });

    // 收集 CSS 链接（node 端下载，绕开 CORS）
    const css = Array.from(document.querySelectorAll('link[rel=stylesheet]')).map(l => l.href);
    document.querySelectorAll('link[rel=stylesheet]').forEach(l => l.setAttribute('data-fq-css', l.href));

    return { st, iconClasses, css, title: document.title, glyphCp };
  });
  report.stripped = inpage.st;
  console.log(`  剥 script ${inpage.st.scripts} / iframe ${inpage.st.iframes} / 资源提示link ${inpage.st.resHints} / 懒加载落实 ${inpage.st.lazyResolved}`);

  // ── 量「字形在 em 框里占多大」（趁 micon 字体还在这一页里加载着）─────────
  // 为什么要这一步：`width:1em` 只让**盒子**跟线上一样大，不保证**图形**一样大。
  // 飞鹊 SVG 的 16×16 viewBox 通常留了内边距（search 的图形只占 12×12＝0.75），
  // 而 micon 字形基本填满 em 框 —— 直接换上去，图标会整体偏小。
  // 🔴 实测（2026-08-25 SERP）：13 个可量图标里 11 个偏小，**面积比中位 0.71**，搜索图标只有 0.55。
  // 而且每个图标的内边距还不一样（0.56~0.88 都有），统一缩放治不了，只能逐个量。
  console.log('→ 量 micon 字形墨迹占比');
  const glyphInk = await p.evaluate(async (cps) => {
    await document.fonts.ready;
    // 🔴 画布必须留足余量。第一版把基线放在 y=S、画布也只有 S 高，
    // 字形落在基线**以下**的部分（图标字体普遍有下伸）直接被裁掉 → 量到的高度偏小
    // → 校正据此把飞鹊图标过度缩小。指纹：箭头类图标肉眼明显比线上小一圈。
    // 现在画布 2S、基线放在 1.5S、左边留 0.5S，四周都不会碰边。
    const S = 300, W = S * 2, ctx = (() => {
      const cv = document.createElement('canvas'); cv.width = cv.height = W;
      return cv.getContext('2d', { willReadFrequently: true });
    })();
    const out = {};
    for (const [name, o] of Object.entries(cps)) {
      ctx.clearRect(0, 0, W, W); ctx.fillStyle = '#000'; ctx.textBaseline = 'alphabetic';
      ctx.font = `${S}px ${o.ff}`;
      ctx.fillText(String.fromCodePoint(o.cp), S * 0.5, S * 1.5);
      const d = ctx.getImageData(0, 0, W, W).data;
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (let y = 0; y < W; y++) for (let x = 0; x < W; x++)
        if (d[(y * W + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 < 0) continue;
      // 碰到画布边＝被裁了，宁可不给结论也别给个偏小的数
      if (x0 <= 0 || y0 <= 0 || x1 >= W - 1 || y1 >= W - 1) { out[name] = null; continue; }
      out[name] = { w: (x1 - x0 + 1) / S, h: (y1 - y0 + 1) / S };
    }
    return out;
  }, inpage.glyphCp);
  console.log(`  量到 ${Object.keys(glyphInk).length} / ${Object.keys(inpage.glyphCp).length} 个字形`);

  let html = await p.content();
  // 🔴 页面 p 先别关 —— 图片下载那步要拿它做「浏览器兜底」（node 下不下来的登录态/一次性图，
  //    从它的 canvas 里取）。原来在这里就 close，兜底会撞 detached Frame。
  //    浏览器整体也先别断 —— 后面还要用 getBBox() 量飞鹊 SVG 的图形包围盒。

  // ── 抓真实的筛选结果页（可选）──────────────────────────────────────────
  // 静态克隆点筛选时，列表本该跟着变，但服务端筛选拿不到。
  // 与其按卡片正文瞎猜（实测 117 个筛选项只有 3 个能匹配，且全是子串误撞），
  // 不如把线上**真实的**筛选结果页一起抓下来 —— 点的时候换上真数据。
  // 🔴 不构造 URL，直接在线上页面里点那个筛选项让它自己跳转，保证跟真实行为一致。
  // 代价：每个状态 +1 次线上加载、+约 30 张新产品图（单文件会明显变大），所以默认不抓、要哪些自己点名。
  const LIST_SEL = '.prod-list';
  const filterStates = {};
  const wantStates = (arg('filter-states') || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const spec of wantStates) {
    const parts = spec.split('+').map(s => s.trim()).filter(Boolean);
    const fp = await b.newPage();
    await injectCookies(fp);
    await fp.setViewport({ width: WIDTH, height: 1000 });
    try {
      await fp.goto(URL_, { waitUntil: 'networkidle2', timeout: 120000 });
      await new Promise(r => setTimeout(r, 3500));
      let ok = true;
      for (const part of parts) {
        const [k, v] = part.split('=');
        const hit = await fp.evaluate((k, v) => {
          const a = document.querySelector(`.J-filter-link[data-key="${k}"][data-value="${v}"]`);
          if (!a) return false; a.click(); return true;
        }, k, v);
        if (!hit) { console.log(`  ⚠️ 筛选项 ${part} 在线上找不到，跳过`); ok = false; break; }
        await fp.waitForNavigation({ waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 3500));   // 对 MIC 的 WAF 客气点
      }
      if (ok) {
        await fp.evaluate(async () => {
          const H = document.body.scrollHeight;
          for (let y = 0; y < H; y += 700) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 130)); }
          window.scrollTo(0, 0);
        });
        await new Promise(r => setTimeout(r, 3000));
        const cap = await fp.evaluate((sel) => {
          document.querySelectorAll('img[data-original]').forEach(im => {
            const d = im.getAttribute('data-original');
            if (d && (!im.getAttribute('src') || /blank|placeholder|data:image\/gif/.test(im.getAttribute('src') || ''))) im.setAttribute('src', d);
          });
          const list = document.querySelector(sel);
          const num = document.querySelector('.list-top .num-found span');
          return list ? { html: list.innerHTML, num: num ? num.innerHTML : '', n: list.querySelectorAll('.list-node').length } : null;
        }, LIST_SEL);
        if (cap) {
          const key = parts.slice().sort().join('&');
          filterStates[key] = cap;
          console.log(`  ✅ ${spec} → ${cap.n} 张卡 · ${(cap.num || '').replace(/<[^>]+>/g, '')}`);
        } else console.log(`  ⚠️ ${spec} 抓不到列表容器 ${LIST_SEL}`);
      }
    } catch (e) { console.log(`  ⚠️ ${spec} 抓取失败: ${e.message}`); }
    await fp.close();
  }
  if (wantStates.length) console.log(`→ 抓到 ${Object.keys(filterStates).length}/${wantStates.length} 个真实筛选结果`);

  // ── CSS：下载 + 内联 + 把 url() 指到本地 ────────────────────────────────
  console.log(`→ 下载 ${inpage.css.length} 份 CSS`);
  const cssTexts = await pool(inpage.css, 6, async u => {
    const r = await fetchBuf(u);
    return r ? { u, txt: r.buf.toString('utf8') } : { u, txt: '', fail: true };
  });
  report.assets.cssFailed = cssTexts.filter(c => c.fail).map(c => c.u);

  // CSS 里的 url() 全部本地化（背景图 / 精灵图 / 字体）
  const cssUrls = new Set();
  cssTexts.forEach(c => {
    (c.txt.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g) || []).forEach(m => {
      const raw = m.replace(/^url\(\s*['"]?/, '').replace(/['"]?\s*\)$/, '');
      if (raw.startsWith('data:') || raw.startsWith('#')) return;
      try { cssUrls.add(new URL(raw, c.u).href); } catch (e) {}
    });
  });
  console.log(`→ 下载 CSS 引用的 ${cssUrls.size} 个资源`);
  const cssMap = {};
  await pool([...cssUrls], 8, async u => {
    // micon 字体不要了（图标已换飞鹊 SVG），省 4 份字体文件
    if (/fontastic|micon_/.test(u)) { cssMap[u] = null; return; }
    const r = await fetchBuf(u);
    if (r) cssMap[u] = saveAsset(u, r);
  });

  let cssAll = cssTexts.map(c => {
    let t = c.txt;
    t = t.replace(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g, (mm, raw) => {
      if (raw.startsWith('data:') || raw.startsWith('#')) return mm;
      let abs; try { abs = new URL(raw, c.u).href; } catch (e) { return mm; }
      const f = cssMap[abs];
      return f ? `url(${NAME}-assets/${f})` : (cssMap[abs] === null ? 'url(about:blank)' : mm);
    });
    return `/* ===== ${c.u} ===== */\n` + t;
  }).join('\n');

  // micon 字体已经不用了（图标全换成飞鹊 SVG）。上一步把它的 url 置成了 about:blank，
  // 但浏览器仍会去取、并抛 CORS 报错 —— demo 的验收标准是零 console 错误，
  // 所以把整条 @font-face 删掉，而不是留个取不到的占位。
  const dropDeadFace = s => s.replace(/@font-face\s*\{[^}]*\}/gi, blk => (/about:blank/.test(blk) ? '' : blk));
  cssAll = dropDeadFace(cssAll);

  // ── 图片：下载 + 指到本地 ───────────────────────────────────────────────
  const imgUrls = new Set();
  // 🔴 HTML 属性里的 URL 是**实体编码过的**：多参数地址写作 `?a=1&amp;b=2`。
  //    直接拿去请求 = 把 `&amp;` 当成参数名的一部分，服务器给不出东西。
  //    实测：询盘页的验证码图 `/olympus/captcha?action=image&amp;k=…&amp;c=…` 就这么断的
  //    （表现是一个破图 + 一条 ERR_INVALID_URL，而其它页恰好都是无参数的 CDN 路径所以从没暴露）。
  //    🔴 收集和改写必须共用这一个函数 —— 一边解码一边不解码，imgMap 的 key 就对不上，
  //    图明明下下来了却还是断的。
  const deEnt = (s) => String(s).replace(/&amp;/g, '&').replace(/&#3[89];/g, m => m === '&#38;' ? '&' : "'")
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  // 抓来的筛选结果页里是另一批产品图，也要一起下 —— 漏了它们，点筛选会看到一片断图
  const scan = html + Object.values(filterStates).map(s => s.html).join('\n');
  (scan.match(/src="([^"]+)"/g) || []).forEach(m => {
    const raw = deEnt(m.slice(5, -1));
    if (raw.startsWith('data:') || !raw.trim()) return;
    try { imgUrls.add(new URL(raw, URL_).href); } catch (e) {}
  });
  // 🔴 HTML 里自带的内联 <style> 块和 style="" 属性也有 url()，别只改写外链 CSS。
  // （2026-08-25 实测：MIC logo 就丢在这儿 —— .logo-link 的背景图写在页面内联 style 里，
  //  共 32 个 url(//…) 全部漏改写，表现是 file://www.micstatic.com/... ERR_INVALID_URL。）
  const inlineUrlRe = /url\(\s*(?:&quot;|['"])?([^)'"&]+)(?:&quot;|['"])?\s*\)/g;
  [...scan.matchAll(inlineUrlRe)].forEach(m => {
    const raw = m[1].trim();
    if (raw.startsWith('data:') || raw.startsWith('#') || raw.startsWith(NAME + '-assets/') || raw === 'about:blank') return;
    try { imgUrls.add(new URL(raw, URL_).href); } catch (e) {}
  });
  console.log(`→ 下载 ${imgUrls.size} 张图`);
  const imgMap = {};
  let okImg = 0, failImg = [];
  await pool([...imgUrls], 8, async u => {
    const r = await fetchBuf(u);
    if (r && r.buf.length > 0) { imgMap[u] = saveAsset(u, r); okImg++; }
    else failImg.push(u);
  });
  // ── 浏览器兜底：node 下不下来、但浏览器已经画出来的图，直接从 canvas 取 ──────
  // 🔴 为什么需要这一步：图片下载走的是 node 的 fetchBuf，**不经过浏览器、也就没有登录
  //    cookie 和 session**。登录态页面上有一类图是「一次性 + 绑 session」的
  //    （实测：询盘页的验证码 /olympus/captcha，URL 里的 c= 每次加载都不一样），
  //    node 再去请求要么 403 要么拿到另一张，怎么修下载器都没用。
  //    但那张图此刻就在浏览器里好好显示着 —— 同域，canvas 读得出来。
  //    这才是真的 1:1：保留的是**用户当时真看到的那一张**。
  if (failImg.length) {
    const failSet = failImg.slice();
    const rescued = await p.evaluate((urls) => {
      const want = new Set(urls);
      const out = {};
      for (const im of document.querySelectorAll('img')) {
        if (!im.complete || !im.naturalWidth) continue;
        if (!want.has(im.src)) continue;
        try {
          const c = document.createElement('canvas');
          c.width = im.naturalWidth; c.height = im.naturalHeight;
          c.getContext('2d').drawImage(im, 0, 0);
          out[im.src] = c.toDataURL('image/png');       // 跨域会在这里抛 SecurityError，跳过即可
        } catch (e) { /* 跨域画布，取不了就算了 */ }
      }
      return out;
    }, failSet);
    let n = 0;
    for (const [u, uri] of Object.entries(rescued)) {
      const b64 = uri.split(',')[1]; if (!b64) continue;
      imgMap[u] = saveAsset(u.replace(/\?.*$/, '') + '.png', { buf: Buffer.from(b64, 'base64'), ct: 'image/png' });
      okImg++; failImg = failImg.filter(x => x !== u); n++;
    }
    if (n) console.log(`  浏览器兜底救回 ${n} 张（node 取不到但页面上真显示着的，多为登录态/一次性图）`);
  }
  await p.close();   // 兜底用完才关（浏览器仍留着，后面量 SVG 包围盒要用）
  report.assets.images = { total: imgUrls.size, ok: okImg, failed: failImg.slice(0, 30), failedCount: failImg.length };
  console.log(`  成功 ${okImg} / 失败 ${failImg.length}`);

  const localizeImgs = (s) => s.replace(/src="([^"]+)"/g, (mm, raw0) => {
    const raw = deEnt(raw0);                      // 必须跟收集时同一套解码，否则 key 对不上
    if (raw.startsWith('data:') || !raw.trim()) return mm;
    let abs; try { abs = new URL(raw, URL_).href; } catch (e) { return mm; }
    return imgMap[abs] ? `src="${NAME}-assets/${imgMap[abs]}"` : mm;
  });
  html = localizeImgs(html);
  for (const k of Object.keys(filterStates)) filterStates[k].html = localizeImgs(filterStates[k].html);
  // 内联 style 块 / style 属性里的 url() 一并改写（引号形态有 " ' &quot; 和裸写四种）
  html = html.replace(inlineUrlRe, (mm, raw) => {
    raw = raw.trim();
    if (raw.startsWith('data:') || raw.startsWith('#') || raw.startsWith(NAME + '-assets/') || raw === 'about:blank') return mm;
    let abs; try { abs = new URL(raw, URL_).href; } catch (e) { return mm; }
    return imgMap[abs] ? `url(${NAME}-assets/${imgMap[abs]})` : mm;
  });

  // ── 图标：换成飞鹊 SVG symbol sprite ────────────────────────────────────
  // 🔴 把页内给的临时名 `pua-<hex>` 换回真正的语义名（为什么要在这儿做，见页内那段注释）。
  //   反查源 = 刚下载好的 **CSS 原文**：`.icon-apple:before{content:"<那个字符>"}`。
  //   两种写法都要认：直接写字符 / 写 `\e056` 转义 —— 同一份 CSS 里两种混着出现。
  const cpToClass = {};
  {
    const re = /\.(icon-[\w-]+)(?:\s*::?before)?\s*\{[^}]*?content\s*:\s*["']([\s\S]{1,8}?)["']/g;
    let m;
    while ((m = re.exec(cssAll))) {
      let v = m[2];
      const esc = v.match(/^\\([0-9a-fA-F]{4,6})$/);
      if (esc) v = String.fromCodePoint(parseInt(esc[1], 16));
      if (Array.from(v).length !== 1) continue;
      const cp = v.codePointAt(0);
      if (cp < 0xE000 || cp > 0xF8FF) continue;
      const key = 'pua-' + cp.toString(16);
      if (!cpToClass[key]) cpToClass[key] = m[1];
    }
  }
  let renamed = 0, puaUnknown = [];
  for (const tmp of Object.keys(inpage.iconClasses)) {
    if (!/^pua-/.test(tmp)) continue;
    const real = cpToClass[tmp];
    if (!real) { puaUnknown.push(tmp); continue; }
    html = html.split('data-fq-icon="' + tmp + '"').join('data-fq-icon="' + real + '"');
    inpage.iconClasses[real] = (inpage.iconClasses[real] || 0) + inpage.iconClasses[tmp];
    delete inpage.iconClasses[tmp];
    if (glyphInk[tmp] !== undefined) { glyphInk[real] = glyphInk[tmp]; delete glyphInk[tmp]; }
    renamed++;
  }
  if (renamed || puaUnknown.length) {
    console.log(`  内联码点图标改回真名 ${renamed} 个` + (puaUnknown.length ? ` · ⚠️ ${puaUnknown.length} 个在 CSS 里查不到名字：${puaUnknown.join(' ')}` : ''));
  }

  console.log('→ 图标换飞鹊 SVG');
  const wanted = new Map();   // icon 类名 → 飞鹊 svg 名
  const iconGap = [];
  const svgFiles = new Set(fs.readdirSync(SVG_DIR).map(f => f.replace(/\.svg$/, '')));

  html = html.replace(/<i([^>]*?)data-fq-icon="([^"]+)"([^>]*)>\s*<\/i>/g, (mm, a, name, c) => {
    const labelM = (a + c).match(/data-fq-label="([^"]*)"/);
    let target = null;
    if (labelM && IND_BY_NAME[labelM[1].replace(/&amp;/g, '&')]) target = IND_BY_NAME[labelM[1].replace(/&amp;/g, '&')];
    // 🔴 MANUAL 优先于同名匹配 —— MANUAL 里写的是「量过之后确认对的那个」，
    //    同名只是启发式。顺序反了的话 icon-right 会一直落到小的 right.svg 上。
    if (!target && MANUAL[name] && svgFiles.has(MANUAL[name])) target = MANUAL[name];
    if (!target) { const bare = name.replace(/^icon-/, ''); if (svgFiles.has(bare)) target = bare; }
    if (!target) { iconGap.push(name); return mm; }
    wanted.set(name, target);
    // 🔴 symbol 按 **icon 类名** 建，不按 svg 文件名 —— 同一个 svg 被两个类用时
    //    （如 icon-right / icon-right-red 都用 right.svg），它们要对齐的字形不同、缩放也不同。
    return `<i${a}data-fq-icon="${name}"${c}><svg class="fq-i"><use href="#fq-${name}"/></svg></i>`;
  });
  report.icons = { mapped: Object.fromEntries(wanted), gapCount: iconGap.length, gap: [...new Set(iconGap)] };
  console.log(`  映射 ${wanted.size} 类 / 缺口 ${new Set(iconGap).size}`);

  // ── 按字形墨迹占比校正每个 SVG 的 viewBox ───────────────────────────────
  console.log('→ 按字形墨迹校正图标大小');
  // 🔴 交互层要用、但页面上可能一个都没有的图标，必须显式补进 sprite。
  // （实测：chip 的关闭按钮用 icon-delete，而未筛选的 SERP 上没有任何可见的 icon-delete
  //  → 它没被收进图标表 → chip 里是个空 <i>，浏览器兜底画了个 ✕。）
  const ALWAYS = { 'icon-delete': 'delete', 'icon-close': 'X' };
  for (const [ic, sv] of Object.entries(ALWAYS)) {
    if (!wanted.has(ic) && svgFiles.has(sv)) wanted.set(ic, sv);
  }
  const loaded = {};
  for (const [icon, name] of wanted) { const s = loadSvg(name); if (s) loaded[icon] = { ...s, name }; }

  const pb = await b.newPage();
  await pb.setContent('<body style="margin:0"></body>');
  const inkBox = await pb.evaluate(list => {
    const out = {};
    for (const [icon, o] of Object.entries(list)) {
      const d = document.createElement('div');
      d.innerHTML = `<svg viewBox="${o.vb}">${o.inner}</svg>`;
      document.body.appendChild(d);
      try {
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        d.querySelectorAll('path,circle,rect,ellipse,polygon,line,polyline').forEach(el => {
          if ((el.getAttribute('fill') || '').toLowerCase() === 'none') return;   // 只画描边的不算填充墨迹
          const bb = el.getBBox();
          if (!bb.width && !bb.height) return;
          x0 = Math.min(x0, bb.x); y0 = Math.min(y0, bb.y);
          x1 = Math.max(x1, bb.x + bb.width); y1 = Math.max(y1, bb.y + bb.height);
        });
        if (x1 > -1e9) out[icon] = [x0, y0, x1 - x0, y1 - y0];
      } catch (e) {}
      d.remove();
    }
    return out;
  }, loaded);
  await pb.close(); await b.disconnect();

  let fitted = 0;
  const fitReport = {};
  const symbols = Object.entries(loaded).map(([icon, o]) => {
    let vb = o.vb;
    const g = glyphInk[icon], ink = inkBox[icon];
    if (g && ink && g.w > 0.02 && g.h > 0.02 && ink[2] > 0 && ink[3] > 0) {
      // 目标：图形占新 viewBox 的比例 == 字形占 em 框的比例。
      // 🔴 两轴取**几何平均**（= 按面积匹配），不取 max。
      //    飞鹊图标和 micon 是两套画法，同一个语义的宽高比常常不同（list 飞鹊是方的、micon 是扁的）——
      //    取 max 等于总是迁就受限的那一轴，结果是**系统性偏小**（实测中位 0.89、一个都不会偏大）。
      //    人眼判「一样大」看的是光学面积≈√(w·h)，所以按面积匹配才能让误差居中。
      const box = Math.sqrt((ink[2] / g.w) * (ink[3] / g.h));
      const nx = ink[0] + ink[2] / 2 - box / 2, ny = ink[1] + ink[3] / 2 - box / 2;
      vb = `${+nx.toFixed(3)} ${+ny.toFixed(3)} ${+box.toFixed(3)} ${+box.toFixed(3)}`;
      const old = String(o.vb).split(/\s+/).map(Number)[2] || 16;
      fitReport[icon] = { svg: o.name, scale: +(old / box).toFixed(3) };
      fitted++;
    }
    return `<symbol id="fq-${icon}" viewBox="${vb}">${o.inner}</symbol>`;
  }).join('');
  const scales = Object.values(fitReport).map(f => f.scale).sort((a, b) => a - b);
  report.icons.fit = fitReport;
  console.log(`  校正 ${fitted} 个（缩放 ${scales[0]}x ~ ${scales[scales.length - 1]}x，中位 ${scales[Math.floor(scales.length / 2)]}x）`);

  // ── 字体：什么都不做 ────────────────────────────────────────────────────
  // 🔴 别注入 Roboto，也别加 -webkit-font-smoothing。这两条都是「还原 Figma 稿」的判据，
  // 搬到「还原线上」就变成自己造失真：
  //   · MIC 自己的 fonts.css 有 25 条 Roboto @font-face（全字重 woff2/woff/ttf/eot），
  //     上面的 CSS 本地化已经把字体文件一起下下来了 —— 注入一份别的版本排在最后，反而把真字体覆盖掉。
  //   · 线上用的是 macOS 默认 subpixel-antialiased；强行改 antialiased 会让每个字都比线上细一档，
  //     表现是像素 diff 里「每个字的边缘都在发光」。
  // 目标是跟线上一样，不是跟 Figma 一样 —— 注入层只该管图标这一件事。

  const shell = `
/* ===== live-clone 注入层（只做图标这一件事，线上样式一个字不改）=====
   三条规则都是逐值实测定下来的，改之前先看理由：

   ① ::before 换成零宽空格，不是删掉（content:none）。
      字体图标的 <i> 高度 ＝ 它内部行盒的高度 ＝ line-height。
      整个删掉的话 <i> 里没有行内内容、高度就塌了，只能写死 height 去救；
      而写死 height:1em 又会把 line-height≠font-size 的那类压扁
      （轮播箭头 font-size:22 / line-height:40，线上 <i> 是 22×40，压成 22×22 就不居中了）。
      留一个零宽空格：行盒还在、高度自然等于 line-height、一个像素都不占。

   ② 绝不覆盖 <i> 的 display。线上这些 <i> 是 block / inline-block；
      改成 flex / inline-flex 会让盒子脱离行内流、vertical-align:middle 失效，
      图标整体下沉约 1.35px、页头容器高从 43.3 变 46。

   ③ svg 绝对定位居中，不参与行盒计算。
      试过让它当行内盒（inline-block + vertical-align:middle）—— 行内替换元素会反过来
      把行盒撑高，实测 cart 从 22×22 变成 22×24.3。
      <i> 自己用 width:1em 顶出宽度（原本是字形的 advance width 给的）。 */
   ④ 别在这儿写 vertical-align（2026-08-25 试过，无效且会误导）。
      线上自己就给了 vertical-align:-2px/-3px，选择器是
      .m-footer .m-footer-soft-social .m-footer-app .ob-icon 这种多级的，优先级远高于
      这里的 i.ob-icon —— 实测加了 middle 之后 computed 仍是 -3px，一点没起作用。
      图标错位的真因不是对齐方式，是 <i> 高度塌成 0（下面那条 ::before 实测没生效），
      已改成在页内固化线上量到的真实高度。对齐交给线上 CSS，我们只保证盒子尺寸正确。
      注：这段在 JS 模板字符串里面，写反引号会把模板串提前终止（我刚栽过一次）。 */
i.ob-icon::before,i.micon::before,i.ft-icon::before{content:"\\200B" !important;}
i.ob-icon,i.micon,i.ft-icon{width:1em !important;position:relative;}
svg.fq-i{position:absolute;left:0;top:50%;transform:translateY(-50%);
  width:1em;height:1em;fill:currentColor;display:block;}
`;

  // 页面自带的内联 <style> 里也可能有 micon 的 @font-face，同样删掉
  html = dropDeadFace(html);

  // 🔴🔴 往 HTML 里塞代码一律用 **replacer 函数**，绝不用模板串当替换串。
  // String.replace 的替换串里 `$$` 会被解释成字面 `$`、`$'` 会被换成「匹配之后的全部内容」——
  // 被注入的 CSS/JS 里只要出现这些字符就会被**静默改写**，而且改坏的地方跟报错的地方常常不是一处。
  // 2026-08-25 实测：交互层里的 `var $$ = function(...)` 被吃成第二个 `var $ =`，
  // 把前面那个 querySelector 版的 $ 整个覆盖掉 → `$('#J-order').value` 变 undefined，
  // 报错却指在一行看起来完全正常的代码上。查了三轮才定位。
  const inject = (re, make) => { html = html.replace(re, (...m) => make(...m)); };

  // 把外链 CSS 换成内联的那一大坨
  html = html.replace(/<link[^>]*data-fq-css="[^"]*"[^>]*>/g, '');
  inject(/<\/head>/i, () =>
    `<style id="fq-live-css">\n${cssAll}\n</style>\n<style id="fq-shell">${shell}</style>\n</head>`);
  inject(/<body([^>]*)>/i, (mm, attrs) =>
    `<body${attrs}>\n<svg id="fq-sprite" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden">${symbols}</svg>`);

  // ── 交互层：把剥掉 JS 之后丢失的「用户看得见」的交互补回来 ────────────────
  // 只补筛选/展开/输入这几件，不复活任何埋点。独立文件维护，见 live-clone-interactions.js。
  if (Object.keys(filterStates).length) {
    const blob = JSON.stringify(filterStates);
    inject(/<\/body>/i, () => `<script id="fq-filter-states">window.__FQ_FILTER_STATES__=${blob};</script>\n</body>`);
    report.filterStates = Object.fromEntries(Object.entries(filterStates).map(([k, v]) => [k, { cards: v.n, num: (v.num || '').replace(/<[^>]+>/g, '') }]));
  }

  const ixFile = path.join(__dirname, 'live-clone-interactions.js');
  let ixCount = 0;
  if (!has('no-interactions') && fs.existsSync(ixFile)) {
    const ix = fs.readFileSync(ixFile, 'utf8');
    inject(/<\/body>/i, () => `<script id="fq-interactions">\n${ix}\n</script>\n</body>`);
    // 注入完当场验一遍没被改写 —— 这类静默损坏不自查就只能等它以怪异报错的形式冒出来
    if (!html.includes('var $$ = function')) throw new Error('交互层注入后被改写（$$ 没了）—— 检查 replace 是不是又用了模板串当替换串');
    ixCount = 1;
    console.log('→ 注入交互层（筛选选中 / 已选条件条 / 展开收起 / 价格·起订量）');
  }
  report.interactions = ixCount ? 'live-clone-interactions.js' : '(未注入)';

  // 克隆声明（别让人误以为是线上真页）
  html = html.replace(/<head([^>]*)>/i, `<head$1>\n<!-- live-clone of ${URL_} · 静态克隆 · 已剥离全部脚本与埋点 -->`);

  fs.writeFileSync(path.join(OUT, NAME + '.html'), html);
  report.generated = { html: NAME + '.html', htmlKB: +(Buffer.byteLength(html) / 1024).toFixed(1) };
  const assetBytes = fs.readdirSync(ASSETS).reduce((s, f) => s + fs.statSync(path.join(ASSETS, f)).size, 0);
  report.assets.totalKB = +(assetBytes / 1024).toFixed(1);
  report.assets.count = fs.readdirSync(ASSETS).length;
  fs.writeFileSync(path.join(OUT, NAME + '-clone-report.json'), JSON.stringify(report, null, 2));

  // 🔴 克隆完自动合成单文件，别留给人「记得再跑一次 build-inline」。
  // 2026-08-25 血泪：开发版改了 6 轮、自包含版停在 22 分钟前，
  // 用户一直开的是自包含版 —— 于是我每修好一处，他看到的还是老样子，来回空转了四轮。
  // 这不是「他开错文件」，是我把「两个文件保持同步」这件事赌在了记性上。
  if (!has('no-inline')) {
    try {
      const { execFileSync } = require('child_process');
      const out = execFileSync('node', [path.join(__dirname, 'build-inline.js'), '--dir', OUT, '--name', NAME], { encoding: 'utf8' });
      const last = out.trim().split('\n').slice(-2).join(' ').trim();
      console.log('→ 已同步合成单文件自包含版  ' + last);
    } catch (e) {
      console.log('🔴 单文件合成失败，自包含版现在是**过期的**：' + (e.stdout || e.message || '').slice(-300));
    }
  }

  console.log('');
  console.log('✅ 完成');
  console.log(`   ${path.join(OUT, NAME + '.html')}  ${report.generated.htmlKB} KB`);
  console.log(`   assets ${report.assets.count} 个文件  ${report.assets.totalKB} KB`);
  console.log(`   报告   ${NAME}-clone-report.json`);
  if (iconGap.length) console.log(`   ⚠️ 图标缺口 ${new Set(iconGap).size} 个：${[...new Set(iconGap)].join(' ')}`);
  if (failImg.length) console.log(`   ⚠️ ${failImg.length} 张图没下下来`);
})().catch(e => { console.log('ERR ' + e.message + '\n' + e.stack); process.exit(1); });
