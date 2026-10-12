'use strict';
// Standalone AutoHex AI diversity study; excluded from the Node test glob.
// Usage: node tests/autohex-diversity-study.cjs --seeds 11,12 --actions 1200 [--ref <git-ref>] [--output file]
// Measures where each faction spends its stones and fights, which intents it
// pursues, and how much enemy supply it severs, so behavioural variety can be
// compared between engine revisions on identical seeds.
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2), flags = {};
for (let i = 0; i < argv.length; i += 2) flags[argv[i].replace(/^--/, '')] = argv[i + 1];
const seeds = (flags.seeds || '11,12,13').split(',');
const actions = Number(flags.actions || 1200);
function load(ref) {
  if (!ref) { for (const f of ['hex-strategies.js', 'autohex-planner.js', 'hex-core.js', 'autohex-engine.js']) delete require.cache[path.join(ROOT, f)]; return require(path.join(ROOT, 'autohex-engine.js')); }
  // Compile one historical revision's four modules together in memory.
  const cache = {};
  const req = name => {
    const file = name.replace(/^\.\//, '');
    if (cache[file]) return cache[file].exports;
    const m = new Module(path.join(ROOT, file)); cache[file] = m; m.filename = path.join(ROOT, file);
    m.require = req; m.paths = module.paths;
    m._compile(execFileSync('git', ['show', ref + ':' + file], { cwd: ROOT, encoding: 'utf8' }), m.filename);
    return m.exports;
  };
  for (const f of ['hex-strategies.js', 'autohex-planner.js']) global[f === 'hex-strategies.js' ? 'HexStrategies' : 'AutoHexPlanner'] = req('./' + f);
  const core = req('./hex-core.js'); delete global.HexStrategies; delete global.AutoHexPlanner;
  return core.create({ mode: 'auto', playerCount: 6 });
}
const H = load(flags.ref);
const ring = i => { const c = H.CELLS[i]; return Math.max(Math.abs(c.q), Math.abs(c.r), Math.abs(c.s)); };
const OTHER = { q: ['r', 's'], r: ['s', 'q'], s: ['q', 'r'] };
function lateral(g, p, i) { const c = H.CELLS[i], [a, b] = OTHER[g.players[p].axis]; return (c[a] - c[b]) / 2 * g.players[p].sign; }
const games = [];
for (const seed of seeds) {
  const g = new H.Game({ seed, neutralEvents: true }); g.start();
  const rows = H.PLAYERS.map(p => ({ seat: p, strategy: g.players[p].strategyId, samples: 0, stoneSamples: 0, center: 0, lateralSum: 0, lateralAbs: 0,
    intents: {}, actionTypes: {}, combat: 0, centerCombat: 0, enemySupplyCut: 0, goals: 0, score: 0, targetCenter: 0, targets: 0, laneHist: {} }));
  const supplyCount = p => { const s = H.computeSupply(g, p); let n = 0; for (let i = 0; i < H.COUNT; i++) if (s[i] && g.board[i] === p) n++; return n; };
  let ms = 0;
  for (let n = 0; n < actions && g.phase === 'running'; n++) {
    const p = g.turn, row = rows[p - 1], t0 = performance.now();
    const action = H.chooseAction(g.observation()); ms += performance.now() - t0;
    const target = action.cells?.at(-1), victim = target !== undefined && g.board[target] && g.board[target] !== p ? g.board[target] : 0;
    const before = victim ? supplyCount(victim) : 0;
    if (!g.act(action)) g.act({ type: 'rest', cells: [] });
    const intent = action.planner?.memory?.strategy || 'none';
    row.intents[intent] = (row.intents[intent] || 0) + 1;
    row.actionTypes[action.type] = (row.actionTypes[action.type] || 0) + 1;
    if (target !== undefined && ['deploy', 'engineer', 'destroy', 'bombard', 'airdrop', 'exchange', 'bridge', 'tunnel'].includes(action.type)) { row.targets++; if (ring(target) <= 6) row.targetCenter++; }
    if (victim && g.board[target] !== victim) { row.combat++; if (ring(target) <= 6) row.centerCombat++; row.enemySupplyCut += Math.max(0, before - 1 - supplyCount(victim)); }
    if (n % 30 === 29) for (const q of H.PLAYERS) {
      const r = rows[q - 1]; r.samples++;
      for (let i = 0; i < H.COUNT; i++) if (g.board[i] === q && !g.anchors[i]) { r.stoneSamples++; if (ring(i) <= 6) r.center++; const l = lateral(g, q, i); r.lateralSum += l; r.lateralAbs += Math.abs(l); const bucket = String(Math.max(-3, Math.min(3, Math.round(l / 4)))); r.laneHist[bucket] = (r.laneHist[bucket] || 0) + 1; }
    }
    g.advanceTime(300);
  }
  for (const r of rows) { r.goals = g.players[r.seat].goals; r.score = g.players[r.seat].score; r.centerShare = +(r.center / Math.max(1, r.stoneSamples)).toFixed(3); r.meanLateral = +(r.lateralSum / Math.max(1, r.stoneSamples)).toFixed(2); r.meanAbsLateral = +(r.lateralAbs / Math.max(1, r.stoneSamples)).toFixed(2); r.centerTargetShare = +(r.targetCenter / Math.max(1, r.targets)).toFixed(3); delete r.center; delete r.lateralSum; delete r.lateralAbs; }
  const totalCombat = rows.reduce((s, r) => s + r.combat, 0), centerCombat = rows.reduce((s, r) => s + r.centerCombat, 0);
  games.push({ seed, actions: g.ply, aiMsMean: +(ms / g.ply).toFixed(1), goalArrivals: g.telemetry.goalArrivals, holdingRounds: g.telemetry.goalHoldingRounds, captures: g.telemetry.captures, destroyed: g.telemetry.destroyed, supplyRetreats: g.telemetry.supplyRetreats, bombardments: g.telemetry.bombardments, airdrops: g.telemetry.airdrops, alliances: g.telemetry.alliances, centerCombatShare: +(centerCombat / Math.max(1, totalCombat)).toFixed(3), players: rows });
  console.error(`seed ${seed}: ${g.ply} actions, ${(ms / g.ply).toFixed(1)} ms/AI`);
}
const all = games.flatMap(g => g.players), mean = xs => +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3);
const byStrategy = {};
for (const r of all) { const s = byStrategy[r.strategy] ||= { n: 0, centerShare: [], meanLateral: [], centerTargetShare: [], enemySupplyCut: [], combat: [], goals: [], score: [], intents: {} }; s.n++; for (const k of ['centerShare', 'meanLateral', 'centerTargetShare', 'enemySupplyCut', 'combat', 'goals', 'score']) s[k].push(r[k]); for (const [k, v] of Object.entries(r.intents)) s.intents[k] = (s.intents[k] || 0) + v; }
for (const s of Object.values(byStrategy)) for (const k of ['centerShare', 'meanLateral', 'centerTargetShare', 'enemySupplyCut', 'combat', 'goals', 'score']) s[k] = mean(s[k]);
const summary = { ref: flags.ref || 'working-tree', seeds, actions, meanCenterShare: mean(all.map(r => r.centerShare)), meanCenterCombatShare: mean(games.map(g => g.centerCombatShare)),
  goalArrivals: games.reduce((s, g) => s + g.goalArrivals, 0), holdingRounds: games.reduce((s, g) => s + g.holdingRounds, 0), enemySupplyCut: all.reduce((s, r) => s + r.enemySupplyCut, 0), supplyRetreats: games.reduce((s, g) => s + g.supplyRetreats, 0),
  lateralSpread: mean(games.map(g => { const l = g.players.map(r => r.meanLateral), m = l.reduce((a, b) => a + b) / l.length; return Math.sqrt(l.reduce((s, x) => s + (x - m) ** 2, 0) / l.length); })), aiMsMean: mean(games.map(g => g.aiMsMean)), byStrategy };
const out = { summary, games };
if (flags.output) fs.writeFileSync(path.resolve(flags.output), JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify(summary, null, 1));
