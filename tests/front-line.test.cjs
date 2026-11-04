'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'front_line.html'), 'utf8');
const F = vm.runInNewContext(html.match(/<script id="front-engine">([\s\S]*?)<\/script>/)[1] + '; FrontLine;');
const C = vm.runInNewContext(html.match(/<script id="front-career">([\s\S]*?)<\/script>/)[1] + '; FrontCareer;');
// Engine objects come from another realm; compare their plain data.
const plain = value => JSON.parse(JSON.stringify(value));

// A running two-human game with plenty of supply; nothing happens unless a test sets it up.
function fixture(options = {}) {
  const g = new F.Game({ seed: 'fixture', ai: [false, false], ...options }); g.start();
  g.sides[0].supply = g.sides[1].supply = 1000;
  return g;
}
const L = lane => F.laneLength(lane);
// Drones are placed by lane position: the distance from base 0 along that lane.
function addDrone(g, side, lane, pos, props = {}) {
  const p = F.lanePoint(lane, pos);
  const d = { id: ++g.serial, side, lane, pos, x: p.x, y: p.y, hp: F.DRONE.hp, attacking: null, ...props };
  g.drones.push(d); return d;
}
function run(g, ticks) { for (let i = 0; i < ticks && g.phase === 'running'; i++) g.step(); }
function play(options) {
  const g = new F.Game({ ai: [true, true], ...options }); g.start();
  let peak = 0;
  while (g.phase === 'running') {
    g.step();
    peak = Math.max(peak, g.drones.length);
    for (const s of g.sides) {
      assert.ok(Number.isFinite(s.supply) && s.supply >= 0, 'supply never negative');
      assert.ok(s.hq >= 0 && s.hq <= F.HQ_HP);
      assert.ok(s.hand.length <= F.HAND);
      for (const x of s.structures) assert.ok(x.hp > 0 && x.hp <= x.maxHp && x.slot >= 0 && x.slot < 6);
    }
    assert.ok(g.drones.length <= F.MAX_DRONES + 6);
  }
  return { g, peak };
}

test('three lanes join two corner bases, with six mirrored slots per side', () => {
  assert.equal(F.LANES, 3);
  for (let lane = 0; lane < 3; lane++) {
    const start = F.lanePoint(lane, 0);
    assert.deepEqual([start.x, start.y], [F.BASE[0].x, F.BASE[0].y], 'every lane starts at base 0');
    const end = F.lanePoint(lane, L(lane));
    assert.ok(Math.hypot(end.x - F.BASE[1].x, end.y - F.BASE[1].y) < 1e-9, 'and ends at base 1');
  }
  assert.equal(L(0), 1080); assert.equal(L(2), 1080);
  assert.ok(L(1) < L(0), 'mid is the short lane');
  assert.deepEqual(plain(F.lanePoint(0, 540)), { x: 90, y: 90, dx: 0, dy: -1 }, 'top lane turns at the top-left corner');
  assert.deepEqual(plain(F.slotPos(0, 0, 0)), { x: 48, y: 460, pos: 170 });
  const key = p => `${Math.round(p.x)},${Math.round(p.y)}`, own = [], foe = [];
  for (let lane = 0; lane < 3; lane++) for (let slot = 0; slot < 6; slot++) {
    const a = F.slotPos(0, lane, slot), b = F.slotPos(1, lane, slot);
    assert.ok(F.ownHalf(0, a.x, a.y) && F.ownHalf(1, b.x, b.y), 'each side builds only on its own half');
    own.push(key({ x: F.SIZE - a.x, y: F.SIZE - a.y })); foe.push(key(b));
  }
  assert.deepEqual(own.sort(), foe.sort(), 'the two sides are point-symmetric');
  const all = [0, 1].flatMap(side => [0, 1, 2].flatMap(lane => [0, 1, 2, 3, 4, 5].map(slot => F.slotPos(side, lane, slot))));
  for (const a of all) for (const b of all) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 50, 'slots never overlap');
});

test('building checks phase, slot, occupancy and supply', () => {
  const g = new F.Game({ ai: [false, false] });
  assert.equal(g.build(0, 0, 0, 'turret'), null, 'not before the round starts');
  g.start();
  const t = g.build(0, 0, 0, 'turret');
  assert.ok(t);
  assert.equal(g.sides[0].supply, F.START_SUPPLY - F.STRUCTS.turret.cost);
  assert.equal(g.build(0, 0, 0, 'radar'), null, 'slot taken');
  assert.equal(g.build(0, 3, 0, 'radar'), null, 'no fourth lane');
  assert.equal(g.build(0, 0, 6, 'radar'), null, 'no seventh slot');
  assert.equal(g.build(0, 0, 1, 'tank'), null, 'unknown type');
  g.sides[0].supply = 10;
  assert.equal(g.build(0, 0, 1, 'radar'), null, 'not enough supply');
  assert.ok(g.build(1, 0, 0, 'radar'), 'the enemy slot of the same index is separate');
});

test('selling refunds half of the cost', () => {
  const g = fixture();
  const f = g.build(0, 1, 2, 'factory');
  const before = g.sides[0].supply;
  assert.ok(g.sell(0, f.id));
  assert.equal(g.sides[0].supply, before + 30);
  assert.equal(g.structureAt(0, 1, 2), null);
  assert.equal(g.sell(0, f.id), false);
  assert.equal(g.sides[1].destroyed, 0, 'selling is not a kill');
});

