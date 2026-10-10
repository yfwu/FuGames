"""Actual Chromium keyboard/touch flows for the two original arena games.
Run against the repository server at 127.0.0.1:8000; proof goes to /tmp/fugames-arena-checks.
"""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright

OUT = Path('/tmp/fugames-arena-checks')
OUT.mkdir(exist_ok=True)
results = []
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    for name in ['tank_arena', 'pulse_arena']:
        errors = []
        page = browser.new_page(viewport={'width':1100,'height':1050})
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'favicon.ico' not in m.location.get('url','') else None)
        page.goto(f'http://127.0.0.1:8000/{name}.html')
        page.locator('#play').click()
        assert page.evaluate('game.phase') == 'running'
        page.keyboard.press('ArrowRight', delay=250)
        assert page.evaluate('game.tick') > 0
        page.locator('#pause').click()
        before = page.evaluate('JSON.stringify(game)')
        page.wait_for_timeout(160)
        assert page.evaluate('JSON.stringify(game)') == before
        page.locator('#play').click()
        page.evaluate("window.dispatchEvent(new Event('blur'))")
        assert page.evaluate('game.phase') == 'paused'
        page.wait_for_timeout(100)
        assert page.evaluate('game.phase') == 'paused'
        page.locator('#play').click()
        if name == 'tank_arena':
            page.evaluate('game.actors[0].xp=6;hud()')
            page.locator('#upgrade-fire').click()
            page.locator('#upgrade-armor').click()
            assert page.evaluate('game.actors[0].upgrades.fire') == 1
            assert page.evaluate('game.maxHP(game.actors[0])') == 7
            box=page.locator('#board').bounding_box()
            page.mouse.move(box['x']+box['width']*.7,box['y']+box['height']*.5)
            assert page.evaluate('pointerAim !== null')
        else:
            page.locator('#board').focus()
            page.keyboard.down('Space')
            page.wait_for_timeout(450)
            assert page.evaluate('game.actors[0].charging')
            page.keyboard.up('Space')
            page.wait_for_timeout(40)
            assert page.evaluate('game.actors[0].cooldown > 0')
        page.wait_for_timeout(1500)
        page.screenshot(path=str(OUT/f'{name}-desktop.png'),full_page=True)
        # Deterministic end-state UI and restart; core outcome boundaries have separate unit tests.
        if name=='tank_arena':
            page.evaluate('game.actors[0].score=30;game.finish();hud()')
        else:
            page.evaluate('game.actors.slice(1).forEach(a=>a.alive=false);game.checkResult();hud()')
        assert page.locator('#overlay').is_visible()
        assert page.evaluate('game.result.outcome') == 'win'
        page.locator('#restart').click()
        assert page.evaluate('game.phase') == 'running'
        assert page.evaluate('game.tick') < 10
        for width,height in [(390,844),(320,700),(844,390)]:
            page.set_viewport_size({'width':width,'height':height})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), (name,width,'overflow')
        assert not errors, errors
        page.close()
        mobile=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,device_scale_factor=1)
        page=mobile.new_page()
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.on('console',lambda m:errors.append(m.text) if m.type == 'error' and 'favicon.ico' not in m.location.get('url','') else None)
        page.goto(f'http://127.0.0.1:8000/{name}.html')
        page.locator('#play').tap()
        page.locator('#board').scroll_into_view_if_needed()
        box=page.locator('#board').bounding_box()
        x=box['x']+box['width']*.35
        y=box['y']+box['height']*.55
        cdp=mobile.new_cdp_session(page)
        def touch(kind,points):
            cdp.send('Input.dispatchTouchEvent',{'type':kind,'touchPoints':points})
        before=page.evaluate('({x:game.actors[0].x,y:game.actors[0].y})')
        touch('touchStart',[{'x':x,'y':y,'id':1}])
        touch('touchMove',[{'x':x+38,'y':y,'id':1}])
        page.wait_for_timeout(220)
        assert page.evaluate('game.actors[0].x') > before['x']
        touch('touchEnd',[])
        assert page.evaluate('touch===null')
        if name=='pulse_arena':
            page.locator('#pulse').scroll_into_view_if_needed()
            b=page.locator('#pulse').bounding_box()
            bx=b['x']+b['width']/2;by=b['y']+b['height']/2
            # Real two-finger input: continue steering while charging the separate action button.
            board=page.locator('#board').bounding_box()
            tx=board['x']+board['width']*.45;ty=board['y']+board['height']*.65
            touch('touchStart',[{'x':tx,'y':ty,'id':1}])
            touch('touchStart',[{'x':tx,'y':ty,'id':1},{'x':bx,'y':by,'id':2}])
            touch('touchMove',[{'x':tx-25,'y':ty,'id':1},{'x':bx,'y':by,'id':2}])
            page.wait_for_timeout(350)
            assert page.evaluate('game.actors[0].charging && touch !== null && buttonHeld')
            touch('touchEnd',[{'x':bx,'y':by,'id':2}])
            page.wait_for_timeout(50)
            assert page.evaluate('game.actors[0].cooldown > 0 && touch !== null && !buttonHeld'), page.evaluate('({phase:game.phase,actor:game.actors[0],touch,buttonHeld,pulsePointer})')
            touch('touchEnd',[])
        page.screenshot(path=str(OUT/f'{name}-mobile.png'),full_page=True)
        page.locator('#pause').tap()
        assert page.evaluate('game.phase') == 'paused'
        page.locator('#play').tap()
        assert page.evaluate('game.phase') == 'running'
        assert not errors,errors
        results.append({'page':name,'desktop_keyboard':'pass','mobile_native_touch':'pass','pause_resume_blur':'pass','outcome_restart':'pass','widths':[320,390,844,1100],'console_errors':errors})
        mobile.close()
    browser.close()
(OUT/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print(json.dumps(results,ensure_ascii=False,indent=2))
