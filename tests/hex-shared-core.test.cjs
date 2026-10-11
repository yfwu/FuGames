'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Core=require('../hex-core.js');
const modes=['normal','auto'];
function setup(mode='normal',n=6,options={}){
  const H=Core.create({mode,playerCount:n}),g=new H.Game({seed:'shared-contract',terrain:'classic',neutralEvents:false,...options});g.start();return {H,g,at:H.index};
}
function clean(mode='normal',n=6){const x=setup(mode,n),{g,H}=x;g.board.set(g.anchors);g.hillAge.fill(0);g.turrets=[];g.bridges=[];g.tunnels=[];g.airports=[];g.depots=[];g.offers=[];g.alliances=[];g._draw=()=>{};for(const p of H.PLAYERS){g.hands[p]=[];g.handAges[p]=[];g.players[p].energy=8;}return x;}
function hand(g,p,cards){g.hands[p]=cards.slice();g.handAges[p]=cards.map(()=>0);}
function invalid(H,g,a){const before=JSON.stringify(g);assert.equal(H.legalAction(g.observation(),a),false,JSON.stringify(a));assert.equal(g.act(a),false);assert.equal(JSON.stringify(g),before);}
function ownTurn(g,p=1){for(let n=0;g.turn!==p&&n<6;n++)assert.ok(g.act({type:'rest',cells:[]}));assert.equal(g.turn,p);}
function pathTo(H,g,p,target,permit=()=>true){const prev=new Int32Array(H.COUNT).fill(-2),q=[g.players[p].home];prev[q[0]]=-1;for(let n=0;n<q.length&&prev[target]===-2;n++)for(const j of H.ADJ[q[n]])if(prev[j]===-2&&(!g.board[j]||g.board[j]===p)&&permit(j)){prev[j]=q[n];q.push(j);}assert.notEqual(prev[target],-2);const cells=[];for(let i=target;i!==-1;i=prev[i])cells.push(i);return cells.reverse();}
function fill(g,p,cells){for(const i of cells)g.board[i]=p;}
function goalPath(H,g,p){for(const c of H.CELLS)if(H.goalCell(g,p,c.i)&&(!g.board[c.i]||g.board[c.i]===p)){try{return pathTo(H,g,p,c.i);}catch{}}assert.fail('Expected available goal route');}
function physical(H,g){return [...g.drawPile,...g.discardPile,...H.PLAYERS.flatMap(p=>g.hands[p])].sort();}

test('shared factories isolate geometries and all2–6active seat clocks, homes and directed goals',()=>{
  for(let n=2;n<=6;n++){
    const {H,g}=setup('normal',n,{first:n});assert.equal(H.COUNT,271);assert.equal(H.RADIUS,9);assert.equal(H.PLAYERS.length,n);assert.equal(g.turn,n);
    assert.deepEqual(g.observation().coreConfig,H.CORE_CONFIG);assert.equal(new Set(g.players.filter(Boolean).map(p=>p.home)).size,n);
    assert.deepEqual([...new Set(Array.from(g.anchors).filter(Boolean))].sort(),H.PLAYERS.slice().sort());
    for(const p of H.PLAYERS){const player=g.players[p],home=H.CELLS[player.home];assert.equal(home[player.axis],9*player.sign);const goals=H.CELLS.filter(c=>H.goalCell(g,p,c.i));assert.equal(goals.length,10);assert.ok(goals.every(c=>c[player.axis]===-9*player.sign));}
    const round=g.round,seen=[];for(let i=0;i<n;i++){seen.push(g.turn);assert.ok(g.act({type:'rest',cells:[]}));}
    assert.equal(new Set(seen).size,n);assert.equal(g.round,round+1);assert.equal(g.turn,n);assert.ok(H.PLAYERS.every(p=>g.players[p].completedActions===1));
  }
  const small=setup('normal',2),large=setup('auto');assert.equal(large.H.COUNT,1027);assert.equal(large.H.PLAYERS.length,6);small.g.board[small.at(0,0)]=1;assert.equal(large.g.board[large.at(0,0)],0);
});

