
'use strict';
const FlipFive = (() => {
  const SIZE=9,DIRS=[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]],LINES=[[0,1],[1,0],[1,1],[1,-1]];
  const inside=(r,c,size=SIZE)=>r>=0&&c>=0&&r<size&&c<size;
  const SEGMENTS=[];
  for(let r=0;r<SIZE;r++)for(let c=0;c<SIZE;c++)for(const[dr,dc]of LINES)if(inside(r+dr*4,c+dc*4))SEGMENTS.push(Array.from({length:5},(_,k)=>(r+dr*k)*SIZE+c+dc*k));
  function flips(board,cell,player,size=SIZE) {
    if(!Number.isInteger(cell)||cell<0||cell>=board.length||board[cell])return [];
    const r=Math.floor(cell/size),c=cell%size,result=[];
    for(const[dr,dc]of DIRS){let y=r+dr,x=c+dc,ray=[];while(inside(y,x,size)&&board[y*size+x]===3-player){ray.push(y*size+x);y+=dr;x+=dc;}if(ray.length&&inside(y,x,size)&&board[y*size+x]===player)result.push(...ray);}
    return result;
  }
  function apply(board,cell,player,size=SIZE) {if(!Number.isInteger(cell)||cell<0||cell>=board.length||board[cell])return null;const changed=flips(board,cell,player,size),next=board.slice();next[cell]=player;for(const i of changed)next[i]=player;return {board:next,flipped:changed};}
  function winningLines(board,size=SIZE) {
    const wins=[[],[],[]];
    for(let r=0;r<size;r++)for(let c=0;c<size;c++){const p=board[r*size+c];if(!p)continue;for(const[dr,dc]of LINES){if(inside(r-dr,c-dc,size)&&board[(r-dr)*size+c-dc]===p)continue;const line=[];let y=r,x=c;while(inside(y,x,size)&&board[y*size+x]===p){line.push(y*size+x);y+=dr;x+=dc;}if(line.length>=5)wins[p].push(line);}}
    return wins;
  }
  function outcome(board,size=SIZE) {
    const lines=winningLines(board,size),a=lines[1].length>0,b=lines[2].length>0;
    if(a||b)return {winner:a&&b?0:a?1:2,reason:a&&b?'雙方在翻轉後都有五連，和局。':'落子與翻轉後形成五連。',lines};
    if(board.every(Boolean)){const n=board.filter(p=>p===1).length,m=board.length-n;return {winner:n===m?0:n>m?1:2,reason:`滿盤無五連：青綠 ${n} 子，珊瑚 ${m} 子。`,lines};}
    return null;
  }
  const legalMoves=board=>board.reduce((out,p,i)=>{if(!p)out.push(i);return out;},[]);
  function evaluate(board,player,profile) {
    const weight=[0,1,9,70,850,50000];let value=0;
    for(const segment of SEGMENTS){let own=0,other=0;for(const i of segment){if(board[i]===player)own++;else if(board[i])other++;}if(!other)value+=weight[own];if(!own)value-=weight[other]*1.15;}
    if(profile==='flipper')for(const p of board)value+=p===player?9:p?-9:0;
    return value;
  }
  function immediateWins(board,player) {const wins=[];for(const cell of legalMoves(board)){const next=apply(board,cell,player),result=outcome(next.board);if(result&&result.winner===player)wins.push(cell);}return wins;}
  // The complete board is public. There is no hidden state or private opponent input.
  function chooseMove(observation) {
    const {board,player,profile='architect'}=observation,other=3-player,choices=[];
    for(const cell of legalMoves(board)){
      const next=apply(board,cell,player),result=outcome(next.board),r=Math.floor(cell/SIZE),c=cell%SIZE;
      const positional=(8-Math.abs(r-4)-Math.abs(c-4))*.1;
      let score=evaluate(next.board,player,profile)+positional+next.flipped.length*(profile==='flipper'?15:1);
      if(result&&result.winner===player)score+=10000000;
      else if(result&&result.winner===other)score-=10000000;
      choices.push({cell,next,result,score});
    }
    if(!choices.length)return null;choices.sort((a,b)=>b.score-a.score||a.cell-b.cell);
    const win=choices.find(c=>c.result&&c.result.winner===player);if(win)return {cell:win.cell,reason:win.next.flipped.length?'夾翻後接成五連':'完成五連'};
    const enemyWins=immediateWins(board,other);
    // Search every reply to each promising action. If under immediate threat,
    // broaden to every action so a defensive capture is never skipped.
    const shortlist=enemyWins.length?choices:choices.slice(0,12);
    let best=null;
    for(const choice of shortlist){
      const threats=choice.result?[]:immediateWins(choice.next.board,other);
      const score=choice.score-threats.length*1000000;
      if(!best||score>best.score)best={cell:choice.cell,score,flipped:choice.next.flipped.length,threats:threats.length};
    }
    return {cell:best.cell,reason:enemyWins.length&&!best.threats?(best.flipped?'用夾翻拆掉對手的即勝線':'封住對手的即勝落點'):best.threats?'嘗試延後對手的連線':profile==='flipper'&&best.flipped?`翻轉 ${best.flipped} 子，爭取盤面`:'保留連線方向並限制對手'};
  }
  class Game {
    constructor(profile='architect',first=1){this.profile=profile;this.reset(first);}
    reset(first=1){this.board=Array(SIZE*SIZE).fill(0);this.turn=first;this.first=first;this.ply=0;this.phase='ready';this.result=null;this.last=null;}
    start(){if(this.phase==='ready'||this.phase==='paused')this.phase='running';}
    pause(){if(this.phase==='running')this.phase='paused';}
    observation(player=this.turn){return {board:this.board.slice(),player,profile:this.profile};}
    act(cell,reason=''){
      if(this.phase!=='running')return false;const move=apply(this.board,cell,this.turn);if(!move)return false;
      this.last={cell,player:this.turn,flipped:move.flipped,reason};this.board=move.board;this.ply++;this.result=outcome(this.board);
      if(this.result)this.phase='over';else this.turn=3-this.turn;return true;
    }
  }
  return {Game,SIZE,DIRS,flips,apply,winningLines,outcome,legalMoves,evaluate,immediateWins,chooseMove};
})();
