'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), H = require('../autohex-engine.js');
const at = H.index, center = at(0, 0), action = (type, cells = [], extra = {}) => ({ type, cells, ...extra });
function game(options = {}) { const g = new H.Game({ seed: 'strategic-fixture', neutralEvents: false, ...options }); g.start(); return g; }
function clean(options = {}) {
  const g = game(options); g.terrain.fill(0); g.roads.fill(0); g.age.fill(0); g.fortified.fill(0); g.unsupplied.fill(0); g.shields.fill(0);
  for (let i = 0; i < H.COUNT; i++) g.board[i] = g.anchors[i];
  g.bridges = []; g.turrets = []; g.alliances = []; g.offers = []; return g;
}
function invalid(g, a) { const before = JSON.stringify(g); assert.equal(g.act(a), false, JSON.stringify(a)); assert.equal(JSON.stringify(g), before); }
function toTurn(g, p) { for (let n = 0; g.turn !== p && n < 6; n++) assert.ok(g.act(action('rest'))); assert.equal(g.turn, p); }
function ownAction(g, p = 1, a = action('rest')) { toTurn(g, p); assert.ok(g.act(a)); }
function pathTo(g, target, owner = 1) {
  const home = g.players[owner].home, queue = [home], previous = new Int32Array(H.COUNT).fill(-2); previous[home] = -1;
  for (let n = 0; n < queue.length && previous[target] === -2; n++) for (const j of H.ADJ[queue[n]]) if (previous[j] === -2 && (!g.board[j] || g.board[j] === owner)) { previous[j] = queue[n]; queue.push(j); }
  assert.ok(previous[target] !== -2); const route = [];
  for (let i = target; i !== -1; i = previous[i]) { g.board[i] = owner; route.push(i); }
  return route.reverse();
}
function localCluster(g, airport, owner = 1) {
  const queue = [airport], seen = new Set(queue);
  for (let n = 0; n < queue.length; n++) for (const j of H.ADJ[queue[n]]) if (!seen.has(j) && g.board[j] === owner && H.distance(airport, j) <= 4) { seen.add(j); queue.push(j); }
  return queue;
}
function airportFixture(size = 12, active = true) {
  const g = clean();
  // Use this seed's public facility layout. Keep a supply segment outside the
  // local radius-four cluster so cutting that segment is a genuine loss test.
  const airport = g.airports.find(a => H.distance(g.players[1].home, a.cell) >= 10).cell;
  const route = pathTo(g, airport);
  let cluster = localCluster(g, airport);
  while (cluster.length < size) {
    const i = H.CELLS.find(c => !g.board[c.i] && H.distance(airport, c.i) <= 4 && H.ADJ[c.i].some(j => cluster.includes(j))).i;
    g.board[i] = 1; cluster = localCluster(g, airport);
  }
  assert.equal(cluster.length, size); g._refreshFacilities();
  if (active) for (let n = 0; n < 3; n++) g._refreshFacilities(1);
  g.players[1].energy = 8; g.players[1].supplies = 6;
  return { g, airport, route, cluster };
}
function airTarget(g, airport, distance, owner = 0) {
  const c = H.CELLS.find(c => H.distance(airport, c.i) === distance && !g.board[c.i] && !g.anchors[c.i] && !H.inRange(g, 1, c.i));
  assert.ok(c, `Need distance-${distance} target outside ordinary deployment range`); if (owner) g.board[c.i] = owner; return c.i;
}

test('AutoHex facilities use the seed-specific symmetric airport layout and start neutral with public zero stock', () => {
  const g = game(); assert.equal(g.airports.length, 6); assert.equal(g.depots.length, 6);
  const airports = g.airports.map(a => a.cell);
  assert.deepEqual(airports, H.airportCells(g.seed));
  assert.deepEqual(airports, game().airports.map(a => a.cell));
  assert.equal(new Set([...airports, ...H.DEPOT_CELLS]).size, 12);
  for (const i of airports) {
    assert.ok(H.distance(center, i) >= 6 && H.distance(center, i) <= 13);
    assert.equal(g.board[i], 0); assert.equal(g.terrain[i], 0);
    const c = H.CELLS[i]; assert.ok(airports.includes(at(-c.r, -c.s)));
  }
  for (const i of H.DEPOT_CELLS) { assert.equal(H.distance(center, i), 10); assert.equal(g.board[i], 0); const c = H.CELLS[i]; assert.ok(H.DEPOT_CELLS.includes(at(-c.r, -c.s))); }
  for (const p of H.PLAYERS) { assert.equal(g.players[p].supplies, 0); assert.equal(g.players[p].airCooldown, 0); }
  assert.ok(g.observation(0).airports.every(a => !a.owner && !a.active && a.progress === 0));
});

