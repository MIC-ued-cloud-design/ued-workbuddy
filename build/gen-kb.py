#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 MIC 业务知识 + fullstack skill 的方法论切成检索块，产出 kb.js。

kb.js 用 <script src> 引入（不是 fetch）—— fetch 在 file:// 下被 CORS 拦，
script 标签不会，这样双击本地文件也能用。页面首屏不加载它，用到 AI 才拉。

用法：python3 build/gen-kb.py
"""
import os, re, glob, json, datetime, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import _src                      # 业务知识读哪里 —— 见 build/_src.py 文件头

SK   = os.path.expanduser('~/.claude/skills/mic-fullstack')
BIZ_DIRS, BIZ_HOW = _src.biz_dirs()
OUT  = os.path.join(os.path.dirname(HERE), 'kb.js')

MAXC = 1400          # 单块最大字符
MINC = 80            # 太短的块并进上一块

EMOJI = re.compile(
    '[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F000-\U0001F0FF'
    '\U00002190-\U000021FF\U00002B00-\U00002BFF️⃣]+')


def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def s(v, lim=None):
    """任何类型压成一行可读文本"""
    if v is None:
        return ''
    if isinstance(v, str):
        t = v
    elif isinstance(v, (int, float, bool)):
        t = str(v)
    elif isinstance(v, dict):
        t = ' · '.join(f'{k}={s(x)}' for k, x in v.items() if not str(k).startswith('_'))
    elif isinstance(v, list):
        t = ' / '.join(s(x) for x in v)
    else:
        t = str(v)
    t = EMOJI.sub('', t)
    t = re.sub(r'\s+', ' ', t).strip()
    return t[:lim] if lim else t


def strip_fm(t):
    m = re.match(r'---\n.*?\n---\n', t, re.S)
    return t[m.end():] if m else t


def norm(t):
    t = EMOJI.sub('', t)
    t = re.sub(r'\n{3,}', '\n\n', t)
    t = re.sub(r'[ \t]{2,}', ' ', t)
    return t.strip()


def split_doc(name, text, src):
    """按标题切；标题下内容过长再按段落切"""
    text = norm(strip_fm(text))
    if not text:
        return []
    # 记录标题层级路径
    blocks, path, buf = [], [], []

    def flush(hp):
        if not buf:
            return
        body = '\n'.join(buf).strip()
        if body:
            blocks.append((' › '.join(hp) if hp else '', body))

    for line in text.split('\n'):
        h = re.match(r'^(#{1,4})\s*(.+)$', line)
        if h:
            flush(list(path))
            buf = []
            lvl = len(h.group(1))
            title = re.sub(r'\s+', ' ', h.group(2)).strip()
            path = path[:lvl - 1] + [title]
        else:
            buf.append(line)
    flush(list(path))

    out = []
    for title, body in blocks:
        if len(body) <= MAXC:
            out.append((title, body))
            continue
        # 过长：按空行分段累积
        cur = []
        n = 0
        for para in body.split('\n\n'):
            if n + len(para) > MAXC and cur:
                out.append((title, '\n\n'.join(cur)))
                cur, n = [], 0
            cur.append(para)
            n += len(para) + 2
        if cur:
            out.append((title, '\n\n'.join(cur)))

    # 太短的并进前一块
    merged = []
    for title, body in out:
        if merged and len(body) < MINC and merged[-1][0] == title:
            merged[-1] = (title, merged[-1][1] + '\n' + body)
        else:
            merged.append((title, body))

    return [{'d': name, 't': t, 'x': b, 's': src} for t, b in merged if b.strip()]


# ─────────── 组件字段归一化 ───────────
# 🔴 Web 端和移动端两份清册的字段名完全不同：
#   Web:  page / nodeId / variantCount / defaultVariant / sample / criticalNote
#   移动: 页   / id     / v            / props(字符串)  / 「🔴🔴 最要紧的一条」(emoji 当键名)
# 原来只认 Web 那套，导致移动端 72/72 个组件的 variant 数和坑注解全部丢失。
# 所以不再挑字段 —— 认几个别名，其余一律「键名: 值」原样带上，
# 下次再来一份新格式的清册也不会静默丢数据。
ALIAS = {
    'page':   ['page', '页', '所在页'],
    'node':   ['nodeId', 'id', '节点', 'node'],
    'key':    ['key', 'componentKey'],
    'vcount': ['variantCount', 'v', 'variants', '变体数'],
    'defv':   ['defaultVariant', 'default', '默认'],
    'props':  ['props', '属性'],
    'sample': ['sample', '尺寸', 'size'],
}
SKIP_KEYS = {'__note', '_note'}


def pick(c, slot):
    for k in ALIAS[slot]:
        if k in c and c[k] not in (None, '', [], {}):
            return c[k]
    return None


def rest_fields(c):
    """除了别名认走的，其余字段一律带上（键名清洗掉 emoji）"""
    taken = set()
    for names in ALIAS.values():
        taken.update(names)
    out = []
    for k, v in c.items():
        if k in taken or k in SKIP_KEYS or str(k).startswith('__'):
            continue
        kk = EMOJI.sub('', str(k)).strip(' ·—-')   # gen-kb 里没有 clean()，两边都有 EMOJI
        if not kk:
            continue
        out.append((kk, v))
    return out


# ─────────── 结构化资产也要能被检索到 ───────────
# 组件真名 / key / 状态数 / token 值 / 自查表 —— 这些是同事最常问的，
# 但它们是 JSON 不是 md，之前只进了资料库界面、没进检索语料，
# 于是「飞鹊按钮组件叫什么」检索不到，命中的全是无关的经验文档。
def json_chunks():
    out = []

    def one(name, title, body, src='asset'):
        if body.strip():
            out.append({'d': name, 't': title, 'x': body.strip(), 's': src})

    for path, label in [('assets/feique-component-catalog.json', '飞鹊组件库 Web 端'),
                        ('assets/feique-mobile-component-catalog.json', '飞鹊组件库 移动端')]:
        d = load(os.path.join(SK, path))

        # 清册按英文组件名建，同事问的是中文口语名（问「按钮」查不到 button）。
        # nameLookup 那张表补的就是这一层，这里把它反过来，把中文别名写进组件块本身。
        alias = {}
        for zh, info in (d.get('nameLookup') or {}).items():
            if zh.startswith('_') or not isinstance(info, dict):
                continue
            names = [x.strip() for x in re.split(r'[/／]', zh) if x.strip()]
            for cand in (info.get('候选') or []):
                cn = (cand or {}).get('组件')
                if cn:
                    alias.setdefault(cn.strip().strip('*'), []).extend(names)

        for cname, c in (d.get('components') or {}).items():
            if cname.startswith('_') or not isinstance(c, dict):
                continue
            lines = ['组件真名：' + cname]
            al = alias.get(cname.strip().strip('*')) or []
            if al:
                seen_al = []
                for a in al:
                    if a not in seen_al:
                        seen_al.append(a)
                lines.append('中文常叫法：' + ' / '.join(seen_al))
            if pick(c, 'page'):   lines.append('所在页：' + s(pick(c, 'page')))
            if pick(c, 'vcount'): lines.append('状态（variant）总数：' + s(pick(c, 'vcount')))
            if pick(c, 'defv'):   lines.append('默认状态：' + s(pick(c, 'defv')))
            if pick(c, 'key'):    lines.append('组件 key（import 用）：' + s(pick(c, 'key')))
            if pick(c, 'node'):   lines.append('节点 id：' + s(pick(c, 'node')))
            pr = pick(c, 'props')
            if isinstance(pr, dict) and pr:
                lines.append('可选属性：')
                for k, v in pr.items():
                    lines.append('  - ' + k + '：' + s(v, 500))
            elif pr:
                lines.append('可选属性：' + s(pr, 900))
            if pick(c, 'sample'): lines.append('尺寸与构造：' + s(pick(c, 'sample'), 900))
            for kk, vv in rest_fields(c):
                lines.append(kk + '：' + s(vv, 900))
            one(label, cname, '\n'.join(lines))

        for key, label2 in [('nameLookup', '名字对照（想找的东西在飞鹊叫什么）'),
                            ('_variantNameTraps', '状态命名的坑'),
                            ('webVsMobile', 'Web 端与移动端的差异'),
                            ('_statesReference', '状态参考'),
                            ('_blindSpots', '这份清册查不到的东西')]:
            o = d.get(key) or {}
            if isinstance(o, dict) and o:
                body = '\n'.join('- ' + k + '：' + s(v, 600) for k, v in o.items() if not k.startswith('__'))
                one(label, label2, body)

    # token
    # 🔴 原来直接转储 JSON，模型看到 18 / 24 / 36 一堆数字会选错
    #    （实测把「Web 端正文最大 18」答成了 24 —— 24 是标题级）。
    #    改成一句话说清「哪个数管哪件事」，字号这类最容易搞混的写成明确陈述。
    tk = load(os.path.join(SK, 'assets/feique-tokens.json'))

    fs = tk.get('fontSize') or {}
    web, mob = fs.get('web') or {}, fs.get('mobile') or {}
    lines = []
    if web.get('bodyMax'):
        lines.append(f"Web 端正文（body）字号最大是 {web['bodyMax']}px。"
                     f"比它大的 22 / 24 / 32 / 36 属于标题级（heading4 / heading3 / heading2 / heading1），"
                     f"是合法字号，但不是正文级 —— 问「正文最大多少」答案就是 {web['bodyMax']}，不要答 24 或 36。")
    if web.get('scale'):
        lines.append('Web 端完整字号阶梯：' + ' / '.join(str(x) for x in web['scale']) + '（单位 px）。禁用奇数，就近取偶。')
    if mob.get('scale'):
        lines.append('移动端字号阶梯：' + ' / '.join(str(x) for x in mob['scale']) + '（单位 px）。移动端正文主力是 16。')
    if web.get('note'):
        lines.append('原始说明：' + s(web['note'], 600))
    lines.append('文字样式（text style）层只有 400 和 700 两档字重。Medium / SemiBold 是没绑样式的硬编码，不算 token。')
    one('飞鹊视觉规范 token', '字号', '\n'.join(lines))

    sp = tk.get('spacing') or {}
    rd = tk.get('radius') or {}
    one('飞鹊视觉规范 token', '间距与圆角',
        (f"间距阶梯：{' / '.join(str(x) for x in sp.get('scale', []))}（单位 px，4px 一档）。\n"
         f"圆角阶梯：{' / '.join(str(x) for x in rd.get('scale', []))}（单位 px）。"))

    sh_lines = []
    for k, v in (tk.get('shadow') or {}).items():
        if k.startswith('_') or not isinstance(v, dict):
            continue
        sh_lines.append(f"{k}：{s(v.get('meaning'))}\n  CSS：{s(v.get('css'))}")
    if sh_lines:
        sh_lines.append('三级都是三层叠加，纯黑，横向偏移一律 0。')
        one('飞鹊视觉规范 token', '阴影', '\n'.join(sh_lines))

    # 颜色和样式 ID 是查表性质的，保留结构化形态
    for sec, label in [('color', '颜色'), ('figmaStyles', 'Figma 样式与样式 ID'),
                       ('spacingSemantics', '间距的语义用法')]:
        v = tk.get(sec)
        if v:
            one('飞鹊视觉规范 token', label, sec + '：\n' + json.dumps(v, ensure_ascii=False, indent=1)[:5000])

    # 交互自查表：整段原文进检索（按范围切）
    cp = os.path.join(SK, 'sub-skills/MIC-交互/assets/UED交互自查表.md')
    if os.path.exists(cp):
        out.extend(split_doc('UED 交互自查表', open(cp, encoding='utf-8').read(), 'asset'))

    print(f'  结构化资产          → {len(out):5d} 块')
    return out


def collect():
    chunks = []

    # ① MIC 业务知识（正文）
    files = _src.biz_files(BIZ_DIRS)
    for f in files:
        n = os.path.basename(f)[:-3]
        chunks += split_doc(n, open(f, encoding='utf-8').read(), 'biz')
    nbiz = len(chunks)
    print(f'  业务知识  {len(files):3d} 份 → {nbiz:5d} 块   [来源：{BIZ_HOW}]')

    # ② fullstack skill 的方法论与判据
    k = len(chunks)
    for f in sorted(glob.glob(os.path.join(SK, 'memory-refs/*.md'))):
        n = os.path.basename(f)[:-3]
        if n.startswith('_'):
            continue
        chunks += split_doc(n, open(f, encoding='utf-8').read(), 'method')
    print(f'  方法论    {len(glob.glob(os.path.join(SK, "memory-refs/*.md"))):3d} 份 → {len(chunks)-k:5d} 块')

    # ③ 各专项子 skill 的做法
    k = len(chunks)
    for f in sorted(glob.glob(os.path.join(SK, 'sub-skills/*/SKILL.md'))):
        n = os.path.basename(os.path.dirname(f))
        chunks += split_doc(n, open(f, encoding='utf-8').read(), 'skill')
    print(f'  子 skill   {len(glob.glob(os.path.join(SK, "sub-skills/*/SKILL.md"))):2d} 份 → {len(chunks)-k:5d} 块')

    # ④ 主 skill 路由器本身（bundle 表、北极星、三件套都在里面）
    k = len(chunks)
    main = os.path.join(SK, 'SKILL.md')
    if os.path.exists(main):
        chunks += split_doc('mic-fullstack 总则', open(main, encoding='utf-8').read(), 'skill')
    print(f'  主 skill      1 份 → {len(chunks)-k:5d} 块')

    chunks += json_chunks()

    return chunks


def build_dict(chunks):
    """实体词 → 块下标。有唯一正确答案的问题不该走模糊匹配。

    「飞鹊按钮叫什么」「正文字号最大多少」这类问题，答案就在某一个特定块里。
    纯词面打分永远调不准（试过三轮，每次修好一个破另一个），
    所以先用这张字典把该命中的块钉在最前面，剩下的预算再交给模糊检索。
    """
    idx = {}
    for i, c in enumerate(chunks):
        if c['s'] != 'asset':
            continue
        t = (c['t'] or '').strip()
        if not t:
            continue
        keys = []
        # 组件真名 + 中文常叫法
        m = re.search(r'中文常叫法：(.+)', c['x'])
        if m:
            keys += [x.strip() for x in m.group(1).split('/') if x.strip()]
        keys.append(t)
        # token 小节名（颜色 / 字号 / 间距 / 圆角 / 阴影 / Figma 样式…）
        for k in keys:
            k = k.lower().strip()
            if len(k) < 2:
                continue
            idx.setdefault(k, [])
            if i not in idx[k]:
                idx[k].append(i)
    # 手工补几个高频问法，指向已有的块
    def find_doc(doc):
        """没给小节名时，取这份文档第一个够长的块（通常是开头的总述）"""
        for i, c in enumerate(chunks):
            if c['d'] == doc and len(c['x']) > 200:
                return i
        for i, c in enumerate(chunks):
            if c['d'] == doc:
                return i
        return None

    def find(doc, title_has):
        for i, c in enumerate(chunks):
            if c['d'] == doc and title_has in (c['t'] or ''):
                return i
        return None
    # 方法类和业务类的高频问法，同样走字典，不靠模糊打分碰运气
    manual = {
        '状态枚举': ('mic-fullstack 总则', '交互思维三件套'),
        '枚举': ('mic-fullstack 总则', '交互思维三件套'),
        '哪些状态': ('mic-fullstack 总则', '交互思维三件套'),
        '极限值': ('mic-fullstack 总则', '交互思维三件套'),
        '要画哪些状态': ('mic-fullstack 总则', '交互思维三件套'),
        '空态': ('mic-fullstack 总则', '交互思维三件套'),
        '用户走查': ('mic-fullstack 总则', '交互思维三件套'),
        '痛点': ('mic-biz-users-research-p1', ''),
        '用研': ('mic-biz-users-research-p1', ''),
        '占比': ('mic-biz-users-research-p1', ''),
        '用户研究': ('mic-biz-users-research-p1', ''),
        '自查表': ('UED 交互自查表', '双向用法'),
        '交互自查': ('UED 交互自查表', '双向用法'),
        '交付规范': ('MIC-交付规范', ''),
        '交给前端': ('MIC-交付规范', ''),
        '验收': ('MIC-验收', ''),
        '走查': ('MIC-验收', ''),
        '北极星': ('mic-fullstack 总则', '北极星'),
        '决策优先级': ('mic-fullstack 总则', '北极星'),
        '说人话': ('MIC-表达', ''),
        '字号': ('飞鹊视觉规范 token', '字号'), '字体大小': ('飞鹊视觉规范 token', '字号'),
        '正文字号': ('飞鹊视觉规范 token', '字号'), '颜色': ('飞鹊视觉规范 token', '颜色'),
        '色值': ('飞鹊视觉规范 token', '颜色'), '主色': ('飞鹊视觉规范 token', '颜色'),
        '间距': ('飞鹊视觉规范 token', '间距'), '圆角': ('飞鹊视觉规范 token', '圆角'),
        '阴影': ('飞鹊视觉规范 token', '阴影'), '样式id': ('飞鹊视觉规范 token', 'Figma 样式'),
        'token': ('飞鹊视觉规范 token', '颜色'),
    }
    for k, (doc, th) in manual.items():
        i = find(doc, th) if th else find_doc(doc)
        if i is not None:
            idx.setdefault(k, [])
            if i not in idx[k]:
                idx[k].append(i)
    print(f'  实体字典            → {len(idx):5d} 个词')
    return idx


def main():
    print('══ 切检索块 ══')
    chunks = collect()
    chars = sum(len(c['x']) for c in chunks)
    docs = len(set(c['d'] for c in chunks))

    payload = {
        'gen': datetime.date.today().isoformat(),
        'docs': docs, 'chunks': len(chunks), 'chars': chars,
        'by': {k: sum(1 for c in chunks if c['s'] == k) for k in ('biz', 'method', 'skill', 'asset')},
        'dict': build_dict(chunks),
        'c': chunks,
    }
    # 🔴 用 self 不用 window —— 这份文件会被 Worker 的 importScripts 加载，
    #    Worker 里没有 window（全局叫 self），写 window 会抛 ReferenceError，
    #    表现是「Worker 静默回退到主线程」，1.7 秒的冻结照旧存在。
    #    主线程里 self === window，所以一处写法两边都对。
    js = ('/* MIC WorkBuddy 知识库 · 由 build/gen-kb.py 生成，勿手改 */\n'
          'self.WBKB=' + json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + ';\n')
    open(OUT, 'w', encoding='utf-8').write(js)

    print(f'\n══ 完成 ══')
    print(f'  {docs} 份文档 · {len(chunks)} 块 · {chars/10000:.1f} 万字')
    print(f'  kb.js {os.path.getsize(OUT)/1048576:.2f} MB')
    print(f'  平均块长 {chars//max(len(chunks),1)} 字符')
    longest = max(chunks, key=lambda c: len(c['x']))
    print(f'  最长块 {len(longest["x"])} 字符（{longest["d"]}）')


if __name__ == '__main__':
    main()
