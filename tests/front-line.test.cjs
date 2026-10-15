'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'front_line.html'), 'utf8');
const F = vm.runInNewContext(html.match(/<script id="front-engine">([\s\S]*?)<\/script>/)[1] + '; FrontLine;');
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
function play({ onEvent, ...options }) {
  const g = new F.Game({ ai: [true, true], ...options }); g.start();
  let peak = 0;
  while (g.phase === 'running') {
    g.step();
    if (onEvent) for (const e of g.events) onEvent(e);
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

function readyHeroes(g, side = 0) { for (const k of Object.keys(F.HEROES)) g.sides[side].heroReady[k] = 0; }

test('heavy equipment costs supply, has its own recharge and starts locked', () => {
  const g = fixture();
  assert.equal(g.deploy(0, 'tank', { lane: 1 }), null, 'locked for the opening seconds');
  g.tick = F.FIRST_HERO;
  const before = g.sides[0].supply, tank = g.deploy(0, 'tank', { lane: 1 });
  assert.ok(tank);
  assert.equal(g.sides[0].supply, before - F.HEROES.tank.cost);
  assert.equal(g.deploy(0, 'tank', { lane: 2 }), null, 'recharging');
  assert.ok(g.deploy(0, 'sniper', { lane: 2 }), 'other types have their own timers');
  assert.equal(g.deploy(0, 'heavy', { lane: 3 }), null, 'needs a real lane');
  g.sides[0].supply = 10;
  assert.equal(g.deploy(0, 'heavy', { lane: 0 }), null, 'needs supply');
  assert.equal(g.sides[0].heroReady.tank, F.FIRST_HERO + F.HEROES.tank.recharge);
  assert.deepEqual([tank.x, tank.y], [plain(F.lanePoint(1, 50)).x, plain(F.lanePoint(1, 50)).y], 'it rolls out of the base');
});

test('a tank drives down its lane and stops to shell what it meets', () => {
  const g = fixture(); readyHeroes(g);
  const tank = g.deploy(0, 'tank', { lane: 0 });
  g.step();
  assert.ok(Math.abs(tank.pos - (50 + F.HEROES.tank.speed * F.DT)) < 1e-9);
  const target = g.build(1, 0, 4, 'factory');
  tank.pos = target.pos - 40; Object.assign(tank, plain(F.lanePoint(0, tank.pos)));
  const pos = tank.pos;
  g.step();
  assert.equal(tank.pos, pos, 'stops while a target is in range');
  assert.equal(target.hp, F.STRUCTS.factory.hp - F.HEROES.tank.damage);
  const drone = addDrone(g, 1, 0, pos + 10, { hp: 999 });
  run(g, F.HEROES.tank.reload);
  assert.ok(drone.hp < 999, 'it shoots drones before buildings');
  assert.ok(tank.hp < F.HEROES.tank.hp, 'drones swarm a tank blocking their lane');
});

test('heavy drones fly over the swarm, bomb buildings and are grounded by jamming', () => {
  const g = fixture(); readyHeroes(g);
  const heavy = g.deploy(0, 'heavy', { lane: 2 });
  addDrone(g, 1, 2, heavy.pos + 5, { hp: 999 });
  const pos = heavy.pos;
  g.step();
  assert.ok(heavy.pos > pos, 'enemy drones neither stop nor hurt it');
  assert.equal(heavy.hp, F.HEROES.heavy.hp);
  const target = g.build(1, 2, 2, 'radar');
  heavy.pos = target.pos - 10; Object.assign(heavy, plain(F.lanePoint(2, heavy.pos)));
  g.step();
  assert.equal(target.hp, F.STRUCTS.radar.hp - F.HEROES.heavy.damage);
  g.sides[1].hand = ['jam']; g.useCard(1, 0, { lane: 2 });
  const reload = heavy.reload;
  g.step();
  assert.equal(heavy.reload, reload, 'a jammed lane freezes it');
});

test('snipers outrange everything and hunt heavy equipment first', () => {
  const g = fixture(); readyHeroes(g); readyHeroes(g, 1);
  const sniper = g.deploy(0, 'sniper', { lane: 1 }), tank = g.deploy(1, 'tank', { lane: 1 });
  tank.pos = sniper.pos + 180; Object.assign(tank, plain(F.lanePoint(1, tank.pos)));
  addDrone(g, 1, 1, sniper.pos + 60, { hp: 999 });
  g.step();
  assert.equal(tank.hp, F.HEROES.tank.hp - F.HEROES.sniper.damage, 'shot the tank, not the closer drone');
  assert.ok(F.HEROES.sniper.range > F.HEROES.tank.range && F.HEROES.sniper.range > F.STRUCTS.turret.range);
});

test('artillery pods land only where you can see, fire on their own and expire', () => {
  const g = fixture(); readyHeroes(g);
  const blind = F.slotPos(1, 1, 0);
  assert.equal(g.deploy(0, 'artillery', blind), null, 'not into the fog');
  g.build(0, 1, 0, 'radar');
  const spot = F.lanePoint(1, 240), pod = g.deploy(0, 'artillery', { x: spot.x, y: spot.y });
  assert.ok(pod);
  const drone = addDrone(g, 1, 1, 330, { hp: 999 });
  run(g, F.HEROES.artillery.drop);
  assert.equal(drone.hp, 999, 'still falling');
  run(g, 2);
  assert.ok(drone.hp < 999, 'it opens fire once it lands');
  run(g, F.HEROES.artillery.life);
  assert.ok(!g.heroes.includes(pod), 'and expires');
});

test('turrets, base guns and strikes hit heavy equipment; heavy equipment gives sight', () => {
  const g = fixture(); readyHeroes(g, 1);
  const t = g.build(0, 1, 4, 'turret');
  const tank = g.deploy(1, 'tank', { lane: 1 });
  tank.pos = t.pos + 60; Object.assign(tank, plain(F.lanePoint(1, tank.pos)));
  g.step();
  assert.ok(tank.hp <= F.HEROES.tank.hp - F.STRUCTS.turret.damage);
  const g2 = fixture(); readyHeroes(g2, 1);
  const raider = g2.deploy(1, 'sniper', { lane: 2 });
  raider.pos = 60; Object.assign(raider, plain(F.lanePoint(2, 60)));
  g2.step();
  assert.ok(raider.hp < F.HEROES.sniper.hp, 'the base defends itself');
  const g3 = fixture(); readyHeroes(g3);
  const tank3 = g3.deploy(0, 'tank', { lane: 1 });
  tank3.pos = 500; Object.assign(tank3, plain(F.lanePoint(1, 500)));
  const ahead = F.lanePoint(1, 580);
  assert.equal(g3.sees(0, ahead.x, ahead.y, 1), true, 'it lights the fog around it');
  g3.sides[1].hand = ['strike']; g3.useCard(1, 0, { x: tank3.x, y: tank3.y });
  run(g3, F.CARDS.strike.delay);
  assert.ok(tank3.hp <= F.HEROES.tank.hp - F.CARDS.strike.damage);
});

test('heavy equipment that reaches the enemy base besieges it', () => {
  const g = fixture(); readyHeroes(g);
  const tank = g.deploy(0, 'tank', { lane: 1 });
  tank.pos = L(1) - F.BASE_REACH - 10; Object.assign(tank, plain(F.lanePoint(1, tank.pos)));
  tank.hp = 1e6;
  run(g, F.HEROES.tank.reload + 1);
  assert.ok(g.sides[1].hq <= F.HQ_HP - F.HEROES.tank.hq);
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
  const wins = [0, 0], used = { types: new Set(), heroes: new Set(), engineers: 0, bombs: 0, cards: 0, destroyed: 0 };
  for (let i = 0; i < 8; i++) {
    const { g } = play({ seed: 'mirror' + i, difficulty: ['normal', 'normal'], onEvent: e => { if (e.type === 'deploy') used.heroes.add(e.kind); } });
    assert.ok(g.result.tick <= F.TIME_LIMIT);
    if (g.result.winner !== null) wins[g.result.winner]++;
    for (const s of g.sides) { used.bombs += s.bombs; used.cards += s.cardsUsed; used.destroyed += s.destroyed; }
    for (const s of g.sides) for (const x of s.structures) used.types.add(x.type);
  }
  assert.deepEqual([...used.types].sort(), ['depot', 'factory', 'radar', 'turret']);
  assert.deepEqual([...used.heroes].sort(), ['artillery', 'heavy', 'sniper', 'tank'], 'the AI fields every kind of heavy equipment');
  assert.ok(used.bombs > 8 && used.cards > 30 && used.destroyed > 30, JSON.stringify({ ...used, types: undefined, heroes: undefined }));
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
