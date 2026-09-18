'use strict';
/**
 * UED WorkBuddy 桌面版 · 登录 shell 环境探针
 *
 * 治什么（2026-09-10 同事机器上暴露）：
 *   从访达/程序坞启动的 Mac 应用，PATH 只有 `/usr/bin:/bin:/usr/sbin:/sbin` —— launchd 给的最小集，
 *   跟用户在终端里的 PATH 完全是两回事。后果是链式的：
 *     · 公司 FCF 的 `claude` 是个 bash 脚本，内部要跑 `npm root -g`；这个 PATH 下没有 npm，
 *       它打一句「FCF wrapper not found」就 exit 1，检测直接失败 → 同事看到「没找到Claude Code」。
 *     · nvm / volta / fnm 装的 claude 也全都不在这个 PATH 上。
 *     · git 的 credential helper、公司代理变量（HTTP_PROXY 等）同样拿不到。
 *   开发机上一直没暴露，是因为我从终端 `npm start` 起的应用，继承了完整 PATH。
 *
 * 修法：问用户的登录 shell 要一份真实环境，检测 Claude、拉起 Claude、跑 git 全用它。
 *
 * 实测判据：
 *   · 必须用**交互式**登录 shell（`-i -l -c`）。zsh 只在交互式时读 .zshrc，
 *     而 nvm / FCF / 各种 PATH 追加绝大多数写在 .zshrc 里 —— 只用 `-l -c` 会漏掉。
 *   · rc 文件会往 stdout 打东西（主题、横幅、fortune），所以用前后两个哨兵夹住再取中间，
 *     不能直接读 stdout。
 *   · GUI 启动时 `SHELL` 可能压根没有，要用 `dscl` 去问账户的登录 shell。
 *
 * Windows（2026-09-17 加）：
 *   · 没有「登录 shell」这一层：从开始菜单起的进程拿到的就是用户级 + 机器级环境变量合出来的完整 PATH，
 *     跟在 PowerShell 里敲一样，所以**不探 shell**，直接用 process.env，只把常见安装目录垫在后面兜底。
 *   · PATH 分隔符是 `;`，键名可能是 `Path`（Windows 环境变量名不分大小写，但 JS 对象分）。
 *   · 可执行文件要带扩展名（PATHEXT：.EXE / .CMD / .BAT …），`fs.accessSync(X_OK)` 在 Windows 上没有意义。
 */
const { spawnSync } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

const A = '__UW_ENV_BEGIN__';
const B = '__UW_ENV_END__';
/* 写成函数不写成常量：测试要在 Mac 上假装成 Windows 跑一遍 Windows 分支 */
const isWin = () => process.platform === 'win32';
const SEP = () => (isWin() ? ';' : ':');

/* 这些不从登录 shell 带进来：要么是 shell 自己的临时状态，要么会干扰子进程 */
const DENY = new Set([
  'PWD', 'OLDPWD', 'SHLVL', '_', 'TERM', 'COLORTERM', 'LINES', 'COLUMNS',
  'TERM_PROGRAM', 'TERM_PROGRAM_VERSION', 'TERM_SESSION_ID', 'ITERM_SESSION_ID', 'ITERM_PROFILE',
  'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT',
]);

/* Windows 上 process.env 的 PATH 键可能叫 Path / PATH / path；改的时候要改同一个键，不然 spawn 会拿到两份 */
function pathKey(env) { return Object.keys(env).find(k => k.toUpperCase() === 'PATH') || 'PATH'; }
function getPath(env) { return env[pathKey(env)] || ''; }

