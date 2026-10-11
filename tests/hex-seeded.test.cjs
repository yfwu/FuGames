'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const H=vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../card_hex.html'),'utf8').match(/<script id="hex-engine">([\s\S]*?)<\/script>/)[1]+';CardHex;');
const at=H.index,center=at(0,0),plain=x=>JSON.parse(JSON.stringify(x));
function game(options={}){const g=new H.Game(H.seeded('fixture'),'rush',1,{seed:'fixture',...options});g.start();return g;}
function move(g){const i=g.board.findIndex((v,i)=>!v&&H.walkable(i,g.terrain,g.roads)&&H.distance(i,center)>2);assert.ok(i>=0);assert.ok(g.act({type:'place',cells:[i]}));}
function sameInvalid(g,action){const before=JSON.stringify(g);assert.equal(g.act(action),false);assert.equal(JSON.stringify(g),before);}

test('seed terrain: 300 layouts preserve three-way rotational access and reproducibility; seeds vary terrain',()=>{
 const layouts=new Set();for(let seed=0;seed<300;seed++){
  const g=game({terrain:'seeded',seed}),t=g.terrain;layouts.add(t.join());assert.deepEqual(plain(t),plain(H.generateTerrain(H.seeded(seed+'|terrain'))));
  for(const c of H.CELLS)assert.equal(t[c.i],t[at(c.s,c.q)]);
  for(const p of H.PLAYERS){assert.ok(Number.isFinite(H.shortest(g.board,p,g.axes,[],Infinity,t,g.roads)));assert.equal(H.shortest(g.board,p,g.axes,[],Infinity,t,g.roads),H.shortest(g.board,1,g.axes,[],Infinity,t,g.roads));}
  assert.equal(t.filter(x=>x==='hill').length,9);assert.ok(t.filter(x=>x==='river').length<=12);
 }
 assert.ok(layouts.size>150);
});
test('rivers require public engineering before place/double/turret/trap occupancy and actual connection',()=>{
 const g=game();g.terrain[center]='river';g.hands[1]=['double','turret','trap'];
 for(const action of [{type:'place',cells:[center]},{type:'turret',cells:[center]},{type:'double',cells:[center,at(1,0)]},{type:'trap',cells:[center,at(1,0)]}])sameInvalid(g,action);
 for(let r=-5;r<=5;r++)g.board[at(0,r)]=1;assert.equal(H.connected(g.board,1,g.axes,[],g.terrain,g.roads),false);g.board[center]=0;g.hands[1]=[];
 assert.ok(g.act({type:'engineer',cells:[center]}));assert.equal(g.board[center],0);assert.equal(g.roads[center],true);assert.equal(g.ply,1);g.turn=1;assert.ok(g.act({type:'place',cells:[center]}));assert.equal(g.result.winner,1);
});
test('bridge legality rejects all owners, reverse, partial collinear overlap, crossings and T junctions; endpoints may connect',()=>{
 const cases=[[[at(-2,0),at(0,0)],[at(0,0),at(-2,0)],false],[[at(-2,0),at(0,0)],[at(-1,0),at(1,0)],false],[[at(-1,0),at(1,0)],[at(0,-1),at(0,1)],false],[[at(-1,0),at(1,0)],[at(0,0),at(0,2)],false],[[at(-2,0),at(0,0)],[at(0,0),at(2,0)],true],[[at(-2,0),at(0,0)],[at(0,0),at(0,2)],true],[[at(-2,0),at(0,0)],[at(1,-1),at(1,1)],true]];
 for(const [old,next,allowed]of cases)for(const owner of [1,2,3]){const g=game();g.hands[1]=['bridge'];for(const i of next)g.board[i]=1;g.bridges=[{owner,a:old[0],b:old[1]}];assert.equal(H.bridgeValid(g.board,1,...next,g.bridges),allowed);if(!allowed)sameInvalid(g,{type:'bridge',cells:next});}
 const g=game();g.board[at(-2,0)]=g.board[center]=g.board[at(2,0)]=1;g.bridges=[{owner:1,a:at(-2,0),b:center}];g.hands[1]=['bridge'];assert.ok(g.act({type:'bridge',cells:[center,at(2,0)]}));assert.equal(g.bridges.length,2);
});
test('hill occupancy lasts three subsequent owner actions; other players, pause and counter waiting do not tick it',()=>{
 const g=game();g.terrain[center]='hill';assert.ok(g.act({type:'place',cells:[center]}));assert.equal(g.hillUntil[center]-g.completed[1],3);
 for(let own=0;own<3;own++){move(g);move(g);assert.equal(g.board[center],1);const before=g.completed[1];g.pause();sameInvalid(g,{type:'place',cells:[0]});assert.equal(g.completed[1],before);g.start();move(g);assert.equal(g.board[center],own===2?0:1);}
 assert.equal(g.hillUntil[center],0);
});
test('hill retreat removes attached bridges/turrets before a connection can win; engineer stabilizes own hill',()=>{
 const g=game();g.terrain[center]='hill';g.board[center]=1;g.hillUntil[center]=1;g.board[at(2,0)]=1;g.bridges=[{owner:1,a:center,b:at(2,0)}];g.turrets=[{owner:1,cell:center,nextFire:100,shots:2}];for(let r=-5;r<=5;r++)g.board[at(0,r)]=1;g.board[at(0,1)]=0;assert.ok(g.act({type:'place',cells:[at(0,1)]}));assert.equal(g.result,null);assert.equal(g.board[center],0);assert.equal(g.bridges.length,0);assert.equal(g.turrets.length,0);
 const safe=game();safe.terrain[center]='hill';safe.board[center]=1;safe.hillUntil[center]=1;assert.ok(safe.act({type:'engineer',cells:[center]}));assert.equal(safe.terrain[center],'plain');assert.equal(safe.board[center],1);
});
test('mixed deck composition varies, bounds hold, each seat gets same 13-card recipe and only one shield',()=>{
 const recipes=new Set();for(let seed=0;seed<150;seed++){const g=game({seed,cards:'mixed'});recipes.add(g.deckRecipe.slice().sort().join());assert.equal(g.deckRecipe.length,13);for(const p of H.PLAYERS)assert.deepEqual([...g.hands[p],...g.decks[p]].sort(),Array.from(g.deckRecipe).sort());for(const c of H.MIXED_TYPES){const n=g.deckRecipe.filter(x=>x===c).length;assert.ok(n>0);assert.ok(n<=(c==='shield'?1:c==='double'?4:3));}}
 assert.ok(recipes.size>40);
});
test('timed cards include acquisition turn, expire only after third owner action, free hand space, and conserve all cards',()=>{
 const g=game({timed:true,cards:'mixed'}),initial=g.hands[1].slice();assert.equal(initial.length,3);assert.deepEqual(Array.from(g.observation(1).cardLife),[3,3,3]);
 for(let own=0;own<3;own++){move(g);assert.equal(g.discarded[1].length,own===2?3:0);if(own<2){move(g);move(g);}}
 assert.equal(g.hands[1].length,1);assert.deepEqual(Array.from(g.observation(1).cardLife),[1]);for(const p of H.PLAYERS)assert.equal(g.hands[p].length+g.decks[p].length+g.discarded[p].length+Object.values(g.used[p]).reduce((a,b)=>a+b),13);
});
test('full hand holds the deck; discard is voluntary, consumes exactly one action, and invalid discard is atomic',()=>{
 const g=game({timed:true});g.draw();assert.equal(g.hands[1].length,4);const n=g.decks[1].length;g.draw();assert.equal(g.decks[1].length,n);sameInvalid(g,{type:'discard',cells:[],cardIndex:7});assert.ok(g.act({type:'discard',cells:[],cardIndex:1}));assert.equal(g.ply,1);assert.equal(g.discarded[1].length,1);assert.equal(g.hands[1].length,3);
});
test('expired shield cannot counter and pause never expires a card; responding ticks attacker, not defender',()=>{
 const g=game({timed:true});g.hands[1]=['shield'];g.deadlines[1]=[1];move(g);assert.equal(g.hands[1].length,0);g.board[center]=1;g.hands[2]=['remove'];g.deadlines[2]=[3];assert.ok(g.act({type:'remove',cells:[center]}));g.pause();assert.equal(g.respond(false),false);g.start();assert.equal(g.respond(true),false);assert.ok(g.respond(false));assert.equal(g.completed[1],1);assert.equal(g.completed[2],1);
});
test('terraform river bridges and places atomically but still triggers hidden traps; public forecast cannot see them',()=>{
 const g=game();g.terrain[center]='river';g.hands[1]=['terraform'];g.traps=[{owner:2,cell:center}];const a={type:'terraform',cells:[center]};assert.equal(H.publicForecast(g.observation(),a).board[center],1);assert.ok(g.act(a));assert.equal(g.roads[center],true);assert.equal(g.board[center],0);assert.equal(g.used[1].terraform,1);assert.equal(g.revealed.length,1);
});
test('neutral warning has three public actions, can be disarmed by every seat, and no option creates an endless match',()=>{
 for(const p of H.PLAYERS){const g=game();g.neutral={cell:center,kind:'gust',at:3};g.turn=p;g.board[center]=p;assert.ok(g.act({type:'disarm',cells:[center]}));assert.equal(g.neutral,null);assert.equal(g.board[center],p);assert.equal(g.ply,1);}
 const g=game({neutral:true});g.nextWave=1;move(g);assert.equal(g.neutral.at,4);const event={...g.neutral};move(g);assert.deepEqual(plain(g.neutral),plain(event));move(g);assert.ok(g.neutral);move(g);assert.equal(g.neutral,null);assert.ok(g.events.some(x=>x.type==='neutral'));
});
test('neutral target and kind ignore humans, private cards and traps; waves stop at four',()=>{
 const a=game({neutral:true}),b=game({neutral:true});b.hands[2].reverse();b.traps=[{owner:3,cell:center}];
 for(const g of [a,b]){g.nextWave=1;g.board[center]=1;g.board[at(1,0)]=2;g.board[at(2,0)]=3;move(g);}assert.deepEqual(plain(a.neutral),plain(b.neutral));
 const g=game({neutral:true});for(let k=0;k<4;k++){g.nextWave=g.ply+1;move(g);assert.ok(g.neutral);assert.ok(g.act({type:'disarm',cells:[g.neutral.cell]}));}assert.equal(g.waves,4);assert.equal(g.nextWave,Infinity);for(let i=0;i<9;i++)move(g);assert.equal(g.waves,4);
});
test('neutral and simultaneous guns resolve before wins, terrain effects preserve occupied cells and public roads',()=>{
 const g=game();for(let r=-5;r<=5;r++)g.board[at(0,r)]=1;g.board[center]=0;g.neutral={cell:center,kind:'gust',at:1};assert.ok(g.act({type:'place',cells:[center]}));assert.equal(g.result,null);assert.equal(g.board[center],0);
 for(const kind of ['flood','uplift']){const x=game();x.board[center]=2;x.neutral={cell:center,kind,at:1};move(x);assert.equal(x.terrain[center],'plain');assert.equal(x.board[center],2);x.roads[center]=true;x.board[center]=0;x.neutral={cell:center,kind,at:2};move(x);assert.equal(x.terrain[center],'plain');}
});
test('new observation boundary hides enemy cards/decks/deadlines/traps including spectator mode; AI unchanged under hidden permutations',()=>{
 for(const profile of ['rush','cutter','multi']){const g=game({terrain:'seeded',cards:'mixed',timed:true,neutral:true});g.profiles[1]=profile;g.traps=[{owner:2,cell:center},{owner:3,cell:at(2,0)}];g.last={player:2,type:'trap',cells:[0,center]};const v=plain(g.observation()),a=plain(H.chooseAction(v));g.hands[2].reverse();g.decks[3].reverse();g.deadlines[2].fill(100);g.traps[0].cell=at(4,0);g.last.cells[1]=at(4,0);assert.deepEqual(plain(g.observation()),v);assert.deepEqual(plain(H.chooseAction(g.observation())),a);const spectator=g.observation(0);assert.equal(spectator.hand.length,0);assert.equal(spectator.ownTraps.length,0);assert.equal(spectator.cardLife.length,0);assert.equal(spectator.last.cells.length,1);for(const key of ['hands','decks','traps','deadlines','options','random','eventRandom'])assert.equal(key in spectator,false);}
});
test('same seed/config replays full games; six seeded timed/event/terrain games terminate with only legal AI actions',()=>{
 const run=seed=>{const g=game({seed,terrain:'seeded',cards:'mixed',timed:true,neutral:true});g.profiles=[null,'rush','cutter','multi'];g.reset(seed%3+1,seed%3);g.start();const trace=[];while(g.phase==='running'){if(g.pending){assert.ok(g.respond(H.chooseCounter(g.observation(g.pending.defender))));continue;}const a=H.chooseAction(g.observation());assert.ok(a);assert.ok(g.act(a),JSON.stringify(a));trace.push([a.type,a.cells]);assert.ok(g.ply<=180);for(const p of H.PLAYERS)assert.equal(g.hands[p].length+g.decks[p].length+g.discarded[p].length+Object.values(g.used[p]).reduce((a,b)=>a+b),13);for(let i=0;i<91;i++)if(g.board[i])assert.ok(H.walkable(i,g.terrain,g.roads));}return JSON.stringify({trace,result:g.result,terrain:g.terrain});};
 for(let seed=1;seed<=6;seed++){const result=run(seed);if(seed===1)assert.equal(run(seed),result);}
});

