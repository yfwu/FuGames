'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../cyclic3d-engine.js');
const root = path.join(__dirname, '..');
const seeded = seed => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const play = (g, ...cells) => { for (const c of cells) assert.ok(g.play(c), 'move ' + C.label(c)); return g; };
const I = C.index;

test('the cube has 49 unique straight lines: 27 axis, 18 planar diagonal, 4 space diagonal', () => {
  assert.equal(C.LINES.length, 49);
  assert.equal(new Set(C.LINES.map(l => l.slice().sort((a, b) => a - b).join())).size, 49);
  const kinds = {}; for (const l of C.LINES) kinds[C.lineKind(l)] = (kinds[C.lineKind(l)] || 0) + 1;
  assert.deepEqual(kinds, { axis: 27, 'layer-diagonal': 6, 'cross-diagonal': 12, 'space-diagonal': 4 });
  assert.equal(C.LINES_BY_CELL[13].length, 13);
  for (const corner of [0, 2, 6, 8, 18, 20, 24, 26]) assert.equal(C.LINES_BY_CELL[corner].length, 7);
  assert.equal(C.LINES_BY_CELL.reduce((s, l) => s + l.length, 0), 147);
  // Each line is straight: equal coordinate steps.
  for (const line of C.LINES) {
    const [a, b, c] = line.map(C.coord);
    for (const k of ['layer', 'row', 'col']) assert.equal(b[k] - a[k], c[k] - b[k]);
  }
  // Bent or wrapped triples are not lines.
  const has = cells => C.LINES.some(l => l.slice().sort((x, y) => x - y).join() === cells.slice().sort((x, y) => x - y).join());
  assert.ok(has([I(0, 0, 0), I(1, 1, 1), I(2, 2, 2)]), 'space diagonal');
  assert.ok(has([I(0, 1, 1), I(1, 1, 1), I(2, 1, 1)]), 'vertical column');
  assert.ok(has([I(0, 0, 0), I(1, 0, 1), I(2, 0, 2)]), 'cross-layer diagonal');
  assert.ok(!has([I(0, 0, 0), I(1, 1, 1), I(2, 0, 2)]), 'bent line');
  assert.ok(!has([I(0, 0, 0), I(0, 0, 1), I(1, 0, 2)]), 'a row that bends into the next layer');
});

test('FIFO: the fourth stone lifts the oldest, which cannot return to its own cell', () => {
  const g = new C.Game({ pieRule: false });
  play(g, 0, 26, 5, 21, 7, 19);
  assert.deepEqual(g.queues[C.BLACK], [0, 5, 7]);
  assert.equal(g.leaving(C.BLACK), 0);
  assert.equal(g.play(0), null, 'own oldest cell is occupied at move start');
  assert.equal(g.play(26), null, 'cannot capture');
  assert.equal(g.ply, 6);
  play(g, 15);
  assert.equal(g.board[0], 0); assert.equal(g.board[15], C.BLACK);
  assert.deepEqual(g.queues[C.BLACK], [5, 7, 15]);
});

test('a win is judged after the oldest stone leaves, across layers', () => {
  // Black: 下 A1(0), 中 B2(13), then a stone elsewhere; the third diagonal cell is 上 C3 (26).
  const g = new C.Game({ pieRule: false });
  play(g, 0, 1, 13, 2, 5, 3);
  // Black's oldest is 0: moving to 26 would lift 0, so the diagonal is not complete.
  assert.equal(g.wouldWin(C.BLACK, 26), null);
  assert.ok(!g.threats(C.BLACK).includes(26));
  const h = new C.Game({ pieRule: false });
  play(h, 5, 1, 0, 2, 13, 3);
  assert.deepEqual(h.wouldWin(C.BLACK, 26), [0, 13, 26]);
  play(h, 26);
  assert.equal(h.winner, C.BLACK); assert.deepEqual(h.winLine, [0, 13, 26]);
  assert.ok(h.over); assert.deepEqual(h.legalMoves(), []);
});

test('repetition keys use ordered queues; a true third repetition is a draw', () => {
  const a = new C.Game({ pieRule: false }), b = new C.Game({ pieRule: false });
  play(a, 0, 26, 1, 25, 3, 24);
  play(b, 1, 26, 0, 25, 3, 24);
  assert.deepEqual(a.board, b.board);
  assert.notEqual(a.key(), b.key(), 'same occupancy, different FIFO future');
  // Each side cycles one stone through four cells containing no line: the full
  // position (same ordered queues, same side to move) returns every eight plies.
  const g = new C.Game({ pieRule: false }), B = [0, 5, 7, 15], W = [26, 21, 19, 11];
  for (let i = 0; i < 3; i++) play(g, B[i], W[i]);
  const start = g.key();
  let n = 0;
  while (!g.over && n < 40) { play(g, B[(3 + n) % 4]); if (!g.over) play(g, W[(3 + n) % 4]); n++; }
  assert.equal(g.winner, 0);
  assert.equal(g.draw, 'repetition');
  assert.equal(g.seen.get(start), 3);
  assert.equal(g.ply, 22);
});

test('120-ply limit draws a game nobody wins, and an immediate win takes priority on the last ply', () => {
  const g = new C.Game({ pieRule: false });
  g.ply = C.PLY_LIMIT - 1; g.seen = new Map();
  play(g, 0);
  assert.equal(g.draw, 'ply-limit');
  const h = new C.Game({ pieRule: false });
  play(h, 0, 9, 1, 10);
  h.ply = C.PLY_LIMIT - 1;
  play(h, 2);
  assert.equal(h.winner, C.BLACK); assert.equal(h.draw, null);
});

