'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../blackjack.html'), 'utf8');
const B = vm.runInNewContext(html.match(/<script id="blackjack-engine">([\s\S]*?)<\/script>/)[1] + '; Blackjack;');
const C = vm.runInNewContext(html.match(/<script id="blackjack-career">([\s\S]*?)<\/script>/)[1] + '; BlackjackCareer;');
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


test('page is a full-screen Vermilion Ink table: free-only, local three.js, drawer rules, automatic pause', () => {
  assert.match(html, /href="shared\/fu\.css"/); assert.match(html, /<body class="fu-app[^"]*"/); assert.match(html, /class="fu-topbar"/);
  assert.match(html, /class="fu-brand" href="index\.html"[^>]*><span class="fu-seal"[^>]*>福遊<\/span>/);
  assert.match(html, /<main class="fu-stage"[^>]*><canvas id="table3d"/); assert.match(html, /class="fu-drawer" id="drawer"/); assert.match(html, /class="fu-curtain" id="curtain"/);
  assert.match(html, /class="[^"]*\bfu-hud--tl\b/); assert.match(html, /id="dock"/);
  assert.doesNotMatch(html, /fulab-theme\.css|class="site-nav"|class="page-header"|play-panel|<details class="card rules">/);
  assert.match(html, /"three":"\.\/vendor\/three\/three\.module\.min\.js"/); assert.match(html, /from '\.\/shared\/fu-three\.js'/);
  assert.match(html, /無購買或兌現/); assert.match(html, /純免費虛擬籌碼/);
  assert.match(html, /visibilitychange/); assert.match(html, /window.addEventListener\('blur', pause\)/);
  assert.doesNotMatch(html, /fetch\(|WebSocket|https?:\/\//);
  for (const [, src] of html.matchAll(/<script[^>]+src="([^"]+)"/g)) { assert.doesNotMatch(src, /^(?:[a-z]+:)?\/\//); assert.ok(fs.existsSync(path.join(__dirname, '..', src)), src); }
  for (const [, attrs, script] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/importmap/.test(attrs)) { assert.doesNotThrow(() => JSON.parse(script)); continue; }
    const body = /type="module"/.test(attrs) ? '(async () => {' + script.replace(/^\s*import\b[^;]*;/gm, '') + '\n})' : script;
    assert.doesNotThrow(() => new vm.Script(body));
  }
});

// ---------- New rules (all off by default) ----------
const same = (a, b, msg) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);
const ruled = (opts, player, dealer, next = [10, 10, 10, 10, 10], side) => {
  const g = new B.Game(seeded(6), opts);
  const order = cards(player[0], 10, 10, 10, dealer[0], player[1], 8, 8, 8, dealer[1], ...next);
  g.shoe = [...cards(...Array(120).fill(10)), ...order.reverse()];
  assert.equal(g.startRound(10, side), true); return g;
};

test('defaults reproduce the original table and options are validated', () => {
  const g = new B.Game(seeded(1));
  same({ ...g.rules }, { ...B.DEFAULTS, cut: 80 });
  assert.equal(B.normalize({ decks: 1 }).cut, 20); assert.equal(B.normalize({ decks: 8 }).cut, 107);
  const bad = B.normalize({ decks: 3, bjPay: 2, doubleOn: '8', maxHands: 9, unit: -1, stack: 1, rounds: 99, h17: 'yes' });
  assert.equal(bad.decks, 6); assert.equal(bad.bjPay, 1.5); assert.equal(bad.doubleOn, 'any'); assert.equal(bad.maxHands, 4); assert.equal(bad.unit, 5); assert.equal(bad.stack, 100); assert.equal(bad.rounds, 0); assert.equal(bad.h17, false);
  assert.equal(B.normalize({ rounds: 8 }).refill, false); assert.equal(B.normalize({ rounds: 8, refill: true }).refill, true);
  assert.equal(B.makeShoe(seeded(3), 2).length, 104);
  for (const t of B.TABLES) { const r = B.normalize(t.rules); assert.ok(r.maxBet >= r.unit && r.stack >= r.unit && t.chips.length === 4, t.id); }
  const plain = opening([8, 8], [10, 7]); assert.equal(plain.canSplit(0), false); assert.equal(plain.act('split'), false); assert.equal(plain.act('surrender'), false);
});

