'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../autohex-engine.js');
const at = H.index, center = at(0, 0), plain = value => JSON.parse(JSON.stringify(value));
const action = (type, cells = [], extra = {}) => ({ type, cells, ...extra });
function game(options = {}) { const g = new H.Game({ seed: 'autohex-fixture', ...options }); g.start(); return g; }
function fixture(cards = [], player = 1) {
  const g = game(); g.board.fill(0); g.terrain.fill(0); g.roads.fill(0); g.anchors.fill(0); g.shields.fill(0);
  g.bridges = []; g.turrets = []; g.offers = []; g.alliances = []; g.turn = player;
  g.board[center] = player; g.hands[player] = cards.slice(); g.players[player].energy = 8;
  return g;
}
function sameInvalid(g, a) { const before = JSON.stringify(g); assert.equal(g.act(a), false, JSON.stringify(a)); assert.equal(JSON.stringify(g), before, 'Rejected action mutated state'); }
function restUntil(g, player) { for (let n = 0; g.turn !== player && n < 6; n++) assert.ok(g.act(action('rest'))); assert.equal(g.turn, player); }
function completeRounds(g, n) { const stop = g.round + n; while (g.round < stop) assert.ok(g.act(action('rest'))); }
const cards = g => [...g.drawPile, ...g.discardPile, ...H.PLAYERS.flatMap(p => g.hands[p])].sort();

test('AutoHex geometry is radius 18 / 1,027 cells with reciprocal neighbors and six directed edge goals', () => {
  assert.equal(H.RADIUS, 18); assert.equal(H.COUNT, 1027); assert.equal(H.CELLS.length, 1027);
  assert.deepEqual(Array.from(H.PLAYERS), [1, 2, 3, 4, 5, 6]);
  for (const c of H.CELLS) {
    assert.equal(c.q + c.r + c.s, 0); assert.equal(at(c.q, c.r), c.i);
    assert.ok(Math.max(Math.abs(c.q), Math.abs(c.r), Math.abs(c.s)) <= 18);
    for (const j of H.ADJ[c.i]) { assert.equal(H.distance(c.i, j), 1); assert.ok(H.ADJ[j].includes(c.i)); }
  }
  assert.ok(at(19, 0) < 0); assert.ok(at(0, -19) < 0);
  const g = game(), directions = new Set(), axes = {};
  for (const p of H.PLAYERS) {
    const f = g.players[p], home = H.CELLS[f.home];
    assert.ok(['q', 'r', 's'].includes(f.axis)); assert.ok(f.sign === 1 || f.sign === -1);
    assert.equal(home[f.axis], f.sign * 18); assert.equal(g.anchors[f.home], p); assert.equal(g.board[f.home], p);
    assert.equal(H.CELLS.filter(c => c[f.axis] === -f.sign * 18).length, 19);
    directions.add(f.axis + ':' + f.sign); (axes[f.axis] ||= []).push(f.sign);
  }
  assert.equal(directions.size, 6);
  assert.deepEqual(Object.values(axes).map(s => s.sort()), [[-1, 1], [-1, 1], [-1, 1]]);
});

test('AutoHex terrain is seeded, sixfold symmetric and each home has an occupiable foothold', () => {
  const layouts = new Set();
  for (let seed = 0; seed < 32; seed++) {
    const g = game({ seed }), again = game({ seed }); layouts.add(Array.from(g.terrain).join());
    assert.deepEqual(g.terrain, again.terrain);
    for (const c of H.CELLS) assert.equal(g.terrain[c.i], g.terrain[at(-c.r, -c.s)]);
    for (const p of H.PLAYERS) {
      const owned = H.CELLS.filter(c => g.board[c.i] === p);
      assert.ok(owned.length >= 2); assert.ok(owned.every(c => g.terrain[c.i] !== 1 || g.roads[c.i]));
      assert.ok(H.ADJ[g.players[p].home].some(i => g.board[i] === p));
    }
  }
  assert.ok(layouts.size >= 16, 'Seeds must produce more than a cosmetic terrain variation');
});

