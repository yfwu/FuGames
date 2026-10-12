'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'lane_duel.html'), 'utf8');
const L = vm.runInNewContext(html.match(/<script id="lane-engine">([\s\S]*?)<\/script>/)[1] + '; LaneDuel;');
// Engine objects come from another realm; compare their plain data.
const plain = value => JSON.parse(JSON.stringify(value));

// A running two-human game: no AI, no waves interfering unless a test asks for them.
function fixture(options = {}) {
  const g = new L.Game({ seed: 'fixture', ai: [false, false], ...options }); g.start();
  return g;
}
function addUnit(g, side, props = {}) {
  const u = { id: ++g.serial, kind: 'creep', hp: 100, maxHp: 100, speed: 0, lives: 1, bounty: 3, armor: 0, sender: -1, dist: 10, slow: 0, slowTicks: 0, ...props };
  g.fields[side].units.push(u); return u;
}
function buildable(g, side) {
  for (let row = 0; row < L.ROWS; row++) for (let col = 0; col < L.COLS; col++) if (!L.isRoad(col, row) && !g.towerAt(side, col, row)) return [col, row];
  return null;
}
function play(options) {
  const g = new L.Game(options); g.start();
  const peaks = { units: 0, queue: 0 };
  while (g.phase === 'running') {
    g.step();
    for (const side of [0, 1]) {
      const s = g.sides[side], f = g.fields[side];
      assert.ok(s.gold >= 0 && Number.isFinite(s.gold), 'gold never negative');
      assert.ok(s.towers.length <= L.MAX_TOWERS);
      for (const t of s.towers) assert.ok(!L.isRoad(t.col, t.row) && t.level >= 1 && t.level <= L.MAX_LEVEL);
      peaks.units = Math.max(peaks.units, f.units.length); peaks.queue = Math.max(peaks.queue, f.queue.length);
      for (const u of f.units) assert.ok(Number.isFinite(u.dist) && u.dist >= 0 && u.dist < L.PATH_LENGTH);
    }
  }
  return { g, peaks };
}

test('the road is one continuous 43-cell route from the left entrance to the right exit', () => {
  assert.ok(Math.abs(L.PATH_LENGTH - 43) < 1e-9);
  assert.deepEqual(plain(L.pointAt(0)), { x: 0, y: 1.5 }); assert.deepEqual(plain(L.pointAt(L.PATH_LENGTH)), { x: 16, y: 6.5 });
  assert.deepEqual(plain(L.pointAt(-5)), plain(L.pointAt(0))); assert.deepEqual(plain(L.pointAt(999)), plain(L.pointAt(L.PATH_LENGTH)));
  let previous = null, cells = new Set();
  for (let d = 0; d < L.PATH_LENGTH; d += .05) {
    const p = L.pointAt(d), cell = [Math.min(L.COLS - 1, Math.floor(p.x)), Math.floor(p.y)];
    assert.ok(L.isRoad(...cell)); cells.add(cell.join(','));
    if (previous) assert.ok(Math.abs(previous[0] - cell[0]) + Math.abs(previous[1] - cell[1]) <= 1, 'road cells are edge-connected');
    previous = cell;
  }
  assert.equal(cells.size, 43);
  assert.ok(L.isRoad(0, 1) && L.isRoad(15, 6) && !L.isRoad(0, 0) && !L.isRoad(15, 7));
  assert.equal(L.inField(16, 0) || L.inField(0, 8) || L.inField(-1, 0) || L.inField(1.5, 2), false);
});

test('ready, paused and finished games freeze; reset restores every round resource', () => {
  const g = new L.Game({ seed: 'freeze', ai: [false, true] }); g.step(); assert.equal(g.tick, 0);
  assert.equal(g.build(0, 0, 0, 'arrow'), null); assert.equal(g.send(0, 'runner'), false);
  g.start(); for (let i = 0; i < 200; i++) g.step(); g.pause();
  const snapshot = JSON.stringify(g); g.step(); assert.equal(JSON.stringify(g), snapshot);
  assert.equal(g.build(0, 0, 0, 'arrow'), null); assert.equal(g.send(0, 'runner'), false);
  g.start(); g.step(); assert.equal(g.tick, 201);
  g.finish(1, 'test'); const end = JSON.stringify(g); g.step(); assert.equal(JSON.stringify(g), end); assert.equal(g.upgrade(1, 1), false);
  g.reset();
  assert.equal(g.phase, 'ready'); assert.equal(g.tick, 0); assert.equal(g.wave, 0); assert.equal(g.result, null);
  for (const side of [0, 1]) {
    assert.deepEqual(JSON.parse(JSON.stringify(g.sides[side])), { gold: L.START_GOLD, lives: L.START_LIVES, income: L.START_INCOME, towers: [], sent: { runner: 0, brute: 0, swarm: 0 }, kills: 0, leaks: 0, spent: 0 });
    assert.deepEqual(JSON.parse(JSON.stringify(g.fields[side])), { units: [], queue: [], delay: 0 });
  }
});

