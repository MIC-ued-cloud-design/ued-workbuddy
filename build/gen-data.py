#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 mic-fullstack skill 的真实资产生成 WorkBuddy 页面用的数据块，注入 index.html。

单一维护源：数据的正本是 skill 里那几个文件，本脚本只做搬运和裁剪。
skill 更新后重跑本脚本即可同步，不要手改 index.html 里两个标记之间的内容。

用法：python3 build/gen-data.py
"""
import json, re, os, sys, glob, datetime

SK   = os.path.expanduser('~/.claude/skills/mic-fullstack')
HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = os.path.join(os.path.dirname(HERE), 'index.html')

BEGIN = '/* ==FQ-DATA:BEGIN== 由 build/gen-data.py 生成，勿手改 == */'
END   = '/* ==FQ-DATA:END== */'


# 界面上不出现内部记法：emoji / 标记符号一律剥掉（MIC-表达：产品界面跟对外文稿同一套判据）。
# 🔴 本来承载「严重程度」这个信息，所以不是直接丢 —— 剥掉符号，同时回传一个 hi 等级，
# 由页面用文字标签表达，别让读者去认颜色圆点。
EMOJI = re.compile(
    '[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F000-\U0001F0FF'
    '\U00002190-\U000021FF\U00002B00-\U00002BFF\uFE0F\u20E3\u2122\u2139]+')


def clean(t):
    """剥掉 emoji 与内部标记，返回 (干净文本, 重点等级)"""
    t = '' if t is None else str(t)
    hi = t.count('🔴')
    t = EMOJI.sub('', t)
    t = t.replace('【', '（').replace('】', '）')
    t = re.sub(r'\s*·\s*$', '', t)
    t = re.sub(r'\s{2,}', ' ', t).strip(' ·—-')
    return t, (2 if hi >= 2 else 1 if hi == 1 else 0)


def die(msg):
    print('❌ ' + msg); sys.exit(1)


def load(p):
    if not os.path.exists(p):
        die('找不到数据源：' + p)
    with open(p, encoding='utf-8') as f:
        return json.load(f)


# ─────────────────────────── 图标 295 个 ───────────────────────────
def build_icons():
    out, vbox = {}, {}
    files = sorted(glob.glob(os.path.join(SK, 'assets/svg/*.svg')))
    if not files:
        die('assets/svg/ 里没有 SVG')
    for p in files:
        name = os.path.basename(p)[:-4]
        s = open(p, encoding='utf-8').read()
        m = re.search(r'viewBox="([^"]+)"', s)
        vb = (m.group(1) if m else '0 0 16 16').strip()
        if vb != '0 0 16 16':
            vbox[name] = vb
        # 只取 <svg> 内部
        inner = re.sub(r'^.*?<svg[^>]*>', '', s, flags=re.S)
        inner = re.sub(r'</svg>\s*$', '', inner, flags=re.S)
        inner = re.sub(r'<!--.*?-->', '', inner, flags=re.S)
        # 死色换 currentColor，保留 fill="none"
        inner = re.sub(r'fill="#[0-9A-Fa-f]{3,8}"', 'fill="currentColor"', inner)
        inner = re.sub(r'stroke="#[0-9A-Fa-f]{3,8}"', 'stroke="currentColor"', inner)
        inner = re.sub(r'\s*\n\s*', '', inner).strip()
        out[name] = inner
    return out, vbox


# ─────────────────────────── 组件清册 ───────────────────────────
def s(v, lim=None):
    """任何类型压成一行字符串"""
    if v is None:
        return ''
    if isinstance(v, str):
        t = v
    elif isinstance(v, (int, float, bool)):
        t = str(v)
    elif isinstance(v, dict):
        t = ' · '.join(f'{k}={s(x)}' for k, x in v.items() if not k.startswith('_'))
    elif isinstance(v, list):
        t = ' / '.join(s(x) for x in v)
    else:
        t = str(v)
    t = re.sub(r'\s+', ' ', t).strip()
    t, _ = clean(t)
    return t[:lim] if lim else t


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
        kk, _ = clean(str(k))
        if not kk:
            continue
        out.append((kk, v))
    return out


def build_comps(path, label):
    d = load(path)
    comps = d.get('components') or {}
    rows = []
    for name, c in comps.items():
        if name.startswith('_'):
            continue
        if not isinstance(c, dict):
            rows.append({'n': name, 'note': s(c)})
            continue
        pr = pick(c, 'props')
        # 坑注解：移动端用的是「🔴🔴 最要紧的一条」这种 emoji 键名，
        # 所以从「其余字段」里把带 🔴 的挑出来当注解，而不是只认 criticalNote
        note_src = c.get('criticalNote') or c.get('note') or ''
        extra = []
        for kk, vv in rest_fields(c):
            extra.append(kk + '：' + s(vv, 400))
        raw_note = str(note_src) + ' ' + ' '.join(
            str(k) + str(v) for k, v in c.items()
            if str(k).startswith('🔴') or '🔴' in str(k))
        rows.append({
            'n':  name,
            'p':  s(pick(c, 'page')),
            'k':  s(pick(c, 'key')),
            'id': s(pick(c, 'node')),
            'vc': s(pick(c, 'vcount')) or '',
            'pr': ([{'n': k, 'v': s(v, 400)} for k, v in pr.items()] if isinstance(pr, dict)
                   else ([{'n': '属性', 'v': s(pr, 400)}] if pr else [])),
            'dv': s(pick(c, 'defv')),
            'sm': s(pick(c, 'sample'), 400),
            'note': s(note_src) or (' · '.join(extra)[:400] if extra else ''),
            'hi': clean(raw_note)[1],
        })
    extras = {
        'lookup': [{'k': k, 'v': s(v)} for k, v in (d.get('nameLookup') or {}).items()],
        'traps':  [{'k': k, 'v': s(v)} for k, v in (d.get('_variantNameTraps') or {}).items()],
        'wvm':    [{'k': k, 'v': s(v)} for k, v in (d.get('webVsMobile') or {}).items()],
        'blind':  [{'k': k, 'v': s(v)} for k, v in (d.get('_blindSpots') or {}).items()],
        'states': [{'k': k, 'v': s(v)} for k, v in (d.get('_statesReference') or {}).items()],
    }
    print(f'  {label}: {len(rows)} 个组件 · nameLookup {len(extras["lookup"])} · '
          f'命名坑 {len(extras["traps"])} · 端差异 {len(extras["wvm"])}')
    return rows, extras


# ─────────────────────────── token ───────────────────────────
def build_tokens():
    d = load(os.path.join(SK, 'assets/feique-tokens.json'))

    colors = []
    c = d.get('color') or {}
    if c.get('brandRed'):
        colors.append({'n': '主色 brandRed', 'hex': c['brandRed'], 'note': '飞鹊品牌红'})
    for k, v in (c.get('text') or {}).items():
        colors.append({'n': f'文字 text/{k}', 'hex': v, 'note': ''})
    if c.get('link'):
        colors.append({'n': '链接 link', 'hex': c['link'], 'note': '飞鹊唯一蓝，链接也用它'})
    for tk, tv in (c.get('themes') or {}).items():
        if tk.startswith('_') or not isinstance(tv, dict):
            continue
        for slot in ('main', 'hover', 'lightBg'):
            if tv.get(slot):
                colors.append({
                    'n': f'{tv.get("styleName") or tk} · {slot}',
                    'hex': tv[slot],
                    'note': s(tv.get('tokenNames')),
                })
    for grp in ('functional', 'border', 'background', 'neutral'):
        g = c.get(grp)
        if isinstance(g, dict):
            for k, v in g.items():
                if k.startswith('_'):
                    continue
                if isinstance(v, str) and v.startswith('#'):
                    colors.append({'n': f'{grp}/{k}', 'hex': v, 'note': ''})
                elif isinstance(v, dict):
                    for k2, v2 in v.items():
                        if isinstance(v2, str) and v2.startswith('#'):
                            colors.append({'n': f'{grp}/{k}/{k2}', 'hex': v2, 'note': ''})

    fs = d.get('fontSize') or {}
    shadows = []
    for k, v in (d.get('shadow') or {}).items():
        if k.startswith('_') or not isinstance(v, dict):
            continue
        shadows.append({'lvl': k, 'mean': s(v.get('meaning')), 'css': s(v.get('css'))})

    st = d.get('figmaStyles') or {}
    def styles(kind):
        o = st.get(kind) or {}
        r = []
        for k, v in o.items():
            if k.startswith('_'):
                continue
            if isinstance(v, dict):
                r.append({'n': k, 'hex': s(v.get('hex') or v.get('size') or ''),
                          'id': s(v.get('id')), 'x': s({a: b for a, b in v.items()
                                                        if a not in ('hex', 'id', 'size')}, 200)})
            else:
                r.append({'n': k, 'hex': '', 'id': s(v), 'x': ''})
        return r

    tk = {
        'col': colors,
        'fs': {'web': (fs.get('web') or {}).get('scale') or [],
               'mob': (fs.get('mobile') or {}).get('scale') or [],
               'webNote': s((fs.get('web') or {}).get('note')),
               'mobNote': s((fs.get('mobile') or {}).get('note'))},
        'sp': (d.get('spacing') or {}).get('scale') or [],
        'rd': (d.get('radius') or {}).get('scale') or [],
        'sh': shadows,
        'st': {'paint': styles('paint'), 'text': styles('text'), 'eff': styles('effect')},
    }
    print(f'  token: 颜色 {len(colors)} · 阴影 {len(shadows)} · '
          f'paint style {len(tk["st"]["paint"])} · text style {len(tk["st"]["text"])}')
    return tk


# ─────────────────────────── 交互自查表 ───────────────────────────
def build_checklist():
    p = os.path.join(SK, 'sub-skills/MIC-交互/assets/UED交互自查表.md')
    if not os.path.exists(p):
        die('找不到 UED交互自查表.md')
    md = open(p, encoding='utf-8').read()
    parts = re.split(r'\n(?=## )', md)
    groups = []
    for blk in parts:
        h = re.match(r'## (.+)', blk)
        if not h:
            continue
        title = h.group(1).strip()
        if not title.startswith('范围'):
            continue
        body = blk[h.end():]
        items = []
        # 表格行：| **名** | 内容 | 覆盖度 | GSSM |
        for row in re.findall(r'^\|(.+)\|\s*$', body, re.M):
            cells = [x.strip() for x in row.split('|')]
            if len(cells) < 2 or set(''.join(cells)) <= set('-: '):
                continue
            nm = re.sub(r'\*\*', '', cells[0]).strip()
            if nm in ('类型', '自查内容') or not nm:
                continue
            items.append({'t': nm, 'd': cells[1] if len(cells) > 1 else '',
                          'g': cells[-1] if len(cells) > 3 else ''})
        # 列表行
        for sub in re.split(r'\n(?=### )', body):
            sh = re.match(r'### (.+)', sub)
            sname = sh.group(1).strip() if sh else ''
            for b in re.findall(r'^- (.+)$', sub, re.M):
                b = re.sub(r'\*\*', '', b).strip()
                if b:
                    items.append({'t': sname or title, 'd': b, 'g': ''})
        groups.append({'s': title, 'n': len(items), 'items': items})
    total = sum(g['n'] for g in groups)
    print(f'  自查表: {len(groups)} 个范围 · {total} 条')
    if total < 40:
        die(f'自查表只解析出 {total} 条，明显偏少 —— 解析规则跟文档格式不匹配，先修脚本再跑')
    return groups


# ─────────────────────────── 子 skill ───────────────────────────
def build_subskills():
    rows = []
    for d in sorted(glob.glob(os.path.join(SK, 'sub-skills/*/SKILL.md'))):
        name = os.path.basename(os.path.dirname(d))
        head = open(d, encoding='utf-8').read()[:4000]
        m = re.search(r'^description:\s*(.+?)(?=\n[a-z_]+:|\n---)', head, re.S | re.M)
        desc = re.sub(r'\s+', ' ', m.group(1)).strip() if m else ''
        desc, _ = clean(desc)
        rows.append({'n': name, 'd': desc[:600], 'sz': os.path.getsize(d)})
    print(f'  子 skill: {len(rows)} 个')
    return rows


# ─────────────────────────── 方法论经验（memory-refs 目录级） ───────────────────────────
def front(path, keys=('description', 'name')):
    """读 md 的 frontmatter 字段；没有 frontmatter 就退回首个标题/首段"""
    try:
        head = open(path, encoding='utf-8').read()[:3000]
    except Exception:
        return ''
    got = {}
    fm = re.match(r'---\n(.*?)\n---', head, re.S)
    if fm:
        for line in fm.group(1).split('\n'):
            m = re.match(r'([a-zA-Z_]+):\s*(.+)', line)
            if m:
                got[m.group(1)] = m.group(2).strip()
    for k in keys:
        if got.get(k):
            return re.sub(r'\s+', ' ', got[k]).strip()
    body = head[fm.end():] if fm else head
    m = re.search(r'^#{1,3}\s*(.+)$', body, re.M)
    if m:
        return re.sub(r'\s+', ' ', m.group(1)).strip()
    for line in body.split('\n'):
        line = line.strip()
        if line and not line.startswith(('#', '>', '|', '-', '*')):
            return re.sub(r'\s+', ' ', line)[:200]
    return ''


def build_memrefs():
    rows = []
    for f in sorted(glob.glob(os.path.join(SK, 'memory-refs/*.md'))):
        n = os.path.basename(f)[:-3]
        if n.startswith('_'):
            continue
        d, hi = clean(front(f))
        rows.append({'n': n, 'd': d[:300], 'hi': hi, 'sz': os.path.getsize(f)})
    print(f'  方法论经验: {len(rows)} 份')
    return rows


def build_biz():
    """业务知识只取目录级：文件名 + 一句话摘要。正文不进页面。"""
    pats = ['mic-biz-*.md', 'reference-mic-*.md', '_index-mic-*.md']
    seen, rows = set(), []
    for base in glob.glob(os.path.expanduser('~/.claude/projects/*/memory')):
        for pat in pats:
            for f in sorted(glob.glob(os.path.join(base, pat))):
                n = os.path.basename(f)[:-3]
                if n in seen:
                    continue
                seen.add(n)
                d, hi = clean(front(f))
                rows.append({'n': n, 'd': d[:300], 'hi': hi, 'sz': os.path.getsize(f)})
    rows.sort(key=lambda r: r['n'])
    print(f'  业务知识（目录级）: {len(rows)} 份')
    return rows


# 八条业务线（页面上「业务知识库」那一格要按这个分组）
BIZ_LINES = [
    ('搜索',     'search|serp|qp|qc|qf|cs|price|lv|pla|wholesale|catalog|seo|aimode|ai-mode'),
    ('询盘',     'inquiry|xunpan'),
    ('交易订单', 'order|trade|fund|refund'),
    ('TM',       r'\btm\b|tm-|-tm'),
    ('RFQ',      'rfq'),
    ('商机融合', 'deal|shangji'),
    ('会员成长', 'growth|member|star|point|review'),
    ('运营',     'operation|banner|yunying|home'),
]


# ─────────────────────────── 主流程 ───────────────────────────
def main():
    print('══ 从 skill 真实资产生成数据 ══')
    icons, vbox = build_icons()
    print(f'  图标: {len(icons)} 个 · 非 16 视口 {len(vbox)} 个')
    cw, xw = build_comps(os.path.join(SK, 'assets/feique-component-catalog.json'), 'Web 组件库')
    cm, xm = build_comps(os.path.join(SK, 'assets/feique-mobile-component-catalog.json'), '移动端组件库')
    tk = build_tokens()
    cl = build_checklist()
    ss = build_subskills()
    mr = build_memrefs()
    bz = build_biz()

    data = {
        'm': {'gen': datetime.date.today().isoformat(),
              'icons': len(icons), 'web': len(cw), 'mob': len(cm),
              'cl': sum(g['n'] for g in cl), 'ss': len(ss),
              'mr': len(mr), 'bz': len(bz)},
        'ic': icons, 'icv': vbox,
        'cw': cw, 'cm': cm, 'xw': xw, 'xm': xm,
        'tk': tk, 'cl': cl, 'ss': ss, 'mr': mr, 'bz': bz,
        'bl': [[n, p] for n, p in BIZ_LINES],
    }
    blob = json.dumps(data, ensure_ascii=False, separators=(',', ':'))

    js = BEGIN + '\nwindow.WBDATA=' + blob + ';\n' + END
    page = open(PAGE, encoding='utf-8').read()
    if BEGIN in page and END in page:
        a = page.index(BEGIN); b = page.index(END) + len(END)
        page = page[:a] + js + page[b:]
        print('  已替换 index.html 里的数据块')
    else:
        anchor = '<script>'
        if anchor not in page:
            die('index.html 里找不到 <script>，无法注入')
        i = page.index(anchor) + len(anchor)
        page = page[:i] + '\n' + js + '\n' + page[i:]
        print('  已在 index.html 首个 <script> 后插入数据块')
    open(PAGE, 'w', encoding='utf-8').write(page)

    print(f'\n══ 完成 ══')
    print(f'  数据块 {len(blob)/1024:.0f} KB · index.html 现 {os.path.getsize(PAGE)/1024:.0f} KB')
    for k, v in data['m'].items():
        print(f'    {k} = {v}')


if __name__ == '__main__':
    main()
