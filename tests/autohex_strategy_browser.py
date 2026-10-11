"""Actual desktop/touch controls for public airport actions and neutral options."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib, json, os
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=Path(os.environ.get('AUTOHEX_REPORT_DIR',str(ROOT/'docs/autohex-visual-2026-10-11')))
BASE=os.environ.get('FUGAMES_BASE_URL','http://127.0.0.1:8011')
(OUT/'screenshots').mkdir(parents=True,exist_ok=True)
SOURCES=['autohex-engine.js','autohex-ui.js','autohex-visuals.js','autohex.html','autohex.css']
def hashes():return {name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in SOURCES}
report={'clock':'virtual for timer control only','fixture':'public seeded airport, controlled supply path/cluster and item resources; actual UI air actions','sourceSha256':hashes(),'viewports':[],'errors':[]}
def clickcell(p,i,mobile):
 p.evaluate('(i)=>autoHexFocusCell(i)',i);p.locator('#board').scroll_into_view_if_needed();pt=p.evaluate('(i)=>autoHexCellPoint(i)',i)
 p.touchscreen.tap(pt['x'],pt['y']) if mobile else p.mouse.click(pt['x'],pt['y'])
FIXTURE='''() => {
 const E=AutoHex,g=autoHexGame;g.reset('airport-browser',1,0);
 for(const k of ['board','terrain','roads','shields','unsupplied','age'])g[k].fill(0);
 for(const p of E.PLAYERS)g.board[g.players[p].home]=p;
 const airport=g.airports[0].cell,home=g.players[1].home;
 const queue=[home],parents=new Map([[home,-1]]);
 for(let head=0;head<queue.length&&!parents.has(airport);head++)for(const i of E.ADJ[queue[head]])
   if(!parents.has(i)&&(!g.anchors[i]||i===home)){parents.set(i,queue[head]);queue.push(i);}
 if(!parents.has(airport))throw Error('No route to seeded airport');
 for(let i=airport;i!==-1;i=parents.get(i))g.board[i]=1;
 for(const c of E.CELLS)if(E.distance(c.i,airport)<=2)g.board[c.i]=1;
 g.start();for(let i=0;i<18;i++)if(!g.act({type:'rest',cells:[]}))throw Error('fixture rest');
 g.players[1].supplies=6;g.players[1].energy=8;
 const view=g.observation(1),target=E.CELLS.find(c=>!E.inRange(view,1,c.i)&&E.legalAction(view,{type:'airdrop',cells:[airport,c.i]}))?.i;
 const far=E.CELLS.find(c=>!g.board[c.i]&&!g.anchors[c.i]&&E.distance(airport,c.i)>12)?.i;
 const bombard=E.CELLS.find(c=>c.i!==target&&!g.board[c.i]&&!g.anchors[c.i]&&E.distance(airport,c.i)>5&&E.distance(airport,c.i)<=12)?.i;
 if([target,far,bombard].some(i=>i===undefined))throw Error('Missing seeded air targets');
 g.hands[1]=['shield','destroy','bridge'];
 const veteran=E.ADJ[airport].find(i=>g.board[i]===1&&!g.anchors[i]);
 g.age[veteran]=31;g.fortified[veteran]=1;g._countStones();autoHexRender();autoHexSchedule();
 return {airport,target,far,bombard};
}'''
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for label,w,h,dpr,mobile in [('desktop',1440,1100,1,False),('mobile',390,844,3,True)]:
  ctx=browser.new_context(viewport={'width':w,'height':h},device_scale_factor=dpr,is_mobile=mobile,has_touch=mobile)
  p=ctx.new_page();p.on('pageerror',lambda e:report['errors'].append(str(e)))
  p.clock.install(time=datetime(2026,10,11,15,0,tzinfo=timezone.utc));p.clock.pause_at(datetime(2026,10,11,15,1,tzinfo=timezone.utc))
  p.goto(BASE+'/autohex.html?seed=airport-browser');p.locator('#play').click();ids=p.evaluate(FIXTURE)
  assert p.evaluate('(i)=>autoHexGame.observation(1).airports.some(a=>a.cell===i&&a.active&&a.owner===1)',ids['airport'])
  assert not p.evaluate('(i)=>AutoHex.inRange(autoHexGame.observation(1),1,i)',ids['target'])
  before=p.evaluate('JSON.stringify({board:Array.from(autoHexGame.board),ply:autoHexGame.ply,hand:autoHexGame.hands[1],player:autoHexGame.players[1]})')
  p.locator('#airdrop').click();clickcell(p,ids['airport'],mobile);clickcell(p,ids['far'],mobile)
  assert p.evaluate('JSON.stringify({board:Array.from(autoHexGame.board),ply:autoHexGame.ply,hand:autoHexGame.hands[1],player:autoHexGame.players[1]})')==before
  # Restart selection after invalid target; valid remote action must be accepted through UI.
  p.locator('#airdrop').click();clickcell(p,ids['airport'],mobile);clickcell(p,ids['target'],mobile)
  assert p.evaluate('(i)=>autoHexGame.board[i]===1&&autoHexGame.turrets.some(t=>t.cell===i)',ids['target'])
  assert p.evaluate('autoHexGame.players[1].supplies')==3
  p.locator('#pause').click();p.locator('#fit-map').click()
  p.screenshot(path=str(OUT/f'screenshots/strategy-{label}-airdrop.png'),full_page=True)
  # Advance genuine owner turns through cooldown; then target remote enemy via the other control.
  p.evaluate('''(target)=>{const g=autoHexGame;g.start();for(let i=0;i<41;i++)g.act({type:'rest',cells:[]});
    if(g.turn!==1)throw Error('turn fixture');g.board[target]=2;g.players[1].energy=8;g.players[1].supplies=6;autoHexRender();autoHexSchedule();}''',ids['bombard'])
  assert p.evaluate('autoHexGame.players[1].airCooldown')==0
  p.locator('#bombard').click();clickcell(p,ids['airport'],mobile);clickcell(p,ids['bombard'],mobile)
  assert p.evaluate('(i)=>!autoHexGame.board[i]',ids['bombard'])
  p.locator('#pause').click();p.locator('#fit-map').click()
  p.screenshot(path=str(OUT/f'screenshots/strategy-{label}-bombard.png'),full_page=True)
  assert p.evaluate('document.documentElement.scrollWidth<=innerWidth')
  # Restart/replay must retain the chosen option, clear facilities/effects, and never double-schedule.
  p.reload();p.locator('#neutral-events').select_option('off');p.locator('#play').click();p.locator('#restart').click()
  assert p.evaluate('autoHexGame.neutralEvents') is False
  assert not p.evaluate('autoHexVisualDebug().activeEffects')
  p.locator('#replay').click();assert p.evaluate('autoHexGame.neutralEvents') is False
  report['viewports'].append({'label':label,'dpr':dpr,'seededCells':ids,'airportUnlockThrough18Actions':True,'illegalAirTargetAtomic':True,'remoteAirdropViaUi':True,'remoteBombardViaUi':True,'cooldownElapsedThroughActions':True,'neutralOffReplay':True,'overflow':False})
  ctx.close()
 browser.close()
assert not report['errors'],report['errors']
assert hashes()==report['sourceSha256'],'Source changed during browser checks'
(OUT/'strategy-browser.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
