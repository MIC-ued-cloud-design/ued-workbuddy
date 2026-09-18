#!/usr/bin/env python3
"""把 docs/飞鹊Web组件库.css（600KB）按组件切成一族一个文件，并生成给模型看的 INDEX.md。

为什么要切：整份 600KB 里 87% 是图标 data-URI，真正的组件 CSS 只有 75KB；
而开工包「网页速用」只抽了 7 个族（btn/inp/alert/tag/bdg/skel/shadow），
剩下 21 个族（分页/下拉/勾选/上传/步骤条/空状态/面包屑/Tabs…）模型从来没见过实现，
只能手搓——手搓件色值字重全对、结构尺寸全是编的，这就是「规范满分但不像飞鹊」的来源。
切开之后模型按页面需要 cat 几个进 <style>，要什么有什么，又不用背 600KB。

实测过：组件节对图标变量节的引用数 = 0，所以切片无损（脚本里有断言守住这条）。
权威源仍是 飞鹊Web组件库.css，本目录是它的切片，改了权威源重跑本脚本即可。
"""
import re, os, json, sys

HERE = os.path.dirname(os.path.abspath(__file__))
DOCS = os.path.join(HERE, '..', 'packs', 'feique', 'docs')
SRC  = os.path.join(DOCS, '飞鹊Web组件库.css')
OUT  = os.path.join(DOCS, 'css')

# 一句话用法（judgment，不能自动生成）。key = 节名里的识别串
NOTE = {
  '全局 Reset':      ('_reset',  '每个页面都要带：box-sizing 与 number input 箭头处理'),
  'Button':          ('btn',     '.btn + 尺寸 .btn-lg/md/sm + 变体 primary/secondary/text/link。全页只一个 .btn-primary'),
  'Pagination':      ('pg',      '分页：数字 + 箭头 + more。别自己拿 <a> 拼'),
  'Input 文本输入框': ('inp',     '.inp > .inp-body > input（input 本身无边框）；状态 .inp-error/-warning/-success/-disabled'),
  'Select 选择器':    ('sel',     '下拉：触发器 + 浮层 + 选项。多选项用 multiple selection item'),
  'Textarea':        ('ta',      '多行文本域，带字数计数位'),
  'InputNumber':     ('inpn',    '数字输入框（带步进器）'),
  'Radio':           ('rd',      '圆形单选'),
  'Selector Single': ('ss',      '按钮式单选（买家端常用，长得像按钮不是圆点）'),
  'Checkbox':        ('cb',      '复选框。勾是内嵌 SVG（icons/yes2.svg，纯勾那个），不是 border+rotate 拼的'),
  'Steps':           ('stp',     '步骤条（下单流程 / 多步表单）'),
  'Switch':          ('sw',      '开关'),
  'Upload':          ('upl',     '上传：按钮式 / 拖拽区 / 文件列表 / 图片列表 / 上传中'),
  'scrollbar':       ('scr',     '自定义滚动条'),
  '投影 Token':      ('shadow',  '.shadow-1/2/3 三级投影'),
  'Message':         ('msg',     '全局提示（顶部飘出那种）'),
  'Tooltip':         ('tip',     '气泡提示'),
  'Loading / Spin':  ('spin',    '加载转圈。别自己写 @keyframes'),
  'Tag 标签':        ('tag',     '.tag + tag-line-*（描边）/ tag-areal-*（浅底）'),
  'Alert':           ('alert',   '提示条。里面不放按钮，动作用 .alert-link 文字链'),
  'Breadcrumb':      ('brd',     '面包屑。分隔符是飞鹊 icon=right 的 16×16 内嵌 SVG'),
  'Skeleton':        ('skel',    '骨架屏（列表/卡片/段落/头像）'),
  'Tabs':            ('tab',     '标签页。选中态是下划线，不是 chip'),
  'Badge':           ('bdg',     '徽标：红点 / 数字 / 状态点 / 缎带'),
  'Drawer':          ('dw',      '抽屉（侧滑面板）'),
  'List':            ('lst',     '列表'),
  'Empty':           ('empty',   '空状态缺省图。插图用 .empty-img 占位，别自己画空状态'),
  'Cascader':        ('cscd',    '级联选择器（多级目录常用）'),
}

# 只有 Figma、没有 CSS 实现的业务组件 —— 做 MIC 真实页面的主力，必须点名，
# 否则模型看到清单里没有就自己画（2026-09-10 手画 LOGO 那次就是这么来的）。
BIZ_KEYS = ['ProductCard', 'product-image', 'product/QP', 'product-card', 'similar Btn',
            'MIC Filter', 'MIC Supplier Ad', 'MIC TM Bar', 'MIC Footer', 'mic-logo',
            'vo-header', 'vo-nav', 'vo-sider', 'brand logo', 'attachment icon']

