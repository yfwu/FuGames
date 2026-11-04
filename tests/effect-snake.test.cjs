'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'effect_snake.html'), 'utf8');
const S = vm.runInNewContext(html.match(/<script id="snake-engine">([\s\S]*?)<\/script>/)[1] + ';EffectSnake;');
const seeded = seed => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const json = value => JSON.parse(JSON.stringify(value));
function place(g,id,x,y,dir,length=4) {
  const a=g.actors[id]; Object.assign(a,{dir,nextDir:dir,alive:true,shield:0,slow:0,slowSkip:false,targetLength:length,warning:null});
  a.body=Array.from({length},(_,i)=>({x:x-S.DIRS[dir].x*i,y:y-S.DIRS[dir].y*i})); return a;
}
function fixture() {
  const g=new S.Game(seeded(1));g.start();g.obstacles=[];g.food=[];
  for(const a of g.actors.slice(1)){a.alive=false;a.body=[];a.respawn=10000;}
  g.aiDirection=a=>a.dir; return g;
}
function invariants(g) {
  assert.equal(g.actors.length,4);assert.ok(g.food.length<=S.FOOD_LIMIT);
  const occupied=new Set(g.obstacles.map(S.key));
  for(const a of g.actors){
    assert.ok(a.score>=0&&Number.isInteger(a.score));assert.ok(a.shield>=0&&a.slow>=0);
    assert.ok(a.targetLength>=3&&a.targetLength<=S.MAX_LENGTH);
    if(!a.alive){assert.equal(a.body.length,0);continue;}
    assert.ok(a.body.length>=3&&a.body.length<=S.MAX_LENGTH);
    for(const p of a.body){assert.ok(S.inside(p));assert.ok(!occupied.has(S.key(p)),'bodies cannot overlap');occupied.add(S.key(p));}
  }
  for(const f of g.food){assert.ok(S.inside(f));assert.ok(S.FOODS[f.type]);assert.ok(!occupied.has(S.key(f)),'food cannot overlap any body');occupied.add(S.key(f));}
}

test('all states freeze appropriately; reset clears timers, results and respawn resources',()=>{
  const g=new S.Game(seeded(2));g.step();assert.equal(g.tick,0);assert.equal(g.setDirection(0),false);
  g.start();g.step();g.pause();const paused=JSON.stringify(g);g.step();assert.equal(JSON.stringify(g),paused);
  g.start();g.step();assert.equal(g.tick,2);
  g.phase='over';const over=JSON.stringify(g);g.step();assert.equal(JSON.stringify(g),over);
  g.reset();assert.equal(g.phase,'ready');assert.equal(g.tick,0);assert.equal(g.result,null);assert.equal(g.respawns,0);assert.equal(g.food.length,14);
  invariants(g);
});

test('direction changes are constrained to actual heading; fast repeated presses cannot reverse',()=>{
  const g=fixture();assert.equal(g.actors[0].dir,1);
  assert.equal(g.setDirection(3),false);assert.equal(g.setDirection(0),true);assert.equal(g.setDirection(3),false);
  assert.equal(g.setDirection(99),false);assert.equal(g.setDirection(NaN),false);
  g.step();assert.equal(g.actors[0].dir,0);assert.deepEqual(json(g.actors[0].body[0]),{x:7,y:3});
  assert.equal(g.setDirection(3),true);
});

test('fruit and star scoring, staged growth, poison floors and hard length limit',()=>{
  const g=fixture(),a=place(g,0,8,10,1);g.food=[{x:9,y:10,type:'fruit'},{x:10,y:10,type:'star'}];
  g.step();assert.equal(a.score,10);assert.equal(a.body.length,5);
  g.step();assert.equal(a.score,35);assert.equal(a.targetLength,7);assert.equal(a.body.length,6);
  g.step();assert.equal(a.body.length,7);assert.equal(new Set(a.body.map(S.key)).size,7);
  g.food=[{x:12,y:10,type:'poison'}];g.step();assert.equal(a.score,20);assert.equal(a.body.length,4);
  g.eat(a,{type:'poison'});g.eat(a,{type:'poison'});assert.equal(a.score,0);assert.equal(a.targetLength,3);assert.equal(a.body.length,3);
  for(let i=0;i<60;i++)g.eat(a,{type:'star'});assert.equal(a.targetLength,S.MAX_LENGTH);assert.equal(a.score,1500);
});

