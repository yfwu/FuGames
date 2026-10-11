"""Short real-input UI checks; item grants are explicitly controlled fixtures.

The full unmodified three-lap race lives in tux2d_browser.py. This suite checks
native keyboard activation, focus, reduced motion and play after going offline.
"""
from pathlib import Path
import hashlib, json, os
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/tux2d-2026-10-11/ui-browser.json'
BASE = os.environ.get('FUGAMES_BASE_URL', 'http://127.0.0.1:8011')
SOURCES = ['tux2d-engine.js', 'tux2d-ui.js', 'tux2d.html', 'tux2d.css']
def hashes():
    return {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in SOURCES}

report = {'mode': 'real browser keyboard/pointer UI checks', 'virtualClock': False,
          'controlledFixtures': ['grant held shield to human for keyboard use',
                                 'grant held boost to human for pointer use'],
          'sourceSha256': hashes(), 'errors': [], 'checks': {}}
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), args=['--no-sandbox'])
        ctx = browser.new_context(viewport={'width': 1200, 'height': 900}, reduced_motion='reduce')
        p = ctx.new_page()
        p.on('pageerror', lambda e: report['errors'].append(str(e)))
        remote = []
        p.on('request', lambda req: remote.append(req.url) if not req.url.startswith(BASE) else None)
        p.goto(BASE + '/tux2d.html?seed=ui-keyboard')
        assert p.evaluate('matchMedia("(prefers-reduced-motion: reduce)").matches')
        assert not remote, remote
        report['checks']['reducedMotionAndLocalAssets'] = True
        p.locator('#auto-throttle').uncheck()
        p.locator('#tux-play').focus()
        p.keyboard.press('Space')
        assert p.evaluate('tux2dGame.phase') == 'countdown'
        assert p.evaluate('document.activeElement.id') == 'tux-board'
        report['checks']['nativeSpaceStartsAndFocusesCanvas'] = True
        p.locator('#tux-pause').focus()
        p.keyboard.press('Space')
        assert p.evaluate('tux2dGame.phase') == 'paused'
        frozen = p.evaluate('JSON.stringify(tux2dGame.observation(0))')
        p.wait_for_timeout(140)
        assert p.evaluate('JSON.stringify(tux2dGame.observation(0))') == frozen
        p.keyboard.press('KeyP')
        assert p.evaluate('document.activeElement.id') == 'tux-board'
        assert p.evaluate('tux2dGame.phase') == 'countdown'
        report['checks']['nativeSpacePausesAndPResumesOnCanvas'] = True
        ctx.set_offline(True)
        p.wait_for_function('tux2dGame.phase === "racing"', timeout=12000)
        report['checks']['raceRunsOfflineAfterPageLoad'] = True
        p.evaluate("tux2dGame.racers[0].item = 'shield'; tux2dRender()")
        p.locator('#tux-pause').click()
        p.keyboard.press('Escape')
        assert p.evaluate('document.activeElement.id') == 'tux-board'
        p.keyboard.down('Space')
        assert p.evaluate('tux2dUI().input.useItem')
        p.wait_for_timeout(120)
        p.keyboard.up('Space')
        assert p.evaluate('tux2dGame.phase') == 'racing'
        assert p.evaluate('tux2dGame.racers[0].shield') > 7
        assert p.evaluate('tux2dGame.racers[0].item') is None
        assert not p.evaluate('tux2dUI().input.useItem')
        report['checks']['resumeThenSpaceUsesShieldWithoutPausing'] = True
        p.evaluate("tux2dGame.racers[0].item = 'boost'; tux2dRender()")
        p.locator('#race-item').click()
        p.wait_for_timeout(120)
        assert p.evaluate('tux2dGame.racers[0].boost') > 1
        assert p.evaluate('tux2dGame.racers[0].item') is None
        report['checks']['itemButtonClickUsesBoost'] = True
        p.locator('#tux-restart').click()
        assert p.evaluate('tux2dGame.phase') == 'ready'
        assert p.locator('#tux-mode').is_enabled() and p.locator('#tux-seed').is_enabled()
        assert not p.evaluate('tux2dUI().scheduled')
        report['checks']['restartReturnsToEditableReady'] = True
        ctx.close()
        mobile = browser.new_context(viewport={'width': 844, 'height': 390}, is_mobile=True, has_touch=True, device_scale_factor=2)
        p = mobile.new_page()
        p.on('pageerror', lambda e: report['errors'].append(str(e)))
        p.goto(BASE + '/tux2d.html?seed=ui-touch')
        p.locator('#auto-throttle').uncheck()
        p.locator('#tux-play').tap()
        p.wait_for_function('tux2dGame.phase === "racing"', timeout=12000)
        p.locator('.tux-arena').evaluate("el => el.scrollIntoView({block: 'start'})")
        stage = p.locator('.tux-stage').bounding_box()
        buttons = [p.locator('#touch-' + name).bounding_box() for name in ['left', 'right', 'throttle', 'brake', 'drift', 'item']]
        assert all(b and b['width'] >= 44 and b['height'] >= 44 for b in buttons), buttons
        assert stage['y'] >= 0 and max(b['y'] + b['height'] for b in buttons) <= 390, (stage, buttons)
        report['checks']['landscapeTrackAndSixTouchTargetsFit'] = True
        p.evaluate("tux2dGame.racers[0].item = 'boost'; tux2dRender()")
        p.locator('#touch-item').tap()
        p.wait_for_timeout(150)
        assert p.evaluate('tux2dGame.racers[0].item') is None
        assert p.evaluate('tux2dGame.racers[0].boost') > 1
        report['checks']['briefTouchItemTapUsesBoost'] = True
        mobile.close()
        browser.close()
    assert not report['errors'], report['errors']
    assert hashes() == report['sourceSha256'], 'Sources changed during UI check'
    report['pass'] = True
except Exception as exc:
    report['pass'] = False
    report['failure'] = repr(exc)
    raise
finally:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps(report, ensure_ascii=False))