test('every spatial selection uses own pre-action radius5 independently of straight bridge span2–3',()=>{
  for(const mode of modes){
    const {H,g,at}=clean(mode);g.board[at(0,0)]=1;
    assert.equal(H.legalAction(g.observation(),{type:'deploy',cells:[at(-5,0)]}),true);
    const remote=H.CELLS.find(c=>!g.board[c.i]&&H.distance(c.i,at(0,0))===6&&H.distance(c.i,g.players[1].home)>5);
    assert.ok(remote);const enemy=H.ADJ[remote.i].find(i=>!g.board[i]);g.board[enemy]=2;invalid(H,g,{type:'deploy',cells:[remote.i]});
    for(const span of [2,3,4,5]){const f=clean(mode);f.g.board[f.at(0,0)]=f.g.board[f.at(span,0)]=1;hand(f.g,1,['bridge']);assert.equal(f.H.inRange(f.g,1,f.at(span,0)),true);assert.equal(f.H.legalAction(f.g.observation(),{type:'bridge',cells:[f.at(0,0),f.at(span,0)]}),span<=3);}
    const f=clean(mode);f.g.board[f.at(0,0)]=f.g.board[f.at(1,1)]=1;hand(f.g,1,['bridge']);invalid(f.H,f.g,{type:'bridge',cells:[f.at(0,0),f.at(1,1)]});
  }
});

test('both modes reject every-owner surface duplicate, reverse, overlap, crossing andT but share true endpoints',()=>{
  const fixtures=[[[0,0],[3,0],[0,0],[3,0],true],[[0,0],[3,0],[3,0],[0,0],true],[[0,0],[3,0],[1,0],[4,0],true],[[0,0],[3,0],[1,-1],[1,1],true],[[0,0],[3,0],[1,0],[1,2],true],[[0,0],[3,0],[3,0],[3,-2],false]];
  for(const mode of modes)for(const [aa,bb,cc,dd,conflict] of fixtures)for(const owner of [1,2]){
    const {H,g,at}=clean(mode),[a,b,c,d]=[aa,bb,cc,dd].map(x=>at(...x));g.bridges=[{owner,a,b}];g.board[c]=g.board[d]=1;hand(g,1,['bridge']);assert.equal(H.bridgeConflict(a,b,c,d),conflict);assert.equal(H.legalAction(g.observation(),{type:'bridge',cells:[c,d]}),!conflict);
  }
});

test('bent tunnels provide an actual owner-only supply edge without claiming or terraforming interiors',()=>{
  for(const mode of modes){const {H,g,at}=clean(mode),cells=[[0,0],[1,0],[1,1],[2,1]].map(x=>at(...x)),[a,,,b]=cells;
    fill(g,1,pathTo(H,g,1,a,i=>H.distance(i,b)>1));g.board[b]=1;g.board[cells[2]]=2;g.terrain[cells[1]]=1;g.terrain[cells[2]]=2;
    assert.equal(H.computeSupply(g,1)[b],0);const board=Array.from(g.board),terrain=Array.from(g.terrain),energy=g.players[1].energy;
    assert.ok(g.act({type:'tunnel',cells}));assert.equal(g.players[1].energy,energy-4);assert.equal(g.tunnels.length,1);assert.deepEqual(g.tunnels[0].path,cells);assert.equal(H.computeSupply(g,1)[b],1);
    assert.deepEqual(Array.from(g.board),board);assert.deepEqual(Array.from(g.terrain),terrain);assert.equal(H.computeSupply(g,2)[b],0);
    assert.deepEqual(g.observation(0).tunnels[0].path,cells);
  }
});

test('tunnel path bounds reject jumps, loops, repeats andfour edges even when endpoints are nearby',()=>{
  for(const mode of modes)for(const coordinates of [[[0,0],[1,0]],[[0,0],[2,0],[2,1]],[[0,0],[1,0],[0,0],[1,1]],[[0,0],[1,0],[1,1],[2,1],[2,0]],[[0,0],[1,0],[0,1]]]){
    const {H,g,at}=clean(mode),cells=coordinates.map(x=>at(...x));g.board[cells[0]]=g.board[cells.at(-1)]=1;invalid(H,g,{type:'tunnel',cells});
  }
});

