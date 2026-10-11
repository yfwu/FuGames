'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const E = require(process.env.TUX2D_ENGINE || path.resolve(__dirname, '../tux2d-engine.js'));
const snapshot = g => JSON.parse(JSON.stringify(g));
const controls = i => ({ throttle: 1, brake: i % 240 > 205 ? 0.3 : 0,
  steer: Math.sin(i / 53) * 0.55, drift: i % 180 < 75, useItem: i % 151 === 0 });
function race(seed = 'tux-fixture', spectator = false) {
  const g = new E.Game({ seed, spectator });
  g.start();
  for (let i = 0; i < Math.ceil(3 / E.DT) + 2 && g.phase === 'countdown'; i++) g.step({});
  assert.equal(g.phase, 'racing');
  return g;
}

test('the closed track has finite ordered samples and twelve distinct checkpoint gates', () => {
  assert.equal(E.DT, 1 / 60);
  assert.equal(E.LAPS, 3);
  assert.equal(E.TRACK.checkpoints.length, 12);
  assert.ok(E.TRACK.length > 1000);
  assert.ok(E.TRACK.halfWidth > 0 && E.TRACK.barrier > E.TRACK.halfWidth);
  for (const p of E.TRACK.samples) for (const key of ['x', 'y', 's', 'tx', 'ty']) assert.ok(Number.isFinite(p[key]), key);
  for (let i = 1; i < E.TRACK.samples.length; i++) assert.ok(E.TRACK.samples[i].s > E.TRACK.samples[i - 1].s);
  const p = E.pointAt(E.TRACK.length * 0.37);
  const projection = E.project(p.x, p.y);
  assert.ok(Number.isFinite(projection.s));
  assert.ok(Math.abs(projection.s - E.TRACK.length * 0.37) < 3);
});

test('ready, paused and finished phases never advance simulation time or objects', () => {
  const g = new E.Game({ seed: 'clock' });
  let before = snapshot(g);
  for (let i = 0; i < 120; i++) g.step(controls(i));
  assert.deepEqual(snapshot(g), before);
  g.start();
  for (let i = 0; i < 45; i++) g.step({ throttle: 1 });
  assert.equal(g.phase, 'countdown');
  g.pause();
  before = snapshot(g);
  for (let i = 0; i < 600; i++) g.step(controls(i));
  assert.deepEqual(snapshot(g), before);
  g.start();
  assert.equal(g.phase, 'countdown');
  for (let i = 0; i < 180 && g.phase === 'countdown'; i++) g.step({});
  assert.equal(g.phase, 'racing');
  const elapsed = g.elapsed;
  g.step({ throttle: 1 });
  assert.ok(Math.abs(g.elapsed - elapsed - E.DT) < 1e-9);
  g.pause();
  before = snapshot(g);
  for (let i = 0; i < 120; i++) g.step(controls(i));
  assert.deepEqual(snapshot(g), before);
  g.phase = 'over';
  before = snapshot(g);
  g.step(controls(1));
  assert.deepEqual(snapshot(g), before);
});

test('identical seed and external inputs replay every complete state exactly', () => {
  const a = race('replay-seed');
  const b = race('replay-seed');
  for (let i = 0; i < 1200; i++) {
    a.step(controls(i)); b.step(controls(i));
    assert.deepEqual(snapshot(a), snapshot(b), `frame ${i}`);
  }
});

test('reset clears transient objects, resources, race progress and random state', () => {
  const g = race('reset-seed');
  for (let i = 0; i < 1200; i++) g.step(controls(i));
  for (const item of ['banana', 'snowball', 'shield', 'boost']) { g.racers[0].item = item; g._use(g.racers[0]); }
  g.racers[0].itemLatch = true;
  g.racers[0].lap = 2; g.racers[0].checkpoint = 8; g.racers[0].stun = .5;
  g.pickups[0].cooldown = 5;
  assert.ok(g.hazards.length && g.projectiles.length && g.racers[0].shield && g.racers[0].boost);
  g.reset();
  const fresh = new E.Game({ seed: 'reset-seed' });
  assert.deepEqual(snapshot(g), snapshot(fresh));
  g.start(); fresh.start();
  for (let i = 0; i < 300; i++) { g.step(controls(i)); fresh.step(controls(i)); }
  assert.deepEqual(snapshot(g), snapshot(fresh));
  g.reset('replacement-seed');
  assert.deepEqual(snapshot(g), snapshot(new E.Game({ seed: 'replacement-seed' })));
});

