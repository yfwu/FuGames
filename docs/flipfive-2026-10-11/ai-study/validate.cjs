'use strict';
const {execFileSync}=require('node:child_process'),fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const engine=fs.readFileSync(__dirname+'/baseline-engine.js','utf8');const F=vm.runInNewContext(engine+';FlipFive');
function transition(variant,b,p,c,pending=0,last=-1){const [board,winner,nextPending,flips]=execFileSync(__dirname+'/evaluate',[variant,'transition',b.join(''),String(p),String(c),String(pending),String(last)],{encoding:'utf8'}).trim().split(' ');return{board:Array.from(board,Number),winner:Number(winner),pending:Number(nextPending),flips:Number(flips)};}
let seed=1592594996;function random(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;}
let checked=0;for(let game=0;game<12;game++){let b=Array(81).fill(0),p=game%2+1;for(let move=0;move<35;move++){const legal=F.legalMoves(b),c=legal[Math.floor(random()*legal.length)],reference=F.apply(b,c,p),actual=transition('baseline',b,p,c);assert.deepEqual(actual.board,Array.from(reference.board));assert.equal(actual.flips,reference.flipped.length);assert.equal(actual.winner,F.outcome(reference.board)?.winner??-1);checked++;b=reference.board;if(F.outcome(b))break;p=3-p;}}
const row=Array(81).fill(0);for(const c of [2,3,4])row[36+c]=1;row[41]=2;
assert.equal(transition('baseline',row,1,42).winner,1);
const grace=transition('capture-grace',row,1,42);assert.equal(grace.winner,-1);assert.equal(grace.pending,1);assert.equal(transition('capture-grace',grace.board,2,0,grace.pending,42).winner,1);
const counter=row.slice();counter[43]=2;const pending=transition('capture-grace',counter,1,42);const broken=transition('capture-grace',pending.board,2,37,pending.pending,42);assert.equal(broken.board.slice(37,44).every(x=>x===2),true);assert.equal(broken.winner,-1);assert.equal(broken.pending,2);
const direct=Array(81).fill(0);for(const c of [2,3,4,5])direct[36+c]=1;assert.equal(transition('capture-grace',direct,1,42).winner,1);assert.equal(transition('hold-five',direct,1,42).pending,1);assert.equal(transition('hold-five',direct,1,42).winner,-1);
const shield=transition('shield',row,1,42,0,41);assert.equal(shield.board[41],2);assert.equal(shield.winner,-1);
console.log(JSON.stringify({ok:true,baselineTransitionsCompared:checked,fixtures:['block-converts-to-five','capture-five-grace','unbroken-five-qualifies-after-reply','bracket-can-break-pending-five','direct-five-immediate-with-capture-grace','all-five-delayed-with-hold-five','last-placement-shield']},null,2));
