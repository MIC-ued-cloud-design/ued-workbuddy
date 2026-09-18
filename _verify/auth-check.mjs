/* 飞书登录 · 服务端逻辑自测（不联网、不用真密钥）
 *
 * 验的是我们自己那半：签名往返、篡改能不能被发现、过期会不会放行、
 * 授权链接组得对不对、缺环境变量时报的话对不对。
 * 🔴 验不了的是飞书那半（换令牌、取用户信息）—— 那要真人点一次授权页。
 */
import { handleAuth, verify } from '../proxy/auth-core.js';

const SECRET = 'test-only-secret-0123456789abcdefghijklmnop';
const ENV = { FEISHU_APP_ID: 'cli_test', FEISHU_APP_SECRET: 'sec_test', WB_SESSION_SECRET: SECRET };
const env = (n) => ENV[n] || '';
const get = (path) => new Request('https://x.netlify.app' + path);

let bad = 0;
const ok  = (m) => console.log('✅ ' + m);
const no  = (m) => { bad++; console.log('❌ ' + m); };

/* 1. 健康检查 */
{
  const r = await handleAuth(get('/auth/health'), env);
  const j = await r.json();
  j.appIdConfigured && j.secretConfigured && j.sessionSecretConfigured
    ? ok(`健康检查：三个环境变量都报 true · 回调 ${j.callback}`)
    : no('健康检查没报齐：' + JSON.stringify(j));
}

/* 2. 缺环境变量时给的是人话，不是 500 */
{
  const r = await handleAuth(get('/auth/login'), () => '');
  const t = await r.text();
  /FEISHU_APP_ID/.test(t) && r.status === 200
    ? ok('缺环境变量时给出可操作的说明页，不是白屏或 500')
    : no('缺环境变量时的响应不对：' + r.status);
}

/* 3. /auth/login 跳转地址组得对不对 */
let state;
{
  const r = await handleAuth(get('/auth/login'), env);
  if (r.status !== 302) { no('/auth/login 没有 302'); }
  else {
    const u = new URL(r.headers.get('location'));
    state = u.searchParams.get('state');
    const checks = [
      [u.origin + u.pathname === 'https://accounts.feishu.cn/open-apis/authen/v1/authorize', '授权地址是 accounts.feishu.cn 那个 v1'],
      [u.searchParams.get('client_id') === 'cli_test', 'client_id 带上了'],
      [u.searchParams.get('response_type') === 'code', 'response_type=code'],
      [u.searchParams.get('redirect_uri') === 'https://eloquent-semifreddo-38ac62.netlify.app/auth/callback', 'redirect_uri 是回调地址原文'],
      [!!state, 'state 带上了'],
    ];
    checks.every(c => c[0])
      ? ok('授权链接：' + checks.map(c => c[1]).join(' · '))
      : no('授权链接不对：' + JSON.stringify(checks.filter(c => !c[0]).map(c => c[1])));
  }
}

/* 4. state 签名往返 —— 自己签的自己认 */
{
  const p = await verify(state, SECRET);
  p && p.e > Date.now() ? ok('state 自签自验通过，带着有效期') : no('state 验不过');
}

/* 5. 篡改一个字符就必须失效 */
{
  const tampered = state.slice(0, -2) + (state.slice(-2) === 'AA' ? 'BB' : 'AA');
  await verify(tampered, SECRET) === null ? ok('改一个字符就验不过') : no('🔴 篡改的令牌被放行了');
}

/* 6. 换个密钥必须验不过（防止别人拿我们的格式自己签一个） */
{
  await verify(state, SECRET + 'x') === null ? ok('换密钥验不过') : no('🔴 用别的密钥签的令牌被放行了');
}

/* 7. 过期必须拒 */
{
  const { default: _ } = { default: 0 };
  // 手工造一个过期载荷：直接改载荷会破坏签名，所以这里验的是「签名对但已过期」
  // —— 用同一套签名逻辑签一个 e 在过去的令牌
  const enc = new TextEncoder();
  const b64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const body = b64u(enc.encode(JSON.stringify({ o:'x', n:'过期的人', e: Date.now() - 1000 })));
  const k = await crypto.subtle.importKey('raw', enc.encode(SECRET), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  const sig = b64u(await crypto.subtle.sign('HMAC', k, enc.encode(body)));
  await verify(body + '.' + sig, SECRET) === null
    ? ok('签名正确但已过期的令牌被拒') : no('🔴 过期令牌被放行了');
}

/* 8. 回调没带 code 时不应该崩 */
{
  const r = await handleAuth(get('/auth/callback'), env);
  const t = await r.text();
  r.status === 200 && /没有回传授权码/.test(t) ? ok('回调缺 code 时给人话') : no('回调缺 code 的处理不对');
}

/* 9. 回调带假 state 必须拒（挡住直接构造回调链接） */
{
  const r = await handleAuth(get('/auth/callback?code=fake&state=forged.sig'), env);
  const t = await r.text();
  /失效/.test(t) ? ok('伪造 state 的回调被拒') : no('🔴 伪造 state 的回调没被拒');
}

/* 10. 不接受外部指定跳转目标（开放重定向） */
{
  const r = await handleAuth(get('/auth/login?r=https://evil.example.com'), env);
  const to = r.headers.get('location') || '';
  const cb = new URL(to).searchParams.get('redirect_uri') || '';
  !/evil/.test(to + cb) ? ok('跳转目标写死，外部传的地址被忽略') : no('🔴 存在开放重定向');
}

console.log(bad ? `\n❌ ${bad} 项不过` : '\n✅ 服务端逻辑全部通过（飞书那半要真人点一次才算验过）');
process.exit(bad ? 1 : 0);