test('public observations conceal rival held-item identities and are detached from private state', () => {
  const g = race('observation');
  g.racers[0].item = 'shield';
  g.racers[1].item = 'banana';
  const a = g.observation(0);
  assert.equal(a.racers[0].item, 'shield');
  assert.equal(a.racers[1].item, null);
  assert.equal(a.racers[1].hasItem, true);
  g.racers[1].item = 'snowball';
  assert.deepEqual(g.observation(0), a);
  assert.deepEqual(E.chooseAI(a, 0), E.chooseAI(g.observation(0), 0));
  a.racers[0].x += 500;
  a.racers[1].hasItem = false;
  assert.notEqual(a.racers[0].x, g.racers[0].x);
  assert.equal(g.racers[1].item, 'snowball');
});

function place(r, s, speed = 0, lane = 0) {
  const at = E.pointAt(s);
  Object.assign(r, { x: at.x - at.ty * lane, y: at.y + at.tx * lane,
    angle: at.angle, motionAngle: at.angle, trackS: at.s, speed });
}
function isolated(seed = 'isolated') {
  const g = race(seed);
  g.pickups = [];
  for (const r of g.racers.slice(1)) { r.finished = true; r.finishTime = 0; }
  place(g.racers[0], E.TRACK.length * .2);
  return g;
}
function tick(g, frames, input = {}) { for (let i = 0; i < frames; i++) g.step(input); }

test('steering, braking, reverse and off-track friction use continuous bounded physics', () => {
  const left = isolated(), right = isolated(), straight = isolated();
  for (const g of [left, right, straight]) g.racers[0].speed = 140;
  const angle = straight.racers[0].angle;
  left.step({ throttle: 1, steer: -1 }); right.step({ throttle: 1, steer: 1 }); straight.step({ throttle: 1 });
  assert.ok(E.wrap(left.racers[0].angle - angle) < 0);
  assert.ok(E.wrap(right.racers[0].angle - angle) > 0);
  assert.ok(Math.abs(straight.racers[0].angle - angle) < 1e-12);
  tick(straight, 90, { brake: 1 });
  assert.ok(straight.racers[0].speed < 0 && straight.racers[0].speed >= -66);
  const road = isolated(), snow = isolated();
  place(road.racers[0], 400, 205); place(snow.racers[0], 400, 205, 63);
  road.step({ throttle: 1 }); snow.step({ throttle: 1 });
  assert.ok(road.racers[0].speed > snow.racers[0].speed + 50);
  const bad = isolated(); bad.step({ throttle: Infinity, brake: NaN, steer: -Infinity });
  for (const k of ['x', 'y', 'angle', 'speed']) assert.ok(Number.isFinite(bad.racers[0][k]));
});

test('a held moving drift charges, release boosts, and short or stationary drifts give no boost', () => {
  const g = isolated(), r = g.racers[0];
  place(r, 320, 150);
  tick(g, 38, { throttle: 1, steer: .15, drift: true });
  assert.ok(r.driftCharge >= .6 && r.drifting);
  const charge = r.driftCharge;
  g.step({ throttle: 1 });
  assert.equal(r.driftCharge, 0); assert.equal(r.drifting, false);
  assert.ok(Math.abs(r.boost - (.55 + .65 * charge)) < 1e-9);
  assert.equal(g.telemetry.drifts, 1);
  tick(g, 120, {}); assert.equal(r.boost, 0);
  const short = isolated(); place(short.racers[0], 320, 150);
  tick(short, 20, { throttle: 1, steer: .15, drift: true }); short.step({});
  assert.equal(short.racers[0].boost, 0);
  const still = isolated(); tick(still, 60, { steer: 1, drift: true });
  assert.equal(still.racers[0].driftCharge, 0);
  const capped = isolated(); place(capped.racers[0], 320, 150);
  capped.racers[0].driftCharge = 1.495;
  capped.step({ throttle: 1, steer: .15, drift: true });
  assert.equal(capped.racers[0].driftCharge, 1.5);
});