test('AutoHex airports require 12 locally connected own stones, home supply and three completed owner actions', () => {
  const { g, airport } = airportFixture(11, false); let site = g.airports.find(a => a.cell === airport);
  assert.equal(H.airportStatus(g, airport).cluster, 11); assert.equal(site.active, false);
  ownAction(g); assert.equal(site.progress, 0);
  toTurn(g, 1); const cluster = localCluster(g, airport), next = H.CELLS.find(c => !g.board[c.i] && H.distance(airport, c.i) <= 4 && H.ADJ[c.i].some(i => cluster.includes(i))).i;
  assert.ok(g.act(action('deploy', [next]))); assert.equal(site.cluster, 12); assert.equal(site.progress, 1); assert.equal(site.active, false);
  for (let n = 0; n < 5; n++) assert.ok(g.act(action('rest'))); assert.equal(site.progress, 1, 'Other factions cannot advance the hold');
  ownAction(g); assert.equal(site.progress, 2); assert.equal(site.active, false); ownAction(g); assert.equal(site.progress, 3); assert.equal(site.active, true);
  assert.ok(g.events.some(e => e.type === 'airport-unlocked' && e.cells.includes(airport)));
});

test('AutoHex airport clusters exclude allied stones and remote bridge islands, and loss of center or supply disables flight immediately', () => {
  const small = airportFixture(11, false), g = small.g, airport = small.airport;
  const extra = H.CELLS.find(c => !g.board[c.i] && H.distance(airport, c.i) <= 4 && H.ADJ[c.i].some(i => small.cluster.includes(i))).i;
  g.board[extra] = 2; g.alliances = [{ a: 1, b: 2, expiresRound: 99 }]; assert.equal(H.airportStatus(g, airport).cluster, 11);
  const island = H.CELLS.find(c => !g.board[c.i] && H.distance(airport, c.i) <= 4 && H.ADJ[c.i].every(i => g.board[i] !== 1)).i;
  g.board[island] = 1; g.bridges = [{ owner: 1, a: airport, b: island }]; assert.equal(H.airportStatus(g, airport).cluster, 11);
  const full = airportFixture(), f = full.g, target = airTarget(f, full.airport, 10);
  assert.ok(H.activeAirport(f, 1, full.airport));
  const cut = full.route.find(i => i !== f.players[1].home && H.distance(full.airport, i) > 4); assert.ok(cut !== undefined); f.board[cut] = 0;
  const site = f.airports.find(a => a.cell === full.airport);
  assert.equal(H.activeAirport(f, 1, full.airport), false); invalid(f, action('airdrop', [full.airport, target])); f._refreshFacilities(); assert.equal(site.progress, 0);
  f.board[cut] = 1; f._refreshFacilities(); assert.equal(site.active, false, 'Restored supply must hold again');
  for (let n = 0; n < 3; n++) f._refreshFacilities(1);
  f.turn = 2; f.players[2].energy = 8; f.hands[2] = ['destroy']; const approach = H.ADJ[full.airport].find(i => !f.anchors[i]); f.board[approach] = 2;
  assert.ok(f.act(action('destroy', [full.airport]))); assert.equal(site.active, false); assert.equal(site.owner, 0); assert.equal(site.progress, 0);
});

