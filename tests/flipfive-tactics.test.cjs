'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {F,coord}=require('../docs/flipfive-2026-10-11/load-engine.cjs');
const AI=require('../flip-five-ai.js');
const cell=s=>(Number(s.slice(1))-1)*9+s.charCodeAt(0)-65;
const play=line=>{let board=Array(81).fill(0),turn=1;for(const s of line.split(' ')){assert.equal(F.outcome(board),null);const m=F.apply(board,cell(s),turn);assert.ok(m);board=Array.from(m.board);turn=3-turn;}return {board,turn};};
const transform=(i,t)=>{let r=Math.floor(i/9),c=i%9;if(t&4)c=8-c;for(let k=0;k<(t&3);k++){[r,c]=[c,8-r];}return r*9+c;};
test('certificate covers all 76 legal replies in the conditional E7 losing line',()=>{
 const certificate=require('../docs/flipfive-2026-10-11/e7-win-certificate.json'),{board}=play(certificate.premise);
 assert.deepEqual(certificate.replies.map(x=>cell(x.defense)).sort((a,b)=>a-b),Array.from(F.legalMoves(board)));
 for(const x of certificate.replies){const reply=F.apply(board,cell(x.defense),2);assert.ok(reply);assert.equal(F.outcome(reply.board),null);const win=F.apply(reply.board,cell(x.winningReply),1);assert.ok(win);assert.equal(F.outcome(win.board).winner,1);}
});
test('D5 survives the short horizon: all 77 fifth-move attempts have a reply denying ply7',()=>{
 const certificate=require('../docs/flipfive-2026-10-11/d5-refutation-certificate.json'),{board}=play(certificate.premise);
 assert.deepEqual(certificate.defenses.map(x=>cell(x.attack)).sort((a,b)=>a-b),Array.from(F.legalMoves(board)));
 for(const x of certificate.defenses){const attack=F.apply(board,cell(x.attack),1);assert.ok(attack);assert.equal(F.outcome(attack.board),null);const reply=F.apply(attack.board,cell(x.defense),2);assert.ok(reply);assert.notEqual(F.outcome(reply.board)?.winner,1);assert.equal(F.immediateWins(reply.board,1).length,0);}
});
test('F3 is the unique immediate defense; the plausible F5 allows winning recapture',()=>{
 const {board}=play('E5 E4 E3 D5 E2');const safe=Array.from(F.legalMoves(board)).filter(i=>!F.immediateWins(F.apply(board,i,2).board,1).length);assert.deepEqual(safe,[cell('F3')]);
 const m=F.apply(board,cell('F3'),2);assert.deepEqual(Array.from(m.flipped),[cell('E4')]);
 const falseDefense=F.apply(board,cell('F5'),2),punish=F.apply(falseDefense.board,cell('E6'),1);assert.equal(F.outcome(punish.board).winner,1);
});
test('AI finds the unique capture defense under all board symmetries and either color',()=>{
 const fixture=play('E5 E4 E3 D5 E2').board;
 for(let t=0;t<8;t++)for(const swap of [false,true]){const b=Array(81).fill(0);fixture.forEach((p,i)=>b[transform(i,t)]=p&&swap?3-p:p);const defender=swap?1:2,attacker=3-defender;const safe=Array.from(F.legalMoves(b)).filter(i=>!F.immediateWins(F.apply(b,i,defender).board,attacker).length);assert.deepEqual(safe,[transform(cell('F3'),t)]);const choice=AI.chooseMove({board:b,player:defender,profile:'architect'},{seed:31,nodeBudget:36000,maxDepth:4});assert.equal(choice.cell,safe[0]);assert.ok(choice.stats.nodes<=36000);}
});
test('AI prolongs the already-lost triple instead of allowing the earliest forced loss',()=>{
 const {board}=play('E5 E4 E3'),safe=['D3','F3','D4','F4','D5','F5'].map(cell);
 for(const profile of ['architect','flipper']){const choice=AI.chooseMove({board,player:2,profile},{seed:17,nodeBudget:36000,maxDepth:4});assert.ok(safe.includes(choice.cell),`${profile} chose ${coord(choice.cell)}; stats=${JSON.stringify(choice.stats)}`);assert.ok(choice.stats.nodes<=36000);}
});
test('AI avoids the certified orthogonally adjacent reply to an opening E5',()=>{
 const {board}=play('E5'),losingAdjacent=['E4','D5','F5','E6'].map(cell);
 for(const seed of [0,17,871])for(const profile of ['architect','flipper']){const choice=AI.chooseMove({board,player:2,profile},{seed,nodeBudget:36000,maxDepth:4});assert.ok(!losingAdjacent.includes(choice.cell),`${profile}, seed ${seed} chose certified losing ${coord(choice.cell)}`);assert.ok(choice.stats.nodes<=36000);}
});
