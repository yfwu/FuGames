# Hex / AutoHex shared rules migration

Status: implemented migration; final held-out and browser release gates are in progress, not a published feature announcement. The released baseline is `96c109a59c0bf79a159561ed845715a8e0ab8fee`. Do not publish either entry point until both pass the shared contract and browser checks.

## Why a migration is necessary

The released games are separate implementations. `card_hex.html` embeds a radius-5, three-player engine; AutoHex uses a radius-18 engine with six anchored factions. They disagree on placement, bridge reach, turret damage, shields, hill duration, cards, supply and winning. Sharing names or copying a geometry helper would not meet the requested consistent gameplay.

The pending planner V2 fixes its predecessor's failure to pursue connections, but three complete development games still produced fewer connections than the released policy (8/19/12 versus 18/22/19). It is compatible work to retain, not evidence of universal superiority. Its unfinished old held-out study is retired when rules change.

## One implementation, explicit modes

`hex-core.js` owns board geometry, state, observations, legality, costs, terrain, structures, supply, facilities, cards, owner-turn clocks, settlement and public simulation. A factory creates a rules instance; thin normal-Hex and AutoHex wrappers select the mode. The shared planner, validated strategy configuration, worker protocol and canvas presentation consume that instance. Neither page implements alternate action legality.

| Setting | Normal Hex | AutoHex |
| --- | --- | --- |
| Board | Radius 9, 271 cells | Radius 18, 1,027 cells |
| Seats | 2–6; each local human or AI | Six; human + five AI or six AI |
| Default | Three seats, one human + two AI | Existing human / spectator choice |
| Diplomacy | Disabled in engine and UI | Public, bounded pacts and betrayal |
| End | First settled connection; simultaneous connections share victory; finite turn cap fallback | Ten active minutes, connection/holding/combat score; optional explicitly unlimited continuation |
| Everything spatial / tactical | Same rules and costs | Same rules and costs |

This is same-device play, not network multiplayer. Multiple humans pass the device through a handoff screen; hands are hidden until the next human explicitly reveals theirs. All-AI play runs without handoff prompts.

Radius 9 gives six factions and airport construction room without stretching small-board facilities beyond its boundary. Each home has the same distance to its opposite goal edge. Active seats use balanced subsets of the six directions; the seed rotates the subset. Two, three and six seats have rotationally equal spacing; four has paired symmetry; five necessarily has unequal angular gaps on a six-direction board. Terrain retains sixfold symmetry, inactive seats have no pieces or turns, and seat/first-player rotation tests measure the remaining competitive asymmetry. We will not claim that equal route lengths prove balanced win rates.

## Common action contract

- One legal action per own turn. Invalid selections spend no energy/card and advance no clock.
- Ordinary placement and targeting use the **pre-action own-piece radius of 5**. Allies never extend that range. This is independent of bridge length.
- Keep AutoHex's energy, capture support, permanent home, supply and bounded turret foundation. Every mode uses the same upfront shield and enemy-targeted turret behavior. These intentionally replace the old normal game's reactive shield and friendly-fire area turret.
- Retain ordinary no-terrain setup, deterministic terrain, rare shields, bounded randomized recipes and optional three-own-turn hand expiry in the shared card system. Cards can be retained by default; expiry/discard never forces a harmful or illegal action.
- Hands hold at most five cards. After a legal own action, used cards are already removed, remaining timed cards age and expired cards return to the shared discard pile, then at most one card is drawn. A full hand skips the draw without replacing/discarding a retained card. The last displayed own-action opportunity can still use the card; pause, background time and invalid selections do not age it.
- The old normal game's secret trap, double placement and temporary blocking card implementation is not silently presented as the shared engine. The migration matrix and validation must explicitly identify preserved versus replaced rules before release. Historical source remains available in git/test fixtures for evidence.

## Bridges: straight and short

Maximum span is **3 hex steps**, minimum 2. Endpoints must be existing own pieces on one axial straight line. `(0,0) → (3,0)` is legal distance 3; `(0,0) → (4,0)` is illegal even though both targets may be within action radius 5; `(0,0) → (1,1)` is bent and belongs to the tunnel rules instead.

Check every existing surface bridge regardless of owner. Reject duplicate, reversed, collinear partial overlap, proper crossing and endpoint-to-interior T intersections. Sharing an actual endpoint is legal. Rerouting removes only the selected old bridge from collision checks. Losing an endpoint removes its bridge. A bridge connects its endpoints for supply and goals; it neither occupies nor converts the intervening terrain.

## Tunnels: a short public alternate route

