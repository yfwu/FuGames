'use strict';
const nodeTest = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const baseline = process.env.AUTOHEX_PLANNER_FIXTURE_POLICY === 'baseline';
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const runtimeHashes=()=>Object.fromEntries(['autohex-engine.js','hex-core.js','autohex-planner.js','hex-strategies.js'].filter(f=>fs.existsSync(path.join(__dirname,'..',f))).map(f=>[f,sha(fs.readFileSync(path.join(__dirname,'..',f)))]));
const initialRuntimeHashes=runtimeHashes();let baselineHash;
function baselineEngine() {
  const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/autohex-planner-2026-10-11/baseline-source.json'),'utf8'));
  assert.equal(fixture.commit,'96c109a59c0bf79a159561ed845715a8e0ab8fee');
  assert.equal(sha(fixture.capturedSource),'a029f76bb5424506a21f8485519176f010c3803aed401a20733ad83aaf4c9f09');
  const Module=require('node:module'),m=new Module(__filename);m._compile(fixture.capturedSource,__filename);return m.exports;
}
let H;
if (baseline) {
  baselineHash='a029f76bb5424506a21f8485519176f010c3803aed401a20733ad83aaf4c9f09';H=baselineEngine();
} else H = require('../autohex-engine.js');
const evidence = []; let currentEvidence;
function test(name, fn, plannerOnly = false) {
  nodeTest(name,{skip:baseline && plannerOnly},() => {
    currentEvidence = {name,policy:baseline?'released96c109a':'planner',sequences:[],pass:false}; evidence.push(currentEvidence);
    try { fn(); currentEvidence.pass = true; } catch (error) { currentEvidence.error = error.message; throw error; }
    finally {currentEvidence = null;}
  });
}
nodeTest.after(() => { if (process.env.AUTOHEX_PLANNER_FIXTURE_EVIDENCE) fs.writeFileSync(process.env.AUTOHEX_PLANNER_FIXTURE_EVIDENCE,JSON.stringify({kind:'Controlled tactical puzzles; other players rest unless the scenario states active responses',policy:baseline?'released96c109a':'planner',sourceHashes:baseline?{'autohex-engine.js':baselineHash}:initialRuntimeHashes,sourceUnchanged:baseline||JSON.stringify(initialRuntimeHashes)===JSON.stringify(runtimeHashes()),tests:evidence},null,2)+'\n'); });
const at = H.index;
const {canonicalHomes}=require('./helpers/hex-tactical-fixture.cjs');

