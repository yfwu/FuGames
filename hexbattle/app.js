/* HexBattle page controller (ES module). Wires the headless engine
   (window.HexBattleEngine), the bots (window.HexBattleAI) and the three.js
   view to the 朱墨 shell.

   Three ways to use the page:
     play   親征：the human sits in seat 1 (朱). Everything the page shows for
            that seat comes from E.observe(state, 1), so the page sees exactly
            what an agent would. A guide strip says what to do next; 提示 asks
            the built-in AI for one move and 代打 lets it finish the turn.
     watch  觀戰：all seats are bots. Pause, speed, director camera, a
            highlights ticker and back-to-back matches with series standings.
     stream 直播：watch plus a broadcast layout (no top bar, idle controls
            hide, large scoreboard). URL parameters configure it for an OBS
            browser source, and every highlight is also dispatched as a
            `hexbattle` DOM event (and postMessage to a parent frame). */
import { createView } from './view3d.js';

const E = window.HexBattleEngine, AI = window.HexBattleAI, T = window.HexBattleText, Fu = window.Fu;
const $ = id => document.getElementById(id);
const HUMAN = 1;
const STEP = { slow: .7, normal: .42, fast: .2, skip: 0 };       // seconds per battle beat
const PACE = { slow: 950, normal: 520, fast: 200, skip: 0 };     // ms per visible bot action when spectating
const RES = ['food', 'mat', 'gold'];
const RES_NAME = { food: '糧', mat: '材', gold: '金' };
const KIND_NAME = { build: '建築', unit: '兵種', tactic: '戰術', econ: '經濟', vp: '功勳' };
const STANCE_NAME = { advance: '進攻', guard: '駐守', hold: '原地' };
const PROFILE_NAME = { balanced: '均衡', builder: '經營', warlord: '征伐', warden: '堅守', raider: '劫掠' };
const REASON_NAME = { 'victory points': '達到目標分數', 'round limit': '回合上限', conquest: '征服' };
const CARDS = E.CARDS, BUILDINGS = E.BUILDINGS, UNITS = E.UNITS, UPGRADES = E.UPGRADES, TERRAIN = E.TERRAIN, FEATURE = E.FEATURE;
const sideVar = id => id > 0 ? `var(--fu-side-${(id - 1) % 6 + 1})` : 'var(--fu-bone)';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const strip = s => String(s).replace(/<[^>]*>/g, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const costText = cost => RES.filter(r => cost && cost[r]).map(r => cost[r] + RES_NAME[r]).join(' ') || '免費';

// ------------------------------------------------------------------ prefs + URL
const store = Fu.prefs('hexbattle', { mode: 'play', players: '4', speed: 'normal', seed: '', rounds: '30', doctrine: 'mixed', neutrals: true, borders: true, bars: true, omniscient: true, loop: true, director: true, intermission: '12' });
/* URL parameters override saved preferences for this page load only, so a
   stream URL never rewrites someone's own settings. Touching a setting in the
   drawer drops its override. */
const url = new URLSearchParams(location.search);
const override = {};
{
  const m = url.get('mode') || (url.has('stream') ? 'stream' : url.has('watch') ? 'watch' : null);
  if (['play', 'watch', 'stream'].includes(m)) override.mode = m;
  const pick = (k, ok) => { const v = url.get(k); if (v !== null && ok(v)) override[k] = v; };
  pick('players', v => /^[2-6]$/.test(v));
  pick('seed', v => v.length <= 40);
  pick('rounds', v => ['20', '30', '40'].includes(v));
  pick('speed', v => v in STEP);
  pick('doctrine', v => v === 'mixed' || v in PROFILE_NAME);
  pick('intermission', v => /^\d{1,3}$/.test(v));
  for (const k of ['loop', 'director', 'neutrals', 'omniscient']) if (url.has(k)) override[k] = !/^(0|false|off|no)$/i.test(url.get(k));
}
const pref = k => (k in override ? override[k] : store.get(k));
const settings = Fu.bindSettings('settings-form', store, (name) => {
  delete override[name];
  if (['borders', 'bars', 'omniscient'].includes(name)) refresh();
  if (name === 'director') applyDirector();
  if (name === 'loop') renderSpecDock();
  renderStreamUrl();
});
function setSeg(name, v) {
  for (const seg of document.querySelectorAll(`.fu-seg[data-name="${name}"]`)) seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.value === String(v))));
}
for (const seg of document.querySelectorAll('.fu-seg[data-name]')) {
  const name = seg.dataset.name;
  setSeg(name, pref(name));
  seg.addEventListener('fu:select', e => { delete override[name]; store.set(name, e.detail.value); settings[name] = e.detail.value; setSeg(name, e.detail.value); renderStreamUrl(); });
}
// reflect URL overrides in the drawer fields (without saving them)
for (const [k, v] of Object.entries(override)) {
  const f = document.querySelector(`#settings-form [name="${k}"]`);
  if (f) { if (f.type === 'checkbox') f.checked = !!v; else f.value = v; }
}

// ------------------------------------------------------------------ state
let st = null, mode = 'play', profiles = {}, token = 0, running = false;
let sel = null;              // selected hand card id
let selTargets = [];         // legal target cells of the selected card
let purge = null;            // { card, targets: [] } while choosing cards to remove
let keep = null;             // card id kept at end of turn
let selCell = -1;            // inspected cell
let orderMode = null;        // { units: 'all' | [ids] } waiting for a target cell
let hint = null;             // { action, text } suggested by the built-in AI
let autoing = false;         // 代打 running for the human seat
let lastHand = new Set(), logSeen = new WeakSet();
let battling = 0;           // round whose battle is being played back (0 = none)
let paused = false, matchNo = 0, lastSnap = null, announced = new Set(), nextTimer = null, holdDirector = 0;
const actionLog = [];
const spectating = () => mode !== 'play';

// ------------------------------------------------------------------ view
let view = null;
try {
  view = createView($('stage'), {
    hover: onHover,
    click: onCellClick,
    grab: () => { holdDirector = performance.now() + 9000; if (view) view.setOrbit(0); },
    floater: (x, y, text, cls) => floater(x, y, text, cls)
  });
} catch (err) {
  console.error(err);
  $('fallback').hidden = false;
}
function floater(x, y, text, cls = '', side = 0) {
  const el = document.createElement('span');
  el.className = 'ah-float ' + cls; el.textContent = text;
  if (side) el.style.color = sideVar(side);
  el.style.left = x + 'px'; el.style.top = y + 'px';
  $('floaters').appendChild(el);
  setTimeout(() => el.remove(), 1300);
}
const floatAt = (cell, text, cls = '', side = 0, dy = -20) => { if (!view) return; const p = view.project(cell); if (p) floater(p.x, p.y + dy, text, cls, side); };

// ------------------------------------------------------------------ events for overlays / chat bots
/** Every highlight, round and match boundary is published as a `hexbattle`
    DOM event on window, and to a parent frame when the page is embedded. */
function emit(type, data = {}) {
  const detail = { type, match: matchNo, round: st ? st.round : 0, ...data };
  try { window.dispatchEvent(new CustomEvent('hexbattle', { detail })); } catch (e) { /* old browser */ }
  if (window.parent && window.parent !== window) { try { window.parent.postMessage({ source: 'hexbattle', ...detail }, '*'); } catch (e) { /* cross-origin */ } }
}
const standings = () => st.players.map(p => ({ id: p.id, name: p.name, doctrine: profiles[p.id], vp: E.totalVp(st, p.id), alive: p.alive })).sort((a, b) => b.vp - a.vp || a.id - b.id);

