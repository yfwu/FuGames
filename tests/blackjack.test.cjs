'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../blackjack.html'), 'utf8');
const B = vm.runInNewContext(html.match(/<script id="blackjack-engine">([\s\S]*?)<\/script>/)[1] + '; Blackjack;');
const seeded = seed => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const cards = (...ranks) => ranks.map((rank, i) => ({ rank, suit: i % 4, id: 'fixture-' + i }));
function opening(player, dealer, next = [10, 10, 10, 10, 10]) {
  const g = new B.Game(seeded(6));
  // Draw order is one card to each player, then dealer, repeated twice.
  const order = cards(player[0], 10, 10, 10, dealer[0], player[1], 8, 8, 8, dealer[1], ...next);
  g.shoe = [...cards(...Array(80).fill(10)), ...order.reverse()];
  assert.equal(g.startRound(10), true); return g;
}
function finish(g) {
  let steps = 0;
  while (g.active()) {
    if (++steps > 150) assert.fail('Round did not terminate');
    if (g.phase === 'player') g.act('stand'); else g.step();
  }
  assert.equal(g.phase, 'result'); return g;
}

test('six-deck shoe has 312 unique physical cards and each rank occurs 24 times', () => {
  const shoe = B.makeShoe(seeded(2));
  assert.equal(shoe.length, 312); assert.equal(new Set(shoe.map(c => c.id)).size, 312);
  for (let rank = 1; rank <= 13; rank++) assert.equal(shoe.filter(c => c.rank === rank).length, 24);
});

test('aces downgrade independently and S17 applies to hard AND soft 17', () => {
  for (const [ranks, total, soft] of [[[1,1,9],21,true], [[1,1,9,13],21,false], [[1,6],17,true], [[1,6,10],17,false], [[1,1,1],13,true], [[13,12,2],22,false]]) {
    assert.equal(B.handValue(cards(...ranks)).total, total); assert.equal(B.handValue(cards(...ranks)).soft, soft);
  }
  assert.equal(B.dealerShouldHit(cards(1,6)), false);
  assert.equal(B.dealerShouldHit(cards(10,7)), false);
  assert.equal(B.dealerShouldHit(cards(1,5)), true);
});

test('natural outranks three-card 21, dual naturals push, bust loses even against bust', () => {
  assert.equal(B.outcome(cards(1,13), cards(7,7,7)), 'blackjack');
  assert.equal(B.outcome(cards(7,7,7), cards(1,10)), 'loss');
  assert.equal(B.outcome(cards(1,13), cards(1,12)), 'push');
  assert.equal(B.outcome(cards(13,12,2), cards(10,10,10)), 'loss');
  assert.equal(B.outcome(cards(10,8), cards(10,6,10)), 'win');
  assert.equal(B.outcome(cards(10,8), cards(10,8)), 'push');
});

test('100 chips with wager 10 ends at 110 win, 115 natural, 100 push, 90 loss', () => {
  for (const [player, dealer, total, result] of [[[10,9],[10,8],110,'win'], [[1,10],[10,8],115,'blackjack'], [[10,8],[10,8],100,'push'], [[10,7],[10,8],90,'loss']]) {
    const g = finish(opening(player, dealer));
    assert.equal(g.seats[0].balance, total); assert.equal(g.seats[0].result, result);
    assert.equal(g.seats[0].delta, total - 100);
  }
});

test('dealer blackjack is checked before any double or extra wager', () => {
  const g = opening([5,6], [1,10]);
  assert.equal(g.phase, 'result'); assert.equal(g.revealed, true); assert.equal(g.seats[0].balance, 90);
  assert.equal(g.act('double'), false); assert.equal(g.seats[0].bet, 10);
  const both = opening([1,13], [10,1]); assert.equal(both.seats[0].balance, 100); assert.equal(both.seats[0].result, 'push');
});

test('double requires initial two cards and enough balance, draws exactly once and completes turn', () => {
  const g = opening([5,6], [10,8], [10]); const before = g.shoe.length;
  assert.equal(g.canDouble(0), true); assert.equal(g.act('double'), true);
  assert.equal(g.seats[0].cards.length, 3); assert.equal(g.shoe.length, before - 1);
  assert.equal(g.seats[0].bet, 20); assert.equal(g.seats[0].balance, 80);
  assert.equal(g.canDouble(0), false); assert.equal(g.act('double'), false);
  finish(g); assert.equal(g.seats[0].balance, 120); assert.equal(g.seats[0].result, 'win');
  const poor = opening([5,6], [10,8]); poor.seats[0].balance = 9;
  assert.equal(poor.canDouble(0), false); assert.equal(poor.act('double'), false); assert.equal(poor.seats[0].bet, 10);
  const three = opening([2,3], [10,8], [2]); assert.equal(three.act('hit'), true);
  assert.equal(three.canDouble(0), false); assert.equal(three.act('double'), false); assert.equal(three.seats[0].cards.length, 3);
});

