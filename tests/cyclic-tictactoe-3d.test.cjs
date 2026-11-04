'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
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

test('page is a full-screen Vermilion Ink stage that loads the engine, worker and three.js locally', () => {
  const page = fs.readFileSync(path.join(root, 'cyclic_tictactoe_3d.html'), 'utf8');
  assert.match(page, /<script src="cyclic3d-engine.js"><\/script>/);
  assert.match(page, /new Worker\('cyclic3d-ai-worker.js'\)/);
  assert.match(fs.readFileSync(path.join(root, 'cyclic3d-ai-worker.js'), 'utf8'), /importScripts\('cyclic3d-engine.js'\)/);
  assert.match(page, /icons\.svg#cyclic_tictactoe_3d/);
  assert.match(page, /<link rel="stylesheet" href="shared\/fu\.css">/);
  assert.match(page, /<body class="fu-app[^"]*">/);
  assert.doesNotMatch(page, /fulab-theme\.css|play-panel|details class="card rules"|site-nav/);
  assert.match(page, /class="fu-seal"[^>]*>福遊</);
  assert.match(page, /<main class="fu-stage"[^>]*><canvas id="cube"/);
  for (const id of ['lobby', 'challenges', 'result', 'settings', 'rules']) assert.match(page, new RegExp('id="' + id + '"'));
  assert.match(page, /from '\.\/shared\/fu-three\.js'/);
  assert.ok(fs.existsSync(path.join(root, 'vendor', 'three', 'three.module.min.js')));
  assert.doesNotMatch(page, /fetch\(|WebSocket|https?:\/\//);
  for (const [, attrs, body] of page.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/src=/.test(attrs)) continue;
    const code = /type="module"/.test(attrs) ? '(async()=>{' + body.replace(/^import .*$/gm, '') + '\n})' : body;
    assert.doesNotThrow(() => new vm.Script(code), attrs);
  }
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /href="cyclic_tictactoe_3d.html"/);
  assert.match(fs.readFileSync(path.join(root, 'archive.html'), 'utf8'), /href="cyclic_tictactoe.html"/);
});

// ---------- variants ----------
test('options default to the original rules and survive JSON round trips', () => {
  const g = new C.Game();
  assert.equal(g.stones, 3); assert.deepEqual(g.blocked, []); assert.equal(g.support, false); assert.equal(g.pieRule, true);
  assert.deepEqual(C.normalizeOptions({ stones: 7, blocked: [13, 13, 99, -1, 'x'], support: 1 }), { pieRule: true, stones: 3, blocked: [13], support: true });
  for (const opts of [{ blocked: [13] }, { stones: 4 }, { support: true }, C.variantOptions('rubble', 5)]) {
    const a = new C.Game(Object.assign({ pieRule: false }, opts)); a.play(a.legalMoves()[0]);
    const b = C.Game.from(JSON.parse(JSON.stringify(a)));
    assert.equal(b.key(), a.key()); assert.equal(b.stones, a.stones); assert.deepEqual(b.blocked, a.blocked); assert.equal(b.support, a.support);
    assert.deepEqual(b.board, a.board); assert.deepEqual(b.legalMoves(), a.legalMoves());
  }
  assert.deepEqual(C.variantOptions('standard'), {}); assert.deepEqual(C.variantOptions('nope'), {});
  assert.deepEqual(C.VARIANT_IDS, ['standard', 'hollow', 'four', 'scaffold', 'rubble']);
});

test('hollow core: the centre is sealed and the 13 lines through it can never be completed', () => {
  const g = new C.Game({ pieRule: false, ...C.variantOptions('hollow') });
  assert.equal(g.board[13], C.BLOCK); assert.equal(g.legal(13), false); assert.ok(!g.legalMoves().includes(13));
  assert.equal(C.liveLines([13]).length, 36); assert.equal(g.liveCount[13], 0); assert.equal(g.liveCount[0], 6);
  // 0 and 26 are both Black's; 13 would complete the space diagonal but is sealed.
  play(g, 0, 1, 26, 2);
  assert.deepEqual(g.threats(C.BLACK), [], 'no threat through the seal');
  assert.equal(g.play(13), null);
  const m = C.chooseMove(g, { level: 'hard', rng: seeded(3), timeMs: 0, maxNodes: 20000 });
  assert.notEqual(m.cell, 13); assert.ok(g.legal(m.cell));
});

test('four stones: the queue holds four, the fifth move lifts the oldest, wins still need three', () => {
  const g = new C.Game({ pieRule: false, stones: 4 });
  play(g, 0, 26, 5, 21, 7, 19);
  assert.equal(g.leaving(C.BLACK), -1, 'three down, still placing');
  play(g, 15, 11);
  assert.equal(g.leaving(C.BLACK), 0);
  play(g, 16);
  assert.equal(g.board[0], 0); assert.deepEqual(g.queues[C.BLACK], [5, 7, 15, 16]);
  const w = new C.Game({ pieRule: false, stones: 4 });
  play(w, 0, 9, 1, 10, 24);
  assert.deepEqual(w.threats(C.WHITE), [11]);
  play(w, 11); assert.equal(w.winner, C.WHITE);
});

test('scaffold: a new stone needs a base below, and your own lifting stone is not a base', () => {
  const g = new C.Game({ pieRule: false, support: true });
  assert.deepEqual(g.legalMoves(), [0, 1, 2, 3, 4, 5, 6, 7, 8], 'only the bottom layer at first');
  play(g, 4);
  assert.ok(g.legalMoves().includes(13), 'a stone of either colour supports the cell above');
  assert.ok(!g.legalMoves().includes(22));
  play(g, 13); assert.ok(g.legalMoves().includes(22));
  play(g, 0, 22, 1);
  // Black [4,0,1], White [13,22]; White still placing.
  assert.equal(g.leaving(C.WHITE), -1);
  play(g, 2);
  // White [13,22,2] full: White's next move lifts 13. Black's next move lifts 4.
  assert.equal(g.leaving(C.BLACK), 4); assert.equal(g.leaving(C.WHITE), 13);
  play(g, 3); // Black lifts 4; 13 and 22 stay put without a base
  assert.equal(g.board[4], 0); assert.equal(g.board[13], C.WHITE); assert.equal(g.board[22], C.WHITE, 'stones already placed stay put');
  // White to move lifts 13, so 22's cell above is irrelevant, but 13 cannot base a stone at 22 (occupied anyway);
  // test the rule on a cell directly above White's lifting stone: none is empty, so check canPlace on Black's side.
  assert.equal(g.canPlace(C.WHITE, 4), true, 'bottom layer is always fine');
  assert.equal(g.canPlace(C.WHITE, 13), false, 'occupied');
  const h = new C.Game({ pieRule: false, support: true });
  play(h, 0, 8, 1, 7, 5, 3);
  // Black to move lifts 0: the cell above 0 (9) has no base this move, but above 1 (10) does.
  assert.equal(h.leaving(C.BLACK), 0);
  assert.equal(h.legal(9), false); assert.equal(h.legal(10), true);
  // White, if it moved now, keeps 0? No: 0 is Black's stone; White's lift is 8, so White may use 0 as a base.
  assert.equal(h.canPlace(C.WHITE, 9), true); assert.equal(h.canPlace(C.WHITE, 17), false);
  // A blocked cell is a base too.
  const r = new C.Game({ pieRule: false, support: true, blocked: [4] });
  assert.ok(r.legalMoves().includes(13));
  // Threats honour support: a completing cell without a base is not a threat.
  const t = new C.Game({ pieRule: false, support: true });
  play(t, 0, 8, 9, 7);
  assert.ok(t.wouldWin(C.BLACK, 18)); assert.equal(t.canPlace(C.BLACK, 18), true);
  assert.deepEqual(t.threats(C.BLACK), [18]);
  const u = new C.Game({ pieRule: false, support: true });
  play(u, 3, 8, 12, 7, 0);
  // White [8,7] placing; Black [3,12,0] would lift 3 next: 21 (above 12) completes 3-12-21? No: 3 leaves first.
  assert.equal(u.wouldWin(C.BLACK, 21), null);
  play(u, 6);
  // White [8,7,6] full and lifts 8 next. 6-7-8 broken by the lift, so no white threat on row C.
  assert.deepEqual(u.threats(C.WHITE).filter(c => c < 9), []);
});

test('rubble is seeded: four sealed cells, never the centre, no two on one line', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const cells = C.rubbleCells(seed, 4);
    assert.equal(cells.length, 4); assert.ok(!cells.includes(13));
    assert.deepEqual(cells, C.rubbleCells(seed, 4));
    for (const a of cells) for (const b of cells) if (a < b) assert.ok(!C.LINES.some(l => l.includes(a) && l.includes(b)), seed + ':' + a + '/' + b);
  }
  assert.notDeepEqual(C.rubbleCells(1), C.rubbleCells(2));
  const g = new C.Game({ pieRule: false, ...C.variantOptions('rubble', 9) });
  assert.equal(g.board.filter(v => v === C.BLOCK).length, 4);
  assert.equal(g.legalMoves().length, 23);
});

