/* Bounded search receives only the public board and the chosen personality. */
'use strict';
importScripts('flip-five-engine.js','flip-five-ai.js');
self.addEventListener('message',event=>{
  const job=event.data;if(!job||job.type!=='choose')return;
  const identity={id:job.id,generation:job.generation,ply:job.ply,turn:job.turn};
  try{
    const view=job.observation;
    if(view?.player!==job.turn||job.turn!==2||!Array.isArray(view.board)||view.board.length!==81||view.board.filter(Boolean).length!==job.ply)throw new Error('Mismatched public position');
    const start=performance.now(),move=FlipFiveAI.chooseMove(view,job.options);
    self.postMessage({type:'decision',...identity,move,computeMs:performance.now()-start});
  }catch(error){self.postMessage({type:'failure',...identity,message:String(error?.message||error)});}
});
