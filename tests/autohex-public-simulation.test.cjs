'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const E = require('../autohex-engine.js');
const at = E.index;

function game(seed = 'public-forward-model') {
  const g = new E.Game({ seed, neutralEvents: false }); g.start();
  g.board.set(g.anchors); g.terrain.fill(0); g.roads.fill(0);
  g.shields.fill(0); g.unsupplied.fill(0); g.age.fill(0); g.fortified.fill(0);
  g.bridges = []; g.turrets = []; g.offers = []; g.alliances = [];
  g.hands = Array.from({ length: 7 }, () => []); g.players[1].energy = 8;
  // The comparison deliberately excludes unknown future draws. Real board,
  // upkeep, legal action and scoring functions remain unchanged.
  g._draw = function () {}; return g;
}
function publicConsequences(g) {
  const result = {};
  for (const name of ['board', 'terrain', 'roads', 'anchors', 'shields', 'unsupplied', 'age', 'fortified', 'hillAge']) result[name] = Array.from(g[name]);
  for (const name of ['players', 'bridges', 'tunnels', 'turrets', 'airports', 'depots', 'offers', 'alliances', 'neutralWarning']) result[name] = JSON.parse(JSON.stringify(g[name]));
  for (const name of ['turn', 'ply', 'round']) result[name] = g[name];
  return result;
}
function both(real, simulated, action) {
  assert.equal(E.legalAction(real, action), true, JSON.stringify(action));
  assert.equal(E.legalAction(simulated, action), true, JSON.stringify(action));
  assert.equal(real.act(action), true); assert.equal(simulated.act(action), true);
  assert.deepEqual(publicConsequences(simulated), publicConsequences(real));
}

test('public forward model preserves paid cards, automatic turret fire, shields and owner upkeep', () => {
  const real = game(); real.board[at(17,-8)] = 1; real.board[at(16,-8)] = 1;
  real.board[at(17,-7)] = 2;
  real.turrets = [{ owner: 2, cell: at(17,-7), life: 30, countdown: 1 }];
  real.hands[1] = ['shield', 'destroy']; real._countStones();
  const sim = E.createPublicSimulation(real.observation(), 1);
  both(real, sim, { type: 'shield', cells: [at(17,-8)], cardIndex: 0 });
  for (let n = 0; n < 5; n++) both(real, sim, { type: 'rest', cells: [] });
  both(real, sim, { type: 'destroy', cells: [at(17,-7)], cardIndex: 0 });
  for (let n = 0; n < 5; n++) both(real, sim, { type: 'rest', cells: [] });
  assert.deepEqual(sim.hands[1], []); assert.ok(real.telemetry.turretShots > 0);
  assert.equal(sim.telemetry.destroyed, real.telemetry.destroyed);
});

test('public forward model resolves already announced neutral protection and supply loss like real rules', () => {
  for (const protection of ['shield', 'fortification']) {
    const real = game('public-warning-model'); real.neutralEvents = true;
    const protectedCell = at(17,-8), cutCell = at(16,-8);
    for (const i of [protectedCell,cutCell]) real.board[i] = 1;
    if (protection === 'shield') real.shields[protectedCell] = 5;
    else { real.age[protectedCell] = 31; real.fortified[protectedCell] = 1; }
    real.neutralWarning = { kind: 'disaster', sector: 0, cells: [protectedCell,cutCell], resolveRound: 2 };
    real._countStones(); const sim = E.createPublicSimulation(real.observation(), 1);
    for (let n = 0; n < 12; n++) both(real, sim, { type: 'rest', cells: [] });
    assert.equal(sim.board[cutCell], 0); assert.equal(sim.board[protectedCell], 1);
    assert.equal(sim.shields[protectedCell], 0); assert.equal(sim.neutralWarning, null);
  }
});

test('public forward model uses only known actor cards, cannot read private getters, and owns independent copies', () => {
  const real = game('public-private-boundary'); real.hands[1] = ['bridge'];
  real.hands[2] = ['destroy', 'shield', 'turret'];
  const view = real.observation();
  for (const key of ['hands', 'drawPile', 'discardPile', '_random', '_neutralRandom']) Object.defineProperty(view, key, { get() { throw Error(`Private access: ${key}`); } });
  const sim = E.createPublicSimulation(view, 1);
  assert.deepEqual(sim.hands[1], ['bridge']);
  for (const p of E.PLAYERS.slice(1)) assert.deepEqual(sim.hands[p], []);
  assert.deepEqual(sim.drawPile, []); assert.deepEqual(sim.discardPile, []);
  sim.board[at(0,0)] = 2; sim.players[1].energy = 0; sim.hands[1].push('destroy');
  sim.airports[0].cell = at(0,0);
  assert.equal(view.board[at(0,0)], 0); assert.equal(view.players[1].energy, 8);
  assert.deepEqual(view.hand, ['bridge']); assert.notEqual(view.airports[0].cell, at(0,0));
});

