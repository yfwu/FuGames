"""Chromium validation for the eight-game expansion; serve repository on port 8000.

Uses the actual shipped pages, input events and engine state. Screenshots are
written outside the repository; see docs/expansion-validation.md for evidence.
"""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = os.environ.get('FUGAMES_BASE_URL', 'http://127.0.0.1:8000')
ARTIFACTS = Path(os.environ.get('FUGAMES_SCREENSHOTS', '/tmp/fugames-expansion'))
ARTIFACTS.mkdir(parents=True, exist_ok=True)
GAMES = ['card_hex', 'gravity_brawl', 'flip_five', 'effect_snake',
         'duplicate_bridge', 'blackjack', 'tank_arena', 'pulse_arena']
SEED = 'let seed=71; Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);'


def fits(page):
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), page.url
    for dialog in page.locator('[role="dialog"]:visible').all():
        box = dialog.bounding_box()
        assert box and box['x'] >= 0 and box['x'] + box['width'] <= page.viewport_size['width'] + 1, (page.url, box)


def activate(page, selector, mobile=False):
    element = page.locator(selector)
    element.tap() if mobile else element.click()


def snapshot(page, name):
    fits(page)
    page.screenshot(path=str(ARTIFACTS / (name + '.png')), full_page=True)


def interactions(page, game, mobile):
    label = 'mobile' if mobile else 'desktop'
    if game in ['card_hex', 'flip_five']:
        stem = 'hex' if game == 'card_hex' else 'flip'
        state = stem + 'Game'
        activate(page, '#play', mobile)
        cell = page.locator('.' + stem + '-cell').nth(24 if stem == 'hex' else 40)
        if mobile:
            cell.tap()
        else:
            cell.focus(); page.keyboard.press('Enter')
        page.clock.run_for(800)
        assert page.evaluate(state + '.ply >= 2')
        activate(page, '#pause', mobile)
        frozen = page.evaluate('JSON.stringify(' + state + ')')
        page.clock.run_for(1600)
        assert page.evaluate('JSON.stringify(' + state + ')') == frozen
        activate(page, '#pause', mobile)
        page.evaluate("window.dispatchEvent(new Event('blur'))")
        assert page.evaluate(state + '.phase') == 'paused'
        activate(page, '#pause', mobile)
        snapshot(page, game + '-playing-' + label)
        # Winning boards use the shipped move API; tests separately validate rules.
        if stem == 'hex':
            page.evaluate("hexGame.reset(1,0); hexGame.start(); for(let r=-CardHex.RADIUS;r<CardHex.RADIUS;r++) hexGame.board[CardHex.index(0,r)]=1; hexGame.act({type:'place',cells:[CardHex.index(0,CardHex.RADIUS)]}); hexRender()")
        else:
            page.evaluate("flipGame.board.fill(0); [0,1,2,3].forEach(i=>flipGame.board[i]=1); flipGame.turn=1; flipGame.act(4); flipRender()")
        assert page.evaluate(state + '.phase') == 'over'
        assert page.locator('#result').is_visible()
        snapshot(page, game + '-result-' + label)
        activate(page, '#restart', mobile)
        page.clock.run_for(700)
        assert page.evaluate(state + '.ply <= ' + ('2' if stem == 'hex' else '1'))
    elif game == 'gravity_brawl':
        activate(page, '#play', mobile)
        if mobile:
            activate(page, '#left', True); activate(page, '#rotate', True); activate(page, '#drop', True)
        else:
            page.keyboard.press('ArrowLeft'); page.keyboard.press('ArrowUp'); page.keyboard.press('Space')
        assert page.evaluate('game.wave') == 2
        for _ in range(3):
            page.clock.run_for(300); activate(page, '#drop', mobile)
        assert page.evaluate('game.gravity') == 1
        activate(page, '#pause', mobile)
        before = page.evaluate('JSON.stringify(game)'); page.clock.run_for(2000)
        assert page.evaluate('JSON.stringify(game)') == before
        activate(page, '#pause', mobile)
        page.evaluate("window.dispatchEvent(new Event('blur'))")
        assert page.evaluate('game.phase') == 'paused'
        activate(page, '#play', mobile)
        snapshot(page, game + '-playing-' + label)
        page.evaluate('game.wave=GravityBrawl.MAX_WAVES; game.actors[0].lines=999; game.resolve(); refresh()')
        assert page.evaluate('game.result.outcome') == 'win'
        snapshot(page, game + '-result-' + label)
        activate(page, '#restart', mobile); activate(page, '#play', mobile)
        assert page.evaluate('game.wave') == 1
    elif game == 'blackjack':
        activate(page, '#deal', mobile)
        snapshot(page, game + '-playing-' + label)
        if page.locator('#pause').is_enabled():
            activate(page, '#pause', mobile)
            frozen = page.locator('#ai-seats').inner_text(); page.clock.run_for(1400)
            assert page.locator('#ai-seats').inner_text() == frozen
            activate(page, '#resume', mobile)
        if page.locator('#stand').is_enabled():
            if mobile: activate(page, '#stand', True)
            else: page.keyboard.press('s')
        page.clock.run_for(20000)
        assert page.locator('#phase-label').inner_text() == '本局結算'
        assert page.locator('#dealer-cards .back').count() == 0
        snapshot(page, game + '-result-' + label)
        activate(page, '#restart', mobile)
        assert page.locator('#balance').inner_text() == '100'
    elif game == 'duplicate_bridge':
        activate(page, '#start', mobile)
        activate(page, '#pause', mobile)
        frozen = page.evaluate('BridgeUI.snapshot()'); page.clock.run_for(1700)
        assert page.evaluate('BridgeUI.snapshot()') == frozen
        activate(page, '#pause', mobile)
        captured = False
        for _ in range(180):
            state = page.evaluate('BridgeUI.snapshot()')
            if state['phase'] == 'complete': break
            if state['human']:
                if state['phase'] == 'auction':
                    if not state['contract'] and state['auction'] < 4:
                        page.select_option('#bid-level', '1'); page.select_option('#bid-strain', '4')
                        if page.locator('#bid').is_enabled(): activate(page, '#bid', mobile)
                        else: activate(page, '#pass', mobile)
                    else: activate(page, '#pass', mobile)
                else:
                    if not captured:
                        snapshot(page, game + '-playing-' + label); captured = True
                    card = page.locator('#hand button:enabled').first
                    if mobile: card.tap()
                    else: card.focus(); page.keyboard.press('Enter')
            else:
                page.clock.run_for(800)
        state = page.evaluate('BridgeUI.snapshot()')
        assert state['phase'] == 'complete', state
        assert state['played'] == (52 if state['contract'] else 0)
        assert isinstance(state['baselineScore'], (int, float))
        snapshot(page, game + '-result-' + label)
        activate(page, '#restart', mobile)
        assert page.evaluate('BridgeUI.snapshot().played') == 0
    else:
        activate(page, '#play', mobile)
        before = page.evaluate('JSON.stringify(game.actors[0])')
        if mobile:
            box = page.locator('#board').bounding_box()
            x, y = box['x'] + box['width']*.45, box['y'] + box['height']*.5
            cdp = page.context.new_cdp_session(page)
            cdp.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
            cdp.send('Input.dispatchTouchEvent', {'type':'touchMove','touchPoints':[{'x':x+36,'y':y}]})
            page.clock.run_for(450)
            cdp.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
        else:
            page.keyboard.down('ArrowRight'); page.clock.run_for(450); page.keyboard.up('ArrowRight')
        assert page.evaluate('JSON.stringify(game.actors[0])') != before
        if game == 'pulse_arena':
            page.locator('#pulse').focus()
            page.keyboard.down('Space'); page.clock.run_for(450); page.keyboard.up('Space'); page.clock.run_for(50)
            assert page.evaluate('game.actors[0].cooldown > 0')
        activate(page, '#pause', mobile)
        frozen = page.evaluate('JSON.stringify(game)'); page.clock.run_for(1200)
        assert page.evaluate('JSON.stringify(game)') == frozen
        activate(page, '#play', mobile)
        page.evaluate("window.dispatchEvent(new Event('blur'))")
        assert page.evaluate('game.phase') == 'paused'
        activate(page, '#play', mobile)
        assert '已暫停' not in page.locator('#status').inner_text()
        snapshot(page, game + '-playing-' + label)
        activate(page, '#restart', mobile)
        assert page.evaluate('game.tick') < 3
        # Once loaded, all simulation and controls continue while offline.
        page.context.set_offline(True)
        page.clock.run_for(200)
        assert page.evaluate('game.tick') > 0
        page.context.set_offline(False)


