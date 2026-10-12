/* Versioned data-only Hex strategies, shared by both games and their workers. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HexStrategies = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const VERSION = 1, MAX_BYTES = 32768, MAX_PROFILES = 12;
  // Style is the doctrine layer: which lane of the opposite edge a faction
  // aims for, how strongly it avoids the crowded centre, and how much it
  // values severing enemy supply, keeping its own supply redundant, and
  // claiming depots/territory. Older files without it get mission defaults.
  const STYLE_LANES = ['center', 'left', 'right', 'flank', 'adaptive'];
  const STYLE_WEIGHTS = ['centerAversion', 'raid', 'robustness', 'expansion'];
  const MISSION_STYLE = {
    connect: { lane: 'center', centerAversion: 0, raid: 0, robustness: 0, expansion: 0 },
    airhead: { lane: 'adaptive', centerAversion: 4, raid: 2, robustness: 3, expansion: 3 },
    flank: { lane: 'flank', centerAversion: 8, raid: 1, robustness: 2, expansion: 1 },
    interdict: { lane: 'adaptive', centerAversion: 3, raid: 9, robustness: 1, expansion: 0 },
    recover: { lane: 'adaptive', centerAversion: 3, raid: 1, robustness: 8, expansion: 2 },
    diplomat: { lane: 'adaptive', centerAversion: 5, raid: 1, robustness: 2, expansion: 7 }
  };
  const make = (id, name, mission, airportMode, transport, projection, diplomacy) => ({
    id, name, mission,
    route: { side: 0, transport, maxDetour: mission === 'flank' ? 12 : 8 },
    airport: { mode: airportMode, maxOwnActions: 18, maxSetupCost: 28, projection },
    commitment: { reviewOwnTurns: 6, stalledOwnTurns: 3, maxOwnTurns: 24 },
    diplomacy,
    style: { ...MISSION_STYLE[mission] }
  });
  function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
  const DEFAULT_CONFIG = freeze({ version: VERSION, profiles: [
    make('vanguard', '直進先鋒', 'connect', 'opportunity', 'both', 'either', 'avoid'),
    make('airhead', '航空支點', 'airhead', 'invest', 'both', 'turret', 'opportunity'),
    make('flanker', '地道側翼', 'flank', 'avoid', 'both', 'either', 'avoid'),
    make('interdict', '補給截斷', 'interdict', 'opportunity', 'bridge', 'bombard', 'avoid'),
    make('recover', '穩固推進', 'recover', 'opportunity', 'both', 'either', 'opportunity'),
    make('envoy', '協議擴張', 'diplomat', 'opportunity', 'both', 'either', 'opportunity')
  ] });
  const fail = (path, message) => { throw new TypeError('策略 JSON ' + path + ': ' + message); };
  function object(value, path, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(path, '必須是普通物件');
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || !keys.includes(key)) fail(path, '不支援欄位 ' + String(key));
      if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) fail(path, '不允許 getter / setter');
    }
    for (const key of keys) if (!Object.hasOwn(value, key)) fail(path + '.' + key, '缺少必要欄位');
  }
  function text(value, path, max) { if (typeof value !== 'string' || !value.trim() || [...value].length > max || /[\u0000-\u001f\u007f]/.test(value)) fail(path, '必須是 1–' + max + ' 字元的文字'); return value; }
  function integer(value, path, min, max) { if (!Number.isInteger(value) || value < min || value > max) fail(path, '必須是 ' + min + '–' + max + ' 的整數'); return value; }
  function option(value, path, values) { if (!values.includes(value)) fail(path, '必須是 ' + values.join(' / ')); return value; }
  function normalize(input = DEFAULT_CONFIG) {
    if (typeof input === 'string') {
      if (new TextEncoder().encode(input).length > MAX_BYTES) fail('$', '檔案不能超過 32 KiB');
      try { input = JSON.parse(input); } catch (error) { fail('$', '無法解析 JSON：' + error.message); }
    }
    object(input, '$', ['version', 'profiles']);
    if (input.version !== VERSION) fail('$.version', '只支援版本 1');
    if (!Array.isArray(input.profiles) || Object.getPrototypeOf(input.profiles) !== Array.prototype || input.profiles.length < 1 || input.profiles.length > MAX_PROFILES) fail('$.profiles', '必須有 1–12 個策略');
    const profileKeys = Reflect.ownKeys(input.profiles);
    if (profileKeys.length !== input.profiles.length + 1 || profileKeys.some(k => k !== 'length' && (typeof k !== 'string' || !/^(0|[1-9][0-9]*)$/.test(k) || Number(k) >= input.profiles.length))) fail('$.profiles', '必須是完整陣列，不能附加欄位');
    for (let i = 0; i < input.profiles.length; i++) if (!Object.hasOwn(Object.getOwnPropertyDescriptor(input.profiles, String(i)) || {}, 'value')) fail('$.profiles', '不允許空位、getter / setter');
    const ids = new Set();
    const profiles = input.profiles.map((profile, i) => {
      const p = '$.profiles[' + i + ']';
      const hasStyle = !!profile && typeof profile === 'object' && Object.hasOwn(profile, 'style');
      object(profile, p, ['id', 'name', 'mission', 'route', 'airport', 'commitment', 'diplomacy', ...(hasStyle ? ['style'] : [])]);
      const id = text(profile.id, p + '.id', 32);
      if (!/^[a-z][a-z0-9_-]*$/.test(id) || ['constructor', 'prototype', '__proto__'].includes(id)) fail(p + '.id', '使用小寫字母開頭的英數、底線或連字號');
      if (ids.has(id)) fail(p + '.id', '策略 ID 不可重複'); ids.add(id);
      object(profile.route, p + '.route', ['side', 'transport', 'maxDetour']);
      object(profile.airport, p + '.airport', ['mode', 'maxOwnActions', 'maxSetupCost', 'projection']);
      object(profile.commitment, p + '.commitment', ['reviewOwnTurns', 'stalledOwnTurns', 'maxOwnTurns']);
      const result = {
        id, name: text(profile.name, p + '.name', 32),
        mission: option(profile.mission, p + '.mission', ['connect', 'airhead', 'flank', 'interdict', 'recover', 'diplomat']),
        route: {
          side: integer(profile.route.side, p + '.route.side', -1, 1),
          transport: option(profile.route.transport, p + '.route.transport', ['ground', 'bridge', 'tunnel', 'both']),
          maxDetour: integer(profile.route.maxDetour, p + '.route.maxDetour', 0, 18)
        },
        airport: {
          mode: option(profile.airport.mode, p + '.airport.mode', ['avoid', 'opportunity', 'invest']),
          maxOwnActions: integer(profile.airport.maxOwnActions, p + '.airport.maxOwnActions', 6, 24),
          maxSetupCost: integer(profile.airport.maxSetupCost, p + '.airport.maxSetupCost', 6, 36),
          projection: option(profile.airport.projection, p + '.airport.projection', ['turret', 'bombard', 'either'])
        },
        commitment: {
          reviewOwnTurns: integer(profile.commitment.reviewOwnTurns, p + '.commitment.reviewOwnTurns', 2, 8),
          stalledOwnTurns: integer(profile.commitment.stalledOwnTurns, p + '.commitment.stalledOwnTurns', 2, 6),
          maxOwnTurns: integer(profile.commitment.maxOwnTurns, p + '.commitment.maxOwnTurns', 8, 36)
        },
        diplomacy: option(profile.diplomacy, p + '.diplomacy', ['avoid', 'opportunity'])
      };
      if (hasStyle) {
        object(profile.style, p + '.style', ['lane', ...STYLE_WEIGHTS]);
        result.style = { lane: option(profile.style.lane, p + '.style.lane', STYLE_LANES) };
        for (const key of STYLE_WEIGHTS) result.style[key] = integer(profile.style[key], p + '.style.' + key, 0, 10);
      } else result.style = { ...MISSION_STYLE[result.mission] };
      if (result.commitment.reviewOwnTurns > result.commitment.maxOwnTurns) fail(p + '.commitment', '檢討間隔不能超過任務上限');
      return result;
    });
    return { version: VERSION, profiles };
  }
  function id(config = DEFAULT_CONFIG) {
    let h = 2166136261;
    for (const c of JSON.stringify(normalize(config))) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return 'hex-strategies-v1-' + (h >>> 0).toString(16).padStart(8, '0');
  }
  function resolve(config, profileId) {
    const valid = normalize(config), profile = valid.profiles.find(p => p.id === profileId);
    if (!profile) fail('strategyIds', '找不到策略 ' + String(profileId));
    return profile;
  }
  return Object.freeze({ VERSION, MAX_BYTES, MAX_PROFILES, DEFAULT_CONFIG, STYLE_LANES, MISSION_STYLE, normalize, id, resolve });
});