test('AI tiers: the original three are unchanged and every tier plays legally in every variant', () => {
  assert.deepEqual({ ...C.LEVELS.easy }, { depth: 2, noise: 30, timeMs: 150 });
  assert.deepEqual({ ...C.LEVELS.normal }, { depth: 4, noise: 4, timeMs: 500 });
  assert.deepEqual({ ...C.LEVELS.hard }, { depth: 7, noise: 0, timeMs: 900 });
  assert.deepEqual(C.LEVEL_IDS, ['novice', 'easy', 'normal', 'hard', 'master']);
  assert.ok(C.LEVELS.master.depth > C.LEVELS.hard.depth && C.LEVELS.novice.depth < C.LEVELS.easy.depth);
  let s = 1;
  for (const variant of C.VARIANT_IDS) {
    const rng = seeded(s++), g = new C.Game(C.variantOptions(variant, s));
    let n = 0;
    while (!g.over && n++ < 40) {
      if (g.pieOpen) g.declineSwap();
      const m = C.chooseMove(g, { level: C.LEVEL_IDS[n % 5], rng, timeMs: 0, maxNodes: 4000 });
      assert.ok(g.legal(m.cell), variant + ' ' + m.cell); g.play(m.cell);
      assert.ok(g.queues[1].length <= g.stones);
    }
  }
  // Every tier, including novice and master, still takes a win and blocks a loss.
  const must = new C.Game({ pieRule: false }); play(must, 9, 0, 10);
  assert.equal(C.chooseMove(must, { level: 'master', rng: seeded(4), timeMs: 0, maxNodes: 60000 }).cell, 11);
  assert.equal(C.chooseMove(must, { level: 'novice', rng: seeded(4) }).cell, 11);
  const win = new C.Game({ pieRule: false }); play(win, 0, 9, 2, 10, 24);
  assert.equal(C.chooseMove(win, { level: 'novice', rng: seeded(5) }).cell, 11);
});

