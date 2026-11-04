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

test('shipped scripts parse, everything is local, and the page uses the full-screen Vermilion Ink shell', () => {
  assert.deepEqual(scripts.map(([, id]) => id), ['game-engine', 'territory-career', 'game-ui']);
  for (const [, attrs, source] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    const body = /type="module"/.test(attrs) ? '(async () => {' + source.replace(/^\s*import\b[^;]*;/gm, '') + '\n})' : source;
    assert.doesNotThrow(() => new vm.Script(body));
  }
  // Only the shared shell scripts load by src; three.js comes from the vendored module through shared/fu-three.js.
  for (const [, src] of html.matchAll(/<script[^>]+src="([^"]+)"/g)) assert.match(src, /^shared\/fu-(shell|palette)\.js$/);
  assert.match(html, /import \{[^}]*\} from '\.\/shared\/fu-three\.js'/);
  assert.doesNotMatch(html, /https?:\/\/|fetch\(|WebSocket|XMLHttpRequest|ROUND_TICKS|35%|2 分鐘/);
  assert.match(html, /<link rel="stylesheet" href="shared\/fu\.css">/); assert.match(html, /<body class="fu-app\b/);
  assert.doesNotMatch(html, /fulab-theme|play-panel|details class="card rules"|site-nav|page-header/);
  assert.match(html, /<a class="fu-brand" href="index\.html"[^>]*><span class="fu-seal"[^>]*>福遊<\/span>/);
  for (const id of ['board', 'overlay', 'drawer', 'standings-hud', 'status', 'panel-rules', 'panel-settings', 'panel-career', 'mode-chips', 'tier-chips']) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /持續陣營戰/); assert.match(html, /mode: 'endless', tier: 1, terrain: 'plain', swarm: false/);
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
  for (const [, href] of index.matchAll(/href="([^"]+)"/g)) {
    const [file, fragment] = href.split('#');
    if (!file) continue;
    const target = path.join(root, file);
    assert.ok(fs.existsSync(target), href);
    if (fragment && file.endsWith('.svg')) assert.ok(fs.readFileSync(target, 'utf8').includes('id="' + fragment + '"'), href);
  }
});

// ---------- Match modes, AI tiers, terrain, swarm, tallies and the agent observation ----------
const Career = vm.runInNewContext(scripts.find(([, id]) => id === 'territory-career')[2] + '; TerritoryCareer;');
const playing = (options, seed = 1) => { const g = new T.Game(seeded(seed), options); g.start(); g.tick = 40; for (const f of g.factions.slice(1)) f.shieldUntil = 0; for (const a of g.actors) a.protectedUntil = 0; return g; };
const plain = value => JSON.parse(JSON.stringify(value));

test('options default to the original endless veteran rules and normalize bad input', () => {
  const g = new T.Game(seeded(1));
  assert.deepEqual(plain(g.options), { mode: 'endless', tier: 1, terrain: 'plain', swarm: false });
  assert.deepEqual(plain(T.normalize({ mode: 'bogus', tier: 9, terrain: 'lava', swarm: 'yes' })), { mode: 'endless', tier: 1, terrain: 'plain', swarm: false });
  assert.deepEqual(plain(T.normalize({ mode: 'toString', tier: 1.5 })), { mode: 'endless', tier: 1, terrain: 'plain', swarm: false });
  assert.deepEqual(plain(T.normalize({ mode: 'beacons', tier: 3, terrain: 'highlands', swarm: true })), { mode: 'beacons', tier: 3, terrain: 'highlands', swarm: true });
  const v = T.TIERS[1];
  assert.deepEqual([v.skip, v.think, ...v.reach, v.threat, v.maxTrail, v.recruit, v.coreWeight, v.noise], [4, 3, 8, 3, 3, 32, true, 35, .18]);
  assert.equal(g.rocks.some(Boolean), false); assert.deepEqual(plain(g.beacons), []); assert.equal(g.remaining(), null);
  assert.deepEqual(plain(g.thresholds()), plain(T.HELPER_THRESHOLDS));
  // Explicit defaults produce exactly the same simulation as no options at all.
  const a = new T.Game(seeded(5)), b = new T.Game(seeded(5), { mode: 'endless', tier: 1, terrain: 'plain', swarm: false });
  a.start(); b.start(); for (let n = 0; n < 600; n++) { a.step(); b.step(); }
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  // reset(options) reconfigures the same object; reset() keeps the current options.
  a.reset({ mode: 'conquest', tier: 2 }); assert.equal(a.mode.id, 'conquest'); assert.equal(a.ai.id, 'elite'); a.reset(); assert.equal(a.mode.id, 'conquest');
});