test('slow duration is exact, refreshes without stacking, and pauses freeze remaining effect',()=>{
  const g=fixture(),a=place(g,0,8,10,1);g.eat(a,{type:'slow'});assert.equal(a.slow,S.SLOW_TICKS);
  const start=a.body[0].x;g.step();assert.equal(a.body[0].x,start);assert.equal(a.slow,S.SLOW_TICKS-1);
  g.step();assert.equal(a.body[0].x,start+1);
  g.eat(a,{type:'slow'});assert.equal(a.slow,S.SLOW_TICKS);g.pause();g.step();assert.equal(a.slow,S.SLOW_TICKS);g.start();
  for(let i=0;i<S.SLOW_TICKS;i++)g.step();assert.equal(a.slow,0);assert.equal(a.body[0].x,start+13);
  g.step();assert.equal(a.body[0].x,start+14);
});

test('poison cancels pending star growth and shrinks from the length before this movement',()=>{
  const g=fixture(),a=place(g,0,8,10,1,6);g.food=[{x:9,y:10,type:'star'},{x:10,y:10,type:'poison'}];
  g.step();assert.equal(a.body.length,7);assert.equal(a.targetLength,8);
  g.step();assert.equal(a.body.length,4);assert.equal(a.targetLength,4);assert.equal(a.score,10);
});

test('shield refreshes, protects on its final tick, consumes once and leaves the head in place',()=>{
  const g=fixture(),a=place(g,0,27,12,1);g.eat(a,{type:'shield'});g.eat(a,{type:'shield'});assert.equal(a.shield,S.SHIELD_TICKS);assert.equal(a.score,10);
  a.shield=1;g.step();assert.equal(a.alive,true);assert.equal(a.shield,0);assert.equal(a.body[0].x,27);assert.equal(g.events.filter(e=>e.type==='shield').length,1);
  g.step();assert.equal(a.alive,false);assert.equal(g.phase,'over');assert.equal(g.result.score,10);assert.equal(g.result.ticks,2);
  const h=fixture(),b=place(h,0,8,8,1);b.shield=2;h.step();assert.equal(b.shield,1);h.step();assert.equal(b.shield,0);assert.equal(b.alive,true);
});

test('head-on collision is simultaneous and food stays uneaten; shield does not grant the contested cell',()=>{
  for(const shields of [[0,0],[1,0],[1,1]]) {
    const g=fixture(),a=place(g,0,9,10,1),b=place(g,1,11,10,3);a.shield=shields[0];b.shield=shields[1];
    g.food=[{x:10,y:10,type:'star'}];g.step();assert.equal(a.alive,!!shields[0]);assert.equal(b.alive,!!shields[1]);assert.equal(g.food.length,1);
    assert.equal(a.score,0);assert.equal(b.score,0);if(a.alive)assert.equal(a.body[0].x,9);if(b.alive)assert.equal(b.body[0].x,11);
  }
});

test('head swaps, walls, stones, own body and departing tails all collide',()=>{
  const swap=fixture();place(swap,0,9,10,1);place(swap,1,10,10,3);swap.step();assert.equal(swap.actors[0].alive,false);assert.equal(swap.actors[1].alive,false);
  const wall=fixture();place(wall,0,0,10,3);wall.step();assert.equal(wall.phase,'over');
  const rock=fixture();place(rock,0,8,10,1);rock.obstacles=[{x:9,y:10}];rock.step();assert.equal(rock.phase,'over');
  const tail=fixture(),a=place(tail,0,8,10,1);a.body=[{x:8,y:10},{x:8,y:9},{x:9,y:9},{x:9,y:10}];tail.step();assert.equal(tail.phase,'over');
  const other=fixture();place(other,0,8,10,1);place(other,1,12,10,1);other.step();assert.equal(other.actors[0].alive,false);assert.equal(other.actors[1].alive,true);
});

test('a waiting slow snake remains an obstacle, including to a moving head',()=>{
  const g=fixture(),a=place(g,0,9,10,1),b=place(g,1,10,10,0);b.slow=10;b.slowSkip=true;g.step();
  assert.equal(a.alive,false);assert.equal(b.alive,true);assert.deepEqual(json(b.body[0]),{x:10,y:10});
});

test('safe spawn requires empty body, forward corridor, distance and a full visible warning',()=>{
  const g=fixture(),a=g.actors[1];a.respawn=0;g.replenishAI();assert.ok(a.warning);assert.equal(a.warning.left,S.WARNING_TICKS);assert.equal(a.alive,false);
  const w=a.warning;assert.ok(g.safeSpawn(w));
  for(let n=0;n<S.WARNING_TICKS-1;n++)g.replenishAI();assert.equal(a.alive,false);
  g.replenishAI();assert.equal(a.alive,true);assert.equal(g.respawns,1);assert.equal(a.score,0);assert.equal(a.body.length,4);assert.equal(a.warning,null);
  const h=fixture(),b=h.actors[1];b.respawn=0;h.replenishAI();assert.ok(b.warning);
  h.actors[0].body[0]={...b.warning.body[0]};b.warning.left=1;h.replenishAI();assert.equal(b.alive,false);assert.equal(b.warning,null);assert.equal(b.respawn,6);
});