function clean(seed = 'planner-fixture') {
  const g = new H.Game({ seed, neutralEvents: false }); g.start();
  canonicalHomes(g,H); g.board.set(g.anchors); g.terrain.fill(0); g.roads.fill(0); g.shields.fill(0);
  g.age.fill(0); g.fortified.fill(0); g.unsupplied.fill(0);
  g.bridges = []; g.turrets = []; g.offers = []; g.alliances = [];
  g.players[1].energy = 8; g.players[1].supplies = 6;
  g.hands[1] = Array(5).fill('reroute');
  return g;
}
function route(g, p, target, permitted = () => true) {
  const source = g.players[p].home, previous = new Int32Array(H.COUNT).fill(-2), queue = [source]; previous[source] = -1;
  for (let n = 0; n < queue.length && previous[target] === -2; n++) for (const j of H.ADJ[queue[n]]) {
    if (previous[j] !== -2 || (g.board[j] && g.board[j] !== p) || !permitted(j)) continue;
    previous[j] = queue[n]; queue.push(j);
  }
  if (previous[target] === -2) return null;
  const result = []; for (let i = target; i !== -1; i = previous[i]) result.push(i);
  return result.reverse();
}
function fill(g, p, cells) { assert.ok(cells); for (const i of cells) { assert.ok(!g.board[i] || g.board[i] === p); g.board[i] = p; } return cells; }
function holds(g, p) { const supply = H.computeSupply(g, p); return H.CELLS.some(c => supply[c.i] && H.goalCell(g, p, c.i)); }
function ownTurn(g, p = 1) { for (let n = 0; g.turn !== p && n < 6; n++) assert.ok(g.act({ type: 'rest', cells: [] })); assert.equal(g.turn, p); }
function decide(g) { return H.chooseAction(g.observation()); }
function execute(g, count, stop = () => false) {
  const actions = [], sequence = {seed:g.seed,startPly:g.ply,actions:[]}; currentEvidence?.sequences.push(sequence);
  for (let n = 0; n < count && !stop(); n++) {
    ownTurn(g); const obs = g.observation(), chosen = decide(g);
    assert.ok(H.legalAction(obs, chosen), JSON.stringify(chosen));
    assert.ok(g.act(chosen)); actions.push(chosen); g.advanceTime(300);
    sequence.actions.push({type:chosen.type,cells:chosen.cells,target:chosen.target,intent:chosen.planner?.publicIntent,diagnostics:chosen.planner?.diagnostics,
      holds:H.PLAYERS.map(p=>holds(g,p)),airports:g.airports.filter(a=>a.owner===1).map(a=>({cell:a.cell,cluster:a.cluster,progress:a.progress,active:a.active}))});
  }
  return actions;
}
function cluster(g, airport) {
  const q = [airport], seen = new Set(q);
  for (let n = 0; n < q.length; n++) for (const j of H.ADJ[q[n]]) if (!seen.has(j) && g.board[j] === 1 && H.distance(j, airport) <= 4) { seen.add(j); q.push(j); }
  return q;
}
function airportPosition(seed = 'planner-airport-purpose', size = 8) {
  const g = clean(seed), airport = g.airports.slice().sort((a,b) => H.distance(g.players[1].home,a.cell) - H.distance(g.players[1].home,b.cell))[0].cell;
  fill(g, 1, route(g, 1, airport));
  let cells = cluster(g, airport);
  while (cells.length < size) {
    const choices = H.CELLS.filter(c => !g.board[c.i] && H.distance(c.i,airport) <= 3 && H.ADJ[c.i].some(j => cells.includes(j)));
    choices.sort((a,b) => H.distance(a.i, g.players[1].home) - H.distance(b.i, g.players[1].home) || a.i-b.i);
    assert.ok(choices.length); g.board[choices[0].i] = 1; cells = cluster(g,airport);
  }
  assert.equal(cells.length,size); g._refreshFacilities(); return {g,airport};
}

test('planner follows a supplied flank around a defended central barrier over several owner turns', () => {
  const g = clean('planner-flank-sequence');
  fill(g,1,route(g,1,at(4,-2)));
  // A three-cell-deep defended obstacle; a normal adjacent bypass is open at both sides.
  const barrier = H.CELLS.filter(c => c.q >= 0 && c.q <= 2 && c.r >= -5 && c.r <= 3).map(c => c.i);
  for (const i of barrier) g.board[i] = 2;
  fill(g,2,route(g,2,at(2,3)));
  const original = g.board.slice(), actions = execute(g,24,() => H.CELLS.some(c => c.q < 0 && H.computeSupply(g,1)[c.i]));
  const supplied = H.computeSupply(g,1), bypass = H.CELLS.filter(c => supplied[c.i] && original[c.i] !== 1 && (c.r < -5 || c.r > 3));
  assert.ok(actions.length >= 3); assert.ok(bypass.length >= 3, `No substantial supplied bypass: ${JSON.stringify(actions)}`);
  assert.ok(H.CELLS.some(c => c.q < 0 && supplied[c.i]), 'Must make actual progress past the obstacle');
  assert.ok(actions.filter(a => a.type === 'rest').length <= 2);
});

