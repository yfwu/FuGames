# Hex seed / spectator revision — 2026-10-11

## Recovery and scope

At handoff, local `work` and remote `main` both resolved to `fe26f199436b95896c41ed917dac2efd0e448585`. `git status --short` was empty; `git ls-remote --heads origin` showed only `main`. The baseline's Game rules and Pages runs both completed successfully. The new environment exposed no uncommitted changes from the disconnected task. This revision was implemented from that verified baseline; no assertion is made about files in the old task environment. No `AGENTS.md` or `.agents/skills` files were present in the visible workspace/repository.

Only Hex gameplay and the two shared icon symbols change. The 12 other game HTML files, homepage HTML and shared stylesheet retain their existing mechanics/layout; see [unchanged HTML hashes](unaffected.json). Old revision evidence is retained separately.

## Defaults and exact rules

- 91 cells, three players, human + two local AIs by default. A new seed is generated per new match. Starting player and goal axes rotate on restart; the controls can set them explicitly. Seed replay preserves seed, all rule options, AI arrangement, starter and axis. Equal human actions are required to reproduce a human game; autonomous spectator games reproduce their decisions. Replays are version-specific.
- Default terrain is seeded rivers and hills, with 120-degree symmetry. The meander has at most 12 river cells and 9 hills; all 16 possible river shapes leave each goal axis reachable before play. 300 seeds also test rotational equality and varied maps. Classic no-terrain mode remains available.
- A river cell cannot be occupied or counted in an actual connection until a player builds a public river crossing. `engineer` consumes one turn, no card, and has no supply limit. It also levels an empty or own hill. Thus mandatory river resources cannot depend on a lucky draw. The river crossing is a public cell improvement; a flying bridge is a line joining two own endpoints and can skip a river without occupying it.
- A stone on a hill displays 3 after placement. The next three completed turns of its owner reduce 3→2→1→0; then the stone, its turret and any incident flying bridges leave before victory is checked. Other players' turns and wall-clock time do not reduce it. Leveling one's hill stabilizes its stone. A terraform card improves an empty terrain cell and places one stone in the same turn; that placement still triggers hidden enemy traps.
- Default cards are a bounded random recipe, shared identically by all three players and independently shuffled. Each finite 13-card deck starts with double×2, remove/turret/trap/bridge/terraform/shield×1 and adds five random non-shield cards. Double is capped at 4, other non-shield types at 3, shield stays exactly 1. The actual recipe is shown in match settings. The previous fixed 13-card recipe remains selectable.
- Default is keep cards. Optional timed cards have three own action opportunities, including acquisition turn; the initial two cards start counting on the first own turn. At the end of the third opportunity unused cards are discarded automatically. Pause, opponents, seconds and waiting for a shield response do not tick them. Hand limit is four; a full hand leaves the next card in the deck. A player may voluntarily discard a selected card for one turn. Ordinary placement and engineering remain available; expiry never forces an illegal or harmful card play.
- Trap → simultaneous due turret fire → acting player's hill retreat and card expiry → due neutral effect → victory/full board/180-action cap. Multiple connections produce a draw. Terminal distance adds unbridged rivers at cost 2; that score does not authorize passing through a river during actual connection detection.
- Neutral mischief defaults off. If enabled it first warns after action 12–18, then gives three actions of warning before affecting one uniformly selected cell. Gust clears a stone; flood/uplift modifies only an empty, unbuilt cell. The target selection does not inspect player identity or secrets. Anyone can spend a turn disarming the warning. Subsequent warnings are 15–21 actions apart, at most four per game; they never extend the action cap.
- All flying bridges use the same integer axial-coordinate intersection check for human and AI. Duplicate/reverse endpoints, positive collinear overlap, crossing and endpoint-to-interior T junctions are rejected across **all owners**. Two segments may share a vertex only if that vertex is an endpoint of both. Illegal clicks preserve cards, board and action count.
- Spectator mode lets three AIs play, with a 0.05–30 second step interval (default 0.5), pause/resume, single step, new seed restart and exact configured seed replay. One generation-checked timeout is cancelled on speed changes, pause, visibility/blur, replay and restart. A shield response is a separate decision step. AI computation time is additional to the chosen interval. Match settings collapse during play on small screens.

The reachability guarantee addresses terrain generation and missing resources, not a promise that every later tactical position is winnable.

## AI experiment

Rush prioritizes short-path progress and double placement; cutter values blocking both rivals; multi values alternative near-shortest routes and discounts fragile hills more. All use the same public response search depth, immediate-threat checks, turret forecasts, terrain legality, own traps and bridge validation. Opponent cards, deck order, deadlines and trap centers are absent from the AI observation. Spectator rendering also hides every private hand and armed trap.

[Raw results and all fixtures](balance.json), reproduced by `node tests/hex-seeded-balance.cjs`, use the exact gameplay engine hash `e9e7eed8e92e0d6048b89cf37e8f83b84a0ac06647357a1ad087817c86987a7c`.

