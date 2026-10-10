'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'gravity_brawl.html'), 'utf8');
const T = vm.runInNewContext(html.match(/<script id="brawl-engine">([\s\S]*?)<\/script>/)[1] + '; GravityBrawl;');
const seeded = seed => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const occupied = board => board.flat().filter(Boolean).length;
const fixture = () => { const g = new T.Game(seeded(7)); g.start(); return g; };
const native = value => JSON.parse(JSON.stringify(value));

test('seven-bag sequence contains every shape once per bag and all seats share current/next pieces', () => {
  const g = fixture(), sequence=[g.piece,g.nextPiece];
  for(let i=0;i<26;i++) sequence.push(g.drawPiece());
  for(let i=0;i<sequence.length;i+=7) assert.equal(new Set(sequence.slice(i,i+7)).size,7);
  for(const type of T.TYPES) for(const shape of T.SHAPES[type]) {
    assert.equal(shape.length,4);assert.equal(new Set(shape.map(c=>c.join(','))).size,4);
  }
  assert.equal(g.actors.length,4);
});

test('legal landing stays in bounds, stops at obstacles, and cannot teleport through blocked entry', () => {
  const b=T.emptyBoard(); b[7][3]=8;
  const p=T.landing(b,'I',0,1); assert.equal(p.y,6);
  assert.equal(T.landing(b,'I',0,-1),null); assert.equal(T.landing(b,'I',0,7),null);
  b[0][3]=8;assert.equal(T.landing(b,'I',0,1),null);
  const dropped=T.place(b,'O',T.landing(b,'O',0,7)); assert.equal(occupied(dropped.board),6);
  assert.equal(T.place(b,'I',{x:1,y:8,rotation:0}),null);
  assert.equal(T.place(b,'I',{x:1,y:8,rotation:9}),null);
});

test('one and four completed lines clear simultaneously with exact conservation', () => {
  for(const count of [1,4]) {
    const b=T.emptyBoard();
    for(let y=10-count;y<10;y++) b[y].fill(8);
    const result=T.clearLines(b);assert.equal(result.lines,count);assert.equal(occupied(result.board),0);
    assert.equal(occupied(b),count*10,'pure function preserves input');
  }
  const b=T.emptyBoard();b[9].fill(8);for(let x=3;x<7;x++)b[9][x]=0;
  const p=T.place(b,'I',T.landing(b,'I',0,3));assert.equal(p.lines,1);assert.equal(occupied(p.board),0);
});

test('gravity coordinates invert in all four directions; rotation preserves world positions before settling', () => {
  for(let g=0;g<4;g++)for(let y=0;y<10;y++)for(let x=0;x<10;x++) {
    const w=T.world(x,y,g);assert.deepEqual(native(T.canonical(...w,g)),[x,y]);
  }
  const b=T.emptyBoard();b[3][7]=2;b[3][4]=3;
  const r=T.rotateBoard(b);
  assert.equal(r.board[8][3],2);assert.equal(r.board[9][3],3);
  assert.deepEqual(native(T.world(3,9,1)),[0,3]);
  assert.equal(occupied(r.board),2);assert.equal(r.lines,0);assert.equal(b[3][7],2);
});

test('rotating settlement clears perpendicular full lines and keeps no floating cells', () => {
  const b=T.emptyBoard();for(let y=0;y<10;y++)b[y][9]=1;
  const r=T.rotateBoard(b);assert.equal(r.lines,1);assert.equal(occupied(r.board),0);
  for(let seed=1;seed<=80;seed++) {
    const rand=seeded(seed),board=T.emptyBoard();
    for(let y=0;y<10;y++)for(let x=0;x<10;x++)if(rand()<.3)board[y][x]=1;
    const next=T.rotateBoard(board);
    assert.equal(occupied(next.board)+next.lines*10,occupied(board));
    assert.equal(T.features(next.board).holes,0);
  }
});

