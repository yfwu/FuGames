'use strict';
// Standalone evidence runner; intentionally excluded from the Node test glob.
// Every game completes 600000 model-ms. This is not foreground browser time.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const crypto = require('node:crypto'), Module = require('node:module');
const ROOT = path.resolve(__dirname, '..'), BASELINE = '96c109a59c0bf79a159561ed845715a8e0ab8fee';
const argv = process.argv.slice(2), flags = {};
for (let i = 0; i < argv.length; i += 2) { assert.ok(argv[i].startsWith('--')); flags[argv[i].slice(2)] = argv[i + 1]; }
const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const range = xs => xs.length ? [Math.min(...xs), Math.max(...xs)] : null;
const sha = source => crypto.createHash('sha256').update(source).digest('hex');
const outPath = path.resolve(flags.output || path.join(ROOT, 'docs/autohex-planner-2026-10-11', `${flags.mode || 'baseline'}-${flags.sample || 'development'}.json`));
function save(value) { fs.mkdirSync(path.dirname(outPath), { recursive: true }); fs.writeFileSync(outPath, JSON.stringify(value, null, 2) + '\n'); }
function compileCaptured(source, filename, dependencies = {}) {
  const compiled = new Module(filename, module); compiled.filename = filename; compiled.paths = module.paths;
  compiled.require = request => {
    if (Object.hasOwn(dependencies, request)) return dependencies[request];
    if (request.startsWith('.') || request.startsWith('/')) throw new Error(`Uncaptured local dependency: ${request}`);
    return Module.prototype.require.call(compiled, request);
  };
  compiled._compile(source, filename); return compiled.exports;
}

function aggregate(games, areas) {
  const players = games.flatMap(g => g.players), connected = players.filter(p => p.firstGoalMs !== null);
  const by = key => {
    const groups = {};
    for (const p of players) {
      const name = String(p[key]);
      const row = groups[name] ||= { campaigns: 0, reached: 0, arrivals: 0, holdingRounds: 0, sharedWinCredit: 0, scoreSum: 0, peakProgressSum: 0 };
      row.campaigns++; row.reached += Number(p.firstGoalMs !== null); row.arrivals += p.arrivals;
      row.holdingRounds += p.holdingRounds; row.sharedWinCredit += p.winCredit; row.scoreSum += p.score; row.peakProgressSum += p.peakProgress;
    }
    for (const row of Object.values(groups)) { row.connectionRate = row.reached / row.campaigns; row.meanScore = row.scoreSum / row.campaigns; row.meanPeakProgress = row.peakProgressSum / row.campaigns; }
    return groups;
  };
  const spatial = {};
  for (const name of Object.keys(areas)) {
    const combat = games.reduce((s, g) => s + g.spatial.combat[name], 0);
    const actions = games.reduce((s, g) => s + g.spatial.actions[name], 0);
    const occupation = games.reduce((s, g) => s + g.spatial.occupation[name], 0);
    const samples = games.reduce((s, g) => s + g.spatial.samples, 0);
    spatial[name] = { cells: areas[name], combatCellIncidences: combat, actionTargets: actions,
      combatPerCellPerCampaign: combat / areas[name] / games.length,
      actionTargetsPerCellPerCampaign: actions / areas[name] / games.length,
      meanOccupancyFraction: occupation / areas[name] / samples };
  }
  const add = field => Object.fromEntries(Object.keys(games[0]?.[field] || {}).map(key => [key, games.reduce((s, g) => s + g[field][key], 0)]));
  const startingSeatCounts = {}, startingProfileCounts = {};
  for (const g of games) {
    startingSeatCounts[g.first] = (startingSeatCounts[g.first] || 0) + 1;
    const profile = g.players.find(p => p.seat === g.first).profile;
    startingProfileCounts[profile] = (startingProfileCounts[profile] || 0) + 1;
  }
  const decisions = games.flatMap(g => g.decisionMs || []).sort((a,b)=>a-b);
  const quantile = fraction => decisions.length ? decisions[Math.min(decisions.length-1,Math.floor(decisions.length*fraction))] : null;
  const episodes = games.flatMap(g => g.planner?.episodes || []), typeEpisodes = {};
  for (const e of episodes) {
    const row = typeEpisodes[e.type] ||= {episodes:0,atLeastThreeActions:0,frontierImproved:0,targetBecameSupplied:0,airActions:0,goalConnections:0};
    row.episodes++; row.atLeastThreeActions += Number(e.actions >= 3); row.frontierImproved += Number(e.bestGap < e.initialGap);
    row.targetBecameSupplied += Number(!e.targetInitiallySupplied && e.targetBecameSupplied); row.airActions += e.airActions; row.goalConnections += e.goalConnections;
  }
  const activations = games.flatMap(g => g.planner?.airportFollowups || []), followed = activations.filter(a => a.firstAirPly !== null);
  const planner = {decisions:games.reduce((s,g)=>s+(g.planner?.decisions||0),0),reused:games.reduce((s,g)=>s+(g.planner?.reused||0),0),
    maxNodes:Math.max(0,...games.map(g=>g.planner?.nodesMax||0)),maxDepth:Math.max(0,...games.map(g=>g.planner?.depthMax||0)),
    maxMemoryBytes:Math.max(0,...games.map(g=>g.planner?.memoryBytesMax||0)),typeEpisodes,
    airportActivations:activations.length,activationsFollowedByAir:followed.length,meanOwnActionsToFirstAir:mean(followed.map(a=>(a.firstAirPly-a.unlockedPly)/6)),
    campaignStalledMax:Math.max(0,...games.map(g=>g.planner?.campaignStalledMax||0)),
    campaignReplans:games.reduce((s,g)=>s+(g.planner?.campaignReplans||0),0),
    routeBeamObserved:games.reduce((s,g)=>s+(g.planner?.routeBeamObserved||0),0),routeBeamIncomplete:games.reduce((s,g)=>s+(g.planner?.routeBeamIncomplete||0),0),
    quarterTypes:Array.from({length:4},(_,q)=>{const counts={};for(const g of games)for(const [type,n] of Object.entries(g.planner?.quarterTypes?.[q]||{}))counts[type]=(counts[type]||0)+n;return counts;})};
  return { games: games.length, players: players.length, startingSeatCounts, startingProfileCounts,
    campaignsWithGoal: games.filter(g => g.telemetry.goalArrivals > 0).length,
    campaignConnectionRate: mean(games.map(g => Number(g.telemetry.goalArrivals > 0))),
    playerConnectionRate: connected.length / players.length,
    arrivals: players.reduce((s, p) => s + p.arrivals, 0), holdingRounds: players.reduce((s, p) => s + p.holdingRounds, 0),
    firstGoalMsMeanAmongConnected: mean(connected.map(p => p.firstGoalMs)), firstGoalMsRange: range(connected.map(p => p.firstGoalMs)),
    meanFinalProgress: mean(players.map(p => p.finalProgress)), meanPeakProgress: mean(players.map(p => p.peakProgress)),
    meanFinalRouteDeficit: mean(players.map(p => p.finalRouteDeficit)), meanMinimumRouteDeficit: mean(players.map(p => p.minimumRouteDeficit)),
    goalsBeforeAnyAirportUnlock: players.filter(p => p.firstGoalMs !== null && (p.firstAirportMs === null || p.firstGoalMs < p.firstAirportMs)).length,
    scoreRange: range(players.map(p => p.score)), draws: games.filter(g => g.winners.length > 1).length,
    airport: add('airport'), airUtility: add('airUtility'), spatial, bySeat: by('seat'), byProfile: by('profile'), byPolicy: by('policy'),
    lastQuarter: Object.fromEntries(Object.keys(games[0]?.quarters[3] || {}).map(key => [key, games.reduce((s, g) => s + g.quarters[3][key], 0)])),
    lateCombatRange: range(games.map(g => g.quarters[3].combat)), lateBoardChangesRange: range(games.map(g => g.quarters[3].boardChanges)),
    planner, decisionTimingMs:{mean:mean(decisions),p50:quantile(.5),p95:quantile(.95),p99:quantile(.99),max:decisions.at(-1)||null},
    aiMeanMs: mean(games.map(g => g.aiMs / g.actions)), totalActions: games.reduce((s, g) => s + g.actions, 0) };
}