test('supply arrives once per second, depots add to it and AI difficulty scales it', () => {
  const g = fixture();
  g.sides[0].supply = g.sides[1].supply = 0;
  run(g, F.PAY_TICKS - 1);
  assert.equal(g.sides[0].supply, 0);
  run(g, 1);
  assert.equal(g.sides[0].supply, F.BASE_INCOME);
  g.sides[0].supply = 100; g.build(0, 0, 0, 'depot');
  assert.equal(g.income(0), F.BASE_INCOME + F.STRUCTS.depot.income);
  const ai = new F.Game({ ai: [true, true], difficulty: ['easy', 'hard'] });
  assert.equal(ai.income(0), F.BASE_INCOME * F.PROFILES.easy.income);
  assert.equal(ai.income(1), F.BASE_INCOME * F.PROFILES.hard.income);
  assert.ok(F.PROFILES.easy.income < F.PROFILES.normal.income && F.PROFILES.normal.income < F.PROFILES.hard.income);
});

test('cards are drawn at 10 s and every 20 s after, up to three in hand', () => {
  const g = fixture();
  run(g, F.FIRST_CARD - 1);
  assert.equal(g.sides[0].hand.length, 0);
  run(g, 1);
  assert.equal(g.sides[0].hand.length, 1);
  assert.equal(g.sides[1].hand.length, 1);
  run(g, F.CARD_TICKS * 4);
  assert.equal(g.sides[0].hand.length, F.HAND);
  for (const c of g.sides[0].hand) assert.ok(F.CARDS[c]);
});

test('card draws follow the card weights', () => {
  const g = fixture(), counts = {};
  for (let i = 0; i < 4000; i++) { g.sides[0].hand = []; g.drawCard(0); counts[g.sides[0].hand[0]] = (counts[g.sides[0].hand[0]] || 0) + 1; }
  const total = Object.values(F.CARDS).reduce((n, c) => n + c.weight, 0);
  for (const [name, c] of Object.entries(F.CARDS)) assert.ok(Math.abs(counts[name] / 4000 - c.weight / total) < .03, name);
});

test('recon reveals the whole enemy half for a while', () => {
  const g = fixture();
  const { x, y } = F.slotPos(1, 2, 0), home = F.lanePoint(2, 100);
  assert.equal(g.sees(0, x, y, 2), false, 'enemy back rows start hidden');
  assert.equal(g.sees(0, home.x, home.y, 2), true, 'own half is always visible');
  g.sides[0].hand = ['recon'];
  assert.ok(g.useCard(0, 0));
  assert.equal(g.sides[0].hand.length, 0);
  assert.equal(g.sees(0, x, y, 2), true);
  run(g, F.CARDS.recon.ticks);
  assert.equal(g.sees(0, x, y, 2), false);
});

test('a strike lands after its delay and hits anything inside the radius', () => {
  const g = fixture();
  const factory = g.build(1, 1, 2, 'factory'), turret = g.build(1, 1, 3, 'turret'), far = g.build(1, 0, 2, 'factory');
  g.sendEngineer(1, 1); Object.assign(g.engineers[0], { pos: factory.pos, target: factory.pos, x: (factory.x + turret.x) / 2, y: (factory.y + turret.y) / 2 });
  const own = g.build(0, 1, 4, 'radar');
  g.sides[0].hand = ['strike'];
  assert.equal(g.useCard(0, 0, {}), false, 'needs a target point');
  assert.ok(g.useCard(0, 0, { x: (factory.x + turret.x) / 2, y: (factory.y + turret.y) / 2 }));
  run(g, F.CARDS.strike.delay - 1);
  assert.ok(g.structure(1, factory.id), 'nothing happens before the delay');
  const drone = addDrone(g, 1, 1, factory.pos + 5, { hp: 999 });
  run(g, 1);
  assert.equal(g.structure(1, factory.id), null, 'factory destroyed');
  assert.equal(g.structure(1, turret.id).hp, F.STRUCTS.turret.hp - F.CARDS.strike.damage, 'turret survives damaged');
  assert.equal(g.structure(1, far.id).hp, F.STRUCTS.factory.hp, 'other lane untouched');
  assert.ok(!g.drones.includes(drone), 'drone in the blast downed');
  assert.equal(g.engineers.length, 0, 'engineer in the blast killed');
  assert.equal(g.structure(0, own.id).hp, F.STRUCTS.radar.hp, 'no friendly fire');
  assert.equal(g.sides[0].destroyed, 1);
});

test('jamming downs enemy drones in a lane and stalls factories there', () => {
  const g = fixture();
  const f = g.build(1, 0, 2, 'factory');
  addDrone(g, 1, 0, 700); addDrone(g, 1, 0, 600); const other = addDrone(g, 1, 1, 500);
  g.sides[0].hand = ['jam'];
  assert.equal(g.useCard(0, 0, { lane: 5 }), false);
  assert.ok(g.useCard(0, 0, { lane: 0 }));
  assert.deepEqual(plain(g.drones.map(d => d.id)), [other.id]);
  assert.equal(g.sides[0].kills, 2);
  const timer = f.timer;
  run(g, F.CARDS.jam.ticks - 1);
  assert.equal(f.timer, timer, 'factory clock frozen while jammed');
  assert.equal(g.sides[1].launched, 0);
});

