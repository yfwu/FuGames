'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','card_hex.html'),'utf8');
const H=vm.runInNewContext(html.match(/<script id="hex-engine">([\s\S]*?)<\/script>/)[1]+'; CardHex;');
const seeded=seed=>()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296),blank=()=>Array(H.COUNT).fill(0),plain=v=>JSON.parse(JSON.stringify(v));
const at=(q,r)=>H.index(q,r),center=at(0,0),g=()=>{const x=new H.Game(seeded(1));x.start();return x;};
const line=(board,p,except=[])=>{for(let r=-5;r<=5;r++){const i=at(0,r);if(!except.includes(i))board[i]=p;}};
function settle(game){if(game.pending)game.respond(H.chooseCounter(game.observation(game.pending.defender)));}
function safeMove(game){const i=game.board.findIndex((v,i)=>!v&&H.distance(i,center)>2);assert.ok(i>=0);assert.ok(game.act({type:'place',cells:[i]}));settle(game);}

test('regular91-cell topology has six central neighbours, symmetric goal edges and shared corners',()=>{
  assert.equal(H.CELLS.length,91);assert.equal(H.neighbors(center).length,6);assert.equal(H.neighbors(at(5,0)).length,3);assert.equal(new Set(H.CELLS.map(c=>c.q+','+c.r)).size,91);
  for(const c of H.CELLS){assert.ok(Math.max(Math.abs(c.q),Math.abs(c.r),Math.abs(c.s))<=5);for(const i of H.neighbors(c.i)){assert.equal(H.distance(c.i,i),1);assert.ok(H.neighbors(i).includes(c.i));}}
  for(const p of [1,2,3]){assert.equal(H.shortest(blank(),p),11);assert.equal(H.EDGES[p-1][0].length,6);assert.equal(H.EDGES[p-1][1].length,6);}
  const corners=H.CELLS.filter(c=>[c.r,c.q,c.s].filter(x=>Math.abs(x)===5).length===2);assert.equal(corners.length,6);for(const c of corners)assert.equal(H.EDGES.flat(2).filter(i=>i===c.i).length,2);
  const b=blank();line(b,1,[center]);assert.equal(H.shortest(b,1),1);b[center]=1;assert.ok(H.connected(b,1));
});
test('120degree rotation preserves topology, corner membership and every player connection cost',()=>{
  const rotation=i=>{const c=H.CELLS[i];return at(c.s,c.q);},b=blank();for(let i=0;i<91;i++)if(i%7===0)b[i]=i%3+1;const rotated=blank();for(let i=0;i<91;i++)rotated[rotation(i)]=b[i];
  // [r,q,s] transforms to [q,s,r], so axis0→axis2, axis1→axis0, axis2→axis1.
  const axes=[null,2,0,1];for(const p of [1,2,3]){assert.equal(H.shortest(b,p),H.shortest(rotated,p,axes));assert.equal(H.shortest(b,p,H.DEFAULT_AXES,[],3),H.shortest(rotated,p,axes,[],3));}
  for(const i of [at(5,0),at(0,5),at(-5,5)])assert.equal(H.neighbors(i).length,H.neighbors(rotation(i)).length);
});
test('all three players get the same weighted13-card finite deck, exactly1shield, no guaranteed opening shield',()=>{
  let without=0,withShield=0;const orders=new Set();for(let seed=1;seed<=24;seed++){const game=new H.Game(seeded(seed));for(const p of [1,2,3]){assert.equal(game.hands[p].length,2);assert.deepEqual([...game.hands[p],...game.decks[p]].sort(),Array.from(H.DECK).sort());assert.equal([...game.hands[p],...game.decks[p]].filter(c=>c==='shield').length,1);game.hands[p].includes('shield')?withShield++:without++;}orders.add(game.decks[1].join());}
  assert.ok(withShield>0&&without>0);assert.ok(orders.size>20);const game=g();game.draw();assert.equal(game.hands[1].length,4);const before=game.decks[1].length;game.draw();assert.equal(game.decks[1].length,before);for(let k=0;k<20;k++){game.hands[1]=[];game.draw();}assert.equal(game.decks[1].length,0);assert.equal(game.drawn,null);
});
test('ready, paused and terminal states freeze moves and clocks; reset clears every structure',()=>{
  const game=new H.Game(seeded(1));assert.equal(game.act({type:'place',cells:[center]}),false);game.start();game.pause();let old=JSON.stringify(game);assert.equal(game.act({type:'place',cells:[center]}),false);assert.equal(JSON.stringify(game),old);game.start();assert.ok(game.act({type:'place',cells:[center]}));game.finish(1,'fixture');assert.equal(game.act({type:'place',cells:[0]}),false);game.traps=[{owner:1,cell:4}];game.reset(3,2);assert.equal(game.phase,'ready');assert.equal(game.turn,3);assert.deepEqual(Array.from(game.axes),[null,2,0,1]);assert.equal(game.ply,0);for(const a of ['traps','turrets','bridges','revealed','events'])assert.equal(game[a].length,0);assert.equal(game.pending,null);assert.equal(game.result,null);assert.ok(game.board.every(v=>v===0));
});
test('double placement is atomic, needs adjacent distinct empties, and can complete a connection',()=>{
  const game=g();game.hands[1]=['double'];game.board[0]=2;for(const cells of [[center,center],[0,1],[0,90],[-1,2],[center],[center,at(1,0),at(0,1)]]){const old=JSON.stringify(game);assert.equal(game.act({type:'double',cells}),false);assert.equal(JSON.stringify(game),old);}
  game.board=blank();const a=at(0,0),b=at(0,1);line(game.board,1,[a,b]);assert.ok(game.act({type:'double',cells:[a,b]}));assert.equal(game.result.winner,1);assert.equal(game.ply,1);assert.equal(game.used[1].double,1);
});
test('removal gives the actual target owner one counter window, freezes turn, spends unique shield',()=>{
  const game=g();game.board[center]=3;game.hands[1]=['remove'];game.hands[3]=['shield'];game.decks[3]=[];assert.ok(game.act({type:'remove',cells:[center]}));assert.equal(game.pending.defender,3);assert.equal(game.board[center],3);assert.equal(game.ply,0);assert.equal(game.act({type:'place',cells:[0]}),false);game.pause();assert.equal(game.respond(true),false);game.start();assert.ok(game.respond(true));assert.equal(game.board[center],3);assert.equal(game.used[3].shield,1);assert.equal(game.hands[3].length,0);assert.equal(game.turn,2);assert.equal(game.ply,1);assert.equal(game.respond(false),false);
});
test('unshielded removal only clears the target and removes attached public structures',()=>{
  const game=g(),a=center,b=at(2,0);game.board[a]=game.board[b]=2;game.board[0]=1;game.hands[1]=['remove'];game.hands[2]=[];game.turrets=[{owner:2,cell:a,nextFire:4,shots:2}];game.bridges=[{owner:2,a,b}];assert.equal(game.act({type:'remove',cells:[0]}),false);assert.equal(game.act({type:'remove',cells:[1]}),false);assert.ok(game.act({type:'remove',cells:[a]}));assert.equal(game.respond(true),false);assert.ok(game.respond(false));assert.equal(game.board[a],0);assert.equal(game.board[b],2);assert.equal(game.turrets.length,0);assert.equal(game.bridges.length,0);assert.equal(game.turn,2);
});
test('connection wins before cap; multiple final connections draw; fullboard ends despite unused removal',()=>{
  const game=g();game.ply=179;line(game.board,1,[center]);assert.ok(game.act({type:'place',cells:[center]}));assert.equal(game.result.winner,1);assert.match(game.result.reason,/接通/);
  const both=g();line(both.board,1);for(let q=-5;q<=5;q++)if(q)both.board[at(q,0)]=2;both.bridges=[{owner:2,a:at(-1,0),b:at(1,0)}];both.checkResult();assert.equal(both.result.winner,0);assert.match(both.result.reason,/多方/);
  const full=g();full.board=Array.from({length:91},(_,i)=>i%3+1);full.hands[1]=['remove'];full.checkResult();assert.equal(full.phase,'over');assert.ok(full.result);if(!/接通/.test(full.result.reason))assert.ok(full.result.scores.length===3);
  const cap=g();cap.ply=179;assert.ok(cap.act({type:'place',cells:[center]}));assert.equal(cap.phase,'over');assert.equal(cap.result.winner,1);assert.ok(cap.result.scores.every(Number.isFinite));
});
test('AI closes a route, blocks either rival immediate threat, and finds a double finish',()=>{
  const game=g();line(game.board,1,[center]);game.hands[1]=[];let action=H.chooseAction(game.observation(1));assert.equal(action.cells[0],center);
  for(const rival of [2,3]){const threat=g();threat.axes[rival]=0;threat.axes[1]=1;line(threat.board,rival,[center]);threat.hands[1]=[];action=H.chooseAction(threat.observation(1));assert.equal(action.cells[0],center);}
  game.board[at(0,1)]=0;game.hands[1]=['double'];action=H.chooseAction(game.observation(1));assert.equal(action.type,'double');assert.deepEqual(Array.from(action.cells).sort((a,b)=>a-b),[center,at(0,1)].sort((a,b)=>a-b));
});
test('AI shields important own bridges/routes; private hand/deck and trap permutation cannot change observations or choices',()=>{
  const game=g();game.turn=2;line(game.board,2,[at(0,5)]);game.axes[2]=0;game.hands[2]=['shield'];game.pending={attacker:3,defender:2,cell:center};assert.equal(H.chooseCounter(game.observation(2)),true);game.hands[2]=[];assert.equal(H.chooseCounter(game.observation(2)),false);
  game.pending=null;game.hands[2]=['double','trap'];game.traps=[{owner:1,cell:at(-3,0)},{owner:3,cell:at(3,0)},{owner:2,cell:at(0,3)}];game.last={player:1,type:'trap',cells:[0,at(-3,0)],reason:''};const before=plain(game.observation(2)),action=plain(H.chooseAction(before));game.hands[1].reverse();game.decks[1].reverse();game.hands[3].reverse();game.decks[3].reverse();game.traps[0].cell=at(4,-2);game.traps[1].cell=at(-4,2);game.last.cells[1]=game.traps[0].cell;assert.deepEqual(plain(game.observation(2)),before);assert.deepEqual(plain(H.chooseAction(game.observation(2))),action);assert.equal(before.ownTraps.length,1);assert.ok(!('traps'in before||'decks'in before||'hands'in before));assert.equal(before.last.cells.length,1);
});
test('AI personality affects actual strategic actions on a searched public fixture',()=>{
  let different=false;for(let seed=1;seed<=12&&!different;seed++){const game=new H.Game(seeded(seed));game.start();const rng=seeded(seed*99);for(let k=0;k<18;k++)game.board[Math.floor(rng()*91)]=k%3+1;game.hands[1]=['double','remove','turret','trap'];const a=game.observation(1),b=game.observation(1);a.profile='builder';b.profile='cutter';const x=H.chooseAction(a),y=H.chooseAction(b);different=x.type!==y.type||x.cells.join()!==y.cells.join();}assert.ok(different);
});
test('turret is publicly warned for three subsequent actions, damages all owners, fires twice then becomes ordinary stone',()=>{
  const game=g();game.hands[1]=['turret'];const ring=H.ADJ[center];ring.slice(0,3).forEach((i,k)=>game.board[i]=k+1);assert.ok(game.act({type:'turret',cells:[center]}));assert.equal(game.turrets[0].nextFire,4);assert.equal(game.turrets[0].shots,2);for(const p of [1,2,3])assert.equal(game.observation(p).turrets[0].cell,center);
  safeMove(game);safeMove(game);assert.equal(game.ply,3);assert.equal(game.board[ring[0]],1);safeMove(game);assert.equal(game.ply,4);for(const i of ring)assert.equal(game.board[i],0);assert.equal(game.board[center],1);assert.equal(game.turrets[0].shots,1);assert.equal(game.turrets[0].nextFire,7);game.board[ring[0]]=1;safeMove(game);safeMove(game);safeMove(game);assert.equal(game.board[ring[0]],0);assert.equal(game.turrets.length,0);assert.equal(game.board[center],1);
});
test('simultaneous turrets both shoot even when hit, and a destroyed gun cannot fire later',()=>{
  const a=center,b=at(1,0),c=at(2,0),state={board:blank(),turrets:[{owner:1,cell:a,nextFire:4,shots:2},{owner:2,cell:b,nextFire:4,shots:2}],bridges:[]};state.board[a]=1;state.board[b]=2;state.board[c]=3;const fire=H.resolveTurrets(state,4);assert.equal(fire.guns.length,2);assert.equal(state.board[a],0);assert.equal(state.board[b],0);assert.equal(state.board[c],0);assert.equal(state.turrets.length,0);assert.equal(H.resolveTurrets(state,7).guns.length,0);
});
test('due turret fire resolves before winning connection and shield never protects area damage',()=>{
  const game=g();line(game.board,1,[center]);const gun=at(1,0);game.board[gun]=2;game.turrets=[{owner:2,cell:gun,nextFire:1,shots:1}];game.hands[1]=['shield'];assert.ok(game.act({type:'place',cells:[center]}));assert.equal(game.result,null);assert.equal(game.board[center],0);assert.ok(game.hands[1].includes('shield'));assert.equal(game.turrets.length,0);
});
test('trap normal placement and secret center differ; only owner sees zone until enemy entry reveals it',()=>{
  const game=g();game.hands[1]=['trap'];const stone=at(-5,0);assert.ok(game.act({type:'trap',cells:[stone,center]}));assert.equal(game.board[stone],1);assert.equal(game.board[center],0);assert.equal(game.observation(1).ownTraps[0].cell,center);for(const p of [2,3]){assert.equal(game.observation(p).ownTraps.length,0);assert.equal(game.observation(p).last.cells.length,1);assert.equal(game.observation(p).trapDeployments[1],1);}const entry=at(1,0);assert.ok(game.act({type:'place',cells:[entry]}));assert.equal(game.board[entry],0);assert.equal(game.traps.length,0);assert.equal(game.revealed[0].cell,center);assert.equal(game.events[0].type,'trap');assert.equal(game.ply,2);
});
test('trap cancels only new enemies in zone, can cancel both double stones, never harms owner or existing stones',()=>{
  const game=g();game.traps=[{owner:1,cell:center}];game.board[at(0,1)]=3;game.turn=2;game.hands[2]=['double'];const a=center,b=at(1,0);assert.ok(game.act({type:'double',cells:[a,b]}));assert.equal(game.board[a],0);assert.equal(game.board[b],0);assert.equal(game.board[at(0,1)],3);
  const own=g();own.traps=[{owner:1,cell:center}];assert.ok(own.act({type:'place',cells:[center]}));assert.equal(own.board[center],1);assert.equal(own.traps.length,1);
});
test('overlapping rival traps reveal independently; secret center deployment never triggers a trap',()=>{
  const game=g();game.traps=[{owner:2,cell:center},{owner:3,cell:at(1,0)}];game.hands[1]=['trap'];assert.ok(game.act({type:'trap',cells:[at(-5,0),center]}));assert.equal(game.revealed.length,0);assert.equal(game.traps.length,3);game.turn=1;assert.ok(game.act({type:'place',cells:[at(0,1)]}));assert.equal(game.board[at(0,1)],0);assert.equal(game.revealed.length,2);assert.equal(game.traps.length,1);
});
test('bridge crosses one straight gap, gives virtual connectivity, rejects invalid endpoints and disappears with an endpoint',()=>{
  const game=g();line(game.board,1,[center]);game.board[center]=2;game.hands[1]=['bridge'];const a=at(0,-1),b=at(0,1);assert.equal(H.connected(game.board,1,game.axes,game.bridges),false);for(const cells of [[a,a],[a,center],[a,at(0,4)],[a,at(1,1)]]){const old=JSON.stringify(game);assert.equal(game.act({type:'bridge',cells}),false);assert.equal(JSON.stringify(game),old);}assert.ok(game.act({type:'bridge',cells:[a,b]}));assert.equal(game.result.winner,1);assert.equal(game.board[center],2);assert.equal(game.bridges.length,1);assert.equal(H.bridgeValid(game.board,1,a,b,game.bridges),false);
});
test('AI respects own trap centers, public immediate fire, and newly opened reply cells',()=>{
  const game=g();game.hands[1]=['trap'];game.traps=[{owner:1,cell:center}];let action=H.chooseAction(game.observation(1));assert.ok(action.type!=='trap'||action.cells[1]!==center);assert.ok(game.act(action));
  const danger=g();danger.hands[1]=[];line(danger.board,1,[center]);danger.board[at(1,0)]=2;danger.turrets=[{owner:2,cell:at(1,0),nextFire:1,shots:1}];action=H.chooseAction(danger.observation(1));const forecast=H.publicForecast(danger.observation(1),action);assert.equal(H.connected(forecast.board,1,danger.axes,forecast.bridges),false);assert.doesNotMatch(action.reason,/完成連線/);
});
test('six seeded full three-way AI games rotate first/axes/profiles and conserve finite cards without illegal actions',()=>{
  const seen=new Set();for(let seed=1;seed<=6;seed++){const game=new H.Game(seeded(seed),seed%2?'builder':'cutter');game.reset(seed%3+1,Math.floor((seed-1)/2)%3);game.start();let steps=0;while(game.phase==='running'){if(game.pending){assert.ok(game.respond(H.chooseCounter(game.observation(game.pending.defender))));}else{const action=H.chooseAction(game.observation());assert.ok(action);seen.add(action.type);assert.ok(game.act(action),JSON.stringify(action));steps++;}assert.ok(game.ply<=H.LIMIT);assert.ok(steps<=H.LIMIT+1);for(const p of [1,2,3]){assert.ok(game.hands[p].length<=4);for(const[k,n]of Object.entries(H.CARD_COUNTS))assert.equal(game.used[p][k]+game.hands[p].filter(x=>x===k).length+game.decks[p].filter(x=>x===k).length,n);}assert.ok(game.board.every(x=>[0,1,2,3].includes(x)));}assert.ok([0,1,2,3].includes(game.result.winner));}
  for(const type of ['place','double','remove','turret','trap','bridge'])assert.ok(seen.has(type),type);
});

 test('cyclic player relabeling cannot change equal-valued tactical choice (floating-point regression)',()=>{
  const view={board:[0,0,0,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,2,0,3,3,3,1,0,3,0,0,0,0,1,0,0,0,0,0,0,0,0,3,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,2,2,0,0,0,0,0,0,2,0,0],player:2,hand:['bridge','double'],axes:[null,2,0,1],profile:'cutter',seed:291360860,turn:2,ply:26,turrets:[{owner:2,cell:42,nextFire:27,shots:1}],bridges:[],ownTraps:[{owner:2,cell:24}]};
  const expected=plain(H.chooseAction(view));for(const rotation of [1,2]){const mapped=p=>(p-1+rotation)%3+1,next=plain(view);next.board=next.board.map(p=>p?mapped(p):0);next.player=mapped(view.player);next.turn=mapped(view.turn);for(const p of [1,2,3])next.axes[mapped(p)]=view.axes[p];for(const x of [...next.turrets,...next.ownTraps])x.owner=mapped(x.owner);assert.deepEqual(plain(H.chooseAction(next)),expected);}
 });
