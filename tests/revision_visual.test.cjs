'use strict';
// Independent integration contract. Geometry and effective SVG styles are also
// checked by revision_browser.py in Chromium, including dynamically rendered UI.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const GAMES = ['tux2d','autohex','cyclic_tictactoe','cyclic_connect4_torus','trackgame','card_hex',
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

test('homepage has exactly fifteen valid game links and uses each matching shared icon',()=>{
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

// Independent current shared-Hex audit. The released91-cell personal-shoe,
// secret-trap mechanics remain covered by explicitly historical test suites.
const SharedHex = require('../hex-core.js');
const json = value => JSON.parse(JSON.stringify(value));

test('independent shared Hex audit: 271 cells, adjacency and directed goals preserve rotation',()=>{
  const H=SharedHex.create({mode:'normal',playerCount:3}),g=new H.Game({seed:'audit-symmetry'});
  const rotate=i=>{const c=H.CELLS[i];return H.index(c.r,c.s);};
  assert.equal(H.COUNT,271);assert.equal(new Set(H.CELLS.map(c=>rotate(c.i))).size,271);
  for(const c of H.CELLS)assert.deepEqual(H.ADJ[c.i].map(rotate).sort((a,b)=>a-b),[...H.ADJ[rotate(c.i)]].sort((a,b)=>a-b));
  for(const p of H.PLAYERS){
    const other=H.PLAYERS.find(q=>g.players[q].home===rotate(g.players[p].home));assert.ok(other);
    const goals=H.CELLS.filter(c=>H.goalCell(g,p,c.i)).map(c=>rotate(c.i)).sort((a,b)=>a-b);
    assert.deepEqual(goals,H.CELLS.filter(c=>H.goalCell(g,other,c.i)).map(c=>c.i).sort((a,b)=>a-b));
    assert.equal(goals.length,10);
    for(const c of H.CELLS)assert.equal(H.distance(g.players[p].home,c.i),H.distance(g.players[other].home,rotate(c.i)));
  }
});

test('independent shared Hex audit: every active observer ignores other hands, deck order and private plans',()=>{
  for(const count of [2,3,4,5,6]){
    const H=SharedHex.create({mode:'normal',playerCount:count}),g=new H.Game({seed:'audit-private-'+count});g.start();
    for(const observer of H.PLAYERS){
      g.turn=observer;const before=g.observation(observer),choice=H.chooseAction(before);
      for(const key of ['hands','drawPile','discardPile','plannerStates','_random'])assert.equal(key in before,false,key);
      for(const p of H.PLAYERS)if(p!==observer){g.hands[p]=g.hands[p].map((_,i)=>i%2?'destroy':'shield');g.plannerStates[p]=null;}
      g.drawPile.reverse();g.discardPile.reverse();const after=g.observation(observer);
      assert.deepEqual(json(after),json(before));assert.deepEqual(json(H.chooseAction(after)),json(choice));
    }
  }
});

test('independent shared Hex audit: one finite common shoe, equal draws and all starting seats',()=>{
  for(const count of [2,3,4,5,6]){
    const H=SharedHex.create({mode:'normal',playerCount:count});
    for(const first of H.PLAYERS){
      const g=new H.Game({seed:'audit-finite-'+count,first});
      assert.equal(g.deckRecipe.length,13);assert.equal(g.deckRecipe.filter(c=>c==='shield').length,1);
      const physical=()=>[...g.drawPile,...g.discardPile,...g.hands.flat()].sort();const initial=physical();
      assert.equal(initial.length,count*13);assert.equal(initial.filter(c=>c==='shield').length,count);
      assert.equal(new Set(H.PLAYERS.map(p=>g.hands[p].length)).size,1);g.start();const turns=[];
      for(let n=0;n<count*2;n++){turns.push(g.turn);assert.ok(g.act({type:'rest',cells:[]}));assert.deepEqual(physical(),initial);}
      assert.deepEqual(turns,Array.from({length:count*2},(_,i)=>(first-1+i)%count+1));
      assert.equal(g.turn,first);assert.equal(new Set(H.PLAYERS.map(p=>g.hands[p].length)).size,1);assert.equal(H.TURN_LIMIT%count,0);
    }
  }
});