test('airdrop adds supply', () => {
  const g = fixture();
  g.sides[0].hand = ['airdrop']; const before = g.sides[0].supply;
  assert.ok(g.useCard(0, 0));
  assert.equal(g.sides[0].supply, before + F.CARDS.airdrop.supply);
});

test('factories launch bursts of drones that each cost supply', () => {
  const g = fixture();
  g.build(0, 1, 2, 'factory');
  g.sides[0].supply = 100;
  run(g, 3 * F.TPS);
  assert.equal(g.sides[0].launched, 0, 'warm-up before the first burst');
  run(g, 1 + 2 * (F.STRUCTS.factory.gap + 1));
  assert.equal(g.sides[0].launched, F.STRUCTS.factory.wave);
  assert.equal(g.sides[0].supply, 100 + F.BASE_INCOME * Math.floor(g.tick / F.PAY_TICKS) - F.STRUCTS.factory.wave * F.STRUCTS.factory.droneCost);
  run(g, F.STRUCTS.factory.period - 2);
  assert.equal(g.sides[0].launched, F.STRUCTS.factory.wave, 'reloads between bursts');
  const starved = fixture();
  starved.build(0, 0, 0, 'factory'); starved.sides[0].supply = 0; starved.income = () => 0;
  run(starved, 3 * F.TPS + 10);
  assert.equal(starved.sides[0].launched, 0, 'no supply, no drones');
});

test('drones follow their lane, dogfight head-on, attack buildings and hit the base', () => {
  const g = fixture();
  const d = addDrone(g, 0, 0, 200);
  g.step();
  assert.equal(d.pos, 200 + F.DRONE.speed * F.DT);
  assert.deepEqual([d.x, d.y], [90, 630 - d.pos], 'drones follow the lane path');
  const a = addDrone(g, 0, 2, 400), b = addDrone(g, 1, 2, 410);
  g.step();
  assert.equal(a.pos, 400, 'engaged drones stop');
  assert.ok(Math.abs(a.hp - (F.DRONE.hp - F.DRONE.dogfight * F.DT)) < 1e-9 && a.hp === b.hp, 'damage is simultaneous');
  const s = g.build(1, 0, 4, 'factory');
  const hit = addDrone(g, 0, 0, s.pos - 5);
  g.step();
  assert.equal(hit.attacking, s.id);
  assert.equal(s.hp, F.STRUCTS.factory.hp - F.DRONE.damage * F.DT);
  const hq = g.sides[1].hq;
  const raid = addDrone(g, 0, 1, L(1) - F.BASE_REACH - 1);
  g.step();
  assert.equal(g.sides[1].hq, hq - F.DRONE.hqDamage);
  assert.ok(!g.drones.includes(raid), 'drone is spent on impact');
});

test('turrets shoot the closest threat and spend supply on every shell', () => {
  const g = fixture();
  const t = g.build(0, 1, 4, 'turret');
  const near = addDrone(g, 1, 1, t.pos + 30, { hp: 999 }), far = addDrone(g, 1, 1, t.pos + 100, { hp: 999 });
  addDrone(g, 0, 1, t.pos - 60, { hp: 999 });
  g.sides[0].supply = 10;
  g.step();
  assert.equal(near.hp < 999, true);
  assert.equal(far.hp, 999);
  assert.equal(g.sides[0].supply, 10 - F.STRUCTS.turret.ammo);
  g.sides[0].supply = 0; t.cooldown = 0;
  const hp = near.hp;
  g.step();
  assert.equal(near.hp, hp, 'no supply, no shells');
});

test('engineers walk to their lane, repair the most damaged building and expire', () => {
  const g = fixture();
  const a = g.build(0, 2, 0, 'turret'), b = g.build(0, 2, 1, 'radar');
  a.hp = 100; b.hp = 20;
  assert.ok(g.sendEngineer(0, 2));
  assert.equal(g.sendEngineer(0, 2), false, 'one engineer per lane');
  assert.ok(g.sendEngineer(0, 1), 'another lane is fine');
  run(g, 60);
  assert.ok(b.hp > 20 && a.hp === 100, 'worst building first');
  run(g, F.ENGINEER.duration);
  assert.equal(g.engineers.length, 0);
  assert.ok(g.sendEngineer(0, 2), 'lane free again after it leaves');
  g.sides[0].supply = 0;
  assert.equal(g.canSendEngineer(0, 0), false, 'costs supply');
});

test('radars and drones lift fog only where they are', () => {
  const g = fixture();
  const enemy = g.build(1, 0, 0, 'factory');
  assert.equal(g.sees(0, enemy.x, enemy.y, 0), false);
  const radar = g.build(0, 0, 0, 'radar');
  assert.equal(g.sees(0, enemy.x, enemy.y, 0), true);
  const mid = F.lanePoint(1, L(1) - 170);
  assert.equal(g.sees(0, mid.x, mid.y, 1), false, 'a radar only covers its own lane');
  g.sell(0, radar.id);
  addDrone(g, 0, 1, L(1) / 2 + 50);
  const close = F.lanePoint(1, L(1) / 2 + 100), deep = F.lanePoint(1, L(1) - 100);
  assert.equal(g.sees(0, close.x, close.y, 1), true);
  assert.equal(g.sees(0, deep.x, deep.y, 1), false);
});

