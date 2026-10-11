/* Deterministic public-board search. UMD: FlipFiveAI in browsers; module.exports in Node.
 * No clock cutoff, randomness, private state, rule changes, or score-based handicaps.
 * Work is bounded by count of simulated placements. Immediate root defenses are
 * screened completely before quiet continuation search. Quiet beams are heuristic.
 */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./flip-five-engine.js'):root.FlipFive);if(typeof module==='object'&&module.exports)module.exports=api;else root.FlipFiveAI=api;})(typeof globalThis==='object'?globalThis:this,function(F){
'use strict';
const SIZE=9,CELLS=81,WIN=10000000,INF=20000000;
const WEIGHTS=[0,2,18,150,2200,1000000];
const segments=[],members=Array.from({length:CELLS},()=>[]),rays=Array.from({length:CELLS},()=>[]);
const inside=(r,c)=>r>=0&&c>=0&&r<SIZE&&c<SIZE;
for(let cell=0;cell<CELLS;cell++){
  const r=Math.floor(cell/SIZE),c=cell%SIZE;
  for(const[dr,dc]of F.DIRS){const ray=[];for(let y=r+dr,x=c+dc;inside(y,x);y+=dr,x+=dc)ray.push(y*SIZE+x);rays[cell].push(ray);}
  for(const[dr,dc]of [[0,1],[1,0],[1,1],[1,-1]])if(inside(r+4*dr,c+4*dc)){const segment=Array.from({length:5},(_,k)=>(r+k*dr)*SIZE+c+k*dc),index=segments.length;segments.push(segment);for(const i of segment)members[i].push(index);}
}
const positional=Array.from({length:CELLS},(_,i)=>8-Math.abs(Math.floor(i/9)-4)-Math.abs(i%9-4));
const contribution=(a,b)=>b===0?WEIGHTS[a]:a===0?-WEIGHTS[b]:0;
function state(board){
  const s={board:Uint8Array.from(board),a:new Uint8Array(segments.length),b:new Uint8Array(segments.length),value:0,count1:0,empty:0,position:0,winner:-1};
  for(let i=0;i<CELLS;i++){const p=s.board[i];if(!p)s.empty++;else {s.count1+=p===1;s.position+=(p===1?1:-1)*positional[i];}}
  for(let j=0;j<segments.length;j++){for(const i of segments[j]){s.a[j]+=s.board[i]===1;s.b[j]+=s.board[i]===2;}s.value+=contribution(s.a[j],s.b[j]);}
  const result=F.outcome(Array.from(s.board));if(result)s.winner=result.winner;
  return s;
}
function changes(s,cell,player){
  const changed=[cell],opponent=3-player;
  for(const ray of rays[cell]){let n=0;while(n<ray.length&&s.board[ray[n]]===opponent)n++;if(n&&n<ray.length&&s.board[ray[n]]===player)for(let j=0;j<n;j++)changed.push(ray[j]);}
  return changed;
}
function apply(s,cell,player,changed=changes(s,cell,player)){
  const t={board:s.board.slice(),a:s.a.slice(),b:s.b.slice(),value:s.value,count1:s.count1,empty:s.empty-1,position:s.position,winner:-1,flips:changed.length-1};
  for(const i of changed){const old=t.board[i];t.board[i]=player;t.count1+=(player===1?1:0)-(old===1?1:0);t.position+=((player===1?1:-1)-(old===0?0:old===1?1:-1))*positional[i];for(const j of members[i]){t.value-=contribution(t.a[j],t.b[j]);if(old===1)t.a[j]--;else if(old===2)t.b[j]--;if(player===1)t.a[j]++;else t.b[j]++;t.value+=contribution(t.a[j],t.b[j]);}}
  // A legal placement/capture cannot create a line for the other color. The
  // input root was checked for pre-existing terminal lines before searching.
  const counts=player===1?t.a:t.b;outer:for(const i of changed)for(const j of members[i])if(counts[j]===5){t.winner=player;break outer;}
  if(t.winner<0&&!t.empty)t.winner=t.count1*2===CELLS?0:t.count1*2>CELLS?1:2;
  return t;
}
function tie(cell,seed){let x=(Math.imul(cell+1,0x9e3779b1)^(seed>>>0))>>>0;x^=x>>>16;x=Math.imul(x,0x85ebca6b)>>>0;x^=x>>>13;return x>>>0;}
function evaluate(s,player,profile){if(s.winner>=0)return s.winner===0?0:s.winner===player?WIN:-WIN;const material=s.count1*2-(CELLS-s.empty),v=s.value+s.position+(profile==='flipper'?12:1)*material;return player===1?v:-v;}
function makeContext(observation,options){return {profile:observation.profile==='flipper'?'flipper':'architect',seed:(options.seed??0)>>>0,nodeBudget:Math.max(8000,Math.min(250000,Math.floor(options.nodeBudget??36000))),maxDepth:Math.max(1,Math.min(6,Math.floor(options.maxDepth??4))),width:Math.max(4,Math.min(24,Math.floor(options.width??12))),nodes:0,generated:0,completeDepth:0,stopped:false,tacticalChecks:0,rootCandidates:0,safeCandidates:0};}
// A quick exact hypothetical-win probe changes only the local board, restores it,
// and avoids allocating a whole search state. Counts remain untouched.
function winningMove(s,cell,player,ctx){
  ctx.nodes++;ctx.tacticalChecks++;const changed=changes(s,cell,player);
  if(CELLS-s.empty<4)return false;
  for(const i of changed)s.board[i]=player;
  let win=false;outer:for(const i of changed)for(const j of members[i]){const segment=segments[j];let full=true;for(const k of segment)if(s.board[k]!==player){full=false;break;}if(full){win=true;break outer;}}
  if(!win&&s.empty===1){const count1=s.count1+(player===1?changed.length:-(changed.length-1));win=player===1?count1*2>CELLS:count1*2<CELLS;}
  s.board[cell]=0;for(let j=1;j<changed.length;j++)s.board[changed[j]]=3-player;
  return win;
}
function immediate(s,player,ctx){if(CELLS-s.empty<4)return false;for(let i=0;i<CELLS;i++)if(!s.board[i]&&winningMove(s,i,player,ctx))return true;return false;}
function generate(s,player,ctx){const moves=[];for(let cell=0;cell<CELLS;cell++)if(!s.board[cell]){ctx.nodes++;ctx.generated++;const next=apply(s,cell,player);moves.push({cell,next,score:evaluate(next,player,ctx.profile),tie:tie(cell,ctx.seed)});}moves.sort((a,b)=>b.score-a.score||a.tie-b.tie||a.cell-b.cell);return moves;}
function search(s,player,depth,alpha,beta,ctx){
  if(s.winner>=0)return evaluate(s,player,ctx.profile);
  if(depth<=0){
    // A frontier is never treated as quiet while the mover can win on the
    // next placement. This exact one-ply extension catches capture-five traps.
    if(ctx.nodes+s.empty>ctx.nodeBudget){ctx.stopped=true;return 0;}
    return immediate(s,player,ctx)?WIN:evaluate(s,player,ctx.profile);
  }
  if(ctx.nodes+CELLS>ctx.nodeBudget){ctx.stopped=true;return 0;}
  const moves=generate(s,player,ctx);if(!moves.length)return 0;
  // Generate all moves first, so a winning capture cannot be excluded by a beam.
  if(moves[0].next.winner===player)return WIN+depth;
  let best=-INF;
  for(let i=0;i<Math.min(ctx.width,moves.length);i++){
    const value=-search(moves[i].next,3-player,depth-1,-beta,-alpha,ctx);
    if(ctx.stopped)return 0;
    if(value>best)best=value;if(value>alpha)alpha=value;if(alpha>=beta)break;
  }
  return best;
}
function chooseMove(observation,options={}){
  if(!observation||!Array.isArray(observation.board)&&!ArrayBuffer.isView(observation.board)||observation.board.length!==CELLS||![1,2].includes(observation.player)||Array.from(observation.board).some(p=>![0,1,2].includes(p)))return null;
  const root=state(observation.board),player=observation.player;if(root.winner>=0||!root.empty)return null;
  const ctx=makeContext(observation,options),moves=generate(root,player,ctx);ctx.rootCandidates=moves.length;
  const win=moves.find(move=>move.next.winner===player);
  const result=(move,score,reason)=>({cell:move.cell,score,reason,stats:{nodes:ctx.nodes,nodeBudget:ctx.nodeBudget,generated:ctx.generated,tacticalChecks:ctx.tacticalChecks,completedDepth:ctx.completeDepth,requestedDepth:ctx.maxDepth,budgetExhausted:ctx.stopped,rootCandidates:ctx.rootCandidates,safeCandidates:ctx.safeCandidates,quietBeamWidth:ctx.width,seed:ctx.seed,proof:false}});
  if(win)return result(win,WIN,win.next.flips?'夾翻後接成五連':'完成五連');
  // Exact root screen: at most 81*80 hypothetical reply probes. It is finished
  // before the quiet budget is spent and its cost is included in stats.nodes.
  const safe=[];for(const move of moves){move.unsafe=move.next.winner===3-player||(move.next.winner<0&&immediate(move.next,3-player,ctx));if(!move.unsafe)safe.push(move);}
  ctx.safeCandidates=safe.length;
  const candidates=safe.length?safe:moves;let best=candidates[0],bestScore=best.score;ctx.completeDepth=1;
  // Iterative deepening commits only complete root passes. An exhausted search
  // cannot let the last partially explored move overwrite a verified choice.
  for(let depth=2;depth<=ctx.maxDepth;depth++){
    let nextBest=candidates[0],nextScore=-INF,alpha=-INF,completed=true;
    for(let i=0;i<Math.min(ctx.width,candidates.length);i++){
      const value=-search(candidates[i].next,3-player,depth-1,-INF,-alpha,ctx);
      if(ctx.stopped){completed=false;break;}
      if(value>nextScore){nextScore=value;nextBest=candidates[i];}if(value>alpha)alpha=value;
    }
    if(!completed)break;best=nextBest;bestScore=nextScore;ctx.completeDepth=depth;
    // Bring the principal move forward for the next fully budgeted pass.
    const index=candidates.indexOf(best);if(index>0)candidates.unshift(candidates.splice(index,1)[0]);
    if(Math.abs(bestScore)>=WIN)break;
  }
  const reason=!safe.length?'搜尋可延後對手連線的應手':best.next.flips?'用夾翻拆線並搜尋後續攻守':'搜尋後續夾翻，保留攻守支點';
  return result(best,bestScore,reason);
}
return {chooseMove,version:'bounded-continuation-1',_testing:{state,apply,evaluate,winningMove,segments,changes}};
});
