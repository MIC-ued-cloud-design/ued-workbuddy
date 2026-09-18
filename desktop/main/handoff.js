'use strict';
/**
 * UED WorkBuddy 桌面版 · 一键发给前端
 *
 * 交付包 = 项目里的产物（HTML / md / 图）+ manifest.json + 交付说明.md，
 * 三条出口一起做：① 落一份到「_交付」目录并打成 zip ② 推进交付仓库的一个分支（配了远端就 push 并给 MR 链接）
 * ③ 生成一段「给前端的话」放进剪贴板。
 * 为什么用 git 分支而不是只发 zip：前端拿到的是能 diff、能评论、能回滚的东西，跟他们日常收需求的方式一致。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { loginEnv } = require('./shellenv');
const feiqueFont = require('./feique-font');
const feiqueEmpty = require('./feique-empty');
const flow = require('./flow');
const flowDoc = require('./flow-doc');
const flowWalk = require('./flow-walk');   // GUI启动只有最小PATH：git的凭据助手、公司代理变量都得从登录shell拿

const SKIP = new Set(['.uw', '.git', 'node_modules', '_交付', '.DS_Store']);

function walk(dir, base = dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, base, out);
    else out.push({ rel: path.relative(base, p), size: st.size, mtime: st.mtimeMs });
  }
  return out;
}

function slug(s) { return String(s).trim().replace(/[\/\\:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project'; }
function stamp() { const d = new Date(); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; }

function git(repo, args, opts = {}) {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8', env: loginEnv().env, ...opts });
  if (r.status !== 0 && !opts.soft) throw new Error('git ' + args.join(' ') + ' 失败：' + (r.stderr || r.stdout));
  return (r.stdout || '').trim();
}

function ensureRepo(repoDir) {
  fs.mkdirSync(repoDir, { recursive: true });
  if (!fs.existsSync(path.join(repoDir, '.git'))) {
    git(repoDir, ['init', '-q', '-b', 'main']);
    fs.writeFileSync(path.join(repoDir, 'README.md'), '# UED WorkBuddy 交付仓库\n\n设计从 UED WorkBuddy 桌面版「发给前端」推进来的交付包，每个交付一个分支 `handoff/…`，目录名即项目。\n');
    git(repoDir, ['add', '-A']);
    git(repoDir, ['-c', 'user.name=UW', '-c', 'user.email=uw@local', 'commit', '-q', '-m', 'init: UED WorkBuddy交付仓库']);
  }
}

function mrUrl(remote, branch, base = 'main') {
  if (!remote) return null;
  let host = remote.replace(/\.git$/, '');
  const ssh = host.match(/^git@([^:]+):(.+)$/);
  if (ssh) host = 'https://' + ssh[1] + '/' + ssh[2];
  if (/github\.com/.test(host)) return `${host}/compare/${base}...${encodeURIComponent(branch)}?expand=1`;
  return `${host}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${encodeURIComponent(branch)}&merge_request%5Btarget_branch%5D=${base}`;
}

/**
 * @returns {{dest, zip, files, note, branch, commit, remote, mrUrl, warnings, message}}
 */
