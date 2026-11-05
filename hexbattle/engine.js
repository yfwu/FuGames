/* HexBattle engine: a deterministic, headless deck-building and layout war
   game on a hex map. Pure data in, pure data out: the whole game state is a
   JSON-serialisable object, every random draw comes from a seeded generator
   stored in that state, and the same seed plus the same action log always
   replays to the same game. Runs unchanged in the browser and in Node.

   Public API (see docs/hexbattle/agent-api.md):
     createGame(options)            -> state
     act(state, player, action)     -> { ok, error?, events }
     legalActions(state, player)    -> action[]
     observe(state, player)         -> fog-filtered observation
     currentPlayer(state)           -> player id whose turn it is (0 when over)
     catalog()                      -> card, building and unit definitions
     income(state, player)          -> projected next-round income breakdown
     previewBuild(state, p, type, cell) -> income delta of a hypothetical building
*/
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HexBattleEngine = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const VERSION = 1;
  const SUBTICKS = 6;
  const RES = ['food', 'mat', 'gold'];

  // ------------------------------------------------------------------ data

  const TERRAIN = {
    plain:    { name: '平原', pass: true,  build: true,  move: 1, cover: 0 },
    forest:   { name: '森林', pass: true,  build: true,  move: 2, cover: 1 },
    hill:     { name: '丘陵', pass: true,  build: true,  move: 2, cover: 1 },
    marsh:    { name: '沼澤', pass: true,  build: false, move: 2, cover: 0 },
    mountain: { name: '山脈', pass: false, build: false, move: 9, cover: 0 },
    water:    { name: '水域', pass: false, build: false, move: 9, cover: 0 },
    bridge:   { name: '橋梁', pass: true,  build: false, move: 1, cover: 0 },
    pass:     { name: '山道', pass: true,  build: false, move: 2, cover: 1 }
  };
  const FEATURE = { '': '', fertile: '沃土', gold: '金脈', relic: '遺跡' };

  // ctl: territory radius (-1 = none), inf: influence, vis: vision radius.
  const BUILDINGS = {
    capital:  { name: '都城',   hp: 30, armor: 1, atk: 3, range: 2, cd: 2, ctl: 2, inf: 4, vis: 3, recruit: true },
    farm:     { name: '農田',   hp: 6,  armor: 0, ctl: 1, inf: 1, vis: 1, on: ['plain'] },
    lumber:   { name: '伐木場', hp: 6,  armor: 0, ctl: 1, inf: 1, vis: 1, needAdj: ['forest'], upkeep: 1 },
    mine:     { name: '礦場',   hp: 8,  armor: 0, ctl: 1, inf: 1, vis: 1, mineSite: true, upkeep: 1 },
    market:   { name: '市集',   hp: 6,  armor: 0, ctl: 1, inf: 1, vis: 1, upkeep: 1 },
    granary:  { name: '倉庫',   hp: 8,  armor: 0, ctl: 1, inf: 1, vis: 1 },
    outpost:  { name: '前哨',   hp: 6,  armor: 0, ctl: 2, inf: 2, vis: 3, upkeep: 1 },
    barracks: { name: '兵營',   hp: 10, armor: 0, ctl: 1, inf: 1, vis: 2, recruit: true, limit: 3, upkeep: 1 },
    workshop: { name: '工坊',   hp: 8,  armor: 0, ctl: 1, inf: 1, vis: 1, recruit: true, limit: 2, upkeep: 1 },
    tower:    { name: '箭塔',   hp: 12, armor: 1, atk: 3, range: 2, cd: 2, ctl: 1, inf: 2, vis: 3, upkeep: 1 },
    wall:     { name: '城牆',   hp: 16, armor: 2, ctl: 0, inf: 0, vis: 1 },
    shrine:   { name: '神殿',   hp: 8,  armor: 0, ctl: 1, inf: 2, vis: 2, onFeature: 'relic', upkeep: 1 }
  };

  // One upgrade level per building (the capital has two). Costs resources only.
  const UPGRADES = {
    capital:  [{ cost: { mat: 6, gold: 4 }, text: '手牌上限 +1' }, { cost: { mat: 10, gold: 6 }, text: '每回合指令點 +1' }],
    farm:     [{ cost: { mat: 3, gold: 1 }, text: '糧 +1、耐久 +4' }],
    lumber:   [{ cost: { mat: 2, gold: 2 }, text: '材 +1、耐久 +4' }],
    mine:     [{ cost: { mat: 3, gold: 2 }, text: '材 +1、耐久 +4' }],
    market:   [{ cost: { mat: 4, gold: 1 }, text: '金 +1、耐久 +4' }],
    granary:  [{ cost: { mat: 4, gold: 1 }, text: '資源上限再 +8' }],
    outpost:  [{ cost: { mat: 3, gold: 2 }, text: '改建堡壘：耐久 +6，攻擊 2、射程 2' }],
    tower:    [{ cost: { mat: 3, gold: 2 }, text: '攻擊 +1、耐久 +6' }],
    wall:     [{ cost: { mat: 2 }, text: '耐久 +10' }],
    barracks: [{ cost: { mat: 5, gold: 3 }, text: '每輪訓練 2 支部隊' }],
    shrine:   [{ cost: { mat: 8, gold: 6 }, text: '每輪再 +1 分' }]
  };
  const UPGRADE_HP = { farm: 4, lumber: 4, mine: 4, market: 4, outpost: 6, tower: 6, wall: 10, capital: 6, granary: 4, barracks: 4, shrine: 4 };

  const UNITS = {
    militia:  { name: '民兵',   hp: 6,  atk: 2, armor: 0, range: 1, move: 3, cd: 2, vis: 2, upkeep: 1, tags: ['foot'] },
    spear:    { name: '槍兵',   hp: 9,  atk: 2, armor: 1, range: 1, move: 3, cd: 2, vis: 2, upkeep: 1, tags: ['foot'], bonus: { mounted: 3 } },
    archer:   { name: '弓兵',   hp: 6,  atk: 2, armor: 0, range: 2, move: 3, cd: 2, vis: 3, upkeep: 1, tags: ['foot', 'ranged'], bonus: { foot: 1 } },
    cavalry:  { name: '騎兵',   hp: 10, atk: 3, armor: 0, range: 1, move: 5, cd: 2, vis: 3, upkeep: 2, tags: ['mounted'], bonus: { ranged: 3, siege: 3 } },
    scout:    { name: '斥候',   hp: 4,  atk: 1, armor: 0, range: 1, move: 6, cd: 2, vis: 4, upkeep: 1, tags: ['mounted'] },
    catapult: { name: '投石車', hp: 6,  atk: 2, armor: 0, range: 3, move: 2, cd: 3, vis: 2, upkeep: 1, tags: ['siege', 'ranged'], vsBuilding: 6, from: 'workshop' },
    guardian: { name: '古衛',   hp: 26, atk: 4, armor: 1, range: 1, move: 2, cd: 2, vis: 2, upkeep: 0, tags: ['foot'], neutral: true },
    sentinel: { name: '哨靈',   hp: 8,  atk: 2, armor: 1, range: 1, move: 2, cd: 2, vis: 2, upkeep: 0, tags: ['foot'], neutral: true }
  };

  // kind: build | unit | tactic | econ | vp. price: gold in the market.
  // cost: resources paid when played. ap: command points to play.
  const CARDS = {
    // economy
    tax:       { name: '徵稅', kind: 'econ', price: 2, ap: 0, text: '+2 金' },
    survey:    { name: '開墾', kind: 'econ', price: 2, ap: 0, text: '+2 材' },
    harvest:   { name: '豐收', kind: 'econ', price: 3, ap: 0, text: '+2 糧，每座農田再 +1（最多 +3）' },
    trade:     { name: '商隊', kind: 'econ', price: 4, ap: 0, text: '+2 金，每座市集再 +1（最多 +3）' },
    treasury:  { name: '國庫', kind: 'econ', price: 6, ap: 0, text: '+4 金' },
    mobilize:  { name: '動員', kind: 'econ', price: 4, ap: 0, text: '+2 指令點' },
    scheme:    { name: '謀略', kind: 'econ', price: 4, ap: 0, text: '抽 2 張牌' },
    purge:     { name: '整編', kind: 'econ', price: 3, ap: 0, text: '從手牌永久移除至多 2 張其他牌', targets: 'hand' },
    // buildings
    farm:      { name: '農田',   kind: 'build', build: 'farm',     price: 2, ap: 1, cost: { mat: 2 }, text: '平原。糧 1，相鄰水域每格 +1（最多 2），沃土 +2，相鄰 2 座以上農田 +1，相鄰倉庫 +1' },
    lumber:    { name: '伐木場', kind: 'build', build: 'lumber',   price: 2, ap: 1, cost: { mat: 1, gold: 1 }, text: '須鄰森林。材 1，相鄰 3 格以上森林再 +1' },
    mine:      { name: '礦場',   kind: 'build', build: 'mine',     price: 3, ap: 1, cost: { mat: 3 }, text: '建在丘陵或鄰山。材 1，建在丘陵且鄰山丘再 +1；建在金脈上 +3 金、相鄰金脈 +1 金' },
    market:    { name: '市集',   kind: 'build', build: 'market',   price: 4, ap: 1, cost: { mat: 3 }, text: '相鄰每座己方建築（城牆除外）金 +1（最多 3）' },
    granary:   { name: '倉庫',   kind: 'build', build: 'granary',  price: 3, ap: 1, cost: { mat: 3 }, text: '三種資源上限各 +8；相鄰農田糧 +1' },
    outpost:   { name: '前哨',   kind: 'build', build: 'outpost',  price: 3, ap: 1, cost: { mat: 2, gold: 1 }, text: '領土半徑 2、影響力 2、視野 3。擴張與爭奪領土' },
    barracks:  { name: '兵營',   kind: 'build', build: 'barracks', price: 4, ap: 1, cost: { mat: 4 }, text: '每回合可在此徵召一支部隊（最多 3 座）' },
    workshop:  { name: '工坊',   kind: 'build', build: 'workshop', price: 5, ap: 1, cost: { mat: 4, gold: 1 }, text: '可徵召投石車與一般部隊（最多 2 座）' },
    tower:     { name: '箭塔',   kind: 'build', build: 'tower',    price: 4, ap: 1, cost: { mat: 3, gold: 1 }, text: '射程 2（丘陵 3）、攻擊 3、影響力 2、視野 3' },
    wall:      { name: '城牆',   kind: 'build', build: 'wall',     price: 2, ap: 1, cost: { mat: 1 }, text: '耐久 16、護甲 2，阻擋敵軍；不擴張領土' },
    shrine:    { name: '神殿',   kind: 'build', build: 'shrine',   price: 5, ap: 1, cost: { mat: 4, gold: 2 }, text: '只能建在遺跡上。連通時該遺跡每輪再 +1 分（中央 +2），影響力 2' },
    // units
    militia:   { name: '民兵',   kind: 'unit', unit: 'militia',  price: 1, ap: 1, cost: { food: 1 }, text: '耐久 6、攻 2。便宜的守備兵' },
    spear:     { name: '槍兵',   kind: 'unit', unit: 'spear',    price: 3, ap: 1, cost: { food: 2, mat: 1 }, text: '耐久 9、攻 2、甲 1；對騎兵 +3' },
    archer:    { name: '弓兵',   kind: 'unit', unit: 'archer',   price: 3, ap: 1, cost: { food: 2, gold: 1 }, text: '射程 2（丘陵 3）、攻 2；對步兵 +1' },
    cavalry:   { name: '騎兵',   kind: 'unit', unit: 'cavalry',  price: 5, ap: 1, cost: { food: 2, gold: 2 }, text: '耐久 10、攻 3、移動 5；對弓兵與攻城 +3；每輪吃 2 糧' },
    scout:     { name: '斥候',   kind: 'unit', unit: 'scout',    price: 2, ap: 1, cost: { food: 1 }, text: '移動 6、視野 4。探路與騷擾' },
    catapult:  { name: '投石車', kind: 'unit', unit: 'catapult', price: 5, ap: 1, cost: { food: 1, mat: 3, gold: 2 }, text: '須在工坊徵召。射程 3，對建築傷害 6' },
    // tactics
    firearrows:{ name: '火箭',   kind: 'tactic', price: 3, ap: 1, cost: { mat: 1, gold: 1 }, target: 'enemy-near', text: '對己方部隊或建築 2 格內一個可見敵方目標造成 4 傷害' },
    ambush:    { name: '伏兵',   kind: 'tactic', price: 3, ap: 1, cost: { food: 1 }, target: 'own-empty', text: '在己方領土埋伏（他人看不見）。敵軍踏入受 5 傷害（最多 3 處）' },
    rally:     { name: '鼓舞',   kind: 'tactic', price: 3, ap: 1, cost: { food: 1 }, text: '本輪戰鬥己方部隊攻擊 +1' },
    entrench:  { name: '堅守',   kind: 'tactic', price: 3, ap: 1, cost: { mat: 1 }, text: '本輪戰鬥己方領土內的部隊與建築護甲 +1' },
    march:     { name: '急行軍', kind: 'tactic', price: 3, ap: 1, cost: { food: 2 }, text: '本輪戰鬥己方部隊移動 +2' },
    recon:     { name: '偵察',   kind: 'tactic', price: 2, ap: 1, target: 'any', text: '揭露目標周圍 3 格，持續到下一輪結束' },
    sabotage:  { name: '破壞',   kind: 'tactic', price: 4, ap: 1, cost: { gold: 2 }, target: 'enemy-building', text: '可見敵方建築停工：本輪與下一輪不生產、不射擊' },
    plunder:   { name: '劫掠',   kind: 'tactic', price: 4, ap: 1, target: 'enemy-building-adj', text: '己方部隊相鄰的敵方建築：從其主人奪走至多 3 金' },
    bridge:    { name: '架橋',   kind: 'tactic', price: 3, ap: 1, cost: { mat: 2 }, target: 'water-adj', text: '己方領土旁的水域變成橋梁（可通行，不可建築）' },
    tunnel:    { name: '開山',   kind: 'tactic', price: 4, ap: 1, cost: { mat: 3 }, target: 'mountain-adj', text: '己方領土旁的山脈打通成山道' },
    clearing:  { name: '伐林',   kind: 'tactic', price: 2, ap: 1, target: 'own-forest', text: '己方領土內無建築的森林變平原，+2 材' },
    repair:    { name: '修繕',   kind: 'tactic', price: 2, ap: 1, cost: { mat: 1 }, target: 'own-building', text: '己方建築回滿耐久' },
    fortify:   { name: '強化',   kind: 'tactic', price: 4, ap: 1, cost: { mat: 2 }, target: 'own-building', text: '己方建築永久護甲 +1、耐久上限 +6' },
    // victory points
    honor:     { name: '勳章', kind: 'vp', price: 4, vp: 1, text: '1 分。不能打出' },
    monument:  { name: '豐碑', kind: 'vp', price: 7, vp: 2, text: '2 分。不能打出' },
    crown:     { name: '王冠', kind: 'vp', price: 10, vp: 3, text: '3 分。不能打出' }
  };

  const STARTING_DECK = ['farm', 'farm', 'lumber', 'mine', 'outpost', 'militia', 'militia', 'tax', 'tax', 'survey'];
  const MARKET_COPIES = {
    farm: 3, lumber: 2, mine: 2, outpost: 3, market: 3, granary: 2, barracks: 3, workshop: 2, tower: 3, wall: 3, shrine: 3,
    spear: 3, archer: 3, cavalry: 3, scout: 2, catapult: 2,
    firearrows: 3, ambush: 2, rally: 2, entrench: 2, march: 2, recon: 2, sabotage: 2, plunder: 2, bridge: 2, tunnel: 1, clearing: 2, repair: 2, fortify: 2,
    tax: 2, survey: 2, harvest: 2, trade: 2, treasury: 2, mobilize: 3, scheme: 3, purge: 3,
    honor: 4, monument: 3, crown: 2
  };

  const DEFAULTS = {
    players: 4, maxRounds: 30, handSize: 5, ap: 3, keep: 1, marketSize: 6, popCap: 16,
    baseCap: 20, granaryCap: 8, neutrals: true,
    start: { food: 6, mat: 6, gold: 3 }
  };
  const RADIUS = { 2: 8, 3: 10, 4: 10, 5: 12, 6: 12 };
  const VP_TARGET = { 2: 30, 3: 40, 4: 40, 5: 40, 6: 40 };
  const SEATS = { 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 5] };
  const NAMES = ['赤焰', '青嵐', '碧濤', '金穗', '紫宸', '素霜']; // matches FuPalette.sides: 朱 青 玉 金 紫 骨白
  const ROTATE = (q, r) => [-r, q + r];

  // -------------------------------------------------------------- geometry

  const GEO = new Map();
  const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  function geometry(R) {
    if (GEO.has(R)) return GEO.get(R);
    const cells = [], lookup = new Map();
    for (let q = -R; q <= R; q++) for (let r = Math.max(-R, -q - R); r <= Math.min(R, -q + R); r++) { lookup.set(q + ',' + r, cells.length); cells.push({ q, r }); }
    const adj = cells.map(c => DIRS.map(([dq, dr]) => lookup.get((c.q + dq) + ',' + (c.r + dr))).filter(v => v !== undefined));
    const disks = new Map();
    const g = {
      R, cells, adj, count: cells.length,
      index: (q, r) => { const v = lookup.get(q + ',' + r); return v === undefined ? -1 : v; },
      dist: (a, b) => { const A = cells[a], B = cells[b]; return (Math.abs(A.q - B.q) + Math.abs(A.r - B.r) + Math.abs(A.q + A.r - B.q - B.r)) / 2; },
      disk(i, d) {
        const key = i * 16 + d; let out = disks.get(key);
        if (!out) {
          out = []; const c = cells[i];
          for (let dq = -d; dq <= d; dq++) for (let dr = Math.max(-d, -dq - d); dr <= Math.min(d, -dq + d); dr++) { const j = lookup.get((c.q + dq) + ',' + (c.r + dr)); if (j !== undefined) out.push(j); }
          disks.set(key, out);
        }
        return out;
      }
    };
    GEO.set(R, g);
    return g;
  }
  const geo = st => geometry(st.map.R);

  // ------------------------------------------------------------------- rng

  function mix32(x) { x = Math.imul((x >>> 0) ^ (x >>> 16), 0x45d9f3b); x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); return (x ^ (x >>> 16)) >>> 0; }
  function hashString(s) { let h = 2166136261 >>> 0; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
  function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function rand(st) { // state-held generator, so a saved game resumes the same sequence
    let t = (st.rng = (st.rng + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function shuffle(st, arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rand(st) * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }

  // ----------------------------------------------------------------- map gen

  function canonical(q, r) { // rotate into the wedge q>=1, r>=0; returns [q, r, k]
    if (q === 0 && r === 0) return [0, 0, 0];
    for (let k = 0; k < 6; k++) { if (q >= 1 && r >= 0) return [q, r, k]; [q, r] = ROTATE(q, r); }
    throw new Error('unreachable');
  }
  // The map has full hexagonal (D6) symmetry: six rotations and their mirror
  // images, so every seat sees the same terrain on its left and on its right.
  function rotations(q, r) { const out = []; for (const [a0, b0] of [[q, r], [r, q]]) { let a = a0, b = b0; for (let k = 0; k < 6; k++) { out.push([a, b]); [a, b] = ROTATE(a, b); } } return out; }
  function representative(q, r) { let best = null; for (const [a, b] of rotations(q, r)) if (!best || a < best[0] || (a === best[0] && b < best[1])) best = [a, b]; return best; }

  function generateMap(seed, players) {
    const R = RADIUS[players], g = geometry(R), rnd = mulberry(hashString('map:' + seed));
    const lattice = new Map();
    const lat = (x, y, o) => { const k = x + ',' + y + ',' + o; if (!lattice.has(k)) lattice.set(k, rnd()); return lattice.get(k); };
    // value noise is sampled lazily, so draw the lattice in a fixed order first
    for (let o = 0; o < 4; o++) for (let x = -2; x <= R + 3; x++) for (let y = -2; y <= R + 3; y++) lat(x, y, o);
    const sm = t => t * t * (3 - 2 * t);
    const noise = (x, y, o, f) => {
      x *= f; y *= f; const xi = Math.floor(x), yi = Math.floor(y), xf = sm(x - xi), yf = sm(y - yi);
      const a = lat(xi, yi, o), b = lat(xi + 1, yi, o), c = lat(xi, yi + 1, o), d = lat(xi + 1, yi + 1, o);
      return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
    };
    const terrain = new Array(g.count).fill('plain'), feature = new Array(g.count).fill('');
    // canonical wedge cells
    const wedge = [];
    for (let i = 0; i < g.count; i++) { const { q, r } = g.cells[i]; if (q === 0 && r === 0) continue; const [a, b] = representative(q, r); if (a === q && b === r) wedge.push(i); }
    const fields = wedge.map(i => {
      const { q, r } = g.cells[i], x = q + r / 2, y = r * 0.866;
      return { i, h: noise(x, y, 0, 0.32) * 0.7 + noise(x, y, 1, 0.75) * 0.3, m: noise(x, y, 2, 0.38) * 0.7 + noise(x, y, 3, 0.9) * 0.3 };
    });
    const byH = [...fields].sort((a, b) => a.h - b.h || a.i - b.i), n = byH.length;
    byH.forEach((f, k) => { const t = k / n; f.t = t < 0.1 ? 'water' : t > 0.92 ? 'mountain' : t > 0.77 ? 'hill' : null; });
    const rest = byH.filter(f => !f.t).sort((a, b) => b.m - a.m || a.i - b.i);
    rest.forEach((f, k) => { const t = k / rest.length; f.t = t < 0.34 ? 'forest' : (t > 0.9 && f.h < 0.45) ? 'marsh' : 'plain'; });
    const wedgeT = new Map(fields.map(f => [f.i, f.t]));
    const setSym = (q, r, t, feat) => { for (const [a, b] of rotations(q, r)) { const j = g.index(a, b); if (j >= 0) { if (t) terrain[j] = t; if (feat !== undefined) feature[j] = feat; } } };
    for (const [i, t] of wedgeT) setSym(g.cells[i].q, g.cells[i].r, t);

    const c = Math.floor((R - 2) / 2); // capital at (c, c) in wedge 0 -> distance 2c from centre
    const capQ = c, capR = c;
    // centre and relics
    terrain[g.index(0, 0)] = 'plain'; feature[g.index(0, 0)] = 'relic';
    setSym(1, 0, rnd() < 0.5 ? 'hill' : 'plain');
    setSym(c + 1, 0, 'plain', 'relic');
    // starting area: capital ring 1 open, ring 2 guaranteed resources
    const capI = g.index(capQ, capR);
    const ring = d => g.disk(capI, d).filter(j => g.dist(j, capI) === d);
    setSym(capQ, capR, 'plain', '');
    const r1 = ring(1), r2 = ring(2);
    r1.forEach(j => setSym(g.cells[j].q, g.cells[j].r, 'plain', ''));
    const forestAt = r1[Math.floor(rnd() * r1.length)]; setSym(g.cells[forestAt].q, g.cells[forestAt].r, 'forest', '');
    const order = [...r2]; for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const plan = ['forest', 'forest', 'hill', 'water', 'plain', 'plain'];
    order.slice(0, plan.length).forEach((j, k) => setSym(g.cells[j].q, g.cells[j].r, plan[k], ''));
    // features: gold on a hill 3-5 from the capital, fertile plains next to water
    const wedgeCells = []; for (let i = 0; i < g.count; i++) if (g.dist(i, capI) >= 3 && g.dist(i, capI) <= 5 && feature[i] === '' && g.dist(i, g.index(0, 0)) >= 3) wedgeCells.push(i);
    const goldHill = wedgeCells.find(i => terrain[i] === 'hill') ?? wedgeCells.find(i => terrain[i] === 'plain');
    if (goldHill !== undefined) setSym(g.cells[goldHill].q, g.cells[goldHill].r, 'hill', 'gold');
    for (const i of wedge) if (terrain[i] === 'plain' && feature[i] === '' && g.adj[i].some(j => terrain[j] === 'water') && rnd() < 0.2) setSym(g.cells[i].q, g.cells[i].r, null, 'fertile');
    const fertileNear = r2.find(j => terrain[j] === 'plain' && feature[j] === '');
    if (fertileNear !== undefined) setSym(g.cells[fertileNear].q, g.cells[fertileNear].r, null, 'fertile');
    // carve passable routes capital -> centre and capital -> both relics
    const carve = (from, to) => {
      const cost = j => ({ plain: 1, forest: 1.5, hill: 1.5, marsh: 2, bridge: 1, pass: 2, water: 7, mountain: 7 })[terrain[j]];
      const dist = new Array(g.count).fill(Infinity), prev = new Array(g.count).fill(-1); dist[from] = 0;
      const open = [from];
      while (open.length) {
        let bi = 0; for (let k = 1; k < open.length; k++) if (dist[open[k]] < dist[open[bi]]) bi = k;
        const cur = open.splice(bi, 1)[0]; if (cur === to) break;
        for (const j of g.adj[cur]) { const d = dist[cur] + cost(j); if (d < dist[j]) { if (dist[j] === Infinity) open.push(j); dist[j] = d; prev[j] = cur; } }
      }
      for (let j = to; j >= 0 && j !== from; j = prev[j]) {
        if (terrain[j] === 'water') setSym(g.cells[j].q, g.cells[j].r, 'marsh');
        else if (terrain[j] === 'mountain') setSym(g.cells[j].q, g.cells[j].r, 'hill');
      }
    };
    carve(capI, g.index(0, 0));
    for (const [a, b] of [[c + 1, 0], [0, c + 1]]) carve(capI, g.index(a, b));
    // capitals for the chosen sectors
    const capitals = SEATS[players].map(s => { let q = capQ, r = capR; for (let k = 0; k < s; k++) [q, r] = ROTATE(q, r); return g.index(q, r); });
    const relics = []; for (let i = 0; i < g.count; i++) if (feature[i] === 'relic') relics.push(i);
    return { R, terrain, feature, capitals, relics, center: g.index(0, 0) };
  }

  // ---------------------------------------------------------------- helpers

  const P = (st, id) => st.players[id - 1];
  const alivePlayers = st => st.players.filter(p => p.alive);
  const buildingAt = (st, cell) => st.buildings.find(b => b.cell === cell) || null;
  const unitAt = (st, cell) => st.units.find(u => u.cell === cell) || null;
  const capitalOf = (st, id) => st.buildings.find(b => b.owner === id && b.type === 'capital') || null;
  const cardVp = p => [...p.deck, ...p.hand, ...p.discard].reduce((s, c) => s + (CARDS[c.k].vp || 0), 0);
  const totalVp = (st, id) => P(st, id).vp + cardVp(P(st, id));
  const resCap = (st, id) => st.rules.baseCap + st.rules.granaryCap * st.buildings.filter(b => b.owner === id && b.type === 'granary' && st.connected[b.cell]).reduce((s, b) => s + (b.lvl || 1), 0);
  const lvl = b => b.lvl || 1;
  // attack profile of a building, or null when it does not shoot
  function bAttack(st, b) {
    const d = BUILDINGS[b.type];
    if (b.type === 'outpost' && lvl(b) >= 2) return { atk: 2, range: 2, cd: 2 };
    if (!d.atk) return null;
    return { atk: d.atk + (b.type === 'tower' && lvl(b) >= 2 ? 1 : 0), range: d.range, cd: d.cd };
  }
  // bank exchange: 3 of one resource for 1 of another, 2:1 with a connected market
  const tradeRate = (st, id) => st.buildings.some(b => b.owner === id && b.type === 'market' && st.connected[b.cell]) ? 2 : 3;
  const handSizeOf = (st, id) => st.rules.handSize + (lvl(capitalOf(st, id) || {}) >= 2 ? 1 : 0);
  const apOf = (st, id) => st.rules.ap + (lvl(capitalOf(st, id) || {}) >= 3 ? 1 : 0);
  // Every second building of the same type costs 1 more material, so sprawl
  // gets expensive and each site has to earn its place.
  function cardCost(st, id, key) {
    const def = CARDS[key], base = def.cost || {};
    if (def.kind !== 'build') return base;
    const n = st.buildings.filter(b => b.owner === id && b.type === def.build).length;
    const extra = Math.floor(n / 2);
    return extra ? { ...base, mat: (base.mat || 0) + extra } : base;
  }
  function canPay(res, cost) { for (const k of RES) if ((cost && cost[k] || 0) > res[k]) return false; return true; }
  function pay(res, cost) { if (cost) for (const k of RES) res[k] -= cost[k] || 0; }
  function cellRef(st, target) { // accept index, [q, r] or {q, r}
    if (Number.isInteger(target)) return target >= 0 && target < geo(st).count ? target : -1;
    if (Array.isArray(target) && target.length === 2) return geo(st).index(target[0], target[1]);
    if (target && Number.isInteger(target.q) && Number.isInteger(target.r)) return geo(st).index(target.q, target.r);
    return -1;
  }
  function event(st, e) { e.round = st.round; st.log.push(e); if (st.log.length > 400) st.log.splice(0, st.log.length - 400); return e; }

  // -------------------------------------------------------------- territory

  function computeTerritory(st) {
    const g = geo(st), n = st.players.length, count = g.count;
    const inf = []; for (let p = 0; p <= n; p++) inf.push(new Float64Array(count));
    for (const b of st.buildings) {
      const d = BUILDINGS[b.type]; if (!b.owner) continue;
      inf[b.owner][b.cell] += 3; // a building always anchors its own cell
      if (d.ctl < 0) continue;
      for (const j of g.disk(b.cell, d.ctl)) inf[b.owner][j] += d.inf + (j === b.cell ? 0 : 0);
    }
    const owner = new Array(count).fill(0);
    for (let i = 0; i < count; i++) {
      let best = 0, who = 0, tie = false;
      for (let p = 1; p <= n; p++) { const v = inf[p][i]; if (v > best) { best = v; who = p; tie = false; } else if (v === best && v > 0) tie = true; }
      owner[i] = tie ? -1 : who;
    }
    // territory connected to each capital
    const connected = new Array(count).fill(false);
    for (const p of st.players) {
      const cap = capitalOf(st, p.id); if (!cap || owner[cap.cell] !== p.id) continue;
      const stack = [cap.cell]; connected[cap.cell] = true;
      while (stack.length) { const cur = stack.pop(); for (const j of g.adj[cur]) if (!connected[j] && owner[j] === p.id) { connected[j] = true; stack.push(j); } }
    }
    st.owner = owner; st.connected = connected;
  }

  // -------------------------------------------------------------- visibility

  function visibleSet(st, id) {
    const g = geo(st), vis = new Uint8Array(g.count);
    const mark = (cell, r) => { for (const j of g.disk(cell, r)) vis[j] = 1; };
    for (const b of st.buildings) if (b.owner === id) mark(b.cell, BUILDINGS[b.type].vis);
    for (const u of st.units) if (u.owner === id) mark(u.cell, UNITS[u.type].vis + (st.map.terrain[u.cell] === 'hill' ? 1 : 0));
    for (const r of P(st, id).reveal) if (r.until >= st.round) mark(r.cell, r.r);
    for (let i = 0; i < g.count; i++) if (st.owner[i] === id) vis[i] = 1;
    return vis;
  }
  function updateIntel(st) {
    for (const p of st.players) {
      if (!p.alive) continue;
      const vis = visibleSet(st, p.id);
      for (const key of Object.keys(p.intel)) if (vis[+key]) delete p.intel[key];
      for (const b of st.buildings) if (b.owner !== p.id && vis[b.cell]) p.intel[b.cell] = { type: b.type, owner: b.owner, round: st.round };
    }
  }

  // ----------------------------------------------------------------- income

  function buildingYield(st, b, around) {
    const g = geo(st), T = st.map.terrain, F = st.map.feature, adj = g.adj[b.cell];
    const near = type => adj.filter(j => around[j] && around[j].type === type && around[j].owner === b.owner).length;
    const out = { food: 0, mat: 0, gold: 0 };
    switch (b.type) {
      case 'capital': out.food = 2; out.mat = 2; out.gold = 2; break;
      case 'farm':
        out.food = (lvl(b) >= 2 ? 2 : 1) + Math.min(2, adj.filter(j => T[j] === 'water' || T[j] === 'bridge').length) + (F[b.cell] === 'fertile' ? 2 : 0) + (near('farm') >= 2 ? 1 : 0) + (near('granary') ? 1 : 0);
        break;
      case 'lumber': { const f = adj.filter(j => T[j] === 'forest').length; out.mat = (f >= 1 ? 1 : 0) + (f >= 3 ? 1 : 0) + (lvl(b) >= 2 ? 1 : 0); break; }
      case 'mine':
        out.mat = 1 + (T[b.cell] === 'hill' && adj.some(j => T[j] === 'mountain' || T[j] === 'hill') ? 1 : 0) + (lvl(b) >= 2 ? 1 : 0);
        out.gold = F[b.cell] === 'gold' ? 3 : adj.some(j => F[j] === 'gold') ? 1 : 0;
        break;
      case 'market': out.gold = Math.min(3, adj.filter(j => around[j] && around[j].owner === b.owner && around[j].type !== 'wall').length) + (lvl(b) >= 2 ? 1 : 0); break;
      default: break;
    }
    return out;
  }
  // Projected income for the next round start. Food feeds units first, then
  // the workers of every building with a food upkeep (oldest first); a building
  // whose workers go hungry produces nothing that round.
  function income(st, id) {
    const around = {}; for (const b of st.buildings) around[b.cell] = b;
    const total = { food: 0, mat: 0, gold: 0 }, list = [], p = P(st, id), cap = resCap(st, id);
    const mine = st.buildings.filter(b => b.owner === id).sort((a, b) => a.id - b.id);
    const yields = new Map();
    for (const b of mine) {
      const active = st.connected[b.cell] && !(b.disabled >= st.round + 1);
      const y = buildingYield(st, b, around); yields.set(b, { y, active });
      if (active) total.food += y.food;
    }
    const upkeep = st.units.filter(u => u.owner === id).reduce((s, u) => s + UNITS[u.type].upkeep, 0);
    let avail = (p ? p.res.food : 0) + total.food - upkeep, workers = 0;
    const idle = [];
    for (const b of mine) {
      const { y, active } = yields.get(b), need = BUILDINGS[b.type].upkeep || 0;
      let fed = true;
      if (active && need) { if (avail >= need) { avail -= need; workers += need; } else { fed = false; idle.push(b.id); } }
      if (active && fed) { total.mat += y.mat; total.gold += y.gold; }
      if (y.food || y.mat || y.gold || need) list.push({ building: b.id, type: b.type, cell: b.cell, active: active && fed, hungry: !fed, upkeep: need, ...y });
    }
    return { ...total, upkeep, workers, idle, net: { food: total.food - upkeep - workers, mat: total.mat, gold: total.gold }, cap, buildings: list };
  }
  function previewBuild(st, id, type, cell) {
    const before = income(st, id), saveOwner = st.owner, saveConn = st.connected;
    const fake = { id: -1, type, owner: id, cell, hp: 1, max: 1 };
    st.buildings.push(fake); computeTerritory(st);
    const after = income(st, id);
    const gained = st.owner.reduce((s, o, i) => s + (o === id && saveOwner[i] !== id ? 1 : 0), 0);
    st.buildings.pop(); st.owner = saveOwner; st.connected = saveConn;
    return { food: after.food - before.food, mat: after.mat - before.mat, gold: after.gold - before.gold, territory: gained, cap: after.cap - before.cap };
  }

  // ------------------------------------------------------------ create game

  function createGame(options = {}) {
    const players = Math.max(2, Math.min(6, options.players | 0 || DEFAULTS.players));
    const seed = String(options.seed ?? 'autohex3d');
    const rules = { ...DEFAULTS, players, maxRounds: options.maxRounds || DEFAULTS.maxRounds, vpTarget: options.vpTarget || VP_TARGET[players], neutrals: options.neutrals !== false, start: { ...DEFAULTS.start } };
    const map = generateMap(seed, players);
    const st = {
      v: VERSION, seed, rules, rng: hashString('play:' + seed), nextId: 1, round: 0, phase: 'plan', order: [], turnPos: 0, turn: 0,
      map: { R: map.R, terrain: map.terrain, feature: map.feature, relics: map.relics, center: map.center },
      players: [], buildings: [], units: [], traps: [], market: { deck: [], row: [], discard: [] },
      owner: [], connected: [], log: [], battle: null, winner: 0, result: null, actions: 0
    };
    const names = options.names || [];
    map.capitals.forEach((cell, k) => {
      const id = k + 1;
      const deck = shuffle(st, STARTING_DECK.map(kind => ({ id: st.nextId++, k: kind })));
      st.players.push({ id, name: names[k] || NAMES[k], alive: true, res: { ...rules.start }, vp: 0, deck, hand: [], discard: [], trashed: 0, ap: 0,
        recruited: [], buffs: {}, reveal: [], intel: {}, vpLog: [], stats: { built: 0, recruited: 0, razed: 0, lost: 0, kills: 0, bought: 0 } });
      st.buildings.push({ id: st.nextId++, type: 'capital', owner: id, cell, hp: BUILDINGS.capital.hp, max: BUILDINGS.capital.hp, armor: 0, disabled: 0, built: 0 });
    });
    // market deck
    const md = []; for (const [k, n] of Object.entries(MARKET_COPIES)) for (let i = 0; i < n; i++) md.push({ id: st.nextId++, k });
    st.market.deck = shuffle(st, md);
    refillMarket(st);
    // neutral guards on relics
    if (rules.neutrals) {
      const g = geometry(map.R);
      for (const relic of map.relics) {
        // the centre has one ancient guardian; each outer relic a sentinel on it and
        // one on its inward neighbour (on the mirror axis, so no seat is closer)
        if (relic === map.center) { st.units.push(newUnit(st, 'guardian', 0, relic, { stance: 'guard', anchor: relic })); continue; }
        const inward = g.adj[relic].find(j => g.dist(j, map.center) === g.dist(relic, map.center) - 1 && TERRAIN[map.terrain[j]].pass);
        for (const cell of [relic, inward]) if (cell !== undefined) st.units.push(newUnit(st, 'sentinel', 0, cell, { stance: 'guard', anchor: relic }));
      }
    }
    computeTerritory(st);
    startRound(st);
    return st;
  }
  function newUnit(st, type, owner, cell, extra = {}) {
    const d = UNITS[type];
    return { id: st.nextId++, type, owner, cell, hp: d.hp, max: d.hp, stance: 'guard', goal: -1, anchor: cell, born: st.round, ...extra };
  }
  function refillMarket(st) {
    const m = st.market;
    while (m.row.length < st.rules.marketSize) {
      if (!m.deck.length) { if (!m.discard.length) break; m.deck = shuffle(st, m.discard); m.discard = []; }
      m.row.push(m.deck.pop());
    }
  }

  // ----------------------------------------------------------- round & turn

  function startRound(st) {
    st.round++;
    if (st.round > 1 && st.market.row.length) { st.market.discard.push(st.market.row.shift()); refillMarket(st); }
    computeTerritory(st);
    for (const p of alivePlayers(st)) {
      const inc = income(st, p.id), cap = resCap(st, p.id);
      // food upkeep (units, then building workers) is paid before the storage cap applies
      const gross = { food: inc.food - inc.upkeep - inc.workers, mat: inc.mat, gold: inc.gold };
      for (const k of RES) {
        const v = p.res[k] + gross[k];
        if (v > cap && gross[k] > 0) { const w = Math.min(gross[k], v - Math.max(cap, p.res[k])); p.stats.wasted = (p.stats.wasted || 0) + w; p.stats['wasted_' + k] = (p.stats['wasted_' + k] || 0) + w; }
        p.res[k] = gross[k] > 0 ? Math.max(p.res[k], Math.min(cap, v)) : v;
      }
      for (const b of st.buildings) if (b.owner === p.id) b.hungry = inc.idle.includes(b.id);
      for (const bid of inc.idle) { const b = st.buildings.find(x => x.id === bid); event(st, { e: 'hungry', player: p.id, building: bid, cell: b.cell }); }
      // unfed units starve, newest first
      if (p.res.food < 0) {
        let deficit = -p.res.food; p.res.food = 0;
        const mine = st.units.filter(u => u.owner === p.id).sort((a, b) => b.id - a.id);
        for (const u of mine) { if (deficit <= 0) break; deficit -= UNITS[u.type].upkeep; u.hp -= 3; event(st, { e: 'starve', player: p.id, unit: u.id, cell: u.cell }); }
        st.units = st.units.filter(u => u.hp > 0);
      }
      p.reveal = p.reveal.filter(r => r.until >= st.round);
      train(st, p);
    }
    const alive = alivePlayers(st).map(p => p.id);
    // snake order: even rounds reverse the previous round, and the start seat
    // rotates every two rounds, so first/last positions are shared evenly
    const shift = Math.floor((st.round - 1) / 2) % alive.length;
    st.order = [...alive.slice(shift), ...alive.slice(0, shift)];
    if (st.round % 2 === 0) st.order.reverse();
    st.turnPos = 0;
    st.phase = 'plan';
    beginTurn(st);
  }
  function ownsCard(p, k) { return k === 'militia' || [...p.deck, ...p.hand, ...p.discard].some(c => c.k === k); }
  function trainError(st, id, b, type) {
    if (!b || b.owner !== id || (b.type !== 'barracks' && b.type !== 'workshop' && b.type !== 'capital')) return '只有都城、兵營或工坊能設定訓練';
    if (type === null) return null;
    const d = UNITS[type]; if (!d || d.neutral) return '未知兵種';
    if (b.type === 'workshop' && type !== 'catapult') return '工坊只訓練投石車';
    if (b.type !== 'workshop' && type === 'catapult') return '投石車須在工坊訓練';
    if (!ownsCard(P(st, id), type)) return '牌組裡要有這種兵牌才能訓練';
    return null;
  }
  function train(st, p) {
    for (const b of st.buildings.filter(x => x.owner === p.id && x.train)) {
      const times = b.type === 'barracks' && lvl(b) >= 2 ? 2 : 1;
      for (let k = 0; k < times; k++) {
        if (!st.connected[b.cell] || b.disabled >= st.round || b.hungry) break;
        if (st.units.filter(u => u.owner === p.id).length >= st.rules.popCap) break;
        if (trainError(st, p.id, b, b.train)) break;
        const cost = CARDS[b.train].cost; if (!canPay(p.res, cost)) { event(st, { e: 'train-skip', player: p.id, cell: b.cell, unit: b.train }); break; }
        const at = spawnCell(st, b); if (at < 0) break;
        pay(p.res, cost);
        const u = newUnit(st, b.train, p.id, at, { stance: 'guard', anchor: at });
        st.units.push(u); p.stats.recruited++;
        event(st, { e: 'train', player: p.id, cell: b.cell, unit: u.id, type: u.type, at });
      }
    }
  }
  function upgradeError(st, id, cell) {
    const b = cell >= 0 ? buildingAt(st, cell) : null, p = P(st, id);
    if (!b || b.owner !== id) return '須是己方建築';
    const steps = UPGRADES[b.type]; if (!steps) return BUILDINGS[b.type].name + '不能升級';
    const next = steps[lvl(b) - 1]; if (!next) return '已是最高等級';
    if (!st.connected[cell]) return '與都城斷聯的建築不能升級';
    if (!canPay(p.res, next.cost)) return '資源不足';
    return null;
  }
  function draw(st, p, n) {
    for (let k = 0; k < n; k++) {
      if (!p.deck.length) { if (!p.discard.length) return; p.deck = shuffle(st, p.discard); p.discard = []; }
      p.hand.push(p.deck.pop());
    }
  }
  function beginTurn(st) {
    const id = st.order[st.turnPos]; st.turn = id;
    const p = P(st, id);
    p.ap = apOf(st, id); p.recruited = [];
    draw(st, p, Math.max(0, handSizeOf(st, id) - p.hand.length));
  }
  function endTurn(st, p, keep) {
    const kept = [];
    if (keep !== undefined && keep !== null) {
      const ids = Array.isArray(keep) ? keep : [keep];
      for (const cid of ids.slice(0, st.rules.keep)) { const k = p.hand.findIndex(c => c.id === cid); if (k >= 0) kept.push(p.hand.splice(k, 1)[0]); }
    }
    p.discard.push(...p.hand); p.hand = kept;
    st.turnPos++;
    while (st.turnPos < st.order.length && !P(st, st.order[st.turnPos]).alive) st.turnPos++;
    if (st.turnPos >= st.order.length) { st.turn = 0; resolveRound(st); }
    else beginTurn(st);
  }

  // -------------------------------------------------------------- legality

  function placementError(st, id, type, cell) {
    const d = BUILDINGS[type], T = st.map.terrain, g = geo(st);
    if (cell < 0) return '格子不存在';
    if (st.owner[cell] !== id) return '只能建在己方領土';
    if (!TERRAIN[T[cell]].build) return TERRAIN[T[cell]].name + '不能建築';
    if (buildingAt(st, cell)) return '此格已有建築';
    const u = unitAt(st, cell); if (u && u.owner !== id) return '敵軍占據此格';
    if (d.onFeature && st.map.feature[cell] !== d.onFeature) return d.name + '只能建在' + FEATURE[d.onFeature] + '上';
    if (d.on && !d.on.includes(T[cell])) return d.name + '只能建在' + d.on.map(t => TERRAIN[t].name).join('／');
    if (d.needAdj && !g.adj[cell].some(j => d.needAdj.includes(T[j]))) return d.name + '必須相鄰森林';
    if (d.mineSite && !(T[cell] === 'hill' || g.adj[cell].some(j => T[j] === 'mountain' || T[j] === 'hill' || T[j] === 'pass'))) return '礦場須建在丘陵或相鄰山丘';
    if (d.limit && st.buildings.filter(b => b.owner === id && b.type === type).length >= d.limit) return d.name + '已達上限 ' + d.limit;
    return null;
  }
  function spawnCell(st, b) {
    if (!unitAt(st, b.cell)) return b.cell;
    const g = geo(st);
    let best = -1, bt = 0;
    for (const j of g.adj[b.cell]) if (TERRAIN[st.map.terrain[j]].pass && !unitAt(st, j) && !(buildingAt(st, j) && buildingAt(st, j).owner !== b.owner)) {
      const t = mix32(b.id * 977 + j * 131 + st.nextId); if (best < 0 || t < bt) { best = j; bt = t; }
    }
    return best;
  }
  function recruitError(st, id, type, cell) {
    const d = UNITS[type], b = buildingAt(st, cell), p = P(st, id);
    if (!b || b.owner !== id || !BUILDINGS[b.type].recruit) return '須在己方都城、兵營或工坊徵召';
    if (d.from && b.type !== d.from) return d.name + '只能在工坊徵召';
    if (!st.connected[b.cell]) return '此建築與都城斷聯';
    if (p.recruited.includes(cell)) return '這座建築本回合已徵召';
    if (st.units.filter(u => u.owner === id).length >= st.rules.popCap) return '部隊已達上限 ' + st.rules.popCap;
    if (spawnCell(st, b) < 0) return '周圍沒有空位';
    return null;
  }
  const visibleTo = (st, id) => visibleSet(st, id);
  function nearOwn(st, id, cell, r) {
    const g = geo(st);
    return st.units.some(u => u.owner === id && g.dist(u.cell, cell) <= r) || st.buildings.some(b => b.owner === id && g.dist(b.cell, cell) <= r);
  }
  function tacticError(st, id, key, cell, vis) {
    const T = st.map.terrain, g = geo(st), card = CARDS[key];
    const adjOwn = c => g.adj[c].some(j => st.owner[j] === id) || st.owner[c] === id;
    const enemyB = c => { const b = buildingAt(st, c); return b && b.owner !== id ? b : null; };
    switch (card.target) {
      case undefined: return null;
      case 'any': return cell >= 0 ? null : '需要目標格';
      case 'enemy-near': {
        if (cell < 0 || !vis[cell]) return '目標必須可見';
        const u = unitAt(st, cell), b = buildingAt(st, cell);
        if (!((u && u.owner !== id) || (b && b.owner !== id))) return '目標必須是敵方部隊或建築';
        if (!nearOwn(st, id, cell, 2)) return '目標須在己方部隊或建築 2 格內';
        return null;
      }
      case 'own-empty':
        if (cell < 0 || st.owner[cell] !== id) return '只能埋伏在己方領土';
        if (!TERRAIN[T[cell]].pass || buildingAt(st, cell)) return '須是可通行的空地';
        if (st.traps.some(t => t.cell === cell)) return '此格已有伏兵';
        if (st.traps.filter(t => t.owner === id).length >= 3) return '伏兵最多 3 處';
        return null;
      case 'enemy-building': return cell >= 0 && vis[cell] && enemyB(cell) && enemyB(cell).owner ? null : '目標必須是可見的敵方建築';
      case 'enemy-building-adj': {
        const b = cell >= 0 && vis[cell] ? enemyB(cell) : null;
        if (!b || !b.owner) return '目標必須是可見的敵方建築';
        if (!st.units.some(u => u.owner === id && g.dist(u.cell, cell) <= 1)) return '須有己方部隊相鄰';
        return null;
      }
      case 'water-adj': return cell >= 0 && T[cell] === 'water' && adjOwn(cell) ? null : '須是己方領土旁的水域';
      case 'mountain-adj': return cell >= 0 && T[cell] === 'mountain' && adjOwn(cell) ? null : '須是己方領土旁的山脈';
      case 'own-forest': return cell >= 0 && T[cell] === 'forest' && st.owner[cell] === id && !buildingAt(st, cell) ? null : '須是己方領土內無建築的森林';
      case 'own-building': { const b = cell >= 0 ? buildingAt(st, cell) : null; return b && b.owner === id ? (key === 'repair' && b.hp >= b.max ? '建築耐久已滿' : null) : '須是己方建築'; }
      default: return '未知目標';
    }
  }

  function playError(st, id, action, vis) {
    const p = P(st, id), card = p.hand.find(c => c.id === action.card);
    if (!card) return '手牌中沒有這張牌';
    const def = CARDS[card.k];
    if (def.kind === 'vp') return def.name + '不能打出，只能變賣或保留';
    if ((def.ap || 0) > p.ap) return '指令點不足';
    if (!canPay(p.res, cardCost(st, id, card.k))) return '資源不足';
    const cell = action.target === undefined ? -1 : cellRef(st, action.target);
    if (def.kind === 'build') return placementError(st, id, def.build, cell);
    if (def.kind === 'unit') return recruitError(st, id, def.unit, cell);
    if (def.kind === 'tactic') return tacticError(st, id, card.k, cell, vis || visibleTo(st, id));
    if (card.k === 'purge') {
      const t = action.targets || [];
      if (!Array.isArray(t) || t.length < 1 || t.length > 2) return '整編需選 1–2 張其他手牌';
      if (t.some(x => x === card.id || !p.hand.some(c => c.id === x)) || new Set(t).size !== t.length) return '整編目標必須是其他手牌';
    }
    return null;
  }

  // ----------------------------------------------------------------- effects

  function applyPlay(st, id, action, events) {
    const p = P(st, id), k = p.hand.findIndex(c => c.id === action.card), card = p.hand[k], def = CARDS[card.k];
    const cell = action.target === undefined ? -1 : cellRef(st, action.target), g = geo(st);
    p.hand.splice(k, 1); p.discard.push(card);
    p.ap -= def.ap || 0; pay(p.res, cardCost(st, id, card.k));
    const cap = resCap(st, id), gain = (r, n) => { p.res[r] = Math.min(Math.max(cap, p.res[r]), p.res[r] + n); };
    const e = { e: 'play', player: id, card: card.k, cell };
    switch (card.k) {
      case 'tax': gain('gold', 2); break;
      case 'survey': gain('mat', 2); break;
      case 'treasury': gain('gold', 4); break;
      case 'harvest': gain('food', 2 + Math.min(3, st.buildings.filter(b => b.owner === id && b.type === 'farm').length)); break;
      case 'trade': gain('gold', 2 + Math.min(3, st.buildings.filter(b => b.owner === id && b.type === 'market').length)); break;
      case 'mobilize': p.ap += 2; break;
      case 'scheme': draw(st, p, 2); break;
      case 'purge': for (const t of action.targets) { const j = p.hand.findIndex(c => c.id === t); if (j >= 0) { p.hand.splice(j, 1); p.trashed++; } } e.removed = action.targets.length; break;
      case 'rally': p.buffs.rally = st.round; break;
      case 'entrench': p.buffs.entrench = st.round; break;
      case 'march': p.buffs.march = st.round; break;
      case 'recon': p.reveal.push({ cell, r: 3, until: st.round + 1 }); break;
      case 'ambush': st.traps.push({ owner: id, cell, placed: st.round }); e.hidden = true; break;
      case 'bridge': st.map.terrain[cell] = 'bridge'; break;
      case 'tunnel': st.map.terrain[cell] = 'pass'; break;
      case 'clearing': st.map.terrain[cell] = 'plain'; gain('mat', 2); break;
      case 'repair': { const b = buildingAt(st, cell); b.hp = b.max; break; }
      case 'fortify': { const b = buildingAt(st, cell); b.armor = (b.armor || 0) + 1; b.max += 6; b.hp += 6; break; }
      case 'sabotage': { const b = buildingAt(st, cell); b.disabled = st.round + 1; e.target = b.id; break; }
      case 'plunder': { const b = buildingAt(st, cell), victim = P(st, b.owner), n = Math.min(3, victim.res.gold); victim.res.gold -= n; gain('gold', n); e.amount = n; e.victim = victim.id; break; }
      case 'firearrows': {
        const u = unitAt(st, cell), b = buildingAt(st, cell);
        const tgt = u && u.owner !== id ? u : b;
        const kind = tgt === u ? 'unit' : 'building';
        const armor = kind === 'unit' ? UNITS[u.type].armor : BUILDINGS[b.type].armor + (b.armor || 0);
        const dmg = Math.max(1, 4 - armor); tgt.hp -= dmg; e.dmg = dmg; e.kind = kind;
        if (tgt.hp <= 0) { if (kind === 'unit') killUnit(st, u, id, events); else razeBuilding(st, b, id, events); }
        break;
      }
      default: break;
    }
    if (def.kind === 'build') {
      const bd = BUILDINGS[def.build];
      const b = { id: st.nextId++, type: def.build, owner: id, cell, hp: bd.hp, max: bd.hp, armor: 0, disabled: 0, built: st.round };
      st.buildings.push(b); p.stats.built++; e.building = b.id;
      const trap = st.traps.findIndex(t => t.cell === cell); if (trap >= 0 && st.traps[trap].owner !== id) st.traps.splice(trap, 1);
      computeTerritory(st);
    }
    if (def.kind === 'unit') {
      const b = buildingAt(st, cell), at = spawnCell(st, b);
      const u = newUnit(st, def.unit, id, at, { stance: 'guard', anchor: at });
      st.units.push(u); p.recruited.push(cell); p.stats.recruited++; e.unit = u.id; e.at = at;
    }
    events.push(e); event(st, e);
  }

  function killUnit(st, u, by, events) {
    st.units = st.units.filter(x => x !== u);
    if (by && P(st, by)) P(st, by).stats.kills++;
    const e = { e: 'die', unit: u.id, type: u.type, owner: u.owner, cell: u.cell, by }; events.push(e); event(st, e);
  }
  function razeBuilding(st, b, by, events) {
    st.buildings = st.buildings.filter(x => x !== b);
    const e = { e: 'raze', building: b.id, type: b.type, owner: b.owner, cell: b.cell, by };
    if (by && P(st, by)) {
      const attacker = P(st, by);
      attacker.vp += b.type === 'capital' ? 5 : 1; attacker.stats.razed++;
      attacker.res.gold = Math.min(Math.max(resCap(st, by), attacker.res.gold), attacker.res.gold + 2);
      attacker.vpLog.push({ round: st.round, source: b.type === 'capital' ? 'capital' : 'raze', vp: b.type === 'capital' ? 5 : 1 });
    }
    if (b.owner) P(st, b.owner).stats.lost++;
    events.push(e); event(st, e);
    if (b.type === 'capital') eliminate(st, b.owner, by, events);
    computeTerritory(st);
  }
  function eliminate(st, id, by, events) {
    const p = P(st, id); if (!p.alive) return;
    p.alive = false;
    st.buildings = st.buildings.filter(b => b.owner !== id);
    st.units = st.units.filter(u => u.owner !== id);
    st.traps = st.traps.filter(t => t.owner !== id);
    const e = { e: 'eliminated', player: id, by }; events.push(e); event(st, e);
  }

  // ----------------------------------------------------------------- battle

  function moveCost(st, cell) { return TERRAIN[st.map.terrain[cell]].move; }
  function distanceField(st, owner, goal) {
    const g = geo(st), dist = new Float64Array(g.count).fill(Infinity);
    const blockers = new Map(); for (const b of st.buildings) if (b.owner !== owner) blockers.set(b.cell, b);
    dist[goal] = 0; const open = [goal];
    // small graphs: a simple bucketed Dijkstra is plenty
    while (open.length) {
      let bi = 0; for (let k = 1; k < open.length; k++) if (dist[open[k]] < dist[open[bi]]) bi = k;
      const cur = open[bi]; open[bi] = open[open.length - 1]; open.pop();
      for (const j of g.adj[cur]) {
        if (!TERRAIN[st.map.terrain[j]].pass) continue;
        const step = moveCost(st, cur === goal ? j : cur) + (blockers.has(j) ? 8 : 0);
        const d = dist[cur] + step;
        if (d < dist[j]) { if (dist[j] === Infinity) open.push(j); dist[j] = d; }
      }
    }
    return dist;
  }
  function unitRange(st, u) { const d = UNITS[u.type]; return d.range + (d.range >= 2 && st.map.terrain[u.cell] === 'hill' ? 1 : 0); }
  function buildingRange(st, b) { const a = bAttack(st, b); return a ? a.range + (st.map.terrain[b.cell] === 'hill' ? 1 : 0) : 0; }
  function hostile(a, b) { return a !== b; }

  function damageTo(st, attacker, aKind, target, tKind) {
    let atk, bonus = 0;
    if (aKind === 'unit') {
      const d = UNITS[attacker.type]; atk = d.atk;
      if (attacker.owner && P(st, attacker.owner).buffs.rally === st.round) atk += 1;
      if (tKind === 'building' && d.vsBuilding) atk = d.vsBuilding;
      if (tKind === 'unit' && d.bonus) for (const tag of UNITS[target.type].tags) bonus = Math.max(bonus, d.bonus[tag] || 0);
    } else atk = bAttack(st, attacker).atk;
    let armor;
    if (tKind === 'unit') {
      armor = UNITS[target.type].armor + TERRAIN[st.map.terrain[target.cell]].cover;
      const home = buildingAt(st, target.cell); if (home && home.owner === target.owner) armor += 1;
      if (target.owner && P(st, target.owner).buffs.entrench === st.round && st.owner[target.cell] === target.owner) armor += 1;
    } else {
      armor = BUILDINGS[target.type].armor + (target.armor || 0);
      if (target.owner && P(st, target.owner).buffs.entrench === st.round) armor += 1;
    }
    return Math.max(1, atk + bonus - armor);
  }

  function chooseTarget(st, src, kind, enemiesU, enemiesB, allowBuildings) {
    const g = geo(st), range = kind === 'unit' ? unitRange(st, src) : buildingRange(st, src);
    const prefersBuildings = kind === 'unit' && UNITS[src.type].vsBuilding;
    let best = null, bestScore = -Infinity;
    const consider = (t, tKind) => {
      const d = g.dist(src.cell, t.cell); if (d > range) return;
      const dmg = damageTo(st, src, kind, t, tKind);
      let score = (dmg >= t.hp ? 1000 : 0) + dmg * 20 - t.hp - d * 2 - mix32(src.id * 7919 + t.id) / 4294967296 * 1e-3;
      if (tKind === 'building') score += prefersBuildings ? 500 : -400;
      if (score > bestScore) { bestScore = score; best = { t, tKind, dmg }; }
    };
    for (const u of enemiesU) if (hostile(u.owner, src.owner)) consider(u, 'unit');
    if (allowBuildings) for (const b of enemiesB) if (hostile(b.owner, src.owner)) consider(b, 'building');
    return best;
  }

  function unitGoal(st, u) {
    const g = geo(st);
    if (u.stance === 'hold') return -1;
    if (u.stance === 'advance' && u.goal >= 0) return u.goal;
    // guard: intercept the nearest hostile unit near the anchor, otherwise return to it
    const leash = u.owner ? 3 : 2;
    let best = -1, bd = Infinity;
    for (const e of st.units) {
      if (!hostile(e.owner, u.owner)) continue;
      const da = g.dist(e.cell, u.anchor); if (da > leash) continue;
      const d = g.dist(e.cell, u.cell) + mix32(u.id * 31 + e.id) / 4294967296 * 0.5; if (d < bd) { bd = d; best = e.cell; }
    }
    return best >= 0 ? best : u.anchor;
  }

  // A relic scores for the territory owner only while no hostile unit stands on
  // or next to it, so guardians and raiders both deny it.
  function relicHeld(st, id, cell) {
    if (st.owner[cell] !== id) return false;
    const g = geo(st);
    return !st.units.some(u => u.owner !== id && g.dist(u.cell, cell) <= 1);
  }
  function resolveRound(st) {
    st.phase = 'battle';
    const events = [], frames = [];
    const g = geo(st);
    const order = new Map(st.order.map((id, k) => [id, k]));
    const nOrder = Math.max(1, st.order.length);
    const rank = (owner, k) => order.has(owner) ? (order.get(owner) + k) % nOrder : 99;
    const unitOrder = k => [...st.units].sort((a, b) => rank(a.owner, k) - rank(b.owner, k) || a.id - b.id);
    for (const u of st.units) { u.spent = 0; u.blocked = false; }
    for (let k = 1; k <= SUBTICKS; k++) {
      const fe = [];
      // 1. attacks, simultaneous
      const hits = [];
      const engaged = new Set();
      for (const u of st.units) {
        const d = UNITS[u.type];
        const goalB = u.stance === 'advance' && u.goal >= 0 ? u.goal : -1;
        const nearGoal = b => goalB >= 0 && g.dist(b.cell, goalB) <= 1;
        const buildingsInPlay = st.buildings.filter(b => hostile(b.owner, u.owner) && (u.stance !== 'advance' || nearGoal(b) || u.blocked || d.vsBuilding || !u.owner));
        const t = chooseTarget(st, u, 'unit', st.units, buildingsInPlay, true);
        if (!t) continue;
        engaged.add(u.id);
        if ((k - 1) % d.cd === 0) hits.push({ src: u, kind: 'unit', ...t });
      }
      for (const b of st.buildings) {
        const d = bAttack(st, b); if (!d || b.disabled >= st.round || b.hungry) continue;
        if ((k - 1) % d.cd !== 0) continue;
        const t = chooseTarget(st, b, 'building', st.units, [], false);
        if (t) hits.push({ src: b, kind: 'building', ...t });
      }
      for (const h of hits) {
        h.t.hp -= h.dmg;
        fe.push({ e: 'hit', src: h.src.id, srcKind: h.kind, owner: h.src.owner, srcType: h.src.type, from: h.src.cell, dst: h.t.id, dstKind: h.tKind, to: h.t.cell, dmg: h.dmg, ranged: g.dist(h.src.cell, h.t.cell) > 1 });
      }
      for (const h of hits) {
        if (h.t.hp > 0) continue;
        if (h.tKind === 'unit' && st.units.includes(h.t)) killUnit(st, h.t, h.src.owner, fe);
        else if (h.tKind === 'building' && st.buildings.includes(h.t)) razeBuilding(st, h.t, h.src.owner, fe);
      }
      // 2. movement for units that are not engaged
      for (const u of unitOrder(k)) {
        if (!st.units.includes(u) || engaged.has(u.id)) { u.blocked = false; continue; }
        const goal = unitGoal(st, u); if (goal < 0 || goal === u.cell) { u.blocked = false; continue; }
        const mv = UNITS[u.type].move + (u.owner && P(st, u.owner).buffs.march === st.round ? 2 : 0);
        const budget = Math.floor(mv * k / SUBTICKS) - u.spent;
        if (budget <= 0) continue;
        const field = distanceField(st, u.owner, goal);
        // equal-length routes are broken by a hash, not by board index, so no
        // compass direction is systematically preferred
        let best = -1, bd = field[u.cell], bt = 0;
        for (const j of g.adj[u.cell]) {
          if (!TERRAIN[st.map.terrain[j]].pass || field[j] > bd || field[j] >= field[u.cell]) continue;
          if (unitAt(st, j)) continue;
          const b = buildingAt(st, j); if (b && hostile(b.owner, u.owner)) continue;
          const tb = mix32(u.id * 2654435761 + j * 40503 + st.round);
          if (best < 0 || field[j] < bd || (field[j] === bd && tb < bt)) { bd = field[j]; best = j; bt = tb; }
        }
        if (best < 0) { u.blocked = true; continue; }
        const cost = moveCost(st, best);
        if (cost > budget && !(k === SUBTICKS && u.spent === 0)) continue;
        u.spent += cost; u.blocked = false;
        fe.push({ e: 'move', unit: u.id, type: u.type, owner: u.owner, from: u.cell, to: best });
        u.cell = best;
        if (u.stance === 'advance' && u.cell === u.goal) u.goal = -1, u.stance = 'guard', u.anchor = u.cell;
        const trap = st.traps.findIndex(t => t.cell === best && hostile(t.owner, u.owner));
        if (trap >= 0) {
          const t = st.traps.splice(trap, 1)[0];
          u.hp -= 5; fe.push({ e: 'trap', cell: best, owner: t.owner, unit: u.id, dmg: 5 });
          if (u.hp <= 0) killUnit(st, u, t.owner, fe);
        }
      }
      frames.push(fe); events.push(...fe);
    }
    for (const u of st.units) { delete u.spent; delete u.blocked; }
    computeTerritory(st);
    updateIntel(st);
    // scoring
    const scoring = [];
    for (const p of alivePlayers(st)) {
      let gain = 0; const parts = [];
      for (const r of st.map.relics) if (relicHeld(st, p.id, r)) { const v = r === st.map.center ? 2 : 1; gain += v; parts.push({ source: 'relic', cell: r, vp: v }); }
      for (const b of st.buildings) if (b.owner === p.id && b.type === 'shrine' && relicHeld(st, p.id, b.cell) && st.connected[b.cell] && !(b.disabled >= st.round)) {
        const v = (b.cell === st.map.center ? 2 : 1) + (lvl(b) >= 2 ? 1 : 0);
        gain += v; parts.push({ source: 'shrine', cell: b.cell, vp: v });
      }
      p.vp += gain; if (gain) p.vpLog.push({ round: st.round, source: 'round', vp: gain });
      scoring.push({ player: p.id, gain, parts });
    }
    for (const p of st.players) { p.buffs = {}; }
    st.battle = { round: st.round, frames, scoring };
    event(st, { e: 'round', scoring: scoring.map(s => ({ player: s.player, gain: s.gain })) });
    // end conditions
    const alive = alivePlayers(st);
    const top = alive.map(p => ({ id: p.id, vp: totalVp(st, p.id), land: st.owner.filter(o => o === p.id).length })).sort((a, b) => b.vp - a.vp || b.land - a.land || a.id - b.id);
    let reason = null;
    if (alive.length <= 1) reason = 'conquest';
    else if (top[0].vp >= st.rules.vpTarget) reason = 'victory points';
    else if (st.round >= st.rules.maxRounds) reason = 'round limit';
    if (reason) {
      st.phase = 'over'; st.turn = 0; st.winner = top[0] ? top[0].id : 0;
      st.result = { reason, round: st.round, standings: top.map(t => ({ ...t, name: P(st, t.id).name })) };
      event(st, { e: 'over', winner: st.winner, reason });
      return;
    }
    startRound(st);
  }

  // --------------------------------------------------------------- actions

  function act(st, id, action) {
    const events = [], roundBefore = st.round;
    if (st.phase === 'over') return { ok: false, error: '遊戲已結束', events };
    if (id !== st.turn) return { ok: false, error: '現在不是你的回合', events };
    if (!action || typeof action !== 'object') return { ok: false, error: '動作格式錯誤', events };
    const p = P(st, id);
    switch (action.type) {
      case 'play': {
        const err = playError(st, id, action); if (err) return { ok: false, error: err, events };
        applyPlay(st, id, action, events); break;
      }
      case 'sell': {
        const k = p.hand.findIndex(c => c.id === action.card); if (k < 0) return { ok: false, error: '手牌中沒有這張牌', events };
        const c = p.hand.splice(k, 1)[0]; p.discard.push(c); p.res.gold = Math.min(Math.max(resCap(st, id), p.res.gold), p.res.gold + 1);
        events.push({ e: 'sell', player: id, card: c.k }); break;
      }
      case 'buy': {
        const slot = action.slot, c = st.market.row[slot];
        if (!c) return { ok: false, error: '市場沒有這個欄位', events };
        if (p.res.gold < CARDS[c.k].price) return { ok: false, error: '金幣不足', events };
        p.res.gold -= CARDS[c.k].price; st.market.row.splice(slot, 1); p.discard.push(c); p.stats.bought++; refillMarket(st);
        const e = { e: 'buy', player: id, card: c.k }; events.push(e); event(st, e); break;
      }
      case 'order': {
        const ids = action.unit === 'all' ? st.units.filter(u => u.owner === id).map(u => u.id) : (Array.isArray(action.unit) ? action.unit : [action.unit]);
        const stance = action.stance || (action.target !== undefined && action.target !== null ? 'advance' : 'guard');
        if (!['advance', 'guard', 'hold'].includes(stance)) return { ok: false, error: '未知姿態', events };
        const cell = action.target === undefined || action.target === null ? -1 : cellRef(st, action.target);
        if (stance === 'advance' && cell < 0) return { ok: false, error: '進攻需要目標格', events };
        const units = ids.map(x => st.units.find(u => u.id === x && u.owner === id));
        if (!units.length || units.some(u => !u)) return { ok: false, error: '找不到己方部隊', events };
        for (const u of units) { u.stance = stance; u.goal = stance === 'advance' ? cell : -1; if (stance !== 'advance') u.anchor = cell >= 0 && stance === 'guard' ? cell : u.cell; }
        events.push({ e: 'order', player: id, units: units.map(u => u.id), stance, cell }); break;
      }
      case 'upgrade': {
        const cell = cellRef(st, action.target), err = upgradeError(st, id, cell); if (err) return { ok: false, error: err, events };
        const b = buildingAt(st, cell), next = UPGRADES[b.type][lvl(b) - 1];
        pay(p.res, next.cost); b.lvl = lvl(b) + 1;
        const hp = UPGRADE_HP[b.type] || 0; b.max += hp; b.hp += hp;
        computeTerritory(st);
        const e = { e: 'upgrade', player: id, cell, type: b.type, lvl: b.lvl }; events.push(e); event(st, e); break;
      }
      case 'trade': {
        const give = action.give, get = action.get, rate = tradeRate(st, id);
        if (!RES.includes(give) || !RES.includes(get) || give === get) return { ok: false, error: '交易需指定兩種不同資源', events };
        const times = Math.max(1, action.times | 0);
        if (p.res[give] < rate * times) return { ok: false, error: '需要 ' + rate * times + ' ' + give, events };
        p.res[give] -= rate * times; p.res[get] = Math.min(Math.max(resCap(st, id), p.res[get]), p.res[get] + times);
        events.push({ e: 'trade', player: id, give, get, rate, times }); break;
      }
      case 'train': {
        const cell = cellRef(st, action.target), b = cell >= 0 ? buildingAt(st, cell) : null;
        const unit = action.unit === undefined ? null : action.unit;
        const err = trainError(st, id, b, unit); if (err) return { ok: false, error: err, events };
        b.train = unit; events.push({ e: 'train-set', player: id, cell, unit }); break;
      }
      case 'end': endTurn(st, p, action.keep); events.push({ e: 'end', player: id }); break;
      default: return { ok: false, error: '未知動作：' + action.type, events };
    }
    st.actions++;
    return { ok: true, events, battle: (st.round !== roundBefore || st.phase === 'over') && st.battle && st.battle.round === roundBefore ? st.battle : null };
  }

  function legalActions(st, id, opts = {}) {
    if (st.phase === 'over' || id !== st.turn) return [];
    const p = P(st, id), out = [], vis = visibleTo(st, id), g = geo(st);
    const seenKinds = new Set();
    for (const c of p.hand) {
      const def = CARDS[c.k];
      out.push({ type: 'sell', card: c.id });
      if (def.kind === 'vp' || (def.ap || 0) > p.ap || !canPay(p.res, cardCost(st, id, c.k))) continue;
      if (opts.dedupe && seenKinds.has(c.k)) continue; seenKinds.add(c.k);
      if (def.kind === 'econ') {
        if (c.k === 'purge') { for (const o of p.hand) if (o.id !== c.id) out.push({ type: 'play', card: c.id, targets: [o.id] }); }
        else out.push({ type: 'play', card: c.id });
        continue;
      }
      if (!def.target && def.kind === 'tactic') { out.push({ type: 'play', card: c.id }); continue; }
      let cells;
      if (def.kind === 'build') cells = st.owner.map((o, i) => o === id ? i : -1).filter(i => i >= 0);
      else if (def.kind === 'unit') cells = st.buildings.filter(b => b.owner === id && BUILDINGS[b.type].recruit).map(b => b.cell);
      else if (def.target === 'any') cells = [...st.buildings.filter(b => b.owner !== id && p.intel[b.cell]).map(b => b.cell), ...st.map.relics, st.map.center].filter((v, i, a) => a.indexOf(v) === i);
      else cells = Array.from({ length: g.count }, (_, i) => i);
      for (const cell of cells) if (!playError(st, id, { card: c.id, target: cell }, vis)) out.push({ type: 'play', card: c.id, target: cell });
    }
    st.market.row.forEach((c, slot) => { if (p.res.gold >= CARDS[c.k].price) out.push({ type: 'buy', slot }); });
    const rate = tradeRate(st, id);
    for (const give of RES) if (p.res[give] >= rate) for (const get of RES) if (get !== give) out.push({ type: 'trade', give, get });
    for (const b of st.buildings) if (b.owner === id) {
      if (!upgradeError(st, id, b.cell)) out.push({ type: 'upgrade', target: b.cell });
      if (b.type === 'barracks' || b.type === 'workshop' || b.type === 'capital') for (const k of [null, ...Object.keys(UNITS)]) if (k !== (b.train || null) && !trainError(st, id, b, k)) out.push({ type: 'train', target: b.cell, unit: k });
    }
    const own = st.units.filter(u => u.owner === id);
    if (own.length) {
      const targets = new Set([...Object.keys(p.intel).map(Number), ...st.map.relics]);
      for (const u of st.units) if (u.owner !== id && vis[u.cell]) targets.add(u.cell);
      for (const t of targets) out.push({ type: 'order', unit: 'all', stance: 'advance', target: t });
      out.push({ type: 'order', unit: 'all', stance: 'guard' });
    }
    out.push({ type: 'end' });
    for (const c of p.hand) out.push({ type: 'end', keep: c.id });
    return out;
  }

  // ------------------------------------------------------------ observation

  function observe(st, id, opts = {}) {
    const p = P(st, id), vis = id ? visibleSet(st, id) : null, g = geo(st);
    const seen = i => !vis || vis[i];
    const obs = {
      v: VERSION, seed: st.seed, round: st.round, maxRounds: st.rules.maxRounds, vpTarget: st.rules.vpTarget, phase: st.phase,
      you: id, turn: st.turn, order: st.order, winner: st.winner, result: st.result,
      players: st.players.map(q => ({ id: q.id, name: q.name, alive: q.alive, vp: q.vp + cardVp(q), boardVp: q.vp,
        territory: st.owner.filter(o => o === q.id).length, buildings: st.buildings.filter(b => b.owner === q.id).length,
        units: st.units.filter(u => u.owner === q.id).length, deckSize: q.deck.length + q.hand.length + q.discard.length, handCount: q.hand.length })),
      market: st.market.row.map((c, slot) => ({ slot, card: c.id, k: c.k, price: CARDS[c.k].price })),
      marketDeck: st.market.deck.length,
      buildings: st.buildings.filter(b => b.owner === id || seen(b.cell)).map(b => ({ id: b.id, type: b.type, owner: b.owner, cell: b.cell, hp: b.hp, max: b.max, armor: BUILDINGS[b.type].armor + (b.armor || 0), lvl: lvl(b), disabled: b.disabled >= st.round, hungry: !!b.hungry, connected: !!st.connected[b.cell], ...(b.owner === id && b.train !== undefined ? { train: b.train } : {}) })),
      units: st.units.filter(u => u.owner === id || seen(u.cell)).map(u => ({ id: u.id, type: u.type, owner: u.owner, cell: u.cell, hp: u.hp, max: u.max,
        ...(u.owner === id ? { stance: u.stance, goal: u.goal, anchor: u.anchor } : {}) })),
      territory: st.owner.map((o, i) => (seen(i) ? o : (o === id ? o : null))),
      visible: vis ? Array.from(vis) : null,
      lastBattle: st.battle ? { round: st.battle.round, scoring: st.battle.scoring, frames: st.battle.frames.map(f => f.filter(e => !vis || (e.from !== undefined && seen(e.from)) || (e.to !== undefined && seen(e.to)) || (e.cell !== undefined && seen(e.cell)))) } : null
    };
    if (p) {
      Object.assign(obs, {
        ap: p.ap, res: { ...p.res }, cap: resCap(st, id), income: income(st, id), tradeRate: tradeRate(st, id), handSize: handSizeOf(st, id),
        hand: p.hand.map(c => ({ id: c.id, k: c.k, cost: cardCost(st, id, c.k) })), drawPile: p.deck.length, discard: p.discard.map(c => c.k), trashed: p.trashed,
        deckList: [...p.deck].map(c => c.k).sort(), recruited: p.recruited, traps: st.traps.filter(t => t.owner === id).map(t => t.cell),
        intel: Object.entries(p.intel).map(([cell, v]) => ({ cell: +cell, ...v })), buffs: { ...p.buffs }, reveal: p.reveal
      });
    }
    if (opts.map !== false) obs.map = { R: st.map.R, cells: g.cells.map((c, i) => ({ i, q: c.q, r: c.r, t: st.map.terrain[i], f: st.map.feature[i] })), relics: st.map.relics, center: st.map.center };
    return obs;
  }

  function catalog() { return { version: VERSION, terrain: TERRAIN, features: FEATURE, buildings: BUILDINGS, upgrades: UPGRADES, units: UNITS, cards: CARDS, startingDeck: STARTING_DECK, marketCopies: MARKET_COPIES, defaults: DEFAULTS, subticks: SUBTICKS }; }

  return {
    VERSION, TERRAIN, FEATURE, BUILDINGS, UPGRADES, UNITS, CARDS, STARTING_DECK, SUBTICKS,
    createGame, act, legalActions, observe, catalog, income, previewBuild,
    currentPlayer: st => st.phase === 'over' ? 0 : st.turn,
    totalVp, relicHeld, geometry, buildingYield, resCap, unitAt, buildingAt, placementError, recruitError, playError, upgradeError, trainError, bAttack, handSizeOf, apOf, tradeRate, cardCost,
    visibleSet, computeTerritory, distanceField, damageTo,
    clone: st => JSON.parse(JSON.stringify(st)),
    mix32, hashString,
    _internal: { generateMap, canonical, rand }
  };
});
