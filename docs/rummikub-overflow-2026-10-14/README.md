# Rummikub overflowing tiles fix

The supplied Library screenshot was successfully materialized and visually inspected. It shows a **15-tile hand**, with only the top of the third-row Joker visible. The user screenshot is not included in this repository.

## Cause and fix

The original mobile rack has `max-height:155px; overflow:auto`. A reproduced 15-tile hand needs 209px, leaving one tile clipped (`baseline.json`, `before-15-tiles.png`). Tiles have `touch-action:none` for drag-and-drop, so starting a swipe on a tile cannot scroll that inner rack. Long melds likewise used an inner horizontal scroll area.

The fix only adds CSS to `rummikub.html`: remove the hand height cap, allow the shell and table to grow with content, and wrap long melds within their existing group border. Extra rows are reachable through normal page scrolling from the page margins or non-tile areas. Draggable tiles retain their existing gestures. Both JavaScript blocks are byte-for-byte unchanged; rules, AI, state and saves are unaffected. No other game or shared style is changed.

## Verification

- Chromium and WebKit: portrait 390×844 and 320×568, landscape 844×390, desktop 1440×1000.
- Hands of 15, 45 and 103 tiles; table of 76 tiles across 12 melds, including four 13-tile runs, alongside a 27-tile hand. Fixtures conserve all 106 physical tiles.
- Every tile stays within its displayed region/group; no horizontal page overflow. Last tiles can be scrolled into view and selected.
- Sorting preserves inventory; adding a draft meld, undo, committing a 30-point opening, and drawing a tile update the displayed counts and geometry correctly.
- Native Chromium mobile swipe in the page margin, desktop wheel scrolling, and programmatic mobile WebKit scrolling verified on the 103-tile hand.
- 160 targeted browser checks, zero page errors (`browser-report.json`).
- Existing 22-check Chromium gameplay/drag/Worker/offline suite passes (`existing-browser-report.json`).
- 12 relevant Node rules/icon checks pass (`node-tests.log`); `git diff --check` passes.
- Inspected corrected 15-tile and large-table WebKit screenshots. `before-15-tiles.png` is a generated test fixture, not the user's screenshot.

Run with development-only Playwright and installed Chromium/WebKit:

```sh
node tests/rummikub-overflow-browser.cjs
```

The script starts its own localhost server; `FUGAMES_BASE_URL` can target the published website. `NODE_PATH` and `PLAYWRIGHT_BROWSERS_PATH` may point to temporary tooling.

Limitations: WebKit was tested on macOS with mobile viewport/touch emulation, not on a physical iPhone. Mobile WebKit gesture input is unavailable in this runner; its page scrolling was checked programmatically. Dragging from a tile intentionally still captures the touch; use the page margins or other non-tile areas to scroll. No additional large AI simulations were run.
