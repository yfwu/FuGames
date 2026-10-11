'use strict';
// Standalone evidence runner; intentionally excluded from the Node test glob.
// Every game completes 600000 model-ms. This is not foreground browser time.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const crypto = require('node:crypto'), Module = require('node:module');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..'), BASELINE = 'f3d50e73a8bbb90ee4eda2b6386b4cac98939446';
const argv = process.argv.slice(2), flags = {};
for (let i = 0; i < argv.length; i += 2) { assert.ok(argv[i].startsWith('--')); flags[argv[i].slice(2)] = argv[i + 1]; }
const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const range = xs => xs.length ? [Math.min(...xs), Math.max(...xs)] : null;
const sha = source => crypto.createHash('sha256').update(source).digest('hex');
const outPath = path.resolve(flags.output || path.join(ROOT, 'docs/autohex-goals-2026-10-11', `${flags.mode || 'baseline'}-${flags.sample || 'development'}.json`));
function save(value) { fs.mkdirSync(path.dirname(outPath), { recursive: true }); fs.writeFileSync(outPath, JSON.stringify(value, null, 2) + '\n'); }

function aggregate(games, areas) {
  const players = games.flatMap(g => g.players), connected = players.filter(p => p.firstGoalMs !== null);
  const by = key => {
    const groups = {};
    for (const p of players) {
      const name = String(p[key]);
      const row = groups[name] ||= { campaigns: 0, reached: 0, arrivals: 0, holdingRounds: 0, sharedWinCredit: 0, scoreSum: 0, peakProgressSum: 0 };
      row.campaigns++; row.reached += Number(p.firstGoalMs !== null); row.arrivals += p.arrivals;
      row.holdingRounds += p.holdingRounds; row.sharedWinCredit += p.winCredit; row.scoreSum += p.score; row.peakProgressSum += p.peakProgress;
    }
    for (const row of Object.values(groups)) { row.connectionRate = row.reached / row.campaigns; row.meanScore = row.scoreSum / row.campaigns; row.meanPeakProgress = row.peakProgressSum / row.campaigns; }
    return groups;
  };
  const spatial = {};
  for (const name of Object.keys(areas)) {
    const combat = games.reduce((s, g) => s + g.spatial.combat[name], 0);
    const actions = games.reduce((s, g) => s + g.spatial.actions[name], 0);
    const occupation = games.reduce((s, g) => s + g.spatial.occupation[name], 0);
    const samples = games.reduce((s, g) => s + g.spatial.samples, 0);
    spatial[name] = { cells: areas[name], combatCellIncidences: combat, actionTargets: actions,
      combatPerCellPerCampaign: combat / areas[name] / games.length,
      actionTargetsPerCellPerCampaign: actions / areas[name] / games.length,
      meanOccupancyFraction: occupation / areas[name] / samples };
  }
  const add = field => Object.fromEntries(Object.keys(games[0]?.[field] || {}).map(key => [key, games.reduce((s, g) => s + g[field][key], 0)]));
  const startingSeatCounts = {}, startingProfileCounts = {};
  for (const g of games) {
    startingSeatCounts[g.first] = (startingSeatCounts[g.first] || 0) + 1;
    const profile = g.players.find(p => p.seat === g.first).profile;
    startingProfileCounts[profile] = (startingProfileCounts[profile] || 0) + 1;
  }
  return { games: games.length, players: players.length, startingSeatCounts, startingProfileCounts,
    campaignsWithGoal: games.filter(g => g.telemetry.goalArrivals > 0).length,
    campaignConnectionRate: mean(games.map(g => Number(g.telemetry.goalArrivals > 0))),
    playerConnectionRate: connected.length / players.length,
    arrivals: players.reduce((s, p) => s + p.arrivals, 0), holdingRounds: players.reduce((s, p) => s + p.holdingRounds, 0),
    firstGoalMsMeanAmongConnected: mean(connected.map(p => p.firstGoalMs)), firstGoalMsRange: range(connected.map(p => p.firstGoalMs)),
    meanFinalProgress: mean(players.map(p => p.finalProgress)), meanPeakProgress: mean(players.map(p => p.peakProgress)),
    meanFinalRouteDeficit: mean(players.map(p => p.finalRouteDeficit)), meanMinimumRouteDeficit: mean(players.map(p => p.minimumRouteDeficit)),
    goalsBeforeAnyAirportUnlock: players.filter(p => p.firstGoalMs !== null && (p.firstAirportMs === null || p.firstGoalMs < p.firstAirportMs)).length,
    scoreRange: range(players.map(p => p.score)), draws: games.filter(g => g.winners.length > 1).length,
    airport: add('airport'), airUtility: add('airUtility'), spatial, bySeat: by('seat'), byProfile: by('profile'),
    lastQuarter: Object.fromEntries(Object.keys(games[0]?.quarters[3] || {}).map(key => [key, games.reduce((s, g) => s + g.quarters[3][key], 0)])),
    lateCombatRange: range(games.map(g => g.quarters[3].combat)), lateBoardChangesRange: range(games.map(g => g.quarters[3].boardChanges)),
    aiMeanMs: mean(games.map(g => g.aiMs / g.actions)), totalActions: games.reduce((s, g) => s + g.actions, 0) };
}