test('AutoHex stock regenerates equally every three owner actions, supplied depots add at most one, and cap is six', () => {
  const base = clean(); for (let n = 0; n < 3; n++) for (const p of H.PLAYERS) ownAction(base, p);
  for (const p of H.PLAYERS) assert.equal(base.players[p].supplies, 1);
  const g = clean(); pathTo(g, H.DEPOT_CELLS[0]); pathTo(g, H.DEPOT_CELLS[1]); g._refreshFacilities();
  assert.equal(g.depots.filter(d => d.owner === 1 && d.supplied).length, 2);
  ownAction(g); ownAction(g); assert.equal(g.players[1].supplies, 0); ownAction(g); assert.equal(g.players[1].supplies, 2);
  g.board[H.DEPOT_CELLS[0]] = g.board[H.DEPOT_CELLS[1]] = 0; g._refreshFacilities();
  for (let n = 0; n < 3; n++) ownAction(g); assert.equal(g.players[1].supplies, 3, 'Losing supplied depots removes the next income bonus');
  for (let n = 0; n < 9; n++) ownAction(g); assert.equal(g.players[1].supplies, 6);
  const isolated = clean(); isolated.board[H.DEPOT_CELLS[0]] = 1; isolated._refreshFacilities(); assert.equal(isolated.depots[0].supplied, false);
  for (let n = 0; n < 3; n++) ownAction(isolated); assert.equal(isolated.players[1].supplies, 1);
});

test('AutoHex airdrop extends only from an active airport to distance 10, costs energy/stock, and uses no card', () => {
  const { g, airport } = airportFixture(), near = airTarget(g, airport, 10), far = airTarget(g, airport, 11), hand = g.hands[1].slice();
  invalid(g, action('deploy', [near])); invalid(g, action('airdrop', [airport, far])); invalid(g, action('airdrop', [g.players[1].home, near]));
  g.players[1].supplies = 2; invalid(g, action('airdrop', [airport, near])); g.players[1].supplies = 6;
  g.players[1].energy = 5; invalid(g, action('airdrop', [airport, near])); g.players[1].energy = 8;
  g.terrain[near] = 1; invalid(g, action('airdrop', [airport, near])); g.roads[near] = 1;
  assert.ok(g.act(action('airdrop', [airport, near]))); assert.equal(g.board[near], 1); assert.ok(g.turrets.some(t => t.owner === 1 && t.cell === near));
  assert.equal(g.players[1].energy, 2); assert.equal(g.players[1].supplies, 3); assert.equal(g.players[1].airCooldown, 6); assert.equal(g.ply, 1); assert.equal(g.age[near], 0);
  assert.deepEqual(g.hands[1], hand); assert.equal(g.telemetry.cardsUsed, 0);
  for (let n = 0; n < 5; n++) ownAction(g); assert.equal(g.board[near], 0); assert.ok(!g.turrets.some(t => t.cell === near));
});

test('AutoHex air abilities share six subsequent owner-action cooldowns and still obey footprint/turret caps', () => {
  const { g, airport } = airportFixture(), target = airTarget(g, airport, 10); assert.ok(g.act(action('airdrop', [airport, target])));
  const enemy = airTarget(g, airport, 12, 2);
  for (let remaining = 6; remaining > 0; remaining--) { toTurn(g, 1); g.players[1].energy = 8; g.players[1].supplies = 6; assert.equal(g.players[1].airCooldown, remaining); invalid(g, action('bombard', [airport, enemy])); assert.ok(g.act(action('rest'))); }
  toTurn(g, 1); assert.equal(g.players[1].airCooldown, 0); g.players[1].energy = 8; g.players[1].supplies = 6;
  g.board[enemy] = 2; assert.ok(H.legalAction(g.observation(), action('bombard', [airport, enemy])));
  const cap = airportFixture(), drop = airTarget(cap.g, cap.airport, 10);
  for (const c of H.CELLS) if (cap.g.board.filter(o => o === 1).length < 96 && !cap.g.board[c.i] && c.i !== drop) cap.g.board[c.i] = 1;
  invalid(cap.g, action('airdrop', [cap.airport, drop]));
  const guns = airportFixture(), t = airTarget(guns.g, guns.airport, 10);
  guns.g.turrets = guns.cluster.slice(0, 3).map(cell => ({ owner: 1, cell, life: 20, countdown: 3 })); invalid(guns.g, action('airdrop', [guns.airport, t]));
});

test('AutoHex bombard reaches distance 12, rejects 13/allies/anchors, and shields absorb the paid strike', () => {
  const { g, airport } = airportFixture(), target = airTarget(g, airport, 12, 2), far = airTarget(g, airport, 13, 2);
  invalid(g, action('bombard', [airport, far])); g.alliances = [{ a: 1, b: 2, expiresRound: 99 }]; invalid(g, action('bombard', [airport, target])); g.alliances = [];
  g.anchors[target] = 2; invalid(g, action('bombard', [airport, target])); g.anchors[target] = 0;
  g.players[1].supplies = 3; invalid(g, action('bombard', [airport, target])); g.players[1].supplies = 6;
  g.shields[target] = 7; assert.ok(g.act(action('bombard', [airport, target]))); assert.equal(g.board[target], 2); assert.equal(g.shields[target], 0);
  assert.equal(g.players[1].energy, 1); assert.equal(g.players[1].supplies, 2); assert.equal(g.players[1].airCooldown, 6);
  const hit = g.events.find(e => e.type === 'shield-block' && e.source === 'bombard'); assert.ok(hit); assert.equal(hit.origin, airport); assert.equal(hit.from, 2);
});

