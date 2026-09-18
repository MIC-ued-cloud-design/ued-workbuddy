/* 真 Electron 隔离实例：验两个窗口之间那条线。
   🔴 为什么非要这一套：flow-ui.e2e 验「控制台发什么指令」，ui.e2e 验「主窗口收到指令怎么反应」，
   中间那段（控制台 → 主进程转发 → 主窗口 → 探针 → 真页面）**两套都没覆盖**，只有真跑才验得到。
   2026-09-17 立此门时，前两套全绿而这一段从没跑过一次。

   跑法：npx electron _verify/edit/flow-iso.e2e.js
   它起一个用临时 userData 的独立实例，不碰你正在用的那个客户端。
   料＝工作区里的「20260917-多页面流程示例」，没有就跳过（不当失败，但会说一声）。 */
const { app, BrowserWindow } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os');
const DESK = path.join(__dirname, '..', '..');
const PROJ = '20260917-多页面流程示例';

let pass = 0, fail = 0;
const ok = (n, got, want) => {
  const good = typeof want === 'function' ? want(got) : JSON.stringify(got) === JSON.stringify(want);
  if (good) { pass++; console.log('✅', n); } else { fail++; console.log('❌', n, '\n    拿到：', JSON.stringify(got)); }
};

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'uw-iso-')));
process.on('uncaughtException', e => { console.log('💥', e.message); app.exit(1); });
const guard = setTimeout(() => { console.log('⏱ 看门狗超时（55 秒）——多半是窗口没起来'); app.exit(2); }, 55000);

require(path.join(DESK, 'main', 'main.js'));

