#!/usr/bin/env node
/* Minimal HexBattle arena agent: a template to copy. It reads JSON Lines
   from stdin and answers every "turn" message with one action, using only the
   observation and the list of legal actions it was given (no engine access).
   Strategy: play free economy cards, then the best-scoring build or recruit,
   buy the priciest affordable non-victory card, send the army to the nearest
   relic it does not hold once it has four units, and end the turn. */
'use strict';
const readline = require('readline');
let catalog = null;
const send = obj => process.stdout.write(JSON.stringify(obj) + '\n');

function hexDist(a, b) { return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2; }

function choose(obs, legal) {
  const cards = catalog.cards, hand = new Map(obs.hand.map(c => [c.id, c.k]));
  const kind = a => a.card !== undefined && hand.has(a.card) ? cards[hand.get(a.card)].kind : null;
  // 1. free economy cards
  const econ = legal.find(a => a.type === 'play' && kind(a) === 'econ' && hand.get(a.card) !== 'purge');
  if (econ) return econ;
  // 2. builds and recruits, scored by what the agent needs most
  const food = obs.income.net.food;
  const want = { farm: food < 2 ? 9 : 3, lumber: 4, mine: 4, market: 5, outpost: 5, barracks: 6, tower: 3, shrine: 10, granary: 2, workshop: 2, wall: 1 };
  let best = null, bestScore = 0;
  for (const a of legal) {
    if (a.type !== 'play') continue;
    const k = hand.get(a.card), def = cards[k];
    let s = 0;
    if (def.kind === 'build') s = (want[k] || 1) + (obs.map.cells[a.target].f ? 1 : 0);
    else if (def.kind === 'unit') s = obs.units.filter(u => u.owner === obs.you).length < 3 + obs.round / 2 ? 5 : 1;
    if (s > bestScore) { bestScore = s; best = a; }
  }
  if (best) return best;
  // 3. market
  const buys = legal.filter(a => a.type === 'buy').map(a => obs.market[a.slot]).filter(m => cards[m.k].kind !== 'vp' || obs.round > 10);
  if (buys.length) { buys.sort((x, y) => y.price - x.price); return { type: 'buy', slot: buys[0].slot }; }
  // 4. orders
  const mine = obs.units.filter(u => u.owner === obs.you);
  if (mine.length >= 4) {
    const home = obs.buildings.find(b => b.owner === obs.you && b.type === 'capital');
    const targets = obs.map.relics.filter(r => obs.territory[r] !== obs.you);
    if (home && targets.length) {
      const c = obs.map.cells;
      targets.sort((x, y) => hexDist(c[x], c[home.cell]) - hexDist(c[y], c[home.cell]));
      if (mine.some(u => u.goal !== targets[0])) return { type: 'order', unit: 'all', stance: 'advance', target: targets[0] };
    }
  }
  return { type: 'end' };
}

readline.createInterface({ input: process.stdin }).on('line', line => {
  const msg = JSON.parse(line);
  if (msg.type === 'hello') catalog = msg.catalog;
  else if (msg.type === 'turn') send(choose(msg.observation, msg.legal));
  else if (msg.type === 'result' && !msg.ok) process.stderr.write('rejected: ' + msg.error + '\n');
});
