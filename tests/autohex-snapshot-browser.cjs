'use strict';
/* Browser acceptance for the AutoHex snapshot: pause on click, PNG export, preview dialog.
   Usage: python3 -m http.server 8011 --bind 127.0.0.1 & node tests/autohex-snapshot-browser.cjs */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs'), path = require('node:path');
const BASE = process.env.FUGAMES_BASE_URL || 'http://127.0.0.1:8011';
const OUT = path.join(__dirname, '..', 'docs', 'autohex-snapshot-2026-10-12');
const ROUNDS = Number(process.env.SNAPSHOT_ROUNDS || 40);
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const errors = [], report = { rounds: ROUNDS, viewports: [] };
  for (const [label, width, height, mobile] of [['desktop', 1440, 1000, false], ['mobile', 390, 844, true]]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
    page.on('pageerror', e => errors.push(`${label}: ${e.message}`));
    await page.goto(`${BASE}/autohex.html?mode=spectator&seed=snapshot-demo`);
    await page.evaluate(() => { document.getElementById('step-seconds').value = '0.05'; });
    await page.click('#play');
    await page.waitForFunction(r => autoHexGame.round >= r, ROUNDS, { timeout: 240000, polling: 500 });
    const before = await page.evaluate(() => ({ phase: autoHexGame.phase, ply: autoHexGame.ply }));
    await page.click('#snapshot');
    await page.waitForFunction(() => window.autoHexSnapshotDebug && document.getElementById('snapshot-dialog').open, null, { timeout: 20000 });
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => ({ phase: autoHexGame.phase, ply: autoHexGame.ply, debug: { ...autoHexSnapshotDebug, summary: undefined }, counts: Object.fromEntries(['gains', 'ghosts', 'shots', 'kills', 'captures', 'retreats', 'plans', 'milestones'].map(k => [k, autoHexSnapshotDebug.summary[k].length])), window: [autoHexSnapshotDebug.summary.fromPly, autoHexSnapshotDebug.summary.toPly] }));
    if (after.phase !== 'paused') errors.push(`${label}: snapshot did not pause (${after.phase})`);
    if (after.ply !== before.ply && after.ply !== before.ply + 1) errors.push(`${label}: game advanced after snapshot`);
    if (after.window[1] - after.window[0] !== 18) errors.push(`${label}: window is not 18 turns`);
    const png = await page.evaluate(async () => { const r = await fetch(document.getElementById('snapshot-download').href); const b = new Uint8Array(await r.arrayBuffer()); let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s); });
    const buffer = Buffer.from(png, 'base64');
    if (buffer.subarray(1, 4).toString() !== 'PNG') errors.push(`${label}: download is not a PNG`);
    if (label === 'desktop') fs.writeFileSync(path.join(OUT, 'snapshot-sample.png'), buffer);
    await page.screenshot({ path: path.join(OUT, `dialog-${label}.png`) });
    await page.waitForTimeout(1200);
    const still = await page.evaluate(() => autoHexGame.ply);
    if (still !== after.ply) errors.push(`${label}: game kept running behind the dialog`);
    report.viewports.push({ label, ...after, bytes: buffer.length });
    await page.close();
  }
  await browser.close();
  report.errors = errors;
  console.log(JSON.stringify(report, null, 1));
  process.exit(errors.length ? 1 : 0);
})();