test('H17 dealer hits soft 17 but still stands on hard 17', () => {
  assert.equal(B.dealerShouldHit(cards(1, 6), true), true); assert.equal(B.dealerShouldHit(cards(10, 7), true), false); assert.equal(B.dealerShouldHit(cards(1, 6, 10), true), false);
  const g = ruled({ h17: true }, [10, 9], [1, 6], [2]); g.act('stand'); finish(g);
  assert.equal(g.dealer.length, 3); assert.equal(B.handValue(g.dealer).total, 19); assert.equal(g.seats[0].result, 'push');
  const s17 = opening([10, 9], [1, 6], [2]); finish(s17); assert.equal(s17.dealer.length, 2); assert.equal(s17.seats[0].result, 'win');
});

test('split makes two funded hands, plays them in order and settles each; split 21 is not blackjack', () => {
  const g = ruled({ split: true }, [8, 8], [10, 7], [3, 1, 2]);
  assert.equal(g.canSplit(0), true); assert.equal(g.act('split'), true);
  const you = g.seats[0];
  assert.equal(you.hands.length, 2); assert.equal(you.balance, 80); assert.equal(you.bet, 20);
  same(you.hands[0].cards.map(c => c.rank), [8, 3]); assert.equal(you.hand, 0);
  assert.equal(g.act('double'), true); // double after split is on by default: 11 doubled, draws an ace -> 12
  assert.equal(you.hands[0].bet, 20); assert.equal(you.hand, 1); same(you.hands[1].cards.map(c => c.rank), [8, 2]);
  assert.equal(g.act('stand'), true); finish(g);
  assert.equal(you.hands[0].result, 'loss'); assert.equal(you.hands[1].result, 'loss'); assert.equal(you.balance, 70); assert.equal(you.delta, -30);
  const twentyOne = ruled({ split: true }, [1, 1], [10, 7], [10, 10]);
  assert.equal(twentyOne.act('split'), true);
  const t = twentyOne.seats[0]; assert.equal(t.hands.length, 2); assert.ok(t.hands.every(h => h.done && h.cards.length === 2));
  finish(twentyOne); same(t.hands.map(h => h.result), ['win', 'win']); assert.equal(t.balance, 120); assert.equal(t.result, 'win');
});

test('split limits: max hands, no resplit aces unless allowed, DAS and double restrictions', () => {
  const g = ruled({ split: true, maxHands: 2 }, [8, 8], [10, 7], [8, 8, 8]);
  g.act('split'); assert.equal(g.seats[0].hands[0].cards[1].rank, 8); assert.equal(g.canSplit(0), false);
  const aces = ruled({ split: true }, [1, 1], [10, 7], [1, 5, 5]); aces.act('split');
  assert.equal(aces.seats[0].hands[0].done, true); assert.equal(aces.seats[0].hands.length, 2);
  const re = ruled({ split: true, resplitAces: true }, [1, 1], [10, 7], [1, 5, 5, 5]); re.act('split');
  assert.equal(re.phase, 'player'); assert.equal(re.canSplit(0), true); assert.equal(re.act('split'), true); assert.equal(re.seats[0].hands.length, 3);
  const noDas = ruled({ split: true, das: false }, [8, 8], [10, 7], [3, 3]); noDas.act('split'); assert.equal(noDas.canDouble(0), false);
  const ten = ruled({ doubleOn: '10-11' }, [5, 4], [10, 7]); assert.equal(ten.canDouble(0), false);
  const eleven = ruled({ doubleOn: '10-11' }, [5, 6], [10, 7]); assert.equal(eleven.canDouble(0), true);
  const softNine = ruled({ doubleOn: '9-11' }, [1, 7], [10, 7]); assert.equal(softNine.canDouble(0), false);
});

