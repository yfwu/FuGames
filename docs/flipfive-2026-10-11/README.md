# Flip Five: certified opening trap and AI audit

**E5, E4, E3 is a forced first-player win by ply 11.** This is a conditional tactical proof, not a solution of the empty-board game. In particular, it proves that answering E5 with E4 is a losing second move: E3 captures E4 and starts the certified strategy. Symmetry gives the same conclusion for the three other orthogonally adjacent replies to E5. The proof says nothing about replies with a gap, such as C5 or E3.

The previous deterministic architect AI replayed **E5 E4 E3 E7 E2 E1 E6**, losing on ply 7. A complete four-ply audit after E3 showed that 72 of the 78 fourth moves allow this early forced loss. **D3, F3, D4, F4, D5, F5** survive through ply 7, but the deeper certificate proves that all six still lose by ply 11.

For a concrete short defense, **E5 E4 E3 D5 E2 F3** flips E4 diagonally through D5. F3 is the only move that avoids an immediate seventh-move win there. It delays the loss; it is not a game-saving defense. Against D5, the certified stronger fifth move is **C5**, which forces a win within seven further plies. The tempting F5 reply to E2 fails because E6 recaptures E5 and makes five.

## Evidence and source boundary

The source was copied from repository HEAD `96c109a59c0bf79a159561ed845715a8e0ab8fee`. Original `flip_five.html` SHA-256: `331bd07414231a34a12f57eb5768d1e108fb2fed0459f37be8c68e8ed0c28120`. No game rules were changed for this analysis.

The complete proof is `after-e3-h8-proof.json.gz`, with decompressed SHA-256 `aae7e19fadddbfe318b2b1b251905ab8c270a08ab27fa00c1425356e4708d440`. Its root is the position after E5 E4 E3, with player 2 to move and eight future plies allowed. It contains **62,319 distinct proof records, 79,356 legal edges, 653 defender nodes, and 30,500 winning terminal leaves**. Each defender node includes every legal empty-cell move; each attacker node supplies one winning continuation. Depth decreases on every edge, so the certificate cannot hide cycles. The original JavaScript engine independently validated every edge and leaf. `verify-proof.cjs` repeats that check against the current extracted production engine.

The full-width solver plus certificate construction used 118,742 recursive calls, 6,905,695 successor generations, 29,605 cache hits, and 7.938 seconds on the research machine. The compact short-horizon audit used 1,076 recursive calls and 194,239 successor generations in 0.0853 seconds. These are observed timings, not performance guarantees.

The separate engine comparison passed on 6,403 legal transitions and corresponding outcomes across 93 reachable sampled boards, seed `0x51636d27`. The two small certificates cover all 76 replies after E5 E4 E3 E7 E2 and all 77 attacking fifth moves after E5 E4 E3 D5. They are suitable for routine regression tests; full proof replay is an explicit, separate command.

## Reproduce and verify

From the repository root:

```sh
node --test tests/flipfive-tactics.test.cjs
node docs/flipfive-2026-10-11/verify-proof.cjs
```

The verifier loads `flip-five-engine.js` when present, or the original inline production engine before extraction. To select an explicit engine:

```sh
FLIP_FIVE_ENGINE=/absolute/path/to/flip-five-engine.js \
  node docs/flipfive-2026-10-11/verify-proof.cjs
```

To regenerate the proof with one CPU process:

```sh
g++ -O3 -std=c++17 docs/flipfive-2026-10-11/solver.cpp -o /tmp/flipfive-solver
/tmp/flipfive-solver --mode certificate --line 'E5 E4 E3' --depth 8 \
  --seconds 45 --nodes 1500000 > /tmp/flipfive-proof.json
node docs/flipfive-2026-10-11/verify-proof.cjs /tmp/flipfive-proof.json
```

The solver supports `--mode prove`, `--mode audit` (every next legal move), and `--mode moves` (transitions for cross-checking), plus `--board` as 81 row-major digits, `--turn`, `--attacker`, and `--depth`. For example:

