/* FuGames bridge double-dummy solver.
 * Null-window alpha-beta over whole tricks with:
 *  - rank-equivalence move pruning (touching cards collapse; cards already played count as gaps),
 *  - a transposition table keyed by relative-rank ownership at trick boundaries (shared across samples),
 *  - quick-trick bounds for the side on lead, history heuristic and bridge-aware move ordering,
 *  - MTD-style value search that starts from a guess.
 * Card ids match bridge-engine.js: card = suit * 13 + (rank - 2); suits C,D,H,S = 0..3, trump 4 = NT.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BridgeDDS = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  class SearchAbort extends Error {}
  const HW = 0; // history heuristic measured as harmful here

  const POP = new Uint8Array(1 << 13);
  for (let i = 1; i < POP.length; i++) POP[i] = POP[i >> 1] + (i & 1);
  const HIGH = new Int8Array(1 << 13);
  HIGH[0] = -1;
  for (let i = 1; i < HIGH.length; i++) HIGH[i] = 31 - Math.clz32(i);

  function createSolver() {
    const H = new Int32Array(16);              // seat * 4 + suit -> 13-bit rank mask
    const rem = new Int32Array(4);             // live cards per suit, including the current trick
    const LV = 15;                             // trick levels
    const tSeat = new Int32Array(LV * 4), tSuit = new Int32Array(LV * 4), tRank = new Int32Array(LV * 4);
    const MAXD = 60;
    const moveSuit = new Int32Array(MAXD * 13), moveRank = new Int32Array(MAXD * 13), moveScore = new Float64Array(MAXD * 13);
    const hist = new Float64Array(4 * 52);
    let trump = 4, maxSide = 0, nodes = 0, nodeLimit = Infinity;
    const tt = new Map();
    let ttTrump = -1, ttSide = -1;

    function ttKey(leader) {
      let h1 = 0x811c9dc5 ^ leader, h2 = 0x9e3779b9 + leader * 7919;
      for (let s = 0; s < 4; s++) {
        let code = 1;
        const live = rem[s], a = H[s], b1 = H[4 + s], b2 = H[8 + s];
        for (let b = 12; b >= 0; b--) {
          const bit = 1 << b;
          if (!(live & bit)) continue;
          code = (code << 2) | ((a & bit) ? 0 : (b1 & bit) ? 1 : (b2 & bit) ? 2 : 3);
          if (code > 0x3fffff) { h1 = Math.imul(h1 ^ code, 0x01000193); h2 = Math.imul(h2 ^ code, 0x5bd1e995); h2 ^= h2 >>> 15; code = 1; }
        }
        h1 = Math.imul(h1 ^ code, 0x01000193) ^ (s + 1);
        h2 = Math.imul(h2 ^ code, 0x5bd1e995);
        h2 ^= h2 >>> 13;
      }
      return (h1 >>> 0) * 2097152 + ((h2 >>> 11) & 0x1fffff);
    }

    // Tricks the side on lead can cash at once from the leader's hand (plus partner's tops reachable by a low lead).
    function quickTricks(leader) {
      const o1 = (leader + 1) & 3, o2 = (leader + 3) & 3, p = (leader + 2) & 3;
      const oppTrump1 = trump < 4 && H[o1 * 4 + trump] !== 0, oppTrump2 = trump < 4 && H[o2 * 4 + trump] !== 0;
      let qt = 0, viaPartner = 0;
      for (let s = 0; s < 4; s++) {
        const mine = H[leader * 4 + s];
        if (!mine) continue;
        const live = rem[s], part = H[p * 4 + s];
        let k = 0;
        for (let b = 12; b >= 0; b--) {
          const bit = 1 << b;
          if (!(live & bit)) continue;
          if (mine & bit) k++;
          else break;
        }
        if (!k) {
          // low lead to partner's master: one trick when the suit is safe from ruffs
          if (!part || !(part & (1 << HIGH[live]))) continue;
          if (trump < 4 && s !== trump && ((oppTrump1 && !H[o1 * 4 + s]) || (oppTrump2 && !H[o2 * 4 + s]))) continue;
          viaPartner = 1; continue;
        }
        k = Math.min(k, POP[mine]);
        if (trump < 4 && s !== trump) {
          const l1 = oppTrump1 ? POP[H[o1 * 4 + s]] : 13, l2 = oppTrump2 ? POP[H[o2 * 4 + s]] : 13;
          k = Math.min(k, l1, l2);
        }
        qt += k;
      }
      return qt + viaPartner;
    }

    function genMoves(seat, pos, tb, base) {
      let n = 0;
      const ledSuit = pos ? tSuit[tb] : -1;
      let winSeat = -1, winSuit = -1, winRank = -1;
      if (pos) {
        winSeat = tSeat[tb]; winSuit = tSuit[tb]; winRank = tRank[tb];
        for (let i = 1; i < pos; i++) {
          const s = tSuit[tb + i];
          if (s === winSuit) { if (tRank[tb + i] > winRank) { winSeat = tSeat[tb + i]; winRank = tRank[tb + i]; } }
          else if (s === trump) { winSeat = tSeat[tb + i]; winSuit = trump; winRank = tRank[tb + i]; }
        }
      }
      const mySide = seat & 1, partnerWinning = pos > 0 && (winSeat & 1) === mySide;
      const follow = pos > 0 && H[seat * 4 + ledSuit] !== 0;
      const lho = (seat + 1) & 3, rho = (seat + 3) & 3, pard = (seat + 2) & 3;
      for (let s = 0; s < 4; s++) {
        if (follow && s !== ledSuit) continue;
        const m = H[seat * 4 + s];
        if (!m) continue;
        const live = rem[s], len = POP[m];
        let prevMine = false;
        for (let b = 12; b >= 0; b--) {
          const bit = 1 << b;
          if (!(live & bit)) continue;
          if (!(m & bit)) { prevMine = false; continue; }
          if (prevMine) continue;
          prevMine = true;
          let score;
          if (pos === 0) {
            const higher = live & ~((bit << 1) - 1);
            const pm = H[pard * 4 + s];
            const ruffRisk = trump < 4 && s !== trump && ((!H[lho * 4 + s] && H[lho * 4 + trump]) || (!H[rho * 4 + s] && H[rho * 4 + trump]));
            const partnerRuff = trump < 4 && s !== trump && !pm && H[pard * 4 + trump] && H[lho * 4 + s];
            if (!higher) score = 60 + len;                                   // cash a master
            else if (pm && (pm & (1 << HIGH[live]))) score = 45 - b;         // low to partner's master
            else if (partnerRuff) score = 40 - b;                            // give partner a ruff
            else {
              // lead through strength / up to weakness: prefer suits where LHO lacks the top
              const lhoTop = (H[lho * 4 + s] & (1 << HIGH[live])) !== 0;
              score = len * 1.5 - b * 0.5 + (lhoTop ? -6 : 3) + ((H[rho * 4 + s] & (1 << HIGH[live])) ? 4 : 0);
            }
            if (ruffRisk) score -= 60;
            if (trump < 4 && s === trump) {
              const ours = POP[H[seat * 4 + trump]] + POP[H[pard * 4 + trump]];
              const theirs = POP[H[lho * 4 + trump]] + POP[H[rho * 4 + trump]];
              score += theirs === 0 ? -20 : ours > theirs ? 10 : -6;
            }
          } else {
            const beats = (s === winSuit && b > winRank) || (s === trump && winSuit !== trump);
            if (!follow) {
              if (s === trump && trump < 4) score = partnerWinning ? -50 - b : (beats ? 80 - b : -40 - b);
              else score = -b + (len >= 3 ? 2 : -2) - (!(live & ~((bit << 1) - 1)) ? 15 : 0); // keep masters, shed low
            } else if (partnerWinning) {
              // partner winning: is partner's card safe from the remaining hand(s)?
              score = beats ? -20 - b : 20 - b;
              if (pos === 1 && beats) score = -30 - b;
            } else if (beats) {
              if (pos === 3) score = 100 - b;
              else if (pos === 2) {
                // third hand: win as cheaply as LHO can't overtake, else as high as useful
                const lm = H[lho * 4 + s];
                score = (lm & ~((bit << 1) - 1)) ? 60 + b : 90 - b;
              } else score = 30 - b;                                           // second hand: low first
            } else score = (pos === 1 ? 40 : 10) - b;
          }
          score += HW * hist[seat * 52 + s * 13 + b];
          const idx = base + n;
          moveSuit[idx] = s; moveRank[idx] = b; moveScore[idx] = score;
          n++;
        }
      }
      for (let i = 1; i < n; i++) {
        const sc = moveScore[base + i], ss = moveSuit[base + i], sr = moveRank[base + i];
        let j = i - 1;
        while (j >= 0 && moveScore[base + j] < sc) {
          moveScore[base + j + 1] = moveScore[base + j]; moveSuit[base + j + 1] = moveSuit[base + j]; moveRank[base + j + 1] = moveRank[base + j];
          j--;
        }
        moveScore[base + j + 1] = sc; moveSuit[base + j + 1] = ss; moveRank[base + j + 1] = sr;
      }
      return n;
    }

    function trickWinner(tb) {
      let ws = tSeat[tb], su = tSuit[tb], r = tRank[tb];
      for (let i = 1; i < 4; i++) {
        const s = tSuit[tb + i];
        if (s === su) { if (tRank[tb + i] > r) { ws = tSeat[tb + i]; r = tRank[tb + i]; } }
        else if (s === trump) { ws = tSeat[tb + i]; su = trump; r = tRank[tb + i]; }
      }
      return ws;
    }

    // Can maxSide collect >= target tricks counted from the search root? cardsLeft = cards held at trick start.
    function search(target, won, leader, pos, cardsLeft, lvl, depth) {
      if (++nodes > nodeLimit) throw new SearchAbort('node limit');
      let key = 0;
      if (pos === 0) {
        const R = cardsLeft >> 2;
        if (won >= target) return true;
        if (won + R < target) return false;
        key = ttKey(leader);
        const e = tt.get(key);
        if (e !== undefined) {
          if (won + (e & 31) >= target) return true;
          if (won + (e >> 5) < target) return false;
        }
        const qt = quickTricks(leader);
        if ((leader & 1) === maxSide) { if (won + qt >= target) return true; }
        else if (won + R - qt < target) return false;
      }
      const tb = lvl * 4;
      const seat = (leader + pos) & 3;
      const maximizing = (seat & 1) === maxSide;
      const base = depth * 13;
      const n = genMoves(seat, pos, tb, base);
      let result = !maximizing;
      for (let i = 0; i < n; i++) {
        const s = moveSuit[base + i], b = moveRank[base + i], bit = 1 << b;
        H[seat * 4 + s] ^= bit;
        tSeat[tb + pos] = seat; tSuit[tb + pos] = s; tRank[tb + pos] = b;
        let r;
        if (pos === 3) {
          const w = trickWinner(tb);
          const r0 = rem[0], r1 = rem[1], r2 = rem[2], r3 = rem[3];
          for (let q = 0; q < 4; q++) rem[tSuit[tb + q]] &= ~(1 << tRank[tb + q]);
          r = search(target, won + ((w & 1) === maxSide ? 1 : 0), w, 0, cardsLeft - 4, lvl + 1, depth + 1);
          rem[0] = r0; rem[1] = r1; rem[2] = r2; rem[3] = r3;
        } else {
          r = search(target, won, leader, pos + 1, cardsLeft, lvl, depth + 1);
        }
        H[seat * 4 + s] ^= bit;
        if (maximizing === r) {
          result = r;
          if (i > 0) hist[seat * 52 + s * 13 + b] += 1;
          break;
        }
      }
      if (pos === 0) {
        const e = tt.get(key);
        let lb = 0, ub = cardsLeft >> 2;
        if (e !== undefined) { lb = e & 31; ub = e >> 5; }
        if (result) { if (target - won > lb) lb = target - won; }
        else if (target - won - 1 < ub) ub = target - won - 1;
        if (tt.size > 2000000) tt.clear();
        tt.set(key, (ub << 5) | lb);
      }
      return result;
    }

    function load(hands, trumpSuit, side0, trick) {
      if (ttTrump !== trumpSuit || ttSide !== side0) { tt.clear(); ttTrump = trumpSuit; ttSide = side0; hist.fill(0); }
      trump = trumpSuit; maxSide = side0;
      H.fill(0); rem.fill(0);
      let count = 0;
      for (let seat = 0; seat < 4; seat++) for (const c of hands[seat]) {
        const s = (c / 13) | 0, b = c % 13;
        H[seat * 4 + s] |= 1 << b; rem[s] |= 1 << b; count++;
      }
      for (let i = 0; i < trick.length; i++) {
        const c = trick[i].card, s = (c / 13) | 0, b = c % 13;
        tSeat[i] = trick[i].seat; tSuit[i] = s; tRank[i] = b; rem[s] |= 1 << b;
      }
      return count;
    }

    // Exact tricks for maxSide from a position, MTD-style from a guess.
    function value(leader, pos, cardsLeft, lo, hi, guess) {
      if (guess != null && guess >= lo && guess <= hi) {
        // probe the guess first: candidates usually score the same as the previous one
        if (guess > lo) { if (search(guess, 0, leader, pos, cardsLeft, 0, 0)) lo = guess; else hi = guess - 1; }
        if (lo < hi && lo === guess) { if (search(guess + 1, 0, leader, pos, cardsLeft, 0, 0)) lo = guess + 1; else hi = guess; }
      }
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (search(mid, 0, leader, pos, cardsLeft, 0, 0)) lo = mid; else hi = mid - 1;
      }
      return lo;
    }

    /**
     * Analyse every distinct legal card for the seat to play.
     * hands: four arrays of remaining card ids; trick: cards on the table this trick [{seat, card}].
     * Returns [{card, tricks, equivalents}]; tricks = the mover's side tricks from here (this trick included).
     */
    function analyze(hands, trumpSuit, trick, seat, opts = {}) {
      nodes = 0; nodeLimit = opts.nodeLimit || Infinity;
      const mySide = seat & 1;
      const held = load(hands, trumpSuit, mySide, trick);
      const pos = trick.length;
      const leader = pos ? trick[0].seat : seat;
      const startCount = held + pos;
      const total = startCount >> 2;
      const hand = hands[seat];
      const led = pos ? (trick[0].card / 13) | 0 : -1;
      const legal = led >= 0 && hand.some(c => ((c / 13) | 0) === led) ? hand.filter(c => ((c / 13) | 0) === led) : hand.slice();
      const groups = [];
      const bySuit = [[], [], [], []];
      for (const c of legal) bySuit[(c / 13) | 0].push(c);
      for (let s = 0; s < 4; s++) {
        let group = null, prevBit = -1;
        for (const c of bySuit[s].sort((a, b) => b - a)) {
          const b = c % 13;
          if (group && !(rem[s] & ((1 << prevBit) - 1) & ~((1 << (b + 1)) - 1))) group.push(c);
          else { group = [c]; groups.push(group); }
          prevBit = b;
        }
      }
      const out = [];
      let guess = opts.guess == null ? null : opts.guess;
      for (const group of groups) {
        const c = group[0], s = (c / 13) | 0, b = c % 13;
        H[seat * 4 + s] ^= 1 << b;
        tSeat[pos] = seat; tSuit[pos] = s; tRank[pos] = b;
        let v;
        if (pos === 3) {
          const w = trickWinner(0);
          const save = [rem[0], rem[1], rem[2], rem[3]];
          for (let q = 0; q < 4; q++) rem[tSuit[q]] &= ~(1 << tRank[q]);
          const add = (w & 1) === mySide ? 1 : 0;
          const left = startCount - 4;
          v = add + (left > 0 ? value(w, 0, left, 0, left >> 2, guess == null ? null : guess - add) : 0);
          for (let q = 0; q < 4; q++) rem[q] = save[q];
        } else {
          v = value(leader, pos + 1, startCount, 0, total, guess);
        }
        H[seat * 4 + s] ^= 1 << b;
        guess = v;
        out.push({ card: c, tricks: v, equivalents: group.slice() });
      }
      return out;
    }

    /** Tricks for `forSide` with `leader` on lead from a trick boundary. */
    function solve(hands, trumpSuit, leader, forSide = leader & 1, opts = {}) {
      nodes = 0; nodeLimit = opts.nodeLimit || Infinity;
      const held = load(hands, trumpSuit, forSide, []);
      return value(leader, 0, held, 0, held >> 2, opts.guess);
    }

    return { analyze, solve, get nodes() { return nodes; }, clear() { tt.clear(); hist.fill(0); } };
  }

  const shared = createSolver();
  return { createSolver, SearchAbort, analyze: shared.analyze, solve: shared.solve, solver: shared };
});