test('items require a fresh press; shield and boost expire on simulation time', () => {
  const g = isolated(), r = g.racers[0];
  r.item = 'shield'; g.step({ useItem: true });
  assert.equal(r.item, null); assert.equal(r.shield, 8);
  r.item = 'boost'; g.step({ useItem: true });
  assert.equal(r.item, 'boost'); assert.equal(r.boost, 0);
  g.step({ useItem: false }); g.step({ useItem: true });
  assert.equal(r.item, null); assert.equal(r.boost, 2);
  g.pause(); const before = snapshot(g); tick(g, 600, { useItem: true });
  assert.deepEqual(snapshot(g), before);
  g.start(); tick(g, 121); assert.equal(r.boost, 0);
  tick(g, 361); assert.equal(r.shield, 0);
  assert.equal(g.telemetry.items, 2);
});

test('snowballs have a visible arming interval and a shield absorbs exactly one hit', () => {
  const g = isolated(), r = g.racers[0];
  r.shield = 8;
  g.projectiles.push({ owner: 1, x: r.x, y: r.y, vx: 0, vy: 0, life: 2, age: 0 });
  tick(g, 5);
  assert.equal(g.telemetry.blocks, 0); assert.equal(g.projectiles.length, 1);
  assert.ok(g.observation().projectiles[0].age > 0);
  tick(g, 2);
  assert.equal(g.telemetry.blocks, 1); assert.equal(g.projectiles.length, 0);
  assert.equal(r.shield, 0); assert.equal(r.stun, 0);
  tick(g, 31);
  g.projectiles.push({ owner: 1, x: r.x, y: r.y, vx: 0, vy: 0, life: 2, age: .2 });
  g.step();
  assert.equal(g.telemetry.hits, 1); assert.ok(r.stun > .8); assert.equal(g.projectiles.length, 0);
  tick(g, 53); assert.equal(r.stun, 0); assert.equal(r.invulnerable, 0);
  r.item = 'snowball'; g.step({ useItem: true });
  assert.equal(g.projectiles.length, 1); assert.equal(g.projectiles[0].owner, 0);
  assert.ok(g.projectiles[0].vx ** 2 + g.projectiles[0].vy ** 2 >= 310 ** 2 - 1e-6);
  tick(g, 121); assert.equal(g.projectiles.length, 0);
});

test('banana telegraphs delay collision, briefly protect its owner and expire without targets', () => {
  const g = isolated(), r = g.racers[0];
  g.hazards.push({ owner: 1, x: r.x, y: r.y, life: 12, age: 0, armed: false });
  tick(g, 29); assert.equal(g.telemetry.hits, 0); assert.equal(g.observation().hazards[0].armed, false);
  tick(g, 2); assert.equal(g.telemetry.hits, 1); assert.equal(g.hazards.length, 0);
  const own = isolated(), kart = own.racers[0];
  own.hazards.push({ owner: 0, x: kart.x, y: kart.y, life: 12, age: 0, armed: false });
  tick(own, 65); assert.equal(own.telemetry.hits, 0); assert.equal(own.hazards[0].armed, true);
  tick(own, 10); assert.equal(own.telemetry.hits, 1);
  const expiry = isolated(); expiry.hazards.push({ owner: 1, x: 0, y: 0, life: 12, age: 0, armed: false });
  tick(expiry, 721); assert.equal(expiry.hazards.length, 0);
});

test('pickup boxes share one cooldown, never replace a held item, and use the shared seeded item pool', () => {
  const g = isolated(), r = g.racers[0];
  g.pickups = [{ id: 0, x: r.x, y: r.y, cooldown: 0 }];
  g.step(); assert.ok(Object.hasOwn(E.ITEMS, r.item)); assert.equal(g.pickups[0].cooldown, 7);
  const held = r.item; g.pickups[0].cooldown = 0; g.step();
  assert.equal(r.item, held); assert.equal(g.telemetry.pickups, 1);
  r.item = null; g.pickups[0].cooldown = 7; tick(g, 419);
  assert.equal(r.item, null);
  tick(g, 2); assert.ok(Object.hasOwn(E.ITEMS, r.item)); assert.equal(g.telemetry.pickups, 2);
  const types = new Set();
  for (let i = 0; i < 100; i++) { r.item = null; g.pickups[0].cooldown = 0; g.step(); types.add(r.item); }
  assert.deepEqual([...types].sort(), Object.keys(E.ITEMS).sort());
});

