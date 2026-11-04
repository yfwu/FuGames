/* AutoHex 3D built-in bots. Each call returns ONE action for the player whose
   turn it is; call repeatedly until it returns { type: 'end' }. Deterministic:
   no randomness, only the public engine API plus what the player may know
   (own state, visible cells, remembered buildings). Five doctrines share one
   evaluator with different weights, so they play visibly differently. */
(function (root, factory) {
  const engine = typeof module === 'object' && module.exports ? require('./engine.js') : root.AutoHexEngine;
  const api = factory(engine);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AutoHexAI = api;
})(typeof window !== 'undefined' ? window : globalThis, function (E) {
  'use strict';
  const { CARDS, BUILDINGS, UNITS, TERRAIN } = E;

  const PROFILES = {
    balanced: { label: '均衡', econ: 1.0, mil: 1.0, def: 1.0, vp: 1.0, aggro: 1.0, raid: 1.0 },
    builder:  { label: '經營', econ: 1.35, mil: 0.7, def: 0.9, vp: 1.35, aggro: 0.7, raid: 0.8 },
    warlord:  { label: '征伐', econ: 0.85, mil: 1.5, def: 0.7, vp: 0.8, aggro: 1.5, raid: 1.0 },
    warden:   { label: '堅守', econ: 1.0, mil: 0.95, def: 1.6, vp: 1.1, aggro: 0.75, raid: 0.7 },
    raider:   { label: '劫掠', econ: 0.9, mil: 1.25, def: 0.6, vp: 0.9, aggro: 1.25, raid: 1.8 }
  };
  const PROFILE_ORDER = ['balanced', 'builder', 'warlord', 'warden', 'raider'];

  // ---------------------------------------------------------------- context

  function context(st, id, profileName) {
    const prof = PROFILES[profileName] || PROFILES.balanced;
    const p = st.players[id - 1], g = E.geometry(st.map.R), inc = E.income(st, id);
    const vis = E.visibleSet(st, id);
    const enemyUnits = st.units.filter(u => u.owner !== id && vis[u.cell]);
    const enemyBuildings = [];
    for (const b of st.buildings) if (b.owner !== id && vis[b.cell]) enemyBuildings.push({ ...b, seen: true });
    for (const [cell, v] of Object.entries(p.intel)) if (!vis[+cell]) enemyBuildings.push({ id: -(+cell) - 1, type: v.type, owner: v.owner, cell: +cell, hp: BUILDINGS[v.type].hp, max: BUILDINGS[v.type].hp, seen: false });
    const myUnits = st.units.filter(u => u.owner === id), myBuildings = st.buildings.filter(b => b.owner === id);
    const roundsLeft = Math.max(1, st.rules.maxRounds - st.round + 1);
    const H = Math.min(8, roundsLeft) * 0.9;
    const w = {
      food: inc.net.food < 1 ? 1.7 : inc.net.food < 3 ? 1.15 : 0.7,
      mat: inc.mat < 3 ? 1.4 : p.res.mat < 4 ? 1.2 : 0.95,
      gold: inc.gold < 3 ? 1.3 : 1.0
    };
    const myVp = E.totalVp(st, id);
    const leaderVp = Math.max(...st.players.filter(q => q.alive && q.id !== id).map(q => E.totalVp(st, q.id)), 0);
    return { st, id, p, g, prof, inc, vis, enemyUnits, enemyBuildings, myUnits, myBuildings, roundsLeft, H, w, myVp, leaderVp };
  }
  const resValue = (ctx, y) => (y.food || 0) * ctx.w.food + (y.mat || 0) * ctx.w.mat + (y.gold || 0) * ctx.w.gold;
  const unitPower = u => u.hp * (UNITS[u.type].atk + 0.5) * (UNITS[u.type].range > 1 ? 1.1 : 1);
  function powerNear(list, g, cell, r) { let s = 0; for (const u of list) if (g.dist(u.cell, cell) <= r) s += unitPower(u); return s; }
  function threatAt(ctx, cell, r = 3) { return powerNear(ctx.enemyUnits.filter(u => u.owner !== 0 || ctx.g.dist(u.cell, u.anchor ?? u.cell) <= 3), ctx.g, cell, r); }

  // ------------------------------------------------------------ evaluations

  function yieldDelta(ctx, type, cell) {
    const { st, id, g } = ctx;
    const around = {}; for (const b of st.buildings) around[b.cell] = b;
    const fake = { id: -1, type, owner: id, cell };
    let delta = { food: 0, mat: 0, gold: 0 };
    const add = (y, s) => { for (const k of ['food', 'mat', 'gold']) delta[k] += s * (y[k] || 0); };
    const nb = g.adj[cell].map(j => around[j]).filter(b => b && b.owner === id && st.connected[b.cell]);
    for (const b of nb) add(E.buildingYield(st, b, around), -1);
    around[cell] = fake;
    add(E.buildingYield(st, fake, around), 1);
    for (const b of nb) add(E.buildingYield(st, b, around), 1);
    return delta;
  }
  function territoryGain(ctx, type, cell) {
    const { st, id, g } = ctx, d = BUILDINGS[type];
    if (d.ctl <= 0) return { cells: 0, relics: 0, features: 0 };
    let cells = 0, relics = 0, features = 0;
    for (const j of g.disk(cell, d.ctl)) {
      if (st.owner[j] === id) continue;
      const enemy = st.owner[j] > 0;
      if (enemy && d.inf < 2) continue;
      cells++;
      if (st.map.feature[j] === 'relic') relics += j === st.map.center ? 2 : 1;
      else if (st.map.feature[j]) features++;
    }
    return { cells, relics, features };
  }
  function costValue(ctx, cost) { return cost ? resValue(ctx, cost) : 0; }

  function buildValue(ctx, type, cell) {
    const { st, id, g, prof, H, p } = ctx;
    const count = ctx.myBuildings.filter(b => b.type === type).length;
    const threat = threatAt(ctx, cell, 4);
    const towardCentre = g.dist(cell, st.map.center);
    let v = 0;
    switch (type) {
      case 'farm': case 'lumber': case 'mine': case 'market':
        v = resValue(ctx, yieldDelta(ctx, type, cell)) * H * 0.55 * prof.econ;
        if (v <= 0.5) return -1;
        break;
      case 'granary': {
        const full = ['food', 'mat', 'gold'].some(k => p.res[k] >= ctx.inc.cap - 3);
        v = (full ? 6 : 1) + resValue(ctx, yieldDelta(ctx, type, cell)) * H * 0.55 * prof.econ - count * 2;
        break;
      }
      case 'outpost': {
        const t = territoryGain(ctx, type, cell);
        v = (t.cells * 0.55 + t.relics * 14 + t.features * 1.5) * (st.round < 14 ? 1.1 : 0.7) - count * 0.6 - threat * 0.05;
        v += (st.map.R * 2 - towardCentre) * 0.1;
        break;
      }
      case 'tower': {
        const t = territoryGain(ctx, type, cell);
        const guard = ctx.myBuildings.filter(b => g.dist(b.cell, cell) <= 2 && (b.type === 'shrine' || b.type === 'capital' || st.map.feature[b.cell] === 'relic')).length;
        const enemyNear = ctx.enemyBuildings.filter(b => g.dist(b.cell, cell) <= 4).length;
        v = (threat > 0 ? 4 + threat * 0.08 : 0.5) * prof.def + guard * 3 * prof.def + enemyNear * 1.2 + t.cells * 0.3 + t.relics * 8 - count * 0.8;
        if (st.map.terrain[cell] === 'hill') v *= 1.25;
        break;
      }
      case 'wall': {
        const econNear = ctx.myBuildings.filter(b => g.dist(b.cell, cell) === 1 && b.type !== 'wall').length;
        v = threat > 0 ? (2 + threat * 0.05) * prof.def * Math.min(2, econNear) : -1;
        break;
      }
      case 'barracks': {
        const enemyDist = Math.min(99, ...ctx.enemyBuildings.map(b => g.dist(b.cell, cell)), ...st.map.relics.filter(r => st.owner[r] !== id).map(r => g.dist(r, cell)));
        v = (count === 0 ? 9 : count === 1 && st.round > 5 ? 4 : 1) * prof.mil + (12 - Math.min(12, enemyDist)) * 0.25 - threat * 0.04;
        break;
      }
      case 'workshop': v = count === 0 && st.round >= 6 ? (3 + ctx.enemyBuildings.length * 0.4) * prof.mil * prof.aggro : -1; break;
      case 'shrine': {
        const central = cell === st.map.center;
        v = (central ? 2 : 1) * Math.min(ctx.roundsLeft, 14) * 1.6 * prof.vp - threat * 0.05;
        break;
      }
      default: v = 0;
    }
    return v;
  }

  function desiredArmy(ctx) {
    const { st, prof } = ctx;
    const base = 3 + st.round * 0.6 * prof.mil;
    const threat = ctx.myBuildings.reduce((s, b) => s + threatAt(ctx, b.cell, 3), 0);
    return Math.min(st.rules.popCap, Math.round(base + threat / 40));
  }
  function unitValue(ctx, type) {
    const { st, prof, inc } = ctx;
    if (inc.net.food - UNITS[type].upkeep < -1 && ctx.p.res.food < 4) return -1;
    const want = desiredArmy(ctx) - ctx.myUnits.length;
    let v = want > 0 ? 5 + want * 1.2 : 0.5;
    v *= prof.mil;
    const tags = {}; for (const u of ctx.enemyUnits) if (u.owner) for (const t of UNITS[u.type].tags) tags[t] = (tags[t] || 0) + 1;
    const d = UNITS[type];
    if (d.bonus) for (const [t, b] of Object.entries(d.bonus)) v += (tags[t] || 0) * b * 0.3;
    v += (d.hp * (d.atk + 0.5)) / 12;
    if (type === 'scout') v = ctx.myUnits.some(u => u.type === 'scout') ? 0 : 2.5;
    if (type === 'catapult') v = ctx.enemyBuildings.some(b => b.owner && (b.type === 'tower' || b.type === 'capital' || b.type === 'wall')) ? v + 2 * prof.aggro : v - 2;
    if (type === 'militia' && st.round > 8) v -= 2;
    return v;
  }

  function tacticValue(ctx, key, cell) {
    const { st, id, g, prof, p } = ctx;
    const engagedSoon = ctx.myUnits.some(u => ctx.enemyUnits.some(e => g.dist(e.cell, u.cell) <= 3)) || ctx.myUnits.some(u => u.stance === 'advance');
    switch (key) {
      case 'firearrows': {
        const u = E.unitAt(st, cell), b = E.buildingAt(st, cell);
        if (u && u.owner !== id) { const kill = u.hp <= 4 - UNITS[u.type].armor; return kill ? 6 + UNITS[u.type].hp * 0.3 : 2 + (u.owner === 0 ? 0 : 1); }
        if (b && b.owner !== id) { const kill = b.hp <= 4 - (BUILDINGS[b.type].armor + (b.armor || 0)); return kill ? 7 * prof.raid : 1; }
        return -1;
      }
      case 'rally': return engagedSoon && ctx.myUnits.length >= 3 ? 1.2 * ctx.myUnits.length * prof.mil * 0.6 : -1;
      case 'march': return ctx.myUnits.filter(u => u.stance === 'advance').length >= 3 ? 3 * prof.aggro : -1;
      case 'entrench': { const t = ctx.myBuildings.reduce((s, b) => s + threatAt(ctx, b.cell, 3), 0); return t > 0 ? 2 + t * 0.04 * prof.def : -1; }
      case 'recon': {
        const adv = ctx.myUnits.find(u => u.stance === 'advance' && u.goal >= 0 && !ctx.vis[u.goal]);
        return adv && g.dist(cell, adv.goal) === 0 ? 3 : -1;
      }
      case 'sabotage': {
        const b = E.buildingAt(st, cell); if (!b) return -1;
        const around = {}; for (const x of st.buildings) around[x.cell] = x;
        const y = E.buildingYield(st, b, around);
        return (y.food + y.mat + y.gold) * 1.2 * prof.raid + (b.type === 'tower' ? 3 : 0) + (b.type === 'shrine' ? 4 : 0);
      }
      case 'plunder': return 3 * ctx.w.gold * prof.raid * 0.9;
      case 'repair': { const b = E.buildingAt(st, cell); return b ? (b.max - b.hp) * 0.6 * prof.def - 1 : -1; }
      case 'fortify': { const b = E.buildingAt(st, cell); if (!b) return -1; const t = threatAt(ctx, cell, 4); return (b.type === 'capital' || b.type === 'tower' || b.type === 'shrine') ? 1.5 + t * 0.06 * prof.def : -1; }
      case 'ambush': {
        const t = threatAt(ctx, cell, 3); if (t <= 0) return -1;
        return 2 + Math.min(4, t * 0.03) * prof.def - (ctx.myBuildings.some(b => g.dist(b.cell, cell) <= 1) ? 0 : 1);
      }
      case 'clearing': {
        const lumberNear = ctx.myBuildings.some(b => b.type === 'lumber' && g.dist(b.cell, cell) === 1);
        return lumberNear ? -1 : 2.2 * ctx.w.mat;
      }
      case 'bridge': case 'tunnel': return -1;
      default: return -1;
    }
  }

  function marketValue(ctx, key) {
    const { st, prof, p } = ctx, def = CARDS[key];
    const owned = [...p.deck, ...p.hand, ...p.discard].filter(c => c.k === key).length;
    const deckSize = p.deck.length + p.hand.length + p.discard.length;
    const late = st.round / st.rules.maxRounds;
    const vpPressure = Math.max(ctx.myVp, ctx.leaderVp) / st.rules.vpTarget;
    let v;
    const T = ctx.st.map.terrain, terr = ctx.st.owner.map((o, i) => o === ctx.id ? i : -1).filter(i => i >= 0);
    switch (key) {
      case 'tax': case 'survey': v = 1; break;
      case 'harvest': v = ctx.inc.net.food < 2 ? 2.6 : 1.4; break;
      case 'trade': v = 1.6 + ctx.myBuildings.filter(b => b.type === 'market').length * 0.6; break;
      case 'treasury': v = 3.2; break;
      case 'mobilize': v = 3.2; break;
      case 'scheme': v = 2.6; break;
      case 'purge': v = owned ? 0.5 : (st.round < 10 ? 2.4 : 1); break;
      case 'farm': v = ctx.inc.net.food < 2 ? 3.4 : 1.6; break;
      case 'lumber': v = terr.some(i => ctx.g.adj[i].some(j => T[j] === 'forest')) ? 2.8 : 0.2; break;
      case 'mine': v = terr.some(i => T[i] === 'hill' || ctx.g.adj[i].some(j => T[j] === 'mountain')) ? 3 : 0.2; break;
      case 'market': v = 3; break;
      case 'granary': v = ['food', 'mat', 'gold'].some(k => p.res[k] >= ctx.inc.cap - 3) ? 2.8 : 1.2; break;
      case 'outpost': v = st.round < 12 ? 3.6 : 1.6; break;
      case 'barracks': v = (ctx.myBuildings.some(b => b.type === 'barracks') ? 1.2 : 3.6) * prof.mil; break;
      case 'workshop': v = st.round >= 5 ? 2.2 * prof.mil * prof.aggro : 0.6; break;
      case 'tower': v = 2.6 * prof.def; break;
      case 'wall': v = 1 * prof.def; break;
      case 'shrine': {
        const nearRelic = st.map.relics.some(r => (st.owner[r] === ctx.id || ctx.g.dist(r, ctx.myBuildings[0] ? ctx.myBuildings[0].cell : r) <= 8) && !E.buildingAt(st, r));
        v = nearRelic ? 5 * prof.vp : 1; break;
      }
      case 'spear': case 'archer': v = 2.6 * prof.mil; break;
      case 'cavalry': v = 3 * prof.mil * (prof.raid > 1.2 ? 1.25 : 1); break;
      case 'scout': v = 1; break;
      case 'catapult': v = st.round >= 6 ? 2.4 * prof.mil * prof.aggro : 0.8; break;
      case 'firearrows': v = 2.2; break;
      case 'ambush': v = 1.6 * prof.def; break;
      case 'rally': v = 1.7 * prof.mil; break;
      case 'entrench': v = 1.3 * prof.def; break;
      case 'march': v = 1.1 * prof.aggro; break;
      case 'recon': v = 0.8; break;
      case 'sabotage': v = 1.6 * prof.raid; break;
      case 'plunder': v = 1.4 * prof.raid; break;
      case 'repair': v = 0.9 * prof.def; break;
      case 'fortify': v = 1.3 * prof.def; break;
      case 'clearing': v = 0.7; break;
      case 'bridge': case 'tunnel': v = 0.2; break;
      case 'honor': case 'monument': case 'crown':
        v = def.vp * (0.55 + late * 2.2 + vpPressure * 2) * prof.vp * (key === 'crown' ? 1.08 : 1);
        break;
      default: v = 0.5;
    }
    if (def.kind !== 'vp') v *= Math.pow(0.72, owned) * (deckSize > 18 ? 0.85 : 1) * (1 - late * 0.45);
    return v;
  }

  // --------------------------------------------------------- military plan

  function militaryPlan(ctx) {
    const { st, id, g, prof } = ctx, orders = new Map();
    const units = [...ctx.myUnits].sort((a, b) => a.id - b.id);
    if (!units.length) return orders;
    const free = new Set(units.map(u => u.id));
    // 1. defence
    const threatened = ctx.myBuildings.map(b => ({ b, t: threatAt(ctx, b.cell, 3) + ctx.enemyUnits.filter(e => e.owner && g.dist(e.cell, b.cell) <= 2).length * 5 })).filter(x => x.t > 0).sort((a, b) => b.t - a.t);
    for (const { b, t } of threatened) {
      let have = 0;
      const near = units.filter(u => free.has(u.id)).sort((a, c) => g.dist(a.cell, b.cell) - g.dist(c.cell, b.cell));
      for (const u of near) {
        if (have >= t * 1.1 || g.dist(u.cell, b.cell) > 7) break;
        orders.set(u.id, { stance: 'guard', cell: b.cell }); free.delete(u.id); have += unitPower(u);
      }
    }
    // 2. offence
    const pool = units.filter(u => free.has(u.id));
    const myPower = pool.reduce((s, u) => s + unitPower(u), 0);
    const home = ctx.myBuildings.find(b => b.type === 'capital') || ctx.myBuildings[0];
    if (!home) return orders;
    const candidates = [];
    const defenseAt = cell => powerNear(ctx.enemyUnits, g, cell, 2) + ctx.enemyBuildings.filter(b => BUILDINGS[b.type].atk && g.dist(b.cell, cell) <= 2).reduce((s, b) => s + b.hp * 2.2, 0);
    for (const r of st.map.relics) {
      if (st.owner[r] === id) continue;
      const guards = ctx.enemyUnits.filter(u => u.owner === 0 && g.dist(u.cell, r) <= 2);
      const val = (r === st.map.center ? 14 : 9) * (guards.length ? 1 : 1.2);
      candidates.push({ cell: r, val, need: defenseAt(r), kind: 'relic' });
    }
    for (const b of ctx.enemyBuildings) {
      if (!b.owner) continue;
      let val = { shrine: 11, capital: 8, farm: 4, lumber: 4, mine: 5, market: 5, granary: 4, outpost: 4.5, barracks: 5, workshop: 4, tower: 3, wall: 0.5 }[b.type] || 3;
      if (b.type !== 'tower' && b.type !== 'wall' && b.type !== 'capital') val *= prof.raid;
      if (b.type === 'capital' && b.hp < 15) val += 8;
      candidates.push({ cell: b.cell, val, need: defenseAt(b.cell) + (b.type === 'capital' ? b.hp * 2.5 : 0), kind: 'building' });
    }
    let best = null, bestScore = -Infinity;
    for (const c of candidates) {
      const d = Math.min(...pool.map(u => g.dist(u.cell, c.cell)), g.dist(home.cell, c.cell));
      const feasible = myPower >= c.need * (1.35 / prof.aggro) + 6;
      const score = c.val * prof.aggro / (1 + d / 5) - c.need * 0.01 + (feasible ? 6 : -100) + E.mix32(E.hashString(st.seed) + c.cell * 97 + id) / 4294967296 * 0.05;
      if (score > bestScore) { bestScore = score; best = { ...c, feasible }; }
    }
    const armySize = pool.filter(u => u.type !== 'scout').length;
    const ready = best && best.feasible && (armySize >= Math.max(2, Math.round(3 / prof.aggro)) || best.need === 0);
    for (const u of pool) {
      if (u.type === 'scout' && best) { orders.set(u.id, { stance: 'advance', cell: best.cell }); continue; }
      if (ready) orders.set(u.id, { stance: 'advance', cell: best.cell });
      else {
        // stage on own territory nearest to the most attractive target
        const goal = best ? best.cell : home.cell;
        let stage = home.cell, sd = Infinity;
        for (const b of ctx.myBuildings) { const dd = g.dist(b.cell, goal); if (dd < sd) { sd = dd; stage = b.cell; } }
        orders.set(u.id, { stance: 'guard', cell: stage });
      }
    }
    return orders;
  }

  // ------------------------------------------------------------- decision

  function candidatesFor(ctx) {
    const { st, id, p, g } = ctx, out = [];
    const terr = []; for (let i = 0; i < st.owner.length; i++) if (st.owner[i] === id) terr.push(i);
    const seenKind = new Set();
    for (const c of p.hand) {
      const def = CARDS[c.k];
      if (def.kind === 'vp' || def.kind === 'econ') continue;
      if ((def.ap || 0) > p.ap || !canPayRes(p.res, E.cardCost(st, id, c.k))) continue;
      if (seenKind.has(c.k)) continue; seenKind.add(c.k);
      const cv = costValue(ctx, E.cardCost(st, id, c.k));
      if (def.kind === 'build') {
        for (const cell of terr) {
          if (E.placementError(st, id, def.build, cell)) continue;
          const v = buildValue(ctx, def.build, cell) - cv * 0.8;
          out.push({ v, action: { type: 'play', card: c.id, target: cell } });
        }
      } else if (def.kind === 'unit') {
        const sites = st.buildings.filter(b => b.owner === id && BUILDINGS[b.type].recruit && !E.recruitError(st, id, def.unit, b.cell));
        if (!sites.length) continue;
        // recruit nearest to the front
        const front = ctx.enemyBuildings.length ? ctx.enemyBuildings : st.map.relics.map(r => ({ cell: r }));
        sites.sort((a, b) => Math.min(...front.map(f => g.dist(f.cell, a.cell))) - Math.min(...front.map(f => g.dist(f.cell, b.cell))) || a.id - b.id);
        out.push({ v: unitValue(ctx, def.unit) - cv * 0.7, action: { type: 'play', card: c.id, target: sites[0].cell } });
      } else if (def.kind === 'tactic') {
        if (!def.target) { if (!E.playError(st, id, { card: c.id })) out.push({ v: tacticValue(ctx, c.k, -1) - cv * 0.6, action: { type: 'play', card: c.id } }); continue; }
        let cells;
        if (def.target === 'own-building') cells = ctx.myBuildings.map(b => b.cell);
        else if (def.target === 'own-empty' || def.target === 'own-forest') cells = terr;
        else if (def.target === 'any') cells = ctx.myUnits.filter(u => u.stance === 'advance' && u.goal >= 0).map(u => u.goal);
        else if (def.target === 'water-adj' || def.target === 'mountain-adj') cells = [];
        else cells = [...ctx.enemyUnits.map(u => u.cell), ...ctx.enemyBuildings.filter(b => b.seen).map(b => b.cell)];
        const vis = ctx.vis;
        for (const cell of new Set(cells)) {
          if (E.playError(st, id, { card: c.id, target: cell })) continue;
          out.push({ v: tacticValue(ctx, c.k, cell) - cv * 0.6, action: { type: 'play', card: c.id, target: cell } });
        }
        void vis;
      }
    }
    return out;
  }
  function upgradeValue(ctx, b) {
    const { st, H, prof, g } = ctx, lv = b.lvl || 1, threat = threatAt(ctx, b.cell, 4);
    switch (b.type) {
      case 'farm': return 1 * ctx.w.food * H * 0.55 * prof.econ;
      case 'lumber': case 'mine': return 1 * ctx.w.mat * H * 0.55 * prof.econ;
      case 'market': return 1 * ctx.w.gold * H * 0.55 * prof.econ;
      case 'capital': return lv === 1 ? 6 + (ctx.roundsLeft > 12 ? 3 : 0) : 7 + (ctx.roundsLeft > 10 ? 3 : 0);
      case 'granary': return ['food', 'mat', 'gold'].some(k => ctx.p.res[k] >= ctx.inc.cap - 2) ? 5 : 0.5;
      case 'tower': return threat > 0 ? 3 + threat * 0.05 * prof.def : 1 * prof.def;
      case 'outpost': return (threat > 0 || st.map.relics.some(r => g.dist(r, b.cell) <= 2)) ? 3 * prof.def : 0.3;
      case 'wall': return threat > 0 ? 2.5 * prof.def : 0;
      case 'barracks': return st.round >= 6 && ctx.inc.net.food >= 3 ? 4 * prof.mil : 0;
      case 'shrine': return Math.min(ctx.roundsLeft, 14) * 1.5 * prof.vp;
      default: return 0;
    }
  }
  function trainingPlan(ctx) {
    const { st, id, p } = ctx, out = [];
    const sites = ctx.myBuildings.filter(b => b.type === 'barracks' || b.type === 'workshop' || b.type === 'capital');
    if (!sites.length) return out;
    const want = desiredArmy(ctx) - ctx.myUnits.length;
    let foodRoom = ctx.inc.net.food + Math.floor(p.res.food / 6);
    const tags = {}; for (const u of ctx.enemyUnits) if (u.owner) for (const t of UNITS[u.type].tags) tags[t] = (tags[t] || 0) + 1;
    const owned = new Set([...p.deck, ...p.hand, ...p.discard].map(c => c.k));
    for (const b of sites) {
      let pick = null;
      const foodFull = p.res.food >= ctx.inc.cap - 4;
      if ((want > 0 || foodFull) && foodRoom >= 2) {
        if (b.type === 'workshop') pick = owned.has('catapult') && ctx.enemyBuildings.some(e => e.owner) ? 'catapult' : null;
        else {
          let best = -Infinity;
          for (const k of ['militia', 'spear', 'archer', 'cavalry']) {
            if (k !== 'militia' && !owned.has(k)) continue;
            const d = UNITS[k]; let v = d.hp * (d.atk + 0.5) / 10 - d.upkeep * 1.2;
            if (d.bonus) for (const [t, x] of Object.entries(d.bonus)) v += (tags[t] || 0) * x * 0.25;
            if (k === 'militia') v -= st.round > 8 ? 1.5 : 0;
            if (v > best) { best = v; pick = k; }
          }
        }
        if (pick) foodRoom -= UNITS[pick].upkeep + 1;
      }
      if ((b.train || null) !== pick && !E.trainError(st, id, b, pick)) out.push({ type: 'train', target: b.cell, unit: pick });
    }
    return out;
  }
  function canPayRes(res, cost) { if (!cost) return true; for (const k of ['food', 'mat', 'gold']) if ((cost[k] || 0) > res[k]) return false; return true; }

  function decide(st, id, profileName = 'balanced') {
    if (E.currentPlayer(st) !== id) return null;
    const ctx = context(st, id, profileName), { p } = ctx;
    // A. free economy cards
    for (const c of p.hand) {
      const def = CARDS[c.k]; if (def.kind !== 'econ') continue;
      if (c.k === 'purge') {
        const deckSize = p.deck.length + p.hand.length + p.discard.length;
        const junk = p.hand.filter(o => o.id !== c.id && (o.k === 'survey' || o.k === 'tax' || (o.k === 'militia' && st.round >= 5))).slice(0, 2).map(o => o.id);
        if (junk.length && deckSize >= 12) return { type: 'play', card: c.id, targets: junk };
        continue;
      }
      if (c.k === 'mobilize' && !p.hand.some(o => CARDS[o.k].ap && o.id !== c.id)) continue;
      if (!E.playError(st, id, { card: c.id })) return { type: 'play', card: c.id };
    }
    // B. command-point plays
    if (p.ap > 0) {
      const cands = candidatesFor(ctx);
      // ties (and near-ties) are broken by a per-game hash of the target cell so
      // that no board direction is systematically preferred
      const salt = E.hashString(st.seed + ':' + id);
      const jit = c => c.v + (E.mix32(salt + (c.action.target ?? 0) * 7919 + (c.action.card || 0)) / 4294967296) * 0.05;
      cands.sort((a, b) => jit(b) - jit(a));
      if (cands.length && cands[0].v >= 1.2) return cands[0].action;
    }
    // B2. upgrades (resources only); keep a little gold for the market early on
    {
      let best = null, bv = 0.8;
      for (const b of ctx.myBuildings) {
        if (E.upgradeError(st, id, b.cell)) continue;
        const step = E.UPGRADES[b.type][(b.lvl || 1) - 1];
        if ((step.cost.gold || 0) > p.res.gold - (st.round < 6 ? 3 : 0)) continue;
        const v = upgradeValue(ctx, b) - costValue(ctx, step.cost) * 0.8;
        if (v > bv) { bv = v; best = b; }
      }
      if (best) return { type: 'upgrade', target: best.cell };
    }
    // B3. bank: never let a resource overflow
    {
      const cap = ctx.inc.cap, rate = E.tradeRate(st, id);
      const full = ['food', 'mat', 'gold'].filter(k => p.res[k] + Math.max(0, ctx.inc.net[k]) > cap + 1 && p.res[k] >= rate).sort((a, b) => p.res[b] - p.res[a]);
      if (full.length) {
        const want = ['gold', 'mat', 'food'].filter(k => k !== full[0] && p.res[k] < cap - 2).sort((a, b) => ctx.w[b] * (a === 'gold' ? 1 : 1) - ctx.w[a] * 1 || (b === 'gold') - (a === 'gold'));
        if (want.length) return { type: 'trade', give: full[0], get: want[0] };
      }
    }
    // C. market: sell dead cards to afford the best purchase, then buy
    const flush = p.res.gold >= ctx.inc.cap - 3;
    const offers = st.market.row.map((c, slot) => ({ slot, k: c.k, price: CARDS[c.k].price, v: marketValue(ctx, c.k) }))
      .filter(o => o.v >= (flush ? 0.8 : 1.3)).sort((a, b) => (b.v - b.price * 0.2) - (a.v - a.price * 0.2) || a.slot - b.slot);
    const deadCards = p.hand.filter(c => CARDS[c.k].kind === 'vp' || (CARDS[c.k].ap && !canPayRes(p.res, CARDS[c.k].cost)) || (CARDS[c.k].ap && p.ap <= 0));
    const keepId = keepChoice(ctx);
    for (const [k, o] of offers.entries()) {
      if (p.res.gold >= o.price) return { type: 'buy', slot: o.slot };
      const sell = deadCards.find(c => c.id !== keepId);
      if (k === 0 && sell && p.res.gold + deadCards.filter(c => c.id !== keepId).length >= o.price) return { type: 'sell', card: sell.id };
      // save for the best offer when it is within next round's income, unless gold would overflow
      if (k === 0 && !flush && p.res.gold + ctx.inc.gold >= o.price) break;
    }
    // D0. barracks and workshop training
    const tp = trainingPlan(ctx); if (tp.length) return tp[0];
    // D. unit orders
    const plan = militaryPlan(ctx);
    const groups = new Map();
    for (const u of ctx.myUnits) {
      const o = plan.get(u.id); if (!o) continue;
      const same = o.stance === 'advance' ? (u.stance === 'advance' && u.goal === o.cell) : (u.stance === o.stance && u.anchor === o.cell);
      if (same) continue;
      const key = o.stance + ':' + o.cell; if (!groups.has(key)) groups.set(key, { ...o, units: [] }); groups.get(key).units.push(u.id);
    }
    for (const gr of groups.values()) return { type: 'order', unit: gr.units, stance: gr.stance, target: gr.cell };
    // E. end the turn, keeping the most useful leftover card
    const keep = keepChoice(ctx);
    return keep ? { type: 'end', keep } : { type: 'end' };
  }
  function keepChoice(ctx) {
    const { p } = ctx;
    let best = null, bv = 0;
    for (const c of p.hand) {
      const def = CARDS[c.k]; if (def.kind === 'vp') continue;
      const v = def.price + (def.kind === 'build' ? 1 : 0) + (c.k === 'mobilize' || c.k === 'treasury' ? 2 : 0);
      if (v > bv) { bv = v; best = c.id; }
    }
    return best;
  }

  // Play out a full turn for a bot; returns the list of actions taken.
  function playTurn(st, id, profileName, limit = 60) {
    const taken = [];
    for (let k = 0; k < limit; k++) {
      let a = decide(st, id, profileName);
      if (!a) return taken;
      let r = E.act(st, id, a);
      if (!r.ok) { a = { type: 'end' }; r = E.act(st, id, a); }
      taken.push(a);
      if (a.type === 'end') return taken;
    }
    E.act(st, id, { type: 'end' }); taken.push({ type: 'end' });
    return taken;
  }

  return { PROFILES, PROFILE_ORDER, decide, playTurn, militaryPlan: (st, id, prof) => militaryPlan(context(st, id, prof)) };
});
