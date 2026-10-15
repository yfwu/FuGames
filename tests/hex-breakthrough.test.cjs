'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Core=require('../hex-core.js'),S=require('../hex-strategies.js');
const {fixture}=require('./helpers/hex-breakthrough-fixture.cjs');
function nextOwn(g){while(g.phase==='running'&&g.turn!==1)assert.ok(g.act({type:'rest',cells:[]}));}
for(const mode of ['auto','normal']){
 test(`${mode}: public reserve telegraphs one target, then captures through defense with one point`,()=>{
  const {H,g,target}=fixture(mode);assert.equal(H.legalAction(g,{type:'deploy',cells:[target]}),false);
  assert.ok(g.act({type:'breach',cells:[target]}));assert.equal(g.players[1].energy,2);assert.equal(g.board[target],2);assert.equal(g.players[1].score,0);
  for(const p of H.PLAYERS)assert.equal(g.observation(p).players[1].breachTarget,target);
  nextOwn(g);assert.ok(H.breachBoost(g,1,target));assert.ok(g.act({type:'deploy',cells:[target]}));assert.equal(g.board[target],1);assert.equal(g.players[1].score,1);assert.equal(g.players[1].breachTarget,-1);assert.ok(g.players[1].breachUsed);
  assert.equal(g.phase,mode==='normal'?'over':'running');if(mode==='normal')assert.equal(g.result.reason,'connection');
 });
 test(`${mode}: shield, loss of supplied adjacency, anchors and allies counter the bonus`,()=>{
  for(const counter of (mode==='auto'?['shield','cut','anchor','alliance']:['shield','cut','anchor'])){
   const {H,g,target,source}=fixture(mode);g.act({type:'breach',cells:[target]});nextOwn(g);
   if(counter==='shield')g.shields[target]=8;if(counter==='cut')g.board[source]=0;if(counter==='anchor')g.anchors[target]=2;if(counter==='alliance')g.alliances.push({a:1,b:2,expiresRound:g.round+10});
   assert.equal(H.breachBoost(g,1,target),false,counter);assert.equal(H.legalAction(g,{type:'deploy',cells:[target]}),false,counter);
  }
 });
 test(`${mode}: reserve cannot repeat, expires on another action, invalid clicks spend nothing`,()=>{
  const {H,g,target}=fixture(mode),before=JSON.stringify(g.observation());assert.equal(g.act({type:'breach',cells:[g.players[2].home]}),false);assert.equal(JSON.stringify(g.observation()),before);
  g.act({type:'breach',cells:[target]});nextOwn(g);g.act({type:'rest',cells:[]});nextOwn(g);assert.equal(g.players[1].breachTarget,-1);assert.equal(H.legalAction(g,{type:'breach',cells:[target]}),false);assert.equal(H.legalAction(g,{type:'deploy',cells:[target]}),false);
 });
 test(`${mode}: live and public simulation resolve the same warning and capture without hidden hands`,()=>{
  const {H,g,target}=fixture(mode),view=g.observation(),sim=H.createPublicSimulation(view,1);assert.deepEqual(sim.players[1],view.players[1]);
  for(const x of [g,sim]){assert.ok(x.act({type:'breach',cells:[target]}));nextOwn(x);assert.ok(x.act({type:'deploy',cells:[target]}));}
  assert.deepEqual([...sim.board],[...g.board]);assert.deepEqual(sim.players[1],g.players[1]);assert.equal(view.players[1].breachReady,true);assert.equal(view.players[1].breachTarget,-1);
 });
 test(`${mode}: AI primes and uses a route-relevant reserve within the fixed search budget`,()=>{
  const {H,g,target}=fixture(mode);let a=H.chooseAction(g.observation());assert.equal(a.type,'breach',JSON.stringify({type:a.type,cells:a.cells,reason:a.planner?.memory.reasonCode}));assert.equal(a.cells[0],target);assert.ok(a.planner.diagnostics.nodes<=H.PLANNER_LIMITS.nodes);g.act(a);nextOwn(g);a=H.chooseAction(g.observation());assert.equal(a.type,'deploy');assert.equal(a.cells[0],target);g.act(a);assert.ok(H.computeSupply(g,1)[target]);
 });
 test(`${mode}: late stagnation unlocks once, progress resets the clock, reached factions receive no reserve`,()=>{
  const H=Core.create({mode,playerCount:6}),g=new H.Game({seed:'unlock',neutralEvents:false});g.start();const t=g.strategyConfig.tactics;
  for(let n=0;n<t.breachMinOwnTurns-1;n++){g.act({type:'rest',cells:[]});nextOwn(g);}assert.equal(g.players[1].breachReady,false);
  g.act({type:'rest',cells:[]});nextOwn(g);assert.equal(g.players[1].breachReady,true);
  const p=g.players[1];p.breachReady=false;p.breachStalled=5;p.breachBestGap=H.RADIUS*2;p.completedActions=30;g._updateBreach(1);assert.equal(p.breachStalled,0);assert.equal(p.breachReady,false);
  p.reached=true;p.breachStalled=30;g._updateBreach(1);assert.equal(p.breachReady,false);g.reset();assert.equal(g.players[1].breachReady,false);assert.equal(g.players[1].breachUsed,false);
 });
}
test('shared tactics are optional for old JSON, strictly bounded, and identity tracked',()=>{
 const c=structuredClone(S.DEFAULT_CONFIG);delete c.tactics;assert.deepEqual(S.normalize(c).tactics,S.DEFAULT_CONFIG.tactics);
 for(const value of [NaN,Infinity,-1,61,12.5]){const x=structuredClone(c);x.tactics={...S.DEFAULT_CONFIG.tactics,breachMinOwnTurns:value};assert.throws(()=>S.normalize(x));}
 const x=structuredClone(c);x.tactics={...S.DEFAULT_CONFIG.tactics,contactBonus:3};assert.notEqual(S.id(x),S.id(c));
});
test('a temporary repair does not reset campaign stall below its historical best route',()=>{
 const H=Core.create({mode:'auto',playerCount:6}),g=new H.Game({seed:'record-progress',neutralEvents:false});g.start();const view=g.observation(),a=H.chooseAction(view),m=structuredClone(a.planner.memory);
 m.campaign.bestRemaining=m.campaign.remaining-3;m.campaign.remaining+=3;m.campaign.stalled=2;
 const b=H.chooseAction({...view,plannerMemory:m});assert.equal(b.planner.memory.campaign.stalled,3);assert.equal(b.planner.memory.campaign.bestRemaining,m.campaign.bestRemaining);
});
test('AI does not spend a breakthrough whose only supplied entrance can be captured in the warning round',()=>{
 const {H,g,source}=fixture('auto');g.terrain[source]=0;assert.ok(H.combatStrength(g,2,source).attack>=H.combatStrength(g,2,source).defense);
 const a=H.chooseAction(g.observation());assert.notEqual(a.type,'breach');assert.ok(H.legalAction(g,a));
});
