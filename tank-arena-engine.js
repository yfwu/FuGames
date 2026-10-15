'use strict';
// Original FuGames burrow artillery. Units are world pixels; y points down.
const TankArena=(()=>{
 const W=800,H=460,DT=.025,MAX_TURNS=40,CARDS={wall:{name:'擋彈牆',text:'擋低角砲；36 HP，可被轟碎'},bunker:{name:'掩體',text:'附近友軍爆傷減半；40 HP'},repair:{name:'急救包',text:'當前蟲回復 20 HP'},drill:{name:'鑽地彈',text:'本回合爆坑更大，傷害較低'}};
 const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
 const ground=(g,x)=>g.terrain[clamp(Math.round(x),0,W)];
 const body=(g,a)=>({x:a.x,y:ground(g,a.x)-12});
 function projectile(g,a,angle,power){const p=body(g,a),r=angle*Math.PI/180,v=power*5;return{x:p.x+Math.cos(r)*19,y:p.y-Math.sin(r)*19,vx:Math.cos(r)*v,vy:-Math.sin(r)*v,age:0,owner:a.id,drill:g.drill};}
 function advance(g,p){
  const prev={x:p.x,y:p.y};p.age+=DT;p.vx+=g.wind*DT;p.vy+=300*DT;p.x+=p.vx*DT;p.y+=p.vy*DT;
  // Segment substeps prevent fast shots tunnelling through narrow walls/units.
  const n=Math.max(1,Math.ceil(Math.hypot(p.x-prev.x,p.y-prev.y)/3));
  for(let i=1;i<=n;i++){const q={x:prev.x+(p.x-prev.x)*i/n,y:prev.y+(p.y-prev.y)*i/n};if(q.x<0||q.x>W||q.y>H+60)return{...q,miss:true};
   for(const b of g.buildings){const y=ground(g,b.x);if(Math.abs(q.x-b.x)<=b.w/2&&q.y>=y-b.h&&q.y<=y)return{...q,building:b.id};}
   for(const a of g.actors)if(a.hp>0&&(a.id!==p.owner||p.age>.2)){const c=body(g,a);if(Math.hypot(q.x-c.x,q.y-c.y)<13)return q;}
   if(q.y>=ground(g,q.x))return q;
  }
  if(p.age>7)return{...p,miss:true};return null;
 }
 function trajectory(g,a,angle,power){const p=projectile(g,a,angle,power),points=[{x:p.x,y:p.y}];let hit=null;for(let i=0;i<281;i++){hit=advance(g,p);if(i%3===0)points.push({x:p.x,y:p.y});if(hit)break;}return{points,hit:hit||{x:p.x,y:p.y,miss:true}};}
 function observation(g,team){return{terrain:g.terrain.slice(),actors:g.actors.map(a=>({...a})),buildings:g.buildings.map(b=>({...b})),wind:g.wind,active:g.active,team,hand:g.hands[team].slice(),drill:g.drill,moveLeft:g.moveLeft,cardUsed:g.cardUsed};}
 function chooseShot(view){const actor=view.actors[view.active];let best={angle:actor.team?135:45,power:65,score:-Infinity};
  // 16 angles × 11 powers; only current public geometry, no other hand/deck/RNG.
  for(let angle=15;angle<=165;angle+=10)for(let power=25;power<=100;power+=7.5){const {hit}=trajectory(view,actor,angle,power);if(hit.miss)continue;let score=0;for(const b of view.actors)if(b.hp>0){const p=body(view,b),d=Math.hypot(p.x-hit.x,p.y-hit.y);const damage=Math.max(0,1-d/(view.drill?86:62))*(view.drill?28:42);score+=damage*(b.team===actor.team?-1.5:1);if(b.team!==actor.team)score-=d*.004;}if(hit.building!==undefined){const b=view.buildings.find(b=>b.id===hit.building);score+=b.team===actor.team?-12:9;}if(score>best.score)best={angle,power,score};}return best;
 }
 class Game{
  constructor(random=Math.random){this.random=random;this.reset();}
  reset(){this.phase='ready';this.turn=0;this.team=0;this.active=0;this.nextUnit=[0,0];this.terrain=Array.from({length:W+1},(_,x)=>Math.round(340+25*Math.sin(x/95)+12*Math.cos(x/39)));this.actors=[110,230,570,690].map((x,id)=>({id,team:id<2?0:1,x,hp:70}));this.hands=[['wall','repair'],['wall','repair']];this.buildings=[];this.serial=0;this.projectile=null;this.effect=null;this.result=null;this.lastImpact='';this.log='調整角度與力度，虛線預覽落點。';this.wind=0;this.moveLeft=60;this.cardUsed=false;this.drill=false;this.angle=45;this.power=65;this.aiWait=0;this.resumePhase=null;}
  start(){if(this.phase==='ready'){this.beginTurn();}else if(this.phase==='paused'){this.phase=this.resumePhase;this.resumePhase=null;}}
  pause(){if(['aim','ai','flight'].includes(this.phase)){this.resumePhase=this.phase;this.phase='paused';}}
  beginTurn(){if(this.checkResult())return;this.team=this.turn%2;const units=this.actors.filter(a=>a.team===this.team&&a.hp>0);this.active=units[this.nextUnit[this.team]++%units.length].id;this.phase=this.team?'ai':'aim';this.moveLeft=60;this.cardUsed=false;this.drill=false;this.wind=Math.round((this.random()-.5)*40);this.angle=this.team?135:45;this.power=65;this.aiWait=36;this.projectile=null;if(this.hands[this.team].length<3)this.hands[this.team].push(Object.keys(CARDS)[Math.floor(this.random()*4)]);this.log=(this.lastImpact?this.lastImpact+' ':'')+(this.team?'AI':'你')+'的第 '+(this.turn+1)+' 回合：移動／用一張牌，再開砲。';}
  checkResult(){const hp=[0,0];for(const a of this.actors)hp[a.team]+=a.hp;if(hp[0]===0||hp[1]===0||this.turn>=MAX_TURNS){this.phase='over';const winner=hp[0]===hp[1]?null:hp[0]>hp[1]?0:1;this.result={winner,hp,reason:this.turn>=MAX_TURNS?'40 回合到，比剩餘總生命':'一方蟲隊全數倒下'};this.projectile=null;return true;}return false;}
  canAct(){return this.phase===(this.team?'ai':'aim');}
  aim(angle,power){if(!this.canAct()||!Number.isFinite(angle)||!Number.isFinite(power))return false;this.angle=clamp(angle,10,170);this.power=clamp(power,25,100);return true;}
  move(delta){if(!this.canAct()||!Number.isFinite(delta)||delta===0)return false;const a=this.actors[this.active],amount=clamp(delta,-this.moveLeft,this.moveLeft),x=clamp(a.x+amount,20,W-20);if(Math.abs(x-a.x)<.1)return false;
   const lo=Math.min(a.x,x),hi=Math.max(a.x,x);if(this.actors.some(b=>b!==a&&b.hp>0&&b.x>=lo-26&&b.x<=hi+26)||this.buildings.some(b=>b.x>=lo-b.w/2-13&&b.x<=hi+b.w/2+13)){this.log='路被角色或建築擋住，換個方向或先轟開。';return false;}
   this.moveLeft-=Math.abs(x-a.x);a.x=x;return true;
  }
  playCard(index,x){if(!this.canAct()||this.cardUsed||!Number.isInteger(index))return false;const hand=this.hands[this.team],type=hand[index],a=this.actors[this.active];if(!CARDS[type])return false;
   if(type==='wall'||type==='bunker'){if(!Number.isFinite(x)||x<20||x>W-20||Math.abs(x-a.x)>100||this.actors.some(b=>b.hp>0&&Math.abs(b.x-x)<30)||this.buildings.some(b=>Math.abs(b.x-x)<35)||this.buildings.length>=8){this.log='建築須放在當前蟲 100 格距離內的空地，避開角色與其他建築。';return false;}this.buildings.push({id:this.serial++,type,team:this.team,x,w:type==='wall'?18:32,h:type==='wall'?55:28,hp:type==='wall'?36:40});}
   if(type==='repair'){if(a.hp>=70){this.log='生命已滿，急救包留待需要時。';return false;}a.hp=Math.min(70,a.hp+20);}
   if(type==='drill')this.drill=true;hand.splice(index,1);this.cardUsed=true;this.log='使用 '+CARDS[type].name+'；仍可移動與開砲。';return true;
  }
  fire(){if(!this.canAct())return false;this.projectile=projectile(this,this.actors[this.active],this.angle,this.power);this.phase='flight';this.log='砲彈飛行中…';return true;}
  endTurn(){if(!this.canAct())return false;this.turn++;this.beginTurn();return true;}
  explode(hit){if(hit.miss){this.lastImpact='上一砲落空。';this.log=this.lastImpact;return;}
   const radius=this.drill?86:62,damage=this.drill?28:42,oldGround=this.actors.map(a=>ground(this,a.x));let total=0;
   for(const a of this.actors)if(a.hp>0){const p=body(this,a),d=Math.hypot(p.x-hit.x,p.y-hit.y);let loss=d<radius?Math.ceil(damage*(1-d/radius)):0;const cover=this.buildings.some(b=>b.type==='bunker'&&b.team===a.team&&Math.abs(b.x-a.x)<85);if(cover)loss=Math.ceil(loss/2);a.hp=Math.max(0,a.hp-loss);total+=loss;}
   for(const b of this.buildings){const d=Math.hypot(b.x-hit.x,ground(this,b.x)-b.h/2-hit.y);if(b.id===hit.building)b.hp-=42;else if(d<radius)b.hp-=Math.ceil(42*(1-d/radius));}
   this.buildings=this.buildings.filter(b=>b.hp>0);
   const crater=this.drill?75:38;for(let x=Math.max(0,Math.floor(hit.x-crater));x<=Math.min(W,Math.ceil(hit.x+crater));x++){const dy=Math.sqrt(Math.max(0,crater*crater-(x-hit.x)**2));this.terrain[x]=Math.min(440,Math.max(this.terrain[x],hit.y+dy*.7));}
   for(const a of this.actors)if(a.hp>0){const fall=ground(this,a.x)-oldGround[a.id];if(fall>35)a.hp=Math.max(0,a.hp-Math.floor((fall-35)*.4));}
   this.effect={x:hit.x,y:hit.y,radius,left:20};this.lastImpact='上一砲共 '+total+' 點爆傷；地形已改變。';this.log=this.lastImpact;
  }
  aiTurn(){const a=this.actors[this.active],hand=this.hands[this.team];let index=hand.indexOf('repair');if(a.hp<=50&&index>=0)this.playCard(index);
   if(!this.cardUsed){index=hand.indexOf('bunker');if(index>=0&&a.hp<60)this.playCard(index,a.x+(a.x<400?45:-45));}
   if(!this.cardUsed){index=hand.indexOf('wall');if(index>=0&&this.actors.some(b=>b.team!==a.team&&b.hp>0&&Math.abs(b.x-a.x)<330))this.playCard(index,a.x+(a.x<400?48:-48));}
   if(!this.cardUsed){index=hand.indexOf('drill');if(index>=0&&this.buildings.some(b=>b.team!==a.team))this.playCard(index);}
   let best=chooseShot(observation(this,this.team));if(best.score<8&&this.moveLeft>0){this.move(a.x>400?-30:30);best=chooseShot(observation(this,this.team));}this.aim(best.angle,best.power);this.fire();
  }
  step(){if(this.phase==='paused'||this.phase==='ready'||this.phase==='over')return;if(this.effect&&--this.effect.left<=0)this.effect=null;if(this.phase==='ai'){if(--this.aiWait<=0)this.aiTurn();return;}if(this.phase==='flight'){const hit=advance(this,this.projectile);if(hit){this.explode(hit);this.turn++;if(!this.checkResult())this.beginTurn();}}}
 }
 return{Game,W,H,DT,MAX_TURNS,CARDS,body,ground,advance,trajectory,observation,chooseShot};
})();
if(typeof module!=='undefined')module.exports=TankArena;