if (flags.merge) {
  const paths = flags.merge.split(',').map(p => path.resolve(p)), blocks = paths.map(p => JSON.parse(fs.readFileSync(p, 'utf8')));
  assert.ok(blocks.length >= 2 && blocks.every(b => b.complete));
  for (const block of blocks) { assert.equal(block.mode, blocks[0].mode); assert.equal(block.source.sha256, blocks[0].source.sha256); assert.deepEqual(block.regionAreas, blocks[0].regionAreas); }
  const games = blocks.flatMap(b => b.games); assert.equal(new Set(games.map(g => g.key)).size, games.length);
  const auditGroups = [games, ...[...new Set(games.map(g => g.seed))].map(seed => games.filter(g => g.seed === seed))];
  for (const group of auditGroups) {
    const seats = frequencyCounts(group.map(g => String(g.first)));
    const profiles = frequencyCounts(group.map(g => g.players.find(p => p.seat === g.first).profile));
    assert.equal(Object.keys(seats).length, 6); assert.equal(Object.keys(profiles).length, 6);
    assert.equal(new Set(Object.values(seats)).size, 1, 'Starting seats must balance within each seed and overall');
    assert.equal(new Set(Object.values(profiles)).size, 1, 'Starting profiles must balance within each seed and overall');
  }
  const merged = { ...blocks[0], sample: 'heldout-two-start-offset-blocks', firstOffset: null,
    schedule: blocks.flatMap(b => b.schedule), games,
    blocks: blocks.map((b, i) => ({ path: path.relative(path.dirname(outPath), paths[i]), firstOffset: b.firstOffset ?? 0, games: b.games.length, wallSeconds: b.wallSeconds, sha256: b.source.sha256 })),
    wallSeconds: undefined, sumBlockWallSeconds: blocks.reduce((s, b) => s + b.wallSeconds, 0),
    summary: aggregate(games, blocks[0].regionAreas) };
  save(merged); console.log(JSON.stringify({ output: outPath, complete: true, games: games.length, summary: merged.summary })); process.exit(0);
}

function frequencyCounts(values) {
  const counts = {}; for (const value of values) counts[value] = (counts[value] || 0) + 1; return counts;
}

