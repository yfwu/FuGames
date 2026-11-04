'use strict';
// Bridge AI: double-dummy solver, 2/1 bidding system with auction inference, Monte Carlo card play.
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../bridge-engine.js');
const AI = require('../bridge-ai.js');
const DDS = require('../bridge-dds.js');
const BP = require('../bridge-play.js');

const plain = v => JSON.parse(JSON.stringify(v));
const RANKS = '23456789TJQKA';
// "AKQ32.K54.32.765" = spades.hearts.diamonds.clubs
function hand(str) { const parts = str.split('.'); const out = []; parts.forEach((p, i) => { const s = 3 - i; for (const ch of p.replace('-', '')) out.push(s * 13 + RANKS.indexOf(ch)); }); assert.equal(out.length, 13, str); return out; }
// build a full deal: given hands for some seats, the rest dealt from the remaining cards
function dealWith(fixed) {
  const used = new Set(Object.values(fixed).flat());
  const rest = Array.from({ length: 52 }, (_, i) => i).filter(c => !used.has(c));
  return [0, 1, 2, 3].map(s => fixed[s] || rest.splice(0, 13));
}
function view(seat, auction, h, dealer = 0, vulnerability = 'none') {
  const g = B.createGame(dealWith({ [seat]: hand(h) }), dealer + 1);
  g.vulnerability = vulnerability;
  for (const c of auction) assert.ok(B.applyCall(g, c), `illegal ${c}`);
  assert.equal(g.turn, seat, 'fixture seat must be on turn');
  return B.viewFor(g, seat);
}
const bid = (seat, auction, h, dealer, vul) => AI.chooseBid(view(seat, auction, h, dealer, vul));