test('timed conquest ends at the limit with the largest territory and freezes afterwards', () => {
  const g = playing({ mode: 'conquest' }); g.tick = T.MODES.conquest.limit - 1;
  for (let i = 0; i < 30; i++) g.board[at(i, 0)] = 3;
  assert.equal(g.remaining(), 1);
  g.score(); assert.equal(g.phase, 'running');
  g.tick++; g.score(); assert.equal(g.phase, 'over'); assert.equal(g.result.reason, 'time'); assert.equal(g.result.winner, 3);
  assert.equal(g.result.standings[0].id, 3); assert.ok(g.events.some(e => e.type === 'over'));
  const frozen = JSON.stringify(g); g.step(); g.start(); g.step(); assert.equal(JSON.stringify(g), frozen); assert.equal(g.phase, 'over');
  // An exact tie at the top is a draw.
  const tie = playing({ mode: 'conquest' }); tie.tick = T.MODES.conquest.limit; tie.score();
  assert.equal(tie.result.winner, 0); assert.equal(tie.result.standings[0].land, tie.result.standings[1].land);
});

test('domination needs 40% held without a break; losing the threshold resets the hold', () => {
  const m = T.MODES.domination, g = playing({ mode: 'domination' });
  assert.equal(m.target, 360); assert.equal(m.hold, 100);
  const give = n => { g.board.fill(0); for (const f of g.factions.slice(1)) g.board[f.core] = f.id; let k = 0; for (let c = 0; c < 900 && k < n; c++) if (!g.board[c]) { g.board[c] = 2; k++; } };
  give(m.target); for (let i = 0; i < m.hold - 1; i++) g.score();
  assert.equal(g.phase, 'running'); assert.equal(g.hold[2], m.hold - 1);
  give(m.target - 30); g.score(); assert.equal(g.hold[2], 0);
  give(m.target); for (let i = 0; i < m.hold; i++) g.score();
  assert.equal(g.phase, 'over'); assert.equal(g.result.reason, 'target'); assert.equal(g.result.winner, 2);
});

test('beacons score per step for their living owner and end the match at the target', () => {
  const g = playing({ mode: 'beacons' }); assert.deepEqual(plain(g.beacons), plain(T.BEACONS)); assert.equal(T.BEACONS.length, 5);
  for (const b of g.beacons) assert.equal(g.board[b], 0, 'beacons start neutral');
  g.board[T.BEACONS[0]] = 1; g.board[T.BEACONS[1]] = 1; g.board[T.BEACONS[2]] = 4;
  g.score(); assert.deepEqual(plain(g.scores.slice(1)), [2, 0, 0, 1]);
  g.factions[4].alive = false; g.score(); assert.deepEqual(plain(g.scores.slice(1)), [4, 0, 0, 1], 'a retreating faction earns nothing');
  g.scores[1] = T.MODES.beacons.target - 2; g.score(); assert.equal(g.phase, 'over'); assert.equal(g.result.winner, 1);
  assert.equal(g.result.standings[0].id, 1); assert.equal(g.result.standings[0].score, T.MODES.beacons.target);
  // The AI values a beacon: with one beside its base, most plans enclose it.
  const h = playing({ mode: 'beacons' }), ai = h.actors[1]; let near = 0;
  h.beacons = [at(23, 10)];
  for (let n = 0; n < 20; n++) { const plan = h.expansionPlan(ai); if (plan.some(c => Math.abs(c % 30 - 23) <= 2 && Math.abs(Math.floor(c / 30) - 10) <= 2)) near++; }
  assert.ok(near >= 10, `beacon plans ${near}/20`);
});

