"""Real performance.now measurements on played boards, no virtual clock."""
from pathlib import Path
import json, os
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=Path(os.environ.get('AUTOHEX_REPORT_DIR', str(ROOT/'docs/autohex-2026-10-11')))
BASE=os.environ.get('FUGAMES_BASE_URL','http://127.0.0.1:8011')
ACTIONS=int(os.environ.get('AUTOHEX_PERF_ACTIONS','360'))
report={'note':'Headless Chromium on this shared execution host; mobile viewport emulation is not a physical phone benchmark. Synchronous render excludes later compositor work. No virtual clock.','samples':[]}
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    for label,w,h,dpr,mobile in [('desktop',1440,1100,1,False),('mobile',390,844,3,True)]:
        ctx=browser.new_context(viewport={'width':w,'height':h},device_scale_factor=dpr,is_mobile=mobile,has_touch=mobile)
        p=ctx.new_page();errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
        p.goto(BASE+'/autohex.html?seed=performance-sample')
        sample=p.evaluate('''(actions)=>{
          const g=autoHexGame;g.start();const start=performance.now();
          for(let i=0;i<actions;i++){const a=AutoHex.chooseAction(g.observation());if(!g.act(a))throw Error('Illegal benchmark action');g.advanceTime(300);if(g.phase==='over')g.continueSandbox();}
          const setupMs=performance.now()-start, out={setupMs,ply:g.ply,activeMs:g.activeMs,phase:g.phase,sandbox:g.sandbox,render:[],observationAndAi:[]};
          for(let i=0;i<30;i++){let t=performance.now();autoHexRender();out.render.push(performance.now()-t);
            t=performance.now();AutoHex.chooseAction(g.observation());out.observationAndAi.push(performance.now()-t);}
          g.pause();autoHexRender();return out;}''',ACTIONS)
        assert sample['ply']==ACTIONS and not errors
        before=p.locator('#cell-info').inner_text();p.locator('#board').focus();p.keyboard.press('ArrowLeft')
        assert p.locator('#cell-info').inner_text()!=before
        sample.update(label=label,width=w,dpr=dpr,pageErrors=errors,keyboardNavigation=True)
        for key in ['render','observationAndAi']:
            vals=sorted(sample[key]);sample[key+'SummaryMs']={'median':vals[len(vals)//2],'p95':vals[int(len(vals)*.95)-1],'max':max(vals)}
        report['samples'].append(sample);ctx.close()
    browser.close()
(OUT/'performance-browser.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