test('towers only go on empty, in-field, non-road cells the side can afford, up to the tower cap', () => {
  const g = fixture();
  assert.equal(g.build(0, 0, 1, 'arrow'), null, 'road');
  assert.equal(g.build(0, 16, 0, 'arrow'), null, 'outside');
  assert.equal(g.build(0, 1.5, 0, 'arrow'), null, 'fractional');
  assert.equal(g.build(0, 0, 0, 'laser'), null, 'unknown type');
  const t = g.build(0, 0, 0, 'arrow'); assert.ok(t);
  assert.equal(g.sides[0].gold, L.START_GOLD - 30); assert.equal(g.sides[0].spent, 30);
  assert.equal(g.build(0, 0, 0, 'cannon'), null, 'occupied');
  assert.ok(g.build(1, 0, 0, 'cannon'), 'each side owns its own field');
  g.sides[0].gold = 49; assert.equal(g.build(0, 1, 0, 'cannon'), null, 'too poor');
  g.sides[0].gold = 10000;
  while (g.sides[0].towers.length < L.MAX_TOWERS) assert.ok(g.build(0, ...buildable(g, 0), 'arrow'));
  assert.equal(g.build(0, ...buildable(g, 0), 'arrow'), null, 'tower cap');
});

test('upgrades cost more each level, stop at level 3, and selling refunds 70% of the total investment', () => {
  const g = fixture(); g.sides[0].gold = 1000;
  const t = g.build(0, 0, 0, 'cannon');
  assert.equal(L.upgradeCost(t), 45); assert.ok(g.upgrade(0, t.id));
  assert.equal(t.level, 2); assert.equal(L.upgradeCost(t), 75); assert.ok(g.upgrade(0, t.id));
  assert.equal(t.level, 3); assert.equal(L.upgradeCost(t), null); assert.equal(g.upgrade(0, t.id), false);
  assert.equal(t.invested, 170); assert.equal(g.sides[0].gold, 1000 - 170);
  assert.ok(L.towerDamage(t) > L.TOWERS.cannon.damage * 2.9 && L.towerRange(t) > L.TOWERS.cannon.range);
  assert.equal(g.upgrade(1, t.id), false, 'cannot upgrade the opponent tower');
  assert.ok(g.sell(0, t.id)); assert.equal(g.sides[0].gold, 830 + 119); assert.equal(g.sides[0].towers.length, 0);
  assert.equal(g.sell(0, t.id), false);
  const poor = g.build(0, 0, 0, 'arrow'); g.sides[0].gold = 26; assert.equal(g.upgrade(0, poor.id), false); assert.equal(poor.level, 1);
});

test('every five seconds both sides are paid their income', () => {
  const g = fixture(); g.sides[1].income = 13;
  for (let i = 1; i < L.PAY_TICKS; i++) g.step();
  assert.deepEqual(plain(g.sides.map(s => s.gold)), [L.START_GOLD, L.START_GOLD]);
  g.step(); assert.deepEqual(plain(g.sides.map(s => s.gold)), [L.START_GOLD + L.START_INCOME, L.START_GOLD + 13]);
});

test('identical neutral waves reach both lanes on schedule, growing stronger with a boss every fifth wave', () => {
  const g = fixture();
  for (let i = 1; i < L.FIRST_WAVE; i++) g.step();
  assert.equal(g.wave, 0); g.step(); assert.equal(g.wave, 1);
  const lane = f => plain(f).queue.concat(plain(f).units.map(({ id, ...u }) => u));
  assert.deepEqual(lane(g.fields[0]), lane(g.fields[1]));
  for (let i = 0; i < L.WAVE_TICKS; i++) g.step(); assert.equal(g.wave, 2);
  const one = L.waveSpec(1), five = L.waveSpec(5), ten = L.waveSpec(10);
  assert.equal(one.length, 6); assert.ok(one.every(u => u.kind === 'creep'));
  assert.equal(five.filter(u => u.kind === 'boss').length, 1); assert.equal(five.find(u => u.kind === 'boss').lives, 3);
  assert.ok(ten[0].hp > five[0].hp && five[0].hp > one[0].hp && ten.length > one.length);
});