test('pie rule swaps seats only, keeps stones and queues, and White still moves', () => {
  const g = new C.Game();
  assert.equal(g.seatOf(C.BLACK), 0);
  play(g, 13);
  assert.ok(g.pieOpen);
  const before = JSON.stringify([g.board, g.queues]);
  assert.ok(C.shouldSwap(g));
  assert.ok(g.swap());
  assert.equal(g.pieOpen, false); assert.equal(g.turn, C.WHITE);
  assert.equal(g.seatOf(C.BLACK), 1); assert.equal(g.colorOf(0), C.WHITE);
  assert.equal(JSON.stringify([g.board, g.queues]), before);
  assert.equal(g.swap(), false, 'only once');
  play(g, 0);
  assert.equal(g.pieOpen, false);
  const k = new C.Game(); play(k, 0);
  assert.equal(C.shouldSwap(k), false);
  assert.ok(k.declineSwap()); play(k, 13); assert.equal(k.seatOf(C.BLACK), 0);
  const off = new C.Game({ pieRule: false }); play(off, 13); assert.equal(off.pieOpen, false); assert.equal(off.swap(), false);
});

test('state survives JSON round trips used by the AI worker', () => {
  const g = new C.Game(); play(g, 0); g.declineSwap(); play(g, 13, 1, 14);
  const h = C.Game.from(JSON.parse(JSON.stringify(g)));
  assert.equal(h.key(), g.key()); assert.deepEqual([...h.seen], [...g.seen]); assert.equal(h.leaving(C.BLACK), g.leaving(C.BLACK));
});

test('AI takes an immediate win, blocks an immediate loss, and respects FIFO in both', () => {
  const g = new C.Game({ pieRule: false });
  play(g, 5, 9, 0, 10, 13);
  // White threatens 11 (9,10 + 11 same layer row).
  assert.deepEqual(g.threats(C.WHITE), [11]);
  // Black now has 0 and 13: 26 completes, but white is to move — white wins first.
  assert.equal(C.chooseMove(g, { level: 'normal', rng: seeded(1) }).cell, 11);
  const h = new C.Game({ pieRule: false });
  play(h, 5, 9, 0, 10, 13, 22);
  // Black to move with threat at 26; White threatens 11. Black wins rather than blocks.
  assert.equal(C.chooseMove(h, { level: 'hard', rng: seeded(2), timeMs: 0, maxNodes: 50000 }).cell, 26);
  const b = new C.Game({ pieRule: false });
  play(b, 0, 9, 2, 10, 24);
  // White to move; Black has no threat; White's own threat 11 wins.
  assert.equal(C.chooseMove(b, { level: 'easy', rng: seeded(3) }).cell, 11);
  const block = new C.Game({ pieRule: false });
  play(block, 9, 0, 10, 24);
  assert.deepEqual(block.threats(C.BLACK), [11]);
  play(block, 20);
  // With three stones down, Black's next move lifts 9, so 9-10-11 is no longer a threat.
  assert.deepEqual(block.threats(C.BLACK), []);
  const must = new C.Game({ pieRule: false });
  play(must, 9, 0, 10);
  assert.deepEqual(must.threats(C.BLACK), [11]);
  for (const level of ['easy', 'normal', 'hard']) assert.equal(C.chooseMove(must, { level, rng: seeded(4), timeMs: 0, maxNodes: 60000 }).cell, 11, level);
});

test('seeded AI self-play always ends legally within the limits', () => {
  const tally = { 1: 0, 2: 0, draw: 0 };
  for (let s = 1; s <= 8; s++) {
    const rng = seeded(s), g = new C.Game();
    while (!g.over) {
      if (g.pieOpen) { if (C.shouldSwap(g)) g.swap(); else g.declineSwap(); }
      const m = C.chooseMove(g, { level: s % 2 ? 'easy' : 'normal', rng, timeMs: 0, maxNodes: 40000 });
      assert.ok(g.legal(m.cell)); g.play(m.cell);
      assert.ok(g.queues[1].length <= 3 && g.queues[2].length <= 3);
      assert.equal(g.board.filter(Boolean).length, g.queues[1].length + g.queues[2].length);
    }
    assert.ok(g.ply <= C.PLY_LIMIT);
    if (g.winner) { assert.ok(g.winLine.every(c => g.board[c] === g.winner)); tally[g.winner]++; } else tally.draw++;
  }
  assert.equal(tally[1] + tally[2] + tally.draw, 8);
});

test('page loads the engine locally, has the shared shell, and is linked from the homepage', () => {
  const page = fs.readFileSync(path.join(root, 'cyclic_tictactoe_3d.html'), 'utf8');
  assert.match(page, /<script src="cyclic3d-engine.js"><\/script>/);
  assert.match(page, /new Worker\('cyclic3d-ai-worker.js'\)/);
  assert.match(fs.readFileSync(path.join(root, 'cyclic3d-ai-worker.js'), 'utf8'), /importScripts\('cyclic3d-engine.js'\)/);
  assert.match(page, /icons\.svg#cyclic_tictactoe_3d/);
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /href="cyclic_tictactoe_3d.html"/);
  assert.match(fs.readFileSync(path.join(root, 'archive.html'), 'utf8'), /href="cyclic_tictactoe.html"/);
});
