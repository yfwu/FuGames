'use strict';
const fs=require('node:fs'),F=require('./flip-five-engine.js'),AI=require('./flip-five-ai.js');
const split=process.argv[2]??'development',count=+(process.argv[3]??16),options={seed:0,nodeBudget:+(process.argv[4]??36000),maxDepth:+(process.argv[5]??4)};
// Held-out opening list fixed before any new-AI game; no tuning uses this split.
const openings=split==='unforced'?[[],[40],[30],[0]]:split==='heldout'?[[22,32],[20,60],[4,39],[13,50]]:[[40,30],[40,31],[30,40],[31,49]];
const coordinate=i=>String.fromCharCode(65+i%9)+(Math.floor(i/9)+1);
const started=Date.now(),games=[];
for(let g=0;g<count;g++){
 const first=g%2+1,newPlayer=Math.floor(g/2)%2?3-first:first,newProfile=g%2?'flipper':'architect',oldProfile=newProfile==='architect'?'flipper':'architect',opening=openings[Math.floor(g/4)%openings.length];
 const game=new F.Game('architect',first);game.start();const moves=[];for(const c of opening){if(!game.act(c))throw Error('Invalid opening');moves.push(coordinate(c));}
 let nodes=0,stops=0,lowestDepth=6,decisions=0;const searchDetails=[];
 while(game.phase==='running'){
  const observation=game.observation();observation.profile=game.turn===newPlayer?newProfile:oldProfile;const action=game.turn===newPlayer?AI.chooseMove(observation,{...options,seed:0xc0ffee+Math.floor(g/4)*997+(g%2)*71}):F.chooseLegacyMove(observation);
  if(!action||!game.act(action.cell,action.reason))throw Error('Illegal action');moves.push(coordinate(action.cell));if(action.stats){nodes+=action.stats.nodes;stops+=action.stats.budgetExhausted;lowestDepth=Math.min(lowestDepth,action.stats.completedDepth);decisions++;searchDetails.push({ply:game.ply,cell:coordinate(action.cell),...action.stats});}
 }
 const row={id:g,opening:opening.map(coordinate),first,newPlayer,newProfile,oldProfile,winner:game.result.winner,newWon:game.result.winner===newPlayer,firstWon:game.result.winner===first,placements:game.ply,nodes,stops,decisions,lowestDepth,moves,searchDetails};games.push(row);process.stderr.write(`${split} ${g+1}/${count}: new ${row.newWon?'win':'loss'} (${newPlayer===first?'first':'second'}), ${game.ply} placements\n`);
}
const result={split,options,games,summary:{count,newWins:games.filter(x=>x.newWon).length,newFirstGames:games.filter(x=>x.newPlayer===x.first).length,newFirstWins:games.filter(x=>x.newPlayer===x.first&&x.newWon).length,newSecondWins:games.filter(x=>x.newPlayer!==x.first&&x.newWon).length,draws:games.filter(x=>!x.winner).length,firstWins:games.filter(x=>x.firstWon).length,elapsedMs:Date.now()-started},proof:false,limitations:'Bounded beam search and correlated seat/profile replicas; not a proof of balance, a universal win strategy, or independent statistical trials.'};process.stdout.write(JSON.stringify(result,null,2)+'\n');