/* 登录 shell 拿不到时的兜底目录：常见的包管理器与版本管理器装可执行文件的地方 */
function fallbackDirs() {
  const h = os.homedir();
  let dirs;
  if (isWin()) {
    const e = process.env;
    const j = (...p) => path.join(...p.filter(Boolean));   // 真 Windows 上 path.join 就是 win32 的；不写 path.win32 是为了让门能在 Mac 上假装成 Windows 跑一遍
    dirs = [
      j(h, '.local', 'bin'),                                   // Claude Code 原生安装器（install.ps1）装在这
      j(e.APPDATA, 'npm'),                                     // npm -g 装的 claude.cmd
      j(h, '.fcf', 'bin'),                                     // 公司 FCF 启动器（如果 Windows 版也装这）
      j(e.ProgramFiles, 'nodejs'), j(e['ProgramFiles(x86)'], 'nodejs'),
      j(e.NVM_SYMLINK), j(e.NVM_HOME),                         // nvm-windows
      j(e.LOCALAPPDATA, 'pnpm'), j(e.LOCALAPPDATA, 'Volta', 'bin'), j(h, '.volta', 'bin'),
      j(h, '.bun', 'bin'), j(e.LOCALAPPDATA, 'Yarn', 'bin'), j(h, 'scoop', 'shims'),
      j(e.ProgramFiles, 'Git', 'cmd'), j(e.ProgramFiles, 'Git', 'bin'),   // 交付要跑 git
      j(e.LOCALAPPDATA, 'Programs', 'Git', 'cmd'),
    ].filter(Boolean);
  } else {
    dirs = [
      '/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', '/usr/local/sbin',
      `${h}/.fcf/bin`, `${h}/.local/bin`, `${h}/bin`,
      `${h}/.volta/bin`, `${h}/.bun/bin`, `${h}/.deno/bin`, `${h}/.cargo/bin`,
      `${h}/Library/pnpm`, `${h}/.npm-global/bin`, `${h}/.yarn/bin`,
      `${h}/.claude/local`,
    ];
    /* nvm / fnm 可能装了好几个 node 版本，全列上，新的在前 */
    for (const base of [`${h}/.nvm/versions/node`, `${h}/.local/state/fnm_multishells`, `${h}/Library/Application Support/fnm/node-versions`]) {
      try {
        const vs = fs.readdirSync(base).sort().reverse();
        for (const v of vs) dirs.push(`${base}/${v}/bin`, `${base}/${v}/installation/bin`);
      } catch (e) {}
    }
  }
  return dirs.filter(d => { try { return fs.statSync(d).isDirectory(); } catch (e) { return false; } });
}

/** 这台机器上这个账户的登录 shell（GUI 启动时 process.env.SHELL 常常是空的）。Windows 没有这一层，返回 null。 */
function loginShell() {
  if (isWin()) return null;
  if (process.env.SHELL && fs.existsSync(process.env.SHELL)) return process.env.SHELL;
  try {
    const r = spawnSync('/usr/bin/dscl', ['.', '-read', `/Users/${os.userInfo().username}`, 'UserShell'],
      { encoding: 'utf8', timeout: 5000 });
    const m = String(r.stdout || '').match(/UserShell:\s*(\S+)/);
    if (m && fs.existsSync(m[1])) return m[1];
  } catch (e) {}
  return fs.existsSync('/bin/zsh') ? '/bin/zsh' : '/bin/bash';
}

/** 跑一次登录 shell，把它的整份 env 抓回来。失败返回 null。 */
function probeOnce(shell, flags, timeout) {
  const cmd = `printf '%s' ${A}; /usr/bin/env; printf '%s' ${B}`;
  let r;
  try {
    r = spawnSync(shell, [...flags, '-c', cmd], {
      encoding: 'utf8', timeout: timeout || 8000,
      /* 不给 TERM：让 p10k instant prompt / oh-my-zsh 这类装饰走「非终端」分支，少打点东西 */
      env: { ...process.env, TERM: 'dumb', UW_ENV_PROBE: '1' },
    });
  } catch (e) { return null; }
  const out = String(r.stdout || '');
  const i = out.indexOf(A), j = out.lastIndexOf(B);
  if (i < 0 || j < 0 || j <= i) return null;
  const body = out.slice(i + A.length, j);
  const env = {};
  let key = null;
  for (const line of body.split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) { key = m[1]; env[key] = m[2]; }
    else if (key) env[key] += '\n' + line;   // env 里的多行值（例如 SSH key、函数）接上去
  }
  return Object.keys(env).length ? env : null;
}

function mergePath(...lists) {
  const seen = new Set(), out = [];
  const norm = d => (isWin() ? d.toLowerCase().replace(/[\\/]+$/, '') : d);   // Windows 路径不分大小写，别把 C:\x 和 c:\x 算两条
  for (const l of lists) for (const d of String(l || '').split(SEP())) {
    if (d && !seen.has(norm(d))) { seen.add(norm(d)); out.push(d); }
  }
  return out.join(SEP());
}

