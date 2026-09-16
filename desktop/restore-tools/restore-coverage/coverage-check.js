// coverage-check.js — 还原防漏「节点核销」门
// 用途：对比 manifest（该有的每个元素·Figma机器生成）vs coverage（我逐项核销的账本），
//       把「漏看漏做」从看不见变成清单上一条没打勾。
//       「完成」= manifest 每一项都被核销（built / merged / skip+reason），不靠肉眼扫。
//
// 用法：
//   node coverage-check.js --manifest /abs/x-manifest.json --coverage /abs/x-coverage.json
//   🔴 强烈建议加 --verify-dom（2026-07-21 根治「built 了但没打 tag→geom 跳过它→靠肉眼→漏整块视觉」）：
//     node coverage-check.js --manifest x-manifest.json --coverage x-coverage.json \
//          --verify-dom --url "file:///abs/x.html" --port 9224
//     它连真实 DOM，逐个验：status=built 的叶子**必须**有对应的 data-node-id 在 DOM 里（merged 验其 into 的 tag 在）。
//     没 tag = geom-check 永远核不到它 = 只能靠眼睛 → 判红。逼你要么打 tag(geom 自动覆盖)，要么老实 skip+reason。
//     闭合 coverage(有没有做)→tag→geom(做得对不对)，堵死「手写 built 蒙混、整块没进 geom」这条缝。
//
// manifest.json（figma-manifest.snippet.js 生成）：{ root, count, leaves:[{id,name,type,w,h,text?}] }
// coverage.json（我填的核销账本，键=节点id）：
//   {
//     "3007:470": {"status":"built","sel":".banner-title"},
//     "3007:471": {"status":"built","sel":".prod-card img"},
//     "3007:xxx": {"status":"merged","into":"3007:470","note":"合进标题行"},
//     "3007:yyy": {"status":"skip","reason":"纯装饰阴影层·无独立视觉元素"}
//   }
// 合法 status：built(建了·建议带 sel) / merged(并进别的·带 into) / skip(特意不做·必须带 reason)
// 判据：manifest 每一项都在 coverage 里且 status 合法；skip 必须有 reason → 才算全核销。

const fs = require('fs');
function arg(n, d){ const i=process.argv.indexOf('--'+n); if(i<0) return d; const v=process.argv[i+1]; return (v&&!v.startsWith('--'))?v:true; }

const mPath = arg('manifest'), cPath = arg('coverage');
if(!mPath){ console.log('ERR need --manifest'); process.exit(2); }

let manifest, coverage = {};
try { manifest = JSON.parse(fs.readFileSync(mPath,'utf8')); }
catch(e){ console.log('ERR 读不了 manifest: '+e.message); process.exit(2); }
if(cPath && fs.existsSync(cPath)){
  try { coverage = JSON.parse(fs.readFileSync(cPath,'utf8')); }
  catch(e){ console.log('ERR 读不了 coverage: '+e.message); process.exit(2); }
}

const leaves = manifest.leaves || [];
const VALID = ['built','merged','skip'];
const missing = [], bad = [];
const builtLeaves = [], mergedLeaves = [];
let ok = 0;

for(const leaf of leaves){
  const c = coverage[leaf.id];
  const tag = `${leaf.id} 「${leaf.name}」${leaf.type}${leaf.text?' ='+leaf.text:''}`;
  if(!c){ missing.push(tag); continue; }
  if(!VALID.includes(c.status)){ bad.push(`${tag} → status 非法:${c.status}`); continue; }
  if(c.status==='skip' && !c.reason){ bad.push(`${tag} → skip 必须给 reason`); continue; }
  if(c.status==='merged' && !c.into){ bad.push(`${tag} → merged 必须给 into`); continue; }
  if(c.status==='built') builtLeaves.push({id:leaf.id, tag});
  if(c.status==='merged') mergedLeaves.push({id:leaf.id, into:c.into, tag});
  ok++;
}
// 反向:coverage 里有、manifest 里没有的(过期/写错id)
const ids = new Set(leaves.map(l=>l.id));
const stale = Object.keys(coverage).filter(k=>!ids.has(k));

const total = leaves.length;

