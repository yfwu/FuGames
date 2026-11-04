/* Tux mountain courier. Seeded, DOM-free, fixed-step rules shared by all drivers.
   Options default to the original rules: tier 1 (標準), clear weather, parcel cargo, alpine route,
   no slipstream, no contract. Everything here runs unchanged in Node (tests, headless agents). */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.Tux2D=api;})(typeof window!=='undefined'?window:globalThis,function(){
'use strict';
const DT=1/60,LENGTH=7200,LIMIT=110;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
// Driver colours follow the shared FuPalette side order: seal (you), azure, jade, gold, orchid.
const PROFILES=[['Tux','#ff4b2b'],['Pip','#4fa3ff'],['Nova','#35d0a8'],['Mochi','#e9b949'],['Sunny','#b98cff']].map(([name,color])=>({name,color}));
const ITEMS={boost:{name:'衝刺',cost:30,key:'Shift'},shield:{name:'護盾',cost:25,key:'Space'},snowball:{name:'雪球',cost:20,key:'F'}};
const STATIONS=['松林','冰川','雪港'];

// ---------- Variants ----------
// AI tiers. Tier 1 is the original courier AI, byte for byte. Others are parameterised lane planners.
const TIERS=[
 {id:'rookie',name:'新手',copy:'反應慢、看得近、常走錯線，幾乎不丟雪球。',think:18,look:60,noise:.4,needE:10,needC:40,snowE:95,boostE:95,shieldLead:20,shotLead:40,snowRange:120,gain:2.4,greed:0,smart:false,draftSeek:false,brakes:false},
 {id:'standard',name:'標準',copy:'原版快遞 AI：看路、避車、會用三種道具。'},
 {id:'veteran',name:'老練',copy:'看得更遠、挑空檔車道、追尾流，雪球更積極。',think:5,look:220,noise:.05,needE:26,needC:66,snowE:40,boostE:55,shieldLead:62,shotLead:130,snowRange:300,gain:4.8,greed:.6,smart:false,draftSeek:true,brakes:true},
 {id:'master',name:'宗師',copy:'每幀判斷、搶電池、追尾流，提早開盾擋雪球。',think:1,look:220,noise:0,needE:26,needC:66,snowE:36,boostE:55,shieldLead:72,shotLead:170,snowRange:320,gain:4.8,greed:1,smart:false,draftSeek:true,brakes:true}
];
const WEATHER={
 clear:{name:'晴朗',copy:'視野清楚，路面正常。',grip:1,maxAdj:0,wind:0},
 snow:{name:'大雪',copy:'新雪讓轉向 −15%、極速 −6，視線變短。',grip:.85,maxAdj:-6,wind:0},
 gale:{name:'側風',copy:'陣風把車推向路肩；轉向 −10%、極速 −4。',grip:.9,maxAdj:-4,wind:.22}
};
const CARGO={
 parcel:{name:'包裹',copy:'標準貨物：撞擊 −14，每站完整度 ×3 分。',damage:14,mult:3,accel:60,maxAdj:0,keep:.48,decay:0,timeBonus:10},
 fragile:{name:'易碎瓷器',copy:'撞擊 −22，但每站 ×4.2 分。',damage:22,mult:4.2,accel:60,maxAdj:0,keep:.48,decay:0,timeBonus:10},
 heavy:{name:'重型零件',copy:'起步慢、極速 −8；撞擊只 −9、不易被撞停。',damage:9,mult:3.3,accel:44,maxAdj:-8,keep:.7,decay:0,timeBonus:10},
 fresh:{name:'生鮮漁獲',copy:'貨物每秒自然 −0.35，完程每秒剩餘 +16 分。',damage:14,mult:3.6,accel:60,maxAdj:0,keep:.48,decay:.35,timeBonus:16}
};
const ROUTES={
 alpine:{name:'松林線',copy:'原版三站山路。',curve:1,extraRocks:0,extraTraffic:0,rockfall:false,mainIce:false},
 canyon:{name:'落石峽谷',copy:'彎更急、車更多；山壁會預警後落石。',curve:1.35,extraRocks:2,extraTraffic:1,rockfall:true,mainIce:false},
 glacier:{name:'冰河高原',copy:'主線也有大片冰面：轉向打滑、煞車變長。',curve:1.1,extraRocks:0,extraTraffic:0,rockfall:false,mainIce:true}
};
const CONTRACTS={
 intact:{name:'完好無損',copy:'三站都以 ≥ 80% 貨物送達。',xp:90,check:(g,r)=>r.parcels===3&&r.stats.minCargo>=80},
 win:{name:'榜首快遞',copy:'本局積分第 1 名。',xp:100,check:(g,r)=>g.standings()[0].id===r.id},
 sniper:{name:'雪球狙擊',copy:'雪球命中對手 3 次。',xp:80,check:(g,r)=>r.stats.snowHits>=3},
 express:{name:'全程快線',copy:'三個岔路都走冰面快線並完程。',xp:85,check:(g,r)=>r.finished&&r.stats.express>=3},
 untouched:{name:'零擦撞',copy:'完程且沒有受到任何傷害。',xp:120,check:(g,r)=>r.finished&&r.stats.hits===0},
 swift:{name:'限時專送',copy:'80 秒內送達第三站。',xp:95,check:(g,r)=>r.finished&&r.finishTime<=80},
 collector:{name:'電池收集',copy:'撿到 8 顆以上電池。',xp:70,check:(g,r)=>r.stats.pickups>=8}
};

function random(seed){let n=2166136261;for(const c of String(seed))n=Math.imul(n^c.charCodeAt(0),16777619);return()=>{n+=0x6D2B79F5;let t=n;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
// Pure hash noise in [-1,1] for AI imprecision: no shared RNG is consumed.
function noise(a,b){let h=Math.imul(a+1,374761393)^Math.imul(b+7,668265263);h=Math.imul(h^h>>>13,1274126177);return(((h^h>>>16)>>>0)/4294967296)*2-1;}
function roadCenter(z){return Math.sin(z/850)*510+Math.sin(z/1900)*700;}
function tangent(z){return Math.cos(z/850)*.6+Math.cos(z/1900)*700/1900;}
function road(z){const local=((z%2400)+2400)%2400;return {stage:Math.max(1,Math.min(3,Math.floor(z/2400)+1)),local,fork:local>=900&&local<1550,approach:local>=540&&local<900,ice:local>=1070&&local<1430,curve:-Math.sin(z/850)*.6-Math.sin(z/1900)*.16};}
// Main-road ice sheets on the glacier route (outside the fork).
const mainIceAt=local=>(local>=180&&local<480)||(local>=1700&&local<2080);

function chooseAI(view,id){
 const r=view.racers[id];if(!r||r.finished)return {};
 const at=road(r.z),need=r.energy<18+id*6||r.cargo<52+id*6;
 let target=(id%3-1)*.48;
 if(at.approach||at.fork)target=need?-.58:.58;
 const threats=[...view.objects.filter(o=>o.type==='rock'||o.type==='traffic'),...view.racers.filter(o=>o.id!==id&&!o.finished)].filter(o=>o.z>r.z&&o.z-r.z<160&&Math.abs(o.x-r.x)<.32);
 if(threats.length){const o=threats[0];target=at.fork?(r.x<0?(o.x<-.58?-.3:-.85):(o.x<.58?.86:.3)):(o.x>0?-.55:.55);}
 const danger=threats.some(o=>o.z-r.z<58)||view.shots.some(o=>o.owner!==id&&o.z<r.z&&r.z-o.z<100&&Math.abs(o.x-r.x)<.25);
 const victim=view.racers.some(o=>o.id!==id&&!o.finished&&o.z>r.z&&o.z-r.z<280&&Math.abs(o.x-r.x)<.22);
 let action=danger&&r.shield<=0?'shield':victim&&r.energy>=50?'snowball':r.energy>=60&&!at.fork&&!threats.length?'boost':null;
 return {steer:clamp((target-r.x)*4.5+at.curve*(view.curveScale||1)*.17,-1,1),brake:(view.route&&view.route!=='alpine'?r.speed>8:true)&&threats.some(o=>o.z-r.z<28)&&r.shield<=0,action};
}
// Lane planner for tiers 0, 2, 3: scores candidate lanes by clearance, batteries and slipstream.
function chooseAITier(view,id,T){
 const r=view.racers[id];if(!r||r.finished)return {};
 const at=road(r.z),stage=Math.floor(r.z/2400),committed=at.fork&&r.routeStage===stage;
 const leader=view.racers.filter(o=>o.id!==id).reduce((a,o)=>o.score>a.score?o:a,{score:-1});
 let need=r.energy<T.needE+id*3||r.cargo<T.needC+id*3;
 if(T.smart&&r.cargo<60)need=true;
 const supplyLanes=[-.85,-.58,-.3],expressLanes=[.3,.58,.86];
 let lanes=[-.55,0,.55];
 if(committed)lanes=r.route==='supply'?supplyLanes:expressLanes;
 else if(at.approach||at.fork)lanes=need?supplyLanes:expressLanes;
 const hazards=[...view.objects.filter(o=>o.type==='rock'||o.type==='traffic'),...view.racers.filter(o=>o.id!==id&&!o.finished)].filter(o=>o.z>r.z&&o.z-r.z<T.look);
 const clear=lane=>{let d=T.look;for(const o of hazards)if(Math.abs(o.x-lane)<.3)d=Math.min(d,o.z-r.z);return d;};
 let best=lanes[0],bestScore=-Infinity;
 for(const lane of lanes){
  let s=clear(lane)-Math.abs(lane-r.x)*45;
  if(T.greed)for(const o of view.objects)if(o.type==='energy'&&!o.taken.includes(id)&&o.z>r.z+20&&o.z-r.z<T.look&&Math.abs(o.x-lane)<.2)s+=60*T.greed*(r.energy<80?1:.3);
  if(T.draftSeek&&view.draft)for(const o of view.racers)if(o.id!==id&&!o.finished&&o.z-r.z>20&&o.z-r.z<90&&Math.abs(o.x-lane)<.18&&clear(lane)>o.z-r.z-1)s+=25;
  if(s>bestScore){bestScore=s;best=lane;}
 }
 const target=best+T.noise*noise(id,Math.floor((view.ticks||0)/30));
 const inLane=hazards.filter(o=>Math.abs(o.x-r.x)<.3);
 const danger=inLane.some(o=>o.z-r.z<T.shieldLead)||view.shots.some(o=>o.owner!==id&&o.z<r.z&&r.z-o.z<T.shotLead&&Math.abs(o.x-r.x)<.25);
 const victims=view.racers.filter(o=>o.id!==id&&!o.finished&&o.z>r.z&&o.z-r.z<T.snowRange&&Math.abs(o.x-r.x)<.2&&(!T.smart||o.shield<=0));
 const victim=victims.length>0;
 const open=clear(r.x)>=Math.min(150,T.look);
 let action=null;
 if(danger&&r.shield<=0&&r.energy>=ITEMS.shield.cost)action='shield';
 else if(victim&&r.energy>=T.snowE)action='snowball';
 else if(r.energy>=T.boostE&&(!at.fork||T.smart&&r.x>0)&&open&&r.boost<=0)action='boost';
 return {steer:clamp((target-r.x)*T.gain+at.curve*(view.curveScale||1)*.17,-1,1),brake:T.brakes&&r.speed>40&&inLane.some(o=>o.z-r.z<28&&Math.abs(o.x-r.x)<.23)&&r.shield<=0,action};
}
function aiControl(view,id,tier=1){return tier===1||!TIERS[tier]?chooseAI(view,id):chooseAITier(view,id,TIERS[tier]);}

class Game{
 constructor(options={}){
  this.seed=options.seed||'alpine-post';this.spectator=!!options.spectator;
  this.tier=TIERS[options.tier]?Number(options.tier):1;
  this.weather=WEATHER[options.weather]?options.weather:'clear';
  this.cargo=CARGO[options.cargo]?options.cargo:'parcel';
  this.route=ROUTES[options.route]?options.route:'alpine';
  this.draft=!!options.draft;
  // Optional per-driver tiers (e.g. a mixed field for agents or studies); otherwise every AI uses `tier`.
  this.tiers=Array.isArray(options.tiers)?PROFILES.map((p,i)=>TIERS[options.tiers[i]]?Number(options.tiers[i]):this.tier):null;
  this.contract=CONTRACTS[options.contract]?options.contract:null;
  this.reset();
 }
 get mods(){const w=WEATHER[this.weather],c=CARGO[this.cargo],rt=ROUTES[this.route];return{grip:w.grip,wind:w.wind,maxAdj:w.maxAdj+c.maxAdj,damage:c.damage,mult:c.mult,accel:c.accel,keep:c.keep,decay:c.decay,timeBonus:c.timeBonus,curve:rt.curve,mainIce:rt.mainIce,rockfall:rt.rockfall};}
 get curveScale(){return ROUTES[this.route].curve;}
 tierOf(id){return this.tiers?this.tiers[id]:this.tier;}
 options(){return{seed:this.seed,spectator:this.spectator,tier:this.tier,tiers:this.tiers,weather:this.weather,cargo:this.cargo,route:this.route,draft:this.draft,contract:this.contract};}
 reset(seed=this.seed){this.seed=String(seed);this.random=random(this.seed);this.phase='ready';this.resumePhase='racing';this.countdown=2;this.elapsed=0;this.ticks=0;this.events=[];this.eventId=0;this.shots=[];this.result=null;this.telemetry={hits:0,blocks:0,pickups:0,boost:0,shield:0,snowball:0,supply:0,express:0,deliveries:0};
 this.racers=PROFILES.map((p,id)=>({...p,id,z:-id*18,x:(id%3-1)*.48,speed:0,energy:65,cargo:100,parcels:0,score:0,boost:0,shield:0,invulnerable:0,cooldown:0,finished:false,finishTime:null,route:null,routeStage:-1,supplied:-1,lastAction:null,hit:0,drafting:false,stats:{hits:0,blocks:0,snowHits:0,pickups:0,supply:0,express:0,minCargo:100}}));
 this.objects=[];
 for(let stage=0;stage<3;stage++){const base=stage*2400;
 for(let i=0;i<7;i++)this.objects.push({id:this.objects.length,type:'energy',z:base+290+i*280,x:i>=3&&i<=4?-.58:[-.58,0,.58][i%3],taken:[]});
 for(const [z,x]of [[1140,.36],[1370,.83],[1830,-.45],[2120,.5]])this.objects.push({id:this.objects.length,type:'rock',z:base+z,x,taken:[]});
 for(let i=0;i<3;i++)this.objects.push({id:this.objects.length,type:'traffic',z:base+480+i*640,x:(this.random()>.5?1:-1)*.48,speed:36+this.random()*9,taken:[]});
 }
 const rt=ROUTES[this.route];
 // Extra route hazards draw from their own stream so the original layout is untouched.
 const extra=random(this.seed+'|'+this.route);
 for(let stage=0;stage<3;stage++){const base=stage*2400;
  for(let i=0;i<rt.extraRocks;i++)this.objects.push({id:this.objects.length,type:'rock',z:base+300+i*1100+Math.floor(extra()*300),x:[-.55,0,.55][Math.floor(extra()*3)],taken:[]});
  for(let i=0;i<rt.extraTraffic;i++)this.objects.push({id:this.objects.length,type:'traffic',z:base+760+Math.floor(extra()*300),x:(extra()>.5?1:-1)*.48,speed:32+extra()*8,taken:[]});
 }
 this.fallRandom=random(this.seed+'|rockfall');this.nextFall=rt.rockfall?7:Infinity;this.windPhase=random(this.seed+'|wind')()*Math.PI*2;
 this.aiMemory=[];
 return this;}
 road(z){const at=road(z);if(this.route!=='alpine'){at.curve*=this.curveScale;at.mainIce=ROUTES[this.route].mainIce&&!at.fork&&mainIceAt(at.local);}return at;}
 center(z){return roadCenter(z)*this.curveScale;}
 wind(){return WEATHER[this.weather].wind?Math.sin(this.elapsed*.5+this.windPhase)*WEATHER[this.weather].wind:0;}
 start(){if(this.phase==='ready')this.phase='countdown';else if(this.phase==='paused')this.phase=this.resumePhase;return this.phase;}
 pause(){if(['racing','countdown'].includes(this.phase)){this.resumePhase=this.phase;this.phase='paused';}return this.phase;}
 event(type,r,extra={}){this.events.push({id:this.eventId++,type,racer:r.id,time:this.elapsed,...extra});if(this.events.length>48)this.events.shift();}
 use(r,action){const item=ITEMS[action];if(!item||r.finished||r.cooldown>0||r.energy<item.cost)return false;if(action==='shield'&&r.shield>0||action==='boost'&&r.boost>0)return false;
 r.energy-=item.cost;r.cooldown=.4;this.telemetry[action]++;this.event(action,r);
 if(action==='boost')r.boost=2.3;else if(action==='shield')r.shield=4;else this.shots.push({owner:r.id,z:r.z+15,x:r.x,life:2});return true;}
 hit(r,source,by=null){if(r.finished||r.invulnerable>0)return false;const m=this.mods;
 if(r.shield>0){r.shield=0;r.invulnerable=.65;this.telemetry.blocks++;r.stats.blocks++;this.event('block',r,{source,by});}
 else{r.cargo=Math.max(0,r.cargo-m.damage);r.speed*=m.keep;r.invulnerable=1.3;r.hit=.35;this.telemetry.hits++;r.stats.hits++;if(by!==null&&this.racers[by])this.racers[by].stats.snowHits++;this.event('hit',r,{source,by});}
 return true;}
 drive(r,input){const oldZ=r.z,m=this.mods,at=this.road(r.z);for(const k of ['boost','shield','invulnerable','cooldown','hit'])r[k]=Math.max(0,r[k]-DT);
 if(input.action!==r.lastAction)this.use(r,input.action);r.lastAction=input.action||null;
 const steer=clamp(Number(input.steer)||0,-1,1),brake=!!input.brake;
 if(this.draft){r.drafting=false;for(const o of this.racers)if(o!==r&&!o.finished&&o.z-r.z>8&&o.z-r.z<70&&Math.abs(o.x-r.x)<.2){r.drafting=true;break;}}
 const off=Math.abs(r.x)>1;let max=off?48:at.fork?(r.x<0?68:120):100;if(r.boost>0)max+=38;
 if(m.maxAdj)max+=m.maxAdj;if(r.drafting)max+=10;
 const accel=brake?(at.mainIce?-90:-150):m.accel+(r.drafting?18:0);
 r.speed=clamp(r.speed+accel*DT,0,max);
 let grip=at.ice&&r.x>0?1.15:1.55;if(at.mainIce)grip=1.1;if(m.grip!==1)grip*=m.grip;
 r.x=clamp(r.x+(steer*grip-at.curve*r.speed/100*.24)*DT*(.25+r.speed/125),-1.35,1.35);
 if(m.wind)r.x=clamp(r.x+this.wind()*DT*(r.speed/100),-1.35,1.35);
 // Crossing the median is impossible after entering a fork. All drivers commit by steering.
 if(at.fork&&r.routeStage===Math.floor(r.z/2400))r.x=r.route==='supply'?Math.min(-.21,r.x):Math.max(.21,r.x);
 r.z+=r.speed*DT;
 if(m.decay)r.cargo=Math.max(0,r.cargo-m.decay*DT);
 const now=road(r.z),stage=Math.floor(r.z/2400);
 if(now.fork&&r.routeStage!==stage){r.route=r.x<=0?'supply':'express';r.routeStage=stage;r.x=r.route==='supply'?Math.min(-.21,r.x):Math.max(.21,r.x);this.telemetry[r.route]++;r.stats[r.route]++;this.event('route',r,{route:r.route});}
 if(now.fork&&r.route==='supply'&&now.local>=1250&&r.supplied!==stage){r.energy=Math.min(100,r.energy+45);r.cargo=Math.min(100,r.cargo+25);r.supplied=stage;this.event('supply',r);}
 for(const o of this.objects){if(o.taken.includes(r.id))continue;if(o.fallAt!==undefined&&o.fallAt>this.elapsed)continue;const relBefore=o.previousZ===undefined?o.z:o.previousZ;if(oldZ<=relBefore+9&&r.z>=o.z-9&&Math.abs(r.x-o.x)<(o.type==='energy'?.25:.23)){
 if(o.type==='energy'){o.taken.push(r.id);r.energy=Math.min(100,r.energy+18);r.score+=20;this.telemetry.pickups++;r.stats.pickups++;this.event('energy',r);}else this.hit(r,o.type);
 }}
 const delivered=Math.min(3,Math.floor(Math.max(0,r.z)/2400));if(delivered>r.parcels){r.parcels=delivered;r.score+=Math.round(r.cargo*m.mult);r.stats.minCargo=Math.min(r.stats.minCargo,Math.round(r.cargo));this.telemetry.deliveries++;this.event('delivery',r,{station:delivered,cargo:Math.round(r.cargo),points:Math.round(r.cargo*m.mult)});}
 if(r.z>=LENGTH){r.z=LENGTH;r.finished=true;r.finishTime=this.elapsed;r.speed=0;r.score+=Math.max(0,Math.round((LIMIT-this.elapsed)*m.timeBonus));this.event('finish',r);}
 }
 rockfall(){
  if(this.elapsed<this.nextFall)return;
  const rf=this.fallRandom,lead=this.racers.filter(r=>!r.finished).reduce((a,r)=>Math.max(a,r.z),0);
  this.nextFall=this.elapsed+6+rf()*4;
  const z=Math.round(lead+300+rf()*200);if(z>LENGTH-80)return;
  const at=road(z),x=at.fork||at.approach?[-.6,.6][Math.floor(rf()*2)]:[-.55,0,.55][Math.floor(rf()*3)];
  this.objects.push({id:this.objects.length,type:'rock',z,x,taken:[],fallAt:this.elapsed+1.6,falling:true});
  this.event('rockfall',{id:-1},{z,x});
 }
 step(input={}){if(this.phase==='countdown'){this.countdown=Math.max(0,this.countdown-DT);if(this.countdown<1e-8)this.phase='racing';return true;}if(this.phase!=='racing')return false;this.elapsed+=DT;this.ticks++;
 for(const o of this.objects){o.previousZ=o.z;if(o.type==='traffic'){o.z+=o.speed*DT;const at=road(o.z);if(at.fork)o.x=o.x<0?-.55:.55;}}
 if(this.nextFall!==Infinity)this.rockfall();
 const view=this.observation();
 const controls=this.racers.map(r=>{if(r.id===0&&!this.spectator)return input;
  const tier=this.tierOf(r.id),think=TIERS[tier].think||1;
  if(think>1){const mem=this.aiMemory[r.id];if(mem&&this.ticks-mem.tick<think)return mem.control;const control=aiControl(view,r.id,tier);this.aiMemory[r.id]={tick:this.ticks,control};return control;}
  return aiControl(view,r.id,tier);});
 for(const r of this.racers)if(!r.finished)this.drive(r,controls[r.id]);
 for(let i=0;i<this.racers.length;i++)for(let j=i+1;j<this.racers.length;j++){const a=this.racers[i],b=this.racers[j];if(!a.finished&&!b.finished&&Math.abs(a.z-b.z)<12&&Math.abs(a.x-b.x)<.22){this.hit(a,'racer');this.hit(b,'racer');const side=a.x<=b.x?-1:1;a.x=clamp(a.x+side*.06,-1.35,1.35);b.x=clamp(b.x-side*.06,-1.35,1.35);}}
 for(const p of this.shots){const before=p.z;p.z+=230*DT;p.life-=DT;for(const r of this.racers)if(r.id!==p.owner&&!r.finished&&r.z>=before-8&&r.z<=p.z+8&&Math.abs(r.x-p.x)<.23&&this.hit(r,'snowball',p.owner)){p.life=0;break;}}
 this.shots=this.shots.filter(p=>p.life>0);
 if((!this.spectator&&this.racers[0].finished)||this.racers.every(r=>r.finished)||this.elapsed>=LIMIT){this.phase='over';this.result={standings:this.standings(),time:this.elapsed,timeout:!this.racers[0].finished,contract:this.contractResult()};}
 return true;}
 contractResult(){if(!this.contract)return null;const c=CONTRACTS[this.contract],r=this.racers[0];return{id:this.contract,name:c.name,xp:c.xp,ok:!this.spectator&&!!c.check(this,r)};}
 standings(){return this.racers.slice().sort((a,b)=>b.score-a.score||b.z-a.z||a.id-b.id).map((r,i)=>({id:r.id,name:r.name,rank:i+1,score:r.score,parcels:r.parcels,cargo:Math.round(r.cargo),finished:r.finished,time:r.finishTime,z:r.z}));}
 observation(){return{phase:this.phase,elapsed:this.elapsed,ticks:this.ticks,route:this.route,curveScale:this.curveScale,draft:this.draft,racers:this.racers.map(r=>({...r,stats:{...r.stats}})),objects:this.objects.map(o=>({...o,taken:[...o.taken]})),shots:this.shots.map(s=>({...s})),standings:this.standings(),telemetry:{...this.telemetry}};}
 // Summary of the player's run for the career module.
 summary(){const r=this.racers[0],me=this.standings().find(s=>s.id===0),c=this.contractResult();return{spectator:this.spectator,tier:this.tier,weather:this.weather,cargo:this.cargo,route:this.route,rank:me.rank,score:r.score,parcels:r.parcels,finished:r.finished,time:r.finishTime,cargoLeft:Math.round(r.cargo),snowHits:r.stats.snowHits,hits:r.stats.hits,contract:c?c.id:null,contractOk:!!(c&&c.ok)};}
}

// ---------- Career: pure progression over a small saved profile ----------
const Career=(()=>{
 const MAX_LEVEL=30,KEY='tux2d-career',VERSION=1;
 const need=level=>140+level*45;
 function levelOf(xp){let level=1,rest=Math.max(0,Math.floor(Number(xp)||0));while(level<MAX_LEVEL&&rest>=need(level)){rest-=need(level);level++;}return{level,into:level<MAX_LEVEL?rest:0,need:level<MAX_LEVEL?need(level):0,max:level>=MAX_LEVEL};}
 const RANKS=[{from:1,name:'見習郵差'},{from:4,name:'山路信差'},{from:8,name:'雪線快遞'},{from:13,name:'隘口老手'},{from:19,name:'冰川傳說'},{from:25,name:'雪港郵王'}];
 const rankOf=level=>RANKS.filter(r=>level>=r.from).pop().name;
 const UNLOCKS=[
  {level:1,kind:'tier',id:0},{level:1,kind:'tier',id:1},{level:1,kind:'weather',id:'clear'},{level:1,kind:'cargo',id:'parcel'},{level:1,kind:'route',id:'alpine'},
  {level:1,kind:'contract',id:'intact'},{level:1,kind:'contract',id:'collector'},
  {level:2,kind:'weather',id:'snow'},{level:2,kind:'contract',id:'sniper'},
  {level:3,kind:'tier',id:2},{level:3,kind:'route',id:'canyon'},
  {level:4,kind:'cargo',id:'fragile'},{level:4,kind:'contract',id:'win'},
  {level:5,kind:'cargo',id:'heavy'},{level:5,kind:'contract',id:'express'},
  {level:6,kind:'weather',id:'gale'},
  {level:7,kind:'tier',id:3},{level:7,kind:'contract',id:'swift'},
  {level:8,kind:'route',id:'glacier'},
  {level:9,kind:'cargo',id:'fresh'},{level:10,kind:'contract',id:'untouched'}
 ];
 const unlockLevel=(kind,id)=>{const u=UNLOCKS.find(u=>u.kind===kind&&u.id===id);return u?u.level:Infinity;};
 const unlocked=(level,kind,id)=>level>=unlockLevel(kind,id);
 const TIER_XP=[.6,1,1.3,1.7],WEATHER_XP={clear:1,snow:1.1,gale:1.2},CARGO_XP={parcel:1,fragile:1.15,heavy:1.1,fresh:1.15},ROUTE_XP={alpine:1,canyon:1.15,glacier:1.1};
 const PLACE=[120,70,40,20,10];
 function multiplier(s){return(TIER_XP[s.tier]??1)*(WEATHER_XP[s.weather]??1)*(CARGO_XP[s.cargo]??1)*(ROUTE_XP[s.route]??1);}
 function matchXP(s){
  if(!s||s.spectator)return{lines:[],base:0,mult:0,total:0};
  const lines=[['完成配送',20]];
  if(s.parcels)lines.push([`送達 ${s.parcels} 站`,25*s.parcels]);
  if(s.finished)lines.push(['抵達雪港',40]);
  const place=PLACE[(s.rank||5)-1]||0;if(place)lines.push([`積分第 ${s.rank} 名`,place]);
  const pts=Math.min(80,Math.floor((s.score||0)/40));if(pts)lines.push(['配送積分',pts]);
  const snow=Math.min(50,10*(s.snowHits||0));if(snow)lines.push(['雪球命中',snow]);
  if(s.contract&&s.contractOk&&CONTRACTS[s.contract])lines.push([`委託：${CONTRACTS[s.contract].name}`,CONTRACTS[s.contract].xp]);
  const base=lines.reduce((n,l)=>n+l[1],0),mult=multiplier(s),total=Math.round(base*mult);
  return{lines,base,mult,total};
 }
 const blank=()=>({v:VERSION,xp:0,runs:0,wins:0,deliveries:0,finishes:0,contracts:0,bestScore:0,bestTier:-1,fastest:0});
 function sanitize(p){const b=blank();if(!p||typeof p!=='object')return b;for(const k of Object.keys(b))if(Number.isFinite(p[k])&&p[k]>=(k==='bestTier'?-1:0))b[k]=k==='fastest'?Math.round(p[k]*10)/10:Math.floor(p[k]);return b;}
 function record(profile,s){
  const p=sanitize(profile),gain=matchXP(s),before=levelOf(p.xp);
  if(!s||s.spectator)return{profile:p,gain,before,after:before,unlocked:[]};
  const win=s.rank===1;
  const next={...p,xp:p.xp+gain.total,runs:p.runs+1,wins:p.wins+(win?1:0),deliveries:p.deliveries+(s.parcels||0),finishes:p.finishes+(s.finished?1:0),contracts:p.contracts+(s.contractOk?1:0),bestScore:Math.max(p.bestScore,s.score||0),bestTier:win?Math.max(p.bestTier,s.tier):p.bestTier,fastest:s.finished&&s.time&&(!p.fastest||s.time<p.fastest)?Math.round(s.time*10)/10:p.fastest};
  const after=levelOf(next.xp);
  return{profile:next,gain,before,after,unlocked:UNLOCKS.filter(u=>u.level>before.level&&u.level<=after.level)};
 }
 // Three contracts offered per run, rotating with the run count; only unlocked ones.
 function offers(level,runs){const ids=Object.keys(CONTRACTS).filter(id=>unlocked(level,'contract',id)),n=ids.length,out=[];for(let i=0;i<Math.min(3,n);i++)out.push(ids[((runs||0)*2+i)%n]);return out;}
 function load(storage){try{return sanitize(JSON.parse(storage.getItem(KEY)||'null'));}catch(e){return blank();}}
 function save(storage,p){try{storage.setItem(KEY,JSON.stringify(sanitize(p)));return true;}catch(e){return false;}}
 return{MAX_LEVEL,KEY,need,levelOf,rankOf,RANKS,UNLOCKS,unlockLevel,unlocked,multiplier,matchXP,blank,sanitize,record,offers,load,save};
})();

return{Game,DT,LENGTH,LIMIT,ITEMS,PROFILES,STATIONS,TIERS,WEATHER,CARGO,ROUTES,CONTRACTS,Career,road,roadCenter,tangent,mainIceAt,chooseAI,chooseAITier,aiControl,noise,clamp};
});
