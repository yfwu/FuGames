"""Pixel/lifecycle regression for static-layer caching, including active effects.

The original UI is routed from its immutable captured source. Controlled combat
fixtures produce real turret/shield events. Only the page clock is virtual.
"""
from pathlib import Path
from datetime import datetime, timezone
from io import BytesIO
import ast, hashlib, json, os
import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ.get('AUTOHEX_REPORT_DIR',str(ROOT/'docs/autohex-planner-2026-10-11')))
BASE=os.environ.get('FUGAMES_BASE_URL','http://127.0.0.1:8011')
FILES=['autohex-ai-worker.js','autohex-planner.js','autohex-engine.js','autohex-ui.js','autohex-visuals.js','autohex.html','autohex.css']
def hashes():return {name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in FILES}
before=json.loads((ROOT/'docs/autohex-planner-2026-10-11/renderer-before-source.json').read_text())
assert hashlib.sha256(before['source'].encode()).hexdigest()==before['sha256']
for item in ast.parse((ROOT/'tests/autohex_visual_browser.py').read_text()).body:
 if isinstance(item,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='FIXTURE' for t in item.targets):FIXTURE=ast.literal_eval(item.value)
report={'method':'Before/after canvas screenshot comparison at identical paused effect ages, same engine/fixture; actual pan/zoom/touch/inspection controls; virtual animation clock','sourceSha256':hashes(),'beforeUiSha256':before['sha256'],'cases':[],'errors':[]}
(OUT/'screenshots').mkdir(parents=True,exist_ok=True)
def pixels(data):return np.asarray(Image.open(BytesIO(data)).convert('RGBA')).astype(np.int16)
def shot(p):return p.locator('#board').screenshot()
try:
 with sync_playwright() as pw:
  b=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox'])
  for label,w,h,dpr,mobile in [('desktop',1440,1100,1,False),('mobile',390,844,3,True),('narrow',320,740,2,True)]:
   versions={};debug=None
   for kind in ['before','cached']:
    c=b.new_context(viewport={'width':w,'height':h},device_scale_factor=dpr,is_mobile=mobile,has_touch=mobile)
    p=c.new_page();p.on('pageerror',lambda e:report['errors'].append(str(e)))
    p.clock.install(time=datetime(2026,10,11,20,0,tzinfo=timezone.utc));p.clock.pause_at(datetime(2026,10,11,20,1,tzinfo=timezone.utc))
    if kind=='before':p.route('**/autohex-ui.js',lambda route:route.fulfill(body=before['source'],content_type='application/javascript'))
    p.goto(BASE+'/autohex.html?seed=legibility-fixture');ids=p.evaluate(FIXTURE)
    p.locator('#fit-map').click();states={'whole':shot(p)}
    p.evaluate("autoHexGame.start();autoHexGame.act({type:'rest',cells:[]});autoHexGame.pause();autoHexRender();autoHexSchedule()")
    assert p.evaluate('autoHexVisualDebug().effects.filter(x=>x.source===\'turret\').length')==2
    p.locator('#inspect-mode').click();p.evaluate('(cell)=>autoHexFocusCell(cell)',ids['center']);p.locator('#board').scroll_into_view_if_needed()
    point=p.evaluate('(cell)=>autoHexCellPoint(cell)',ids['center'])
    p.touchscreen.tap(point['x'],point['y']) if mobile else p.mouse.click(point['x'],point['y'])
    states['frozen-impacts-range-selection']=shot(p)
    if kind=='cached' and label in ['desktop','mobile']:(OUT/f'screenshots/cache-{label}-impacts.png').write_bytes(states['frozen-impacts-range-selection'])
    p.locator('#supply-mode').select_option('off');states['supply-off']=shot(p)
    p.locator('#supply-mode').select_option('all');p.locator('#zoom-in').click();p.locator('#board').scroll_into_view_if_needed();box=p.locator('#board').bounding_box()
    p.mouse.move(box['x']+box['width']*.45,box['y']+box['height']*.5);p.mouse.down();p.mouse.move(box['x']+box['width']*.57,box['y']+box['height']*.55,steps=4);p.mouse.up();states['zoom-pan']=shot(p)
    p.locator('#fit-map').click()
    if mobile:
     p.locator('#board').scroll_into_view_if_needed();box=p.locator('#board').bounding_box();x=box['x']+box['width']/2;y=box['y']+box['height']/2;cdp=c.new_cdp_session(p)
     def fingers(gap):return [{'x':x-gap,'y':y,'id':1},{'x':x+gap,'y':y,'id':2}]
     old=p.evaluate('autoHexUI().camera.scale');cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':fingers(25)})
     for gap in [35,50,65]:cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':fingers(gap)})
     cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]});assert p.evaluate('autoHexUI().camera.scale')>old*1.5
     states['touch-pinch']=shot(p);p.locator('#fit-map').click()
    # Actor A is human now, so the foreground animation has no AI timer.
    assert p.evaluate('autoHexGame.turn')==1
    p.locator('#pause').click();start=p.evaluate('window.autoHexRenderDebug?.()||null');p.clock.run_for(160)
    if kind=='cached':
     debug=p.evaluate('autoHexRenderDebug()');assert debug['rebuilds']==start['rebuilds'] and debug['minimaps']==start['minimaps']
     assert debug['composites']>start['composites'];assert debug['canvasCount']==2
    p.locator('#pause').click();states['aged-impacts']=shot(p)
    p.emulate_media(reduced_motion='reduce');states['reduced-motion']=shot(p)
    p.locator('#replay').click();assert not p.evaluate('autoHexVisualDebug().activeEffects');states['replay-clears']=shot(p)
    assert p.evaluate('document.documentElement.scrollWidth<=innerWidth')
    versions[kind]=states;c.close()
   differences=[]
   for name,original in versions['before'].items():
    a=pixels(original);z=pixels(versions['cached'][name]);assert a.shape==z.shape
    delta=np.abs(a-z);row={'state':name,'maxChannelDifference':int(delta.max()),'changedPixels':int(np.any(delta,axis=2).sum()),'pixels':int(a.shape[0]*a.shape[1])};differences.append(row)
    if row['maxChannelDifference']>2:
     Path('/tmp/autohex-cache-before.png').write_bytes(original);Path('/tmp/autohex-cache-after.png').write_bytes(versions['cached'][name])
     yy,xx=np.where(np.any(delta>2,axis=2));row['differenceBounds']=[int(xx.min()),int(yy.min()),int(xx.max()),int(yy.max())]
    # Separate transparent layers may round edge alpha by a single byte.
    assert row['maxChannelDifference']<=2,(label,row)
   report['cases'].append({'viewport':label,'dpr':dpr,'differences':differences,'cacheReuseDuringAnimation':debug,'touchPinch':mobile,'overflow':False})
  b.close()
 assert not report['errors'],report['errors']
 assert hashes()==report['sourceSha256'],'Source changed during cache check'
 report['pass']=True
except Exception as error:
 report['pass']=False;report['failure']=repr(error);raise
finally:
 (OUT/'render-cache-browser.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps(report,ensure_ascii=False,indent=2))
