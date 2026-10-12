'use strict';
// Summarise saved diversity study runs: node tests/autohex-diversity-summary.cjs baseline candidate
const pres=process.argv.slice(2);
for(const pre of pres){const rows=[],games=[];for(const s of [11,12,13,14]){const d=require(require('path').resolve(__dirname,'../docs/autohex-ai-diversity-2026-10-12',pre+'-seed'+s+'.json'));games.push(d.games[0]);rows.push(...d.games[0].players);}
const m=xs=>(xs.reduce((a,b)=>a+b,0)/xs.length).toFixed(3);
console.log(pre,'centerShare',m(rows.map(r=>r.centerShare)),'centerTarget',m(rows.map(r=>r.centerTargetShare)),'centerCombat',m(games.map(g=>g.centerCombatShare)),'goals',games.reduce((s,g)=>s+g.goalArrivals,0),'hold',games.reduce((s,g)=>s+g.holdingRounds,0),'retreats',games.reduce((s,g)=>s+g.supplyRetreats,0),'captures',games.reduce((s,g)=>s+g.captures,0),'ms',m(games.map(g=>g.aiMsMean)));
const by={};for(const r of rows){const b=by[r.strategy]||={c:[],l:[],g:0,sc:[],cut:[],it:{}};b.c.push(r.centerShare);b.l.push(r.meanAbsLateral);b.g+=r.goals;b.sc.push(r.score);b.cut.push(r.enemySupplyCut);for(const[k,v]of Object.entries(r.intents))b.it[k]=(b.it[k]||0)+v;}
for(const[k,b]of Object.entries(by))console.log('  ',k.padEnd(9),'center',m(b.c),'|lat|',m(b.l),'goals',b.g,'score',m(b.sc),'cut',m(b.cut),JSON.stringify(b.it));}
