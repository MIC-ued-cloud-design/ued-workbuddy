#!/usr/bin/env node
// shot-node.js — 按 data-node-id 截元素图（可选与 Figma 底片并排 / 逐区块比对）
//
// 治什么（2026-09-01 立·金刚区 Q 版上白烧了 6~7 轮换来的）：
//   想看"我做的这块跟 Figma 像不像"，本能是「截视口 → 自己裁」。这条路要同时算对
//   ① devicePixelRatio（截图 1600 宽 vs 视口 1635）② scrollY ③ sticky 页头把元素推走，
//   三个变量各错一点就整体偏，而且**偏了看起来像"产物错"**——那次我据此判定「产品图没渲染」，
//   连查 6 轮（DOM 查询 / decode() / 两次 visual / 三次手裁），最后是用户自己打开看才说"是对的"。
//
// 正解：**别自己裁**。puppeteer 的 `page.screenshot({clip})` 收的是**文档坐标**，
//   由浏览器自己换算滚动与 dpr，`captureBeyondViewport` 连"元素比视口高"都不用管。
//   坐标直接来自 `getBoundingClientRect() + scrollX/Y`，一步到位、零手推。
//
// 用法：
//   node shot-node.js --url <file://...|http://...> --node <figma节点id> --out <a.png>
//        [--port 9222] [--vw 1440] [--figma <底片.png> --compare <并排图.png>]
//        [--probe '<相对块左上角的取样框 name:x,y,w,h;...>']   # 逐区块暗像素对比·判"缺图/缺块"
//
// 退出码：0=成功（有 --figma 时还要求尺寸一致）；1=元素找不到/尺寸对不上/截图失败。
const path = require('path');
const fs = require('fs');
const puppeteer = require(path.join(__dirname, 'node_modules', 'puppeteer-core'));

const A = process.argv.slice(2);
const arg = (k, d) => { const i = A.indexOf(k); return i >= 0 ? A[i + 1] : d; };
const URL = arg('--url'), NODE = arg('--node'), OUT = arg('--out');
const PORT = arg('--port', '9222'), VW = +arg('--vw', 1440);
const FIGMA = arg('--figma'), COMPARE = arg('--compare'), PROBE = arg('--probe');
if (!URL || !NODE || !OUT) { console.error('用法：--url <URL> --node <figma节点id> --out <a.png> [--figma <底片> --compare <并排图>] [--probe "名:x,y,w,h;..."]'); process.exit(1); }

// 后台 Chrome 没起就起一个（跟 restore-gates.sh 同一套·同事拿到即能用，不用先读别的脚本）
async function ensureChrome() {
  const probe = async () => { try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); return r.ok; } catch (e) { return false; } };
  if (await probe()) return;
  console.log('▶ 起后台 Chrome (CDP ' + PORT + ')…');
  // 路径不写死（2026-09-15）：同事那台没装在标准位置就起不来，而且原来的报错看不出是「没装」还是「起不来」
  const chrome = require(require('path').join(__dirname, 'find-chrome.js')).find();
  if (!chrome.isRealChrome) console.warn('⚠️  没找到 Google Chrome，回落用 ' + chrome.name + '；MIC 有反爬，读不出内容先怀疑这条。');
  require('child_process').spawn(chrome.path,
    ['--remote-debugging-port=' + PORT, '--user-data-dir=/tmp/cr-restore-' + PORT,
     '--headless=new', '--no-first-run', '--no-default-browser-check', 'about:blank'],
    { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 20; i++) { await new Promise(r => setTimeout(r, 500)); if (await probe()) return; }
  throw new Error('浏览器找到了（' + chrome.path + '）但 CDP 端口 ' + PORT + ' 起不来。先看看是不是已经有别的进程占着这个端口。');
}

