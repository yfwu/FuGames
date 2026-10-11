"""Seeded Hex integration: actual clicks/taps, complete games and fake-clock timer races."""
from pathlib import Path
import json, os, time
from datetime import datetime, timezone
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs/hex-seeded-2026-10-11/screenshots/after';OUT.mkdir(parents=True,exist_ok=True)
BASE=os.environ.get('FUGAMES_BASE_URL','http://127.0.0.1:8000')
report={'viewports':[],'games':[],'checks':[]};errors=[]
def hit(page,selector,mobile=False):
 el=page.locator(selector);el.tap() if mobile else el.click()
def state(page):return page.evaluate('JSON.stringify({board:hexGame.board,hands:hexGame.hands,terrain:hexGame.terrain,ply:hexGame.ply,turn:hexGame.turn,neutral:hexGame.neutral,result:hexGame.result})')
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for label,w,h,dpr in [('desktop',1366,1000,1),('mobile',390,844,3),('narrow',320,740,2),('landscape',844,390,2)]:
  mobile=label!='desktop';context=browser.new_context(viewport={'width':w,'height':h},device_scale_factor=dpr,is_mobile=mobile,has_touch=mobile);page=context.new_page();page.clock.install(time=datetime(2026,10,11,12,0,tzinfo=timezone.utc));page.clock.pause_at(datetime(2026,10,11,12,1,tzinfo=timezone.utc));page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(BASE+'/card_hex.html?seed=browser-seed');assert page.locator('.hex-cell').count()==91;assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  page.locator('#card-timing').select_option('timed');page.locator('#neutral-mode').select_option('on');hit(page,'#play',mobile)
  river=page.evaluate('hexGame.terrain.findIndex(x=>x==="river")');before=state(page);hit(page,f'[data-cell="{river}"]',mobile);assert state(page)==before
  hit(page,'#engineer',mobile);hit(page,f'[data-cell="{river}"]',mobile);assert page.evaluate(f'hexGame.roads[{river}]&&hexGame.ply===1');hit(page,'#pause',mobile);frozen=state(page);page.clock.run_for(2000);assert state(page)==frozen
  page.screenshot(path=str(OUT/f'card_hex-{label}.png'),full_page=True)
  report['viewports'].append({'label':label,'width':w,'dpr':dpr,'overflow':False,'riverIllegalAtomic':True,'engineeringAndPause':True})
  context.close()
 # Spectator scheduler: speed changes, pause, single step, restart and identical seed replay.
 context=browser.new_context(viewport={'width':1366,'height':1000});page=context.new_page();page.clock.install(time=datetime(2026,10,11,12,0,tzinfo=timezone.utc));page.clock.pause_at(datetime(2026,10,11,12,1,tzinfo=timezone.utc));page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(BASE+'/card_hex.html?seed=spectator-replay');page.locator('#match-mode').select_option('spectator');page.locator('#neutral-mode').select_option('on');page.locator('#card-timing').select_option('timed');page.locator('#play').click();initial=state(page)
 page.clock.run_for(499);assert page.evaluate('hexGame.ply')==0;page.clock.run_for(1);assert page.evaluate('hexGame.ply')==1
 page.locator('#step-seconds').fill('1');page.locator('#step-seconds').dispatch_event('change');page.clock.run_for(999);assert page.evaluate('hexGame.ply')==1;page.clock.run_for(1);assert page.evaluate('hexGame.ply')==2
 page.locator('#pause').click();frozen=state(page);page.clock.run_for(5000);assert state(page)==frozen
 page.locator('#step').click();assert page.evaluate('hexGame.ply')==3;assert page.evaluate('hexGame.phase')=='paused';page.clock.run_for(5000);assert page.evaluate('hexGame.ply')==3
 three=state(page);page.locator('#replay').click();assert state(page)==initial;page.locator('#pause').click()
 for _ in range(3):page.locator('#step').click()
 assert state(page)==three
 page.locator('#pause').click();page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))")
 assert page.evaluate('hexGame.phase')=='paused';frozen=state(page);page.clock.run_for(5000);assert state(page)==frozen
 page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'))");assert page.evaluate('hexGame.phase')=='paused'
 page.locator('#restart').click();assert page.evaluate('hexGame.ply')==0;page.clock.run_for(999);assert page.evaluate('hexGame.ply')==0;page.clock.run_for(1);assert page.evaluate('hexGame.ply')==1
 page.locator('#pause').click();page.evaluate("hexGame.traps=[{owner:1,cell:10},{owner:2,cell:20},{owner:3,cell:30}];hexRender()");dom=page.locator('#board').inner_html();page.evaluate("hexGame.traps[0].cell=40;hexGame.traps[1].cell=50;hexGame.traps[2].cell=60;hexRender()");assert dom==page.locator('#board').inner_html();assert page.locator('.own-trap').count()==0
 report['checks']+=['speed cancels old timer','single step remains paused','seed replay identical after 3 steps','visibility pauses until explicit resume','restart has one timer','spectator DOM hides all private traps']
 context.close()
 # Human DOM bridge regression plus endpoint-sharing success.
 context=browser.new_context(viewport={'width':1366,'height':1000});page=context.new_page();page.clock.install(time=datetime(2026,10,11,12,0,tzinfo=timezone.utc));page.clock.pause_at(datetime(2026,10,11,12,1,tzinfo=timezone.utc));page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(BASE+'/card_hex.html?terrain=classic&cards=classic&seed=bridge');page.locator('#play').click()
 page.evaluate("""() => {const a=CardHex.index(-2,0),b=CardHex.index(0,0),c=CardHex.index(-1,0),d=CardHex.index(1,0);hexGame.board[a]=hexGame.board[b]=2;hexGame.board[c]=hexGame.board[d]=1;hexGame.bridges=[{owner:2,a,b}];hexGame.hands[1]=['bridge'];hexRender();}""")
 before=state(page);page.locator('#bridge').click()
 for q in [-1,1]:page.locator(f'[data-cell="{page.evaluate("q=>CardHex.index(q,0)",q)}"]').click()
 assert state(page)==before;assert page.locator('#bridge-lines path').count()==1
 page.screenshot(path=str(OUT/'bridge-overlap-rejected.png'),full_page=True)
 report['checks'].append('cross-owner partially overlapping bridge rejected via real clicks without cost')
 page.evaluate("hexGame.reset(1,0);hexGame.terrain[CardHex.index(0,0)]='hill';hexGame.hands[1]=['turret'];hexGame.decks[1]=[];hexGame.start();hexRender()")
 page.locator('#turret').click();page.locator(f'[data-cell="{page.evaluate("CardHex.index(0,0)")}"]').click();page.locator('#pause').click()
 assert page.locator('.hill-life').text_content()=='3';assert page.locator('.hex-countdown').text_content()=='3'
 hill=page.locator('.hill-life').bounding_box();gun=page.locator('.hex-countdown').bounding_box();assert hill['x']>=gun['x']+gun['width']
 page.screenshot(path=str(OUT/'hill-turret-countdowns.png'),full_page=True)
 report['checks'].append('hill and turret countdowns remain distinct on the same occupied tile')
 context.close()
 # Complete games: 3AI scheduler and touch-based human side choose legal decisions through UI.
 for label,mobile in [('spectator',False),('human-mobile',True)]:
  context=browser.new_context(viewport={'width':390 if mobile else 1366,'height':844 if mobile else 1000},device_scale_factor=3 if mobile else 1,is_mobile=mobile,has_touch=mobile);page=context.new_page();page.clock.install(time=datetime(2026,10,11,12,0,tzinfo=timezone.utc));page.clock.pause_at(datetime(2026,10,11,12,1,tzinfo=timezone.utc));page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(BASE+'/card_hex.html?seed=full-'+label);page.locator('#card-timing').select_option('timed');page.locator('#neutral-mode').select_option('on')
  if not mobile:page.locator('#match-mode').select_option('spectator');page.locator('#step-seconds').fill('0.05')
  hit(page,'#play',mobile);start=time.monotonic()
  for _ in range(400):
   info=page.evaluate('({phase:hexGame.phase,turn:hexGame.turn,pending:hexGame.pending})')
   if info['phase']=='over':break
   if not mobile:page.clock.run_for(50);continue
   if info['pending']:
    if info['pending']['defender']==1:hit(page,'#counter' if page.locator('#counter').is_enabled() else '#accept',True)
    else:page.clock.run_for(600)
   elif info['turn']!=1:page.clock.run_for(1000)
   else:
    a=page.evaluate('CardHex.chooseAction(hexGame.observation(1))')
    if a['type']=='discard':page.locator('#discard-card').select_option(str(a['cardIndex']));hit(page,'#discard',True)
    else:
     hit(page,'#normal' if a['type']=='place' else '#'+a['type'],True)
     for cell in a['cells']:hit(page,f'[data-cell="{cell}"]',True)
  assert page.evaluate('hexGame.phase')=='over';assert page.locator('#result').is_visible();assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  result=page.evaluate('hexGame.result');frozen=state(page);page.clock.run_for(5000);assert state(page)==frozen;page.screenshot(path=str(OUT/f'complete-{label}.png'),full_page=True)
  report['games'].append({'mode':label,'result':result,'wallSeconds':time.monotonic()-start});context.close()
 browser.close()
assert not errors,errors
report['pageErrors']=errors
(ROOT/'docs/hex-seeded-2026-10-11/browser.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
