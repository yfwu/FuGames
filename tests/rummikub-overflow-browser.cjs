'use strict';
// Local regression checks; Playwright is development-only. No game simulations.
const {chromium,webkit}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),out=path.join(root,'docs/rummikub-overflow-2026-10-14');fs.mkdirSync(out,{recursive:true});
const html=fs.readFileSync(path.join(root,'rummikub.html'),'utf8'),sandbox={module:{exports:{}},performance};
vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],sandbox);const E=sandbox.module.exports;
function fixture(size,largeBoard=false){
 const g=E.newGame(),deck=E.deck();g.board=[];
 if(largeBoard)for(let c=0;c<4;c++){g.board.push(deck.filter(t=>t.c===c&&t.id%2===0));for(const start of [1,4])g.board.push(deck.filter(t=>t.c===c&&t.id%2===1&&t.n>=start&&t.n<start+3));}
 const used=new Set(g.board.flat().map(t=>t.id)),rest=deck.filter(t=>!used.has(t.id));
 const ids=largeBoard?[]:[16,18,20,104];g.racks[0]=ids.map(id=>rest.splice(rest.findIndex(t=>t.id===id),1)[0]);g.racks[0].push(...rest.splice(0,size-g.racks[0].length));
 for(let i=1;i<4;i++)g.racks[i]=rest.splice(0,1);g.pool=rest;g.turn=0;g.opened=[largeBoard,true,true,true];g.difficulty='strong';assert.ok(E.audit(g));return g;
}
const server=http.createServer((req,res)=>{const file=path.join(root,new URL(req.url,'http://local').pathname);if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}fs.readFile(file,(err,data)=>{if(err){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html');res.end(data);});});
const report={checks:[],errors:[]};let current;
const check=(name,yes)=>{assert.ok(yes,name);report.checks.push(name);};
async function metrics(page){return page.evaluate(()=>{const rack=document.querySelector('#rack'),board=document.querySelector('#board');const inside=(parent,child)=>{const a=parent.getBoundingClientRect(),b=child.getBoundingClientRect();return b.left>=a.left-1&&b.right<=a.right+1&&b.top>=a.top-1&&b.bottom<=a.bottom+1;};return{rackCount:rack.children.length,rackHeight:rack.clientHeight,rackScrollHeight:rack.scrollHeight,rackClipped:[...rack.children].filter(t=>!inside(rack,t)).length,boardCount:board.querySelectorAll('.tile').length,boardClipped:[...board.querySelectorAll('.tile')].filter(t=>!inside(board,t)||!inside(t.closest('.meld'),t)).length,overflow:document.documentElement.scrollWidth>innerWidth+1};});}
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=process.env.FUGAMES_BASE_URL||`http://127.0.0.1:${server.address().port}`;
 for(const [name,type]of Object.entries(process.env.BASELINE?{chromium}:{chromium,webkit})){
 const browser=await type.launch({headless:true});try{
 for(const vp of (process.env.BASELINE?[{width:390,height:844}]:[{width:390,height:844},{width:320,height:568},{width:844,height:390},{width:1440,height:1000}])){
 const mobile=vp.width<1000,ctx=await browser.newContext({viewport:vp,isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1}),page=await ctx.newPage();current=page;page.on('pageerror',e=>report.errors.push(e.message));
 for(const [count,largeBoard]of (process.env.BASELINE?[[15,false]]:[[15,false],[45,false],[103,false],[27,true]])){
 const g=fixture(count,largeBoard);await page.goto(base+'/rummikub.html');await page.evaluate(g=>localStorage.setItem('fulab-rummikub-v2-four',JSON.stringify(g)),g);await page.reload();
 const tag=`${name} ${vp.width}x${vp.height} rack=${count} board=${g.board.flat().length}`;
 if(process.env.BASELINE){await page.locator('#rack').screenshot({path:path.join(out,'before-15-tiles.png')});report.baseline=await metrics(page);console.log(report.baseline);continue;}
 if(vp.width===390&&count===15)await page.screenshot({path:path.join(out,`${name}-15-tiles.png`),fullPage:true});
 let m=await metrics(page);check(tag+' all tiles in expanded containers',m.rackCount===count&&m.rackClipped===0&&m.boardClipped===0&&m.boardCount===g.board.flat().length&&!m.overflow);
 if(count===103){
 await page.evaluate(()=>scrollTo(0,0));
 if(name==='chromium'&&mobile){const cdp=await ctx.newCDPSession(page);const y=vp.height-60;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:5,y}]});for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:5,y:y-i*25}]});await page.waitForTimeout(16);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}
 else if(name==='webkit'&&mobile){await page.evaluate(()=>scrollBy(0,400));}
 else{await page.mouse.move(5,Math.min(200,vp.height-30));await page.mouse.wheel(0,400);}
 await page.waitForFunction(()=>scrollY>0);check(tag+(name==='webkit'&&mobile?' programmatic page scroll works (mobile WebKit gesture unavailable)':' page scroll gesture works outside draggable tiles'),true);
 }
 for(const region of ['#rack',...(largeBoard?['#board']:[])]){
 const last=page.locator(region+' .tile').last();await last.scrollIntoViewIfNeeded();await last.click();check(tag+region+' last tile reachable and selectable',await last.getAttribute('aria-pressed')==='true');await last.click();
 }
 const ids=await page.locator('#rack .tile').evaluateAll(ts=>ts.map(t=>t.dataset.id).sort());await page.click('#sortColor');m=await metrics(page);check(tag+' sorting preserves visible inventory',JSON.stringify(ids)===JSON.stringify(await page.locator('#rack .tile').evaluateAll(ts=>ts.map(t=>t.dataset.id).sort()))&&!m.rackClipped);
 await page.locator('#rack .tile').last().click();await page.click('#newMeldBtn');check(tag+' adding draft updates both regions',await page.locator('#rack .tile').count()===count-1&&await page.locator('#board .tile').count()===g.board.flat().length+1);await page.click('#undoBtn');
 if(count===15){for(const id of [16,18,20])await page.locator(`#rack [data-id="${id}"]`).click();await page.click('#newMeldBtn');await page.click('#commitBtn');await page.waitForFunction(()=>JSON.parse(localStorage.getItem('fulab-rummikub-v2-four')).turn===0&&JSON.parse(localStorage.getItem('fulab-rummikub-v2-four')).round===5);check(tag+' commit redraw preserves remaining tiles',await page.locator('#rack .tile').count()===12&&!(await metrics(page)).rackClipped);}
 if(count===45){await page.click('#drawBtn');await page.waitForFunction(()=>JSON.parse(localStorage.getItem('fulab-rummikub-v2-four')).turn===0&&JSON.parse(localStorage.getItem('fulab-rummikub-v2-four')).round===5);check(tag+' drawing adds a visible tile',await page.locator('#rack .tile').count()===46&&!(await metrics(page)).rackClipped);}
 if(vp.width===390&&(count===15||largeBoard))await page.screenshot({path:path.join(out,`${name}-${largeBoard?'large-table':'hand'}.png`),fullPage:true});
 }
 await ctx.close();}
 }finally{await browser.close();}}
 assert.equal(report.errors.length,0);fs.writeFileSync(path.join(out,process.env.BASELINE?'baseline.json':'browser-report.json'),JSON.stringify(report,null,2)+'\n');console.log(`${report.checks.length} checks passed; ${report.errors.length} errors`);server.close();
})().catch(async e=>{console.error(e);if(current&&!current.isClosed())await current.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});server.close();process.exit(1);});
