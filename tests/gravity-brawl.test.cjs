'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'gravity_brawl.html'), 'utf8');
const T = vm.runInNewContext(html.match(/<script id="brawl-engine">([\s\S]*?)<\/script>/)[1] + '; GravityBrawl;');
const Career = vm.runInNewContext(html.match(/<script id="brawl-career">([\s\S]*?)<\/script>/)[1] + '; GravityCareer;');
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

// ---------- Full-screen shell ----------
test('page is a full-screen Vermilion Ink three.js table with local assets and compilable scripts', () => {
  assert.match(html, /<link rel="stylesheet" href="shared\/fu\.css">/);
  assert.match(html, /<body class="fu-app[^"]*">/);
  assert.doesNotMatch(html, /fulab-theme\.css|play-panel|details class="card rules"|site-nav|page-header/);
  assert.match(html, /class="fu-seal"[^>]*>福遊<\/span>/);assert.match(html, /<a class="fu-brand" href="index\.html"/);
  for (const id of ['board','curtain','menu','hud-beat','hud-self','dock','play','drop','left','right','rotate','pause','restart','panel-rules','panel-options','panel-career','panel-view']) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /<main class="fu-stage"/);assert.match(html, /aside class="fu-drawer" id="menu"/);
  assert.match(html, /import \{ THREE, createStage, palette \} from '\.\/shared\/fu-three\.js'/);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'vendor', 'three', 'three.module.min.js')));
  assert.doesNotMatch(html, /fetch\(|WebSocket|https?:\/\/|XMLHttpRequest/);
  for (const [, attrs, s] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    const body = /type="module"/.test(attrs) ? '(async () => {' + s.replace(/^\s*import\b[^;]*;/gm, '') + '\n})' : s;
    assert.doesNotThrow(() => new vm.Script(body));
  }
  // Player is seal; rivals follow FuPalette side order.
  assert.match(html, /SIDES=\['#ff4b2b','#4fa3ff','#35d0a8','#e9b949'\]/);
});

// ---------- Options ----------
const play = (g, opts={}) => { g.start(); while(g.phase==='running') g.resolve(T.chooseAI(g.actors[0].board,g.piece,0,g.untilTurn(),g.actors[0].pending,{tier:opts.tier??1,next:g.nextPiece,dir:g.nextTurn})); return g; };
const gapRow = g => { g.piece='I';g.nextPiece='O';const b=g.actors[0].board;b[9].fill(8);for(let x=3;x<7;x++)b[9][x]=0;g.selection=T.landing(b,'I',0,3);return g; };

test('options default to the original rules and sanitize unknown values', () => {
  assert.deepEqual(native(T.normalizeOptions()), native(T.DEFAULTS));
  assert.deepEqual(native(T.normalizeOptions({tier:9,stage:'moon',targeting:'x',attack:7,rebound:'yes',tempo:'turbo'})), native(T.DEFAULTS));
  assert.deepEqual(native(T.DEFAULTS), {tier:1,stage:'classic',targeting:'ring',attack:'linear',rebound:false,tempo:'standard'});
  for (let seed=1; seed<=6; seed++) {
    const a=play(new T.Game(seeded(seed))), b=play(new T.Game(seeded(seed),{...T.DEFAULTS}));
    assert.equal(JSON.stringify(a.actors), JSON.stringify(b.actors));
  }
  const g=new T.Game(seeded(1),{tempo:'blitz'});assert.equal(g.remaining,5);g.start();g.tick(5);assert.equal(g.wave,2);assert.equal(g.remaining,5);
  assert.equal(new T.Game(seeded(1),{tempo:'calm'}).seconds,10);
});

test('counter-clockwise reframing preserves world positions and settles toward the new floor', () => {
  for (let seed=1; seed<=30; seed++) {
    const rand=seeded(seed), b=T.emptyBoard();
    for(let y=0;y<10;y++)for(let x=0;x<10;x++)if(rand()<.35)b[y][x]=1+Math.floor(rand()*8);
    for (const dir of [1,-1]) for (let g=0; g<4; g++) {
      const r=T.reframe(b,dir), g2=(g+dir+4)%4;
      for(let y=0;y<10;y++)for(let x=0;x<10;x++)if(b[y][x]){const [wx,wy]=T.world(x,y,g),[nx,ny]=T.canonical(wx,wy,g2);assert.equal(r[ny][nx],b[y][x]);}
      const turned=T.rotateBoard(b,dir);assert.equal(occupied(turned.board)+turned.lines*10,occupied(b));assert.equal(T.features(turned.board).holes,0);
    }
  }
});

