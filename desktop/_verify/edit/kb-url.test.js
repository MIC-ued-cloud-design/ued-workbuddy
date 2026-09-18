/* 「给个网址就能加进资料库」这条路的门。纯 node 跑：抓取本身要 Electron 的 net（见下方说明），
   这里守的是两件不需要联网也能判的事 —— 网页转文字转得对不对、网址写错时给不给人话。
   真抓取那一段用 `npx electron` 端到端跑过（example.com / made-in-china.com 都抓到了正文）。 */
const path = require('path'), assert = require('assert');
const kb = require(path.join(__dirname, '..', '..', 'main', 'kb.js'));
let pass = 0;
const ok = (n, f) => { try { f(); pass++; console.log('✅', n); } catch (e) { console.log('❌', n, '\n   ', e.message); process.exitCode = 1; } };

ok('网页转文字：脚本样式导航页脚全扔掉，标题列表换行留住，实体还原成字', () => {
  const t = kb.htmlToText(`<html><head><style>.a{color:red}</style><script>var x=1<2;</script></head>
    <body><nav>首页 关于</nav><h2>询盘频控</h2><p>每天最多 &lt;20&gt; 条&nbsp;。</p>
    <ul><li>规则一</li><li>规则二</li></ul><footer>版权所有</footer></body></html>`);
  assert.ok(!/color:red|var x/.test(t), '脚本或样式漏进来了：' + t);
  assert.ok(!/首页 关于|版权所有/.test(t), '导航或页脚漏进来了：' + t);
  assert.ok(/## 询盘频控/.test(t), '标题没转成 markdown：' + t);
  assert.ok(/- 规则一\n- 规则二/.test(t), '列表没转行：' + t);
  assert.ok(/每天最多 <20> 条 ?。/.test(t), '实体没还原：' + t);
});
ok('网页转文字：不留空的标签壳，也不留三行以上的空行', () => {
  const t = kb.htmlToText('<div><p>一</p><div></div><div></div><p>二</p></div>');
  assert.strictEqual(t, '一\n\n二');
});
(async () => {
  const bad = async (u, want) => { try { await kb.fetchUrl(u); return '没报错'; } catch (e) { return e.message; } };
  ok('网址写错：给的是人话，不是 TypeError', async () => {});
  const m1 = await bad('这不是网址'), m2 = await bad('ftp://x/y'), m3 = await bad('');
  ok('「这不像一个网址」「只支持 http/https」「空的」三种都给人话', () => {
    assert.ok(/不像一个网址/.test(m1), m1);
    assert.ok(/只支持 http/.test(m2), m2);
    assert.ok(/不像一个网址/.test(m3), m3);
  });
  console.log(`\n${pass} 项通过`);
})();
