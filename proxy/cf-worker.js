/**
 * Cloudflare Workers 入口（备选，Netlify 走不通时用）。
 * 部署：npx wrangler deploy proxy/cf-worker.js
 * 密钥：npx wrangler secret put ZHIPU_KEY / WB_PASS
 *
 * 🔴 部署完必须拿真实地址在公司网测一次可达性 ——
 * workers.dev 的地址是三级的 <worker>.<子域名>.workers.dev，
 * 用两级的 example.workers.dev 测是无效的（我犯过这个错）。
 */
import { handle } from './core.js';

export default {
  fetch: (req, env) => handle(req, (n) => (env && env[n]) || ''),
};
