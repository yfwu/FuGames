'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','card_hex.html'),'utf8');
const H=vm.runInNewContext(html.match(/<script id="hex-engine">([\s\S]*?)<\/script>/)[1]+'; CardHex;');
const seeded=seed=>()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
const g=()=>{const game=new H.Game(seeded(1));game.start();return game;};
const plain=value=>JSON.parse(JSON.stringify(value));

test('hex topology has six neighbours in the centre and never wraps rows',()=>{
  assert.deepEqual(Array.from(H.neighbors(24)).sort((a,b)=>a-b),[17,18,23,25,30,31]);
  assert.deepEqual(Array.from(H.neighbors(0)),[7,1]);assert.ok(!H.neighbors(6).includes(7));
  const b=Array(49).fill(0);assert.equal(H.shortest(b,1),7);assert.equal(H.shortest(b,2),7);
  for(let r=0;r<7;r++)b[r*7+3]=1;assert.ok(H.connected(b,1));assert.equal(H.shortest(b,2),Infinity);
  b[3*7+3]=0;assert.equal(H.shortest(b,1),1);assert.ok(!H.connected(b,1));
});
test('both players receive the same finite cards; draws never exceed four cards',()=>{
  const game=new H.Game(seeded(4));
  for(const p of [1,2])assert.deepEqual([...game.hands[p],...game.decks[p]].sort(),['double','double','double','remove','remove','shield','shield']);
  game.start();assert.equal(game.hands[1].length,3);game.draw();assert.equal(game.hands[1].length,4);const before=game.decks[1].length;game.draw();assert.equal(game.decks[1].length,before);
  game.hands[1]=[];for(let n=0;n<10;n++){game.draw();game.hands[1]=[];}assert.equal(game.decks[1].length,0);assert.equal(game.drawn,null);
});
test('ready, pause and terminal freeze moves; restart clears pending response and results',()=>{
  const game=new H.Game(seeded(1));assert.equal(game.act({type:'place',cells:[0]}),false);game.start();game.pause();const old=JSON.stringify(game);assert.equal(game.act({type:'place',cells:[0]}),false);assert.equal(JSON.stringify(game),old);game.start();assert.ok(game.act({type:'place',cells:[0]}));
  game.finish(1,'test');assert.equal(game.act({type:'place',cells:[1]}),false);game.reset(2);assert.equal(game.phase,'ready');assert.equal(game.turn,2);assert.equal(game.ply,0);assert.equal(game.pending,null);assert.equal(game.result,null);assert.ok(game.board.every(v=>v===0));
});
test('double is atomic, requires distinct adjacent empties, and can complete a line',()=>{
  const game=g();game.hands[1]=['double'];game.board[5]=2;
  for(const cells of [[0,0],[0,48],[4,5],[0],[0,1,2],[-1,0],[0,1.2]]){const old=JSON.stringify(game);assert.equal(game.act({type:'double',cells}),false);assert.equal(JSON.stringify(game),old);}
  game.board=Array(49).fill(0);for(const r of [0,1,4,5,6])game.board[r*7+3]=1;
  assert.ok(game.act({type:'double',cells:[17,24]}));assert.equal(game.result.winner,1);assert.equal(game.ply,1);assert.equal(game.hands[1].length,0);
});
test('removal opens one counter window; shield spends a card and the attacker turn',()=>{
  const game=g();game.board[10]=2;game.hands[1]=['remove'];game.hands[2]=['shield'];
  assert.ok(game.act({type:'remove',cells:[10]}));assert.equal(game.board[10],2);assert.equal(game.ply,0);assert.equal(game.pending.defender,2);assert.equal(game.act({type:'place',cells:[0]}),false);
  game.pause();assert.equal(game.respond(true),false);game.start();assert.ok(game.respond(true));assert.equal(game.board[10],2);assert.equal(game.last.countered,true);assert.equal(game.turn,2);assert.equal(game.ply,1);assert.ok(!game.hands[2].includes('shield')||game.drawn==='shield');assert.equal(game.respond(false),false);
});
test('accepting removal removes exactly one enemy stone and never spends a shield',()=>{
  const game=g();game.board[10]=2;game.board[11]=1;game.hands[1]=['remove'];game.hands[2]=[];game.decks[2]=[];
  assert.equal(game.act({type:'remove',cells:[11]}),false);assert.equal(game.act({type:'remove',cells:[12]}),false);assert.ok(game.act({type:'remove',cells:[10]}));assert.equal(game.respond(true),false);assert.ok(game.respond(false));assert.equal(game.board[10],0);assert.equal(game.board[11],1);assert.equal(game.last.countered,false);assert.equal(game.ply,1);assert.equal(game.turn,2);
});
test('connection wins before turn cap; cap compares shortest distance including ties',()=>{
  const game=g();game.ply=63;for(let r=0;r<6;r++)game.board[r*7]=1;assert.ok(game.act({type:'place',cells:[42]}));assert.equal(game.result.winner,1);assert.match(game.result.reason,/率先/);
  const limit=g();limit.ply=63;limit.act({type:'place',cells:[24]});assert.equal(limit.phase,'over');assert.equal(limit.result.winner,1);assert.match(limit.result.reason,/上限/);
  const tied=g();tied.ply=63;tied.board[0]=1;tied.board[48]=2;tied.hands[1]=['remove'];tied.act({type:'remove',cells:[48]});tied.hands[2]=['shield'];tied.respond(true);assert.equal(tied.result.winner,0);
});
test('AI closes winning routes, blocks an immediate enemy connection and uses double',()=>{
  const b=Array(49).fill(0);for(let r=0;r<7;r++)if(r!==3)b[r*7+3]=1;
  let action=H.chooseAction({board:b,player:1,hand:[],profile:'builder'});assert.equal(action.cells[0],24);
  const threat=Array(49).fill(0);for(let c=0;c<7;c++)if(c!==3)threat[3*7+c]=2;
  for(const profile of ['builder','cutter']){action=H.chooseAction({board:threat,player:1,hand:[],profile});assert.equal(action.cells[0],24);}
  b[17]=0;action=H.chooseAction({board:b,player:1,hand:['double'],profile:'builder'});assert.equal(action.type,'double');assert.deepEqual(Array.from(action.cells).sort((a,b)=>a-b),[17,24]);
});
test('AI counter protects a critical route and own observations exclude private opponents',()=>{
  const game=g();for(let c=0;c<6;c++)game.board[3*7+c]=2;game.pending={attacker:1,defender:2,cell:24};game.hands[2]=['shield'];assert.equal(H.chooseCounter(game.observation(2)),true);game.hands[2]=[];assert.equal(H.chooseCounter(game.observation(2)),false);
  game.pending=null;game.hands[2]=['double'];const view=plain(game.observation(2)),choice=plain(H.chooseAction(view));game.hands[1]=['remove','remove','shield','double'];game.decks[1]=['shield'];assert.deepEqual(plain(game.observation(2)),view);assert.deepEqual(plain(H.chooseAction(game.observation(2))),choice);
});
test('AI personalities make different strategic choices on the same public board',()=>{
  const board=Array(49).fill(0);for(const i of [6,12,30,36])board[i]=1;for(const i of [11,14,21,31,43])board[i]=2;
  const builder=H.chooseAction({board,player:1,hand:['double','remove'],profile:'builder'}),cutter=H.chooseAction({board,player:1,hand:['double','remove'],profile:'cutter'});
  assert.equal(builder.type,'double');assert.deepEqual(Array.from(builder.cells),[18,24]);assert.equal(cutter.type,'place');assert.equal(cutter.cells[0],42);
});
test('20 complete seeded AI games terminate and conserve board and finite card supply',()=>{
  const styles=new Set(),seen=new Set();
  for(let seed=1;seed<=20;seed++){
    const game=new H.Game(seeded(seed),seed%2?'builder':'cutter',seed%2+1);game.start();let actions=0;
    while(game.phase==='running'){
      if(game.pending){const shield=H.chooseCounter(game.observation(game.pending.defender));assert.ok(game.respond(shield));}
      else{const player=game.turn,view=game.observation(player);view.profile=player===1?'builder':'cutter';const action=H.chooseAction(view);assert.ok(action);seen.add(action.type);assert.ok(game.act(action));actions++;}
      assert.ok(game.ply<=64);assert.ok(game.board.every(p=>[0,1,2].includes(p)));assert.ok(game.hands[1].length<=4&&game.hands[2].length<=4);assert.ok(actions<=65);
      for(const p of [1,2])assert.ok(game.hands[p].length+game.decks[p].length<=7);
    }
    assert.ok([0,1,2].includes(game.result.winner));styles.add(game.result.winner);
  }
  assert.ok(styles.size>=1);assert.ok(seen.has('place')&&seen.has('double')&&seen.has('remove'));
});
