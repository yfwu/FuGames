'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const Core = require('../hex-core.js'), Strategies = require('../hex-strategies.js');
const Snapshot = require('../autohex-snapshot.js');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

function worker() {
  let receive, response;
  const context = vm.createContext({ performance, self: {
    addEventListener(type, fn) { receive = fn; }, postMessage(value) { response = plain(value); }
  } });
  context.importScripts = (...files) => files.forEach(file => vm.runInContext(read(file), context, { filename: file }));
  vm.runInContext(read('autohex-ai-worker.js'), context);
  return observation => {
    response = null;
    receive({ data: { type: 'choose', id: 1, generation: 1, ply: observation.ply, turn: observation.turn, observation: plain(observation) } });
    assert.equal(response.type, 'decision', response.message);
    return response.action;
  };
}

test('both pages wire the same planner, strategy provider and screenshot history/export controls', () => {
  for (const page of ['autohex.html', 'card_hex.html']) {
    const html = read(page), scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
    for (const file of ['hex-strategies.js', 'autohex-planner.js', 'hex-core.js', 'autohex-snapshot.js', 'autohex-ui.js']) assert.ok(scripts.includes(file), page + ': ' + file);
    assert.ok(scripts.indexOf('autohex-planner.js') < scripts.indexOf('hex-core.js'));
    assert.ok(scripts.indexOf('autohex-snapshot.js') < scripts.indexOf('autohex-ui.js'));
    for (const id of ['snapshot', 'snapshot-dialog', 'snapshot-image', 'snapshot-download', 'snapshot-close', 'snapshot-resume']) assert.ok(html.includes(`id="${id}"`), page + ': ' + id);
  }
  assert.deepEqual(Strategies.normalize(JSON.parse(read('config/hex-strategies.json'))), Strategies.normalize(Strategies.DEFAULT_CONFIG));
});

test('real worker entry point and synchronous shared planner return identical decisions across modes and imported doctrine', () => {
  const choose = worker(), config = structuredClone(Strategies.DEFAULT_CONFIG);
  config.profiles[0].style = { lane: 'right', centerAversion: 9, raid: 7, robustness: 4, expansion: 2 };
  for (const [mode, playerCount] of [['normal', 2], ['normal', 3], ['normal', 6], ['auto', 6]]) {
    const E = Core.create({ mode, playerCount }), g = new E.Game({ seed: 'runtime-parity', strategyConfig: config, neutralEvents: false });
    g.start(); const view = g.observation(), before = JSON.stringify(view);
    assert.ok(E.plannerAvailable); assert.deepEqual(view.players[1].strategy.style, config.profiles[0].style);
    const direct = plain(E.chooseAction(view)), remote = choose(view);
    assert.deepEqual(remote, direct); assert.ok(direct.planner.diagnostics.nodes > 0);
    assert.equal(JSON.stringify(view), before); assert.ok(E.legalAction(view, remote));
    const wrapper = mode === 'auto' ? require('../autohex-engine.js') : require('../cardhex-engine.js').create({ playerCount });
    assert.deepEqual(plain(wrapper.chooseAction(view)), direct);
  }
});

test('comparable goal fixtures use the common planner while retaining normal win / Auto campaign rules', () => {
  for (const mode of ['normal', 'auto']) {
    const E = Core.create({ mode, playerCount: 6 }), g = new E.Game({ seed: 'goal-parity', terrain: 'classic', neutralEvents: false });
    g.start(); g.board.set(g.anchors); g.terrain.fill(0); g.airports = []; g.depots = [];
    g.players[1].home = E.index(0, 0); g.players[1].axis = 'q'; g.players[1].sign = -1;
    for (let q = 0; q < E.RADIUS; q++) g.board[E.index(q, 0)] = 1;
    g.hands[1] = []; g.handAges[1] = []; g.players[1].energy = 8;
    const action = E.chooseAction(g.observation());
    assert.ok(action.planner); assert.equal(action.type, 'deploy');
    assert.ok(E.goalCell(g, 1, action.cells[0])); assert.ok(g.act(action));
    assert.equal(g.phase, mode === 'normal' ? 'over' : 'running');
    assert.equal(E.RULES.alliances, mode === 'auto');
  }
});

test('normal 2–6 player snapshot windows count 18 actions and clear on replay', () => {
  for (const playerCount of [2, 3, 6]) {
    const E = Core.create({ mode: 'normal', playerCount }), g = new E.Game({ seed: 'snapshot-small', neutralEvents: false });
    const c = new Snapshot.Chronicle(); g.start(); c.record(g.observation(0));
    for (let i = 0; i < 21; i++) { g.act({ type: 'rest', cells: [] }); c.record(g.observation(0)); }
    const summary = Snapshot.summarize(c, g.observation(0));
    assert.equal(summary.toPly - summary.fromPly, 18); assert.equal(summary.stats.length, playerCount + 1);
    c.clear(); const fresh = new E.Game({ seed: 'snapshot-small' }); c.record(fresh.observation(0));
    assert.equal(Snapshot.summarize(c, fresh.observation(0)).toPly, 0);
    assert.equal(c.losses.length, 0); assert.equal(c.plans.length, 0);
  }
});