test('sending soldiers costs gold, raises income and queues scaled units at the opponent entrance', () => {
  const g = fixture(); g.wave = 5;
  assert.ok(g.send(0, 'swarm'));
  assert.equal(g.sides[0].gold, L.START_GOLD - 40); assert.equal(g.sides[0].income, L.START_INCOME + 2); assert.equal(g.sides[0].sent.swarm, 1);
  assert.equal(g.fields[0].queue.length, 0); assert.equal(g.fields[1].queue.length, 5);
  assert.ok(g.fields[1].queue.every(u => u.sender === 0 && u.hp === Math.round(30 * L.sendScale(5))));
  assert.ok(g.send(1, 'brute')); assert.equal(g.fields[0].queue[0].armor, .5); assert.equal(g.fields[0].queue[0].lives, 2);
  assert.equal(g.send(0, 'dragon'), false);
  g.sides[0].gold = 19; assert.equal(g.send(0, 'runner'), false);
  g.sides[0].gold = 10000; while (g.send(0, 'runner')); assert.equal(g.fields[1].queue.length, L.MAX_QUEUE);
  assert.equal(g.send(0, 'swarm'), false, 'a full entrance refuses more soldiers');
});

test('queued units enter one at a time, walk the road, and leaking costs the defender their lives value', () => {
  const g = fixture(); g.send(0, 'swarm');
  g.step(); assert.equal(g.fields[1].units.length, 1);
  for (let i = 0; i < 3; i++) g.step(); assert.equal(g.fields[1].units.length, 1);
  g.step(); assert.equal(g.fields[1].units.length, 2);
  const lead = g.fields[1].units[0]; assert.ok(lead.dist > 0);
  addUnit(g, 0, { kind: 'brute', lives: 2, speed: 1, dist: L.PATH_LENGTH - .01 });
  g.step();
  assert.equal(g.sides[0].lives, L.START_LIVES - 2); assert.equal(g.sides[0].leaks, 2); assert.equal(g.fields[0].units.length, 0);
  assert.ok(g.events.some(e => e.type === 'leak' && e.side === 0 && e.lives === 2));
});

test('towers shoot the most advanced enemy in range, respect cooldown, and award the bounty to the defender', () => {
  const g = fixture(); const t = g.build(0, 0, 0, 'arrow');
  // Arrow at (0.5,0.5) with range 2.6 reaches the first road row near the entrance.
  const near = addUnit(g, 0, { dist: 1 }), ahead = addUnit(g, 0, { dist: 2 }), far = addUnit(g, 0, { dist: 20 });
  g.step();
  assert.equal(ahead.hp, 90); assert.equal(near.hp, 100); assert.equal(far.hp, 100);
  assert.equal(t.cooldown, L.TOWERS.arrow.cooldown);
  for (let i = 0; i < L.TOWERS.arrow.cooldown; i++) g.step(); assert.equal(ahead.hp, 90);
  g.step(); assert.equal(ahead.hp, 80);
  const gold = g.sides[0].gold; ahead.hp = 5;
  for (let i = 0; i <= L.TOWERS.arrow.cooldown; i++) g.step();
  assert.equal(g.fields[0].units.includes(ahead), false); assert.equal(g.sides[0].gold, gold + 3); assert.equal(g.sides[0].kills, 1);
  assert.equal(g.sides[1].kills, 0);
});

test('cannon splash hits a group, armour halves splash only, and frost slows then wears off', () => {
  const g = fixture(); g.build(0, 0, 0, 'cannon');
  const a = addUnit(g, 0, { dist: 2 }), b = addUnit(g, 0, { dist: 1.5 }), shield = addUnit(g, 0, { dist: 1.2, armor: .5 }), apart = addUnit(g, 0, { dist: 4.5 });
  g.step();
  assert.equal(a.hp, 70); assert.equal(b.hp, 70); assert.equal(shield.hp, 85); assert.equal(apart.hp, 100);
  const arrows = fixture(); arrows.build(0, 0, 0, 'arrow'); const armored = addUnit(arrows, 0, { dist: 2, armor: .5 }); arrows.step(); assert.equal(armored.hp, 90);
  const cold = fixture(), warm = fixture(); cold.build(0, 0, 0, 'frost');
  const slowed = addUnit(cold, 0, { dist: 2, speed: 1, hp: 1000 }), free = addUnit(warm, 0, { dist: 2, speed: 1, hp: 1000 });
  cold.step(); warm.step();
  assert.equal(slowed.slow, .45); assert.ok(slowed.slowTicks > 0);
  for (let i = 0; i < 10; i++) { cold.step(); warm.step(); }
  assert.ok(slowed.dist < free.dist);
  cold.sides[0].towers = []; for (let i = 0; i < 40; i++) cold.step();
  assert.equal(slowed.slow, 0); assert.equal(slowed.slowTicks, 0);
});

