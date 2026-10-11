# Local checkpoint — stopped at the user's request

Saved 2026-10-11 around 17:54 UTC. This is **unfinished, unapproved for publication in this state**. No changes from this task were pushed. Branch: `checkpoint/shared-hex-flipfive-20261011-1754` in `/workspace/FuGames`; obtain its exact commit with `git rev-parse HEAD`.

Latest verified published/main SHA: `96c109a59c0bf79a159561ed845715a8e0ab8fee`. Its Game rules and Pages workflows were verified successful. Local work began from this published version; the earlier requested Hex/icon work was already published and was not redone.

## Completed

- Shared `hex-core.js`: normal 271-cell 2–6 local human/AI seats without diplomacy; Auto 1,027-cell six-seat campaign with diplomacy. Common terrain/cards/supply/air rules, straight 2–3-step bridges, bounded bent tunnels and public counterplay; white terrain after engineering.
- Validated data-only JSON strategy programs, persistent multi-action public-information planner and cancellable workers. Concrete tunnel-repair and airport-follow-through regressions fixed.
- Whole-repository Node suite: **378/378 passed** (`docs/hex-shared-core-2026-10-11/repository-final-suite.log`). Shared desktop/mobile/narrow functional, Worker/timer and actual normal-game checks passed. Final quiet desktop/mobile frame p95: 16.8 ms, with documented longer tails.
- Flip Five rules preserved, extracted engine and stronger bounded AI integrated. Conditional proof: after E5 E4 E3, all 78 replies lose by ply 11. Full 79,356-edge certificate verified against production engine. New AI held-out result 10/16 wins against legacy AI; complete 48-game study and all six held-out losses retained.

## Stopped / unfinished

- All study and browser computation stopped; no active study or browser campaign remains. Study supervisor exited 143, as did the interrupted browser harness.
- Formal Hex study: **123/136 complete** (40 normal, 60 matrix, 12 control Auto, 10 candidate Auto, 1 mixed Auto). Two games were interrupted; the remaining queue never started. Files remain intact in `docs/hex-shared-core-2026-10-11/`. `execution.json` may retain its pre-stop running status; this checkpoint note is the authoritative stop record. Protocol and frozen sources were not changed.
- Real Auto browser campaign stopped at **549.205 wall seconds / 548930.2 active ms**, 1,277 actions, 14 goal arrivals, 68 holding rounds, 3 bombardments and no recorded page/console errors. **Not a completed 600-second pass.** Partial data/logs/screenshots: `docs/hex-shared-core-2026-10-11/live-final/`.
- Flip Five full desktop/mobile games and cancellation browser acceptance remain unrun; only runtime smoke and Node/research checks passed. Prepared harnesses remain saved.
- Queued but unapplied copy fix: normal-mode action-cap event currently says ten-minute/six-faction settlement; result panel is correct. Full-hand help wording also remains pending. No runtime changes occurred during the interrupted live campaign.
- No final release, new-SHA CI/Pages verification or online-browser acceptance was performed.

## Known limits

- Normal 40-game cohort: every game ended by connection. The 60-game two-player matrix found **no cyclic dominance**, with second-seat wins 48/60 and airhead weak in short ground races. Do not claim balanced seats or universally stronger strategies.
- Short-horizon AI can still repeat a countered tunnel; one normal development game rebuilt one path eight times before ending. Complete Auto development games showed substantive goals and air use, but are not held-out results.
- Flip Five proof is conditional, not an empty-board first-player-win theorem. Selective AI search is not a proof of optimal play.
- Local Hex screenshots were actually inspected, including mobile conversion, tunnel, handoff, normal-six result and live midpoint. The supplied Library image download failed and was not visually inspected.

## Resume only when requested

1. Read this note and the shared-core `design.md`, `validation.md`, `runtime-freeze.json`, `frozen-sources.json`, `protocol.json`, plus Flip Five research/AI-study READMEs.
2. Preserve the 123 completed games and immutable captured sources/protocol. Do not blindly rerun the supervisor: its runner deliberately rejects overwriting existing outcomes. Resume only unfinished configurations into new files and verify deduplication against the protocol.
3. Complete remaining browser/copy checks and a fresh full 600-second acceptance run if release validation is resumed; explicitly distinguish the saved partial run. Revalidate only changes that are made.
4. Review all final results and limitations, then follow the user's new instructions about publication. This checkpoint must not be represented as a tested release.

Other preserved work directories: `/workspace/FuGames-planner-v2`, `/workspace/FuGames-goals`, `/workspace/FuGames-flipfive-analysis`, `/workspace/FuGames-flipfive-variants`. They were not reset or deleted.

Execution used the selected Codex cloud Linux workspace, Node 24, Python/Playwright and `/usr/bin/chromium` with local HTTP preview. Actual aggregate token accounting is not available in this executor; no token estimate is asserted.
