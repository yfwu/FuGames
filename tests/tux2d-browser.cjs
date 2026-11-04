'use strict';
/* Tux 2D browser checks in real Chromium (WebGL via SwiftShader).
   Serve the repo first:  python3 -m http.server 8105 --bind 127.0.0.1
   Run:  NODE_PATH=$(npm root -g) node tests/tux2d-browser.cjs   (FUGAMES_BASE_URL, TUX_OUT optional)
   Real keyboard / touch input drives the game; explicit fixtures are labelled. Ends with two full
   keyboard-driven races (desktop 1440x900 and phone 390x844) played to the result screen. */
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
let playwright;
try { playwright = require('playwright'); } catch (e) { playwright = require(path.join(require('node:child_process').execSync('npm root -g').toString().trim(), 'playwright')); }
const BASE = process.env.FUGAMES_BASE_URL || 'http://127.0.0.1:8105';
const OUT = process.env.TUX_OUT || path.join(os.tmpdir(), 'tux2d-browser'); fs.mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const report = { checks: [], errors: [] };
const check = (name, ok) => { assert.ok(ok, name); report.checks.push(name); };
const watch = p => { p.on('pageerror', e => report.errors.push(String(e))); p.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); }); };

// A bounded observation-driven driver that only presses real keys.
async function drive(page, { touch = false, shotAt = null, shotPath = null, maxSteps = 900 } = {}) {
  let held = null; const routes = new Set();
  const press = async (key, down) => {
    if (!touch) { if (down) await page.keyboard.down(key); else await page.keyboard.up(key); return; }
    const id = key === 'ArrowLeft' ? '#touch-left' : '#touch-right';
    await page.dispatchEvent(id, down ? 'pointerdown' : 'pointerup', { pointerId: 7, isPrimary: true, pointerType: 'touch' });
  };
  for (let i = 0; i < maxSteps; i++) {
    const v = await page.evaluate(() => ({ r: tux2dGame.racers[0], objects: tux2dGame.objects.filter(o => o.type !== 'energy'), phase: tux2dGame.phase }));
    if (v.phase === 'over') break;
    const r = v.r, local = r.z % 2400, stage = Math.floor(Math.max(0, r.z) / 2400);
    let target = stage !== 1 ? -.58 : .58;
    const threats = v.objects.filter(o => o.z - r.z > 0 && o.z - r.z < 180 && Math.abs(o.x - r.x) < .3);
    if (threats.length) { const o = threats[0]; const fork = local > 900 && local < 1550; target = fork && r.route === 'supply' ? (o.x > -.55 ? -.85 : -.27) : fork ? (o.x < .55 ? .85 : .27) : (o.x > 0 ? -.6 : .6); }
    const key = target - r.x > .1 ? 'ArrowRight' : target - r.x < -.1 ? 'ArrowLeft' : null;
    if (key !== held) { if (held) await press(held, false); if (key) await press(key, true); held = key; }
    if (threats.length && r.shield === 0 && r.energy >= 25 && threats[0].z - r.z < 70) { if (touch) await page.dispatchEvent('#action-shield', 'pointerdown'); else await page.keyboard.press('Space'); }
    else if (!threats.length && !(local > 500 && local < 1600) && r.energy >= 70 && r.boost === 0) { if (touch) await page.dispatchEvent('#action-boost', 'pointerdown'); else await page.keyboard.press('Shift'); }
    if (r.route && local > 900 && local < 1550) routes.add(r.route);
    if (shotAt !== null && i === shotAt) await page.screenshot({ path: shotPath });
    await page.waitForTimeout(120);
  }
  if (held) await press(held, false);
  return routes;
}

