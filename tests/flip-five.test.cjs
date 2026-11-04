'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const F=require('../flip-five-engine.js');
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

// ---- Variants: neutral rocks (石陣) and symmetric scatter openings (散局) ----
test('rocks stop sandwich rays, never join lines, are not legal moves and are ignored by the full-board count',()=>{
  const b=blank();b[41]=2;b[42]=F.ROCK;b[43]=1;assert.equal(F.flips(b,40,1).length,0);
  b[42]=2;assert.deepEqual(Array.from(F.flips(b,40,1)),[41,42]);
  const ray=blank();ray[41]=F.ROCK;ray[42]=1;assert.equal(F.flips(ray,40,2).length,0);assert.equal(F.apply(ray,41,1),null);
  const line=blank();for(const c of [36,37,39,40,41])line[c]=1;line[38]=F.ROCK;assert.equal(F.outcome(line),null);assert.equal(F.winningLines(line)[1].length,0);
  assert.ok(!F.legalMoves(line).includes(38));
  // Rocks on a full board without lines: majority is counted over stones only.
  const full=Array.from({length:81},(_,i)=>((Math.floor(i/9)+Math.floor(i%9/2))%2)+1);for(const i of [0,1,2])full[i]=F.ROCK;
  const n=full.filter(p=>p===1).length,m=full.filter(p=>p===2).length;const out=F.outcome(full);assert.equal(out.winner,n>m?1:n<m?2:0);assert.match(out.reason,new RegExp(`朱子 ${n} 枚，青子 ${m} 枚`));
});
test('dead segments: a five-cell window containing a rock is worth nothing to either side',()=>{
  const open=blank();for(const c of [36,37,38,39])open[c]=1;const blocked=open.slice();blocked[40]=F.ROCK;
  assert.ok(F.evaluate(open,1,'architect')>F.evaluate(blocked,1,'architect'));
  const onlyRock=blank();onlyRock[40]=F.ROCK;assert.equal(F.evaluate(onlyRock,1,'flipper'),F.evaluate(onlyRock,2,'flipper'));
  // the legacy chooser never plays on a rock and still finds a win next to one
  const near=blank();for(const c of [36,37,38,39])near[c]=1;near[45]=F.ROCK;assert.equal(F.chooseLegacyMove({board:near,player:1}).cell,40);
});
test('rock and scatter layouts are seeded, point-symmetric, spaced and keep the centre open',()=>{
  for(const seed of [1,2,99,123456]){
    const rocks=F.rockLayout(seed);assert.equal(rocks.length,6);assert.deepEqual(rocks,F.rockLayout(seed));assert.ok(!rocks.includes(40));
    for(const i of rocks){assert.ok(rocks.includes(80-i));for(const j of rocks)if(i!==j)assert.ok(Math.max(Math.abs(Math.floor(i/9)-Math.floor(j/9)),Math.abs(i%9-j%9))>=2);}
    const s=F.scatterLayout(seed,2,rocks);assert.equal(s[1].length,2);assert.deepEqual(s[2],s[1].map(i=>80-i));for(const i of [...s[1],...s[2]])assert.ok(!rocks.includes(i)&&i!==40);
    const board=F.setupBoard({seed,rocks:true,scatter:true});assert.equal(board.filter(p=>p===F.ROCK).length,6);assert.equal(board.filter(p=>p===1).length,2);assert.equal(board.filter(p=>p===2).length,2);assert.equal(F.outcome(board),null);
  }
  assert.notDeepEqual(F.rockLayout(1),F.rockLayout(2));
  assert.deepEqual(F.setupBoard({seed:5}),blank());assert.deepEqual(F.setupBoard(),blank());
});
test('a configured start position survives reset; configure(null) restores the classic empty board',()=>{
  const start=F.setupBoard({seed:7,rocks:true});const game=new F.Game();game.configure({board:start});game.reset(1);assert.deepEqual(game.board,start);
  game.start();const cell=F.legalMoves(game.board)[0];assert.ok(game.act(cell));assert.equal(game.ply,1);assert.ok(!F.legalMoves(game.board).some(i=>start[i]===F.ROCK));
  game.reset(2);assert.deepEqual(game.board,start);assert.equal(game.turn,2);assert.equal(game.ply,0);
  game.configure(null);game.reset(1);assert.ok(game.board.every(p=>!p));assert.equal(game.goal,null);
});

