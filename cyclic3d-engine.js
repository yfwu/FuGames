'use strict';
// 立體三子循環棋 rules core: a 3×3×3 cube, three stones per side, FIFO moves.
// Shared by cyclic_tictactoe_3d.html and the Node rule tests.
(function(root,factory){const engine=factory();if(typeof module==='object'&&module.exports)module.exports=engine;else root.CyclicCube=engine;})(typeof globalThis==='object'?globalThis:this,()=>{
  const N=3,CELLS=27,STONES=3,PLY_LIMIT=120,REPEAT_LIMIT=3,BLACK=1,WHITE=2;
  const index=(layer,row,col)=>layer*9+row*3+col;
  const coord=i=>({layer:Math.floor(i/9),row:Math.floor(i/3)%3,col:i%3});
  const LAYER_NAMES=['下層','中層','上層'],ROW_NAMES=['A','B','C'];
  const label=i=>{const p=coord(i);return LAYER_NAMES[p.layer]+' '+ROW_NAMES[p.row]+(p.col+1);};
  const other=p=>3-p;

  // Every straight three-cell line: 13 direction classes (one of each ± pair).
  const LINES=[];
  {
    const dirs=[];
    for(let dl=-1;dl<=1;dl++)for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){
      if(!dl&&!dr&&!dc)continue;
      const first=dl||dr||dc;if(first>0)dirs.push([dl,dr,dc]);
    }
    const inside=v=>v>=0&&v<N;
    for(let l=0;l<N;l++)for(let r=0;r<N;r++)for(let c=0;c<N;c++)for(const[dl,dr,dc]of dirs){
      if(inside(l-dl)&&inside(r-dr)&&inside(c-dc))continue; // only start at a line end
      const cells=[];for(let k=0;k<N;k++){const L=l+dl*k,R=r+dr*k,C=c+dc*k;if(!inside(L)||!inside(R)||!inside(C))break;cells.push(index(L,R,C));}
      if(cells.length===N)LINES.push(cells);
    }
  }
  const LINES_BY_CELL=Array.from({length:CELLS},()=>[]);
  LINES.forEach((line,id)=>{for(const cell of line)LINES_BY_CELL[cell].push(id);});
  const lineKind=line=>{
    const a=coord(line[0]),b=coord(line[1]);
    const d=[b.layer-a.layer,b.row-a.row,b.col-a.col].filter(Boolean).length;
    return d===1?'axis':d===2?(b.layer===a.layer?'layer-diagonal':'cross-diagonal'):'space-diagonal';
  };

  class Game {
    constructor(options={}) {
      this.pieRule=options.pieRule!==false;
      this.board=new Array(CELLS).fill(0);
      this.queues={[BLACK]:[],[WHITE]:[]};
      this.turn=BLACK;
      this.ply=0;
      this.pieOpen=false;      // White may still swap sides (only right after Black's first stone)
      this.swapped=false;      // controller mapping: false = original seats, true = seats exchanged
      this.winner=0;this.winLine=null;this.draw=null;
      this.seen=new Map();this.moves=[];
      this.seen.set(this.key(),1);
    }
    clone() {
      const g=Object.create(Game.prototype);
      Object.assign(g,this,{board:this.board.slice(),queues:{[BLACK]:this.queues[BLACK].slice(),[WHITE]:this.queues[WHITE].slice()},seen:new Map(this.seen),moves:this.moves.slice(),winLine:this.winLine&&this.winLine.slice()});
      return g;
    }
    // A full position: ordered queues (FIFO order changes the future), side to move,
    // and the pie/seat state. Bare occupancy would merge different futures.
    key() {return this.queues[BLACK].join('.')+'|'+this.queues[WHITE].join('.')+'|'+this.turn+'|'+(this.pieOpen?1:0)+(this.swapped?1:0);}
    toJSON() {return{pieRule:this.pieRule,board:this.board.slice(),queues:{[BLACK]:this.queues[BLACK].slice(),[WHITE]:this.queues[WHITE].slice()},turn:this.turn,ply:this.ply,pieOpen:this.pieOpen,swapped:this.swapped,winner:this.winner,winLine:this.winLine,draw:this.draw,seen:[...this.seen],moves:this.moves.slice()};}
    static from(data) {
      const g=new Game({pieRule:data.pieRule});
      Object.assign(g,{board:data.board.slice(),queues:{[BLACK]:data.queues[BLACK].slice(),[WHITE]:data.queues[WHITE].slice()},turn:data.turn,ply:data.ply,pieOpen:data.pieOpen,swapped:data.swapped,winner:data.winner||0,winLine:data.winLine||null,draw:data.draw||null,seen:new Map(data.seen),moves:(data.moves||[]).slice()});
      return g;
    }
    get over() {return Boolean(this.winner||this.draw);}
    repetitions() {return this.seen.get(this.key())||0;}
    // The stone that will be lifted on `player`'s next move, or -1 while still placing.
    leaving(player=this.turn) {const q=this.queues[player];return q.length>=STONES?q[0]:-1;}
    legal(cell) {return !this.over&&Number.isInteger(cell)&&cell>=0&&cell<CELLS&&this.board[cell]===0;}
    legalMoves() {if(this.over)return[];const out=[];for(let i=0;i<CELLS;i++)if(this.board[i]===0)out.push(i);return out;}
    // Returns the line the player would complete by moving to `cell`, honouring FIFO removal.
    wouldWin(player,cell) {
      if(this.board[cell]!==0)return null;
      const lift=this.leaving(player);
      for(const id of LINES_BY_CELL[cell]){const line=LINES[id];let ok=true;for(const c of line)if(c!==cell&&(this.board[c]!==player||c===lift)){ok=false;break;}if(ok)return line;}
      return null;
    }
    threats(player) {const out=[];for(let i=0;i<CELLS;i++)if(this.board[i]===0&&this.wouldWin(player,i))out.push(i);return out;}
    play(cell) {
      if(!this.legal(cell))return null;
      const player=this.turn,q=this.queues[player];
      const from=q.length>=STONES?q.shift():-1;
      if(from>=0)this.board[from]=0;
      this.board[cell]=player;q.push(cell);
      this.ply++;
      const record={player,from,to:cell,pieOpen:this.pieOpen};
      this.pieOpen=this.pieRule&&this.ply===1;
      this.turn=other(player);
      const line=this.lineThrough(cell,player);
      if(line){this.winner=player;this.winLine=line;}
      const key=this.key(),count=(this.seen.get(key)||0)+1;this.seen.set(key,count);
      if(!line){if(count>=REPEAT_LIMIT)this.draw='repetition';else if(this.ply>=PLY_LIMIT)this.draw='ply-limit';}
      this.moves.push(record);
      return record;
    }
    // Pie rule: right after Black's first stone, White's side may take over Black.
    // Stones and queues stay; only who controls which colour changes, and White still moves.
    swap() {
      if(!this.pieOpen||this.over)return false;
      this.pieOpen=false;this.swapped=!this.swapped;
      const key=this.key();this.seen.set(key,(this.seen.get(key)||0)+1);
      this.moves.push({swap:true});
      return true;
    }
    declineSwap() {if(!this.pieOpen)return false;this.pieOpen=false;const key=this.key();this.seen.set(key,(this.seen.get(key)||0)+1);return true;}
    // Seat 0 starts as Black. After a swap, seat 0 controls White.
    colorOf(seat) {return (seat===0)!==this.swapped?BLACK:WHITE;}
    seatOf(color) {return (color===BLACK)!==this.swapped?0:1;}
    lineThrough(cell,player) {for(const id of LINES_BY_CELL[cell]){const line=LINES[id];if(line.every(c=>this.board[c]===player))return line.slice();}return null;}
    // Internal make/unmake for search.
    _do(cell) {
      const player=this.turn,q=this.queues[player],from=q.length>=STONES?q.shift():-1;
      if(from>=0)this.board[from]=0;this.board[cell]=player;q.push(cell);this.ply++;this.turn=other(player);
      const key=this.key();this.seen.set(key,(this.seen.get(key)||0)+1);
      return{from,key,player};
    }
    _undo(cell,u) {
      const n=this.seen.get(u.key)-1;if(n)this.seen.set(u.key,n);else this.seen.delete(u.key);
      const q=this.queues[u.player];q.pop();this.board[cell]=0;if(u.from>=0){this.board[u.from]=u.player;q.unshift(u.from);}this.ply--;this.turn=u.player;
    }
  }

  // ----- AI -----
  const WIN=100000;
  function evaluate(g,player) {
    // Each side's lifting stone is about to vanish on its own next move, so it does not count.
    let score=0;
    for(const p of [BLACK,WHITE]){
      const lift=g.leaving(p),sign=p===player?1:-1;let s=0;
      for(const line of LINES){
        let mine=0,blocked=false,empty=0;
        for(const c of line){const v=g.board[c];if(v===p&&c!==lift)mine++;else if(v===other(p))blocked=true;else if(v===0)empty++;}
        if(blocked)continue;
        if(mine===2&&empty===1)s+=36;else if(mine===1&&empty===2)s+=4;
      }
      for(const c of g.queues[p])if(c!==lift)s+=LINES_BY_CELL[c].length;
      score+=sign*s;
    }
    // Having the move with a live threat is decisive; a pending one is merely good.
    return score+6;
  }
  function orderMoves(g,moves) {
    const me=g.turn,op=other(me),theirs=new Set(g.threats(op));
    const scored=moves.map(cell=>{let s=LINES_BY_CELL[cell].length;if(g.wouldWin(me,cell))s+=1000;else if(theirs.has(cell))s+=500;return[s,cell];});
    scored.sort((a,b)=>b[0]-a[0]);
    return scored.map(x=>x[1]);
  }
  function search(g,depth,alpha,beta,ctx,ply) {
    if(++ctx.nodes>ctx.maxNodes||(ctx.deadline&&(ctx.nodes&1023)===0&&Date.now()>ctx.deadline))ctx.aborted=true;
    if(ctx.aborted)return 0;
    const me=g.turn;
    // An immediate win is always found first; the same draw rules as real games apply after it.
    for(const cell of g.legalMoves())if(g.wouldWin(me,cell))return WIN-ply;
    if(depth<=0)return evaluate(g,me);
    let best=-Infinity;
    for(const cell of orderMoves(g,g.legalMoves())){
      const u=g._do(cell);let v;
      if((g.seen.get(u.key)||0)>=REPEAT_LIMIT||g.ply>=PLY_LIMIT)v=0;
      else v=-search(g,depth-1,-beta,-alpha,ctx,ply+1);
      g._undo(cell,u);
      if(ctx.aborted)return 0;
      if(v>best)best=v;if(v>alpha)alpha=v;if(alpha>=beta)break;
    }
    return best;
  }
  const LEVELS={easy:{depth:2,noise:30,timeMs:150},normal:{depth:4,noise:4,timeMs:500},hard:{depth:7,noise:0,timeMs:900}};
  function chooseMove(game,options={}) {
    const level=LEVELS[options.level]||LEVELS.normal,rng=options.rng||Math.random;
    const g=game.clone();g.pieOpen=false;
    const moves=g.legalMoves();if(!moves.length)return null;
    const me=g.turn;
    for(const cell of moves)if(g.wouldWin(me,cell))return{cell,score:WIN,depth:1};
    // Opening: a seat facing the pie rule avoids handing over the 13-line centre.
    if(g.ply===0){
      const pool=game.pieRule?[0,2,6,8,18,20,24,26,4,10,12,14,16,22]:[13];
      return{cell:pool[Math.floor(rng()*pool.length)],score:0,depth:0};
    }
    const ctx={nodes:0,maxNodes:options.maxNodes||400000,deadline:options.timeMs===0?0:Date.now()+(options.timeMs||level.timeMs),aborted:false};
    let ordered=orderMoves(g,moves),bestCell=ordered[0],bestScore=-Infinity,reached=0;
    for(let depth=1;depth<=level.depth;depth++){
      let alpha=-Infinity,iterBest=null,iterScore=-Infinity;const scores=new Map();
      for(const cell of ordered){
        const u=g._do(cell);let v;
        if((g.seen.get(u.key)||0)>=REPEAT_LIMIT||g.ply>=PLY_LIMIT)v=0;
        else v=-search(g,depth-1,-Infinity,-alpha,ctx,1);
        g._undo(cell,u);
        if(ctx.aborted)break;
        scores.set(cell,v);if(v>iterScore){iterScore=v;iterBest=cell;}if(v>alpha)alpha=v;
      }
      if(ctx.aborted)break;
      reached=depth;bestCell=iterBest;bestScore=iterScore;
      ordered=ordered.slice().sort((a,b)=>scores.get(b)-scores.get(a));
      if(bestScore>=WIN-100)break;
    }
    // Small, bounded randomness only among near-equal, non-losing moves.
    if(level.noise&&bestScore<WIN-100){
      const g2=g;const near=[];
      for(const cell of ordered.slice(0,6)){
        const u=g2._do(cell);const v=-search(g2,Math.min(1,reached),-Infinity,Infinity,{nodes:0,maxNodes:1e9,deadline:0},1);g2._undo(cell,u);
        if(v>-WIN+100&&v>=bestScore-level.noise)near.push(cell);
      }
      if(near.length)bestCell=near[Math.floor(rng()*near.length)];
    }
    return{cell:bestCell,score:bestScore,depth:reached,nodes:ctx.nodes};
  }
  // Pie decision for the White seat: take Black over when the opening stone is the centre.
  function shouldSwap(game) {return game.pieOpen&&game.queues[BLACK][0]===13;}

  return{N,CELLS,STONES,PLY_LIMIT,REPEAT_LIMIT,BLACK,WHITE,LINES,LINES_BY_CELL,LAYER_NAMES,ROW_NAMES,index,coord,label,lineKind,Game,evaluate,chooseMove,shouldSwap,LEVELS};
});