test('fog follows what each side owns, not a fixed half', () => {
  const g = fixture();
  const corner = { x: 40, y: 380 };
  assert.ok(F.ownHalf(0, corner.x, corner.y));
  assert.equal(g.sees(0, corner.x, corner.y, -1), false, 'own territory with nothing nearby is fogged');
  const near = F.lanePoint(2, 60);
  assert.equal(g.sees(0, near.x, near.y, 2), true, 'the base sees around itself');
  const t = g.build(0, 0, 4, 'turret');
  assert.equal(g.sees(0, corner.x, t.y - F.VISION.turret + 5, -1), true, 'a building sees around itself');
  const raider = addDrone(g, 1, 0, 420);
  g.sell(0, t.id);
  assert.equal(g.observation(0).enemyDrones.some(d => d.id === raider.id), false, 'an enemy drone outside your sight stays hidden even on your half');
  g.sendEngineer(0, 0); Object.assign(g.engineers[0], { x: raider.x, y: raider.y + 30 });
  assert.equal(g.observation(0).enemyDrones.some(d => d.id === raider.id), true, 'engineers see too');
});

test('intel keeps ghosts of seen buildings until the spot is seen empty', () => {
  const g = fixture();
  const enemy = g.build(1, 0, 0, 'factory');
  g.sides[0].hand = ['recon']; g.useCard(0, 0);
  g.step();
  assert.ok(g.intel[0].has(enemy.id));
  run(g, F.CARDS.recon.ticks);
  g.removeStructure(enemy, false);
  g.step();
  assert.ok(g.intel[0].has(enemy.id), 'not seen, so the ghost stays');
  assert.ok(g.observation(0).enemyKnown[0].age > 0);
  g.build(0, 0, 0, 'radar');
  g.step();
  assert.equal(g.intel[0].has(enemy.id), false, 'seen empty, so the ghost is gone');
});

test('the AI only reads what its side can see', () => {
  const setup = extra => {
    const g = new F.Game({ seed: 'fog', ai: [false, true] }); g.start();
    g.sides[1].supply = 400; g.tick = 2000;
    g.build(0, 1, 4, 'turret');
    if (extra) { g.build(0, 0, 0, 'factory'); g.build(0, 2, 1, 'depot'); }
    g.updateIntel(1);
    return g;
  };
  const plainObs = setup(false).observation(1), extraObs = setup(true).observation(1);
  assert.deepEqual(plain(extraObs.enemyKnown), plain(plainObs.enemyKnown), 'hidden buildings stay out of the observation');
  const plan = obs => plain(F.planAI(obs, F.PROFILES.hard, F.seededRandom('same')));
  assert.deepEqual(plan(extraObs), plan(plainObs), 'hidden buildings do not change the plan');
  const g = setup(true);
  g.sides[1].revealUntil = g.tick + 100; g.updateIntel(1);
  assert.equal(g.observation(1).enemyKnown.length, 3, 'revealed buildings are seen');
});

test('the strike AI aims at fresh intel clusters and only guesses with a full hand', () => {
  const obs = { side: 0, tick: 1000, hand: ['strike'], enemyKnown: [] };
  assert.equal(F.strikeTarget(obs, F.PROFILES.hard, () => .5), null);
  const p = F.slotPos(1, 2, 2);
  obs.enemyKnown = [{ type: 'factory', x: p.x, y: p.y, hp: 120, age: 10 }];
  assert.deepEqual(plain(F.strikeTarget(obs, F.PROFILES.hard, () => .5)), { x: p.x, y: p.y });
  obs.enemyKnown[0].age = 30 * F.TPS;
  assert.equal(F.strikeTarget(obs, F.PROFILES.hard, () => .5), null, 'old intel is ignored');
  obs.hand = ['strike', 'jam', 'airdrop'];
  const guess = F.lanePoint(1, L(1) - (F.ROWS[1] + F.ROWS[2]) / 2);
  assert.deepEqual(plain(F.strikeTarget(obs, F.PROFILES.hard, () => .5)), { x: guess.x, y: guess.y }, 'blind guess with a full hand');
  assert.equal(F.strikeTarget(obs, F.PROFILES.easy, () => .5), null, 'easy never guesses');
});

test('the round ends on a destroyed HQ, a double KO or the time limit', () => {
  const g = fixture();
  g.sides[1].hq = 0; g.step();
  assert.equal(g.phase, 'over');
  assert.equal(g.result.winner, 0);
  const draw = fixture();
  draw.sides[0].hq = draw.sides[1].hq = 0; draw.step();
  assert.equal(draw.result.winner, null);
  const timeout = fixture();
  timeout.tick = F.TIME_LIMIT - 1; timeout.sides[0].hq = 50; timeout.sides[1].hq = 60; timeout.step();
  assert.equal(timeout.result.winner, 1);
  const even = fixture();
  even.tick = F.TIME_LIMIT - 1; even.step();
  assert.equal(even.result.winner, null);
});

