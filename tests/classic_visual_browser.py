"""Classic game geometry, non-colour state marks and keyboard/touch visual regression."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = os.environ.get('FUGAMES_BASE_URL', 'http://127.0.0.1:8000')
OUT = Path(os.environ.get('FUGAMES_SCREENSHOTS', '/tmp/fugames-revision-classic'))
OUT.mkdir(parents=True, exist_ok=True)


def fits(page):
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), page.url
    icon = page.locator('h1 .page-icon').bounding_box()
    assert icon['width'] == icon['height'] == 36
    assert page.locator('h1 .page-icon use').get_attribute('href').startswith('icons.svg#')


def stones(page, selector='.cell .classic-stone'):
    for stone in page.locator(selector).all():
        rect = stone.bounding_box()
        assert abs(rect['width'] - rect['height']) < .1, 'pieces must be circular, independent of font'
        assert stone.evaluate('e=>getComputedStyle(e).opacity') == '1'
        assert stone.evaluate('e=>getComputedStyle(e).borderTopColor') == 'rgb(46, 52, 64)'
        assert stone.get_attribute('aria-hidden') == 'true' if selector == '.cell .classic-stone' else True


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
    errors, failures = [], []
    for width, height, label in [(1366, 1000, 'desktop'), (390, 844, 'mobile'), (320, 568, 'narrow'), (844, 390, 'landscape')]:
        context = browser.new_context(viewport={'width': width, 'height': height}, has_touch=label != 'desktop', is_mobile=label != 'desktop')
        page = context.new_page()
        page.clock.install()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('response', lambda response: failures.append(response.url) if response.status >= 400 else None)
        def activate(selector):
            page.locator(selector).tap() if label != 'desktop' else page.locator(selector).click()

        page.goto(BASE + '/cyclic_tictactoe.html')
        fits(page)
        page.locator('.cell').first.focus()
        assert page.locator('.cell').first.evaluate('e=>getComputedStyle(e).outlineStyle') == 'solid'
        page.keyboard.press('Enter')
        assert page.locator('.cell .classic-stone').count() == 2
        stones(page)
        assert page.locator('.classic-stone.white').count() == 2, 'one AI piece plus the white legend token'
        # Fixed non-winning board makes both players queue positions inspectable.
        page.evaluate("board=['X','O','X','O','','','O','X','']; placedPieces={X:3,O:3}; placeOrder={X:[0,2,7],O:[1,3,6]}; currentPlayer='X';gameOver=false;winningLine=[];moveCount=6;updateMoveCount();renderBoard();")
        assert page.locator('.queue-badge:not(.second)').count() == 2
        assert page.locator('.queue-badge.second').count() == 2
        assert '下一顆移動' in page.locator('.cell').first.get_attribute('aria-label')
        page.screenshot(path=str(OUT / f'cyclic_tictactoe-{label}.png'), full_page=True)
        page.evaluate("board=['X','X','X','','O','','O','',''];placedPieces={X:3,O:2};placeOrder={X:[0,1,2],O:[4,6]};checkAndNext('X');")
        assert page.locator('.cell.highlight').count() == 3
        assert page.locator('.cell.highlight').first.evaluate("e=>getComputedStyle(e,'::after').borderTopStyle") == 'double'
        assert page.locator('.cell:disabled').count() == 9
        stones(page)
        activate('button[onclick="resetGame()"]')
        assert page.locator('.cell .classic-stone').count() == 0

        page.goto(BASE + '/cyclic_connect4_torus.html')
        fits(page)
        assert page.locator('.colBtn .ui-icon').count() == 7
        for col in [0, 1, 0, 1, 0, 1, 0]:
            activate(f'[data-col="{col}"]')
        assert page.locator('.cell.win').count() == 4
        assert page.locator('.cell.last').count() == 1
        assert page.locator('.cell.last').evaluate("e=>getComputedStyle(e,'::before').width") == '9px'
        assert '最新落子' in page.locator('.cell.last').get_attribute('aria-label')
        assert page.locator('.cell.win').first.evaluate("e=>getComputedStyle(e,'::after').borderTopStyle") == 'double'
        assert page.locator('.colBtn:disabled').count() == 7
        stones(page)
        page.screenshot(path=str(OUT / f'cyclic_connect4_torus-{label}.png'), full_page=True)
        activate('#newGame')
        assert page.locator('.cell .classic-stone').count() == 0

        page.goto(BASE + '/trackgame.html')
        fits(page)
        activate('[data-idx="0"]')
        page.clock.run_for(400)
        page.locator('.piece').evaluate_all('es=>es.forEach(e=>e.getAnimations().forEach(a=>a.finish()))')
        stone = page.locator('.piece').bounding_box()
        cell = page.locator('[data-idx="1"]').bounding_box()
        assert abs(stone['x'] + stone['width']/2 - cell['x'] - cell['width']/2) < .2
        assert abs(stone['y'] + stone['height']/2 - cell['y'] - cell['height']/2) < .2
        assert page.locator('.cell.innerRing').first.evaluate('e=>getComputedStyle(e).borderTopStyle') == 'dashed'
        assert page.locator('.cell.outerRing').first.evaluate('e=>getComputedStyle(e).borderTopStyle') == 'solid'
        activate('#hint')
        assert page.locator('.cell.hint').count() == 1
        assert page.locator('.cell.hint').get_attribute('aria-description') == '建議落點'
        assert page.locator('.cell.hint').evaluate("e=>getComputedStyle(e,'::before').transform") != 'none'
        page.screenshot(path=str(OUT / f'trackgame-{label}.png'), full_page=True)
        activate('#undo')
        assert page.locator('.piece').count() == 0
        activate('[data-idx="0"]')
        activate('#newGame')
        page.clock.run_for(450)
        assert page.locator('.piece').count() == 0
        assert page.locator('#turnKpi').inner_text() == '0'
        context.close()
    browser.close()
    assert not errors, errors
    assert not failures, failures
    print('PASS: 3 classic games × 4 viewports, vector header/control icons, geometric pieces, non-colour marks, touch/keyboard, focus, restart/animation, no JS errors or failed resources')
    print('Screenshots:', OUT)
