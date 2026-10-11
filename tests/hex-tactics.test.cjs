'use strict';
const {test,loadHistoricalHex}=require('./helpers/historical-hex.cjs'),assert=require('node:assert/strict');
const H=loadHistoricalHex('function'),at=H.index,C=at(0,0),E=at(1,0);
function game(options={}){const g=new H.Game(H.seeded('tactics'),'rush',1,{seed:'tactics',...options});g.start();return g;}
function hand(g,p,cards){g.hands[p]=cards.slice();g.deadlines[p]=cards.map(()=>g.completed[p]+3);}
function invalid(g,a){const before=JSON.stringify(g);assert.equal(H.legalAction(g.observation(),a),false);assert.equal(g.act(a),false);assert.equal(JSON.stringify(g),before);}
function move(g){const i=g.board.findIndex((v,i)=>!v&&H.walkable(i,g.terrain,g.roads,g.blocked)&&H.distance(i,C)>3);assert.ok(i>=0);assert.ok(g.act({type:'place',cells:[i]}));}
function forecast(g,a){const f=H.publicForecast(g.observation(),a);assert.ok(g.act(a));for(const key of ['board','terrain','roads','hillUntil','blocked','bridges','turrets','neutral'])assert.deepEqual(g[key],f[key],key);}

test('tactical 13-card recipe is equal for every seat, bounded, seeded, one shield and one each new card',()=>{
 const recipes=new Set();for(let seed=0;seed<200;seed++){
  const g=game({seed,cards:'tactical'});assert.equal(g.deckRecipe.length,13);recipes.add(g.deckRecipe.slice().sort().join());
  for(const p of H.PLAYERS)assert.deepEqual([...g.hands[p],...g.decks[p]].sort(),g.deckRecipe.slice().sort());
  for(const c of ['shield',...H.TACTICAL_CARDS])assert.equal(g.deckRecipe.filter(x=>x===c).length,1);
  for(const c of H.CARD_TYPES)assert.ok(g.deckRecipe.filter(x=>x===c).length<=(c==='double'?4:3));
  assert.deepEqual(g.deckRecipe,game({seed,cards:'tactical'}).deckRecipe);
  for(const cards of ['mixed','classic'])assert.ok(game({seed,cards}).deckRecipe.every(c=>!H.TACTICAL_CARDS.includes(c)));
 }assert.ok(recipes.size>15);
});
test('all action types share public atomic legality, including malformed new actions',()=>{
 const g=game();hand(g,1,H.TACTICAL_CARDS);g.board[C]=1;
 for(const type of H.TACTICAL_CARDS)for(const cells of [[],[-1],[91],[NaN],[C,C],[C,E,91],[C,E,C,0]])invalid(g,{type,cells});
 invalid(g,{type:'unblock',cells:[C]});g.pause();const before=JSON.stringify(g);assert.equal(g.act({type:'block',cells:[E]}),false);assert.equal(JSON.stringify(g),before);
});
test('reroute replaces exactly one own bridge and preserves stones; both endpoint orderings work',()=>{
 for(const reverse of [false,true]){const g=game(),a=at(-2,0),b=at(-2,2),c=C;for(const i of [a,b,c])g.board[i]=1;g.bridges=[{owner:1,a:reverse?b:a,b:reverse?a:b}];hand(g,1,['reroute']);const board=g.board.slice();forecast(g,{type:'reroute',cells:[a,b,c]});assert.deepEqual(g.board,board);assert.deepEqual(g.bridges,[{owner:1,a,b:c}]);assert.equal(g.used[1].reroute,1);assert.equal(g.ply,1);}
});
test('reroute rejects same endpoint, foreign bridge, missing endpoint, nonstraight or unbridged river endpoint',()=>{
 const g=game(),a=at(-2,0),b=at(-2,2);g.board[a]=g.board[b]=g.board[C]=g.board[at(-1,1)]=1;g.bridges=[{owner:1,a,b}];hand(g,1,['reroute']);
 for(const cells of [[a,b,b],[a,C,b],[a,b,at(-1,1)],[a,b,E]])invalid(g,{type:'reroute',cells});
 g.terrain[C]='river';invalid(g,{type:'reroute',cells:[a,b,C]});g.roads[C]=true;assert.ok(H.legalAction(g.observation(),{type:'reroute',cells:[a,b,C]}));g.bridges[0].owner=2;invalid(g,{type:'reroute',cells:[a,b,C]});
});
test('reroute and new bridges reject every-owner crossing/overlap/T junction, allow true shared endpoints',()=>{
 const cases=[[[at(-1,-1),at(-1,1)],false],[[at(-1,0),at(1,0)],false],[[at(-1,0),at(-1,2)],false],[[C,at(2,0)],true],[[C,at(0,2)],true]];
 for(const [edge,allowed]of cases)for(const owner of H.PLAYERS){const g=game(),a=at(-2,0),b=at(-2,2);g.board[a]=g.board[b]=g.board[C]=1;g.bridges=[{owner:1,a,b},{owner,a:edge[0],b:edge[1]}];hand(g,1,['reroute']);const action={type:'reroute',cells:[a,b,C]};assert.equal(H.legalAction(g.observation(),action),allowed);if(!allowed)invalid(g,action);}
});
test('rerouted bridge still disappears when cannon or hill expiry removes its new endpoint',()=>{
 for(const kind of ['gun','hill']){const g=game(),a=at(-2,0),b=at(-2,2);g.board[a]=g.board[b]=g.board[C]=1;g.bridges=[{owner:1,a,b}];hand(g,1,['reroute']);if(kind==='hill'){g.terrain[C]='hill';g.hillUntil[C]=1;}else{g.board[E]=2;g.turrets=[{owner:2,cell:E,nextFire:1,shots:1}];}forecast(g,{type:'reroute',cells:[a,b,C]});assert.equal(g.board[C],0);assert.equal(g.bridges.length,0);}
});
test('block lasts three subsequent completed actions, all players can clear it without cards',()=>{
 const g=game();hand(g,1,['block']);forecast(g,{type:'block',cells:[C]});assert.equal(g.blocked[C]-g.ply,3);assert.equal(g.board[C],0);move(g);assert.equal(g.blocked[C]-g.ply,2);move(g);assert.equal(g.blocked[C]-g.ply,1);move(g);assert.equal(g.blocked[C],0);assert.equal(g.ply,4);
 for(const p of H.PLAYERS){const x=game();x.blocked[C]=10;x.turn=p;hand(x,p,[]);forecast(x,{type:'unblock',cells:[C]});assert.equal(x.blocked[C],0);assert.equal(x.ply,1);}
});
test('blocker legality does not reveal traps; blocks every occupancy/engineering action but leaves terrain/traps intact',()=>{
 const g=game();g.terrain[C]='hill';g.traps=[{owner:2,cell:C}];hand(g,1,['block']);assert.ok(g.act({type:'block',cells:[C]}));assert.equal(g.traps.length,1);assert.equal(g.revealed.length,0);g.turn=1;hand(g,1,['block','double','turret','trap','terraform','exchange']);g.board[E]=1;
 for(const action of [{type:'block',cells:[C]},{type:'place',cells:[C]},{type:'turret',cells:[C]},{type:'double',cells:[C,at(0,1)]},{type:'trap',cells:[at(0,1),C]},{type:'trap',cells:[C,at(0,1)]},{type:'engineer',cells:[C]},{type:'terraform',cells:[C]},{type:'exchange',cells:[E,C]}])invalid(g,action);
 assert.ok(g.act({type:'unblock',cells:[C]}));assert.equal(g.terrain[C],'hill');g.turn=1;assert.ok(g.act({type:'place',cells:[C]}));assert.equal(g.board[C],0);assert.equal(g.traps.length,0);
});
test('block requires walkable empty terrain, ignores overhead bridges, and cannot bias terminal relaxed scores',()=>{
 const g=game();hand(g,1,['block']);g.terrain[C]='river';invalid(g,{type:'block',cells:[C]});g.roads[C]=true;g.board[C]=1;invalid(g,{type:'block',cells:[C]});g.board[C]=0;
 for(let r=-5;r<=5;r++)if(r)g.board[at(0,r)]=1;g.bridges=[{owner:1,a:at(0,-1),b:at(0,1)}];assert.ok(g.act({type:'block',cells:[C]}));assert.equal(g.result.winner,1);
 const x=game();hand(x,1,['block']);x.ply=179;const costs=H.PLAYERS.map(p=>H.shortest(x.board,p,x.axes,x.bridges,3,x.terrain,x.roads));assert.ok(x.act({type:'block',cells:[C]}));assert.deepEqual(x.result.scores,costs);
});
test('pause and pending shield do not tick blockers; neutral changes beneath a block still require terrain legality',()=>{
 const g=game();g.blocked[C]=4;g.pause();assert.equal(g.act({type:'unblock',cells:[C]}),false);assert.equal(g.blocked[C],4);g.start();g.board[E]=2;hand(g,1,['remove']);assert.ok(g.act({type:'remove',cells:[E]}));assert.equal(g.ply,0);assert.equal(g.blocked[C],4);assert.ok(g.respond(false));assert.equal(g.ply,1);
 const x=game();hand(x,1,['block']);x.neutral={kind:'flood',cell:C,at:1};forecast(x,{type:'block',cells:[C]});assert.equal(x.terrain[C],'river');assert.ok(x.act({type:'unblock',cells:[C]}));invalid(x,{type:'place',cells:[C]});
});
test('AI always has a clearing escape when every empty cell is temporarily blocked and hand is empty',()=>{
 const g=game();g.board.fill(2);g.board[C]=0;g.blocked[C]=10;hand(g,1,[]);const a=H.chooseAction(g.observation());assert.equal(a.type,'unblock');assert.ok(g.act(a));assert.equal(g.blocked[C],0);
});
test('exchange moves an own ordinary stone to adjacent empty or enemy cell without adding stones',()=>{
 for(const enemy of [0,2,3]){const g=game();hand(g,1,['exchange']);g.board[C]=1;g.board[E]=enemy;forecast(g,{type:'exchange',cells:[C,E]});assert.equal(g.board[C],enemy);assert.equal(g.board[E],1);assert.equal(g.used[1].exchange,1);assert.equal(g.board.filter(x=>x===1).length,1);}
});
test('exchange rejects remote/friendly/foreign source, either turret or bridge endpoint, blocked and unbridged river targets',()=>{
 const make=()=>{const g=game();g.board[C]=1;hand(g,1,['exchange']);return g;};
 for(const target of [C,at(2,0)])invalid(make(),{type:'exchange',cells:[C,target]});
 for(const source of [0,2]){const g=make();g.board[C]=source;invalid(g,{type:'exchange',cells:[C,E]});}
 for(const i of [C,E])for(const type of ['turret','bridge']){const g=make();if(type==='turret')g.turrets=[{owner:1,cell:i,nextFire:5,shots:2}];else g.bridges=[{owner:1,a:i,b:at(2,0)}];invalid(g,{type:'exchange',cells:[C,E]});}
 for(const kind of ['friendly','river','blocked']){const g=make();if(kind==='friendly')g.board[E]=1;if(kind==='river')g.terrain[E]='river';if(kind==='blocked')g.blocked[E]=10;invalid(g,{type:'exchange',cells:[C,E]});}
});
test('exchange never moves hidden traps, landings trigger by each stone owner simultaneously',()=>{
 const g=game();g.board[C]=1;g.board[E]=2;g.traps=[{owner:1,cell:at(-1,0)},{owner:2,cell:at(2,0)}];hand(g,1,['exchange']);const v=g.observation(),f=H.publicForecast(v,{type:'exchange',cells:[C,E]});assert.equal(f.board[C],0);assert.equal(f.board[E],1);assert.deepEqual(f.knownTraps,[]);assert.ok(g.act({type:'exchange',cells:[C,E]}));assert.equal(g.board[C],0);assert.equal(g.board[E],0);assert.equal(g.traps.length,0);assert.equal(g.revealed.length,2);assert.deepEqual(g.revealed.map(t=>t.cell),[at(-1,0),at(2,0)]);
});
test('exchange landing in a friendly trap leaves it armed; no secret location is used for legality',()=>{
 const g=game();g.board[C]=1;g.traps=[{owner:1,cell:E},{owner:3,cell:at(5,-5)}];hand(g,1,['exchange']);assert.ok(g.act({type:'exchange',cells:[C,E]}));assert.equal(g.board[E],1);assert.deepEqual(g.traps.map(t=>t.cell),[E,at(5,-5)]);
});
test('exchange preserves existing hill lifetime and assigns exactly three subsequent owner turns to new hill entrants',()=>{
 for(const actorHill of [false,true]){const g=game();g.board[C]=1;g.board[E]=2;g.terrain[C]='hill';g.hillUntil[C]=2;if(actorHill){g.terrain[E]='hill';g.hillUntil[E]=2;}hand(g,1,['exchange']);forecast(g,{type:'exchange',cells:[C,E]});assert.equal(g.hillUntil[C]-g.completed[2],actorHill?2:3);assert.equal(g.hillUntil[E],actorHill?2:0);}
 const g=game();g.board[C]=1;g.terrain[E]='hill';hand(g,1,['exchange']);forecast(g,{type:'exchange',cells:[C,E]});assert.equal(g.hillUntil[E]-g.completed[1],3);
 const h=game();h.board[C]=1;h.terrain[C]=h.terrain[E]='hill';h.hillUntil[C]=1;hand(h,1,['exchange']);forecast(h,{type:'exchange',cells:[C,E]});assert.equal(h.board[E],0);
});
test('exchange into cannon range resolves before wins and neutral event; it can also escape imminent fire',()=>{
 for(const escape of [false,true]){const g=game();const gun=at(2,0);g.board[gun]=2;g.turrets=[{owner:2,cell:gun,nextFire:1,shots:1}];g.board[escape?E:C]=1;hand(g,1,['exchange']);forecast(g,{type:'exchange',cells:escape?[E,C]:[C,E]});assert.equal(g.board[escape?C:E],escape?1:0);}
 const g=game();g.board[C]=1;hand(g,1,['exchange']);g.neutral={kind:'gust',cell:E,at:1};forecast(g,{type:'exchange',cells:[C,E]});assert.equal(g.board[E],0);
});
test('exchange can complete both players simultaneously, or give the displaced enemy the sole win',()=>{
 const g=game();for(let r=-5;r<=5;r++)g.board[at(0,r)]=1;
 for(let q=-5;q<=-1;q++)g.board[at(q,1)]=2;
 g.board[at(1,-1)]=2;for(let q=2;q<=5;q++)g.board[at(q,0)]=2;
 g.bridges=[{owner:2,a:at(-1,1),b:at(1,-1)}];g.board[C]=2;g.board[E]=1;hand(g,1,['exchange']);
 assert.equal(H.connected(g.board,1,g.axes,g.bridges),false);assert.equal(H.connected(g.board,2,g.axes,g.bridges),false);
 forecast(g,{type:'exchange',cells:[E,C]});assert.equal(g.result.winner,0);assert.match(g.result.reason,/多方/);
 const x=game();for(let q=-5;q<=5;q++)x.board[at(q,0)]=2;x.board[C]=1;x.board[at(0,1)]=2;hand(x,1,['exchange']);
 assert.ok(x.act({type:'exchange',cells:[C,at(0,1)]}));assert.equal(x.result.winner,2);
});
test('new cards expire with the same own-turn clock and invalid actions never consume them',()=>{
 const g=game({timed:true});hand(g,1,H.TACTICAL_CARDS);g.deadlines[1]=[1,1,1];invalid(g,{type:'exchange',cells:[C,E]});move(g);assert.deepEqual(g.discarded[1].sort(),H.TACTICAL_CARDS.slice().sort());assert.equal(g.completed[1],1);
});
test('hidden enemy hand/deck/trap permutations leave new legality and AI actions identical for every profile and spectator',()=>{
 for(const profile of ['rush','cutter','multi']){const g=game({cards:'tactical',timed:true});g.profiles[1]=profile;hand(g,1,H.TACTICAL_CARDS);g.board[C]=1;g.board[E]=2;g.traps=[{owner:2,cell:E}];const v=g.observation(),a=H.chooseAction(v),legal=H.legalAction(v,{type:'exchange',cells:[C,E]}),spectator=g.observation(0);g.traps[0].cell=at(5,-5);g.hands[2].reverse();g.decks[3].reverse();g.deadlines[2].fill(100);assert.deepEqual(g.observation(),v);assert.deepEqual(g.observation(0),spectator);assert.equal(H.legalAction(g.observation(),{type:'exchange',cells:[C,E]}),legal);assert.deepEqual(H.chooseAction(g.observation()),a);assert.ok(g.act(a));}
});
test('new-card public forecast and game agree under simultaneous expiry, hill retreat, cannon and neutral changes',()=>{
 const g=game({timed:true});g.board[C]=1;g.terrain[C]=g.terrain[E]='hill';g.hillUntil[C]=1;g.blocked[at(-3,0)]=1;g.neutral={kind:'flood',cell:E,at:1};g.board[at(2,0)]=2;g.turrets=[{owner:2,cell:at(2,0),nextFire:1,shots:1}];hand(g,1,['exchange','block']);g.deadlines[1]=[1,1];forecast(g,{type:'exchange',cells:[C,E]});assert.equal(g.blocked[at(-3,0)],0);assert.equal(g.board[E],0);assert.equal(g.terrain[E],'river');assert.deepEqual(g.discarded[1],['block']);
});
test('seed replay full tactical games terminate with public legal AI, conserved cards and reset clears every temporary structure',()=>{
 function run(seed){const g=game({seed,cards:'tactical',terrain:'seeded',timed:seed%2===0,neutral:true});g.profiles=[null,'rush','cutter','multi'];const trace=[];let n=0;while(g.phase==='running'){assert.ok(n++<220);if(g.pending){assert.ok(g.respond(H.chooseCounter(g.observation(g.pending.defender))));continue;}const o=g.observation(),a=H.chooseAction(o);assert.ok(a);assert.ok(H.legalAction(o,a));assert.ok(g.act(a),JSON.stringify(a));trace.push([a.type,a.cells]);for(const p of H.PLAYERS)assert.equal(g.hands[p].length+g.decks[p].length+g.discarded[p].length+Object.values(g.used[p]).reduce((x,y)=>x+y),13);for(let i=0;i<91;i++)if(g.board[i])assert.ok(H.walkable(i,g.terrain,g.roads,g.blocked));for(let i=0;i<g.bridges.length;i++)assert.ok(H.bridgeValid(g.board,g.bridges[i].owner,g.bridges[i].a,g.bridges[i].b,g.bridges.filter((_,j)=>j!==i)));}const result=JSON.stringify({trace,result:g.result});g.reset();assert.ok(g.blocked.every(x=>!x));assert.equal(g.bridges.length,0);assert.equal(g.traps.length,0);assert.equal(g.ply,0);return result;}
 for(let seed=1;seed<=6;seed++){const first=run(seed);if(seed===1)assert.equal(run(seed),first);}
});