// ---- Puzzles (殘局): every position is verified against the rules ----
const P=id=>F.PUZZLES.find(p=>p.id===id),position=id=>F.puzzlePosition(P(id));
function forcedWinIn2(board,move){
  const first=F.apply(board,move,1);if(!first||F.outcome(first.board))return false;
  for(const reply of F.legalMoves(first.board)){const r=F.apply(first.board,reply,2),out=F.outcome(r.board);if(out){if(out.winner!==1)return false;continue;}if(!F.immediateWins(r.board,1).length)return false;}
  return true;
}
test('puzzle catalogue: ten unique ids in four chapters; every start is legal, unfinished and has the stated side to move',()=>{
  assert.equal(F.PUZZLES.length,10);assert.equal(new Set(F.PUZZLES.map(p=>p.id)).size,10);assert.deepEqual([...new Set(F.PUZZLES.map(p=>p.chapter))],[1,2,3,4]);
  for(const p of F.PUZZLES){const pos=F.puzzlePosition(p);assert.equal(pos.board.length,81);assert.ok(pos.board.every(v=>[0,1,2].includes(v)));assert.equal(F.outcome(pos.board),null,p.id);assert.equal(pos.toMove,p.aiFirst?2:1,p.id);assert.ok(['win','survive'].includes(p.goal.type));assert.ok(p.goal.moves>=1);assert.ok(p.title&&p.brief&&p.hint);}
});
test('chapter 1: one unique capture-five; the AI has no immediate win of its own',()=>{
  for(const id of ['cap-1','cap-2']){const {board}=position(id);const wins=F.immediateWins(board,1);assert.equal(wins.length,1,id);assert.ok(F.apply(board,wins[0],1).flipped.length>=2,id);assert.equal(F.immediateWins(board,2).length,0,id);}
  assert.equal(F.coord(F.immediateWins(position('cap-1').board,1)[0]),'F8');
});
test('chapter 2: exactly one move stops every immediate AI win (including the certified F3 rescue)',()=>{
  for(const [id,answer] of [['def-1','E3'],['def-2','A5'],['def-3','F3']]){const {board}=position(id);assert.ok(F.immediateWins(board,2).length>=1,id);assert.equal(F.immediateWins(board,1).length,0,id);
    const safe=F.legalMoves(board).filter(i=>!F.immediateWins(F.apply(board,i,1).board,2).length);assert.deepEqual(safe.map(F.coord),[answer],id);}
});
test('chapter 3: a forced win in two exists and no win in one does',()=>{
  for(const [id,answer] of [['two-1','H1'],['two-2','G3'],['two-3','D8']]){const {board}=position(id);assert.equal(F.immediateWins(board,1).length,0,id);assert.equal(F.immediateWins(board,2).length,0,id);assert.ok(forcedWinIn2(board,F.cellOf(answer)),id);}
});
test('chapter 4: after E5 E4 E3 E7 E2 every AI reply allows a winning answer; E5 E4 E3 replays the certified premise',()=>{
  const {board}=position('cert-1');for(const reply of F.legalMoves(board)){const r=F.apply(board,reply,2);assert.equal(F.outcome(r.board),null);assert.ok(F.immediateWins(r.board,1).length>0,F.coord(reply));}
  const proof=position('cert-2');assert.equal(proof.toMove,2);assert.deepEqual([40,31,22].map(i=>proof.board[i]),[1,1,1]);assert.equal(proof.board.filter(Boolean).length,3);
});
test('puzzle goals: a win goal fails once its moves are spent, a survive goal succeeds after enough replies, real outcomes come first',()=>{
  const game=new F.Game();const {board}=position('cap-1');game.configure({board,goal:P('cap-1').goal});game.reset(1);game.start();
  const wrong=F.legalMoves(board).find(i=>!F.outcome(F.apply(board,i,1).board));assert.ok(game.act(wrong));assert.equal(game.phase,'over');assert.equal(game.result.winner,2);assert.equal(game.result.puzzle,'failed');assert.match(game.result.reason,/1 手內/);
  game.reset(1);game.start();assert.equal(game.goal.used,0);assert.ok(game.act(F.cellOf('F8')));assert.equal(game.result.winner,1);assert.equal(game.result.puzzle,'solved');assert.ok(game.result.lines[1].length);
  const def=position('def-1');game.configure({board:def.board,goal:P('def-1').goal});game.reset(1);game.start();assert.ok(game.act(F.cellOf('E3')));assert.equal(game.phase,'running');assert.equal(game.goal.used,0);
  const reply=F.legalMoves(game.board).find(i=>!F.outcome(F.apply(game.board,i,2).board));assert.ok(game.act(reply));assert.equal(game.phase,'over');assert.equal(game.result.winner,1);assert.equal(game.result.puzzle,'solved');
  game.reset(1);game.start();const lose=F.legalMoves(def.board).find(i=>F.immediateWins(F.apply(def.board,i,1).board,2).length);game.act(lose);game.act(F.immediateWins(game.board,2)[0]);assert.equal(game.result.winner,2);assert.equal(game.result.puzzle,'failed');
  const two=position('two-1');game.configure({board:two.board,goal:P('two-1').goal});game.reset(1);game.start();game.act(F.cellOf('H1'));assert.equal(game.goal.used,1);assert.equal(game.phase,'running');
});
test('coordinates round-trip and reject malformed names',()=>{for(let i=0;i<81;i++)assert.equal(F.cellOf(F.coord(i)),i);for(const bad of ['','J1','A0','A10',null,'e5x'])assert.equal(F.cellOf(bad),-1);assert.equal(F.cellOf(' e5 '),40);});
