'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../autohex-engine.js');
const at = H.index, center = at(0, 0), plain = value => JSON.parse(JSON.stringify(value));
const rest = () => ({ type: 'rest', cells: [] });

function fixture() {
  const g = new H.Game({ seed: 'public-visual-events' }); g.start();
  for (const field of ['board', 'terrain', 'roads', 'anchors', 'shields', 'unsupplied']) g[field].fill(0);
  g.bridges = []; g.turrets = []; g.alliances = []; g.offers = [];
  g.players[1].home = center; g.players[1].energy = 8; g.board[center] = g.anchors[center] = 1;
  return g;
}
function battery(allied = false) {
  const g = fixture(), left = at(-4, 0), right = at(4, 0), blocked = at(-4, 1), destroyed = at(4, 1);
  g.board[left] = g.board[right] = 1; g.board[blocked] = 2; g.board[destroyed] = 3; g.shields[blocked] = 7;
  g.bridges = [{ owner: 1, a: center, b: left }, { owner: 1, a: center, b: right }];
  g.turrets = [right, left].map(cell => ({ owner: 1, cell, life: 12, countdown: 1 }));
  if (allied) g.alliances = [{ a: 1, b: 2, expiresRound: 99 }, { a: 1, b: 3, expiresRound: 99 }];
  g.turn = 6; assert.ok(g.act(rest())); assert.equal(g.turn, 1);
  return { g, left, right, blocked, destroyed };
}

test('AutoHex visual events retain both exact turret origins when one simultaneous shot is shielded and another destroys', () => {
  const { g, left, right, blocked, destroyed } = battery();
  const hits = g.events.filter(e => e.source === 'turret');
  assert.equal(hits.length, 2); assert.deepEqual(hits.map(e => e.type), ['shield-block', 'destroy']);
  assert.deepEqual(hits.map(e => e.origin), [left, right]); assert.deepEqual(hits.map(e => e.cells), [[blocked], [destroyed]]);
  assert.deepEqual(hits.map(e => e.from), [2, 3]); assert.ok(hits.every(e => e.player === 1));
  assert.equal(hits[0].ply, hits[1].ply); assert.equal(hits[0].round, hits[1].round); assert.ok(hits[0].id < hits[1].id);
  assert.equal(g.board[blocked], 2); assert.equal(g.shields[blocked], 0); assert.equal(g.board[destroyed], 0);
  assert.equal(g.telemetry.turretShots, 2); assert.equal(g.telemetry.shieldBlocks, 1); assert.equal(g.telemetry.destroyed, 1);
});

test('AutoHex allied targets produce no turret damage animation event', () => {
  const { g, blocked, destroyed } = battery(true);
  assert.equal(g.board[blocked], 2); assert.equal(g.board[destroyed], 3); assert.equal(g.shields[blocked], 7);
  assert.equal(g.telemetry.turretShots, 0); assert.equal(g.events.filter(e => e.source === 'turret').length, 0);
  assert.equal(g.events.filter(e => e.type === 'destroy' || e.type === 'shield-block').length, 0);
});

test('AutoHex demolition metadata uses an explicit null origin and reports the public target owner', () => {
  for (const shielded of [false, true]) {
    const g = fixture(), target = at(1, 0); g.board[target] = 2; g.shields[target] = shielded ? 5 : 0; g.hands[1] = ['destroy'];
    assert.ok(g.act({ type: 'destroy', cells: [target], cardIndex: 0 }));
    const hit = g.events.find(e => e.type === (shielded ? 'shield-block' : 'destroy'));
    assert.ok(hit); assert.equal(hit.origin, null); assert.equal(hit.source, 'demolition'); assert.equal(hit.from, 2); assert.deepEqual(hit.cells, [target]);
  }
});

test('AutoHex supply-retreat metadata lists exactly the stones removed in that settlement', () => {
  const g = fixture(), removed = [at(-7, 0), at(7, 0)], waiting = at(0, 7), supplied = at(1, 0), enemy = at(0, -7);
  for (const i of removed) { g.board[i] = 1; g.unsupplied[i] = 5; }
  g.board[waiting] = g.board[supplied] = 1; g.unsupplied[waiting] = 4; g.unsupplied[supplied] = 5;
  g.board[enemy] = 2; g.unsupplied[enemy] = 5;
  assert.ok(g.act(rest()));
  const retreat = g.events.find(e => e.type === 'supply-retreat');
  assert.ok(retreat); assert.equal(retreat.player, 1); assert.equal(retreat.count, 2); assert.deepEqual(retreat.cells, removed);
  assert.ok(removed.every(i => g.board[i] === 0)); assert.equal(g.board[waiting], 1); assert.equal(g.unsupplied[waiting], 5);
  assert.equal(g.board[supplied], 1); assert.equal(g.unsupplied[supplied], 0); assert.equal(g.board[enemy], 2); assert.equal(g.board[center], 1);
});

test('AutoHex public visual metadata is detached from engine storage and exposes no private hands or deck order', () => {
  const { g } = battery(), before = plain(g.observation(0)), view = g.observation(0);
  assert.deepEqual(view.hand, []);
  for (const key of ['hands', 'drawPile', 'discardPile', '_random']) assert.equal(key in view, false);
  for (const e of view.events) for (const key of ['hand', 'hands', 'drawPile', 'discardPile', '_random']) assert.equal(key in e, false);
  const hit = view.events.find(e => e.source === 'turret'); hit.origin = -999; hit.cells[0] = -999; hit.from = 99; hit.id = -1;
  assert.deepEqual(plain(g.observation(0)), before);
  for (const p of H.PLAYERS) g.hands[p] = g.hands[p].map((_, n) => n % 2 ? 'shield' : 'destroy');
  g.drawPile.reverse(); g.discardPile.reverse();
  assert.deepEqual(plain(g.observation(0)), before);
});

test('AutoHex event IDs remain increasing across truncation and restart deterministically after reset', () => {
  const g = new H.Game({ seed: 'event-sequence' });
  assert.equal(g.events[0].id, 1); g.start();
  for (let i = 0; i < 140; i++) assert.ok(g.act(rest()));
  assert.equal(g.events.length, H.RULES.eventLimit); assert.ok(g.events[0].id > 1);
  for (let i = 1; i < g.events.length; i++) assert.equal(g.events[i].id, g.events[i - 1].id + 1);
  const replay = () => { g.reset('event-sequence', 1, 0); assert.equal(g.events[0].id, 1); g.start(); for (let i = 0; i < 10; i++) assert.ok(g.act(rest())); return plain(g.events); };
  assert.deepEqual(replay(), replay());
});
