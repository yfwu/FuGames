'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),Core=require('../hex-core.js');
const out=process.env.QA_OUT||path.join(__dirname,'../docs/hex-logistics-2026-11-02');fs.mkdirSync(out,{recursive:true});const report=[];
for(const seed of ['logistics-a','logistics-b','logistics-c'])for(const [mode,n] of [['normal',2],['normal',3],['normal',6],['auto',6]]){
 const H=Core.create({mode,playerCount:n}),g=new H.Game({seed,neutralEvents:false,rotation:report.length%6});g.start();let idle=0,maxIdle=0,lowReserve=0,cuts=0,restores=0;let previous=g.observation(0).supplied;const started=performance.now();
 while(g.phase==='running'&&g.ply<600){const a=H.chooseAction(g.observation());assert.ok(a&&H.legalAction(g,a));assert.ok(g.act(a));if(mode==='auto')g.advanceTime(1000);idle=['rest','discard','offer','accept','reject'].includes(a.type)?idle+1:0;maxIdle=Math.max(maxIdle,idle);
  const view=g.observation(0);for(let i=0;i<H.COUNT;i++)if(g.board[i]){assert.ok(g.reserve[i]>=0&&g.reserve[i]<=6);assert.ok(g.supplyLoad[i]<=4);assert.ok(g.delivered[i]<=2);if(g.reserve[i]<2)lowReserve++;if(previous[i]&&!view.supplied[i])cuts++;if(!previous[i]&&view.supplied[i])restores++;}previous=view.supplied;
  for(const p of H.PLAYERS){assert.ok(g.players[p].supplies>=0&&g.players[p].supplies<=24);assert.ok(g.players[p].haulUsed<=96);}
 }
 const row={seed,mode,players:n,rotation:g.rotation,actions:g.ply,result:g.result?.reason,winners:g.result?.winners,maxIdle,cuts,connections:restores,lowReserveObservations:lowReserve,captures:g.telemetry.captures,destroyed:g.telemetry.destroyed,retreats:g.telemetry.supplyRetreats,goals:g.telemetry.goalArrivals,types:g.telemetry.byType,ms:Math.round(performance.now()-started)};report.push(row);console.log(JSON.stringify(row));
}
fs.writeFileSync(path.join(out,'seeded-report.json'),JSON.stringify(report,null,2)+'\n');
