# 模型代理（让同事零配置）

**解决什么**：把智谱密钥藏在服务端，页面调这个代理而不是直连智谱。
同事打开页面就能问，不用注册、不用填密钥。

**为什么不能把密钥写进页面**：`ued-workbuddy` 是公开仓库，写进去等于公开发布密钥，
GitHub 上有专门扫密钥的机器人，而且 git 历史里删不掉。

## 文件

| | |
|---|---|
| `core.js` | 共用核心，导出 `handle(req, getEnv)`。密钥只从环境变量读，代码里没有明文 |
| `../netlify/edge-functions/chat.js` | **Netlify Edge Functions 入口（当前选用）** |
| `cf-worker.js` | Cloudflare Workers 入口（备选） |
| `check-reach.sh` | 平台可达性测试，🔴 必须在公司网络里跑 |

## 为什么选 Netlify Edge Functions

- Edge Functions 跑在 **Deno 运行时**上，`new Response(upstream.body)` 直接把流转出去 ——
  页面靠 SSE 一个字一个字显示回答，这一点是硬要求
- 普通 Netlify Functions 是 Lambda，免费档 10 秒超时、流式要另写，不适合
- 免费额度 300 万次/月
- 🔴 **Deno Deploy 走不通**：2026-09-07 实测新注册已关闭（`403 SIGNUP_UNAVAILABLE`）
- 🔴 **Cloudflare Workers 是备选**：`workers.dev` 2026-05-10 在公司网实测被屏蔽，
  但那之后没再验过；要用就得先部署一个真 worker，拿**真实三级地址**在公司网测

## 部署（Netlify）

1. `app.netlify.com` 用 GitHub 登录
2. Add new site → Import an existing project → 选仓库 `MIC-ued-cloud-design/ued-workbuddy`
3. build command 留空、publish directory 填 `.`（`netlify.toml` 已经这么写了）
4. 部署完到 Site configuration → Environment variables，加两条：
   `ZHIPU_KEY`（智谱密钥）、`WB_PASS`（部门口令）
5. 验证：`curl https://<站点>.netlify.app/chat`
   应该回 `{"ok":true,"model":"glm-4-flash","keyConfigured":true,...}`
   —— `keyConfigured` 是 false 就说明环境变量没生效

## 四道限制，以及它们各自挡得住什么

| 限制 | 挡得住 | 挡不住 |
|---|---|---|
| 只放行 `POST /chat` | 拿它当通用代理 | — |
| Origin 只允许 github.io 那个 | 别人做个网页偷用 | `curl` 伪造 Origin |
| 口令 `X-WB-Pass` | 随手拿 curl 打的 | 查看页面源码的人（口令在公开页面里） |
| 每 IP 每分钟 8 次 | 随手白用 | 分布式滥用（内存计数按实例，不跨实例共享） |

**兜底判据**：用的是智谱**免费**模型，所以最坏情况是额度被刷完、页面暂时答不了，
**不会产生账单**。风险上限是「不能用」不是「花钱」。
真被大规模刷，就把计数换成持久化存储，或者退回「各人填自己密钥」。
