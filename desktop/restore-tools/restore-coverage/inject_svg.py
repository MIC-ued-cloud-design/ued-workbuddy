#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""inject_svg.py — 往还原稿的 DOM 里注入内联 SVG 的唯一正确姿势（2026-09-01 立）

═══ 为什么要它 ═══
「手工注入没有 data-node-id 的 SVG」这一个动作，已经把同一个洞捅了**四次**
（见 memory-refs/feedback-inline-svg-parts-gate-blindspot.md）：

  错 1  给 `.ph44 > svg` 写 absolute，忘了给 `.ph44` 自己 relative
        → 两张水印跳过头像框锚到页面根，落在状态栏上（五道门全绿，用户一眼看出）
  错 2  漏看 `fill="white"`，以为缺白三角自己补画一个 → 成品两个三角
  错 3  `<svg>` 默认 inline、底边贴基线 → 12px 图标被整体下推 3px
  错 4  ① 36×36 的整块图形塞进自带 padding 10.5/13.5 的 div → 内容区只剩 9×15，箭头被压没
        ② 22×22 的容器图形塞进 19×18 的**子节点** → 撑出容器、中心低 2px

每一次的补法都是「再加一维检测」＝**事后抓**。这份工具把它挪到**动手那一刻**：
上面除错 2（归 asset-claim.js）外的三类，加上两条 DOM 操作坑、一条 preflight 坑，
在这里全部变成「写不出来」而不是「写出来之后被抓」。

═══ 它保证什么（每条都对应一次真事故）═══
  ① 目标节点必须**同时**在 manifest 和 HTML 里 —— 否则抛异常，不静默跳过
     （2026-07-29 门体检就栽在这：注入是空操作，却被读成「门瞎了」）
  ② SVG 的固有尺寸（viewBox）必须等于目标节点的 manifest 真值 —— 不等就**拒绝**，
     并回头在祖先/后代里找尺寸对得上的那个，点名「你要塞的多半是它」（治错 4②）
  ③ 目标节点在 manifest 里**有子节点** → 强制用插入，绝不替换
     （replace 会把子节点一起吃掉，而那些叶子是 coverage 要核销的）
  ④ div 配对一律用层级计数，**不用非贪婪正则**
     （`(...>)(.*?)(</div>)` 停在第一个 `</div>`＝子节点的，会把整棵树顶乱）
  ⑤ 目标节点有 padding → 自动配 `host{position:relative}` +
     `host>svg{position:absolute;left:0;top:0;width:Wpx;height:Hpx}`（治错 4① 和错 1，
     两条 CSS 永远成对出现，不可能只写一半）
  ⑥ `display:block` 写进 **CSS**，不写内联 style（治错 3，且绕开 preflight 的
     「内联 display」硬拦 —— 现役的 J/K 两份稿就是栽在这条上，预检至今是红的）
  ⑦ finish() 做结构自检：data-node-id 总数不变 + div 开闭配平 +（可选）根的直接子元素数

═══ 怎么用 ═══
    import sys; sys.path.insert(0, '<SKILL>/scripts/restore-coverage')
    from inject_svg import SvgInjector, InjectError

    inj = SvgInjector(body_html, '/abs/x-manifest.json')
    inj.inject('1619:17406', open('star.svg').read())   # 自动判插入/替换、自动出 CSS
    inj.inject('1619:17354', open('sts.svg').read())
    body, css, report = inj.finish(root='1619:17351', expect_kids=4)
    print(report)                                        # 逐条说它做了什么决定，别当黑箱
    # css 追加进 <style>，body 写回稿子

🔴 拒绝是**默认行为**，不是建议。确实要塞尺寸不符的，传
   `allow_size_mismatch='理由'`（理由会进 report，跟门的豁免一样是声明式的，
   不许传 True 蒙混 —— 见 feedback-gate-coverage-must-be-declared）。

