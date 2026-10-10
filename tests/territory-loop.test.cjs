'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const html = fs.readFileSync(path.join(__dirname, '../territory_loop.html'), 'utf8');
const scripts = [...html.matchAll(/<script id="([^"]+)">([\s\S]*?)<\/script>/g)];
const T = vm.runInNewContext(scripts.find(([, id]) => id === 'game-engine')[2] + '; Territory;');
const at = T.index;
const seeded = seed => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
function running(seed = 1) { const g = new T.Game(seeded(seed)); g.start(); g.tick = 40; for (const f of g.factions.slice(1)) f.shieldUntil = 0; for (const a of g.actors) a.protectedUntil = 0; return g; }
function walk(g, dir, n, a = g.actors[0]) { for (let i = 0; i < n; i++) g.move(a, T.DIRECTIONS[dir]); }
function helper(g, faction, x, y, slot = 4) { const a = g.actors[slot]; g.activate(a, faction, at(x, y), 'helper'); a.protectedUntil = 0; return a; }
function consistent(g) {
  assert.equal(g.actors.length, T.FACTIONS + T.MAX_HELPERS);
  assert.equal(g.counts().reduce((sum, n) => sum + n, 0), 900);
  for (const a of g.actors) {
    if (a.alive) { assert.ok(a.x >= 0 && a.y >= 0 && a.x < 30 && a.y < 30); assert.ok(g.factions[a.faction].alive); }
    assert.equal(new Set(a.trail).size, a.trail.length);
    if (!a.alive) assert.equal(a.trail.length, 0);
    for (const cell of a.trail) assert.equal(g.trails[cell], a.id);
  }
  for (let cell = 0; cell < 900; cell++) {
    if (g.trails[cell]) { const a = g.actors[g.trails[cell] - 1]; assert.ok(a.alive); assert.ok(a.trail.includes(cell)); }
    if (g.board[cell]) assert.ok(g.factions[g.board[cell]].alive);
  }
}

