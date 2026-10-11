# Shared Hex core validation

Status: the136-game preregistered formal study is running after the365-test Hex checkpoint, two complete post-fix Auto development campaigns, normal6development and quiet browser performance checks passed. The frozen candidate is core `3fc410b7…`, planner `3d49ff6e…`, strategy module `475536a7…`, JSON configuration `10ce104f…`. Exact bytes, full hashes and the parent13-file runtime manifest are in `frozen-sources.json`; source resolution cannot fall through to mutable files. Execution begins with two workers and may rise to three only after the real browser600-second run is released. No runtime tuning is permitted from these outcomes.

Both modes now use the same reducer. Normal mode has271 cells and2–6active seats, no alliances, and first settled connection or a100-actions-per-seat cap. AutoHex has1,027 cells, six seats, alliances and the600,000-active-millisecond score campaign. Common tests exercise radius5 own-piece targeting, straight span2–3bridges, bounded bent tunnels, public sabotage and endpoint collapse, river/hill conversion, hill retreat, one physical n×13-card shoe, optional owner-turn expiry, upfront shields, supply, air resources and actual ending rules.

The explicit migration record is [test-migration.md](test-migration.md). Historical normal Hex assertions remain unchanged against a checksum-verified released HTML fixture; their passes are identified as historical. Current independent audits test271-cell geometry, public/private observation boundaries and the new common finite shoe.

Verification before formal execution:

The frozen Hex checkpoint passed365/365tests in260.334seconds with `node --test --test-concurrency=1 tests/*.test.cjs`; `hex-checkpoint-suite.log` records it. After the other-game integration, the root ran the final whole-repository suite:378/378passed in292.17seconds; `repository-final-suite.log` records that release-wide check.

Earlier checks:

- The earlier development full Node run passed358/358tests. Its281.1second wall duration includes an intentional process pause during the UI performance window, so it is not a throughput benchmark. This run began before the five new policy tests were added.
- The expanded shared-core suite passed18/18, including2–6seat replay, seat-count-invariant terrain and identical common-action outcomes across modes.
- The public simulation suite passed7/7, including terminal normal games, known timed-card/hill clocks and tunnel sabotage. Unknown future draws and enemy cards remain absent from the simulation.
- All five new program tests pass: actual ground/tunnel sequence differences, durable repair against an active supplied saboteur, airport investment/avoid follow-on, persistent investment budget/cooldown and private program isolation. The two original strategic failures are preserved in `program-regressions-before-fix.log`; `program-regressions-fixed.log` records the unchanged fixtures passing after the fixes.

Complete development normal4/5games ended by actual connection at167/169actions. They captured the earlier counterplay implementation and showed22/25tunnel builds with20/19sabotages; these results helped motivate the counterplay checks and are not formal validation. Later development captures from the engine/root are separate files with their own exact sources. No development result is pooled with the formal cohort.

The [preregistered protocol](protocol.json) specifies136complete games:12paired AutoHex configurations per policy,12alternating-policy reversal games,40normal2–6seat games exhausting every first seat for two seeds per count, and60true two-player matchups covering15strategy pairs, both seat orders and two seeds. The control is `greedyAction` on the SAME new core; comparing old96 rules against new rules would confound the result. Every Auto campaign must execute2,000legal actions and600,000model milliseconds. Every normal match must reach the actual engine connection/cap result. No illegal-action substitution is permitted.

The runner captures core, planner and strategy module bytes plus the JSON configuration, hashes them, and resolves dependencies exclusively from captured source. Metrics include actual goal progress/holding, paid air actions with supplied drops and later turret hits, bombardment supply/goal cuts, transport/sabotage repetition, realized intent completion, budget violations, last-quarter activity, spatial combat per board-cell area, winners/scores by seat/geometric slot/strategy, and decision time. Last quarter means the final quarter of the actual completed match, including early normal endings.

Interpretation limits are preregistered: six independent Auto seeds with only two configurations each, globally balanced margins rather than a full factorial; mixed parity reversal rather than every policy assignment; only two independent normal matchup seeds; no general balance, universal superiority or guaranteed cyclic strategy dominance. These are accelerated simulations. Real browser elapsed time, rendering and human-control checks are separate evidence owned by the UI/root validation work.


## Completed normal cohorts

All40normal seat-coverage games and60two-player matrix games finished by actual connection; none hit the action cap or drew. These complete cohorts can be read independently while the Auto campaigns continue.

| Active seats | Games | Actions(min–max) | Mean actions | Air actions |
|---|---:|---:|---:|---:|
|2|4|33–46|37.0|0|
|3|6|49–130|85.0|3|
|4|8|84–281|165.0|5|
|5|10|109–440|217.6|6|
|6|12|133–411|227.6|6|

The40-game cohort used373tunnels,273sabotages and20air actions.120builds repeated a previously built identical path; this metric does not establish that each repetition was an immediate futile loop. All recorded investment counters stayed within their configured budgets.33direct/flank commitments completed after at least two actual actions; the separate dynamic tactics fixture verifies durable repair against a home-supplied active saboteur.

The true two-player matrix has four games per unordered pair: two independent seeds, each with both program seat orders. Entries below are row-program wins out of four; there were no draws.

| Program | Vanguard | Airhead | Flanker | Interdict | Recover | Envoy |
|---|---:|---:|---:|---:|---:|---:|
|vanguard|—|4|3|3|3|3|
|airhead|0|—|0|1|0|1|
|flanker|1|4|—|2|2|2|
|interdict|1|3|2|—|2|2|
|recover|1|4|2|2|—|2|
|envoy|1|3|2|2|2|—|

Vanguard won16/20appearances and Airhead2/20; the other programs won10–11/20. No triple formed even a strict-majority cycle in this sample. It provides no evidence of general rock-paper-scissors strength or balanced win rates. Seat2won48/60games while seat1won12, a material seat/profile/geometry limitation despite swapping every program pair. The matrix mostly consisted of short33–50action ground races: no tunnels or bridges and only two bombardments. This is a poor environment for long airport investment and does not measure the whole Auto campaign role of that program.

Airport labels must be read cautiously: normal games recorded17completed airport commitments but none counted as a multi-action completion under the exact same commitment key. Changing targets/reviews can split construction and flight into different records. Actual20air actions, their eventual utility and the controlled airport follow-on test support narrower claims; labels alone do not prove an uninterrupted strategic project.
