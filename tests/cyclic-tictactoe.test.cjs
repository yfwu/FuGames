'use strict';
// 三子循環棋（平面版）: rules core, AI tiers, solved table, challenges, career and page shell.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../cyclic2d-engine.js');
const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'cyclic_tictactoe.html'), 'utf8');
const seeded = seed => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const play = (g, ...cells) => { for (const c of cells) assert.ok(g.play(c), 'move ' + c); return g; };
const { X, O } = C;

function career() {
  const body = page.match(/<script id="cyclic2d-career">([\s\S]*?)<\/script>/)[1];
  const ctx = {}; vm.createContext(ctx); vm.runInContext(body + '\nthis.K=CyclicCareer;', ctx);
  return ctx.K;
}
const plain = x => JSON.parse(JSON.stringify(x));

// ---------- original rules ----------
test('the 3×3 board has the 8 classic lines and options default to the original game', () => {
  const g = new C.Game();
  assert.equal(g.size, 3); assert.equal(g.stones, 3); assert.equal(g.choice, 1); assert.deepEqual(g.blocked, []);
  assert.equal(g.repeatLimit, 0); assert.equal(g.plyLimit, 0);
  assert.equal(g.lines.length, 8);
  const sorted = g.lines.map(l => l.slice().sort((a, b) => a - b).join()).sort();
  assert.deepEqual(sorted, ['0,1,2', '0,3,6', '0,4,8', '1,4,7', '2,4,6', '2,5,8', '3,4,5', '6,7,8']);
  assert.deepEqual(g.liveCount, [3, 2, 3, 2, 4, 2, 3, 2, 3]);
  assert.deepEqual(C.normalizeOptions({ size: 9, choice: 5, blocked: [4, 4, 99, 'x'], repeatLimit: -2, plyLimit: 1.5 }),
    { size: 3, stones: 3, connect: 3, choice: 1, blocked: [4], repeatLimit: 0, plyLimit: 0 });
  assert.deepEqual(C.variantOptions('standard'), {}); assert.deepEqual(C.variantOptions('nope'), {});
  assert.deepEqual(C.VARIANT_IDS, ['standard', 'choice', 'hollow', 'wide']);
});

test('FIFO: once three are down, each move lifts the oldest, which cannot return to its own cell', () => {
  const g = play(new C.Game(), 0, 8, 1, 7, 5, 3);
  assert.deepEqual(g.queues[X], [0, 1, 5]); assert.equal(g.leaving(X), 0);
  assert.equal(g.play(0), null, 'the oldest cell is occupied when the move starts');
  assert.equal(g.play(8), null, 'no captures');
  assert.equal(g.legalMoves().length, 3); assert.ok(g.legalMoves().every(m => m.from === 0));
  play(g, 2);
  assert.equal(g.board[0], 0); assert.equal(g.board[2], X); assert.deepEqual(g.queues[X], [1, 5, 2]);
  assert.equal(g.winner, 0, '1,2 + 5 is not a line');
  assert.equal(g.ply, 7); assert.equal(g.turn, O);
});

test('a win is judged after the oldest stone leaves', () => {
  // X: 0, 4, then 3; X's oldest (0) leaves on the next move, so 8 does not finish the diagonal.
  const g = play(new C.Game(), 0, 1, 4, 2, 3, 6);
  assert.equal(g.wouldWin(X, 8), null);
  assert.ok(!g.threats(X).includes(8));
  assert.deepEqual(g.threats(X), [5], '3-4-5 survives the lift');
  play(g, 5);
  assert.equal(g.winner, X); assert.deepEqual(g.winLine.slice().sort(), [3, 4, 5]);
  assert.ok(g.over); assert.deepEqual(g.legalMoves(), []); assert.equal(g.play(7), null);
});

