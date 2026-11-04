/* Bridge AI worker: receives only a public view (never the live game) and returns a decision. */
'use strict';
importScripts('bridge-engine.js', 'bridge-dds.js', 'bridge-bidding.js', 'bridge-play.js', 'bridge-ai.js');
self.addEventListener('message', event => {
  const job = event.data;
  if (!job || !job.id) return;
  try {
    const start = performance.now();
    let result;
    if (job.type === 'card') result = BridgeAI.chooseCard(job.view, undefined, { mode: job.mode || 'normal' });
    else if (job.type === 'bid') result = BridgeAI.chooseBid(job.view);
    else if (job.type === 'simulate') {
      const g = Bridge.simulate(job.deal, job.board, { mode: job.mode || 'quick' });
      result = { auction: g.auction, history: g.history, contract: g.contract, tricks: g.tricks, score: g.score };
    } else throw new Error('unknown job');
    self.postMessage({ id: job.id, ok: true, result, ms: performance.now() - start });
  } catch (error) {
    self.postMessage({ id: job.id, ok: false, message: String(error && error.message || error) });
  }
});
