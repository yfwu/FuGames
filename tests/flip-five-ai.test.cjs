'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path'),fs=require('node:fs'),base=fs.existsSync(path.join(__dirname,'flip-five-engine.js'))?__dirname:path.join(__dirname,'..');
const F=require(path.join(base,'flip-five-engine.js')),AI=require(path.join(base,'flip-five-ai.js'));
const blank=()=>Array(81).fill(0),index=s=>(+s.slice(1)-1)*9+s.charCodeAt(0)-65;
function replay(moves,first=1){let board=blank(),player=first;for(const name of moves){const result=F.apply(board,index(name),player);assert.ok(result);board=result.board;player=3-player;}return{board,player};}
let seed=91357;function random(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;}
test('incremental search transition agrees with production rules on seeded reachable boards',()=>{let checked=0;for(let game=0;game<16;game++){let board=blank(),player=game%2+1;for(let ply=0;ply<35;ply++){const legal=F.legalMoves(board),cell=legal[Math.floor(random()*legal.length)],expected=F.apply(board,cell,player),actual=AI._testing.apply(AI._testing.state(board),cell,player);assert.deepEqual(Array.from(actual.board),expected.board);assert.equal(actual.winner,F.outcome(expected.board)?.winner??-1);assert.equal(actual.flips,expected.flipped.length);checked++;board=expected.board;if(F.outcome(board))break;player=3-player;}}assert.ok(checked>300);});
test('hypothetical win probes match actual move outcomes and restore the board',()=>{for(let game=0;game<8;game++){let board=blank(),player=game%2+1;for(let ply=0;ply<24;ply++){const legal=F.legalMoves(board),cell=legal[Math.floor(random()*legal.length)],move=F.apply(board,cell,player);board=move.board;if(F.outcome(board))break;player=3-player;}if(F.outcome(board))continue;const state=AI._testing.state(board),copy=Array.from(state.board);for(const p of [1,2])for(const cell of F.legalMoves(board)){const found=AI._testing.winningMove(state,cell,p,{nodes:0,tacticalChecks:0});assert.equal(found,F.outcome(F.apply(board,cell,p).board)?.winner===p);assert.deepEqual(Array.from(state.board),copy);}}});
test('takes an immediate capture-five and rejects terminal or malformed observations',()=>{const board=blank();for(const c of [37,38,39])board[c]=2;board[40]=1;for(const profile of ['architect','flipper']){const move=AI.chooseMove({board,player:1,profile});assert.equal(F.outcome(F.apply(board,move.cell,1).board).winner,1);assert.ok(move.stats.nodes<=move.stats.nodeBudget);}assert.equal(AI.chooseMove(null),null);assert.equal(AI.chooseMove({board:[],player:1}),null);board.fill(1);assert.equal(AI.chooseMove({board,player:2}),null);});
test('complete root defense finds the unique diagonal rescue after E5 E4 E3 D5 E2',()=>{for(const first of [1,2])for(const profile of ['architect','flipper']){const view=replay(['E5','E4','E3','D5','E2'],first);view.profile=profile;const move=AI.chooseMove(view,{seed:1337});assert.equal(move.cell,index('F3'));assert.equal(move.stats.safeCandidates,1);assert.equal(F.immediateWins(F.apply(view.board,move.cell,view.player).board,3-view.player).length,0);}});
test('historical fourth move chooses a reply that refutes forced win by ply seven',()=>{const eligible=['D3','F3','D4','F4','D5','F5'].map(index);for(const first of [1,2])for(const profile of ['architect','flipper']){const view=replay(['E5','E4','E3'],first);view.profile=profile;const move=AI.chooseMove(view,{seed:871});assert.ok(eligible.includes(move.cell),JSON.stringify(move));}});
test('search is deterministic, bounded and never mutates a caller observation',()=>{const view={...replay(['E5','D4','C3','E3']),profile:'flipper'},before=JSON.stringify(view),options={seed:991,nodeBudget:8000,maxDepth:6};const a=AI.chooseMove(view,options),b=AI.chooseMove(view,options);assert.deepEqual(a,b);assert.equal(JSON.stringify(view),before);assert.ok(a.stats.nodes<=8000);assert.equal(a.stats.proof,false);assert.ok(a.stats.completedDepth>=1);assert.equal(view.board[a.cell],0);});

test('opening response avoids the certified adjacent blunder for both colors, profiles and deterministic seeds',()=>{const adjacent=['E4','D5','F5','E6'].map(index);for(const first of [1,2])for(const profile of ['architect','flipper'])for(const seed of [0,17]){const view={...replay(['E5'],first),profile},move=AI.chooseMove(view,{seed});assert.ok(!adjacent.includes(move.cell),JSON.stringify(move));assert.ok(move.stats.nodes<=move.stats.nodeBudget);}});

