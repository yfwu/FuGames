/* FuGames bridge AI facade: bidding system + card play, shared by the page, the Web Worker, the agent CLI and tests. */
'use strict';
(function (root, factory) {
  const req = n => (typeof require === 'function' ? require(n) : null);
  const B = root.Bridge || req('./bridge-engine.js');
  const BB = root.BridgeBidding || req('./bridge-bidding.js');
  const BP = root.BridgePlay || req('./bridge-play.js');
  const api = factory(B, BB, BP);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BridgeAI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (B, BB, BP) {
  function chooseBid(view, profile) { return BB.chooseBid(view, profile || B.PROFILES[view.seat]); }
  function chooseCard(view, profile, opts) { return BP.chooseCard(view, profile || B.PROFILES[view.seat], opts || {}); }
  return { chooseBid, chooseCard, explainAuction: BB.explainAuction, inferHands: BB.inferHands, describeMeaning: BB.describeMeaning, evaluate: BB.evaluate, MODES: BP.MODES };
});
