/* FuGames「朱墨」設計語言：給 canvas / WebGL / three.js 用的同一組色票。
   與 shared/fu.css 的 --fu-* 變數一一對應（tests/fu-design.test.cjs 會比對）。
   傳統 <script> 載入時掛在 window.FuPalette；Node 以 require() 取得。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FuPalette = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // 名稱 → CSS 變數 --fu-<name>
  const colors = Object.freeze({
    'ink-0': '#07090c',   // 最深的墨：頁面底色、3D 背景
    'ink-1': '#0d1116',   // 面板底
    'ink-2': '#151b23',   // 抬升面、輸入框
    'ink-3': '#212a35',   // 邊、格線、hover
    'paper': '#ece4d0',   // 主文字：米紙色
    'paper-dim': '#a8a08c', // 次要文字
    'mute': '#6d7380',    // 註解、停用
    'seal': '#ff4b2b',    // 朱印：品牌主色、主要動作、玩家一
    'seal-deep': '#b92d17',
    'jade': '#35d0a8',    // 玉：成功、友軍、玩家三
    'gold': '#e9b949',    // 金：警示、資源、玩家四
    'azure': '#4fa3ff',   // 青：資訊、玩家二
    'orchid': '#b98cff',  // 紫：特殊、玩家五
    'bone': '#d9d2c0'     // 骨白：中立、玩家六
  });
  // 多方對戰的陣營色順序（玩家一永遠是朱印色）
  const sides = Object.freeze(['seal', 'azure', 'jade', 'gold', 'orchid', 'bone']);
  const hex = name => {
    const value = colors[name];
    if (!value) throw new Error('FuPalette: unknown colour ' + name);
    return value;
  };
  const int = name => parseInt(hex(name).slice(1), 16);           // three.js 的 0xRRGGBB
  const rgb01 = name => { const n = int(name); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
  const rgba = (name, alpha = 1) => { const n = int(name); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${alpha})`; };
  const side = i => hex(sides[((i % sides.length) + sides.length) % sides.length]);
  return Object.freeze({ colors, sides, hex, int, rgb01, rgba, side });
});
