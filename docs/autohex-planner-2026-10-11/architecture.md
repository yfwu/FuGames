# AutoHex bounded public-information planner

This change replaces the released one-action policy with a persistent, three-own-turn search. It changes decisions and their explanation, not game rules, points, deck distribution, airport placement, action costs, or faction strength. Results in the accompanying validation evidence are sample results, not a claim that every seed is balanced or that the AI always chooses the best move.

## Module and observation boundary

`autohex-planner.js` exports `create(engine)` through CommonJS and `AutoHexPlanner` in a browser. Load it before `autohex-engine.js`. The engine exports the compatible `chooseAction(observation)` entry point and `plannerAvailable`; ordinary callers still pass the returned action to `Game.act`. The released one-action chooser remains available as `greedyAction` for baseline comparisons and as an additional tactical candidate.

The planner receives the acting faction's public observation, its own current hand, and its own bounded `plannerMemory`. It never reads another hand, the draw/discard order, either private RNG, future neutral targets, or another faction's private planner state. The pure adapter `createPublicSimulation(observation, actor)` explicitly copies board, terrain, roads, anchors, shields, ages, supply counters, public players, bridges, turrets, facilities, offers, alliances, and the announced neutral warning. It does not construct a seeded Game or draw cards. All unknown hands are empty; only the actor's known current cards are consumable. Future draws and unannounced neutral events are not invented.

## Search and approximations

At each decision, weighted graph searches build a direct opposite-edge corridor and two flank corridors with distinct intermediate waypoints. Costs include occupied obstacles, combat support, rivers, and extra path length. Other candidates cover an actionable airport mission, enemy supply interdiction, an imminent or already scoring enemy connection, and reconnection of stranded own stones. There is no central-area prohibition or mandatory facility waypoint.

The fixed exported limits are 6 strategic plans, 2 legal action alternatives per plan, a beam of 2, depth 3 own actions, and at most 20 logical search nodes. Root expansion is at most 12 nodes; each of the two later own turns adds at most 4. Repeated state/action transitions and analyses are shared within the current decision. Diagnostics distinguish logical `nodes` from unique `simulations`; `opponentReplies` counts five modeled reply slots per unique simulation. There is no elapsed-time early exit or global random state, so machine speed does not change decisions.

Each node executes an own action and all five intervening opponent actions through the same `Game.act` rules used by the live game. Known turret fire, energy, card consumption, diplomacy, supply attrition, airport qualification, supply regeneration, cooldowns, age, shield decay, round scoring, and an already-announced neutral strike resolve normally. Differential tests compare those consequences with a live Game. Simulation-only supply caches and owned-cell lists avoid repeatedly scanning all 1,027 cells; they do not replace the action rules.

Opponent replies are a deliberately bounded adversarial approximation: ordinary legal construction/capture, engineering, public airport bombardment, and contextually useful acceptance of a public offer. They favor their own connection progress and attacks on the actor. At most two legal internal-junction attacks per reply receive an explicit removal-and-supply probe. They do not receive unknown cards, recurse into the full planner, or anticipate unseen draws. The model is one deterministic plausible response per opponent, not a minimax guarantee over every legal reply.

Leaf evaluation uses actual supplied frontier progress, connected footprint, stranded stones, held connections, modeled score changes, opponent connections and points, remaining energy/resources, and progress along the selected corridor. A plan must survive the modeled reply to count as a supplied connection. The short horizon can still miss a later counterattack or alternative opponent policy.

## Airports, diplomacy, and commitment

Airport acquisition first identifies an actual public follow-on: a bombardment that cuts a supplied enemy route/goal, or a supported turret drop that projects a route or defends a threatened held route. Its investment estimate includes the approach outside the local cluster, missing stones from the required 12, the remaining three-action qualification, missing energy/supplies, and cooldown. Each estimated action-equivalent of investment is charged against mission benefit; distant high-cost construction can lose to an immediate route or defensive move. Completing the mission removes its outstanding investment cost rather than incorrectly charging post-flight cooldown as unfinished work. An airport itself gives no gameplay point or strength subsidy.

Offers and acceptance enter the search when public contact, a shared enemy, and path compatibility make them relevant. An obstructing partner, an enemy currently scoring or about to connect, or the target of the planned air mission is not treated as a free peace bonus. Simulated pacts really prevent allied attacks; an offer/acceptance still costs a move and its normal energy. Betrayal is considered when a pact obstructs a selected corridor and pays the live energy, score, reputation, grudge, and diplomatic cooldown costs. Opponent points remain a competitive cost even during a pact.

