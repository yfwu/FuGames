/* FuGames bridge rules core: deals, auction legality, play, duplicate scoring and the public AI view.
 * AI lives in bridge-bidding.js (system + auction inference) and bridge-play.js (sampling + double dummy).
 */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.Bridge = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const SUITS = ['♣', '♦', '♥', '♠', 'NT'], SEATS = ['北', '東', '南', '西'];
  const VUL_CYCLE = ['none', 'NS', 'EW', 'both', 'NS', 'EW', 'both', 'none', 'EW', 'both', 'none', 'NS', 'both', 'none', 'NS', 'EW'];
  // risk: competitive aggression (overcalls, preempts, law-of-total-tricks margin, sacrifices)
  const PROFILES = [
    { name: '穩健', risk: 0, style: '守約型：按牌力定約，少冒險加倍' },
    { name: '計算', risk: 1, style: '總墩數定律競叫，精算身價' },
    { name: '穩健', risk: 0, style: '守約型' },
    { name: '進取', risk: 2, style: '積極阻擊與犧牲叫' }
  ];
  const suit = c => Math.floor(c / 13), rank = c => c % 13 + 2, side = seat => seat % 2, partner = seat => (seat + 2) % 4;
  const RANKS = { 10: 'T', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  const rankLabel = r => (r === 10 ? '10' : RANKS[r] || String(r));
  const cardLabel = c => SUITS[suit(c)] + rankLabel(rank(c));
  const bidIndex = c => (Number(c[0]) - 1) * 5 + 'CDHSN'.indexOf(c[1]);
  const isBid = c => typeof c === 'string' && /^[1-7][CDHSN]$/.test(c);
  const callLabel = c => c === 'P' ? 'Pass' : c === 'X' ? 'X' : c === 'XX' ? 'XX' : c[0] + SUITS['CDHSN'.indexOf(c[1])];
  const parseBid = c => ({ level: Number(c[0]), strain: 'CDHSN'.indexOf(c[1]) });
  const bidCall = (level, strain) => String(level) + 'CDHSN'[strain];

  function rng(seed) { let n = seed >>> 0; return () => { n += 0x6D2B79F5; let t = n; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function makeDeal(seed = 1) { const random = rng(seed), deck = Array.from({ length: 52 }, (_, i) => i); for (let i = 51; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; } return freezeDeal(Array.from({ length: 4 }, (_, s) => deck.filter((_, i) => i % 4 === s))); }
  function freezeDeal(deal) {
    if (!Array.isArray(deal) || deal.length !== 4 || deal.some(h => !Array.isArray(h) || h.length !== 13)) throw Error('發牌必須每家 13 張');
    const all = deal.flat();
    if (new Set(all).size !== 52 || all.some(c => !Number.isInteger(c) || c < 0 || c > 51)) throw Error('牌必須為 52 張不重複牌');
    return Object.freeze(deal.map(h => Object.freeze(h.slice().sort((a, b) => b - a))));
  }
  function createGame(deal = makeDeal(), board = 1) {
    if (!Number.isInteger(board) || board < 1) throw Error('牌號必須為正整數');
    const immutable = freezeDeal(deal);
    return { deal: immutable, board, dealer: (board - 1) % 4, vulnerability: VUL_CYCLE[(board - 1) % 16], phase: 'auction', turn: (board - 1) % 4, hands: immutable.map(h => h.slice()), auction: [], lastBid: null, multiplier: 1, passes: 0, contract: null, dummyVisible: false, trick: [], lastTrick: [], history: [], played: [], voids: Array.from({ length: 4 }, () => Array(4).fill(false)), tricks: [0, 0], score: null };
  }
  function legalCalls(g) {
    if (g.phase !== 'auction') return [];
    const calls = ['P'], floor = g.lastBid ? bidIndex(bidCall(g.lastBid.level, g.lastBid.strain)) : -1;
    for (let i = floor + 1; i < 35; i++) calls.push(bidCall(Math.floor(i / 5) + 1, i % 5));
    if (g.lastBid) {
      if (g.multiplier === 1 && side(g.turn) !== side(g.lastBid.seat)) calls.push('X');
      if (g.multiplier === 2 && side(g.turn) === side(g.lastBid.seat)) calls.push('XX');
    }
    return calls;
  }
  function applyCall(g, call, reason = '') {
    if (!legalCalls(g).includes(call)) return false;
    const seat = g.turn;
    g.auction.push({ seat, call, reason: String(reason) });
    if (call === 'P') g.passes++;
    else { g.passes = 0; if (isBid(call)) { g.lastBid = { ...parseBid(call), seat }; g.multiplier = 1; } else g.multiplier = call === 'X' ? 2 : 4; }
    g.turn = (g.turn + 1) % 4;
    if (!g.lastBid && g.passes === 4) { g.phase = 'complete'; g.score = 0; return true; }
    if (g.lastBid && g.passes === 3) {
      const b = g.lastBid, declarer = g.auction.find(a => isBid(a.call) && side(a.seat) === side(b.seat) && parseBid(a.call).strain === b.strain).seat;
      g.contract = { level: b.level, strain: b.strain, multiplier: g.multiplier, declarer, dummy: partner(declarer), side: side(declarer) };
      g.phase = 'play'; g.turn = (declarer + 1) % 4;
    }
    return true;
  }
  function legalCards(g, seat = g.turn) {
    if (g.phase !== 'play' || seat !== g.turn) return [];
    const h = g.hands[seat];
    if (!g.trick.length) return h.slice();
    const follow = h.filter(c => suit(c) === suit(g.trick[0].card));
    return follow.length ? follow : h.slice();
  }
  function winner(trick, trump = 4) {
    if (!trick.length) return null;
    return trick.reduce((best, p) => { const s = suit(p.card), bs = suit(best.card); return s === bs ? rank(p.card) > rank(best.card) ? p : best : s === trump ? p : bs === trump ? best : best; }).seat;
  }
  function vulnerable(vulnerability, team) { return vulnerability === 'both' || vulnerability === (team === 0 ? 'NS' : 'EW'); }
  function scoreContract(contract, taken, isVulnerable = false) {
    const { level, strain, multiplier: m = 1 } = contract, target = level + 6, over = taken - target;
    if (!Number.isInteger(level) || level < 1 || level > 7 || !Number.isInteger(strain) || strain < 0 || strain > 4 || ![1, 2, 4].includes(m) || !Number.isInteger(taken) || taken < 0 || taken > 13) throw Error('不合法合約或墩數');
    if (over < 0) { const down = -over; if (m === 1) return -down * (isVulnerable ? 100 : 50); const penalty = isVulnerable ? 200 + Math.max(0, down - 1) * 300 : 100 + Math.min(2, down - 1) * 200 + Math.max(0, down - 3) * 300; return -penalty * (m === 4 ? 2 : 1); }
    const base = (strain < 2 ? 20 * level : strain === 4 ? 30 * level + 10 : 30 * level) * m;
    const game = base >= 100 ? (isVulnerable ? 500 : 300) : 50;
    const slam = level === 6 ? (isVulnerable ? 750 : 500) : level === 7 ? (isVulnerable ? 1500 : 1000) : 0;
    const insult = m === 2 ? 50 : m === 4 ? 100 : 0;
    const overtricks = over * (m === 1 ? (strain < 2 ? 20 : 30) : (isVulnerable ? 200 : 100) * (m === 4 ? 2 : 1));
    return base + game + slam + insult + overtricks;
  }
  function playCard(g, card) {
    if (!legalCards(g).includes(card)) return false;
    const seat = g.turn;
    if (g.trick.length && suit(card) !== suit(g.trick[0].card)) g.voids[seat][suit(g.trick[0].card)] = true;
    g.hands[seat].splice(g.hands[seat].indexOf(card), 1);
    g.trick.push({ seat, card }); g.played.push({ seat, card });
    if (!g.dummyVisible) g.dummyVisible = true;
    if (g.trick.length === 4) {
      const won = winner(g.trick, g.contract.strain);
      g.tricks[side(won)]++;
      g.lastTrick = g.trick.map(p => ({ ...p }));
      g.history.push({ cards: g.lastTrick.map(p => ({ ...p })), winner: won });
      g.trick = []; g.turn = won;
      if (g.played.length === 52) {
        g.phase = 'complete';
        const declarerScore = scoreContract(g.contract, g.tricks[g.contract.side], vulnerable(g.vulnerability, g.contract.side));
        g.score = declarerScore * (g.contract.side === 0 ? 1 : -1);
      }
    } else g.turn = (seat + 1) % 4;
    return true;
  }
  // The sole AI boundary. Never pass a Game or hidden-hand closure to an AI.
  function viewFor(g, seat = g.turn) {
    const knownHands = {};
    knownHands[seat] = g.hands[seat].slice();
    if (g.phase !== 'auction' && g.contract && g.dummyVisible) {
      knownHands[g.contract.dummy] = g.hands[g.contract.dummy].slice();
      if (seat === g.contract.dummy) knownHands[g.contract.declarer] = g.hands[g.contract.declarer].slice();
    }
    return {
      seat, phase: g.phase, board: g.board, dealer: g.dealer, vulnerability: g.vulnerability, hand: g.hands[seat].slice(), knownHands,
      auction: g.auction.map(a => ({ seat: a.seat, call: a.call })), lastBid: g.lastBid ? { ...g.lastBid } : null, multiplier: g.multiplier,
      legalCalls: seat === g.turn ? legalCalls(g) : [], legalCards: seat === g.turn ? legalCards(g) : [], contract: g.contract ? { ...g.contract } : null,
      dummyVisible: g.dummyVisible, trick: g.trick.map(p => ({ ...p })), played: g.played.map(p => ({ ...p })), voids: g.voids.map(v => v.slice()), tricks: g.tricks.slice(),
      history: g.history.map(h => ({ cards: h.cards.map(p => ({ ...p })), winner: h.winner }))
    };
  }
  function shape(hand) {
    const lengths = [0, 0, 0, 0]; let hcp = 0;
    hand.forEach(c => { lengths[suit(c)]++; hcp += Math.max(0, rank(c) - 10); });
    const pattern = lengths.slice().sort((a, b) => b - a).join('');
    return { lengths, hcp, balanced: ['4333', '4432', '5332'].includes(pattern) };
  }
  function ai() { return (typeof globalThis !== 'undefined' && globalThis.BridgeAI) || (typeof require === 'function' ? require('./bridge-ai.js') : null); }
  function chooseBid(view, profile) { return ai().chooseBid(view, profile); }
  function chooseCard(view, profile, opts) { return ai().chooseCard(view, profile, opts); }
  function simulate(deal, board = 1, opts = {}) {
    const game = createGame(deal, board);
    let calls = 0;
    while (game.phase === 'auction') { const d = chooseBid(viewFor(game)); if (!d || !applyCall(game, d.call, d.reason)) throw Error('AI 叫牌不合法'); if (++calls > 400) throw Error('叫牌未收斂'); }
    while (game.phase === 'play') { const d = chooseCard(viewFor(game), undefined, opts); if (!d || !playCard(game, d.card)) throw Error('AI 出牌不合法'); }
    return game;
  }
  function matchpoints(score, references) { return references.length ? references.reduce((p, s) => p + (score > s ? 2 : score === s ? 1 : 0), 0) / (2 * references.length) * 100 : null; }
  return { SUITS, SEATS, VUL_CYCLE, PROFILES, suit, rank, side, partner, rankLabel, cardLabel, bidIndex, isBid, callLabel, parseBid, bidCall, rng, makeDeal, freezeDeal, createGame, legalCalls, applyCall, legalCards, winner, vulnerable, scoreContract, playCard, viewFor, shape, chooseBid, chooseCard, simulate, matchpoints };
});
