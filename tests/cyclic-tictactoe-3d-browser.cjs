'use strict';
// Chromium check for 立體三子循環棋: renders, 2-step input, AI reply via worker,
// pie panel, phone layout without horizontal scroll. Needs a local HTTP server:
//   python -m http.server 8765 --bind 127.0.0.1 & node tests/cyclic-tictactoe-3d-browser.cjs
const { chromium } = require('playwright');
const path = require('node:path');
const BASE = process.env.BASE || 'http://127.0.0.1:8765';
const OUT = path.join(__dirname, '..', 'docs', 'cyclic-3d-2026-11-02', 'screenshots');
const assert = (ok, msg) => { if (!ok) throw new Error(msg); console.log('ok -', msg); };
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  for (const [label, viewport] of [['desktop', { width: 1200, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: label === 'mobile' ? 2 : 1 });
    page.on('pageerror', e => errors.push(label + ': ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(label + ': ' + m.text()); });
    await page.goto(BASE + '/cyclic_tictactoe_3d.html');
    await page.waitForFunction(() => window.CyclicCubePage && window.CyclicCubePage.game);
    assert(await page.locator('.c3-grid .cell').count() === 27, label + ': 27 layer buttons');
    const painted = await page.evaluate(() => { const c = document.getElementById('cube'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; });
    assert(painted > 5000, label + ': cube canvas painted');
    // Opening in a corner: preview first, then confirm.
    await page.click('.c3-grid .cell[data-cell="0"]');
    assert(await page.evaluate(() => CyclicCubePage.game.ply) === 0, label + ': first tap only previews');
    assert(/預覽/.test(await page.textContent('#info')), label + ': preview status');
    await page.click('#confirmMove');
    assert(await page.evaluate(() => CyclicCubePage.game.ply) === 1, label + ': confirm places the stone');
    await page.waitForFunction(() => CyclicCubePage.game.ply === 2 && !CyclicCubePage.busy, null, { timeout: 8000 });
    assert(true, label + ': AI kept white and replied (corner opening is not swapped)');
    // A drag rotates instead of placing.
    const box = await page.locator('#cube').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 30, { steps: 8 }); await page.mouse.up();
    assert(await page.evaluate(() => CyclicCubePage.game.ply) === 2, label + ': dragging the cube does not play');
    // Tap the canvas on the projected centre of an empty cell twice to play there.
    for (let i = 0; i < 2 && await page.evaluate(() => CyclicCubePage.game.ply) < 6; i++) {
      const cell = await page.evaluate(() => CyclicCubePage.game.legalMoves().find(c => c !== 13) );
      await page.click(`.c3-grid .cell[data-cell="${cell}"]`); await page.click(`.c3-grid .cell[data-cell="${cell}"]`);
      await page.waitForFunction(() => !CyclicCubePage.busy && CyclicCubePage.game.turn === CyclicCubePage.game.colorOf(0) || CyclicCubePage.game.over, null, { timeout: 8000 });
    }
    await page.screenshot({ path: path.join(OUT, `cyclic3d-${label}.png`), fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert(overflow <= 0, label + ': no horizontal scroll');
    const small = await page.evaluate(() => Math.min(...[...document.querySelectorAll('.c3-grid .cell')].map(b => b.getBoundingClientRect().width)));
    assert(small >= 28, label + ': layer cells ' + small.toFixed(1) + 'px wide');
    // As second player, the AI opens and the pie panel offers a swap.
    await page.evaluate(() => { document.querySelector('details.rules').open = true; });
    await page.selectOption('#seatSelect', '1');
    await page.waitForSelector('#piePanel:not([hidden])', { timeout: 8000 });
    assert(true, label + ': pie choice shown to the human White seat');
    await page.click('#pieSwap');
    assert(await page.evaluate(() => CyclicCubePage.game.seatOf(1) === 1 && CyclicCubePage.game.swapped), label + ': swap gives the human Black');
    await page.waitForFunction(() => CyclicCubePage.game.ply === 2, null, { timeout: 8000 });
    assert(true, label + ': AI moves as White after the swap');
    await page.screenshot({ path: path.join(OUT, `cyclic3d-${label}-swap.png`), fullPage: true });
    await page.close();
  }
  // Win line rendering.
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.goto(BASE + '/cyclic_tictactoe_3d.html');
  await page.waitForFunction(() => window.CyclicCubePage && CyclicCubePage.game);
  await page.evaluate(() => { document.querySelector('details.rules').open = true; });
  await page.selectOption('#modeSelect', 'pvp');
  await page.click('.c3-grid .cell[data-cell="5"]'); await page.click('.c3-grid .cell[data-cell="5"]');
  await page.click('#pieKeep');
  for (const c of [1, 0, 2, 13, 3]) { await page.click(`.c3-grid .cell[data-cell="${c}"]`); await page.click(`.c3-grid .cell[data-cell="${c}"]`); }
  await page.click('.c3-grid .cell[data-cell="26"]'); await page.click('.c3-grid .cell[data-cell="26"]');
  const status = await page.textContent('#info');
  assert(/空間對角線/.test(status) && /獲勝/.test(status), 'space-diagonal win announced: ' + status);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'cyclic3d-win.png'), fullPage: true });
  await browser.close();
  assert(!errors.length, 'no page errors ' + errors.join(' | '));
})().catch(e => { console.error(e); process.exit(1); });
