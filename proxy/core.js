/**
 * UED WorkBuddy · 模型代理 · 共用核心
 *
 * 平台入口分开放（各家的函数签名不一样，核心逻辑不重复写）：
 *   netlify/edge-functions/chat.js   Netlify Edge Functions（Deno 运行时，支持流式）
 *   proxy/cf-worker.js               Cloudflare Workers
 *
 * 存在的唯一理由：让同事零配置就能用，同时密钥不进公开仓库。
 * 密钥从环境变量读，代码里没有明文 —— 这份文件本身可以公开。
 *
 * 一份代码兼容两个平台（末尾两个入口都写了）：
 *   Deno Deploy        deployctl deploy --project=<名> --prod proxy/proxy.js
 *   Cloudflare Workers npx wrangler deploy proxy/proxy.js
 *
 * 环境变量（部署后在控制台设，不要写进代码）：
 *   ZHIPU_KEY  智谱的 API 密钥
 *   WB_PASS    部门口令；页面请求时带在 X-WB-Pass 头里。不设就等于不校验口令。
 */

const ZHIPU = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

// 只允许这个来源调用。浏览器不允许网页伪造 Origin，所以这一条能挡掉大部分滥用。
const ALLOW = [
  'https://mic-ued-cloud-design.github.io',
];

const MODEL     = 'glm-4-flash';   // 只放行这一个模型，免得代理被拿去跑别的
const RATE_N    = 8;               // 同一个 IP 每窗口最多几次
const RATE_MS   = 60000;           // 窗口长度
const MAX_CHARS = 60000;           // 请求体上限，挡住拿它当通用推理服务用的
const MAX_TOKENS_CAP = 4096;

/* 速率限制。
   🔴 说实话：Origin 校验挡不住 curl（服务端可以伪造任意 Origin），
   口令写在公开页面里、查看源码就能看到。所以真正管用的是这一层。
   内存计数是按实例的，Deno Deploy 多实例时不共享 —— 挡不住分布式滥用，
   但足够挡住随手拿去白用的。真被大规模刷就换成 Deno KV 计数。

   兜底判据：用的是智谱**免费**模型，所以最坏情况是额度被耗尽、页面暂时答不了，
   不会产生账单。风险上限是「不能用」而不是「花钱」。 */
const hits = new Map();
function tooFast(ip) {
  const now = Date.now();
  const a = (hits.get(ip) || []).filter((t) => now - t < RATE_MS);
  a.push(now);
  hits.set(ip, a);
  if (hits.size > 5000) {                       // 别让这张表无限长
    for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > RATE_MS) hits.delete(k);
  }
  return a.length > RATE_N;
}

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOW.includes(origin) ? origin : ALLOW[0],
    'Access-Control-Allow-Headers': 'content-type,x-wb-pass',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function err(msg, status, origin) {
  return new Response(JSON.stringify({ error: { message: msg } }), {
    status,
    headers: { ...cors(origin), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function handle(req, getEnv) {
  const origin = req.headers.get('Origin') || '';
  const g = (n) => (getEnv ? getEnv(n) : '') || '';

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });

  const url = new URL(req.url);

  /* 健康检查：GET /chat。
     🔴 只能挂在 /chat 上 —— Netlify 的 config.path 只把这一个路径路由进函数，
     写在 / 或 /health 上是死代码（我第一版就写错在这，部署完根本没法验证它活没活）。
     只报「密钥配没配」这个布尔值，不回显任何密钥内容。 */
  if (req.method === 'GET' && url.pathname === '/chat') {
    return new Response(JSON.stringify({
      ok: true, model: MODEL,
      keyConfigured: !!g('ZHIPU_KEY'),
      passRequired: !!g('WB_PASS'),
      rate: RATE_N + ' 次 / ' + (RATE_MS / 1000) + ' 秒',
    }, null, 1), { headers: { ...cors(origin), 'Content-Type': 'application/json; charset=utf-8' } });
  }

  if (req.method !== 'POST' || url.pathname !== '/chat')
    return err('这个代理只接受 POST /chat（GET /chat 是健康检查）', 404, origin);

  if (!ALLOW.includes(origin))
    return err('这个来源不在允许名单里', 403, origin);

  const ip = req.headers.get('CF-Connecting-IP') ||
             (req.headers.get('X-Forwarded-For') || '').split(',')[0].trim() || 'unknown';
  if (tooFast(ip))
    return err('问得太快了，等一分钟再试', 429, origin);

  const pass = g('WB_PASS');
  if (pass && req.headers.get('X-WB-Pass') !== pass)
    return err('口令不对', 401, origin);

  const key = g('ZHIPU_KEY');
  if (!key)
    return err('代理还没配置密钥（环境变量 ZHIPU_KEY 是空的）', 500, origin);

  const raw = await req.text();
  if (raw.length > MAX_CHARS)
    return err('这次问题带的资料太长了，超过代理允许的上限', 413, origin);

  let body;
  try { body = JSON.parse(raw); } catch { return err('请求不是合法的 JSON', 400, origin); }
  if (!Array.isArray(body.messages) || !body.messages.length)
    return err('请求里没有 messages', 400, origin);

  // 收紧成固定形态：模型写死，其余只放行几个我们自己会用的字段
  const safe = {
    model: MODEL,
    messages: body.messages,
    stream: body.stream === true,
    temperature: typeof body.temperature === 'number' ? body.temperature : 0.1,
  };
  if (typeof body.max_tokens === 'number')
    safe.max_tokens = Math.min(body.max_tokens, MAX_TOKENS_CAP);

  let up;
  try {
    up = await fetch(ZHIPU, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify(safe),
    });
  } catch (e) {
    return err('代理连不上智谱：' + (e && e.message ? e.message : e), 502, origin);
  }

  // 直接把上游的流转出去，前端的流式解析不用改
  return new Response(up.body, {
    status: up.status,
    headers: {
      ...cors(origin),
      'Content-Type': up.headers.get('Content-Type') || 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
