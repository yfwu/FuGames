/* Normal Hex compatibility entry point: all rules live in hex-core.js. */
(function (root) {
  'use strict';
  const core = typeof module === 'object' && module.exports ? require('./hex-core.js') : root.HexCore;
  if (!core) throw new Error('Load hex-core.js before cardhex-engine.js.');
  const create = options => core.create({ ...(options || {}), mode: 'normal' });
  const api = Object.freeze({ ...create({ playerCount: 3 }), create });
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CardHex = api;
})(typeof window !== 'undefined' ? window : globalThis);
