"""Profile main-thread rendering with the current or captured pre-cache UI.

The legal 600-action setup uses model time to obtain a played board. Only the
following foreground 30-second interval is timed as real browser performance.
"""
from pathlib import Path
import hashlib,json,os,time
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ.get('AUTOHEX_REPORT_DIR',str(ROOT/'docs/autohex-planner-2026-10-11')))
BASE=os.environ.get('FUGAMES_BASE_URL','http://127.0.0.1:8011')
VERSION=os.environ.get('AUTOHEX_RENDER_VERSION','cached')
assert VERSION in ['before','cached']
FILES=['autohex-ai-worker.js','autohex-planner.js','autohex-engine.js','autohex-ui.js','autohex-visuals.js','autohex.html','autohex.css']
def hashes():return {name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in FILES}
def summary(values):
 values=sorted(values)
 return {'count':len(values),'medianMs':values[len(values)//2],'p95Ms':values[max(0,int(len(values)*.95)-1)],'maxMs':values[-1]} if values else {'count':0}
report={'note':'Real foreground Chromium on this execution host; mobile viewport emulation is not a physical-phone benchmark. Disclose concurrent CPU workloads when interpreting results. No virtual clock in measured interval.','sourceSha256':hashes(),'samples':[],'errors':[]}
OUT.mkdir(parents=True,exist_ok=True)
try:
 with sync_playwright() as pw:
  b=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox'])
  for label,width,height,dpr,mobile in [('desktop',1440,1100,1,False)]:
   c=b.new_context(viewport={'width':width,'height':height},device_scale_factor=dpr,is_mobile=mobile,has_touch=mobile)
   p=c.new_page();p.on('pageerror',lambda e:report['errors'].append(str(e)));
   if VERSION=='before':
    before=json.loads((ROOT/'docs/autohex-planner-2026-10-11/renderer-before-source.json').read_text());assert hashlib.sha256(before['source'].encode()).hexdigest()==before['sha256'];p.route('**/autohex-ui.js',lambda route:route.fulfill(body=before['source'],content_type='application/javascript'));report['renderedUiSha256']=before['sha256']
   else:report['renderedUiSha256']=report['sourceSha256']['autohex-ui.js']
   p.goto(BASE+'/autohex.html?mode=spectator&seed=planner-render-profile')
   p.evaluate('''()=>{const g=autoHexGame;g.start();for(let i=0;i<600;i++){if(!g.act(AutoHex.chooseAction(g.observation(g.turn))))throw Error('Illegal setup action');g.advanceTime(300);}g.pause();autoHexRender();autoHexSchedule();}''')
   p.evaluate('''()=>{
    window.profile={gaps:[],longTasks:[],planning:[],wait:[],modes:[],act:[],hidden:0};
    document.addEventListener('visibilitychange',()=>{if(document.hidden)profile.hidden++;});
    const original=AutoHex.Game.prototype.act;
    AutoHex.Game.prototype.act=function(action){const t=performance.now(),ok=original.call(this,action);if(ok){profile.act.push(performance.now()-t);const timing=autoHexPlanningDebug();profile.planning.push(timing.lastMs);profile.wait.push(timing.lastLatencyMs);profile.modes.push(timing.lastMode);}return ok;};
    if(PerformanceObserver.supportedEntryTypes?.includes('longtask')){profile.observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())profile.longTasks.push(entry.duration);});profile.observer.observe({type:'longtask'});}
    let last=null;const frame=now=>{if(last!==null&&autoHexGame.phase==='running')profile.gaps.push(now-last);last=now;profile.frame=requestAnimationFrame(frame);};profile.frame=requestAnimationFrame(frame);
   }''')
   cdp=c.new_cdp_session(p);cdp.send('Profiler.enable');cdp.send('Profiler.setSamplingInterval',{'interval':1000});cdp.send('Profiler.start');p.bring_to_front();start=time.monotonic();p.locator('#pause').click();p.wait_for_timeout(14000)
   interaction_start=time.monotonic();p.locator('#plan-faction').select_option('off');assert p.evaluate('autoHexPlannerDebug().visible') is False
   p.locator('#plan-faction').select_option('3');assert p.evaluate('autoHexPlannerDebug().selectedPlayer')==3
   if p.locator('#plan-focus').is_enabled():p.locator('#plan-focus').tap() if mobile else p.locator('#plan-focus').click()
   interaction_ms=(time.monotonic()-interaction_start)*1000
   p.wait_for_timeout(max(0,30000-(time.monotonic()-start)*1000))
   p.locator('#pause').click()
   cpu=cdp.send('Profiler.stop')['profile'];Path('/tmp/autohex-main-'+VERSION+'.cpuprofile').write_text(json.dumps(cpu));
   data=p.evaluate('''()=>{cancelAnimationFrame(profile.frame);profile.observer?.disconnect();return {planning:profile.planning,wait:profile.wait,modes:profile.modes,act:profile.act,gaps:profile.gaps,longTasks:profile.longTasks,hidden:profile.hidden,ply:autoHexGame.ply,speed:document.querySelector('#step-seconds').value,overflow:document.documentElement.scrollWidth>innerWidth,planner:autoHexPlannerDebug()};}''')
   assert data['hidden']==0 and not data['overflow'] and float(data['speed'])==.3
   assert len(data['planning'])>=20,'Too few real actions in the 30-second sample'
   sample={'label':label,'dpr':dpr,'wallSeconds':time.monotonic()-start,'actions':len(data['planning']),'planning':summary(data['planning']),'decisionWait':summary(data['wait']),'planningModes':dict(__import__('collections').Counter(data['modes'])),'act':summary(data['act']),'frame':summary(data['gaps']),'longTasks':summary(data['longTasks']),'frameGapsOver50ms':sum(v>50 for v in data['gaps']),'interactionWallMs':interaction_ms,'hiddenEvents':data['hidden'],'overflow':data['overflow'],'finalPlanner':data['planner']}
   nodes={node['id']:node for node in cpu['nodes']};costs={};
   for nodeid,delta in zip(cpu.get('samples',[]),cpu.get('timeDeltas',[])):
    f=nodes[nodeid]['callFrame'];key=(f['functionName'] or '(anonymous)',f['url'],f['lineNumber']);costs[key]=costs.get(key,0)+delta
   report['mainThreadTopSelfMs']=[{'function':k[0],'url':k[1],'line':k[2]+1,'selfMs':round(v/1000,2)} for k,v in sorted(costs.items(),key=lambda x:-x[1])[:35]];report['samples'].append(sample);print(json.dumps(sample,ensure_ascii=False),flush=True);c.close()
  b.close()
 assert not report['errors'],report['errors']
 assert hashes()==report['sourceSha256'],'Sources changed during performance sample'
 report['pass']=True
except Exception as error:
 report['pass']=False;report['failure']=repr(error);raise
finally:
 (OUT/('profile-render-'+VERSION+'.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps(report,ensure_ascii=False,indent=2))
