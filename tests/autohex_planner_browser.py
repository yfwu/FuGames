"""Actual planner controls, public-cue consistency, and lifecycle checks.

Opening boards are staged with legal AI actions plus a disclosed model clock.
This functional suite does not claim real elapsed-time campaign acceptance.
"""
from pathlib import Path
from datetime import datetime, timezone
import hashlib, json, os, time
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ.get('AUTOHEX_REPORT_DIR',str(ROOT/'docs/autohex-planner-2026-10-11')))
BASE=os.environ.get('FUGAMES_BASE_URL','http://127.0.0.1:8011')
FILES=['autohex-ai-worker.js','autohex-planner.js','autohex-engine.js','autohex-ui.js','autohex-visuals.js','autohex.html','autohex.css']
def hashes():return {name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in FILES}
(OUT/'screenshots').mkdir(parents=True,exist_ok=True)
report={'kind':'real DOM/canvas controls; virtual clock for AI and lifecycle checks; staged legal opening for visual comparison','sourceSha256':hashes(),'errors':[],'viewports':[]}
OPENING='''() => {
 const g=autoHexGame;g.reset(g.seed,1,0);g.start();
 for(let i=0;i<120;i++){const action=AutoHex.chooseAction(g.observation(g.turn));if(!g.act(action))throw Error('Illegal opening action');g.advanceTime(300);}
 g.advanceTime(2000);g.pause();autoHexRender();autoHexSchedule();
 return {ply:g.ply,intents:g.observation(0).intents,telemetry:g.telemetry};
}'''
GOAL_FIXTURE='''() => {
 const E=AutoHex,g=autoHexGame;g.reset('planner-cue-complete',1,0);g.neutralEvents=false;
 g.board.set(g.anchors);g.terrain.fill(0);g.players[1].energy=8;g.hands[1]=Array(5).fill('reroute');
 const home=g.players[1].home,target=E.index(-18,0),queue=[home],parent=new Map([[home,-1]]);
 for(let n=0;n<queue.length&&!parent.has(target);n++)for(const i of E.ADJ[queue[n]])if(!parent.has(i)&&(!g.board[i]||g.board[i]===1)){parent.set(i,queue[n]);queue.push(i);}
 for(let i=parent.get(target);i!==-1;i=parent.get(i))g.board[i]=1;
 g.start();g.pause();autoHexRender();autoHexSchedule();return target;
}'''
def wait_ply(p,expected):
 deadline=time.monotonic()+12
 while p.evaluate('autoHexGame.ply')<expected and time.monotonic()<deadline:time.sleep(.02)
 assert p.evaluate('autoHexGame.ply')==expected
def advance_ai(p,actions=1):
 for _ in range(actions):
  expected=p.evaluate('autoHexGame.ply')+1;p.clock.run_for(300);wait_ply(p,expected)
def hit(p,selector,mobile):p.locator(selector).tap() if mobile else p.locator(selector).click()
def verify_public(p,player):
 return p.evaluate('''player=>{
  const expected=autoHexGame.observation(0).intents[player],actual=autoHexPlannerDebug();
  if(!expected||actual.selectedPlayer!==player||!actual.visible)throw Error('Missing committed public plan');
  for(const key of ['player','type','stage','target','reasonCode','committedAtPly','reviewAtPly','progress','completed','stalled'])if(actual.plan[key]!==expected[key])throw Error('Mismatched public '+key);
  if(JSON.stringify(actual.plan.path)!==JSON.stringify(expected.path.slice(0,16)))throw Error('Mismatched public route');
  if(actual.routeCellCount>16)throw Error('Unbounded route');
  if(JSON.stringify(actual).includes('plannerMemory')||'actions' in actual.plan||'hand' in actual.plan)throw Error('Private planner field leaked');
  return actual;
 }''',player)
