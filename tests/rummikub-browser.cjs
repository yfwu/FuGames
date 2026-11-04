'use strict';
// Browser regression for the full-screen table. NODE_PATH and PLAYWRIGHT_BROWSERS_PATH may point to developer tooling.
// node tests/rummikub-browser.cjs   (writes screenshots and a report to docs/rummikub-2026-10-14/)
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),out=path.join(root,'docs/rummikub-2026-10-14');fs.mkdirSync(out,{recursive:true});
const html=fs.readFileSync(path.join(root,'rummikub.html'),'utf8'),box={module:{exports:{}},performance};
vm.runInNewContext(html.match(/<script id="rummikub-engine">([\s\S]*?)<\/script>/)[1],box);const E=box.module.exports;
const KEY='fulab-rummikub-v2-four',CAREER='fugames-rummikub-career';
const g=E.newGame(),deck=E.deck();const opening=[16,18,20];
g.racks[0]=opening.map(id=>deck[id]);const rest=deck.filter(t=>!opening.includes(t.id));let seed=42;for(let i=rest.length-1;i>0;i--){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const j=seed%(i+1);[rest[i],rest[j]]=[rest[j],rest[i]];}g.racks[0].push(...rest.splice(0,11));
for(let i=1;i<4;i++)g.racks[i]=rest.splice(0,14);g.pool=rest;g.turn=0;g.difficulty='strong';assert.ok(E.audit(g));
// Old-format save (no rules/stats fields), as written by the previous version of the page.
const legacy=JSON.parse(JSON.stringify(g));delete legacy.rules;delete legacy.stats;
// Endgame: you have opened and hold exactly one 30-point run.
function endgame(){const e=E.newGame(),d=E.deck(),mine=[16,18,20].map(id=>d[id]),others=d.filter(t=>![16,18,20].includes(t.id));
 e.racks[0]=mine;for(let i=1;i<4;i++)e.racks[i]=others.splice(0,6);e.pool=others;e.turn=0;e.opened=[true,true,true,true];e.difficulty='novice';assert.ok(E.audit(e));return e;}
