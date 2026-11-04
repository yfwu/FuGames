/* FuGames「朱墨」殼層行為：抽屜、幕、吐司、熱鍵、偏好存取。
   傳統 <script src="shared/fu-shell.js" defer> 載入，掛在 window.Fu。
   不依賴任何框架；遊戲邏輯不應依賴本檔（無頭／agent 模式可不載入）。 */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;
  if (root.Fu) return;

  const doc = document;
  const stack = [];          // 目前開啟的圖層（抽屜／幕），Esc 關最上層
  const hotkeys = [];        // {key, label, fn, when}
  let scrim = null;
  let toasts = null;

  const focusable = el => el.querySelector('[autofocus], button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])');
  const byId = ref => typeof ref === 'string' ? doc.getElementById(ref) : ref;

  function ensureScrim() {
    if (scrim) return scrim;
    scrim = doc.createElement('div');
    scrim.className = 'fu-scrim';
    scrim.addEventListener('click', () => { const top = stack[stack.length - 1]; if (top && top.classList.contains('fu-drawer')) close(top); });
    doc.body.appendChild(scrim);
    return scrim;
  }

  function syncTriggers(el, open) {
    if (!el.id) return;
    doc.querySelectorAll(`[data-fu-open="${el.id}"], [data-fu-toggle="${el.id}"]`).forEach(b => b.setAttribute('aria-expanded', String(open)));
  }

  /** 開啟抽屜或幕。el 可以是 id 字串或元素。 */
  function open(ref) {
    const el = byId(ref);
    if (!el || stack.includes(el)) return el;
    el.__fuReturn = doc.activeElement;
    if (el.classList.contains('fu-drawer')) {
      el.removeAttribute('hidden');
      el.setAttribute('role', el.getAttribute('role') || 'dialog');
      // 強制 reflow 讓轉場生效
      void el.offsetWidth;
      el.classList.add('is-open');
      ensureScrim().classList.add('is-on');
    } else {
      el.hidden = false;
    }
    el.setAttribute('aria-hidden', 'false');
    stack.push(el);
    syncTriggers(el, true);
    const target = focusable(el);
    if (target) setTimeout(() => target.focus({ preventScroll: true }), 30);
    el.dispatchEvent(new CustomEvent('fu:open', { bubbles: true }));
    return el;
  }

  function close(ref) {
    const el = byId(ref) || stack[stack.length - 1];
    if (!el) return;
    const i = stack.indexOf(el);
    if (i >= 0) stack.splice(i, 1);
    if (el.classList.contains('fu-drawer')) {
      el.classList.remove('is-open');
      if (!stack.some(x => x.classList.contains('fu-drawer')) && scrim) scrim.classList.remove('is-on');
    } else {
      el.hidden = true;
    }
    el.setAttribute('aria-hidden', 'true');
    syncTriggers(el, false);
    const back = el.__fuReturn;
    if (back && typeof back.focus === 'function' && doc.contains(back)) back.focus({ preventScroll: true });
    el.dispatchEvent(new CustomEvent('fu:close', { bubbles: true }));
  }

  function toggle(ref) {
    const el = byId(ref);
    if (!el) return;
    if (stack.includes(el)) close(el); else open(el);
  }

  const isOpen = ref => stack.includes(byId(ref));

  /** 吐司訊息。tone: 'seal'（預設）| 'ok' | 'warn' | 'info'。 */
  function toast(message, opts = {}) {
    if (!toasts) {
      toasts = doc.createElement('div');
      toasts.className = 'fu-toasts';
      toasts.setAttribute('role', 'status');
      toasts.setAttribute('aria-live', 'polite');
      doc.body.appendChild(toasts);
    }
    const t = doc.createElement('div');
    t.className = 'fu-toast' + (opts.tone && opts.tone !== 'seal' ? ' fu-toast--' + opts.tone : '');
    t.textContent = message;
    toasts.appendChild(t);
    while (toasts.children.length > 4) toasts.firstChild.remove();
    const ms = opts.ms ?? 2600;
    setTimeout(() => { t.classList.add('is-leaving'); setTimeout(() => t.remove(), 260); }, ms);
    return t;
  }

  /** 註冊熱鍵。key 用 KeyboardEvent.key（大小寫不分），label 會出現在熱鍵說明。 */
  function hotkey(key, label, fn, opts = {}) {
    hotkeys.push({ key: String(key).toLowerCase(), label, fn, when: opts.when, hidden: !!opts.hidden });
  }

  function hotkeyList() { return hotkeys.filter(h => !h.hidden).map(h => ({ key: h.key, label: h.label })); }

  /** 每款遊戲的偏好存取（localStorage，失敗時退回記憶體）。 */
  function prefs(gameId, defaults = {}) {
    const key = 'fugames:' + gameId;
    let mem = {};
    try { mem = JSON.parse(root.localStorage.getItem(key) || '{}') || {}; } catch (e) { mem = {}; }
    const data = Object.assign({}, defaults, mem);
    const save = () => { try { root.localStorage.setItem(key, JSON.stringify(data)); } catch (e) { /* 私密模式 */ } };
    return {
      get: (k, fallback) => (k in data ? data[k] : fallback),
      set: (k, v) => { data[k] = v; save(); return v; },
      all: () => Object.assign({}, data),
      reset: () => { Object.keys(data).forEach(k => delete data[k]); Object.assign(data, defaults); save(); }
    };
  }

  /** 把 <form> / 容器內帶 name 的欄位與 prefs 雙向綁定。回傳目前值物件。 */
  function bindSettings(container, store, onChange) {
    const el = byId(container);
    const fields = el ? el.querySelectorAll('[name]') : [];
    const read = f => f.type === 'checkbox' ? f.checked : f.type === 'range' || f.type === 'number' ? Number(f.value) : f.value;
    const values = {};
    fields.forEach(f => {
      if (f.type === 'radio') {
        const v = store.get(f.name);
        if (v !== undefined) f.checked = String(v) === f.value;
        if (f.checked) values[f.name] = f.value;
      } else {
        const v = store.get(f.name);
        if (v !== undefined) { if (f.type === 'checkbox') f.checked = !!v; else f.value = v; }
        values[f.name] = read(f);
      }
      f.addEventListener('change', () => {
        if (f.type === 'radio' && !f.checked) return;
        values[f.name] = read(f);
        store.set(f.name, values[f.name]);
        if (onChange) onChange(f.name, values[f.name], Object.assign({}, values));
      });
    });
    return values;
  }

  /** 分段選擇（.fu-seg 內 button[aria-pressed]）的單選行為。 */
  function wireSeg(seg) {
    seg.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b || !seg.contains(b)) return;
      seg.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      seg.dispatchEvent(new CustomEvent('fu:select', { bubbles: true, detail: { value: b.value || b.dataset.value } }));
    });
  }

  function onKey(e) {
    if (e.defaultPrevented) return;
    if (e.key === 'Escape' && stack.length) { e.preventDefault(); close(stack[stack.length - 1]); return; }
    const tag = (e.target && e.target.tagName) || '';
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (e.target && e.target.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    for (const h of hotkeys) {
      if (h.key === k && (!h.when || h.when())) { e.preventDefault(); h.fn(e); return; }
    }
  }

  function wire(scope) {
    (scope || doc).querySelectorAll('.fu-seg:not([data-fu-wired])').forEach(s => { s.dataset.fuWired = '1'; wireSeg(s); });
    (scope || doc).querySelectorAll('.fu-drawer:not(.is-open)').forEach(d => { d.setAttribute('aria-hidden', 'true'); });
  }

  doc.addEventListener('click', e => {
    const t = e.target.closest && e.target.closest('[data-fu-open], [data-fu-close], [data-fu-toggle]');
    if (!t) return;
    if (t.hasAttribute('data-fu-open')) { e.preventDefault(); open(t.getAttribute('data-fu-open')); }
    else if (t.hasAttribute('data-fu-toggle')) { e.preventDefault(); toggle(t.getAttribute('data-fu-toggle')); }
    else { e.preventDefault(); const id = t.getAttribute('data-fu-close'); close(id ? id : t.closest('.fu-drawer, .fu-curtain')); }
  });
  doc.addEventListener('keydown', onKey);
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', () => wire()); else wire();

  const reducedMotion = () => !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);

  root.Fu = Object.freeze({
    open, close, toggle, isOpen, toast, hotkey, hotkeyList, prefs, bindSettings, wire, reducedMotion,
    get palette() { return root.FuPalette || null; },
    version: '1.0.0'
  });
})(typeof window !== 'undefined' ? window : this);
