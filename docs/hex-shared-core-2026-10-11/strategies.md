# Editing a shared Hex strategy

Both pages accept the same JSON configuration. Start from [`config/hex-strategies.json`](../../config/hex-strategies.json); the editor schema is [`hex-strategies.schema.json`](../../config/hex-strategies.schema.json). Runtime validation in `hex-strategies.js` is authoritative. Loading a valid file does not execute JavaScript or raise the global search budget.

Use version `1`, between one and twelve profiles, unique lowercase IDs and files under 32 KiB. Every field is required so a misspelling cannot silently fall back to a different strategy. A profile is assigned to an AI seat before starting. Replay preserves the normalized configuration, seat assignments and its configuration ID.

| Field | Actual effect |
| --- | --- |
| `mission` | Selects a bounded staged preference: `connect`, `airhead`, `flank`, `interdict`, `recover`, or `diplomat`. Shared immediate threat/win search can override a preference. |
| `route.side` | `-1` or `1` permits that flank; `0` allows seed-dependent choice of either side. |
| `route.transport` | `ground`, `bridge`, `tunnel`, or `both` changes generated construction actions and prospective entrance placement. Existing public connections still carry supply. |
| `route.maxDetour` | Maximum additional estimated route actions allowed for a flank, 0–18. |
| `airport.mode` | `avoid` excludes acquisition missions; `opportunity` requires a concrete public benefit; `invest` also admits a staged future front-line turret project. |
| `airport.maxOwnActions` | 6–24 selected airport actions across tactical reviews, followed by twelve own turns of acquisition cooldown when exhausted. Changing a label does not reset the investment count. |
| `airport.maxSetupCost` | 6–36 estimated actions/resources: excludes projects whose visible approach, cluster, hold and supply costs exceed this budget. |
| `airport.projection` | `turret`, `bombard`, or `either` changes the planned airport follow-through. A turret mission is not complete merely because an ordinary stone occupies the destination. |
| `commitment.reviewOwnTurns` | 2–8 own turns before reviewing a mission. |
| `commitment.stalledOwnTurns` | 2–6 own turns without mission progress before replanning. Global connection stagnation also survives tactical mission switches. |
| `commitment.maxOwnTurns` | 8–36 own turns limits a retained mission. |
| `diplomacy` | `avoid` excludes offers/acceptance; `opportunity` evaluates public route obstruction and shared threats. Normal Hex's core rejects diplomacy regardless of configuration. |

The search always pays real construction costs and simulates public replies. A future airport, bridge or tunnel is not treated as already built. Policy preference may choose a bounded detour only when no visible imminent scoring threat needs attention. Urgent defense uses the common legal-action and public-state model; it never reads another hand or predicts a private draw.

The defaults deliberately include an airport investment program and an airport-averse transport/flank program. They are different programs, not a claim of equal strength or a guaranteed rock-paper-scissors cycle. Complete-game results and their limitations belong in the final validation report.

## Public reply model and remaining limits

The fixed search compares at most two actions per mission. When transport would otherwise occupy both slots, it preserves one legal adjacent ground repair for comparison. Opponent continuations include visible tunnel sabotage and actual supply loss. A successful simulated flight retains its construction progress; replenishing energy/supplies and serving cooldown are paid costs of using the facility, rather than evidence that construction was undone. Actual game completion still requires the real target effect or a supplied projected turret.

These changes address concrete development regressions without changing points or winners. The search is not exhaustive: three own actions, approximate public opponent replies and a narrow beam can still miss durable alternatives. A complete normal-six development game still contained an eightfold repeated tunnel path before the game ended by connection. This is retained as a limitation, not concealed by a forced outcome or a fake action. Formal matchup results are reported separately.
