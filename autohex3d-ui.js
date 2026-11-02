/* AutoHex-3D presentation and command loop. Every rule, legality check, cost
   and AI decision comes from the shared HexCore instance (window.AutoHex). */
(() => {
  'use strict';
  const E = window.AutoHex, V = window.AutoHexVisuals, L = window.AutoHex3DLogic, R3 = window.AutoHex3DRender;
  if (!window.AutoHex3DScene) { document.getElementById('status').textContent = '戰場載入失敗，請重新整理此頁。'; return; }
  const $ = id => document.getElementById(id);
  if (!E || !V || !L || !R3) { $('status').textContent = '戰場載入失敗，請重新整理此頁。'; return; }

  // ---------- constants ----------
  const COLORS = ['#7a8592', '#267477', '#a65e46', '#84618c', '#4d739e', '#668047', '#ad7b23'];
  const NAMES = ['中立', '青綠', '珊瑚', '紫藤', '藍灰', '草綠', '琥珀'];
  const LETTER = p => String.fromCharCode(64 + p);
  const localName = p => p ? `${LETTER(p)} ${NAMES[p]}` : '中立';
  const LABELS = { arsenal: '兵工廠', flak: '防空砲', workshop: '補給工坊', breach: '破陣令', deploy: '鋪子／攻占', engineer: '工程', tunnel: '地道', withdraw: '撤回', rest: '休整', turret: '炮台', destroy: '拆除', bridge: '橋梁', reroute: '改接', shield: '護盾', exchange: '換位', discard: '棄牌', offer: '提議停戰', accept: '接受停戰', reject: '拒絕停戰', betray: '背盟', airdrop: '空投炮台', bombard: '航空轟炸' };
  const MARKS = { reroute: '↗', exchange: '⇄', breach: '⚑' };
  const ICONS = { turret: 'turret', destroy: 'remove', bridge: 'bridge', shield: 'shield' };
  const cardMark = type => { if (!ICONS[type]) return node('span', 'mark', MARKS[type] || '•'); const span = node('span', 'mark'); span.innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true"><use href="icons.svg#${ICONS[type]}"></use></svg>`; return span; };
  const CARD_TEXT = { turret: '射程 3，每 3 次己方回合開火；每發 2 存糧。', destroy: '移除 5 格內敵子；附近己子付 2 存糧。', bridge: '連接相距 2–3 直線格的兩枚己子，傳遞補給。', reroute: '改接既有橋梁的一端。', shield: '防守 +2，吸收一次拆除或炮擊。', exchange: '與相鄰空格或敵方普通棋子換位。', breach: '公開儲備：預告突破格，下次攻占忽略鄰援。' };
  const HINTS = { arsenal: '選連通家園、3 格內沒有敵子的後方棋子：4 能量、8 物資。每 5 次己方回合放出一架無人機。', flak: '選自己的棋子架防空砲：3 能量、當地 1 存糧。擊落 3 格內的敵方無人機、空投與轟炸。', workshop: '選連通家園的後方棋子：3 能量、5 物資。之後每次己方行動物資庫 +2。', deploy: '鋪空格 2 能量並從 5 格內己子移交 3 存糧；攻占 4 能量，須足夠鄰援。河流先工程。', engineer: '把河流或山丘整成平地，或破壞敵方地道內部格。', tunnel: '從己子出發逐格選 3–4 格相鄰路徑，終點是另一枚己子，再按「完成地道」。', withdraw: '撤回自己的非家園棋子，回復 1 能量。', turret: '選自己的非家園棋子架炮台。', destroy: '選 5 格內敵方非家園棋子。', bridge: '依序選兩枚己子，相距 2–3 直線格。', reroute: '依序選保留端點、舊端點、新端點。', shield: '選自己的非家園棋子。', exchange: '先選自己的普通棋子，再選相鄰的空格或敵子。', breach: '選一枚與補給線相鄰、向對岸前進的敵子。', airdrop: '先選啟用的己方機場，再選 10 格內空格。', bombard: '先選啟用的己方機場，再選 12 格內敵子。' };
  const EVENT_TEXT = { arsenal: '建造兵工廠', flak: '架設防空砲', workshop: '開設補給工坊', 'drone-launch': '放出無人機', 'drone-down': '防空砲擊落無人機', 'drone-expire': '無人機燃料耗盡', 'air-intercept': '防空砲攔截空中行動', capture: '攻占敵子', destroy: '擊毀敵子', 'shield-block': '護盾擋下攻擊', 'supply-retreat': '斷補撤退', tunnel: '建造地道', turret: '架設炮台', shield: '架設護盾', bridge: '架橋', reroute: '改接橋梁', exchange: '換位', airdrop: '空投炮台', bombard: '航空轟炸', offer: '提議停戰', accept: '接受停戰', reject: '拒絕停戰', betray: '背盟（−4 分）', 'goal-arrival': '接通對岸！', 'goal-lost': '失去對岸連線', 'airport-unlocked': '機場啟用', 'airport-lost': '機場停用', 'depot-control': '接管物資站', fortified: '工事完成', 'hill-retreat': '山丘撤退', 'card-expired': '手牌到期', 'tunnel-collapse': '地道崩塌', 'neutral-warning': '中立事件預警', 'neutral-strike': '中立事件命中', 'neutral-block': '擋下中立事件', reshuffle: '棄牌重洗', 'breach-ready': '取得破陣令', breach: '預告破陣', 'campaign-end': '戰役結算', sandbox: '自由對戰開始', 'alliance-expired': '停戰到期', withdraw: '撤回', engineer: '工程', deploy: '鋪子', rest: '休整', discard: '棄牌', ready: '戰場就緒' };
  const QUIET = new Set(['deploy', 'rest', 'discard', 'engineer', 'goal-hold', 'withdraw', 'offer-expired', 'ready']);
  const CARD_ORDER = ['turret', 'destroy', 'bridge', 'reroute', 'shield', 'exchange'];
  const CARD_COLORS = { turret: '#ad7b23', destroy: '#a65e46', bridge: '#267477', reroute: '#4d739e', shield: '#84618c', exchange: '#668047' };
  const QUEUE_LIMIT = 4;
  const rgb = hex => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const rgba = (c, a = 1) => [c[0], c[1], c[2], a];
  const WHITE = [1, 1, 1], GREY = [0.55, 0.58, 0.62], DARK = [0.18, 0.2, 0.25];
  const PC = COLORS.map(rgb), PLIGHT = PC.map(c => mix(c, WHITE, 0.55)), PCUT = PC.map(c => mix(c, GREY, 0.6));
  const TOP = t => t === 1 ? 0.1 : t === 2 ? 0.8 : 0.32;
  const meta = type => E.CARD_META[type] || E.ACTION_META[type] || { cost: 0, slots: 1 };
  const node = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
  const hashCell = i => { let h = (i + 1) * 2654435761 >>> 0; h ^= h >>> 13; return (h % 1000) / 1000; };

  // ---------- renderer ----------
  const canvas = $('view'), overlay = $('overlay'), octx = overlay.getContext('2d'), mini = $('minimap'), mctx = mini.getContext('2d');
  let R = null;
  try { R = R3.create(canvas, { bound: E.RADIUS * 1.75, background: rgb('#eef2f6'), maxDpr: matchMedia('(max-width: 640px)').matches ? 1.5 : 2 }); } catch (error) { console.error(error); R = null; }
  if (!R) { $('webgl-fallback').hidden = false; $('notice').hidden = true; }
  const staticLayer = new R3.Layer(), dynamicLayer = new R3.Layer(), particleLayer = new R3.ParticleLayer();
  const scene = window.AutoHex3DScene.create({ E, X: E.CELLS.map(c => c.x), Z: E.CELLS.map(c => c.y), colors: COLORS });
  const X = E.CELLS.map(c => c.x), Z = E.CELLS.map(c => c.y);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  // ---------- state ----------
  let game = null, view = null, planView = null, recipe = null, mode = 'human', human = 1, focusFaction = 1;
  let initialTerrain = null, paved = new Set(), goalOf = new Int8Array(E.COUNT);
  let selection = { type: 'deploy', cells: [] }, queue = [], legal = new Set(), legalKey = '';
  let hovered = -1, focused = -1, actionLog = [], lastEventId = 0, tileColors = null, tileAnim = new Map(), holdUntil = new Map();
  let forest = [], routes = [], aim = new Map(), droneAnim = new Map(), scars = [], chokes = [], targets = [], staticDirty = true, animUntil = 0;
  let effects = [], layers = { supply: true, position: false, choke: true, plan: false };
  let aiTimer = null, queueTimer = null, generation = 0, timing = false, lastStamp = 0, windowStart = 0, windowPly = -1, lastClockPaint = 0, lastMini = 0;
  let animClock = 0, toastTimer = null, lastHandKey = '', resultShown = false, wasStarted = false;
  let aiWorker = null, pendingDecision = null, decisionSerial = 0, workerFailed = false;
  const stats = { frames: 0, staticBuilds: 0, lastFrameMs: 0, aiDecisions: 0, queueExecuted: 0, queueDropped: 0, autoRests: 0 };
  const commandLimit = () => Number($('command-window').value) || 0;
  const isHumanTurn = () => !!game && game.phase === 'running' && mode === 'human' && game.turn === human;
  const isAiTurn = () => !!game && game.phase === 'running' && (mode === 'spectator' || game.turn !== human);
  const observer = () => mode === 'human' ? human : 0;
  const subject = () => mode === 'human' ? human : focusFaction;
  const actionFor = cells => ({ type: selection.type, cells, ...(selection.cardIndex !== undefined ? { cardIndex: selection.cardIndex } : {}) });

  // ---------- AI (same worker and fallback as AutoHex) ----------
  function chooseSync(observation) { stats.aiDecisions++; return E.chooseAction(observation); }
  function currentDecision(job) { return job.generation === generation && game.ply === job.ply && game.turn === job.turn && game.phase === 'running' && !document.hidden; }
  function cancelAiWork() { if (!pendingDecision) return; const job = pendingDecision; pendingDecision = null; aiWorker?.terminate(); aiWorker = null; job.reject({ cancelled: true }); }
  function ensureWorker() {
    if (aiWorker || workerFailed || typeof Worker !== 'function') return aiWorker;
    try {
      const worker = new Worker('autohex-ai-worker.js'); aiWorker = worker;
      worker.addEventListener('message', event => {
        if (worker !== aiWorker) return;
        const result = event.data, job = pendingDecision;
        if (!job || !result || !['id', 'generation', 'ply', 'turn'].every(k => result[k] === job[k])) return;
        pendingDecision = null;
        if (result.type !== 'decision') { workerFailed = true; worker.terminate(); aiWorker = null; job.reject(new Error(result.message || 'AI failed')); return; }
        stats.aiDecisions++; job.resolve(result.action);
      });
      worker.addEventListener('error', event => { event.preventDefault(); if (worker !== aiWorker) return; workerFailed = true; worker.terminate(); aiWorker = null; const job = pendingDecision; pendingDecision = null; job?.reject(new Error('worker')); });
    } catch (_) { workerFailed = true; aiWorker = null; }
    return aiWorker;
  }
  function requestAi(observation, token) {
    const worker = ensureWorker();
    if (!worker) return Promise.resolve(chooseSync(observation));
    return new Promise((resolve, reject) => {
      const job = { id: ++decisionSerial, generation: token, ply: observation.ply, turn: observation.turn };
      pendingDecision = { ...job, resolve, reject };
      try { worker.postMessage({ type: 'choose', ...job, observation }); } catch (error) { pendingDecision = null; workerFailed = true; worker.terminate(); aiWorker = null; reject(error); }
    });
  }

  // ---------- clock and scheduling ----------
  function flushClock(now = performance.now()) {
    const next = Math.max(lastStamp, now);
    if (timing && game?.phase === 'running') game.advanceTime(next - lastStamp);
    lastStamp = next;
  }
  function stopTimers() { generation++; cancelAiWork(); clearTimeout(aiTimer); clearTimeout(queueTimer); aiTimer = queueTimer = null; timing = false; }
  function schedule() {
    flushClock(); stopTimers();
    if (!game || game.phase !== 'running' || document.hidden) return;
    const token = generation; timing = true; lastStamp = performance.now();
    if (isAiTurn()) {
      const seconds = Number($('step-seconds').value) || 0.45;
      aiTimer = setTimeout(async () => {
        aiTimer = null;
        if (token !== generation || game.phase !== 'running') return;
        flushClock(); if (game.phase !== 'running') { refresh(); return; }
        const observation = game.observation(game.turn), job = { generation: token, ply: game.ply, turn: game.turn };
        let action;
        try { action = await requestAi(observation, token); }
        catch (reason) { if (reason?.cancelled || !currentDecision(job)) return; action = chooseSync(observation); }
        if (!currentDecision(job)) return;
        flushClock(); if (game.phase !== 'running') { refresh(); return; }
        commit(action && E.legalAction(game.observation(game.turn), action) ? action : { type: 'rest', cells: [] }, 'ai');
      }, seconds * 1000);
    } else if (isHumanTurn()) {
      if (windowPly !== game.ply) { windowPly = game.ply; windowStart = game.activeMs; }
      if (queue.length) queueTimer = setTimeout(() => { if (token === generation) runQueue(); }, 280);
    }
  }
  function commit(action, source) {
    const p = game.turn;
    if (!game.act(action)) return false;
    actionLog.push({ ply: game.ply - 1, player: p, source, action: { type: action.type, cells: (action.cells || []).slice(), ...(action.cardIndex !== undefined ? { cardIndex: action.cardIndex } : {}), ...(action.target !== undefined ? { target: action.target } : {}), ...(action.planner ? { planner: action.planner } : {}) } });
    refresh(); schedule(); return true;
  }
  function perform(action, source = 'human') {
    flushClock();
    if (!isHumanTurn()) { refresh(); return false; }
    const now = game.observation(human);
    if (!E.legalAction(now, action)) { toast('這個指令目前不合法：請檢查距離、地形、能量、存糧與冷卻。沒有花費資源。', true); return false; }
    selection = { type: 'deploy', cells: [] };
    return commit(action, source);
  }
  function runQueue() {
    if (!isHumanTurn() || !queue.length) return;
    const result = L.takeQueued(game.observation(human), E, queue);
    stats.queueDropped += result.dropped.length;
    queue = result.action ? result.rest : [];
    if (result.dropped.length) toast(`移除 ${result.dropped.length} 個已失效的預約指令。`, !result.action);
    if (result.action) { stats.queueExecuted++; perform(result.action, 'queue'); toast(`執行預約：${LABELS[result.action.type]}${result.dropped.length ? `（另移除 ${result.dropped.length} 個失效指令）` : ''}`); }
    else renderQueue();
  }
  function enqueue(order) {
    if (queue.length >= QUEUE_LIMIT) { toast(`佇列最多 ${QUEUE_LIMIT} 個指令。`, true); return; }
    queue.push({ type: order.type, cells: (order.cells || []).slice(), ...(order.target !== undefined ? { target: order.target } : {}) });
    selection = { type: 'deploy', cells: [] }; legalKey = '';
    toast(`已預約：${LABELS[order.type]}（第 ${queue.length} 個）`);
    renderAll();
    if (isHumanTurn()) runQueue();
  }

  // ---------- game lifecycle ----------
  function readRecipe() {
    return { seed: $('seed').value.trim() || 'autohex3d', first: Number($('starter').value), rotation: Number($('rotation').value), durationMs: E.RULES.durationMs, expansion: $('expansion').value !== 'off',
      neutralEvents: $('neutral-events').value !== 'off', terrain: $('terrain-mode').value === 'plain' ? 'classic' : 'seeded', timedCards: $('timed-cards').value === 'timed' };
  }
  function reset({ fresh = false, start = false, keep = false } = {}) {
    stopTimers();
    if (fresh) $('seed').value = `hex3d-${Math.random().toString(36).slice(2, 8)}`;
    mode = $('match-mode').value; human = Number($('human-seat').value) || 1; focusFaction = mode === 'human' ? human : 1;
    $('human-seat').disabled = mode !== 'human';
    if (!keep || !recipe) recipe = readRecipe();
    game = new E.Game(recipe);
    initialTerrain = Uint8Array.from(game.terrain); paved = new Set();
    goalOf = new Int8Array(E.COUNT);
    for (const p of E.PLAYERS) for (let i = 0; i < E.COUNT; i++) if (E.goalCell(game, p, i)) goalOf[i] = p;
    selection = { type: 'deploy', cells: [] }; queue = []; legal = new Set(); legalKey = '';
    actionLog = []; lastEventId = 0; effects = []; scars = []; tileColors = null; tileAnim.clear(); holdUntil.clear(); droneAnim.clear(); scene.P.list.length = 0;
    windowPly = -1; resultShown = false; wasStarted = start; lastHandKey = '';
    $('result').hidden = true; $('event-log').replaceChildren(node('li', '', '戰場已就緒。'));
    if (start) game.start();
    $('notice').hidden = start || !R;
    refresh();
    const home = game.players[subject()].home;
    if (R) { Object.assign(R.camera, { tx: X[home] * .62, tz: Z[home] * .62, dist: 40, pitch: .92 }); R.camera.yaw = homeYaw(); }
    schedule();
  }

  // ---------- derived state ----------
  function planningView() {
    if (planView && planView.ply === game.ply) return planView;
    const v = game.observation(human);
    v.turn = human; v.observer = human;
    const pl = v.players[human]; pl.energy = Math.min(E.RULES.energyCap, pl.energy + E.RULES.regeneration);
    planView = v; return v;
  }
  function selectionView() { return isHumanTurn() ? view : mode === 'human' && game.phase === 'running' ? planningView() : null; }
  function computeLegal() {
    const v = selectionView();
    const key = v ? `${game.ply}:${isHumanTurn()}:${selection.type}:${selection.cardIndex}:${selection.cells.join(',')}` : 'none';
    if (key === legalKey) return;
    legalKey = key; legal = new Set();
    if (!v) return;
    for (let i = 0; i < E.COUNT; i++) if (!selection.cells.includes(i) && E.legalSelection(v, actionFor([...selection.cells, i]))) legal.add(i);
  }
  function ingestEvents(now) {
    for (const e of view.events) {
      if (e.id <= lastEventId) continue;
      lastEventId = e.id;
      const cells = (e.cells || []).filter(i => Number.isInteger(i) && i >= 0 && i < E.COUNT);
      const fx = (kind, extra) => effects.push({ kind, start: now, player: e.player, ...extra });
      // Board changes at a struck cell are shown when the round lands, not before.
      const hold = (cell, ms) => holdUntil.set(cell, Math.max(holdUntil.get(cell) || 0, now + ms));
      const shell = (from, to, after) => { const dur = 600 + 110 * E.distance(from, to); fx('shell', { from, to, dur, after }); hold(to, dur); };
      const hit = e.type === 'destroy';
      if ((hit || e.type === 'shield-block') && e.source === 'drone' && Number.isInteger(e.origin) && cells.length) { fx('dive', { from: e.origin, to: cells[0], dur: 520, hit }); hold(cells[0], 520); }
      else if (e.type === 'drone-down' && cells.length) fx('flakdown', { at: cells[0], flak: e.origin, from: e.from, dur: 700 });
      else if (e.type === 'air-intercept' && Number.isInteger(e.airport) && cells.length) { const plan = scene.planSortie(view, e.airport, cells[0], e.source === 'airdrop' ? 'crate' : 'bomb'); effects.push({ kind: 'sortie', start: now, player: e.from, plan, hits: [], intercept: true, flak: e.origin, dur: plan.dur + 300 }); }
      else if ((hit || e.type === 'shield-block') && e.source === 'bombard' && Number.isInteger(e.origin) && cells.length) {
        const plan = scene.planSortie(view, e.origin, cells[0], 'bomb'); fx('sortie', { plan, hit, hits: [], dur: plan.dur + 300 }); hold(cells[0], plan.landAt);
      } else if ((hit || e.type === 'shield-block') && Number.isInteger(e.origin) && cells.length) shell(e.origin, cells[0], hit ? 'blast' : 'deflect');
      else if ((hit || e.type === 'shield-block') && cells.length) { // demolition: shelled from the nearest own position
        let from = -1; for (let i = 0; i < E.COUNT; i++) if (view.board[i] === e.player && (from < 0 || E.distance(i, cells[0]) < E.distance(from, cells[0]))) from = i;
        if (from >= 0) shell(from, cells[0], hit ? 'blast' : 'deflect'); else fx('boom', { at: cells[0], dur: 100, scale: .9 });
      } else if (e.type === 'neutral-block') for (const i of cells) fx('boom', { at: i, dur: 100, scale: .4 });
      else if (e.type === 'capture') for (const i of cells) fx('capture', { at: i, dur: 100 });
      else if (e.type === 'supply-retreat') for (const i of cells.slice(0, 40)) fx('retreat', { at: i, dur: 100 });
      else if (e.type === 'airdrop' && cells.length >= 2) { const to = cells[cells.length - 1], plan = scene.planSortie(view, cells[0], to, 'crate'); fx('sortie', { plan, hits: [], dur: plan.dur + 300 }); hold(to, plan.landAt); }
      else if (e.type === 'neutral-strike') for (const i of cells) {
        if (e.kind === 'disaster') { fx('bolt', { at: i, dur: 1000 }); hold(i, 120); }
        else for (let k = 0; k < 3; k++) { effects.push({ kind: 'boom', at: i, start: now + k * 260, dur: 100, scale: .45, dx: (k - 1) * .35, dz: (k % 2 - .5) * .4, player: 0 }); hold(i, 600); }
      } else if (e.type === 'tunnel-collapse') for (const i of cells.slice(1, -1)) fx('boom', { at: i, dur: 100, scale: .5 });
      else if (e.type === 'goal-arrival') for (const i of E.CELLS.filter(c => goalOf[c.i] === e.player && view.board[c.i] === e.player).map(c => c.i)) fx('flare', { at: i, dur: 100 });
      if (e.type === 'goal-arrival' || e.type === 'goal-lost' || e.type === 'breach-ready' && e.player === observer()) toast(`${localName(e.player)}：${EVENT_TEXT[e.type]}`, e.type === 'goal-lost' && e.player === observer());
      if (e.type === 'supply-retreat' && e.player === observer()) toast(`補給告急：${cells.length} 枚棋子存糧耗盡撤退`, true);
      if (!QUIET.has(e.type) || e.player === observer() && observer()) logEvent(e);
    }
    if (effects.length > 160) effects.splice(0, effects.length - 160);
  }
  function logEvent(e) {
    const text = EVENT_TEXT[e.type] || e.type;
    const who = e.player ? localName(e.player) : '中立';
    const extra = e.type === 'supply-retreat' ? ` ×${(e.cells || []).length}` : e.from && e.from !== e.player && (e.type === 'capture' || e.type === 'destroy') ? ` → ${localName(e.from)}` : e.type === 'goal-arrival' && e.points ? ` +${e.points}` : '';
    const li = node('li', '', `R${e.round} ${who} ${text}${extra}`); li.style.setProperty('--faction', COLORS[e.player] || COLORS[0]);
    const log = $('event-log'); log.prepend(li);
    while (log.children.length > 60) log.lastChild.remove();
  }

  // ---------- refresh after every state change ----------
  function refresh() {
    if (!game) return;
    const now = animClock;
    view = game.observation(observer()); planView = null;
    paved = new Set(L.engineeredCells(initialTerrain, view.terrain));
    ingestEvents(now);
    // Captured / lost ground fades to its new colour (after any incoming round lands).
    const colors = E.CELLS.map(c => scene.tileColor(view, c.i, paved));
    if (tileColors) for (let i = 0; i < E.COUNT; i++) {
      const a = tileColors[i], b = colors[i];
      if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 1e-3) continue;
      const running = tileAnim.get(i), from = running ? currentTileColor(i, now) : a;
      tileAnim.set(i, { from, to: b, start: Math.max(now, holdUntil.get(i) || 0), dur: 650 });
    }
    tileColors = colors;
    forest = V.supplyForest(view, E.ADJ);
    routes = scene.routes(view, forest);
    aim = new Map(view.turrets.map(t => [t.cell, scene.aimFor(view, t.cell, t.owner)]));
    const alive = new Set();
    for (const d of view.drones || []) {
      alive.add(d.id);
      const to = { x: X[d.cell], y: scene.top(view, d.cell) + 1.25, z: Z[d.cell], cell: d.cell, target: d.target, owner: d.owner }, old = droneAnim.get(d.id);
      if (!old) droneAnim.set(d.id, { from: { x: X[d.from], y: scene.top(view, d.from) + .35, z: Z[d.from] }, to, start: now, dur: 900 });
      else if (old.to.cell !== d.cell) droneAnim.set(d.id, { from: dronePos(old, now), to, start: now, dur: 1000 });
      else old.to.target = d.target;
    }
    for (const id of [...droneAnim.keys()]) if (!alive.has(id)) droneAnim.delete(id);
    chokes = L.supplyChokepoints(view, E, subject());
    targets = [];
    for (const p of E.PLAYERS) if (p !== subject() && !E.allied(view, subject(), p)) targets.push(...L.supplyChokepoints(view, E, p).filter(c => c.cut >= 3).slice(0, 2));
    targets.sort((a, b) => b.cut - a.cut);
    staticDirty = true; legalKey = '';
    renderAll();
    if (game.phase === 'over' && !resultShown) showResult();
  }
  function renderAll() { computeLegal(); renderHud(); renderOrders(); renderHand(); renderQueue(); renderSupply(); renderPositions(); renderFactions(); renderDiplomacy(); renderStatus(); }

  // ---------- HUD and panels ----------
  function clockText() { const left = Math.max(0, game.durationMs - game.activeMs), s = Math.ceil(left / 1000); return game.sandbox ? '∞' : `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
  function paintClock() {
    if (!game) return;
    $('clock').textContent = clockText();
    $('campaign-progress').style.width = `${Math.min(100, game.activeMs / game.durationMs * 100)}%`;
    $('clock-note').textContent = game.sandbox ? '自由對戰 · 不限時' : game.phase === 'paused' ? '已暫停 · 時間凍結' : game.phase === 'over' ? '戰役已結算' : game.phase === 'running' ? '進行中 · 思考也計時' : '前景、未暫停才計時';
    const bar = $('window-bar'), limit = commandLimit();
    if (isHumanTurn() && limit) {
      const left = Math.max(0, limit * 1000 - (game.activeMs - windowStart));
      bar.hidden = false; $('window-fill').style.width = `${left / (limit * 10)}%`; bar.classList.toggle('is-urgent', left < 5000);
      $('turn-label').textContent = `你的回合 · ${Math.ceil(left / 1000)} 秒`;
    } else bar.hidden = true;
  }
  function renderHud() {
    const p = game.phase === 'running' || game.phase === 'paused' ? game.turn : subject();
    const shown = mode === 'human' ? human : p, pl = view.players[shown];
    $('turn-label').textContent = game.phase === 'ready' ? '等待開局' : game.phase === 'over' ? '戰役結算' : game.phase === 'paused' ? '已暫停' : isHumanTurn() ? '你的回合' : `${localName(game.turn)} 行動中`;
    document.querySelector('.ah3-turn').style.setProperty('--faction', COLORS[game.turn]);
    $('round-label').textContent = `第 ${view.round} 輪 · ${view.ply} 次行動`;
    $('energy').textContent = `⚡ ${pl.energy}/${E.RULES.energyCap}`;
    $('supplies').textContent = `▣ ${pl.supplies}/${E.RULES.suppliesCap}`;
    $('supplies').classList.toggle('is-low', pl.supplies < 4);
    $('haul').textContent = `⇢ ${pl.haulUsed || 0}/${E.RULES.haulBudget}`;
    $('energy').title = `${localName(shown)} 能量：每回合 +3，上限 8`;
    $('pause').disabled = !(game.phase === 'running' || game.phase === 'paused');
    $('pause').textContent = game.phase === 'paused' ? '繼續' : '暫停';
    $('play').disabled = game.phase !== 'ready';
    paintClock();
  }
  function renderOrders() {
    const myTurn = isHumanTurn(), planning = mode === 'human' && game.phase === 'running' && !myTurn;
    const v = selectionView(), pl = v ? v.players[human] : null;
    for (const button of document.querySelectorAll('#orders [data-action]')) {
      const type = button.dataset.action, m = meta(type);
      let visible = true, enabled = !!v && pl.energy >= (m.cost || 0);
      if (type === 'breach') { visible = !!pl && pl.breachReady && !pl.breachUsed; }
      if (type === 'airdrop' || type === 'bombard') {
        visible = !!v && (v.airports || []).some(a => a.owner === human && a.active);
        enabled = enabled && pl.airCooldown === 0 && pl.supplies >= m.supplyCost + E.logisticsCost(v, { type, cells: [] });
      }
      if (type === 'tunnel') enabled = enabled && (v.tunnels || []).filter(t => t.owner === human).length < E.RULES.maxTunnels;
      if (m.expansion) {
        visible = !!(v || view).expansion;
        const built = ((v || view).structures || []).filter(t => t.owner === human && t.type === type).length, max = E.EXPANSION[type === 'arsenal' ? 'maxArsenals' : type === 'flak' ? 'maxFlak' : 'maxWorkshops'];
        enabled = enabled && built < max && pl.supplies >= E.logisticsCost(v, { type, cells: [] });
        button.title = `${LABELS[type]}：已建 ${built}/${max}`;
      }
      button.hidden = !visible; button.disabled = !enabled;
      button.setAttribute('aria-pressed', String(selection.type === type && selection.cardIndex === undefined));
    }
    $('rest').disabled = !(myTurn || planning);
    $('rest').innerHTML = planning ? '預約休整<small>+3⚡</small>' : '休整<small>+3⚡</small>';
    const m = meta(selection.type), cells = selection.cells.length;
    $('selection-label').textContent = `${planning ? '預約' : '已選'}：${LABELS[selection.type]}${m.slots > 1 ? ` (${cells}/${m.variableSlots ? `${m.slots}–${m.maxSlots}` : m.slots})` : ''}`;
    $('back-selection').hidden = !cells;
    $('confirm-selection').hidden = !(m.variableSlots && v && E.legalAction(v, actionFor(selection.cells)));
    $('confirm-selection').textContent = planning ? '預約地道' : '完成地道';
    $('discard').hidden = !(myTurn && selection.cardIndex !== undefined);
  }
  function renderHand() {
    const hand = mode === 'human' ? view.hand : [], pl = view.players[human];
    const key = hand.join(',') + '|' + (view.cardLife || []).join(',');
    const container = $('hand');
    const v = selectionView();
    if (key !== lastHandKey) {
      const previous = lastHandKey ? lastHandKey.split('|')[0].split(',').filter(Boolean) : [];
      const fresh = hand.length && previous.length && hand.length >= previous.length ? hand.length - 1 : -1;
      container.replaceChildren(...hand.map((type, k) => {
        const button = node('button', 'ah3-card' + (k === fresh && hand[k] !== previous[k] ? ' is-drawn' : '')); button.type = 'button'; button.dataset.card = String(k);
        button.append(cardMark(type), node('strong', '', LABELS[type]), node('span', 'cost', `${meta(type).cost}⚡ · ${meta(type).slots} 格`), node('span', 'desc', CARD_TEXT[type] || ''), node('span', 'key', String(k + 1)));
        if (view.timedCards && view.cardLife?.[k] !== undefined) button.append(node('span', 'life', `剩 ${view.cardLife[k]}`));
        button.style.setProperty('--card', CARD_COLORS[type] || '#267477');
        button.addEventListener('click', () => selectAction(type, k));
        return button;
      }));
      if (!hand.length) container.append(node('span', 'ah3-hand-empty', mode === 'human' ? '手牌已空，下次行動補抽。' : '觀戰模式不顯示任何一方手牌。'));
      lastHandKey = key;
    }
    for (const button of container.querySelectorAll('.ah3-card')) {
      const k = Number(button.dataset.card), type = hand[k];
      button.disabled = !v || pl.energy < meta(type).cost;
      button.setAttribute('aria-pressed', String(selection.cardIndex === k));
    }
    $('deck-count').textContent = `牌堆 ${view.drawCount}`;
    $('discard-count').textContent = `棄牌 ${view.discardCount} · 重洗 ${view.telemetry.reshuffles}`;
    const recipe = L.deckSummary(view, E);
    $('recipe').replaceChildren(...recipe.filter(r => r.perSeat).map(r => { const i = node('i'); i.style.width = `${r.share * 100}%`; i.style.background = CARD_COLORS[r.type]; i.title = `${LABELS[r.type]} ${r.perSeat}/13（${Math.round(r.share * 100)}%）`; return i; }));
    $('deck').title = '共享牌池配方（每席 13 張）：' + recipe.map(r => `${LABELS[r.type]} ${r.perSeat}`).join('、') + '。牌序與他人手牌不公開。';
  }
  function renderQueue() {
    const list = $('queue');
    list.replaceChildren(...queue.map((order, k) => {
      const li = node('li', '', `${k + 1}. ${LABELS[order.type]}${order.cells.length ? ` @${order.cells.map(i => `${E.CELLS[i].q},${E.CELLS[i].r}`).join('→')}` : ''}`);
      const remove = node('button', '', '×'); remove.type = 'button'; remove.setAttribute('aria-label', `移除第 ${k + 1} 個預約`);
      remove.addEventListener('click', () => { queue.splice(k, 1); renderQueue(); });
      li.append(remove); return li;
    }));
    if (!queue.length) list.append(node('li', 'is-empty', mode === 'human' ? '尚無預約 · AI 行動時選指令再點格子' : '觀戰中'));
  }
  function gauge(label, value, ratio, warn = false, title = '') {
    const box = node('div', 'ah3-gauge' + (warn ? ' is-warn' : '')); box.title = title;
    box.append(node('span', '', label), node('strong', '', value));
    if (ratio !== null) { const i = node('i'), b = node('b'); b.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`; i.append(b); box.append(i); }
    return box;
  }
  function listButton(text, value, cell, color) {
    const li = node('li'), b = node('button'); b.type = 'button'; b.style.setProperty('--faction', color);
    b.append(node('span', '', text), node('b', '', value)); b.addEventListener('click', () => { focusOn(cell, 18); describeCell(cell); }); li.append(b); return li;
  }
  function renderSupply() {
    const p = subject(), rep = L.supplyReport(view, E, p);
    $('supply-tag').textContent = mode === 'human' ? `${localName(p)}（你）` : `${localName(p)}（觀察）`;
    $('supply-gauges').replaceChildren(
      gauge('後方物資庫', `${rep.supplies}/${rep.suppliesCap}`, rep.supplies / rep.suppliesCap, rep.supplies < 4, '每次己方行動後家園產 4，連通物資站各 +2'),
      gauge('每次產出', `+${rep.production}`, null, false, `家園 4 + 物資站 ${rep.depots} × 2${view.expansion ? ` + 補給工坊 ${rep.workshops} × 2` : ''}`),
      gauge('運距預算', `${rep.haulUsed}/${rep.haulBudget}`, rep.haulUsed / rep.haulBudget, rep.haulUsed > rep.haulBudget * .85, '上次配送使用的運距；長線拖慢回補'),
      gauge('連通棋子', `${rep.linked}/${rep.stones}`, rep.stones ? rep.linked / rep.stones : 0, rep.cut.length > 0, '連回家園的棋子'),
      gauge('距對岸', rep.reached ? '已接通' : rep.goalGap === null ? '—' : `${rep.goalGap} 格`, rep.goalGap === null ? 0 : 1 - rep.goalGap / (E.RADIUS * 2), false, '最前線連通棋子到對岸的距離'),
      gauge('機場／物資站', `${rep.airports} / ${rep.depots}`, null, false, '啟用的機場與連通的物資站'));
    const cutList = $('cut-list');
    cutList.replaceChildren(...rep.cut.slice(0, 12).map(c => listButton(`(${E.CELLS[c.cell].q}, ${E.CELLS[c.cell].r})`, `存糧 ${c.reserve}`, c.cell, COLORS[p])));
    if (!rep.cut.length) cutList.append(node('li', 'is-empty', '全軍連通。'));
    const chokeList = $('choke-list');
    chokeList.replaceChildren(...chokes.slice(0, 8).map(c => listButton(`(${E.CELLS[c.cell].q}, ${E.CELLS[c.cell].r})`, `−${c.cut} 子`, c.cell, COLORS[p])));
    if (!chokes.length) chokeList.append(node('li', 'is-empty', '沒有單點失守會斷補的格子。'));
    const targetList = $('target-list');
    targetList.replaceChildren(...targets.slice(0, 8).map(c => listButton(`${localName(c.owner)} (${E.CELLS[c.cell].q}, ${E.CELLS[c.cell].r})`, `斷 ${c.cut}`, c.cell, COLORS[c.owner])));
    if (!targets.length) targetList.append(node('li', 'is-empty', '敵方補給網目前沒有明顯單點。'));
  }
  function renderPositions() {
    const p = subject(), pos = L.positionReport(view, E, p);
    $('position-gauges').replaceChildren(
      gauge('炮台', `${pos.turrets.length}/${E.RULES.maxTurrets}`, pos.turrets.length / E.RULES.maxTurrets),
      gauge('護盾', String(pos.shields), null),
      gauge('工事', `${pos.fortified}${pos.maturing ? ` (+${pos.maturing} 將成)` : ''}`, null, false, '連續保有 31 次己方行動形成工事，抵擋中立事件'),
      gauge('山丘駐守', String(pos.hills), null, pos.hillCells.some(h => h.left <= 1), '山丘防守 +1，但 3 次己方行動後撤退'));
    const list = $('turret-list');
    list.replaceChildren(...pos.turrets.map(t => listButton(`炮台 (${E.CELLS[t.cell].q}, ${E.CELLS[t.cell].r})${t.armed ? '' : ' · 缺糧停火'}`, `倒數 ${t.countdown} · 壽命 ${t.life}`, t.cell, COLORS[p])),
      ...pos.hillCells.map(h => listButton(`山丘 (${E.CELLS[h.cell].q}, ${E.CELLS[h.cell].r})`, `撤退 ${h.left}`, h.cell, COLORS[p])),
      ...(view.structures || []).filter(s => s.owner === p && view.board[s.cell] === p).map(s => listButton(`${LABELS[s.type]} (${E.CELLS[s.cell].q}, ${E.CELLS[s.cell].r})${s.type !== 'flak' && !view.supplied[s.cell] ? ' · 斷補停工' : ''}`,
        s.type === 'arsenal' ? `出機 ${s.countdown} · 空中 ${(view.drones || []).filter(d => d.owner === p).length}` : s.type === 'flak' ? `彈藥 ${view.reserve[s.cell]}` : '+2 物資', s.cell, COLORS[p])));
    if (!list.children.length) list.append(node('li', 'is-empty', '尚無炮台或山丘駐守。'));
  }
  function renderFactions() {
    const ranking = E.PLAYERS.slice().sort((a, b) => view.players[b].score - view.players[a].score || a - b);
    $('factions').replaceChildren(...ranking.map(p => {
      const pl = view.players[p], rep = L.supplyReport(view, E, p), li = node('li'), b = node('button');
      b.type = 'button'; b.style.setProperty('--faction', COLORS[p]); if (game.turn === p && game.phase === 'running') b.classList.add('is-turn');
      const role = mode === 'human' && p === human ? '你' : pl.strategy?.name || 'AI';
      b.append(node('strong', '', `${localName(p)} · ${role}${pl.reached ? ' ✓對岸' : ''}`), node('span', 'score', String(pl.score)),
        node('small', '', `棋子 ${rep.stones}（斷 ${rep.cut.length}）· 物資 ${pl.supplies} · 距對岸 ${rep.reached ? 0 : rep.goalGap ?? '—'}`));
      b.addEventListener('click', () => { if (mode !== 'human') { focusFaction = p; refresh(); } focusOn(rep.frontline >= 0 ? rep.frontline : pl.home, 26); });
      li.append(b); return li;
    }));
  }
  function renderDiplomacy() {
    const panel = $('diplomacy'); panel.hidden = mode !== 'human';
    if (mode !== 'human') return;
    const myTurn = isHumanTurn(), v = view;
    const incoming = (v.offers || []).filter(o => o.to === human && o.expiresRound > v.round);
    $('offers').replaceChildren(...incoming.map(o => {
      const row = node('div', 'ah3-offer'); row.append(node('span', '', `${localName(o.from)} 提議停戰（至第 ${o.expiresRound} 輪）`));
      for (const type of ['accept', 'reject']) {
        const b = node('button', 'btn', LABELS[type]); b.type = 'button'; b.disabled = !myTurn || !E.legalAction(v, { type, cells: [], target: o.from });
        b.addEventListener('click', () => perform({ type, cells: [], target: o.from })); row.append(b);
      }
      return row;
    }));
    const select = $('diplomacy-target'), prev = select.value;
    select.replaceChildren(...E.PLAYERS.filter(p => p !== human).map(p => { const o = node('option', '', `${localName(p)}${E.allied(v, human, p) ? '（停戰中）' : ''}`); o.value = String(p); return o; }));
    if (prev) select.value = prev;
    const target = Number(select.value);
    $('offer').disabled = !myTurn || !E.legalAction(v, { type: 'offer', cells: [], target });
    $('betray').disabled = !myTurn || !E.legalAction(v, { type: 'betray', cells: [], target });
    const pacts = (v.alliances || []).filter(a => a.expiresRound > v.round).map(a => `${localName(a.a)} ⇄ ${localName(a.b)}（至第 ${a.expiresRound} 輪）`);
    $('alliances').textContent = pacts.length ? '停戰中：' + pacts.join('；') : '尚無停戰。';
  }
  function renderStatus(message) {
    const el = $('status'); el.classList.remove('is-error');
    if (message) { el.textContent = message; return; }
    if (game.phase === 'ready') el.textContent = '按「開始戰役」。你的家園在畫面中央，對岸是遠處同色的邊緣。';
    else if (game.phase === 'paused') el.textContent = '已暫停：時間凍結，可自由轉動視角。';
    else if (game.phase === 'over') el.textContent = '戰役結算完成，可繼續自由對戰。';
    else if (mode === 'spectator') el.textContent = `觀戰中：${localName(game.turn)} 正在規劃。點按六方戰況切換觀察的補給線。`;
    else if (isHumanTurn()) el.textContent = HINTS[selection.type] || '選擇指令或手牌，再點按格子。';
    else el.textContent = `${localName(game.turn)} 行動中 · 可先預約指令（${queue.length}/${QUEUE_LIMIT}）。`;
  }
  function describeCell(i) {
    if (i < 0 || !view) return;
    const c = E.CELLS[i], owner = view.board[i], anchor = view.anchors[i];
    const terrain = view.terrain[i] === 1 ? '河流' : view.terrain[i] === 2 ? '山丘' : paved.has(i) ? '整地平地' : '平地';
    const turret = view.turrets.find(t => t.cell === i), airport = view.airports.find(a => a.cell === i), depot = view.depots.find(d => d.cell === i);
    const choke = chokes.find(k => k.cell === i) || targets.find(k => k.cell === i);
    const parts = [`格 (${c.q}, ${c.r})`, anchor ? `${localName(anchor)} 永久家園` : owner ? `${localName(owner)} 棋子` : '空格', terrain];
    if (owner) parts.push(view.supplied[i] ? '補給連通' : '補給切斷', `存糧 ${view.reserve[i]}/6`, `上次送達 ${view.delivered[i]}`, `轉運 ${view.supplyLoad[i]}/4`);
    if (owner && !anchor) parts.push(view.fortified[i] ? '工事已成' : `持守 ${view.age[i]}/31`);
    if (owner && view.terrain[i] === 2 && !anchor) parts.push(`山丘撤退倒數 ${3 - (view.hillAge[i] || 0)}`);
    if (view.shields[i]) parts.push(`護盾 ${view.shields[i]} 回合`);
    if (turret) parts.push(`炮台：倒數 ${turret.countdown}、壽命 ${turret.life}${view.reserve[i] >= 2 ? '' : '、缺糧停火'}`);
    if (airport) parts.push(`機場${airport.owner ? `（${localName(airport.owner)}${airport.active ? '，已啟用' : `，連片 ${airport.cluster}/12，維持 ${airport.progress}/3`}）` : ''}`);
    if (depot) parts.push(`物資站${depot.owner && depot.supplied ? `（${localName(depot.owner)} 連通，+2/行動）` : ''}`);
    if (goalOf[i]) parts.push(`${localName(goalOf[i])} 的對岸`);
    if (choke) parts.push(`失守將使 ${choke.cut} 枚 ${localName(choke.owner)} 棋子斷補`);
    if (view.neutralWarning?.cells.includes(i)) parts.push(`⚠ 中立${view.neutralWarning.kind === 'disaster' ? '災害' : '游擊'}預警`);
    $('cell-info').textContent = parts.join(' · ');
  }
  function toast(message, isError = false) {
    const el = $('toast'); el.textContent = message; el.classList.add('is-visible'); el.classList.toggle('is-error', isError);
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('is-visible'), isError ? 3200 : 2200);
    if (isError) { $('status').textContent = message; $('status').classList.add('is-error'); }
  }
  function showResult() {
    resultShown = true; stopTimers();
    const r = game.result; if (!r) return;
    $('result').hidden = false;
    const winners = r.winners.map(localName).join('、');
    $('result-title').textContent = r.winners.includes(human) && mode === 'human' ? (r.draw ? '並列第一！' : '你贏得戰役！') : `${winners} 獲勝`;
    $('result-description').textContent = `十分鐘戰役結束。${mode === 'human' ? `你的名次：第 ${r.standings.find(s => s.player === human).rank} 名。` : ''}可繼續自由對戰（不再計時）。`;
    $('standings').replaceChildren(...r.standings.map(s => node('li', '', `${localName(s.player)} · ${s.score} 分`)));
  }

  // ---------- selection ----------
  function selectAction(type, cardIndex) {
    if (!(isHumanTurn() || mode === 'human' && game.phase === 'running')) return;
    selection = { type, cells: [], ...(cardIndex !== undefined ? { cardIndex } : {}) }; legalKey = '';
    renderAll();
  }
  function pickCell(i) {
    if (i < 0) return;
    focused = i; describeCell(i);
    const myTurn = isHumanTurn(), planning = mode === 'human' && game.phase === 'running' && !myTurn;
    if (!myTurn && !planning) return;
    const v = myTurn ? game.observation(human) : planningView(), m = meta(selection.type);
    const cells = [...selection.cells, i], action = actionFor(cells);
    if (!E.legalSelection(v, action)) { toast(planning ? '這格就算輪到你也無法接續目前指令（距離、地形、能量或所有權）。' : '這格無法接續目前的選取：請檢查距離、地形、所有權與資源。沒有花費資源。', true); return; }
    if (!m.variableSlots && cells.length === m.slots) { if (myTurn) perform(action); else enqueue(action); return; }
    selection.cells = cells; legalKey = ''; renderAll();
  }

  // ---------- 3D scene ----------
  function currentTileColor(i, now) {
    const a = tileAnim.get(i); if (!a) return tileColors ? tileColors[i] : scene.tileColor(view, i, paved);
    const k = Math.max(0, Math.min(1, (now - a.start) / a.dur)), e = k * k * (3 - 2 * k);
    return [a.from[0] + (a.to[0] - a.from[0]) * e, a.from[1] + (a.to[1] - a.from[1]) * e, a.from[2] + (a.to[2] - a.from[2]) * e];
  }
  function buildStatic(now) {
    const S = staticLayer; S.clear(); stats.staticBuilds++;
    for (const [i, a] of tileAnim) if (now >= a.start + a.dur) tileAnim.delete(i);
    animUntil = 0; for (const a of tileAnim.values()) animUntil = Math.max(animUntil, a.start + a.dur);
    scene.terrain(S, view, { paved, goalOf, subject: subject(), skip: new Set(tileAnim.keys()) });
    for (const a of view.airports) scene.airfield(S, view, a);
    for (const d of view.depots) scene.depot(S, view, d);
    // Supply roads follow each faction's home-rooted supply tree.
    const nodes = new Set();
    for (const link of forest) if (!link.bridge) { scene.road(S, view, link.a, link.b, link.owner, link.owner === subject()); nodes.add(link.a); nodes.add(link.b); }
    for (const i of nodes) if (!view.anchors[i]) scene.junction(S, view, i);
    for (const b of view.bridges) if (view.board[b.a] === b.owner && view.board[b.b] === b.owner) scene.bridge(S, view, b);
    for (const t of view.tunnels) scene.tunnel(S, view, t);
    for (let i = 0; i < E.COUNT; i++) if (view.anchors[i] && view.board[i]) scene.castle(S, view, i, view.board[i], scene.top(view, i));
    for (const t of view.structures || []) if (view.board[t.cell] === t.owner) { if (t.type === 'arsenal') scene.arsenal(S, view, t); else if (t.type === 'workshop') scene.workshop(S, view, t); }
    if (layers.position) for (const t of view.turrets) {
      if (view.board[t.cell] !== t.owner) continue;
      for (const c of E.CELLS) if (E.distance(t.cell, c.i) <= E.RULES.turretRange && c.i !== t.cell) S.add('hexFlat', X[c.i], scene.top(view, c.i) + .01, Z[c.i], .9, .02, .9, 0, rgba(PC[t.owner], .16));
    }
    staticDirty = false;
  }
  function buildDynamic(now, dt) {
    const D = dynamicLayer; D.clear(); particleLayer.clear();
    const t = now / 1000, tops = i => scene.top(view, i), still = reducedMotion.matches;
    for (const [i, a] of tileAnim) if (now < a.start + a.dur) scene.tile(D, view, i, currentTileColor(i, now));
    for (const tur of view.turrets) if (view.board[tur.cell] === tur.owner && now >= (holdUntil.get(tur.cell) || 0)) scene.turret(D, view, tur.cell, tur.owner, tops(tur.cell), aim.get(tur.cell), now);
    if (layers.supply && !still) scene.trucks(D, particleLayer, routes, t, dt, subject(), view);
    for (const s of view.structures || []) {
      if (view.board[s.cell] !== s.owner) continue;
      if (s.type === 'arsenal' && !still) scene.chimney(view, s, dt);
      if (s.type === 'flak') scene.flakGun(D, view, s, flakAim(s, now), now);
    }
    for (const a of droneAnim.values()) {
      const p = dronePos(a, now), yaw = Math.atan2(a.to.z - a.from.z, a.to.x - a.from.x) || 0;
      scene.droneModel(D, p.x, p.y + (still ? 0 : Math.sin(t * 3 + a.to.cell) * .05), p.z, yaw, still ? 0 : t, a.to.owner, (now - a.start) < a.dur ? .18 : 0);
      D.add('cyl', p.x, scene.top(view, a.to.cell) + .012, p.z, .14, .004, .14, 0, [0, 0, 0, .18]);
    }
    if (!still) scene.airTraffic(D, view, t, dt);
    // Severed ground pulses along its own edge; the overlay prints remaining reserve.
    for (let i = 0; i < E.COUNT; i++) {
      const p = view.board[i];
      if (p && !view.supplied[i] && !view.anchors[i]) D.add('ring', X[i], tops(i) - .01, Z[i], .99, .035, .99, 0, rgba(rgb('#d24a32'), p === subject() ? .95 : .55), .8);
    }
    if (layers.choke) {
      for (const c of chokes.slice(0, 14)) if (c.cut >= 2) D.add('ring', X[c.cell], tops(c.cell) + .04, Z[c.cell], .8, .02, .8, t * .6, rgba(rgb('#e58a2c'), .95), .6);
      for (const c of targets) D.add('ring', X[c.cell], tops(c.cell) + .04, Z[c.cell], .85, .02, .85, -t * .6, rgba(rgb('#c2263a'), .95), .7);
    }
    if (view.neutralWarning) for (const i of view.neutralWarning.cells) D.add('cone', X[i], tops(i) + 1.5 + Math.sin(t * 4) * .12, Z[i], .26, -.5, .26, t, rgba(rgb('#d9a52b')), .7);
    if (layers.plan) for (const p of E.PLAYERS) {
      const intent = view.intents?.[p]; if (!intent || mode === 'human' && p === human) continue;
      for (const i of intent.path || []) D.add('sphere', X[i], tops(i) + .65, Z[i], .08, .08, .08, 0, rgba(PLIGHT[p]), .4);
      if (Number.isInteger(intent.target) && intent.target >= 0) D.add('oct', X[intent.target], tops(intent.target) + 1.4 + Math.sin(t * 2 + p) * .15, Z[intent.target], .22, .3, .22, t, rgba(PC[p]), .5);
    }
    if (legal.size) { const mark = isHumanTurn() ? rgb('#1f2a36') : rgb('#5b6f8a'); for (const i of legal) D.add('cyl', X[i], tops(i) + .02, Z[i], .2, .03, .2, 0, rgba(mark, isHumanTurn() ? .7 : .45), .15); }
    for (const i of selection.cells) D.add('ring', X[i], tops(i) + .02, Z[i], .95, .06, .95, 0, rgba(rgb('#267477')), .6);
    if (hovered >= 0) D.add('ring', X[hovered], tops(hovered) + .02, Z[hovered], 1, .05, 1, 0, rgba(legal.has(hovered) ? rgb('#1d8f92') : WHITE), .4);
    if (focused >= 0 && focused !== hovered) D.add('ring', X[focused], tops(focused) + .02, Z[focused], 1, .04, 1, 0, rgba(rgb('#2e3440'), .7));
    // Craters, shells, sorties, explosions and smoke.
    scars = scars.filter(v => v.until > now);
    scene.scars(D, view, scars, now);
    effects = effects.filter(e => now - e.start < e.dur + 400);
    const spawned = [];
    scene.effects(D, particleLayer, view, effects, now, dt, ev => {
      if (ev.kind === 'blast') {
        scene.blast(ev.x, ev.y, ev.z, ev.scale);
        scars.push({ x: ev.x, y: ev.y, z: ev.z, r: ev.scale, yaw: Math.random() * 6, until: now + 30000 });
        spawned.push({ kind: 'fire', x: ev.x, y: ev.y, z: ev.z, start: now, dur: 2400 * ev.scale });
        shake(ev.x, ev.z, ev.scale);
      } else if (ev.kind === 'deflect') { scene.deflect(ev.x, ev.y, ev.z); shake(ev.x, ev.z, .3); }
    });
    effects.push(...spawned);
    if (scars.length > 80) scars.splice(0, scars.length - 80);
    if (!still) scene.P.update(dt);
    scene.P.draw(particleLayer);
  }
  function dronePos(a, now) {
    const k = Math.max(0, Math.min(1, (now - a.start) / a.dur)), e = k * k * (3 - 2 * k), lift = Math.sin(k * Math.PI) * .25;
    return { x: a.from.x + (a.to.x - a.from.x) * e, y: a.from.y + (a.to.y - a.from.y) * e + lift, z: a.from.z + (a.to.z - a.from.z) * e };
  }
  function flakAim(s, now) {
    let best = null, bestD = Infinity;
    for (const a of droneAnim.values()) if (a.to.owner !== s.owner && !E.allied(view, s.owner, a.to.owner)) { const p = dronePos(a, now), d = Math.hypot(p.x - X[s.cell], p.z - Z[s.cell]); if (d < bestD) { bestD = d; best = p; } }
    if (best && bestD < 9) return best;
    for (const a of view.airports) if (a.active && a.owner !== s.owner && !E.allied(view, s.owner, a.owner)) { const d = Math.hypot(X[a.cell] - X[s.cell], Z[a.cell] - Z[s.cell]); if (d < bestD) { bestD = d; best = { x: X[a.cell], z: Z[a.cell] }; } }
    return best;
  }
  function shake(x, z, scale) {
    if (!R || reducedMotion.matches) return;
    const c = R.camera, d = Math.hypot(x - c.tx, z - c.tz), near = Math.max(0, 1 - d / (c.dist * .8));
    c.shake = Math.min(.5, (c.shake || 0) + scale * .28 * near * Math.min(1, 22 / c.dist));
  }
  function drawOverlay() {
    const { width, height, dpr } = R.size;
    if (overlay.width !== Math.round(width * dpr) || overlay.height !== Math.round(height * dpr)) { overlay.width = Math.round(width * dpr); overlay.height = Math.round(height * dpr); }
    octx.setTransform(dpr, 0, 0, dpr, 0, 0); octx.clearRect(0, 0, width, height);
    if (!view) return;
    const zoomed = R.camera.dist < 40;
    octx.textAlign = 'center'; octx.textBaseline = 'middle';
    const badge = (i, y, text, bg, fg = '#fff', size = 11, gun = false) => {
      const s = R.project(X[i], y, Z[i]); if (!s || s.x < -20 || s.y < -20 || s.x > width + 20 || s.y > height + 20) return;
      octx.font = `700 ${size}px ui-monospace, Menlo, monospace`;
      const pad = gun ? 17 : 0, w = Math.max(16, octx.measureText(text).width + 8 + pad);
      octx.fillStyle = bg; octx.beginPath(); octx.roundRect ? octx.roundRect(s.x - w / 2, s.y - 9, w, 18, 9) : octx.rect(s.x - w / 2, s.y - 9, w, 18); octx.fill();
      if (gun) { // field-gun pictogram: tracks, turret dome, raised barrel
        const gx = s.x - w / 2 + 5, gy = s.y + 4;
        octx.strokeStyle = fg; octx.fillStyle = fg; octx.lineWidth = 1.6; octx.lineCap = 'round';
        octx.beginPath(); octx.roundRect ? octx.roundRect(gx, gy - 1, 13, 3.5, 1.7) : octx.rect(gx, gy - 1, 13, 3.5); octx.fill();
        octx.beginPath(); octx.arc(gx + 5.5, gy - 1.5, 3.6, Math.PI, 0); octx.fill();
        octx.beginPath(); octx.moveTo(gx + 7.5, gy - 4); octx.lineTo(gx + 14, gy - 8.5); octx.stroke();
      }
      octx.fillStyle = fg; octx.fillText(text, s.x + pad / 2, s.y + .5);
    };
    for (const p of E.PLAYERS) { const h = view.players[p].home; badge(h, TOP(view.terrain[h]) + 2.9, `${LETTER(p)} ${view.players[p].score}`, COLORS[p], '#fff', 12); }
    for (let i = 0; i < E.COUNT; i++) {
      const p = view.board[i];
      if (p && !view.supplied[i] && !view.anchors[i] && (zoomed || p === subject())) badge(i, TOP(view.terrain[i]) + .95, String(view.reserve[i]), p === subject() ? '#c2263a' : '#c2263acc');
    }
    if (layers.choke) {
      for (const c of chokes.slice(0, 5)) if (c.cut >= 2) badge(c.cell, TOP(view.terrain[c.cell]) + 1.25, `−${c.cut}`, '#e58a2c');
      for (const c of targets.slice(0, 6)) badge(c.cell, TOP(view.terrain[c.cell]) + 1.25, `✂${c.cut}`, '#c2263a');
    }
    if (zoomed || layers.position) for (const t of view.turrets) if (view.board[t.cell] === t.owner) badge(t.cell, TOP(view.terrain[t.cell]) + 1.35, String(t.countdown), view.reserve[t.cell] >= 2 ? '#2e3440' : '#9aa5b1', '#fff', 11, true);
    for (const s of view.structures || []) if (view.board[s.cell] === s.owner && (zoomed || layers.position || s.owner === subject())) {
      if (s.type === 'arsenal') badge(s.cell, TOP(view.terrain[s.cell]) + 1.35, `廠 ${s.countdown}`, COLORS[s.owner]);
      else if (s.type === 'flak') badge(s.cell, TOP(view.terrain[s.cell]) + 1.0, view.reserve[s.cell] >= 1 ? '防空' : '防空✕', view.reserve[s.cell] >= 1 ? '#2e3440' : '#9aa5b1');
      else badge(s.cell, TOP(view.terrain[s.cell]) + 1.1, '+2', COLORS[s.owner]);
    }
    for (const a of view.airports) badge(a.cell, TOP(view.terrain[a.cell]) + 1.4, a.active ? '✈' : a.owner ? `✈${a.progress}/3` : '✈', a.active ? COLORS[a.owner] : '#708090');
    for (const d of view.depots) badge(d.cell, TOP(view.terrain[d.cell]) + 1.1, '◇', d.owner && d.supplied ? COLORS[d.owner] : '#b58a2a');
    if (view.neutralWarning) for (const i of view.neutralWarning.cells) badge(i, TOP(view.terrain[i]) + 2.1, '⚠', '#d9a52b', '#2e3440');
  }
  function drawMinimap(now) {
    const rect = mini.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    if (mini.width !== Math.round(rect.width * dpr)) { mini.width = Math.round(rect.width * dpr); mini.height = Math.round(rect.height * dpr); }
    const w = rect.width, h = rect.height, s = Math.min(w / (E.RADIUS * 3.6), h / (E.RADIUS * 3.2));
    mctx.setTransform(dpr, 0, 0, dpr, 0, 0); mctx.clearRect(0, 0, w, h);
    for (let i = 0; i < E.COUNT; i++) {
      const p = view.board[i], t = view.terrain[i];
      mctx.fillStyle = p ? (view.supplied[i] ? COLORS[p] : '#c2263a') : t === 1 ? '#8dbcd6' : t === 2 ? '#c9bd98' : goalOf[i] ? '#cfd6de' : '#e4e9df';
      mctx.fillRect(w / 2 + X[i] * s - s * .8, h / 2 + Z[i] * s - s * .75, s * 1.6, s * 1.5);
    }
    const c = R.camera, cx = w / 2 + c.tx * s, cz = h / 2 + c.tz * s, span = c.dist * .55 * s;
    mctx.strokeStyle = '#2e3440'; mctx.lineWidth = 1.5;
    mctx.beginPath(); mctx.arc(cx, cz, Math.max(4, span), 0, Math.PI * 2); mctx.stroke();
    mctx.beginPath(); mctx.moveTo(cx, cz); mctx.lineTo(cx - Math.sin(c.yaw) * span * 1.4, cz - Math.cos(c.yaw) * span * 1.4); mctx.stroke();
    lastMini = now;
  }

  // ---------- camera ----------
  let tween = null;
  function focusOn(i, dist, instant = false) {
    if (!R || i < 0) return;
    const to = { tx: X[i], tz: Z[i], dist: dist || R.camera.dist };
    // Default camera looks from the faction's home side toward the board centre.
    if (instant) { Object.assign(R.camera, to); R.camera.yaw = homeYaw(); tween = null; return; }
    tween = { from: { tx: R.camera.tx, tz: R.camera.tz, dist: R.camera.dist }, to, start: performance.now(), dur: 450 };
  }
  function homeYaw() { const h = view?.players[subject()]?.home ?? 0; return Math.atan2(X[h], Z[h]); }
  function fitView() { if (!R) return; tween = { from: { tx: R.camera.tx, tz: R.camera.tz, dist: R.camera.dist }, to: { tx: 0, tz: 0, dist: E.RADIUS * 3.6 }, start: performance.now(), dur: 450 }; }
  function frontCell() { const rep = L.supplyReport(view, E, subject()); return rep.frontline >= 0 ? rep.frontline : view.players[subject()].home; }

  // ---------- input ----------
  const pointers = new Map(); let drag = null, gesture = null;
  function local(event) { const r = canvas.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; }
  function cellAt(x, y) {
    if (!R) return -1;
    // Two planes: hills are taller; prefer the nearer intersection that lands on a hill.
    for (const level of [0.8, 0.32, 0.1]) {
      const hit = R.ray(x, y, level); if (!hit) continue;
      const a = L.worldToAxial(hit.x, hit.z), i = E.index(a.q, a.r);
      if (i >= 0 && Math.abs(TOP(view.terrain[i]) - level) < .05) return i;
      if (level === 0.1 && i >= 0) return i;
    }
    const hit = R.ray(x, y, .32); if (!hit) return -1; const a = L.worldToAxial(hit.x, hit.z); return E.index(a.q, a.r);
  }
  canvas.addEventListener('contextmenu', event => event.preventDefault());
  canvas.addEventListener('pointerdown', event => {
    canvas.focus({ preventScroll: true }); canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, local(event));
    if (pointers.size === 1) drag = { start: local(event), last: local(event), moved: false, orbit: event.button === 2 || event.altKey || event.ctrlKey || event.shiftKey };
    else if (pointers.size === 2) { const [a, b] = [...pointers.values()]; gesture = { dist: Math.hypot(a.x - b.x, a.y - b.y), angle: Math.atan2(b.y - a.y, b.x - a.x), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }; if (drag) drag.moved = true; }
  });
  canvas.addEventListener('pointermove', event => {
    const p = local(event);
    if (!pointers.has(event.pointerId)) { const i = cellAt(p.x, p.y); if (i !== hovered) { hovered = i; if (i >= 0) describeCell(i); } return; }
    pointers.set(event.pointerId, p);
    tween = null;
    if (pointers.size === 2 && gesture) {
      const [a, b] = [...pointers.values()], dist = Math.hypot(a.x - b.x, a.y - b.y), angle = Math.atan2(b.y - a.y, b.x - a.x), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      R.camera.dist *= gesture.dist / Math.max(20, dist); R.camera.yaw -= angle - gesture.angle; R.pan(mid.x - gesture.mid.x, mid.y - gesture.mid.y);
      gesture = { dist, angle, mid }; return;
    }
    if (!drag) return;
    const dx = p.x - drag.last.x, dy = p.y - drag.last.y; drag.last = p;
    if (!drag.moved && Math.hypot(p.x - drag.start.x, p.y - drag.start.y) > 6) { drag.moved = true; $('viewport').classList.add('is-dragging'); }
    if (!drag.moved) return;
    if (drag.orbit) { R.camera.yaw -= dx * .008; R.camera.pitch += dy * .006; } else R.pan(dx, dy);
  });
  function endPointer(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (pointers.size < 2) gesture = null;
    if (!pointers.size) {
      $('viewport').classList.remove('is-dragging');
      if (drag && !drag.moved && event.type === 'pointerup' && event.button !== 2) { const p = local(event); pickCell(cellAt(p.x, p.y)); }
      drag = null;
    }
  }
  canvas.addEventListener('pointerup', endPointer); canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', () => { if (!pointers.size) hovered = -1; });
  canvas.addEventListener('wheel', event => {
    event.preventDefault(); if (!R) return; tween = null;
    const p = local(event), before = R.ray(p.x, p.y, .3);
    R.camera.dist *= Math.exp(event.deltaY * .0012); R.update();
    const after = R.ray(p.x, p.y, .3);
    if (before && after) { R.camera.tx += before.x - after.x; R.camera.tz += before.z - after.z; }
  }, { passive: false });
  mini.addEventListener('pointerdown', event => {
    const r = mini.getBoundingClientRect(), s = Math.min(r.width / (E.RADIUS * 3.6), r.height / (E.RADIUS * 3.2));
    const x = (event.clientX - r.left - r.width / 2) / s, z = (event.clientY - r.top - r.height / 2) / s;
    tween = { from: { tx: R.camera.tx, tz: R.camera.tz, dist: R.camera.dist }, to: { tx: x, tz: z, dist: R.camera.dist }, start: performance.now(), dur: 300 };
  });
  const held = new Set();
  const typing = target => target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA');
  document.addEventListener('keydown', event => {
    if (typing(event.target) || event.metaKey || event.ctrlKey) return;
    const k = event.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', '+', '=', '-', '_'].includes(k)) {
      if (k.startsWith('arrow') && document.activeElement !== canvas) return;
      held.add(k); event.preventDefault(); return;
    }
    if (k === ' ' && document.activeElement === canvas || k === 'p') { event.preventDefault(); togglePause(); }
    else if (k === 'escape') { selection = { type: 'deploy', cells: [] }; legalKey = ''; renderAll(); }
    else if (k === 'h') focusOn(view.players[subject()].home, 24);
    else if (k === 'f') focusOn(frontCell(), 22);
    else if (k === 'r' && isHumanTurn()) perform({ type: 'rest', cells: [] });
    else if (/^[1-5]$/.test(k) && mode === 'human') { const index = Number(k) - 1, type = view.hand[index]; if (type) selectAction(type, index); }
    else if (k === 'enter' && document.activeElement === canvas && hovered >= 0) pickCell(hovered);
  });
  document.addEventListener('keyup', event => held.delete(event.key.toLowerCase()));
  window.addEventListener('blur', () => held.clear());
  function applyKeys(dt) {
    if (!held.size || !R) return;
    const speed = dt * .9;
    if (held.has('w') || held.has('arrowup')) R.pan(0, speed);
    if (held.has('s') || held.has('arrowdown')) R.pan(0, -speed);
    if (held.has('a') || held.has('arrowleft')) R.pan(speed, 0);
    if (held.has('d') || held.has('arrowright')) R.pan(-speed, 0);
    if (held.has('q')) R.camera.yaw += dt * .0022;
    if (held.has('e')) R.camera.yaw -= dt * .0022;
    if (held.has('+') || held.has('=')) R.camera.dist *= 1 - dt * .0015;
    if (held.has('-') || held.has('_')) R.camera.dist *= 1 + dt * .0015;
    tween = null;
  }

  // ---------- controls ----------
  function togglePause() {
    if (!game) return;
    flushClock();
    if (game.phase === 'running') { game.pause(); stopTimers(); }
    else if (game.phase === 'paused') { game.start(); }
    else return;
    refresh(); schedule();
  }
  $('play').addEventListener('click', () => { if (game.phase === 'ready') { game.start(); wasStarted = true; $('notice').hidden = true; refresh(); schedule(); } });
  $('pause').addEventListener('click', togglePause);
  $('restart').addEventListener('click', () => reset({ fresh: true, start: false }));
  $('replay').addEventListener('click', () => reset({ keep: true, start: wasStarted }));
  for (const id of ['match-mode', 'human-seat', 'seed', 'starter', 'rotation', 'neutral-events', 'terrain-mode', 'timed-cards', 'expansion']) $(id).addEventListener('change', () => reset());
  $('command-window').addEventListener('change', () => { windowPly = -1; schedule(); });
  $('step-seconds').addEventListener('change', () => schedule());
  $('sandbox').addEventListener('click', () => { if (game.continueSandbox()) { $('result').hidden = true; refresh(); schedule(); } });
  for (const button of document.querySelectorAll('#orders [data-action]')) button.addEventListener('click', () => selectAction(button.dataset.action));
  $('rest').addEventListener('click', () => { if (isHumanTurn()) perform({ type: 'rest', cells: [] }); else if (mode === 'human' && game.phase === 'running') enqueue({ type: 'rest', cells: [] }); });
  $('discard').addEventListener('click', () => { if (selection.cardIndex !== undefined) perform({ type: 'discard', cells: [], cardIndex: selection.cardIndex }); });
  $('back-selection').addEventListener('click', () => { selection.cells.pop(); legalKey = ''; renderAll(); });
  $('cancel-selection').addEventListener('click', () => { selection = { type: 'deploy', cells: [] }; legalKey = ''; renderAll(); });
  $('confirm-selection').addEventListener('click', () => { const action = actionFor(selection.cells.slice()); if (isHumanTurn()) perform(action); else enqueue(action); });
  $('offer').addEventListener('click', () => perform({ type: 'offer', cells: [], target: Number($('diplomacy-target').value) }));
  $('betray').addEventListener('click', () => { if (confirm('背盟會扣 4 分與 2 聲望，並有 18 輪外交冷卻。確定？')) perform({ type: 'betray', cells: [], target: Number($('diplomacy-target').value) }); });
  $('diplomacy-target').addEventListener('change', renderDiplomacy);
  for (const [id, key] of [['layer-supply', 'supply'], ['layer-position', 'position'], ['layer-choke', 'choke'], ['layer-plan', 'plan']]) $(id).addEventListener('click', () => { layers[key] = !layers[key]; $(id).setAttribute('aria-pressed', String(layers[key])); staticDirty = true; });
  $('view-home').addEventListener('click', () => focusOn(view.players[subject()].home, 24));
  $('view-front').addEventListener('click', () => focusOn(frontCell(), 22));
  $('view-fit').addEventListener('click', fitView);
  $('view-rotate').addEventListener('click', () => { if (R) R.camera.yaw += Math.PI / 3; });
  document.addEventListener('visibilitychange', () => { if (document.hidden && game?.phase === 'running') { flushClock(); game.pause(); stopTimers(); refresh(); toast('切換分頁，戰役已暫停。'); } });

  // ---------- main loop ----------
  let lastFrame = performance.now(), lastAnim = lastFrame;
  function frame() {
    requestAnimationFrame(frame);
    // One clock for effects, events and animation (rAF stamps can drift from it).
    const now = performance.now();
    const dt = Math.min(64, now - lastFrame); lastFrame = now;
    // Battlefield animation (shells, blasts, trucks, aircraft) freezes while paused.
    if (game?.phase !== 'paused') animClock += now - lastAnim;
    lastAnim = now;
    if (!game || !view) return;
    flushClock();
    if (isHumanTurn() && commandLimit() && windowPly === game.ply && game.activeMs - windowStart >= commandLimit() * 1000 && !queue.length) {
      stats.autoRests++; toast('指揮時限到：自動休整（+3 能量）。'); perform({ type: 'rest', cells: [] }, 'timeout');
    }
    if (game.phase === 'over' && !resultShown) refresh();
    if (now - lastClockPaint > 120) { paintClock(); lastClockPaint = now; }
    if (!R) return;
    applyKeys(dt);
    if (tween) { const k = Math.min(1, (now - tween.start) / tween.dur), e = 1 - Math.pow(1 - k, 3); for (const key of ['tx', 'tz', 'dist']) R.camera[key] = tween.from[key] + (tween.to[key] - tween.from[key]) * e; if (k >= 1) tween = null; }
    const start = performance.now();
    if (staticDirty || animUntil && animClock > animUntil) buildStatic(animClock);
    const animDt = game.phase === 'paused' ? 0 : Math.min(.064, dt / 1000);
    buildDynamic(animClock, animDt);
    if (R.camera.shake) R.camera.shake = R.camera.shake * Math.exp(-animDt * 6) < .002 ? 0 : R.camera.shake * Math.exp(-animDt * 6);
    const built = performance.now();
    R.draw([staticLayer, dynamicLayer], now, particleLayer);
    drawOverlay();
    if (now - lastMini > 250) drawMinimap(now);
    const end = performance.now();
    stats.frames++; stats.lastFrameMs = end - start; stats.lastBuildMs = built - start;
    stats.frameJs = (stats.frameJs || 0) + (end - start);
  }

  // ---------- test and automation hook (read-only plus explicit commands) ----------
  window.autoHex3D = {
    E, L, stats, get effects() { return effects.map(e => ({ kind: e.kind, age: Math.round(animClock - e.start), dur: e.dur, at: e.at, from: e.from ?? e.plan?.from, to: e.to ?? e.plan?.to, plan: e.plan && { t1: e.plan.t1, t2: e.plan.t2, release: e.plan.release, tf: e.plan.tf, landAt: e.plan.landAt, payload: e.plan.payload } })); }, get particles() { return scene.P.list.length; }, get animClock() { return animClock; },
    get game() { return game; }, get view() { return view; }, get actionLog() { return actionLog; }, get queue() { return queue.slice(); },
    get selection() { return { ...selection, cells: selection.cells.slice() }; }, get legal() { computeLegal(); return [...legal]; },
    get camera() { return R ? { ...R.camera } : null; }, get webgl() { return !!R; }, get human() { return human; }, get mode() { return mode; },
    cellScreen(i) { if (!R) return null; R.update(); const p = R.project(X[i], TOP(view.terrain[i]), Z[i]), r = canvas.getBoundingClientRect(); return p && { x: r.left + p.x, y: r.top + p.y }; },
    focus(i, dist) { focusOn(i, dist, true); }, select: selectAction, pick: pickCell, recipe: () => recipe && { ...recipe }
  };

  reset();
  requestAnimationFrame(frame);
})();
