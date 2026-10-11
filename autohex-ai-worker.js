/* One faction's observation crosses this boundary; never the live Game object. */
'use strict';
importScripts('hex-strategies.js', 'autohex-planner.js', 'hex-core.js');
let instance = null, instanceKey = '';
self.addEventListener('message', event => {
  const job = event.data;
  if (!job || job.type !== 'choose') return;
  const identity = { id: job.id, generation: job.generation, ply: job.ply, turn: job.turn };
  try {
    const view = job.observation;
    if (view?.observer !== job.turn || view.turn !== job.turn || view.ply !== job.ply) throw new Error('Invalid decision observation');
    const config = view.coreConfig;
    if (!config || config.version !== 1 || !['auto', 'normal'].includes(config.mode)) throw new Error('Invalid Hex rules instance');
    const key = `${config.mode}:${config.playerCount}`;
    if (!instance || key !== instanceKey) { instance = HexCore.create({ mode: config.mode, playerCount: config.playerCount }); instanceKey = key; }
    if (instance.RADIUS !== config.radius || view.board.length !== instance.COUNT) throw new Error('Mismatched Hex board');
    const start = performance.now(), action = instance.chooseAction(view);
    self.postMessage({ type: 'decision', ...identity, action, computeMs: performance.now() - start });
  } catch (error) {
    self.postMessage({ type: 'failure', ...identity, message: String(error?.message || error) });
  }
});
