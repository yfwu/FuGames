'use strict';
// Runs 三子循環棋（平面版）search off the main thread; the master tier builds its solved
// table here once (about half a second) so the board keeps animating.
importScripts('cyclic2d-engine.js');
self.onmessage=event=>{
  const {token,kind,state,level,seed}=event.data;
  let s=seed>>>0||1;const rng=()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);
  const result=CyclicFlat.chooseMove(CyclicFlat.Game.from(state),{level,rng});
  self.postMessage({token,kind:kind||'move',from:result?result.from:null,to:result?result.to:null,depth:result&&result.depth});
};
