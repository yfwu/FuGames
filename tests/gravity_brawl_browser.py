"""Gravity Brawl interaction regression. Start a local server on port 8000 first."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = os.environ.get('FUGAMES_BASE_URL', 'http://127.0.0.1:8000')
OUT = Path(os.environ.get('FUGAMES_SCREENSHOTS', '/tmp/fugames-gravity-brawl'))
OUT.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
    errors = []
    for width, height, label in [(1366, 900, 'desktop'), (390, 844, 'mobile'), (320, 568, 'narrow')]:
        context = browser.new_context(viewport={'width': width, 'height': height}, has_touch=label != 'desktop', is_mobile=label != 'desktop')
        context.add_init_script('let seed=83;Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);')
        page = context.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and '404' not in m.text else None)
        page.clock.install()
        page.goto(BASE + '/gravity_brawl.html')
        assert page.evaluate('game.phase') == 'ready'
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.screenshot(path=str(OUT / f'gravity-ready-{label}.png'), full_page=True)
        page.locator('#play').click()
        assert page.evaluate('game.phase') == 'running'
        page.evaluate("game.piece='T';game.selectDefault();refresh();")
        old = page.evaluate('game.selection.x')
        page.locator('#board').focus()
        page.keyboard.press('ArrowLeft')
        assert page.evaluate('game.selection.x') == old - 1
        page.keyboard.press('ArrowRight')
        assert page.evaluate('game.selection.x') == old
        page.keyboard.press('ArrowUp')
        assert page.evaluate('game.selection.rotation') == 1
        if label != 'desktop':
            page.locator('#left').tap()
            assert page.evaluate('game.selection.x') == old - 1
            page.locator('#right').tap()
            page.locator('#rotate').tap()
            assert page.evaluate('game.selection.rotation') == 2
            page.locator('#board').tap(position={'x': 35, 'y': 50})
            assert page.evaluate('game.selection.x') <= 1
        page.locator('#drop').click()
        assert page.evaluate('game.wave') == 2
        page.locator('#drop').dispatch_event('click')
        assert page.evaluate('game.wave') == 2, 'rapid double events may not drop a second wave'
        page.clock.run_for(300)
        page.locator('#pause').click()
        before = page.evaluate('JSON.stringify(game)')
        page.clock.run_for(20000)
        assert page.evaluate('JSON.stringify(game)') == before
        page.locator('#pause').click()
        page.clock.run_for(1000)
        assert page.evaluate('game.remaining') < 6.1
        page.evaluate("window.dispatchEvent(new Event('blur'))")
        assert page.evaluate('game.phase') == 'paused'
        page.clock.run_for(10000)
        assert page.evaluate('game.phase') == 'paused'
        page.locator('#play').click()
        page.evaluate("Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;")
        assert page.evaluate('game.phase') == 'paused'
        page.locator('#play').click()
        page.clock.run_for(250)
        # Exercise actual drop events through all four gravity directions to a natural bounded result.
        saw = {0}
        while page.evaluate("game.phase === 'running'"):
            page.evaluate('game.selection=GravityBrawl.chooseAI(game.actors[0].board,game.piece,0,game.untilTurn(),game.actors[0].pending);refresh();')
            page.locator('#drop').click()
            page.clock.run_for(250)
            saw.add(page.evaluate('game.gravity'))
            if page.evaluate('game.wave') == 7:
                page.screenshot(path=str(OUT / f'gravity-playing-{label}.png'), full_page=True)
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                if width == 390:
                    board = page.locator('#board').bounding_box()
                    controls = page.locator('.brawl-controls').bounding_box()
                    assert controls['y'] - board['y'] + controls['height'] < 500, 'touch controls must stay beside board'
        assert saw == {0, 1, 2, 3}
        assert page.evaluate('game.result.outcome') in ['win', 'loss', 'draw']
        assert page.locator('#drop').is_disabled()
        page.screenshot(path=str(OUT / f'gravity-result-{label}.png'), full_page=True)
        page.locator('#play').click()
        assert page.evaluate('game.wave') == 1
        assert page.evaluate('game.phase') == 'running'
        # UI end-state fixtures for impossible entry and all-out draw.
        page.evaluate('game.actors.forEach(a=>a.board[0].fill(8));game.selectDefault();refresh();')
        page.locator('#drop').click()
        assert page.evaluate('game.result.outcome') == 'draw'
        assert '平手' in page.locator('#dialog-title').inner_text()
        page.locator('#restart').click()
        assert page.evaluate('game.phase') == 'ready'
        assert page.evaluate('game.gravity') == 0
        assert page.locator('#drop').is_disabled()
        context.close()
    browser.close()
    assert not errors, errors
    print('PASS: desktop/mobile/narrow inputs, full match, four gravities, pause/blur/visibility, rapid click, draw, restart; no JS console errors')
    print('Screenshots:', OUT)