test('no draw rule by default (the original endless game), but a threefold repetition can be claimed', () => {
  const g = play(new C.Game(), 0, 8, 1, 7, 5, 3);
  // Shuffle stones around without anyone winning: the same position comes back.
  const loop = [6, 2, 0, 8, 1, 7, 5, 3];
  for (let i = 0; i < 3; i++) for (const c of loop) { if (g.over) break; g.play(c); }
  assert.ok(!g.over, 'no automatic draw');
  assert.ok(g.repetitions() >= 3);
  assert.ok(g.canClaimDraw()); assert.ok(g.claimDraw()); assert.equal(g.draw, 'claimed'); assert.ok(g.over);
  const fresh = new C.Game(); assert.equal(fresh.claimDraw(), false);
});

test('the optional draw rule ends the game on the third repetition or at the ply limit', () => {
  const g = play(new C.Game(C.DRAW_RULE), 0, 8, 1, 7, 5, 3);
  const loop = [6, 2, 0, 8, 1, 7, 5, 3];
  for (let i = 0; i < 3 && !g.over; i++) for (const c of loop) { if (g.over) break; g.play(c); }
  assert.equal(g.draw, 'repetition'); assert.equal(g.winner, 0);
  const h = new C.Game({ plyLimit: 4 }); play(h, 0, 8, 1, 7);
  assert.equal(h.draw, 'ply-limit');
});

test('state survives JSON round trips, and make/unmake restores everything', () => {
  for (const opts of [{}, C.variantOptions('choice'), C.variantOptions('hollow'), C.variantOptions('wide'), C.DRAW_RULE]) {
    const a = new C.Game(opts), rng = seeded(9);
    for (let i = 0; i < 9 && !a.over; i++) { const ms = a.legalMoves(); const m = ms[Math.floor(rng() * ms.length)]; a.play(m.to, m.from); }
    const b = C.Game.from(JSON.parse(JSON.stringify(a)));
    assert.equal(b.key(), a.key()); assert.deepEqual(b.board, a.board); assert.deepEqual(b.options(), a.options());
    assert.deepEqual(b.legalMoves(), a.legalMoves()); assert.equal(b.repetitions(), a.repetitions());
    if (a.over) continue;
    const before = JSON.stringify(a.toJSON());
    for (const m of a.legalMoves()) { const u = a._do(m); a._undo(m, u); }
    assert.equal(JSON.stringify(a.toJSON()), before);
  }
});

// ---------- variants ----------
test('擇二 (choice): either of the two oldest stones may be lifted, never the newest', () => {
  const g = play(new C.Game(C.variantOptions('choice')), 0, 8, 1, 7, 5, 3);
  assert.deepEqual(g.liftable(), [0, 1]);
  assert.equal(g.legalMoves().length, 6);
  assert.ok(g.legal(2, 1)); assert.ok(!g.legal(2, 5), 'newest stone cannot move'); assert.ok(!g.legal(2, 8), 'not your stone');
  g.play(2, 1);
  assert.deepEqual(g.queues[X], [0, 5, 2], 'the lifted stone leaves the queue, the rest keep their order');
  assert.equal(g.board[1], 0);
  // Threats consider both lifts: X [0,5,2] can lift 0 or 5.
  const t = C.fromPosition({ queues: { [X]: [5, 0, 1], [O]: [3, 6, 8] }, turn: X }, C.variantOptions('choice'));
  assert.deepEqual(t.wouldWin(X, 2, 5), [0, 1, 2]); assert.equal(t.wouldWin(X, 2, 0), null);
  assert.ok(t.threats(X).includes(2));
  t.play(2, 5); assert.equal(t.winner, X);
  // The default variant still forces the oldest.
  const s = C.fromPosition({ queues: { [X]: [5, 0, 1], [O]: [3, 6, 8] }, turn: X });
  assert.ok(!s.legal(2, 0)); assert.deepEqual(s.wouldWin(X, 2), [0, 1, 2]);
  s.play(2); assert.equal(s.winner, X, 'lifting 5 (the oldest) also completes 0-1-2');
});

