'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../rummikub.html'), 'utf8');
const script = id => html.match(new RegExp(`<script id="${id}">([\\s\\S]*?)<\\/script>`))[1];
const context = {module:{exports:{}}, performance};
vm.runInNewContext(script('rummikub-engine'), context);
const E = context.module.exports;
const C = vm.runInNewContext(script('rummikub-career') + ';RummiCareer;');
const tile = (c,n,copy=0) => E.deck().find(t=>t.c===c&&t.n===n&&t.id%2===copy);
const run = (c,ns)=>ns.map(n=>tile(c,n));
const J = {id:104,j:true};

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

// ---------- rule variants (defaults equal the classic rules above) ----------
test('rule defaults are the classic table and invalid choices fall back to them',()=>{
 assert.deepEqual({...E.RULES},{opening:30,hand:14,timer:0,series:1});
 assert.deepEqual({...E.newGame().rules},{...E.RULES});
 assert.deepEqual({...E.normalizeRules({opening:45,hand:9,timer:5,series:2})},{...E.RULES});
 assert.deepEqual({...E.rulesOf({})},{...E.RULES},'old saves without rules read as classic');
 const old=E.newGame();delete old.rules;delete old.stats;assert.ok(E.audit(old),'saves from the previous version still load');
 const bad=E.newGame();bad.rules={opening:31,hand:14,timer:0,series:1};assert.equal(E.audit(bad),false);
});
test('opening threshold variant: 20 and 50 points',()=>{
 const meld20=run(0,[6,7,8]),meld27=run(1,[8,9,10]);
 assert.equal(E.checkMove([],meld20,false,[meld20],[]).ok,false);
 assert.ok(E.checkMove([],meld20,false,[meld20],[],20).ok);
 assert.ok(E.checkMove([],meld27,false,[meld27],[]).ok===false);
 const big=run(2,[11,12,13]),v50=E.checkMove([],big,false,[big],[],50);assert.equal(v50.ok,false);assert.match(v50.error,/還需要 14 點/);
 const two=big.concat(run(3,[5,6,7]));assert.ok(E.checkMove([],two,false,[big,run(3,[5,6,7])],[],50).ok);
 const s=E.solve({board:[],rack:meld20,opened:false,budget:30,opening:20});assert.equal(s.played,3);
 assert.equal(E.solve({board:[],rack:meld20,opened:false,budget:30}).played,0);
});
test('quick-hand variant deals 10 tiles and keeps every tile accounted for',()=>{
 const g=E.newGame({hand:10});assert.ok(g.racks.every(r=>r.length===10));assert.equal(g.pool.length,66);assert.ok(E.audit(g));
});
test('penalty draw takes up to three tiles, ends the turn and respects an almost-empty pool',()=>{
 const g=E.newGame({timer:60});g.turn=0;const before=g.racks[0].length;
 const r=E.drawTurn(g,E.PENALTY_DRAW);assert.equal(r.count,3);assert.equal(g.racks[0].length,before+3);assert.equal(g.turn,1);assert.ok(E.audit(g));
 const h=E.newGame();h.turn=2;h.racks[0].push(...h.pool.splice(0,h.pool.length-2));
 assert.equal(E.drawTurn(h,3).count,2);assert.equal(h.pool.length,0);assert.equal(E.drawTurn(h,9).drawn,false);
 assert.equal(E.newGame().pool.length-1,(()=>{const k=E.newGame();E.drawTurn(k,0);return k.pool.length;})(),'count below 1 still draws one');
});
test('series variant carries zero-sum totals into the next game and names the leader',()=>{
 const g=E.newGame({series:3});assert.deepEqual({...g.series,totals:[...g.series.totals]},{games:3,index:1,totals:[0,0,0,0]});assert.ok(E.audit(g));
 g.pool.push(...g.racks[1].splice(0));E.settleGame(g,1);assert.ok(E.audit(g));assert.equal(E.seriesOver(g),false);
 const t1=[...g.series.totals];assert.ok(t1[1]>0);assert.equal(Math.abs(t1.reduce((a,b)=>a+b,0))<1e-9,true);
 g.difficulty='casual';const g2=E.nextRound(g);assert.equal(g2.series.index,2);assert.deepEqual([...g2.series.totals],t1);assert.equal(g2.difficulty,'casual');assert.equal(g2.finished,false);assert.ok(E.audit(g2));
 g2.pool.push(...g2.racks[2].splice(0));E.settleGame(g2,2);const g3=E.nextRound(g2);g3.pool.push(...g3.racks[1].splice(0));E.settleGame(g3,1);
 assert.ok(E.seriesOver(g3));assert.throws(()=>E.nextRound(g3));assert.deepEqual([...E.seriesLeaders(g3)],[1]);
 const single=E.newGame();assert.equal(single.series,undefined);assert.ok(E.seriesOver(Object.assign(single,{finished:true})));
 const broken=E.newGame({series:3});broken.series.totals=[5,0,0,0];assert.equal(E.audit(broken),false);
});
test('rearrangement detection: merges and splits count, extensions and fresh melds do not',()=>{
 const a=run(0,[3,4,5,6]),b=run(1,[7,8,9]);
 assert.equal(E.isRearrangement([a,b],[a.concat(tile(0,7)),b]),false);
 assert.equal(E.isRearrangement([a,b],[a,b,run(2,[1,2,3])]),false);
 assert.equal(E.isRearrangement([a],[a.slice(0,3),[a[3],tile(0,7),tile(0,8)]]),true,'split');
 const g=[tile(0,9),tile(2,9),tile(3,9)];assert.equal(E.isRearrangement([b,g],[[b[2],...g],[b[0],b[1],tile(1,6)]]),true,'merge');
});
test('AI tiers keep the original budgets; novice never touches the table, casual extends without splitting',()=>{
 assert.deepEqual(['strong','expert','ultimate'].map(k=>E.AI_TIERS[k].budget),[700,2500,8000]);
 assert.ok(E.AI_TIERS.novice.budget<E.AI_TIERS.casual.budget&&E.AI_TIERS.casual.budget<700);
 const board=[run(1,[9,10,11])],rack=[tile(1,12),tile(0,1),tile(2,5)];
 const novice=E.solve({board,rack,opened:true,budget:40,style:'simple'});assert.equal(novice.played,0);
 const casual=E.solve({board,rack,opened:true,budget:40,style:'extend'});assert.equal(casual.played,1);assert.ok(E.checkMove(board,rack,true,casual.board,casual.rack).ok);
 // Needs a split: 4 5 6 7 8 of blue + own 6 → [4 5 6] [6 7 8].
 const long=[run(1,[4,5,6,7,8])],own=[tile(1,6,1)];
 assert.equal(E.solve({board:long,rack:own,opened:true,budget:200,style:'extend'}).played,0);
 const full=E.solve({board:long,rack:own,opened:true,budget:400,style:'full'});assert.equal(full.played,1);assert.ok(E.checkMove(long,own,true,full.board,full.rack).ok);
 const hand=run(3,[2,3,4]).concat(tile(0,13));const nv=E.solve({board,rack:hand,opened:true,budget:40,style:'simple'});assert.equal(nv.played,3);assert.ok(E.checkMove(board,hand,true,nv.board,nv.rack).ok);
 assert.equal(E.solve({board:[],rack:[tile(2,10),tile(2,11),J],opened:false,budget:40,style:'simple'}).played,3,'novice still opens from its hand');
});