test('late surrender returns half, only on the first two cards of an unsplit hand', () => {
  const g = ruled({ surrender: true }, [10, 6], [10, 7]); assert.equal(g.canSurrender(0), true);
  assert.equal(g.act('surrender'), true); finish(g);
  assert.equal(g.seats[0].result, 'surrender'); assert.equal(g.seats[0].balance, 95); assert.equal(g.seats[0].delta, -5);
  const hit = ruled({ surrender: true }, [2, 3], [10, 7], [2]); hit.act('hit'); assert.equal(hit.canSurrender(0), false); assert.equal(hit.act('surrender'), false);
  const sp = ruled({ surrender: true, split: true }, [8, 8], [10, 7], [3, 3]); sp.act('split'); assert.equal(sp.canSurrender(0), false);
  const peeked = ruled({ surrender: true }, [10, 6], [1, 10]); assert.equal(peeked.phase, 'result'); assert.equal(peeked.seats[0].balance, 90);
});

test('insurance: offered on an ace, pays 2:1 on dealer blackjack, is lost otherwise; graded by true count', () => {
  const g = ruled({ insurance: true }, [10, 9], [1, 10]);
  assert.equal(g.phase, 'insurance'); assert.equal(g.active(), true); assert.equal(g.act('stand'), false); assert.equal(g.canInsure(), true);
  assert.equal(g.insure(true), true); assert.equal(g.phase, 'result');
  assert.equal(g.seats[0].balance, 100); assert.equal(g.seats[0].delta, 0); assert.equal(g.insure(true), false);
  assert.equal(g.lastGrade.action, 'insure'); assert.equal(g.lastGrade.best, 'decline'); assert.equal(g.lastGrade.correct, false);
  const miss = ruled({ insurance: true }, [10, 9], [1, 7]); assert.equal(miss.insure(true), true);
  assert.equal(miss.phase, 'player'); assert.equal(miss.seats[0].balance, 85); finish(miss); assert.equal(miss.seats[0].balance, 105); assert.equal(miss.seats[0].delta, 5);
  const no = ruled({ insurance: true }, [10, 9], [1, 7]); no.insure(false); assert.equal(no.lastGrade.correct, true);
  const hot = ruled({ insurance: true }, [10, 9], [1, 7]); hot.running = 40; assert.ok(hot.trueCount() >= 3); hot.insure(true); assert.equal(hot.lastGrade.correct, true);
  const paused = ruled({ insurance: true }, [10, 9], [1, 7]); paused.pause(); assert.equal(paused.insure(false), false); paused.resume(); assert.equal(paused.insure(false), true);
  const off = opening([10, 9], [1, 7]); assert.equal(off.phase, 'player');
  assert.equal(B.chooseInsurance(cards(1, 10), B.PROFILES[0]), true); assert.equal(B.chooseInsurance(cards(10, 9), B.PROFILES[1]), false);
});

test('side bets pay at the deal, need funds and are ignored when the table has none', () => {
  assert.equal(B.perfectPairs({ rank: 5, suit: 0 }, { rank: 5, suit: 0 }).kind, 'perfect');
  assert.equal(B.perfectPairs({ rank: 5, suit: 1 }, { rank: 5, suit: 2 }).kind, 'colored');
  assert.equal(B.perfectPairs({ rank: 5, suit: 0 }, { rank: 5, suit: 1 }).pay, 6); assert.equal(B.perfectPairs({ rank: 5, suit: 0 }, { rank: 6, suit: 0 }), null);
  const tc = (...rs) => B.threeCard(rs.map(([rank, suit]) => ({ rank, suit })));
  assert.equal(tc([7, 2], [7, 2], [7, 2]).pay, 100); assert.equal(tc([5, 0], [6, 0], [7, 0]).kind, 'straight-flush'); assert.equal(tc([9, 0], [9, 1], [9, 3]).pay, 30);
  assert.equal(tc([12, 0], [13, 1], [1, 2]).kind, 'straight'); assert.equal(tc([1, 0], [2, 1], [3, 2]).kind, 'straight'); assert.equal(tc([2, 3], [9, 3], [13, 3]).pay, 5); assert.equal(tc([2, 0], [9, 1], [13, 3]), null);
  const g = ruled({ sideBets: true }, [10, 10], [9, 8], undefined, { pp: 5, t3: 5 });
  const you = g.seats[0]; assert.equal(you.side.pp.hit.kind, 'mixed'); assert.equal(you.side.pp.returned, 35); assert.equal(you.side.t3.hit, null);
  assert.equal(you.balance, 115); finish(g); assert.equal(you.balance, 135); assert.equal(you.delta, 35);
  const off = ruled({}, [10, 10], [10, 7], undefined, { pp: 5, t3: 5 }); assert.equal(off.seats[0].sideStake, 0); assert.equal(off.seats[0].balance, 90);
  const poor = new B.Game(seeded(2), { sideBets: true }); poor.seats[0].balance = 12; assert.equal(poor.startRound(10, { pp: 5 }), false); assert.equal(poor.startRound(10, { pp: NaN }), true);
});

