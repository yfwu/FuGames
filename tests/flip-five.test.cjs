'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','flip_five.html'),'utf8');
const F=vm.runInNewContext(html.match(/<script id="flip-engine">([\s\S]*?)<\/script>/)[1]+'; FlipFive;');
const blank=()=>Array(81).fill(0),plain=v=>JSON.parse(JSON.stringify(v));

test('all empty cells are legal even without a bracket; illegal actions are atomic',()=>{
  const game=new F.Game();assert.equal(F.legalMoves(game.board).length,81);assert.equal(game.act(40),false);game.start();assert.ok(game.act(40));assert.equal(game.last.flipped.length,0);assert.equal(F.legalMoves(game.board).length,80);
  for(const cell of [40,-1,81,3.2,undefined]){const old=JSON.stringify(game);assert.equal(game.act(cell),false);assert.equal(JSON.stringify(game),old);}
});
test('all eight sandwich rays flip simultaneously; edges never wrap and there is no cascade',()=>{
  const b=blank();for(const[dr,dc]of F.DIRS){b[(4+dr)*9+4+dc]=2;b[(4+2*dr)*9+4+2*dc]=1;}
  const move=F.apply(b,40,1);assert.equal(move.flipped.length,8);assert.equal(move.board.filter(p=>p===1).length,17);assert.equal(b[40],0);assert.equal(b[41],2);
  const cascade=blank();cascade[41]=2;cascade[42]=1;cascade[32]=2;cascade[23]=1;const next=F.apply(cascade,40,1);assert.equal(next.board[41],1);assert.equal(next.board[32],2);
  const edge=blank();edge[8]=1;edge[9]=2;assert.equal(F.flips(edge,10,1).length,0);
});
test('open rays, friendly neighbours and interrupted chains do not flip',()=>{
  const b=blank();b[41]=2;b[42]=2;assert.equal(F.flips(b,40,1).length,0);b[43]=1;assert.deepEqual(Array.from(F.flips(b,40,1)),[41,42]);b[42]=0;assert.equal(F.flips(b,40,1).length,0);b[41]=1;assert.equal(F.flips(b,40,1).length,0);
});
test('victory is evaluated after every flip and includes longer lines and both diagonals',()=>{
  const game=new F.Game();game.start();game.board[37]=game.board[38]=game.board[39]=2;game.board[40]=1;assert.ok(game.act(36));assert.equal(game.phase,'over');assert.equal(game.result.winner,1);assert.equal(game.last.flipped.length,3);
  for(const cells of [[0,10,20,30,40],[8,16,24,32,40],[0,9,18,27,36,45],[9,10,11,12,13,14]]){const b=blank();for(const i of cells)b[i]=2;assert.equal(F.outcome(b).winner,2);assert.equal(F.winningLines(b)[2][0].length,cells.length);}
});
test('simultaneous final lines draw; full board without five counts stones, with lines takes precedence',()=>{
  const both=blank();for(let c=0;c<5;c++){both[c]=1;both[72+c]=2;}assert.equal(F.outcome(both).winner,0);assert.match(F.outcome(both).reason,/雙方/);
  // Repeating 2x2 blocks have no straight five in the four winning directions.
  const full=Array.from({length:81},(_,i)=>((Math.floor(i/9)+Math.floor(i%9/2))%2)+1);
  assert.equal(F.winningLines(full)[1].length,0);assert.equal(F.winningLines(full)[2].length,0);assert.equal(F.legalMoves(full).length,0);assert.equal(F.outcome(full).winner,1);assert.match(F.outcome(full).reason,/滿盤/);
  const even=[1,1,2,2,2,2,1,1,1,1,2,2,2,2,1,1];assert.equal(F.outcome(even,4).winner,0);
  full.fill(1);assert.equal(F.outcome(full).winner,1);assert.match(F.outcome(full).reason,/五連/);
});
test('pause and terminal states freeze and restart restores an empty board with selected starter',()=>{
  const game=new F.Game();game.start();game.act(40);game.pause();const old=JSON.stringify(game);assert.equal(game.act(30),false);assert.equal(JSON.stringify(game),old);game.start();assert.ok(game.act(30));game.phase='over';assert.equal(game.act(29),false);game.reset(2);assert.equal(game.turn,2);assert.equal(game.phase,'ready');assert.equal(game.ply,0);assert.equal(game.last,null);assert.equal(game.result,null);assert.ok(game.board.every(p=>!p));
});
test('AI recognizes a winning capture and always takes a direct immediate win',()=>{
  const b=blank();b[37]=b[38]=b[39]=2;b[40]=1;
  for(const profile of ['architect','flipper']){const move=F.chooseMove({board:b,player:1,profile});assert.ok(move);assert.equal(F.outcome(F.apply(b,move.cell,1).board).winner,1);}
  const direct=blank();direct[36]=2;for(let c=1;c<5;c++)direct[36+c]=1;assert.equal(F.chooseMove({board:direct,player:1,profile:'architect'}).cell,41);
});
test('AI blocks a sole immediate threat and searches a defensive capture off the threat cell',()=>{
  const b=blank();b[36]=1;for(let c=1;c<5;c++)b[36+c]=2;
  for(const profile of ['architect','flipper']){const move=F.chooseMove({board:b,player:1,profile});assert.equal(F.immediateWins(F.apply(b,move.cell,1).board,2).length,0);}
  const capture=blank();for(let c=2;c<6;c++)capture[4*9+c]=2;capture[2*9+3]=1;capture[3*9+3]=2;
  assert.ok(F.immediateWins(capture,2).length>=2);
  const move=F.chooseMove({board:capture,player:1,profile:'architect'});assert.ok(F.apply(capture,move.cell,1).flipped.length>0);assert.equal(F.immediateWins(F.apply(capture,move.cell,1).board,2).length,0);
});
test('public observations are copied and personality changes actual board preferences',()=>{
  const game=new F.Game();const view=game.observation();view.board[0]=2;assert.equal(game.board[0],0);
  const fixture=blank();fixture[40]=1;fixture[41]=2;fixture[42]=2;fixture[30]=1;fixture[31]=2;
  const a=F.evaluate(fixture,1,'architect'),b=F.evaluate(fixture,1,'flipper');assert.notEqual(a,b);
  assert.deepEqual(plain(F.chooseMove(game.observation())),plain(F.chooseMove(game.observation())));
  const board=blank();for(const i of [6,40,54,61,80])board[i]=1;for(const i of [28,34,38,63])board[i]=2;
  assert.equal(F.chooseMove({board,player:1,profile:'architect'}).cell,60);assert.equal(F.chooseMove({board,player:1,profile:'flipper'}).cell,72);
});
test('12 AI matches with varied legal openings finish in at most 81 placements',()=>{
  let flipCount=0,winCount=0;
  for(let seed=0;seed<12;seed++){
    const game=new F.Game(seed%2?'architect':'flipper',seed%2+1);game.start();game.act((seed*17+10)%81);game.act((seed*13+37)%81===game.last.cell?(game.last.cell+1)%81:(seed*13+37)%81);
    while(game.phase==='running'){
      const emptyBefore=F.legalMoves(game.board).length,view=game.observation();view.profile=game.turn===1?'architect':'flipper';const action=F.chooseMove(view);assert.ok(action);assert.ok(game.act(action.cell,action.reason));flipCount+=game.last.flipped.length;
      assert.equal(F.legalMoves(game.board).length,emptyBefore-1);assert.ok(game.ply<=81);assert.ok(game.board.every(p=>[0,1,2].includes(p)));
    }
    assert.ok([0,1,2].includes(game.result.winner));if(game.result.winner)winCount++;
  }
  assert.ok(flipCount>20);assert.ok(winCount>0);
});