// ------------------------------------------------------------------ series (spectator matches)
function loadSeries() { const s = store.get('series'); return s && typeof s === 'object' && s.doctrines ? s : { matches: 0, doctrines: {}, recent: [] }; }
let series = loadSeries(), recorded = null;
function recordSeries() {
  if (!st || !st.result || !spectating() || recorded === st) return;
  recorded = st;
  series = loadSeries(); series.matches++;
  for (const s of standings()) {
    const d = series.doctrines[s.doctrine] ||= { g: 0, w: 0, vp: 0 };
    d.g++; d.vp += s.vp; if (s.id === st.winner) d.w++;
  }
  series.recent = [{ match: series.matches, seed: st.seed, winner: st.players[st.winner - 1].name, doctrine: profiles[st.winner], reason: st.result.reason, round: st.result.round }, ...(series.recent || [])].slice(0, 12);
  store.set('series', series);
}
function seriesRows() {
  return Object.entries(series.doctrines).map(([k, d]) => ({ k, ...d, rate: d.g ? d.w / d.g : 0 })).sort((a, b) => b.w - a.w || b.rate - a.rate || b.vp / Math.max(1, b.g) - a.vp / Math.max(1, a.g));
}
function renderSeries(el) {
  const rows = seriesRows();
  if (!rows.length) { el.innerHTML = '<p class="fu-small fu-dim">還沒有觀戰紀錄。</p>'; return; }
  el.innerHTML = `<table class="fu-table hb-series__table"><thead><tr><th>打法</th><th>場</th><th>勝</th><th>勝率</th><th>平均分</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(PROFILE_NAME[r.k] || r.k)}</td><td class="fu-num">${r.g}</td><td class="fu-num">${r.w}</td><td class="fu-num">${Math.round(r.rate * 100)}%</td><td class="fu-num">${(r.vp / Math.max(1, r.g)).toFixed(1)}</td></tr>`).join('')}</tbody></table>`;
}
$('series-reset').addEventListener('click', () => { store.set('series', { matches: 0, doctrines: {}, recent: [] }); series = loadSeries(); renderSeries($('series-body')); Fu.toast('戰績已清除', { tone: 'info' }); });

// ------------------------------------------------------------------ game flow
function randomSeed() { const w = ['朱', '墨', '玉', '金', '霜', '嵐', '岩', '濤', '沙', '松']; let s = ''; for (let k = 0; k < 2; k++) s += w[Math.floor(Math.random() * w.length)]; return s + '-' + Math.floor(Math.random() * 9000 + 1000); }
const isHuman = id => mode === 'play' && id === HUMAN;
const myTurn = () => st && st.phase !== 'over' && isHuman(st.turn) && !running && !autoing;

function newGame(over = {}) {
  token++; running = false; autoing = false; paused = false; battling = 0;
  clearTimeout(nextTimer); nextTimer = null;
  mode = over.mode || pref('mode');
  const players = +(over.players || pref('players')) || 4;
  series = loadSeries();
  matchNo = series.matches + 1;
  const base = (pref('seed') || '').trim();
  // with a fixed seed, later matches of a series get their own map: base·2, base·3 …
  const seed = over.seed || (base ? (over.next ? `${base}·${matchNo}` : base) : randomSeed());
  st = E.createGame({ seed, players, maxRounds: +pref('rounds') || 30, neutrals: pref('neutrals') !== false });
  actionLog.length = 0;
  const doctrine = pref('doctrine');
  profiles = {};
  // spectator series rotate doctrines between seats so no doctrine keeps a seat
  const shift = spectating() ? (matchNo - 1) : 0;
  for (const p of st.players) {
    const k = (mode === 'play' ? p.id - 2 : p.id - 1) + shift;
    profiles[p.id] = doctrine === 'mixed' || !AI.PROFILES[doctrine] ? AI.PROFILE_ORDER[((k % AI.PROFILE_ORDER.length) + AI.PROFILE_ORDER.length) % AI.PROFILE_ORDER.length] : doctrine;
  }
  sel = null; selTargets = []; purge = null; keep = null; selCell = -1; orderMode = null; hint = null; lastHand = new Set(); logSeen = new WeakSet();
  announced = new Set(); lastSnap = snap();
  $('log-list').innerHTML = ''; $('ticker').innerHTML = '';
  document.body.dataset.phase = mode;
  document.body.classList.toggle('is-stream', mode === 'stream');
  if (view) {
    view.reset();
    const obs = E.observe(st, HUMAN);
    view.setMap(obs.map);
    const cap = st.buildings.find(b => b.type === 'capital' && b.owner === HUMAN);
    view.fit();
    if (cap) { view.faceSeat(cap.cell); if (mode === 'play') view.focusCell(cap.cell, view.bounds * 1.35); }
    view.setTargets([]); view.setBest([]); view.setSelected(-1);
  }
  Fu.close('intro'); Fu.close('result'); Fu.close('settings');
  applyDirector();
  refresh();
  logEvent(`新戰局 · 種子「${esc(seed)}」· ${players} 方 · 目標 ${st.rules.vpTarget} 分`);
  emit('match-start', { seed, target: st.rules.vpTarget, maxRounds: st.rules.maxRounds, players: st.players.map(p => ({ id: p.id, name: p.name, doctrine: profiles[p.id], human: isHuman(p.id) })) });
  if (spectating()) {
    banner(`第 ${matchNo} 場`, st.players.map(p => `${p.name}·${PROFILE_NAME[profiles[p.id]]}`).join('  '));
    tick(`第 ${matchNo} 場開戰 · ${players} 方 · 先到 ${st.rules.vpTarget} 分獲勝`, 0, 'is-big');
  } else {
    Fu.toast(`第 1 輪 · 順序 ${st.order.map(id => st.players[id - 1].name).join(' → ')}`, { tone: 'info' });
  }
  advance();
}

function viewer() { return spectating() && (mode === 'stream' || pref('omniscient') !== false) ? 0 : HUMAN; }
function obsFor(id) { return E.observe(st, id); }
/** Resolves true once unpaused, false when the game was replaced meanwhile. */
async function hold(my) { while (paused && my === token) await sleep(120); return my === token; }
const pace = () => Fu.reducedMotion() ? Math.min(PACE[pref('speed')] ?? 520, 200) : PACE[pref('speed')] ?? 520;

/** Run bot turns until it is the human's turn or the game ends. */
async function advance() {
  if (running || !st) return;
  running = true; const my = token;
  try {
    while (st.phase !== 'over' && !isHuman(st.turn)) {
      if (!(await hold(my))) return;
      const id = st.turn, p = st.players[id - 1];
      setBusy(true, `${p.name}（${PROFILE_NAME[profiles[id]] || ''}）行動中`, id);
      emit('turn', { player: id, name: p.name, doctrine: profiles[id] });
      await botTurn(id, my);
      if (my !== token) return;
      if (spectating()) await sleep(STEP[pref('speed')] ? 260 : 30);
    }
  } finally {
    if (my === token) { running = false; setBusy(false); }
  }
  if (my !== token) return;
  refresh();
  if (st.phase === 'over') showResult();
  else if (myTurn()) { Fu.toast(`第 ${st.round} 輪 · 你的回合`, { tone: 'ok', ms: 1600 }); }
}

async function botTurn(id, my) {
  const prof = profiles[id], watch = spectating();
  if (watch && director()) { const cap = st.buildings.find(b => b.type === 'capital' && b.owner === id); if (cap && pace() >= 400) view.focusCell(cap.cell, view.bounds * 1.15, .95); }
  for (let k = 0; k < 60; k++) {
    if (watch && !(await hold(my))) return;
    let a = AI.decide(st, id, prof) || { type: 'end' };
    if (a.type === 'end') { refresh(); await sleep(60); if (my !== token) return; }
    const pre = st.round, preVis = E.visibleSet(st, HUMAN);
    let r = E.act(st, id, a);
    if (!r.ok) { a = { type: 'end' }; r = E.act(st, id, a); }
    actionLog.push({ player: id, action: a });
    if (a.type === 'end') {
      if (st.round !== pre || st.phase === 'over') await playBattle(pre, preVis, my);
      return;
    }
    if (watch) { await showBotAction(id, r); if (my !== token) return; }
  }
  const pre = st.round, preVis = E.visibleSet(st, HUMAN);
  E.act(st, id, { type: 'end' }); actionLog.push({ player: id, action: { type: 'end' } });
  if (st.round !== pre || st.phase === 'over') await playBattle(pre, preVis, my);
}

/** Spectator pacing: show one bot action where it happened, then wait. */
async function showBotAction(id, r) {
  const ms = pace();
  let shown = false;
  for (const e of r.events || []) {
    if (e.e === 'play' && e.cell >= 0) {
      const def = CARDS[e.card];
      if (ms) { floatAt(e.cell, def.name, def.kind === 'tactic' ? 'is-gold' : '', id); if (view) view.ping(e.cell, id); }
      if (director() && ms >= 400) view.focusCell(e.cell, view.bounds * .95);
      if (def.kind === 'build' && e.card === 'shrine') tick(`${st.players[id - 1].name}在遺跡上蓋起神殿`, id);
      shown = true;
    } else if (e.e === 'play' && ms) {
      const def = CARDS[e.card], cap = st.buildings.find(b => b.type === 'capital' && b.owner === id);
      if (cap && def.kind !== 'econ') floatAt(cap.cell, def.name, 'is-gold', id);
      shown = def.kind !== 'econ';
    } else if (e.e === 'buy') {
      const def = CARDS[e.card];
      if (def.kind === 'vp') tick(`${st.players[id - 1].name}買下${def.name}（+${def.vp} 分）`, id);
    } else if (e.e === 'upgrade') {
      if (ms) { floatAt(e.cell, `升級 Lv${e.lvl}`, 'is-gold', id); if (view) view.ping(e.cell, id); }
      if (e.type === 'capital') tick(`${st.players[id - 1].name}把都城升到 Lv${e.lvl}`, id);
      shown = true;
    } else if (e.e === 'order' || e.e === 'advance') shown = true;
  }
  if (!ms) return;
  refresh();
  await sleep(shown ? ms : Math.round(ms / 4));
}

/** Animate the battle of round `round`, filtered to what seat 1 could see. */
async function playBattle(round, preVis, my = token) {
  const battle = st.battle;
  if (!battle || battle.round !== round) { refresh(); return; }
  const omni = viewer() === 0, postVis = E.visibleSet(st, HUMAN);
  const seen = i => i !== undefined && (preVis[i] || postVis[i]);
  const frames = omni ? battle.frames : battle.frames.map(f => f.filter(e => seen(e.from) || seen(e.to) || seen(e.cell)));
  const step = Fu.reducedMotion() ? 0 : STEP[pref('speed')] ?? .42;
  const live = frames.filter(f => f.length);
  const fights = live.flat().filter(e => e.e === 'hit').length;
  battling = round;
  setBusy(true, `第 ${round} 輪 · 交戰`, 0);
  if (spectating() && fights && step > 0) banner('交戰', `第 ${round} 輪`, 1100);
  if (director() && step > 0) { const h = hotspot(live.flat()); if (h && h.n >= 2) view.focusPoint(h.x, h.z, view.bounds * .78, .9); }
  let aim = null;
  if (view && live.length && step > 0) await view.playFrames(live, {
    step,
    gate: () => hold(my).then(ok => { if (!ok) throw new Error('stale'); }),
    alive: () => my === token,
    onFrame: fe => {
      if (!director()) return;
      const h = hotspot(fe); if (!h || h.n < 3) return;
      if (!aim || Math.hypot(aim.x - h.x, aim.z - h.z) > 6) { aim = h; view.focusPoint(h.x, h.z); }
    }
  });
  battling = 0;
  if (my !== token) return;
  // round scoring
  for (const s of battle.scoring) for (const part of s.parts) if (view && (omni || seen(part.cell))) floatAt(part.cell, `+${part.vp} ${st.players[s.player - 1].name}`, 'is-gold', 0, -30);
  refresh();
  roundHighlights(round);
  summariseRound(round);
  if (director()) view.fit();
  if (step > 0) await sleep(Math.min(900, step * 1600));
}

/** The densest cluster of combat events: { x, z, n } in world units. */
function hotspot(events) {
  if (!view) return null;
  const pts = [];
  for (const e of events) { const i = e.e === 'hit' ? e.to : e.e === 'raze' || e.e === 'die' || e.e === 'trap' ? e.cell : -1; const p = i >= 0 && view.cellXZ(i); if (p) pts.push(p); }
  if (!pts.length) return null;
  let best = pts[0], bn = 0;
  for (const p of pts) { let n = 0; for (const q of pts) if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 5) n++; if (n > bn) { bn = n; best = p; } }
  const near = pts.filter(q => Math.hypot(best[0] - q[0], best[1] - q[1]) < 5);
  return { x: near.reduce((s, q) => s + q[0], 0) / near.length, z: near.reduce((s, q) => s + q[1], 0) / near.length, n: near.length };
}

// ------------------------------------------------------------------ highlights
function snap() {
  const holders = {};
  for (const r of st.map.relics) holders[r] = (st.players.find(p => p.alive && E.relicHeld(st, p.id, r)) || {}).id || 0;
  const s = standings();
  return { holders, leader: s.length > 1 && s[0].vp > s[1].vp ? s[0].id : 0, vp: Object.fromEntries(s.map(x => [x.id, x.vp])) };
}
function roundHighlights(round) {
  const now = snap(), before = lastSnap || now, name = id => st.players[id - 1].name;
  const ev = st.log.filter(e => e.round === round);
  const deaths = ev.filter(e => e.e === 'die').length, razes = ev.filter(e => e.e === 'raze');
  for (const e of razes) {
    if (e.type === 'capital') { banner('都城陷落', `${e.by ? name(e.by) + '攻破' : ''}${e.owner ? name(e.owner) : '中立'}的都城`, 2600); tick(`<b>${e.by ? name(e.by) : '有人'}攻破了${e.owner ? name(e.owner) : '中立'}的都城（+5 分）</b>`, e.by, 'is-big'); }
    else if (e.owner && spectating()) tick(`${e.by ? name(e.by) : '中立'}摧毀${name(e.owner)}的${BUILDINGS[e.type].name}`, e.by || 0);
  }
  for (const e of ev.filter(x => x.e === 'eliminated')) { tick(`<b>${name(e.player)}滅亡</b>`, e.player, 'is-big'); emit('highlight', { kind: 'eliminated', player: e.player, text: `${name(e.player)}滅亡` }); }
  if (spectating() && (deaths || razes.length)) tick(`第 ${round} 輪交戰：陣亡 ${deaths} 支${razes.length ? `、摧毀 ${razes.length} 座` : ''}`, 0, 'is-quiet');
  for (const r of st.map.relics) {
    const a = before.holders[r] || 0, b = now.holders[r] || 0;
    if (b && a !== b) tick(`${name(b)}${r === st.map.center ? '奪下中央遺跡（每輪 2 分）' : '控制一處遺跡'}`, b);
    else if (a && !b && r === st.map.center) tick(`${name(a)}失去中央遺跡`, a, 'is-quiet');
  }
  if (now.leader && now.leader !== before.leader) tick(`${name(now.leader)}取得領先 · ${now.vp[now.leader]} 分`, now.leader);
  const target = st.rules.vpTarget;
  for (const [id, vp] of Object.entries(now.vp)) {
    const key = 'near:' + id;
    if (st.phase !== 'over' && vp >= target - 6 && !announced.has(key)) { announced.add(key); tick(`<b>${name(+id)}只差 ${target - vp} 分就獲勝</b>`, +id, 'is-big'); }
  }
  lastSnap = now;
  emit('round', { round, standings: standings(), scoring: (st.battle ? st.battle.scoring : []).map(s => ({ player: s.player, gain: s.gain })) });
}
/** Ticker line (spectator) + log + event. `html` may hold <b>. */
function tick(html, side = 0, cls = '') {
  emit('highlight', { text: strip(html), side });
  if (!spectating()) return;
  const li = document.createElement('li');
  li.className = cls; li.style.setProperty('--side', sideVar(side));
  li.innerHTML = `<span class="fu-side"></span><span>${html}</span>`;
  const list = $('ticker'); list.prepend(li);
  while (list.children.length > (mode === 'stream' ? 5 : 4)) list.lastChild.remove();
  setTimeout(() => li.classList.add('is-old'), 14000);
  setTimeout(() => li.remove(), 45000);
}
let bannerTimer = null;
function banner(text, kicker = '', ms = 1800) {
  if (!spectating() && !/陷落|滅亡/.test(text)) return;
  const el = $('banner');
  $('banner-text').textContent = text; $('banner-kicker').textContent = kicker;
  el.hidden = false; el.classList.remove('is-on'); void el.offsetWidth; el.classList.add('is-on');
  clearTimeout(bannerTimer); bannerTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function summariseRound(round) {
  if (mode !== 'play') return;
  const mine = st.battle && st.battle.scoring.find(s => s.player === HUMAN);
  const ev = st.log.filter(e => e.round === round + 1 || e.round === round);
  const hungry = ev.filter(e => e.e === 'hungry' && e.player === HUMAN && e.round === round + 1).length;
  const starve = ev.filter(e => e.e === 'starve' && e.player === HUMAN && e.round === round + 1).length;
  const lost = ev.filter(e => (e.e === 'raze' && e.owner === HUMAN) || (e.e === 'die' && e.owner === HUMAN)).length;
  const bits = [`第 ${round} 輪結算`];
  if (mine && mine.gain) bits.push(`+${mine.gain} 分`);
  if (lost) bits.push(`損失 ${lost}`);
  if (hungry) bits.push(`${hungry} 座建築缺糧停工`);
  if (starve) bits.push(`${starve} 支部隊挨餓`);
  Fu.toast(bits.join(' · '), { tone: hungry || starve || lost ? 'warn' : 'info', ms: 3200 });
}

function humanAct(action, quiet = false, auto = false) {
  if (!(auto ? st && st.phase !== 'over' && isHuman(st.turn) && !running : myTurn())) return { ok: false, error: '現在不是你的回合' };
  const pre = st.round, preVis = E.visibleSet(st, HUMAN);
  const r = E.act(st, HUMAN, action);
  if (!r.ok) { if (!quiet) Fu.toast(r.error, { tone: 'warn' }); return r; }
  actionLog.push({ player: HUMAN, action });
  hint = null; if (view) view.setBest([]);
  for (const e of r.events) narrate(e);
  if (action.type === 'end') {
    sel = null; selTargets = []; purge = null; keep = null; orderMode = null;
    if (view) { view.setTargets([]); }
    if (st.round !== pre || st.phase === 'over') {
      running = true; const my = token;
      playBattle(pre, preVis, my).then(() => { if (my === token) { running = false; advance(); } });
      return r;
    }
    advance();
    return r;
  }
  refresh();
  return r;
}

function narrate(e) {
  if (!view) return;
  if (e.e === 'play' && e.cell >= 0) { floatAt(e.cell, CARDS[e.card].name, CARDS[e.card].kind === 'tactic' ? 'is-gold' : 'is-good'); view.ping(e.cell, HUMAN); }
  if (e.e === 'play' && CARDS[e.card].kind === 'econ') Fu.toast(`${CARDS[e.card].name}：${CARDS[e.card].text}`, { tone: 'ok', ms: 1400 });
  if (e.e === 'upgrade') floatAt(e.cell, `升級 Lv${e.lvl}`, 'is-gold');
}

// ------------------------------------------------------------------ rendering
function refresh() {
  if (!st) return;
  const obs = obsFor(HUMAN), vid = viewer(), vobs = vid === HUMAN ? obs : obsFor(vid);
  if (view) {
    view.update(vobs, { omniscient: vid === 0, borders: pref('borders') !== false, bars: pref('bars') !== false });
    if (sel !== null && myTurn()) { selTargets = targetsOf(sel); view.setTargets(selTargets, undefined); }
    else if (!orderMode) view.setTargets([]);
  }
  const legal = myTurn() ? E.legalActions(st, HUMAN) : [];
  renderTop(obs, legal); renderRes(obs); renderFactions(obs); renderHand(obs, legal); renderMarket(obs); renderDeck(obs); renderCell(); renderLog(); renderGuide(obs, legal); renderOnAir(obs);
  document.body.dataset.busy = running && mode === 'play' ? '1' : '0';
}

function renderTop(obs, legal = []) {
  const chip = $('turn-chip');
  if (obs.phase === 'over') { chip.hidden = false; chip.textContent = '戰局結束'; }
  else if (mode === 'play') { chip.hidden = !myTurn(); chip.textContent = '你的回合'; }
  else { chip.hidden = false; chip.textContent = mode === 'stream' ? '直播中' : '觀戰中'; }
  const round = battling || obs.round;
  $('phase-label').textContent = spectating() ? `${mode === 'stream' ? '直播' : '觀戰'} · 第 ${matchNo} 場 · 第 ${round} / ${obs.maxRounds} 輪` : `第 ${round} / ${obs.maxRounds} 輪 · ${battling ? '交戰' : myTurn() ? '布局中' : '等待'}`;
  $('round-label').textContent = `第 ${obs.round} 輪`;
  $('target-label').textContent = `目標 ${obs.vpTarget}`;
  const btnEnd = $('btn-end'); btnEnd.disabled = !myTurn();
  // nothing useful left: the end button invites the click
  const canPlay = legal.some(a => a.type === 'play'), canBuy = legal.some(a => a.type === 'buy');
  btnEnd.classList.toggle('is-ready', myTurn() && !canPlay && !canBuy && sel === null && !orderMode);
  $('btn-army').disabled = !myTurn() || !obs.units.some(u => u.owner === HUMAN);
  $('btn-guard').disabled = $('btn-army').disabled;
  $('btn-army').setAttribute('aria-pressed', String(!!orderMode && orderMode.units === 'all'));
  $('btn-hint').disabled = !myTurn(); $('btn-auto').disabled = !myTurn();
}

function renderRes(obs) {
  if (!obs.res) return;
  for (const r of RES) {
    const el = document.querySelector(`.ah-res__item[data-res="${r}"]`);
    el.querySelector('[data-v]').textContent = obs.res[r];
    el.querySelector('[data-cap]').textContent = '/' + obs.cap;
    const net = obs.income.net[r], ne = el.querySelector('[data-net]');
    ne.textContent = (net >= 0 ? '+' : '') + net + ' /輪';
    ne.classList.toggle('is-neg', net < 0);
    el.classList.toggle('is-full', obs.res[r] >= obs.cap);
  }
  const pips = $('ap-pips'), total = Math.max(obs.ap, E.apOf(st, HUMAN));
  pips.innerHTML = Array.from({ length: total }, (_, k) => `<i class="${k < obs.ap ? 'on' : ''}"></i>`).join('');
  pips.setAttribute('aria-label', `剩 ${obs.ap} 點`);
  $('ap-text').textContent = `${obs.ap}/${total}`;
  $('trade-rate').textContent = obs.tradeRate + ':1';
  $('trade-do').textContent = `付 ${obs.tradeRate} 換 1`;
  $('trade-open').disabled = !myTurn();
  const warn = [];
  if (obs.income.idle.length) warn.push(`${obs.income.idle.length} 座建築下輪會缺糧停工`);
  else if (obs.income.net.food < 0) warn.push(`糧食每輪 ${obs.income.net.food}`);
  const over = RES.filter(r => obs.res[r] + obs.income.net[r] > obs.cap).map(r => RES_NAME[r]);
  if (over.length) warn.push(`${over.join('、')}將溢出上限，花掉或交易`);
  $('res-warn').hidden = !warn.length; $('res-warn').textContent = warn.join('；');
}

function renderFactions(obs) {
  const max = Math.max(1, obs.vpTarget);
  // spectators see a ranked scoreboard; the player keeps seat order
  const list = spectating() ? [...obs.players].sort((a, b) => b.vp - a.vp || a.id - b.id) : obs.players;
  const wins = {}; if (spectating()) for (const r of seriesRows()) wins[r.k] = r.w;
  $('factions').innerHTML = list.map((p, rank) => {
    const turn = obs.phase !== 'over' && obs.turn === p.id && !battling;
    const tag = mode === 'play' ? (p.id === HUMAN ? '你' : PROFILE_NAME[profiles[p.id]]) : PROFILE_NAME[profiles[p.id]];
    const order = obs.order.indexOf(p.id) + 1;
    const w = spectating() && wins[profiles[p.id]] ? `<small class="ah-f__wins" title="此打法在本系列的勝場">${wins[profiles[p.id]]}勝</small>` : '';
    return `<li class="${turn ? 'is-turn' : ''} ${p.alive ? '' : 'is-out'}" style="--side:${sideVar(p.id)}" data-player="${p.id}" title="${esc(p.name)} · ${tag} · 本輪第 ${order} 順位">
      ${spectating() ? `<span class="ah-f__rank fu-num">${rank + 1}</span>` : ''}<span class="fu-side"></span>
      <span class="ah-f__name">${esc(p.name)} <small class="fu-dim">${esc(tag || '')}</small>${w}${turn ? '<small class="ah-f__now">行動中</small>' : ''}<span class="ah-vpbar"><i style="--v:${Math.min(1, p.vp / max)}"></i></span></span>
      <span class="ah-f__meta">${p.territory}地 ${p.units}兵</span>
      <span class="ah-f__vp">${p.vp}</span></li>`;
  }).join('');
}

function cardHTML(k, opts = {}) {
  const def = CARDS[k], cost = opts.cost || def.cost || {}, res = opts.res;
  const costs = RES.filter(r => cost[r]).map(r => `<span class="${res && res[r] < cost[r] ? 'is-short' : ''}">${cost[r]}${RES_NAME[r]}</span>`).join('');
  const ap = def.ap ? `<span class="ah-card__ap" aria-label="${def.ap} 指令點">${'<i></i>'.repeat(def.ap)}</span>` : '';
  const vp = def.vp ? `<span>${def.vp} 分</span>` : '';
  return `<span class="ah-card__kind">${KIND_NAME[def.kind]}</span><span class="ah-card__name">${esc(def.name)}</span><span class="ah-card__text">${esc(def.text)}</span><span class="ah-card__cost">${costs || (def.kind === 'econ' ? '<span>免費</span>' : '')}${vp}${ap}</span>`;
}
/** Why a hand card cannot be played right now, in a few characters. */
function whyNot(obs, c) {
  const def = CARDS[c.k];
  if (def.kind === 'vp') return '計分用';
  if (!myTurn()) return '';
  if ((def.ap || 0) > obs.ap) return '缺指令點';
  const short = RES.filter(r => c.cost && (c.cost[r] || 0) > obs.res[r]).map(r => `缺${c.cost[r] - obs.res[r]}${RES_NAME[r]}`);
  if (short.length) return short.join(' ');
  return '沒有位置';
}

function renderHand(obs, legalList) {
  const hand = $('hand');
  if (!obs.hand || spectating()) { hand.innerHTML = ''; return; }
  const legal = new Set((legalList || []).filter(a => a.type === 'play').map(a => a.card));
  if (keep !== null && !obs.hand.some(c => c.id === keep)) keep = null;
  if (sel !== null && !obs.hand.some(c => c.id === sel)) { sel = null; selTargets = []; }
  if (purge && !obs.hand.some(c => c.id === purge.card)) purge = null;
  const hinted = hint && hint.action.type === 'play' ? hint.action.card : null;
  let n = 0;
  hand.innerHTML = obs.hand.map(c => {
    const def = CARDS[c.k], ready = legal.has(c.id) || (c.k === 'purge' && obs.hand.length > 1 && myTurn());
    const dead = !ready;
    const isNew = !lastHand.has(c.id);
    const pressed = sel === c.id || (purge && purge.card === c.id);
    const marked = purge && purge.targets.includes(c.id);
    const title = `${def.name}（${KIND_NAME[def.kind]}）：${def.text}`;
    const why = dead ? whyNot(obs, c) : '';
    return `<button class="ah-card ${dead ? 'is-dead' : 'is-ready'} ${isNew ? 'is-new' : ''} ${keep === c.id ? 'is-kept' : ''} ${marked ? 'is-marked' : ''} ${hinted === c.id ? 'is-hint' : ''}" style="--i:${isNew ? n++ : 0}" data-kind="${def.kind}" data-card="${c.id}" aria-pressed="${pressed}" title="${esc(title)}">
      ${cardHTML(c.k, { cost: c.cost, res: obs.res })}
      <span class="ah-card__acts"><span data-sell title="變賣：放進棄牌堆，+1 金">賣+1金</span><span data-keep title="回合結束時把這張留到下回合">留</span></span>
      ${why ? `<span class="ah-card__why">${esc(why)}</span>` : ''}
      ${marked ? '<span class="ah-card__mark">移除</span>' : ''}</button>`;
  }).join('');
  lastHand = new Set(obs.hand.map(c => c.id));
}

function renderMarket(obs) {
  if (!obs.market) return;
  const gold = obs.res ? obs.res.gold : 0;
  const can = m => myTurn() && gold >= m.price;
  const afford = obs.market.filter(can).length;
  $('market-gold').textContent = gold; $('market-deck').textContent = obs.marketDeck;
  $('btn-market').innerHTML = `市場 <span class="fu-num ${afford ? 'is-afford' : ''}" title="買得起的牌">${afford ? afford + ' 可買' : obs.market.length}</span> <span class="fu-kbd fu-hide-sm">M</span>`;
  $('btn-market').classList.toggle('is-hint', !!(hint && hint.action.type === 'buy'));
  const hinted = hint && hint.action.type === 'buy' ? hint.action.slot : -1;
  $('market-row').innerHTML = obs.market.map((m, k) => {
    return `<div class="ah-card ${k === 0 ? 'is-leaving' : ''} ${m.slot === hinted ? 'is-hint' : ''}" data-kind="${CARDS[m.k].kind}">${cardHTML(m.k)}<button class="fu-btn fu-btn--sm ${can(m) ? 'fu-btn--seal' : ''}" data-buy="${m.slot}" ${can(m) ? '' : 'disabled'}>買 · ${m.price} 金</button></div>`;
  }).join('');
}

function renderDeck(obs) {
  if (!obs.hand) return;
  const all = [...obs.hand.map(c => c.k), ...obs.deckList, ...obs.discard];
  $('deck-count').textContent = all.length;
  const count = list => { const m = new Map(); for (const k of list) m.set(k, (m.get(k) || 0) + 1); return [...m.entries()].sort((a, b) => CARDS[a[0]].kind.localeCompare(CARDS[b[0]].kind) || b[1] - a[1]); };
  const list = l => l.length ? `<ul class="fu-list ah-decklist">${count(l).map(([k, n]) => `<li><span class="fu-side" style="--side:var(--fu-${({ build: 'bone', unit: 'seal', tactic: 'azure', econ: 'gold', vp: 'orchid' })[CARDS[k].kind]})"></span>${esc(CARDS[k].name)}<b>×${n}</b></li>`).join('')}</ul>` : '<p class="fu-small fu-dim">（空）</p>';
  const vp = all.reduce((s, k) => s + (CARDS[k].vp || 0), 0);
  $('deck-body').innerHTML = `
    <p class="fu-small fu-dim">共 ${all.length} 張 · 功勳 ${vp} 分 · 已移除 ${obs.trashed || 0} 張。牌抽完時，棄牌堆洗回成新牌堆。</p>
    <h3>抽牌堆 · ${obs.drawPile}</h3>${list(obs.deckList)}
    <h3>棄牌堆 · ${obs.discard.length}</h3>${list(obs.discard)}
    <h3>手牌 · ${obs.hand.length}</h3>${list(obs.hand.map(c => c.k))}`;
}

/** One line under the hand that always says what to do next. */
function renderGuide(obs, legal) {
  const g = $('guide');
  if (mode !== 'play' || !st || obs.phase === 'over') { g.hidden = true; return; }
  g.hidden = false;
  const msg = $('guide-text');
  let text = '', tone = '';
  if (autoing) text = 'AI 正在代打你的回合…';
  else if (!myTurn()) { const p = st.turn && st.players[st.turn - 1]; text = running ? (p && st.turn !== HUMAN ? `${p.name}（${PROFILE_NAME[profiles[p.id]]}）行動中，等一下就輪到你` : '交戰播放中…') : '等待中'; tone = 'is-wait'; }
  else if (hint) { text = `提示：${hint.text}`; tone = 'is-hint'; }
  else if (purge) text = `整編：點選至多 2 張要永久移除的手牌（已選 ${purge.targets.length}），再點一次「整編」確認 · Esc 取消`;
  else if (orderMode) text = `${orderMode.units === 'all' ? '全軍' : '這支部隊'}要去哪裡？點地圖上的目標格（紅框＝遺跡與已知敵方建築）· 右鍵或 Esc 取消`;
  else if (sel !== null) {
    const card = st.players[HUMAN - 1].hand.find(c => c.id === sel), def = card && CARDS[card.k];
    if (def) text = def.kind === 'build' ? `把${def.name}蓋在藍框格子；金框是收益最好的位置，滑過格子看收益 · Esc 取消`
      : def.kind === 'unit' ? `點藍框的都城、兵營或工坊徵召${def.name} · Esc 取消`
      : def.target ? `點藍框目標使用${def.name} · Esc 取消` : `再點一次${def.name}就打出：${def.text}`;
  } else {
    const plays = new Set(legal.filter(a => a.type === 'play').map(a => a.card));
    const hand = obs.hand.filter(c => plays.has(c.id));
    const free = hand.filter(c => CARDS[c.k].kind === 'econ').length;
    const buy = obs.market.filter(m => obs.res.gold >= m.price).length;
    const bits = [];
    if (free) bits.push(`先打 ${free} 張免費的經濟牌`);
    else if (hand.length) bits.push(`${hand.length} 張牌可以打（亮框的牌），剩 ${obs.ap} 指令點`);
    if (buy) bits.push(`市場有 ${buy} 張買得起（M）`);
    if (!bits.length) { bits.push('這回合能做的都做了 → 按「結束回合」（E）'); tone = 'is-done'; }
    else if (obs.round >= 3 && obs.units.some(u => u.owner === HUMAN) && !obs.units.some(u => u.owner === HUMAN && u.stance === 'advance')) bits.push('部隊都在駐守，想進攻按「全軍出擊」（A）');
    text = bits.join(' · ');
  }
  msg.textContent = text; g.className = 'hb-guide ' + tone;
  $('guide-do').hidden = !(hint && myTurn());
}

/** The broadcast strip: match, round progress, who is acting. */
function renderOnAir(obs) {
  if (!spectating()) return;
  $('oa-match').textContent = `第 ${matchNo} 場`;
  const round = battling || obs.round;
  $('oa-round').textContent = `第 ${round} / ${obs.maxRounds} 輪`;
  $('oa-target').textContent = `先到 ${obs.vpTarget} 分`;
  $('oa-prog').style.setProperty('--v', Math.min(1, round / obs.maxRounds));
  const lead = [...obs.players].sort((a, b) => b.vp - a.vp)[0];
  $('oa-lead').innerHTML = lead && lead.vp > 0 ? `<span class="fu-side" style="--side:${sideVar(lead.id)}"></span>領先 ${esc(lead.name)} ${lead.vp}` : '';
  $('oa-paused').hidden = !paused;
}

function cellInfo(i) {
  const obs = obsFor(viewer() || HUMAN), c = obs.map.cells[i];
  return { obs, c, b: obs.buildings.find(b => b.cell === i), u: obs.units.find(u => u.cell === i), intel: (obs.intel || []).find(x => x.cell === i) };
}

function renderCell() {
  const panel = $('cell-panel');
  if (selCell < 0 || !st) { panel.hidden = true; return; }
  const { obs, c, b, u, intel } = cellInfo(selCell);
  const owner = obs.territory[selCell];
  const ownerName = owner > 0 ? st.players[owner - 1].name : owner === -1 ? '爭奪中' : owner === null ? '未知' : '無主';
  const visible = !obs.visible || obs.visible[selCell];
  let h = `<div class="fu-panel__head"><p class="fu-label"><b>03</b> / ${c.q},${c.r}</p><span class="fu-label">${esc(ownerName)}</span><button class="fu-btn fu-btn--ghost fu-btn--icon fu-btn--sm" data-close-cell aria-label="關閉">✕</button></div>`;
  h += `<h4>${TERRAIN[c.t].name}${c.f ? ' · ' + FEATURE[c.f] : ''}</h4>`;
  const tips = [];
  if (TERRAIN[c.t].cover) tips.push('掩護 +1');
  if (TERRAIN[c.t].move > 1 && TERRAIN[c.t].pass) tips.push(`移動耗 ${TERRAIN[c.t].move}`);
  if (!TERRAIN[c.t].pass) tips.push('不可通行');
  if (!TERRAIN[c.t].build && TERRAIN[c.t].pass) tips.push('不可建築');
  if (c.f === 'relic') { const held = st.players.filter(p => p.alive && E.relicHeld(st, p.id, selCell)).map(p => p.name); tips.push(`遺跡：每輪 ${selCell === obs.map.center ? 2 : 1} 分${held.length && visible ? '，' + held.join('') + '控制中' : ''}`); }
  if (c.f === 'fertile') tips.push('農田 +2 糧');
  if (c.f === 'gold') tips.push('礦場 +3 金，相鄰 +1');
  if (tips.length) h += `<p>${tips.join(' · ')}</p>`;
  if (b) {
    const def = BUILDINGS[b.type], own = b.owner === HUMAN && mode === 'play';
    const sname = b.owner > 0 ? st.players[b.owner - 1].name : '中立';
    h += `<p style="color:var(--fu-text)"><span class="fu-side" style="--side:${sideVar(b.owner)}"></span> ${esc(sname)}的${def.name}${b.lvl > 1 ? ' Lv' + b.lvl : ''} <span class="ah-hp" style="--v:${b.hp / b.max}"><i></i></span> ${b.hp}/${b.max}${b.armor ? ' 甲' + b.armor : ''}</p>`;
    const flags = [];
    if (!b.connected) flags.push('與都城斷聯，不生產');
    if (b.hungry) flags.push('上輪缺糧停工');
    if (b.disabled) flags.push('遭破壞停工');
    if (own) {
      const inc = obs.income.buildings.find(x => x.building === b.id);
      if (inc) flags.push(`產出 ${RES.filter(r => inc[r]).map(r => '+' + inc[r] + RES_NAME[r]).join(' ') || '無'}${inc.upkeep ? ` · 工人吃 ${inc.upkeep} 糧` : ''}${inc.hungry ? ' · 下輪缺糧' : ''}`);
      const atk = E.bAttack(st, st.buildings.find(x => x.id === b.id));
      if (atk) flags.push(`射擊 ${atk.atk} 傷害、射程 ${atk.range}`);
    }
    if (flags.length) h += `<p>${flags.join(' · ')}</p>`;
    if (own) {
      const row = [];
      const next = UPGRADES[b.type] && UPGRADES[b.type][b.lvl - 1];
      if (next) {
        const err = E.upgradeError(st, HUMAN, selCell);
        row.push(`<button class="fu-btn fu-btn--sm ${err ? '' : 'fu-btn--seal'}" data-upgrade ${err || !myTurn() ? 'disabled' : ''} title="${esc(err || next.text)}">升級 · ${costText(next.cost)}：${esc(next.text)}</button>`);
        if (err) row.push(`<span class="fu-small fu-dim">${esc(err)}</span>`);
      }
      if (['capital', 'barracks', 'workshop'].includes(b.type)) {
        const opts = [null, ...Object.keys(UNITS)].filter(k => k === null || !E.trainError(st, HUMAN, st.buildings.find(x => x.id === b.id), k));
        row.push(`<label class="fu-field" style="margin:0"><span class="fu-label">每輪訓練</span><select class="fu-select" data-train ${myTurn() ? '' : 'disabled'}>${opts.map(k => `<option value="${k || ''}" ${(b.train || null) === k ? 'selected' : ''}>${k ? UNITS[k].name + ' · ' + costText(CARDS[k].cost) : '不訓練'}</option>`).join('')}</select></label>`);
      }
      if (row.length) h += `<div class="ah-cell__row">${row.join('')}</div>`;
      if (['capital', 'barracks'].includes(b.type)) h += `<p class="fu-small fu-dim">訓練在每輪結算後自動付費出兵；兵種要在牌組裡才可選（民兵永遠可選）。</p>`;
    }
  } else if (intel) {
    h += `<p>記憶：${esc(st.players[intel.owner - 1].name)}的${BUILDINGS[intel.type].name}（第 ${intel.round} 輪看到）</p>`;
  }
  if (u) {
    const d = UNITS[u.type], own = u.owner === HUMAN && mode === 'play';
    const sname = u.owner > 0 ? st.players[u.owner - 1].name : '中立';
    h += `<p style="color:var(--fu-text)"><span class="fu-side" style="--side:${sideVar(u.owner)}"></span> ${esc(sname)}的${d.name} <span class="ah-hp" style="--v:${u.hp / u.max}"><i></i></span> ${u.hp}/${u.max} · 攻 ${d.atk} 射程 ${d.range} 移動 ${d.move}${d.armor ? ' 甲' + d.armor : ''}</p>`;
    if (own) {
      h += `<p>姿態：${STANCE_NAME[u.stance]}${u.stance === 'advance' && u.goal >= 0 ? ` → ${obs.map.cells[u.goal].q},${obs.map.cells[u.goal].r}` : ''}</p>`;
      h += `<div class="ah-cell__row"><button class="fu-btn fu-btn--sm fu-btn--seal" data-order="advance" ${myTurn() ? '' : 'disabled'}>指定進攻目標</button><button class="fu-btn fu-btn--sm" data-order="guard" ${myTurn() ? '' : 'disabled'}>駐守此地</button><button class="fu-btn fu-btn--sm" data-order="hold" ${myTurn() ? '' : 'disabled'}>原地不動</button></div>`;
    }
  }
  if (!visible) h += `<p class="fu-small fu-dim">在迷霧中，看不到這裡的部隊。</p>`;
  panel.innerHTML = h; panel.hidden = false;
}

const LOG_LIMIT = 160;
function logEvent(text, side = 0) {
  const li = document.createElement('li');
  li.innerHTML = `<span class="fu-side" style="--side:${sideVar(side)}"></span><span>${text}</span>`;
  const list = $('log-list'); list.prepend(li);
  while (list.children.length > LOG_LIMIT) list.lastChild.remove();
}
function renderLog() {
  if (!st) return;
  const vis = viewer() === 0 ? null : E.visibleSet(st, HUMAN);
  const seen = i => !vis || (i !== undefined && i >= 0 && vis[i]);
  const name = id => id > 0 ? esc(st.players[id - 1].name) : '中立';
  const fresh = st.log.filter(e => !logSeen.has(e));
  for (const e of fresh) logSeen.add(e);
  for (const e of fresh) {
    const mine = e.player === HUMAN || e.owner === HUMAN;
    let t = null, side = e.player || e.owner || 0;
    switch (e.e) {
      case 'play': if (e.hidden && !mine) break; if (mine || seen(e.cell)) t = `${name(e.player)}打出${CARDS[e.card].name}`; break;
      case 'buy': t = `${name(e.player)}從市場買下${CARDS[e.card].name}`; break;
      case 'upgrade': if (mine || seen(e.cell)) t = `${name(e.player)}把${BUILDINGS[e.type].name}升到 Lv${e.lvl}`; break;
      case 'raze': if (mine || seen(e.cell) || e.type === 'capital') t = `${name(e.by)}摧毀了${name(e.owner)}的${BUILDINGS[e.type].name}`; side = e.by; break;
      case 'die': if (mine || e.by === HUMAN) t = `${name(e.owner)}的${UNITS[e.type].name}陣亡`; break;
      case 'eliminated': t = `<b>${name(e.player)}滅亡</b>`; break;
      case 'hungry': if (mine) t = `缺糧：${BUILDINGS[st.buildings.find(b => b.id === e.building)?.type || 'farm'].name}停工`; break;
      case 'starve': if (mine) t = '部隊挨餓受傷'; break;
      case 'train': if (mine) t = `訓練出${UNITS[e.type].name}`; break;
      case 'train-skip': if (mine) t = `資源不足，沒能訓練${UNITS[e.unit].name}`; break;
      case 'round': t = `第 ${e.round} 輪結算：` + (e.scoring.filter(s => s.gain).map(s => `${name(s.player)} +${s.gain}`).join('、') || '無人得分'); side = 0; break;
      case 'over': t = `<b>戰局結束：${name(e.winner)}勝（${esc(REASON_NAME[e.reason] || e.reason)}）</b>`; side = e.winner; break;
      default: break;
    }
    if (t) logEvent(`<span class="fu-dim fu-num">${e.round}</span> ${t}`, side);
  }
}

function showResult() {
  const r = st.result; if (!r) return;
  recordSeries();
  const win = st.winner === HUMAN && mode === 'play';
  const wname = st.players[st.winner - 1].name;
  $('result-seal').textContent = spectating() ? '終局' : win ? '勝' : '敗';
  $('result-reason').textContent = `${spectating() ? `第 ${matchNo} 場 · ${PROFILE_NAME[profiles[st.winner]]}打法 · ` : ''}第 ${r.round} 輪 · ${REASON_NAME[r.reason] || r.reason}`;
  $('result-title').textContent = win ? '六境歸一' : `${wname}勝出`;
  $('result-again').textContent = spectating() ? '立即下一場' : '再來一局';
  const all = st.players.map(p => ({ id: p.id, name: p.name, vp: E.totalVp(st, p.id), alive: p.alive, s: p.stats }));
  all.sort((a, b) => b.vp - a.vp);
  $('result-standings').innerHTML = all.map(p => `<li style="--side:${sideVar(p.id)}"><span class="fu-side"></span>${esc(p.name)}${p.id === HUMAN && mode === 'play' ? '（你）' : ` <small class="fu-dim">${esc(PROFILE_NAME[profiles[p.id]] || '')}</small>`}${p.alive ? '' : ' · 滅亡'}<span class="fu-small fu-dim">建 ${p.s.built} · 兵 ${p.s.recruited} · 殺 ${p.s.kills} · 毀 ${p.s.razed}</span><b>${p.vp}</b></li>`).join('');
  $('result-series').hidden = !spectating();
  if (spectating()) { renderSeries($('result-series-body')); $('result-series-count').textContent = `${series.matches} 場`; }
  emit('match-end', { winner: st.winner, name: wname, doctrine: profiles[st.winner], reason: r.reason, rounds: r.round, standings: standings(), series: series.doctrines });
  banner(`${wname}勝出`, REASON_NAME[r.reason] || '', 2400);
  setTimeout(() => { if (st && st.phase === 'over') { Fu.open('result'); scheduleNext(); } }, spectating() ? 1600 : 0);
}
function scheduleNext() {
  clearTimeout(nextTimer); nextTimer = null;
  const el = $('result-next'), stop = $('result-stop');
  const on = spectating() && pref('loop') !== false;
  el.hidden = !on; stop.hidden = !on;
  if (!on) return;
  let left = Math.max(3, +pref('intermission') || 12);
  const my = token;
  const step = () => {
    if (my !== token) return;
    if (paused) { el.textContent = '連播已暫停（空白鍵繼續）'; nextTimer = setTimeout(step, 400); return; }
    if (left <= 0) { newGame({ mode, next: true }); return; }
    el.textContent = `下一場 ${left} 秒後開始`; left--;
    nextTimer = setTimeout(step, 1000);
  };
  step();
}
$('result').addEventListener('fu:close', () => {
  if (nextTimer && st && st.phase === 'over') { clearTimeout(nextTimer); nextTimer = null; if (spectating()) Fu.toast('已停止倒數；按 N 開下一場', { tone: 'info' }); }
});
$('result-stop').addEventListener('click', () => { clearTimeout(nextTimer); nextTimer = null; $('result-next').textContent = '連播已停止'; $('result-stop').hidden = true; });

function setBusy(on, text, who = 0) {
  $('busy').hidden = !on || spectating();
  if (text) { $('busy-text').textContent = text; $('oa-phase').textContent = text; $('oa-phase').style.setProperty('--side', sideVar(who)); }
  if (!on && spectating()) $('oa-phase').textContent = st && st.phase === 'over' ? '終局' : '';
  document.body.dataset.busy = on && mode === 'play' ? '1' : '0';
  if (on) { const obs = obsFor(HUMAN); renderTop(obs); renderFactions(obs); renderGuide(obs, []); renderOnAir(obs); }
}

// ------------------------------------------------------------------ spectator controls
const director = () => spectating() && view && pref('director') !== false && performance.now() > holdDirector;
function applyDirector() {
  if (!view) return;
  view.setOrbit(spectating() && pref('director') !== false && !Fu.reducedMotion() ? .035 : 0);
  renderSpecDock();
}
function renderSpecDock() {
  $('sp-pause').setAttribute('aria-pressed', String(paused));
  $('sp-pause').firstChild.textContent = paused ? '繼續 ' : '暫停 ';
  $('sp-director').setAttribute('aria-pressed', String(pref('director') !== false));
  $('sp-loop').setAttribute('aria-pressed', String(pref('loop') !== false));
  if (st) renderOnAir(obsFor(HUMAN));
}
function togglePause() {
  if (!spectating() || !st) return;
  paused = !paused;
  if (view) view.setOrbit(paused ? 0 : (pref('director') !== false && !Fu.reducedMotion() ? .035 : 0));
  renderSpecDock();
  Fu.toast(paused ? '已暫停' : '繼續', { tone: 'info', ms: 900 });
}
function toggleFlag(name) {
  const v = !(pref(name) !== false);
  delete override[name]; store.set(name, v);
  const f = document.querySelector(`#settings-form [name="${name}"]`); if (f) f.checked = v;
  if (name === 'director') { holdDirector = 0; applyDirector(); }
  renderSpecDock(); renderStreamUrl();
  Fu.toast(`${name === 'director' ? '導播鏡頭' : '自動連播'}：${v ? '開' : '關'}`, { tone: 'info', ms: 1100 });
}
function nextMatch() { if (!spectating()) return; newGame({ mode, next: true }); }
$('sp-pause').addEventListener('click', togglePause);
$('sp-director').addEventListener('click', () => toggleFlag('director'));
$('sp-loop').addEventListener('click', () => toggleFlag('loop'));
$('sp-next').addEventListener('click', nextMatch);
$('sp-clean').addEventListener('click', () => document.body.classList.toggle('is-clean'));
$('sp-full').addEventListener('click', () => { const d = document; if (d.fullscreenElement) d.exitFullscreen?.(); else d.documentElement.requestFullscreen?.().catch(() => Fu.toast('瀏覽器不允許全螢幕', { tone: 'warn' })); });
$('sp-play').addEventListener('click', () => { store.set('mode', 'play'); delete override.mode; newGame({ mode: 'play' }); });
// stream layout: hide the controls and the cursor after a few idle seconds
{
  let idle = null;
  const wake = () => { document.body.dataset.idle = '0'; clearTimeout(idle); idle = setTimeout(() => { if (mode === 'stream') document.body.dataset.idle = '1'; }, 2800); };
  for (const ev of ['pointermove', 'pointerdown', 'keydown']) document.addEventListener(ev, wake, { passive: true });
  wake();
}
if (/^(0|false|off|clean)$/i.test(url.get('hud') || '')) document.body.classList.add('is-clean');