if (flags.compare) {
  const a = JSON.parse(fs.readFileSync(path.resolve(flags.compare), 'utf8'));
  const b = JSON.parse(fs.readFileSync(path.resolve(flags.candidate), 'utf8'));
  assert.ok(a.complete && b.complete); assert.deepEqual(a.schedule, b.schedule); assert.deepEqual(a.regionAreas, b.regionAreas);
  const pairs = a.games.map((old, i) => {
    const next = b.games[i]; assert.equal(old.key, next.key);
    const playerDelta = old.players.map((p, j) => ({ seat: p.seat, profile: p.profile,
      firstGoalMsBefore: p.firstGoalMs, firstGoalMsAfter: next.players[j].firstGoalMs,
      arrivals: next.players[j].arrivals - p.arrivals, holdingRounds: next.players[j].holdingRounds - p.holdingRounds,
      peakProgress: next.players[j].peakProgress - p.peakProgress,
      finalRouteDeficit: next.players[j].finalRouteDeficit - p.finalRouteDeficit }));
    return { key: old.key, goalArrivals: next.telemetry.goalArrivals - old.telemetry.goalArrivals,
      holdingRounds: next.telemetry.goalHoldingRounds - old.telemetry.goalHoldingRounds,
      connectedPlayers: next.players.filter(p => p.firstGoalMs !== null).length - old.players.filter(p => p.firstGoalMs !== null).length,
      lateCombat: next.quarters[3].combat - old.quarters[3].combat,
      airportLocalNonAdvancingActions: next.airport.localNonAdvancing - old.airport.localNonAdvancing,
      playerDelta };
  });
  const report = { mode: 'paired independent goal and spatial comparison', complete: true,
    baselineSource: a.source, candidateSource: b.source, schedule: a.schedule, definitions: a.definitions,
    blocks: { baseline: a.blocks || [], candidate: b.blocks || [] },
    before: aggregate(a.games, a.regionAreas), after: aggregate(b.games, b.regionAreas), pairs,
    campaignGoalArrivalDelta: { mean: mean(pairs.map(p => p.goalArrivals)), range: range(pairs.map(p => p.goalArrivals)),
      improved: pairs.filter(p => p.goalArrivals > 0).length, equal: pairs.filter(p => !p.goalArrivals).length, worse: pairs.filter(p => p.goalArrivals < 0).length } };
  save(report); console.log(JSON.stringify({ output: outPath, before: a.summary, after: b.summary })); process.exit(0);
}

