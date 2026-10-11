# Tux 2D independent review

This review covers the new racing game independently of AutoHex. The reviewer made no changes to either game's engine or UI; the owning UI/engine worker implemented the fixes below. AutoHex remained frozen.

Engine snapshot after the independently retested fixes: SHA256 `d136ac5ee7870a17900473d11878c3e7800c5a6a1502c449326300af604ac99e`.

## Engine findings and verified corrections

1. **Collision-driven checkpoint crossing could be missed.** Checkpoints were evaluated before kart collision displacement. Place two unfinished, started karts at checkpoint 5 arc distance minus 0.2 and minus 8, with zero speed, matching `trackS`, and expected checkpoint 5. One step pushed the front kart from plane side −0.2 to approximately +6.93, but its checkpoint remained 5; the next forward tick also missed it. The owner moved progress validation into one post-collision pass using the original tick position and actual collision displacement allowance. Independent rerun advanced checkpoint 5 to 6.
2. **Expired projectiles and hazards could still hit.** A stationary target overlapped by an armed object with `life = DT / 2` took a hit during the same tick that expired the object. Both loops now skip nonpositive remaining life before hit checks. Independent reruns recorded zero hits and removal.
3. **A wall-discarded projectile could still hit.** A projectile at track distance 82 hit a kart at distance 67 despite the projectile wall cutoff of 78. The owner added an immediate skip after wall expiry. The identical fixture now records zero hits.
4. **Coincident kart centers were never separated.** Two overlapping, stationary karts with 0.5 seconds of stun remained at distance zero after ten ticks because the collision loop skipped tiny distances. The owner added a deterministic fallback normal. Independent rerun separated the centers to 22 units and recorded one collision.

The final barrier constraint runs before the single progress-validation pass, so post-physics corrections no longer bypass checkpoint accounting.

## Other inspected invariants

- Start/finish crossing requires forward motion through the expected gate plane, proximity to that gate, and bounded physical movement. The initial start-line crossing arms the race without granting a lap.
- Gates advance in order. A subsequent finish crossing also requires at least 88% of one track length in signed accepted progress; reverse movement does not grant checkpoint or lap credit.
- Nonlocal track sections more than 500 arc units apart are at least approximately 406 world units apart in this layout, exceeding the combined drivable barriers. This limits accidental nearest-segment shortcuts on the current track; it is not a general guarantee for future track designs.
- Drift charging, boosts, shields, stuns and movement use the same fixed `1/60`-second engine tick. Human and AI racers share `_physics`, item consumption, hit handling and collision rules. No AI teleport or identity-specific physics multiplier was found.
- AI differences are public steering/pace preferences. Seeded steering mistakes are bounded to ±0.18 for 0.35 seconds, with subsequent intervals of 9–16 seconds. Reverse recovery uses normal steering/braking physics rather than repositioning.
- Projectiles, hazards and event history are bounded. Observations expose only the viewing racer's held item; AI steering reads public world hazards, projectiles and racer positions.

For identical-input comparisons, capture the actual controls delivered to `_physics`. Calling `chooseAI` on a pre-step observation can differ at a mistake boundary because scheduling happens inside `step`; changing racer 0 between human and spectator also changes which mistake RNG draws occur. That is not evidence of different physics equations.

## UI runtime review

The completed `tux2d-ui.js` was reviewed read-only. The independent browser interaction runs are owned by the root/test worker; the following are source-review conclusions, not substitutes for those runs.

- The animation loop accumulates elapsed frame time and calls the engine only in fixed `DT` increments. One delayed frame contributes at most 0.1 seconds, limiting catch-up to six normal ticks. Longer stalls intentionally slow simulated race time instead of advancing vehicles in a large jump.
- `stop()` invalidates the old generation, cancels its pending animation frame and clears accumulated time. Each fresh schedule resets its time reference; the callback checks its generation before doing work. Pause, restart and hidden-tab handling use this path, and race completion stops scheduling.
- Hiding the document pauses the engine and clears held input. Returning to the page leaves it paused for explicit resume. Window blur clears held keys and pointers; it does not itself pause a still-visible race. The optional automatic throttle remains an intentional setting, separate from held inputs.
- Keyboard release always deletes the released key, including when focus has moved to a form field. Driving keydown ignores input/select/textarea controls. Pointer controls track each pointer separately and release on `pointerup`, `pointercancel` and `lostpointercapture`; pause/reset/blur/page hide also clear their pressed appearance.
- The item button emits a one-tick pulse. Held Space or touch uses the engine's shared rising-edge item latch. Human rendering requests observer 0; spectator rendering requests observer −1 and does not reveal held item types.
- Reset constructs a fresh engine and clears transient input/scheduler state. The root identified that the original restart handler immediately started another race, keeping seed/mode settings unavailable; the corrected toolbar action returns to ready. The separate result action still starts another race directly.

One small keyboard issue was sent to the UI owner: the original global driving-key handler intercepted Space even on a focused setup/pause button, preventing normal button activation. The owner corrected this by capturing driving keys only during countdown/racing, preserving native Space on buttons, and restoring canvas focus on start/resume/result replay. The corrected source was reviewed; its SHA256 begins `88bfae2a`. The root's final browser validation records the complete frozen source hash and interaction results.

The optional 24-fixture gate-position recovery extension was not run: the root requested avoiding new CPU-heavy simulations while the separate real wall-clock human race was recording. Existing targeted engine fixtures and the test worker's bounded backwards-recovery/race studies remain the available recovery evidence.

## Limits

The targeted reproductions above were rerun after the owner's fixes. Seeded race-completion and regression studies belong to the test worker and should be read with their recorded source version. This review does not claim that every seed, arbitrary externally mutated state, future track, or collision arrangement is guaranteed to finish. The source-reviewed fixed-step scheduler supports consistent physics across normal rendering rates; actual browser input and lifecycle evidence is recorded separately in the browser validation artifacts.
