'use strict';
// Paired finite-deck experiment. All decisions receive only Game.observation().
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
const root=path.join(__dirname,'..'),folder=path.join(root,'docs/hex-tactics-2026-10-11');
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
if(!isMainThread){
 const H=new Function(workerData.source+';return CardHex;')();
 const costs=g=>H.PLAYERS.map(p=>H.shortest(g.board,p,g.axes,g.bridges,3,g.terrain,g.roads));
 const gap=(c,p)=>c[p-1]-Math.min(...c.filter((_,i)=>i!==p-1));
 const rank=(c,p)=>gap(c,p)>0?'trailing':gap(c,p)<0?'leading':'tied';
 function opportunity(o,card){
  const legal=cells=>H.legalAction(o,{type:card,cells});
  if(card==='block')return H.CELLS.some(c=>legal([c.i]));
  if(card==='exchange')return H.CELLS.some(c=>o.board[c.i]===o.player&&H.ADJ[c.i].some(i=>legal([c.i,i])));
  return o.bridges.some(b=>b.owner===o.player&&[[b.a,b.b],[b.b,b.a]].some(([a,old])=>H.CELLS.some(c=>legal([a,old,c.i]))));
 }
 for(const config of workerData.configs){
  const {seed,cards,lineup,first,axis,timed,neutral,index,group}=config;
  const g=new H.Game(H.seeded(seed),'rush',first,{seed,cards,terrain:'seeded',timed,neutral});g.reset(first,axis);g.profiles=[null,...lineup];g.start();
  const milestones=[],uses=[],queue=[],actions={},opportunities=Object.fromEntries(H.TACTICAL_CARDS.map(c=>[c,{held:0,legal:0,byRank:{leading:0,trailing:0,tied:0}}]));let steps=0;
  while(g.phase==='running'){
   assert.ok(++steps<230);
   if(g.pending){assert.ok(g.respond(H.chooseCounter(g.observation(g.pending.defender))));continue;}
   const c=costs(g),o=g.observation();
   for(const entry of queue.filter(x=>x.at<=g.ply)){entry.record.gapOneRound=gap(c,entry.player);queue.splice(queue.indexOf(entry),1);}
   if([24,48].includes(g.ply)){
    const low=Math.min(...c),high=Math.max(...c),leaders=H.PLAYERS.filter(p=>c[p-1]===low),trailers=H.PLAYERS.filter(p=>c[p-1]===high);
    const record={ply:g.ply,costs:c,leader:leaders.length===1?leaders[0]:0,trailer:trailers.length===1?trailers[0]:0,gap:high-low};milestones.push(record);
    if(record.trailer)queue.push({at:g.ply+3,player:record.trailer,record});
   }
   for(const card of H.TACTICAL_CARDS)if(o.hand.includes(card)){const m=opportunities[card];m.held++;if(opportunity(o,card)){m.legal++;m.byRank[rank(c,o.player)]++;}}
   const a=H.chooseAction(o);assert.ok(a);assert.ok(H.legalAction(o,a),JSON.stringify({config,ply:g.ply,a}));assert.ok(g.act(a));actions[a.type]=(actions[a.type]||0)+1;
   if(H.TACTICAL_CARDS.includes(a.type)){const record={type:a.type,player:o.player,profile:o.profile,ply:o.ply,rank:rank(c,o.player),gapBefore:gap(c,o.player),gapAfter:gap(costs(g),o.player),gapOneRound:null,cells:a.cells};uses.push(record);queue.push({at:o.ply+3,player:o.player,record});}
   for(const p of H.PLAYERS)assert.equal(g.hands[p].length+g.decks[p].length+g.discarded[p].length+Object.values(g.used[p]).reduce((s,n)=>s+n),13);
   assert.ok(g.ply<=180);
   for(let i=0;i<H.COUNT;i++)if(g.board[i])assert.ok(H.walkable(i,g.terrain,g.roads,g.blocked));
   for(let i=0;i<g.bridges.length;i++){const b=g.bridges[i];assert.ok(H.bridgeValid(g.board,b.owner,b.a,b.b,g.bridges.filter((_,j)=>i!==j)));}
  }
  const winner=g.result.winner;
  for(const r of milestones){r.leaderWon=!!r.leader&&winner===r.leader;r.trailerWon=!!r.trailer&&winner===r.trailer;}
  for(const r of uses)r.userWon=winner===r.player;
  const spent=Object.fromEntries(H.TACTICAL_CARDS.map(c=>[c,{used:H.PLAYERS.reduce((s,p)=>s+g.used[p][c],0),discarded:H.PLAYERS.reduce((s,p)=>s+g.discarded[p].filter(x=>x===c).length,0),inHand:H.PLAYERS.reduce((s,p)=>s+g.hands[p].filter(x=>x===c).length,0),undrawn:H.PLAYERS.reduce((s,p)=>s+g.decks[p].filter(x=>x===c).length,0)}]));
  parentPort.postMessage({...config,winner,winningProfile:winner?lineup[winner-1]:null,ply:g.ply,reason:g.result.reason,milestones,uses,opportunities,spent,actions});
 }
 parentPort.close();
}else(async()=>{
 const mode=process.argv[2]||'development',output=process.argv[3]||path.join(folder,mode+'.json');
 const source=fs.readFileSync(path.join(root,'card_hex.html'),'utf8').match(/<script id="hex-engine">([\s\S]*?)<\/script>/)[1],hash=crypto.createHash('sha256').update(source).digest('hex');
 if(process.env.ENGINE_SHA)assert.equal(hash,process.env.ENGINE_SHA);
 let seeds=[101,307,509,719,929,1151],commitment=null;
 if(mode==='heldout'){
  const text=fs.readFileSync(process.env.SEEDS_FILE||path.join(folder,'heldout-seeds.json'),'utf8');commitment=crypto.createHash('sha256').update(text).digest('hex');assert.equal(commitment,'7bddd8f003b9c3fc7c248afe7ab0814de3383f257913952a9f6484482756a261');seeds=JSON.parse(text);
 }
 const profiles=['rush','cutter','multi'],perms=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]],configs=[];
 function add(s,i,cards,stress){configs.push({index:configs.length,seed:seeds[s],cards,lineup:perms[i].map(p=>profiles[p]),first:(s+i)%3+1,axis:(s+Math.floor(i/2))%3,timed:stress,neutral:stress,group:stress?'optional':'default'});}
 for(let s=0;s<seeds.length;s++)for(let i=0;i<6;i++)for(const cards of ['mixed','tactical'])add(s,i,cards,false);
 if(mode==='heldout')for(let s=0;s<6;s++)for(let i=0;i<6;i++)for(const cards of ['mixed','tactical'])add(s,i,cards,true);
 const rows=[],started=performance.now();
 await Promise.all(Array.from({length:4},(_,k)=>new Promise((resolve,reject)=>{const w=new Worker(__filename,{workerData:{source,configs:configs.filter((_,i)=>i%4===k)}});w.on('message',r=>{rows.push(r);if(rows.length%24===0)console.log(rows.length+'/'+configs.length,((performance.now()-started)/1000).toFixed(1)+'s');});w.on('error',reject);w.on('exit',c=>c?reject(new Error('worker exit '+c)):resolve());})));
 rows.sort((a,b)=>a.index-b.index);assert.equal(rows.length,configs.length);
 function metrics(rs){const marks=Object.fromEntries([24,48].map(ply=>{const ms=rs.flatMap(r=>r.milestones.filter(m=>m.ply===ply));return[ply,{eligible:ms.length,uniqueLeaders:ms.filter(m=>m.leader).length,leaderWins:ms.filter(m=>m.leaderWon).length,uniqueTrailers:ms.filter(m=>m.trailer).length,trailerWins:ms.filter(m=>m.trailerWon).length,meanGap:mean(ms.map(m=>m.gap)),trailerOneRoundGap:mean(ms.filter(m=>m.gapOneRound!==undefined).map(m=>m.gapOneRound))}];}));
 const uses=rs.flatMap(r=>r.uses),cards=Object.fromEntries(['reroute','block','exchange'].map(card=>{const u=uses.filter(x=>x.type===card),byRank=Object.fromEntries(['leading','trailing','tied'].map(rank=>{const a=u.filter(x=>x.rank===rank),next=a.filter(x=>x.gapOneRound!==null);return[rank,{uses:a.length,eventualWins:a.filter(x=>x.userWon).length,immediateGapChange:mean(a.map(x=>x.gapAfter-x.gapBefore)),oneRoundCount:next.length,oneRoundGapChange:mean(next.map(x=>x.gapOneRound-x.gapBefore))}];}));return[card,{uses:u.length,held:rs.reduce((s,r)=>s+r.opportunities[card].held,0),legalOpportunities:rs.reduce((s,r)=>s+r.opportunities[card].legal,0),spent:Object.fromEntries(['used','discarded','inHand','undrawn'].map(k=>[k,rs.reduce((s,r)=>s+r.spent[card][k],0)])),byRank}];}));
 return{games:rs.length,wins:Object.fromEntries(profiles.map(p=>[p,rs.filter(r=>r.winningProfile===p).length])),draws:rs.filter(r=>!r.winner).length,connections:rs.filter(r=>/接通/.test(r.reason)).length,full:rs.filter(r=>/滿盤/.test(r.reason)).length,limit:rs.filter(r=>/180/.test(r.reason)).length,meanPly:mean(rs.map(r=>r.ply)),maxPly:Math.max(...rs.map(r=>r.ply)),milestones:marks,cards};}
 const summaries={};for(const group of [...new Set(rows.map(r=>r.group))])summaries[group]=Object.fromEntries(['mixed','tactical'].map(cards=>[cards,metrics(rows.filter(r=>r.group===group&&r.cards===cards))]));
 let random=123990;const rng=()=>((random=(Math.imul(random,1664525)+1013904223)>>>0)/4294967296);
 const intervals={};for(const group of Object.keys(summaries)){intervals[group]={};const independent=seeds.filter(seed=>rows.some(r=>r.group===group&&r.seed===seed));
  for(const key of ['drawRate','leader24','trailer24','leader48','trailer48']){
   const totals=(rs)=>{if(key==='drawRate')return[rs.filter(r=>!r.winner).length,rs.length];const ply=Number(key.slice(-2)),leader=key.startsWith('leader'),m=rs.flatMap(r=>r.milestones.filter(x=>x.ply===ply));return[m.filter(x=>leader?x.leaderWon:x.trailerWon).length,m.filter(x=>leader?x.leader:x.trailer).length];};
   const clusters=independent.map(seed=>['mixed','tactical'].map(cards=>totals(rows.filter(r=>r.group===group&&r.seed===seed&&r.cards===cards))));
   const diff=cs=>{const sums=[0,1].map(k=>cs.reduce((a,c)=>[a[0]+c[k][0],a[1]+c[k][1]],[0,0]));return sums.every(x=>x[1])?sums[1][0]/sums[1][1]-sums[0][0]/sums[0][1]:null;};
   const samples=Array.from({length:10000},()=>diff(clusters.map(()=>clusters[Math.floor(rng()*clusters.length)]))).filter(x=>x!==null).sort((a,b)=>a-b);intervals[group][key]={difference:diff(clusters),ci95:[samples[Math.floor((samples.length-1)*.025)],samples[Math.floor((samples.length-1)*.975)]],seedClusters:independent.length};
  }
 }
 const report={baseline:'966be7f08d784f802b4ad1a8a6d65a75d007ba9f',mode,engineSha256:hash,seedCommitment:commitment,seeds,elapsedSeconds:(performance.now()-started)/1000,illegalActions:0,summaries,pairedSeedIntervals:intervals,limitations:['Deck condition changes the whole subsequent trajectory; not a randomized test of choosing to play one card.','Public relaxed path cost is a strength proxy; distinct leaders/trailers and games surviving landmarks differ by condition.','Paired seed bootstrap preserves correlation within one seed; finite samples and multiple exploratory outcomes cannot prove equivalence.','Six seat permutations with rotating first player and axes, not their full Cartesian product.','Optional timed/event games are separate from the default estimate.'],fixtures:rows};
 fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,fixtures:undefined},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