try:
 with sync_playwright() as pw:
  b=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox'])
  for label,width,height,dpr,mobile in [('desktop',1440,1100,1,False),('mobile',390,844,3,True),('narrow',320,740,2,True)]:
   c=b.new_context(viewport={'width':width,'height':height},device_scale_factor=dpr,is_mobile=mobile,has_touch=mobile,reduced_motion='reduce' if label=='narrow' else 'no-preference')
   p=c.new_page();p.on('pageerror',lambda e:report['errors'].append(str(e)))
   p.clock.install(time=datetime(2026,10,11,18,0,tzinfo=timezone.utc));p.clock.pause_at(datetime(2026,10,11,18,1,tzinfo=timezone.utc))
   p.goto(BASE+'/autohex.html?seed=planner-opening-alpha&mode=spectator')
   assert p.evaluate('autoHexPlannerDebug().selectedPlayer')==1
   assert not p.evaluate('autoHexPlannerDebug().visible')
   assert p.locator('#plan-focus').is_disabled()
   assert p.locator('#step-seconds').input_value() in ['0.3','0.30']
   hit(p,'#play',mobile);advance_ai(p)
   first=verify_public(p,1)
   assert p.evaluate('autoHexPlanningDebug().count')==1
   assert p.evaluate('autoHexGame.ply')==1
   advance_ai(p,5)
   assert p.evaluate('autoHexGame.ply')==6
   assert p.evaluate('autoHexPlannerDebug().selectedPlayer')==1,'Selection followed turn instead of staying pinned'
   opening=p.evaluate(OPENING)
   hit(p,'#fit-map',mobile)
   pinned=verify_public(p,1)
   p.locator('.ah-arena').screenshot(path=str(OUT/f'screenshots/after-{label}-opening.png'))
   selected=[]
   for player in [1,2,3,4,5,6]:
    p.locator('#plan-faction').select_option(str(player));debug=verify_public(p,player);selected.append(debug['plan']['type'])
    if debug['plan']['target'] is not None:
     hit(p,'#plan-focus',mobile);point=p.evaluate('(cell)=>autoHexCellPoint(cell)',debug['plan']['target']);box=p.locator('#board').bounding_box()
     assert abs(point['x']-box['x']-box['width']/2)<2 and abs(point['y']-box['y']-box['height']/2)<2
   p.locator('#plan-faction').select_option('off')
   assert not p.evaluate('autoHexPlannerDebug().visible') and p.evaluate('autoHexPlannerDebug().routeCellCount')==0
   assert p.locator('#plan-focus').is_disabled()
   p.locator('#plan-faction').select_option('1');verify_public(p,1)
   # The view may contain own private memory; the presentation must never read it.
   p.evaluate('''()=>{const g=autoHexGame,original=g.observation;g.observation=function(observer){const view=original.call(this,observer);Object.defineProperty(view,'plannerMemory',{get(){throw Error('UI read private plannerMemory');}});return view;};try{autoHexRender();}finally{g.observation=original;}}''')
   assert p.evaluate('autoHexGame.observation(0).plannerMemory') is None
   before=p.evaluate('JSON.stringify({ply:autoHexGame.ply,time:autoHexGame.activeMs,intents:autoHexGame.observation(0).intents})')
   p.clock.run_for(900)
   assert p.evaluate('JSON.stringify({ply:autoHexGame.ply,time:autoHexGame.activeMs,intents:autoHexGame.observation(0).intents})')==before
   hit(p,'#step',mobile)
   assert p.evaluate('autoHexGame.ply')==opening['ply']+1
   assert p.evaluate('autoHexGame.phase')=='paused'
   assert p.evaluate('autoHexPlannerDebug().selectedPlayer')==1
   # Controlled last-gap board; the actual single-step policy must finish it.
   target=p.evaluate(GOAL_FIXTURE);assert not p.evaluate('autoHexPlannerDebug().visible')
   hit(p,'#step',mobile);completed=verify_public(p,1)
   assert completed['plan']['completed'] and completed['plan']['progress']==1
   assert p.evaluate('(target)=>autoHexGame.board[target]===1&&AutoHex.computeSupply(autoHexGame,1)[target]===1',target)
   assert p.locator('#plan-stage').inner_text()=='目標達成'
   assert p.locator('#plan-progress').get_attribute('aria-valuenow')=='100'
   hit(p,'#replay',mobile)
   assert p.evaluate('autoHexGame.ply')==0
   assert not p.evaluate('autoHexPlannerDebug().visible')
   advance_ai(p);replayed=verify_public(p,1)
   assert replayed['plan']==first['plan'],'Same seed first commitment did not replay'
   # Visibility and timing remain independent from the selected overlay.
   p.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))")
   assert p.evaluate('autoHexGame.phase')=='paused'
   frozen=p.evaluate('autoHexGame.activeMs');p.clock.run_for(700);assert p.evaluate('autoHexGame.activeMs')==frozen
   p.evaluate("delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))")
   assert p.evaluate('autoHexGame.phase')=='paused'
   hit(p,'#pause',mobile);advance_ai(p)
   assert p.evaluate('autoHexGame.ply')==2
   # A human player's own private planner record is never presented as an AI commitment.
   p.goto(BASE+'/autohex.html?seed=planner-human-alpha')
   assert p.evaluate('autoHexPlannerDebug().selectedPlayer')==2
   assert p.locator('#plan-faction option[value="1"]').count()==0
   hit(p,'#play',mobile);hit(p,'#rest',mobile);advance_ai(p)
   verify_public(p,2)
   assert p.evaluate('autoHexGame.observation(1).hand.length')>0
   assert p.evaluate('autoHexGame.observation(0).hand.length')==0
   assert p.evaluate('document.documentElement.scrollWidth<=innerWidth')
   controls=[p.locator('#plan-faction').bounding_box(),p.locator('#plan-focus').bounding_box()]
   if mobile:assert all(box['height']>=44 for box in controls)
   report['viewports'].append({'label':label,'dpr':dpr,'openingPly':opening['ply'],'typesInspected':selected,'firstCommitment':first['plan'],'pinnedAcrossTurns':True,'publicFieldsMatch':True,'privateMemoryNeverRead':True,'waypointNavigation':True,'offHidesRoute':True,'pauseAndSingleStep':True,'postActionGoalCompletionFixture':completed['plan'],'replaySameCommitment':True,'visibilityFreeze':True,'humanModeExcludesOwnAIPlan':True,'touchTargets44px':mobile,'reducedMotion':label=='narrow','overflow':False})
   c.close()
  b.close()
 assert not report['errors'],report['errors']
 assert hashes()==report['sourceSha256'],'Source changed during functional check'
 report['pass']=True
except Exception as error:
 report['pass']=False;report['failure']=repr(error);raise
finally:
 (OUT/'browser.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps(report,ensure_ascii=False,indent=2))
