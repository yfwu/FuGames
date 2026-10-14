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
    assert.match(source, /href="fulab-theme.css"/);
    assert.match(source, /class="[^"]*\bsite-nav\b[^"]*"/); assert.match(source, /class="[^"]*\bpage-header\b[^"]*"/);
    if (!['index.html','archive.html'].includes(name)) { assert.match(source, /class="card play-panel(?: [^"]*)?"/); assert.match(source, /<details class="card rules(?: [^"]*)?">/); }
    for (const [, script] of source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new vm.Script(script), name);
    for (const [, tag, href] of source.matchAll(/<([a-z]+)\b[^>]*\bhref="([^"]+)"/g)) {
      // A credit is an optional navigation link, not a fetched game asset.
      if (/^https:\/\//.test(href)) { assert.equal(tag, 'a', name + ' -> remote asset ' + href); continue; }
      const [file, fragment] = href.split('#');
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