test('planner completes a nearby goal instead of collecting an unrelated nearly ready airport', () => {
  const {g,airport} = airportPosition('planner-ignore-facility',8);
  const target = at(-18,0), path = route(g,1,target); fill(g,1,path.slice(0,-4));
  g._refreshFacilities(); const initial = H.airportStatus(g,airport).cluster;
  const actions = execute(g,6,() => holds(g,1));
  assert.ok(holds(g,1), `Failed near goal: ${JSON.stringify(actions)}`);
  assert.ok(actions.length <= 5); assert.ok(H.airportStatus(g,airport).cluster <= initial + 1);
});

test('planner develops a useful airport, holds it, and actually disrupts the remote scoring route', () => {
  const {g,airport} = airportPosition();
  // An established, separate main front competes with the airport investment.
  // Continuing it has immediate progress value; aviation requires returning
  // to the unfinished branch, holding it, then paying for the follow-on shot.
  fill(g,1,route(g,1,at(-4,-7),i=>H.distance(i,airport)>4 || g.board[i]===1));
  g._refreshFacilities();
  let threat;
  for (const p of H.PLAYERS.slice(1)) {
    const previous = new Int32Array(H.COUNT).fill(-2), q = [g.players[p].home]; previous[q[0]] = -1;
    for (let n = 0; n < q.length; n++) for (const j of H.ADJ[q[n]]) if (previous[j] === -2 && (!g.board[j] || g.board[j] === p) && !H.inRange(g,1,j)) { previous[j] = q[n]; q.push(j); }
    const target = q.find(i => H.goalCell(g,p,i) && H.distance(airport,i) <= 12);
    if (target !== undefined) {
      const cells = []; for (let i = target; i !== -1; i = previous[i]) cells.push(i);
      fill(g,p,cells); threat = {owner:p,target}; break;
    }
  }
  assert.ok(threat, 'Fixture needs a genuinely supplied remote enemy goal');
  assert.ok(holds(g,threat.owner)); assert.equal(H.airportStatus(g,airport).cluster,8);
  assert.equal(H.activeAirport(g,1,airport),false);
  const actions = execute(g,14,() => g.telemetry.bombardments > 0 && !holds(g,threat.owner));
  const air = actions.find(a => ['airdrop','bombard'].includes(a.type));
  assert.ok(air, `Never followed facility development with air: ${JSON.stringify(actions)}`);
  assert.equal(air.cells[0],airport); assert.ok(g.telemetry.airportUnlocks > 0);
  assert.ok(actions.slice(0,actions.indexOf(air)).filter(a => a.type === 'deploy' && H.distance(a.cells[0],airport) <= 4).length >= 4);
  assert.equal(holds(g,threat.owner),false, 'Label or activation alone is not sufficient; the enemy route must actually break');
});

test('planner repairs a severed goal route and retains real supply through following turns', () => {
  const g = clean('planner-repair-sequence'), path = route(g,1,at(-18,0)); fill(g,1,path);
  g.hands[1] = ['bridge','shield','destroy','turret','exchange'];
  const cut = path[Math.floor(path.length/2)]; g.board[cut] = 0;
  assert.equal(holds(g,1),false); const actions = execute(g,3,() => holds(g,1));
  assert.ok(holds(g,1), JSON.stringify(actions));
  execute(g,3); assert.ok(holds(g,1), 'Follow-on plans must preserve the restored scoring route');
});

test('planner reassesses after an active opponent legally cuts the committed route, then reconnects and finishes', () => {
  const g=clean('planner-active-reassessment'), goal=at(-18,0), main=route(g,1,goal);fill(g,1,main.slice(0,-3));
  const middle=main[Math.floor(main.length/2)], approach=H.ADJ[middle].find(i=>!g.board[i] && route(g,2,i));
  assert.ok(approach!==undefined);fill(g,2,route(g,2,approach));
  g.hands[1]=['bridge','shield','destroy','turret','exchange'];g.hands[2]=['destroy'];
  execute(g,1);assert.equal(g.turn,2);
  const cut=main.find(i=>!g.anchors[i] && !g.shields[i] && H.legalAction(g.observation(),{type:'destroy',cells:[i]}));
  assert.ok(cut!==undefined);const front=main.at(-4);assert.equal(H.computeSupply(g,1)[front],1);
  assert.ok(g.act({type:'destroy',cells:[cut]}));assert.equal(g.board[cut],0);assert.equal(H.computeSupply(g,1)[front],0);
  const actions=execute(g,5,()=>holds(g,1));
  assert.equal(H.computeSupply(g,1)[front],1,JSON.stringify(actions));assert.ok(holds(g,1),'Must repair actual supply and complete the goal under the changed board');
});

