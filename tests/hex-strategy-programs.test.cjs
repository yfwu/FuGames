'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),H=require('../autohex-engine.js'),S=require('../hex-strategies.js');
const {canonicalHomes}=require('./helpers/hex-tactical-fixture.cjs'),at=H.index;
function fresh(seed,modify=()=>{}){const config=structuredClone(S.DEFAULT_CONFIG);modify(config.profiles[0]);const g=new H.Game({seed,strategyConfig:config,terrain:'classic',neutralEvents:false});g.start();canonicalHomes(g,H);g.board.set(g.anchors);g.terrain.fill(0);g.hands[1]=[];g.handAges[1]=[];g.players[1].energy=8;g.players[1].supplies=6;g._draw=()=>{};return g;}
function route(g,p,target,permit=()=>true){const prev=new Int32Array(H.COUNT).fill(-2),q=[g.players[p].home];prev[q[0]]=-1;for(let n=0;n<q.length&&prev[target]===-2;n++)for(const j of H.ADJ[q[n]])if(prev[j]===-2&&(!g.board[j]||g.board[j]===p)&&permit(j)){prev[j]=q[n];q.push(j);}if(prev[target]===-2)return null;const a=[];for(let i=target;i!==-1;i=prev[i])a.push(i);return a.reverse();}
function fill(g,p,cells){assert.ok(cells);for(const i of cells)g.board[i]=p;}
function holds(g,p=1){const s=H.computeSupply(g,p);return H.CELLS.some(c=>s[c.i]&&H.goalCell(g,p,c.i));}
function own(g){while(g.turn!==1)assert.ok(g.act({type:'rest',cells:[]}));}
function act(g){own(g);const a=H.chooseAction(g.observation());assert.ok(H.legalAction(g,a));assert.ok(g.act(a));return a;}
function transportPuzzle(transport,threat=false){
 const g=fresh('transport-policy',p=>{p.route.transport=transport;p.airport.mode='avoid';});g.airports=[];g.depots=[];
 const main=route(g,1,at(-18,0)),k=main.length-5;fill(g,1,main);for(const i of main.slice(k,k+2)){g.board[i]=0;g.terrain[i]=1;}
 const tunnel=main.slice(k-1,k+3);for(const c of H.CELLS)if(!g.board[c.i]&&H.distance(c.i,tunnel[1])<=3)g.terrain[c.i]=1;
 if(threat){const enemy=H.CELLS.find(c=>!g.board[c.i]&&H.distance(c.i,tunnel[1])===4&&main.every(i=>H.distance(c.i,i)>1));assert.ok(enemy);const support=route(g,2,enemy.i);fill(g,2,support);for(const i of support)g.terrain[i]=0;assert.equal(H.computeSupply(g,2)[enemy.i],1);}
 assert.equal(holds(g),false);assert.ok(H.tunnelLegal(g,1,tunnel));return{g,tunnel};
}
function airportPuzzle(mode='invest',budget=18){
 const g=fresh('planner-airport-purpose',p=>{p.airport.mode=mode;p.airport.maxOwnActions=budget;p.airport.projection='bombard';});
 const airport=g.airports.slice().sort((a,b)=>H.distance(g.players[1].home,a.cell)-H.distance(g.players[1].home,b.cell))[0].cell;fill(g,1,route(g,1,airport));
 const cluster=()=>{const q=[airport],seen=new Set(q);for(let n=0;n<q.length;n++)for(const j of H.ADJ[q[n]])if(!seen.has(j)&&g.board[j]===1&&H.distance(j,airport)<=4){seen.add(j);q.push(j);}return q;};
 while(cluster().length<8){const cells=cluster(),choices=H.CELLS.filter(c=>!g.board[c.i]&&H.distance(c.i,airport)<=3&&H.ADJ[c.i].some(j=>cells.includes(j))).sort((a,b)=>H.distance(a.i,g.players[1].home)-H.distance(b.i,g.players[1].home)||a.i-b.i);g.board[choices[0].i]=1;}
 fill(g,1,route(g,1,at(-4,-7),i=>H.distance(i,airport)>4||g.board[i]===1));g._refreshFacilities();let enemy;
 for(const p of H.PLAYERS.slice(1)){for(const c of H.CELLS)if(H.goalCell(g,p,c.i)&&H.distance(airport,c.i)<=12){const cells=route(g,p,c.i,i=>!H.inRange(g,1,i));if(cells){fill(g,p,cells);enemy=p;break;}}if(enemy)break;}
 assert.ok(enemy);assert.ok(holds(g,enemy));assert.equal(H.airportStatus(g,airport).cluster,8);return{g,airport,enemy};
}

test('external transport programs execute different real routes on the identical supplied river-gap puzzle',()=>{
 const ground=transportPuzzle('ground'),tunnel=transportPuzzle('tunnel'),runs=[];
 assert.deepEqual(ground.g.board,tunnel.g.board);assert.deepEqual(ground.g.terrain,tunnel.g.terrain);
 for(const f of [ground,tunnel]){const actions=[];for(let n=0;n<8&&!holds(f.g);n++)actions.push(act(f.g));assert.ok(holds(f.g),JSON.stringify(actions.map(a=>({type:a.type,cells:a.cells}))));runs.push(actions);}
 assert.equal(runs[0].some(a=>['tunnel','bridge'].includes(a.type)),false);assert.ok(runs[0].some(a=>a.type==='engineer'));
 assert.ok(runs[1].some(a=>a.type==='tunnel'));assert.ok(runs[1].length<runs[0].length);assert.notEqual(ground.g.strategyConfigId,tunnel.g.strategyConfigId);
});