// ── --verify-dom（2026-07-21 根治「建了但没打 tag→geom 跳过它·靠眼睛→漏整块视觉」）──────────
// 闭合 coverage→tag→geom：built 的叶子必须在真实 DOM 里有对应 data-node-id（merged 验其 into 的 tag 在）。
// 没 tag = geom 永远核不到它 = 只能靠肉眼 → 判红。逼你要么打 tag（geom 自动覆盖），要么老实 skip+reason。
async function verifyDom(){
  const url = arg('url'); if(!url){ console.log('ERR --verify-dom 需要 --url'); process.exit(2); }
  const port = arg('port','9224');
  const puppeteer = require(require('path').join(__dirname,'..','online-reach','node_modules','puppeteer-core'));
  const b = await puppeteer.connect({ browserURL:'http://localhost:'+port, defaultViewport:{width:parseInt(arg('vw','1920'),10),height:parseInt(arg('vh','1080'),10)} });
  const p = await b.newPage();
  await p.goto(url, { waitUntil:'networkidle2', timeout:60000 });
  const domIds = new Set(await p.evaluate(()=>[...document.querySelectorAll('[data-node-id]')].map(e=>e.getAttribute('data-node-id'))));
  await p.close(); await b.disconnect();
  const untagged=[];
  for(const bl of builtLeaves){ if(!domIds.has(bl.id)) untagged.push(bl.tag+' → 声明 built 但 DOM 里无此 data-node-id（没打 tag→geom 核不到它=盲区）'); }
  for(const ml of mergedLeaves){ if(!domIds.has(ml.into)) untagged.push(ml.tag+` → merged into ${ml.into} 但 DOM 里无该父 tag`); }
  return untagged;
}

(async()=>{
  let untagged=[];
  const doVerify = !!arg('verify-dom');
  if(doVerify) untagged = await verifyDom();

  const accounted = ok, pct = total ? Math.round(accounted/total*100) : 100;
  console.log(`\n节点核销 · manifest=${total} 项  已核销=${accounted}  覆盖率=${pct}%${doVerify?'  · --verify-dom 已开(built 必须真打了 tag)':''}\n`);
  if(missing.length){ console.log(`❌ 未核销 ${missing.length} 项（= 漏看/漏做·每一条都要在 coverage 里交代）:`); missing.forEach(m=>console.log('   · '+m)); }
  if(bad.length){ console.log(`\n❌ 核销无效 ${bad.length} 项:`); bad.forEach(b=>console.log('   · '+b)); }
  if(untagged.length){ console.log(`\n❌ built 但没打 tag ${untagged.length} 项（geom 核不到→只能肉眼→漏。打 data-node-id 让 geom 覆盖，或标 skip+reason）:`); untagged.forEach(u=>console.log('   · '+u)); }
  if(stale.length){ console.log(`\n⚠️ coverage 里有 ${stale.length} 个 id 不在 manifest（写错/过期）: ${stale.join(', ')}`); }

  const pass = missing.length===0 && bad.length===0 && untagged.length===0;
  console.log(`\n结果：${pass?'全核销 ✅ 没有漏看漏做'+(doVerify?'·且 built 项都真打了 tag(geom 能覆盖)':''):'有 '+(missing.length+bad.length+untagged.length)+' 项没交代 ❌（补完再跑直到全核销）'}\n`);
  try {
    const os=require('os'), path=require('path');
    const sd=path.join(os.homedir(),'.online-reach-state'); fs.mkdirSync(sd,{recursive:true});
    // 记 verified：只有带 --verify-dom 的通过才算"真核过(built 都打了 tag→geom 覆盖)"；Stop 门据此只认 verified 的绿。
    // 记 sid（2026-07-26）：哪个会话跑绿的——Stop 门只认自己会话的 pass，防并发会话（微信桥无头会话）互相盖章。
    if(pass){ fs.writeFileSync(path.join(sd,'restore-coverage.pass'), JSON.stringify({t:Date.now(), verified:doVerify, sid:process.env.CLAUDE_CODE_SESSION_ID||''})); }
  } catch(e){}
  process.exit(pass?0:1);
})();