if (flags.merge) {
  const paths = flags.merge.split(',').map(p => path.resolve(p)), blocks = paths.map(p => JSON.parse(fs.readFileSync(p, 'utf8')));
  assert.ok(blocks.length >= 2 && blocks.every(b => b.complete));
  for (const block of blocks) { assert.equal(block.mode, blocks[0].mode); assert.equal(block.control, blocks[0].control);assert.equal(block.actionLimit,blocks[0].actionLimit);assert.equal(block.fullCampaigns,blocks[0].fullCampaigns); assert.equal(block.source.sha256, blocks[0].source.sha256); assert.deepEqual(block.source.dependencies, blocks[0].source.dependencies); assert.deepEqual(block.regionAreas, blocks[0].regionAreas); }
  const games = blocks.flatMap(b => b.games); assert.equal(new Set(games.map(g => g.key)).size, games.length);
  if(blocks[0].preregistration){
    for(const block of blocks)assert.deepEqual(block.preregistration,blocks[0].preregistration);
    const key=c=>`${c.seed}/${c.rotation}/${c.first}${c.mixedOffset===undefined?'':'/mixed'+c.mixedOffset}`;
    const expected=blocks[0].preregistration.schedule.map(key);
    assert.deepEqual(games.map(g=>g.key).sort(),expected.slice().sort(),'All preregistered configurations must be present exactly once');
    games.sort((a,b)=>expected.indexOf(a.key)-expected.indexOf(b.key));
  }
  const auditGroups = blocks[0].preregistration ? (blocks[0].mode==='mixed'?[]:[games]) : [games, ...[...new Set(games.map(g => g.seed))].map(seed => games.filter(g => g.seed === seed))];
  for (const [groupIndex,group] of auditGroups.entries()) {
    const seats = frequencyCounts(group.map(g => String(g.first)));
    const profiles = frequencyCounts(group.map(g => g.players.find(p => p.seat === g.first).profile));
    assert.equal(Object.keys(seats).length, 6); assert.equal(Object.keys(profiles).length,groupIndex>0&&blocks[0].scheduleDesign==='seed-alternating-start-offset-36'?3:6);
    assert.equal(new Set(Object.values(seats)).size, 1, 'Starting seats must balance within each seed and overall');
    assert.equal(new Set(Object.values(profiles)).size, 1, 'Starting profiles must balance within each seed and overall');
  }
  const merged = { ...blocks[0], sample: 'heldout-combined-preregistered', firstOffset: null,
    schedule: blocks[0].preregistration?.schedule || blocks.flatMap(b => b.schedule), games,
    blocks: blocks.map((b, i) => ({ path: path.relative(path.dirname(outPath), paths[i]), firstOffset: b.firstOffset ?? 0, games: b.games.length, wallSeconds: b.wallSeconds, sha256: b.source.sha256 })),
    wallSeconds: undefined, sumBlockWallSeconds: blocks.reduce((s, b) => s + b.wallSeconds, 0),
    summary: aggregate(games, blocks[0].regionAreas) };
  save(merged); console.log(JSON.stringify({ output: outPath, complete: true, games: games.length, summary: merged.summary })); process.exit(0);
}