自测：python3 inject-svg-selftest.py
"""

import json
import os
import re

__all__ = ['SvgInjector', 'InjectError']

# 尺寸比对容差。viewBox 和 manifest 都是设计值（离散），不是量出来的几何，
# 所以这里只留浮点余量，不套 geom 那个 ±1.6px —— 套了等于放行「22 塞进 21」。
SIZE_TOL = 0.51

_DIV = re.compile(r'<(/?)div\b[^>]*>', re.I)
_SVG_OPEN = re.compile(r'<svg\b[^>]*>', re.I)


class InjectError(Exception):
    """注入被拒。消息里必带「为什么拒」和「该怎么改」，别只抛个 id。"""


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def svg_intrinsic_size(svg_text):
    """拿 SVG 的固有尺寸：viewBox 优先，退回 width/height 属性。

    为什么 viewBox 优先：width/height 可能被上一手改过（或写成百分比），
    而 viewBox 是导出时钉死的坐标系，跟 Figma 节点框一一对应。
    实测 /tmp/jk/svg 四个真文件（star/sts/trophy/lf）的 viewBox 跟节点 w/h 全部精确相等。
    """
    m = _SVG_OPEN.search(svg_text)
    if not m:
        return None, None, 'text 里找不到 <svg 开标签'
    tag = m.group(0)
    vb = re.search(r'viewBox\s*=\s*"([^"]+)"', tag, re.I)
    if vb:
        parts = re.split(r'[\s,]+', vb.group(1).strip())
        if len(parts) == 4:
            w, h = _num(parts[2]), _num(parts[3])
            if w and h:
                return w, h, 'viewBox'
    aw = re.search(r'\bwidth\s*=\s*"([\d.]+)(?:px)?"', tag, re.I)
    ah = re.search(r'\bheight\s*=\s*"([\d.]+)(?:px)?"', tag, re.I)
    if aw and ah:
        return _num(aw.group(1)), _num(ah.group(1)), 'width/height 属性'
    return None, None, '既没有 viewBox 也没有可解析的 width/height'


def _find_open_tag(html, nid):
    """定位带该 node-id 的元素开标签，返回 (标签起点, 标签结束后一位)。找不到返回 (-1, -1)。"""
    i = html.find('data-node-id="%s"' % nid)
    if i < 0:
        return -1, -1
    start = html.rfind('<', 0, i)
    end = html.find('>', i)
    if start < 0 or end < 0:
        return -1, -1
    return start, end + 1


def _inner_span(html, nid):
    """按 div 层级配对算出该节点的内部区间 [开标签后, 闭标签前]。

    🔴 不用非贪婪正则：`(...>)(.*?)(</div>)` 会停在**第一个** `</div>`（子节点的），
    把整棵树的嵌套顶乱。K 稿上的后果是金刚区直接子元素 4→5、四张卡从 351 缩成 318.5。
    """
    _, open_end = _find_open_tag(html, nid)
    if open_end < 0:
        return -1, -1
    depth, k = 1, open_end
    while depth > 0:
        m = _DIV.search(html, k)
        if not m:
            return -1, -1
        depth += 1 if m.group(1) == '' else -1
        k = m.end()
    return open_end, k - len('</div>')


def _css_sel(nid):
    return '[data-node-id="%s"]' % nid


class SvgInjector(object):
    def __init__(self, html, manifest_path):
        self.html = html
        self.manifest_path = manifest_path
        with open(manifest_path, encoding='utf-8') as f:
            m = json.load(f)
        self.nodes = {n['id']: n for n in (m.get('nodes') or [])}
        self.leaves = {l['id']: l for l in (m.get('leaves') or [])}
        self.root_id = m.get('root')
        self._kids = {}
        for n in (m.get('nodes') or []):
            p = n.get('parentId')
            if p:
                self._kids.setdefault(p, []).append(n)
        self._css = []
        self._log = []
        self._n0 = html.count('data-node-id="')

    # ── 尺寸真值：跟 geom 那一维用同一套口径（uw/uh 优先，那是未旋转真值）──
    def _dims(self, nid):
        n = self.nodes.get(nid) or self.leaves.get(nid)
        if not n:
            return None, None
        w = n.get('uw') if n.get('uw') is not None else n.get('w')
        h = n.get('uh') if n.get('uh') is not None else n.get('h')
        return w, h

    def _name(self, nid):
        n = self.nodes.get(nid) or self.leaves.get(nid) or {}
        return n.get('name', '')

    def _suggest(self, nid, sw, sh):
        """尺寸不符时，在祖先链和直系子节点里找尺寸对得上的，给出改挂建议。

        这是「星标塞错层级」那个错的正解：svg 22×22、目标 19×18、
        而它父节点 ic_供应商星级 正好 22×22 —— 机器认得出来，就不该让人靠肉眼。
        """
        hits = []
        cur = self.nodes.get(nid)
        seen = set()
        # 往上找祖先
        while cur and cur.get('parentId') and cur['parentId'] not in seen:
            seen.add(cur['parentId'])
            pid = cur['parentId']
            w, h = self._dims(pid)
            if w is not None and abs(w - sw) <= SIZE_TOL and abs(h - sh) <= SIZE_TOL:
                hits.append(('祖先', pid, w, h))
            cur = self.nodes.get(pid)
        # 往下找直系子节点
        for c in self._kids.get(nid, []):
            w, h = self._dims(c['id'])
            if w is not None and abs(w - sw) <= SIZE_TOL and abs(h - sh) <= SIZE_TOL:
                hits.append(('子节点', c['id'], w, h))
        return hits

    def inject(self, nid, svg_text, allow_size_mismatch=None):
        """把 svg_text 注入 nid 那个节点。被拒时抛 InjectError（默认行为，不是建议）。"""
        svg_text = svg_text.strip().replace('\n', '')

        # ① 目标必须同时在 manifest 和 HTML 里
        if nid not in self.nodes and nid not in self.leaves:
            raise InjectError(
                '注入被拒：%s 不在 manifest（%s）里。\n'
                '  → 要么 id 抄错/过期了，要么这块根本没进 dump —— 先把 manifest 对上，'
                '别往一个门核不到的地方塞东西。' % (nid, os.path.basename(self.manifest_path)))
        if 'data-node-id="%s"' % nid not in self.html:
            raise InjectError(
                '注入被拒：HTML 里没有 data-node-id="%s" 的元素。\n'
                '  → 注入会变成空操作而你不会察觉（2026-07-29 门体检就是这么把'
                '「错例没造出来」读成「门瞎了」的）。先确认骨架里建了这个节点。' % nid)

        w, h = self._dims(nid)
        if w is None or h is None:
            raise InjectError('注入被拒：%s 在 manifest 里没有 w/h，无法核对尺寸。' % nid)

        # ② SVG 固有尺寸必须等于节点真值
        sw, sh, how = svg_intrinsic_size(svg_text)
        if sw is None:
            raise InjectError('注入被拒：%s —— %s。没有固有尺寸就核不了层级，'
                              '导出时带上 viewBox。' % (nid, how))
        if abs(sw - w) > SIZE_TOL or abs(sh - h) > SIZE_TOL:
            if not allow_size_mismatch:
                msg = ['注入被拒：SVG 是 %g×%g（按 %s），而 %s「%s」是 %g×%g —— 对不上。'
                       % (sw, sh, how, nid, self._name(nid), w, h)]
                for kind, hid, hw, hh in self._suggest(nid, sw, sh):
                    msg.append('  → %s %s「%s」正好是 %g×%g，你要塞的多半是它。'
                               % (kind, hid, self._name(hid), hw, hh))
                msg.append('  → 这正是「星标塞进 19×18 的子节点、撑出 22×22 容器、中心低 2px」'
                           '那个错的形状（2026-09-01）。')
                msg.append('  → 确实要这么塞，传 allow_size_mismatch="理由"（理由会进 report，'
                           '不许传 True 蒙混）。')
                raise InjectError('\n'.join(msg))
            if allow_size_mismatch is True:
                raise InjectError('注入被拒：allow_size_mismatch 要传**理由字符串**，不是 True。'
                                  '豁免必须是声明式的。')
            self._log.append('⚠️ %s 尺寸不符已豁免（SVG %g×%g vs 节点 %g×%g）·理由：%s'
                             % (nid, sw, sh, w, h, allow_size_mismatch))

        # 反模式提醒：svg 自己带 node-id → geom 只能退回 AABB，preflight 也会硬拦
        if re.search(r'<svg\b[^>]*data-node-id=', svg_text, re.I):
            raise InjectError('注入被拒：这段 svg 自己带了 data-node-id。'
                              'SVG 没有 offsetWidth，geom 只能退回旋转后的 AABB＝必假红，'
                              'preflight 也会硬拦。node-id 留在外层 div 上。')
        # 内联 display 会被 preflight 硬拦（现役 J/K 两份稿就红在这条上）
        svg_text = re.sub(r'(<svg\b[^>]*?)\sstyle="[^"]*display\s*:[^"]*"',
                          r'\1', svg_text, count=1, flags=re.I)

        # ③ 有子节点就只能插入，不能替换
        has_kids = bool(self._kids.get(nid))
        lo, hi = _inner_span(self.html, nid)          # ④ 层级配对，不用非贪婪正则
        if lo < 0:
            raise InjectError('注入被拒：%s 的 div 层级配不上对（开闭标签不平衡？）。' % nid)
        if has_kids:
            self.html = self.html[:lo] + svg_text + self.html[lo:]
            how_in = '插入（该节点下还有 %d 个子节点，替换会把它们吃掉·coverage 要核销）' % len(self._kids[nid])
        else:
            self.html = self.html[:lo] + svg_text + self.html[hi:]
            how_in = '替换（该节点在 manifest 里没有子节点）'

        # ⑤⑥ 出 CSS。两种情况下「静态流」一定是错的，必须让 SVG 脱流铺满：
        #   a) 宿主有 padding → border-box 下 SVG 只拿得到内容区（翻页箭头 36×36 被压成 9×15 那个错）
        #   b) 宿主有子节点 → SVG 是插进去的，静态流里它跟子节点是**兄弟**，两个抢同一份空间
        #      （星标就是这种：22×22 容器里还有个 19×18 的「联集 22」；现役修好的稿用的正是 absolute 脱流。
        #       2026-09-01 拿真 K 骨架复演时才发现工具漏了这一半 —— 只判 padding 会给出跟已验证正确的稿
        #       不一样的结果。）
        # relative 和 absolute 永远成对出现，写不出「只加了 absolute 忘了 relative」那个 2026-07-29 的错。
        sel = _css_sel(nid)
        pads = [(self.nodes.get(nid) or {}).get(k) or 0 for k in ('pt', 'pr', 'pb', 'pl')]
        why = []
        if any(p > 0 for p in pads):
            why.append('自带 padding %g/%g/%g/%g（静态流只拿得到内容区 %g×%g）'
                       % (pads[0], pads[1], pads[2], pads[3],
                          w - pads[1] - pads[3], h - pads[0] - pads[2]))
        if has_kids:
            why.append('下面还有 %d 个子节点（静态流里 SVG 跟它们是兄弟，会互相挤）' % len(self._kids[nid]))
        if why:
            self._css.append('/* %s「%s」%s —— SVG 是整块图形，必须脱流铺满 */'
                             % (nid, self._name(nid), '；'.join(why)))
            self._css.append('%s{position:relative}' % sel)
            self._css.append('%s>svg{display:block;position:absolute;left:0;top:0;width:%gpx;height:%gpx}'
                             % (sel, w, h))
            how_css = '配了 relative+absolute 铺满（因为：%s）' % '；'.join(why)
        else:
            self._css.append('%s>svg{display:block}' % sel)
            how_css = '只配 display:block（宿主无 padding、无子节点，静态流就是对的）'

        self._log.append('✅ %s「%s」 %g×%g · %s · %s' % (nid, self._name(nid), w, h, how_in, how_css))
        return self

    @property
    def css(self):
        return '\n'.join(self._css)

    def finish(self, root=None, expect_kids=None):
        """结构自检 + 出报告。任何一条不过都抛 InjectError —— 别把破坏了的 DOM 写回稿子。"""
        problems = []
        n1 = self.html.count('data-node-id="')
        if n1 != self._n0:
            problems.append('data-node-id 总数从 %d 变成 %d —— 注入不该增删节点，'
                            '多半是替换吃掉了子节点（coverage 会当场少几个）' % (self._n0, n1))
        opens = len(re.findall(r'<div\b', self.html, re.I))
        closes = len(re.findall(r'</div\s*>', self.html, re.I))
        if opens != closes:
            problems.append('div 开闭不配平：%d 开 / %d 闭 —— 嵌套被顶乱了' % (opens, closes))
        if root and expect_kids is not None:
            kids = self.direct_kids(root)
            if len(kids) != expect_kids:
                problems.append('%s 的直接子元素应为 %d 个，实际 %d 个：%s'
                                % (root, expect_kids, len(kids), kids))
        if problems:
            raise InjectError('结构自检不过（别把这份 HTML 写回去）：\n  · ' + '\n  · '.join(problems))

        lines = ['内联 SVG 注入报告 · %d 处' % len(self._log)]
        lines += ['  ' + x for x in self._log]
        lines.append('  结构自检 ✅ node-id 总数 %d 不变 · div %d 对配平%s'
                     % (n1, opens, ('' if root is None else ' · %s 直接子元素 %d 个' % (root, expect_kids))))
        lines.append('  🔴 门只是兜底：注入完仍要跑 restore-gates（🧩 那一维专核这层），'
                     '并放大并排看一眼 —— 这层的新错法还会有。')
        return self.html, self.css, '\n'.join(lines)

    def direct_kids(self, nid):
        """列出该节点的直接子元素 node-id（用层级计数，不用正则贪婪匹配）。"""
        start, open_end = _find_open_tag(self.html, nid)
        if start < 0:
            return []
        depth, k, out = 0, start, []
        while True:
            m = _DIV.search(self.html, k)
            if not m:
                break
            if m.group(1) == '':
                depth += 1
                if depth == 2:
                    x = re.search(r'data-node-id="([^"]+)"', m.group(0))
                    out.append(x.group(1) if x else '?')
            else:
                depth -= 1
                if depth == 0:
                    break
            k = m.end()
        return out


if __name__ == '__main__':
    print(__doc__)
