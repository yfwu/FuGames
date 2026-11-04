"""Actual Chromium keyboard/touch flows for the two original arena games.
Run against the repository server (default 127.0.0.1:8000, override with FUGAMES_BASE);
proof goes to /tmp/fugames-arena-checks.
"""
from pathlib import Path
import json
import os
from playwright.sync_api import sync_playwright

BASE = os.environ.get('FUGAMES_BASE', 'http://127.0.0.1:8000')
OUT = Path('/tmp/fugames-arena-checks')
OUT.mkdir(exist_ok=True)
results = []
GL = ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
PICK = "(gx)=>{for(let sx=0;sx<innerWidth;sx+=2){const p=TankApp.view.pick(sx,innerHeight*.5);if(p&&p.x>=gx)return sx;}return null;}"


def watch(page, errors):
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'favicon.ico' not in m.location.get('url', '') else None)


def tank_flow(browser):
    """鋼芯競技場: full-screen three.js diorama, turn-based. Desktop mouse/keyboard, then phone touch."""
    errors = []
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    watch(page, errors)
    page.goto(f'{BASE}/tank_arena.html')
    page.wait_for_timeout(600)
    assert page.locator('#overlay').is_visible() and page.evaluate('game.phase') == 'ready'
    page.locator('#play').click()
    assert page.evaluate('game.phase') == 'aim' and not page.locator('#overlay').is_visible()
    page.keyboard.press('ArrowUp')
    assert page.evaluate('game.angle') == 46
    page.keyboard.press('Shift+W')
    assert page.evaluate('game.power') == 70
    box = page.locator('#board').bounding_box()
    page.mouse.move(box['x'] + box['width'] * .62, box['y'] + box['height'] * .3)
    page.mouse.down()
    page.mouse.move(box['x'] + box['width'] * .7, box['y'] + box['height'] * .25, steps=4)
    page.mouse.up()
    assert page.evaluate('game.angle') != 46, 'drag aims the barrel'
    page.locator('#hand [data-card="0"]').click()
    assert page.evaluate('TankApp.placing') == 'wall'
    sx = page.evaluate(PICK, page.evaluate('game.actors[0].x') + 55)
    page.mouse.click(sx, box['y'] + box['height'] * .5)
    assert page.evaluate('game.buildings.length') == 1 and page.evaluate('game.cardUsed')
    page.locator('#fire').click()
    assert page.evaluate('game.phase') == 'flight'
    page.locator('#pause').click()
    before = page.evaluate('JSON.stringify(game)')
    page.wait_for_timeout(200)
    assert page.evaluate('JSON.stringify(game)') == before
    assert page.evaluate("document.getElementById('overlay').dataset.mode") == 'pause'
    page.locator('#resume').click()
    page.evaluate("window.dispatchEvent(new Event('blur'))")
    assert page.evaluate('game.phase') == 'paused'
    page.locator('#resume').click()
    page.wait_for_function("game.phase==='aim'||game.phase==='over'", timeout=40000)
    page.screenshot(path=str(OUT / 'tank_arena-desktop.png'))
    page.evaluate('game.actors.filter(a=>a.team===1).forEach(a=>a.hp=0);game.checkResult()')
    page.wait_for_function("document.getElementById('overlay').dataset.mode==='result'&&!document.getElementById('overlay').hidden", timeout=5000)
    assert page.evaluate('game.result.winner') == 0 and page.evaluate('TankCareer.load(localStorage).wins') == 1
    page.locator('#again').click()
    assert page.evaluate('game.phase') == 'aim' and page.evaluate('game.turn') == 0
    for width, height in [(390, 844), (320, 700), (844, 390), (1100, 1050)]:
        page.set_viewport_size({'width': width, 'height': height})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), ('tank_arena', width, 'overflow')
    assert not errors, errors
    page.close()
    mobile = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, device_scale_factor=1)
    page = mobile.new_page()
    watch(page, errors)
    page.goto(f'{BASE}/tank_arena.html')
    page.wait_for_timeout(600)
    page.locator('#play').tap()
    page.wait_for_timeout(400)
    page.locator('#hand [data-card="0"]').tap()
    sx = page.evaluate(PICK, page.evaluate('game.actors[0].x') + 55)
    box = page.locator('#board').bounding_box()
    page.touchscreen.tap(sx, box['y'] + box['height'] * .5)
    assert page.evaluate('game.buildings.length') == 1
    page.locator('#moveLeft').tap()
    page.locator('#fire').tap()
    assert page.evaluate('game.phase') == 'flight'
    page.screenshot(path=str(OUT / 'tank_arena-mobile.png'))
    page.locator('#pause').tap()
    assert page.evaluate('game.phase') == 'paused'
    page.locator('#resume').tap()
    assert page.evaluate('game.phase') == 'flight'
    assert not errors, errors
    results.append({'page': 'tank_arena', 'desktop_mouse_keyboard': 'pass', 'mobile_native_touch': 'pass', 'pause_resume_blur': 'pass', 'outcome_restart': 'pass', 'widths': [320, 390, 844, 1100, 1440], 'console_errors': errors})
    mobile.close()


