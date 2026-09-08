/**
 * UED WorkBuddy · 飞书登录 · 共用核心
 *
 * 入口：netlify/edge-functions/auth.js（路径 /auth/*）
 *
 * 为什么要有服务端这一半：换 token 那一步必须带 App Secret，
 * 而 Secret 一旦进了前端就等于公开（页面在公开仓库里）。
 * 所以 Secret 只在这里、只从环境变量读，这份文件本身不含任何密钥、可以公开。
 *
 * 环境变量（在 Netlify 控制台设，不要写进代码）：
 *   FEISHU_APP_ID        飞书自建应用的 App ID
 *   FEISHU_APP_SECRET    飞书自建应用的 App Secret
 *   WB_SESSION_SECRET    我们自己签会话令牌用的随机串（跟飞书无关，自己生成一个长的）
 *
 * 三个飞书接口（2026-09 核对过，飞书有 v1/v2 两套，别配混）：
 *   授权页   GET  https://accounts.feishu.cn/open-apis/authen/v1/authorize
 *   换令牌   POST https://open.feishu.cn/open-apis/authen/v2/oauth/token
 *   取用户   GET  https://open.feishu.cn/open-apis/authen/v1/user_info
 * 拿姓名、头像、open_id 属于基础调用，不需要申请任何权限。
 */

const AUTHORIZE = 'https://accounts.feishu.cn/open-apis/authen/v1/authorize';
const TOKEN     = 'https://open.feishu.cn/open-apis/authen/v2/oauth/token';
const USERINFO  = 'https://open.feishu.cn/open-apis/authen/v1/user_info';

/* 登录成功之后跳回哪。
   🔴 写死，不接受请求里传进来的地址 —— 允许调用方指定跳转目标就是「开放重定向」，
   别人可以拿我们这个域名当跳板把人送去钓鱼页，链接看着还是公司的域名。 */
const PAGE = 'https://mic-ued-cloud-design.github.io/ued-workbuddy/';

const CALLBACK = 'https://eloquent-semifreddo-38ac62.netlify.app/auth/callback';

const SESSION_HOURS = 24 * 14;   // 会话有效期：两周。过期就重新点一次飞书授权，成本很低
const STATE_MINUTES = 10;        // 授权链接的有效期

/* ── 签名工具 ──
   会话令牌用 HMAC-SHA256 自签，格式 base64url(载荷).base64url(签名)。
   没有用现成的 JWT 库：Edge 运行时装依赖麻烦，而我们只需要「签 + 验」两件事。
   载荷是明文可读的（base64 不是加密），所以里面只放姓名头像这类本来就要显示的东西。 */
const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uStr = (s) => b64u(enc.encode(s));
const unb64u = (s) => {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  return atob(t + '='.repeat((4 - t.length % 4) % 4));
};

