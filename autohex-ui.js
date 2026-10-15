/* Shared Hex presentation. All rules, partial selection and spending stay in HexCore. */
(() => {
  'use strict';
  const normal = document.body.dataset.hexMode === 'normal';
  let E = normal ? window.CardHex : window.AutoHex;
  const S = window.HexStrategies;
  const V = window.AutoHexVisuals;
  const Snap = window.AutoHexSnapshot;
  const $ = id => document.getElementById(id);
  if (!E || !V || !S || !window.HexCore) { $('status').textContent = '戰場載入失敗，請重新整理此頁。'; return; }
  const canvas = $('board'), mainContext = canvas.getContext('2d');
  let ctx = mainContext;
  const boardLayer = document.createElement('canvas'), frontLayer = document.createElement('canvas');
  for (const layer of [boardLayer, frontLayer]) { layer.lang = document.documentElement.lang; layer.dir = document.documentElement.dir || 'ltr'; }
  const boardContext = boardLayer.getContext('2d'), frontContext = frontLayer.getContext('2d');
  const renderCache = { valid: false, rebuilds: 0, composites: 0, minimaps: 0 };
  const mini = $('minimap'), mctx = mini.getContext('2d');
  let P = E.PLAYERS;
  const COLORS = ['', '#267477', '#a65e46', '#84618c', '#4d739e', '#668047', '#ad7b23'];
  const TINTS = ['', '#e2f1ef', '#f4e5df', '#eee5f1', '#e3ebf4', '#eaf0df', '#f7edda'];
  const NAMES = ['', '青綠', '珊瑚', '紫藤', '藍灰', '草綠', '琥珀'];
  const LETTER = p => String.fromCharCode(64 + p);
  const PLAN_TYPES = { direct: '接通對岸', flank: '側翼繞行', airport: '建立航空支點', interdict: '切斷敵方補給', defend: '處理連線威脅', recover: '修復家園補給', fortify: '加固補給線', expand: '搶占物資站' };
  const PLAN_STAGES = { approach: '接近目標', build: '建立支點', hold: '持續維持', project: '延伸前線', advance: '向前推進', repair: '修補斷線' };
  const PLAN_REASONS = { breakthrough: '公開預告突破格，下一次己方行動攻占，將缺口接入家園連線。', short_route: '沿較短路線接通對岸。', less_contested: '先從側翼繞行，再轉向對岸。', airport_projection: '取得能支援前線的機場，再延伸連線。', cut_supply: '爭取敵方補給要點，打斷它的連線。', protect_connection: '保護已接通的路線，繼續取得守線分數。', restore_supply: '補回家園連線，保住失去補給的棋子。', continue_plan: '沿已選定的路線繼續推進。', route_blocked: '原路線受阻，正在調整推進方向。', stalled: '先前進展停滯，重新選擇突破方向。', opportunity_changed: '公開戰況改變，調整下一段目標。', goal_reached: '已完成這段目標，準備下一段推進。', urgent_threat: '優先打斷敵方即將完成或持續得分的連線。', open_lane: '避開擁擠的中央，改走較空的航道接通對岸。', raid_supply: '深入襲擊敵方細長的補給線，讓後方棋子斷補撤退。', thin_supply: '補給線只靠單格相連，先加寬或架設保護。', claim_depot: '搶占物資站，累積空中行動所需物資。' };
  const LABELS = { breach: '破陣令', 'breach-ready': '破陣令就緒', deploy: '鋪子 / 攻占', engineer: '工程', tunnel: '地道', withdraw: '撤回', rest: '休整', turret: '炮台', destroy: '拆除', bridge: '橋梁', reroute: '改接', shield: '護盾', exchange: '換位', discard: '棄牌', offer: '提議停戰', accept: '接受停戰', reject: '拒絕停戰', betray: '背盟', ready: '戰場就緒' };
  Object.assign(LABELS, { 'game-end': '本局結算', 'hill-retreat': '山丘撤退', 'card-expired': '手牌到期', 'tunnel-collapse': '地道崩塌', airdrop: '空投炮台', bombard: '航空轟炸', 'airport-unlocked': '機場啟用', 'airport-lost': '機場停用', 'depot-control': '物資站易主', fortified: '老兵工事完成' });
  const MARKS = { turret: '✣', destroy: '×', bridge: '⌁', reroute: '↗', shield: '◎', exchange: '⇄' };
  const HINTS = { breach: '一次性儲備卡：花 6 能量預告一枚與補給線相鄰、向對岸前進的敵格。下一次己方行動用「鋪子 / 攻占」花 4 能量強攻，忽略鄰援強度；護盾或斷補可阻止加成。改做其他事即失效。', deploy: '空格鋪子花 2 能量，攻占敵子花 4；攻占須有足夠相鄰支援。河流先工程整地。', engineer: '將河流或空／己方山丘變為白色平地；也可拆掉敵方可見地道的內部格。', tunnel: '從自己的棋子出發，逐格選 3–4 格相鄰路徑；可轉彎，最後回到另一枚自己的棋子，再按完成。', withdraw: '選自己的非家園棋子撤回，移除其設施並回復 1 能量。', turret: '選自己的非家園棋子架炮台。每 3 次自己回合射擊，射程 3 格。', destroy: '選敵方非家園棋子拆除；護盾可吸收一次拆除，山丘無法抵擋。', bridge: '依序選兩個自己的端點，相距 2–3 格直線；橋梁運送補給。', reroute: '依序選保留端點、舊端點、新端點；三格都是自己的棋子。', shield: '選自己的非家園棋子，加 2 防守並吸收一次拆除或炮擊。', exchange: '先選自己的普通棋子，再選相鄰的空格或敵方普通棋子。' };
  Object.assign(HINTS, { airdrop: '先選已啟用的己方機場，再選機場 10 格內空的可通行格空投炮台。花 6 能量、3 物資。', bombard: '先選已啟用的己方機場，再選機場 12 格內敵方非家園棋子。花 7 能量、4 物資。' });
  const CARD_GUIDE = {
    turret: '在自己既有的非家園棋子架設炮台；每 3 次自己的回合，射擊 3 格內一個非盟友敵子，持續 30 回合。最多同時 3 座。護盾會吸收一次炮擊。',
    destroy: '拆除自己 5 格範圍內的敵方棋子。不能拆家園或盟友；護盾會吸收一次拆除，山丘不抵擋拆除。',
    bridge: '選兩個既有己方端點，相距 2–3 格直線。橋梁可傳遞補給；不可交叉、重疊、重複或形成 T 型接點，可共用端點。',
    reroute: '依序選既有橋梁的保留端點、舊另一端點，再選新己方端點。重新接橋後仍須相距 2–3 格直線，且符合全部橋梁碰撞限制。',
    shield: '保護一個自己的非家園棋子，持續 8 次自己的回合。防守力 +2；吸收一次拆除或炮擊後消失。',
    exchange: '將一個自己的普通棋子，與相鄰空格或非盟友敵方普通棋子互換。雙方不能是家園、炮台或橋梁端點；河流須先工程轉為平地，兩格都須在行動前的自己 5 格範圍內。'
  };
  const FALLBACK = { deploy: { cost: 2, slots: 1 }, engineer: { cost: 2, slots: 1 }, withdraw: { cost: 0, slots: 1 }, rest: { cost: 0, slots: 0 } };
  let points = E.CELLS.map(c => ({ x: Math.sqrt(3) * (c.q + c.r / 2), y: 1.5 * c.r }));
  let bounds = { minX: Math.min(...points.map(c => c.x)) - 2, maxX: Math.max(...points.map(c => c.x)) + 2, minY: Math.min(...points.map(c => c.y)) - 2, maxY: Math.max(...points.map(c => c.y)) + 2 };
  const camera = { x: 0, y: 0, scale: 1, fit: 1, width: 1, height: 1 };
  let seats = [], revealedHuman = 0, handoffPly = -1, strategyConfig = S.normalize(S.DEFAULT_CONFIG);
  let game, view, recipe, mode = 'human', selection = { type: 'deploy', cells: [] };
  let hovered = -1, focused = -1, message = '', error = false, generation = 0;
  let aiTimer = null, frame = null, timing = false, lastStamp = 0, lastClockPaint = 0;
  let wasStarted = false, rangeValid = new Set(), lastViewTurn = null;
  const chronicle = Snap ? new Snap.Chronicle() : null;
  let snapshotUrl = null;
  const effects = new V.Effects(), reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
  let supplyLinks = [], inspectedCell = -1, inspectedRange = null, inspectMode = false, airRangeCells = [];
  let cutEnabled = false, cutPreview = null;
  let lastEffectPaint = 0, effectsDirty = false;
  let plannerChoice = '2', displayedPlan = null;
  const planningTiming = { count: 0, lastMs: 0, lastLatencyMs: 0, lastMode: null, maxMs: 0, totalMs: 0, workerCount: 0, synchronousCount: 0, recentMs: [] };
  let aiWorker = null, pendingDecision = null, decisionSerial = 0, workerFailed = false;
  const pointers = new Map();
  let drag = null, pinch = null, dragged = false;
  const meta = type => E.CARD_META[type] || E.ACTION_META?.[type] || FALLBACK[type] || { cost: 0, slots: 1 };
  const label = type => LABELS[type] || meta(type).label || type;
  const localName = p => `${LETTER(p)} ${NAMES[p]}`;
  const humanSeats = () => P.filter(p => seats[p - 1]?.control === 'human');
  const isAiTurn = () => seats[game.turn - 1]?.control === 'ai';
  const observer = () => humanSeats().length === 1 ? humanSeats()[0] : (revealedHuman === game.turn ? revealedHuman : 0);
  const isHumanTurn = () => game.phase === 'running' && !isAiTurn() && observer() === game.turn;
  const terrainIs = (v, type) => v === type || v === ({ river: 1, hill: 2, plain: 0 })[type];
  const node = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
  const cutButton = node('button', 'btn', '斷補預覽');
  cutButton.id = 'supply-cut'; cutButton.type = 'button'; cutButton.setAttribute('aria-pressed', 'false');
  $('clear-inspection').after(cutButton);
  const cutInfo = node('p', 'ah-turret-info'); cutInfo.id = 'supply-cut-info'; cutInfo.hidden = true;
  cutInfo.setAttribute('role', 'status'); $('cell-info').before(cutInfo);
  const breachButton=node('button','btn','破陣令');breachButton.id='breach';breachButton.type='button';breachButton.dataset.action='breach';$('base-actions').append(breachButton);
  const breachNote=node('p','ah-meta');breachNote.id='breach-note';breachNote.setAttribute('role','status');$('supplies').after(breachNote);
  const can = action => E.legalAction(view, { cells: [], ...action });
  const actionFor = cells => ({ type: selection.type, cells, ...(selection.cardIndex !== undefined ? { cardIndex: selection.cardIndex } : {}) });
  const isAirAction = () => selection.type === 'airdrop' || selection.type === 'bombard';
  function recordPlanning(elapsed, latency, mode) {
    planningTiming.count++; planningTiming.lastMs = elapsed; planningTiming.maxMs = Math.max(planningTiming.maxMs, elapsed); planningTiming.totalMs += elapsed;
    planningTiming.lastLatencyMs = latency; planningTiming.lastMode = mode;
    if (mode === 'worker') planningTiming.workerCount++; else planningTiming.synchronousCount++;
    planningTiming.recentMs.push(elapsed); if (planningTiming.recentMs.length > 256) planningTiming.recentMs.shift();
  }
  function chooseAiAction(observation, mode = 'single-step') {
    const start = performance.now(), action = E.chooseAction(observation), elapsed = performance.now() - start;
    recordPlanning(elapsed, elapsed, mode);
    return action;
  }
  function currentDecision(job) { return job.generation === generation && job.ply === game.ply && job.turn === game.turn && game.phase === 'running' && !document.hidden; }
  function cancelAiWork() {
    if (!pendingDecision) return;
    const job = pendingDecision; pendingDecision = null;
    aiWorker?.terminate(); aiWorker = null; job.reject({ cancelled: true });
  }
  function ensureAiWorker() {
    if (aiWorker || workerFailed || typeof Worker !== 'function') return aiWorker;
    try {
      const worker = new Worker('autohex-ai-worker.js'); aiWorker = worker;
      worker.addEventListener('message', event => {
        if (worker !== aiWorker) return;
        const result = event.data, job = pendingDecision;
        if (!job || !result || !['id', 'generation', 'ply', 'turn'].every(key => result[key] === job[key])) return;
        pendingDecision = null;
        if (!currentDecision(job)) { job.reject({ cancelled: true }); return; }
        if (result.type !== 'decision' || !Number.isFinite(result.computeMs)) { workerFailed = true; worker.terminate(); aiWorker = null; job.reject(new Error(result.message || 'AI decision failed')); return; }
        recordPlanning(result.computeMs, performance.now() - job.started, 'worker'); job.resolve(result.action);
      });
      worker.addEventListener('error', event => {
        event.preventDefault(); if (worker !== aiWorker) return;
        workerFailed = true; worker.terminate(); aiWorker = null;
        const job = pendingDecision; pendingDecision = null; job?.reject(new Error('AI worker unavailable'));
      });
    } catch (_) { workerFailed = true; aiWorker = null; }
    return aiWorker;
  }
  function requestAiAction(observation, token) {
    const worker = ensureAiWorker();
    if (!worker) return Promise.resolve(chooseAiAction(observation, 'fallback'));
    return new Promise((resolve, reject) => {
      const job = { id: ++decisionSerial, generation: token, ply: observation.ply, turn: observation.turn };
      pendingDecision = { ...job, started: performance.now(), resolve, reject };
      try { worker.postMessage({ type: 'choose', ...job, observation }); }
      catch (error) { pendingDecision = null; worker.terminate(); aiWorker = null; workerFailed = true; reject(error); }
    });
  }

  function configureGeometry() {
    E = window.HexCore.create({ mode: normal ? 'normal' : 'auto', playerCount: normal ? Number($('seat-count').value) : 6 });
    P = E.PLAYERS; points = E.CELLS.map(c => ({ x: Math.sqrt(3) * (c.q + c.r / 2), y: 1.5 * c.r }));
    bounds = { minX: Math.min(...points.map(c => c.x)) - 2, maxX: Math.max(...points.map(c => c.x)) + 2, minY: Math.min(...points.map(c => c.y)) - 2, maxY: Math.max(...points.map(c => c.y)) + 2 };
    window.HexAPI = E; renderCache.valid = false;
  }
  function seatControls(preset) {
    const count = normal ? Number($('seat-count').value) : 6;
    const old = Array.from($('seat-settings').children).map((_, i) => ({ control: $(`seat-control-${i + 1}`).value, strategy: $(`seat-profile-${i + 1}`).value }));
    $('seat-settings').replaceChildren(...Array.from({ length: count }, (_, i) => {
      const p = i + 1, row = node('div', 'ah-seat'); row.style.setProperty('--faction', COLORS[p]);
      const name = node('strong', '', localName(p));
      const control = node('select'); control.id = `seat-control-${p}`; control.setAttribute('aria-label', `${localName(p)} 操作方式`);
      for (const [value, title] of [['human', '本機玩家'], ['ai', '本機 AI']]) { const o = node('option', '', title); o.value = value; control.append(o); }
      control.value = preset === 'spectator' ? 'ai' : preset === 'allhuman' ? 'human' : preset === 'human' ? (i ? 'ai' : 'human') : old[i]?.control || (i ? 'ai' : 'human');
      control.disabled = !normal;
      const profile = node('select'); profile.id = `seat-profile-${p}`; profile.setAttribute('aria-label', `${localName(p)} AI 策略`);
      for (const strategy of strategyConfig.profiles) { const o = node('option', '', strategy.name); o.value = strategy.id; profile.append(o); }
      profile.value = strategyConfig.profiles.some(v => v.id === old[i]?.strategy) ? old[i].strategy : strategyConfig.profiles[(i + Number($('rotation').value)) % strategyConfig.profiles.length].id;
      profile.disabled = control.value !== 'ai';
      control.addEventListener('change', () => { $('match-mode').value = 'local'; profile.disabled = control.value !== 'ai'; reset(); });
      profile.addEventListener('change', () => reset()); row.append(name, control, profile); return row;
    }));
    const first = Number($('starter').value) || 1;
    $('starter').replaceChildren(...Array.from({ length: count }, (_, i) => { const o = node('option', '', localName(i + 1)); o.value = i + 1; return o; }));
    $('starter').value = Math.min(first, count);
  }
  function readRecipe() {
    seats = Array.from({ length: normal ? Number($('seat-count').value) : 6 }, (_, i) => ({ control: $(`seat-control-${i + 1}`).value, strategy: $(`seat-profile-${i + 1}`).value }));
    return { seed: $('seed').value.trim() || 'hex-2026', first: Number($('starter').value), rotation: Number($('rotation').value), durationMs: 600000, neutralEvents: $('neutral-events').value !== 'off', terrain: $('terrain-mode').value === 'plain' ? 'classic' : 'seeded', timedCards: $('timed-cards').value === 'timed', strategyConfig: S.normalize(strategyConfig), strategyIds: seats.map(s => s.strategy), uiSeats: seats.map(s => ({ ...s })), playerCount: seats.length };
  }
  function renderHandoff() {
    if (humanSeats().length > 1 && (revealedHuman !== game.turn || handoffPly !== game.ply)) revealedHuman = 0;
    const waiting = humanSeats().length > 1 && !isAiTurn() && game.phase === 'running' && !revealedHuman;
    const wasHidden = $('handoff').hidden; $('handoff').hidden = !waiting; document.querySelector('main').inert = waiting;
    if (waiting) { $('handoff-title').textContent = `請交給 ${localName(game.turn)}`; $('reveal-hand').textContent = `顯示 ${LETTER(game.turn)} 的手牌`; if (wasHidden) $('reveal-hand').focus({ preventScroll: true }); }
  }
  function applyStrategy(input) {
    try { const next = S.normalize(input); strategyConfig = next; $('strategy-json').value = JSON.stringify(next, null, 2); $('strategy-id').textContent = S.id(next); $('strategy-status').textContent = `驗證成功 · ${next.profiles.length} 個策略`; $('strategy-status').classList.remove('error'); seatControls(); reset(); }
    catch (error) { $('strategy-status').textContent = error.message; $('strategy-status').classList.add('error'); }
  }
  function flushClock(now = performance.now()) {
    // A RAF timestamp is captured before its callback runs. Timer work can have
    // already advanced the clock beyond it; never move our time origin backward.
    const nextStamp = Math.max(lastStamp, now);
    if (timing && game?.phase === 'running') {
      const before = game.activeMs;
      game.advanceTime(nextStamp - lastStamp);
      effectsDirty = effects.advance(game.activeMs - before) || effectsDirty;
    }
    lastStamp = nextStamp;
  }
  function stopTimers() {
    generation++;
    cancelAiWork();
    clearTimeout(aiTimer); aiTimer = null;
    cancelAnimationFrame(frame); frame = null;
    timing = false;
  }
  function schedule() {
    flushClock(); stopTimers();
    if (game.phase !== 'running' || document.hidden) { paintClock(); return; }
    const token = generation;
    timing = true; lastStamp = performance.now();
    const tick = now => {
      if (token !== generation) return;
      if (document.hidden || game.phase !== 'running') { stopTimers(); paintClock(); return; }
      // Count actual foreground time, including AI/render work in this frame.
      flushClock();
      if (now - lastClockPaint > 100) { paintClock(); lastClockPaint = now; }
      if (effectsDirty && now - lastEffectPaint >= 33) {
        // Effects share this clock. No DOM rebuilds, independent timers or AI delays.
        if (!reducedQuery.matches || !effects.effects.length) draw(true);
        effectsDirty = false; lastEffectPaint = now;
      }
      if (game.phase === 'over') { stopTimers(); render(); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    if (isAiTurn()) {
      const seconds = Math.max(.05, Math.min(10, Number($('step-seconds').value) || .3));
      aiTimer = setTimeout(async () => {
        aiTimer = null;
        if (token !== generation || document.hidden || game.phase !== 'running') return;
        flushClock();
        if (game.phase === 'running') {
          const observation = game.observation(game.turn), job = { generation: token, ply: game.ply, turn: game.turn };
          let action;
          try { action = await requestAiAction(observation, token); }
          catch (reason) { if (reason?.cancelled || !currentDecision(job)) return; action = chooseAiAction(observation, 'fallback'); }
          if (!currentDecision(job)) return;
          flushClock(); if (game.phase !== 'running') { render(); schedule(); return; }
          if (!action || !game.act(action)) game.act({ type: 'rest', cells: [] });
          message = ''; error = false;
        }
        render(); schedule();
      }, seconds * 1000);
    }
  }
  function reset({ fresh = false, start = false } = {}) {
    stopTimers();
    if (fresh) $('seed').value = `hex-${Math.random().toString(36).slice(2, 9)}`;
    configureGeometry(); recipe = readRecipe();
    mode = humanSeats().length ? 'human' : 'spectator';
    revealedHuman = 0; handoffPly = -1;
    plannerChoice = String(P.find(p => seats[p - 1].control === 'ai') || 'off'); displayedPlan = null;
    game = new E.Game(recipe); window.autoHexGame = window.hexGame = game;
    $('supply-mode').replaceChildren(...['all', 'off', ...P].map(value => { const o = node('option', '', value === 'all' ? '全部陣營' : value === 'off' ? '關閉' : localName(value)); o.value = value; return o; }));
    $('cell-count').textContent = `${E.COUNT.toLocaleString()} 格`;
    chronicle?.clear(); effects.clear(); effectsDirty = false; inspectedCell = -1; inspectedRange = null; inspectMode = false; cutEnabled = false; cutPreview = null;
    planningTiming.count = 0; planningTiming.lastMs = 0; planningTiming.lastLatencyMs = 0; planningTiming.lastMode = null; planningTiming.maxMs = 0; planningTiming.totalMs = 0; planningTiming.workerCount = 0; planningTiming.synchronousCount = 0; planningTiming.recentMs.length = 0;
    selection = { type: 'deploy', cells: [] }; hovered = -1; focused = -1;
    lastViewTurn = null; message = ''; error = false; wasStarted = start;
    if (start) game.start();
    render(); resize(); fitMap();
    if (start && mode === 'human' && innerWidth <= 520) focusHome();
    schedule();
  }
  function paintClock() {
    if (normal) { const count = Math.max(...P.map(p => game.players[p].completedActions || 0)); $('clock').textContent = `${count} / 100`; $('clock').setAttribute('aria-label', '已完成己方行動與上限'); $('clock-note').textContent = game.phase === 'over' ? '本局已結算' : game.phase === 'paused' ? '已暫停' : '先接通對岸獲勝'; $('campaign-progress').setAttribute('aria-valuemax', '100'); $('campaign-progress').setAttribute('aria-label', '己方行動上限'); $('campaign-progress').setAttribute('aria-valuenow', String(count)); $('campaign-progress-fill').style.width = `${Math.min(100, count)}%`; return; }
    const left = Math.max(0, game.durationMs - game.activeMs);
    const seconds = Math.ceil(left / 1000);
    $('clock').textContent = game.sandbox ? '∞' : `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
    $('campaign-progress-fill').style.width = `${Math.min(100, game.activeMs / game.durationMs * 100)}%`;
    $('campaign-progress').setAttribute('aria-valuenow', String(Math.min(600, Math.floor(game.activeMs / 1000))));
    $('clock-note').textContent = game.sandbox ? '自由對戰 · 不限時' : game.phase === 'paused' ? '已暫停 · 時間凍結' : game.phase === 'over' ? '十分鐘戰役已結算' : game.phase === 'running' ? '前景進行中 · 思考也計時' : '前景、未暫停才計時';
  }
  function render() {
    renderHandoff();
    view = game.observation(observer());
    effects.ingest(view.events, game.activeMs); chronicle?.record(view);
    supplyLinks = V.supplyForest(view, E.ADJ);
    inspectedRange = V.inspectTurret(view, inspectedCell, E.CELLS, E.distance);
    if (!cutEnabled && !inspectedRange && !(view.airports || []).some(a => a.cell === inspectedCell) && !(view.depots || []).some(d => d.cell === inspectedCell)) inspectedCell = -1;
    paintInspection();
    if (lastViewTurn !== game.turn || !isHumanTurn()) { selection.cells = []; if (!isHumanTurn()) selection = { type: 'deploy', cells: [] }; }
    lastViewTurn = game.turn;
    if (selection.cardIndex !== undefined && view.hand[selection.cardIndex] !== selection.type) selection = { type: 'deploy', cells: [] };
    const running = game.phase === 'running', paused = game.phase === 'paused', ready = game.phase === 'ready';
    $('phase-label').textContent = ready ? '準備出發' : paused ? '戰役已暫停' : game.phase === 'over' ? '戰役已結算' : game.sandbox ? '自由對戰' : mode === 'human' ? (normal ? '本機 Hex 對戰' : '你的六方戰役') : `${P.length} 方 AI 觀戰`;
    $('play').hidden = !ready;
    $('pause').disabled = ready || game.phase === 'over'; $('pause').textContent = paused ? '繼續' : '暫停';
    if ($('snapshot')) $('snapshot').disabled = ready || !chronicle;
    $('step').disabled = mode !== 'spectator' || running || game.phase === 'over';
    for (const el of $('setup').querySelectorAll('input,select,textarea,button')) el.disabled = !ready && game.phase !== 'over';
    for (const p of P) { $(`seat-control-${p}`).disabled ||= !normal; $(`seat-profile-${p}`).disabled ||= seats[p - 1].control !== 'ai'; }
    $('round-count').textContent = `第 ${game.round} 輪`;
    $('turn-count').textContent = `${game.ply.toLocaleString()} 次行動`;
    $('turn-label').textContent = ready ? '等待開局' : game.phase === 'over' ? '最終排名已出爐' : `${localName(game.turn)}${!isAiTurn() ? ' · 你' : ' · AI'} 行動`;
    $('turn-label').style.color = COLORS[game.turn]; $('turn-label').style.background = TINTS[game.turn];
    const notice = $('map-notice'); notice.hidden = running;
    notice.classList.toggle('is-paused', paused);
    if (!running) {
      notice.children[0].textContent = ready ? `${P.length} 個家園，各自接通對岸` : paused ? '已暫停 · 地圖仍可查看' : normal ? '本局已結算' : '十分鐘到，戰役結算';
      notice.children[1].textContent = ready ? `按「${normal ? '開始連線' : '開始戰役'}」，從家園向同色對岸出發。` : paused ? '時間與 AI 都已停下；仍可移動地圖查看前線。' : normal ? '查看本局结果，或重新開始一局。' : '查看最終排名，或繼續不限時的自由對戰。';
    }
    $('home-view').textContent = mode === 'human' ? '我的家園' : '目前家園';
    $('show-range').disabled = mode !== 'human';
    renderPlayers(); renderActions(); renderFacilities(); renderDiplomacy(); renderEvents(); renderResult(); renderPlanner();
    paintClock(); computeLegalTargets(); draw();
  }
  function directionAt(i) {
    const c = points[i]; if (!c) return '';
    const a = Math.atan2(c.y, c.x) * 180 / Math.PI;
    if (a < -120) return '西北'; if (a < -60) return '北'; if (a < 0) return '東北';
    if (a < 60) return '東南'; if (a < 120) return '南'; return '西南';
  }
  function goalPoint(p) {
    const player = view.players[p], goalCells = E.CELLS.filter(c => c[player.axis] === -player.sign * E.RADIUS);
    if (!goalCells.length) return { x: -points[player.home].x, y: -points[player.home].y };
    return { x: goalCells.reduce((s, c) => s + points[c.i].x, 0) / goalCells.length, y: goalCells.reduce((s, c) => s + points[c.i].y, 0) / goalCells.length };
  }
  function renderPlayers() {
    const fragment = document.createDocumentFragment();
    for (const p of P) {
      const player = view.players[p], el = node('article', `ah-faction${game.turn === p && game.phase !== 'ready' ? ' current' : ''}`);
      el.id = `player-${p}`; el.style.setProperty('--faction', COLORS[p]); el.style.setProperty('--faction-tint', TINTS[p]);
      const top = node('div', 'ah-faction-top'); top.append(node('span', 'ah-faction-letter', LETTER(p)), node('span', '', `${NAMES[p]}${seats[p - 1].control === 'human' ? ' / 玩家' : ' AI'}`));
      const score = node('div', 'ah-faction-score'); score.append(node('strong', '', player.score || 0), node('span', '', '分'));
      const count = view.board.reduce((n, owner) => n + (owner === p ? 1 : 0), 0);
      const goal = goalPoint(p), gi = points.reduce((best, c, i) => Math.hypot(c.x - goal.x, c.y - goal.y) < Math.hypot(points[best].x - goal.x, points[best].y - goal.y) ? i : best, 0);
      el.append(top, score, node('small', 'ah-direction', `⌂ ${directionAt(player.home)} → ${directionAt(gi)}`), node('small', '', `能量 ${player.energy}/8 · 棋子 ${count}/96`), node('small', '', `物資 ${player.supplies || 0}/6 · 手牌 ${view.handCounts?.[p] || 0}/5${player.goalActive ? ' · 已接通' : ''}`));
      el.append(node('small','',player.breachTarget>=0?`⚑ 破陣預告 #${player.breachTarget} · 下次行動有效`:player.breachReady?'⚑ 破陣令可用':player.breachUsed?'破陣令已用':'破陣令待解鎖'));
      fragment.append(el);
    }
    $('players').replaceChildren(fragment);
  }
  function publicPlan(player) {
    const intent = view.intents?.[player];
    if (!intent || intent.player !== player || !PLAN_TYPES[intent.type]) return null;
    const validCell = i => Number.isInteger(i) && !!points[i];
    // Explicitly whitelist public commitment fields; plannerMemory and future
    // card-dependent choices never enter presentation or debug snapshots.
    return { player, type: intent.type, stage: PLAN_STAGES[intent.stage] ? intent.stage : '', target: validCell(intent.target) ? intent.target : null,
      path: Array.isArray(intent.path) ? intent.path.filter(validCell).slice(0, 16) : [], reasonCode: typeof intent.reasonCode === 'string' ? intent.reasonCode : '',
      committedAtPly: Number.isFinite(intent.committedAtPly) ? intent.committedAtPly : null, reviewAtPly: Number.isFinite(intent.reviewAtPly) ? intent.reviewAtPly : null,
      progress: Math.max(0, Math.min(1, Number(intent.progress) || 0)), completed: intent.completed === true, stalled: Math.max(0, Math.min(12, Math.floor(Number(intent.stalled) || 0))) };
  }
  function renderPlanner() {
    const select = $('plan-faction'), allowed = P.filter(p => seats[p - 1].control === 'ai'), optionKey = `${mode}:${allowed.join(',')}`;
    if (select.dataset.options !== optionKey) {
      select.replaceChildren(...allowed.map(p => { const option = node('option', '', `${localName(p)} AI`); option.value = p; return option; }), node('option', '', '關閉路線'));
      select.lastElementChild.value = 'off'; select.dataset.options = optionKey;
    }
    if (plannerChoice !== 'off' && !allowed.includes(Number(plannerChoice))) plannerChoice = String(allowed[0] || 'off');
    select.value = plannerChoice;
    const player = plannerChoice === 'off' ? null : Number(plannerChoice);
    displayedPlan = player ? publicPlan(player) : null;
    const panel = $('planner-panel'), plan = displayedPlan;
    panel.style.setProperty('--plan-color', COLORS[player] || '#657283'); panel.classList.toggle('is-off', !player);
    $('plan-focus').disabled = plan?.target === null || !plan;
    $('plan-progress').hidden = !plan; $('plan-detail').hidden = false;
    $('plan-legend').hidden = !plan;
    if (!plan) {
      $('plan-title').textContent = player ? `${localName(player)} · 等待首次決策` : '策略路線已關閉';
      $('plan-stage').textContent = player ? '尚未建立策略' : '戰役照常進行';
      $('plan-reason').textContent = player ? '這位 AI 出手後，會顯示它已選定的公開策略。' : '選擇一位 AI，可查看它的路線、目標與進展。';
      $('plan-progress-text').textContent = player ? '先觀察它的第一次行動' : '不影響出手速度';
      $('plan-progress-fill').style.width = '0%'; $('plan-progress').setAttribute('aria-valuenow', '0');
      return;
    }
    const percent = Math.round(plan.progress * 100), reconsidering = ['route_blocked', 'stalled', 'opportunity_changed'].includes(plan.reasonCode);
    $('plan-title').textContent = `${localName(player)} · ${PLAN_TYPES[plan.type]}`;
    $('plan-stage').textContent = reconsidering ? '重新評估' : plan.completed ? '目標達成' : plan.stage === 'hold' && plan.type === 'airport' ? '維持機場條件' : PLAN_STAGES[plan.stage] || '持續執行';
    $('plan-reason').textContent = PLAN_REASONS[plan.reasonCode] || '依目前公開戰況執行已選定的路線。';
    $('plan-progress-fill').style.width = `${percent}%`; $('plan-progress').setAttribute('aria-valuenow', String(percent));
    const reviewDue = !plan.completed && plan.reviewAtPly !== null && view.ply >= plan.reviewAtPly;
    $('plan-progress-text').textContent = `目標進展 ${percent}%${plan.stalled ? ` · 計畫 ${plan.stalled} 次未推進` : ''}${reviewDue ? ' · 下一回合檢視' : game.phase === 'paused' ? ' · 已暫停' : game.phase === 'over' ? ' · 戰役已結算' : ''}`;
  }
  function statusText() {
    if (message) return message;
    if (game.phase === 'ready') return mode === 'human' ? '各方從 ⌂ 家園向同色對岸推進。先設定本機座位，再開始對戰。' : `${P.length} 位本機 AI 獨立競爭；可自由巡看、暫停或單步。`;
    if (game.phase === 'paused') return '已暫停。可查看戰場；按「繼續」恢復計時與出手。';
    if (game.phase === 'over') return normal ? '本局已完成；接通對岸的陣營勝出，達行動上限則依分數結算。' : '戰役已完成。排名依各方分數計算；可繼續自由對戰。';
    if (mode === 'spectator') return `${localName(game.turn)} AI 思考中。手牌不公開；可調整 AI 每步間隔或暫停。`;
    if (isAiTurn()) return `${localName(game.turn)} AI 行動中。輪到本機玩家後即可出手。`;
    if (!observer()) return '請交接裝置，再顯示這位玩家的手牌。';
    return `${HINTS[selection.type] || meta(selection.type).description || '請選擇目標。'}${selection.cells.length ? ` 已選 ${selection.cells.length}/${meta(selection.type).variableSlots ? '3–4' : meta(selection.type).slots} 格。` : ''}`;
  }
  function renderActions() {
    const yourTurn = isHumanTurn(), human = !!observer(), p = observer();
    $('action-heading').textContent = human ? '你的回合工具' : '觀戰資訊';
    $('energy').textContent = human ? `能量 ${view.players[observer() || game.turn].energy} / 8` : `${P.length} 位本機 AI`;
    const resourcePlayer = human ? p : game.turn, resources = view.players[resourcePlayer];
    $('supplies').textContent = `${human ? '' : LETTER(resourcePlayer) + ' · '}物資 ${resources.supplies || 0} / 6 · 航空冷卻 ${resources.airCooldown || 0} 次己方行動`;
    const tactics=view.strategyConfig.tactics;
    breachNote.textContent=resources.breachTarget>=0?`⚑ 已公開標記 #${resources.breachTarget}：下一次己方行動用「鋪子 / 攻占」，否則失效。護盾或斷補可反制。`:resources.breachUsed?'本局唯一破陣令已使用。':resources.breachReady?'⚑ 破陣令已取得：6 能量預告一格；下一次己方行動 4 能量攻占。':`一次性破陣令：完成 ${tactics.breachMinOwnTurns} 次己方行動，且連續 ${tactics.breachStalledOwnTurns} 次未刷新最接近對岸的補給紀錄，首次連通前取得。現為 ${resources.completedActions}/${tactics.breachMinOwnTurns} 行動、停滯 ${resources.breachStalled}/${tactics.breachStalledOwnTurns}。`;
    $('air-actions').hidden = !human;
    const activeAirports = (view.airports || []).filter(a => a.owner === observer() && a.active);
    for (const type of ['airdrop', 'bombard']) {
      const m = E.ACTION_META?.[type], button = $(type);
      button.disabled = !yourTurn || !m || !activeAirports.length || resources.energy < m.cost || resources.supplies < m.supplyCost || resources.airCooldown > 0;
      button.setAttribute('aria-pressed', String(selection.type === type));
    }
    $('air-action-note').textContent = human ? activeAirports.length ? `已有 ${activeAirports.length} 座可用機場；先選機場再選目標，不需手牌。` : '可啟用有利於連線的機場，再空投或轟炸；主目標仍是接通對岸。' : '航空出手與物資都是公開的；查看支援據點可追蹤機場進度。';
    $('status').textContent = statusText(); $('status').classList.toggle('error', error);
    $('base-actions').hidden = !human; $('selection').hidden = !human; $('hand').previousElementSibling.hidden = !human; $('discard-card').parentElement.hidden = !human;
    for (const type of ['deploy', 'engineer', 'withdraw', 'tunnel', 'rest', 'breach']) {
      const button = $(type), m = meta(type);
      button.disabled = !yourTurn || view.players[observer() || game.turn].energy < m.cost || type === 'breach' && !resources.breachReady;
      button.setAttribute('aria-pressed', String(type === selection.type));
      button.replaceChildren(node('span', '', label(type)), node('small', '', type === 'deploy' ? '2 / 4 能量' : `${m.cost} 能量`));
    }
    const hand = view.hand || [];
    $('hand-count').textContent = `${hand.length} / 5`;
    $('pool-count').textContent = `抽牌 ${view.drawCount} · 棄牌 ${view.discardCount} · 共用牌池 ${P.length * 13} 張`;
    $('pool-count').title = '每份配方 13 張，其中 1 張護盾；依座位數合成共用牌池。';
    const cards = document.createDocumentFragment();
    if (!human) cards.append(node('p', 'ah-empty', '手牌目前隱藏；觀戰不展示任何陣營手牌。各方牌數、能量與棋盤都是公開的。'));
    else if (!hand.length) cards.append(node('p', 'ah-empty', '目前沒有手牌；仍可鋪子、工程、地道、撤回或休整。'));
    else hand.forEach((type, i) => {
      const m = meta(type), button = node('button', 'btn ah-card-button'); button.type = 'button'; button.id = `card-${i}`; button.dataset.cardIndex = String(i); button.dataset.action = type;
      button.setAttribute('aria-pressed', String(selection.cardIndex === i)); button.disabled = !yourTurn || view.players[observer() || game.turn].energy < m.cost;
      const copy = node('span', 'ah-card-copy'); copy.append(node('strong', '', label(type)), node('small', '', `${m.slots} 格${view.timedCards ? ` · 剩 ${view.cardLife[i]} 次己方行動` : ''} · ${HINTS[type] || m.description}`));
      const cost = node('span', 'ah-card-cost', m.cost); cost.append(node('small', '', '能量'));
      button.append(node('span', 'ah-card-mark', MARKS[type] || '◇'), copy, cost);
      button.addEventListener('click', () => selectAction(type, i)); cards.append(button);
    });
    $('hand').replaceChildren(cards);
    const selectedDiscard = $('discard-card').value;
    $('discard-card').replaceChildren(...hand.map((type, i) => { const option = node('option', '', `${i + 1}. ${label(type)}`); option.value = i; return option; }));
    if ([...$('discard-card').options].some(o => o.value === selectedDiscard)) $('discard-card').value = selectedDiscard;
    $('discard-card').disabled = !yourTurn || !hand.length; $('discard').disabled = !yourTurn || !hand.length;
    $('selection-label').textContent = `已選：${label(selection.type)}${selection.cells.length ? ` · ${selection.cells.length}/${meta(selection.type).variableSlots ? '3–4' : meta(selection.type).slots} 格` : ''}`;
    $('back-selection').hidden = $('confirm-selection').hidden = !meta(selection.type).variableSlots;
    $('back-selection').disabled = !yourTurn || !selection.cells.length; $('confirm-selection').disabled = !yourTurn || !can(actionFor(selection.cells));
    $('cancel-selection').disabled = !yourTurn || selection.type === 'deploy' && !selection.cells.length;
  }
  function renderFacilities() {
    $('facilities').replaceChildren(...(view.airports || []).map((a, i) => {
      const button = node('button', `btn ah-facility${a.active ? ' active' : ''}`); button.dataset.airport = a.cell; button.style.setProperty('--facility', COLORS[a.owner] || '#657283');
      button.append(node('strong', '', `✈ 機場 ${i + 1} · ${a.owner ? LETTER(a.owner) : '中立'}`), node('small', '', a.active ? '已啟用 · 可航空出手' : `連片 ${a.cluster}/12 · 維持 ${a.progress}/3`), node('small', '', a.owner ? a.supplied ? '已連回家園' : '尚未連回家園' : '占領中心開始建設'));
      button.addEventListener('click', () => inspectFacility(a.cell)); return button;
    }));
    $('depots').replaceChildren(...(view.depots || []).map((d, i) => {
      const button = node('button', 'btn', `◇ ${i + 1} · ${d.owner ? LETTER(d.owner) : '中立'}${d.supplied ? ' ✓' : ''}`); button.dataset.depot = d.cell; button.style.setProperty('--facility', COLORS[d.owner] || '#657283'); button.setAttribute('aria-label', `物資站 ${i + 1}，${d.owner ? localName(d.owner) : '中立'}，${d.supplied ? '補給連通' : '未連通'}`); button.addEventListener('click', () => inspectFacility(d.cell)); return button;
    }));
    const warning = view.neutralWarning, status = $('neutral-warning'); status.classList.toggle('active', !!warning);
    if (!view.neutralEvents) status.textContent = '中立事件已關閉。本局不會出現中立游擊或災害。';
    else if (!warning) status.textContent = '中立事件開啟 · 每 12 輪發生，提前 2 輪公開受影響棋子；工事可防護。';
    else {
      status.replaceChildren(document.createTextNode(`${warning.kind === 'guerrilla' ? '游擊' : '災害'}預警 · 扇區 ${warning.sector + 1} · ${Math.max(0, warning.resolveRound - game.round)} 輪後發生 · ${(warning.cells || []).length} 格 `));
      (warning.cells || []).forEach((cell, i) => { const button = node('button', 'btn ah-warning-target', `查看 ${i + 1}`); button.addEventListener('click', () => focusCell(cell)); status.append(button); });
    }
  }
  function inspectFacility(cell) { inspectedCell = cell; inspectedRange = V.inspectTurret(view, cell, E.CELLS, E.distance); inspectMode = true; focusCell(cell); paintInspection(); draw(); }
  function renderDiplomacy() {
    $('diplomacy-panel').hidden = normal; if (normal) return;
    const alliances = view.alliances || [], offers = view.offers || [], publicNames = pair => `${localName(pair[0])} ↔ ${localName(pair[1])}`;
    $('alliances').replaceChildren(...alliances.map(a => { const el = node('div', 'ah-alliance', publicNames([a.a, a.b])); el.append(node('small', '', `停戰剩餘 ${Math.max(0, a.expiresRound - game.round)} 輪`)); return el; }));
    if (!alliances.length) $('alliances').append(node('p', 'ah-empty', '目前沒有生效中的停戰協議。'));
    $('offers').replaceChildren(...offers.map(o => {
      const el = node('div', 'ah-offer', `${localName(o.from)} → ${localName(o.to)} 提議停戰`);
      el.append(node('small', '', `提議剩餘 ${Math.max(0, o.expiresRound - game.round)} 輪`));
      if (observer() && o.to === observer()) {
        const buttons = node('div', 'ah-offer-buttons');
        for (const [type, title] of [['accept', '接受'], ['reject', '拒絕']]) {
          const button = node('button', 'btn', title); button.id = `${type}-${o.from}`; button.disabled = !isHumanTurn() || !can({ type, target: o.from });
          button.addEventListener('click', () => perform({ type, target: o.from, cells: [] })); buttons.append(button);
        }
        el.append(buttons);
      }
      return el;
    }));
    $('diplomacy-controls').hidden = mode !== 'human';
    const target = Number($('diplomacy-target').value) || 2;
    $('diplomacy-target').replaceChildren(...P.filter(p => p !== observer()).map(p => { const option = node('option', '', localName(p)); option.value = p; return option; }));
    $('diplomacy-target').value = target;
    $('diplomacy-target').disabled = !isHumanTurn();
    $('offer').disabled = !isHumanTurn() || !can({ type: 'offer', target });
    $('betray').disabled = !isHumanTurn() || !can({ type: 'betray', target });
    const cooldown = Math.max(0, (view.players[observer() || game.turn]?.diplomacyUntil || 0) - game.round);
    $('diplomacy-note').textContent = `${cooldown ? `交涉冷卻剩餘 ${cooldown} 輪。` : '停戰 12 輪，提議有效 3 輪。'}背盟：3 能量、−4 分、−2 聲望，並有 18 輪冷卻。`;
  }
  function renderEvents() {
    const events = (view.events || []).slice(-14).reverse();
    $('event-log').replaceChildren(...events.map(e => {
      const el = node('li'); if (e.round !== undefined) el.append(node('time', '', `R${e.round}`));
      const named = e.player ? `${localName(e.player)} ` : '', target = e.target ? ` → ${localName(e.target)}` : '';
      const descriptions = { ready: '各方就緒，從家園向對岸出發。', sandbox: '進入不限時自由對戰；戰役排名已保存。', 'campaign-end': '十分鐘到，六方分數已一起結算。', reshuffle: '共享抽牌池用盡，棄牌已洗回牌池。', capture: `${named}攻占 ${e.from ? localName(e.from) : '敵方'} 棋子。`, destroy: `${named}拆除 ${e.from ? localName(e.from) : '敵方'} 棋子。`, 'shield-block': `${named}的攻擊被護盾吸收。`, 'supply-retreat': `${named}有 ${e.count} 枚斷補棋子撤退。`, 'offer-expired': `${named}的停戰提議已到期${target}。`, 'alliance-expired': `${named}的停戰已到期${target}。`, 'goal-arrival': `${named}接通對岸，+${e.points} 分。`, 'goal-hold': `${named}持續守住對岸，本輪 +${e.points} 分。`, 'goal-lost': `${named}的對岸補給連線中斷。`, betray: `${named}背盟${target}，−4 分。` };
      Object.assign(descriptions, { 'game-end': '對岸連線完成，本局已結算。', 'hill-retreat': `${named}有 ${(e.cells || []).length} 枚山丘棋子在 3 次後續己方行動後撤退。`, 'card-expired': `${named}一張手牌已到期並回到棄牌池。`, 'tunnel-collapse': `${e.from ? localName(e.from) + ' 的' : ''}地道已崩塌，地形保留。`, 'neutral-warning': `${e.kind === 'guerrilla' ? '游擊' : '災害'}預警：扇區 ${e.sector + 1}，目標已公開。`, 'neutral-strike': `${e.kind === 'guerrilla' || e.source === 'guerrilla' ? '游擊' : '災害'}造成 ${e.from ? localName(e.from) : ''} 棋子崩解，地形保留。`, 'neutral-block': '工事、家園或護盾抵擋了中立事件。', 'airport-unlocked': `${named}機場已啟用，可進行航空行動。`, 'airport-lost': `${named}機場條件失去，立即停用。`, airdrop: `${named}從機場空投炮台。`, bombard: `${named}進行航空轟炸。`, fortified: `${named}棋子持守超過 30 次己方行動，工事完成。` });
      el.append(document.createTextNode(descriptions[e.type] || `${named}${label(e.type)}${target}。`)); return el;
    }));
    if (!events.length) $('event-log').append(node('li', '', '戰場已就緒。外交與重要戰況會公開記錄於此。'));
  }
  function renderResult() {
    $('result').hidden = game.phase !== 'over'; if (game.phase !== 'over') return;
    const result = view.result || game.result, standings = result?.standings ? result.standings.map(s => ({ ...s })) : P.map(p => ({ player: p, score: view.players[p].score })).sort((a, b) => b.score - a.score);
    standings.sort((a, b) => (a.rank || 1) - (b.rank || 1) || b.score - a.score);
    const winners = result?.winners || standings.filter(p => p.score === standings[0].score).map(p => p.player);
    $('result-title').textContent = winners.length > 1 ? `${winners.map(localName).join('、')} 並列第一` : `${localName(winners[0])} 贏得戰役`;
    $('sandbox').hidden = normal;
    if (normal) $('result-description').textContent = `已完成 ${game.round} 輪、${game.ply} 次行動。${result?.reason === 'connection' ? '完成結算後接通對岸獲勝。' : '達到行動上限，以分數結算。'}`;
    else $('result-description').textContent = `已完成 ${Math.round(game.activeMs / 1000)} 秒前景戰役、${game.round} 輪、${game.ply} 次行動。結盟各自計分。`;
    $('standings').replaceChildren(...standings.map((s, i) => node('li', '', `${s.rank || i + 1}. ${localName(s.player)} · ${s.score} 分`)));
  }
  function selectAction(type, cardIndex) {
    if (!isHumanTurn()) return;
    inspectMode = false; cutEnabled = false;
    selection = { type, cells: [], ...(cardIndex !== undefined ? { cardIndex } : {}) }; message = ''; error = false;
    render();
  }
  function perform(action) {
    flushClock();
    if (!isHumanTurn()) { render(); schedule(); return false; }
    view = game.observation(observer());
    if (!E.legalAction(view, action) || !game.act(action)) {
      message = '這個目標目前不能使用：請檢查距離、地形、棋子、資源、冷卻與停戰關係。沒有花費能量、物資或卡牌。'; error = true; render(); return false;
    }
    selection = { type: 'deploy', cells: [] }; message = ''; error = false;
    render(); schedule(); return true;
  }
  function pickCell(i) {
    if (i < 0) return;
    focused = hovered = i; describeCell(i);
    if (inspectMode || !isHumanTurn()) { inspectedCell = i; inspectedRange = V.inspectTurret(view, i, E.CELLS, E.distance); paintInspection(); draw(); return; }
    const m = meta(selection.type), cells = [...selection.cells, i], action = actionFor(cells);
    if (!E.legalSelection(view, action)) { message = '這格無法接續目前的選取。請檢查路徑、距離、所有權與資源；沒有花費資源。'; error = true; render(); return; }
    if (!m.variableSlots && cells.length === m.slots) { perform(action); return; }
    selection.cells = cells; message = m.variableSlots && can(action) ? '地道路徑可用。按「完成地道」，或退一格修改。' : ''; error = false; render();
  }
  function computeLegalTargets() {
    rangeValid = new Set(); airRangeCells = [];
    if (!isHumanTurn() || !$('show-range').checked) return;
    if (isAirAction() && selection.cells.length) airRangeCells = E.CELLS.filter(c => E.distance(selection.cells[0], c.i) <= meta(selection.type).range).map(c => c.i);
    for (const c of E.CELLS) if (E.legalSelection(view, actionFor([...selection.cells, c.i]))) rangeValid.add(c.i);
  }
  function describeCell(i) {
    if (i < 0) return;
    const c = E.CELLS[i], owner = view.board[i], anchor = view.anchors[i];
    const terrain = terrainIs(view.terrain[i], 'river') ? '河流' : terrainIs(view.terrain[i], 'hill') ? '山丘' : '平地';
    const turret = view.turrets.find(t => t.cell === i);
    $('cell-info').textContent = `格 (${c.q}, ${c.r}) · ${anchor ? localName(anchor) + ' 永久家園' : owner ? localName(owner) + ' 棋子' : '空格'} · ${terrain}${owner && terrainIs(view.terrain[i], 'hill') ? ` · 山丘撤退倒數 ${3 - (view.hillAge?.[i] || 0)} 次己方行動` : ''}${(view.tunnels || []).some(t => t.path.includes(i)) ? ' · 公開地道路徑' : ''}${owner ? view.supplied?.[i] ? ' · 補給連通' : ` · 斷補 ${view.unsupplied?.[i] || 0}/6 回合` : ''}${owner && !anchor ? ` · 持守 ${view.age?.[i] || 0} 次己方行動${view.fortified?.[i] ? '，工事已成（防中立事件）' : '/31 成工事'}` : ''}${view.shields?.[i] ? ` · 護盾 ${view.shields[i]} 回合` : ''}${turret ? ` · 炮擊倒數 ${turret.countdown} / 壽命 ${turret.life}` : ''}${mode === 'human' && view.range?.[i] ? ' · 你的 5 格範圍內' : ''}`;
  }
  function paintInspection() {
    cutPreview = cutEnabled ? V.supplyCutPreview(view, inspectedCell, E, observer()) : null;
    cutButton.setAttribute('aria-pressed', String(cutEnabled));
    cutInfo.hidden = !cutEnabled;
    if (cutEnabled) {
      const p = cutPreview, turns = p?.retreats.map(r => r.ownActions) || [];
      const delay = turns.length ? `${Math.min(...turns)}${Math.min(...turns) === Math.max(...turns) ? '' : '–' + Math.max(...turns)}` : '';
      cutInfo.textContent = p
        ? `假設成功奪取 ${localName(p.owner)} 此格：另有 ${p.affected.length} 枚棋子立即斷補（橙色虛線圈）${p.losesGoal ? normal ? '；會切斷對岸連線' : '；會切斷守線得分連線，不扣已得分數' : '；不會切斷既有對岸連線'}。${turns.length ? `斷補不等於立即消滅；若未接回，於該陣營再完成 ${delay} 次己方行動後撤退，期間仍可能被攻擊或因山丘撤離。` : ''}僅預覽補給；不代表能合法攻占或必定成功。`
        : '斷補預覽 · 點選非家園的敵方棋子（觀戰可查看各方）。只查看、不出手；不預測攻占能否成功。';
    }
    $('inspect-mode').setAttribute('aria-pressed', String(inspectMode));
    $('inspect-mode').textContent = inspectMode ? '查看中 · 不出手' : '查看設施';
    $('clear-inspection').disabled = inspectedCell < 0;
    const airport = (view.airports || []).find(a => a.cell === inspectedCell), depot = (view.depots || []).find(d => d.cell === inspectedCell);
    $('turret-info').textContent = inspectedRange
      ? `${localName(inspectedRange.owner)} 炮台 · 射程 3 格 · 射擊倒數 ${inspectedRange.countdown} 次己方回合 · 壽命 ${inspectedRange.life} 回合。圈內標靶是目前可攻擊的 ${inspectedRange.targets.length} 枚敵子，並非預告下一個命中目標。`
      : airport ? `✈ 機場 · ${airport.owner ? localName(airport.owner) : '中立'} · ${airport.supplied ? '家園補給連通' : '尚未連回家園'} · 4 格內連片 ${airport.cluster}/12 子 · 維持 ${airport.progress}/3 次己方行動 · ${airport.active ? '已啟用：空投 10 格 / 轟炸 12 格' : '未啟用：持續占領並擴大連片'}`
      : depot ? `◇ 物資站 · ${depot.owner ? localName(depot.owner) : '中立'} · ${depot.supplied ? '連回家園，每 3 次己方行動提供物資加成' : '占領並連回家園後提供物資加成'}`
      : inspectMode ? '查看模式：點按炮台、機場或物資站。點格只查看，不會花費能量或出牌。' : '選「查看設施」後點按炮台顯示射程，或查看機場與物資站。';
  }
  function clockText() {
    if (normal) return `${Math.max(...P.map(p => game.players[p].completedActions || 0))} / 100 次行動`;
    if (game.sandbox) return '自由對戰';
    const seconds = Math.ceil(Math.max(0, game.durationMs - game.activeMs) / 1000);
    return `剩餘 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
  function takeSnapshot() {
    if (!chronicle || game.phase === 'ready') return;
    // Freeze first: the image describes exactly the paused board.
    flushClock(); if (game.phase === 'running') game.pause();
    message = ''; error = false; render(); schedule();
    const summary = Snap.summarize(chronicle, view), image = document.createElement('canvas');
    Snap.draw(image, { view, summary, seed: game.seed, clock: clockText(), supply: supplyLinks }, { points, colors: COLORS, tints: TINTS, names: NAMES.map((n, p) => p ? `${LETTER(p)} ${n}` : '') });
    const dialog = $('snapshot-dialog'), name = `${normal ? 'card-hex' : 'autohex'}-${String(game.seed).replace(/[^\w-]+/g, '_').slice(0, 40)}-T${summary.toPly}.png`;
    image.toBlob(blob => {
      if (!blob) { message = '截圖產生失敗，請再試一次。'; error = true; render(); return; }
      if (snapshotUrl) URL.revokeObjectURL(snapshotUrl);
      snapshotUrl = URL.createObjectURL(blob);
      $('snapshot-image').src = snapshotUrl; $('snapshot-download').href = snapshotUrl; $('snapshot-download').download = name;
      $('snapshot-title').textContent = summary.toPly ? `最近 ${summary.toPly - summary.fromPly} 次行動（第 ${summary.fromPly + 1}–${summary.toPly} 次）` : '開局快照 · 尚未行動';
      $('snapshot-note').textContent = '越新的變化越深，舊的較淡。只含公開資訊；手機可長按圖片儲存。';
      $('snapshot-resume').hidden = game.phase !== 'paused';
      if (!dialog.open) dialog.showModal?.(); if (!dialog.open) dialog.setAttribute('open', '');
      window.autoHexSnapshotDebug = { name, width: image.width, height: image.height, bytes: blob.size, summary };
    }, 'image/png');
  }
  function resize() {
    const rect = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2.5), ratio = camera.scale / camera.fit;
    camera.width = rect.width; camera.height = rect.height;
    canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
    camera.fit = Math.min((rect.width - 52) / (bounds.maxX - bounds.minX + 4), (rect.height - 60) / (bounds.maxY - bounds.minY + 4));
    camera.scale = camera.fit * (Number.isFinite(ratio) ? ratio : 1);
    const mr = mini.getBoundingClientRect(); mini.width = Math.round(mr.width * dpr); mini.height = Math.round(mr.height * dpr);
    draw();
  }
  function fitMap() { camera.x = 0; camera.y = 0; camera.scale = camera.fit; draw(); }
  function focusCell(i, scale = Math.max(camera.fit * 3, 24)) { if (!points[i]) return; camera.x = points[i].x; camera.y = points[i].y; camera.scale = Math.min(camera.fit * 8, scale); focused = i; describeCell(i); draw(); }
  function focusHome() { focusCell(view.players[observer() || game.turn].home); }
  function toWorld(x, y) { return { x: (x - camera.width / 2) / camera.scale + camera.x, y: (y - camera.height / 2) / camera.scale + camera.y }; }
  function nearest(x, y) {
    const world = toWorld(x, y); let best = -1, dist = 1.1;
    for (let i = 0; i < points.length; i++) { const d = Math.hypot(points[i].x - world.x, points[i].y - world.y); if (d < dist) { best = i; dist = d; } }
    return best;
  }
  function zoom(factor, x = camera.width / 2, y = camera.height / 2) {
    const before = toWorld(x, y); camera.scale = Math.max(camera.fit * .75, Math.min(camera.fit * 8, camera.scale * factor));
    const after = toWorld(x, y); camera.x += before.x - after.x; camera.y += before.y - after.y; draw();
  }
  function hexPath(context, x, y, radius = .93) {
    context.beginPath(); for (let k = 0; k < 6; k++) { const a = Math.PI / 3 * k + Math.PI / 6; const px = x + Math.cos(a) * radius, py = y + Math.sin(a) * radius; k ? context.lineTo(px, py) : context.moveTo(px, py); } context.closePath();
  }
  function ownerPath(owner, x, y, radius) {
    ctx.beginPath();
    if (owner === 1) { ctx.arc(x, y, radius, 0, Math.PI * 2); return; }
    const sides = [0, 0, 4, 3, 4, 5, 6][owner], turn = owner === 2 ? 0 : -Math.PI / 2 + (owner === 4 ? Math.PI / 4 : 0);
    for (let k = 0; k < sides; k++) { const a = turn + k * Math.PI * 2 / sides, px = x + Math.cos(a) * radius, py = y + Math.sin(a) * radius; k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.closePath();
  }
  function shownSupplyLinks() { const mode = $('supply-mode').value; return mode === 'off' ? [] : supplyLinks.filter(link => mode === 'all' || link.owner === Number(mode)); }
  function drawSupply(scale) {
    const all = $('supply-mode').value === 'all';
    ctx.save(); ctx.globalAlpha = all ? .42 : .85; ctx.lineWidth = Math.max(all ? .075 : .12, (all ? 1 : 1.6) / scale);
    for (const link of shownSupplyLinks()) {
      const a = points[link.a], b = points[link.b], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), inset = Math.min(.62, d / 3);
      ctx.strokeStyle = COLORS[link.owner]; ctx.beginPath(); ctx.moveTo(a.x + dx / d * inset, a.y + dy / d * inset); ctx.lineTo(b.x - dx / d * inset, b.y - dy / d * inset); ctx.stroke();
    }
    ctx.restore();
  }
  function crosshair(i, color, scale, radius = .8) {
    const p = points[i], r = Math.max(radius, 5 / scale);
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(.1, 1.3 / scale); ctx.beginPath(); ctx.arc(p.x, p.y, r * .7, 0, Math.PI * 2);
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; ctx.moveTo(p.x + Math.cos(a) * r * .5, p.y + Math.sin(a) * r * .5); ctx.lineTo(p.x + Math.cos(a) * r * 1.2, p.y + Math.sin(a) * r * 1.2); } ctx.stroke();
  }
  function drawTunnels(scale) {
    for (const t of view.tunnels || []) {
      ctx.save(); ctx.strokeStyle = COLORS[t.owner]; ctx.lineWidth = Math.max(.1, 1.5 / scale); ctx.setLineDash([1.4 / scale, 3 / scale]); ctx.beginPath();
      t.path.forEach((i, k) => { const p = points[i]; k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.stroke(); ctx.setLineDash([]);
      for (const i of [t.a, t.b]) { const p = points[i], r = Math.max(.7, 5 / scale); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.x, p.y, r, Math.PI, 0); ctx.lineTo(p.x + r, p.y + r * .55); ctx.lineTo(p.x - r, p.y + r * .55); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.fillStyle = COLORS[t.owner]; ctx.font = `bold ${Math.max(.45, 7 / scale)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(LETTER(t.owner), p.x, p.y); }
      ctx.restore();
    }
  }
  function drawTurretRange(scale) {
    if (!inspectedRange) return;
    const included = new Set(inspectedRange.cells), color = COLORS[inspectedRange.owner];
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = Math.max(.12, 1.5 / scale); ctx.setLineDash([5 / scale, 3 / scale]);
    for (const i of inspectedRange.cells) {
      const c = E.CELLS[i], p = points[i];
      hexPath(ctx, p.x, p.y); ctx.fillStyle = color + '12'; ctx.fill();
      // Each outer hex side is drawn once, giving the actual clipped radius-3 boundary.
      for (const [dq, dr, angle] of [[1, 0, 0], [0, 1, 60], [-1, 1, 120], [-1, 0, 180], [0, -1, 240], [1, -1, 300]]) {
        if (included.has(E.index(c.q + dq, c.r + dr))) continue;
        const a = (angle - 30) * Math.PI / 180, b = (angle + 30) * Math.PI / 180;
        ctx.beginPath(); ctx.moveTo(p.x + Math.cos(a), p.y + Math.sin(a)); ctx.lineTo(p.x + Math.cos(b), p.y + Math.sin(b)); ctx.stroke();
      }
    }
    ctx.setLineDash([]); for (const i of inspectedRange.targets) crosshair(i, '#a65e46', scale, .7); ctx.restore();
  }
  function drawTurrets(scale, visible) {
    for (const t of view.turrets || []) {
      const p = points[t.cell]; if (!visible(p)) continue;
      const size = Math.max(12, scale * 1.35) / scale, x = p.x, y = p.y, color = COLORS[t.owner];
      ctx.save(); ctx.strokeStyle = '#fff'; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      if (!view.supplied[t.cell]) { ctx.strokeStyle = '#a87534'; ctx.lineWidth = 1.4 / scale; ctx.setLineDash([2.5 / scale, 2 / scale]); ctx.beginPath(); ctx.arc(x, y, size * .8, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); ctx.strokeStyle = '#fff'; }
      // Solid plinth, armored body and raised barrel remain legible at whole-map zoom.
      ctx.lineWidth = Math.max(.12, 2.4 / scale); ctx.fillStyle = color;
      ctx.beginPath(); ctx.moveTo(x - size * .48, y + size * .36); ctx.lineTo(x + size * .48, y + size * .36); ctx.lineTo(x + size * .34, y - size * .13); ctx.lineTo(x - size * .34, y - size * .13); ctx.closePath(); ctx.stroke(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x, y - size * .1); ctx.lineTo(x + size * .31, y - size * .62); ctx.lineWidth = size * .25 + 2 / scale; ctx.stroke(); ctx.strokeStyle = color; ctx.lineWidth = size * .25; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `bold ${Math.max(6.5 / scale, size * .42)}px sans-serif`; ctx.fillText(LETTER(t.owner), x - size * .03, y + size * .1);
      ctx.fillStyle = '#fff'; ctx.strokeStyle = color; ctx.lineWidth = 1 / scale; ctx.beginPath(); ctx.arc(x + size * .58, y - size * .35, Math.max(4.7 / scale, size * .28), 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = color; ctx.font = `bold ${Math.max(7 / scale, size * .4)}px sans-serif`; ctx.fillText(t.countdown, x + size * .58, y - size * .35);
      ctx.restore();
    }
  }
  function drawFacilities(scale, visible) {
    for (const a of view.airports || []) {
      const p = points[a.cell]; if (!visible(p)) continue;
      const size = Math.max(13, scale * 1.42) / scale, color = COLORS[a.owner] || '#708090', x = p.x, y = p.y;
      ctx.save(); ctx.fillStyle = a.active ? '#e5f2ed' : '#f9fbfc'; ctx.strokeStyle = color; ctx.lineWidth = Math.max(.11, 1.4 / scale); ctx.fillRect(x - size * .59, y - size * .59, size * 1.18, size * 1.18); ctx.strokeRect(x - size * .59, y - size * .59, size * 1.18, size * 1.18);
      // Aircraft planform: fuselage, swept wings and tail, distinct from a cannon.
      ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x, y - size * .46); ctx.lineTo(x + size * .09, y - size * .07); ctx.lineTo(x + size * .42, y + size * .13); ctx.lineTo(x + size * .4, y + size * .24); ctx.lineTo(x + size * .08, y + size * .12); ctx.lineTo(x + size * .07, y + size * .33); ctx.lineTo(x + size * .18, y + size * .42); ctx.lineTo(x - size * .18, y + size * .42); ctx.lineTo(x - size * .07, y + size * .33); ctx.lineTo(x - size * .08, y + size * .12); ctx.lineTo(x - size * .4, y + size * .24); ctx.lineTo(x - size * .42, y + size * .13); ctx.lineTo(x - size * .09, y - size * .07); ctx.closePath(); ctx.fill();
      for (let k = 0; k < 3; k++) { ctx.fillStyle = a.active || a.progress > k ? color : '#d9e1e7'; ctx.fillRect(x - size * .59 + k * size * .42, y + size * .68, size * .34, Math.max(.12, 2 / scale)); }
      if (a.owner && scale > 7) { ctx.font = `bold ${Math.max(.48, 7 / scale)}px sans-serif`; ctx.textAlign = 'left'; ctx.fillStyle = color; ctx.fillText(LETTER(a.owner), x + size * .68, y + size * .12); }
      ctx.restore();
    }
    for (const d of view.depots || []) {
      const p = points[d.cell]; if (!visible(p)) continue;
      const size = Math.max(9, scale * 1.06) / scale, color = COLORS[d.owner] || '#918368';
      ctx.save(); ctx.fillStyle = '#fffcf2'; ctx.strokeStyle = color; ctx.lineWidth = Math.max(.1, 1.2 / scale); ctx.beginPath(); ctx.moveTo(p.x, p.y - size * .66); ctx.lineTo(p.x + size * .66, p.y); ctx.lineTo(p.x, p.y + size * .66); ctx.lineTo(p.x - size * .66, p.y); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.fillStyle = color; ctx.fillRect(p.x - size * .27, p.y - size * .24, size * .54, size * .48); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1 / scale; ctx.beginPath(); ctx.moveTo(p.x, p.y - size * .23); ctx.lineTo(p.x, p.y + size * .23); ctx.stroke(); ctx.restore();
    }
  }
  function drawStrategicOverlays(scale) {
    if (airRangeCells.length) {
      const included = new Set(airRangeCells); ctx.save(); ctx.strokeStyle = '#4d739e'; ctx.lineWidth = Math.max(.12, 1.6 / scale); ctx.setLineDash([6 / scale, 3 / scale]);
      for (const i of airRangeCells) { const c = E.CELLS[i], p = points[i]; for (const [dq, dr, angle] of [[1, 0, 0], [0, 1, 60], [-1, 1, 120], [-1, 0, 180], [0, -1, 240], [1, -1, 300]]) if (!included.has(E.index(c.q + dq, c.r + dr))) { const a = (angle - 30) * Math.PI / 180, b = (angle + 30) * Math.PI / 180; ctx.beginPath(); ctx.moveTo(p.x + Math.cos(a), p.y + Math.sin(a)); ctx.lineTo(p.x + Math.cos(b), p.y + Math.sin(b)); ctx.stroke(); } } ctx.restore();
    }
    for (const i of view.neutralWarning?.cells || []) {
      const p = points[i]; if (!p) continue;
      ctx.save(); hexPath(ctx, p.x, p.y, 1.07); ctx.strokeStyle = '#a36520'; ctx.lineWidth = Math.max(.14, 2 / scale); ctx.stroke();
      const radius = Math.max(.28, 4.5 / scale), x = p.x + Math.max(.7, 6 / scale), y = p.y - Math.max(.7, 6 / scale); ctx.fillStyle = '#ffe6af'; ctx.lineWidth = 1 / scale; ctx.beginPath(); ctx.moveTo(x, y - radius); ctx.lineTo(x + radius, y + radius * .8); ctx.lineTo(x - radius, y + radius * .8); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.font = `bold ${Math.max(.35, 7 / scale)}px sans-serif`; ctx.fillStyle = '#80551c'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('!', x, y + radius * .15); ctx.restore();
    }
  }
  function drawPlan(context, scale, minimap = false) {
    const plan = displayedPlan; if (!plan) return;
    const path = plan.path.map(i => points[i]), target = points[plan.target], color = COLORS[plan.player];
    context.save(); context.lineJoin = 'round'; context.lineCap = 'round';
    if (path.length > 1) {
      const trace = () => { context.beginPath(); path.forEach((p, i) => i ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y)); };
      trace(); context.strokeStyle = '#ffffffdc'; context.lineWidth = (minimap ? 3 : 4.6) / scale; context.stroke();
      trace(); context.strokeStyle = color; context.lineWidth = (minimap ? 1.3 : 2) / scale; context.setLineDash(minimap ? [] : [5 / scale, 4 / scale]); context.stroke(); context.setLineDash([]);
      if (!minimap) { const a = path[path.length - 2], b = path[path.length - 1], angle = Math.atan2(b.y - a.y, b.x - a.x), size = 5 / scale; context.fillStyle = color; context.beginPath(); context.moveTo(b.x, b.y); context.lineTo(b.x - Math.cos(angle - .6) * size, b.y - Math.sin(angle - .6) * size); context.lineTo(b.x - Math.cos(angle + .6) * size, b.y - Math.sin(angle + .6) * size); context.closePath(); context.fill(); }
    }
    if (target) {
      const size = minimap ? 3.2 / scale : Math.max(.76, 7 / scale);
      context.beginPath(); context.moveTo(target.x, target.y - size); context.lineTo(target.x + size, target.y); context.lineTo(target.x, target.y + size); context.lineTo(target.x - size, target.y); context.closePath();
      context.strokeStyle = '#fff'; context.lineWidth = (minimap ? 3.3 : 5) / scale; context.stroke(); context.strokeStyle = color; context.lineWidth = (minimap ? 1.3 : 2) / scale; context.stroke();
      if (!minimap) { const font = Math.max(.5, 8 / scale), y = target.y - size - 5 / scale; context.font = `bold ${font}px sans-serif`; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillStyle = '#fffffff0'; context.fillRect(target.x - font * .65, y - font * .65, font * 1.3, font * 1.3); context.fillStyle = color; context.fillText(LETTER(plan.player), target.x, y); }
    }
    context.restore();
  }
  function drawEffects(scale) {
    for (const effect of effects.effects) {
      const reduced = reducedQuery.matches, progress = Math.min(1, effect.age / effect.duration), color = COLORS[effect.from || effect.player] || '#a65e46';
      ctx.save(); ctx.globalAlpha = reduced ? .9 : Math.min(1, (1 - progress) * 2.5);
      for (const i of effect.cells.slice(0, 16)) {
        const p = points[i]; if (!p) continue;
        const radius = Math.max(.5, 4 / scale);
        if (['turret', 'bombard', 'airdrop'].includes(effect.source) && points[effect.origin]) {
          const source = points[effect.origin]; ctx.strokeStyle = '#b67729'; ctx.lineWidth = Math.max(.1, 1.5 / scale); ctx.setLineDash(reduced ? [3 / scale, 2 / scale] : []); ctx.beginPath(); ctx.moveTo(source.x, source.y); ctx.lineTo(p.x, p.y); ctx.stroke(); ctx.setLineDash([]);
          if (!reduced && progress < .45) { const t = Math.min(1, progress / .45); ctx.fillStyle = '#a65e46'; ctx.beginPath(); ctx.arc(source.x + (p.x - source.x) * t, source.y + (p.y - source.y) * t, Math.max(.13, 2 / scale), 0, Math.PI * 2); ctx.fill(); }
        }
        ctx.strokeStyle = ['shield-block', 'neutral-block'].includes(effect.type) ? '#4d739e' : color; ctx.lineWidth = Math.max(.11, 1.4 / scale);
        if (['shield-block', 'neutral-block'].includes(effect.type)) { ctx.beginPath(); ctx.arc(p.x, p.y, radius * (reduced ? 1.35 : 1 + progress), 0, Math.PI * 2); ctx.stroke(); }
        else if (effect.type === 'capture' || effect.type === 'airdrop') crosshair(i, COLORS[effect.player], scale, radius);
        else {
          // Fragments are ghosts of the removed piece. The underlying terrain is untouched.
          ctx.fillStyle = color;
          for (let k = 0; k < 4; k++) { const angle = k * Math.PI / 2 + .4, travel = reduced ? .3 : .12 + progress * .75, x = p.x + Math.cos(angle) * radius * travel, y = p.y + Math.sin(angle) * radius * travel;
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(angle - .55) * radius * .65, y + Math.sin(angle - .55) * radius * .65); ctx.lineTo(x + Math.cos(angle + .55) * radius * .65, y + Math.sin(angle + .55) * radius * .65); ctx.closePath(); ctx.fill();
          }
          ctx.beginPath(); ctx.moveTo(p.x - radius * .35, p.y - radius * .35); ctx.lineTo(p.x + radius * .35, p.y + radius * .35); ctx.moveTo(p.x + radius * .35, p.y - radius * .35); ctx.lineTo(p.x - radius * .35, p.y + radius * .35); ctx.stroke();
        }
      }
      const p = points[effect.cells[0]];
      if (p) { const title = ['destroy', 'neutral-strike'].includes(effect.type) ? '棋子崩解' : effect.type === 'supply-retreat' ? '斷補撤退' : effect.type === 'shield-block' ? '護盾吸收' : effect.type === 'neutral-block' ? '防護生效' : effect.type === 'airdrop' ? '炮台空投' : '攻占'; const font = Math.max(.45, 8.5 / scale), y = p.y - Math.max(1.2, 13 / scale); ctx.font = `bold ${font}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; const width = ctx.measureText(title).width + 4 / scale; ctx.fillStyle = '#ffffffed'; ctx.fillRect(p.x - width / 2, y - font * .8, width, font * 1.6); ctx.fillStyle = '#795633'; ctx.fillText(title, p.x, y); }
      ctx.restore();
    }
  }
  function worldTransform(context) {
    const dpr = canvas.width / camera.width;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.translate(camera.width / 2, camera.height / 2); context.scale(camera.scale, camera.scale); context.translate(-camera.x, -camera.y);
  }
  function clearLayer(context) { context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, canvas.width, canvas.height); worldTransform(context); }
  function paintStaticLayers() {
    // Every ordinary draw reflects a view, camera or control change. Effects
    // alone reuse these two bounded canvases, preserving their original order.
    for (const layer of [boardLayer, frontLayer]) if (layer.width !== canvas.width || layer.height !== canvas.height) { layer.width = canvas.width; layer.height = canvas.height; }
    try {
    ctx = boardContext; clearLayer(ctx);
    const scale = camera.scale, visible = (c, padding = 3) => Math.abs(c.x - camera.x) < camera.width / scale / 2 + padding && Math.abs(c.y - camera.y) < camera.height / scale / 2 + padding;
    for (const c of E.CELLS) {
      const i = c.i, pt = points[i]; if (!visible(pt)) continue;
      const owner = view.board[i], river = terrainIs(view.terrain[i], 'river'), hill = terrainIs(view.terrain[i], 'hill');
      ctx.fillStyle = river ? '#dcecf4' : hill ? '#f2ebd9' : '#ffffff';
      hexPath(ctx, pt.x, pt.y); ctx.fill(); ctx.strokeStyle = '#dbe3e7'; ctx.lineWidth = .06; ctx.stroke();
      if (mode === 'human' && $('show-range').checked && isHumanTurn() && (isAirAction() ? rangeValid.has(i) : view.range?.[i]) && !owner) { ctx.fillStyle = rangeValid.has(i) ? '#5ebcbf30' : '#5ebcbf0b'; ctx.fill(); }
      if (river && !owner && scale > 10) { ctx.strokeStyle = '#93b3c5'; ctx.lineWidth = .08; ctx.beginPath(); ctx.moveTo(pt.x - .4, pt.y + .12); ctx.bezierCurveTo(pt.x - .1, pt.y - .18, pt.x + .1, pt.y + .4, pt.x + .4, pt.y + .1); ctx.stroke(); }
      if (hill && !owner && scale > 10) { ctx.strokeStyle = '#bcaa78'; ctx.lineWidth = .07; ctx.beginPath(); ctx.moveTo(pt.x - .32, pt.y + .2); ctx.lineTo(pt.x, pt.y - .28); ctx.lineTo(pt.x + .32, pt.y + .2); ctx.stroke(); }
      if (hill && owner && !view.anchors[i]) { const size = Math.max(.4, 6 / scale); ctx.fillStyle = '#8a6724'; ctx.font = `bold ${size}px sans-serif`; ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillText(`⌛${Math.max(0, 3 - (view.hillAge?.[i] || 0))}`, pt.x + .85, pt.y + .5); }
      if (owner) {
        const broken = view.supplied && !view.supplied[i], radius = Math.max(.48, (broken ? 3.5 : 2.3) / scale);
        ctx.fillStyle = broken ? '#fff' : COLORS[owner]; ctx.strokeStyle = COLORS[owner]; ctx.lineWidth = Math.max(.09, 1.1 / scale);
        ownerPath(owner, pt.x, pt.y, radius); ctx.fill(); if (broken) ctx.stroke();
        if (broken) { ctx.strokeStyle = '#a87534'; ctx.lineWidth = Math.max(.1, 1.3 / scale); ctx.setLineDash([2.2 / scale, 1.5 / scale]); ctx.beginPath(); ctx.arc(pt.x, pt.y, radius + 1.9 / scale, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = COLORS[owner]; ctx.font = `bold ${Math.max(.5, 7 / scale)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(Math.max(0, 6 - (view.unsupplied?.[i] || 0)), pt.x, pt.y + .03); }
        else if (scale > 20 && !view.anchors[i]) { ctx.fillStyle = '#fff'; ctx.font = 'bold .51px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(LETTER(owner), pt.x, pt.y + .02); }
      }
      if (view.shields?.[i]) { ctx.strokeStyle = COLORS[owner] || '#708090'; ctx.lineWidth = .1; ctx.beginPath(); ctx.arc(pt.x, pt.y, .69, 0, Math.PI * 2); ctx.stroke(); }
      if (owner && view.fortified?.[i] && !view.anchors[i]) {
        const r = Math.max(.65, 4.5 / scale); ctx.strokeStyle = COLORS[owner]; ctx.lineWidth = Math.max(.1, 1.2 / scale); ctx.strokeRect(pt.x - r, pt.y - r * .72, r * 2, r * 1.6); ctx.fillStyle = COLORS[owner]; for (let k = 0; k < 3; k++) ctx.fillRect(pt.x - r + k * r * .78, pt.y - r * .97, r * .45, r * .4);
      }
      if (view.anchors[i]) {
        ctx.fillStyle = '#fff'; ctx.font = 'bold .85px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('⌂', pt.x, pt.y - .05);
      }
      if (rangeValid.has(i) && !owner && scale > 12) { ctx.fillStyle = '#26747760'; ctx.beginPath(); ctx.arc(pt.x, pt.y, .1, 0, Math.PI * 2); ctx.fill(); }
    }
    drawSupply(scale);
    for (const b of view.bridges || []) { const a = points[b.a], z = points[b.b]; ctx.strokeStyle = COLORS[b.owner]; ctx.lineWidth = .18; ctx.setLineDash([.28, .17]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(z.x, z.y); ctx.stroke(); ctx.setLineDash([]); }
    drawTunnels(scale);
    drawTurretRange(scale);
    const breachMarkers=new Map();
    for(const p of P){const i=view.players[p].breachTarget;if(i>=0)breachMarkers.set(i,[...(breachMarkers.get(i)||[]),p]);}
    for(const [i,owners] of breachMarkers){
      const pt=points[i],color=COLORS[owners[0]],letters=owners.map(LETTER).join('/');crosshair(i,color,scale);
      ctx.save();ctx.font=`bold ${11/scale}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';
      const text=scale>=14?`${letters} 破陣 · 下次行動`:`${letters} ⚑`,w=ctx.measureText(text).width+10/scale,h=18/scale,y=pt.y-2.15;
      ctx.strokeStyle=color;ctx.lineWidth=1/scale;ctx.beginPath();ctx.moveTo(pt.x,pt.y-.8);ctx.lineTo(pt.x,y);ctx.stroke();
      ctx.fillStyle='#fffdf6';ctx.fillRect(pt.x-w/2,y-h,w,h);ctx.strokeRect(pt.x-w/2,y-h,w,h);
      ctx.fillStyle='#723807';ctx.fillText(text,pt.x,y-h/2);ctx.restore();
    }
    if (['destroy', 'bombard', 'breach'].includes(selection.type) && isHumanTurn()) for (const i of rangeValid) crosshair(i, '#a65e46', scale);
    drawFacilities(scale, visible); drawTurrets(scale, visible); drawStrategicOverlays(scale); drawPlan(ctx, scale);
    ctx = frontContext; clearLayer(ctx);
    drawGoals(ctx, scale);
    if (cutPreview) {
      ctx.save(); ctx.strokeStyle = '#9a5b12'; ctx.lineWidth = Math.max(.12, 1.5 / scale); ctx.setLineDash([3 / scale, 2 / scale]);
      for (const i of cutPreview.affected) { const p = points[i]; hexPath(ctx, p.x, p.y, .88); ctx.stroke(); }
      ctx.setLineDash([]); const p = points[cutPreview.cell]; hexPath(ctx, p.x, p.y, 1.04); ctx.stroke(); ctx.restore();
    }
    for (const [n, i] of selection.cells.entries()) {
      const p = points[i]; hexPath(ctx, p.x, p.y, 1.02); ctx.strokeStyle = '#2e3440'; ctx.lineWidth = .18; ctx.stroke(); ctx.fillStyle = '#2e3440'; ctx.beginPath(); ctx.arc(p.x + .65, p.y - .65, .4, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = 'bold .55px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(n + 1, p.x + .65, p.y - .63);
    }
    if (focused >= 0 || hovered >= 0) { const i = hovered >= 0 ? hovered : focused, p = points[i]; hexPath(ctx, p.x, p.y, 1.02); ctx.strokeStyle = isHumanTurn() && !rangeValid.has(i) && selection.cells.length + 1 === meta(selection.type).slots ? '#a65e46' : '#2e3440'; ctx.lineWidth = .14; ctx.stroke(); }
    } finally { ctx = mainContext; }
    renderCache.valid = true; renderCache.rebuilds++;
    $('zoom-level').textContent = `${Math.round(camera.scale / camera.fit * 100)}%`;
    drawMini(); renderCache.minimaps++;
  }
  function draw(effectsOnly = false) {
    if (!view || !camera.width) return;
    if (effectsOnly !== true || !renderCache.valid || boardLayer.width !== canvas.width || boardLayer.height !== canvas.height) paintStaticLayers();
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(boardLayer, 0, 0);
    worldTransform(ctx); drawEffects(camera.scale);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(frontLayer, 0, 0);
    renderCache.composites++;
  }
  function drawGoals(context, scale) {
    for (const p of P) {
      const player = view.players[p], cells = E.CELLS.filter(c => c[player.axis] === -player.sign * E.RADIUS), goal = goalPoint(p), length = Math.hypot(goal.x, goal.y), nx = goal.x / length, ny = goal.y / length;
      const ordered = cells.map(c => points[c.i]).sort((a, b) => a.x * -ny + a.y * nx - (b.x * -ny + b.y * nx));
      if (ordered.length) { context.strokeStyle = COLORS[p]; context.globalAlpha = .72; context.lineWidth = .25; context.beginPath(); context.moveTo(ordered[0].x + nx * 1.1, ordered[0].y + ny * 1.1); for (const q of ordered.slice(1)) context.lineTo(q.x + nx * 1.1, q.y + ny * 1.1); context.stroke(); context.globalAlpha = 1; }
      const home = points[player.home];
      context.fillStyle = COLORS[p]; context.textAlign = 'center'; context.textBaseline = 'middle'; context.font = `bold ${Math.max(.72, 9 / scale)}px sans-serif`;
      const arrow = Math.abs(nx) < .3 ? (ny < 0 ? '↑' : '↓') : nx < 0 ? (ny < 0 ? '↖' : '↙') : ny < 0 ? '↗' : '↘';
      context.fillText(`${LETTER(p)} ${arrow}`, goal.x + nx * 2.4, goal.y + ny * 2.4);
      context.font = `bold ${Math.max(.7, 8 / scale)}px sans-serif`;
      context.fillStyle = '#fff'; context.fillRect(home.x - 1.65, home.y + .95, 3.3, 1.12); context.fillStyle = COLORS[p]; context.fillText(`${LETTER(p)} ⌂`, home.x, home.y + 1.48);
    }
  }
  function miniTransform() { const rect = mini.getBoundingClientRect(); return { width: rect.width, height: rect.height, scale: Math.min((rect.width - 12) / (bounds.maxX - bounds.minX), (rect.height - 10) / (bounds.maxY - bounds.minY)) }; }
  function drawMini() {
    const m = miniTransform(); if (!m.width) return;
    const dpr = mini.width / m.width; mctx.setTransform(dpr, 0, 0, dpr, 0, 0); mctx.clearRect(0, 0, m.width, m.height); mctx.translate(m.width / 2, m.height / 2); mctx.scale(m.scale, m.scale);
    for (const c of E.CELLS) { const i = c.i, p = points[i]; mctx.fillStyle = view.board[i] ? COLORS[view.board[i]] : terrainIs(view.terrain[i], 'river') ? '#d5e6ed' : terrainIs(view.terrain[i], 'hill') ? '#e6dec9' : '#ffffff'; hexPath(mctx, p.x, p.y, .98); mctx.fill(); }
    for (const p of P) { const h = points[view.players[p].home]; mctx.fillStyle = '#fff'; mctx.strokeStyle = COLORS[p]; mctx.lineWidth = .5; mctx.beginPath(); mctx.arc(h.x, h.y, 1.25, 0, Math.PI * 2); mctx.fill(); mctx.stroke(); }
    for (const a of view.airports || []) { const p = points[a.cell], r = 1.5 / m.scale; mctx.fillStyle = a.active ? COLORS[a.owner] : '#fff'; mctx.strokeStyle = COLORS[a.owner] || '#566576'; mctx.lineWidth = .85 / m.scale; mctx.fillRect(p.x - r, p.y - r, r * 2, r * 2); mctx.strokeRect(p.x - r, p.y - r, r * 2, r * 2); }
    for (const d of view.depots || []) { const p = points[d.cell], r = 1.4 / m.scale; mctx.fillStyle = COLORS[d.owner] || '#a28b56'; mctx.beginPath(); mctx.moveTo(p.x, p.y - r); mctx.lineTo(p.x + r, p.y); mctx.lineTo(p.x, p.y + r); mctx.lineTo(p.x - r, p.y); mctx.closePath(); mctx.fill(); }
    for (const i of view.neutralWarning?.cells || []) { const p = points[i]; mctx.strokeStyle = '#a36520'; mctx.lineWidth = 1 / m.scale; mctx.beginPath(); mctx.arc(p.x, p.y, 3 / m.scale, 0, Math.PI * 2); mctx.stroke(); }
    drawPlan(mctx, m.scale, true);
    const w = camera.width / camera.scale, h = camera.height / camera.scale;
    mctx.fillStyle = '#ffffff12'; mctx.strokeStyle = '#fff'; mctx.lineWidth = 2.5 / m.scale; mctx.fillRect(camera.x - w / 2, camera.y - h / 2, w, h); mctx.strokeRect(camera.x - w / 2, camera.y - h / 2, w, h); mctx.strokeStyle = '#267477'; mctx.lineWidth = 1 / m.scale; mctx.strokeRect(camera.x - w / 2, camera.y - h / 2, w, h);
  }
  function localPoint(event, element = canvas) { const rect = element.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
  canvas.addEventListener('pointerdown', event => {
    canvas.setPointerCapture(event.pointerId); const p = localPoint(event); pointers.set(event.pointerId, p);
    if (pointers.size === 1) { drag = { ...p, cx: camera.x, cy: camera.y }; dragged = false; }
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), middle: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }; dragged = true; }
  });
  canvas.addEventListener('pointermove', event => {
    const p = localPoint(event);
    if (!pointers.has(event.pointerId)) { const i = nearest(p.x, p.y); if (i !== hovered) { hovered = i; describeCell(i); draw(); } return; }
    pointers.set(event.pointerId, p);
    if (pointers.size >= 2 && pinch) {
      const [a, b] = [...pointers.values()], distance = Math.hypot(a.x - b.x, a.y - b.y), middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      zoom(distance / Math.max(1, pinch.distance), middle.x, middle.y); camera.x -= (middle.x - pinch.middle.x) / camera.scale; camera.y -= (middle.y - pinch.middle.y) / camera.scale; pinch = { distance, middle }; draw();
    } else if (drag) { const dx = p.x - drag.x, dy = p.y - drag.y; if (Math.hypot(dx, dy) > 7) dragged = true; if (dragged) { camera.x = drag.cx - dx / camera.scale; camera.y = drag.cy - dy / camera.scale; draw(); } }
  });
  function endPointer(event, cancelled) {
    const p = localPoint(event), click = !cancelled && !dragged && pointers.size === 1;
    pointers.delete(event.pointerId); pinch = null;
    if (click) pickCell(nearest(p.x, p.y));
    if (pointers.size === 1) { const remaining = [...pointers.values()][0]; drag = { ...remaining, cx: camera.x, cy: camera.y }; } else drag = null;
  }
  canvas.addEventListener('pointerup', e => endPointer(e, false)); canvas.addEventListener('pointercancel', e => endPointer(e, true));
  canvas.addEventListener('pointerleave', () => { if (!pointers.size) { hovered = -1; draw(); } });
  canvas.addEventListener('wheel', event => { event.preventDefault(); const p = localPoint(event); zoom(Math.exp(-event.deltaY * .0015), p.x, p.y); }, { passive: false });
  canvas.addEventListener('keydown', event => {
    if (event.key === 'Escape') { selectAction('deploy'); return; }
    if (event.key === '+' || event.key === '=') { zoom(1.35); event.preventDefault(); return; }
    if (event.key === '-') { zoom(1 / 1.35); event.preventDefault(); return; }
    if (event.key === 'Home') { focusHome(); event.preventDefault(); return; }
    if (focused < 0) focused = view.players[observer() || game.turn].home;
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pickCell(focused); return; }
    const deltas = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], q: [1, -1], e: [-1, 1] };
    if (deltas[event.key]) { event.preventDefault(); const c = E.CELLS[focused], d = deltas[event.key], i = E.index(c.q + d[0], c.r + d[1]); if (i >= 0) { focused = i; hovered = -1; describeCell(i); const p = points[i]; if (Math.abs(p.x - camera.x) > camera.width / camera.scale * .4 || Math.abs(p.y - camera.y) > camera.height / camera.scale * .4) { camera.x = p.x; camera.y = p.y; } draw(); } }
  });
  function miniPan(event) { const p = localPoint(event, mini), m = miniTransform(); camera.x = (p.x - m.width / 2) / m.scale; camera.y = (p.y - m.height / 2) / m.scale; draw(); }
  mini.addEventListener('pointerdown', event => { mini.setPointerCapture(event.pointerId); miniPan(event); });
  mini.addEventListener('pointermove', event => { if (mini.hasPointerCapture(event.pointerId)) miniPan(event); });
  mini.addEventListener('keydown', event => { const delta = { ArrowLeft: [-4, 0], ArrowRight: [4, 0], ArrowUp: [0, -4], ArrowDown: [0, 4] }[event.key]; if (delta) { event.preventDefault(); camera.x += delta[0]; camera.y += delta[1]; draw(); } });
  $('play').addEventListener('click', () => { if (game.phase !== 'ready') return; try { const next = S.normalize($('strategy-json').value); if (S.id(next) !== S.id(strategyConfig)) applyStrategy(next); } catch (error) { $('strategy-status').textContent = error.message; $('strategy-status').classList.add('error'); $('strategy-json').closest('details').open = true; $('strategy-json').focus(); return; } reset({ start: true }); });
  $('pause').addEventListener('click', () => { flushClock(); if (game.phase === 'running') game.pause(); else if (game.phase === 'paused') game.start(); message = ''; error = false; render(); schedule(); });
  $('restart').addEventListener('click', () => reset({ fresh: true }));
  if ($('snapshot')) {
    const closeSnapshot = () => { const d = $('snapshot-dialog'); if (d.open) d.close ? d.close() : d.removeAttribute('open'); };
    $('snapshot').addEventListener('click', takeSnapshot);
    $('snapshot-close').addEventListener('click', closeSnapshot);
    $('snapshot-resume').addEventListener('click', () => { closeSnapshot(); flushClock(); if (game.phase === 'paused') game.start(); message = ''; error = false; render(); schedule(); });
  }
  $('replay').addEventListener('click', () => { if (recipe) { const saved = recipe; $('seed').value = saved.seed; $('starter').value = saved.first; $('rotation').value = saved.rotation; $('neutral-events').value = saved.neutralEvents ? 'on' : 'off'; $('terrain-mode').value = saved.terrain === 'classic' ? 'plain' : 'mixed'; $('timed-cards').value = saved.timedCards ? 'timed' : 'keep'; $('seat-count').value = saved.playerCount; strategyConfig = S.normalize(saved.strategyConfig); seatControls(); saved.uiSeats.forEach((seat, i) => { $(`seat-control-${i + 1}`).value = seat.control; $(`seat-profile-${i + 1}`).value = seat.strategy; }); } reset({ start: wasStarted }); });
  $('match-mode').addEventListener('change', () => { seatControls($('match-mode').value); reset(); });
  $('seat-count').addEventListener('change', () => { seatControls($('match-mode').value === 'local' ? undefined : $('match-mode').value); reset(); });
  $('seed').addEventListener('change', () => { if (game.phase === 'ready') reset(); });
  for (const id of ['starter', 'neutral-events', 'terrain-mode', 'timed-cards']) $(id).addEventListener('change', () => { if (game.phase === 'ready') reset(); });
  $('rotation').addEventListener('change', () => { for (const p of P) $(`seat-profile-${p}`).value = strategyConfig.profiles[(p - 1 + Number($('rotation').value)) % strategyConfig.profiles.length].id; reset(); });
  $('strategy-apply').addEventListener('click', () => applyStrategy($('strategy-json').value));
  $('strategy-default').addEventListener('click', () => applyStrategy(S.DEFAULT_CONFIG));
  $('strategy-file').addEventListener('change', async event => { const file = event.target.files[0]; if (!file) return; if (file.size > S.MAX_BYTES) { $('strategy-status').textContent = '策略 JSON 檔案不能超過 32 KiB。'; return; } const text = await file.text(); if (!['ready', 'over'].includes(game.phase)) return; applyStrategy(text); });
  $('reveal-hand').addEventListener('click', () => { if (isAiTurn() || game.phase !== 'running') return; revealedHuman = game.turn; handoffPly = game.ply; render(); canvas.focus({ preventScroll: true }); schedule(); });
  $('step-seconds').addEventListener('change', () => { $('step-seconds').value = Math.max(.05, Math.min(10, Number($('step-seconds').value) || .3)).toFixed(2); schedule(); });
  $('step').addEventListener('click', () => { if (mode !== 'spectator' || !['ready', 'paused'].includes(game.phase)) return; stopTimers(); effects.clearActive(); game.start(); const action = chooseAiAction(game.observation(game.turn)); if (!action || !game.act(action)) game.act({ type: 'rest', cells: [] }); game.pause(); wasStarted = true; message = ''; render(); });
  $('sandbox').addEventListener('click', () => { game.continueSandbox(); message = ''; render(); schedule(); });
  for (const type of ['deploy', 'engineer', 'withdraw', 'tunnel', 'airdrop', 'bombard', 'breach']) $(type).addEventListener('click', () => selectAction(type));
  $('rest').addEventListener('click', () => perform({ type: 'rest', cells: [] }));
  $('discard').addEventListener('click', () => perform({ type: 'discard', cells: [], cardIndex: Number($('discard-card').value) }));
  $('back-selection').addEventListener('click', () => { selection.cells.pop(); message = ''; error = false; render(); });
  $('confirm-selection').addEventListener('click', () => perform(actionFor(selection.cells)));
  $('cancel-selection').addEventListener('click', () => selectAction('deploy'));
  $('diplomacy-target').addEventListener('change', renderDiplomacy);
  for (const type of ['offer', 'betray']) $(type).addEventListener('click', () => perform({ type, target: Number($('diplomacy-target').value), cells: [] }));
  $('zoom-in').addEventListener('click', () => zoom(1.4)); $('zoom-out').addEventListener('click', () => zoom(1 / 1.4)); $('fit-map').addEventListener('click', fitMap); $('home-view').addEventListener('click', focusHome);
  $('show-range').addEventListener('change', () => { computeLegalTargets(); draw(); });
  $('plan-faction').addEventListener('change', () => { plannerChoice = $('plan-faction').value; renderPlanner(); draw(); });
  $('plan-focus').addEventListener('click', () => { if (displayedPlan?.target !== null && displayedPlan) { focusCell(displayedPlan.target); canvas.scrollIntoView({ block: 'nearest' }); } });
  $('supply-mode').addEventListener('change', draw);
  $('inspect-mode').addEventListener('click', () => { inspectMode = !inspectMode; if (!inspectMode) cutEnabled = false; selection.cells = []; paintInspection(); draw(); });
  cutButton.addEventListener('click', () => { cutEnabled = !cutEnabled; if (cutEnabled) inspectMode = true; selection.cells = []; paintInspection(); draw(); });
  $('clear-inspection').addEventListener('click', () => { inspectedCell = -1; inspectedRange = null; paintInspection(); draw(); });
  reducedQuery.addEventListener('change', draw);
  document.addEventListener('visibilitychange', () => { if (document.hidden && game.phase === 'running') { if (humanSeats().length > 1) revealedHuman = 0; flushClock(); game.pause(); message = '頁面移到背景，戰役已自動暫停。回來後按「繼續」。'; } render(); schedule(); });
  window.addEventListener('pagehide', () => { flushClock(); if (game.phase === 'running') game.pause(); stopTimers(); aiWorker?.terminate(); aiWorker = null; });
  const rules = Object.entries(E.CARD_META).map(([type, m]) => { const el = node('div', 'ah-card-rule'); el.append(node('strong', '', `${MARKS[type] || '◇'} ${label(type)} · ${m.cost} 能量 · ${m.slots} 格`), node('p', '', CARD_GUIDE[type] || m.description)); return el; });
  $('card-rules').replaceChildren(...rules);
  const params = new URLSearchParams(location.search); if (params.get('seed')) $('seed').value = params.get('seed').slice(0, 64); if (params.get('mode') === 'spectator') $('match-mode').value = 'spectator';
  window.autoHexRender = render; window.autoHexSchedule = schedule;
  window.autoHexCellPoint = i => { const p = points[i], r = canvas.getBoundingClientRect(); return p ? { x: r.left + camera.width / 2 + (p.x - camera.x) * camera.scale, y: r.top + camera.height / 2 + (p.y - camera.y) * camera.scale } : null; };
  window.autoHexFocusCell = focusCell;
  window.autoHexPlannerDebug = () => ({ selectedPlayer: plannerChoice === 'off' ? null : Number(plannerChoice), visible: !!displayedPlan, plan: displayedPlan ? { ...displayedPlan, path: displayedPlan.path.slice() } : null, routeCellCount: displayedPlan?.path.length || 0, minTargetPixel: 14, styles: { route: 'dashed public corridor', target: 'faction diamond', motion: 'static' } });
  window.autoHexPlanningDebug = () => ({ ...planningTiming, recentMs: planningTiming.recentMs.slice() });
  window.autoHexRenderDebug = () => ({ ...renderCache, canvasCount: 2, cacheBytes: (boardLayer.width * boardLayer.height + frontLayer.width * frontLayer.height) * 4 });
  window.autoHexUI = () => ({ mode, camera: { ...camera }, selection: { ...selection, cells: selection.cells.slice() }, generation, timing, scheduled: aiTimer !== null || pendingDecision !== null, observer: observer(), coreConfig: { ...view.coreConfig }, seats: seats.map(s => ({ ...s })), handoff: !$('handoff').hidden, strategyConfigId: view.strategyConfigId, workerPending: pendingDecision ? { id: pendingDecision.id, generation: pendingDecision.generation, ply: pendingDecision.ply, turn: pendingDecision.turn } : null, workerReady: !!aiWorker, workerFallback: workerFailed || typeof Worker !== 'function' });
  window.autoHexVisualDebug = () => ({ ...effects.snapshot(), activeEffects: effects.effects.length, turretCount: view.turrets.length, minTurretPixel: 12, turretPixel: Math.max(12, camera.scale * 1.35), supplyLinks: shownSupplyLinks().map(link => ({ ...link })), supplyMode: $('supply-mode').value, range: inspectedRange ? { ...inspectedRange, cells: inspectedRange.cells.slice(), targets: inspectedRange.targets.slice() } : null, reduced: reducedQuery.matches, inspectMode, airports: (view.airports || []).map(a => ({ ...a })), depots: (view.depots || []).map(d => ({ ...d })), fortifiedCells: (view.fortified || []).map((v, i) => v ? i : -1).filter(i => i >= 0), airRange: { type: isAirAction() ? selection.type : null, source: selection.cells[0] ?? null, cells: airRangeCells.slice(), targets: [...rangeValid] }, neutralWarning: view.neutralWarning ? { ...view.neutralWarning, cells: view.neutralWarning.cells.slice() } : null, styles: { supply: 'home-rooted tree', disconnected: 'hollow dashed countdown', turret: 'base barrel faction countdown', collapse: 'piece fragments, terrain retained' } });
  if (normal) { $('seat-count-label').hidden = false; $('match-mode').replaceChildren(...[['human','你 + 本機 AI'],['allhuman','全部本機玩家'],['spectator','全部 AI 觀戰'],['local','自訂座位']].map(([value,title]) => { const o = node('option', '', title); o.value = value; return o; })); if (params.get('mode') === 'spectator') $('match-mode').value = 'spectator'; $('neutral-events').value = 'off'; $('play').textContent = '開始連線'; $('board-heading').textContent = '對岸連線'; $('campaign-note').textContent = '先完成家園到對岸的補給連線獲勝；同次結算接通可共享勝利。每方最多 100 次行動，達上限依分數結算。'; $('winning-rules').textContent = '自己的相鄰棋子、橋梁與地道從永久家園接通同色對岸，在本次行動與效果結算後獲勝；同時接通共享勝利。每方最多 100 次行動，達上限依分數結算。'; $('timing-rules').textContent = '一般 Hex 沒有十分鐘倒數。人的思考不消耗行動額度；暫停與離開分頁會停止 AI，返回後手動繼續。全 AI 模式可單步或連續觀戰。'; $('diplomacy-rules').hidden = true; $('seat-note').textContent = '同一台裝置輪流遊玩，手牌交接時隱藏。2、3、6 方方向等距；4 方成對對稱，5 方方向間隔不完全相同。'; }
  $('strategy-json').value = JSON.stringify(strategyConfig, null, 2); $('strategy-id').textContent = S.id(strategyConfig);
  seatControls($('match-mode').value);
  window.hexRender = render; window.hexSchedule = schedule; window.hexUI = window.autoHexUI; window.hexCellPoint = window.autoHexCellPoint;
  reset(); resize(); fitMap();
  new ResizeObserver(resize).observe($('board-wrap'));
})();
