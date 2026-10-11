"""91-cell three-way Hex: real keyboard/touch, hidden zones, timed guns, bridge, round completion."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = os.environ.get('FUGAMES_BASE_URL', 'http://127.0.0.1:8000')
OUT = Path(os.environ.get('FUGAMES_HEX_SCREENSHOTS', '/tmp/fugames-hex-revision'))
OUT.mkdir(parents=True, exist_ok=True)


def activate(page, selector, mobile=False):
    button = page.locator(selector)
    button.tap() if mobile else button.click()


def load(page):
    page.goto(BASE + '/card_hex.html?terrain=classic&cards=classic&seed=legacy-fixture')
    page.locator('#play').click()


def cell(page, q, r):
    return page.evaluate('([q,r])=>CardHex.index(q,r)', [q, r])


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
    errors, failed = [], []
    for width, height, label in [(1366, 1000, 'desktop'), (390, 844, 'mobile'), (320, 568, 'narrow'), (844, 390, 'landscape')]:
        mobile = label != 'desktop'
        context = browser.new_context(viewport={'width': width, 'height': height}, has_touch=mobile, is_mobile=mobile)
        context.add_init_script('let seed=37; Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);')
        page = context.new_page();page.clock.install()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('requestfailed', lambda r: failed.append(r.url))
        page.goto(BASE + '/card_hex.html?terrain=classic&cards=classic&seed=legacy-fixture')
        assert page.locator('.hex-cell').count() == 91
        assert page.locator('.hex-goal-line').count() == 6
        assert page.locator('#play svg').count() == 1
        assert page.locator('h1 svg.page-icon use').get_attribute('href') == 'icons.svg#card_hex'
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.screenshot(path=str(OUT / (label + '-ready.png')), full_page=True)
        activate(page, '#play', mobile)
        c = cell(page, 0, 0)
        if mobile:
            activate(page, f'[data-cell="{c}"]', True)
        else:
            page.locator(f'[data-cell="{c}"]').focus();page.keyboard.press('ArrowRight')
            assert page.evaluate('Number(document.activeElement.dataset.cell)') != c
            page.keyboard.press('Enter')
        assert page.evaluate('hexGame.ply') == 1
        activate(page, '#pause', mobile)
        saved = page.evaluate('JSON.stringify(hexGame)');page.clock.run_for(5000)
        assert page.evaluate('JSON.stringify(hexGame)') == saved
        activate(page, '#pause', mobile);page.clock.run_for(1600)
        assert page.evaluate('hexGame.ply') == 3
        assert page.evaluate('hexGame.turn') == 1
        page.screenshot(path=str(OUT / (label + '-playing.png')), full_page=True)
        page.evaluate("window.dispatchEvent(new Event('blur'))")
        assert page.evaluate('hexGame.phase') == 'paused'
        activate(page, '#pause', mobile)
        page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))")
        assert page.evaluate('hexGame.phase') == 'paused'
        page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'))")
        page.clock.run_for(5000);assert page.evaluate('hexGame.phase') == 'paused'
        activate(page, '#restart', mobile)
        assert page.evaluate('hexGame.first') == 2
        assert page.evaluate('hexGame.axisRotation') == 1
        assert page.evaluate('hexGame.ply') == 0
        page.clock.run_for(1600);assert page.evaluate('hexGame.turn') == 1
        if mobile:
            activate(page, '#zoom', True)
            assert page.locator('#board-scroll').evaluate('el=>el.scrollWidth>el.clientWidth') or width > 650
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            activate(page, '#zoom', True)
        context.close()

    context = browser.new_context(viewport={'width': 1366, 'height': 1000})
    page = context.new_page();page.clock.install();page.on('pageerror', lambda e: errors.append(str(e)))
    load(page)
    page.evaluate("""() => {hexGame.traps=[{owner:2,cell:CardHex.index(0,0)},{owner:3,cell:CardHex.index(2,0)}];hexRender();}""")
    hidden_before = page.locator('#board').inner_html()
    assert page.locator('.own-trap').count() == 0
    assert page.locator('.hex-cell[aria-label*="秘密陷阱"]').count() == 0
    page.evaluate("""() => {hexGame.traps[0].cell=CardHex.index(-3,1);hexGame.traps[1].cell=CardHex.index(3,-1);hexRender();}""")
    assert page.locator('#board').inner_html() == hidden_before, 'Unknown enemy trap locations must not affect DOM'

    # Real double click enters a concealed enemy zone and displays the reveal, cancelling both stones.
    page.evaluate("""() => {hexGame.traps=[{owner:2,cell:CardHex.index(0,0)}];hexGame.hands[1]=['double'];hexRender();}""")
    page.locator('#double').click()
    for q, r in [(0, 0), (1, 0)]:
        page.locator(f'[data-cell="{cell(page,q,r)}"]').click()
    assert page.evaluate('hexGame.board[CardHex.index(0,0)]===0 && hexGame.board[CardHex.index(1,0)]===0')
    assert page.locator('.hex-cell.revealed').count() == 1
    assert '陷阱揭露' in page.locator('#last-action').inner_text()
    page.screenshot(path=str(OUT / 'trap-revealed.png'), full_page=True)

    load(page)
    page.evaluate("hexGame.hands[1]=['trap'];hexRender();")
    page.locator('#trap').click()
    for q, r in [(-5, 0), (0, 0)]:
        page.locator(f'[data-cell="{cell(page,q,r)}"]').click()
    assert page.locator('.hex-cell.own-trap').count() == 7
    assert page.locator('.hex-cell[aria-label*="你的秘密陷阱"]').count() == 1
    page.screenshot(path=str(OUT / 'own-trap-zone.png'), full_page=True)

    # Both AI players have only ordinary actions, so the timer and friendly-fire demonstration is deterministic.
    load(page)
    page.evaluate("""() => {const ring=CardHex.ADJ[CardHex.index(0,0)];ring.slice(0,3).forEach((i,k)=>hexGame.board[i]=k+1);hexGame.hands[1]=['turret'];hexGame.hands[2]=hexGame.hands[3]=[];hexGame.decks[2]=hexGame.decks[3]=[];hexRender();}""")
    page.locator('#turret').click();page.locator(f'[data-cell="{cell(page,0,0)}"]').click()
    assert page.locator('.hex-cell.danger').count() == 6
    assert page.locator('.hex-countdown').text_content() == '3'
    page.screenshot(path=str(OUT / 'turret-warning.png'), full_page=True)
    page.clock.run_for(1600);assert page.evaluate('hexGame.ply') == 3
    safe = page.evaluate('hexGame.board.findIndex((x,i)=>!x&&CardHex.distance(i,CardHex.index(0,0))>2)')
    page.locator(f'[data-cell="{safe}"]').click()
    assert page.evaluate('CardHex.ADJ[CardHex.index(0,0)].every(i=>hexGame.board[i]===0)')
    assert page.evaluate('hexGame.turrets[0].shots') == 1
    page.clock.run_for(1600)
    safe = page.evaluate('hexGame.board.findIndex((x,i)=>!x&&CardHex.distance(i,CardHex.index(0,0))>2)')
    page.locator(f'[data-cell="{safe}"]').click()
    assert page.evaluate('hexGame.turrets.length') == 0
    assert page.evaluate('hexGame.board[CardHex.index(0,0)]') == 1
    assert page.locator('.hex-countdown').count() == 0
    page.screenshot(path=str(OUT / 'turret-expired.png'), full_page=True)

    load(page)
    page.evaluate("""() => {for(let r=-5;r<=5;r++)hexGame.board[CardHex.index(0,r)]=r===0?2:1;hexGame.hands[1]=['bridge'];hexRender();}""")
    page.locator('#bridge').click()
    for q, r in [(0, -1), (0, 1)]:
        page.locator(f'[data-cell="{cell(page,q,r)}"]').click()
    assert page.evaluate('hexGame.result.winner') == 1
    assert page.locator('#bridge-lines .hex-bridge').count() == 1
    assert page.locator('#bridge-lines').evaluate('el=>getComputedStyle(el).zIndex') == '2'
    assert page.locator('#result').is_visible()
    page.screenshot(path=str(OUT / 'bridge-win.png'), full_page=True)
    context.close()

    # Complete a mobile round exclusively with real card/board taps; AI turns use scheduled callbacks.
    context = browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
    context.add_init_script('let seed=7;Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);')
    page=context.new_page();page.clock.install();page.on('pageerror',lambda e:errors.append(str(e)))
    load(page)
    for _ in range(220):
        state=page.evaluate('({phase:hexGame.phase,turn:hexGame.turn,pending:hexGame.pending})')
        if state['phase']=='over':break
        if state['pending']:
            if state['pending']['defender']==1:
                activate(page,'#counter' if page.locator('#counter').is_enabled() else '#accept',True)
            else:page.clock.run_for(700)
        elif state['turn']!=1:page.clock.run_for(1000)
        else:
            action=page.evaluate('CardHex.chooseAction(hexGame.observation(1))')
            activate(page,'#normal' if action['type']=='place' else '#'+action['type'],True)
            for target in action['cells']:activate(page,f'[data-cell="{target}"]',True)
    assert page.evaluate('hexGame.phase')=='over'
    assert page.locator('#result').is_visible()
    assert page.locator('#play svg use').get_attribute('href')=='icons.svg#restart'
    final=page.evaluate('JSON.stringify(hexGame.result)');page.clock.run_for(5000)
    assert page.evaluate('JSON.stringify(hexGame.result)')==final
    page.screenshot(path=str(OUT/'mobile-complete.png'),full_page=True)
    activate(page,'#play',True);assert page.evaluate('hexGame.ply')==0
    context.close();browser.close()
    assert not errors,errors
    assert not failed,failed
    print('Hex revision browser passed:91cells/3players,four viewports,keyboard/touch,hidden-trap DOM permutation+reveal,own7-cell zone,turretwarning/friendlyfire/expiry,bridgewin,full mobile round,pause/visibility/restart; no JS errors or overflow.')
