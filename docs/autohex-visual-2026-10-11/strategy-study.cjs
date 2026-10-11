'use strict';
// Accelerated model-time evidence, never a substitute for foreground real time.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { execFileSync } = require('node:child_process');
const Module = require('node:module');
const args = process.argv.slice(2);
const mode = args[0] || 'after';
const sample = args[1] || 'development';
const modulePath = path.resolve(__dirname, '../../autohex-engine.js');
const source = mode === 'before' ? execFileSync('git', ['show', '13c94a8:autohex-engine.js'], { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8' }) : fs.readFileSync(modulePath, 'utf8');
const compiled = new Module(modulePath, module); compiled.filename = modulePath; compiled.paths = module.paths; compiled._compile(source, modulePath);
const H = compiled.exports;
const seeds = sample === 'heldout' ? [701, 809, 907, 1009, 1103, 1201] : sample === 'tuning' ? [211, 307, 401] : [17, 31, 43, 59, 71, 89];
const rotations = sample === 'tuning' ? [0, 2, 4] : [0, 1, 2, 3, 4, 5];
const regions = ['center', 'middle', 'outer'];
const radius = i => Math.max(Math.abs(H.CELLS[i].q), Math.abs(H.CELLS[i].r), Math.abs(H.CELLS[i].s));
const region = i => radius(i) <= 6 ? 0 : radius(i) >= 10 ? 2 : 1;
const sector = i => (Math.round(Math.atan2(H.CELLS[i].y, H.CELLS[i].x) / (Math.PI / 3)) + 6) % 6;
const regionCells = [0, 0, 0]; H.CELLS.forEach(c => regionCells[region(c.i)]++);
const output = { mode, sample, source: mode === 'before' ? 'git:13c94a8:autohex-engine.js' : 'autohex-engine.js', sha256: crypto.createHash('sha256').update(source).digest('hex'),
  timing: 'Accelerated 2000 actions × 300 model active milliseconds. Not a real-time browser run.', seeds, rotations, regions, regionCells, games: [] };
for (const seed of seeds) for (const rotation of rotations) {
  const g = new H.Game({ seed, rotation, first: rotation + 1 }); g.start();
  const row = { seed, rotation, first: rotation + 1, actions: 0, aiMs: 0, meaningful: 0, actionRegions: [0, 0, 0], combatRegions: [0, 0, 0], combatSectors: Array(6).fill(0), occupation: [0, 0, 0], occupationSectors: Array(6).fill(0), occupationSamples: 0,
    playerSectors: Array.from({ length: 6 }, () => new Set()), quarters: Array.from({ length: 4 }, () => ({ actions: 0, meaningful: 0, combat: 0, goals: 0, air: 0 })), maxLead: 0, activeAirportSamples: 0, peakActiveAirports: 0, depotSamples: 0,
    airportUsers: new Set(), airUsers: new Set(), playerAirportSamples: Array(6).fill(0), playerDepotSamples: Array(6).fill(0) };
  let previousGoals = 0, lastEvent = g.events.at(-1);
  for (let step = 0; step < 2000; step++) {
    const observation = g.observation(), start = performance.now(), action = H.chooseAction(observation);
    row.aiMs += performance.now() - start;
    if (!H.legalAction(observation, action) || !g.act(action)) throw new Error(`Illegal AI action seed=${seed} rotation=${rotation} step=${step}: ${JSON.stringify(action)}`);
    const quarter = row.quarters[Math.min(3, Math.floor(step / 500))]; quarter.actions++; row.actions++;
    if (!['rest', 'discard'].includes(action.type)) { row.meaningful++; quarter.meaningful++; }
    if (action.cells?.length) { const target = action.cells.at(-1); row.actionRegions[region(target)]++; row.playerSectors[observation.turn - 1].add(sector(target)); }
    const startIndex = g.events.indexOf(lastEvent);
    for (const event of g.events.slice(startIndex + 1)) if (['capture', 'destroy'].includes(event.type)) for (const i of event.cells || []) {
      row.combatRegions[region(i)]++; row.combatSectors[sector(i)]++; quarter.combat++;
    }
    lastEvent = g.events.at(-1);
    const goals = g.telemetry.goalArrivals || 0; quarter.goals += goals - previousGoals; previousGoals = goals;
    if (['airdrop', 'bombard'].includes(action.type)) { quarter.air++; row.airUsers.add(observation.turn); }
    if (step === 999) row.halfwayLeader = H.PLAYERS.slice().sort((a, b) => g.players[b].score - g.players[a].score)[0];
    if (step % 30 === 0) {
      row.occupationSamples++;
      for (const c of H.CELLS) if (g.board[c.i]) { row.occupation[region(c.i)]++; row.occupationSectors[sector(c.i)]++; }
      const activeAirports = (g.airports || []).filter(a => a.active);
      row.activeAirportSamples += activeAirports.length; row.peakActiveAirports = Math.max(row.peakActiveAirports, activeAirports.length);
      for (const a of activeAirports) { row.airportUsers.add(a.owner); row.playerAirportSamples[a.owner - 1]++; }
      for (const d of g.depots || []) if (d.owner && d.supplied) row.playerDepotSamples[d.owner - 1]++;
      row.depotSamples += (g.depots || []).filter(d => d.owner && d.supplied).length;
      const scores = g.players.slice(1).map(p => p.score).sort((a, b) => b - a); row.maxLead = Math.max(row.maxLead, scores[0] - scores[1]);
    }
    g.advanceTime(300);
  }
  row.scores = g.players.slice(1).map(p => p.score); row.goals = g.players.slice(1).map(p => p.goals);
  row.winners = g.result.winners; row.winnerProfiles = row.winners.map(p => g.players[p].profile.name);
  const scores = row.scores.slice().sort((a, b) => b - a); row.finalLead = scores[0] - scores[1];
  row.playerSectors = row.playerSectors.map(s => s.size); row.airportUsers = [...row.airportUsers]; row.airUsers = [...row.airUsers]; row.aiMeanMs = row.aiMs / row.actions; delete row.aiMs;
  row.telemetry = g.telemetry; row.finalAirports = g.airports || []; row.finalDepots = g.depots || [];
  output.games.push(row);
  fs.writeFileSync(path.join(__dirname, `strategy-${mode}-${sample}.json`), JSON.stringify(output, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ mode, sample, seed, rotation, goals: row.goals.reduce((a, b) => a + b), combat: row.combatRegions, lastQuarter: row.quarters[3], airports: g.telemetry.airportUnlocks || 0, air: (g.telemetry.airdrops || 0) + (g.telemetry.bombardments || 0), ms: Number(row.aiMeanMs.toFixed(2)) }) + '\n');
}
