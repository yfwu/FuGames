'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'trackgame.html'), 'utf8');
const T = vm.runInNewContext(html.match(/<script id="track-engine">([\s\S]*?)<\/script>/)[1] + ';TrackEngine;');
const C = vm.runInNewContext(html.match(/<script id="track-career">([\s\S]*?)<\/script>/)[1] + ';TrackCareer;');
const O = require('./helpers/trackgame-original.cjs');
const seeded = seed => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const plain = v => JSON.parse(JSON.stringify(v));
// The engine runs in its own vm realm, so compare structurally across realms.
const same = (a, b, msg) => assert.deepEqual(plain(a), plain(b), msg);
// Random reachable mid-game position under the original rules (no winner yet).
function randomPosition(rand, plies) {
  const g = new T.Game();
  for (let i = 0; i < plies && !g.over; i++) {
    const empties = T.emptyCells(g.board);
    const before = g.snapshot();
    g.play(empties[Math.floor(rand() * empties.length)]);
    if (g.over) { g.restore(before); break; }
  }
  return g;
}

test('page uses the full-screen Vermilion Ink shell, stays local, and every script compiles', () => {
  assert.match(html, /<link rel="stylesheet" href="shared\/fu\.css">/);
  assert.match(html, /<body class="fu-app[^"]*">/);
  assert.doesNotMatch(html, /fulab-theme\.css|class="[^"]*play-panel|<details[^>]*class="[^"]*rules|site-nav|page-header/);
  assert.match(html, /<a class="fu-brand" href="index\.html"[^>]*><span class="fu-seal"[^>]*>福遊<\/span>/);
  for (const id of ['board3d', 'drawer', 'curtain', 'dock', 'panel-rules', 'panel-settings', 'panel-career', 'cells']) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /"three":"\.\/vendor\/three\/three\.module\.min\.js"/);
  assert.match(html, /from '\.\/shared\/fu-three\.js'/);
  assert.match(html, /loadFonts\(/, 'canvas text waits for the embedded serif');
  assert.doesNotMatch(html, /https?:\/\/|fetch\(|WebSocket|XMLHttpRequest|MingLiU/);
  for (const [, src] of html.matchAll(/<script[^>]+src="([^"]+)"/g)) assert.ok(fs.existsSync(path.join(__dirname, '..', src)), src);
  for (const [, attrs, body] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/importmap|src=/.test(attrs)) continue;
    const code = /type="module"/.test(attrs) ? body.replace(/^import .*$/gm, '') : body;
    assert.doesNotThrow(() => new vm.Script(code), attrs);
  }
});

test('options default to the original game and sanitize bad input', () => {
  same(plain(T.normalizeOptions()), { dir: 1, spin: 'both', brakes: 0, blockers: 0, seed: 1 });
  same(plain(T.normalizeOptions({ dir: 'ccw', spin: 'warp', brakes: 7, blockers: -1, seed: 1.5 })), { dir: -1, spin: 'both', brakes: 0, blockers: 0, seed: 1 });
  same(plain(T.normalizeOptions({ spin: 'counter', brakes: 2, blockers: 2, seed: 9 })), { dir: 1, spin: 'counter', brakes: 2, blockers: 2, seed: 9 });
  const g = new T.Game();
  assert.equal(g.board.filter(v => v).length, 0);
  same(plain(g.brakes), [0, 0, 0]);
  assert.equal(g.canPlay(0, true), false, 'no brakes by default');
});

test('rings rotate exactly like the original in both directions', () => {
  const rand = seeded(3);
  for (let n = 0; n < 200; n++) {
    const b = Array.from({ length: 16 }, () => Math.floor(rand() * 3));
    for (const d of [1, -1]) {
      same(T.rotateBoth(b, d), O.rotateBoth(b, d));
      for (let i = 0; i < 16; i++) assert.equal(T.rotateIndex(i, d), O.rotateIndex(i, d));
    }
    assert.equal(T.checkWinnerRaw(b), O.checkWinnerRaw(b));
    for (const p of [1, 2]) assert.equal(T.resolveWinner(b, p), O.resolveWinner(b, p));
  }
  // A full lap returns every stone home.
  const b = Array.from({ length: 16 }, (_, i) => i % 3);
  let r = b; for (let i = 0; i < 12; i++) r = T.rotateBoth(r, 1); same(r, b);
});

