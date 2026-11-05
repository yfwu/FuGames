'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const E = require('../hexbattle/engine.js');
const AI = require('../hexbattle/ai.js');
const T = require('../hexbattle/text.js');

const root = path.join(__dirname, '..');
function playOut(st, profiles = AI.PROFILE_ORDER, limit = 4000) {
  const log = [];
  for (let k = 0; k < limit && st.phase !== 'over'; k++) {
    const id = E.currentPlayer(st);
    for (const a of AI.playTurn(st, id, profiles[(id - 1) % profiles.length])) log.push({ player: id, action: a });
  }
  return log;
}

test('maps have full hexagonal symmetry for every player count', () => {
  for (const n of [2, 3, 4, 5, 6]) for (const seed of ['a', 'b', 'c']) {
    const st = E.createGame({ seed, players: n }), g = E.geometry(st.map.R);
    for (let i = 0; i < g.count; i++) {
      const { q, r } = g.cells[i];
      for (const [a, b] of [[r, q], [-r, q + r]]) {
        const j = g.index(a, b);
        assert.equal(st.map.terrain[j], st.map.terrain[i]);
        assert.equal(st.map.feature[j], st.map.feature[i]);
      }
    }
    const caps = st.buildings.filter(b => b.type === 'capital');
    assert.equal(caps.length, n);
    const d = caps.map(b => g.dist(b.cell, st.map.center));
    assert.ok(d.every(x => x === d[0]), 'capitals equidistant from the centre');
  }
});

test('every capital can walk to the centre and to its relics', () => {
  for (const seed of ['p1', 'p2', 'p3', 'p4']) {
    const st = E.createGame({ seed, players: 6 });
    for (const cap of st.buildings.filter(b => b.type === 'capital')) {
      const field = E.distanceField(st, cap.owner, cap.cell);
      assert.ok(Number.isFinite(field[st.map.center]), 'centre reachable');
      for (const r of st.map.relics) assert.ok(Number.isFinite(field[r]), 'relic reachable');
    }
  }
});

test('the same seed and actions replay to the same state, also through JSON', () => {
  const a = E.createGame({ seed: 'replay', players: 4 });
  const log = playOut(a);
  assert.equal(a.phase, 'over');
  const b = E.createGame({ seed: 'replay', players: 4 });
  for (const { player, action } of log) assert.ok(E.act(b, player, action).ok, JSON.stringify(action));
  assert.deepEqual(b, a);
  // pause mid-game through JSON and continue
  const c = E.createGame({ seed: 'replay', players: 4 });
  const half = Math.floor(log.length / 2);
  for (const { player, action } of log.slice(0, half)) E.act(c, player, action);
  const d = JSON.parse(JSON.stringify(c));
  for (const { player, action } of log.slice(half)) E.act(d, player, action);
  assert.deepEqual(d, a);
});

test('bots finish 2-6 player games with a winner', () => {
  for (const n of [2, 3, 5, 6]) {
    const st = E.createGame({ seed: 'finish' + n, players: n });
    playOut(st);
    assert.equal(st.phase, 'over');
    assert.ok(st.winner >= 1 && st.winner <= n);
    assert.ok(['victory points', 'round limit', 'conquest'].includes(st.result.reason));
  }
});

test('every listed legal action is accepted (random play fuzz)', () => {
  let x = 7; const rnd = () => (x = (x * 1103515245 + 12345) >>> 0) / 4294967296;
  for (const seed of ['fuzz1', 'fuzz2']) {
    const st = E.createGame({ seed, players: 3, maxRounds: 10 });
    let steps = 0, perTurn = 0, last = 0;
    while (st.phase !== 'over' && steps++ < 6000) {
      const id = E.currentPlayer(st);
      if (id !== last) { perTurn = 0; last = id; }
      const legal = E.legalActions(st, id);
      assert.ok(legal.some(a => a.type === 'end'));
      const a = perTurn++ > 12 ? { type: 'end' } : legal[Math.floor(rnd() * legal.length)];
      const r = E.act(st, id, a);
      assert.ok(r.ok, JSON.stringify(a) + ' ' + r.error);
    }
    assert.equal(st.phase, 'over');
  }
});

