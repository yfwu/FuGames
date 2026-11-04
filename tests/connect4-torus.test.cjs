'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'cyclic_connect4_torus.html'),'utf8');
const script=id=>html.match(new RegExp(`<script id="${id}">([\\s\\S]*?)<\\/script>`))[1];
const E=vm.runInNewContext(script('torus-engine')+';TorusC4;');
const C=vm.runInNewContext(script('torus-career')+';TorusCareer;');
const {P,R}=vm.runInNewContext(script('torus-puzzles')+';({P:TorusPuzzles,R:TorusPresets});');
const playAll=(opts,moves)=>moves.reduce(E.play,E.create(opts));
// engine objects come from another vm realm: compare them as plain JSON
const J=x=>JSON.parse(JSON.stringify(x));
const col=(s,c)=>E.legalMoves(s).find(m=>E.decode(s.opts,m).col===c);

test('full-screen Vermilion Ink shell: local three.js stage, drawers, curtain, no network',()=>{
 assert.match(html,/<link rel="stylesheet" href="shared\/fu\.css">/);assert.match(html,/<body class="fu-app[^"]*">/);
 assert.doesNotMatch(html,/fulab-theme\.css|play-panel|<details class="card rules"|site-nav|page-header/);
 assert.match(html,/<a class="fu-brand" href="index\.html"[^>]*><span class="fu-seal"[^>]*>福遊<\/span>/);
 assert.match(html,/<main class="fu-stage"><canvas id="board"/);
 for(const id of ['rules','settings','career','curtain','inset'])assert.match(html,new RegExp(`id="${id}"`));
 assert.match(html,/from '\.\/shared\/fu-three\.js'/);assert.ok(fs.existsSync(path.join(root,'vendor','three','three.module.min.js')));
 assert.doesNotMatch(html,/https?:\/\/(?!www\.w3\.org)|fetch\(|WebSocket|XMLHttpRequest/);
 for(const [,src] of html.matchAll(/\bsrc="([^"]+)"/g))assert.ok(fs.existsSync(path.join(root,src)),src);
 for(const [,attrs,body] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)){
  const code=/type="module"/.test(attrs)?'(async()=>{'+body.replace(/^\s*import\b[^;]*;/gm,'')+'\n})':body;
  assert.doesNotThrow(()=>new vm.Script(code));
 }
});

test('defaults reproduce the original page: 6×7 torus, connect four, stones fall down, first line wins',()=>{
 const s=E.create();assert.deepEqual(J(s.opts),J(E.DEFAULTS));
 assert.equal(s.board.length,42);assert.ok(s.board.every(v=>v===0));assert.equal(s.toMove,1);
 assert.deepEqual(J(E.legalMoves(s)),[0,1,2,3,4,5,6]);
 const a=E.play(s,3);assert.equal(a.board[5*7+3],1);assert.equal(a.toMove,2);const b=E.play(a,3);assert.equal(b.board[4*7+3],2);
 // the original browser check: bottom row 5,6,0,1 wraps into a win
 const w=playAll({},[5,5,6,6,0,0,1]);assert.equal(w.over,true);assert.equal(w.winner,1);assert.deepEqual(J(w.line),[35,36,40,41]);
 // vertical wrap: rows 4,5 then 0,1 of a column belong to one line on the torus
 const v=E.create();v.board=v.board.slice();for(const r of [0,1,4])v.board[r*7+2]=1;v.board[2*7+2]=2;v.board[3*7+2]=2;v.board[5*7+2]=0;
 const g=E.geometry(v.opts);assert.ok(g.windows.some(w=>[0,1,4,5].every(r=>w.includes(r*7+2))));
 // diagonal across both seams
 assert.ok(g.windows.some(w=>w.includes(5*7+6)&&w.includes(0*7+0)));
 // a full column is illegal; illegal and post-game moves throw
 let f=E.create();for(let i=0;i<6;i++)f=E.play(f,0);assert.ok(!E.legalMoves(f).includes(0));assert.throws(()=>E.play(f,0));assert.throws(()=>E.play(w,2));
});

