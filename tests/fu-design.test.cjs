'use strict';
// Vermilion Ink shared design system: tokens stay in sync between CSS and JS,
// the shared files stay local/offline, and the vendored three.js is present.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const P = require('../shared/fu-palette.js');

test('fu.css tokens match fu-palette.js exactly', () => {
  const css = read('shared/fu.css');
  const rootBlock = css.match(/:root\s*{([\s\S]*?)\n}/)[1];
  for (const [name, hex] of Object.entries(P.colors)) {
    const m = rootBlock.match(new RegExp(`--fu-${name}:\\s*(#[0-9a-f]{6});`, 'i'));
    assert.ok(m, `--fu-${name} missing in :root`);
    assert.equal(m[1].toLowerCase(), hex, `--fu-${name}`);
  }
  P.sides.forEach((name, i) => assert.match(rootBlock, new RegExp(`--fu-side-${i + 1}:\\s*var\\(--fu-${name}\\)`)));
});

test('fu-three.js palette mirrors fu-palette.js', () => {
  const src = read('shared/fu-three.js');
  const camel = n => n.replace(/-(\w)/g, (_, c) => c.toUpperCase()).replace(/-/g, '');
  for (const [name, hex] of Object.entries(P.colors)) {
    const key = camel(name);
    assert.match(src, new RegExp(`${key}: 0x${hex.slice(1)}\\b`, 'i'), key);
  }
  assert.match(src, /from '\.\.\/vendor\/three\/three\.module\.min\.js'/);
});

test('palette helpers', () => {
  assert.equal(P.side(0), P.colors.seal);
  assert.equal(P.side(7), P.colors.azure);
  assert.deepEqual(P.rgb01('ink-0').map(v => Math.round(v * 255)), [7, 9, 12]);
  assert.equal(P.rgba('seal', .5), 'rgba(255,75,43,0.5)');
  assert.throws(() => P.hex('nope'));
});

test('shared files are local, parse, and the vendored three.js is self-contained', () => {
  for (const f of ['shared/fu.css', 'shared/fu-shell.js', 'shared/fu-palette.js', 'shared/fu-three.js', 'shared/demo.html']) {
    const s = read(f);
    assert.doesNotMatch(s, /https?:\/\/(?!www\.w3\.org\/2000\/svg)/, f + ' must not fetch remote resources');
    assert.doesNotMatch(s, /@import|@font-face/, f);
  }
  assert.doesNotThrow(() => new vm.Script(read('shared/fu-shell.js')));
  assert.doesNotThrow(() => new vm.Script(read('shared/fu-palette.js')));
  const three = read('vendor/three/three.module.min.js');
  assert.ok(three.length > 500000);
  assert.doesNotMatch(three.slice(0, 4000), /\bfrom\s*["']/, 'three.module.min.js must not import other files');
  assert.ok(fs.existsSync(path.join(root, 'vendor/three/LICENSE')));
});