(async () => {
  await ensureChrome();
  const b = await puppeteer.connect({ browserURL: 'http://localhost:' + PORT, defaultViewport: { width: VW, height: 1080 } });
  const p = await b.newPage();
  await p.setViewport({ width: VW, height: 1080, deviceScaleFactor: 1 });
  await p.goto(URL, { waitUntil: 'load', timeout: 120000 });

  // 关键一步：等区内所有 img 真正 decode 完（base64 的 complete=true 只代表下载完，解码是异步的）
  const info = await p.evaluate(async (id) => {
    const el = document.querySelector(`[data-node-id="${id}"]`);
    if (!el) return { err: '找不到 [data-node-id="' + id + '"]' };
    const imgs = [...el.querySelectorAll('img')];
    let decoded = 0, failed = [];
    await Promise.all(imgs.map(async im => {
      try { await im.decode(); decoded++; } catch (e) { failed.push(im.getAttribute('data-node-id') || im.src.slice(0, 40)); }
    }));
    const r = el.getBoundingClientRect();
    // 文档坐标 —— screenshot({clip}) 要的就是这个，浏览器自己处理滚动/dpr
    return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height, imgTotal: imgs.length, decoded, failed };
  }, NODE);
  if (info.err) { console.error('❌ ' + info.err); await p.close(); await b.disconnect(); process.exit(1); }
  if (info.failed.length) console.error('⚠️ 有 ' + info.failed.length + ' 张图 decode 失败：' + info.failed.join(', '));

  const clip = { x: Math.round(info.x), y: Math.round(info.y), width: Math.round(info.w), height: Math.round(info.h) };
  await p.screenshot({ path: OUT, clip, captureBeyondViewport: true });
  console.log(`✅ 截图 ${clip.width}×${clip.height} @文档(${clip.x},${clip.y}) · img ${info.decoded}/${info.imgTotal} 已解码 → ${OUT}`);

  let bad = 0;
  if (FIGMA) {
    if (!fs.existsSync(FIGMA)) { console.error('❌ 底片不存在：' + FIGMA); bad = 1; }
    else {
      // 尺寸一致性 + 可选逐区块暗像素对比，都在浏览器 canvas 里做（零图像库依赖）
      const figB64 = fs.readFileSync(FIGMA).toString('base64');
      const mineB64 = fs.readFileSync(OUT).toString('base64');
      const spots = (PROBE || '').split(';').filter(Boolean).map(s => {
        const [name, nums] = s.split(':'); const [x, y, w, h] = nums.split(',').map(Number);
        return { name, x, y, w, h };
      });
      const res = await p.evaluate(async (fig, mine, spots) => {
        const load = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
        const [F, M] = await Promise.all([load('data:image/png;base64,' + fig), load('data:image/png;base64,' + mine)]);
        const dark = (img, s) => {
          const c = document.createElement('canvas'); c.width = s.w; c.height = s.h;
          const x = c.getContext('2d', { willReadFrequently: true });
          x.drawImage(img, s.x, s.y, s.w, s.h, 0, 0, s.w, s.h);
          const d = x.getImageData(0, 0, s.w, s.h).data; let n = 0;
          for (let i = 0; i < d.length; i += 4) if (d[i] < 80 && d[i + 1] < 80 && d[i + 2] < 80) n++;
          return n;
        };
        return {
          figSize: [F.naturalWidth, F.naturalHeight], mineSize: [M.naturalWidth, M.naturalHeight],
          probes: spots.map(s => ({ name: s.name, fig: dark(F, s), mine: dark(M, s) }))
        };
      }, figB64, mineB64, spots);
      const same = res.figSize[0] === res.mineSize[0] && res.figSize[1] === res.mineSize[1];
      console.log(`${same ? '✅' : '❌'} 尺寸 Figma ${res.figSize.join('×')} / 我的 ${res.mineSize.join('×')}`);
      if (!same) bad = 1;
      if (res.probes.length) {
        console.log(`${'区块'.padEnd(10)}${'Figma暗'.padStart(9)}${'我的暗'.padStart(9)}   判定`);
        for (const q of res.probes) {
          const ok = q.mine > q.fig * 0.5;
          if (!ok) bad = 1;
          console.log(`${q.name.padEnd(10)}${String(q.fig).padStart(9)}${String(q.mine).padStart(9)}   ${ok ? '✅' : '❌ 缺块'}`);
        }
      }
      if (COMPARE) {
        const cmp = await p.evaluate(async (fig, mine) => {
          const load = src => new Promise(ok => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
          const [F, M] = await Promise.all([load('data:image/png;base64,' + fig), load('data:image/png;base64,' + mine)]);
          const W = Math.max(F.naturalWidth, M.naturalWidth), H = F.naturalHeight + M.naturalHeight + 10;
          const c = document.createElement('canvas'); c.width = W; c.height = H;
          const x = c.getContext('2d'); x.fillStyle = '#787878'; x.fillRect(0, 0, W, H);
          x.drawImage(F, 0, 0); x.drawImage(M, 0, F.naturalHeight + 10);
          return c.toDataURL('image/png').split(',')[1];
        }, figB64, mineB64);
        fs.writeFileSync(COMPARE, Buffer.from(cmp, 'base64'));
        console.log(`👁 并排图（上 Figma / 下 我的）→ ${COMPARE}`);
      }
    }
  }
  await p.close(); await b.disconnect();
  process.exit(bad);
})().catch(e => { console.error('❌ ' + (e && e.message || e)); process.exit(1); });