test('planner stops an imminent enemy connection before the opponent attempts its finishing deployment', () => {
  const g=clean('planner-imminent-defense'), target=at(-10,-8), enemy=route(g,2,target);fill(g,2,enemy.slice(0,-1));
  const approach=H.ADJ[enemy.at(-2)].find(i=>!g.board[i]&&!g.anchors[i]&&route(g,1,i));assert.ok(approach!==undefined);
  fill(g,1,route(g,1,approach));g.hands[1]=['destroy','shield','bridge','exchange','turret'];
  assert.equal(holds(g,2),false);const completed=g.board.slice();completed[target]=2;
  assert.equal(H.computeSupply({...g,board:completed},2)[target],1,'Without intervention the next enemy deployment completes a scoring route');
  const actions=execute(g,1);assert.equal(g.turn,2);const finish={type:'deploy',cells:[target]};
  assert.ok(g.act(H.legalAction(g.observation(),finish)?finish:{type:'rest',cells:[]}));
  while(g.turn!==1)assert.ok(g.act({type:'rest',cells:[]}));
  assert.equal(holds(g,2),false,JSON.stringify(actions));assert.equal(g.players[2].goals,0);
});

test('planner breaks an obstructing pact and then exploits the opening with legal paid actions', () => {
  const g = clean('planner-betray-sequence'), path = route(g,1,at(-18,0)); fill(g,1,path.slice(0,-1));
  // The whole available opposite edge is allied, so a free neighboring goal
  // cannot make peaceful completion cheaper than a paid, useful betrayal.
  const targets = H.CELLS.filter(c => H.goalCell(g,1,c.i) && !g.anchors[c.i]).map(c => c.i);
  for (const i of targets) g.board[i] = 2;
  for (const i of targets) fill(g,2,route(g,2,i));
  g.alliances = [{a:1,b:2,createdRound:0,expiresRound:30}];
  g.hands[1] = ['destroy','shield','turret','bridge','exchange'];
  const oldScore = g.players[1].score, actions = execute(g,5,() => holds(g,1));
  const betrayal = actions.find(a => a.type === 'betray');
  assert.ok(betrayal, JSON.stringify(actions)); assert.equal(betrayal.target,2);
  assert.ok(!H.allied(g,1,2)); assert.ok(g.players[1].reputation < 0);
  assert.ok(g.players[1].grudgeUntil[2] > g.round); assert.ok(holds(g,1), JSON.stringify(actions));
  assert.ok(actions.some(a => ['deploy','destroy','exchange'].includes(a.type)));
  assert.ok(g.players[1].score >= oldScore - H.RULES.betrayalScore);
});

