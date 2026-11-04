'use strict';
// Chromium playtest for 效果貪食蛇 (full-screen three.js stage). Serves the repository itself,
// plays with real keyboard / touch input on desktop 1440x900 and phone 390x844, finishes a match
// to its result screen and checks the career is saved. Screenshots land in [outDir].
//   node tests/effect-snake-browser.cjs [outDir]
// Env: CHROMIUM_PATH (optional).
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const out = path.resolve(process.argv[2] || '/tmp/fugames-effect-snake');
fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
});
const errors = [];
function watch(page, tag) {
  page.on('pageerror', e => errors.push(`${tag}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`${tag}: ${m.text()}`); });
  page.on('request', r => { if (!r.url().startsWith('http://127.0.0.1')) errors.push(`${tag}: network ${r.url()}`); });
}
const noScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight);
// Keep the player alive on autopilot so the match reaches its clock (the engine's own AI steers).
const autopilot = page => page.evaluate(() => { window.__auto = setInterval(() => { if (game.phase === 'running') { game.setDirection(game.aiDirection(game.actors[0])); if (game.actors[0].shield < 3) game.actors[0].shield = 6; } }, 40); });
async function finish(page) {
  await page.evaluate(() => { game.tick = Math.max(game.tick, EffectSnake.MATCH_TICKS - 25); });
  await page.waitForFunction(() => game.phase === 'over', null, { timeout: 15000 });
  await page.waitForFunction(() => !document.getElementById('overlay').hidden && document.getElementById('overlay').dataset.mode === 'result');
}

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/effect_snake.html`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

  // ---------- Desktop ----------
  const desk = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watch(desk, 'desktop');
  await desk.goto(base);
  await desk.waitForFunction(() => window.SnakeView && window.SnakeApp);
  assert.equal(await desk.evaluate(() => document.getElementById('overlay').dataset.mode), 'lobby');
  assert.ok(await noScroll(desk));
  // Locked picks cannot be chosen at level 1; the default options are the original rules.
  assert.equal(await desk.locator('[data-tier="3"]').isDisabled(), true);
  assert.equal(await desk.locator('[data-mod="shrink"]').isDisabled(), true);
  assert.deepEqual(await desk.evaluate(() => game.options), { tier: 1, modifiers: { powerups: false, feast: false, venom: false, shrink: false } });
  // A seasoned profile unlocks every tier and rule.
  await desk.evaluate(() => localStorage.setItem(SnakeCareer.KEY, JSON.stringify({ xp: 4000, matches: 2 })));
  await desk.reload();
  await desk.waitForFunction(() => window.SnakeView);
  await desk.locator('[data-tier="2"]').click();
  for (const id of ['powerups', 'shrink']) await desk.locator(`[data-mod="${id}"]`).click();
  assert.deepEqual(await desk.evaluate(() => [game.options.tier, game.options.modifiers.powerups, game.options.modifiers.shrink]), [2, true, true]);
  await desk.waitForTimeout(500);
  await desk.screenshot({ path: path.join(out, 'desktop-lobby.png') });
  await desk.locator('#play').click();
  assert.equal(await desk.evaluate(() => game.phase), 'running');
  await desk.keyboard.press('ArrowDown');
  await desk.waitForFunction(() => game.actors[0].dir === 2);
  await desk.keyboard.press('a');
  await desk.waitForFunction(() => game.actors[0].dir === 3);
  await desk.keyboard.press('p');
  assert.equal(await desk.evaluate(() => game.phase), 'paused');
  const frozen = await desk.evaluate(() => game.tick);
  await desk.waitForTimeout(300);
  assert.equal(await desk.evaluate(() => game.tick), frozen);
  assert.equal(await desk.evaluate(() => document.getElementById('overlay').dataset.mode), 'pause');
  await desk.locator('#resume').click();
  assert.equal(await desk.evaluate(() => game.phase), 'running');
  await desk.evaluate(() => window.dispatchEvent(new Event('blur')));
  assert.equal(await desk.evaluate(() => game.phase), 'paused');
  await desk.evaluate(() => window.dispatchEvent(new Event('focus')));
  assert.equal(await desk.evaluate(() => game.phase), 'paused', 'focus must not resume automatically');
  await desk.locator('#resume').click();
  // Holding space with enough mass boosts and spends mass.
  await desk.evaluate(() => { const a = game.actors[0]; a.targetLength = 10; a.slow = 0; });
  await autopilot(desk);
  await desk.keyboard.down(' ');
  await desk.waitForFunction(() => game.events.some(e => e.type === 'boost' && e.actor === 0) || game.actors[0].targetLength < 10, null, { timeout: 5000 });
  await desk.keyboard.up(' ');
  // The menu pauses the run; Escape closes it.
  await desk.locator('#menu-btn').click();
  assert.equal(await desk.evaluate(() => game.phase), 'paused');
  assert.ok(await desk.locator('#drawer').evaluate(el => el.classList.contains('is-open')));
  await desk.locator('#tab-settings').click();
  assert.ok(await desk.locator('#panel-settings').isVisible());
  await desk.keyboard.press('Escape');
  assert.ok(!(await desk.locator('#drawer').evaluate(el => el.classList.contains('is-open'))));
  await desk.locator('#resume').click();
  await desk.waitForTimeout(2600);
  await desk.screenshot({ path: path.join(out, 'desktop-play.png') });
  // Arena closes after 50 s: jump close to it and watch the ring seal.
  await desk.evaluate(() => { game.tick = EffectSnake.SHRINK_START - 4; });
  await desk.waitForFunction(() => game.closed >= 1 || game.phase === 'over', null, { timeout: 8000 });
  await finish(desk);
  const result = await desk.evaluate(() => ({ outcome: game.result.outcome, title: document.getElementById('result-title').textContent, xp: document.getElementById('xp-lines').textContent, saved: JSON.parse(localStorage.getItem(SnakeCareer.KEY)) }));
  assert.ok(['win', 'loss', 'out'].includes(result.outcome));
  assert.ok(result.title.length > 0 && /XP/.test(result.xp));
  assert.equal(result.saved.matches, 3, 'career records the finished match');
  await desk.waitForTimeout(400);
  await desk.screenshot({ path: path.join(out, 'desktop-result.png') });
  await desk.locator('#again').click();
  assert.deepEqual(await desk.evaluate(() => [game.phase, game.actors[0].score, game.actors[0].body.length, game.tick < 20]), ['running', 0, 4, true]);
  await desk.close();

  // ---------- Phone (touch) ----------
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const phone = await ctx.newPage();
  watch(phone, 'phone');
  await phone.goto(base);
  await phone.waitForFunction(() => window.SnakeView);
  assert.ok(await noScroll(phone));
  await phone.screenshot({ path: path.join(out, 'phone-lobby.png') });
  await phone.locator('#play').tap();
  assert.equal(await phone.evaluate(() => game.phase), 'running');
  const box = await phone.locator('#board').boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height * .45;
  const cdp = await ctx.newCDPSession(phone);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 60, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await phone.waitForFunction(() => game.actors[0].dir === 1);
  await phone.locator('[data-direction=down]').tap();
  await phone.waitForFunction(() => game.actors[0].dir === 2);
  // Every control sits clear of the board area and inside the viewport.
  const rects = await phone.evaluate(() => ['#boost', '.dpad', '#clock-hud', '.roster-hud'].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return [s, r.left, r.right, r.top, r.bottom]; }));
  for (const [s, l, r, t, b] of rects) assert.ok(l >= 0 && r <= 390 && t >= 0 && b <= 844, `${s} inside viewport`);
  await autopilot(phone);
  await phone.waitForTimeout(2600);
  await phone.screenshot({ path: path.join(out, 'phone-play.png') });
  await phone.locator('#pause').tap();
  assert.equal(await phone.evaluate(() => game.phase), 'paused');
  await phone.locator('#resume').tap();
  assert.equal(await phone.evaluate(() => game.phase), 'running');
  await finish(phone);
  await phone.waitForTimeout(400);
  await phone.screenshot({ path: path.join(out, 'phone-result.png') });
  assert.ok(await noScroll(phone));
  for (const vp of [{ width: 320, height: 700 }, { width: 844, height: 390 }]) { await phone.setViewportSize(vp); await phone.waitForTimeout(150); assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no horizontal scroll at ${vp.width}`); }
  await browser.close();
  server.close();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'passed', screenshots: out, checks: ['desktop keyboard + WASD', 'pause / blur manual resume', 'space boost', 'drawer + Escape', 'shrinking arena', 'result + career save', 'phone CDP swipe + d-pad', 'phone pause / result', '320 / 844 widths', 'no network'] }));
})().catch(e => { console.error(e); console.error(errors); server.close(); process.exit(1); });
