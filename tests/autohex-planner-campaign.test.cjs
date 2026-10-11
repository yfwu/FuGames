'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const H=require('../autohex-engine.js');
const at=H.index;
const {canonicalHomes}=require('./helpers/hex-tactical-fixture.cjs');
function fresh(seed){const g=new H.Game({seed,neutralEvents:false});g.start();return g;}
function route(g,p,target){
  const prior=new Int32Array(H.COUNT).fill(-2),q=[g.players[p].home];prior[q[0]]=-1;
  for(let n=0;n<q.length&&prior[target]===-2;n++)for(const j of H.ADJ[q[n]])if(prior[j]===-2&&(!g.board[j]||g.board[j]===p)){prior[j]=q[n];q.push(j);}
  assert.notEqual(prior[target],-2);const result=[];for(let i=target;i!==-1;i=prior[i])result.push(i);return result.reverse();
}
function finite(value){if(typeof value==='number')assert.ok(Number.isFinite(value));else if(value&&typeof value==='object')Object.values(value).forEach(finite);}

test('completed local missions do not erase campaign stagnation on an unchanged public board',()=>{
  const g=fresh('campaign-stall-invariant'),view=g.observation();let action=H.chooseAction(view);
  assert.ok(action.planner.memory.campaign);let memory=structuredClone(action.planner.memory);memory.campaign.stalled=2;
  const originalGap=memory.campaign.bestGap,initialRemaining=memory.campaign.initialRemaining,lastProgress=memory.campaign.lastProgressPly;
  // Structural counterfactual: each local mission is already fulfilled, but no
  // own stone, supply connection, or campaign gap changes between decisions.
  const empty=H.CELLS.find(c=>!view.board[c.i]).i;
  for(const [strategy,target] of [['interdict',empty],['defend',empty],['recover',g.players[1].home]]){
    memory.strategy=strategy;memory.stage='advance';memory.target=target;memory.completed=false;
    const oldStalled=memory.campaign.stalled;
    action=H.chooseAction({...view,plannerMemory:memory});
    assert.equal(action.planner.diagnostics.previousOutcome,'completed');
    const campaign=action.planner.memory.campaign;
    assert.equal(campaign.stalled,oldStalled+1,'Changing a completed tactical mission must not reset global stall');
    assert.equal(campaign.bestGap,originalGap);assert.equal(campaign.initialRemaining,initialRemaining);assert.equal(campaign.lastProgressPly,lastProgress);
    memory=structuredClone(action.planner.memory);
  }
  // A real supplied advance, unlike a changed mission label, may clear stall.
  const advancing=fresh('campaign-real-progress'),advance=H.chooseAction(advancing.observation());
  advance.planner.memory.campaign.stalled=5;const priorGap=advance.planner.memory.campaign.bestGap;
  assert.ok(advancing.act(advance));while(advancing.turn!==1)assert.ok(advancing.act({type:'rest',cells:[]}));
  const after=H.chooseAction(advancing.observation()).planner.memory.campaign;
  assert.ok(after.bestGap<priorGap);assert.equal(after.stalled,0);assert.equal(after.lastProgressPly,advancing.ply);
});

test('campaign memory is bounded, private, mutation isolated, and cleared by reset',()=>{
  const g=fresh('campaign-private-bounds'),action=H.chooseAction(g.observation());assert.ok(action.planner.memory.campaign);
  assert.ok(g.act(action));const saved=JSON.stringify(g.plannerStates[1].campaign),own=g.observation(1);
  assert.ok(own.plannerMemory.campaign.path.length<=H.PLANNER_LIMITS.privatePath);
  own.plannerMemory.campaign.path.push(-1);action.planner.memory.campaign.path.push(-1);
  assert.equal(JSON.stringify(g.plannerStates[1].campaign),saved);
  for(const viewer of [0,2]){const obs=g.observation(viewer);assert.equal(obs.plannerMemory,null);assert.equal('campaign' in obs.intents[1],false);}
  while(g.turn!==1)assert.ok(g.act({type:'rest',cells:[]}));
  const malformed=H.chooseAction(g.observation());malformed.planner.memory.campaign={path:Array(10000).fill(1),remaining:Infinity,bestRemaining:NaN,initialRemaining:-1,gap:Infinity,bestGap:-1,stalled:Infinity,age:Infinity,committedAtPly:Infinity,lastProgressPly:-1,hiddenHand:['destroy']};
  assert.ok(g.act({...malformed,type:'rest',cells:[]}));const bounded=g.plannerStates[1].campaign;
  assert.ok(bounded.path.length<=64);finite(bounded);assert.equal('hiddenHand' in bounded,false);
  g.reset();assert.ok(g.plannerStates.every(x=>x===null));
});

test('own goal routes survive every searched beam depth during actual changing play',()=>{
  const g=fresh('campaign-route-beam-retention');let reused=0;
  for(let i=0;i<60;i++){
    const view=g.observation(),action=H.chooseAction(view),d=action.planner.diagnostics,c=action.planner.memory.campaign;
    assert.ok(H.legalAction(view,action));assert.deepEqual(d.routeBeamDepths,[1,2,3]);
    assert.ok(c.path.length>1&&c.path.length<=64);assert.ok(H.goalCell(g,g.turn,c.path.at(-1)));
    assert.ok(d.nodes<=H.PLANNER_LIMITS.nodes);finite(c);reused+=Number(d.reusedIntent);
    assert.ok(g.act(action));g.advanceTime(300);
  }
  assert.ok(reused>0);
});

test('late campaign planning executes a supplied flank around a defended wall',()=>{
  const g=fresh('campaign-late-flank');canonicalHomes(g,H);g.board.set(g.anchors);g.terrain.fill(0);g.roads.fill(0);g.shields.fill(0);g.turrets=[];g.bridges=[];
  g.ply=1200;g.round=200;g.players[1].energy=8;g.hands[1]=Array(5).fill('reroute');
  for(const i of route(g,1,at(4,-2)))g.board[i]=1;
  for(const c of H.CELLS)if(c.q>=0&&c.q<=2&&c.r>=-5&&c.r<=3)g.board[c.i]=2;
  for(const i of route(g,2,at(2,3)))g.board[i]=2;
  const original=g.board.slice(),actions=[];
  for(let n=0;n<24;n++){
    while(g.turn!==1)assert.ok(g.act({type:'rest',cells:[]}));
    const action=H.chooseAction(g.observation());assert.ok(g.act(action));actions.push({type:action.type,cells:action.cells});
    const supplied=H.computeSupply(g,1);
    if(H.CELLS.some(c=>c.q<0&&supplied[c.i]))break;
  }
  const supplied=H.computeSupply(g,1),bypass=H.CELLS.filter(c=>supplied[c.i]&&original[c.i]!==1&&(c.r<-5||c.r>3));
  assert.ok(bypass.length>=3,JSON.stringify(actions));assert.ok(H.CELLS.some(c=>c.q<0&&supplied[c.i]),JSON.stringify(actions));
});
