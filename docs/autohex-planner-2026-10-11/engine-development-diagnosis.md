# Complete development campaign: frozen planner v1

This is one development seed (`planner-engine-development-5171`), not held-out evidence. Both policies completed 2,000 legal actions and 600,000 active model milliseconds from identical seeded board, terrain, hands, deck, and airport state. Source strings and hashes, every action, periodic route snapshots, and final boards are saved in [engine-complete-development.json](engine-complete-development.json); [engine-development-summary.json](engine-development-summary.json) summarizes them. Reproduce with `node docs/autohex-planner-2026-10-11/engine-development-runner.cjs`.

| Outcome | Released96 | Planner v1 |
|---|---:|---:|
| Goal arrivals |18|0|
| Holding rounds |100|0|
| Air actions |27|32|
| Accepted pacts |3|65|
| Final-quarter board changes |594|679|
| Final-quarter captures + destructions |302|199|

The planner did not merely lose connections before round scoring: none of its six factions ever reached its own edge even transiently. Best supplied gaps were 7, 7, 9, 11, 10, and 10 cells; final gaps were 15, 19, 25, 20, 15, and 17. Final faction footprints were 21–47 stones, far below the cap. The failure is sustained strategic stagnation amid active combat, not a turn scheduler or footprint lock.

In the final 500 turns, public commitments were 229 interdiction, 100 airport, 113 recovery, 49 direct, 4 flank, and 5 defense. Across the whole game there were 971 commitment episodes (427 improved the supplied frontier at least once), so persistent memory did not preserve the campaign objective across frequent tactical changes. These labels alone are not the failure evidence; the unchanged distant goal gaps and zero physical goal arrivals establish it.

Code-level diagnosis: each plan receives its own incomparable deficit-reduction reward plus an intrinsic plan prior. Removing one nearby tactical target can therefore repeatedly outscore three moves along a long goal route. A new completed harassment objective resets commitment history, while the beam can retain two different tactical targets and discard every own-route alternative. Flank candidates use fixed mid-board waypoints and their extra opening preference expires after round 18; they lack a persistent late-game bypass objective. Diplomatic options become frequent tactical shelter without demonstrating subsequent route exploitation.

The proposed v2 change is structural: retain one common campaign route objective and realized stagnation ledger across tactical missions; evaluate remaining own-route potential in common units for every leaf; preserve an own-route candidate through each beam depth; make airports and interdictions subordinate to advancing that route or countering an actual imminent/held enemy scoring connection. Generate late flank waypoints around the current contested frontier. Keep real three-turn public-rule rollouts and the successful tactical mechanism fixtures. No runtime v1 files were edited during this diagnosis.
