'use strict';
// Verbatim rules + AI from the pre-polish trackgame.html (commit ba546fe), kept as a regression oracle:
// with default options the new TrackEngine must place, rotate, judge and search exactly like this.
const performance = { now: () => Date.now() };
    const OUTER_RING = [0,1,2,3,7,11,15,14,13,12,8,4];
    const INNER_RING = [5,6,10,9];
    const OUTER_SET = new Set(OUTER_RING);
    const INNER_SET = new Set(INNER_RING);

    const WIN_LINES = [
      [0,1,2,3], [4,5,6,7], [8,9,10,11], [12,13,14,15],
      [0,4,8,12], [1,5,9,13], [2,6,10,14], [3,7,11,15],
      [0,5,10,15], [3,6,9,12]
    ];

    const pow3 = (() => {
      const arr = new Array(16);
      let v = 1;
      for (let i=0;i<16;i++){ arr[i]=v; v*=3; }
      return arr;
    })();

    function otherPlayer(p){ return p === 1 ? 2 : 1; }

    function boardId(board){
      let id = 0;
      for (let i=0;i<16;i++) id += board[i] * pow3[i];
      return id;
    }

    function rotateRing(board, ring, dir){
      // dir: +1 clockwise (advance along ring list), -1 counterclockwise
      const len = ring.length;
      const next = board.slice();
      for (let i=0;i<len;i++){
        const from = ring[i];
        const to = ring[(i + dir + len) % len];
        next[to] = board[from];
      }
      return next;
    }

    function rotateBoth(board, dir){
      // Outer + inner rotate simultaneously. Rings are disjoint, so sequential application is safe.
      let next = rotateRing(board, OUTER_RING, dir);
      next = rotateRing(next, INNER_RING, dir);
      return next;
    }

    function buildRotMap(ring){
      const len = ring.length;
      const cw = new Map();
      const ccw = new Map();
      for (let i=0;i<len;i++){
        cw.set(ring[i], ring[(i+1)%len]);
        ccw.set(ring[i], ring[(i-1+len)%len]);
      }
      return { cw, ccw };
    }

    const ROT_OUTER = buildRotMap(OUTER_RING);
    const ROT_INNER = buildRotMap(INNER_RING);

    function rotateIndex(idx, dir){
      if (OUTER_SET.has(idx)) return (dir === 1 ? ROT_OUTER.cw : ROT_OUTER.ccw).get(idx);
      if (INNER_SET.has(idx)) return (dir === 1 ? ROT_INNER.cw : ROT_INNER.ccw).get(idx);
      return idx;
    }

    function checkWinnerRaw(board){
      // returns 0 none, 1 black, 2 white, 3 both
      let black = false;
      let white = false;
      for (const line of WIN_LINES){
        const a = board[line[0]];
        if (a === 0) continue;
        if (a === board[line[1]] && a === board[line[2]] && a === board[line[3]]){
          if (a === 1) black = true;
          if (a === 2) white = true;
        }
      }
      if (black && white) return 3;
      if (black) return 1;
      if (white) return 2;
      return 0;
    }

    function resolveWinner(boardAfterRotation, justMovedPlayer){
      // Determine winner after a move + required rotation.
      // Rule (default):
      //  - If only one side has 4-in-line -> that side wins.
      //  - If both have 4-in-line -> justMovedPlayer wins.
      const raw = checkWinnerRaw(boardAfterRotation);
      if (raw === 0) return 0;
      if (raw === 3) return justMovedPlayer;
      return raw;
    }

    function findWinCells(board, winner){
      const cells = new Set();
      if (winner !== 1 && winner !== 2) return cells;
      for (const line of WIN_LINES){
        const a = board[line[0]];
        if (a !== winner) continue;
        if (a === board[line[1]] && a === board[line[2]] && a === board[line[3]]){
          line.forEach(i => cells.add(i));
        }
      }
      return cells;
    }

    function emptyCells(board){
      const res = [];
      for (let i=0;i<16;i++) if (board[i] === 0) res.push(i);
      return res;
    }

    function boardFromPieces(pieces){
      const b = new Array(16).fill(0);
      for (const pc of pieces){
        b[pc.idx] = pc.player;
      }
      return b;
    }

    // ===== Heuristic for AI =====

    const WEIGHT = [0, 2, 14, 85, 100000];
    const WIN_SCORE = 100000;

    function heuristic(board, aiPlayer){
      const opp = otherPlayer(aiPlayer);
      let score = 0;
      for (const line of WIN_LINES){
        let aiCount = 0;
        let oppCount = 0;
        for (const idx of line){
          if (board[idx] === aiPlayer) aiCount++;
          else if (board[idx] === opp) oppCount++;
        }
        if (aiCount > 0 && oppCount > 0) continue; // blocked
        if (aiCount > 0) score += WEIGHT[aiCount];
        if (oppCount > 0) score -= WEIGHT[oppCount];
      }
      return score;
    }

    function moveOrdering(moves, preferFirst = null){
      // Prefer center squares and optionally place a preferred move first (PV ordering).
      const center = [5,6,9,10];
      const centerSet = new Set(center);
      const ordered = moves.slice().sort((a,b) => {
        const aC = centerSet.has(a) ? 0 : 1;
        const bC = centerSet.has(b) ? 0 : 1;
        if (aC !== bC) return aC - bC;
        return a - b;
      });
      if (preferFirst != null){
        const k = ordered.indexOf(preferFirst);
        if (k > 0){
          ordered.splice(k, 1);
          ordered.unshift(preferFirst);
        }
      }
      return ordered;
    }

    function simulateMove(board, player, idx, dir){
      const placed = board.slice();
      placed[idx] = player;
      const rotated = rotateBoth(placed, dir);
      const winner = resolveWinner(rotated, player);
      return { board: rotated, winner };
    }

    function minimax(board, playerToMove, depth, alpha, beta, ctx){
      const { aiPlayer, dir, cache, rootDepth, deadline } = ctx;

      if (deadline != null && performance.now() > deadline){
        ctx.timedOut = true;
        return heuristic(board, aiPlayer);
      }

      // Terminal: if board is already winning, it must have been decided on the previous move.
      const prev = otherPlayer(playerToMove);
      const winnerNow = resolveWinner(board, prev);
      if (winnerNow !== 0){
        const ply = rootDepth - depth;
        const fastBonus = (WIN_SCORE - ply);
        return (winnerNow === aiPlayer) ? fastBonus : -fastBonus;
      }

      const empties = emptyCells(board);
      if (empties.length === 0) return 0; // draw
      if (depth === 0) return heuristic(board, aiPlayer);

      // Transposition table
      // key packs boardId + player + depth
      const key = ((boardId(board) * 2 + (playerToMove - 1)) * 20 + depth);
      const cached = cache.get(key);
      if (cached !== undefined) return cached;

      const ordered = moveOrdering(empties);

      let best;
      if (playerToMove === aiPlayer){
        best = -Infinity;
        for (const mv of ordered){
          const sim = simulateMove(board, playerToMove, mv, dir);
          let val;
          if (sim.winner !== 0){
            const ply = rootDepth - depth;
            const fastBonus = (WIN_SCORE - ply);
            val = (sim.winner === aiPlayer) ? fastBonus : -fastBonus;
          } else {
            val = minimax(sim.board, otherPlayer(playerToMove), depth-1, alpha, beta, ctx);
            if (ctx.timedOut) break;
          }
          if (val > best) best = val;
          if (best > alpha) alpha = best;
          if (alpha >= beta) break;
        }
      } else {
        best = Infinity;
        for (const mv of ordered){
          const sim = simulateMove(board, playerToMove, mv, dir);
          let val;
          if (sim.winner !== 0){
            const ply = rootDepth - depth;
            const fastBonus = (WIN_SCORE - ply);
            val = (sim.winner === aiPlayer) ? fastBonus : -fastBonus;
          } else {
            val = minimax(sim.board, otherPlayer(playerToMove), depth-1, alpha, beta, ctx);
            if (ctx.timedOut) break;
          }
          if (val < best) best = val;
          if (best < beta) beta = best;
          if (alpha >= beta) break;
        }
      }

      cache.set(key, best);
      return best;
    }

    function bestMoveFixedDepth(board, playerToMove, opts){
      const { aiPlayer, depth, dir, deadline, cache, preferFirst } = opts;
      const empties = emptyCells(board);
      if (empties.length === 0) return { move: null, complete: true };

      // 1) Immediate win
      for (const mv of empties){
        const sim = simulateMove(board, playerToMove, mv, dir);
        if (sim.winner === aiPlayer) return { move: mv, complete: true };
      }

      // 2) Candidate pruning: avoid moves that instantly lose (if possible)
      const safe = [];
      for (const mv of empties){
        const sim = simulateMove(board, playerToMove, mv, dir);
        if (sim.winner === otherPlayer(aiPlayer)) continue;
        safe.push(mv);
      }
      const candidates = (safe.length > 0) ? safe : empties;

      const ctx = {
        aiPlayer,
        dir,
        cache,
        rootDepth: depth,
        deadline,
        timedOut: false
      };

      let best = null;
      let bestScore = -Infinity;
      let alpha = -Infinity;
      let beta = Infinity;

      const ordered = moveOrdering(candidates, preferFirst);

      for (const mv of ordered){
        const sim = simulateMove(board, playerToMove, mv, dir);
        let val;
        if (sim.winner !== 0){
          const fastBonus = WIN_SCORE;
          val = (sim.winner === aiPlayer) ? fastBonus : -fastBonus;
        } else {
          val = minimax(sim.board, otherPlayer(playerToMove), depth-1, alpha, beta, ctx);
        }
        if (ctx.timedOut) return { move: null, complete: false };

        if (val > bestScore){
          bestScore = val;
          best = mv;
        }
        if (bestScore > alpha) alpha = bestScore;
      }

      return { move: best ?? candidates[0], complete: true };
    }

    function bestMove(board, playerToMove, opts){
      const { aiPlayer, level, dir } = opts;
      const empties = emptyCells(board);
      if (empties.length === 0) return null;

      if (level === "easy"){
        return empties[Math.floor(Math.random() * empties.length)];
      }

      if (level === "medium"){
        const cache = new Map();
        const r = bestMoveFixedDepth(board, playerToMove, {
          aiPlayer,
          depth: 4,
          dir,
          deadline: null,
          cache,
          preferFirst: null
        });
        return r.move ?? empties[0];
      }

      // Hard / Expert: iterative deepening with a time budget
      const timeMs = (level === "hard") ? 260 : 680;
      const maxDepth = (level === "hard") ? 8 : 10;
      const deadline = performance.now() + timeMs;

      const cache = new Map();
      let lastBest = null;

      for (let depth = 2; depth <= maxDepth; depth++){
        const r = bestMoveFixedDepth(board, playerToMove, {
          aiPlayer,
          depth,
          dir,
          deadline,
          cache,
          preferFirst: lastBest
        });

        if (!r.complete) break;
        if (r.move != null) lastBest = r.move;

        // If we're very close to the deadline, stop after a completed depth.
        if (performance.now() + 12 > deadline) break;
      }

      return lastBest ?? empties[0];
    }
module.exports = { OUTER_RING, INNER_RING, WIN_LINES, rotateBoth, rotateIndex, checkWinnerRaw, resolveWinner, findWinCells, heuristic, simulateMove, bestMove, bestMoveFixedDepth };
