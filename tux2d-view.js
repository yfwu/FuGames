/* Tux 2D 山路快遞 — three.js chase-camera view (ES module).
   Ink-wash alpine valley: ink mountains, paper snow, one vermilion kart (you). It only reads
   window.TuxApp / window.tux2dGame; every rule stays in tux2d-engine.js. Original low-poly art. */
import { THREE, createStage, palette, fonts, loadFonts } from './shared/fu-three.js';

const app = window.TuxApp, E = window.Tux2D, canvas = document.getElementById('tux-board');
const ZS = 0.1, HALF = 2.4;              // world units per engine z, road half-width in world units
const TAU = Math.PI * 2;

function fail() {
  const d = document.createElement('div'); d.className = 'tux-fail';
  d.innerHTML = '<div><p>這台裝置或瀏覽器無法啟用 WebGL，山路快遞的 3D 賽道無法顯示。</p><p><a href="index.html">回到 FuGames</a></p></div>';
  document.body.append(d);
}
let stage = null;
try { stage = createStage(canvas, { fov: 60, near: 0.1, far: 900, fog: [60, 320], exposure: 1.0 }); } catch (e) { fail(); }

if (stage && app && E) {
const { scene, camera, lights } = stage;
const HAZE = 0x1f2832;
scene.background = new THREE.Color(palette.ink0);
scene.fog = new THREE.Fog(HAZE, 60, 320);
lights.hemi.intensity = 1.25; lights.hemi.groundColor = new THREE.Color(0x1a1f26);
lights.key.intensity = 2.1; lights.key.position.set(-30, 40, 10);
lights.rim.intensity = 1.1;

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: .86, metalness: .04, flatShading: true }, extra));
const basic = (color, extra = {}) => new THREE.MeshBasicMaterial(Object.assign({ color, toneMapped: false }, extra));
const C = {
  snow: new THREE.Color(0x9b958a), snowLight: new THREE.Color(0xc9c1ae), rock: new THREE.Color(0x2a313b), rockDark: new THREE.Color(0x1a2028),
  asphalt: new THREE.Color(0x1b2129), asphalt2: new THREE.Color(0x20272f), ice: new THREE.Color(0x5d7f9c), ice2: new THREE.Color(0x6e93b0),
  kerbA: new THREE.Color(0x313a46), kerbB: new THREE.Color(0xa8a08c), supply: new THREE.Color(0x24423c)
};

// ---------- Sky: ink dome with a pale horizon haze and a small vermilion sun ----------
const skyGeo = new THREE.SphereGeometry(700, 24, 16);
{ const pos = skyGeo.attributes.position, col = [], top = new THREE.Color(palette.ink0), hor = new THREE.Color(HAZE), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i) / 700; c.copy(hor).lerp(top, Math.min(1, Math.max(0, y * 2.4))); col.push(c.r, c.g, c.b); }
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); }
const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
sky.renderOrder = -2; scene.add(sky);
const sun = new THREE.Mesh(new THREE.CircleGeometry(18, 40), basic(palette.seal, { fog: false, transparent: true, opacity: .92 }));
sun.renderOrder = -1; scene.add(sun);

// ---------- Road geometry helpers ----------
let G = null;                                  // current game
const elev = z => 7 * Math.sin(z / 1300) + 2.6 * Math.sin(z / 470 + 1);
const cx = z => (G ? G.center(z) : E.roadCenter(z)) / 440;
const wx = (z, x) => (cx(z) + x) * HALF;
const wz = z => -z * ZS;
// Terrain profile across the road (road units from the centre line) per route.
const PROFILES = {
  alpine: { xs: [1.12, 2, 4, 8, 16, 40], hs: [0, .05, .45, 2.2, 7, 18] },
  canyon: { xs: [1.12, 1.6, 2.6, 5, 10, 40], hs: [0, .1, 3.6, 10, 18, 26] },
  glacier: { xs: [1.12, 2, 5, 10, 20, 40], hs: [0, .02, .15, .7, 2.4, 7] }
};
let profile = PROFILES.alpine;
function sideHeight(z, ax) {                    // ax = |x| in road units, beyond the kerb
  const { xs, hs } = profile; if (ax <= xs[0]) return 0;
  for (let i = 1; i < xs.length; i++) if (ax <= xs[i]) { const t = (ax - xs[i - 1]) / (xs[i] - xs[i - 1]); return hs[i - 1] + (hs[i] - hs[i - 1]) * t; }
  return hs[hs.length - 1];
}
const wobble = (z, side, i) => i < 2 ? 0 : (Math.sin(z / 97 + side * 3 + i) * .35 + Math.sin(z / 41 + i * 2) * .18) * i;
const groundY = (z, x) => elev(z) + sideHeight(z, Math.abs(x));

