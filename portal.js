/* FuGames 入口網站：遊戲索引互動 + 背景 three.js 六角地景。
   選到哪款遊戲，地景就「變形」成那款遊戲的母題（地形、立方、蛇、牌、籌碼、脈衝、圈地）。 */
import { THREE, createStage, inkMaterial, palette } from './shared/fu-three.js';

const games = JSON.parse(document.getElementById('portalGames').textContent);
const cards = [...document.querySelectorAll('#gameList .game-card')];
const ids = cards.map(c => c.querySelector('a').dataset.game);
const $ = id => document.getElementById(id);
const detail = $('portalDetail');
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const narrow = window.matchMedia('(max-width: 900px)');

// ------------------------------------------------------------------ 索引互動
let active = 0;
let userTouched = false;
function select(i, { focus = false, auto = false } = {}) {
  i = (i + ids.length) % ids.length;
  if (!auto) userTouched = true;
  if (i === active && cards[i].classList.contains('is-active')) { if (focus) cards[i].querySelector('a').focus(); return; }
  active = i;
  cards.forEach((c, k) => c.classList.toggle('is-active', k === i));
  const id = ids[i], g = games[id];
  document.body.style.setProperty('--accent', `var(--fu-${g.accent})`);
  $('portalNumeral').textContent = String(i + 1).padStart(2, '0');
  $('detailNo').textContent = String(i + 1).padStart(2, '0');
  $('detailKind').textContent = g.kind;
  $('detailName').textContent = g.name;
  $('detailEn').textContent = g.en;
  $('detailBlurb').textContent = g.blurb;
  const tags = $('detailTags');
  tags.replaceChildren(...g.tags.map(t => Object.assign(document.createElement('span'), { className: 'fu-chip', textContent: t })));
  const play = $('detailPlay');
  play.href = id + '.html';
  play.setAttribute('aria-label', '開始遊玩 ' + g.name);
  detail.classList.remove('is-swapping'); void detail.offsetWidth; detail.classList.add('is-swapping');
  scene && scene.setMotif(id);
  if (focus) cards[i].querySelector('a').focus();
}

cards.forEach((card, i) => {
  const link = card.querySelector('a');
  card.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') select(i); });
  link.addEventListener('focus', () => select(i));
  link.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); select(i + 1, { focus: true }); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); select(i - 1, { focus: true }); }
    else if (e.key === 'Home') { e.preventDefault(); select(0, { focus: true }); }
    else if (e.key === 'End') { e.preventDefault(); select(ids.length - 1, { focus: true }); }
  });
});
document.addEventListener('keydown', e => {
  if (e.defaultPrevented || e.target.closest('a, button, input, select, textarea')) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); select(active + (e.key === 'ArrowDown' ? 1 : -1), { focus: true }); }
  else if (e.key === 'Enter') { location.href = ids[active] + '.html'; }
});
// 無人操作時每 7 秒輪播一款（桌面、未要求減少動態）
setInterval(() => { if (!userTouched && !narrow.matches && !reduced.matches && !document.hidden) select(active + 1, { auto: true }); }, 7000);

