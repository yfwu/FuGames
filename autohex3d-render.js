/* AutoHex-3D renderer: dependency-free WebGL2 with instanced primitives, an
   orbit camera, ray picking and screen projection for overlay labels.
   Knows nothing about game rules; the UI describes what to draw. */
(function (root) {
  'use strict';

  // ---- small matrix helpers (column-major, like WebGL) ----
  function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far), m = new Float32Array(16);
    m[0] = f / aspect; m[5] = f; m[10] = (far + near) * nf; m[11] = -1; m[14] = 2 * far * near * nf; return m;
  }
  function lookAt(eye, center, up) {
    let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
    let len = Math.hypot(zx, zy, zz); zx /= len; zy /= len; zz /= len;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    len = Math.hypot(xx, xy, xz); xx /= len; xy /= len; xz /= len;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    const m = new Float32Array(16);
    m[0] = xx; m[1] = yx; m[2] = zx; m[4] = xy; m[5] = yy; m[6] = zy; m[8] = xz; m[9] = yz; m[10] = zz;
    m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]); m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
    m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]); m[15] = 1; return m;
  }
  function multiply(a, b) {
    const m = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; m[c * 4 + r] = s;
    }
    return m;
  }
  function invert(m) {
    const inv = new Float32Array(16);
    inv[0] = m[5]*m[10]*m[15]-m[5]*m[11]*m[14]-m[9]*m[6]*m[15]+m[9]*m[7]*m[14]+m[13]*m[6]*m[11]-m[13]*m[7]*m[10];
    inv[4] = -m[4]*m[10]*m[15]+m[4]*m[11]*m[14]+m[8]*m[6]*m[15]-m[8]*m[7]*m[14]-m[12]*m[6]*m[11]+m[12]*m[7]*m[10];
    inv[8] = m[4]*m[9]*m[15]-m[4]*m[11]*m[13]-m[8]*m[5]*m[15]+m[8]*m[7]*m[13]+m[12]*m[5]*m[11]-m[12]*m[7]*m[9];
    inv[12] = -m[4]*m[9]*m[14]+m[4]*m[10]*m[13]+m[8]*m[5]*m[14]-m[8]*m[6]*m[13]-m[12]*m[5]*m[10]+m[12]*m[6]*m[9];
    inv[1] = -m[1]*m[10]*m[15]+m[1]*m[11]*m[14]+m[9]*m[2]*m[15]-m[9]*m[3]*m[14]-m[13]*m[2]*m[11]+m[13]*m[3]*m[10];
    inv[5] = m[0]*m[10]*m[15]-m[0]*m[11]*m[14]-m[8]*m[2]*m[15]+m[8]*m[3]*m[14]+m[12]*m[2]*m[11]-m[12]*m[3]*m[10];
    inv[9] = -m[0]*m[9]*m[15]+m[0]*m[11]*m[13]+m[8]*m[1]*m[15]-m[8]*m[3]*m[13]-m[12]*m[1]*m[11]+m[12]*m[3]*m[9];
    inv[13] = m[0]*m[9]*m[14]-m[0]*m[10]*m[13]-m[8]*m[1]*m[14]+m[8]*m[2]*m[13]+m[12]*m[1]*m[10]-m[12]*m[2]*m[9];
    inv[2] = m[1]*m[6]*m[15]-m[1]*m[7]*m[14]-m[5]*m[2]*m[15]+m[5]*m[3]*m[14]+m[13]*m[2]*m[7]-m[13]*m[3]*m[6];
    inv[6] = -m[0]*m[6]*m[15]+m[0]*m[7]*m[14]+m[4]*m[2]*m[15]-m[4]*m[3]*m[14]-m[12]*m[2]*m[7]+m[12]*m[3]*m[6];
    inv[10] = m[0]*m[5]*m[15]-m[0]*m[7]*m[13]-m[4]*m[1]*m[15]+m[4]*m[3]*m[13]+m[12]*m[1]*m[7]-m[12]*m[3]*m[5];
    inv[14] = -m[0]*m[5]*m[14]+m[0]*m[6]*m[13]+m[4]*m[1]*m[14]-m[4]*m[2]*m[13]-m[12]*m[1]*m[6]+m[12]*m[2]*m[5];
    inv[3] = -m[1]*m[6]*m[11]+m[1]*m[7]*m[10]+m[5]*m[2]*m[11]-m[5]*m[3]*m[10]-m[9]*m[2]*m[7]+m[9]*m[3]*m[6];
    inv[7] = m[0]*m[6]*m[11]-m[0]*m[7]*m[10]-m[4]*m[2]*m[11]+m[4]*m[3]*m[10]+m[8]*m[2]*m[7]-m[8]*m[3]*m[6];
    inv[11] = -m[0]*m[5]*m[11]+m[0]*m[7]*m[9]+m[4]*m[1]*m[11]-m[4]*m[3]*m[9]-m[8]*m[1]*m[7]+m[8]*m[3]*m[5];
    inv[15] = m[0]*m[5]*m[10]-m[0]*m[6]*m[9]-m[4]*m[1]*m[10]+m[4]*m[2]*m[9]+m[8]*m[1]*m[6]-m[8]*m[2]*m[5];
    let det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
    if (!det) return null; det = 1 / det;
    for (let i = 0; i < 16; i++) inv[i] *= det; return inv;
  }
  function transform(m, x, y, z, w = 1) {
    return [m[0]*x+m[4]*y+m[8]*z+m[12]*w, m[1]*x+m[5]*y+m[9]*z+m[13]*w, m[2]*x+m[6]*y+m[10]*z+m[14]*w, m[3]*x+m[7]*y+m[11]*z+m[15]*w];
  }

  // ---- geometry: interleaved position(3) + normal(3), flat shaded ----
  function pushTri(out, a, b, c, n) { for (const p of [a, b, c]) out.push(p[0], p[1], p[2], n[0], n[1], n[2]); }
  function faceNormal(a, b, c) {
    const ux = b[0]-a[0], uy = b[1]-a[1], uz = b[2]-a[2], vx = c[0]-a[0], vy = c[1]-a[1], vz = c[2]-a[2];
    const nx = uy*vz-uz*vy, ny = uz*vx-ux*vz, nz = ux*vy-uy*vx, l = Math.hypot(nx, ny, nz) || 1; return [nx/l, ny/l, nz/l];
  }
  function quad(out, a, b, c, d) { const n = faceNormal(a, b, c); pushTri(out, a, b, c, n); pushTri(out, a, c, d, n); }
  // Prism of n sides, radius 1, y 0..1, optional angle offset; top cap included.
  function prism(n, offset, bevel = 0) {
    const out = [], ring = [];
    for (let k = 0; k < n; k++) { const t = offset + k * 2 * Math.PI / n; ring.push([Math.cos(t), Math.sin(t)]); }
    const top = 1, inner = 1 - bevel;
    for (let k = 0; k < n; k++) {
      const [ax, az] = ring[k], [bx, bz] = ring[(k + 1) % n];
      quad(out, [ax, 0, az], [ax, top - bevel * .6, az], [bx, top - bevel * .6, bz], [bx, 0, bz]);
      if (bevel) quad(out, [ax, top - bevel * .6, az], [ax * inner, top, az * inner], [bx * inner, top, bz * inner], [bx, top - bevel * .6, bz]);
      pushTri(out, [0, top, 0], [bx * inner, top, bz * inner], [ax * inner, top, az * inner], [0, 1, 0]);
    }
    // Fix winding of side quads: ensure outward normals.
    for (let i = 0; i < out.length; i += 18) {
      const cx = (out[i] + out[i + 6] + out[i + 12]) / 3, cz = (out[i + 2] + out[i + 8] + out[i + 14]) / 3;
      const nx = out[i + 3], nz = out[i + 5];
      if (nx * cx + nz * cz < -1e-6) for (let v = 0; v < 3; v++) { out[i + v * 6 + 3] *= -1; out[i + v * 6 + 4] *= -1; out[i + v * 6 + 5] *= -1; }
      if (out[i + 4] < -0.5) for (let v = 0; v < 3; v++) out[i + v * 6 + 4] *= -1;
    }
    return new Float32Array(out);
  }
  function cone(n) {
    const out = [];
    for (let k = 0; k < n; k++) {
      const a = k * 2 * Math.PI / n, b = (k + 1) * 2 * Math.PI / n;
      const p = [Math.cos(a), 0, Math.sin(a)], q = [Math.cos(b), 0, Math.sin(b)], top = [0, 1, 0];
      let nrm = faceNormal(p, top, q);
      if (nrm[0] * (p[0] + q[0]) + nrm[2] * (p[2] + q[2]) < 0) nrm = nrm.map(v => -v);
      pushTri(out, p, top, q, nrm);
    }
    return new Float32Array(out);
  }
  function sphere(lat, lon) {
    const out = [], pt = (i, j) => { const t = i / lat * Math.PI, f = j / lon * 2 * Math.PI; return [Math.sin(t) * Math.cos(f), Math.cos(t), Math.sin(t) * Math.sin(f)]; };
    for (let i = 0; i < lat; i++) for (let j = 0; j < lon; j++) {
      const a = pt(i, j), b = pt(i + 1, j), c = pt(i + 1, j + 1), d = pt(i, j + 1);
      const m = pt(i + .5, j + .5);
      for (const tri of [[a, b, c], [a, c, d]]) { if (i === 0 && tri[2] === d) continue; out.push(...tri[0], ...m, ...tri[1], ...m, ...tri[2], ...m); }
    }
    return new Float32Array(out);
  }
  function box() {
    const out = [], v = (x, y, z) => [x, y, z];
    const x0 = -.5, x1 = .5, z0 = -.5, z1 = .5, y0 = 0, y1 = 1;
    const faces = [
      [v(x0,y1,z0), v(x0,y1,z1), v(x1,y1,z1), v(x1,y1,z0), [0,1,0]],
      [v(x0,y0,z1), v(x1,y0,z1), v(x1,y1,z1), v(x0,y1,z1), [0,0,1]],
      [v(x1,y0,z0), v(x0,y0,z0), v(x0,y1,z0), v(x1,y1,z0), [0,0,-1]],
      [v(x1,y0,z1), v(x1,y0,z0), v(x1,y1,z0), v(x1,y1,z1), [1,0,0]],
      [v(x0,y0,z0), v(x0,y0,z1), v(x0,y1,z1), v(x0,y1,z0), [-1,0,0]]];
    for (const [a, b, c, d, n] of faces) { pushTri(out, a, b, c, n); pushTri(out, a, c, d, n); }
    return new Float32Array(out);
  }
  // Triangular prism along X (tent / roof): base on y=0 spanning z -0.5..0.5, ridge at y=1.
  function wedge() {
    const out = [];
    const a0 = [-.5, 0, -.5], b0 = [-.5, 0, .5], c0 = [-.5, 1, 0], a1 = [.5, 0, -.5], b1 = [.5, 0, .5], c1 = [.5, 1, 0];
    quad(out, a0, c0, c1, a1); quad(out, b0, b1, c1, c0);
    pushTri(out, a0, b0, c0, [-1, 0, 0]); pushTri(out, a1, c1, b1, [1, 0, 0]);
    for (let i = 0; i < out.length; i += 18) { // outward normals for the slopes
      const cz = (out[i + 2] + out[i + 8] + out[i + 14]) / 3;
      if (Math.abs(out[i + 3]) < .5 && out[i + 5] * cz < 0) for (let v = 0; v < 3; v++) { out[i + v * 6 + 4] *= -1; out[i + v * 6 + 5] *= -1; }
    }
    return new Float32Array(out);
  }
  // Flat hexagonal ring (outline) lying on y=0..1 with width w.
  function hexRing(w) {
    const out = [];
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 180 * (60 * k - 30), b = Math.PI / 180 * (60 * (k + 1) - 30);
      const o1 = [Math.cos(a), 1, Math.sin(a)], o2 = [Math.cos(b), 1, Math.sin(b)];
      const i1 = [o1[0] * (1 - w), 1, o1[2] * (1 - w)], i2 = [o2[0] * (1 - w), 1, o2[2] * (1 - w)];
      pushTri(out, o1, i1, i2, [0, 1, 0]); pushTri(out, o1, i2, o2, [0, 1, 0]);
      const n = [Math.cos((a + b) / 2), 0, Math.sin((a + b) / 2)];
      pushTri(out, [o1[0], 0, o1[2]], o1, o2, n); pushTri(out, [o1[0], 0, o1[2]], o2, [o2[0], 0, o2[2]], n);
    }
    return new Float32Array(out);
  }

  const MESHES = {
    hex: () => prism(6, -Math.PI / 6, .08),
    hexFlat: () => prism(6, -Math.PI / 6, 0),
    cyl: () => prism(14, 0, 0),
    oct: () => prism(8, Math.PI / 8, .12),
    cone: () => cone(14),
    sphere: () => sphere(8, 14),
    box: () => box(),
    wedge: () => wedge(),
    ring: () => hexRing(.16)
  };
  const STRIDE = 14; // pos3 scale3 yaw1 color4 glow1 tilt1 roll1
  const PSTRIDE = 10; // particle: pos3 size1 color4 glow1 seed1

  const VS = `#version 300 es
  layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNormal;
  layout(location=2) in vec3 iPos; layout(location=3) in vec3 iScale; layout(location=4) in float iRot;
  layout(location=5) in vec4 iColor; layout(location=6) in float iGlow; layout(location=7) in float iTilt; layout(location=8) in float iRoll;
  uniform mat4 uViewProj; uniform float uTime;
  out vec3 vNormal; out vec4 vColor; out float vGlow; out vec3 vWorld;
  void main() {
    // Roll (about local X), then tilt (about local Z: raises +X), then yaw about Y.
    float rc = cos(iRoll), rs = sin(iRoll), tc = cos(iTilt), ts = sin(iTilt), c = cos(iRot), s = sin(iRot);
    vec3 p = aPos * iScale;
    p = vec3(p.x, rc * p.y - rs * p.z, rs * p.y + rc * p.z);
    p = vec3(tc * p.x - ts * p.y, ts * p.x + tc * p.y, p.z);
    p = vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z);
    vec3 n = aNormal * sign(iScale) / max(abs(iScale), vec3(1e-4));
    n = vec3(n.x, rc * n.y - rs * n.z, rs * n.y + rc * n.z);
    n = vec3(tc * n.x - ts * n.y, ts * n.x + tc * n.y, n.z);
    n = vec3(c * n.x - s * n.z, n.y, s * n.x + c * n.z);
    vec3 w = p + iPos;
    vNormal = normalize(n); vColor = iColor; vGlow = iGlow; vWorld = w;
    gl_Position = uViewProj * vec4(w, 1.0);
  }`;
  const FS = `#version 300 es
  precision highp float;
  in vec3 vNormal; in vec4 vColor; in float vGlow; in vec3 vWorld;
  uniform float uTime; uniform vec3 uEye; uniform vec3 uSun; uniform vec3 uFog; uniform float uFogNear; uniform float uFogFar;
  out vec4 outColor;
  void main() {
    vec3 n = normalize(vNormal);
    vec3 sun = uSun;
    float diff = max(dot(n, sun), 0.0);
    float hemi = 0.5 + 0.5 * n.y;
    vec3 base = vColor.rgb;
    if (vGlow < -0.5) { // water shimmer
      float w = sin(vWorld.x * 1.7 + uTime * 1.3) * sin(vWorld.z * 1.3 - uTime * 0.9);
      base += vec3(0.05, 0.08, 0.1) * w;
    }
    vec3 col = base * (0.42 + 0.22 * hemi + 0.5 * diff);
    col *= clamp(0.72 + (vWorld.y + 0.7) * 0.4, 0.72, 1.0); // darker toward the tile skirts
    if (vGlow > 0.0) {
      float pulse = 0.55 + 0.45 * sin(uTime * 5.0 + vWorld.x * 0.7 + vWorld.z * 0.5);
      col += vColor.rgb * vGlow * pulse;
    }
    float d = distance(vWorld, uEye);
    float f = clamp((d - uFogNear) / max(uFogFar - uFogNear, 1.0), 0.0, 0.65);
    col = mix(col, uFog, f);
    outColor = vec4(col, vColor.a);
  }`;

  function compile(gl, type, source) {
    const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  class Layer {
    constructor() { this.data = {}; this.count = {}; this.dirty = true; }
    clear() { for (const k in this.count) this.count[k] = 0; this.dirty = true; }
    add(mesh, x, y, z, sx, sy, sz, rot, color, glow = 0, tilt = 0, roll = 0) {
      const transparent = color[3] < 0.999, key = mesh + (transparent ? ':t' : '');
      let arr = this.data[key], n = this.count[key] || 0;
      if (!arr || (n + 1) * STRIDE > arr.length) {
        const grown = new Float32Array(Math.max(256, (n + 1) * 2) * STRIDE);
        if (arr) grown.set(arr.subarray(0, n * STRIDE)); this.data[key] = arr = grown;
      }
      const o = n * STRIDE;
      arr[o] = x; arr[o + 1] = y; arr[o + 2] = z; arr[o + 3] = sx; arr[o + 4] = sy; arr[o + 5] = sz; arr[o + 6] = rot;
      arr[o + 7] = color[0]; arr[o + 8] = color[1]; arr[o + 9] = color[2]; arr[o + 10] = color[3]; arr[o + 11] = glow; arr[o + 12] = tilt; arr[o + 13] = roll;
      this.count[key] = n + 1; this.dirty = true;
    }
    // A horizontal-ish beam from (ax,ay,az) to (bx,by,bz) using a box.
    beam(ax, ay, az, bx, by, bz, width, height, color, glow = 0) {
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
      if (len < 1e-4) return;
      this.add('box', (ax + bx) / 2, Math.min(ay, by), (az + bz) / 2, len, height + Math.abs(by - ay), width, Math.atan2(dz, dx), color, glow);
    }
    // A straight rod between two 3D points (slopes, barrels, ramps, trails).
    rod(ax, ay, az, bx, by, bz, width, height, color, glow = 0) {
      const dx = bx - ax, dy = by - ay, dz = bz - az, flat = Math.hypot(dx, dz), len = Math.hypot(flat, dy);
      if (len < 1e-4) return;
      const tilt = Math.atan2(dy, flat);
      this.add('box', (ax + bx) / 2 + Math.sin(tilt) * height / 2 * dx / (flat || 1), (ay + by) / 2 - Math.cos(tilt) * height / 2, (az + bz) / 2 + Math.sin(tilt) * height / 2 * dz / (flat || 1), len, height, width, Math.atan2(dz, dx), color, glow, tilt);
    }
  }

  // Soft camera-facing particles: smoke / dust use alpha blending, fire / sparks add light.
  class ParticleLayer {
    constructor() { this.data = { normal: new Float32Array(2048 * PSTRIDE), additive: new Float32Array(1024 * PSTRIDE) }; this.count = { normal: 0, additive: 0 }; }
    clear() { this.count.normal = this.count.additive = 0; }
    add(x, y, z, size, color, glow = 0, seed = 0) {
      const key = glow > 0 ? 'additive' : 'normal';
      let arr = this.data[key], n = this.count[key];
      if ((n + 1) * PSTRIDE > arr.length) { const grown = new Float32Array(arr.length * 2); grown.set(arr); this.data[key] = arr = grown; }
      const o = n * PSTRIDE;
      arr[o] = x; arr[o + 1] = y; arr[o + 2] = z; arr[o + 3] = size;
      arr[o + 4] = color[0]; arr[o + 5] = color[1]; arr[o + 6] = color[2]; arr[o + 7] = color[3]; arr[o + 8] = glow; arr[o + 9] = seed;
      this.count[key] = n + 1;
    }
  }
  const PVS = `#version 300 es
  layout(location=0) in vec2 aCorner;
  layout(location=1) in vec3 iPos; layout(location=2) in float iSize; layout(location=3) in vec4 iColor; layout(location=4) in float iGlow; layout(location=5) in float iSeed;
  uniform mat4 uViewProj; uniform vec3 uRight; uniform vec3 uUp;
  out vec2 vUv; out vec4 vColor; out float vGlow; out float vSeed; out vec3 vWorld;
  void main() {
    float a = iSeed * 6.2831; vec2 r = vec2(cos(a) * aCorner.x - sin(a) * aCorner.y, sin(a) * aCorner.x + cos(a) * aCorner.y);
    vec3 w = iPos + (uRight * aCorner.x + uUp * aCorner.y) * iSize;
    vUv = r; vColor = iColor; vGlow = iGlow; vSeed = iSeed; vWorld = w;
    gl_Position = uViewProj * vec4(w, 1.0);
  }`;
  const PFS = `#version 300 es
  precision highp float;
  in vec2 vUv; in vec4 vColor; in float vGlow; in float vSeed; in vec3 vWorld;
  uniform vec3 uEye; uniform vec3 uFog; uniform float uFogNear; uniform float uFogFar;
  out vec4 outColor;
  void main() {
    float d = length(vUv);
    if (d > 1.0) discard;
    // Billowy edge: a few lobes break up the disc so puffs read as smoke, not balls.
    float ang = atan(vUv.y, vUv.x);
    float lobes = 0.82 + 0.1 * sin(ang * 5.0 + vSeed * 40.0) + 0.08 * sin(ang * 9.0 - vSeed * 23.0);
    float edge = smoothstep(lobes, lobes * 0.35, d);
    float grain = 0.85 + 0.15 * sin(vUv.x * 9.0 + vSeed * 31.0) * sin(vUv.y * 8.0 - vSeed * 17.0);
    float alpha = vColor.a * edge * grain;
    float f = clamp((distance(vWorld, uEye) - uFogNear) / max(uFogFar - uFogNear, 1.0), 0.0, 0.6);
    if (vGlow > 0.0) {
      vec3 hot = mix(vColor.rgb, vec3(1.0, 0.97, 0.85), smoothstep(0.6, 0.0, d) * 0.6);
      outColor = vec4(hot * min(vGlow, 1.2) * alpha * 0.55 * (1.0 - f), 1.0);
    } else {
      vec3 shade = vColor.rgb * (0.82 + 0.3 * clamp(vUv.y * 0.5 + 0.5, 0.0, 1.0));
      outColor = vec4(mix(shade, uFog, f), alpha);
    }
  }`;

  function create(canvas, options = {}) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer: !!options.preserve, powerPreference: 'high-performance' });
    if (!gl) return null;
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    const U = name => gl.getUniformLocation(program, name);
    const uni = { viewProj: U('uViewProj'), time: U('uTime'), eye: U('uEye'), sun: U('uSun'), fog: U('uFog'), fogNear: U('uFogNear'), fogFar: U('uFogFar') };
    // Particle program and its quad.
    const pprogram = gl.createProgram();
    gl.attachShader(pprogram, compile(gl, gl.VERTEX_SHADER, PVS));
    gl.attachShader(pprogram, compile(gl, gl.FRAGMENT_SHADER, PFS));
    gl.linkProgram(pprogram);
    if (!gl.getProgramParameter(pprogram, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pprogram));
    const PU = name => gl.getUniformLocation(pprogram, name);
    const puni = { viewProj: PU('uViewProj'), right: PU('uRight'), up: PU('uUp'), eye: PU('uEye'), fog: PU('uFog'), fogNear: PU('uFogNear'), fogFar: PU('uFogFar') };
    const pvao = gl.createVertexArray(), pquad = gl.createBuffer(), pbuffers = { normal: gl.createBuffer(), additive: gl.createBuffer() };
    gl.bindVertexArray(pvao);
    gl.bindBuffer(gl.ARRAY_BUFFER, pquad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    for (const loc of [1, 2, 3, 4, 5]) { gl.enableVertexAttribArray(loc); gl.vertexAttribDivisor(loc, 1); }
    gl.bindVertexArray(null);
    const meshes = {};
    for (const [name, build] of Object.entries(MESHES)) {
      const vertices = build(), vao = gl.createVertexArray(), vbo = gl.createBuffer(), ibo = gl.createBuffer();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
      gl.bindBuffer(gl.ARRAY_BUFFER, ibo);
      const attrs = [[2, 3, 0], [3, 3, 12], [4, 1, 24], [5, 4, 28], [6, 1, 44], [7, 1, 48], [8, 1, 52]];
      for (const [loc, size, offset] of attrs) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE * 4, offset); gl.vertexAttribDivisor(loc, 1); }
      gl.bindVertexArray(null);
      meshes[name] = { vao, ibo, vertices: vertices.length / 6 };
    }
    // Each layer owns its instance buffers per mesh key.
    const buffers = new Map();
    function bufferFor(layer, key) {
      let map = buffers.get(layer); if (!map) buffers.set(layer, map = {});
      if (!map[key]) map[key] = { buffer: gl.createBuffer(), size: 0 };
      return map[key];
    }
    const camera = { tx: 0, tz: 0, yaw: 0, pitch: 0.95, dist: 60, minDist: 6, maxDist: 110, fov: 0.75, shake: 0 };
    let right = [1, 0, 0], up = [0, 1, 0];
    let viewProj = null, inverse = null, eye = [0, 0, 0], width = 1, height = 1, dpr = 1;
    const background = options.background || [0.93, 0.95, 0.97];
    function resize() {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(options.maxDpr || 2, window.devicePixelRatio || 1);
      width = Math.max(1, rect.width); height = Math.max(1, rect.height);
      const w = Math.round(width * dpr), h = Math.round(height * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    }
    function updateCamera() {
      camera.pitch = Math.max(0.35, Math.min(1.5, camera.pitch));
      camera.dist = Math.max(camera.minDist, Math.min(camera.maxDist, camera.dist));
      const bound = options.bound || 40, r = Math.hypot(camera.tx, camera.tz);
      if (r > bound) { camera.tx *= bound / r; camera.tz *= bound / r; }
      const cp = Math.cos(camera.pitch), t = performance.now() / 1000, k = camera.shake || 0;
      const jx = k * Math.sin(t * 61) * .5, jy = k * Math.sin(t * 47 + 1) * .35, jz = k * Math.sin(t * 53 + 2) * .5;
      eye = [camera.tx + jx + camera.dist * cp * Math.sin(camera.yaw), jy + camera.dist * Math.sin(camera.pitch), camera.tz + jz + camera.dist * cp * Math.cos(camera.yaw)];
      const proj = perspective(camera.fov, width / height, 0.5, 400), view = lookAt(eye, [camera.tx + jx, jy, camera.tz + jz], [0, 1, 0]);
      viewProj = multiply(proj, view);
      right = [view[0], view[4], view[8]]; up = [view[1], view[5], view[9]];
      inverse = invert(viewProj);
    }
    function draw(layers, time, particles) {
      resize(); updateCamera();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(background[0], background[1], background[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
      gl.useProgram(program);
      gl.uniformMatrix4fv(uni.viewProj, false, viewProj);
      gl.uniform1f(uni.time, time / 1000);
      gl.uniform3fv(uni.eye, eye); gl.uniform3fv(uni.fog, background);
      // Light from the viewer's upper left so relief always reads as raised.
      const sy = Math.sin(camera.yaw), cy = Math.cos(camera.yaw);
      const sun = [-0.5 * cy - 0.35 * sy, 0.82, 0.5 * sy - 0.35 * cy], sl = Math.hypot(...sun);
      gl.uniform3f(uni.sun, sun[0] / sl, sun[1] / sl, sun[2] / sl);
      gl.uniform1f(uni.fogNear, camera.dist * 0.9); gl.uniform1f(uni.fogFar, camera.dist * 2.6);
      for (const layer of layers) if (layer.dirty) { layer.version = (layer.version || 0) + 1; layer.dirty = false; }
      for (const pass of ['opaque', 'transparent']) {
        if (pass === 'transparent') { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); }
        for (const layer of layers) for (const key of Object.keys(layer.count)) {
          const n = layer.count[key]; if (!n) continue;
          const transparent = key.endsWith(':t'); if ((pass === 'transparent') !== transparent) continue;
          const mesh = meshes[key.split(':')[0]], buf = bufferFor(layer, key);
          gl.bindVertexArray(mesh.vao);
          gl.bindBuffer(gl.ARRAY_BUFFER, buf.buffer);
          const bytes = n * STRIDE * 4;
          if (buf.stale !== layer.version) {
            if (buf.size < bytes) { gl.bufferData(gl.ARRAY_BUFFER, layer.data[key].byteLength, gl.DYNAMIC_DRAW); buf.size = layer.data[key].byteLength; }
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, layer.data[key], 0, n * STRIDE);
            buf.stale = layer.version;
          }
          // Re-point instance attributes at this buffer (VAO captured ibo at creation).
          const attrs = [[2, 3, 0], [3, 3, 12], [4, 1, 24], [5, 4, 28], [6, 1, 44], [7, 1, 48], [8, 1, 52]];
          for (const [loc, size, offset] of attrs) gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE * 4, offset);
          gl.drawArraysInstanced(gl.TRIANGLES, 0, mesh.vertices, n);
        }
        if (pass === 'transparent') { gl.disable(gl.BLEND); gl.depthMask(true); }
      }
      if (particles && (particles.count.normal || particles.count.additive)) {
        gl.useProgram(pprogram);
        gl.uniformMatrix4fv(puni.viewProj, false, viewProj);
        gl.uniform3fv(puni.right, right); gl.uniform3fv(puni.up, up); gl.uniform3fv(puni.eye, eye); gl.uniform3fv(puni.fog, background);
        gl.uniform1f(puni.fogNear, camera.dist * 0.9); gl.uniform1f(puni.fogFar, camera.dist * 2.6);
        gl.bindVertexArray(pvao); gl.enable(gl.BLEND); gl.depthMask(false);
        for (const key of ['normal', 'additive']) {
          const n = particles.count[key]; if (!n) continue;
          if (key === 'normal') gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); else gl.blendFunc(gl.ONE, gl.ONE);
          gl.bindBuffer(gl.ARRAY_BUFFER, pbuffers[key]);
          gl.bufferData(gl.ARRAY_BUFFER, particles.data[key].subarray(0, n * PSTRIDE), gl.STREAM_DRAW);
          const at = [[1, 3, 0], [2, 1, 12], [3, 4, 16], [4, 1, 32], [5, 1, 36]];
          for (const [loc, size, offset] of at) gl.vertexAttribPointer(loc, size, gl.FLOAT, false, PSTRIDE * 4, offset);
          gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
        }
        gl.disable(gl.BLEND); gl.depthMask(true);
      }
      gl.bindVertexArray(null);
    }
    // Screen (CSS px relative to canvas) -> intersection with plane y = level.
    function ray(x, y, level = 0.3) {
      if (!inverse) updateCamera();
      const nx = x / width * 2 - 1, ny = 1 - y / height * 2;
      const a = transform(inverse, nx, ny, -1), b = transform(inverse, nx, ny, 1);
      const p0 = [a[0] / a[3], a[1] / a[3], a[2] / a[3]], p1 = [b[0] / b[3], b[1] / b[3], b[2] / b[3]];
      const dy = p1[1] - p0[1]; if (Math.abs(dy) < 1e-6) return null;
      const t = (level - p0[1]) / dy; if (t < 0) return null;
      return { x: p0[0] + (p1[0] - p0[0]) * t, z: p0[2] + (p1[2] - p0[2]) * t };
    }
    function project(x, y, z) {
      if (!viewProj) updateCamera();
      const c = transform(viewProj, x, y, z);
      if (c[3] <= 0.01) return null;
      return { x: (c[0] / c[3] * .5 + .5) * width, y: (1 - (c[1] / c[3] * .5 + .5)) * height, depth: c[3] };
    }
    function pan(dx, dy) {
      // Screen drag in CSS px: the ground point under the pointer follows it.
      const scale = camera.dist * Math.tan(camera.fov / 2) * 2 / height;
      const along = scale / Math.max(.35, Math.sin(camera.pitch));
      const s = Math.sin(camera.yaw), c = Math.cos(camera.yaw);
      camera.tx += -dx * scale * c - dy * along * s;
      camera.tz += dx * scale * s - dy * along * c;
    }
    return { gl, camera, Layer, draw, ray, project, pan, resize, update: () => { resize(); updateCamera(); }, get size() { return { width, height, dpr }; }, get eye() { return eye; } };
  }

  root.AutoHex3DRender = Object.freeze({ create, Layer, ParticleLayer, perspective, lookAt, multiply, invert });
})(typeof window !== 'undefined' ? window : globalThis);
