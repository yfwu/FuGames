'use strict';
// Static contract for the HexBattle page (formerly AutoHex 3D): the rename
// keeps the old URL working, every element the controller looks up exists,
// and the spectator / stream controls stay wired.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

test('HexBattle is the catalogue name; the old AutoHex 3D address forwards to it', () => {
  const home = read('index.html');
  assert.match(home, /href="hexbattle\.html"[^>]*aria-label="開始遊玩 HexBattle"/);
  assert.match(home, /<use href="icons\.svg#hexbattle">/);
  assert.doesNotMatch(home, /autohex_3d|AutoHex-3D/);
  const old = read('autohex_3d.html');
  assert.match(old, /location\.replace\('hexbattle\.html' \+ location\.search \+ location\.hash\)/, 'query (stream settings) and hash survive the redirect');
  assert.match(old, /http-equiv="refresh" content="0; url=hexbattle\.html"/);
  assert.match(read('archive.html'), /href="autohex_3d_classic\.html"/, 'the AutoHex-rules 3D page stays in the archive');
});

test('every element id the controller uses exists in the page', () => {
  const html = read('hexbattle.html'), app = read('hexbattle/app.js');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  const used = new Set([...app.matchAll(/\$\('([\w-]+)'\)/g)].map(m => m[1]));
  assert.ok(used.size > 50);
  for (const id of used) assert.ok(ids.has(id), `#${id} is missing from hexbattle.html`);
  for (const src of ['hexbattle/engine.js', 'hexbattle/ai.js', 'hexbattle/text.js', 'hexbattle/app.js', 'hexbattle/app.css']) assert.match(html, new RegExp(`(?:src|href)="${src.replace('.', '\\.')}"`));
});

test('controller parses and exposes the agent bridge under both names', () => {
  const app = read('hexbattle/app.js');
  assert.doesNotThrow(() => new vm.Script('(async () => {' + app.replace(/^\s*import\b[^;]*;/gm, '') + '\n})', { filename: 'hexbattle/app.js' }));
  assert.match(app, /window\.HexBattle = bridge;/);
  assert.match(app, /window\.AutoHex3D = bridge;/);
  for (const k of ['observe', 'legal', 'act', 'describe', 'myTurn', 'newGame', 'replay', 'pause', 'resume', 'next', 'series', 'on']) assert.match(app, new RegExp(`\\n  ${k}: `), k);
  assert.match(app, /new CustomEvent\('hexbattle'/, 'highlights are published as DOM events');
  for (const t of ['match-start', 'turn', 'round', 'highlight', 'match-end']) assert.match(app, new RegExp(`emit\\('${t}'`), t);
});

test('spectator controls, stream URL parameters and player guidance are wired', () => {
  const html = read('hexbattle.html'), app = read('hexbattle/app.js'), css = read('hexbattle/app.css');
  for (const id of ['sp-pause', 'sp-director', 'sp-loop', 'sp-next', 'intro-stream', 'guide', 'btn-hint', 'btn-auto', 'ticker', 'banner', 'onair', 'stream-url']) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /<div class="fu-seg" data-name="mode">[\s\S]*?value="stream"/);
  for (const k of ['players', 'seed', 'rounds', 'speed', 'doctrine', 'intermission']) assert.match(app, new RegExp(`pick\\('${k}'`), `URL parameter ${k}`);
  assert.match(app, /url\.get\('hud'\)/);
  for (const key of ["' '", "'n'", "'c'", "'o'", "'i'"]) assert.match(app, new RegExp(`Fu\\.hotkey\\(${key}`), `hotkey ${key}`);
  assert.match(css, /body\.is-stream \.fu-topbar \{ display: none; \}/);
  assert.match(css, /body\.is-stream\[data-idle="1"\] \.hb-specdock/);
  // the hint must read the state only: suggestions may never change a replayable game
  assert.match(app, /AI\.decide\(st, HUMAN, 'balanced'\)/);
});

test('the built-in AI decides without touching the game state (hint and 代打 rely on it)', () => {
  const E = require('../hexbattle/engine.js'), AI = require('../hexbattle/ai.js');
  const st = E.createGame({ seed: 'hint-purity', players: 4 });
  for (let k = 0; k < 300 && st.phase !== 'over'; k++) {
    const id = st.turn, before = JSON.stringify(st);
    const a = AI.decide(st, id, AI.PROFILE_ORDER[k % AI.PROFILE_ORDER.length]) || { type: 'end' };
    assert.equal(JSON.stringify(st), before, `decide mutated the state at step ${k}`);
    assert.ok(E.act(st, id, a).ok || E.act(st, id, { type: 'end' }).ok);
  }
});