test('concede banks endless sessions and surrenders timed matches only while playing', () => {
  const g = new T.Game(seeded(3)); assert.equal(g.concede(), false); g.start(); for (let n = 0; n < 50; n++) g.step();
  assert.equal(g.concede(), true); assert.equal(g.phase, 'over'); assert.equal(g.result.reason, 'retreat'); assert.equal(g.result.winner, 0);
  assert.equal(g.result.standings.length, 4); assert.equal(g.concede(), false);
  const p = new T.Game(seeded(3), { mode: 'beacons' }); p.start(); p.step(); p.pause(); assert.equal(p.concede(), true); assert.equal(p.result.mode, 'beacons');
});

test('highlands raise rock ridges away from homes and beacons; rocks are walls that are never claimed', () => {
  for (let seed = 1; seed <= 8; seed++) {
    const g = new T.Game(seeded(seed), { terrain: 'highlands' }), rocks = [];
    g.rocks.forEach((r, c) => r && rocks.push(c)); assert.ok(rocks.length >= 12, `seed ${seed}: ${rocks.length} rocks`);
    for (const c of rocks) {
      assert.equal(g.board[c], 0);
      for (const [x, y] of T.SPAWNS) assert.ok(Math.abs(c % 30 - x) + Math.abs(Math.floor(c / 30) - y) >= 6);
      for (const b of T.BEACONS) assert.ok(Math.abs(c % 30 - b % 30) + Math.abs(Math.floor(c / 30) - Math.floor(b / 30)) >= 2);
    }
  }
  const g = playing({ terrain: 'highlands' }), a = g.actors[0]; g.rocks.fill(0);
  g.rocks[at(9, 14)] = 1; walk(g, 'right', 3); assert.deepEqual([a.x, a.y], [8, 14]); walk(g, 'right', 1);
  assert.deepEqual([a.x, a.y], [8, 14]); assert.equal(a.blocked, true); assert.equal(a.alive, true);
  // A loop around a rock captures everything inside except the rock itself.
  const loop = playing({ terrain: 'highlands' }); loop.rocks.fill(0); loop.rocks[at(8, 17)] = 1;
  walk(loop, 'right', 4); walk(loop, 'down', 4); walk(loop, 'left', 4); walk(loop, 'up', 2);
  assert.equal(loop.counts()[1], 40); assert.equal(loop.board[at(8, 17)], 0); consistent(loop);
  // Routes and spawn sites avoid rocks.
  const r = playing({ terrain: 'highlands' }), b = r.actors[1]; r.rocks.fill(0);
  for (let y = 0; y < 30; y++) if (y !== 20) r.rocks[at(19, y)] = 1;
  b.x = 21; b.y = 6; const route = r.route(b, cell => cell === at(17, 6));
  assert.ok(route.length > 4); assert.ok(route.every(c => !r.rocks[c])); assert.ok(route.includes(at(19, 20)));
  r.rocks.fill(1); r.eliminate(r.actors[2], 'test'); assert.equal(r.spawnSite(), -1);
});

test('highland, swarm and warlord simulations stay consistent and keep fighting', () => {
  for (const options of [{ terrain: 'highlands' }, { swarm: true }, { terrain: 'highlands', tier: 3 }]) {
    const g = new T.Game(seeded(11), options); g.start();
    for (let n = 0; n < 1500; n++) {
      g.step(); if (n % 25 === 0) consistent(g);
      for (let c = 0; c < 900; c++) if (g.rocks[c]) { assert.equal(g.board[c], 0); assert.equal(g.trails[c], 0); }
    }
    assert.equal(g.phase, 'running'); assert.ok(g.stats.captures > 60, JSON.stringify(options)); assert.ok(g.stats.cuts > 5);
    for (const a of g.actors) if (a.alive) assert.equal(g.rocks[at(a.x, a.y)], 0);
  }
});