test('default games replay the original place-rotate-judge sequence, including draws and the mover-wins tie rule', () => {
  const rand = seeded(11);
  let wins = 0, draws = 0;
  for (let n = 0; n < 300; n++) {
    const g = new T.Game({ dir: n % 2 ? -1 : 1 }), dir = n % 2 ? -1 : 1;
    let board = Array(16).fill(0), player = 1;
    while (!g.over) {
      const empties = T.emptyCells(g.board), idx = empties[Math.floor(rand() * empties.length)];
      const sim = O.simulateMove(board, player, idx, dir);
      const ev = g.play(idx);
      same(plain(g.board), sim.board);
      assert.equal(ev.winner, sim.winner);
      board = sim.board; player = player === 1 ? 2 : 1;
      if (!sim.winner && g.turn >= 16) assert.ok(ev.draw);
    }
    if (g.draw) draws++; else { wins++; same([...O.findWinCells(g.board, g.winner)].sort(), plain(g.winCells).sort()); }
  }
  assert.ok(wins > 200 && draws >= 0);
  // Constructed tie: both colours complete a line after the rotation -> the player who moved wins.
  const tie = [1, 1, 1, 1, 2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0];
  assert.equal(T.checkWinnerRaw(tie), 3);
  assert.equal(T.resolveWinner(tie, 2), 2);
  assert.equal(T.resolveWinner(tie, 1), 1);
});

test('every move reports the stones that slide, so the view can animate the turn', () => {
  const g = new T.Game();
  const ev = g.play(5);
  assert.equal(ev.landed, 6); same(plain(ev.dirs), { outer: 1, inner: 1 });
  same(plain(ev.moves), [{ id: 1, from: 5, to: 6 }]);
  const ev2 = g.play(0);
  same(plain(ev2.moves).sort((a, b) => a.id - b.id), [{ id: 1, from: 6, to: 10 }, { id: 2, from: 0, to: 1 }]);
  assert.equal(g.play(1), null, 'occupied cell is rejected');
  assert.equal(g.undo(), true); assert.equal(g.turn, 1); same(plain(g.board), (() => { const b = Array(16).fill(0); b[6] = 1; return b; })());
  assert.equal(g.player, 2);
});

test('medium AI and hint pick the same move as the original engine on 300 positions; easy draws from the same RNG', () => {
  const rand = seeded(21);
  for (let n = 0; n < 300; n++) {
    const g = randomPosition(rand, 1 + Math.floor(rand() * 11)), dir = n % 3 ? 1 : -1;
    const opts = { dir };
    const mine = T.bestMove(g.state(), opts, 'medium');
    const orig = O.bestMove(g.board.slice(), g.player, { aiPlayer: g.player, level: 'medium', dir });
    assert.equal(mine, orig, `position ${n}`);
    const r1 = seeded(n + 1), r2 = seeded(n + 1);
    const realRandom = Math.random;
    Math.random = r2;
    try { assert.equal(T.bestMove(g.state(), opts, 'easy', { rng: r1 }), O.bestMove(g.board.slice(), g.player, { aiPlayer: g.player, level: 'easy', dir })); }
    finally { Math.random = realRandom; }
  }
});

test('every search tier takes an immediate win, and deepening stops on its clock', () => {
  // Fake clock: every call advances 1 ms, so the search is deterministic.
  const clock = () => { let t = 0; return () => (t += 1); };
  const tiers = T.TIER_IDS;
  same([...tiers], ['easy', 'medium', 'hard', 'expert', 'master']);
  assert.ok(T.TIERS.master.timeMs > T.TIERS.expert.timeMs && T.TIERS.master.maxDepth > T.TIERS.expert.maxDepth);
  const rand = seeded(5);
  let checked = 0;
  for (let n = 0; n < 400 && checked < 30; n++) {
    const g = randomPosition(rand, 4 + Math.floor(rand() * 8));
    const wins = T.emptyCells(g.board).filter(i => T.simulate(g.board, g.player, i, T.normalizeOptions()).winner === g.player);
    if (!wins.length) continue;
    checked++;
    for (const tier of ['medium', 'hard', 'expert', 'master']) assert.ok(wins.includes(T.bestMove(g.state(), {}, tier, { now: clock() })), tier);
  }
  assert.ok(checked >= 10);
  const s = T.createSearch(new T.Game().state(), {}, 'hard', { now: clock() });
  let steps = 0; while (!s.step()) steps++;
  assert.ok(steps < 8); assert.ok(Number.isInteger(s.result()));
});

