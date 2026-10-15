'use strict';
// Seeded AI-vs-AI study for 三路前線. Usage: node tests/front-line-study.cjs [seeds]
// Writes docs/front-line-2026-10-12/ai-study.json.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'front_line.html'), 'utf8');
const F = vm.runInNewContext(html.match(/<script id="front-engine">([\s\S]*?)<\/script>/)[1] + '; FrontLine;');
const seeds = Number(process.argv[2]) || 20;
const pairs = [['normal', 'normal'], ['hard', 'normal'], ['normal', 'easy'], ['hard', 'easy']];
const report = { seeds, pairs: [] };
for (const [a, b] of pairs) {
  const row = { a, b, games: 0, wins: { [a + '@0']: 0, [a + '@1']: 0, [b + '@0']: 0, [b + '@1']: 0, draw: 0 }, minutes: [], timeouts: 0, totals: { built: 0, launched: 0, cards: 0, bombs: 0, destroyed: 0, engineers: 0 } };
  if (a === b) row.wins = { seat0: 0, seat1: 0, draw: 0 };
  for (let i = 0; i < seeds; i++) for (const swap of a === b ? [false] : [false, true]) {
    const difficulty = swap ? [b, a] : [a, b];
    const g = new F.Game({ seed: 'study' + i, ai: [true, true], difficulty }); g.start();
    let engineers = 0;
    while (g.phase === 'running') { g.step(); engineers += g.events.filter(e => e.type === 'engineer').length; }
    const w = g.result.winner;
    if (w === null) row.wins.draw++;
    else if (a === b) row.wins['seat' + w]++;
    else row.wins[difficulty[w] + '@' + w]++;
    row.games++; row.minutes.push(+(g.result.tick / F.TPS / 60).toFixed(2));
    if (g.result.tick >= F.TIME_LIMIT) row.timeouts++;
    for (const s of g.sides) { row.totals.built += s.built; row.totals.launched += s.launched; row.totals.cards += s.cardsUsed; row.totals.bombs += s.bombs; row.totals.destroyed += s.destroyed; }
    row.totals.engineers += engineers;
  }
  row.minutes.sort((x, y) => x - y);
  row.medianMinutes = row.minutes[row.minutes.length >> 1];
  if (a !== b) row.strongerWinRate = +((row.wins[a + '@0'] + row.wins[a + '@1']) / row.games).toFixed(3);
  for (const k of Object.keys(row.totals)) row.totals[k] = +(row.totals[k] / row.games).toFixed(1);
  delete row.minutes;
  report.pairs.push(row);
  console.log(JSON.stringify(row));
}
const out = path.join(root, 'docs/front-line-2026-10-12');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'ai-study.json'), JSON.stringify(report, null, 2) + '\n');