test('observations hide other hands, decks, traps and units in the fog', () => {
  const st = E.createGame({ seed: 'fog', players: 4 });
  for (let r = 0; r < 6 * 4; r++) AI.playTurn(st, E.currentPlayer(st), 'balanced');
  const obs = E.observe(st, 1), vis = E.visibleSet(st, 1);
  const text = JSON.stringify(obs);
  for (const p of st.players.filter(p => p.id !== 1)) for (const c of p.hand) assert.ok(!obs.hand.some(h => h.id === c.id));
  assert.ok(!('deck' in obs.players[1]) && !('hand' in obs.players[1]));
  for (const u of obs.units) if (u.owner !== 1) assert.ok(vis[u.cell], 'enemy unit must be visible');
  for (const u of obs.units) if (u.owner !== 1) assert.ok(!('goal' in u) && !('stance' in u));
  for (const t of st.traps.filter(t => t.owner !== 1)) assert.ok(!obs.traps.includes(t.cell));
  assert.ok(!text.includes('"rng"'));
});

test('a relic scores only while no hostile unit stands on or next to it', () => {
  const st = E.createGame({ seed: 'relic', players: 2 });
  const relic = st.map.relics.find(r => r !== st.map.center);
  st.owner[relic] = 1;
  assert.equal(E.relicHeld(st, 1, relic), false, 'sentinels deny it');
  st.units = st.units.filter(u => u.owner !== 0);
  assert.equal(E.relicHeld(st, 1, relic), true);
});

test('food feeds units first, then building workers; hungry buildings stop', () => {
  const st = E.createGame({ seed: 'food', players: 2 });
  const p = st.players[0], g = E.geometry(st.map.R), cap = st.buildings.find(b => b.owner === 1);
  const spot = g.adj[cap.cell].find(j => !E.buildingAt(st, j) && E.TERRAIN[st.map.terrain[j]].build);
  st.buildings.push({ id: 9001, type: 'market', owner: 1, cell: spot, hp: 6, max: 6, armor: 0, disabled: 0, built: 0 });
  E.computeTerritory(st);
  p.res.food = 0;
  for (let k = 0; k < 3; k++) st.units.push({ id: 9100 + k, type: 'militia', owner: 1, cell: g.adj[spot][k], hp: 6, max: 6, stance: 'hold', goal: -1, anchor: 0 });
  const inc = E.income(st, 1);
  assert.equal(inc.upkeep, 3);
  assert.equal(inc.food, 2);
  assert.deepEqual(inc.idle, [9001]);
  assert.equal(inc.gold, 2, 'only the capital pays gold while the market is hungry');
});

test('building costs rise with every second copy', () => {
  const st = E.createGame({ seed: 'cost', players: 2 });
  assert.equal(E.cardCost(st, 1, 'farm').mat, 2);
  st.buildings.push({ id: 1, type: 'farm', owner: 1, cell: 0 }, { id: 2, type: 'farm', owner: 1, cell: 1 });
  assert.equal(E.cardCost(st, 1, 'farm').mat, 3);
});

test('text briefing renders for every seat', () => {
  const st = E.createGame({ seed: 'text', players: 3 });
  playOut(st, undefined, 30);
  for (const p of st.players) {
    const s = T.describe(E.observe(st, p.id));
    assert.match(s, /HexBattle/);
    assert.match(s, /地圖/);
  }
});

test('CLI: new, act and verify through a save file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-')), file = path.join(dir, 'g.json'), cli = path.join(root, 'tools/hexbattle.cjs');
  const run = (...args) => spawnSync(process.execPath, [cli, ...args, '--file', file, '--json'], { encoding: 'utf8' });
  let r = run('new', '--seed', 'cli', '--seat', '2');
  assert.equal(r.status, 0, r.stderr);
  let out = JSON.parse(r.stdout);
  assert.equal(out.observation.you, 2);
  assert.equal(out.observation.turn, 2);
  for (let k = 0; k < 3; k++) { r = run('act', '{"type":"end"}'); assert.equal(r.status, 0, r.stdout + r.stderr); }
  out = JSON.parse(r.stdout);
  assert.equal(out.observation.round, 4);
  r = run('act', '{"type":"bogus"}');
  assert.notEqual(r.status, 0);
  r = run('verify');
  assert.equal(r.status, 0, r.stdout);
});

test('arena runs an external JSON-lines agent against bots', () => {
  const r = spawnSync(process.execPath, [path.join(root, 'tools/hexbattle-arena.cjs'), '--seat', 'cmd:' + JSON.stringify(process.execPath) + ' ' + JSON.stringify(path.join(root, 'tools/hexbattle-example-agent.cjs')), '--seat', 'bot:warlord', '--games', '1', '--seed', 'arena-test'], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /戰績/);
  assert.match(r.stdout, /無效 0/);
});
