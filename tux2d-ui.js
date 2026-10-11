/* Original vector presentation and input for Tux 2D. */
(() => {
  'use strict';
  const E = window.Tux2D, $ = id => document.getElementById(id), canvas = $('tux-board'), ctx = canvas.getContext('2d'), mini = $('tux-minimap'), mc = mini.getContext('2d');
  if (!E) { $('tux-status').textContent = '賽道載入失敗，請重新整理。'; return; }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)'), keys = new Set(), touches = new Map();
  const SYMBOLS = { snowball: '❄', banana: '⌁', shield: '◎', boost: '»' };
  const camera = { x: 640, y: 450, scale: 1, width: 1, height: 1, overview: false };
  let game, view, animation = null, generation = 0, previousFrame = 0, accumulator = 0, hudAt = 0, started = false, itemPulse = false;
  const background = document.createElement('canvas'); background.width = 1920; background.height = 1350;
  const bg = background.getContext('2d'); bg.scale(1.5, 1.5);
  const node = (tag, className, value) => { const el = document.createElement(tag); if (className) el.className = className; if (value !== undefined) el.textContent = value; return el; };
  const timeText = time => `${Math.floor(time / 60)}:${(time % 60).toFixed(2).padStart(5, '0')}`;
  const following = () => game.spectator ? Number($('follow-kart').value) : 0;
  const active = () => ['countdown', 'racing'].includes(game.phase);
  function roadPath(context) { context.beginPath(); E.TRACK.samples.forEach((p, i) => i ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y)); context.closePath(); }
  function ellipse(context, x, y, rx, ry, color) { context.fillStyle = color; context.beginPath(); context.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); context.fill(); }
  function tree(context, x, y, size) {
    ellipse(context, x + 5, y + size * .48, size * .48, size * .15, '#acc7cb55');
    context.fillStyle = '#8c9d91'; context.fillRect(x - 2, y + size * .12, 4, size * .35);
    for (let k = 0; k < 3; k++) { const width = size * (.52 - k * .11), top = y - size * (.25 + k * .21); context.fillStyle = k % 2 ? '#659a99' : '#477f82'; context.beginPath(); context.moveTo(x, top - size * .38); context.lineTo(x + width, top + size * .42); context.lineTo(x - width, top + size * .42); context.closePath(); context.fill(); context.fillStyle = '#f0f8f7'; context.beginPath(); context.moveTo(x, top - size * .38); context.lineTo(x + width * .6, top + size * .1); context.lineTo(x - width * .6, top + size * .1); context.closePath(); context.fill(); }
  }
  function lodge(context, x, y, width, height) {
    context.fillStyle = '#7e9a9c33'; context.fillRect(x + 7, y + 8, width, height);
    context.fillStyle = '#bf8f70'; context.fillRect(x, y, width, height);
    context.fillStyle = '#eef7f5'; context.beginPath(); context.moveTo(x - 6, y + 4); context.lineTo(x + width / 2, y - 20); context.lineTo(x + width + 6, y + 4); context.lineTo(x + width + 6, y + 16); context.lineTo(x - 6, y + 16); context.closePath(); context.fill();
    context.strokeStyle = '#9bb6b7'; context.lineWidth = 2; context.stroke();
    for (let i = 0; i < 3; i++) { context.fillStyle = '#f4d793'; context.fillRect(x + 10 + i * (width - 25) / 3, y + 24, 12, 13); context.strokeStyle = '#a5745a'; context.strokeRect(x + 10 + i * (width - 25) / 3, y + 24, 12, 13); }
  }
  function makeBackground() {
    bg.fillStyle = '#e9f2f4'; bg.fillRect(0, 0, 1280, 900);
    ellipse(bg, 635, 470, 292, 174, '#d0e7eb'); ellipse(bg, 635, 467, 276, 158, '#b9d9e2'); ellipse(bg, 635, 465, 249, 139, '#cee8ed');
    bg.strokeStyle = '#edf8f9'; bg.lineWidth = 3;
    for (let i = 0; i < 9; i++) { const x = 430 + i * 46, y = 398 + Math.sin(i * 2.6) * 39; bg.beginPath(); bg.moveTo(x, y); bg.lineTo(x + 27, y + 23); bg.lineTo(x + 9, y + 42); bg.lineTo(x + 54, y + 60); bg.stroke(); }
    bg.fillStyle = '#86b1be'; bg.font = '700 35px ui-monospace, monospace'; bg.textAlign = 'center'; bg.fillText('FROST', 620, 468); bg.font = '600 19px ui-monospace, monospace'; bg.fillText('H A R B O R', 620, 501);
    let n = 17; const rand = () => { n = Math.imul(n, 1664525) + 1013904223 | 0; return (n >>> 0) / 4294967296; };
    for (let i = 0; i < 150; i++) { const x = 30 + rand() * 1220, y = 30 + rand() * 840, insideLake = ((x - 635) / 330) ** 2 + ((y - 470) / 195) ** 2 < 1; if (E.project(x, y).distance > 105 && !insideLake) tree(bg, x, y, 15 + rand() * 14); }
    lodge(bg, 735, 380, 79, 51); lodge(bg, 404, 494, 64, 44);
    bg.strokeStyle = '#a0bcc3'; bg.lineWidth = 12; bg.beginPath(); bg.moveTo(765, 440); bg.lineTo(765, 497); bg.stroke(); bg.strokeStyle = '#cedfe0'; bg.lineWidth = 3; for (let y = 445; y < 494; y += 8) { bg.beginPath(); bg.moveTo(754, y); bg.lineTo(776, y); bg.stroke(); }
    roadPath(bg); bg.lineJoin = 'round'; bg.strokeStyle = '#b4c9d0'; bg.lineWidth = E.TRACK.barrier * 2 + 8; bg.stroke(); bg.strokeStyle = '#fcfefe'; bg.lineWidth = E.TRACK.barrier * 2; bg.stroke(); bg.strokeStyle = '#c4d7db'; bg.lineWidth = 137; bg.stroke(); bg.strokeStyle = '#8fa8b1'; bg.lineWidth = E.TRACK.halfWidth * 2; bg.stroke();
    bg.strokeStyle = '#c1d1d5'; bg.lineWidth = 1.5; bg.setLineDash([10, 15]); roadPath(bg); bg.stroke(); bg.setLineDash([]);
    for (let s = 0; s < E.TRACK.length; s += 16) for (const side of [-1, 1]) { const a = E.pointAt(s), b = E.pointAt(s + 15); bg.strokeStyle = Math.floor(s / 16) % 2 ? '#f5f8f7' : '#cc947d'; bg.lineWidth = 7; bg.beginPath(); bg.moveTo(a.x - a.ty * 64 * side, a.y + a.tx * 64 * side); bg.lineTo(b.x - b.ty * 64 * side, b.y + b.tx * 64 * side); bg.stroke(); }
    for (let s = 140; s < E.TRACK.length; s += 250) { const p = E.pointAt(s); bg.save(); bg.translate(p.x, p.y); bg.rotate(p.angle); bg.strokeStyle = '#e3edef99'; bg.lineWidth = 3; bg.beginPath(); bg.moveTo(-9, -8); bg.lineTo(3, 0); bg.lineTo(-9, 8); bg.stroke(); bg.restore(); }
    const start = E.pointAt(0); bg.save(); bg.translate(start.x, start.y); bg.rotate(start.angle);
    for (let y = -60; y < 60; y += 10) for (let x = -6; x < 6; x += 6) { bg.fillStyle = (Math.floor(y / 10) + x / 6) % 2 ? '#f8ffff' : '#455b67'; bg.fillRect(x, y, 6, 10); }
    bg.restore();
    for (const side of [-1, 1]) { const x = start.x - start.ty * 100 * side, y = start.y + start.tx * 100 * side; bg.strokeStyle = '#66828c'; bg.lineWidth = 3; bg.beginPath(); bg.moveTo(x, y); bg.lineTo(x, y - 24); bg.stroke(); bg.fillStyle = side < 0 ? '#5ca4a5' : '#cb8e78'; bg.beginPath(); bg.moveTo(x, y - 24); bg.lineTo(x + 22, y - 18); bg.lineTo(x, y - 12); bg.closePath(); bg.fill(); }
  }
  function clearInputs() { keys.clear(); touches.clear(); itemPulse = false; document.querySelectorAll('.tux-touch .pressed').forEach(el => el.classList.remove('pressed')); }
  function held(name) { return [...touches.values()].includes(name); }
  function inputState() {
    const brake = keys.has('ArrowDown') || keys.has('KeyS') || held('brake');
    return { throttle: !brake && ($('auto-throttle').checked || keys.has('ArrowUp') || keys.has('KeyW') || held('throttle')) ? 1 : 0, brake: brake ? 1 : 0, steer: (keys.has('ArrowRight') || keys.has('KeyD') || held('right') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('KeyA') || held('left') ? 1 : 0), drift: keys.has('ShiftLeft') || keys.has('ShiftRight') || keys.has('KeyZ') || held('drift'), useItem: itemPulse || keys.has('Space') || held('item') };
  }
  function stop() { generation++; cancelAnimationFrame(animation); animation = null; accumulator = 0; }
  function schedule() {
    stop(); if (!active() || document.hidden) return;
    const token = generation; previousFrame = performance.now();
    const tick = now => {
      if (token !== generation) return;
      if (document.hidden || !active()) { stop(); render(); return; }
      const next = Math.max(previousFrame, now); accumulator += Math.min(.1, (next - previousFrame) / 1000); previousFrame = next;
      while (accumulator + 1e-9 >= E.DT && active()) { game.step(inputState()); itemPulse = false; accumulator -= E.DT; }
      view = game.observation(game.spectator ? -1 : 0); draw();
      if (now - hudAt >= 100 || game.phase !== 'racing') { paintHud(); hudAt = now; }
      if (game.phase === 'over') { clearInputs(); stop(); paintHud(); return; }
      animation = requestAnimationFrame(tick);
    };
    animation = requestAnimationFrame(tick);
  }
  function reset(start = false) { stop(); clearInputs(); game = new E.Game({ seed: $('tux-seed').value.trim() || 'snow-harbor', spectator: $('tux-mode').value === 'spectator' }); window.tux2dGame = game; camera.x = 640; camera.y = 450; started = start; if (start) game.start(); render(); schedule(); if (start) canvas.focus({ preventScroll: true }); }
  function startRace() { if (game.phase !== 'ready') return; started = true; game.start(); clearInputs(); render(); schedule(); if (matchMedia('(pointer: coarse), (max-height: 550px) and (orientation: landscape)').matches || innerWidth <= 800) document.querySelector('.tux-arena').scrollIntoView({ block: 'start', behavior: reduced.matches ? 'instant' : 'smooth' }); canvas.focus({ preventScroll: true }); }
  function togglePause() { if (game.phase === 'paused') game.start(); else if (active()) game.pause(); clearInputs(); render(); schedule(); if (active()) canvas.focus({ preventScroll: true }); }
  function paintHud() {
    const r = view.racers[following()], own = view.racers[0], standing = view.standings.find(s => s.id === r.id), ready = game.phase === 'ready', paused = game.phase === 'paused';
    $('race-position').replaceChildren(document.createTextNode(`${standing.rank} `), node('em', '', '/ 5'));
    $('race-lap').replaceChildren(document.createTextNode(`${Math.min(3, r.lap + 1)} `), node('em', '', '/ 3'));
    $('race-speed').replaceChildren(document.createTextNode(`${Math.round(Math.abs(r.speed) * .55)} `), node('em', '', 'km/h'));
    $('race-time').textContent = timeText(game.elapsed); $('tux-play').hidden = !ready;
    for (const id of ['tux-pause', 'race-pause']) $(id).disabled = ready || game.phase === 'over';
    $('tux-pause').textContent = paused ? '繼續' : '暫停'; $('race-pause').textContent = paused ? '▶' : 'Ⅱ'; $('race-pause').setAttribute('aria-label', paused ? '繼續比賽' : '暫停比賽');
    $('tux-mode').disabled = !ready && game.phase !== 'over'; $('tux-seed').disabled = !ready && game.phase !== 'over'; $('follow-label').hidden = !game.spectator;
    $('auto-throttle').disabled = game.spectator;
    const status = ready ? '沿箭頭方向完成 3 圈。每圈依序通過 12 個檢查點。' : paused ? '已暫停。賽車、道具與時間都已凍結。' : game.phase === 'countdown' ? '握穩方向，準備出發。' : game.phase === 'over' ? '全部車手完賽，成績已公布。' : own.finished && !game.spectator ? '你已完賽！其他車手仍在衝刺，車序會繼續更新。' : game.spectator ? '五位本機 AI 競速中。可更換跟拍車手。' : r.stun > 0 ? '受到道具影響，短暫減速；保持方向即可恢復。' : '看準彎道，甩尾蓄力後放開加速。';
    if ($('tux-status').textContent !== status) $('tux-status').textContent = status;
    const overlay = $('race-overlay'); overlay.hidden = game.phase === 'racing' || game.phase === 'over'; overlay.classList.toggle('countdown', game.phase === 'countdown'); overlay.classList.toggle('paused', paused);
    $('overlay-title').textContent = ready ? '歡迎來到雪港' : paused ? '已暫停 · P / 點按繼續' : String(Math.max(1, Math.ceil(game.countdown)));
    $('overlay-copy').textContent = '平緩直線、湖畔 S 彎，還有四位想超車的朋友。';
    const charged = r.driftCharge >= .6; $('drift-fill').style.width = `${r.driftCharge / 1.5 * 100}%`; $('drift-progress').classList.toggle('charged', charged); $('drift-progress').setAttribute('aria-valuenow', String(Math.round(r.driftCharge / 1.5 * 100))); $('drift-label').textContent = r.boost > 0 ? `加速中 · ${r.boost.toFixed(1)}s` : charged ? '蓄力完成！放開甩尾' : r.drifting ? '甩尾蓄力中…' : '甩尾蓄力';
    const item = game.spectator ? null : own.item; $('item-symbol').textContent = SYMBOLS[item] || '◇'; $('item-name').textContent = game.spectator ? '觀戰 · 道具不公開' : E.ITEMS[item]?.name || '尚無道具'; $('item-help').textContent = E.ITEMS[item]?.description || '拾取賽道上的禮物盒';
    for (const id of ['race-item', 'touch-item']) { $(id).disabled = game.spectator || !item || game.phase !== 'racing' || own.finished; $(id).classList.toggle('ready', !!item && !game.spectator); }
    for (const id of ['left', 'right', 'throttle', 'brake', 'drift']) $(`touch-${id}`).disabled = game.spectator || !active() || own.finished;
    const wrong = !r.finished && r.speed > 30 && Math.cos(r.angle - E.project(r.x, r.y).angle) < -.2;
    $('checkpoint-hint').textContent = r.finished ? '已完賽 ✓' : wrong ? '逆向！請掉頭沿箭頭前進' : r.started ? `下一個檢查點 ${r.checkpoint || '終點'} / 12` : '起跑線在前方 →'; $('checkpoint-hint').style.color = wrong ? '#a65e46' : '#267477';
    $('tux-standings').replaceChildren(...view.standings.map(s => { const racer = view.racers[s.id], li = node('li', s.id === 0 && !game.spectator ? 'you' : ''); li.style.setProperty('--racer', racer.color); li.append(node('b', '', s.rank), node('span', 'tux-driver-dot'), node('strong', '', `${s.name}${s.id === 0 && !game.spectator ? ' / 你' : ''}`), node('small', '', s.finished ? timeText(s.time) : `第 ${Math.min(3, s.lap + 1)} 圈${racer.hasItem ? ' ◇' : ''}`)); return li; }));
    $('tux-result').hidden = game.phase !== 'over';
    if (game.phase === 'over') { const rank = view.standings.find(s => s.id === 0).rank; $('tux-result-title').textContent = game.spectator ? `${view.standings[0].name} 奪得雪港盃` : rank === 1 ? 'Tux 奪冠！雪港盃是你的。' : `完賽！你拿下第 ${rank} 名`; $('tux-result-copy').textContent = `三圈、36 個順序檢查點。${game.spectator ? '五位車手全數完賽。' : `你的成績 ${timeText(own.finishTime)}。`}`; $('tux-final-standings').replaceChildren(...view.standings.map(s => node('li', '', `${s.rank}. ${s.name} — ${timeText(s.time)}`))); }
  }
  function render() { view = game.observation(game.spectator ? -1 : 0); paintHud(); draw(); }
  function resize() { const r = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2.5); camera.width = r.width; camera.height = r.height; canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr); const mr = mini.getBoundingClientRect(); mini.width = Math.round(mr.width * dpr); mini.height = Math.round(mr.height * dpr); draw(); }
  function drawKart(r) {
    ctx.save(); ctx.translate(r.x, r.y); ctx.rotate(r.angle + Math.PI / 2); const size = Math.max(1, 12 / camera.scale / 26); ctx.scale(size, size); if (r.finished) ctx.globalAlpha = .5;
    if (r.boost > 0 && !r.finished) { ctx.fillStyle = '#f5c86aaa'; ctx.beginPath(); ctx.moveTo(-7, 14); ctx.lineTo(0, reduced.matches ? 33 : 33 + Math.sin(game.elapsed * 27) * 5); ctx.lineTo(7, 14); ctx.fill(); ctx.fillStyle = '#fff5c3'; ctx.beginPath(); ctx.moveTo(-4, 14); ctx.lineTo(0, 27); ctx.lineTo(4, 14); ctx.fill(); }
    ellipse(ctx, 2, 3, 13, 16, '#36525e44'); ctx.fillStyle = '#344652'; for (const x of [-13, 8]) for (const y of [-10, 6]) ctx.fillRect(x, y, 5, 8);
    ctx.fillStyle = r.color; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.roundRect(-10, -15, 20, 31, 6); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#dce8e8'; ctx.fillRect(-7, -15, 14, 4); ctx.fillStyle = r.color; ctx.fillRect(-10, 11, 20, 5);
    ellipse(ctx, 0, -1, 8, 11, '#253743'); ellipse(ctx, 0, 3, 5.7, 7, '#fffdf4'); ellipse(ctx, -3, -5, 3.5, 4.8, '#fffdf4'); ellipse(ctx, 3, -5, 3.5, 4.8, '#fffdf4'); ellipse(ctx, -2.5, -6.5, 1, 1.4, '#253743'); ellipse(ctx, 2.5, -6.5, 1, 1.4, '#253743'); ctx.fillStyle = '#e8ad4d'; ctx.beginPath(); ctx.moveTo(-3, -3); ctx.lineTo(0, -7); ctx.lineTo(3, -3); ctx.closePath(); ctx.fill();
    if (r.drifting && !r.finished) { ctx.fillStyle = r.driftCharge >= .6 ? '#e9b14d' : '#b9e3f3'; for (const x of [-13, 13]) { ctx.beginPath(); ctx.moveTo(x, 11); ctx.lineTo(x + (x < 0 ? -4 : 4), 19); ctx.lineTo(x, 16); ctx.lineTo(x - 2, 21); ctx.fill(); } }
    if (r.shield > 0 && !r.finished) { ctx.strokeStyle = '#a5e1f2'; ctx.lineWidth = 2.8; ctx.beginPath(); ctx.ellipse(0, 0, 18, 22, 0, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = '#c7edfa20'; ctx.fill(); }
    ctx.restore();
    if (r.id === following() && !r.finished) { ctx.save(); const font = Math.max(11, 9 / camera.scale); ctx.font = `bold ${font}px sans-serif`; ctx.textAlign = 'center'; const title = game.spectator ? r.name : 'YOU'; const w = ctx.measureText(title).width + 10; ctx.fillStyle = '#fff'; ctx.fillRect(r.x - w / 2, r.y - 35 - font / 2, w, font + 3); ctx.fillStyle = r.color; ctx.fillText(title, r.x, r.y - 31); ctx.beginPath(); ctx.moveTo(r.x - 3, r.y - 22); ctx.lineTo(r.x + 3, r.y - 22); ctx.lineTo(r.x, r.y - 18); ctx.fill(); ctx.restore(); }
  }
  function draw() {
    if (!view || !camera.width) return;
    const r = view.racers[following()];
    const overview = camera.overview || game.phase === 'ready' || game.phase === 'over';
    camera.scale = overview ? Math.min(camera.width / 1280, camera.height / 900) * .97 : camera.width < 500 ? .72 : Math.min(1, camera.width / 840);
    camera.x = overview ? 640 : r.x + Math.cos(r.angle) * 55; camera.y = overview ? 450 : r.y + Math.sin(r.angle) * 55;
    const dpr = canvas.width / camera.width; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#e9f2f4'; ctx.fillRect(0, 0, camera.width, camera.height); ctx.translate(camera.width / 2, camera.height / 2); ctx.scale(camera.scale, camera.scale); ctx.translate(-camera.x, -camera.y); ctx.drawImage(background, 0, 0, 1280, 900);
    if (!r.finished && game.phase !== 'ready') { const g = E.TRACK.checkpoints[r.checkpoint]; ctx.save(); ctx.strokeStyle = '#d7fae4aa'; ctx.lineWidth = 5; ctx.setLineDash([8, 9]); ctx.beginPath(); ctx.moveTo(g.x - g.ty * 55, g.y + g.tx * 55); ctx.lineTo(g.x + g.ty * 55, g.y - g.tx * 55); ctx.stroke(); ctx.restore(); }
    for (const box of view.pickups) { ctx.save(); ctx.translate(box.x, box.y); ctx.rotate(Math.PI / 4); ctx.globalAlpha = box.cooldown > 0 ? .18 : 1; ctx.fillStyle = '#f8e4af'; ctx.strokeStyle = '#a18542'; ctx.lineWidth = 1.5; ctx.fillRect(-8, -8, 16, 16); ctx.strokeRect(-8, -8, 16, 16); ctx.fillStyle = '#fffdf2'; ctx.fillRect(-1.7, -8, 3.4, 16); ctx.fillRect(-8, -1.7, 16, 3.4); ctx.restore(); }
    for (const h of view.hazards) { ctx.save(); ctx.translate(h.x, h.y); ctx.strokeStyle = h.armed ? '#d29b32' : '#9d9582'; ctx.lineWidth = 1.8; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = '#f1cb62'; ctx.beginPath(); ctx.moveTo(0, -8); ctx.quadraticCurveTo(0, 2, 10, 6); ctx.quadraticCurveTo(4, 9, 0, 4); ctx.quadraticCurveTo(-4, 10, -10, 6); ctx.quadraticCurveTo(-2, 2, 0, -8); ctx.fill(); ctx.strokeStyle = '#aa8035'; ctx.lineWidth = 1; ctx.stroke(); ctx.restore(); }
    for (const p of view.projectiles) { ctx.strokeStyle = '#f4fcffaa'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(p.x, p.y); const n = Math.hypot(p.vx, p.vy); ctx.lineTo(p.x - p.vx / n * 25, p.y - p.vy / n * 25); ctx.stroke(); ellipse(ctx, p.x, p.y, 6, 6, '#fff'); ctx.strokeStyle = '#8ab9cb'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.stroke(); }
    for (const kart of view.racers.slice().sort((a, b) => a.y - b.y)) drawKart(kart);
    for (const event of view.events) { const age = game.elapsed - event.time; if (!['hit', 'block', 'wall'].includes(event.type) || age > .6 || event.x === undefined) continue; ctx.save(); ctx.globalAlpha = reduced.matches ? .7 : 1 - age / .6; ctx.strokeStyle = event.type === 'block' ? '#5db5cd' : '#e0aa4a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(event.x, event.y, reduced.matches ? 23 : 13 + age * 34, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
    drawMini();
  }
  function drawMini() { const rect = mini.getBoundingClientRect(), scale = Math.min(rect.width / 1280, rect.height / 900) * .88, dpr = mini.width / rect.width; mc.setTransform(dpr, 0, 0, dpr, 0, 0); mc.clearRect(0, 0, rect.width, rect.height); mc.translate(rect.width / 2, rect.height / 2); mc.scale(scale, scale); mc.translate(-640, -450); roadPath(mc); mc.strokeStyle = '#cad9de'; mc.lineWidth = 65; mc.lineJoin = 'round'; mc.stroke(); for (const r of view.racers) { mc.fillStyle = r.color; mc.strokeStyle = '#fff'; mc.lineWidth = 1 / scale; mc.beginPath(); mc.arc(r.x, r.y, (r.id === following() ? 3.5 : 2.4) / scale, 0, Math.PI * 2); mc.fill(); mc.stroke(); } }
  const gameKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyZ', 'ShiftLeft', 'ShiftRight', 'Space']);
  document.addEventListener('keydown', event => { if (['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) return; if (['KeyP', 'Escape'].includes(event.code) && !event.repeat) { event.preventDefault(); togglePause(); return; } if (!active() || event.code === 'Space' && event.target.closest('button')) return; if (gameKeys.has(event.code)) { event.preventDefault(); keys.add(event.code); } });
  document.addEventListener('keyup', event => { keys.delete(event.code); });
  for (const type of ['left', 'right', 'throttle', 'brake', 'drift', 'item']) { const button = $(`touch-${type}`); button.addEventListener('pointerdown', event => { event.preventDefault(); button.setPointerCapture(event.pointerId); touches.set(event.pointerId, type); if (type === 'item') itemPulse = true; button.classList.add('pressed'); }); const release = event => { touches.delete(event.pointerId); if (!held(type)) button.classList.remove('pressed'); }; button.addEventListener('pointerup', release); button.addEventListener('pointercancel', release); button.addEventListener('lostpointercapture', release); }
  $('touch-item').addEventListener('click', event => { if (event.detail === 0) itemPulse = true; });
  $('race-item').addEventListener('click', () => { itemPulse = true; });
  $('tux-play').addEventListener('click', startRace); for (const id of ['tux-pause', 'race-pause']) $(id).addEventListener('click', togglePause);
  $('tux-restart').addEventListener('click', () => reset(false)); $('tux-race-again').addEventListener('click', () => { reset(true); document.querySelector('.tux-arena').scrollIntoView({ block: 'start' }); });
  $('tux-mode').addEventListener('change', () => reset()); $('tux-seed').addEventListener('change', () => { if (game.phase === 'ready') reset(); });
  $('camera-mode').addEventListener('click', () => { camera.overview = !camera.overview; $('camera-mode').setAttribute('aria-pressed', String(camera.overview)); $('camera-mode').textContent = camera.overview ? '跟拍賽車' : '查看全圖'; draw(); }); $('follow-kart').addEventListener('change', render);
  document.addEventListener('visibilitychange', () => { if (document.hidden && active()) { game.pause(); clearInputs(); } render(); schedule(); }); window.addEventListener('blur', clearInputs); window.addEventListener('pagehide', () => { game.pause(); clearInputs(); stop(); });
  const params = new URLSearchParams(location.search); if (params.get('seed')) $('tux-seed').value = params.get('seed').slice(0, 40); if (params.get('mode') === 'spectator') $('tux-mode').value = 'spectator';
  window.tux2dRender = render; window.tux2dSchedule = schedule; window.tux2dUI = () => ({ generation, accumulator, scheduled: animation !== null, input: inputState(), camera: { ...camera }, spectator: game.spectator, observer: game.spectator ? -1 : 0 });
  makeBackground(); reset(); resize(); new ResizeObserver(resize).observe(canvas.parentElement);
})();