function streamUrl() {
  const q = new URLSearchParams({ mode: 'stream', players: pref('players'), speed: pref('speed'), rounds: pref('rounds'), doctrine: pref('doctrine'), intermission: pref('intermission') });
  if ((pref('seed') || '').trim()) q.set('seed', pref('seed').trim());
  if (pref('loop') === false) q.set('loop', '0');
  if (pref('director') === false) q.set('director', '0');
  q.set('hud', '0');
  return `${location.origin === 'null' ? '' : location.origin}${location.pathname}?${q}`;
}
function renderStreamUrl() { const el = $('stream-url'); if (el) el.textContent = streamUrl(); }
$('copy-url').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(streamUrl()); Fu.toast('已複製直播網址', { tone: 'ok' }); }
  catch (e) { Fu.toast('無法複製，請手動選取網址', { tone: 'warn' }); }
});

// ------------------------------------------------------------------ selection
function targetsOf(cardId) {
  return [...new Set(E.legalActions(st, HUMAN).filter(a => a.type === 'play' && a.card === cardId && a.target !== undefined).map(a => a.target))];
}
/** Best cells for a building card by the same income preview the tooltip shows. */
function bestCells(def, targets) {
  if (def.kind !== 'build' || targets.length < 2) return [];
  const scored = targets.map(i => { const d = E.previewBuild(st, HUMAN, def.build, i); return { i, v: (d.food || 0) + (d.mat || 0) + (d.gold || 0) * 1.1 + (d.territory || 0) * .25 + (d.cap ? .5 : 0) }; });
  const top = Math.max(...scored.map(s => s.v));
  if (!(top > 0)) return [];
  return scored.filter(s => s.v >= top - 1e-9).slice(0, 3).map(s => s.i);
}
function clearSelection() {
  sel = null; selTargets = []; purge = null; orderMode = null; hint = null;
  if (view) { view.setTargets([]); view.setBest([]); }
  $('tip').hidden = true;
  refresh();
}
function selectCard(id) {
  if (!myTurn()) { Fu.toast('等其他勢力行動完', { tone: 'info' }); return; }
  const card = st.players[HUMAN - 1].hand.find(c => c.id === id); if (!card) return;
  const def = CARDS[card.k];
  orderMode = null; hint = null; if (view) view.setBest([]);
  if (purge) {
    if (id === purge.card) {
      if (!purge.targets.length) { purge = null; refresh(); return; }
      const r = humanAct({ type: 'play', card: id, targets: purge.targets });
      if (r.ok) Fu.toast(`整編移除 ${r.events[0]?.removed ?? purge.targets.length} 張牌`, { tone: 'ok' });
      purge = null; refresh(); return;
    }
    const k = purge.targets.indexOf(id);
    if (k >= 0) purge.targets.splice(k, 1); else if (purge.targets.length < 2) purge.targets.push(id); else Fu.toast('整編最多移除 2 張', { tone: 'warn' });
    refresh(); return;
  }
  if (sel === id && def.kind !== 'tactic') { clearSelection(); return; }
  if (def.kind === 'vp') { Fu.toast(`${def.name}在牌組裡就算 ${def.vp} 分，不能打出；可以賣掉換 1 金或保留`, { tone: 'info', ms: 3200 }); return; }
  const err = E.playError(st, HUMAN, { card: id, target: -1 });
  if (err && /指令點|資源/.test(err)) { Fu.toast(`${def.name}：${err}（${costText(card && E.cardCost(st, HUMAN, card.k))}、${def.ap || 0} 點）`, { tone: 'warn' }); return; }
  if (def.kind === 'econ') {
    if (card.k === 'purge') { purge = { card: id, targets: [] }; sel = null; refresh(); return; }
    humanAct({ type: 'play', card: id }); return;
  }
  if (def.kind === 'tactic' && !def.target) {
    if (sel === id) { sel = null; humanAct({ type: 'play', card: id }); return; }
    sel = id; selTargets = []; refresh(); return;
  }
  if (sel === id) { clearSelection(); return; }
  const targets = targetsOf(id);
  if (!targets.length) { Fu.toast(`${def.name}目前沒有合法位置`, { tone: 'warn' }); return; }
  sel = id; selTargets = targets;
  if (view) { view.setTargets(targets); view.setBest(bestCells(def, targets)); }
  // a single legal recruit site needs no second click
  if (def.kind === 'unit' && targets.length === 1) { const r = humanAct({ type: 'play', card: id, target: targets[0] }); if (r.ok) { sel = null; selTargets = []; if (view) view.setTargets([]); Fu.toast(`在${BUILDINGS[st.buildings.find(b => b.cell === targets[0])?.type || 'capital'].name}徵召${def.name}`, { tone: 'ok', ms: 1400 }); } return; }
  refresh();
}

