'use strict';
// Complete races, accelerated model time; never presented as live browser play.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const enginePath = process.env.TUX2D_ENGINE || path.resolve(__dirname, '../tux2d-engine.js');
const E = require(enginePath);
const output = process.argv[2] || path.resolve(__dirname, '../docs/tux2d-2026-10-11/races.json');
const count = Number(process.argv[3] || 12);
const seedStart = Number(process.argv[4] || 101);
const seeds = Array.from({ length: count }, (_, i) => `tux-race-study-${i + seedStart}`);
const summary = {
  mode: 'accelerated fixed-step Node simulation; not live browser play',
  engineSha256: crypto.createHash('sha256').update(fs.readFileSync(enginePath)).digest('hex'),
  fixedDt: E.DT, seedCount: seeds.length, seedStart, expectedLaps: E.LAPS,
  scope: 'Complete races on the one original track with five fixed driver profiles; this does not establish broad balance or human difficulty.',
  complete: false, races: []
};
const started = performance.now();
for (const seed of seeds) {
  const g = new E.Game({ seed, spectator: true });
  const digest = crypto.createHash('sha256');
  const metrics = g.racers.map(r => ({ id: r.id, maxSpeed: 0, distanceTravelled: 0,
    checkpointChanges: 0, lapChanges: 0, maxStationarySeconds: 0, maxDistanceFromCenter: 0,
    errorTicks: 0, maxContinuousErrorTicks: 0 }));
  const stationary = metrics.map(() => 0);
  const errors = metrics.map(() => 0);
  const resourceMax = { events: 0, projectiles: 0, hazards: 0 };
  let ticks = 0;
  g.start();
  while (g.phase !== 'over' && ticks < Math.ceil(240 / E.DT)) {
    const previous = g.racers.map(r => ({ x: r.x, y: r.y, lap: r.lap, checkpoint: r.checkpoint, finished: r.finished }));
    g.step({});
    for (const key of Object.keys(resourceMax)) resourceMax[key] = Math.max(resourceMax[key], g[key].length);
    for (let i = 0; i < g.racers.length; i++) {
      const r = g.racers[i], old = previous[i], m = metrics[i];
      for (const key of ['x', 'y', 'angle', 'speed', 'lap', 'checkpoint', 'progress']) assert.ok(Number.isFinite(r[key]), `${seed}/${i}/${key}`);
      assert.ok(r.lap >= old.lap && r.lap <= E.LAPS, `${seed}/${i}: invalid lap`);
      assert.ok(r.lap - old.lap <= 1, `${seed}/${i}: skipped lap`);
      const d = Math.hypot(r.x - old.x, r.y - old.y);
      // A single tick may resolve a kart collision, but cannot relocate across the course.
      assert.ok(d < 80, `${seed}/${i}: discontinuous physics ${d}`);
      m.distanceTravelled += d;
      m.maxSpeed = Math.max(m.maxSpeed, Math.abs(r.speed));
      assert.ok(Math.abs(r.driverError) <= .18);
      if (r.driverError !== 0) {
        m.errorTicks++; errors[i]++;
        m.maxContinuousErrorTicks = Math.max(m.maxContinuousErrorTicks, errors[i]);
      } else errors[i] = 0;
      if (r.checkpoint !== old.checkpoint) m.checkpointChanges++;
      if (r.lap !== old.lap) m.lapChanges++;
      if (g.phase === 'racing' && !r.finished) {
        stationary[i] = Math.abs(r.speed) < 10 ? stationary[i] + E.DT : 0;
        m.maxStationarySeconds = Math.max(m.maxStationarySeconds, stationary[i]);
        const near = E.project(r.x, r.y);
        const center = E.pointAt(near.s);
        m.maxDistanceFromCenter = Math.max(m.maxDistanceFromCenter, Math.hypot(r.x - center.x, r.y - center.y));
      }
      digest.update(JSON.stringify([r.x, r.y, r.speed, r.lap, r.checkpoint, r.item, r.finished]));
    }
    ticks++;
  }
  assert.equal(g.phase, 'over', `${seed}: race failed to finish within 240 model seconds`);
  const result = { seed, ticks, elapsed: g.elapsed, modelSeconds: ticks * E.DT,
    traceSha256: digest.digest('hex'), result: g.result, telemetry: { ...g.telemetry }, resourceMax,
    racers: g.racers.map((r, i) => ({ ...metrics[i], name: r.name, lap: r.lap,
      finished: r.finished, finishTime: r.finishTime })) };
  assert.ok(result.racers.every(r => r.finished && r.lap === 3 && r.checkpointChanges === 37));
  assert.equal(result.telemetry.laps, 15);
  assert.equal(result.telemetry.checkpoints, 185);
  assert.ok(resourceMax.events <= 64 && resourceMax.projectiles <= 32 && resourceMax.hazards <= 24);
  summary.races.push(result);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(summary, null, 2) + '\n');
  console.log(`${summary.races.length}/${seeds.length} ${seed}: ${g.elapsed.toFixed(2)} model seconds, ${result.racers.filter(r => r.finished).length} finishers`);
}
summary.wallSeconds = (performance.now() - started) / 1000;
summary.complete = true;
summary.finishedKarts = summary.races.flatMap(r => r.racers).filter(r => r.finished).length;
summary.finishTimes = summary.races.flatMap(r => r.racers).filter(r => r.finished).map(r => r.finishTime);
summary.finishTimeRange = [Math.min(...summary.finishTimes), Math.max(...summary.finishTimes)];
delete summary.finishTimes;
summary.modelSecondsTotal = summary.races.reduce((sum, r) => sum + r.modelSeconds, 0);
summary.telemetryTotals = {};
summary.winsByProfile = {};
for (const race of summary.races) {
  for (const [key, value] of Object.entries(race.telemetry)) summary.telemetryTotals[key] = (summary.telemetryTotals[key] || 0) + value;
  const winner = race.result.standings[0].name;
  summary.winsByProfile[winner] = (summary.winsByProfile[winner] || 0) + 1;
}
const karts = summary.races.flatMap(r => r.racers);
summary.maxStationarySeconds = Math.max(...karts.map(r => r.maxStationarySeconds));
summary.maxDistanceFromCenter = Math.max(...karts.map(r => r.maxDistanceFromCenter));
summary.maxContinuousErrorTicks = Math.max(...karts.map(r => r.maxContinuousErrorTicks));
fs.writeFileSync(output, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ complete: true, races: summary.races.length, finishedKarts: summary.finishedKarts, finishTimeRange: summary.finishTimeRange, wallSeconds: summary.wallSeconds,
  telemetryTotals: summary.telemetryTotals, winsByProfile: summary.winsByProfile,
  maxStationarySeconds: summary.maxStationarySeconds, maxContinuousErrorTicks: summary.maxContinuousErrorTicks }));
