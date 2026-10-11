'use strict';
// Historical visual-only proof. The current strategic engine is never imported.
// node tests/autohex-visual-equivalence.cjs <captured-evidence.json> <new-evidence.json>
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
assert.equal(process.argv.length, 4, 'Pass explicit captured visual-only evidence JSON and output JSON paths');
const root = path.join(__dirname, '..'), snapshot = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), outputPath = path.resolve(process.argv[3]);
const sha = source => crypto.createHash('sha256').update(source).digest('hex');
assert.ok(snapshot.mode.startsWith('visual-only intermediate')); assert.equal(typeof snapshot.comparedEngineSource, 'string');
assert.equal(sha(snapshot.comparedEngineSource), snapshot.currentEngineSha256, 'Captured source does not match its recorded hash');
const baselineSource = execFileSync('git', ['show', `${snapshot.baselineCommit}:autohex-engine.js`], { cwd: root, encoding: 'utf8' });
assert.equal(sha(baselineSource), snapshot.baselineEngineSha256);
function compile(source, name) { const loaded = new Module(path.join(root, name), module); loaded.filename = path.join(root, name); loaded._compile(source, loaded.filename); return loaded.exports; }
const B = compile(baselineSource, 'historical-autohex-baseline.cjs'), H = compile(snapshot.comparedEngineSource, 'historical-autohex-visual.cjs');
const fields = ['seed', 'first', 'rotation', 'durationMs', 'phase', 'turn', 'ply', 'round', 'activeMs', 'sandbox', 'result', 'board', 'terrain', 'roads', 'anchors', 'shields', 'unsupplied', 'bridges', 'turrets', 'players', 'hands', 'drawPile', 'discardPile', 'telemetry', 'recentActions', 'lastAction', '_turnStarted', '_offerId'];
function state(g) {
  const result = Object.fromEntries(fields.map(key => [key, g[key]]));
  result.events = g.events.map(event => {
    const copy = { ...event }; delete copy.id; delete copy.origin;
    if (copy.type === 'shield-block') { delete copy.from; delete copy.source; }
    if (copy.type === 'supply-retreat') delete copy.cells;
    return copy;
  });
  return JSON.stringify(result);
}
const started = performance.now(), matches = [], seeds = [101, 8020, 15939, 1000003, 1007922, 1015841];
function save(complete) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify({ generatedAt: new Date().toISOString(), complete, baselineCommit: snapshot.baselineCommit,
    baselineEngineSha256: snapshot.baselineEngineSha256, currentEngineSha256: snapshot.currentEngineSha256, comparedEngineSource: snapshot.comparedEngineSource,
    mode: 'visual-only intermediate accelerated model-time baseline equivalence', independentSeeds: seeds.length, configurationsPerSeed: 2, campaigns: matches.length,
    acceptedActionsPerVersion: matches.reduce((n, m) => n + m.actions, 0), modelMsPerCampaign: 600000, stepMs: 300,
    comparedEveryAction: ['chosen action', ...fields, 'events after removal of new visual metadata'], elapsedSeconds: (performance.now() - started) / 1000,
    limitations: ['This compares the explicitly captured intermediate visual source, never the current strategic engine. It does not claim subsequent rule changes preserve the baseline.',
      'This is an exact deterministic equivalence check on 12 configurations, not a balance study or real foreground browser timing test.',
      'Only new event IDs, origins, shield-block owner/source, and supply-retreat cell lists are ignored in event comparisons. All gameplay state and existing event fields must remain equal.'], matches }, null, 2) + '\n');
}
for (let s = 0; s < seeds.length; s++) for (let variant = 0; variant < 2; variant++) {
  const options = { seed: seeds[s], rotation: (s + variant * 3) % 6, first: (s + variant * 2) % 6 + 1 }, old = new B.Game(options), now = new H.Game(options), trace = crypto.createHash('sha256');
  old.start(); now.start(); assert.equal(state(now), state(old)); let actions = 0;
  while (old.phase === 'running') {
    const a = B.chooseAction(old.observation()), b = H.chooseAction(now.observation());
    assert.equal(JSON.stringify(b), JSON.stringify(a), `Action mismatch: ${JSON.stringify(options)} ply ${actions}`);
    assert.ok(old.act(a)); assert.ok(now.act(b)); trace.update(JSON.stringify(a) + '\n');
    assert.equal(state(now), state(old), `State mismatch after action ${actions}`);
    old.advanceTime(300); now.advanceTime(300); assert.equal(state(now), state(old), `Clock/result mismatch after action ${actions}`);
    assert.ok(++actions <= 2000);
  }
  assert.equal(actions, 2000); assert.equal(now.activeMs, 600000); assert.equal(now.phase, 'over');
  matches.push({ ...options, actions, activeMs: now.activeMs, actionTraceSha256: trace.digest('hex'), finalGameplaySha256: sha(state(now)), result: now.result, telemetry: now.telemetry });
  save(matches.length === 12); console.log(`Equivalent campaigns ${matches.length}/12: ${JSON.stringify(options)}`);
}
