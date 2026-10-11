'use strict';
// Development evidence, not a held-out performance or balance claim.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),args=process.argv.slice(2),[mode='normal',countText='3',seed='shared-root-development-6131',file='docs/hex-shared-core-2026-10-11/development.json']=args;
const files=['hex-strategies.js','autohex-planner.js','hex-core.js'];
const sources=Object.fromEntries(files.map(name=>{const code=fs.readFileSync(path.join(root,name),'utf8');return[name,{sha256:crypto.createHash('sha256').update(code).digest('hex'),code}];}));
const modules={};
function captured(name){if(modules[name])return modules[name];const m=new Module(path.join(root,name),module);m.filename=path.join(root,name);m.paths=module.paths;m.require=request=>{if(request.startsWith('./'))return captured(request.slice(2));throw Error('Uncaptured dependency '+request);};m._compile(sources[name].code,m.filename);return modules[name]=m.exports;}
const C=captured('hex-core.js'),E=C.create({mode,playerCount:Number(countText)}),g=new E.Game({seed,neutralEvents:true});g.start();
const start=performance.now(),decisionMs=[],actions=[],quarter=Array.from({length:4},()=>({actions:0,changes:0,combat:0,air:0,connections:0}));
const limit=mode==='auto'?2000:E.TURN_LIMIT,policy=E.PLAYERS.map(p=>({player:p,id:g.players[p].strategyId,decisions:0,types:{},airportSpentMax:0,goals:0,air:0,tunnels:0,bridges:0}));
for(let n=0;n<limit&&g.phase==='running';n++){
 const p=g.turn,before=g.board.slice(),goals=g.telemetry.goalArrivals,combat=g.telemetry.captures+g.telemetry.destroyed,t=performance.now(),a=E.chooseAction(g.observation());decisionMs.push(performance.now()-t);
 assert.ok(a&&E.legalAction(g,a),'illegal decision '+n);assert.ok(g.act(a));
 const q=quarter[Math.min(3,Math.floor(n/limit*4))];q.actions++;q.changes+=g.board.reduce((sum,v,i)=>sum+(v!==before[i]),0);q.combat+=g.telemetry.captures+g.telemetry.destroyed-combat;q.connections+=g.telemetry.goalArrivals-goals;q.air+=Number(['airdrop','bombard'].includes(a.type));
 const row=policy[p-1],intent=a.planner?.publicIntent?.type||'fallback';row.decisions++;row.types[intent]=(row.types[intent]||0)+1;row.airportSpentMax=Math.max(row.airportSpentMax,a.planner?.memory?.program?.airportSpent||0);row.air+=Number(['airdrop','bombard'].includes(a.type));row.tunnels+=Number(a.type==='tunnel');row.bridges+=Number(a.type==='bridge');
 actions.push({p,type:a.type,cells:a.cells||[],intent,stage:a.planner?.publicIntent?.stage,completed:g.intents[p]?.completed||false});
 if(mode==='auto')g.advanceTime(300);
 if((n+1)%250===0)console.log(JSON.stringify({mode,seed,ply:g.ply,goals:g.telemetry.goalArrivals,air:g.telemetry.airdrops+g.telemetry.bombardments,tunnels:g.telemetry.tunnelsBuilt}));
}
assert.equal(g.phase,'over','development game must run to its actual end');
for(const row of policy)row.goals=g.players[row.player].goals;
const sorted=decisionMs.slice().sort((a,b)=>a-b),result={kind:'development-only',complete:true,mode,playerCount:E.PLAYERS.length,seed,sources,configuration:g.strategyConfig,configurationId:g.strategyConfigId,ply:g.ply,phase:g.phase,result:g.result,telemetry:g.telemetry,quarter,policy,wallSeconds:(performance.now()-start)/1000,decisionMs:{mean:decisionMs.reduce((a,b)=>a+b,0)/decisionMs.length,p95:sorted[Math.floor(sorted.length*.95)],max:sorted.at(-1)},actions};
fs.mkdirSync(path.dirname(path.resolve(root,file)),{recursive:true});fs.writeFileSync(path.resolve(root,file),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({...result,sources:Object.fromEntries(Object.entries(sources).map(([n,v])=>[n,v.sha256])),actions:undefined,configuration:undefined}));
