/* AutoHex: deterministic local campaign rules. No DOM, clock, or hidden-hand AI. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AutoHex = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const RADIUS = 18;
  const PLAYERS = Object.freeze([1, 2, 3, 4, 5, 6]);
  const RULES = Object.freeze({ range: 5, energyCap: 8, regeneration: 3,
    handCap: 5, initialHand: 5, maxStones: 96, unsuppliedTurns: 6,
    allianceRounds: 12, offerRounds: 3, offerCooldown: 8, betrayalCooldown: 18,
    betrayalEnergy: 3, betrayalScore: 4, maxAllies: 2, maxTurrets: 3,
    turretPeriod: 3, turretLife: 30, turretRange: 3, shieldTurns: 8,
    firstGoalScore: 12, repeatGoalScore: 6, holdingScore: 2, goalCooldown: 12,
    eventLimit: 96, recentActionLimit: 240, durationMs: 600000,
    suppliesCap: 6, suppliesPeriod: 3, airportRadius: 4, airportStones: 12, airportHold: 3,
    airCooldown: 6, airdropRange: 10, bombardRange: 12, fortifyAge: 31,
    neutralPeriod: 12, neutralWarningRounds: 2, neutralTargets: 2 });
  const MAX_STONES = RULES.maxStones;
  const CARD_META = Object.freeze({
    turret: Object.freeze({ label: 'Turret', cost: 4, slots: 1,
      description: 'Fortify an own stone. Fires at one nonallied enemy within 3 every 3 owner turns; lasts 30 turns. Maximum 3 turrets.' }),
    destroy: Object.freeze({ label: 'Demolition', cost: 5, slots: 1,
      description: 'Remove an enemy stone within 5. A shield absorbs one demolition. Permanent home anchors are immune.' }),
    bridge: Object.freeze({ label: 'Bridge', cost: 3, slots: 2,
      description: 'Join two existing own stones 2–5 cells apart. Carries supply. No crossing, overlap, duplication or T junction; shared endpoints are legal.' }),
    reroute: Object.freeze({ label: 'Reroute', cost: 2, slots: 3,
      description: 'Select retained bridge endpoint, old other endpoint, then new own endpoint. Reattach the bridge, obeying the same distance and collision rules.' }),
    shield: Object.freeze({ label: 'Shield', cost: 2, slots: 1,
      description: 'Protect an own non-anchor stone for 8 owner turns. Adds 2 defense and absorbs one demolition or turret shot.' }),
    exchange: Object.freeze({ label: 'Exchange', cost: 3, slots: 2,
      description: 'Swap an own ordinary stone with an adjacent empty cell or nonallied ordinary enemy. Excludes anchors, turrets and bridge endpoints. Every target must already be within own range 5.' })
  });
  const ACTION_META = Object.freeze({
    deploy: Object.freeze({ label: 'Deploy / capture', slots: 1, cost: 2,
      description: 'Place within 5 of an own stone for 2 energy (river needs a road). Capture for 4 energy with sufficient adjacent support; hills add 1 defense.' }),
    engineer: Object.freeze({ label: 'Engineer', slots: 1, cost: 2,
      description: 'Make an empty river cell passable for everyone, within own range 5.' }),
    withdraw: Object.freeze({ label: 'Withdraw', slots: 1, cost: 0,
      description: 'Withdraw an own non-anchor stone, removing its structures and recovering 1 energy.' }),
    rest: Object.freeze({ label: 'Rest', slots: 0, cost: 0,
      description: 'Recover 3 additional energy. Ends the turn.' }),
    discard: Object.freeze({ label: 'Discard', slots: 0, cost: 0,
      description: 'Recycle one card and draw a replacement. Ends the turn.' }),
    airdrop: Object.freeze({ label: 'Airdrop', slots: 2, cost: 6, supplyCost: 3, range: 10,
      description: 'Select an active own airport, then an empty passable cell within 10. Deploy a stone and turret for 6 energy and 3 supplies; shared 6-action air cooldown. Unsupported drops still retreat.' }),
    bombard: Object.freeze({ label: 'Bombard', slots: 2, cost: 7, supplyCost: 4, range: 12,
      description: 'Select an active own airport, then a nonallied non-anchor enemy within 12. Costs 7 energy and 4 supplies; shield absorbs, otherwise removes one stone. Shared 6-action air cooldown.' }),
    offer: Object.freeze({ label: 'Offer pact', slots: 0, cost: 0,
      description: 'Offer a 12-round nonaggression pact. Offer lasts 3 rounds; each faction may have at most 2 pacts.' }),
    accept: Object.freeze({ label: 'Accept pact', slots: 0, cost: 0, description: 'Accept a public incoming offer. Ends the turn.' }),
    reject: Object.freeze({ label: 'Reject offer', slots: 0, cost: 0, description: 'Reject a public incoming offer. Ends the turn.' }),
    betray: Object.freeze({ label: 'Betray pact', slots: 0, cost: 3,
      description: 'End a pact, lose 4 score and 2 reputation, and incur an 18-round diplomacy cooldown and mutual grudge. Ends the turn.' })
  });
  const CARD_TYPES = Object.freeze(Object.keys(CARD_META));
  const DECK_SIZE = CARD_TYPES.length * 16;
  const CELLS = [];
  const lookup = new Map();
  for (let q = -RADIUS; q <= RADIUS; q++) {
    for (let r = Math.max(-RADIUS, -q - RADIUS); r <= Math.min(RADIUS, -q + RADIUS); r++) {
      const i = CELLS.length;
      CELLS.push(Object.freeze({ q, r, s: -q - r, i, x: Math.sqrt(3) * (q + r / 2), y: 1.5 * r }));
      lookup.set(q + ',' + r, i);
    }
  }
  Object.freeze(CELLS);
  const COUNT = CELLS.length;
  function index(q, r) { const n = lookup.get(q + ',' + r); return n === undefined ? -1 : n; }
  function cell(value) { return Number.isInteger(value) ? CELLS[value] : value; }
  function distance(a, b) {
    a = cell(a); b = cell(b);
    return a && b ? Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs((a.s === undefined ? -a.q - a.r : a.s) - (b.s === undefined ? -b.q - b.r : b.s))) : Infinity;
  }
  const DIRS = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
  const ADJ = Object.freeze(CELLS.map(c => Object.freeze(DIRS.map(d => index(c.q + d[0], c.r + d[1])).filter(i => i >= 0))));
  const NEAR = CELLS.map(c => {
    const result = [];
    for (let dq = -5; dq <= 5; dq++) for (let dr = Math.max(-5, -dq - 5); dr <= Math.min(5, -dq + 5); dr++) {
      const i = index(c.q + dq, c.r + dr); if (i >= 0) result.push(i);
    }
    return result;
  });
  const AIRPORT_CELLS = Object.freeze([[12, 0], [0, 12], [-12, 12], [-12, 0], [0, -12], [12, -12]].map(c => index(...c)));
  const DEPOT_CELLS = Object.freeze([[10, -5], [5, 5], [-5, 10], [-10, 5], [-5, -5], [5, -10]].map(c => index(...c)));
  const FACILITY_CELLS = new Set([...AIRPORT_CELLS, ...DEPOT_CELLS]);
  function sectorOf(i) { const c = CELLS[i]; return (Math.round(Math.atan2(c.y, c.x) / (Math.PI / 3)) + 6) % 6; }
  const HOME_COORDS = [[18, -9], [9, 9], [-9, 18], [-18, 9], [-9, -9], [9, -18]];
  const AXES = ['q', 's', 'r', 'q', 's', 'r'];
  const SIGNS = [1, -1, 1, -1, 1, -1];
  const COLORS = ['#000000', '#65c7ff', '#ff9874', '#b9a0ff', '#ffc95b', '#60dbb0', '#f18ac2'];
  const PROFILES = Object.freeze([
    Object.freeze({ name: 'Vanguard', aggression: 1.15, engineering: 0.95, diplomacy: 0.7, flank: 1, outer: 0.6 }),
    Object.freeze({ name: 'Architect', aggression: 0.95, engineering: 1.2, diplomacy: 0.9, flank: -1, outer: 1.2 }),
    Object.freeze({ name: 'Sentinel', aggression: 1, engineering: 1.05, diplomacy: 1, flank: 1, outer: 1 }),
    Object.freeze({ name: 'Raider', aggression: 1.25, engineering: 0.9, diplomacy: 0.6, flank: -1, outer: 0.5 }),
    Object.freeze({ name: 'Envoy', aggression: 0.95, engineering: 1, diplomacy: 1.3, flank: 1, outer: 1.1 }),
    Object.freeze({ name: 'Pathfinder', aggression: 1.05, engineering: 1.1, diplomacy: 0.95, flank: -1, outer: 1.4 })
  ]);

  function hash(value) {
    const string = String(value); let h = 2166136261;
    for (let i = 0; i < string.length; i++) { h ^= string.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function randomSource(seed) {
    let a = hash(seed);
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function shuffle(array, random) {
    for (let i = array.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [array[i], array[j]] = [array[j], array[i]]; }
    return array;
  }
  function validCell(i) { return Number.isInteger(i) && i >= 0 && i < COUNT; }
  function inRange(state, player, i) {
    if (!validCell(i) || !PLAYERS.includes(player)) return false;
    return NEAR[i].some(j => state.board[j] === player);
  }
  function goalCell(state, player, i) {
    return validCell(i) && state.players[player] && CELLS[i][state.players[player].axis] === -state.players[player].sign * RADIUS;
  }
  function allied(state, a, b) {
    return a === b || (state.alliances || []).some(p => ((p.a === a && p.b === b) || (p.a === b && p.b === a)) && p.expiresRound > state.round);
  }
  function alliesOf(state, player) {
    return (state.alliances || []).filter(a => a.expiresRound > state.round && (a.a === player || a.b === player)).map(a => a.a === player ? a.b : a.a);
  }
  function computeSupply(state, player) {
    const supplied = new Uint8Array(COUNT);
    const home = state.players[player] && state.players[player].home;
    if (!validCell(home) || state.board[home] !== player) return supplied;
    const linked = new Map();
    for (const bridge of state.bridges || []) {
      if (bridge.owner !== player || state.board[bridge.a] !== player || state.board[bridge.b] !== player) continue;
      if (!linked.has(bridge.a)) linked.set(bridge.a, []);
      if (!linked.has(bridge.b)) linked.set(bridge.b, []);
      linked.get(bridge.a).push(bridge.b); linked.get(bridge.b).push(bridge.a);
    }
    const queue = [home]; supplied[home] = 1;
    for (let k = 0; k < queue.length; k++) {
      const i = queue[k];
      for (const j of ADJ[i]) if (!supplied[j] && state.board[j] === player) { supplied[j] = 1; queue.push(j); }
      for (const j of linked.get(i) || []) if (!supplied[j] && state.board[j] === player) { supplied[j] = 1; queue.push(j); }
    }
    return supplied;
  }
  function airportStatus(state, i, supplied) {
    const owner = state.board[i] || 0;
    if (!owner || !AIRPORT_CELLS.includes(i)) return { owner, supplied: false, cluster: 0, qualified: false };
    const connected = supplied || computeSupply(state, owner), queue = [i], seen = new Set(queue);
    for (let k = 0; k < queue.length; k++) for (const j of ADJ[queue[k]]) {
      if (!seen.has(j) && state.board[j] === owner && distance(i, j) <= RULES.airportRadius) { seen.add(j); queue.push(j); }
    }
    return { owner, supplied: !!connected[i], cluster: queue.length, qualified: !!connected[i] && queue.length >= RULES.airportStones };
  }
  function activeAirport(state, player, i) {
    const airport = (state.airports || []).find(a => a.cell === i);
    return !!airport && airport.owner === player && airport.active && airport.progress >= RULES.airportHold && airportStatus(state, i).qualified;
  }
  function cross(a, b, c) { return (b.q - a.q) * (c.r - a.r) - (b.r - a.r) * (c.q - a.q); }
  function onSegment(a, b, c) { return cross(a, b, c) === 0 && c.q >= Math.min(a.q, b.q) && c.q <= Math.max(a.q, b.q) && c.r >= Math.min(a.r, b.r) && c.r <= Math.max(a.r, b.r); }
  function sameCell(a, b) { return a.q === b.q && a.r === b.r; }
  // Axial coordinates are an affine transform of the rendered plane. Integer
  // cross products make collision checks exact, including collinear overlaps.
  function bridgeConflict(a, b, c, d) {
    a = cell(a); b = cell(b); c = cell(c); d = cell(d);
    if (!a || !b || !c || !d || sameCell(a, b) || sameCell(c, d)) return true;
    const ac = cross(a, b, c), ad = cross(a, b, d), ca = cross(c, d, a), cb = cross(c, d, b);
    if (ac === 0 && ad === 0) {
      const key = a.q !== b.q ? 'q' : 'r';
      const lo = Math.max(Math.min(a[key], b[key]), Math.min(c[key], d[key]));
      const hi = Math.min(Math.max(a[key], b[key]), Math.max(c[key], d[key]));
      if (lo > hi) return false;
      if (lo < hi) return true;
      return !(sameCell(a, c) || sameCell(a, d) || sameCell(b, c) || sameCell(b, d));
    }
    if (sameCell(a, c) || sameCell(a, d) || sameCell(b, c) || sameCell(b, d)) return false;
    return (ac * ad < 0 && ca * cb < 0) || (ac === 0 && onSegment(a, b, c)) || (ad === 0 && onSegment(a, b, d)) || (ca === 0 && onSegment(c, d, a)) || (cb === 0 && onSegment(c, d, b));
  }
  function bridgesConflict(left, right) { return bridgeConflict(left.a, left.b, right.a, right.b); }
  function bridgeIndex(state, owner, a, b) { return (state.bridges || []).findIndex(v => v.owner === owner && ((v.a === a && v.b === b) || (v.a === b && v.b === a))); }
  function bridgeLegal(state, player, a, b, omit = -1) {
    return a !== b && state.board[a] === player && state.board[b] === player && distance(a, b) >= 2 && distance(a, b) <= 5 &&
      !(state.bridges || []).some((v, k) => k !== omit && bridgeConflict(a, b, v.a, v.b));
  }
  function ordinary(state, i) {
    return !state.anchors[i] && !(state.turrets || []).some(t => t.cell === i) && !(state.bridges || []).some(b => b.a === i || b.b === i);
  }
  function adjacentCount(state, i, owner) { let n = 0; for (const j of ADJ[i]) if (state.board[j] === owner) n++; return n; }
  function combatStrength(state, player, i) {
    let attack = adjacentCount(state, i, player);
    if (attack) attack += (state.turrets || []).filter(t => t.owner === player && distance(t.cell, i) <= RULES.turretRange).length;
    const owner = state.board[i];
    const defense = 1 + (state.terrain[i] === 2 ? 1 : 0) + (state.shields[i] ? 2 : 0) + Math.min(2, Math.floor(adjacentCount(state, i, owner) / 3));
    return { attack, defense };
  }
  function actionCost(state, action) {
    if (action.type === 'deploy') return state.board[(action.cells || [])[0]] ? 4 : 2;
    return CARD_META[action.type] ? CARD_META[action.type].cost : (ACTION_META[action.type] || {}).cost || 0;
  }
  function legalAction(state, action) {
    if (!state || state.phase !== 'running' || !action || typeof action.type !== 'string') return false;
    const p = state.turn, player = state.players[p];
    if (!player || (state.observer !== undefined && state.observer !== p)) return false;
    const type = action.type, meta = CARD_META[type] || ACTION_META[type];
    if (!meta) return false;
    const cells = action.cells === undefined ? [] : action.cells;
    if (!Array.isArray(cells) || cells.length !== meta.slots || cells.some(i => !validCell(i))) return false;
    if (new Set(cells).size !== cells.length) return false;
    const airAction = type === 'airdrop' || type === 'bombard';
    if (!airAction && cells.some(i => !inRange(state, p, i))) return false;
    const hand = state.hand || (state.hands && state.hands[p]) || [];
    const cardIndex = action.cardIndex === undefined ? hand.indexOf(type) : action.cardIndex;
    if (CARD_META[type] && (!Number.isInteger(cardIndex) || hand[cardIndex] !== type)) return false;
    if (player.energy < actionCost(state, action)) return false;
    const a = cells[0], b = cells[1], target = action.target;
    if (airAction) {
      if (!activeAirport(state, p, a) || (player.supplies || 0) < meta.supplyCost || (player.airCooldown || 0) > 0 || distance(a, b) > meta.range) return false;
      if (type === 'bombard') return !!state.board[b] && state.board[b] !== p && !state.anchors[b] && !allied(state, p, state.board[b]);
      let stones = 0; for (let i = 0; i < COUNT; i++) if (state.board[i] === p) stones++;
      return !state.board[b] && !state.anchors[b] && (state.terrain[b] !== 1 || state.roads[b]) && stones < MAX_STONES && state.turrets.filter(t => t.owner === p).length < RULES.maxTurrets;
    }
    if (type === 'rest') return true;
    if (type === 'discard') return Number.isInteger(action.cardIndex) && action.cardIndex >= 0 && action.cardIndex < hand.length;
    if (type === 'deploy') {
      const owner = state.board[a];
      if (owner === p || state.anchors[a] || (state.terrain[a] === 1 && !state.roads[a])) return false;
      let stones = 0; for (let i = 0; i < COUNT; i++) if (state.board[i] === p) stones++;
      if (stones >= MAX_STONES) return false;
      if (!owner) return true;
      if (allied(state, p, owner)) return false;
      const strength = combatStrength(state, p, a); return strength.attack > 0 && strength.attack >= strength.defense;
    }
    if (type === 'engineer') return !state.board[a] && state.terrain[a] === 1 && !state.roads[a];
    if (type === 'withdraw') return state.board[a] === p && !state.anchors[a];
    if (type === 'turret') return state.board[a] === p && !state.anchors[a] && !(state.turrets || []).some(t => t.cell === a) && (state.turrets || []).filter(t => t.owner === p).length < RULES.maxTurrets;
    if (type === 'shield') return state.board[a] === p && !state.anchors[a] && !state.shields[a];
    if (type === 'destroy') return !!state.board[a] && state.board[a] !== p && !state.anchors[a] && !allied(state, p, state.board[a]);
    if (type === 'bridge') return bridgeLegal(state, p, a, b);
    if (type === 'reroute') {
      const old = bridgeIndex(state, p, a, b);
      return old >= 0 && state.board[b] === p && bridgeLegal(state, p, a, cells[2], old);
    }
    if (type === 'exchange') return state.board[a] === p && ordinary(state, a) && ordinary(state, b) && distance(a, b) === 1 &&
      state.board[b] !== p && (!state.board[b] || !allied(state, p, state.board[b])) && (state.terrain[b] !== 1 || state.roads[b]);
    if (!PLAYERS.includes(target) || target === p) return false;
    const incoming = (state.offers || []).some(o => o.from === target && o.to === p && o.expiresRound > state.round);
    if (type === 'reject') return incoming;
    if (type === 'betray') return allied(state, p, target);
    const other = state.players[target];
    const noRoom = alliesOf(state, p).length >= RULES.maxAllies || alliesOf(state, target).length >= RULES.maxAllies;
    const grudge = (player.grudgeUntil && player.grudgeUntil[target] || 0) > state.round || (other.grudgeUntil && other.grudgeUntil[p] || 0) > state.round;
    if (type === 'accept') return incoming && !noRoom && !grudge && !allied(state, p, target);
    if (type === 'offer') return !noRoom && !grudge && !allied(state, p, target) && (player.diplomacyUntil || 0) <= state.round &&
      !(state.offers || []).some(o => o.expiresRound > state.round && ((o.from === p && o.to === target) || (o.to === p && o.from === target)));
    return false;
  }

  class Game {
    constructor(options = {}) {
      this.durationMs = Number.isFinite(options.durationMs) && options.durationMs > 0 ? options.durationMs : RULES.durationMs;
      this.neutralEvents = options.neutralEvents !== false;
      this.reset(options.seed === undefined ? 'autohex' : options.seed, options.first === undefined ? 1 : options.first, options.rotation === undefined ? 0 : options.rotation);
    }
    reset(seed = this.seed, first = this.first, rotation = this.rotation) {
      this.seed = seed; this.first = PLAYERS.includes(first) ? first : 1;
      this.rotation = ((Number.isInteger(rotation) ? rotation : 0) % 6 + 6) % 6;
      this._random = randomSource(seed); this._neutralRandom = randomSource(seed + ':neutral-events'); this.phase = 'ready'; this.turn = this.first;
      this.ply = 0; this.round = 0; this.activeMs = 0; this.sandbox = false; this.result = null;
      this._turnStarted = false; this._offerId = 0; this._eventId = 0; this.lastAction = null;
      this.board = new Uint8Array(COUNT); this.terrain = new Uint8Array(COUNT);
      this.roads = new Uint8Array(COUNT); this.anchors = new Uint8Array(COUNT);
      this.shields = new Uint8Array(COUNT); this.unsupplied = new Uint8Array(COUNT);
      this.age = new Uint16Array(COUNT); this.fortified = new Uint8Array(COUNT);
      this.airports = AIRPORT_CELLS.map((cell, id) => ({ id, cell, owner: 0, supplied: false, cluster: 0, progress: 0, active: false }));
      this.depots = DEPOT_CELLS.map((cell, id) => ({ id, cell, owner: 0, supplied: false }));
      this.neutralWarning = null; this._neutralSector = Math.floor(this._neutralRandom() * 6); this._neutralCount = 0;
      this.bridges = []; this.turrets = []; this.offers = []; this.alliances = []; this.events = []; this.recentActions = [];
      this.players = [null]; this.hands = Array.from({ length: 7 }, () => []);
      this.drawPile = shuffle(CARD_TYPES.flatMap(type => Array(16).fill(type)), this._random); this.discardPile = [];
      this.telemetry = { actions: 0, meaningful: 0, captures: 0, destroyed: 0, supplyRetreats: 0, engineered: 0,
        cardsUsed: 0, reshuffles: 0, goalArrivals: 0, goalHoldingRounds: 0, offers: 0, alliances: 0, betrayals: 0,
        withdrawals: 0, turretShots: 0, shieldBlocks: 0, airportUnlocks: 0, airportLosses: 0, airdrops: 0, bombardments: 0,
        depotControls: 0, suppliesEarned: 0, suppliesSpent: 0, fortifications: 0, neutralWarnings: 0, neutralStrikes: 0, neutralRemoved: 0, neutralBlocks: 0,
        byType: {}, byMinute: [],
        perPlayer: Array.from({ length: 7 }, () => ({ actions: 0, captures: 0, cardsUsed: 0, goals: 0 })) };
      for (const c of CELLS) {
        let q = c.q, r = c.r, canonical = q + ',' + r;
        for (let k = 0; k < 5; k++) { const nq = -r; r = q + r; q = nq; const key = q + ',' + r; if (key < canonical) canonical = key; }
        const value = hash(seed + ':terrain:' + canonical) % 100;
        this.terrain[c.i] = value < 10 ? 1 : value < 26 ? 2 : 0;
      }
      for (const p of PLAYERS) {
        const home = index(...HOME_COORDS[p - 1]);
        const profile = PROFILES[(p - 1 + this.rotation) % 6];
        this.players[p] = { id: p, name: ['Azure', 'Ember', 'Violet', 'Gold', 'Jade', 'Rose'][p - 1], color: COLORS[p],
          home, axis: AXES[p - 1], sign: SIGNS[p - 1], score: 0, energy: 5, profile: { ...profile },
          diplomacyUntil: 0, grudgeUntil: Array(7).fill(0), reputation: 0, goalActive: false, reached: false,
          lastGoalRound: -RULES.goalCooldown, goals: 0, ownerTurns: 0, stones: 3,
          completedActions: 0, supplies: 0, airCooldown: 0, airportsActivated: 0, depotVisited: false };
        this.board[home] = p; this.anchors[home] = p;
        const inward = ADJ[home].filter(i => CELLS[i][AXES[p - 1]] * SIGNS[p - 1] === RADIUS - 1);
        for (const i of inward) this.board[i] = p;
        for (const i of NEAR[home]) if (distance(home, i) <= 2) this.terrain[i] = 0;
      }
      for (const i of FACILITY_CELLS) this.terrain[i] = 0;
      for (let k = 0; k < RULES.initialHand; k++) for (const p of PLAYERS) this._draw(p);
      this._event('ready', 0, 'Six directed routes. Hold the opposite edge; highest score after ten active minutes wins.');
      return this;
    }
    start() {
      if (this.phase !== 'ready' && this.phase !== 'paused') return false;
      this.phase = 'running'; if (!this._turnStarted) this._beginTurn(); return true;
    }
    pause() { if (this.phase !== 'running') return false; this.phase = 'paused'; return true; }
    advanceTime(deltaMs) {
      if (this.phase !== 'running' || !Number.isFinite(deltaMs) || deltaMs <= 0) return false;
      this.activeMs += deltaMs;
      if (!this.sandbox && this.activeMs >= this.durationMs) { this.activeMs = this.durationMs; this._finish(); }
      return true;
    }
    continueSandbox() {
      if (this.phase !== 'over') return false;
      this.sandbox = true; this.phase = 'running';
      this._event('sandbox', 0, 'Sandbox continues; campaign standings remain recorded.'); return true;
    }
    _finish() {
      const standings = PLAYERS.map(player => ({ player, score: this.players[player].score, name: this.players[player].name }));
      standings.sort((a, b) => b.score - a.score || a.player - b.player);
      let previous = null, rank = 0;
      standings.forEach((row, i) => { if (row.score !== previous) rank = i + 1; row.rank = rank; previous = row.score; });
      const winners = standings.filter(s => s.rank === 1).map(s => s.player);
      this.result = { winners, standings, draw: winners.length > 1, reason: 'timeout', activeMs: this.activeMs };
      this.phase = 'over'; this._event('campaign-end', 0, winners.length > 1 ? 'Campaign complete: shared first place.' : this.players[winners[0]].name + ' leads the final standings.');
    }
    _event(type, player, message, extra = {}) {
      this.events.push({ id: ++this._eventId, type, player, message, ply: this.ply, round: this.round, activeMs: this.activeMs, ...extra });
      if (this.events.length > RULES.eventLimit) this.events.splice(0, this.events.length - RULES.eventLimit);
    }
    _draw(player) {
      if (this.hands[player].length >= RULES.handCap) return;
      if (!this.drawPile.length && this.discardPile.length) {
        this.drawPile = shuffle(this.discardPile.splice(0), this._random); this.telemetry.reshuffles++;
        this._event('reshuffle', 0, 'The shared discard pile was shuffled into a new draw pile.');
      }
      if (this.drawPile.length) this.hands[player].push(this.drawPile.pop());
    }
    _remove(i) {
      if (this.anchors[i]) return false;
      this.board[i] = 0; this.shields[i] = 0; this.unsupplied[i] = 0; this.age[i] = 0; this.fortified[i] = 0;
      this.bridges = this.bridges.filter(b => b.a !== i && b.b !== i);
      this.turrets = this.turrets.filter(t => t.cell !== i); return true;
    }
    _capture(p, i, source) {
      const from = this.board[i]; this._remove(i); this.board[i] = p;
      this.players[p].score++; this.telemetry.captures++; this.telemetry.perPlayer[p].captures++;
      this._event('capture', p, this.players[p].name + ' captured a ' + this.players[from].name + ' stone.', { cells: [i], from, source });
    }
    _damage(p, i, source, origin = null) {
      if (!this.board[i] || this.board[i] === p || this.anchors[i] || allied(this, p, this.board[i])) return false;
      if (this.shields[i]) {
        this.shields[i] = 0; this.telemetry.shieldBlocks++;
        this._event('shield-block', p, 'A shield absorbed ' + source + '.', { cells: [i], from: this.board[i], source, origin }); return true;
      }
      const from = this.board[i]; this._remove(i); this.players[p].score++; this.telemetry.destroyed++;
      this._event('destroy', p, this.players[p].name + ' destroyed a ' + this.players[from].name + ' stone.', { cells: [i], from, source, origin }); return true;
    }
    _beginTurn() {
      this._turnStarted = true;
      const p = this.turn, player = this.players[p]; player.ownerTurns++;
      player.energy = Math.min(RULES.energyCap, player.energy + RULES.regeneration);
      for (let i = 0; i < COUNT; i++) if (this.board[i] === p && this.shields[i]) this.shields[i]--;
      // Resolve each owner's battery simultaneously in stable cell order. Pacts
      // are checked at the moment of firing, never silently broken by a turret.
      const firing = this.turrets.filter(t => t.owner === p).sort((a, b) => a.cell - b.cell);
      for (const turret of firing) {
        turret.life--; turret.countdown--;
        if (turret.countdown <= 0) {
          turret.countdown = RULES.turretPeriod;
          const targets = NEAR[turret.cell].filter(i => distance(turret.cell, i) <= RULES.turretRange && this.board[i] && this.board[i] !== p && !this.anchors[i] && !allied(this, p, this.board[i]));
          targets.sort((a, b) => (this.turrets.some(t => t.cell === b) ? 3 : 0) + adjacentCount(this, b, this.board[b]) -
            ((this.turrets.some(t => t.cell === a) ? 3 : 0) + adjacentCount(this, a, this.board[a])) || distance(turret.cell, a) - distance(turret.cell, b) || a - b);
          if (targets.length) { this.telemetry.turretShots++; this._damage(p, targets[0], 'turret', turret.cell); }
        }
      }
      this.turrets = this.turrets.filter(t => t.life > 0 && this.board[t.cell] === t.owner);
      this._refreshFacilities(); this._countStones();
    }
    _refreshFacilities(progressPlayer = 0) {
      const supplies = new Map();
      const connected = p => { if (!supplies.has(p)) supplies.set(p, computeSupply(this, p)); return supplies.get(p); };
      for (const airport of this.airports) {
        const previousOwner = airport.owner, wasActive = airport.active;
        const owner = this.board[airport.cell], status = airportStatus(this, airport.cell, owner ? connected(owner) : null);
        if (owner !== previousOwner || !status.qualified) airport.progress = 0;
        if (status.qualified && progressPlayer === owner) airport.progress = Math.min(RULES.airportHold, airport.progress + 1);
        Object.assign(airport, status); airport.active = status.qualified && airport.progress >= RULES.airportHold;
        if (wasActive && (!airport.active || owner !== previousOwner)) {
          this.telemetry.airportLosses++; this._event('airport-lost', previousOwner, this.players[previousOwner].name + ' lost an active airport.', { cells: [airport.cell] });
        }
        if (airport.active && (!wasActive || owner !== previousOwner)) {
          this.telemetry.airportUnlocks++; this.players[owner].airportsActivated++;
          this._event('airport-unlocked', owner, this.players[owner].name + ' activated an airport.', { cells: [airport.cell] });
        }
      }
      for (const depot of this.depots) {
        const owner = this.board[depot.cell], supplied = !!owner && !!connected(owner)[depot.cell];
        if (supplied && (!depot.supplied || owner !== depot.owner)) {
          this.telemetry.depotControls++; this.players[owner].depotVisited = true;
          this._event('depot-control', owner, this.players[owner].name + ' supplied a depot.', { cells: [depot.cell] });
        }
        depot.owner = owner; depot.supplied = supplied;
      }
    }
    _completeOwnAction(p, beforeBoard, airAction) {
      const player = this.players[p], newlyFortified = [];
      player.completedActions++;
      if (airAction) player.airCooldown = RULES.airCooldown;
      else player.airCooldown = Math.max(0, player.airCooldown - 1);
      for (let i = 0; i < COUNT; i++) {
        if (this.board[i] === p && beforeBoard[i] === p) {
          this.age[i] = Math.min(65535, this.age[i] + 1);
          if (this.age[i] >= RULES.fortifyAge && !this.fortified[i]) { this.fortified[i] = 1; if (!this.anchors[i]) newlyFortified.push(i); }
        } else if (this.board[i] !== beforeBoard[i]) { this.age[i] = 0; this.fortified[i] = 0; }
      }
      if (newlyFortified.length) {
        this.telemetry.fortifications += newlyFortified.length;
        this._event('fortified', p, this.players[p].name + ' fortified ' + newlyFortified.length + ' long-held stones against neutral events.', { cells: newlyFortified });
      }
      this._refreshFacilities(p);
      if (player.completedActions % RULES.suppliesPeriod === 0) {
        const bonus = this.depots.some(d => d.owner === p && d.supplied) ? 1 : 0;
        const gain = Math.min(RULES.suppliesCap - player.supplies, 1 + bonus);
        player.supplies += gain; this.telemetry.suppliesEarned += gain;
      }
    }
    _neutralRound() {
      if (!this.neutralEvents) return;
      if (this.neutralWarning && this.round >= this.neutralWarning.resolveRound) {
        const warning = this.neutralWarning; this.neutralWarning = null; this.telemetry.neutralStrikes++;
        for (const i of warning.cells) {
          const owner = this.board[i]; if (!owner || this.anchors[i]) continue;
          const protectedStone = this.fortified[i] || this.age[i] >= RULES.fortifyAge;
          if (protectedStone || this.shields[i]) {
            if (!protectedStone) this.shields[i] = 0;
            this.telemetry.neutralBlocks++;
            this._event('neutral-block', owner, (protectedStone ? 'A fortified stone resisted ' : 'A shield absorbed ') + warning.kind + '.',
              { cells: [i], from: owner, source: warning.kind, kind: warning.kind, sector: warning.sector, origin: null, protection: protectedStone ? 'fortification' : 'shield' });
          } else {
            this._remove(i); this.telemetry.neutralRemoved++;
            this._event('neutral-strike', 0, warning.kind + ' removed a ' + this.players[owner].name + ' stone.',
              { cells: [i], from: owner, source: warning.kind, kind: warning.kind, sector: warning.sector, origin: null });
          }
        }
        this._refreshFacilities();
      }
      if (this.round % RULES.neutralPeriod === RULES.neutralPeriod - RULES.neutralWarningRounds) {
        const sector = (this._neutralSector + this._neutralCount) % 6, kind = this._neutralCount % 2 ? 'disaster' : 'guerrilla';
        const candidates = CELLS.filter(c => sectorOf(c.i) === sector && this.board[c.i] && !this.anchors[c.i] && this.age[c.i] < RULES.fortifyAge).map(c => c.i);
        const cells = shuffle(candidates, this._neutralRandom).slice(0, RULES.neutralTargets);
        this.neutralWarning = { kind, sector, cells, resolveRound: this.round + RULES.neutralWarningRounds };
        this._neutralCount++; this.telemetry.neutralWarnings++;
        this._event('neutral-warning', 0, kind + ' warning: marked cells face danger in two rounds.', { ...this.neutralWarning, cells: cells.slice() });
      }
    }
    _settleSupply(p) {
      const supplied = computeSupply(this, p); let retreats = 0; const cells = [];
      for (let i = 0; i < COUNT; i++) if (this.board[i] === p) {
        if (supplied[i] || this.anchors[i]) this.unsupplied[i] = 0;
        else if (++this.unsupplied[i] >= RULES.unsuppliedTurns) { this._remove(i); retreats++; cells.push(i); }
      }
      if (retreats) {
        this.telemetry.supplyRetreats += retreats;
        this._event('supply-retreat', p, this.players[p].name + ' withdrew ' + retreats + ' unsupplied stone' + (retreats === 1 ? '' : 's') + '.', { count: retreats, cells });
      }
    }
    _countStones() {
      for (const p of PLAYERS) this.players[p].stones = 0;
      for (const p of this.board) if (p) this.players[p].stones++;
    }
    _roundEnd() {
      this.round++;
      this._neutralRound();
      const expiredOffers = this.offers.filter(o => o.expiresRound <= this.round);
      const expiredPacts = this.alliances.filter(a => a.expiresRound <= this.round);
      this.offers = this.offers.filter(o => o.expiresRound > this.round);
      this.alliances = this.alliances.filter(a => a.expiresRound > this.round);
      for (const offer of expiredOffers) this._event('offer-expired', offer.from, 'An unanswered pact offer expired.', { target: offer.to });
      for (const pact of expiredPacts) this._event('alliance-expired', pact.a, 'The ' + this.players[pact.a].name + '–' + this.players[pact.b].name + ' pact expired.', { target: pact.b });
      const scoring = PLAYERS.map(p => {
        const supply = computeSupply(this, p); return supply.some((value, i) => value && goalCell(this, p, i));
      });
      // All six conditions are captured before any score changes: no first-seat
      // goal win, and neither goals nor alliances terminate a campaign early.
      for (const p of PLAYERS) {
        const player = this.players[p], holds = scoring[p - 1];
        if (holds) {
          if (!player.goalActive && (!player.reached || this.round - player.lastGoalRound >= RULES.goalCooldown)) {
            const points = player.reached ? RULES.repeatGoalScore : RULES.firstGoalScore;
            player.score += points; player.lastGoalRound = this.round; player.reached = true; player.goals++;
            this.telemetry.goalArrivals++; this.telemetry.perPlayer[p].goals++;
            this._event('goal-arrival', p, player.name + ' supplied the opposite edge: +' + points + '.', { points });
          } else if (player.goalActive) {
            player.score += RULES.holdingScore; this.telemetry.goalHoldingRounds++;
            if (this.round % 5 === 0) this._event('goal-hold', p, player.name + ' continues holding its supplied opposite edge.', { points: RULES.holdingScore });
          }
        } else if (player.goalActive) this._event('goal-lost', p, player.name + ' lost its supplied opposite-edge route.');
        player.goalActive = holds;
      }
    }
    act(action) {
      if (!legalAction(this, action)) return false;
      const p = this.turn, player = this.players[p], type = action.type, cells = action.cells || [], a = cells[0], b = cells[1];
      const before = { captures: this.telemetry.captures, destroyed: this.telemetry.destroyed };
      const beforeBoard = this.board.slice(), airAction = type === 'airdrop' || type === 'bombard';
      player.energy -= actionCost(this, action);
      if (airAction) { player.supplies -= ACTION_META[type].supplyCost; this.telemetry.suppliesSpent += ACTION_META[type].supplyCost; }
      if (CARD_META[type] || type === 'discard') {
        const cardIndex = action.cardIndex === undefined ? this.hands[p].indexOf(type) : action.cardIndex;
        const [card] = this.hands[p].splice(cardIndex, 1); this.discardPile.push(card);
        if (CARD_META[type]) { this.telemetry.cardsUsed++; this.telemetry.perPlayer[p].cardsUsed++; }
      }
      if (type === 'deploy') {
        if (this.board[a]) this._capture(p, a, 'deploy'); else { this.board[a] = p; this.unsupplied[a] = 0; }
      } else if (type === 'engineer') { this.roads[a] = 1; this.telemetry.engineered++; }
      else if (type === 'withdraw') { this._remove(a); player.energy = Math.min(RULES.energyCap, player.energy + 1); this.telemetry.withdrawals++; }
      else if (type === 'rest') player.energy = Math.min(RULES.energyCap, player.energy + 3);
      else if (type === 'turret') this.turrets.push({ owner: p, cell: a, countdown: RULES.turretPeriod, life: RULES.turretLife });
      else if (type === 'destroy') this._damage(p, a, 'demolition');
      else if (type === 'airdrop') {
        this.board[b] = p; this.age[b] = 0; this.fortified[b] = 0; this.unsupplied[b] = 0; this.shields[b] = 0;
        this.turrets.push({ owner: p, cell: b, countdown: RULES.turretPeriod, life: RULES.turretLife }); this.telemetry.airdrops++;
      } else if (type === 'bombard') { this._damage(p, b, 'bombard', a); this.telemetry.bombardments++; }
      else if (type === 'shield') this.shields[a] = RULES.shieldTurns;
      else if (type === 'bridge') this.bridges.push({ owner: p, a, b });
      else if (type === 'reroute') this.bridges[bridgeIndex(this, p, a, b)] = { owner: p, a, b: cells[2] };
      else if (type === 'exchange') {
        const owner = this.board[b]; this.board[a] = owner; this.board[b] = p;
        this.shields[a] = 0; this.shields[b] = 0; this.unsupplied[a] = 0; this.unsupplied[b] = 0;
        if (owner) {
          player.score++; this.telemetry.captures++; this.telemetry.perPlayer[p].captures++;
          this._event('capture', p, player.name + ' exchanged positions with ' + this.players[owner].name + '.', { cells: [a, b], from: owner, source: 'exchange' });
        }
      } else if (type === 'offer') {
        this.offers.push({ id: ++this._offerId, from: p, to: action.target, createdRound: this.round, expiresRound: this.round + RULES.offerRounds });
        player.diplomacyUntil = this.round + RULES.offerCooldown; this.telemetry.offers++;
      } else if (type === 'accept') {
        this.offers = this.offers.filter(o => !((o.from === p && o.to === action.target) || (o.to === p && o.from === action.target)));
        this.alliances.push({ a: p, b: action.target, createdRound: this.round, expiresRound: this.round + RULES.allianceRounds });
        this.telemetry.alliances++;
      } else if (type === 'reject') this.offers = this.offers.filter(o => o.from !== action.target || o.to !== p);
      else if (type === 'betray') {
        const target = action.target;
        this.alliances = this.alliances.filter(v => !((v.a === p && v.b === target) || (v.a === target && v.b === p)));
        player.score -= RULES.betrayalScore; player.reputation -= 2;
        player.diplomacyUntil = this.round + RULES.betrayalCooldown;
        player.grudgeUntil[target] = this.round + RULES.betrayalCooldown;
        this.players[target].grudgeUntil[p] = this.round + RULES.betrayalCooldown;
        this.telemetry.betrayals++;
      }
      this.telemetry.actions++; this.telemetry.perPlayer[p].actions++;
      this.telemetry.byType[type] = (this.telemetry.byType[type] || 0) + 1;
      const meaningful = type !== 'rest' && type !== 'discard'; if (meaningful) this.telemetry.meaningful++;
      const minute = Math.min(10, Math.floor(this.activeMs / 60000));
      if (!this.telemetry.byMinute[minute]) this.telemetry.byMinute[minute] = { actions: 0, meaningful: 0, captures: 0, cardsUsed: 0 };
      const bin = this.telemetry.byMinute[minute]; bin.actions++; if (meaningful) bin.meaningful++;
      bin.captures += this.telemetry.captures - before.captures; if (CARD_META[type]) bin.cardsUsed++;
      const record = { player: p, type, cells: cells.slice(), target: action.target, ply: this.ply, round: this.round,
        activeMs: this.activeMs, captures: this.telemetry.captures - before.captures, destroyed: this.telemetry.destroyed - before.destroyed, meaningful };
      this.lastAction = record; this.recentActions.push(record);
      if (this.recentActions.length > RULES.recentActionLimit) this.recentActions.shift();
      const messages = { deploy: 'deployed a stone', engineer: 'engineered a river crossing', withdraw: 'withdrew a stone', turret: 'built a turret', shield: 'raised a shield', bridge: 'linked a bridge', reroute: 'rerouted a bridge', exchange: 'exchanged positions', offer: 'offered a pact', accept: 'accepted a pact', reject: 'rejected a pact', betray: 'broke a pact (−4 score)', discard: 'recycled a card', rest: 'rested', airdrop: 'airdropped a turret', bombard: 'launched an air bombardment' };
      if (type !== 'destroy') this._event(type, p, player.name + ' ' + messages[type] + (action.target ? ' with ' + this.players[action.target].name : '') + '.', { cells: cells.slice(), target: action.target, ...(airAction ? { origin: a, source: type } : {}) });
      this._settleSupply(p); this._completeOwnAction(p, beforeBoard, airAction); this._draw(p); this.ply++;
      if (this.ply % 6 === 0) this._roundEnd();
      this.turn = this.turn % 6 + 1; this._beginTurn(); return true;
    }
    observation(player = this.turn) {
      const supplied = new Uint8Array(COUNT), range = new Uint8Array(COUNT);
      for (const p of PLAYERS) { const own = computeSupply(this, p); for (let i = 0; i < COUNT; i++) if (own[i]) supplied[i] = 1; }
      if (PLAYERS.includes(player)) for (let i = 0; i < COUNT; i++) if (this.board[i] === player) for (const j of NEAR[i]) range[j] = 1;
      const clone = value => JSON.parse(JSON.stringify(value));
      return { observer: player, seed: this.seed, first: this.first, rotation: this.rotation, phase: this.phase, turn: this.turn,
        ply: this.ply, round: this.round, activeMs: this.activeMs, durationMs: this.durationMs, sandbox: this.sandbox,
        result: this.result && clone(this.result), board: Array.from(this.board), terrain: Array.from(this.terrain), roads: Array.from(this.roads),
        anchors: Array.from(this.anchors), shields: Array.from(this.shields), unsupplied: Array.from(this.unsupplied), supplied: Array.from(supplied), range: Array.from(range),
        age: Array.from(this.age), fortified: Array.from(this.fortified), airports: this.airports.map(a => ({ ...a })), depots: this.depots.map(d => ({ ...d })),
        neutralEvents: this.neutralEvents, neutralWarning: this.neutralWarning ? { ...this.neutralWarning, cells: this.neutralWarning.cells.slice() } : null,
        bridges: this.bridges.map(b => ({ ...b })), turrets: this.turrets.map(t => ({ ...t })), players: this.players.map(p => p && ({ ...p, profile: { ...p.profile }, grudgeUntil: p.grudgeUntil.slice() })),
        offers: this.offers.map(o => ({ ...o })), alliances: this.alliances.map(a => ({ ...a })), events: clone(this.events),
        hand: (this.hands[player] || []).slice(), handCounts: this.hands.map(h => h.length), drawCount: this.drawPile.length, discardCount: this.discardPile.length,
        telemetry: clone(this.telemetry), recentActions: clone(this.recentActions), lastAction: this.lastAction ? clone(this.lastAction) : null };
    }
  }

  // Min-heap Dijkstra over public cells. Private deck state and other hands are
  // intentionally absent from this planner's inputs and all its helper calls.
  function routeDistances(state, p, targets = null) {
    const result = new Float64Array(COUNT); result.fill(Infinity); const heap = [];
    function push(i, cost) { let k = heap.length; heap.push([i, cost]); while (k > 0) { const parent = (k - 1) >> 1; if (heap[parent][1] <= cost) break; heap[k] = heap[parent]; k = parent; } heap[k] = [i, cost]; }
    function pop() { const first = heap[0], last = heap.pop(); if (heap.length) { let k = 0; while (k * 2 + 1 < heap.length) { let child = k * 2 + 1; if (child + 1 < heap.length && heap[child + 1][1] < heap[child][1]) child++; if (heap[child][1] >= last[1]) break; heap[k] = heap[child]; k = child; } heap[k] = last; } return first; }
    const weights = new Float64Array(COUNT);
    const profile = state.players[p].profile || PROFILES[0], home = CELLS[state.players[p].home];
    for (const c of CELLS) {
      const owner = state.board[c.i];
      weights[c.i] = state.anchors[c.i] && owner !== p ? 1000 : owner === p ? 0.16 : owner ? (allied(state, p, owner) ? 8 : 3.5) : state.terrain[c.i] === 1 && !state.roads[c.i] ? 2 : 1;
      if (owner !== p && !targets) {
        const radial = Math.max(Math.abs(c.q), Math.abs(c.r), Math.abs(c.s));
        const oppositeFlank = Math.max(0, -(home.q * c.r - home.r * c.q) * (profile.flank || 1));
        weights[c.i] += Math.max(0, 10 - radial) * (profile.outer || 1) * 0.12 + oppositeFlank * 0.002;
      }
      if ((targets ? targets.includes(c.i) : goalCell(state, p, c.i)) && (!state.anchors[c.i] || owner === p)) { result[c.i] = 0; push(c.i, 0); }
    }
    const links = new Map();
    for (const b of state.bridges || []) if (b.owner === p) { if (!links.has(b.a)) links.set(b.a, []); if (!links.has(b.b)) links.set(b.b, []); links.get(b.a).push(b.b); links.get(b.b).push(b.a); }
    while (heap.length) {
      const [i, cost] = pop(); if (cost !== result[i]) continue;
      for (const j of ADJ[i]) { const candidate = cost + weights[i]; if (candidate < result[j]) { result[j] = candidate; push(j, candidate); } }
      for (const j of links.get(i) || []) { const candidate = cost + 0.12; if (candidate < result[j]) { result[j] = candidate; push(j, candidate); } }
    }
    return result;
  }
  function chooseAction(state) {
    if (!state || state.phase !== 'running' || (state.observer !== undefined && state.observer !== state.turn)) return null;
    const p = state.turn, player = state.players[p], profile = player.profile || PROFILES[0];
    const own = [], enemies = [], counts = Array(7).fill(0), nearOwn = new Uint8Array(COUNT), ownAdj = new Uint8Array(COUNT);
    const supply = computeSupply(state, p), home = CELLS[player.home];
    const closestDepot = (state.depots || []).slice().sort((a, b) => distance(player.home, a.cell) - distance(player.home, b.cell) || a.id - b.id)[0];
    const preferredAirport = (state.airports || []).slice().sort((a, b) => {
      const ac = CELLS[a.cell], bc = CELLS[b.cell];
      const flankA = (home.q * ac.r - home.r * ac.q) * (profile.flank || 1), flankB = (home.q * bc.r - home.r * bc.q) * (profile.flank || 1);
      return distance(player.home, a.cell) - distance(player.home, b.cell) || flankB - flankA;
    })[0];
    let objective = null, buildAirport = null;
    if (!player.depotVisited && closestDepot) objective = closestDepot.cell;
    else if (!player.airportsActivated && preferredAirport) {
      if (preferredAirport.owner !== p || !preferredAirport.supplied) objective = preferredAirport.cell;
      else if (preferredAirport.cluster < RULES.airportStones) { objective = preferredAirport.cell; buildAirport = preferredAirport; }
    }
    const route = routeDistances(state, p, objective === null ? null : [objective]);
    for (let i = 0; i < COUNT; i++) {
      const owner = state.board[i]; if (owner) counts[owner]++;
      if (owner === p) { own.push(i); for (const j of NEAR[i]) nearOwn[j] = 1; for (const j of ADJ[i]) ownAdj[j]++; }
    }
    for (let i = 0; i < COUNT; i++) if (nearOwn[i] && state.board[i] && state.board[i] !== p && !state.anchors[i] && !allied(state, p, state.board[i])) enemies.push(i);
    let bestRoute = Infinity;
    for (const i of own) if (supply[i]) bestRoute = Math.min(bestRoute, route[i]);
    const cards = {}; (state.hand || []).forEach((type, i) => { if (cards[type] === undefined) cards[type] = i; });
    let best = { type: 'rest', cells: [] }, bestValue = -10;
    const publicTieBreak = hash(state.seed + ':' + state.ply);
    const noise = i => ((Math.imul(i + 1, 1103515245) ^ publicTieBreak) >>> 0) % 100 / 1000;
    function consider(action, value) { if (value > bestValue && legalAction(state, action)) { best = action; bestValue = value; } }
    function card(type, cells, value) { if (cards[type] !== undefined) consider({ type, cells, cardIndex: cards[type] }, value); }
    const danger = i => { let value = 0; for (const j of NEAR[i]) if (distance(i, j) <= 3 && state.board[j] && state.board[j] !== p && !allied(state, p, state.board[j])) value++; return value; };
    const cuts = new Map(), enemySupply = new Map();
    function cutImpact(i) {
      if (cuts.has(i)) return cuts.get(i);
      const owner = state.board[i];
      if (!owner || owner === p) return 0;
      if (!enemySupply.has(owner)) enemySupply.set(owner, computeSupply(state, owner));
      const before = enemySupply.get(owner); if (!before[i]) return 0;
      const board = state.board.slice(); board[i] = 0;
      const after = computeSupply({ ...state, board }, owner); let lost = 0;
      for (let j = 0; j < COUNT; j++) if (j !== i && before[j] && !after[j]) lost++;
      cuts.set(i, lost); return lost;
    }
    const leader = PLAYERS.reduce((a, b) => state.players[b].score + counts[b] * 0.2 > state.players[a].score + counts[a] * 0.2 ? b : a, p);
    const border = new Uint16Array(7);
    for (const i of own) for (const j of ADJ[i]) if (state.board[j] && state.board[j] !== p) border[state.board[j]]++;

    for (const offer of state.offers || []) if (offer.to === p && offer.expiresRound > state.round) {
      const target = offer.from, sharedThreat = leader !== p && leader !== target;
      const favorable = sharedThreat && state.players[target].score <= player.score + 18 && target !== ((p + 2) % 6 + 1);
      consider({ type: favorable ? 'accept' : 'reject', target, cells: [] }, favorable ? 43 * profile.diplomacy : 18);
    }
    if (state.round >= 8 && (state.ply + p) % 17 < 3 && leader !== p && state.players[leader].score >= player.score + 4) {
      for (const target of PLAYERS) if (target !== p && target !== leader && border[target] > 0 && state.players[target].score < state.players[leader].score) {
        consider({ type: 'offer', target, cells: [] }, 25 * profile.diplomacy + Math.min(8, border[leader]));
      }
    }
    for (const target of alliesOf(state, p)) {
      const blocksGoal = own.some(i => ADJ[i].some(j => state.board[j] === target && route[j] < route[i] && route[i] <= 6));
      const dominantNeighbor = target === leader && state.players[target].score >= player.score + 24 && border[target] >= 3;
      if ((blocksGoal || dominantNeighbor) && state.round + 3 < (state.alliances.find(a => (a.a === p && a.b === target) || (a.a === target && a.b === p)) || {}).expiresRound) {
        consider({ type: 'betray', target, cells: [] }, 40 + Math.min(8, border[target]) + (state.players[target].goalActive ? 10 : 0));
      }
    }

    const cutCandidates = new Set(enemies.slice().sort((a, b) => adjacentCount(state, b, state.board[b]) - adjacentCount(state, a, state.board[a])).slice(0, 10));
    for (const i of enemies) {
      const owner = state.board[i], support = adjacentCount(state, i, owner);
      const threatening = state.players[owner].goalActive || goalCell(state, owner, i);
      const nearHome = distance(i, player.home) <= 5;
      const facility = FACILITY_CELLS.has(i) ? 12 : 0, disruption = cutCandidates.has(i) ? Math.min(16, cutImpact(i) * 1.2) : 0;
      const priority = 28 + ownAdj[i] * 2.2 + (threatening ? 12 : 0) + (nearHome ? 10 : 0) + (state.turrets.some(t => t.cell === i) ? 8 : 0) + facility + disruption;
      consider({ type: 'deploy', cells: [i] }, priority * profile.aggression + (supply[ADJ[i].find(j => state.board[j] === p)] ? 2 : 0) + noise(i));
      card('destroy', [i], (priority + Math.min(5, support) - (state.shields[i] ? 9 : 0) - 4) * profile.aggression + noise(i));
      if (cards.exchange !== undefined && !state.shields[i]) for (const j of ADJ[i]) if (state.board[j] === p && ownAdj[j] >= 2 && ownAdj[i] >= 2) {
        card('exchange', [j, i], priority * profile.aggression - 2 + Math.max(-3, route[j] - route[i]));
      }
    }

    // Expand one contiguous route first. Unsupplied stones may reconnect, but
    // they never masquerade as home-connected path progress in this heuristic.
    for (let i = 0; i < COUNT; i++) if (!state.board[i] && nearOwn[i] && ownAdj[i]) {
      const suppliedNeighbors = ADJ[i].filter(j => state.board[j] === p && supply[j]);
      if (!suppliedNeighbors.length) continue;
      const improvement = bestRoute - route[i];
      const nearestGoal = RADIUS + CELLS[i][player.axis] * player.sign;
      const enemyNeighbors = ADJ[i].filter(j => state.board[j] && state.board[j] !== p && !allied(state, p, state.board[j])).length;
      let value = 35 + Math.max(-15, Math.min(3, improvement)) * 14 + (goalCell(state, p, i) ? 10 : 0) - ownAdj[i] * 0.4;
      if (player.goalActive) value = 10 + enemyNeighbors * 8 + (nearestGoal <= 2 ? 8 : 0) + ownAdj[i] * 0.5;
      if (FACILITY_CELLS.has(i)) value += 8;
      if (buildAirport && distance(i, buildAirport.cell) <= RULES.airportRadius) value = Math.max(value, 58 - distance(i, buildAirport.cell) * 0.5 + ownAdj[i] * 0.3);
      value += noise(i);
      if (state.terrain[i] === 1 && !state.roads[i]) consider({ type: 'engineer', cells: [i] }, value * profile.engineering - 1);
      else consider({ type: 'deploy', cells: [i] }, value);
    }
    for (const i of own) {
      const threat = danger(i);
      if (threat) {
        card('turret', [i], 20 + Math.min(7, threat) * 3 + (supply[i] ? 3 : -10));
        card('shield', [i], 13 + Math.min(5, threat) * 2 + (goalCell(state, p, i) ? 12 : 0) + (ownAdj[i] <= 2 && supply[i] ? 5 : 0) + (FACILITY_CELLS.has(i) ? 14 : 0));
      }
      if (state.neutralWarning && state.neutralWarning.cells.includes(i) && (state.age?.[i] || 0) + state.neutralWarning.resolveRound - state.round < RULES.fortifyAge) {
        card('shield', [i], 69 + (FACILITY_CELLS.has(i) ? 10 : 0));
      }
      if (!supply[i] && cards.bridge !== undefined) for (const j of NEAR[i]) if (state.board[j] === p && supply[j]) {
        card('bridge', [i, j], 47 + (state.unsupplied[i] || 0) + Math.max(0, bestRoute - route[i]) + noise(i));
      }
    }
    if (cards.reroute !== undefined) for (const bridge of state.bridges) if (bridge.owner === p) {
      for (const [keep, old] of [[bridge.a, bridge.b], [bridge.b, bridge.a]]) if (supply[keep]) {
        for (const i of NEAR[keep]) if (state.board[i] === p && !supply[i]) card('reroute', [keep, old, i], 48 + (state.unsupplied[i] || 0));
      }
    }

    if ((player.airCooldown || 0) === 0 && (player.supplies || 0) >= 3) for (const airport of state.airports || []) if (airport.owner === p && airport.active) {
      const bombTargets = CELLS.filter(c => distance(airport.cell, c.i) <= RULES.bombardRange && state.board[c.i] && state.board[c.i] !== p && !state.anchors[c.i] && !allied(state, p, state.board[c.i]));
      bombTargets.sort((a, b) => (FACILITY_CELLS.has(b.i) ? 10 : 0) + adjacentCount(state, b.i, state.board[b.i]) - ((FACILITY_CELLS.has(a.i) ? 10 : 0) + adjacentCount(state, a.i, state.board[a.i])));
      for (const c of bombTargets.slice(0, 12)) {
        const value = 47 + Math.min(22, cutImpact(c.i) * 1.8) + (FACILITY_CELLS.has(c.i) ? 12 : 0) + (state.turrets.some(t => t.cell === c.i) ? 9 : 0) - (state.shields[c.i] ? 12 : 0);
        consider({ type: 'bombard', cells: [airport.cell, c.i] }, value * profile.aggression);
      }
      if (state.turrets.filter(t => t.owner === p).length < RULES.maxTurrets) for (const c of CELLS) {
        if (state.board[c.i] || distance(airport.cell, c.i) > RULES.airdropRange || (state.terrain[c.i] === 1 && !state.roads[c.i])) continue;
        const threat = danger(c.i); if (!threat) continue;
        const connected = ADJ[c.i].some(j => state.board[j] === p && supply[j]);
        const reconnectable = cards.bridge !== undefined && NEAR[c.i].some(j => state.board[j] === p && supply[j]);
        const raid = !nearOwn[c.i] && player.supplies === RULES.suppliesCap && threat >= 3;
        if (!connected && !reconnectable && !raid) continue;
        const value = 39 + Math.min(7, threat) * 2.5 + (connected ? 7 : reconnectable ? 1 : -4) + (FACILITY_CELLS.has(c.i) ? 8 : 0);
        consider({ type: 'airdrop', cells: [airport.cell, c.i] }, value * profile.engineering);
      }
    }

    // At the cap, free a redundant/back-line cell, explicitly checking that the
    // removal does not sever the surviving supplied route. No footprint subsidy.
    if (own.length >= MAX_STONES - 2) {
      const candidates = own.filter(i => !state.anchors[i] && ordinary(state, i) && !goalCell(state, p, i) && !FACILITY_CELLS.has(i) &&
        !(state.airports || []).some(a => a.owner === p && a.cluster <= RULES.airportStones + 2 && distance(a.cell, i) <= RULES.airportRadius));
      candidates.sort((a, b) => (supply[a] ? 0 : 100) + route[a] - danger(a) * 3 - ((supply[b] ? 0 : 100) + route[b] - danger(b) * 3) || a - b).reverse();
      let checked = 0;
      for (const i of candidates) {
        if (++checked > 14) break;
        const board = state.board.slice(); board[i] = 0; const after = computeSupply({ ...state, board }, p);
        let cuts = 0; for (const j of own) if (j !== i && supply[j] && !after[j]) cuts++;
        if (!cuts) { consider({ type: 'withdraw', cells: [i] }, own.length >= MAX_STONES ? 52 : 18); break; }
      }
    }
    if (bestValue < 5 && state.hand.length) {
      const priorities = { reroute: 0, bridge: 1, exchange: 2, shield: 3, turret: 4, destroy: 5 };
      let discard = 0; for (let i = 1; i < state.hand.length; i++) if (priorities[state.hand[i]] < priorities[state.hand[discard]]) discard = i;
      consider({ type: 'discard', cells: [], cardIndex: discard }, 0);
    }
    return best;
  }

  return Object.freeze({ Game, RADIUS, COUNT, CELLS, ADJ, PLAYERS, CARD_META, ACTION_META, CARD_TYPES, DECK_SIZE, MAX_STONES,
    RULES, PROFILES, index, distance, legalAction, chooseAction, inRange, computeSupply, goalCell, allied, alliesOf,
    bridgeConflict, bridgesConflict, bridgeLegal, combatStrength, actionCost, AIRPORT_CELLS, DEPOT_CELLS, airportStatus, activeAirport, sectorOf });
});
