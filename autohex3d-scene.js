/* AutoHex-3D battlefield: terrain that takes its owner's colour, roads and
   convoys, bridges, tunnels, airfields, field guns, aircraft and a particle
   system for fire, smoke, dust and debris. Drawing only; reads a public view. */
(function (root) {
  'use strict';
  const rgb = hex => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const rgba = (c, a = 1) => [c[0], c[1], c[2], a];
  const hash = i => { let h = (i + 1) * 2654435761 >>> 0; h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; h ^= h >>> 15; return (h % 10000) / 10000; };
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = t => t * t * (3 - 2 * t);
  const C = {
    grass: rgb('#b0c08f'), grassDark: rgb('#9cae7c'), paved: rgb('#cfd0c8'), river: rgb('#5a93b6'), hill: rgb('#a4976f'),
    rock: rgb('#8f8670'), snow: rgb('#ecebe4'), trunk: rgb('#6b4e33'), pine: rgb('#4c7340'), pine2: rgb('#5d8749'),
    asphalt: rgb('#4a4f56'), shoulder: rgb('#8e8466'), runway: rgb('#3c4148'), paint: rgb('#f2efe2'), concrete: rgb('#b3b5b2'), stone: rgb('#a39e8f'),
    sandbag: rgb('#b9a979'), canvas: rgb('#6f7149'), wood: rgb('#9a7649'), steel: rgb('#3c4148'), glass: rgb('#9cc4d6'), tyre: rgb('#1d1f22'),
    dark: rgb('#22262c'), white: [1, 1, 1], grey: rgb('#8b9097'), red: rgb('#d24a32'), shield: rgb('#8fb0ff'),
    fireHot: rgb('#ffd27a'), fire: rgb('#ff8a3d'), ember: rgb('#c2401a'), smokeDark: rgb('#3b3a38'), smoke: rgb('#6e6c68'), smokeLight: rgb('#b9b7b1'),
    dirt: rgb('#6b5536'), dust: rgb('#b8a17a'), flash: rgb('#fff1c4')
  };
  const DEG60 = Math.PI / 3, G = 9.8;
  const WIND = [.35, 0, .12];

  // ---------- particle simulation ----------
  class Particles {
    constructor(limit = 2600) { this.list = []; this.limit = limit; this.seed = 1; }
    rand() { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647; }
    emit(p) {
      if (this.list.length >= this.limit) this.list.shift();
      this.list.push(Object.assign({ vx: 0, vy: 0, vz: 0, age: 0, life: 1, s0: .2, s1: .4, c0: C.smoke, c1: C.smoke, a0: .6, a1: 0, g0: 0, g1: 0, drag: 0, grav: 0, buoy: 0, wind: 0, floor: -Infinity, seed: this.rand() }, p));
    }
    update(dt) {
      if (dt <= 0) return;
      const keep = [];
      for (const p of this.list) {
        p.age += dt; if (p.age >= p.life) continue;
        const d = Math.exp(-p.drag * dt);
        p.vx = p.vx * d + WIND[0] * p.wind * dt; p.vz = p.vz * d + WIND[2] * p.wind * dt; p.vy = p.vy * d + (p.buoy - p.grav) * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        if (p.y < p.floor) { p.y = p.floor; p.vy = -p.vy * .25; p.vx *= .5; p.vz *= .5; }
        keep.push(p);
      }
      this.list = keep;
    }
    draw(PL) {
      for (const p of this.list) {
        const k = p.age / p.life, e = 1 - (1 - k) * (1 - k), fade = Math.min(1, p.age / .04);
        const c = mix(p.c0, p.c1, k), a = lerp(p.a0, p.a1, k) * fade, g = lerp(p.g0, p.g1, k);
        if (a <= .01) continue;
        PL.add(p.x, p.y, p.z, lerp(p.s0, p.s1, e), [c[0], c[1], c[2], a], g, p.seed);
      }
    }
  }

  function create({ E, X, Z, colors }) {
    const PC = colors.map(rgb), PCUT = PC.map(c => mix(c, C.grey, .62)), PLIGHT = PC.map(c => mix(c, C.white, .6));
    const facilityCells = new Set();
    const TOP = t => t === 1 ? 0.1 : t === 2 ? 0.8 : 0.32;
    const top = (view, i) => TOP(view.terrain[i]) + (view.terrain[i] === 0 ? (hash(i) - .5) * .04 : 0);
    const P = new Particles();
    const rnd = () => P.rand();

    function parts(L, x, y, z, yaw, tilt, list, roll = 0) {
      const cy = Math.cos(yaw), sy = Math.sin(yaw), ct = Math.cos(tilt), st = Math.sin(tilt), cr = Math.cos(roll), sr = Math.sin(roll);
      for (const [mesh, dx, dy, dz, sx, sh, sz, color, glow = 0, extraTilt = 0, extraRoll = 0] of list) {
        const ry = dy * cr - dz * sr, rz = dy * sr + dz * cr;      // roll about local X
        const tx = dx * ct - ry * st, ty = dx * st + ry * ct;       // tilt about local Z
        L.add(mesh, x + tx * cy - rz * sy, y + ty, z + tx * sy + rz * cy, sx, sh, sz, yaw, color, glow, tilt + extraTilt, roll + extraRoll);
      }
    }
    function shadow(L, x, z, ground, height, size, yaw = 0) {
      const a = clamp(.32 - height * .05, .06, .32), s = size * (1 + height * .08);
      L.add('cyl', x, ground + .012, z, s, .004, s * .55, yaw, [0, 0, 0, a]);
    }

    // ---------- terrain: occupied ground takes the owner's colour ----------
    function baseColor(view, i, paved) {
      const t = view.terrain[i];
      return t === 1 ? C.river : t === 2 ? C.hill : paved && paved.has(i) ? C.paved : mix(C.grass, C.grassDark, hash(i * 7 + 3));
    }
    function tileColor(view, i, paved) {
      const base = baseColor(view, i, paved), p = view.board[i];
      if (!p) return base;
      const team = view.anchors[i] ? PC[p] : view.supplied[i] ? PC[p] : PCUT[p];
      return mix(base, team, view.anchors[i] ? .85 : view.terrain[i] === 2 ? .5 : .66);
    }
    function tile(L, view, i, color) {
      L.add('hex', X[i], -0.7, Z[i], .985, top(view, i) + .7, .985, 0, rgba(color), view.terrain[i] === 1 ? -1 : 0);
    }
    function terrain(S, view, ctx) {
      facilityCells.clear();
      for (const f of [...view.airports, ...view.depots]) facilityCells.add(f.cell);
      for (let i = 0; i < E.COUNT; i++) {
        const t = view.terrain[i], h = top(view, i), x = X[i], z = Z[i], p = view.board[i];
        if (!ctx.skip || !ctx.skip.has(i)) tile(S, view, i, tileColor(view, i, ctx.paved));
        if (ctx.goalOf[i]) S.add('ring', x, h - .05, z, .99, .07, .99, 0, rgba(PC[ctx.goalOf[i]], ctx.goalOf[i] === ctx.subject ? 1 : .55));
        if (p && !view.anchors[i]) { // status sits flush in the tile's own edge
          if (view.fortified[i]) S.add('ring', x, h - .02, z, .985, .045, .985, 0, rgba(mix(PC[p], C.dark, .55)));
          if (view.shields[i]) S.add('ring', x, h - .015, z, .9, .04, .9, 0, rgba(C.shield, view.reserve[i] > 0 ? .9 : .4), .5);
        }
        if (facilityCells.has(i)) continue;
        if (t === 2) { // mountains stay; an owner tints the slopes
          const yaw = hash(i) * 6, rock = p ? mix(mix(C.hill, C.rock, .45), PC[p], .35) : mix(C.hill, C.rock, .45);
          S.add('cone', x - .1, h, z + .06, .66, .62, .66, yaw, rgba(rock));
          S.add('cone', x - .1, h + .44, z + .06, .19, .18, .19, yaw, rgba(C.snow));
          S.add('cone', x + .4, h, z - .3, .34, .32, .34, 0, rgba(p ? mix(C.hill, PC[p], .3) : mix(C.hill, C.rock, .2)));
        } else if (t === 0 && !p && !(ctx.paved && ctx.paved.has(i)) && hash(i * 13 + 1) < .3) {
          const n = 1 + (hash(i * 5) > .45) + (hash(i * 5) > .8);
          for (let k = 0; k < n; k++) {
            const a = hash(i * 31 + k) * Math.PI * 2, d = .2 + hash(i * 17 + k) * .38, tx = x + Math.cos(a) * d, tz = z + Math.sin(a) * d;
            const s = .8 + hash(i * 11 + k) * .45, green = k % 2 ? C.pine2 : C.pine;
            S.add('cyl', tx, h, tz, .035, .1 * s, .035, 0, rgba(C.trunk));
            S.add('cone', tx, h + .08 * s, tz, .18 * s, .32 * s, .18 * s, a, rgba(green));
            S.add('cone', tx, h + .27 * s, tz, .12 * s, .26 * s, .12 * s, a, rgba(mix(green, C.white, .08)));
          }
        } else if (t === 1 && hash(i * 3) < .35) S.add('cyl', x + .55, h, z - .35, .05, .16, .05, 0, rgba(C.pine2));
      }
    }

    // ---------- structures ----------
    function castle(L, view, i, p, h) {
      const x = X[i], z = Z[i];
      L.add('ring', x, h, z, .82, .5, .82, 0, rgba(C.stone));
      for (let k = 0; k < 6; k += 2) {
        const a = -Math.PI / 6 + k * DEG60, tx = x + Math.cos(a) * .76, tz = z + Math.sin(a) * .76;
        L.add('cyl', tx, h, tz, .15, .78, .15, 0, rgba(mix(C.stone, C.dark, .1)));
        L.add('cone', tx, h + .78, tz, .19, .26, .19, 0, rgba(mix(PC[p], C.dark, .2)));
      }
      L.add('box', x, h, z, .56, .72, .56, 0, rgba(mix(C.stone, C.white, .1)));
      L.add('wedge', x, h + .72, z, .6, .3, .6, 0, rgba(PC[p]));
      L.add('box', x - .05, h + .72, z + .05, .03, 1.15, .03, 0, rgba(C.dark));
      L.add('box', x + .16, h + 1.52, z + .05, .4, .24, .02, 0, rgba(PC[p]), .2);
    }
    const recoil = new Map();
    function turret(L, view, i, p, y, aim, now) {
      const x = X[i], z = Z[i], t = view.turrets.find(v => v.cell === i), armed = view.reserve[i] >= 2;
      const yaw = Number.isInteger(aim) ? Math.atan2(Z[aim] - z, X[aim] - x) : Math.floor(hash(i) * 6) * DEG60;
      const elevation = armed ? .2 : -.06, steel = mix(C.steel, PC[p], .3);
      const kick = recoil.has(i) ? Math.max(0, 1 - (now - recoil.get(i)) / 260) : 0;
      L.add('cyl', x, y, z, .34, .1, .34, 0, rgba(C.sandbag));
      parts(L, x, y + .1, z, yaw, 0, [['cyl', 0, 0, 0, .21, .17, .21, rgba(steel)], ['box', .15, .05, 0, .15, .1, .17, rgba(mix(steel, C.dark, .2))]]);
      parts(L, x + Math.cos(yaw) * (.18 - kick * .12), y + .2, z + Math.sin(yaw) * (.18 - kick * .12), yaw, elevation, [
        ['box', .28, 0, 0, .56, .065, .065, rgba(armed ? C.dark : C.grey)], ['box', .57, -.012, 0, .07, .09, .09, rgba(armed ? C.dark : C.grey)]]);
      if (t && t.countdown === 1 && armed) L.add('sphere', x, y + .38, z, .05, .05, .05, 0, rgba(C.red), 1);
    }
    function muzzle(i, aim, now) {
      const yaw = Math.atan2(Z[aim] - Z[i], X[aim] - X[i]), y = TOP(0) + .44, x = X[i] + Math.cos(yaw) * .82, z = Z[i] + Math.sin(yaw) * .82;
      recoil.set(i, now);
      for (let k = 0; k < 2; k++) P.emit({ x, y, z, vx: Math.cos(yaw) * 2, vz: Math.sin(yaw) * 2, life: .1 + rnd() * .06, s0: .2, s1: .45, c0: C.flash, c1: C.fire, a0: .9, a1: .2, g0: 1, g1: .3, drag: 8 });
      P.emit({ x, y, z, vx: Math.cos(yaw) * 1.2, vz: Math.sin(yaw) * 1.2, life: .18, s0: .18, s1: .4, c0: C.fireHot, c1: C.fire, a0: .9, a1: 0, drag: 6 });
      for (let k = 0; k < 9; k++) { const sp = .6 + rnd() * 2.2, a = yaw + (rnd() - .5) * .9; P.emit({ x, y, z, vx: Math.cos(a) * sp, vy: rnd() * .5, vz: Math.sin(a) * sp, life: .9 + rnd() * .8, s0: .12, s1: .55 + rnd() * .3, c0: C.smokeLight, c1: C.smokeLight, a0: .55, a1: 0, drag: 2.5, buoy: .35, wind: 1 }); }
    }
    function aimFor(view, cell, owner) {
      let best = null, bestKey = null;
      const turretCells = new Set(view.turrets.map(t => t.cell));
      for (const c of E.CELLS) {
        const i = c.i, o = view.board[i];
        if (!o || o === owner || view.anchors[i] || E.distance(cell, i) > E.RULES.turretRange || E.allied(view, owner, o)) continue;
        const support = E.ADJ[i].filter(j => view.board[j] === o).length + (turretCells.has(i) ? 3 : 0);
        const key = [-support, E.distance(cell, i), i];
        if (!bestKey || key[0] < bestKey[0] || key[0] === bestKey[0] && (key[1] < bestKey[1] || key[1] === bestKey[1] && key[2] < bestKey[2])) { best = i; bestKey = key; }
      }
      return best;
    }

    // ---------- roads, bridges, tunnels ----------
    function road(S, view, a, b, owner, own) {
      const ha = top(view, a) + .012, hb = top(view, b) + .012;
      S.rod(X[a], ha - .006, Z[a], X[b], hb - .006, Z[b], .36, .012, rgba(C.shoulder));
      S.rod(X[a], ha, Z[a], X[b], hb, Z[b], .26, .016, rgba(C.asphalt));
      const dash = rgba(own ? C.paint : mix(PC[owner], C.white, .5));
      for (const k of [.2, .5, .8]) {
        const x0 = lerp(X[a], X[b], k - .06), z0 = lerp(Z[a], Z[b], k - .06), x1 = lerp(X[a], X[b], k + .06), z1 = lerp(Z[a], Z[b], k + .06);
        S.rod(x0, lerp(ha, hb, k) + .016, z0, x1, lerp(ha, hb, k) + .016, z1, .025, .004, dash);
      }
    }
    function junction(S, view, i) {
      S.add('hexFlat', X[i], top(view, i), Z[i], .17, .028, .17, 0, rgba(C.asphalt));
    }
    function deckHeight(view, a, b) {
      let h = Math.max(top(view, a), top(view, b));
      const n = E.distance(a, b);
      for (let k = 1; k < n; k++) {
        const qa = E.CELLS[a], qb = E.CELLS[b], i = E.index(Math.round(lerp(qa.q, qb.q, k / n)), Math.round(lerp(qa.r, qb.r, k / n)));
        if (i >= 0) h = Math.max(h, top(view, i));
      }
      return h + .24;
    }
    function bridge(S, view, b) {
      const a = b.a, c = b.b, deck = deckHeight(view, a, c), n = E.distance(a, c);
      const dx = X[c] - X[a], dz = Z[c] - Z[a], len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len, px = -uz, pz = ux;
      const ramp = .62, sx = X[a] + ux * ramp, sz = Z[a] + uz * ramp, ex = X[c] - ux * ramp, ez = Z[c] - uz * ramp;
      S.rod(X[a], top(view, a) + .012, Z[a], sx, deck, sz, .24, .04, rgba(C.asphalt));
      S.rod(ex, deck, ez, X[c], top(view, c) + .012, Z[c], .24, .04, rgba(C.asphalt));
      S.rod(sx, deck - .02, sz, ex, deck - .02, ez, .3, .05, rgba(C.concrete));
      S.rod(sx, deck + .03, sz, ex, deck + .03, ez, .22, .012, rgba(C.asphalt));
      for (const side of [-1, 1]) {
        const ox = px * .15 * side, oz = pz * .15 * side;
        S.rod(sx + ox, deck + .03, sz + oz, ex + ox, deck + .03, ez + oz, .025, .03, rgba(PC[b.owner]));
        S.rod(sx + ox, deck + .14, sz + oz, ex + ox, deck + .14, ez + oz, .025, .025, rgba(PC[b.owner]));
        const posts = Math.max(3, Math.round(len * 3));
        for (let k = 0; k <= posts; k++) { const f = k / posts; S.add('box', lerp(sx, ex, f) + ox, deck + .03, lerp(sz, ez, f) + oz, .025, .12, .025, 0, rgba(PC[b.owner])); }
      }
      S.rod(sx, deck - .09, sz, ex, deck - .09, ez, .16, .07, rgba(mix(C.concrete, C.dark, .3)));
      for (let k = 1; k < n; k++) {
        const qa = E.CELLS[a], qc = E.CELLS[c], i = E.index(Math.round(lerp(qa.q, qc.q, k / n)), Math.round(lerp(qa.r, qc.r, k / n)));
        const gx = lerp(X[a], X[c], k / n), gz = lerp(Z[a], Z[c], k / n), ground = i >= 0 ? top(view, i) : .1;
        for (const side of [-1, 1]) S.add('cyl', gx + px * .1 * side, ground - .1, gz + pz * .1 * side, .055, deck - ground, .055, 0, rgba(C.concrete));
      }
    }
    function tunnel(S, view, t) {
      const color = rgba(C.concrete), mouth = rgba(C.dark);
      const portal = (end, next) => {
        const yaw = Math.atan2(Z[next] - Z[end], X[next] - X[end]), h = top(view, end);
        parts(S, X[end], h, Z[end], yaw, 0, [
          ['wedge', .84, 0, 0, .5, .42, .6, rgba(mix(C.hill, C.rock, .3))],
          ['box', .66, 0, -.2, .08, .34, .08, color], ['box', .66, 0, .2, .08, .34, .08, color],
          ['box', .66, .34, 0, .12, .09, .5, color], ['box', .68, 0, 0, .05, .32, .34, mouth]]);
      };
      portal(t.a, t.path[1]); portal(t.b, t.path[t.path.length - 2]);
      for (let k = 1; k < t.path.length; k++) {
        const a = t.path[k - 1], b = t.path[k];
        for (const f of [.2, .5, .8]) {
          const x0 = lerp(X[a], X[b], f - .08), z0 = lerp(Z[a], Z[b], f - .08), x1 = lerp(X[a], X[b], f + .08), z1 = lerp(Z[a], Z[b], f + .08), y = lerp(top(view, a), top(view, b), f) + .01;
          S.rod(x0, y, z0, x1, y, z1, .1, .015, rgba(mix(PC[t.owner], C.dark, .45)));
        }
      }
      for (const i of t.path.slice(1, -1)) { S.add('cyl', X[i], top(view, i), Z[i], .11, .22, .11, 0, color); S.add('cyl', X[i], top(view, i) + .22, Z[i], .14, .03, .14, 0, rgba(PC[t.owner])); }
    }

    // ---------- convoys ----------
    function routes(view, forest) {
      const parent = new Map(), kind = new Map(), out = [];
      const tunnels = new Set((view.tunnels || []).map(t => [t.a, t.b].sort((a, b) => a - b).join(':')));
      for (const link of forest) { parent.set(link.b, link.a); kind.set(link.b, link.bridge ? (tunnels.has([link.a, link.b].sort((a, b) => a - b).join(':')) ? 'tunnel' : 'bridge') : 'road'); }
      for (const p of E.PLAYERS) {
        const targets = [];
        for (let i = 0; i < E.COUNT; i++) if (view.board[i] === p && view.delivered[i] && parent.has(i)) targets.push(i);
        targets.sort((a, b) => view.delivered[b] - view.delivered[a] || a - b);
        for (const target of targets.slice(0, 8)) {
          const cells = [target]; while (parent.has(cells[0]) && cells.length < 200) cells.unshift(parent.get(cells[0]));
          const pts = [{ x: X[cells[0]], y: top(view, cells[0]) + .03, z: Z[cells[0]] }];
          for (let k = 1; k < cells.length; k++) {
            const a = cells[k - 1], b = cells[k], how = kind.get(b);
            if (how === 'bridge') {
              const deck = deckHeight(view, a, b) + .045, dx = X[b] - X[a], dz = Z[b] - Z[a], len = Math.hypot(dx, dz);
              pts.push({ x: X[a] + dx / len * .62, y: deck, z: Z[a] + dz / len * .62 }, { x: X[b] - dx / len * .62, y: deck, z: Z[b] - dz / len * .62 });
            }
            if (how === 'tunnel') pts[pts.length - 1].under = true;
            pts.push({ x: X[b], y: top(view, b) + .03, z: Z[b] });
          }
          let length = 0; pts[0].s = 0;
          for (let k = 1; k < pts.length; k++) pts[k].s = length += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y, pts[k].z - pts[k - 1].z);
          out.push({ owner: p, target, pts, length, seed: hash(target * 3 + p), trucks: Math.min(3, view.delivered[target]) });
        }
      }
      return out;
    }
    function along(r, s) {
      s = clamp(s, 0, r.length);
      let k = 1; while (k < r.pts.length - 1 && r.pts[k].s < s) k++;
      const a = r.pts[k - 1], b = r.pts[k], f = clamp((s - a.s) / Math.max(1e-4, b.s - a.s), 0, 1);
      return { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f), z: lerp(a.z, b.z, f), under: !!a.under };
    }
    function truckModel(L, x, y, z, yaw, tilt, owner, loaded) {
      const body = PC[owner], cab = mix(body, C.dark, .15);
      const list = [
        ['box', -.02, .045, 0, .46, .035, .16, rgba(C.dark)],
        ['box', .17, .08, 0, .1, .09, .16, rgba(cab)], ['wedge', .17, .17, 0, .1, .04, .16, rgba(cab), 0, 0],
        ['box', .23, .07, 0, .03, .06, .14, rgba(mix(cab, C.dark, .3))], ['box', .205, .13, 0, .015, .045, .13, rgba(C.glass)],
        ['box', -.08, .08, 0, .28, .05, .17, rgba(C.wood)]
      ];
      if (loaded) list.push(['box', -.08, .13, 0, .27, .07, .165, rgba(C.canvas)], ['cyl', .055, .2, 0, .083, .27, .083, rgba(C.canvas), 0, Math.PI / 2]);
      for (const ax of [.15, -.06, -.17]) for (const side of [-1, 1]) list.push(['cyl', ax, .045, side > 0 ? .07 : -.1, .045, .03, .045, rgba(C.tyre), 0, 0, Math.PI / 2]);
      parts(L, x, y, z, yaw, tilt, list);
    }
    function trucks(D, PL, list, t, dt, subject, view) {
      for (const r of list) {
        if (r.owner !== subject && r.seed > .55) continue;
        const speed = 1.35, travel = r.length / speed, period = travel * 2 + 2.6;
        for (let n = 0; n < r.trucks; n++) {
          let u = ((t + r.seed * period - n * .55) % period + period) % period, back = false, s;
          if (u < travel) s = smooth(u / travel) * r.length;
          else if (u < travel + 1.3) s = r.length; // unloading
          else if (u < travel * 2 + 1.3) { back = true; s = (1 - smooth((u - travel - 1.3) / travel)) * r.length; }
          else s = 0;                              // loading at home
          const p = along(r, s); if (p.under) continue;
          const ahead = along(r, s + (back ? -.12 : .12)), behind = along(r, s - (back ? -.12 : .12));
          const dx = ahead.x - behind.x, dz = ahead.z - behind.z, flat = Math.hypot(dx, dz);
          if (flat < 1e-4) continue;
          const yaw = Math.atan2(dz, dx), tilt = Math.atan2(ahead.y - behind.y, flat);
          const lane = .065, x = p.x - Math.sin(yaw) * lane * -1, z = p.z + Math.cos(yaw) * lane * -1;
          truckModel(D, x, p.y, z, yaw, tilt, r.owner, !back && s < r.length);
          shadow(D, x, z, p.y - .03, 0, .24, yaw);
          PL.add(x + Math.cos(yaw) * .25, p.y + .09, z + Math.sin(yaw) * .25, .05, [1, .95, .8, .55], .9, .3);
          const moving = s > 0 && s < r.length;
          if (moving && rnd() < dt * 4) P.emit({ x: x - Math.cos(yaw) * .24, y: p.y + .05, z: z - Math.sin(yaw) * .24, vy: .2, life: .9, s0: .05, s1: .22, c0: C.smokeLight, c1: C.smokeLight, a0: .35, a1: 0, drag: 1.5, buoy: .2, wind: 1 });
        }
      }
    }

    // ---------- airfields, depots, aircraft ----------
    const runwayYaw = cell => (cell % 3) * DEG60;
    function airfield(S, view, a) {
      const i = a.cell, x = X[i], z = Z[i], h = top(view, i) + .005, yaw = runwayYaw(i);
      const list = [['box', 0, 0, 0, 3.0, .03, .46, rgba(C.runway)]];
      for (const d of [-1.38, 1.38]) list.push(['box', d, .03, 0, .06, .006, .38, rgba(C.paint)]);
      for (let k = -2; k <= 2; k++) list.push(['box', k * .42, .03, 0, .18, .006, .04, rgba(C.paint)]);
      list.push(['box', .1, 0, .62, 1.0, .025, .5, rgba(C.concrete)]);
      list.push(['box', -.55, 0, -.62, .55, .28, .4, rgba(mix(C.canvas, C.grey, .4))], ['wedge', -.55, .28, -.62, .55, .14, .4, rgba(mix(C.steel, C.grey, .3))]);
      list.push(['cyl', .55, 0, -.6, .08, .78, .08, rgba(C.concrete)], ['box', .55, .78, -.6, .24, .14, .24, rgba(C.glass)]);
      parts(S, x, h, z, yaw, 0, list);
      if (a.active) parts(S, x, h, z, yaw, 0, [['sphere', .55, .98, -.6, .05, .05, .05, rgba(PC[a.owner]), 1.2]]);
      if (a.owner) for (let k = 0; k < (a.active ? 2 : 1); k++) {
        const lx = -.15 + k * .5, cx = x + lx * Math.cos(yaw) - .62 * Math.sin(yaw), cz = z + lx * Math.sin(yaw) + .62 * Math.cos(yaw);
        fighter(S, cx, h + .07, cz, yaw + Math.PI / 2, 0, 0, a.owner, .7);
      }
    }
    function depot(S, view, d) {
      const i = d.cell, x = X[i], z = Z[i], h = top(view, i), owned = d.owner && d.supplied;
      parts(S, x, h, z, 0, 0, [
        ['box', -.2, 0, .22, .58, .3, .38, rgba(mix(C.canvas, C.grey, .3))], ['wedge', -.2, .3, .22, .58, .16, .38, rgba(C.steel)],
        ['cyl', .38, .1, -.3, .1, .5, .1, rgba(C.concrete), 0, Math.PI / 2], ['cyl', .38, .1, -.06, .1, .5, .1, rgba(C.concrete), 0, Math.PI / 2],
        ['box', -.4, 0, -.3, .14, .12, .14, rgba(C.wood)], ['box', -.25, 0, -.32, .14, .12, .14, rgba(C.wood)], ['box', -.33, .12, -.31, .14, .12, .14, rgba(C.wood)]]);
      S.add('box', x + .5, h, z + .35, .025, .7, .025, 0, rgba(C.dark));
      S.add('box', x + .61, h + .58, z + .35, .2, .12, .015, 0, rgba(owned ? PC[d.owner] : rgb('#d9b45d')), owned ? .15 : 0);
    }
    function fighter(L, x, y, z, yaw, tilt, roll, owner, s = 1, alpha = 1) {
      const body = rgba(mix(PC[owner], C.grey, .35), alpha), wing = rgba(PC[owner], alpha);
      parts(L, x, y, z, yaw, tilt, [
        ['box', 0, 0, 0, .82 * s, .11 * s, .13 * s, body], ['box', .44 * s, .01 * s, 0, .08 * s, .08 * s, .09 * s, rgba(C.dark, alpha)],
        ['box', .03 * s, .03 * s, 0, .24 * s, .025 * s, .94 * s, wing], ['box', -.35 * s, .05 * s, 0, .12 * s, .02 * s, .34 * s, wing],
        ['box', -.35 * s, .07 * s, 0, .14 * s, .18 * s, .025 * s, body], ['box', .2 * s, .1 * s, 0, .14 * s, .05 * s, .08 * s, rgba(C.glass, alpha)]], roll);
    }
    // Twin-engine aircraft for bombing runs and supply drops.
    function heavy(L, x, y, z, yaw, tilt, roll, owner, alpha = 1, bay = 0) {
      const body = rgba(mix(PC[owner], C.grey, .45), alpha), wing = rgba(mix(PC[owner], C.grey, .15), alpha), dark = rgba(C.dark, alpha);
      const list = [
        ['cyl', .62, .09, 0, .1, 1.24, .1, body, 0, Math.PI / 2], ['cone', .62, .09, 0, .1, .16, .1, body, 0, -Math.PI / 2],
        ['box', .08, .1, 0, .3, .03, 1.7, wing], ['box', -.55, .12, 0, .16, .025, .62, wing], ['box', -.55, .14, 0, .18, .26, .03, body],
        ['box', .5, .16, 0, .1, .04, .1, rgba(C.glass, alpha)]
      ];
      for (const side of [-1, 1]) list.push(['cyl', .32, .08, side * .42, .055, .34, .055, dark, 0, Math.PI / 2], ['box', .33, .08, side * .42, .015, .2, .015, rgba(C.grey, alpha)]);
      if (bay) list.push(['box', .02, .0, 0, .3, .02, .1, dark]);
      parts(L, x, y, z, yaw, tilt, list, roll);
    }
    function engineSmoke(x, y, z, yaw, dt, strength = 1) {
      if (rnd() < dt * 18 * strength) for (const side of [-1, 1]) P.emit({ x: x - Math.cos(yaw) * .15 - Math.sin(yaw) * side * .42, y: y + .08, z: z - Math.sin(yaw) * .15 + Math.cos(yaw) * side * .42, life: 1.6, s0: .05, s1: .3, c0: C.smokeLight, c1: C.white, a0: .35, a1: 0, drag: 1, wind: 1 });
    }
    function airTraffic(D, view, t, dt) {
      for (const a of view.airports) {
        if (!a.active) continue;
        const i = a.cell, yaw = runwayYaw(i), h = top(view, i) + .07, cy = Math.cos(yaw), sy = Math.sin(yaw);
        const u = ((t + a.id * 4.3) % 16) / 16;
        let d, y, tilt, roll = 0, alpha = 1;
        if (u < .36) { const s = u / .36; d = -1.35 + 9 * s * s; y = h + Math.max(0, d - 1.1) * .32; tilt = d > 1.1 ? .25 : 0; roll = d > 4 ? -.35 * Math.min(1, (d - 4) / 2) : 0; alpha = clamp((8 - d) / 2, 0, 1); }
        else if (u > .58) { const s = (u - .58) / .42; d = -8 + 9.1 * (1 - (1 - s) * (1 - s)); y = h + Math.max(0, -1.2 - d) * .3; tilt = d < -1.2 ? -.14 : 0; alpha = clamp((d + 8) / 2, 0, 1); }
        else continue;
        if (alpha <= .02) continue;
        const x = X[i] + d * cy, z = Z[i] + d * sy;
        fighter(D, x, y, z, yaw, tilt, roll, a.owner, 1, alpha);
        shadow(D, x, z, h - .07, y - h, .35, yaw);
      }
    }

    // ---------- explosions ----------
    function blast(x, y, z, s = 1) {
      P.emit({ x, y: y + .3, z, life: .12, s0: .7 * s, s1: 1.3 * s, c0: C.flash, c1: C.fireHot, a0: .9, a1: 0, g0: .9, g1: .3 });
      for (let k = 0; k < 12; k++) {
        const a = rnd() * Math.PI * 2, up = .3 + rnd() * .7, sp = (1.2 + rnd() * 2.2) * s;
        P.emit({ x, y: y + .2, z, vx: Math.cos(a) * sp * (1 - up * .6), vy: sp * up * 1.4, vz: Math.sin(a) * sp * (1 - up * .6), life: .5 + rnd() * .5, s0: .28 * s, s1: (.75 + rnd() * .4) * s, c0: C.fireHot, c1: C.ember, a0: .95, a1: 0, drag: 4, buoy: 1.5 });
      }
      for (let k = 0; k < 16; k++) {
        const a = rnd() * Math.PI * 2, sp = (.3 + rnd() * .9) * s;
        P.emit({ x: x + Math.cos(a) * .2 * s, y: y + .3, z: z + Math.sin(a) * .2 * s, vx: Math.cos(a) * sp, vy: (.9 + rnd() * 1.6) * s, vz: Math.sin(a) * sp, life: 2.2 + rnd() * 2.2, s0: .4 * s, s1: (1.3 + rnd() * .9) * s, c0: C.smokeDark, c1: C.smoke, a0: .75, a1: 0, drag: 1.1, buoy: .6, wind: 1 });
      }
      for (let k = 0; k < 16; k++) {
        const a = rnd() * Math.PI * 2, sp = (1.4 + rnd() * 2.6) * s;
        P.emit({ x, y: y + .2, z, vx: Math.cos(a) * sp, vy: (3 + rnd() * 3.5) * s, vz: Math.sin(a) * sp, life: 1 + rnd() * .6, s0: .045 + rnd() * .04, s1: .07, c0: mix(C.dirt, C.dark, .3), c1: C.dirt, a0: 1, a1: .7, grav: G, drag: .3, floor: y + .02 });
      }
      for (let k = 0; k < 14; k++) {
        const a = rnd() * Math.PI * 2, sp = (2.5 + rnd() * 3) * s;
        P.emit({ x, y: y + .3, z, vx: Math.cos(a) * sp, vy: (1.5 + rnd() * 3) * s, vz: Math.sin(a) * sp, life: .4 + rnd() * .5, s0: .04, s1: .02, c0: C.fireHot, c1: C.fire, a0: 1, a1: 0, g0: 1.2, g1: .3, grav: G * .7, floor: y });
      }
      for (let k = 0; k < 18; k++) {
        const a = k / 18 * Math.PI * 2, sp = (2.6 + rnd()) * s;
        P.emit({ x, y: y + .08, z, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, life: 1.3 + rnd() * .4, s0: .25 * s, s1: 1 * s, c0: C.dust, c1: C.dust, a0: .5, a1: 0, drag: 2.6, buoy: .15, wind: 1 });
      }
    }
    function burning(x, y, z, dt, strength) { // a crater keeps smouldering
      if (rnd() < dt * 10 * strength) P.emit({ x: x + (rnd() - .5) * .3, y: y + .1, z: z + (rnd() - .5) * .3, vy: .5 + rnd() * .4, life: .5 + rnd() * .3, s0: .12, s1: .25, c0: C.fireHot, c1: C.ember, a0: .9, a1: 0, buoy: .8 });
      if (rnd() < dt * 5 * strength) P.emit({ x: x + (rnd() - .5) * .3, y: y + .3, z: z + (rnd() - .5) * .3, vy: .8 + rnd() * .5, life: 2.5 + rnd() * 1.2, s0: .22, s1: 1, c0: C.smokeDark, c1: C.smokeLight, a0: .55, a1: 0, drag: .6, buoy: .25, wind: 1.4 });
    }
    function deflect(x, y, z) {
      P.emit({ x, y: y + .35, z, life: .35, s0: .8, s1: 1.4, c0: C.shield, c1: C.shield, a0: .8, a1: 0, g0: .8, g1: 0 });
      for (let k = 0; k < 14; k++) { const a = rnd() * Math.PI * 2, sp = 2 + rnd() * 2.5; P.emit({ x, y: y + .4, z, vx: Math.cos(a) * sp, vy: 1 + rnd() * 2, vz: Math.sin(a) * sp, life: .5 + rnd() * .3, s0: .05, s1: .02, c0: C.white, c1: C.shield, a0: 1, a1: 0, g0: 1.1, g1: .3, grav: G * .6 }); }
    }

    // ---------- Front Line expansion: arsenal, flak, workshop, drones ----------
    const BRICK = rgb('#8d5a43'), ROOF = rgb('#4b4f55');
    function arsenal(S, view, t) {
      const i = t.cell, x = X[i], z = Z[i], h = top(view, i), team = PC[t.owner], yaw = Math.floor(hash(i) * 6) * DEG60;
      const list = [['box', 0, 0, 0, .86, .3, .56, rgba(BRICK)], ['box', 0, .3, .29, .86, .015, .02, rgba(team)]];
      for (let k = 0; k < 3; k++) list.push(['wedge', -.29 + k * .29, .3, 0, .28, .16, .56, rgba(ROOF), 0, 0, 0]);
      list.push(['box', .44, 0, 0, .02, .2, .3, rgba(t.countdown <= 1 ? mix(C.fireHot, C.dark, .3) : C.dark), t.countdown <= 1 ? .5 : 0]);
      list.push(['cyl', -.3, 0, -.2, .07, .78, .07, rgba(mix(BRICK, C.dark, .2))], ['cyl', -.3, .78, -.2, .085, .04, .085, rgba(C.dark)]);
      list.push(['box', .1, 0, .42, .5, .02, .24, rgba(C.concrete)]);
      parts(S, x, h, z, yaw, 0, list);
    }
    function chimney(view, t, dt) {
      const i = t.cell, yaw = Math.floor(hash(i) * 6) * DEG60, h = top(view, i);
      const cx = X[i] - .3 * Math.cos(yaw) + .2 * Math.sin(yaw), cz = Z[i] - .3 * Math.sin(yaw) - .2 * Math.cos(yaw);
      if (rnd() < dt * (view.supplied[i] ? 3.5 : .8)) P.emit({ x: cx, y: h + .85, z: cz, vy: .45, life: 2.6, s0: .1, s1: .55, c0: C.smoke, c1: C.smokeLight, a0: .45, a1: 0, drag: .6, buoy: .25, wind: 1.3 });
    }
    function workshop(S, view, t) {
      const i = t.cell, x = X[i], z = Z[i], h = top(view, i), yaw = Math.floor(hash(i * 3) * 6) * DEG60, team = PC[t.owner];
      parts(S, x, h, z, yaw, 0, [
        ['box', -.12, 0, 0, .66, .26, .46, rgba(mix(C.canvas, C.grey, .35))], ['wedge', -.12, .26, 0, .66, .13, .46, rgba(mix(team, C.steel, .4))],
        ['box', .21, 0, 0, .02, .18, .22, rgba(C.dark)],
        ['box', .38, 0, -.28, .04, .82, .04, rgba(rgb('#d9a52b'))], ['box', .2, .8, -.28, .5, .04, .04, rgba(rgb('#d9a52b'))],
        ['box', .02, .5, -.28, .006, .3, .006, rgba(C.dark)], ['box', .02, .4, -.28, .12, .1, .12, rgba(C.wood)],
        ['box', .32, 0, .3, .13, .11, .13, rgba(C.wood)], ['box', .45, 0, .26, .13, .11, .13, rgba(C.wood)], ['box', .38, .11, .28, .13, .11, .13, rgba(C.wood)]]);
    }
    function flakGun(L, view, t, aim, now) {
      const i = t.cell, x = X[i], z = Z[i], h = top(view, i), armed = view.reserve[i] >= 1;
      const yaw = aim !== null && aim !== undefined ? Math.atan2(aim.z - z, aim.x - x) : (now / 3000 + hash(i) * 6) % (Math.PI * 2);
      const kick = recoil.has('f' + i) ? Math.max(0, 1 - (now - recoil.get('f' + i)) / 200) : 0;
      L.add('cyl', x, h, z, .32, .09, .32, 0, rgba(C.sandbag));
      parts(L, x, h + .09, z, yaw, 0, [['cyl', 0, 0, 0, .17, .08, .17, rgba(mix(C.steel, PC[t.owner], .3))], ['box', 0, .08, 0, .2, .14, .2, rgba(mix(C.steel, PC[t.owner], .2))]]);
      for (const side of [-1, 1]) parts(L, x - Math.cos(yaw) * kick * .05, h + .26, z - Math.sin(yaw) * kick * .05, yaw, armed ? .95 : .25, [['box', .25, 0, side * .055, .5, .04, .04, rgba(armed ? C.dark : C.grey)]]);
    }
    function droneModel(L, x, y, z, yaw, t, owner, tilt = 0) {
      const body = mix(PC[owner], C.dark, .35), list = [['box', 0, 0, 0, .2, .06, .2, rgba(body)], ['sphere', .06, -.01, 0, .035, .035, .035, rgba(C.red), 1.2]];
      for (let k = 0; k < 4; k++) {
        const a = Math.PI / 4 + k * Math.PI / 2, ax = Math.cos(a) * .17, az = Math.sin(a) * .17;
        list.push(['box', ax / 2, .02, az / 2, .2, .015, .02, rgba(C.dark), 0, 0, 0]);
        list.push(['cyl', ax, .045, az, .085, .006, .085, rgba(C.grey, .45)]);
      }
      parts(L, x, y, z, yaw, tilt, list);
      for (let k = 0; k < 4; k++) { // spinning blades
        const a = Math.PI / 4 + k * Math.PI / 2, bx = x + Math.cos(yaw) * Math.cos(a) * .17 - Math.sin(yaw) * Math.sin(a) * .17, bz = z + Math.sin(yaw) * Math.cos(a) * .17 + Math.cos(yaw) * Math.sin(a) * .17;
        L.add('box', bx, y + .052, bz, .17, .005, .018, t * 40 + k, rgba(C.dark));
      }
    }
    function airburst(x, y, z, ground, s = .6) {
      P.emit({ x, y, z, life: .1, s0: .5 * s, s1: 1.1 * s, c0: C.flash, c1: C.fireHot, a0: .9, a1: 0, g0: 1, g1: .3 });
      for (let k = 0; k < 6; k++) { const a = rnd() * 6.28, v = 1 + rnd(); P.emit({ x, y, z, vx: Math.cos(a) * v, vy: rnd() - .2, vz: Math.sin(a) * v, life: .4 + rnd() * .3, s0: .2 * s, s1: .6 * s, c0: C.fireHot, c1: C.ember, a0: .9, a1: 0, drag: 4 }); }
      for (let k = 0; k < 7; k++) { const a = rnd() * 6.28, v = .4 + rnd() * .6; P.emit({ x, y, z, vx: Math.cos(a) * v, vy: rnd() * .3, vz: Math.sin(a) * v, life: 2 + rnd() * 1.4, s0: .25 * s, s1: (1 + rnd() * .6) * s, c0: C.smokeDark, c1: C.smoke, a0: .75, a1: 0, drag: 1.4, wind: 1.2 }); }
      for (let k = 0; k < 8; k++) { const a = rnd() * 6.28, v = 1 + rnd() * 2; P.emit({ x, y, z, vx: Math.cos(a) * v, vy: rnd() * 2, vz: Math.sin(a) * v, life: 1.6, s0: .05, s1: .05, c0: C.dark, c1: C.dark, a0: 1, a1: .8, grav: G, floor: ground }); }
    }
    function tracers(PL, fx, fy, fz, tx, ty, tz, k) { // a stream of glowing rounds
      for (let n = 0; n < 8; n++) { const q = ((k * 3 + n / 8) % 1); PL.add(lerp(fx, tx, q), lerp(fy, ty, q), lerp(fz, tz, q), .075, [1, .78, .35, .95], 1.2, .1 + n * .1); }
    }
    function flakPuffs(x, y, z) {
      for (let k = 0; k < 3; k++) { const ox = (rnd() - .5) * 1.4, oy = (rnd() - .3) * .8, oz = (rnd() - .5) * 1.4; P.emit({ x: x + ox, y: y + oy, z: z + oz, life: .08, s0: .2, s1: .35, c0: C.flash, c1: C.fireHot, a0: .9, a1: 0, g0: .9, g1: .2 }); P.emit({ x: x + ox, y: y + oy, z: z + oz, life: 2.2, s0: .2, s1: .7, c0: C.smokeDark, c1: C.smoke, a0: .8, a1: 0, drag: 1.5, wind: 1 }); }
    }

    // ---------- sorties: take-off, climbing turn, run-in, drop, egress ----------
    function planSortie(view, from, to, payload) {
      const yaw0 = runwayYaw(from), ux = Math.cos(yaw0), uz = Math.sin(yaw0), h0 = top(view, from) + .08, alt = Math.max(top(view, to), h0) + 3.2;
      const start = { x: X[from] - ux * 1.3, z: Z[from] - uz * 1.3 }, lift = { x: X[from] + ux * 1.4, z: Z[from] + uz * 1.4 };
      let ax = X[to] - lift.x, az = Z[to] - lift.z, al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
      const runIn = { x: X[to] - ax * 5.5, z: Z[to] - az * 5.5 }, exit = { x: X[to] + ax * 9, z: Z[to] + az * 9 };
      const c1 = { x: lift.x + ux * 3.5, z: lift.z + uz * 3.5 };
      const speed = 5.5, roll = 1.25, climb = Math.hypot(runIn.x - lift.x, runIn.z - lift.z) * 1.15 / speed + 1.2, run = 5.5 / speed, out = 9 / speed;
      const tf = Math.sqrt(2 * (alt - top(view, to)) / G), lead = speed * tf;
      const t1 = roll, t2 = t1 + climb, tTarget = t2 + run, t3 = tTarget + out;
      const release = tTarget - lead / speed;
      return { payload, from, to, yaw0, ux, uz, h0, alt, start, lift, c1, runIn, exit, ax, az, speed, t1, t2, tTarget, t3, release, tf, dur: t3 * 1000,
        landAt: payload === 'crate' ? (tTarget + 3.2) * 1000 : (release + tf) * 1000, groundAt: top(view, to) };
    }
    function bez(a, b, c, d, t) { const u = 1 - t; return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d; }
    function sortiePose(f, t) {
      if (t < f.t1) { const s = t / f.t1, e = s * s; return { x: lerp(f.start.x, f.lift.x, e), z: lerp(f.start.z, f.lift.z, e), y: f.h0 + Math.max(0, e - .75) * 1.2, yaw: f.yaw0, tilt: e > .75 ? .22 : 0 }; }
      if (t < f.t2) {
        const s = (t - f.t1) / (f.t2 - f.t1), c2 = { x: f.runIn.x - f.ax * 3, z: f.runIn.z - f.az * 3 };
        const x = bez(f.lift.x, f.c1.x, c2.x, f.runIn.x, s), z = bez(f.lift.z, f.c1.z, c2.z, f.runIn.z, s);
        const s2 = Math.min(1, s + .02), x2 = bez(f.lift.x, f.c1.x, c2.x, f.runIn.x, s2), z2 = bez(f.lift.z, f.c1.z, c2.z, f.runIn.z, s2);
        return { x, z, y: lerp(f.h0 + .3, f.alt, smooth(Math.min(1, s * 1.4))), yaw: Math.atan2(z2 - z, x2 - x), tilt: s < .6 ? .14 : 0, turning: true };
      }
      if (t < f.t3) {
        const s = (t - f.t2) * f.speed, out = t > f.tTarget + .6 ? (t - f.tTarget - .6) : 0;
        return { x: f.runIn.x + f.ax * s, z: f.runIn.z + f.az * s, y: f.alt + out * out * .25, yaw: Math.atan2(f.az, f.ax), tilt: out ? .18 : 0 };
      }
      return null;
    }
    function sortie(D, PL, view, e, now, dt, emit) {
      const f = e.plan, t = (now - e.start) / 1000, pose = sortiePose(f, t);
      if (pose) {
        let roll = 0;
        if (pose.turning) { const prev = sortiePose(f, Math.max(0, t - .1)); let dy = pose.yaw - prev.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); roll = clamp(-dy * 6, -.7, .7); }
        const alpha = t > f.t3 - .8 ? (f.t3 - t) / .8 : 1;
        if (e.intercept && t > f.release - .7) { // flak finds the aircraft on its run-in
          roll += Math.sin(t * 9) * .12;
          if (!e.hitBy) { e.hitBy = true; recoil.set('f' + e.flak, now); }
          if (t < f.release) { tracers(PL, X[e.flak], top(view, e.flak) + .4, Z[e.flak], pose.x, pose.y, pose.z, t); if (rnd() < dt * 8) flakPuffs(pose.x, pose.y, pose.z); }
          if (t > f.release - .2 && rnd() < dt * 25) P.emit({ x: pose.x, y: pose.y + .1, z: pose.z, life: 2.4, s0: .12, s1: .6, c0: C.smokeDark, c1: C.smoke, a0: .8, a1: 0, drag: .8, wind: 1 });
          if (t > f.release - .2 && rnd() < dt * 10) P.emit({ x: pose.x, y: pose.y + .1, z: pose.z, life: .3, s0: .12, s1: .2, c0: C.fireHot, c1: C.fire, a0: .9, a1: 0 });
        }
        heavy(D, pose.x, pose.y, pose.z, pose.yaw, pose.tilt, roll, e.player, alpha, f.payload === 'bomb' && !e.intercept && Math.abs(t - f.release) < 1 ? 1 : 0);
        shadow(D, pose.x, pose.z, f.payload === 'crate' ? f.groundAt : .32, pose.y - .3, .9, pose.yaw);
        if (t > f.t1 * .7) engineSmoke(pose.x, pose.y, pose.z, pose.yaw, dt, .6);
      }
      if (e.intercept) return;
      if (f.payload === 'bomb') { // a stick of four; the third lands on the target
        for (let k = 0; k < 4; k++) {
          const off = (k - 2) * .55, tr = f.release + off / f.speed, tb = t - tr;
          if (tb < 0) continue;
          const rx = f.runIn.x + f.ax * (tr - f.t2) * f.speed, rz = f.runIn.z + f.az * (tr - f.t2) * f.speed;
          const x = rx + f.ax * f.speed * tb, z = rz + f.az * f.speed * tb, y = f.alt - .5 * G * tb * tb;
          const ground = .32;
          if (y > ground + .05 && tb < f.tf) parts(D, x, y, z, Math.atan2(f.az, f.ax), -Math.atan2(G * tb, f.speed), [['cyl', .12, 0, 0, .045, .24, .045, rgba(C.dark), 0, Math.PI / 2], ['box', -.13, 0, 0, .05, .06, .1, rgba(C.dark)]]);
          else if (!e.hits[k]) { e.hits[k] = true; const onTarget = k === 2; emit({ kind: onTarget && !e.hit ? 'deflect' : 'blast', x: onTarget ? X[f.to] : x, z: onTarget ? Z[f.to] : z, y: onTarget ? top(view, f.to) : ground, scale: onTarget ? 1.25 : .75, cell: onTarget ? f.to : null }); }
        }
      } else { // parachute crate
        const tr = f.tTarget - .1, tb = t - tr;
        if (tb >= 0 && !e.landed) {
          const free = Math.min(tb, .35), y0 = f.alt - .2 - .5 * G * free * free, y = tb < .35 ? y0 : Math.max(f.groundAt + .05, y0 - (tb - .35) * .9);
          const swing = Math.sin(tb * 3.1) * .18 * Math.min(1, tb);
          const x = X[f.to] + Math.sin(swing) * .2, z = Z[f.to];
          parts(D, x, y, z, 0, 0, [['box', 0, 0, 0, .22, .2, .22, rgba(C.wood)], ['box', 0, .2, 0, .23, .02, .23, rgba(C.dark)]]);
          if (tb > .35) {
            const cy = y + 1.0, open = Math.min(1, (tb - .35) / .3);
            D.add('sphere', x + Math.sin(swing) * .5, cy, z, .55 * open, .3 * open, .55 * open, 0, rgba(mix(C.paint, PC[e.player], .25)));
            for (const sx of [-1, 1]) for (const sz of [-1, 1]) D.rod(x + sx * .1, y + .2, z + sz * .1, x + Math.sin(swing) * .5 + sx * .42 * open, cy, z + sz * .42 * open, .008, .008, rgba(C.dark));
          }
          if (y <= f.groundAt + .051) { e.landed = true; for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; P.emit({ x: X[f.to], y: f.groundAt + .05, z: Z[f.to], vx: Math.cos(a) * 1.4, vz: Math.sin(a) * 1.4, life: 1, s0: .15, s1: .6, c0: C.dust, c1: C.dust, a0: .5, a1: 0, drag: 2.5, wind: 1 }); } }
        }
      }
    }

    // ---------- effect driver ----------
    function effects(D, PL, view, list, now, dt, emit) {
      for (const e of list) {
        if (now < e.start) continue;
        const k = clamp((now - e.start) / e.dur, 0, 1);
        if (e.kind === 'shell') {
          const fx = X[e.from], fz = Z[e.from], fy = top(view, e.from) + .45, tx = X[e.to], tz = Z[e.to], ty = top(view, e.to) + .1;
          if (!e.fired) { e.fired = true; muzzle(e.from, e.to, now); }
          const apex = .9 + E.distance(e.from, e.to) * .45, pos = q => ({ x: lerp(fx, tx, q), z: lerp(fz, tz, q), y: lerp(fy, ty, q) + 4 * apex * q * (1 - q) });
          if (k < 1) {
            const p = pos(k), q = pos(Math.min(1, k + .02)), yaw = Math.atan2(q.z - p.z, q.x - p.x), tilt = Math.atan2(q.y - p.y, Math.hypot(q.x - p.x, q.z - p.z));
            parts(D, p.x, p.y, p.z, yaw, tilt, [['box', 0, 0, 0, .16, .045, .045, rgba(C.dark)]]);
            PL.add(p.x, p.y + .02, p.z, .07, [1, .8, .45, .9], .9, .2);
            shadow(D, p.x, p.z, lerp(top(view, e.from), top(view, e.to), k), p.y, .08);
            const step = Math.max(1, Math.round(dt * 60));
            for (let n = 0; n < step; n++) P.emit({ x: p.x, y: p.y, z: p.z, life: .8 + rnd() * .4, s0: .05, s1: .26, c0: C.smokeLight, c1: C.white, a0: .45, a1: 0, drag: 1.2, wind: 1 });
          } else if (!e.done) { e.done = true; emit(e.after === 'deflect' ? { kind: 'deflect', x: tx, y: ty - .1, z: tz } : { kind: 'blast', x: tx, y: ty - .1, z: tz, scale: 1, cell: e.to }); }
        } else if (e.kind === 'sortie') sortie(D, PL, view, e, now, dt, emit);
        else if (e.kind === 'fire') burning(e.x, e.y, e.z, dt, 1 - k);
        else if (e.kind === 'capture') {
          if (!e.done) { e.done = true; for (let n = 0; n < 10; n++) { const a = rnd() * 6.28; P.emit({ x: X[e.at], y: top(view, e.at) + .1, z: Z[e.at], vx: Math.cos(a) * 1.2, vy: .4, vz: Math.sin(a) * 1.2, life: 1.2, s0: .2, s1: .7, c0: C.dust, c1: C.smokeLight, a0: .45, a1: 0, drag: 2, wind: 1 }); } }
        } else if (e.kind === 'retreat') {
          if (!e.done) { e.done = true; for (let n = 0; n < 6; n++) P.emit({ x: X[e.at] + (rnd() - .5) * .5, y: top(view, e.at) + .2, z: Z[e.at] + (rnd() - .5) * .5, vy: .6 + rnd() * .4, life: 2.5, s0: .25, s1: 1, c0: C.smoke, c1: C.smokeLight, a0: .45, a1: 0, drag: .8, buoy: .2, wind: 1 }); }
        } else if (e.kind === 'bolt') {
          if (k < .25 && Math.floor(now / 60) % 2) { let x = X[e.at], y = top(view, e.at) + 7, z = Z[e.at]; for (let n = 0; n < 6; n++) { const nx = X[e.at] + (n < 5 ? (hash(e.at * 7 + n) - .5) * .8 : 0), ny = y - 7 / 6, nz = Z[e.at] + (n < 5 ? (hash(e.at * 3 + n) - .5) * .8 : 0); D.rod(x, y, z, nx, ny, nz, .06, .06, rgba(C.flash), 2); x = nx; y = ny; z = nz; } }
          if (!e.done && k > .1) { e.done = true; emit({ kind: 'blast', x: X[e.at], y: top(view, e.at), z: Z[e.at], scale: .7, cell: e.at }); }
        } else if (e.kind === 'boom') {
          if (!e.done) { e.done = true; emit({ kind: 'blast', x: X[e.at] + (e.dx || 0), y: top(view, e.at), z: Z[e.at] + (e.dz || 0), scale: e.scale || .6, cell: e.at }); }
        } else if (e.kind === 'dive') { // drone dives onto its target
          const fy = top(view, e.from) + 1.25, ty = top(view, e.to) + .15, q = k * k;
          const x = lerp(X[e.from], X[e.to], k), z = lerp(Z[e.from], Z[e.to], k), y = lerp(fy, ty, q);
          if (k < 1) { droneModel(D, x, y, z, Math.atan2(Z[e.to] - Z[e.from], X[e.to] - X[e.from]), now / 1000, e.player, -.6); P.emit({ x, y, z, life: .6, s0: .05, s1: .2, c0: C.smokeLight, c1: C.white, a0: .4, a1: 0, drag: 1 }); }
          else if (!e.done) { e.done = true; emit(e.hit ? { kind: 'blast', x: X[e.to], y: top(view, e.to), z: Z[e.to], scale: .75, cell: e.to } : { kind: 'deflect', x: X[e.to], y: top(view, e.to), z: Z[e.to] }); }
        } else if (e.kind === 'flakdown') { // tracers climb to the drone; it bursts and falls
          const y = top(view, e.at) + 1.25;
          if (k < .45) { tracers(PL, X[e.flak], top(view, e.flak) + .4, Z[e.flak], X[e.at], y, Z[e.at], k); recoil.set('f' + e.flak, now); droneModel(D, X[e.at], y, Z[e.at], 0, now / 1000, e.from); }
          else if (!e.done) { e.done = true; airburst(X[e.at], y, Z[e.at], top(view, e.at), .55); }
        } else if (e.kind === 'flare') {
          if (!e.done) { e.done = true; for (let n = 0; n < 8; n++) P.emit({ x: X[e.at], y: top(view, e.at) + .2, z: Z[e.at], vx: (rnd() - .5) * .8, vy: 4 + rnd() * 2, vz: (rnd() - .5) * .8, life: 1.8, s0: .12, s1: .06, c0: mix(PC[e.player] || C.grey, C.white, .4), c1: PC[e.player] || C.grey, a0: 1, a1: 0, g0: 1.1, g1: .4, grav: 3, drag: .5 }); }
        }
      }
    }
    function scars(D, view, list, now) {
      for (const s of list) {
        const alpha = clamp((s.until - now) / 6000, 0, 1);
        if (alpha <= 0) continue;
        D.add('cyl', s.x, s.y + .006, s.z, .5 * s.r, .006, .5 * s.r, s.yaw, rgba(rgb('#3a3226'), .45 * alpha));
        D.add('cyl', s.x, s.y + .009, s.z, .28 * s.r, .006, .28 * s.r, 0, rgba(C.dark, .6 * alpha));
      }
    }

    return { top, TOP, parts, P, Particles, tileColor, tile, terrain, castle, turret, muzzle, aimFor, road, junction, bridge, tunnel, routes, trucks, airfield, depot,
      arsenal, chimney, workshop, flakGun, droneModel, airburst,
      fighter, heavy, airTraffic, blast, deflect, planSortie, effects, scars, colors: { PC, PCUT, PLIGHT }, C, rgb, mix, rgba };
  }
  root.AutoHex3DScene = Object.freeze({ create, Particles });
})(typeof window !== 'undefined' ? window : globalThis);