test('a public opponent can sabotage the tempting tunnel; the planner instead completes a durable ground repair',()=>{
 const{g,tunnel}=transportPuzzle('tunnel',true),view=g.observation(),sim=H.createPublicSimulation(view,1);assert.ok(sim.act({type:'tunnel',cells:tunnel}));
 const sabotage=tunnel.slice(1,-1).find(i=>H.legalAction(sim,{type:'engineer',cells:[i]}));assert.ok(sabotage!==undefined);assert.ok(sim.act({type:'engineer',cells:[sabotage]}));assert.equal(sim.tunnels.length,0);assert.equal(holds(sim),false);
 const actions=[];for(let n=0;n<8&&!holds(g);n++){actions.push(act(g));if(g.tunnels.length){const i=g.tunnels[0].path.slice(1,-1).find(i=>H.legalAction(g,{type:'engineer',cells:[i]}));if(i!==undefined)assert.ok(g.act({type:'engineer',cells:[i]}));}}
 assert.ok(holds(g),JSON.stringify(actions.map(a=>({type:a.type,cells:a.cells}))));assert.ok(actions.some(a=>a.type==='engineer'));assert.ok(actions.filter(a=>a.type==='tunnel').length<=1,'Must not loop rebuilding a predictably sabotaged tunnel: '+JSON.stringify(actions.map(a=>({type:a.type,cells:a.cells,intent:a.planner.memory.strategy}))));
});

test('external airport investment executes its paid follow-on while avoid chooses ground actions on the same public board',()=>{
 const invest=airportPuzzle('invest'),avoid=airportPuzzle('avoid');assert.deepEqual(invest.g.board,avoid.g.board);assert.deepEqual(invest.g.airports,avoid.g.airports);const sequences=[];
 for(const f of [invest,avoid]){const actions=[];for(let n=0;n<14;n++){const a=act(f.g);actions.push(a);if(f.g.telemetry.bombardments&&!holds(f.g,f.enemy))break;}sequences.push(actions);}
 assert.ok(sequences[0].some(a=>a.type==='bombard'),JSON.stringify(sequences[0].map(a=>({type:a.type,cells:a.cells,intent:a.planner.memory.strategy,stage:a.planner.memory.stage,target:a.planner.memory.target,follow:a.planner.memory.followTarget}))));assert.ok(invest.g.telemetry.airportUnlocks>0);assert.equal(holds(invest.g,invest.enemy),false);
 assert.equal(sequences[1].some(a=>['airdrop','bombard'].includes(a.type)),false);assert.equal(sequences[1].some(a=>a.planner.memory.strategy==='airport'),false);assert.ok(sequences[1].some(a=>a.type==='deploy'));
});

test('airport investment budget survives forced mission reviews and enforces twelve owner turns of cooldown',()=>{
 const{g}=airportPuzzle('invest',6);let selected=0,reached=false,deadline;
 for(let n=0;n<18;n++){own(g);if(g.plannerStates[1])g.plannerStates[1].reviewAtPly=g.ply;const a=act(g),m=g.plannerStates[1];selected+=Number(a.planner.memory.strategy==='airport');assert.equal(m.program.airportSpent,selected);assert.ok(selected<=6);if(selected===6){reached=true;break;}}
 assert.ok(reached,'Fixture must exercise the actual six-action investment cap');
 for(let n=0;n<12;n++){own(g);const ply=g.ply;if(g.plannerStates[1])g.plannerStates[1].reviewAtPly=ply;const a=act(g),program=g.plannerStates[1].program;if(n===0)deadline=ply+6*12;assert.equal(program.airportCooldownUntilPly,deadline);assert.equal(program.airportSpent,6);assert.notEqual(a.planner.memory.strategy,'airport');}
});

test('accepted program memory is private, cloned, finite, resettable and cannot commit with an illegal action',()=>{
 const{g}=airportPuzzle(),a=H.chooseAction(g.observation()),before=JSON.stringify(g);assert.equal(g.act({...a,cells:[-1]}),false);assert.equal(JSON.stringify(g),before);assert.ok(g.act(a));
 const saved=JSON.stringify(g.plannerStates[1].program),view=g.observation(1);a.planner.memory.program.airportSpent=999;view.plannerMemory.program.airportSpent=999;assert.equal(JSON.stringify(g.plannerStates[1].program),saved);
 for(const p of [0,2]){const obs=g.observation(p);assert.equal(obs.plannerMemory,null);assert.equal('program' in obs.intents[1],false);}
 own(g);const next=H.chooseAction(g.observation());next.planner.memory.program.airportSpent=Infinity;next.planner.memory.program.airportCooldownUntilPly=Infinity;next.planner.memory.program.secret=['destroy'];assert.ok(g.act({...next,type:'rest',cells:[]}));const program=g.plannerStates[1].program;assert.ok(Number.isFinite(program.airportSpent)&&program.airportSpent<=24);assert.ok(Number.isFinite(program.airportCooldownUntilPly));assert.equal('secret' in program,false);g.reset();assert.ok(g.plannerStates.every(x=>x===null));
});