test('all 16 river meanders leave equal finite paths; every inaccessible empty cell can be engineered without a card',()=>{
 for(let bits=0;bits<16;bits++){let n=0;const t=H.generateTerrain(()=>n<4?((bits>>n++)&1)*.75:.25);for(const p of H.PLAYERS)assert.ok(Number.isFinite(H.shortest(Array(91).fill(0),p,H.DEFAULT_AXES,[],Infinity,t)));}
 const g=game();g.board.fill(2);g.board[center]=0;g.terrain[center]='river';g.hands[1]=[];const a=H.chooseAction(g.observation());assert.equal(a.type,'engineer');assert.ok(g.act(a));
});
test('neutral flood at a just-fired turret center, hill retreat, expiry, and simultaneous connection ordering are consistent',()=>{
 const g=game({timed:true});const gun=at(1,0);g.board[gun]=2;g.turrets=[{owner:2,cell:gun,nextFire:1,shots:1}];g.board[center]=1;g.terrain[center]='hill';g.hillUntil[center]=1;g.neutral={cell:center,kind:'flood',at:1};g.hands[1]=['shield'];g.deadlines[1]=[1];move(g);assert.equal(g.board[center],0);assert.equal(g.terrain[center],'river');assert.equal(g.discarded[1][0],'shield');assert.equal(g.turrets.length,0);
 const both=game();for(let r=-5;r<=5;r++)both.board[at(0,r)]=1;for(let q=-5;q<=5;q++)if(q)both.board[at(q,0)]=2;both.bridges=[{owner:2,a:at(-1,0),b:at(1,0)}];both.neutral={cell:at(4,-4),kind:'uplift',at:1};both.checkResult();assert.equal(both.result.winner,0);assert.match(both.result.reason,/多方/);
});
test('AI bridge candidates obey the same all-owner crossing guard on crowded states',()=>{
 for(const profile of ['rush','cutter','multi']){const g=game();g.profiles[1]=profile;g.hands[1]=['bridge'];for(let r=-5;r<=5;r++)if(r!==0)g.board[at(0,r)]=1;g.board[center]=2;g.board[at(-1,0)]=g.board[at(1,0)]=2;g.bridges=[{owner:2,a:at(-1,0),b:at(1,0)}];assert.equal(H.bridgeValid(g.board,1,at(0,-1),at(0,1),g.bridges),false);const a=H.chooseAction(g.observation());assert.ok(g.act(a));if(a.type==='bridge')assert.notDeepEqual(Array.from(a.cells).sort((a,b)=>a-b),[at(0,-1),at(0,1)].sort((a,b)=>a-b));}
});