function seeded(seed) { let n = 2166136261; for (const c of String(seed)) n = Math.imul(n ^ c.charCodeAt(0), 16777619); return () => { n = Math.imul(n ^ n >>> 15, 2246822507) + 0x9e3779b9 | 0; n ^= n >>> 13; return ((n >>> 0) % 100000) / 100000; }; }

// Label textures (signs, gates, name tags): paper text on ink, mono + serif, never an image file.
function labelTexture(lines, { w = 512, h = 128, bg = '#0d1116', fg = '#ece4d0', accent = null, size = 54 } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const draw = () => { g.clearRect(0, 0, w, h); paintLabel(g, lines, { w, h, bg, fg, accent, size }); t.needsUpdate = true; };
  // Canvas text does not fetch the on-demand serif slices, so repaint once this label's glyphs have loaded.
  draw(); loadFonts(lines.map(l => l.text).join('')).then(draw); return t;
}
function paintLabel(g, lines, { w, h, bg, fg, accent, size }) {
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(236,228,208,.35)'; g.lineWidth = 3; g.strokeRect(6, 6, w - 12, h - 12);
  if (accent) { g.fillStyle = accent; g.fillRect(0, 0, 14, h); }
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((l, i) => { g.font = `${l.weight || 900} ${l.size || size}px ${l.mono ? fonts.mono : fonts.display}`; g.fillStyle = l.color || fg; g.fillText(l.text, w / 2 + (accent ? 7 : 0), h * (lines.length === 1 ? .52 : (i + .5) / lines.length + .02)); });
}

// ---------- Static world (rebuilt when the route or seed changes) ----------
const world = new THREE.Group(); scene.add(world);
let worldKey = '';
function disposeGroup(g) { g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); }); g.clear(); }

