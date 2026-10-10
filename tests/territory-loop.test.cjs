'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the exact inline engine shipped to the browser, without a second implementation.
const html = fs.readFileSync(path.join(__dirname, '../territory_loop.html'), 'utf8');
const scripts = [...html.matchAll(/<script id="([^"]+)">([\s\S]*?)<\/script>/g)];
const T = vm.runInNewContext(scripts.find(([, id]) => id === 'game-engine')[2] + '; Territory;');
const at = T.index;
const seeded = seed => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
function running() { const game = new T.Game(seeded(1)); game.start(); return game; }
function walk(game, direction, steps) { for (let n = 0; n < steps; n++) game.move(game.actors[0], T.DIRECTIONS[direction]); }

test('both shipped scripts parse; page uses only the shared local stylesheet', () => {
  assert.equal(scripts.length, 2);
  for (const [, , source] of scripts) assert.doesNotThrow(() => new vm.Script(source));
  assert.doesNotMatch(html, /<script[^>]+src=|https?:\/\/|fetch\(|WebSocket/);
});

test('ready and paused rounds do not advance; reset clears all round state', () => {
  const game = new T.Game(seeded(5));
  game.step(); assert.equal(game.tick, 0);
  assert.deepEqual(Array.from(game.counts()), [825, 25, 25, 25]);
  game.start(); game.step(); game.pause();
  const snapshot = JSON.stringify(game);
  game.step(); assert.equal(JSON.stringify(game), snapshot);
  assert.equal(game.steer('up'), false);
  game.start(); game.step(); assert.equal(game.tick, 2);
  game.reset();
  assert.equal(game.phase, 'ready'); assert.equal(game.tick, 0); assert.equal(game.result, null);
  assert.equal(game.trails.some(Boolean), false);
  assert.equal(game.actors.every(a => a.alive && !a.trail.length && !a.plan.length && !a.pending), true);
  assert.deepEqual(Array.from(game.counts()), [825, 25, 25, 25]);
});

test('a closed loop fills its interior, captures enemy land and leaves the exterior alone', () => {
  const game = running();
  game.board[at(8, 17)] = 2;
  walk(game, 'right', 4); walk(game, 'down', 4); walk(game, 'left', 4);
  assert.equal(game.counts()[1], 25); assert.equal(game.board[at(8, 16)], 0);
  walk(game, 'up', 2);
  assert.equal(game.counts()[1], 41);
  assert.equal(game.board[at(8, 17)], 1); assert.equal(game.board[at(8, 16)], 1);
  assert.equal(game.board[at(10, 16)], 0);
  assert.equal(game.actors[0].trail.length, 0); assert.equal(game.trails.some(Boolean), false);
  assert.equal(game.events.find(e => e.type === 'capture').gain, 16);
});

test('flood fill seeds all four edges: dividing the map does not claim either open side', () => {
  const game = running(), a = game.actors[0];
  game.board.fill(0); game.actors[1].alive = false; game.actors[2].alive = false;
  for (let y = 0; y < T.SIZE; y++) game.board[at(15, y)] = 1;
  game.board[at(15, 14)] = 0; game.trails[at(15, 14)] = 1; a.trail = [at(15, 14)];
  game.capture(a);
  assert.equal(game.counts()[1], T.SIZE);
  assert.equal(game.board[at(0, 14)], 0); assert.equal(game.board[at(29, 14)], 0);
});

test('touching your own unfinished path ends the round and clears its ownership', () => {
  const game = running();
  walk(game, 'right', 4); walk(game, 'down', 2); walk(game, 'left', 1); walk(game, 'up', 2);
  assert.equal(game.phase, 'over'); assert.equal(game.result.outcome, 'loss');
  assert.match(game.result.reason, /自己/);
  assert.equal(game.trails.includes(1), false); assert.equal(game.board.includes(1), false);
});

test('cutting an opponent trail eliminates only that opponent and frees their land', () => {
  const game = running(), enemy = game.actors[1];
  enemy.trail = [at(8, 14)]; game.trails[at(8, 14)] = 2;
  walk(game, 'right', 3);
  assert.equal(enemy.alive, false); assert.equal(game.board.includes(2), false);
  assert.equal(game.actors[2].alive, true); assert.equal(game.phase, 'running');
  assert.equal(game.trails[at(8, 14)], 1);
});

test('a trail enclosed by a capture is cut, with no orphan trail cells', () => {
  const game = running(), enemy = game.actors[1];
  enemy.trail = [at(8, 17)]; game.trails[at(8, 17)] = 2;
  walk(game, 'right', 4); walk(game, 'down', 4); walk(game, 'left', 4); walk(game, 'up', 2);
  assert.equal(enemy.alive, false); assert.equal(game.trails.includes(2), false);
  assert.equal(game.board[at(8, 17)], 1);
});

test('losing the last owned cell is a clear elimination', () => {
  const game = running(), enemy = game.actors[1];
  for (let cell = 0; cell < game.board.length; cell++) if (game.board[cell] === 2) game.board[cell] = 0;
  game.board[at(8, 17)] = 2;
  walk(game, 'right', 4); walk(game, 'down', 4); walk(game, 'left', 4); walk(game, 'up', 2);
  assert.equal(enemy.alive, false);
  assert.match(game.events.find(e => e.type === 'eliminated').reason, /領地/);
});

test('all four boundaries stop movement without wrapping or killing; turning escapes', () => {
  for (const [x, y, outward, turn] of [[0, 5, 'left', 'up'], [29, 5, 'right', 'up'], [5, 0, 'up', 'right'], [5, 29, 'down', 'right']]) {
    const game = running(), a = game.actors[0]; a.x = x; a.y = y;
    game.move(a, T.DIRECTIONS[outward]);
    assert.deepEqual([a.x, a.y], [x, y]); assert.equal(a.blocked, true); assert.equal(a.alive, true);
    game.move(a, T.DIRECTIONS[turn]);
    assert.equal(a.blocked, false); assert.notDeepEqual([a.x, a.y], [x, y]);
  }
});

test('rapid queued input cannot reverse the last executed move', () => {
  const game = running();
  assert.equal(game.steer('left'), false);
  assert.equal(game.steer('up'), true);
  assert.equal(game.steer('left'), false);
  game.step(); assert.deepEqual([game.actors[0].x, game.actors[0].y], [5, 13]);
  assert.equal(game.steer('left'), true);
  assert.equal(game.steer('bogus'), false);
});

test('target, timeout lead, timeout tie, timeout loss and last survivor resolve correctly', () => {
  for (const id of [1, 2]) {
    const game = running(); game.board.fill(id, 0, 315); game.checkResult();
    assert.equal(game.result.outcome, id === 1 ? 'win' : 'loss'); assert.match(game.result.reason, /35%/);
  }
  for (const [owner, expected] of [[0, 'draw'], [1, 'win'], [2, 'loss']]) {
    const game = running(); if (owner) game.board[0] = owner;
    game.tick = T.ROUND_TICKS; game.checkResult();
    assert.equal(game.result.outcome, expected); assert.match(game.result.reason, /時間到/);
    const snapshot = JSON.stringify(game); game.step(); assert.equal(JSON.stringify(game), snapshot);
  }
  const game = running(); game.eliminate(game.actors[1], 'test'); game.eliminate(game.actors[2], 'test'); game.checkResult();
  assert.equal(game.result.outcome, 'win');
});

test('AI attacks an adjacent exposed trail and can route home without crossing itself', () => {
  const game = running(), a = game.actors[1];
  game.trails[at(a.x + 1, a.y)] = 1; game.actors[0].trail = [at(a.x + 1, a.y)];
  assert.deepEqual(Array.from(game.aiDirection(a)), [1, 0]);
  game.move(a, [1, 0]); assert.equal(game.result.outcome, 'loss');
  const returnGame = running(), b = returnGame.actors[1];
  for (let n = 0; n < 4; n++) returnGame.move(b, [-1, 0]);
  const route = returnGame.pathHome(b);
  assert.ok(route.length); assert.ok(route.every(cell => returnGame.trails[cell] !== b.id));
  for (const cell of route) returnGame.move(b, [cell % T.SIZE - b.x, Math.floor(cell / T.SIZE) - b.y]);
  assert.equal(b.trail.length, 0); assert.ok(b.captures > 0);
});

test('AI expands over 30 deterministic full matches; all state stays in bounds and consistent', () => {
  let totalCaptures = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const game = new T.Game(seeded(seed)); game.start();
    // Keep the idle player stopped at a wall so simulations can reach target/timeout.
    game.actors[0].x = 0; game.actors[0].direction = [-1, 0];
    while (game.phase === 'running') {
      game.step();
      assert.ok(game.tick <= T.ROUND_TICKS);
      assert.equal(game.counts().reduce((sum, n) => sum + n, 0), 900);
      for (const a of game.actors) {
        assert.ok(a.x >= 0 && a.y >= 0 && a.x < 30 && a.y < 30);
        assert.equal(new Set(a.trail).size, a.trail.length);
        assert.ok(a.trail.every(cell => game.trails[cell] === a.id));
        if (!a.alive) { assert.equal(game.board.includes(a.id), false); assert.equal(game.trails.includes(a.id), false); }
      }
      for (let cell = 0; cell < game.trails.length; cell++) if (game.trails[cell]) assert.ok(game.actors[game.trails[cell] - 1].trail.includes(cell));
    }
    assert.ok(game.actors[1].captures >= 2); assert.ok(game.actors[2].captures >= 2);
    totalCaptures += game.actors[1].captures + game.actors[2].captures;
  }
  assert.ok(totalCaptures > 120);
});

test('catalog links to the new game and the removed page is absent', () => {
  const root = path.join(__dirname, '..'), index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(index, /href="territory_loop.html"/); assert.doesNotMatch(index, /西瓜棋|watermelon_chess/);
  assert.equal(fs.existsSync(path.join(root, 'watermelon_chess.html')), false);
  for (const [, href] of index.matchAll(/href="([^"]+)"/g)) assert.ok(fs.existsSync(path.join(root, href)), href);
});
