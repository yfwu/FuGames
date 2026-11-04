#!/usr/bin/env node
'use strict';
/* Local agent seat for the bridge engine (JSON lines over stdin/stdout).
 *   node tools/bridge-agent.cjs [--seed 7] [--board 1] [--seat 2] [--mode normal]
 * Whenever it is the agent's turn, one line is printed: {"type":"turn","view":{...},"auction":[...explained calls...]}
 * Reply with one line: {"call":"1N"} / {"call":"P"} / {"card":51}  (card = suit*13 + rank-2; suits C,D,H,S = 0..3)
 * The other three seats are played by the built-in AI. A final {"type":"result",...} line ends the board.
 * The agent only ever receives the public view of its own seat (plus dummy after the opening lead).
 */
const B = require('../bridge-engine.js');
const AI = require('../bridge-ai.js');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const seed = Number(arg('seed', Date.now() % 1e9)), board = Number(arg('board', 1)), agent = Number(arg('seat', 2)), mode = arg('mode', 'normal');
const game = B.createGame(B.makeDeal(seed), board);
const out = o => process.stdout.write(JSON.stringify(o) + '\n');
const agentTurn = () => game.phase === 'auction' ? game.turn === agent : game.phase === 'play' && (game.turn === agent || (game.contract.side === agent % 2 && game.turn === game.contract.dummy && game.contract.declarer === agent));
function advance() {
  while (game.phase !== 'complete' && !agentTurn()) {
    const v = B.viewFor(game);
    if (game.phase === 'auction') B.applyCall(game, AI.chooseBid(v).call); else B.playCard(game, AI.chooseCard(v, undefined, { mode }).card);
  }
  if (game.phase === 'complete') { out({ type: 'result', contract: game.contract, tricks: game.tricks, scoreNS: game.score, auction: game.auction.map(a => ({ seat: a.seat, call: a.call })) }); process.exit(0); }
  out({ type: 'turn', seat: game.turn, view: B.viewFor(game), auction: AI.explainAuction(game.auction, game.dealer, game.vulnerability).calls, legal: game.phase === 'auction' ? B.legalCalls(game) : B.legalCards(game) });
}
let buf = '';
process.stdin.on('data', d => {
  buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { msg = { call: line }; }
    const ok = game.phase === 'auction' ? B.applyCall(game, msg.call) : B.playCard(game, Number(msg.card));
    if (!ok) { out({ type: 'error', message: 'illegal action', legal: game.phase === 'auction' ? B.legalCalls(game) : B.legalCards(game) }); continue; }
    advance();
  }
});
advance();
