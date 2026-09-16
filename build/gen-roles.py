#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把桌面版的能力清单搬进网页版，注入 index.html。

单一维护源：卡片正本是 desktop/packs/capabilities.json（桌面版手写的那份）。
本脚本只做搬运和字段映射，不新增内容。加一张卡去改那个 json，两边一起有。

搬什么：
  · 产品 3 张、前端 3 张场景卡      → 网页版原来只有设计那六类
  · 6 张能力卡                      → 进输入框的「+」菜单
  · 设计 19 张卡的完整提示词        → 网页版原来只有模板文案（tpl），
                                      接力到终端时带不上桌面版那套判据

🔴 两种文本分开处理：
  · 界面上显示的 title / desc —— 剥 emoji 和内部记法（跟 gen-data.py 同一套判据）
  · 发给模型的 prompt        —— 一个字都不许动，那些 🔴 是给模型的重点标记

用法：python3 build/gen-roles.py
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CAPS = os.path.join(ROOT, 'desktop', 'packs', 'capabilities.json')
PAGE = os.path.join(ROOT, 'index.html')

BEGIN = '/* ==FQ-ROLES:BEGIN== 由 build/gen-roles.py 从 desktop/packs/capabilities.json 生成，勿手改 == */'
END   = '/* ==FQ-ROLES:END== */'

# 跟 gen-data.py 同一套：产品界面不出现内部记法
EMOJI = re.compile(
    '[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F000-\U0001F0FF'
    '\U00002190-\U000021FF\U00002B00-\U00002BFF️⃣™ℹ]+')


def die(m):
    print('❌ ' + m); sys.exit(1)


def clean(t):
    """只给界面文案用。prompt 绝不过这个函数。"""
    t = '' if t is None else str(t)
    t = EMOJI.sub('', t)
    t = t.replace('【', '（').replace('】', '）')
    return re.sub(r'\s{2,}', ' ', t).strip(' ·—-')


# 每类卡在网页版界面上用哪个图标 / 产出写什么 / 查哪几个资料库 / 点一下往输入框里填什么。
# 网页版的卡比桌面版多这四个字段（桌面版没有输入框这一层），所以这张表留在本脚本里。
FACE = {
    'prd':        ('fq_filltext',  '→ 一份 <em>可开发的 PRD</em>，含追问清单和下游四个角色会卡在哪。',
                   [['MIC 业务知识库', 0], ['用户研究', 0], ['方法论库', 0]],
                   '把询盘列表加一个按供应商回复速度排序的功能。\n背景和已知的规则：（贴需求说明，或把 PRD 拖进来）'),
    'grill':      ('fq_talk',      '→ 一轮一轮的<em>追问记录</em>，问到你自己能答清为止。',
                   [['方法论库', 0]],
                   '我想在搜索结果页加一个 AI 助手入口，帮买家把需求说清楚。\n帮我把这个方案拷问一遍。'),
    'breakdown':  ('fq_batch',     '→ 一份<em>任务单</em>，设计和前端各自能直接领走。',
                   [['MIC 业务知识库', 0]],
                   '这个需求要拆给设计和前端。\n需求文档：（贴 PRD 链接，或把文件拖进来）'),
    # 🔴 下面三张是前端角色的。2026-09-16 吉吉定「网页版也去掉前端角色」跟客户端对齐，
    # capabilities.json 里已经没有 frontend 了，所以这三行现在不会被用到 ——
    # 留着是因为它们只是「界面怎么写」的查表，客户端哪天把前端加回来就直接能用；
    # 真删了下次还得重写一遍。缺了会 die，多了不会。
    'receive':    ('fq_folder',    '→ 按飞鹊规范落好的<em>组件代码</em>，附逐项对照。',
                   [['飞鹊组件库', 0], ['交付规范', 0]],
                   '按这份交付包把页面落成组件代码。\n交付包：（贴 Figma 链接，或把文件拖进来）'),
    'tovue':      ('fq_category',  '→ 拆好的<em>组件与设计变量</em>，写死的值都抽成了变量。',
                   [['飞鹊组件库', 0], ['交付规范', 0]],
                   '把这份 HTML 视觉稿拆成组件，写死的颜色和字号抽成变量。\n稿子：（把 HTML 文件拖进来）'),
    'fidelity':   ('fq_similarity','→ 一份<em>还原度对照表</em>，逐项写明差在哪几个像素。',
                   [['飞鹊组件库', 0], ['交付规范', 0]],
                   '对照设计稿量一遍我写的实现，差在哪几处。\n设计稿：（贴 Figma 链接）\n我的实现：（贴页面网址，或把文件拖进来）'),
}
ABI_ICON = {'grill': 'fq_talk', 'ce-brainstorm': 'fq_compass', 'ce-review': 'fq_eye',
            'ce-bakeoff': 'fq_vs', 'ce-compound': 'fq_bookmark', 'handoff-note': 'fq_file'}

# 哪几类卡没有工具就真的做不了 —— 决定发送按钮是「问 WorkBuddy」还是「交给终端做」。
# 判据是「要不要读写文件或打开真页面」，不是「难不难」。
NEED_TERM = {'code', 'review'}



