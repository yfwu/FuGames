"""Real Chromium bridge games, keyboard/touch, pause/restart and screenshots.
Run after serving repository on port 8000. Uses no private game mutation.
"""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright
BASE = os.environ.get('FUGAMES_BASE_URL', 'http://127.0.0.1:8000')
ARTIFACTS = Path(os.environ.get('FUGAMES_SCREENSHOTS', '/tmp/fugames-bridge-review'))
ARTIFACTS.mkdir(parents=True, exist_ok=True)


def snapshot(page):
    return page.evaluate('BridgeUI.snapshot()')


def fits(page):
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Horizontal overflow'


def activate(page, selector, mobile):
    locator = page.locator(selector)
    locator.tap() if mobile else locator.click()


def until_human(page):
    for _ in range(40):
        state = snapshot(page)
        if state['human'] or state['phase'] == 'complete':
            return state
        page.clock.run_for(800)
    raise AssertionError('AI did not finish turn: ' + str(snapshot(page)))


with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
    errors, failed = [], []
    for width, height, label, seed in [(1366,900,'desktop',1),(390,844,'mobile-dummy',52),(320,568,'narrow',1),(844,390,'landscape',52),(390,844,'mobile-defense',3)]:
        mobile = label != 'desktop'
        context = browser.new_context(viewport={'width':width,'height':height},is_mobile=mobile,has_touch=mobile)
        context.add_init_script(f'Math.random=()=>0; Date.now=()=>{seed};')
        page = context.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda msg: errors.append(msg.text) if msg.type=='error' else None)
        page.on('requestfailed', lambda request: failed.append(request.url))
        page.clock.install()
        page.clock.set_fixed_time(seed / 1000)
        page.goto(BASE+'/duplicate_bridge.html')
        fits(page)
        page.screenshot(path=str(ARTIFACTS/f'bridge-ready-{label}.png'),full_page=True)
        activate(page,'#start',mobile)
        # Blur cancels outstanding timer; resuming is always explicit.
        page.evaluate("window.dispatchEvent(new Event('blur'))")
        frozen = snapshot(page)
        assert frozen['paused']
        page.clock.run_for(4000)
        assert snapshot(page)==frozen
        activate(page,'#pause',mobile)
        until_human(page)
        activate(page,'#hint',mobile)
        assert 'AI 建議' in page.locator('#status').inner_text()
        # The complete legal bid selector supports 7NT. This is intentionally a
        # boundary test, not the recommended contract for this random hand.
        if label=='mobile-defense':
            for _ in range(20):
                state=until_human(page)
                if state['phase']!='auction': break
                activate(page,'#pass',mobile)
        else:
            page.locator('#bid-level').select_option('7')
            page.locator('#bid-strain').select_option('4')
            activate(page,'#bid',mobile)
        state=until_human(page)
        assert state['phase']=='play', state
        assert state['contract']['declarer'] == (1 if label=='mobile-defense' else 0 if seed==52 else 2)
        if label=='mobile-defense':
            assert page.locator('#seat-0 .mini-card').count()==0, 'Defender must never see hidden partner hand'
        else:
            assert page.locator('#seat-0 .mini-card').count()>0, 'Dummy/declarer partner must be visible after lead'
        if seed==52:
            assert '你是夢家' in page.locator('#status').inner_text()
        page.screenshot(path=str(ARTIFACTS/f'bridge-playing-{label}.png'),full_page=True)
        entered = False
        for _ in range(70):
            state=until_human(page)
            if state['phase']=='complete': break
            assert not state['paused']
            cards=page.locator('#hand button:not(:disabled)')
            assert cards.count()>0
            if not mobile and not entered:
                cards.first.focus()
                page.keyboard.press('ArrowRight')
                assert page.evaluate("document.activeElement.matches('#hand button:not(:disabled)')")
                page.keyboard.press('Enter')
                entered=True
            else:
                cards.first.tap() if mobile else cards.first.click()
            fits(page)
        state=snapshot(page)
        assert state['phase']=='complete' and state['played']==52, state
        assert state['score'] is not None and state['baselineScore'] is not None
        assert page.locator('#result').is_visible()
        assert 'AI 桌 NS' in page.locator('#result').inner_text()
        assert page.locator('.score-compare strong').count()==3
        page.screenshot(path=str(ARTIFACTS/f'bridge-result-{label}.png'),full_page=True)
        # An old callback cannot score or play cards after a restart.
        activate(page,'#restart',mobile)
        state=snapshot(page)
        assert state['board']==1 and state['played']==0 and state['auction']==0
        page.keyboard.press('p')
        assert snapshot(page)['paused']
        frozen=snapshot(page)
        page.clock.run_for(5000)
        assert snapshot(page)==frozen
        activate(page,'#pause',mobile)
        until_human(page)
        assert snapshot(page)['played']==0
        fits(page)
        context.close()
        print(label+': complete 52-card game, score comparison, keyboard/touch, pause, restart, no overflow')
    browser.close()
    assert not errors, errors
    assert not failed, failed
    print(f'No console/page errors or failed requests. Screenshots: {ARTIFACTS}')