test('outcomes: a lane falling loses, simultaneous falls draw, and time runs out on remaining lives', () => {
  for (const [lives, winner] of [[[0, 5], 1], [[5, 0], 0], [[0, 0], null]]) {
    const g = fixture(); g.sides[0].lives = lives[0]; g.sides[1].lives = lives[1]; g.checkResult();
    assert.equal(g.phase, 'over'); assert.equal(g.result.winner, winner);
  }
  for (const [lives, winner] of [[[7, 3], 0], [[2, 9], 1], [[4, 4], null]]) {
    const g = fixture(); g.tick = L.TIME_LIMIT; g.sides[0].lives = lives[0]; g.sides[1].lives = lives[1]; g.checkResult();
    assert.equal(g.result.winner, winner); assert.match(g.result.reason, /時間到/);
  }
  const g = fixture(); g.tick = L.TIME_LIMIT - 1; g.checkResult(); assert.equal(g.phase, 'running');
});

test('a seed fully determines AI games; different seeds give different games', () => {
  const run = seed => { const g = new L.Game({ seed, ai: [true, true] }); g.start(); for (let i = 0; i < 2400; i++) g.step(); return JSON.stringify([g.sides, g.fields, g.wave]); };
  assert.equal(run('same'), run('same'));
  assert.notEqual(run('same'), run('other'));
});

test('AI builds, upgrades and sends using only the shared rules, and reacts to a threat in its lane', () => {
  const g = new L.Game({ seed: 'ai-basic', ai: [false, true] }); g.start();
  for (let i = 0; i < 80; i++) g.step();
  assert.ok(g.sides[1].towers.length >= 2 && g.sides[1].spent >= 80, 'AI opens by covering the road');
  assert.equal(g.sides[0].towers.length, 0, 'AI never acts for the human seat');
  assert.equal(g.sides[1].gold + g.sides[1].spent, L.START_GOLD, 'AI spends only what it has');
  const calm = L.defense(g, 1).damage;
  for (let i = 0; i < 6; i++) g.fields[1].queue.push({ kind: 'brute', hp: 900, speed: 1.1, lives: 2, bounty: 10, gap: 14, armor: .5, sender: 0 });
  g.sides[1].gold = 400; g.sides[0].gold = 0;
  for (let i = 0; i < 60; i++) g.step();
  assert.ok(L.defense(g, 1).damage > calm, 'more defence after a heavy push');
  const rich = new L.Game({ seed: 'ai-rich', ai: [false, true] }); rich.start();
  for (let i = 0; i < 80; i++) rich.step();
  rich.sides[1].gold = 2000; for (let i = 0; i < 40; i++) rich.step();
  assert.ok(Object.values(rich.sides[1].sent).reduce((a, b) => a + b, 0) > 0, 'a safe, rich AI attacks');
});

test('seeded AI-vs-AI matches with seat swaps finish with bounded state and both seats able to win', () => {
  const started = Date.now(), winners = [], types = new Set(), sends = new Set();
  let maxUnits = 0, maxQueue = 0, minutes = 0;
  for (const seed of ['m1', 'm2', 'm3', 'm4', 'm5', 'm6']) for (const swap of [false, true]) {
    const { g, peaks } = play({ seed, ai: [true, true], difficulty: swap ? ['hard', 'normal'] : ['normal', 'hard'] });
    assert.equal(g.phase, 'over'); assert.ok(g.result.tick <= L.TIME_LIMIT);
    winners.push(g.result.winner); minutes += g.result.tick / L.TPS / 60;
    maxUnits = Math.max(maxUnits, peaks.units); maxQueue = Math.max(maxQueue, peaks.queue);
    for (const s of g.sides) { for (const t of s.towers) types.add(t.type); for (const [k, v] of Object.entries(s.sent)) if (v) sends.add(k); }
  }
  assert.ok(winners.includes(0) && winners.includes(1), JSON.stringify(winners));
  assert.ok(maxUnits <= L.MAX_UNITS); assert.ok(maxQueue < 400);
  assert.deepEqual([...types].sort(), ['arrow', 'cannon', 'frost']); assert.deepEqual([...sends].sort(), ['brute', 'runner', 'swarm']);
  console.log(JSON.stringify({ games: winners.length, winners, averageMinutes: +(minutes / winners.length).toFixed(2), maxUnits, maxQueue, ms: Date.now() - started }));
});

test('difficulty is ordered across seat-swapped seeded matches: hard > normal > easy', () => {
  const tally = {};
  for (const [strong, weak] of [['hard', 'easy'], ['normal', 'easy'], ['hard', 'normal']]) {
    let wins = 0;
    for (const seed of ['d1', 'd2', 'd3', 'd4']) for (const seat of [0, 1]) {
      const { g } = play({ seed, ai: [true, true], difficulty: seat ? [weak, strong] : [strong, weak] });
      if (g.result.winner === seat) wins++;
    }
    tally[strong + '>' + weak] = wins + '/8';
    assert.ok(wins >= (weak === 'easy' ? 7 : 6), `${strong} vs ${weak}: ${wins}/8`);
  }
  console.log(JSON.stringify(tally));
});
