'use strict';
// Gravity Brawl browser regression (full-screen three.js table). Run: NODE_PATH=$(npm root -g) node tests/gravity-brawl-browser.cjs
// Serves the repo itself unless FUGAMES_BASE_URL is set. Screenshots go to FUGAMES_SCREENSHOTS (default /tmp/fugames-gravity-brawl).
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),OUT=process.env.FUGAMES_SCREENSHOTS||'/tmp/fugames-gravity-brawl';fs.mkdirSync(OUT,{recursive:true});
const TYPES={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
const server=http.createServer((q,r)=>{const file=path.join(root,decodeURIComponent(new URL(q.url,'http://x').pathname));if(!file.startsWith(root)){r.writeHead(403);r.end();return;}fs.readFile(file,(e,b)=>{r.writeHead(e?404:200,{'Content-Type':TYPES[path.extname(file)]||'application/octet-stream'});r.end(e?'':b);});});
const ARGS=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'];
// Real time; waits are capped so a paused game is checked over a meaningful interval without slowing the suite.
const wait=(page,ms)=>page.waitForTimeout(Math.min(ms,2000));
const SEED='let seed=83;Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);';
async function open(browser,width,height,label,init=''){
  const touch=label!=='desktop',context=await browser.newContext({viewport:{width,height},hasTouch:touch,isMobile:touch});
  await context.addInitScript(SEED+init);
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/404/.test(m.text()))errors.push(m.text());});
  return {context,page,errors};
}
const ev=(page,s)=>page.evaluate(s);
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const BASE=process.env.FUGAMES_BASE_URL||`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({args:ARGS});
  try{
    for(const [width,height,label] of [[1440,900,'desktop'],[390,844,'mobile'],[320,568,'narrow']]){
      const {context,page,errors}=await open(browser,width,height,label);
      await page.goto(BASE+'/gravity_brawl.html');await wait(page,600);
      assert.equal(await ev(page,'game.phase'),'ready');
      assert.ok(await ev(page,'document.documentElement.scrollWidth <= innerWidth'),'no horizontal scroll');
      assert.equal(await ev(page,"document.getElementById('curtain').dataset.mode"),'lobby');
      assert.ok(await ev(page,"!!document.querySelector('canvas#board') && !!window.BrawlView"),'three.js table ready');
      await page.screenshot({path:path.join(OUT,`gravity-ready-${label}.png`)});
      await page.locator('#play').click();await wait(page,100);
      assert.equal(await ev(page,'game.phase'),'running');assert.ok(await page.locator('#curtain').isHidden());
      await ev(page,"game.piece='T';game.selectDefault();refresh();");
      const old=await ev(page,'game.selection.x');
      await page.locator('#board').focus();
      await page.keyboard.press('ArrowLeft');assert.equal(await ev(page,'game.selection.x'),old-1);
      await page.keyboard.press('ArrowRight');assert.equal(await ev(page,'game.selection.x'),old);
      await page.keyboard.press('ArrowUp');assert.equal(await ev(page,'game.selection.rotation'),1);
      if(label!=='desktop'){
        await page.locator('#left').tap();assert.equal(await ev(page,'game.selection.x'),old-1);
        await page.locator('#right').tap();await page.locator('#rotate').tap();assert.equal(await ev(page,'game.selection.rotation'),2);
        const p=await ev(page,'BrawlView.cellToScreen(0,5)');await page.touchscreen.tap(p.x,p.y);
        assert.ok(await ev(page,'game.selection.x')<=1,'tapping the left column selects it');
        assert.equal(await ev(page,'game.wave'),1,'a tap only selects');
      }else{
        const p=await ev(page,'BrawlView.cellToScreen(8,5)');await page.mouse.move(p.x,p.y);
        assert.ok(await ev(page,'game.selection.x')>=6,'mouse hover selects a column');
        await page.keyboard.press('ArrowLeft');
      }
      // Two clicks in the same task: the second falls inside the 220 ms lock and may not drop another wave.
      await ev(page,"document.getElementById('drop').click();document.getElementById('drop').click();");assert.equal(await ev(page,'game.wave'),2,'rapid double events may not drop a second wave');
      await wait(page,300);
      if(label==='desktop'){ // a mouse click on the chosen column drops the piece
        const sel=await ev(page,'(()=>{const s=game.selection;return GravityBrawl.world(s.x,s.y,game.gravity)})()');const p=await ev(page,`BrawlView.cellToScreen(${sel[0]},${sel[1]})`);
        await page.mouse.click(p.x,p.y);assert.equal(await ev(page,'game.wave'),3);await wait(page,300);
      }
      await page.locator('#pause').click();assert.equal(await ev(page,'game.phase'),'paused');
      assert.equal(await ev(page,"document.getElementById('curtain').dataset.mode"),'pause');
      const before=await ev(page,'JSON.stringify(game)');await wait(page,20000);assert.equal(await ev(page,'JSON.stringify(game)'),before);
      await page.locator('#play').click();await wait(page,1000);assert.ok(await ev(page,'game.remaining')<6.9,'countdown resumes');
      await ev(page,"window.dispatchEvent(new Event('blur'))");assert.equal(await ev(page,'game.phase'),'paused');
      await wait(page,10000);assert.equal(await ev(page,'game.phase'),'paused');
      await page.locator('#play').click();
      await ev(page,"Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;");
      assert.equal(await ev(page,'game.phase'),'paused');
      await page.locator('#play').click();await wait(page,250);
      // Opening the menu pauses; closing it leaves the pause curtain.
      await page.locator('#menu-btn').click();await wait(page,400);
      assert.equal(await ev(page,'game.phase'),'paused');assert.ok(await ev(page,"document.getElementById('menu').classList.contains('is-open')"));
      await page.keyboard.press('Escape');await wait(page,400);assert.ok(await ev(page,"!document.getElementById('menu').classList.contains('is-open')"));
      await page.locator('#play').click();await wait(page,250);
      // Real drop events through all four gravity directions to a natural bounded result.
      const saw=new Set([0]);
      while(await ev(page,"game.phase === 'running'")){
        await ev(page,'game.selection=GravityBrawl.chooseAI(game.actors[0].board,game.piece,0,game.untilTurn(),game.actors[0].pending);refresh();');
        await page.locator('#drop').click();await wait(page,250);saw.add(await ev(page,'game.gravity'));
        if(await ev(page,'game.wave')===7){
          await wait(page,1400);
          await page.screenshot({path:path.join(OUT,`gravity-playing-${label}.png`)});
          assert.ok(await ev(page,'document.documentElement.scrollWidth <= innerWidth'));
          // HUD panels and dock must not cover your board.
          const box=await ev(page,`(()=>{const c=[[0,0],[9,0],[0,9],[9,9]].map(([x,y])=>BrawlView.cellToScreen(x,y));const r=id=>document.getElementById(id).getBoundingClientRect();
            return{top:Math.min(...c.map(p=>p.y)),bottom:Math.max(...c.map(p=>p.y)),left:Math.min(...c.map(p=>p.x)),right:Math.max(...c.map(p=>p.x)),hud:Math.max(r('hud-beat').bottom,r('hud-self').bottom),hudL:r('hud-beat').right,hudR:r('hud-self').left,dock:r('dock').top,w:innerWidth}})()`);
          assert.ok(box.bottom<box.dock,'dock clears the board '+JSON.stringify(box));
          assert.ok(box.left>=0&&box.right<=box.w,'board on screen');
          // Rival name tags stay clickable: nothing in the HUD sits on top of them.
          const covered=await ev(page,`[...document.querySelectorAll('.tag:not(.me)')].filter(t=>{const r=t.getBoundingClientRect(),e=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !t.contains(e);}).map(t=>{const r=t.getBoundingClientRect(),e=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return t.textContent+' under '+(e&&(e.id||e.className))+' '+JSON.stringify(r);})`);
          assert.deepEqual(covered,[],'rival tags uncovered');
          if(label!=='desktop')assert.ok(box.top>box.hud,'HUD clears the board '+JSON.stringify(box));
          else assert.ok(box.left>box.hudL&&box.right<box.hudR,'corner HUD clears the board '+JSON.stringify(box));
        }
      }
      assert.deepEqual([...saw].sort(),[0,1,2,3]);
      assert.ok(['win','loss','draw'].includes(await ev(page,'game.result.outcome')));
      assert.ok(await page.locator('#drop').isDisabled());
      assert.equal(await ev(page,"document.getElementById('curtain').dataset.mode"),'result');
      assert.ok(await ev(page,"JSON.parse(localStorage.getItem('gravity-brawl-career')).xp")>0,'career XP saved');
      assert.match(await page.locator('#xp-lines').innerText(),/本局經驗/);
      await wait(page,600);
      await page.screenshot({path:path.join(OUT,`gravity-result-${label}.png`)});
      await page.locator('#play').click();
      assert.equal(await ev(page,'game.wave'),1);assert.equal(await ev(page,'game.phase'),'running');
      // UI end-state fixtures for impossible entry and all-out draw.
      await ev(page,'game.actors.forEach(a=>a.board[0].fill(8));game.selectDefault();refresh();');
      await page.locator('#drop').click();
      assert.equal(await ev(page,'game.result.outcome'),'draw');assert.match(await page.locator('#dialog-title').innerText(),/平手/);
      await page.locator('#restart').click();
      assert.equal(await ev(page,'game.phase'),'ready');assert.equal(await ev(page,'game.gravity'),0);assert.ok(await page.locator('#drop').isDisabled());
      assert.deepEqual(errors,[],label+' console errors');
      await context.close();
    }
    // Unlocked career: lobby choices and menu options configure the next match; targeting, rebound and the agent API work.
    {
      const {context,page,errors}=await open(browser,1440,900,'desktop',"localStorage.setItem('gravity-brawl-career',JSON.stringify({v:1,xp:99999}));");
      await page.goto(BASE+'/gravity_brawl.html');await wait(page,400);
      assert.equal(await ev(page,"document.querySelectorAll('#tier-choices .choice:disabled').length"),0);
      await page.locator('#tier-choices [data-id="3"]').click();await page.locator('#stage-choices [data-id="bounty"]').click();
      await page.locator('#open-rules').click();await wait(page,500);
      await page.locator('#targeting-choices [data-id="focus"]').click();await page.locator('#attack-choices [data-id="combo"]').click();
      await page.locator('#rebound-choices [data-id="true"]').click();await page.locator('#tempo-choices [data-id="calm"]').click();
      assert.deepEqual(await ev(page,'game.options'),{tier:3,stage:'bounty',targeting:'focus',attack:'combo',rebound:true,tempo:'calm'});
      assert.equal(await ev(page,'game.remaining'),10);
      await page.keyboard.press('Escape');await wait(page,400);
      await page.locator('#play').click();await wait(page,200);
      assert.ok(await page.locator('#target').isVisible());assert.ok(await page.locator('#rebound').isVisible());
      await page.locator('#board').focus();await page.keyboard.press('t');assert.equal(await ev(page,'game.actors[0].target'),2);
      await page.locator('.tag >> nth=3').click();assert.equal(await ev(page,'game.actors[0].target'),3);
      await ev(page,'game.actors[0].charge=3;game.actors[0].pending=2;refresh();');
      await page.keyboard.press('e');assert.equal(await ev(page,'game.actors[0].armed'),true);
      await ev(page,'game.selection=GravityBrawl.chooseAI(game.actors[0].board,game.piece,0,game.untilTurn(),0);');
      await page.locator('#drop').click();await wait(page,300);
      assert.ok(await ev(page,"game.events.some(e=>e.type==='rebound'&&e.id===0)"),'rebound fired');
      assert.ok(await ev(page,"game.events.some(e=>e.type==='attack'&&e.from===0&&e.to===3&&e.bounced===2)"),'rebound reached the focused target');
      // Local agent interface plays the rest of the match.
      const st=await ev(page,'GravityBrawlAgent.state()');assert.equal(st.actors.length,4);assert.equal(st.options.stage,'bounty');
      while(await ev(page,"game.phase==='running'")){
        const ok=await ev(page,'(()=>{const m=GravityBrawlAgent.suggest(1)||GravityBrawlAgent.legal()[0];return m?GravityBrawlAgent.play(m):(act("drop"),true);})()');assert.ok(ok);
        await wait(page,250);
      }
      assert.equal(await ev(page,"document.getElementById('curtain').dataset.mode"),'result');
      assert.match(await page.locator('#xp-lines').innerText(),/倍率/);
      assert.deepEqual(errors,[],'unlocked console errors');
      await context.close();
    }
  }finally{await browser.close();server.close();}
  console.log('PASS: desktop/mobile/narrow inputs, mouse/touch picking, full match, four gravities, pause/blur/visibility/menu, rapid click, draw, restart, career, options, targeting, rebound, agent API; no console errors');
  console.log('Screenshots:',OUT);
})().catch(e=>{console.error(e);server.close();process.exit(1);});
