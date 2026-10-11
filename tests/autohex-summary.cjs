'use strict';
// Combine independent finished batches without treating correlated rotations as new seeds.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const root = path.join(__dirname, '..'), directory = path.join(root, 'docs/autohex-2026-10-11');
const reports = ['study-a.json', 'study-b.json'].map(name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')));
const currentSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'autohex-engine.js'))).digest('hex');
const games = reports.flatMap(r => r.matches), seeds = [...new Set(games.map(g => g.seed))], profiles = [...new Set(games.flatMap(g => g.profiles))];
for (const r of reports) {
  assert.equal(r.complete, true, 'Finish both batches before producing the final summary');
  assert.equal(r.engineSha256, currentSha256, 'Final summaries must describe the current engine');
  assert.equal(r.mode, 'accelerated model-time simulation');
}
assert.equal(games.length, 144); assert.equal(seeds.length, 24);
for (const seed of seeds) assert.deepEqual(games.filter(g => g.seed === seed).map(g => g.rotation).sort(), [0, 1, 2, 3, 4, 5]);
for (const g of games) { assert.equal(g.modelActiveMs, 600000); assert.equal(g.actions, 2000); }
const sum = (rows, f) => rows.reduce((a, row) => a + f(row), 0);
const range = a => { const s = a.slice().sort((a, b) => a - b); return { min: s[0], median: s[Math.floor(s.length / 2)], max: s.at(-1), mean: sum(s, x => x) / s.length }; };
const countActions = rows => {
  const result = {}; for (const row of rows) for (const [type, n] of Object.entries(row.actions)) result[type] = (result[type] || 0) + n;
  return result;
};
const quarters = Array.from({ length: 4 }, (_, i) => {
  const rows = games.map(g => g.quarters[i]);
  return { modelMinutes: [i * 2.5, (i + 1) * 2.5], games: rows.length, actions: countActions(rows),
    ...Object.fromEntries(['captures', 'removals', 'occupations', 'engineeredCells', 'boardChanges', 'meaningfulActions', 'cardUses', 'diplomacyActions', 'supplyRetreats', 'goalArrivals', 'goalHoldingRounds', 'turretShots'].map(key => [key, sum(rows, r => r[key])])) };
});
const output = { generatedAt: new Date().toISOString(), mode: 'accelerated model-time simulation', engineSha256: currentSha256,
  evidence: ['study-a.json', 'study-b.json', 'study-a.log', 'study-b.log', 'core-tests.log'],
  campaigns: games.length, independentSeeds: seeds.length, rotationsPerSeed: 6, acceptedActions: sum(games, g => g.actions), modelMsPerCampaign: 600000, modelMsPerAction: 300,
  batches: reports.map(r => ({ seedStart: r.config.seedStart, games: r.games, elapsedSeconds: r.elapsedSeconds, actionsPerSecond: r.actionsPerSecond, chooseActionMs: r.chooseActionMs })),
  winnersBySeat: [1, 2, 3, 4, 5, 6].map(p => games.filter(g => g.winner === p).length),
  winnersByStartingTurnOffset: [0, 1, 2, 3, 4, 5].map(offset => games.filter(g => g.winner && (g.winner - g.first + 6) % 6 === offset).length),
  winsByProfile: Object.fromEntries(profiles.map(profile => [profile, games.filter(g => g.winner && g.profiles[g.winner - 1] === profile).length])),
  sharedTopGames: games.filter(g => !g.winner).length, sharedTopFixtures: games.filter(g => !g.winner).map(g => ({ seed: g.seed, rotation: g.rotation, scores: g.scores, top: g.top })),
  scores: range(games.flatMap(g => g.scores)), scoreSpreadWithinGame: range(games.map(g => Math.max(...g.scores) - Math.min(...g.scores))),
  goals: { gamesWithArrival: games.filter(g => g.counts.goalArrivals > 0).length, totalArrivals: sum(games, g => g.counts.goalArrivals), totalHoldingRounds: sum(games, g => g.counts.goalHoldingRounds), arrivalsPerGame: range(games.map(g => g.counts.goalArrivals)),
    firstArrivalQuarter: [0, 1, 2, 3].map(q => games.filter(g => g.quarters.findIndex(x => x.goalArrivals > 0) === q).length), noArrivalFixtures: games.filter(g => !g.counts.goalArrivals).map(g => ({ seed: g.seed, rotation: g.rotation, scores: g.scores })) },
  totals: { actions: countActions(games.map(g => g.counts)), captures: sum(games, g => g.counts.captures), removals: sum(games, g => g.counts.removals), cardUses: sum(games, g => g.counts.cardUses), supplyRetreatedStones: sum(games, g => g.counts.supplyRetreats), engineeredCells: sum(games, g => g.counts.engineeredCells), diplomacyActions: sum(games, g => g.counts.diplomacyActions) },
  quarters,
  lateGame: { modelMinutes: [7.5, 10], meaningfulActionsPerGame: range(games.map(g => g.lateMeaningfulActions)), boardChangesPerGame: range(games.map(g => g.quarters[3].boardChanges)), captureTransfersPerGame: range(games.map(g => g.quarters[3].captures)), cardUsesPerGame: range(games.map(g => g.quarters[3].cardUses)), passiveGames: games.filter(g => g.passiveLateGame).length, maximumQuietModelMs: Math.max(...games.map(g => g.maxQuietModelMs)) },
  bounds: { maxFootprint: Math.max(...games.flatMap(g => g.peakFootprint)), maxEvents: Math.max(...games.map(g => g.bounds.maxEvents)), maxBridges: Math.max(...games.map(g => g.bounds.maxBridges)), maxTurrets: Math.max(...games.map(g => g.bounds.maxTurrets)), maxOffers: Math.max(...games.map(g => g.bounds.maxOffers)), maxAlliances: Math.max(...games.map(g => g.bounds.maxAlliances)) },
  limitations: ['144 campaigns include six correlated seat/profile rotations per seed; independent seed count is 24.', 'All 600,000 ms clocks were accelerated model clocks. This summary does not prove ten minutes of real unpaused foreground browser operation.',
    'Wins are descriptive, not a balance guarantee or significance claim. Draws use shared top score across all factions.', 'Active board changes do not by themselves prove strategically diverse play; repeated border exchanges can dominate score.',
    'Ownership-transfer captures include both cells of an enemy exchange; engine telemetry records that card as one capture. Removals include destruction, withdrawal, and supply attrition.',
    'Node action timings were measured while both batches and browser QA shared the container. They exclude rendering and browser scheduling.', 'The initial development smoke and interrupted development batches are excluded. Their engine hashes differ from the frozen final engine.'] };
fs.writeFileSync(path.join(directory, 'simulation-summary.json'), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output, null, 2));
