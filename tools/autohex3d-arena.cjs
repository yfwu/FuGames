#!/usr/bin/env node
/* AutoHex 3D arena: runs matches between external agent programs and the
   built-in bots, and reports standings.

     node tools/autohex3d-arena.cjs --seat "cmd:node tools/autohex3d-example-agent.cjs" \
       --seat bot:warlord --seat bot:builder --seat bot:warden [--games 4] [--seed arena] [--timeout 10000] [--log out.jsonl]

   A seat is either bot:<doctrine> (balanced, builder, warlord, warden, raider)
   or cmd:<shell command>. Each cmd seat is one long-running process that speaks
   JSON Lines on stdin/stdout (one JSON object per line):

     arena -> agent  {"type":"hello","player":2,"players":4,"seed":"...","catalog":{...}}
     arena -> agent  {"type":"turn","game":0,"player":2,"observation":{...},"legal":[...]}
     agent -> arena  {"type":"play","card":17,"target":95}       (any action object)
     arena -> agent  {"type":"result","ok":true,"events":[...]}  or  {"type":"result","ok":false,"error":"..."}
     arena -> agent  {"type":"over","game":0,"result":{...}}

   After an invalid action, a timeout or 200 actions in one turn, the arena ends
   that turn for the agent. stderr of agents is passed through. */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const readline = require('readline');
const E = require('../autohex3d/engine.js');
const AI = require('../autohex3d/ai.js');

const argv = process.argv.slice(2);
const seats = [];
for (let i = 0; i < argv.length; i++) if (argv[i] === '--seat') seats.push(argv[++i]);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const games = +opt('games', 1), seedBase = opt('seed', 'arena'), timeout = +opt('timeout', 10000), logFile = opt('log');
const rotate = argv.includes('--rotate'); // rotate seats between games so each entrant plays every position
if (seats.length < 2 || seats.length > 6) { console.error('需要 2–6 個 --seat（bot:<doctrine> 或 cmd:<command>）'); process.exit(1); }
const logStream = logFile ? fs.createWriteStream(logFile) : null;
const log = obj => { if (logStream) logStream.write(JSON.stringify(obj) + '\n'); };

class AgentProcess {
  constructor(command, label) {
    this.label = label;
    this.proc = spawn(command, { shell: true, stdio: ['pipe', 'pipe', 'inherit'] });
    this.queue = []; this.waiters = [];
    readline.createInterface({ input: this.proc.stdout }).on('line', line => {
      if (!line.trim()) return;
      let msg; try { msg = JSON.parse(line); } catch (e) { msg = { type: '__invalid', raw: line }; }
      const w = this.waiters.shift(); if (w) w(msg); else this.queue.push(msg);
    });
    this.proc.on('exit', code => { this.dead = true; for (const w of this.waiters.splice(0)) w(null); if (code) console.error(`${label} 結束，代碼 ${code}`); });
  }
  send(obj) { if (!this.dead) this.proc.stdin.write(JSON.stringify(obj) + '\n'); }
  next(ms) {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    if (this.dead) return Promise.resolve(null);
    return new Promise(resolve => {
      const t = setTimeout(() => { const k = this.waiters.indexOf(f); if (k >= 0) this.waiters.splice(k, 1); resolve(undefined); }, ms);
      const f = msg => { clearTimeout(t); resolve(msg); };
      this.waiters.push(f);
    });
  }
  close() { try { this.proc.stdin.end(); } catch (e) { /* already closed */ } setTimeout(() => { if (!this.dead) this.proc.kill(); }, 500); }
}

async function main() {
  const entrants = seats.map((s, k) => {
    if (s.startsWith('bot:')) { const doctrine = s.slice(4); if (!AI.PROFILES[doctrine]) throw new Error('未知 AI：' + doctrine); return { label: s, bot: doctrine }; }
    if (s.startsWith('cmd:')) return { label: s, proc: new AgentProcess(s.slice(4), `seat ${k + 1}`) };
    throw new Error('座位格式：bot:<doctrine> 或 cmd:<command>');
  });
  const table = entrants.map(e => ({ label: e.label, games: 0, wins: 0, vp: 0, invalid: 0, timeouts: 0 }));
  const catalog = E.catalog();
  for (let g = 0; g < games; g++) {
    const shift = rotate ? g % entrants.length : 0;
    const seatOf = entrants.map((_, k) => (k + shift) % entrants.length); // entrant k sits in seat seatOf[k] + 1
    const bySeat = []; seatOf.forEach((s, k) => { bySeat[s] = k; });
    const st = E.createGame({ seed: seedBase + '-' + g, players: entrants.length });
    log({ type: 'start', game: g, seed: st.seed, seats: bySeat.map(k => entrants[k].label) });
    for (let s = 0; s < entrants.length; s++) { const e = entrants[bySeat[s]]; if (e.proc) e.proc.send({ type: 'hello', game: g, player: s + 1, players: entrants.length, seed: st.seed, catalog }); }
    while (st.phase !== 'over') {
      const id = E.currentPlayer(st), k = bySeat[id - 1], e = entrants[k];
      if (e.bot) { for (const a of AI.playTurn(st, id, e.bot)) log({ game: g, player: id, action: a }); continue; }
      let steps = 0;
      while (E.currentPlayer(st) === id && st.phase !== 'over') {
        if (steps++ >= 200) { E.act(st, id, { type: 'end' }); log({ game: g, player: id, action: { type: 'end' }, forced: 'limit' }); break; }
        e.proc.send({ type: 'turn', game: g, player: id, observation: E.observe(st, id), legal: E.legalActions(st, id) });
        const msg = await e.proc.next(timeout);
        if (msg === undefined || msg === null) { table[k].timeouts++; E.act(st, id, { type: 'end' }); log({ game: g, player: id, action: { type: 'end' }, forced: msg === null ? 'exited' : 'timeout' }); break; }
        const r = E.act(st, id, msg);
        e.proc.send({ type: 'result', ok: r.ok, error: r.error, events: r.events });
        log({ game: g, player: id, action: msg, ok: r.ok, error: r.error });
        if (!r.ok) { table[k].invalid++; E.act(st, id, { type: 'end' }); log({ game: g, player: id, action: { type: 'end' }, forced: 'invalid' }); break; }
      }
    }
    for (let s = 0; s < entrants.length; s++) {
      const k = bySeat[s]; table[k].games++; table[k].vp += E.totalVp(st, s + 1); if (st.winner === s + 1) table[k].wins++;
      if (entrants[k].proc) entrants[k].proc.send({ type: 'over', game: g, player: s + 1, result: st.result });
    }
    log({ type: 'over', game: g, result: st.result });
    console.log(`第 ${g + 1} 局 ${st.seed}：${st.result.reason}，第 ${st.round} 輪，勝者座位 ${st.winner}（${entrants[bySeat[st.winner - 1]].label}）；` + st.result.standings.map(x => `${x.id}=${x.vp}`).join(' '));
  }
  console.log('\n戰績');
  for (const t of table) console.log(`${t.label.padEnd(40)} 勝 ${t.wins}/${t.games}  平均 ${(t.vp / Math.max(1, t.games)).toFixed(1)} 分  無效 ${t.invalid}  逾時 ${t.timeouts}`);
  for (const e of entrants) if (e.proc) e.proc.close();
  if (logStream) logStream.end();
}
main().catch(err => { console.error(err.message); process.exit(1); });
