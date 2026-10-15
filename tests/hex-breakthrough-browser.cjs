'use strict';
const {chromium,webkit}=require('playwright'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),out=process.env.QA_OUT||path.join(root,'docs/hex-breakthrough-2026-10-15');fs.mkdirSync(out,{recursive:true});
const server=http.createServer((q,r)=>{const pathname=new URL(q.url,'http://local').pathname,file=path.join(root,pathname);fs.readFile(file,(e,b)=>{r.writeHead(e?404:200,{'Content-Type':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':file.endsWith('.svg')?'image/svg+xml':'text/html'});r.end(e?'':b);});});
async function tapCell(page,i){await page.locator('#board').evaluate(el=>el.scrollIntoView({block:'center'}));await page.evaluate(i=>autoHexFocusCell(i),i);const p=await page.evaluate(i=>autoHexCellPoint(i),i);await page.mouse.click(p.x,p.y);}
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=(process.env.FUGAMES_BASE_URL||`http://127.0.0.1:${server.address().port}`).replace(/\/$/,''),report={base,cases:[]};try{
 for(const [name,type]of Object.entries({chromium,webkit})){const browser=await type.launch(name==='chromium'&&process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{});try{for(const [width,height]of [[1440,1000],[390,844],[844,390]])for(const file of ['autohex.html','card_hex.html']){
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:width<1000?2:1,isMobile:width<1000,hasTouch:width<1000}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));const tag=`${name}-${width}-${file.split('.')[0]}`;
  await page.goto(`${base}/${file}?seed=breach-ui-fixed`);await page.waitForFunction(()=>window.autoHexGame&&document.querySelector('#breach'));
  await page.locator('#step-seconds').fill('10');await page.locator('#play').click();
  assert.match(await page.locator('#breach-note').innerText(),/24.*6/);assert.equal(await page.locator('#breach').isDisabled(),true);
  const target=await page.evaluate(()=>{
   const g=autoHexGame,H=HexAPI,p=1;g.turn=p;g.terrain.fill(0);g.airports=[];g.depots=[];g.turrets=[];g.hands[p]=[];g.handAges[p]=[];g._draw=()=>{};
   const pl=g.players[p],own=H.computeSupply(g,p),t=H.CELLS.find(c=>!g.board[c.i]&&H.ADJ[c.i].filter(j=>own[j]).length===1&&H.ADJ[c.i].some(j=>own[j]&&c[pl.axis]*pl.sign<H.CELLS[j][pl.axis]*pl.sign)).i;
   g.board[t]=2;for(const i of H.ADJ[t])if(!g.board[i])g.board[i]=2;Object.assign(pl,{energy:8,breachReady:true});g._countStones();autoHexRender();autoHexSchedule();return t;
  });
  assert.equal(await page.locator('#breach').isEnabled(),true);await page.locator('#breach').click();assert.match(await page.locator('#selection-label').innerText(),/破陣令/);await tapCell(page,target);
  const marked=await page.evaluate(()=>({target:autoHexGame.players[1].breachTarget,used:autoHexGame.players[1].breachUsed,ply:autoHexGame.ply,energy:autoHexGame.players[1].energy}));assert.equal(marked.target,target);assert.equal(marked.used,true);assert.equal(marked.energy,2);
  assert.match(await page.locator('#player-1').innerText(),/破陣預告/);
  if(name==='chromium')await page.screenshot({path:path.join(out,tag+'-warning.png')});
  await page.locator('#pause').click();const paused=await page.evaluate(()=>autoHexGame.ply);await page.waitForTimeout(180);assert.equal(await page.evaluate(()=>autoHexGame.ply),paused);
  await page.evaluate(()=>{const g=autoHexGame;g.start();while(g.turn!==1)g.act({type:'rest',cells:[]});autoHexRender();autoHexSchedule();});
  await page.locator('#deploy').click();await tapCell(page,target);
  assert.equal(await page.evaluate(i=>autoHexGame.board[i],target),1);const spent=await page.evaluate(()=>({ply:autoHexGame.ply,energy:autoHexGame.players[1].energy}));await tapCell(page,target);assert.deepEqual(await page.evaluate(()=>({ply:autoHexGame.ply,energy:autoHexGame.players[1].energy})),spent);
  await page.locator('#pause').click();await page.locator('#pause').click();await page.locator('#pause').click();assert.equal(await page.evaluate(()=>autoHexGame.phase),'paused');
  await page.locator('#restart').click();assert.equal(await page.evaluate(()=>autoHexGame.ply),0);assert.equal(await page.evaluate(()=>autoHexGame.players[1].breachUsed),false);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert.ok(overflow<=1,tag+' horizontal overflow '+overflow);assert.deepEqual(errors,[]);
  report.cases.push({tag,viewport:{width,height},warning:marked,pausedNoAdvance:true,captured:true,repeatedClickNoSpend:true,restartCleared:true,overflow,errors});await context.close();
 }}finally{await browser.close();}}
 fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({cases:report.cases.length,errors:0,base}));
}finally{server.close();}})().catch(e=>{console.error(e);process.exit(1)});
