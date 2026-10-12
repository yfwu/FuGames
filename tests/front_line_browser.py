"""Real Chromium checks for 三路前線 using mouse, keyboard and touch input.

Start a static server first (python -m http.server 8000) or set FUGAMES_BASE_URL.
Writes a JSON report and screenshots to docs/front-line-2026-10-12/.
"""
from pathlib import Path
import json, os
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/front-line-2026-10-12'
SHOTS = OUT / 'screenshots'
BASE = os.environ.get('FUGAMES_BASE_URL', 'http://127.0.0.1:8000')
CHROMIUM = os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium')
SHOTS.mkdir(parents=True, exist_ok=True)
report = {'base': BASE, 'errors': [], 'checks': {}}


def check(name, value=True):
    assert value, name
    report['checks'][name] = value


def point(page, x, y):
    box = page.locator('#board').bounding_box()
    return box['x'] + x / 720 * box['width'], box['y'] + y / 720 * box['height']


def slot_point(page, lane, slot):
    p = page.evaluate(f'FrontLine.slotPos(0, {lane}, {slot})')
    return point(page, p['x'], p['y'])


def mine(page):
    return page.evaluate('frontGame.sides[0].structures.map(s => [s.type, s.lane, s.slot])')


def no_overflow(page):
    return page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')