test('6:5 blackjack payout and table max bet', () => {
  const g = ruled({ bjPay: 1.2 }, [1, 10], [10, 7]); finish(g); assert.equal(g.seats[0].balance, 112);
  assert.equal(B.payout('blackjack', 10), 25); assert.equal(B.payout('surrender', 10), 5);
  const t = new B.Game(seeded(3), { maxBet: 20 }); assert.equal(t.startRound(25), false); assert.equal(t.startRound(20), true);
});

test('basic strategy: pairs, surrender, H17 deviations, and the original policy when nothing extra is legal', () => {
  const S = (hand, up, opt = {}) => B.strategy(cards(...hand), cards(up)[0], { canDouble: true, ...opt }).action;
  for (const [hand, up, das, want] of [[[1, 1], 1, true, 'split'], [[8, 8], 10, true, 'split'], [[10, 10], 6, true, 'stand'], [[5, 5], 6, true, 'double'], [[9, 9], 7, true, 'stand'], [[9, 9], 8, true, 'split'], [[2, 2], 2, true, 'split'], [[2, 2], 2, false, 'hit'], [[4, 4], 5, true, 'split'], [[4, 4], 5, false, 'hit'], [[6, 6], 2, false, 'hit'], [[7, 7], 8, true, 'hit'], [[13, 12], 5, true, 'stand']])
    assert.equal(S(hand, up, { canSplit: true, das }), want, `${hand} v ${up} das=${das}`);
  assert.equal(S([10, 6], 10, { canSurrender: true }), 'surrender'); assert.equal(S([10, 6], 8, { canSurrender: true }), 'hit');
  assert.equal(S([10, 5], 10, { canSurrender: true }), 'surrender'); assert.equal(S([10, 5], 1, { canSurrender: true }), 'hit'); assert.equal(S([10, 5], 1, { canSurrender: true, h17: true }), 'surrender');
  assert.equal(S([10, 7], 1, { canSurrender: true, h17: true }), 'surrender'); assert.equal(S([8, 8], 10, { canSurrender: true, canSplit: true }), 'split');
  assert.equal(S([5, 6], 1), 'hit'); assert.equal(S([5, 6], 1, { h17: true }), 'double');
  assert.equal(S([1, 7], 2), 'stand'); assert.equal(S([1, 7], 2, { h17: true }), 'double'); assert.equal(S([1, 8], 6, { h17: true }), 'double'); assert.equal(S([1, 8], 6, { h17: true, canDouble: false }), 'stand');
  // Same answers as the original analyst seat for every two-card hand when no new rule is on.
  for (let a = 1; a <= 10; a++) for (let b = a; b <= 10; b++) for (let up = 1; up <= 10; up++) for (const canDouble of [true, false]) {
    const view = { cards: cards(a, b), dealerUp: cards(up)[0], canDouble };
    assert.equal(B.chooseAction(view, B.PROFILES[1]).action, B.strategy(view.cards, view.dealerUp, { canDouble }).action);
  }
  assert.equal(B.chooseAction({ cards: cards(10, 6), dealerUp: cards(10)[0], canDouble: true }, B.PROFILES[2], () => .5, { canSurrender: true }).action, 'hit');
  assert.equal(B.chooseAction({ cards: cards(10, 5), dealerUp: cards(9)[0], canDouble: true }, B.PROFILES[0], () => .5, { canSurrender: true }).action, 'surrender');
});

