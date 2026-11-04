'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','pulse_arena.html'),'utf8');
const T=vm.runInNewContext(html.match(/<script id="pulse-engine">([\s\S]*?)<\/script>/)[1]+';PulseArena;');
const Career=vm.runInNewContext(html.match(/<script id="pulse-career">([\s\S]*?)<\/script>/)[1]+';PulseCareer;');
const seeded=seed=>()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
const idle=()=>({x:0,y:0,charge:false});
function fixture(){const g=new T.Game(seeded(1));g.start();g.aiInput=idle;g.actors.forEach((a,i)=>{a.x=220+i*90;a.y=360;});return g;}
// Finish the current round with `winner` as sole survivor and run through the result screen.
function winRound(g,winner){while(g.stage==='intro')g.step();g.actors.forEach(a=>{if(a.id!==winner)a.alive=false;});g.checkResult();assert.equal(g.stage,'outro');for(let i=0;i<T.OUTRO_TICKS&&g.phase==='running';i++)g.step();}

test('pulse arena is local, full-screen, and every script compiles',()=>{
 assert.match(html,/<canvas id="board"/);assert.match(html,/id="drawer"/);assert.match(html,/id="overlay"/);assert.match(html,/id="panel-rules"/);
 // three.js is vendored next to the page; nothing loads from the network.
 assert.match(html,/"three":"\.\/vendor\/three\/three\.module\.min\.js"/);assert.ok(fs.existsSync(path.join(__dirname,'..','vendor','three','three.module.min.js')));
 assert.doesNotMatch(html,/<script[^>]+src=|fetch\(|WebSocket|https?:\/\//);
 for(const [,attrs,s]of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)){if(/importmap/.test(attrs))continue;const body=/type="module"/.test(attrs)?s.replace(/^import .*$/gm,''):s;assert.doesNotThrow(()=>new vm.Script(body));}
});
test('simulation freezes ready/paused/over, resumes deliberately, and reset clears every transient',()=>{const g=new T.Game(seeded(1));g.step();assert.equal(g.tick,0);g.start();g.step({charge:true});g.pause();const state=JSON.stringify(g);g.step({charge:false});assert.equal(JSON.stringify(g),state);g.start();g.step({charge:false});assert.ok(g.waves.length);g.phase='over';const end=JSON.stringify(g);g.step();assert.equal(JSON.stringify(g),end);g.reset();assert.equal(g.phase,'ready');assert.equal(g.tick,0);assert.equal(g.round,1);assert.equal(g.stage,'fight');assert.equal(g.champion,null);assert.equal(g.waves.length,0);assert.equal(g.result,null);assert.ok(g.actors.every(a=>a.alive&&a.cooldown===0&&!a.charging&&a.hits===0&&a.crowns===0&&a.kos===0));});

test('ring holds for a grace period, then snaps inward stage by stage while previewing the next boundary',()=>{
 const p0=T.ringPlan(0);assert.equal(p0.radius,320);assert.equal(p0.next,272);assert.equal(p0.shrinking,false);assert.equal(T.ringAt(T.GRACE-1),320);
 const mid=T.ringPlan(T.GRACE+T.SHRINK/2);assert.equal(mid.shrinking,true);assert.ok(mid.radius<320&&mid.radius>272);
 const hold=T.ringPlan(T.GRACE+T.SHRINK);assert.equal(hold.radius,272);assert.equal(hold.next,228);assert.equal(hold.shrinking,false);assert.equal(hold.untilShrink,T.holdTicks(1));
 let last=Infinity;for(let t=0;t<=T.roundLimit(1);t++){const r=T.ringAt(t);assert.ok(r<=last+1e-9);last=r;}
 assert.equal(T.ringAt(T.roundLimit(1)),T.FINAL_RADIUS);assert.equal(T.ringAt(99999),T.FINAL_RADIUS);assert.equal(T.ROUND_TICKS,T.roundLimit(1));
 assert.ok(T.holdTicks(5)<T.holdTicks(1));assert.equal(T.holdTicks(50),120);assert.ok(T.roundLimit(6)<T.roundLimit(1));
 assert.equal(T.pulseRange(0),58);assert.equal(T.pulseRange(1),128);
});
test('stage transitions emit a one-second warning and a shrink event',()=>{const g=fixture(),seen=[];g.actors.forEach(a=>{a.x=360+(a.id-1.5)*40;a.y=360;});while(g.roundTick<T.GRACE+5){g.step();seen.push(...g.events.map(e=>e.type+'@'+g.roundTick));}assert.ok(seen.includes('warn@'+(T.GRACE-50)));assert.ok(seen.includes('shrink@'+T.GRACE));});

test('normalized motion, inertia, reverse braking, and charge slowdown are actual physical rules',()=>{const straight=fixture(),diagonal=fixture(),charged=fixture(),start={...straight.actors[0]};straight.step({x:1});diagonal.step({x:1,y:1});charged.step({x:1,charge:true});assert.ok(Math.abs(T.distance(start,straight.actors[0])-T.distance(start,diagonal.actors[0]))<1e-8);assert.ok(charged.actors[0].vx<straight.actors[0].vx);const a=straight.actors[0],x=a.x,v=a.vx;straight.step();assert.ok(a.x>x&&a.vx>0&&a.vx<v);straight.step({x:-1});assert.ok(a.vx<0);});
test('holding charges, release attacks once, full charge auto-releases, and a held button cannot repeat',()=>{const g=fixture();for(let i=0;i<25;i++)g.step({charge:true});assert.ok(Math.abs(g.actors[0].charge-.5)<1e-8);g.step({charge:false});assert.equal(g.actors[0].charging,false);assert.ok(g.actors[0].cooldown>1.7);assert.equal(g.events.filter(e=>e.type==='pulse').length,1);g.step();assert.equal(g.events.filter(e=>e.type==='pulse').length,0);const h=fixture();for(let i=0;i<50;i++)h.step({charge:true});assert.equal(h.actors[0].charging,false);assert.equal(h.actors[0].charge,0);let shots=1;for(let i=0;i<120;i++){h.step({charge:true});shots+=h.events.filter(e=>e.type==='pulse'&&e.owner===0).length;}assert.equal(shots,1);h.step({charge:false});h.step({charge:true});assert.equal(h.actors[0].charging,true);});
test('cooldown rejects premature presses, with a fresh press required after readiness',()=>{const g=fixture(),a=g.actors[0];a.cooldown=.5;g.step({charge:true});assert.equal(a.charging,false);for(let i=0;i<30;i++)g.step({charge:true});assert.equal(a.cooldown,0);assert.equal(a.charging,false);g.step({charge:false});g.step({charge:true});assert.equal(a.charging,true);});
test('pulse respects radius, pushes outward, scales with charge, and cannot hit its owner',()=>{const g=fixture(),a=g.actors[0],b=g.actors[1],c=g.actors[2];a.x=300;b.x=380;c.x=520;g.applyPulse({owner:0,x:300,y:360,charge:.1,range:T.pulseRange(.1)});assert.ok(b.vx>0);assert.equal(c.vx,0);assert.equal(a.vx,0);assert.equal(a.hits,1);assert.deepEqual({...b.lastHit},{by:0,tick:g.tick});const weak=b.vx;b.vx=0;g.applyPulse({owner:0,x:300,y:360,charge:1,range:T.pulseRange(1)});assert.ok(b.vx>weak);b.x=300;b.y=300;b.vx=b.vy=0;g.applyPulse({owner:0,x:300,y:360,charge:1,range:T.pulseRange(1)});assert.ok(b.vy<0);});
test('equal-mass collisions separate bodies and conserve momentum while losing bounce energy',()=>{const g=fixture(),a=g.actors[0],b=g.actors[1];a.x=300;b.x=330;a.vx=100;b.vx=-100;g.collide();assert.ok(Math.abs(T.distance(a,b)-T.R*2)<1e-8);assert.ok(a.vx<0&&b.vx>0);assert.equal(a.vx+b.vx,0);assert.ok(Math.abs(a.vx)<100);});
test('full body must remain inside the ring; the match goes on after you fall and a lone survivor takes the round',()=>{
 const g=fixture();g.actors[0].x=360+320-T.R;g.actors[0].y=360;g.step();assert.equal(g.actors[0].alive,true);g.actors[0].x+=.01;g.step();assert.equal(g.actors[0].alive,false);assert.equal(g.phase,'running');assert.equal(g.stage,'fight');
 g.actors[1].alive=g.actors[2].alive=false;g.checkResult();assert.equal(g.stage,'outro');assert.equal(g.roundWinner,3);assert.equal(g.champion,3);assert.equal(g.streak,1);assert.equal(g.actors[3].crowns,1);
 const h=fixture();h.actors.forEach(a=>{a.x=700;a.y=700;});h.step();assert.equal(h.stage,'outro');assert.equal(h.roundWinner,null);assert.equal(h.champion,null);assert.ok(h.actors.every(a=>a.crowns===0));
});
test('round timeout crowns the survivor closest to the centre',()=>{const g=fixture();g.roundTick=T.roundLimit(1);g.actors[2].x=361;g.actors[2].y=362;g.actors[0].x=330;g.checkResult();assert.equal(g.roundWinner,2);assert.match(g.history[0].reason,/時間到/);});
test('next round: champion holds the centre, challengers re-enter guarded on the outer ring, and all transients reset',()=>{
 const g=fixture();g.pickups=[{x:1,y:1,type:'anchor',expires:9999}];g.actors[1].item='hole';winRound(g,2);
 assert.equal(g.round,2);assert.equal(g.stage,'intro');assert.equal(g.roundTick,0);assert.equal(g.pickups.length,0);assert.equal(g.waves.length,0);
 const champ=g.actors[2];assert.equal(champ.x,360);assert.equal(champ.y,360);assert.equal(champ.guard,0);
 for(const a of g.actors.filter(a=>a.id!==2)){assert.ok(a.alive);assert.equal(a.item,null);assert.ok(Math.abs(T.distance(a,T.CENTER)-280)<1e-6);assert.equal(a.guard,T.GUARD_TICKS);assert.ok(T.distance(a,T.CENTER)+T.R<T.ringAt(0));}
 const frozen=JSON.stringify(g.actors);for(let i=0;i<T.INTRO_TICKS-1;i++)g.step({x:1,charge:true});assert.equal(JSON.stringify(g.actors),frozen);g.step({x:1});assert.equal(g.stage,'fight');assert.ok(g.events.some(e=>e.type==='fight'));
 g.step({x:1});assert.ok(g.actors[0].vx>0);
});
test('entry guard ignores pulses and black holes but still respects the ring',()=>{const g=fixture(),b=g.actors[1];b.guard=10;g.applyPulse({owner:0,x:b.x-30,y:b.y,charge:1,range:200});assert.equal(b.vx,0);g.holes=[{x:b.x+40,y:b.y,owner:0,starts:0,ends:9999}];g.step();assert.equal(b.vx,0);b.x=700;g.step();assert.equal(b.alive,false);});
test('champion perks: heavier body, dash, stronger pulse at two wins and an opening shield at three',()=>{
 const g=fixture();assert.deepEqual({...g.perks(g.actors[0])},{body:false,dash:false,power:false,shield:false});
 winRound(g,0);let a=g.actors[0];assert.equal(g.champion,0);assert.ok(g.perks(a).body&&g.perks(a).dash&&!g.perks(a).power);assert.equal(a.shield,0);assert.equal(g.perks(g.actors[1]).dash,false);
 for(let i=0;i<T.INTRO_TICKS;i++)g.step();
 // A champion takes less pulse knockback than a challenger at the same spot.
 const b=g.actors[1];b.guard=0;b.x=a.x+60;b.y=a.y;a.vx=b.vx=0;g.applyPulse({owner:3,x:a.x+30,y:a.y,charge:.5,range:200});assert.ok(Math.abs(a.vx)<Math.abs(b.vx));
 a.vx=a.vy=0;g.step({x:0,y:-1,dash:true});assert.ok(a.vy<-400);assert.equal(a.dashCd,T.DASH_COOLDOWN);assert.ok(g.events.some(e=>e.type==='dash'));const vy=a.vy;let extra=0;for(const dash of [true,false,true]){g.step({dash});extra+=g.events.filter(e=>e.type==='dash').length;}assert.equal(extra,0,'cooldown blocks a second dash');assert.ok(a.vy>vy);
 const c=g.actors[1];assert.equal(g.dash(c,{x:1,y:0}),false);
 assert.ok(g.rangeOf(a,1)===T.pulseRange(1));winRound(g,0);a=g.actors[0];assert.equal(g.streak,2);assert.ok(g.perks(a).power);assert.ok(g.rangeOf(a,1)>T.pulseRange(1));assert.equal(a.shield,0);
 winRound(g,0);assert.equal(g.streak,3);assert.ok(g.actors[0].shield>0);assert.ok(g.perks(g.actors[0]).shield);
 winRound(g,1);assert.equal(g.champion,1);assert.equal(g.streak,1);assert.equal(g.perks(g.actors[0]).body,false);
});
test('heavier champion collision still conserves momentum and moves the lighter disc more',()=>{const g=fixture();winRound(g,0);for(let i=0;i<T.INTRO_TICKS;i++)g.step();const a=g.actors[0],b=g.actors[1];a.x=300;a.y=b.y=360;b.x=330;a.vx=100;b.vx=-100;g.collide();assert.ok(g.mass(a)>g.mass(b));assert.ok(Math.abs(g.mass(a)*a.vx+g.mass(b)*b.vx-(g.mass(a)*100-g.mass(b)*100))<1e-9);assert.ok(Math.abs(b.vx)>Math.abs(a.vx));});
test('knockouts are credited to the last attacker within three seconds',()=>{const g=fixture(),b=g.actors[1];g.applyPulse({owner:0,x:b.x-30,y:b.y,charge:.2,range:100});b.x=700;g.step();assert.equal(b.alive,false);assert.equal(g.actors[0].kos,1);const out=g.events.find(e=>e.type==='out');assert.equal(out.by,0);const h=fixture(),c=h.actors[2];c.lastHit={by:0,tick:h.tick-T.KO_CREDIT-5};c.x=700;h.step();assert.equal(h.events.find(e=>e.type==='out').by,null);assert.equal(h.actors[0].kos,0);});
test('match ends at four crowns, or after nine rounds by crown count with ties drawn',()=>{
 const g=fixture();for(let r=0;r<T.CROWNS_TO_WIN;r++){assert.equal(g.phase,'running');winRound(g,0);if(g.stage==='intro')for(let i=0;i<T.INTRO_TICKS;i++)g.step();}assert.equal(g.phase,'over');assert.equal(g.result.outcome,'win');assert.deepEqual([...g.result.leaders],[0]);
 const l=fixture();for(let r=0;r<T.CROWNS_TO_WIN;r++){winRound(l,3);}assert.equal(l.result.outcome,'loss');
 const d=fixture();const order=[0,1,0,1,2,3,2,3,0];for(const w of order)winRound(d,w);assert.equal(d.round,T.MAX_ROUNDS);assert.equal(d.phase,'over');assert.equal(d.result.outcome,'win');
 const t=fixture();for(const w of [0,1,0,1,2,3,2,3])winRound(t,w);while(t.stage==='intro')t.step();t.actors.forEach(a=>{a.alive=false;});t.checkResult();for(let i=0;i<T.OUTRO_TICKS;i++)t.step();assert.equal(t.phase,'over');assert.equal(t.result.outcome,'draw');assert.equal(t.result.leaders.length,4);
});
test('AI styles choose center control, direct pursuit and flanking, gang up on the champion, and recover from the edge',()=>{
 const g=new T.Game(seeded(7));g.actors.forEach((a,i)=>{a.x=250+i*70;a.y=360;});g.aiInput(g.actors[1]);g.aiInput(g.actors[2]);const flank=g.aiInput(g.actors[3]);assert.match(g.actors[1].mode,/反擊/);assert.match(g.actors[2].mode,/猛攻/);assert.match(g.actors[3].mode,/包抄/);assert.ok(Math.abs(flank.y)>0);
 for(const a of g.actors.slice(1)){a.x=650;a.y=360;const i=g.aiInput(a);assert.ok(i.x<0);assert.match(a.mode,/回圈/);}
 const h=new T.Game(seeded(7));h.champion=0;h.streak=1;h.actors.forEach((a,i)=>{a.x=200+i*50;a.y=360;});h.actors[0].x=360;h.actors[3].x=330;h.aiInput(h.actors[2]);assert.match(h.actors[2].mode,/衛冕者/);
 // Before a stage shrinks, AI already treats the previewed boundary as the edge.
 const p=new T.Game(seeded(3));p.aiInput=T.Game.prototype.aiInput;p.roundTick=T.GRACE-20;const a=p.actors[1];a.x=360+262;a.y=360;p.actors.forEach(b=>{if(b!==a){b.x=360-200;b.y=360+b.id*20;}});assert.ok(p.aiInput(a).x<0);assert.match(a.mode,/回圈/);
});
test('40 seeded AI matches finish, play several rounds, crown different champions, and keep bounded physics',()=>{let rounds=0,defended=0,outs=0,dashes=0;const champions=new Set();for(let seed=1;seed<=40;seed++){const g=new T.Game(seeded(seed));g.start();while(g.phase==='running'){g.step(g.aiInput(g.actors[0]));assert.ok(g.round<=T.MAX_ROUNDS);assert.ok(g.roundTick<=T.roundLimit(g.round));assert.ok(g.waves.length<=8);for(const e of g.events){if(e.type==='out')outs++;if(e.type==='dash')dashes++;}for(const a of g.actors){assert.ok(Number.isFinite(a.x)&&Number.isFinite(a.y)&&Number.isFinite(a.vx)&&Number.isFinite(a.vy));assert.ok(Math.hypot(a.vx,a.vy)<=1000);assert.ok(a.charge>=0&&a.charge<=1&&a.cooldown>=0&&a.dashCd>=0);if(a.alive&&g.stage==='fight')assert.ok(T.distance(a,T.CENTER)+T.R<=T.ringAt(g.roundTick,g.round)+1e-8);}}
 rounds+=g.round;g.history.forEach((h,i)=>{if(h.winner!==null)champions.add(h.winner);if(i&&h.winner!==null&&h.winner===g.history[i-1].winner)defended++;});assert.ok(['win','loss','draw'].includes(g.result.outcome));assert.equal(g.history.length,g.round);}
 assert.ok(rounds/40>=4,'matches last several rounds');assert.equal(champions.size,4);assert.ok(defended>20&&defended<rounds*.6,'champions sometimes but not always defend: '+defended);assert.ok(outs>300);assert.ok(dashes>50);});

test('single-use anchor prevents impulses for five seconds, but never prevents shrink elimination',()=>{const g=fixture(),a=g.actors[0];a.item='anchor';assert.ok(g.useItem(a));assert.equal(a.anchor,250);assert.equal(g.useItem(a),false);g.applyPulse({owner:1,x:a.x-20,y:a.y,range:200,charge:2});assert.equal(a.vx,0);a.x=700;g.step();assert.equal(a.alive,false);});
test('shield saves exactly one boundary crossing and expires on simulation time',()=>{const g=fixture(),a=g.actors[0];a.item='shield';g.useItem(a);a.x=670;g.step();assert.equal(a.alive,true);assert.equal(a.shield,0);assert.ok(T.distance(a,T.CENTER)<T.ringAt(g.roundTick)-T.R);a.x=700;g.step();assert.equal(a.alive,false);});
test('super pulse has thirty ticks of warning and then attacks once',()=>{const g=fixture(),a=g.actors[0],b=g.actors[1];a.x=300;b.x=420;a.item='super';g.useItem(a);for(let i=0;i<29;i++)g.step();assert.equal(b.vx,0);g.step();assert.ok(b.vx>0);assert.equal(a.superAt,0);assert.equal(a.item,null);assert.ok(g.events.some(e=>e.type==='super'));});
test('black hole warning, attraction, owner exclusion and lifetime use the same clock',()=>{const g=fixture(),a=g.actors[0],b=g.actors[1];a.x=300;b.x=400;a.item='hole';g.useItem(a);for(let i=0;i<34;i++)g.step();assert.equal(b.vx,0);g.step();assert.ok(b.vx<0);assert.equal(a.vx,0);assert.equal(b.lastHit.by,0);g.pause();const state=JSON.stringify(g);g.step();assert.equal(JSON.stringify(g),state);g.reset();assert.equal(g.holes.length,0);assert.equal(g.pickups.length,0);});
test('AI uses visible danger and one carried item; pickups cannot exceed capacity',()=>{const g=fixture(),a=g.actors[1];g.aiInput=T.Game.prototype.aiInput;for(let i=0;i<10;i++)g.spawnItem();assert.equal(g.pickups.length,3);a.item='shield';a.x=620;assert.equal(g.aiInput(a).item,true);g.holes=[{x:a.x+30,y:a.y,owner:0,starts:g.tick+20,ends:g.tick+200}];assert.match((g.aiInput(a),a.mode),/黑洞/);});

test('options default to the original elite match and normalize bad input',()=>{
 assert.deepEqual({...T.normalizeOptions()},{tier:2,mutators:false,loadout:'none',aiLoadouts:false});
 assert.deepEqual({...T.normalizeOptions({tier:9,loadout:'rocket',mutators:1})},{tier:2,mutators:true,loadout:'none',aiLoadouts:false});
 assert.equal(T.normalizeOptions({tier:3}).aiLoadouts,true);
 // Same seed, explicit defaults: identical simulation to the no-options game.
 const a=new T.Game(seeded(5)),b=new T.Game(seeded(5),{tier:2});a.start();b.start();for(let i=0;i<1500;i++){a.step(a.aiInput(a.actors[0]));b.step(b.aiInput(b.actors[0]));}
 assert.equal(JSON.stringify(a.actors.map(x=>[x.x,x.y,x.crowns])),JSON.stringify(b.actors.map(x=>[x.x,x.y,x.crowns])));
});
test('lower tiers re-plan less often and sometimes miss a visible charge; legend AI carry loadouts',()=>{
 const g=new T.Game(seeded(2),{tier:0});g.start();let calls=0;const real=g.aiInput.bind(g);g.aiInput=a=>{calls++;return real(a);};for(let i=0;i<90;i++)g.step();assert.ok(calls<=3*11,'rookie thinks every 9 ticks: '+calls);
 const e=new T.Game(seeded(2));e.start();let c2=0;const r2=e.aiInput.bind(e);e.aiInput=a=>{c2++;return r2(a);};for(let i=0;i<90;i++)e.step();assert.equal(c2,270);
 const misses=new Set();for(let tick=0;tick<2000;tick+=25){g.tick=tick;misses.add(g.aiAlert(g.actors[1]));}assert.deepEqual([...misses].sort(),[false,true]);
 const l=new T.Game(seeded(2),{tier:3});assert.deepEqual([...l.actors.map(a=>a.loadout)],['none','heavy','quick','spring']);assert.ok(l.accelOf(l.actors[3])>l.accelOf(l.actors[0]));
});
test('loadouts change charge, mass, knockback, dash access and opening items',()=>{
 const base=fixture(),quick=new T.Game(seeded(1),{loadout:'quick'});quick.start();quick.aiInput=()=>({x:0,y:0,charge:false});
 for(let i=0;i<10;i++){base.step({charge:true});quick.step({charge:true});}assert.ok(quick.actors[0].charge>base.actors[0].charge);
 const heavy=new T.Game(seeded(1),{loadout:'heavy'});assert.ok(heavy.mass(heavy.actors[0])>heavy.mass(heavy.actors[1]));assert.ok(heavy.takenOf(heavy.actors[0])<1);
 const blink=new T.Game(seeded(1),{loadout:'blink'});blink.start();const a=blink.actors[0];assert.equal(blink.perks(a).dash,false);assert.ok(blink.canDash(a));assert.ok(blink.dash(a,{x:1,y:0}));assert.equal(a.dashCd,7);assert.equal(blink.canDash(blink.actors[1]),false);
 const scout=new T.Game(seeded(1),{loadout:'scout'});assert.ok(scout.actors[0].item);assert.equal(scout.actors[1].item,null);
});
test('mutators start from round two, draw from the seed, and change the arena rules',()=>{
 const g=new T.Game(seeded(4),{mutators:true});g.start();g.aiInput=idle;assert.equal(g.mutator,null);const seen=new Set();
 for(let r=0;r<8&&g.phase==='running';r++){winRound(g,r%4);if(g.phase!=='running')break;assert.ok(T.MUTATOR_IDS.includes(g.mutator));seen.add(g.mutator);if(g.mutator==='pillars')assert.equal(g.pillars.length,3);else assert.equal(g.pillars.length,0);}
 assert.ok(seen.size>=2,'several mutators appear: '+[...seen]);
 const ice=fixture(),slip=fixture();slip.mutator='ice';ice.step({x:1});slip.step({x:1});for(let i=0;i<20;i++){ice.step();slip.step();}assert.ok(slip.actors[0].vx>ice.actors[0].vx*1.5);
 const hv=fixture();hv.mutator='heavy';const nb=fixture();for(const q of [hv,nb])q.applyPulse({owner:0,x:q.actors[1].x-40,y:360,charge:.5,range:120});assert.ok(Math.abs(hv.actors[1].vx/nb.actors[1].vx-1.35)<1e-9);
 const rain=fixture();rain.mutator='rain';while(rain.roundTick<61)rain.step();assert.equal(rain.pickups.length,1);for(let i=0;i<10;i++)rain.spawnItem();assert.equal(rain.pickups.length,4);
 const pl=fixture();pl.mutator='pillars';pl.pillars=[{x:360,y:360,r:T.PILLAR_R}];const b=pl.actors[1];b.x=360-T.R-T.PILLAR_R+4;b.y=360;b.vx=200;pl.bumpPillars();assert.ok(b.vx<0);assert.ok(T.distance(b,{x:360,y:360})>=T.R+T.PILLAR_R-1e-9);
 pl.pillars=[{x:360+300,y:360,r:T.PILLAR_R}];pl.roundTick=T.GRACE+T.SHRINK;pl.step();assert.equal(pl.pillars.length,0);
});
test('mutator matches with legend AI stay bounded and finish',()=>{for(let seed=1;seed<=8;seed++){const g=new T.Game(seeded(seed),{tier:3,mutators:true,loadout:'blink'});g.start();let steps=0;while(g.phase==='running'&&steps<60000){g.step(g.aiInput(g.actors[0]));steps++;for(const a of g.actors)assert.ok(Number.isFinite(a.x)&&Number.isFinite(a.vx));}assert.equal(g.phase,'over');}});
test('career XP scales with performance and tier, levels unlock options, and bad saves are sanitized',()=>{
 assert.deepEqual({...Career.levelOf(0)},{level:1,into:0,need:160,max:false});assert.equal(Career.levelOf(160).level,2);assert.equal(Career.levelOf(1e9).level,Career.MAX_LEVEL);
 const win={outcome:'win',crowns:4,kos:5,hits:20,streak:3,tier:2,mutators:false},loss={...win,outcome:'loss',crowns:0,kos:0,hits:0,streak:0};
 assert.ok(Career.matchXP(win).total>Career.matchXP(loss).total);assert.ok(Career.matchXP({...win,tier:3}).total>Career.matchXP(win).total);assert.ok(Career.matchXP({...win,mutators:true}).total>Career.matchXP(win).total);
 assert.equal(Career.matchXP(loss).total,30);
 const r=Career.record(Career.blank(),win);assert.equal(r.profile.matches,1);assert.equal(r.profile.wins,1);assert.equal(r.profile.bestTier,2);assert.ok(r.after.level>1);assert.ok(r.unlocked.some(u=>u.kind==='loadout'));
 assert.equal(Career.unlocked(1,'tier',3),false);assert.equal(Career.unlocked(5,'tier',3),true);assert.equal(Career.unlocked(2,'mutators','on'),false);
 for(const u of Career.UNLOCKS){if(u.kind==='loadout')assert.ok(T.LOADOUTS[u.id]);if(u.kind==='tier')assert.ok(T.TIERS[u.id]);}
 assert.deepEqual({...Career.sanitize({xp:-5,wins:'x',kos:3.7})},{...Career.blank(),kos:3});
 const mem=new Map(),storage={getItem:k=>mem.get(k)??null,setItem:(k,v)=>mem.set(k,v)};assert.ok(Career.save(storage,r.profile));assert.equal(Career.load(storage).xp,r.profile.xp);mem.set(Career.KEY,'{broken');assert.equal(Career.load(storage).xp,0);
});