def pulse_flow(browser):
    name = 'pulse_arena'
    errors = []
    page = browser.new_page(viewport={'width': 1100, 'height': 1050})
    watch(page, errors)
    page.goto(f'{BASE}/{name}.html')
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
    page.locator('#board').focus()
    page.keyboard.down('Space')
    page.wait_for_timeout(450)
    assert page.evaluate('game.actors[0].charging')
    page.keyboard.up('Space')
    page.wait_for_timeout(40)
    assert page.evaluate('game.actors[0].cooldown > 0')
    page.wait_for_timeout(1500)
    page.screenshot(path=str(OUT / f'{name}-desktop.png'), full_page=True)
    # Deterministic end-state UI and restart; core outcome boundaries have separate unit tests.
    page.evaluate('game.actors.slice(1).forEach(a=>a.alive=false);game.checkResult();hud()')
    assert page.locator('#overlay').is_visible()
    assert page.evaluate('game.result.outcome') == 'win'
    page.locator('#restart').click()
    assert page.evaluate('game.phase') == 'running'
    assert page.evaluate('game.tick') < 10
    for width, height in [(390, 844), (320, 700), (844, 390)]:
        page.set_viewport_size({'width': width, 'height': height})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), (name, width, 'overflow')
    assert not errors, errors
    page.close()
    mobile = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, device_scale_factor=1)
    page = mobile.new_page()
    watch(page, errors)
    page.goto(f'{BASE}/{name}.html')
    page.locator('#play').tap()
    page.locator('#board').scroll_into_view_if_needed()
    box = page.locator('#board').bounding_box()
    x = box['x'] + box['width'] * .35
    y = box['y'] + box['height'] * .55
    cdp = mobile.new_cdp_session(page)

    def touch(kind, points):
        cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': points})
    before = page.evaluate('({x:game.actors[0].x,y:game.actors[0].y})')
    touch('touchStart', [{'x': x, 'y': y, 'id': 1}])
    touch('touchMove', [{'x': x + 38, 'y': y, 'id': 1}])
    page.wait_for_timeout(220)
    assert page.evaluate('game.actors[0].x') > before['x']
    touch('touchEnd', [])
    assert page.evaluate('touch===null')
    page.locator('#pulse').scroll_into_view_if_needed()
    b = page.locator('#pulse').bounding_box()
    bx = b['x'] + b['width'] / 2
    by = b['y'] + b['height'] / 2
    # Real two-finger input: continue steering while charging the separate action button.
    board = page.locator('#board').bounding_box()
    tx = board['x'] + board['width'] * .45
    ty = board['y'] + board['height'] * .65
    touch('touchStart', [{'x': tx, 'y': ty, 'id': 1}])
    touch('touchStart', [{'x': tx, 'y': ty, 'id': 1}, {'x': bx, 'y': by, 'id': 2}])
    touch('touchMove', [{'x': tx - 25, 'y': ty, 'id': 1}, {'x': bx, 'y': by, 'id': 2}])
    page.wait_for_timeout(350)
    assert page.evaluate('game.actors[0].charging && touch !== null && buttonHeld')
    touch('touchEnd', [{'x': bx, 'y': by, 'id': 2}])
    page.wait_for_timeout(50)
    assert page.evaluate('game.actors[0].cooldown > 0 && touch !== null && !buttonHeld'), page.evaluate('({phase:game.phase,actor:game.actors[0],touch,buttonHeld,pulsePointer})')
    touch('touchEnd', [])
    page.screenshot(path=str(OUT / f'{name}-mobile.png'), full_page=True)
    page.locator('#pause').tap()
    assert page.evaluate('game.phase') == 'paused'
    page.locator('#play').tap()
    assert page.evaluate('game.phase') == 'running'
    assert not errors, errors
    results.append({'page': name, 'desktop_keyboard': 'pass', 'mobile_native_touch': 'pass', 'pause_resume_blur': 'pass', 'outcome_restart': 'pass', 'widths': [320, 390, 844, 1100], 'console_errors': errors})
    mobile.close()


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM', '/usr/bin/chromium'), args=GL)
    tank_flow(browser)
    pulse_flow(browser)
    browser.close()
(OUT / 'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
print(json.dumps(results, ensure_ascii=False, indent=2))