function onCellClick(i, ev) {
  if (!st) return;
  if (ev.button === 2) { if (sel !== null || orderMode || purge || hint) clearSelection(); return; }
  if (i < 0) return;
  if (orderMode && myTurn()) {
    const r = humanAct({ type: 'order', unit: orderMode.units, stance: 'advance', target: i });
    if (r.ok) { const c = st.map.terrain[i]; Fu.toast(`${orderMode.units === 'all' ? '全軍' : '部隊'}進攻 ${TERRAIN[c].name}`, { tone: 'ok' }); }
    orderMode = null; if (view) view.setTargets([]); refresh(); return;
  }
  if (sel !== null && myTurn()) {
    const card = st.players[HUMAN - 1].hand.find(c => c.id === sel), def = card && CARDS[card.k];
    if (def && (def.kind === 'build' || def.kind === 'unit' || def.target)) {
      if (selTargets.includes(i)) {
        const r = humanAct({ type: 'play', card: sel, target: i });
        if (r.ok) { sel = null; selTargets = []; if (view) { view.setTargets([]); view.setBest([]); } selCell = i; if (view) view.setSelected(i); refresh(); }
      } else {
        Fu.toast(E.playError(st, HUMAN, { card: sel, target: i }) || '這裡不行', { tone: 'warn' });
      }
      return;
    }
  }
  selCell = selCell === i ? -1 : i;
  if (view) view.setSelected(selCell);
  renderCell();
}