def page_scenes(path):
    """从 index.html 里切出 SCENES 那一段 —— 网页版设计卡的正本在底座手写，
    不在 capabilities.json 里，所以对账只能回来读页面。"""
    t = open(path, encoding='utf-8').read()
    i = t.find('const SCENES')
    if i < 0:
        die('index.html 里找不到 SCENES')
    # 🔴 切到数组自己的结尾（行首的 `];`），别切到后面某个标记。
    # 第一版切到「角色层」那条注释，把中间的 PLUS_MENU、模型列表、资料库
    # 一起圈了进来，于是「豆包」「贴链接」「管理技能」都被当成设计卡报红 ——
    # 门的输入错了，不是判据错了。
    j = t.find('\n];', i)
    if j < 0:
        die('SCENES 数组找不到结尾')
    return t[i:j]


def main():
    if not os.path.exists(CAPS):
        die('找不到桌面版能力清单：' + CAPS)
    caps = json.load(open(CAPS, encoding='utf-8'))

    roles = {r['id']: r for r in caps.get('roles', [])}
    # 🔴 只有 design 是必需的（六类阶段的提示词从它来）；其余角色跟着
    # capabilities.json 走，别在这儿写死名单 ——
    # 2026-09-16 吉吉定「网页版也去掉前端角色」，写死 frontend 的话构建会直接挂。
    if 'design' not in roles:
        die('能力清单里缺 design 角色')
    extra = [r['id'] for r in caps.get('roles', []) if r['id'] != 'design']

    # ① 设计 19 张卡的提示词，按卡名对回网页版的 SCENES（两边名字一致，join 得上）
    dprompt = {}
    for g in roles['design'].get('groups', []):
        for c in g.get('cards', []):
            if not c.get('prompt'):
                die('设计卡「%s」没有 prompt' % c.get('title'))
            dprompt[c['title']] = c['prompt']
    if len(dprompt) != 19:
        die('设计卡应该是 19 张，实际 %d 张 —— 桌面版改过就同步改这里的期望值' % len(dprompt))

    # 🔴 两头对账，缺一边都要红。
    # 只数「搬了多少条」是不够的：提示词搬进页面、而页面上没有那张卡去取它，
    # 它就是个孤儿，页面上什么都不会发生、也不会报错。
    # 2026-09-15 实测：桌面版 19 张、网页版 18 张，少的是「自然语言生成网页」，
    # 光数 19 这道门是绿的。所以要拿网页版真有的卡名回来核。
    page_names = set(re.findall(r"n:'([^']+)'", page_scenes(PAGE)))
    orphan = sorted(set(dprompt) - page_names)      # 搬过来了但没卡片认领
    missing = sorted(n for n in page_names if n not in dprompt)   # 卡片在但没提示词
    if orphan:
        die('这些提示词没有卡片认领（网页版少了这几张卡）：' + '、'.join(orphan))
    if missing:
        die('这些卡取不到提示词（桌面版没有同名卡，或名字对不上）：' + '、'.join(missing))

    # ② 产品 / 前端
    out_roles = []
    for rid in extra:
        r = roles[rid]
        cards = []
        for s in r.get('scenes', []):
            if s['id'] not in FACE:
                die('卡「%s」(%s) 在本脚本的 FACE 表里没有界面写法，先补一行再跑' % (s['title'], s['id']))
            icon, out, uses, tpl = FACE[s['id']]
            cards.append({
                'id': s['id'], 'n': clean(s['title']), 'ic': icon,
                'out': out, 'uses': uses,
                'need': 'term' if s.get('kind') in NEED_TERM else '',
                'tpl': tpl,
                'prompt': s['prompt'],          # 原样，不 clean
            })
        out_roles.append({'id': rid, 'n': clean(r['name']), 'cards': cards})

    # ③ 能力卡
    abilities = []
    for a in caps.get('abilities', []):
        if a['id'] not in ABI_ICON:
            die('能力「%s」(%s) 没定图标，先补 ABI_ICON 再跑' % (a['title'], a['id']))
        abilities.append({'id': a['id'], 'n': clean(a['title']), 'd': clean(a.get('desc')),
                          'ic': ABI_ICON[a['id']], 'prompt': a['prompt']})

    payload = {'roles': out_roles, 'abilities': abilities, 'designPrompt': dprompt}
    block = BEGIN + '\nwindow.WBROLES=' + json.dumps(payload, ensure_ascii=False) + ';\n' + END

    page = open(PAGE, encoding='utf-8').read()
    if BEGIN in page:
        i, j = page.index(BEGIN), page.index(END) + len(END)
        page = page[:i] + block + page[j:]
    else:
        anchor = '/* ==FQ-DATA:END== */'
        if anchor not in page:
            die('index.html 里找不到 FQ-DATA:END，插不进去')
        page = page.replace(anchor, anchor + '\n' + block, 1)
    open(PAGE, 'w', encoding='utf-8').write(page)

    print('  ' + ' · '.join('%s %d 张' % (r['n'], len(r['cards'])) for r in out_roles)
          + ' · 能力 %d 张 · 设计卡提示词 %d 条' % (len(abilities), len(dprompt)))
    need = [c['n'] for r in out_roles for c in r['cards'] if c['need'] == 'term']
    print('  这几张没有工具做不了，会走「交给终端做」：' + '、'.join(need))


if __name__ == '__main__':
    main()