A seeded opening chooses a direct or left/right flank preference, with coherent profile flank preferences and deterministic action ties. This changes routes across seeds without supplying extra resources or predetermining winners. A commitment retains its corridor while observed progress continues. Reassessment occurs after three own decisions without metric improvement, a periodic six-own-turn review, a lost mission opportunity, completion, or a better urgent threat. Incoming opponent damage and the resulting real supply state are reconsidered each decision. A commitment is a preference, not an order that can suppress an emergency.

## Stored state and public explanation

`Game.plannerStates[1..6]` stores only the corresponding actor's sanitized memory. `observation(p).plannerMemory` is a deep copy of p's memory; spectator observations contain `null`. `Game.intents` / `observation.intents` contain sanitized public commitments. Reset clears both collections. An illegal action cannot commit either collection. Manual actions without planner metadata clear that actor's old plan.

Private paths are bounded at 64 cells, public paths at 16, and waypoints at 4. Strategies, stages, reasons, finite numbers, cell IDs, and array lengths are whitelisted. Submitted metadata cannot alter rules, score, another player's plan, or private game state.

A public intent contains `player`, `type`, `stage`, `target`, `path`, `reasonCode`, `committedAtPly`, `reviewAtPly`, `progress`, `completed`, and `stalled`. Types are direct, flank, airport, interdict, defend, and recover. The public path begins at the current supplied frontier, while the private path may include its older approach. It is a public strategic corridor, not a disclosure of hidden cards or a promised sequence of exact future actions.

After an accepted live action and automatic next-turn turret upkeep, the engine recomputes public progress, completion, and the visible segment from the resulting board. The private comparison metric remains the previous decision's metric, so the next decision can distinguish real progress from a stall. `stalled` counts consecutive own decisions without an improvement in that plan's metric; it does not mean no legal move exists. Holding/defending an already-held route is ongoing maintenance and is not counted as a new completed mission on every turn.

## Evidence and limits

The test owner records actual executed route, supply, airport, diplomatic, and goal outcomes rather than treating intent labels as success. Mechanism fixtures include a supplied flank, irrelevant-facility rejection, four airport construction actions followed by qualification and real bombardment, recovery after a legal opposing cut, imminent-goal interruption, and a paid betrayal followed by a legal goal capture. Public-model differential tests cover paid cards, shields/turrets, warning resolution, supply loss, bridges, reroutes, exchanges, engineering, and private-field getters. Separate held-out paired and mixed-policy studies assess the final frozen files.

Development timing is measured separately from browser request latency. The first unoptimized search took roughly 50–80 ms for many early decisions. Rank-before-legality, fixed breadth two, transition sharing, supply caching, and simulation-only owned-cell traversal materially reduce that work. Final timing, source hashes, complete campaign outcomes, and browser pacing belong to the accompanying final validation report; intermediate timings are not final acceptance claims.

### Frozen development checkpoint

The 600-action partial development run used seed `planner-engine-development-5171`, default neutral events, and the frozen engine `0c5b3137c803f3f77ddd3fbb34a132f1986a257d3db2d828a1d2628e37c69993` plus planner `2e222d259995f604b07c8b599f681a8ccc025a5e1a709bb649c5c539637ebb7f`. This was performed on shared CPU while other validation work was active. It is neither a held-out result nor a complete ten-minute campaign.

All 600 returned actions were legal. Planner computation mean was 47.39 ms, median 44.13 ms, p95 78.08 ms, and maximum 229.83 ms. The highest observed logical-node and unique-simulation counts were both 20. The partial board history recorded 87 captures, 68 destructions, 6 airport activations, 4 bombardments, 0 airdrops, 12 accepted alliances, 0 betrayals, and 0 goal arrivals. The zero partial-run goal count is retained rather than implying the tactical puzzles establish full-campaign goal performance. The final independent full-campaign study is needed for that conclusion.

The mechanism outcomes and timing can be rechecked without changing game rules:

```sh
node --test tests/autohex-planner.test.cjs tests/autohex-goal-strategy.test.cjs tests/autohex-strategy.test.cjs tests/autohex-public-simulation.test.cjs
node - <<'JS'
const H = require('./autohex-engine.js');
const game = new H.Game({seed: 'planner-engine-development-5171'});
game.start();
const durations = [];
for (let n = 0; n < 600; n++) {
  const start = performance.now();
  const action = H.chooseAction(game.observation());
  durations.push(performance.now() - start);
  if (!game.act(action)) throw Error(`Illegal action at ${n}`);
}
durations.sort((a,b) => a-b);
console.log({mean: durations.reduce((a,b)=>a+b)/durations.length,
  p95: durations[Math.floor(durations.length*.95)-1],
  max: durations.at(-1), telemetry: game.telemetry});
JS
```
