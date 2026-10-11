'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const H = require('../autohex-engine.js'), V = require('../autohex-visuals.js');
const at = H.index, center = at(0, 0);
function publicView() {
  return { board: Array(H.COUNT).fill(0), supplied: Array(H.COUNT).fill(0), anchors: Array(H.COUNT).fill(0),
    players: [null, ...H.PLAYERS.map(() => ({ home: -1 }))], bridges: [], turrets: [], alliances: [], round: 5 };
}
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

test('AutoHex visual supply forest starts at homes, follows own supplied neighbors/bridges, and contains no cycles', () => {
  const view = publicView(), neighbor = at(1, 0), triangle = at(1, -1), far = at(5, 0), child = at(5, 1), remote = at(10, 0), unsupplied = at(6, 0);
  const home2 = at(8, 0), child2 = at(8, -1), blocker = at(2, 0);
  view.players[1].home = center; view.players[2].home = home2;
  for (const i of [center, neighbor, triangle, far, child, remote, unsupplied]) { view.board[i] = 1; view.supplied[i] = i === unsupplied ? 0 : 1; }
  for (const i of [home2, child2, blocker]) { view.board[i] = 2; view.supplied[i] = 1; }
  view.bridges = [{ owner: 1, a: neighbor, b: far }, { owner: 2, a: neighbor, b: remote }, { owner: 1, a: far, b: unsupplied }];
  freeze(view); const edges = V.supplyForest(view, H.ADJ);
  assert.equal(edges.length, 5); assert.equal(edges.filter(e => e.owner === 1).length, 4); assert.equal(edges.filter(e => e.owner === 2).length, 1);
  assert.deepEqual(edges.filter(e => e.bridge), [{ a: neighbor, b: far, owner: 1, bridge: true }]);
  for (const owner of [1, 2]) {
    const reached = new Set([view.players[owner].home]);
    for (const e of edges.filter(e => e.owner === owner)) {
      assert.ok(reached.has(e.a)); assert.equal(reached.has(e.b), false); reached.add(e.b);
      assert.equal(view.board[e.a], owner); assert.equal(view.board[e.b], owner); assert.equal(view.supplied[e.b], 1);
      assert.ok(e.bridge || H.ADJ[e.a].includes(e.b));
    }
    assert.equal(reached.has(remote), false); assert.equal(reached.has(unsupplied), false); assert.equal(reached.has(blocker), false);
  }
});

test('AutoHex visual turret range is exactly three and excludes active allies, anchors, and own stones', () => {
  const view = publicView(), enemy = at(3, 0), outside = at(4, 0), ally = at(1, 0), expiredAlly = at(0, 1), anchor = at(-1, 0), own = at(1, -1);
  view.board[center] = view.board[own] = 1; view.board[enemy] = 2; view.board[outside] = 3; view.board[ally] = 4; view.board[expiredAlly] = 5; view.board[anchor] = view.anchors[anchor] = 6;
  view.turrets = [{ owner: 1, cell: center, countdown: 2, life: 11 }];
  view.alliances = [{ a: 4, b: 1, expiresRound: 8 }, { a: 1, b: 5, expiresRound: 5 }];
  freeze(view); const preview = V.inspectTurret(view, center, H.CELLS, H.distance);
  assert.equal(preview.radius, 3); assert.equal(preview.cells.length, 37); assert.equal(preview.countdown, 2); assert.equal(preview.life, 11);
  assert.deepEqual(preview.cells.slice().sort((a, b) => a - b), H.CELLS.filter(c => Math.max(Math.abs(c.q), Math.abs(c.r), Math.abs(c.s)) <= 3).map(c => c.i).sort((a, b) => a - b));
  assert.deepEqual(preview.targets.slice().sort((a, b) => a - b), [enemy, expiredAlly].sort((a, b) => a - b));
  assert.equal(V.inspectTurret(view, enemy, H.CELLS, H.distance), null);
  const stale = { ...view, board: view.board.slice() }; stale.board[center] = 2; assert.equal(V.inspectTurret(stale, center, H.CELLS, H.distance), null);
});

