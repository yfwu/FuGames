/* AutoHex 3D battlefield view (ES module, three.js via shared/fu-three.js).
   Draws what an observation says and nothing else: terrain, territory tint
   and borders, fog, buildings, units, and battle playback. Knows no rules. */
import { THREE, createStage, inkMaterial, glowMaterial, palette } from '../shared/fu-three.js';

const SQ3 = Math.sqrt(3);
export const cellXZ = (q, r) => [SQ3 * (q + r / 2), 1.5 * r];
const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

const TERRAIN = {
  plain:    { h: .42, color: 0x2c343a },
  forest:   { h: .46, color: 0x1b2722 },
  hill:     { h: .86, color: 0x3b372f },
  mountain: { h: 1.08, color: 0x45423c },
  water:    { h: .12, color: 0x0c1826 },
  marsh:    { h: .28, color: 0x1e2a27 },
  bridge:   { h: .12, color: 0x0c1826 },
  pass:     { h: .72, color: 0x3b372f }
};
const C = {
  bone: 0xd9d2c0, paper: 0xece4d0, ink: 0x151b23, ink3: 0x212a35, wood: 0x6f5236, stone: 0x77746c, crop: 0xb79a4c,
  tree: 0x2c5a48, tree2: 0x23493b, peak: 0x8c877b, snow: 0xd9d2c0, gold: palette.gold, jade: palette.jade, neutral: 0xcfc6ad
};

