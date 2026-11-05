#!/usr/bin/env node
/* HexBattle command-line play for agents and people. Every step is one shell
   command against a save file, so any agent that can run commands can play.

     node tools/hexbattle.cjs new [--players 4] [--seed S] [--seat 1] [--bots warlord,builder,...] [--file game.json]
     node tools/hexbattle.cjs show    [--file game.json] [--json] [--no-map]
     node tools/hexbattle.cjs legal   [--file game.json] [--json]
     node tools/hexbattle.cjs act '<action JSON>' [--file game.json] [--json]
     node tools/hexbattle.cjs catalog
     node tools/hexbattle.cjs verify  [--file game.json]      replays the log from the seed and compares

   Seats not listed with --seat are played by the built-in bots. After each of
   your actions the bots take their turns until it is yours again (or the game
   ends), and the command prints what happened. See docs/hexbattle/agent-api.md. */
'use strict';
const fs = require('fs');
const path = require('path');
const E = require('../hexbattle/engine.js');
const AI = require('../hexbattle/ai.js');
const T = require('../hexbattle/text.js');

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = name => argv.includes('--' + name);
const opt = (name, def) => { const i = argv.indexOf('--' + name); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def; };
const file = path.resolve(opt('file', 'hexbattle-game.json'));
const asJson = flag('json');

function save(game) { fs.writeFileSync(file, JSON.stringify(game)); }
function load() {
  if (!fs.existsSync(file)) fail(`找不到存檔 ${file}；先執行 new。`);
  const game = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (game.format !== 'hexbattle-save' && game.format !== 'autohex3d-save') fail('不是 HexBattle 存檔');
  return game;
}
function fail(msg) { if (asJson) console.log(JSON.stringify({ ok: false, error: msg })); else console.error(msg); process.exit(1); }

// Let bots play until an agent seat is to move or the game is over.
function runBots(game) {
  const st = game.state, log = [];
  let guard = 0;
  while (st.phase !== 'over' && !game.config.agents.includes(E.currentPlayer(st)) && guard++ < 2000) {
    const id = E.currentPlayer(st), roundBefore = st.round;
    const acts = AI.playTurn(st, id, game.config.bots[id] || 'balanced');
    for (const a of acts) game.actions.push({ player: id, action: a });
    log.push({ player: id, actions: acts.length });
    if (st.round !== roundBefore || st.phase === 'over') log.push({ battle: st.battle && st.battle.round, scoring: st.battle && st.battle.scoring });
  }
  return log;
}

function brief(game, extra = {}) {
  const st = game.state, me = E.currentPlayer(st) || game.config.agents[0];
  const obs = E.observe(st, me, { map: asJson ? !flag('no-map') : true });
  if (asJson) { console.log(JSON.stringify({ ok: true, ...extra, observation: obs })); return; }
  if (extra.events && extra.events.length) console.log('事件：' + extra.events.map(e => e.e + (e.card ? ':' + e.card : '') + (e.cell !== undefined && e.cell >= 0 ? '@' + e.cell : '')).join(' '));
  console.log(T.describe(obs, { map: !flag('no-map') }));
  if (st.phase !== 'over') console.log(`\n動作：node tools/hexbattle.cjs act '{"type":"end"}' ；查合法動作：legal`);
}

switch (cmd) {
  case 'new': {
    const players = +opt('players', 4);
    const seed = opt('seed', 'agent-' + Date.now().toString(36));
    const agents = opt('seat', '1').split(',').map(Number).filter(n => n >= 1 && n <= players);
    const botList = opt('bots', '').split(',').filter(Boolean);
    const bots = {};
    let k = 0;
    for (let id = 1; id <= players; id++) if (!agents.includes(id)) bots[id] = botList[k++ % Math.max(1, botList.length)] || AI.PROFILE_ORDER[(id - 1) % AI.PROFILE_ORDER.length];
    const state = E.createGame({ seed, players, maxRounds: opt('rounds') ? +opt('rounds') : undefined });
    const game = { format: 'hexbattle-save', version: E.VERSION, config: { seed, players, agents, bots, maxRounds: state.rules.maxRounds }, actions: [], state };
    const log = runBots(game);
    save(game);
    brief(game, { created: file, bots, botTurns: log });
    break;
  }
  case 'show': brief(load()); break;
  case 'legal': {
    const game = load(), st = game.state, id = E.currentPlayer(st);
    const list = E.legalActions(st, id);
    if (asJson) console.log(JSON.stringify({ ok: true, player: id, actions: list }));
    else {
      const groups = {};
      for (const a of list) { const k = a.type + (a.type === 'play' ? ':' + a.card : ''); (groups[k] = groups[k] || []).push(a); }
      for (const [k, v] of Object.entries(groups)) console.log(k.padEnd(12), v.length > 6 ? `${v.length} 種，例如 ` + v.slice(0, 4).map(a => JSON.stringify(a)).join(' ') : v.map(a => JSON.stringify(a)).join(' '));
    }
    break;
  }
  case 'act': {
    const game = load(), st = game.state, id = E.currentPlayer(st);
    if (!game.config.agents.includes(id)) fail('現在不是代理人的回合');
    let action;
    try { action = JSON.parse(argv[1]); } catch (e) { fail('動作必須是 JSON，例如 {"type":"end"}'); }
    const r = E.act(st, id, action);
    if (!r.ok) fail('不合法：' + r.error);
    game.actions.push({ player: id, action });
    const log = runBots(game);
    save(game);
    brief(game, { events: r.events, battle: r.battle ? { round: r.battle.round, scoring: r.battle.scoring } : null, botTurns: log });
    break;
  }
  case 'catalog': console.log(JSON.stringify(E.catalog(), null, asJson ? 0 : 1)); break;
  case 'verify': {
    const game = load();
    const st = E.createGame({ seed: game.config.seed, players: game.config.players, maxRounds: game.config.maxRounds });
    for (const { player, action } of game.actions) { const r = E.act(st, player, action); if (!r.ok) fail('重播失敗：' + JSON.stringify(action) + ' ' + r.error); }
    const same = JSON.stringify(st) === JSON.stringify(game.state);
    console.log(asJson ? JSON.stringify({ ok: same, actions: game.actions.length }) : same ? `重播一致（${game.actions.length} 個動作）` : '重播結果不同！');
    process.exit(same ? 0 : 2);
  }
  default:
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 17).join('\n').replace(/^\/\* ?| ?\*\/$|^   ?/gm, ''));
}