test('windows are distinct and respect each topology; short cycles never count twice',()=>{
 const count=o=>E.geometry(E.normalize(o)).windows.length;
 assert.equal(count({}),42*4);
 assert.equal(count({wrap:'flat'}),69);// classic connect four has 69 lines
 assert.equal(count({wrap:'cylinder'}),7*3+7*6+2*7*3);// verticals 3 per column, rows wrap 7 per row, diagonals 3 starting rows × 7
 // 4×4 torus with connect 4: each row/column cycle is exactly one window
 const g=E.geometry(E.normalize({rows:4,cols:4,connect:4}));
 assert.equal(g.windows.filter(w=>new Set(w.map(c=>c>>2)).size===1).length,4);
 for(const w of g.windows)assert.equal(new Set(w).size,4);
 assert.ok(g.through.every(t=>t.length>0));
 // flat: no window crosses an edge
 const fl=E.geometry(E.normalize({wrap:'flat'}));assert.ok(!fl.windows.some(w=>w.includes(6)&&w.includes(7)));
 const s=playAll({wrap:'flat'},[5,5,6,6,0,0,1,1]);assert.equal(s.over,false);
});

test('options normalize to safe ranges and connect length is configurable',()=>{
 const o=E.normalize({rows:99,cols:1,connect:42,wrap:'klein',gravity:'sideways',mode:'?',rocks:-3,tideEvery:0});
 assert.equal(o.rows,10);assert.equal(o.cols,4);assert.equal(o.connect,10);assert.equal(o.wrap,'torus');assert.equal(o.gravity,'down');assert.equal(o.mode,'first');assert.equal(o.rocks,0);assert.equal(o.tideEvery,1);
 const three=playAll({connect:3},[0,0,1,1,2]);assert.equal(three.winner,1);
 const five=playAll({rows:8,cols:9,connect:5},[0,0,1,1,2,2,3,3]);assert.equal(five.over,false);assert.equal(E.play(five,4).winner,1);
});

test('tide gravity flips every N plies and slides every stone to the other end of its column',()=>{
 const o={gravity:'tide',tideEvery:2};let s=E.create(o);
 assert.equal(E.tideDir(s.opts,0),0);assert.equal(E.tideDir(s.opts,2),1);assert.equal(E.tideDir(s.opts,4),0);
 assert.ok(!E.flipsAfter(s.opts,0));assert.ok(E.flipsAfter(s.opts,1));
 s=E.play(s,col(s,0));assert.equal(s.board[35],1);
 s=E.play(s,col(s,0));
 // after ply 2 the tide turns: column 0 (P2 on P1) slides up, order kept
 assert.equal(s.board[0],2);assert.equal(s.board[7],1);assert.equal(s.board[35],0);assert.equal(s.last,0);
 assert.deepEqual(J(s.moved).sort((a,b)=>a[0]-b[0]),[[28,0],[35,7]]);
 const up=col(s,0);assert.equal(E.decode(s.opts,up).dir,1);
 s=E.play(s,up);assert.equal(s.board[14],1,'pushed up from the bottom it rises to the stack');
 // rocks hold still and split a column into segments
 const g=E.normalize({gravity:'tide'}),b=Array(42).fill(0);b[0]=1;b[3*7]=E.ROCK;b[4*7]=2;
 E.settle(g,b,0);assert.equal(b[2*7],1);assert.equal(b[3*7],E.ROCK);assert.equal(b[5*7],2);
 E.settle(g,b,1);assert.equal(b[0],1);assert.equal(b[4*7],2);
 // a slide can complete a line, even for the player who did not move
 let t=E.create({gravity:'tide',tideEvery:4});t={...t,board:t.board.slice(),ply:3,toMove:2};
 for(const c of [0,1,2])t.board[35+c]=1;t.board[3]=1;
 const r=E.play(t,6);assert.equal(r.over,true);assert.equal(r.winner,1);assert.deepEqual(J(r.tideWins),[1]);assert.deepEqual(J(r.line),[0,1,2,3]);
 // the solver counts tide lines: from the same spot P1 to move wins with any quiet move
 assert.ok(E.forcedWin({...t,toMove:1},1)>=0);
});