test('pausing freezes the simulation', () => {
  const g = fixture();
  run(g, 50); g.pause();
  const frozen = JSON.stringify([g.tick, g.sides, g.drones]);
  g.step();
  assert.equal(JSON.stringify([g.tick, g.sides, g.drones]), frozen);
});

test('matches are deterministic for a seed', () => {
  const a = play({ seed: 'det', difficulty: ['normal', 'hard'] }).g, b = play({ seed: 'det', difficulty: ['normal', 'hard'] }).g;
  assert.deepEqual(plain(a.result), plain(b.result));
  assert.notDeepEqual(plain(play({ seed: 'det2', difficulty: ['normal', 'hard'] }).g.result), plain(a.result));
});

test('AI mirror matches use every system and finish within the time limit', () => {
  const wins = [0, 0], used = { types: new Set(), engineers: 0, bombs: 0, cards: 0, destroyed: 0 };
  for (let i = 0; i < 8; i++) {
    const { g } = play({ seed: 'mirror' + i, difficulty: ['normal', 'normal'] });
    assert.ok(g.result.tick <= F.TIME_LIMIT);
    if (g.result.winner !== null) wins[g.result.winner]++;
    for (const s of g.sides) { used.bombs += s.bombs; used.cards += s.cardsUsed; used.destroyed += s.destroyed; }
    for (const s of g.sides) for (const x of s.structures) used.types.add(x.type);
  }
  assert.deepEqual([...used.types].sort(), ['depot', 'factory', 'radar', 'turret']);
  assert.ok(used.bombs > 8 && used.cards > 30 && used.destroyed > 30, JSON.stringify({ ...used, types: undefined }));
  assert.ok(Math.min(...wins) >= 2, `both seats win sometimes: ${wins}`);
});

test('harder AI beats easier AI across swapped seats', () => {
  const series = (strong, weak, seeds) => {
    let won = 0, games = 0;
    for (let i = 0; i < seeds; i++) for (const swap of [false, true]) {
      const difficulty = swap ? [weak, strong] : [strong, weak];
      const { g } = play({ seed: 'ladder' + i, difficulty });
      games++; if (g.result.winner === (swap ? 1 : 0)) won++;
    }
    return won / games;
  };
  const hard = series('hard', 'normal', 6), normal = series('normal', 'easy', 6);
  assert.ok(hard >= .6, `hard beats normal ${hard}`);
  assert.ok(normal >= .7, `normal beats easy ${normal}`);
});

// ---------- Options added with the full-screen version: every one defaults to the original rules. ----------
test('new options default to the original rules', () => {
  const g = new F.Game();
  assert.deepEqual(plain(g.rules), { modifiers: [], hqHp: F.HQ_HP, baseIncome: F.BASE_INCOME, droneHp: F.DRONE.hp, timeLimit: F.TIME_LIMIT, storm: false, clear: false });
  assert.deepEqual(plain(g.doctrine[0]), plain(F.doctrineRules(null)));
  assert.equal(g.sides[0].supply, F.START_SUPPLY);
  assert.equal(g.cost(0, 'radar'), F.STRUCTS.radar.cost); assert.equal(g.engineerCost(0), F.ENGINEER.cost);
  const a = play({ seed: 'defaults', difficulty: ['normal', 'hard'] }).g;
  const b = play({ seed: 'defaults', difficulty: ['normal', 'hard'], modifiers: [], doctrine: [null, null] }).g;
  assert.deepEqual(plain(a.result), plain(b.result));
  assert.deepEqual(plain(a.result.upgrades), [0, 0], 'only the elite AI upgrades');
});

test('upgrades cost supply, add 30% max HP once and strengthen each building', () => {
  const g = fixture();
  const f = g.build(0, 1, 2, 'factory'), t = g.build(0, 1, 4, 'turret'), r = g.build(0, 0, 0, 'radar'), d = g.build(0, 2, 0, 'depot');
  f.hp = 100;
  const before = g.sides[0].supply;
  assert.ok(g.upgrade(0, f.id));
  assert.equal(g.sides[0].supply, before - F.UPGRADES.factory.cost);
  assert.equal(f.level, 2); assert.equal(f.maxHp, 156); assert.equal(f.hp, 136, 'the added max HP is healed at once');
  assert.equal(f.invested, F.STRUCTS.factory.cost + F.UPGRADES.factory.cost);
  assert.equal(g.upgrade(0, f.id), false, 'one level only');
  assert.equal(g.turretRange(0, t), 140); assert.ok(g.upgrade(0, t.id)); assert.equal(g.turretRange(0, t), 160);
  assert.equal(g.visionOf(r), 170); assert.ok(g.upgrade(0, r.id)); assert.equal(g.visionOf(r), 250);
  const income = g.income(0); assert.ok(g.upgrade(0, d.id)); assert.equal(g.income(0), income + F.UPGRADES.depot.income);
  assert.equal(g.sides[0].upgrades, 4);
  const supply = g.sides[0].supply; g.sell(0, f.id);
  assert.equal(g.sides[0].supply, supply + 55, 'selling refunds half of the build and the upgrade');
  const poor = g.build(0, 0, 1, 'turret'); g.sides[0].supply = F.UPGRADES.turret.cost - 1;
  assert.equal(g.upgrade(0, poor.id), false, 'needs the supply');
  assert.equal(g.upgrade(1, poor.id), false, 'only your own buildings');
  g.sides[0].supply = 100; g.pause();
  assert.equal(g.upgrade(0, poor.id), false, 'not while paused');
});

