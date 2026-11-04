#!/usr/bin/env node
/* Bot-vs-bot balance simulation for AutoHex 3D.
   node tools/autohex3d-sim.cjs --games 20 --players 4 [--profiles balanced,builder,...] [--seed prefix] [--json] */
const E = require('../autohex3d/engine.js');
const AI = require('../autohex3d/ai.js');
const args = process.argv.slice(2), opt = k => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : undefined; };
const games = +(opt('games') || 10), players = +(opt('players') || 4), prefix = opt('seed') || 'sim';
const pool = (opt('profiles') || AI.PROFILE_ORDER.join(',')).split(',');
const results = [], wins = {}, seatWins = {}, reasons = {};
const t0 = Date.now();
for (let gi = 0; gi < games; gi++) {
  const st = E.createGame({ seed: prefix + gi, players });
  const profiles = st.players.map((p, k) => pool[(k + gi) % pool.length]);
  let guard = 0;
  while (st.phase !== 'over' && guard++ < 5000) { const id = E.currentPlayer(st); AI.playTurn(st, id, profiles[id - 1]); }
  const w = st.winner, prof = profiles[w - 1];
  wins[prof] = (wins[prof] || 0) + 1; seatWins[w] = (seatWins[w] || 0) + 1; reasons[st.result.reason] = (reasons[st.result.reason] || 0) + 1;
  const row = { seed: st.seed, rounds: st.round, reason: st.result.reason, winner: w, profile: prof,
    standings: st.result.standings.map(s => `${s.id}:${profiles[s.id - 1]}=${s.vp}`).join(' '),
    eliminated: st.players.filter(p => !p.alive).map(p => p.id),
    stats: st.players.map(p => p.stats) };
  results.push(row);
  if (!args.includes('--json')) console.log(`${row.seed} r${row.rounds} ${row.reason.padEnd(14)} win ${w}(${prof}) | ${row.standings} | elim ${row.eliminated.join(',') || '-'} | razed ${row.stats.map(s => s.razed).join('/')} kills ${row.stats.map(s => s.kills).join('/')} built ${row.stats.map(s => s.built).join('/')}`);
}
const summary = { games, players, ms: Date.now() - t0, avgRounds: results.reduce((s, r) => s + r.rounds, 0) / games, wins, seatWins, reasons };
console.log(JSON.stringify(summary));
