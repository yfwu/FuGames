'use strict';
// Recompute the confirmation intervals from recorded matches; no new games.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '../docs/hex-ai-2026-10-11');
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const first = read('heldout.json');
const confirmation = read('confirmation.json');
assert.equal(first.baseline, confirmation.baseline);
assert.equal(first.engineSha256, confirmation.engineSha256);

let state = 912731;
const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;

function interval(rows, value) {
  const seeds = [...new Set(rows.map(row => row.seed))];
  const clusters = seeds.map(seed => mean(rows.filter(row => row.seed === seed).map(value)));
  const samples = Array.from({ length: 10000 }, () =>
    mean(clusters.map(() => clusters[Math.floor(random() * clusters.length)]))
  ).sort((a, b) => a - b);
  return { difference: mean(clusters), ci95: [samples[249], samples[9749]] };
}

const three = confirmation.fixtures.filter(row => row.group === 'three-way');
const comparisons = Object.fromEntries(
  ['rush/cutter', 'rush/multi', 'cutter/multi'].map(pair => {
    const [a, b] = pair.split('/');
    return [pair, interval(three, row => row.winningProfile === a ? 1 : row.winningProfile === b ? -1 : 0)];
  })
);
const output = {
  releasedCommit: confirmation.baseline,
  confirmationGames: confirmation.primary.games,
  confirmationThreeWay: confirmation.threeWay,
  threeWaySignedDifferences: comparisons,
  mirrorMatrix: confirmation.matrix,
  priorDiscoveryGames: first.primary.games,
  optionalRuleGames: first.optionalRules.games,
  productionChanged: false
};
fs.writeFileSync(path.join(root, 'analysis.json'), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output, null, 2));