test('no safe space postpones spawn; food spawning terminates and respects the capacity',()=>{
  const g=fixture();g.obstacles=Array.from({length:S.SIZE*S.SIZE},(_,i)=>({x:i%S.SIZE,y:Math.floor(i/S.SIZE)}));
  assert.equal(g.findSpawn(),null);assert.equal(g.addFood(),false);const a=g.actors[1];a.respawn=0;g.replenishAI();assert.equal(a.warning,null);assert.equal(a.respawn,6);
  const h=new S.Game(seeded(4));for(let i=0;i<100;i++)assert.equal(h.addFood(),false);assert.equal(h.food.length,14);
});

test('expired hazards leave the board and replacement food has a bounded lifetime',()=>{
  const g=fixture();g.food=[{x:2,y:2,type:'poison',expires:1},{x:3,y:2,type:'slow',expires:2}];
  g.step();assert.equal(g.food.length,1);g.step();assert.equal(g.food.length,0);
  g.tick=5;g.step();assert.equal(g.food.length,1);assert.equal(g.food[0].expires,196);
});

test('AI avoids walls, bodies and negative food while pursuing accessible rewards',()=>{
  const g=new S.Game(seeded(8));g.obstacles=[];g.food=[];for(const a of g.actors){a.alive=false;a.body=[];}
  const a=place(g,1,8,10,1);g.food=[{x:9,y:10,type:'poison'},{x:8,y:9,type:'star'}];assert.equal(g.aiDirection(a),0);
  a.body=[{x:27,y:10},{x:26,y:10},{x:25,y:10},{x:24,y:10}];g.food=[{x:27,y:11,type:'fruit'}];assert.equal(g.aiDirection(a),2);
  g.obstacles=[{x:27,y:11}];assert.equal(g.aiDirection(a),0);
});

test('public personality weights produce different decisions on the same board',()=>{
  const decisions=new Set();
  for(const id of [1,2,3]) {
    const g=new S.Game(seeded(8));g.obstacles=[];g.food=[{x:4,y:10,type:'star'}];for(const a of g.actors){a.alive=false;a.body=[];}
    const a=place(g,id,10,10,0);place(g,0,15,11,0);decisions.add(g.aiDirection(a));
  }
  assert.ok(decisions.size>=2,'interceptor should prefer the opponent front while the collector prefers the star');
});

test('bounded deterministic matches preserve unique bodies, food bounds, scoring and AI replenishment',()=>{
  let steps=0,spawnCount=0,foodCount=0,longest=0;const signatures=[];
  for(let seed=1;seed<=8;seed++) {
    const g=new S.Game(seeded(seed));g.start();
    for(let n=0;n<564&&g.phase==='running';n++) {
      g.setDirection(g.aiDirection(g.actors[0]));g.step();steps++;invariants(g);
      foodCount+=g.events.filter(e=>e.type==='food').length;longest=Math.max(longest,g.tick);
    }
    spawnCount+=g.respawns;signatures.push([g.tick,g.actors.map(a=>a.score),g.respawns]);
  }
  assert.ok(steps>563);assert.equal(longest,563);assert.ok(spawnCount>0);assert.ok(foodCount>20);
  const a=new S.Game(seeded(81)),b=new S.Game(seeded(81));a.start();b.start();
  for(let i=0;i<500&&a.phase==='running';i++){a.setDirection(a.aiDirection(a.actors[0]));b.setDirection(b.aiDirection(b.actors[0]));a.step();b.step();}
  assert.equal(JSON.stringify(a),JSON.stringify(b));
});