async function key(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function sign(payload, secret) {
  const body = b64uStr(JSON.stringify(payload));
  const sig = await crypto.subtle.sign('HMAC', await key(secret), enc.encode(body));
  return body + '.' + b64u(sig);
}
export async function verify(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const i = token.lastIndexOf('.');
  if (i < 1) return null;
  const body = token.slice(0, i);
  const want = await crypto.subtle.sign('HMAC', await key(secret), enc.encode(body));
  /* 🔴 用固定时间比较，不用 ===。字符串比较一遇到不同就返回，
     响应时间会泄露「前几位对不对」，理论上能被逐位试出签名。 */
  const got = token.slice(i + 1), exp = b64u(want);
  if (got.length !== exp.length) return null;
  let diff = 0;
  for (let n = 0; n < got.length; n++) diff |= got.charCodeAt(n) ^ exp.charCodeAt(n);
  if (diff !== 0) return null;
  let p;
  try { p = JSON.parse(unb64u(body)); } catch { return null; }
  if (!p || typeof p.e !== 'number' || Date.now() > p.e) return null;
  return p;
}

const html = (title, body) => new Response(
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<style>body{font:15px/1.8 -apple-system,"PingFang SC",sans-serif;color:#333;
   max-width:520px;margin:18vh auto;padding:0 24px}
   h1{font-size:19px;margin:0 0 12px}p{color:#666;margin:0 0 8px}
   a{color:#1682E8}code{background:#F5F5F5;padding:2px 6px;border-radius:4px;font-size:13px}</style>` +
  `<h1>${title}</h1>${body}<p><a href="${PAGE}">返回 WorkBuddy</a></p>`,
  { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

export async function handleAuth(req, getEnv) {
  const g = (n) => (getEnv ? getEnv(n) : '') || '';
  const url = new URL(req.url);
  const appId = g('FEISHU_APP_ID');
  const secret = g('FEISHU_APP_SECRET');
  const sessionSecret = g('WB_SESSION_SECRET');

  /* 健康检查：只报「配没配」，不回显任何密钥内容 */
  if (url.pathname === '/auth/health') {
    return new Response(JSON.stringify({
      ok: true,
      appIdConfigured: !!appId,
      secretConfigured: !!secret,
      sessionSecretConfigured: !!sessionSecret,
      callback: CALLBACK,
      page: PAGE,
    }, null, 1), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }

  if (!appId || !secret || !sessionSecret)
    return html('登录还没配好', '<p>代理缺环境变量。要设的三个：' +
      '<code>FEISHU_APP_ID</code>、<code>FEISHU_APP_SECRET</code>、<code>WB_SESSION_SECRET</code>。</p>' +
      '<p>配好之后访问 <code>/auth/health</code> 能看到三个都是 true。</p>');

  /* ── 第一步：把人送去飞书授权页 ── */
  if (url.pathname === '/auth/login') {
    /* state 用签名的时间戳，不落任何存储 —— 边缘函数是多实例的，
       存在内存里换个实例就找不到了（这类「本地能过、线上偶发失败」最难查）。 */
    const state = await sign({ t: Date.now(), e: Date.now() + STATE_MINUTES * 60000 }, sessionSecret);
    const to = AUTHORIZE + '?' + new URLSearchParams({
      client_id: appId,
      redirect_uri: CALLBACK,
      response_type: 'code',
      state,
    });
    return Response.redirect(to, 302);
  }

  /* ── 第二步：飞书跳回来，拿着 code ── */
  if (url.pathname === '/auth/callback') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code) return html('登录没完成', '<p>飞书没有回传授权码。可能是你在授权页点了取消。</p>');
    if (!(await verify(state, sessionSecret)))
      return html('这个登录链接已经失效', `<p>授权链接只有 ${STATE_MINUTES} 分钟有效期，回到页面重新点一次登录。</p>`);

    let tk;
    try {
      tk = await (await fetch(TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          client_id: appId, client_secret: secret,
          code, redirect_uri: CALLBACK,
        }),
      })).json();
    } catch (e) {
      return html('连不上飞书', '<p>换令牌那一步失败了：' + (e && e.message || e) + '</p>');
    }
    if (!tk || !tk.access_token)
      return html('飞书拒绝了这次登录',
        '<p>飞书返回：<code>' + (tk && (tk.error_description || tk.error || tk.msg) || '没有说明') + '</code></p>' +
        '<p>最常见的两个原因：应用还没发布通过审批；或者重定向 URL 跟飞书后台里配的不一致。</p>');

    let ui;
    try {
      ui = await (await fetch(USERINFO, {
        headers: { 'Authorization': 'Bearer ' + tk.access_token },
      })).json();
    } catch (e) {
      return html('取用户信息失败', '<p>' + (e && e.message || e) + '</p>');
    }
    const d = ui && ui.data;
    if (!d || !d.open_id)
      return html('取不到你的信息',
        '<p>飞书返回：<code>' + (ui && ui.msg || '没有说明') + '</code></p>');

    /* 只放页面上要显示的三样。刻意不放邮箱、手机号、工号 ——
       载荷是 base64 明文可读的，而且这些字段我们一个都用不上。 */
    const session = await sign({
      o: d.open_id,
      n: d.name || d.en_name || '同事',
      a: d.avatar_url || '',
      e: Date.now() + SESSION_HOURS * 3600000,
    }, sessionSecret);

    /* 令牌放在 URL 的 # 后面：# 不会被浏览器发给服务器，
       也不会进 GitHub Pages 的访问日志。页面读完立刻把它从地址栏抹掉。 */
    return Response.redirect(PAGE + '#wb=' + session, 302);
  }

  return html('这个地址不对', '<p>登录相关的地址只有 <code>/auth/login</code> 和 <code>/auth/callback</code>。</p>');
}