A tunnel is an explicit ordered path of 3 or 4 distinct cells: **2 or 3 adjacent hex steps**, with bends allowed in any of the six directions. Endpoints must be own pieces, at least distance 2 apart. All selected cells must be in the pre-action own range. Example `(0,0) → (1,0) → (1,1)` has two steps; `(0,0) → (1,0) → (1,1) → (2,1)` has three. Count path edges, not endpoint distance. Four-step paths, loops, repeated cells and jumps are illegal.

Construction costs 4 energy, no card, one action; at most two owned tunnels. Interiors may pass beneath terrain or ordinary pieces, but cannot contain a home, airport, depot, turret or another tunnel interior/entrance. Tunnel paths are public and marked with owner and entrances. They do not claim interior cells or remove their terrain. Surface bridges and underground tunnels may cross because they occupy distinct layers; tunnels cannot overlap one another except at shared owned endpoints.

Only the owner receives an endpoint-to-endpoint supply/goal edge. An endpoint's destruction, capture or withdrawal immediately collapses the tunnel. An opponent may spend one engineering action and 2 energy to collapse a visible interior cell within its own radius 5; pacts protect allied tunnels. This creates counterplay without hidden tunneling, arbitrary length or a second combat system.

## Terrain and visual truth

Unmodified river blocks occupation; engineering supplies a guaranteed, card-independent conversion. Hills add one defense but occupants retreat after three subsequent completed own turns. Engineering an empty or own hill levels it and cancels its hill countdown; enemy-occupied hills cannot be converted as a covert removal action.

Actual conversion writes ordinary terrain into state. The shared renderer draws ordinary terrain **white**, without the former river/hill tint or pattern, while preserving pieces, ownership shapes, facilities and readable boundaries. Merely building an overhead bridge or underground tunnel does not convert terrain. Restart/replay reconstruct terrain from seed and actions, not prior canvas state.

## Airports and counterplay

Acquisition remains a multi-action investment: own the center, connect home supply, maintain a connected cluster of 12 within radius 4 for three own actions. Locations are seeded and within bounds in both board sizes. No points are awarded simply for owning an airport.

Airborne turret projection and bombardment retain explicit energy, supplies, range, cooldown and turret limits. Disconnect supply, shrink the qualifying cluster, take/destroy the center, absorb a shot with a shield, or attack an exposed projected turret to counter it. Losing any activation condition immediately disables the airport. Unsupported drops retreat. Airport policies must budget approach/build/hold/projection; an airport-averse policy must still defend against public air threats.

## External AI strategy contract

Versioned JSON is the supported editing format; no executable expressions, plugins or YAML parser are needed. A checked-in schema, default profiles and examples describe bounded mission programs. Runtime validation rejects unknown fields, unsupported versions, oversized inputs, nonfinite numbers, invalid enums and out-of-range budgets with an actionable error; it does not silently accept a partly different strategy.

Profiles affect eligible missions, stage transitions, construction budget, route choice, bridge/tunnel use, commitment/review and abort conditions, not just labels or flat score multipliers. Initial policies: direct connection; bounded airport acquisition then front-line turret projection; airport-averse bridge/tunnel flanking; public supply interdiction; resilient recovery; diplomacy-aware expansion (normal mode ignores diplomacy by capability, never by pretending a pact exists).

Every policy shares legal action generation, urgent threat response, bounded public simulation and own-goal progress. Opponent hands, deck order, RNG state and private planner memory never enter an observation. Same seed, mode, seat assignment and normalized strategy JSON reproduce the decision sequence. Configuration identity is included in replay/study evidence.

## Complexity and validation milestones

Keep the planner's hard budget: at most six mission candidates, 20 logical search transitions, three own-action depth, beam width two and two actions per plan. Public route memory is at most 16 cells; private route at most 64; campaign/mission histories are bounded. Tunnel enumeration is capped to depth three and shortlisted route endpoints. Search runs in a cancellable worker; no policy may increase global limits.

1. Freeze this contract and capture the released normal source as historical evidence. Refactor core, geometry and simulation; validate no unintended AutoHex differences before intentional common-rule changes.
2. Apply shared bridge/tunnel/terrain/cards and variable seats. Add semantic migration and parity tests, all-owner collision tests, all-seat owner clocks, simultaneous settlement, deterministic replay and hidden-state tests.
3. Wire both pages to shared controls, renderer, worker and validated strategy JSON. Verify local-human handoff, all-AI flow, white converted terrain, both sizes, mobile/DPR, restart/speed/pause/single-step and no duplicate timers.
4. Run complete games across seeds and 2–6 seats, rotated profiles/starters, actual mission success/abort measurements, final desktop/mobile play and a real ten-minute AutoHex run. Register fresh held-out configurations after final rules/config freeze. Report limits rather than manufacture cyclic wins or promise millions of games per minute.
5. Run the complete relevant regression suite, review changed semantics separately from historical tests, commit/push both modes together, and confirm exact-SHA CI and Pages terminal status. Report any public-site proxy failure verbatim.