function ribbon(z0, z1, step, cols, colorAt, yAt) {
  // cols: array of x (road units). Builds a strip of quads with per-vertex colours (flat shaded).
  const pos = [], col = [], c = new THREE.Color();
  const rows = []; for (let z = z0; z <= z1; z += step) rows.push(z);
  for (let r = 0; r < rows.length - 1; r++) {
    const za = rows[r], zb = rows[r + 1];
    for (let k = 0; k < cols.length - 1; k++) {
      const xa = cols[k], xb = cols[k + 1];
      const quad = [[za, xa], [za, xb], [zb, xb], [za, xa], [zb, xb], [zb, xa]];
      colorAt(c, za, (xa + xb) / 2, k, r);
      for (const [z, x] of quad) { pos.push(wx(z, x), yAt(z, x, k), wz(z)); col.push(c.r, c.g, c.b); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function buildWorld(game) {
  disposeGroup(world);
  profile = PROFILES[game.route] || PROFILES.alpine;
  const rnd = seeded(game.seed + '|' + game.route + '|scenery');
  const Z0 = -500, Z1 = 7700;
  const mainIce = l => game.route === 'glacier' && E.mainIceAt(l);
  // Road surface: left lane | centre | right lane, coloured per row for forks, ice and patches.
  const roadGeo = ribbon(Z0, Z1, 10, [-1, -.16, .16, 1], (c, z, x, k) => {
    const at = E.road(Math.max(0, z)), l = at.local, fork = z >= 0 && at.fork, stripe = Math.floor(z / 50) % 2;
    if (z >= 0 && !fork && mainIce(l)) { c.copy(stripe ? C.ice : C.ice2); return; }
    if (fork && k === 2 && at.ice) { c.copy(stripe ? C.ice : C.ice2); return; }
    if (fork && k === 1) { c.copy(C.snowLight); return; }
    if (fork && k === 0) { c.copy(C.asphalt).lerp(C.supply, .55); return; }
    c.copy(stripe ? C.asphalt : C.asphalt2);
  }, (z, x, k) => elev(z) + (E.road(Math.max(0, z)).fork && z >= 0 && Math.abs(x) < .17 ? .02 : 0));
  world.add(new THREE.Mesh(roadGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95, metalness: 0, flatShading: true })));
  // Kerbs (rumble strips) and terrain on both sides.
  for (const side of [-1, 1]) {
    const kerb = ribbon(Z0, Z1, 10, side < 0 ? [-1.12, -1] : [1, 1.12], (c, z) => c.copy(Math.floor(z / 40) % 2 ? C.kerbA : C.kerbB), z => elev(z) + .03);
    world.add(new THREE.Mesh(kerb, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9, flatShading: true })));
    const xs = profile.xs.map(x => x * side), cols = side < 0 ? xs.slice().reverse() : xs;
    const terrain = ribbon(Z0, Z1, 20, cols, (c, z, x, k) => {
      const ax = Math.abs(x), h = sideHeight(z, ax);
      const steep = game.route === 'canyon' && ax > 1.8 && ax < 12;
      if (steep) c.copy(C.rock).lerp(C.rockDark, (Math.sin(z / 30 + ax) + 1) * .3); else c.copy(C.snow).lerp(C.snowLight, Math.min(1, h / 14 + (Math.sin(z / 60 + ax) + 1) * .08));
      if (game.route === 'glacier' && ax < 6) c.lerp(C.ice2, .25);
    }, (z, x) => { const ax = Math.abs(x), i = profile.xs.findIndex(v => Math.abs(v - ax) < 1e-6); return elev(z) + sideHeight(z, ax) + (i > 1 ? wobble(z, side, i) : 0); });
    world.add(new THREE.Mesh(terrain, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: true })));
  }
  // Lane dashes on the main road, guide lines along each fork.
  { const pos = [], add = (z, x, len, w) => { const a = z, b = z + len; const y = elev(z) + .035; const p = [[a, x - w], [a, x + w], [b, x + w], [a, x - w], [b, x + w], [b, x - w]]; for (const [zz, xx] of p) pos.push(wx(zz, xx), y + (elev(zz) - elev(z)), wz(zz)); };
    for (let z = 0; z < E.LENGTH; z += 100) { const at = E.road(z); if (!at.fork && !E.road(z + 50).fork) for (const lane of [-.33, .33]) add(z, lane, 50, .025); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    world.add(new THREE.Mesh(g, mat(palette.paper, { roughness: .7 })));
    for (const [x, color] of [[-.9, palette.jade], [.9, palette.gold]]) {
      const p2 = []; for (let s = 0; s < 3; s++) for (let z = s * 2400 + 900; z < s * 2400 + 1550; z += 20) { const y = elev(z) + .04; const q = [[z, x - .02], [z, x + .02], [z + 20, x + .02], [z, x - .02], [z + 20, x + .02], [z + 20, x - .02]]; for (const [zz, xx] of q) p2.push(wx(zz, xx), y + elev(zz) - elev(z), wz(zz)); }
      const g2 = new THREE.BufferGeometry(); g2.setAttribute('position', new THREE.Float32BufferAttribute(p2, 3)); g2.computeVertexNormals();
      world.add(new THREE.Mesh(g2, basic(color)));
    }
  }
  // Median islands in each fork: raised snow kerb with reflector posts.
  const postGeo = new THREE.BoxGeometry(.06, .5, .06), postMat = mat(palette.bone), tipMat = basic(palette.gold);
  for (let s = 0; s < 3; s++) {
    const g = ribbon(s * 2400 + 900, s * 2400 + 1550, 10, [-.15, .15], c => c.copy(C.snowLight), z => elev(z) + .14);
    world.add(new THREE.Mesh(g, mat(0xffffff, { vertexColors: true })));
    for (let z = s * 2400 + 920; z < s * 2400 + 1550; z += 60) { const p = new THREE.Mesh(postGeo, postMat); p.position.set(wx(z, 0), elev(z) + .4, wz(z)); world.add(p); const t = new THREE.Mesh(new THREE.BoxGeometry(.07, .08, .07), tipMat); t.position.set(wx(z, 0), elev(z) + .68, wz(z)); world.add(t); }
  }
  // Gates: fork sign and the three stations, plus the start line.
  const gate = (z, text, opts = {}) => {
    const grp = new THREE.Group(), y0 = elev(z), lx = wx(z, -1.18), rx = wx(z, 1.18), span = rx - lx, h = opts.h || 3.4;
    const pil = mat(palette.ink2), beam = mat(palette.ink1);
    for (const x of [lx, rx]) { const p = new THREE.Mesh(new THREE.BoxGeometry(.22, h, .22), pil); p.position.set(x, y0 + h / 2, wz(z)); grp.add(p); }
    const top = new THREE.Mesh(new THREE.BoxGeometry(span + .9, .16, .3), beam); top.position.set((lx + rx) / 2, y0 + h + .1, wz(z)); grp.add(top);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(span * .86, span * .86 / 4), new THREE.MeshBasicMaterial({ map: labelTexture(text, opts.tex || {}), toneMapped: false, fog: true }));
    sign.position.set((lx + rx) / 2, y0 + h - span * .86 / 8 - .05, wz(z) + .17); grp.add(sign);
    world.add(grp);
  };
  for (let s = 0; s < 3; s++) {
    gate(s * 2400 + 870, [{ text: '← 補給線　｜　冰面快線 →', size: 50 }], { tex: { accent: '#e9b949' } });
    gate((s + 1) * 2400, [{ text: `第${'一二三'[s]}站 · ${E.STATIONS[s]}`, size: 58 }, { text: `POST 0${s + 1} / DELIVERY`, mono: true, size: 24, weight: 600, color: '#a8a08c' }], { h: 4, tex: { accent: '#ff4b2b' } });
    // Supply depot on the left of each supply lane.
    const z = s * 2400 + 1250, y = groundY(z, -1.7), dep = new THREE.Group();
    const house = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.1, 1.4), mat(palette.ink2)); house.position.y = .55; dep.add(house);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.25, .7, 4, 1), mat(0xc9c1ae)); roof.rotation.y = Math.PI / 4; roof.position.y = 1.45; dep.add(roof);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.2, .18, .05), basic(palette.jade)); lamp.position.set(0, .82, .72); dep.add(lamp);
    dep.position.set(wx(z, -1.75), y, wz(z)); dep.rotation.y = Math.atan2(wx(z + 10, 0) - wx(z - 10, 0), -(wz(z + 10) - wz(z - 10))) * 0; world.add(dep);
  }
  { // start / finish lines
    for (const z of [0, E.LENGTH]) { const g = ribbon(z, z + 10, 10, [-1, -.5, 0, .5, 1], (c, zz, x, k) => c.set(k % 2 ? palette.paper : palette.ink2), zz => elev(zz) + .04); world.add(new THREE.Mesh(g, mat(0xffffff, { vertexColors: true }))); }
  }
  // Trees: two-tier ink pines with paper snow caps (instanced).
  { const trunkless = new THREE.ConeGeometry(.55, 1.6, 6); trunkless.translate(0, .8, 0);
    const cap = new THREE.ConeGeometry(.32, .7, 6); cap.translate(0, 1.55, 0);
    const spots = [];
    for (let z = -400; z < 7700; z += 11) for (const side of [-1, 1]) {
      if (rnd() < .5) continue;
      const ax = 1.45 + Math.pow(rnd(), 1.6) * (game.route === 'glacier' ? 18 : 12);
      if (game.route === 'canyon' && ax > 2.2 && ax < 9) continue;
      const x = side * ax, zz = z + rnd() * 8, s = .7 + rnd() * .9;
      if (ax < 1.95 && E.road(Math.max(0, zz)).local > 1180 && E.road(Math.max(0, zz)).local < 1330 && side < 0) continue; // depot clearing
      spots.push([zz, x, s, rnd() * TAU]);
    }
    const body = new THREE.InstancedMesh(trunkless, mat(0x16231f), spots.length), top = new THREE.InstancedMesh(cap, mat(0xd8d0bc), spots.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    spots.forEach(([z, x, s, r], i) => { e.set(0, r, 0); q.setFromEuler(e); m.compose(new THREE.Vector3(wx(z, x), groundY(z, x) + (Math.abs(x) > 2 ? wobble(z, Math.sign(x), 2) * .5 : 0) - .05, wz(z)), q, new THREE.Vector3(s, s * (1.1 + (r % 1) * .4), s)); body.setMatrixAt(i, m); top.setMatrixAt(i, m); });
    world.add(body, top);
  }
  // Distant mountains: ink bodies with paper caps, fading into the haze.
  { const bodyGeo = new THREE.ConeGeometry(1, 1, 7, 1), capGeo = new THREE.ConeGeometry(.36, .36, 7, 1); capGeo.translate(0, .32, 0);
    const n = 70, bodies = new THREE.InstancedMesh(bodyGeo, mat(0x1d252f), n), caps = new THREE.InstancedMesh(capGeo, mat(0xcfc7b3), n), m = new THREE.Matrix4(), q = new THREE.Quaternion();
    for (let i = 0; i < n; i++) {
      const z = -600 + i * 125 + rnd() * 80, side = i % 2 ? 1 : -1, dist = 70 + rnd() * 110, h = 30 + rnd() * 55, r = h * (.7 + rnd() * .5);
      const p = new THREE.Vector3(wx(z, 0) + side * dist, elev(z) - 4 + h / 2, wz(z) - rnd() * 40);
      q.setFromEuler(new THREE.Euler(0, rnd() * TAU, 0));
      m.compose(p, q, new THREE.Vector3(r, h, r)); bodies.setMatrixAt(i, m); caps.setMatrixAt(i, m);
    }
    world.add(bodies, caps);
  }
}

