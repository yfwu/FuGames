/* FuGames「朱墨」three.js 舞台輔助（ES module）。
   import { THREE, createStage, palette } from './shared/fu-three.js';
   統一：墨色背景與霧、ACES 色調映射、米紙主光 + 朱色輪廓光、尺寸追蹤、
   分頁隱藏時暫停、減少動態偏好。three.js 為本地 vendor/three（r170），離線可玩。 */
import * as THREE from '../vendor/three/three.module.min.js';

export { THREE };

const HEX = {
  ink0: 0x07090c, ink1: 0x0d1116, ink2: 0x151b23, ink3: 0x212a35,
  paper: 0xece4d0, paperDim: 0xa8a08c, mute: 0x6d7380,
  seal: 0xff4b2b, sealDeep: 0xb92d17, jade: 0x35d0a8, gold: 0xe9b949,
  azure: 0x4fa3ff, orchid: 0xb98cff, bone: 0xd9d2c0
};
export const palette = Object.freeze({
  ...HEX,
  sides: Object.freeze([HEX.seal, HEX.azure, HEX.jade, HEX.gold, HEX.orchid, HEX.bone]),
  color: key => new THREE.Color(HEX[key] ?? key)
});

/**
 * 建立滿版 three.js 舞台。
 * @param {HTMLCanvasElement} canvas  通常是 .fu-stage 內的 <canvas>
 * @param {object} [opts]
 *   fov=40, near=.1, far=400, fog=[near, far] 或 false,
 *   background=palette.ink0, exposure=1.05, maxPixelRatio=2,
 *   lights=true（加入朱墨標準燈組）, shadows=false
 * @returns {{THREE, renderer, scene, camera, lights, size, loop, stop, render, dispose}}
 */
export function createStage(canvas, opts = {}) {
  const o = Object.assign({ fov: 40, near: 0.1, far: 400, fog: [30, 160], background: HEX.ink0, exposure: 1.05, maxPixelRatio: 2, lights: true, shadows: false, antialias: true }, opts);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: o.antialias, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, o.maxPixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = o.exposure;
  if (o.shadows) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(o.background);
  if (o.fog) scene.fog = new THREE.Fog(o.background, o.fog[0], o.fog[1]);

  const camera = new THREE.PerspectiveCamera(o.fov, 1, o.near, o.far);
  camera.position.set(0, 18, 30);
  camera.lookAt(0, 0, 0);

  const lights = {};
  if (o.lights) {
    // 天光：上方米紙、下方墨
    lights.hemi = new THREE.HemisphereLight(HEX.paper, HEX.ink0, 1.1);
    // 主光：偏暖的斜側光，製造長陰影與刻痕感
    lights.key = new THREE.DirectionalLight(0xfff1dc, 2.4);
    lights.key.position.set(-18, 30, 14);
    if (o.shadows) {
      lights.key.castShadow = true;
      lights.key.shadow.mapSize.set(2048, 2048);
      const s = lights.key.shadow.camera; s.left = -40; s.right = 40; s.top = 40; s.bottom = -40; s.far = 120;
    }
    // 朱色輪廓光：從背後勾出邊緣，是朱墨 3D 的辨識點
    lights.rim = new THREE.DirectionalLight(HEX.seal, 1.4);
    lights.rim.position.set(16, 8, -24);
    scene.add(lights.hemi, lights.key, lights.rim);
  }

  const size = { width: 1, height: 1, aspect: 1 };
  const resize = () => {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    if (w === size.width && h === size.height) return;
    size.width = w; size.height = h; size.aspect = w / Math.max(1, h);
    renderer.setSize(w, h, false);
    camera.aspect = size.aspect;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(canvas); else window.addEventListener('resize', resize);

  let raf = 0, last = 0, tick = null, running = false;
  const reduced = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const frame = now => {
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    if (tick) tick(dt, now / 1000, { reducedMotion: reduced.matches });
    renderer.render(scene, camera);
  };
  const onVisibility = () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
    else if (running && !raf) { last = 0; raf = requestAnimationFrame(frame); }
  };
  document.addEventListener('visibilitychange', onVisibility);

  return {
    THREE, renderer, scene, camera, lights, size,
    /** 每幀呼叫 fn(dt 秒, t 秒, {reducedMotion}) 後自動 render。 */
    loop(fn) { tick = fn; running = true; if (!raf) { last = 0; raf = requestAnimationFrame(frame); } },
    stop() { running = false; cancelAnimationFrame(raf); raf = 0; },
    render() { resize(); renderer.render(scene, camera); },
    resize,
    dispose() {
      this.stop();
      document.removeEventListener('visibilitychange', onVisibility);
      if (ro) ro.disconnect(); else window.removeEventListener('resize', resize);
      renderer.dispose();
    }
  };
}

/** 朱墨標準材質：霧面、低金屬感。tone 可給 palette key 或 0xRRGGBB。 */
export function inkMaterial(tone = 'ink2', extra = {}) {
  return new THREE.MeshStandardMaterial(Object.assign({ color: palette.color(tone), roughness: 0.82, metalness: 0.08, flatShading: true }, extra));
}

/** 發光描邊（用於選取、陣營邊界）。 */
export function glowMaterial(tone = 'seal', opacity = 0.9) {
  return new THREE.MeshBasicMaterial({ color: palette.color(tone), transparent: true, opacity, depthWrite: false, toneMapped: false });
}
