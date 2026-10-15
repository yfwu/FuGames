'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../rummikub.html'), 'utf8');
const context = {module:{exports:{}}, performance};
vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
const E = context.module.exports;
const tile = (c,n,copy=0) => E.deck().find(t=>t.c===c&&t.n===n&&t.id%2===copy);
const run = (c,ns)=>ns.map(n=>tile(c,n));

test('four seats start with 14 tiles each and conserve 106 distinct physical tiles',()=>{
 const g=E.newGame();assert.equal(g.pool.length,50);assert.ok(g.racks.every(r=>r.length===14));assert.ok(E.audit(g));
 g.racks[0][0]=g.racks[1][0];assert.equal(E.audit(g),false);
});
test('runs, groups and jokers validate without wrapping or repeated colours',()=>{
 assert.ok(E.meld(run(0,[4,5,6])).ok);
 assert.ok(E.meld([tile(0,7),tile(1,7),tile(2,7)]).ok);
 assert.equal(E.meld([tile(0,7),tile(0,7,1),tile(2,7)]).ok,false);
 assert.equal(E.meld(run(0,[12,13,1])).ok,false);
 const m=E.meld([tile(1,9),tile(1,11),{id:104,j:true}]);assert.ok(m.ok);assert.equal(m.points,30);
});
test('opening needs 30 own points and cannot modify existing public melds',()=>{
 const low=run(0,[8,9,10]),high=run(1,[9,10,11]);
 assert.equal(E.checkMove([],low,false,[low],[]).ok,false);
 assert.ok(E.checkMove([],high,false,[high],[]).ok);
 const board=[run(0,[9,10,11])],extra=tile(0,12);
 assert.equal(E.checkMove(board,[extra],false,[board[0].concat(extra)],[]).ok,false);
 assert.ok(E.checkMove(board,[extra],true,[board[0].concat(extra)],[]).ok);
});
test('rearrangement cannot lose, duplicate or take public tiles back',()=>{
 const b=[run(0,[9,10,11])],r=[tile(0,12)];
 assert.equal(E.checkMove(b,r,true,b,[]).ok,false);
 assert.equal(E.checkMove(b,r,true,[b[0].concat(r,r)],[]).ok,false);
 assert.equal(E.checkMove(b,r,true,[[...b[0].slice(1),...r]],[b[0][0]]).ok,false);
});
test('draw advances all four seats, and four empty-pool passes settle with zero-sum scores',()=>{
 const g=E.newGame();g.turn=0;
 for(let i=0;i<4;i++){assert.equal(E.drawTurn(g).player,i);assert.ok(E.audit(g));}
 assert.equal(g.turn,0);g.racks[0].push(...g.pool.splice(0));
 for(let i=0;i<4;i++)E.drawTurn(g);
 assert.ok(g.finished);assert.ok(E.audit(g));assert.equal(g.result.scores.reduce((a,b)=>a+b,0),0);
});
test('small bounded AI search returns a legal 30-point opening and public extension',()=>{
 for(const input of [{board:[],rack:run(1,[9,10,11]),opened:false},{board:[run(1,[9,10,11])],rack:[tile(1,12)],opened:true}]){
  const s=E.solve({...input,budget:30});assert.ok(s.played>0);assert.ok(E.checkMove(input.board,input.rack,input.opened,s.board,s.rack).ok);
 }
});