app.whenReady().then(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const wsDir = path.join(os.homedir(), 'UW工作区', PROJ);
  if (!fs.existsSync(wsDir)) { console.log(`⚠️ 工作区里没有「${PROJ}」，这套门跳过（不是失败，是没料）`); clearTimeout(guard); app.exit(0); return; }

  await wait(3000);
  let wins = BrowserWindow.getAllWindows();
  ok('起来只有主窗口一个', wins.length, 1);
  const main = wins[0];
  if (!main) { app.exit(1); return; }

  const r = await main.webContents.executeJavaScript(`(async()=>{
    S.project={id:${JSON.stringify(PROJ)},name:'多页面流程示例',dir:'x',files:[{rel:'index.html'}]};
    S.previewFile='index.html';
    const a=await uw.flowOpen({id:${JSON.stringify(PROJ)}});
    FLOW.on=true; document.getElementById('btnFlow').classList.add('on');
    return a;})()`);
  ok('主窗口请求开控制台，主进程答应了', r && r.ok, true);
  await wait(3000);
  wins = BrowserWindow.getAllWindows();
  ok('控制台是**另一个窗口**（页面那个窗口保持干净，这是「不做在页面里」的落地方式）', wins.length, 2);
  const fw = wins.find(w => w !== main);
  if (!fw) { console.log('\n控制台窗口没开出来，后面的没法验'); clearTimeout(guard); app.exit(1); return; }

  ok('控制台标题显示项目名，不是「流程控制台」四个字', await fw.webContents.executeJavaScript(`document.getElementById('projName').textContent`), '多页面流程示例');
  const n = await fw.webContents.executeJavaScript(`({n:S.data&&S.data.n,scripts:S.data&&S.data.scripts.length})`);
  ok('控制台自己扫出了页 / 态 / 剧本（4 页 11 态 3 条主线）', n, x => x.n && x.n.pages === 4 && x.n.states === 11 && x.scripts === 3);
  ok('这个示例项目七道门全过（它是「对的样子」的参照物，红了说明门或示例坏了）', n.n, x => x.bad === 0 && x.warn === 0);

  /* 整条线：控制台点一格 → 主进程转发 → 主窗口换文件 → 探针换类 → 真页面上生效 */
  await fw.webContents.executeJavaScript(`goto('detail.html','error')`);
  await wait(2500);
  ok('控制台点一格，主窗口换到那一页那个态', await main.webContents.executeJavaScript(`({rel:S.previewFile,st:FLOW.state})`), { rel: 'detail.html', st: 'error' });
  /* on 是 2026-09-18 加的叠加开关那一维：两边高亮要说的是「哪一屏 + 哪个态 + 叠了什么」三件事。
     少比一件，叠加掉了也看不出来。 */
  ok('主窗口回报给控制台，两边高亮说的是同一件事（含叠加开关）', await fw.webContents.executeJavaScript(`S.at`), { rel: 'detail.html', state: 'error', on: [] });

  /* iframe 走自定义协议，渲染进程里跨源读不到 contentDocument；进子框架直接问才是结果侧的证据 */
  const frames = main.webContents.mainFrame.frames.filter(f => /uwproj/.test(f.url || ''));
  const real = frames.length ? await frames[0].executeJavaScript(`({cls:document.body.className,buy:getComputedStyle(document.querySelector('.buy')).display})`) : null;
  ok('🔴 状态类真的落到了页面上，而且真的生效了（.buy 被 display:none 掉）', real, x => x && /state-error/.test(x.cls) && x.buy === 'none');

  const before = fs.readFileSync(path.join(wsDir, 'detail.html'), 'utf8');
  ok('🔴 换态**没有写文件**——交付给前端的 HTML 里一行切态代码都没有', /<body class="state-default"/.test(before), true);

  /* 铺开：这一段只有真 Electron 验得到 —— flow-ui 那边的 flowHtml 是 mock 的，
     真实现要经过主进程读文件、prep 补 <base>、再回到控制台渲染。 */
  await fw.webContents.executeJavaScript(`(async()=>{ S.wall.rel='index.html'; document.querySelector('#tabs button[data-v="wall"]').click(); })()`);
  await wait(3000);
  const wall = await fw.webContents.executeJavaScript(`({
    tiles: document.querySelectorAll('.tile').length,
    caps: [...document.querySelectorAll('.tile-cap .n')].map(x=>x.textContent.trim()),
    cls: [...document.querySelectorAll('.tile iframe')].map(f=>{try{return f.contentDocument.body.className}catch(e){return 'x'}}),
    imgs: [...document.querySelectorAll('.tile iframe')].map(f=>{try{const i=f.contentDocument.querySelector('.empty-img img');return i?i.naturalWidth:-1}catch(e){return -2}}),
  })`);
  ok('铺开：这一页 4 个态铺了 4 张', wall.tiles, 4);
  ok('铺开：每张真的换成了那个态（不是四张一样的）', wall.cls, x => /state-default/.test(x[0]) && /state-empty/.test(x[1]) && /state-loading/.test(x[2]) && /state-guest/.test(x[3]));
  ok('🔴 缺省图在缩略图里真渲染出来了（主进程读文件 → prep → 控制台这条线通了）', wall.imgs, x => x.some(v => v === 296));
  const wide = fw.getBounds().width;
  ok('铺开把控制台窗口撑宽了（460 摆不下两张）', wide, w => w >= 900);
  await fw.webContents.executeJavaScript(`document.querySelector('#tabs button[data-v="grid"]').click()`);
  await wait(1500);
  ok('离开铺开窗口还原回窄的', fw.getBounds().width, w => w < 900);

  await fw.webContents.executeJavaScript(`setShow(true)`); await wait(1200);
  ok('展示模式：主窗口把对话区收掉，只剩画布', await main.webContents.executeJavaScript(`document.querySelector('.wk-body').classList.contains('canvas')`), true);
  await fw.webContents.executeJavaScript(`setShow(false)`); await wait(900);
  ok('退出展示：对话区回来', await main.webContents.executeJavaScript(`document.querySelector('.wk-body').classList.contains('canvas')`), false);

  fw.close(); await wait(1200);
  ok('关掉控制台窗口，主窗口那个按钮的高亮也撤（不然按钮说开着、其实没有）', await main.webContents.executeJavaScript(`document.getElementById('btnFlow').classList.contains('on')`), false);
  ok('关完只剩主窗口', BrowserWindow.getAllWindows().length, 1);

  console.log(`\n${pass} 项通过${fail ? ` · ${fail} 项红` : ''}`);
  clearTimeout(guard);
  app.exit(fail ? 1 : 0);
});