test('garbage enters from gravity floor, has one gap, and only occupied outgoing edge overflows', () => {
  const b=T.emptyBoard();b[3][3]=1;
  const r=T.addGarbage(b,[2,7]);assert.equal(r.overflow,false);assert.equal(r.board[1][3],1);
  assert.equal(r.board[8][2],0);assert.equal(r.board[9][7],0);assert.equal(occupied(r.board),19);
  const edge=T.emptyBoard();edge[0][9]=1;assert.equal(T.addGarbage(edge,[0]).overflow,true);
  edge[0][9]=0;edge[1][9]=1;
  assert.equal(T.addGarbage(edge,[0]).overflow,false);assert.equal(T.addGarbage(edge,[0,1]).overflow,true);
  assert.equal(T.addGarbage(T.emptyBoard(),Array(11).fill(0)).overflow,true);
});

function clearingFixture(pending=0) {
  const g=fixture();g.piece='I';g.nextPiece='O';
  const b=g.actors[0].board;b[9].fill(8);for(let x=3;x<7;x++)b[9][x]=0;
  g.actors[0].pending=pending;g.selection=T.landing(b,'I',0,3);return g;
}

test('attacks cancel pending first, delivery waits a full beat, and routing skips eliminated actors', () => {
  let g=clearingFixture(1);g.resolve();
  assert.equal(g.actors[0].cancelled,1);assert.equal(g.actors[0].pending,0);assert.equal(occupied(g.actors[0].board),0);
  assert.equal(g.actors[1].pending,0);assert.equal(g.actors[0].sent,0);
  g=clearingFixture();g.resolve();assert.equal(g.actors[1].pending,1);assert.equal(g.actors[0].sent,1);
  assert.equal(occupied(g.actors[1].board),4,'new attack has not yet entered the opponent board');
  g.resolve();assert.equal(g.actors[1].pending,0);assert.equal(occupied(g.actors[1].board),17);
  g=clearingFixture();g.actors[1].alive=false;g.resolve();assert.equal(g.actors[2].pending,1);
  g=clearingFixture(2);g.resolve();assert.equal(g.actors[0].cancelled,1);assert.equal(occupied(g.actors[0].board),9);
});

test('rotation is forewarned for exactly four beats; cascade lines count but do not attack', () => {
  const g=fixture();g.wave=4;g.piece='I';g.nextPiece='O';
  // A tall stack has nine occupied rows, adding a horizontal piece introduces the tenth occupied row.
  const b=g.actors[0].board;for(let y=1;y<10;y++)b[y][0]=1;
  g.selection=T.landing(b,'I',0,0);
  assert.equal(g.untilTurn(),1);g.resolve();
  assert.equal(g.gravity,1);assert.equal(g.wave,5);assert.equal(g.untilTurn(),4);
  assert.equal(g.actors[0].lines,1);assert.equal(g.actors[0].sent,0);assert.equal(g.actors[1].pending,0);
});

test('ready/pause/finished states freeze, resume preserves timer, timeout resolves once, reset clears resources', () => {
  const g=new T.Game(seeded(8));g.tick(7);assert.equal(g.wave,1);assert.equal(g.move(1),false);
  g.start();g.tick(2);g.pause();const snapshot=JSON.stringify(g);g.tick(30);g.resolve();g.rotate();assert.equal(JSON.stringify(g),snapshot);
  g.start();assert.equal(g.remaining,5);g.tick(100);assert.equal(g.wave,2);assert.equal(g.remaining,7);
  g.wave=24;g.checkResult();const end=JSON.stringify(g);g.tick(50);g.resolve();assert.equal(JSON.stringify(g),end);
  g.reset();assert.equal(g.phase,'ready');assert.equal(g.wave,1);assert.equal(g.gravity,0);assert.equal(g.result,null);
  assert.ok(g.actors.every(a=>a.alive&&a.pending===0&&a.lines===0&&occupied(a.board)===0));
});

