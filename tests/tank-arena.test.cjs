'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),E=require('../tank-arena-engine.js');
const seeded=seed=>()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
const game=()=>{const g=new E.Game(seeded(1));g.start();return g;};
test('two teams of two alternate units; bounded movement and one turn transition per shot',()=>{const g=game();assert.equal(g.active,0);assert.equal(g.actors.length,4);assert.ok(g.move(15));assert.equal(g.moveLeft,45);g.fire();assert.equal(g.fire(),false);assert.equal(g.endTurn(),false);for(let i=0;i<300&&g.phase==='flight';i++)g.step();assert.equal(g.turn,1);assert.equal(g.team,1);g.endTurn();assert.equal(g.active,1);assert.equal(g.turn,2);});
test('public trajectory equals actual impact and detects thin walls',()=>{const g=game();g.aim(25,90);const expected=E.trajectory(g,g.actors[0],g.angle,g.power).hit;let actual;g.explode=h=>{actual=h;};g.fire();for(let i=0;i<300&&!actual;i++)g.step();assert.deepEqual(actual,expected);const h=game();h.buildings=[{id:9,type:'wall',team:1,x:160,w:18,h:80,hp:36}];const hit=E.trajectory(h,h.actors[0],10,100).hit;assert.equal(hit.building,9);});
test('building placement rejects invalid locations without consuming cards, and one-card budget is shared',()=>{const g=game();g.hands[0]=['wall','bunker','drill'];assert.equal(g.playCard(0,110),false);assert.equal(g.playCard(0,400),false);assert.equal(g.playCard(0,NaN),false);assert.equal(g.hands[0].length,3);assert.ok(g.playCard(0,160));assert.equal(g.buildings.length,1);assert.equal(g.playCard(0,190),false);assert.equal(g.move(60),false);assert.equal(g.hands[0].length,2);});
test('repair cap, drill tradeoff, friendly fire, terrain craters and destroyed walls are real',()=>{const g=game();g.hands[0]=['repair'];assert.equal(g.playCard(0),false);g.actors[0].hp=60;assert.ok(g.playCard(0));assert.equal(g.actors[0].hp,70);const h=game(),p=E.body(h,h.actors[0]),before=E.ground(h,p.x);h.buildings=[{id:1,type:'wall',team:0,x:p.x+40,w:18,h:55,hp:36}];h.explode({...p,building:1});assert.ok(h.actors[0].hp<70);assert.equal(h.buildings.length,0);assert.ok(E.ground(h,p.x)>before);const k=game();k.hands[0]=['drill'];assert.ok(k.playCard(0));assert.equal(k.drill,true);});
test('bunker reduces splash and can be countered by destruction',()=>{const a=game(),b=game(),hit=E.body(a,a.actors[0]);b.buildings=[{id:1,type:'bunker',team:0,x:150,w:32,h:28,hp:40}];a.explode(hit);b.explode(hit);assert.ok(b.actors[0].hp>a.actors[0].hp);b.explode({x:150,y:E.ground(b,150)-14,building:1});assert.equal(b.buildings.length,0);});
test('pause freezes AI/projectile; restart discards pending projectile and all tactical state',()=>{const g=game();g.fire();g.step();g.pause();const before=JSON.stringify(g);for(let i=0;i<10;i++)g.step();assert.equal(JSON.stringify(g),before);g.start();assert.equal(g.phase,'flight');g.reset();assert.equal(g.phase,'ready');assert.equal(g.projectile,null);assert.equal(g.buildings.length,0);assert.equal(g.turn,0);assert.ok(g.actors.every(a=>a.hp===70));});
test('AI observation excludes opponent hand and RNG; changing hidden hand cannot alter chosen shot',()=>{const g=game();const first=E.observation(g,0),decision=E.chooseShot(first);g.hands[1]=['drill','drill','drill'];assert.deepEqual(E.observation(g,0),first);assert.deepEqual(E.chooseShot(E.observation(g,0)),decision);assert.equal('hands' in first,false);assert.equal('random' in first,false);});
test('elimination, turn cap and ties terminate explicitly',()=>{const g=game();g.actors.filter(a=>a.team===1).forEach(a=>a.hp=0);g.checkResult();assert.equal(g.result.winner,0);const h=game();h.turn=40;h.checkResult();assert.equal(h.result.winner,null);const j=game();j.actors[0].hp=0;j.turn=40;j.checkResult();assert.equal(j.result.winner,1);});
test('two bounded autonomous matches reach a result using identical shot physics',()=>{for(const seed of [7,31]){const g=new E.Game(seeded(seed));g.start();let ticks=0;while(g.phase!=='over'&&ticks++<15000){if(g.phase==='aim')g.aiTurn();else g.step();assert.ok(g.buildings.length<=8);assert.ok(g.actors.every(a=>a.hp>=0&&a.hp<=70&&Number.isFinite(a.x)));assert.ok(g.terrain.every(y=>Number.isFinite(y)&&y<=440));}assert.equal(g.phase,'over');assert.ok(g.turn<=40);}});

