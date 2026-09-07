# 模型代理（让同事零配置）

**这一层解决什么**：把智谱密钥藏在服务端，页面调这个代理而不是直连智谱。
同事打开页面就能问，不用注册、不用填密钥。

**为什么不能把密钥直接写进页面**：`ued-workbuddy` 是公开仓库，写进去就是公开发布密钥，
GitHub 上有专门扫密钥的机器人，而且 git 历史里删不掉。

## 🔴 选平台之前先测可达性

`workers.dev` 在公司网**实测被屏蔽**（2026-05-10），`vercel.app` 部分被屏蔽。
所以先在**公司网络**里跑 `check-reach.sh`，看哪个平台的域名能通，再往那个平台部署。

## 代码

`proxy.js` 一份代码同时能跑在 Deno Deploy 和 Cloudflare Workers 上（入口写法都兼容）。
它做三件事：

1. 只转发 `POST /chat`，其余路径一律拒（不做通用代理，免得被人当白嫖通道）
2. 校验 `Origin`：只允许 `mic-ued-cloud-design.github.io`（浏览器改不了 Origin，能挡掉大部分滥用）
3. 校验口令 `X-WB-Pass`：页面里带一个部门口令，挡掉直接拿 curl 打的
4. 把请求转给智谱，密钥从环境变量 `ZHIPU_KEY` 读，**不在代码里**

## 部署

```bash
# Deno Deploy
deployctl deploy --project=<项目名> --prod proxy/proxy.js
# 然后在 Deno Deploy 控制台把 ZHIPU_KEY 和 WB_PASS 设成环境变量

# Cloudflare Workers
npx wrangler deploy proxy/proxy.js
npx wrangler secret put ZHIPU_KEY
npx wrangler secret put WB_PASS
```

部署完把页面里的 `PROXY_URL` 指向拿到的地址（在 `build/patch-ai.py` 里改，然后重跑脚本）。
