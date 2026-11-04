'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),E=require('../tux2d-engine.js');
test('pre-start follow cameras always show the first station',()=>{assert.equal(E.road(-72).stage,1);assert.equal(E.road(7200).stage,3);});
function race(spectator=false){const g=new E.Game({seed:'courier-test',spectator});g.start();for(let i=0;i<121;i++)g.step();assert.equal(g.phase,'racing');return g;}
const state=g=>JSON.stringify(g);
test('ready, pause, resume and reset preserve the fixed-step clock',()=>{const g=new E.Game();let before=state(g);g.step();assert.equal(state(g),before);g.start();g.pause();before=state(g);g.step();assert.equal(state(g),before);g.start();assert.equal(g.phase,'countdown');g.reset();assert.equal(g.phase,'ready');assert.equal(g.elapsed,0);assert.equal(g.shots.length,0);});
test('same seed and inputs reproduce the entire state',()=>{const a=race(),b=race();for(let i=0;i<360;i++){const input={steer:Math.sin(i/70),action:i===30?'boost':null};a.step(input);b.step(input);}assert.equal(state(a),state(b));});
test('shared energy pays the exact cost and cannot go negative or repeat while held',()=>{const g=race(),r=g.racers[0];r.energy=30;for(let i=0;i<70;i++)g.step({action:'boost'});assert.equal(g.events.filter(e=>e.racer===0&&e.type==='boost').length,1);assert.equal(r.energy,0);assert.equal(g.use(r,'shield'),false);r.energy=25;r.cooldown=0;assert.equal(g.use(r,'shield'),true);assert.equal(r.energy,0);});
test('shield absorbs exactly one hit, immunity prevents stacked damage, cargo clamps',()=>{const g=race(),r=g.racers[0];r.shield=4;g.hit(r,'rock');assert.equal(r.cargo,100);assert.equal(r.shield,0);g.hit(r,'rock');assert.equal(r.cargo,100);r.invulnerable=0;g.hit(r,'rock');assert.equal(r.cargo,86);r.cargo=3;r.invulnerable=0;g.hit(r,'rock');assert.equal(r.cargo,0);});
test('fork entry commits each side; supply repairs only once and express is faster',()=>{const g=race();g.objects=[];const r=g.racers[0];r.z=899;r.x=-.6;r.speed=90;r.energy=10;r.cargo=40;g.drive(r,{});assert.equal(r.route,'supply');for(let i=0;i<40;i++)g.drive(r,{steer:1});assert.ok(r.x<=-.21);r.z=1250;g.drive(r,{});assert.equal(r.energy,55);assert.equal(r.cargo,65);g.drive(r,{});assert.equal(r.energy,55);assert.ok(r.speed<=68);const ai=g.racers[1];ai.z=899;ai.x=.6;ai.speed=100;g.drive(ai,{});assert.equal(ai.route,'express');for(let i=0;i<60;i++)g.drive(ai,{});assert.ok(ai.speed>r.speed);});
test('battery collected once per driver; traffic and snowball use the same hit rule',()=>{const g=race();g.objects=[{id:0,type:'energy',z:100,x:0,taken:[]}];const r=g.racers[0];r.z=90;r.x=0;r.speed=100;r.energy=10;g.drive(r,{});assert.equal(r.energy,28);g.drive(r,{});assert.equal(r.energy,28);const other=g.racers[1];other.z=90;other.x=0;other.speed=100;other.energy=10;g.drive(other,{});assert.equal(other.energy,28);g.objects=[];other.z=r.z+30;other.x=r.x;other.invulnerable=0;g.use(r,'snowball');for(let i=0;i<25;i++)g.step();assert.ok(other.cargo<100);});
test('delivery scores cargo, finish ends a human run, timeout and replay work',()=>{const g=race();g.objects=[];const r=g.racers[0];r.z=2399;r.speed=100;r.cargo=70;g.step();assert.equal(r.parcels,1);assert.equal(r.score,210);r.z=7199;r.parcels=2;g.step();assert.equal(g.phase,'over');assert.equal(r.parcels,3);const before=state(g);g.step();assert.equal(state(g),before);g.reset();assert.equal(g.racers[0].parcels,0);g.phase='racing';g.elapsed=E.LIMIT-E.DT;g.step({brake:true});assert.equal(g.phase,'over');assert.equal(g.result.timeout,true);});
test('bounded single-seed AI expedition completes using shared resources and both routes',()=>{const g=race(true);for(let i=0;i<6601&&g.phase!=='over';i++)g.step();assert.equal(g.phase,'over');assert.ok(g.racers.every(r=>r.finished));assert.ok(g.telemetry.supply>0);assert.ok(g.telemetry.express>0);assert.ok(g.telemetry.boost>0);assert.ok(g.telemetry.shield>0);assert.ok(g.telemetry.snowball>0);assert.ok(g.racers.every(r=>r.energy>=0&&r.energy<=100&&r.cargo>=0&&r.cargo<=100));console.log('AI expedition',JSON.stringify({time:g.elapsed,telemetry:g.telemetry,standings:g.standings()}));});

