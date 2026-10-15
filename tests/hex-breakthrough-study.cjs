'use strict';
// Bounded comparison, not a balance sweep. Point HEX_ENGINE_DIR at a checkout
// to rerun the same four seeds against a prior implementation.
const path=require('node:path'),Core=require(path.join(process.env.HEX_ENGINE_DIR||path.join(__dirname,'..'),'hex-core.js'));
const runs=[];
for(const mode of ['normal','auto'])for(const seed of ['flank-contact-17','flank-contact-41']){
 const H=Core.create({mode,playerCount:6}),g=new H.Game({seed,neutralEvents:false});g.start();const cap=mode==='auto'?240:180,contacts=new Set(),best=Array(7).fill(H.RADIUS*2),stalled=Array(7).fill(0);let maxStall=0,advances=0,flank=0,illegal=0,ms=0;
 const gaps=()=>H.PLAYERS.map(p=>{const s=H.computeSupply(g,p),pl=g.players[p];return Math.min(...H.CELLS.filter(c=>s[c.i]).map(c=>H.RADIUS+c[pl.axis]*pl.sign));});
 for(let n=0;n<cap&&g.phase==='running';n++){
  const p=g.turn,start=performance.now(),a=H.chooseAction(g.observation());ms+=performance.now()-start;if(!H.legalAction(g,a)){illegal++;break;}
  flank+=Number(a.planner?.memory.strategy==='flank'||a.planner?.memory.campaign?.lane!==0);g.act(a);g.advanceTime(300);
  const gap=gaps()[p-1];if(gap<best[p]){best[p]=gap;stalled[p]=0;advances++;}else maxStall=Math.max(maxStall,++stalled[p]);
  for(const c of H.CELLS)if(g.board[c.i])for(const j of H.ADJ[c.i])if(g.board[j]&&g.board[j]!==g.board[c.i])contacts.add([g.board[c.i],g.board[j]].sort().join('-'));
 }
 const pairs=[...contacts];runs.push({mode,seed,actions:g.ply,flankActions:flank,contactPairs:pairs.length,opponentsPerFaction:H.PLAYERS.map(p=>pairs.filter(k=>k.split('-').includes(String(p))).length),suppliedGaps:gaps(),recordAdvances:advances,longestStalledOwnTurns:maxStall,captures:g.telemetry.captures,destroyed:g.telemetry.destroyed,rests:g.telemetry.byType.rest||0,breaches:g.telemetry.byType.breach||0,result:g.result?.reason||'bounded observation, unfinished',illegal,meanDecisionMs:+(ms/g.ply).toFixed(2)});
}
console.log(JSON.stringify({limit:'4 fixed seeds; normal <=180 actions, auto <=240 actions; no ten-minute balance claim',runs},null,2));
