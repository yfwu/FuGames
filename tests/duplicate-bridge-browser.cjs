'use strict';
// Real Chromium: full bridge boards on desktop/mobile, bid explanations, worker AI, hint, pause/restart, no overflow.
// Run: node tests/duplicate-bridge-browser.cjs  (screenshots go to FUGAMES_SCREENSHOTS or the OS temp dir)
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), os = require('node:os'), assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const out = process.env.FUGAMES_SCREENSHOTS || path.join(os.tmpdir(), 'fugames-bridge');
fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => { const file = path.join(root, new URL(req.url, 'http://x').pathname); if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; } fs.readFile(file, (e, d) => { if (e) { res.writeHead(404).end(); return; } res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream'); res.end(d); }); });
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const errors = [], external = [];
  for (const [w, h, label, seed, mode] of [[1366, 900, 'desktop', 1, 'hint'], [390, 844, 'mobile', 52, 'pass'], [320, 568, 'narrow', 3, 'pass']]) {
    const mobile = label !== 'desktop';
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
    await ctx.addInitScript(s => { Math.random = () => 0; const t = Date.now; Date.now = () => s; void t; }, seed);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('request', r => { if (!r.url().startsWith(base)) external.push(r.url()); });
    const snap = () => page.evaluate('BridgeUI.snapshot()');
    const fits = async () => assert.ok(await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'horizontal overflow ' + label);
    const tap = sel => mobile ? page.locator(sel).tap() : page.locator(sel).click();
    async function untilHuman() { for (let i = 0; i < 400; i++) { const s = await snap(); if (s.human || s.phase === 'complete') return s; await page.waitForTimeout(100); } throw new Error('AI stalled ' + JSON.stringify(await snap())); }
    await page.goto(base + '/duplicate_bridge.html');
    await fits();
    await tap('#start');
    // blur pauses and nothing moves while paused
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    const frozen = await snap(); assert.ok(frozen.paused);
    await page.waitForTimeout(1500); assert.deepEqual(await snap(), frozen);
    await tap('#pause');
    let s = await untilHuman();
    // auction: follow the AI hint or pass; check explanations
    for (let i = 0; i < 30 && s.phase === 'auction'; i++) {
      if (mode === 'hint') {
        await tap('#hint');
        const text = await page.locator('#status').innerText();
        assert.match(text, /AI 建議/);
        const call = (text.match(/AI 建議 (\S+?)：/) || [])[1] || 'Pass';
        if (call === 'Pass') await tap('#pass'); else if (call === 'X') await tap('#double'); else if (call === 'XX') await tap('#redouble'); else { assert.match(await page.locator('#bid-meaning').innerText(), /理解為/); await tap('#bid'); }
      } else await tap('#pass');
      s = await untilHuman();
    }
    assert.ok(await page.locator('#auction-body .call-cell').count() >= 4);
    await page.locator('#auction-body .call-cell').first().click();
    assert.match(await page.locator('#explain').innerText(), /推論/);
    await page.screenshot({ path: path.join(out, `bridge-auction-${label}.png`), fullPage: true });
    // play until complete; one AI card hint along the way
    let hinted = false;
    for (let i = 0; i < 80 && s.phase !== 'complete'; i++) {
      if (!hinted && s.phase === 'play') { await tap('#hint'); await page.waitForFunction(() => /AI 建議 [♣♦♥♠]/.test(document.querySelector('#status').textContent), null, { timeout: 15000 }); hinted = true; }
      const cards = page.locator('#hand button:not(:disabled)');
      assert.ok(await cards.count() > 0);
      const hint = page.locator('#hand button.hint:not(:disabled)');
      await ((await hint.count()) ? hint.first() : cards.first())[mobile ? 'tap' : 'click']();
      await fits();
      s = await untilHuman();
    }
    if (s.phase === 'complete' && s.played === 52) {
      await page.waitForFunction(() => BridgeUI.snapshot().baselineScore !== null, null, { timeout: 60000 });
      assert.match(await page.locator('#result').innerText(), /AI 桌 NS/);
      assert.equal(await page.locator('.score-compare strong').count(), 3);
    }
    await page.screenshot({ path: path.join(out, `bridge-result-${label}.png`), fullPage: true });
    await tap('#restart');
    const r = await snap(); assert.equal(r.played, 0); assert.equal(r.auction, 0);
    await fits();
    await ctx.close();
    console.log(`${label}: board ${s.phase === 'complete' ? 'completed' : 'passed out'}, explanations, worker AI, hint, pause, restart OK`);
  }
  await browser.close(); server.close();
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('No page errors or external requests. Screenshots:', out);
})().catch(e => { console.error(e); process.exit(1); });
