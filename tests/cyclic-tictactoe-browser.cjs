'use strict';
// Chromium check for 三子循環棋（平面版）(full-screen 2D canvas stage): lobby, hover preview,
// a full game against the AI to the result curtain on desktop and phone, the 擇二 lift choice,
// a challenge solve, layout (no horizontal scroll, HUD clear of the board) and zero console errors.
// Needs a local HTTP server:
//   python3 -m http.server 8113 --bind 127.0.0.1 & BASE=http://127.0.0.1:8113 node tests/cyclic-tictactoe-browser.cjs
const { chromium } = require('playwright');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const BASE = process.env.BASE || 'http://127.0.0.1:8113';
const OUT = process.env.OUT || path.join(os.tmpdir(), 'cyclic2d-shots');
fs.mkdirSync(OUT, { recursive: true });
const assert = (ok, msg) => { if (!ok) throw new Error(msg); console.log('ok -', msg); };
const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const errors = [];

async function open(browser, viewport, init, label) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: viewport.width < 500 ? 2 : 1, hasTouch: viewport.width < 500 });
  page.on('pageerror', e => errors.push(label + ': ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(label + ': ' + m.text()); });
  if (init) await page.addInitScript(init);
  await page.goto(BASE + '/cyclic_tictactoe.html');
  await page.waitForFunction(() => window.CyclicFlatPage && CyclicFlatPage.game);
  return page;
}
const idle = page => page.waitForFunction(() => CyclicFlatPage.phase !== 'play' || CyclicFlatPage.game.over || (!CyclicFlatPage.busy && CyclicFlatPage.legal().length > 0), null, { timeout: 20000 });
const tap = (page, cell) => page.click(`#board .cell[data-cell="${cell}"]`);
// The best move for the side to move, from the engine's perfect-play table.
const best = page => page.evaluate(() => { const m = CyclicFlat.chooseMove(CyclicFlatPage.game, { level: 'master' }); return { from: m.from, to: m.to }; });
async function layoutChecks(page, label) {
  const g = await page.evaluate(() => {
    const b = document.getElementById('board').getBoundingClientRect(), hud = document.querySelector('.cc-match').getBoundingClientRect(),
      dock = document.getElementById('dock').getBoundingClientRect(), top = document.querySelector('.fu-topbar').getBoundingClientRect();
    const hit = (a, c) => a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom;
    return { scroll: document.documentElement.scrollWidth - innerWidth, vscroll: document.documentElement.scrollHeight - innerHeight, hud: hit(b, hud), dock: hit(b, dock), top: hit(b, top), size: b.width };
  });
  assert(g.scroll <= 0 && g.vscroll <= 0, label + ': no page scroll');
  assert(!g.hud && !g.dock && !g.top, label + ': HUD, dock and top bar clear of the board');
  assert(g.size >= 220, label + ': board is large (' + Math.round(g.size) + 'px)');
}

(async () => {
  const browser = await chromium.launch({ args: GL });
  for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    const page = await open(browser, viewport, null, label);
    assert(await page.isVisible('#lobby'), label + ': lobby curtain first');
    assert(/原版/.test(await page.textContent('#tierSeg button[aria-pressed="true"]')), label + ': the original AI is the default opponent');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `cyclic2d-${label}-lobby.png`) });
    await page.click('#startBtn');
    assert(await page.isHidden('#lobby'), label + ': start closes the lobby');
    assert(await page.locator('#board .cell').count() === 9, label + ': nine cells');
    await layoutChecks(page, label);
    if (label === 'desktop') {
      await page.hover('#board .cell[data-cell="1"]');
      assert(await page.evaluate(() => CyclicFlatPage.game.ply) === 0, label + ': hover only previews');
    }
    // Play perfect moves for X against the classic AI until the game ends.
    let shot = false;
    while (true) {
      await idle(page);
      const over = await page.evaluate(() => CyclicFlatPage.game.over);
      if (over) break;
      const m = await best(page);
      await tap(page, m.to);
      const ply = await page.evaluate(() => CyclicFlatPage.game.ply);
      if (!shot && ply >= 7) {
        await idle(page);
        if (!(await page.evaluate(() => CyclicFlatPage.game.over))) {
          if (label === 'desktop') { const mv = await best(page); await page.hover(`#board .cell[data-cell="${mv.to}"]`); }
          await page.waitForTimeout(250);
          await page.screenshot({ path: path.join(OUT, `cyclic2d-${label}-play.png`) });
          shot = true;
        }
      }
    }
    assert(await page.evaluate(() => CyclicFlatPage.game.winner === 1), label + ': perfect play as first player beats the AI');
    await page.waitForSelector('#result:not([hidden])', { timeout: 5000 });
    assert(/你贏了/.test(await page.textContent('#resultTitle')), label + ': result curtain says you won');
    assert(/經驗/.test(await page.textContent('#resultXp')), label + ': XP breakdown shown');
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `cyclic2d-${label}-result.png`) });
    const xp = await page.evaluate(() => CyclicFlatPage.profile.xp);
    assert(xp > 0, label + ': career XP saved (' + xp + ')');
    // View the board, then back to the lobby.
    await page.click('#viewBoardBtn');
    assert(await page.isHidden('#result'), label + ': view board hides the result');
    await page.close();
  }

  // 擇二: pick the second-oldest stone, then a target.
  {
    const page = await open(browser, { width: 1280, height: 800 }, () => {
      localStorage.setItem('cyclic2d-career', JSON.stringify({ xp: 5000 }));
      localStorage.setItem('fugames:cyclic2d', JSON.stringify({ variant: 'choice', tier: 'novice', mode: 'pvp' }));
    }, 'choice');
    await page.click('#startBtn');
    for (const c of [0, 8, 1, 7, 5, 3]) await tap(page, c);
    assert(await page.evaluate(() => CyclicFlatPage.game.liftable().join()) === '0,1', 'choice: two liftable stones');
    await tap(page, 1);
    assert(await page.evaluate(() => CyclicFlatPage.game.ply) === 6, 'choice: tapping an own stone only selects the lift');
    assert(/移走 B1|移走 A2/.test(await page.textContent('#info')), 'choice: status names the picked stone');
    await tap(page, 2);
    assert(await page.evaluate(() => CyclicFlatPage.game.queues[1].join()) === '0,5,2', 'choice: the second-oldest stone moved');
    await page.keyboard.press('KeyS');
    assert(await page.isVisible('#settings'), 'S opens the settings drawer');
    await page.keyboard.press('Escape');
    await page.close();
  }

  // Challenge 01: the key move, then finish against the master defence.
  {
    const page = await open(browser, { width: 390, height: 844 }, null, 'challenge');
    await page.click('#lobbyChallenges');
    assert(await page.isVisible('#challenges'), 'challenge list opens');
    await page.click('.cc-puz[data-puzzle="p01"]');
    const key = await page.evaluate(() => CyclicFlat.PUZZLES[0].key);
    await tap(page, key);
    while (!(await page.evaluate(() => CyclicFlatPage.game.over))) {
      await idle(page);
      if (await page.evaluate(() => CyclicFlatPage.game.over)) break;
      const m = await page.evaluate(() => { const g = CyclicFlatPage.game, m = CyclicFlat.forcedWin(g, 1) || CyclicFlat.chooseMove(g, { level: 'master' }); return m.to; });
      await tap(page, m);
    }
    await page.waitForSelector('#result:not([hidden])', { timeout: 5000 });
    assert(/破解成功/.test(await page.textContent('#resultTitle')), 'challenge solved');
    assert(await page.evaluate(() => CyclicFlatPage.profile.solved.includes('p01')), 'challenge recorded');
    await page.close();
  }

  // Keyboard: arrows + Enter place a stone in the 4×4 variant.
  {
    const page = await open(browser, { width: 1440, height: 900 }, () => {
      localStorage.setItem('cyclic2d-career', JSON.stringify({ xp: 5000 }));
      localStorage.setItem('fugames:cyclic2d', JSON.stringify({ variant: 'wide', tier: 'hard', drawRule: true }));
    }, 'wide');
    await page.click('#startBtn');
    assert(await page.locator('#board .cell').count() === 16, 'wide: sixteen cells');
    await layoutChecks(page, 'wide');
    await page.focus('#stage canvas').catch(() => {});
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    assert(await page.evaluate(() => CyclicFlatPage.game.ply) >= 1, 'wide: keyboard placed a stone');
    await idle(page);
    assert(await page.evaluate(() => CyclicFlatPage.game.ply) === 2, 'wide: AI replied');
    await page.screenshot({ path: path.join(OUT, 'cyclic2d-wide.png') });
    await page.close();
  }

  await browser.close();
  assert(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  console.log('screenshots in', OUT);
})().catch(e => { console.error(e); console.error(errors.join('\n')); process.exit(1); });