test('boost buys a second step with mass, drops collectible food, and obeys pause and minimum mass',()=>{const g=fixture(),a=place(g,0,10,10,1,8);g.tick=1;g.step({boost:true});assert.equal(a.body[0].x,12);assert.equal(a.targetLength,7);assert.ok(g.food.some(f=>f.type==='fruit'));g.pause();const frozen=JSON.stringify(g);g.step({boost:true});assert.equal(JSON.stringify(g),frozen);g.start();place(g,0,10,10,1,5);g.step({boost:true});assert.equal(a.body[0].x,11);assert.equal(a.targetLength,5);});
test('mass only wins same-cell contests; shield and any body remain counters',()=>{const g=fixture(),a=place(g,0,10,10,1,9),b=place(g,1,12,10,3,4);g.aiDirection=x=>x.dir;g.step();assert.equal(a.alive,true);assert.equal(b.alive,false);assert.equal(a.score,30);const h=fixture(),c=place(h,0,10,10,1,9),d=place(h,1,12,10,3,4);d.shield=10;h.step();assert.equal(c.alive,false);assert.equal(d.alive,true);const j=fixture(),big=place(j,0,10,10,1,12);place(j,1,11,11,2,3);j.step();assert.equal(big.alive,false);});
test('ninety-second contest ranks public scores plus surviving mass and terminates',()=>{const g=fixture();g.tick=562;g.actors[0].score=100;g.step();assert.equal(g.phase,'over');assert.equal(g.result.ranks[0].id,0);assert.equal(g.result.outcome,'win');});

// ---------- Tiers, arena modifiers, power-ups and career ----------
const C = vm.runInNewContext(html.match(/<script id="snake-career">([\s\S]*?)<\/script>/)[1] + ';SnakeCareer;');
function fixtureWith(options) {
  const g=new S.Game(seeded(1),options);g.start();g.obstacles=[];g.food=[];
  for(const a of g.actors.slice(1)){a.alive=false;a.body=[];a.respawn=10000;}
  g.aiDirection=a=>a.dir; return g;
}
function looseInvariants(g) {
  assert.ok(g.food.length<=g.foodLimit);
  const occupied=new Set(g.obstacles.map(S.key));
  for(const a of g.actors){
    assert.ok(a.score>=0&&Number.isInteger(a.score));assert.ok(a.targetLength>=3&&a.targetLength<=S.MAX_LENGTH);assert.ok(a.blade>=0);
    if(!a.alive){assert.equal(a.body.length,0);continue;}
    assert.ok(a.body.length>=1&&a.body.length<=S.MAX_LENGTH);
    for(const p of a.body){assert.ok(S.inside(p));assert.ok(!occupied.has(S.key(p)),'bodies never overlap walls or each other');occupied.add(S.key(p));}
  }
  for(const f of g.food){assert.ok(S.FOODS[f.type]);assert.ok(!occupied.has(S.key(f)),'food never sits on a body or wall');occupied.add(S.key(f));}
}

test('options default to the original rules and normalise bad input',()=>{
  const g=new S.Game(seeded(3));
  assert.deepEqual(json(g.options),{tier:1,modifiers:{powerups:false,feast:false,venom:false,shrink:false}});
  assert.equal(g.foodLimit,S.FOOD_LIMIT);assert.deepEqual(json(g.cycle),['fruit','shield','fruit','poison','star','fruit','slow','fruit']);
  assert.equal(new S.Game(seeded(3),{tier:9}).options.tier,1);assert.equal(new S.Game(seeded(3),{tier:'2'}).options.tier,1);assert.equal(new S.Game(seeded(3),{tier:3}).options.tier,3);
  assert.deepEqual(json(new S.Game(seeded(3),{modifiers:['feast','nope']}).options.modifiers),{powerups:false,feast:true,venom:false,shrink:false});
  assert.deepEqual(json(new S.Game(seeded(3),{modifiers:{venom:true,shrink:1}}).options.modifiers),{powerups:false,feast:false,venom:true,shrink:false});
  // Explicit standard tier with no modifiers plays exactly the same match as no options at all.
  const a=new S.Game(seeded(21)),b=new S.Game(seeded(21),{tier:1,modifiers:[]});a.start();b.start();
  for(let i=0;i<400&&a.phase==='running';i++){a.setDirection(a.aiDirection(a.actors[0]));b.setDirection(b.aiDirection(b.actors[0]));a.step({boost:i%9<3});b.step({boost:i%9<3});}
  assert.equal(JSON.stringify(a.actors),JSON.stringify(b.actors));assert.equal(JSON.stringify(a.food),JSON.stringify(b.food));
});

test('feast raises the food cap and star share; power-ups join the spawn cycle only when enabled',()=>{
  const feast=new S.Game(seeded(5),{modifiers:['feast']});assert.equal(feast.foodLimit,S.FEAST_LIMIT);assert.equal(feast.food.length,S.FEAST_LIMIT);
  assert.ok(feast.cycle.filter(t=>t==='star').length/feast.cycle.length>1/8);
  const power=new S.Game(seeded(5),{modifiers:['powerups']});assert.ok(power.cycle.includes('blade')&&power.cycle.includes('ink'));
  assert.ok(!new S.Game(seeded(5)).cycle.some(t=>S.FOODS[t].power));
  power.food=[];for(let i=0;i<30;i++)power.addFood();assert.equal(power.food.length,S.FOOD_LIMIT);
  assert.ok(power.food.some(f=>f.type==='blade')&&power.food.some(f=>f.type==='ink'));
});