function onHover(i, e) {
  const tip = $('tip');
  if (!st || i < 0 || !e) { tip.hidden = true; return; }
  let html = '';
  const card = sel !== null && myTurn() ? st.players[HUMAN - 1].hand.find(c => c.id === sel) : null;
  if (card) {
    const def = CARDS[card.k];
    if (selTargets.includes(i)) {
      if (def.kind === 'build') {
        const d = E.previewBuild(st, HUMAN, def.build, i);
        const parts = RES.filter(r => d[r]).map(r => `<span class="${d[r] > 0 ? 'is-good' : 'is-bad'}">${d[r] > 0 ? '+' : ''}${d[r]}${RES_NAME[r]}</span>`);
        if (d.territory) parts.push(`<span class="is-good">+${d.territory} 地</span>`);
        if (d.cap) parts.push(`<span class="is-good">上限 +${d.cap}</span>`);
        html = `${def.name} · ${parts.join(' ') || '產量不變'}<br><span class="fu-dim">每輪淨值（含工人糧耗）· 點一下建造</span>`;
      } else html = `${def.name} → 這裡（點一下）`;
    } else if (def.kind === 'build' || def.kind === 'unit' || def.target) {
      html = `<span class="is-bad">${esc(E.playError(st, HUMAN, { card: card.id, target: i }) || '不可')}</span>`;
    }
  } else if (orderMode) {
    html = `${orderMode.units === 'all' ? '全軍' : '部隊'}進攻這裡（點一下）`;
  } else {
    const obs = obsFor(viewer() || HUMAN), c = obs.map.cells[i];
    const b = obs.buildings.find(x => x.cell === i), u = obs.units.find(x => x.cell === i);
    html = `${TERRAIN[c.t].name}${c.f ? ' · ' + FEATURE[c.f] : ''}`;
    if (b) html += ` · ${b.owner ? esc(st.players[b.owner - 1].name) : ''}${BUILDINGS[b.type].name} ${b.hp}/${b.max}`;
    if (u) html += ` · ${u.owner ? esc(st.players[u.owner - 1].name) : '中立'}${UNITS[u.type].name} ${u.hp}/${u.max}`;
  }
  if (!html) { tip.hidden = true; return; }
  const r = $('stage').getBoundingClientRect();
  tip.innerHTML = html; tip.hidden = false;
  tip.style.left = Math.min(e.clientX - r.left, r.width - 220) + 'px'; tip.style.top = (e.clientY - r.top) + 'px';
}

