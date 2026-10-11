/* Public-observation presentation helpers. No game mutation, timers, or secrets. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AutoHexVisuals = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  function supplyForest(view, adjacency) {
    const result = [];
    for (let owner = 1; owner <= 6; owner++) {
      const home = view.players[owner]?.home;
      if (!Number.isInteger(home) || view.board[home] !== owner || !view.supplied[home]) continue;
      const links = new Map();
      for (const b of view.bridges || []) if (b.owner === owner && view.board[b.a] === owner && view.board[b.b] === owner) {
        if (!links.has(b.a)) links.set(b.a, []); if (!links.has(b.b)) links.set(b.b, []);
        links.get(b.a).push(b.b); links.get(b.b).push(b.a);
      }
      const queue = [home], visited = new Set(queue);
      for (let k = 0; k < queue.length; k++) {
        const a = queue[k];
        for (const [candidates, bridge] of [[adjacency[a] || [], false], [links.get(a) || [], true]]) {
          for (const b of candidates) if (!visited.has(b) && view.board[b] === owner && view.supplied[b]) {
            visited.add(b); queue.push(b); result.push({ a, b, owner, bridge });
          }
        }
      }
    }
    return result;
  }
  function inspectTurret(view, cell, cells, distance) {
    const turret = (view.turrets || []).find(t => t.cell === cell && view.board[t.cell] === t.owner);
    if (!turret) return null;
    const allies = new Set([turret.owner]);
    for (const a of view.alliances || []) if (a.expiresRound > view.round) {
      if (a.a === turret.owner) allies.add(a.b); if (a.b === turret.owner) allies.add(a.a);
    }
    const range = cells.filter(c => distance(cell, c.i) <= 3).map(c => c.i);
    const targets = range.filter(i => view.board[i] && !allies.has(view.board[i]) && !view.anchors[i]);
    return { cell, owner: turret.owner, radius: 3, cells: range, targets, countdown: turret.countdown, life: turret.life };
  }
  class Effects {
    constructor() { this.clear(); }
    clear() { this.effects = []; this.seen = new Set(); }
    clearActive() { this.effects = []; }
    ingest(events, activeMs) {
      for (const e of events || []) {
        const id = e.id === undefined ? `${e.ply}:${e.type}:${e.player}:${(e.cells || []).join(',')}:${e.origin ?? ''}` : e.id;
        if (this.seen.has(id)) continue;
        this.seen.add(id);
        if (this.seen.size > 256) this.seen.delete(this.seen.values().next().value);
        if (!['destroy', 'shield-block', 'capture', 'supply-retreat', 'neutral-strike', 'neutral-block', 'airdrop'].includes(e.type)) continue;
        const cells = (e.type === 'airdrop' ? (e.cells || []).slice(-1) : e.cells || []).filter(i => Number.isInteger(i) && i >= 0).slice(0, 96);
        if (!cells.length) continue;
        const age = Math.max(0, activeMs - (Number.isFinite(e.activeMs) ? e.activeMs : activeMs));
        const duration = e.type === 'supply-retreat' ? 1900 : 1600;
        if (age >= duration) continue;
        this.effects.push({ id, type: e.type, player: e.player, origin: Number.isInteger(e.origin) ? e.origin : null, cells, source: e.source || (e.type === 'airdrop' ? 'airdrop' : null), from: e.from || null, age, duration });
        if (this.effects.length > 64) this.effects.shift();
      }
    }
    advance(deltaMs) {
      if (!Number.isFinite(deltaMs) || deltaMs <= 0) return false;
      const before = this.effects.length;
      for (const effect of this.effects) effect.age += deltaMs;
      this.effects = this.effects.filter(e => e.age < e.duration);
      return before > 0;
    }
    snapshot() { return { effects: this.effects.map(e => ({ ...e, cells: e.cells.slice() })), seenCount: this.seen.size, limit: 64 }; }
  }
  return { supplyForest, inspectTurret, Effects };
});
