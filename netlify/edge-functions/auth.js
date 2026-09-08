/**
 * Netlify Edge Function 入口 · 飞书登录。
 * 逻辑在 proxy/auth-core.js 里，这里只做平台适配（跟 chat.js 同一个写法）。
 */
import { handleAuth } from '../../proxy/auth-core.js';

const getEnv = (n) => {
  try {
    if (typeof Netlify !== 'undefined' && Netlify.env) return Netlify.env.get(n) || '';
  } catch (_) { /* 本地跑或没这个全局时忽略 */ }
  try {
    if (typeof Deno !== 'undefined' && Deno.env) return Deno.env.get(n) || '';
  } catch (_) { /* 没有读环境变量的权限时忽略 */ }
  return '';
};

export default (request) => handleAuth(request, getEnv);

export const config = { path: '/auth/*' };
