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
const { loginEnv } = require('./shellenv');   // GUI启动只有最小PATH：git的凭据助手、公司代理变量都得从登录shell拿

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
function buildHandoff({ projectDir, projectName, workspaceDir, repoDir, frontendName, author }) {
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
  const entry = html.includes('index.html') ? 'index.html' : (html[0] || null);
  const manifest = {
    project: projectName, id, createdAt: new Date().toISOString(), by: author || os.userInfo().username,
    entry, files: files.map(f => ({ path: f.rel, bytes: f.size })),
    designSystem: '飞鹊（MIC）· 见 交付说明.md的token对照',
    note: hasNote ? '交付说明.md' : null,
    tool: 'UED WorkBuddy桌面版',
  };
  fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // zip（macOS 自带 ditto，保留中文文件名）
  const zip = dest + '.zip';
  try { execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', dest, zip]); }
  catch (e) { warnings.push('zip没打成：' + e.message); }

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
