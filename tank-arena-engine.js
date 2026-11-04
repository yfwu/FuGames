'use strict';
// 鋼芯競技場 — original FuGames burrow artillery. Deterministic rules, no DOM.
// Units are world pixels; x grows right, y points down. The same module runs the page,
// the Node tests and any local agent (see Game#apply and runUntilInput).
// Every option defaults to the original single ruleset: dunes map, breeze, elite AI,
// classic four-card deck and the wall + repair opening hand.
const TankArena=(()=>{
 const W=800,H=460,DT=.025,MAX_TURNS=40,MAX_HP=70,MOVE=60,FLOOR=440,MAX_BUILDINGS=8;
 const CARDS={
  wall:{name:'擋彈牆',text:'擋低角砲；36 HP，可被轟碎',target:'build'},
  bunker:{name:'掩體',text:'附近友軍爆傷減半；40 HP',target:'build'},
  repair:{name:'急救包',text:'當前蟲回復 20 HP',target:'self'},
  drill:{name:'鑽地彈',text:'本回合爆坑更大，傷害較低',target:'self'},
  heavy:{name:'重砲彈',text:'本回合爆傷 58、範圍較小、轟牆更狠',target:'self'},
  cluster:{name:'集束彈',text:'落點炸開，再撒四枚子彈',target:'self'},
  jet:{name:'噴射背包',text:'本回合多走 90，可越過角色與建築',target:'self'},
  calm:{name:'定風旗',text:'本回合風力歸零',target:'self'},
  airstrike:{name:'空投標記',text:'標記一處；你下回合開始時落下三枚炸彈',target:'any'}
 };
 const DECKS={classic:['wall','bunker','repair','drill'],expanded:['wall','bunker','repair','drill','heavy','cluster','jet','calm','airstrike']};
 const LOADOUTS={
  standard:{name:'標準',hand:['wall','repair'],text:'擋彈牆 + 急救包，攻守平均。'},
  engineer:{name:'工兵',hand:['bunker','wall'],text:'掩體 + 擋彈牆，開局先築陣地。'},
  siege:{name:'攻城',hand:['drill','heavy'],text:'鑽地彈 + 重砲彈，先手破陣。'},
  scout:{name:'游擊',hand:['jet','calm'],text:'噴射背包 + 定風旗，搶位置與準度。'}
 };
 // Shell specs: radius and damage for units, building damage, crater size.
 const SHELLS={
  normal:{radius:62,damage:42,building:42,crater:38},
  drill:{radius:86,damage:28,building:42,crater:75},
  heavy:{radius:50,damage:58,building:64,crater:30},
  cluster:{radius:48,damage:26,building:30,crater:24,bomblets:[-70,-35,35,70]},
  bomblet:{radius:36,damage:16,building:20,crater:18},
  strike:{radius:44,damage:26,building:36,crater:28}
 };
 const STRIKE_OFFSETS=[-36,0,36];
 const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
 const dunes=x=>Math.round(340+25*Math.sin(x/95)+12*Math.cos(x/39));
 const bump=(x,c,w)=>Math.exp(-(((x-c)/w)**2));
 const MAPS={
  dunes:{name:'沙丘',text:'起伏的砂礫地，原版戰場。',terrain:dunes,spawns:[110,230,570,690]},
  canyon:{name:'裂谷',text:'中央深谷，平射多半撞上谷壁。',terrain:x=>Math.round(300+105*bump(x,400,95)+10*Math.sin(x/37)+6*Math.cos(x/23)),spawns:[90,200,600,710]},
  isles:{name:'潮汐群島',text:'三座小島，掉進海裡就沉了。',water:418,terrain:x=>Math.round(452-118*Math.max(bump(x,150,92),bump(x,400,70)*.92,bump(x,650,92))+5*Math.sin(x/17)),spawns:[110,190,610,690]},
  mesa:{name:'石台',text:'中央高台擋住直射，只能高拋。',terrain:x=>{const t=clamp((Math.abs(x-400)-60)/70,0,1),s=t*t*(3-2*t);return Math.round(250+110*s+9*Math.sin(x/29)+14*Math.cos(x/71));},spawns:[100,210,590,700]},
  fort:{name:'要塞',text:'中立石柱與城牆把戰場切成三段。',terrain:x=>Math.round(352+10*Math.sin(x/61)+6*Math.cos(x/27)),spawns:[90,200,600,710],
   ruins:[{type:'rampart',x:320},{type:'tower',x:400},{type:'rampart',x:480}]}
 };
 const BUILDINGS={wall:{w:18,h:55,hp:36},bunker:{w:32,h:28,hp:40},rampart:{w:20,h:70,hp:60},tower:{w:30,h:96,hp:90}};
 const WEATHER={
  breeze:{name:'微風',text:'每回合 ±20 隨機風。'},
  calm:{name:'無風',text:'全程無風，純拚角度。'},
  gale:{name:'強風',text:'每回合 ±45 隨機風，經驗 +10%。'},
  shifting:{name:'陣風',text:'風向延續上一回合再漂移，最大 ±45，經驗 +10%。'}
 };
 // AI tiers. Elite is the original searcher exactly (16 angles × 11 powers, no noise).
 const TIERS=[
  {id:'rookie',name:'新兵',text:'粗略瞄準、手會抖，只會急救。',angleStep:30,powerStep:15,noiseA:9,noiseP:9,cards:'repair',move:false},
  {id:'veteran',name:'老手',text:'會用牌，瞄準有小誤差。',angleStep:15,powerStep:10,noiseA:3,noiseP:4,cards:'basic',move:true},
  {id:'elite',name:'精英',text:'原版 AI：176 組彈道擇優，不失手。',angleStep:10,powerStep:7.5,noiseA:0,noiseP:0,cards:'basic',move:true},
  {id:'legend',name:'傳奇',text:'先找射位再細調彈道，會算擊殺與空投，起手攻城牌。',angleStep:5,powerStep:5,noiseA:0,noiseP:0,cards:'smart',move:'search',refine:true,smart:true,loadout:'siege'}
 ];
 function normalizeOptions(o={}){
  const tier=Number.isInteger(o.tier)&&o.tier>=0&&o.tier<TIERS.length?o.tier:2;
  return{tier,map:MAPS[o.map]?o.map:'dunes',weather:WEATHER[o.weather]?o.weather:'breeze',deck:DECKS[o.deck]?o.deck:'classic',
   loadout:LOADOUTS[o.loadout]?o.loadout:'standard',aiLoadout:LOADOUTS[o.aiLoadout]?o.aiLoadout:(TIERS[tier].loadout||'standard'),
   turns:Number.isInteger(o.turns)&&o.turns>=10&&o.turns<=99?o.turns:MAX_TURNS};
 }
 const ground=(g,x)=>g.terrain[clamp(Math.round(x),0,W)];
 const body=(g,a)=>({x:a.x,y:ground(g,a.x)-12});
 const shellOf=g=>g.drill?'drill':(g.shell&&SHELLS[g.shell]?g.shell:'normal');
 function projectile(g,a,angle,power){const p=body(g,a),r=angle*Math.PI/180,v=power*5;return{x:p.x+Math.cos(r)*19,y:p.y-Math.sin(r)*19,vx:Math.cos(r)*v,vy:-Math.sin(r)*v,age:0,owner:a.id,drill:g.drill,shell:shellOf(g)};}
 function advance(g,p){
  const prev={x:p.x,y:p.y};p.age+=DT;p.vx+=g.wind*DT;p.vy+=300*DT;p.x+=p.vx*DT;p.y+=p.vy*DT;
  // Segment substeps prevent fast shots tunnelling through narrow walls/units.
  const n=Math.max(1,Math.ceil(Math.hypot(p.x-prev.x,p.y-prev.y)/3));
  for(let i=1;i<=n;i++){const q={x:prev.x+(p.x-prev.x)*i/n,y:prev.y+(p.y-prev.y)*i/n};if(q.x<0||q.x>W||q.y>H+60)return{...q,miss:true};
   for(const b of g.buildings){const y=ground(g,b.x);if(Math.abs(q.x-b.x)<=b.w/2&&q.y>=y-b.h&&q.y<=y)return{...q,building:b.id};}
   for(const a of g.actors)if(a.hp>0&&(a.id!==p.owner||p.age>.2)){const c=body(g,a);if(Math.hypot(q.x-c.x,q.y-c.y)<13)return q;}
   if(q.y>=ground(g,q.x))return q;
   if(g.water&&q.y>=g.water)return{...q,miss:true,splash:true};
  }
  if(p.age>7)return{...p,miss:true};return null;
 }
 function trajectory(g,a,angle,power){const p=projectile(g,a,angle,power),points=[{x:p.x,y:p.y}];let hit=null;for(let i=0;i<281;i++){hit=advance(g,p);if(i%3===0)points.push({x:p.x,y:p.y});if(hit)break;}if(hit)points.push({x:hit.x,y:hit.y});return{points,hit:hit||{x:p.x,y:p.y,miss:true}};}
 // What an AI (or agent) may see: public geometry plus its own hand. No opponent hand, deck or RNG.
 function observation(g,team){return{terrain:g.terrain.slice(),actors:g.actors.map(a=>({...a})),buildings:g.buildings.map(b=>({...b})),wind:g.wind,active:g.active,team,hand:g.hands[team].slice(),drill:g.drill,shell:shellOf(g),moveLeft:g.moveLeft,cardUsed:g.cardUsed,jet:!!g.jet,water:g.water||0,strikes:(g.strikes||[]).map(s=>({...s})),turn:g.turn,turns:g.options?g.options.turns:MAX_TURNS};}
 const blastPoints=(view,hit,spec)=>{const list=[{x:hit.x,y:hit.y,spec}];if(spec.bomblets)for(const off of spec.bomblets){const x=clamp(hit.x+off,0,W);list.push({x,y:ground(view,x)-2,spec:SHELLS.bomblet});}return list;};
 function scoreHit(view,actor,hit,o={}){
  const spec=SHELLS[view.drill?'drill':(view.shell&&SHELLS[view.shell]?view.shell:'normal')];let score=0;
  const pts=blastPoints(view,hit,spec);
  for(const b of view.actors)if(b.hp>0){const p=body(view,b);let dmg=0,near=Infinity;
   for(const q of pts){const d=Math.hypot(p.x-q.x,p.y-q.y);near=Math.min(near,d);dmg+=Math.max(0,1-d/q.spec.radius)*q.spec.damage;}
   score+=dmg*(b.team===actor.team?-1.5:1);if(b.team!==actor.team)score-=near*.004;
   if(o.smart&&dmg>=b.hp)score+=b.team===actor.team?-40:25;}
  if(hit.building!==undefined){const b=view.buildings.find(b=>b.id===hit.building);if(b)score+=b.team===actor.team?-12:b.team<0?0:9;}
  return score;
 }
 function chooseShot(view,o={}){
  const actor=view.actors[view.active],as=o.angleStep||10,ps=o.powerStep||7.5;let best={angle:actor.team?135:45,power:65,score:-Infinity};
  const consider=(angle,power)=>{const {hit}=trajectory(view,actor,angle,power);if(hit.miss)return;const score=scoreHit(view,actor,hit,o);if(score>best.score)best={angle,power,score};};
  // Default grid: 16 angles × 11 powers; only current public geometry, no other hand/deck/RNG.
  for(let angle=15;angle<=165;angle+=as)for(let power=25;power<=100;power+=ps)consider(angle,power);
  if(o.refine&&best.score>-Infinity){const c={...best};for(let da=-4;da<=4;da++)for(let dp=-4;dp<=4;dp+=2){const angle=c.angle+da,power=c.power+dp;if(angle>=10&&angle<=170&&power>=25&&power<=100)consider(angle,power);}}
  return best;
 }
 // Pure movement check shared by the rules and by the searching AI.
 function moveTarget(g,a,delta,jet){
  const amount=clamp(delta,-g.moveLeft,g.moveLeft),x=clamp(a.x+amount,20,W-20);if(Math.abs(x-a.x)<.1)return{ok:false,x:a.x,reason:'none'};
  const lo=Math.min(a.x,x),hi=Math.max(a.x,x);
  const blocked=jet?(g.actors.some(b=>b!==a&&b.hp>0&&Math.abs(b.x-x)<26)||g.buildings.some(b=>Math.abs(b.x-x)<b.w/2+13))
   :(g.actors.some(b=>b!==a&&b.hp>0&&b.x>=lo-26&&b.x<=hi+26)||g.buildings.some(b=>b.x>=lo-b.w/2-13&&b.x<=hi+b.w/2+13));
  if(blocked)return{ok:false,x,reason:'blocked'};
  if(g.water&&ground(g,x)>=g.water-4)return{ok:false,x,reason:'water'};
  return{ok:true,x};
 }
 class Game{
  constructor(random=Math.random,options={}){this.random=random;this.options=normalizeOptions(options);this.reset();}
  get tierInfo(){return TIERS[this.options.tier];}
  get maxTurns(){return this.options.turns;}
  reset(){
   const map=MAPS[this.options.map];
   this.phase='ready';this.turn=0;this.team=0;this.active=0;this.nextUnit=[0,0];this.terrain=Array.from({length:W+1},(_,x)=>map.terrain(x));this.water=map.water||0;
   this.actors=map.spawns.map((x,id)=>({id,team:id<2?0:1,x,hp:MAX_HP}));
   this.hands=[LOADOUTS[this.options.loadout].hand.slice(),LOADOUTS[this.options.aiLoadout].hand.slice()];
   this.buildings=[];this.serial=0;this.projectile=null;this.effect=null;this.result=null;this.lastImpact='';this.log='調整角度與力度，虛線預覽落點。';this.wind=0;this.moveLeft=MOVE;this.cardUsed=false;this.drill=false;this.shell='normal';this.jet=false;this.angle=45;this.power=65;this.aiWait=0;this.resumePhase=null;
   this.strikes=[];this.events=[];this.stats={dealt:[0,0],friendly:[0,0],kills:[0,0],razed:[0,0],shots:[0,0],hits:[0,0],cards:[0,0]};
   for(const r of map.ruins||[]){const s=BUILDINGS[r.type];this.buildings.push({id:this.serial++,type:r.type,team:-1,x:r.x,w:s.w,h:s.h,hp:s.hp});}
  }
  emit(e){this.events.push(e);if(this.events.length>80)this.events.shift();}
  start(){if(this.phase==='ready'){this.beginTurn();}else if(this.phase==='paused'){this.phase=this.resumePhase;this.resumePhase=null;}}
  pause(){if(['aim','ai','flight'].includes(this.phase)){this.resumePhase=this.phase;this.phase='paused';}}
  drawWind(){const w=this.options.weather,r=()=>this.random();
   if(w==='calm')return 0;if(w==='gale')return Math.round((r()-.5)*90);if(w==='shifting')return clamp(this.wind+Math.round((r()-.5)*30),-45,45);
   return Math.round((r()-.5)*40);}
  beginTurn(){
   const team=this.turn%2;this.resolveStrikes(team);
   if(this.checkResult())return;this.team=team;const units=this.actors.filter(a=>a.team===this.team&&a.hp>0);this.active=units[this.nextUnit[this.team]++%units.length].id;this.phase=this.team?'ai':'aim';this.moveLeft=MOVE;this.cardUsed=false;this.drill=false;this.shell='normal';this.jet=false;this.wind=this.drawWind();this.angle=this.team?135:45;this.power=65;this.aiWait=36;this.projectile=null;
   const deck=DECKS[this.options.deck];if(this.hands[this.team].length<3)this.hands[this.team].push(deck[Math.floor(this.random()*deck.length)]);
   this.log=(this.lastImpact?this.lastImpact+' ':'')+(this.team?'AI':'你')+'的第 '+(this.turn+1)+' 回合：移動／用一張牌，再開砲。';
   this.emit({type:'turn',team:this.team,active:this.active,turn:this.turn,wind:this.wind});
  }
  checkResult(){const hp=[0,0];for(const a of this.actors)hp[a.team]+=a.hp;const cap=this.turn>=this.maxTurns;if(hp[0]===0||hp[1]===0||cap){this.phase='over';const winner=hp[0]===hp[1]?null:hp[0]>hp[1]?0:1;this.result={winner,hp,turns:this.turn,reason:hp[0]&&hp[1]?this.maxTurns+' 回合到，比剩餘總生命':'一方蟲隊全數倒下'};this.projectile=null;this.emit({type:'over',winner});return true;}return false;}
  canAct(){return this.phase===(this.team?'ai':'aim');}
  aim(angle,power){if(!this.canAct()||!Number.isFinite(angle)||!Number.isFinite(power))return false;this.angle=clamp(angle,10,170);this.power=clamp(power,25,100);return true;}
  move(delta){if(!this.canAct()||!Number.isFinite(delta)||delta===0)return false;const a=this.actors[this.active],m=moveTarget(this,a,delta,this.jet);
   if(!m.ok){if(m.reason==='blocked')this.log='路被角色或建築擋住，換個方向或先轟開。';if(m.reason==='water')this.log='前面是海，再走就沉了。';return false;}
   this.moveLeft-=Math.abs(m.x-a.x);a.x=m.x;return true;
  }
  playCard(index,x){if(!this.canAct()||this.cardUsed||!Number.isInteger(index))return false;const hand=this.hands[this.team],type=hand[index],a=this.actors[this.active];if(!CARDS[type])return false;
   if(type==='wall'||type==='bunker'){if(!Number.isFinite(x)||x<20||x>W-20||Math.abs(x-a.x)>100||this.actors.some(b=>b.hp>0&&Math.abs(b.x-x)<30)||this.buildings.some(b=>Math.abs(b.x-x)<35)||this.buildings.filter(b=>b.team>=0).length>=MAX_BUILDINGS||(this.water&&ground(this,x)>=this.water-4)){this.log='建築須放在當前蟲 100 格距離內的空地，避開角色與其他建築。';return false;}const s=BUILDINGS[type];this.buildings.push({id:this.serial++,type,team:this.team,x,w:s.w,h:s.h,hp:s.hp});}
   if(type==='repair'){if(a.hp>=MAX_HP){this.log='生命已滿，急救包留待需要時。';return false;}a.hp=Math.min(MAX_HP,a.hp+20);}
   if(type==='calm'){if(this.wind===0){this.log='現在已經無風，定風旗留著。';return false;}this.wind=0;}
   if(type==='airstrike'){if(!Number.isFinite(x)||x<20||x>W-20){this.log='空投要標在戰場範圍內。';return false;}if(this.strikes.some(s=>s.team===this.team)){this.log='上一次空投還沒落下。';return false;}this.strikes.push({x:Math.round(x),team:this.team,turn:this.turn});}
   if(type==='drill')this.drill=true;
   if(type==='heavy'||type==='cluster')this.shell=type;
   if(type==='jet'){this.jet=true;this.moveLeft+=90;}
   hand.splice(index,1);this.cardUsed=true;this.stats.cards[this.team]++;this.log='使用 '+CARDS[type].name+'；仍可移動與開砲。';this.emit({type:'card',card:type,team:this.team,x:Number.isFinite(x)?x:a.x});return true;
  }
  fire(){if(!this.canAct())return false;this.projectile=projectile(this,this.actors[this.active],this.angle,this.power);this.phase='flight';this.stats.shots[this.team]++;this.log='砲彈飛行中…';this.emit({type:'fire',team:this.team,actor:this.active,angle:this.angle,power:this.power,shell:this.projectile.shell});return true;}
  endTurn(){if(!this.canAct())return false;this.turn++;this.beginTurn();return true;}
  // One explosion: unit damage (bunkers halve), building damage, then the crater.
  blast(x,y,spec,buildingId,team,source){
   let total=0;
   for(const a of this.actors)if(a.hp>0){const p=body(this,a),d=Math.hypot(p.x-x,p.y-y);let loss=d<spec.radius?Math.ceil(spec.damage*(1-d/spec.radius)):0;const cover=this.buildings.some(b=>b.type==='bunker'&&b.team===a.team&&Math.abs(b.x-a.x)<85);if(cover)loss=Math.ceil(loss/2);this.hurt(a,loss,team);total+=loss;}
   for(const b of this.buildings){const d=Math.hypot(b.x-x,ground(this,b.x)-b.h/2-y);if(b.id===buildingId)b.hp-=spec.building;else if(d<spec.radius)b.hp-=Math.ceil(spec.building*(1-d/spec.radius));}
   const razed=this.buildings.filter(b=>b.hp<=0);for(const b of razed){if(team!==undefined&&b.team!==team&&b.team>=0)this.stats.razed[team]++;this.emit({type:'razed',x:b.x,building:b.type,team:b.team});}
   this.buildings=this.buildings.filter(b=>b.hp>0);
   const crater=spec.crater;for(let cx=Math.max(0,Math.floor(x-crater));cx<=Math.min(W,Math.ceil(x+crater));cx++){const dy=Math.sqrt(Math.max(0,crater*crater-(cx-x)**2));this.terrain[cx]=Math.min(FLOOR,Math.max(this.terrain[cx],y+dy*.7));}
   this.emit({type:'blast',x,y,radius:spec.radius,crater,total,source:source||'shell'});
   return total;
  }
  hurt(a,loss,team){if(loss<=0||a.hp<=0)return;const real=Math.min(a.hp,loss);a.hp-=real;if(team!==undefined){if(a.team!==team)this.stats.dealt[team]+=real;else this.stats.friendly[team]+=real;}if(a.hp===0){if(team!==undefined&&a.team!==team)this.stats.kills[team]++;this.emit({type:'ko',id:a.id,x:a.x});}}
  // After the ground moves: long drops hurt, sinking below the tide line drowns.
  settle(oldGround,team){
   for(const a of this.actors)if(a.hp>0){const fall=ground(this,a.x)-oldGround[a.id];if(fall>35){const loss=Math.floor((fall-35)*.4);if(loss>0){this.hurt(a,loss,team);this.emit({type:'fall',id:a.id,loss});}}}
   if(this.water)for(const a of this.actors)if(a.hp>0&&ground(this,a.x)>=this.water){this.hurt(a,a.hp,team);this.emit({type:'drown',id:a.id,x:a.x});}
  }
  explode(hit){const team=this.team;if(hit.miss){this.lastImpact=hit.splash?'上一砲落入海中。':'上一砲落空。';this.log=this.lastImpact;this.emit({type:'miss',x:hit.x,y:hit.y,splash:!!hit.splash});return;}
   const kind=shellOf(this),spec=SHELLS[kind],oldGround=this.actors.map(a=>ground(this,a.x)),before=this.stats.dealt[team];
   let total=this.blast(hit.x,hit.y,spec,hit.building,team,kind);
   if(spec.bomblets)for(const off of spec.bomblets){const x=clamp(hit.x+off,0,W);total+=this.blast(x,ground(this,x)-2,SHELLS.bomblet,undefined,team,'bomblet');}
   this.settle(oldGround,team);if(this.stats.dealt[team]>before)this.stats.hits[team]++;
   this.effect={x:hit.x,y:hit.y,radius:spec.radius,left:20};this.lastImpact='上一砲共 '+total+' 點爆傷；地形已改變。';this.log=this.lastImpact;
  }
  resolveStrikes(team){
   const due=this.strikes.filter(s=>s.team===team);if(!due.length)return;this.strikes=this.strikes.filter(s=>s.team!==team);
   for(const s of due){const oldGround=this.actors.map(a=>ground(this,a.x));let total=0;for(const off of STRIKE_OFFSETS){const x=clamp(s.x+off,0,W);total+=this.blast(x,ground(this,x)-2,SHELLS.strike,undefined,team,'strike');}this.settle(oldGround,team);this.lastImpact='空投落下，共 '+total+' 點爆傷。';}
  }
  aiTurn(){const tier=this.tierInfo,a=this.actors[this.active],hand=this.hands[this.team];let index=hand.indexOf('repair');
   if(tier.cards==='repair'){if(a.hp<=40&&index>=0)this.playCard(index);}
   else{
    if(a.hp<=50&&index>=0)this.playCard(index);
    if(!this.cardUsed){index=hand.indexOf('bunker');if(index>=0&&a.hp<60)this.playCard(index,a.x+(a.x<400?45:-45));}
    if(!this.cardUsed){index=hand.indexOf('wall');if(index>=0&&this.actors.some(b=>b.team!==a.team&&b.hp>0&&Math.abs(b.x-a.x)<330))this.playCard(index,a.x+(a.x<400?48:-48));}
    if(!this.cardUsed){index=hand.indexOf('drill');if(index>=0&&this.buildings.some(b=>b.team!==a.team&&b.team>=0))this.playCard(index);}
    // Expanded-deck cards (never in a classic hand, so the original AI is unchanged).
    if(!this.cardUsed){index=hand.indexOf('calm');if(index>=0&&Math.abs(this.wind)>=18)this.playCard(index);}
    if(!this.cardUsed){index=hand.indexOf('airstrike');if(index>=0){const x=this.strikeTarget(a);if(x!==null)this.playCard(index,x);}}
    if(!this.cardUsed){index=hand.indexOf('heavy');if(index<0)index=hand.indexOf('cluster');if(index>=0)this.playCard(index);}
   }
   const opts={angleStep:tier.angleStep,powerStep:tier.powerStep,refine:tier.refine,smart:tier.smart};
   let best=chooseShot(observation(this,this.team),opts);
   if(tier.move==='search'&&this.moveLeft>0){
    if(!this.cardUsed&&best.score<8){const j=hand.indexOf('jet');if(j>=0)this.playCard(j);}
    const coarse={angleStep:10,powerStep:7.5,smart:true};let pick={dx:0,score:chooseShot(observation(this,this.team),coarse).score};
    for(const dx of [-60,-30,30,60,-120,120]){if(Math.abs(dx)>this.moveLeft)continue;const m=moveTarget(this,a,dx,this.jet);if(!m.ok)continue;const view=observation(this,this.team);view.actors[a.id].x=m.x;const s=chooseShot(view,coarse).score;if(s>pick.score+2)pick={dx,score:s};}
    if(pick.dx)this.move(pick.dx);best=chooseShot(observation(this,this.team),opts);
   }else if(tier.move&&best.score<8&&this.moveLeft>0){this.move(a.x>400?-30:30);best=chooseShot(observation(this,this.team),opts);}
   let angle=best.angle,power=best.power;
   if(tier.noiseA)angle+=Math.round((this.random()-.5)*2*tier.noiseA);
   if(tier.noiseP)power+=Math.round((this.random()-.5)*2*tier.noiseP);
   this.aim(angle,power);this.fire();
  }
  // Airstrike aim: the enemy with the most enemy neighbours, never within 70 of a friendly unit.
  strikeTarget(a){let best=null,score=0;for(const e of this.actors)if(e.hp>0&&e.team!==a.team){if(this.actors.some(f=>f.hp>0&&f.team===a.team&&Math.abs(f.x-e.x)<80))continue;const s=1+this.actors.filter(o=>o!==e&&o.hp>0&&o.team!==a.team&&Math.abs(o.x-e.x)<70).length+(MAX_HP-e.hp)/MAX_HP;if(s>score){score=s;best=clamp(Math.round(e.x),20,W-20);}}return best;}
  step(){if(this.phase==='paused'||this.phase==='ready'||this.phase==='over')return;if(this.effect&&--this.effect.left<=0)this.effect=null;if(this.phase==='ai'){if(--this.aiWait<=0)this.aiTurn();return;}if(this.phase==='flight'){const hit=advance(this,this.projectile);if(hit){this.explode(hit);this.turn++;if(!this.checkResult())this.beginTurn();}}}
  // Agent interface: one JSON action per call. {type:'aim',angle,power} | {type:'move',dx} | {type:'card',index,x?} | {type:'fire'} | {type:'end'}
  apply(action){if(!action||typeof action!=='object')return false;const n=v=>Number(v);
   switch(action.type){case 'aim':return this.aim(n(action.angle),n(action.power));case 'move':return this.move(n(action.dx));case 'card':return this.playCard(n(action.index),action.x===undefined?undefined:n(action.x));case 'fire':return this.fire();case 'end':return this.endTurn();default:return false;}}
 }
 // Runs AI turns and shell flights until the human side has to decide (or the match ends).
 function runUntilInput(g,limit=20000){let n=0;while(n++<limit&&!['aim','over','ready','paused'].includes(g.phase))g.step();return g.phase;}
 return{Game,W,H,DT,MAX_TURNS,MAX_HP,MOVE,CARDS,DECKS,LOADOUTS,SHELLS,MAPS,BUILDINGS,WEATHER,TIERS,STRIKE_OFFSETS,normalizeOptions,body,ground,advance,trajectory,observation,chooseShot,scoreHit,moveTarget,runUntilInput};
})();
if(typeof module!=='undefined')module.exports=TankArena;