test('空心 (hollow): the centre is sealed and the four lines through it are dead', () => {
  const g = new C.Game(C.variantOptions('hollow'));
  assert.equal(g.board[4], C.BLOCK); assert.equal(g.legal(4), false); assert.ok(!g.legalMoves().some(m => m.to === 4));
  assert.deepEqual(g.liveCount, [2, 1, 2, 1, 0, 1, 2, 1, 2]);
  play(g, 0, 1, 8);
  assert.deepEqual(g.threats(X), [], 'no threat through the seal');
  const m = C.chooseMove(g, { level: 'hard', rng: seeded(1), timeMs: 0, maxNodes: 20000 });
  assert.notEqual(m.to, 4);
});

test('廣盤 (wide): 4×4, four stones each, four in a row (10 lines)', () => {
  const g = new C.Game(C.variantOptions('wide'));
  assert.equal(g.cells, 16); assert.equal(g.stones, 4); assert.equal(g.lines.length, 10);
  play(g, 0, 4, 1, 5, 2, 6);
  assert.equal(g.leaving(X), -1, 'three down, still placing');
  assert.deepEqual(g.threats(X), [3]);
  play(g, 15, 7);
  assert.equal(g.winner, O, 'O completes 4-5-6-7'); assert.deepEqual(g.winLine, [4, 5, 6, 7]);
  const h = play(new C.Game(C.variantOptions('wide')), 0, 4, 1, 5, 2, 6, 15, 12, 3);
  assert.equal(h.board[0], 0, 'fifth stone lifts the oldest');
  assert.equal(h.winner, 0, 'row 0-1-2-3 needs the stone that just left');
  assert.equal(C.label(15, 4), 'D4');
});

// ---------- AI ----------
test('the classic tier reproduces the original page AI', () => {
  // Original: win if possible; else the first move (board order) that leaves X no immediate win.
  const g = play(new C.Game(), 4, 0, 1);
  assert.deepEqual(C.classicMove(g), { from: -1, to: 7 }, 'blocks 1-4-7');
  const opening = play(new C.Game(), 4);
  assert.equal(C.chooseMove(opening, { level: 'classic' }).to, 0, 'first safe cell');
  const w = C.fromPosition({ queues: { [X]: [0, 8, 6], [O]: [1, 4, 5] }, turn: O });
  assert.equal(C.chooseMove(w, { level: 'classic' }).to, 3, 'O lifts 1 and wins on 3-4-5');
});

test('every tier takes a win and blocks an immediate loss', () => {
  for (const level of C.LEVEL_IDS) {
    const g = play(new C.Game(), 0, 3, 1);
    const m = C.chooseMove(g, { level, rng: seeded(2), timeMs: 0, maxNodes: 20000 });
    assert.equal(m.to, 2, level + ' blocks 0-1-2');
    const h = play(new C.Game(), 0, 3, 1, 4, 8);
    assert.equal(C.chooseMove(h, { level, rng: seeded(3), timeMs: 0, maxNodes: 20000 }).to, 5, level + ' wins on 3-4-5');
  }
});

test('the solved table: the standard game is a first-player win, but only from an edge', () => {
  const T = C.solveTable({});
  assert.equal(T.size, 66954);
  const start = new C.Game();
  assert.deepEqual(T.lookup(start), { value: 1, plies: 13 });
  const values = start.legalMoves().map(m => { const h = start.clone(); h.play(m.to); return -T.lookup(h).value || 0; });
  assert.deepEqual(values, [0, 1, 0, 1, 0, 1, 0, 1, 0]);
  assert.equal(C.solveTable({}), T, 'cached');
  assert.equal(C.solveTable(C.variantOptions('wide')), null);
  assert.deepEqual(C.solveTable(C.variantOptions('hollow')).lookup(new C.Game(C.variantOptions('hollow'))), { value: 0, plies: 0 });
  assert.equal(C.solveTable(C.variantOptions('choice')).lookup(new C.Game(C.variantOptions('choice'))).value, 1);
});

