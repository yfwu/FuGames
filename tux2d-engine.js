/* Original Tux 2D racing rules. Fixed-step, seeded, DOM-free and shared physics. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Tux2D = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const DT = 1 / 60, LAPS = 3, TAU = Math.PI * 2, RADIUS = 11;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const wrap = a => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  const mod = (v, n) => (v % n + n) % n;
  const CONTROL = [[300, 700], [570, 750], [940, 730], [1100, 610], [1110, 415], [995, 230], [810, 165], [620, 245], [410, 165], [230, 245], [160, 445], [180, 610]];
  const samples = [];
  for (let segment = 0; segment < CONTROL.length; segment++) for (let k = 0; k < 24; k++) {
    const t = k / 24, p = [-1, 0, 1, 2].map(d => CONTROL[mod(segment + d, CONTROL.length)]);
    const axis = n => .5 * ((2 * p[1][n]) + (-p[0][n] + p[2][n]) * t + (2 * p[0][n] - 5 * p[1][n] + 4 * p[2][n] - p[3][n]) * t * t + (-p[0][n] + 3 * p[1][n] - 3 * p[2][n] + p[3][n]) * t * t * t);
    samples.push({ x: axis(0), y: axis(1), s: 0, tx: 0, ty: 0 });
  }
  let length = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i], b = samples[(i + 1) % samples.length], d = Math.hypot(b.x - a.x, b.y - a.y);
    a.s = length; a.tx = (b.x - a.x) / d; a.ty = (b.y - a.y) / d; a.length = d; length += d;
  }
  function pointAt(distance) {
    const s = mod(distance, length); let lo = 0, hi = samples.length - 1;
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (samples[mid].s <= s) lo = mid; else hi = mid - 1; }
    const a = samples[lo], t = s - a.s; return { x: a.x + a.tx * t, y: a.y + a.ty * t, tx: a.tx, ty: a.ty, angle: Math.atan2(a.ty, a.tx), s, segment: lo };
  }
  function project(x, y) {
    let best = Infinity, result;
    for (let i = 0; i < samples.length; i++) {
      const a = samples[i], t = clamp((x - a.x) * a.tx + (y - a.y) * a.ty, 0, a.length), px = a.x + a.tx * t, py = a.y + a.ty * t, d = (x - px) ** 2 + (y - py) ** 2;
      if (d < best) { best = d; result = { x: px, y: py, s: mod(a.s + t, length), tx: a.tx, ty: a.ty, angle: Math.atan2(a.ty, a.tx), lateral: (x - px) * -a.ty + (y - py) * a.tx, distance: Math.sqrt(d), segment: i }; }
    }
    return result;
  }
  const TRACK = Object.freeze({ width: 1280, height: 900, halfWidth: 60, barrier: 78, length, samples: Object.freeze(samples.map(Object.freeze)), checkpoints: Object.freeze(Array.from({ length: 12 }, (_, i) => Object.freeze({ id: i, ...pointAt(i * length / 12) }))) });
  const ITEMS = Object.freeze({ snowball: { name: '雪球', duration: 2, description: '向前射出雪球；可轉向閃避，或用護盾吸收。' }, banana: { name: '香蕉皮', duration: 12, description: '留在車後，半秒後生效；看見黃色警示可繞開。' }, shield: { name: '冰泡護盾', duration: 8, description: '八秒內抵擋一次雪球或香蕉皮。' }, boost: { name: '熱可可加速', duration: 2, description: '兩秒加速，適合出彎與直線。' } });
  const PROFILES = Object.freeze([
    { name: 'Tux', color: '#267477', pace: 184, lane: 0, drift: .78 },
    { name: 'Pip', color: '#a85e45', pace: 180, lane: -17, drift: .84 },
    { name: 'Nova', color: '#80608e', pace: 191, lane: 16, drift: .74 },
    { name: 'Mochi', color: '#557ca5', pace: 173, lane: -5, drift: 1.03 },
    { name: 'Sunny', color: '#a98129', pace: 185, lane: 10, drift: .9 }
  ].map(Object.freeze));
  function random(seed) { let n = 2166136261; for (const c of String(seed)) n = Math.imul(n ^ c.charCodeAt(0), 16777619); return () => { n += 0x6D2B79F5; let t = n; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function publicKart(r, viewer) { return { id: r.id, name: r.name, color: r.color, x: r.x, y: r.y, angle: r.angle, speed: r.speed, trackS: r.trackS, progress: r.progress, lap: r.lap, checkpoint: r.checkpoint, started: r.started, finished: r.finished, finishTime: r.finishTime, item: r.id === viewer ? r.item : null, hasItem: !!r.item, driftCharge: r.driftCharge, drifting: r.drifting, boost: r.boost, shield: r.shield, stun: r.stun, invulnerable: r.invulnerable, driverError: r.driverError, stuck: r.stuck, profile: r.profile }; }
  function chooseAI(view, id) {
    const r = view.racers[id]; if (!r || r.finished) return { throttle: 0, brake: 1, steer: 0, drift: false, useItem: false };
    const profile = PROFILES[id], near = project(r.x, r.y), look = 48 + Math.max(0, r.speed) * .33, target = pointAt(near.s + look);
    let lane = profile.lane;
    for (const other of view.racers) {
      if (other.id === id || other.finished) continue;
      const dx = other.x - r.x, dy = other.y - r.y, ahead = dx * near.tx + dy * near.ty, side = dx * -near.ty + dy * near.tx;
      if (ahead > 0 && ahead < 80 && Math.abs(side) < 23) lane = side >= 0 ? -29 : 29;
    }
    for (const hazard of view.hazards) if (hazard.armed && Math.hypot(hazard.x - r.x, hazard.y - r.y) < 95) { const side = (hazard.x - near.x) * -near.ty + (hazard.y - near.y) * near.tx; lane = side > 0 ? -29 : 29; }
    const angle = Math.atan2(target.y + target.tx * lane - r.y, target.x - target.ty * lane - r.x), error = wrap(angle - r.angle);
    const curve = Math.abs(wrap(pointAt(near.s + 140).angle - near.angle)), wanted = clamp(profile.pace - curve * 54, 108, profile.pace);
    const reverse = Math.abs(error) > 1.9 && Math.abs(r.speed) < 45;
    const steer = clamp(error * 2.35 + r.driverError, -1, 1) * (reverse ? -1 : 1);
    const drift = !reverse && r.speed > 115 && Math.abs(error) > .13 && Math.abs(error) < .65 && r.driftCharge < profile.drift;
    let useItem = false;
    if (r.item === 'boost') useItem = curve < .5 && Math.abs(error) < .35;
    if (r.item === 'shield') useItem = view.projectiles.some(p => Math.hypot(p.x - r.x, p.y - r.y) < 140) || view.hazards.some(p => Math.hypot(p.x - r.x, p.y - r.y) < 65);
    if (r.item === 'banana') useItem = view.racers.some(o => o.id !== id && !o.finished && (o.x - r.x) * near.tx + (o.y - r.y) * near.ty < -12 && Math.hypot(o.x - r.x, o.y - r.y) < 120);
    if (r.item === 'snowball') useItem = view.racers.some(o => { const dx = o.x - r.x, dy = o.y - r.y; return o.id !== id && !o.finished && dx * Math.cos(r.angle) + dy * Math.sin(r.angle) > 20 && Math.abs(dx * -Math.sin(r.angle) + dy * Math.cos(r.angle)) < 22 && Math.hypot(dx, dy) < 215; });
    return { throttle: reverse ? 0 : r.speed < wanted + 5 ? 1 : .2, brake: reverse ? 1 : r.speed > wanted + 18 ? .65 : 0, steer, drift, useItem };
  }
  class Game {
    constructor(options = {}) { this.seed = options.seed || 'tux-snow'; this.spectator = !!options.spectator; this.reset(); }
    reset(seed = this.seed) {
      this.seed = String(seed); this.random = random(this.seed); this.phase = 'ready'; this.resumePhase = 'countdown'; this.elapsed = 0; this.ticks = 0; this.countdown = 3; this.events = []; this.eventId = 0; this.projectiles = []; this.hazards = []; this.result = null;
      this.telemetry = { collisions: 0, walls: 0, drifts: 0, pickups: 0, items: 0, hits: 0, blocks: 0, checkpoints: 0, laps: 0, recoveryTicks: 0 };
      this.racers = PROFILES.map((p, id) => { const s = length - 30 - Math.floor(id / 2) * 31, at = pointAt(s), lane = id % 2 ? 17 : -17; return { id, name: p.name, color: p.color, profile: p.name, x: at.x - at.ty * lane, y: at.y + at.tx * lane, angle: at.angle, motionAngle: at.angle, speed: 0, trackS: s, progress: -30 - Math.floor(id / 2) * 31, lapDistance: 0, lap: 0, checkpoint: 0, started: false, finished: false, finishTime: null, item: null, itemLatch: false, driftCharge: 0, drifting: false, boost: 0, shield: 0, stun: 0, invulnerable: 0, wallCooldown: 0, driverError: 0, errorUntil: 0, nextError: 8 + this.random() * 7, stuck: 0 }; });
      this.pickups = [];
      for (const fraction of [.14, .37, .61, .84]) for (const lane of [-24, 24]) { const at = pointAt(length * fraction); this.pickups.push({ id: this.pickups.length, x: at.x - at.ty * lane, y: at.y + at.tx * lane, cooldown: 0 }); }
      return this;
    }
    start() { if (this.phase === 'ready') this.phase = 'countdown'; else if (this.phase === 'paused') this.phase = this.resumePhase; return this.phase; }
    pause() { if (['countdown', 'racing'].includes(this.phase)) { this.resumePhase = this.phase; this.phase = 'paused'; } return this.phase; }
    _event(type, racer, extra = {}) { this.events.push({ id: this.eventId++, type, racer, time: this.elapsed, ...extra }); if (this.events.length > 64) this.events.shift(); }
    _hit(r, source) {
      if (r.invulnerable > 0 || r.finished) return false;
      if (r.shield > 0) { r.shield = 0; r.invulnerable = .5; this.telemetry.blocks++; this._event('block', r.id, { x: r.x, y: r.y, source }); }
      else { r.speed *= .35; r.stun = .85; r.invulnerable = .8; this.telemetry.hits++; this._event('hit', r.id, { x: r.x, y: r.y, source }); }
      return true;
    }
    _use(r) {
      if (!r.item || r.finished) return false;
      const item = r.item; r.item = null; this.telemetry.items++; this._event('item', r.id, { item, x: r.x, y: r.y });
      if (item === 'shield') r.shield = 8;
      else if (item === 'boost') r.boost = Math.max(r.boost, 2);
      else if (item === 'snowball') { const speed = 310 + Math.max(0, r.speed); this.projectiles.push({ owner: r.id, x: r.x + Math.cos(r.angle) * 19, y: r.y + Math.sin(r.angle) * 19, vx: Math.cos(r.angle) * speed, vy: Math.sin(r.angle) * speed, life: 2, age: 0 }); if (this.projectiles.length > 32) this.projectiles.shift(); }
      else if (item === 'banana') { this.hazards.push({ owner: r.id, x: r.x - Math.cos(r.angle) * 27, y: r.y - Math.sin(r.angle) * 27, life: 12, age: 0, armed: false }); if (this.hazards.length > 24) this.hazards.shift(); }
      return true;
    }
    _physics(r, raw) {
      const input = { throttle: clamp(Number(raw.throttle) || 0, 0, 1), brake: clamp(Number(raw.brake) || 0, 0, 1), steer: clamp(Number(raw.steer) || 0, -1, 1), drift: !!raw.drift, useItem: !!raw.useItem };
      for (const name of ['boost', 'shield', 'stun', 'invulnerable', 'wallCooldown']) r[name] = Math.max(0, r[name] - DT);
      if (input.useItem && !r.itemLatch) this._use(r); r.itemLatch = input.useItem;
      const before = project(r.x, r.y), wasDrifting = r.drifting;
      r.drifting = input.drift && Math.abs(input.steer) > .1 && r.speed > 95 && r.stun === 0;
      if (r.drifting) r.driftCharge = Math.min(1.5, r.driftCharge + DT);
      else if (wasDrifting) { if (r.driftCharge >= .6) { r.boost = Math.max(r.boost, .55 + r.driftCharge * .65); this.telemetry.drifts++; this._event('drift-boost', r.id, { charge: r.driftCharge }); } r.driftCharge = 0; }
      const maxSpeed = (r.boost > 0 ? 275 : 205) * (before.distance > TRACK.halfWidth - 3 ? .65 : 1);
      let acceleration = input.throttle * (r.boost > 0 ? 350 : 245) - r.speed * .43 - (r.speed > 1 ? 13 : 0);
      if (input.brake) acceleration -= input.brake * (r.speed > 5 ? 375 : 140);
      if (r.stun > 0) acceleration = -r.speed * 2;
      r.speed = clamp(r.speed + acceleration * DT, -66, maxSpeed);
      const turnRate = (.35 + Math.min(Math.abs(r.speed), 180) / 180 * 2.45) * (r.drifting ? 1.2 : 1);
      r.angle = wrap(r.angle + input.steer * turnRate * DT * (r.speed < -2 ? -1 : 1) * (r.stun > 0 ? .4 : 1));
      r.motionAngle = wrap(r.motionAngle + wrap(r.angle - r.motionAngle) * Math.min(1, DT * (r.drifting ? 4 : 12)));
      r.x += Math.cos(r.motionAngle) * r.speed * DT; r.y += Math.sin(r.motionAngle) * r.speed * DT;
      let at = project(r.x, r.y);
      if (at.distance > TRACK.barrier - RADIUS) {
        const nx = (r.x - at.x) / at.distance, ny = (r.y - at.y) / at.distance;
        r.x = at.x + nx * (TRACK.barrier - RADIUS); r.y = at.y + ny * (TRACK.barrier - RADIUS);
        if (r.wallCooldown === 0) { r.speed *= .58; r.wallCooldown = .18; this.telemetry.walls++; this._event('wall', r.id, { x: r.x, y: r.y }); }
        r.motionAngle = wrap(r.motionAngle + wrap(at.angle - r.motionAngle) * .09); at = project(r.x, r.y);
      }
    }
    _progress(r, previous) {
      const at = project(r.x, r.y), bound = 18 + (r.collisionShift || 0);
      let ds = at.s - previous.trackS; if (ds > length / 2) ds -= length; if (ds < -length / 2) ds += length;
      const validMovement = Math.abs(ds) <= bound && Math.hypot(r.x - previous.x, r.y - previous.y) <= bound;
      if (validMovement) { r.progress += ds; if (r.started) r.lapDistance += ds; }
      r.trackS = at.s;
      const gate = TRACK.checkpoints[r.checkpoint], previousSide = (previous.x - gate.x) * gate.tx + (previous.y - gate.y) * gate.ty, side = (r.x - gate.x) * gate.tx + (r.y - gate.y) * gate.ty;
      const gateOffset = Math.abs(wrap((at.s - gate.s) / length * TAU)) / TAU * length;
      if (validMovement && ds > 0 && previousSide <= 0 && side > 0 && gateOffset < 35 && Math.abs((r.x - gate.x) * -gate.ty + (r.y - gate.y) * gate.tx) <= TRACK.barrier) {
        if (r.checkpoint === 0) {
          if (!r.started) { r.started = true; r.lapDistance = 0; r.progress = 0; }
          else if (r.lapDistance >= length * .88) { r.lap++; r.lapDistance = 0; this.telemetry.laps++; this._event('lap', r.id, { lap: r.lap }); }
          else return;
          if (r.lap === LAPS) { r.finished = true; r.finishTime = this.elapsed; r.speed = 0; this._event('finish', r.id); }
        }
        r.checkpoint = (r.checkpoint + 1) % TRACK.checkpoints.length; this.telemetry.checkpoints++;
      }
      r.stuck = Math.abs(r.speed) < 25 ? r.stuck + DT : 0;
      if (r.stuck > 1) this.telemetry.recoveryTicks++;
    }
    step(input = {}) {
      if (this.phase === 'countdown') { this.countdown = Math.max(0, this.countdown - DT); this.ticks++; if (this.countdown <= 1e-8) { this.countdown = 0; this.phase = 'racing'; this._event('start', 0); } return true; }
      if (this.phase !== 'racing') return false;
      this.elapsed += DT; this.ticks++;
      const previous = this.racers.map(r => ({ x: r.x, y: r.y, trackS: r.trackS }));
      for (const r of this.racers) r.collisionShift = 0;
      for (const box of this.pickups) box.cooldown = Math.max(0, box.cooldown - DT);
      const controls = this.racers.map(r => {
        if (r.id === 0 && !this.spectator) return input;
        if (this.elapsed >= r.nextError) { r.driverError = (this.random() - .5) * .36; r.errorUntil = this.elapsed + .35; r.nextError = this.elapsed + 9 + this.random() * 7; }
        if (this.elapsed >= r.errorUntil) r.driverError = 0;
        return chooseAI(this.observation(r.id), r.id);
      });
      for (const r of this.racers) if (!r.finished) this._physics(r, controls[r.id]);
      for (let i = 0; i < this.racers.length; i++) for (let j = i + 1; j < this.racers.length; j++) {
        const a = this.racers[i], b = this.racers[j]; if (a.finished || b.finished) continue;
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy); if (d >= RADIUS * 2) continue;
        const nx = d > .001 ? dx / d : Math.cos((i * 97 + j * 131) * Math.PI / 180), ny = d > .001 ? dy / d : Math.sin((i * 97 + j * 131) * Math.PI / 180);
        const push = (RADIUS * 2 - d) / 2; a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push; a.collisionShift += push; b.collisionShift += push;
        if (a.wallCooldown === 0 && b.wallCooldown === 0) { a.speed *= .88; b.speed *= .88; a.wallCooldown = b.wallCooldown = .12; this.telemetry.collisions++; }
      }
      // Gate credit is evaluated once, after every physical displacement including bumps.
      for (const r of this.racers) if (!r.finished) {
        const at = project(r.x, r.y); if (at.distance > TRACK.barrier - RADIUS) { r.x = at.x + (r.x - at.x) / at.distance * (TRACK.barrier - RADIUS); r.y = at.y + (r.y - at.y) / at.distance * (TRACK.barrier - RADIUS); }
        this._progress(r, previous[r.id]);
      }
      for (const r of this.racers) if (!r.finished && !r.item) for (const box of this.pickups) if (!box.cooldown && Math.hypot(r.x - box.x, r.y - box.y) < 22) { r.item = Object.keys(ITEMS)[Math.floor(this.random() * 4)]; box.cooldown = 7; this.telemetry.pickups++; this._event('pickup', r.id); break; }
      for (const p of this.projectiles) { p.age += DT; p.life -= DT; if (p.life <= 0) continue; p.x += p.vx * DT; p.y += p.vy * DT; if (project(p.x, p.y).distance > TRACK.barrier) { p.life = 0; continue; } if (p.age > .1) for (const r of this.racers) if (r.id !== p.owner && Math.hypot(r.x - p.x, r.y - p.y) < RADIUS + 7 && this._hit(r, 'snowball')) { p.life = 0; break; } }
      this.projectiles = this.projectiles.filter(p => p.life > 0);
      for (const h of this.hazards) { h.age += DT; h.life -= DT; if (h.life <= 0) continue; h.armed = h.age >= .5; if (h.armed) for (const r of this.racers) if ((r.id !== h.owner || h.age > 1.2) && Math.hypot(r.x - h.x, r.y - h.y) < RADIUS + 8 && this._hit(r, 'banana')) { h.life = 0; break; } }
      this.hazards = this.hazards.filter(h => h.life > 0);
      if (this.racers.every(r => r.finished)) { this.phase = 'over'; this.result = { standings: this.standings(), time: this.elapsed }; }
      return true;
    }
    standings() { return this.racers.slice().sort((a, b) => a.finished && b.finished ? a.finishTime - b.finishTime || a.id - b.id : a.finished ? -1 : b.finished ? 1 : b.lap - a.lap || b.progress - a.progress || a.id - b.id).map((r, i) => ({ id: r.id, name: r.name, rank: i + 1, lap: r.lap, finished: r.finished, time: r.finishTime, progress: r.progress })); }
    observation(viewer = 0) { return { seed: this.seed, phase: this.phase, spectator: this.spectator, elapsed: this.elapsed, countdown: this.countdown, ticks: this.ticks, racers: this.racers.map(r => publicKart(r, viewer)), pickups: this.pickups.map(b => ({ ...b })), projectiles: this.projectiles.map(p => ({ ...p })), hazards: this.hazards.map(h => ({ ...h })), events: this.events.map(e => ({ ...e })), standings: this.standings(), result: this.result ? JSON.parse(JSON.stringify(this.result)) : null, telemetry: { ...this.telemetry } }; }
  }
  return { Game, DT, LAPS, TRACK, ITEMS, PROFILES, RADIUS, pointAt, project, chooseAI, wrap };
});
