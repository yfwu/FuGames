/* AutoHex battle snapshot: records public events and draws an 18-round summary image.
   Reads only public observations; never mutates the game or reveals hands. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AutoHexSnapshot = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const ROUNDS = 18;
  const FONT = '"PingFang TC","Noto Sans TC","Microsoft JhengHei","Heiti TC",system-ui,sans-serif';
  const INK = '#2e3440', MUTED = '#657283', LINE = '#e1e8ec', NEUTRAL = '#8a6d3b', SHIELD = '#4d739e';
  const SHOT_SOURCES = ['turret', 'bombard'];
  const ROWS = [
    { key: 'shots', label: '砲擊' }, { key: 'kills', label: '消滅' }, { key: 'captures', label: '攻占' },
    { key: 'retreats', label: '撤退' }, { key: 'plans', label: '策略' }, { key: 'milestones', label: '要事' }
  ];
  const cellOk = i => Number.isInteger(i) && i >= 0;

  class Chronicle {
    constructor() { this.clear(); }
    clear() { this.events = []; this.plans = []; this.lastEventId = 0; this.planKeys = new Set(); }
    record(view) {
      if (!view) return;
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
        if (this.planKeys.has(key)) { const plan = this.plans.find(v => v.key === key); if (plan && path.length > 1) plan.path = path; return; }
        this.planKeys.add(key);
        this.plans.push({ key, player: p, type: intent.type, target, path, round: view.round, ply: view.ply });
      });
      this.prune(view.round);
    }
    prune(round) {
      const min = (Number(round) || 0) - ROUNDS - 1;
      if (this.events.length && this.events[0].round < min) this.events = this.events.filter(e => e.round >= min);
      if (this.plans.length && this.plans[0].round < min) {
        this.plans = this.plans.filter(p => p.round >= min);
        this.planKeys = new Set(this.plans.map(p => p.key));
      }
    }
  }

  function summarize(chronicle, view, rounds = ROUNDS) {
    const toRound = view.round, fromRound = Math.max(0, toRound - rounds + 1);
    const inWindow = x => x.round >= fromRound && x.round <= toRound;
    const events = chronicle.events.filter(inWindow), players = view.players.length - 1;
    const stats = Array.from({ length: players + 1 }, () => ({ shots: 0, kills: 0, captures: 0, losses: 0, retreats: 0, plans: 0 }));
    const out = { fromRound, toRound, shots: [], kills: [], captures: [], retreats: [], airdrops: [], milestones: [], plans: chronicle.plans.filter(inWindow), stats };
    const add = (p, key, n = 1) => { if (stats[p]) stats[p][key] += n; };
    for (const e of events) {
      const cell = e.cells[e.cells.length - 1];
      if ((e.type === 'destroy' || e.type === 'shield-block') && SHOT_SOURCES.includes(e.source) && cellOk(e.origin) && cellOk(cell)) {
        out.shots.push({ round: e.round, kind: e.source, from: e.origin, to: cell, player: e.player, victim: e.from || 0, blocked: e.type === 'shield-block' });
        add(e.player, 'shots');
      }
      if ((e.type === 'destroy' || e.type === 'neutral-strike') && cellOk(cell)) {
        out.kills.push({ round: e.round, cell, player: e.player || 0, victim: e.from || 0, source: e.source || '' });
        add(e.player, 'kills'); add(e.from, 'losses');
      } else if (e.type === 'capture' && cellOk(cell)) {
        out.captures.push({ round: e.round, cell, player: e.player, victim: e.from || 0 });
        add(e.player, 'captures'); add(e.from, 'losses');
      } else if (e.type === 'supply-retreat' || e.type === 'hill-retreat') {
        if (!e.cells.length) continue;
        out.retreats.push({ round: e.round, cells: e.cells.slice(0, 96), player: e.player, count: e.cells.length });
        add(e.player, 'retreats', e.cells.length); add(e.player, 'losses', e.cells.length);
      } else if (e.type === 'airdrop' && cellOk(cell)) {
        out.airdrops.push({ round: e.round, from: cellOk(e.origin) ? e.origin : e.cells[0], to: cell, player: e.player });
        out.milestones.push({ round: e.round, kind: 'airdrop', player: e.player });
      } else if (['goal-arrival', 'goal-lost', 'accept', 'betray', 'airport-unlocked'].includes(e.type)) {
        out.milestones.push({ round: e.round, kind: e.type, player: e.player, target: e.target || 0 });
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
  function rowIcon(ctx, key, x, y, s, color) {
    if (key === 'shots') burst(ctx, x, y, s * .8, color);
    else if (key === 'kills') cross(ctx, x, y, s, color);
    else if (key === 'captures') crosshair(ctx, x, y, s * .9, color);
    else if (key === 'retreats') ring(ctx, x, y, s, color);
    else if (key === 'plans') { ctx.save(); ctx.strokeStyle = color; ctx.globalAlpha *= .6; ctx.lineWidth = 1.4; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(x - s * .7, y + s * .3); ctx.lineTo(x + s * .2, y - s * .1); ctx.stroke(); ctx.restore(); diamond(ctx, x + s * .4, y - s * .2, s * .5, color); }
    else flag(ctx, x, y, s * .9, color);
  }
  function milestoneIcon(ctx, m, x, y, s, color) {
    if (m.kind === 'goal-arrival') flag(ctx, x, y, s, color);
    else if (m.kind === 'goal-lost') flag(ctx, x, y, s, color, true);
    else if (m.kind === 'accept') links(ctx, x, y, s, color);
    else if (m.kind === 'betray') links(ctx, x, y, s, color, true);
    else if (m.kind === 'airport-unlocked') plane(ctx, x, y, s, color);
    else turretGlyph(ctx, x, y, s * .9, color);
  }

  /* ---------- Layout ---------- */
  function layout(geo) {
    const W = 1400, pad = 40, xs = geo.points.map(p => p.x), ys = geo.points.map(p => p.y);
    const minX = Math.min(...xs) - 1.6, maxX = Math.max(...xs) + 1.6, minY = Math.min(...ys) - 1.6, maxY = Math.max(...ys) + 1.6;
    const mapW = W - pad * 2, unit = mapW / (maxX - minX), mapH = Math.round((maxY - minY) * unit);
    const header = { y: 0, h: 128 }, map = { x: pad, y: header.h, w: mapW, h: mapH, unit, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
    const timeline = { x: pad, y: map.y + mapH + 28, w: mapW, rowH: 34, headH: 30, labelW: 96 };
    timeline.h = timeline.headH + ROWS.length * timeline.rowH;
    const cards = { x: pad, y: timeline.y + timeline.h + 28, w: mapW, h: 132 };
    const legend = { x: pad, y: cards.y + cards.h + 24, w: mapW, h: 92 };
    return { W, H: legend.y + legend.h + 30, pad, header, map, timeline, cards, legend };
  }

  function draw(canvas, data, geo, options = {}) {
    const L = layout(geo), dpr = options.pixelRatio || 2;
    canvas.width = Math.round(L.W * dpr); canvas.height = Math.round(L.H * dpr);
    const ctx = canvas.getContext('2d'), C = geo.colors, letter = p => String.fromCharCode(64 + p);
    const color = p => C[p] || NEUTRAL, view = data.view, s = data.summary;
    const span = Math.max(1, s.toRound - s.fromRound), fade = r => .32 + .68 * Math.max(0, Math.min(1, (r - s.fromRound) / span));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#f6f8fa'; ctx.fillRect(0, 0, L.W, L.H);
    const font = (size, weight = 400) => `${weight} ${size}px ${FONT}`;

    // Header: the only prose in the image sits here, away from the board.
    ctx.fillStyle = INK; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    ctx.font = font(13, 600); ctx.fillStyle = '#267477'; ctx.fillText('AUTOHEX · 戰局快照', L.pad, 46);
    ctx.font = font(34, 700); ctx.fillStyle = INK; ctx.fillText(`近 ${ROUNDS} 輪戰況 · 第 ${s.fromRound}–${s.toRound} 輪`, L.pad, 90);
    ctx.font = font(14); ctx.fillStyle = MUTED;
    ctx.fillText(`seed ${data.seed} · 第 ${view.ply.toLocaleString()} 次行動暫停 · ${data.clock}`, L.pad, 114);
    ctx.textAlign = 'right'; ctx.font = font(13); ctx.fillText('越新的動態越清晰', L.W - L.pad, 114);
    const grad = ctx.createLinearGradient(L.W - L.pad - 150, 0, L.W - L.pad, 0); grad.addColorStop(0, '#26747730'); grad.addColorStop(1, '#267477');
    ctx.fillStyle = grad; ctx.fillRect(L.W - L.pad - 150, 90, 150, 6);

    // Map panel.
    const M = L.map, P = i => ({ x: M.x + M.w / 2 + (geo.points[i].x - M.cx) * M.unit, y: M.y + M.h / 2 + (geo.points[i].y - M.cy) * M.unit });
    ctx.save(); roundRect(ctx, M.x, M.y, M.w, M.h, 16); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = LINE; ctx.lineWidth = 1; ctx.stroke(); ctx.clip();
    const hexR = M.unit * .96;
    for (let i = 0; i < geo.points.length; i++) {
      const p = P(i), t = view.terrain[i], river = t === 'river' || t === 1, hill = t === 'hill' || t === 2;
      ctx.beginPath(); for (let k = 0; k < 6; k++) { const a = Math.PI / 3 * k + Math.PI / 6; k ? ctx.lineTo(p.x + Math.cos(a) * hexR, p.y + Math.sin(a) * hexR) : ctx.moveTo(p.x + Math.cos(a) * hexR, p.y + Math.sin(a) * hexR); } ctx.closePath();
      const owner = view.board[i];
      ctx.fillStyle = owner ? (geo.tints[owner] || '#f3f5f7') : river ? '#e4eff5' : hill ? '#f4eee0' : '#fbfcfd'; ctx.fill();
      ctx.strokeStyle = '#e6ecef'; ctx.lineWidth = .6; ctx.stroke();
    }
    // Supply lines are context only: thin, very light.
    ctx.save(); ctx.globalAlpha = .28; ctx.lineWidth = 1;
    for (const link of data.supply || []) { const a = P(link.a), b = P(link.b); ctx.strokeStyle = color(link.owner); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    ctx.restore();
    for (const b of view.bridges || []) { const a = P(b.a), z = P(b.b); ctx.save(); ctx.strokeStyle = color(b.owner); ctx.globalAlpha = .55; ctx.lineWidth = 2.4; ctx.setLineDash([5, 3]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(z.x, z.y); ctx.stroke(); ctx.restore(); }
    for (let i = 0; i < geo.points.length; i++) {
      const owner = view.board[i]; if (!owner || view.anchors[i]) continue;
      const p = P(i), broken = view.supplied && !view.supplied[i];
      ctx.save(); ctx.globalAlpha = .62; ownerShape(ctx, owner, p.x, p.y, M.unit * .34);
      if (broken) { ctx.strokeStyle = color(owner); ctx.lineWidth = 1.2; ctx.stroke(); } else { ctx.fillStyle = color(owner); ctx.fill(); }
      ctx.restore();
    }
    for (const a of view.airports || []) { const p = P(a.cell), r = M.unit * .62; ctx.save(); ctx.globalAlpha = .75; ctx.strokeStyle = color(a.owner) === NEUTRAL && !a.owner ? '#8394a3' : color(a.owner); ctx.lineWidth = 1.3; ctx.fillStyle = '#fff'; ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2); ctx.strokeRect(p.x - r, p.y - r, r * 2, r * 2); plane(ctx, p.x, p.y, r * 1.6, a.owner ? color(a.owner) : '#8394a3'); ctx.restore(); }
    for (const d of view.depots || []) { const p = P(d.cell); ctx.save(); ctx.globalAlpha = .75; ctx.fillStyle = '#fffcf2'; diamond(ctx, p.x, p.y, M.unit * 1.1, d.owner ? color(d.owner) : '#a28b56'); ctx.restore(); }
    for (const t of view.turrets || []) { const p = P(t.cell); ctx.save(); ctx.globalAlpha = .8; turretGlyph(ctx, p.x, p.y, M.unit * 1.05, color(t.owner)); ctx.restore(); }
    for (let pl = 1; pl < view.players.length; pl++) { const h = view.players[pl]?.home; if (cellOk(h)) { const p = P(h); house(ctx, p.x, p.y, M.unit * 1.6, color(pl)); } }

    // Strategy: very, very faint dashed corridors and hollow target diamonds.
    for (const plan of s.plans) {
      const pts = plan.path.map(P); ctx.save(); ctx.globalAlpha = .08 + .12 * fade(plan.round); ctx.strokeStyle = color(plan.player);
      ctx.lineWidth = 1.3; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.setLineDash([3, 6]);
      if (pts.length > 1) { ctx.beginPath(); pts.forEach((p, k) => k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke(); }
      ctx.setLineDash([]); if (plan.target !== null) { const t = P(plan.target); diamond(ctx, t.x, t.y, M.unit * .62, color(plan.player)); }
      ctx.restore();
    }
    // Retreats: dashed hollow rings in the losing faction's colour.
    for (const r of s.retreats) for (const i of r.cells) { const p = P(i); ctx.save(); ctx.globalAlpha = fade(r.round) * .85; ring(ctx, p.x, p.y, M.unit * 1.05, color(r.player)); ctx.restore(); }
    // Airdrops: faint arc to a turret glyph.
    for (const a of s.airdrops) { if (!cellOk(a.from)) continue; const o = P(a.from), t = P(a.to); ctx.save(); ctx.globalAlpha = fade(a.round) * .7; arc(ctx, o, t, .3, color(a.player), 1.4, [2, 4]); turretGlyph(ctx, t.x, t.y, M.unit * 1.1, color(a.player)); ctx.restore(); }
    // Captures: crosshair in the captor's colour.
    for (const c of s.captures) { const p = P(c.cell); ctx.save(); ctx.globalAlpha = fade(c.round); crosshair(ctx, p.x, p.y, M.unit * 1.15, color(c.player)); ctx.restore(); }
    // Shots: arcs from the firing turret / airport, burst or shield at impact.
    for (const shot of s.shots) {
      const o = P(shot.from), t = P(shot.to), air = shot.kind === 'bombard';
      ctx.save(); ctx.globalAlpha = fade(shot.round) * (air ? .85 : .7);
      arc(ctx, o, t, air ? .34 : .2, color(shot.player), air ? 2 : 1.4, air ? [7, 4] : []);
      if (shot.blocked) shield(ctx, t.x, t.y, M.unit * 1.1, SHIELD); else burst(ctx, t.x, t.y, M.unit * 1.05, color(shot.player));
      ctx.restore();
    }
    // Kills: × marks in the colour of the stone that was lost (the stone itself is gone).
    for (const k of s.kills) { const p = P(k.cell); ctx.save(); ctx.globalAlpha = fade(k.round); cross(ctx, p.x, p.y, M.unit * .9, k.victim ? color(k.victim) : INK); ctx.restore(); }
    ctx.restore();

    // Timeline: one column per round, one tiny square per event coloured by actor.
    const T = L.timeline, colW = (T.w - T.labelW) / ROUNDS;
    ctx.fillStyle = INK; ctx.font = font(15, 700); ctx.textAlign = 'left'; ctx.fillText('逐輪動態', T.x, T.y - 8);
    roundRect(ctx, T.x, T.y, T.w, T.h, 12); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = LINE; ctx.stroke();
    ctx.font = font(11); ctx.textAlign = 'center'; ctx.fillStyle = MUTED;
    for (let k = 0; k < ROUNDS; k++) {
      const round = s.toRound - ROUNDS + 1 + k, x = T.x + T.labelW + k * colW;
      if (k) { ctx.strokeStyle = '#eef2f4'; ctx.beginPath(); ctx.moveTo(x, T.y + 6); ctx.lineTo(x, T.y + T.h - 6); ctx.stroke(); }
      if (round >= 0) { ctx.fillStyle = round === s.toRound ? '#267477' : MUTED; ctx.fillText(`R${round}`, x + colW / 2, T.y + 20); }
    }
    const buckets = { shots: s.shots, kills: s.kills, captures: s.captures, retreats: s.retreats.flatMap(r => Array.from({ length: Math.min(r.count, 24) }, () => r)), plans: s.plans, milestones: s.milestones };
    ROWS.forEach((row, n) => {
      const y = T.y + T.headH + n * T.rowH;
      ctx.strokeStyle = '#eef2f4'; ctx.beginPath(); ctx.moveTo(T.x + 8, y); ctx.lineTo(T.x + T.w - 8, y); ctx.stroke();
      rowIcon(ctx, row.key, T.x + 22, y + T.rowH / 2, 16, INK);
      ctx.fillStyle = INK; ctx.font = font(13, 600); ctx.textAlign = 'left'; ctx.fillText(row.label, T.x + 40, y + T.rowH / 2 + 4.5);
      for (let k = 0; k < ROUNDS; k++) {
        const round = s.toRound - ROUNDS + 1 + k, items = buckets[row.key].filter(it => it.round === round), x0 = T.x + T.labelW + k * colW + 5;
        if (row.key === 'milestones') { items.slice(0, 3).forEach((m, j) => milestoneIcon(ctx, m, x0 + 9 + j * 18, y + T.rowH / 2, 14, color(m.player))); continue; }
        const size = 8, gap = 2, perRow = Math.floor((colW - 10) / (size + gap)), cap = perRow * 3;
        items.slice(0, cap).forEach((it, j) => { ctx.fillStyle = color(it.player); ctx.globalAlpha = row.key === 'plans' ? .45 : 1; ctx.fillRect(x0 + (j % perRow) * (size + gap), y + 5 + Math.floor(j / perRow) * (size + gap), size, size); ctx.globalAlpha = 1; });
      }
    });

    // Faction cards: score and icon counters.
    const K = L.cards, players = view.players.length - 1, cw = (K.w - (players - 1) * 12) / players;
    for (let p = 1; p <= players; p++) {
      const x = K.x + (p - 1) * (cw + 12), st = s.stats[p];
      roundRect(ctx, x, K.y, cw, K.h, 12); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = LINE; ctx.stroke();
      ctx.fillStyle = color(p); ctx.fillRect(x + 12, K.y, cw - 24, 3);
      roundRect(ctx, x + 14, K.y + 16, 26, 26, 6); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = font(15, 700); ctx.textAlign = 'center'; ctx.fillText(letter(p), x + 27, K.y + 34.5);
      ctx.textAlign = 'left'; ctx.fillStyle = color(p); ctx.font = font(14, 700); ctx.fillText(geo.names[p] || '', x + 48, K.y + 34);
      ctx.textAlign = 'right'; ctx.fillStyle = INK; ctx.font = font(26, 700); ctx.fillText(String(view.players[p].score || 0), x + cw - 14, K.y + 40);
      const counters = [['shots', st.shots], ['kills', st.kills], ['captures', st.captures], ['losses', st.losses]];
      counters.forEach(([key, value], j) => {
        const cx = x + 14 + (j % 2) * (cw - 28) / 2, cy = K.y + 70 + Math.floor(j / 2) * 32;
        if (key === 'losses') lossIcon(ctx, p, cx + 8, cy, color(p));
        else rowIcon(ctx, key, cx + 8, cy, 15, color(p));
        ctx.textAlign = 'left'; ctx.fillStyle = INK; ctx.font = font(16, 700); ctx.fillText(String(value), cx + 22, cy + 6);
      });
    }

    // Legend: icons explained once, outside the map, so nothing covers the board.
    const G = L.legend; ctx.fillStyle = INK; ctx.font = font(15, 700); ctx.textAlign = 'left'; ctx.fillText('圖例', G.x, G.y + 4);
    const entries = [
      ['砲台砲擊', (x, y) => { arc(ctx, { x: x - 13, y: y + 5 }, { x: x + 5, y: y - 3 }, .3, INK, 1.4, []); burst(ctx, x + 7, y - 3, 11, INK); }],
      ['航空轟炸', (x, y) => { arc(ctx, { x: x - 13, y: y + 5 }, { x: x + 5, y: y - 3 }, .4, INK, 2, [5, 3]); burst(ctx, x + 7, y - 3, 11, INK); }],
      ['護盾擋下', (x, y) => shield(ctx, x, y, 18)],
      ['棋子消滅', (x, y) => cross(ctx, x, y, 18, INK)],
      ['攻占', (x, y) => crosshair(ctx, x, y, 18, INK)],
      ['斷補撤退', (x, y) => ring(ctx, x, y, 20, INK)],
      ['AI 策略路線', (x, y) => { ctx.save(); ctx.globalAlpha = .35; ctx.strokeStyle = INK; ctx.lineWidth = 1.3; ctx.setLineDash([3, 6]); ctx.beginPath(); ctx.moveTo(x - 14, y + 4); ctx.lineTo(x + 6, y - 2); ctx.stroke(); diamond(ctx, x + 10, y - 3, 10, INK); ctx.restore(); }],
      ['空投砲台', (x, y) => turretGlyph(ctx, x, y, 18, INK)],
      ['接通對岸', (x, y) => flag(ctx, x, y, 18, INK)],
      ['連線中斷', (x, y) => flag(ctx, x, y, 18, INK, true)],
      ['停戰 / 背盟', (x, y) => { links(ctx, x - 8, y, 16, INK); links(ctx, x + 12, y, 16, INK, true); }],
      ['家園 / 機場', (x, y) => { house(ctx, x - 9, y, 16, INK); plane(ctx, x + 12, y, 16, INK); }],
      ['陣營損失', (x, y) => lossIcon(ctx, 1, x, y, INK)]
    ];
    const perRow = 7, ew = G.w / perRow;
    entries.forEach(([text, icon], j) => { const x = G.x + (j % perRow) * ew, y = G.y + 34 + Math.floor(j / perRow) * 34; icon(x + 18, y); ctx.fillStyle = MUTED; ctx.font = font(13); ctx.textAlign = 'left'; ctx.fillText(text, x + 42, y + 4.5); });
    ctx.fillStyle = '#9aa6b2'; ctx.font = font(11); ctx.textAlign = 'right'; ctx.fillText('顏色＝陣營 · 只含公開資訊，不含任何手牌', L.W - L.pad, L.H - 14);
    return { width: canvas.width, height: canvas.height, layout: L };
  }
  function lossIcon(ctx, owner, x, y, c) {
    ctx.save(); ownerShape(ctx, owner, x, y, 6); ctx.strokeStyle = c; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 7, y + 7); ctx.lineTo(x + 7, y - 7); ctx.stroke(); ctx.restore();
  }
  function arc(ctx, a, b, bend, color, width, dash) {
    // Bow every trajectory upward like an artillery arc, so shots never sit on the hex row.
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, flip = dx / len > 0 ? 1 : -1;
    const cx = (a.x + b.x) / 2 + dy * bend * flip, cy = (a.y + b.y) / 2 - dx * bend * flip;
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.setLineDash(dash || []);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(cx, cy, b.x, b.y); ctx.stroke();
    ctx.setLineDash([]); ctx.fillStyle = color; ctx.beginPath(); ctx.arc(a.x, a.y, Math.max(1.6, width), 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }
  return { ROUNDS, Chronicle, summarize, draw, layout };
});
