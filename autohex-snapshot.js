/* AutoHex battle snapshot: records public events and draws the last 18 turns onto one map image.
   Reads only public observations; never mutates the game or reveals hands. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AutoHexSnapshot = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const TURNS = 18; // 回合 = one faction's action; 18 turns is three full cycles of six factions
  const INK = '#2e3440', NEUTRAL = '#8a6d3b', SHIELD = '#4d739e', BEFORE = -1e9;
  const SHOT_SOURCES = ['turret', 'bombard'];
  const cellOk = i => Number.isInteger(i) && i >= 0;

  class Chronicle {
    constructor() { this.clear(); }
    clear() { this.events = []; this.plans = []; this.lastEventId = 0; this.planKeys = new Set(); this.board = null; this.since = null; this.losses = []; }
    record(view) {
      if (!view) return;
      // Ownership history: when each stone arrived, and which stones disappeared.
      const board = view.board || [];
      if (!this.board || this.board.length !== board.length) { this.board = Array.from(board); this.since = this.board.map(() => BEFORE); }
      else for (let i = 0; i < board.length; i++) {
        const before = this.board[i], now = board[i]; if (before === now) continue;
        if (before) this.losses.push({ cell: i, owner: before, ply: view.ply });
        this.since[i] = now ? view.ply : BEFORE; this.board[i] = now;
      }
      for (const e of view.events || []) {
        if (!Number.isInteger(e.id) || e.id <= this.lastEventId) continue;
        this.lastEventId = e.id;
        this.events.push({ ...e, cells: Array.isArray(e.cells) ? e.cells.filter(cellOk) : [] });
      }
      (view.intents || []).forEach((intent, p) => {
        if (!intent || intent.player !== p) return;
        const path = Array.isArray(intent.path) ? intent.path.filter(cellOk).slice(0, 16) : [];
        const target = cellOk(intent.target) ? intent.target : null;
        if (path.length < 2 && target === null) return;
        // One entry per committed strategy; its corridor follows the latest public path.
        const key = `${p}:${Number.isFinite(intent.committedAtPly) ? intent.committedAtPly : ''}:${intent.type}:${target}`;
        if (this.planKeys.has(key)) { const plan = this.plans.find(v => v.key === key); if (plan) { plan.lastPly = view.ply; if (path.length > 1) plan.path = path; } return; }
        this.planKeys.add(key);
        this.plans.push({ key, player: p, type: intent.type, target, path, ply: view.ply, lastPly: view.ply });
      });
      this.prune(view.ply);
    }
    prune(ply) {
      const min = (Number(ply) || 0) - TURNS - 6;
      if (this.events.length && this.events[0].ply < min) this.events = this.events.filter(e => e.ply >= min);
      if (this.losses.length && this.losses[0].ply < min) this.losses = this.losses.filter(e => e.ply >= min);
      if (this.plans.some(p => p.lastPly < min)) {
        this.plans = this.plans.filter(p => p.lastPly >= min);
        this.planKeys = new Set(this.plans.map(p => p.key));
      }
    }
  }

  function summarize(chronicle, view, turns = TURNS) {
    // The last `turns` completed actions, plus turret fire at the start of the turn now pending.
    const toPly = view.ply, fromPly = Math.max(0, toPly - turns);
    const inWindow = x => x.ply >= fromPly && x.ply <= toPly;
    const events = chronicle.events.filter(inWindow), players = view.players.length - 1;
    const stats = Array.from({ length: players + 1 }, () => ({ shots: 0, kills: 0, captures: 0, losses: 0, retreats: 0, plans: 0 }));
    const since = chronicle.since || [], gains = [], ghosts = new Map();
    view.board.forEach((owner, i) => { if (owner && !view.anchors?.[i] && since[i] >= fromPly) gains.push({ cell: i, player: owner, ply: since[i] }); });
    for (const loss of chronicle.losses || []) if (inWindow(loss) && view.board[loss.cell] !== loss.owner) ghosts.set(loss.cell, loss);
    for (const [cell, loss] of ghosts) if (view.board[cell] === loss.owner) ghosts.delete(cell);
    const out = { fromPly, toPly, gains, ghosts: [...ghosts.values()], shots: [], kills: [], captures: [], retreats: [], airdrops: [], milestones: [], plans: chronicle.plans.filter(p => p.lastPly >= fromPly), stats };
    const add = (p, key, n = 1) => { if (stats[p]) stats[p][key] += n; };
    for (const e of events) {
      const cell = e.cells[e.cells.length - 1];
      if ((e.type === 'destroy' || e.type === 'shield-block') && SHOT_SOURCES.includes(e.source) && cellOk(e.origin) && cellOk(cell)) {
        out.shots.push({ ply: e.ply, kind: e.source, from: e.origin, to: cell, player: e.player, victim: e.from || 0, blocked: e.type === 'shield-block' });
        add(e.player, 'shots');
      }
      if ((e.type === 'destroy' || e.type === 'neutral-strike') && cellOk(cell)) {
        out.kills.push({ ply: e.ply, cell, player: e.player || 0, victim: e.from || 0, source: e.source || '' });
        add(e.player, 'kills'); add(e.from, 'losses');
      } else if (e.type === 'capture' && cellOk(cell)) {
        out.captures.push({ ply: e.ply, cell, player: e.player, victim: e.from || 0 });
        add(e.player, 'captures'); add(e.from, 'losses');
      } else if (e.type === 'supply-retreat' || e.type === 'hill-retreat') {
        if (!e.cells.length) continue;
        out.retreats.push({ ply: e.ply, cells: e.cells.slice(0, 96), player: e.player, count: e.cells.length });
        add(e.player, 'retreats', e.cells.length); add(e.player, 'losses', e.cells.length);
      } else if (e.type === 'airdrop' && cellOk(cell)) {
        out.airdrops.push({ ply: e.ply, from: cellOk(e.origin) ? e.origin : e.cells[0], to: cell, player: e.player });
        out.milestones.push({ ply: e.ply, kind: 'airdrop', player: e.player });
      } else if (['goal-arrival', 'goal-lost', 'accept', 'betray', 'airport-unlocked'].includes(e.type)) {
        out.milestones.push({ ply: e.ply, kind: e.type, player: e.player, target: e.target || 0 });
      }
    }
    for (const plan of out.plans) add(plan.player, 'plans');
    return out;
  }

  /* ---------- Icon primitives (shared by map, timeline and legend) ---------- */
  function burst(ctx, x, y, s, color) {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.2, s * .16); ctx.lineCap = 'round'; ctx.beginPath();
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4 + Math.PI / 8, r0 = s * (k % 2 ? .42 : .3), r1 = s * (k % 2 ? .78 : .95); ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0); ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1); }
    ctx.stroke(); ctx.restore();
  }
  function cross(ctx, x, y, s, color) {
    ctx.save(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, s * .5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.4, s * .2); ctx.lineCap = 'round'; const r = s * .32;
    ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke(); ctx.restore();
  }
  function crosshair(ctx, x, y, s, color) {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.1, s * .13); ctx.beginPath(); ctx.arc(x, y, s * .45, 0, Math.PI * 2);
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; ctx.moveTo(x + Math.cos(a) * s * .25, y + Math.sin(a) * s * .25); ctx.lineTo(x + Math.cos(a) * s * .8, y + Math.sin(a) * s * .8); }
    ctx.stroke(); ctx.restore();
  }
  function ring(ctx, x, y, s, color) {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, s * .12); ctx.setLineDash([s * .18, s * .14]); ctx.beginPath(); ctx.arc(x, y, s * .42, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }
  function shield(ctx, x, y, s, color = SHIELD) {
    ctx.save(); ctx.fillStyle = '#ffffffd8'; ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.2, s * .13); ctx.lineJoin = 'round'; ctx.beginPath();
    ctx.moveTo(x, y - s * .55); ctx.lineTo(x + s * .45, y - s * .36); ctx.quadraticCurveTo(x + s * .42, y + s * .3, x, y + s * .58); ctx.quadraticCurveTo(x - s * .42, y + s * .3, x - s * .45, y - s * .36); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  }
  function diamond(ctx, x, y, s, color, fill = false) {
    ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = Math.max(1, s * .12); ctx.beginPath(); ctx.moveTo(x, y - s * .5); ctx.lineTo(x + s * .5, y); ctx.lineTo(x, y + s * .5); ctx.lineTo(x - s * .5, y); ctx.closePath(); fill ? ctx.fill() : ctx.stroke(); ctx.restore();
  }
  function flag(ctx, x, y, s, color, broken = false) {
    ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = Math.max(1.2, s * .12); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - s * .3, y + s * .5); ctx.lineTo(x - s * .3, y - s * .5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - s * .3, y - s * .5); ctx.lineTo(x + s * .42, y - s * .3); ctx.lineTo(x - s * .3, y - s * .08); ctx.closePath(); broken ? ctx.stroke() : ctx.fill();
    if (broken) { ctx.beginPath(); ctx.moveTo(x - s * .5, y + s * .2); ctx.lineTo(x + s * .5, y - s * .1); ctx.stroke(); }
    ctx.restore();
  }
  function links(ctx, x, y, s, color, broken = false) {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.2, s * .12);
    for (const dx of [-.18, .18]) { ctx.beginPath(); ctx.arc(x + dx * s, y, s * .28, broken ? (dx < 0 ? .5 : Math.PI + .5) : 0, broken ? (dx < 0 ? Math.PI * 2 - .5 : Math.PI * 3 - .5) : Math.PI * 2); ctx.stroke(); }
    ctx.restore();
  }
  function plane(ctx, x, y, s, color) {
    ctx.save(); ctx.fillStyle = color; ctx.beginPath();
    const pts = [[0, -.5], [.08, -.08], [.46, .12], [.44, .24], [.08, .14], [.07, .34], [.18, .44], [-.18, .44], [-.07, .34], [-.08, .14], [-.44, .24], [-.46, .12], [-.08, -.08]];
    pts.forEach(([px, py], k) => k ? ctx.lineTo(x + px * s, y + py * s) : ctx.moveTo(x + px * s, y + py * s)); ctx.closePath(); ctx.fill(); ctx.restore();
  }
  function turretGlyph(ctx, x, y, s, color) {
    ctx.save(); ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - s * .45, y + s * .38); ctx.lineTo(x + s * .45, y + s * .38); ctx.lineTo(x + s * .3, y - s * .08); ctx.lineTo(x - s * .3, y - s * .08); ctx.closePath(); ctx.fill();
    ctx.lineWidth = s * .2; ctx.beginPath(); ctx.moveTo(x, y - s * .05); ctx.lineTo(x + s * .32, y - s * .5); ctx.stroke(); ctx.restore();
  }
  function house(ctx, x, y, s, color) {
    ctx.save(); ctx.fillStyle = color; ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1.2, s * .1); ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(x, y - s * .6); ctx.lineTo(x + s * .55, y - s * .08); ctx.lineTo(x + s * .4, y - s * .08); ctx.lineTo(x + s * .4, y + s * .5); ctx.lineTo(x - s * .4, y + s * .5); ctx.lineTo(x - s * .4, y - s * .08); ctx.lineTo(x - s * .55, y - s * .08); ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillRect(x - s * .1, y + s * .14, s * .2, s * .36); ctx.restore();
  }
  function ownerShape(ctx, owner, x, y, r) {
    ctx.beginPath();
    if (owner === 1) { ctx.arc(x, y, r, 0, Math.PI * 2); return; }
    const sides = [0, 0, 4, 3, 4, 5, 6][owner] || 6, turn = owner === 2 ? 0 : -Math.PI / 2 + (owner === 4 ? Math.PI / 4 : 0);
    for (let k = 0; k < sides; k++) { const a = turn + k * Math.PI * 2 / sides; k ? ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r) : ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
    ctx.closePath();
  }
  function milestoneIcon(ctx, m, x, y, s, color) {
    if (m.kind === 'goal-arrival') flag(ctx, x, y, s, color);
    else if (m.kind === 'goal-lost') flag(ctx, x, y, s, color, true);
    else if (m.kind === 'accept') links(ctx, x, y, s, color);
    else if (m.kind === 'betray') links(ctx, x, y, s, color, true);
    else if (m.kind === 'airport-unlocked') plane(ctx, x, y, s, color);
    else turretGlyph(ctx, x, y, s * .9, color);
  }

  /* ---------- Map-only image: every change in the window is drawn on the board ---------- */
  function layout(geo) {
    const W = 1400, pad = 24, xs = geo.points.map(p => p.x), ys = geo.points.map(p => p.y);
    const minX = Math.min(...xs) - 1.2, maxX = Math.max(...xs) + 1.2, minY = Math.min(...ys) - 1.2, maxY = Math.max(...ys) + 1.2;
    const unit = (W - pad * 2) / (maxX - minX), H = Math.round((maxY - minY) * unit) + pad * 2;
    return { W, H, map: { x: pad, y: pad, w: W - pad * 2, h: H - pad * 2, unit, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 } };
  }

  function draw(canvas, data, geo, options = {}) {
    const L = layout(geo), dpr = options.pixelRatio || 2;
    canvas.width = Math.round(L.W * dpr); canvas.height = Math.round(L.H * dpr);
    const ctx = canvas.getContext('2d'), C = geo.colors, view = data.view, s = data.summary;
    const color = p => C[p] || NEUTRAL;
    // Older changes fade, the newest are fully saturated: time is read from intensity alone.
    const span = Math.max(1, s.toPly - s.fromPly), fade = t => .3 + .7 * Math.max(0, Math.min(1, (t - s.fromPly) / span));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#f6f8fa'; ctx.fillRect(0, 0, L.W, L.H);
    const M = L.map, P = i => ({ x: M.x + M.w / 2 + (geo.points[i].x - M.cx) * M.unit, y: M.y + M.h / 2 + (geo.points[i].y - M.cy) * M.unit });
    const hexR = M.unit * .96, hex = (p, r = hexR) => { ctx.beginPath(); for (let k = 0; k < 6; k++) { const a = Math.PI / 3 * k + Math.PI / 6; k ? ctx.lineTo(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r) : ctx.moveTo(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r); } ctx.closePath(); };
    const gained = new Map(s.gains.map(g => [g.cell, g]));

    // Terrain and territory: ground held since before the window is pale; new ground is tinted by age.
    for (let i = 0; i < geo.points.length; i++) {
      const p = P(i), t = view.terrain[i], river = t === 'river' || t === 1, hill = t === 'hill' || t === 2, owner = view.board[i];
      hex(p); ctx.fillStyle = river ? '#ebf3f7' : hill ? '#f6f2e8' : '#fbfcfd'; ctx.fill();
      if (owner) { ctx.save(); ctx.globalAlpha = gained.has(i) ? .35 + .4 * fade(gained.get(i).ply) : .22; ctx.fillStyle = geo.tints[owner] || '#eef1f4'; ctx.fill(); ctx.restore(); }
      ctx.strokeStyle = '#e6ecef'; ctx.lineWidth = .6; ctx.stroke();
    }
    ctx.save(); ctx.globalAlpha = .22; ctx.lineWidth = 1;
    for (const link of data.supply || []) { const a = P(link.a), b = P(link.b); ctx.strokeStyle = color(link.owner); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    ctx.restore();
    for (const b of view.bridges || []) { const a = P(b.a), z = P(b.b); ctx.save(); ctx.strokeStyle = color(b.owner); ctx.globalAlpha = .5; ctx.lineWidth = 2.4; ctx.setLineDash([5, 3]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(z.x, z.y); ctx.stroke(); ctx.restore(); }
    // Lost ground: a hollow dashed ghost of the stone that used to stand there.
    for (const g of s.ghosts) { const p = P(g.cell); ctx.save(); ctx.globalAlpha = fade(g.ply) * .75; ownerShape(ctx, g.owner, p.x, p.y, M.unit * .34); ctx.strokeStyle = color(g.owner); ctx.lineWidth = 1.2; ctx.setLineDash([2.5, 2]); ctx.stroke(); ctx.restore(); }
    // Stones: old holdings muted, stones placed inside the window drawn by age with a faction rim.
    for (let i = 0; i < geo.points.length; i++) {
      const owner = view.board[i]; if (!owner || view.anchors[i]) continue;
      const p = P(i), g = gained.get(i), broken = view.supplied && !view.supplied[i];
      ctx.save(); ctx.globalAlpha = g ? fade(g.ply) : .38; ownerShape(ctx, owner, p.x, p.y, M.unit * (g ? .38 : .3));
      if (broken) { ctx.strokeStyle = color(owner); ctx.lineWidth = 1.3; ctx.stroke(); } else { ctx.fillStyle = color(owner); ctx.fill(); }
      if (g) { hex(p, hexR * .9); ctx.globalAlpha = fade(g.ply) * .55; ctx.strokeStyle = color(owner); ctx.lineWidth = 1.2; ctx.stroke(); }
      ctx.restore();
    }
    for (const a of view.airports || []) { const p = P(a.cell), r = M.unit * .62, c = a.owner ? color(a.owner) : '#8394a3'; ctx.save(); ctx.globalAlpha = .8; ctx.strokeStyle = c; ctx.lineWidth = 1.3; ctx.fillStyle = '#fff'; ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2); ctx.strokeRect(p.x - r, p.y - r, r * 2, r * 2); plane(ctx, p.x, p.y, r * 1.6, c); ctx.restore(); }
    for (const d of view.depots || []) { const p = P(d.cell), c = d.owner ? color(d.owner) : '#a28b56', r = M.unit * .26; ctx.save(); ctx.globalAlpha = .8; ctx.fillStyle = '#fffcf2'; ctx.strokeStyle = c; ctx.lineWidth = 1.2; ctx.fillRect(p.x - r * 1.6, p.y - r * 1.3, r * 3.2, r * 2.6); ctx.strokeRect(p.x - r * 1.6, p.y - r * 1.3, r * 3.2, r * 2.6); ctx.fillStyle = c; ctx.fillRect(p.x - r, p.y - r * .7, r * 2, r * 1.4); ctx.restore(); }
    for (const t of view.turrets || []) { const p = P(t.cell); ctx.save(); ctx.globalAlpha = .85; turretGlyph(ctx, p.x, p.y, M.unit * 1.05, color(t.owner)); ctx.restore(); }
    for (let pl = 1; pl < view.players.length; pl++) { const h = view.players[pl]?.home; if (cellOk(h)) { const p = P(h); house(ctx, p.x, p.y, M.unit * 1.6, color(pl)); } }

    // Strategy: very, very faint thin dashes and small hollow target diamonds.
    for (const plan of s.plans) {
      const pts = plan.path.map(P); ctx.save(); ctx.globalAlpha = .08 + .12 * fade(plan.ply); ctx.strokeStyle = color(plan.player);
      ctx.lineWidth = 1.3; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.setLineDash([3, 6]);
      if (pts.length > 1) { ctx.beginPath(); pts.forEach((p, k) => k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke(); }
      ctx.setLineDash([]); if (plan.target !== null) { const t = P(plan.target); diamond(ctx, t.x, t.y, M.unit * .62, color(plan.player)); }
      ctx.restore();
    }
    for (const r of s.retreats) for (const i of r.cells) { const p = P(i); ctx.save(); ctx.globalAlpha = fade(r.ply) * .85; ring(ctx, p.x, p.y, M.unit * 1.05, color(r.player)); ctx.restore(); }
    for (const a of s.airdrops) { if (!cellOk(a.from)) continue; const o = P(a.from), t = P(a.to); ctx.save(); ctx.globalAlpha = fade(a.ply) * .7; arc(ctx, o, t, .3, color(a.player), 1.4, [2, 4]); turretGlyph(ctx, t.x, t.y, M.unit * 1.1, color(a.player)); ctx.restore(); }
    for (const c of s.captures) { const p = P(c.cell); ctx.save(); ctx.globalAlpha = fade(c.ply); crosshair(ctx, p.x, p.y, M.unit * 1.15, color(c.player)); ctx.restore(); }
    for (const shot of s.shots) {
      const o = P(shot.from), t = P(shot.to), air = shot.kind === 'bombard';
      ctx.save(); ctx.globalAlpha = fade(shot.ply) * (air ? .85 : .7);
      arc(ctx, o, t, air ? .34 : .2, color(shot.player), air ? 2 : 1.4, air ? [7, 4] : []);
      if (shot.blocked) shield(ctx, t.x, t.y, M.unit * 1.1, SHIELD); else burst(ctx, t.x, t.y, M.unit * 1.05, color(shot.player));
      ctx.restore();
    }
    for (const k of s.kills) { const p = P(k.cell); ctx.save(); ctx.globalAlpha = fade(k.ply); cross(ctx, p.x, p.y, M.unit * .9, k.victim ? color(k.victim) : INK); ctx.restore(); }
    // Milestones sit at the actor's home: a flag for reaching the far edge, linked rings for pacts.
    const perHome = new Map();
    for (const m of s.milestones) {
      const h = view.players[m.player]?.home; if (!cellOk(h)) continue;
      const n = perHome.get(h) || 0; if (n >= 4) continue; perHome.set(h, n + 1);
      const p = P(h); ctx.save(); ctx.globalAlpha = fade(m.ply); milestoneIcon(ctx, m, p.x + M.unit * (1.5 + n * 1.1), p.y - M.unit * 1.1, M.unit * 1.1, color(m.player)); ctx.restore();
    }
    return { width: canvas.width, height: canvas.height, layout: L };
  }
  function arc(ctx, a, b, bend, color, width, dash) {
    // Bow every trajectory upward like an artillery arc, so shots never sit on the hex row.
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, flip = dx / len > 0 ? 1 : -1;
    const cx = (a.x + b.x) / 2 + dy * bend * flip, cy = (a.y + b.y) / 2 - dx * bend * flip;
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.setLineDash(dash || []);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(cx, cy, b.x, b.y); ctx.stroke();
    ctx.setLineDash([]); ctx.fillStyle = color; ctx.beginPath(); ctx.arc(a.x, a.y, Math.max(1.6, width), 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  return { TURNS, Chronicle, summarize, draw, layout };
});