test('rookie AI is noisy and never boosts; standard AI draws no randomness for decisions',()=>{
  const g=fixtureWith({tier:0}),a=place(g,1,10,10,1,9);delete g.aiDirection;g.food=[{x:13,y:10,type:'star'}];
  assert.equal(g.aiBoost(a),false);
  let calls=0;g.random=()=>{calls++;return .5;};g.aiDirection(a);assert.equal(calls,3,'one noise sample per legal move');
  const h=fixtureWith({}),b=place(h,1,10,10,1,9);delete h.aiDirection;h.food=[{x:13,y:10,type:'star'}];assert.equal(h.aiBoost(b),true);
  h.random=()=>{throw new Error('standard tier must not draw randomness');};h.aiDirection(b);
});

test('master AI with 1.5x mass presses the head-on cell that standard AI avoids, then wins it',()=>{
  const setup=tier=>{const g=fixtureWith({tier});delete g.aiDirection;place(g,0,2,20,1,4);
    const big=place(g,1,15,10,1,12),small=place(g,2,17,10,3,4);return{g,big,small};};
  const std=setup(1);assert.notEqual(std.g.aiDirection(std.big),1,'standard steps aside');
  const master=setup(3);assert.equal(master.g.aiDirection(master.big),1,'master presses the contest');
  master.g.aiDirection=a=>a.id===1?1:a.dir;master.g.step();
  assert.equal(master.big.alive,true);assert.equal(master.small.alive,false);assert.equal(master.big.stats.captures,1);
});

test('lookahead tiers flood-fill as if rival heads already took their next cells',()=>{
  for(const [tier,expect] of [[1,false],[2,true],[3,true]]){
    const g=fixtureWith({tier});delete g.aiDirection;const a=place(g,1,10,10,1,4);place(g,2,14,10,3,4);
    let seen=null;const orig=g.explore.bind(g);g.explore=(s,b)=>{seen=b;return orig(s,b);};g.aiDirection(a);
    for(const p of [{x:14,y:9},{x:14,y:11},{x:13,y:10}])assert.equal(seen.has(S.key(p)),expect,`tier ${tier}`);
    assert.equal(seen.has(S.key({x:15,y:10})),true,'real bodies stay blocked');
  }
});

test('blade lets a head sever a rival body: segments after the cut become fruit and the blade is spent',()=>{
  const g=fixtureWith({modifiers:['powerups']}),me=place(g,0,8,10,1),ai=place(g,1,9,7,0,8);me.blade=10;
  g.step();
  assert.equal(me.alive,true);assert.deepEqual(json(me.body[0]),{x:9,y:10});assert.equal(me.blade,0);assert.equal(me.score,S.CUT_SCORE);assert.equal(me.stats.cuts,1);
  assert.equal(ai.alive,true);assert.equal(ai.targetLength,3);assert.deepEqual(json(ai.body),[{x:9,y:6},{x:9,y:7},{x:9,y:8}]);
  assert.deepEqual(g.food.map(f=>f.type+f.x+','+f.y).sort(),['fruit9,11','fruit9,12','fruit9,13','fruit9,14']);
  const cut=g.events.find(e=>e.type==='cut');assert.equal(cut.victim,1);assert.equal(cut.lost,5);
  // Without a blade the same move is a crash.
  const h=fixtureWith({}),you=place(h,0,8,10,1);place(h,1,9,7,0,8);h.step();assert.equal(you.alive,false);assert.equal(h.result.outcome,'out');
  // A cut that leaves fewer than 3 segments knocks the rival out.
  const k=fixtureWith({}),p=place(k,0,8,8,1),v=place(k,1,9,7,0,8);p.blade=5;k.step();assert.equal(v.alive,false);assert.equal(v.body.length,0);assert.equal(p.alive,true);
  // A blade never cuts through a head: head swaps still collide.
  const j=fixtureWith({}),q=place(j,0,9,10,1),r=place(j,1,10,10,3);q.blade=5;j.step();assert.equal(q.alive,false);assert.equal(r.alive,false);
});

