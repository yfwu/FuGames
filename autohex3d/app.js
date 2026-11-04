/* AutoHex 3D page controller (ES module). Wires the headless engine
   (window.AutoHexEngine), the bots (window.AutoHexAI) and the three.js view
   to the 朱墨 shell. The human always sits in seat 1 (朱). Everything the page
   shows for that seat comes from E.observe(state, 1), so the page sees exactly
   what an agent would. */
import { createView } from './view3d.js';

const E = window.AutoHexEngine, AI = window.AutoHexAI, T = window.AutoHexText, Fu = window.Fu;
const $ = id => document.getElementById(id);
const HUMAN = 1;
const STEP = { slow: .7, normal: .42, fast: .2, skip: 0 };
const RES = ['food', 'mat', 'gold'];
const RES_NAME = { food: '糧', mat: '材', gold: '金' };
const KIND_NAME = { build: '建築', unit: '兵種', tactic: '戰術', econ: '經濟', vp: '功勳' };
const STANCE_NAME = { advance: '進攻', guard: '駐守', hold: '原地' };
const PROFILE_NAME = { balanced: '均衡', builder: '經營', warlord: '征伐', warden: '堅守', raider: '劫掠' };
const CARDS = E.CARDS, BUILDINGS = E.BUILDINGS, UNITS = E.UNITS, UPGRADES = E.UPGRADES, TERRAIN = E.TERRAIN, FEATURE = E.FEATURE;
const sideVar = id => id > 0 ? `var(--fu-side-${(id - 1) % 6 + 1})` : 'var(--fu-bone)';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const costText = cost => RES.filter(r => cost && cost[r]).map(r => cost[r] + RES_NAME[r]).join(' ') || '免費';

// ------------------------------------------------------------------ prefs
const store = Fu.prefs('autohex3d', { mode: 'play', players: '4', speed: 'normal', seed: '', rounds: '30', doctrine: 'mixed', neutrals: true, borders: true, bars: true, omniscient: true });
const settings = Fu.bindSettings('settings-form', store, (name) => { if (['borders', 'bars', 'omniscient'].includes(name)) refresh(); });
for (const seg of document.querySelectorAll('#settings-form .fu-seg[data-name]')) {
  const name = seg.dataset.name, v = String(store.get(name));
  seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.value === v)));
  seg.addEventListener('fu:select', e => { store.set(name, e.detail.value); settings[name] = e.detail.value; });
}
const pref = k => store.get(k);

// ------------------------------------------------------------------ state
let st = null, mode = 'play', profiles = {}, token = 0, running = false;
let sel = null;              // selected hand card id
let selTargets = [];         // legal target cells of the selected card
let purge = null;            // { card, targets: [] } while choosing cards to remove
let keep = null;             // card id kept at end of turn
let selCell = -1;            // inspected cell
let orderMode = null;        // { units: 'all' | [ids] } waiting for a target cell
let lastHand = new Set(), logSeen = new WeakSet();
const actionLog = [];

// ------------------------------------------------------------------ view
let view = null;
try {
  view = createView($('stage'), {
    hover: onHover,
    click: onCellClick,
    floater: (x, y, text, cls) => floater(x, y, text, cls)
  });
} catch (err) {
  console.error(err);
  $('fallback').hidden = false;
}
function floater(x, y, text, cls = '') {
  const el = document.createElement('span');
  el.className = 'ah-float ' + cls; el.textContent = text;
  el.style.left = x + 'px'; el.style.top = y + 'px';
  $('floaters').appendChild(el);
  setTimeout(() => el.remove(), 950);
}

// ------------------------------------------------------------------ game flow
function randomSeed() { const w = ['朱', '墨', '玉', '金', '霜', '嵐', '岩', '濤', '沙', '松']; let s = ''; for (let k = 0; k < 2; k++) s += w[Math.floor(Math.random() * w.length)]; return s + '-' + Math.floor(Math.random() * 9000 + 1000); }
const isHuman = id => mode === 'play' && id === HUMAN;
const myTurn = () => st && st.phase !== 'over' && isHuman(st.turn) && !running;

