"""Measure actual Chromium AI work, with and without 4x CPU throttling (not physical mobile)."""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];report=[]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for rate in [1,4]:
  page=b.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True);page.goto('http://127.0.0.1:8000/card_hex.html?seed=responsive');page.locator('#match-mode').select_option('spectator')
  session=page.context.new_cdp_session(page);session.send('Emulation.setCPUThrottlingRate',{'rate':rate})
  page.evaluate("() => {window.aiMs=[];const originalChoose=CardHex.chooseAction;CardHex.chooseAction=o=>{const begin=performance.now(),result=originalChoose(o);aiMs.push(performance.now()-begin);return result;};}")
  for step in range(30):
   page.locator('#step').click();assert page.evaluate('hexGame.phase')=='paused'
   if step%5==0:page.locator('#zoom').click();assert page.locator('#zoom').get_attribute('aria-pressed')==('true' if step%10==0 else 'false')
  times=sorted(page.evaluate('aiMs'));report.append({'cpuSlowdown':rate,'decisions':len(times),'meanMs':sum(times)/len(times),'p95Ms':times[max(0,int(len(times)*.95)-1)],'maxMs':max(times),'pauseAndZoomResponded':True});page.close()
 b.close()
(ROOT/'docs/hex-seeded-2026-10-11/responsiveness.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