test('spin variants: counter turns the inner ring the other way, alternate flips every placement', () => {
  same(plain(T.ringDirs(T.normalizeOptions({}), 5)), { outer: 1, inner: 1 });
  same(plain(T.ringDirs(T.normalizeOptions({ spin: 'counter' }), 0)), { outer: 1, inner: -1 });
  same(plain(T.ringDirs(T.normalizeOptions({ spin: 'counter', dir: -1 }), 3)), { outer: -1, inner: 1 });
  const alt = T.normalizeOptions({ spin: 'alternate' });
  same([0, 1, 2, 3].map(t => T.ringDirs(alt, t).outer), [1, -1, 1, -1]);
  const g = new T.Game({ spin: 'counter' });
  assert.equal(g.play(5).landed, 9, 'inner ring counter-clockwise: 5 -> 9');
  assert.equal(g.play(0).landed, 1, 'outer ring still clockwise');
  const a = new T.Game({ spin: 'alternate' });
  assert.equal(a.play(0).landed, 1);
  const ev = a.play(5);
  same(plain(ev.dirs), { outer: -1, inner: -1 });
  assert.equal(ev.landed, 9); assert.equal(a.board[0], 1, 'first stone rolled back from 1 to 0');
  // AI simulation agrees with the game for the variant.
  const b = new T.Game({ spin: 'alternate' }); b.play(3); b.play(10);
  const free = T.emptyCells(b.board)[0], sim = T.simulate(b.board, b.player, free, b.options); b.play(free);
  same(plain(b.board), sim.board);
});

test('brakes: a braked placement does not rotate, is judged at once, and is limited per player', () => {
  const g = new T.Game({ brakes: 1 });
  same(plain(g.brakes), [0, 1, 1]);
  g.play(0); // P1 0 -> 1
  const ev = g.play(0, { brake: true }); // P2 stays at 0, nothing moves
  assert.equal(ev.brake, true); assert.equal(ev.dirs, null); same(plain(ev.moves), []);
  assert.equal(g.board[0], 2); assert.equal(g.board[1], 1);
  same(plain(g.brakes), [0, 1, 0]);
  g.play(15);
  assert.equal(g.canPlay(14, true), false, 'player 2 has no brake left');
  assert.equal(g.play(14, { brake: true }), null);
  g.undo(); g.undo(); same(plain(g.brakes), [0, 1, 1], 'undo returns the brake');
  // A brake wins when rotating would break the line.
  const w = new T.Game({ brakes: 1 });
  w.board = [1, 1, 1, 0, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0]; w.pieces = w.board.map((p, idx) => ({ id: idx + 1, idx, player: p })).filter(p => p.player); w.nextId = 20;
  const sim = T.simulate(w.board, 1, 3, w.options); assert.equal(sim.winner, 0, 'rotation breaks the row');
  const win = w.play(3, { brake: true });
  assert.equal(win.winner, 1); assert.ok(w.over); same(w.winCells.slice().sort((a, b) => a - b), [0, 1, 2, 3]);
  // ...and the AI finds that brake.
  const s = { board: [1, 1, 1, 0, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0], player: 1, brakes: [0, 1, 1] };
  const mv = T.decode(T.bestMove(s, { brakes: 1 }, 'medium'));
  same(plain(mv), { idx: 3, brake: true });
  // Without brakes the AI search never proposes one.
  for (const m of T.genMoves(s.board, 1, null)) assert.ok(m < T.BRAKE);
  assert.ok(T.heuristic(s.board, 1, [0, 1, 0]) > T.heuristic(s.board, 1, [0, 0, 0]), 'a saved brake is worth something');
});

