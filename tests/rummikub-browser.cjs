'use strict';
// NODE_PATH and PLAYWRIGHT_BROWSERS_PATH may point to temporary developer tooling.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),out=path.join(root,'docs/rummikub-2026-10-14');fs.mkdirSync(out,{recursive:true});
const html=fs.readFileSync(path.join(root,'rummikub.html'),'utf8'),box={module:{exports:{}},performance};
vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],box);const E=box.module.exports;
const g=E.newGame(),deck=E.deck();const opening=[16,18,20];
g.racks[0]=opening.map(id=>deck[id]);const rest=deck.filter(t=>!opening.includes(t.id));let seed=42;for(let i=rest.length-1;i>0;i--){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const j=seed%(i+1);[rest[i],rest[j]]=[rest[j],rest[i]];}g.racks[0].push(...rest.splice(0,11));
for(let i=1;i<4;i++)g.racks[i]=rest.splice(0,14);g.pool=rest;g.turn=0;g.difficulty='strong';assert.ok(E.audit(g));
const report={checks:[],errors:[],externalRequests:[],viewports:[]};const check=(name,condition=true)=>{assert.ok(condition,name);report.checks.push(name);console.log(name);};
const server=http.createServer((req,res)=>{const file=path.join(root,new URL(req.url,'http://local').pathname);if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}fs.readFile(file,(err,data)=>{if(err){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html');res.end(data);});});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true});
 async function context(options={},fallback=false){const ctx=await browser.newContext(options);await ctx.addInitScript(({game,fallback})=>{if(!localStorage.getItem('fulab-rummikub-v2-four'))localStorage.setItem('fulab-rummikub-v2-four',JSON.stringify(game));if(fallback)window.Worker=undefined;},{game:g,fallback});const page=await ctx.newPage();page.on('pageerror',e=>report.errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('blob:')&&!r.url().startsWith('data:'))report.externalRequests.push(r.url());});return{ctx,page};}
 const {ctx,page}=await context({viewport:{width:1440,height:1000}});
 await page.goto(base+'/index.html');await page.getByRole('link',{name:'開始遊玩四人拉密',exact:true}).click();
 check('homepage opens Rummikub',page.url().endsWith('/rummikub.html'));check('initial four-seat fixture',await page.locator('#rack .tile').count()===14&&await page.locator('.opponent-chip').count()===3);
 let workers=0;page.on('worker',()=>workers++);
 async function drag(p,from,to){const a=await p.locator(from).boundingBox(),b=await p.locator(to).boundingBox();await p.mouse.move(a.x+a.width/2,a.y+a.height/2);await p.mouse.down();await p.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:12});await p.mouse.up();}
 await drag(page,'#rack .tile[data-id="16"]','#board');check('desktop pointer drag creates draft',await page.locator('#board .tile').count()===1);check('new tile glows',await page.locator('#board .new-this-turn').count()===1);await page.click('#undoBtn');check('undo returns physical tile',await page.locator('#rack .tile').count()===14);
 await page.waitForTimeout(550);for(const id of opening)await page.locator(`#rack [data-id="${id}"]`).click();await page.click('#newMeldBtn');check('30-point opening assembled',await page.locator('#board .tile').count()===3);await page.click('#commitBtn');await page.waitForFunction(()=>document.querySelector('#turnPill').textContent.includes('你的回合')&&!document.querySelector('#drawBtn').disabled,{},{timeout:20000});
 let saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('fulab-rummikub-v2-four')));check('opening commits and three AIs return to player',saved.opened[0]&&saved.round===5&&E.audit(saved));check('Blob Worker executes AI',workers>0);
 await page.reload();check('completed turn survives reload',await page.locator('#rack .tile').count()===saved.racks[0].length);
 await page.click('#settingsBtn');await page.selectOption('#difficulty','expert');await page.click('#rulesBtn');check('rules dialog opens',await page.locator('#rulesDialog').isVisible());await page.locator('#rulesDialog .close-dialog').click();
 await page.click('#newBtn');await page.locator('#newDialog .close-dialog').first().click();check('cancel new game preserves round',await page.evaluate(()=>JSON.parse(localStorage.getItem('fulab-rummikub-v2-four')).round)===5);
 await page.screenshot({path:path.join(out,'desktop.png'),fullPage:true});await page.getByRole('link',{name:'回遊戲室'}).click();check('return navigation works',page.url().endsWith('/index.html'));await ctx.close();
 const mobile=await context({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});const p=mobile.page;await p.goto(base+'/rummikub.html');const cdp=await mobile.ctx.newCDPSession(p);
 const a=await p.locator('#rack [data-id="16"]').boundingBox(),b=await p.locator('#board').boundingBox();const x=a.x+a.width/2,y=a.y+a.height/2,tx=b.x+b.width/2,ty=b.y+b.height/2;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+(tx-x)*i/8,y:y+(ty-y)*i/8}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 check('mobile native emulated touch drag',await p.locator('#board .tile').count()===1);await p.locator('#undoBtn').tap();check('mobile undo',await p.locator('#rack .tile').count()===14);
 await p.waitForTimeout(550);for(const id of opening)await p.locator(`#rack [data-id="${id}"]`).tap();await p.locator('#newMeldBtn').tap();check('mobile multi-select button alternative',await p.locator('#board .tile').count()===3);
 await p.screenshot({path:path.join(out,'mobile.png'),fullPage:true});
 for(const viewport of [{width:390,height:844},{width:320,height:568},{width:844,height:390}]){await p.setViewportSize(viewport);const overflow=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth);check(`no horizontal overflow ${viewport.width}x${viewport.height}`,!overflow);report.viewports.push(viewport);}
 await mobile.ctx.close();
 const fallback=await context({viewport:{width:1280,height:800}},true);await fallback.page.goto(base+'/rummikub.html');await fallback.ctx.setOffline(true);await fallback.page.click('#hintBtn');await fallback.page.waitForFunction(()=>!document.querySelector('#hintBtn').disabled&&document.querySelectorAll('#board .tile').length>0);check('offline hint works without Worker',await fallback.page.locator('#board .tile').count()>0);await fallback.page.click('#undoBtn');check('hint remains reversible',await fallback.page.locator('#rack .tile').count()===14);await fallback.ctx.close();
 check('no JavaScript errors',report.errors.length===0);check('no external network dependencies',report.externalRequests.length===0);
 await browser.close();server.close();fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);server.close();process.exit(1);});
