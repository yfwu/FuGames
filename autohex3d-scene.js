/* AutoHex-3D battlefield models: terrain, camps, forts, turrets, roads, bridges,
   tunnels, airfields, depots, trucks, aircraft and explosions. Pure drawing
   from a public observation; no rules and no game mutation. */
(function (root) {
  'use strict';
  const rgb = hex => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const rgba = (c, a = 1) => [c[0], c[1], c[2], a];
  const hash = i => { let h = (i + 1) * 2654435761 >>> 0; h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; h ^= h >>> 15; return (h % 10000) / 10000; };
  const lerp = (a, b, t) => a + (b - a) * t;
  const C = {
    grass: rgb('#b4c493'), grassDark: rgb('#9fb27f'), paved: rgb('#d5d5cd'), river: rgb('#5a93b6'), hill: rgb('#a4976f'),
    rock: rgb('#8f8670'), snow: rgb('#ecebe4'), trunk: rgb('#6b4e33'), pine: rgb('#4c7340'), pine2: rgb('#5d8749'),
    asphalt: rgb('#4d525a'), runway: rgb('#3c4148'), paint: rgb('#f2efe2'), concrete: rgb('#b3b5b2'), stone: rgb('#a39e8f'),
    sandbag: rgb('#b9a979'), canvas: rgb('#7a7853'), wood: rgb('#9a7649'), steel: rgb('#3c4148'), glass: rgb('#8db7c9'),
    dark: rgb('#22262c'), white: [1, 1, 1], grey: rgb('#8b9097'), fire: rgb('#ff8a3d'), flash: rgb('#fff2b0'), smoke: rgb('#5d5f62'),
    lightSmoke: rgb('#c9cbcd'), shield: rgb('#8fb0ff'), tarp: rgb('#66683f'), red: rgb('#d24a32')
  };
  const DEG60 = Math.PI / 3;

  function create({ E, X, Z, colors }) {
    const PC = colors.map(rgb), PCUT = PC.map(c => mix(c, C.grey, .6)), PLIGHT = PC.map(c => mix(c, C.white, .6));
    const facilityCells = new Set();
    const TOP = t => t === 1 ? 0.1 : t === 2 ? 0.8 : 0.32;
    const top = (view, i) => TOP(view.terrain[i]) + (view.terrain[i] === 0 ? (hash(i) - .5) * .04 : 0);

    // Compose a model from parts in its local frame (+X forward), then yaw / tilt it.
    function parts(L, x, y, z, yaw, tilt, list) {
      const cy = Math.cos(yaw), sy = Math.sin(yaw), ct = Math.cos(tilt), st = Math.sin(tilt);
      for (const [mesh, dx, dy, dz, sx, sh, sz, color, glow = 0, extraTilt = 0] of list) {
        const tx = dx * ct - dy * st, ty = dx * st + dy * ct;
        L.add(mesh, x + tx * cy - dz * sy, y + ty, z + tx * sy + dz * cy, sx, sh, sz, yaw, color, glow, tilt + extraTilt);
      }
    }

    // ---------- terrain ----------
    function terrain(S, view, ctx) {
      facilityCells.clear();
      for (const f of [...view.airports, ...view.depots]) facilityCells.add(f.cell);
      for (let i = 0; i < E.COUNT; i++) {
        const t = view.terrain[i], h = top(view, i), x = X[i], z = Z[i], r = hash(i * 7 + 3);
        let color = t === 1 ? C.river : t === 2 ? C.hill : ctx.paved.has(i) ? C.paved : mix(C.grass, C.grassDark, r);
        S.add('hex', x, -0.7, z, .985, h + .7, .985, 0, rgba(color), t === 1 ? -1 : 0);
        if (ctx.goalOf[i]) S.add('ring', x, h - .05, z, .99, .07, .99, 0, rgba(PC[ctx.goalOf[i]], ctx.goalOf[i] === ctx.subject ? 1 : .55));
        if (view.board[i] || facilityCells.has(i)) continue;
        if (t === 2) { // mountain with a snow cap and a foothill
          const yaw = hash(i) * 6;
          S.add('cone', x - .1, h, z + .06, .66, .62, .66, yaw, rgba(mix(C.hill, C.rock, .45)));
          S.add('cone', x - .1, h + .44, z + .06, .19, .18, .19, yaw, rgba(C.snow));
          S.add('cone', x + .4, h, z - .3, .34, .32, .34, 0, rgba(mix(C.hill, C.rock, .2)));
        } else if (t === 0 && !ctx.paved.has(i) && hash(i * 13 + 1) < .3) { // copse of pines
          const n = 1 + (hash(i * 5) > .45) + (hash(i * 5) > .8);
          for (let k = 0; k < n; k++) {
            const a = hash(i * 31 + k) * Math.PI * 2, d = .2 + hash(i * 17 + k) * .38, tx = x + Math.cos(a) * d, tz = z + Math.sin(a) * d;
            const s = .8 + hash(i * 11 + k) * .45, green = k % 2 ? C.pine2 : C.pine;
            S.add('cyl', tx, h, tz, .035, .1 * s, .035, 0, rgba(C.trunk));
            S.add('cone', tx, h + .08 * s, tz, .18 * s, .32 * s, .18 * s, a, rgba(green));
            S.add('cone', tx, h + .27 * s, tz, .12 * s, .26 * s, .12 * s, a, rgba(mix(green, C.white, .08)));
          }
        } else if (t === 1 && hash(i * 3) < .35) { // reeds on the bank
          S.add('cyl', x + .55, h, z - .35, .05, .16, .05, 0, rgba(C.pine2));
        }
      }
    }

    // ---------- positions ----------
    function camp(L, view, i, p, h, rise, ctx) {
      const x = X[i], z = Z[i], y = h + rise, supplied = view.supplied[i], fortified = view.fortified[i];
      const team = supplied ? PC[p] : PCUT[p], yaw = Math.floor(hash(i) * 6) * DEG60;
      L.add('hexFlat', x, y, z, .64, .07, .64, 0, rgba(team));
      L.add('ring', x, y + .07, z, .6, fortified ? .18 : .12, .6, 0, rgba(fortified ? C.concrete : C.sandbag));
      if (ctx.turrets.has(i)) turret(L, view, i, p, y + .07, ctx.aim.get(i));
      else {
        parts(L, x, y + .07, z, yaw, 0, [['wedge', -.06, 0, .06, .46, .27, .36, rgba(mix(team, C.canvas, .55))]]);
        if (fortified) parts(L, x, y + .07, z, yaw, 0, [['box', .2, 0, -.18, .22, .16, .22, rgba(C.concrete)], ['box', .31, .08, -.18, .02, .03, .14, rgba(C.dark)]]);
      }
      // Field reserve as supply crates (0–6).
      const r = Math.min(6, view.reserve[i]);
      for (let k = 0; k < r; k++) L.add('box', x - .34 + (k % 3) * .12, y + .07 + (k >= 3 ? 0 : 0), z + .3 + Math.floor(k / 3) * .11, .1, .09, .1, 0, rgba(supplied ? C.wood : mix(C.wood, C.red, .3)));
      // Flag: faction colour; a cut-off camp flies it at half-mast.
      const fx = x + .32, fz = z - .26;
      L.add('box', fx, y + .07, fz, .025, .62, .025, 0, rgba(C.dark));
      L.add('box', fx + .11, y + (supplied ? .55 : .32), fz, .2, .12, .015, 0, rgba(supplied ? PC[p] : C.grey), supplied ? .12 : 0);
      if (view.shields[i]) L.add('sphere', x, y + .07, z, .74, .6, .74, 0, rgba(C.shield, view.reserve[i] > 0 ? .22 : .1), .15);
    }
    function castle(L, view, i, p, h) {
      const x = X[i], z = Z[i];
      L.add('hexFlat', x, h, z, .88, .1, .88, 0, rgba(PC[p]));
      L.add('ring', x, h + .1, z, .82, .5, .82, 0, rgba(C.stone));
      for (let k = 0; k < 6; k += 2) {
        const a = -Math.PI / 6 + k * DEG60, tx = x + Math.cos(a) * .76, tz = z + Math.sin(a) * .76;
        L.add('cyl', tx, h + .1, tz, .15, .78, .15, 0, rgba(mix(C.stone, C.dark, .1)));
        L.add('cone', tx, h + .88, tz, .19, .26, .19, 0, rgba(mix(PC[p], C.dark, .2)));
      }
      L.add('box', x, h + .1, z, .56, .72, .56, 0, rgba(mix(C.stone, C.white, .1)));
      L.add('wedge', x, h + .82, z, .6, .3, .6, 0, rgba(PC[p]));
      L.add('box', x - .05, h + .82, z + .05, .03, 1.15, .03, 0, rgba(C.dark));
      L.add('box', x + .16, h + 1.62, z + .05, .4, .24, .02, 0, rgba(PC[p]), .2);
    }
    // Field gun: sandbag pit, turret housing, a long barrel aimed at its next target.
    function turret(L, view, i, p, y, aim) {
      const x = X[i], z = Z[i], t = view.turrets.find(v => v.cell === i), armed = view.reserve[i] >= 2;
      const yaw = aim ? Math.atan2(Z[aim] - z, X[aim] - x) : Math.floor(hash(i) * 6) * DEG60;
      const elevation = armed ? .2 : -.06, steel = mix(C.steel, PC[p], .25);
      L.add('cyl', x, y, z, .33, .1, .33, 0, rgba(C.sandbag));
      parts(L, x, y + .1, z, yaw, 0, [
        ['cyl', 0, 0, 0, .2, .17, .2, rgba(steel)],
        ['box', .14, .05, 0, .14, .1, .16, rgba(mix(steel, C.dark, .2))]
      ]);
      parts(L, x + Math.cos(yaw) * .18, y + .2, z + Math.sin(yaw) * .18, yaw, elevation, [
        ['box', .27, 0, 0, .54, .065, .065, rgba(armed ? C.dark : C.grey)],
        ['box', .55, -.012, 0, .07, .09, .09, rgba(armed ? C.dark : C.grey)]
      ]);
      if (t && t.countdown === 1 && armed) L.add('sphere', x, y + .38, z, .05, .05, .05, 0, rgba(C.red), 1);
    }
    // Engine-equivalent public target order: turrets first, then most supported, nearest.
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

    // ---------- logistics ----------
    function road(S, view, a, b, owner, own) {
      const ha = top(view, a) + .075, hb = top(view, b) + .075;
      S.rod(X[a], ha, Z[a], X[b], hb, Z[b], .3, .03, rgba(C.asphalt));
      const dash = rgba(own ? C.paint : mix(PC[owner], C.white, .55));
      for (const k of [.36, .64]) {
        const x0 = lerp(X[a], X[b], k - .07), z0 = lerp(Z[a], Z[b], k - .07), x1 = lerp(X[a], X[b], k + .07), z1 = lerp(Z[a], Z[b], k + .07);
        S.rod(x0, lerp(ha, hb, k) + .03, z0, x1, lerp(ha, hb, k) + .03, z1, .035, .008, dash);
      }
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
      S.rod(X[a], top(view, a) + .075, Z[a], sx, deck, sz, .22, .04, rgba(C.asphalt));
      S.rod(ex, deck, ez, X[c], top(view, c) + .075, Z[c], .22, .04, rgba(C.asphalt));
      S.rod(sx, deck - .02, sz, ex, deck - .02, ez, .3, .05, rgba(C.concrete));
      S.rod(sx, deck + .03, sz, ex, deck + .03, ez, .2, .012, rgba(C.asphalt));
      // Truss railings in the owner's colour.
      for (const side of [-1, 1]) {
        const ox = px * .15 * side, oz = pz * .15 * side;
        S.rod(sx + ox, deck + .03, sz + oz, ex + ox, deck + .03, ez + oz, .025, .03, rgba(PC[b.owner]));
        S.rod(sx + ox, deck + .14, sz + oz, ex + ox, deck + .14, ez + oz, .025, .025, rgba(PC[b.owner]));
        const posts = Math.max(3, Math.round(len * 3));
        for (let k = 0; k <= posts; k++) { const f = k / posts; S.add('box', lerp(sx, ex, f) + ox, deck + .03, lerp(sz, ez, f) + oz, .025, .12, .025, 0, rgba(PC[b.owner])); }
      }
      // Girder under the deck and piers standing in the river / valley.
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
        const dx = X[next] - X[end], dz = Z[next] - Z[end], yaw = Math.atan2(dz, dx), h = top(view, end) + .07;
        // Earth mound with a concrete portal facing along the tunnel, just outside the camp wall.
        parts(S, X[end], h - .07, Z[end], yaw, 0, [
          ['wedge', .84, 0, 0, .5, .42, .6, rgba(mix(C.hill, C.rock, .3)), 0, 0],
          ['box', .66, 0, -.2, .08, .34, .08, color], ['box', .66, 0, .2, .08, .34, .08, color],
          ['box', .66, .34, 0, .12, .09, .5, color], ['box', .68, 0, 0, .05, .32, .34, mouth]
        ]);
      };
      portal(t.a, t.path[1]); portal(t.b, t.path[t.path.length - 2]);
      // The public route: dashed surface markers between portals.
      for (let k = 1; k < t.path.length; k++) {
        const a = t.path[k - 1], b = t.path[k];
        for (const f of [.2, .5, .8]) {
          const x0 = lerp(X[a], X[b], f - .08), z0 = lerp(Z[a], Z[b], f - .08), x1 = lerp(X[a], X[b], f + .08), z1 = lerp(Z[a], Z[b], f + .08), y = lerp(top(view, a), top(view, b), f) + .01;
          S.rod(x0, y, z0, x1, y, z1, .1, .015, rgba(mix(PC[t.owner], C.dark, .45)));
        }
      }
      for (const i of t.path.slice(1, -1)) { // ventilation shaft
        S.add('cyl', X[i], top(view, i), Z[i], .11, .22, .11, 0, color);
        S.add('cyl', X[i], top(view, i) + .22, Z[i], .14, .03, .14, 0, rgba(PC[t.owner]));
      }
    }
    // Routes for trucks: home -> each stone that received supplies last action,
    // along the faction's public supply tree (roads, bridge decks, tunnels).
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
          const pts = [{ x: X[cells[0]], y: top(view, cells[0]) + .08, z: Z[cells[0]], hidden: false }];
          for (let k = 1; k < cells.length; k++) {
            const a = cells[k - 1], b = cells[k], how = kind.get(b);
            if (how === 'bridge') {
              const deck = deckHeight(view, a, b) + .07, dx = X[b] - X[a], dz = Z[b] - Z[a], len = Math.hypot(dx, dz);
              pts.push({ x: X[a] + dx / len * .62, y: deck, z: Z[a] + dz / len * .62 }, { x: X[b] - dx / len * .62, y: deck, z: Z[b] - dz / len * .62 });
            }
            pts.push({ x: X[b], y: top(view, b) + .08, z: Z[b], hidden: how === 'tunnel' });
            if (how === 'tunnel') pts[pts.length - 2].hiddenNext = true;
          }
          let length = 0; for (let k = 1; k < pts.length; k++) { pts[k].s = length += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y, pts[k].z - pts[k - 1].z); }
          pts[0].s = 0;
          out.push({ owner: p, target, pts, length, seed: hash(target * 3 + p) });
        }
      }
      return out;
    }
    function truck(L, x, y, z, yaw, tilt, owner, loaded) {
      parts(L, x, y, z, yaw, tilt, [
        ['box', 0, .03, 0, .44, .05, .17, rgba(C.dark)],
        ['box', -.15, -.01, 0, .07, .06, .2, rgba(C.dark)], ['box', .13, -.01, 0, .07, .06, .2, rgba(C.dark)],
        ['box', .15, .08, 0, .12, .12, .16, rgba(PC[owner])],
        ['box', .2, .14, 0, .02, .05, .13, rgba(C.glass)],
        ['box', -.06, .08, 0, .26, loaded ? .13 : .03, .17, rgba(loaded ? C.tarp : C.wood)]
      ]);
    }
    function trucks(D, list, t, subject) {
      for (const r of list) {
        const speed = 1.5, travel = r.length / speed, period = travel * 2 + 1.4;
        let u = ((t + r.seed * period) % period), back = false;
        if (u > travel + .7) { u = Math.min(travel, u - travel - .7); back = true; } else u = Math.min(travel, u);
        const s = back ? r.length - u * speed : u * speed;
        let k = 1; while (k < r.pts.length - 1 && r.pts[k].s < s) k++;
        const a = r.pts[k - 1], b = r.pts[k], seg = Math.max(1e-4, b.s - a.s), f = Math.max(0, Math.min(1, (s - a.s) / seg));
        if (b.hidden || a.hiddenNext) continue; // underground in a tunnel
        const dx = b.x - a.x, dz = b.z - a.z, dy = b.y - a.y;
        let yaw = Math.atan2(dz, dx), tilt = Math.atan2(dy, Math.hypot(dx, dz));
        if (back) { yaw += Math.PI; tilt = -tilt; }
        if (r.owner !== subject && r.seed > .6) continue; // keep other factions' traffic lighter
        truck(D, lerp(a.x, b.x, f), lerp(a.y, b.y, f), lerp(a.z, b.z, f), yaw, tilt, r.owner, !back);
      }
    }

    // ---------- airfields and depots ----------
    const runwayYaw = cell => (cell % 3) * DEG60;
    function airfield(S, view, a) {
      const i = a.cell, x = X[i], z = Z[i], h = top(view, i) + .005, yaw = runwayYaw(i), owner = a.owner;
      const list = [['box', 0, 0, 0, 3.0, .03, .46, rgba(C.runway)]];
      for (const d of [-1.38, 1.38]) list.push(['box', d, .03, 0, .06, .006, .38, rgba(C.paint)]);
      for (let k = -2; k <= 2; k++) list.push(['box', k * .42, .03, 0, .18, .006, .04, rgba(C.paint)]);
      list.push(['box', .1, 0, .62, 1.0, .025, .5, rgba(C.concrete)]);
      list.push(['box', -.55, 0, -.62, .55, .28, .4, rgba(mix(C.canvas, C.grey, .4))], ['wedge', -.55, .28, -.62, .55, .14, .4, rgba(mix(C.steel, C.grey, .3))]);
      list.push(['cyl', .55, 0, -.6, .08, .78, .08, rgba(C.concrete)], ['box', .55, .78, -.6, .24, .14, .24, rgba(C.glass)]);
      parts(S, x, h, z, yaw, 0, list);
      if (a.active) parts(S, x, h, z, yaw, 0, [['sphere', .55, .98, -.6, .05, .05, .05, rgba(PC[owner]), 1.2]]);
      if (owner) {
        const n = a.active ? 2 : 1;
        for (let k = 0; k < n; k++) {
          const lx = -.15 + k * .5, cx = x + lx * Math.cos(yaw) - .62 * Math.sin(yaw), cz = z + lx * Math.sin(yaw) + .62 * Math.cos(yaw);
          plane(S, cx, h + .06, cz, yaw + Math.PI / 2, 0, owner, .7);
        }
      }
    }
    function depot(S, view, d) {
      const i = d.cell, x = X[i], z = Z[i], h = top(view, i), owned = d.owner && d.supplied;
      parts(S, x, h, z, 0, 0, [
        ['box', -.2, 0, .22, .58, .3, .38, rgba(mix(C.canvas, C.grey, .3))], ['wedge', -.2, .3, .22, .58, .16, .38, rgba(C.steel)],
        ['cyl', .38, .1, -.3, .1, .5, .1, rgba(C.concrete), 0, Math.PI / 2], ['cyl', .38, .1, -.06, .1, .5, .1, rgba(C.concrete), 0, Math.PI / 2],
        ['box', -.4, 0, -.3, .14, .12, .14, rgba(C.wood)], ['box', -.25, 0, -.32, .14, .12, .14, rgba(C.wood)], ['box', -.33, .12, -.31, .14, .12, .14, rgba(C.wood)]
      ]);
      S.add('box', x + .5, h, z + .35, .025, .7, .025, 0, rgba(C.dark));
      S.add('box', x + .61, h + .58, z + .35, .2, .12, .015, 0, rgba(owned ? PC[d.owner] : rgb('#d9b45d')), owned ? .15 : 0);
    }
    function plane(L, x, y, z, yaw, tilt, owner, scale = 1, alpha = 1) {
      const body = rgba(mix(PC[owner], C.grey, .35), alpha), wing = rgba(PC[owner], alpha), s = scale;
      parts(L, x, y, z, yaw, tilt, [
        ['box', 0, 0, 0, .82 * s, .11 * s, .13 * s, body],
        ['box', .44 * s, .01 * s, 0, .08 * s, .08 * s, .09 * s, rgba(C.dark, alpha)],
        ['box', .03 * s, .03 * s, 0, .24 * s, .025 * s, .94 * s, wing],
        ['box', -.35 * s, .05 * s, 0, .12 * s, .02 * s, .34 * s, wing],
        ['box', -.35 * s, .07 * s, 0, .14 * s, .18 * s, .025 * s, body],
        ['box', .2 * s, .1 * s, 0, .14 * s, .05 * s, .08 * s, rgba(C.glass, alpha)]
      ]);
    }
    // Active airfields keep a training circuit going: take off, climb out, return, land.
    function airTraffic(D, view, t) {
      for (const a of view.airports) {
        if (!a.active) continue;
        const i = a.cell, yaw = runwayYaw(i), h = top(view, i) + .06, cy = Math.cos(yaw), sy = Math.sin(yaw);
        const u = ((t + a.id * 4.3) % 14) / 14;
        let d, y, tilt, alpha = 1;
        if (u < .38) { const s = u / .38; d = -1.35 + 9 * s * s; y = h + Math.max(0, d - 1.1) * .32; tilt = d > 1.1 ? .28 : 0; alpha = Math.min(1, Math.max(0, (8 - d) / 2)); }
        else if (u > .58) { const s = (u - .58) / .42; d = -8 + 9.1 * (1 - (1 - s) * (1 - s)); y = h + Math.max(0, -1.2 - d) * .3; tilt = d < -1.2 ? -.16 : 0; alpha = Math.min(1, Math.max(0, (d + 8) / 2)); }
        else continue;
        if (alpha <= .02) continue;
        plane(D, X[i] + d * cy, y, Z[i] + d * sy, yaw, tilt, a.owner, 1, alpha);
      }
    }

    // ---------- effects ----------
    function blast(D, x, y, z, k, scale, seed) {
      const s = scale;
      if (k < .14) D.add('sphere', x, y + .3, z, (.2 + k * 8) * s, (.2 + k * 7) * s, (.2 + k * 8) * s, 0, rgba(C.flash, 1 - k * 6), 1.6);
      if (k < .35) { const f = k / .35; D.add('sphere', x, y + .25 + f * .5 * s, z, (.35 + f * .7) * s, (.3 + f * .6) * s, (.35 + f * .7) * s, 0, rgba(mix(C.fire, C.smoke, f), 1 - f * .7), 1.1 - f); }
      if (k < .25) { const f = k / .25; D.add('ring', x, y + .02, z, (.3 + f * 2.2) * s, .04, (.3 + f * 2.2) * s, 0, rgba(C.lightSmoke, .7 * (1 - f))); }
      for (let p = 0; p < 5; p++) {
        const f = Math.max(0, k - .08) / .92, ox = (hash(seed + p) - .5) * .6 * s, oz = (hash(seed + p * 7) - .5) * .6 * s, sz = (.25 + f * .9 + hash(seed + p * 3) * .2) * s;
        if (f > 0) D.add('sphere', x + ox * (1 + f), y + .4 + f * (1.6 + p * .25) * s, z + oz * (1 + f), sz, sz * .85, sz, 0, rgba(p % 2 ? C.smoke : mix(C.smoke, C.lightSmoke, .5), .55 * (1 - f)));
      }
      const time = k * 2.6;
      for (let p = 0; p < 8 && time < 1.1; p++) {
        const a = hash(seed * 3 + p) * Math.PI * 2, v = (1.2 + hash(seed + p * 11) * 1.6) * s, vy = 3 + hash(seed + p * 5) * 2;
        const py = y + .3 + vy * time - 4.9 * time * time; if (py < y) continue;
        D.add('box', x + Math.cos(a) * v * time, py, z + Math.sin(a) * v * time, .07, .07, .07, a + time * 9, rgba(C.dark), 0, time * 7);
      }
    }
    function effects(D, view, list, now, emit) {
      for (const e of list) {
        const k = Math.max(0, Math.min(1, (now - e.start) / e.dur));
        if (now < e.start) continue;
        const tx = X[e.to ?? e.at], tz = Z[e.to ?? e.at], ty = top(view, e.to ?? e.at);
        if (e.kind === 'shell') {
          const fx = X[e.from], fz = Z[e.from], fy = top(view, e.from) + .5, peak = 1.6 + E.distance(e.from, e.to) * .35;
          if (k < .12) { const yaw = Math.atan2(tz - fz, tx - fx); D.add('sphere', fx + Math.cos(yaw) * .8, fy, fz + Math.sin(yaw) * .8, .18, .14, .18, 0, rgba(C.flash, 1 - k * 8), 1.6); }
          if (k < 1) {
            for (let j = 0; j < 7; j++) {
              const kk = k - j * .035; if (kk < 0) break;
              const x = lerp(fx, tx, kk), z = lerp(fz, tz, kk), y = lerp(fy, ty + .3, kk) + Math.sin(kk * Math.PI) * peak;
              D.add('sphere', x, y, z, j ? .05 + j * .02 : .07, j ? .05 + j * .02 : .07, j ? .05 + j * .02 : .07, 0, j ? rgba(C.lightSmoke, .5 - j * .06) : rgba(C.dark), j ? 0 : .3);
            }
          } else if (!e.spawned) { e.spawned = true; emit(e.after === 'deflect' ? { kind: 'deflect', at: e.to, dur: 900 } : { kind: 'blast', at: e.to, dur: 2600, scar: true }); }
        } else if (e.kind === 'blast') blast(D, tx, ty, tz, k, e.scale || 1, (e.at + 1) * 97);
        else if (e.kind === 'deflect') {
          D.add('sphere', tx, ty + .07, tz, .74 + k * .3, .6 + k * .25, .74 + k * .3, 0, rgba(C.shield, .55 * (1 - k)), 1.2);
          for (let p = 0; p < 6; p++) { const a = p * DEG60 + k * 2; D.add('box', tx + Math.cos(a) * (.4 + k * .8), ty + .6 + k * .3, tz + Math.sin(a) * (.4 + k * .8), .05, .05, .05, a, rgba(C.flash, 1 - k), 1.2); }
        } else if (e.kind === 'capture') {
          D.add('ring', tx, ty + .1 + k * .3, tz, .6 + k * .9, .08, .6 + k * .9, 0, rgba(PC[e.player] || C.grey, 1 - k), .8);
          D.add('sphere', tx, ty + .4 + k * .8, tz, .3 + k * .5, .3 + k * .4, .3 + k * .5, 0, rgba(C.lightSmoke, .5 * (1 - k)));
        } else if (e.kind === 'retreat') {
          D.add('sphere', tx, ty + .3 + k * 1.5, tz, .3 + k * .45, .3 + k * .4, .3 + k * .45, 0, rgba(C.smoke, .5 * (1 - k)));
          D.add('wedge', tx, ty + .07 - k * .2, tz, .46 * (1 - k * .5), .27 * (1 - k), .36, 0, rgba(C.canvas, 1 - k));
        } else if (e.kind === 'bolt') {
          D.add('box', tx, ty, tz, .1, 7 * (1 - k * .6), .1, 0, rgba(C.flash, 1 - k), 1.6);
          if (k > .1) blast(D, tx, ty, tz, (k - .1) / .9, .7, e.at * 13);
        } else if (e.kind === 'sortie') { // aircraft from the runway to a target and away
          const a = e.from, yaw0 = runwayYaw(a), ax = X[a], az = Z[a], ah = top(view, a) + .06;
          const sx = ax + Math.cos(yaw0) * 1.4, sz = az + Math.sin(yaw0) * 1.4, cruise = Math.max(ah, ty) + 3;
          let x, y, z, yaw = Math.atan2(tz - sz, tx - sx), tilt = 0;
          if (k < .15) { const s = k / .15; x = lerp(ax - Math.cos(yaw0) * 1.3, sx, s * s); z = lerp(az - Math.sin(yaw0) * 1.3, sz, s * s); y = ah + Math.max(0, s - .7) * 1; yaw = yaw0; tilt = s > .7 ? .25 : 0; }
          else if (k < .6) { const s = (k - .15) / .45; x = lerp(sx, tx, s); z = lerp(sz, tz, s); y = lerp(ah + .3, cruise, Math.min(1, s * 2)); tilt = s < .5 ? .15 : 0; }
          else { const s = (k - .6) / .4; x = tx + Math.cos(yaw) * s * 9; z = tz + Math.sin(yaw) * s * 9; y = cruise + s * 2; tilt = .1; }
          const alpha = k > .85 ? (1 - k) / .15 : 1;
          plane(D, x, y, z, yaw, tilt, e.player, 1.15, alpha);
          if (k >= .6) {
            const s = Math.min(1, (k - .6) / .25);
            if (e.payload === 'crate') {
              const py = lerp(cruise - .3, ty + .07, s);
              if (s < 1) { D.add('sphere', tx, py + .5, tz, .32, .18, .32, 0, rgba(C.paint)); D.rod(tx - .2, py + .5, tz, tx, py + .1, tz, .01, .01, rgba(C.dark)); D.rod(tx + .2, py + .5, tz, tx, py + .1, tz, .01, .01, rgba(C.dark)); }
              D.add('box', tx, py, tz, .2, .18, .2, 0, rgba(C.wood));
            } else if (s < 1) for (let b = 0; b < 2; b++) D.add('sphere', tx + (b - .5) * .25, lerp(cruise - .2, ty + .2, s * s), tz, .07, .11, .07, 0, rgba(C.dark));
            else if (!e.spawned) { e.spawned = true; if (e.payload === 'bomb') emit({ kind: e.hit ? 'blast' : 'deflect', at: e.to, dur: e.hit ? 2600 : 900, scar: !!e.hit, scale: 1.25 }); }
          }
        } else if (e.kind === 'beam') D.add('cyl', tx, ty, tz, .14, 3.5 * Math.sin(k * Math.PI), .14, 0, rgba(PC[e.player] || C.grey, .55), .9);
      }
    }
    function scars(D, view, list, now) {
      for (const s of list) {
        const left = (s.until - now) / 5000, alpha = Math.max(0, Math.min(1, left)) * .5;
        if (alpha > 0) D.add('cyl', X[s.at] + s.dx, top(view, s.at) + .005, Z[s.at] + s.dz, .42, .012, .42, 0, rgba(C.dark, alpha));
      }
    }

    return { top, TOP, parts, terrain, camp, castle, turret, aimFor, road, bridge, tunnel, routes, trucks, airfield, depot, plane, airTraffic, effects, scars, colors: { PC, PCUT, PLIGHT }, C, rgb, mix, rgba };
  }
  root.AutoHex3DScene = Object.freeze({ create });
})(typeof window !== 'undefined' ? window : globalThis);