// ------------------------------------------------------------------ 3D 地景
const R = 21;
const SQ3 = Math.sqrt(3);
const hash = (q, r) => { let h = (Math.imul(q, 374761393) + Math.imul(r, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
const C = {};
const col = (key, dim = 0) => {
  const k = key + '|' + dim;
  if (!C[k]) C[k] = palette.color(key).clone().lerp(palette.color('ink1'), dim);
  return C[k];
};
const BASE = [col('ink2'), col('ink3'), col('ink2', .3)];
const SIDES = ['seal', 'azure', 'jade', 'gold', 'orchid', 'bone'];

// 每款遊戲的母題：回傳 [高度, 顏色]
const MOTIFS = {
  idle(c, t) {
    const h = .22 + .2 * Math.sin(c.x * .22 + t * .5) * Math.cos(c.z * .2 - t * .35);
    return [h, BASE[c.k % 3]];
  },
  autohex_3d(c, t) {
    const n = Math.sin(c.x * .21 + 1.3) * Math.cos(c.z * .18) + .55 * Math.sin(c.x * .47 - c.z * .39 + 2) + .3 * Math.sin(c.z * .9 + c.x * .2);
    const river = Math.abs(c.z - 5 * Math.sin(c.x * .16) - 2) < 1.1 && c.d < 17;
    if (river) return [.08, col('azure', .35)];
    const sector = Math.floor((c.a + Math.PI) / (Math.PI / 3)) % 6;
    let h = .3 + Math.max(0, n) * 1.5;
    if (n > 1.05) return [h + .6, col('bone', .15)];
    if (c.d >= 15) return [h * .7 + .2 + (c.h < .3 ? .25 * (1 + Math.sin(t * 2 + c.k)) : 0), col(SIDES[sector], c.h < .3 ? .1 : .62)];
    return [h, c.h < .025 ? col('seal', .1) : BASE[c.k % 3]];
  },
  cyclic_tictactoe_3d(c, t) {
    const gx = Math.round(c.x / 6.9), gz = Math.round(c.z / 6);
    if (Math.abs(gx) <= 1 && Math.abs(gz) <= 1) {
      const dx = c.x - gx * 6.9, dz = c.z - gz * 6;
      if (dx * dx + dz * dz < 4.2) {
        const cell = (gx + 1) * 3 + (gz + 1), who = [1, 0, 2, 0, 1, 2, 2, 1, 0][cell];
        const lift = 1.3 + ((cell * 7) % 3) * 1.15 + .15 * Math.sin(t * 1.4 + cell);
        return who === 1 ? [lift, col('seal')] : who === 2 ? [lift, col('orchid')] : [.5, col('ink3')];
      }
    }
    const line = (Math.abs(c.x % 6.9) < .9 || Math.abs(c.z % 6) < .8) && c.d < 13;
    return [line ? .32 : .12, line ? col('bone', .75) : BASE[c.k % 3]];
  },
  effect_snake(c, t) {
    const path = 5.5 * Math.sin(c.x * .23 + t * .9) + 2 * Math.sin(c.x * .07 - t * .3);
    const head = 9 + 3 * Math.sin(t * .4);
    if (Math.abs(c.z - path) < 1.25 && c.x > -20 && c.x < head) {
      const isHead = c.x > head - 2.2;
      return [isHead ? 1.9 : 1 + .25 * Math.sin(c.x * .8 - t * 6), isHead ? col('seal') : col('jade', (head - c.x) / 60)];
    }
    if (c.h < .035) return [.75 + .2 * Math.sin(t * 3 + c.k), col('gold')];
    const rival = Math.abs(c.x - (-4 * Math.cos(c.z * .3 + t * .7) - 6)) < 1.1 && c.z > -14 && c.z < -3;
    if (rival) return [.8, col('azure', .2)];
    return [.16, BASE[c.k % 3]];
  },
  duplicate_bridge(c, t) {
    if (c.d <= 2) return [.55 + .1 * Math.sin(t * 2), col('azure', c.d ? .4 : 0)];
    if (c.d >= 6 && c.d <= 12) {
      const q = ((c.a + Math.PI * 1.25) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      const seat = Math.floor(q / (Math.PI / 2));
      const f = (q % (Math.PI / 2)) / (Math.PI / 2);
      if (f > .12 && f < .88) {
        const step = Math.floor(f * 13) / 13;
        const red = seat % 2 === 0;
        return [.35 + step * 1.6 + (c.d === 9 ? .25 : 0), red ? col('seal', c.d % 2 ? .2 : 0) : col('bone', c.d % 2 ? .35 : .1)];
      }
    }
    return [.12, BASE[c.k % 3]];
  },
  blackjack(c, t) {
    const stacks = [[-6, -3, 21], [-1, -6, 17], [5, -2, 10], [0, 4, 11], [7, 6, 19], [-8, 6, 8]];
    for (const [x, z, n] of stacks) {
      const dx = c.x - x, dz = c.z - z;
      if (dx * dx + dz * dz < 2.4) {
        const h = n * .12 * (1 + .05 * Math.sin(t * 2 + x));
        return [h, n === 21 ? col('seal') : n > 15 ? col('gold') : col('bone', .2)];
      }
    }
    const felt = c.d < 13;
    return [felt ? .18 : .1, felt ? col('jade', .78 + .06 * (c.k % 2)) : BASE[c.k % 3]];
  },
  pulse_arena(c, t) {
    if (c.d === 0) return [2.6 + .3 * Math.sin(t * 3), col('gold')];
    const edge = 17 - 4 * ((t * .08) % 1);
    if (c.d > edge) return [.06, col('seal', .82)];
    const w = Math.sin(c.d * .85 - t * 3.2);
    const p = Math.max(0, w) ** 4;
    return [.18 + p * 1.5, p > .55 ? col(c.d % 2 ? 'azure' : 'seal', .1) : BASE[c.k % 3]];
  },
  territory_loop(c, t) {
    const seeds = [0, 1, 2, 3].map(i => [Math.cos(i * 1.57 + t * .08) * 9, Math.sin(i * 1.57 + t * .08) * 9]);
    let best = 1e9, second = 1e9, who = 0;
    seeds.forEach(([x, z], i) => { const d = (c.x - x) ** 2 + (c.z - z) ** 2; if (d < best) { second = best; best = d; who = i; } else if (d < second) second = d; });
    const border = Math.sqrt(second) - Math.sqrt(best) < 1.4;
    const tone = ['seal', 'azure', 'jade', 'gold'][who];
    if (c.d > 16) return [.1, BASE[c.k % 3]];
    return border ? [.95, col(tone)] : [.22, col(tone, .8)];
  }
};

let scene = null;
try {
  const canvas = $('portalStage');
  const stage = createStage(canvas, { fov: 34, fog: [38, 92], exposure: 1.1 });
  const cells = [];
  for (let q = -R; q <= R; q++) for (let r = Math.max(-R, -q - R); r <= Math.min(R, -q + R); r++) {
    const x = SQ3 * (q + r / 2), z = 1.5 * r;
    cells.push({ q, r, x, z, d: Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r)), a: Math.atan2(z, x), h: hash(q, r), k: (q * 5 + r * 3 + 300) % 7, cur: .2, color: BASE[0].clone() });
  }
  const geo = new THREE.CylinderGeometry(1, 1, 1, 6);
  geo.translate(0, .5, 0);
  const mesh = new THREE.InstancedMesh(geo, inkMaterial(0xffffff, { roughness: .7 }), cells.length);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  stage.scene.add(mesh);

  // 地平線上的朱色細線：舞台的「地平」
  const ring = new THREE.Mesh(new THREE.RingGeometry(SQ3 * R + 1.2, SQ3 * R + 1.35, 6, 1), new THREE.MeshBasicMaterial({ color: palette.seal, transparent: true, opacity: .55, side: THREE.DoubleSide, toneMapped: false }));
  ring.rotation.x = -Math.PI / 2; ring.rotation.z = Math.PI / 6; ring.position.y = .02;
  stage.scene.add(ring);

  const m4 = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
  let motif = 'idle';
  let elapsed = 0;
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  addEventListener('pointermove', e => { pointer.tx = e.clientX / innerWidth - .5; pointer.ty = e.clientY / innerHeight - .5; }, { passive: true });

  const group = new THREE.Group();
  stage.scene.remove(mesh, ring); group.add(mesh, ring); stage.scene.add(group);

  const frame = (dt, t, opts) => {
    const still = opts.reducedMotion;
    if (!still) elapsed += dt;
    const tm = elapsed;
    const fn = MOTIFS[motif] || MOTIFS.idle;
    const k = still ? 1 : 1 - Math.exp(-dt * 4.5);
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const [h, colr] = fn(c, tm);
      c.cur += (h - c.cur) * k;
      c.color.lerp(colr, k);
      pos.set(c.x, 0, c.z); scl.set(.93, Math.max(.04, c.cur), .93);
      m4.compose(pos, quat, scl);
      mesh.setMatrixAt(i, m4);
      mesh.setColorAt(i, c.color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;

    // 相機：桌面版地景偏右，手機版置中；滑鼠微視差
    pointer.x += (pointer.tx - pointer.x) * .05; pointer.y += (pointer.ty - pointer.y) * .05;
    const wide = !narrow.matches;
    group.position.x = wide ? Math.min(16, stage.size.aspect * 7) : 0;
    group.rotation.y = still ? .35 : .35 + tm * .025;
    stage.camera.position.set(pointer.x * 6 + (wide ? 4 : 0), 30 - pointer.y * 4, 44);
    stage.camera.lookAt(wide ? 6 : 0, 0, wide ? 2 : -4);
  };
  stage.loop(frame);
  scene = { setMotif: id => { motif = MOTIFS[id] ? id : 'idle'; } };
} catch (err) {
  // 沒有 WebGL 時保留純文字索引
  document.body.classList.add('no-webgl');
}

select(0, { auto: true });
