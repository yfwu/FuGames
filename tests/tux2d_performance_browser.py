"""Measure real shipped RAF callback costs, without accelerated browser time.

Headless Chromium device emulation is not a physical phone performance promise.
"""
from pathlib import Path
import hashlib, json, os
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs/tux2d-2026-10-11'
BASE=os.environ.get('FUGAMES_BASE_URL','http://127.0.0.1:8011')
FILES=['tux2d-engine.js','tux2d-ui.js','tux2d.css','tux2d.html']
report={'mode':'real requestAnimationFrame callback cost in headless Chromium; emulated viewport/DPR',
        'sourceSha256':{f:hashlib.sha256((ROOT/f).read_bytes()).hexdigest() for f in FILES},'devices':[]}
SCRIPT='''(() => {
 const original=requestAnimationFrame.bind(window);
 window.tuxPerf={durations:[],intervals:[],previous:null};
 window.requestAnimationFrame=callback=>original(time=>{
   const active=window.tux2dGame?.phase==='racing';
   const before=performance.now(); callback(time);
   if(active){const p=window.tuxPerf;p.durations.push(performance.now()-before);
     if(p.previous!==null)p.intervals.push(time-p.previous);p.previous=time;
     if(p.durations.length>1200)p.durations.shift();if(p.intervals.length>1200)p.intervals.shift();}
 });
})();'''


def describe(values):
    s=sorted(values)
    return {'count':len(s),'medianMs':s[len(s)//2],'p95Ms':s[int((len(s)-1)*.95)],
            'maxMs':s[-1],'meanMs':sum(s)/len(s)}


with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    for label,w,h,dpr,mobile in [('desktop',1440,1100,1,False),('mobile',390,844,3,True)]:
        ctx=browser.new_context(viewport={'width':w,'height':h},device_scale_factor=dpr,is_mobile=mobile,has_touch=mobile)
        ctx.add_init_script(SCRIPT);p=ctx.new_page();errors=[]
        p.on('pageerror',lambda e:errors.append(str(e)))
        p.goto(BASE+'/tux2d.html?mode=spectator&seed=perf-final')
        p.locator('#tux-play').click();p.wait_for_function('tux2dGame.phase==="racing"')
        before=p.evaluate('({time:performance.now(),model:tux2dGame.elapsed})')
        p.wait_for_timeout(12000)
        after=p.evaluate('({time:performance.now(),model:tux2dGame.elapsed,phase:tux2dGame.phase,perf:window.tuxPerf,telemetry:tux2dGame.telemetry})')
        assert after['phase']=='racing' and len(after['perf']['durations'])>120
        assert not errors,errors
        report['devices'].append({'label':label,'viewport':[w,h],'dpr':dpr,'wallSeconds':(after['time']-before['time'])/1000,
                                  'modelSeconds':after['model']-before['model'],'rafCallbackCost':describe(after['perf']['durations']),
                                  'rafInterval':describe(after['perf']['intervals']),'telemetry':after['telemetry'],'errors':errors})
        ctx.close()
    browser.close()
report['sourceUnchanged']=all(hashlib.sha256((ROOT/f).read_bytes()).hexdigest()==report['sourceSha256'][f] for f in FILES)
assert report['sourceUnchanged']
(OUT/'performance-browser.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
