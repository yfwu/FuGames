'use strict';
// Chromium check for 立體三子循環棋 (full-screen three.js stage): lobby, preview + confirm
// from the layer map and from the 3D cube, drag rotates, layer focus, a full game against
// the AI to the result curtain, the pie choice, a challenge solve and a PvP space diagonal.
// Needs a local HTTP server:
//   python3 -m http.server 8101 --bind 127.0.0.1 & BASE=http://127.0.0.1:8101 node tests/cyclic-tictactoe-3d-browser.cjs
const { chromium } = require('playwright');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const BASE = process.env.BASE || 'http://127.0.0.1:8101';
const OUT = process.env.OUT || path.join(os.tmpdir(), 'cyclic3d-shots');
fs.mkdirSync(OUT, { recursive: true });
const assert = (ok, msg) => { if (!ok) throw new Error(msg); console.log('ok -', msg); };
const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

async function open(browser, viewport, prefs, label) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: viewport.width < 500 ? 2 : 1 });
  page.on('pageerror', e => errors.push(label + ': ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(label + ': ' + m.text()); });
  if (prefs) await page.addInitScript(p => localStorage.setItem('fugames:cyclic3d', JSON.stringify(p)), prefs);
  await page.goto(BASE + '/cyclic_tictactoe_3d.html');
  await page.waitForFunction(() => window.CyclicCubePage && CyclicCubePage.game);
  return page;
}
const idle = page => page.waitForFunction(() => CyclicCubePage.game.over || (CyclicCubePage.legal().length > 0) || CyclicCubePage.game.pieOpen, null, { timeout: 25000 });
async function tapCell(page, cell) { await page.click(`.c3-grid .cell[data-cell="${cell}"]`); await page.click(`.c3-grid .cell[data-cell="${cell}"]`); }
const errors = [];

(async () => {
  const browser = await chromium.launch({ args: GL });
  for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    const page = await open(browser, viewport, null, label);
    assert(await page.isVisible('#lobby'), label + ': lobby curtain first');
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, `cyclic3d-${label}-lobby.png`) });
    await page.click('#startBtn');
    assert(await page.isHidden('#lobby'), label + ': start closes the lobby');
    assert(await page.locator('.c3-grid .cell').count() === 27, label + ': 27 layer-map cells');
    // Opening in a corner: preview first, then confirm.
    await page.click('.c3-grid .cell[data-cell="0"]');
    assert(await page.evaluate(() => CyclicCubePage.game.ply) === 0, label + ': first tap only previews');
    assert(/預覽/.test(await page.textContent('#info')), label + ': preview status');
    await page.click('#confirmMove');
    assert(await page.evaluate(() => CyclicCubePage.game.ply) === 1, label + ': confirm places the stone');
    await page.waitForFunction(() => CyclicCubePage.game.ply === 2 && !CyclicCubePage.busy, null, { timeout: 25000 });
    assert(true, label + ': AI kept its seat and replied (a corner opening is not swapped)');
    // A drag rotates the view instead of placing.
    const box = await page.locator('#cube').boundingBox();
    const mid = await page.evaluate(() => CyclicCubePage.project(13));
    await page.mouse.move(mid.x, mid.y); await page.mouse.down();
    await page.mouse.move(mid.x + 120, mid.y + 30, { steps: 8 }); await page.mouse.up();
    assert(await page.evaluate(() => CyclicCubePage.game.ply) === 2, label + ': dragging the cube does not play');
    await page.waitForTimeout(500);
    // Tap a top-layer cell directly on the 3D cube twice: preview, then place.
    const top = await page.evaluate(() => CyclicCubePage.legal().filter(c => c >= 18));
    let placed = false;
    for (const cell of top) {
      const p = await page.evaluate(c => CyclicCubePage.project(c), cell);
      if (p.x < box.x + 10 || p.y < box.y + 10 || p.x > box.x + box.width - 10) continue;
      await page.mouse.click(p.x, p.y);
      const sel = await page.evaluate(() => /預覽/.test(document.getElementById('info').textContent));
      if (!sel) continue;
      await page.mouse.click(p.x, p.y);
      placed = await page.evaluate(c => CyclicCubePage.game.board[c] !== 0 || CyclicCubePage.game.moves.some(m => m.to === c), cell);
      if (placed) break;
    }
    assert(placed, label + ': tapping the 3D cube previews and places a stone');
    await idle(page);
    // Layer focus from the map tab and the hotkey.
    await page.click('.c3-layer[data-layer="2"] .c3-layer__tab');
    assert(await page.getAttribute('.c3-layer[data-layer="2"] .c3-layer__tab', 'aria-pressed') === 'true', label + ': layer focus on');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `cyclic3d-${label}-focus.png`) });
    await page.keyboard.press('0');
    assert(await page.getAttribute('.c3-layer[data-layer="2"] .c3-layer__tab', 'aria-pressed') === 'false', label + ': 0 shows every layer');
    // Play the rest with engine moves through the layer map until the game ends.
    let turns = 0, shot = false;
    while (!(await page.evaluate(() => CyclicCubePage.game.over)) && turns++ < 80) {
      await idle(page);
      if (await page.evaluate(() => CyclicCubePage.game.over)) break;
      const cell = await page.evaluate(() => CyclicCube.chooseMove(CyclicCubePage.game, { level: 'easy', timeMs: 120 }).cell);
      await page.click(`.c3-grid .cell[data-cell="${cell}"]`);
      if (!shot && turns >= 3) { await page.waitForTimeout(350); await page.screenshot({ path: path.join(OUT, `cyclic3d-${label}-play.png`) }); shot = true; }
      await page.click(`.c3-grid .cell[data-cell="${cell}"]`);
    }
    assert(await page.evaluate(() => CyclicCubePage.game.over), label + ': the game reached an end in ' + turns + ' human moves');
    await page.waitForSelector('#result:not([hidden])', { timeout: 12000 });
    assert(/經驗/.test(await page.textContent('#resultXp')), label + ': result shows XP');
    assert(await page.evaluate(() => CyclicCubePage.profile.games) === 1, label + ': career recorded one game');
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, `cyclic3d-${label}-result.png`) });
    await page.click('#viewBoardBtn');
    assert(await page.isHidden('#result'), label + ': result can be closed to inspect the board');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert(overflow <= 0, label + ': no horizontal scroll');
    const scrolled = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    assert(scrolled <= 0, label + ': no page scroll');
    const small = await page.evaluate(() => Math.min(...[...document.querySelectorAll('.c3-grid .cell')].map(b => b.getBoundingClientRect().width)));
    assert(small >= 28, label + ': layer cells ' + small.toFixed(1) + 'px wide');
    await page.close();
  }

  // Pie rule: as the second seat, the AI opens and the human may take over.
  {
    const page = await open(browser, { width: 1440, height: 900 }, { seat: '1' }, 'pie');
    await page.click('#startBtn');
    await page.waitForSelector('#piePanel:not([hidden])', { timeout: 25000 });
    assert(true, 'pie: choice shown to the human second seat');
    await page.click('#pieSwap');
    assert(await page.evaluate(() => CyclicCubePage.game.swapped && CyclicCubePage.game.colorOf(1) === CyclicCube.BLACK), 'pie: swap gives the human the first stone');
    await page.waitForFunction(() => CyclicCubePage.game.ply === 2, null, { timeout: 25000 });
    assert(true, 'pie: AI moves as the second colour after the swap');
    await page.screenshot({ path: path.join(OUT, 'cyclic3d-pie.png') });
    await page.close();
  }

  // Challenge 01: the key move, then the finishing move, solves it.
  {
    const page = await open(browser, { width: 390, height: 844 }, null, 'challenge');
    await page.click('#lobbyChallenges');
    assert(await page.isEnabled('.c3-puz[data-puzzle="p01"]') && !(await page.isEnabled('.c3-puz[data-puzzle="p02"]')), 'challenge: only the first one is open');
    await page.screenshot({ path: path.join(OUT, 'cyclic3d-challenges.png') });
    await page.click('.c3-puz[data-puzzle="p01"]');
    const key = await page.evaluate(() => CyclicCube.PUZZLES[0].key);
    await idle(page); await tapCell(page, key); await idle(page);
    const finish = await page.evaluate(() => CyclicCube.forcedWin(CyclicCubePage.game, 1));
    await tapCell(page, finish);
    await page.waitForSelector('#result:not([hidden])', { timeout: 12000 });
    assert(/破解成功/.test(await page.textContent('#resultTitle')), 'challenge: solved');
    assert(await page.evaluate(() => CyclicCubePage.profile.solved.includes('p01')), 'challenge: saved as solved');
    await page.screenshot({ path: path.join(OUT, 'cyclic3d-challenge-result.png') });
    await page.click('#againBtn');
    assert(await page.evaluate(() => CyclicCubePage.config.puzzle.id) === 'p02', 'challenge: next puzzle opens');
    await page.close();
  }

  // PvP: a scripted space diagonal is announced and drawn.
  {
    const page = await open(browser, { width: 1440, height: 900 }, { mode: 'pvp' }, 'pvp');
    await page.click('#startBtn');
    await tapCell(page, 5);
    await page.click('#pieKeep');
    for (const c of [1, 0, 2, 13, 3, 26]) await tapCell(page, c);
    const status = await page.textContent('#info');
    assert(/空間對角線/.test(status) && /獲勝/.test(status), 'pvp: space-diagonal win announced: ' + status);
    await page.waitForSelector('#result:not([hidden])', { timeout: 12000 });
    assert(/玩家一勝/.test(await page.textContent('#resultTitle')), 'pvp: result names the winner');
    await page.close();
  }
  await browser.close();
  assert(!errors.length, 'no page errors ' + errors.join(' | '));
  console.log('screenshots in', OUT);
})().catch(e => { console.error(e); console.error(errors.join('\n')); process.exit(1); });
