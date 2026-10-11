"""Real Worker decisions held at delivery to test race/cancellation guards.

Virtual main-page time schedules timers; the actual worker calculates normally.
Only the delivery wrapper injects mismatched/stale/duplicate envelopes. No game
state is edited, and these functional checks are not elapsed-campaign evidence.
"""
from pathlib import Path
from datetime import datetime, timezone
import hashlib, json, os, time
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ.get('AUTOHEX_REPORT_DIR',str(ROOT/'docs/autohex-planner-2026-10-11')))
BASE=os.environ.get('FUGAMES_BASE_URL','http://127.0.0.1:8011')
FILES=['config/hex-strategies.json','hex-core.js','hex-strategies.js','cardhex-engine.js','card_hex.html','autohex-ai-worker.js','autohex-planner.js','autohex-engine.js','autohex-ui.js','autohex-visuals.js','autohex.html','autohex.css']
def hashes():return {name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in FILES}
OUT.mkdir(parents=True,exist_ok=True)
report={'method':'Actual Worker computation; virtual main-page clock; held real responses and explicit adversarial delivery envelopes','sourceSha256':hashes(),'checks':[],'errors':[]}
WRAPPER='''(() => {
 const NativeWorker=Worker;
 const audit=window.workerAudit={created:0,terminated:[],requests:[],queue:[],history:[]};
 window.Worker=class extends NativeWorker {
  constructor(...args){super(...args);this.auditId=++audit.created;}
  terminate(){audit.terminated.push(this.auditId);return super.terminate();}
  postMessage(message,...args){
   const v=message.observation;
   if(v.observer!==message.turn||v.turn!==message.turn||v.ply!==message.ply)throw Error('Wrong observation perspective');
   for(const key of ['hands','drawPile','discardPile','plannerStates'])if(key in v)throw Error('Private game field sent: '+key);
   audit.requests.push({worker:this.auditId,id:message.id,generation:message.generation,ply:message.ply,turn:message.turn,observer:v.observer,handCount:v.hand.length,coreConfig:v.coreConfig,memoryOwner:v.plannerMemory?message.turn:null,keys:Object.keys(message)});
   return super.postMessage(message,...args);
  }
  addEventListener(type,callback,...args){
   if(type!=='message')return super.addEventListener(type,callback,...args);
   return super.addEventListener(type,event=>{const row={worker:this.auditId,data:event.data,callback};audit.queue.push(row);audit.history.push(row);},...args);
  }
 };
 window.releaseDecision=(index=0,patch=null,retain=false)=>{
  const row=audit.queue[index];if(!row)throw Error('No queued worker decision');
  if(!retain)audit.queue.splice(index,1);
  row.callback(new MessageEvent('message',{data:patch?{...row.data,...patch}:row.data}));
 };
 window.duplicateDecision=index=>{const row=audit.history[index];row.callback(new MessageEvent('message',{data:row.data}));};
})();'''
def until(p,expression):
 end=time.monotonic()+20
 while not p.evaluate(expression):
  if time.monotonic()>end:raise AssertionError('Timed out: '+expression)
  time.sleep(.025)
def state(p):return p.evaluate('JSON.stringify({seed:autoHexGame.seed,ply:autoHexGame.ply,turn:autoHexGame.turn,board:autoHexGame.board,intents:autoHexGame.observation(0).intents})')
def begin(p,page='autohex.html'):
 p.goto(BASE+'/'+page+'?seed=worker-lifecycle-alpha&mode=spectator')
 p.locator('#play').click();p.clock.run_for(300)
 until(p,'workerAudit.queue.length===1')
 assert p.evaluate('autoHexGame.ply')==0
 assert p.evaluate('!!autoHexUI().workerPending')
def next_job(p,delay=300):
 p.clock.run_for(delay);until(p,'workerAudit.queue.length===1')
