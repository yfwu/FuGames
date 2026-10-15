/* AutoHex public-information planner. Fixed search budgets; no deck or hidden hands. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AutoHexPlanner = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  function create(H) {
    const { CELLS, ADJ, COUNT, PLAYERS, RADIUS, RULES, PLANNER_LIMITS: LIMIT, distance, computeSupply, goalCell, allied } = H;
    const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
    const hash = value => { let n = 2166136261; for (const c of String(value)) n = Math.imul(n ^ c.charCodeAt(0), 16777619); return n >>> 0; };
    const near = CELLS.map(c => { const a = []; for (let q = -5; q <= 5; q++) for (let r = Math.max(-5, -q - 5); r <= Math.min(5, -q + 5); r++) { const i = H.index(c.q + q, c.r + r); if (i >= 0) a.push(i); } return a; });
    const near3 = near.map((list,i)=>list.filter(j=>distance(i,j)<=3));
    const cloneAction = a => ({ type: a.type, cells: (a.cells || []).slice(), ...(a.cardIndex === undefined ? {} : { cardIndex: a.cardIndex }), ...(a.target === undefined ? {} : { target: a.target }) });
    const handOf = (s, p) => s._simulation ? s.hands[p] : s.hand || [];
    const neutralStyle = { lane:'center', centerAversion:0, raid:0, robustness:0, expansion:0 };
    const fallbackPolicy = { id:'legacy', mission:'connect', route:{side:0,transport:'both',maxDetour:18}, airport:{mode:'opportunity',maxOwnActions:18,maxSetupCost:36,projection:'either'}, commitment:{reviewOwnTurns:6,stalledOwnTurns:3,maxOwnTurns:24}, diplomacy:'opportunity', style:neutralStyle };
    const policyOf = (s,p) => s.players[p].strategy || fallbackPolicy;
    const tacticsOf = s => s.strategyConfig?.tactics || H.TACTICS;
    const styleOf = (s,p) => policyOf(s,p).style || neutralStyle;
    // Doctrine geometry. Every monotone route from a home to the opposite edge
    // has the same length, so a lane through a neighbour's front yard costs no
    // extra cells; only habit sent all six factions through the centre.
    const ring = i => Math.max(Math.abs(CELLS[i].q), Math.abs(CELLS[i].r), Math.abs(CELLS[i].s));
    const CENTER_RING = Math.round(RADIUS * 7 / 18), LANE_OFFSET = Math.round(RADIUS * 7 / 18), LANE_RAMP = Math.round(RADIUS * 14 / 18);
    const OTHER_AXES = { q:['r','s'], r:['s','q'], s:['q','r'] };
    const lateral = (s,p,i) => { const pl=s.players[p],[a,b]=OTHER_AXES[pl.axis]; return (CELLS[i][a]-CELLS[i][b])/2*pl.sign; };
    const laneTarget = (s,p,i,lane) => lane*LANE_OFFSET*clamp((2*RADIUS-remaining(s,p,i))/LANE_RAMP,0,1);
    const laneCache = new Map();
    // Static per-faction surcharge for leaving the chosen lane or entering the
    // centre. Own stones never pay it; it only shapes where new stones go.
    function lanePenalty(s,p,lane) {
      const st=styleOf(s,p),key=p+':'+s.players[p].axis+':'+s.players[p].sign+':'+lane+':'+st.centerAversion;
      if(laneCache.has(key))return laneCache.get(key);
      const cost=new Float32Array(COUNT),weight=lane?.13:0;
      for(let i=0;i<COUNT;i++){
        const r=ring(i),left=remaining(s,p,i);
        if(st.centerAversion&&r<=CENTER_RING)cost[i]+=st.centerAversion*.08*(CENTER_RING+1-r)/(CENTER_RING+1);
        cost[i]+=weight*Math.max(0,Math.abs(lateral(s,p,i)-laneTarget(s,p,i,lane))-2)*Math.min(1,left/4);
      }
      laneCache.set(key,cost);return cost;
    }
    const allows = (policy,type) => type==='bridge'||type==='reroute' ? ['bridge','both'].includes(policy.route.transport) : type==='tunnel' ? ['tunnel','both'].includes(policy.route.transport) : true;
    // Enumerate a tiny bounded set of explicit two/three-edge routes. This is
    // geometry-only; the common engine checks ownership, blockers and costs.
    function tunnelPaths(a,b) {
      const result=[];let visited=0;
      function walk(path) {
        if(++visited>64||result.length>=3)return;
        const i=path.at(-1),edges=path.length-1;
        if(i===b){if(edges>=2)result.push(path);return;}
        if(edges===3||distance(i,b)>3-edges)return;
        for(const j of ADJ[i].slice().sort((x,y)=>distance(x,b)-distance(y,b)||x-y))if(!path.includes(j))walk([...path,j]);
      }
      walk([a]);return result;
    }
    const remaining = (s, p, i) => RADIUS + CELLS[i][s.players[p].axis] * s.players[p].sign;
    // Own supply cut vertices (Tarjan, iterative) under enemy pressure. Each
    // entry reports how many supplied stones that single cell carries.
    function articulation(s,p,supplied,danger) {
      const links=new Map();
      for(const b of [...s.bridges,...(s.tunnels||[])])if(b.owner===p&&s.board[b.a]===p&&s.board[b.b]===p){if(!links.has(b.a))links.set(b.a,[]);if(!links.has(b.b))links.set(b.b,[]);links.get(b.a).push(b.b);links.get(b.b).push(b.a);}
      const home=s.players[p].home;if(s.board[home]!==p)return {points:[],fragility:0};
      const disc=new Map(),low=new Map(),size=new Map(),carried=new Map();let time=0;
      const neighbours=i=>{const out=[];for(const j of ADJ[i])if(s.board[j]===p&&supplied[j])out.push(j);for(const j of links.get(i)||[])if(supplied[j])out.push(j);return out;};
      const stack=[[home,-1,neighbours(home),0]];disc.set(home,time);low.set(home,time++);size.set(home,1);
      while(stack.length){
        const top=stack[stack.length-1],[u,parent,list]=top;
        if(top[3]<list.length){const v=list[top[3]++];if(v===parent)continue;
          if(disc.has(v)){low.set(u,Math.min(low.get(u),disc.get(v)));continue;}
          disc.set(v,time);low.set(v,time++);size.set(v,1);stack.push([v,u,neighbours(v),0]);continue;}
        stack.pop();if(parent<0)continue;
        size.set(parent,size.get(parent)+size.get(u));low.set(parent,Math.min(low.get(parent),low.get(u)));
        if(low.get(u)>=disc.get(parent)&&parent!==home)carried.set(parent,(carried.get(parent)||0)+size.get(u));
      }
      const points=[];let fragility=0;
      for(const [i,lost] of carried)if(!s.anchors[i]){points.push({cell:i,lost,danger:danger[i]});if(danger[i])fragility+=Math.min(30,lost)*Math.min(3,danger[i]);}
      return {points,fragility:Math.min(240,fragility)};
    }
    const quiet = new Uint8Array(COUNT);
    function analyze(s, p, lanes = null) {
      const own = [], supplied = computeSupply(s, p), ownAdj = new Uint8Array(COUNT), enemyAdj = new Uint8Array(COUNT), danger = new Uint8Array(COUNT), range = new Uint8Array(COUNT);
      let gap = RADIUS * 2, connected = 0, holds = false, unsupplied = 0;
      for (let i = 0; i < COUNT; i++) {
        const owner = s.board[i];
        if (owner === p) {
          own.push(i); for (const j of ADJ[i]) ownAdj[j]++; for (const j of near[i]) range[j] = 1;
          if (supplied[i]) { connected++; gap = Math.min(gap, remaining(s, p, i)); if (goalCell(s, p, i)) holds = true; } else unsupplied++;
        } else if (owner && !allied(s, p, owner)) {
          for (const j of ADJ[i]) enemyAdj[j]++;
          for (const j of near3[i]) danger[j]++;
        }
      }
      const enemy = Array(7).fill(null);
      for (const other of PLAYERS) if (other !== p) {
        const supply = computeSupply(s, other); let d = RADIUS * 2, goal = false, stranded = 0;
        for (const i of s._simulationCells[other]) if (supply[i]) { d = Math.min(d, remaining(s, other, i)); if (goalCell(s, other, i)) goal = true; } else if (!s.anchors[i]) stranded++;
        enemy[other] = { supply, gap: d, holds: goal, stranded };
      }
      const st=styleOf(s,p),fragile=st.robustness?articulation(s,p,supplied,danger):{points:[],fragility:0};
      const depots=(s.depots||[]).filter(d=>s.board[d.cell]===p&&supplied[d.cell]).length;
      const opponents=new Set();for(const i of own)if(supplied[i])for(const j of ADJ[i])if(s.board[j]&&s.board[j]!==p&&!allied(s,p,s.board[j]))opponents.add(s.board[j]);
      return { opponents, own, supplied, ownAdj, enemyAdj, danger, range, gap, connected, holds, unsupplied, enemy, lanePenalty: lanes, fragile, depots };
    }
    function weight(s, p, i, context) {
      const owner = s.board[i];
      if (s.anchors[i] && owner !== p) return 10000;
      if (owner === p) return .06;
      const lane = context.lanePenalty ? context.lanePenalty[i] : 0;
      if (owner) return lane + (allied(s, p, owner) ? 8 : 3 + H.combatStrength(s, p, i).defense * 1.1 + context.enemyAdj[i] * .3);
      return lane + 1 + (s.terrain[i] ? 1.1 : 0) + context.enemyAdj[i] * .32;
    }
    function field(s, p, context, target = null) {
      const costs = new Float64Array(COUNT).fill(Infinity), next = new Int32Array(COUNT).fill(-1), heap = [];
      function push(i, v) { let k = heap.length; heap.push([i,v]); while (k) { const u = (k-1)>>1; if (heap[u][1] <= v) break; heap[k] = heap[u]; k = u; } heap[k] = [i,v]; }
      function pop() { const first = heap[0], last = heap.pop(); if (heap.length) { let k=0; while (k*2+1<heap.length) { let c=k*2+1; if(c+1<heap.length&&heap[c+1][1]<heap[c][1])c++; if(heap[c][1]>=last[1])break; heap[k]=heap[c];k=c;}heap[k]=last;}return first; }
      for (const c of CELLS) if ((target === null ? goalCell(s,p,c.i) : c.i === target) && (!s.anchors[c.i] || s.board[c.i] === p)) { costs[c.i] = 0; push(c.i,0); }
      const links = new Map();
      for (const b of [...s.bridges,...(s.tunnels||[])]) if (b.owner === p && s.board[b.a] === p && s.board[b.b] === p) { if(!links.has(b.a))links.set(b.a,[]);if(!links.has(b.b))links.set(b.b,[]);links.get(b.a).push(b.b);links.get(b.b).push(b.a); }
      while(heap.length) { const [i,cost]=pop();if(cost!==costs[i])continue;const step=weight(s,p,i,context);
        for(const j of ADJ[i])if(cost+step<costs[j]){costs[j]=cost+step;next[j]=i;push(j,cost+step);}
        for(const j of links.get(i)||[])if(cost+.05<costs[j]){costs[j]=cost+.05;next[j]=i;push(j,cost+.05);}
      }
      return { costs, next };
    }
    function pathFrom(s, p, f, start = s.players[p].home) {
      const path = [], seen = new Set();
      for(let i=start;i>=0&&!seen.has(i)&&path.length<LIMIT.privatePath;i=f.next[i]){path.push(i);seen.add(i);}
      return path;
    }
    function deficit(s, p, path) {
      let result = 0;
      for(const i of path)if(s.board[i]!==p)result += s.board[i] ? allied(s,p,s.board[i]) ? 6 : 2.5 : s.terrain[i]===1&&!s.roads[i] ? 2 : 1;
      return result;
    }
    function routeBurden(s,p,path,context) {
      let cost=0;
      for(const i of path) {
        if(s.board[i]===p)cost+=context.supplied[i]?.025:.08;
        else cost+=weight(s,p,i,context);
      }
      return cost;
    }
    function goalPotential(s,p,context,paths) { return Math.min(...paths.map(path=>routeBurden(s,p,path,context))); }
    function cut(s, p, i, context) {
      const owner=s.board[i],before=context.enemy[owner]?.supply;
      if(!before||!before[i]||s.anchors[i])return {lost:0,goal:false,value:0};
      const board=s.board.slice();board[i]=0;const after=computeSupply({...s,board},owner);let lost=0,goal=false;
      for(let j=0;j<COUNT;j++)if(before[j]&&!after[j]){if(j!==i)lost++;if(goalCell(s,owner,j))goal=true;}
      const imminent=context.enemy[owner].gap<=3;
      return {lost,goal,value:(goal?64:0)+Math.min(32,lost*2)+(imminent?12:0)+(s.turrets.some(t=>t.cell===i)?10:0)};
    }
    function airportOpportunity(s,p,airport,context,goalField,cache) {
      let best=null;const policy=policyOf(s,p);
      const candidates=CELLS.filter(c=>s.board[c.i]&&s.board[c.i]!==p&&!s.anchors[c.i]&&!allied(s,p,s.board[c.i])&&distance(airport.cell,c.i)<=RULES.bombardRange);
      candidates.sort((a,b)=>(context.enemy[s.board[a.i]].gap-context.enemy[s.board[b.i]].gap)||context.enemyAdj[b.i]-context.enemyAdj[a.i]);
      for(const c of policy.airport.projection==='turret'?[]:candidates.slice(0,10)) {
        const routeRelevant=context.goalCells?.has(c.i),scoringThreat=context.enemy[s.board[c.i]].gap<=2;
        if(!routeRelevant&&!scoringThreat)continue;
        if(!cache.has(c.i))cache.set(c.i,cut(s,p,c.i,context));const effect=cache.get(c.i);
        const value=effect.value+(routeRelevant?Math.min(30,weight(s,p,c.i,context)*6):0)-(s.shields[c.i]?12:0);
        if(value>=12&&(!best||value>best.value))best={type:'bombard',target:c.i,value};
      }
      if(policy.airport.projection!=='bombard'&&s.turrets.filter(t=>t.owner===p).length<RULES.maxTurrets) {
        const bestGoal=Math.min(...context.own.filter(i=>context.supplied[i]).map(i=>goalField.costs[i]));
        for(const c of CELLS)if(!s.board[c.i]&&distance(airport.cell,c.i)<=RULES.airdropRange&&(s.terrain[c.i]!==1||s.roads[c.i])) {
          const connected=ADJ[c.i].some(j=>context.supplied[j]),bridge=allows(policy,'bridge')&&handOf(s,p).includes('bridge')&&near3[c.i].some(j=>context.supplied[j]&&H.bridgeLegal({...s,board:Object.assign(s.board.slice(),{[c.i]:p})},p,c.i,j));
          const gain=bestGoal-goalField.costs[c.i];
          if((connected||bridge)&&(gain>=2||context.holds&&context.danger[c.i]>=3)){
            const value=clamp(gain,0,8)*4+Math.min(20,context.danger[c.i]*2)+(context.holds&&context.danger[c.i]>=3?6:0)+(goalCell(s,p,c.i)?35:0);
            if(value>=16&&(!best||value>best.value))best={type:'airdrop',target:c.i,value};
          }
        }
      }
      // An investment program may plan a future supplied turret just beyond
      // its qualifying cluster. It must lie toward the real opposite edge;
      // no benefit is invented for an arbitrary airport on the wrong side.
      if(!best&&policy.airport.mode==='invest'&&policy.airport.projection!=='bombard'&&!context.holds) {
        const airportGap=remaining(s,p,airport.cell),homeGap=remaining(s,p,s.players[p].home);
        if(airportGap<homeGap-2) {
          const candidates=CELLS.filter(c=>!s.board[c.i]&&!s.terrain[c.i]&&distance(airport.cell,c.i)<=RULES.airportRadius+1&&distance(airport.cell,c.i)>=2&&remaining(s,p,c.i)<airportGap-1);
          candidates.sort((a,b)=>goalField.costs[a.i]+context.enemyAdj[a.i]-(goalField.costs[b.i]+context.enemyAdj[b.i])||a.i-b.i);
          if(candidates.length)best={type:'airdrop',target:candidates[0].i,value:24,investment:true};
        }
      }
      return best;
    }
    function airportCost(s,p,a,path) {
      const status=H.airportStatus(s,a.cell),owned=status.owner===p,local=owned?status.cluster:0;
      const approach=path.filter(i=>s.board[i]!==p&&distance(a.cell,i)>RULES.airportRadius).reduce((n,i)=>n+(s.board[i]?2.5:s.terrain[i]===1&&!s.roads[i]?2:1),0);
      return approach+Math.max(0,RULES.airportStones-local)+Math.max(0,RULES.airportHold-(owned?a.progress:0))+
        Math.max(0,4-s.players[p].supplies)*1.5+Math.max(0,7-s.players[p].energy)/3+(s.players[p].airCooldown||0);
    }
    const projectKey = (airport,type,target) => airport+':'+type+':'+target;
    // Supplied own stones that would lose supply if cell i were taken.
    function ownCut(s,p,i) {
      if(s.board[i]!==p||s.anchors[i])return 0;const before=computeSupply(s,p);if(!before[i])return 0;
      const board=s.board.slice();board[i]=0;const after=computeSupply({...s,board},p);let lost=0;
      for(let j=0;j<COUNT;j++)if(j!==i&&before[j]&&!after[j])lost++;return lost;
    }
    // Plain hex distance from the supplied network, ignoring obstacles; used
    // only to bound which far targets a doctrine bothers to consider.
    function reachFrom(s,context,limit) {
      const dist=new Uint8Array(COUNT).fill(255),queue=[];
      for(const i of context.own)if(context.supplied[i]){dist[i]=0;queue.push(i);}
      for(let k=0;k<queue.length;k++){const i=queue[k];if(dist[i]>=limit)continue;for(const j of ADJ[i])if(dist[j]===255){dist[j]=dist[i]+1;queue.push(j);}}
      return dist;
    }
    function nearestSupplied(context,f,fallback) { let best=fallback; for(const i of context.own)if(context.supplied[i]&&f.costs[i]<f.costs[best])best=i; return best; }
    // Adaptive doctrines pick the least contested lane ahead of their front,
    // with a seeded preference so equal openings differ between campaigns,
    // and stick to it until the campaign stalls or a long review comes due.
    function chooseLane(s,p,base,memory) {
      const st=styleOf(s,p),options=({center:[0],left:[-1],right:[1],flank:[-1,1]})[st.lane]||[-1,0,1];
      const prev=memory?.campaign?.lane,since=memory?.campaign?.laneSince??s.ply;
      if(options.length===1)return {lane:options[0],since:prev===options[0]?since:s.ply};
      if(prev!==undefined&&options.includes(prev)&&(memory.campaign.stalled||0)<tacticsOf(s).flankCommitOwnTurns&&s.ply-since<PLAYERS.length*16)return {lane:prev,since};
      let best=null;
      for(const lane of options){
        let contest=hash(s.seed+':lane:'+p+':'+lane)%1000/1000*3+(lane===0?st.centerAversion*1.5:0)-(lane===prev?4:0);
        for(let i=0;i<COUNT;i++){
          if(remaining(s,p,i)>=base.gap||Math.abs(lateral(s,p,i)-laneTarget(s,p,i,lane))>2.5)continue;
          const owner=s.board[i];if(owner&&owner!==p&&!allied(s,p,owner))contest+=s.anchors[i]?3:1.2;contest+=base.danger[i]*.15;
        }
        if(!best||contest<best.contest)best={lane,contest};
      }
      return {lane:best.lane,since:best.lane===prev?since:s.ply};
    }
    function planMetric(s,p,plan) {
      if(plan.type==='airport') {if(s._planningProjects?.includes(projectKey(plan.target,plan.followType,plan.followTarget))||plan.followType==='bombard'&&(!s.board[plan.followTarget]||s.board[plan.followTarget]===p)||plan.followType==='airdrop'&&s.board[plan.followTarget]===p&&s.turrets.some(t=>t.owner===p&&t.cell===plan.followTarget)&&computeSupply(s,p)[plan.followTarget])return 0;const a=s.airports.find(a=>a.cell===plan.target);return a?airportCost(s,p,a,plan.path):1000;}
      if(plan.type==='fortify')return ownCut(s,p,plan.target);
      if(plan.type==='expand'&&s.board[plan.target]===p&&computeSupply(s,p)[plan.target])return 0;
      return deficit(s,p,plan.path);
    }
    function actualComplete(s,p,plan,context) {
      if(plan.type==='airport')return plan.followType==='bombard' ? !s.board[plan.followTarget]||s.board[plan.followTarget]===p : s.board[plan.followTarget]===p&&s.turrets.some(t=>t.owner===p&&t.cell===plan.followTarget)&&!!context.supplied[plan.followTarget];
      if(plan.type==='interdict'||plan.type==='defend'&&plan.stage!=='hold')return s.board[plan.target]===0||s.board[plan.target]===p;
      if(plan.type==='defend')return false;
      if(plan.type==='recover')return !!context.supplied[plan.target];
      if(plan.type==='fortify')return ownCut(s,p,plan.target)===0;
      if(plan.type==='expand')return s.board[plan.target]===p&&!!context.supplied[plan.target];
      return context.holds;
    }
    function makePlans(s,p,context,memory,greedy) {
      const home=CELLS[s.players[p].home],profile=s.players[p].profile,policy=policyOf(s,p),opening=memory?.opening??hash(s.seed+':opening:'+p+':'+profile.name+':'+policy.id)%3;
      const previousProgram=memory?.program?.policyId===policy.id?memory.program:null;
      const program={policyId:policy.id,airportSpent:previousProgram?.airportSpent||0,airportCooldownUntilPly:previousProgram?.airportCooldownUntilPly||0};
      if(program.airportCooldownUntilPly&&s.ply>=program.airportCooldownUntilPly){program.airportSpent=0;program.airportCooldownUntilPly=0;}
      if(program.airportSpent>=policy.airport.maxOwnActions&&!program.airportCooldownUntilPly)program.airportCooldownUntilPly=s.ply+PLAYERS.length*12;
      const goalField=field(s,p,context),directPath=pathFrom(s,p,goalField),directCost=deficit(s,p,directPath),plans=[],cache=new Map();
      const add=plan=>{if(plan.path?.length&&plan.path.every(i=>Number.isInteger(i)&&i>=0&&i<COUNT))plans.push(plan);};
      let previousOutcome='none',stalled=0,reuse=null;
      if(memory&&memory.version===1&&Array.isArray(memory.path)&&memory.path.length) {
        const old={type:memory.strategy,ownGoal:['direct','flank'].includes(memory.strategy)||memory.strategy==='defend'&&memory.stage==='hold'&&goalCell(s,p,memory.path.at(-1)),stage:memory.stage,target:memory.target,path:memory.path.slice(0,LIMIT.privatePath),side:memory.side,followType:memory.followType,followTarget:memory.followTarget,waypoints:memory.waypoints||[]};
        const metric=planMetric(s,p,old);stalled=metric>=memory.metric-.01?Math.min(12,(memory.stalled||0)+1):0;
        const lost=old.type==='airport'&&(!s.airports.some(a=>a.cell===old.target)||old.followType==='bombard'&&s.board[old.followTarget]&&allied(s,p,s.board[old.followTarget])||old.followType==='airdrop'&&s.board[old.followTarget]&&!s.turrets.some(t=>t.owner===p&&t.cell===old.followTarget));
        if(actualComplete(s,p,old,context))previousOutcome='completed';
        else if(lost)previousOutcome='opportunity_changed';
        else if(stalled>=policy.commitment.stalledOwnTurns||(memory.age||0)>=policy.commitment.maxOwnTurns)previousOutcome='stalled';
        else if(s.ply>=memory.reviewAtPly)previousOutcome='review';
        else {reuse=old;previousOutcome='continued';}
      }
      add({type:context.holds?'defend':'direct',stage:context.holds?'hold':'advance',target:directPath.at(-1),path:directPath,waypoints:[],side:0,prior:0,ownGoal:true,reason:!context.holds&&context.laneChoice?.lane?'open_lane':'short_route'});
      // Two genuinely different corridors, with a mid-board waypoint on either
      // side of the home/goal axis. Extra length is charged, not erased.
      if(!context.holds)for(const side of [-1,1]) {
        if(policy.route.side&&policy.route.side!==side)continue;
        const front=context.own.filter(i=>context.supplied[i]).sort((a,b)=>goalField.costs[a]-goalField.costs[b]||a-b)[0],fc=CELLS[front];
        const crossing=home.q*fc.r-home.r*fc.q,targetGap=Math.max(1,remaining(s,p,front)-6);
        const candidates=CELLS.filter(c=>remaining(s,p,c.i)===targetGap&&(home.q*c.r-home.r*c.q-crossing)*side>0&&Math.abs(home.q*c.r-home.r*c.q-crossing)/RADIUS>=3&&Math.abs(home.q*c.r-home.r*c.q-crossing)/RADIUS<=8&&!s.anchors[c.i]);
        candidates.sort((a,b)=>context.danger[a.i]*2+distance(s.players[p].home,a.i)+goalField.costs[a.i]-(context.danger[b.i]*2+distance(s.players[p].home,b.i)+goalField.costs[b.i])||a.i-b.i);
        if(candidates.length){const waypoint=candidates[0].i,to=field(s,p,context,waypoint),first=pathFrom(s,p,to),second=pathFrom(s,p,goalField,waypoint).slice(1),path=[...first,...second].slice(0,LIMIT.privatePath);
          const preferred=opening===(side<0?1:2),cost=deficit(s,p,path),exposure=path.reduce((n,i)=>n+context.enemyAdj[i],0);
          if(cost-directCost<=policy.route.maxDetour)add({type:'flank',stage:'advance',target:waypoint,path,waypoints:[waypoint],side,prior:0,ownGoal:true,style:(policy.mission==='flank'?4:0)+(preferred?1.5:profile.flank===side?.5:0)+tacticsOf(s).contactBonus*Math.min(2,new Set(path.flatMap(i=>ADJ[i].map(j=>s.board[j])).filter(owner=>owner&&owner!==p&&!allied(s,p,owner)&&!context.opponents.has(owner))).size),reason:'less_contested'});
        }
      }
      const previousCampaign=memory?.campaign;
      const goalPlans=plans.filter(plan=>plan.ownGoal);
      if(previousCampaign?.path?.length&&goalCell(s,p,previousCampaign.path.at(-1)))goalPlans.push({type:previousCampaign.side?'flank':'direct',stage:'advance',target:previousCampaign.path.at(-1),path:previousCampaign.path.slice(),waypoints:[],side:previousCampaign.side,prior:0,ownGoal:true,campaignContinuation:true,reason:'continue_plan'});
      goalPlans.sort((a,b)=>routeBurden(s,p,a.path,context)-(a.style||0)-(routeBurden(s,p,b.path,context)-(b.style||0)));
      const oldCost=previousCampaign?routeBurden(s,p,previousCampaign.path,context):Infinity;
      const improved=!!previousCampaign&&(oldCost<previousCampaign.bestRemaining-.15||context.gap<previousCampaign.bestGap);
      const globalStalled=context.holds?0:previousCampaign?improved?0:Math.min(1000,previousCampaign.stalled+1):0;
      const oldPlan=goalPlans.find(plan=>plan.campaignContinuation),bestGoal=goalPlans[0];
      const campaignPlan=oldPlan&&globalStalled<tacticsOf(s).flankCommitOwnTurns&&oldCost<=routeBurden(s,p,bestGoal.path,context)+2?oldPlan:bestGoal;
      if(campaignPlan.campaignContinuation)add(campaignPlan);
      const campaignCost=routeBurden(s,p,campaignPlan.path,context);
      const campaign={path:campaignPlan.path.slice(0,LIMIT.privatePath),side:campaignPlan.side||0,remaining:campaignCost,
        bestRemaining:previousCampaign?Math.min(previousCampaign.bestRemaining,campaignCost):campaignCost,initialRemaining:previousCampaign?.initialRemaining??campaignCost,
        gap:context.gap,bestGap:previousCampaign?Math.min(previousCampaign.bestGap,context.gap):context.gap,stalled:globalStalled,age:(previousCampaign?.age||0)+1,
        committedAtPly:previousCampaign?.committedAtPly??s.ply,lastProgressPly:improved||context.holds?s.ply:previousCampaign?.lastProgressPly??s.ply,
        lane:context.laneChoice?.lane??0,laneSince:context.laneChoice?.since??s.ply};
      const goalPaths=[];for(const plan of [campaignPlan,...goalPlans])if(!goalPaths.some(path=>path.join(',')===plan.path.join(','))&&goalPaths.length<4)goalPaths.push(plan.path);
      context.campaignPath=campaignPlan.path;context.goalPaths=goalPaths;context.goalCells=new Set(goalPaths.flat());context.goalPotential=goalPotential(s,p,context,goalPaths);
      // One delayed, supplied capture window, compared against the same goal.
      // Keep only the nearest two forward blockers, not arbitrary score targets.
      const breachTargets=s.players[p].breachTarget>=0?[s.players[p].breachTarget]:s.players[p].breachReady?CELLS.filter(c=>H.breachTarget(s,p,c.i)).map(c=>c.i):[];
      breachTargets.sort((a,b)=>goalField.costs[a]-goalField.costs[b]||a-b);
      for(const target of breachTargets.slice(0,2)) {
        const path=[...pathFrom(s,p,field(s,p,context,target)),...pathFrom(s,p,goalField,target).slice(1)];
        if(path.length<=LIMIT.privatePath&&deficit(s,p,path)-directCost<=policy.route.maxDetour)add({type:'direct',stage:'advance',target,path,waypoints:[target],side:0,prior:12,ownGoal:true,reason:'breakthrough'});
      }
      const airports=s.airports.slice().sort((a,b)=>distance(s.players[p].home,a.cell)-distance(s.players[p].home,b.cell));
      for(const a of policy.airport.mode==='avoid'||program.airportCooldownUntilPly>s.ply?[]:airports) {
        const opportunity=airportOpportunity(s,p,a,context,goalField,cache);if(!opportunity)continue;
        const f=field(s,p,context,a.cell),path=pathFrom(s,p,f),investment=airportCost(s,p,a,path),benefit=opportunity.value-investment*3;
        if(investment>policy.airport.maxSetupCost||benefit<4&&!a.active&&policy.airport.mode!=='invest')continue;
        add({type:'airport',stage:a.owner!==p||!a.supplied?'approach':a.cluster<RULES.airportStones?'build':!a.active?'hold':'project',target:a.cell,path,waypoints:[a.cell],side:0,followType:opportunity.type,followTarget:opportunity.target,opportunity:opportunity.value,investment:!!opportunity.investment,prior:Math.max(0,benefit)*.55+(policy.airport.mode==='invest'?12:0),reason:'airport_projection'});
      }
      for(const other of PLAYERS) {
        const target=s.players[other].breachTarget;
        if(other!==p&&target>=0&&s.board[target]===p&&handOf(s,p).includes('shield')&&!s.shields[target])add({type:'defend',stage:'hold',target,path:[target],waypoints:[target],side:0,prior:30,forced:{type:'shield',cells:[target],cardIndex:handOf(s,p).indexOf('shield')},reason:'protect_connection'});
      }
      const enemies=CELLS.filter(c=>s.board[c.i]&&s.board[c.i]!==p&&!s.anchors[c.i]&&!allied(s,p,s.board[c.i])&&context.range[c.i]);
      enemies.sort((a,b)=>context.enemy[s.board[a.i]].gap-context.enemy[s.board[b.i]].gap||context.enemyAdj[b.i]-context.enemyAdj[a.i]);
      for(const c of enemies.slice(0,12)) {
        if(!cache.has(c.i))cache.set(c.i,cut(s,p,c.i,context));const effect=cache.get(c.i);if(effect.value<16||!context.goalCells.has(c.i)&&context.enemy[s.board[c.i]].gap>2&&(policy.mission!=='interdict'||globalStalled>=4))continue;
        const f=field(s,p,context,c.i),start=context.own.reduce((best,i)=>f.costs[i]<f.costs[best]?i:best,s.players[p].home),path=pathFrom(s,p,f,start),urgent=effect.goal||context.enemy[s.board[c.i]].gap<=2;
        add({type:urgent?'defend':'interdict',stage:'approach',target:c.i,path,waypoints:[c.i],side:0,prior:effect.value*.32-deficit(s,p,path)*1.2,reason:urgent?'urgent_threat':'cut_supply'});
      }
      if(greedy&&['shield','airdrop','bombard'].includes(greedy.type)) {
        const target=greedy.cells.at(-1),protect=greedy.type==='shield'&&s.neutralWarning?.cells.includes(target);
        if(protect)add({type:'defend',stage:'hold',target,path:[target],waypoints:[target],side:0,prior:14+(s.airports.some(a=>a.cell===target&&a.active)?12:0),forced:cloneAction(greedy),reason:'protect_connection'});
        if((greedy.type==='airdrop'||greedy.type==='bombard')&&policy.airport.mode!=='avoid'&&program.airportCooldownUntilPly<=s.ply){
          const a=s.airports.find(a=>a.cell===greedy.cells[0]),opportunity=airportOpportunity(s,p,a,context,goalField,cache);
          if(opportunity)add({type:'airport',stage:'project',target:a.cell,path:pathFrom(s,p,field(s,p,context,a.cell)),waypoints:[a.cell],side:0,followType:greedy.type,followTarget:target,opportunity:opportunity.value,prior:opportunity.value*.55,forced:cloneAction(greedy),reason:'airport_projection'});
        }
      }
      const st=styleOf(s,p);let reach=null;
      // Raiders hunt thin, deep enemy supply lines up to nine cells away:
      // a cell carrying many stones beyond it starves them in six turns.
      if(st.raid>=5&&!context.holds) {
        reach=reachFrom(s,context,12);const thin=[];
        for(const other of PLAYERS)if(other!==p&&!allied(s,p,other))for(const x of articulation(s,other,context.enemy[other].supply,quiet).points)
          if(x.lost>=3&&reach[x.cell]<=9)thin.push({i:x.cell,score:Math.min(16,x.lost)-reach[x.cell]*2-(H.combatStrength(s,p,x.cell).defense-1)*4});
        thin.sort((a,b)=>b.score-a.score||a.i-b.i);const raids=[];
        for(const {i} of thin.slice(0,8)){
          if(plans.some(x=>x.target===i))continue;if(!cache.has(i))cache.set(i,cut(s,p,i,context));const effect=cache.get(i);if(effect.lost<3)continue;
          const f=field(s,p,context,i),path=pathFrom(s,p,f,nearestSupplied(context,f,s.players[p].home));
          raids.push({type:'interdict',stage:'approach',target:i,path,waypoints:[i],side:0,prior:effect.value*.32+st.raid*1.2-deficit(s,p,path)*1.5,reason:'raid_supply'});
        }
        raids.sort((a,b)=>b.prior-a.prior||a.target-b.target).slice(0,2).forEach(add);
      }
      // Consolidators widen single-cell supply necks that enemies can reach.
      if(st.robustness>=3) {
        const exposure=x=>Math.min(30,x.lost)*Math.min(3,x.danger)*(1+context.enemyAdj[x.cell]);
        const points=context.fragile.points.filter(x=>(x.danger>=2||context.enemyAdj[x.cell])&&x.lost>=(st.robustness>=6?5:8)).sort((a,b)=>exposure(b)-exposure(a)||a.cell-b.cell);
        for(const x of points.slice(0,2))add({type:'fortify',stage:'hold',target:x.cell,path:[x.cell],waypoints:[x.cell],side:0,prior:Math.min(30,x.lost)*Math.min(3,x.danger)*.12*st.robustness/5,reason:'thin_supply'});
      }
      // Expansionists claim depots: more supplies, more air power later.
      // A depot or two is plenty; past that the route matters more.
      if(st.expansion>=3&&!context.holds&&context.depots<1+Math.floor(st.expansion/4)) {
        reach=reach||reachFrom(s,context,12);
        for(const d of s.depots||[]){const owner=s.board[d.cell];
          if(owner===p&&context.supplied[d.cell]||owner&&owner!==p&&allied(s,p,owner)||reach[d.cell]>12)continue;
          const f=field(s,p,context,d.cell),path=pathFrom(s,p,f,nearestSupplied(context,f,s.players[p].home));
          add({type:'expand',stage:'approach',target:d.cell,path,waypoints:[d.cell],side:0,prior:st.expansion*1.6-deficit(s,p,path)*.6,reason:'claim_depot'});
        }
      }
      const stranded=context.own.filter(i=>!context.supplied[i]);
      if(stranded.length>=(policy.mission==='recover'?1:3)||stranded.some(i=>goalCell(s,p,i))) {
        stranded.sort((a,b)=>goalField.costs[a]-goalField.costs[b]);const target=stranded[0],f=field(s,p,context,target),path=pathFrom(s,p,f);
        add({type:'recover',stage:'repair',target,path,waypoints:[target],side:0,prior:0,reason:'restore_supply'});
      }
      if(reuse) {
        const existing=plans.find(x=>x.type===reuse.type&&x.target===reuse.target&&x.side===reuse.side);
        if(reuse.type!=='airport'||existing){const plan={...(existing||reuse),...reuse,reused:true,prior:(existing?.prior||0)+9-stalled*3,reason:'continue_plan'};plans.unshift(plan);}
      }
      plans.sort((a,b)=>(b.reused?100:0)+b.prior-((a.reused?100:0)+a.prior));
      // Keep strategy diversity, including the direct route, within a fixed cap.
      const selected=[];for(const plan of plans){if(selected.some(x=>x.type===plan.type&&x.target===plan.target&&x.side===plan.side))continue;selected.push(plan);if(selected.length===LIMIT.plans)break;}
      if(!selected.some(x=>x.type==='direct'||x.type==='defend'&&context.holds))selected[selected.length-1]=plans.find(x=>x.type==='direct'||x.type==='defend'&&context.holds);
      return {plans:selected,goalField,opening,stalled,previousOutcome,campaign,goalPaths,program,campaignReplanned:!!previousCampaign&&!campaignPlan.campaignContinuation};
    }
    function candidateActions(s,p,plan,context,rootGreedy=null) {
      const candidates=[],seen=new Set(),hand=handOf(s,p),policy=policyOf(s,p),cards={};hand.forEach((t,i)=>{if(cards[t]===undefined)cards[t]=i;});
      function add(action,rank){if(!allows(policy,action.type))return;if(['offer','accept'].includes(action.type)&&policy.diplomacy==='avoid')return;if((action.type==='deploy'||action.type==='airdrop')&&context.own.length>=H.MAX_STONES)return;const key=action.type+':'+(action.cells||[]).join(',')+':'+(action.target||0);if(!seen.has(key)){seen.add(key);candidates.push({action,rank,key});}}
      function card(type,cells,rank){if(cards[type]!==undefined)add({type,cells,cardIndex:cards[type]},rank);}
      if(plan.reason==='breakthrough') { add({type:'deploy',cells:[plan.target]},120);add({type:'breach',cells:[plan.target]},119); }
      if(plan.forced&&H.legalAction(s,plan.forced))return [cloneAction(plan.forced)];
      const onPath=new Set(plan.path),missing=plan.path.filter(i=>s.board[i]!==p),next=missing.find(i=>ADJ[i].some(j=>context.supplied[j]));
      for(const i of missing.slice(0,8))if(context.range[i]) {
        const order=missing.indexOf(i),front=ADJ[i].some(j=>context.supplied[j]);
        if(!s.board[i]&&front)add({type:s.terrain[i]!==0?'engineer':'deploy',cells:[i]},65-order);
        else if(s.board[i]&&s.board[i]!==p){add({type:'deploy',cells:[i]},71-order);card('destroy',[i],65-order);for(const j of ADJ[i])if(s.board[j]===p&&!onPath.has(j))card('exchange',[j,i],61-order);}
        // Prepare a real far entrance, then link it on a following own action.
        // The three-ply rollout pays both construction actions and sees supply
        // exposure; it cannot teleport a supplied stone over the obstruction.
        if(!s.board[i]&&!s.terrain[i]&&!front&&policy.route.transport!=='ground') {
          const board=s.board.slice();board[i]=p;const hypothetical={...s,board};
          const starts=near3[i].filter(j=>context.supplied[j]&&distance(i,j)>=2).slice(0,8);
          const feasible=starts.some(j=>allows(policy,'bridge')&&cards.bridge!==undefined&&H.bridgeLegal(hypothetical,p,j,i)||allows(policy,'tunnel')&&H.tunnelLegal&&tunnelPaths(j,i).some(path=>H.tunnelLegal(hypothetical,p,path)));
          if(feasible)add({type:'deploy',cells:[i]},64-order);
        }
      }
      if(plan.type==='airport') {
        const airport=s.airports.find(a=>a.cell===plan.target);
        if(airport?.owner===p&&airport.supplied) {
          if(!airport.active&&airport.cluster<RULES.airportStones)for(const c of CELLS)if(!s.board[c.i]&&distance(airport.cell,c.i)<=RULES.airportRadius&&ADJ[c.i].some(j=>s.board[j]===p&&distance(airport.cell,j)<=RULES.airportRadius)){
            add({type:s.terrain[c.i]!==0?'engineer':'deploy',cells:[c.i]},80+context.ownAdj[c.i]*.4-distance(airport.cell,c.i)*.6+context.enemyAdj[c.i]*.4);
          }
          if(airport.active&&plan.followTarget!==null)add({type:plan.followType,cells:[airport.cell,plan.followTarget]},105);
        }
      }
      if(plan.type==='fortify'&&s.board[plan.target]===p) {
        // Bypass cells and bridges that touch both the stones a neck carries
        // and the home side of it; the rollout scores the real redundancy.
        const u=plan.target,board=s.board.slice();board[u]=0;const after=computeSupply({...s,board},p);
        const beyond=i=>s.board[i]===p&&context.supplied[i]&&!after[i]&&i!==u,homeSide=i=>s.board[i]===p&&after[i];
        for(const j of near3[u])if(!s.board[j]&&s.terrain[j]!==1){
          const toBeyond=ADJ[j].some(beyond),toHome=ADJ[j].some(homeSide);
          // One-step bypass, or the first stone of a two-step one.
          const rank=toBeyond&&toHome?90:toHome&&near[j].some(k=>beyond(k)&&distance(j,k)===2)||toBeyond&&near[j].some(k=>homeSide(k)&&distance(j,k)===2)?84:0;
          if(rank)add({type:s.terrain[j]?'engineer':'deploy',cells:[j]},rank+context.ownAdj[j]*.3);
        }
        if(cards.bridge!==undefined)for(const a of near3[u])if(beyond(a))for(const b of near3[a])if(homeSide(b))card('bridge',[a,b],88);
        card('shield',[u],80+context.danger[u]*2);card('turret',[u],78+Math.min(5,context.danger[u]));
      }
      if(plan.type==='expand'&&!s.board[plan.target]&&ADJ[plan.target].some(j=>context.supplied[j]))add({type:'deploy',cells:[plan.target]},96);
      if(plan.type==='defend'||plan.type==='interdict') {
        add({type:'deploy',cells:[plan.target]},96);card('destroy',[plan.target],93);
        for(const a of s.airports)if(a.owner===p&&a.active)add({type:'bombard',cells:[a.cell,plan.target]},97);
      }
      for(const i of context.own) {
        if(!context.supplied[i])for(const j of near3[i])if(context.supplied[j]){card('bridge',[i,j],72+(goalCell(s,p,i)?25:0));}
        if(s.terrain[i]===2&&onPath.has(i))add({type:'engineer',cells:[i]},(s.hillAge?.[i]||0)>=1?99:76);
        if(context.danger[i]&&onPath.has(i)){card('turret',[i],39+Math.min(7,context.danger[i])*2);card('shield',[i],35+context.enemyAdj[i]*3+(goalCell(s,p,i)?25:0));}
        if(s.neutralWarning?.cells.includes(i)&&s.age[i]<RULES.fortifyAge)card('shield',[i],88+(onPath.has(i)?8:0));
      }
      if(allows(policy,'tunnel')&&H.tunnelLegal) {
        const ends=context.own.filter(i=>!context.supplied[i]).sort((a,b)=>(onPath.has(b)?1:0)-(onPath.has(a)?1:0)||remaining(s,p,a)-remaining(s,p,b)).slice(0,6);let pairs=0;
        for(const i of ends)for(const j of near3[i])if(context.supplied[j]&&distance(i,j)>=2&&pairs++<12)for(const path of tunnelPaths(j,i))if(H.tunnelLegal(s,p,path)){add({type:'tunnel',cells:path},74+(goalCell(s,p,i)?25:0));break;}
      }
      // Public tunnels are counterable without drawing a demolition card.
      for(const tunnel of s.tunnels||[])if(tunnel.owner!==p&&!allied(s,p,tunnel.owner)&&context.enemy[tunnel.owner]?.gap<=3)for(const i of tunnel.path.slice(1,-1))if(context.range[i])add({type:'engineer',cells:[i]},84);
      // Support and alternate cells prevent a single blocked target from
      // becoming a repeated illegal attack. Their effect is tested in rollout.
      for(const i of context.own)if(context.supplied[i])for(const j of ADJ[i])if(!s.board[j]) {
        const dist=next===undefined?remaining(s,p,j):distance(j,next),rank=30-dist*1.5+context.ownAdj[j]*.2;
        add({type:s.terrain[j]!==0?'engineer':'deploy',cells:[j]},rank);
      }
      for(const offer of s.offers||[])if(offer.to===p){const other=offer.from,blocked=plan.path.some(i=>s.board[i]===other)||s.board[plan.followTarget]===other||context.enemy[other].holds||context.enemy[other].gap<=2,shared=context.own.some(i=>ADJ[i].some(j=>s.board[j]&&s.board[j]!==p&&s.board[j]!==other&&!allied(s,p,s.board[j])));add({type:'accept',target:other,cells:[]},!blocked&&shared?74:14);add({type:'reject',target:other,cells:[]},2);}
      for(const other of H.alliesOf(s,p))if(plan.path.some(i=>s.board[i]===other))add({type:'betray',target:other,cells:[]},75);
      for(const other of PLAYERS)if(other!==p&&!allied(s,p,other)) {
        const contact=context.own.some(i=>ADJ[i].some(j=>s.board[j]===other));
        const shared=context.own.some(i=>ADJ[i].some(j=>s.board[j]&&s.board[j]!==p&&s.board[j]!==other&&!allied(s,p,s.board[j])));if(contact&&!plan.path.some(i=>s.board[i]===other)&&s.board[plan.followTarget]!==other&&!context.enemy[other].holds&&context.enemy[other].gap>2)add({type:'offer',target:other,cells:[]},shared?70:15);
      }
      if(rootGreedy)add(cloneAction(rootGreedy),plan.ownGoal&&((rootGreedy.cells||[]).some(i=>onPath.has(i))||rootGreedy.type==='bridge')?78:55);
      if(context.own.length>=H.MAX_STONES-1)for(const i of context.own)if(!s.anchors[i]&&!onPath.has(i)) {
        const board=s.board.slice();board[i]=0;const supply=computeSupply({...s,board},p);
        if(context.own.every(j=>j===i||!context.supplied[j]||supply[j])){add({type:'withdraw',cells:[i]},80);break;}
      }
      add({type:'rest',cells:[]},-8);
      if(hand.length)add({type:'discard',cells:[],cardIndex:0},-10);
      const result=[];const ranked=candidates.sort((a,b)=>b.rank-a.rank||hash(s.seed+':'+p+':'+a.key)-hash(s.seed+':'+p+':'+b.key));
      for(const candidate of ranked)if(H.legalAction(s,candidate.action)){result.push(candidate.action);if(result.length===LIMIT.actionsPerPlan)break;}
      // Different tunnel shapes are not different strategic continuations.
      // Reserve one alternative for a durable adjacent route repair so the
      // rollout can compare engineering with immediately counterable transport.
      if(result.length===LIMIT.actionsPerPlan&&result.every(a=>['bridge','tunnel'].includes(a.type))) {
        const repair=ranked.find(({action:a})=>['engineer','deploy'].includes(a.type)&&onPath.has(a.cells[0])&&ADJ[a.cells[0]].some(j=>context.supplied[j])&&H.legalAction(s,a));
        if(repair)result[result.length-1]=repair.action;
      }
      return result;
    }
    function opponentReply(s,p,actor) {
      const supply=computeSupply(s,p),own=s._simulationCells[p];
      const options=[],seen=new Set();let frontier=RADIUS*2;for(const i of own)if(supply[i])frontier=Math.min(frontier,remaining(s,p,i));
      const add=(a,value)=>{const key=a.type+':'+(a.cells||[]).join(',')+':'+(a.target||0);if(!seen.has(key)){seen.add(key);options.push({a,value});}};
      for(const i of own)if(supply[i])for(const j of ADJ[i])if(s.board[j]!==p&&!s.anchors[j]) {
        const progress=frontier-remaining(s,p,j),owner=s.board[j],cutGoal=owner===actor&&goalCell(s,actor,j);
        add({type:!owner&&s.terrain[j]!==0?'engineer':'deploy',cells:[j]},20+progress*11+(goalCell(s,p,j)?45:0)+(owner?8:0)+(cutGoal?35:0));
      }
      if(s.players[p].breachTarget>=0)add({type:'deploy',cells:[s.players[p].breachTarget]},120);
      // A publicly telegraphed breakthrough invites a supply-cut reply. No
      // shield is invented: opponent hands stay unknown to this simulation.
      const warned=s.players[actor].breachTarget;
      if(warned>=0&&s.board[warned]===p)for(const i of ADJ[warned])if(s.board[i]===actor)add({type:'deploy',cells:[i]},100);
      // At most two legal attacks receive an explicit articulation/supply-cut
      // probe. This gives the reply model a way to punish exposed internal
      // junctions without recursively planning all five opponents.
      const cuts=options.filter(o=>o.a.type==='deploy'&&s.board[o.a.cells[0]]===actor)
        .sort((a,b)=>remaining(s,actor,b.a.cells[0])-remaining(s,actor,a.a.cells[0])).slice(0,2);
      if(cuts.length&&!allied(s,p,actor)) {
        const before=computeSupply(s,actor);
        for(const option of cuts)if(H.legalAction(s,option.a)){
          const board=s.board.slice(),target=option.a.cells[0];board[target]=p;const after=computeSupply({...s,board},actor);let lost=0,goal=false;
          for(const i of s._simulationCells[actor])if(before[i]&&!after[i]){lost++;if(goalCell(s,actor,i))goal=true;}
          option.value+=Math.min(54,lost*3)+(goal?45:0);
        }
      }
      for(const a of s.airports)if(a.owner===p&&a.active&&s.players[p].supplies>=4&&!s.players[p].airCooldown) {
        for(const i of CELLS)if(s.board[i.i]===actor&&distance(a.cell,i.i)<=RULES.bombardRange&&!s.anchors[i.i])add({type:'bombard',cells:[a.cell,i.i]},24+(goalCell(s,actor,i.i)?60:0));
      }
      // The reply model must know the same visible tunnel counterplay as the
      // live AI. Otherwise it repeatedly invests in an entrance the next seat
      // can cheaply collapse, overestimating a connection that never survives.
      for(const tunnel of s.tunnels||[])if(tunnel.owner===actor&&!allied(s,p,actor)) {
        const target=tunnel.path.slice(1,-1).find(i=>H.legalAction(s,{type:'engineer',cells:[i]}));
        if(target!==undefined){
          const before=computeSupply(s,actor),after=computeSupply({...s,tunnels:s.tunnels.filter(t=>t!==tunnel)},actor);let lost=0,goal=false;
          for(const i of s._simulationCells[actor])if(before[i]&&!after[i]){lost++;if(goalCell(s,actor,i))goal=true;}
          if(lost)add({type:'engineer',cells:[target]},24+Math.min(45,lost*4)+(goal?60:0));
        }
      }
      for(const offer of s.offers)if(offer.to===p){const from=offer.from,shared=own.some(i=>ADJ[i].some(j=>s.board[j]&&s.board[j]!==p&&s.board[j]!==from&&!allied(s,p,s.board[j])));if(shared)add({type:'accept',target:from,cells:[]},34);}
      options.sort((a,b)=>b.value-a.value);return options.find(option=>H.legalAction(s,option.a))?.a||{type:'rest',cells:[]};
    }
    function advance(s,p,action) {
      if(s.phase!=='running')return s;
      const next=H.createPublicSimulation(s,p),target=action.cells?.at(-1),sabotaged=action.type==='engineer'?(s.tunnels||[]).find(t=>t.owner!==p&&!allied(s,p,t.owner)&&t.path.slice(1,-1).includes(target)):null,owner=sabotaged?.owner||(target===undefined?0:s.board[target]);
      const couldInterrupt=owner&&owner!==p&&(['deploy','destroy','bombard','exchange'].includes(action.type)||!!sabotaged),before=couldInterrupt?computeSupply(s,owner):null;
      const heldBefore=before&&s._simulationCells[owner].some(i=>before[i]&&goalCell(s,owner,i));
      next._planningAttacks=(s._planningAttacks||[]).slice();
      if(couldInterrupt)next._planningAttacks.push(target);
      next._planningInterruptions=s._planningInterruptions||0;
      next._planningProjects=(s._planningProjects||[]).slice();if(!next.act(action))return null;
      // Cooldown and spent resources after a successful flight are the cost of
      // using the facility, not lost construction progress. Preserve that actual
      // simulated action even when a later opponent repairs its bombard target.
      if(['airdrop','bombard'].includes(action.type))next._planningProjects.push(projectKey(action.cells[0],action.type,target));
      if(heldBefore){const after=computeSupply(next,owner);if(!next._simulationCells[owner].some(i=>after[i]&&goalCell(next,owner,i)))next._planningInterruptions++;}

      for(let n=0;next.phase==='running'&&next.turn!==p&&n<PLAYERS.length-1;n++){const reply=opponentReply(next,next.turn,p);if(!next.act(reply))return null;}
      return next;
    }
    function utility(s,p,plan,context,base,baseMetric,root) {
      // Every mission is evaluated against the SAME remaining campaign route
      // potential. Local harassment completion is not interchangeable with a
      // move closer to the opposite edge and carries no intrinsic plan reward.
      const remainingGoal=goalPotential(s,p,context,base.goalPaths);
      const style=styleOf(root,p),tactics=tacticsOf(root);
      // Opening an enemy square is preparation, not a supplied connection.
      // Credit its saved route cost only after an own stone occupies it. The
      // reserved rollout branch still evaluates demolition -> capture.
      const bestPath=base.goalPaths.reduce((a,b)=>routeBurden(s,p,a,context)<=routeBurden(s,p,b,context)?a:b);
      let unclaimed=0;for(const i of bestPath)if(root.board[i]&&root.board[i]!==p&&!s.board[i])unclaimed+=Math.max(0,weight(root,p,i,base)-weight(s,p,i,context));
      const progress=base.goalPotential-remainingGoal-unclaimed;
      let value=progress*tactics.routeProgressWeight+(base.gap-context.gap)*2+
        (context.connected-base.connected)*.15-(context.unsupplied-base.unsupplied)*.5+
        (context.holds?180:0)-(base.holds&&!context.holds?200:0)+
        (s.players[p].score-root.players[p].score)*tactics.combatScoreWeight+Math.min(1,s._planningInterruptions||0)*tactics.interruptionWeight;
      // Contacts have value only while the home-to-edge route improves.
      if(progress>.15)value+=Math.min(2,[...context.opponents].filter(other=>!base.opponents.has(other)).length)*tactics.contactBonus;
      if(context.gap>=base.gap&&context.connected<=base.connected) {
        const seen=new Set(root._planningAttacks);
        for(const target of (s._planningAttacks||[]).slice(root._planningAttacks.length)){if(seen.has(target))value-=tactics.repeatAttackPenalty;seen.add(target);}
      }
      if(s.phase==='over'&&s.result){const winners=s.result.winners||[];value+=winners.includes(p)||s.result.winner===p?10000:-10000;}
      if(plan.ownGoal&&plan.path.join(',')===base.campaignPath.join(','))value+=.3;
      for(const other of PLAYERS)if(other!==p) {
        value-=(s.players[other].score-root.players[other].score)*.6;
        const a=base.enemy[other],b=context.enemy[other];
        if(a.holds&&!b.holds)value+=85;if(!a.holds&&b.holds)value-=80;
        if(a.gap<=2)value+=Math.min(6,b.gap-a.gap)*7;
        // Starved enemy stones retreat after six turns: the raid payoff.
        if(!allied(s,p,other))value+=Math.min(12,Math.max(0,b.stranded-a.stranded))*style.raid*.35;
      }
      value-=(context.fragile.fragility-base.fragile.fragility)*style.robustness*.06;
      value+=(context.depots-base.depots)*style.expansion*1.5+(context.connected-base.connected)*style.expansion*.05;
      for(const i of root.neutralWarning?.cells||[])if(s.board[i]===p&&!s.shields[i]&&s.age[i]<RULES.fortifyAge)value-=root.airports.some(a=>a.cell===i&&a.owner===p&&a.active)?28:base.holds?30:4;
      value+=s.players[p].energy*.2+s.players[p].supplies*.3;
      // Batteries are useful only through public threats near a held route;
      // the exact first shots still execute in the three-turn simulation.
      if(base.holds)for(const t of s.turrets)if(t.owner===p&&context.supplied[t.cell])value+=Math.min(12,context.danger[t.cell]*2);
      // Doctrine missions are credited for real approach progress, as airport
      // investment is: the payoff (starved stones, a widened neck, a depot)
      // usually lands just beyond the three-action horizon.
      const credit=plan.type==='interdict'&&plan.reason==='raid_supply'?style.raid*.6:plan.type==='fortify'?style.robustness*.15:plan.type==='expand'?style.expansion*.6:0;
      if(credit)value+=(baseMetric-planMetric(s,p,plan))*credit;
      if(plan.type==='airport') {
        const owner=root.board[plan.followTarget],threat=owner&&owner!==p?base.enemy[owner]:null;
        const urgent=plan.followType==='bombard'&&threat&&threat.gap<=2;
        // Construction can be justified beyond the short horizon by stopping
        // an ACTUAL scoring threat. Generic facility/cut progress gets no credit.
        if(urgent&&!allied(s,p,owner))value+=(baseMetric-planMetric(s,p,plan))*(threat.holds?12:9)*tactics.routeProgressWeight/9;
        else if(policyOf(root,p).airport.mode==='invest')value+=(baseMetric-planMetric(s,p,plan))*4*tactics.routeProgressWeight/9;
      }
      return value;
    }
    function publicPath(s,p,plan,context) {
      let start=0;while(start+1<plan.path.length&&context.supplied[plan.path[start+1]])start++;
      return plan.path.slice(start,start+LIMIT.publicPath);
    }
    function choose(view) {
      const p=view.turn,root=H.createPublicSimulation(view,p),memory=view.plannerMemory,base=analyze(root,p);
      root._planningAttacks=(view.recentActions||[]).filter(a=>a.player===p&&(a.captures||a.destroyed)).slice(-8).map(a=>a.cells.at(-1));
      base.laneChoice=chooseLane(root,p,base,memory);base.lanePenalty=lanePenalty(root,p,base.laneChoice.lane);
      const greedy=H.greedyAction(view),generated=makePlans(root,p,base,memory,greedy),nodes=[];let count=0,replyActions=0,simulations=0;
      const transitions=new WeakMap(),analyses=new WeakMap();
      const step=(state,action)=>{let cache=transitions.get(state);if(!cache){cache=new Map();transitions.set(state,cache);}const key=JSON.stringify(action);if(cache.has(key))return cache.get(key);const next=advance(state,p,action);simulations++;replyActions+=Math.min(PLAYERS.length-1,Math.max(0,(next?.ply||state.ply)-state.ply-1));cache.set(key,next);return next;};
      const inspect=state=>{if(!analyses.has(state))analyses.set(state,analyze(state,p,base.lanePenalty));return analyses.get(state);};
      for(const plan of generated.plans)for(const action of candidateActions(root,p,plan,base,greedy)) {
        if(count>=LIMIT.nodes)break;const s=step(root,action);count++;if(!s)continue;
        const context=inspect(s),metric=planMetric(root,p,plan);
        nodes.push({s,context,plan,first:action,depth:1,baseMetric:metric,value:utility(s,p,plan,context,base,metric,root)});
      }
      // A strong doctrine keeps its best line alive through the beam: a raid
      // or a neck repair pays off on the second or third own action, never
      // on the first, and would otherwise always lose to one more route step.
      const doctrineStyle=styleOf(root,p),doctrine=doctrineStyle.raid>=6?'interdict':doctrineStyle.robustness>=6?'fortify':doctrineStyle.expansion>=6?'expand':null;
      function beam(list){const sorted=list.sort((a,b)=>b.value-a.value),out=[],route=sorted.find(n=>n.plan.ownGoal),kept=sorted.find(n=>n.first.type==='breach')||sorted.find(n=>n.first.type==='destroy'&&n.plan.ownGoal)||(doctrine&&sorted.find(n=>n.plan.type===doctrine));if(route)out.push(route);if(kept&&kept!==route&&out.length<LIMIT.beam)out.push(kept);for(const n of sorted){if(out.length>=LIMIT.beam)break;if(n!==route&&!out.some(o=>o.plan.type===n.plan.type&&o.plan.target===n.plan.target))out.push(n);}return out;}
      let frontier=beam(nodes),depth=1;const routeBeamDepths=frontier.some(n=>n.plan.ownGoal)?[1]:[];
      for(;depth<LIMIT.depth&&frontier.length&&count<LIMIT.nodes;depth++) {
        const expanded=[];
        for(const node of frontier){if(node.s.phase!=='running'){expanded.push(node);continue;}for(const action of candidateActions(node.s,p,node.plan,node.context)) {
          if(count>=LIMIT.nodes)break;const s=step(node.s,action);count++;if(!s)continue;
          const context=inspect(s);expanded.push({...node,s,context,depth:depth+1,value:utility(s,p,node.plan,context,base,node.baseMetric,root)});
        }}
        if(!expanded.length)break;frontier=beam(expanded);if(frontier.some(n=>n.plan.ownGoal))routeBeamDepths.push(depth+1);
      }
      const finalists=frontier.length?frontier:nodes,ordered=finalists.sort((a,b)=>b.value-a.value),policy=policyOf(root,p);
      let best=ordered[0];
      // Mission programs can commit to a bounded detour, while common search
      // overrides them for an immediate connection or public scoring threat.
      // This selects a real staged action sequence; it never modifies scores.
      const urgent=PLAYERS.some(other=>other!==p&&!allied(root,p,other)&&(base.enemy[other].holds||base.enemy[other].gap<=2));
      if(best&&!urgent&&!base.holds&&best.value<9000){
        const wanted=doctrine||{flank:'flank',airhead:'airport',interdict:'interdict',recover:'recover'}[policy.mission];
        const preferred=ordered.find(n=>n.plan.type===wanted&&n.value>=best.value-(wanted==='airport'?16:doctrine&&n.plan.reused?14:10)&&planMetric(n.s,p,n.plan)<n.baseMetric-.05);
        if(preferred)best=preferred;
      }
      if(!best)return greedy;
      let plan=best.plan;
      const landing=best.first.cells?.at(-1);
      if(['deploy','bridge','exchange'].includes(best.first.type)&&landing!==undefined&&goalCell(root,p,landing)&&base.supplied.some((v,i)=>v&&ADJ[landing].includes(i))&&plan.type==='airport'){
        plan={type:'direct',stage:'advance',target:landing,path:pathFrom(root,p,field(root,p,base,landing)),waypoints:[],side:0,reason:'short_route'};
      }
      const metric=planMetric(root,p,plan),reused=!!plan.reused,complete=actualComplete(root,p,plan,base);
      const initial=reused?Math.max(memory.initialMetric,metric):Math.max(1,metric),stalled=reused?generated.stalled:0;
      let reason=['offer','accept'].includes(best.first.type)?'protect_connection':plan.reason;
      if(generated.previousOutcome==='stalled'&&!reused)reason='stalled';
      else if(memory&&!reused&&generated.previousOutcome!=='none'&&generated.previousOutcome!=='completed'&&reason!=='urgent_threat')reason='opportunity_changed';
      const stage=plan.type==='airport'?(()=>{const a=root.airports.find(a=>a.cell===plan.target);return a.owner!==p||!a.supplied?'approach':a.cluster<RULES.airportStones?'build':!a.active?'hold':'project';})():plan.stage||'advance';
      if(plan.type==='airport')generated.program.airportSpent=Math.min(24,generated.program.airportSpent+1);
      const nextMemory={version:1,program:generated.program,campaign:generated.campaign,strategy:plan.type,stage,target:plan.target,followTarget:plan.followTarget??null,followType:plan.followType??null,path:plan.path.slice(0,LIMIT.privatePath),waypoints:plan.waypoints||[],
        committedAtPly:reused?memory.committedAtPly:view.ply,reviewAtPly:reused?memory.reviewAtPly:view.ply+PLAYERS.length*policyOf(root,p).commitment.reviewOwnTurns,lastPly:view.ply,
        metric,initialMetric:initial,age:reused?(memory.age||0)+1:0,stalled,side:plan.side||0,opening:generated.opening,completed:complete,reasonCode:reason};
      return {...cloneAction(best.first),planner:{version:1,memory:nextMemory,
        publicIntent:{player:p,type:plan.type,stage,target:plan.target,path:publicPath(root,p,plan,base),reasonCode:reason,committedAtPly:nextMemory.committedAtPly,reviewAtPly:nextMemory.reviewAtPly,progress:clamp(1-metric/initial,0,1),completed:complete,stalled},
        diagnostics:{nodes:count,maxNodes:LIMIT.nodes,depth:best.depth,candidates:generated.plans.length,opponentReplies:replyActions,simulations,routeBeamDepths,campaignReplanned:generated.campaignReplanned,reusedIntent:reused,chosenStrategy:plan.type,reasonCode:reason,previousOutcome:generated.previousOutcome}}};
    }
    function realized(state,p,planned) {
      const m=planned.memory,plan={type:m.strategy,stage:m.stage,target:m.target,path:m.path,followTarget:m.followTarget,followType:m.followType};
      const supplied=computeSupply(state,p),holds=CELLS.some(c=>supplied[c.i]&&goalCell(state,p,c.i));
      const completed=actualComplete(state,p,plan,{supplied,holds});
      m.completed=completed;planned.publicIntent.completed=completed;
      planned.publicIntent.progress=clamp(1-planMetric(state,p,plan)/Math.max(1,m.initialMetric),0,1);
      planned.publicIntent.path=publicPath(state,p,plan,{supplied});
    }
    return Object.freeze({choose,realized});
  }
  return Object.freeze({create});
});
