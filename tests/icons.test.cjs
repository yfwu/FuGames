'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'icons.svg'), 'utf8');
const home = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const games = ['tux2d','autohex','card_hex','gravity_brawl','flip_five','effect_snake','duplicate_bridge','rummikub','blackjack','tank_arena','pulse_arena','star_feast','territory_loop','lane_duel','cyclic_tictactoe','cyclic_connect4_torus','trackgame'];
const actions = ['arrow-up','arrow-down','arrow-left','arrow-right','launch','play','pause','restart','rotate','undo','hint','shield','turret','trap','double','remove','bridge','suit-club','suit-diamond','suit-heart','suit-spade','fruit','star','poison','slow'];
const attrs = s => Object.fromEntries([...s.matchAll(/([\w:-]+)="([^"]*)"/g)].map(m => [m[1],m[2]]));
const icons = new Map([...svg.matchAll(/<symbol\s+([^>]+)>([\s\S]*?)<\/symbol>/g)].map(m=>{const a=attrs(m[1]);return[a.id,{attrs:a,body:m[2]}];}));

// Sample the actual SVG commands. Cubics are sampled at 1/240 intervals; the
// safe-area epsilon is much smaller than one raster pixel even at 4x size.
function pathPoints(d) {
 const tokens=d.match(/[A-Za-z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi)||[];
 const out=[];let i=0,cmd='',x=0,y=0,sx=0,sy=0;
 const n=()=>{assert.ok(i<tokens.length&&!/[a-df-z]/i.test(tokens[i]),'missing path argument');return Number(tokens[i++]);};
 const segment=(end,fn,steps=240)=>{for(let k=0;k<=steps;k++)out.push(fn(k/steps));[x,y]=end;};
 while(i<tokens.length){
  if(/^[A-Za-z]$/.test(tokens[i]))cmd=tokens[i++];
  assert.ok(['M','L','H','V','C','Q','Z'].includes(cmd),'unsupported path command '+cmd);
  if(cmd==='Z'){const ax=x,ay=y;segment([sx,sy],t=>[ax+(sx-ax)*t,ay+(sy-ay)*t]);cmd='';continue;}
  if(cmd==='M'){x=n();y=n();sx=x;sy=y;out.push([x,y]);cmd='L';continue;}
  const ax=x,ay=y;
  if(cmd==='L'){const bx=n(),by=n();segment([bx,by],t=>[ax+(bx-ax)*t,ay+(by-ay)*t]);}
  else if(cmd==='H'){const bx=n();segment([bx,y],t=>[ax+(bx-ax)*t,ay]);}
  else if(cmd==='V'){const by=n();segment([x,by],t=>[ax,ay+(by-ay)*t]);}
  else if(cmd==='Q'){const cx=n(),cy=n(),bx=n(),by=n();segment([bx,by],t=>{const u=1-t;return[u*u*ax+2*u*t*cx+t*t*bx,u*u*ay+2*u*t*cy+t*t*by];});}
  else if(cmd==='C'){const cx=n(),cy=n(),dx=n(),dy=n(),bx=n(),by=n();segment([bx,by],t=>{const u=1-t;return[u*u*u*ax+3*u*u*t*cx+3*u*t*t*dx+t*t*t*bx,u*u*u*ay+3*u*u*t*cy+3*u*t*t*dy+t*t*t*by];});}
 }
 return out;
}
function geometry(icon) {
 const elements=[...icon.body.matchAll(/<(path|circle|rect)\s+([^>]+)\/>/g)];
 assert.ok(elements.length,'geometry exists');
 return elements.map(([,type,s])=>{
  const a=attrs(s),v=k=>Number(a[k]||0);let points=[];
  if(type==='path')points=pathPoints(a.d);
  if(type==='circle')for(let i=0;i<720;i++){const t=i*Math.PI/360;points.push([v('cx')+Math.cos(t)*v('r'),v('cy')+Math.sin(t)*v('r')]);}
  if(type==='rect'){
   const x=v('x'),y=v('y'),w=v('width'),h=v('height'),r=Math.min(v('rx'),w/2,h/2);
   assert.ok(w>0&&h>0);
   points=pathPoints(`M${x+r} ${y}H${x+w-r}Q${x+w} ${y} ${x+w} ${y+r}V${y+h-r}Q${x+w} ${y+h} ${x+w-r} ${y+h}H${x+r}Q${x} ${y+h} ${x} ${y+h-r}V${y+r}Q${x} ${y} ${x+r} ${y}Z`);
  }
  const pad=a.stroke==='none'?0:Number(a['stroke-width']||icon.attrs['stroke-width'])/2;
  return{points,pad,attrs:a,type};
 });
}
const shapes = new Map([...icons].map(([id,icon])=>[id,geometry(icon)]));
function bounds(id){const all=shapes.get(id);return{left:Math.min(...all.flatMap(s=>s.points.map(p=>p[0]-s.pad))),right:Math.max(...all.flatMap(s=>s.points.map(p=>p[0]+s.pad))),top:Math.min(...all.flatMap(s=>s.points.map(p=>p[1]-s.pad))),bottom:Math.max(...all.flatMap(s=>s.points.map(p=>p[1]+s.pad)))};}
function cloud(id){return shapes.get(id).flatMap(s=>s.points);}
function equivalentCloud(id,transform,other=id){
 const target=cloud(other),bins=new Map(),q=.15;
 for(const [x,y]of target){const key=Math.floor(x/q)+','+Math.floor(y/q);if(!bins.has(key))bins.set(key,[]);bins.get(key).push([x,y]);}
 for(const p of cloud(id)){
  const [x,y]=transform(p),bx=Math.floor(x/q),by=Math.floor(y/q);let near=false;
  for(let dx=-1;dx<=1&&!near;dx++)for(let dy=-1;dy<=1&&!near;dy++)for(const t of bins.get((bx+dx)+','+(by+dy))||[])if(Math.hypot(x-t[0],y-t[1])<.15){near=true;break;}
  assert.ok(near,`${id} loses symmetry at (${x.toFixed(3)},${y.toFixed(3)}) vs ${other}`);
 }
}

test('the shared collection has the exact 17 game and 25 action IDs with a uniform native SVG contract',()=>{
 assert.equal(icons.size,42);assert.equal([...svg.matchAll(/<symbol /g)].length,42);
 assert.deepEqual([...icons.keys()].sort(),[...games,...actions].sort());
 assert.doesNotMatch(svg,/<(?:text|image|foreignObject|script|use)\b|\btransform=|font-|data:|https?:\/\/(?!www\.w3\.org\/2000\/svg)/i);
 for(const [id,{attrs:a}]of icons){assert.equal(a.viewBox,'0 0 48 48',id);assert.equal(a.stroke,'currentColor',id);assert.equal(a['stroke-width'],'2',id);assert.equal(a['stroke-linecap'],'round',id);assert.equal(a['stroke-linejoin'],'round',id);assert.equal(a.fill,'none',id);}
});

test('all painted geometry including stroke stays at least 6 px inside the 48 px square',()=>{
 for(const id of icons.keys()){
  const b=bounds(id);assert.ok(b.left>=6-1e-5&&b.top>=6-1e-5&&b.right<=42+1e-5&&b.bottom<=42+1e-5,`${id}: ${JSON.stringify(b)}`);
  assert.ok(b.right-b.left>=16&&b.bottom-b.top>=16,`${id}: an accidentally tiny icon`);
  const [cx,cy]=[(b.left+b.right)/2,(b.top+b.bottom)/2];
  // The play triangle is optically centered by its drawn outline, not its tip.
  if(id!=='play')assert.ok(Math.abs(cx-24)<=2&&Math.abs(cy-24)<=3,`${id}: unbalanced footprint ${cx},${cy}`);
  for(const s of shapes.get(id))for(const [x,y]of s.points)assert.ok(Number.isFinite(x)&&Number.isFinite(y),id);
 }
});

test('mirror-symmetric tokens and gameplay shapes preserve their declared centerline',()=>{
 const vertical=['tux2d','tank_arena','pulse_arena','trackgame','arrow-up','arrow-down','pause','hint','shield','trap','double','remove','bridge','suit-club','suit-diamond','suit-heart','suit-spade','star','poison','slow'];
 for(const id of vertical)equivalentCloud(id,([x,y])=>[48-x,y]);
 for(const id of ['pulse_arena','trackgame','arrow-left','arrow-right','pause','remove','suit-diamond'])equivalentCloud(id,([x,y])=>[x,48-y]);
});

test('three-way Hex, four-seat bridge and cyclic game icons preserve rotational geometry',()=>{
 const rotate=angle=>([x,y])=>{x-=24;y-=24;return[24+x*Math.cos(angle)-y*Math.sin(angle),24+x*Math.sin(angle)+y*Math.cos(angle)];};
 equivalentCloud('card_hex',rotate(Math.PI*2/3));
 equivalentCloud('autohex',rotate(Math.PI/3));
 equivalentCloud('duplicate_bridge',rotate(Math.PI/2));
 for(const id of ['cyclic_tictactoe','cyclic_connect4_torus','flip_five','rotate'])equivalentCloud(id,rotate(Math.PI));
 equivalentCloud('arrow-up',rotate(Math.PI/2),'arrow-right');
 equivalentCloud('arrow-up',rotate(Math.PI),'arrow-down');
 equivalentCloud('arrow-up',rotate(-Math.PI/2),'arrow-left');
});

test('filled suit silhouettes remain distinct and use a consistent visible area instead of font glyphs',()=>{
 const suits=actions.filter(id=>id.startsWith('suit-'));
 assert.equal(new Set(suits.map(id=>icons.get(id).body)).size,4);
 for(const id of suits){const parts=shapes.get(id),b=bounds(id);assert.ok(parts.some(s=>s.attrs.fill==='currentColor'),id);assert.ok(b.right-b.left>=28&&b.bottom-b.top>=28,id);assert.doesNotMatch(icons.get(id).body,/<text|[♣♦♥♠]/);}
});

test('homepage maps every game to its own shared icon and keeps each accessible entry link',()=>{
 const cards=[...home.matchAll(/<article class="game-card">([\s\S]*?)<\/article>/g)];assert.equal(cards.length,17);
 const found=[];
 for(const [,card]of cards){
  const stem=card.match(/<a\b[^>]*href="([^"#]+)\.html"/)[1];found.push(stem);
  assert.match(card,new RegExp(`<svg class="game-icon[^>]+viewBox="0 0 48 48"[^>]+aria-hidden="true"><use href="icons\\.svg#${stem}">`));
  assert.match(card,/<a\b[^>]*aria-label="開始遊玩[^"<>]+"/);assert.ok(fs.existsSync(path.join(root,stem+'.html')));
  assert.match(card,/<use href="icons\.svg#launch">/);assert.doesNotMatch(card,/<path\b|<circle\b|<text\b|[↗▶↻]/);
 }
 assert.deepEqual(found.sort(),[...games].sort());
 const hex=cards.find(([,c])=>c.includes('href="card_hex.html"'))[1];assert.match(hex,/2–6 席本機玩家與 AI/);assert.match(hex,/271 格/);assert.match(hex,/短橋、彎曲地道與機場/);assert.match(hex,/AutoHex 共用規則/);assert.doesNotMatch(hex,/暗伏|91 格|單人 × 2 AI/);
});
