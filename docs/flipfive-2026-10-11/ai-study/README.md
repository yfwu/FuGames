# FlipFive AI and rule-variant study — 2026-10-11

The shipping change improves the bot's continuation search while retaining the existing 9×9 placement, simultaneous eight-direction flipping, and immediate five-in-a-row rules. A rule redesign was considered but the evidence did not justify it.

The original bot checks its immediate win and the opponent's immediate reply, then relies on a short heuristic list. Its opening losses are real, but they do not prove that every first move wins against every defense. The separate exact research in the parent folder proves a narrower statement: after E5 E4 E3, the first player can force a win by ply 11 against all 78 fourth moves. Thus E4 is a certified losing reply to E5. That conditional proof does not settle the empty-board game or all alternative second moves.

## Completed old-versus-new study

| Frozen split | Games | New AI wins | New AI as first | New AI as second |
| --- | ---: | ---: | ---: | ---: |
| Development openings | 16 | 16 | 8/8 | 8/8 |
| Held-out openings | 16 | 10 | 6/8 | 4/8 |
| Empty / one-placement prefixes | 16 | 16 | 8/8 | 8/8 |
| Total | 48 | 42 | 22/24 | 20/24 |

There were no draws. The **six held-out losses are retained**; there was no tuning after examining the held-out results. These are correlated opening/color/profile replicas, not 48 independent statistical trials. Winning this study does not prove game-theoretic balance, a universal win strategy, or exploit elimination.

Each four-game opening block changes the new AI's seat, starter color, and evaluator profile, with frozen deterministic tie seeds. Development prefixes are E5 D4, E5 E4, D4 E5, and E4 E6. The held-out prefixes, frozen before any new-AI game, are E3 F4, C3 G7, E1 D5, and E2 F6. The final set uses the empty board, E5, D4, and A1. These are specified legal openings, not claims of optimal play. Every complete move trace and per-decision search statistic appears in the three `ai-*.json` files.

All 198 new-AI decisions stayed within the 36,000 counted-placement budget; the observed maximum was 35,999. Of those decisions, 42 immediately won, 50 completed nominal depth 2, 88 completed depth 3, and 18 completed depth 4. Eighty-four decisions exhausted the budget and retained their last completed root pass. The frontier performs an additional immediate-win probe, so reported nominal depth is not a claim of uniformly exhaustive search to that many plies.

## Opening regression

`opening-response.json` records E5 responses under both starter colors, both profiles, and seeds 0, 17, and 871. All twelve avoid the certified adjacent blunder: seeds 0 and 17 select C5; seed 871 selects E3. Both choices leave a one-cell gap from E5. The search contains no hardcoded opening ban. These choices lie outside the E4 proof's scope; they are not claimed to survive perfect play forever.

The tests check the four rotation/reflection-equivalent adjacent responses as one invariant set, under both colors, both profiles, and two deterministic seeds. A separate development fixture checks the unique F3 diagonal capture after E5 E4 E3 D5 E2. D5 is only a short-horizon delay in the now-proven losing opening; the test explicitly claims only a refutation through ply seven.

## Search protocol and limits

The browser/Node-compatible `flip-five-ai.js` takes `{board, player, profile}` and optional `{seed, nodeBudget, maxDepth, width}`. Shipping defaults are seed 0, budget 36,000, nominal depth 4, and quiet width 12. There is no wall-clock cutoff, hidden information, randomness in the rules, or handicap triggered by a player being ahead. The seed resolves equal heuristic scores only.

Every root legal immediate win and every legal root move's immediate opponent responses are screened. The root screen finishes before quiet continuation search. Iterative deepening commits only a fully completed root pass. At its frontier the search checks the mover's immediate winning placements before using a static score; this prevents a just-beyond-horizon capture-five from looking harmless. Deeper quiet continuations use a selective beam and can omit useful defenses. The returned statistics always include `proof: false`.

An early development candidate without the frontier check failed independent testing, choosing D6 after E5 E4 E3 at seed 17. It was corrected before shipping. The final candidate passes that regression and the independent tactical suite. Development history is recorded to explain the frontier extension, not as a held-out result.

The incremental search transition is checked against the extracted production rules on seeded reachable states; hypothetical win probes are checked against actual move outcomes and must restore the board. The main rules tests still exercise the legacy chooser separately, preserving their mechanics and historical assertions. Browser worker/fallback integration is tested separately by the UI owner.

## Rule alternatives considered

- A pie/opening swap preserves the move tree and gives the responder a choice of side. It can transfer an opening advantage; it does not prove that a forced first-player advantage disappears.
- A one-stone capture limit cannot fix the direct end-block trap, because that trap already captures only one stone.
- A one-turn shield on the latest stone can postpone a capture, but the earlier end-block becomes vulnerable after the next block. It is implemented as a diagnostic candidate, not shipped.
- `capture-grace` makes a capture-built five provisional until it survives one opponent reply, while a five without a freshly flipped stone remains immediate. It adds public pending state and changes victory timing.
- `hold-five` delays every five by one reply. A reply opportunity does not guarantee a useful defense: an opposing anchor may be absent.

The separate bounded C++ development comparison used four frozen two-ply openings and 16 seat/profile replicas per candidate. Baseline first-seat wins were 8/16; capture-grace first-seat wins were 12/16. That small correlated result provides no justification for shipping the additional provisional-five rule. The hold-five exploratory run exceeded a 25-second shared CPU window and remained incomplete; it is excluded. No completed held-out rule-variant result is claimed. Hidden rubber-banding and arbitrary punishments for nearing victory were rejected.

The C++ variant harness uses a different search: depth 5, quiet width 10, 50,000 continuation nodes per decision, plus complete immediate-root-defense screening. Its results must not be conflated with the production JavaScript AI study.

## Reproduce

From this folder, using the frozen source snapshots:

```sh
node --test flip-five-ai.test.cjs
node compare-ai.cjs development 16 > development-rerun.json
node compare-ai.cjs heldout 16 > heldout-rerun.json
node compare-ai.cjs unforced 16 > unforced-rerun.json
g++ -O3 -std=c++17 evaluate.cpp -o /tmp/flipfive-variant-evaluate
cp /tmp/flipfive-variant-evaluate ./evaluate
node validate.cjs
./evaluate baseline match 16 5 0 > baseline-rerun.json
./evaluate capture-grace match 16 5 0 > capture-grace-rerun.json
```

`source-hashes.json` anchors the final production engine/AI, the original inline engine snapshot, and the study inputs/results. The source snapshots match the shipped files at packaging time. The original variant harness matched the pre-change JavaScript rules on 394 legal transitions. `validation.json` records that check; the larger independent certificate verification is in the parent research folder.