test('tunnel interiors exclude anchors, facilities, turrets andother tunnels; surface crossings remain legal',()=>{
  for(const mode of modes){for(const obstruction of ['anchor','airport','depot','turret','tunnel']){
    const {H,g,at}=clean(mode),cells=[at(0,0),at(1,0),at(1,1)];g.board[cells[0]]=g.board[cells[2]]=1;const i=cells[1];
    if(obstruction==='anchor'){g.anchors[i]=2;g.board[i]=2;}if(obstruction==='airport')g.airports=[{cell:i}];if(obstruction==='depot')g.depots=[{cell:i}];if(obstruction==='turret'){g.board[i]=2;g.turrets=[{owner:2,cell:i,countdown:3,life:30}];}if(obstruction==='tunnel')g.tunnels=[{id:1,owner:2,a:i,b:at(3,0),path:[i,at(2,0),at(3,0)]}];
    invalid(H,g,{type:'tunnel',cells});
  }
  const {H,g,at}=clean(mode),cells=[at(0,0),at(1,0),at(1,1)];g.board[cells[0]]=g.board[cells[2]]=1;g.bridges=[{owner:2,a:at(1,-1),b:at(1,2)}];assert.equal(H.legalAction(g.observation(),{type:'tunnel',cells}),true);
  }
});

test('public tunnel counterplay costs two energy, honors pacts, andendpoint loss immediately collapses it',()=>{
  for(const mode of modes)for(const method of ['engineer','destroy']){
    const {H,g,at}=clean(mode),cells=[at(0,0),at(1,0),at(1,1)];g.board[cells[0]]=g.board[cells[2]]=1;g.board[at(2,0)]=2;g.terrain[cells[1]]=1;
    assert.ok(g.act({type:'tunnel',cells}));assert.equal(g.turn,2);const target=method==='engineer'?cells[1]:cells[2];if(method==='destroy')hand(g,2,['destroy']);
    if(mode==='auto'){g.alliances=[{a:1,b:2,expiresRound:99}];if(method==='engineer')g.terrain[target]=0;invalid(H,g,{type:method,cells:[target]});if(method==='engineer')g.terrain[target]=1;g.alliances=[];}
    const energy=g.players[2].energy;assert.ok(g.act({type:method,cells:[target]}));assert.equal(g.tunnels.length,0);if(method==='engineer'){assert.equal(g.players[2].energy,energy-2);assert.equal(g.terrain[target],1);assert.equal(g.board[cells[2]],1);}
  }
});

test('engineering really converts river/hill state to ordinary terrain; bridges do not',()=>{
  for(const mode of modes)for(const terrain of [1,2]){
    const {H,g,at}=clean(mode),c=at(0,0);g.board[at(1,0)]=1;g.terrain[c]=terrain;assert.ok(g.act({type:'engineer',cells:[c]}));assert.equal(g.terrain[c],0);assert.equal(g.roads[c],0);
    ownTurn(g);assert.ok(g.act({type:'deploy',cells:[c]}));assert.equal(g.board[c],1);
    const b=clean(mode),mid=b.at(0,0);b.g.terrain[mid]=terrain;b.g.board[b.at(-1,0)]=b.g.board[b.at(1,0)]=1;hand(b.g,1,['bridge']);assert.ok(b.g.act({type:'bridge',cells:[b.at(-1,0),b.at(1,0)]}));assert.equal(b.g.terrain[mid],terrain);
  }
});