test('every personality uses reroute and exchange when they uniquely complete a public winning route',()=>{
 for(const profile of ['rush','cutter','multi'])for(const card of ['reroute','exchange']){const g=game();g.profiles[1]=profile;for(let r=-5;r<=5;r++)g.board[at(0,r)]=1;g.board[C]=2;hand(g,1,[card]);
 if(card==='reroute'){g.board[at(-2,1)]=1;g.board[at(-1,1)]=3;g.bridges=[{owner:1,a:at(0,-1),b:at(-2,1)}];}else{g.board[E]=1;g.board[at(1,-1)]=3;}
 const a=H.chooseAction(g.observation());assert.equal(a.type,card,profile);assert.ok(g.act(a));assert.equal(g.result.winner,1);
 }
});
test('AI uses a cannon-proof temporary block when an ordinary blocking stone would immediately be destroyed',()=>{
 const g=game();hand(g,1,['block']);for(let q=-5;q<=-1;q++)g.board[at(q,1)]=2;g.board[at(0,-1)]=2;for(let q=1;q<=5;q++)g.board[at(q,-2)]=2;g.board[at(-1,0)]=1;g.board[E]=3;g.turrets=[{owner:3,cell:E,nextFire:1,shots:1}];
 const a=H.chooseAction(g.observation());assert.equal(a.type,'block');assert.equal(a.cells[0],C);assert.ok(g.act(a));assert.ok(g.blocked[C]);assert.equal(g.board[C],0);
});
