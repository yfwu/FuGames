/* AutoHex-3D command helpers. Read-only analysis of a public observation plus
   order-queue resolution. Rules, legality and spending stay in hex-core.js:
   every queued order is re-checked with engine.legalAction at execution time. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AutoHex3DLogic = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // Supply graph of one faction exactly as computeSupply walks it: own stones,
  // hex adjacency plus own bridges/tunnels whose two endpoints are still own.
  function supplyGraph(view, engine, player) {
    const links = new Map();
    for (const link of engine.transportLinks(view, player)) {
      if (!links.has(link.a)) links.set(link.a, []);
      if (!links.has(link.b)) links.set(link.b, []);
      links.get(link.a).push(link.b); links.get(link.b).push(link.a);
    }
    return i => {
      const out = [];
      for (const j of engine.ADJ[i]) if (view.board[j] === player) out.push(j);
      for (const j of links.get(i) || []) if (view.board[j] === player) out.push(j);
      return out;
    };
  }

  // Articulation points of the home-rooted supply tree (iterative Tarjan).
  // For each own non-anchor stone, `cut` is how many currently supplied own
  // stones would lose the home connection if this one stone were lost — the
  // same quantity AutoHexVisuals.supplyCutPreview reports, for all stones at once.
  function supplyChokepoints(view, engine, player) {
    const home = view.players[player] && view.players[player].home;
    if (!Number.isInteger(home) || view.board[home] !== player) return [];
    const next = supplyGraph(view, engine, player), count = view.board.length;
    const disc = new Int32Array(count).fill(-1), low = new Int32Array(count), size = new Int32Array(count), cut = new Int32Array(count);
    let time = 0;
    disc[home] = low[home] = time++; size[home] = 1;
    const stack = [{ v: home, parent: -1, n: next(home), k: 0 }];
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (top.k < top.n.length) {
        const w = top.n[top.k++];
        if (disc[w] < 0) { disc[w] = low[w] = time++; size[w] = 1; stack.push({ v: w, parent: top.v, n: next(w), k: 0 }); }
        else if (w !== top.parent) low[top.v] = Math.min(low[top.v], disc[w]);
        continue;
      }
      stack.pop();
      if (top.parent >= 0) {
        const p = top.parent;
        low[p] = Math.min(low[p], low[top.v]); size[p] += size[top.v];
        if (p !== home && low[top.v] >= disc[p]) cut[p] += size[top.v];
      }
    }
    const out = [];
    for (let i = 0; i < count; i++) if (cut[i] > 0 && !view.anchors[i]) out.push({ cell: i, owner: player, cut: cut[i] });
    out.sort((a, b) => b.cut - a.cut || a.cell - b.cell);
    return out;
  }

  // One faction's logistics at a glance; everything comes from public fields.
  function supplyReport(view, engine, player) {
    const pl = view.players[player], R = engine.RULES;
    const connected = engine.computeSupply(view, player);
    let stones = 0, linked = 0, low = 0, gap = Infinity, frontline = -1;
    const cut = [];
    for (let i = 0; i < view.board.length; i++) {
      if (view.board[i] !== player) continue;
      stones++;
      if (connected[i]) {
        linked++;
        const d = engine.RADIUS + engine.CELLS[i][pl.axis] * pl.sign;
        if (d < gap) { gap = d; frontline = i; }
        if (!view.anchors[i] && view.reserve[i] <= 2) low++;
      } else cut.push({ cell: i, reserve: view.reserve[i] });
    }
    cut.sort((a, b) => a.reserve - b.reserve || a.cell - b.cell);
    const depots = (view.depots || []).filter(d => d.owner === player && d.supplied).length;
    const airports = (view.airports || []).filter(a => a.owner === player && a.active).length;
    const workshops = view.expansion ? (view.structures || []).filter(t => t.type === 'workshop' && t.owner === player && view.board[t.cell] === player && connected[t.cell]).length : 0;
    return {
      player, stones, linked, cut, low, depots, airports,
      supplies: pl.supplies || 0, suppliesCap: R.suppliesCap,
      production: R.supplyProduction + 2 * depots + (engine.EXPANSION ? engine.EXPANSION.workshopProduction : 2) * workshops, workshops,
      haulUsed: pl.haulUsed || 0, haulBudget: R.haulBudget,
      delivered: pl.deliveredSupply || 0,
      goalGap: gap === Infinity ? null : gap, frontline,
      reached: !!pl.reached, goalActive: !!pl.goalActive
    };
  }

  // Positions: fortified stones, turrets with battery state, shields and hills.
  function positionReport(view, engine, player) {
    const R = engine.RULES;
    const turrets = (view.turrets || []).filter(t => t.owner === player && view.board[t.cell] === player)
      .map(t => ({ cell: t.cell, countdown: t.countdown, life: t.life, armed: view.reserve[t.cell] >= 2 }));
    let fortified = 0, shields = 0, hills = 0, maturing = 0;
    const hillCells = [];
    for (let i = 0; i < view.board.length; i++) {
      if (view.board[i] !== player || view.anchors[i]) continue;
      if (view.fortified[i]) fortified++;
      else if (view.age[i] >= R.fortifyAge - 6) maturing++;
      if (view.shields[i]) shields++;
      if (view.terrain[i] === 2) { hills++; hillCells.push({ cell: i, left: R.hillTurns - (view.hillAge[i] || 0) }); }
    }
    return { turrets, fortified, maturing, shields, hills, hillCells };
  }

  // Shared deck: the recipe and counts are public; the order of the draw pile
  // and other hands are not. Odds are the recipe share, not a peek.
  function deckSummary(view, engine) {
    const recipe = view.deckRecipe || [], counts = {};
    for (const type of recipe) counts[type] = (counts[type] || 0) + 1;
    const copies = view.players.length - 1;
    return engine.CARD_TYPES.map(type => ({ type, perSeat: counts[type] || 0, total: (counts[type] || 0) * copies,
      share: recipe.length ? (counts[type] || 0) / recipe.length : 0 }));
  }

  // Queued orders store the card type, not a hand index, because the hand
  // changes while other factions act. Resolution never bypasses legality.
  function resolveOrder(view, engine, order) {
    if (!order || typeof order.type !== 'string') return null;
    const action = { type: order.type, cells: (order.cells || []).slice() };
    if (order.target !== undefined) action.target = order.target;
    if (engine.CARD_META[order.type]) {
      const index = (view.hand || []).indexOf(order.type);
      if (index < 0) return null;
      action.cardIndex = index;
    }
    return engine.legalAction(view, action) ? action : null;
  }
  // Returns the first executable order. Orders ahead of it that are no longer
  // legal are reported as dropped; orders behind it stay queued.
  function takeQueued(view, engine, queue) {
    const dropped = [];
    for (let k = 0; k < queue.length; k++) {
      const action = resolveOrder(view, engine, queue[k]);
      if (action) return { action, order: queue[k], dropped, rest: queue.slice(k + 1) };
      dropped.push(queue[k]);
    }
    return { action: null, order: null, dropped, rest: [] };
  }
  // Validation for queueing while another faction acts: the order is checked
  // against a hypothetical view where it is the observer's turn. Position may
  // change before execution; this only rejects orders that are malformed now.
  function plausibleOrder(view, engine, player, order) {
    if (!order || !engine.ACTION_META[order.type] && !engine.CARD_META[order.type]) return false;
    if (engine.CARD_META[order.type] && !(view.hand || []).includes(order.type)) return false;
    const meta = engine.CARD_META[order.type] || engine.ACTION_META[order.type];
    const cells = order.cells || [];
    if (meta.variableSlots ? cells.length < meta.slots || cells.length > meta.maxSlots : cells.length !== meta.slots) return false;
    if (cells.some(i => !Number.isInteger(i) || i < 0 || i >= view.board.length)) return false;
    const air = order.type === 'airdrop' || order.type === 'bombard';
    return air || cells.every(i => engine.inRange(view, player, i));
  }

  // Cells whose terrain differs from the opening map were engineered.
  function engineeredCells(initial, terrain) {
    const out = [];
    if (!initial) return out;
    for (let i = 0; i < terrain.length; i++) if (initial[i] !== terrain[i]) out.push(i);
    return out;
  }

  // Hex rounding for picking: fractional axial -> integer axial.
  function roundAxial(q, r) {
    const s = -q - r;
    let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
    const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
    if (dq > dr && dq > ds) rq = -rr - rs; else if (dr > ds) rr = -rq - rs;
    return { q: rq, r: rr };
  }
  // World plane (x, z) uses the same layout as the 2D board: x = √3(q + r/2), z = 1.5r.
  function worldToAxial(x, z) { return roundAxial(Math.sqrt(3) / 3 * x - z / 3, 2 / 3 * z); }

  return Object.freeze({ supplyChokepoints, supplyReport, positionReport, deckSummary, resolveOrder, takeQueued, plausibleOrder, engineeredCells, roundAxial, worldToAxial });
});