test('coach grades each human decision against the legal basic-strategy play; AI moves are not graded', () => {
  const g = ruled({ split: true }, [8, 8], [10, 7], [10, 10, 10]);
  assert.equal(g.advice(0).action, 'split'); g.act('hit');
  assert.equal(g.lastGrade.action, 'hit'); assert.equal(g.lastGrade.best, 'split'); assert.equal(g.lastGrade.correct, false); assert.match(g.lastGrade.reason, /8/);
  finish(g); assert.equal(g.grades.length, 1);
  const ok = opening([10, 7], [10, 6]); ok.act('stand'); assert.equal(ok.lastGrade.correct, true);
  finish(ok); ok.startRound(10); assert.equal(ok.grades.length, 0); assert.equal(ok.lastGrade, null);
});

test('Hi-Lo running count ignores the hole card until it is revealed', () => {
  same([1, 2, 6, 7, 9, 10, 13].map(r => B.hilo({ rank: r })), [-1, 1, 1, 0, 0, -1, -1]);
  const g = new B.Game(seeded(4)); g.shoe = cards(...Array(100).fill(9));
  const order = cards(5, 10, 10, 10, 6, 4, 8, 8, 8, 2); g.shoe.push(...order.reverse()); g.startRound(10);
  // visible: 5,10,10,10,6,4,8,8,8 => +1 -1 -1 -1 +1 +1 0 0 0 = 0; the hole 2 stays hidden
  assert.equal(g.running, 0); g.act('stand'); while (g.phase === 'ai') g.step(); assert.equal(g.revealed, true); assert.equal(g.running, 1);
  const fresh = new B.Game(seeded(4)); fresh.startRound(10); assert.equal(fresh.shuffled, true);
});

test('empty shoe reshuffles only cards that are not on the table', () => {
  const g = new B.Game(seeded(5), { decks: 1, split: true });
  for (let round = 0; round < 300; round++) {
    if (g.seats[0].balance < 5) g.reset();
    g.startRound(5);
    while (g.active()) { if (g.phase === 'player') g.act(g.advice(0).action); else g.step(); }
    const dealt = [...g.dealer, ...g.seats.flatMap(s => s.hands.flatMap(h => h.cards))];
    assert.equal(new Set(dealt.map(c => c.id)).size, dealt.length);
  }
});

test('tournament: fixed hands, no refills, standings with shared places, AIs chase the leader late', () => {
  const g = new B.Game(seeded(11), { rounds: 3, maxBet: Infinity });
  assert.equal(g.rules.refill, false);
  for (let i = 0; i < 3; i++) { assert.equal(g.startRound(10), true); while (g.active()) { if (g.phase === 'player') g.act('stand'); else g.step(); } }
  assert.equal(g.over, true); assert.equal(g.startRound(10), false);
  const st = g.standings(); assert.equal(st.length, 4); assert.ok(st.every((s, i) => i === 0 || s.balance <= st[i - 1].balance)); assert.equal(st[0].place, 1);
  g.seats.forEach(s => { s.balance = 50; }); assert.ok(g.standings().every(s => s.place === 1)); assert.equal(g.standings()[0].index, 0);
  const out = new B.Game(seeded(12), { rounds: 5 }); out.seats[1].balance = 0; out.startRound(10);
  assert.equal(out.seats[1].out, true); assert.equal(out.seats[1].hands.length, 0); assert.equal(out.seats[1].balance, 0);
  while (out.active()) { if (out.phase === 'player') out.act('stand'); else out.step(); }
  assert.equal(out.seats[1].result, null); assert.equal(out.seats[1].balance, 0);
  const bust = new B.Game(seeded(13), { rounds: 5 }); bust.seats[0].balance = 10; bust.shoe = [...cards(...Array(100).fill(10)), ...cards(10, 10, 10, 10, 10, 6, 8, 8, 8, 9).reverse()];
  bust.startRound(10); while (bust.active()) { if (bust.phase === 'player') bust.act('stand'); else bust.step(); }
  assert.equal(bust.seats[0].balance, 0); assert.equal(bust.over, true);
  const [careful, analyst, bold] = B.PROFILES;
  assert.equal(B.wagerFor(100, bold, () => .5, { unit: 5, handsLeft: 1, leader: 300 }), 100);
  assert.equal(B.wagerFor(100, analyst, () => .5, { unit: 5, handsLeft: 2, leader: 180 }), 85);
  assert.equal(B.wagerFor(300, careful, () => .5, { unit: 5, handsLeft: 1, leader: 300 }), 5);
  assert.ok(B.wagerFor(100, analyst, () => .5, { unit: 5, handsLeft: 5, leader: 300 }) <= 20);
  assert.equal(B.wagerFor(1000, careful, () => .5, { unit: 50, maxBet: 1000 }), 50); assert.equal(B.wagerFor(1000, bold, () => .5, { unit: 25, maxBet: 100 }), 100);
});

