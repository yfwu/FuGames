'use strict';
// Large hands and tables on the full-screen layout: the page never scrolls; the board and the rack scroll inside
// their own regions, every tile stays reachable and selectable. Playwright is development-only.
// WebKit runs too when it is installed; otherwise only Chromium.
const pw=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),out=path.join(root,'docs/rummikub-overflow-2026-10-14');fs.mkdirSync(out,{recursive:true});
const html=fs.readFileSync(path.join(root,'rummikub.html'),'utf8'),sandbox={module:{exports:{}},performance};
vm.runInNewContext(html.match(/<script id="rummikub-engine">([\s\S]*?)<\/script>/)[1],sandbox);const E=sandbox.module.exports;
const KEY='fulab-rummikub-v2-four';
function fixture(size,largeBoard=false){
 const g=E.newGame(),deck=E.deck();g.board=[];
 if(largeBoard)for(let c=0;c<4;c++){g.board.push(deck.filter(t=>t.c===c&&t.id%2===0));for(const start of [1,4])g.board.push(deck.filter(t=>t.c===c&&t.id%2===1&&t.n>=start&&t.n<start+3));}
 const used=new Set(g.board.flat().map(t=>t.id)),rest=deck.filter(t=>!used.has(t.id));
 const ids=largeBoard?[]:[16,18,20,104];g.racks[0]=ids.map(id=>rest.splice(rest.findIndex(t=>t.id===id),1)[0]);g.racks[0].push(...rest.splice(0,size-g.racks[0].length));
 for(let i=1;i<4;i++)g.racks[i]=rest.splice(0,1);g.pool=rest;g.turn=0;g.opened=[largeBoard,true,true,true];g.difficulty='strong';assert.ok(E.audit(g));return g;
}
const server=http.createServer((req,res)=>{const file=path.join(root,decodeURIComponent(new URL(req.url,'http://local').pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}fs.readFile(file,(err,data)=>{if(err){res.writeHead(404).end();return;}const types={'.css':'text/css','.svg':'image/svg+xml','.js':'text/javascript','.html':'text/html'};res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(data);});});
const report={checks:[],errors:[],skipped:[]};let current;
const check=(name,yes)=>{assert.ok(yes,name);report.checks.push(name);};
async function metrics(page){return page.evaluate(()=>{const rack=document.querySelector('#rack'),board=document.querySelector('#board'),d=document.documentElement;
 const meldClipped=[...board.querySelectorAll('.tile')].filter(t=>{const a=t.closest('.meld').getBoundingClientRect(),b=t.getBoundingClientRect();return b.left<a.left-1||b.right>a.right+1;}).length;
 return{rackCount:rack.querySelectorAll('.tile').length,boardCount:board.querySelectorAll('.tile').length,meldClipped,rackScrolls:rack.scrollHeight>rack.clientHeight,overflowX:d.scrollWidth>innerWidth+1,overflowY:d.scrollHeight>innerHeight+1,dock:document.querySelector('.dock').getBoundingClientRect().bottom<=innerHeight+1};});}
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=process.env.FUGAMES_BASE_URL||`http://127.0.0.1:${server.address().port}`;
 for(const name of ['chromium','webkit']){
 let browser;try{browser=await pw[name].launch({headless:true,args:name==='chromium'?['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']:[]});}catch(e){report.skipped.push(name+': '+e.message.split('\n')[0]);console.log('skip',name);continue;}
 try{
 for(const vp of [{width:390,height:844},{width:320,height:568},{width:844,height:390},{width:1440,height:900}]){
 const mobile=vp.width<1000,ctx=await browser.newContext({viewport:vp,isMobile:mobile&&name==='chromium',hasTouch:mobile,deviceScaleFactor:1}),page=await ctx.newPage();current=page;page.on('pageerror',e=>report.errors.push(e.message));
 for(const [count,largeBoard]of [[15,false],[45,false],[103,false],[27,true]]){
 const g=fixture(count,largeBoard);await page.goto(base+'/rummikub.html');await page.evaluate(([k,g])=>localStorage.setItem(k,JSON.stringify(g)),[KEY,g]);await page.reload();
 const tag=`${name} ${vp.width}x${vp.height} rack=${count} board=${g.board.flat().length}`;
 if(vp.width===390&&(count===103||largeBoard))await page.screenshot({path:path.join(out,`${name}-${largeBoard?'large-table':'big-hand'}.png`)});
 let m=await metrics(page);check(tag+' every tile rendered, page fixed, dock on screen',m.rackCount===count&&m.boardCount===g.board.flat().length&&!m.meldClipped&&!m.overflowX&&!m.overflowY&&m.dock);
 if(count>=103||(count>=45&&vp.width<1000))check(tag+' big hand scrolls inside the rack',m.rackScrolls);
 if(count===103){await page.locator('#rack').evaluate(r=>r.scrollTop=r.scrollHeight);check(tag+' rack scrolls to its end',await page.locator('#rack').evaluate(r=>r.scrollTop>0));}
 for(const region of ['#rack',...(largeBoard?['#board']:[])]){
 const last=page.locator(region+' .tile').last();await last.scrollIntoViewIfNeeded();await last.click();check(tag+region+' last tile reachable and selectable',await last.getAttribute('aria-pressed')==='true');await last.click();
 }
 const ids=await page.locator('#rack .tile').evaluateAll(ts=>ts.map(t=>t.dataset.id).sort());await page.click('#sortColor');check(tag+' sorting preserves visible inventory',JSON.stringify(ids)===JSON.stringify(await page.locator('#rack .tile').evaluateAll(ts=>ts.map(t=>t.dataset.id).sort())));
 const last=page.locator('#rack .tile').last();await last.scrollIntoViewIfNeeded();await last.click();await page.click('#newMeldBtn');check(tag+' adding draft updates both regions',await page.locator('#rack .tile').count()===count-1&&await page.locator('#board .tile').count()===g.board.flat().length+1);await page.click('#undoBtn');
 if(count===15){for(const id of [16,18,20])await page.locator(`#rack [data-id="${id}"]`).click();await page.click('#newMeldBtn');await page.click('#commitBtn');await page.waitForFunction(k=>{const s=JSON.parse(localStorage.getItem(k));return s.turn===0&&s.round===5;},KEY,{timeout:30000});check(tag+' commit redraw preserves remaining tiles',await page.locator('#rack .tile').count()===12);}
 if(count===45){await page.click('#drawBtn');await page.waitForFunction(k=>{const s=JSON.parse(localStorage.getItem(k));return s.turn===0&&s.round===5;},KEY,{timeout:30000});check(tag+' drawing adds a visible tile',await page.locator('#rack .tile').count()===46);}
 }
 await ctx.close();}
 }finally{await browser.close();}}
 assert.equal(report.errors.length,0,report.errors.join('\n'));fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify(report,null,2)+'\n');console.log(`${report.checks.length} checks passed; ${report.errors.length} errors; skipped: ${report.skipped.join('; ')||'none'}`);server.close();
})().catch(async e=>{console.error(e);if(current&&!current.isClosed())await current.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});server.close();process.exit(1);});