const mode = flags.mode || 'baseline', sample = flags.sample || 'development';
assert.ok(['baseline', 'candidate'].includes(mode));
const modulePath = path.join(ROOT, 'autohex-engine.js');
const source = mode === 'baseline' ? execFileSync('git', ['show', `${BASELINE}:autohex-engine.js`], { cwd: ROOT, encoding: 'utf8' }) : fs.readFileSync(modulePath, 'utf8');
const compiled = new Module(modulePath, module); compiled.filename = modulePath; compiled.paths = module.paths; compiled._compile(source, modulePath);
const H = compiled.exports;
const seeds = (flags.seeds || (sample === 'heldout' ? '1601,1709,1801,1901,2003,2101' : '211,307,401,503,601,709')).split(',').map(Number);
const rotations = flags.rotations || (sample === 'heldout' ? '0,1,2,3,4,5' : 'balanced');
const firstOffset = Number(flags['first-offset'] || 0); assert.ok(Number.isInteger(firstOffset) && firstOffset >= 0 && firstOffset < 6);
const schedule = seeds.flatMap((seed, i) => (rotations === 'balanced' ? [i % 6] : rotations.split(',').map(Number)).map(rotation => ({ seed, rotation, first: (rotation + firstOffset) % 6 + 1 })));
const radius = i => Math.max(Math.abs(H.CELLS[i].q), Math.abs(H.CELLS[i].r), Math.abs(H.CELLS[i].s));
const region = i => radius(i) <= 6 ? 'center' : radius(i) >= 12 ? 'flank' : 'transition';
const regionAreas = { center: 0, transition: 0, flank: 0 }; for (const c of H.CELLS) regionAreas[region(c.i)]++;
const emptyRegions = () => ({ center: 0, transition: 0, flank: 0 });
const gap = (g, p, supplied) => {
  const { axis, sign } = g.players[p]; let distance = H.RADIUS * 2;
  for (const c of H.CELLS) if (supplied[c.i] && g.board[c.i] === p) distance = Math.min(distance, H.RADIUS + sign * c[axis]);
  return distance;
};
// Independent 0/1 graph metric: count non-owned cells on an adjacency path.
// It deliberately does not reuse AI path costs or assume legal immediate actions.
function deficit(g, p, supplied) {
  const dist = new Int16Array(H.COUNT).fill(32767); let current = [];
  for (let i = 0; i < H.COUNT; i++) if (supplied[i]) { dist[i] = 0; current.push(i); }
  for (let level = 0; current.length && level < H.COUNT; level++) {
    const next = [];
    for (let n = 0; n < current.length; n++) {
      const i = current[n]; if (dist[i] !== level) continue;
      if (H.goalCell(g, p, i)) return level;
      for (const j of H.ADJ[i]) {
        if (g.anchors[j] && g.anchors[j] !== p) continue;
        const extra = Number(g.board[j] !== p), d = level + extra;
        if (d < dist[j]) { dist[j] = d; (extra ? next : current).push(j); }
      }
    }
    current = next;
  }
  return null;
}
const output = { mode, sample, complete: false, source: { location: mode === 'baseline' ? `git:${BASELINE}:autohex-engine.js` : 'autohex-engine.js', sha256: sha(source), capturedSource: mode === 'candidate' ? source : undefined },
  baselineCommit: BASELINE, firstOffset, schedule, regionAreas, timing: 'Accelerated 2000 actions ×300 active model-ms =600000ms per game. Wall cost is shared-workspace execution, not a browser performance benchmark.',
  definitions: {
    progress: '36 minus minimum directed opposite-edge coordinate gap among home-supplied own stones; sampled each completed round. Higher is better.',
    routeDeficit: 'Minimum non-owned adjacency cells between any home-supplied own stone and opposite edge. Excludes enemy anchors; ignores terrain/action costs and alliances. Existing own bridge reach is included through the supplied starting set. Sampled every30actions.',
    airportLocal: 'Action target within4 of any public airport. Local non-advancing counts non-air own construction/engineering actions without immediate supplied-frontier or adjacency-deficit improvement; defensive value remains possible, so this alone does not prove waste.',
    spatial: 'center radius0–6; transition7–11; flank12–18. Combat counts capture/destroy event cell incidences, including automatic fire. Densities divide by actual region cell count; occupation also divides by samples.',
    holding: 'Credited complete-round holds, reconstructed at scoring boundaries; first connections and repeated arrivals are separately counted.',
    limitation: 'Layout accessibility changes and AI changes are jointly compared. Matched seeds retain card RNG and profiles, but airport/passable-path terrain differs; this is a whole-change comparison, not an AI-only causal ablation.' }, games: [] };