def main_prefix(cls):
    """真实类名前缀，不拿 slug 猜 —— InputNumber 的文件叫 inpn.css，类名却是 .inp-num-*，
    表里写错模型就照错的抄。做法：找被大多数类名共享的最长 `-` 分段前缀。"""
    if not cls:
        return []
    segs = [c.split('-') for c in cls]
    pref, i = [], 0
    while True:
        head = [s[i] for s in segs if len(s) > i]
        if not head:
            break
        top = max(set(head), key=head.count)
        if head.count(top) < len(cls) * 0.8:
            break
        pref.append(top); i += 1
    root = '-'.join(pref)
    if not root:
        return []
    return [root] + [c for c in cls if c.startswith(root + '-')][:2]


def main():
    css = open(SRC, encoding='utf-8').read()
    marks = [(m.start(), m.group(1).strip()) for m in re.finditer(r'/\*\s*=====\s*(.*?)\s*=====\s*\*/', css)]
    if not marks:
        sys.exit('FATAL: 权威源里找不到 ===== 分节锚点，格式变了，先看一眼再改脚本')

    # 🔴 先算完再写盘。早先版本一进来就清空 OUT，结果断言在中途 FATAL 时
    # css 已重写、INDEX.md 还没写 —— 留下一份残缺产物，还正好被一次打包吃进去了（2026-09-15）。
    pending, rows, skipped_icon = {}, [], 0
    for i, (p, name) in enumerate(marks):
        end = marks[i + 1][0] if i + 1 < len(marks) else len(css)
        seg = css[p:end].strip() + '\n'
        if '图标 CSS 变量' in name:          # 520KB 的 data-URI 节，组件不依赖它
            skipped_icon = len(seg); continue

        hit = next((k for k in NOTE if k in name), None)
        if not hit:
            sys.exit('FATAL: 节「%s」没有对应的用法说明，补进 NOTE 再跑（宁可报错也别默默漏掉一个组件）' % name)
        slug, note = NOTE[hit]

        # 断言：切下来的这块不能引用图标变量节里的东西，否则切开就废了
        ref = set(re.findall(r'var\(\s*(--ico-[\w-]+)', seg))
        if ref:
            sys.exit('FATAL: 节「%s」引用了图标变量 %s，切片会让它失效' % (name, sorted(ref)[:3]))

        cls = sorted({m.group(1) for m in re.finditer(r'\.([a-zA-Z][\w-]*)', seg)})
        pending[slug + '.css'] = seg
        rows.append({'slug': slug, 'name': name, 'note': note, 'bytes': len(seg),
                     'rules': seg.count('{'), 'classes': len(cls), 'main': main_prefix(cls)})

    # 🔴 反向核对：切片必须覆盖权威源里每一个类名。
    # 光靠「每节都有 NOTE」是不够的 —— 那只证明认出来的节都切了，证明不了没有节被漏看。
    # （2026-09-15 就是靠这条发现 Collapse 只有注释、没有 CSS 实现。）
    strip = lambda t: re.sub(r'/\*.*?\*/', '', t, flags=re.S)
    full = {m.group(1) for m in re.finditer(r'\.([a-zA-Z][\w-]*)', strip(css))}
    got = set()
    for body in pending.values():
        got |= {m.group(1) for m in re.finditer(r'\.([a-zA-Z][\w-]*)', strip(body))}
    miss = sorted(full - got - {'org', 'w3'})        # org/w3 来自 xmlns URL，不是类名
    if miss:
        sys.exit('FATAL: 这些类名在权威源里有、却没进任何切片，说明有一节没被认出来：%s' % miss)

    # 业务组件：从 Figma 清册里取节点号，模型要真 SVG 时能直接导
    biz = []
    try:
        cat = json.load(open(os.path.join(DOCS, '..', 'web-components.json'), encoding='utf-8'))
        for cname, cval in cat.get('components', {}).items():
            if any(k.lower() in cname.lower() for k in BIZ_KEYS):
                v = cval if isinstance(cval, dict) else {}
                biz.append((cname, v.get('key') or v.get('componentKey') or '',
                            v.get('nodeId') or v.get('id') or ''))
    except Exception as e:
        print('warn: 业务组件清册没读成 (%s)，INDEX 里那节会是空的' % e)

    total = sum(r['bytes'] for r in rows)
    L = []
    L.append('# 飞鹊 Web 组件 · 网页实现清单\n')
    L.append('做网页产物时的**砖表**。全部 %d 类、加起来只有 %dKB —— 挑这页要用的，'
             '`cat` 进 index.html 的 `<style>`。\n' % (len(rows), total // 1024))
    L.append('🔴 **`<族>.states.css` 要一起带上。** 飞鹊的状态（悬停、勾选、打开）是从 Figma variant 导出来的，写作 `.cb-hv` / `.cb-sel` 这种类名，
要人手动加 class 才出现 —— 鼠标放上去不会变、点一下也不会勾上。同目录的 `<族>.states.css` 把这些**同样的值**接到真实的
`:hover` / `:checked` 上（cb / rd / ss / sw / ta / inpn 六族有）。规矩：**你 cat 了 `x.css`，同目录有 `x.states.css` 就一起 cat**，
页面里的控件才是能动的。值一个没变，所以体检照样过。

**规矩三条**：① 一律带上 `_reset.css` ② 表里有的组件不许自己另写一套、'
             '也不许发明飞鹊没有的变体（`.btn-neutral` 这种）③ 表里没有的见文末，'
             '那些是**没有 CSS 实现**的，只能导出真资产或留占位，手画一个看着差不多的比留空更糟。\n')
    L.append('用法示例：做一个带表单和分页的列表页 →\n')
    L.append('```bash\ncat docs/css/{_reset,btn,inp,sel,cb,pg,alert,empty}.css\n```\n')
    L.append('## 有 CSS 实现的组件\n')
    L.append('| 组件 | 文件 | 主类名 | 规则 | 怎么用 |')
    L.append('|---|---|---|---|---|')
    for r in sorted(rows, key=lambda x: x['slug']):
        main = ('`.' + '` `.'.join(r['main'][:3]) + '`') if r['main'] else '（无类名 · 全局生效）'
        L.append('| %s | `css/%s.css` | %s | %d | %s |' %
                 (r['name'], r['slug'], main, r['rules'], r['note']))
    L.append('\n## 没有 CSS 实现 —— 只有 Figma，不许手画\n')
    L.append('页头页脚、LOGO、产品卡、筛选侧栏这些是 MIC 既有资产，属于**照抄范围，不是设计空间**。')
    L.append('要真 SVG / 真结构：用 figma 的 `download_assets` 按 key 导出；'
             '导不到就画灰色占位块并在交付说明里写明「待补真资产」。')
    L.append('品牌 LOGO 已经是现成 SVG，在 `brand/` 目录，直接内联。\n')
    L.append('| 组件 | Figma key | 节点 |')
    L.append('|---|---|---|')
    for n, k, nid in sorted(biz):
        L.append('| %s | `%s` | `%s` |' % (n, k or '—', nid or '—'))
    L.append('\n## 库里提到、但没有 CSS 实现的\n')
    L.append('**Collapse 折叠面板**：权威源里只有一段注释描述它的 DOM 结构（`.clps > .clps-item > .clps-hd/.clps-bd`），'
             '没有任何一条规则。要用折叠面板得自己实现结构，或去 Figma 取。别照着那段注释写类名——那些类在页面里是空的。\n')
    L.append('\n---\n')
    L.append('由 `build/gen-feique-css-split.py` 从 `飞鹊Web组件库.css` 切出（权威源是后者，改了它重跑本脚本，'
             '再跟着重跑一次 `build/gen-feique-states.py`）。')
    L.append('那份里另有 %dKB 是 335 个图标 data-URI，组件不依赖，没切进来；UI 图标用 `icons/` 下的 295 个 SVG。'
             % (skipped_icon // 1024))
    pending['INDEX.md'] = '\n'.join(L) + '\n'

    # 到这里为止一个字节都没写盘：断言全过了，才统一落地
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        # 🔴 *.states.css 是另一层（gen-feique-states.py 生成的状态接线），不归本脚本管，别顺手删了
        if (f.endswith('.css') and not f.endswith('.states.css')) or f == 'INDEX.md':
            os.remove(os.path.join(OUT, f))
    for fname, body in pending.items():
        open(os.path.join(OUT, fname), 'w', encoding='utf-8').write(body)

    print('切出 %d 个组件文件，共 %.1fKB（原库 %.0fKB，其中图标 %.0fKB 未切）'
          % (len(rows), total / 1024, len(css) / 1024, skipped_icon / 1024))
    print('业务组件（无 CSS）%d 条' % len(biz))
    print('→', OUT)

main()
