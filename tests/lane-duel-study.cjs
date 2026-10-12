'use strict';
// Seat-swapped AI-vs-AI study for 雙線塔防. Usage: node tests/lane-duel-study.cjs [out.json] [seeds]
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'lane_duel.html'), 'utf8');
const engine = html.match(/<script id="lane-engine">([\s\S]*?)<\/script>/)[1];
const L = vm.runInNewContext(engine + '; LaneDuel;');
const out = process.argv[2], seeds = Number(process.argv[3] || 20), started = Date.now();
const report = { engineSha256: crypto.createHash('sha256').update(engine).digest('hex'), seeds: Array.from({ length: seeds }, (_, i) => 'study-' + (i + 1)), pairings: {} };
for (const [a, b] of [['hard', 'normal'], ['normal', 'easy'], ['hard', 'easy'], ['normal', 'normal']]) {
  const row = { games: 0, wins: { [a]: 0, [b]: 0 }, seatWins: [0, 0], draws: 0, minutes: [], sent: { runner: 0, brute: 0, swarm: 0 }, finalTowers: { arrow: 0, cannon: 0, frost: 0 }, timeouts: 0 };
  if (a === b) row.wins = { seat0: 0, seat1: 0 };
  // A mirror match is identical after a seat swap, so it uses twice as many distinct seeds instead.
  const schedule = a === b ? report.seeds.concat(report.seeds.map(x => x + '-mirror')).map(seed => [seed, false]) : report.seeds.flatMap(seed => [[seed, false], [seed, true]]);
  for (const [seed, swap] of schedule) {
    const difficulty = swap ? [b, a] : [a, b], g = new L.Game({ seed, ai: [true, true], difficulty }); g.start();
    while (g.phase === 'running') g.step();
    const w = g.result.winner; row.games++; row.minutes.push(+(g.tick / L.TPS / 60).toFixed(2));
    if (g.tick >= L.TIME_LIMIT) row.timeouts++;
    if (w === null) row.draws++; else { row.seatWins[w]++; row.wins[a === b ? 'seat' + w : difficulty[w]]++; }
    for (const s of g.sides) { for (const k in s.sent) row.sent[k] += s.sent[k]; for (const t of s.towers) row.finalTowers[t.type]++; }
  }
  const m = row.minutes.slice().sort((x, y) => x - y);
  row.minuteSummary = { min: m[0], median: m[m.length >> 1], max: m[m.length - 1] }; delete row.minutes;
  report.pairings[a + '_vs_' + b] = row;
  console.log(a, 'vs', b, JSON.stringify(row));
}
report.wallSeconds = +((Date.now() - started) / 1000).toFixed(1);
if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