test('no legal entry and garbage overflow eliminate; whole batch resolves before all-out draw', () => {
  let g=fixture();g.actors[0].board[0].fill(8);g.selectDefault();assert.equal(g.selection,null);g.resolve();
  assert.equal(g.result.outcome,'loss');assert.match(g.result.reason,/合法落點/);
  g=fixture();g.actors.forEach(a=>a.board[0].fill(8));g.selectDefault();g.resolve();
  assert.equal(g.result.outcome,'draw');assert.equal(g.actors.filter(a=>a.alive).length,0);
  g=fixture();g.actors[0].pending=11;g.resolve();assert.equal(g.result.outcome,'loss');assert.match(g.result.reason,/頂出/);
});

test('last survivor, timeout winner, shared lead and losing tie are distinguished', () => {
  let g=fixture();g.actors.slice(1).forEach(a=>a.alive=false);g.checkResult();assert.equal(g.result.outcome,'win');
  for(const [scores,outcome] of [[[7,6,5,4],'win'],[[7,7,5,4],'draw'],[[6,7,7,4],'loss']]) {
    g=fixture();g.wave=24;scores.forEach((n,id)=>g.actors[id].lines=n);g.checkResult();assert.equal(g.result.outcome,outcome);
  }
  g=fixture();g.wave=24;g.actors[0].lines=9;g.actors[0].alive=false;g.checkResult();assert.equal(g.result.outcome,'loss');
});

test('AI evaluates every legal landing, takes a forced clear, never mutates a board, and profiles differ', () => {
  const b=T.emptyBoard();b[9].fill(8);for(let x=3;x<7;x++)b[9][x]=0;
  for(let profile=0;profile<3;profile++) {
    const move=T.chooseAI(b,'I',profile,4,1);assert.equal(move.x,3);assert.equal(move.rotation,0);assert.equal(move.lines,1);
  }
  let differences=0;
  for(let seed=1;seed<=35;seed++) {
    const rand=seeded(seed),board=T.emptyBoard();
    for(let x=0;x<10;x++) {const h=Math.floor(rand()*6);for(let y=10-h;y<10;y++)board[y][x]=1;}
    const before=JSON.stringify(board),choices=[];
    for(let profile=0;profile<3;profile++) {
      const move=T.chooseAI(board,'T',profile,1,0);assert.ok(move);assert.ok(T.place(board,'T',move));choices.push(move.x+':'+move.rotation);
    }
    assert.equal(JSON.stringify(board),before);if(new Set(choices).size>1)differences++;
  }
  assert.ok(differences>10,'different heuristic priorities must visibly change choices');
});

test('60 complete seeded matches finish within 24 beats with legal AI, bounded values and deterministic outcomes', () => {
  const outcomes=new Set();let locks=0,clears=0,turns=0;
  function simulate(seed) {
    const g=new T.Game(seeded(seed));g.start();
    while(g.phase==='running') {
      const move=T.chooseAI(g.actors[0].board,g.piece,seed%3,g.untilTurn(),g.actors[0].pending);
      g.resolve(move);locks+=g.events.filter(e=>e.type==='lock').length;turns+=g.events.filter(e=>e.type==='turn').length;
      assert.ok(g.wave<=24);
      for(const a of g.actors) {
        assert.equal(a.board.length,10);assert.ok(a.board.every(row=>row.length===10&&row.every(v=>Number.isInteger(v)&&v>=0&&v<=8)));
        assert.ok(Number.isInteger(a.pending)&&a.pending>=0);assert.ok(Number.isInteger(a.lines)&&a.lines>=0);
      }
    }
    clears+=g.actors.reduce((n,a)=>n+a.lines,0);outcomes.add(g.result.outcome);
    return JSON.stringify({result:g.result,actors:g.actors});
  }
  for(let seed=1;seed<=60;seed++) {const result=simulate(seed);if(seed<=3)assert.equal(simulate(seed),result);}
  assert.ok(locks>4000);assert.ok(clears>800);assert.ok(turns>800);assert.ok(outcomes.size>=2);
});
