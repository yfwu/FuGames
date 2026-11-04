'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../bridge-engine.js');
const AI = require('../bridge-ai.js');
const BB = require('../bridge-bidding.js');
const DDS = require('../bridge-dds.js');
const plain = v => JSON.parse(JSON.stringify(v));
const card = (s,r) => 'CDHS'.indexOf(s)*13+r-2;
const game = (seed=1,board=1) => B.createGame(B.makeDeal(seed),board);
function calls(g,seq) { for (const c of seq.split(' ')) assert.equal(B.applyCall(g,c), true, `illegal ${c}`); return g; }
const contract = (level,strain,multiplier=1) => ({level,strain:'CDHSN'.indexOf(strain),multiplier});

 test('deterministic immutable deals contain exactly 52 unique cards and clone for play', () => {
  const d=B.makeDeal(1234);assert.deepEqual(plain(d),plain(B.makeDeal(1234)));assert.notDeepEqual(plain(d),plain(B.makeDeal(1235)));
  assert.equal(new Set(d.flat()).size,52);d.forEach(h=>{assert.equal(h.length,13);assert.ok(Object.isFrozen(h));});assert.ok(Object.isFrozen(d));
  const g=B.createGame(d);g.hands[0].pop();assert.equal(d[0].length,13);
  assert.throws(()=>B.createGame([[1],[2],[3],[4]]));const invalid=plain(d);invalid[1][0]=invalid[0][0];assert.throws(()=>B.createGame(invalid));assert.throws(()=>B.createGame(d,0));
 });
 test('dealer rotates and all sixteen board vulnerabilities match the standard cycle',()=>{
  const expected=['none','NS','EW','both','NS','EW','both','none','EW','both','none','NS','both','none','NS','EW'];
  for(let i=1;i<=64;i++){const g=game(1,i);assert.equal(g.dealer,(i-1)%4);assert.equal(g.turn,g.dealer);assert.equal(g.vulnerability,expected[(i-1)%16]);}
 });
 test('all 35 bids are available initially, in strict clubs to NT and level order',()=>{
  const g=game(),legal=B.legalCalls(g);assert.equal(legal.length,36);assert.equal(legal[0],'P');assert.equal(legal[1],'1C');assert.equal(legal[35],'7N');
  for(let i=0;i<35;i++){const bid=legal[i+1];assert.equal(B.bidIndex(bid),i);assert.equal(B.applyCall(g,bid),true);const later=B.legalCalls(g).filter(B.isBid);assert.equal(later.length,34-i);assert.ok(later.every(c=>B.bidIndex(c)>i));}
  assert.deepEqual(plain(B.legalCalls(g)),['P','X']);
 });
 test('three initial passes do not end the auction; four passes yield score zero',()=>{
  const g=calls(game(),'P P P');assert.equal(g.phase,'auction');assert.equal(g.score,null);calls(g,'P');assert.equal(g.phase,'complete');assert.equal(g.score,0);assert.equal(g.contract,null);assert.equal(B.applyCall(g,'1C'),false);
 });
 test('three passes following a bid finish, with declarer the first partnership bidder of strain',()=>{
  const g=calls(game(),'1H P 2H P P P');assert.equal(g.phase,'play');assert.equal(g.contract.level,2);assert.equal(g.contract.declarer,0);assert.equal(g.contract.dummy,2);assert.equal(g.turn,1);assert.equal(g.dummyVisible,false);
  const nt=calls(game(),'1C P 1N P 3N P P P');assert.equal(nt.contract.declarer,2);assert.equal(nt.turn,3);
  const otherTeam=calls(game(),'1H 1S 2H 2S P P P');assert.equal(otherTeam.contract.declarer,1);assert.equal(otherTeam.contract.dummy,3);assert.equal(otherTeam.turn,2);
 });
 test('double/redouble are partnership-specific and can follow intervening passes',()=>{
  const g=calls(game(),'1H');assert.ok(B.legalCalls(g).includes('X'));assert.ok(!B.legalCalls(g).includes('XX'));calls(g,'P');assert.ok(!B.legalCalls(g).includes('X'));calls(g,'P X');assert.equal(g.passes,0);assert.equal(g.multiplier,2);assert.ok(B.legalCalls(g).includes('XX'));calls(g,'P');assert.ok(!B.legalCalls(g).includes('XX'));calls(g,'P XX');assert.equal(g.multiplier,4);assert.equal(g.passes,0);assert.ok(!B.legalCalls(g).includes('X'));calls(g,'P P P');assert.equal(g.contract.multiplier,4);
 });
 test('redouble after two passes stays legal; new bids clear all doubling and reset passes',()=>{
  const g=calls(game(),'1S X P P');assert.equal(g.passes,2);calls(g,'XX');assert.equal(g.passes,0);calls(g,'2C');assert.equal(g.multiplier,1);assert.equal(g.passes,0);assert.ok(B.legalCalls(g).includes('X'));
 });
 test('invalid calls never mutate the auction or turn',()=>{
  const g=game();for(const invalid of ['X','XX','0C','8N','1Z','1NT','',null,1]){const prior=JSON.stringify(g);assert.equal(B.applyCall(g,invalid),false);assert.equal(JSON.stringify(g),prior);}calls(g,'3H');for(const invalid of ['1S','3D','3H']){const prior=JSON.stringify(g);assert.equal(B.applyCall(g,invalid),false);assert.equal(JSON.stringify(g),prior);}
 });
 test('only opening lead reveals dummy, and no hidden hand appears in an auction or opening view',()=>{
  const g=calls(game(),'1N P P P');for(let s=0;s<4;s++){const v=B.viewFor(g,s);assert.deepEqual(Object.keys(v.knownHands),[String(s)]);assert.equal(v.dummyVisible,false);assert.ok(!('hands' in v));assert.ok(!('deal' in v));}
  const lead=B.legalCards(g)[0];B.playCard(g,lead);assert.equal(g.dummyVisible,true);
  for(let s=0;s<4;s++){const v=B.viewFor(g,s);assert.ok(String(g.contract.dummy) in v.knownHands);const permitted=new Set([s,g.contract.dummy,...(s===g.contract.dummy?[g.contract.declarer]:[])]);assert.ok(Object.keys(v.knownHands).every(k=>permitted.has(Number(k))));}
 });
 test('follow suit is mandatory, illegal discard does not mutate state, void permits trump/discard',()=>{
  const deal=[Array.from({length:13},(_,i)=>i),Array.from({length:13},(_,i)=>i+13),Array.from({length:13},(_,i)=>i+26),Array.from({length:13},(_,i)=>i+39)];const g=calls(B.createGame(deal),'1N P P P');B.playCard(g,card('D',2));assert.equal(g.turn,2);assert.equal(B.legalCards(g).length,13);B.playCard(g,card('H',2));assert.equal(g.voids[2][1],true);
  const h=calls(game(14),'1N P P P');let checked=false;for(const c of B.legalCards(h)){const s=B.suit(c),next=h.hands[2];if(next.some(x=>B.suit(x)===s)&&next.some(x=>B.suit(x)!==s)){B.playCard(h,c);const invalid=next.find(x=>B.suit(x)!==s),prior=JSON.stringify(h);assert.equal(B.playCard(h,invalid),false);assert.equal(JSON.stringify(h),prior);assert.ok(B.legalCards(h).every(x=>B.suit(x)===s));assert.equal(B.legalCards(h,3).length,0);checked=true;break;}}assert.ok(checked);
 });
 test('trick winner respects trump, led suit, ace high and unrelated discarded aces',()=>{
  const trick=[{seat:0,card:card('H',10)},{seat:1,card:card('H',14)},{seat:2,card:card('S',2)},{seat:3,card:card('C',14)}];assert.equal(B.winner(trick,3),2);assert.equal(B.winner(trick,4),1);trick[3].card=card('S',3);assert.equal(B.winner(trick,3),3);assert.equal(B.winner([],4),null);
 });
 test('winning seat leads next trick and exactly thirteen tricks score once',()=>{
  const g=calls(game(26),'1N P P P');while(g.phase==='play'){const before=g.history.length,d=B.chooseCard(B.viewFor(g));assert.ok(B.legalCards(g).includes(d.card));assert.equal(B.playCard(g,d.card),true);if(g.history.length>before&&g.phase==='play')assert.equal(g.turn,g.history.at(-1).winner);}
  assert.equal(g.history.length,13);assert.equal(g.played.length,52);assert.equal(new Set(g.played.map(p=>p.card)).size,52);assert.equal(g.tricks.reduce((a,b)=>a+b),13);assert.ok(g.hands.every(h=>h.length===0));const scored=g.score;assert.equal(B.playCard(g,0),false);assert.equal(g.score,scored);
 });
 const scoringFixtures=[
  [1,'N',1,7,false,90],[1,'N',2,7,false,180],[1,'N',4,7,false,560],
  [2,'H',2,8,false,470],[2,'H',2,9,false,570],[3,'N',1,10,false,430],
  [4,'S',1,10,true,620],[6,'N',1,12,true,1440],[7,'N',1,13,true,2220],
  [6,'N',1,12,false,990],[7,'N',1,13,false,1520],[2,'C',2,8,false,180],
  [2,'C',4,8,false,560],[1,'C',1,13,false,190],[3,'N',2,10,true,950]
 ];
 test('duplicate scoring matches contract, game, slam, overtrick and doubled game fixtures',()=>{
  for(const [l,s,m,t,v,expected] of scoringFixtures)assert.equal(B.scoreContract(contract(l,s,m),t,v),expected,`${l}${s} x${m}, ${t} tricks, vul=${v}`);
 });
 test('doubled/redoubled undertrick penalties follow both vulnerability schedules',()=>{
  for(const [v,penalties]of [[false,[100,300,500,800]],[true,[200,500,800,1100]]])for(let d=1;d<=4;d++){assert.equal(B.scoreContract(contract(4,'S',2),10-d,v),-penalties[d-1]);assert.equal(B.scoreContract(contract(4,'S',4),10-d,v),-2*penalties[d-1]);assert.equal(B.scoreContract(contract(4,'S'),10-d,v),-d*(v?100:50));}
  assert.equal(B.scoreContract(contract(7,'N',2),0,false),-3500);assert.equal(B.scoreContract(contract(7,'N',4),0,true),-7600);
 });
 test('game threshold excludes overtricks and includes contract multiplier',()=>{
  assert.equal(B.scoreContract(contract(1,'N'),13,false),270);assert.equal(B.scoreContract(contract(1,'N',2),7,false),180);assert.equal(B.scoreContract(contract(2,'H',2),8,false),470);assert.equal(B.scoreContract(contract(2,'C',2),9,false),280);
 });
 test('score validation rejects impossible contract states',()=>{
  for(const c of [contract(0,'S'),contract(8,'S'),{level:1,strain:5,multiplier:1},{level:1,strain:0,multiplier:3}])assert.throws(()=>B.scoreContract(c,7,false));assert.throws(()=>B.scoreContract(contract(1,'N'),14));assert.throws(()=>B.scoreContract(contract(1,'N'),-1));
 });
 test('matchpoint fixture uses unified score direction with half credit for ties',()=>{
  assert.equal(B.matchpoints(420,[-50,420,450]),50);assert.equal(B.matchpoints(10,[0,0]),100);assert.equal(B.matchpoints(-1,[0,0]),0);assert.equal(B.matchpoints(0,[0,0]),50);assert.equal(B.matchpoints(0,[]),null);
 });
 test('public views have detached arrays, preventing an AI from changing game state',()=>{
  const g=game(),before=JSON.stringify(g),v=B.viewFor(g);v.hand[0]=-1;v.knownHands[0][0]=-2;v.voids[0][0]=true;v.auction.push({seat:0,call:'7N'});assert.equal(JSON.stringify(g),before);
 });
 test('random legal auctions and play support contracts beyond AI bidding conventions',()=>{
  const random=B.rng(87654);for(let i=1;i<=80;i++){const g=game(i*23,i);let count=0;while(g.phase==='auction'){const legal=B.legalCalls(g),call=random()<.48?'P':legal[Math.floor(random()*legal.length)];assert.ok(B.applyCall(g,call));assert.ok(++count<400);}while(g.phase==='play'){const legal=B.legalCards(g);assert.ok(B.playCard(g,legal[Math.floor(random()*legal.length)]));}if(g.contract){assert.equal(g.history.length,13);assert.equal(g.hands.flat().length,0);assert.ok(Number.isFinite(g.score));}}
 });