// ---------- Karts: original low-poly courier karts ----------
const wheelGeo = new THREE.CylinderGeometry(.16, .16, .12, 10); wheelGeo.rotateZ(Math.PI / 2);
const inkMat = mat(palette.ink0), jacketMat = mat(0x232b35), visorMat = mat(0x0b0e12, { roughness: .3, metalness: .3 }), crateMat = mat(palette.bone);
function nameTag(name, color) {
  const tex = labelTexture([{ text: name, mono: true, size: 44, weight: 700 }], { w: 256, h: 64, accent: color, bg: 'rgba(7,9,12,.82)' });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false })); s.scale.set(1.1, .275, 1); s.position.y = 1.55; return s;
}
function makeKart(p, id) {
  const g = new THREE.Group(), color = new THREE.Color(p.color), paint = mat(color, { roughness: .55, metalness: .15 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(.74, .2, 1.08), paint); body.position.y = .27; g.add(body);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(.56, .14, .34), paint); nose.position.set(0, .24, -.66); nose.rotation.x = .25; g.add(nose);
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(.8, .06, 1.12), inkMat); skirt.position.y = .16; g.add(skirt);
  const wheels = [];
  for (const [x, z] of [[-.42, -.36], [.42, -.36], [-.42, .38], [.42, .38]]) { const w = new THREE.Mesh(wheelGeo, inkMat); w.position.set(x, .16, z); g.add(w); wheels.push(w); }
  // Courier: round helmet in the team colour, dark jacket, scarf, parcel crate strapped behind.
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(.15, .2, .36, 8), jacketMat); torso.position.set(0, .55, .08); g.add(torso);
  const scarf = new THREE.Mesh(new THREE.CylinderGeometry(.16, .16, .06, 8), paint); scarf.position.set(0, .73, .08); g.add(scarf);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(.17, 10, 8), paint); helmet.position.set(0, .88, .08); g.add(helmet);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(.26, .08, .08), visorMat); visor.position.set(0, .88, -.07); g.add(visor);
  const crate = new THREE.Mesh(new THREE.BoxGeometry(.5, .34, .36), crateMat); crate.position.set(0, .55, .44); g.add(crate);
  const strap = new THREE.Mesh(new THREE.BoxGeometry(.52, .36, .06), paint); strap.position.set(0, .55, .44); g.add(strap);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(.6, .05, .03), basic(id === 0 ? palette.seal : 0x6d2a1f)); tail.position.set(0, .3, .56); g.add(tail);
  const shield = new THREE.Mesh(new THREE.SphereGeometry(.9, 18, 12), new THREE.MeshBasicMaterial({ color: palette.azure, transparent: true, opacity: .22, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  shield.position.y = .5; shield.visible = false; g.add(shield);
  const flame = new THREE.Group();
  for (const x of [-.18, .18]) { const f = new THREE.Mesh(new THREE.ConeGeometry(.09, .6, 6), basic(palette.gold, { transparent: true, opacity: .9 })); f.rotation.x = Math.PI / 2; f.position.set(x, .25, .9); flame.add(f); }
  flame.visible = false; g.add(flame);
  const tag = nameTag(p.name, p.color); g.add(tag);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1.3), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .35, depthWrite: false })); shadow.rotation.x = -Math.PI / 2; shadow.position.y = .02; g.add(shadow);
  scene.add(g);
  return { g, wheels, shield, flame, tag, body, heading: 0, lean: 0 };
}
const karts = E.PROFILES.map(makeKart);