test('AutoHex range permits distance 5 and rejects distance 6 using only pre-action own stones', () => {
  const g = fixture(), near = at(5, 0), far = at(6, 0);
  assert.equal(H.inRange(g, 1, near), true); assert.equal(H.inRange(g, 1, far), false);
  assert.equal(H.legalAction(g.observation(), action('deploy', [near])), true);
  sameInvalid(g, action('deploy', [far]));
  g.board[at(7, 0)] = 2; g.alliances = [{ a: 1, b: 2, expiresRound: 999 }];
  assert.equal(H.inRange(g, 1, far), false); sameInvalid(g, action('deploy', [far]));
  g.board[at(7, 0)] = 1;
  assert.equal(H.inRange(g, 1, far), true); assert.equal(g.act(action('deploy', [far])), true);
});

test('AutoHex river occupation requires public engineering and engineering itself obeys range', () => {
  const g = fixture(['turret', 'exchange']), near = at(5, 0), far = at(6, 0);
  g.terrain[near] = g.terrain[far] = 1;
  sameInvalid(g, action('deploy', [near])); sameInvalid(g, action('turret', [near])); sameInvalid(g, action('engineer', [far]));
  assert.ok(g.act(action('engineer', [near]))); assert.equal(g.roads[near], 1); assert.equal(g.board[near], 0);
  restUntil(g, 1); assert.ok(g.act(action('deploy', [near]))); assert.equal(g.board[near], 1);
});

test('AutoHex hills add one defense while shields absorb one demolition without changing ownership', () => {
  const g = fixture(), target = at(1, 0); g.board[target] = 2;
  assert.ok(H.legalAction(g.observation(), action('deploy', [target])));
  g.terrain[target] = 2; sameInvalid(g, action('deploy', [target]));
  g.board[at(1, -1)] = 1; assert.ok(g.act(action('deploy', [target]))); assert.equal(g.board[target], 1);
  const shield = fixture(['destroy', 'destroy']); shield.board[target] = 2; shield.shields[target] = 8;
  assert.ok(shield.act(action('destroy', [target]))); assert.equal(shield.board[target], 2); assert.equal(shield.shields[target], 0);
  restUntil(shield, 1); assert.ok(shield.act(action('destroy', [target]))); assert.equal(shield.board[target], 0);
});

test('AutoHex every spatial card applies the same public range; invalid pair/triple actions are atomic', () => {
  for (const type of ['turret', 'destroy', 'shield', 'bridge', 'reroute', 'exchange']) assert.ok(H.CARD_META[type], type);
  for (const type of ['turret', 'destroy']) {
    const g = fixture([type]), far = at(6, 0); if (type === 'destroy') g.board[far] = 2;
    sameInvalid(g, action(type, [far]));
  }
  const shield = fixture(['shield']); sameInvalid(shield, action('shield', [at(6, 0)]));
  const exchange = fixture(['exchange']); exchange.board[at(5, 0)] = 2;
  sameInvalid(exchange, action('exchange', [at(5, 0), at(6, 0)]));
  const bridge = fixture(['bridge']); sameInvalid(bridge, action('bridge', [center, at(6, 0)]));
  const reroute = fixture(['reroute']); reroute.board[at(2, 0)] = 1; reroute.bridges = [{ owner: 1, a: center, b: at(2, 0) }];
  sameInvalid(reroute, action('reroute', [center, at(2, 0), at(6, 0)]));
  for (const type of ['turret', 'destroy', 'shield', 'bridge', 'reroute', 'exchange']) {
    const g = fixture([type]), n = H.CARD_META[type].slots;
    assert.ok(Number.isInteger(n) && n >= 1 && n <= 3, `${type} has a documented arity`);
    sameInvalid(g, action(type, Array(n).fill(-1)));
    sameInvalid(g, action(type, Array(n).fill(H.COUNT)));
    sameInvalid(g, action(type, Array(n).fill(NaN)));
    sameInvalid(g, action(type, Array(n).fill(center).concat(center)));
  }
});