(async () => {
  const browser = await playwright.chromium.launch({ args: ARGS });
  // ---------- Desktop: controls, fixtures, flow ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }), page = await ctx.newPage(); watch(page);
    await page.goto(BASE + '/tux2d.html?seed=browser-courier');
    await page.waitForFunction(() => window.TuxView && window.TuxView.ready);
    check('lobbyCurtain', await page.evaluate(() => tux2dGame.phase === 'ready' && !document.getElementById('curtain').hidden && document.getElementById('curtain').dataset.mode === 'lobby'));
    check('lockedTiers', await page.locator('#tier-seg button[value="3"]').isDisabled());
    check('noScroll', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight));
    await page.click('#open-run'); await page.waitForTimeout(350);
    check('drawerAboveCurtain', await page.evaluate(() => { const b = document.querySelector('#route-options button').getBoundingClientRect(); return document.elementFromPoint(b.x + 10, b.y + 10).closest('#menu') !== null; }));
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    await page.locator('#tux-play').focus(); await page.keyboard.press('Space');
    check('nativeStartFocus', await page.evaluate(() => document.activeElement.id === 'tux-board' && document.getElementById('curtain').hidden));
    await page.waitForFunction(() => tux2dGame.phase === 'racing', null, { timeout: 15000 });
    const x = await page.evaluate(() => tux2dGame.racers[0].x);
    await page.keyboard.down('ArrowRight');
    await page.waitForFunction(x0 => tux2dGame.racers[0].x > x0 + .1, x, { timeout: 8000 }); await page.keyboard.up('ArrowRight');
    check('keyboardSteering', true);
    await page.waitForFunction(() => tux2dGame.racers[0].cooldown === 0); await page.keyboard.press('Shift');
    await page.waitForFunction(() => tux2dGame.racers[0].boost > 0, null, { timeout: 5000 }); check('keyboardBoost', true);
    await page.keyboard.press('KeyP'); await page.waitForTimeout(150);
    const frozen = await page.evaluate(() => JSON.stringify(tux2dGame.observation())); await page.waitForTimeout(250);
    check('pauseFreezesEverything', frozen === await page.evaluate(() => JSON.stringify(tux2dGame.observation())) && await page.evaluate(() => document.getElementById('curtain').dataset.mode === 'pause'));
    await page.keyboard.press('KeyP'); await page.waitForTimeout(150);
    check('resume', await page.evaluate(() => tux2dGame.phase === 'racing'));
    // Fixture: place the kart before the first fork on the supply side.
    await page.evaluate(() => { Object.assign(tux2dGame.racers[0], { z: 855, x: -.58, speed: 100, energy: 10, cargo: 60 }); tux2dGame.objects = tux2dGame.objects.filter(o => o.type !== 'traffic'); });
    await page.waitForFunction(() => tux2dGame.racers[0].route === 'supply', null, { timeout: 10000 }); check('supplyForkCommitted', true);
    await page.waitForFunction(() => tux2dGame.racers[0].supplied === 0, null, { timeout: 15000 });
    check('supplyActuallyRepairs', await page.evaluate(() => tux2dGame.racers[0].cargo >= 80 && tux2dGame.racers[0].energy >= 55));
    await page.evaluate(() => Object.assign(tux2dGame.racers[0], { z: 3300, x: .58, speed: 100, energy: 100, routeStage: 0 }));
    await page.waitForFunction(() => tux2dGame.racers[0].route === 'express', null, { timeout: 10000 }); check('expressForkCommitted', true);
    await page.waitForFunction(() => tux2dGame.racers[0].cooldown === 0); await page.keyboard.press('Space');
    await page.waitForFunction(() => tux2dGame.racers[0].shield > 0, null, { timeout: 5000 }); check('keyboardShield', true);
    await page.evaluate(() => { const r = tux2dGame.racers[0]; r.invulnerable = 0; tux2dGame.objects.push({ id: 999, type: 'rock', z: r.z + 14, x: r.x, taken: [] }); });
    await page.waitForFunction(() => tux2dGame.telemetry.blocks > 0 && tux2dGame.racers[0].shield === 0, null, { timeout: 5000 }); check('shieldBlocksRoadCollision', true);
    await page.evaluate(() => { const r = tux2dGame.racers[0]; r.cooldown = 0; r.energy = 100; Object.assign(tux2dGame.racers[1], { z: r.z + 70, x: r.x, shield: 0, invulnerable: 0 }); });
    await page.keyboard.press('KeyF');
    await page.waitForFunction(() => tux2dGame.events.some(e => e.racer === 0 && e.type === 'snowball'), null, { timeout: 5000 }); check('snowballFired', true);
    await page.keyboard.press('KeyM'); await page.waitForTimeout(300);
    check('menuPausesRace', await page.evaluate(() => tux2dGame.phase === 'paused' && document.getElementById('menu').classList.contains('is-open')));
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    check('closingMenuShowsPause', await page.evaluate(() => document.getElementById('curtain').dataset.mode === 'pause' && !document.getElementById('curtain').hidden));
    await page.click('#tux-resume');
    await page.evaluate(() => Object.assign(tux2dGame.racers[0], { z: 7197, parcels: 2, speed: 100 }));
    await page.waitForFunction(() => tux2dGame.phase === 'over'); await page.waitForTimeout(900);
    check('finishAndResult', await page.locator('#tux-result').isVisible() && (await page.locator('#tux-result-title').innerText()).includes('3 / 3'));
    check('careerSaved', await page.evaluate(() => JSON.parse(localStorage.getItem('tux2d-career')).runs === 1));
    await page.click('#tux-race-again'); await page.waitForTimeout(150);
    check('restartClearsRun', await page.evaluate(() => tux2dGame.phase === 'countdown' && tux2dGame.racers[0].parcels === 0 && tux2dGame.racers[0].energy === 65));
    await page.waitForFunction(() => tux2dGame.phase === 'racing', null, { timeout: 15000 });
    await page.evaluate(() => { tux2dGame.elapsed = 109.98; });
    await page.waitForFunction(() => tux2dGame.phase === 'over');
    check('timeoutResult', await page.evaluate(() => tux2dGame.result.timeout));
    await page.close(); await ctx.close();
  }
  // ---------- Phone portrait and landscape: layout and simultaneous touch ----------
  for (const [label, width, height] of [['portrait', 390, 844], ['landscape', 844, 390]]) {
    const ctx = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }), p = await ctx.newPage(); watch(p);
    await p.goto(BASE + '/tux2d.html'); await p.waitForFunction(() => window.TuxView && window.TuxView.ready);
    await p.locator('#tux-play').tap(); await p.waitForFunction(() => tux2dGame.phase === 'racing', null, { timeout: 15000 });
    check(label + 'NoHorizontalOverflow', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const inView = async sel => { const b = await p.locator(sel).boundingBox(); return b && b.x >= 0 && b.y >= 0 && b.x + b.width <= width && b.y + b.height <= height; };
    check(label + 'ControlsFit', await inView('#touch-left') && await inView('#touch-right') && await inView('#action-shield') && await inView('#touch-brake'));
    const overlap = await p.evaluate(() => { const r = s => document.querySelector(s).getBoundingClientRect(), hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom; const dock = r('.tux-dock'); return ['#touch-left', '#touch-right', '#touch-brake'].some(s => hit(r(s), dock)); });
    check(label + 'PadsClearOfDock', !overlap);
    const session = await ctx.newCDPSession(p);
    const box = await p.locator('#touch-right').boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2;
    const prior = await p.evaluate(() => tux2dGame.racers[0].x);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await p.waitForFunction(x0 => tux2dGame.racers[0].x > x0 + .1, prior, { timeout: 8000 });
    const a = await p.locator('#action-shield').boundingBox(), ax = a.x + a.width / 2, ay = a.y + a.height / 2;
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }, { x: ax, y: ay, id: 2 }] });
    await p.waitForFunction(() => tux2dGame.events.some(e => e.racer === 0 && e.type === 'shield'), null, { timeout: 5000 });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x, y, id: 1 }] }); await p.waitForTimeout(150);
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    check(label + 'SimultaneousSteerShield', await p.evaluate(() => tux2dGame.events.some(e => e.racer === 0 && e.type === 'shield')) && await p.evaluate(() => tux2dGame.racers[0].x) > prior + .1);
    await p.screenshot({ path: path.join(OUT, label + '.png') });
    await p.locator('#tux-pause').tap(); await p.waitForTimeout(150);
    check(label + 'Pause', await p.evaluate(() => tux2dGame.phase === 'paused'));
    await ctx.close();
  }
  // ---------- Full keyboard (desktop) and touch (phone) races to the result screen ----------
  for (const [label, width, height, touch] of [['desktop', 1440, 900, false], ['phone', 390, 844, true]]) {
    const ctx = await browser.newContext({ viewport: { width, height }, isMobile: touch, hasTouch: touch }), p = await ctx.newPage(); watch(p);
    await p.goto(BASE + '/tux2d.html?seed=' + (touch ? 'phone-run' : 'keyboard-run')); await p.waitForFunction(() => window.TuxView && window.TuxView.ready);
    await p.screenshot({ path: path.join(OUT, label + '-lobby.png') });
    if (touch) await p.locator('#tux-play').tap(); else await p.keyboard.press('Enter');
    await p.waitForFunction(() => tux2dGame.phase === 'racing', null, { timeout: 15000 });
    const routes = await drive(p, { touch, shotAt: 90, shotPath: path.join(OUT, label + '-play.png') });
    await p.waitForFunction(() => tux2dGame.phase === 'over', null, { timeout: 30000 });
    const me = await p.evaluate(() => ({ ...tux2dGame.racers[0], elapsed: tux2dGame.elapsed }));
    report[label] = { parcels: me.parcels, score: me.score, finished: me.finished, cargo: Math.round(me.cargo), time: +me.elapsed.toFixed(1), routes: [...routes] };
    check(label + 'FullRaceDelivers', me.parcels >= 2);
    await p.waitForFunction(() => !document.getElementById('curtain').hidden && document.getElementById('curtain').dataset.mode === 'result', null, { timeout: 5000 });
    check(label + 'ResultXP', (await p.locator('#xp-lines').innerText()).includes('XP'));
    await p.waitForTimeout(400);
    await p.screenshot({ path: path.join(OUT, label + '-result.png') });
    await ctx.close();
  }
  await browser.close();
  check('noBrowserErrors', report.errors.length === 0);
  fs.writeFileSync(path.join(OUT, 'browser.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch(e => { console.error(e); console.error(JSON.stringify(report, null, 2)); process.exit(1); });