function newGame(over = {}) {
  token++; running = false;
  mode = over.mode || pref('mode');
  const players = +(over.players || pref('players')) || 4;
  const seed = (pref('seed') || '').trim() || randomSeed();
  st = E.createGame({ seed, players, maxRounds: +pref('rounds') || 30, neutrals: pref('neutrals') !== false });
  actionLog.length = 0;
  const doctrine = pref('doctrine');
  profiles = {};
  for (const p of st.players) {
    const k = mode === 'play' ? p.id - 2 : p.id - 1;
    profiles[p.id] = doctrine === 'mixed' || !AI.PROFILES[doctrine] ? AI.PROFILE_ORDER[((k % AI.PROFILE_ORDER.length) + AI.PROFILE_ORDER.length) % AI.PROFILE_ORDER.length] : doctrine;
  }
  sel = null; selTargets = []; purge = null; keep = null; selCell = -1; orderMode = null; lastHand = new Set(); logSeen = new WeakSet();
  $('log-list').innerHTML = '';
  document.body.dataset.phase = mode === 'watch' ? 'watch' : 'play';
  if (view) {
    view.reset();
    const obs = E.observe(st, HUMAN);
    view.setMap(obs.map);
    const cap = st.buildings.find(b => b.type === 'capital' && b.owner === HUMAN);
    view.fit();
    if (cap) { view.faceSeat(cap.cell); if (mode === 'play') view.focusCell(cap.cell, view.bounds * 1.35); }
    view.setTargets([]); view.setSelected(-1);
  }
  Fu.close('intro'); Fu.close('result'); Fu.close('settings');
  refresh();
  logEvent(`新戰局 · 種子「${seed}」· ${players} 方 · 目標 ${st.rules.vpTarget} 分`);
  if (mode === 'play') {
    const order = st.order.map(id => st.players[id - 1].name).join(' → ');
    Fu.toast(`第 1 輪 · 順序 ${order}`, { tone: 'info' });
  }
  advance();
}

function viewer() { return mode === 'watch' && pref('omniscient') !== false ? 0 : HUMAN; }
function obsFor(id) { return E.observe(st, id); }