test('an upgraded turret hits harder and farther; a level-2 factory launches five per burst', () => {
  const g = fixture();
  const t = g.build(0, 1, 4, 'turret'); g.upgrade(0, t.id);
  const drone = addDrone(g, 1, 1, t.pos + 150, { hp: 999 });
  g.step();
  assert.ok(Math.hypot(drone.x - t.x, drone.y - t.y) > F.STRUCTS.turret.range, 'out of the base range');
  assert.equal(drone.hp, 999 - F.UPGRADES.turret.damage);
  const h = fixture();
  const f = h.build(0, 1, 2, 'factory'); h.upgrade(0, f.id);
  run(h, 3 * F.TPS + 1 + 4 * (F.STRUCTS.factory.gap + 1));
  assert.equal(h.sides[0].launched, F.UPGRADES.factory.wave);
  run(h, F.STRUCTS.factory.period - 2);
  assert.equal(h.sides[0].launched, F.UPGRADES.factory.wave, 'then reloads');
});

test('match modifiers change the shared rules for both sides', () => {
  const g = new F.Game({ ai: [false, false], modifiers: ['armored', 'scarcity', 'blitz', 'fortress'] });
  assert.equal(g.rules.hqHp, 240); assert.deepEqual(plain(g.sides.map(s => s.hq)), [240, 240]);
  assert.equal(g.rules.timeLimit, 5 * 60 * F.TPS);
  assert.equal(g.income(0), 3); assert.equal(g.income(1), 3);
  g.start(); g.build(0, 1, 2, 'factory'); g.build(1, 1, 2, 'factory');
  run(g, 3 * F.TPS + 1);
  assert.deepEqual(plain(g.drones.map(d => d.hp)), [54, 54]);
  assert.equal(new F.Game({ modifiers: ['blitz'] }).rules.hqHp, 150);
  assert.equal(new F.Game({ modifiers: ['fortress'] }).rules.hqHp, 320);
  assert.deepEqual(plain(new F.Game({ modifiers: ['nope', 'clear'] }).rules.modifiers), ['clear'], 'unknown ids are ignored');
  const blitz = fixture({ modifiers: ['blitz'] });
  blitz.tick = 5 * 60 * F.TPS - 1; blitz.sides[0].hq = 100; blitz.step();
  assert.equal(blitz.phase, 'over'); assert.equal(blitz.result.winner, 1); assert.equal(blitz.result.timeout, true); assert.equal(blitz.result.hqMax, 150);
  const clear = fixture({ modifiers: ['clear'] }), p = F.slotPos(1, 2, 0);
  assert.equal(clear.sees(0, p.x, p.y, 2), true); assert.equal(clear.sees(1, 40, 380, -1), true, 'both sides see everything');
});

test('storms sweep one seeded lane every 45 s, jamming both sides there and scorching drones', () => {
  const g = fixture({ seed: 'storm', modifiers: ['storm'] });
  run(g, F.STORM.every - 1);
  assert.equal(g.storm, null);
  const mine = [0, 1, 2].map(lane => addDrone(g, 0, lane, 300, { hp: 20 }));
  const theirs = [0, 1, 2].map(lane => addDrone(g, 1, lane, 700, { hp: 10 }));
  g.step();
  const lane = g.storm.lane;
  for (const side of [0, 1]) assert.equal(g.sides[side].jammed[lane], g.tick + F.STORM.ticks);
  for (const l of [0, 1, 2]) {
    assert.equal(mine[l].hp, l === lane ? 20 - F.STORM.damage : 20);
    assert.equal(g.drones.includes(theirs[l]), l !== lane);
  }
  assert.ok(g.events.some(e => e.type === 'storm' && e.lane === lane && e.downed === 1));
  assert.equal(g.sides[0].kills + g.sides[1].kills, 0, 'storm kills count for nobody');
  const again = fixture({ seed: 'storm', modifiers: ['storm'] }); run(again, F.STORM.every);
  assert.equal(again.storm.lane, lane, 'the storm lane comes from the seed');
  const calm = fixture({ seed: 'storm' }); run(calm, F.STORM.every);
  assert.equal(calm.storm, null);
});