```sh
/tmp/flipfive-solver --line 'E5 E4 E3 D5' --depth 5
/tmp/flipfive-solver --line 'E5 E4 E3 D5' --depth 7
```

The first returns no forced win within that horizon; the second proves a win. This illustrates why a shallow negative result is not durable defense.

## Search semantics and limitations

With the default `--beam 0`, attacker OR nodes and defender AND nodes use every legal empty cell. Move ordering changes speed, not proof validity. `proven_win` means a designated attacker has a strategy winning within the stated horizon from this exact position. `no_forced_win_within_horizon` does not mean a draw or a full-game loss. A nonzero beam restricts only attacker choices: positive proofs remain sound; a negative result is explicitly `not_found_restricted_attack`. Budget exhaustion is reported without a proof or refutation. Certificate mode exits with an error instead of emitting a successful incomplete proof.

The transposition key contains all 81 owners, side to move, and remaining depth; the attacker is fixed per run. `nodes` counts recursive entries; `generatedSuccessors` counts every application including repeated probes and is not a unique-state count. Proof-record counts are unique board/turn/depth records. Elapsed time is sampled every 4,096 recursive entries, so the requested seconds are an approximate safety cap.

The represented rules are: arbitrary empty-cell placement; eight simultaneous sandwich rays with no cascade; after-flip runs of at least five; full-board majority if no line. The occupied set increases by one every ply, so there is no repetition or pass and games end by 81 plies. From a legal nonterminal board, recoloring opponents to the mover cannot create an opponent line; the full engine still handles an arbitrary pre-existing double-five as a draw. Equal full-board counts are impossible on 81 cells.

No exhaustive empty-board solution, first-player win probability, or rule-balance claim follows from this proof. New AI choices outside the trap are an improvement in behavior, not evidence that those choices are game-theoretically safe. Search performance and held-out comparisons are reported separately by the AI implementation audit.

## Independent review of the new AI

The optimized search applies the same rule transition: it computes all ray changes from the old board before updating ownership, maintains counts for each five-cell segment, and checks the changed segments after all flips. A legal nonterminal move cannot create a new opponent line. Root states still call the full rules engine so arbitrary terminal and double-five inputs are handled correctly.

`node docs/flipfive-2026-10-11/verify-optimized.cjs` independently compares the optimized application and hypothetical winning probe to the production engine. The recorded run passed **6,411 transitions and 6,411 winning probes on 101 boards**, including near-full majority results and a double-five root. It also checked that every hypothetical probe restores the entire state. The current full proof replay additionally passed against extracted production engine SHA-256 `2113ee773ff4dfc76cca8c9b291659ff4b3095101c4b1e178007658115a4b1c1`.

Budget accounting includes generated placements and hypothetical win probes. The exact initial screen has at most 81 generated moves plus 81×80 probes (6,561 total), below the minimum accepted budget of 8,000. Recursive generation and frontier scans reserve at most 81 operations before they begin. An incomplete iterative-deepening pass does not overwrite the last completed choice. The independent tactics tests checked the 36,000-operation default cap as well as legal choices.

The first candidate failed the historical test at seed 17 because its depth-three frontier missed an immediate winning continuation. The final candidate probes for such a win at that frontier and passes the independent suite. This is an observed development correction, not held-out evidence. The final search still restricts quiet continuations to a heuristic beam, so completed depth is not a full-width proof. Its returned `proof: false` correctly records that limitation.

With both profiles and seeds 0, 17, and 871, the final candidate avoids the certified adjacent reply after E5. Observed replies C5/E3 leave an empty cell between the stones and lie outside this proof's premise. They have not been proved safe to the end of the game. See `ai-study/` for frozen evaluation games, including the six reported held-out losses; development wins must not be substituted for that result.

## Screenshot boundary

The supplied Library image resolved as `image.png`, 694×464 and 83,032 bytes. Official materialization failed with `library file transfer failed: download failed` (exit 1). It was not visually inspected; none of these positions were reconstructed from the image. `source-evidence.json` retains its resolved identity. The research used the actual local rules and reproducible legal moves.