test('AutoHex fortification requires 31 unchanged completed owner actions; enemy turns and pauses do not age a stone', () => {
  const g = clean(), home = g.players[1].home, stone = H.ADJ[home].find(i => !g.board[i]); g.board[stone] = 1;
  for (let n = 1; n <= 30; n++) { ownAction(g); assert.equal(g.age[stone], n); assert.equal(g.fortified[stone], 0); }
  const age = g.age[stone]; for (let n = 0; n < 5; n++) assert.ok(g.act(action('rest'))); assert.equal(g.age[stone], age);
  g.pause(); g.advanceTime(9000); invalid(g, action('rest')); assert.equal(g.age[stone], 30); g.start(); ownAction(g);
  assert.equal(g.age[stone], 31); assert.equal(g.fortified[stone], 1);
  g.turn = 2; g.players[2].energy = 8; g.hands[2] = ['destroy']; const approach = H.ADJ[stone].find(i => i !== home && !g.anchors[i]); g.board[approach] = 2;
  assert.ok(g.act(action('destroy', [stone]))); assert.equal(g.board[stone], 0); assert.equal(g.age[stone], 0); assert.equal(g.fortified[stone], 0);
});

test('AutoHex new placement, capture and both exchanged cells reset fortification age; fortified isolation still retreats', () => {
  const g = clean(); g.players[1].home = center; g.board[center] = g.anchors[center] = 1; g.players[1].energy = 8;
  const target = at(1, 0); assert.ok(g.act(action('deploy', [target]))); assert.equal(g.age[target], 0);
  toTurn(g, 1); g.board[target] = 2; g.age[target] = 50; g.fortified[target] = 1; g.players[1].energy = 8;
  assert.ok(g.act(action('deploy', [target]))); assert.equal(g.age[target], 0); assert.equal(g.fortified[target], 0);
  toTurn(g, 1); const swapped = at(2, 0); g.board[swapped] = 2; g.age[target] = g.age[swapped] = 50; g.fortified[target] = g.fortified[swapped] = 1; g.hands[1] = ['exchange'];
  assert.ok(g.act(action('exchange', [target, swapped]))); for (const i of [target, swapped]) { assert.equal(g.age[i], 0); assert.equal(g.fortified[i], 0); }
  toTurn(g, 1); const remote = at(8, 0); g.board[remote] = 1; g.age[remote] = 40; g.fortified[remote] = 1; g.unsupplied[remote] = 5;
  assert.ok(g.act(action('rest'))); assert.equal(g.board[remote], 0);
});

test('AutoHex neutral warnings are public, deterministic, two rounds ahead, bounded to two non-anchor cells, and optional', () => {
  const a = game({ neutralEvents: true }), b = game({ neutralEvents: true }); b.drawPile.reverse(); for (const p of H.PLAYERS) b.hands[p].reverse();
  for (const g of [a, b]) { g.round = 10; g._neutralRound(); }
  assert.deepEqual(a.neutralWarning, b.neutralWarning); const warning = JSON.parse(JSON.stringify(a.neutralWarning));
  assert.equal(warning.resolveRound, 12); assert.equal(warning.kind, 'guerrilla'); assert.ok(warning.cells.length <= 2);
  for (const i of warning.cells) { assert.ok(a.board[i]); assert.equal(a.anchors[i], 0); assert.equal(H.sectorOf(i), warning.sector); }
  const view = a.observation(0); assert.deepEqual(view.neutralWarning, warning); view.neutralWarning.cells.push(-1); assert.deepEqual(a.neutralWarning, warning);
  a.round = 11; a._neutralRound(); assert.deepEqual(a.neutralWarning, warning); a.round = 12; a._neutralRound(); assert.equal(a.neutralWarning, null);
  a.round = 22; a._neutralRound(); assert.equal(a.neutralWarning.kind, 'disaster'); assert.equal(a.neutralWarning.resolveRound, 24); assert.equal(a.neutralWarning.sector, (warning.sector + 1) % 6);
  const off = game({ neutralEvents: false }); off.round = 10; off._neutralRound(); assert.equal(off.neutralWarning, null); assert.equal(off.telemetry.neutralWarnings, 0);
});