// ------------------------------------------------------------------ hint and auto-play
function describeAction(a) {
  const hand = st.players[HUMAN - 1].hand, c = a.card !== undefined && hand.find(x => x.id === a.card), def = c && CARDS[c.k];
  const where = i => i !== undefined && i >= 0 ? `${TERRAIN[st.map.terrain[i]].name}${st.map.feature[i] ? '·' + FEATURE[st.map.feature[i]] : ''}` : '';
  switch (a.type) {
    case 'play': return def ? (a.targets ? `打出${def.name}，移除 ${a.targets.length} 張弱牌` : a.target !== undefined ? `打出${def.name}到金框的${where(a.target)}` : `打出${def.name}（${def.text}）`) : '打一張牌';
    case 'buy': { const m = obsFor(HUMAN).market.find(x => x.slot === a.slot); return m ? `去市場買${CARDS[m.k].name}（${m.price} 金，按「照做」直接買）` : '買市場的牌'; }
    case 'upgrade': { const b = st.buildings.find(x => x.cell === a.target); return `升級金框的${b ? BUILDINGS[b.type].name : '建築'}`; }
    case 'train': return `讓${BUILDINGS[(st.buildings.find(x => x.cell === a.target) || {}).type || 'capital'].name}每輪訓練${a.unit ? UNITS[a.unit].name : '（停止）'}`;
    case 'order': return `${a.unit === 'all' ? '全軍' : '部隊'}${STANCE_NAME[a.stance]}${a.target !== undefined && a.stance === 'advance' ? '，目標金框' : ''}`;
    case 'trade': return `用${RES_NAME[a.give]}向銀行換${RES_NAME[a.get]}`;
    case 'sell': return def ? `賣掉${def.name}換 1 金` : '賣掉一張牌';
    case 'end': return '這回合可以結束了';
    default: return a.type;
  }
}
function showHint() {
  if (!myTurn()) return;
  const a = AI.decide(st, HUMAN, 'balanced') || { type: 'end' }; // read-only: decide never changes the state
  sel = null; purge = null; orderMode = null; selTargets = [];
  hint = { action: a, text: describeAction(a) };
  const cell = a.target !== undefined && typeof a.target === 'number' ? a.target : -1;
  if (view) { view.setTargets([]); view.setBest(cell >= 0 ? [cell] : []); if (cell >= 0) view.focusCell(cell); }
  refresh();
}
function doHint() {
  if (!hint || !myTurn()) return;
  const a = hint.action;
  if (a.type === 'end') { endTurn(); return; }
  const r = humanAct(a);
  if (r.ok) Fu.toast('已照提示執行', { tone: 'ok', ms: 1200 });
}
async function autoTurn() {
  if (!myTurn()) return;
  autoing = true; const my = token;
  clearSelection();
  try {
    for (let k = 0; k < 60 && my === token && st.turn === HUMAN && st.phase !== 'over'; k++) {
      const a = AI.decide(st, HUMAN, 'balanced') || { type: 'end' };
      if (a.type === 'end') break;
      const r = humanAct(a, true, true);
      if (!r.ok) break;
      await sleep(Fu.reducedMotion() ? 60 : 320);
    }
  } finally { autoing = false; }
  if (my === token && myTurn()) endTurn();
}