test('swarm lowers the helper thresholds to 40 / 90 / 150 cells', () => {
  assert.deepEqual(plain(T.SWARM_THRESHOLDS), [40, 90, 150]);
  for (const [land, expected] of [[39, 0], [40, 1], [89, 1], [90, 2], [150, 3]]) {
    const g = playing({ swarm: true }); g.board.fill(0); g.board.fill(1, 0, land);
    for (let i = 0; i < 4; i++) { g.maintain(); g.tick += 40; }
    assert.equal(g.helpers(1).length, expected, `land ${land}`);
  }
});

test('AI tiers change only enemy behaviour: cadence, recruiting and reach', () => {
  assert.deepEqual(plain(T.TIERS.map(t => t.id)), ['recruit', 'veteran', 'elite', 'warlord']);
  for (let i = 1; i < 4; i++) { const [a, b] = [T.TIERS[i - 1], T.TIERS[i]]; assert.ok(b.skip > a.skip && b.think <= a.think && b.reach[0] > a.reach[0] && b.noise < a.noise); }
  const g = playing({ tier: 0 }), mine = helper(g, 1, 6, 14), theirs = helper(g, 2, 22, 7, 5);
  assert.equal(g.tierOf(mine).id, 'veteran'); assert.equal(g.tierOf(g.actors[0]).id, 'veteran'); assert.equal(g.tierOf(theirs).id, 'recruit');
  // Moves per 120 ticks: a recruit rests every 3rd tick, a veteran every 4th, a warlord only every 10th.
  const moves = tier => { const h = playing({ tier }), a = h.actors[1]; let n = 0; for (let t = 0; t < 120; t++) { h.tick++; if ((h.tick + a.id) % h.tierOf(a).skip !== 0) n++; } return n; };
  assert.equal(moves(0), 80); assert.equal(moves(1), 90); assert.equal(moves(3), 108);
  // A recruit never goes recruiting; a veteran at home does.
  for (const [tier, expected] of [[0, false], [1, true]]) {
    const h = playing({ tier }), a = h.actors[1]; helper(h, 3, 23, 8, 6);
    while ((h.tick + a.id) % h.tierOf(a).think) h.tick++;
    h.aiDirection(a); assert.equal(a.strategy === '招降', expected, `tier ${tier}`);
  }
  // Reach: an exposed line six cells away is chased from home by a veteran but not by a recruit.
  for (const [tier, chase] of [[0, false], [1, true]]) {
    const h = playing({ tier }), a = h.actors[1], p = h.actors[0]; p.trail = [at(23, 12)]; h.trails[at(23, 12)] = p.id;
    while ((h.tick + a.id) % h.tierOf(a).think) h.tick++;
    h.aiDirection(a); assert.equal(a.strategy === '斷線', chase, `tier ${tier}`);
  }
});

test('stronger tiers claim more land against the same idle opponent', () => {
  const claimed = tier => { let sum = 0; for (let seed = 1; seed <= 3; seed++) { const g = new T.Game(seeded(seed), { tier }); g.start(); for (let n = 0; n < 1200; n++) g.step(); sum += g.tally[2].claimed + g.tally[3].claimed + g.tally[4].claimed; } return sum; };
  const weak = claimed(0), strong = claimed(3); assert.ok(strong > weak * 1.1, `${weak} vs ${strong}`);
});