test('AutoHex neutral events respect new fortification/shields, remove only warned unprotected stones, and award no combat score', () => {
  for (const kind of ['guerrilla', 'disaster']) {
    const g = clean({ neutralEvents: true }), fortified = at(0, 0), shielded = at(1, 0), ordinary = at(2, 0), safe = at(3, 0);
    for (const i of [fortified, shielded, ordinary, safe]) g.board[i] = 2;
    g.age[fortified] = 31; g.fortified[fortified] = 1; g.shields[fortified] = g.shields[shielded] = 5;
    g.neutralWarning = { kind, sector: 0, cells: [fortified, shielded], resolveRound: 12 }; g.round = 12; g._neutralRound();
    assert.equal(g.board[fortified], 2); assert.equal(g.shields[fortified], 5); assert.equal(g.board[shielded], 2); assert.equal(g.shields[shielded], 0);
    g.neutralWarning = { kind, sector: 0, cells: [ordinary], resolveRound: 24 }; g.round = 24; g._neutralRound();
    assert.equal(g.board[ordinary], 0); assert.equal(g.board[safe], 2); for (const p of H.PLAYERS) assert.equal(g.players[p].score, 0);
    assert.equal(g.telemetry.neutralRemoved, 1); assert.equal(g.telemetry.neutralBlocks, 2);
  }
});

test('AutoHex AI uses a ready airport to break a remote supplied enemy goal and respects the shared cooldown', () => {
  const { g, airport } = airportFixture(); g.hands[1] = [];
  // Build an actual enemy home-to-goal chain outside ordinary attack range.
  // Its reachable endpoint must be inside this seed's airport firing range.
  let threat;
  for (const p of H.PLAYERS.slice(1)) {
    const home = g.players[p].home, previous = new Int32Array(H.COUNT).fill(-2), queue = [home]; previous[home] = -1;
    for (let n = 0; n < queue.length; n++) for (const j of H.ADJ[queue[n]]) if (previous[j] === -2 && (!g.board[j] || g.board[j] === p) && !H.inRange(g, 1, j)) {
      previous[j] = queue[n]; queue.push(j);
    }
    const target = queue.find(i => H.goalCell(g, p, i) && H.distance(airport, i) <= 12);
    if (target !== undefined) {
      for (let i = target; i !== -1; i = previous[i]) g.board[i] = p;
      threat = { owner: p, target }; break;
    }
  }
  assert.ok(threat); assert.equal(H.computeSupply(g, threat.owner)[threat.target], 1);
  const chosen = H.chooseAction(g.observation()); assert.equal(chosen.type, 'bombard'); assert.equal(chosen.cells[0], airport);
  const target = chosen.cells[1]; assert.equal(H.inRange(g, 1, target), false);
  assert.ok(g.act(chosen)); assert.equal(g.board[target], 0); assert.equal(H.computeSupply(g, threat.owner)[threat.target], 0);
  toTurn(g, 1); g.board[target] = threat.owner; g.players[1].supplies = 6; g.players[1].energy = 8;
  const cooling = H.chooseAction(g.observation()); assert.ok(H.legalAction(g.observation(), cooling)); assert.ok(!['airdrop', 'bombard'].includes(cooling.type));
});