let cached = null;

/**
 * 合并后的环境：以当前进程 env 为底，登录 shell 的值补进来（PATH 一定用登录 shell 的，排在前面）。
 * 只探一次，结果缓存整个应用生命周期。
 * Windows：不探 shell，process.env 就是完整环境，只把兜底目录垫在 PATH 末尾。
 * @returns {{env: object, info: object}}
 */
function loginEnv(force) {
  if (cached && !force) return cached;
  const t0 = Date.now();
  const shell = loginShell();
  let raw = null, source = null;

  /* 先交互式登录（能读到 .zshrc，nvm/FCF 基本都在那儿），不行再退回纯登录。
     总预算封在 ~16s：同事的 rc 文件可能很重，但应用不能开机就干等，超了就走兜底目录。 */
  if (shell) {
    for (const [flags, tag, ms] of [[['-i', '-l'], 'interactive-login', 8000], [['-l'], 'login', 5000], [[], 'plain', 3000]]) {
      if (Date.now() - t0 > 16000) break;
      raw = probeOnce(shell, flags, ms);
      if (raw && raw.PATH) { source = tag; break; }
      raw = null;
    }
  }

  const env = { ...process.env };
  if (raw) {
    for (const [k, v] of Object.entries(raw)) {
      if (k === 'PATH' || DENY.has(k)) continue;
      if (env[k] === undefined) env[k] = v;      // 只补缺，不覆盖 Electron 自己那份
    }
  }
  /* 兜底目录永远垫在最后：登录 shell 探成功也留着，同事的 rc 写得不全时还有一层 */
  const pk = pathKey(env);
  env[pk] = mergePath(raw && raw.PATH, getPath(process.env), fallbackDirs().join(SEP()));

  cached = {
    env,
    info: {
      shell: shell || (isWin() ? 'windows（不探shell，直接用进程环境）' : null),
      source: source || (isWin() ? 'process-env' : 'fallback-only'), ms: Date.now() - t0,
      pathDirs: env[pk].split(SEP()).length,
      gotLoginPath: isWin() ? !!getPath(process.env) : !!(raw && raw.PATH),
      guiMinimalPath: !isWin() && /^\/usr\/bin:\/bin:\/usr\/sbin:\/sbin\/?$/.test(String(process.env.PATH || '')),
      path: env[pk],
    },
  };
  return cached;
}

/** Windows 上可执行文件的扩展名候选：PATHEXT 有就用它，没有就用系统默认那几个 */
function winExts() {
  const raw = String(process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').map(s => s.trim()).filter(Boolean);
  /* .EXE / .CMD 排前面：npm 装的是 claude.cmd，原生安装器装的是 claude.exe，这两种最常见 */
  const order = ['.EXE', '.CMD', '.BAT', '.COM'];
  return [...order.filter(x => raw.map(r => r.toUpperCase()).includes(x)), ...raw.filter(r => !order.includes(r.toUpperCase()))];
}

/** 在合并后的 PATH 里找一个可执行文件，返回所有命中（按 PATH 顺序）。Windows 上带上 PATHEXT 的扩展名去找。 */
function whichAll(name) {
  const { env } = loginEnv();
  const out = [];
  for (const d of getPath(env).split(SEP())) {
    if (!d) continue;
    if (isWin()) {
      const names = /\.[a-z0-9]{2,4}$/i.test(name) ? [name] : winExts().map(x => name + x.toLowerCase());
      for (const n of names) {
        const p = path.join(d, n);
        try { if (fs.statSync(p).isFile() && !out.includes(p)) out.push(p); } catch (e) {}
      }
    } else {
      const p = `${d}/${name}`;
      try { fs.accessSync(p, fs.constants.X_OK); if (!out.includes(p)) out.push(p); } catch (e) {}
    }
  }
  return out;
}

module.exports = { loginEnv, whichAll, fallbackDirs, mergePath, pathKey, winExts, isWin, _resetCache: () => { cached = null; } };