test('player bust settles as loss while S17 dealer stops without drawing an extra card', () => {
  const g = opening([10,6], [1,6], [10]); assert.equal(g.act('hit'), true);
  finish(g); assert.equal(g.seats[0].result, 'loss'); assert.equal(g.seats[0].balance, 90);
  assert.equal(g.dealer.length, 2); assert.equal(B.handValue(g.dealer).total, 17);
  const draw = opening([10,9], [10,6], [10]); finish(draw);
  assert.equal(draw.dealer.length, 3); assert.equal(B.handValue(draw.dealer).total, 26); assert.equal(draw.seats[0].result, 'win');
});

test('initial natural skips the human turn; bust and 21 automatically finish a hand', () => {
  const natural = opening([1,10], [10,8]); assert.notEqual(natural.phase, 'player'); assert.equal(natural.seats[0].done, true);
  const to21 = opening([10,5], [10,8], [6]); to21.act('hit'); assert.notEqual(to21.phase, 'player'); assert.equal(to21.seats[0].done, true);
  const bust = opening([10,5], [10,8], [10]); bust.act('hit'); assert.notEqual(bust.phase, 'player'); assert.equal(bust.seats[0].done, true);
});

test('pause freezes actions, progression and extra rounds until explicit resume', () => {
  const g = opening([5,6], [10,8]); assert.equal(g.pause(), true);
  const snapshot = JSON.stringify(g);
  assert.equal(g.act('hit'), false); assert.equal(g.act('double'), false); assert.equal(g.step(), false); assert.equal(g.startRound(10), false);
  assert.equal(JSON.stringify(g), snapshot); assert.equal(g.resume(), true); assert.equal(g.act('stand'), true);
  g.pause(); const aiSnapshot = JSON.stringify(g); assert.equal(g.step(), false); assert.equal(JSON.stringify(g), aiSnapshot);
  g.resume(); finish(g); assert.equal(g.pause(), false);
});

test('settlement is idempotent and stale callbacks cannot act after reset or next round', () => {
  const g = opening([10,9], [10,8]), token = g.roundId; finish(g);
  const balances = g.seats.map(s => s.balance).join(',');
  for (let i = 0; i < 20; i++) { assert.equal(g.settle(), false); assert.equal(g.step(token), false); assert.equal(g.act('stand'), false); }
  assert.equal(g.seats.map(s => s.balance).join(','), balances);
  assert.equal(g.startRound(5), true); assert.equal(g.startRound(5), false);
  const snapshot = JSON.stringify(g); assert.equal(g.step(token), false); assert.equal(g.act('stand',0,token), false); assert.equal(JSON.stringify(g),snapshot);
  const token2 = g.roundId; g.reset(); assert.equal(g.phase, 'ready'); assert.equal(g.round, 0);
  assert.ok(g.seats.every(s => s.balance === 100 && s.cards.length === 0));
  assert.equal(g.step(token2), false); assert.equal(g.act('hit',0,token2), false); assert.equal(g.settle(), false);
});

test('dealer cannot settle early and invalid seats cannot gain a legal double', () => {
  const g = opening([10,9], [10,6], [10]);
  assert.equal(g.settle(), false);
  assert.equal(g.canDouble(-1), false); assert.equal(g.canDouble(9), false);
  g.act('stand');
  while (g.phase === 'ai') g.step();
  assert.equal(g.phase, 'dealer'); assert.equal(g.settle(), false);
  assert.equal(g.canDouble(4), false);
  g.step(); assert.equal(g.dealer.length, 3); assert.equal(g.settle(), true);
  assert.equal(g.seats[0].balance, 110);
});

test('wagers cannot overdraw or be zero/NaN; small balances support legal all-in', () => {
  const g = new B.Game(seeded(9));
  for (const bet of [0,-1,101,NaN,Infinity]) assert.equal(g.startRound(bet), false);
  g.seats[0].balance = 2.5; assert.equal(g.startRound(5), false); assert.equal(g.startRound(2.5), true); assert.ok(g.seats[0].balance >= 0);
  const empty = new B.Game(seeded(8)); empty.seats[0].balance = 0; assert.equal(empty.startRound(5), false); empty.reset(); assert.equal(empty.seats[0].balance,100);
  for (const profile of B.PROFILES) for (const balance of [0,.5,3,20,100]) {
    const bet = B.wagerFor(balance,profile,seeded(2)); assert.ok(bet >= 0 && bet <= balance);
  }
});

