'use strict';
(function(root,factory){const engine=factory();if(typeof module==='object'&&module.exports)module.exports=engine;else root.FlipFive=engine;})(typeof globalThis==='object'?globalThis:this,()=>{
  // Cells: 0 empty, 1 first side (you, seal), 2 second side (AI, azure), 3 neutral rock (石陣 variant).
  // A rock is never empty, never flips, never belongs to a line and stops every sandwich ray.
  const SIZE=9,ROCK=3,DIRS=[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]],LINES=[[0,1],[1,0],[1,1],[1,-1]];
  const inside=(r,c,size=SIZE)=>r>=0&&c>=0&&r<size&&c<size;
  const SEGMENTS=[];
  for(let r=0;r<SIZE;r++)for(let c=0;c<SIZE;c++)for(const[dr,dc]of LINES)if(inside(r+dr*4,c+dc*4))SEGMENTS.push(Array.from({length:5},(_,k)=>(r+dr*k)*SIZE+c+dc*k));
  const coord=i=>`${String.fromCharCode(65+i%SIZE)}${Math.floor(i/SIZE)+1}`;
  const cellOf=name=>{const m=/^([A-I])([1-9])$/.exec(String(name||'').trim().toUpperCase());return m?(Number(m[2])-1)*SIZE+m[1].charCodeAt(0)-65:-1;};
  function flips(board,cell,player,size=SIZE) {
    if(!Number.isInteger(cell)||cell<0||cell>=board.length||board[cell])return [];
    const r=Math.floor(cell/size),c=cell%size,result=[];
    for(const[dr,dc]of DIRS){let y=r+dr,x=c+dc,ray=[];while(inside(y,x,size)&&board[y*size+x]===3-player){ray.push(y*size+x);y+=dr;x+=dc;}if(ray.length&&inside(y,x,size)&&board[y*size+x]===player)result.push(...ray);}
    return result;
  }
  function apply(board,cell,player,size=SIZE) {if(!Number.isInteger(cell)||cell<0||cell>=board.length||board[cell])return null;const changed=flips(board,cell,player,size),next=board.slice();next[cell]=player;for(const i of changed)next[i]=player;return {board:next,flipped:changed};}
  function winningLines(board,size=SIZE) {
    const wins=[[],[],[]];
    for(let r=0;r<size;r++)for(let c=0;c<size;c++){const p=board[r*size+c];if(p!==1&&p!==2)continue;for(const[dr,dc]of LINES){if(inside(r-dr,c-dc,size)&&board[(r-dr)*size+c-dc]===p)continue;const line=[];let y=r,x=c;while(inside(y,x,size)&&board[y*size+x]===p){line.push(y*size+x);y+=dr;x+=dc;}if(line.length>=5)wins[p].push(line);}}
    return wins;
  }
  function outcome(board,size=SIZE) {
    const lines=winningLines(board,size),a=lines[1].length>0,b=lines[2].length>0;
    if(a||b)return {winner:a&&b?0:a?1:2,reason:a&&b?'雙方在翻轉後都有五連，和局。':'落子與翻轉後形成五連。',lines};
    if(board.every(Boolean)){let n=0,m=0;for(const p of board){if(p===1)n++;else if(p===2)m++;}return {winner:n===m?0:n>m?1:2,reason:`滿盤無五連：朱子 ${n} 枚，青子 ${m} 枚。`,lines};}
    return null;
  }
  const legalMoves=board=>board.reduce((out,p,i)=>{if(!p)out.push(i);return out;},[]);
  function evaluate(board,player,profile) {
    const weight=[0,1,9,70,850,50000];let value=0;
    for(const segment of SEGMENTS){let own=0,other=0,dead=false;for(const i of segment){if(board[i]===ROCK){dead=true;break;}if(board[i]===player)own++;else if(board[i])other++;}if(dead)continue;if(!other)value+=weight[own];if(!own)value-=weight[other]*1.15;}
    if(profile==='flipper')for(const p of board)value+=p===player?9:p===3-player?-9:0;
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

  // ---- Variants: deterministic opening layouts (seeded, point-symmetric so neither side is favoured) ----
  function rng(seed){let x=(seed>>>0)||0x9e3779b9;return()=>{x^=x<<13;x>>>=0;x^=x>>>17;x^=x<<5;x>>>=0;return x/4294967296;};}
  const CENTER=40,mirror=i=>80-i;
  // Rocks: `count` neutral stones (even), in mirrored pairs, never on the centre and never touching each other.
  function rockLayout(seed,count=6){
    const rand=rng(seed^0x51ed),board=Array(81).fill(0),out=[];
    const near=(a,b)=>Math.abs(Math.floor(a/9)-Math.floor(b/9))<=1&&Math.abs(a%9-b%9)<=1;
    for(let guard=0;out.length<count&&guard<500;guard++){
      const i=Math.floor(rand()*81),j=mirror(i);
      if(i===CENTER||board[i]||out.some(k=>near(k,i)||near(k,j))||near(i,j))continue;
      board[i]=board[j]=ROCK;out.push(i,j);
    }
    return out.sort((a,b)=>a-b);
  }
  // Scatter: `pairs` stones each, the AI's stone mirrors yours, kept off rocks and apart from one another.
  function scatterLayout(seed,pairs=2,blocked=[]){
    const rand=rng(seed^0xa11ce),used=new Set(blocked),out={1:[],2:[]};
    const far=(a,b)=>Math.max(Math.abs(Math.floor(a/9)-Math.floor(b/9)),Math.abs(a%9-b%9))>=2;
    const all=()=>[...out[1],...out[2]];
    for(let guard=0;out[1].length<pairs&&guard<500;guard++){
      const i=Math.floor(rand()*81),j=mirror(i);
      if(i===CENTER||used.has(i)||used.has(j)||!all().every(k=>far(k,i)&&far(k,j))||!far(i,j))continue;
      out[1].push(i);out[2].push(j);used.add(i);used.add(j);
    }
    return out;
  }
  // Build a starting board. With no variant options this is the classic empty board.
  function setupBoard(options={}){
    const board=Array(81).fill(0),seed=(options.seed>>>0)||0,rocks=options.rocks?rockLayout(seed,options.rockCount||6):[];
    for(const i of rocks)board[i]=ROCK;
    if(options.scatter){const s=scatterLayout(seed,options.scatterPairs||2,rocks);for(const i of s[1])board[i]=1;for(const i of s[2])board[i]=2;}
    return board;
  }

  // ---- Tactical puzzles (殘局). You are side 1. Every position is checked by tests/flip-five.test.cjs. ----
  // goal.type 'win': connect five within goal.moves of your own placements; 'survive': still alive after
  // goal.moves AI replies. aiFirst: the AI (side 2) moves before you. line: replayed from the empty board.
  const PUZZLES=Object.freeze([
    {id:'cap-1',chapter:1,title:'斜線收網',brief:'一手內連五。三枚青子夾在你的斜線中間。',goal:{type:'win',moves:1},board:'000100002001000000200000000010000000002001000000200000000021200000000000000000000',hint:'從對角另一端落子，三子一起翻面。'},
    {id:'cap-2',chapter:1,title:'隔子翻線',brief:'一手內連五。真正的連線藏在對手的棋子底下。',goal:{type:'win',moves:1},board:'020000000000000000000000000020000001000020001000200001002000000010000000200000001',hint:'找一條兩端都是你、中間全是青子的線。'},
    {id:'def-1',chapter:2,title:'四子臨門',brief:'AI 下一手就要連五。只有一個位置救得了你。',goal:{type:'survive',moves:1},board:'000000000000200000001000000202220000000010000000101000000000000000000000000000000',hint:'封點以外，夾翻也能拆線。'},
    {id:'def-2',chapter:2,title:'雙線危機',brief:'兩條即勝線同時壓過來，找出唯一的解圍點。',goal:{type:'survive',moves:1},board:'000000000000010020000000000020100000021010000020000000120000000000000000000000000',hint:'一手同時封住或翻掉兩條線。'},
    {id:'def-3',chapter:2,title:'斜向救援',brief:'定式 E5 E4 E3 D5 E2：唯一不立即輸的應手只有一個。',goal:{type:'survive',moves:1},line:'E5 E4 E3 D5 E2',first:2,hint:'看斜線：翻回被吃掉的那一子。'},
    {id:'two-1',chapter:3,title:'頂線雙殺',brief:'兩手內連五。AI 會用大師級搜尋防守。',goal:{type:'win',moves:2},board:'002011100000000001000020220100000000000000000000000000000000000000020000000000000',hint:'在第一列造出兩個收尾點。'},
    {id:'two-2',chapter:3,title:'三角支點',brief:'兩手內連五。一手棋同時架起兩條線。',goal:{type:'win',moves:2},board:'000000000200010000100110010000000000020000000000000000000000000002220000000000000',hint:'第三列已有三子，缺口在哪？'},
    {id:'two-3',chapter:3,title:'底線伏兵',brief:'兩手內連五。底部的三枚青子是你的機會。',goal:{type:'win',moves:2},board:'000000000000000000000100000000000000002100000000100000002220000000000102000000010',hint:'先讓翻轉與連線同時成立。'},
    {id:'cert-1',chapter:4,title:'E7 之後',brief:'已證明的殺局：AI 先應，不論落在哪裡，你都能一手連五。',goal:{type:'win',moves:1},line:'E5 E4 E3 E7 E2',first:1,aiFirst:true,hint:'E 列與它的翻轉回收。'},
    {id:'cert-2',chapter:4,title:'鄰接之罰',brief:'E5 E4 E3 已被完整證明為先手必勝。AI 先應，四手內拿下。',goal:{type:'win',moves:4},line:'E5 E4 E3',first:1,aiFirst:true,hint:'沿 E 列與周邊斜線持續製造雙重威脅。'}
  ]);
  // Returns {board, toMove} for a puzzle. Lines are replayed through the rules, so flips are real.
  function puzzlePosition(p){
    if(p.board){const board=Array.from(p.board,Number);return {board,toMove:p.aiFirst?2:1};}
    let board=Array(81).fill(0),player=p.first||1;
    for(const name of p.line.split(/\s+/)){const move=apply(board,cellOf(name),player);if(!move)throw new Error('bad puzzle line '+p.id);board=move.board;player=3-player;}
    return {board,toMove:player};
  }

  class Game {
    constructor(profile='architect',first=1){this.profile=profile;this.setup=null;this.reset(first);}
    // setup: {board, goal} or null. Classic games use null, so reset() restores the empty board.
    configure(setup=null){this.setup=setup?{board:setup.board?Array.from(setup.board):null,goal:setup.goal?{...setup.goal}:null}:null;}
    reset(first=1){this.board=this.setup&&this.setup.board?this.setup.board.slice():Array(SIZE*SIZE).fill(0);this.turn=first;this.first=first;this.ply=0;this.phase='ready';this.result=null;this.last=null;this.goal=this.setup&&this.setup.goal?{...this.setup.goal,player:1,used:0}:null;}
    start(){if(this.phase==='ready'||this.phase==='paused')this.phase='running';}
    pause(){if(this.phase==='running')this.phase='paused';}
    observation(player=this.turn){return {board:this.board.slice(),player,profile:this.profile};}
    act(cell,reason=''){
      if(this.phase!=='running')return false;const move=apply(this.board,cell,this.turn);if(!move)return false;
      this.last={cell,player:this.turn,flipped:move.flipped,reason};this.board=move.board;this.ply++;this.result=outcome(this.board);
      if(this.goal)this.checkGoal();
      if(this.result)this.phase='over';else this.turn=3-this.turn;return true;
    }
    // Puzzle goals end the game early; an ordinary outcome still decides when it happens first.
    checkGoal(){
      const g=this.goal,mover=this.last.player;
      if(g.type==='win'&&mover===g.player)g.used++;
      if(g.type==='survive'&&mover!==g.player)g.used++;
      if(this.result){this.result.puzzle=this.result.winner===g.player?'solved':'failed';return;}
      if(g.used<g.moves)return;
      const empty=[[],[],[]];
      if(g.type==='win')this.result={winner:3-g.player,reason:`${g.moves} 手內沒有連成五子。`,lines:empty,puzzle:'failed'};
      else this.result={winner:g.player,reason:`守住了：撐過 ${g.moves} 次 AI 應手。`,lines:empty,puzzle:'solved'};
    }
  }
  return {Game,SIZE,ROCK,DIRS,SEGMENTS,coord,cellOf,flips,apply,winningLines,outcome,legalMoves,evaluate,immediateWins,chooseMove,chooseLegacyMove:chooseMove,rockLayout,scatterLayout,setupBoard,PUZZLES,puzzlePosition};
});