// ---------- solver & challenges ----------
test('forcedWin finds immediate and two-move wins and works on a copy', () => {
  const g = new C.Game({ pieRule: false }); play(g, 9, 0, 10, 24);
  assert.equal(C.forcedWin(g, 1), 11);
  assert.equal(C.forcedWin(new C.Game({ pieRule: false }), 1), -1);
  const before = g.key(); C.forcedWin(g, 2); assert.equal(g.key(), before);
  assert.throws(() => C.fromPosition({ queues: { 1: [0, 1], 2: [1] }, turn: 1 }), /twice/);
  const pos = C.fromPosition({ queues: { 1: [0, 1, 2], 2: [3, 4, 5] }, turn: 2 });
  assert.equal(pos.turn, 2); assert.equal(pos.ply, 6); assert.equal(pos.repetitions(), 1); assert.equal(pos.leaving(C.WHITE), 3); assert.equal(pos.pieOpen, false);
});

test('every challenge is sound: forced win in the stated moves, not sooner, and one key move', () => {
  assert.equal(C.PUZZLES.length, 14);
  assert.equal(new Set(C.PUZZLES.map(p => p.id)).size, 14);
  assert.equal(new Set(C.PUZZLES.map(p => C.puzzleGame(p).key() + p.variant)).size, 14);
  let level = 1;
  for (const p of C.PUZZLES) {
    assert.ok(p.level >= level, p.id + ' levels never go down'); level = p.level;
    assert.ok(C.VARIANT_IDS.includes(p.variant) && p.variant !== 'rubble');
    const g = C.puzzleGame(p);
    assert.equal(g.queues[1].length, g.stones); assert.equal(g.queues[2].length, g.stones);
    assert.deepEqual(g.threats(g.turn), [], p.id + ' no immediate win');
    assert.equal(C.forcedWin(g, p.moves - 1), -1, p.id + ' not shorter');
    assert.equal(C.forcedWin(g, p.moves), p.key, p.id + ' key move');
    for (const first of g.legalMoves()) {
      if (first === p.key) continue;
      const h = g.clone(); h.play(first);
      if (h.over) { assert.ok(!h.winner, p.id); continue; }
      const refuted = h.legalMoves().some(r => { const k = h.clone(); k.play(r); return k.over || C.forcedWin(k, p.moves - 1) < 0; });
      assert.ok(refuted, p.id + ' alternative ' + first + ' must be refutable');
    }
  }
});

