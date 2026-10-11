# Browser validation — rejected planner v1

This v1 candidate passes the browser lifecycle checks but fails the intended strategy objective. It is not the shipping candidate. A corrected engine requires fresh source-matched campaign evidence.

## Actual foreground campaign

The run lasted **600.375 wall seconds**, reached exactly **600000 active milliseconds**, and applied **1218 actions**. Default 0.30-second pacing was unchanged; the page stayed visible and unpaused, all seven runtime hashes stayed unchanged, and there were no page/console errors or board/effect-cap failures.

**Objective failure: zero goal arrivals and zero goal-holding rounds.** There was one airport unlock followed by a loss, with no airdrops or bombardments. Sustained combat does not compensate for failing to connect the opposite edge. The displayed winner was A with 98 points, followed by C 91, E 71, B 69, D 68, F 63.

The last minute still had 141 actions, 188 changed board cells, and 119 lost or exchanged stones. There were 977 public commitment/stage/reason transitions and 925 recorded progress changes. All 1,218 decisions used the Worker.

Evidence: [full campaign JSON](live-v1/live-browser.json), [console log](live-v1/live-browser.log), [midpoint screenshot](live-v1/screenshots/live-mid-desktop.png), [result screenshot](live-v1/screenshots/live-result-desktop.png).

## Timing and its limits

This was Chromium on the shared execution host. The first approximately two minutes overlapped the full Node suite; three model-study workers also ran. Later measurements shared the host with the study workers. Mobile reports use a 390 CSS-pixel viewport at DPR 3, not a physical phone.

| Measured interval | Worker compute p95 | Request-to-delivery p95 | Frame interval p95 | Largest frame gap |
| --- | ---: | ---: | ---: | ---: |
| 600-second v1 campaign | 196.1 ms | 256.8 ms | 99.9 ms | 1116.7 ms |
| desktop 30-second v1 sample | 120.6 ms | 134.3 ms | 33.4 ms | 700.0 ms |
| mobile 30-second v1 sample | 140.0 ms | 174.7 ms | 33.4 ms | 283.4 ms |

The full campaign recorded 1,988 main-thread long tasks (p95 173 ms; maximum 1,075 ms). Switching the pinned route off and restoring it took 402.7, 623.2, and 159.5 ms including browser automation/dispatch. The Worker isolates decision computation, but these data do **not** establish smooth rendering under load. No frame or tail-latency failures are concealed.

## Runtime identity

| File | SHA-256 |
| --- | --- |
| `autohex-engine.js` | `0c5b3137c803f3f77ddd3fbb34a132f1986a257d3db2d828a1d2628e37c69993` |
| `autohex-ui.js` | `fb886197132a487f1001a83dc18ee75d7d73aec0b03ebfd50079cf0db6aa71d9` |
| `autohex.html` | `90bcc0fad0f954efbc9080971f512ada6b713c908d733eb6376e2e72aff05d23` |
| `autohex.css` | `da2b0c693b2f5ce8ad374ca746a3d62ec4b756c9a0b1374eb0f21018fdb567d5` |
| `autohex-visuals.js` | `b1bed80f9b4ef5baf8fc8a3c78706a0a6c2baf0b9274fe2c318883ed264e79cd` |
| `autohex-planner.js` | `2e222d259995f604b07c8b599f681a8ccc025a5e1a709bb649c5c539637ebb7f` |
| `autohex-ai-worker.js` | `0c7ba91f0d2997d3e3e08bdd6e004e792062b6e497529e3b526536dfbb9ed7c0` |

The unchanged UI/Worker is being checked independently of v1 strategy quality. See [UI design and contract](ui-validation.md) for controls, public-only rendering, cancellation guards, and test methods. The source-matched v1 functional suite passed desktop 1440px, mobile 390px/DPR 3, and narrow 320px/DPR 2 with reduced motion. It checked pinned public plans, all six factions, waypoint navigation, route-off, hidden-memory exclusion, pause/single-step, replay, visibility, human-mode privacy, 44px mobile controls, and an actual final-gap AI action before displaying completion/100%. These capability results do not validate v1 strategy quality. The subsequent cached UI passed Worker cancellation and both real-time stale-RAF clock scenarios; their source hashes are recorded in the respective JSON files.

## Targeted rendering correction

Profiling the same v1 engine on an otherwise quiet task host confirmed repeated full-board/minimap drawing during effects. The UI now keeps exactly two reused canvases: board/public overlays below effects, and goals/selection/focus above effects. Ordinary state/camera/control changes repaint both. Effect-only frames composite the cached layers and effects without repainting the minimap. Both canvases inherit the page language/direction so arrow glyph fallback matches the main canvas. No Worker or timing semantics changed.

[Pixel comparison](render-cache-browser.json) covers desktop, mobile DPR 3, and narrow DPR 2: whole board; paused simultaneous destruction and shield impacts with range/selection; supply toggle; zoom/pan; actual two-finger pinch; aged effects; reduced motion; and replay. Maximum per-channel difference is one byte from transparent-layer alpha rounding. The 160 ms animation probe adds three composites with **no static rebuild or minimap redraw**. The two canvases use about 4.4, 8.1, and 4.1 MB at the tested viewports.

The before/after profiles used the same frozen v1 engine `0c5b3137…`, planner `2e222d25…`, seed `planner-render-profile`, legal 600-action staged board, 30-second real foreground interval, and 1 ms main-thread CPU sampling. All formal development/model jobs were stopped for each measured sample. Browser automation and unrelated host scheduling can still contribute noise. Before UI: `fb886197…`; cached UI: `20e6f2aa…`.

| Measure | Before cache | After cache |
| --- | ---: | ---: |
| Frame interval p95 | 50.1 ms | 16.8 ms |
| Frame gaps over 50 ms | 73 | 25 |
| Main-thread long tasks | 54 | 18 |
| Largest frame gap | 616.7 ms | 533.2 ms |
| Largest long task | 623 ms | 489 ms |
| Profiled main-thread idle | 8.42 s | 21.15 s |
| Canvas fill self time | 1,649 ms | 157 ms |
| Three actual route/target inputs | 540 ms | 253 ms |

The data support removing the repeated-drawing bottleneck; occasional large tails remain. The number of actions was 69 before and 68 after, so this is not a claim of exact equal wall-clock throughput or universally stutter-free rendering. [Before profile](profile-v1-mainthread.json), [after profile](profile-v1-cached-mainthread.json), [captured pre-cache UI](renderer-before-source.json), and [captured rejected v1 engine/planner](candidate-v1-source.json) preserve the comparison. `tests/autohex_render_performance.py` supports `AUTOHEX_RENDER_VERSION=before` or `cached` for repeatable profiling against one selected engine.
