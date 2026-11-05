/* HexBattle text view: turns an observation into a compact plain-text
   briefing (status, hand, market, ASCII hex map, forces) for language-model
   agents and terminal play. Pure function of the observation. */
(function (root, factory) {
  const engine = typeof module === 'object' && module.exports ? require('./engine.js') : root.HexBattleEngine;
  const api = factory(engine);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HexBattleText = api;
})(typeof window !== 'undefined' ? window : globalThis, function (E) {
  'use strict';
  const { CARDS, BUILDINGS, UNITS, TERRAIN } = E;
  const TER = { plain: '.', forest: '♣', hill: '^', mountain: 'M', water: '~', marsh: ',', bridge: '=', pass: 'n' };
  const BLD = { capital: 'C', farm: 'f', lumber: 'l', mine: 'm', market: '$', granary: 'g', outpost: 'o', barracks: 'b', workshop: 'w', tower: 't', wall: '#', shrine: 's' };
  const UNI = { militia: 'i', spear: 'p', archer: 'a', cavalry: 'k', scout: 'x', catapult: 'c', guardian: 'G', sentinel: 'S' };
  const cost = c => c ? Object.entries(c).filter(([, v]) => v).map(([k, v]) => v + ({ food: '糧', mat: '材', gold: '金' })[k]).join(' ') || '免費' : '免費';

  function cellLabel(obs, i) { const c = obs.map && obs.map.cells[i]; return c ? `${i}(${c.q},${c.r})` : String(i); }

  function mapText(obs) {
    const R = obs.map.R, byQR = new Map(obs.map.cells.map(c => [c.q + ',' + c.r, c]));
    const b = new Map(obs.buildings.map(x => [x.cell, x])), u = new Map(obs.units.map(x => [x.cell, x]));
    const intel = new Map((obs.intel || []).map(x => [x.cell, x]));
    const lines = [];
    lines.push('地圖：每格兩字元＝地形/物件 + 擁有者（數字；0 中立、? 爭奪、空白無主）。大寫建築＝可見，小括號＝記憶中的敵方建築。');
    for (let r = -R; r <= R; r++) {
      const q0 = Math.max(-R, -r - R);
      let line = ' '.repeat(Math.abs(r)) + `r${String(r).padStart(3)} q${String(q0).padStart(3)}→ `;
      for (let q = -R; q <= R; q++) {
        const c = byQR.get(q + ',' + r); if (!c) continue;
        const i = c.i, vis = !obs.visible || obs.visible[i];
        let ch;
        if (u.has(i)) { const x = u.get(i); ch = x.owner === obs.you ? UNI[x.type].toUpperCase() : UNI[x.type]; }
        else if (b.has(i)) { const x = b.get(i); ch = x.owner === obs.you ? BLD[x.type].toUpperCase() : BLD[x.type]; }
        else if (intel.has(i)) ch = '(';
        else if (c.f === 'relic') ch = 'R';
        else if (c.f === 'gold') ch = '*';
        else if (c.f === 'fertile' && c.t === 'plain') ch = '"';
        else ch = TER[c.t];
        const o = obs.territory[i];
        const own = o === null || o === undefined ? (vis ? ' ' : '░') : o === -1 ? '?' : o === 0 ? ' ' : String(o);
        line += ch + own;
      }
      lines.push(line);
    }
    lines.push('列首 r 是列座標，q 是該列第一格的 q，向右每格 +1。指令中的格子用 index（見下方列表）或 [q,r]。');
    lines.push('圖例：. 平原 ♣ 森林 ^ 丘陵 M 山 ~ 水 , 沼澤 = 橋 n 山道 R 遺跡 * 金脈 " 沃土；建築 C都城 F農田 L伐木 M礦場 $市集 G倉庫 O前哨 B兵營 W工坊 T箭塔 #城牆 S神殿（己方大寫）；部隊 I民兵 P槍兵 A弓兵 K騎兵 X斥候 C投石 G古衛 S哨靈（己方大寫）');
    return lines.join('\n');
  }

  function describe(obs, opts = {}) {
    const out = [];
    const me = obs.players.find(p => p.id === obs.you);
    out.push(`== HexBattle · 第 ${obs.round}/${obs.maxRounds} 輪 · 目標 ${obs.vpTarget} 分 · ${obs.phase === 'over' ? '已結束' : obs.turn === obs.you ? '輪到你' : '輪到 ' + obs.turn} ==`);
    out.push('各方：' + obs.players.map(p => `${p.id}${p.id === obs.you ? '(你)' : ''} ${p.name} ${p.alive ? p.vp + '分' : '出局'} 領土${p.territory} 建築${p.buildings} 部隊${p.units}`).join(' | '));
    if (me && obs.res) {
      const inc = obs.income;
      out.push(`資源：糧 ${obs.res.food} 材 ${obs.res.mat} 金 ${obs.res.gold}（上限 ${obs.cap}）· 下輪淨收入 糧${fmt(inc.net.food)} 材${fmt(inc.net.mat)} 金${fmt(inc.net.gold)}（部隊吃 ${inc.upkeep}、建築工人吃 ${inc.workers}${inc.idle.length ? '、' + inc.idle.length + ' 座缺糧停工' : ''}）· 指令點 ${obs.ap} · 交易 ${obs.tradeRate}:1`);
      out.push('手牌：' + (obs.hand.length ? obs.hand.map(c => `[${c.id}] ${CARDS[c.k].name}(${c.k}) ${CARDS[c.k].kind === 'vp' ? CARDS[c.k].vp + '分' : cost(c.cost) + (CARDS[c.k].ap ? ' ' + CARDS[c.k].ap + '點' : '')}`).join('  ') : '（空）'));
      out.push(`牌組：抽牌堆 ${obs.drawPile}、棄牌 ${obs.discard.length}、已移除 ${obs.trashed}`);
    }
    out.push('市場：' + obs.market.map(m => `#${m.slot} ${CARDS[m.k].name}(${m.k}) ${m.price}金`).join('  '));
    if (opts.map !== false && obs.map) out.push(mapText(obs));
    const mine = obs.buildings.filter(b => b.owner === obs.you);
    if (mine.length) out.push('你的建築：' + mine.map(b => `${BUILDINGS[b.type].name}@${cellLabel(obs, b.cell)} ${b.hp}/${b.max}${b.lvl > 1 ? ' Lv' + b.lvl : ''}${b.connected ? '' : ' 斷聯'}${b.hungry ? ' 缺糧' : ''}${b.train ? ' 訓練' + UNITS[b.train].name : ''}`).join('，'));
    const myU = obs.units.filter(u => u.owner === obs.you);
    if (myU.length) out.push('你的部隊：' + myU.map(u => `#${u.id} ${UNITS[u.type].name}@${cellLabel(obs, u.cell)} ${u.hp}/${u.max} ${({ advance: '進攻→' + u.goal, guard: '駐守' + u.anchor, hold: '原地' })[u.stance]}`).join('，'));
    const foes = obs.units.filter(u => u.owner !== obs.you), fb = obs.buildings.filter(b => b.owner !== obs.you);
    if (foes.length) out.push('可見敵軍：' + foes.map(u => `${u.owner}:${UNITS[u.type].name}@${u.cell} ${u.hp}/${u.max}`).join('，'));
    if (fb.length) out.push('可見敵方建築：' + fb.map(b => `${b.owner}:${BUILDINGS[b.type].name}@${b.cell} ${b.hp}/${b.max}`).join('，'));
    if (obs.intel && obs.intel.length) out.push('記憶中的敵方建築：' + obs.intel.map(x => `${x.owner}:${BUILDINGS[x.type].name}@${x.cell}(第${x.round}輪)`).join('，'));
    out.push('遺跡：' + obs.map.relics.map(r => `${r}${r === obs.map.center ? '(中央)' : ''}→${obs.territory[r] === null ? '未知' : obs.territory[r] === -1 ? '爭奪' : obs.territory[r] || '無主'}`).join('，'));
    if (obs.lastBattle && opts.battle !== false) {
      const ev = obs.lastBattle.frames.flat(), hits = ev.filter(e => e.e === 'hit').length;
      const deaths = ev.filter(e => e.e === 'die'), razes = ev.filter(e => e.e === 'raze');
      out.push(`上一輪戰鬥（第 ${obs.lastBattle.round} 輪，你看得到的部分）：命中 ${hits} 次，陣亡 ${deaths.length}${deaths.length ? '（' + deaths.map(d => d.owner + ':' + UNITS[d.type].name).join('、') + '）' : ''}，摧毀 ${razes.length}${razes.length ? '（' + razes.map(d => d.owner + ':' + BUILDINGS[d.type].name + '@' + d.cell).join('、') + '）' : ''}。得分 ${obs.lastBattle.scoring.map(s => s.player + '+' + s.gain).join(' ')}`);
    }
    if (obs.result) out.push('結果：' + obs.result.reason + '，勝者 ' + obs.winner + '；' + obs.result.standings.map(s => s.id + '=' + s.vp).join(' '));
    return out.join('\n');
  }
  const fmt = n => (n >= 0 ? '+' : '') + n;

  function actionText(a) {
    switch (a.type) {
      case 'play': return `play card ${a.card}` + (a.target !== undefined ? ` @${a.target}` : '') + (a.targets ? ` remove ${a.targets.join(',')}` : '');
      case 'sell': return `sell ${a.card}`;
      case 'buy': return `buy slot ${a.slot}`;
      case 'order': return `order ${Array.isArray(a.unit) ? a.unit.join(',') : a.unit} ${a.stance}` + (a.target !== undefined ? ` @${a.target}` : '');
      case 'upgrade': return `upgrade @${a.target}`;
      case 'train': return `train @${a.target} ${a.unit || 'none'}`;
      case 'trade': return `trade ${a.give}->${a.get}`;
      case 'end': return 'end' + (a.keep ? ` keep ${a.keep}` : '');
      default: return JSON.stringify(a);
    }
  }

  return { describe, mapText, actionText };
});
