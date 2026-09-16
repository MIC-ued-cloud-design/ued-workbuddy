// online-reach/reach.js — 统一后台读取（替代旧 recon.js）
// 独立后台 Chrome（CDP）+ 可选 cookie 注入 + 导航 + 滚动触发懒加载 + 内容/截图/精确CSS
//
// 用法：
//   node reach.js --port 9224 --url <URL> [--state cookie.json] [--shot out.png] [--css "选择器"] [--no-scroll] [--ua iphone|android|mac|<串>]
//
// 输出：单行 RESULT {status,title,htmlLen,forbidden,loginHint,bodySnip,shot?,css?}
//   forbidden:false + status:200 = 读到真实页面
//   loginHint:'maybe-not-logged-in' = 页面顶部出现 Sign in（登录态页需注入有效 cookie）
//
// cookie state 格式：{ "cookies": [ {name,value,domain,path,httpOnly,secure}, ... ] }（Playwright storageState 兼容）
const puppeteer = require(require('path').join(__dirname, 'node_modules', 'puppeteer-core'));
const fs = require('fs');

function arg(n, d) {
  const i = process.argv.indexOf('--' + n);
  if (i < 0) return d;
  const v = process.argv[i + 1];
  return (v && !v.startsWith('--')) ? v : true;
}

