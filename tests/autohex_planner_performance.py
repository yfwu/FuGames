"""Actual default-pacing planner/frame timings on two browser viewports.

The legal 180-action setup uses model time to obtain a played board. Only the
following foreground 30-second interval is timed as real browser performance.
"""
from pathlib import Path
import hashlib,json,os,time
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ.get('AUTOHEX_REPORT_DIR',str(ROOT/'docs/autohex-planner-2026-10-11')))
BASE=os.environ.get('FUGAMES_BASE_URL','http://127.0.0.1:8011')
FILES=['config/hex-strategies.json','hex-core.js','hex-strategies.js','cardhex-engine.js','card_hex.html','autohex-ai-worker.js','autohex-planner.js','autohex-engine.js','autohex-ui.js','autohex-visuals.js','autohex.html','autohex.css']
def hashes():return {name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in FILES}
def summary(values):
 values=sorted(values)
 return {'count':len(values),'medianMs':values[len(values)//2],'p95Ms':values[max(0,int(len(values)*.95)-1)],'maxMs':values[-1]} if values else {'count':0}
report={'note':'Real foreground Chromium on this execution host; mobile viewport emulation is not a physical-phone benchmark. Disclose concurrent CPU workloads when interpreting results. No virtual clock in measured interval.','sourceSha256':hashes(),'samples':[],'errors':[]}
OUT.mkdir(parents=True,exist_ok=True)
try:
 with sync_playwright() as pw:
  b=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox'])
  for label,width,height,dpr,mobile in [('desktop',1440,1100,1,False),('mobile',390,844,3,True)]:
   c=b.new_context(viewport={'width':width,'height':height},device_scale_factor=dpr,is_mobile=mobile,has_touch=mobile)
   p=c.new_page();p.on('pageerror',lambda e:report['errors'].append(str(e)));p.goto(BASE+'/autohex.html?mode=spectator&seed=planner-performance')
   p.evaluate('''()=>{const g=autoHexGame;g.start();for(let i=0;i<180;i++){if(!g.act(HexAPI.chooseAction(g.observation(g.turn))))throw Error('Illegal setup action');g.advanceTime(300);}g.pause();autoHexRender();autoHexSchedule();}''')
   p.evaluate('''()=>{
    window.profile={gaps:[],longTasks:[],planning:[],wait:[],modes:[],act:[],hidden:0};
    document.addEventListener('visibilitychange',()=>{if(document.hidden)profile.hidden++;});
    const original=HexAPI.Game.prototype.act;
    HexAPI.Game.prototype.act=function(action){const t=performance.now(),ok=original.call(this,action);if(ok){profile.act.push(performance.now()-t);const timing=autoHexPlanningDebug();profile.planning.push(timing.lastMs);profile.wait.push(timing.lastLatencyMs);profile.modes.push(timing.lastMode);}return ok;};
    if(PerformanceObserver.supportedEntryTypes?.includes('longtask')){profile.observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())profile.longTasks.push(entry.duration);});profile.observer.observe({type:'longtask'});}
    let last=null;const frame=now=>{if(last!==null&&autoHexGame.phase==='running')profile.gaps.push(now-last);last=now;profile.frame=requestAnimationFrame(frame);};profile.frame=requestAnimationFrame(frame);
   }''')
   p.bring_to_front();start=time.monotonic();p.locator('#pause').click();p.wait_for_timeout(14000)
   interaction_start=time.monotonic();p.locator('#plan-faction').select_option('off');assert p.evaluate('autoHexPlannerDebug().visible') is False
   p.locator('#plan-faction').select_option('3');assert p.evaluate('autoHexPlannerDebug().selectedPlayer')==3
   if p.locator('#plan-focus').is_enabled():p.locator('#plan-focus').tap() if mobile else p.locator('#plan-focus').click()
   interaction_ms=(time.monotonic()-interaction_start)*1000
   p.wait_for_timeout(max(0,30000-(time.monotonic()-start)*1000))
   p.locator('#pause').click()
   data=p.evaluate('''()=>{cancelAnimationFrame(profile.frame);profile.observer?.disconnect();return {planning:profile.planning,wait:profile.wait,modes:profile.modes,act:profile.act,gaps:profile.gaps,longTasks:profile.longTasks,hidden:profile.hidden,ply:autoHexGame.ply,speed:document.querySelector('#step-seconds').value,overflow:document.documentElement.scrollWidth>innerWidth,planner:autoHexPlannerDebug()};}''')
   assert data['hidden']==0 and not data['overflow'] and float(data['speed'])==.3
   assert len(data['planning'])>=20,'Too few real actions in the 30-second sample'
   sample={'label':label,'dpr':dpr,'wallSeconds':time.monotonic()-start,'actions':len(data['planning']),'planning':summary(data['planning']),'decisionWait':summary(data['wait']),'planningModes':dict(__import__('collections').Counter(data['modes'])),'act':summary(data['act']),'frame':summary(data['gaps']),'longTasks':summary(data['longTasks']),'frameGapsOver50ms':sum(v>50 for v in data['gaps']),'interactionWallMs':interaction_ms,'hiddenEvents':data['hidden'],'overflow':data['overflow'],'finalPlanner':data['planner']}
   report['samples'].append(sample);print(json.dumps(sample,ensure_ascii=False),flush=True);c.close()
  b.close()
 assert not report['errors'],report['errors']
 assert hashes()==report['sourceSha256'],'Sources changed during performance sample'
 report['pass']=True
except Exception as error:
 report['pass']=False;report['failure']=repr(error);raise
finally:
 (OUT/'performance-browser.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps(report,ensure_ascii=False,indent=2))
