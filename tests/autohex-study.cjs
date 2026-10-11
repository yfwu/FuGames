'use strict';
// Accelerated model-time campaigns. This is deliberately not a ten-minute browser test.
// Example: node tests/autohex-study.cjs --seed-start=101 --seeds=12 --rotations=6 --output=docs/autohex-2026-10-11/study-a.json
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const H = require('../autohex-engine.js');
const opts = Object.fromEntries(process.argv.slice(2).map(x => x.replace(/^--/, '').split('=')));
const seedStart = +(opts['seed-start'] || 101), seedCount = +(opts.seeds || 12), rotations = +(opts.rotations || 6);
const stepMs = +(opts['step-ms'] || 300), durationMs = 600000;
const outputPath = path.resolve(__dirname, '..', opts.output || 'docs/autohex-2026-10-11/study-a.json');
assert.ok(Number.isInteger(seedCount) && seedCount > 0 && seedCount <= 1000);
assert.ok(Number.isInteger(rotations) && rotations > 0 && rotations <= 6);
assert.ok(stepMs > 0 && stepMs <= 1000);
const source = fs.readFileSync(path.join(__dirname, '../autohex-engine.js'));
const engineSha256 = crypto.createHash('sha256').update(source).digest('hex');
const started = performance.now(), matches = [], latency = [];
const increment = (obj, key, n = 1) => { obj[key] = (obj[key] || 0) + n; };
const stats = a => {
  if (!a.length) return { count: 0, min: null, median: null, p95: null, max: null, mean: null };
  const s = a.slice().sort((a, b) => a - b);
  return { count: s.length, min: s[0], median: s[Math.floor(s.length / 2)], p95: s[Math.ceil(s.length * .95) - 1], max: s.at(-1), mean: s.reduce((a, b) => a + b, 0) / s.length };
};
const physicalCards = g => [...g.drawPile, ...g.discardPile, ...H.PLAYERS.flatMap(p => g.hands[p])].sort();
function freshMetrics() {
  return { actions: {}, events: {}, captures: 0, removals: 0, occupations: 0, engineeredCells: 0, boardChanges: 0, meaningfulActions: 0, cardUses: 0, diplomacyActions: 0, supplyRetreats: 0, observedUnsuppliedStoneTurns: 0, goalArrivals: 0, goalHoldingRounds: 0, turretShots: 0 };
}
function run(seed, rotation) {
  const first = ((seed - seedStart + rotation) % 6) + 1;
  const g = new H.Game({ seed, first, rotation, durationMs });
  const recipe = physicalCards(g), counts = freshMetrics(), quarters = Array.from({ length: 4 }, freshMetrics);
  const seenEvents = new WeakSet(), peaks = Array(7).fill(0), perSeat = Array.from({ length: 7 }, () => ({ actions: 0, cards: 0, captures: 0, deployments: 0 }));
  let lastMeaningfulAt = 0, maxQuietMs = 0, steps = 0, maxOffers = 0, maxAlliances = 0, maxEvents = 0, maxBridges = 0, maxTurrets = 0;
  const wallStart = performance.now();
  g.start();
  while (g.phase === 'running') {
    const quarter = quarters[Math.min(3, Math.floor(g.activeMs / 150000))], actor = g.turn;
    const beforeBoard = Array.from(g.board), beforeRoads = Array.from(g.roads), footprint = Array(7).fill(0);
    const beforeTelemetry = { ...g.telemetry };
    const observation = g.observation(), t = performance.now(), action = H.chooseAction(observation);
    latency.push(performance.now() - t);
    assert.ok(action, `No action: seed=${seed} rotation=${rotation} ply=${g.ply}`);
    assert.ok(H.legalAction(observation, action), `AI proposed illegal action: ${JSON.stringify({ seed, rotation, ply: g.ply, action })}`);
    assert.equal(g.act(action), true, `Rejected action: ${JSON.stringify({ seed, rotation, ply: g.ply, action })}`);
    increment(counts.actions, action.type); increment(quarter.actions, action.type); perSeat[actor].actions++;
    for (const key of ['goalArrivals', 'goalHoldingRounds', 'turretShots']) {
      const delta = (g.telemetry[key] || 0) - (beforeTelemetry[key] || 0); counts[key] += delta; quarter[key] += delta;
    }
    if (H.CARD_META[action.type]) { counts.cardUses++; quarter.cardUses++; perSeat[actor].cards++; }
    if (['offer', 'accept', 'reject', 'betray'].includes(action.type)) { counts.diplomacyActions++; quarter.diplomacyActions++; }
    let changed = 0;
    for (let i = 0; i < H.COUNT; i++) {
      footprint[g.board[i]]++;
      if (beforeBoard[i] !== g.board[i]) {
        changed++; counts.boardChanges++; quarter.boardChanges++;
        if (beforeBoard[i] && g.board[i]) { counts.captures++; quarter.captures++; perSeat[actor].captures++; }
        else if (beforeBoard[i]) { counts.removals++; quarter.removals++; }
        else { counts.occupations++; quarter.occupations++; perSeat[actor].deployments++; }
      }
      if (!beforeRoads[i] && g.roads[i]) { counts.engineeredCells++; quarter.engineeredCells++; changed++; }
    }
    if (changed || H.CARD_META[action.type] || ['offer', 'accept', 'reject', 'betray'].includes(action.type)) {
      counts.meaningfulActions++; quarter.meaningfulActions++;
      maxQuietMs = Math.max(maxQuietMs, g.activeMs - lastMeaningfulAt); lastMeaningfulAt = g.activeMs;
    }
    for (const e of g.events) if (!seenEvents.has(e)) {
      seenEvents.add(e); increment(counts.events, e.type || 'untyped'); increment(quarter.events, e.type || 'untyped');
      if (/retreat|attrition/i.test(e.type || '')) { counts.supplyRetreats += e.count || 1; quarter.supplyRetreats += e.count || 1; }
    }
    for (const p of H.PLAYERS) {
      peaks[p] = Math.max(peaks[p], footprint[p]);
      assert.ok(footprint[p] <= (H.MAX_STONES || 96), `Footprint overflow: ${footprint[p]}`);
      assert.ok(g.hands[p].length <= (H.HAND_CAP || 5), 'Hand cap exceeded');
      assert.equal(g.board[g.players[p].home], p, 'Permanent home lost');
      if (typeof H.computeSupply === 'function') {
        const supplied = H.computeSupply(g, p);
        if (Array.isArray(supplied) || ArrayBuffer.isView(supplied) || supplied instanceof Set) {
          const n = g.board.reduce((n, owner, i) => n + (owner === p && !(supplied instanceof Set ? supplied.has(i) : supplied[i])), 0);
          counts.observedUnsuppliedStoneTurns += n; quarter.observedUnsuppliedStoneTurns += n;
        }
      }
    }
    // Keep expensive recipe checks periodic; the core rule tests check every action.
    if (steps % 50 === 0) assert.deepEqual(physicalCards(g), recipe, 'Physical deck changed');
    maxOffers = Math.max(maxOffers, g.offers.length); maxAlliances = Math.max(maxAlliances, g.alliances.length);
    maxEvents = Math.max(maxEvents, g.events.length); maxBridges = Math.max(maxBridges, g.bridges.length); maxTurrets = Math.max(maxTurrets, g.turrets.length);
    g.advanceTime(stepMs);
    assert.ok(++steps <= Math.ceil(durationMs / stepMs) + 1, 'Campaign exceeded explicit clock budget');
  }
  assert.equal(g.phase, 'over'); assert.equal(g.activeMs, durationMs); assert.ok(g.result);
  assert.deepEqual(physicalCards(g), recipe);
  maxQuietMs = Math.max(maxQuietMs, durationMs - lastMeaningfulAt);
  const scores = H.PLAYERS.map(p => g.players[p].score), maxScore = Math.max(...scores), top = H.PLAYERS.filter(p => scores[p - 1] === maxScore);
  return { seed, rotation, first, profiles: H.PLAYERS.map(p => g.players[p].profile.name || g.players[p].profile), modelActiveMs: g.activeMs, actions: steps, completedRounds: g.round, wallSeconds: (performance.now() - wallStart) / 1000,
    scores, top, winner: top.length === 1 ? top[0] : 0, result: g.result, counts, quarters, telemetry: g.telemetry, peakFootprint: peaks.slice(1), finalFootprint: H.PLAYERS.map(p => g.board.filter(o => o === p).length), perSeat: perSeat.slice(1),
    bounds: { maxOffers, maxAlliances, maxEvents, maxBridges, maxTurrets }, maxQuietModelMs: maxQuietMs, lateMeaningfulActions: quarters[3].meaningfulActions,
    passiveLateGame: quarters[3].boardChanges === 0 && quarters[3].engineeredCells === 0 };
}
function report(complete) {
  const elapsedSeconds = (performance.now() - started) / 1000, allCounts = freshMetrics();
  for (const m of matches) for (const [key, value] of Object.entries(m.counts)) {
    if (typeof value === 'number') allCounts[key] += value;
    else for (const [type, n] of Object.entries(value)) increment(allCounts[key], type, n);
  }
  const profiles = [...new Set(matches.flatMap(m => m.profiles))];
  return { generatedAt: new Date().toISOString(), mode: 'accelerated model-time simulation', complete, engineSha256, config: { seedStart, seedCount, rotations, stepMs, durationMs },
    games: matches.length, independentSeeds: new Set(matches.map(m => m.seed)).size, elapsedSeconds, gamesPerMinute: matches.length / elapsedSeconds * 60, actionsPerSecond: matches.reduce((n, m) => n + m.actions, 0) / elapsedSeconds,
    winsBySeat: H.PLAYERS.map(p => matches.filter(m => m.winner === p).length), sharedTop: matches.filter(m => !m.winner).length,
    winsByProfile: Object.fromEntries(profiles.map(p => [p, matches.filter(m => m.winner && m.profiles[m.winner - 1] === p).length])),
    score: stats(matches.flatMap(m => m.scores)), chooseActionMs: stats(latency), campaignWallSeconds: stats(matches.map(m => m.wallSeconds)), counts: allCounts,
    gamesWithGoalArrival: matches.filter(m => m.counts.goalArrivals > 0).length,
    lateMeaningfulActions: stats(matches.map(m => m.lateMeaningfulActions)), passiveLateGames: matches.filter(m => m.passiveLateGame).map(m => ({ seed: m.seed, rotation: m.rotation })),
    limitations: ['Each game advances exactly 600,000 model milliseconds at 300 ms per accepted action by default. Execution is accelerated; this is not evidence of ten minutes of real foreground browser play.',
      'Rotations within each seed are correlated; independent seed count is reported separately.', 'Winner and profile frequencies describe this sample and do not establish balance or causal profile strength.',
      'Node timings omit canvas rendering, input latency, scheduling, background throttling and mobile costs.', 'Captures count ownership transfers; removals include attacks and supply retreats. Event totals depend on public engine event classification.'], matches };
}
for (let s = 0; s < seedCount; s++) for (let rotation = 0; rotation < rotations; rotation++) {
  matches.push(run(seedStart + s * 7919, rotation));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report(matches.length === seedCount * rotations), null, 2) + '\n');
  const m = matches.at(-1);
  console.log(JSON.stringify({ completed: matches.length, total: seedCount * rotations, seed: m.seed, rotation, seconds: +m.wallSeconds.toFixed(2), scores: m.scores, winner: m.winner, goals: m.counts.goalArrivals, lateMeaningfulActions: m.lateMeaningfulActions, passiveLateGame: m.passiveLateGame }));
}
const final = report(true); delete final.matches;
console.log(JSON.stringify(final, null, 2));
