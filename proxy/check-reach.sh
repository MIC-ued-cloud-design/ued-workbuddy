#!/bin/bash
# 🔴 在公司网络里跑这个，看哪个平台能通。通了才往那个平台部署。
echo "══ 平台可达性 · $(date '+%m-%d %H:%M') ══"
t () {
  local n="$1" u="$2"
  local c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$u" 2>/dev/null)
  local ms=$(curl -s -o /dev/null -w '%{time_total}' --max-time 8 "$u" 2>/dev/null)
  if [ "$c" = "000" ]; then printf "  ❌ %-16s 连不上（被挡或超时）\n" "$n"
  else printf "  ✅ %-16s HTTP %s · %.1fs\n" "$n" "$c" "$ms"; fi
}
t "Deno Deploy"  "https://dash.deno.com/"
t "Netlify"      "https://app.netlify.com/"
t "Cloudflare"   "https://dash.cloudflare.com/"
t "Vercel"       "https://vercel.com/"
echo
echo "── 这几个是真正要通的边缘域名（部署后的地址长这样）──"
t "*.deno.dev"      "https://example.deno.dev/"
t "*.netlify.app"   "https://example.netlify.app/"
# 🔴 workers.dev 没法这样测：worker 地址是三级的 <worker>.<子域名>.workers.dev，
# 两级的 example.workers.dev 本来就不该解析，测了也是无效结论（我犯过这个错）。
# 要测就得先部署一个真的 worker，拿真实地址来测。
echo "  ⏸  *.workers.dev     没法预测（需先部署真 worker 再拿真实地址测）"
echo
echo "── 对照：智谱本身通不通（页面现在直连它）──"
t "智谱 API" "https://open.bigmodel.cn/"
echo
echo "🔴 看「边缘域名」那三行：只有 ✅ 的平台才值得部署。"
echo "   控制台能开不代表边缘域名能开 —— 屏蔽通常挡的是边缘域名那一段。"