const report={checks:[],errors:[],externalRequests:[],viewports:[]};const check=(name,condition=true)=>{assert.ok(condition,name);report.checks.push(name);console.log('ok -',name);};
const server=http.createServer((req,res)=>{const file=path.join(root,decodeURIComponent(new URL(req.url,'http://local').pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}fs.readFile(file,(err,data)=>{if(err){res.writeHead(404).end();return;}const types={'.css':'text/css','.svg':'image/svg+xml','.js':'text/javascript','.html':'text/html'};res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(data);});});
const GL=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'];
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true,args:GL});
 async function context(options={},{game=g,fallback=false,career=null}={}){
  const ctx=await browser.newContext(options);
  await ctx.addInitScript(({game,fallback,career,KEY,CAREER})=>{if(game&&!localStorage.getItem(KEY))localStorage.setItem(KEY,JSON.stringify(game));if(career&&!localStorage.getItem(CAREER))localStorage.setItem(CAREER,JSON.stringify(career));if(fallback)window.Worker=undefined;},{game,fallback,career,KEY,CAREER});
  const page=await ctx.newPage();page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  page.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('blob:')&&!r.url().startsWith('data:'))report.externalRequests.push(r.url());});return{ctx,page};
 }
 const saved=p=>p.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
 const {ctx,page}=await context({viewport:{width:1440,height:900}},{game:legacy});
 await page.goto(base+'/archive.html');await page.locator('a[href="rummikub.html"]').first().click();await page.waitForURL(/rummikub/);
 check('catalogue opens Rummikub',page.url().endsWith('/rummikub.html'));
 check('legacy save loads into the four-seat table',await page.locator('#rack .tile').count()===14&&await page.locator('.opponent-chip').count()===3&&await page.locator('#lobby').isHidden());
 check('full-screen: no page scroll',await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1&&document.documentElement.scrollWidth<=innerWidth));
 await page.waitForFunction(()=>!document.body.classList.contains('no3d')&&document.querySelector('#scene').width>0);check('three.js table renders',true);
 let workers=0;page.on('worker',()=>workers++);
 async function drag(p,from,to){const a=await p.locator(from).boundingBox(),b=await p.locator(to).boundingBox();await p.mouse.move(a.x+a.width/2,a.y+a.height/2);await p.mouse.down();await p.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:12});await p.mouse.up();}
 await drag(page,'#rack .tile[data-id="16"]','#board');check('desktop pointer drag creates draft',await page.locator('#board .tile').count()===1);check('new tile marked',await page.locator('#board .new-this-turn').count()===1);
 await page.click('#undoBtn');check('undo returns physical tile',await page.locator('#rack .tile').count()===14);
 await page.waitForTimeout(550);for(const id of opening)await page.locator(`#rack [data-id="${id}"]`).click();await page.click('#newMeldBtn');check('30-point opening assembled',await page.locator('#board .tile').count()===3);
 check('meld label shows type and points',(await page.locator('#board .meld').getAttribute('data-label')).includes('30'));
 await page.click('#commitBtn');await page.waitForFunction(()=>document.querySelector('#turnPill').textContent.includes('你的回合')&&!document.querySelector('#drawBtn').disabled,{},{timeout:30000});
 let s=await saved(page);check('opening commits and three AIs return to player',s.opened[0]&&s.round===5&&E.audit(s)&&s.stats.played===3&&s.stats.openTurn===1);check('Blob Worker executes AI',workers>0);
 await page.reload();check('completed turn survives reload',await page.locator('#rack .tile').count()===s.racks[0].length);
 await page.click('#settingsBtn');await page.click('#tab-settings');await page.selectOption('#difficulty','expert');check('difficulty select lives in the drawer',(await saved(page)).difficulty==='expert');
 await page.click('#tab-rules');check('rules tab opens',await page.locator('#panel-rules').isVisible());await page.keyboard.press('Escape');await page.waitForTimeout(600);
 check('drawer closes with Escape',!(await page.locator('#menu').evaluate(el=>el.classList.contains('is-open'))));
 await page.click('#newBtn');check('new game opens the lobby',await page.locator('#lobby').isVisible());
 check('locked variants show their level',await page.locator('[data-setup="opening"] button[value="50"]').isDisabled());
 await page.click('#resumeBtn');check('resume keeps the current game',await page.locator('#lobby').isHidden()&&(await saved(page)).round===5);
 await page.screenshot({path:path.join(out,'desktop.png')});
 await page.getByRole('link',{name:'回遊戲室 · FuGames'}).click();check('return navigation works',page.url().endsWith('/index.html'));await ctx.close();

 // Result screen, XP and progression.
 const fin=await context({viewport:{width:1440,height:900}},{game:endgame()});const fp=fin.page;await fp.goto(base+'/rummikub.html');
 for(const id of opening)await fp.locator(`#rack [data-id="${id}"]`).click();await fp.click('#newMeldBtn');await fp.click('#commitBtn');
 await fp.waitForSelector('#resultDialog:not([hidden])');check('emptying the rack shows the result curtain',(await fp.locator('#resultTitle').textContent()).includes('你贏了'));
 const career=await fp.evaluate(k=>JSON.parse(localStorage.getItem(k)),CAREER);check('career recorded once with XP',career.games===1&&career.wins===1&&career.xp>0);
 check('XP lines listed',await fp.locator('#resultXP dt').count()>=3);
 await fp.reload();await fp.waitForSelector('#resultDialog:not([hidden])');check('reload does not double-count XP',(await fp.evaluate(k=>JSON.parse(localStorage.getItem(k)),CAREER)).games===1);
 await fp.screenshot({path:path.join(out,'desktop-result.png')});
 await fp.click('#resultLobby');check('result → lobby',await fp.locator('#lobby').isVisible());await fin.ctx.close();

 // Fresh visit: lobby first; unlocked variants (via a saved career) start a timed series against novices.
 const fresh=await context({viewport:{width:390,height:844},isMobile:true,hasTouch:true},{game:null,career:{v:1,xp:5000}});const np=fresh.page;await np.goto(base+'/rummikub.html');
 check('first visit shows the lobby',await np.locator('#lobby').isVisible());
 for(const [k,v] of [['difficulty','novice'],['timer','30'],['series','3'],['hand','10']])await np.locator(`[data-setup="${k}"] button[value="${v}"]`).tap();
 await np.screenshot({path:path.join(out,'mobile-lobby.png')});
 await np.locator('#confirmNew').tap();await np.waitForFunction(()=>document.querySelector('#turnPill').textContent.includes('你的回合'),{},{timeout:30000});
 s=await saved(np);check('variants applied to the new game',s.rules.timer===30&&s.rules.hand===10&&s.series.games===3&&s.difficulty==='novice'&&s.racks[0].length===10);
 check('turn clock visible',await np.locator('#clock').isVisible());check('series label visible',(await np.locator('#seriesLabel').textContent()).includes('1/3'));
 await fresh.ctx.close();

 // Phone: touch drag and the button alternative.
 const mobile=await context({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});const p=mobile.page;await p.goto(base+'/rummikub.html');const cdp=await mobile.ctx.newCDPSession(p);
 const a=await p.locator('#rack [data-id="16"]').boundingBox(),b=await p.locator('#board').boundingBox();const x=a.x+a.width/2,y=a.y+a.height/2,tx=b.x+b.width/2,ty=b.y+b.height/2;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+(tx-x)*i/8,y:y+(ty-y)*i/8}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 check('mobile native emulated touch drag',await p.locator('#board .tile').count()===1);await p.waitForTimeout(100);await p.locator('#undoBtn').tap();check('mobile undo',await p.locator('#rack .tile').count()===14);
 await p.waitForTimeout(550);for(const id of opening)await p.locator(`#rack [data-id="${id}"]`).tap();await p.locator('#newMeldBtn').tap();check('mobile multi-select button alternative',await p.locator('#board .tile').count()===3);
 await p.screenshot({path:path.join(out,'mobile.png')});
 for(const viewport of [{width:390,height:844},{width:320,height:568},{width:844,height:390}]){await p.setViewportSize(viewport);await p.waitForTimeout(200);const o=await p.evaluate(()=>({h:document.documentElement.scrollWidth>innerWidth,v:document.documentElement.scrollHeight>innerHeight+1,dock:document.querySelector('#commitBtn').getBoundingClientRect().bottom<=innerHeight+1}));check(`no overflow, dock visible ${viewport.width}x${viewport.height}`,!o.h&&!o.v&&o.dock);report.viewports.push(viewport);}
 await mobile.ctx.close();
 const fallback=await context({viewport:{width:1280,height:800}},{fallback:true});await fallback.page.goto(base+'/rummikub.html');await fallback.ctx.setOffline(true);await fallback.page.click('#hintBtn');await fallback.page.waitForFunction(()=>!document.querySelector('#hintBtn').disabled&&document.querySelectorAll('#board .tile').length>0);check('offline hint works without Worker',await fallback.page.locator('#board .tile').count()>0);await fallback.page.click('#undoBtn');check('hint remains reversible',await fallback.page.locator('#rack .tile').count()===14);await fallback.ctx.close();
 check('no JavaScript errors',report.errors.length===0);check('no external network dependencies',report.externalRequests.length===0);
 await browser.close();server.close();fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify(report,null,2)+'\n');console.log(`${report.checks.length} checks passed`);
})().catch(e=>{console.error(e,report.errors);server.close();process.exit(1);});
