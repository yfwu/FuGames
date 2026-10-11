"""Real clicks/taps for tactical actions, hidden-state DOM boundary and timer replay."""
from pathlib import Path
from datetime import datetime, timezone
import json, os, subprocess, time
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs/hex-tactics-2026-10-11/screenshots';OUT.mkdir(parents=True,exist_ok=True)
BASE=os.environ.get('FUGAMES_BASE_URL','http://127.0.0.1:8011')
report={'viewports':[],'games':[],'checks':[]};errors=[]
def hit(p,selector,mobile=False):
 e=p.locator(selector);e.tap() if mobile else e.click()
def cell(p,q,r):return '[data-cell="'+str(p.evaluate('([q,r])=>CardHex.index(q,r)',[q,r]))+'"]'
def state(p):return p.evaluate('JSON.stringify({board:hexGame.board,hands:hexGame.hands,blocked:hexGame.blocked,bridges:hexGame.bridges,terrain:hexGame.terrain,ply:hexGame.ply,turn:hexGame.turn,neutral:hexGame.neutral,result:hexGame.result})')
def fixture(p,body):
 p.evaluate('''body=>{hexGame.reset(1,0);hexGame.terrain.fill('plain');hexGame.hands[1]=['reroute','block','exchange'];hexGame.deadlines[1]=[3,3,3];hexGame.decks[1]=[];hexGame.start();new Function('g','at',body)(hexGame,CardHex.index);hexRender();hexSchedule();}''',body)
 p.locator('#normal').click()