if __name__ == '__main__':
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
        errors, failed = [], []
        signatures = []
        for width, height, label in [(1366,900,'desktop'), (390,844,'mobile'), (320,568,'narrow'), (844,390,'landscape')]:
            mobile = label != 'desktop'
            context = browser.new_context(viewport={'width':width,'height':height}, is_mobile=mobile, has_touch=mobile)
            context.add_init_script(SEED)
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('console', lambda msg: errors.append(msg.text) if msg.type == 'error' else None)
            page.on('requestfailed', lambda request: failed.append(request.url))
            page.clock.install()
            page.goto(BASE + '/index.html')
            assert page.locator('.game-card').count() == 16
            snapshot(page, 'catalogue-' + label)
            for game in GAMES:
                page.goto(BASE + '/' + game + '.html')
                assert page.locator('details.rules').evaluate('el=>!el.open')
                assert page.locator('.site-nav').count() == 1
                assert page.locator('.play-panel').count() == 1
                signatures.append(page.evaluate("""() => {
                  const b=getComputedStyle(document.querySelector('.btn.primary:not(:disabled)'));
                  return [getComputedStyle(document.body).fontFamily,b.backgroundColor,b.borderRadius,b.minHeight].join('|');
                }"""))
                snapshot(page, game + '-ready-' + label)
                page.locator('details.rules > summary').click()
                fits(page)
                page.locator('details.rules > summary').click()
                if label in ['desktop', 'mobile']:
                    interactions(page, game, mobile)
                page.get_by_role('link', name='所有遊戲 ↗', exact=True).click()
                assert page.locator('.game-card').count() == 16
            context.close()
        assert len(set(signatures)) == 1, signatures
        assert not errors, errors
        assert not failed, failed
        browser.close()
        print('PASS: eight games, four viewports, shared visual tokens, rules/navigation, no horizontal overflow.')
        print('PASS: no console errors, page errors or failed requests. Screenshots:', ARTIFACTS)
