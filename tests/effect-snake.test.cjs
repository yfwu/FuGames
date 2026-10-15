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