test('gates require their exact order and forward crossings; the first start crossing is not a lap', () => {
  const g = isolated(), r = g.racers[0];
  const cross = (gate, backwards = false) => {
    const at = E.TRACK.checkpoints[gate];
    place(r, at.s + (backwards ? 1 : -1), backwards ? -160 : 160);
    g.step({});
  };
  cross(0); assert.equal(r.started, true); assert.equal(r.lap, 0); assert.equal(r.checkpoint, 1);
  cross(2); assert.equal(r.checkpoint, 1); assert.equal(r.lap, 0);
  cross(1, true); assert.equal(r.checkpoint, 1);
  cross(1); assert.equal(r.checkpoint, 2);
  cross(0); assert.equal(r.lap, 0); assert.equal(r.checkpoint, 2);
  r.checkpoint = 0; r.lapDistance = E.TRACK.length * .1;
  cross(0); assert.equal(r.lap, 0); assert.equal(r.checkpoint, 0);
});

test('three validated laps finish; simultaneous finish times resolve consistently by racer id', () => {
  const g = race('simultaneous-finish'); g.pickups = [];
  for (const r of g.racers) {
    place(r, E.TRACK.length - 1, 160, (r.id - 2) * 20);
    Object.assign(r, { started: true, lap: 2, lapDistance: E.TRACK.length, checkpoint: 0 });
  }
  g.step({ throttle: 1 });
  assert.equal(g.phase, 'over'); assert.ok(g.racers.every(r => r.lap === 3 && r.finished));
  assert.equal(new Set(g.racers.map(r => r.finishTime)).size, 1);
  assert.deepEqual(g.result.standings.map(r => r.id), [0, 1, 2, 3, 4]);
  assert.deepEqual(g.result.standings.map(r => r.rank), [1, 2, 3, 4, 5]);
  const before = snapshot(g); tick(g, 60, { throttle: 1 }); assert.deepEqual(snapshot(g), before);
});

test('AI controller and human controls receive identical physical outcomes for identical inputs', () => {
  const human = race('fair-physics', false), ai = race('fair-physics', true);
  // Deliberately ends before the first scheduled AI steering error (>=8s).
  // Human input does not consume that private AI error RNG stream.
  for (let i = 0; i < 420; i++) {
    const input = E.chooseAI(human.observation(0), 0);
    human.step(input); ai.step({});
    assert.deepEqual(human.racers, ai.racers, `frame ${i}`);
    assert.deepEqual(human.projectiles, ai.projectiles);
    assert.deepEqual(human.hazards, ai.hazards);
  }
});

test('AI corrects a backwards slow kart by driving, and seeded driver mistakes remain bounded', () => {
  const g = race('ai-recovery', true), r = g.racers[0];
  place(r, 450, 0); r.angle = E.wrap(r.angle + Math.PI); r.motionAngle = r.angle;
  const first = E.chooseAI(g.observation(0), 0);
  assert.equal(first.brake, 1); assert.equal(first.throttle, 0);
  const start = { x: r.x, y: r.y };
  let last = start, mistaken = 0, maxContinuousError = 0, current = 0;
  for (let i = 0; i < 1800; i++) {
    g.step();
    assert.ok(Math.hypot(r.x - last.x, r.y - last.y) < 25, `frame ${i}: recovery teleport`);
    last = { x: r.x, y: r.y };
    for (const kart of g.racers) assert.ok(Math.abs(kart.driverError) <= .18);
    if (r.driverError !== 0) { mistaken++; current++; maxContinuousError = Math.max(current, maxContinuousError); }
    else current = 0;
  }
  assert.ok(Math.hypot(r.x - start.x, r.y - start.y) > 100);
  assert.ok(r.started && r.progress > E.TRACK.length * .5);
  assert.ok(mistaken > 0); assert.ok(maxContinuousError <= 22);
});

test('complete seeded AI race crosses all gates three times and bounds transient resources', () => {
  const g = race('complete-race', true);
  let frames = 0;
  while (g.phase === 'racing' && frames < 14400) {
    g.step(); frames++;
    assert.ok(g.events.length <= 64); assert.ok(g.projectiles.length <= 32); assert.ok(g.hazards.length <= 24);
    for (const r of g.racers) for (const k of ['x', 'y', 'speed', 'progress', 'lapDistance']) assert.ok(Number.isFinite(r[k]));
  }
  assert.equal(g.phase, 'over'); assert.ok(g.racers.every(r => r.lap === 3 && r.finished));
  assert.equal(g.telemetry.checkpoints, 5 * 37); assert.equal(g.telemetry.laps, 15);
  assert.ok(g.telemetry.items > 0 && g.telemetry.drifts > 0 && g.telemetry.pickups > 0);
});