// ---- Opponent tiers ----
test('master tier is exactly the original strongest search (36k budget, depth 4, width 12, seed 0)',()=>{
  assert.deepEqual(AI.searchOptions('master'),{seed:0,nodeBudget:36000,maxDepth:4,width:12});
  for(const line of [['E5'],['E5','E4','E3'],['E5','D4','C3','E3']])for(const profile of ['architect','flipper']){const view={...replay(line),profile};const a=AI.chooseTier(view,'master'),b=AI.chooseMove(view,{seed:0,nodeBudget:36000,maxDepth:4,width:12});assert.equal(a.cell,b.cell);assert.equal(a.stats.nodes,b.stats.nodes);assert.equal(a.stats.tier,'master');}
  assert.equal(AI.chooseTier(replay(['E5']),'no-such-tier').stats.tier,'master');
});
test('tiers are ordered, bounded, deterministic and always legal',()=>{
  assert.deepEqual(AI.TIER_ORDER,['novice','adept','expert','master','grand']);
  const budgets=AI.TIER_ORDER.map(t=>AI.searchOptions(t).nodeBudget||0);assert.ok(budgets[2]<budgets[3]&&budgets[3]<budgets[4]);
  const view={...replay(['E5','D4','C3','E3','F6']),profile:'architect'};
  for(const tier of AI.TIER_ORDER){const a=AI.chooseTier(view,tier,{seed:11}),b=AI.chooseTier(view,tier,{seed:11});assert.deepEqual(a,b);assert.equal(view.board[a.cell],0);assert.ok(a.stats.nodes<=Math.max(a.stats.nodeBudget,81));assert.equal(a.stats.tier,tier);}
  assert.equal(AI.chooseTier(null,'grand'),null);assert.equal(AI.chooseTier({board:Array(81).fill(1),player:2},'novice'),null);assert.equal(AI.chooseTier({board:Array(81).fill(1),player:2},'adept'),null);
});
test('every tier takes an immediate capture-five; novice varies with its seed but not within one',()=>{
  const board=blank();for(const c of [37,38,39])board[c]=2;board[40]=1;
  for(const tier of AI.TIER_ORDER){const move=AI.chooseTier({board,player:1,profile:'architect'},tier,{seed:3});assert.equal(F.outcome(F.apply(board,move.cell,1).board).winner,1,tier);}
  const view={...replay(['E5','C3']),profile:'architect'},cells=new Set();for(let seed=0;seed<40;seed++)cells.add(AI.chooseTier(view,'novice',{seed}).cell);assert.ok(cells.size>1);
});
test('the expert search beats the novice over seeded games played from both colours',()=>{
  let strong=0,weak=0;
  for(let g=0;g<4;g++){let board=blank(),player=1;const strongSide=g%2+1;
    for(let ply=0;ply<81;ply++){const tier=player===strongSide?'expert':'novice';const move=AI.chooseTier({board,player,profile:'architect'},tier,{seed:g*101+ply});board=F.apply(board,move.cell,player).board;const out=F.outcome(board);if(out){if(out.winner===strongSide)strong++;else if(out.winner)weak++;break;}player=3-player;}}
  assert.ok(strong>weak,`expert ${strong} vs novice ${weak}`);
});
test('rocks: incremental search agrees with the rules engine, never plays a rock, counts majority over stones',()=>{
  let checked=0;
  for(let game=0;game<10;game++){let board=F.setupBoard({seed:game+1,rocks:true,scatter:game%2===0}),player=game%2+1;
    for(let ply=0;ply<40;ply++){const legal=F.legalMoves(board),cell=legal[Math.floor(random()*legal.length)],expected=F.apply(board,cell,player),actual=AI._testing.apply(AI._testing.state(board),cell,player);
      assert.deepEqual(Array.from(actual.board),expected.board);assert.equal(actual.winner,F.outcome(expected.board)?.winner??-1);checked++;board=expected.board;if(F.outcome(board))break;player=3-player;}
    if(!F.outcome(board)){const move=AI.chooseTier({board,player,profile:'flipper'},'expert',{seed:game});assert.equal(board[move.cell],0);}}
  assert.ok(checked>200);
  // near-full board with rocks: the last empty cell decides by stone majority, rocks excluded
  const full=Array.from({length:81},(_,i)=>((Math.floor(i/9)+Math.floor(i%9/2))%2)+1);for(const i of [0,1,2,3])full[i]=F.ROCK;full[80]=0;
  for(const p of [1,2]){const expected=F.outcome(F.apply(full,80,p).board),s=AI._testing.state(full);assert.equal(AI._testing.apply(s,80,p).winner,expected.winner);assert.equal(AI._testing.winningMove(s,80,p,{nodes:0,tacticalChecks:0}),expected.winner===p);}
  const dead=AI._testing.state(F.setupBoard({seed:3,rocks:true}));assert.equal(dead.rocks,6);assert.equal(dead.dead.reduce((n,x)=>n+x,0)>0,true);assert.equal(AI._testing.state(blank()).dead.length,0);
});
