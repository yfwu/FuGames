# Pulse pickup label centering

Base: 7083c4e3eee6c95d8a1875f90403d98c8281f9ae, matching remote main before this fix.

The pickup pass inherited `textBaseline = middle` from the previous frame's player pass, but also drew at `y + 6`. The resulting Chinese glyphs sat low inside their square.

The production change only extracts the pickup pass into `drawPickup`: save/restore Canvas state, explicitly set left/alphabetic alignment, measure actual ink bounding boxes, and offset each glyph so its painted bounds share the square's center. Box size, font size, colors, player labels and rules are unchanged.

Validation:

- 17 existing pulse rules tests passed. The complete `pulse-engine` source matches the base byte-for-byte.
- Chromium and WebKit, 1440×1000 desktop, 390×844 portrait, 844×390 landscape, each with DPR 1 and 2: 12 cases / 48 glyph checks.
- Independently scanned rendered interior pixels for all four labels; maximum measured center error: 1 world-canvas unit (under one displayed CSS pixel at tested scales).
- Player/name region pixel hashes match the original in every case. Deliberately different incoming font, alignment, baseline and paint styles are restored after drawing all four pickups. No JavaScript errors.
- Before/after canvas screenshots captured; desktop, portrait and landscape examples visually reviewed. All four glyphs appear centered. Four simultaneous pickups are a rendering fixture, not a rule change (normal cap remains three).
- No physical iPhone was tested.

Run with a development-only Playwright installation:

```sh
node --test tests/pulse-arena.test.cjs
NODE_PATH=/path/to/node_modules node tests/pulse-label-browser.cjs
```

`FUGAMES_BASE_URL=https://yfwu.dev/FuGames` checks the deployed page; `QA_OUT` selects an output folder. `report.json` contains per-glyph offsets and all state/pixel checks.
