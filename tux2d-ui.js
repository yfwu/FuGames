/* Original canvas pixel art and chase camera; no external assets. */
(function(){
'use strict';
const E=window.Tux2D,$=id=>document.getElementById(id),canvas=$('tux-board'),ctx=canvas.getContext('2d'),mini=$('tux-minimap').getContext('2d');
const params=new URLSearchParams(location.search);if(params.has('seed'))$('tux-seed').value=params.get('seed').slice(0,40);
let game=new E.Game({seed:$('tux-seed').value}),keys=new Set(),touch=new Set(),pending=null,acc=0,last=0,lastHUD=0,lastEvent=-1,eventUntil=0,follow=0;
window.tux2dGame=game;
const palette={sky:'#79bdd5',snow:'#e3f0dd',grass:'#73ac99',road:'#516473',edge:'#e8dfc3'};
function quad(points,color){ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(Math.round(points[0][0]),Math.round(points[0][1]));for(let i=1;i<points.length;i++)ctx.lineTo(Math.round(points[i][0]),Math.round(points[i][1]));ctx.closePath();ctx.fill();}
function rect(x,y,w,h,c){ctx.fillStyle=c;ctx.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h));}
function pixelText(text,x,y,size,color,align='center'){ctx.font=`bold ${size}px ui-monospace,monospace`;ctx.textAlign=align;ctx.fillStyle=color;ctx.fillText(text,Math.round(x),Math.round(y));}
function project(z,x,r){const d=z-r.z,p=210/(210+Math.max(0,d)),w=canvas.width,h=canvas.height;return{x:w/2+((E.roadCenter(z)-E.roadCenter(r.z)-d*E.tangent(r.z))/440+x-r.x)*w*.48*p,y:h*.33+h*.56*p,scale:p,half:w*.48*p};}
function tree(x,y,s){quad([[x,y-s*1.4],[x-s*.5,y-s*.4],[x+s*.5,y-s*.4]],'#315c63');quad([[x,y-s],[x-s*.7,y],[x+s*.7,y]],'#3f7274');quad([[x,y-s*1.3],[x-s*.22,y-s*.85],[x+s*.21,y-s*.85]],'#e4edcf');rect(x-s*.09,y,s*.18,s*.22,'#55686d');}
function kart(x,y,s,color,shield=false,boost=false){
 if(s<3)return;ctx.save();ctx.translate(Math.round(x),Math.round(y));const u=s/40;ctx.scale(u,u);
 if(boost){quad([[-16,5],[-8,23],[0,7]],'#ffd166');quad([[16,5],[8,23],[0,7]],'#ffd166');rect(-9,7,18,8,'#fff3aa');}
 rect(-24,-2,48,7,'#233d48');rect(-26,-17,10,21,'#172e3b');rect(16,-17,10,21,'#172e3b');rect(-19,-21,38,24,color);rect(-22,-6,44,7,color);rect(-18,-20,36,4,'#d5e9d5');rect(-17,-2,8,4,'#fa9576');rect(9,-2,8,4,'#fa9576');rect(-10,0,20,4,'#1b3a45');
 // Penguin silhouette, orange feet and a mail sack make the original courier readable.
 rect(-10,-43,20,25,'#1b3441');rect(-14,-34,28,16,'#1b3441');rect(-10,-31,3,11,'#f3edd3');rect(7,-31,3,11,'#f3edd3');rect(-10,-27,20,4,'#ec9d66');rect(4,-25,4,9,'#ec9d66');rect(-9,-22,7,3,'#efac62');rect(2,-22,7,3,'#efac62');rect(11,-29,10,10,'#d3a164');rect(14,-27,4,5,'#eedaaf');
 if(shield){ctx.strokeStyle='#b4f7ed';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(0,-20,33,34,0,0,Math.PI*2);ctx.stroke();}ctx.restore();}