function frequencyCounts(values) {
  const counts = {}; for (const value of values) counts[value] = (counts[value] || 0) + 1; return counts;
}

if (flags.compare) {
  const a = JSON.parse(fs.readFileSync(path.resolve(flags.compare), 'utf8'));
  const b = JSON.parse(fs.readFileSync(path.resolve(flags.candidate), 'utf8'));
  assert.ok(a.complete && b.complete);assert.equal(a.actionLimit,b.actionLimit); assert.deepEqual(a.schedule, b.schedule); assert.deepEqual(a.regionAreas, b.regionAreas);
  const pairs = a.games.map((old, i) => {
    const next = b.games[i]; assert.equal(old.key, next.key);
    const playerDelta = old.players.map((p, j) => ({ seat: p.seat, profile: p.profile,
      firstGoalMsBefore: p.firstGoalMs, firstGoalMsAfter: next.players[j].firstGoalMs,
      arrivals: next.players[j].arrivals - p.arrivals, holdingRounds: next.players[j].holdingRounds - p.holdingRounds,
      peakProgress: next.players[j].peakProgress - p.peakProgress,
      finalRouteDeficit: next.players[j].finalRouteDeficit - p.finalRouteDeficit }));
    return { key: old.key, goalArrivals: next.telemetry.goalArrivals - old.telemetry.goalArrivals,
      holdingRounds: next.telemetry.goalHoldingRounds - old.telemetry.goalHoldingRounds,
      connectedPlayers: next.players.filter(p => p.firstGoalMs !== null).length - old.players.filter(p => p.firstGoalMs !== null).length,
      lateCombat: next.quarters[3].combat - old.quarters[3].combat,
      airportLocalNonAdvancingActions: next.airport.localNonAdvancing - old.airport.localNonAdvancing,
      playerDelta };
  });
  const report = { mode: 'paired independent persistent-planner comparison', complete: true,
    baselineSource: a.source, candidateSource: b.source, schedule: a.schedule, definitions: a.definitions,
    blocks: { baseline: a.blocks || [], candidate: b.blocks || [] },
    before: aggregate(a.games, a.regionAreas), after: aggregate(b.games, b.regionAreas), pairs,
    campaignGoalArrivalDelta: { mean: mean(pairs.map(p => p.goalArrivals)), range: range(pairs.map(p => p.goalArrivals)),
      improved: pairs.filter(p => p.goalArrivals > 0).length, equal: pairs.filter(p => !p.goalArrivals).length, worse: pairs.filter(p => p.goalArrivals < 0).length } };
  save(report); console.log(JSON.stringify({ output: outPath, before: a.summary, after: b.summary })); process.exit(0);
}