test('blade expires after its duration and AI with a blade aims at rival bodies',()=>{
  const g=fixtureWith({}),a=place(g,0,2,2,1);g.eat(a,{type:'blade'});assert.equal(a.blade,S.BLADE_TICKS);
  for(let i=0;i<S.BLADE_TICKS;i++){g.setDirection([1,2,3,0,1][Math.floor(i/10)]);g.step();if(i===S.BLADE_TICKS-2)assert.equal(a.blade,1);}
  assert.equal(a.alive,true);assert.equal(a.blade,0);
  const h=fixtureWith({});delete h.aiDirection;const ai=place(h,1,8,10,1,4);place(h,0,9,7,0,8);
  ai.blade=10;assert.equal(h.aiDirection(ai),1,'blade AI drives into the body crossing its path');assert.equal(ai.reason,'斷尾刃斬擊');
  ai.blade=0;assert.notEqual(h.aiDirection(ai),1);
});

test('ink burst shrinks nearby rivals, is stopped by shields and turns lost segments into fruit',()=>{
  const g=fixtureWith({modifiers:['powerups']}),me=place(g,0,10,10,1);
  const near=place(g,1,13,12,1,8),far=place(g,2,22,22,1,6),guarded=place(g,3,11,14,1,6);guarded.shield=10;
  g.food=[{x:11,y:10,type:'ink'}];g.step();
  assert.equal(near.targetLength,5);assert.equal(near.body.length,5);assert.equal(far.targetLength,6);
  assert.equal(guarded.shield,0);assert.equal(guarded.targetLength,6);
  assert.equal(me.score,S.FOODS.ink.score+S.INK_SCORE);assert.equal(me.stats.inks,1);
  const ink=g.events.find(e=>e.type==='ink');assert.deepEqual(json(ink.hits),[1]);
  assert.equal(g.food.filter(f=>f.type==='fruit').length,3);
  const floor=fixtureWith({}),you=place(floor,0,10,10,1),tiny=place(floor,1,12,12,1,3);floor.food=[{x:11,y:10,type:'ink'}];floor.step();
  assert.equal(tiny.targetLength,3,'mass never drops below 3');assert.equal(you.stats.inks,1);
});

test('venom drops poison from a boosting tail instead of fruit',()=>{
  const g=fixtureWith({modifiers:['venom']}),a=place(g,0,10,10,1,8);g.tick=1;g.step({boost:true});
  assert.equal(a.targetLength,7);assert.deepEqual(g.food.map(f=>f.type),['poison']);assert.equal(a.stats.boosts,1);
});

test('shrink warns, then seals the outer ring: heads there are crushed and bodies break off',()=>{
  const g=fixtureWith({modifiers:['shrink']});
  const me=place(g,0,12,12,1),crushed=place(g,1,0,5,2,4),broken=place(g,2,4,2,1,6);
  broken.body=[{x:4,y:2},{x:3,y:2},{x:2,y:2},{x:2,y:1},{x:2,y:0},{x:3,y:0}];
  g.food=[{x:0,y:20,type:'star'},{x:5,y:5,type:'fruit'}];
  g.tick=S.SHRINK_START-S.SHRINK_WARN-1;assert.equal(g.shrinkWarning(),-1);
  g.tick=S.SHRINK_START-S.SHRINK_WARN;assert.equal(g.shrinkWarning(),0);
  g.tick=S.SHRINK_START-1;g.step();
  assert.equal(g.closed,1);assert.equal(g.shrinkAt,S.SHRINK_START+S.SHRINK_EVERY);assert.equal(g.obstacles.length,S.SIZE*4-4);
  assert.equal(crushed.alive,false);assert.equal(g.events.find(e=>e.type==='death').cause,'crush');
  assert.equal(broken.alive,true);assert.deepEqual(json(broken.body),[{x:5,y:2},{x:4,y:2},{x:3,y:2},{x:2,y:2},{x:2,y:1}]);assert.equal(broken.targetLength,5);
  assert.equal(me.alive,true);assert.deepEqual(g.food.map(f=>f.x+','+f.y),['5,5']);
  assert.equal(g.safeSpawn({dir:1,left:1,body:[{x:5,y:1},{x:4,y:1},{x:3,y:1},{x:2,y:1}]}),false,'no spawning beside the sealed ring');
  // The player caught on the closing ring ends the match.
  const h=fixtureWith({modifiers:['shrink']});place(h,0,0,9,2,4);h.tick=S.SHRINK_START-1;h.step();assert.equal(h.phase,'over');assert.equal(h.result.outcome,'out');
  // Without the modifier nothing ever closes; with it, closing stops after SHRINK_LAYERS rings.
  const off=fixtureWith({});place(off,0,14,12,1);off.tick=S.SHRINK_START-1;off.step();assert.equal(off.closed,0);assert.equal(off.shrinkWarning(),-1);
  const k=fixtureWith({modifiers:['shrink']});place(k,0,14,12,1);k.closed=S.SHRINK_LAYERS;k.shrinkAt=1;k.tick=5;k.step();assert.equal(k.closed,S.SHRINK_LAYERS);assert.equal(k.shrinkWarning(),-1);
});