// ---------- Full-screen shell ----------
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ROOT=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(ROOT,name),'utf8');
test('page is a full-screen Vermilion Ink stage with HUD, dock, drawer and curtain, all local',()=>{
 const html=read('tux2d.html'),css=read('tux2d.css'),view=read('tux2d-view.js');
 assert.match(html,/<link rel="stylesheet" href="shared\/fu\.css">/);assert.match(html,/<body class="fu-app[^"]*"/);
 assert.doesNotMatch(html,/fulab-theme\.css|play-panel|<details|site-nav|page-header/);
 assert.match(html,/<a class="fu-brand" href="index\.html"[^>]*><span class="fu-seal" aria-hidden="true">福遊<\/span>/);
 assert.match(html,/<main class="fu-stage"[^>]*><canvas id="tux-board"/);
 for(const id of ['curtain','menu','tux-play','tux-pause','tux-result','tux-race-again','touch-left','touch-right','touch-brake','action-boost','action-shield','action-snowball','tux-mode','tux-seed','tier-seg','contract-chips','route-options','weather-options','cargo-options','panel-career'])assert.match(html,new RegExp(`id="${id}"`),id);
 assert.equal((html.match(/class="fu-hud /g)||[]).length,2,'two HUD panels plus the dock');
 assert.match(html,/<script type="module" src="tux2d-view\.js"><\/script>/);assert.match(view,/from '\.\/shared\/fu-three\.js'/);
 for(const src of [html,css,view,read('tux2d-ui.js'),read('tux2d-engine.js')])assert.doesNotMatch(src,/https?:\/\/|fetch\(|WebSocket|@import/);
 for(const [,s] of html.matchAll(/src="([^"]+)"/g))assert.ok(fs.existsSync(path.join(ROOT,s)),s);
 assert.doesNotThrow(()=>new vm.Script(read('tux2d-ui.js')));
 assert.doesNotThrow(()=>new vm.Script('(async()=>{'+view.replace(/^import .*$/m,'')+'\n})'));
});

// ---------- Option defaults and the original rules ----------
const run=(opts,input=()=>({}),limit=7000)=>{const g=new E.Game(opts);g.start();for(let i=0;i<limit&&g.phase!=='over';i++)g.step(input(i));return g;};
test('default options are the original rules and reproduce recorded expeditions exactly',()=>{
 const g=new E.Game();assert.deepEqual({tier:g.tier,weather:g.weather,cargo:g.cargo,route:g.route,draft:g.draft,contract:g.contract,tiers:g.tiers},{tier:1,weather:'clear',cargo:'parcel',route:'alpine',draft:false,contract:null,tiers:null});
 assert.deepEqual({...g.mods},{grip:1,wind:0,maxAdj:0,damage:14,mult:3,accel:60,keep:.48,decay:0,timeBonus:10,curve:1,mainIce:false,rockfall:false});
 assert.equal(g.objects.length,42);
 // Fingerprints recorded with the pre-polish engine (commit 2010c64).
 const a=run({seed:'courier-test',spectator:true});
 assert.equal(a.ticks,5192);assert.equal(a.standings().map(s=>s.score).join(),'1423,1405,1293,1216,1081');
 assert.deepEqual(a.telemetry,{hits:8,blocks:24,pickups:42,boost:8,shield:39,snowball:11,supply:11,express:4,deliveries:15});
 const b=run({seed:'fingerprint'},i=>({steer:Math.sin(i/45)*.8,brake:i%400<20,action:['boost','shield','snowball',null][i%240>>6]}));
 assert.equal(b.ticks,6166);assert.equal(b.standings().map(s=>s.score).join(),'1408,1376,1327,1211,966');
 const bad=new E.Game({tier:9,weather:'x',cargo:'y',route:'z',contract:'q'});assert.deepEqual([bad.tier,bad.weather,bad.cargo,bad.route,bad.contract],[1,'clear','parcel','alpine',null]);
});
test('every option combination stays deterministic and in bounds',()=>{
 const opts={seed:'combo',spectator:true,tier:3,weather:'gale',cargo:'fresh',route:'canyon',draft:true};
 const a=run(opts),b=run(opts);assert.equal(state(a),state(b));assert.equal(a.phase,'over');
 assert.ok(a.racers.every(r=>r.energy>=0&&r.energy<=100&&r.cargo>=0&&r.cargo<=100&&Math.abs(r.x)<=1.35));
 for(const route of Object.keys(E.ROUTES))for(const tier of [0,2]){const g=run({seed:'all-'+route,spectator:true,tier,route,weather:'snow',cargo:'heavy',draft:true});assert.equal(g.phase,'over');assert.ok(g.racers.filter(r=>r.finished).length>=4,route+tier);}
});

// ---------- AI tiers ----------
test('AI tiers: rookie holds decisions, tier 1 is the original planner, per-driver tiers mix a field',()=>{
 assert.deepEqual(E.TIERS.map(t=>t.id),['rookie','standard','veteran','master']);
 const g=new E.Game({seed:'tiers',spectator:true,tier:0});g.start();for(let i=0;i<121;i++)g.step();
 const first=g.aiMemory[2];assert.ok(first);const wait=E.TIERS[0].think-1-(g.ticks-first.tick);for(let i=0;i<wait;i++)g.step();assert.equal(g.aiMemory[2],first);g.step();assert.notEqual(g.aiMemory[2],first);
 const v=race().observation();assert.deepEqual(E.aiControl(v,2,1),E.chooseAI(v,2));
 const mixed=new E.Game({tiers:[1,0,2,3,3]});assert.deepEqual([0,1,2,3,4].map(i=>mixed.tierOf(i)),[1,0,2,3,3]);assert.equal(new E.Game({tier:2}).tierOf(4),2);
});
test('AI planner dodges a rock in its lane, shields an incoming snowball and throws at a target ahead',()=>{
 const g=race(true),T=E.TIERS[3];g.objects=[];const r=g.racers[2];Object.assign(r,{z:300,x:0,energy:100,speed:100});
 for(const o of g.racers)if(o!==r)o.z=-500;
 g.objects=[{id:1,type:'rock',z:400,x:0,taken:[]}];let c=E.chooseAITier(g.observation(),2,T);assert.ok(Math.abs(c.steer)>.5,'steers away');
 g.objects=[];g.shots=[{owner:1,z:250,x:0,life:2}];c=E.chooseAITier(g.observation(),2,T);assert.equal(c.action,'shield');
 g.shots=[];Object.assign(g.racers[3],{z:450,x:0,shield:0});c=E.chooseAITier(g.observation(),2,T);assert.equal(c.action,'snowball');
 r.energy=10;c=E.chooseAITier(g.observation(),2,T);assert.equal(c.action,null);
});
test('stronger tiers finish ahead of weaker ones in mixed fields',()=>{
 const base=[0,1,2,3,3],sum=[0,0,0,0],cnt=[0,0,0,0];
 for(let k=0;k<15;k++){const tiers=base.map((_,i)=>base[(i+k)%5]);const g=run({seed:'lad'+k,spectator:true,tiers});for(const s of g.standings()){sum[tiers[s.id]]+=s.rank;cnt[tiers[s.id]]++;}}
 const avg=sum.map((s,i)=>s/cnt[i]);console.log('tier average rank',avg.map(a=>a.toFixed(2)).join(' '));
 assert.ok(avg[0]>avg[1],'rookie behind standard');assert.ok(avg[1]>avg[2]&&avg[1]>avg[3],'veteran and master ahead of standard');
});

// ---------- Weather, cargo, routes, slipstream ----------
const solo=opts=>{const g=new E.Game({seed:'solo',...opts});g.start();for(let i=0;i<121;i++)g.step();g.objects=[];g.racers.forEach((r,i)=>{if(i)r.finished=true;});const r=g.racers[0];Object.assign(r,{z:100,x:0,speed:100});return{g,r};};
test('weather: snow loses grip and top speed, gale pushes the kart sideways with no input',()=>{
 const steerFor=w=>{const{g,r}=solo({weather:w});for(let i=0;i<30;i++)g.step({steer:1});return r.x;};
 assert.ok(steerFor('snow')<steerFor('clear'));
 const top=w=>{const{g,r}=solo({weather:w});for(let i=0;i<120;i++)g.step({});return r.speed;};
 assert.equal(top('clear'),100);assert.equal(top('snow'),94);assert.equal(top('gale'),96);
 const drift=w=>{const{g,r}=solo({weather:w});g.elapsed=Math.PI-.5;g.windPhase=0;r.z=2600;for(let i=0;i<60;i++)g.step({});return r.x;};
 assert.ok(drift('gale')-drift('clear')>.1,'gust pushes right');
});
test('cargo: fragile and heavy change damage, knockback, pace and delivery value; fresh decays',()=>{
 for(const [cargo,damage,keep] of [['parcel',14,.48],['fragile',22,.48],['heavy',9,.7]]){const{g,r}=solo({cargo});r.speed=100;g.hit(r,'rock');assert.equal(r.cargo,100-damage);assert.ok(Math.abs(r.speed-100*keep)<1e-9);}
 const{g,r}=solo({cargo:'fragile'});r.z=2399;r.cargo=50;g.step({});assert.equal(r.score,210);
 const h=solo({cargo:'heavy'}),p=solo({});h.r.speed=p.r.speed=0;for(let i=0;i<60;i++){h.g.step({});p.g.step({});}assert.ok(h.r.speed<p.r.speed);
 const f=solo({cargo:'fresh'});for(let i=0;i<60;i++)f.g.step({});assert.ok(Math.abs(f.r.cargo-(100-.35*f.g.ticks*E.DT))<1e-6);
 const fin=solo({cargo:'fresh'});fin.r.z=7199;fin.r.parcels=2;fin.g.elapsed=50;fin.g.step({});assert.equal(fin.g.phase,'over');assert.equal(fin.r.score,Math.round(fin.r.cargo*3.6)+Math.round((E.LIMIT-fin.g.elapsed)*16));
});
test('routes: canyon adds hazards and warned rockfall, glacier ices the main road',()=>{
 assert.equal(new E.Game({route:'canyon'}).objects.length,42+9);assert.equal(new E.Game({seed:'s1',route:'canyon'}).objects.filter(o=>o.type==='rock').length,18);
 assert.equal(new E.Game({route:'canyon'}).road(500).curve,E.road(500).curve*1.35);
 const c=new E.Game({seed:'courier-test',route:'canyon'});c.start();for(let i=0;i<121;i++)c.step();
 c.objects=[];c.nextFall=c.elapsed;c.step({});const rock=c.objects.find(o=>o.falling);assert.ok(rock);assert.ok(rock.fallAt>c.elapsed);assert.ok(c.events.some(e=>e.type==='rockfall'&&e.racer===-1));
 const r=c.racers[0];c.racers.forEach((o,i)=>{if(i)o.finished=true;});Object.assign(r,{z:rock.z-5,x:rock.x,speed:0,invulnerable:0,shield:0});c.drive(r,{brake:true});assert.equal(r.cargo,100,'no hit while the rock is still falling');
 c.elapsed=rock.fallAt;r.z=rock.z-10;rock.previousZ=rock.z;r.speed=100;c.drive(r,{});assert.equal(r.cargo,86);
 assert.equal(new E.Game().road(300).mainIce,undefined);const gl=new E.Game({route:'glacier'});assert.equal(gl.road(300).mainIce,true);assert.equal(gl.road(1000).mainIce,false);
 const slide=route=>{const{g,r}=solo({route});r.z=200;for(let i=0;i<20;i++)g.step({steer:1});return r.x;};assert.ok(slide('glacier')<slide('alpine'));
 const stop=route=>{const{g,r}=solo({route});r.z=200;for(let i=0;i<20;i++)g.step({brake:true});return r.speed;};assert.ok(stop('glacier')>stop('alpine'));
});
test('slipstream: only when enabled, close behind another driver, for extra speed',()=>{
 for(const draft of [false,true]){const g=new E.Game({seed:'draft',draft});g.start();for(let i=0;i<121;i++)g.step();g.objects=[];g.shots=[];
  const[me,lead]=g.racers;g.racers.slice(2).forEach(o=>o.finished=true);Object.assign(me,{z:500,x:0,speed:100,boost:0});Object.assign(lead,{z:540,x:0,speed:0});
  g.drive(me,{});assert.equal(me.drafting,draft);if(draft)assert.ok(me.speed>100);else assert.equal(me.speed,100);
  lead.x=.5;g.drive(me,{});assert.equal(me.drafting,false);}
});

// ---------- Attribution, contracts and the run summary ----------
test('snowball hits are credited to the thrower; contracts are judged from the player run',()=>{
 const g=race();g.objects=[];const[me,o]=g.racers;Object.assign(o,{z:me.z+40,x:me.x,invulnerable:0,shield:0});me.energy=100;me.cooldown=0;g.use(me,'snowball');for(let i=0;i<25;i++)g.step();
 assert.equal(me.stats.snowHits,1);assert.ok(g.events.some(e=>e.type==='hit'&&e.by===0&&e.racer===1));
 const C=E.CONTRACTS,mk=s=>({id:0,parcels:3,finished:true,finishTime:90,stats:{hits:0,blocks:0,snowHits:0,pickups:0,supply:0,express:0,minCargo:100,...s}}),fake={standings:()=>[{id:0}]};
 assert.equal(C.intact.check(fake,mk({minCargo:80})),true);assert.equal(C.intact.check(fake,mk({minCargo:79})),false);
 assert.equal(C.sniper.check(fake,mk({snowHits:3})),true);assert.equal(C.express.check(fake,mk({express:3})),true);assert.equal(C.express.check(fake,mk({express:2})),false);
 assert.equal(C.untouched.check(fake,mk({hits:1})),false);assert.equal(C.collector.check(fake,mk({pickups:8})),true);assert.equal(C.win.check(fake,mk({})),true);
 assert.equal(C.swift.check(fake,{...mk({}),finishTime:80}),true);assert.equal(C.swift.check(fake,{...mk({}),finishTime:80.1}),false);
 const h=new E.Game({seed:'contract',contract:'collector'});h.start();for(let i=0;i<121;i++)h.step();h.racers[0].stats.pickups=8;Object.assign(h.racers[0],{z:7199,parcels:2,speed:100});h.step();
 assert.equal(h.phase,'over');assert.deepEqual(h.result.contract,{id:'collector',name:'電池收集',xp:70,ok:true});
 const s=h.summary();assert.equal(s.contractOk,true);assert.equal(s.parcels,3);assert.equal(s.finished,true);assert.equal(s.tier,1);
 assert.equal(new E.Game({spectator:true,contract:'collector'}).contractResult().ok,false);
});

// ---------- Career ----------
test('career: levels, ranks, XP lines with multipliers, unlocks, offers and safe storage',()=>{
 const C=E.Career;
 assert.deepEqual(C.levelOf(0),{level:1,into:0,need:185,max:false});assert.equal(C.levelOf(184).level,1);assert.equal(C.levelOf(185).level,2);assert.equal(C.levelOf(185+230).level,3);
 let total=0;for(let l=1;l<C.MAX_LEVEL;l++)total+=C.need(l);assert.equal(C.levelOf(total).max,true);assert.equal(C.levelOf(total-1).max,false);assert.equal(C.levelOf(total*9).level,C.MAX_LEVEL);
 assert.equal(C.rankOf(1),'見習郵差');assert.equal(C.rankOf(8),'雪線快遞');assert.equal(C.rankOf(30),'雪港郵王');
 const s={spectator:false,tier:1,weather:'clear',cargo:'parcel',route:'alpine',rank:1,score:1400,parcels:3,finished:true,time:80,snowHits:2,contract:'intact',contractOk:true};
 const x=C.matchXP(s);assert.equal(x.base,20+75+40+120+35+20+90);assert.equal(x.mult,1);assert.equal(x.total,x.base);
 assert.ok(Math.abs(C.multiplier({tier:3,weather:'gale',cargo:'fragile',route:'canyon'})-1.7*1.2*1.15*1.15)<1e-9);
 assert.equal(C.matchXP({...s,tier:0}).total,Math.round(x.base*.6));assert.equal(C.matchXP({...s,spectator:true}).total,0);
 assert.equal(C.matchXP({...s,contractOk:false}).base,x.base-90);
 const rec=C.record(C.blank(),s);assert.equal(rec.profile.xp,x.total);assert.equal(rec.profile.runs,1);assert.equal(rec.profile.wins,1);assert.equal(rec.profile.contracts,1);assert.equal(rec.profile.fastest,80);assert.equal(rec.after.level,2);
 assert.deepEqual(rec.unlocked.map(u=>u.kind+':'+u.id),['weather:snow','contract:sniper']);
 assert.deepEqual(C.record(rec.profile,{...s,spectator:true}).profile,rec.profile);
 assert.equal(C.unlocked(1,'tier',3),false);assert.equal(C.unlocked(7,'tier',3),true);assert.equal(C.unlocked(30,'route','nowhere'),false);
 assert.deepEqual(C.offers(1,0).sort(),['collector','intact']);const o=C.offers(10,3);assert.equal(o.length,3);assert.equal(new Set(o).size,3);assert.ok(o.every(id=>E.CONTRACTS[id]));
 assert.deepEqual(C.sanitize({xp:-5,runs:'x',bestTier:-1,fastest:81.27,extra:1}),{...C.blank(),fastest:81.3});
 const mem={},store={getItem:k=>mem[k]??null,setItem:(k,v)=>{mem[k]=v;}};assert.deepEqual(C.load(store),C.blank());assert.ok(C.save(store,rec.profile));assert.deepEqual(C.load(store),rec.profile);
 mem[C.KEY]='{broken';assert.deepEqual(C.load(store),C.blank());assert.equal(C.save({setItem(){throw new Error('quota');}},rec.profile),false);
});