// ---------- Dynamic objects ----------
const dyn = new THREE.Group(); scene.add(dyn);
const rockGeo = new THREE.DodecahedronGeometry(.42, 0), rockMat = mat(0x3a424d), capMat = mat(0xd1c9b6);
const cellGeo = new THREE.OctahedronGeometry(.24, 0), cellMat = new THREE.MeshStandardMaterial({ color: palette.gold, emissive: palette.gold, emissiveIntensity: .7, roughness: .4, flatShading: true });
const ringGeo = new THREE.RingGeometry(.45, .6, 24); ringGeo.rotateX(-Math.PI / 2);
const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.3, 'rgba(255,255,255,.4)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
const snowballGeo = new THREE.IcosahedronGeometry(.17, 1), snowballMat = mat(0xf2ede0, { roughness: .6 });
const truckCab = new THREE.BoxGeometry(.8, .7, .5), truckBox = new THREE.BoxGeometry(.86, .9, 1.2), truckCabMat = mat(0x2b3440), truckBoxMat = mat(0xb8af98);
let objMeshes = new Map(), shotMeshes = [];
function objectMesh(o) {
  const g = new THREE.Group();
  if (o.type === 'rock') { const r = new THREE.Mesh(rockGeo, rockMat); r.rotation.set(o.id, o.id * 2, 0); r.position.y = .3; g.add(r); const c = new THREE.Mesh(rockGeo, capMat); c.scale.set(.7, .35, .7); c.position.y = .62; g.add(c);
    if (o.fallAt !== undefined) { const ring = new THREE.Mesh(ringGeo, basic(palette.seal, { transparent: true, opacity: .9, depthWrite: false })); ring.position.y = .06; ring.name = 'ring'; g.add(ring); } }
  else if (o.type === 'energy') { const c = new THREE.Mesh(cellGeo, cellMat); c.position.y = .55; c.name = 'cell'; g.add(c); const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: palette.gold, transparent: true, opacity: .55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })); s.scale.set(1.3, 1.3, 1); s.position.y = .55; g.add(s); }
  else if (o.type === 'traffic') { const cab = new THREE.Mesh(truckCab, truckCabMat); cab.position.set(0, .45, -.75); g.add(cab); const box = new THREE.Mesh(truckBox, truckBoxMat); box.position.set(0, .6, .2); g.add(box); for (const x of [-.3, .3]) { const l = new THREE.Mesh(new THREE.BoxGeometry(.14, .08, .02), basic(0x9b2a18)); l.position.set(x, .35, .81); g.add(l); } for (const [x, z] of [[-.42, -.6], [.42, -.6], [-.42, .45], [.42, .45]]) { const w = new THREE.Mesh(wheelGeo, inkMat); w.position.set(x, .16, z); g.add(w); } }
  dyn.add(g); return g;
}
function syncObjects(game, me, t) {
  for (const o of game.objects) {
    let m = objMeshes.get(o.id); if (!m) { m = objectMesh(o); objMeshes.set(o.id, m); }
    const near = o.z > me.z - 60 && o.z < me.z + 2600;
    const taken = o.type === 'energy' && o.taken.includes(me.id);
    m.visible = near && !taken; if (!m.visible) continue;
    const y = elev(o.z);
    m.position.set(wx(o.z, o.x), y, wz(o.z));
    m.rotation.y = headingAt(o.z);
    if (o.type === 'energy') { const c = m.getObjectByName('cell'); c.rotation.y = t * 2 + o.id; c.position.y = .55 + Math.sin(t * 3 + o.id) * .08; }
    if (o.fallAt !== undefined) {
      const left = o.fallAt - game.elapsed, ring = m.getObjectByName('ring');
      m.children.forEach(ch => { if (ch !== ring) ch.position.y = (ch === m.children[0] ? .3 : .62) + Math.max(0, left) * 9; });
      if (ring) { ring.visible = left > -0.2; ring.scale.setScalar(1 + .25 * Math.sin(t * 14)); }
    }
  }
  let i = 0;
  for (const s of game.shots) { let m = shotMeshes[i]; if (!m) { m = new THREE.Mesh(snowballGeo, snowballMat); dyn.add(m); shotMeshes[i] = m; } m.visible = true; m.position.set(wx(s.z, s.x), elev(s.z) + .45, wz(s.z)); m.rotation.x -= .3; i++; }
  for (; i < shotMeshes.length; i++) shotMeshes[i].visible = false;
}
function resetDynamic() { disposeGroup(dyn); objMeshes = new Map(); shotMeshes = []; }
const headingAt = z => Math.atan2(-(wx(z + 6, 0) - wx(z - 6, 0)), -(wz(z + 6) - wz(z - 6)));