const mode = flags.mode || 'baseline', sample = flags.sample || 'development';
assert.ok(['baseline', 'candidate', 'mixed'].includes(mode));
const engineRoot = flags['engine-root'] ? path.resolve(flags['engine-root']) : ROOT;
const modulePath = path.join(engineRoot, 'autohex-engine.js');
const baselineFixture=JSON.parse(fs.readFileSync(path.join(ROOT,'docs/autohex-planner-2026-10-11/baseline-source.json'),'utf8'));
assert.equal(baselineFixture.commit,BASELINE);assert.equal(sha(baselineFixture.capturedSource),'a029f76bb5424506a21f8485519176f010c3803aed401a20733ad83aaf4c9f09');
const baselineSource=baselineFixture.capturedSource;
const source = mode === 'baseline' ? baselineSource : fs.readFileSync(modulePath, 'utf8');
const plannerPath = path.join(engineRoot, 'autohex-planner.js');
const plannerSource = mode === 'baseline' ? null : fs.readFileSync(plannerPath, 'utf8');
if(flags['expect-engine'])assert.equal(sha(source),flags['expect-engine'],'Engine differs from frozen study source');
if(flags['expect-planner'])assert.equal(sha(plannerSource),flags['expect-planner'],'Planner differs from frozen study source');
const dependencies = plannerSource === null ? {} : {'./autohex-planner.js': compileCaptured(plannerSource, plannerPath)};
const H = compileCaptured(source, modulePath, dependencies);
const baselinePolicy = mode === 'mixed' ? compileCaptured(baselineSource, modulePath) : null;
const control = flags.control || 'normal'; assert.ok(['normal','memory-reset'].includes(control));
const actionLimit=Number(flags.actions || 2000);assert.ok(Number.isInteger(actionLimit)&&actionLimit>0&&actionLimit<=2000);
if(flags.probe==='variation') {
  const start=performance.now(), fixed=new H.Game({seed:'planner-fixed-public-board',neutralEvents:false});fixed.start();
  const ordinary=a=>({type:a.type,cells:a.cells,target:a.target,cardIndex:a.cardIndex});
  const records=[],representatives=new Map(),base=fixed.observation();
  for(let n=0;n<24;n++) {
    const seed='planner-public-choice-'+n,view={...base,seed},a=H.chooseAction(view),repeat=H.chooseAction(view);
    assert.deepEqual(a,repeat);assert.ok(H.legalAction(view,a));
    const intent=a.planner?.publicIntent,signature=JSON.stringify(intent?[intent.type,intent.target,a.planner.memory.side]:ordinary(a));
    records.push({seed,action:ordinary(a),intent,signature});if(!representatives.has(signature))representatives.set(signature,seed);
  }
  const sequences=[];
  for(const [signature,seed] of [...representatives].slice(0,6)) {
    const g=new H.Game({seed:'planner-fixed-public-board',neutralEvents:false});g.start();g.seed=seed;
    const sequence={seed,signature,actions:[],reused:0};
    for(let n=0;n<6;n++) {
      while(g.turn!==1)assert.ok(g.act({type:'rest',cells:[]}));
      if(control==='memory-reset'&&g.plannerStates)g.plannerStates[1]=null;
      const a=H.chooseAction(g.observation());assert.ok(H.legalAction(g.observation(),a));assert.ok(g.act(a));
      sequence.actions.push({action:ordinary(a),intent:a.planner?.publicIntent});sequence.reused+=Number(!!a.planner?.diagnostics?.reusedIntent);
    }
    const supplied=H.computeSupply(g,1);sequence.suppliedOwnCells=Array.from(supplied).reduce((a,b)=>a+b,0);
    sequence.suppliedGap=Math.min(...H.CELLS.filter(c=>supplied[c.i]).map(c=>18+g.players[1].sign*c[g.players[1].axis]));
    sequences.push(sequence);
  }
  save({complete:true,mode,control,kind:'Mechanism counterfactual: one fixed initial board/terrain/hands/RNG; only the public strategy seed changes. Six-turn continuations use resting opponents. Not natural seeded games or heldout balance evidence.',
    source:{sha256:sha(source),capturedSource:source,dependencies:plannerSource===null?[]:[{sha256:sha(plannerSource),capturedSource:plannerSource}]},records,sequences,
    distinctFirstActions:new Set(records.map(r=>JSON.stringify(r.action))).size,distinctIntents:representatives.size,
    distinctExecutedSequences:new Set(sequences.map(s=>JSON.stringify(s.actions.map(a=>a.action)))).size,wallSeconds:(performance.now()-start)/1000});
  console.log(JSON.stringify({complete:true,mode,output:outPath,distinctFirstActions:new Set(records.map(r=>JSON.stringify(r.action))).size,distinctIntents:representatives.size,sequences:sequences.length}));process.exit(0);
}
const protocolPath=flags.protocol?path.resolve(flags.protocol):null;
const protocolSource=protocolPath?fs.readFileSync(protocolPath,'utf8'):null;
const protocol=protocolSource?JSON.parse(protocolSource):null;
if(protocol){assert.equal(protocol.baselineCommit,BASELINE);assert.equal(actionLimit,protocol.duration.actions);}
const registeredSeeds=protocol?protocol.seeds:(sample==='heldout'?'3203,3301,3407,3511,3607,3701':'4101,4201,4303,4409,4507,4603').split(',').map(Number);
const seeds = (flags.seeds || registeredSeeds.join(',')).split(',').map(Number);
const rotations = flags.rotations || (sample === 'heldout' && mode!=='mixed' ? '0,1,2,3,4,5' : 'balanced');
const firstOffset = Number(flags['first-offset'] || 0); assert.ok(Number.isInteger(firstOffset) && firstOffset >= 0 && firstOffset < 6);
const scheduleDesign=protocol?'explicit-preregistered-schedule':sample==='heldout'&&!Object.hasOwn(flags,'first-offset')?'seed-alternating-start-offset-36':'explicit-start-offset';
let schedule = seeds.flatMap((seed, i) => {
  const registeredIndex=registeredSeeds.indexOf(seed),seedIndex=registeredIndex<0?i:registeredIndex;
  const offset=scheduleDesign==='seed-alternating-start-offset-36'?seedIndex%2:firstOffset;
  return (rotations === 'balanced' ? [seedIndex % 6] : rotations.split(',').map(Number)).flatMap(rotation => (mode === 'mixed' ? [0,1] : [null]).map(mixedOffset => ({ seed, rotation, first: (rotation + offset) % 6 + 1, ...(mixedOffset === null ? {} : {mixedOffset}) })));
});
let preregistration=null;
if(protocol){
  assert.equal(flags.rotations,undefined);assert.equal(flags['first-offset'],undefined);
  const fullSchedule=protocol[mode==='mixed'?'mixedSchedule':'pairedSchedule'];
  assert.ok(Array.isArray(fullSchedule)&&fullSchedule.length>0);
  schedule=fullSchedule.filter(c=>seeds.includes(c.seed));
  if(flags.shard){const [part,total]=flags.shard.split('/').map(Number);assert.ok(Number.isInteger(part)&&Number.isInteger(total)&&part>=0&&part<total);schedule=schedule.filter((_,i)=>i%total===part);}
  preregistration={file:path.basename(protocolPath),sha256:sha(protocolSource),schedule:fullSchedule};
}
if(flags['schedule-only']){console.log(JSON.stringify({mode,scheduleDesign,preregistration,schedule},null,2));process.exit(0);}
const radius = i => Math.max(Math.abs(H.CELLS[i].q), Math.abs(H.CELLS[i].r), Math.abs(H.CELLS[i].s));
const region = i => radius(i) <= 6 ? 'center' : radius(i) >= 12 ? 'flank' : 'transition';
const regionAreas = { center: 0, transition: 0, flank: 0 }; for (const c of H.CELLS) regionAreas[region(c.i)]++;
const emptyRegions = () => ({ center: 0, transition: 0, flank: 0 });
const gap = (g, p, supplied) => {
  const { axis, sign } = g.players[p]; let distance = H.RADIUS * 2;
  for (const c of H.CELLS) if (supplied[c.i] && g.board[c.i] === p) distance = Math.min(distance, H.RADIUS + sign * c[axis]);
  return distance;
};
// Independent 0/1 graph metric: count non-owned cells on an adjacency path.
// It deliberately does not reuse AI path costs or assume legal immediate actions.
function deficit(g, p, supplied) {
  const dist = new Int16Array(H.COUNT).fill(32767); let current = [];
  for (let i = 0; i < H.COUNT; i++) if (supplied[i]) { dist[i] = 0; current.push(i); }
  for (let level = 0; current.length && level < H.COUNT; level++) {
    const next = [];
    for (let n = 0; n < current.length; n++) {
      const i = current[n]; if (dist[i] !== level) continue;
      if (H.goalCell(g, p, i)) return level;
      for (const j of H.ADJ[i]) {
        if (g.anchors[j] && g.anchors[j] !== p) continue;
        const extra = Number(g.board[j] !== p), d = level + extra;
        if (d < dist[j]) { dist[j] = d; (extra ? next : current).push(j); }
      }
    }
    current = next;
  }
  return null;
}
const output = { mode, sample, control, actionLimit, runnerSha256:sha(fs.readFileSync(__filename)), fullCampaigns:actionLimit===2000, modelMsPerGame:actionLimit*300, complete: false, source: { location: mode === 'baseline' ? `git:${BASELINE}:autohex-engine.js` : 'autohex-engine.js', sha256: sha(source), capturedSource: source,
    dependencies: plannerSource === null ? [] : [{location:'autohex-planner.js', sha256:sha(plannerSource), capturedSource:plannerSource}],
    ...(mode === 'mixed' ? {oldPolicy:{commit:BASELINE,sha256:sha(baselineSource)}} : {}) },
  baselineCommit: BASELINE, firstOffset:scheduleDesign==='seed-alternating-start-offset-36'||protocol?null:firstOffset, scheduleDesign, preregistration, schedule, regionAreas, timing: `Accelerated ${actionLimit} actions ×300 active model-ms =${actionLimit*300}ms per game. ${actionLimit===2000?'Complete campaign.':'Partial development smoke only.'} Wall cost is shared-workspace execution, not a browser performance benchmark.`,
  definitions: {
    progress: '36 minus minimum directed opposite-edge coordinate gap among home-supplied own stones; sampled each completed round. Higher is better.',
    routeDeficit: 'Minimum non-owned adjacency cells between any home-supplied own stone and opposite edge. Excludes enemy anchors; ignores terrain/action costs and alliances. Existing own bridge reach is included through the supplied starting set. Sampled every30actions.',
    airportLocal: 'Action target within4 of any public airport. Local non-advancing counts non-air own construction/engineering actions without immediate supplied-frontier or adjacency-deficit improvement; defensive value remains possible, so this alone does not prove waste.',
    spatial: 'center radius0–6; transition7–11; flank12–18. Combat counts capture/destroy event cell incidences, including automatic fire. Densities divide by actual region cell count; occupation also divides by samples.',
    holding: 'Credited complete-round holds, reconstructed at scoring boundaries; first connections and repeated arrivals are separately counted.',
    planner: 'Intent episodes group the same actor/type/target/commit ply. Strategy labels, reuse, and reported completions are diagnostic; frontier, supplied target, air execution, and goal arrival are observed separately. Whole-action resolution can include upkeep and following-player automatic fire.',
    airportFollowup: 'Activation episodes end on loss; first air use must originate at that exact airport before loss. Time-to-use is ply difference divided by6, expressed as approximate owner actions.',
    limitation: 'Planner candidate compared with release96c109a. Verify rules and seeded layouts remain equal in fixtures. The six seeds with rotated seats and balanced first-profile margins are repeated configurations, not independent seed samples. Planner strategy labels are diagnostics; execution and public board effects are measured separately.' }, games: [] };