// ---------- Full-screen page, options, new rules and career ----------
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','tank_arena.html'),'utf8');
const Career=vm.runInNewContext(html.match(/<script id="tank-career">([\s\S]*?)<\/script>/)[1]+';TankCareer;');
const J=o=>JSON.parse(JSON.stringify(o));
const run=(g,limit=30000)=>{if(g.phase==='ready')g.start();let t=0;while(g.phase!=='over'&&t++<limit){if(g.phase==='aim')g.aiTurn();else g.step();}return g;};
const memory=()=>{const m=new Map();return{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v))};};

test('page is a local full-screen Vermilion Ink shell and every script compiles',()=>{
 assert.match(html,/<link rel="stylesheet" href="shared\/fu\.css">/);assert.match(html,/<body class="fu-app">/);assert.doesNotMatch(html,/fulab-theme|play-panel|<details class="card rules|site-nav/);
 assert.match(html,/class="fu-brand" href="index\.html"[\s\S]*?class="fu-seal"/);assert.match(html,/<main class="fu-stage"><canvas id="board"/);
 for(const id of ['menu','overlay','match','console','dock','hand','fire','pass','play','tier-chips','map-chips','pane-rules','pane-career'])assert.match(html,new RegExp(`id="${id}"`),id);
 assert.match(html,/from '\.\/shared\/fu-three\.js'/);assert.ok(fs.existsSync(path.join(__dirname,'..','vendor','three','three.module.min.js')));
 assert.doesNotMatch(html,/fetch\(|WebSocket|XMLHttpRequest|https?:\/\//);
 for(const [,attrs,s] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)){if(/src=/.test(attrs))continue;const body=/type="module"/.test(attrs)?'(async()=>{'+s.replace(/^\s*import\b[^;]*;/gm,'')+'\n})':s;assert.doesNotThrow(()=>new vm.Script(body),attrs);}
});
test('default options reproduce the original rules exactly',()=>{
 assert.deepEqual(E.normalizeOptions({}),{tier:2,map:'dunes',weather:'breeze',deck:'classic',loadout:'standard',aiLoadout:'standard',turns:40});
 assert.deepEqual(E.normalizeOptions({tier:9,map:'moon',weather:'x',deck:'y',loadout:'z',turns:3}),E.normalizeOptions({}));
 for(const seed of [3,11]){const a=run(new E.Game(seeded(seed))),b=run(new E.Game(seeded(seed),{tier:2,map:'dunes',weather:'breeze',deck:'classic',loadout:'standard'}));assert.deepEqual(a.result,b.result);assert.deepEqual(a.terrain,b.terrain);}
 const g=new E.Game(seeded(1));assert.deepEqual(g.hands,[['wall','repair'],['wall','repair']]);assert.deepEqual(g.actors.map(a=>a.x),[110,230,570,690]);assert.equal(g.terrain[0],E.MAPS.dunes.terrain(0));
});
test('every map has finite terrain, dry spawns and the fort starts with neutral ruins outside the build cap',()=>{
 for(const id of Object.keys(E.MAPS)){const g=new E.Game(seeded(2),{map:id});assert.equal(g.terrain.length,E.W+1);assert.ok(g.terrain.every(y=>Number.isFinite(y)&&y>60&&y<=460),id);
  for(const a of g.actors){assert.ok(a.x>=20&&a.x<=E.W-20);if(g.water)assert.ok(E.ground(g,a.x)<g.water-4,id+' spawn in water');}}
 const f=new E.Game(seeded(2),{map:'fort'});f.start();assert.equal(f.buildings.length,3);assert.ok(f.buildings.every(b=>b.team===-1));
 for(let i=0;i<8;i++)f.buildings.push({id:100+i,type:'wall',team:i%2,x:-500,w:1,h:1,hp:1});f.hands[0]=['wall'];assert.equal(f.playCard(0,40),false,'cap counts only team buildings');
 f.buildings.splice(3,1);assert.ok(f.playCard(0,40));
 const view=E.observation(f,1),ruin=view.buildings.find(b=>b.team===-1),enemy=view.buildings.find(b=>b.team===0);
 assert.equal(E.scoreHit(view,view.actors[2],{x:ruin.x,y:100,building:ruin.id}),E.scoreHit(view,view.actors[2],{x:ruin.x,y:100}),'neutral ruins are worth nothing to hit');
 assert.ok(E.scoreHit(view,view.actors[2],{x:enemy.x,y:100,building:enemy.id})>E.scoreHit(view,view.actors[2],{x:enemy.x,y:100}));
});
test('tide map: walking into the sea is refused, shells splash as misses, sinking ground drowns',()=>{
 const g=new E.Game(seeded(4),{map:'isles'});g.start();const a=g.actors[g.active];a.x=230;g.moveLeft=200;assert.equal(g.move(60),false);assert.match(g.log,/海/);assert.equal(a.x,230);
 const p={x:300,y:g.water-30,vx:0,vy:200,age:1,owner:a.id};let hit=null;for(let i=0;i<40&&!hit;i++)hit=E.advance(g,p);assert.ok(hit.miss&&hit.splash);
 g.explode(hit);assert.match(g.log,/海/);assert.ok(g.events.some(e=>e.type==='miss'&&e.splash));
 const h=new E.Game(seeded(4),{map:'isles'});h.start();const v=h.actors[3],old=h.actors.map(a=>E.ground(h,a.x));for(let x=v.x-15;x<=v.x+15;x++)h.terrain[x]=430;h.settle(old,0);
 assert.equal(v.hp,0);assert.ok(h.events.some(e=>e.type==='drown'&&e.id===3));assert.equal(h.stats.kills[0],1);assert.equal(h.actors[2].hp,70);
 assert.equal(game().water,0);
});
test('weather variants: calm, gale range and shifting drift',()=>{
 const c=new E.Game(seeded(5),{weather:'calm'});c.start();for(let i=0;i<10;i++){c.endTurn();assert.equal(c.wind,0);}
 for(const weather of ['gale','shifting']){const g=new E.Game(seeded(6),{weather});g.start();let prev=g.wind,big=0;for(let i=0;i<35;i++){assert.ok(g.endTurn());assert.ok(Math.abs(g.wind)<=45);if(weather==='shifting')assert.ok(Math.abs(g.wind-prev)<=15);big=Math.max(big,Math.abs(g.wind));prev=g.wind;}if(weather==='gale')assert.ok(big>20);}
});
test('decks and opening hands: classic draws stay classic, expanded can draw every card, loadouts set hands',()=>{
 for(const deck of ['classic','expanded']){const seen=new Set(),g=new E.Game(seeded(8),{deck,turns:99});g.start();for(let i=0;i<95;i++){g.hands[1-g.team]=[];assert.ok(g.endTurn());g.hands[g.team].forEach(t=>seen.add(t));}assert.deepEqual([...seen].sort(),E.DECKS[deck].slice().sort());}
 for(const id of Object.keys(E.LOADOUTS)){const g=new E.Game(seeded(1),{loadout:id});assert.deepEqual(g.hands[0],E.LOADOUTS[id].hand);}
 assert.deepEqual(new E.Game(seeded(1),{tier:3}).hands[1],E.LOADOUTS.siege.hand);
});
test('shell cards: heavy hits harder near the centre, cluster scatters four bomblets, one card per turn',()=>{
 const base=game(),heavy=game(),cl=game();const target=E.body(base,base.actors[2]);
 heavy.hands[0]=['heavy','drill'];assert.ok(heavy.playCard(0));assert.equal(heavy.shell,'heavy');assert.equal(heavy.playCard(0),false);
 base.explode(target);heavy.explode(target);assert.ok(heavy.actors[2].hp<base.actors[2].hp);
 cl.hands[0]=['cluster'];cl.playCard(0);cl.events.length=0;cl.explode(target);assert.equal(cl.events.filter(e=>e.type==='blast').length,5);
 heavy.aim(60,60);heavy.fire();assert.equal(heavy.projectile.shell,'heavy');const n=game();n.fire();assert.equal(n.projectile.shell,'normal');
});
test('jet pack, calm flag and airstrike follow their rules',()=>{
 const g=game();g.buildings=[{id:5,type:'wall',team:1,x:150,w:18,h:55,hp:36}];assert.equal(g.move(60),false);g.hands[0]=['jet'];assert.ok(g.playCard(0));assert.equal(g.moveLeft,150);assert.ok(g.move(80));assert.equal(g.actors[0].x,190);
 const c=game();c.hands[0]=['calm','calm'];c.wind=0;assert.equal(c.playCard(0),false);c.wind=17;assert.ok(c.playCard(0));assert.equal(c.wind,0);
 const s=game();s.hands[0]=['airstrike'];assert.equal(s.playCard(0),false);assert.equal(s.playCard(0,NaN),false);const x=s.actors[2].x;assert.ok(s.playCard(0,x));assert.deepEqual(s.strikes,[{x,team:0,turn:0}]);
 assert.deepEqual(E.observation(s,1).strikes,[{x,team:0,turn:0}],'telegraphed to the opponent');
 s.hands[0]=['airstrike'];s.cardUsed=false;assert.equal(s.playCard(0,300),false,'one pending strike per side');
 const hp=s.actors[2].hp;s.endTurn();assert.equal(s.team,1);assert.equal(s.actors[2].hp,hp,'does not land on the enemy turn');assert.equal(s.strikes.length,1);
 s.endTurn();assert.equal(s.team,0);assert.equal(s.strikes.length,0);assert.ok(s.actors[2].hp<hp);assert.ok(s.stats.dealt[0]>0);assert.match(s.log,/空投/);
});
test('stats attribute damage, friendly fire and knockouts to the firing side',()=>{
 const g=game();const t=E.body(g,g.actors[2]);g.actors[2].hp=10;g.explode(t);assert.equal(g.actors[2].hp,0);assert.equal(g.stats.kills[0],1);assert.ok(g.stats.dealt[0]>=10);assert.equal(g.stats.hits[0],1);
 const f=game();f.explode(E.body(f,f.actors[1]));assert.ok(f.stats.friendly[0]>0);assert.equal(f.stats.dealt[0],0);assert.equal(f.stats.hits[0],0);
});
test('AI tiers differ in search and noise yet all finish fair matches on every map',()=>{
 assert.deepEqual(E.TIERS.map(t=>t.id),['rookie','veteran','elite','legend']);
 const view=E.observation(game(),0),fine=E.chooseShot(view,{angleStep:5,powerStep:5,refine:true}),coarse=E.chooseShot(view,{angleStep:30,powerStep:15});assert.ok(fine.score>=coarse.score);
 const maps=Object.keys(E.MAPS);for(let tier=0;tier<4;tier++){const g=run(new E.Game(seeded(20+tier),{tier,map:maps[tier+1],weather:'gale',deck:'expanded'}));assert.equal(g.phase,'over',E.TIERS[tier].id);assert.ok(g.actors.every(a=>a.hp>=0&&a.hp<=70));}
 const r1=new E.Game(seeded(9),{tier:0}),r2=new E.Game(seeded(9),{tier:0});for(const r of [r1,r2]){r.start();r.endTurn();r.aiTurn();}assert.deepEqual([r1.angle,r1.power],[r2.angle,r2.power],'noise comes from the seeded RNG');
});
test('agent interface: JSON actions plus run-until-input drive a full match',()=>{
 const g=new E.Game(seeded(13));g.start();assert.equal(g.apply(null),false);assert.equal(g.apply({type:'warp'}),false);
 assert.ok(g.apply({type:'move',dx:10}));assert.ok(g.apply({type:'aim',angle:'50',power:70}));assert.equal(g.angle,50);
 let turns=0;while(g.phase!=='over'&&turns++<60){const b=E.chooseShot(E.observation(g,0));g.apply({type:'aim',angle:b.angle,power:b.power});assert.ok(g.apply({type:'fire'}));assert.ok(['aim','over'].includes(E.runUntilInput(g)));}
 assert.equal(g.phase,'over');assert.ok(g.result);
});
test('career: level curve, ranks and unlock gates',()=>{
 assert.equal(Career.need(1),135);assert.deepEqual(J(Career.levelOf(0)),{level:1,into:0,need:135,max:false});assert.equal(Career.levelOf(134).level,1);assert.equal(Career.levelOf(135).level,2);assert.equal(Career.levelOf(135+170).level,3);
 assert.equal(Career.levelOf(1e9).level,Career.MAX_LEVEL);assert.equal(Career.levelOf(1e9).max,true);assert.equal(Career.levelOf(-5).level,1);assert.equal(Career.levelOf('x').level,1);
 assert.equal(Career.rankOf(1),'見習砲手');assert.equal(Career.rankOf(8),'砲長');assert.equal(Career.rankOf(30),'鋼芯元帥');
 assert.ok(Career.unlocked(1,'tier',2));assert.equal(Career.unlocked(4,'tier',3),false);assert.ok(Career.unlocked(5,'tier',3));assert.equal(Career.unlocked(9,'map','fort'),false);assert.ok(Career.unlocked(10,'map','fort'));assert.equal(Career.unlocked(99,'map','moon'),false);
 for(const id of Object.keys(E.MAPS))assert.ok(Number.isFinite(Career.unlockLevel('map',id)),id);for(const id of Object.keys(E.WEATHER))assert.ok(Number.isFinite(Career.unlockLevel('weather',id)),id);for(const id of Object.keys(E.LOADOUTS))assert.ok(Number.isFinite(Career.unlockLevel('loadout',id)),id);
});
test('career: match XP lines, multipliers and recorded profile',()=>{
 const loss=Career.matchXP({outcome:'loss',tier:2,dealt:41,kills:0});assert.deepEqual(J(loss.lines),[['完成對戰',30],['造成傷害',20]]);assert.equal(loss.total,50);
 const win=Career.matchXP({outcome:'win',tier:3,weather:'gale',assist:'short',dealt:500,kills:2,razed:1,turns:12,lost:0});
 assert.equal(win.base,30+80+70+10+120+40+40);assert.ok(Math.abs(win.mult-1.35*1.1*1.15)<1e-9);assert.equal(win.total,Math.round(win.base*win.mult));
 assert.equal(Career.matchXP({outcome:'draw',tier:0}).total,Math.round(80*.6));
 let p=Career.blank();const r=Career.record(p,{outcome:'win',tier:1,dealt:140,kills:2,turns:20,lost:1});p=r.profile;
 assert.equal(p.matches,1);assert.equal(p.wins,1);assert.equal(p.streak,1);assert.equal(p.bestTier,1);assert.equal(p.kills,2);assert.equal(p.damage,140);assert.equal(r.after.level,2);assert.deepEqual(J(r.unlocked.map(u=>u.id)),['canyon','engineer']);
 p=Career.record(p,{outcome:'win',tier:0}).profile;assert.equal(p.bestStreak,2);assert.equal(p.bestTier,1);p=Career.record(p,{outcome:'loss',tier:3}).profile;assert.equal(p.streak,0);assert.equal(p.bestStreak,2);assert.equal(p.bestTier,1);
 const s=memory();assert.ok(Career.save(s,p));assert.deepEqual(J(Career.load(s)),J(p));s.setItem(Career.KEY,'{bad');assert.deepEqual(J(Career.load(s)),J(Career.blank()));
 assert.deepEqual(J(Career.sanitize({xp:-4,wins:'3',matches:2.7,bestTier:-1})),{...J(Career.blank()),matches:2});
 assert.equal(Career.load({getItem(){throw new Error('denied');}}).xp,0);assert.equal(Career.save({setItem(){throw new Error('full');}},p),false);
});