test('AutoHex effects retain distinct same-turn hit IDs and never restart an animation on repeated observations', () => {
  const effects = new V.Effects(), events = [
    { id: 10, type: 'shield-block', player: 1, origin: at(-4, 0), cells: [at(-4, 1)], source: 'turret', from: 2, ply: 6, activeMs: 1000 },
    { id: 11, type: 'destroy', player: 1, origin: at(4, 0), cells: [at(4, 1)], source: 'turret', from: 3, ply: 6, activeMs: 1000 }
  ];
  effects.ingest(events, 1000); assert.equal(effects.snapshot().effects.length, 2);
  effects.advance(300); const before = effects.snapshot(); effects.ingest(events, 1300); assert.deepEqual(effects.snapshot(), before);
  assert.deepEqual(before.effects.map(e => e.origin), events.map(e => e.origin)); assert.deepEqual(before.effects.map(e => e.cells), events.map(e => e.cells));
  for (const delta of [0, -1, NaN, Infinity]) { assert.equal(effects.advance(delta), false); assert.deepEqual(effects.snapshot(), before); }
});

test('AutoHex effect storage, seen IDs and cell lists remain bounded with detached snapshots', () => {
  const effects = new V.Effects(), events = Array.from({ length: 400 }, (_, i) => ({ id: i + 1, type: 'capture', player: 2, cells: [i], activeMs: 0 }));
  effects.ingest(events, 0); let snapshot = effects.snapshot();
  assert.equal(snapshot.effects.length, 64); assert.equal(snapshot.seenCount, 256); assert.equal(snapshot.limit, 64);
  assert.equal(snapshot.effects[0].id, 337); assert.equal(snapshot.effects.at(-1).id, 400);
  effects.ingest(events.slice(-96), 0); assert.deepEqual(effects.snapshot(), snapshot);
  snapshot.effects[0].cells[0] = -999; snapshot.effects[0].origin = -999; assert.equal(effects.snapshot().effects[0].cells[0], 336);
  const manyCells = Array.from({ length: 150 }, (_, i) => i); effects.ingest([{ id: 401, type: 'supply-retreat', player: 2, cells: manyCells, activeMs: 0 }], 0);
  snapshot = effects.snapshot(); assert.equal(snapshot.effects.at(-1).cells.length, 96); manyCells[0] = -999; assert.equal(effects.snapshot().effects.at(-1).cells[0], 0);
});

test('AutoHex effects expire by active age, reject stale observations, and clear correctly for manual steps and restart', () => {
  const effects = new V.Effects();
  effects.ingest([{ id: 1, type: 'destroy', player: 1, cells: [center], activeMs: 100 }, { id: 2, type: 'offer', player: 1, cells: [center], activeMs: 2000 }], 2000);
  assert.equal(effects.snapshot().effects.length, 0);
  const current = { id: 3, type: 'shield-block', player: 1, cells: [center], activeMs: 2000 };
  effects.ingest([current], 2000); effects.advance(1599); assert.equal(effects.snapshot().effects.length, 1); effects.advance(1); assert.equal(effects.snapshot().effects.length, 0);
  effects.ingest([{ id: 4, type: 'supply-retreat', player: 1, cells: [center], activeMs: 4000 }], 4000);
  effects.advance(1600); assert.equal(effects.snapshot().effects.length, 1); effects.advance(300); assert.equal(effects.snapshot().effects.length, 0);
  const fresh = { id: 5, type: 'capture', player: 1, cells: [center], activeMs: 6000 }; effects.ingest([fresh], 6000);
  const seen = effects.snapshot().seenCount; effects.clearActive(); assert.equal(effects.snapshot().effects.length, 0); assert.equal(effects.snapshot().seenCount, seen);
  effects.ingest([fresh], 6000); assert.equal(effects.snapshot().effects.length, 0);
  effects.clear(); assert.equal(effects.snapshot().seenCount, 0); effects.ingest([{ ...fresh, id: 1 }], 6000); assert.equal(effects.snapshot().effects.length, 1);
});