function draw(){const r=game.racers[follow],w=canvas.width,h=canvas.height;ctx.imageSmoothingEnabled=false;rect(0,0,w,h,palette.sky);
 const shift=E.tangent(r.z)*w*.09;
 rect(w*.77-shift,h*.075,37,28,'#f4e6b4');
 for(let i=0;i<5;i++){let x=((i*w*.27-shift*.3+w*2)%(w*1.3))-w*.15;rect(x,h*.13+(i%2)*13,50,8,'#d9ebe5');rect(x+12,h*.13-5+(i%2)*13,24,5,'#d9ebe5');}
 for(let i=-1;i<8;i++){let x=i*w*.19-shift;quad([[x-w*.13,h*.35],[x+w*.055,h*.13+(i%2)*h*.04],[x+w*.25,h*.35]],i%2?'#729bac':'#5f8ea3');quad([[x+w*.012,h*.2+(i%2)*h*.04],[x+w*.055,h*.13+(i%2)*h*.04],[x+w*.102,h*.2+(i%2)*h*.04],[x+w*.07,h*.186+(i%2)*h*.04]],'#d7e8df');}
 rect(0,h*.33,w,h*.67,palette.grass);
 const step=25,far=2500,base=Math.floor(r.z/step)*step;
 for(let i=far/step;i>=0;i--){const za=Math.max(r.z,base+i*step),zb=za+step,a=project(za,0,r),b=project(zb,0,r),stripe=Math.floor(za/100)%2,at=E.road(za);if(za===r.z){a.y=h;a.half*=1.2;}
 rect(0,Math.round(b.y),w,Math.round(a.y)-Math.round(b.y),stripe?'#7ead98':'#85b39b');
 quad([[b.x-b.half*1.12,b.y],[b.x+b.half*1.12,b.y],[a.x+a.half*1.12,a.y],[a.x-a.half*1.12,a.y]],stripe?'#e4ecd8':'#c6dccd');
 quad([[b.x-b.half*1.04,b.y],[b.x+b.half*1.04,b.y],[a.x+a.half*1.04,a.y],[a.x-a.half*1.04,a.y]],stripe?'#f1d5a0':'#607c81');
 quad([[b.x-b.half,b.y],[b.x+b.half,b.y],[a.x+a.half,a.y],[a.x-a.half,a.y]],stripe?'#536778':'#566b7b');
 if(at.fork){quad([[b.x-b.half*.15,b.y],[b.x+b.half*.15,b.y],[a.x+a.half*.15,a.y],[a.x-a.half*.15,a.y]],'#99c2a0');quad([[b.x+b.half*.18,b.y],[b.x+b.half*.99,b.y],[a.x+a.half*.99,a.y],[a.x+a.half*.18,a.y]],at.ice?(stripe?'#9dc4d0':'#a5ccd4'):'#718998');
 quad([[b.x-b.half*.94,b.y],[b.x-b.half*.87,b.y],[a.x-a.half*.87,a.y],[a.x-a.half*.94,a.y]],'#73d4ae');
 }else if(stripe)for(const lane of [-.33,.33])quad([[b.x+b.half*(lane-.012),b.y],[b.x+b.half*(lane+.012),b.y],[a.x+a.half*(lane+.012),a.y],[a.x+a.half*(lane-.012),a.y]],'#e8e4ce');
 }
 const sprites=[];for(let z=Math.floor(r.z/140)*140+140;z<r.z+2300;z+=140)for(const side of [-1,1])sprites.push({kind:'tree',z,x:side*(1.35+(Math.floor(z/140)%3)*.16)});
 for(let stage=0;stage<3;stage++){sprites.push({kind:'fork',z:stage*2400+870,x:0});sprites.push({kind:'post',z:(stage+1)*2400,x:0,stage});sprites.push({kind:'supply',z:stage*2400+1250,x:-1.38});}
 for(const o of game.objects)if(!o.taken.includes(r.id))sprites.push({...o,kind:o.type});
 for(const o of game.racers)if(o.id!==r.id&&!o.finished)sprites.push({...o,kind:'kart'});
 for(const o of game.shots)sprites.push({...o,kind:'shot'});
 sprites.filter(o=>o.z>r.z+5&&o.z<r.z+2300).sort((a,b)=>b.z-a.z).forEach(o=>{const p=project(o.z,o.x,r),s=p.scale*w*.10;
 if(o.kind==='tree')tree(p.x,p.y,s*1.7);
 if(o.kind==='kart')kart(p.x,p.y,s,o.color,o.shield>0,o.boost>0);
 if(o.kind==='traffic'){rect(p.x-s*.5,p.y-s*.9,s,s*.95,'#d4b886');rect(p.x-s*.43,p.y-s*.86,s*.86,s*.4,'#ecdcac');rect(p.x-s*.43,p.y-s*.4,s*.86,s*.25,'#698b95');rect(p.x-s*.5,p.y-s*.05,s*.2,s*.14,'#263c48');rect(p.x+s*.3,p.y-s*.05,s*.2,s*.14,'#263c48');}
 if(o.kind==='rock'){quad([[p.x-s*.46,p.y],[p.x-s*.3,p.y-s*.45],[p.x+s*.12,p.y-s*.6],[p.x+s*.43,p.y-s*.17],[p.x+s*.4,p.y]],'#6c7180');quad([[p.x-s*.3,p.y-s*.45],[p.x+s*.12,p.y-s*.6],[p.x+s*.25,p.y-s*.3],[p.x,p.y-s*.25]],'#b4c5c5');}
 if(o.kind==='energy'){rect(p.x-s*.24,p.y-s*.65,s*.48,s*.65,'#123f49');rect(p.x-s*.18,p.y-s*.59,s*.36,s*.49,'#6fe6c7');pixelText('+',p.x,p.y-s*.17,Math.max(4,s*.4),'#124954');}
 if(o.kind==='shot'){rect(p.x-s*.16,p.y-s*.4,s*.32,s*.24,'#f7f7e3');}
 if(o.kind==='fork'||o.kind==='post'){const q=project(o.z,0,r),size=Math.max(5,s*.23);rect(q.x-q.half*.98,q.y-s*1.8,Math.max(2,s*.05),s*1.8,'#315a64');rect(q.x+q.half*.93,q.y-s*1.8,Math.max(2,s*.05),s*1.8,'#315a64');
 rect(q.x-q.half,q.y-s*1.9,q.half*2,s*.48,o.kind==='fork'?'#214d4f':'#edd7a5');
 if(o.kind==='fork'){pixelText('SUPPLY ←',q.x-q.half*.48,q.y-s*1.57,size,'#9ee1bc');pixelText('→ EXPRESS',q.x+q.half*.46,q.y-s*1.57,size,'#ffcf8d');}else pixelText('POST '+(o.stage+1)+' / DELIVERY',q.x,q.y-s*1.57,size,'#2c5159');}
 if(o.kind==='supply'){rect(p.x-s*.5,p.y-s,s,s,'#e2d19d');rect(p.x-s*.6,p.y-s*1.2,s*1.2,s*.3,'#347d70');pixelText('+',p.x,p.y-s*.35,s*.5,'#357a70');}
 });
 const steer=(keys.has('ArrowRight')||keys.has('KeyD')||touch.has('right')?1:0)-(keys.has('ArrowLeft')||keys.has('KeyA')||touch.has('left')?1:0);
 kart(w*.5+steer*3,h*.89,Math.min(w*.155,h*.19),r.color,r.shield>0,r.boost>0);
 if(r.hit>0){ctx.fillStyle='#ed826229';ctx.fillRect(0,0,w,h);}
 if(r.boost>0){for(let i=0;i<6;i++){const x=i%2?w*.96:w*.04,y=h*(.5+(i%3)*.15);rect(x,y,3,h*.08,'#f8e4ad');}}
 drawMini();}