test('doctrines change only their own side', () => {
  assert.deepEqual(plain(new F.Game({ doctrine: ['logistics', null] }).sides.map(s => s.supply)), [F.START_SUPPLY + 30, F.START_SUPPLY]);
  const g = fixture({ doctrine: ['logistics', 'intel'] });
  assert.equal(g.engineerCost(0), 15); assert.equal(g.engineerCost(1), F.ENGINEER.cost);
  const s0 = g.sides[0].supply; g.sendEngineer(0, 1); assert.equal(g.sides[0].supply, s0 - 15);
  g.build(0, 0, 0, 'depot'); assert.equal(g.income(0), F.BASE_INCOME + 3);
  g.build(1, 0, 0, 'depot'); assert.equal(g.income(1), F.BASE_INCOME + F.STRUCTS.depot.income);
  assert.equal(g.cost(1, 'radar'), 20); assert.equal(g.cost(0, 'radar'), F.STRUCTS.radar.cost);
  const s1 = g.sides[1].supply; g.build(1, 1, 0, 'radar'); assert.equal(g.sides[1].supply, s1 - 20);
  assert.equal(g.observation(1).costs.radar, 20, 'the AI plans with its own prices');
  run(g, F.FIRST_CARD + 15 * F.TPS - g.tick);
  assert.equal(g.sides[1].hand.length, 2, 'intel draws every 15 s'); assert.equal(g.sides[0].hand.length, 1);
  g.sides[1].hand = ['recon']; g.useCard(1, 0);
  assert.equal(g.sides[1].revealUntil, g.tick + 12 * F.TPS);
  const w = fixture({ doctrine: ['bulwark', 'siege'] });
  const t = w.build(0, 2, 5, 'turret'), s = w.build(0, 0, 4, 'factory');
  assert.equal(t.maxHp, 192); assert.equal(s.maxHp, 144); assert.equal(w.turretRange(0, t), 165); assert.equal(w.turretRange(1), 140);
  addDrone(w, 1, 0, s.pos + 5);
  w.step();
  assert.ok(Math.abs(s.hp - (144 - F.DRONE.damage * F.DT * 1.3)) < 1e-9, 'siege drones hit buildings 30% harder');
  const hq = w.sides[0].hq;
  addDrone(w, 1, 1, F.BASE_REACH + 1); w.step();
  assert.equal(w.sides[0].hq, hq - 6); assert.equal(w.sides[0].hqLost, 6);
});

test('elite AI buys upgrades and beats hard across swapped seats', () => {
  let won = 0, games = 0, upgrades = 0;
  for (let i = 0; i < 5; i++) for (const swap of [false, true]) {
    const { g } = play({ seed: 'elite' + i, difficulty: swap ? ['hard', 'elite'] : ['elite', 'hard'] });
    games++; if (g.result.winner === (swap ? 1 : 0)) won++;
    upgrades += g.result.upgrades[swap ? 1 : 0];
    assert.equal(g.result.upgrades[swap ? 0 : 1], 0, 'hard never upgrades');
  }
  assert.ok(upgrades > games, `elite upgrades ${upgrades}`);
  assert.ok(won / games >= .6, `elite beats hard ${won}/${games}`);
});

// ---------- Career progression ----------
test('career levels, ranks and unlocks', () => {
  assert.deepEqual(plain(C.levelOf(0)), { level: 1, into: 0, need: 160, max: false });
  assert.equal(C.levelOf(159).level, 1); assert.equal(C.levelOf(160).level, 2);
  assert.deepEqual(plain(C.levelOf(160 + 200 + 5)), { level: 3, into: 5, need: 240, max: false });
  assert.equal(C.levelOf(-50).level, 1); assert.equal(C.levelOf('junk').level, 1);
  assert.deepEqual(plain(C.levelOf(1e9)), { level: C.MAX_LEVEL, into: 0, need: 0, max: true });
  assert.equal(C.rankOf(1), '列兵'); assert.equal(C.rankOf(5), '中士'); assert.equal(C.rankOf(C.MAX_LEVEL), '將軍');
  assert.equal(C.unlocked(1, 'difficulty', 'hard'), true, 'the original three difficulties are open from the start');
  assert.equal(C.unlocked(4, 'difficulty', 'elite'), false); assert.equal(C.unlocked(5, 'difficulty', 'elite'), true);
  assert.equal(C.unlocked(1, 'modifier', 'armored'), true); assert.equal(C.unlocked(6, 'modifier', 'storm'), false);
  for (const u of C.UNLOCKS) assert.ok(u.kind === 'doctrine' ? F.DOCTRINES[u.id] : u.kind === 'modifier' ? F.MODIFIERS[u.id] : F.PROFILES[u.id], u.id);
  for (const o of C.OPERATIONS) {
    assert.ok(F.PROFILES[o.difficulty], o.id);
    for (const m of o.modifiers) assert.ok(F.MODIFIERS[m], o.id + ' ' + m);
    assert.ok(o.ai === null || F.DOCTRINES[o.ai], o.id);
  }
  assert.equal(C.OPERATIONS.length, 8);
});

test('match XP scales with AI difficulty and modifiers', () => {
  const win = { winner: 0, timeout: false, difficulty: 'normal', modifiers: [], destroyed: 5, kills: 23, hq: 150, hqMax: 200 };
  const x = C.matchXP(win);
  assert.deepEqual(plain(x.lines), [['完成一局', 20], ['勝利', 60], ['摧毀建築 × 5', 20], ['擊落無人機', 8], ['守住大本營', 15]]);
  assert.equal(x.total, 123); assert.equal(x.mult, 1);
  assert.equal(C.matchXP({ ...win, difficulty: 'hard', modifiers: ['storm'] }).total, Math.round(123 * 1.62));
  assert.equal(C.matchXP({ ...win, difficulty: 'easy' }).total, Math.round(123 * .7));
  assert.equal(C.matchXP({ ...win, winner: 1 }).total, 48, 'a loss still pays for the fight');
  assert.equal(C.matchXP({ ...win, winner: null }).total, 73);
  assert.equal(C.matchXP({ ...win, kills: 1000 }).lines.find(l => l[0] === '擊落無人機')[1], 40, 'drone XP is capped');
  assert.equal(C.modMult(['clear']), .75); assert.equal(C.modMult([]), 1);
  assert.ok(C.DIFF_XP.easy < C.DIFF_XP.normal && C.DIFF_XP.normal < C.DIFF_XP.hard && C.DIFF_XP.hard < C.DIFF_XP.elite);
});