test('shipped scripts parse, local-only dependencies and endless UI', () => {
  assert.equal(scripts.length, 2); for (const [, , source] of scripts) new vm.Script(source);
  assert.doesNotMatch(html, /<script[^>]+src=|https?:\/\/|fetch\(|WebSocket|ROUND_TICKS|35%|2 分鐘/);
  assert.match(html, /id="helpers"/); assert.match(html, /持續陣營戰/);
});

test('ready/pause freeze everything; reset restores four factions and bounded empty helper slots', () => {
  const g = new T.Game(seeded(2)); g.step(); assert.equal(g.tick, 0);
  assert.deepEqual(Array.from(g.counts()), [800, 25, 25, 25, 25]);
  g.start(); g.step(); g.pause(); const snapshot = JSON.stringify(g); g.step(); assert.equal(JSON.stringify(g), snapshot);
  assert.equal(g.steer('up'), false); g.start(); g.step(); assert.equal(g.tick, 2);
  g.reset(); assert.equal(g.phase, 'ready'); assert.equal(g.tick, 0); assert.equal(g.trails.some(Boolean), false);
  assert.equal(g.actors.filter(a => a.alive).length, 4); assert.equal(g.stats.conversions, 0);
});

test('closed loop captures its interior and enemy land, leaving open exterior alone', () => {
  const g = running(); g.board[at(8, 17)] = 2;
  walk(g, 'right', 4); walk(g, 'down', 4); walk(g, 'left', 4); assert.equal(g.counts()[1], 25);
  walk(g, 'up', 2); assert.equal(g.counts()[1], 41); assert.equal(g.board[at(8, 17)], 1);
  assert.equal(g.board[at(10, 16)], 0); assert.equal(g.actors[0].trail.length, 0); consistent(g);
});

test('map edges are not closing walls; flood fill visits all four boundaries', () => {
  const g = running(), a = g.actors[0]; g.board.fill(0);
  for (let y = 0; y < 30; y++) g.board[at(15, y)] = 1;
  g.factions[1].core = at(15, 0); g.board[at(15, 14)] = 0;
  a.trail = [at(15, 14)]; g.trails[at(15, 14)] = a.id; g.capture(a);
  assert.equal(g.counts()[1], 30); assert.equal(g.board[at(0, 14)], 0); assert.equal(g.board[at(29, 14)], 0);
});

test('a capture through a narrow enemy bridge neutralizes only disconnected land', () => {
  const g = running(), a = g.actors[0]; g.board.fill(0);
  g.factions[1].core = at(13, 11); g.factions[2].core = at(24, 14);
  for (let y = 10; y <= 12; y++) for (let x = 12; x <= 16; x++) g.board[at(x, y)] = 1;
  for (let x = 5; x <= 24; x++) g.board[at(x, 14)] = 2;
  for (let y = 13; y <= 15; y++) for (const x of [4, 5, 6, 23, 24, 25]) g.board[at(x, y)] = 2;
  a.x = 13; a.y = 11; a.anchor = at(13, 11);
  walk(g, 'down', 5); walk(g, 'right', 2); walk(g, 'up', 4);
  assert.equal(g.board[at(5, 14)], 0); assert.equal(g.board[at(24, 14)], 2);
  assert.equal(g.board[at(14, 14)], 1); assert.ok(g.events.some(e => e.type === 'sever' && e.faction === 2));
  assert.equal(g.actors[1].alive, true); consistent(g);
});

test('losing a core retires only that faction; all its trails and helpers are removed', () => {
  const g = running(), h = helper(g, 2, 20, 6); walk(g, 'left', 1, h);
  g.board[g.factions[2].core] = 1; g.reconcile();
  assert.equal(g.factions[2].alive, false); assert.equal(h.alive, false);
  assert.equal(g.board.includes(2), false); assert.equal(g.actors[0].alive, true); assert.equal(g.phase, 'running'); consistent(g);
});

test('self collision clears a player faction and automatically respawns without ending play', () => {
  const g = running(); walk(g, 'right', 4); walk(g, 'down', 2); walk(g, 'left', 1); walk(g, 'up', 2);
  assert.equal(g.actors[0].alive, false); assert.equal(g.phase, 'running'); assert.equal(g.board.includes(1), false);
  assert.match(g.events.find(e => e.type === 'eliminated').reason, /自己/);
  const due = g.factions[1].respawnAt; g.tick = due; g.maintain();
  assert.equal(g.actors[0].alive, true); assert.equal(g.factions[1].generation, 2); assert.equal(g.counts()[1], 25); consistent(g);
});

test('cutting a helper only kills that actor; cutting a leader removes its faction', () => {
  const g = running(), h = helper(g, 2, 8, 14);
  h.trail = [at(8, 14)]; g.trails[at(8, 14)] = h.id; h.x = 9;
  walk(g, 'right', 3); assert.equal(h.alive, false); assert.equal(g.actors[1].alive, true); assert.equal(g.counts()[2], 25);
  const enemy = g.actors[1]; enemy.trail = [at(9, 14)]; g.trails[at(9, 14)] = enemy.id;
  walk(g, 'right', 1); assert.equal(enemy.alive, false); assert.equal(g.board.includes(2), false); consistent(g);
});

test('an enemy trail enclosed in a capture is cut with no orphan state', () => {
  const g = running(), enemy = g.actors[1]; enemy.trail = [at(8, 17)]; g.trails[at(8, 17)] = enemy.id;
  walk(g, 'right', 4); walk(g, 'down', 4); walk(g, 'left', 4); walk(g, 'up', 2);
  assert.equal(enemy.alive, false); assert.equal(g.board[at(8, 17)], 1); consistent(g);
});

test('four walls stop without wrapping; allied trails block without killing or overwriting', () => {
  for (const [x, y, outward, turn] of [[0, 5, 'left', 'up'], [29, 5, 'right', 'up'], [5, 0, 'up', 'right'], [5, 29, 'down', 'right']]) {
    const g = running(), a = g.actors[0]; a.x = x; a.y = y; g.move(a, T.DIRECTIONS[outward]);
    assert.deepEqual([a.x, a.y], [x, y]); assert.equal(a.blocked, true); assert.equal(a.alive, true);
    g.move(a, T.DIRECTIONS[turn]); assert.equal(a.blocked, false);
  }
  const g = running(), h = helper(g, 1, 8, 14); h.trail = [at(8, 14)]; g.trails[at(8, 14)] = h.id;
  walk(g, 'right', 3); assert.equal(g.actors[0].x, 7); assert.equal(h.alive, true); consistent(g);
});

test('queued keys cannot reverse the last executed move', () => {
  const g = running(); assert.equal(g.steer('left'), false); assert.equal(g.steer('up'), true); assert.equal(g.steer('left'), false);
  g.step(); assert.deepEqual([g.actors[0].x, g.actors[0].y], [5, 13]); assert.equal(g.steer('left'), true); assert.equal(g.steer('bogus'), false);
});

test('land thresholds unlock helpers gradually, shared land is used, loss does not delete survivors', () => {
  const g = running(); g.board.fill(0);
  for (let i = 0; i < 200; i++) g.board[i] = 1;
  g.factions[1].core = 31; g.maintain(); assert.equal(g.helpers(1).length, 1);
  g.maintain(); assert.equal(g.helpers(1).length, 1);
  g.tick += 36; g.maintain(); assert.equal(g.helpers(1).length, 2);
  g.tick += 36; g.maintain(); assert.equal(g.helpers(1).length, 3);
  g.tick += 36; g.maintain(); assert.equal(g.helpers(1).length, 3);
  g.board.fill(0); g.board[31] = 1; g.maintain(); assert.equal(g.helpers(1).length, 3);
  const h = g.helpers(1)[0]; g.eliminate(h, 'test'); g.tick += 40; g.maintain(); assert.equal(g.helpers(1).length, 2);
});

test('exact helper thresholds and global capacity apply to all four factions, including recruitment', () => {
  for (const [land, expected] of [[59,0],[60,1],[119,1],[120,2],[199,2],[200,3]]) {
    const g = running(); g.board.fill(0); g.board.fill(1, 0, land);
    for (let i=0;i<4;i++) { g.maintain(); g.tick += 40; }
    assert.equal(g.helpers(1).length, expected, `land ${land}`);
  }
  const g = running();
  for (let y=0;y<30;y++) for(let x=0;x<30;x++) g.board[at(x,y)] = 1 + (x>=15?1:0) + (y>=15?2:0);
  [[7,7],[22,7],[7,22],[22,22]].forEach(([x,y],i) => {
    g.factions[i+1].core = at(x,y); g.activate(g.actors[i],i+1,at(x,y),'leader');
  });
  for (let i=0;i<3;i++) { g.maintain(); g.tick += 40; }
  assert.equal(g.actors.filter(a=>a.alive).length,16);
  const recruit = g.helpers(2)[0]; recruit.protectedUntil = 0; g.convert(recruit,1); g.maintain();
  assert.equal(g.helpers(1).length,4); assert.equal(g.helpers(2).length,2); assert.equal(g.actors.filter(a=>a.alive).length,16);
  for(let n=0;n<300;n++) { g.step(); consistent(g); }
});

test('helpers close loops for their faction and a recruit survives its former leader defeat', () => {
  const g = running(), h = helper(g,1,5,14);
  walk(g,'right',4,h); walk(g,'down',4,h); walk(g,'left',4,h); walk(g,'up',2,h);
  assert.equal(g.counts()[1],41); assert.equal(h.captures,1); assert.equal(g.actors[0].captures,0);
  assert.equal(g.board.includes(h.id),false); consistent(g);
  g.convert(h,2); g.eliminate(g.actors[0],'test');
  assert.equal(h.alive,true); assert.equal(h.faction,2); assert.equal(g.factions[2].alive,true); consistent(g);
});

test('contact converts helpers in both directions, clears old trails and enforces immunity', () => {
  for (const [moverFaction, helperFaction] of [[1, 2], [2, 1]]) {
    const g = running(), leader = g.actors[moverFaction - 1], h = helper(g, helperFaction, 10, 10);
    h.trail = [at(10, 10), at(11, 10)]; g.trails[at(10, 10)] = h.id; g.trails[at(11, 10)] = h.id;
    leader.x = 9; leader.y = 10; g.move(leader, [1, 0]);
    assert.equal(h.faction, moverFaction); assert.equal(h.trail.length, 0); assert.equal(g.trails[at(11, 10)], 0);
    assert.equal(g.convert(h, helperFaction), false);
    const other = g.actors[helperFaction - 1]; other.x = h.x; other.y = h.y; g.contact(other); assert.equal(h.faction, moverFaction);
    // Protected helpers cannot recruit a different helper, either.
    const b = helper(g, helperFaction, h.x, h.y, 5); g.contact(h); assert.equal(b.faction, helperFaction);
    g.tick += T.CONVERT_TICKS; g.contact(other); assert.equal(h.faction, helperFaction); consistent(g);
  }
});

test('helper touching an enemy leader converts before collisions without overwriting new allied trail', () => {
  const g = running(), leader = g.actors[1], h = helper(g, 1, 18, 6);
  leader.x = 19; leader.y = 6; leader.trail = [at(19, 6)]; g.trails[at(19, 6)] = leader.id;
  g.move(h, [1, 0]); assert.equal(h.faction, 2); assert.equal(h.x, 18);
  assert.equal(g.trails[at(19, 6)], leader.id); assert.equal(leader.alive, true); consistent(g);
});

test('helper-to-helper contact recruits the touched actor, not the moving actor', () => {
  const g = running(), a = helper(g, 1, 10, 10), b = helper(g, 2, 11, 10, 5);
  g.move(a, [1, 0]); assert.equal(a.faction, 1); assert.equal(b.faction, 1); assert.equal(g.stats.conversions, 1); consistent(g);
});

test('AI pursues exposed lines from several cells away and returns around its own trail', () => {
  const g = running(), a = g.actors[1], player = g.actors[0];
  player.trail = [at(18, 6)]; g.trails[at(18, 6)] = player.id;
  for (let i = 0; i < 5; i++) { g.tick++; const d = g.aiDirection(a); assert.ok(d); g.move(a, d); }
  assert.equal(player.alive, false); assert.equal(g.phase, 'running'); assert.ok(g.stats.cuts > 0);
  const other = running(), b = other.actors[1]; walk(other, 'left', 4, b); const route = other.pathHome(b);
  assert.ok(route.length); assert.ok(route.every(cell => other.trails[cell] !== b.id));
  for (const cell of route) other.move(b, [cell % 30 - b.x, Math.floor(cell / 30) - b.y]);
  assert.equal(b.trail.length, 0); assert.ok(b.captures > 0);
});

test('AI chooses invasion near an enemy frontier and targets a narrow supply neck', () => {
  const g = running(), a = g.actors[1];
  // Enemy strip directly below the AI base creates a valuable one-cell supply connection.
  for (let x = 15; x <= 28; x++) g.board[at(x, 9)] = 1;
  const route = g.expansionPlan(a); assert.ok(route.length); assert.ok(['侵入', '截地'].includes(a.strategy));
  assert.ok(route.some(cell => cell >= at(0, 9)));
});

test('enemy elimination continuously replenishes; full maps reclaim a safe fringe and preserve protected bases', () => {
  const g = running(); g.eliminate(g.actors[1], 'test'); g.board.fill(1);
  // A crowded map still has a safe fringe away from heads, paths and other bases.
  const site = g.spawnSite(); assert.ok(site >= 0);
  const x = site % 30, y = Math.floor(site / 30);
  assert.ok(g.actors.filter(a => a.alive).every(a => Math.max(Math.abs(a.x - x), Math.abs(a.y - y)) >= 5));
  g.tick = g.factions[2].respawnAt; g.maintain(); assert.equal(g.factions[2].alive, true); assert.equal(g.counts()[2], 25);
  const protectedCore = g.factions[2].core, player = g.actors[0]; player.trail = [protectedCore]; g.trails[protectedCore] = player.id;
  g.capture(player); assert.equal(g.board[protectedCore], 2); assert.equal(g.factions[2].alive, true);
});

test('unsafe spawn is deferred; an encircled AI relinquishes its path instead of stalling forever', () => {
  const g = running(); g.eliminate(g.actors[1], 'test'); g.trails.fill(1); g.tick = g.factions[2].respawnAt;
  g.maintain(); assert.equal(g.factions[2].alive, false); assert.equal(g.factions[2].respawnAt, g.tick + 8);
  const other = running(), a = other.actors[1]; a.x = 15; a.y = 15;
  a.trail = [at(15, 14), at(16, 15), at(15, 16), at(14, 15)]; for (const cell of a.trail) other.trails[cell] = a.id;
  for (let n = 0; n < 8; n++) other.aiDirection(a);
  assert.equal(a.alive, false); assert.equal(other.phase, 'running');
});

test('there is no percentage, countdown or last-survivor ending', () => {
  const g = running(); for (const a of g.actors.slice(1, 4)) g.eliminate(a, 'test');
  g.board.fill(1); g.tick = 100000; g.actors[0].x = 29; g.actors[0].direction = [1, 0];
  for (let n = 0; n < 80; n++) g.step(); assert.equal(g.phase, 'running'); assert.equal(g.tick, 100080);
  assert.ok(g.factions.slice(2).some(f => f.generation > 1));
});

test('six 20-minute simulations keep expanding, fighting, converting and respawning with bounded state', () => {
  const totals = { captures: 0, cuts: 0, conversions: 0, severed: 0, spawns: 0, helpers: 0 }, strategies = new Set();
  let maxActors = 0, worstMs = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const g = new T.Game(seeded(seed)); g.start(); const start = performance.now();
    let previousCaptures = 0;
    for (let n = 0; n < 8000; n++) {
      g.step(); if (n % 20 === 0) consistent(g);
      maxActors = Math.max(maxActors, g.actors.filter(a => a.alive).length);
      for (const a of g.actors) if (a.alive) strategies.add(a.strategy);
      if ((n + 1) % 2000 === 0) { assert.ok(g.stats.captures > previousCaptures + 10, `seed ${seed} stalled`); previousCaptures = g.stats.captures; }
    }
    worstMs = Math.max(worstMs, performance.now() - start);
    assert.equal(g.phase, 'running'); consistent(g);
    assert.ok(g.factions.slice(1).every(f => f.generation > 3));
    assert.ok(g.stats.conversions > 5); assert.ok(g.stats.cuts > 40); assert.ok(g.stats.severed > 0);
    for (const key of Object.keys(totals)) totals[key] += g.stats[key];
  }
  assert.ok(maxActors <= 16); for (const name of ['擴張', '侵入', '斷線', '回防', '招降', '截地']) assert.ok(strategies.has(name), name);
  console.log(`Long-run evidence: ${JSON.stringify({ simulatedMinutes: 120, totals, maxActors, worstAverageStepMs: +(worstMs / 8000).toFixed(3) })}`);
});

test('catalog links are valid and the removed game remains absent', () => {
  const root = path.join(__dirname, '..'), index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(index, /href="territory_loop.html"/); assert.doesNotMatch(index, /西瓜棋|watermelon_chess/);
  assert.equal(fs.existsSync(path.join(root, 'watermelon_chess.html')), false);
  for (const [, href] of index.matchAll(/href="([^"]+)"/g)) assert.ok(fs.existsSync(path.join(root, href)), href);
});
