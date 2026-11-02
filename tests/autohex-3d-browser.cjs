'use strict';
// Chromium playtest for AutoHex-3D. Serves the repository, plays with real
// mouse / touch input through the 3D canvas, then replays the page's complete
// action log in the Node AutoHex engine and requires an identical game.
//   node tests/autohex-3d-browser.cjs [outDir]
// Env: CHROMIUM_PATH (optional), AUTOHEX3D_FULL=1 also runs a full 10-minute spectator campaign.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const E = require('../autohex-engine.js');
const root = path.resolve(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(root, 'docs/autohex-3d-2026-11-02'));
fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
});

function replay(recipe, log) {
  const g = new E.Game(recipe); g.start();
  for (const entry of log) {
    assert.equal(g.turn, entry.player, `turn order at ply ${entry.ply}`);
    assert.ok(g.act(entry.action), `engine rejected logged ${entry.action.type} at ply ${entry.ply}`);
  }
  return g;
}
async function snapshot(page) {
  return page.evaluate(() => { const h = autoHex3D, g = h.game; return { recipe: h.recipe(), log: h.actionLog, board: Array.from(g.board), reserve: Array.from(g.reserve), scores: g.players.slice(1).map(p => p.score), ply: g.ply, phase: g.phase, stats: { ...h.stats } }; });
}
function assertSame(page, data) {
  const g = replay(data.recipe, data.log);
  assert.deepEqual(Array.from(g.board), data.board, 'board differs from engine replay');
  assert.deepEqual(Array.from(g.reserve), data.reserve, 'field reserves differ from engine replay');
  assert.deepEqual(g.players.slice(1).map(p => p.score), data.scores, 'scores differ from engine replay');
  return g;
}
// One supply-minded decision, chosen from public information on the page and
// then executed with real pointer input on the 3D canvas.
async function decide(page) {
  return page.evaluate(() => {
    const h = autoHex3D, v = h.view, E = h.E, L = h.L, me = h.human, pl = v.players[me];
    const forward = i => -E.CELLS[i][pl.axis] * pl.sign;
    const supplied = new Set(); for (let i = 0; i < E.COUNT; i++) if (v.board[i] === me && v.supplied[i]) supplied.add(i);
    const try_ = (type, k, score) => { h.select(type, k); const legal = h.legal; if (!legal.length) return null; legal.sort((a, b) => score(b) - score(a)); return score(legal[0]) > -1e8 ? { type, cell: legal[0] } : null; };
    const targets = [];
    for (const p of E.PLAYERS) if (p !== me) for (const c of L.supplyChokepoints(v, E, p)) targets.push(c);
    const cutValue = new Map(targets.map(c => [c.cell, c.cut]));
    const k = v.hand.indexOf('destroy');
    if (k >= 0 && pl.energy >= 5) { const pick = try_('destroy', k, i => (cutValue.get(i) || 0) >= 3 ? cutValue.get(i) : -1e9); if (pick) return pick; }
    const chokes = new Map(L.supplyChokepoints(v, E, me).map(c => [c.cell, c.cut]));
    const s = v.hand.indexOf('shield');
    if (s >= 0 && pl.energy >= 4) { const pick = try_('shield', s, i => (chokes.get(i) || 0) >= 4 ? chokes.get(i) : -1e9); if (pick) return pick; }
    const deploy = try_('deploy', undefined, i => {
      const linked = E.ADJ[i].filter(j => supplied.has(j)).length; if (!linked) return -1e9;
      return forward(i) * 3 + linked + (v.board[i] ? 2 : 0) + (v.terrain[i] === 2 ? -4 : 0);
    });
    if (deploy) return deploy;
    h.select('deploy'); return null;
  });
}
async function click(page, cell, touch = false) {
  await page.evaluate(i => autoHex3D.focus(i, 20), cell);
  await page.waitForTimeout(60);
  const p = await page.evaluate(i => autoHex3D.cellScreen(i), cell);
  if (touch) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y);
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const report = { browser: browser.version(), cases: [] };
  try {
    // 1. Desktop: human command with mouse, queue, timeout, layers, pause.
    {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); const errors = [];
      page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto(base + '/autohex_3d.html');
      assert.equal(await page.evaluate(() => autoHex3D.webgl), true, 'WebGL2 unavailable');
      await page.screenshot({ path: path.join(out, 'desktop-ready.png') });
      await page.selectOption('#step-seconds', '0.1');
      await page.click('#play');
      let turns = 0, queued = 0, actions = {};
      const started = Date.now();
      while (turns < 30 && Date.now() - started < 240000) {
        const s = await page.evaluate(() => ({ my: autoHex3D.game.turn === autoHex3D.human && autoHex3D.game.phase === 'running', q: autoHex3D.queue.length }));
        if (!s.my) {
          if (turns === 10 && !queued) { // plan two orders during the AI's turns
            const pick = await decide(page);
            if (pick) { await click(page, pick.cell); queued++; }
            await page.click('#rest'); queued++;
          }
          await page.waitForTimeout(50); continue;
        }
        if (s.q) { await page.waitForTimeout(400); continue; }
        const pick = await decide(page);
        if (pick) { await click(page, pick.cell); actions[pick.type] = (actions[pick.type] || 0) + 1; } else { await page.click('#rest'); actions.rest = (actions.rest || 0) + 1; }
        await page.waitForFunction(() => autoHex3D.game.turn !== autoHex3D.human || autoHex3D.game.phase !== 'running');
        turns++;
        if (turns === 15) { await page.click('#layer-position'); await page.click('#layer-plan'); await page.locator('#viewport').screenshot({ path: path.join(out, 'desktop-midgame.png') }); }
      }
      const queueRuns = await page.evaluate(() => autoHex3D.actionLog.filter(e => e.source === 'queue').length);
      assert.ok(queueRuns >= 1, 'no queued order executed');
      await page.evaluate(() => autoHex3D.focus(autoHex3D.view.players[autoHex3D.human].home, 46));
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(out, 'desktop-command.png') });
      // Command window: do nothing on our turn → automatic rest.
      await page.selectOption('#command-window', '12');
      await page.waitForFunction(() => autoHex3D.actionLog.some(e => e.source === 'timeout'), null, { timeout: 90000 });
      // Pause freezes the clock.
      await page.click('#pause'); const t1 = await page.evaluate(() => autoHex3D.game.activeMs);
      await page.waitForTimeout(1200); const t2 = await page.evaluate(() => autoHex3D.game.activeMs);
      assert.equal(t1, t2, 'clock advanced while paused'); await page.click('#pause');
      const data = await snapshot(page); assertSame(page, data);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.equal(overflow, 0); assert.deepEqual(errors, []);
      report.cases.push({ name: 'desktop-1440-human', humanTurns: turns, humanActions: actions, queued, queueRuns, timeoutRests: data.log.filter(e => e.source === 'timeout').length, plies: data.ply, scores: data.scores, replayIdentical: true, overflow, errors });
      await page.close();
    }
    // 2. Spectator: six AIs, replay must match.
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      await page.goto(base + '/autohex_3d.html');
      await page.selectOption('#match-mode', 'spectator'); await page.selectOption('#step-seconds', '0.1'); await page.fill('#seed', 'autohex3d-spectate'); await page.locator('#seed').dispatchEvent('change');
      await page.click('#play');
      await page.waitForFunction(() => autoHex3D.game.ply >= 300, null, { timeout: 240000 });
      await page.click('#pause');
      await page.evaluate(() => autoHex3D.focus(autoHex3D.E.index(0, 0), 62)); await page.waitForTimeout(300);
      await page.locator('#viewport').screenshot({ path: path.join(out, 'spectator-overview.png') });
      const data = await snapshot(page); assertSame(page, data); assert.deepEqual(errors, []);
      report.cases.push({ name: 'desktop-1280-spectator', plies: data.ply, scores: data.scores, activeSeconds: Math.round((await page.evaluate(() => autoHex3D.game.activeMs)) / 1000), replayIdentical: true, errors });
      await page.close();
    }
    // 3. Phones: touch taps on the canvas, no horizontal overflow.
    for (const [width, height] of [[390, 844], [320, 640]]) {
      const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
      const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
      await page.goto(base + '/autohex_3d.html');
      await page.selectOption('#step-seconds', '0.1'); await page.click('#play');
      let taps = 0;
      for (let k = 0; k < 4; k++) {
        await page.waitForFunction(() => autoHex3D.game.turn === autoHex3D.human, null, { timeout: 30000 });
        await page.locator('#viewport').scrollIntoViewIfNeeded();
        const pick = await decide(page); if (!pick) break;
        const before = await page.evaluate(() => autoHex3D.actionLog.length);
        await click(page, pick.cell, true);
        await page.waitForFunction(n => autoHex3D.actionLog.length > n, before, { timeout: 5000 }); taps++;
      }
      await page.waitForTimeout(400);
      await page.locator('#viewport').screenshot({ path: path.join(out, `phone-${width}.png`) });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const data = await snapshot(page); assertSame(page, data);
      assert.ok(taps >= 3); assert.equal(overflow, 0); assert.deepEqual(errors, []);
      report.cases.push({ name: `phone-${width}`, touchCommands: taps, plies: data.ply, replayIdentical: true, overflow, errors });
      await ctx.close();
    }
    // 4. Optional: one complete ten-minute campaign through the result panel.
    if (process.env.AUTOHEX3D_FULL) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      await page.goto(base + '/autohex_3d.html');
      await page.selectOption('#match-mode', 'spectator'); await page.selectOption('#step-seconds', '0.25'); await page.fill('#seed', 'autohex3d-full'); await page.locator('#seed').dispatchEvent('change');
      await page.click('#play');
      await page.waitForFunction(() => autoHex3D.game.phase === 'over', null, { timeout: 700000, polling: 1000 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(out, 'full-campaign-result.png') });
      const data = await snapshot(page); assertSame(page, data);
      const result = await page.evaluate(() => autoHex3D.game.result);
      const telemetry = await page.evaluate(() => { const t = autoHex3D.game.telemetry; return { captures: t.captures, destroyed: t.destroyed, supplyRetreats: t.supplyRetreats, goalArrivals: t.goalArrivals, cardsUsed: t.cardsUsed, turretShots: t.turretShots, airdrops: t.airdrops, bombardments: t.bombardments, reshuffles: t.reshuffles }; });
      assert.equal(await page.locator('#result').isVisible(), true); assert.deepEqual(errors, []);
      report.cases.push({ name: 'full-campaign-spectator', plies: data.ply, standings: result.standings, telemetry, replayIdentical: true, errors });
      await page.close();
    }
  } finally { await browser.close(); server.close(); }
  fs.writeFileSync(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); server.close(); process.exit(1); });
