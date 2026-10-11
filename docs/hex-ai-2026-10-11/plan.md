# Preregistered AI revision study

Baseline: `13eb890c4f6018a0213df60770c2dc01b6944296` (2026-10-11). Rules, terrain, card supply, tie scoring, timers and icons are fixed for this study. Only public-information AI evaluation/search and related tests/explanations may change. A rule change would require separate evidence and an explicit report; no tie-break change is planned.

## Behavioral hypotheses, before tuning

1. **Cutter can exploit rush concentration.** Prioritize single public bottlenecks on the leading rival's developed route; evaluate a cut's *durability* rather than removing arbitrary stones which can be replaced immediately. Trade off own tempo to invest in blocking structures. Weakness: wasted investment when the rival has a genuine alternate route.
2. **Multi can exploit focused cutting.** Invest in owned alternate routes and robust continuations, measured by a simulated public cell denial. Counting available empty cells is not evidence of two developed routes. Trade off tempo and some card economy for resilience. Weakness: slower to finish against concentrated rush.
3. **Rush can exploit multi's setup cost.** Prefer fast, coherent progress and forcing continuation, use acceleration opportunistically, accept longer-term fragility. Weakness: concentration produces an exploitable bottleneck.
4. Shared legal generation, own immediate-win checks, opponent near-win blocking, public hazards and private-observation boundary are mandatory for every policy. Do not inspect opponent profile names, hidden state or seed-derived enemy deals. Winners and terminal scoring are identical for all profiles.

## Development and holdout

Development seeds are the already-seen seeds `[101,307,509,719,929,1151]`. Initial rapid iterations may use a prefix, with the whole development set used before freezing a candidate. Handcrafted mechanism fixtures may be used for regression, never counted as random matchup evidence.

Twelve fresh uint32 seeds were drawn and sealed in `/tmp/hex-ai-heldout.json` **before development**. The file's SHA-256 is `a2ced242de6d8d56980061514fe0052cea984eac6b7e9738509d4e8c42b27377`. They will not be read or used for tuning until a candidate's engine hash is frozen. At that point the seeds will be published with the results. No tuning based on holdout outcomes: a failed cycle must be reported as such.

For each seed and pair of strategies, run both 1-vs-2 and 2-vs-1 lineups with the minority strategy in all three seats. Rotate first player and axis independently across configurations; keep the exact same configurations for baseline/candidate. Pairwise results are three-player mirror matchups, not two-player games. Run all six permutations of the three unique strategies as a separate group. Each seed is a statistical cluster; report W/L/D, decisive win intervals and seed-cluster bootstrap intervals for signed result differences. Cyclic point estimates alone are insufficient evidence for a robust cycle.

Compare baseline/candidate draw and connection rates, terminal reasons, action use, behavior metrics and inference cost. The previously measured 144 games had 62 draws: 59 at full board, 3 at the action cap. Hence merely raising the cap is unlikely to fix most draws. Avoid artificial tie-break changes.

A candidate can be released for demonstrated tactical/behavioral improvement and reduced cost even if the intended cycle remains unsupported. Report that limitation and a structural explanation; never label an unsupported cycle complete.

## Acceptance target revised before opening the holdout

The user clarified: mutual wins are fine; no strategy should be conspicuously dominant or weak. A mandatory cycle is withdrawn. Tuning stops here. The **released baseline 13eb890**, not a tuned developmental policy, is the frozen primary validation target. The experimental A/B policies are not being published. The original 144 games were exactly reproduced after a mathematically equivalent path-search optimization (all winners and action counts match); 9,000 complete distance vectors and 9,000 goal costs also matched. This does not justify changing production rules or AI merely to improve a small sample.

The 12 sealed seeds will now be opened once to evaluate the released policies. In addition to paired matchup counts, report observed decision disagreements on identical public positions and per-profile action patterns. If confidence intervals are wide, say that the study found no clear imbalance, not that perfect balance is guaranteed.

Primary holdout now fixes the shipped defaults (seeded terrain, mixed deck, keep cards, neutral off): 216 mirror games and 72 distinct-three-policy games. A separate 36-game timed-card/neutral-event stress group is supplementary, not mixed into the primary balance estimate. The raw released engine is loaded from its immutable git commit, with no optimized or tuned substitution.

## Follow-up prompted by the first holdout (not by a cycle target)

The released policy's first holdout shows a multi-route advantage in both mirror pairings (31–14 vs rush and 33–18 vs cutter, draws excluded in these counts), while the distinct-three-policy group is closer (17/15/20 wins). This is a condition-specific imbalance signal, not proof of general dominance. Before trying any response, 24 fresh seeds were sealed in `/tmp/hex-ai-confirmation.json`, SHA-256 `6fdb2391cb3116d70bee696179a0de9dfd7c4c2f7b87f63d20f0737a0e0deac9`.

Only one existing coefficient will be considered: multi's available-route-space bonus `.6`. Development compares `.6`, `.3` and `.15` using the original six development seeds under shipped defaults. No other strategies, search depths, rules, cards, tie-breaks or hazards change. The hypotheses are that an empty-space bonus can overvalue engineering compared with occupying a cell, and that reducing this one term may preserve observed style differences without giving multi an undue advantage. A candidate must not worsen draw rates materially or create a new obvious weak strategy. The 24 new seeds remain unseen until this limited candidate selection is frozen. If evidence does not support a change, retain production unchanged.

## Frozen decision before confirmation seeds are opened

Keep the released `.6` coefficient. On the six development seeds, actual three-distinct-policy wins were 7/8/8 (13 draws) at `.6`, 10/8/8 (10 draws) at `.3`, and 13/7/8 (8 draws) at `.15`. Lowering the coefficient did not consistently reduce multi's mirror advantage: cutter/multi changed from 10/12 to 11/13 and then 11/16. A lower draw count alone is not sufficient reason to introduce a stronger rush or weaker cutter. There is no evidenced recovery bug and no proposed production change.

The second untouched 24-seed block is now used as an independent confirmation of the **released baseline**, not for further tuning. No experimental policy will be promoted from these outcomes. Report default distinct-three-policy results, mirror stress results and uncertainty separately.

## Implemented configuration disclosure

The actual fixtures rotate first player and target axis but do not exhaust their Cartesian product. Mirror fixtures use the same index for first-player and axis rotation, so these effects are coupled rather than independently identifiable. All six strategy-seat permutations are present in the distinct-three-policy group. The raw fixture configurations, seed-cluster intervals, and this limitation take precedence over the earlier proposed independent rotation.
