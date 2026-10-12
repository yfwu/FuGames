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

test('the window is the last 18 turns (actions), not 18 rounds', () => {
  const { g, chronicle } = battle(), view = g.observation(0);
  const s = S.summarize(chronicle, view);
  assert.equal(S.TURNS, 18); assert.equal(s.toPly, view.ply); assert.equal(s.toPly - s.fromPly, 18);
  assert.ok(chronicle.events.every(e => e.ply >= view.ply - 24), 'older events are pruned');
});

test('territory changes inside the window become gains and ghosts of lost stones', () => {
  const g = new E.Game({ seed: 'snapshot-territory', neutralEvents: false }); g.start();
  const chronicle = new S.Chronicle(); chronicle.record(g.observation(0));
  const old = at(3, 0), fresh = at(3, 1); g.board[old] = 2;
  for (let n = 0; n < 30; n++) g.act({ type: 'rest', cells: [] });
  chronicle.record(g.observation(0));
  g.board[old] = 0; g.board[fresh] = 2; g.act({ type: 'rest', cells: [] }); chronicle.record(g.observation(0));
  const s = S.summarize(chronicle, g.observation(0));
  assert.ok(s.gains.some(x => x.cell === fresh && x.player === 2));
  assert.ok(s.ghosts.some(x => x.cell === old && x.owner === 2));
  assert.ok(!s.gains.some(x => x.cell === old));
});

test('turret fire becomes shot arcs, shield blocks and kills with the right colours', () => {
  const g = new E.Game({ seed: 'snapshot-shots', neutralEvents: false }); g.start();
  const chronicle = new S.Chronicle();
  g.board[at(4, 0)] = 1; g.board[at(5, 0)] = 2; g.shields[at(5, 0)] = 5;
  g.turrets = [{ owner: 1, cell: at(4, 0), life: 30, countdown: 1 }];
  for (let n = 0; n < 30; n++) { g.act({ type: 'rest', cells: [] }); chronicle.record(g.observation(0)); }
  const s = S.summarize(chronicle, g.observation(0), 60);
  assert.ok(s.shots.some(x => x.blocked && x.from === at(4, 0) && x.to === at(5, 0) && x.player === 1));
  assert.ok(s.shots.some(x => !x.blocked && x.victim === 2));
  assert.ok(s.kills.some(k => k.cell === at(5, 0) && k.victim === 2 && k.player === 1));
});

test('strategy commitments are deduplicated and follow their latest public corridor', () => {
  const chronicle = new S.Chronicle(), base = { events: [], players: [null, {}, {}], round: 3, ply: 10 };
  const intent = path => [null, { player: 1, type: 'direct', target: 9, path, committedAtPly: 4 }];
  chronicle.record({ ...base, intents: intent([1, 2, 3]) });
  chronicle.record({ ...base, ply: 11, intents: intent([2, 3, 4]) });
  assert.equal(chronicle.plans.length, 1); assert.deepEqual(chronicle.plans[0].path, [2, 3, 4]);
});

test('the image is the map alone, with no words drawn anywhere', () => {
  const { g, chronicle } = battle(), view = g.observation(0), { calls, canvas } = recordingCanvas();
  const points = E.CELLS.map(c => ({ x: Math.sqrt(3) * (c.q + c.r / 2), y: 1.5 * c.r }));
  const geo = { points, colors: ['', '#267477', '#a65e46', '#84618c', '#4d739e', '#668047', '#ad7b23'], tints: Array(7).fill('#eee'), names: ['', 'A', 'B', 'C', 'D', 'E', 'F'] };
  const result = S.draw(canvas, { view, summary: S.summarize(chronicle, view), seed: g.seed, clock: '9:00', supply: V.supplyForest(view, E.ADJ) }, geo, { pixelRatio: 1 });
  assert.deepEqual(calls.filter(c => c[0] === 'fillText' || c[0] === 'strokeText'), []);
  assert.ok(result.layout.map.w / result.layout.W > .95, 'the board fills the image');
  assert.equal(canvas.width, result.layout.W);
});