// ------------------------------------------------------------------ DOM wiring
$('hand').addEventListener('click', e => {
  const btn = e.target.closest('.ah-card'); if (!btn) return;
  const id = +btn.dataset.card;
  if (e.target.closest('[data-sell]')) {
    e.stopPropagation();
    const card = st.players[HUMAN - 1].hand.find(c => c.id === id);
    const r = humanAct({ type: 'sell', card: id });
    if (r.ok && card) Fu.toast(`賣掉${CARDS[card.k].name}，+1 金`, { tone: 'ok', ms: 1400 });
    if (sel === id) clearSelection();
    return;
  }
  if (e.target.closest('[data-keep]')) { e.stopPropagation(); keep = keep === id ? null : id; refresh(); return; }
  selectCard(id);
});
$('hand').addEventListener('contextmenu', e => { const btn = e.target.closest('.ah-card'); if (!btn) return; e.preventDefault(); keep = keep === +btn.dataset.card ? null : +btn.dataset.card; refresh(); });
// hovering a card previews where it could go
let preview = null;
$('hand').addEventListener('pointerover', e => {
  if (e.pointerType !== 'mouse' || sel !== null || orderMode || purge || !myTurn() || !view) return;
  const btn = e.target.closest('.ah-card'); if (!btn || +btn.dataset.card === preview) return;
  preview = +btn.dataset.card; view.setTargets(targetsOf(preview));
});
$('hand').addEventListener('pointerleave', () => { if (preview !== null && sel === null && !orderMode && view) view.setTargets([]); preview = null; });
$('market-row').addEventListener('click', e => {
  const b = e.target.closest('[data-buy]'); if (!b) return;
  const slot = +b.dataset.buy, k = st.market.row[slot] && st.market.row[slot].k;
  const r = humanAct({ type: 'buy', slot });
  if (r.ok) Fu.toast(`買下${CARDS[k].name}，放進棄牌堆`, { tone: 'ok' });
});
$('cell-panel').addEventListener('click', e => {
  if (e.target.closest('[data-close-cell]')) { selCell = -1; if (view) view.setSelected(-1); renderCell(); return; }
  if (e.target.closest('[data-upgrade]')) { const r = humanAct({ type: 'upgrade', target: selCell }); if (r.ok) Fu.toast('升級完成', { tone: 'ok' }); return; }
  const o = e.target.closest('[data-order]');
  if (o) {
    const u = st.units.find(x => x.cell === selCell && x.owner === HUMAN); if (!u) return;
    if (o.dataset.order === 'advance') { orderMode = { units: [u.id] }; if (view) view.setTargets([]); refresh(); }
    else humanAct({ type: 'order', unit: u.id, stance: o.dataset.order, target: o.dataset.order === 'guard' ? selCell : undefined });
  }
});
$('cell-panel').addEventListener('change', e => {
  const s = e.target.closest('[data-train]'); if (!s) return;
  const r = humanAct({ type: 'train', target: selCell, unit: s.value || null });
  if (r.ok) Fu.toast(s.value ? `每輪訓練${UNITS[s.value].name}` : '停止訓練', { tone: 'ok' });
});
$('factions').addEventListener('click', e => {
  const li = e.target.closest('[data-player]'); if (!li || !view) return;
  const id = +li.dataset.player, cap = st.buildings.find(b => b.type === 'capital' && b.owner === id);
  const known = cap && (id === HUMAN || viewer() === 0 || E.visibleSet(st, HUMAN)[cap.cell] || st.players[HUMAN - 1].intel[cap.cell]);
  if (known) { holdDirector = performance.now() + 9000; view.focusCell(cap.cell, view.bounds * 1.2); } else Fu.toast('還沒看過這方的都城', { tone: 'info' });
});
function armyAll() {
  if (!myTurn()) return;
  if (orderMode && orderMode.units === 'all') { orderMode = null; refresh(); return; }
  sel = null; purge = null; hint = null; orderMode = { units: 'all' };
  const obs = obsFor(HUMAN);
  const suggest = [...obs.map.relics, ...obs.buildings.filter(b => b.owner !== HUMAN && b.owner > 0).map(b => b.cell), ...(obs.intel || []).map(x => x.cell)];
  if (view) { view.setBest([]); view.setTargets([...new Set(suggest)], 0xff4b2b); }
  refresh();
}
$('btn-army').addEventListener('click', armyAll);
$('btn-guard').addEventListener('click', () => { const r = humanAct({ type: 'order', unit: 'all', stance: 'guard' }); if (r.ok) Fu.toast('全軍回到所在地駐守', { tone: 'ok' }); });
$('btn-hint').addEventListener('click', showHint);
$('btn-auto').addEventListener('click', autoTurn);
$('guide-do').addEventListener('click', doHint);
function endTurn() {
  if (!myTurn()) return;
  const obs = obsFor(HUMAN);
  const playable = E.legalActions(st, HUMAN).some(a => a.type === 'play');
  const a = keep !== null ? { type: 'end', keep } : { type: 'end' };
  humanAct(a);
  if (playable && obs.ap > 0) Fu.toast(`回合結束（還剩 ${obs.ap} 點沒用）`, { tone: 'info', ms: 1600 });
}
$('btn-end').addEventListener('click', endTurn);
$('trade-open').addEventListener('click', () => { const t = $('trade'); t.hidden = !t.hidden; $('trade-open').setAttribute('aria-expanded', String(!t.hidden)); });
const segValue = id => ($(id).querySelector('[aria-pressed="true"]') || {}).value;
$('trade-do').addEventListener('click', () => {
  const give = segValue('trade-give'), get = segValue('trade-get');
  if (give === get) { Fu.toast('選兩種不同的資源', { tone: 'warn' }); return; }
  const r = humanAct({ type: 'trade', give, get });
  if (r.ok) Fu.toast(`付 ${r.events[0].rate} ${RES_NAME[give]} 換 1 ${RES_NAME[get]}`, { tone: 'ok', ms: 1400 });
});
const start = m => { delete override.mode; store.set('mode', m); newGame({ mode: m }); };
$('new-game').addEventListener('click', () => newGame());
$('intro-play').addEventListener('click', () => start('play'));
$('intro-watch').addEventListener('click', () => start('watch'));
$('intro-stream').addEventListener('click', () => start('stream'));
$('result-again').addEventListener('click', () => newGame({ mode, next: spectating() }));
function introLabels() {
  const n = +pref('players') || 4;
  $('intro-play').textContent = `親征 · 你 + ${n - 1} AI`;
  $('intro-watch').textContent = `觀戰 · ${n} AI`;
}
introLabels();
document.querySelector('#settings-form .fu-seg[data-name="players"]').addEventListener('fu:select', introLabels);
document.addEventListener('fu:open', e => { if (e.target && e.target.id === 'settings') { renderStreamUrl(); renderSeries($('series-body')); } });