test('AutoHex all six spatial cards have legal positive fixtures, including remote own bridge/reroute endpoints', () => {
  const turret = fixture(['turret']); turret.board[at(5, 0)] = 1;
  assert.ok(turret.act(action('turret', [at(5, 0)]))); assert.equal(turret.board[at(5, 0)], 1);
  const destroy = fixture(['destroy']); destroy.board[at(5, 0)] = 2; assert.ok(destroy.act(action('destroy', [at(5, 0)])));
  const shield = fixture(['shield']); assert.ok(shield.act(action('shield', [center]))); assert.ok(shield.shields[center] > 0);
  const bridge = fixture(['bridge']); bridge.board[at(10, 0)] = bridge.board[at(12, 0)] = 1;
  assert.ok(bridge.act(action('bridge', [at(10, 0), at(12, 0)]))); assert.equal(bridge.bridges.length, 1);
  const reroute = fixture(['reroute']); reroute.board[at(10, 0)] = reroute.board[at(12, 0)] = reroute.board[at(10, 2)] = 1;
  reroute.bridges = [{ owner: 1, a: at(10, 0), b: at(12, 0) }];
  assert.ok(reroute.act(action('reroute', [at(10, 0), at(12, 0), at(10, 2)]))); assert.equal(reroute.bridges.length, 1);
  assert.deepEqual(new Set([reroute.bridges[0].a, reroute.bridges[0].b]), new Set([at(10, 0), at(10, 2)]));
  const exchange = fixture(['exchange']); exchange.board[at(1, 0)] = 2;
  assert.ok(exchange.act(action('exchange', [center, at(1, 0)]))); assert.equal(exchange.board[at(1, 0)], 1); assert.equal(exchange.board[center], 2);
});

test('AutoHex bridge geometry rejects duplicate/reverse/partial overlap/crossing/T but permits shared endpoints', () => {
  const cases = [
    [[at(-2, 0), center], [at(-2, 0), center], true],
    [[at(-2, 0), center], [center, at(-2, 0)], true],
    [[at(-2, 0), center], [at(-1, 0), at(1, 0)], true],
    [[at(-1, 0), at(1, 0)], [at(0, -1), at(0, 1)], true],
    [[at(-1, 0), at(1, 0)], [center, at(0, 2)], true],
    [[at(-2, 0), center], [center, at(2, 0)], false],
    [[at(-2, 0), center], [center, at(0, 2)], false],
    [[at(-2, 0), center], [at(1, -1), at(1, 1)], false]
  ];
  for (const [old, next, conflict] of cases) {
    assert.equal(H.bridgeConflict(...old, ...next), conflict, JSON.stringify({ old, next }));
    assert.equal(H.bridgesConflict({ a: old[0], b: old[1] }, { a: next[0], b: next[1] }), conflict);
    for (const owner of H.PLAYERS) {
      const g = fixture(['bridge']); g.bridges = [{ owner, a: old[0], b: old[1] }];
      for (const i of next) g.board[i] = 1;
      assert.equal(H.legalAction(g.observation(), action('bridge', next)), !conflict, `Collision must include owner ${owner}`);
      if (conflict) sameInvalid(g, action('bridge', next));
    }
  }
});

test('AutoHex finite shared deck conserves its recipe through draws, discards and repeated reshuffles', () => {
  const g = game(), initial = cards(g), initialHand = g.hands[1].length, types = new Set(initial);
  assert.ok(initial.length >= 6 * initialHand); assert.equal(types.size, 6);
  for (const p of H.PLAYERS) assert.equal(g.hands[p].length, initialHand);
  let reshuffles = 0, previousDraw = g.drawPile.length;
  for (let n = 0; n < 420; n++) {
    const p = g.turn; assert.ok(g.hands[p].length);
    assert.ok(g.act(action('discard', [], { cardIndex: 0 })));
    if (g.drawPile.length > previousDraw) reshuffles++;
    previousDraw = g.drawPile.length;
    assert.deepEqual(cards(g), initial);
    for (const other of H.PLAYERS) assert.ok(g.hands[other].length <= 5);
  }
  assert.ok(reshuffles >= 3, 'Deck must recycle repeatedly during a long campaign');
  assert.equal(g.activeMs, 0, 'Turns alone never pretend real time elapsed');
});

test('AutoHex hand cap, equal replenishment and ordinary action/energy budgets apply to all six seats', () => {
  const g = game(), initial = cards(g), draws = Object.fromEntries(H.PLAYERS.map(p => [p, 0]));
  completeRounds(g, 8);
  for (const p of H.PLAYERS) { assert.equal(g.hands[p].length, 5); assert.equal(g.players[p].energy, 8); }
  const deckLength = g.drawPile.length; completeRounds(g, 2); assert.equal(g.drawPile.length, deckLength);
  for (let n = 0; n < 60; n++) {
    const p = g.turn, before = g.ply; assert.ok(g.act(action('discard', [], { cardIndex: 0 })));
    draws[p]++; assert.equal(g.ply, before + 1); assert.notEqual(g.turn, p); assert.deepEqual(cards(g), initial);
  }
  assert.deepEqual(Object.values(draws), [10, 10, 10, 10, 10, 10]);
  for (const p of H.PLAYERS) assert.ok(g.hands[p].length >= 4 && g.hands[p].length <= 5);
  const p = g.turn; g.players[p].energy = 0;
  const empty = H.ADJ[g.players[p].home].find(i => !g.board[i]);
  if (empty !== undefined) { g.terrain[empty] = 0; sameInvalid(g, action('deploy', [empty])); }
  assert.ok(g.act(action('rest'))); restUntil(g, p); assert.ok(g.players[p].energy > 0 && g.players[p].energy <= 8);
});

