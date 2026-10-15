# Tux 2D — 山路快遞

2026-10-14. Replaces the previous top-down circuit with an original pixel-art chase-camera expedition. The reference image was materialized through Library and visually inspected; no reference image bytes or third-party game assets are shipped. FuGames theme, navigation and native SVG header remain intact. No other game's implementation changes.

## Complete playable scope

- 7,200 m / three delivery stations, with a 110-second limit. One human with four AI, or five-AI spectator mode.
- Each station has a committed fork: left supply road caps normal speed at 68 and grants +25 cargo / +45 energy once; right express road permits 120, with weaker ice steering and rocks. Normal road speed is 100; shoulders cap at 48. Values are arcade simulation units.
- Boost (30 energy, 2.3 s), shield (25 energy, 4 s or one hit), snowball (20 energy, forward projectile). Each activation is edge-triggered. Batteries grant +18 energy / +20 points once per racer.
- Collision costs 14 cargo and speed; a short immunity window prevents stacking. Traffic, rocks, racers and snowballs use the same damage/shield function. Physical separation and visible-obstacle avoidance prevent AI pileups.
- Each station scores current cargo ×3. Completing the route scores remaining seconds ×10. Human completion or deadline immediately closes the score table; unfinished opponents keep earned points. Spectator mode waits for all five or the deadline.
- Shared rules and resource limits for AI; no teleport, rubber-band speed or free energy. Their supply preference differs slightly by driver.
- Native keyboard and multitouch controls, auto throttle, brake, pause on blur / hidden tab, deterministic restart. No new runtime dependency or remote asset.

## Verification

- Initial full repository check: **409 / 409 tests passed** (`node --test tests/*.test.cjs`). Nine new courier rules checks cover deterministic replay, timer freeze/reset, item cost/latch, shield/damage, fork commitment, once-only supply, per-driver battery collection, projectile damage, finish/timeout and a bounded full AI run. The ninth check was added after the full run to cover pre-start spectator camera station labels; the courier suite passed again.
- `tests/tux2d_browser.py`: desktop 1280×1000, mobile portrait 390×844, landscape 844×390; keyboard, pause/resume, both branches, actual supply grant, shield absorption, snowball activation, completion, timeout and restart. Controlled proximity/end-state fixtures are explicitly listed in `browser.json`.
- Native CDP multitouch dispatch holds steering while a second finger activates shield; both orientations passed. The shield can be consumed immediately by a real collision, so the test checks the activation event as well as actual steering movement.
- Full unmodified five-AI browser run completed in **90.32 simulated seconds**. Browser clock accelerated while executing the normal animation loop; no direct engine steps.
- `tests/tux2d_keyboard_browser.py`: one unmodified human-mode run, driven only with native keyboard events from a bounded observation-based driver. Completed all three stations in **75.98 simulated seconds**, used both fork routes, scored **1,398**, and finished with **100% cargo**. Browser time accelerated; no game-state writes or direct engine steps. Details: `keyboard-run.json`.
- No page errors; both mobile orientations had no horizontal overflow and visible driving controls. Visually inspected `desktop-play.png`, `desktop-supply.png`, `portrait.png`, `landscape.png`, and `keyboard-result.png`.
- Old circuit-only browser/performance/study scripts were replaced by these two bounded courier browser scripts. Historical reports under `docs/tux2d-2026-10-11/` remain historical evidence, not tests of this redesign.

## Limits

Chromium desktop with mobile viewport/touch emulation; not a physical iPhone/Android or Safari validation. No audio, persistent unlock tree or network multiplayer is included. Simulation runs are intentionally bounded to a few fixed seeds and scenarios, not a balance/performance study. A final station-label clamp for negative starting-grid positions was checked by a targeted core test after browser capture; browser source hashes record the exact earlier captured version.

## Reproduction

Serve the repository with `python3 -m http.server 8018`, install Python Playwright + Chromium, then run:

```sh
node --test tests/tux2d.test.cjs
FUGAMES_BASE_URL=http://127.0.0.1:8018 python tests/tux2d_browser.py
FUGAMES_BASE_URL=http://127.0.0.1:8018 python tests/tux2d_keyboard_browser.py
```
