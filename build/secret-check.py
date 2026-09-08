#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""提交前扫一遍：仓库里有没有混进密钥。

为什么要有这道门：这个仓库是**公开**的（免费 GitHub Pages 的硬要求），
一旦密钥进了某次提交，就算下一次删掉，它也永远留在 git 历史里、能被任何人翻出来。
唯一的补救是重置密钥，所以这件事只能事前拦，不能事后改。

两层：
  ① 值指纹层  已知的几个密钥，存 sha256（不存明文 —— 这份文件自己也在公开仓库里）。
              扫出文件里所有像密钥的字符串，逐个算哈希对比。
              好处是不管你把它写在什么变量名下、写在注释里还是写在文档里，都逃不掉。
  ② 形态层    「secret / token / key / password 后面跟一个长随机串」这种写法，
              不管值是不是已知的都报。防的是以后新加的、还没登记进指纹层的密钥。

用法：python3 build/secret-check.py      （退出码非 0 就是有问题，别提交）
新增一个要防的密钥：
    python3 -c "import hashlib;print(hashlib.sha256(b'密钥值').hexdigest())"
    把结果加进下面 KNOWN。
"""
import hashlib, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# 已知密钥的 sha256。明文一个都不许写在这里。
KNOWN = {
    '89e0a9cc289baa7cfdc0bbcb440fdf090ddb33d8fc4141e02c828077d5b7201d': '飞书 App Secret',
    '3e751fd805fd2a79d1036d999db8359020401bdadce3984734751860e1e5d6e3': '飞书 App ID',
}

# 像密钥的字符串：16 位以上的字母数字（含 - _），排除纯数字和纯字母
CANDIDATE = re.compile(r'[A-Za-z0-9_\-]{16,80}')
# 形态层：secret/token/key/password/pass 后面直接跟一个长串
SHAPE = re.compile(
    r'''(secret|token|api[_-]?key|password|passwd|\bpass\b)\s*[:=]\s*['"]([A-Za-z0-9_\-]{20,})['"]''',
    re.I)

# 这些不扫：生成的大文件、二进制、以及门自己（它存的是哈希不是明文）
SKIP_NAMES = {'kb.js', 'secret-check.py'}
SKIP_EXT = {'.png', '.jpg', '.jpeg', '.svg', '.ico', '.woff', '.woff2', '.gz', '.zip'}


def tracked():
    """只扫 git 管着的文件 —— 会进公开仓库的就是这些。
    未跟踪的文件不扫（临时文件放密钥是允许的，只要它不进仓）。"""
    out = subprocess.run(['git', 'ls-files'], cwd=ROOT, capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit('这里不是 git 仓库？' + out.stderr.strip())
    return [f for f in out.stdout.splitlines() if f]


def main():
    hits = []
    scanned = 0
    for rel in tracked():
        if os.path.basename(rel) in SKIP_NAMES: continue
        if os.path.splitext(rel)[1].lower() in SKIP_EXT: continue
        path = os.path.join(ROOT, rel)
        try:
            text = open(path, encoding='utf-8', errors='ignore').read()
        except (IsADirectoryError, FileNotFoundError):
            continue
        scanned += 1

        # ① 值指纹
        for tok in set(CANDIDATE.findall(text)):
            h = hashlib.sha256(tok.encode()).hexdigest()
            if h in KNOWN:
                line = text[:text.index(tok)].count('\n') + 1
                hits.append('%s:%d  混进了【%s】的明文' % (rel, line, KNOWN[h]))

        # ② 形态层
        for m in SHAPE.finditer(text):
            val = m.group(2)
            # 明显的占位符放行
            if re.fullmatch(r'(?i)(x{4,}|你的.*|请填.*|your[_-]?.*|placeholder.*|test[_-].*|.*example.*)', val):
                continue
            if val.startswith('test-only-'):        # 自测用的假密钥
                continue
            line = text[:m.start()].count('\n') + 1
            hits.append('%s:%d  像是把密钥写死了：%s = "%s…"' % (rel, line, m.group(1), val[:6]))

    if hits:
        print('❌ 不能提交 —— 扫到 %d 处：' % len(hits))
        for h in hits: print('   ' + h)
        print('\n密钥只能放 Netlify 控制台的环境变量里。')
        print('如果这是误报（比如占位符），改一下写法或者在 build/secret-check.py 里加豁免，')
        print('🔴 别把豁免写成「跳过这个文件」—— 那等于把门关了。')
        return 1

    print('✅ 密钥门：扫了 %d 个入库文件，没有明文密钥' % scanned)
    print('   （防的是 %d 个已登记的值 + 「变量名带 secret/key/token 且值是长随机串」这种写法）' % len(KNOWN))
    return 0


if __name__ == '__main__':
    sys.exit(main())