test('AutoHex AI uses a supplied defensive airdrop while retaining a real opposite-edge route', () => {
  const { g, airport, cluster } = airportFixture();
  const goal = at(-18, 0); pathTo(g, goal); assert.equal(H.computeSupply(g, 1)[goal], 1);
  const facilities = new Set([...g.airports, ...g.depots].map(a => a.cell));
  const landing = H.CELLS.find(c => !g.board[c.i] && H.distance(c.i, airport) <= 4 && H.ADJ[c.i].some(i => cluster.includes(i))).i;
  const enemies = H.CELLS.filter(c => !g.board[c.i] && !g.anchors[c.i] && !facilities.has(c.i) &&
    H.distance(c.i, landing) <= 3 && H.distance(c.i, landing) >= 2 && H.ADJ[c.i].every(i => g.board[i] !== 1)).slice(0, 7).map(c => c.i);
  assert.equal(enemies.length, 7);
  for (const i of enemies) g.board[i] = 2;
  g.players[1].supplies = 3; g.players[1].energy = 6; g.hands[1] = [];
  const supplied = H.computeSupply(g, 1), chosen = H.chooseAction(g.observation());
  assert.equal(chosen.type, 'airdrop'); assert.equal(chosen.cells[0], airport); assert.ok(H.ADJ[chosen.cells[1]].some(i => g.board[i] === 1 && supplied[i]));
  assert.ok(g.act(chosen)); assert.ok(g.turrets.some(t => t.owner === 1 && t.cell === chosen.cells[1])); assert.equal(H.computeSupply(g, 1)[goal], 1);
});

test('AutoHex AI protects a publicly warned vulnerable airport with an available shield', () => {
  const { g, airport } = airportFixture(); g.hands[1] = ['shield'];
  g.neutralWarning = { kind: 'guerrilla', sector: H.sectorOf(airport), cells: [airport], resolveRound: g.round + 2 };
  const chosen = H.chooseAction(g.observation()); assert.equal(chosen.type, 'shield'); assert.deepEqual(chosen.cells, [airport]);
  assert.ok(g.act(chosen)); assert.ok(g.shields[airport] > 0);
});

test('AutoHex strategic observations expose public readiness but keep private hand/deck permutations out of AI choices', () => {
  const { g, airport } = airportFixture(); airTarget(g, airport, 12, 2); g.players[1].goalActive = true; g.hands[1] = [];
  g.neutralWarning = { kind: 'disaster', sector: 0, cells: [airport], resolveRound: g.round + 2 };
  const before = g.observation(1), chosen = H.chooseAction(before);
  for (const p of H.PLAYERS) if (p !== 1) g.hands[p] = g.hands[p].map((_, n) => n % 2 ? 'destroy' : 'shield');
  g.drawPile.reverse(); g.discardPile.reverse();
  assert.deepEqual(g.observation(1), before); assert.deepEqual(H.chooseAction(g.observation(1)), chosen);
  const view = g.observation(0), site = view.airports.find(a => a.cell === airport); assert.deepEqual(view.hand, []); assert.equal(site.active, true); assert.equal(view.players[1].supplies, 6);
  for (const key of ['hands', 'drawPile', 'discardPile', '_random', '_neutralRandom']) assert.equal(key in view, false);
  site.active = false; view.players[1].supplies = 999; view.age[airport] = 999; view.fortified[airport] = 1; view.neutralWarning.cells[0] = -1;
  assert.deepEqual(g.observation(1), before);
});

test('AutoHex final shared-top results do not break ties using airports, stock, fortifications or allies', () => {
  const { g, airport } = airportFixture(); g.players[1].supplies = 6; g.players[4].supplies = 0; g.fortified[airport] = 1; g.age[airport] = 31;
  g.alliances = [{ a: 1, b: 2, expiresRound: 99 }];
  for (const p of H.PLAYERS) g.players[p].score = p === 1 || p === 4 ? 25 : 3;
  g.advanceTime(600000); assert.equal(g.phase, 'over'); assert.equal(g.result.draw, true); assert.deepEqual(g.result.winners, [1, 4]);
  assert.ok(g.result.standings.filter(r => r.rank === 1).every(r => r.player === 1 || r.player === 4));
});

test('AutoHex neutral randomness does not alter the shared deck or seeded reshuffles', () => {
  const enabled = game({ seed: 'separate-neutral-rng', neutralEvents: true }), disabled = game({ seed: 'separate-neutral-rng', neutralEvents: false });
  for (let n = 0; n < 150; n++) {
    assert.ok(enabled.act(action('discard', [], { cardIndex: 0 }))); assert.ok(disabled.act(action('discard', [], { cardIndex: 0 })));
    assert.deepEqual(enabled.hands, disabled.hands); assert.deepEqual(enabled.drawPile, disabled.drawPile); assert.deepEqual(enabled.discardPile, disabled.discardPile);
  }
  assert.ok(enabled.telemetry.neutralWarnings >= 2); assert.ok(enabled.telemetry.reshuffles >= 2); assert.equal(disabled.telemetry.neutralWarnings, 0);
});
