'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const E = require('../autohex-engine.js'), S = require('../autohex-snapshot.js'), V = require('../autohex-visuals.js');
const at = E.index;

function recordingCanvas() {
  const calls = [];
  const ctx = new Proxy({ createLinearGradient: () => ({ addColorStop() {} }), measureText: t => ({ width: String(t).length * 8 }) }, {
    get(target, key) { if (key in target) return target[key]; return (...args) => calls.push([key, ...args]); },
    set(target, key, value) { target[key] = value; return true; }
  });
  return { calls, canvas: { width: 0, height: 0, getContext: () => ctx } };
}
function battle() {
  const g = new E.Game({ seed: 'snapshot-fixture', neutralEvents: false }); g.start();
  const chronicle = new S.Chronicle();
  g.board[at(4, 0)] = 1; g.board[at(5, 0)] = 2; g.board[at(5, 1)] = 3; g.shields[at(5, 1)] = 5;
  g.turrets = [{ owner: 1, cell: at(4, 0), life: 30, countdown: 1 }];
  for (let n = 0; n < 6 * 30 && g.phase === 'running'; n++) { g.act({ type: 'rest', cells: [] }); chronicle.record(g.observation(0)); }
  return { g, chronicle };
}

test('chronicle keeps events beyond the core event cap and only the last 18 rounds are summarised', () => {
  const { g, chronicle } = battle(), view = g.observation(0);
  assert.equal(view.events.length, 96);
  assert.ok(chronicle.events.length > 96, 'chronicle accumulates past the 96-event core limit');
  const s = S.summarize(chronicle, view);
  assert.equal(s.toRound, view.round); assert.equal(s.toRound - s.fromRound + 1, 18);
  assert.ok(chronicle.events.every(e => e.round >= view.round - 19));
});

test('turret fire becomes shot arcs, shield blocks and kills with the right colours', () => {
  const g = new E.Game({ seed: 'snapshot-shots', neutralEvents: false }); g.start();
  const chronicle = new S.Chronicle();
  g.board[at(4, 0)] = 1; g.board[at(5, 0)] = 2; g.shields[at(5, 0)] = 5;
  g.turrets = [{ owner: 1, cell: at(4, 0), life: 30, countdown: 1 }];
  for (let n = 0; n < 30; n++) { g.act({ type: 'rest', cells: [] }); chronicle.record(g.observation(0)); }
  const s = S.summarize(chronicle, g.observation(0));
  assert.ok(s.shots.some(x => x.blocked && x.from === at(4, 0) && x.to === at(5, 0) && x.player === 1));
  assert.ok(s.shots.some(x => !x.blocked && x.victim === 2));
  assert.ok(s.kills.some(k => k.cell === at(5, 0) && k.victim === 2 && k.player === 1));
  assert.ok(s.stats[1].shots >= 2 && s.stats[1].kills >= 1 && s.stats[2].losses >= 1);
});

test('strategy commitments are deduplicated and follow their latest public corridor', () => {
  const chronicle = new S.Chronicle(), base = { events: [], players: [null, {}, {}], round: 3, ply: 10 };
  const intent = path => [null, { player: 1, type: 'direct', target: 9, path, committedAtPly: 4 }];
  chronicle.record({ ...base, intents: intent([1, 2, 3]) });
  chronicle.record({ ...base, ply: 11, intents: intent([2, 3, 4]) });
  assert.equal(chronicle.plans.length, 1); assert.deepEqual(chronicle.plans[0].path, [2, 3, 4]);
});

test('the image puts no words on the board: every text call lands outside the map panel', () => {
  const { g, chronicle } = battle(), view = g.observation(0), { calls, canvas } = recordingCanvas();
  const points = E.CELLS.map(c => ({ x: Math.sqrt(3) * (c.q + c.r / 2), y: 1.5 * c.r }));
  const geo = { points, colors: ['', '#267477', '#a65e46', '#84618c', '#4d739e', '#668047', '#ad7b23'], tints: Array(7).fill('#eee'), names: ['', 'A', 'B', 'C', 'D', 'E', 'F'] };
  const result = S.draw(canvas, { view, summary: S.summarize(chronicle, view), seed: g.seed, clock: '9:00', supply: V.supplyForest(view, E.ADJ) }, geo, { pixelRatio: 1 });
  const M = result.layout.map, texts = calls.filter(c => c[0] === 'fillText');
  assert.ok(texts.length > 20);
  for (const [, text, x, y] of texts) assert.ok(!(x > M.x && x < M.x + M.w && y > M.y && y < M.y + M.h), `text "${text}" drawn on map at ${x},${y}`);
  assert.ok(calls.some(c => c[0] === 'setLineDash' && c[1].length === 2 && c[1][0] === 3 && c[1][1] === 6), 'faint dashed strategy lines');
  assert.equal(canvas.width, result.layout.W);
});