test('master plays perfectly: it wins as first player against every other tier', () => {
  for (const [i, level] of ['novice', 'classic', 'normal', 'hard'].entries()) {
    const rng = seeded(11 + i), g = new C.Game(C.DRAW_RULE);
    while (!g.over) { const m = C.chooseMove(g, { level: g.turn === X ? 'master' : level, rng, timeMs: 0, maxNodes: 30000 }); g.play(m.to, m.from); }
    assert.equal(g.winner, X, 'master beats ' + level);
    assert.ok(g.ply <= 13);
  }
  // As second player against a centre opening (a theoretical draw) it never loses.
  const rng = seeded(5), g = play(new C.Game(C.DRAW_RULE), 4);
  while (!g.over) { const m = C.chooseMove(g, { level: g.turn === O ? 'master' : 'hard', rng, timeMs: 0, maxNodes: 30000 }); g.play(m.to, m.from); }
  assert.notEqual(g.winner, X);
});

test('self-play keeps the invariants on every variant', () => {
  for (const [s, variant] of C.VARIANT_IDS.entries()) {
    const rng = seeded(s + 1), g = new C.Game(Object.assign(C.variantOptions(variant), C.DRAW_RULE));
    while (!g.over) {
      const m = C.chooseMove(g, { level: ['novice', 'normal'][g.ply % 2], rng, timeMs: 0, maxNodes: 15000 });
      assert.ok(g.legal(m.to, m.from)); g.play(m.to, m.from);
      assert.ok(g.queues[X].length <= g.stones && g.queues[O].length <= g.stones);
      assert.equal(g.board.filter(v => v === X || v === O).length, g.queues[X].length + g.queues[O].length);
    }
    assert.ok(g.ply <= C.DRAW_RULE.plyLimit);
    if (g.winner) assert.ok(g.winLine.every(c => g.board[c] === g.winner));
  }
});

// ---------- challenges ----------
test('every challenge has exactly one first move that forces a line in time, and none faster', () => {
  assert.equal(C.PUZZLES.length, 15);
  assert.equal(new Set(C.PUZZLES.map(p => p.id)).size, 15);
  for (const p of C.PUZZLES) {
    const g = C.puzzleGame(p);
    assert.equal(g.turn, p.turn, p.id);
    assert.deepEqual(g.threats(g.turn), [], p.id + ' no immediate win');
    const wins = C.forcedWinMoves(g, p.moves);
    assert.equal(wins.length, 1, p.id + ' unique key');
    assert.equal(wins[0].to, p.key, p.id);
    assert.equal(wins[0].from, p.from === undefined ? g.leaving() : p.from, p.id);
    assert.equal(C.forcedWin(g, p.moves - 1), null, p.id + ' not faster');
    const T = C.solveTable(g.options());
    if (T) assert.deepEqual(T.lookup(g), { value: 1, plies: 2 * p.moves - 1 }, p.id + ' agrees with the table');
  }
  const K = career();
  for (const p of C.PUZZLES) assert.ok(p.level >= K.unlockLevel('variant', p.variant), p.id + ' variant unlocked by then');
});

test('a challenge played out: the key move then perfect defence still ends in a win', () => {
  const p = C.PUZZLES[2], g = C.puzzleGame(p);
  let mine = 0;
  while (!g.over) {
    if (g.turn === p.turn) { const m = C.forcedWin(g, p.moves - mine); assert.ok(m); g.play(m.to, m.from); mine++; }
    else { const m = C.chooseMove(g, { level: 'master' }); g.play(m.to, m.from); }
  }
  assert.equal(g.winner, p.turn); assert.ok(mine <= p.moves);
});