test('seated AI identities are distinct, randomized, persistent and have different strategies', () => {
  const g = opening([10,9],[10,8]), names = g.seats.slice(1).map(s => s.profile.id).join(',');
  assert.equal(new Set(g.seats.slice(1).map(s => s.profile.id)).size,3); finish(g); g.startRound(10);
  assert.equal(g.seats.slice(1).map(s => s.profile.id).join(','),names); g.reset(); assert.equal(g.seats.slice(1).map(s => s.profile.id).join(','),names);
  const layouts = new Set(Array.from({length:20},(_,i) => new B.Game(seeded(i)).seats.slice(1).map(s=>s.profile.id).join(','))); assert.ok(layouts.size>5);
  const [careful,analyst,bold,whim] = B.PROFILES;
  const view = {cards: cards(10,2),dealerUp: cards(3)[0],canDouble:true};
  assert.equal(B.chooseAction(view,careful).action,'stand'); assert.equal(B.chooseAction(view,analyst).action,'hit');
  const ten = {cards:cards(4,6),dealerUp:cards(10)[0],canDouble:true};
  assert.equal(B.chooseAction(ten,bold).action,'double'); assert.equal(B.chooseAction(ten,analyst).action,'hit');
  assert.equal(B.chooseAction(view,whim,()=>0).action,'stand'); assert.equal(B.chooseAction(view,whim,()=>1).action,'hit');
  assert.ok(B.wagerFor(100,bold,()=>.5)>B.wagerFor(100,careful,()=>.5));
});

test('AI basic strategy handles hard/soft thresholds and never doubles when illegal', () => {
  const analyst = B.PROFILES[1];
  for (const [hand,up,canDouble,action] of [[[5,6],10,true,'double'],[[5,6],1,true,'hit'],[[10,7],10,true,'stand'],[[1,7],6,true,'double'],[[1,7],6,false,'stand'],[[1,7],10,true,'hit'],[[1,6],3,false,'hit'],[[1,8],1,true,'stand'],[[10,2],4,true,'stand']]) {
    assert.equal(B.chooseAction({cards:cards(...hand),dealerUp:cards(up)[0],canDouble},analyst).action,action);
  }
  for (const profile of B.PROFILES) assert.notEqual(B.chooseAction({cards:cards(4,6),dealerUp:cards(10)[0],canDouble:false},profile,()=>.5).action,'double');
});

test('anti-peeking: replacing every hidden card and shoe preserves redacted AI view and fixed-seed choice', () => {
  const g = opening([10,9],[10,8]); g.act('stand');
  const before = JSON.stringify(g.view(1)); const choice = JSON.stringify(B.chooseAction(g.view(1),g.seats[1].profile,seeded(123)));
  g.dealer[1] = cards(1)[0]; g.shoe = cards(...Array(100).fill(2));
  g.seats[0].cards = cards(2,2); g.seats[2].cards = cards(3,3); g.seats[3].cards = cards(4,4);
  assert.equal(JSON.stringify(g.view(1)),before);
  assert.equal(JSON.stringify(B.chooseAction(g.view(1),g.seats[1].profile,seeded(123))),choice);
  assert.deepEqual(Object.keys(g.view(1)).sort(),['balance','bet','canDouble','cards','dealerUp']);
  assert.ok(!before.includes('shoe') && !before.includes('fixture'));
});

test('1,500 deterministic complete rounds keep legal turns, nonnegative funds, physical-card identities and one settlement', () => {
  let blackjacks = 0, doubles = 0, wins = 0, losses = 0;
  for (let seed = 1; seed <= 15; seed++) {
    const g = new B.Game(seeded(seed));
    for (let round = 0; round < 100; round++) {
      if (g.seats[0].balance < 5) g.reset();
      assert.equal(g.startRound(Math.min(10,g.seats[0].balance)),true);
      let steps = 0;
      while (g.active()) {
        assert.ok(++steps < 150);
        if (g.phase === 'player') { const choice = B.chooseAction(g.view(0),B.PROFILES[1],seeded(round+seed)); if(choice.action==='double') doubles++; assert.equal(g.act(choice.action),true); }
        else assert.equal(g.step(),true);
        for (const s of g.seats) assert.ok(s.balance >= 0 && Number.isFinite(s.balance));
      }
      assert.equal(g.phase,'result'); assert.equal(g.settled,true);
      const dealt = [...g.dealer,...g.seats.flatMap(s=>s.cards)]; assert.equal(new Set(dealt.map(c=>c.id)).size,dealt.length);
      for (const seat of g.seats) { assert.ok(seat.done); assert.ok(['win','loss','push','blackjack'].includes(seat.result)); }
      blackjacks += g.seats.filter(s=>s.result==='blackjack').length; wins += g.seats[0].result==='win'; losses += g.seats[0].result==='loss';
      const before = g.seats[0].balance; g.settle(); assert.equal(g.seats[0].balance,before);
    }
  }
  assert.ok(blackjacks>100 && doubles>50 && wins>100 && losses>100);
});

test('page declares free-only local AI, omissions, fixed dealer and automatic pause', () => {
  assert.match(html,/href="fulab-theme.css"/); assert.match(html,/class="site-nav"/); assert.match(html,/class="page-header"/); assert.match(html,/class="card play-panel"/); assert.match(html,/<details class="card rules">/);
  assert.match(html,/本版不提供分牌、保險或投降/); assert.match(html,/無購買或兌現/); assert.match(html,/固定 S17/);
  assert.match(html,/visibilitychange/); assert.match(html,/window.addEventListener\('blur', pause\)/);
  assert.doesNotMatch(html,/fetch\(|WebSocket|<script[^>]+src=|https?:\/\//);
  for (const [,script] of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(()=>new vm.Script(script));
});
