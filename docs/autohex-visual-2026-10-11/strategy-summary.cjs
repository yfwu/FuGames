'use strict';
const fs = require('node:fs'), path = require('node:path');
const sample = process.argv[2] || 'heldout';
const read = mode => JSON.parse(fs.readFileSync(path.join(__dirname, `strategy-${mode}-${sample}.json`), 'utf8'));
const before = read('before'), after = read('after');
const sum = values => values.reduce((a, b) => a + b, 0);
const mean = values => sum(values) / values.length;
const range = values => [Math.min(...values), Math.max(...values)];
function summarize(data) {
  const games = data.games, n = games.length, metric = key => games.map(g => g.telemetry[key] || 0);
  const combat = [0, 1, 2].map(i => sum(games.map(g => g.combatRegions[i])));
  const occupation = [0, 1, 2].map(i => sum(games.map(g => g.occupation[i])));
  const samples = sum(games.map(g => g.occupationSamples));
  const totalCombat = sum(combat), totalOccupation = sum(occupation);
  const byProfile = {}, bySeat = {};
  for (const game of games) for (const p of game.winners) {
    bySeat[p] = (bySeat[p] || 0) + 1 / game.winners.length;
    const profile = game.winnerProfiles[game.winners.indexOf(p)]; byProfile[profile] = (byProfile[profile] || 0) + 1 / game.winners.length;
  }
  return { games: n, sourceSha256: data.sha256,
    combatPerGame: combat.map(c => c / n), combatShare: combat.map(c => c / totalCombat), combatPerCellPerGame: combat.map((c, i) => c / data.regionCells[i] / n),
    centerToOuterCombatDensity: (combat[0] / data.regionCells[0]) / (combat[2] / data.regionCells[2]),
    occupationShare: occupation.map(c => c / totalOccupation), meanOccupiedCells: occupation.map(c => c / samples), occupationDensity: occupation.map((c, i) => c / samples / data.regionCells[i]),
    combatBySectorPerGame: Array.from({ length: 6 }, (_, i) => mean(games.map(g => g.combatSectors[i]))),
    meanFactionSectorCoverage: mean(games.flatMap(g => g.playerSectors)), sectorCoverageRange: range(games.flatMap(g => g.playerSectors)), gamesWithCombatInAllSectors: games.filter(g => g.combatSectors.every(n => n > 0)).length,
    goalArrivals: sum(metric('goalArrivals')), goalRange: range(metric('goalArrivals')), gamesWithGoals: metric('goalArrivals').filter(v => v > 0).length, goalHoldingRounds: sum(metric('goalHoldingRounds')),
    lastQuarterMean: { meaningful: mean(games.map(g => g.quarters[3].meaningful)), combat: mean(games.map(g => g.quarters[3].combat)), goals: mean(games.map(g => g.quarters[3].goals)), air: mean(games.map(g => g.quarters[3].air)) },
    lastQuarterRange: { meaningful: range(games.map(g => g.quarters[3].meaningful)), combat: range(games.map(g => g.quarters[3].combat)), air: range(games.map(g => g.quarters[3].air)) },
    airportUnlocks: sum(metric('airportUnlocks')), airportLosses: sum(metric('airportLosses')), airdrops: sum(metric('airdrops')), bombardments: sum(metric('bombardments')),
    airportUnlockRange: range(metric('airportUnlocks')), airportLossRange: range(metric('airportLosses')), airActionRange: range(games.map(g => (g.telemetry.airdrops || 0) + (g.telemetry.bombardments || 0))),
    meanConcurrentAirports: sum(games.map(g => g.activeAirportSamples)) / samples, peakAirports: Math.max(...games.map(g => g.peakActiveAirports || 0)),
    meanAirUsers: mean(games.map(g => g.airUsers?.length || 0)), meanSuppliedDepots: sum(games.map(g => g.depotSamples)) / samples, depotControls: sum(metric('depotControls')),
    neutralRemoved: sum(metric('neutralRemoved')), neutralBlocks: sum(metric('neutralBlocks')), fortifications: sum(metric('fortifications')),
    meanFinalLead: mean(games.map(g => g.finalLead)), finalLeadRange: range(games.map(g => g.finalLead)), maxObservedLead: Math.max(...games.map(g => g.maxLead)),
    halfwayLeaderAlsoWins: games.filter(g => g.winners.includes(g.halfwayLeader)).length, fractionalWinsBySeat: bySeat, fractionalWinsByProfile: byProfile,
    meanAiMs: mean(games.map(g => g.aiMeanMs)), gameMeanAiRangeMs: range(games.map(g => g.aiMeanMs)) };
}
const result = { sample, timing: before.timing, conditionsMatch: JSON.stringify(before.games.map(g => [g.seed, g.rotation, g.first])) === JSON.stringify(after.games.map(g => [g.seed, g.rotation, g.first])), regions: before.regions, regionCells: before.regionCells, before: summarize(before), after: summarize(after) };
fs.writeFileSync(path.join(__dirname, `strategy-summary-${sample}.json`), JSON.stringify(result, null, 2) + '\n');
const b = result.before, a = result.after, f = n => n.toFixed(2), pct = n => (n * 100).toFixed(1) + '%';
const report = `# AutoHex strategic comparison — ${sample}

The paired sample contains ${b.games} baseline campaigns and ${a.games} expanded campaigns with identical seed, first-seat and profile-rotation conditions. Conditions match: ${result.conditionsMatch}. Each campaign ran 2,000 legal AI actions with 300 model active-ms per action. This is accelerated model-time evidence, not a ten-minute foreground browser run.

Baseline: git revision 13c94a8, engine SHA256 ${b.sourceSha256}.
Expanded engine: SHA256 ${a.sourceSha256}. The final candidate was frozen before its held-out sample; no held-out observations were used to retune it.

## Spatial fighting and occupation

Regions are center (cube radius ≤6; ${result.regionCells[0]} cells), middle (7–9; ${result.regionCells[1]} cells), and outer (10–18; ${result.regionCells[2]} cells). Combat counts the cells named by capture/destruction events, including turret and bombard damage. An exchange affects two named cells and therefore contributes two spatial impacts. Neutral removals and supply retreats are excluded from combat. Occupation is sampled every 30 actions. Per-cell measures correct for the much larger outer region.

| Measure | Baseline | Expanded |
|---|---:|---:|
| Center combat impacts per cell per campaign | ${f(b.combatPerCellPerGame[0])} | ${f(a.combatPerCellPerGame[0])} |
| Middle combat impacts per cell per campaign | ${f(b.combatPerCellPerGame[1])} | ${f(a.combatPerCellPerGame[1])} |
| Outer combat impacts per cell per campaign | ${f(b.combatPerCellPerGame[2])} | ${f(a.combatPerCellPerGame[2])} |
| Center / outer combat-density ratio | ${f(b.centerToOuterCombatDensity)} | ${f(a.centerToOuterCombatDensity)} |
| Raw outer share of combat | ${pct(b.combatShare[2])} | ${pct(a.combatShare[2])} |
| Center occupation density | ${pct(b.occupationDensity[0])} | ${pct(a.occupationDensity[0])} |
| Outer occupation density | ${pct(b.occupationDensity[2])} | ${pct(a.occupationDensity[2])} |
| Mean faction spatial-action sector coverage, out of 6 | ${f(b.meanFactionSectorCoverage)} | ${f(a.meanFactionSectorCoverage)} |
| Campaigns with combat in all six sectors | ${b.gamesWithCombatInAllSectors}/${b.games} | ${a.gamesWithCombatInAllSectors}/${a.games} |

Sector coverage counts sectors reached by a faction's spatial actions; it is not proof that all six sectors belonged to one connected route. Region/sector raw counts and every campaign are available in the JSON evidence.

## Goals, late activity, facilities and counterplay

| Measure | Baseline | Expanded |
|---|---:|---:|
| Goal arrivals, total | ${b.goalArrivals} | ${a.goalArrivals} |
| Campaigns with at least one arrival | ${b.gamesWithGoals}/${b.games} | ${a.gamesWithGoals}/${a.games} |
| Supplied goal-holding rounds, total | ${b.goalHoldingRounds} | ${a.goalHoldingRounds} |
| Final-quarter meaningful actions, mean / 500 | ${f(b.lastQuarterMean.meaningful)} | ${f(a.lastQuarterMean.meaningful)} |
| Final-quarter combat impacts, mean | ${f(b.lastQuarterMean.combat)} | ${f(a.lastQuarterMean.combat)} |
| Final-quarter air actions, mean | ${f(b.lastQuarterMean.air)} | ${f(a.lastQuarterMean.air)} |

The expanded sample recorded ${a.airportUnlocks} airport activations, ${a.airportLosses} losses of active status, ${a.airdrops} airdrops and ${a.bombardments} bombardments. Repeated activations of the same airport count separately. Mean concurrent active airports were ${f(a.meanConcurrentAirports)} of six; peak observed concurrency was ${a.peakAirports}. Mean distinct factions actually using air actions per campaign were ${f(a.meanAirUsers)} of six. Supplied depot control averaged ${f(a.meanSuppliedDepots)} of six, with ${a.depotControls} new/recovered control events. Neutral events removed ${a.neutralRemoved} stones and were blocked ${a.neutralBlocks} times by shields or fortification. Fortification counter: ${a.fortifications} non-anchor stones first reaching age 31.

These counters demonstrate actual activation, attack and loss, not merely visible facility markers. A lost center, local 12-stone threshold, or home-supply route immediately removes airport access. Stock, turret/footprint caps and the shared cooldown apply to every faction; multiple depots/airports do not stack the resource bonus or cooldown.

## Score concentration and limits

Mean final top-to-second score lead: baseline ${f(b.meanFinalLead)}, expanded ${f(a.meanFinalLead)}. Expanded final leads ranged ${a.finalLeadRange[0]}–${a.finalLeadRange[1]}; maximum sampled in-game lead was ${a.maxObservedLead}. The halfway leader also finished first in ${b.halfwayLeaderAlsoWins}/${b.games} baseline campaigns and ${a.halfwayLeaderAlsoWins}/${a.games} expanded campaigns. Fractional wins by seat and AI profile are in the summary JSON; tied winners each contribute an equal fraction.

This finite sample does not establish balance or eliminate snowballing. Goal frequency, score spread and sector activity vary by seed. The comparison evaluates the facility/AI/neutral-event expansion as one bundle and cannot isolate each feature's causal contribution. AI profiles differ in public tactical preferences, not energy, cards, stock income or scoring privileges. No fixed winner, catch-up score, or identity subsidy is used.

Mean measured chooseAction time per campaign averaged ${f(b.meanAiMs)} ms baseline and ${f(a.meanAiMs)} ms expanded. These runs shared CPU with other studies/browser validation and are not an isolated rendering benchmark. Root's final browser performance and real-time campaign evidence are separate.

## Reproduction

From the repository root, run:

\`\`\`sh
node docs/autohex-visual-2026-10-11/strategy-study.cjs before heldout
node docs/autohex-visual-2026-10-11/strategy-study.cjs after heldout
node docs/autohex-visual-2026-10-11/strategy-summary.cjs heldout
\`\`\`

The baseline is compiled in memory from git show 13c94a8:autohex-engine.js and therefore needs that history. Development baseline: six seeds × six rotations; disjoint tuning: seeds 211/307/401 × rotations 0/2/4. The exploratory expanded development run was stopped after 19 campaigns to reduce CPU contention during real-time acceptance and is explicitly marked partial. The final claims above use the complete paired held-out sample, whose seeds are 701/809/907/1009/1103/1201 with all six rotations and first seat rotation + 1.
`;
fs.writeFileSync(path.join(__dirname, `strategy-report-${sample}.md`), report);
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
