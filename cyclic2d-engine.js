'use strict';
// 三子循環棋（平面版）rules core: a small square board, three stones per side, FIFO moves.
// Shared by cyclic_tictactoe.html, its AI worker and the Node rule tests.
// Every option defaults to the original page: 3×3, three stones, always lift the oldest,
// no draw rule (the old page played on until someone made a line).
(function(root,factory){const engine=factory();if(typeof module==='object'&&module.exports)module.exports=engine;else root.CyclicFlat=engine;})(typeof globalThis==='object'?globalThis:this,()=>{
  const X=1,O=2,BLOCK=3;
  const other=p=>3-p;
  const ROWS='ABCD',ROW_NAMES=['A','B','C','D'];

  // All straight lines of K cells on an n×n board (rows, columns, both diagonals; no wrapping).
  const lineCache=new Map();
  function linesFor(n,K=3) {
    const id=n+'/'+K;if(lineCache.has(id))return lineCache.get(id);
    const dirs=[[0,1],[1,0],[1,1],[1,-1]],seen=new Set(),lines=[];
    for(let r=0;r<n;r++)for(let c=0;c<n;c++)for(const[dr,dc]of dirs){
      const cells=[];
      for(let k=0;k<K;k++){
        const R=r+dr*k,C=c+dc*k;
        if(R<0||R>=n||C<0||C>=n)break;
        cells.push(R*n+C);
      }
      if(cells.length!==K||new Set(cells).size!==K)continue;
      const key=cells.slice().sort((a,b)=>a-b).join();
      if(seen.has(key))continue;seen.add(key);lines.push(cells);
    }
    const byCell=Array.from({length:n*n},()=>[]);
    lines.forEach((line,i)=>{for(const c of line)byCell[c].push(i);});
    const out={lines,byCell};lineCache.set(id,out);return out;
  }

  const normalizeOptions=(o={})=>{
    const size=o.size===4?4:3;
    const blocked=[...new Set((Array.isArray(o.blocked)?o.blocked:[]).filter(c=>Number.isInteger(c)&&c>=0&&c<size*size))].sort((a,b)=>a-b);
    const int=(v,max)=>Number.isInteger(v)&&v>0?Math.min(v,max):0;
    return{size,stones:size,connect:size,choice:o.choice===2?2:1,blocked,repeatLimit:int(o.repeatLimit,9),plyLimit:int(o.plyLimit,999)};
  };
  // Named variants. 'standard' is the original game; one variant at a time.
  const VARIANTS={
    standard:{name:'標準',desc:'原始規則：3×3，每人三顆棋，放滿後移動最早的一顆。'},
    choice:{name:'擇二',desc:'放滿後，可以從最早的兩顆裡挑一顆移動；多一個選擇，也多一個要算的分支。'},
    hollow:{name:'空心',desc:'中心格封死：穿過中心的四條線失效，只剩四條邊線；理論上是和棋，但陷阱很多。'},
    wide:{name:'廣盤',desc:'4×4 棋盤，每人四顆、連成四子才贏（10 條線）；放滿四顆後同樣移動最早的一顆，佈局與追逐更長。'}
  };
  const VARIANT_IDS=Object.keys(VARIANTS);
  function variantOptions(id) {
    if(id==='hollow')return{blocked:[4]};
    if(id==='choice')return{choice:2};
    if(id==='wide')return{size:4};
    return{};
  }
  // Optional draw rule, offered by the page as a match setting (off = the original endless game).
  const DRAW_RULE={repeatLimit:3,plyLimit:60};

  const label=(cell,n=3)=>ROW_NAMES[Math.floor(cell/n)]+((cell%n)+1);

  class Game {
    constructor(options={}) {
      const o=normalizeOptions(options);
      Object.assign(this,o);
      this.cells=o.size*o.size;
      const L=linesFor(o.size,o.connect);this.lines=L.lines;this.byCell=L.byCell;
      this.board=new Array(this.cells).fill(0);
      for(const c of this.blocked)this.board[c]=BLOCK;
      this.liveCount=this.byCell.map(ids=>ids.filter(id=>!this.lines[id].some(c=>this.blocked.includes(c))).length);
      this.queues={[X]:[],[O]:[]};
      this.turn=X;this.ply=0;
      this.winner=0;this.winLine=null;this.draw=null;
      this.seen=new Map([[this.key(),1]]);this.moves=[];
    }
    options() {return{size:this.size,choice:this.choice,blocked:this.blocked.slice(),repeatLimit:this.repeatLimit,plyLimit:this.plyLimit};}
    clone() {
      const g=Object.create(Game.prototype);
      Object.assign(g,this,{blocked:this.blocked.slice(),board:this.board.slice(),queues:{[X]:this.queues[X].slice(),[O]:this.queues[O].slice()},seen:new Map(this.seen),moves:this.moves.slice(),winLine:this.winLine&&this.winLine.slice()});
      return g;
    }
    // A full position: ordered queues (FIFO order changes the future) and side to move.
    key() {return this.queues[X].join('.')+'|'+this.queues[O].join('.')+'|'+this.turn;}
    toJSON() {return Object.assign(this.options(),{board:this.board.slice(),queues:{[X]:this.queues[X].slice(),[O]:this.queues[O].slice()},turn:this.turn,ply:this.ply,winner:this.winner,winLine:this.winLine,draw:this.draw,seen:[...this.seen],moves:this.moves.slice()});}
    static from(d) {
      const g=new Game(d);
      Object.assign(g,{board:d.board.slice(),queues:{[X]:d.queues[X].slice(),[O]:d.queues[O].slice()},turn:d.turn,ply:d.ply,winner:d.winner||0,winLine:d.winLine||null,draw:d.draw||null,seen:new Map(d.seen),moves:(d.moves||[]).slice()});
      return g;
    }
    get over() {return Boolean(this.winner||this.draw);}
    repetitions() {return this.seen.get(this.key())||0;}
    full(player=this.turn) {return this.queues[player].length>=this.stones;}
    // Stones `player` may lift on their next move: none while placing, else the oldest (or two oldest).
    liftable(player=this.turn) {return this.full(player)?this.queues[player].slice(0,this.choice):[];}
    // The stone the default move lifts (the oldest), or -1 while still placing.
    leaving(player=this.turn) {return this.full(player)?this.queues[player][0]:-1;}
    // Legal moves {from,to}; from=-1 while placing. A lifted stone cannot return to its own cell.
    legalMoves() {
      if(this.over)return[];
      const out=[],lifts=this.liftable();
      for(const from of lifts.length?lifts:[-1])for(let to=0;to<this.cells;to++)if(this.board[to]===0)out.push({from,to});
      return out;
    }
    // `from` defaults to the oldest stone; it may also be the second oldest under the 擇二 variant.
    legal(to,from) {
      if(this.over||!Number.isInteger(to)||to<0||to>=this.cells||this.board[to]!==0)return false;
      const lifts=this.liftable();
      if(from===undefined||from===null)return true;
      return lifts.length?lifts.includes(from):from===-1;
    }
    // The line `player` would complete by moving to `to` (lifting `from`), or null.
    wouldWin(player,to,from) {
      if(this.board[to]!==0)return null;
      const lift=from===undefined?this.leaving(player):from;
      for(const id of this.byCell[to]){const line=this.lines[id];let ok=true;for(const c of line)if(c!==to&&(this.board[c]!==player||c===lift)){ok=false;break;}if(ok)return line.slice();}
      return null;
    }
    // Cells where `player` would win on their next move (any allowed lift).
    threats(player) {
      const out=[],lifts=this.full(player)?this.queues[player].slice(0,this.choice):[-1];
      for(let i=0;i<this.cells;i++)if(this.board[i]===0&&lifts.some(f=>this.wouldWin(player,i,f)))out.push(i);
      return out;
    }
    lineThrough(cell,player) {for(const id of this.byCell[cell]){const line=this.lines[id];if(line.every(c=>this.board[c]===player))return line.slice();}return null;}
    play(to,from) {
      if(!this.legal(to,from))return null;
      const player=this.turn,q=this.queues[player];
      if(from===undefined||from===null)from=this.leaving(player);
      if(from>=0){q.splice(q.indexOf(from),1);this.board[from]=0;}
      this.board[to]=player;q.push(to);this.ply++;this.turn=other(player);
      const record={player,from,to};
      const line=this.lineThrough(to,player);
      if(line){this.winner=player;this.winLine=line;}
      const key=this.key(),count=(this.seen.get(key)||0)+1;this.seen.set(key,count);
      if(!line){if(this.repeatLimit&&count>=this.repeatLimit)this.draw='repetition';else if(this.plyLimit&&this.ply>=this.plyLimit)this.draw='ply-limit';}
      this.moves.push(record);
      return record;
    }
    // Without the draw rule the game can cycle forever (as the original page did); either
    // side may then claim a draw once the current position has appeared three times.
    canClaimDraw() {return !this.over&&this.repetitions()>=3;}
    claimDraw() {if(!this.canClaimDraw())return false;this.draw='claimed';return true;}
    // Internal make/unmake for search (no win bookkeeping).
    _do(m) {
      const player=this.turn,q=this.queues[player];let at=-1;
      if(m.from>=0){at=q.indexOf(m.from);q.splice(at,1);this.board[m.from]=0;}
      this.board[m.to]=player;q.push(m.to);this.ply++;this.turn=other(player);
      const key=this.key();this.seen.set(key,(this.seen.get(key)||0)+1);
      return{at,key,player};
    }
    _undo(m,u) {
      const n=this.seen.get(u.key)-1;if(n)this.seen.set(u.key,n);else this.seen.delete(u.key);
      const q=this.queues[u.player];q.pop();this.board[m.to]=0;
      if(m.from>=0){this.board[m.from]=u.player;q.splice(u.at,0,m.from);}
      this.ply--;this.turn=u.player;
    }
    _drawn(u) {return(this.repeatLimit&&(this.seen.get(u.key)||0)>=this.repeatLimit)||(this.plyLimit&&this.ply>=this.plyLimit);}
  }

  // ---------- AI ----------
  const WIN=100000;
  function evaluate(g,player) {
    let score=0;
    for(const p of [X,O]){
      const lift=g.leaving(p),sign=p===player?1:-1;let s=0;
      for(const line of g.lines){
        let mine=0,empty=0,blocked=false;
        for(const c of line){const v=g.board[c];if(v===p){if(c!==lift)mine++;}else if(v===0||c===g.leaving(other(p)))empty++;else blocked=true;}
        if(blocked)continue;
        const k=g.connect;if(mine===k-1&&empty===1)s+=30;else if(mine===k-2&&empty===2)s+=k===4?9:4;else if(k===4&&mine===1&&empty===3)s+=2;
      }
      for(const c of g.queues[p])if(c!==lift)s+=g.liveCount[c];
      score+=sign*s;
    }
    return score+5;
  }
  const winMove=(g,me)=>{for(const m of g.legalMoves())if(g.wouldWin(me,m.to,m.from))return m;return null;};
  function orderMoves(g,moves) {
    const me=g.turn,theirs=new Set(g.threats(other(me)));
    return moves.map(m=>{let s=g.liveCount[m.to];if(g.wouldWin(me,m.to,m.from))s+=1000;else if(theirs.has(m.to))s+=400;return[s,m];}).sort((a,b)=>b[0]-a[0]).map(x=>x[1]);
  }
  // Negamax with alpha-beta. A position repeated on the search path scores 0 (a cycle the
  // defender can keep), whether or not the draw rule is on.
  function search(g,depth,alpha,beta,ctx,ply,path) {
    if(++ctx.nodes>ctx.maxNodes||(ctx.deadline&&(ctx.nodes&511)===0&&Date.now()>ctx.deadline))ctx.aborted=true;
    if(ctx.aborted)return 0;
    const me=g.turn;
    if(winMove(g,me))return WIN-ply;
    if(depth<=0)return evaluate(g,me);
    let best=-Infinity;
    for(const m of orderMoves(g,g.legalMoves())){
      const u=g._do(m);let v;
      if(g._drawn(u)||path.has(u.key))v=0;
      else{path.add(u.key);v=-search(g,depth-1,-beta,-alpha,ctx,ply+1,path);path.delete(u.key);}
      g._undo(m,u);
      if(ctx.aborted)return 0;
      if(v>best)best=v;if(v>alpha)alpha=v;if(alpha>=beta)break;
    }
    return best;
  }
  // The original page's AI, kept as the 'classic' tier: take a win, else the first move
  // (board order) after which the opponent has no immediate win.
  function classicMove(g) {
    const me=g.turn,moves=g.legalMoves();if(!moves.length)return null;
    let best=moves[0],bestScore=-Infinity;
    for(const m of moves){
      if(g.wouldWin(me,m.to,m.from))return m;
      const u=g._do(m);const score=winMove(g,g.turn)?-1:0;g._undo(m,u);
      if(score>bestScore){bestScore=score;best=m;}
    }
    return best;
  }
  const LEVELS={
    novice:{depth:1,noise:60,timeMs:60},
    classic:{classic:true},
    normal:{depth:4,noise:6,timeMs:300},
    hard:{depth:8,noise:0,timeMs:700},
    master:{depth:12,noise:0,timeMs:1400,perfect:true}
  };
  const LEVEL_IDS=Object.keys(LEVELS);
  function chooseMove(game,options={}) {
    const level=LEVELS[options.level]||LEVELS.normal,rng=options.rng||Math.random;
    const g=game.clone(),moves=g.legalMoves();if(!moves.length)return null;
    if(level.classic){const m=classicMove(g);return{from:m.from,to:m.to,score:0,depth:2};}
    if(level.perfect&&!options.only){const table=solveTable(g.options());if(table)return perfectMove(game,table,rng);}
    const me=g.turn;
    const w=winMove(g,me);if(w)return{from:w.from,to:w.to,score:WIN,depth:1};
    const ctx={nodes:0,maxNodes:options.maxNodes||300000,deadline:options.timeMs===0?0:Date.now()+(options.timeMs||level.timeMs),aborted:false};
    const pool=options.only?moves.filter(m=>[...options.only].some(a=>a.from===m.from&&a.to===m.to)):moves;
    let ordered=orderMoves(g,pool.length?pool:moves),best=ordered[0],bestScore=-Infinity,reached=0,scores=new Map();
    for(let depth=1;depth<=(options.depth||level.depth);depth++){
      let alpha=-Infinity,iterBest=null,iterScore=-Infinity;const sc=new Map();
      for(const m of ordered){
        const u=g._do(m);let v;
        if(g._drawn(u))v=0;else v=-search(g,depth-1,-Infinity,-alpha,ctx,1,new Set([u.key]));
        g._undo(m,u);
        if(ctx.aborted)break;
        sc.set(m,v);if(v>iterScore){iterScore=v;iterBest=m;}if(v>alpha)alpha=v;
      }
      if(ctx.aborted)break;
      reached=depth;best=iterBest;bestScore=iterScore;scores=sc;
      ordered=ordered.slice().sort((a,b)=>sc.get(b)-sc.get(a));
      if(bestScore>=WIN-100)break;
    }
    if(level.noise&&bestScore<WIN-100&&reached){
      const near=ordered.filter(m=>scores.has(m)&&scores.get(m)>-WIN+100&&scores.get(m)>=bestScore-level.noise);
      if(near.length)best=near[Math.floor(rng()*near.length)];
    }
    return{from:best.from,to:best.to,score:bestScore,depth:reached,nodes:ctx.nodes};
  }

  // Retrograde solve of a whole 3×3 variant (≈67k positions for the standard game), ignoring
  // draw rules: every position is a win, loss or endless draw for the side to move, with the
  // exact number of plies to the end under best play. Cached per rule set. The master tier
  // plays from this table; the tests use it to check the challenges.
  const solved=new Map();
  function solveTable(options={}) {
    const o=normalizeOptions(options);
    if(o.size!==3)return null;
    const id=JSON.stringify([o.choice,o.blocked]);
    if(solved.has(id))return solved.get(id);
    const g=new Game(Object.assign({},o,{repeatLimit:0,plyLimit:0}));
    const keys=[],index=new Map(),succ=[],winNow=[];
    const visit=()=>{const k=g.key();if(index.has(k))return index.get(k);const i=keys.length;index.set(k,i);keys.push(k);succ.push(null);winNow.push(false);todo.push([i,snapshot()]);return i;};
    const snapshot=()=>({x:g.queues[X].slice(),o:g.queues[O].slice(),t:g.turn});
    const load=s=>{g.board.fill(0);for(const c of g.blocked)g.board[c]=BLOCK;g.queues[X]=s.x.slice();g.queues[O]=s.o.slice();for(const c of s.x)g.board[c]=X;for(const c of s.o)g.board[c]=O;g.turn=s.t;};
    const todo=[];visit();
    while(todo.length){
      const[i,s]=todo.pop();load(s);
      const moves=g.legalMoves();
      if(winMove(g,g.turn)){winNow[i]=true;succ[i]=[];continue;}
      const out=[];
      for(const m of moves){const u=g._do(m);out.push(visit());g._undo(m,u);}
      succ[i]=out;
    }
    const n=keys.length,val=new Int8Array(n),dist=new Int16Array(n);
    const pred=Array.from({length:n},()=>[]);
    for(let i=0;i<n;i++)for(const j of succ[i])pred[j].push(i);
    const left=succ.map(s=>s.length);
    let frontier=[];
    for(let i=0;i<n;i++)if(winNow[i]){val[i]=1;dist[i]=1;frontier.push(i);}
    // Layered retrograde: a position is lost once every successor is a known win (for the
    // opponent), and won as soon as one successor is a known loss.
    while(frontier.length){
      const next=[];
      for(const j of frontier)for(const i of pred[j]){
        if(val[i])continue;
        if(val[j]===-1){val[i]=1;dist[i]=dist[j]+1;next.push(i);}
        else if(--left[i]===0){val[i]=-1;dist[i]=dist[j]+1;next.push(i);}
      }
      frontier=next;
    }
    const table={index,val,dist,size:n,lookup(game){const i=index.get(game.key());return i===undefined?null:{value:val[i],plies:dist[i]};}};
    solved.set(id,table);
    return table;
  }
  // Best move from the solved table: fastest win, slowest loss, otherwise a drawing move
  // (picked by a short search among the non-losing ones).
  function perfectMove(game,table,rng=Math.random) {
    const g=game.clone(),moves=g.legalMoves();if(!moves.length)return null;
    const me=g.turn;
    const w=winMove(g,me);if(w)return{from:w.from,to:w.to,score:WIN,depth:1,value:1};
    const rated=moves.map(m=>{const h=g.clone();h.play(m.to,m.from);const r=table.lookup(h)||{value:0,plies:0};return{m,value:-r.value,plies:r.plies,drawn:h.over};});
    let pool=rated.filter(r=>r.value===1&&!r.drawn);
    if(pool.length){const best=Math.min(...pool.map(r=>r.plies));const m=pool.filter(r=>r.plies===best)[0].m;return{from:m.from,to:m.to,score:WIN-best,depth:best,value:1};}
    pool=rated.filter(r=>r.value===0||(r.value===1&&r.drawn));
    if(pool.length){
      const allowed=new Set(pool.map(r=>r.m));
      const pick=chooseMove(game,{level:'hard',rng,timeMs:0,maxNodes:20000,depth:4,only:allowed});
      return Object.assign(pick,{value:0});
    }
    const slow=rated.reduce((a,b)=>b.plies>a.plies?b:a);
    return{from:slow.m.from,to:slow.m.to,score:-WIN+slow.plies,depth:slow.plies,value:-1};
  }

  // Exact forced-win search for challenges: can the side to move complete a line within
  // `moves` of its own moves whatever the opponent does? Returns the first winning move or null.
  function forcedWin(game,moves) {
    const g=game.clone(),me=g.turn;
    const attack=left=>{
      const cands=g.legalMoves();
      for(const m of cands)if(g.wouldWin(me,m.to,m.from))return m;
      if(left<=1)return null;
      for(const m of cands){
        const u=g._do(m);let ok=!g._drawn(u);
        if(ok){
          const replies=g.legalMoves();
          if(!replies.length||winMove(g,g.turn))ok=false;
          for(let i=0;ok&&i<replies.length;i++){const r=replies[i],v=g._do(r);ok=!g._drawn(v)&&attack(left-1)!==null;g._undo(r,v);}
        }
        g._undo(m,u);
        if(ok)return m;
      }
      return null;
    };
    return attack(moves);
  }
  // All first moves that force a win within `moves` (used to prove a challenge has one answer).
  function forcedWinMoves(game,moves) {
    const out=[];
    for(const m of game.legalMoves()){
      if(game.wouldWin(game.turn,m.to,m.from)){out.push(m);continue;}
      if(moves<=1)continue;
      const g=game.clone();g.play(m.to,m.from);if(g.over)continue;
      const replies=g.legalMoves();
      if(replies.length&&replies.every(r=>{const h=g.clone();h.play(r.to,r.from);return !h.over&&forcedWin(h,moves-1)!==null;}))out.push(m);
    }
    return out;
  }
  // Build a mid-game position from ordered queues (oldest first).
  function fromPosition(pos,options={}) {
    const g=new Game(options);
    for(const p of [X,O])for(const c of pos.queues[p]){
      if(g.board[c]!==0)throw new Error('cell '+c+' used twice');
      g.board[c]=p;g.queues[p].push(c);
    }
    g.turn=pos.turn||X;g.ply=pos.ply||g.queues[X].length+g.queues[O].length;
    g.seen=new Map([[g.key(),1]]);
    return g;
  }
  // Challenges: the side to move forces a line within `moves` of its own moves; `key` is the
  // only first move that does (checked by the tests with forcedWinMoves).
  // Generated from random positions with solveTable (3×3) or forcedWin (4×4).
  const PUZZLES=[
    {id:'p01',name:'起手式',variant:'standard',moves:2,level:1,turn:X,x:[5,1,6],o:[2,0,8],key:4},
    {id:'p02',name:'後手反擊',variant:'standard',moves:2,level:1,turn:O,x:[7,5,6],o:[8,3,1],key:4},
    {id:'p03',name:'空心邊線',variant:'hollow',moves:2,level:2,turn:X,x:[3,2,7],o:[8,0,5],key:6},
    {id:'p04',name:'三手連環',variant:'standard',moves:3,level:2,turn:X,x:[3,5,1],o:[8,2,0],key:4},
    {id:'p05',name:'讓出一角',variant:'standard',moves:3,level:3,turn:O,x:[2,5,7],o:[3,6,8],key:4},
    {id:'p06',name:'擇二初探',variant:'choice',moves:2,level:3,turn:X,x:[5,2,0],o:[8,3,1],key:4,from:2},
    {id:'p07',name:'空心三手',variant:'hollow',moves:3,level:4,turn:X,x:[5,3,8],o:[6,1,7],key:2},
    {id:'p08',name:'四手棋',variant:'standard',moves:4,level:4,turn:O,x:[3,1,5],o:[4,2,7],key:8},
    {id:'p09',name:'角落伏兵',variant:'standard',moves:4,level:5,turn:O,x:[5,8,7],o:[0,2,3],key:6},
    {id:'p10',name:'廣盤收網',variant:'wide',moves:2,level:5,turn:X,x:[12,9,0,15],o:[10,3,2,13],key:5},
    {id:'p11',name:'擇二迴旋',variant:'choice',moves:3,level:6,turn:O,x:[2,0,7],o:[8,1,4],key:3,from:1},
    {id:'p12',name:'空心四手',variant:'hollow',moves:4,level:6,turn:X,x:[6,3,2],o:[7,5,8],key:0},
    {id:'p13',name:'廣盤三手',variant:'wide',moves:3,level:7,turn:O,x:[11,3,12,10],o:[14,1,9,15],key:7},
    {id:'p14',name:'五手長考',variant:'standard',moves:5,level:8,turn:X,x:[1,6,7],o:[2,4,8],key:0},
    {id:'p15',name:'終局五手',variant:'standard',moves:5,level:9,turn:O,x:[7,5,4],o:[8,2,3],key:6}
  ];
  const puzzleGame=p=>fromPosition({queues:{[X]:p.x,[O]:p.o},turn:p.turn},Object.assign(variantOptions(p.variant),DRAW_RULE));

  return{X,O,BLOCK,ROW_NAMES,linesFor,normalizeOptions,VARIANTS,VARIANT_IDS,variantOptions,DRAW_RULE,label,Game,evaluate,classicMove,chooseMove,LEVELS,LEVEL_IDS,solveTable,perfectMove,forcedWin,forcedWinMoves,fromPosition,PUZZLES,puzzleGame,WIN};
});
