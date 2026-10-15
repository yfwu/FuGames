"""One full keyboard-driven human expedition with accelerated browser time."""
from pathlib import Path
import json, os
from playwright.sync_api import sync_playwright
OUT=Path(__file__).resolve().parents[1]/'docs/tux2d-2026-10-14'
BASE=os.environ.get('FUGAMES_BASE_URL','http://127.0.0.1:8018')
with sync_playwright() as pw:
 b=pw.chromium.launch();p=b.new_page(viewport={'width':1280,'height':1000});p.goto(BASE+'/tux2d.html?seed=human-keyboard');p.clock.install();p.locator('#tux-play').click();held=None;routes=set();errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
 for i in range(460):
  v=p.evaluate('({r:tux2dGame.racers[0],objects:tux2dGame.objects,racers:tux2dGame.racers,phase:tux2dGame.phase})');r=v['r'];local=r['z']%2400;stage=int(max(0,r['z'])//2400)
  if v['phase']=='over':break
  target=-.58 if stage!=1 else .58
  threats=[o for o in v['objects'] if o['type'] in ['traffic','rock'] and 0<o['z']-r['z']<180 and abs(o['x']-r['x'])<.3]
  if threats:
   o=threats[0]
   target=(-.85 if o['x']>-.55 else -.27) if 900<local<1550 and r['route']=='supply' else (.85 if o['x']<.55 else .27) if 900<local<1550 else (-.6 if o['x']>0 else .6)
  key='ArrowRight' if target-r['x']>.10 else 'ArrowLeft' if target-r['x']<-.10 else None
  if key!=held:
   if held:p.keyboard.up(held)
   if key:p.keyboard.down(key)
   held=key
  if threats and r['shield']==0 and r['energy']>=25 and threats[0]['z']-r['z']<70:p.keyboard.press('Space')
  elif not threats and not 500<local<1600 and r['energy']>=70 and r['boost']==0:p.keyboard.press('Shift')
  if r['route'] and 900<local<1550:routes.add(r['route'])
  p.clock.run_for(250)
  if i==140:p.screenshot(path=str(OUT/'desktop-play.png'))
 assert p.evaluate("tux2dGame.racers[0].finished"),p.evaluate('tux2dGame.racers[0]')
 assert routes=={'supply','express'},routes
 p.clock.run_for(150)
 p.locator('#tux-result').screenshot(path=str(OUT/'keyboard-result.png'))
 result=p.evaluate('({time:tux2dGame.elapsed,player:tux2dGame.racers[0],telemetry:tux2dGame.telemetry})');result.update({'method':'Unmodified human game; native keyboard events from a bounded observation-based driver; accelerated browser clock, no direct engine steps or state writes.','routes':sorted(routes),'errors':errors})
 (OUT/'keyboard-run.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False));b.close()
