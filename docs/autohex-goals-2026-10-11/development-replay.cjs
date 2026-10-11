'use strict';
// Reproduce the engine author's six paired DEVELOPMENT campaigns. This is not
// the independent heldout study in tests/autohex-goal-study.cjs.
const fs = require('node:fs'), path = require('node:path');
const Module = require('node:module'), cp = require('node:child_process'), crypto = require('node:crypto');
const repo = path.resolve(__dirname, '../..');
const options = { baselineRef: 'f3d50e73a8bbb90ee4eda2b6386b4cac98939446',
  baselineEngine: null, candidateEngine: path.join(repo, 'autohex-engine.js'),
  outputPrefix: path.join(__dirname, 'development-replay'), check: false };
const values = { '--baseline-ref': 'baselineRef', '--baseline-engine': 'baselineEngine',
  '--candidate-engine': 'candidateEngine', '--output-prefix': 'outputPrefix' };
function usage() {
  return 'node docs/autohex-goals-2026-10-11/development-replay.cjs [--check]\n' +
    '  [--baseline-ref GIT_REV | --baseline-engine FILE]\n' +
    '  [--candidate-engine FILE] [--output-prefix PATH]\n' +
    'Relative FILE/PATH arguments resolve from the current working directory.\n' +
    'The output prefix receives .json and .log files; --check only loads and hashes sources.';
}
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  if (key === '--help') { console.log(usage()); process.exit(0); }
  if (key === '--check') { options.check = true; continue; }
  if (!values[key] || !process.argv[i + 1] || process.argv[i + 1].startsWith('--')) throw Error('Invalid argument: ' + key + '\n' + usage());
  options[values[key]] = process.argv[++i];
}
function load(source, name) {
  const filename = path.join(repo, 'development-' + name + '.cjs'), module = new Module(filename);
  module.filename = filename; module.paths = Module._nodeModulePaths(repo);
  module._compile(source, filename); return module.exports;
}
const sources = {
  before: options.baselineEngine ? fs.readFileSync(path.resolve(options.baselineEngine), 'utf8') :
    cp.execFileSync('git', ['show', options.baselineRef + ':autohex-engine.js'], { cwd: repo, encoding: 'utf8' }),
  after: fs.readFileSync(path.resolve(options.candidateEngine), 'utf8')
};
// Load both complete sources once. Concurrent disk edits cannot alter a run.
const engines = Object.fromEntries(Object.entries(sources).map(([side, source]) => [side, load(source, side)]));
const result = {
  label: 'engine-author-development-replay', mode: 'development; accelerated model-time; not heldout', complete: false,
  baseline: options.baselineEngine ? path.resolve(options.baselineEngine) : options.baselineRef,
  candidate: path.resolve(options.candidateEngine),
  hashes: Object.fromEntries(Object.entries(sources).map(([side, source]) => [side, crypto.createHash('sha256').update(source).digest('hex')])),
  schedule: [17, 29, 43, 61, 83, 107].map((seed, rotation) => ({ seed, rotation, first: rotation + 1, actions: 2000, activeMsPerAction: 300 })),
  regionCells: [127, 144, 756], games: []
};
if (options.check) { console.log(JSON.stringify({ ...result, complete: null, games: undefined }, null, 2)); process.exit(0); }
const prefix = path.resolve(options.outputPrefix);
fs.mkdirSync(path.dirname(prefix), { recursive: true }); fs.writeFileSync(prefix + '.log', '');
const save = () => fs.writeFileSync(prefix + '.json', JSON.stringify(result, null, 2) + '\n');
save();
for (const side of ['before', 'after']) {
  const H = engines[side];
  for (const { seed, rotation, first } of result.schedule) {
    const g = new H.Game({ seed, rotation, first }); g.start();
    let ai = 0, lateCombat = 0, lateAir = 0, lateMeaningful = 0, firstGoal = null;
    const distances = [], regions = [0, 0, 0], minimumDistance = Array(7).fill(36);
    for (let n = 0; n < 2000; n++) {
      const observation = g.observation(), started = performance.now(), action = H.chooseAction(observation);
      ai += performance.now() - started;
      if (!H.legalAction(observation, action)) throw Error(JSON.stringify({ side, seed, n, action, reason: 'illegal choice' }));
      const combat = g.telemetry.captures + g.telemetry.destroyed, air = g.telemetry.airdrops + g.telemetry.bombardments;
      const eventId = g.events.at(-1)?.id || 0;
      if (!g.act(action)) throw Error(JSON.stringify({ side, seed, n, action, reason: 'rejected action' }));
      g.advanceTime(300);
      if (n >= 1500) {
        lateCombat += g.telemetry.captures + g.telemetry.destroyed - combat;
        lateAir += g.telemetry.airdrops + g.telemetry.bombardments - air;
        if (!['rest', 'discard'].includes(action.type)) lateMeaningful++;
      }
      if (firstGoal === null && g.telemetry.goalArrivals) firstGoal = n + 1;
      for (const event of g.events) if (event.id > eventId && ['capture', 'destroy'].includes(event.type)) {
        for (const i of event.cells || []) {
          const c = H.CELLS[i], radius = Math.max(Math.abs(c.q), Math.abs(c.r), Math.abs(c.s));
          regions[radius <= 6 ? 0 : radius <= 9 ? 1 : 2]++;
        }
      }
      if (n % 30 === 29) {
        let sum = 0;
        for (const player of H.PLAYERS) {
          const supply = H.computeSupply(g, player); let distance = 36;
          for (let i = 0; i < H.COUNT; i++) if (supply[i]) distance = Math.min(distance, 18 + H.CELLS[i][g.players[player].axis] * g.players[player].sign);
          sum += distance; minimumDistance[player] = Math.min(minimumDistance[player], distance);
        }
        distances.push(sum / 6);
      }
    }
    const row = {
      side, seed, rotation, airportRadius: H.distance(H.index(0, 0), g.airports[0].cell),
      goals: g.telemetry.goalArrivals, holding: g.telemetry.goalHoldingRounds, firstGoal,
      perPlayerGoals: H.PLAYERS.map(p => g.players[p].goals), minDistance: minimumDistance.slice(1),
      meanDistance: distances.reduce((a, b) => a + b, 0) / distances.length,
      lateCombat, lateAir, lateMeaningful, airUnlocks: g.telemetry.airportUnlocks,
      airLosses: g.telemetry.airportLosses, airdrops: g.telemetry.airdrops, bombards: g.telemetry.bombardments,
      regions, meanAI: ai / 2000, scores: H.PLAYERS.map(p => g.players[p].score)
    };
    result.games.push(row); save();
    const line = JSON.stringify(row); fs.appendFileSync(prefix + '.log', line + '\n'); console.log(line);
  }
}
result.complete = true; save();
