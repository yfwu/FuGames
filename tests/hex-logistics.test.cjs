'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Core=require('../hex-core.js');
for(const mode of ['normal','auto']) {
 const H=Core.create({mode,playerCount:6}),at=H.index;
 function fixture(){const g=new H.Game({seed:'supply-contract',terrain:'classic',neutralEvents:false});g.start();g.board.fill(0);g.anchors.fill(0);g.reserve.fill(0);g.terrain.fill(0);g.bridges=[];g.tunnels=[];g.turrets=[];g.airports=[];g.depots=[];g._draw=()=>{};g.players[1].home=at(0,0);g.board[at(0,0)]=g.anchors[at(0,0)]=1;g.reserve[at(0,0)]=6;g.players[1].supplies=24;g.players[1].energy=8;return g;}
 function put(g,q,r,reserve=6,p=1){const i=at(q,r);g.board[i]=p;g.reserve[i]=reserve;return i;}
 const total=g=>g.players[1].supplies+Array.from(g.board).reduce((n,p,i)=>n+(p===1?g.reserve[i]:0),0);
 test(`${mode}: bounded transport conserves stock, shares bottleneck capacity and uses a second route`,()=>{
  const g=fixture();const neck=put(g,1,0);for(let q=2;q<=6;q++)put(g,q,0,0);
  const before=JSON.stringify(g),f=H.supplyDelivery(g,1);assert.equal(JSON.stringify(g),before);
  assert.equal(f.spent,4);assert.equal(f.load[neck],4);assert.equal(f.delivered.reduce((a,b)=>a+b,0),f.spent);assert.ok(f.haul<=96);assert.ok(f.delivered.every(n=>n<=2));assert.ok(f.load.every(n=>n<=4));
  for(let q=0;q<=5;q++)put(g,q,1);
  const alternate=H.supplyDelivery(g,1);assert.ok(alternate.spent>f.spent);assert.ok(alternate.load[neck]<=4);
  const sum=total(g);g._settleSupply(1);assert.equal(total(g),sum);assert.equal(g.players[1].deliveredSupply,alternate.spent);assert.ok(g.reserve.every(n=>n<=6));
 });
 test(`${mode}: long transport spends physical distance including bridges, with finite stock`,()=>{
  const g=fixture();for(let q=1;q<=H.RADIUS;q++)put(g,q,0,q===H.RADIUS?0:6);
  let f=H.supplyDelivery(g,1);assert.equal(f.spent,2);assert.equal(f.haul,2*H.RADIUS);
  g.players[1].supplies=1;f=H.supplyDelivery(g,1);assert.equal(f.spent,1);assert.equal(f.haul,H.RADIUS);
  g.bridges=[{owner:1,a:at(0,0),b:at(3,0)}];g.board[at(1,0)]=g.board[at(2,0)]=0;f=H.supplyDelivery(g,1);assert.equal(f.haul,H.RADIUS);
 });
 test(`${mode}: bent tunnel haul pays its full path, and fortification spends local reserves`,()=>{
  const g=fixture(),front=put(g,2,0,0);g.tunnels=[{owner:1,a:at(0,0),b:front,path:[at(0,0),at(0,1),at(1,1),front]}];
  const f=H.supplyDelivery(g,1);assert.equal(f.spent,2);assert.equal(f.haul,6);
  g.tunnels=[];g.reserve[front]=3;g.hands[1]=['shield'];g.handAges[1]=[0];const sum=total(g);
  assert.ok(g.act({type:'shield',cells:[front]}));assert.equal(g.reserve[front],1);assert.equal(total(g),sum-2); // one build, one isolated upkeep
  g.turn=1;g.reserve[front]=0;g.hands[1]=['turret'];g.handAges[1]=[0];g.players[1].energy=8;
  assert.equal(g.act({type:'turret',cells:[front]}),false);
 });
 test(`${mode}: cutoff consumes actual reserve, reconnect refills gradually, and empty reserves retreat`,()=>{
  const g=fixture(),neck=put(g,1,0),front=put(g,2,0,3);g._remove(neck);
  g._settleSupply(1);assert.equal(g.board[front],1);assert.equal(g.reserve[front],2);assert.equal(g.delivered[front],0);
  g._settleSupply(1);assert.equal(g.reserve[front],1);put(g,1,0);g._settleSupply(1);assert.equal(g.reserve[front],3);assert.equal(g.unsupplied[front],0);assert.equal(g.delivered[front],2);
  g._remove(neck);for(let n=0;n<2;n++){g._settleSupply(1);assert.equal(g.board[front],1);}g._settleSupply(1);assert.equal(g.board[front],0);
 });
 test(`${mode}: deployment transfers paid rations and unsupported raiders cannot multiply`,()=>{
  const g=fixture(),raider=put(g,6,0,4),target=at(7,0);const sum=total(g);assert.ok(g.act({type:'deploy',cells:[target]}));assert.equal(g.board[raider],0);assert.equal(g.reserve[target],3);assert.equal(total(g),sum-1); // capped stock, transfer plus isolated travel cost
  g.turn=1;g.players[1].energy=8;g.reserve[target]=3;const before=JSON.stringify(g);assert.equal(g.act({type:'deploy',cells:[at(8,0)]}),false);assert.equal(JSON.stringify(g),before);
 });
 test(`${mode}: shields and turrets share local reserves, depletion removes bonuses and prevents fire`,()=>{
  const g=fixture(),gun=put(g,2,0,2),enemy=put(g,3,0,3,2);g.shields[enemy]=8;g.turrets=[{cell:gun,owner:1,life:30,countdown:1}];
  g._beginTurn();assert.equal(g.reserve[gun],0);assert.equal(g.reserve[enemy],2);assert.equal(g.shields[enemy],0);assert.equal(g.telemetry.turretShots,1);
  g.turrets[0].countdown=1;g._beginTurn();assert.equal(g.telemetry.turretShots,1);assert.equal(g.board[enemy],2);
  g.shields[enemy]=5;g.reserve[enemy]=0;assert.equal(H.combatStrength(g,1,enemy).defense,1);assert.equal(H.combatStrength(g,1,enemy).attack,0);
  g._damage(1,enemy,'demolition');assert.equal(g.board[enemy],0);
 });
 test(`${mode}: supply state survives public simulation, pause and reset without aliasing`,()=>{
  const g=fixture(),front=put(g,1,0,1),view=g.observation(),sim=H.createPublicSimulation(view);sim._settleSupply(1);g._settleSupply(1);
  for(const k of ['reserve','delivered','supplyLoad'])assert.deepEqual(sim[k],g[k]);assert.deepEqual(sim.players[1],g.players[1]);view.reserve[front]=99;assert.notEqual(g.reserve[front],99);
  g.pause();const before=JSON.stringify(g);assert.equal(g.act({type:'rest',cells:[]}),false);assert.equal(JSON.stringify(g),before);g.reset();assert.equal(g.players[1].supplies,12);assert.ok(g.delivered.every(x=>!x));
 });
 test(`${mode}: AI never raids with empty reserves and chooses a legal recovery action`,()=>{
  const g=fixture();for(let q=1;q<=4;q++)put(g,q,0);put(g,5,0,0);put(g,6,0,4,2);g.reserve[at(4,0)]=0;g.hands[1]=['destroy','turret'];g.handAges[1]=[0,0];g._countStones();
  const a=H.chooseAction(g.observation());assert.ok(H.legalAction(g,a));assert.ok(g.act(a));assert.ok(g.reserve.every(n=>n<=6));assert.notEqual(g.reserve[at(5,0)],0);
 });
}
