'use strict';
// Chromium smoke test for HexBattle (not part of the CI suite; needs Playwright):
//   node tests/hexbattle-browser.cjs [outDir]
// 1. 親征: guide strip, best-cell rings, hint → 照做, 代打, then the page's full
//    action log replays in the Node engine to an identical state.
// 2. 直播 via the old URL with stream parameters: redirect, pause, a finished
//    match, the result curtain, and the automatic next match of the series.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const E = require('../hexbattle/engine.js');
const root = path.resolve(__dirname, '..');
const out = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (out) fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
});
const shot = (page, name) => out ? page.screenshot({ path: path.join(out, name) }) : null;

(async () => {
  await new Promise(r => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const errors = [];
  try {
    // ---------------------------------------------------------------- play
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + 'hexbattle.html');
    await page.click('#intro-play');
    await page.waitForFunction(() => HexBattle.myTurn(), null, { timeout: 30000 });
    assert.match(await page.textContent('#guide-text'), /經濟牌|可以打|結束回合/);
    const build = await page.$('.ah-card.is-ready[data-kind="build"]');
    if (build) { await build.click(); assert.match(await page.textContent('#guide-text'), /藍框/); await shot(page, 'play-select.png'); await page.keyboard.press('Escape'); }
    await page.keyboard.press('i');
    assert.match(await page.textContent('#guide-text'), /^提示：/);
    assert.ok(await page.isVisible('#guide-do'));
    await page.click('#guide-do');
    await page.click('#btn-auto');
    await page.waitForFunction(() => HexBattle.state.round >= 2 && HexBattle.myTurn(), null, { timeout: 90000 });
    const rp = await page.evaluate(() => ({ ...HexBattle.replay(), state: JSON.stringify(HexBattle.state) }));
    const g = E.createGame({ seed: rp.seed, players: rp.players, maxRounds: rp.maxRounds, neutrals: rp.neutrals });
    for (const x of rp.actions) assert.ok(E.act(g, x.player, x.action).ok, 'logged action replays');
    assert.equal(JSON.stringify(g), rp.state, 'page game equals engine replay');
    await shot(page, 'play-round2.png');
    await page.close();

    // ---------------------------------------------------------------- stream
    const tv = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    tv.on('pageerror', e => errors.push(e.message));
    await tv.addInitScript(() => { window.__events = []; window.addEventListener('hexbattle', e => window.__events.push(e.detail.type)); });
    await tv.goto(base + 'autohex_3d.html?mode=stream&players=4&speed=fast&rounds=20&intermission=3&seed=tv');
    await tv.waitForFunction(() => window.HexBattle && HexBattle.state, null, { timeout: 15000 });
    assert.match(tv.url(), /hexbattle\.html\?mode=stream/);
    assert.equal(await tv.evaluate(() => document.body.dataset.phase), 'stream');
    assert.ok(!(await tv.isVisible('.fu-topbar')), 'stream layout hides the top bar');
    await tv.waitForTimeout(3000);
    await shot(tv, 'stream.png');
    await tv.keyboard.press(' ');
    const n0 = await tv.evaluate(() => HexBattle.state.log.length); await tv.waitForTimeout(1500);
    assert.equal(await tv.evaluate(() => HexBattle.state.log.length), n0, 'pause stops the match');
    await tv.keyboard.press(' ');
    await tv.click('.hb-specdock [value="skip"]', { force: true });
    await tv.waitForFunction(() => HexBattle.state.phase === 'over', null, { timeout: 240000 });
    await tv.waitForSelector('#result:not([hidden])', { timeout: 10000 }).catch(() => {});
    await tv.waitForTimeout(1800);
    await shot(tv, 'stream-result.png');
    assert.match(await tv.textContent('#result-next'), /下一場/);
    await tv.waitForFunction(() => HexBattle.state.seed === 'tv·2', null, { timeout: 20000 });
    const events = await tv.evaluate(() => [...new Set(window.__events)]);
    for (const t of ['match-start', 'turn', 'round', 'match-end']) assert.ok(events.includes(t), `event ${t}`);
    assert.ok((await tv.evaluate(() => HexBattle.series().matches)) >= 1, 'series recorded');
    await tv.close();
    assert.deepEqual(errors, [], 'no page errors');
    console.log('hexbattle browser: ok');
  } finally {
    await browser.close(); server.close();
  }
})().catch(err => { console.error(err); process.exit(1); });