// ---------- career ----------
test('career: levels, ranks and XP rules', () => {
  const K = career();
  assert.deepEqual(plain(K.levelOf(0)), { level: 1, into: 0, need: 110, max: false });
  assert.equal(K.levelOf(110).level, 2); assert.equal(K.levelOf(109).into, 109);
  let xp = 0; for (let l = 1; l < K.MAX_LEVEL; l++) xp += K.need(l);
  assert.deepEqual(plain(K.levelOf(xp)), { level: 30, into: 0, need: 0, max: true });
  assert.equal(K.levelOf(-5).level, 1); assert.equal(K.levelOf('junk').level, 1);
  assert.equal(K.rankOf(1), '入門'); assert.equal(K.rankOf(3), '初段'); assert.equal(K.rankOf(26), '循環名人');
  const base = { tier: 'normal', variant: 'standard', plies: 21, second: false, hints: 0, undos: 0 };
  assert.equal(K.matchXP({ ...base, outcome: 'loss' }).total, 20);
  assert.equal(K.matchXP({ ...base, outcome: 'draw' }).total, 45);
  assert.equal(K.matchXP({ ...base, outcome: 'win' }).total, 80);
  assert.equal(K.matchXP({ ...base, outcome: 'win', plies: 13, second: true }).total, 115);
  assert.equal(K.matchXP({ ...base, outcome: 'win', tier: 'master', variant: 'wide' }).total, Math.round(80 * 2 * 1.2));
  assert.equal(K.matchXP({ ...base, outcome: 'win', tier: 'classic' }).total, 60);
  assert.equal(K.matchXP({ ...base, outcome: 'win', blind: true }).total, 88);
  assert.equal(K.matchXP({ ...base, outcome: 'loss', blind: true }).total, 20, 'blind bonus only on wins');
  assert.equal(K.matchXP({ ...base, outcome: 'win', hints: 2 }).total, Math.round(80 * .7225));
  assert.equal(K.matchXP({ ...base, outcome: 'win', undos: 1 }).total, 40);
  assert.equal(K.matchXP({ outcome: 'win', pvp: true }).total, 10);
  assert.equal(K.challengeXP({ moves: 3 }, true).total, 115); assert.equal(K.challengeXP({ moves: 3 }, false).total, 10);
});

test('career: recording games, unlocks, challenges and storage', () => {
  const K = career();
  let p = K.blank();
  const win = { outcome: 'win', tier: 'hard', variant: 'standard', plies: 13, second: false, hints: 0, undos: 0 };
  let r = K.record(p, win);
  assert.equal(r.profile.wins, 1); assert.equal(r.profile.streak, 1); assert.equal(r.profile.fastest, 13); assert.equal(r.profile.bestTier, 3);
  assert.equal(r.gain.total, Math.round(100 * 1.4));
  assert.equal(r.after.level, 2); assert.deepEqual(plain(r.unlocked.map(u => u.id)), ['hollow']);
  r = K.record(r.profile, { ...win, outcome: 'loss' });
  assert.equal(r.profile.streak, 0); assert.equal(r.profile.bestStreak, 1); assert.equal(r.profile.losses, 1);
  r = K.record(r.profile, { ...win, tier: 'master' });
  assert.equal(r.profile.masterWins, 1); assert.equal(r.profile.bestTier, 4);
  const pvp = K.record(r.profile, { outcome: 'win', pvp: true });
  assert.equal(pvp.profile.wins, r.profile.wins, 'pvp does not touch the AI record'); assert.equal(pvp.profile.games, r.profile.games + 1);
  assert.ok(K.unlocked(1, 'tier', 'classic')); assert.ok(!K.unlocked(3, 'tier', 'master')); assert.ok(K.unlocked(4, 'tier', 'master'));
  assert.ok(!K.unlocked(4, 'variant', 'wide')); assert.ok(K.unlocked(5, 'variant', 'wide'));
  // Challenges open in order and by level.
  const P = [{ id: 'p01', level: 1, moves: 2 }, { id: 'p02', level: 1, moves: 2 }, { id: 'p03', level: 3, moves: 3 }];
  let q = K.blank();
  assert.ok(K.challengeOpen(q, P, 0)); assert.ok(!K.challengeOpen(q, P, 1));
  let c = K.recordChallenge(q, P[0], true); assert.equal(c.gain.total, 90); q = c.profile;
  assert.ok(K.challengeOpen(q, P, 1));
  c = K.recordChallenge(q, P[0], true); assert.equal(c.gain.total, 10); assert.deepEqual(plain(c.profile.solved), ['p01']);
  c = K.recordChallenge(q, P[1], false); assert.equal(c.gain.total, 0); assert.deepEqual(plain(c.profile.solved), ['p01']);
  q = K.recordChallenge(q, P[1], true).profile;
  assert.ok(!K.challengeOpen(q, P, 2), 'level gate'); assert.ok(K.challengeOpen({ ...q, xp: 1000 }, P, 2));
  // Storage round trip and sanitizing.
  const mem = new Map(), storage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.ok(K.save(storage, q)); assert.deepEqual(plain(K.load(storage)), plain(K.sanitize(q)));
  mem.set(K.KEY, '{"xp":-4,"wins":"x","solved":["p01","bad",3,"p01"],"bestTier":-1}');
  const s = K.load(storage); assert.equal(s.xp, 0); assert.equal(s.wins, 0); assert.deepEqual(plain(s.solved), ['p01']);
  mem.set(K.KEY, '{broken'); assert.deepEqual(plain(K.load(storage)), plain(K.blank()));
  assert.equal(K.save({ setItem() { throw new Error('full'); } }, q), false);
  assert.deepEqual(plain(K.TIERS.map(t => t.id)), C.LEVEL_IDS, 'career tiers match engine levels');
  assert.deepEqual(Object.keys(K.VARIANT_XP).sort(), C.VARIANT_IDS.slice().sort());
});

