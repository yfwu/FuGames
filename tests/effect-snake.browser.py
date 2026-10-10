"""Run against python -m http.server 8000; screenshots are written outside the repo."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

OUT = Path('/tmp/fugames-effect-snake')
OUT.mkdir(exist_ok=True)
errors = []

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1280, 'height': 980}, device_scale_factor=1)
    page.route('**/favicon.ico', lambda route: route.fulfill(status=204))
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda msg: errors.append(msg.text) if msg.type == 'error' else None)
    page.goto('http://127.0.0.1:8000/effect_snake.html')
    page.locator('#play').click()
    page.keyboard.press('ArrowDown')
    page.wait_for_function('game.actors[0].dir === 2')
    page.keyboard.press('a')
    page.wait_for_function('game.actors[0].dir === 3')
    page.keyboard.press('p')
    assert page.evaluate('game.phase') == 'paused'
    frozen = page.evaluate('game.tick')
    page.wait_for_timeout(220)
    assert page.evaluate('game.tick') == frozen
    page.locator('#play').click()
    assert page.evaluate('game.phase') == 'running'
    page.evaluate('window.dispatchEvent(new Event("blur"))')
    assert page.evaluate('game.phase') == 'paused'
    page.evaluate('window.dispatchEvent(new Event("focus"))')
    assert page.evaluate('game.phase') == 'paused', 'focus must not resume automatically'
    page.locator('#restart').click()
    page.wait_for_timeout(900)
    page.screenshot(path=str(OUT / 'desktop-active.png'), full_page=True)
    page.evaluate('game.actors[0].body=[{x:27,y:4},{x:26,y:4},{x:25,y:4},{x:24,y:4}]; game.actors[0].dir=game.actors[0].nextDir=1; game.actors[0].shield=0')
    page.wait_for_function('game.phase === "over"')
    assert page.locator('#overlay').is_visible()
    assert '本局' in page.locator('#dialog-copy').inner_text()
    page.screenshot(path=str(OUT / 'desktop-result.png'), full_page=True)
    page.locator('#play').click()
    assert page.evaluate('game.phase') == 'running'
    assert page.evaluate('game.actors[0].score') == 0
    assert page.evaluate('game.actors[0].body.length') == 4
    page.close()

    context = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    mobile = context.new_page()
    mobile.route('**/favicon.ico', lambda route: route.fulfill(status=204))
    mobile.on('pageerror', lambda error: errors.append(str(error)))
    mobile.on('console', lambda msg: errors.append(msg.text) if msg.type == 'error' else None)
    mobile.goto('http://127.0.0.1:8000/effect_snake.html')
    assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth')
    mobile.screenshot(path=str(OUT / 'mobile-ready.png'), full_page=True)
    mobile.locator('#play').tap()
    board = mobile.locator('#board').bounding_box()
    x, y = board['x'] + board['width']/2, board['y'] + board['height']/2
    cdp = context.new_cdp_session(mobile)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]})
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x, 'y': y+50}]})
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    mobile.wait_for_function('game.actors[0].dir === 2')
    mobile.locator('[data-direction=left]').tap()
    mobile.wait_for_function('game.actors[0].dir === 3')
    mobile.screenshot(path=str(OUT / 'mobile-active.png'), full_page=True)
    mobile.locator('#pause').tap()
    assert mobile.evaluate('game.phase') == 'paused'
    mobile.locator('#play').tap()
    assert mobile.evaluate('game.phase') == 'running'
    mobile.set_viewport_size({'width': 320, 'height': 700})
    assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth')
    mobile.set_viewport_size({'width': 844, 'height': 390})
    assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth')
    browser.close()

assert not errors, errors
print(json.dumps({'result': 'passed', 'console_errors': errors, 'screenshots': str(OUT), 'checks': ['keyboard arrows + WASD', 'real CDP touch swipe', 'touch buttons', 'pause/resume', 'blur manual resume', 'game over/restart', '320/390/844 widths']}, ensure_ascii=False))