// ------------------------------------------------------------------ hotkeys
Fu.hotkey('e', '結束回合', endTurn, { when: myTurn });
Fu.hotkey('i', '提示：AI 建議一步', showHint, { when: myTurn });
Fu.hotkey('enter', '照提示做', doHint, { when: () => !!hint && myTurn(), hidden: true });
Fu.hotkey('m', '市場', () => Fu.toggle('market'), { when: () => !spectating() });
Fu.hotkey('a', '全軍出擊（再點目標）', armyAll, { when: myTurn });
Fu.hotkey('g', '全軍回防', () => humanAct({ type: 'order', unit: 'all', stance: 'guard' }), { when: myTurn });
Fu.hotkey('d', '牌組', () => Fu.toggle('deck'), { when: () => !spectating() });
Fu.hotkey(' ', '觀戰：暫停／繼續', togglePause, { when: spectating });
Fu.hotkey('n', '觀戰：下一場', nextMatch, { when: spectating });
Fu.hotkey('c', '觀戰：導播鏡頭', () => toggleFlag('director'), { when: spectating });
Fu.hotkey('o', '觀戰：隱藏／顯示控制列', () => document.body.classList.toggle('is-clean'), { when: spectating });
Fu.hotkey('l', '戰報', () => Fu.toggle('log'));
Fu.hotkey('s', '設定', () => Fu.toggle('settings'));
Fu.hotkey('?', '規則與操作', () => Fu.toggle('rules'));
Fu.hotkey('t', '交易', () => $('trade-open').click(), { when: myTurn });
Fu.hotkey('h', '回到都城', () => { const cap = st && st.buildings.find(b => b.type === 'capital' && b.owner === HUMAN); if (cap && view) view.focusCell(cap.cell, view.bounds * 1.2); });
Fu.hotkey('f', '看全圖', () => view && view.fit());
Fu.hotkey('q', '向左旋轉', () => view && view.rotate(Math.PI / 6));
Fu.hotkey('r', '向右旋轉', () => view && view.rotate(-Math.PI / 6));
Fu.hotkey('1', '選第 1–9 張手牌', () => pickHand(0), { when: myTurn });
for (let k = 2; k <= 9; k++) Fu.hotkey(String(k), '', () => pickHand(k - 1), { when: myTurn, hidden: true });
for (const [key, dx, dz] of [['arrowleft', -3, 0], ['arrowright', 3, 0], ['arrowup', 0, 3], ['arrowdown', 0, -3]]) Fu.hotkey(key, '', () => { holdDirector = performance.now() + 9000; if (view) view.panWorld(dx, dz); }, { hidden: true });
Fu.hotkey('+', '', () => view && view.zoom(.85), { hidden: true });
Fu.hotkey('=', '', () => view && view.zoom(.85), { hidden: true });
Fu.hotkey('-', '', () => view && view.zoom(1.18), { hidden: true });
function pickHand(k) { const c = st && st.players[HUMAN - 1].hand[k]; if (c) selectCard(c.id); }
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !e.defaultPrevented && (sel !== null || purge || orderMode || hint)) { e.preventDefault(); clearSelection(); }
});
$('hotkeys').innerHTML = Fu.hotkeyList().map(h => `<span class="fu-kbd">${esc(h.key === ' ' ? '空白' : h.key === '?' ? '?' : h.key.toUpperCase())}</span><span>${esc(h.label)}</span>`).join('') +
  '<span class="fu-kbd">Enter</span><span>照提示做</span><span class="fu-kbd">←↑→↓</span><span>平移鏡頭</span><span class="fu-kbd">+ −</span><span>縮放</span><span class="fu-kbd">Esc</span><span>取消選取／關閉面板</span><span class="fu-kbd">右鍵</span><span>手牌：保留；地圖：取消</span>';

// ------------------------------------------------------------------ agent bridge
/* A browser agent can drive seat 1 through window.HexBattle, with the same
   observation and actions as the Node CLI and arena. Stream tooling can use
   pause/resume/next/series and subscribe with on(). */
const bridge = Object.freeze({
  engine: E,
  get state() { return st; },
  get mode() { return mode; },
  observe: () => st && E.observe(st, HUMAN),
  legal: () => st ? E.legalActions(st, HUMAN) : [],
  describe: () => st ? T.describe(E.observe(st, HUMAN)) : '',
  act: action => { const r = humanAct(action, true); return { ok: r.ok, error: r.error, events: r.events }; },
  myTurn: () => !!myTurn(),
  newGame: (opts = {}) => { if (opts.seed !== undefined) store.set('seed', String(opts.seed)); if (opts.players) store.set('players', String(opts.players)); for (const k of ['seed', 'players']) if (opts[k] !== undefined) delete override[k]; newGame({ mode: opts.mode || 'play', players: opts.players }); },
  replay: () => ({ seed: st && st.seed, players: st && st.players.length, maxRounds: st && st.rules.maxRounds, neutrals: st && st.rules.neutrals, actions: actionLog.slice() }),
  pause: () => { if (!paused) togglePause(); },
  resume: () => { if (paused) togglePause(); },
  next: () => nextMatch(),
  standings: () => st ? standings() : [],
  series: () => JSON.parse(JSON.stringify(loadSeries())),
  on: fn => { const h = e => fn(e.detail); window.addEventListener('hexbattle', h); return () => window.removeEventListener('hexbattle', h); }
});
window.HexBattle = bridge;
window.AutoHex3D = bridge; // the page's former name; kept for existing agents

// first paint: draw a preview battlefield behind the intro curtain
if (view) {
  const preview = E.createGame({ seed: 'intro-' + new Date().toISOString().slice(0, 10), players: +pref('players') || 4 });
  const pobs = E.observe(preview, 0);
  view.setMap(pobs.map); view.update(pobs, { omniscient: true, borders: true, bars: false }); view.fit(); view.rotate(.3);
  view.setOrbit(.12);
}
renderSpecDock(); renderStreamUrl();
if (override.mode) newGame({ mode: override.mode }); // a mode in the URL skips the intro (OBS browser source)
else Fu.open('intro');
