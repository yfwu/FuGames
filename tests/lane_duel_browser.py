"""Real Chromium checks for 雙線塔防 using mouse, keyboard and touch input.

Start a static server first (python -m http.server 8000) or set FUGAMES_BASE_URL.
Writes a JSON report and screenshots to docs/lane-duel-2026-10-12/.
"""
from pathlib import Path
import json, os, time
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/lane-duel-2026-10-12'
SHOTS = OUT / 'screenshots'
BASE = os.environ.get('FUGAMES_BASE_URL', 'http://127.0.0.1:8000')
CHROMIUM = os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium')
SHOTS.mkdir(parents=True, exist_ok=True)
report = {'base': BASE, 'errors': [], 'checks': {}}


def check(name, value=True):
    assert value, name
    report['checks'][name] = value


def cell_point(page, col, row):
    box = page.locator('#board').bounding_box()
    return (box['x'] + (col + .5) * 45 / 720 * box['width'],
            box['y'] + (360 + (row + .5) * 45) / 720 * box['height'])


def towers(page):
    return page.evaluate('laneGame.sides[0].towers.map(t => [t.type, t.col, t.row, t.level])')


def no_overflow(page):
    return page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')


with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=CHROMIUM, args=['--no-sandbox'])

    # Desktop: mouse building, keyboard cursor, upgrade/sell, sending, pause and restart.
    ctx = browser.new_context(viewport={'width': 1440, 'height': 1000})
    page = ctx.new_page()
    page.on('pageerror', lambda e: report['errors'].append(str(e)))
    page.on('console', lambda m: m.type == 'error' and report['errors'].append(m.text))
    page.goto(BASE + '/lane_duel.html')
    check('overlay shown before start', page.locator('#overlay').is_visible())
    page.locator('#board').screenshot(path=str(SHOTS / 'ready-desktop.png'))
    page.select_option('#difficulty', 'easy')
    page.click('#play')
    check('running after start', page.evaluate('laneGame.phase') == 'running')
    check('difficulty applied', page.evaluate('laneGame.difficulty[1]') == 'easy')

    page.mouse.click(*cell_point(page, 0, 0))
    check('mouse click builds the selected arrow tower', towers(page) == [['arrow', 0, 0, 1]])
    page.mouse.click(*cell_point(page, 0, 1))
    check('road cell refuses a tower', len(towers(page)) == 1 and '道路' in page.inner_text('#status'))

    page.keyboard.press('2')
    check('key 2 selects the cannon', page.get_attribute('[data-tower="cannon"]', 'aria-pressed') == 'true')
    page.locator('#board').focus()
    page.evaluate('cursor = {col: 4, row: 2}')
    page.keyboard.press('ArrowRight')
    page.keyboard.press('Enter')
    check('keyboard cursor builds a cannon', ['cannon', 5, 2, 1] in towers(page))

    page.evaluate('laneGame.sides[0].gold = 500')
    page.mouse.click(*cell_point(page, 0, 0))
    check('clicking own tower selects it', not page.locator('#upgrade').is_disabled())
    page.click('#upgrade')
    check('upgrade button raises the level', ['arrow', 0, 0, 2] in towers(page))
    gold_before = page.evaluate('laneGame.sides[0].gold')
    page.keyboard.press('x')
    check('X sells the selected tower for 70%', page.evaluate('laneGame.sides[0].gold') == gold_before + 39
          and ['arrow', 0, 0, 2] not in towers(page))

    page.keyboard.press('q')
    check('Q sends a runner to the AI lane', page.evaluate('laneGame.sides[0].sent.runner') == 1
          and page.evaluate('laneGame.fields[1].queue.length + laneGame.fields[1].units.length') >= 1)
    page.click('[data-send="swarm"]')
    check('send button sends a swarm and raises income', page.evaluate('laneGame.sides[0].sent.swarm') == 1
          and page.evaluate('laneGame.sides[0].income') == 8 + 1 + 2)

    page.wait_for_function('laneGame.wave >= 1', timeout=20000)
    page.wait_for_function('laneGame.fields[0].units.length + laneGame.fields[1].units.length >= 4', timeout=10000)
    page.locator('#board').screenshot(path=str(SHOTS / 'battle-desktop.png'))
    page.screenshot(path=str(SHOTS / 'page-desktop.png'), full_page=True)

    page.keyboard.press('p')
    check('P pauses', page.evaluate('laneGame.phase') == 'paused' and page.locator('#overlay').is_visible())
    frozen = page.evaluate('JSON.stringify([laneGame.tick, laneGame.sides, laneGame.fields])')
    page.wait_for_timeout(600)
    check('paused state is frozen', page.evaluate('JSON.stringify([laneGame.tick, laneGame.sides, laneGame.fields])') == frozen)
    page.keyboard.press('p')
    check('P resumes', page.evaluate('laneGame.phase') == 'running')

    page.click('#restart')
    check('restart asks first', page.locator('#dialog-secondary').is_visible() and page.evaluate('laneGame.phase') == 'paused')
    page.click('#dialog-secondary')
    check('cancel keeps the round', page.evaluate('laneGame.phase') == 'running' and page.evaluate('laneGame.sides[0].sent.runner') == 1)
    page.click('#restart')
    page.click('#play')
    check('confirm restarts cleanly', page.evaluate('laneGame.tick') < 10 and page.evaluate('laneGame.sides[0].towers.length') == 0
          and page.evaluate('laneGame.sides[0].sent.runner') == 0)

    page.evaluate('laneGame.sides[1].lives = 1; laneGame.fields[1].units.push({id: 999, kind: "creep", hp: 1e9, maxHp: 1e9, speed: 40, lives: 1, bounty: 0, armor: 0, sender: 0, dist: 42.9, slow: 0, slowTicks: 0})')
    page.wait_for_function('laneGame.phase === "over"', timeout=5000)
    check('result dialog announces the win', '你贏了' in page.inner_text('#dialog-title'))
    page.locator('#board').screenshot(path=str(SHOTS / 'result-desktop.png'))

    # Window blur auto-pauses.
    page.click('#play')
    page.evaluate('window.dispatchEvent(new Event("blur"))')
    check('blur pauses', page.evaluate('laneGame.phase') == 'paused')
    check('desktop has no horizontal overflow', no_overflow(page))

    # Offline after load: nothing is fetched during play.
    ctx.set_offline(True)
    page.click('#play')
    page.wait_for_timeout(1500)
    check('keeps running offline', page.evaluate('laneGame.phase') == 'running' and page.evaluate('laneGame.tick') > 20)
    ctx.set_offline(False)
    ctx.close()

    # Spectator mode: both lanes are AI, human controls disabled.
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900})
    page = ctx.new_page()
    page.on('pageerror', lambda e: report['errors'].append(str(e)))
    page.goto(BASE + '/lane_duel.html')
    page.check('#spectate')
    page.click('#play')
    page.wait_for_function('laneGame.sides[0].towers.length >= 2 && laneGame.sides[1].towers.length >= 2', timeout=15000)
    check('spectator mode lets AI defend the lower lane', page.evaluate('laneGame.ai[0]') is True)
    check('human controls disabled while spectating', page.locator('[data-tower="arrow"]').is_disabled()
          and page.locator('[data-send="runner"]').is_disabled())
    ctx.close()

    # Phones: touch taps build; layout fits; landscape keeps the board visible.
    for name, viewport, dpr in [('mobile', {'width': 390, 'height': 844}, 3), ('narrow', {'width': 320, 'height': 740}, 2), ('landscape', {'width': 844, 'height': 390}, 2)]:
        ctx = browser.new_context(viewport=viewport, device_scale_factor=dpr, has_touch=True, is_mobile=True)
        page = ctx.new_page()
        page.on('pageerror', lambda e: report['errors'].append(str(e)))
        page.goto(BASE + '/lane_duel.html')
        page.tap('#play')
        page.locator('#board').scroll_into_view_if_needed()
        page.touchscreen.tap(*cell_point(page, 3, 0))
        check(f'{name}: touch tap builds a tower', towers(page) == [['arrow', 3, 0, 1]])
        page.tap('[data-send="runner"]')
        check(f'{name}: touch send works', page.evaluate('laneGame.sides[0].sent.runner') == 1)
        sizes = page.evaluate('[...document.querySelectorAll(".lane-row .btn")].map(b => Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height))')
        check(f'{name}: buttons at least 40px', min(sizes) >= 40)
        check(f'{name}: no horizontal overflow', no_overflow(page))
        page.wait_for_timeout(500)
        page.screenshot(path=str(SHOTS / f'page-{name}.png'))
        ctx.close()

    # Homepage card.
    ctx = browser.new_context(viewport={'width': 390, 'height': 844})
    page = ctx.new_page()
    page.goto(BASE + '/index.html')
    check('homepage lists sixteen games', page.locator('.game-card').count() == 16)
    card = page.locator('.game-card', has_text='雙線塔防')
    card.scroll_into_view_if_needed()
    card.screenshot(path=str(SHOTS / 'catalog-card.png'))
    card.locator('a').click()
    page.wait_for_url('**/lane_duel.html')
    check('homepage link opens the game', True)
    ctx.close()
    browser.close()

check('no page or console errors', report['errors'] == [])
(OUT / 'browser.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'checks': len(report['checks']), 'errors': report['errors']}, ensure_ascii=False))
