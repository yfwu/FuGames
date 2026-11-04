'use strict';
// Runs 立體三子循環棋 search off the main thread so the cube keeps rotating.
importScripts('cyclic3d-engine.js');
self.onmessage=event=>{
  const {token,kind,state,level,seed}=event.data;
  let s=seed>>>0||1;const rng=()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);
  const result=CyclicCube.chooseMove(CyclicCube.Game.from(state),{level,rng});
  self.postMessage({token,kind:kind||'move',cell:result&&result.cell,depth:result&&result.depth});
};
