'use strict';
// Doctrine layer: lanes away from the crowded centre, supply-line raids,
// neck consolidation and depot expansion, plus seeded campaign variety.
const test=require('node:test'),assert=require('node:assert/strict'),H=require('../autohex-engine.js'),S=require('../hex-strategies.js');
const {canonicalHomes}=require('./helpers/hex-tactical-fixture.cjs'),at=H.index;
const OTHER={q:['r','s'],r:['s','q'],s:['q','r']};
const lateral=(g,p,i)=>{const pl=g.players[p],[a,b]=OTHER[pl.axis];return (H.CELLS[i][a]-H.CELLS[i][b])/2*pl.sign;};
const ring=i=>Math.max(Math.abs(H.CELLS[i].q),Math.abs(H.CELLS[i].r),Math.abs(H.CELLS[i].s));
function fresh(seed,style,modify=()=>{}){
  const config=structuredClone(S.DEFAULT_CONFIG);Object.assign(config.profiles[0],{style:{...config.profiles[0].style,...style}});modify(config.profiles[0]);
  const g=new H.Game({seed,strategyConfig:config,terrain:'classic',neutralEvents:false});g.start();canonicalHomes(g,H);g.board.set(g.anchors);g.terrain.fill(0);
  g.airports=[];g.depots=[];g.hands[1]=[];g.handAges[1]=[];g.players[1].energy=8;g.players[1].supplies=6;g._draw=()=>{};return g;
}
function own(g){while(g.turn!==1)assert.ok(g.act({type:'rest',cells:[]}));}
function act(g){own(g);g.players[1].energy=8;const a=H.chooseAction(g.observation());assert.ok(H.legalAction(g,a),JSON.stringify(a));assert.ok(g.act(a));return a;}
const stones=(g,p=1)=>H.CELLS.filter(c=>g.board[c.i]===p&&!g.anchors[c.i]).map(c=>c.i);
function line(g,p,cells){for(const i of cells)g.board[i]=p;}

test('style is optional, defaults from the mission and is validated like every other field',()=>{
  const legacy=structuredClone(S.DEFAULT_CONFIG);for(const p of legacy.profiles)delete p.style;
  const normalized=S.normalize(legacy);
  for(const p of normalized.profiles)assert.deepEqual(p.style,S.MISSION_STYLE[p.mission]);
  assert.equal(S.id(legacy),S.id(S.DEFAULT_CONFIG),'Omitting the defaults must not change the configuration identity');
  const lanes=new Set(S.DEFAULT_CONFIG.profiles.map(p=>p.style.lane)),raiders=S.DEFAULT_CONFIG.profiles.filter(p=>p.style.raid>=6);
  assert.ok(lanes.size>=3,'Default doctrines must not all share one lane');assert.equal(S.DEFAULT_CONFIG.profiles.filter(p=>p.style.lane==='center').length,1);
  assert.ok(raiders.length>=1);
  for(const [field,bad] of [['lane','teleport'],['raid',11],['robustness',-1],['expansion',2.5],['centerAversion',NaN]]){
    const c=structuredClone(S.DEFAULT_CONFIG);c.profiles[0].style[field]=bad;assert.throws(()=>S.normalize(c),/策略 JSON/);
  }
  const c=structuredClone(S.DEFAULT_CONFIG);c.profiles[0].style.extra=1;assert.throws(()=>S.normalize(c),/不支援欄位 extra/);
  const d=structuredClone(S.DEFAULT_CONFIG);delete d.profiles[0].style.raid;assert.throws(()=>S.normalize(d),/缺少必要欄位/);
});

test('left and right lanes build on opposite sides of the home axis',()=>{
  const runs={};
  for(const lane of ['left','right']){
    const g=fresh('doctrine-lanes',{lane,centerAversion:6,raid:0,robustness:0,expansion:0});
    for(let n=0;n<14;n++)act(g);
    const cells=stones(g);runs[lane]={mean:cells.reduce((s,i)=>s+lateral(g,1,i),0)/cells.length,far:Math.max(...cells.map(i=>Math.abs(lateral(g,1,i)))),cells};
  }
  const summary=JSON.stringify(Object.fromEntries(Object.entries(runs).map(([k,v])=>[k,v.mean.toFixed(2)])));
  assert.ok(runs.left.mean<-1.5&&runs.right.mean>1.5,summary);
  assert.ok(runs.left.far>=4&&runs.right.far>=4);
});

test('a high centre aversion keeps an adaptive faction out of the central rings on an open board',()=>{
  const g=fresh('doctrine-aversion',{lane:'adaptive',centerAversion:10,raid:0,robustness:0,expansion:0}),plain=fresh('doctrine-aversion',{lane:'center',centerAversion:0,raid:0,robustness:0,expansion:0});
  for(let n=0;n<24;n++){act(g);act(plain);}
  const central=x=>stones(x).filter(i=>ring(i)<=7).length;
  assert.ok(central(g)<central(plain),JSON.stringify({adaptive:central(g),center:central(plain)}));
  assert.notEqual(g.plannerStates[1].campaign.lane,0);
});