test('the hard AI defends a challenge but cannot escape the key line', () => {
  for (const p of C.PUZZLES.filter(p => p.moves === 2).slice(0, 4)) {
    const g = C.puzzleGame(p), me = g.turn;
    g.play(p.key);
    const reply = C.chooseMove(g, { level: 'hard', rng: seeded(7), timeMs: 0, maxNodes: 40000 });
    g.play(reply.cell);
    const finish = C.forcedWin(g, 1);
    assert.ok(finish >= 0, p.id); g.play(finish); assert.equal(g.winner, me, p.id);
  }
});

// ---------- career ----------
const html = fs.readFileSync(path.join(root, 'cyclic_tictactoe_3d.html'), 'utf8');
const K = vm.runInNewContext(html.match(/<script id="cyclic-career">([\s\S]*?)<\/script>/)[1] + ';CyclicCareer;');
const plain = v => JSON.parse(JSON.stringify(v));

test('career levels, ranks and unlock thresholds', () => {
  assert.deepEqual(plain(K.levelOf(0)), { level: 1, into: 0, need: 120, max: false });
  assert.equal(K.levelOf(119).level, 1); assert.equal(K.levelOf(120).level, 2); assert.equal(K.levelOf(120 + 150).level, 3);
  assert.equal(K.levelOf(-5).level, 1); assert.equal(K.levelOf('junk').level, 1);
  const max = K.levelOf(1e9); assert.equal(max.level, K.MAX_LEVEL); assert.ok(max.max); assert.equal(max.need, 0);
  assert.equal(K.rankOf(1), '入門'); assert.equal(K.rankOf(3), '初段'); assert.equal(K.rankOf(26), '立方名人');
  assert.ok(K.unlocked(1, 'tier', 'hard')); assert.ok(!K.unlocked(3, 'tier', 'master')); assert.ok(K.unlocked(4, 'tier', 'master'));
  assert.ok(!K.unlocked(1, 'variant', 'hollow')); assert.ok(K.unlocked(2, 'variant', 'hollow')); assert.equal(K.unlockLevel('variant', 'rubble'), 7);
  assert.equal(K.unlockLevel('variant', 'nope'), Infinity);
  for (const id of C.VARIANT_IDS) assert.ok(Number.isFinite(K.unlockLevel('variant', id)), id);
  for (const id of C.LEVEL_IDS) assert.ok(Number.isFinite(K.unlockLevel('tier', id)), id);
  assert.deepEqual(plain(K.TIERS.map(t => t.id)), C.LEVEL_IDS);
});

test('match XP: tier and variant multipliers, bonuses, hint and undo penalties, PvP flat', () => {
  const loss = K.matchXP({ outcome: 'loss', tier: 'normal', variant: 'standard', plies: 40 });
  assert.equal(loss.total, 20); assert.equal(loss.mult, 1);
  assert.equal(K.matchXP({ outcome: 'win', tier: 'normal', variant: 'standard', plies: 40 }).total, 80);
  const fast = K.matchXP({ outcome: 'win', tier: 'normal', variant: 'standard', plies: 24, second: true });
  assert.equal(fast.base, 115); assert.equal(fast.lines.length, 4);
  assert.equal(K.matchXP({ outcome: 'draw', tier: 'normal', variant: 'standard', plies: 120 }).total, 45);
  assert.equal(K.matchXP({ outcome: 'win', tier: 'master', variant: 'scaffold', plies: 40 }).total, Math.round(80 * 1.9 * 1.2));
  assert.equal(K.matchXP({ outcome: 'win', tier: 'novice', variant: 'standard', plies: 40 }).total, 40);
  assert.equal(K.matchXP({ outcome: 'win', tier: 'normal', variant: 'standard', plies: 40, hints: 2 }).total, Math.round(80 * 0.723));
  assert.equal(K.matchXP({ outcome: 'win', tier: 'normal', variant: 'standard', plies: 40, undos: 3 }).total, 40);
  assert.equal(K.matchXP({ outcome: 'win', tier: 'master', variant: 'rubble', pvp: true }).total, 10);
  assert.equal(K.matchXP({ outcome: 'win', tier: 'mystery', variant: 'mystery', plies: 40 }).total, 80);
});

