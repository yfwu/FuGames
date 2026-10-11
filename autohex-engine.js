/* AutoHex compatibility entry point: all rules live in hex-core.js. */
(function (root) {
  'use strict';
  const core = typeof module === 'object' && module.exports ? require('./hex-core.js') : root.HexCore;
  if (!core) throw new Error('Load hex-core.js before autohex-engine.js.');
  const api = core.create({ mode: 'auto', playerCount: 6 });
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AutoHex = api;
})(typeof window !== 'undefined' ? window : globalThis);
