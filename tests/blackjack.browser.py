"""Run against the existing FuGames dev server: python tests/blackjack.browser.py."""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright

OUT = Path('/tmp/fugames-blackjack')
OUT.mkdir(exist_ok=True)
INIT = """let bjSeed = 5; Math.random = () => ((bjSeed = (Math.imul(bjSeed,1664525)+1013904223) >>> 0) / 4294967296);"""

def open_game(context, errors):
    page = context.new_page()
    page.add_init_script(INIT)
    page.on('pageerror', lambda err: errors.append(str(err)))
    page.on('console', lambda msg: errors.append(msg.text) if msg.type == 'error' and not msg.location.get('url','').endswith('/favicon.ico') else None)
    page.goto('http://127.0.0.1:8000/blackjack.html')
    assert page.locator('#ai-seats .bj-seat').count() == 3
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    return page

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    errors = []
    desktop = browser.new_context(viewport={'width':1280, 'height':1080})
    page = open_game(desktop, errors)
    page.locator('#deal').click()
    assert page.locator('#phase-label').inner_text() == '輪到你'
    assert page.locator('#dealer-cards .back').count() == 1
    page.evaluate("document.querySelector('#deal').click(); document.querySelector('#deal').click()")
    assert page.locator('#round-number').inner_text() == '1'
    page.screenshot(path=str(OUT/'blackjack-desktop.png'),full_page=True)
    # Letter shortcuts work with a clicked BUTTON still focused.
    page.keyboard.press('p')
    assert page.locator('#pause-overlay').is_visible()
    paused = page.locator('#ai-seats').inner_text()
    page.wait_for_timeout(800)
    assert page.locator('#ai-seats').inner_text() == paused
    page.locator('#resume').click()
    count = page.locator('#player-cards .bj-card').count()
    page.keyboard.press('h')
    assert page.locator('#player-cards .bj-card').count() == count + 1
    if page.locator('#phase-label').inner_text() == '輪到你':
        page.keyboard.press('s')
    page.wait_for_function("document.querySelector('#phase-label').textContent === '本局結算'",timeout=20000)
    assert page.locator('#dealer-cards .back').count() == 0
    page.screenshot(path=str(OUT/'blackjack-result.png'),full_page=True)
    old_names = page.locator('#ai-seats h3').all_inner_texts()
    page.locator('#restart').click()
    assert page.locator('#balance').inner_text() == '100'
    assert page.locator('#round-number').inner_text() == '0'
    assert page.locator('#ai-seats h3').all_inner_texts() == old_names
    page.close()

    page = open_game(desktop, errors)
    page.locator('#deal').click()
    page.keyboard.press('d')
    assert page.locator('#player-cards .bj-card').count() == 3
    assert page.locator('#player-bet').inner_text() == '本局下注 20'
    assert page.locator('#double').is_disabled()
    page.evaluate("document.querySelector('#double').click(); document.querySelector('#double').click()")
    assert page.locator('#player-bet').inner_text() == '本局下注 20'
    page.evaluate("window.dispatchEvent(new Event('blur'))")
    assert page.locator('#pause-overlay').is_visible()
    page.wait_for_timeout(800)
    assert page.locator('#phase-label').inner_text() == '已暫停'
    page.locator('#resume').click()
    page.evaluate("Object.defineProperty(document,'hidden',{value:true,configurable:true}); document.dispatchEvent(new Event('visibilitychange'))")
    assert page.locator('#pause-overlay').is_visible()
    page.evaluate("Object.defineProperty(document,'hidden',{value:false,configurable:true}); document.dispatchEvent(new Event('visibilitychange'))")
    assert page.locator('#pause-overlay').is_visible()
    page.locator('#resume').click()
    page.wait_for_function("document.querySelector('#phase-label').textContent === '本局結算'",timeout=20000)
    page.close()

    mobile = browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,device_scale_factor=2)
    phone = open_game(mobile, errors)
    phone.locator('#deal').tap()
    phone.screenshot(path=str(OUT/'blackjack-mobile.png'),full_page=True)
    assert phone.evaluate('document.documentElement.scrollWidth <= innerWidth')
    phone.locator('#stand').tap()
    phone.locator('#pause').tap()
    assert phone.locator('#pause-overlay').is_visible()
    phone.locator('#resume').tap()
    phone.wait_for_function("document.querySelector('#phase-label').textContent === '本局結算'",timeout=20000)
    phone.locator('#restart').tap()
    assert phone.locator('#balance').inner_text() == '100'
    assert not errors, errors
    print(json.dumps({'desktop':'1280x1080','mobile':'390x844 touch','screenshots':[str(x) for x in OUT.glob('*.png')],'errors':errors,'checks':'start; complete round; hidden dealer; double; rapid clicks; H/S/D/P while buttons focused; touch; pause; blur; visibility/manual resume; free reset; no viewport overflow'},ensure_ascii=False))
    browser.close()
