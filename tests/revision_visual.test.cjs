'use strict';
// Independent integration contract. Geometry and effective SVG styles are also
// checked by revision_browser.py in Chromium, including dynamically rendered UI.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const GAMES = ['autohex','cyclic_tictactoe','cyclic_connect4_torus','trackgame','card_hex',
  'gravity_brawl','flip_five','effect_snake','duplicate_bridge','blackjack',
  'tank_arena','pulse_arena','territory_loop','star_feast'];
const CONTROLS = ['arrow-up','arrow-down','arrow-left','arrow-right','launch','play',
  'pause','restart','rotate','undo','hint','shield','turret','trap','double','remove',
  'bridge','suit-club','suit-diamond','suit-heart','suit-spade','fruit','star','poison','slow'];
const read = name => fs.readFileSync(path.join(ROOT,name), 'utf8');
const attrs = text => Object.fromEntries([...text.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(m=>[m[1],m[2]]));
const svg = () => read('icons.svg');
const symbols = () => [...svg().matchAll(/<symbol\b([^>]*)>([\s\S]*?)<\/symbol>/g)].map(m=>({attributes:attrs(m[1]),body:m[2]}));

test('shared native SVG sprite defines every catalogue and agreed control symbol exactly once',()=>{
  const entries=symbols(),ids=entries.map(s=>s.attributes.id);
  assert.ok(entries.length>=GAMES.length+CONTROLS.length);
  assert.equal(new Set(ids).size,ids.length,'duplicate symbol IDs');
  for(const id of [...GAMES,...CONTROLS])assert.ok(ids.includes(id),`missing ${id}`);
  for(const {attributes:a,body} of entries){
    assert.match(a.id,/^[a-z][a-z0-9_-]*$/);
    assert.equal(a.viewBox,'0 0 48 48',a.id+' viewBox');
    assert.match(body,/<(?:path|circle|ellipse|rect|line|polygon|polyline)\b/,a.id+' has no native geometry');
  }
});

test('sprite is entirely local vector geometry with no font, raster or executable assets',()=>{
  const source=svg();
  assert.doesNotMatch(source,/<(?:text|image|foreignObject|script|iframe)\b/i);
  assert.doesNotMatch(source,/@font-face|font-family|https?:\/\/[^"']+\.(?:png|jpe?g|webp|svg)|data:image\//i);
  assert.doesNotMatch(source,/\bon[a-z]+\s*=/i);
  for(const m of source.matchAll(/\b(?:href|xlink:href)\s*=\s*["']([^"']+)["']/g))assert.match(m[1],/^#[a-z][a-z0-9_-]*$/,`external sprite dependency ${m[1]}`);
});

test('homepage has exactly fourteen valid game links and uses each matching shared icon',()=>{
  const source=read('index.html');
  const articles=[...source.matchAll(/<article\b[^>]*class=["'][^"']*\bgame-card\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/g)];
  assert.equal(articles.length,GAMES.length);
  const linked=[];
  for(const [,article] of articles){
    const target=article.match(/href=["']([a-z0-9_]+)\.html["']/)?.[1];
    assert.ok(GAMES.includes(target),`unexpected game ${target}`);linked.push(target);
    assert.match(article,new RegExp(`<use\\b[^>]*href=["']icons\\.svg#${target}["']`),`${target} icon identity`);
    assert.match(article,/<svg\b[^>]*class=["'][^"']*\bgame-icon\b/);
  }
  assert.equal(new Set(linked).size,GAMES.length);
});

for(const name of GAMES)test(`${name}: shared shell, accessible native header icon and local symbol references`,()=>{
  const source=read(name+'.html');
  assert.match(source,/<link\b[^>]*href=["']fulab-theme\.css["']/);
  assert.match(source,/<nav\b[^>]*class=["'][^"']*\bsite-nav\b/);
  assert.match(source,/<details\b[^>]*class=["'][^"']*\brules\b/);
  const header=source.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1];assert.ok(header,'missing heading');
  const icon=header.match(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/);assert.ok(icon,'heading must contain actual SVG');
  const a=attrs(icon[1]);assert.ok(a.class.split(/\s+/).includes('page-icon'));
  assert.equal(a.viewBox,'0 0 48 48');assert.equal(a['aria-hidden'],'true');
  assert.match(icon[2],new RegExp(`<use\\b[^>]*href=["']icons\\.svg#${name}["']`));
  const ids=new Set(symbols().map(s=>s.attributes.id));
  for(const m of source.matchAll(/<use\b[^>]*href=["']icons\.svg#([a-z][a-z0-9_-]*)["']/g))assert.ok(ids.has(m[1]),`${name} references undefined ${m[1]}`);
  assert.match(source,/class=["'][^"']*\bui-icon\b/,`${name} requires native control icons`);
});

test('shared CSS defines non-shrinking icon layout and geometric classic stones',()=>{
  const css=read('fulab-theme.css');
  for(const selector of ['.page-icon','.ui-icon','.classic-stone'])assert.ok(css.includes(selector),selector);
  assert.match(css,/\.ui-icon[^{}]*\{[^{}]*(?:flex-shrink\s*:\s*0|flex\s*:\s*(?:0\s+0\s+auto|none))/s);
  assert.match(css,/\.classic-stone[^{}]*\{[^{}]*border-radius\s*:\s*50%/s);
});

// Independent Hex audit: geometric fairness and privacy at the actual exported
// observation boundary. These checks do not send raw Game objects to the AI.
const vm = require('node:vm');
function hexEngine(){return vm.runInNewContext(read('card_hex.html').match(/<script id="hex-engine">([\s\S]*?)<\/script>/)[1]+';CardHex;');}
const json = value => JSON.parse(JSON.stringify(value));
const seeded = initial => {let seed=initial;return()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);};

test('independent Hex audit: all 91 cells, edges and connection costs preserve 120-degree rotation',()=>{
  const H=hexEngine(),rotate=i=>{const c=H.CELLS[i];return H.index(c.r,c.s);};
  assert.equal(H.COUNT,91);assert.equal(new Set(H.CELLS.map(c=>rotate(c.i))).size,91);
  for(const c of H.CELLS)assert.deepEqual(Array.from(H.ADJ[c.i],rotate).sort((a,b)=>a-b),Array.from(H.ADJ[rotate(c.i)]).sort((a,b)=>a-b));
  for(const edge of H.EDGES)for(const side of edge)assert.equal(side.length,6);
  for(const player of H.PLAYERS)assert.equal(H.shortest(Array(91).fill(0),player),11);
  const axes=[null,0,1,2],rotatedAxes=[null,1,2,0],random=seeded(137);
  for(let n=0;n<20;n++){
    const board=Array.from({length:91},()=>random()<.55?0:1+Math.floor(random()*3)),rotated=Array(91).fill(0);
    board.forEach((p,i)=>rotated[rotate(i)]=p);
    for(const p of H.PLAYERS)for(const breach of [Infinity,3])assert.equal(H.shortest(board,p,axes,[],breach),H.shortest(rotated,p,rotatedAxes,[],breach));
  }
});

test('independent Hex audit: every observer receives identical view/decision after all enemy secrets change',()=>{
  const H=hexEngine();
  for(const observer of H.PLAYERS)for(let seed=1;seed<=3;seed++){
    const g=new H.Game(seeded(seed*77));g.start();g.turn=observer;
    const enemies=H.PLAYERS.filter(p=>p!==observer),normal=H.index(3,-2),own=H.index(-3,1),secretA=H.index(0,0),secretB=H.index(2,0);
    g.hands[observer]=['double','remove','trap','turret'];
    g.decks[observer]=Array.from(H.DECK);for(const card of g.hands[observer])g.decks[observer].splice(g.decks[observer].indexOf(card),1);
    g.board[normal]=enemies[0];g.traps=[{owner:observer,cell:own},{owner:enemies[0],cell:secretA},{owner:enemies[1],cell:secretB}];
    g.trapDeployments=[null,1,1,1];g.last={player:enemies[0],type:'trap',cells:[normal,secretA],reason:'公開部署暗伏'};
    const before=g.observation(observer),choice=H.chooseAction(before);
    assert.deepEqual(json(before.ownTraps),[{owner:observer,cell:own}]);
    assert.deepEqual(json(before.last.cells),[normal]);
    for(const key of ['traps','hands','decks','seeds','random'])assert.ok(!(key in before),key+' must not cross the AI boundary');
    g.traps[1].cell=H.index(-1,3);g.traps[2].cell=H.index(1,-3);g.last.cells[1]=g.traps[1].cell;
    for(const enemy of enemies){const count=g.hands[enemy].length,hidden=[...g.hands[enemy],...g.decks[enemy]].reverse();g.hands[enemy]=hidden.slice(0,count);g.decks[enemy]=hidden.slice(count);g.seeds[enemy]+=123456;assert.deepEqual([...g.hands[enemy],...g.decks[enemy]].sort(),Array.from(H.DECK).sort());}
    const after=g.observation(observer);
    assert.deepEqual(json(after),json(before),`observer ${observer}, seed ${seed}`);
    assert.deepEqual(json(H.chooseAction(after)),json(choice),`decision changed for observer ${observer}`);
  }
});

test('independent Hex audit: equal finite supply, one shield each, and all first seats rotate fairly',()=>{
  const H=hexEngine();
  for(const first of H.PLAYERS){
    const g=new H.Game(seeded(40+first),'builder',first);
    for(const p of H.PLAYERS){assert.equal(g.hands[p].length,2);assert.equal(g.decks[p].length,11);assert.deepEqual([...g.hands[p],...g.decks[p]].sort(),Array.from(H.DECK).sort());assert.equal([...g.hands[p],...g.decks[p]].filter(c=>c==='shield').length,1);}
    g.start();const turns=[];
    for(let n=0;n<6;n++){turns.push(g.turn);assert.ok(g.act({type:'place',cells:[H.index(-5+n,-Math.min(0,-5+n))]}));}
    assert.deepEqual(turns,[first,first%3+1,(first+1)%3+1,first,first%3+1,(first+1)%3+1]);
    assert.equal(g.ply,6);assert.equal(g.turn,first);
  }
  assert.equal(H.LIMIT%3,0,'turn cap must end after equal complete rotations');
});
