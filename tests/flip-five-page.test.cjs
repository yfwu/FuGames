'use strict';
// Full-screen Vermilion Ink shell and the FlipCareer progression module of flip_five.html.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'flip_five.html'),'utf8');
const C=vm.runInNewContext(html.match(/<script id="flip-career">([\s\S]*?)<\/script>/)[1]+';FlipCareer;');
const F=require('../flip-five-engine.js'),AI=require('../flip-five-ai.js');
// Objects made inside the vm context have another realm's prototypes; compare their JSON form.
const J=v=>JSON.parse(JSON.stringify(v));
const memory=()=>{const data={};return {getItem:k=>k in data?data[k]:null,setItem:(k,v)=>{data[k]=String(v);},data};};

test('page is a full-screen shared-shell game: fu.css, fu-app, topbar back to the portal, stage, HUD, dock, drawers, curtains',()=>{
  assert.match(html,/<link rel="stylesheet" href="shared\/fu\.css">/);assert.match(html,/<body class="fu-app[^"]*">/);
  assert.doesNotMatch(html,/fulab-theme\.css|class="card play-panel|<details class="card rules|site-nav|page-header/);
  assert.match(html,/<header class="fu-topbar">[\s\S]*?href="index\.html"[\s\S]*?class="fu-seal"[^>]*>福遊</);
  for(const id of ['stage','board','match-panel','pause','hint','restart','settings','rules','career','lobby','pause-curtain','result-curtain','result','play','personality','again'])assert.match(html,new RegExp(`id="${id}"`),id);
  assert.match(html,/<main class="fu-stage">/);assert.match(html,/class="fu-dock"/);assert.equal((html.match(/class="fu-hud /g)||[]).length,2);
});
test('everything is local: three.js through shared/fu-three.js, no network APIs or remote assets; every script compiles',()=>{
  assert.match(html,/from '\.\/shared\/fu-three\.js'/);assert.ok(fs.existsSync(path.join(root,'vendor','three','three.module.min.js')));
  assert.doesNotMatch(html,/https?:\/\/|fetch\(|WebSocket|XMLHttpRequest|@import/);
  for(const [,src] of html.matchAll(/<script src="([^"]+)"/g))assert.ok(fs.existsSync(path.join(root,src)),src);
  for(const [,attrs,body] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)){if(/src=/.test(attrs))continue;const code=/type="module"/.test(attrs)?'(async()=>{'+body.replace(/^import .*$/gm,'')+'\n})':body;assert.doesNotThrow(()=>new vm.Script(code));}
  for(const f of ['flip-five-engine.js','flip-five-ai.js','flip-five-ai-worker.js'])assert.doesNotMatch(fs.readFileSync(path.join(root,f),'utf8'),/https?:\/\/|fetch\(|WebSocket/);
});
test('page colours follow the shared palette: you are seal (side 1), the AI is azure (side 2)',()=>{
  assert.match(html,/--side:var\(--fu-side-1\)"><\/span><span>你/);assert.match(html,/--side:var\(--fu-side-2\)"><\/span>\s*<\/div>/);
  assert.match(html,/sealMat=new THREE\.MeshStandardMaterial\(\{color:palette\.seal/);assert.match(html,/azureMat=new THREE\.MeshStandardMaterial\(\{color:palette\.azure/);
  // No hand-picked hex colours anywhere: CSS uses --fu-* tokens, WebGL uses the shared palette.
  assert.doesNotMatch(html.replace('content="#07090c"',''),/#[0-9a-f]{6}\b/i);
});
test('UI tier ids match the AI tiers and the career tier table',()=>{
  assert.deepEqual(J(C.TIERS),[...AI.TIER_ORDER]);for(const t of AI.TIER_ORDER)assert.ok(C.TIER_XP[t]>0,t);
  for(let i=1;i<C.TIERS.length;i++)assert.ok(C.TIER_XP[C.TIERS[i]]>C.TIER_XP[C.TIERS[i-1]]);
});

test('levels: need() grows, levelOf() is monotone with exact boundaries, capped at MAX_LEVEL, garbage reads as 0',()=>{
  assert.equal(C.need(1),140);assert.equal(C.need(2),180);
  assert.deepEqual(J(C.levelOf(0)),{level:1,into:0,need:140,max:false});assert.equal(C.levelOf(139).level,1);assert.equal(C.levelOf(140).level,2);assert.equal(C.levelOf(140+180).level,3);assert.equal(C.levelOf(140+179).into,179);
  let last=1;for(let xp=0;xp<60000;xp+=97){const l=C.levelOf(xp).level;assert.ok(l>=last);last=l;}
  assert.equal(C.levelOf(1e9).level,C.MAX_LEVEL);assert.equal(C.levelOf(1e9).max,true);
  for(const bad of [-5,NaN,'x',null,undefined])assert.equal(C.levelOf(bad).level,1);
});
test('ranks and unlocks: go-style ranks by level; rocks Lv2, scatter Lv3, grand Lv4, finishes Lv5/Lv8',()=>{
  assert.equal(C.rankOf(1),'入門');assert.equal(C.rankOf(3),'九級');assert.equal(C.rankOf(9),'初段');assert.equal(C.rankOf(30),'九段');
  assert.equal(C.unlockLevel('variant','rocks'),2);assert.equal(C.unlockLevel('variant','scatter'),3);assert.equal(C.unlockLevel('tier','grand'),4);assert.equal(C.unlockLevel('skin','gold'),5);assert.equal(C.unlockLevel('skin','paper'),8);
  for(const t of ['novice','adept','expert','master'])assert.ok(C.unlocked(1,'tier',t),t);assert.ok(!C.unlocked(3,'tier','grand'));assert.ok(C.unlocked(4,'tier','grand'));
  assert.ok(!C.unlocked(1,'variant','rocks'));assert.ok(C.unlocked(2,'variant','rocks'));assert.ok(C.unlocked(1,'skin','ink'));
});
test('match XP: lines, tier multiplier, variant bonus, hint penalty floor and rounding',()=>{
  const win=C.matchXP({outcome:'win',tier:'master',flips:6,moves:10,hints:0});
  assert.deepEqual(J(win.lines.map(l=>l[1])),[10,60,12,20]);assert.equal(win.base,102);assert.equal(win.mult,1.4);assert.equal(win.total,143);
  const loss=C.matchXP({outcome:'loss',tier:'novice',flips:0,moves:30});assert.equal(loss.base,10);assert.equal(loss.total,4);
  assert.equal(C.matchXP({outcome:'draw',tier:'expert',flips:40,moves:40}).base,10+25+30);
  const both=C.matchXP({outcome:'win',tier:'expert',rocks:true,scatter:true,flips:0,moves:20});assert.equal(both.mult,1.3);assert.equal(both.total,Math.round(70*1.3));
  assert.equal(C.hintFactor(0),1);assert.equal(C.hintFactor(1),.8);assert.equal(C.hintFactor(9),.4);
  assert.equal(C.matchXP({outcome:'win',tier:'expert',flips:0,moves:20,hints:2}).total,Math.round(70*.6));
  assert.ok(C.matchXP({outcome:'win',tier:'grand',moves:20}).total>C.matchXP({outcome:'win',tier:'master',moves:20}).total);
});
test('record(): counts, streaks, best tier beaten and level-up unlock report',()=>{
  let p=C.blank();
  let r=C.record(p,{outcome:'win',tier:'grand',flips:10,moves:8});p=r.profile;assert.equal(p.games,1);assert.equal(p.wins,1);assert.equal(p.streak,1);assert.equal(p.bestTier,4);assert.equal(p.flips,10);assert.equal(r.before.level,1);
  r=C.record(p,{outcome:'win',tier:'novice',moves:30});p=r.profile;assert.equal(p.streak,2);assert.equal(p.bestStreak,2);assert.equal(p.bestTier,4);
  r=C.record(p,{outcome:'draw',tier:'master',moves:40});p=r.profile;assert.equal(p.streak,0);assert.equal(p.draws,1);assert.equal(p.bestStreak,2);
  r=C.record(p,{outcome:'loss',tier:'master',moves:40});p=r.profile;assert.equal(p.losses,1);assert.equal(p.games,4);
  const near=C.blank();near.xp=130;const up=C.record(near,{outcome:'win',tier:'master',moves:20});assert.equal(up.before.level,1);assert.equal(up.after.level,2);assert.deepEqual(J(up.unlocked.map(u=>u.id)),['rocks']);
  const big=C.blank();big.xp=139;const jump=C.record(big,{outcome:'win',tier:'grand',rocks:true,scatter:true,flips:30,moves:5});assert.ok(jump.after.level>=2);
  assert.equal(C.blank().xp,0);assert.notEqual(C.record(C.blank(),{outcome:'win',tier:'master'}).profile,C.blank());
});
test('puzzles: first solve pays by chapter (halved with hints), repeats pay 5, failures pay 0; puzzles open one by one',()=>{
  let p=C.blank();
  let r=C.recordPuzzle(p,{id:'cap-1',chapter:1,solved:true,hints:0});assert.equal(r.gain.total,50);assert.equal(r.first,true);p=r.profile;assert.ok(p.puzzles['cap-1']);
  r=C.recordPuzzle(p,{id:'cap-1',chapter:1,solved:true});assert.equal(r.gain.total,5);assert.equal(r.first,false);
  r=C.recordPuzzle(p,{id:'cert-2',chapter:4,solved:true,hints:1});assert.equal(r.gain.total,85);
  r=C.recordPuzzle(p,{id:'two-1',chapter:3,solved:false});assert.equal(r.gain.total,0);assert.ok(!r.profile.puzzles['two-1']);
  const ids=F.PUZZLES.map(x=>x.id);assert.ok(C.puzzleOpen(C.blank(),ids,0));assert.ok(!C.puzzleOpen(C.blank(),ids,1));assert.ok(C.puzzleOpen(p,ids,1));assert.ok(!C.puzzleOpen(p,ids,2));
});
test('sanitize/load/save: rejects garbage, keeps valid fields and survives broken storage',()=>{
  const s=C.sanitize({xp:250.7,games:-3,wins:'7',bestTier:-1,streak:2,puzzles:{'cap-1':1,'<script>':1,'def-1':0},extra:1});
  assert.equal(s.xp,250);assert.equal(s.games,0);assert.equal(s.wins,0);assert.equal(s.streak,2);assert.deepEqual(J(s.puzzles),{'cap-1':1});assert.equal('extra' in s,false);
  assert.deepEqual(J(C.sanitize(null)),J(C.blank()));assert.deepEqual(J(C.sanitize('x')),J(C.blank()));
  const store=memory();assert.ok(C.save(store,{...C.blank(),xp:77,puzzles:{'cap-2':1}}));assert.equal(C.load(store).xp,77);assert.deepEqual(J(C.load(store).puzzles),{'cap-2':1});assert.ok(C.KEY in store.data);
  assert.deepEqual(J(C.load({getItem:()=>'{not json'})),J(C.blank()));assert.deepEqual(J(C.load({getItem:()=>{throw new Error('denied');}})),J(C.blank()));
  assert.equal(C.save({setItem:()=>{throw new Error('quota');}},C.blank()),false);
});