test('a raider spends its demolition on a deep enemy supply neck that a centre doctrine ignores',()=>{
  const results={};
  for(const name of ['raider','vanguard']){
    const g=fresh('doctrine-raid',name==='raider'?{lane:'adaptive',centerAversion:3,raid:10,robustness:0,expansion:0}:{lane:'center',centerAversion:0,raid:0,robustness:0,expansion:0});
    // Player 1 owns a short spur; player 2 runs a long one-wide line past it.
    const home1=g.players[1].home,home2=g.players[2].home;
    const spur=[];for(let i=home1,n=0;n<5;n++){i=H.ADJ[i].filter(j=>!g.board[j]).sort((a,b)=>H.distance(a,home2)-H.distance(b,home2)||a-b)[0];spur.push(i);g.board[i]=1;}
    const enemy=[];let cur=home2;const tip=spur.at(-1);
    while(H.distance(cur,tip)>2){cur=H.ADJ[cur].filter(j=>!g.board[j]).sort((a,b)=>H.distance(a,tip)-H.distance(b,tip)||a-b)[0];enemy.push(cur);g.board[cur]=2;}
    for(let n=0;n<10;n++){const j=H.ADJ[cur].filter(j=>!g.board[j]&&H.ADJ[j].every(k=>g.board[k]!==1)).sort((a,b)=>H.distance(b,home1)-H.distance(a,home1)||a-b)[0];if(j===undefined)break;cur=j;enemy.push(cur);g.board[cur]=2;}
    // Both hold one demolition card; only the raider should spend it on a neck.
    g.hands[1]=['destroy'];g.handAges[1]=[0];
    const supplied=()=>{const s=H.computeSupply(g,2);return enemy.filter(i=>g.board[i]===2&&s[i]).length;},before=supplied();
    assert.ok(before>=12,'fixture line '+before);
    const actions=[];for(let n=0;n<6&&supplied()>=before-3;n++)actions.push(act(g));
    results[name]={before,after:supplied(),actions:actions.map(a=>a.type+':'+a.planner?.memory?.strategy)};
  }
  assert.ok(results.raider.after<=results.raider.before-4,JSON.stringify(results));
  assert.ok(results.raider.after<results.vanguard.after,JSON.stringify(results));
});

test('a consolidating doctrine widens a threatened one-cell supply neck',()=>{
  const g=fresh('doctrine-neck',{lane:'adaptive',centerAversion:3,raid:0,robustness:10,expansion:0});
  const home=g.players[1].home,path=[];let cur=home;
  for(let n=0;n<14;n++){cur=H.ADJ[cur].filter(j=>!g.board[j]).sort((a,b)=>H.distance(a,at(0,0))-H.distance(b,at(0,0))||a-b)[0];path.push(cur);}
  line(g,1,path);const neck=path[3];
  // Thicken everything except the neck, then post an enemy beside it.
  for(const i of path.slice(5))for(const j of H.ADJ[i])if(!g.board[j]&&H.distance(j,neck)>=3)g.board[j]=1;
  const enemy=H.ADJ[neck].find(j=>!g.board[j]&&!H.ADJ[j].some(k=>g.anchors[k]));g.board[enemy]=3;
  const cut=()=>{const before=H.computeSupply(g,1),board=g.board.slice();board[neck]=0;const after=H.computeSupply({...g,board},1);let lost=0;for(let i=0;i<H.COUNT;i++)if(i!==neck&&before[i]&&!after[i])lost++;return lost;};
  const initial=cut();assert.ok(initial>=10,'fixture neck '+initial);
  const actions=[];for(let n=0;n<6&&cut()>0;n++)actions.push(act(g));
  assert.equal(cut(),0,JSON.stringify(actions.map(a=>({type:a.type,cells:a.cells,intent:a.planner?.memory?.strategy}))));
  assert.ok(actions.some(a=>a.planner?.memory?.strategy==='fortify'));
});

test('seeded campaigns spread the six factions over different lanes and intents',()=>{
  const laneSets=[],intentSets=[];
  for(const seed of ['doctrine-variety-1','doctrine-variety-2']){
    const g=new H.Game({seed});g.start();const intents=new Set();
    for(let n=0;n<120;n++){const a=H.chooseAction(g.observation());assert.ok(g.act(a));if(a.planner)intents.add(a.planner.memory.strategy);}
    const lanes=H.PLAYERS.map(p=>g.plannerStates[p]?.campaign?.lane??0);laneSets.push(lanes.join(','));intentSets.push(intents);
    assert.ok(new Set(lanes).size>=2,'lanes '+lanes);assert.ok(lanes.filter(l=>l!==0).length>=3,'lanes '+lanes);
    assert.ok(intents.size>=4,[...intents].join(','));
  }
  assert.notEqual(laneSets[0],laneSets[1],'Different seeds should not replay the same lane assignment');
});