test('dual gravity offers both ends; landing physics stop at the first obstacle',()=>{
 const s=E.create({gravity:'dual'});assert.equal(E.legalMoves(s).length,14);
 const a=E.play(s,E.encode(s.opts,2,1));assert.equal(a.board[2],1,'pushed up an empty column it rises to the top');
 assert.ok(!E.legalMoves(a).includes(E.encode(a.opts,2,0)),'the top entry is now closed');
 const b=E.play(a,E.encode(a.opts,2,1));assert.equal(b.board[7+2],2,'rises until it meets the stone above');
 const c=E.play(b,E.encode(b.opts,3,0));assert.equal(c.board[5*7+3],1);
 assert.equal(E.landing(c.opts,c.board,3,1),-1);assert.equal(E.landing(c.opts,c.board,3,0),4*7+3);
 // a column with a rock blocks a falling stone above the rock
 const o=E.normalize({});const board=Array(42).fill(0);board[3*7+1]=E.ROCK;
 assert.equal(E.landing(o,board,1,0),2*7+1);assert.equal(E.landing(o,board,1,1),4*7+1);
});

test('rocks are seeded, never on the entry rows, block lines and are deterministic',()=>{
 const a=E.create({rocks:5,seed:9}),b=E.create({rocks:5,seed:9}),c=E.create({rocks:5,seed:10});
 assert.deepEqual(a.board,b.board);assert.notDeepEqual(a.board,c.board);
 const cells=a.board.map((v,i)=>v===E.ROCK?i:-1).filter(i=>i>=0);assert.equal(cells.length,5);
 assert.ok(cells.every(i=>(i/7|0)>0&&(i/7|0)<5));
 assert.deepEqual(J(E.replay(a.opts,[0,1,2]).board),J(E.play(E.play(E.play(a,0),1),2).board));
 // a rock in a window kills it
 const g=E.geometry(a.opts);const alive=g.windows.filter(w=>!w.some(c=>a.board[c]===E.ROCK)).length;assert.ok(alive<g.windows.length);
});

test('tally mode plays to the end, scores every new window and decides by points',()=>{
 const o={mode:'tally',rows:4,cols:4,connect:3};
 let s=playAll(o,[0,0,1,1,2]);assert.equal(s.over,false);assert.equal(s.scores[1],1);assert.deepEqual(J(s.line),[12,13,14]);
 s=E.play(s,2);assert.equal(s.scores[2],1);
 s=E.play(s,3);assert.equal(s.scores[1],4,'closing the 4-wide bottom ring completes three more windows of three');
 while(!s.over)s=E.play(s,E.legalMoves(s)[0]);
 assert.equal(s.board.filter(v=>v===0).length,0);
 assert.equal(s.winner,s.scores[1]>s.scores[2]?1:s.scores[2]>s.scores[1]?2:0);
});

test('undo and replay are exact; history drives both',()=>{
 const s=playAll({gravity:'dual'},[1,10,2,11,5]);assert.equal(s.history.length,5);
 const u=E.undo(s,2);assert.deepEqual(J(u.board),J(playAll({gravity:'dual'},[1,10,2]).board));assert.equal(u.toMove,2);assert.equal(E.undo(s,99).ply,0);
});

test('AI takes immediate wins, blocks immediate losses and is deterministic for a seed',()=>{
 const win=playAll({},[0,0,1,1,2,2]);for(const tier of [1,2,3])assert.equal(E.choose(win,{tier,rng:E.seeded(1)}),3);
 // seam win: P1 holds 5,6,0 in the bottom row; the winning drop is column 1 (wraps) — or 4
 const seam=playAll({},[5,5,6,6,0,0]);const m=E.choose(seam,{tier:2,rng:E.seeded(2)});assert.ok([1,4].includes(m));
 const block=playAll({},[0,6,1,6,2]);for(const tier of [1,2,3])assert.equal(E.choose(block,{tier,rng:E.seeded(3)}),3);
 const a=E.analyse(E.create(),{tier:2,rng:E.seeded(5)}),b=E.analyse(E.create(),{tier:2,rng:E.seeded(5)});assert.deepEqual(J(a),J(b));
 assert.ok(a.nodes<=E.TIERS[2].nodes+1);assert.ok(a.depth>=3);
 assert.equal(E.TIERS.length,5);assert.ok(E.TIERS.every((t,i)=>i===0||t.nodes>E.TIERS[i-1].nodes));
});