test('public forward model does not invent an unannounced future neutral target', () => {
  const real = game('unknown-future-warning'); real.neutralEvents = true;
  real.round = E.RULES.neutralPeriod - E.RULES.neutralWarningRounds - 1;
  const view = real.observation();
  Object.defineProperty(view, '_neutralRandom', { get() { throw Error('Future event RNG is private'); } });
  const sim = E.createPublicSimulation(view, 1);
  for (let n = 0; n < 6; n++) assert.equal(sim.act({ type: 'rest', cells: [] }), true);
  assert.equal(sim.round, E.RULES.neutralPeriod - E.RULES.neutralWarningRounds);
  assert.equal(sim.neutralWarning, null);
  assert.deepEqual(sim.drawPile, []);
});

test('public forward model invalidates supply caches after bridges, reroutes, exchange and engineering', () => {
  const real = game('public-structural-transitions');
  for (let q = 12; q <= 17; q++) real.board[at(q,-9)] = 1;
  real.board[at(15,-8)] = 1; real.terrain[at(16,-8)] = 1;
  real.hands[1] = ['bridge','reroute','exchange']; real._countStones();
  const sim = E.createPublicSimulation(real.observation(), 1);
  const actions = [
    {type:'bridge',cells:[at(17,-9),at(15,-9)],cardIndex:0},
    {type:'reroute',cells:[at(17,-9),at(15,-9),at(14,-9)],cardIndex:0},
    {type:'exchange',cells:[at(13,-9),at(13,-8)],cardIndex:0},
    {type:'engineer',cells:[at(16,-8)]}
  ];
  for (const action of actions) {
    // Fill all cached perspectives before mutating the graph.
    for (const p of E.PLAYERS) E.computeSupply(sim,p);
    both(real,sim,action);
    for (let n=0;n<5;n++) both(real,sim,{type:'rest',cells:[]});
    for (const p of E.PLAYERS) assert.deepEqual(E.computeSupply(sim,p),E.computeSupply(real,p));
  }
  assert.equal(sim.terrain[at(16,-8)],0);assert.equal(sim.roads[at(16,-8)],0);
});

test('normal public simulation settles a winning move once and refuses all terminal or ready actions',()=>{
  for(const n of [2,6]){
    const H=require('../hex-core.js').create({mode:'normal',playerCount:n}),real=new H.Game({seed:'simulation-normal-terminal',terrain:'classic',neutralEvents:false});real.start();real.board.set(real.anchors);real._draw=()=>{};
    const p=real.turn,goal=H.CELLS.find(c=>H.goalCell(real,p,c.i)&&!real.anchors[c.i]).i,prev=new Int32Array(H.COUNT).fill(-2),q=[real.players[p].home];prev[q[0]]=-1;
    for(let k=0;k<q.length&&prev[goal]===-2;k++)for(const i of H.ADJ[q[k]])if(prev[i]===-2&&(!real.board[i]||real.board[i]===p)){prev[i]=q[k];q.push(i);}
    assert.notEqual(prev[goal],-2);for(let i=prev[goal];i!==-1;i=prev[i])real.board[i]=p;
    const sim=H.createPublicSimulation(real.observation(),p),finish={type:'deploy',cells:[goal]};assert.ok(real.act(finish));assert.ok(sim.act(finish));
    assert.equal(sim.phase,'over');assert.equal(sim.ply,1);assert.deepEqual(sim.result,real.result);assert.deepEqual(publicConsequences(sim),publicConsequences(real));
    const rebuilt=H.createPublicSimulation(real.observation(p),p);assert.equal(rebuilt.phase,'over');assert.deepEqual(rebuilt.result,real.result);const before=JSON.stringify(rebuilt);assert.equal(rebuilt.act({type:'rest',cells:[]}),false);assert.equal(JSON.stringify(rebuilt),before);
    const ready=new H.Game({seed:'simulation-ready'}),readySim=H.createPublicSimulation(ready.observation(1),1);assert.equal(readySim.phase,'ready');assert.equal(readySim.act({type:'rest',cells:[]}),false);
  }
});

test('public simulation preserves known card expiry, hill retreat and public tunnel sabotage',()=>{
  const H=require('../hex-core.js').create({mode:'normal',playerCount:2}),real=new H.Game({seed:'simulation-new-rules',terrain:'classic',neutralEvents:false,timed:true});real.start();real.board.set(real.anchors);real.airports=[];real.depots=[];real._draw=()=>{};
  const at=H.index,a=at(0,0),b=at(2,0),hill=at(0,1);real.board[a]=real.board[b]=real.board[hill]=1;real.terrain[hill]=2;real.hillAge[hill]=2;real.board[at(1,-1)]=2;
  real.hands[1]=['shield'];real.handAges[1]=[2];real.hands[2]=[];real.handAges[2]=[];
  const sim=H.createPublicSimulation(real.observation(),1);
  for(const action of [{type:'tunnel',cells:[a,at(1,0),b]},{type:'engineer',cells:[at(1,0)]}]){assert.ok(real.act(action));assert.ok(sim.act(action));assert.deepEqual(publicConsequences(sim),publicConsequences(real));assert.deepEqual(sim.hands[1],real.hands[1]);assert.deepEqual(sim.handAges[1],real.handAges[1]);}
  assert.equal(real.board[hill],0);assert.equal(real.tunnels.length,0);assert.deepEqual(real.hands[1],[]);assert.equal(real.telemetry.cardsExpired,1);
});
