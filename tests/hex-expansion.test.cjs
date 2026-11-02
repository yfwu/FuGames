'use strict';
// Optional Front Line expansion in the shared Hex core: rear arsenals and
// drones, flak guns, supply workshops. Off by default; AutoHex-3D turns it on.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const E = require('../autohex-engine.js');
const X = E.EXPANSION;
const plain = v => JSON.parse(JSON.stringify(v));
const at = (q, r) => E.index(q, r);

// A quiet board: player 1 home at the centre with a short line east, player 2 far away.
function fixture() {
  const g = new E.Game({ seed: 'expansion-fixture', expansion: true, terrain: 'classic', neutralEvents: false });
  g.start(); g.board.fill(0); g.anchors.fill(0); g.terrain.fill(0); g.airports = []; g.depots = []; g.turrets = [];
  g.turn = 1; g.players[1].home = at(0, 0); g.anchors[at(0, 0)] = 1;
  for (let q = 0; q <= 4; q++) { g.board[at(q, 0)] = 1; g.reserve[at(q, 0)] = 6; }
  g.players[2].home = at(-15, 0); g.anchors[at(-15, 0)] = 2; g.board[at(-15, 0)] = 2;
  for (const p of E.PLAYERS) { g.players[p].energy = 8; g.players[p].supplies = 24; }
  g.hands[1] = []; g.handAges[1] = [];
  return g;
}
function playSeed(seed, plies, options = {}) {
  const g = new E.Game({ seed, neutralEvents: true, ...options }); g.start(); const actions = [];
  for (let k = 0; k < plies && g.phase === 'running'; k++) {
    const a = E.chooseAction(g.observation());
    assert.ok(a && E.legalAction(g.observation(), a), 'AI chose an illegal action at ply ' + g.ply);
    actions.push(plain(a)); assert.ok(g.act(a)); g.advanceTime(600);
  }
  return { g, actions };
}

test('expansion is off by default: identical games, no structures, new actions illegal', () => {
  const a = playSeed('expansion-off', 60), b = playSeed('expansion-off', 60, { expansion: false });
  assert.deepEqual(a.actions, b.actions); assert.deepEqual(Array.from(a.g.board), Array.from(b.g.board));
  const view = a.g.observation();
  assert.equal(view.expansion, false); assert.deepEqual(view.structures, []); assert.deepEqual(view.drones, []);
  assert.equal(a.g.telemetry.expansion, undefined);
  const own = view.board.findIndex((o, i) => o === view.turn && !view.anchors[i]);
  for (const type of E.STRUCTURE_TYPES) assert.equal(E.legalAction(view, { type, cells: [own] }), false, type);
  assert.equal(E.expansionAction(view), null);
});

test('builds: rear and supply rules, costs, caps and structure exclusivity', () => {
  const g = fixture(), a = at(1, 0);
  // Not rear: an enemy within 3.
  g.board[at(3, 1)] = 2; assert.equal(E.legalAction(g, { type: 'arsenal', cells: [a] }), false);
  assert.equal(E.legalAction(g, { type: 'flak', cells: [a] }), true, 'flak may stand at the front');
  g.board[at(3, 1)] = 0;
  assert.equal(E.legalAction(g, { type: 'arsenal', cells: [at(0, 0)] }), false, 'not on a home');
  const before = { energy: g.players[1].energy, supplies: g.players[1].supplies };
  assert.ok(g.act({ type: 'arsenal', cells: [a] }));
  assert.equal(g.players[1].energy, before.energy - E.ACTION_META.arsenal.cost);
  assert.ok(g.players[1].supplies <= before.supplies - X.arsenalSupplies + E.RULES.supplyProduction, 'paid arsenal supplies before production');
  assert.deepEqual(g.structures.map(t => [t.type, t.cell]), [['arsenal', a]]);
  g.turn = 1; g.players[1].energy = 8;
  assert.equal(E.legalAction(g, { type: 'workshop', cells: [a] }), false, 'one structure per stone');
  g.hands[1] = ['turret']; assert.equal(E.legalAction(g, { type: 'turret', cells: [a], cardIndex: 0 }), false, 'no turret on a structure');
  g.hands[1] = ['exchange']; assert.equal(E.legalAction(g, { type: 'exchange', cells: [a, at(1, 1)], cardIndex: 0 }), false, 'structures are not ordinary');
  // A severed stone cannot host rear industry.
  g.board[at(2, 0)] = 0; assert.equal(E.legalAction(g, { type: 'workshop', cells: [at(3, 0)] }), false);
  g.board[at(2, 0)] = 1;
  // Flak pays 1 local reserve; a dry stone cannot build it.
  g.reserve[at(4, 0)] = 0; assert.equal(E.legalAction(g, { type: 'flak', cells: [at(4, 0)] }), false);
  g.reserve[at(4, 0)] = 3; assert.ok(g.act({ type: 'flak', cells: [at(4, 0)] })); assert.equal(g.reserve[at(4, 0)], 3 - 1 + g.delivered[at(4, 0)], 'paid 1, then normal resupply');
  // Losing the stone removes its structure.
  g._remove(a); assert.equal(g.structures.some(t => t.cell === a), false);
});