test('results always carry standings, place and outcome, including an early knockout',()=>{
  const g=fixtureWith({}),a=place(g,0,0,10,3);a.score=40;place(g,1,20,20,1,6).score=10;g.step();
  assert.equal(g.result.outcome,'out');assert.equal(g.result.score,40);assert.ok(Array.isArray(g.result.ranks));
  assert.equal(g.result.place,2,'a knocked-out player keeps food score but loses mass');
  const h=fixtureWith({}),b=place(h,0,10,10,1);place(h,1,20,20,1,9).score=50;h.tick=S.MATCH_TICKS-1;h.step();
  assert.equal(h.result.outcome,'loss');assert.equal(h.result.place,2);
});

test('seeded matches with every modifier and tier keep invariants and replay deterministically',()=>{
  const kinds=new Set();
  for(const tier of [0,1,2,3])for(let seed=1;seed<=3;seed++){
    const opts={tier,modifiers:['powerups','feast','venom','shrink']};
    const g=new S.Game(seeded(seed*7+tier),opts),r=new S.Game(seeded(seed*7+tier),opts);g.start();r.start();
    for(let n=0;n<600&&g.phase==='running';n++){
      g.setDirection(g.aiDirection(g.actors[0]));r.setDirection(r.aiDirection(r.actors[0]));
      if(g.actors[0].shield<2){g.actors[0].shield=5;r.actors[0].shield=5;}
      g.step({boost:n%11<4});r.step({boost:n%11<4});looseInvariants(g);for(const e of g.events)kinds.add(e.type);
    }
    assert.equal(g.phase,'over');assert.equal(JSON.stringify(g),JSON.stringify(r));
  }
  for(const k of ['food','boost','shrink','death','spawn'])assert.ok(kinds.has(k),'saw '+k);
  assert.ok(kinds.has('cut')||kinds.has('ink'),'power-ups get used in real matches');
});

test('career levels, ranks and unlock thresholds',()=>{
  assert.deepEqual(json(C.levelOf(0)),{level:1,into:0,need:C.need(1),max:false});
  assert.equal(C.levelOf(C.need(1)-1).level,1);assert.equal(C.levelOf(C.need(1)).level,2);assert.equal(C.levelOf(C.need(1)+C.need(2)).level,3);
  assert.equal(C.levelOf(-50).level,1);assert.equal(C.levelOf('junk').level,1);assert.equal(C.levelOf(1e9).level,C.MAX_LEVEL);assert.equal(C.levelOf(1e9).max,true);
  assert.equal(C.rankOf(1),'幼蛇');assert.equal(C.rankOf(4),'游蛇');assert.equal(C.rankOf(30),'墨龍');
  assert.ok(C.unlocked(1,'tier',1)&&C.unlocked(1,'tier',0));assert.ok(!C.unlocked(3,'tier',2)&&C.unlocked(4,'tier',2));
  assert.ok(!C.unlocked(1,'mod','powerups')&&C.unlocked(2,'mod','powerups'));assert.equal(C.unlockLevel('mod','shrink'),7);assert.equal(C.unlockLevel('tier',3),9);
  assert.equal(C.unlockLevel('mod','nothing'),Infinity);
  for(const id of S.MODIFIER_IDS)assert.ok(Number.isFinite(C.unlockLevel('mod',id)));
  for(let i=0;i<S.TIERS.length;i++){assert.ok(Number.isFinite(C.unlockLevel('tier',i)));assert.equal(C.TIER_XP[i],S.TIERS[i].xp);}
});