// ---------- page shell ----------
test('page is a full-screen Vermilion Ink stage that loads the engine and worker locally', () => {
  assert.match(page, /<script src="cyclic2d-engine.js"><\/script>/);
  assert.match(page, /new Worker\('cyclic2d-ai-worker.js'\)/);
  assert.match(fs.readFileSync(path.join(root, 'cyclic2d-ai-worker.js'), 'utf8'), /importScripts\('cyclic2d-engine.js'\)/);
  assert.match(page, /icons\.svg#cyclic_tictactoe"/);
  assert.match(page, /<link rel="stylesheet" href="shared\/fu\.css">/);
  assert.match(page, /<body class="fu-app[^"]*">/);
  assert.doesNotMatch(page, /fulab-theme\.css|play-panel|details class="card rules"|site-nav|page-header/);
  assert.match(page, /class="fu-seal"[^>]*>福遊</);
  assert.match(page, /href="index\.html"/);
  assert.match(page, /<main class="fu-stage"[^>]*><canvas id="boardCanvas"/);
  for (const id of ['lobby', 'challenges', 'result', 'settings', 'rules']) assert.match(page, new RegExp('id="' + id + '"'));
  assert.match(page, /import \{ fonts, loadFonts \} from '\.\/shared\/fu-three\.js'/);
  assert.match(page, /loadFonts\(/);
  assert.doesNotMatch(page, /fetch\(|WebSocket|https?:\/\/|MingLiU/);
  // Defaults: the original opponent, rules and move-order hints.
  assert.match(page, /tier:'classic',variant:'standard',mode:'ai',seat:'0',drawRule:false,next:true,next2:true/);
  for (const [, attrs, body] of page.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/src=/.test(attrs)) continue;
    const code = /type="module"/.test(attrs) ? '(async()=>{' + body.replace(/^import .*$/gm, '') + '\n})' : body;
    assert.doesNotThrow(() => new vm.Script(code), attrs);
  }
  assert.match(fs.readFileSync(path.join(root, 'archive.html'), 'utf8'), /href="cyclic_tictactoe.html"/);
});