test('recording games updates counters, streaks, fastest win, best tier and reports unlocks', () => {
  let p = K.blank();
  let r = K.record(p, { outcome: 'win', tier: 'hard', variant: 'standard', plies: 30 }); p = r.profile;
  assert.equal(p.games, 1); assert.equal(p.wins, 1); assert.equal(p.streak, 1); assert.equal(p.fastest, 30); assert.equal(p.bestTier, 3);
  assert.equal(p.xp, 112); assert.equal(r.before.level, 1); assert.equal(r.after.level, 1); assert.equal(r.unlocked.length, 0);
  r = K.record(p, { outcome: 'win', tier: 'easy', variant: 'standard', plies: 20 }); p = r.profile;
  assert.equal(p.streak, 2); assert.equal(p.bestStreak, 2); assert.equal(p.fastest, 20); assert.equal(p.bestTier, 3);
  assert.equal(r.after.level, 2); assert.deepEqual(plain(r.unlocked.map(u => u.id)), ['hollow']);
  r = K.record(p, { outcome: 'loss', tier: 'normal', variant: 'standard', plies: 50 }); p = r.profile;
  assert.equal(p.streak, 0); assert.equal(p.bestStreak, 2); assert.equal(p.losses, 1);
  r = K.record(p, { outcome: 'draw', tier: 'normal', variant: 'standard', plies: 120 }); p = r.profile;
  assert.equal(p.draws, 1);
  const before = { ...p };
  r = K.record(p, { outcome: 'win', tier: 'normal', variant: 'standard', plies: 9, pvp: true }); p = r.profile;
  assert.equal(p.games, before.games + 1); assert.equal(p.wins, before.wins); assert.equal(p.fastest, before.fastest); assert.equal(p.xp, before.xp + 10);
  const far = K.record({ ...K.blank(), xp: 5000 }, { outcome: 'loss', tier: 'normal', variant: 'standard' });
  assert.ok(far.after.level >= 7);
});

test('challenges: XP once per puzzle, chained unlocks and level gates', () => {
  const P = C.PUZZLES;
  let p = K.blank();
  assert.ok(K.challengeOpen(p, P, 0)); assert.ok(!K.challengeOpen(p, P, 1), 'needs the previous one');
  let r = K.recordChallenge(p, P[0], false); assert.equal(r.gain.total, 0); assert.equal(r.profile.solved.length, 0);
  r = K.recordChallenge(p, P[0], true); p = r.profile;
  assert.equal(r.gain.total, 100); assert.deepEqual(plain(p.solved), ['p01']); assert.ok(K.challengeOpen(p, P, 1));
  r = K.recordChallenge(p, P[0], true); assert.equal(r.gain.total, 10); assert.deepEqual(plain(r.profile.solved), ['p01']);
  assert.equal(K.challengeXP({ moves: 3 }, true).total, 130);
  const solved4 = { ...K.blank(), solved: ['p01', 'p02', 'p03', 'p04'] };
  assert.ok(!K.challengeOpen(solved4, P, 4), 'p05 needs level 2'); assert.ok(K.challengeOpen({ ...solved4, xp: 120 }, P, 4));
});

test('profiles are sanitized and saved through any storage', () => {
  assert.deepEqual(plain(K.sanitize(null)), plain(K.blank()));
  const dirty = K.sanitize({ xp: 12.7, games: -3, bestTier: -1, wins: 'x', solved: ['p01', 'p01', 'zz', 5, 'p14'], extra: 1 });
  assert.equal(dirty.xp, 12); assert.equal(dirty.games, 0); assert.equal(dirty.wins, 0); assert.equal(dirty.bestTier, -1); assert.deepEqual(plain(dirty.solved), ['p01', 'p14']); assert.ok(!('extra' in dirty));
  const mem = {}; const storage = { getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } };
  assert.deepEqual(plain(K.load(storage)), plain(K.blank()));
  assert.ok(K.save(storage, { ...K.blank(), xp: 300, solved: ['p02'] }));
  assert.equal(K.load(storage).xp, 300); assert.deepEqual(plain(K.load(storage).solved), ['p02']);
  assert.ok(mem[K.KEY]);
  assert.deepEqual(plain(K.load({ getItem: () => '{bad json' })), plain(K.blank()));
  assert.equal(K.save({ setItem: () => { throw new Error('full'); } }, K.blank()), false);
});