function drawMini(){mini.clearRect(0,0,170,52);mini.strokeStyle='#779c9d';mini.lineWidth=2;mini.beginPath();for(let i=0;i<50;i++){const x=8+i*3.12,y=26+Math.sin(i*.17)*12;if(i===0)mini.moveTo(x,y);else mini.lineTo(x,y);}mini.stroke();for(const r of game.racers){const t=E.clamp(r.z/E.LENGTH,0,1);mini.fillStyle=r.color;mini.fillRect(6+t*153,23+Math.sin(t*49*.17)*12,5,5);}for(let i=1;i<=3;i++){const t=i/3;mini.fillStyle='#f2dc9b';mini.fillRect(7+t*153,22+Math.sin(t*49*.17)*12,3,8);}}
const eventCopy={energy:'電池 +18 能量 · +20 分',supply:'補給完成 · 貨物 +25 / 能量 +45',block:'護盾成功擋住撞擊',hit:'貨物 −14 · 找補給線修復',boost:'衝刺！留意前方車流',shield:'護盾啟動 · 4 秒內抵擋一次',snowball:'雪球發射',finish:'第三站送達！'};
function hud(){const r=game.racers[follow],at=E.road(r.z),phase=game.phase;$('race-speed').innerHTML=Math.round(r.speed*2)+' <em>km/h</em>';$('race-time').textContent=Math.max(0,Math.ceil(E.LIMIT-game.elapsed));$('race-lap').textContent=r.parcels+' / 3';$('race-score').textContent=r.score;$('cargo-value').textContent=Math.round(r.cargo)+'%';$('energy-value').textContent=Math.floor(r.energy);$('cargo-meter').value=r.cargo;$('energy-meter').value=r.energy;
 $('tux-pause').disabled=!['racing','countdown','paused'].includes(phase);$('tux-pause').textContent=phase==='paused'?'▶':'Ⅱ';$('tux-pause').setAttribute('aria-label',phase==='paused'?'繼續遊戲':'暫停遊戲');$('tux-play').disabled=['countdown','racing','over'].includes(phase);$('tux-play').textContent=phase==='paused'?'繼續配送':'出發配送';
 $('route-hint').classList.toggle('fork',at.approach||at.fork);$('route-hint').textContent=at.approach?'前方岔路：← 補給修復 ｜ 冰面快線 →':at.fork?(r.route==='supply'?'補給線 · 前方修復 +25 / 能量 +45':'冰面快線 · 小心落石，護盾可擋撞擊'):`第 ${at.stage} 站 · ${['松林','冰川','雪港'][at.stage-1]} · 距離 ${Math.max(0,Math.ceil((2400-at.local)/10)*10)} m`;
 $('road-name').textContent=`0${at.stage} · ${['松林公路','冰川隘口','雪港歸途'][at.stage-1]}`;
 for(const [action,item]of Object.entries(E.ITEMS)){const b=$('action-'+action),active=r[action]>0;b.classList.toggle('active',active);b.classList.toggle('unavailable',r.energy<item.cost);b.disabled=phase!=='racing'||game.spectator;b.setAttribute('aria-label',`${item.name}，消耗 ${item.cost} 能量${r.energy<item.cost?'，能量不足':''}`);}
 const overlay=$('race-overlay');overlay.hidden=phase==='racing';overlay.className='tux-overlay'+(phase==='countdown'?' countdown':'');
 if(phase==='ready'){$('overlay-title').textContent='山路快遞，準備出發';$('overlay-copy').innerHTML='← → 轉向 · 自動前進<br>綠色補給保貨，橘色快線搶時間。';}
 if(phase==='countdown'){$('overlay-title').textContent=Math.ceil(game.countdown);}
 if(phase==='paused'){$('overlay-title').textContent='郵差休息中';$('overlay-copy').textContent='按 ▶ / P 繼續；計時、車流與道具都已暫停。';}
 if(phase==='over'){$('overlay-title').textContent=r.finished?'三站配送完成':'本次配送結束';$('overlay-copy').textContent='成績已結算。按「再送一趟」重新挑戰。';}
 const standings=game.standings();$('race-position').textContent=(standings.find(s=>s.id===follow).rank)+' / 5';$('tux-standings').innerHTML=standings.map(s=>`<li style="--racer:${E.PROFILES[s.id].color}"><strong>${s.rank}. ${s.name}</strong><span>${s.score}</span><small>${s.parcels}/3 站</small></li>`).join('');
 for(const e of game.events)if(e.id>lastEvent){lastEvent=e.id;if(e.racer===follow){let msg=eventCopy[e.type];if(e.type==='route')msg=e.route==='supply'?'已選補給線 · 放慢腳步，修復貨物':'已選冰面快線 · 速度更高，小心落石';if(e.type==='delivery')msg=`第 ${e.station} 站送達 · 貨物 ${e.cargo}% · +${Math.round(e.cargo*3)} 分`;if(msg){$('race-event').textContent=msg;eventUntil=game.elapsed+2;}}}
 if(game.elapsed>eventUntil)$('race-event').textContent='';
 $('tux-result').hidden=phase!=='over';if(phase==='over'){const me=standings.find(s=>s.id===0);$('tux-result-title').textContent=game.spectator?'AI 配送結算':`送達 ${r.parcels} / 3 站 · ${r.score} 分`;$('tux-result-copy').textContent=`${game.spectator?'觀戰結束':`本局積分第 ${me.rank} 名`} · 貨物完整 ${Math.round(r.cargo)}% · 用時 ${game.elapsed.toFixed(1)} 秒`;$('tux-final-standings').innerHTML=standings.map(s=>`<li>${s.name} · ${s.score} 分 · ${s.parcels}/3 站${s.finished?' ✓':''}</li>`).join('');}
}
function clear(){keys.clear();touch.clear();pending=null;document.querySelectorAll('.pressed').forEach(b=>b.classList.remove('pressed'));}
function focusRoad(){canvas.focus({preventScroll:true});document.querySelector('.tux-arena').scrollIntoView({block:'start',behavior:'instant'});}
function start(){game.start();clear();hud();focusRoad();}
function reset(auto=false){clear();follow=0;$('follow-kart').value='0';game=new E.Game({seed:$('tux-seed').value||'alpine-post',spectator:$('tux-mode').value==='spectator'});window.tux2dGame=game;lastEvent=-1;eventUntil=0;acc=0;$('race-event').textContent='';$('follow-label').hidden=!game.spectator;$('tux-status').textContent=game.spectator?'五位 AI 使用相同規則配送；可切換跟拍。':'自動油門。先用 ← → 駕駛，再試試補給與道具。';if(auto)start();hud();draw();}
function pause(){if(game.phase==='paused')start();else{game.pause();clear();hud();}}
$('tux-play').onclick=start;$('tux-pause').onclick=pause;$('tux-restart').onclick=()=>reset(true);$('tux-race-again').onclick=()=>reset(true);$('tux-mode').onchange=()=>reset();$('tux-seed').onchange=()=>reset();$('follow-kart').onchange=()=>{follow=Number($('follow-kart').value);lastEvent=game.eventId-1;clear();hud();};
function action(name){if(game.phase==='racing'&&!game.spectator){const r=game.racers[0];if(r.energy<E.ITEMS[name].cost){$('race-event').textContent='能量不足 · 撿電池或走左側補給線';eventUntil=game.elapsed+1.5;}else pending=name;}}
for(const name of Object.keys(E.ITEMS)){const b=$('action-'+name);b.addEventListener('pointerdown',e=>{e.preventDefault();action(name);});b.onclick=e=>{if(e.detail===0)action(name);};}
for(const name of ['left','right','brake']){const b=$('touch-'+name);b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);touch.add(name);b.classList.add('pressed');});const release=()=>{touch.delete(name);b.classList.remove('pressed');};b.addEventListener('pointerup',release);b.addEventListener('pointercancel',release);b.addEventListener('lostpointercapture',release);}
window.addEventListener('keydown',e=>{if(/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName))return;if(['KeyP','Escape'].includes(e.code)){e.preventDefault();if(!e.repeat)pause();return;}if(e.target.closest('button')&&['Space','Enter'].includes(e.code))return;const names={ShiftLeft:'boost',ShiftRight:'boost',Space:'shield',KeyF:'snowball'};if(names[e.code]){e.preventDefault();if(!e.repeat)action(names[e.code]);return;}if(['ArrowLeft','ArrowRight','ArrowDown','KeyA','KeyD','KeyS'].includes(e.code)){e.preventDefault();keys.add(e.code);}});
window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>{game.pause();clear();hud();});document.addEventListener('visibilitychange',()=>{if(document.hidden){game.pause();clear();hud();}});
function resize(){const box=canvas.getBoundingClientRect();canvas.width=box.width<520?480:800;canvas.height=Math.round(canvas.width*box.height/box.width);draw();}new ResizeObserver(resize).observe(canvas);
function frame(ts){const delta=last?Math.min((ts-last)/1000,.12):0;last=ts;if(['countdown','racing'].includes(game.phase)){acc+=delta;while(acc>=E.DT){const steer=(keys.has('ArrowRight')||keys.has('KeyD')||touch.has('right')?1:0)-(keys.has('ArrowLeft')||keys.has('KeyA')||touch.has('left')?1:0);game.step({steer,brake:keys.has('ArrowDown')||keys.has('KeyS')||touch.has('brake'),action:pending});pending=null;acc-=E.DT;}}else acc=0;draw();if(ts-lastHUD>90){hud();lastHUD=ts;}requestAnimationFrame(frame);}
hud();requestAnimationFrame(frame);
})();