test('operations award stars, unlock in order and pay campaign bonuses once', () => {
  const base = { difficulty: 'easy', modifiers: [], destroyed: 0, kills: 0, hqMax: 200, operation: 'outpost' };
  assert.deepEqual(plain(C.stars({ ...base, winner: 0, timeout: false, hq: 120 })), [true, true, true]);
  assert.deepEqual(plain(C.stars({ ...base, winner: 0, timeout: true, hq: 100 })), [true, false, false]);
  assert.deepEqual(plain(C.stars({ ...base, winner: 1, timeout: false, hq: 0 })), [false, false, false]);
  let p = C.blank();
  assert.equal(C.opUnlocked(p, 0), true); assert.equal(C.opUnlocked(p, 1), false);
  const first = C.recordMatch(p, { ...base, winner: 0, timeout: true, hq: 100 });
  assert.equal(first.firstClear, true); assert.equal(first.newStars, 1);
  assert.equal(first.gain.total, Math.round(90 * .7) + 80 + 30);
  p = first.profile;
  assert.equal(p.ops.outpost, 1); assert.equal(C.opUnlocked(p, 1), true); assert.equal(C.opUnlocked(p, 2), false);
  const better = C.recordMatch(p, { ...base, winner: 0, timeout: false, hq: 200 });
  assert.equal(better.firstClear, false); assert.equal(better.newStars, 2);
  assert.ok(better.gain.lines.some(l => l[0] === '新星章 × 2' && l[1] === 60));
  p = better.profile; assert.equal(p.ops.outpost, 3); assert.equal(C.totalStars(p), 3);
  assert.equal(p.wins, 2); assert.equal(p.streak, 2); assert.equal(p.bestStreak, 2);
  const lost = C.recordMatch(p, { ...base, winner: 1, timeout: false, hq: 0 });
  assert.equal(lost.profile.ops.outpost, 3, 'stars are never lost'); assert.equal(lost.profile.streak, 0); assert.equal(lost.profile.losses, 1);
  assert.equal(lost.gain.lines.some(l => /首次|新星章/.test(l[0])), false);
  const skirmish = C.recordMatch(C.blank(), { ...base, operation: null, winner: null, timeout: true, hq: 200 });
  assert.equal(skirmish.profile.draws, 1); assert.deepEqual(plain(skirmish.profile.ops), {});
  const up = C.recordMatch({ ...C.blank(), xp: 150 }, { ...base, operation: null, difficulty: 'elite', winner: 0, timeout: false, hq: 200 });
  assert.equal(up.after.level, 2); assert.deepEqual(plain(up.unlocked.map(u => u.id)), ['logistics']); assert.equal(up.profile.eliteWins, 1);
});

test('the saved career survives bad or missing storage', () => {
  assert.deepEqual(plain(C.sanitize({ xp: -5, wins: 'x', matches: 3.7, ops: { outpost: 9, valley: 0, nope: 2 } })), { ...plain(C.blank()), matches: 3, ops: { outpost: 3 } });
  const mem = new Map(), storage = { getItem: k => mem.has(k) ? mem.get(k) : null, setItem: (k, v) => mem.set(k, String(v)) };
  assert.deepEqual(plain(C.load(storage)), plain(C.blank()));
  const p = { ...C.blank(), xp: 420, wins: 3, ops: { outpost: 2 } };
  assert.ok(C.save(storage, p)); assert.deepEqual(plain(C.load(storage)), plain(p));
  mem.set(C.KEY, '{broken'); assert.deepEqual(plain(C.load(storage)), plain(C.blank()));
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.deepEqual(plain(C.load(broken)), plain(C.blank())); assert.equal(C.save(broken, p), false);
});

test('the page uses the full-screen Vermilion Ink shell, local fonts and no network', () => {
  assert.match(html, /<link rel="stylesheet" href="shared\/fu\.css">/);
  assert.match(html, /<body class="fu-app[^"]*">/);
  assert.match(html, /<header class="fu-topbar">/);
  assert.match(html, /<a class="fu-brand" href="index\.html"[^>]*><span class="fu-seal" aria-hidden="true">福遊<\/span>/);
  assert.match(html, /<main class="fu-stage"[^>]*><canvas id="board"/);
  for (const id of ['war', 'dock', 'curtain', 'drawer', 'status', 'op-picks', 'doc-picks', 'mod-picks', 'xp-lines']) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /<aside class="fu-drawer" id="drawer"/); assert.match(html, /<div class="fu-curtain" id="curtain"/);
  assert.doesNotMatch(html, /fulab-theme\.css|play-panel|<details|site-nav|page-header/);
  assert.doesNotMatch(html, /PMingLiU|MingLiU/);
  assert.match(html, /import \{ fonts, loadFonts \} from '\.\/shared\/fu-three\.js';/);
  assert.match(html, /loadFonts\('/); assert.match(html, /fonts\.display/); assert.match(html, /fonts\.mono/);
  assert.doesNotMatch(html, /https?:\/\/|fetch\(|XMLHttpRequest|WebSocket/);
});
