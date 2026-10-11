// HISTORICAL ONLY: released96c109a normal Hex rules; not shared-core validation.
'use strict';
// Actual legal games: no profile-dependent winner rules or manufactured bonuses.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.join(__dirname,'..'),source=fs.readFileSync(path.join(root,'tests/fixtures/card_hex-96c109a.html'),'utf8').match(/<script id="hex-engine">([\s\S]*?)<\/script>/)[1],H=vm.runInNewContext(source+';CardHex;');
const profiles=['rush','cutter','multi'],seeds=[101,307,509,719,929,1151],matches=[],timings=[],started=performance.now(),counts={actions:{},events:{},illegal:0};
function run(seed,lineup,first,axis,timed,neutral,group){
 const g=new H.Game(H.seeded(seed),'rush',first,{seed,terrain:'seeded',cards:'mixed',timed,neutral});g.reset(first,axis);g.profiles=[null,...lineup];g.start();let steps=0;
 while(g.phase==='running'){
  if(g.pending){assert.ok(g.respond(H.chooseCounter(g.observation(g.pending.defender))));}
  else{const start=performance.now(),a=H.chooseAction(g.observation());timings.push(performance.now()-start);assert.ok(a);assert.ok(g.act(a),JSON.stringify({seed,lineup,a,ply:g.ply}));counts.actions[a.type]=(counts.actions[a.type]||0)+1;}
  for(const e of g.events)counts.events[e.type]=(counts.events[e.type]||0)+1;g.events=[];assert.ok(++steps<220);
  for(const p of H.PLAYERS)assert.equal(g.hands[p].length+g.decks[p].length+g.discarded[p].length+Object.values(g.used[p]).reduce((a,b)=>a+b),13);
 }
 const winner=g.result.winner;matches.push({seed,lineup,first,axis,timed,neutral,group,winner,winningProfile:winner?lineup[winner-1]:null,ply:g.ply,reason:g.result.reason,scores:g.result.scores});
 if(matches.length%12===0)console.log('Completed',matches.length,'games in',((performance.now()-started)/1000).toFixed(1),'s');
}
// Pairwise three-seat mirror matchups: each strategy has equal seat/first exposure.
for(let a=0;a<3;a++)for(let b=a+1;b<3;b++)for(let s=0;s<seeds.length;s++)for(let mirror=0;mirror<2;mirror++)for(let seat=0;seat<3;seat++){
 const lineup=Array(3).fill(profiles[mirror? a:b]);lineup[seat]=profiles[mirror? b:a];run(seeds[s],lineup,(s+seat)%3+1,(s+seat)%3,s%2===1,s%3!==0,profiles[a]+'/'+profiles[b]);
}
// All three personalities together, all six seat permutations, varied first/axis.
const permutations=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
for(let s=0;s<seeds.length;s++)for(let i=0;i<6;i++)run(seeds[s],permutations[i].map(p=>profiles[p]),(s+i)%3+1,(s+Math.floor(i/2))%3,s%2===1,s%3!==0,'three-way');
const matrix={};for(const a of profiles){matrix[a]={};for(const b of profiles)if(a!==b){const rows=matches.filter(m=>m.group!=='three-way'&&m.lineup.includes(a)&&m.lineup.includes(b));matrix[a][b]={games:rows.length,wins:rows.filter(m=>m.winningProfile===a).length,losses:rows.filter(m=>m.winningProfile===b).length,draws:rows.filter(m=>!m.winner).length};}}
const three=matches.filter(m=>m.group==='three-way'),summary=a=>{const x=a.slice().sort((a,b)=>a-b);return {mean:x.reduce((a,b)=>a+b,0)/x.length,median:x[Math.floor(x.length/2)],p95:x[Math.ceil(x.length*.95)-1],max:x.at(-1)};},elapsed=(performance.now()-started)/1000;
const output={generatedAt:new Date().toISOString(),engineSha256:crypto.createHash('sha256').update(source).digest('hex'),seeds,matches:matches.length,matrix,threeWay:{games:three.length,wins:Object.fromEntries(profiles.map(p=>[p,three.filter(m=>m.winningProfile===p).length])),draws:three.filter(m=>!m.winner).length,winsBySeat:[1,2,3].map(p=>three.filter(m=>m.winner===p).length),winsByStartOrder:[0,1,2].map(k=>three.filter(m=>m.winner&&(m.winner-m.first+3)%3===k).length)},counts,length:summary(matches.map(m=>m.ply)),chooseActionMs:summary(timings),elapsedSeconds:elapsed,gamesPerMinute:matches.length/elapsed*60,cycleObserved:profiles.every((p,i)=>matrix[p][profiles[(i+1)%3]].wins>matrix[p][profiles[(i+1)%3]].losses)||profiles.every((p,i)=>matrix[p][profiles[(i+2)%3]].wins>matrix[p][profiles[(i+2)%3]].losses),limitations:['Six independent seeds; seat/mirror matches for the same seed are correlated.','A descriptive three-player mirrored matchup, not a two-player game or significance test.','Timings measured in this Node/Linux container; excludes rendering and configured delays.','Profiles share legal rules, tactical search depth and scoring for wins; no cyclic win bonus.'],fixtures:matches};
fs.writeFileSync(path.join(root,'docs/hex-seeded-2026-10-11/balance.json'),JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify({...output,fixtures:undefined},null,2));