test('per-faction tallies credit captures, cuts, recruits, bases, falls and peak land', () => {
  const g = playing(); walk(g, 'right', 4); walk(g, 'down', 4); walk(g, 'left', 4); walk(g, 'up', 2);
  assert.equal(g.tally[1].captures, 1); assert.equal(g.tally[1].claimed, 16); g.score(); assert.equal(g.tally[1].peak, 41);
  const enemy = g.actors[1]; enemy.trail = [at(9, 12)]; g.trails[at(9, 12)] = enemy.id;
  const me = g.actors[0]; me.x = 8; me.y = 12; g.move(me, [1, 0]);
  assert.equal(g.tally[1].cuts, 1); assert.equal(g.tally[2].falls, 1);
  const h = helper(g, 3, 10, 12, 6); me.protectedUntil = 0; g.move(me, [1, 0]);
  assert.equal(h.faction, 1); assert.equal(g.tally[1].recruits, 1);
  // The capturing land must connect to its own base, as a real loop does.
  const core4 = g.factions[4].core; g.board[core4] = 1; g.board[core4 + 1] = 1; g.factions[1].core = core4 + 1;
  g.reconcile(); assert.equal(g.tally[1].bases, 1); assert.equal(g.tally[4].falls, 1);
  assert.ok(g.events.some(e => e.type === 'base' && e.faction === 1 && e.lost === 4));
  const s = g.standings(); assert.equal(s.length, 4); assert.ok(s.every((r, i) => !i || r.land <= s[i - 1].land));
});

test('observe() is a detached JSON view for agents', () => {
  const g = new T.Game(seeded(4), { mode: 'beacons', terrain: 'highlands' }); g.start(); for (let n = 0; n < 40; n++) g.step();
  const o = g.observe(); assert.equal(JSON.stringify(plain(o)), JSON.stringify(o));
  assert.equal(o.size, 30); assert.equal(o.board.length, 900); assert.equal(o.trails.length, 900); assert.equal(o.mode, 'beacons');
  assert.ok(o.rocks.length > 0 && o.rocks.every(c => g.rocks[c])); assert.equal(o.beacons.length, 5); assert.equal(o.remaining, T.MODES.beacons.limit - 40);
  for (const a of o.actors) { const live = g.actors[a.id - 1]; assert.equal(live.x, a.x); assert.equal(live.faction, a.faction); }
  for (let c = 0; c < 900; c++) if (g.trails[c]) assert.equal(o.trails[c], g.actors[g.trails[c] - 1].faction);
  o.board.fill(9); o.actors[0].x = -5; assert.notEqual(g.board[0], 9); assert.ok(g.actors[0].x >= 0);
});

test('career levels, ranks and unlock gates', () => {
  assert.equal(Career.need(1), 140); assert.deepEqual(plain(Career.levelOf(139)), { level: 1, into: 139, need: 140, max: false });
  assert.equal(Career.levelOf(140).level, 2); assert.equal(Career.levelOf(140 + 180).level, 3);
  assert.equal(Career.levelOf(-50).level, 1); assert.equal(Career.levelOf('junk').level, 1);
  const top = Career.levelOf(1e9); assert.equal(top.level, Career.MAX_LEVEL); assert.equal(top.max, true); assert.equal(top.need, 0);
  assert.equal(Career.rankOf(1), '拓荒者'); assert.equal(Career.rankOf(8), '領主'); assert.equal(Career.rankOf(30), '天下霸主');
  assert.ok(Career.unlocked(1, 'mode', 'endless') && Career.unlocked(1, 'mode', 'conquest') && Career.unlocked(1, 'tier', 1));
  assert.equal(Career.unlocked(1, 'mode', 'beacons'), false); assert.equal(Career.unlocked(2, 'mode', 'beacons'), true);
  assert.equal(Career.unlocked(6, 'tier', 3), false); assert.equal(Career.unlocked(7, 'tier', 3), true);
  assert.equal(Career.unlockLevel('terrain', 'highlands'), 3); assert.equal(Career.unlockLevel('swarm', true), 5); assert.equal(Career.unlockLevel('mode', 'domination'), 4);
  for (const m of Object.keys(T.MODES)) assert.ok(Career.UNLOCKS.some(u => u.kind === 'mode' && u.id === m), m);
  for (let t = 0; t < T.TIERS.length; t++) assert.ok(Career.UNLOCKS.some(u => u.kind === 'tier' && u.id === t), 'tier ' + t);
});