test('AutoHex visual helpers use public observation fields and never copy private card data into effects', () => {
  const view = publicView(); view.board[center] = view.supplied[center] = 1; view.players[1].home = center; view.turrets = [{ owner: 1, cell: center, life: 10, countdown: 1 }];
  for (const key of ['hands', 'drawPile', 'discardPile']) Object.defineProperty(view, key, { get() { throw new Error(`Private field read: ${key}`); } });
  assert.deepEqual(V.supplyForest(view, H.ADJ), []); assert.ok(V.inspectTurret(view, center, H.CELLS, H.distance));
  const event = { id: 1, type: 'destroy', player: 1, cells: [center], origin: null, source: 'demolition', from: 2, activeMs: 0 };
  Object.defineProperty(event, 'hands', { get() { throw new Error('Private event field read'); } });
  const effects = new V.Effects(); effects.ingest([event], 0);
  const result = effects.snapshot().effects[0]; assert.equal('hands' in result, false); assert.equal('drawPile' in result, false); assert.equal('discardPile' in result, false);
  assert.deepEqual(Object.keys(result).sort(), ['id', 'type', 'player', 'origin', 'cells', 'age', 'duration', 'source', 'from'].sort());
});

test('AutoHex air effects mark the landing cell and use one damage-resolution effect per bombardment', () => {
  const effects = new V.Effects(), airport = new H.Game({ seed: 'visual-air-effects' }).airports[0].cell, landing = at(3, 0), target = at(2, 0);
  effects.ingest([
    { id: 1, type: 'airdrop', player: 1, cells: [airport, landing], origin: airport, source: 'airdrop', activeMs: 100 },
    { id: 2, type: 'destroy', player: 1, cells: [target], origin: airport, source: 'bombard', from: 2, activeMs: 100 },
    { id: 3, type: 'bombard', player: 1, cells: [airport, target], origin: airport, source: 'bombard', activeMs: 100 }
  ], 100);
  const snapshot = effects.snapshot(); assert.equal(snapshot.effects.length, 2);
  const drop = snapshot.effects.find(e => e.type === 'airdrop'); assert.deepEqual(drop.cells, [landing]); assert.equal(drop.origin, airport); assert.equal(drop.source, 'airdrop');
  const hit = snapshot.effects.find(e => e.type === 'destroy'); assert.deepEqual(hit.cells, [target]); assert.equal(hit.origin, airport); assert.equal(hit.source, 'bombard'); assert.equal(hit.from, 2);
});

test('AutoHex neutral warning is not rendered as a hit and strike/block resolutions remain distinct public effects', () => {
  const effects = new V.Effects(), struck = at(2, 0), protectedCell = at(3, 0);
  const events = [
    { id: 1, type: 'neutral-warning', player: 0, kind: 'guerrilla', cells: [struck, protectedCell], resolveRound: 12, activeMs: 0 },
    { id: 2, type: 'neutral-strike', player: 0, cells: [struck], from: 2, origin: null, source: 'guerrilla', activeMs: 0 },
    { id: 3, type: 'neutral-block', player: 3, cells: [protectedCell], from: 3, origin: null, source: 'guerrilla', protection: 'fortification', activeMs: 0 }
  ];
  effects.ingest(events, 0); const before = effects.snapshot(); assert.equal(before.effects.length, 2);
  assert.deepEqual(before.effects.map(e => e.type), ['neutral-strike', 'neutral-block']); assert.deepEqual(before.effects.map(e => e.from), [2, 3]); assert.ok(before.effects.every(e => e.origin === null));
  effects.ingest(events, 100); assert.deepEqual(effects.snapshot(), before); effects.advance(1600); assert.equal(effects.snapshot().effects.length, 0);
});