test('planner accepts a useful public truce that prevents an immediate supply cut and then completes its route', () => {
  const g=clean('planner-beneficial-truce'); if(g.players[1].strategy) g.players[1].strategy.diplomacy='opportunity'; const main=route(g,1,at(-18,0));fill(g,1,main.slice(0,-3));
  const cut=main[Math.floor(main.length/2)];
  for(const i of H.ADJ[cut])if(!g.board[i]){const path=route(g,2,i);if(path && path.length<=H.distance(g.players[2].home,i)+3)fill(g,2,path);}
  const capture={type:'deploy',cells:[cut]},opponentView={...g.observation(2),turn:2};
  assert.ok(H.legalAction(opponentView,capture),'Potential partner can capture the critical supply cell now');
  const removed=g.board.slice();removed[cut]=2;assert.equal(H.computeSupply({...g,board:removed},1)[main.at(-4)],0);
  const contact=H.CELLS.find(c=>!g.board[c.i]&&!g.anchors[c.i]&&H.distance(c.i,cut)<=4&&H.ADJ[c.i].some(i=>g.board[i]===1)&&H.ADJ[c.i].some(i=>g.board[i]===2)&&route(g,3,c.i));
  assert.ok(contact,'Both potential partners need a real public common enemy border');fill(g,3,route(g,3,contact.i));
  g.players[3].score=60;g.offers=[{id:1,from:2,to:1,createdRound:g.round,expiresRound:g.round+3}];
  const first=execute(g,1),pact=H.allied(g,1,2);assert.equal(g.turn,2);
  const canCapture=H.legalAction(g.observation(),capture);assert.ok(g.act(canCapture?capture:{type:'rest',cells:[]}));
  if(currentEvidence)currentEvidence.opponentResponse={captureLegal:canCapture,supplyCut:!H.computeSupply(g,1)[main.at(-4)]};
  const actions=execute(g,5,()=>holds(g,1));
  assert.equal(first[0].type,'accept');assert.equal(first[0].target,2);assert.ok(pact);
  assert.equal(canCapture,false,'The pact must actually prohibit the impending capture');
  assert.ok(holds(g,1),JSON.stringify(actions));assert.equal(H.computeSupply(g,1)[main.at(-4)],1);
});

function boundedPlan(action) {
  assert.equal(H.plannerAvailable,true); assert.equal(action.planner?.version,1);
  const {memory,publicIntent,diagnostics:d} = action.planner, L=H.PLANNER_LIMITS;
  assert.ok(Number.isInteger(d.nodes) && d.nodes > 0 && d.nodes <= L.nodes);
  assert.ok(d.depth >= 1 && d.depth <= L.depth); assert.equal(d.maxNodes,L.nodes);
  assert.ok(memory.path.length <= L.privatePath); assert.ok(memory.waypoints.length <= L.waypoints);
  assert.ok(publicIntent.path.length <= L.publicPath);
  const visit = value => {
    if (typeof value === 'number') assert.ok(Number.isFinite(value));
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  }; visit(action.planner);
  assert.ok(Buffer.byteLength(JSON.stringify(action.planner)) < 16000,'Bounded plan payload');
}

test('planner is deterministic and reads no opponent hand, deck order, or raw private fields', () => {
  const g = new H.Game({seed:'planner-private'}); g.start(); const obs=g.observation(), before=JSON.stringify(obs), a=H.chooseAction(obs);
  boundedPlan(a); assert.equal(JSON.stringify(obs),before); assert.deepEqual(H.chooseAction(obs),a);
  for (const p of H.PLAYERS.slice(1)) g.hands[p]=g.hands[p].map((_,n)=>n%2?'shield':'destroy');
  g.drawPile.reverse(); g.discardPile.reverse(); assert.deepEqual(g.observation(),obs);
  assert.deepEqual(H.chooseAction(g),a,'Passing a raw Game still must create a public observation');
  const poisoned=JSON.parse(before);
  for (const key of ['hands','drawPile','discardPile','_random','_neutralRandom']) Object.defineProperty(poisoned,key,{get(){throw new Error('Private field read: '+key);}});
  assert.deepEqual(H.chooseAction(poisoned),a); assert.equal(H.chooseAction(g.observation(0)),null);
},true);