test('career XP: performance lines, placement, outcome and tier/terrain multipliers', () => {
  const base = { mode: 'conquest', tier: 1, terrain: 'plain', outcome: 'win', placement: 1, minutes: 3, captures: 10, cuts: 2, recruits: 1, bases: 1, peak: 270 };
  const win = Career.matchXP(base);
  assert.deepEqual(plain(win.lines), [['完成對局', 30], ['圈地 × 10', 30], ['斷線 × 2', 24], ['招降 × 1', 10], ['奪下基地 × 1', 40], ['巔峰領地 30%', 60], ['第 1 名', 50], ['奪得天下', 150]]);
  assert.equal(win.base, 394); assert.equal(win.total, 394);
  assert.equal(Career.matchXP({ ...base, tier: 3 }).total, Math.round(394 * 1.7));
  assert.equal(Career.matchXP({ ...base, tier: 0, terrain: 'highlands' }).total, Math.round(394 * .6 * 1.1));
  // Captures are capped at 40 so long sessions cannot farm one line.
  assert.equal(Career.matchXP({ ...base, captures: 400 }).lines.find(l => l[0].startsWith('圈地'))[1], 120);
  const loss = Career.matchXP({ ...base, outcome: 'loss', placement: 3 });
  assert.ok(!loss.lines.some(l => l[0] === '奪得天下')); assert.deepEqual(plain(loss.lines.find(l => l[0] === '第 3 名')), ['第 3 名', 10]);
  // Surrendering a timed match earns no completion or placement; banking an endless session earns time and placement.
  const gaveUp = Career.matchXP({ ...base, outcome: 'retreat' });
  assert.ok(!gaveUp.lines.some(l => l[0] === '完成對局' || l[0].startsWith('第 ')));
  const banked = Career.matchXP({ ...base, mode: 'endless', outcome: 'retreat', minutes: 5 });
  assert.deepEqual(plain(banked.lines[0]), ['堅守時間', 40]); assert.ok(banked.lines.some(l => l[0] === '第 1 名'));
  assert.equal(Career.matchXP({ ...base, mode: 'endless', outcome: 'retreat', minutes: 60 }).lines[0][1], 120, 'time is capped at 15 minutes');
  assert.equal(Career.matchXP({ ...base, outcome: 'draw' }).lines.at(-1)[0], '並列第一');
  assert.equal(Career.matchXP({ mode: 'conquest', tier: 1, outcome: 'retreat' }).total, 0);
});

test('career record, sanitize and storage round-trip', () => {
  const s = { mode: 'beacons', tier: 2, terrain: 'plain', outcome: 'win', placement: 1, minutes: 4.6, captures: 12, cuts: 5, recruits: 3, bases: 2, peak: 400 };
  const r = Career.record(Career.blank(), s);
  assert.equal(r.profile.matches, 1); assert.equal(r.profile.wins, 1); assert.equal(r.profile.cuts, 5); assert.equal(r.profile.bases, 2);
  assert.equal(r.profile.bestPeak, 400); assert.equal(r.profile.bestTier, 2); assert.equal(r.profile.minutes, 4); assert.equal(r.profile.xp, r.gain.total);
  assert.equal(r.before.level, 1); assert.ok(r.after.level > 1); assert.ok(r.unlocked.length > 0 && r.unlocked.every(u => u.level > 1 && u.level <= r.after.level));
  const lost = Career.record(r.profile, { ...s, outcome: 'loss', tier: 3, peak: 10 });
  assert.equal(lost.profile.wins, 1); assert.equal(lost.profile.bestTier, 2); assert.equal(lost.profile.bestPeak, 400); assert.equal(lost.profile.matches, 2);
  assert.deepEqual(plain(Career.sanitize({ xp: -4, wins: 'x', bestTier: -1, matches: 3.7, extra: 1 })), { ...plain(Career.blank()), matches: 3 });
  assert.deepEqual(plain(Career.sanitize(null)), plain(Career.blank()));
  const mem = {}; const storage = { getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } };
  assert.equal(Career.save(storage, lost.profile), true); assert.deepEqual(plain(Career.load(storage)), plain(lost.profile));
  mem[Career.KEY] = '{broken'; assert.deepEqual(plain(Career.load(storage)), plain(Career.blank()));
  assert.equal(Career.save({ setItem() { throw new Error('quota'); } }, lost.profile), false);
});