test('blockers are seeded, ride the rings, kill lines and shorten the game', () => {
  same(T.blockerCells(7, 2), T.blockerCells(7, 2));
  const seen = new Set();
  for (let seed = 1; seed < 60; seed++) {
    const [o, i] = T.blockerCells(seed, 2); assert.ok(T.isOuter(o)); assert.ok(T.isInner(i)); seen.add(o);
    assert.equal(T.blockerCells(seed, 1)[0], o);
  }
  assert.ok(seen.size > 6, 'seed changes the layout');
  const g = new T.Game({ blockers: 2, seed: 4 });
  const blocks = g.pieces.filter(p => p.player === T.BLOCK);
  assert.equal(blocks.length, 2); assert.equal(g.board.filter(v => v === T.BLOCK).length, 2);
  const before = blocks.map(b => b.idx);
  const ev = g.play(T.emptyCells(g.board)[0]);
  same(plain(blocks.map(b => b.idx)), plain(before.map(i => T.rotateIndex(i, 1))));
  assert.ok(ev.moves.some(m => m.id === blocks[0].id));
  assert.equal(T.checkWinnerRaw([3, 3, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 0, 'blockers never win');
  assert.ok(T.heuristic([1, 1, 1, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 1) < T.heuristic([1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 1), 'a blocked line is dead');
  // A whole game ends after 14 placements at most.
  const rand = seeded(8);
  for (let n = 0; n < 50; n++) {
    const h = new T.Game({ blockers: 2, seed: n + 1 });
    while (!h.over) { const e = T.emptyCells(h.board); h.play(e[Math.floor(rand() * e.length)]); }
    assert.ok(h.turn <= 14); if (h.draw) assert.equal(h.turn, 14);
  }
});

test('AI vs AI with every variant finishes cleanly at all search tiers', () => {
  const clock = () => { let t = 0; return () => (t += 2); };
  for (const [i, opts] of [{ spin: 'counter', brakes: 1 }, { spin: 'alternate', blockers: 2, seed: 3 }, { spin: 'both', brakes: 2, blockers: 1, seed: 5, dir: -1 }].entries()) {
    const g = new T.Game(opts);
    const tiers = ['medium', 'hard', 'master'];
    let guard = 20;
    while (!g.over && guard--) {
      const mv = T.decode(T.bestMove(g.state(), g.options, tiers[(g.turn + i) % 3], { now: clock() }));
      assert.ok(g.canPlay(mv.idx, mv.brake), JSON.stringify(mv));
      g.play(mv.idx, { brake: mv.brake });
    }
    assert.ok(g.over);
    assert.ok(g.brakes[1] >= 0 && g.brakes[2] >= 0);
  }
});

test('series: single game, best of three with alternating openers, draws do not count', () => {
  let s = T.createSeries(1); s = T.seriesAdd(s, 'draw'); assert.ok(s.over); assert.equal(s.winner, null);
  s = T.seriesAdd(T.createSeries(1), 'B'); assert.equal(s.winner, 'B');
  let b = T.createSeries(3);
  assert.equal(T.seriesOpener(b, 'A'), 'A'); b = T.seriesAdd(b, 'A');
  assert.equal(T.seriesOpener(b, 'A'), 'B'); assert.equal(b.over, false);
  b = T.seriesAdd(b, 'draw'); assert.equal(b.over, false); assert.equal(T.seriesOpener(b, 'A'), 'A');
  b = T.seriesAdd(b, 'A'); assert.ok(b.over); assert.equal(b.winner, 'A'); same(plain(b.wins), { A: 2, B: 0 });
  let c = T.createSeries(3); for (const r of ['A', 'B', 'draw', 'draw']) c = T.seriesAdd(c, r);
  assert.ok(c.over); assert.equal(c.winner, null); assert.equal(c.results.length, 4);
  let d = T.createSeries(3); for (const r of ['B', 'draw', 'draw', 'A']) d = T.seriesAdd(d, r);
  assert.ok(d.over); assert.equal(d.winner, null);
  let e = T.createSeries(3); for (const r of ['B', 'draw', 'draw', 'draw']) e = T.seriesAdd(e, r);
  assert.equal(e.winner, 'B');
});

test('career XP scales with result, tier, variants and clean play; levels and ranks advance', () => {
  same(plain(C.levelOf(0)), { level: 1, into: 0, need: 120, max: false });
  assert.equal(C.levelOf(120).level, 2); assert.equal(C.levelOf(119).level, 1);
  assert.equal(C.levelOf(1e9).level, C.MAX_LEVEL); assert.ok(C.levelOf(1e9).max);
  assert.equal(C.rankOf(1), '學徒'); assert.equal(C.rankOf(5), '軌師'); assert.equal(C.rankOf(30), '天樞');
  const win = { mode: 'ai', outcome: 'win', tier: 'medium', variants: 0, turns: 16, undos: 0, hints: 0 };
  const loss = { ...win, outcome: 'loss' }, draw = { ...win, outcome: 'draw' };
  assert.equal(C.matchXP(win).total, 80); assert.equal(C.matchXP(loss).total, 20); assert.equal(C.matchXP(draw).total, 50);
  assert.ok(C.matchXP({ ...win, turns: 9 }).total > C.matchXP(win).total, 'fast wins pay more');
  assert.ok(C.matchXP({ ...win, undos: 1 }).total < C.matchXP(win).total, 'undo forfeits the clean bonus');
  assert.ok(C.matchXP({ ...win, hints: 1 }).total < C.matchXP(win).total, 'hint forfeits the clean bonus');
  assert.ok(C.matchXP({ ...win, second: true }).total > C.matchXP(win).total);
  let last = 0;
  for (const tier of C.TIER_ORDER) { const t = C.matchXP({ ...win, tier }).total; assert.ok(t > last, tier); last = t; }
  assert.equal(C.matchXP({ ...win, variants: 2 }).mult, 1.3);
  assert.equal(C.matchXP({ ...win, tier: 'master', variants: 3 }).mult, 2.9);
  assert.ok(C.matchXP({ ...win, seriesWon: true }).total >= C.matchXP(win).total + 60);
  assert.equal(C.matchXP({ mode: 'pvp' }).total, 15);
});

test('unlocks gate variants and the master tier; the original four AI levels are open from level 1', () => {
  for (const tier of ['easy', 'medium', 'hard', 'expert']) assert.ok(C.unlocked(1, 'tier', tier));
  assert.equal(C.unlocked(1, 'tier', 'master'), false); assert.ok(C.unlocked(5, 'tier', 'master'));
  assert.ok(C.unlocked(1, 'spin', 'both')); assert.equal(C.unlocked(1, 'spin', 'counter'), false); assert.ok(C.unlocked(2, 'spin', 'counter'));
  assert.equal(C.unlocked(3, 'spin', 'alternate'), false); assert.ok(C.unlocked(4, 'spin', 'alternate'));
  assert.equal(C.unlocked(2, 'brakes', 1), false); assert.ok(C.unlocked(3, 'brakes', 1)); assert.equal(C.unlocked(7, 'brakes', 2), false);
  assert.equal(C.unlocked(5, 'blockers', 1), false); assert.ok(C.unlocked(9, 'blockers', 2));
  assert.equal(C.unlocked(1, 'series', 3), false); assert.ok(C.unlocked(1, 'series', 1));
  for (const u of C.UNLOCKS) {
    if (u.kind === 'tier') assert.ok(T.TIERS[u.id]);
    if (u.kind === 'spin') assert.ok(T.SPINS.includes(u.id));
    if (u.kind === 'brakes' || u.kind === 'blockers') assert.ok(T.normalizeOptions({ [u.kind]: Number(u.id) })[u.kind] === Number(u.id));
  }
});

test('record() updates stats, streaks and achievements once, reports new unlocks, and saves survive bad data', () => {
  const win = { mode: 'ai', outcome: 'win', tier: 'expert', variants: 0, turns: 8, undos: 0, hints: 0, second: true };
  const r = C.record(C.blank(), win);
  assert.equal(r.profile.games, 1); assert.equal(r.profile.wins, 1); assert.equal(r.profile.streak, 1); assert.equal(r.profile.fastestWin, 8); assert.equal(r.profile.bestTier, 'expert');
  const ids = r.achievements.map(a => a.id).sort();
  same(ids, ['clean', 'expert', 'first', 'quick', 'second']);
  assert.equal(r.total, r.xp.total + 5 * C.ACH_XP);
  assert.ok(r.after.level > r.before.level); assert.ok(r.unlocked.length >= 1);
  const again = C.record(r.profile, win); assert.equal(again.achievements.length, 0, 'achievements are earned once');
  const lost = C.record(again.profile, { ...win, outcome: 'loss' }); assert.equal(lost.profile.streak, 0); assert.equal(lost.profile.bestStreak, 2); assert.equal(lost.profile.losses, 1);
  const brake = C.record(C.blank(), { ...win, tier: 'easy', brakeWin: true, second: false });
  assert.ok(brake.achievements.some(a => a.id === 'brake'));
  let p = C.blank(); for (let i = 0; i < 5; i++) p = C.record(p, { ...win, tier: 'easy' }).profile; assert.ok(p.achievements.includes('streak'));
  const pv = C.record(C.blank(), { mode: 'pvp' }); assert.equal(pv.profile.pvp, 1); assert.equal(pv.profile.games, 0); assert.equal(pv.total, 15); assert.equal(pv.achievements.length, 0);
  same(plain(C.sanitize({ xp: -5, wins: 'x', games: 3.7, bestTier: 'god', achievements: ['first', 'first', 'nope'] })), { ...plain(C.blank()), games: 3, achievements: ['first'] });
  const mem = new Map(), storage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.ok(C.save(storage, r.profile)); assert.equal(C.load(storage).xp, r.profile.xp);
  assert.ok(C.KEY.startsWith('fugames:'));
  mem.set(C.KEY, '{broken'); assert.equal(C.load(storage).xp, 0);
  assert.equal(C.load(null).xp, 0);
  assert.equal(C.save({ setItem() { throw new Error('quota'); } }, r.profile), false);
});
