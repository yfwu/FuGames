"""Regress stale animation timestamps overlapping slow AI using real time."""
from pathlib import Path
import hashlib, json, os
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
BASE=os.environ.get('FUGAMES_BASE_URL','http://127.0.0.1:8011')
OUT=Path(os.environ.get('AUTOHEX_REPORT_DIR',str(ROOT/'docs/autohex-2026-10-11')))
FILES=['config/hex-strategies.json','hex-core.js','hex-strategies.js','cardhex-engine.js','card_hex.html','autohex-ai-worker.js','autohex-planner.js','autohex-engine.js','autohex-ui.js','autohex-visuals.js','autohex.html','autohex.css']
def hashes():return {name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in FILES}
source=hashes();results=[]
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    for mode in ['worker','fallback']:
        p=browser.new_page();errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
        p.add_init_script('''const originalRAF=requestAnimationFrame.bind(window);
          window.requestAnimationFrame=cb=>originalRAF(ts=>cb(ts-75));''')
        if mode=='fallback':p.add_init_script('window.Worker=undefined')
        p.goto(BASE+'/autohex.html?mode=spectator&seed=clock-regression')
        p.evaluate('''() => {
          if(typeof Worker!=='function'){const create=HexCore.create;window.HexCore={...HexCore,create:options=>{const api=create(options);return {...api,chooseAction:o=>{const end=performance.now()+25;while(performance.now()<end){}return api.chooseAction(o);}};}};}
          document.querySelector('#play').click();window.probeStart=performance.now();}''')
        p.wait_for_timeout(4000)
        report=p.evaluate('''()=>{document.querySelector('#pause').click();return{
          elapsedMs:performance.now()-probeStart,activeMs:autoHexGame.activeMs,ply:autoHexGame.ply,phase:autoHexGame.phase,timing:autoHexPlanningDebug()};}''')
        report['driftMs']=report['activeMs']-report['elapsedMs'];report['pageErrors']=errors
        frozen=report['activeMs'];p.wait_for_timeout(300);assert p.evaluate('autoHexGame.activeMs')==frozen
        assert -100<report['driftMs']<25,report
        assert report['ply']>=5 and not errors,report
        report['pauseFrozen']=True
        report['mode']=mode;assert report['timing']['lastMode']==mode
        results.append(report);p.close()
    browser.close()
assert hashes()==source,'Source changed during clock check'
report={'sourceSha256':source,'method':'Real time with RAF timestamps deliberately 75 ms stale; fallback adds 25 ms blocking work per decision.','scenarios':results}
OUT.mkdir(parents=True,exist_ok=True)
(OUT/'clock-regression.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