function buildHandoff({ projectDir, projectName, workspaceDir, repoDir, frontendName, author, packDir }) {
  const warnings = [];
  const files = walk(projectDir);
  if (!files.length) throw new Error('项目目录里还没有产物，先让Claude把稿子做出来。');
  const hasNote = fs.existsSync(path.join(projectDir, '交付说明.md'));
  if (!hasNote) warnings.push('项目里没有「交付说明.md」，前端只能看稿子猜。建议先点「整理交付说明」再发。');

  const id = `${stamp()}-${slug(projectName)}`;
  const outRoot = path.join(workspaceDir, '_交付');
  const dest = path.join(outRoot, id);
  fs.mkdirSync(dest, { recursive: true });
  for (const f of files) {
    const to = path.join(dest, f.rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(projectDir, f.rel), to);
  }
  const html = files.filter(f => /\.html?$/i.test(f.rel)).map(f => f.rel);
  /* 交付前把 Roboto 400/700 焊死（幂等，克隆页不碰）。预览过的页面在 files:check 那步就焊过了，
     这里管的是「做完没点开预览就直接交付」的那些——前端拿到手的每一张都得是对的。
     改的是 dest 里的副本，不动用户的项目目录。 */
  for (const rel of html) {
    const r = packDir ? feiqueFont.ensureFile(path.join(dest, rel), packDir) : { changed: false };
    if (r.changed) warnings.push(`${rel} 的 Roboto 字重原本没焊死（400 会被匹配成 Black），交付副本里已自动补上 @font-face。`);
    /* 缺省图：没点开过预览就直接交付的页面，图还是空的，这儿补上 */
    const e = packDir ? feiqueEmpty.ensureFile(path.join(dest, rel), packDir) : { changed: false, missing: [] };
    if (e.missing && e.missing.length) warnings.push(`${rel} 里的缺省图名字对不上：${e.missing.join('、')}。包里有哪些看 packs/feique/sprites/INDEX.md。`);
  }
  const entry = html.includes('index.html') ? 'index.html' : (html[0] || null);

  /* 交互流程说明：页面清单 / 跳转矩阵 / 状态清单 / 字段规则全部从代码扫出来，再合上人写的意图。
     🔴 扫的是**交付副本**不是项目目录——交付的就是这一份，说明必须描述的是它，不是它的上一版。
     多页面时前端最痛的是「这个按钮跳哪」，在稿子里翻连线翻不出来，给张表比给张图管用。 */
  let flowInfo = null;
  try {
    const fd = flow.scan(dest);
    flowInfo = flowDoc.writeInto(dest, fd, projectName);
    if (fd.n.bad) warnings.push(`流程检查有 ${fd.n.bad} 条硬伤（断链 / 说明对不上页面之类），已原样写进「交互流程说明.md」第五节——藏起来的话前端会当成设计本身照着实现。`);
    if (fd.n.pages > 1 && !fd.scripts.length) warnings.push('多页面但没有剧本，前端和评审的人只能自己猜从哪进、按什么顺序看。项目根加一个「剧本.md」写一条主线就行。');
    /* 独立走查包：对方没装 UW 也能自己点着走一遍。页面内联进去（file:// 下 iframe 跨文档访问是禁的，
       不内联就换不了状态类），所以这一份会比较大，只在真的多页面时才出。 */
    if (fd.n.pages > 1) {
      const w = flowWalk.writeInto(dest, fd, projectName);
      if (w.bytes > 12 * 1024 * 1024) warnings.push(`走查包 ${Math.round(w.bytes / 1048576)}MB，偏大（页面是整份内联进去的）。发之前先自己打开点一下。`);
    }
  } catch (e) { warnings.push('交互流程说明没生成成：' + e.message); }

  const manifest = {
    project: projectName, id, createdAt: new Date().toISOString(), by: author || os.userInfo().username,
    entry, files: files.map(f => ({ path: f.rel, bytes: f.size })),
    designSystem: '飞鹊（MIC）· 见 交付说明.md的token对照',
    note: hasNote ? '交付说明.md' : null,
    flow: flowInfo ? { doc: flowInfo.md, data: flowInfo.json, walk: fs.existsSync(path.join(dest, flowWalk.WALK_FILE)) ? flowWalk.WALK_FILE : null, 读法: '要精确解析读 flow.json，要看为什么读 交互流程说明.md，想自己点着走一遍双击 _走查.html' } : null,
    tool: 'UED WorkBuddy桌面版',
  };
  fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // zip：macOS 用自带的 ditto（保留中文文件名）；Windows 10+ 自带 bsdtar（tar.exe -a 按 .zip 后缀出 zip，文件名走 UTF-8），
  // 没有 tar 再退到 PowerShell 的 Compress-Archive（它对非 ASCII 文件名的编码取决于系统代码页，所以排后面）。
  const zip = dest + '.zip';
  try {
    if (process.platform === 'win32') {
      try { execFileSync('tar.exe', ['-a', '-c', '-f', zip, '-C', path.dirname(dest), path.basename(dest)], { windowsHide: true }); }
      catch (e1) {
        execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
          `Compress-Archive -LiteralPath '${dest.replace(/'/g, "''")}' -DestinationPath '${zip.replace(/'/g, "''")}' -Force`], { windowsHide: true });
      }
    } else {
      execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', dest, zip]);
    }
  } catch (e) { warnings.push('zip没打成：' + e.message); }

  // git 分支
  let branch = null, commit = null, remote = null, mr = null;
  try {
    ensureRepo(repoDir);
    branch = 'handoff/' + id;
    const cur = git(repoDir, ['rev-parse', '--abbrev-ref', 'HEAD'], { soft: true }) || 'main';
    git(repoDir, ['checkout', '-q', '-B', branch]);
    const target = path.join(repoDir, slug(projectName));
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true });
    for (const f of walk(dest)) {
      const to = path.join(target, f.rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(path.join(dest, f.rel), to);
    }
    git(repoDir, ['add', '-A']);
    git(repoDir, ['-c', 'user.name=' + (author || 'UW'), '-c', 'user.email=uw@local', 'commit', '-q', '--allow-empty', '-m',
      `交付：${projectName}（${files.length}个文件${hasNote ? '，含交付说明' : ''}）`]);
    commit = git(repoDir, ['rev-parse', '--short', 'HEAD']);
    remote = git(repoDir, ['remote', 'get-url', 'origin'], { soft: true }) || null;
    if (remote) {
      const r = spawnSync('git', ['push', '-u', 'origin', branch], { cwd: repoDir, encoding: 'utf8', timeout: 60000, env: loginEnv().env });
      if (r.status === 0) mr = mrUrl(remote, branch);
      else warnings.push('推送到远端失败（分支已在本地仓库里）：' + (r.stderr || '').split('\n')[0]);
    } else {
      warnings.push('交付仓库还没配远端，这次只提交到了本地仓库。在设置里给它加一个origin，下次就会自动推送并给出MR链接。');
    }
    git(repoDir, ['checkout', '-q', cur], { soft: true });
  } catch (e) {
    warnings.push('git这一步没成：' + e.message);
  }

  const who = frontendName ? `${frontendName}，` : '';
  const lines = [
    `${who}「${projectName}」的设计交付包已经准备好：`,
    entry ? `· 入口文件：${entry}（共${files.length}个文件）` : `· 共${files.length}个文件`,
    hasNote ? '· 交付说明.md里有页面结构、状态清单、飞鹊token对照和每个交互决策的原因' : '· 这次还没有交付说明，先看稿子，有问题直接找我',
    mr ? `· 合并请求：${mr}` : (branch ? `· 分支：${branch}（仓库${repoDir}）` : ''),
    fs.existsSync(zip) ? `· 压缩包：${zip}` : `· 文件夹：${dest}`,
    '· 用UED WorkBuddy桌面版「前端 → 接收交付包并还原」打开这个包，Claude会按交付说明落成组件。',
  ].filter(Boolean);

  return { dest, zip: fs.existsSync(zip) ? zip : null, files: files.length, note: hasNote, branch, commit, remote, mrUrl: mr, warnings, message: lines.join('\n') };
}

module.exports = { buildHandoff };
