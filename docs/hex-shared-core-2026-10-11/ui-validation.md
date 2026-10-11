# Shared Hex UI validation

Both public pages now use `autohex-ui.js`, `autohex.css`, `autohex-visuals.js`, and the same cancellable Worker. `card_hex.html` contains no alternate rules reducer. `HexCore.create` supplies each page's geometry and legal actions. AutoHex remains radius 18 / six factions; normal Hex uses radius 9 / 2–6 active factions.

## Controls and privacy

- Normal setup: `seat-count`, `match-mode` presets, `seat-control-N` (human / AI), `seat-profile-N`. Default is three factions, one local human and two AI. All-AI play remains continuous.
- `terrain-mode` selects seeded terrain or all plain; `timed-cards` selects retained cards or three-own-action expiry. Card expiry is shown on each visible card.
- `strategy-json`, `strategy-file`, `strategy-apply`, `strategy-default`, `strategy-status` validate data-only configuration with `HexStrategies.normalize`. Invalid drafts block starting and preserve the last valid configuration. Per-seat choices and normalized configuration survive replay.
- Multi-human turns use the `handoff` modal and `reveal-hand`. Before explicit reveal, the observer is 0 and the DOM contains no private card buttons. After a human acts, the previous hand is removed before the next player can reveal. A single human retains their own hand while AI acts; no enemy hand is displayed.
- `tunnel`, `back-selection`, `confirm-selection`, `cancel-selection` use the core's `legalSelection` for partial paths and `legalAction` / `Game.act` for final spending. Valid tunnel endpoints still require explicit confirmation; failed selections spend nothing.
- New-game reset returns to setup; replay repeats the saved configuration and starts again if the previous game had started. Normal results omit unlimited continuation. AutoHex retains the ten-active-minute clock and optional unlimited continuation.

`window.HexAPI` is the current rules instance. `hexGame`, `hexUI`, `hexRender`, `hexSchedule`, and `hexCellPoint` alias the existing AutoHex debugging hooks. `hexUI()` includes public setup, observer, handoff state, generation, and Worker request identity; it contains no opponent cards. Public plan cues still whitelist committed intent fields and omit private planner memory.

## Rendering truth

The ordinary terrain base is white regardless of owner. Ownership is shown by colored piece shapes. Actual engineering conversion removes river/hill tint and glyphs; hill conversion preserves the own piece and turret and removes its countdown. A bridge or tunnel does not change the underlying terrain. Hills display remaining own-action retreat count. Public tunnels have dotted bent paths and lettered arched entrances. Supply visualization includes owner-only tunnel endpoint links. Existing turret silhouettes, public range inspection, effects and the two-canvas static-layer cache remain shared.

## Browser evidence

`tests/hex_shared_ui_browser.py` exercises actual DOM/canvas clicks at desktop 1440 px / DPR 1, mobile 390 px / DPR 3 and narrow 320 px / DPR 2. Its explicit controlled fixtures are functional tests, not full-game results. The frozen-core rerun passed all six mode/viewport combinations with no page errors or overflow. River conversion samples were exactly RGBA `[255,255,255,255]` in both modes at all three viewports. Tests also verified hill piece/turret preservation, unconverted river under bridges and bent tunnels, partial/back/confirm paths, 2–6 seat setup, handoff privacy, all-AI Worker action, pause freeze, and invalid configuration rejection.

Evidence: [functional report](ui/browser.json), screenshots in [ui/screenshots](ui/screenshots). The initial live normal-game run used real foreground Worker scheduling at 0.05 seconds with no virtual time or engine-state writes: two factions reached a connection in 33 actions, and six factions in 214 actions. A mobile human then performed three actual deployments with pause/resume and six AI replies; uploaded strategy JSON, a selected profile, plain terrain and timed cards survived replay. These runs are finite-game functionality checks, not a physical-phone benchmark or a large balance study. See [live normal-game report](ui-live/browser.json).

The preserved earlier planner V1 and cache evidence remains under `docs/autohex-planner-2026-10-11`; it is not relabeled as shared-core acceptance. Final shared-source lifecycle, performance and ten-minute campaign evidence are recorded separately under this directory when completed.

## Quiet performance checkpoint (before final planner bug review)

[The saved 2×30-second sample](ui/performance-browser.json) used core `3fc410b7`, planner `16f383fb`, and UI `031baf48`. The test worker's Node suite was explicitly SIGSTOP-paused for the interval, and the parent coordinated other heavy work. After staging 180 legal model actions (outside measurement), both measured intervals used real foreground time and default 0.30-second AI intervals. Mobile here means Chromium viewport/DPR emulation, not a physical phone.

