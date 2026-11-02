'use strict';
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),out=process.env.QA_OUT||path.join(root,'docs/hex-logistics-2026-11-02');fs.mkdirSync(out,{recursive:true});
const server=http.createServer((q,r)=>{const f=path.join(root,new URL(q.url,'http://local').pathname);fs.readFile(f,(e,b)=>{r.writeHead(e?404:200,{'Content-Type':f.endsWith('.js')?'application/javascript':f.endsWith('.css')?'text/css':f.endsWith('.json')?'application/json':f.endsWith('.svg')?'image/svg+xml':'text/html'});r.end(e?'':b);});});
async function clickCell(page,i){await page.locator('#board').scrollIntoViewIfNeeded();await page.evaluate(i=>autoHexFocusCell(i),i);const p=await page.evaluate(i=>autoHexCellPoint(i),i);await page.mouse.click(p.x,p.y);}
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=(process.env.FUGAMES_BASE_URL||`http://127.0.0.1:${server.address().port}`).replace(/\/$/,''),browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'}),report={base,cases:[]};try{
 for(const width of [1440,390,320])for(const file of ['autohex.html','card_hex.html']){
  const page=await browser.newPage({viewport:{width,height:width<1000?844:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`${base}/${file}?seed=supply-browser`);await page.waitForFunction(()=>window.autoHexGame);
  await page.locator('#step-seconds').fill('10');await page.locator('#play').click();
  const target=await page.evaluate(()=>{const g=autoHexGame,H=HexAPI;return H.CELLS.find(c=>!g.board[c.i]&&H.legalAction(g,{type:'deploy',cells:[c.i]})).i;});
  await clickCell(page,target);assert.equal(await page.evaluate(i=>autoHexGame.board[i],target),1);assert.ok(await page.evaluate(i=>autoHexGame.reserve[i]>=3,target));
  await page.locator('#pause').click();const ply=await page.evaluate(()=>autoHexGame.ply);await page.waitForTimeout(120);assert.equal(await page.evaluate(()=>autoHexGame.ply),ply);
  // Explicit deterministic cutoff/reconnection scenario, shown through real UI.
  const front=await page.evaluate(()=>{const g=autoHexGame,H=HexAPI;g.board.fill(0);g.anchors.fill(0);g.terrain.fill(0);g.reserve.fill(0);g.bridges=[];g.tunnels=[];g.turrets=[];g.airports=[];g.depots=[];g.players[1].home=H.index(0,0);g.players[1].supplies=24;for(let q=0;q<5;q++){const i=H.index(q,0);g.board[i]=1;g.reserve[i]=q>1?3:6;}g.anchors[H.index(0,0)]=1;g._remove(H.index(1,0));g._settleSupply(1);g._countStones();autoHexRender();return H.index(3,0);});
  await page.locator('#inspect-mode').click();await clickCell(page,front);assert.match(await page.locator('#cell-info').innerText(),/路線切斷.*存糧 2\/6.*上次送達 0/);
  await page.screenshot({path:path.join(out,`${file.split('.')[0]}-${width}-cut.png`)});
  await page.evaluate(()=>{const g=autoHexGame,H=HexAPI,i=H.index(1,0);g.board[i]=1;g.reserve[i]=6;g._settleSupply(1);g._countStones();autoHexRender();});
  await clickCell(page,front);assert.match(await page.locator('#cell-info').innerText(),/路線連通.*存糧 [34]\/6.*上次送達 [12]/);assert.match(await page.locator('#supplies').innerText(),/上次送達/);
  await page.screenshot({path:path.join(out,`${file.split('.')[0]}-${width}-reconnected.png`)});
  await page.locator('#restart').click();assert.equal(await page.evaluate(()=>autoHexGame.ply),0);assert.equal(await page.evaluate(()=>autoHexGame.players[1].supplies),12);assert.ok(await page.evaluate(()=>autoHexGame.delivered.every(n=>!n)));
  await page.locator('#match-mode').selectOption('spectator');if(file==='card_hex.html')await page.locator('#seat-count').selectOption('2');await page.locator('#step-seconds').fill('0.05');await page.locator('#play').click();await page.waitForFunction(()=>autoHexGame.ply>=3);await page.locator('#pause').click();const aiPly=await page.evaluate(()=>autoHexGame.ply);assert.ok(aiPly>=3);assert.equal(await page.evaluate(()=>autoHexUI().coreConfig.playerCount),file==='card_hex.html'?2:6);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert.ok(overflow<=1);assert.deepEqual(errors,[]);report.cases.push({file,width,humanDeploy:true,pause:true,cutReserve:2,reconnected:true,restart:true,aiPly,overflow,errors});await page.close();
 }
 fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
 }finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exit(1)});
