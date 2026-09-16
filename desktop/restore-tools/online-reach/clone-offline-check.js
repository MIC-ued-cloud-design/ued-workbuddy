// clone-offline-check.js — 克隆页「脱网三项」验收门
//
// 治什么：克隆页的验收标准里有三条一直靠手工量（SERP 那轮就是手点的）——
//   ① 外部网络请求 0   ② console / JS 错误 0   ③ 断图 0
// 手工量的问题不是慢，是**换一页就会漏一项**，而且漏了不会有任何提示。
// 底座库要铺 6 个页型、每页还会重抓，这三项必须是一条命令。
//
// 🔴 判据都取「浏览器实测」，不取文件是否存在：
//   图片文件躺在磁盘上、浏览器却报断图，是这条链上真实发生过的事
//   （`<base href>` 劫持相对路径，481/483 个文件都在、全断）。所以只认 naturalWidth。
//
// 用法：
//   node clone-offline-check.js --file /abs/克隆页.html [--port 9224] [--json]
//
// 退出码：0 = 三项全过；1 = 有项不过（可直接当门用）

const puppeteer = require('./node_modules/puppeteer-core');
const path = require('path');
const fs = require('fs');

function arg(n, d) {
  const i = process.argv.indexOf('--' + n);
  return i > -1 ? process.argv[i + 1] : d;
}
function has(n) { return process.argv.includes('--' + n); }

const FILE = arg('file');
const PORT = arg('port', '9224');
if (!FILE) { console.log('ERR 需要 --file /abs/克隆页.html'); process.exit(1); }
if (!fs.existsSync(FILE)) { console.log('ERR 文件不存在：' + FILE); process.exit(1); }

// 这些 scheme 不算「外部请求」——它们本来就不出网
const LOCAL_SCHEME = /^(file|data|blob|about):/;

(async () => {
  const wsRes = await fetch(`http://localhost:${PORT}/json/version`).catch(() => null);
  if (!wsRes) { console.log(`ERR 后台 Chrome(${PORT}) 没起。先跑 reach.sh 里那段启动命令。`); process.exit(1); }
  const b = await puppeteer.connect({ browserWSEndpoint: (await wsRes.json()).webSocketDebuggerUrl, defaultViewport: { width: 1440, height: 900 } });
  const p = await b.newPage();

  const external = [];      // 出网的请求
  const failed = [];        // 请求失败的
  const errors = [];        // console.error + pageerror

  p.on('request', r => { const u = r.url(); if (!LOCAL_SCHEME.test(u)) external.push(u); });
  p.on('requestfailed', r => failed.push({ url: r.url(), err: (r.failure() || {}).errorText }));
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text().slice(0, 200)); });

  await p.goto('file://' + path.resolve(FILE), { waitUntil: 'networkidle2', timeout: 120000 });
  // 滚一遍，把懒加载/进入视口才取的资源也逼出来 —— 只看首屏会漏掉大半
  await p.evaluate(async () => {
    const H = document.body.scrollHeight;
    for (let y = 0; y < H; y += 700) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 80)); }
    window.scrollTo(0, 0);
    await new Promise(r => setTimeout(r, 500));
  });

  // 断图：只认浏览器的 naturalWidth，别去查文件在不在
  const imgs = await p.evaluate(() => {
    const out = { total: 0, broken: [] };
    document.querySelectorAll('img').forEach(im => {
      if (!im.getAttribute('src')) return;
      out.total++;
      if (im.complete && im.naturalWidth === 0) out.broken.push((im.currentSrc || im.src).slice(-90));
    });
    return out;
  });

  await p.close();
  await b.disconnect();

  const uniq = a => [...new Set(a)];
  const ext = uniq(external);
  const res = {
    file: path.basename(FILE),
    externalRequests: { count: ext.length, sample: ext.slice(0, 8) },
    jsErrors: { count: errors.length, sample: uniq(errors).slice(0, 6) },
    brokenImages: { total: imgs.total, count: imgs.broken.length, sample: imgs.broken.slice(0, 8) },
    requestFailed: { count: failed.length, sample: failed.slice(0, 6) },
  };

  if (has('json')) { console.log(JSON.stringify(res, null, 2)); }
  else {
    const line = (ok, label, detail) => console.log(`  ${ok ? '✅' : '❌'} ${label}  ${detail}`);
    console.log(`\n══ 脱网三项 · ${res.file} ══`);
    line(ext.length === 0, '外部请求', `${ext.length} 个` + (ext.length ? '\n     ' + ext.slice(0, 5).join('\n     ') : ''));
    line(errors.length === 0, 'JS 错误 ', `${errors.length} 个` + (errors.length ? '\n     ' + uniq(errors).slice(0, 4).join('\n     ') : ''));
    line(imgs.broken.length === 0, '断图    ', `${imgs.broken.length} / ${imgs.total} 张` + (imgs.broken.length ? '\n     ' + imgs.broken.slice(0, 5).join('\n     ') : ''));
    if (failed.length) console.log(`  ⚠️ 另有 ${failed.length} 个请求 failed（多为被剥掉的第三方，非致命）`);
  }

  const bad = ext.length || errors.length || imgs.broken.length;
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('ERR ' + e.message); process.exit(1); });