| Metric | Desktop | Mobile DPR 3 |
| --- | ---: | ---: |
| Real Worker decisions in 30 seconds | 78 | 75 |
| Worker compute p95 | 103.6 ms | 103.3 ms |
| Request-to-result p95 | 105.7 ms | 112.1 ms |
| Main-thread accepted-action p95 | 1.9 ms | 1.6 ms |
| Frame interval p95 | 16.8 ms | 16.8 ms |
| Long tasks / largest | 4 / 193 ms | 1 / 69 ms |
| Largest frame gap | 616.6 ms | 100 ms |
| Three-control interaction wall time | 188 ms | 299 ms |

The isolated tails remain; these numbers do not establish flawless smoothness. Worker and main-thread measurements are separate. The browser instrumentation now follows the actual `HexCore.create` instance; instrumenting the old wrapper's prototype would miss UI actions.

A subsequent copy-only UI fix (`8c2f0507`) translates the new public hill-retreat, card-expired, tunnel-collapse and game-end events. Its [targeted browser check](ui-copy-fix/event-labels.json) passed. Core/planner freeze was reopened for separately discovered strategy bugs, so the checkpoint above is retained without being labeled final shipping evidence. That earlier checkpoint predates the final acceptance below.


## Final frozen-source checks

The final runtime uses core `3fc410b72e07b62464ad6272a8dd1e0af8e0300d3fa757e66c8d4147a53322c9`, planner `3d49ff6eda09bc88a33cc82839c3f892dea0a184b9a00fd91d8af401c154555a`, and UI `8c2f0507b55098008bfa20cd287764b980374082b4975712634cecf5f4eb6b5c`. Each linked report contains the complete imported source/configuration hashes.

- [Final Worker lifecycle](ui-final/worker-browser.json): request identity, generation, ply and turn mismatches; held stale and duplicate replies; pause, speed, restart, replay, visibility and time-expiry cancellation; eight rapid resets; idle Worker reuse; deterministic fallback; normal-board factory/seat changes. All passed.
- [Final real clock regression](ui-final/clock-regression.json): both real Worker scheduling and synchronous fallback preserve the monotonic foreground clock despite deliberately stale animation timestamps; paused time remains frozen.
- [Final functional fixtures](ui-final/browser.json): desktop 1440 px / DPR 1, mobile 390 px / DPR 3, narrow 320 px / DPR 2, both modes. These current-source tests repeat white conversion, retained hill pieces/turrets, unconverted terrain beneath bridge/tunnel, path selection, per-seat setup, handoff privacy and configuration validation. No page errors or horizontal overflow.
- [Final actual normal games and mobile human turns](ui-final/normal-live/browser.json): two AI factions finish by connection after 33 actions / 3.462 active seconds; six finish by connection after 247 actions / 39.457 active seconds. Mobile human makes three real deployments with six Worker replies, pause/resume and replay. Timed-card labels, uploaded configuration and selected profile persist. These use actual UI scheduling at 0.05 seconds, not fake time or bulk actions, and are functionality checks under the disclosed shared host load.

Historical normal-Hex browser scripts and the checksum-preserved released inline-engine fixture are migration evidence only. They are not counted as current shared-core browser passes.

## Final quiet performance

[Two final 30-second samples](ui-final/performance-browser.json) use the exact frozen hashes above. Heavy development, formal and full-suite workers were held during this coordinated interval. Both samples stage 180 legal actions before measurement and then use the actual default 0.30-second AI interval. All measured decisions run in the Worker. Viewport/DPR emulation is not a physical-phone measurement.

| Metric | Desktop | Mobile DPR 3 |
| --- | ---: | ---: |
| Real Worker decisions | 74 | 76 |
| Worker compute p95 / max | 122.1 / 185.5 ms | 98.7 / 126.9 ms |
| Request-to-result p95 / max | 132.4 / 191.3 ms | 101.2 / 210.4 ms |
| Main-thread action p95 / max | 2.1 / 4.7 ms | 1.6 / 7.4 ms |
| Frame interval p95 / max | 16.8 / 433.4 ms | 16.8 / 100 ms |
| Long tasks / largest | 11 / 370 ms | 5 / 93 ms |
| Three-control interaction wall time | 322.3 ms | 210.3 ms |

The long-task and frame tails are retained; off-thread planning does not establish flawless rendering. Worker compute, request latency and main-thread action timings remain separate. Final screenshots are in [ui-final/screenshots](ui-final/screenshots).