def clock(p):
 p.clock.install(time=datetime(2026,10,11,12,0,tzinfo=timezone.utc));p.clock.pause_at(datetime(2026,10,11,12,1,tzinfo=timezone.utc))
 p.on('pageerror',lambda e:errors.append(str(e)))
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 before=subprocess.check_output(['git','show','966be7f:card_hex.html'],cwd=ROOT,text=True)
 for label,w,h,dpr,mobile in [('desktop',1366,1000,1,False),('mobile',390,844,3,True),('narrow',320,740,2,True),('landscape',844,390,2,True)]:
  ctx=browser.new_context(viewport={'width':w,'height':h},device_scale_factor=dpr,is_mobile=mobile,has_touch=mobile);p=ctx.new_page();clock(p)
  if label in ['desktop','mobile']:
   p.route('**/card_hex.html*',lambda route:route.fulfill(status=200,content_type='text/html',body=before));p.goto(BASE+'/card_hex.html?seed=tactics-before');p.screenshot(path=str(OUT/f'before-{label}.png'),full_page=True);p.unroute('**/card_hex.html*')
  p.goto(BASE+'/card_hex.html?seed=tactics-ui');assert p.locator('#deck-mode').input_value()=='mixed';p.locator('#deck-mode').select_option('tactical');assert p.locator('.hex-cell').count()==91;hit(p,'#play',mobile)
  fixture(p,"g.board[at(0,0)]=1;g.board[at(1,0)]=2;g.blocked[at(2,-2)]=3;g.terrain[at(-1,2)]='hill';g.traps=[{owner:2,cell:at(5,-5)}];")
  unchanged=p.locator('#board').inner_html();p.evaluate('hexGame.traps[0].cell=CardHex.index(-5,5);hexRender()');assert unchanged==p.locator('#board').inner_html()
  hit(p,'#exchange',mobile);hit(p,cell(p,0,0),mobile);old=state(p);hit(p,cell(p,3,0),mobile);assert state(p)==old;hit(p,cell(p,1,0),mobile);assert p.evaluate('hexGame.board[CardHex.index(0,0)]===2&&hexGame.board[CardHex.index(1,0)]===1&&hexGame.ply===1');hit(p,'#pause',mobile)
  assert p.evaluate('document.documentElement.scrollWidth<=innerWidth');p.screenshot(path=str(OUT/f'after-{label}.png'),full_page=True)
  fixture(p,"g.terrain[at(0,0)]='hill';g.traps=[{owner:2,cell:at(0,0)}];")
  hit(p,'#block',mobile);hit(p,cell(p,0,0),mobile);assert p.locator('.block-life').text_content()=='3';hit(p,'#pause',mobile);p.evaluate('hexGame.traps[0].owner=1;hexRender()');assert p.locator('.block-life').text_content()=='3';p.screenshot(path=str(OUT/f'block-own-trap-{label}.png'),full_page=True);frozen=state(p);p.clock.run_for(3000);assert state(p)==frozen
  # Resume on the human side to exercise the same public clearing action.
  p.evaluate('hexGame.turn=1;hexGame.start();hexRender();hexSchedule()');hit(p,'#unblock',mobile);hit(p,cell(p,0,0),mobile);assert not p.evaluate('hexGame.blocked.some(Boolean)');assert p.evaluate('hexGame.traps.length')==1
  fixture(p,"const a=at(-2,0),b=at(-2,2),c=at(0,0);g.board[a]=g.board[b]=g.board[c]=1;g.bridges=[{owner:1,a,b},{owner:2,a:at(-1,-1),b:at(-1,1)}];")
  hit(p,'#reroute',mobile)
  for q,r in [(-2,0),(-2,2)]:hit(p,cell(p,q,r),mobile)
  old=state(p);hit(p,cell(p,0,0),mobile);assert state(p)==old;assert p.locator('#bridge-lines path').count()==2
  # Removing only the test obstruction lets exactly the same selected reroute succeed.
  p.evaluate('hexGame.bridges.pop();hexRender()');hit(p,cell(p,0,0),mobile);assert p.evaluate('hexGame.bridges.length===1&&hexGame.bridges[0].b===CardHex.index(0,0)&&hexGame.ply===1')
  hit(p,'#pause',mobile);p.screenshot(path=str(OUT/f'reroute-{label}.png'),full_page=True)
  report['viewports'].append({'label':label,'width':w,'dpr':dpr,'overflow':False,'exchangeIllegalAtomic':True,'hiddenTrapDomUnchanged':True,'blockCountdownAndClear':True,'rerouteCrossingRejected':True,'rerouteSuccess':True});ctx.close()
 # Observer replay, speed/restart race and no private DOM while a block is active.
 ctx=browser.new_context(viewport={'width':1366,'height':1000});p=ctx.new_page();clock(p);p.goto(BASE+'/card_hex.html?seed=tactics-spectator');p.locator('#deck-mode').select_option('tactical');p.locator('#match-mode').select_option('spectator');p.locator('#card-timing').select_option('timed');p.locator('#neutral-mode').select_option('on');p.locator('#play').click();initial=state(p)
 p.clock.run_for(500);assert p.evaluate('hexGame.ply')==1;p.locator('#step-seconds').fill('1');p.locator('#step-seconds').dispatch_event('change');p.clock.run_for(999);assert p.evaluate('hexGame.ply')==1;p.clock.run_for(1);assert p.evaluate('hexGame.ply')==2
 p.locator('#pause').click();p.locator('#step').click();assert p.evaluate('hexGame.ply')==3;three=state(p);p.clock.run_for(5000);assert state(p)==three;p.locator('#replay').click();assert state(p)==initial;p.locator('#pause').click()
 for _ in range(3):p.locator('#step').click()
 assert state(p)==three
 p.evaluate('hexGame.blocked[CardHex.index(0,0)]=hexGame.ply+3;hexGame.traps=[{owner:2,cell:10}];hexRender()');dom=p.locator('#board').inner_html();p.evaluate('hexGame.traps[0].cell=50;hexRender()');assert p.locator('#board').inner_html()==dom;assert p.locator('.own-trap').count()==0
 p.locator('#restart').click();assert p.evaluate('hexGame.blocked.every(x=>!x)&&hexGame.ply===0');p.clock.run_for(999);assert p.evaluate('hexGame.ply')==0;p.clock.run_for(1);assert p.evaluate('hexGame.ply')==1
 p.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))");frozen=state(p);p.clock.run_for(5000);assert state(p)==frozen;assert p.evaluate('hexGame.phase')=='paused'
 report['checks']+=['speed cancels previous timer','pause/single-step/replay deterministic','restart clears all blockers and has one timer','spectator hides enemy traps with blockers present','visibility pauses until explicit resume'];ctx.close()
 # Full games via real UI actions. Mobile player decisions are scripted from its own observation.
 for label,mobile,timed,neutral in [('desktop-spectator',False,False,False),('mobile-player',True,True,True)]:
  ctx=browser.new_context(viewport={'width':390 if mobile else 1366,'height':844 if mobile else 1000},device_scale_factor=3 if mobile else 1,is_mobile=mobile,has_touch=mobile);p=ctx.new_page();clock(p);p.goto(BASE+'/card_hex.html?seed=full-'+label);p.locator('#deck-mode').select_option('tactical')
  if not mobile:p.locator('#match-mode').select_option('spectator');p.locator('#step-seconds').fill('0.05')
  if timed:p.locator('#card-timing').select_option('timed')
  if neutral:p.locator('#neutral-mode').select_option('on')
  hit(p,'#play',mobile);start=time.monotonic();played={}
  for _ in range(420):
   info=p.evaluate('({phase:hexGame.phase,turn:hexGame.turn,pending:hexGame.pending})')
   if info['phase']=='over':break
   if not mobile:p.clock.run_for(50);continue
   if info['pending']:
    if info['pending']['defender']==1:hit(p,'#counter' if p.locator('#counter').is_enabled() else '#accept',True)
    else:p.clock.run_for(600)
   elif info['turn']!=1:p.clock.run_for(1000)
   else:
    a=p.evaluate('CardHex.chooseAction(hexGame.observation(1))');old=state(p)
    if a['type']=='discard':p.locator('#discard-card').select_option(str(a['cardIndex']));hit(p,'#discard',True)
    else:
     hit(p,'#normal' if a['type']=='place' else '#'+a['type'],True)
     for i in a['cells']:hit(p,f'[data-cell="{i}"]',True)
    assert state(p)!=old,(a,p.locator('#status').text_content());played[a['type']]=played.get(a['type'],0)+1
  assert p.evaluate('hexGame.phase')=='over';assert p.locator('#result').is_visible();assert p.evaluate('document.documentElement.scrollWidth<=innerWidth');frozen=state(p);p.clock.run_for(5000);assert state(p)==frozen;p.screenshot(path=str(OUT/f'complete-{label}.png'),full_page=True)
  report['games'].append({'mode':label,'timed':timed,'neutral':neutral,'result':p.evaluate('hexGame.result'),'used':p.evaluate('hexGame.used'),'humanUiActions':played,'wallSeconds':time.monotonic()-start});ctx.close()
 try:
  p=browser.new_page();p.goto('https://yfwu.github.io/FuGames/',timeout=15000);report['publicSite']={'status':'reachable','note':'Pre-release access check only; not acceptance of the new commit.'}
 except Exception as e:report['publicSite']={'status':'blocked','error':str(e).split('\n')[0]}
 browser.close()
assert not errors,errors
report['pageErrors']=errors
(ROOT/'docs/hex-tactics-2026-10-11/browser.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False,indent=2))
