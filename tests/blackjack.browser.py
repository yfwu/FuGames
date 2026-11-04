"""Run against the existing FuGames dev server: python tests/blackjack.browser.py [port]."""
from pathlib import Path
import json
import sys
from playwright.sync_api import sync_playwright

PORT = sys.argv[1] if len(sys.argv) > 1 else '8000'
OUT = Path('/tmp/fugames-blackjack')
OUT.mkdir(exist_ok=True)
INIT = """let bjSeed = 5; Math.random = () => ((bjSeed = (Math.imul(bjSeed,1664525)+1013904223) >>> 0) / 4294967296);"""
GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']


def open_game(context, errors):
    page = context.new_page()
    page.add_init_script(INIT)
    page.on('pageerror', lambda err: errors.append(str(err)))
    page.on('console', lambda msg: errors.append(msg.text) if msg.type == 'error' and not msg.location.get('url', '').endswith('/favicon.ico') else None)
    page.goto(f'http://127.0.0.1:{PORT}/blackjack.html')
    assert page.locator('#curtain').is_visible()
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.locator('#play').click()
    assert page.locator('#curtain').is_hidden()
    return page


def finish_round(page):
    for _ in range(80):
        phase = page.evaluate('BlackjackApp.game.phase')
        if phase == 'insurance':
            page.keyboard.press('n')
        elif phase == 'player':
            page.keyboard.press('s')
        elif phase in ('result', 'ready'):
            return
        page.wait_for_timeout(250)
    raise AssertionError('round did not finish')


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=GL)
    errors = []
    desktop = browser.new_context(viewport={'width': 1440, 'height': 900})
    page = open_game(desktop, errors)
    page.locator('#deal').click()
    assert page.evaluate('BlackjackApp.game.round') == 1
    page.evaluate("document.querySelector('#deal').click(); document.querySelector('#deal').click()")
    assert page.evaluate('BlackjackApp.game.round') == 1
    if page.evaluate("BlackjackApp.game.phase") == 'player':
        assert page.evaluate('BlackjackApp.game.revealed') is False
        page.keyboard.press('p')
        assert page.locator('#curtain').get_attribute('data-mode') == 'pause'
        paused = page.locator('#labels').inner_text()
        page.wait_for_timeout(800)
        assert page.locator('#labels').inner_text() == paused
        page.locator('#resume').click()
        count = page.evaluate('BlackjackApp.game.seats[0].cards.length')
        page.keyboard.press('h')
        assert page.evaluate('BlackjackApp.game.seats[0].cards.length') == count + 1
    finish_round(page)
    page.wait_for_timeout(900)
    page.screenshot(path=str(OUT / 'blackjack-desktop.png'))
    assert page.evaluate('BlackjackApp.game.revealed') is True
    names = page.evaluate('BlackjackApp.game.seats.map(s => s.name)')
    page.locator('#menu-btn').click()
    page.locator('#tab-settings').click()
    page.locator('#restart').click()
    assert page.locator('#balance').inner_text() == '100'
    assert page.evaluate('BlackjackApp.game.seats.map(s => s.name)') == names
    page.evaluate("window.dispatchEvent(new Event('blur'))")
    page.close()

    mobile = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, device_scale_factor=2)
    phone = open_game(mobile, errors)
    phone.locator('#deal').tap()
    phone.wait_for_timeout(900)
    phone.screenshot(path=str(OUT / 'blackjack-mobile.png'))
    assert phone.evaluate('document.documentElement.scrollWidth <= innerWidth')
    if phone.evaluate('BlackjackApp.game.phase') == 'player':
        phone.locator('#stand').tap()
    phone.evaluate("Object.defineProperty(document,'hidden',{value:true,configurable:true}); document.dispatchEvent(new Event('visibilitychange'))")
    if phone.evaluate('BlackjackApp.game.active()'):
        assert phone.locator('#curtain').get_attribute('data-mode') == 'pause'
        phone.locator('#resume').tap()
    finish_round(phone)
    phone.locator('#menu-btn').tap()
    phone.locator('#leave-drawer').tap()
    assert phone.locator('#curtain').get_attribute('data-mode') == 'result'
    assert not errors, errors
    print(json.dumps({'desktop': '1440x900', 'mobile': '390x844 touch', 'screenshots': [str(x) for x in OUT.glob('*.png')], 'errors': errors}, ensure_ascii=False))
    browser.close()