const wallStart = performance.now();
for (const config of schedule) {
  const g = new H.Game({ ...config, neutralEvents: true }); g.start();
  const row = { ...config, key: `${config.seed}/${config.rotation}/${config.first}`, actions: 0, aiMs: 0, traceSha256: null,
    airports: g.airports.map(a => ({ cell: a.cell, q: H.CELLS[a.cell].q, r: H.CELLS[a.cell].r, radius: radius(a.cell) })),
    players: H.PLAYERS.map(p => ({ seat: p, profile: g.players[p].profile.name, firstGoalMs: null, firstAirportMs: null, arrivals: 0, holdingRounds: 0, goalPoints: 0, peakProgress: 0, finalProgress: 0, minimumRouteDeficit: 999, finalRouteDeficit: null, progressSum: 0, progressSamples: 0, airportActionsBeforeFirstGoal: 0 })),
    quarters: Array.from({ length: 4 }, () => ({ actions: 0, meaningful: 0, combat: 0, boardChanges: 0, arrivals: 0, holdingRounds: 0, air: 0, deploy: 0, rest: 0 })),
    spatial: { actions: emptyRegions(), combat: emptyRegions(), occupation: emptyRegions(), samples: 0 },
    airport: { localActions: 0, localBeforeFirstGoal: 0, localNonAdvancing: 0, localProgressAdvancing: 0, unlocks: 0, losses: 0, activeSamples: 0 },
    airUtility: { actions: 0, airdrops: 0, bombardments: 0, suppliedAirdrops: 0, ownFrontierImproved: 0, ownRouteDeficitReduced: 0, enemyFrontierSetBack: 0, enemyConnectionBroken: 0, airdropLaterTurretHits: 0 }, timeline: [] };
  const trace = crypto.createHash('sha256'), airTurrets = new Map();
  let lastEventId = g.events.at(-1)?.id || 0;
  function sampleState(route = false) {
    const point = { activeMs: g.activeMs, progress: [], deficit: route ? [] : undefined };
    for (const p of H.PLAYERS) {
      const supplied = H.computeSupply(g, p), value = 36 - gap(g, p, supplied), player = row.players[p - 1];
      player.peakProgress = Math.max(player.peakProgress, value); player.finalProgress = value; player.progressSum += value; player.progressSamples++;
      point.progress.push(value);
      if (route) { const d = deficit(g, p, supplied); assert.notEqual(d, null); player.minimumRouteDeficit = Math.min(player.minimumRouteDeficit, d); player.finalRouteDeficit = d; point.deficit.push(d); }
    }
    if (route) {
      row.spatial.samples++;
      for (const c of H.CELLS) if (g.board[c.i]) row.spatial.occupation[region(c.i)]++;
      row.airport.activeSamples += g.airports.filter(a => a.active).length;
      row.timeline.push(point);
    }
  }
  sampleState(true);
  for (let step = 0; step < 2000; step++) {
    const obs = g.observation(), start = performance.now(), action = H.chooseAction(obs); row.aiMs += performance.now() - start;
    assert.ok(H.legalAction(obs, action), `Illegal AI ${row.key}/${step}: ${JSON.stringify(action)}`);
    const p = obs.turn, player = row.players[p - 1], target = action.cells?.at(-1), air = ['airdrop', 'bombard'].includes(action.type);
    const local = target !== undefined && g.airports.some(a => H.distance(a.cell, target) <= 4);
    const ownConstruction = local && !air && ['deploy', 'engineer', 'shield', 'turret', 'bridge', 'reroute', 'exchange'].includes(action.type);
    const beforeSupply = air || ownConstruction ? H.computeSupply(g, p) : null;
    const beforeGap = beforeSupply ? gap(g, p, beforeSupply) : null, beforeDeficit = beforeSupply ? deficit(g, p, beforeSupply) : null;
    const victim = air && g.board[target] && g.board[target] !== p ? g.board[target] : 0;
    const enemyGap = victim ? gap(g, victim, H.computeSupply(g, victim)) : null;
    const oldBoard = g.board.slice(), oldRound = g.round, oldHolds = g.players.slice(1).map(p => p.goalActive);
    assert.ok(g.act(action)); row.actions++;
    const q = row.quarters[Math.floor(step / 500)]; q.actions++; q.meaningful += Number(!['rest', 'discard'].includes(action.type)); q.air += Number(air); q.deploy += Number(action.type === 'deploy'); q.rest += Number(action.type === 'rest');
    for (let i = 0; i < H.COUNT; i++) q.boardChanges += Number(oldBoard[i] !== g.board[i]);
    if (target !== undefined) row.spatial.actions[region(target)]++;
    if (local) { row.airport.localActions++; if (player.firstGoalMs === null) { row.airport.localBeforeFirstGoal++; player.airportActionsBeforeFirstGoal++; } }
    if (beforeSupply) {
      const afterSupply = H.computeSupply(g, p), afterGap = gap(g, p, afterSupply), afterDeficit = deficit(g, p, afterSupply);
      if (ownConstruction) row.airport[afterGap < beforeGap || afterDeficit < beforeDeficit ? 'localProgressAdvancing' : 'localNonAdvancing']++;
      if (air) {
        row.airUtility.actions++; row.airUtility[action.type === 'airdrop' ? 'airdrops' : 'bombardments']++;
        row.airUtility.ownFrontierImproved += Number(afterGap < beforeGap); row.airUtility.ownRouteDeficitReduced += Number(afterDeficit < beforeDeficit);
        if (action.type === 'airdrop') { row.airUtility.suppliedAirdrops += Number(afterSupply[target]); airTurrets.set(target, p); }
        if (victim) { const nextGap = gap(g, victim, H.computeSupply(g, victim)); row.airUtility.enemyFrontierSetBack += Number(nextGap > enemyGap); row.airUtility.enemyConnectionBroken += Number(enemyGap === 0 && nextGap > 0); }
      }
    }
    for (const event of g.events) if (event.id > lastEventId) {
      if (['capture', 'destroy'].includes(event.type)) {
        for (const cell of event.cells || []) { row.spatial.combat[region(cell)]++; q.combat++; }
        if (event.source === 'turret' && airTurrets.get(event.origin) === event.player) row.airUtility.airdropLaterTurretHits++;
      }
      if (event.type === 'goal-arrival') {
        const who = row.players[event.player - 1]; who.firstGoalMs ??= event.activeMs; who.arrivals++; who.goalPoints += event.points; q.arrivals++;
      }
      if (event.type === 'airport-unlocked') { row.airport.unlocks++; row.players[event.player - 1].firstAirportMs ??= event.activeMs; }
      if (event.type === 'airport-lost') row.airport.losses++;
    }
    lastEventId = g.events.at(-1)?.id || lastEventId;
    for (const [cell, owner] of airTurrets) if (g.board[cell] !== owner || !g.turrets.some(t => t.cell === cell && t.owner === owner)) airTurrets.delete(cell);
    if (g.round !== oldRound) for (const seat of H.PLAYERS) if (oldHolds[seat - 1] && g.players[seat].goalActive) { row.players[seat - 1].holdingRounds++; row.players[seat - 1].goalPoints += H.RULES.holdingScore; q.holdingRounds++; }
    trace.update(JSON.stringify([p, action, g.players.slice(1).map(p => p.score)]));
    g.advanceTime(300);
    if ((step + 1) % 6 === 0) sampleState((step + 1) % 30 === 0);
    if ((step + 1) % 100 === 0) {
      assert.equal(g.drawPile.length + g.discardPile.length + g.hands.reduce((s, h) => s + h.length, 0), 96);
      for (const seat of H.PLAYERS) { assert.ok(g.hands[seat].length <= H.RULES.handCap); assert.equal(g.board[g.players[seat].home], seat); assert.ok(g.players[seat].energy >= 0 && g.players[seat].supplies >= 0); }
    }
  }
  sampleState(true);
  assert.equal(g.activeMs, 600000); assert.equal(g.phase, 'over'); assert.ok(g.result);
  row.traceSha256 = trace.digest('hex'); row.telemetry = JSON.parse(JSON.stringify(g.telemetry)); row.winners = g.result.winners;
  for (const p of H.PLAYERS) { const player = row.players[p - 1]; player.score = g.players[p].score; player.winCredit = row.winners.includes(p) ? 1 / row.winners.length : 0; player.meanProgress = player.progressSum / player.progressSamples; delete player.progressSum; }
  assert.equal(row.players.reduce((s, p) => s + p.arrivals, 0), g.telemetry.goalArrivals);
  assert.equal(row.players.reduce((s, p) => s + p.holdingRounds, 0), g.telemetry.goalHoldingRounds);
  output.games.push(row); save(output);
  console.log(JSON.stringify({ mode, sample, completed: output.games.length, of: schedule.length, seed: config.seed, rotation: config.rotation,
    arrivals: g.telemetry.goalArrivals, holding: g.telemetry.goalHoldingRounds, connected: row.players.filter(p => p.firstGoalMs !== null).length,
    peakProgress: row.players.map(p => p.peakProgress), airportNonAdvancing: row.airport.localNonAdvancing, air: row.airUtility.actions,
    combat: row.spatial.combat, lateCombat: row.quarters[3].combat, aiMeanMs: row.aiMs / row.actions }));
}
output.complete = true; output.wallSeconds = (performance.now() - wallStart) / 1000; output.summary = aggregate(output.games, regionAreas);
save(output); console.log(JSON.stringify({ complete: true, output: outPath, wallSeconds: output.wallSeconds, summary: output.summary }));