test('stages: rapid turns every 2 beats, chaos announces a random direction, classic never consumes randomness for turns', () => {
  const r=new T.Game(seeded(3),{stage:'rapid'});r.start();assert.equal(r.untilTurn(),2);r.resolve();assert.equal(r.untilTurn(),1);r.resolve();assert.equal(r.gravity,1);assert.equal(r.untilTurn(),2);
  const dirs=new Set();
  for (let seed=1; seed<=12; seed++) {
    const g=new T.Game(seeded(seed*7919),{stage:'chaos'});g.start();
    for(let i=0;i<12&&g.phase==='running';i++){ const announced=g.nextGravity(), dir=g.nextTurn, turning=g.untilTurn()===1; g.resolve(); if(turning&&g.phase==='running'){assert.equal(g.gravity,announced);dirs.add(dir);assert.equal(g.events.find(e=>e.type==='turn').dir,dir);} }
  }
  assert.deepEqual([...dirs].sort(),[-1,1]);
  const c=new T.Game(seeded(5));assert.equal(c.nextTurn,1);assert.equal(c.nextGravity(),1);
});

test('combo attack table, streak bonus and cancellation of the boosted attack', () => {
  assert.deepEqual([0,1,2,3,4].map(n=>T.attackPower(n,1,'linear')), [0,1,2,3,4]);
  assert.deepEqual([0,1,2,3,4].map(n=>T.attackPower(n,1,'combo')), [0,1,2,4,6]);
  assert.equal(T.attackPower(2,2,'combo'),3);assert.equal(T.attackPower(0,5,'combo'),0);
  const g=gapRow(new T.Game(seeded(7),{attack:'combo'}));g.start();g.actors[0].streak=1;g.actors[0].pending=1;
  g.resolve();const lock=g.events.find(e=>e.type==='lock'&&e.id===0);
  assert.equal(lock.lines,1);assert.equal(lock.power,2,'1 line on a 2-beat streak sends 1+1');assert.equal(lock.cancelled,1);
  assert.equal(g.actors[1].pending,1);assert.equal(g.actors[0].sent,1);
  const lin=gapRow(new T.Game(seeded(7)));lin.start();lin.actors[0].streak=1;lin.resolve();assert.equal(lin.actors[1].pending,1,'linear ignores streaks');
});

test('focus targeting routes to the chosen rival, falls back to the ring, and AI personalities pick targets', () => {
  let g=new T.Game(seeded(7));g.start();assert.equal(g.setTarget(2),false,'ring mode ignores targeting');
  g=gapRow(new T.Game(seeded(7),{targeting:'focus'}));g.start();
  assert.equal(g.setTarget(0),false);assert.equal(g.setTarget(3),true);assert.equal(g.actors[0].target,3);
  g.resolve();assert.ok(g.events.some(e=>e.type==='attack'&&e.from===0&&e.to===3&&e.lines===1));assert.equal(g.actors[3].lastAttacker,0);
  g.actors[3].alive=false;assert.equal(g.routeTarget(0).id,1,'dead target falls back to the ring');
  assert.equal(g.setTarget(3),false);assert.equal(g.cycleTarget(),true);assert.notEqual(g.actors[0].target,3);
  // Personalities: 守平 retaliates, 壓迫 hunts the tallest stack, 轉潮 chases the leader.
  g=new T.Game(seeded(9),{targeting:'focus'});g.start();
  g.actors[1].lastAttacker=3;assert.equal(g.chooseTarget(g.actors[1]),3);
  for(let y=3;y<10;y++)g.actors[1].board[y][0]=8;assert.equal(g.chooseTarget(g.actors[2]),1);
  g.actors[2].lines=6;assert.equal(g.chooseTarget(g.actors[3]),2);
  const easy=new T.Game(seeded(9),{targeting:'focus',tier:0});easy.start();easy.actors[2].lines=6;assert.equal(easy.chooseTarget(easy.actors[3]),0,'novice AI just uses the ring');
});

