"""New board games: actual keyboard/touch, pause, counters, terminal UI and full AI-assisted DOM play."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = os.environ.get('FUGAMES_BASE_URL', 'http://127.0.0.1:8000')
OUT = Path(os.environ.get('FUGAMES_BOARD_SCREENSHOTS', '/tmp/fugames-board-review'))
OUT.mkdir(parents=True, exist_ok=True)


def press(page, selector, mobile=False):
    button = page.locator(selector)
    button.tap() if mobile else button.click()


def fit(page):
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), page.url


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
    errors, failed = [], []
    for width, height, label in [(1366, 900, 'desktop'), (390, 844, 'mobile'), (320, 568, 'narrow'), (844, 390, 'landscape')]:
        mobile = label != 'desktop'
        context = browser.new_context(viewport={'width': width, 'height': height}, is_mobile=mobile, has_touch=mobile)
        context.add_init_script('let seed=91; Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);')
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('requestfailed', lambda request: failed.append(request.url))
        page.clock.install()
        for name, state, cell in [('card_hex', 'hexGame', '.hex-cell'), ('flip_five', 'flipGame', '.flip-cell')]:
            page.goto(BASE + '/' + name + '.html')
            assert page.evaluate(state + '.phase') == 'ready'
            assert not page.locator('details').evaluate('e=>e.open')
            fit(page)
            press(page, '#play', mobile)
            if mobile:
                press(page, '[data-cell="24"]', True)
            else:
                page.locator('[data-cell="24"]').focus()
                page.keyboard.press('ArrowRight')
                assert page.evaluate('document.activeElement.dataset.cell') == '25'
                page.keyboard.press('Enter')
            assert page.evaluate(state + '.ply') == 1
            press(page, '#pause', mobile)
            assert page.evaluate(state + '.phase') == 'paused'
            frozen = page.evaluate('JSON.stringify(' + state + ')')
            page.clock.run_for(3000)
            assert page.evaluate('JSON.stringify(' + state + ')') == frozen
            press(page, '#pause', mobile)
            page.clock.run_for(1500)
            assert page.evaluate(state + '.ply') == 2
            page.screenshot(path=str(OUT / (name + '-playing-' + label + '.png')), full_page=True)
            page.evaluate("window.dispatchEvent(new Event('blur'))")
            assert page.evaluate(state + '.phase') == 'paused'
            page.clock.run_for(1500)
            assert page.evaluate(state + '.phase') == 'paused'
            press(page, '#pause', mobile)
            page.evaluate("Object.defineProperty(document, 'hidden', {configurable:true, get:()=>true});document.dispatchEvent(new Event('visibilitychange'))")
            assert page.evaluate(state + '.phase') == 'paused'
            page.evaluate("Object.defineProperty(document, 'hidden', {configurable:true, get:()=>false});document.dispatchEvent(new Event('visibilitychange'))")
            page.clock.run_for(1500)
            assert page.evaluate(state + '.phase') == 'paused'
            press(page, '#restart', mobile)
            assert page.evaluate(state + '.first') == 2
            assert page.evaluate(state + '.ply') == 0
            page.clock.run_for(1500)
            assert page.evaluate(state + '.ply') == 1
            assert page.evaluate(state + '.turn') == 1
            page.locator('summary').click()
            fit(page)
        context.close()

    context = browser.new_context(viewport={'width': 1366, 'height': 900})
    page = context.new_page()
    page.clock.install()
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(BASE + '/card_hex.html');page.locator('#play').click()
    page.locator('#double').click();page.locator('[data-cell="24"]').click()
    assert page.locator('.hex-cell.selected').count() == 1
    page.locator('[data-cell="25"]').click()
    assert page.evaluate('hexGame.board[24]===1 && hexGame.board[25]===1 && hexGame.ply===1')
    page.locator('#pause').click();page.clock.run_for(1500)
    page.evaluate("""() => {
      hexGame.reset(); hexGame.start(); hexGame.turn=2;
      hexGame.board[24]=1; hexGame.hands[1]=['shield']; hexGame.hands[2]=['remove'];
      hexGame.act({type:'remove',cells:[24]}); hexRender();
    }""")
    assert page.locator('#response').is_visible()
    page.screenshot(path=str(OUT / 'card_hex-counter.png'), full_page=True)
    page.locator('#counter').click()
    assert page.evaluate('hexGame.board[24]===1 && hexGame.ply===1 && hexGame.turn===1')
    page.evaluate("""() => {
      hexGame.reset();hexGame.start();hexGame.turn=2;
      hexGame.board[24]=1;hexGame.hands[1]=[];hexGame.hands[2]=['remove'];
      hexGame.act({type:'remove',cells:[24]});hexRender();
    }""")
    assert page.locator('#counter').is_disabled()
    page.locator('#accept').click()
    assert page.evaluate('hexGame.board[24]===0 && hexGame.ply===1')

    # Drive the human side via real DOM and let scheduled AI callbacks play every reply.
    for name, state, engine, render in [('card_hex', 'hexGame', 'CardHex', 'hexRender'), ('flip_five', 'flipGame', 'FlipFive', 'flipRender')]:
        page.goto(BASE + '/' + name + '.html');page.locator('#play').click()
        for _ in range(100):
            status = page.evaluate('({phase:' + state + '.phase,turn:' + state + '.turn,pending:' + state + '.pending})')
            if status['phase'] == 'over':
                break
            if status.get('pending'):
                if status['pending']['defender'] == 1:
                    page.locator('#counter' if page.locator('#counter').is_enabled() else '#accept').click()
                else:
                    page.clock.run_for(1000)
            elif status['turn'] == 2:
                page.clock.run_for(1000)
            elif name == 'card_hex':
                action = page.evaluate('CardHex.chooseAction(hexGame.observation(1))')
                page.locator({'place': '#normal', 'double': '#double', 'remove': '#remove'}[action['type']]).click()
                for cell in action['cells']:
                    page.locator(f'[data-cell="{cell}"]').click()
            else:
                action = page.evaluate('FlipFive.chooseMove(flipGame.observation(1))')
                page.locator(f'[data-cell="{action["cell"]}"]').click()
        assert page.evaluate(state + '.phase') == 'over', name
        assert page.locator('#result').is_visible()
        assert page.locator('#pause').is_disabled()
        page.screenshot(path=str(OUT / (name + '-complete-desktop.png')), full_page=True)
        result = page.evaluate('JSON.stringify(' + state + '.result)')
        page.clock.run_for(4000)
        assert page.evaluate('JSON.stringify(' + state + '.result)') == result
        page.locator('#play').click()
        assert page.evaluate(state + '.ply') == 0

    # A capture-induced win reaches the visible final result in the real UI.
    page.goto(BASE + '/flip_five.html');page.locator('#play').click()
    page.evaluate('flipGame.board[37]=flipGame.board[38]=flipGame.board[39]=2;flipGame.board[40]=1;flipRender();')
    page.locator('[data-cell="36"]').click()
    assert page.evaluate('flipGame.result.winner') == 1
    assert page.locator('.flip-cell.flipped').count() == 3
    assert page.locator('.flip-cell.winning').count() == 5
    page.screenshot(path=str(OUT / 'flip_five-capture-win.png'), full_page=True)
    context.close()
    assert not errors, errors
    assert not failed, failed
    browser.close()
    print('Board browser checks passed: four viewports, keyboard/touch, pause/resume, restart, shield/accept, two full DOM matches, capture win, no console errors.')