test('hill retreat counts exactlythree subsequent owner actions, while engineering ownhill stabilizes it',()=>{
  for(const n of [2,6]){const {H,g,at}=clean('normal',n),c=at(0,0);g.board[at(1,0)]=1;g.terrain[c]=2;assert.ok(g.act({type:'deploy',cells:[c]}));assert.equal(g.hillAge[c],0);
    for(let age=1;age<=3;age++){ownTurn(g);assert.equal(g.board[c],1);g.pause();const before=JSON.stringify(g);assert.equal(g.act({type:'rest',cells:[]}),false);assert.equal(JSON.stringify(g),before);g.start();assert.ok(g.act({type:'rest',cells:[]}));assert.equal(g.board[c],age<3?1:0);if(age<3)assert.equal(g.hillAge[c],age);}
  }
  for(const mode of modes){const {H,g,at}=clean(mode),c=at(0,0);g.board[c]=1;g.terrain[c]=2;g.hillAge[c]=2;assert.ok(g.act({type:'engineer',cells:[c]}));assert.equal(g.terrain[c],0);assert.equal(g.hillAge[c],0);assert.equal(g.board[c],1);}
});

test('normal mode rejects all diplomacy at the engine boundary including injected offers',()=>{
  for(let n=2;n<=6;n++){const {H,g}=clean('normal',n);g.offers=[{id:1,from:2,to:1,expiresRound:99}];g.alliances=[{a:1,b:2,expiresRound:99}];assert.equal(H.allied(g,1,2),false);
    for(const type of ['offer','accept','reject','betray'])invalid(H,g,{type,cells:[],target:2});
  }
});

test('every active seat shares one13-per-seat shoe with exactlyone shield per recipe and finite reshuffle conservation',()=>{
  const recipes=new Set();for(let n=2;n<=6;n++){const {H,g}=setup('normal',n,{seed:'shared-shoe-'+n});const expected=physical(H,g);assert.equal(expected.length,13*n);assert.equal(expected.filter(c=>c==='shield').length,n);assert.equal(g.deckRecipe.length,13);recipes.add(g.deckRecipe.join(','));
    for(let i=0;i<n*24;i++){const p=g.turn;assert.ok(g.act(g.hands[p].length?{type:'discard',cells:[],cardIndex:0}:{type:'rest',cells:[]}));assert.deepEqual(physical(H,g),expected);assert.ok(H.PLAYERS.every(p=>g.hands[p].length<=H.RULES.handCap));}
    assert.ok(g.telemetry.reshuffles>0);
  }assert.ok(recipes.size>1);
});

test('optional card expiry uses own action clocks and returns cards to the same physical shoe',()=>{
  for(const timed of [false,true])for(const n of [2,6]){const {H,g}=setup('normal',n,{timed});const expected=physical(H,g);g._draw=()=>{};const original=g.hands[1].slice();
    for(let own=1;own<=3;own++){ownTurn(g);assert.ok(g.act({type:'rest',cells:[]}));assert.deepEqual(physical(H,g),expected);if(own<3)assert.deepEqual(g.hands[1],original);}
    assert.equal(g.hands[1].length,timed?0:original.length);
  }
});

test('normal first settled connection ends immediately whileAuto continues the scored campaign',()=>{
  for(const mode of modes){const {H,g}=clean(mode),path=goalPath(H,g,1);fill(g,1,path.slice(0,-1));assert.ok(g.act({type:'deploy',cells:[path.at(-1)]}));assert.equal(g.phase,mode==='normal'?'over':'running');if(mode==='normal')assert.deepEqual(g.result.winners,[1]);}
  const {H,g}=clean('normal',2);fill(g,1,goalPath(H,g,1));fill(g,2,goalPath(H,g,2));assert.ok(g.act({type:'rest',cells:[]}));assert.equal(g.phase,'over');assert.deepEqual(g.result.winners,[1,2]);
});

test('normal finite100-per-active-seat action cap andAuto foreground clock have explicit separate endings',()=>{
  for(const n of [2,6]){const {H,g}=setup('normal',n);for(let i=0;i<100*n;i++)assert.ok(g.act({type:'rest',cells:[]}));assert.equal(g.phase,'over');assert.equal(g.ply,100*n);assert.equal(g.result.reason,'turn-limit');}
  const {g}=setup('auto');g.pause();g.advanceTime(600000);assert.equal(g.activeMs,0);g.start();g.advanceTime(600000);assert.equal(g.phase,'over');
});