test('rebound spends three charge to bounce pending garbage to the target, and charge comes from clears only when enabled', () => {
  let g=new T.Game(seeded(7));g.start();g.actors[0].charge=4;assert.equal(g.armRebound(true),false,'disabled by default');
  g=new T.Game(seeded(7),{rebound:true});g.start();
  assert.equal(g.armRebound(true),false,'needs charge');
  g.actors[0].charge=3;g.actors[0].pending=2;assert.equal(g.armRebound(true),true);
  g.selection=T.legalPlacements(g.actors[0].board,g.piece)[0];const before=occupied(g.actors[0].board);
  g.resolve();
  assert.equal(g.actors[0].charge,0);assert.equal(g.actors[0].armed,false);assert.equal(occupied(g.actors[0].board),before+4,'no garbage entered');
  assert.ok(g.events.some(e=>e.type==='rebound'&&e.id===0&&e.lines===2));
  assert.ok(g.events.some(e=>e.type==='attack'&&e.from===0&&e.to===1&&e.lines===2&&e.bounced===2));
  // An armed rebound with nothing incoming stays armed and keeps its charge.
  g=new T.Game(seeded(8),{rebound:true});g.start();g.actors[0].charge=3;g.armRebound(true);g.resolve();assert.equal(g.actors[0].armed,true);assert.equal(g.actors[0].charge,3);
  // Clearing charges the meter up to the cap; disabled rebound never charges.
  g=gapRow(new T.Game(seeded(7),{rebound:true}));g.start();g.resolve();assert.equal(g.actors[0].charge,1);
  g=gapRow(new T.Game(seeded(7),{rebound:true}));g.start();g.actors[0].charge=T.MAX_CHARGE;g.resolve();assert.equal(g.actors[0].charge,T.MAX_CHARGE);
  g=gapRow(new T.Game(seeded(7)));g.start();g.resolve();assert.equal(g.actors[0].charge,0);
});

test('bounty crowns the unique leader, adds one line to attacks on the crown, and credits knockouts', () => {
  let g=new T.Game(seeded(7));g.start();g.actors[2].lines=5;assert.equal(g.crown(),null,'no crown outside bounty');
  g=new T.Game(seeded(7),{stage:'bounty'});g.start();assert.equal(g.crown(),null);
  g.actors[1].lines=3;g.actors[2].lines=3;assert.equal(g.crown(),null,'ties share no crown');
  g.actors[1].lines=4;assert.equal(g.crown(),1);
  gapRow(g);g.resolve();const hit=g.events.find(e=>e.type==='attack'&&e.from===0);assert.equal(hit.to,1);assert.equal(hit.crown,true);assert.equal(hit.lines,2);
  // Knockout credit: overflow eliminates the victim and pays the last attacker.
  g=new T.Game(seeded(7),{stage:'bounty'});g.start();const v=g.actors[2];v.pending=11;v.lastAttacker=0;
  g.resolve();assert.equal(v.alive,false);assert.equal(g.actors[0].kos,1);assert.ok(g.actors[0].lines>=T.KO_BONUS);assert.ok(g.events.some(e=>e.type==='ko'&&e.by===0&&e.id===2));
  g=new T.Game(seeded(7));g.start();g.actors[2].pending=11;g.actors[2].lastAttacker=0;g.resolve();assert.equal(g.actors[0].kos,1);assert.ok(g.actors[0].lines<T.KO_BONUS,'classic credits KOs without bonus lines');
});

test('AI tiers: every tier plays legally without mutation; novice is noisy, higher tiers read ahead and respect pending garbage', () => {
  const rand=seeded(4),board=T.emptyBoard();for(let x=0;x<10;x++){const h=Math.floor(rand()*5);for(let y=10-h;y<10;y++)board[y][x]=1;}
  const before=JSON.stringify(board);
  for(let tier=0;tier<4;tier++)for(let profile=0;profile<3;profile++){const m=T.chooseAI(board,'L',profile,2,2,{tier,next:'I',rand:seeded(tier+1)});assert.ok(m&&T.place(board,'L',m));}
  assert.equal(JSON.stringify(board),before);
  assert.deepEqual(native(T.chooseAI(board,'T',1,3,1,{tier:1})),native(T.chooseAI(board,'T',1,3,1)),'tier 1 is the original AI');
  const picks=new Set();for(let s=1;s<=20;s++){const m=T.chooseAI(board,'T',0,4,0,{tier:0,rand:seeded(s)});picks.add(m.x+':'+m.rotation);}assert.ok(picks.size>2,'novice varies');
  let diff=0;for(let s=1;s<=30;s++){const r=seeded(s),b=T.emptyBoard();for(let x=0;x<10;x++){const h=Math.floor(r()*6);for(let y=10-h;y<10;y++)b[y][x]=1;}
    for(const piece of ['S','Z','L'])for(let profile=0;profile<3;profile++){const a=T.chooseAI(b,piece,profile,4,0,{tier:1}),c=T.chooseAI(b,piece,profile,4,0,{tier:2,next:'I'});if(a.x!==c.x||a.rotation!==c.rotation)diff++;}}
  assert.ok(diff>=3,'lookahead changes some choices');
  // Tier 3 never picks a landing that the pending garbage would push out when a safe one exists.
  for(let s=1;s<=20;s++){const r=seeded(s),b=T.emptyBoard();for(let x=0;x<10;x++){const h=3+Math.floor(r()*4);for(let y=10-h;y<10;y++)b[y][x]=r()<.85?1:0;}
    const pending=3,safe=T.legalPlacements(b,'O').some(p=>{const q=T.place(b,'O',p);return !T.addGarbage(q.board,Array(Math.max(0,pending-q.lines)).fill(0)).overflow;});
    const m=T.chooseAI(b,'O',1,4,pending,{tier:3,next:'I'}),q=T.place(b,'O',m);
    if(safe)assert.equal(T.addGarbage(q.board,Array(Math.max(0,pending-q.lines)).fill(0)).overflow,false);}
});