test('5,000 deterministic rounds with every rule on keep money conserved and every seat legal', () => {
  const rules = { decks: 2, h17: true, split: true, das: true, resplitAces: true, surrender: true, insurance: true, sideBets: true, maxHands: 4, unit: 5, maxBet: 50, stack: 200 };
  let splits = 0, surrenders = 0, insurances = 0, sideHits = 0;
  for (let seed = 1; seed <= 25; seed++) {
    const g = new B.Game(seeded(seed * 7), rules), rnd = seeded(seed);
    for (let round = 0; round < 200; round++) {
      if (g.seats[0].balance < 15) g.reset();
      const before = g.seats.map(s => s.balance);
      const startBal = before.map((b, i) => i > 0 && b < g.rules.unit ? g.rules.stack : b);
      assert.equal(g.startRound(5, { pp: 5, t3: 5 }), true);
      let steps = 0;
      while (g.active()) {
        assert.ok(++steps < 300);
        if (g.phase === 'insurance') { g.insure(rnd() < .3); insurances++; }
        else if (g.phase === 'player') { const a = rnd() < .8 ? g.advice(0).action : ['hit', 'stand'][Math.floor(rnd() * 2)]; if (a === 'split') splits++; if (a === 'surrender') surrenders++; assert.equal(g.act(a), true); }
        else assert.equal(g.step(), true);
        for (const s of g.seats) assert.ok(s.balance >= -1e-9 && Number.isFinite(s.balance));
      }
      assert.equal(g.phase, 'result');
      g.seats.forEach((s, i) => { assert.ok(Math.abs(s.balance - startBal[i] - s.delta) < 1e-9, `seat ${i} conserves`); assert.ok(s.hands.length <= 4); });
      if (g.seats[0].side.pp.hit || g.seats[0].side.t3.hit) sideHits++;
      const dealt = [...g.dealer, ...g.seats.flatMap(s => s.hands.flatMap(h => h.cards))]; assert.equal(new Set(dealt.map(c => c.id)).size, dealt.length);
    }
  }
  assert.ok(splits > 50 && surrenders > 20 && insurances > 50 && sideHits > 50, JSON.stringify({ splits, surrenders, insurances, sideHits }));
});

// ---------- Career ----------
test('career levels, ranks and unlocks', () => {
  assert.equal(C.need(1), 130); same({ ...C.levelOf(0) }, { level: 1, into: 0, need: 130, max: false });
  assert.equal(C.levelOf(129).level, 1); assert.equal(C.levelOf(130).level, 2); assert.equal(C.levelOf(130 + 160).level, 3);
  let xp = 0; for (let l = 1; l < C.MAX_LEVEL; l++) xp += C.need(l);
  assert.equal(C.levelOf(xp).max, true); assert.equal(C.levelOf(xp * 3).level, C.MAX_LEVEL); assert.equal(C.levelOf(-5).level, 1); assert.equal(C.levelOf('x').level, 1);
  assert.equal(C.rankOf(1), '新客'); assert.equal(C.rankOf(13), '高手'); assert.equal(C.rankOf(30), '傳奇');
  assert.equal(C.unlocked(1, 'table', 'classic'), true); assert.equal(C.unlocked(2, 'table', 'jade'), false); assert.equal(C.unlocked(3, 'table', 'jade'), true);
  assert.equal(C.unlockLevel('table', 'seal'), 10); assert.equal(C.unlockLevel('mode', 'tournament'), 2); assert.equal(C.unlockLevel('nope', 'x'), Infinity);
  for (const t of B.TABLES) { assert.ok(Number.isFinite(C.unlockLevel('table', t.id))); assert.ok(C.TABLE_XP[t.id] >= 1); }
});