test('caps: at most two of each structure per faction', () => {
  const g = fixture();
  for (let q = 1; q <= 2; q++) { g.turn = 1; g.players[1].energy = 8; g.players[1].supplies = 24; assert.ok(g.act({ type: 'workshop', cells: [at(q, 0)] })); }
  g.turn = 1; g.players[1].energy = 8; g.players[1].supplies = 24;
  assert.equal(E.legalAction(g, { type: 'workshop', cells: [at(3, 0)] }), false);
});

test('workshops add rear supply production only while supplied', () => {
  const g = fixture(); g.players[1].supplies = 0;
  g.structures.push({ type: 'workshop', owner: 1, cell: at(2, 0), countdown: 0 });
  g._settleSupply(1); const withShop = g.players[1].supplies;
  const h = fixture(); h.players[1].supplies = 0; h._settleSupply(1);
  assert.equal(withShop - h.players[1].supplies, X.workshopProduction);
  const cut = fixture(); cut.players[1].supplies = 0; cut.structures.push({ type: 'workshop', owner: 1, cell: at(3, 0), countdown: 0 }); cut.board[at(2, 0)] = 0;
  cut._settleSupply(1);
  const severed = cut.players[1].supplies, base = fixture(); base.players[1].supplies = 0; base.board[at(2, 0)] = 0; base._settleSupply(1);
  assert.equal(severed, base.players[1].supplies, 'a severed workshop produces nothing');
});

test('arsenal launches on schedule, drone flies at most 3 cells per owner turn and strikes', () => {
  const g = fixture(); const arsenal = at(1, 0), target = at(9, 0);
  g.board[target] = 2; g.reserve[target] = 6;
  g.structures.push({ type: 'arsenal', owner: 1, cell: arsenal, countdown: 1 });
  const supplies = g.players[1].supplies;
  g._expansionTurn(1);
  assert.equal(g.drones.length, 1); assert.equal(g.players[1].supplies, supplies - X.droneCost);
  assert.equal(g.drones[0].target, target); assert.equal(g.drones[0].cell, arsenal);
  g._expansionTurn(1); assert.equal(E.distance(g.drones[0].cell, arsenal), X.droneSpeed);
  g._expansionTurn(1);
  // 1 -> 4 -> 7, then 8 (adjacent to 9) strikes.
  g._expansionTurn(1);
  assert.equal(g.drones.length, 0); assert.equal(g.board[target], 0, 'target destroyed');
  assert.equal(g.events.filter(e => e.type === 'destroy' && e.source === 'drone').length, 1);
});

test('arsenal does not launch when severed, short of supplies or without a target', () => {
  for (const setup of [g => { g.board[at(1, 0)] = 0; }, g => { g.players[1].supplies = X.droneCost - 1; }, g => { g.board[at(9, 0)] = 0; }]) {
    const g = fixture(); g.board[at(9, 0)] = 2; g.structures.push({ type: 'arsenal', owner: 1, cell: at(2, 0), countdown: 1 });
    setup(g); g._expansionTurn(1); assert.equal(g.drones.length, 0);
  }
});

test('flak shoots down a drone entering its range and spends one reserve', () => {
  const g = fixture(), flak = at(8, 1);
  g.board[at(9, 0)] = 2; g.board[flak] = 2; g.reserve[flak] = 2;
  g.structures.push({ type: 'flak', owner: 2, cell: flak, countdown: 0 });
  g.drones.push({ id: 1, owner: 1, cell: at(3, 0), from: at(3, 0), target: at(9, 0), life: 5 });
  g._expansionTurn(1);
  assert.equal(g.drones.length, 0); assert.equal(g.reserve[flak], 1); assert.equal(g.board[at(9, 0)], 2);
  assert.equal(g.events.at(-1).type, 'drone-down'); assert.equal(g.events.at(-1).origin, flak);
  // A dry flak gun cannot fire.
  g.reserve[flak] = 0; g.drones.push({ id: 2, owner: 1, cell: at(3, 0), from: at(3, 0), target: at(9, 0), life: 5 });
  g._expansionTurn(1); assert.equal(g.drones.length, 1);
});

