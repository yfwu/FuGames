# AutoHex planner revision: architecture diagnosis

Released baseline: `96c109a59c0bf79a159561ed845715a8e0ab8fee`.

The previous `chooseAction(observation)` is a stateless one-action scorer. It builds one reverse Dijkstra corridor to the opposite edge, assigns immediate values to legal actions, and returns the maximum. It does not simulate the selected action, an opponent response, or the following own turn. The engine stores action history, but no durable strategic intention is carried between decisions.

This creates three structural limits:

1. A maneuver that initially moves sideways competes against a large immediate route-progress reward. One corridor and a tiny flank tie preference cannot compare the eventual cost of breaking through a defended choke with going around it.
2. Airport investment has a delayed payoff: acquisition, a twelve-stone connected cluster, three owner actions of qualification, resources, then a useful air operation. The previous scorer only supports finishing an already large route-adjacent cluster; it cannot price that whole sequence against ordinary development. Raising or lowering the airport bonus alternates between obsession and avoidance.
3. Diplomacy is evaluated with local thresholds. It cannot explicitly compare the score/energy cost and delay of betrayal with the next capture or connection enabled by ending a pact.

The tie noise is at most `0.099`, while route progress contributes up to `69` before corridor and completion bonuses. In one controlled opening board (`planner-diagnosis`, neutral events off), changing only the observation's public seed across `tie-0` through `tie-99` produced the same deploy action at cell 977 in all 100 cases. This is a single-state mechanism probe, not a population diversity estimate; it deliberately holds terrain, airport layout and cards fixed.

The last release's complete paired study recorded aviation in 34/72 candidate campaigns. Thus “never uses airports” is not literally true of that sample, but the much lower usage and local investment prerequisite support the reported lack of visible airport strategy. More importantly, aggregate connection frequency did not measure coherent multi-turn choices or whether those choices were legible to a spectator.

This revision therefore evaluates persistent strategic alternatives, bounded forward consequences, public opponent threats, and realized sequence outcomes. It does not try to solve the feedback through one more global airport/center weight. Existing combat, scoring, card supply, diplomacy costs, geometry and timing rules remain the reference contract unless a documented implementation correction is necessary.