test('hand XP rewards correct un-hinted decisions and table tier; records stats and streaks', () => {
  const s = { table: 'classic', delta: 10, results: [{ result: 'win', doubled: false, cards: 2, total: 20 }], grades: [{ correct: true, hinted: false }, { correct: true, hinted: true }, { correct: false, hinted: false }] };
  const x = C.handXP(s); assert.equal(x.base, 4 + 6 + 3); assert.equal(x.total, 13);
  assert.equal(C.handXP({ ...s, table: 'seal' }).total, Math.round(13 * 1.7));
  assert.equal(C.handXP({ table: 'classic', results: [{ result: 'blackjack' }] }).total, 16); assert.equal(C.handXP({ table: 'classic', results: [{ result: 'win', doubled: true }] }).total, 14);
  assert.equal(C.handXP({ table: 'classic', results: [{ result: 'loss' }] }).total, 4);
  const rec = C.recordHand(C.blank(), s), p = rec.profile;
  assert.equal(p.hands, 1); assert.equal(p.wins, 1); assert.equal(p.decisions, 2); assert.equal(p.correct, 1); assert.equal(p.streak, 0); assert.equal(p.bestStreak, 1); assert.equal(p.winRun, 1);
  assert.equal(p.xp, rec.gain.total); assert.equal(C.accuracy(p), .5); assert.equal(C.accuracy(C.blank()), null);
  let q = C.blank(); for (let i = 0; i < 20; i++) q = C.recordHand(q, { table: 'classic', delta: -5, results: [{ result: 'loss', cards: 2, total: 18 }], grades: [{ correct: true }] }).profile;
  assert.equal(q.bestStreak, 20); assert.ok(q.ach.includes('textbook')); assert.equal(q.winRun, 0); assert.equal(q.losses, 20);
});

test('achievements are awarded once with bonus XP; tournament XP by place; storage is sanitized', () => {
  const first = C.recordHand(C.blank(), { table: 'seal', delta: 30, results: [{ result: 'blackjack', cards: 2, total: 21 }, { result: 'win', doubled: true, cards: 3, total: 20 }], grades: [], pp: 'perfect', t3: 'flush', insurancePaid: true });
  const ids = first.earned.map(a => a.id).sort();
  same(ids, ['double-win', 'first-bj', 'insured', 'perfect-pair', 'seal-win', 'split-sweep', 'three-card']);
  assert.equal(first.gain.total, Math.round(C.handXP({ table: 'seal', results: [{ result: 'blackjack' }, { result: 'win', doubled: true }] }).base * 1.7) + 7 * C.ACH_XP);
  const again = C.recordHand(first.profile, { table: 'seal', delta: 5, results: [{ result: 'blackjack', cards: 2, total: 21 }], grades: [] }); assert.equal(again.earned.length, 0);
  assert.ok(C.recordHand(C.blank(), { table: 'classic', delta: 5, results: [{ result: 'win', cards: 5, total: 21 }] }).earned.some(a => a.id === 'charlie'));
  const t1 = C.recordTournament(C.blank(), { table: 'jade', place: 1 }); assert.equal(t1.gain.base, 150); assert.equal(t1.gain.total, 180 + C.ACH_XP); assert.equal(t1.profile.tourneyWins, 1); assert.ok(t1.profile.ach.includes('champion'));
  assert.equal(C.recordTournament(C.blank(), { table: 'classic', place: 4 }).gain.total, 30); assert.equal(C.recordTournament(C.blank(), { table: 'classic', place: 2 }).profile.tourneyWins, 0);
  const lv = C.recordHand({ ...C.blank(), xp: 125 }, { table: 'classic', delta: 0, results: [{ result: 'push' }] }); assert.equal(lv.before.level, 1); assert.equal(lv.after.level, 2); same(lv.unlocked.map(u => u.id), ['tournament']);
  const mem = new Map(), storage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  same(C.load(storage), C.blank()); assert.equal(C.save(storage, { ...C.blank(), xp: 77.9, hands: -3, ach: ['first-bj', 'first-bj', 'bogus'] }), true);
  const loaded = C.load(storage); assert.equal(loaded.xp, 77); assert.equal(loaded.hands, 0); same([...loaded.ach], ['first-bj']);
  mem.set(C.KEY, '{broken'); same(C.load(storage), C.blank());
  assert.equal(C.save({ setItem() { throw new Error('quota'); } }, C.blank()), false);
});
