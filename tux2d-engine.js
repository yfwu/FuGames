/* Tux mountain courier. Seeded, DOM-free, fixed-step rules shared by all drivers. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.Tux2D=api;})(typeof window!=='undefined'?window:globalThis,function(){
'use strict';
const DT=1/60,LENGTH=7200,LIMIT=110;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const PROFILES=[['Tux','#35b9ad'],['Pip','#f19857'],['Nova','#bd91df'],['Mochi','#7eaff4'],['Sunny','#f5cf65']].map(([name,color])=>({name,color}));
const ITEMS={boost:{name:'衝刺',cost:30,key:'Shift'},shield:{name:'護盾',cost:25,key:'Space'},snowball:{name:'雪球',cost:20,key:'F'}};
function random(seed){let n=2166136261;for(const c of String(seed))n=Math.imul(n^c.charCodeAt(0),16777619);return()=>{n+=0x6D2B79F5;let t=n;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
function roadCenter(z){return Math.sin(z/850)*510+Math.sin(z/1900)*700;}
function tangent(z){return Math.cos(z/850)*.6+Math.cos(z/1900)*700/1900;}
function road(z){const local=((z%2400)+2400)%2400;return {stage:Math.max(1,Math.min(3,Math.floor(z/2400)+1)),local,fork:local>=900&&local<1550,approach:local>=540&&local<900,ice:local>=1070&&local<1430,curve:-Math.sin(z/850)*.6-Math.sin(z/1900)*.16};}
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
 return {steer:clamp((target-r.x)*4.5+at.curve*.17,-1,1),brake:threats.some(o=>o.z-r.z<28)&&r.shield<=0,action};
}
class Game{
 constructor(options={}){this.seed=options.seed||'alpine-post';this.spectator=!!options.spectator;this.reset();}
 reset(seed=this.seed){this.seed=String(seed);this.random=random(this.seed);this.phase='ready';this.resumePhase='racing';this.countdown=2;this.elapsed=0;this.ticks=0;this.events=[];this.eventId=0;this.shots=[];this.result=null;this.telemetry={hits:0,blocks:0,pickups:0,boost:0,shield:0,snowball:0,supply:0,express:0,deliveries:0};
 this.racers=PROFILES.map((p,id)=>({...p,id,z:-id*18,x:(id%3-1)*.48,speed:0,energy:65,cargo:100,parcels:0,score:0,boost:0,shield:0,invulnerable:0,cooldown:0,finished:false,finishTime:null,route:null,routeStage:-1,supplied:-1,lastAction:null,hit:0}));
 this.objects=[];
 for(let stage=0;stage<3;stage++){const base=stage*2400;
 for(let i=0;i<7;i++)this.objects.push({id:this.objects.length,type:'energy',z:base+290+i*280,x:i>=3&&i<=4?-.58:[-.58,0,.58][i%3],taken:[]});
 for(const [z,x]of [[1140,.36],[1370,.83],[1830,-.45],[2120,.5]])this.objects.push({id:this.objects.length,type:'rock',z:base+z,x,taken:[]});
 for(let i=0;i<3;i++)this.objects.push({id:this.objects.length,type:'traffic',z:base+480+i*640,x:(this.random()>.5?1:-1)*.48,speed:36+this.random()*9,taken:[]});
 }return this;}
 start(){if(this.phase==='ready')this.phase='countdown';else if(this.phase==='paused')this.phase=this.resumePhase;return this.phase;}
 pause(){if(['racing','countdown'].includes(this.phase)){this.resumePhase=this.phase;this.phase='paused';}return this.phase;}
 event(type,r,extra={}){this.events.push({id:this.eventId++,type,racer:r.id,time:this.elapsed,...extra});if(this.events.length>48)this.events.shift();}
 use(r,action){const item=ITEMS[action];if(!item||r.finished||r.cooldown>0||r.energy<item.cost)return false;if(action==='shield'&&r.shield>0||action==='boost'&&r.boost>0)return false;
 r.energy-=item.cost;r.cooldown=.4;this.telemetry[action]++;this.event(action,r);
 if(action==='boost')r.boost=2.3;else if(action==='shield')r.shield=4;else this.shots.push({owner:r.id,z:r.z+15,x:r.x,life:2});return true;}
 hit(r,source){if(r.finished||r.invulnerable>0)return false;if(r.shield>0){r.shield=0;r.invulnerable=.65;this.telemetry.blocks++;this.event('block',r,{source});}else{r.cargo=Math.max(0,r.cargo-14);r.speed*=.48;r.invulnerable=1.3;r.hit=.35;this.telemetry.hits++;this.event('hit',r,{source});}return true;}
 drive(r,input){const oldZ=r.z,at=road(r.z);for(const k of ['boost','shield','invulnerable','cooldown','hit'])r[k]=Math.max(0,r[k]-DT);
 if(input.action!==r.lastAction)this.use(r,input.action);r.lastAction=input.action||null;
 const steer=clamp(Number(input.steer)||0,-1,1),brake=!!input.brake;
 const off=Math.abs(r.x)>1;let max=off?48:at.fork?(r.x<0?68:120):100;if(r.boost>0)max+=38;
 r.speed=clamp(r.speed+(brake?-150:60)*DT,0,max);
 r.x=clamp(r.x+(steer*(at.ice&&r.x>0?1.15:1.55)-at.curve*r.speed/100*.24)*DT*(.25+r.speed/125),-1.35,1.35);
 // Crossing the median is impossible after entering a fork. All drivers commit by steering.
 if(at.fork&&r.routeStage===Math.floor(r.z/2400))r.x=r.route==='supply'?Math.min(-.21,r.x):Math.max(.21,r.x);
 r.z+=r.speed*DT;
 const now=road(r.z),stage=Math.floor(r.z/2400);
 if(now.fork&&r.routeStage!==stage){r.route=r.x<=0?'supply':'express';r.routeStage=stage;r.x=r.route==='supply'?Math.min(-.21,r.x):Math.max(.21,r.x);this.telemetry[r.route]++;this.event('route',r,{route:r.route});}
 if(now.fork&&r.route==='supply'&&now.local>=1250&&r.supplied!==stage){r.energy=Math.min(100,r.energy+45);r.cargo=Math.min(100,r.cargo+25);r.supplied=stage;this.event('supply',r);}
 for(const o of this.objects){if(o.taken.includes(r.id))continue;const relBefore=o.previousZ===undefined?o.z:o.previousZ;if(oldZ<=relBefore+9&&r.z>=o.z-9&&Math.abs(r.x-o.x)<(o.type==='energy'?.25:.23)){
 if(o.type==='energy'){o.taken.push(r.id);r.energy=Math.min(100,r.energy+18);r.score+=20;this.telemetry.pickups++;this.event('energy',r);}else this.hit(r,o.type);
 }}
 const delivered=Math.min(3,Math.floor(Math.max(0,r.z)/2400));if(delivered>r.parcels){r.parcels=delivered;r.score+=Math.round(r.cargo*3);this.telemetry.deliveries++;this.event('delivery',r,{station:delivered,cargo:Math.round(r.cargo)});}
 if(r.z>=LENGTH){r.z=LENGTH;r.finished=true;r.finishTime=this.elapsed;r.speed=0;r.score+=Math.max(0,Math.round((LIMIT-this.elapsed)*10));this.event('finish',r);}
 }
 step(input={}){if(this.phase==='countdown'){this.countdown=Math.max(0,this.countdown-DT);if(this.countdown<1e-8)this.phase='racing';return true;}if(this.phase!=='racing')return false;this.elapsed+=DT;this.ticks++;
 for(const o of this.objects){o.previousZ=o.z;if(o.type==='traffic'){o.z+=o.speed*DT;const at=road(o.z);if(at.fork)o.x=o.x<0?-.55:.55;}}
 const view=this.observation();const controls=this.racers.map(r=>r.id===0&&!this.spectator?input:chooseAI(view,r.id));
 for(const r of this.racers)if(!r.finished)this.drive(r,controls[r.id]);
 for(let i=0;i<this.racers.length;i++)for(let j=i+1;j<this.racers.length;j++){const a=this.racers[i],b=this.racers[j];if(!a.finished&&!b.finished&&Math.abs(a.z-b.z)<12&&Math.abs(a.x-b.x)<.22){this.hit(a,'racer');this.hit(b,'racer');const side=a.x<=b.x?-1:1;a.x=clamp(a.x+side*.06,-1.35,1.35);b.x=clamp(b.x-side*.06,-1.35,1.35);}}
 for(const p of this.shots){const before=p.z;p.z+=230*DT;p.life-=DT;for(const r of this.racers)if(r.id!==p.owner&&!r.finished&&r.z>=before-8&&r.z<=p.z+8&&Math.abs(r.x-p.x)<.23&&this.hit(r,'snowball')){p.life=0;break;}}
 this.shots=this.shots.filter(p=>p.life>0);
 if((!this.spectator&&this.racers[0].finished)||this.racers.every(r=>r.finished)||this.elapsed>=LIMIT){this.phase='over';this.result={standings:this.standings(),time:this.elapsed,timeout:!this.racers[0].finished};}
 return true;}
 standings(){return this.racers.slice().sort((a,b)=>b.score-a.score||b.z-a.z||a.id-b.id).map((r,i)=>({id:r.id,name:r.name,rank:i+1,score:r.score,parcels:r.parcels,cargo:Math.round(r.cargo),finished:r.finished,time:r.finishTime,z:r.z}));}
 observation(){return{phase:this.phase,elapsed:this.elapsed,racers:this.racers.map(r=>({...r})),objects:this.objects.map(o=>({...o,taken:[...o.taken]})),shots:this.shots.map(s=>({...s})),standings:this.standings(),telemetry:{...this.telemetry}};}
}
return{Game,DT,LENGTH,LIMIT,ITEMS,PROFILES,road,roadCenter,tangent,chooseAI,clamp};
});