test('flak intercepts bombardments and airdrops; costs and cooldown are still paid', () => {
  const g = fixture(), airport = at(3, 0), target = at(8, 0), flak = at(9, 0);
  g.airports = [{ id: 0, cell: airport, owner: 1, supplied: true, cluster: 12, progress: 3, active: true }];
  for (const c of E.CELLS) if (E.distance(airport, c.i) <= 2) { g.board[c.i] = 1; g.reserve[c.i] = 6; }
  g.board[target] = 2; g.board[flak] = 2; g.reserve[flak] = 3; g.reserve[target] = 6;
  g.structures.push({ type: 'flak', owner: 2, cell: flak, countdown: 0 });
  const view = g.observation(1); assert.ok(E.activeAirport(view, 1, airport));
  const energy = g.players[1].energy, supplies = g.players[1].supplies;
  assert.ok(g.act({ type: 'bombard', cells: [airport, target] }));
  assert.equal(g.board[target], 2, 'intercepted bomb does no damage'); assert.equal(g.reserve[flak], 2);
  assert.equal(g.players[1].energy, energy - E.ACTION_META.bombard.cost); assert.equal(g.players[1].airCooldown, E.RULES.airCooldown);
  assert.ok(g.players[1].supplies < supplies + E.RULES.supplyProduction, 'supplies spent');
  assert.ok(g.events.some(e => e.type === 'air-intercept' && e.source === 'bombard' && e.origin === flak));
  // Airdrop into cover places nothing.
  g.turn = 1; g.players[1].energy = 8; g.players[1].supplies = 24; g.players[1].airCooldown = 0;
  const drop = at(9, 1); assert.ok(g.act({ type: 'airdrop', cells: [airport, drop] }));
  assert.equal(g.board[drop], 0); assert.equal(g.turrets.some(t => t.cell === drop), false);
});

test('public simulation reproduces expansion turns exactly', () => {
  const { g } = playSeed('expansion-sim', 120, { expansion: true });
  const view = g.observation(g.turn), sim = E.createPublicSimulation(view);
  assert.deepEqual(sim.structures, view.structures); assert.deepEqual(sim.drones, view.drones); assert.equal(sim.expansion, true);
  // Same legal non-card actions keep both boards equal (cards and draws are private).
  for (let k = 0; k < 12; k++) {
    const v = g.observation(g.turn), a = E.chooseAction(v);
    const action = a && !E.CARD_META[a.type] && a.type !== 'discard' ? a : { type: 'rest', cells: [] };
    const s = E.createPublicSimulation(v); assert.ok(s.act(action)); assert.ok(g.act(action));
    assert.deepEqual(Array.from(s.board), Array.from(g.board)); assert.deepEqual(s.drones, g.drones);
  }
});

test('AI uses every structure, launches and intercepts drones, and stays legal and deterministic', () => {
  const { g, actions } = playSeed('expansion-ai', 520, { expansion: true });
  const by = g.telemetry.byType, x = g.telemetry.expansion;
  assert.ok(by.arsenal > 0 && by.flak > 0 && by.workshop > 0, JSON.stringify(by));
  assert.ok(x.dronesLaunched > 0 && x.droneStrikes > 0 && x.dronesDown > 0, JSON.stringify(x));
  assert.ok(g.drones.length <= X.maxDrones * E.PLAYERS.length);
  for (const p of E.PLAYERS) for (const type of E.STRUCTURE_TYPES) assert.ok(g.structures.filter(t => t.owner === p && t.type === type).length <= 2);
  const again = playSeed('expansion-ai', 520, { expansion: true });
  assert.deepEqual(again.actions, actions);
});

test('the AI worker returns the same expansion decisions as the page', () => {
  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  let receive, response;
  const context = vm.createContext({ performance, self: { addEventListener(type, fn) { receive = fn; }, postMessage(value) { response = plain(value); } } });
  context.importScripts = (...files) => files.forEach(file => vm.runInContext(read(file), context, { filename: file }));
  vm.runInContext(read('autohex-ai-worker.js'), context);
  const g = new E.Game({ seed: 'expansion-worker', expansion: true }); g.start();
  let built = 0;
  for (let k = 0; k < 160; k++) {
    const view = g.observation();
    receive({ data: { type: 'choose', id: 1, generation: 1, ply: view.ply, turn: view.turn, observation: plain(view) } });
    assert.equal(response.type, 'decision', response.message);
    assert.deepEqual(response.action, plain(E.chooseAction(view)));
    if (E.STRUCTURE_TYPES.includes(response.action.type)) built++;
    assert.ok(g.act(response.action));
  }
  assert.ok(built > 0, 'worker built expansion structures');
});
