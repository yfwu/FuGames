"""Complete human-mode race using real keyboard controls, never engine mutation.

The route controller reads public observations and emits Playwright key presses.
No virtual clock, raw lap edits, coordinate writes, or direct Game.step calls.
"""
from pathlib import Path
import hashlib, json, math, os, time
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/tux2d-2026-10-11'
BASE = os.environ.get('FUGAMES_BASE_URL', 'http://127.0.0.1:8011')
OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'screenshots').mkdir(exist_ok=True)
report = {'mode': 'real wall-clock human-mode race; public-observation controller emits keyboard input',
          'virtualClock': False, 'engineMutation': False, 'errors': [], 'checkpoints': [], 'laps': [],
          'sourceSha256': {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
                          for name in ['tux2d-engine.js', 'tux2d-ui.js']}}

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'),
                                args=['--no-sandbox'])
    ctx = browser.new_context(viewport={'width': 1440, 'height': 1000})
    p = ctx.new_page()
    p.on('pageerror', lambda e: report['errors'].append(str(e)))
    p.goto(BASE + '/tux2d.html?seed=keyboard-human')
    p.locator('#tux-seed').fill('keyboard-human')
    p.locator('#auto-throttle').uncheck()
    p.locator('#tux-play').click()
    p.wait_for_timeout(450)
    p.keyboard.press('KeyP')
    assert p.evaluate('tux2dGame.phase') == 'paused'
    before = p.evaluate('JSON.stringify(tux2dGame.observation(0))')
    p.wait_for_timeout(650)
    assert p.evaluate('JSON.stringify(tux2dGame.observation(0))') == before
    report['countdownPauseFrozen'] = True
    p.keyboard.press('KeyP')
    p.wait_for_function('tux2dGame.phase === "racing"', timeout=10000)
    p.locator('#tux-board').screenshot(path=str(OUT / 'screenshots/human-start.png'))
    held = set()
    accumulator = {'throttle': 0., 'brake': 0., 'steer': 0.}
    last_gate, last_lap = 0, 0
    samples, key_changes, max_jump = 0, 0, 0.
    last_pos = None
    wall_start = time.monotonic()
    paused_racing = False
    while time.monotonic() - wall_start < 180:
        state = p.evaluate('''() => {
          const view = tux2dGame.observation(0);
          return {view, input:Tux2D.chooseAI(view,0)};
        }''')
        view, desired = state['view'], state['input']
        kart = view['racers'][0]
        assert all(math.isfinite(kart[k]) for k in ['x', 'y', 'angle', 'speed', 'progress'])
        if last_pos:
            max_jump = max(max_jump, math.hypot(kart['x'] - last_pos[0], kart['y'] - last_pos[1]))
        last_pos = (kart['x'], kart['y'])
        if kart['checkpoint'] != last_gate:
            assert kart['checkpoint'] == (last_gate + 1) % 12, (last_gate, kart)
            report['checkpoints'].append({'elapsed': view['elapsed'], 'gatePassed': last_gate,
                                          'nextGate': kart['checkpoint'], 'lap': kart['lap']})
            last_gate = kart['checkpoint']
        if kart['lap'] != last_lap:
            assert kart['lap'] == last_lap + 1
            report['laps'].append({'lap': kart['lap'], 'elapsed': view['elapsed']})
            p.locator('#tux-board').screenshot(path=str(OUT / f'screenshots/human-lap-{kart["lap"]}.png'))
            last_lap = kart['lap']
        if view['phase'] == 'over':
            break
        if view['elapsed'] > 5 and not paused_racing:
            for key in held:
                p.keyboard.up(key)
            held.clear()
            p.locator('#tux-pause').click()
            frozen = p.evaluate('JSON.stringify(tux2dGame.observation(0))')
            p.wait_for_timeout(650)
            assert p.evaluate('JSON.stringify(tux2dGame.observation(0))') == frozen
            p.keyboard.press('Escape')
            report['racingPauseFrozen'] = True
            paused_racing = True
        keys = set()
        if not kart['finished']:
            values = {}
            for axis in accumulator:
                accumulator[axis] += abs(desired[axis])
                values[axis] = 0
                if accumulator[axis] >= .5:
                    accumulator[axis] -= 1
                    values[axis] = 1 if desired[axis] >= 0 else -1
            if values['throttle']:
                keys.add('ArrowUp')
            if values['brake']:
                keys.add('ArrowDown')
            if values['steer']:
                keys.add('ArrowRight' if values['steer'] > 0 else 'ArrowLeft')
            if desired['useItem']:
                keys.add('Space')
        for key in held - keys:
            p.keyboard.up(key); key_changes += 1
        for key in keys - held:
            p.keyboard.down(key); key_changes += 1
        held = keys
        samples += 1
        p.wait_for_timeout(30)
    for key in held:
        p.keyboard.up(key)
    final = p.evaluate('tux2dGame.observation(0)')
    assert final['phase'] == 'over', final
    assert final['racers'][0]['finished'] and final['racers'][0]['lap'] == 3
    assert len(report['checkpoints']) == 37, report['checkpoints']
    assert len(report['laps']) == 3
    assert all(r['finished'] and r['lap'] == 3 for r in final['racers'])
    assert final['telemetry']['checkpoints'] == 185
    assert p.locator('#tux-result').is_visible()
    assert p.evaluate('document.documentElement.scrollWidth <= innerWidth')
    p.screenshot(path=str(OUT / 'screenshots/human-result-desktop.png'), full_page=True)
    report.update({'complete': True, 'wallSeconds': time.monotonic() - wall_start,
                   'samples': samples, 'keyTransitions': key_changes, 'largestObservedMove': max_jump,
                   'humanFinishSeconds': final['racers'][0]['finishTime'], 'result': final['result'],
                   'telemetry': final['telemetry'], 'humanFinal': final['racers'][0], 'overflow': False})
    p.locator('#tux-restart').click()
    reset = p.evaluate('tux2dGame.observation(0)')
    assert reset['elapsed'] == 0 and all(r['lap'] == 0 and r['item'] is None for r in reset['racers'])
    assert not reset['projectiles'] and not reset['hazards'] and reset['result'] is None
    report['restartClean'] = True
    ctx.close()
    browser.close()

assert not report['errors'], report['errors']
(OUT / 'human-browser.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({k: v for k, v in report.items() if k not in ['checkpoints', 'humanFinal']}, ensure_ascii=False, indent=2))