test('a collision push across the expected gate receives one checkpoint credit', () => {
  const g = isolated('collision-gate'), a = g.racers[0], b = g.racers[1];
  b.finished = false; b.finishTime = null;
  const gate = E.TRACK.checkpoints[5];
  for (const [r, delta] of [[a, -.2], [b, -8]]) {
    place(r, gate.s + delta);
    Object.assign(r, { started: true, checkpoint: 5, progress: gate.s + delta,
      lapDistance: gate.s + delta, stun: .5 });
  }
  g.step({});
  assert.equal(a.checkpoint, 6); assert.equal(a.lap, 0);
  assert.equal(g.telemetry.checkpoints, 1);
  g.step({ throttle: 1 });
  assert.equal(a.checkpoint, 6); assert.equal(g.telemetry.checkpoints, 1);
});

test('exactly overlapping karts separate deterministically without relocation or lap credit', () => {
  const run = () => {
    const g = isolated('overlap'), a = g.racers[0], b = g.racers[1];
    b.finished = false; b.finishTime = null;
    for (const r of [a, b]) { place(r, 400); r.stun = .5; }
    const old = { x: a.x, y: a.y };
    tick(g, 10);
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 2 * E.RADIUS - 1e-6);
    assert.ok(Math.hypot(a.x - old.x, a.y - old.y) < 25);
    assert.ok(Math.hypot(b.x - old.x, b.y - old.y) < 25);
    assert.equal(g.telemetry.checkpoints, 0);
    return snapshot(g);
  };
  assert.deepEqual(run(), run());
});

test('expired hazards and wall-discarded snowballs cannot still hit a nearby kart', () => {
  const g = isolated(), r = g.racers[0];
  g.projectiles.push({ owner: 1, x: r.x, y: r.y, vx: 0, vy: 0, life: E.DT / 2, age: .2 });
  g.hazards.push({ owner: 1, x: r.x, y: r.y, life: E.DT / 2, age: 1, armed: true });
  g.step();
  assert.equal(g.telemetry.hits, 0); assert.equal(g.projectiles.length, 0); assert.equal(g.hazards.length, 0);
  const wall = isolated(), at = E.TRACK.checkpoints[1];
  place(wall.racers[0], at.s, 0, 67);
  wall.projectiles.push({ owner: 1, x: at.x - at.ty * 82, y: at.y + at.tx * 82,
    vx: 0, vy: 0, life: 2, age: .2 });
  wall.step();
  assert.equal(wall.telemetry.hits, 0); assert.equal(wall.projectiles.length, 0);
});

test('a discontinuous position change cannot earn checkpoint or lap distance', () => {
  const g = isolated(), r = g.racers[0], gate = E.TRACK.checkpoints[3];
  place(r, gate.s - 1, 160);
  Object.assign(r, { started: true, checkpoint: 3, trackS: 0, progress: 40, lapDistance: 40 });
  g.step();
  assert.equal(r.checkpoint, 3); assert.equal(r.lap, 0);
  assert.equal(r.progress, 40); assert.equal(r.lapDistance, 40);
});

test('AI item choices depend on visible threats and its own inventory', () => {
  const g = isolated('public-threats'), r = g.racers[0], other = g.racers[1];
  place(r, 300, 140); place(other, 370, 140); other.finished = false;
  r.item = 'snowball';
  let obs = g.observation(0), before = snapshot(obs);
  assert.equal(E.chooseAI(obs, 0).useItem, true); assert.deepEqual(obs, before);
  place(other, 250, 140);
  assert.equal(E.chooseAI(g.observation(0), 0).useItem, false);
  r.item = 'shield';
  assert.equal(E.chooseAI(g.observation(0), 0).useItem, false);
  g.projectiles.push({ owner: 1, x: r.x + 20, y: r.y, vx: 0, vy: 0, life: 2, age: 0 });
  assert.equal(E.chooseAI(g.observation(0), 0).useItem, true);
  r.item = 'banana';
  assert.equal(E.chooseAI(g.observation(0), 0).useItem, true);
  other.item = 'shield'; const shield = g.observation(0);
  other.item = 'boost'; assert.deepEqual(g.observation(0), shield);
  assert.ok(g.observation(-1).racers.every(k => k.item === null));
  assert.equal(Object.hasOwn(shield, 'random'), false);
  assert.equal(Object.hasOwn(shield.racers[1], 'nextError'), false);
});
