/* AutoHex / MiniHex: shell glue for the full-screen 朱墨 layout. Game logic
   stays in autohex-ui.js; this only adds drawer hotkeys and the hotkey list. */
(function () {
  'use strict';
  const Fu = window.Fu, $ = id => document.getElementById(id);
  if (!Fu) return;
  const click = id => () => { const el = $(id); if (el && !el.disabled && !el.hidden) el.click(); };
  Fu.hotkey('s', '戰局設定', () => Fu.toggle('hx-settings'));
  Fu.hotkey('l', '據點、外交與戰報', () => Fu.toggle('hx-intel'));
  Fu.hotkey('?', '規則與圖例', () => Fu.toggle('hx-rules'));
  Fu.hotkey('p', '開始／暫停／繼續', () => { const play = $('play'); if (play && !play.hidden && !play.disabled) play.click(); else click('pause')(); });
  Fu.hotkey('f', '全圖', click('fit-map'));
  Fu.hotkey('h', '我的家園', click('home-view'));
  Fu.hotkey('+', '放大', click('zoom-in'), { hidden: true });
  Fu.hotkey('=', '', click('zoom-in'), { hidden: true });
  Fu.hotkey('-', '縮小', click('zoom-out'), { hidden: true });
  const list = $('hx-hotkeys');
  if (list) list.innerHTML = Fu.hotkeyList().map(h => `<span class="fu-kbd">${h.key === '?' ? '?' : h.key.toUpperCase()}</span><span>${h.label}</span>`).join('') +
    '<span class="fu-kbd">+ −</span><span>縮放</span><span class="fu-kbd">Esc</span><span>取消選取／關閉面板</span>';
})();
