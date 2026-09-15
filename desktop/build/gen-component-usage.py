#!/usr/bin/env python3
"""从 figma-usage.json 生成 packs/feique/COMPONENT-USAGE.md（组件用法清册）。

为什么要有（2026-09-15）：清册 web-components.json 里 43 个组件只有 Figma key 和节点号，
没有任何「这组件怎么用、有哪些 variant」的信息 —— 于是客户端做产品列表页时，
页脚直接留了占位（而 MIC Footer Search 在 Figma 里好好躺着，4 个断点都做齐了）。
数据是用 use_figma 的 Plugin API 逐页读出来的：name/key/id/尺寸/props/description。
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
P = os.path.join(HERE, '..', 'packs', 'feique')
data = json.load(open(os.path.join(P, 'figma-usage.json'), encoding='utf-8'))
meta = data.get('_meta', {})

L = []
L.append('# 飞鹊组件 · 用法清册（从 Figma 读出来的真值）\n')
L.append('**飞鹊最准的源头是 Figma 文件本身**，这份是从组件库里逐页读出来的：')
L.append('每个组件的 key、节点号、尺寸、**全部 variant 维度**、以及设计师写的组件说明。\n')
L.append('## 先读这三条\n')
L.append('1. 🔴 **props / variant 是机器读的，永远以它为准；description 是人写的，会过时。**')
L.append('   实例：`header-home` 的说明写「断点 768/1024/1280/1366/1440」，而实际 props 是')
L.append('   「1024/1280/1366/1440/**1920**」—— 说明少了 1920、多了个已经不存在的 768。')
L.append('   还有一些组件的 description 只是占位（形如 `fd_<组件名>`），等于没有说明。')
L.append('2. 🔴 **组件库页名里的符号：`✅` 和 `🤖` 都表示「已做完」，`❌` 表示「不需要做」**，')
L.append('   不是「没做」。别因为看到 ❌ 就以为不能用。')
L.append('3. 🔴 **这里列的是「有什么、什么规格」，不是「能直接抄的代码」。**')
L.append('   要真资产（页脚、产品卡、认证标的 SVG）得去 Figma 导，四步在文末。\n')
L.append('## 组件\n')

for group, items in data.items():
    if group.startswith('_'):
        continue
    L.append('### %s（%d）\n' % (group, len(items)))
    for it in items:
        head = '**%s**  `%s`  %s' % (it['n'], it['wh'], 'SET · %d 个 variant' % it['nv'] if it['nv'] else '单组件')
        L.append('- ' + head)
        if it.get('p'):
            dims = ' × '.join('%s(%s)' % (k, '/'.join(map(str, v)) if isinstance(v, list) else v)
                              for k, v in it['p'].items())
            L.append('  - variant：%s' % dims)
        if it.get('d'):
            L.append('  - %s' % it['d'])
        L.append('  - `key %s` · `node %s`' % (it['k'], it['id']))
    L.append('')

L.append('---\n')
L.append('## 要真资产怎么取（四步，别跳到「留占位」）\n')
L.append('```')
L.append('① ToolSearch("select:mcp__plugin_figma_figma__get_metadata,mcp__plugin_figma_figma__download_assets")')
L.append('   🔴 figma 的工具是延迟加载的，一开始不在工具表里，不先捞出来直接调会失败')
L.append('② get_metadata(fileKey, nodeId)        看结构，挑你要的那个 breakpoint 子节点 id')
L.append('③ download_assets(fileKey, 子节点id, defaultFormat 传 svg)')
L.append('④ curl -sL -o 文件 "URL"               URL 短命，立刻下')
L.append('   python3 tools/clean-figma-svg.py 文件   清掉 Figma 画布杂质（紫色虚线框、画布底色）')
L.append('```\n')
L.append('fileKey 是 `%s`。\n' % meta.get('source', '').split('fileKey ')[-1])
L.append('🔴 **「留灰色占位块」是导不到时的兜底，不是第一选择。没试过就留占位＝没做。**\n')
L.append('## 覆盖范围\n')
L.append('%s\n' % meta.get('covered', ''))
L.append('补抓方法：用 `use_figma` 对目标 page 跑一段只读脚本，取 `findAllWithCriteria({types:["COMPONENT_SET","COMPONENT"]})`')
L.append('里 `parent.type !== "COMPONENT_SET"` 的顶层节点，读 name/key/id/width/height/componentPropertyDefinitions/description，')
L.append('追加进 `figma-usage.json` 后重跑本脚本。**一个脚本只切一次页**，多页要并行发多个 use_figma 调用。\n')
L.append('由 `build/gen-component-usage.py` 生成。数据源 `packs/feique/figma-usage.json`（%s）。' % meta.get('date', ''))

out = os.path.join(P, 'COMPONENT-USAGE.md')
open(out, 'w', encoding='utf-8').write('\n'.join(L) + '\n')
n = sum(len(v) for k, v in data.items() if not k.startswith('_'))
print('写出 COMPONENT-USAGE.md（%d 个组件 / %d 组 / %d bytes）' % (n, len([k for k in data if not k.startswith('_')]), os.path.getsize(out)))