try:
 with sync_playwright() as pw:
  b=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox'])
  c=b.new_context(viewport={'width':1280,'height':900});c.add_init_script(WRAPPER)
  p=c.new_page();p.on('pageerror',lambda e:report['errors'].append(str(e)))
  p.clock.install(time=datetime(2026,10,11,18,0,tzinfo=timezone.utc));p.clock.pause_at(datetime(2026,10,11,18,1,tzinfo=timezone.utc))
  begin(p)
  # Every identity component independently rejects mismatched deliveries.
  for key in ['id','generation','ply','turn']:
   p.evaluate('(key)=>releaseDecision(0,{[key]:workerAudit.queue[0].data[key]+1},true)',key)
   assert p.evaluate('autoHexGame.ply')==0 and p.evaluate('!!autoHexUI().workerPending')
  p.evaluate('releaseDecision()');until(p,'autoHexGame.ply===1')
  p.evaluate('duplicateDecision(0)');assert p.evaluate('autoHexGame.ply')==1
  assert p.evaluate('autoHexPlanningDebug().lastMode')=='worker'
  next_job(p);assert p.evaluate('workerAudit.created')==1,'Idle Worker was unnecessarily replaced'
  p.evaluate('releaseDecision()');until(p,'autoHexGame.ply===2')
  assert p.evaluate('autoHexPlanningDebug().workerCount')==2
  report['checks'].append('id/generation/ply/turn guards; duplicate ignored; one action per valid response; idle Worker reused')
  # Actual pause/speed/replay/restart/visibility controls cancel in-flight work.
  for operation in ['pause','speed','replay','restart','visibility']:
   begin(p);before=state(p)
   if operation=='pause':p.locator('#pause').click()
   elif operation=='speed':p.locator('#step-seconds').fill('1');p.locator('#step-seconds').dispatch_event('change')
   elif operation in ['replay','restart']:p.locator('#'+operation).click()
   elif operation=='visibility':p.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))")
   assert not p.evaluate('!!autoHexUI().workerPending')
   assert p.evaluate('workerAudit.terminated.length')==1
   after=state(p);p.evaluate('releaseDecision()');assert state(p)==after,'Stale decision changed '+operation
   if operation in ['pause','visibility']:
    p.clock.run_for(1000);assert state(p)==after
   else:
    if operation=='restart':
     assert p.evaluate('autoHexGame.phase')=='ready';p.locator('#play').click()
    next_job(p,1000 if operation=='speed' else 300)
    assert p.evaluate('workerAudit.created')==2
    p.evaluate('releaseDecision()');until(p,'autoHexGame.ply===1')
   if operation=='visibility':p.evaluate("delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))")
   report['checks'].append(operation+': pending computation terminated; held old response ignored')
  begin(p)
  p.evaluate('autoHexGame.advanceTime(600000);autoHexRender();autoHexSchedule()') # Disclosed expiry boundary fixture.
  assert p.evaluate('autoHexGame.phase')=='over' and not p.evaluate('!!autoHexUI().workerPending')
  p.locator('#match-mode').select_option('human');clean=state(p);p.evaluate('releaseDecision()');assert state(p)==clean
  assert p.evaluate('autoHexGame.phase')=='ready' and p.evaluate('autoHexUI().mode')=='human'
  report['checks'].append('campaign expiry cancels pending response; setup mode switch starts a clean ready game')
  begin(p)
  # Rapid replays replace the game many times before an old response arrives.
  for _ in range(8):p.locator('#replay').click()
  clean=state(p);p.evaluate('releaseDecision()');assert state(p)==clean
  next_job(p);p.evaluate('releaseDecision()');until(p,'autoHexGame.ply===1')
  p.evaluate('duplicateDecision(0);duplicateDecision(1)');assert p.evaluate('autoHexGame.ply')==1
  report['checks'].append('eight rapid replays clear old work; old and current duplicate responses cannot double-act')
  report['lastRunRequests']=p.evaluate('workerAudit.requests')
  report['timing']=p.evaluate('autoHexPlanningDebug()')
  # Normal Hex uses the same Worker with a different fixed geometry. Changing
  # seat count while an old result is held cannot deliver it into the new game.
  begin(p,'card_hex.html');assert p.evaluate('workerAudit.requests[0].coreConfig.radius')==9
  p.locator('#restart').click();p.locator('#seat-count').select_option('2');clean=state(p)
  p.evaluate('releaseDecision()');assert state(p)==clean
  assert p.evaluate('HexAPI.PLAYERS.length')==2
  p.locator('#play').click();next_job(p);p.evaluate('releaseDecision()');until(p,'autoHexGame.ply===1')
  assert p.evaluate('workerAudit.requests.at(-1).coreConfig.playerCount')==2
  assert not p.locator('#handoff').is_visible()
  report['checks'].append('normal radius-9 Worker instance; 3-to-2 seat reset rejects old result and recomputes with matching geometry')
  # A browser without Worker support keeps the game usable, and reports fallback.
  f=b.new_context();f.add_init_script('window.Worker=undefined');fp=f.new_page()
  fp.on('pageerror',lambda e:report['errors'].append(str(e)))
  fp.clock.install(time=datetime(2026,10,11,18,0,tzinfo=timezone.utc));fp.clock.pause_at(datetime(2026,10,11,18,1,tzinfo=timezone.utc))
  fp.goto(BASE+'/autohex.html?seed=worker-lifecycle-alpha&mode=spectator');fp.locator('#play').click();fp.clock.run_for(300)
  until(fp,'autoHexGame.ply===1');assert fp.evaluate('autoHexPlanningDebug().lastMode')=='fallback'
  assert fp.evaluate('autoHexUI().workerFallback')
  report['checks'].append('missing Worker support uses an explicit measured synchronous fallback')
  f.close();c.close();b.close()
 assert not report['errors'],report['errors']
 assert hashes()==report['sourceSha256'],'Source changed during Worker check'
 report['pass']=True
except Exception as error:
 report['pass']=False;report['failure']=repr(error);raise
finally:
 (OUT/'worker-browser.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps(report,ensure_ascii=False,indent=2))