test('AutoHex private hands and draw order never reach observers or influence the current AI decision', () => {
  const g = game(); for (let n = 0; n < 18; n++) assert.ok(g.act(action('rest')));
  const actor = g.turn, before = plain(g.observation(actor)), chosen = plain(H.chooseAction(before));
  for (const p of H.PLAYERS) if (p !== actor) g.hands[p] = g.hands[p].map((_, i) => i % 2 ? 'destroy' : 'shield');
  g.drawPile.reverse(); g.discardPile.reverse();
  assert.deepEqual(plain(g.observation(actor)), before); assert.deepEqual(plain(H.chooseAction(g.observation(actor))), chosen);
  for (const viewer of [0, ...H.PLAYERS]) {
    const observation = g.observation(viewer);
    for (const key of ['hands', 'drawPile', 'discardPile', 'random', 'rng', 'deckOrder']) assert.equal(key in observation, false, key);
    assert.deepEqual(Array.from(observation.hand), viewer ? Array.from(g.hands[viewer]) : []);
    assert.equal(observation.drawCount, g.drawPile.length); assert.equal(observation.discardCount, g.discardPile.length);
  }
  const view = g.observation(actor), oldOwner = g.board[center]; view.board[center] = 6; view.hand.push('destroy');
  assert.equal(g.board[center], oldOwner); assert.deepEqual(plain(g.observation(actor)), before, 'Observation mutation cannot edit the engine');
});

test('AutoHex diplomacy needs consent, consumes turns, exposes pacts and supports rejection/expiry', () => {
  const g = game(); const ply = g.ply;
  assert.ok(g.act(action('offer', [], { target: 2 }))); assert.equal(g.ply, ply + 1); assert.equal(g.alliances.length, 0);
  assert.equal(g.offers.length, 1); assert.equal(g.offers[0].from, 1); assert.equal(g.offers[0].to, 2);
  assert.ok(g.act(action('accept', [], { target: 1 }))); assert.equal(g.ply, ply + 2); assert.equal(g.alliances.length, 1); assert.equal(g.offers.length, 0);
  const expiry = g.alliances[0].expiresRound;
  assert.ok(expiry > g.round); assert.ok(g.observation(0).alliances.length);
  while (g.round <= expiry) completeRounds(g, 1);
  assert.equal(g.alliances.length, 0);
  const reject = game(); assert.ok(reject.act(action('offer', [], { target: 2 }))); assert.ok(reject.act(action('reject', [], { target: 1 })));
  assert.equal(reject.offers.length, 0); assert.equal(reject.alliances.length, 0); assert.equal(reject.ply, 2);
  const offer = game(); assert.ok(offer.act(action('offer', [], { target: 2 }))); const expires = offer.offers[0].expiresRound;
  while (offer.round <= expires) completeRounds(offer, 1);
  assert.equal(offer.offers.length, 0); restUntil(offer, 2); sameInvalid(offer, action('accept', [], { target: 1 }));
});

test('AutoHex pacts block ally attacks until an explicit costly betrayal and enforce limits/cooldowns', () => {
  const g = fixture(['destroy', 'exchange']); g.board[at(1, 0)] = 2;
  g.alliances = [{ a: 1, b: 2, expiresRound: 999 }]; g.players[1].score = 10;
  sameInvalid(g, action('deploy', [at(1, 0)])); sameInvalid(g, action('destroy', [at(1, 0)])); sameInvalid(g, action('exchange', [center, at(1, 0)]));
  const before = { ply: g.ply, energy: g.players[1].energy, score: g.players[1].score };
  assert.ok(g.act(action('betray', [], { target: 2 })));
  assert.equal(g.ply, before.ply + 1); assert.equal(g.alliances.length, 0);
  assert.ok(g.players[1].energy < before.energy); assert.ok(g.players[1].score < before.score);
  assert.ok(g.players[1].diplomacyUntil > g.round);
  restUntil(g, 1); sameInvalid(g, action('offer', [], { target: 2 }));
  assert.ok(H.legalAction(g.observation(), action('destroy', [at(1, 0)])));
  const full = fixture(); full.alliances = [{ a: 1, b: 2, expiresRound: 999 }, { a: 1, b: 3, expiresRound: 999 }];
  sameInvalid(full, action('offer', [], { target: 4 })); sameInvalid(full, action('offer', [], { target: 1 }));
  const cooldown = game(); assert.ok(cooldown.act(action('offer', [], { target: 2 }))); restUntil(cooldown, 1); sameInvalid(cooldown, action('offer', [], { target: 3 }));
});

