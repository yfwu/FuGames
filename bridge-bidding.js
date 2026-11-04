/* FuGames bridge bidding: a 2/1 game-forcing natural system (Standard American base).
 * Every call the AI can make is a rule {call, cond(hand), meaning, text}. The same rule tables are replayed
 * over the public auction to infer each seat's HCP range and suit lengths, so AI partners understand the
 * human's calls, AI defenders read the opponents' auction, and the UI can explain every call.
 * Conventions: 15–17 1NT, 20–21 2NT, strong 2♣, five-card majors, weak twos, Stayman, Jacoby transfers,
 * minor-suit transfer (2♠), Jacoby 2NT, splinters, limit raises, 1NT forcing, 2/1 GF, reverses, jump shifts,
 * takeout / negative / penalty doubles, Michaels, Unusual 2NT, weak jump overcalls, cue-bid raises, Jordan 2NT,
 * RKCB 1430, quantitative 4NT, law-of-total-tricks competition and favourable-vulnerability sacrifices.
 */
'use strict';
(function (root, factory) {
  const api = factory(root.Bridge || (typeof require === 'function' ? require('./bridge-engine.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BridgeBidding = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (B) {
  const { suit, rank, side, isBid, parseBid, bidCall, bidIndex } = B;
  const SN = ['♣', '♦', '♥', '♠', 'NT'];
  const isMajor = s => s === 2 || s === 3;
  const last = a => a.length ? a[a.length - 1] : null;
  const ALL = 37;

  // ---------- hand evaluation ----------
  function evaluate(hand) {
    const len = [0, 0, 0, 0], hcpS = [0, 0, 0, 0], top3 = [0, 0, 0, 0], top5 = [0, 0, 0, 0], has = [[], [], [], []];
    for (const c of hand) { const s = suit(c), r = rank(c); len[s]++; hcpS[s] += Math.max(0, r - 10); if (r >= 12) top3[s]++; if (r >= 10) top5[s]++; has[s].push(r); }
    const hcp = hcpS.reduce((a, b) => a + b, 0);
    const pattern = len.slice().sort((a, b) => b - a);
    const pat = pattern.join('');
    const bal = ['4333', '4432', '5332'].includes(pat);
    const semi = bal || ['5422', '6322'].includes(pat);
    const stop = has.map((rs, s) => rs.includes(14) || (rs.includes(13) && len[s] >= 2) || (rs.includes(12) && len[s] >= 3) || (rs.includes(11) && len[s] >= 4));
    const tp = hcp + len.reduce((a, l) => a + Math.max(0, l - 4), 0);
    const aces = has.reduce((a, rs) => a + (rs.includes(14) ? 1 : 0), 0);
    // losing-trick count
    let ltc = 0;
    for (let s = 0; s < 4; s++) {
      const rs = has[s].slice().sort((a, b) => b - a).slice(0, 3);
      const n = Math.min(3, len[s]);
      let l = n;
      for (let i = 0; i < n; i++) if (rs.includes(14 - i) && (14 - i) >= 12) l--;
      if (n >= 1 && rs.includes(14)) {} // counted above
      ltc += Math.max(0, l);
    }
    const two = pattern[0] + pattern[1];
    const longest = [3, 2, 1, 0].reduce((b, s) => len[s] > len[b] ? s : b, 3);
    return { hand, len, hcp, hcpS, top3, top5, has, pattern, pat, bal, semi, stop, tp, aces, ltc, two, longest, short: len.map(l => l <= 1) };
  }
  function supportPts(h, s) {
    const n = h.len[s];
    let extra = 0;
    for (let x = 0; x < 4; x++) if (x !== s) { const l = h.len[x]; extra += n >= 4 ? (l === 0 ? 5 : l === 1 ? 3 : l === 2 ? 1 : 0) : n === 3 ? (l === 0 ? 3 : l === 1 ? 2 : l === 2 ? 1 : 0) : 0; }
    return h.hcp + extra;
  }
  const keycards = (h, t) => h.aces + (h.has[t].includes(13) ? 1 : 0);
  const trumpQ = (h, t) => h.has[t].includes(12);
  const goodSuit = (h, s) => h.top5[s] >= 3 || (h.top3[s] >= 2) || (h.len[s] >= 6 && h.top3[s] >= 1);
  const okSuit = (h, s) => h.top5[s] >= 2 || h.len[s] >= 6;

  // ---------- meanings ----------
  function M(lo, hi, lens, bal) {
    const len = [[0, 13], [0, 13], [0, 13], [0, 13]];
    if (lens) for (const k of Object.keys(lens)) len[k] = lens[k].slice();
    return { hcp: [lo, hi], len, bal: !!bal };
  }
  const NONE = () => M(0, ALL);
  function rule(call, cond, m, text, o = {}) {
    const inv = call !== 'P' && /邀請/.test(text) && !/接受|拒絕|量化|滿貫/.test(text);
    return { call, cond, m: m || NONE(), text, tag: o.tag || '', force: o.force || 0, state: o.state || '', trump: o.trump, kc: o.kc, inv };
  }
  function freshInfo() { return { hcp: [0, ALL], len: [[0, 13], [0, 13], [0, 13], [0, 13]], bal: false }; }
  function intersect(info, m) {
    const out = { hcp: info.hcp.slice(), len: info.len.map(x => x.slice()), bal: info.bal || m.bal };
    const lo = Math.max(info.hcp[0], m.hcp[0]), hi = Math.min(info.hcp[1], m.hcp[1]);
    out.hcp = lo <= hi ? [lo, hi] : m.hcp.slice();
    for (let s = 0; s < 4; s++) {
      let a = Math.max(info.len[s][0], m.len[s][0]), b = Math.min(info.len[s][1], m.len[s][1]);
      if (a > b) { a = m.len[s][0]; b = m.len[s][1]; }
      out.len[s] = [a, b];
    }
    if (m.bal) for (let s = 0; s < 4; s++) { out.len[s][0] = Math.max(out.len[s][0], 2); out.len[s][1] = Math.min(out.len[s][1], 5); if (out.len[s][0] > out.len[s][1]) out.len[s] = [2, 5]; }
    // lengths must leave room: sum of minimums <= 13
    let sumMin = out.len.reduce((a, x) => a + x[0], 0);
    if (sumMin > 13) out.len = out.len.map(x => [Math.min(x[0], 4), x[1]]);
    sumMin = out.len.reduce((a, x) => a + x[0], 0);
    if (sumMin > 13) out.len = out.len.map(x => [0, x[1]]);
    return out;
  }

  // ---------- auction context ----------
  function legalFrom(entries, seat) {
    let lastBid = null, mult = 1;
    for (const e of entries) { if (isBid(e.call)) { lastBid = { ...parseBid(e.call), seat: e.seat }; mult = 1; } else if (e.call === 'X') mult = 2; else if (e.call === 'XX') mult = 4; }
    const calls = ['P'], floor = lastBid ? bidIndex(bidCall(lastBid.level, lastBid.strain)) : -1;
    for (let i = floor + 1; i < 35; i++) calls.push(bidCall(Math.floor(i / 5) + 1, i % 5));
    if (lastBid) {
      if (mult === 1 && side(seat) !== side(lastBid.seat)) calls.push('X');
      if (mult === 2 && side(seat) === side(lastBid.seat)) calls.push('XX');
    }
    return { calls, lastBid, mult };
  }
  function makeCtx(base, entries, info, seat) {
    const ctx = { seat, pd: (seat + 2) % 4, lho: (seat + 1) % 4, rho: (seat + 3) % 4, dealer: base.dealer, entries, info };
    ctx.vulWe = B.vulnerable(base.vulnerability, side(seat)); ctx.vulThey = B.vulnerable(base.vulnerability, 1 - side(seat));
    ctx.mine = entries.filter(e => e.seat === seat);
    ctx.pdE = entries.filter(e => e.seat === ctx.pd);
    ctx.myLast = last(ctx.mine); ctx.pdLast = last(ctx.pdE);
    ctx.rhoLast = last(entries.filter(e => e.seat === ctx.rho));
    const lf = legalFrom(entries, seat);
    ctx.legal = lf.calls; ctx.lastBid = lf.lastBid; ctx.mult = lf.mult;
    ctx.bids = entries.filter(e => isBid(e.call));
    ctx.opening = ctx.bids[0] || null;
    ctx.weOpened = !!ctx.opening && side(ctx.opening.seat) === side(seat);
    ctx.iOpened = !!ctx.opening && ctx.opening.seat === seat;
    ctx.myActions = ctx.mine.filter(e => e.call !== 'P');
    ctx.pdActions = ctx.pdE.filter(e => e.call !== 'P');
    ctx.passedHand = ctx.mine.length > 0 && ctx.mine[0].call === 'P' && (!ctx.opening || ctx.opening.index > ctx.mine[0].index);
    ctx.gf = entries.some(e => side(e.seat) === side(seat) && e.force === 'GF');
    ctx.forced = !!(ctx.pdLast && ctx.pdLast.force && ctx.pdLast.call !== 'P' && ctx.rhoLast && ctx.rhoLast.index > ctx.pdLast.index && (ctx.rhoLast.call === 'P' || ctx.pdLast.force === 'GF'));
    ctx.ourBids = ctx.bids.filter(e => side(e.seat) === side(seat));
    ctx.theirBids = ctx.bids.filter(e => side(e.seat) !== side(seat));
    ctx.theirStrains = [...new Set(ctx.theirBids.map(e => parseBid(e.call).strain).filter(s => s < 4))];
    ctx.ourLast = last(ctx.ourBids);
    ctx.usedRKCB = entries.some(e => side(e.seat) === side(seat) && /^rkcb/.test(e.tag));
    ctx.can = call => ctx.legal.includes(call);
    ctx.cheapest = strain => { for (let l = 1; l <= 7; l++) { const c = bidCall(l, strain); if (ctx.legal.includes(c)) return c; } return null; };
    ctx.cheapLevel = strain => { const c = ctx.cheapest(strain); return c ? Number(c[0]) : 8; };
    return ctx;
  }
  function pdMinLen(ctx, s) { return ctx.info[ctx.pd].len[s][0]; }
  function pdRange(ctx) { return ctx.info[ctx.pd].hcp; }
  function pdEstimate(ctx) {
    const [lo, hi] = pdRange(ctx);
    const top = Math.min(hi, lo + 12);
    return lo + (top - lo) * 0.3;
  }

  // ---------- openings ----------
  function openingRules(ctx, profile) {
    const R = [], seatPos = ctx.entries.length, fourth = seatPos === 3, third = seatPos === 2;
    R.push(rule('2C', h => h.hcp >= 22 || (h.hcp >= 19 && h.ltc <= 3), M(19, ALL), '強開叫 2♣：22+ 點，或一墩內可成局；迫叫', { tag: 'open2c', force: 1, state: 'opening' }));
    R.push(rule('2N', h => h.bal && h.hcp >= 20 && h.hcp <= 21, M(20, 21, null, true), '2NT 開叫：20–21 點均型', { tag: 'open2nt', state: 'opening' }));
    R.push(rule('1N', h => h.bal && h.hcp >= 15 && h.hcp <= 17, M(15, 17, null, true), '1NT 開叫：15–17 點均型（可含五張高花）', { tag: 'open1nt', state: 'opening' }));
    if (!fourth) {
      const r = profile.risk;
      for (const s of [3, 2]) R.push(rule(bidCall(4, s), h => h.len[s] >= 8 && h.hcp >= 5 && h.hcp <= 11, M(5, 11, { [s]: [8, 13] }), `4${SN[s]} 阻擊開叫：8 張以上${SN[s]}，弱牌`, { tag: 'pre4', state: 'opening' }));
      for (const s of [3, 2, 1, 0]) R.push(rule(bidCall(3, s), h => h.len[s] >= 7 && h.hcp >= 5 - r && h.hcp <= 10 && okSuit(h, s), M(4, 10, { [s]: [7, 13] }), `3${SN[s]} 阻擊開叫：7 張${SN[s]}，5–10 點`, { tag: 'pre3', state: 'opening' }));
      for (const s of [3, 2, 1]) R.push(rule(bidCall(2, s), h => h.len[s] === 6 && h.hcp >= 5 && h.hcp <= 10 && okSuit(h, s) && h.top3[s] >= 1 && [2, 3].filter(x => x !== s).every(x => h.len[x] <= 3), M(5, 10, { [s]: [6, 6] }), `弱二 2${SN[s]}：6 張好${SN[s]}，5–10 點`, { tag: 'weak2', state: 'opening' }));
    }
    const openable = h => fourth ? (h.hcp >= 10 && h.hcp + h.len[3] >= 15) : (h.hcp >= 12 || (h.hcp >= 10 && h.hcp + h.two >= 20) || (third && h.hcp >= 10 && h.len.some((l, s) => l >= 5 && goodSuit(h, s))));
    R.push(rule('1S', h => openable(h) && h.len[3] >= 5 && h.len[3] >= h.len[2], M(10, 21, { 3: [5, 13] }), '1♠ 開叫：五張以上黑桃，12–21 點', { tag: 'open1M', state: 'opening' }));
    R.push(rule('1H', h => openable(h) && h.len[2] >= 5, M(10, 21, { 2: [5, 13] }), '1♥ 開叫：五張以上紅心，12–21 點', { tag: 'open1M', state: 'opening' }));
    R.push(rule('1D', h => openable(h) && (h.len[1] > h.len[0] || (h.len[1] === h.len[0] && h.len[1] >= 4)), M(10, 21, { 1: [3, 13], 2: [0, 4], 3: [0, 4] }), '1♦ 開叫：無五張高花，方塊較長（通常 4+）', { tag: 'open1m', state: 'opening' }));
    R.push(rule('1C', h => openable(h), M(10, 21, { 0: [2, 13], 2: [0, 4], 3: [0, 4] }), '1♣ 開叫：無五張高花，梅花較長（可能 3 張）', { tag: 'open1m', state: 'opening' }));
    R.push(rule('P', () => true, M(0, 11), '未達開叫標準', { state: 'opening' }));
    return R;
  }

  // ---------- NT structure (1NT, 2NT, 2♣-2♦-2NT, 1NT overcall) ----------
  function ntResponses(ctx, L, lo, hi, label) {
    const R = [], inv = 25 - hi, game = 25 - lo, st = 'response';
    const stay = bidCall(L + 1, 0), toH = bidCall(L + 1, 1), toS = bidCall(L + 1, 2);
    R.push(rule(stay, h => (h.len[2] === 4 || h.len[3] === 4) && h.hcp >= Math.min(inv, game) && !(h.pat === '4333' && h.hcp < game + 2), M(Math.max(0, Math.min(inv, game)), ALL), `Stayman：詢問${label}方四張高花，${Math.max(0, Math.min(inv, game))}+ 點`, { tag: 'stayman', force: 1, state: 'convention' }));
    R.push(rule(toS, h => h.len[3] >= 5 && h.len[3] >= h.len[2], M(0, ALL, { 3: [5, 13] }), `Jacoby 轉換：五張以上黑桃，請開叫者叫 ${L + 1}♠`, { tag: 'xferS', force: 1, state: 'convention' }));
    R.push(rule(toH, h => h.len[2] >= 5, M(0, ALL, { 2: [5, 13] }), `Jacoby 轉換：五張以上紅心，請開叫者叫 ${L + 1}♥`, { tag: 'xferH', force: 1, state: 'convention' }));
    if (L === 1) R.push(rule('2S', h => (h.len[0] >= 6 || h.len[1] >= 6) && h.hcp <= 7, M(0, 7), '低花轉換：6+ 張低花弱牌，請開叫者叫 3♣', { tag: 'xferm', force: 1, state: 'convention' }));
    R.push(rule('7N', h => h.hcp + lo >= 37, M(37 - lo, ALL), '直接叫大滿貫', { state: 'slam' }));
    R.push(rule('6N', h => h.hcp + lo >= 33, M(33 - lo, 36 - lo), '聯手 33+ 點，直接叫小滿貫', { state: 'slam' }));
    R.push(rule('4N', h => h.hcp + hi >= 33, M(33 - hi, 32 - lo), '量化 4NT：邀請 6NT', { tag: 'quant', state: 'slam' }));
    R.push(rule('3N', h => h.hcp >= game || (L > 1 && h.hcp >= inv), M(Math.max(0, L > 1 ? inv : game), 32 - hi), '足夠成局，打 3NT', { state: st }));
    if (L === 1) R.push(rule('2N', h => h.hcp >= inv, M(inv, game - 1), `邀請 3NT（${inv}–${game - 1} 點）`, { state: st }));
    R.push(rule('P', () => true, M(0, Math.max(0, inv - 1)), '牌力不足，停在現有合約', { state: st }));
    return R;
  }
  function ntOpenerInfo(ctx) {
    // which NT structure is the current seat's partner/own NT in: returns {L, lo, hi}
    const tagOf = e => e && e.tag;
    const myNT = ctx.mine.find(e => ['open1nt', 'open2nt', '2c-2nt', 'ovc-nt'].includes(e.tag));
    const pdNT = ctx.pdE.find(e => ['open1nt', 'open2nt', '2c-2nt', 'ovc-nt'].includes(e.tag));
    const e = myNT || pdNT;
    if (!e) return null;
    const t = tagOf(e);
    return { L: t === 'open1nt' || t === 'ovc-nt' ? 1 : 2, lo: t === 'open1nt' ? 15 : t === 'ovc-nt' ? 15 : t === 'open2nt' ? 20 : 22, hi: t === 'open1nt' ? 17 : t === 'ovc-nt' ? 18 : t === 'open2nt' ? 21 : 24, mine: !!myNT };
  }
  function ntContinuations(ctx) {
    const nt = ntOpenerInfo(ctx);
    if (!nt) return null;
    const p = ctx.pdLast, me = ctx.myLast, R = [];
    const max = h => h.hcp >= nt.hi - (nt.hi - nt.lo >= 2 ? 1 : 0);
    if (nt.mine && p) {
      // I opened NT; partner used a convention
      if (p.tag === 'stayman') {
        R.push(rule(bidCall(nt.L + 1, 2), h => h.len[2] >= 4, M(0, ALL, { 2: [4, 5] }), 'Stayman 回答：有四張紅心', { tag: 'stH', state: 'convention' }));
        R.push(rule(bidCall(nt.L + 1, 3), h => h.len[3] >= 4, M(0, ALL, { 2: [0, 3], 3: [4, 5] }), 'Stayman 回答：有四張黑桃、無四張紅心', { tag: 'stS', state: 'convention' }));
        R.push(rule(bidCall(nt.L + 1, 1), () => true, M(0, ALL, { 2: [0, 3], 3: [0, 3] }), 'Stayman 回答：沒有四張高花', { tag: 'stD', state: 'convention' }));
        return R;
      }
      if (p.tag === 'xferH' || p.tag === 'xferS') {
        const s = p.tag === 'xferH' ? 2 : 3;
        if (nt.L === 1) R.push(rule(bidCall(3, s), h => h.len[s] >= 4 && h.hcp >= nt.hi, M(nt.hi, ALL, { [s]: [4, 5] }), `超接受：四張${SN[s]}支持、高限`, { tag: 'superAccept', state: 'convention' }));
        R.push(rule(bidCall(nt.L + 1, s), () => true, M(0, ALL, { [s]: [2, 5] }), `完成轉換：叫 ${SN[s]}`, { tag: 'xferDone', state: 'convention' }));
        return R;
      }
      if (p.tag === 'xferm') { R.push(rule('3C', () => true, NONE(), '完成低花轉換：叫 3♣', { tag: 'xfermDone', state: 'convention' })); return R; }
      if (p.call === bidCall(nt.L + 1, 4) && !p.tag && ctx.rhoLast.call === 'P') {
        R.push(rule(bidCall(3, 4), h => max(h), NONE(), '高限，接受 3NT 邀請', { state: 'rebid' }));
        R.push(rule('P', () => true, NONE(), '低限，拒絕邀請', { state: 'rebid' }));
        return R;
      }
      if (p.tag === 'quant') {
        R.push(rule('6N', h => max(h), NONE(), '接受量化邀請：高限打 6NT', { state: 'slam' }));
        R.push(rule('P', () => true, NONE(), '低限，拒絕滿貫邀請', { state: 'slam' }));
        return R;
      }
      // second round after Stayman / transfer continuations
      if (me && ['stH', 'stS', 'stD'].includes(me.tag)) {
        if (p.call === bidCall(nt.L + 1, 4) || p.call === '2N') {
          R.push(rule('4S', h => me.tag === 'stH' && h.len[3] >= 4 && max(h), M(0, ALL, { 3: [4, 5] }), '搭檔另有四張黑桃，高限直接成局', { state: 'rebid' }));
          R.push(rule('3S', h => me.tag === 'stH' && h.len[3] >= 4, M(0, ALL, { 3: [4, 5] }), '搭檔另有四張黑桃，低限邀請', { state: 'rebid' }));
          R.push(rule('3N', h => max(h), NONE(), '高限接受邀請', { state: 'rebid' }));
          R.push(rule('P', () => true, NONE(), '低限，停在 2NT', { state: 'rebid' }));
          return R;
        }
        if (p.call === '3N') {
          R.push(rule('4S', h => me.tag === 'stH' && h.len[3] >= 4, M(0, ALL, { 3: [4, 5] }), '搭檔問高花時另有四張黑桃，改打 4♠', { state: 'rebid' }));
          R.push(rule('P', () => true, NONE(), '無高花配合，打 3NT', { state: 'rebid' }));
          return R;
        }
        const s = isBid(p.call) ? parseBid(p.call).strain : -1;
        if ((s === 2 || s === 3) && parseBid(p.call).level === 3) {
          if (me.tag === 'stD') { // 5-card major game force
            R.push(rule(bidCall(4, s), h => h.len[s] >= 3, M(0, ALL, { [s]: [3, 5] }), `有三張${SN[s]}支持，打 4${SN[s]}`, { state: 'rebid' }));
            R.push(rule('3N', () => true, M(0, ALL, { [s]: [2, 2] }), '只有兩張，打 3NT', { state: 'rebid' }));
            return R;
          }
          R.push(rule(bidCall(4, s), h => max(h), NONE(), '高限接受成局邀請', { state: 'rebid' }));
          R.push(rule('P', () => true, NONE(), '低限拒絕邀請', { state: 'rebid' }));
          return R;
        }
      }
      if (me && (me.tag === 'xferDone' || me.tag === 'superAccept')) {
        const s = parseBid(me.call).strain;
        if (p.call === '2N') {
          R.push(rule(bidCall(4, s), h => h.len[s] >= 3 && max(h), NONE(), `三張支持且高限：4${SN[s]}`, { state: 'rebid' }));
          R.push(rule(bidCall(3, s), h => h.len[s] >= 3, NONE(), `三張支持但低限：3${SN[s]}`, { state: 'rebid' }));
          R.push(rule('3N', h => max(h), NONE(), '只有兩張、高限：3NT', { state: 'rebid' }));
          R.push(rule('P', () => true, NONE(), '兩張且低限：停在 2NT', { state: 'rebid' }));
          return R;
        }
        if (p.call === bidCall(3, s) && nt.L === 1) {
          R.push(rule(bidCall(4, s), h => max(h) || h.len[s] >= 3, NONE(), '接受邀請', { state: 'rebid' }));
          R.push(rule('P', () => true, NONE(), '拒絕邀請', { state: 'rebid' }));
          return R;
        }
        if (p.call === '3N') {
          R.push(rule(bidCall(4, s), h => h.len[s] >= 3, M(0, ALL, { [s]: [3, 5] }), `三張以上支持，改打 4${SN[s]}`, { state: 'rebid' }));
          R.push(rule('P', () => true, M(0, ALL, { [s]: [2, 2] }), '兩張支持，打 3NT', { state: 'rebid' }));
          return R;
        }
        if (isBid(p.call) && parseBid(p.call).strain !== s && parseBid(p.call).strain < 4 && parseBid(p.call).level === 3) {
          const t = parseBid(p.call).strain;
          R.push(rule(bidCall(4, s), h => h.len[s] >= 3, NONE(), `支持搭檔的${SN[s]}`, { state: 'rebid' }));
          R.push(rule('3N', () => true, NONE(), '不配合，打 3NT', { state: 'rebid' }));
          void t;
          return R;
        }
      }
      return null;
    }
    if (!nt.mine && me && p) {
      // I am responder; partner answered my convention
      const inv = 25 - nt.hi, game = 25 - nt.lo;
      if (me.tag === 'stayman' && ['stH', 'stS', 'stD'].includes(p.tag)) {
        const shown = p.tag === 'stH' ? 2 : p.tag === 'stS' ? 3 : -1;
        if (shown >= 0) {
          R.push(rule('4N', h => h.len[shown] >= 4 && supportPts(h, shown) + nt.lo >= 33, NONE(), `高花配合且有滿貫實力：RKCB 問關鍵張（王牌${SN[shown]}）`, { tag: 'rkcb', trump: shown, state: 'slam' }));
          R.push(rule(bidCall(4, shown), h => h.len[shown] >= 4 && supportPts(h, shown) >= game, M(game - 2, ALL, { [shown]: [4, 5] }), `${SN[shown]}配合，成局`, { state: 'rebid' }));
          if (nt.L === 1) R.push(rule(bidCall(3, shown), h => h.len[shown] >= 4 && supportPts(h, shown) >= inv, M(inv - 1, game - 1, { [shown]: [4, 5] }), `${SN[shown]}配合，邀請成局`, { state: 'rebid' }));
        } else {
          for (const s of [3, 2]) R.push(rule(bidCall(3, s), h => h.len[s] >= 5 && h.hcp >= game, M(game, ALL, { [s]: [5, 5] }), `五張${SN[s]}，成局迫叫，請選 4${SN[s]} 或 3NT`, { force: 'GF', state: 'rebid' }));
        }
        R.push(rule('4N', h => h.hcp + nt.hi >= 33 && h.hcp + nt.lo < 33, NONE(), '量化 4NT', { tag: 'quant', state: 'slam' }));
        R.push(rule('6N', h => h.hcp + nt.lo >= 33, NONE(), '直接 6NT', { state: 'slam' }));
        R.push(rule('3N', h => h.hcp >= game, M(game, ALL), '無高花配合：3NT', { state: 'rebid' }));
        if (nt.L === 1) R.push(rule('2N', h => h.hcp >= inv, M(inv, game - 1), '無高花配合：邀請 3NT', { state: 'rebid' }));
        R.push(rule('P', () => true, NONE(), '停在現有合約', { state: 'rebid' }));
        return R;
      }
      if ((me.tag === 'xferH' || me.tag === 'xferS') && (p.tag === 'xferDone' || p.tag === 'superAccept')) {
        const s = me.tag === 'xferH' ? 2 : 3, sup = p.tag === 'superAccept';
        R.push(rule('4N', h => (h.len[s] >= 6 || sup) && supportPts(h, s) + nt.lo + (sup ? 2 : 0) >= 33, NONE(), `RKCB 問關鍵張（王牌${SN[s]}）`, { tag: 'rkcb', trump: s, state: 'slam' }));
        R.push(rule(bidCall(4, s), h => sup ? h.hcp >= 4 : h.len[s] >= 6 && supportPts(h, s) >= game, NONE(), `${h_6(s)}，直接成局`, { state: 'rebid' }));
        R.push(rule('4N', h => !sup && h.len[s] === 5 && h.hcp + nt.hi >= 33 && h.hcp + nt.lo < 33, NONE(), '五張高花、量化 4NT', { tag: 'quant', state: 'slam' }));
        for (const t of [0, 1, 2]) if (t !== s) R.push(rule(bidCall(3, t), h => !sup && h.len[s] === 5 && h.len[t] >= 4 && h.hcp >= game && ctx.can(bidCall(3, t)), M(game, ALL, { [s]: [5, 5], [t]: [4, 13] }), `五張${SN[s]}外另有四張以上${SN[t]}，成局迫叫`, { force: 'GF', state: 'rebid' }));
        R.push(rule('3N', h => !sup && h.len[s] === 5 && h.hcp >= game, M(game, ALL, { [s]: [5, 5] }), `五張${SN[s]}、成局實力：請搭檔選 4${SN[s]} 或 3NT`, { state: 'rebid' }));
        if (nt.L === 1) {
          R.push(rule(bidCall(3, s), h => !sup && h.len[s] >= 6 && h.hcp >= inv, M(inv, game - 1, { [s]: [6, 13] }), `六張${SN[s]}，邀請成局`, { state: 'rebid' }));
          R.push(rule('2N', h => !sup && h.len[s] === 5 && h.hcp >= inv, M(inv, game - 1, { [s]: [5, 5] }), `五張${SN[s]}，邀請成局`, { state: 'rebid' }));
        }
        R.push(rule('P', () => true, M(0, inv - 1), '弱牌，停在轉換後的合約', { state: 'rebid' }));
        return R;
      }
      if (me.tag === 'xferm' && p.tag === 'xfermDone') {
        R.push(rule('3D', h => h.len[1] >= 6 && h.len[1] > h.len[0], M(0, 7, { 1: [6, 13] }), '長方塊：改打 3♦', { state: 'rebid' }));
        R.push(rule('P', () => true, M(0, 7, { 0: [6, 13] }), '長梅花：停在 3♣', { state: 'rebid' }));
        return R;
      }
    }
    return null;
  }
  function h_6(s) { return `${SN[s]}長門配合`; }

  // ---------- responses to suit openings ----------
  function majorResponses(ctx) {
    const R = [], Ms = parseBid(ctx.opening.call).strain, notPH = !ctx.passedHand, st = 'response';
    const other = Ms === 2 ? 3 : 2;
    R.push(rule(bidCall(4, Ms), h => h.len[Ms] >= 5 && h.hcp <= 9 && h.short.some((x, s) => x && s !== Ms), M(0, 9, { [Ms]: [5, 13] }), `阻擊加叫 4${SN[Ms]}：五張以上支持、牌型好、弱牌`, { tag: 'raisePre', state: st }));
    if (notPH) {
      const spl = Ms === 2 ? [[3, '3S'], [0, '4C'], [1, '4D']] : [[0, '4C'], [1, '4D'], [2, '4H']];
      for (const [x, call] of spl) R.push(rule(call, h => h.len[Ms] >= 4 && h.hcp >= 11 && h.hcp <= 15 && h.len[x] <= 1, M(11, 15, { [Ms]: [4, 13], [x]: [0, 1] }), `Splinter：四張以上${SN[Ms]}支持，${SN[x]}單張或缺門，成局迫叫`, { tag: 'splinter', force: 'GF', state: 'convention' }));
      R.push(rule('2N', h => h.len[Ms] >= 4 && h.hcp >= 13, M(13, ALL, { [Ms]: [4, 13] }), `Jacoby 2NT：四張以上${SN[Ms]}支持、成局迫叫`, { tag: 'jacoby', force: 'GF', state: 'convention' }));
    }
    R.push(rule(bidCall(3, Ms), h => h.len[Ms] >= 3 && supportPts(h, Ms) >= 10 && h.hcp <= 12 && (h.len[Ms] >= 4 || h.hcp >= 10), M(9, 12, { [Ms]: [3, 13] }), `限制性加叫：${SN[Ms]}支持、10–12 支持點，邀請成局`, { tag: 'raiseLimit', state: st }));
    R.push(rule(bidCall(2, Ms), h => h.len[Ms] >= 3 && supportPts(h, Ms) >= 6 && h.hcp <= 10, M(5, 10, { [Ms]: [3, 13] }), `單加叫：${SN[Ms]}三張以上支持、6–10 點`, { tag: 'raise', state: st }));
    if (Ms === 2) R.push(rule('1S', h => h.len[3] >= 4 && h.hcp >= 6, M(6, ALL, { 3: [4, 13] }), '新花一階：四張以上黑桃，迫叫一輪', { tag: 'new1', force: 1, state: st }));
    if (notPH) {
      const cands = Ms === 2 ? [0, 1] : [0, 1, 2];
      const pick = h => { let best = -1; for (const s of cands) { const need = s === 2 ? 5 : 4; if (h.len[s] < need) continue; if (best < 0 || h.len[s] > h.len[best] || (h.len[s] === h.len[best] && h.len[s] >= 5 && s > best)) best = s; } return best; };
      for (const s of cands) R.push(rule(bidCall(2, s), h => h.hcp >= 13 && pick(h) === s, M(12, ALL, { [s]: [s === 2 ? 5 : 4, 13] }), `2/1 成局迫叫：${SN[s]}${s === 2 ? '五' : '四'}張以上、13+ 點`, { tag: 'twoOverOne', force: 'GF', state: st }));
      R.push(rule('2C', h => h.hcp >= 13, M(12, ALL, { 0: [3, 13] }), '2/1 成局迫叫：13+ 點（梅花可能只有三張）', { tag: 'twoOverOne', force: 'GF', state: st }));
      R.push(rule('1N', h => h.hcp >= 6, M(6, 12, { [Ms]: [0, 3] }), '1NT 迫叫：6–12 點，無適合叫品', { tag: 'ntForcing', force: 1, state: st }));
    } else {
      for (const s of (Ms === 2 ? [0, 1] : [0, 1, 2])) R.push(rule(bidCall(2, s), h => h.len[s] >= 6 && h.hcp >= 9, M(9, 11, { [s]: [6, 13] }), `已 Pass 的手：六張${SN[s]}，非迫叫`, { tag: 'phNew2', state: st }));
      R.push(rule('1N', h => h.hcp >= 6, M(6, 11, { [Ms]: [0, 2] }), '已 Pass：1NT 6–11 點，非迫叫', { tag: 'ntPH', state: st }));
    }
    void other;
    R.push(rule('P', () => true, M(0, 5), '回應點力不足（0–5）', { state: st }));
    return R;
  }
  function minorResponses(ctx) {
    const R = [], m = parseBid(ctx.opening.call).strain, st = 'response', notPH = !ctx.passedHand;
    const noMaj = h => h.len[2] < 4 && h.len[3] < 4;
    const supNeed = m === 0 ? 5 : 4;
    if (m === 0) R.push(rule('1D', h => h.hcp >= 11 && h.len[1] >= 5 && h.len[1] > h.len[2] && h.len[1] > h.len[3], M(11, ALL, { 1: [5, 13] }), '新花一階：長方塊、有實力，迫叫', { tag: 'new1', force: 1, state: st }));
    R.push(rule('1H', h => h.hcp >= 6 && h.len[2] >= 4 && (h.len[2] > h.len[3] || (h.len[2] === 4 && h.len[3] === 4)), M(6, ALL, { 2: [4, 13] }), '新花一階：四張以上紅心，迫叫一輪', { tag: 'new1', force: 1, state: st }));
    R.push(rule('1S', h => h.hcp >= 6 && h.len[3] >= 4, M(6, ALL, { 3: [4, 13] }), '新花一階：四張以上黑桃，迫叫一輪', { tag: 'new1', force: 1, state: st }));
    if (m === 0) R.push(rule('1D', h => h.hcp >= 6 && h.len[1] >= 4 && noMaj(h) && !(h.bal && h.hcp <= 10 && h.len[1] === 4), M(6, ALL, { 1: [4, 13], 2: [0, 3], 3: [0, 3] }), '新花一階：四張以上方塊，迫叫一輪', { tag: 'new1', force: 1, state: st }));
    if (m === 1 && notPH) R.push(rule('2C', h => h.hcp >= 13 && h.len[0] >= 4 && noMaj(h), M(12, ALL, { 0: [4, 13], 2: [0, 3], 3: [0, 3] }), '2/1 成局迫叫：四張以上梅花、13+ 點', { tag: 'twoOverOne', force: 'GF', state: st }));
    R.push(rule('3N', h => h.hcp >= 13 && h.hcp <= 15 && h.bal && noMaj(h), M(13, 15, { 2: [0, 3], 3: [0, 3] }, true), '13–15 點均型，無四張高花', { tag: 'nt3m', state: st }));
    R.push(rule('2N', h => h.hcp >= 11 && h.hcp <= 12 && h.bal && noMaj(h), M(11, 12, { 2: [0, 3], 3: [0, 3] }, true), '11–12 點均型，邀請 3NT', { tag: 'nt2m', state: st }));
    R.push(rule(bidCall(3, m), h => h.hcp >= 10 && h.hcp <= 12 && h.len[m] >= supNeed && noMaj(h), M(10, 12, { [m]: [supNeed, 13], 2: [0, 3], 3: [0, 3] }), `限制性加叫：${SN[m]}${supNeed}張以上、10–12 點`, { tag: 'raiseLimit', state: st }));
    R.push(rule(bidCall(2, m), h => h.hcp >= 6 && h.hcp <= 10 && h.len[m] >= supNeed && noMaj(h), M(6, 10, { [m]: [supNeed, 13], 2: [0, 3], 3: [0, 3] }), `單加叫：${SN[m]}支持、6–10 點`, { tag: 'raise', state: st }));
    R.push(rule('1N', h => h.hcp >= 6 && h.hcp <= 10 && noMaj(h), M(6, 10, { 2: [0, 3], 3: [0, 3] }), '6–10 點，無四張高花', { tag: 'nt1m', state: st }));
    if (m === 0) R.push(rule('1D', h => h.hcp >= 11, M(11, ALL, { 1: [3, 13] }), '有實力的等待叫：方塊一階，迫叫', { tag: 'new1', force: 1, state: st }));
    else if (notPH) R.push(rule('2C', h => h.hcp >= 13, M(13, ALL, { 0: [3, 13] }), '2/1 成局迫叫（梅花可能三張）', { tag: 'twoOverOne', force: 'GF', state: st }));
    R.push(rule('1N', h => h.hcp >= 6, M(6, 12), '自然 1NT', { tag: 'nt1m', state: st }));
    R.push(rule('P', () => true, M(0, 5), '回應點力不足（0–5）', { state: st }));
    return R;
  }
  function strong2cResponses() {
    const R = [], st = 'response';
    for (const s of [3, 2, 1, 0]) R.push(rule(bidCall(s >= 2 ? 2 : 3, s), h => h.hcp >= 8 && h.len[s] >= 5 && h.top3[s] >= 2, M(8, ALL, { [s]: [5, 13] }), `積極回應：好的五張${SN[s]}、8+ 點`, { tag: '2cPos', force: 'GF', state: st }));
    R.push(rule('2N', h => h.hcp >= 8 && h.bal, M(8, ALL, null, true), '積極回應：8+ 點均型', { tag: '2cPos', force: 'GF', state: st }));
    R.push(rule('2D', () => true, M(0, 10), '等待叫 2♦：多半是弱牌', { tag: '2cWait', force: 1, state: 'convention' }));
    return R;
  }
  function weakTwoResponses(ctx) {
    const R = [], s = parseBid(ctx.opening.call).strain, st = 'response', r = 0;
    if (isMajor(s)) R.push(rule(bidCall(4, s), h => (h.len[s] >= 3 && h.hcp >= 16) || (h.len[s] >= 4 && h.hcp <= 12 + r), M(0, ALL, { [s]: [3, 13] }), `加叫 4${SN[s]}：成局或依總墩數阻擊`, { state: st }));
    R.push(rule('2N', h => h.hcp >= 15, M(15, ALL), '2NT 詢問：問開叫者高低限', { tag: 'ogust', force: 1, state: 'convention' }));
    R.push(rule(bidCall(3, s), h => h.len[s] >= 3 && h.hcp <= 14 && ctx.can(bidCall(3, s)), M(0, 14, { [s]: [3, 13] }), `阻擊加叫 3${SN[s]}`, { state: st }));
    R.push(rule('P', () => true, M(0, 14), '沒有成局機會', { state: st }));
    return R;
  }
  function preemptResponses(ctx) {
    const R = [], b = parseBid(ctx.opening.call), s = b.strain, st = 'response';
    if (b.level === 3) {
      if (isMajor(s)) R.push(rule(bidCall(4, s), h => (h.len[s] >= 2 && h.hcp >= 14) || (h.len[s] >= 3 && h.hcp <= 10), M(0, ALL, { [s]: [2, 13] }), `加叫 4${SN[s]}`, { state: st }));
      else {
        R.push(rule('3N', h => h.hcp >= 15 && [0, 1, 2, 3].filter(x => x !== s).every(x => h.stop[x]), M(15, ALL), '各門有止張，打 3NT', { state: st }));
        R.push(rule(bidCall(5, s), h => (h.len[s] >= 3 && h.hcp >= 16) || (h.len[s] >= 4 && h.hcp <= 10), M(0, ALL, { [s]: [3, 13] }), `加叫 5${SN[s]}`, { state: st }));
      }
    }
    R.push(rule('P', () => true, M(0, 15), '尊重阻擊，Pass', { state: st }));
    return R;
  }
  // partner opened a suit and RHO interfered
  function contestedResponses(ctx) {
    const R = [], ob = parseBid(ctx.opening.call), x = ob.strain, rho = ctx.rhoLast, st = 'competition';
    if (ob.strain === 4) {
      if (rho.call === 'X') {
        R.push(rule('XX', h => h.hcp >= 9, M(9, ALL), '對方加倍 1NT：9+ 點再加倍，準備罰分', { state: st }));
        for (const s of [3, 2, 1, 0]) R.push(rule(bidCall(2, s), h => h.len[s] >= 5 && h.hcp <= 7, M(0, 7, { [s]: [5, 13] }), `逃叫：五張以上${SN[s]}`, { state: st }));
        R.push(rule('P', () => true, M(0, 8), 'Pass', { state: st }));
        return R;
      }
      const z = parseBid(rho.call).strain;
      if (z < 4) R.push(rule('X', h => h.hcp >= 8 && h.len[z] >= 4, M(8, ALL, { [z]: [4, 13] }), `罰分加倍：${SN[z]}四張以上、8+ 點`, { state: st }));
      R.push(rule('3N', h => h.hcp >= 10 && (z === 4 || h.stop[z]), M(10, 15), '有止張、成局：3NT', { state: st }));
      for (const s of [3, 2, 1, 0]) if (s !== z) {
        R.push(rule(ctx.cheapest(s) || 'none', h => h.len[s] >= 5 && h.hcp >= 10 && ctx.cheapLevel(s) === 3, M(10, ALL, { [s]: [5, 13] }), `${SN[s]}五張以上，成局迫叫`, { force: 'GF', state: st }));
        R.push(rule(ctx.cheapest(s) || 'none', h => h.len[s] >= 5 && h.hcp <= 9 && ctx.cheapLevel(s) === 2, M(0, 9, { [s]: [5, 13] }), `競叫：五張以上${SN[s]}`, { state: st }));
      }
      R.push(rule('P', () => true, NONE(), 'Pass', { state: st }));
      return R;
    }
    if (rho.call === 'X') {
      if (isMajor(x)) R.push(rule('2N', h => h.len[x] >= 4 && h.hcp >= 10, M(10, ALL, { [x]: [4, 13] }), `Jordan 2NT：${SN[x]}四張以上支持、限制性加叫以上`, { tag: 'jordan', force: 1, state: 'convention' }));
      R.push(rule('XX', h => h.hcp >= 10, M(10, ALL), '再加倍：10+ 點，多半無配合，準備罰分', { tag: 'xxStrong', force: 1, state: st }));
      if (isMajor(x)) R.push(rule(bidCall(4, x), h => h.len[x] >= 5 && h.hcp <= 9, M(0, 9, { [x]: [5, 13] }), '阻擊成局', { state: st }));
      R.push(rule(bidCall(3, x), h => h.len[x] >= (isMajor(x) ? 4 : 5) && h.hcp <= 9, M(0, 9, { [x]: [4, 13] }), '阻擊性跳加叫', { state: st }));
      R.push(rule(bidCall(2, x), h => h.len[x] >= (isMajor(x) ? 3 : 5) && h.hcp >= 5 && h.hcp <= 9, M(5, 9, { [x]: [3, 13] }), '單加叫', { state: st }));
      for (const s of [3, 2, 1]) if (s > x) R.push(rule(bidCall(1, s), h => h.len[s] >= 5 && h.hcp >= 6 && h.hcp <= 9, M(6, 9, { [s]: [5, 13] }), `${SN[s]}五張以上，非迫叫`, { state: st }));
      R.push(rule('1N', h => h.hcp >= 6 && h.hcp <= 9, M(6, 9), '6–9 點', { state: st }));
      R.push(rule('P', () => true, M(0, 9), 'Pass', { state: st }));
      return R;
    }
    const zb = parseBid(rho.call), z = zb.strain, L = zb.level;
    const sup = h => h.len[x] >= (isMajor(x) ? 3 : 5);
    if (z < 4) R.push(rule(ctx.cheapest(z) || 'none', h => sup(h) && supportPts(h, x) >= 10 && ctx.cheapLevel(z) <= 3, M(10, ALL, { [x]: [3, 13] }), `扣叫對方花色：${SN[x]}支持的限制性加叫以上`, { tag: 'cueRaise', force: 1, state: 'convention' }));
    if (isMajor(x)) R.push(rule(bidCall(4, x), h => h.len[x] >= 5 && h.hcp <= 9 && ctx.can(bidCall(4, x)), M(0, 9, { [x]: [5, 13] }), '阻擊成局', { state: st }));
    const jl = ctx.cheapLevel(x) + 1;
    if (jl <= 4) R.push(rule(bidCall(Math.min(jl, 4), x), h => h.len[x] >= 4 && h.hcp <= 9 && jl <= 3, M(0, 9, { [x]: [4, 13] }), '阻擊性跳加叫', { state: st }));
    R.push(rule(ctx.cheapest(x) || 'none', h => sup(h) && supportPts(h, x) >= 6 && h.hcp <= 10 && ctx.cheapLevel(x) <= 3, M(5, 10, { [x]: [3, 13] }), `單加叫${SN[x]}`, { state: st }));
    if (L === 1 && z === 2 && x < 2) R.push(rule('1S', h => h.len[3] >= 5 && h.hcp >= 6, M(6, ALL, { 3: [5, 13] }), '五張以上黑桃，迫叫一輪', { force: 1, state: st }));
    if (L <= 3 && z < 4) {
      const unbidMaj = [2, 3].filter(s => s !== x && s !== z);
      const unbidMin = [0, 1].filter(s => s !== x && s !== z);
      const need = L === 1 ? 6 : L === 2 ? 8 : 10;
      const lens = {}; unbidMaj.forEach(s => { lens[s] = [4, 13]; });
      R.push(rule('X', h => h.hcp >= need && (unbidMaj.length ? unbidMaj.every(s => h.len[s] >= 4) : unbidMin.some(s => h.len[s] >= 4)) && !(sup(h) && isMajor(x)), M(need, ALL, lens), unbidMaj.length ? `負加倍：${unbidMaj.map(s => SN[s]).join('')}四張、${need}+ 點` : `負加倍：低花長度、${need}+ 點`, { tag: 'negX', force: 1, state: 'convention' }));
    }
    const stopZ = h => z === 4 || h.stop[z];
    R.push(rule('3N', h => h.hcp >= 13 && stopZ(h) && h.semi && ctx.can('3N'), M(13, 16), `${SN[z]}有止張，成局 3NT`, { state: st }));
    R.push(rule('2N', h => h.hcp >= 11 && h.hcp <= 12 && stopZ(h) && ctx.can('2N'), M(11, 12), `${SN[z]}有止張，邀請`, { state: st }));
    R.push(rule('1N', h => h.hcp >= 8 && h.hcp <= 10 && stopZ(h) && ctx.can('1N'), M(8, 10), `${SN[z]}有止張，8–10 點`, { state: st }));
    for (const s of [3, 2, 1, 0]) if (s !== x && s !== z) {
      const c = ctx.cheapest(s);
      if (!c) continue;
      const lvl = Number(c[0]);
      if (lvl === 1) R.push(rule(c, h => h.len[s] >= 4 && h.hcp >= 6, M(6, ALL, { [s]: [4, 13] }), `新花一階：${SN[s]}四張以上，迫叫`, { force: 1, state: st }));
      else if (lvl === 2) R.push(rule(c, h => h.len[s] >= 5 && h.hcp >= 10, M(10, ALL, { [s]: [5, 13] }), `二階新花：${SN[s]}五張以上、10+ 點，迫叫`, { force: 1, state: st }));
    }
    R.push(rule('P', () => true, M(0, 10), '沒有適合的競叫', { state: st }));
    return R;
  }

  // ---------- opener's rebid ----------
  function openerRebids(ctx) {
    const R = [], ob = parseBid(ctx.opening.call), x = ob.strain, p = ctx.pdLast, st = 'rebid';
    if (!p || p.call === 'P' || ctx.rhoLast.call !== 'P') return null;
    const pb = isBid(p.call) ? parseBid(p.call) : null;
    if (ctx.opening.tag === 'open2c') {
      if (p.tag === '2cWait') {
        R.push(rule('2N', h => h.bal && h.hcp >= 22 && h.hcp <= 24, M(22, 24, null, true), '22–24 點均型（之後同 2NT 開叫系統）', { tag: '2c-2nt', state: st }));
        R.push(rule('3N', h => h.bal && h.hcp >= 25, M(25, 27, null, true), '25–27 點均型', { state: st }));
        for (const s of [3, 2, 1, 0]) R.push(rule(ctx.cheapest(s) || 'none', h => h.len[s] >= 5 && h.len[s] === Math.max(...h.len), M(19, ALL, { [s]: [5, 13] }), `自然叫出長門${SN[s]}，成局迫叫`, { tag: '2cSuit', force: 'GF', state: st }));
        R.push(rule('2N', h => h.hcp <= 24 && !h.len.some(l => l >= 5), M(22, 24), '22–24 點、無五張長門（三門分配也以 2NT 描述）', { tag: '2c-2nt', state: st }));
        R.push(rule('3N', h => !h.len.some(l => l >= 5), M(25, 30), '25+ 點、無五張長門', { state: st }));
        return R;
      }
      return null;
    }
    if (ctx.opening.tag !== 'open1M' && ctx.opening.tag !== 'open1m') return null;
    if (p.tag === 'new1') {
      const y = pb.strain, newS = [0, 1, 2, 3].filter(s => s !== x && s !== y);
      R.push(rule(bidCall(4, y), h => isMajor(y) && h.len[y] >= 4 && supportPts(h, y) >= 19, M(17, 21, { [y]: [4, 13] }), `四張${SN[y]}支持、19+ 支持點，直接成局`, { state: st }));
      R.push(rule(bidCall(3, y), h => h.len[y] >= 4 && supportPts(h, y) >= 16, M(15, 18, { [y]: [4, 13] }), `四張${SN[y]}支持、16–18，邀請`, { state: st }));
      R.push(rule('2N', h => h.bal && h.hcp >= 18 && h.hcp <= 19, M(18, 19, null, true), '18–19 點均型', { tag: 'rebid2nt', state: st }));
      for (const z of newS) {
        const c = ctx.cheapest(z); if (!c) continue;
        const lvl = Number(c[0]) + 1;
        if (lvl <= 3) R.push(rule(bidCall(lvl, z), h => h.hcp >= 19 && h.len[z] >= 4, M(19, 21, { [z]: [4, 13] }), `跳新花：19+ 點、${SN[z]}四張以上，成局迫叫`, { force: 'GF', state: st }));
      }
      R.push(rule(bidCall(2, y), h => (h.len[y] >= 4 || (isMajor(y) && h.len[y] === 3 && h.short.some(Boolean) && h.hcp <= 14)) && supportPts(h, y) <= 15, M(11, 15, { [y]: [3, 13] }), `加叫搭檔${SN[y]}：低限`, { tag: 'raise', state: st }));
      for (const z of newS) { const c = ctx.cheapest(z); if (c && c[0] === '1' && z > y) R.push(rule(c, h => h.len[z] >= 4, M(11, 18, { [z]: [4, 13] }), `一階新花：${SN[z]}四張以上`, { state: st })); }
      R.push(rule('1N', h => h.bal && h.hcp <= 14, M(11, 14, null, true), '12–14 點均型', { tag: 'rebid1nt', state: st }));
      for (const z of newS) if (z > x) { const c = ctx.cheapest(z); if (c && c[0] === '2') R.push(rule(c, h => h.hcp >= 17 && h.len[z] >= 4 && h.len[x] > h.len[z], M(16, 21, { [x]: [5, 13], [z]: [4, 13] }), `逆叫：17+ 點，${SN[x]}長於${SN[z]}，迫叫一輪`, { tag: 'reverse', force: 1, state: st })); }
      R.push(rule(bidCall(3, x), h => h.len[x] >= 6 && h.tp >= 16, M(15, 18, { [x]: [6, 13] }), `跳叫再叫${SN[x]}：六張以上、16–18 點，邀請`, { state: st }));
      for (const z of newS) if (z < x) { const c = ctx.cheapest(z); if (c && c[0] === '2') R.push(rule(c, h => h.len[z] >= 4 && !(h.len[x] >= 6 && h.len[z] < 5), M(11, 18, { [z]: [4, 13] }), `二階新花：${SN[z]}四張以上`, { state: st })); }
      R.push(rule(bidCall(2, x), h => h.len[x] >= 6, M(11, 15, { [x]: [6, 13] }), `再叫${SN[x]}：六張以上低限`, { state: st }));
      R.push(rule(bidCall(2, x), h => h.len[x] >= 5, M(11, 15, { [x]: [5, 13] }), `再叫${SN[x]}`, { state: st }));
      R.push(rule('1N', () => true, M(11, 14), '低限，無更好叫品', { tag: 'rebid1nt', state: st }));
      return R;
    }
    if (p.tag === 'ntForcing' || p.tag === 'ntPH' || p.tag === 'nt1m') {
      R.push(rule(bidCall(4, x), h => isMajor(x) && h.len[x] >= 6 && h.tp >= 19, M(17, 21, { [x]: [6, 13] }), '長門強牌，直接成局', { state: st }));
      R.push(rule(bidCall(3, x), h => h.len[x] >= 6 && h.tp >= 16, M(15, 18, { [x]: [6, 13] }), '跳叫再叫：六張以上、邀請', { state: st }));
      R.push(rule('2N', h => h.bal && h.hcp >= 18, M(18, 19, null, true), '18–19 點均型，邀請', { state: st }));
      for (const z of [0, 1, 2, 3]) if (z !== x) { const c = ctx.cheapest(z); if (c && c[0] === '2' && z > x) R.push(rule(c, h => h.hcp >= 17 && h.len[z] >= 4, M(16, 21, { [z]: [4, 13] }), `逆叫：17+ 點、${SN[z]}四張以上`, { tag: 'reverse', force: 1, state: st })); }
      R.push(rule(bidCall(2, x), h => h.len[x] >= 6, M(11, 15, { [x]: [6, 13] }), '再叫六張長門，低限', { state: st }));
      if (p.tag !== 'ntForcing') R.push(rule('P', h => h.bal && h.hcp <= 14, M(11, 14), '均型低限，Pass', { state: st }));
      for (const z of [2, 1, 0]) if (z < x) { const c = ctx.cheapest(z); if (c && c[0] === '2') R.push(rule(c, h => h.len[z] >= (z === 2 ? 4 : 3) && (z === 2 || h.len[z] >= h.len[z === 0 ? 1 : 0] + (z === 1 ? 1 : 0)), M(11, 18, { [z]: [z === 2 ? 4 : 3, 13] }), `二階新花：${SN[z]}（低花可能三張）`, { state: st })); }
      R.push(rule(bidCall(2, x), () => true, M(11, 15, { [x]: [5, 13] }), '再叫長門', { state: st }));
      return R;
    }
    if (p.tag === 'raise' && pb.strain === x) {
      if (isMajor(x)) {
        R.push(rule(bidCall(4, x), h => h.tp >= 19, M(17, 21), '19+ 點，直接成局', { state: st }));
        R.push(rule(bidCall(3, x), h => h.tp >= 16, M(15, 18), '16–18 點，邀請成局', { tag: 'reinvite', state: st }));
        R.push(rule('P', () => true, M(11, 15), '低限，停在部分合約', { state: st }));
      } else {
        R.push(rule('3N', h => h.hcp >= 18 && h.bal, M(18, 19), '18–19 均型：3NT', { state: st }));
        R.push(rule('2N', h => h.hcp >= 16 && h.semi, M(16, 17), '16–17，邀請 3NT', { state: st }));
        R.push(rule('P', () => true, M(11, 15), '低限', { state: st }));
      }
      return R;
    }
    if (p.tag === 'raiseLimit' && pb.strain === x) {
      if (isMajor(x)) {
        R.push(rule('4N', h => h.tp + 11 >= 33 && h.aces >= 2, NONE(), `RKCB 問關鍵張（王牌${SN[x]}）`, { tag: 'rkcb', trump: x, state: 'slam' }));
        R.push(rule(bidCall(4, x), h => h.tp >= 14, M(13, 21), '接受邀請，成局', { state: st }));
      } else {
        R.push(rule('3N', h => h.hcp >= 13 && [0, 1, 2, 3].filter(s => s !== x).filter(s => h.stop[s]).length >= 2, M(13, 21), '接受邀請：3NT', { state: st }));
        R.push(rule(bidCall(5, x), h => h.tp >= 16, M(15, 21), '接受邀請：5 階低花', { state: st }));
      }
      R.push(rule('P', () => true, M(11, 13), '低限，拒絕邀請', { state: st }));
      return R;
    }
    if (p.tag === 'raisePre') { R.push(rule('P', () => true, NONE(), '尊重搭檔阻擊', { state: st })); return R; }
    if (p.tag === 'jacoby') {
      for (const z of [0, 1, 2, 3]) if (z !== x) R.push(rule(bidCall(3, z), h => h.len[z] <= 1 && ctx.can(bidCall(3, z)), M(11, 21, { [z]: [0, 1] }), `Jacoby 回答：${SN[z]}單張或缺門`, { tag: 'jShort', state: 'convention' }));
      R.push(rule(bidCall(3, x), h => h.tp >= 18, M(17, 21), 'Jacoby 回答：18+ 點，無短門', { state: 'convention' }));
      R.push(rule('3N', h => h.hcp >= 15, M(15, 17), 'Jacoby 回答：15–17 點，無短門', { state: 'convention' }));
      R.push(rule(bidCall(4, x), () => true, M(11, 14), 'Jacoby 回答：低限，無短門', { state: 'convention' }));
      return R;
    }
    if (p.tag === 'splinter') {
      const z = pb.strain;
      R.push(rule('4N', h => h.tp - (h.hcpS[z] - (h.has[z].includes(14) ? 4 : 0)) + 13 >= 31 && h.hcp >= 14, NONE(), `搭檔${SN[z]}短門，我方大牌集中：RKCB`, { tag: 'rkcb', trump: x, state: 'slam' }));
      R.push(rule(bidCall(4, x), () => true, NONE(), '大牌浪費在短門或低限：停在成局', { state: st }));
      return R;
    }
    if (p.tag === 'twoOverOne') {
      const y = pb.strain;
      R.push(rule(bidCall(3, y), h => h.len[y] >= 4 && ctx.can(bidCall(3, y)), M(11, 21, { [y]: [4, 13] }), `支持搭檔${SN[y]}`, { force: 'GF', state: st }));
      R.push(rule(bidCall(2, x), h => h.len[x] >= 6, M(11, 21, { [x]: [6, 13] }), `六張以上${SN[x]}`, { force: 'GF', state: st }));
      for (const z of [3, 2, 1]) if (z !== x && z !== y) { const c = ctx.cheapest(z); if (c && c[0] === '2') R.push(rule(c, h => h.len[z] >= 4, M(11, 21, { [z]: [4, 13] }), `二階新花：${SN[z]}四張以上`, { force: 'GF', state: st })); }
      R.push(rule('2N', h => h.semi, M(11, 21), '均型，各門有止張意圖', { force: 'GF', state: st }));
      R.push(rule(bidCall(2, x), () => true, M(11, 21, { [x]: [5, 13] }), `再叫${SN[x]}`, { force: 'GF', state: st }));
      return R;
    }
    if (p.tag === 'nt2m') {
      R.push(rule('3N', h => h.hcp >= 13, M(13, 21), '接受邀請：3NT', { state: st }));
      R.push(rule(bidCall(3, x), h => h.len[x] >= 6, M(11, 12, { [x]: [6, 13] }), '低限長門，停在三階', { state: st }));
      R.push(rule('P', () => true, M(11, 12), '低限，Pass', { state: st }));
      return R;
    }
    if (p.tag === 'nt3m') { R.push(rule('4N', h => h.hcp + 14 >= 33 && h.bal, NONE(), '量化 4NT', { tag: 'quant', state: 'slam' })); R.push(rule('P', () => true, NONE(), '打 3NT', { state: st })); return R; }
    return null;
  }

  // ---------- overcalls (opponents opened, our side silent) ----------
  function overcallRules(ctx, profile) {
    const R = [], tb = ctx.lastBid, z = tb.strain, L = tb.level, risk = profile.risk, st = 'competition';
    const e = ctx.entries, n = e.length;
    const balancing = n >= 3 && e[n - 1].call === 'P' && e[n - 2].call === 'P' && isBid(e[n - 3].call) && e[n - 3].seat === ctx.lho;
    const adj = balancing ? (ctx.lastBid.level <= 2 ? 3 : 1) : 0;
    if (ctx.opening.tag === 'open2c' && L <= 2) { R.push(rule('P', () => true, NONE(), '對方強開叫，Pass', { state: st })); return R; }
    const zOpen = parseBid(ctx.theirBids[0].call).strain;
    if (z === 4 && zOpen < 4 && ctx.theirBids.length > 1) {
      R.push(rule('X', h => h.hcp >= 13 && h.len[zOpen] <= 2, M(13, ALL, { [zOpen]: [0, 2] }), `技術性加倍：${SN[zOpen]}短、13+ 點`, { tag: 'takeout', state: 'convention' }));
      for (const s of [3, 2, 1, 0]) if (s !== zOpen) { const c = ctx.cheapest(s); if (c && Number(c[0]) <= 2) R.push(rule(c, h => h.len[s] >= 5 && h.hcp >= 10 && (okSuit(h, s) || h.hcp >= 13), M(10, 17, { [s]: [5, 13] }), `爭叫：${SN[s]}五張以上`, { tag: 'ovc', state: st })); }
      R.push(rule('P', () => true, M(0, 16), 'Pass', { state: st }));
      return R;
    }
    if (z === 4) {
      R.push(rule('X', h => h.hcp >= 15 + (L > 1 ? 1 : 0) - adj, M(15 - adj, ALL), '罰分加倍：牌力強於開叫者', { tag: 'penXnt', state: st }));
      for (const s of [3, 2, 1, 0]) { const c = ctx.cheapest(s); if (c && Number(c[0]) <= L + 1) R.push(rule(c, h => h.len[s] >= 6 - (risk > 1 ? 1 : 0) && h.hcp >= 8 - adj && okSuit(h, s), M(8 - adj, 16, { [s]: [5, 13] }), `自然爭叫：${SN[s]}長門`, { tag: 'ovc', state: st })); }
      R.push(rule('P', () => true, M(0, 15), 'Pass', { state: st }));
      return R;
    }
    const unbid = [0, 1, 2, 3].filter(s => s !== z && !ctx.theirStrains.includes(s));
    if (L === 1) {
      R.push(rule('1N', h => h.bal && h.hcp >= 15 - adj && h.hcp <= 18 - adj && h.stop[z], M(15 - adj, 18 - adj, null, true), `1NT 爭叫：${15 - adj}–${18 - adj} 點均型，${SN[z]}有止張`, { tag: 'ovc-nt', state: st }));
      if (z < 2) R.push(rule(bidCall(2, z), h => h.len[2] >= 5 && h.len[3] >= 5 && h.hcp >= 8, M(8, ALL, { 2: [5, 13], 3: [5, 13] }), 'Michaels 扣叫：兩門高花各五張以上', { tag: 'michM', force: 1, state: 'convention' }));
      else {
        const om = z === 2 ? 3 : 2;
        R.push(rule(bidCall(2, z), h => h.len[om] >= 5 && (h.len[0] >= 5 || h.len[1] >= 5) && h.hcp >= 8, M(8, ALL, { [om]: [5, 13] }), `Michaels 扣叫：${SN[om]}五張＋一門低花五張`, { tag: 'michm', force: 1, state: 'convention' }));
      }
      const low2 = [0, 1, 2].filter(s => s !== z).slice(0, 2);
      R.push(rule('2N', h => low2.every(s => h.len[s] >= 5) && h.hcp >= 8, M(8, ALL, { [low2[0]]: [5, 13], [low2[1]]: [5, 13] }), `Unusual 2NT：${low2.map(s => SN[s]).join('')}各五張以上`, { tag: 'unusual', force: 1, state: 'convention' }));
      if (!balancing) for (const s of [3, 2, 1, 0]) if (s !== z) {
        const c = ctx.cheapest(s); if (!c) continue;
        const jl = Number(c[0]) + 1;
        if (jl <= 3) R.push(rule(bidCall(jl, s), h => h.len[s] >= 6 && h.hcp >= 5 && h.hcp <= 10 && okSuit(h, s), M(5, 10, { [s]: [6, 13] }), `弱跳爭叫：六張${SN[s]}、5–10 點`, { tag: 'wjo', state: st }));
      }
      R.push(rule('X', h => (h.hcp >= 12 - adj - (risk > 1 ? 1 : 0) && h.len[z] <= 2 && unbid.every(s => h.len[s] >= 3) && unbid.filter(isMajor).every(s => h.len[s] >= 3)) || h.hcp >= 17, M(11 - adj, ALL, { [z]: [0, 3] }), `技術性加倍：${SN[z]}短、其他花色有支持，${12 - adj}+ 點`, { tag: 'takeout', force: 1, state: 'convention' }));
      const order = h => [3, 2, 1, 0].filter(s => s !== z).sort((a, b) => h.len[b] - h.len[a] || b - a);
      for (const s of [3, 2, 1, 0]) if (s !== z) {
        const c = ctx.cheapest(s); if (!c) continue;
        if (c[0] === '1') R.push(rule(c, h => order(h)[0] === s && h.len[s] >= 5 && h.hcp >= 8 - adj - (risk > 1 ? 1 : 0) && h.hcp <= 17 && (okSuit(h, s) || h.hcp >= 12 || balancing), M(8 - adj, 17, { [s]: [5, 13] }), `一階爭叫：五張以上${SN[s]}、8–16 點`, { tag: 'ovc', state: st }));
        else if (c[0] === '2') R.push(rule(c, h => order(h)[0] === s && h.len[s] >= 5 && h.hcp >= 11 - adj - (risk > 1 ? 1 : 0) && h.hcp <= 17 && (goodSuit(h, s) || h.len[s] >= 6 || h.hcp >= 14 || balancing), M(10 - adj, 17, { [s]: [5, 13] }), `二階爭叫：好的五張以上${SN[s]}、11–16 點`, { tag: 'ovc', state: st }));
      }
      R.push(rule('P', () => true, M(0, 16), '沒有合適的爭叫', { state: st }));
      return R;
    }
    // higher-level openings / preempts
    if (L >= 4) {
      R.push(rule('X', h => h.hcp >= 16 && h.len[z] <= 1, M(16, ALL, { [z]: [0, 1] }), '高階加倍：牌力強、對方花色短（搭檔多半 Pass）', { tag: 'highX', state: st }));
      for (const s of [3, 2, 1, 0]) if (s !== z) { const c = ctx.cheapest(s); if (c && Number(c[0]) <= 5) R.push(rule(c, h => h.len[s] >= 6 && h.hcp >= 12 && goodSuit(h, s), M(12, ALL, { [s]: [6, 13] }), `高階爭叫：長且強的${SN[s]}`, { tag: 'ovc', state: st })); }
      R.push(rule('P', () => true, NONE(), '對方已叫到高階，Pass', { state: st }));
      return R;
    }
    R.push(rule('X', h => (h.hcp >= 13 - adj && h.len[z] <= 2 && unbid.every(s => h.len[s] >= 3)) || h.hcp >= 18, M(13 - adj, ALL, { [z]: [0, 3] }), '對阻擊的技術性加倍', { tag: 'takeout', force: 1, state: 'convention' }));
    if (L === 2) R.push(rule('2N', h => h.bal && h.hcp >= 15 && h.hcp <= 18 && h.stop[z], M(15, 18, null, true), `2NT 爭叫：15–18 點，${SN[z]}有止張`, { tag: 'ovc-nt', state: st }));
    if (L <= 3) R.push(rule('3N', h => h.semi && h.hcp >= 16 && h.stop[z], M(16, 22), '有止張，3NT', { state: st }));
    for (const s of [3, 2, 1, 0]) if (s !== z) { const c = ctx.cheapest(s); if (c && Number(c[0]) <= Math.max(3, L)) R.push(rule(c, h => h.len[s] >= (Number(c[0]) >= 3 ? 6 : 5) && h.hcp >= 12 - adj && goodSuit(h, s), M(12 - adj, 18, { [s]: [5, 13] }), `${c[0]} 階爭叫：好的長${SN[s]}`, { tag: 'ovc', state: st })); }
    R.push(rule('P', () => true, M(0, 17), 'Pass', { state: st }));
    return R;
  }

  // ---------- advancing partner's overcall / double ----------
  function advanceRules(ctx) {
    const R = [], p = ctx.pdLast, st = 'competition';
    const theirFirst = ctx.theirBids[0], z = parseBid(theirFirst.call).strain;
    const rhoQuiet = ctx.rhoLast && ctx.rhoLast.call === 'P';
    if (p.tag === 'takeout') {
      const zb = ctx.lastBid, zz = zb.strain;
      if (!rhoQuiet) {
        for (const s of [3, 2, 1, 0]) if (s !== zz) { const c = ctx.cheapest(s); if (c) R.push(rule(c, h => h.len[s] >= 5 && Number(c[0]) <= Math.min(5, Math.max(3, h.len[s] - 3)) && (h.hcp >= 6 || h.len[s] >= 7), M(4, ALL, { [s]: [5, 13] }), `自由應叫：${SN[s]}長門`, { state: st })); }
        R.push(rule('P', () => true, M(0, 7), '對方已插叫，可 Pass', { state: st }));
        return R;
      }
      if (zz < 4) R.push(rule('P', h => zb.level === 1 && h.len[zz] >= 5 && h.top5[zz] >= 3, M(6, ALL, { [zz]: [5, 13] }), `罰分性 Pass：${SN[zz]}長且強`, { tag: 'penPass', state: st }));
      if (zz < 4) R.push(rule(ctx.cheapest(zz) || 'none', h => h.hcp >= 12, M(12, ALL), '扣叫：12+ 點，迫叫', { tag: 'advCue', force: 1, state: 'convention' }));
      R.push(rule('3N', h => h.hcp >= 13 && (zz === 4 || h.stop[zz]), M(13, ALL), '成局 3NT', { state: st }));
      for (const s of [3, 2]) if (s !== zz) R.push(rule(bidCall(4, s), h => h.len[s] >= 5 && h.hcp >= 10, M(10, ALL, { [s]: [5, 13] }), `直接成局 4${SN[s]}`, { state: st }));
      for (const s of [3, 2, 1, 0]) if (s !== zz) { const c = ctx.cheapest(s); if (c) { const jl = Number(c[0]) + 1; if (jl <= 3) R.push(rule(bidCall(jl, s), h => h.len[s] >= 4 && h.hcp >= 9 && h.hcp <= 11 && h.len[s] === Math.max(...[0, 1, 2, 3].filter(t => t !== zz).map(t => h.len[t])), M(9, 11, { [s]: [4, 13] }), `跳叫${SN[s]}：9–11 點邀請`, { state: st })); } }
      R.push(rule('2N', h => h.hcp >= 11 && h.hcp <= 12 && (zz === 4 || h.stop[zz]) && ctx.can('2N'), M(11, 12), '2NT 邀請', { state: st }));
      R.push(rule('1N', h => h.hcp >= 6 && h.hcp <= 10 && (zz === 4 || h.stop[zz]) && h.len[2] < 4 && h.len[3] < 4 && ctx.can('1N'), M(6, 10), '1NT：6–10 點有止張', { state: st }));
      const best = h => [3, 2, 1, 0].filter(t => t !== zz).sort((a, b) => (h.len[b] + (isMajor(b) ? 0.5 : 0)) - (h.len[a] + (isMajor(a) ? 0.5 : 0)))[0];
      for (const s of [3, 2, 1, 0]) if (s !== zz) { const c = ctx.cheapest(s); if (c) R.push(rule(c, h => best(h) === s, M(0, 8, { [s]: [3, 13] }), `回應技術性加倍：最長的${SN[s]}`, { state: st })); }
      return R;
    }
    if (p.tag === 'michM' || p.tag === 'michm' || p.tag === 'unusual') {
      const shown = p.tag === 'michM' ? [2, 3] : p.tag === 'michm' ? [parseBid(p.call).strain === 2 ? 3 : 2] : [0, 1, 2].filter(s => s !== z).slice(0, 2);
      for (const s of shown) if (isMajor(s)) R.push(rule(bidCall(4, s), h => h.len[s] >= 4 && h.hcp >= 9 && ctx.can(bidCall(4, s)) && h.len[s] === Math.max(...shown.map(t => h.len[t])), M(9, ALL, { [s]: [4, 13] }), `支持${SN[s]}成局`, { state: st }));
      if (p.tag === 'michm') {
        const om = shown[0];
        R.push(rule(ctx.cheapest(om) || 'none', h => h.len[om] >= 3, M(0, ALL, { [om]: [3, 13] }), `選擇${SN[om]}`, { state: st }));
        R.push(rule('2N', h => h.len[om] < 3 && ctx.can('2N'), M(0, ALL, { [om]: [0, 2] }), '詢問搭檔的低花', { tag: 'michAsk', force: 1, state: 'convention' }));
      }
      for (const s of shown) R.push(rule(ctx.cheapest(s) || 'none', h => h.len[s] === Math.max(...shown.map(t => h.len[t])), M(0, ALL), `選擇較長的${SN[s]}`, { state: st }));
      R.push(rule('P', () => true, NONE(), 'Pass', { state: st }));
      return R;
    }
    if (p.tag === 'ovc-nt' && rhoQuiet) {
      const R2 = ntResponses(ctx, parseBid(p.call).level, parseBid(p.call).level === 1 ? 15 : 15, 18, '爭叫');
      return R2;
    }
    if (p.tag === 'ovc' || p.tag === 'wjo') {
      const pb = parseBid(p.call), s = pb.strain;
      const pdLen = p.tag === 'wjo' ? 6 : 5;
      if (z < 4) R.push(rule(ctx.cheapest(z) || 'none', h => h.len[s] >= 3 && h.hcp >= 10 && p.tag === 'ovc' && ctx.cheapLevel(z) <= 3, M(10, ALL, { [s]: [3, 13] }), `扣叫：${SN[s]}支持的限制性加叫以上`, { tag: 'cueRaise', force: 1, state: 'convention' }));
      if (isMajor(s)) R.push(rule(bidCall(4, s), h => (h.len[s] >= 3 && h.hcp >= 13) || (p.tag === 'wjo' && h.len[s] >= 2 && h.hcp >= 16) || (h.len[s] + pdLen >= 10 && h.hcp <= 10), M(0, ALL, { [s]: [2, 13] }), `加叫 4${SN[s]}`, { state: st }));
      const jl = ctx.cheapLevel(s) + 1;
      if (jl <= 3 && p.tag === 'ovc') R.push(rule(bidCall(jl, s), h => h.len[s] >= 4 && h.hcp <= 9, M(0, 9, { [s]: [4, 13] }), '阻擊性跳加叫', { state: st }));
      R.push(rule(ctx.cheapest(s) || 'none', h => h.len[s] >= (p.tag === 'wjo' ? 2 : 3) && (h.hcp >= 7 || h.len[s] + pdLen >= 9) && ctx.cheapLevel(s) <= Math.max(2, h.len[s] + pdLen - 6), M(5, 10, { [s]: [2, 13] }), `加叫搭檔${SN[s]}`, { state: st }));
      R.push(rule('3N', h => h.hcp >= 15 && (z === 4 || h.stop[z]) && ctx.can('3N'), M(15, ALL), '3NT', { state: st }));
      R.push(rule('2N', h => h.hcp >= 12 && h.hcp <= 14 && (z === 4 || h.stop[z]) && ctx.can('2N'), M(12, 14), '2NT 邀請', { state: st }));
      R.push(rule('1N', h => h.hcp >= 8 && h.hcp <= 11 && (z === 4 || h.stop[z]) && ctx.can('1N'), M(8, 11), '1NT：8–11 點有止張', { state: st }));
      for (const t of [3, 2, 1, 0]) if (t !== s && t !== z) { const c = ctx.cheapest(t); if (c && Number(c[0]) <= 2) R.push(rule(c, h => h.len[t] >= 5 && h.hcp >= 8 && okSuit(h, t), M(8, ALL, { [t]: [5, 13] }), `新花：${SN[t]}五張以上`, { state: st })); }
      R.push(rule('P', () => true, M(0, 9), 'Pass', { state: st }));
      return R;
    }
    if (p.tag === 'highX') {
      for (const s of [3, 2, 1, 0]) { const c = ctx.cheapest(s); if (c && Number(c[0]) <= 5) R.push(rule(c, h => h.len[s] >= 6 && h.hcp >= 6, M(6, ALL, { [s]: [6, 13] }), `叫出長門${SN[s]}`, { state: st })); }
      R.push(rule('P', () => true, NONE(), '轉為罰分，Pass', { state: st }));
      return R;
    }
    if (p.tag === 'penXnt') { R.push(rule('P', () => true, NONE(), '轉為罰分，Pass', { state: st })); return R; }
    return null;
  }

  // ---------- slam conventions ----------
  function slamRules(ctx) {
    const p = ctx.pdLast, me = ctx.myLast, R = [];
    if (p && p.tag === 'rkcb' && ctx.rhoLast && (ctx.rhoLast.call === 'P')) {
      const t = p.trump;
      R.push(rule('5S', h => keycards(h, t) === 2 && trumpQ(h, t), NONE(), 'RKCB 回答：2 張關鍵張＋王牌 Q', { tag: 'rkcbResp', kc: 2, state: 'slam' }));
      R.push(rule('5H', h => keycards(h, t) === 2, NONE(), 'RKCB 回答：2 張關鍵張，無王牌 Q', { tag: 'rkcbResp', kc: 2, state: 'slam' }));
      R.push(rule('5D', h => keycards(h, t) === 0 || keycards(h, t) === 3, NONE(), 'RKCB 回答：0 或 3 張關鍵張', { tag: 'rkcbResp', kc: 0, state: 'slam' }));
      R.push(rule('5C', () => true, NONE(), 'RKCB 回答：1 或 4 張關鍵張', { tag: 'rkcbResp', kc: 1, state: 'slam' }));
      return R;
    }
    if (me && me.tag === 'rkcb' && p && p.tag === 'rkcbResp') {
      const t = me.trump, pdInfo = ctx.info[ctx.pd];
      const pdKC = h => { const mine = keycards(h, t); const base = p.call === '5C' ? 1 : p.call === '5D' ? 0 : 2; if (base === 2) return 2; const alt = base + 3; if (mine + alt > 5) return base; return pdInfo.hcp[0] >= 12 && mine <= 1 ? alt : base; };
      const total = h => keycards(h, t) + pdKC(h);
      const qKnown = h => trumpQ(h, t) || p.call === '5S';
      const signoff = bidCall(5, t);
      R.push(rule(bidCall(7, t), h => total(h) === 5 && qKnown(h) && h.hcp + pdEstimate(ctx) >= 35, NONE(), '關鍵張與王牌 Q 齊全：大滿貫', { tag: 'rkcbEnd', state: 'slam' }));
      R.push(rule(bidCall(6, t), h => total(h) >= 4, NONE(), '只缺一張關鍵張以內：小滿貫', { tag: 'rkcbEnd', state: 'slam' }));
      R.push(rule(signoff, h => total(h) <= 3 && ctx.can(signoff), NONE(), '缺兩張關鍵張：停在 5 階', { tag: 'rkcbEnd', state: 'slam' }));
      R.push(rule('P', h => total(h) <= 3 && ctx.lastBid && ctx.lastBid.strain === t, NONE(), '缺兩張關鍵張，停止', { tag: 'rkcbEnd', state: 'slam' }));
      R.push(rule(bidCall(6, t), () => true, NONE(), '無法停在 5 階，叫小滿貫', { tag: 'rkcbEnd', state: 'slam' }));
      return R;
    }
    if (p && p.tag === 'rkcbEnd') { R.push(rule('P', () => true, NONE(), '尊重問叫者的決定', { state: 'slam' })); return R; }
    if (p && p.tag === 'quant' && ctx.rhoLast && ctx.rhoLast.call === 'P') {
      const my = ctx.info[ctx.seat].hcp;
      const mid = (my[0] + Math.min(my[1], my[0] + 6)) / 2;
      R.push(rule('6N', h => h.hcp >= mid, NONE(), '高限，接受量化邀請', { state: 'slam' }));
      R.push(rule('P', () => true, NONE(), '低限，拒絕滿貫邀請', { state: 'slam' }));
      return R;
    }
    if (p && p.tag === 'negX' && ctx.iOpened && ctx.rhoLast.call === 'P') {
      const shownMaj = [2, 3].filter(t => ctx.info[ctx.pd].len[t][0] >= 4);
      const z = ctx.lastBid.strain, x = parseBid(ctx.opening.call).strain;
      for (const t of shownMaj) { const c = ctx.cheapest(t); if (c) { R.push(rule(bidCall(Math.min(4, Number(c[0]) + 1), t), h => h.len[t] >= 4 && h.tp >= 16, M(15, 21, { [t]: [4, 13] }), `負加倍後跳叫${SN[t]}：四張支持、16+`, { state: 'rebid' })); R.push(rule(c, h => h.len[t] >= 4, M(11, 15, { [t]: [4, 13] }), `負加倍後叫${SN[t]}：四張支持`, { state: 'rebid' })); } }
      R.push(rule(ctx.cheapest(4) || 'none', h => h.semi && (z === 4 || h.stop[z]) && ctx.cheapLevel(4) <= 2, M(11, 15), `${SN[z]}有止張，無王`, { state: 'rebid' }));
      R.push(rule(ctx.cheapest(x) || 'none', h => h.len[x] >= 6 || (h.len[x] >= 5 && ctx.cheapLevel(x) <= 2), M(11, 15, { [x]: [5, 13] }), `再叫${SN[x]}`, { state: 'rebid' }));
      R.push(rule('P', h => z < 4 && h.len[z] >= 4 && h.top5[z] >= 3, M(11, 21, { [z]: [4, 13] }), '負加倍轉罰分：對方花色長且強', { state: 'rebid' }));
      for (const t of [3, 2, 1, 0]) if (t !== z) R.push(rule(ctx.cheapest(t) || 'none', h => h.len[t] >= 3 && ctx.cheapLevel(t) <= 2, NONE(), `叫出${SN[t]}`, { state: 'rebid' }));
      return R;
    }
    if (p && p.tag === 'michAsk') {
      R.push(rule('3D', h => h.len[1] > h.len[0], M(0, ALL, { 1: [5, 13] }), 'Michaels：低花是方塊', { state: 'convention' }));
      R.push(rule('3C', () => true, M(0, ALL, { 0: [5, 13] }), 'Michaels：低花是梅花', { state: 'convention' }));
      return R;
    }
    if (p && p.tag === 'ogust' && ctx.rhoLast.call === 'P') {
      const s = parseBid(ctx.mine.find(e => e.tag === 'weak2').call).strain;
      R.push(rule(isMajor(s) ? bidCall(4, s) : '3N', h => h.hcp >= 8, M(8, 10), '弱二高限', { state: 'convention' }));
      R.push(rule(bidCall(3, s), () => true, M(5, 7), '弱二低限', { state: 'convention' }));
      return R;
    }
    if (p && p.tag === 'cueRaise' && (ctx.rhoLast.call === 'P' || ctx.rhoLast.call === 'X')) {
      // partner cue-bid to show a good raise of my suit
      const mySuitE = ctx.myActions.find(e => isBid(e.call));
      if (mySuitE) {
        const s = parseBid(mySuitE.call).strain;
        if (s < 4) {
          R.push(rule(bidCall(4, s), h => isMajor(s) && (h.hcp >= 14 || (mySuitE.tag === 'open1M' && h.tp >= 14)), NONE(), '接受邀請：成局', { state: 'rebid' }));
          R.push(rule('3N', h => !isMajor(s) && h.hcp >= 14 && h.stop[parseBid(ctx.theirBids[0].call).strain] && ctx.can('3N'), NONE(), '3NT', { state: 'rebid' }));
          R.push(rule(ctx.cheapest(s) || 'none', () => true, NONE(), '低限：最低階叫回己花', { state: 'rebid' }));
        }
        return R;
      }
    }
    if (p && p.tag === 'jordan' && ctx.rhoLast.call === 'P') {
      const s = parseBid(ctx.opening.call).strain;
      R.push(rule(bidCall(4, s), h => h.tp >= 14, NONE(), '接受 Jordan 邀請：成局', { state: 'rebid' }));
      R.push(rule(bidCall(3, s), () => true, NONE(), '低限', { state: 'rebid' }));
      return R;
    }
    return null;
  }

  // ---------- natural fallback (later rounds, competition, odd auctions) ----------
  function strainPlan(ctx, h) {
    const pd = ctx.info[ctx.pd];
    const [lo, hi] = pd.hcp;
    const est = pdEstimate(ctx);
    let fit = -1, fitLen = 0;
    for (const s of [3, 2, 1, 0]) {
      const t = h.len[s] + pd.len[s][0];
      const known = pd.len[s][0] >= 3 || (ctx.pdActions.length === 0 && false);
      if (!known) continue;
      if (t >= 8 && (fit < 0 || (isMajor(s) && !isMajor(fit)) || (isMajor(s) === isMajor(fit) && t > fitLen))) { fit = s; fitLen = t; }
    }
    const theirs = ctx.theirStrains;
    const ntOK = h.semi && theirs.every(s => h.stop[s]) && !(fit >= 0 && isMajor(fit));
    // our own long suit
    const myLong = [3, 2, 1, 0].reduce((b, s) => h.len[s] > h.len[b] ? s : b, 3);
    let strain;
    if (fit >= 0 && isMajor(fit)) strain = fit;
    else if (ntOK) strain = 4;
    else if (fit >= 0) strain = fit;
    else if (h.len[myLong] >= 6) strain = myLong;
    else {
      const pdLong = [3, 2, 1, 0].reduce((b, s) => pd.len[s][0] > pd.len[b][0] ? s : b, 3);
      if (pd.len[pdLong][0] >= 6 && h.len[pdLong] >= 1) strain = pdLong;
      else if (pd.len[pdLong][0] >= 5 && h.len[pdLong] >= 2) strain = pdLong;
      else strain = h.semi || h.len[myLong] < 5 || ctx.theirStrains.length === 0 ? 4 : myLong;
    }
    const mine = strain < 4 && pd.len[strain][0] >= 3 ? supportPts(h, strain) : strain < 4 ? h.tp : h.hcp;
    const total = mine + est, min = mine + lo, max = mine + Math.min(hi, ALL);
    const trumps = strain < 4 ? h.len[strain] + pd.len[strain][0] : 0;
    return { strain, fit, fitLen, total, min, max, mine, trumps, est };
  }
  function targetLevel(strain, pts) {
    if (pts >= 37) return 7;
    if (pts >= 33) return 6;
    if (strain === 4) return pts >= 25 ? 3 : pts >= 23 ? 2 : 1;
    if (isMajor(strain)) return pts >= 25 ? 4 : pts >= 22 ? 3 : 2;
    return pts >= 28 ? 5 : pts >= 23 ? 3 : 2;
  }
  function naturalDecide(ctx, h, profile) {
    const risk = profile.risk, my = side(ctx.seat);
    const lb = ctx.lastBid;
    const weHold = lb && side(lb.seat) === my;
    const plan = strainPlan(ctx, h);
    const pass = (text, m) => ({ call: 'P', text, m: m || NONE(), state: 'rebid' });
    const bidIf = (call, text, extra = {}) => call && ctx.can(call) ? { call, text, m: extra.m || NONE(), tag: extra.tag || '', force: extra.force || 0, trump: extra.trump, state: extra.state || (weHold || !lb ? 'rebid' : 'competition') } : null;
    const gameLevel = s => s === 4 ? 3 : isMajor(s) ? 4 : 5;
    const ourLevel = weHold ? lb.level : 0;
    const gfPending = ctx.gf && (!weHold || lb.level < gameLevel(lb.strain)) && !(weHold && lb.strain === 4 && lb.level >= 3);
    const mustBid = (ctx.forced && ctx.pdLast && ctx.pdLast.call !== 'P' && weHold) || gfPending;

    // slam exploration
    if (!ctx.usedRKCB && plan.strain < 4 && plan.fit === plan.strain && plan.total >= 33 && ctx.can('4N') && (!lb || bidIndex(bidCall(lb.level, lb.strain)) < bidIndex('4N')) && (weHold || !lb || lb.level <= 4) && h.aces + 0 >= 1) {
      const d = bidIf('4N', `RKCB 1430：聯手約 ${Math.round(plan.total)} 點，問關鍵張（王牌${SN[plan.strain]}）`, { tag: 'rkcb', trump: plan.strain, state: 'slam' });
      if (d) return d;
    }
    if (plan.strain === 4 && plan.min >= 33 && ctx.can(plan.min >= 37 ? '7N' : '6N')) return bidIf(plan.min >= 37 ? '7N' : '6N', '聯手 33+ 點：無王滿貫', { state: 'slam' });

    let target = targetLevel(plan.strain, plan.total);
    if (plan.strain < 4 && !isMajor(plan.strain) && target >= 4 && target < 6 && h.semi && ctx.theirStrains.every(s => h.stop[s]) && plan.total < 29) { plan.strain = 4; target = 3; }

    // opponents hold the auction
    if (lb && !weHold) {
      const z = lb.strain, L = lb.level;
      const theyGame = (z === 4 && L >= 3) || (isMajor(z) && L >= 4) || L >= 5;
      // penalty double
      if (ctx.can('X')) {
        const ourStrains = ctx.ourBids.map(e => parseBid(e.call).strain);
        const artificial = ourStrains.includes(z) || /cue|mich|unusual|xfer|stayman|rkcb|jacoby/i.test((ctx.entries.find(e => e.index === ctx.entries.length - 1 && false) || {}).tag || '') || /cue|mich|unusual|xfer|stayman|rkcb|jacoby|2cWait|open2c/.test((ctx.bids[ctx.bids.length - 1] || {}).tag || '');
        const stack = !artificial && z < 4 && h.len[z] >= 4 && h.top5[z] >= 2;
        if (!artificial && ((L >= 2 && stack && plan.total >= 20 - risk) || (theyGame && plan.total >= 26 - (stack ? 3 : 0)) || (L >= 3 && plan.total >= 24 && h.len[z] >= 3 && plan.fit < 0)))
          return { call: 'X', text: stack ? `罰分加倍：${SN[z]}長且有大牌，聯手點力占優` : '罰分加倍：聯手點力明顯占優', m: M(8, ALL), state: 'competition' };
      }
      if (plan.strain < 4 && plan.fit === plan.strain) {
        const ltt = plan.trumps - 6 + (risk >= 2 ? 1 : 0) - (risk === 0 && ctx.vulWe ? 1 : 0);
        const want = Math.max(Math.min(target, 7), plan.total >= 19 ? ltt : 0);
        const c = ctx.cheapest(plan.strain);
        if (c && Number(c[0]) <= want) return bidIf(c, Number(c[0]) >= gameLevel(plan.strain) && target >= gameLevel(plan.strain) ? `${SN[plan.strain]}配合，聯手實力足以成局` : `總墩數定律：雙方 ${plan.trumps} 張王牌，競叫到 ${Number(c[0])} 階`, { m: M(0, ALL, { [plan.strain]: [3, 13] }) });
        // sacrifice
        if (theyGame && c && risk >= 1 && plan.trumps >= 10 - (risk >= 2 ? 1 : 0) && !ctx.vulWe && plan.total <= 23 && Number(c[0]) <= 5) return bidIf(c, '有利身價犧牲叫：對方成局，我方大配合', { m: M(0, ALL, { [plan.strain]: [4, 13] }) });
      }
      if (!ctx.pdActions.length && !ctx.myActions.length) return pass('沒有合適的競叫');
      // free bid with a good long suit
      const ls = h.longest;
      const c = ctx.cheapest(ls);
      if (c && h.len[ls] >= 6 && Number(c[0]) <= 3 && h.hcp >= 8 && okSuit(h, ls) && !ctx.theirStrains.includes(ls)) return bidIf(c, `自由叫出六張${SN[ls]}`, { m: M(8, ALL, { [ls]: [6, 13] }) });
      if (plan.strain === 4 && plan.total >= 25 && ctx.can('3N') && ctx.theirStrains.every(s => h.stop[s])) return bidIf('3N', '各門有止張，3NT');
      return pass(mustBid ? '對方插叫解除迫叫' : '競叫空間不足，Pass');
    }

    // partner invited: accept with the upper half of what I have shown
    if (weHold && ctx.pdLast && ctx.pdLast.inv && lb.seat === ctx.pd && !mustBid) {
      const shownR = ctx.info[ctx.seat].hcp, mid = (shownR[0] + Math.min(shownR[1], shownR[0] + 8)) / 2;
      const pb = parseBid(ctx.pdLast.call), val = pb.strain < 4 && h.len[pb.strain] >= 3 ? Math.max(h.hcp, supportPts(h, pb.strain) - 1) : h.hcp;
      if (val >= mid) {
        const g = pb.strain === 4 ? '3N' : isMajor(pb.strain) ? bidCall(4, pb.strain) : (h.semi && ctx.theirStrains.every(t => h.stop[t]) ? '3N' : bidCall(5, pb.strain));
        if (ctx.can(g)) return { call: g, text: '接受邀請：我在已表達範圍的上半', m: NONE(), state: 'rebid' };
      }
      return pass('拒絕邀請：我在已表達範圍的下半');
    }
    // we hold the contract or nothing bid yet
    const s = plan.strain;
    const shown = ctx.info[ctx.seat].hcp;
    if (weHold && ctx.myActions.length + ctx.mine.length > 0 && shown[1] - shown[0] <= 12 && !mustBid && ctx.pdLast && ctx.pdLast.call !== 'P') {
      // partner already placed the contract using my shown range; bid on only with extra values
      const mid = (shown[0] + Math.min(shown[1], shown[0] + 8)) / 2;
      const asShown = targetLevel(s, plan.total - (plan.mine - mid));
      if (targetLevel(s, plan.total) <= asShown && lb.level >= Math.min(asShown, gameLevel(lb.strain))) return pass('搭檔已依我表達的實力定約');
    }
    const cur = weHold ? lb : null;
    const reached = cur && ((cur.strain === s && cur.level >= target) || (cur.level >= gameLevel(cur.strain) && target <= gameLevel(s) && target >= gameLevel(cur.strain) - (cur.strain === 4 ? 0 : 1) && cur.level >= Math.min(target, gameLevel(cur.strain))));
    if (reached && !mustBid) return pass('合約已符合聯手實力');
    if (cur && cur.level >= 6 && !mustBid) return pass('已在滿貫');
    const want = bidCall(Math.min(7, target), s);
    if (ctx.can(want) && (!cur || bidIndex(want) > bidIndex(bidCall(cur.level, cur.strain)))) {
      const lvl = Number(want[0]), g = gameLevel(s);
      const text = lvl >= 6 ? '聯手實力足以滿貫' : lvl >= g ? (s === 4 ? '聯手約 25 點以上，成局 3NT' : `${SN[s]}${plan.fit === s ? '配合' : '長門'}，聯手實力成局`) : lvl === g - 1 && !ctx.gf ? `${s === 4 ? '無王' : SN[s]}，邀請成局` : `自然叫：${s === 4 ? '無王' : SN[s]}`;
      // do not jump past game for a mere preference
      return bidIf(want, text, { m: s < 4 ? M(0, ALL, { [s]: [plan.fit === s ? 2 : 4, 13] }) : M(0, ALL) });
    }
    if (mustBid) {
      // cheapest descriptive bid
      const opts = [];
      const pd = ctx.info[ctx.pd];
      if (s < 4) opts.push([ctx.cheapest(s), `叫出${SN[s]}`]);
      const pdFirst = ctx.pdActions.find(e => isBid(e.call) && parseBid(e.call).strain < 4);
      if (pdFirst) { const ps = parseBid(pdFirst.call).strain; if (h.len[ps] >= 2) opts.push([ctx.cheapest(ps), `回到搭檔的${SN[ps]}`]); }
      if (h.semi) opts.push([ctx.cheapest(4), '無王']);
      opts.push([ctx.cheapest(h.longest), `再叫長門${SN[h.longest]}`]);
      for (let t = 0; t < 4; t++) if (h.len[t] >= 4 && pd.len[t][0] < 4) opts.push([ctx.cheapest(t), `新花${SN[t]}`]);
      const valid = opts.filter(([c]) => c && ctx.can(c)).sort((a, b) => bidIndex(a[0]) - bidIndex(b[0]));
      const capped = valid.filter(([c]) => Number(c[0]) <= Math.max(gameLevel(s), 4));
      const pick = capped[0] || valid[0];
      if (pick) return bidIf(pick[0], `迫叫中：${pick[1]}`, { state: 'forcing' });
    }
    return pass(cur ? '停在目前合約' : '牌力不足以行動');
  }

  // ---------- naturals for inference of unexpected calls ----------
  function naturalMeaning(ctx, call) {
    if (call === 'P') return { m: NONE(), text: 'Pass', tag: '' };
    if (call === 'X' || call === 'XX') return { m: M(8, ALL), text: call === 'X' ? '加倍' : '再加倍', tag: '' };
    const b = parseBid(call);
    if (b.strain === 4) return { m: M(b.level >= 3 ? 10 : 6, ALL), text: '自然無王', tag: b.level === 2 && !ctx.gf && ctx.ourBids.length && !ctx.entries.some(e => side(e.seat) !== side(ctx.seat) && e.call !== 'P') ? 'inv' : '' };
    const pdShown = ctx.info[ctx.pd].len[b.strain][0] >= 4;
    const contestedAny = ctx.entries.some(e => side(e.seat) !== side(ctx.seat) && e.call !== 'P');
    const inv = !contestedAny && side(ctx.lastBid ? ctx.lastBid.seat : ctx.seat) === side(ctx.seat) && ((isMajor(b.strain) && b.level === 3) || (b.strain === 4 && b.level === 2)) && !ctx.gf;
    const contested = ctx.theirBids.length > 0;
    return { m: M(contested ? 0 : b.level >= 3 ? 8 : 5, ALL, { [b.strain]: [pdShown ? 3 : b.level >= 2 ? 5 : 4, 13] }), text: pdShown ? `支持${SN[b.strain]}` : `自然叫：${SN[b.strain]}長門`, tag: inv ? 'inv' : '' };
  }

  // ---------- dispatcher ----------
  function systemRules(ctx, profile) {
    if (!ctx.opening) return openingRules(ctx, profile);
    const out = [];
    const push = r => { if (r) out.push(...r.filter(x => x.call && x.call !== 'none')); };
    push(slamRules(ctx));
    if (out.length) return out;
    push(ntContinuations(ctx));
    if (out.length) return out;
    if (ctx.weOpened) {
      if (ctx.iOpened && ctx.myActions.length === 1) push(openerRebids(ctx));
      else if (!ctx.iOpened && ctx.myActions.length === 0 && ctx.pdActions.length === 1 && ctx.pdLast === ctx.opening) {
        const t = ctx.opening.tag, rho = ctx.rhoLast;
        if (rho.call === 'P') {
          if (t === 'open1nt') push(ntResponses(ctx, 1, 15, 17, '開叫'));
          else if (t === 'open2nt') push(ntResponses(ctx, 2, 20, 21, '開叫'));
          else if (t === 'open2c') push(strong2cResponses(ctx));
          else if (t === 'open1M') push(majorResponses(ctx));
          else if (t === 'open1m') push(minorResponses(ctx));
          else if (t === 'weak2') push(weakTwoResponses(ctx));
          else if (t === 'pre3' || t === 'pre4') push(preemptResponses(ctx));
        } else if (['open1M', 'open1m', 'open1nt'].includes(t)) push(contestedResponses(ctx));
      } else if (!ctx.iOpened && ctx.myLast && ctx.myLast.tag === '2cWait' && ctx.pdLast && ctx.pdLast.tag === '2c-2nt' && ctx.rhoLast.call === 'P') {
        push(ntResponses(ctx, 2, 22, 24, '開叫'));
      } else if (!ctx.iOpened && ctx.myLast && ctx.myLast.tag === '2cWait' && ctx.pdLast && ctx.pdLast.tag === '2cSuit') {
        const s = parseBid(ctx.pdLast.call).strain;
        if (isMajor(s)) out.push(rule(bidCall(3, s), h => h.len[s] >= 3, M(0, ALL, { [s]: [3, 13] }), `支持${SN[s]}（成局迫叫中）`, { state: 'forcing' }));
      }
    } else if (ctx.myActions.length === 0 && ctx.pdActions.length === 0) push(overcallRules(ctx, profile));
    else if (ctx.myActions.length === 0 && ctx.pdActions.length === 1) push(advanceRules(ctx));
    out.push({ dynamic: true });
    return out;
  }

  function agreedTrump(ctx) {
    const a = ctx.info[ctx.seat], b = ctx.info[ctx.pd];
    for (const s of [3, 2, 1, 0]) if (a.len[s][0] + b.len[s][0] >= 8) return s;
    const ours = ctx.ourBids.filter(e => parseBid(e.call).strain < 4);
    return ours.length ? parseBid(ours[ours.length - 1].call).strain : 3;
  }
  function unionRules(rs) {
    if (rs.length === 1) return rs[0];
    const m = { hcp: [Math.min(...rs.map(r => r.m.hcp[0])), Math.max(...rs.map(r => r.m.hcp[1]))], len: [0, 1, 2, 3].map(s => [Math.min(...rs.map(r => r.m.len[s][0])), Math.max(...rs.map(r => r.m.len[s][1]))]), bal: rs.every(r => r.m.bal) };
    const lastR = rs[rs.length - 1];
    return { ...lastR, m, tag: rs.every(r => r.tag === rs[0].tag) ? rs[0].tag : lastR.tag, force: rs.every(r => r.force) ? rs[0].force : 0, text: rs.length > 1 && rs[0].text !== lastR.text ? rs[0].text + '；或' + lastR.text : lastR.text };
  }
  function contextFor(view) { return replay(view.auction, view.dealer, view.vulnerability, view.seat); }
  const replayCache = new Map();
  function replay(auction, dealer, vulnerability, forSeat) {
    const key = dealer + '|' + vulnerability + '|' + auction.map(a => a.call).join(',');
    let st = replayCache.get(key);
    if (!st) {
      const base = { dealer, vulnerability };
      const info = [0, 1, 2, 3].map(freshInfo);
      const entries = [];
      for (let i = 0; i < auction.length; i++) {
        const a = auction[i];
        const ctx = makeCtx(base, entries, info, a.seat);
        const rules = systemRules(ctx, B.PROFILES[a.seat] || B.PROFILES[0]);
        const matches = rules.filter(x => !x.dynamic && x.call === a.call);
        const r = matches.length ? unionRules(matches) : null;
        if (r && matches.some(x => x.inv)) r.inv = true;
        const nat = r ? null : naturalMeaning(ctx, a.call);
        const entry = { index: i, seat: a.seat, call: a.call, tag: r ? r.tag : (a.call === '4N' && ctx.lastBid && ctx.lastBid.level >= 3 && side(ctx.lastBid.seat) === side(a.seat) && ctx.lastBid.strain < 4 ? 'rkcb' : ''), text: r ? r.text : nat.text, m: r ? r.m : nat.m, force: r ? r.force : 0, trump: r ? r.trump : agreedTrump(ctx), kc: r ? r.kc : undefined, state: r ? r.state : '', inv: r ? !!r.inv : nat.tag === 'inv' };
        entries.push(entry);
        info[a.seat] = intersect(info[a.seat], entry.m);
      }
      st = { base, info, entries };
      if (replayCache.size > 400) replayCache.clear();
      replayCache.set(key, st);
    }
    return makeCtx(st.base, st.entries.slice(), st.info.map(x => ({ hcp: x.hcp.slice(), len: x.len.map(y => y.slice()), bal: x.bal })), forSeat);
  }

  function chooseBid(view, profile = B.PROFILES[view.seat]) {
    if (view.phase !== 'auction') return null;
    const ctx = contextFor(view);
    const h = evaluate(view.hand);
    const rules = systemRules(ctx, profile || B.PROFILES[0]);
    for (const r of rules) {
      if (r.dynamic) {
        const d = naturalDecide(ctx, h, profile || B.PROFILES[0]);
        if (d && view.legalCalls.includes(d.call)) return { call: d.call, reason: d.text, state: d.state || 'rebid', tag: d.tag || '', meaning: d.m };
        continue;
      }
      if (!view.legalCalls.includes(r.call)) continue;
      if (r.cond(h)) return { call: r.call, reason: r.text, state: ctx.forced && r.call !== 'P' && r.state === 'rebid' ? 'forcing' : r.state || 'rebid', tag: r.tag, meaning: r.m };
    }
    return { call: 'P', reason: '沒有合適叫品', state: 'rebid', tag: '', meaning: NONE() };
  }
  /** Annotated public auction: one entry per call with system meaning and inferred hand ranges. */
  function explainAuction(auction, dealer, vulnerability) {
    const ctx = replay(auction, dealer, vulnerability, 0);
    return { calls: ctx.entries.map(e => ({ seat: e.seat, call: e.call, text: e.text, tag: e.tag, hcp: e.m.hcp.slice(), len: e.m.len.map(x => x.slice()), forcing: e.force })), hands: ctx.info };
  }
  function inferHands(view) { return contextFor(view).info; }
  function describeMeaning(m) {
    const parts = [];
    const [lo, hi] = m.hcp;
    if (lo > 0 || hi < ALL) parts.push(hi >= ALL ? `${lo}+ 點` : `${lo}–${hi} 點`);
    m.len.forEach(([a, b], s) => { if (a > 0 && b < 13) parts.push(a === b ? `${SN[s]} ${a} 張` : `${SN[s]} ${a}–${b} 張`); else if (a > 0) parts.push(`${SN[s]} ${a}+ 張`); else if (b < 13) parts.push(`${SN[s]} ≤${b} 張`); });
    if (m.bal) parts.push('均型');
    return parts.join('、');
  }
  return { evaluate, supportPts, chooseBid, explainAuction, inferHands, contextFor, describeMeaning, systemRules };
});