test('every option combination completes seeded matches with bounded state', () => {
  const combos=[{tier:0},{tier:2,stage:'rapid'},{tier:3,stage:'chaos',attack:'combo'},{stage:'bounty',targeting:'focus',rebound:true},{targeting:'focus',attack:'combo',rebound:true,tempo:'blitz'}];
  for(const opts of combos)for(let seed=1;seed<=3;seed++){
    const g=play(new T.Game(seeded(seed),opts),opts);assert.equal(g.phase,'over');assert.ok(g.wave<=24);
    for(const a of g.actors){assert.ok(a.board.every(r=>r.every(v=>Number.isInteger(v)&&v>=0&&v<=8)));assert.ok(a.charge>=0&&a.charge<=T.MAX_CHARGE);assert.ok(a.pending>=0);}
    const snap=g.snapshot();assert.equal(snap.actors.length,4);assert.deepEqual(native(snap.options),native(g.options));
  }
});

// ---------- Career ----------
test('career XP scales with performance, tier and modifiers; levels unlock options; bad saves are sanitized', () => {
  assert.deepEqual(native(Career.levelOf(0)),{level:1,into:0,need:140,max:false});assert.equal(Career.levelOf(140).level,2);assert.equal(Career.levelOf(1e9).level,Career.MAX_LEVEL);
  const base={outcome:'loss',lines:0,sent:0,cancelled:0,kos:0,survived:0,tier:1,options:{...T.DEFAULTS}};
  assert.equal(Career.matchXP(base).total,30);
  const win={...base,outcome:'win',lines:10,sent:6,cancelled:2,kos:1,survived:24};
  const w=Career.matchXP(win);assert.equal(w.base,30+30+24+4+25+24+120);assert.equal(w.total,w.base);
  assert.ok(Career.matchXP({...win,tier:3}).total>w.total);assert.ok(Career.matchXP({...win,tier:0}).total<w.total);
  assert.equal(Career.matchXP({...win,options:{...T.DEFAULTS,stage:'bounty',targeting:'focus'}}).mult,1.2);
  assert.deepEqual(native(Career.modifiers({stage:'rapid',targeting:'focus',attack:'combo',rebound:true,tempo:'blitz'})),['stage','focus','combo','rebound','blitz']);
  const r=Career.record(Career.blank(),win);assert.equal(r.profile.matches,1);assert.equal(r.profile.wins,1);assert.equal(r.profile.bestTier,1);assert.equal(r.profile.kos,1);assert.ok(r.after.level>1);assert.ok(r.unlocked.length>0);
  assert.equal(Career.rankOf(1),'見習');assert.equal(Career.rankOf(30),'天傾');
  for(const u of Career.UNLOCKS){if(u.kind==='tier')assert.ok(T.TIERS[u.id]);if(u.kind==='stage')assert.ok(T.STAGES[u.id]);if(u.kind==='tempo')assert.ok(u.id in T.TEMPOS);}
  for(const id of T.STAGE_IDS)assert.ok(Number.isFinite(Career.unlockLevel('stage',id)));
  assert.equal(Career.unlocked(1,'tier',3),false);assert.equal(Career.unlocked(10,'tier',3),true);assert.equal(Career.unlocked(1,'rebound',false),true);
  assert.deepEqual(native(Career.clampSetup(1,{tier:3,stage:'chaos',targeting:'focus',attack:'combo',rebound:true,tempo:'blitz'})),native(T.DEFAULTS));
  assert.deepEqual(native(Career.clampSetup(30,{tier:3,stage:'chaos',targeting:'focus',attack:'combo',rebound:true,tempo:'blitz'})),{tier:3,stage:'chaos',targeting:'focus',attack:'combo',rebound:true,tempo:'blitz'});
  assert.deepEqual(native(Career.sanitize({xp:-5,wins:'x',kos:3.7})),{...native(Career.blank()),kos:3});
  const mem=new Map(),storage={getItem:k=>mem.get(k)??null,setItem:(k,v)=>mem.set(k,v)};assert.ok(Career.save(storage,r.profile));assert.equal(Career.load(storage).xp,r.profile.xp);mem.set(Career.KEY,'{broken');assert.equal(Career.load(storage).xp,0);
});
