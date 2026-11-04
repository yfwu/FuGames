'use strict';
// AutoHex-3D shares the AutoHex rules core. These tests pin that wiring and
// verify the 3D page's read-only analysis and order queue against the engine.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const E = require('../autohex-engine.js'), L = require('../autohex3d-logic.js'), V = require('../autohex-visuals.js');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const scripts = html => [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);

function play(seed, actions, options = {}) {
  const g = new E.Game({ seed, neutralEvents: true, ...options }); g.start();
  for (let k = 0; k < actions; k++) {
    const action = E.chooseAction(g.observation());
    if (!action || !g.act(action)) g.act({ type: 'rest', cells: [] });
    g.advanceTime(1000);
  }
  return g;
}

test('3D page loads exactly the AutoHex rules stack, in the same order, and the same AI worker', () => {
  const flat = scripts(read('autohex.html')), deep = scripts(read('autohex_3d_classic.html'));
  const core = ['hex-strategies.js', 'autohex-planner.js', 'hex-core.js', 'autohex-engine.js', 'autohex-visuals.js'];
  assert.deepEqual(core.filter(f => flat.includes(f)), core);
  assert.deepEqual(deep.slice(0, core.length), core, 'rules scripts load first and unchanged');
  assert.deepEqual(deep.slice(core.length), ['autohex3d-logic.js', 'autohex3d-render.js', 'autohex3d-scene.js', 'autohex3d-ui.js']);
  const ui = read('autohex3d-ui.js');
  assert.match(ui, /new Worker\('autohex-ai-worker\.js'\)/);
  assert.match(ui, /window\.AutoHex\b/);
  for (const html of ['autohex_3d_classic.html']) for (const [, href] of read(html).matchAll(/\b(?:href|src)="([^"#]+)/g)) if (!/^https:/.test(href)) assert.ok(fs.existsSync(path.join(root, href)), href);
});

test('3D presentation never writes game state: every change goes through game.act / start / pause / continueSandbox', () => {
  for (const file of ['autohex3d-ui.js', 'autohex3d-logic.js', 'autohex3d-render.js', 'autohex3d-scene.js']) {
    const source = read(file);
    assert.doesNotMatch(source, /\b(?:game|view|g)\.(?:board|terrain|reserve|anchors|shields|unsupplied|hands|players|turrets|bridges|tunnels|airports|depots|drawPile|discardPile)\s*(?:\[[^\]]*\])?\s*=(?!=)/, file);
    assert.doesNotMatch(source, /\.(?:_remove|_capture|_damage|_draw|_beginTurn|_settleSupply|_finish)\s*\(/, file);
    assert.doesNotMatch(source, /RULES\.[a-zA-Z]+\s*=(?!=)/, file);
  }
  const ui = read('autohex3d-ui.js');
  const mutations = [...ui.matchAll(/\bgame\.([a-zA-Z_]+)\(/g)].map(m => m[1]);
  assert.deepEqual([...new Set(mutations)].sort(), ['act', 'advanceTime', 'continueSandbox', 'observation', 'pause', 'start'].sort());
});

test('3D page offers the optional Front Line expansion, on by default, and passes it to the shared core', () => {
  const html = read('autohex_3d_classic.html'), ui = read('autohex3d-ui.js');
  assert.match(html, /<select id="expansion"><option value="on" selected>/);
  for (const type of ['arsenal', 'flak', 'workshop']) assert.match(html, new RegExp(`data-action="${type}"`));
  assert.match(ui, /expansion: \$\('expansion'\)\.value !== 'off'/);
  assert.doesNotMatch(read('autohex.html') + read('card_hex.html') + read('autohex-ui.js'), /expansion/, '2D pages keep the expansion off');
  const g = new E.Game({ seed: '3d-expansion-report', expansion: true }); g.start();
  for (let k = 0; k < 180; k++) { const a = E.chooseAction(g.observation()); if (!a || !g.act(a)) g.act({ type: 'rest', cells: [] }); }
  const view = g.observation(0);
  for (const p of E.PLAYERS) {
    const rep = L.supplyReport(view, E, p), supplied = E.computeSupply(view, p);
    const shops = view.structures.filter(t => t.type === 'workshop' && t.owner === p && view.board[t.cell] === p && supplied[t.cell]).length;
    assert.equal(rep.workshops, shops); assert.equal(rep.production, E.RULES.supplyProduction + 2 * rep.depots + E.EXPANSION.workshopProduction * shops);
  }
});

test('supply chokepoints equal the shared supply-cut preview for every own supplied stone', () => {
  let checks = 0;
  for (const seed of ['3d-choke-a', '3d-choke-b']) {
    const g = play(seed, 0);
    for (let stage = 0; stage < 4; stage++) {
      for (let k = 0; k < 45; k++) { const a = E.chooseAction(g.observation()); if (!a || !g.act(a)) g.act({ type: 'rest', cells: [] }); }
      const view = g.observation(0);
      for (const p of E.PLAYERS) {
        const cut = new Map(L.supplyChokepoints(view, E, p).map(c => [c.cell, c.cut]));
        for (let i = 0; i < E.COUNT; i++) if (view.board[i] === p && view.supplied[i] && !view.anchors[i]) {
          assert.equal(cut.get(i) || 0, V.supplyCutPreview(view, i, E, 0).affected.length, `${seed} p${p} cell ${i}`); checks++;
        }
      }
    }
  }
  assert.ok(checks > 200, `only ${checks} checks`);
});

test('supply report agrees with computeSupply and positions with public fields', () => {
  const g = play('3d-report', 150), view = g.observation(0);
  for (const p of E.PLAYERS) {
    const rep = L.supplyReport(view, E, p), connected = E.computeSupply(view, p);
    let stones = 0, linked = 0; for (let i = 0; i < E.COUNT; i++) if (view.board[i] === p) { stones++; if (connected[i]) linked++; }
    assert.equal(rep.stones, stones); assert.equal(rep.linked, linked); assert.equal(rep.cut.length, stones - linked);
    assert.ok(rep.cut.every((c, k) => !k || rep.cut[k - 1].reserve <= c.reserve));
    assert.equal(rep.supplies, view.players[p].supplies); assert.equal(rep.production, E.RULES.supplyProduction + 2 * rep.depots);
    const pos = L.positionReport(view, E, p);
    assert.equal(pos.turrets.length, view.turrets.filter(t => t.owner === p && view.board[t.cell] === p).length);
    assert.ok(pos.turrets.length <= E.RULES.maxTurrets);
  }
  const deck = L.deckSummary(view, E);
  assert.equal(deck.reduce((n, d) => n + d.perSeat, 0), E.RECIPE_SIZE);
  assert.equal(deck.reduce((n, d) => n + d.total, 0), E.DECK_SIZE);
  assert.equal(deck.find(d => d.type === 'shield').perSeat, 1);
});

test('queued orders resolve card indices at execution time and never yield an illegal action', () => {
  const g = play('3d-queue', 30);
  let executed = 0, rejected = 0;
  for (let k = 0; k < 240; k++) {
    const view = g.observation();
    const ai = E.chooseAction(view);
    // A queue of the AI's real choice behind two stale/illegal orders.
    const stale = [{ type: 'deploy', cells: [view.players[view.turn].home] }, { type: 'turret', cells: [0] }];
    const order = ai && { type: ai.type, cells: ai.cells.slice(), ...(ai.target !== undefined ? { target: ai.target } : {}) };
    const result = L.takeQueued(view, E, order ? [...stale, order, { type: 'rest', cells: [] }] : stale);
    if (result.action) {
      assert.ok(E.legalAction(view, result.action));
      if (E.CARD_META[result.action.type]) assert.equal(view.hand[result.action.cardIndex], result.action.type);
      assert.ok(result.dropped.length >= 1);
      assert.ok(g.act(result.action)); executed++;
    } else { rejected++; g.act({ type: 'rest', cells: [] }); }
    for (const dropped of result.dropped) assert.equal(L.resolveOrder(view, E, dropped), null);
  }
  assert.ok(executed > 200, `executed ${executed}, rejected ${rejected}`);
  // A card order whose card has left the hand is dropped, not substituted.
  const view = g.observation(), missing = E.CARD_TYPES.find(t => !view.hand.includes(t));
  if (missing) assert.equal(L.resolveOrder(view, E, { type: missing, cells: [view.players[view.turn].home] }), null);
});

test('planning-time plausibility rejects malformed and out-of-range orders', () => {
  const g = play('3d-plausible', 6), view = g.observation(1);
  const far = E.CELLS.reduce((best, c) => E.distance(c.i, view.players[1].home) > E.distance(best, view.players[1].home) ? c.i : best, 0);
  assert.equal(L.plausibleOrder(view, E, 1, { type: 'deploy', cells: [far] }), false);
  assert.equal(L.plausibleOrder(view, E, 1, { type: 'deploy', cells: [] }), false);
  assert.equal(L.plausibleOrder(view, E, 1, { type: 'nonsense', cells: [] }), false);
  assert.equal(L.plausibleOrder(view, E, 1, { type: 'rest', cells: [] }), true);
});

test('hex picking maps every cell centre (and nearby points) back to the same cell', () => {
  for (const c of E.CELLS) {
    for (const [dx, dz] of [[0, 0], [.4, 0], [-.3, .3], [0, -.45]]) {
      const a = L.worldToAxial(c.x + dx, c.y + dz); assert.equal(E.index(a.q, a.r), c.i);
    }
  }
});

test('engineered terrain is the difference from the opening map', () => {
  const g = new E.Game({ seed: '3d-terrain' }), initial = Uint8Array.from(g.terrain);
  assert.deepEqual(L.engineeredCells(initial, g.terrain), []);
  const river = E.CELLS.find(c => g.terrain[c.i] === 1).i; g.terrain[river] = 0;
  assert.deepEqual(L.engineeredCells(initial, g.terrain), [river]);
});

test('renderer and UI scripts parse; the page keeps the shared shell, rules and local assets', () => {
  for (const file of ['autohex3d-render.js', 'autohex3d-scene.js', 'autohex3d-ui.js', 'autohex3d-logic.js']) assert.doesNotThrow(() => new vm.Script(read(file), { filename: file }));
  const html = read('autohex_3d_classic.html');
  assert.match(html, /<details class="card rules ah3-rules">/); assert.match(html, /class="card play-panel ah3-stage"/);
  assert.match(html, /<use href="icons\.svg#autohex_3d">/);
  assert.doesNotMatch(html + read('autohex3d-ui.js') + read('autohex3d-render.js'), /https?:\/\/(?!www\.w3\.org)/, 'no remote runtime dependency');
  assert.match(read('archive.html'), /href="autohex_3d_classic.html"/, 'the classic 3D page stays reachable from the archive');
});