144 games use six independent seeds, mirrored one-versus-two strategy assignments at all three seats (108 games), plus all six permutations of the three distinct personalities (36 games). Starter, axis, timed cards and neutral events vary. Each pair's strategy exposure is equal. Counts below are wins/losses/draws for the row in three-player mirror fixtures, not two-player duels.

| Strategy | vs rush | vs cutter | vs multi |
|---|---:|---:|---:|
| Rush | — | 13 / 9 / 14 | 10 / 8 / 18 |
| Cutter | 9 / 13 / 14 | — | 8 / 13 / 15 |
| Multi | 8 / 10 / 18 | 13 / 8 / 15 | — |

**A cyclic counter relationship was not established.** This sample favors rush over the other two and multi over cutter. In the distinct-three-strategy sample each won 7 games, with 15 draws. Wins by seat were 9/8/4 and by starting order 8/5/8. There are no profile-dependent winner rules or artificial counter bonuses. Six seeds and correlated permutations do not establish population balance or statistical significance. Defensive two-player instincts can also help a third player; the strategies are heuristics, not experts.

No illegal actions or card conservation violations occurred. Mean match length 114.2 actions, p95 156, maximum 180. The run exercised 1,841 engineering moves, 410 terraform cards, 282 flying bridges, 1,407 hill retreats, 1,156 expiries and 358 neutral resolutions. The AI chose disarm only once; neutral counterplay exists, but its current heuristic rarely spends a move on it.

Measured on this shared Linux/Node runner: 144 games / 474.78 seconds = **18.2 games/minute**, excluding rendering and configured delays. Decision mean 28.7ms, p95 67.4ms, maximum 632.0ms under shared load. This is an observation for this run, not a throughput promise. [Chromium response measurements](responsiveness.json) separately test real AI decisions and pause/zoom responsiveness with normal and 4× CPU throttling; throttling is not a physical-phone benchmark. Across 29 decisions per condition, Chromium p95 was 60.9ms normally and 158.6ms at 4× slowdown (maximum 148.8ms / 210.5ms), and pause/zoom checks passed.

## Tests and visual evidence

- Baseline: 185/185 Node tests passed before edits.
- Final: 203/203 Node tests passed, including 18 added tests. Coverage includes 300 terrain seeds and all river shapes, card supply/expiry/full hands, bridge geometry across owners, hills, traps/turrets/events/expiry ordering, simultaneous wins, reproducible complete seeded games and hidden-state permutation invariance.
- `hex_seeded_browser.py`: desktop 1366, mobile 390 DPR3, narrow 320 DPR2, landscape 844 DPR2. Real clicks/taps verify illegal river actions and engineering; fake-clock boundaries verify speed change, pause/single-step/replay/restart/visibility; spectator DOM privacy; cross-owner overlapping bridge; separate hill/turret counters. Complete 3AI and human-mobile matches run through the actual UI.
- `hex_revision_browser.py` and `board_expansion_browser.py`: classic option explicitly selected for original fixtures. Original traps, friendly-fire/expiry, bridge win, counters, keyboard/touch, zoom and complete DOM matches pass.
- `gravity_brawl_browser.py`: desktop/mobile/narrow full matches, all four gravities, rapid events, pause/restart/draw pass. Its fake clock is now explicitly paused so host delay between protocol calls cannot accidentally exceed the 220ms double-click lock; gameplay code is unchanged.
- `duplicate_bridge_browser.py`: five desktop/mobile/dummy/defense/landscape scenarios complete all 52 cards, scoring, pause/restart and privacy, with no console errors or failed requests.
- `hex_icons_revision_browser.py`: actual shared references in homepage and headers, safe viewBox and responsive layouts. Before/after sheets render at 16, 24, 32, 48 and 96px with DPR1/2/3; visually reviewed at DPR1 and DPR3. Both icons use native 48×48 SVG, 2px rounded strokes and centered bounds. Gravity uses one block outline plus a detached down arrow and floor; bridge uses four separated seats with an open center. Other symbols are unchanged.
- `git diff --check`: clean. No build dependency was added.

[Browser result data](browser.json), [icon geometry](icons.json), [before screenshots](screenshots/before/), [after screenshots](screenshots/after/), [DPR1 icon comparison](screenshots/after/icons-comparison-dpr1.png), [DPR3 comparison](screenshots/after/icons-comparison-dpr3.png), [mobile Hex](screenshots/after/card_hex-mobile.png), [overlapping bridge rejection](screenshots/after/bridge-overlap-rejected.png).

## Deployment boundary

Push and exact-commit CI/Pages results are reported with the final handoff. Public-site browser verification is **not complete**: navigating to `https://yfwu.github.io/FuGames/` from this environment returned `ERR_TUNNEL_CONNECTION_FAILED`. Local HTTP Chromium acceptance and GitHub deployment status are distinct evidence. Mobile tests use Chromium emulation, not physical iOS/Android devices.
