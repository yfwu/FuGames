'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const H = require('../autohex-engine.js');
const {canonicalHomes}=require('./helpers/hex-tactical-fixture.cjs');
const center = H.index(0, 0), radius = i => H.distance(center, i);
function clean(seed = 'goal-priority') {
  const g = new H.Game({ seed, neutralEvents: false }); g.start();
  canonicalHomes(g,H); g.terrain.fill(0); g.roads.fill(0); g.board.set(g.anchors); g.shields.fill(0);
  g.bridges = []; g.turrets = []; g.alliances = []; g.offers = [];
  g.hands[1] = ['bridge', 'shield', 'destroy', 'turret', 'exchange']; g.players[1].energy = 8;
  return g;
}
function path(g, p, target) {
  const home = g.players[p].home, prev = new Int32Array(H.COUNT).fill(-2), queue = [home]; prev[home] = -1;
  for (let k = 0; k < queue.length && prev[target] === -2; k++) for (const i of H.ADJ[queue[k]]) if (prev[i] === -2 && (!g.board[i] || g.board[i] === p)) { prev[i] = queue[k]; queue.push(i); }
  assert.notEqual(prev[target], -2); const cells = [];
  for (let i = target; i !== -1; i = prev[i]) cells.push(i);
  return cells.reverse();
}
function holds(g, p) { const supplied = H.computeSupply(g, p); return H.CELLS.some(c => supplied[c.i] && H.goalCell(g, p, c.i)); }
function passableDistances(g, home) {
  const d = new Int16Array(H.COUNT).fill(-1), q = [home]; d[home] = 0;
  for (let k = 0; k < q.length; k++) for (const i of H.ADJ[q[k]]) if (d[i] < 0 && g.terrain[i] !== 1) { d[i] = d[q[k]] + 1; q.push(i); }
  return d;
}

test('seeded airports vary across central/middle/outer orbits with exact six-seat access symmetry', () => {
  const layouts = new Set(), radii = new Set();
  for (let seed = 1; seed <= 48; seed++) {
    const g = new H.Game({ seed }), sites = g.airports.map(a => a.cell);
    assert.deepEqual(sites, H.airportCells(seed)); assert.equal(new Set(sites).size, 6);
    layouts.add(sites.slice().sort((a,b)=>a-b).join(',')); radii.add(radius(sites[0]));
    for (const i of sites) {
      assert.ok(radius(i) >= 6 && radius(i) <= 13);
      const c = H.CELLS[i]; assert.ok(sites.includes(H.index(-c.r, -c.s)));
      for (const j of sites) if (i !== j) assert.ok(H.distance(i, j) >= 6);
      for (const d of g.depots) assert.ok(H.distance(i, d.cell) >= 3);
      for (const c of H.CELLS) if (H.distance(i, c.i) <= 2) assert.equal(g.terrain[c.i], 0);
    }
    const access = H.PLAYERS.map(p => {
      const d = passableDistances(g, g.players[p].home);
      assert.ok(sites.every(i => d[i] > 0)); return sites.map(i => d[i]).sort((a,b)=>a-b);
    });
    for (const a of access) assert.deepEqual(a, access[0]);
    for (const c of H.CELLS) assert.equal(g.terrain[c.i], g.terrain[H.index(-c.r, -c.s)]);
  }
  assert.ok(layouts.size >= 15, `${layouts.size} distinct layouts`);
  assert.ok(radii.has(6) && [...radii].some(r => r >= 7 && r <= 9) && [...radii].some(r => r >= 10));
});

test('airport placement is deterministic and independent of seat/profile rotation and private RNG consumption', () => {
  const a = new H.Game({ seed: 'placement-replay' }), b = new H.Game({ seed: 'placement-replay', first: 5, rotation: 3 });
  assert.deepEqual(a.airports, b.airports); assert.deepEqual(a.terrain, b.terrain); assert.deepEqual(a.hands, b.hands); assert.deepEqual(a.drawPile, b.drawPile);
  a.start(); for (let n = 0; n < 30; n++) a.act({ type: 'discard', cells: [], cardIndex: 0 });
  a.reset('placement-replay'); assert.deepEqual(a.airports, b.airports); assert.deepEqual(a.terrain, b.terrain);
  assert.deepEqual(new H.Game().airports.map(a => a.cell), H.AIRPORT_CELLS);
});

test('AI completes an opposite-edge route before unrelated facility development or combat', () => {
  const g = clean(), target = H.index(-18, 0), cells = path(g, 1, target);
  for (const i of cells.slice(0,-1)) g.board[i] = 1;
  const airport = g.airports[0]; g.board[airport.cell] = 1; g._refreshFacilities();
  const chosen = H.chooseAction(g.observation()); assert.ok(H.legalAction(g.observation(), chosen));
  assert.equal(chosen.type, 'deploy'); assert.ok(H.goalCell(g, 1, chosen.cells[0]));
  assert.ok(g.act(chosen)); assert.ok(holds(g,1));
});

test('AI repairs a severed supplied opposite-edge connection before collecting another facility', () => {
  const g = clean(), cells = path(g, 1, H.index(-18, 0));
  for (const i of cells) g.board[i] = 1;
  const gap = cells[Math.floor(cells.length / 2)]; g.board[gap] = 0;
  assert.equal(holds(g,1),false);
  const chosen = H.chooseAction(g.observation()); assert.ok(H.legalAction(g.observation(), chosen));
  assert.ok(['deploy','bridge','tunnel'].includes(chosen.type)); assert.ok(g.act(chosen)); assert.ok(holds(g,1));
});

test('AI interrupts a public enemy goal connection when in range', () => {
  const g = clean(), target = H.index(-10, -8), enemyPath = path(g, 2, target);
  for (const i of enemyPath) g.board[i] = 2;
  const approach = H.ADJ[target].find(i => !g.board[i] && !g.anchors[i]); assert.ok(approach !== undefined); g.board[approach] = 1;
  g.hands[1] = ['destroy']; assert.ok(holds(g,2));
  const chosen = H.chooseAction(g.observation()); assert.ok(H.legalAction(g.observation(), chosen));
  assert.ok(['deploy','destroy'].includes(chosen.type)); assert.ok(g.act(chosen)); assert.equal(holds(g,2), false);
});

test('AI shields a warned cut point on a held goal route', () => {
  const g = clean(), cells = path(g, 1, H.index(-18, 0)); for (const i of cells) g.board[i] = 1;
  const cut = cells[Math.floor(cells.length / 2)];
  g.neutralWarning = { kind: 'disaster', cells: [cut], resolveRound: g.round + 2 }; g.hands[1] = ['shield'];
  const chosen = H.chooseAction(g.observation()); assert.equal(chosen.type, 'shield'); assert.deepEqual(chosen.cells, [cut]);
});

test('goal planning reads the public observation and ignores private hand/deck permutations', () => {
  const g = clean('goal-private'), before = g.observation(), expected = H.chooseAction(before);
  g.hands[2].reverse(); g.hands[3] = ['destroy','destroy','destroy','destroy','destroy']; g.drawPile.reverse(); g.discardPile = g.discardPile.reverse();
  assert.deepEqual(H.chooseAction(g.observation()), expected); assert.deepEqual(g.observation().airports, before.airports);
  assert.equal(H.chooseAction(g.observation(0)), null);
});
