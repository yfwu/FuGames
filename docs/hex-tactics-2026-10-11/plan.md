# Hex tactical cards: rules and validation fixed before implementation

Baseline: `966be7f08d784f802b4ad1a8a6d65a75d007ba9f`. No renewed cyclic-AI target; no changes to other games, icons, winner bonuses or AI identities.

## Rules

- Reroute: spend one card and one turn. Select a retained endpoint, the other endpoint of an existing own bridge, then a different own endpoint. Replace only that bridge; the new bridge must obey the same straight two-step geometry and all-owner intersection guard. Shared endpoints remain legal. No new stones and no moving enemy bridges.
- Block: spend one card and one turn on an empty, walkable, unblocked cell. It is blocked for the next three completed actions, then opens. All players can spend a turn to clear any block, without a card. It does not move or reveal traps, alter terrain, block an overhead bridge or protect stones from cannon fire. No timer advances during pause or a pending shield response. Terminal cost ignores temporary blocks, preventing a last-action scoring subsidy.
- Exchange: spend one card and one turn. Select an own ordinary stone and an adjacent empty cell or ordinary enemy stone. Neither endpoint may be a turret or any bridge endpoint; both must be walkable and unblocked. Swap stones only, not terrain or hidden traps. Each landing can trigger traps hostile to that stone's owner. Existing hill lifetime is preserved on hill-to-hill moves; a newly entering stone gets three subsequent owner actions (the actor's current action is excluded). All landings/effects resolve before simultaneous-win checks. Shield continues to counter removal only.
- Tactical deck is a selectable new default; original mixed and classic remain. Same 13-card recipe for every seat, independently shuffled. One each of the three new cards replaces three of the old random-extra slots; two extras still vary. Original eight guaranteed cards remain, including exactly one shield. No replenishment or leader/trailer-dependent draws. No public pickup monopoly.

## Testable hypotheses

1. Exchange can escape a public hazard or alter a bottleneck at the cost of an existing own stone; reroute can redirect an established bridge without increasing its count; block can buy time but can be cleared by anyone.
2. New cards create usable choices for publicly trailing players as well as leaders. This is an opportunity hypothesis, not a promise of comeback wins.
3. Guard against increased snowballing: compare leader retention, trailing player's eventual wins, public path-gap movement, draws, termination and usage. Win rates alone cannot establish the causal effect of using a card (use is chosen, not randomized).

## Development and held-out comparison

Development seeds: 101, 307, 509, 719, 929, 1151. Three AI profiles in all six seat permutations; rotate first player and target axes with explicit fixture records. Compare `mixed` versus `tactical` under the same candidate engine, seed and configuration. Rules and common evaluation are identical apart from the available cards. Original mixed draws retain their exact generation sequence.

Before implementation, 24 new uint32 seeds were sealed at `/tmp/hex-tactics-heldout-seeds.json`, SHA-256 `7bddd8f003b9c3fc7c248afe7ab0814de3383f257913952a9f6484482756a261`. Do not open until the candidate engine hash is frozen. Held-out primary: 24 seeds × 6 permutations × 2 deck conditions = 288 full games; additional six-seed timed-card + neutral-event stress: 72 games, separately reported.

At action 24 and 48, rank players by public relaxed path cost (own 0 / empty 1 / enemy 3 / river 2; ignore temporary blocks for a consistent long-term measure). Report unique leader/worst eventual wins, ties and eligibility counts; also cost gaps one full round later. Log the pre-action rank and immediate/one-round gap change for each new-card use, plus held/expired cards and use opportunities. These are descriptive: the conditions diverge after earlier actions, and path cost is an imperfect position-strength proxy. Bootstrap whole paired seed clusters for deck-condition differences. Report uncertainty, draw/cap reasons, card conservation and illegal actions. Never tune on held-out results; if a material problem appears, report and use a newly sealed validation batch for a revision.

Regression covers shared public legality, atomic invalid input, reversed/overlapping/crossing bridges, blocker expiry/clearing, terrain and hill lifetime, simultaneous cannon/trap/neutral effects, simultaneous wins, hidden-state invariance, seed replay and spectator restart/timers. Desktop and mobile Chromium must exercise actual buttons/taps, complete games and inspect screenshots. Keep prior 203 tests, updating only a card-catalog assumption when needed.

## Candidate frozen before held-out seeds are opened

Engine SHA-256: `f980db2193b5d334a04c188d81b5db7398d4d4a14a120ecc2f46329733c7d6ed`. Development completed 72 paired-condition games after correcting consumed own-trap forecast state. No AI profile weights or outcome rules were tuned. All three new cards were used in legal games; targeted tactics and cross-interaction regressions passed. Original mixed baseline action traces matched the released engine on six development-seed runs. The new rules remain as specified above. Freeze this engine for the independent 360-game confirmation; do not tune to its outcomes. UI-only legibility changes do not alter the engine hash.

## Deployment decision after confirmation (engine remains frozen)

The held-out sample shows a warning: unique-trailer eventual win rates fall at both the 24- and 48-action landmarks, with exploratory paired-seed intervals below zero. Leader retention intervals span zero, and draw rates are unchanged. This is not proof of causality, but it does not support deploying the tactical deck as the default comeback aid. Keep **mixed as the default**, offer tactical as an explicit opt-in, and report all outcomes. This is a UI/deployment decision only; the confirmed engine hash, rules, parameters and seed outcomes are unchanged. Timed optional games used no reroute/block cards before expiry, another reported limitation. No holdout-driven retuning is performed.
