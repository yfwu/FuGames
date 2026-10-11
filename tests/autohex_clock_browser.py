"""Regress stale animation timestamps overlapping slow AI using real time."""
from pathlib import Path
import json, os
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
BASE=os.environ.get('FUGAMES_BASE_URL','http://127.0.0.1:8011')
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    p=browser.new_page();errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
    p.add_init_script('''const originalRAF=requestAnimationFrame.bind(window);
      window.requestAnimationFrame=cb=>originalRAF(ts=>cb(ts-75));''')
    p.goto(BASE+'/autohex.html?mode=spectator&seed=clock-regression')
    p.evaluate('''() => {const choose=AutoHex.chooseAction;
      AutoHex.chooseAction=o=>{const end=performance.now()+25;while(performance.now()<end){}return choose(o);};
      document.querySelector('#play').click();window.probeStart=performance.now();}''')
    p.wait_for_timeout(4000)
    report=p.evaluate('''()=>{document.querySelector('#pause').click();return{
      elapsedMs:performance.now()-probeStart,activeMs:autoHexGame.activeMs,ply:autoHexGame.ply,phase:autoHexGame.phase};}''')
    report['driftMs']=report['activeMs']-report['elapsedMs'];report['pageErrors']=errors
    frozen=report['activeMs'];p.wait_for_timeout(300);assert p.evaluate('autoHexGame.activeMs')==frozen
    assert -100<report['driftMs']<25,report
    assert report['ply']>=5 and not errors,report
    report['pauseFrozen']=True
    (Path(os.environ.get('AUTOHEX_REPORT_DIR', str(ROOT/'docs/autohex-2026-10-11')))/'clock-regression.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2));browser.close()
