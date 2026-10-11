# Shared-core test migration

The old normal Hex engine is preserved verbatim in `tests/fixtures/card_hex-96c109a.html` from commit96c109a59c0bf79a159561ed845715a8e0ab8fee, SHA256740e18b32a467ab9ff87613caff8b1b9501acfaac30d9bfb96c1ba5ee5ed7ac0. Its three existing suites keep every original assertion and now prefix results `[historical96c109a normal Hex]`. Those passes preserve evidence about the old91-cell, personal-shoe, hidden-trap game; they do not validate current gameplay. The three standalone historical balance tools also read this immutable source.

Current normal/Auto behavior is covered by `hex-shared-core.test.cjs`, the current Auto suites, public-simulation differential tests, external-strategy validation/program tests, and the independent current shared-Hex audits in `revision_visual.test.cjs`.

Intentional assertion/fixture changes:

- Normal factories now have271 cells,2–6active seats, seed-rotated directed home goals and one shared n×13-card shoe. The current independent audit checks those rules rather than asserting91 cells, private13-card decks or secret traps.
- Synthetic planner puzzles explicitly place the six homes in canonical orientation, using `helpers/hex-tactical-fixture.cjs`. This preserves their supplied barriers, actual opposite-edge targets, critical cuts and enemy contact geometry. Production seat rotation remains separately tested across counts/seeds; the fixtures do not claim to be untouched production openings.
- The public simulation reroute now replaces a straight distance2 bridge with a straight distance3 bridge. The former bent replacement is deliberately illegal under the new common bridge contract.
- Engineering now asserts real `terrain=0` and `roads=0`; a stale road marker no longer makes a river an ordinary tile. Airdrop fixture terrain is likewise genuinely converted before landing.
- A repaired supply gap may use the new legal tunnel in addition to deploy/bridge. Actual supplied connection is still required after the action.
- The beneficial-truce tactical puzzle explicitly selects diplomacy opportunity. New default vanguard configuration opts out of voluntary pacts; public pact costs and actual capture prevention remain asserted.
- The old planner claim of full rule equivalence to96c109a is replaced with same-current-core action/card parity and explicit deck/tunnel/geometry differences. Old frozen equivalence artifacts remain historical evidence, not a statement about the migration.
- The homepage icon test now requires the actual2–6-seat/271-cell/shared bridge/tunnel/airport description.

Development checks before final freeze include47 migrated tactical tests,23 shared-core/public-simulation tests and95 historical/current audit tests passing. Final release totals and source hashes belong in the final validation report; these intermediate counts overlap and must not be added together.