with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=CHROMIUM, args=['--no-sandbox'])

    ctx = browser.new_context(viewport={'width': 1440, 'height': 1000})
    page = ctx.new_page()
    page.on('pageerror', lambda e: report['errors'].append(str(e)))
    page.on('console', lambda m: m.type == 'error' and report['errors'].append(m.text))
    page.goto(BASE + '/front_line.html')
    check('overlay shown before start', page.locator('#overlay').is_visible())
    page.select_option('#difficulty', 'easy')
    page.click('#play')
    check('running after start', page.evaluate('frontGame.phase') == 'running')
    check('difficulty applied', page.evaluate('frontGame.difficulty[1]') == 'easy')

    page.mouse.click(*slot_point(page, 1, 4))
    check('mouse builds the selected factory', mine(page) == [['factory', 1, 4]])
    page.keyboard.press('2')
    check('key 2 selects the turret', page.get_attribute('[data-build="turret"]', 'aria-pressed') == 'true')
    page.mouse.click(*slot_point(page, 1, 5))
    check('turret built next to it', ['turret', 1, 5] in mine(page))
    page.evaluate('frontGame.sides[0].supply = 400')
    page.keyboard.press('3')
    page.mouse.click(*slot_point(page, 0, 0))
    check('radar built', ['radar', 0, 0] in mine(page))
    check('own radar lifts the fog on that lane only',
          page.evaluate('frontGame.sees(0, FrontLine.laneX(0), 150, 0) && !frontGame.sees(0, FrontLine.laneX(2), 150, 2)'))

    page.mouse.click(*slot_point(page, 0, 0))
    check('clicking own building selects it', not page.locator('#sell').is_disabled())
    supply = page.evaluate('frontGame.sides[0].supply')
    page.keyboard.press('Delete')
    check('Delete sells for half', ['radar', 0, 0] not in mine(page) and page.evaluate('frontGame.sides[0].supply') >= supply + 17)

    page.evaluate('frontGame.sides[0].structures.find(s => s.type === "turret").hp = 40')
    page.keyboard.press('e')
    page.mouse.click(*point(page, 360, 560))
    check('engineer goes to the clicked lane', page.evaluate('frontGame.engineers.some(e => e.side === 0 && e.lane === 1)'))

    # Cards: give a known hand so each card path is exercised through the UI.
    page.evaluate('frontGame.sides[0].hand = ["recon", "strike", "jam"]; frontGame.sides[1].structures.length || frontGame.build(1, 2, 4, "factory")')
    page.wait_for_function('document.querySelectorAll(".card-btn").length === 3')
    page.keyboard.press('z')
    check('Z plays recon and reveals the whole enemy side', page.evaluate('frontGame.sides[0].revealUntil > frontGame.tick'))
    page.wait_for_function('document.querySelectorAll(".card-btn").length === 2')
    page.locator('#board').screenshot(path=str(SHOTS / 'recon-desktop.png'))
    target = page.evaluate('(() => { const s = frontGame.sides[1].structures[0]; return [s.x, s.y]; })()')
    page.keyboard.press('z')
    page.mouse.click(*point(page, *target))
    check('strike is placed where clicked', page.evaluate('frontGame.strikes.some(b => b.side === 0)'))
    page.wait_for_function('!frontGame.strikes.some(b => b.side === 0)', timeout=5000)
    check('strike damaged the enemy building', page.evaluate('frontGame.sides[1].destroyed + frontGame.sides[0].destroyed') >= 1
          or page.evaluate('frontGame.sides[1].structures.some(s => s.hp < s.maxHp)'))
    page.keyboard.press('z')
    page.mouse.click(*point(page, 600, 150))
    check('jam targets the clicked lane', page.evaluate('frontGame.sides[1].jammed[2] > frontGame.tick'))

    page.wait_for_function('frontGame.drones.some(d => d.side === 0)', timeout=15000)
    page.evaluate('frontGame.sides[0].supply = 300')
    page.keyboard.press('1')
    page.mouse.click(*slot_point(page, 2, 4))
    page.wait_for_timeout(3000)
    page.locator('#board').screenshot(path=str(SHOTS / 'battle-desktop.png'))
    page.screenshot(path=str(SHOTS / 'page-desktop.png'), full_page=True)

    page.keyboard.press('p')
    check('P pauses', page.evaluate('frontGame.phase') == 'paused' and page.locator('#overlay').is_visible())
    frozen = page.evaluate('JSON.stringify([frontGame.tick, frontGame.sides, frontGame.drones])')
    page.wait_for_timeout(600)
    check('paused state is frozen', page.evaluate('JSON.stringify([frontGame.tick, frontGame.sides, frontGame.drones])') == frozen)
    page.keyboard.press('p')
    check('P resumes', page.evaluate('frontGame.phase') == 'running')

    page.click('#restart')
    check('restart asks first', page.locator('#dialog-secondary').is_visible())
    page.click('#dialog-secondary')
    check('cancel keeps the round', page.evaluate('frontGame.phase') == 'running' and len(mine(page)) >= 2)
    page.click('#restart')
    page.click('#play')
    check('confirm restarts cleanly', page.evaluate('frontGame.tick') < 10 and mine(page) == [])

    page.evaluate('frontGame.sides[1].hq = 4; frontGame.drones.push({id: 9999, side: 0, lane: 1, x: FrontLine.laneX(1), y: 41, hp: 99, attacking: null})')
    page.wait_for_function('frontGame.phase === "over"', timeout=5000)
    check('result dialog announces the win', '你贏了' in page.inner_text('#dialog-title'))

    page.click('#play')
    page.evaluate('window.dispatchEvent(new Event("blur"))')
    check('blur pauses', page.evaluate('frontGame.phase') == 'paused')
    check('desktop has no horizontal overflow', no_overflow(page))
    ctx.set_offline(True)
    page.click('#play')
    page.wait_for_timeout(1500)
    check('keeps running offline', page.evaluate('frontGame.phase') == 'running' and page.evaluate('frontGame.tick') > 20)
    ctx.close()

    # Spectator mode shows the whole map and runs both sides.
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900})
    page = ctx.new_page()
    page.on('pageerror', lambda e: report['errors'].append(str(e)))
    page.goto(BASE + '/front_line.html')
    page.check('#spectate')
    page.click('#play')
    page.wait_for_function('frontGame.tick > 500', timeout=60000)
    check('spectator mode: both sides built', page.evaluate('frontGame.sides.every(s => s.built >= 3)'))
    check('human controls disabled while spectating', page.locator('[data-build="factory"]').is_disabled())
    page.locator('#board').screenshot(path=str(SHOTS / 'spectate-desktop.png'))
    ctx.close()

    for name, viewport, dpr in [('mobile', {'width': 390, 'height': 844}, 3), ('narrow', {'width': 320, 'height': 740}, 2), ('landscape', {'width': 844, 'height': 390}, 2)]:
        ctx = browser.new_context(viewport=viewport, device_scale_factor=dpr, has_touch=True, is_mobile=True)
        page = ctx.new_page()
        page.on('pageerror', lambda e: report['errors'].append(str(e)))
        page.goto(BASE + '/front_line.html')
        page.tap('#play')
        page.locator('#board').scroll_into_view_if_needed()
        page.touchscreen.tap(*slot_point(page, 0, 4))
        check(f'{name}: touch tap builds', mine(page) == [['factory', 0, 4]])
        sizes = page.evaluate('[...document.querySelectorAll(".front-row .btn")].map(b => Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height))')
        check(f'{name}: buttons at least 40px', min(sizes) >= 40)
        check(f'{name}: no horizontal overflow', no_overflow(page))
        page.wait_for_timeout(400)
        page.screenshot(path=str(SHOTS / f'page-{name}.png'))
        ctx.close()

    ctx = browser.new_context(viewport={'width': 390, 'height': 844})
    page = ctx.new_page()
    page.goto(BASE + '/index.html')
    check('homepage lists sixteen games', page.locator('.game-card').count() == 16)
    card = page.locator('.game-card', has_text='三路前線')
    card.scroll_into_view_if_needed()
    card.screenshot(path=str(SHOTS / 'catalog-card.png'))
    card.locator('a').click()
    page.wait_for_url('**/front_line.html')
    check('homepage link opens the game', True)
    ctx.close()
    browser.close()

check('no page or console errors', report['errors'] == [])
(OUT / 'browser.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'checks': len(report['checks']), 'errors': report['errors']}, ensure_ascii=False))