test('career XP rewards placement, play and challenges, scaled by tier and modifiers',()=>{
  const win=C.matchXP({outcome:'win',place:1,score:240,mass:12,captures:2,cuts:1,inks:3,tier:1,mods:0,challenge:true});
  assert.deepEqual(json(win.lines),[['跑完 90 秒',30],['食物分',24],['存活質量 12',24],['迎頭壓勝 × 2',50],['斷尾 × 1',20],['墨爆命中 × 3',24],['第一名',120],['本局挑戰',40]]);
  assert.equal(win.base,332);assert.equal(win.total,332);
  const hard=C.matchXP({outcome:'win',place:1,score:240,mass:12,captures:2,cuts:1,inks:3,tier:3,mods:2,challenge:true});assert.equal(hard.mult,1.7*1.2);assert.equal(hard.total,Math.round(332*1.7*1.2));
  const out=C.matchXP({outcome:'out',place:2,score:900,mass:20,ticks:S.MATCH_TICKS/2,tier:0,mods:0});
  assert.deepEqual(json(out.lines),[['存活時間',10],['食物分',60]]);assert.equal(out.total,Math.round(70*.6));
  assert.equal(C.matchXP({outcome:'loss',place:3,score:0,mass:0,tier:1}).total,50);
});

test('career record, sanitize, storage and rotating challenges',()=>{
  const r=C.record(C.blank(),{outcome:'win',place:1,score:300,mass:15,peak:18,captures:1,cuts:2,inks:0,tier:2,mods:1,challenge:true});
  assert.equal(r.profile.matches,1);assert.equal(r.profile.wins,1);assert.equal(r.profile.best,300);assert.equal(r.profile.bestMass,18);assert.equal(r.profile.cuts,2);assert.equal(r.profile.challenges,1);assert.equal(r.profile.bestTier,2);
  assert.equal(r.profile.xp,r.gain.total);assert.ok(r.after.level>r.before.level);assert.ok(r.unlocked.some(u=>u.kind==='mod'&&u.id==='powerups'));
  const lost=C.record(r.profile,{outcome:'out',place:4,score:10,ticks:100,tier:3,mods:0});assert.equal(lost.profile.wins,1);assert.equal(lost.profile.bestTier,2);assert.equal(lost.profile.best,300);
  assert.deepEqual(json(C.sanitize({xp:-5,matches:'x',wins:2.7,bestTier:-9,evil:1})),{...json(C.blank()),wins:2});
  const mem=new Map(),storage={getItem:k=>mem.has(k)?mem.get(k):null,setItem:(k,v)=>mem.set(k,v)};
  assert.deepEqual(json(C.load(storage)),json(C.blank()));assert.equal(C.save(storage,r.profile),true);assert.deepEqual(json(C.load(storage)),json(r.profile));
  mem.set(C.KEY,'{broken');assert.deepEqual(json(C.load(storage)),json(C.blank()));
  assert.equal(C.save({setItem(){throw new Error('full');}},r.profile),false);
  const ids=C.CHALLENGES.map(c=>c.id);assert.equal(new Set(ids).size,ids.length);
  for(let i=0;i<ids.length*2;i++)assert.equal(C.challengeFor(i).id,ids[i%ids.length]);
  assert.equal(C.challengeFor(-1).id,ids[ids.length-1]);assert.equal(C.challengeFor(NaN).id,ids[0]);
  const by=id=>C.CHALLENGES.find(c=>c.id===id);
  assert.ok(by('stars').check({stars:3})&&!by('stars').check({stars:2}));
  assert.ok(by('peak').check({peak:16})&&!by('peak').check({peak:15}));
  assert.ok(by('survive').check({outcome:'loss'})&&!by('survive').check({outcome:'out'}));
  assert.ok(by('top2').check({outcome:'win',place:1})&&!by('top2').check({outcome:'out',place:1})&&!by('top2').check({outcome:'loss',place:3}));
  assert.ok(by('capture').check({captures:1})&&by('boost').check({boosts:8})&&!by('boost').check({boosts:7}));
});

test('page is a full-screen Vermilion Ink stage with local three.js and no network',()=>{
  assert.match(html,/<link rel="stylesheet" href="shared\/fu\.css">/);assert.match(html,/<body class="fu-app">/);
  assert.doesNotMatch(html,/fulab-theme\.css|play-panel|<details class="card rules"|site-nav|page-header/);
  assert.match(html,/class="fu-seal"[^>]*>福遊</);assert.match(html,/href="index\.html"/);
  assert.match(html,/<main class="fu-stage"[^>]*><canvas id="board"/);assert.match(html,/class="fu-drawer"/);
  assert.match(html,/from '\.\/shared\/fu-three\.js'/);assert.doesNotMatch(html,/https?:\/\//);assert.doesNotMatch(html,/\bfetch\(/);
  for(const id of ['play','resume','again','pause','boost','overlay','tier-picks','mod-picks','drawer','roster','clock','status'])assert.match(html,new RegExp(`id="${id}"`),id);
  for(const d of ['up','down','left','right'])assert.match(html,new RegExp(`data-direction="${d}"`));
});