// ---------- double dummy ----------
function brute(hands, trump, trick, seat, side) {
  if (hands.every(h => !h.length) && !trick.length) return 0;
  const h = hands[seat], led = trick.length ? B.suit(trick[0].card) : -1;
  const legal = led >= 0 && h.some(c => B.suit(c) === led) ? h.filter(c => B.suit(c) === led) : h;
  let best = null;
  for (const c of legal) {
    const nh = hands.map(x => x.slice()); nh[seat].splice(nh[seat].indexOf(c), 1);
    const nt = [...trick, { seat, card: c }];
    let v;
    if (nt.length === 4) { const w = B.winner(nt, trump); v = (w % 2 === side ? 1 : 0) + brute(nh, trump, [], w, side); }
    else v = brute(nh, trump, nt, (seat + 1) % 4, side);
    best = best === null ? v : seat % 2 === side ? Math.max(best, v) : Math.min(best, v);
  }
  return best;
}
test('double-dummy solver matches exhaustive search on 240 random endings, leads and mid-trick positions', () => {
  for (let seed = 1; seed <= 240; seed++) {
    const random = B.rng(seed * 31), deck = Array.from({ length: 52 }, (_, i) => i);
    for (let i = 51; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    const n = 2 + seed % 3, hands = [0, 1, 2, 3].map(s => deck.filter((_, i) => i % 4 === s).slice(0, n));
    const trump = seed % 5, leader = seed % 4;
    assert.equal(DDS.solve(hands, trump, leader), brute(hands, trump, [], leader, leader % 2), `solve ${seed}`);
    for (const r of DDS.analyze(hands, trump, [], leader)) {
      const nh = hands.map(x => x.slice()); nh[leader].splice(nh[leader].indexOf(r.card), 1);
      assert.equal(r.tricks, brute(nh, trump, [{ seat: leader, card: r.card }], (leader + 1) % 4, leader % 2), `lead ${seed}`);
      for (const e of r.equivalents) assert.ok(hands[leader].includes(e));
    }
    const lc = hands[leader][0], rest = hands.map(x => x.slice()); rest[leader].splice(0, 1);
    const s2 = (leader + 1) % 4;
    for (const r of DDS.analyze(rest, trump, [{ seat: leader, card: lc }], s2)) {
      const h3 = rest.map(x => x.slice()); h3[s2].splice(h3[s2].indexOf(r.card), 1);
      assert.equal(r.tricks, brute(h3, trump, [{ seat: leader, card: lc }, { seat: s2, card: r.card }], (s2 + 1) % 4, s2 % 2), `follow ${seed}`);
    }
  }
});
test('double-dummy solver handles known full-deal positions (grand slam, cold NT game)', () => {
  // North holds all spades and hearts tops: 13 tricks in spades
  const deal = [hand('AKQJT98765432.-.-.-'), hand('-.AKQJT98765432.-.-'), hand('-.-.AKQJT98765432.-'), hand('-.-.-.AKQJT98765432')];
  assert.equal(DDS.solve(deal, 3, 1, 0), 13);  // East leads hearts, North ruffs everything
  assert.equal(DDS.solve(deal, 4, 1, 0), 0);   // in NT East runs hearts, North never wins
  assert.equal(DDS.solve(deal, 4, 0, 0), 13);  // North on lead in NT cashes 13 spades
});

// ---------- bidding system ----------
test('openings follow the 2/1 structure', () => {
  assert.equal(bid(0, [], 'AQ2.KJ5.Q732.K94').call, '1N');        // 16 balanced
  assert.equal(bid(0, [], 'AQ2.AKJ.KJ73.K94').call, '2N');        // 21 balanced
  assert.equal(bid(0, [], 'AKQ2.AKJ.AQ73.K9').call, '2C');        // 25
  assert.equal(bid(0, [], 'AQJ53.K5.Q73.J94').call, '1S');
  assert.equal(bid(0, [], 'K53.AQ952.Q73.K9').call, '1H');
  assert.equal(bid(0, [], 'A53.K95.Q732.K94').call, '1D');        // 4-3 minors: 1D
  assert.equal(bid(0, [], 'A53.K95.Q73.K942').call, '1C');
  assert.equal(bid(0, [], 'KQJ953.95.732.94').call, '2S');        // weak two
  assert.equal(bid(0, [], '95.KQJ9532.73.94').call, '3H');        // 7-card preempt
  assert.equal(bid(0, [], '953.J95.Q732.K94').call, 'P');
});
test('responses use Stayman, Jacoby transfers, Jacoby 2NT, splinters and limit raises', () => {
  assert.equal(bid(2, ['1N', 'P'], 'KJ52.Q953.73.K94').call, '2C');   // Stayman
  assert.equal(bid(2, ['1N', 'P'], 'KJ952.Q53.73.942').call, '2H');   // transfer to spades
  assert.equal(bid(2, ['1N', 'P'], '952.QJ953.73.942').call, '2D');   // transfer to hearts, weak
  assert.equal(bid(2, ['1N', 'P'], 'K92.Q53.A73.Q942').call, '3N');
  assert.equal(bid(2, ['1N', 'P'], 'K92.Q53.J73.Q942').call, '2N');   // 8 points invite
  assert.equal(bid(2, ['1S', 'P'], 'KJ52.A95.K73.Q94').call, '2N');   // Jacoby 2NT
  assert.equal(bid(2, ['1S', 'P'], 'KJ52.A953.KQ73.4').call, '4C');   // splinter
  assert.equal(bid(2, ['1S', 'P'], 'KJ52.A53.K73.942').call, '3S');   // limit raise
  assert.equal(bid(2, ['1S', 'P'], 'K52.953.K73.9432').call, '2S');   // simple raise
  assert.equal(bid(2, ['1S', 'P'], '52.A953.K73.Q942').call, '1N');   // 1NT forcing
  assert.equal(bid(2, ['1S', 'P'], '52.A95.KQ73.AJ94').call, '2C');   // 2/1 game force
  assert.equal(bid(2, ['1D', 'P'], 'K952.QJ53.73.942').call, '1H');   // up the line with 4-4
});
test('opener answers conventions and completes transfers', () => {
  assert.equal(bid(0, ['1N', 'P', '2C', 'P'], 'AQ2.KJ53.Q73.K94').call, '2H');
  assert.equal(bid(0, ['1N', 'P', '2C', 'P'], 'AQ32.KJ5.Q73.K94').call, '2S');
  assert.equal(bid(0, ['1N', 'P', '2C', 'P'], 'AQ2.KJ5.Q732.K94').call, '2D');
  assert.equal(bid(0, ['1N', 'P', '2D', 'P'], 'AQ2.KJ5.Q732.K94').call, '2H');
  assert.equal(bid(0, ['1N', 'P', '2D', 'P'], 'AQ2.KJ53.A73.K94').call, '3H'); // super-accept
  assert.equal(bid(0, ['1S', 'P', '2N', 'P'], 'AQJ53.K5.Q7532.4').call, '3C');  // Jacoby: club shortness
  assert.equal(bid(0, ['1S', 'P', '2N', 'P'], 'AQJ53.K52.Q73.94').call, '4S'); // minimum, no shortness
});
test('competitive bidding: takeout, negative double, Michaels, Unusual 2NT, overcalls', () => {
  assert.equal(bid(1, ['1H'], 'AQ52.4.KJ73.Q942').call, 'X');               // takeout
  assert.equal(bid(1, ['1H'], 'AQJ52.43.K73.942').call, '1S');              // overcall
  assert.equal(bid(1, ['1H'], 'AQJ52.4.73.KJ942').call, '2H');              // Michaels: spades + minor
  assert.equal(bid(1, ['1S'], '4.43.KQJ73.AJ942').call, '2N');              // Unusual 2NT
  assert.equal(bid(1, ['1C'], 'KQJ52.AJ942.73.4').call, '2C');              // Michaels majors
  assert.equal(bid(2, ['1C', '1H'], 'KJ52.953.Q73.Q94').call, 'X');         // negative double shows spades
  assert.equal(bid(2, ['1D', 'X'], 'KJ2.A53.Q73.QJ94').call, 'XX');         // redouble 10+
});
test('RKCB 1430 responses and asker decisions', () => {
  // partner asks with spades agreed
  const auction = ['1S', 'P', '2N', 'P', '4S', 'P', '4N', 'P'];
  assert.equal(bid(0, auction, 'AQJ53.K52.K73.94').call, '5C');   // one key card
  assert.equal(bid(0, auction, 'AKJ53.K52.A73.94').call, '5D');   // three key cards
  assert.equal(bid(0, auction, 'AQJ53.K52.K73.A4').call, '5S');   // two plus the trump queen
  assert.equal(bid(0, auction, 'AJ953.K52.K73.A4').call, '5H');   // two without the queen
  // asker: holding three key cards, partner shows one -> small slam; partner shows zero -> sign off
  assert.equal(bid(2, [...auction, '5C', 'P'], 'KQ52.AK5.A73.K94').call, '6S');
  assert.equal(bid(2, [...auction, '5D', 'P'], 'KQ52.AK5.Q73.K94').call, '5S');
});
test('auction inference: every AI call is explained and constrains the bidder', () => {
  const ex = AI.explainAuction([{ seat: 0, call: '1N' }, { seat: 1, call: 'P' }, { seat: 2, call: '2D' }, { seat: 3, call: 'P' }, { seat: 0, call: '2H' }], 0, 'none');
  assert.deepEqual(ex.hands[0].hcp, [15, 17]);
  assert.ok(ex.hands[2].len[2][0] >= 5, 'transfer shows five hearts');
  assert.match(ex.calls[2].text, /轉換/);
  assert.ok(ex.hands[0].len[2][0] >= 2);
  for (let seed = 1; seed <= 60; seed++) {
    const g = B.createGame(B.makeDeal(seed * 101), seed);
    while (g.phase === 'auction') { const d = AI.chooseBid(B.viewFor(g)); assert.ok(d.reason && d.reason.length > 1); assert.ok(B.applyCall(g, d.call, d.reason)); }
    const e = AI.explainAuction(g.auction, g.dealer, g.vulnerability);
    assert.equal(e.calls.length, g.auction.length);
    // inferred HCP ranges contain the true hand for AI-made rule calls
    for (let s = 0; s < 4; s++) { const h = B.shape(g.deal[s]).hcp, r = e.hands[s].hcp; assert.ok(r[0] <= r[1]); if (h < r[0] - 3 || h > r[1] + 3) assert.fail(`seat ${s} hcp ${h} outside inferred ${r} on seed ${seed}: ${g.auction.map(a => a.call).join(' ')}`); }
  }
});

// ---------- card play ----------
test('opening leads follow convention: top of sequence, partner suit, avoid underleading aces', () => {
  const g = B.createGame(dealWith({ 1: hand('KQJ2.953.A73.942') }), 1);
  for (const c of ['1N', 'P', '3N', 'P', 'P', 'P']) B.applyCall(g, c);
  const d = AI.chooseCard(B.viewFor(g));
  assert.equal(d.card, hand('KQJ2.953.A73.942')[0], 'K of spades from KQJ');
  assert.match(d.reason, /首攻/);
  const h = B.createGame(dealWith({ 1: hand('A852.953.Q73.942') }), 1);
  for (const c of ['1C', 'P', '1H', 'P', '2H', 'P', 'P', 'P']) B.applyCall(h, c);
  const lead = AI.chooseCard(B.viewFor(h)).card;
  assert.notEqual(lead, 3 * 13 + 12, 'no ace lead from Axxx against a suit contract');
});
test('Monte Carlo sampling respects shown-out suits and auction inference', () => {
  const g = B.createGame(B.makeDeal(77), 1);
  for (const c of ['1N', 'P', '3N', 'P', 'P', 'P']) B.applyCall(g, c);
  while (g.played.length < 20) B.playCard(g, AI.chooseCard(B.viewFor(g), undefined, { mode: 'fast' }).card);
  const v = B.viewFor(g), S = BP.buildSampler(v), random = B.rng(9);
  for (let i = 0; i < 40; i++) {
    const deal = BP.sample(S, random, true) || BP.sample(S, random, false);
    assert.ok(deal);
    assert.equal(new Set(deal.flat()).size, deal.flat().length);
    for (const s of S.hidden) { assert.equal(deal[s].length, g.hands[s].length); for (let t = 0; t < 4; t++) if (v.voids[s][t]) assert.ok(!deal[s].some(c => B.suit(c) === t)); }
    for (const [k, h] of Object.entries(v.knownHands)) assert.deepEqual(deal[k].slice().sort(), h.slice().sort());
  }
});
test('AI decisions depend only on the public view (hidden hands can be swapped)', () => {
  let compared = 0;
  for (let seed = 1; seed <= 16; seed++) {
    const g = B.createGame(B.makeDeal(seed * 13), seed);
    let n = 0;
    while (g.phase !== 'complete') {
      const v = B.viewFor(g), unseen = [0, 1, 2, 3].filter(s => !(String(s) in v.knownHands));
      if (unseen.length >= 2 && n % 3 === 0) {
        const alt = plain(g), pool = unseen.flatMap(s => alt.hands[s]).reverse(); let i = 0;
        for (const s of unseen) alt.hands[s] = alt.hands[s].map(() => pool[i++]);
        const v2 = B.viewFor(alt);
        assert.deepEqual(plain(v), plain(v2));
        const decide = x => g.phase === 'auction' ? AI.chooseBid(x) : AI.chooseCard(x, undefined, { mode: 'quick' });
        assert.deepEqual(plain(decide(v)), plain(decide(v2)));
        compared++;
      }
      if (g.phase === 'auction') assert.ok(B.applyCall(g, AI.chooseBid(v).call));
      else assert.ok(B.playCard(g, AI.chooseCard(v, undefined, { mode: 'quick' }).card));
      assert.ok(++n < 300);
    }
  }
  assert.ok(compared > 200, String(compared));
});
test('Monte Carlo play keeps a laydown: declarer with all top cards takes every trick', () => {
  const deal = [hand('AKQJ.AKQ.AKQ.AKQ'), hand('T987.JT9.JT9.JT9'), hand('6543.876.876.876'), hand('2.5432.5432.5432')];
  const g = B.createGame(deal, 1);
  for (const c of ['7N', 'P', 'P', 'P']) B.applyCall(g, c);
  while (g.phase === 'play') B.playCard(g, AI.chooseCard(B.viewFor(g), undefined, { mode: 'quick' }).card);
  assert.equal(g.tricks[0], 13);
});
test('reference table is deterministic and 300 fast boards plus 24 Monte Carlo boards complete legally', () => {
  const d = B.makeDeal(100), first = B.simulate(d, 1, { mode: 'quick' }), second = B.simulate(d, 1, { mode: 'quick' });
  assert.deepEqual(plain(first.auction), plain(second.auction));
  assert.deepEqual(plain(first.history), plain(second.history));
  const states = new Set(); let active = 0, slams = 0, games = 0, maxCalls = 0;
  const run = (seed, mode) => {
    const g = B.createGame(B.makeDeal(seed * 1337), seed);
    let turns = 0;
    while (g.phase === 'auction') { const dd = AI.chooseBid(B.viewFor(g)); states.add(dd.state); assert.ok(B.legalCalls(g).includes(dd.call)); assert.ok(B.applyCall(g, dd.call)); assert.ok(++turns < 120); }
    maxCalls = Math.max(maxCalls, g.auction.length);
    if (!g.contract) return;
    active++; if (g.contract.level >= 6) slams++; if (B.scoreContract({ ...g.contract, multiplier: 1 }, g.contract.level + 6) >= 300) games++;
    while (g.phase === 'play') { const legal = B.legalCards(g), c = AI.chooseCard(B.viewFor(g), undefined, { mode }).card; assert.ok(legal.includes(c)); assert.ok(B.playCard(g, c)); }
    assert.equal(g.played.length, 52); assert.equal(g.tricks[0] + g.tricks[1], 13);
    assert.equal(g.score, B.scoreContract(g.contract, g.tricks[g.contract.side], B.vulnerable(g.vulnerability, g.contract.side)) * (g.contract.side === 0 ? 1 : -1));
  };
  for (let seed = 1; seed <= 300; seed++) run(seed, 'fast');
  for (let seed = 301; seed <= 324; seed++) run(seed, 'quick');
  for (const st of ['opening', 'response', 'rebid', 'competition', 'convention']) assert.ok(states.has(st), st);
  assert.ok(active > 300 * 0.95, String(active));
  assert.ok(games > active * 0.25, `games ${games}/${active}`);
  assert.ok(maxCalls < 40);
  console.log(`Bridge AI: ${active} boards, ${games} games, ${slams} slams, longest auction ${maxCalls} calls.`);
});
