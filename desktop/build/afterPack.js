// 打包后给 .app 打一个本机临时签名（ad-hoc）。没有苹果开发者证书时，Apple 芯片的 Mac 会直接拒开没签名的应用；
// 临时签名能让它以「未识别开发者」的身份被放行一次，而不是报「已损坏」。
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
exports.default = async function (ctx) {
  if (ctx.electronPlatformName !== 'darwin') return;
  // 通用包先各出一份 x64 / arm64 临时目录再合并；这两份不能先签，签了合并时校验和对不上。只签合并后的那份。
  if (/-temp$/.test(ctx.appOutDir)) return;
  const app = fs.readdirSync(ctx.appOutDir).find(n => n.endsWith('.app'));
  if (!app) return;
  const full = path.join(ctx.appOutDir, app);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', full], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', full], { stdio: 'inherit' });
  console.log('  • ad-hoc signed', full);
};