test('seeded terrain is identical for every normal seat count, including inactive home clearings',()=>{
  for(const seed of ['terrain-seat-invariant',37,81,203]){
    const layouts=[];for(let n=2;n<=6;n++)layouts.push(setup('normal',n,{seed,terrain:'seeded'}).g.terrain);
    for(const terrain of layouts)assert.deepEqual(terrain,layouts[0]);
  }
});

test('identical local positions resolve the same paid common actions in normal and Auto modes',()=>{
  const games=modes.map(mode=>clean(mode));
  for(const {g,at} of games){g.board[at(0,0)]=g.board[at(3,0)]=g.board[at(2,2)]=1;g.board[at(1,0)]=2;g.shields[at(1,0)]=5;g.terrain[at(1,1)]=2;hand(g,1,['bridge','destroy','destroy']);}
  const actions=[['bridge',[[0,0],[3,0]]],['destroy',[[1,0]]],['engineer',[[1,1]]],['tunnel',[[3,0],[3,1],[2,2]]]];
  function local({g,H,at}){const cells=H.CELLS.filter(c=>H.distance(c.i,at(0,0))<=5).sort((a,b)=>a.q-b.q||a.r-b.r);return{cells:cells.map(c=>[c.q,c.r,...['board','terrain','roads','shields','hillAge','unsupplied'].map(k=>g[k][c.i])]),energy:g.players[1].energy,supplies:g.players[1].supplies,hand:g.hands[1],used:g.telemetry.cardsUsed,captures:g.telemetry.captures,retreats:g.telemetry.supplyRetreats,transports:[...g.bridges,...g.tunnels].map(b=>[b.owner,H.CELLS[b.a].q,H.CELLS[b.a].r,H.CELLS[b.b].q,H.CELLS[b.b].r])};}
  for(const [type,coordinates] of actions){for(const {g,at} of games){ownTurn(g);assert.ok(g.act({type,cells:coordinates.map(c=>at(...c))}));}assert.deepEqual(local(games[0]),local(games[1]),type);}
});

test('two tunnels may share an owned endpoint, enforce the owner cap and collapse on capture or withdrawal',()=>{
 for(const mode of modes){
  const{H,g,at}=clean(mode),a=at(0,0),b=at(2,0),c=at(0,2),d=at(-2,0);for(const i of[a,b,c,d])g.board[i]=1;
  assert.ok(g.act({type:'tunnel',cells:[a,at(1,0),b]}));ownTurn(g);assert.ok(g.act({type:'tunnel',cells:[a,at(0,1),c]}));assert.equal(g.tunnels.length,2);
  ownTurn(g);invalid(H,g,{type:'tunnel',cells:[a,at(-1,0),d]});assert.ok(g.act({type:'withdraw',cells:[a]}));assert.equal(g.tunnels.length,0);assert.equal(g.board[a],0);
  const f=clean(mode),end=f.at(2,0);f.g.board[f.at(0,0)]=f.g.board[end]=1;f.g.board[f.at(3,0)]=f.g.board[f.at(2,-1)]=2;
  assert.ok(f.g.act({type:'tunnel',cells:[f.at(0,0),f.at(1,0),end]}));assert.ok(f.g.act({type:'deploy',cells:[end]}));assert.equal(f.g.board[end],2);assert.equal(f.g.tunnels.length,0);
 }
});

test('normal2–6 seeded twelve-action replays preserve actual actions, hidden cards and bounded planner state',()=>{
 for(const n of [2,3,4,5,6]){
  const H=Core.create({mode:'normal',playerCount:n}),a=new H.Game({seed:'shared-replay-'+n}),b=new H.Game({seed:'shared-replay-'+n});a.start();b.start();
  for(let i=0;i<12&&a.phase==='running';i++){const x=H.chooseAction(a.observation()),y=H.chooseAction(b.observation());assert.deepEqual(x,y);assert.ok(a.act(x));assert.ok(b.act(y));assert.deepEqual(a.board,b.board);assert.deepEqual(a.hands,b.hands);assert.deepEqual(a.handAges,b.handAges);assert.deepEqual(a.plannerStates,b.plannerStates);assert.ok(x.planner.diagnostics.nodes<=H.PLANNER_LIMITS.nodes);}
 }
});