(async () => {
  const port = arg('port', '9224');
  const url = arg('url');
  const state = arg('state');
  const shot = arg('shot');
  const css = arg('css');
  const noscroll = arg('no-scroll', false);
  if (!url) { console.log('ERR need --url'); process.exit(1); }

  const b = await puppeteer.connect({ browserURL: 'http://localhost:' + port, defaultViewport: { width: parseInt(arg('vw', '1440'), 10), height: parseInt(arg('vh', '900'), 10) } });
  const p = await b.newPage();
  // UA 可切：--ua iphone|android|mac|<自定义串>。触屏/移动端真值必须用移动 UA 才读得到（桌面 UA 会拿到桌面布局）。
  const UA_PRESET = {
    mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36'
  };
  const uaArg = arg('ua', 'mac');
  const ua = UA_PRESET[uaArg] || (typeof uaArg === 'string' ? uaArg : UA_PRESET.mac);
  await p.setUserAgent(ua);
  // 移动 UA 时同步开触屏能力，否则站点靠 touch 检测仍判成桌面
  if (/iPhone|Android|Mobile/i.test(ua)) {
    try { await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]); } catch (e) {}
    try { const cdp = await p.target().createCDPSession();
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: parseInt(arg('vw', '375'), 10), height: parseInt(arg('vh', '812'), 10), deviceScaleFactor: 2, mobile: true });
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } catch (e) { console.error('MOBILE-EMULATE-ERR ' + e.message); }
  }

  // 注入 cookie（登录态页需要）
  if (state && fs.existsSync(state)) {
    try {
      const ck = (JSON.parse(fs.readFileSync(state, 'utf8')).cookies || [])
        .map(c => ({ name: c.name, value: c.value, domain: c.domain, path: c.path || '/', httpOnly: !!c.httpOnly, secure: !!c.secure }));
      if (ck.length) { await p.setCookie(...ck); console.error('COOKIES injected=' + ck.length); }
    } catch (e) { console.error('COOKIE-ERR ' + e.message); }
  }

  let out = {};
  try {
    const r = await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (!noscroll) { // 触发懒加载，否则图/内容可能空
      await p.evaluate(async () => { for (let y = 0; y < 3600; y += 600) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 350)); } window.scrollTo(0, 0); });
      await new Promise(r => setTimeout(r, 900));
    }
    const html = await p.content();
    out = {
      status: r.status(),
      title: await p.title(),
      htmlLen: html.length,
      forbidden: /Forbidden|Access Denied|"message":"Forbidden"/.test(html) || html.length < 3000,
      loginHint: await p.evaluate(() => { const t = document.body ? document.body.innerText.slice(0, 600) : ''; return /Sign in|Sign In|登录|My Account/.test(t) ? 'maybe-not-logged-in' : 'ok'; }),
      bodySnip: (await p.evaluate(() => document.body ? document.body.innerText.slice(0, 180) : '')).replace(/\s+/g, ' ')
    };
    // 轻量标注示意：--annotate '[{"sel":".x","label":"①加筛选"},{"box":[x,y,w,h],"label":"②改文案"}]'
    const annotate = arg('annotate');
    if (annotate && typeof annotate === 'string') {
      let items = []; try { items = JSON.parse(annotate); } catch (e) { out.annotateErr = e.message; }
      const drawn = await p.evaluate(items => {
        let n = 0;
        items.forEach((it, i) => {
          let box = it.box;
          if (it.sel) { const el = document.querySelector(it.sel); if (el) { const r = el.getBoundingClientRect(); box = [r.x + scrollX, r.y + scrollY, r.width, r.height]; } }
          if (!box) return;
          n++;
          const [x, y, w, h] = box;
          const fr = document.createElement('div');
          fr.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;border:3px solid #E64545;border-radius:4px;z-index:2147483646;box-sizing:border-box;pointer-events:none;box-shadow:0 0 0 2px rgba(255,255,255,.6)`;
          const tg = document.createElement('div');
          tg.textContent = it.label || ('#' + (i + 1));
          tg.style.cssText = `position:absolute;left:${x}px;top:${Math.max(0, y - 26)}px;background:#E64545;color:#fff;font:13px/20px -apple-system,sans-serif;padding:2px 9px;border-radius:3px;z-index:2147483647;white-space:nowrap;pointer-events:none`;
          document.body.appendChild(fr); document.body.appendChild(tg);
        });
        return n;
      }, items);
      out.annotated = drawn;
    }
    // 自定义交互：--eval '<JS>' 在截图前执行（支持 await，用于点开浮窗/切全屏等富交互），执行后等待渲染
    const evalJs = arg('eval');
    if (evalJs && typeof evalJs === 'string') {
      try {
        out.evalResult = await p.evaluate(code => {
          // eslint-disable-next-line no-new-func
          return (new Function('return (async () => {' + code + '})()'))();
        }, evalJs);
      } catch (e) { out.evalErr = e.message; }
      await new Promise(r => setTimeout(r, parseInt(arg('evalwait', '1800'), 10)));
    }
    if (shot) { await p.screenshot({ path: shot, fullPage: !!arg('fullpage') }); out.shot = shot; }
    if (css && typeof css === 'string') {
      out.css = await p.evaluate(sel => {
        const el = document.querySelector(sel); if (!el) return null;
        const s = getComputedStyle(el);
        return { boxShadow: s.boxShadow, border: s.border, fontSize: s.fontSize, fontWeight: s.fontWeight, color: s.color, background: s.backgroundColor, padding: s.padding, margin: s.margin, borderRadius: s.borderRadius };
      }, css);
    }
    const links = arg('links');
    if (links && typeof links === 'string') {
      const kws = links.toLowerCase().split(',').map(s => s.trim());
      out.links = await p.evaluate(kws => {
        const seen = {};
        document.querySelectorAll('a[href]').forEach(a => {
          const h = a.href; const t = (a.innerText || a.title || '').trim().replace(/\s+/g, ' ').slice(0, 28);
          const hl = h.toLowerCase();
          for (const k of kws) { if (hl.includes(k) && !seen[h] && !h.startsWith('javascript')) { seen[h] = t; break; } }
        });
        return Object.entries(seen).slice(0, 40).map(([h, t]) => (t || '(无文字)') + ' → ' + h);
      }, kws);
    }
  } catch (e) { out = { error: e.message }; }

  console.log('RESULT ' + JSON.stringify(out));
  await p.close(); await b.disconnect();
})().catch(e => { console.log('ERR ' + e.message); process.exit(1); });
