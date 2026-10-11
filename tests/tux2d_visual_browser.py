"""Independent Tux layout, multi-touch and lifecycle checks in Chromium.

Uses the shipped UI controls and controlled browser time, never race-state edits.
The separate tux2d_browser.py records an actual wall-clock complete race.
"""
from pathlib import Path
from datetime import datetime, timezone
import hashlib, json, os
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/tux2d-2026-10-11'
BASE = os.environ.get('FUGAMES_BASE_URL', 'http://127.0.0.1:8011')
OUT.mkdir(exist_ok=True)
SOURCES = ['tux2d-engine.js', 'tux2d-ui.js', 'tux2d.html', 'tux2d.css']
report = {'mode': 'Chromium device emulation, controlled browser clock, actual DOM/keyboard/touch input',
          'sourceSha256': {f: hashlib.sha256((ROOT/f).read_bytes()).hexdigest() for f in SOURCES},
          'viewports': []}


def bounds(page, selector):
    return page.locator(selector).evaluate('e=>{let b=e.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height,bottom:b.bottom,right:b.right}}')


with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    for label, w, h, dpr, mobile in [('desktop',1440,1100,1,False), ('mobile',390,844,3,True),
                                    ('narrow',320,740,2,True), ('landscape',844,390,2,True)]:
        ctx = browser.new_context(viewport={'width':w,'height':h}, device_scale_factor=dpr,
                                  is_mobile=mobile, has_touch=mobile)
        page = ctx.new_page(); errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.clock.install(time=datetime(2026,10,11,15,0,tzinfo=timezone.utc))
        page.clock.pause_at(datetime(2026,10,11,15,1,tzinfo=timezone.utc))
        page.goto(BASE+'/tux2d.html'); page.wait_for_load_state('networkidle')
        assert page.evaluate('typeof tux2dGame') == 'object'
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        assert page.locator('details.rules').evaluate('e=>!e.open')
        page.screenshot(path=str(OUT/f'ready-{label}.png'), full_page=True)
        page.locator('#tux-seed').fill('visual-touch-'+label)
        page.locator('#tux-play').click(); page.clock.run_for(3250)
        assert page.evaluate('tux2dGame.phase') == 'racing'
        page.locator('.tux-arena').evaluate('e=>e.scrollIntoView({block:"start"})')
        touch_record = None
        if mobile:
            targets = {key: bounds(page, '#touch-'+key) for key in ['left','right','drift','brake','throttle','item']}
            stage = bounds(page, '.tux-stage')
            assert all(v['width'] >= 44 and v['height'] >= 44 for v in targets.values()), targets
            assert stage['y'] >= 0 and stage['bottom'] <= h, stage
            assert all(v['y'] >= 0 and v['bottom'] <= h for v in targets.values()), (label,targets,h)
            session = ctx.new_cdp_session(page)
            def touches(names):
                return [{'x':targets[n]['x']+targets[n]['width']/2,'y':targets[n]['y']+targets[n]['height']/2,
                         'id':i+1,'radiusX':3,'radiusY':3} for i,n in enumerate(names)]
            page.clock.run_for(1100)
            angle = page.evaluate('tux2dGame.racers[0].angle')
            session.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':touches(['right','drift'])})
            assert page.locator('#touch-right').evaluate('e=>e.classList.contains("pressed")')
            assert page.locator('#touch-drift').evaluate('e=>e.classList.contains("pressed")')
            page.clock.run_for(700)
            charged = page.evaluate('({angle:tux2dGame.racers[0].angle,charge:tux2dGame.racers[0].driftCharge,drifts:tux2dGame.telemetry.drifts})')
            assert abs(charged['angle']-angle)>.1
            session.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
            page.clock.run_for(40)
            assert page.locator('.tux-touch .pressed').count()==0
            touch_record = {'bounds':targets,'stage':stage,'simultaneousSteerAndDrift':True,
                            'releasedTogether':True,'charged':charged}
        else:
            page.keyboard.down('ArrowRight'); page.clock.run_for(350); page.keyboard.up('ArrowRight')
        page.locator('#tux-pause').click()
        frozen = page.evaluate('JSON.stringify(tux2dGame.observation(0))')
        page.clock.run_for(2200)
        assert page.evaluate('JSON.stringify(tux2dGame.observation(0))')==frozen
        page.locator('.tux-arena').evaluate('e=>e.scrollIntoView({block:"start"})')
        page.screenshot(path=str(OUT/f'racing-{label}.png'))
        page.locator('#camera-mode').click()
        page.screenshot(path=str(OUT/f'overview-{label}.png'))
        page.locator('#camera-mode').click()
        page.locator('#tux-restart').click()
        reset = page.evaluate('({phase:tux2dGame.phase,ticks:tux2dGame.ticks,elapsed:tux2dGame.elapsed,events:tux2dGame.events.length,hazards:tux2dGame.hazards.length,projectiles:tux2dGame.projectiles.length,laps:tux2dGame.racers.map(r=>r.lap)})')
        assert reset['phase']=='ready' and reset['elapsed']==0 and reset['ticks']==0, reset
        assert reset['hazards']==reset['projectiles']==0 and reset['laps']==[0]*5
        page.clock.run_for(1500); assert page.evaluate('tux2dGame.ticks')==0
        page.locator('#tux-mode').select_option('spectator')
        page.locator('#tux-play').click(); page.clock.run_for(3500)
        before = page.evaluate('tux2dGame.ticks'); page.clock.run_for(1000)
        after = page.evaluate('tux2dGame.ticks')
        assert 58 <= after-before <= 62, (label,before,after)
        tick_delta = after-before
        page.evaluate('''() => {Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'}); Object.defineProperty(document,'hidden',{configurable:true,value:true}); document.dispatchEvent(new Event('visibilitychange'));}''')
        assert page.evaluate('tux2dGame.phase')=='paused'
        before = page.evaluate('tux2dGame.ticks'); page.clock.run_for(1300)
        assert page.evaluate('tux2dGame.ticks')==before
        page.evaluate('''() => {Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'}); Object.defineProperty(document,'hidden',{configurable:true,value:false}); document.dispatchEvent(new Event('visibilitychange'));}''')
        page.clock.run_for(200); assert page.evaluate('tux2dGame.phase')=='paused'
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        assert not errors, errors
        report['viewports'].append({'label':label,'viewport':[w,h],'dpr':dpr,'overflow':False,
                                   'multiTouch':touch_record,'pauseFrozen':True,'restartClear':reset,
                                   'ticksInOneSecondAfterRestart':tick_delta,
                                   'syntheticVisibilityPause':True,'errors':errors})
        ctx.close()
    browser.close()
report['sourceUnchanged']=all(hashlib.sha256((ROOT/f).read_bytes()).hexdigest()==report['sourceSha256'][f] for f in SOURCES)
assert report['sourceUnchanged']
(OUT/'visual-browser.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'viewports':len(report['viewports']),'sourceUnchanged':report['sourceUnchanged'],'output':str(OUT)}))