test('AutoHex automatic turrets honor an active pact and can target the former ally after betrayal', () => {
  const g = fixture(); g.players[1].home = center; g.anchors[center] = 1;
  const gun = at(1, 0), ally = at(1, 1), enemy = at(2, 0);
  g.board[gun] = 1; g.board[ally] = 2; g.board[enemy] = 3;
  g.turrets = [{ owner: 1, cell: gun, countdown: 1, life: 30 }];
  g.alliances = [{ a: 1, b: 2, expiresRound: 999 }]; g.turn = 6;
  assert.ok(g.act(action('rest'))); assert.equal(g.turn, 1);
  assert.equal(g.board[ally], 2); assert.equal(g.board[enemy], 0);
  assert.ok(g.act(action('betray', [], { target: 2 })));
  for (let n = 0; n < 3; n++) { restUntil(g, 1); assert.ok(g.act(action('rest'))); }
  assert.equal(g.board[ally], 0); assert.ok(g.telemetry.turretShots >= 2);
});

test('AutoHex 96-stone cap permits voluntary withdrawal and rebuilding', () => {
  const g = fixture(), occupied = H.CELLS.slice().sort((a, b) => H.distance(a.i, center) - H.distance(b.i, center)).slice(0, 96);
  for (const c of occupied) g.board[c.i] = 1;
  const target = H.CELLS.find(c => !g.board[c.i] && H.ADJ[c.i].some(i => g.board[i] === 1)).i;
  sameInvalid(g, action('deploy', [target]));
  assert.ok(g.act(action('withdraw', [occupied.at(-1).i]))); assert.equal(g.board.filter(o => o === 1).length, 95);
  restUntil(g, 1); assert.ok(g.act(action('deploy', [target]))); assert.equal(g.board.filter(o => o === 1).length, 96);
});

test('AutoHex six profile rotations give each seat every profile with unchanged seed/deck/terrain rules', () => {
  const baseline = new H.Game({ seed: 'profile-rotation', rotation: 0 });
  const perSeat = H.PLAYERS.map(() => new Set());
  for (let rotation = 0; rotation < 6; rotation++) {
    const g = new H.Game({ seed: 'profile-rotation', rotation });
    assert.deepEqual(g.board, baseline.board); assert.deepEqual(g.terrain, baseline.terrain); assert.deepEqual(g.hands, baseline.hands); assert.deepEqual(g.drawPile, baseline.drawPile);
    for (const p of H.PLAYERS) { perSeat[p - 1].add(g.players[p].profile.name); assert.equal(g.players[p].score, 0); assert.equal(g.players[p].energy, baseline.players[p].energy); }
  }
  for (const profiles of perSeat) assert.equal(profiles.size, 6);
});

test('AutoHex supply follows home-connected own neighbors and own bridges, not enemy/allied stones', () => {
  const g = fixture(); g.players[1].home = center; g.anchors[center] = 1;
  g.board[at(1, 0)] = 1; g.board[at(2, 0)] = 2; g.board[at(3, 0)] = 1;
  g.alliances = [{ a: 1, b: 2, expiresRound: 999 }];
  let supply = H.computeSupply(g, 1);
  assert.equal(supply[center], 1); assert.equal(supply[at(1, 0)], 1); assert.equal(supply[at(3, 0)], 0);
  g.bridges = [{ owner: 2, a: at(1, 0), b: at(3, 0) }]; assert.equal(H.computeSupply(g, 1)[at(3, 0)], 0);
  g.bridges[0].owner = 1; assert.equal(H.computeSupply(g, 1)[at(3, 0)], 1);
  g.bridges = []; g.board[at(2, 0)] = 1; assert.equal(H.computeSupply(g, 1)[at(3, 0)], 1);
});