test('stronger tiers beat weaker ones over a short match series',()=>{
 const series=(strong,weak,n)=>{let w=0,l=0;for(let i=0;i<n;i++){const rng=E.seeded(40+i);let g=E.create();g=E.play(g,E.legalMoves(g)[i%7]);const first=i%2?strong:weak;while(!g.over)g=E.play(g,E.choose(g,{tier:g.toMove===1?(i%2?weak:strong):(i%2?strong:weak),rng}));void first;
  const strongSide=i%2?2:1;if(g.winner===strongSide)w++;else if(g.winner)l++;}return{w,l};};
 const r=series(2,0,6);assert.ok(r.w>r.l,`高手 vs 見習 ${r.w}-${r.l}`);
});

test('AI works on every variant and only returns legal moves',()=>{
 for(const p of R){let s=E.create({...p.rules,seed:3});const rng=E.seeded(11);
  for(let i=0;i<10&&!s.over;i++){const m=E.choose(s,{tier:1,rng});assert.ok(E.legalMoves(s).includes(m),p.id);s=E.play(s,m);}}
 assert.equal(E.choose(playAll({},[5,5,6,6,0,0,1]),{tier:1}),-1);
});

test('threat scan lists cells that complete a window for a side',()=>{
 const s=playAll({},[5,5,6,6,0,0]);const t=E.threats(s,1);assert.ok(t.includes(35+1)&&t.includes(35+4));
 assert.deepEqual(J(E.threats(E.create(),1)),[]);
});

test('every puzzle is legal, unfinished, solvable within k and not sooner',()=>{
 assert.equal(P.length,12);assert.equal(new Set(P.map(p=>p.id)).size,12);
 for(const p of P){
  const s=E.replay(p.rules,p.moves);assert.equal(s.over,false,p.id);
  assert.ok(E.forcedWin(s,p.k)>=0,p.id+' solvable');
  if(p.k>1)assert.equal(E.forcedWin(s,p.k-1),-1,p.id+' not shorter');
  assert.ok(C.unlockLevel('chapter',p.chapter)<Infinity);
 }
 for(const ch of [1,2,3])assert.equal(P.filter(p=>p.chapter===ch).length,4);
});

test('presets map to rules the career can unlock, and default rules need nothing',()=>{
 assert.deepEqual(J(C.ruleNeeds({})),[]);assert.ok(C.rulesAllowed(1,{}));assert.ok(C.rulesAllowed(1,{wrap:'flat'}));
 assert.ok(!C.rulesAllowed(1,{gravity:'dual'}));assert.ok(C.rulesAllowed(5,{gravity:'dual'}));
 for(const p of R)assert.ok(C.ruleNeeds(p.rules).every(id=>C.unlockLevel('rule',id)<=C.MAX_LEVEL),p.id);
 assert.deepEqual(J(C.ruleNeeds({rows:8,cols:9,connect:5,mode:'tally',rocks:3,wrap:'cylinder',gravity:'tide'})),['cylinder','tide','size','tally','rocks']);
});

test('career levels, ranks and unlock thresholds',()=>{
 assert.deepEqual(J(C.levelOf(0)),{level:1,into:0,need:135,max:false});
 assert.equal(C.levelOf(134).level,1);assert.equal(C.levelOf(135).level,2);assert.equal(C.levelOf(135+170).level,3);
 let total=0;for(let l=1;l<C.MAX_LEVEL;l++)total+=C.need(l);assert.equal(C.levelOf(total).level,C.MAX_LEVEL);assert.equal(C.levelOf(total*3).max,true);
 assert.equal(C.levelOf(-5).level,1);assert.equal(C.levelOf('junk').level,1);
 assert.equal(C.rankOf(1),'入局');assert.equal(C.rankOf(8),'環面棋士');assert.equal(C.rankOf(30),'環宇宗師');
 assert.ok(C.unlocked(1,'tier',2));assert.ok(!C.unlocked(3,'tier',3));assert.ok(C.unlocked(4,'tier',3));assert.ok(!C.unlocked(9,'tier',4));assert.ok(C.unlocked(10,'tier',4));
 assert.ok(C.UNLOCKS.every((u,i)=>i===0||u.level>=C.UNLOCKS[i-1].level));
});

