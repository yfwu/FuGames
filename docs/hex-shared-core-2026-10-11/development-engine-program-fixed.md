# Independent complete development check

This is a development comparison on the previously used seed `shared-dev-engine-5171`, not held-out evidence. Both games used captured copies of the three runtime modules; later filesystem edits could not affect execution. No runtime file was changed during this check. Exact source bytes, the action trace and final board are in [the capture](development-engine-program-fixed.json); full hashes and the external default JSON are in [the manifest](development-engine-program-fixed-manifest.json).

The configured planner limits remain six mission candidates, 20 logical transitions, three own-action depth, beam width two and two actions per plan. The run used one CPU worker. Timing was measured on a shared host and is not a controlled performance comparison.

| Measure | Prior development capture | Program fixes, same seed |
| --- | ---: | ---: |
| AutoHex legal actions / modeled active time | 2,000 / 600,000 ms | 2,000 / 600,000 ms |
| Opposite-edge arrivals | 14 | 12 |
| Scoring holding rounds | 27 | 64 |
| Air actions | 10 | 25 |
| Tunnels built | 139 | 42 |
| Distinct owner/path combinations rebuilt | 27 | 3 |
| Maximum builds of one owner/path | 10 | 2 |
| Normal six-player connection finish | Action 112 | Action 241 |
| Normal air actions | 1 | 0 |

Every chosen action was legal. AutoHex ended by its timer; normal Hex ended by an actual supplied connection, before its 600-action cap. AutoHex's last 500 actions included two arrivals, 14 holding rounds, ten air actions, 250 captures or combat removals and 500 meaningful actions. Its final 250 actions had no new arrival or scoring hold, so this sample does not demonstrate uninterrupted late goal possession. The final score leader was player 4 with 310 versus second-place 185; one seed cannot establish competitive balance.

[Exact action replay](replay-engine-program-fixed.cjs) reproduced both final boards and result objects. Of nine AutoHex airdrops, eight were immediately supplied. The ninth, at action index 1621, acquired supply on the actor's next action at 1627 and later fired nine times. The exact airborne turret objects produced 50 later hits; replacement turrets at the same cells were excluded. Sixteen bombardments removed their targets and ten broke a currently held enemy connection. The detailed targets and consequences are in [air utility evidence](development-engine-program-fixed-air-utility.json).

The airhead policy executed three drops and five bombardments; the airport-averse flanker executed seven tunnels and five bridges with zero airport missions. Other factions also used acquired airports. These are realized action counts, not guarantees that each configured mission always completes. Budget cooldowns and all per-policy stages are preserved in [the summary](development-engine-program-fixed-summary.json).

A normal-mode heuristic weakness remains. Player 3 built the same tunnel eight times: `(5,0) → (5,-1) → (6,-2) → (6,-3)`. Six late constructions at action indices 188, 194, 200, 206, 212 and 224 were sabotaged at the interior `(6,-2)` within one or two opponent actions. At 206 and 224 the planner reported a stalled-plan reassessment but chose the construction again. Whether its ground alternatives were durable requires inspecting the reconstructed states; the trace alone does not establish that. This was neither an illegal action nor an unbounded game: normal Hex finished at action 241. The remaining loop is reported explicitly rather than claiming transport repetition was eliminated.

No held-out seed was used, and this check does not prove general superiority. The source manifest records core `3fc410b7…`, planner `3d49ff6e…`, strategies runtime `475536a7…` and default JSON `10ce104f…`.
