'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {F,source,sourceSha256}=require('./load-engine.cjs');
const aiPath=path.resolve(__dirname,'../../flip-five-ai.js'),AI=require(aiPath),T=AI._testing;
let randomState=0x51636d27;const random=()=>{randomState^=randomState<<13;randomState^=randomState>>>17;randomState^=randomState<<5;return randomState>>>0;};
let sampledBoards=0,transitions=0,winningProbes=0;
function compare(board,player){
 const state=T.state(board),before=JSON.stringify(state),ctx={nodes:0,tacticalChecks:0};
 for(const cell of F.legalMoves(board)){const expected=F.apply(board,cell,player),result=F.outcome(expected.board),actual=T.apply(state,cell,player);assert.equal(Array.from(actual.board).join(''),expected.board.join(''));assert.equal(actual.winner,result?result.winner:-1);assert.equal(actual.count1,expected.board.filter(p=>p===1).length);assert.equal(actual.empty,expected.board.filter(p=>p===0).length);assert.equal(actual.flips,expected.flipped.length);transitions++;const wins=T.winningMove(state,cell,player,ctx);assert.equal(wins,!!result&&result.winner===player);assert.equal(JSON.stringify(state),before,'hypothetical winning probe must restore complete state');winningProbes++;}
 sampledBoards++;
}
for(let game=0;game<16;game++){let board=Array(81).fill(0),player=1;for(let ply=0;ply<30&&!F.outcome(board);ply++){if(ply%5===0)compare(board,player);const legal=F.legalMoves(board);board=Array.from(F.apply(board,legal[random()%legal.length],player).board);player=3-player;}}
const both=Array(81).fill(0);for(let c=0;c<5;c++){both[c]=1;both[72+c]=2;}assert.equal(T.state(both).winner,0);assert.equal(AI.chooseMove({board:both,player:1}),null);
const full=Array.from({length:81},(_,i)=>((Math.floor(i/9)+Math.floor(i%9/2))%2)+1);assert.equal(F.outcome(full).winner,1);assert.equal(T.state(full).winner,1);for(const c of [0,1,40,80]){const almost=full.slice();almost[c]=0;if(!F.outcome(almost)){compare(almost,1);compare(almost,2);}}
console.log(JSON.stringify({seed:'0x51636d27',sampledBoards,transitions,winningProbes,terminalDrawChecked:true,fullBoardMajorityChecked:true,probeRestorationChecked:true,productionEngine:source,engineSha256:sourceSha256,aiSha256:crypto.createHash('sha256').update(fs.readFileSync(aiPath)).digest('hex'),valid:true},null,2));
