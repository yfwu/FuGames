# AutoHex strategic comparison — heldout

The paired sample contains 36 baseline campaigns and 36 expanded campaigns with identical seed, first-seat and profile-rotation conditions. Conditions match: true. Each campaign ran 2,000 legal AI actions with 300 model active-ms per action. This is accelerated model-time evidence, not a ten-minute foreground browser run.

Baseline: git revision 13c94a8, engine SHA256 b9f70d993c417964899feea6dbd7cc2bd971d524a7a3fd048a5b9948f0f57cdb.
Expanded engine: SHA256 a75d8a8fe9c372921f1937a7e4d5b40e438642a07a6f6979ea30154304a5fb26. The final candidate was frozen before its held-out sample; no held-out observations were used to retune it.

## Spatial fighting and occupation

Regions are center (cube radius ≤6; 127 cells), middle (7–9; 144 cells), and outer (10–18; 756 cells). Combat counts the cells named by capture/destruction events, including turret and bombard damage. An exchange affects two named cells and therefore contributes two spatial impacts. Neutral removals and supply retreats are excluded from combat. Occupation is sampled every 30 actions. Per-cell measures correct for the much larger outer region.

| Measure | Baseline | Expanded |
|---|---:|---:|
| Center combat impacts per cell per campaign | 2.86 | 0.23 |
| Middle combat impacts per cell per campaign | 1.52 | 0.79 |
| Outer combat impacts per cell per campaign | 0.51 | 1.18 |
| Center / outer combat-density ratio | 5.66 | 0.20 |
| Raw outer share of combat | 39.6% | 86.1% |
| Center occupation density | 73.3% | 10.7% |
| Outer occupation density | 21.3% | 29.6% |
| Mean faction spatial-action sector coverage, out of 6 | 5.33 | 4.66 |
| Campaigns with combat in all six sectors | 36/36 | 36/36 |

Sector coverage counts sectors reached by a faction's spatial actions; it is not proof that all six sectors belonged to one connected route. Region/sector raw counts and every campaign are available in the JSON evidence.

## Goals, late activity, facilities and counterplay

| Measure | Baseline | Expanded |
|---|---:|---:|
| Goal arrivals, total | 79 | 106 |
| Campaigns with at least one arrival | 27/36 | 31/36 |
| Supplied goal-holding rounds, total | 233 | 163 |
| Final-quarter meaningful actions, mean / 500 | 498.22 | 499.69 |
| Final-quarter combat impacts, mean | 284.39 | 272.61 |
| Final-quarter air actions, mean | 0.00 | 10.56 |

The expanded sample recorded 1085 airport activations, 1022 losses of active status, 827 airdrops and 348 bombardments. Repeated activations of the same airport count separately. Mean concurrent active airports were 1.39 of six; peak observed concurrency was 5. Mean distinct factions actually using air actions per campaign were 5.08 of six. Supplied depot control averaged 4.15 of six, with 7579 new/recovered control events. Neutral events removed 1185 stones and were blocked 592 times by shields or fortification. Fortification counter: 25156 non-anchor stones first reaching age 31.

These counters demonstrate actual activation, attack and loss, not merely visible facility markers. A lost center, local 12-stone threshold, or home-supply route immediately removes airport access. Stock, turret/footprint caps and the shared cooldown apply to every faction; multiple depots/airports do not stack the resource bonus or cooldown.

## Score concentration and limits

Mean final top-to-second score lead: baseline 9.89, expanded 16.08. Expanded final leads ranged 1–60; maximum sampled in-game lead was 70. The halfway leader also finished first in 14/36 baseline campaigns and 7/36 expanded campaigns. Fractional wins by seat and AI profile are in the summary JSON; tied winners each contribute an equal fraction.

This finite sample does not establish balance or eliminate snowballing. Goal frequency, score spread and sector activity vary by seed. The comparison evaluates the facility/AI/neutral-event expansion as one bundle and cannot isolate each feature's causal contribution. AI profiles differ in public tactical preferences, not energy, cards, stock income or scoring privileges. No fixed winner, catch-up score, or identity subsidy is used.

Mean measured chooseAction time per campaign averaged 3.34 ms baseline and 4.76 ms expanded. These runs shared CPU with other studies/browser validation and are not an isolated rendering benchmark. Root's final browser performance and real-time campaign evidence are separate.

## Reproduction

From the repository root, run:

```sh
node docs/autohex-visual-2026-10-11/strategy-study.cjs before heldout
node docs/autohex-visual-2026-10-11/strategy-study.cjs after heldout
node docs/autohex-visual-2026-10-11/strategy-summary.cjs heldout
```

The baseline is compiled in memory from git show 13c94a8:autohex-engine.js and therefore needs that history. Development baseline: six seeds × six rotations; disjoint tuning: seeds 211/307/401 × rotations 0/2/4. The exploratory expanded development run was stopped after 19 campaigns to reduce CPU contention during real-time acceptance and is explicitly marked partial. The final claims above use the complete paired held-out sample, whose seeds are 701/809/907/1009/1103/1201 with all six rotations and first seat rotation + 1.