/** Run bot turns until it is the human's turn or the game ends. */
async function advance() {
  if (running || !st) return;
  running = true; const my = token;
  try {
    while (st.phase !== 'over' && !isHuman(st.turn)) {
      const id = st.turn, p = st.players[id - 1];
      setBusy(true, `${p.name}（${PROFILE_NAME[profiles[id]] || ''}）行動中`);
      await botTurn(id, my);
      if (my !== token) return;
      if (mode === 'watch') await sleep(STEP[pref('speed')] ? 220 : 30);
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
  const prof = profiles[id];
  for (let k = 0; k < 60; k++) {
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
  }
  const pre = st.round, preVis = E.visibleSet(st, HUMAN);
  E.act(st, id, { type: 'end' }); actionLog.push({ player: id, action: { type: 'end' } });
  if (st.round !== pre || st.phase === 'over') await playBattle(pre, preVis, my);
}

/** Animate the battle of round `round`, filtered to what seat 1 could see. */
async function playBattle(round, preVis, my = token) {
  const battle = st.battle;
  if (!battle || battle.round !== round) { refresh(); return; }
  const omni = viewer() === 0, postVis = E.visibleSet(st, HUMAN);
  const seen = i => i !== undefined && (preVis[i] || postVis[i]);
  const frames = omni ? battle.frames : battle.frames.map(f => f.filter(e => seen(e.from) || seen(e.to) || seen(e.cell)));
  const step = Fu.reducedMotion() ? 0 : STEP[pref('speed')] ?? .42;
  setBusy(true, `第 ${round} 輪 · 交戰`);
  if (view && frames.some(f => f.length) && step > 0) await view.playFrames(frames.filter(f => f.length), { step });
  if (my !== token) return;
  // round scoring
  for (const s of battle.scoring) for (const part of s.parts) if (view && (omni || seen(part.cell))) {
    const p = view.project(part.cell); if (p) floater(p.x, p.y - 30, `+${part.vp} ${st.players[s.player - 1].name}`, 'is-gold');
  }
  refresh();
  summariseRound(round);
  if (step > 0) await sleep(Math.min(900, step * 1600));
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

function humanAct(action, quiet = false) {
  if (!myTurn()) return { ok: false, error: '現在不是你的回合' };
  const pre = st.round, preVis = E.visibleSet(st, HUMAN);
  const r = E.act(st, HUMAN, action);
  if (!r.ok) { if (!quiet) Fu.toast(r.error, { tone: 'warn' }); return r; }
  actionLog.push({ player: HUMAN, action });
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
  if (e.e === 'play' && e.cell >= 0) {
    const p = view.project(e.cell);
    if (p) floater(p.x, p.y - 20, CARDS[e.card].name, CARDS[e.card].kind === 'tactic' ? 'is-gold' : 'is-good');
  }
  if (e.e === 'play' && CARDS[e.card].kind === 'econ') Fu.toast(`${CARDS[e.card].name}：${CARDS[e.card].text}`, { tone: 'ok', ms: 1400 });
  if (e.e === 'upgrade') { const p = view.project(e.cell); if (p) floater(p.x, p.y - 20, `升級 Lv${e.lvl}`, 'is-gold'); }
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
  renderTop(obs); renderRes(obs); renderFactions(obs); renderHand(obs); renderMarket(obs); renderDeck(obs); renderCell(); renderLog();
  document.body.dataset.busy = running && mode === 'play' ? '1' : '0';
}

function renderTop(obs) {
  const chip = $('turn-chip');
  if (obs.phase === 'over') { chip.hidden = false; chip.textContent = '戰局結束'; }
  else if (mode === 'play') { chip.hidden = !myTurn(); chip.textContent = '你的回合'; }
  else { chip.hidden = false; chip.textContent = '觀戰中'; }
  $('phase-label').textContent = mode === 'watch' ? `觀戰 · 第 ${obs.round} / ${obs.maxRounds} 輪` : `第 ${obs.round} / ${obs.maxRounds} 輪 · ${myTurn() ? '布局中' : '等待'}`;
  $('round-label').textContent = `第 ${obs.round} 輪`;
  $('target-label').textContent = `目標 ${obs.vpTarget}`;
  const btnEnd = $('btn-end'); btnEnd.disabled = !myTurn();
  $('btn-army').disabled = !myTurn() || !obs.units.some(u => u.owner === HUMAN);
  $('btn-guard').disabled = $('btn-army').disabled;
  $('btn-army').setAttribute('aria-pressed', String(!!orderMode && orderMode.units === 'all'));
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
  $('factions').innerHTML = obs.players.map(p => {
    const turn = obs.phase !== 'over' && obs.turn === p.id;
    const tag = mode === 'play' ? (p.id === HUMAN ? '你' : PROFILE_NAME[profiles[p.id]]) : PROFILE_NAME[profiles[p.id]];
    const order = obs.order.indexOf(p.id) + 1;
    return `<li class="${turn ? 'is-turn' : ''} ${p.alive ? '' : 'is-out'}" style="--side:${sideVar(p.id)}" data-player="${p.id}" title="${esc(p.name)} · ${tag} · 本輪第 ${order} 順位">
      <span class="fu-side"></span>
      <span class="ah-f__name">${esc(p.name)} <small class="fu-dim">${esc(tag || '')}</small><span class="ah-vpbar"><i style="--v:${Math.min(1, p.vp / max)}"></i></span></span>
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

function renderHand(obs) {
  const hand = $('hand');
  if (!obs.hand || mode === 'watch') { hand.innerHTML = ''; return; }
  const legal = new Set(myTurn() ? E.legalActions(st, HUMAN).filter(a => a.type === 'play').map(a => a.card) : []);
  if (keep !== null && !obs.hand.some(c => c.id === keep)) keep = null;
  if (sel !== null && !obs.hand.some(c => c.id === sel)) { sel = null; selTargets = []; }
  if (purge && !obs.hand.some(c => c.id === purge.card)) purge = null;
  let n = 0;
  hand.innerHTML = obs.hand.map(c => {
    const def = CARDS[c.k], dead = !legal.has(c.id) && !(c.k === 'purge' && obs.hand.length > 1 && myTurn());
    const isNew = !lastHand.has(c.id);
    const pressed = sel === c.id || (purge && purge.card === c.id);
    const marked = purge && purge.targets.includes(c.id);
    const title = `${def.name}（${KIND_NAME[def.kind]}）：${def.text}`;
    return `<button class="ah-card ${dead ? 'is-dead' : ''} ${isNew ? 'is-new' : ''} ${keep === c.id ? 'is-kept' : ''}" style="--i:${isNew ? n++ : 0}${marked ? ';border-color:var(--fu-seal);opacity:.6' : ''}" data-kind="${def.kind}" data-card="${c.id}" aria-pressed="${pressed}" title="${esc(title)}">
      ${cardHTML(c.k, { cost: c.cost, res: obs.res })}
      <span class="ah-card__acts"><span data-sell title="變賣換 1 金">賣</span><span data-keep title="回合結束時保留">留</span></span>
      ${marked ? '<span class="ah-card__kind" style="position:absolute;bottom:30px;left:8px;color:var(--fu-seal)">移除</span>' : ''}</button>`;
  }).join('');
  lastHand = new Set(obs.hand.map(c => c.id));
}

function renderMarket(obs) {
  if (!obs.market) return;
  const gold = obs.res ? obs.res.gold : 0;
  $('market-gold').textContent = gold; $('market-deck').textContent = obs.marketDeck;
  $('btn-market').innerHTML = `市場 <span class="fu-num">${obs.market.length}</span> <span class="fu-kbd fu-hide-sm">M</span>`;
  $('market-row').innerHTML = obs.market.map((m, k) => {
    const can = myTurn() && gold >= m.price;
    return `<div class="ah-card ${k === 0 ? 'is-leaving' : ''}" data-kind="${CARDS[m.k].kind}">${cardHTML(m.k)}<button class="fu-btn fu-btn--sm ${can ? 'fu-btn--seal' : ''}" data-buy="${m.slot}" ${can ? '' : 'disabled'}>買 · ${m.price} 金</button></div>`;
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
  let h = `<div class="fu-panel__head"><p class="fu-label"><b>03</b> / ${c.q},${c.r}</p><span class="fu-label">${esc(ownerName)}</span></div>`;
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
      case 'over': t = `<b>戰局結束：${name(e.winner)}勝（${esc(e.reason)}）</b>`; side = e.winner; break;
      default: break;
    }
    if (t) logEvent(`<span class="fu-dim fu-num">${e.round}</span> ${t}`, side);
  }
}

function showResult() {
  const r = st.result; if (!r) return;
  const win = st.winner === HUMAN && mode === 'play';
  $('result-seal').textContent = mode === 'watch' ? '終局' : win ? '勝' : '敗';
  $('result-reason').textContent = `第 ${r.round} 輪 · ${({ 'victory points': '達到目標分數', 'round limit': '回合上限', conquest: '征服' })[r.reason] || r.reason}`;
  $('result-title').textContent = mode === 'watch' ? `${st.players[st.winner - 1].name}勝出` : win ? '六境歸一' : `${st.players[st.winner - 1].name}勝出`;
  const all = st.players.map(p => ({ id: p.id, name: p.name, vp: E.totalVp(st, p.id), alive: p.alive, s: p.stats }));
  all.sort((a, b) => b.vp - a.vp);
  $('result-standings').innerHTML = all.map(p => `<li style="--side:${sideVar(p.id)}"><span class="fu-side"></span>${esc(p.name)}${p.id === HUMAN && mode === 'play' ? '（你）' : ''}${p.alive ? '' : ' · 滅亡'}<span class="fu-small fu-dim">建 ${p.s.built} · 兵 ${p.s.recruited} · 殺 ${p.s.kills} · 毀 ${p.s.razed}</span><b>${p.vp}</b></li>`).join('');
  Fu.open('result');
}

function setBusy(on, text) {
  $('busy').hidden = !on || mode === 'watch' && !text;
  if (text) $('busy-text').textContent = text;
  document.body.dataset.busy = on && mode === 'play' ? '1' : '0';
  if (on) renderTop(obsFor(HUMAN));
}

// ------------------------------------------------------------------ selection
function targetsOf(cardId) {
  return [...new Set(E.legalActions(st, HUMAN).filter(a => a.type === 'play' && a.card === cardId && a.target !== undefined).map(a => a.target))];
}
function clearSelection() {
  sel = null; selTargets = []; purge = null; orderMode = null;
  if (view) view.setTargets([]);
  $('tip').hidden = true;
  refresh();
}
function selectCard(id) {
  if (!myTurn()) { Fu.toast('等其他勢力行動完', { tone: 'info' }); return; }
  const card = st.players[HUMAN - 1].hand.find(c => c.id === id); if (!card) return;
  const def = CARDS[card.k];
  orderMode = null;
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
    if (card.k === 'purge') { purge = { card: id, targets: [] }; sel = null; Fu.toast('點選至多 2 張要永久移除的手牌，再點一次整編確認', { tone: 'info', ms: 3400 }); refresh(); return; }
    humanAct({ type: 'play', card: id }); return;
  }
  if (def.kind === 'tactic' && !def.target) {
    if (sel === id) { sel = null; humanAct({ type: 'play', card: id }); return; }
    sel = id; selTargets = []; refresh(); Fu.toast(`再點一次打出${def.name}：${def.text}`, { tone: 'info' }); return;
  }
  if (sel === id) { clearSelection(); return; }
  const targets = targetsOf(id);
  if (!targets.length) { Fu.toast(`${def.name}目前沒有合法位置`, { tone: 'warn' }); return; }
  sel = id; selTargets = targets;
  if (view) view.setTargets(targets);
  refresh();
  Fu.toast(def.kind === 'build' ? `${def.name}：點藍框格子建造（${targets.length} 處可建）` : def.kind === 'unit' ? `${def.name}：點都城、兵營或工坊徵召` : `${def.name}：點藍框目標`, { tone: 'info', ms: 2000 });
}

function onCellClick(i, ev) {
  if (!st) return;
  if (ev.button === 2) { if (sel !== null || orderMode || purge) clearSelection(); return; }
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
        if (r.ok) { sel = null; selTargets = []; if (view) view.setTargets([]); selCell = i; if (view) view.setSelected(i); refresh(); }
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
        html = `${def.name} · ${parts.join(' ') || '產量不變'}<br><span class="fu-dim">每輪淨值（含工人糧耗）</span>`;
      } else html = `${def.name} → 這裡`;
    } else if (def.kind === 'build' || def.kind === 'unit' || def.target) {
      html = `<span class="is-bad">${esc(E.playError(st, HUMAN, { card: card.id, target: i }) || '不可')}</span>`;
    }
  } else if (orderMode) {
    html = `${orderMode.units === 'all' ? '全軍' : '部隊'}進攻這裡`;
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
$('market-row').addEventListener('click', e => {
  const b = e.target.closest('[data-buy]'); if (!b) return;
  const slot = +b.dataset.buy, k = st.market.row[slot] && st.market.row[slot].k;
  const r = humanAct({ type: 'buy', slot });
  if (r.ok) Fu.toast(`買下${CARDS[k].name}，放進棄牌堆`, { tone: 'ok' });
});
$('cell-panel').addEventListener('click', e => {
  if (e.target.closest('[data-upgrade]')) { const r = humanAct({ type: 'upgrade', target: selCell }); if (r.ok) Fu.toast('升級完成', { tone: 'ok' }); return; }
  const o = e.target.closest('[data-order]');
  if (o) {
    const u = st.units.find(x => x.cell === selCell && x.owner === HUMAN); if (!u) return;
    if (o.dataset.order === 'advance') { orderMode = { units: [u.id] }; if (view) view.setTargets([]); Fu.toast('點目標格下令進攻（右鍵取消）', { tone: 'info' }); refresh(); }
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
  if (known) view.focusCell(cap.cell, view.bounds * 1.2); else Fu.toast('還沒看過這方的都城', { tone: 'info' });
});
function armyAll() {
  if (!myTurn()) return;
  if (orderMode && orderMode.units === 'all') { orderMode = null; refresh(); return; }
  sel = null; purge = null; orderMode = { units: 'all' };
  const obs = obsFor(HUMAN);
  const suggest = [...obs.map.relics, ...obs.buildings.filter(b => b.owner !== HUMAN && b.owner > 0).map(b => b.cell), ...(obs.intel || []).map(x => x.cell)];
  if (view) view.setTargets([...new Set(suggest)], 0xff4b2b);
  refresh();
  Fu.toast('點任一格作為全軍進攻目標（紅框是遺跡與已知敵方建築；右鍵取消）', { tone: 'info', ms: 3000 });
}
$('btn-army').addEventListener('click', armyAll);
$('btn-guard').addEventListener('click', () => { const r = humanAct({ type: 'order', unit: 'all', stance: 'guard' }); if (r.ok) Fu.toast('全軍回到所在地駐守', { tone: 'ok' }); });
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
$('new-game').addEventListener('click', () => newGame());
$('intro-play').addEventListener('click', () => { store.set('mode', 'play'); newGame({ mode: 'play' }); });
$('intro-watch').addEventListener('click', () => { store.set('mode', 'watch'); newGame({ mode: 'watch' }); });
$('result-again').addEventListener('click', () => newGame({ mode }));
{
  const n = +pref('players') || 4;
  $('intro-play').textContent = `親征 · 你 + ${n - 1} AI`;
  $('intro-watch').textContent = `觀戰 · ${n} AI`;
}

// ------------------------------------------------------------------ hotkeys
Fu.hotkey('e', '結束回合', endTurn, { when: myTurn });
Fu.hotkey('m', '市場', () => Fu.toggle('market'));
Fu.hotkey('a', '全軍出擊（再點目標）', armyAll, { when: myTurn });
Fu.hotkey('g', '全軍回防', () => humanAct({ type: 'order', unit: 'all', stance: 'guard' }), { when: myTurn });
Fu.hotkey('d', '牌組', () => Fu.toggle('deck'));
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
for (const [key, dx, dz] of [['arrowleft', -3, 0], ['arrowright', 3, 0], ['arrowup', 0, 3], ['arrowdown', 0, -3]]) Fu.hotkey(key, '', () => view && view.panWorld(dx, dz), { hidden: true });
Fu.hotkey('+', '', () => view && view.zoom(.85), { hidden: true });
Fu.hotkey('=', '', () => view && view.zoom(.85), { hidden: true });
Fu.hotkey('-', '', () => view && view.zoom(1.18), { hidden: true });
function pickHand(k) { const c = st && st.players[HUMAN - 1].hand[k]; if (c) selectCard(c.id); }
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !e.defaultPrevented && (sel !== null || purge || orderMode)) { e.preventDefault(); clearSelection(); }
});
$('hotkeys').innerHTML = Fu.hotkeyList().map(h => `<span class="fu-kbd">${esc(h.key === '?' ? '?' : h.key.toUpperCase())}</span><span>${esc(h.label)}</span>`).join('') +
  '<span class="fu-kbd">←↑→↓</span><span>平移鏡頭</span><span class="fu-kbd">+ −</span><span>縮放</span><span class="fu-kbd">Esc</span><span>取消選取／關閉面板</span><span class="fu-kbd">右鍵</span><span>手牌：保留；地圖：取消</span>';

// ------------------------------------------------------------------ agent bridge
/* A browser agent can drive seat 1 through window.AutoHex3D, with the same
   observation and actions as the Node CLI and arena. */
window.AutoHex3D = Object.freeze({
  engine: E,
  get state() { return st; },
  observe: () => st && E.observe(st, HUMAN),
  legal: () => st ? E.legalActions(st, HUMAN) : [],
  describe: () => st ? T.describe(E.observe(st, HUMAN)) : '',
  act: action => { const r = humanAct(action, true); return { ok: r.ok, error: r.error, events: r.events }; },
  myTurn: () => !!myTurn(),
  newGame: (opts = {}) => { if (opts.seed !== undefined) store.set('seed', String(opts.seed)); if (opts.players) store.set('players', String(opts.players)); newGame({ mode: opts.mode || 'play', players: opts.players }); },
  replay: () => ({ seed: st && st.seed, players: st && st.players.length, maxRounds: st && st.rules.maxRounds, neutrals: st && st.rules.neutrals, actions: actionLog.slice() })
});

// first paint: draw a preview battlefield behind the intro curtain
if (view) {
  const preview = E.createGame({ seed: 'intro-' + new Date().toISOString().slice(0, 10), players: +pref('players') || 4 });
  const pobs = E.observe(preview, 0);
  view.setMap(pobs.map); view.update(pobs, { omniscient: true, borders: true, bars: false }); view.fit(); view.rotate(.3);
  let spin = setInterval(() => { if (st || !view) { clearInterval(spin); return; } view.rotate(.004); }, 33);
}
Fu.open('intro');