export function createView(canvas, handlers = {}) {
  const stage = createStage(canvas, { fog: [46, 150], fov: 36, far: 600 });
  const { scene, camera, renderer } = stage;
  stage.lights.key.position.set(-22, 34, 18);
  const root = new THREE.Group(); scene.add(root);
  const groups = {};
  for (const k of ['terrain', 'deco', 'borders', 'marks', 'entities', 'fx']) { groups[k] = new THREE.Group(); root.add(groups[k]); }

  // ------------------------------------------------------------ resources
  const geo = {
    hex: (() => { const g = new THREE.CylinderGeometry(1, 1, 1, 6); g.translate(0, .5, 0); return g; })(),
    box: (() => { const g = new THREE.BoxGeometry(1, 1, 1); g.translate(0, .5, 0); return g; })(),
    cyl: (() => { const g = new THREE.CylinderGeometry(1, 1, 1, 10); g.translate(0, .5, 0); return g; })(),
    cyl6: (() => { const g = new THREE.CylinderGeometry(1, 1, 1, 6); g.translate(0, .5, 0); return g; })(),
    cone: (() => { const g = new THREE.ConeGeometry(1, 1, 8); g.translate(0, .5, 0); return g; })(),
    cone4: (() => { const g = new THREE.ConeGeometry(1, 1, 4); g.rotateY(Math.PI / 4); g.translate(0, .5, 0); return g; })(),
    cone6: (() => { const g = new THREE.ConeGeometry(1, 1, 6); g.translate(0, .5, 0); return g; })(),
    sphere: new THREE.SphereGeometry(1, 12, 8),
    octa: new THREE.OctahedronGeometry(1, 0),
    dodeca: new THREE.DodecahedronGeometry(1, 0),
    torus: new THREE.TorusGeometry(1, .06, 6, 28),
    bow: new THREE.TorusGeometry(1, .08, 4, 12, Math.PI),
    ring: (() => { const g = new THREE.RingGeometry(.80, .96, 6, 1); g.rotateX(-Math.PI / 2); g.rotateY(Math.PI / 6 + Math.PI / 2); return g; })(),
    disc: (() => { const g = new THREE.CircleGeometry(1, 6); g.rotateX(-Math.PI / 2); g.rotateY(Math.PI / 6 + Math.PI / 2); return g; })(),
    plane: new THREE.PlaneGeometry(1, 1),
    wedge: (() => { const s = new THREE.Shape(); s.moveTo(-.5, 0); s.lineTo(.5, 0); s.lineTo(0, .5); s.lineTo(-.5, 0); const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false }); g.translate(0, 0, -.5); return g; })(),
    wallRing: (() => { const outer = new THREE.Shape(), hole = new THREE.Path(); for (let k = 0; k <= 6; k++) { const a = k * Math.PI / 3; const f = k ? 'lineTo' : 'moveTo'; outer[f](Math.sin(a) * .9, Math.cos(a) * .9); hole[f](Math.sin(a) * .62, Math.cos(a) * .62); } outer.holes.push(hole); const g = new THREE.ExtrudeGeometry(outer, { depth: .42, bevelEnabled: false }); g.rotateX(-Math.PI / 2); return g; })()
  };
  const matCache = new Map();
  const mat = (color, extra = {}) => {
    const key = color + JSON.stringify(extra);
    if (!matCache.has(key)) matCache.set(key, inkMaterial(color, extra));
    return matCache.get(key);
  };
  const glow = (color, opacity = .9) => { const key = 'g' + color + ':' + opacity; if (!matCache.has(key)) matCache.set(key, glowMaterial(color, opacity)); return matCache.get(key); };
  const sideColor = owner => owner > 0 ? palette.sides[(owner - 1) % 6] : C.neutral;
  const sideMat = owner => mat(sideColor(owner), { emissive: new THREE.Color(sideColor(owner)).multiplyScalar(owner > 0 ? .18 : .08) });
  function part(g, m, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) {
    const mesh = new THREE.Mesh(g, m); mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); mesh.rotation.set(rx, ry, rz); return mesh;
  }

  // ------------------------------------------------------------ map state
  let map = null, cells = [], heights = [], tiles = null, deco = [];
  const tmpM = new THREE.Matrix4(), tmpC = new THREE.Color(), tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3();
  const topY = i => heights[i] ?? .4;
  const worldOf = i => { const c = cells[i]; return new THREE.Vector3(c.x, topY(i), c.z); };
  let bounds = 20;

  function setMap(m) {
    map = m;
    cells = m.cells.map(c => { const [x, z] = cellXZ(c.q, c.r); return { ...c, x, z }; });
    bounds = SQ3 * (m.R + 1);
    rebuildTerrain();
  }
  function rebuildTerrain() {
    for (const g of [groups.terrain, groups.deco]) while (g.children.length) { const o = g.children.pop(); if (o.isInstancedMesh) o.dispose(); }
    heights = cells.map(c => TERRAIN[c.t].h);
    tiles = new THREE.InstancedMesh(geo.hex, inkMaterial(0xffffff, { roughness: .92 }), cells.length);
    cells.forEach((c, i) => {
      tmpM.compose(tmpV.set(c.x, 0, c.z), tmpQ.identity(), tmpS.set(.985, heights[i], .985));
      tiles.setMatrixAt(i, tmpM);
      tiles.setColorAt(i, tmpC.set(TERRAIN[c.t].color));
    });
    tiles.instanceMatrix.needsUpdate = true; tiles.instanceColor.needsUpdate = true;
    groups.terrain.add(tiles);
    // decorations, batched per kind
    const batches = {};
    const add = (kind, g, m, x, y, z, sx, sy, sz, ry = 0) => { (batches[kind] = batches[kind] || { g, m, list: [] }).list.push([x, y, z, sx, sy, sz, ry]); };
    const h = (i, k) => (((i + 1) * 2654435761 + k * 40503) >>> 0) % 1000 / 1000;
    cells.forEach((c, i) => {
      const y = heights[i];
      if (c.t === 'forest') for (let k = 0; k < 4; k++) {
        const a = h(i, k) * 6.28, r = .2 + h(i, k + 9) * .45, s = .22 + h(i, k + 3) * .12;
        add(k % 2 ? 'tree' : 'tree2', geo.cone6, mat(k % 2 ? C.tree : C.tree2), c.x + Math.cos(a) * r, y, c.z + Math.sin(a) * r, s, .55 + h(i, k + 5) * .35, s, a);
      }
      if (c.t === 'mountain') { add('peak', geo.cone6, mat(C.peak), c.x, y, c.z, .78, 1.25 + h(i, 1) * .5, .78, h(i, 2) * 3); add('snow', geo.cone6, mat(C.snow), c.x, y + .75 + h(i, 1) * .3, c.z, .3, .55, .3, h(i, 2) * 3); }
      if (c.t === 'hill') add('mound', geo.dodeca, mat(0x4a4538), c.x + .15, y - .1, c.z - .1, .5, .28, .45, h(i, 4) * 3);
      if (c.t === 'pass') add('mound', geo.dodeca, mat(0x4a4538), c.x - .4, y - .05, c.z, .3, .3, .3, 0);
      if (c.t === 'marsh') for (let k = 0; k < 3; k++) add('reed', geo.cyl, mat(0x50604a), c.x + (h(i, k) - .5) * 1.1, y, c.z + (h(i, k + 4) - .5) * 1.1, .03, .25, .03);
      if (c.t === 'bridge') { add('deck', geo.box, mat(C.wood), c.x, y + .12, c.z, 1.5, .08, .5, Math.PI / 6 + Math.PI / 2); add('deck', geo.box, mat(C.wood), c.x, y + .12, c.z, 1.5, .08, .5, Math.PI / 6 - Math.PI / 6); }
      if (c.f === 'fertile') for (let k = 0; k < 3; k++) add('fert', geo.disc, glow(palette.jade, .35), c.x + (h(i, k) - .5) * .9, y + .012, c.z + (h(i, k + 2) - .5) * .9, .12, 1, .12);
      if (c.f === 'gold') for (let k = 0; k < 3; k++) add('goldc', geo.octa, mat(palette.gold, { emissive: new THREE.Color(palette.gold).multiplyScalar(.35), roughness: .4, metalness: .5 }), c.x + (h(i, k) - .5) * .7, y + .08, c.z + (h(i, k + 2) - .5) * .7, .1, .18, .1, h(i, k) * 3);
      if (c.t === 'water' || c.t === 'bridge') add('wave', geo.disc, glow(0x4fa3ff, .06), c.x, y + .01, c.z, .9, 1, .9);
    });
    for (const [kind, b] of Object.entries(batches)) {
      const inst = new THREE.InstancedMesh(b.g, b.m, b.list.length);
      b.list.forEach(([x, y, z, sx, sy, sz, ry], k) => { tmpQ.setFromEuler(new THREE.Euler(0, ry, 0)); tmpM.compose(tmpV.set(x, y, z), tmpQ, tmpS.set(sx, sy, sz)); inst.setMatrixAt(k, tmpM); });
      inst.instanceMatrix.needsUpdate = true; inst.name = kind; groups.deco.add(inst);
    }
    // relic monuments (animated)
    relics.length = 0;
    for (const r of map.relics) {
      const c = cells[r], g = new THREE.Group(), central = r === map.center;
      g.position.set(c.x, heights[r], c.z);
      g.add(part(geo.cyl6, mat(0x3b3d3f), 0, 0, 0, .78, .1, .78));
      for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3 + Math.PI / 6; g.add(part(geo.box, mat(0x55534c), Math.sin(a) * .62, .08, Math.cos(a) * .62, .12, central ? .8 : .55, .12, a)); }
      const gem = part(geo.octa, mat(palette.gold, { emissive: new THREE.Color(palette.gold).multiplyScalar(.7), roughness: .3, metalness: .4 }), 0, central ? 1.25 : .95, 0, .2, .32, .2);
      const halo = part(geo.torus, glow(palette.gold, .55), 0, central ? 1.25 : .95, 0, .42, .42, .42, 0, Math.PI / 2);
      g.add(gem, halo); g.userData = { gem, halo, base: gem.position.y };
      groups.deco.add(g); relics.push(g);
    }
    buildBorders([]);
  }
  const relics = [];

  // ------------------------------------------------------------ territory
  let lastTerritory = null, lastVisible = null;
  function paintTiles(territory, visible, recent) {
    if (!tiles) return;
    cells.forEach((c, i) => {
      tmpC.set(TERRAIN[c.t].color);
      const o = territory ? territory[i] : 0;
      if (o > 0) tmpC.lerp(new THREE.Color(sideColor(o)), c.t === 'water' ? .12 : .2);
      else if (o === -1) tmpC.lerp(new THREE.Color(C.bone), .1);
      if (visible && !visible[i]) tmpC.multiplyScalar(.42);
      if (recent && recent.has(i)) tmpC.lerp(new THREE.Color(C.paper), .12);
      tiles.setColorAt(i, tmpC);
    });
    tiles.instanceColor.needsUpdate = true;
  }
  let borderMesh = null;
  function buildBorders(territory, show = true) {
    if (borderMesh) { groups.borders.remove(borderMesh); borderMesh.dispose(); borderMesh = null; }
    if (!show || !territory || !territory.length) return;
    const segs = [];
    const index = new Map(cells.map((c, i) => [c.q + ',' + c.r, i]));
    cells.forEach((c, i) => {
      const o = territory[i]; if (!(o > 0)) return;
      DIRS.forEach(([dq, dr]) => {
        const j = index.get((c.q + dq) + ',' + (c.r + dr));
        if (j !== undefined && territory[j] === o) return;
        const [dx, dz] = cellXZ(dq, dr), phi = Math.atan2(dx, dz);
        const a = [Math.sin(phi - Math.PI / 6) * .9, Math.cos(phi - Math.PI / 6) * .9], b = [Math.sin(phi + Math.PI / 6) * .9, Math.cos(phi + Math.PI / 6) * .9];
        segs.push({ i, o, ax: c.x + a[0], az: c.z + a[1], bx: c.x + b[0], bz: c.z + b[1], y: Math.max(topY(i), j !== undefined ? topY(j) : 0) + .03 });
      });
    });
    if (!segs.length) return;
    borderMesh = new THREE.InstancedMesh(geo.box, glow(0xffffff, .95), segs.length);
    segs.forEach((s, k) => {
      const ex = s.bx - s.ax, ez = s.bz - s.az, len = Math.hypot(ex, ez);
      tmpQ.setFromEuler(new THREE.Euler(0, Math.atan2(-ez, ex), 0));
      tmpM.compose(tmpV.set((s.ax + s.bx) / 2, s.y, (s.az + s.bz) / 2), tmpQ, tmpS.set(len * 1.04, .05, .07));
      borderMesh.setMatrixAt(k, tmpM); borderMesh.setColorAt(k, tmpC.set(sideColor(s.o)));
    });
    borderMesh.instanceMatrix.needsUpdate = true; borderMesh.instanceColor.needsUpdate = true;
    groups.borders.add(borderMesh);
  }

  // ------------------------------------------------------------ marks
  const hoverMark = part(geo.ring, glow(palette.paper, .55)); hoverMark.visible = false;
  const selectMark = part(geo.ring, glow(palette.seal, .95), 0, 0, 0, 1.04, 1, 1.04); selectMark.visible = false;
  groups.marks.add(hoverMark, selectMark);
  let targetMesh = null, goalMesh = null;
  function placeMark(m, i) { if (i === null || i === undefined || i < 0 || !cells[i]) { m.visible = false; return; } m.visible = true; m.position.set(cells[i].x, topY(i) + .035, cells[i].z); }
  function setTargets(list, tone = palette.azure) {
    if (targetMesh) { groups.marks.remove(targetMesh); targetMesh.dispose(); targetMesh = null; }
    if (!list || !list.length) return;
    targetMesh = new THREE.InstancedMesh(geo.ring, glow(tone, .8), list.length);
    list.forEach((i, k) => { tmpM.compose(tmpV.set(cells[i].x, topY(i) + .03, cells[i].z), tmpQ.identity(), tmpS.set(.9, 1, .9)); targetMesh.setMatrixAt(k, tmpM); });
    targetMesh.instanceMatrix.needsUpdate = true; groups.marks.add(targetMesh);
  }
  function setGoals(list) { // own unit goals: small seal diamonds
    if (goalMesh) { groups.marks.remove(goalMesh); goalMesh.dispose(); goalMesh = null; }
    if (!list || !list.length) return;
    goalMesh = new THREE.InstancedMesh(geo.octa, glow(palette.seal, .85), list.length);
    list.forEach((i, k) => { tmpM.compose(tmpV.set(cells[i].x, topY(i) + 1.5, cells[i].z), tmpQ.identity(), tmpS.set(.14, .22, .14)); goalMesh.setMatrixAt(k, tmpM); });
    goalMesh.instanceMatrix.needsUpdate = true; groups.marks.add(goalMesh);
  }

  // ------------------------------------------------------------ models
  function buildingModel(type, owner, lvl) {
    const g = new THREE.Group(), S = sideMat(owner), B = mat(C.bone), I = mat(C.ink), W = mat(C.wood), ST = mat(C.stone);
    switch (type) {
      case 'capital':
        g.add(part(geo.cyl6, I, 0, 0, 0, .8, .16, .8));
        g.add(part(geo.box, B, 0, .16, 0, .72, .5, .72));
        for (const [x, z] of [[-.38, -.38], [.38, -.38], [-.38, .38], [.38, .38]]) { g.add(part(geo.cyl, B, x, .16, z, .14, .78, .14)); g.add(part(geo.cone, S, x, .94, z, .17, .3, .17)); }
        g.add(part(geo.cone4, S, 0, .66, 0, .5, .48, .5));
        g.add(part(geo.cyl, I, 0, 1.1, 0, .015, .55, .015), part(geo.box, S, .13, 1.45, 0, .26, .16, .02));
        break;
      case 'farm':
        g.add(part(geo.box, mat(0x2f3a26), 0, 0, 0, 1.2, .03, 1.2, Math.PI / 6));
        for (let k = -2; k <= 2; k++) g.add(part(geo.box, mat(C.crop), k * .2, .03, .1, .1, .07, .9, 0));
        g.add(part(geo.box, B, -.45, .03, -.42, .26, .2, .22), part(geo.wedge, S, -.45, .23, -.42, .3, .26, .26));
        break;
      case 'lumber':
        g.add(part(geo.box, B, -.15, 0, -.1, .4, .26, .32), part(geo.wedge, S, -.15, .26, -.1, .46, .3, .38));
        for (let k = 0; k < 3; k++) g.add(part(geo.cyl, W, .32, .06 + (k === 2 ? .1 : 0), .15 + (k === 1 ? .12 : 0) - (k === 2 ? .06 : 0), .06, .5, .06, 0, 0, Math.PI / 2));
        g.add(part(geo.cyl, W, .3, 0, -.38, .1, .12, .1));
        break;
      case 'mine':
        g.add(part(geo.dodeca, ST, 0, .05, 0, .55, .42, .5));
        g.add(part(geo.box, I, 0, 0, .38, .3, .28, .14), part(geo.box, S, 0, .28, .4, .38, .06, .18));
        g.add(part(geo.box, W, .32, 0, .55, .08, .03, .4));
        break;
      case 'market':
        g.add(part(geo.cone4, S, -.22, 0, 0, .34, .55, .34), part(geo.cone4, mat(C.bone), .26, 0, .18, .28, .45, .28));
        g.add(part(geo.box, W, .2, 0, -.32, .2, .14, .2), part(geo.box, W, .38, 0, -.2, .14, .1, .14));
        break;
      case 'granary':
        g.add(part(geo.cyl, B, -.12, 0, 0, .3, .62, .3), part(geo.sphere, S, -.12, .62, 0, .3, .2, .3));
        g.add(part(geo.cyl, B, .32, 0, .2, .18, .42, .18), part(geo.sphere, S, .32, .42, .2, .18, .12, .18));
        break;
      case 'outpost':
        for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2; g.add(part(geo.cyl, W, Math.sin(a) * .55, 0, Math.cos(a) * .55, .05, .34 + (k % 2) * .05, .05)); }
        g.add(part(geo.cyl, B, 0, 0, 0, .16, .7, .16), part(geo.cone, S, 0, .7, 0, .22, .26, .22));
        g.add(part(geo.cyl, I, 0, .96, 0, .012, .4, .012), part(geo.box, S, .1, 1.22, 0, .2, .12, .02));
        break;
      case 'barracks':
        g.add(part(geo.box, B, 0, 0, 0, .86, .32, .46, Math.PI / 6), part(geo.wedge, S, 0, .32, 0, .92, .3, .52, Math.PI / 6));
        g.add(part(geo.cyl, I, .42, 0, .45, .015, .8, .015), part(geo.box, S, .42, .62, .55, .02, .26, .18));
        break;
      case 'workshop':
        g.add(part(geo.box, B, 0, 0, 0, .7, .38, .5), part(geo.box, I, .22, .38, .1, .12, .34, .12));
        g.add(part(geo.torus, mat(palette.gold, { emissive: new THREE.Color(palette.gold).multiplyScalar(.25) }), -.2, .5, .26, .17, .17, .6));
        g.add(part(geo.wedge, S, 0, .38, 0, .74, .16, .54));
        break;
      case 'tower':
        g.add(part(geo.cyl6, ST, 0, 0, 0, .34, .22, .34), part(geo.cyl, B, 0, .22, 0, .22, 1.0, .22));
        g.add(part(geo.cyl, B, 0, 1.2, 0, .3, .1, .3), part(geo.cone, S, 0, 1.3, 0, .32, .42, .32));
        break;
      case 'wall':
        g.add(part(geo.wallRing, ST, 0, 0, 0, 1, 1, 1), part(geo.wallRing, S, 0, .42, 0, 1, .12, 1));
        break;
      case 'shrine':
        for (const x of [-.32, .32]) g.add(part(geo.cyl, S, x, 0, 0, .07, .95, .07));
        g.add(part(geo.box, S, 0, .92, 0, 1.0, .08, .14), part(geo.box, S, 0, .74, 0, .76, .05, .1));
        g.add(part(geo.octa, mat(palette.gold, { emissive: new THREE.Color(palette.gold).multiplyScalar(.6) }), 0, .45, 0, .12, .18, .12));
        break;
      default:
        g.add(part(geo.box, B, 0, 0, 0, .5, .4, .5));
    }
    if (lvl > 1) g.add(part(geo.torus, glow(palette.gold, .9), 0, .05, 0, .84, .84, .84, 0, Math.PI / 2));
    return g;
  }
  function unitModel(type, owner) {
    const g = new THREE.Group(), S = sideMat(owner), B = mat(owner ? C.bone : C.neutral), I = mat(C.ink), W = mat(C.wood);
    const body = new THREE.Group(); g.add(body);
    body.add(part(geo.cyl, S, 0, 0, 0, .26, .05, .26));
    switch (type) {
      case 'militia': body.add(part(geo.cyl, B, 0, .05, 0, .1, .3, .1), part(geo.sphere, S, 0, .43, 0, .085, .085, .085)); break;
      case 'spear': body.add(part(geo.cyl, B, 0, .05, 0, .11, .34, .11), part(geo.sphere, S, 0, .48, 0, .09, .09, .09), part(geo.cyl, I, .15, .05, 0, .014, .75, .014), part(geo.cone, B, .15, .8, 0, .04, .1, .04)); break;
      case 'archer': body.add(part(geo.cyl, B, 0, .05, 0, .1, .32, .1), part(geo.sphere, S, 0, .45, 0, .085, .085, .085), part(geo.bow, S, .15, .32, 0, .2, .2, .2, Math.PI / 2, 0, Math.PI / 2)); break;
      case 'cavalry': body.add(part(geo.box, I, 0, .14, 0, .14, .16, .46), part(geo.box, I, 0, .2, .26, .1, .14, .14), part(geo.cyl, B, 0, .3, -.03, .085, .24, .085), part(geo.sphere, S, 0, .6, -.03, .08, .08, .08), part(geo.cyl, I, 0, .05, .16, .03, .1, .03), part(geo.cyl, I, 0, .05, -.16, .03, .1, .03)); break;
      case 'scout': body.add(part(geo.cyl, B, 0, .05, 0, .07, .26, .07), part(geo.sphere, S, 0, .38, 0, .08, .08, .08), part(geo.cyl, I, -.12, .05, 0, .01, .5, .01), part(geo.box, S, -.06, .44, 0, .12, .08, .01)); break;
      case 'catapult': body.add(part(geo.box, W, 0, .05, 0, .3, .1, .42), part(geo.box, W, 0, .14, .02, .05, .05, .55, 0, -.6), part(geo.sphere, I, 0, .42, -.22, .07, .07, .07), part(geo.box, S, 0, .15, .18, .32, .06, .06)); break;
      case 'guardian': body.add(part(geo.octa, mat(C.neutral, { emissive: new THREE.Color(palette.gold).multiplyScalar(.25) }), 0, .55, 0, .3, .5, .3), part(geo.torus, glow(palette.gold, .7), 0, .55, 0, .4, .4, .4, 0, Math.PI / 2)); break;
      case 'sentinel': body.add(part(geo.octa, mat(C.neutral, { emissive: new THREE.Color(palette.gold).multiplyScalar(.18) }), 0, .4, 0, .18, .32, .18)); break;
      default: body.add(part(geo.cyl, B, 0, .05, 0, .1, .3, .1));
    }
    g.userData.body = body;
    return g;
  }
  function hpBar() {
    const g = new THREE.Group();
    const bg = part(geo.plane, new THREE.MeshBasicMaterial({ color: palette.ink0, transparent: true, opacity: .8, depthWrite: false }), 0, 0, 0, .7, .08, 1);
    const fg = part(geo.plane, new THREE.MeshBasicMaterial({ color: palette.jade, depthWrite: false, toneMapped: false }), 0, 0, .001, .66, .05, 1);
    g.add(bg, fg); g.userData.fg = fg; g.renderOrder = 5; return g;
  }
  function setBar(bar, hp, max) {
    const v = Math.max(0, Math.min(1, hp / max)), fg = bar.userData.fg;
    fg.scale.x = .66 * v; fg.position.x = -.33 * (1 - v);
    fg.material.color.set(v > .6 ? palette.jade : v > .3 ? palette.gold : palette.seal);
    bar.visible = showBars && v < 1;
  }

  // ------------------------------------------------------------ entities
  const buildings = new Map(), units = new Map();
  let showBars = true;
  const unitOffset = new THREE.Vector3(0, 0, 0);
  function placeUnit(e, i) { e.group.position.copy(worldOf(i)).add(unitOffset); e.cell = i; }
  function addBuilding(b) {
    const group = buildingModel(b.type, b.owner, b.lvl);
    group.position.copy(worldOf(b.cell)); group.rotation.y = ((b.cell * 37) % 6) * Math.PI / 3;
    const bar = hpBar(); bar.position.set(0, b.type === 'tower' ? 2.0 : b.type === 'capital' ? 1.8 : 1.15, 0); group.add(bar);
    const e = { id: b.id, type: b.type, owner: b.owner, lvl: b.lvl, cell: b.cell, group, bar, born: now };
    group.scale.setScalar(.01); grow.push(e);
    groups.entities.add(group); buildings.set(b.id, e); return e;
  }
  function addUnit(u, at = u.cell) {
    const group = unitModel(u.type, u.owner);
    const bar = hpBar(); bar.position.set(0, u.type === 'guardian' ? 1.25 : .95, 0); bar.scale.setScalar(.8); group.add(bar);
    const e = { id: u.id, type: u.type, owner: u.owner, cell: at, group, bar, hp: u.hp, max: u.max };
    placeUnit(e, at); group.rotation.y = ((u.id * 53) % 12) * Math.PI / 6;
    group.scale.setScalar(.01); grow.push(e);
    groups.entities.add(group); units.set(u.id, e); return e;
  }
  function removeEntity(map, id, fx = 'fade') {
    const e = map.get(id); if (!e) return; map.delete(id);
    if (fx === 'none' || reduced()) { groups.entities.remove(e.group); return; }
    shrink.push({ e, t0: now, dur: fx === 'raze' ? .7 : .45, raze: fx === 'raze' });
  }
  const grow = [], shrink = [];

  function update(obs, opts = {}) {
    showBars = opts.bars !== false;
    if (!map) setMap(obs.map);
    // terrain can change (bridges, clearing, tunnels)
    let changed = false;
    obs.map.cells.forEach((c, i) => { if (cells[i].t !== c.t) { cells[i].t = c.t; changed = true; } });
    if (changed) rebuildTerrain();
    const vis = opts.omniscient ? null : obs.visible;
    paintTiles(obs.territory.map(o => o === null ? 0 : o), vis);
    buildBorders(obs.territory.map(o => o === null ? 0 : o), opts.borders !== false);
    // buildings
    const seenB = new Set();
    for (const b of obs.buildings) {
      seenB.add(b.id);
      let e = buildings.get(b.id);
      if (e && (e.lvl !== b.lvl || e.owner !== b.owner)) { removeEntity(buildings, b.id, 'none'); e = null; }
      if (!e) e = addBuilding(b);
      setBar(e.bar, b.hp, b.max);
      e.group.userData.dim = b.hungry || !b.connected;
    }
    for (const id of [...buildings.keys()]) if (!seenB.has(id)) removeEntity(buildings, id, 'fade');
    // remembered enemy buildings: ghost markers
    ghosts.forEach(gh => groups.entities.remove(gh)); ghosts.length = 0;
    for (const it of obs.intel || []) {
      if (obs.buildings.some(b => b.cell === it.cell)) continue;
      const gh = buildingModel(it.type, it.owner, 1);
      gh.traverse(o => { if (o.isMesh) o.material = glow(sideColor(it.owner), .16); });
      gh.position.copy(worldOf(it.cell)); groups.entities.add(gh); ghosts.push(gh);
    }
    // units
    const seenU = new Set();
    for (const u of obs.units) {
      seenU.add(u.id);
      let e = units.get(u.id);
      if (!e) e = addUnit(u);
      else if (e.cell !== u.cell && !e.moving) placeUnit(e, u.cell);
      e.hp = u.hp; e.max = u.max; setBar(e.bar, u.hp, u.max);
    }
    for (const id of [...units.keys()]) if (!seenU.has(id)) removeEntity(units, id, 'fade');
    setGoals((obs.units || []).filter(u => u.owner === obs.you && u.stance === 'advance' && u.goal >= 0).map(u => u.goal).filter((v, k, a) => a.indexOf(v) === k));
  }
  const ghosts = [];

  // ------------------------------------------------------------ battle playback
  const tweens = [], particles = [];
  let now = 0;
  const ease = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  function tween(dur, fn, done) { tweens.push({ t0: now, dur, fn, done }); }
  function spark(pos, color, n = 10, power = 1) {
    if (reduced()) return;
    for (let k = 0; k < n; k++) {
      const m = part(geo.box, glow(color, .95), pos.x, pos.y, pos.z, .06, .06, .06);
      const a = Math.random() * Math.PI * 2, s = (1.2 + Math.random() * 2.2) * power;
      m.userData = { vx: Math.cos(a) * s * .5, vy: 1.5 + Math.random() * 2.5 * power, vz: Math.sin(a) * s * .5, life: .5 + Math.random() * .5, t0: now };
      groups.fx.add(m); particles.push(m);
    }
  }
  function floater(i, text, cls) { if (handlers.floater && cells[i]) { const p = project(worldOf(i).add(new THREE.Vector3(0, 1.1, 0))); if (p) handlers.floater(p.x, p.y, text, cls); } }

  function playFrames(frames, opts = {}) {
    const step = opts.step ?? .42;
    if (!frames || !frames.length || step <= 0) return Promise.resolve();
    return new Promise(resolve => {
      let k = 0;
      const run = () => {
        if (k >= frames.length) { resolve(); return; }
        const fe = frames[k++];
        for (const e of fe) handleEvent(e, step, opts);
        setTimeout(run, step * 1000);
      };
      run();
    });
  }
  function handleEvent(e, step, opts) {
    if (e.e === 'move') {
      let u = units.get(e.unit);
      if (!u) { if (!cells[e.from]) return; u = addUnit({ id: e.unit, type: e.type || 'militia', owner: e.owner, hp: 1, max: 1, cell: e.from }); }
      const a = worldOf(e.from).add(unitOffset), b = worldOf(e.to).add(unitOffset);
      const face = Math.atan2(b.x - a.x, b.z - a.z);
      u.moving = true; u.cell = e.to; u.group.rotation.y = face;
      tween(step * .9, t => { const s = ease(t); u.group.position.lerpVectors(a, b, s); u.group.position.y += Math.sin(s * Math.PI) * .25; }, () => { u.moving = false; });
    } else if (e.e === 'hit') {
      const from = worldOf(e.from).add(new THREE.Vector3(0, .45, 0)), to = worldOf(e.to).add(new THREE.Vector3(0, .4, 0));
      const src = e.srcKind === 'unit' ? units.get(e.src) : buildings.get(e.src);
      const color = sideColor(e.owner);
      if (e.ranged) {
        const shot = part(geo.sphere, glow(color, 1), from.x, from.y, from.z, .07, .07, .07); groups.fx.add(shot);
        const arc = Math.min(2.2, from.distanceTo(to) * .35);
        tween(step * .6, t => { shot.position.lerpVectors(from, to, t); shot.position.y += Math.sin(t * Math.PI) * arc; }, () => { groups.fx.remove(shot); spark(to, color, 6, .6); floater(e.to, '−' + e.dmg, 'is-bad'); });
      } else if (src) {
        const base = src.group.position.clone(), dir = to.clone().sub(from).setY(0).normalize().multiplyScalar(.35);
        if (e.srcKind === 'unit') { src.group.rotation.y = Math.atan2(dir.x, dir.z); tween(step * .5, t => { src.group.position.copy(base).addScaledVector(dir, Math.sin(t * Math.PI)); }); }
        setTimeout(() => { spark(to, color, 5, .5); floater(e.to, '−' + e.dmg, 'is-bad'); }, step * 250);
      }
      const tgt = e.dstKind === 'unit' ? units.get(e.dst) : buildings.get(e.dst);
      if (tgt) { tgt.hp = (tgt.hp ?? 1) - e.dmg; if (tgt.max) setBar(tgt.bar, tgt.hp, tgt.max); }
    } else if (e.e === 'die') {
      setTimeout(() => { const u = units.get(e.unit); if (u) spark(u.group.position.clone().add(new THREE.Vector3(0, .3, 0)), sideColor(e.owner), 8, .7); removeEntity(units, e.unit, 'fade'); }, step * 450);
    } else if (e.e === 'raze') {
      setTimeout(() => { const b = buildings.get(e.building); spark(worldOf(e.cell).add(new THREE.Vector3(0, .5, 0)), palette.gold, 22, 1.2); spark(worldOf(e.cell).add(new THREE.Vector3(0, .5, 0)), sideColor(e.owner), 14, 1); if (b) removeEntity(buildings, e.building, 'raze'); floater(e.cell, e.type === 'capital' ? '都城陷落' : '摧毀', 'is-gold'); shake = .35; }, step * 500);
    } else if (e.e === 'trap') {
      spark(worldOf(e.cell).add(new THREE.Vector3(0, .2, 0)), palette.gold, 12, .8); floater(e.cell, '伏兵 −' + e.dmg, 'is-gold');
    }
  }

  // ------------------------------------------------------------ camera
  const cam = { x: 0, z: 0, dist: 40, yaw: 0, pitch: .95, tx: 0, tz: 0, tdist: 40, tyaw: 0, tpitch: .95 };
  let shake = 0;
  function applyCamera(dt) {
    const k = 1 - Math.pow(.0009, dt);
    cam.x += (cam.tx - cam.x) * k; cam.z += (cam.tz - cam.z) * k; cam.dist += (cam.tdist - cam.dist) * k; cam.yaw += (cam.tyaw - cam.yaw) * k; cam.pitch += (cam.tpitch - cam.pitch) * k;
    const cp = Math.cos(cam.pitch);
    camera.position.set(cam.x + Math.sin(cam.yaw) * cp * cam.dist, Math.sin(cam.pitch) * cam.dist, cam.z + Math.cos(cam.yaw) * cp * cam.dist);
    if (shake > 0) { camera.position.x += (Math.random() - .5) * shake; camera.position.y += (Math.random() - .5) * shake; shake = Math.max(0, shake - dt * 1.2); }
    camera.lookAt(cam.x, 0, cam.z);
  }
  const clampT = () => { const r = Math.hypot(cam.tx, cam.tz); if (r > bounds) { cam.tx *= bounds / r; cam.tz *= bounds / r; } cam.tdist = Math.max(9, Math.min(bounds * 2.6, cam.tdist)); cam.tpitch = Math.max(.42, Math.min(1.38, cam.tpitch)); };
  function pan(dx, dy) {
    const s = cam.tdist * .0017, fx = -Math.sin(cam.tyaw), fz = -Math.cos(cam.tyaw), rx = Math.cos(cam.tyaw), rz = -Math.sin(cam.tyaw);
    cam.tx += -rx * dx * s + fx * dy * s; cam.tz += -rz * dx * s + fz * dy * s; clampT();
  }
  function panWorld(dx, dz) { const rx = Math.cos(cam.tyaw), rz = -Math.sin(cam.tyaw), fx = -Math.sin(cam.tyaw), fz = -Math.cos(cam.tyaw); cam.tx += rx * dx + fx * dz; cam.tz += rz * dx + fz * dz; clampT(); }
  function rotate(dyaw, dpitch = 0) { cam.tyaw += dyaw; cam.tpitch += dpitch; clampT(); }
  function zoom(f) { cam.tdist *= f; clampT(); }
  function focusCell(i, dist) { if (!cells[i]) return; cam.tx = cells[i].x; cam.tz = cells[i].z; if (dist) cam.tdist = dist; clampT(); }
  function fit() { cam.tx = 0; cam.tz = 0; cam.tdist = bounds * 2.25; cam.tpitch = 1.0; clampT(); }
  function faceSeat(i) { if (!cells[i]) return; cam.tyaw = Math.atan2(cells[i].x, cells[i].z); }

  // ------------------------------------------------------------ picking & input
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function pick(clientX, clientY) {
    if (!tiles) return -1;
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(tiles, false)[0];
    return hit ? hit.instanceId : -1;
  }
  function project(v) {
    const p = v.clone().project(camera); if (p.z > 1) return null;
    const r = canvas.getBoundingClientRect();
    return { x: (p.x + 1) / 2 * r.width, y: (1 - p.y) / 2 * r.height };
  }
  const pointers = new Map(); let drag = null, pinch = null;
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x) }; drag = null; return; }
    drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, mode: e.button === 2 || e.shiftKey || e.altKey ? 'rotate' : 'pan', moved: false, button: e.button };
  });
  canvas.addEventListener('pointermove', e => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
      zoom(pinch.d / Math.max(1, d)); rotate(ang - pinch.ang); pinch = { d, ang }; return;
    }
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 5) drag.moved = true;
      if (drag.moved) { if (drag.mode === 'pan') pan(dx, dy); else rotate(-dx * .006, dy * .004); }
      return;
    }
    const i = pick(e.clientX, e.clientY); placeMark(hoverMark, i);
    if (handlers.hover) handlers.hover(i, e);
  });
  const end = e => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (drag && !drag.moved && e.type === 'pointerup') { const i = pick(e.clientX, e.clientY); if (handlers.click) handlers.click(i, { button: drag.button, shift: e.shiftKey }); }
    if (!pointers.size) drag = null;
  };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => { placeMark(hoverMark, -1); if (handlers.hover) handlers.hover(-1); });
  canvas.addEventListener('wheel', e => { e.preventDefault(); zoom(Math.exp(e.deltaY * .0012)); }, { passive: false });

  // ------------------------------------------------------------ loop
  const reducedQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const reduced = () => reducedQuery.matches;
  stage.loop((dt, t) => {
    now = t;
    applyCamera(dt);
    for (let k = tweens.length - 1; k >= 0; k--) { const tw = tweens[k], p = Math.min(1, (now - tw.t0) / tw.dur); tw.fn(p); if (p >= 1) { tweens.splice(k, 1); if (tw.done) tw.done(); } }
    for (let k = grow.length - 1; k >= 0; k--) { const e = grow[k], p = Math.min(1, (now - (e.g0 ??= now)) / .35); e.group.scale.setScalar(.01 + .99 * (1 - Math.pow(1 - p, 3))); if (p >= 1) grow.splice(k, 1); }
    for (let k = shrink.length - 1; k >= 0; k--) {
      const s = shrink[k], p = Math.min(1, (now - s.t0) / s.dur);
      if (s.raze) { s.e.group.scale.set(1 + p * .2, Math.max(.01, 1 - p), 1 + p * .2); s.e.group.rotation.z = p * .3; } else s.e.group.scale.setScalar(Math.max(.01, 1 - p));
      if (p >= 1) { groups.entities.remove(s.e.group); shrink.splice(k, 1); }
    }
    for (let k = particles.length - 1; k >= 0; k--) {
      const m = particles[k], d = m.userData, age = now - d.t0;
      if (age > d.life) { groups.fx.remove(m); particles.splice(k, 1); continue; }
      d.vy -= 9.8 * dt; m.position.x += d.vx * dt; m.position.y = Math.max(.1, m.position.y + d.vy * dt); m.position.z += d.vz * dt; m.material.opacity = 1 - age / d.life;
    }
    // billboard hp bars, gentle idle motion
    const q = camera.quaternion;
    for (const e of [...buildings.values(), ...units.values()]) { if (e.bar.visible) { e.bar.quaternion.copy(e.group.quaternion).invert().multiply(q); } }
    if (!reduced()) {
      for (const r of relics) { r.userData.gem.rotation.y = t * .8; r.userData.gem.position.y = r.userData.base + Math.sin(t * 1.6) * .06; r.userData.halo.rotation.z = t * .4; }
      for (const u of units.values()) if (!u.moving && u.group.userData.body) u.group.userData.body.position.y = Math.abs(Math.sin(t * 2 + u.id)) * .02;
    }
  });

  return {
    stage, setMap, update, playFrames, setTargets, setGoals, pan, panWorld, rotate, zoom, focusCell, fit, faceSeat,
    setHover: i => placeMark(hoverMark, i), setSelected: i => placeMark(selectMark, i),
    project: i => cells[i] ? project(worldOf(i)) : null,
    floater, pick, reset() { for (const m of [buildings, units]) for (const id of [...m.keys()]) removeEntity(m, id, 'none'); ghosts.forEach(g => groups.entities.remove(g)); ghosts.length = 0; map = null; },
    get bounds() { return bounds; }
  };
}
