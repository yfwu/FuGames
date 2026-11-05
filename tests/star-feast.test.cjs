'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'star_feast.html'), 'utf8');
const T = vm.runInNewContext(html.match(/<script id="growth-engine">([\s\S]*?)<\/script>/)[1] + '; StarFeast;');
const seeded = seed => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
function fixture() {
  const g = new T.Game(seeded(1)); g.start(); g.food = [];
  g.aiDirection = () => ({ x: 0, y: 0 });
  return g;
}

test('all pages parse and share the shell; no missing catalogue links or remote game dependency', () => {
  for (const name of fs.readdirSync(root).filter(name => name.endsWith('.html'))) {
    const source = fs.readFileSync(path.join(root, name), 'utf8');
    // Shared shell: the legacy FuLab theme, or the Vermilion Ink design system (shared/README.md).
    const vermilion = /href="shared\/fu\.css"/.test(source);
    if (!vermilion) {
      assert.match(source, /href="fulab-theme.css"/);
      assert.match(source, /class="[^"]*\bsite-nav\b[^"]*"/); assert.match(source, /class="[^"]*\bpage-header\b[^"]*"/);
    } else assert.match(source, /class="[^"]*\bfu-app\b[^"]*"/);
    if (!vermilion && !['index.html','archive.html'].includes(name)) { assert.match(source, /class="card play-panel(?: [^"]*)?"/); assert.match(source, /<details class="card rules(?: [^"]*)?">/); }
    for (const [, attrs, script] of source.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
      // Inline ES modules (three.js pages): drop static imports and syntax-check the body as an async function.
      if (/type="(?:application\/json|importmap)"/.test(attrs)) { assert.doesNotThrow(() => JSON.parse(script), name); continue; }
      const body = /type="module"/.test(attrs) ? '(async () => {' + script.replace(/^\s*import\b[^;]*;/gm, '') + '\n})' : script;
      assert.doesNotThrow(() => new vm.Script(body), name);
    }
    for (const [, tag, href] of source.matchAll(/<([a-z]+)\b[^>]*\bhref="([^"]+)"/g)) {
      // A credit is an optional navigation link, not a fetched game asset.
      if (/^https:\/\//.test(href)) { assert.equal(tag, 'a', name + ' -> remote asset ' + href); continue; }
      const [path_, fragment] = href.split('#'), file = path_.split('?')[0]; // a query string (hexbattle.html?mode=stream) still names a local file
      if (!file) continue;
      const target = path.join(root, file);
      assert.ok(fs.existsSync(target), name + ' -> ' + href);
      // Dynamic template fragments are resolved and checked by the real browser suites.
      if (fragment && !fragment.includes('${') && file.endsWith('.svg')) {
        assert.ok(fs.readFileSync(target, 'utf8').includes('id="' + fragment + '"'), name + ' -> missing SVG symbol ' + href);
      }
    }
    for (const [, src] of source.matchAll(/\bsrc="([^"]+)"/g)) {
      assert.doesNotMatch(src, /^(?:[a-z]+:)?\/\//i, name + ' -> remote dependency ' + src);
      assert.ok(fs.existsSync(path.join(root, src)), name + ' -> missing dependency ' + src);
    }
  }
  // The SVG namespace identifies a DOM type; it makes no request. Remote resources remain forbidden.
  assert.doesNotMatch(html.replaceAll("document.createElementNS('http://www.w3.org/2000/svg',", "document.createElementNS('SVG_NAMESPACE',"), /<script[^>]+src=|https?:\/\/|fetch\(|WebSocket/);
});

test('ready, paused and finished games freeze; reset clears every round resource', () => {
  const g = new T.Game(seeded(9)); g.step({ x: 1, y: 0 }); assert.equal(g.tick, 0);
  g.start(); g.boost(); g.step({ x: 1, y: 0 }); g.pause();
  const snapshot = JSON.stringify(g); g.step({ x: 1, y: 0 }); assert.equal(JSON.stringify(g), snapshot);
  assert.equal(g.boost(), false);
  g.start(); g.step(); assert.equal(g.tick, 2);
  g.finish('win', 'test'); const end = JSON.stringify(g); g.step(); assert.equal(JSON.stringify(g), end);
  g.reset(); assert.equal(g.phase, 'ready'); assert.equal(g.tick, 0); assert.equal(g.cooldown, 0); assert.equal(g.boostTime, 0);
  assert.equal(g.collected, 0); assert.equal(g.eaten, 0); assert.equal(g.result, null); assert.equal(g.food.length, 96);
  assert.deepEqual(Array.from(g.actors, a => a.mass), [20, 14, 18, 26, 34]);
});

test('keyboard diagonals are normalized; joystick magnitude supports slower movement', () => {
  const straight = fixture(), diagonal = fixture(), slow = fixture();
  const start = { ...straight.actors[0] };
  straight.step({ x: 1, y: 0 }); diagonal.step({ x: 1, y: 1 }); slow.step({ x: .5, y: 0 });
  assert.ok(Math.abs(T.distance(start, straight.actors[0]) - T.distance(start, diagonal.actors[0])) < 1e-9);
  assert.ok(Math.abs(T.distance(start, slow.actors[0]) * 2 - T.distance(start, straight.actors[0])) < 1e-9);
});

test('food is consumed once, adds its mass, grows the circle, and replenishes gradually', () => {
  const g = fixture(), a = g.actors[0], before = T.radius(a.mass);
  g.food = [{ x: a.x, y: a.y, value: 2 }, { x: a.x, y: a.y, value: 5 }];
  g.step(); assert.equal(a.mass, 27); assert.equal(g.collected, 2); assert.equal(g.food.length, 0);
  assert.ok(T.radius(a.mass) > before);
  g.step(); assert.equal(a.mass, 27);
  g.tick = 24; g.step(); assert.equal(g.food.length, 1);
});

test('at least 20% more mass AND enclosing the centre are required to eat', () => {
  for (const [mass, x, shouldEat] of [[23, 180, false], [24, 250, false], [24, 180, true]]) {
    const g = fixture(), a = g.actors[0], b = g.actors[1]; a.mass = mass; b.mass = 20; b.x = x; b.y = a.y;
    g.step(); assert.equal(b.alive, !shouldEat);
    assert.equal(a.mass, mass + (shouldEat ? 16 : 0));
    assert.equal(g.eaten, shouldEat ? 1 : 0);
    if (shouldEat) { g.step(); assert.equal(a.mass, 40); }
  }
});

test('larger AI swallowing the player ends the game with a preserved final mass', () => {
  const g = fixture(), a = g.actors[0], b = g.actors[1]; b.mass = 30; b.x = a.x; b.y = a.y;
  g.step(); assert.equal(a.alive, false); assert.equal(g.phase, 'over'); assert.equal(g.result.outcome, 'loss');
  assert.equal(g.result.mass, 20); assert.match(g.result.reason, /吞噬/);
});

test('boost has duration and cooldown, does not cost mass, and cannot stack', () => {
  const boosted = fixture(), normal = fixture();
  assert.equal(boosted.boost(), true); assert.equal(boosted.boost(), false);
  boosted.step({ x: 1, y: 0 }); normal.step({ x: 1, y: 0 });
  assert.ok(boosted.actors[0].x > normal.actors[0].x); assert.equal(boosted.actors[0].mass, 20);
  for (let n = 0; n < 30; n++) boosted.step(); assert.equal(boosted.boostTime, 0);
  assert.equal(boosted.boost(), false);
  for (let n = 0; n < 180; n++) boosted.step(); assert.equal(boosted.cooldown, 0); assert.equal(boosted.boost(), true);
});

test('all walls stop the entire circle; movement and growth never wrap or leave bounds', () => {
  for (const [x, y, dx, dy] of [[0, 300, -1, 0], [720, 300, 1, 0], [300, 0, 0, -1], [300, 720, 0, 1]]) {
    const g = fixture(), a = g.actors[0]; a.x = x; a.y = y; g.step({ x: dx, y: dy });
    let r = T.radius(a.mass); assert.ok(a.x >= r && a.y >= r && a.x <= 720 - r && a.y <= 720 - r);
    g.food = [{ x: a.x, y: a.y, value: 5 }]; g.step(); r = T.radius(a.mass);
    assert.ok(a.x >= r && a.y >= r && a.x <= 720 - r && a.y <= 720 - r); assert.equal(a.alive, true);
  }
});

test('AI selects food, hunts smaller opponents, and prioritizes fleeing a nearby predator', () => {
  const g = new T.Game(seeded(1)), a = g.actors[1];
  g.actors.forEach(b => { b.alive = b === a; }); a.x = a.y = 300; a.mass = 20;
  g.food = [{ x: 350, y: 300, value: 2 }]; assert.ok(g.aiDirection(a).x > .9);
  const b = g.actors[0]; b.alive = true; b.x = 250; b.y = 300; b.mass = 10;
  assert.ok(g.aiDirection(a).x < -.9);
  b.mass = 40; assert.ok(g.aiDirection(a).x > .9);
});

test('target mass, survival and timeout outcomes are explicit', () => {
  for (const id of [0, 1]) {
    const g = fixture(); g.actors[id].mass = 160; g.checkResult(); assert.equal(g.result.outcome, id === 0 ? 'win' : 'loss');
  }
  for (const [mass, outcome] of [[34, 'draw'], [35, 'win'], [20, 'loss']]) {
    const g = fixture(); g.actors[0].mass = mass; g.tick = T.ROUND_TICKS; g.checkResult(); assert.equal(g.result.outcome, outcome);
  }
  const g = fixture(); g.actors.slice(1).forEach(a => a.alive = false); g.checkResult(); assert.equal(g.result.outcome, 'win');
});

test('30 complete seeded matches keep positions, mass, food and timers consistent', () => {
  let wins = 0, losses = 0, aiGrowth = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const g = new T.Game(seeded(seed)); g.start();
    while (g.phase === 'running') {
      g.step(g.aiDirection(g.actors[0]));
      assert.ok(g.tick <= T.ROUND_TICKS); assert.ok(g.food.length <= 96); assert.ok(g.cooldown >= 0 && g.boostTime >= 0);
      for (const a of g.actors) {
        assert.ok(Number.isInteger(a.mass) && a.mass > 0);
        if (a.alive) { const r = T.radius(a.mass); assert.ok(a.x >= r && a.y >= r && a.x <= 720 - r && a.y <= 720 - r); }
      }
    }
    aiGrowth += g.actors.slice(1).filter(a => a.mass > 34).length;
    wins += g.result.outcome === 'win'; losses += g.result.outcome === 'loss';
  }
  assert.ok(aiGrowth > 30); assert.ok(wins > 0); assert.ok(losses > 0);
});