// ---------- career progression ----------
test('career levels: thresholds, ranks and cap',()=>{
 assert.equal(C.levelOf(0).level,1);assert.equal(C.levelOf(139).level,1);assert.equal(C.levelOf(140).level,2);assert.equal(C.levelOf(140+180).level,3);
 const l=C.levelOf(150);assert.equal(l.into,10);assert.equal(l.need,180);
 assert.equal(C.levelOf(1e9).level,C.MAX_LEVEL);assert.ok(C.levelOf(1e9).max);
 assert.equal(C.rankOf(1),'見習牌手');assert.equal(C.rankOf(8),'組牌好手');assert.equal(C.rankOf(30),'拉密名人');
});
test('career XP: lines, tier and variant multipliers, hint penalty floor',()=>{
 const base={tier:'expert',rules:{opening:30,hand:14,timer:0,series:1},outcome:'win',emptied:true,played:14,rearranges:2,score:120,openTurn:2,hints:0,turns:8};
 const x=C.matchXP(base);const total=25+28+16+15+120+30+24;assert.equal(x.base,total);assert.equal(x.mult,1);assert.equal(x.total,total);
 assert.equal(C.matchXP({...base,tier:'ultimate'}).mult,1.3);assert.equal(C.matchXP({...base,tier:'novice'}).mult,.5);
 assert.equal(C.multiplier({tier:'expert',rules:{opening:50,timer:30,hand:14}}),1.32);
 assert.equal(C.multiplier({tier:'expert',rules:{opening:20,hand:10}}),.77);
 assert.equal(C.multiplier({tier:'expert',rules:{},hints:2}),.84);assert.equal(C.multiplier({tier:'expert',rules:{},hints:50}),.6);
 const loss=C.matchXP({...base,outcome:'loss',emptied:false,score:-40,played:200,rearranges:20,openTurn:5});
 assert.deepEqual([...loss.lines.map(l=>l[1])],[25,60,40]);
 assert.ok(C.matchXP({...base,seriesChampion:true}).lines.some(l=>l[0]==='系列賽冠軍'&&l[1]===100));
});
test('career record: stats, streaks, unlocks and tolerant loading',()=>{
 const s={tier:'strong',rules:{opening:30,hand:14,timer:0,series:1},outcome:'win',emptied:true,played:14,rearranges:1,score:90,openTurn:1,hints:0,turns:9};
 let r=C.record(C.blank(),s);assert.equal(r.profile.games,1);assert.equal(r.profile.wins,1);assert.equal(r.profile.streak,1);assert.equal(r.profile.fastestWin,9);assert.equal(r.profile.bestTier,2);
 assert.ok(r.after.level>=2);assert.ok(r.unlocked.some(u=>u.kind==='opening'&&u.id===50));
 r=C.record(r.profile,{...s,turns:6,tier:'novice'});assert.equal(r.profile.fastestWin,6);assert.equal(r.profile.bestTier,2);assert.equal(r.profile.bestStreak,2);
 r=C.record(r.profile,{...s,outcome:'loss',emptied:false,score:-30});assert.equal(r.profile.streak,0);assert.equal(r.profile.bestStreak,2);assert.equal(r.profile.bestScore,90);
 assert.equal(C.unlocked(1,'opening',30),true);assert.equal(C.unlocked(1,'opening',50),false);assert.equal(C.unlocked(2,'opening',50),true);assert.equal(C.unlocked(1,'theme','ink'),true);
 assert.equal(C.unlockLevel('series',5),9);
 const mem=new Map(),storage={getItem:k=>mem.get(k)??null,setItem:(k,v)=>mem.set(k,v)};
 assert.deepEqual(C.load(storage),C.blank());storage.setItem(C.KEY,'{bad');assert.deepEqual(C.load(storage),C.blank());
 assert.ok(C.save(storage,{...r.profile,xp:-5,wins:'x'}));const back=C.load(storage);assert.equal(back.xp,0);assert.equal(back.wins,0);assert.equal(back.games,3);
});

// ---------- page shell ----------
test('page uses the shared Vermilion Ink full-screen shell, local three.js and keeps the save key',()=>{
 assert.match(html,/<link rel="stylesheet" href="shared\/fu\.css">/);assert.match(html,/<body class="fu-app[^"]*">/);
 assert.doesNotMatch(html,/fulab-theme\.css|class="[^"]*play-panel|<details class="card rules/);
 assert.match(html,/class="fu-brand" href="index\.html"[\s\S]*?class="fu-seal"/);
 assert.match(html,/from '\.\/shared\/fu-three\.js'/);assert.doesNotMatch(html,/https?:\/\/(?!rummikub\.com)/);assert.doesNotMatch(html,/\bfetch\(/);
 assert.match(script('rummikub-ui'),/STORE='fulab-rummikub-v2-four'/);
 for(const id of ['menu','lobby','resultDialog','board','rack','commitBtn','drawBtn','hintBtn','undoBtn'])assert.match(html,new RegExp(`id="${id}"`));
});
