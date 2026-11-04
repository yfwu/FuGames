/* FuGames bridge card play.
 * - Opening leads follow standard conventions (top of sequence, 4th best vs NT, partner's suit, short-suit leads).
 * - Early tricks use bridge heuristics (second hand low, third hand high, cover an honour, attitude signals,
 *   drawing trumps, leading toward honours).
 * - Once the hand is small enough, play switches to Monte Carlo double dummy: hidden hands are sampled consistently
 *   with the auction inference (HCP ranges, shown suit lengths) and shown-out suits, then every distinct card is
 *   solved double dummy on each sample. The AI never reads hidden hands: only the public view is used.
 */
'use strict';
(function (root, factory) {
  const B = root.Bridge || (typeof require === 'function' ? require('./bridge-engine.js') : null);
  const BB = root.BridgeBidding || (typeof require === 'function' ? require('./bridge-bidding.js') : null);
  const DDS = root.BridgeDDS || (typeof require === 'function' ? require('./bridge-dds.js') : null);
  const api = factory(B, BB, DDS);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BridgePlay = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (B, BB, DDS) {
  const { suit, rank, side, partner, winner } = B;
  const SN = ['♣', '♦', '♥', '♠', 'NT'];
  const label = c => B.cardLabel(c);
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const MODES = {
    fast: { ddTricks: 0, maxSamples: 0, budget: 0 },
    quick: { ddTricks: 6, maxSamples: 12, budget: 1500, nodeLimit: 150000 },
    normal: { ddTricks: 9, maxSamples: 24, budget: 900, nodeLimit: 400000 },
    strong: { ddTricks: 10, maxSamples: 40, budget: 2500, nodeLimit: 900000 }
  };

  function hashView(v) {
    let h = 2166136261 ^ v.seat;
    const mix = x => { h = Math.imul(h ^ x, 16777619); };
    v.hand.forEach(mix); v.played.forEach(p => { mix(p.card); mix(p.seat + 64); }); v.auction.forEach(a => { for (const ch of a.call) mix(ch.charCodeAt(0)); });
    mix(v.board || 0);
    return h >>> 0;
  }
  const bySuit = (cards, s) => cards.filter(c => suit(c) === s).sort((a, b) => b - a);
  const hcpOf = c => Math.max(0, rank(c) - 10);

  function seenCards(v) {
    const seen = new Set(v.played.map(p => p.card));
    for (const h of Object.values(v.knownHands)) h.forEach(c => seen.add(c));
    return seen;
  }
  // a card is a master when every higher card of the suit is already visible to us (played or in our sight)
  function isMaster(c, v, seen = seenCards(v), mine = new Set()) {
    for (let r = rank(c) + 1; r <= 14; r++) { const x = suit(c) * 13 + r - 2; if (!seen.has(x) && !mine.has(x)) return false; }
    return true;
  }
  function currentWinner(trick, trump) { return trick.length ? winner(trick, trump) : null; }

  // ---------- opening lead ----------
  function leadCardFromSuit(cards, nt, partnerSuit) {
    const rs = cards.map(rank);
    const n = cards.length;
    if (n === 1) return { card: cards[0], why: '單張' };
    if (n === 2) return { card: cards[0], why: '雙張出大' };
    // touching honours / sequences
    for (let i = 0; i + 1 < n; i++) {
      if (rs[i] >= 10 && rs[i] - rs[i + 1] === 1 && (i === 0 || nt)) {
        if (i === 0 && rs[0] === 14 && rs[1] === 13) return { card: nt ? cards[0] : cards[0], why: 'AK 連張出 A' };
        if (i === 0) return { card: cards[0], why: '連張出頂張' };
        // interior sequence (KJT, AJT, KT9 vs NT)
        if (nt && rs[i - 1] - rs[i] === 2) return { card: cards[i], why: '內部連張' };
      }
    }
    if (partnerSuit) return { card: rs[0] >= 11 && n === 3 ? cards[n - 1] : n >= 3 ? cards[n - 1] : cards[0], why: '搭檔的花色' };
    const hasHonor = rs[0] >= 11;
    if (!hasHonor) return { card: n >= 4 && nt ? cards[3] : cards[0], why: n >= 4 && nt ? '第四大' : '無大牌出大' };
    if (n >= 4) return { card: cards[3], why: '長門第四大' };
    return { card: cards[n - 1], why: '從大牌下出小' };
  }
  function openingLead(v) {
    const trump = v.contract.strain, nt = trump === 4, hand = v.hand;
    const declarer = v.contract.declarer, dummy = v.contract.dummy, pd = partner(v.seat);
    const auction = v.auction;
    const bidStrains = seat => auction.filter(a => a.seat === seat && B.isBid(a.call)).map(a => B.parseBid(a.call).strain).filter(s => s < 4);
    const pdSuits = bidStrains(pd), oppSuits = [...bidStrains(declarer), ...bidStrains(dummy)];
    const trumpLen = nt ? 0 : bySuit(hand, trump).length;
    let best = null;
    for (let s = 0; s < 4; s++) {
      const cards = bySuit(hand, s);
      if (!cards.length) continue;
      const rs = cards.map(rank), n = cards.length;
      const pick = leadCardFromSuit(cards, nt, pdSuits.includes(s));
      let score = 0;
      if (pdSuits.includes(s)) score += 4;
      if (oppSuits.includes(s)) score -= 2.5;
      const seq = rs.length >= 2 && rs[0] >= 11 && rs[0] - rs[1] === 1;
      const solid = seq && rs.length >= 3 && rs[1] - rs[2] === 1;
      if (seq) score += solid ? 3.5 : 2.2;
      if (nt) {
        score += n >= 4 ? n * 0.9 + cards.filter(c => rank(c) >= 11).length * 0.6 : n * 0.2;
        if (rs[0] === 14 && !seq && n < 5) score -= 1;
      } else {
        if (s === trump) score += trumpLen >= 2 && !seq ? -0.6 : -1.5;
        if (rs[0] === 14 && rs[1] === 13) score += 2.5;
        else if (rs[0] === 14 && s !== trump) score -= 2.2;           // do not underlead / lead away from an ace
        else if (rs[0] >= 12 && !seq && n <= 4) score -= 1.2;         // leading away from an unsupported honour
        if (n === 1 && s !== trump && trumpLen >= 1) score += 2.4 + (trumpLen <= 3 ? 0.4 : 0);
        if (n === 2 && s !== trump && !seq) score += 0.6;
        if (rs[0] <= 9 && n >= 3) score += 0.4;                       // passive top of nothing
      }
      if (!best || score > best.score) best = { card: pick.card, score, why: pick.why, s };
    }
    const why = `首攻慣例：${SN[best.s]}${best.why}${pdSuits.includes(best.s) ? '（搭檔叫過）' : ''}`;
    return { card: best.card, reason: why };
  }

  // ---------- heuristic play for early tricks ----------
  function heuristic(v) {
    const legal = v.legalCards.slice().sort((a, b) => a - b);
    const trump = v.contract.strain, team = side(v.seat), declaring = team === v.contract.side;
    const seen = seenCards(v);
    const low = cs => cs.slice().sort((a, b) => rank(a) - rank(b) || (suit(a) === trump) - (suit(b) === trump) || a - b)[0];
    const high = cs => cs.slice().sort((a, b) => rank(b) - rank(a))[0];
    const pos = v.trick.length;
    if (pos > 0) {
      const led = suit(v.trick[0].card), wSeat = currentWinner(v.trick, trump), ours = side(wSeat) === team;
      const wins = legal.filter(c => winner([...v.trick, { seat: v.seat, card: c }], trump) === v.seat);
      const following = suit(legal[0]) === led;
      const lhoSeat = (v.seat + 1) % 4;
      const lhoKnown = v.knownHands[lhoSeat];
      if (pos === 3) {
        if (ours) return { card: discardOrLow(v, legal, true), reason: '搭檔已贏，跟小牌保留實力' };
        if (wins.length) return { card: low(wins), reason: suit(low(wins)) === trump && led !== trump ? '缺門，用最小的王牌將吃' : '第四家用最省的牌贏墩' };
        return { card: discardOrLow(v, legal, false), reason: '贏不了，墊最沒用的牌' };
      }
      if (pos === 1) {
        const ledCard = v.trick[0].card;
        // cover an honour with an honour (not when dummy leads from a sequence we cannot judge)
        if (following && rank(ledCard) >= 11 && rank(ledCard) <= 13) {
          const cover = wins.filter(c => suit(c) === led).sort((a, b) => a - b)[0];
          if (cover && rank(cover) >= 12) return { card: cover, reason: '大牌蓋大牌' };
        }
        if (wins.length && wins.some(c => isMaster(c, v, seen)) && !following) return { card: low(wins), reason: '缺門將吃' };
        if (!following && wins.length && trump < 4) return { card: low(wins), reason: '缺門將吃' };
        return { card: discardOrLow(v, legal, false), reason: '第二家出小牌' };
      }
      // third hand
      if (ours) {
        const pdCard = v.trick.find(p => p.seat === partner(v.seat));
        const safe = lhoKnown ? !lhoKnown.some(c => suit(c) === suit(pdCard.card) && rank(c) > rank(pdCard.card)) && !(lhoKnown.every(c => suit(c) !== led) && trump < 4 && lhoKnown.some(c => suit(c) === trump)) : isMaster(pdCard.card, v, seen);
        if (safe || !wins.length) return { card: signalCard(v, legal), reason: '搭檔的牌已控制此墩，給態度信號' };
      }
      if (wins.length) {
        // third hand high: lowest of the top touching cards, or just enough to beat a visible fourth hand
        let card;
        if (lhoKnown) {
          const lhoTop = lhoKnown.filter(c => suit(c) === led).map(rank).sort((a, b) => b - a)[0] || 0;
          const enough = wins.filter(c => suit(c) !== led || rank(c) > lhoTop);
          card = enough.length ? low(enough) : low(wins);
        } else {
          const mySuit = bySuit(legal, led);
          if (mySuit.length && wins.includes(mySuit[0])) {
            let i = 0;
            while (i + 1 < mySuit.length && rank(mySuit[i]) - rank(mySuit[i + 1]) === 1 && wins.includes(mySuit[i + 1])) i++;
            card = mySuit[i];
          } else card = low(wins);
        }
        return { card, reason: '第三家出大，爭取此墩' };
      }
      return { card: discardOrLow(v, legal, false), reason: '贏不了，出小牌' };
    }
    // leading
    const hand = v.hand;
    const pdSeat = partner(v.seat);
    const pdHand = v.knownHands[pdSeat] || [];
    const masters = legal.filter(c => isMaster(c, v, seen));
    const oppTrumpsOut = trump < 4 ? 13 - [...seen].filter(c => suit(c) === trump).length - (pdHand.length ? 0 : 0) : 0;
    if (declaring) {
      const ourTrumps = trump < 4 ? bySuit(hand, trump).length + bySuit(pdHand, trump).length : 0;
      const theirTrumps = trump < 4 ? 13 - ourTrumps - v.played.filter(p => suit(p.card) === trump).length : 0;
      if (trump < 4 && theirTrumps > 0 && ourTrumps > theirTrumps) {
        const tm = masters.filter(c => suit(c) === trump);
        if (tm.length) return { card: high(tm), reason: '主打清王牌' };
        const tr = bySuit(legal, trump);
        if (tr.length && ourTrumps >= theirTrumps + 2) return { card: tr[tr.length - 1], reason: '主打先清王牌' };
      }
      // cash masters from the short side first
      const sideMasters = masters.filter(c => suit(c) !== trump || theirTrumps === 0).sort((a, b) => bySuit(hand, suit(a)).length - bySuit(hand, suit(b)).length);
      if (sideMasters.length) return { card: sideMasters[0], reason: '兌現大牌（短邊先出）' };
      // lead toward honours in partner's (dummy/declarer) hand
      for (let s = 0; s < 4; s++) {
        const mine = bySuit(legal, s), theirs = bySuit(pdHand, s);
        if (mine.length && theirs.length && rank(theirs[0]) >= 12 && rank(mine[0]) < rank(theirs[0])) return { card: mine[mine.length - 1], reason: '向對面大牌出小，準備飛牌' };
      }
      const longS = [0, 1, 2, 3].filter(s => bySuit(legal, s).length).sort((a, b) => (bySuit(hand, b).length + bySuit(pdHand, b).length) - (bySuit(hand, a).length + bySuit(pdHand, a).length))[0];
      const cs = bySuit(legal, longS);
      return { card: cs[cs.length - 1], reason: '建立長門' };
    }
    // defence
    const pdLead = v.history.find(h => h.cards[0].seat === pdSeat);
    if (pdLead) {
      const ps = suit(pdLead.cards[0].card), cs = bySuit(legal, ps);
      if (cs.length && !(trump < 4 && ps !== trump && oppTrumpsOut > 0 && false)) return { card: cs.length === 2 ? cs[0] : isMaster(cs[0], v, seen) ? cs[0] : cs[cs.length - 1], reason: '回攻搭檔首攻的花色' };
    }
    if (masters.length) { const m = masters.find(c => suit(c) !== trump) || masters[0]; return { card: m, reason: '兌現確定贏張' }; }
    // through strength, up to weakness
    const dummySeat = v.contract.dummy, dummy = v.knownHands[dummySeat] || [];
    const dummyIsLHO = dummySeat === (v.seat + 1) % 4;
    let bestS = -1, bestScore = -Infinity;
    for (let s = 0; s < 4; s++) {
      const cs = bySuit(legal, s); if (!cs.length) continue;
      const dh = bySuit(dummy, s).filter(c => rank(c) >= 11).length;
      let sc = dummyIsLHO ? -dh : dh;
      if (s === trump) sc -= 2;
      if (rank(cs[0]) === 14 && bySuit(hand, s).length > 1) sc -= 1.5;
      if (sc > bestScore) { bestScore = sc; bestS = s; }
    }
    const cs = bySuit(legal, bestS);
    const seq = cs.length >= 2 && rank(cs[0]) - rank(cs[1]) === 1 && rank(cs[0]) >= 10;
    return { card: seq ? cs[0] : cs[cs.length - 1], reason: dummyIsLHO ? '穿過夢家的強門' : '朝夢家的弱門出牌' };
  }
  function signalCard(v, legal) {
    const led = suit(v.trick[0].card);
    const cs = bySuit(legal, led);
    if (!cs.length) return discardOrLow(v, legal, true);
    const hasHonour = v.hand.some(c => suit(c) === led && rank(c) >= 12);
    const spots = cs.filter(c => rank(c) <= 9);
    if (hasHonour && spots.length) return spots[0];           // high spot encourages
    return cs[cs.length - 1];
  }
  function discardOrLow(v, legal, partnerWinning) {
    const trump = v.contract.strain;
    const led = v.trick.length ? suit(v.trick[0].card) : -1;
    const following = legal.some(c => suit(c) === led);
    if (following) { const cs = bySuit(legal, led); return partnerWinning && v.trick.length ? signalPick(v, cs) : cs[cs.length - 1]; }
    // discard: lowest card from the suit with least value, keep trumps and guarded honours
    const seen = seenCards(v);
    const scored = legal.map(c => {
      const s = suit(c), n = bySuit(v.hand, s).length;
      let val = rank(c) + (s === trump ? 30 : 0) + (isMaster(c, v, seen) ? 20 : 0);
      if (bySuit(v.hand, s).some(x => rank(x) >= 12) && n <= 3) val += 8;    // keep guards
      val -= n * 0.5;
      return { c, val };
    }).sort((a, b) => a.val - b.val);
    return scored[0].c;
  }
  function signalPick(v, cs) { const hasHon = cs.some(c => rank(c) >= 12); const spots = cs.filter(c => rank(c) <= 9); return hasHon && spots.length ? spots[0] : cs[cs.length - 1]; }

  // ---------- sampling hidden hands ----------
  function buildSampler(v) {
    const seat = v.seat;
    const known = {};
    for (const [k, h] of Object.entries(v.knownHands)) known[Number(k)] = h.slice();
    const hidden = [0, 1, 2, 3].filter(s => !(s in known));
    const playedBy = [[], [], [], []];
    v.played.forEach(p => playedBy[p.seat].push(p.card));
    const counts = hidden.map(s => 13 - playedBy[s].length);
    const seen = seenCards(v);
    const pool = [];
    for (let c = 0; c < 52; c++) if (!seen.has(c)) pool.push(c);
    let info = null;
    try { info = BB.inferHands(v); } catch (e) { info = null; }
    const cons = hidden.map(s => {
      const playedHcp = playedBy[s].reduce((a, c) => a + hcpOf(c), 0);
      const pl = [0, 1, 2, 3].map(t => playedBy[s].filter(c => suit(c) === t).length);
      const inf = info ? info[s] : null;
      return {
        seat: s,
        void: v.voids[s].slice(),
        hcp: inf ? [inf.hcp[0] - playedHcp, inf.hcp[1] - playedHcp] : [-99, 99],
        len: inf ? inf.len.map((r, t) => [r[0] - pl[t], r[1] - pl[t]]) : [[-99, 99], [-99, 99], [-99, 99], [-99, 99]]
      };
    });
    return { hidden, counts, pool, known, cons, seat };
  }
  function sample(S, random, strict) {
    const { hidden, counts, pool, cons } = S;
    for (let attempt = 0; attempt < (strict ? 60 : 6); attempt++) {
      const p = pool.slice();
      for (let i = p.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
      const hands = hidden.map(() => []), cap = counts.slice();
      let ok = true;
      // place cards of suits someone is void in first
      p.sort((a, b) => (cons.filter(c => c.void[suit(b)]).length) - (cons.filter(c => c.void[suit(a)]).length));
      for (const c of p) {
        const s = suit(c);
        const elig = []; for (let i = 0; i < hidden.length; i++) if (cap[i] > 0 && !cons[i].void[s]) elig.push(i);
        if (!elig.length) { ok = false; break; }
        // weight by remaining capacity to keep the deal uniform
        let tot = 0; for (const i of elig) tot += cap[i];
        let r = random() * tot, pick = elig[0];
        for (const i of elig) { r -= cap[i]; if (r <= 0) { pick = i; break; } }
        hands[pick].push(c); cap[pick]--;
      }
      if (!ok) continue;
      if (strict) {
        let good = true;
        for (let i = 0; i < hidden.length && good; i++) {
          const h = hands[i], k = cons[i];
          const hcp = h.reduce((a, c) => a + hcpOf(c), 0);
          if (hcp < k.hcp[0] || hcp > k.hcp[1]) good = false;
          for (let t = 0; t < 4 && good; t++) { const n = h.filter(c => suit(c) === t).length; if (n < k.len[t][0] || n > k.len[t][1]) good = false; }
        }
        if (!good) continue;
      }
      const full = [[], [], [], []];
      for (const [k, h] of Object.entries(S.known)) full[Number(k)] = h.slice();
      hidden.forEach((s, i) => { full[s] = hands[i]; });
      return full;
    }
    return null;
  }

  // ---------- Monte Carlo double dummy ----------
  function monteCarlo(v, mode, random) {
    const S = buildSampler(v);
    const trump = v.contract.strain, team = side(v.seat);
    const target = team === v.contract.side ? v.contract.level + 6 : 8 - v.contract.level;
    const already = v.tricks[team];
    const start = now();
    const totals = new Map();
    let samples = 0, strictMisses = 0;
    const solver = DDS.solver;
    solver.clear(); // decisions must not depend on earlier searches (node limits would otherwise vary)
    while (samples < mode.maxSamples && (samples < 3 || now() - start < mode.budget)) {
      let deal = sample(S, random, strictMisses < 40);
      if (!deal) { strictMisses += 10; deal = sample(S, random, false); }
      if (!deal) break;
      let res;
      try { res = solver.analyze(deal, trump, v.trick, v.seat, { nodeLimit: mode.nodeLimit }); }
      catch (e) { if (e instanceof DDS.SearchAbort) { if (samples === 0) return null; break; } throw e; }
      for (const r of res) {
        const tricks = already + r.tricks;
        const u = r.tricks + (tricks >= target ? 1.5 : 0);
        for (const c of r.equivalents) {
          const cur = totals.get(c) || { u: 0, t: 0, make: 0 };
          cur.u += u; cur.t += r.tricks; cur.make += tricks >= target ? 1 : 0;
          totals.set(c, cur);
        }
      }
      samples++;
    }
    if (!samples) return null;
    return { totals, samples, target, already };
  }

  function chooseCard(v, profile, opts = {}) {
    if (v.phase !== 'play' || !v.legalCards.length) return null;
    const mode = typeof opts.mode === 'object' ? opts.mode : MODES[opts.mode || 'quick'] || MODES.quick;
    const legal = v.legalCards;
    if (legal.length === 1) return { card: legal[0], reason: '唯一合法的牌' };
    if (!v.played.length) return openingLead(v);
    const h = heuristic(v);
    const tricksLeft = v.hand.length;
    if (!DDS || tricksLeft > mode.ddTricks || !mode.maxSamples) return h;
    const random = B.rng(hashView(v) ^ (opts.seed || 0));
    const mc = monteCarlo(v, mode, random);
    if (!mc) return h;
    let bestU = -Infinity;
    for (const c of legal) { const t = mc.totals.get(c); if (t && t.u > bestU) bestU = t.u; }
    const eps = 1e-9;
    const top = legal.filter(c => mc.totals.get(c) && mc.totals.get(c).u >= bestU - eps);
    // among equally good cards prefer the conventional/heuristic choice, else the cheapest
    let card;
    if (top.includes(h.card)) card = h.card;
    else {
      const led = v.trick.length ? suit(v.trick[0].card) : -1;
      const winsNow = c => v.trick.length && winner([...v.trick, { seat: v.seat, card: c }], v.contract.strain) === v.seat;
      card = top.slice().sort((a, b) => (winsNow(b) - winsNow(a)) || (v.trick.length ? rank(a) - rank(b) : rank(b) - rank(a)) || (suit(a) === led) - (suit(b) === led))[0];
      if (v.trick.length && top.some(winsNow)) card = top.filter(winsNow).sort((a, b) => rank(a) - rank(b))[0];
      else if (v.trick.length) card = top.slice().sort((a, b) => rank(a) - rank(b))[0];
    }
    const t = mc.totals.get(card);
    const avg = (mc.already + t.t / mc.samples).toFixed(1);
    const pct = Math.round(100 * t.make / mc.samples);
    const goal = side(v.seat) === v.contract.side ? '做成合約' : '擊垮合約';
    return { card, reason: `${mc.samples} 次依叫牌抽樣的雙明手推演：預期 ${avg} 墩，${goal}機率 ${pct}%`, samples: mc.samples, expected: Number(avg), success: pct / 100 };
  }

  return { chooseCard, openingLead, heuristic, MODES, buildSampler, sample };
});