// ---------- Weather particles ----------
const FLAKES = 1800, flakeGeo = new THREE.BufferGeometry(), flakePos = new Float32Array(FLAKES * 3);
for (let i = 0; i < FLAKES; i++) { flakePos[i * 3] = (Math.random() - .5) * 60; flakePos[i * 3 + 1] = Math.random() * 26; flakePos[i * 3 + 2] = -Math.random() * 70 + 8; }
flakeGeo.setAttribute('position', new THREE.BufferAttribute(flakePos, 3));
const flakes = new THREE.Points(flakeGeo, new THREE.PointsMaterial({ color: 0xece4d0, size: .11, transparent: true, opacity: .85, depthWrite: false, fog: true }));
flakes.frustumCulled = false; scene.add(flakes);
const WEATHER_LOOK = { clear: { fog: [70, 340], flakes: 260, fall: 1.2, drift: .3 }, snow: { fog: [26, 170], flakes: 1800, fall: 3.2, drift: .8 }, gale: { fog: [40, 220], flakes: 1300, fall: 2.4, drift: 9 } };

// ---------- Frame ----------
const camPos = new THREE.Vector3(0, 3, 6), camLook = new THREE.Vector3();
let lastFlash = 0, lastGame = null, lastSize = '';
const flashEl = document.getElementById('tux-flash');
// Adaptive resolution: drop the pixel ratio on slow GPUs (software WebGL, old phones), restore when smooth.
const maxRatio = Math.min(window.devicePixelRatio || 1, 2);
let ratio = maxRatio, slowAvg = 1 / 60, lastScale = 0;
function adapt(dt, t) {
  if (!dt) return;
  slowAvg += (dt - slowAvg) * .1;
  if (t - lastScale < 1.2) return;
  if (slowAvg > 1 / 26 && ratio > .5) { ratio = Math.max(.5, ratio * .75); stage.renderer.setPixelRatio(ratio); lastScale = t; }
  else if (slowAvg < 1 / 52 && ratio < maxRatio) { ratio = Math.min(maxRatio, ratio * 1.2); stage.renderer.setPixelRatio(ratio); lastScale = t; }
}
stage.loop((dt, t, { reducedMotion }) => {
  const game = window.tux2dGame; if (!game) return;
  adapt(dt, t);
  if (game !== lastGame) {
    lastGame = game; G = game; resetDynamic();
    const key = game.seed + '|' + game.route;
    if (key !== worldKey) { worldKey = key; buildWorld(game); }
  }
  const settings = app.settings, look = WEATHER_LOOK[game.weather] || WEATHER_LOOK.clear;
  scene.fog.near = look.fog[0]; scene.fog.far = look.fog[1];
  const followId = app.follow || 0, me = game.racers[followId];

  // Karts
  game.racers.forEach((r, i) => {
    const k = karts[i], z = r.z, x = r.x;
    k.g.visible = !(r.finished && i !== followId && game.phase !== 'over');
    const y = elev(z) + (Math.abs(x) > 1.12 ? sideHeight(z, Math.abs(x)) : 0);
    k.g.position.set(wx(z, x), y, wz(z));
    const steer = i === followId && !game.spectator && i === 0 ? app.steer : 0;
    k.lean += ((-steer * .12) - k.lean) * Math.min(1, dt * 8);
    k.g.rotation.set(Math.atan2(elev(z + 6) - elev(z - 6), 1.2) * .9, headingAt(z) - steer * .12, k.lean, 'YXZ');
    for (const w of k.wheels) w.rotation.x -= r.speed * dt * .25;
    k.shield.visible = r.shield > 0; if (k.shield.visible) k.shield.material.opacity = .16 + .08 * Math.sin(t * 9);
    k.flame.visible = r.boost > 0; if (k.flame.visible) k.flame.scale.set(1, 1, .8 + Math.random() * .5);
    k.body.material.emissive.setHex(r.hit > 0 && Math.floor(t * 20) % 2 ? 0x552015 : 0x000000);
    k.tag.visible = i !== followId && r.z > me.z + 12 && r.z < me.z + 900;
    if (i !== followId && game.phase !== 'ready' && r.z < me.z - 26 * (stage.size.aspect < .9 ? 1.3 : 1)) k.g.visible = false;
  });

  // Objects and shots
  syncObjects(game, me, t);

  // Camera
  const mode = settings.camera || 'chase';
  const portrait = stage.size.aspect < .9 ? 1.3 : 1;
  const back = (mode === 'high' ? 70 : mode === 'low' ? 24 : 42) * portrait, up = (mode === 'high' ? 6.5 : mode === 'low' ? .75 : 1.95) * portrait, ahead = mode === 'high' ? 90 : 70;
  let tx, ty, tz, lx, ly, lz;
  if (game.phase === 'ready') {
    const a = t * .12, cz = me.z + 20;
    tx = wx(cz, 0) + Math.sin(a) * 9; ty = elev(cz) + 3.2 + Math.sin(a * .7); tz = wz(cz) + Math.cos(a) * 9;
    lx = wx(me.z + 8, 0); ly = elev(me.z) + .6; lz = wz(me.z + 8);
  } else {
    const bz = me.z - back, lx0 = me.x * .7;
    tx = wx(bz, lx0); ty = Math.max(elev(bz), elev(me.z)) + up; tz = wz(bz);
    lx = wx(me.z + ahead, me.x * .45); ly = elev(me.z + ahead) + (mode === 'high' ? -1 : .5); lz = wz(me.z + ahead);
  }
  const follow = game.phase === 'ready' ? 1 : Math.min(1, dt * 7);
  camPos.x += (tx - camPos.x) * follow; camPos.y += (ty - camPos.y) * follow; camPos.z += (tz - camPos.z) * Math.min(1, dt * 14 + (game.phase === 'ready' ? 1 : 0));
  if (Math.abs(camPos.z - tz) > 30) camPos.set(tx, ty, tz);
  camLook.set(lx, ly, lz);
  let shake = 0;
  if (settings.shake && !reducedMotion && app.shake > 0) { shake = app.shake * .18; app.shake = Math.max(0, app.shake - dt * 2.5); } else app.shake = 0;
  camera.position.set(camPos.x + (Math.random() - .5) * shake, camPos.y + (Math.random() - .5) * shake, camPos.z);
  camera.lookAt(camLook);
  const targetFov = (portrait > 1 ? 68 : 60) + (me.boost > 0 ? 9 : 0) + Math.min(6, me.speed / 20) - (mode === 'high' ? 8 : 0);
  if (Math.abs(camera.fov - targetFov) > .05) { camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 4); camera.updateProjectionMatrix(); }

  // Sky follows the camera; sun sits low ahead.
  sky.position.copy(camera.position);
  sun.position.set(camera.position.x - 160, camera.position.y + 70, camera.position.z - 520); sun.lookAt(camera.position);

  // Snow
  flakes.visible = !!settings.particles;
  if (flakes.visible) {
    flakes.geometry.setDrawRange(0, reducedMotion ? Math.min(400, look.flakes) : look.flakes);
    flakes.position.copy(camera.position); flakes.position.y -= 6;
    const p = flakePos, fall = look.fall * dt, drift = look.drift * dt * (game.weather === 'gale' ? Math.sin(game.elapsed * .5 + game.windPhase) : .3), spd = (['racing'].includes(game.phase) ? me.speed : 0) * ZS * dt;
    for (let i = 0; i < look.flakes; i++) { const j = i * 3; p[j + 1] -= fall * (.6 + (i % 7) * .1); p[j] += drift + Math.sin(t + i) * dt * .2; p[j + 2] += spd * .6;
      if (p[j + 1] < 0) p[j + 1] += 26; if (p[j + 2] > 10) p[j + 2] -= 78; if (p[j] > 30) p[j] -= 60; if (p[j] < -30) p[j] += 60; }
    flakes.geometry.attributes.position.needsUpdate = true;
  }

  // Screen flash for hits, warm rim for boost
  if (flashEl) {
    if (app.flash > 0 && settings.shake && !reducedMotion) { flashEl.className = 'tux-flash on'; app.flash = 0; lastFlash = t; }
    else if (flashEl.classList.contains('on') && t - lastFlash > .08) flashEl.className = 'tux-flash';
    else if (!flashEl.classList.contains('on')) flashEl.className = me.boost > 0 ? 'tux-flash boost on' : 'tux-flash';
    app.flash = 0;
  }
});
window.TuxView = { ready: true, scene, camera, renderer: stage.renderer, get pixelRatio() { return ratio; } };
}