test('only accepted actions commit private memory; observations isolate it and reset clears all plans', () => {
  const g = new H.Game({seed:'planner-isolation'}); g.start(); const a=H.chooseAction(g.observation()); boundedPlan(a);
  assert.ok(g.plannerStates.every(x=>x===null)); assert.ok(g.intents.every(x=>x===null));
  const before=JSON.stringify(g); assert.equal(g.act({...a,cells:[-1]}),false); assert.equal(JSON.stringify(g),before);
  assert.ok(g.act(a)); assert.ok(g.plannerStates[1]); assert.ok(g.intents[1]);
  const committed=JSON.stringify(g.plannerStates[1]), publicCommitted=JSON.stringify(g.intents[1]);
  a.planner.memory.path.push(-1); a.planner.publicIntent.path.push(-1);
  const own=g.observation(1), enemy=g.observation(2), spectator=g.observation(0);
  assert.ok(own.plannerMemory); assert.equal(enemy.plannerMemory,null); assert.equal(spectator.plannerMemory,null);
  own.plannerMemory.path.push(-1); own.intents[1].path.push(-1); enemy.intents[1].target=-1;
  assert.equal(JSON.stringify(g.plannerStates[1]),committed); assert.equal(JSON.stringify(g.intents[1]),publicCommitted);
  for (const view of [enemy,spectator]) for (const key of ['plannerStates','hands','drawPile','discardPile']) assert.equal(key in view,false);
  for (const key of ['hand','cardIndex','followType','followTarget','waypoints','actions']) assert.equal(key in spectator.intents[1],false);
  g.reset(); assert.ok(g.plannerStates.every(x=>x===null)); assert.ok(g.intents.every(x=>x===null));
  g.start(); const fresh=new H.Game({seed:'planner-isolation'});fresh.start();
  assert.deepEqual(H.chooseAction(g.observation()),H.chooseAction(fresh.observation()));
  // Completion is a claim about the fully settled board, not a pre-action prediction.
  for (const nextActorFires of [false,true]) {
    const finalGap=clean('planner-post-action-completion'), target=at(-18,0);
    fill(finalGap,1,route(finalGap,1,target).slice(0,-1));
    const finish=H.chooseAction(finalGap.observation());
    assert.equal(finish.planner.publicIntent.completed,false);
    if(nextActorFires) {
      const battery=H.CELLS.find(c=>!finalGap.board[c.i]&&!finalGap.anchors[c.i]&&H.distance(c.i,target)===1);
      assert.ok(battery);finalGap.board[battery.i]=2;
      finalGap.turrets.push({cell:battery.i,owner:2,countdown:1,life:H.RULES.turretLife});
    }
    assert.ok(finalGap.act(finish));
    assert.equal(holds(finalGap,1),!nextActorFires);
    assert.equal(finalGap.intents[1].completed,!nextActorFires);
    assert.equal(finalGap.plannerStates[1].completed,!nextActorFires);
    if(nextActorFires) {
      assert.equal(finalGap.telemetry.turretShots,1);
      assert.ok(finalGap.intents[1].progress<1);
    } else assert.equal(finalGap.intents[1].progress,1);
  }
},true);

test('malformed planner metadata cannot inject unbounded paths, hidden fields, scores, or another player intent', () => {
  const malformed=[null,{version:99,memory:{}},{version:1,memory:{strategy:'invented',path:Array(2000).fill(1)}},
    {version:1,memory:{strategy:'direct',target:-1,path:Array(2000).fill(1),waypoints:Array(2000).fill(1),age:Infinity,metric:NaN,committedAtPly:-1,reviewAtPly:Infinity,hand:['private'],score:9999},publicIntent:{player:6,progress:Infinity,hand:['private'],path:Array(2000).fill(1)}}];
  for (const planner of malformed) {
    const g=new H.Game({seed:'planner-metadata'});g.start();const score=g.players[1].score;
    assert.ok(g.act({type:'rest',cells:[],planner})); assert.equal(g.players[1].score,score);
    assert.ok(g.plannerStates.slice(2).every(x=>x===null));assert.ok(g.intents.slice(2).every(x=>x===null));
    if(g.plannerStates[1]) {
      assert.ok(g.plannerStates[1].path.length<=H.PLANNER_LIMITS.privatePath);assert.ok(g.plannerStates[1].waypoints.length<=H.PLANNER_LIMITS.waypoints);
      assert.equal(g.intents[1].player,1);assert.ok(g.intents[1].path.length<=H.PLANNER_LIMITS.publicPath);
      assert.equal('hand' in g.plannerStates[1],false);assert.equal('score' in g.plannerStates[1],false);assert.equal('hand' in g.intents[1],false);
      assert.ok(Number.isFinite(g.plannerStates[1].age));assert.ok(Number.isFinite(g.intents[1].progress));
    }
  }
},true);