test('AutoHex unsupplied fronts retreat after six owner turns and reconnection preserves recovered stones', () => {
  const g = fixture(); g.players[1].home = center; g.anchors[center] = 1; const remote = at(4, 0); g.board[remote] = 1;
  for (let ownTurn = 1; ownTurn <= 6; ownTurn++) {
    restUntil(g, 1); assert.ok(g.act(action('rest')));
    assert.equal(g.board[remote], ownTurn < 6 ? 1 : 0, `Owner turn ${ownTurn}`);
    assert.equal(g.board[center], 1);
  }
  const repaired = fixture(); repaired.players[1].home = center; repaired.anchors[center] = 1; repaired.board[at(2, 0)] = 1;
  for (let n = 0; n < 4; n++) { restUntil(repaired, 1); assert.ok(repaired.act(action('rest'))); }
  restUntil(repaired, 1); assert.ok(repaired.act(action('deploy', [at(1, 0)]))); completeRounds(repaired, 7);
  assert.equal(repaired.board[at(2, 0)], 1); assert.equal(H.computeSupply(repaired, 1)[at(2, 0)], 1);
});

test('AutoHex permanent anchors survive hostile cards and allow rebuilding after every other stone is lost', () => {
  for (const p of H.PLAYERS) {
    const g = game(), home = g.players[p].home;
    for (const c of H.CELLS) if (g.board[c.i] === p && c.i !== home) g.board[c.i] = 0;
    g.turn = p; g.players[p].energy = 8;
    sameInvalid(g, action('withdraw', [home]));
    const neighbor = H.ADJ[home].find(i => !g.board[i]); assert.ok(neighbor !== undefined); g.terrain[neighbor] = 0;
    assert.ok(g.act(action('deploy', [neighbor]))); assert.equal(g.board[neighbor], p); assert.equal(g.board[home], p);
    const attacker = p % 6 + 1; g.turn = attacker; g.players[attacker].energy = 8; g.hands[attacker] = ['destroy', 'exchange'];
    const approach = H.ADJ[home].find(i => i !== neighbor && !g.anchors[i]); assert.ok(approach !== undefined); g.board[approach] = attacker;
    sameInvalid(g, action('destroy', [home])); sameInvalid(g, action('exchange', [approach, home])); sameInvalid(g, action('deploy', [home]));
    assert.equal(g.board[home], p);
  }
});

function independentlyFillGoalRoute(g, player) {
  const f = g.players[player], previous = new Int32Array(H.COUNT).fill(-2), queue = [f.home]; previous[f.home] = -1;
  let goal = -1;
  for (let read = 0; read < queue.length; read++) {
    const i = queue[read];
    if (H.CELLS[i][f.axis] === -f.sign * H.RADIUS) { goal = i; break; }
    for (const j of H.ADJ[i]) if (previous[j] === -2 && (!g.board[j] || g.board[j] === player) && (!g.anchors[j] || g.anchors[j] === player)) {
      previous[j] = i; queue.push(j);
    }
  }
  assert.ok(goal >= 0, 'Independent breadth-first route must reach an unblocked goal edge');
  for (let i = goal; i !== -1; i = previous[i]) g.board[i] = player;
  return goal;
}

test('AutoHex each directed opposite-edge arrival scores and keeps the campaign running, then holding scores', () => {
  for (const p of H.PLAYERS) {
    const g = game(); g.terrain.fill(0); for (const c of H.CELLS) g.board[c.i] = g.anchors[c.i];
    const goal = independentlyFillGoalRoute(g, p), before = g.players[p].score;
    assert.equal(H.computeSupply(g, p)[goal], 1); completeRounds(g, 1);
    assert.ok(g.players[p].score > before, `Directed route ${p} did not score`); assert.equal(g.phase, 'running'); assert.equal(g.result, null);
    const reached = g.players[p].score; completeRounds(g, 1); assert.ok(g.players[p].score > reached, `Holding route ${p} did not score`);
    for (const other of H.PLAYERS) if (other !== p) assert.equal(g.players[other].score, 0, 'An antipodal axis is not an automatic alliance/shared-axis score');
  }
});