const wallStart = performance.now();
for (const config of schedule) {
  const g = new H.Game({ ...config, neutralEvents: true }); g.start();
  const row = { ...config, key: `${config.seed}/${config.rotation}/${config.first}${mode === 'mixed' ? '/mixed'+config.mixedOffset : ''}`, actions: 0, aiMs: 0, traceSha256: null,
    airports: g.airports.map(a => ({ cell: a.cell, q: H.CELLS[a.cell].q, r: H.CELLS[a.cell].r, radius: radius(a.cell) })),
    players: H.PLAYERS.map(p => ({ seat: p, profile: g.players[p].profile.name, firstGoalMs: null, firstAirportMs: null, arrivals: 0, holdingRounds: 0, goalPoints: 0, peakProgress: 0, finalProgress: 0, minimumRouteDeficit: 999, finalRouteDeficit: null, progressSum: 0, progressSamples: 0, airportActionsBeforeFirstGoal: 0 })),
    quarters: Array.from({ length: 4 }, () => ({ actions: 0, meaningful: 0, combat: 0, boardChanges: 0, arrivals: 0, holdingRounds: 0, air: 0, deploy: 0, rest: 0 })),
    spatial: { actions: emptyRegions(), combat: emptyRegions(), occupation: emptyRegions(), samples: 0 },
    airport: { localActions: 0, localBeforeFirstGoal: 0, localNonAdvancing: 0, localProgressAdvancing: 0, unlocks: 0, losses: 0, activeSamples: 0 },
    airUtility: { actions: 0, airdrops: 0, bombardments: 0, suppliedAirdrops: 0, ownFrontierImproved: 0, ownRouteDeficitReduced: 0, enemyFrontierSetBack: 0, enemyConnectionBroken: 0, airdropLaterTurretHits: 0 },
    planner: {decisions:0,reused:0,nodesTotal:0,nodesMax:0,depthMax:0,memoryBytesMax:0,byType:{},quarterTypes:Array.from({length:4},()=>({})),campaignStalledMax:0,campaignReplans:0,routeBeamObserved:0,routeBeamIncomplete:0,episodes:[],airportFollowups:[]}, decisionMs:[], timeline: [] };
  const trace = crypto.createHash('sha256'), airTurrets = new Map(), currentEpisodes = new Map(), activeAirports = new Map();
  let lastEventId = g.events.at(-1)?.id || 0;
  function sampleState(route = false) {
    const point = { activeMs: g.activeMs, progress: [], deficit: route ? [] : undefined };
    for (const p of H.PLAYERS) {
      const supplied = H.computeSupply(g, p), value = 36 - gap(g, p, supplied), player = row.players[p - 1];
      player.peakProgress = Math.max(player.peakProgress, value); player.finalProgress = value; player.progressSum += value; player.progressSamples++;
      point.progress.push(value);
      if (route) { const d = deficit(g, p, supplied); assert.notEqual(d, null); player.minimumRouteDeficit = Math.min(player.minimumRouteDeficit, d); player.finalRouteDeficit = d; point.deficit.push(d); }
    }
    if (route) {
      row.spatial.samples++;
      for (const c of H.CELLS) if (g.board[c.i]) row.spatial.occupation[region(c.i)]++;
      row.airport.activeSamples += g.airports.filter(a => a.active).length;
      row.timeline.push(point);
    }
  }
  sampleState(true);
  for (let step = 0; step < actionLimit; step++) {
    if (control === 'memory-reset' && g.plannerStates) g.plannerStates[g.turn] = null;
    const obs = g.observation(), start = performance.now();
    const useNew = mode !== 'mixed' || (obs.turn + config.mixedOffset) % 2 === 1;
    const action = (useNew ? H : baselinePolicy).chooseAction(obs), decisionMs = performance.now() - start;
    row.aiMs += decisionMs; row.decisionMs.push(decisionMs);
    const intent = action?.planner?.publicIntent, diagnostics = action?.planner?.diagnostics;
    if (diagnostics) {
      row.planner.decisions++; row.planner.reused += Number(!!diagnostics.reusedIntent);
      assert.ok(Number.isInteger(diagnostics.nodes) && diagnostics.nodes >= 0 && diagnostics.nodes <= H.PLANNER_LIMITS.nodes);
      assert.ok(diagnostics.depth >= 0 && diagnostics.depth <= H.PLANNER_LIMITS.depth);
      row.planner.nodesTotal += diagnostics.nodes; row.planner.nodesMax = Math.max(row.planner.nodesMax,diagnostics.nodes);
      row.planner.depthMax = Math.max(row.planner.depthMax,diagnostics.depth);
      row.planner.byType[diagnostics.chosenStrategy] = (row.planner.byType[diagnostics.chosenStrategy] || 0)+1;
      const q=row.planner.quarterTypes[Math.floor(step/500)];q[diagnostics.chosenStrategy]=(q[diagnostics.chosenStrategy]||0)+1;
      const campaign=action.planner.memory.campaign;
      if(campaign){assert.ok(campaign.path.length<=H.PLANNER_LIMITS.privatePath);assert.ok(Number.isFinite(campaign.stalled));row.planner.campaignStalledMax=Math.max(row.planner.campaignStalledMax,campaign.stalled);row.planner.campaignReplans+=Number(!!diagnostics.campaignReplanned);}
      if(Array.isArray(diagnostics.routeBeamDepths)){row.planner.routeBeamObserved++;row.planner.routeBeamIncomplete+=Number(!Array.from({length:diagnostics.depth},(_,i)=>i+1).every(depth=>diagnostics.routeBeamDepths.includes(depth)));}
    }
    assert.ok(H.legalAction(obs, action), `Illegal AI ${row.key}/${step}: ${JSON.stringify(action)}`);
    const p = obs.turn, player = row.players[p - 1], target = action.cells?.at(-1), air = ['airdrop', 'bombard'].includes(action.type);
    let episode;
    if (intent) {
      const key = `${p}/${intent.committedAtPly}/${intent.type}/${intent.target}`;
      episode = currentEpisodes.get(p);
      if (!episode || episode.key !== key) {
        const supplied = H.computeSupply(g,p), initialGap = gap(g,p,supplied);
        episode = {key,player:p,type:intent.type,target:intent.target,startedPly:g.ply,lastPly:g.ply,actions:0,
          initialGap,bestGap:initialGap,targetInitiallySupplied:!!supplied[intent.target],targetBecameSupplied:false,airActions:0,goalConnections:0,
          plannerReportedCompleted:false,actionTypes:{}};
        row.planner.episodes.push(episode); currentEpisodes.set(p,episode);
      }
      episode.actions++; episode.lastPly = g.ply; episode.actionTypes[action.type] = (episode.actionTypes[action.type]||0)+1;
      episode.plannerReportedCompleted ||= !!intent.completed;
    }
    const local = target !== undefined && g.airports.some(a => H.distance(a.cell, target) <= 4);
    const ownConstruction = local && !air && ['deploy', 'engineer', 'shield', 'turret', 'bridge', 'reroute', 'exchange'].includes(action.type);
    const beforeSupply = air || ownConstruction ? H.computeSupply(g, p) : null;
    const beforeGap = beforeSupply ? gap(g, p, beforeSupply) : null, beforeDeficit = beforeSupply ? deficit(g, p, beforeSupply) : null;
    const victim = air && g.board[target] && g.board[target] !== p ? g.board[target] : 0;
    const enemyGap = victim ? gap(g, victim, H.computeSupply(g, victim)) : null;
    const oldBoard = g.board.slice(), oldRound = g.round, oldHolds = g.players.slice(1).map(p => p.goalActive);
    assert.ok(g.act(action)); row.actions++;
    if (g.plannerStates?.[p]) row.planner.memoryBytesMax = Math.max(row.planner.memoryBytesMax,Buffer.byteLength(JSON.stringify(g.plannerStates[p])));
    if (episode) {
      const supplied = H.computeSupply(g,p); episode.bestGap = Math.min(episode.bestGap,gap(g,p,supplied));
      episode.targetBecameSupplied ||= !!supplied[episode.target]; episode.airActions += Number(air);
    }
    if (air) { const activation = activeAirports.get(`${p}/${action.cells[0]}`); if (activation) { activation.firstAirPly ??= g.ply-1; activation.airActions++; } }
    const q = row.quarters[Math.floor(step / 500)]; q.actions++; q.meaningful += Number(!['rest', 'discard'].includes(action.type)); q.air += Number(air); q.deploy += Number(action.type === 'deploy'); q.rest += Number(action.type === 'rest');
    for (let i = 0; i < H.COUNT; i++) q.boardChanges += Number(oldBoard[i] !== g.board[i]);
    if (target !== undefined) row.spatial.actions[region(target)]++;
    if (local) { row.airport.localActions++; if (player.firstGoalMs === null) { row.airport.localBeforeFirstGoal++; player.airportActionsBeforeFirstGoal++; } }
    if (beforeSupply) {
      const afterSupply = H.computeSupply(g, p), afterGap = gap(g, p, afterSupply), afterDeficit = deficit(g, p, afterSupply);
      if (ownConstruction) row.airport[afterGap < beforeGap || afterDeficit < beforeDeficit ? 'localProgressAdvancing' : 'localNonAdvancing']++;
      if (air) {
        row.airUtility.actions++; row.airUtility[action.type === 'airdrop' ? 'airdrops' : 'bombardments']++;
        row.airUtility.ownFrontierImproved += Number(afterGap < beforeGap); row.airUtility.ownRouteDeficitReduced += Number(afterDeficit < beforeDeficit);
        if (action.type === 'airdrop') { row.airUtility.suppliedAirdrops += Number(afterSupply[target]); airTurrets.set(target, p); }
        if (victim) { const nextGap = gap(g, victim, H.computeSupply(g, victim)); row.airUtility.enemyFrontierSetBack += Number(nextGap > enemyGap); row.airUtility.enemyConnectionBroken += Number(enemyGap === 0 && nextGap > 0); }
      }
    }
    for (const event of g.events) if (event.id > lastEventId) {
      if (['capture', 'destroy'].includes(event.type)) {
        for (const cell of event.cells || []) { row.spatial.combat[region(cell)]++; q.combat++; }
        if (event.source === 'turret' && airTurrets.get(event.origin) === event.player) row.airUtility.airdropLaterTurretHits++;
      }
      if (event.type === 'goal-arrival') {
        const who = row.players[event.player - 1]; who.firstGoalMs ??= event.activeMs; who.arrivals++; who.goalPoints += event.points; q.arrivals++;
        const executing = currentEpisodes.get(event.player); if (executing) executing.goalConnections++;
      }
      if (event.type === 'airport-unlocked') {
        row.airport.unlocks++; row.players[event.player - 1].firstAirportMs ??= event.activeMs;
        const activation = {player:event.player,airport:event.cells[0],unlockedPly:g.ply-1,lostPly:null,firstAirPly:null,airActions:0};
        row.planner.airportFollowups.push(activation); activeAirports.set(`${event.player}/${event.cells[0]}`,activation);
      }
      if (event.type === 'airport-lost') { row.airport.losses++; const key=`${event.player}/${event.cells[0]}`,activation=activeAirports.get(key); if (activation) {activation.lostPly=g.ply-1;activeAirports.delete(key);} }
    }
    lastEventId = g.events.at(-1)?.id || lastEventId;
    for (const [cell, owner] of airTurrets) if (g.board[cell] !== owner || !g.turrets.some(t => t.cell === cell && t.owner === owner)) airTurrets.delete(cell);
    if (g.round !== oldRound) for (const seat of H.PLAYERS) if (oldHolds[seat - 1] && g.players[seat].goalActive) { row.players[seat - 1].holdingRounds++; row.players[seat - 1].goalPoints += H.RULES.holdingScore; q.holdingRounds++; }
    trace.update(JSON.stringify([p, action, g.players.slice(1).map(p => p.score)]));
    g.advanceTime(300);
    if ((step + 1) % 6 === 0) sampleState((step + 1) % 30 === 0);
    if ((step + 1) % 100 === 0) {
      assert.equal(g.drawPile.length + g.discardPile.length + g.hands.reduce((s, h) => s + h.length, 0), 96);
      for (const seat of H.PLAYERS) { assert.ok(g.hands[seat].length <= H.RULES.handCap); assert.equal(g.board[g.players[seat].home], seat); assert.ok(g.players[seat].energy >= 0 && g.players[seat].supplies >= 0); }
    }
  }
  sampleState(true);
  assert.equal(g.activeMs, actionLimit*300);assert.equal(g.phase,actionLimit===2000?'over':'running');if(actionLimit===2000)assert.ok(g.result);
  row.traceSha256 = trace.digest('hex'); row.telemetry = JSON.parse(JSON.stringify(g.telemetry)); row.winners = g.result?.winners || [];
  for (const p of H.PLAYERS) { const player = row.players[p - 1]; player.policy = mode === 'baseline' || (mode === 'mixed' && (p+config.mixedOffset)%2!==1) ? 'released96c109a' : 'planner'; player.score = g.players[p].score; player.winCredit = row.winners.includes(p) ? 1 / row.winners.length : 0; player.meanProgress = player.progressSum / player.progressSamples; delete player.progressSum; }
  assert.equal(row.players.reduce((s, p) => s + p.arrivals, 0), g.telemetry.goalArrivals);
  assert.equal(row.players.reduce((s, p) => s + p.holdingRounds, 0), g.telemetry.goalHoldingRounds);
  output.games.push(row); save(output);
  console.log(JSON.stringify({ mode, sample, completed: output.games.length, of: schedule.length, seed: config.seed, rotation: config.rotation,
    arrivals: g.telemetry.goalArrivals, holding: g.telemetry.goalHoldingRounds, connected: row.players.filter(p => p.firstGoalMs !== null).length,
    peakProgress: row.players.map(p => p.peakProgress), airportNonAdvancing: row.airport.localNonAdvancing, air: row.airUtility.actions,
    combat: row.spatial.combat, lateCombat: row.quarters[3].combat, aiMeanMs: row.aiMs / row.actions }));
}
output.complete = true; output.wallSeconds = (performance.now() - wallStart) / 1000; output.summary = aggregate(output.games, regionAreas);
save(output); console.log(JSON.stringify({ complete: true, output: outPath, wallSeconds: output.wallSeconds, summary: output.summary }));