test('match XP scales by tier and variant; assisted wins lose the clean bonus; local games pay a flat amount',()=>{
 const base={outcome:'win',tier:2,rules:{},myMoves:12,assisted:false};
 const w=C.matchXP(base);assert.equal(w.total,20+70+20);assert.equal(w.mult,1);
 assert.equal(C.matchXP({...base,assisted:true}).total,90);
 assert.equal(C.matchXP({...base,myMoves:6}).total,135);
 assert.equal(C.matchXP({...base,wrapWin:true}).total,125);
 assert.equal(C.matchXP({...base,tier:4}).total,Math.round(110*1.75));
 assert.equal(C.matchXP({...base,rules:{gravity:'dual',rocks:3}}).mult,1.16);
 assert.equal(C.matchXP({outcome:'loss',tier:0,rules:{}}).total,10);
 assert.equal(C.matchXP({outcome:'draw',tier:2,rules:{}}).total,50);
 assert.equal(C.matchXP({outcome:'loss',tier:2,rules:{mode:'tally'},mode:'tally',points:3}).total,Math.round(44*1.08));
 assert.equal(C.matchXP({local:true}).total,12);
});

test('recording a match updates stats, streaks and reports level-ups with their unlocks',()=>{
 let p=C.blank();
 let r=C.record(p,{outcome:'win',tier:2,rules:{},myMoves:12});assert.equal(r.profile.wins,1);assert.equal(r.profile.streak,1);assert.equal(r.profile.bestTier,2);assert.equal(r.after.level,1);
 r=C.record({...r.profile,xp:130},{outcome:'win',tier:1,rules:{},myMoves:12});assert.equal(r.before.level,1);assert.equal(r.after.level,2);assert.deepEqual(J(r.unlocked.map(u=>u.id)),['cylinder']);assert.equal(r.profile.streak,2);assert.equal(r.profile.bestStreak,2);assert.equal(r.profile.bestTier,2);
 r=C.record(r.profile,{outcome:'loss',tier:2,rules:{}});assert.equal(r.profile.streak,0);assert.equal(r.profile.losses,1);assert.equal(r.profile.bestStreak,2);
 r=C.record(r.profile,{outcome:'draw',tier:2,rules:{}});assert.equal(r.profile.draws,1);assert.equal(r.profile.matches,4);
 r=C.record(r.profile,{local:true});assert.equal(r.profile.matches,5);assert.equal(r.profile.wins,2);
});

test('puzzles pay once; profiles sanitize and round-trip through storage',()=>{
 const pz=P.find(p=>p.k===3&&p.chapter===2);assert.equal(C.puzzleXP(pz),40+50+10);
 let r=C.solve(C.blank(),pz);assert.equal(r.gain.total,100);assert.deepEqual(J(r.profile.solved),[pz.id]);
 r=C.solve(r.profile,pz);assert.equal(r.gain.total,0);assert.equal(r.profile.xp,100);
 const mem={};const st={getItem:k=>mem[k]??null,setItem:(k,v)=>{mem[k]=v;}};
 assert.ok(C.save(st,{...r.profile,wins:3.7,xp:-4,solved:['a','a',7,'b']}));
 assert.deepEqual(J(C.load(st)),{...J(C.blank()),wins:3,solved:['a','b']});
 assert.deepEqual(J(C.load({getItem:()=>'{bad json'})),J(C.blank()));
 assert.equal(C.save({setItem:()=>{throw new Error('full');}},C.blank()),false);
});