test('AutoHex antipodal factions can score distinct supplied routes together at a round boundary', () => {
  const g = game(); g.terrain.fill(0); for (const c of H.CELLS) g.board[c.i] = g.anchors[c.i];
  const a = 1, b = H.PLAYERS.find(p => p !== a && g.players[p].axis === g.players[a].axis);
  assert.ok(b); independentlyFillGoalRoute(g, a); independentlyFillGoalRoute(g, b);
  completeRounds(g, 1); assert.ok(g.players[a].score > 0); assert.ok(g.players[b].score > 0);
  assert.equal(g.players[a].score, g.players[b].score); assert.equal(g.result, null); assert.equal(g.phase, 'running');
});

test('AutoHex only running foreground clock reaches timeout, results are simultaneous and sandbox is explicit', () => {
  const g = new H.Game({ seed: 123 });
  g.advanceTime(120000); assert.equal(g.activeMs, 0); assert.equal(g.phase, 'ready');
  sameInvalid(g, action('rest')); g.start(); g.advanceTime(120000); assert.equal(g.activeMs, 120000);
  g.pause(); g.advanceTime(120000); assert.equal(g.activeMs, 120000); sameInvalid(g, action('rest'));
  g.start(); for (const p of H.PLAYERS) g.players[p].score = p === 2 || p === 5 ? 44 : 17;
  g.alliances = [{ a: 2, b: 3, expiresRound: 999 }];
  g.advanceTime(480000); assert.equal(g.activeMs, 600000); assert.equal(g.phase, 'over'); assert.ok(g.result);
  assert.ok(Array.isArray(g.result.winners)); assert.deepEqual(Array.from(g.result.winners).sort(), [2, 5]);
  const result = plain(g.result); g.advanceTime(999999); assert.equal(g.activeMs, 600000); assert.deepEqual(plain(g.result), result);
  sameInvalid(g, action('rest')); g.continueSandbox(); assert.equal(g.phase, 'running'); assert.equal(g.sandbox, true); assert.ok(g.act(action('rest')));
  g.reset(456, 3, 2); assert.equal(g.phase, 'ready'); assert.equal(g.activeMs, 0); assert.equal(g.turn, 3); assert.equal(g.ply, 0); assert.equal(g.result, null); assert.equal(g.sandbox, false);
});

test('AutoHex invalid clock deltas and malformed actions do not corrupt or advance state', () => {
  const g = game();
  for (const delta of [-1, NaN, Infinity, -Infinity]) { g.advanceTime(delta); assert.equal(g.activeMs, 0); }
  for (const a of [null, {}, action('unknown'), action('deploy', []), action('deploy', [-1]), action('deploy', [H.COUNT]), action('deploy', [1.5]), action('discard', [], { cardIndex: -1 }), action('offer', [], { target: 7 })]) sameInvalid(g, a);
});

test('AutoHex reset clears previous actions, score, elapsed time, diplomacy and hidden shuffle state', () => {
  const g = game(); assert.ok(g.act(action('offer', [], { target: 2 }))); assert.ok(g.act(action('accept', [], { target: 1 })));
  g.advanceTime(12345); g.players[1].score = 87;
  assert.ok(g.lastAction); g.reset('fresh-seed', 6, 4);
  const fresh = new H.Game({ seed: 'fresh-seed', first: 6, rotation: 4 });
  assert.deepEqual(g.observation(0), fresh.observation(0)); assert.deepEqual(g.hands, fresh.hands); assert.deepEqual(g.drawPile, fresh.drawPile);
  assert.equal(g.lastAction, null);
});

test('AutoHex deterministic seeded replay has legal bounded actions and no dependence on wall time', () => {
  function run(seed, rotation) {
    const g = game({ seed, first: 4, rotation }), recipe = cards(g), trace = [];
    for (let n = 0; n < 180; n++) {
      const a = H.chooseAction(g.observation()); assert.ok(H.legalAction(g.observation(), a)); assert.ok(g.act(a), JSON.stringify(a));
      trace.push(a); assert.deepEqual(cards(g), recipe);
      assert.ok(g.events.length <= 96); assert.ok(g.bridges.length <= 6 * 96); assert.ok(g.turrets.length <= 6 * 96);
      for (const p of H.PLAYERS) { assert.ok(g.hands[p].length <= 5); assert.ok(g.board.filter(o => o === p).length <= 96); }
      g.advanceTime(300);
    }
    return JSON.stringify({ trace, observation: g.observation(0), recipe });
  }
  assert.equal(run('repeatable', 2), run('repeatable', 2));
  assert.notEqual(run('other-seed', 2), run('repeatable', 2));
});
