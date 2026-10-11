'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),Module=require('module'),cp=require('child_process'),assert=require('assert/strict');
const root=path.resolve(__dirname,'../..'),seed=process.argv[2]||'planner-engine-development-5171',out=path.join(root,'docs/autohex-planner-2026-10-11/engine-complete-development.json');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const engine=fs.readFileSync(path.join(root,'autohex-engine.js'),'utf8'),planner=fs.readFileSync(path.join(root,'autohex-planner.js'),'utf8');
assert.equal(sha(engine),'0c5b3137c803f3f77ddd3fbb34a132f1986a257d3db2d828a1d2628e37c69993');assert.equal(sha(planner),'2e222d259995f604b07c8b599f681a8ccc025a5e1a709bb649c5c539637ebb7f');
const baseline=cp.execFileSync('git',['show','96c109a:autohex-engine.js'],{cwd:root,encoding:'utf8',maxBuffer:1e7});
function compile(source,name,deps={}){const m=new Module(path.join(root,name));m.filename=path.join(root,name);m.require=r=>{if(deps[r])return deps[r];if(r.startsWith('.'))throw Error('Uncaptured dependency '+r);return require(r);};m._compile(source,m.filename);return m.exports;}
const providers={baseline:compile(baseline,'captured-baseline.js'),candidate:compile(engine,'captured-candidate.js',{'./autohex-planner.js':compile(planner,'captured-planner.js')})};
const output={sample:'one complete paired development seed; not heldout; no runtime changes or tuning',seed,modelMs:600000,actions:2000,sharedCpu:true,sources:{baseline:{commit:'96c109a',sha256:sha(baseline),source:baseline},engine:{sha256:sha(engine),source:engine},planner:{sha256:sha(planner),source:planner}},games:{}};
const save=()=>fs.writeFileSync(out,JSON.stringify(output,null,2)+'\n');save();
for(const [policy,H] of Object.entries(providers)){
 const g=new H.Game({seed,neutralEvents:true});g.start();const initial=sha(JSON.stringify({board:Array.from(g.board),terrain:Array.from(g.terrain),hands:g.hands,draw:g.drawPile,airports:g.airports}));
 const game={initialSha:initial,turns:[],timeline:[],events:[],firstGoalPly:Array(7).fill(null),quarters:Array.from({length:4},()=>({actions:0,changes:0,captures:0,destroyed:0,goals:0,holding:0,air:0,types:{},intents:{}}))};let lastEvent=0;
 function gap(p,supply=H.computeSupply(g,p)){let best=36;for(const c of H.CELLS)if(supply[c.i])best=Math.min(best,18+c[g.players[p].axis]*g.players[p].sign);return best;}
 function route(p){const supply=H.computeSupply(g,p),cost=new Int16Array(H.COUNT).fill(3000),prev=new Int16Array(H.COUNT).fill(-1),buckets=Array.from({length:H.COUNT*3+1},()=>[]),links=new Map();
  for(const b of g.bridges)if(b.owner===p&&g.board[b.a]===p&&g.board[b.b]===p){links.set(b.a,[...(links.get(b.a)||[]),b.b]);links.set(b.b,[...(links.get(b.b)||[]),b.a]);}
  for(let i=0;i<H.COUNT;i++)if(supply[i]){cost[i]=0;buckets[0].push(i);}
  let goal=-1;outer:for(let d=0;d<buckets.length;d++)for(let k=0;k<buckets[d].length;k++){const i=buckets[d][k];if(cost[i]!==d)continue;if(H.goalCell(g,p,i)){goal=i;break outer;}for(const j of [...H.ADJ[i],...(links.get(i)||[])]){if(g.anchors[j]&&g.board[j]!==p)continue;const step=g.board[j]===p?0:g.board[j]?2:g.terrain[j]===1&&!g.roads[j]?2:1,nd=d+step;if(nd<cost[j]){cost[j]=nd;prev[j]=i;buckets[nd].push(j);}}}
  const cells=[];for(let i=goal;i>=0;i=prev[i])cells.push(i);return {gap:gap(p,supply),deficit:goal<0?null:cost[goal],route:cells.reverse(),stones:g.board.filter(x=>x===p).length,supplied:supply.reduce((a,b)=>a+b,0),score:g.players[p].score};
 }
 function sample(){game.timeline.push({ply:g.ply,players:H.PLAYERS.map(route),airports:g.airports.map(a=>({cell:a.cell,owner:a.owner,cluster:a.cluster,progress:a.progress,active:a.active}))});}
 sample();
 for(let n=0;n<2000;n++){
  const p=g.turn,beforeGap=gap(p),beforeBoard=g.board.slice(),old={captures:g.telemetry.captures,destroyed:g.telemetry.destroyed,goals:g.telemetry.goalArrivals,holding:g.telemetry.goalHoldingRounds},t=performance.now();const action=H.chooseAction(g.observation());const ms=performance.now()-t;assert.ok(g.act(action));
  const intent=g.intents?.[p],r={ply:n,player:p,type:action.type,cells:action.cells||[],target:action.target,beforeGap,afterGap:gap(p),ms,intent:intent?{type:intent.type,stage:intent.stage,target:intent.target,committedAtPly:intent.committedAtPly,progress:intent.progress,completed:intent.completed,stalled:intent.stalled,reason:intent.reasonCode}:null};game.turns.push(r);
  const q=game.quarters[Math.floor(n/500)];q.actions++;q.types[r.type]=(q.types[r.type]||0)+1;if(intent)q.intents[intent.type]=(q.intents[intent.type]||0)+1;for(let i=0;i<H.COUNT;i++)q.changes+=Number(beforeBoard[i]!==g.board[i]);q.captures+=g.telemetry.captures-old.captures;q.destroyed+=g.telemetry.destroyed-old.destroyed;q.goals+=g.telemetry.goalArrivals-old.goals;q.holding+=g.telemetry.goalHoldingRounds-old.holding;q.air+=Number(['airdrop','bombard'].includes(r.type));
  for(const e of g.events)if(e.id>lastEvent){if(e.type==='goal-arrival'&&game.firstGoalPly[e.player]===null)game.firstGoalPly[e.player]=n;if(['goal-arrival','goal-lost','airport-unlocked','airport-lost'].includes(e.type))game.events.push(e);}lastEvent=g.events.at(-1)?.id||lastEvent;
  g.advanceTime(300);if((n+1)%60===0)sample();if((n+1)%500===0)console.log(JSON.stringify({policy,through:n+1,goals:g.telemetry.goalArrivals,holding:g.telemetry.goalHoldingRounds,gaps:H.PLAYERS.map(p=>gap(p)),air:g.telemetry.airdrops+g.telemetry.bombardments}));
 }
 sample();assert.equal(g.activeMs,600000);assert.equal(g.phase,'over');game.result=g.result;game.telemetry=g.telemetry;game.finalBoard=Array.from(g.board);game.finalIntents=g.intents||null;output.games[policy]=game;save();
}
assert.equal(output.games.baseline.initialSha,output.games.candidate.initialSha);output.complete=true;save();console.log(out);