// ---------- Full-screen rebuild: modes, abilities, hazards, AI tiers and career ----------
const Career = vm.runInNewContext(html.match(/<script id="growth-career">([\s\S]*?)<\/script>/)[1] + '; StarCareer;');
// A quiet arena: no food, AI frozen, actors parked far apart so a test only sees what it sets up.
function arena(options = {}) {
  const g = new T.Game(seeded(3), { mode: 'standard', thorns: 0, ...options }); g.start(); g.food = [];
  g.aiDirection = () => ({ x: 0, y: 0 }); g.aiAct = () => {}; g.addFood = () => {};
  g.actors.forEach((a, i) => { a.x = 120 + i * 200; a.y = 900; });
  return g;
}

test('star feast is a full-screen Vermilion Ink page with a local three.js stage', () => {
  assert.match(html, /<link rel="stylesheet" href="shared\/fu\.css">/); assert.match(html, /<body class="fu-app[^"]*">/);
  assert.match(html, /class="fu-stage"><canvas id="board"/); assert.match(html, /class="fu-drawer" id="drawer"/); assert.match(html, /class="fu-curtain" id="overlay"/);
  assert.match(html, /class="fu-seal"[^>]*>福遊</); assert.match(html, /class="fu-brand" href="index\.html"/);
  assert.doesNotMatch(html, /fulab-theme\.css|play-panel|<details class="card rules|site-nav|page-header/);
  assert.match(html, /"three":"\.\/vendor\/three\/three\.module\.min\.js"/); assert.match(html, /<script type="module" id="growth-view">/);
  assert.ok(fs.existsSync(path.join(root, 'vendor', 'three', 'three.module.min.js')));
  assert.equal((html.match(/class="fu-hud /g) || []).length, 2, 'two HUD panels plus the dock');
});

test('options default to the classic rules and sanitize every field', () => {
  const g = new T.Game(seeded(1));
  assert.deepEqual({ ...g.options }, { mode: 'classic', tier: 1, perk: 'none', size: 720, food: 96, target: 160, ticks: 4500, rivals: 4, thorns: 0, abilities: false, meteors: false, wells: false });
  assert.equal(g.thorns.length, 0); assert.equal(g.wells.length, 0); assert.equal(g.meteor, null);
  g.start(); g.actors[0].mass = 80; assert.equal(g.split(0), false); assert.equal(g.eject(0), false);
  const odd = T.config({ mode: 'nope', tier: 9, perk: 'x', size: 5, rivals: 40, thorns: -3, meteors: 'yes' });
  assert.equal(odd.mode, 'classic'); assert.equal(odd.tier, 1); assert.equal(odd.perk, 'none'); assert.equal(odd.size, 480); assert.equal(odd.rivals, 5); assert.equal(odd.thorns, 0); assert.equal(odd.meteors, false);
  for (const id of ['standard', 'melee']) {
    const m = new T.Game(seeded(2), { mode: id }), M = T.MODES[id];
    assert.equal(m.actors.length, M.rivals + 1); assert.equal(m.food.length, M.food); assert.equal(m.thorns.length, M.thorns); assert.equal(m.options.abilities, true);
    for (const a of m.actors) { const r = T.radius(a.mass); assert.ok(a.x >= r && a.y >= r && a.x <= M.size - r && a.y <= M.size - r); }
  }
  assert.equal(T.modifierCount({ meteors: true, wells: true }), 2);
});

test('split halves the largest cell, launches it forward, respects mass, cooldown and the piece cap', () => {
  const g = arena(), a = g.actors[0]; a.x = 300; a.y = 300; a.mass = 35;
  assert.equal(g.split(0), false, 'below SPLIT_MIN');
  a.mass = 80; a.facing = { x: 1, y: 0 };
  assert.equal(g.split(0), true); assert.equal(a.mass, 40); assert.equal(a.pieces.length, 1); assert.equal(a.pieces[0].mass, 40); assert.equal(g.total(a), 80);
  assert.equal(g.split(0), false, 'cooldown'); assert.equal(g.splits, 1);
  const start = a.pieces[0].x; for (let i = 0; i < 30; i++) g.step();
  assert.ok(a.pieces[0].x - start > 70 && a.pieces[0].x - start < 110, 'flies roughly 90 units');
  assert.ok(T.distance(a, a.pieces[0]) >= T.radius(a.mass) + T.radius(a.pieces[0].mass) - 1e-6, 'pieces keep apart before merging');
  const h = arena(), b = h.actors[0]; b.x = b.y = 500; b.mass = 400;
  for (let i = 0; i < 6; i++) { b.splitCd = 0; h.split(0); }
  assert.equal(b.pieces.length, T.MAX_PIECES); assert.equal(h.total(b), 400);
});

test('split pieces merge back after the timer, and a lost core hands over to the largest piece', () => {
  const g = arena(), a = g.actors[0]; a.x = a.y = 400; a.mass = 100; a.facing = { x: 0, y: 1 };
  g.split(0); let merged = false;
  for (let i = 0; i < (T.MERGE_TIME + 4) / T.DT && !merged; i++) { g.step(); merged = !a.pieces.length; }
  assert.ok(merged); assert.equal(a.mass, 100);
  const h = arena(), p = h.actors[0], ai = h.actors[1]; p.x = p.y = 400; p.mass = 100; p.facing = { x: 1, y: 0 }; h.split(0);
  for (let i = 0; i < 25; i++) h.step();
  const piece = p.pieces[0], px = piece.x; ai.mass = 70; ai.x = p.x; ai.y = p.y; h.step();
  assert.equal(p.alive, true, 'the piece keeps the player alive'); assert.equal(p.pieces.length, 0); assert.equal(p.mass, 50); assert.ok(Math.abs(p.x - px) < 2, 'core moved to the piece');
  assert.equal(ai.mass, 70 + 40); assert.equal(h.phase, 'running');
  ai.x = p.x; ai.y = p.y; h.step(); assert.equal(p.alive, false); assert.equal(h.result.outcome, 'loss');
});

test('a split piece can swallow a rival that the whole body could not reach', () => {
  const g = arena(), a = g.actors[0], b = g.actors[1]; a.x = 300; a.y = 400; a.mass = 120; b.mass = 40; b.x = 300 + T.radius(120) + 60; b.y = 400; a.facing = { x: 1, y: 0 };
  g.step(); assert.equal(b.alive, true); g.split(0);
  for (let i = 0; i < 20 && b.alive; i++) g.step();
  assert.equal(b.alive, false); assert.equal(g.eaten, 1); assert.equal(g.total(a), 120 + 32);
});

test('eject costs 4, fires a 3-mass pellet the owner cannot re-eat at once but anyone else can', () => {
  const g = arena(), a = g.actors[0], b = g.actors[1]; a.x = a.y = 400; a.mass = 29; a.facing = { x: 1, y: 0 };
  assert.equal(g.eject(0), false); a.mass = 50;
  assert.equal(g.eject(0), true); assert.equal(a.mass, 46); assert.equal(g.food.length, 1); assert.equal(g.food[0].value, T.EJECT_VALUE); assert.equal(g.eject(0), false, 'rate limited');
  for (let i = 0; i < 10; i++) g.step(); assert.equal(g.food.length, 1); assert.ok(g.food[0].x > 430, 'pellet travels');
  b.mass = 20; b.x = g.food[0].x; b.y = g.food[0].y; g.step(); assert.equal(g.food.length, 0); assert.equal(b.mass, 23);
  const h = arena(), c = h.actors[0]; c.x = c.y = 400; c.mass = 50; c.facing = { x: 1, y: 0 }; h.eject(0);
  h.food[0].vx = h.food[0].vy = 0; h.food[0].x = c.x; h.food[0].y = c.y;
  for (let i = 0; i < T.OWNER_GRACE - 2; i++) h.step(); assert.equal(h.food.length, 1);
  for (let i = 0; i < 4; i++) h.step(); assert.equal(h.food.length, 0); assert.equal(c.mass, 49);
});

test('thorns ignore small bodies, burst heavy ones into pellets, and respawn later', () => {
  const g = arena(), a = g.actors[0]; g.thorns = [{ x: 400, y: 400, vx: 0, vy: 0, feed: 0, owner: -1 }]; g.options.thorns = 1;
  a.x = a.y = 400; a.mass = T.THORN_MASS - 1; g.step(); assert.equal(g.thorns.length, 1); assert.equal(a.mass, T.THORN_MASS - 1);
  a.mass = 100; g.step(); assert.equal(g.thorns.length, 0); assert.equal(a.mass, 100 - Math.floor(100 * T.BURST_SHARE));
  assert.ok(g.food.length >= 10 && g.food.every(p => p.owner === 0 && T.distance(p, a) > T.radius(a.mass))); assert.ok(g.events.some(e => e.type === 'burst' && e.id === 0));
  a.x = 900; for (let i = 0; i < T.THORN_RESPAWN - 2; i++) g.step(); assert.equal(g.thorns.length, 0);
  for (let i = 0; i < 3; i++) g.step(); assert.equal(g.thorns.length, 1);
});

test('feeding a thorn five shots launches it along the shot; a hit on a rival is credited to the shooter', () => {
  const g = arena(), a = g.actors[0], b = g.actors[1]; a.x = 200; a.y = 400; a.mass = 80; a.facing = { x: 1, y: 0 };
  g.thorns = [{ x: 300, y: 400, vx: 0, vy: 0, feed: 0, owner: -1 }]; b.mass = 120; b.x = 480; b.y = 400;
  let launched = false;
  for (let shot = 0; shot < T.THORN_FEED; shot++) { a.ejectCd = 0; g.eject(0); for (let i = 0; i < 8; i++) { g.step(); launched = launched || g.events.some(e => e.type === 'thorn' && e.owner === 0); } }
  assert.equal(a.mass, 60); assert.ok(launched);
  let hit = false; for (let i = 0; i < 40 && !hit; i++) { g.step(); hit = g.events.some(e => e.type === 'burst' && e.id === 1 && e.by === 0); }
  assert.ok(hit, 'thorn reached the rival'); assert.equal(g.thornHits, 1); assert.equal(b.mass, 120 - Math.floor(120 * T.BURST_SHARE));
});

test('meteors telegraph, then scorch heavy cells inside the circle only', () => {
  const g = arena({ meteors: true }), a = g.actors[0], b = g.actors[1];
  a.x = a.y = 500; a.mass = 100; b.x = 800; b.y = 500; b.mass = 100; g.nextMeteor = g.tick + 1;
  g.step(); assert.ok(g.meteor); assert.ok(g.events.some(e => e.type === 'meteor-warn'));
  g.meteor.x = 500; g.meteor.y = 500; a.x = a.y = 500;
  for (let i = 0; i < T.METEOR_WARN && g.meteor; i++) g.step();
  assert.equal(g.meteor, null); assert.equal(a.mass, 100 - Math.floor(100 * T.METEOR_SHARE)); assert.equal(b.mass, 100);
  assert.ok(g.food.filter(p => p.value === 5).length >= 5); assert.ok(g.nextMeteor >= g.tick + T.METEOR_EVERY);
  const small = arena({ meteors: true }), c = small.actors[0]; c.x = c.y = 500; c.mass = T.METEOR_MIN - 1; small.meteor = { x: 500, y: 500, r: T.METEOR_R, at: small.tick + 1 };
  small.step(); assert.equal(c.mass, T.METEOR_MIN - 1);
});

test('gravity wells pull nearby cells and drain the core down to a floor of 10', () => {
  const g = arena({ wells: true }), a = g.actors[0], w = g.wells[0];
  a.mass = 40; a.x = w.x + 100; a.y = w.y; g.step(); assert.ok(a.x < w.x + 100);
  for (let i = 0; i < 2000; i++) { a.x = w.x; a.y = w.y; g.step(); }
  assert.equal(a.mass, 10);
  const far = arena({ wells: true }), b = far.actors[0]; b.x = 60; b.y = 60; far.step(); assert.equal(b.x, 60);
});

test('perks: magnet reaches further, swift boosts longer and recovers sooner, dense starts heavier', () => {
  const plain = arena(), magnet = arena({ perk: 'magnet' });
  for (const g of [plain, magnet]) { const a = g.actors[0]; a.x = a.y = 400; g.food = [{ x: 400 + T.radius(a.mass) + 10, y: 400, value: 2 }]; g.step(); }
  assert.equal(plain.food.length, 1); assert.equal(magnet.food.length, 0);
  const swift = arena({ perk: 'swift' }); swift.boost(); assert.equal(swift.boostTime, .8); assert.equal(swift.cooldown, 3);
  assert.equal(new T.Game(seeded(1), { perk: 'dense' }).actors[0].mass, 26);
});

test('AI tiers differ in speed, reaction cadence and judgement', () => {
  const speeds = T.TIERS.map(t => t.speed), thinks = T.TIERS.map(t => t.think);
  assert.equal(JSON.stringify([...speeds].sort()), JSON.stringify(speeds)); assert.equal(JSON.stringify([...thinks].sort((a, b) => b - a)), JSON.stringify(thinks));
  const travel = T.TIERS.map((_, tier) => { const g = arena({ tier }); const a = g.actors[1]; a.steering = { x: 1, y: 0 }; g.aiDirection = () => ({ x: 1, y: 0 }); const x = a.x; g.step(); return a.x - x; });
  assert.ok(travel[0] < travel[1] && travel[1] < travel[2] && travel[2] < travel[3]);
  // Smart tiers flee a pincer of two predators instead of running into the second one.
  const g = new T.Game(seeded(1), { mode: 'standard', tier: 2, thorns: 0 }), me = g.actors[1];
  g.food = []; g.actors.forEach(b => { b.alive = false; }); me.alive = true; me.x = 500; me.y = 500; me.mass = 30;
  Object.assign(g.actors[2], { alive: true, x: 420, y: 500, mass: 80 }); Object.assign(g.actors[3], { alive: true, x: 500, y: 420, mass: 80 });
  const d = g.aiDirection(me); assert.ok(d.x > .5 && d.y > .5);
  // A heavy smart AI steers away from a thorn in its path.
  const h = new T.Game(seeded(1), { mode: 'standard', tier: 3, thorns: 0 }), big = h.actors[1];
  h.actors.forEach(b => { b.alive = b === big; }); big.x = big.y = 500; big.mass = 120; h.thorns = [{ x: 540, y: 500, vx: 0, vy: 0, feed: 0, owner: -1 }]; h.food = [{ x: 600, y: 500, value: 5 }];
  assert.ok(h.aiDirection(big).x < 0);
});

test('hunter AI splits to snipe a reachable prey; the classic AI never uses abilities', () => {
  const setup = tier => {
    const g = new T.Game(seeded(4), { mode: 'standard', tier, thorns: 0 }); g.start(); g.food = []; const a = g.actors[1], prey = g.actors[2];
    g.actors.forEach(b => { b.alive = b === a || b === prey || b.id === 0; b.x = 50 + b.id * 10; b.y = 1000; b.mass = 12; });
    Object.assign(a, { x: 500, y: 500, mass: 120 }); Object.assign(prey, { x: 500 + T.radius(60) + 80, y: 500, mass: 40 }); return g;
  };
  const hunter = setup(2); hunter.aiAct(hunter.actors[1]); assert.equal(hunter.actors[1].pieces.length, 1); assert.ok(hunter.actors[1].steering.x > .99);
  const classic = setup(1); for (let i = 0; i < 40; i++) classic.step(); assert.equal(classic.actors[1].pieces.length, 0);
});

test('star king AI feeds a thorn lined up with a heavy rival', () => {
  const g = new T.Game(seeded(5), { mode: 'standard', tier: 3, thorns: 0 }); g.start(); g.food = [];
  const a = g.actors[3], victim = g.actors[0]; g.actors.forEach(b => { b.alive = b === a || b === victim; });
  Object.assign(a, { x: 300, y: 500, mass: 80 }); Object.assign(victim, { x: 560, y: 500, mass: 150 }); g.thorns = [{ x: 420, y: 500, vx: 0, vy: 0, feed: 0, owner: -1 }];
  g.aiAct(a); assert.equal(a.mass, 76); assert.ok(g.food.some(p => p.owner === 3 && p.shot));
  const lazy = new T.Game(seeded(5), { mode: 'standard', tier: 2, thorns: 0 }); lazy.start(); lazy.food = []; const b = lazy.actors[3];
  lazy.actors.forEach(c => { c.alive = c === b || c.id === 0; }); Object.assign(b, { x: 300, y: 500, mass: 80 }); Object.assign(lazy.actors[0], { x: 560, y: 500, mass: 150 }); lazy.thorns = [{ x: 420, y: 500, vx: 0, vy: 0, feed: 0, owner: -1 }];
  lazy.aiAct(b); assert.equal(b.mass, 80);
});

test('targets, ranking and the result use total mass across pieces', () => {
  const g = arena(), a = g.actors[0]; a.mass = 200; a.pieces = [{ x: 500, y: 900, mass: 120, vx: 0, vy: 0, merge: 5 }];
  g.checkResult(); assert.equal(g.result.outcome, 'win'); assert.equal(g.result.mass, 320); assert.equal(g.result.place, 1);
  const h = arena(); h.actors[0].mass = 50; h.actors[2].mass = 90; h.actors[3].mass = 80; h.tick = h.options.ticks; h.checkResult();
  assert.equal(h.result.outcome, 'loss'); assert.equal(h.result.place, 3);
});

test('seeded standard and melee matches with every hazard stay consistent to the end', () => {
  const outcomes = new Set(); let bursts = 0, splits = 0;
  for (const [mode, tier] of [['standard', 3], ['melee', 2], ['standard', 0]]) for (let seed = 1; seed <= 3; seed++) {
    const g = new T.Game(seeded(seed), { mode, tier, meteors: true, wells: true }); g.start();
    while (g.phase === 'running') {
      g.step({ ...g.smartDirection(g.actors[0]), split: g.tick % 300 === 0, eject: g.tick % 500 < 3 });
      for (const e of g.events) { bursts += e.type === 'burst'; splits += e.type === 'split'; }
      assert.ok(g.tick <= g.options.ticks); assert.ok(g.thorns.length <= g.options.thorns);
      for (const a of g.actors) {
        assert.ok(a.pieces.length <= T.MAX_PIECES);
        if (a.alive) for (const c of g.cells(a)) { assert.ok(Number.isInteger(c.mass) && c.mass > 0); const r = T.radius(c.mass); assert.ok(c.x >= r - 1e-9 && c.y >= r - 1e-9 && c.x <= g.size - r + 1e-9 && c.y <= g.size - r + 1e-9); }
      }
    }
    outcomes.add(g.result.outcome); assert.ok(g.result.place >= 1 && g.result.place <= g.actors.length);
  }
  assert.ok(outcomes.has('win') && outcomes.has('loss')); assert.ok(bursts > 0); assert.ok(splits > 0);
});

test('career: levels, ranks, XP multipliers, unlocks and safe storage', () => {
  assert.deepEqual({ ...Career.levelOf(0) }, { level: 1, into: 0, need: 140, max: false }); assert.equal(Career.levelOf(140).level, 2); assert.equal(Career.levelOf(1e9).level, Career.MAX_LEVEL);
  assert.equal(Career.rankOf(1), '星塵'); assert.equal(Career.rankOf(25), '星系');
  const loss = { outcome: 'loss', maxMass: 0, eaten: 0, collected: 0, tier: 2, mode: 'classic', modifiers: 0 }, win = { ...loss, outcome: 'win', maxMass: 320, eaten: 2, collected: 60, thornHits: 1, place: 1 };
  assert.equal(Career.matchXP(loss).total, 20);
  assert.equal(Career.matchXP(win).base, 20 + 32 + 50 + 12 + 15 + 120);
  assert.ok(Career.matchXP({ ...win, tier: 3 }).total > Career.matchXP(win).total); assert.ok(Career.matchXP({ ...win, mode: 'melee' }).total > Career.matchXP(win).total);
  assert.ok(Career.matchXP({ ...win, modifiers: 2 }).total > Career.matchXP({ ...win, modifiers: 1 }).total);
  assert.equal(Career.matchXP({ ...loss, maxMass: 5000 }).lines.find(l => /最大質量/.test(l[0]))[1], 60);
  const r = Career.record(Career.blank(), win); assert.equal(r.profile.matches, 1); assert.equal(r.profile.wins, 1); assert.equal(r.profile.bestTier, 2); assert.equal(r.profile.bestMass, 320); assert.ok(r.after.level > 1); assert.ok(r.unlocked.length > 0);
  assert.equal(Career.unlocked(1, 'tier', 2), false); assert.equal(Career.unlocked(3, 'tier', 2), true); assert.equal(Career.unlocked(4, 'mode', 'melee'), false); assert.equal(Career.unlocked(1, 'modifier', 'meteors'), false);
  for (const u of Career.UNLOCKS) {
    if (u.kind === 'tier') assert.ok(T.TIERS[u.id]); if (u.kind === 'mode') assert.ok(T.MODES[u.id]); if (u.kind === 'perk') assert.ok(T.PERKS[u.id]);
    if (u.kind === 'modifier') assert.ok(['meteors', 'wells'].includes(u.id));
  }
  for (const id of Object.keys(T.MODES)) assert.ok(Career.MODE_XP[id]);
  assert.deepEqual({ ...Career.sanitize({ xp: -5, wins: 'x', eaten: 3.7 }) }, { ...Career.blank(), eaten: 3 });
  const mem = new Map(), storage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.ok(Career.save(storage, r.profile)); assert.equal(Career.load(storage).xp, r.profile.xp); mem.set(Career.KEY, '{broken'); assert.equal(Career.load(storage).xp, 0);
});