test('seeded planner replay preserves actions, rules state, bounded memory, and finite search through changing positions', () => {
  const a=new H.Game({seed:'planner-replay-bounds'}),b=new H.Game({seed:'planner-replay-bounds'});a.start();b.start();
  let reused=0;
  for(let n=0;n<72;n++) {
    const x=H.chooseAction(a.observation()),y=H.chooseAction(b.observation());boundedPlan(x);assert.deepEqual(x,y);reused+=Number(x.planner.diagnostics.reusedIntent);
    assert.ok(a.act(x));assert.ok(b.act(y));a.advanceTime(300);b.advanceTime(300);
    assert.deepEqual(a.board,b.board);assert.deepEqual(a.hands,b.hands);assert.deepEqual(a.drawPile,b.drawPile);assert.deepEqual(a.plannerStates,b.plannerStates);
    for(const m of a.plannerStates.filter(Boolean)){assert.ok(m.path.length<=H.PLANNER_LIMITS.privatePath);assert.ok(m.waypoints.length<=H.PLANNER_LIMITS.waypoints);}
  }
  assert.ok(reused>0,'Persistent plans must actually survive at least one own turn');
},true);

test('an irrelevant distant public stone does not discard an ongoing useful commitment', () => {
  const g=new H.Game({seed:'planner-stable-commitment',neutralEvents:false});g.start();execute(g,2);ownTurn(g);
  const view=g.observation(),base=H.chooseAction(view);boundedPlan(base);assert.ok(view.plannerMemory);
  const distant=H.CELLS.find(c=>!view.board[c.i]&&!view.anchors[c.i]&&
    view.plannerMemory.path.every(i=>H.distance(c.i,i)>5)&&
    H.PLAYERS.every(p=>H.distance(c.i,view.players[p].home)>5)&&
    H.ADJ[c.i].every(i=>view.board[i]!==2));
  assert.ok(distant,'Fixture needs a nonlocal isolated cell');
  const changed=structuredClone(view);changed.board[distant.i]=2;changed.supplied[distant.i]=0;
  const alternative=H.chooseAction(changed);assert.ok(H.legalAction(changed,alternative));
  assert.equal(alternative.planner.diagnostics.reusedIntent,true);
  for(const key of ['type','target','committedAtPly'])assert.equal(alternative.planner.publicIntent[key],base.planner.publicIntent[key],key);
},true);

test('planner targets the shared core contract while explicitly retaining intentional migration differences', () => {
  const Normal=require('../cardhex-engine.js').create({playerCount:6}),Old=baselineEngine();
  for(const key of ['deployRange','handCap','energyCap','turretRange','airdropRange','bombardRange'])
    if(key in H.RULES) assert.equal(H.RULES[key],Normal.RULES[key],key);
  assert.deepEqual(H.CARD_META,Normal.CARD_META);assert.deepEqual(H.ACTION_META,Normal.ACTION_META);
  assert.equal(H.DECK_SIZE,6*13);assert.notEqual(H.DECK_SIZE,Old.DECK_SIZE);
  assert.ok('tunnel' in H.ACTION_META);assert.equal('tunnel' in Old.ACTION_META,false);
  assert.equal(H.RADIUS,18);assert.equal(Normal.RADIUS,9);
  assert.equal(new H.Game().observation().coreConfig.mode,'auto');
  assert.equal(new Normal.Game().observation().coreConfig.mode,'normal');
},true);
