/**
 * Netlify Edge Function 入口。
 *
 * Edge Functions 跑在 Deno 运行时上，原生支持把上游的流直接转出去 ——
 * 这正是我们要的（页面靠 SSE 一个字一个字显示回答）。
 * 普通 Netlify Functions 是 Lambda，免费档 10 秒超时且流式要另写，所以不用那个。
 *
 * 环境变量在 Netlify 控制台 Site configuration → Environment variables 里设：
 *   ZHIPU_KEY / WB_PASS
 */
import { handle } from '../../proxy/core.js';

const getEnv = (n) => {
  try {
    if (typeof Netlify !== 'undefined' && Netlify.env) return Netlify.env.get(n) || '';
  } catch (_) { /* 本地跑或没这个全局时忽略 */ }
  try {
    if (typeof Deno !== 'undefined' && Deno.env) return Deno.env.get(n) || '';
  } catch (_) { /* 没有读环境变量的权限时忽略 */ }
  return '';
};

export default (request) => handle(request, getEnv);

export const config = { path: '/chat' };
