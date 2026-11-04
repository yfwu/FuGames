/* Tux 2D 山路快遞: input, HUD, lobby/pause/result curtain, menu drawer and career.
   The rules live in tux2d-engine.js; the 3D road view (tux2d-view.js) only reads window.TuxApp. */
(function(){
'use strict';
const E=window.Tux2D,C=E.Career,$=id=>document.getElementById(id),canvas=$('tux-board'),body=document.body;
const Fu=window.Fu||{open(){},close(){},toggle(){},isOpen(){return false;},toast(){}};

// ---------- Storage (guarded: private mode and blocked storage fall back to memory) ----------
const memory={};
const storage={getItem:k=>{try{return window.localStorage.getItem(k);}catch(e){return k in memory?memory[k]:null;}},setItem:(k,v)=>{try{window.localStorage.setItem(k,v);}catch(e){memory[k]=String(v);}}};
const PREF_KEY='fugames:tux2d';
const DEFAULTS={tier:1,route:'alpine',weather:'clear',cargo:'parcel',draft:true,contract:null,mode:'human',seed:'alpine-post',camera:'chase',particles:true,shake:true,sound:true};
let prefs={...DEFAULTS};try{Object.assign(prefs,JSON.parse(storage.getItem(PREF_KEY)||'{}')||{});}catch(e){}
const savePrefs=()=>storage.setItem(PREF_KEY,JSON.stringify(prefs));
let profile=C.load(storage);
const level=()=>C.levelOf(profile.xp).level;
function sanitizePrefs(){
 const L=level();
 if(!E.TIERS[prefs.tier]||!C.unlocked(L,'tier',Number(prefs.tier)))prefs.tier=1;prefs.tier=Number(prefs.tier);
 for(const [kind,table,fallback] of [['route',E.ROUTES,'alpine'],['weather',E.WEATHER,'clear'],['cargo',E.CARGO,'parcel']])if(!table[prefs[kind]]||!C.unlocked(L,kind,prefs[kind]))prefs[kind]=fallback;
 if(prefs.contract&&(!E.CONTRACTS[prefs.contract]||!C.offers(L,profile.runs).includes(prefs.contract)))prefs.contract=null;
 if(!['chase','high','low'].includes(prefs.camera))prefs.camera='chase';
 prefs.seed=String(prefs.seed||'alpine-post').slice(0,40);
}
const params=new URLSearchParams(location.search);if(params.has('seed'))prefs.seed=params.get('seed').slice(0,40)||'alpine-post';
sanitizePrefs();

// ---------- Game state ----------
const options=()=>({seed:prefs.seed||'alpine-post',spectator:prefs.mode==='spectator',tier:prefs.tier,weather:prefs.weather,cargo:prefs.cargo,route:prefs.route,draft:!!prefs.draft,contract:prefs.mode==='spectator'?null:prefs.contract});
let game=new E.Game(options()),keys=new Set(),touch=new Set(),pending=null,acc=0,last=0,lastHUD=0,lastEvent=-1,eventUntil=0,follow=0,finalized=false,goUntil=0,warnUntil=0,resultTimer=0,report=null;
window.tux2dGame=game;
const app=window.TuxApp={get game(){return game;},get follow(){return follow;},steer:0,settings:prefs,shake:0,flash:0,version:1};

// ---------- Sound: a few synthesized blips, no audio files ----------
let audio=null;
function tone(freq,dur,type='square',gain=.04,slide=0){
 if(!prefs.sound)return;
 try{audio=audio||new (window.AudioContext||window.webkitAudioContext)();if(audio.state==='suspended')audio.resume();const t=audio.currentTime,o=audio.createOscillator(),g=audio.createGain();o.type=type;o.frequency.setValueAtTime(freq,t);if(slide)o.frequency.exponentialRampToValueAtTime(Math.max(30,freq+slide),t+dur);g.gain.setValueAtTime(gain,t);g.gain.exponentialRampToValueAtTime(.0001,t+dur);o.connect(g);g.connect(audio.destination);o.start(t);o.stop(t+dur+.02);}catch(e){}
}
const SFX={energy:()=>tone(880,.09,'square',.035,440),supply:()=>{tone(523,.12,'triangle',.05);setTimeout(()=>tone(784,.16,'triangle',.05),90);},hit:()=>tone(150,.28,'sawtooth',.06,-90),block:()=>tone(620,.18,'triangle',.05,-200),boost:()=>tone(220,.45,'sawtooth',.03,380),shield:()=>tone(440,.25,'sine',.05,220),snowball:()=>tone(990,.12,'square',.03,-500),delivery:()=>{tone(659,.12,'triangle',.05);setTimeout(()=>tone(988,.22,'triangle',.05),110);},finish:()=>{[523,659,784,1047].forEach((f,i)=>setTimeout(()=>tone(f,.2,'triangle',.05),i*110));},count:()=>tone(440,.12,'square',.04),go:()=>tone(880,.3,'square',.05)};

// ---------- Helpers ----------
const nameOf=id=>id===0&&!game.spectator?'你':E.PROFILES[id].name;
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function careerHTML(p){const l=C.levelOf(p.xp);return `<div class="lv"><small>LEVEL</small>${l.level}</div><div class="who">${C.rankOf(l.level)}<span>${l.max?'已達最高等級':`${l.into} / ${l.need} XP`}</span></div><span class="fu-meter fu-meter--gold" style="--value:${l.max?1:(l.into/l.need).toFixed(3)}"><i></i></span>`;}
function renderCareer(){
 const l=C.levelOf(profile.xp);$('lv').textContent=l.level;$('rank').textContent=C.rankOf(l.level);$('lv-fill').style.width=(l.max?100:Math.round(l.into/l.need*100))+'%';
 $('career-chip').setAttribute('aria-label',`郵差生涯 ${l.level} 級，${C.rankOf(l.level)}。開啟生涯紀錄`);
 for(const id of ['lobby-career','drawer-career'])$(id).innerHTML=careerHTML(profile);
 const p=profile;$('career-stats').innerHTML=[[p.runs,'配送趟數'],[p.wins,'榜首次數'],[p.deliveries,'送達站數'],[p.contracts,'完成委託'],[p.bestScore,'最高積分'],[p.fastest?p.fastest.toFixed(1)+'s':'—','最快完程']].map(([v,k])=>`<div><b>${v}</b><span>${k}</span></div>`).join('');
 const label=u=>u.kind==='tier'?`對手：${E.TIERS[u.id].name}`:u.kind==='route'?`路線：${E.ROUTES[u.id].name}`:u.kind==='weather'?`天候：${E.WEATHER[u.id].name}`:u.kind==='cargo'?`貨物：${E.CARGO[u.id].name}`:`委託：${E.CONTRACTS[u.id].name}`;
 $('unlock-list').innerHTML=C.UNLOCKS.filter(u=>u.level>1).map(u=>`<li class="${l.level>=u.level?'got':''}">${label(u)}<span>${l.level>=u.level?'已解鎖':'LV '+u.level}</span></li>`).join('');
}

// ---------- Lobby & drawer setup ----------
function renderTier(){
 const L=level();$('tier-seg').innerHTML=E.TIERS.map((t,i)=>{const ok=C.unlocked(L,'tier',i);return `<button type="button" value="${i}" aria-pressed="${prefs.tier===i}" ${ok?'':'disabled'} title="${esc(t.copy)}">${t.name}${ok?`<small>XP ×${[.6,1,1.3,1.7][i]}</small>`:`<small>LV ${C.unlockLevel('tier',i)}</small>`}</button>`;}).join('');
 $('tier-copy').textContent=E.TIERS[prefs.tier].copy;
}
function renderContracts(){
 const offers=C.offers(level(),profile.runs);
 if(prefs.contract&&!offers.includes(prefs.contract))prefs.contract=null;
 $('contract-chips').innerHTML=offers.map(id=>{const c=E.CONTRACTS[id];return `<button class="tux-opt" type="button" data-contract="${id}" aria-pressed="${prefs.contract===id}"><b>${c.name}</b><span>${c.copy}</span><em>+${c.xp}</em></button>`;}).join('')+`<button class="tux-opt" type="button" data-contract="" aria-pressed="${!prefs.contract}"><b>不接委託</b><span>專心送貨。</span></button>`;
}
function renderOptions(kind,table,host){
 const L=level();$(host).innerHTML=Object.entries(table).map(([id,o])=>{const ok=C.unlocked(L,kind,id),mult=kind==='route'?{alpine:1,canyon:1.15,glacier:1.1}[id]:kind==='weather'?{clear:1,snow:1.1,gale:1.2}[id]:{parcel:1,fragile:1.15,heavy:1.1,fresh:1.15}[id];return `<button class="tux-opt" type="button" data-kind="${kind}" data-id="${id}" aria-pressed="${prefs[kind]===id}" ${ok?'':'disabled'}><b>${o.name}</b><span>${o.copy}</span><em>${ok?(mult>1?'XP ×'+mult:''):'LV '+C.unlockLevel(kind,id)}</em></button>`;}).join('');
}
function runSummary(){return `${E.ROUTES[prefs.route].name} · ${E.WEATHER[prefs.weather].name} · ${E.CARGO[prefs.cargo].name}${prefs.draft?' · 尾流':''}${prefs.mode==='spectator'?' · 觀戰':''}`;}
function renderSetup(){
 sanitizePrefs();renderTier();renderContracts();
 renderOptions('route',E.ROUTES,'route-options');renderOptions('weather',E.WEATHER,'weather-options');renderOptions('cargo',E.CARGO,'cargo-options');
 $('run-summary').textContent=runSummary();$('opt-draft').checked=!!prefs.draft;$('tux-mode').value=prefs.mode;$('tux-seed').value=prefs.seed;
 for(const b of $('camera-seg').querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.value===prefs.camera));
 $('set-particles').checked=!!prefs.particles;$('set-shake').checked=!!prefs.shake;$('set-sound').checked=!!prefs.sound;
 $('follow-kart').innerHTML=E.PROFILES.map((p,i)=>`<option value="${i}">${p.name}</option>`).join('');$('follow-kart').value=String(follow);$('follow-label').hidden=prefs.mode!=='spectator';
 renderCareer();
}
function changed(){savePrefs();renderSetup();if(game.phase==='ready')rebuild();else if(!['over'].includes(game.phase))Fu.toast('下一趟配送生效',{tone:'info',ms:1600});}
$('tier-seg').addEventListener('click',e=>{const b=e.target.closest('button');if(!b||b.disabled)return;prefs.tier=Number(b.value);changed();});
$('contract-chips').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;prefs.contract=b.dataset.contract||null;changed();});
for(const host of ['route-options','weather-options','cargo-options'])$(host).addEventListener('click',e=>{const b=e.target.closest('button');if(!b||b.disabled)return;prefs[b.dataset.kind]=b.dataset.id;changed();});
$('opt-draft').onchange=e=>{prefs.draft=e.target.checked;changed();};
$('tux-mode').onchange=e=>{prefs.mode=e.target.value;follow=0;changed();if(game.phase!=='ready'&&game.phase!=='over'){rebuild();toLobby();}};
$('tux-seed').onchange=e=>{prefs.seed=(e.target.value||'alpine-post').slice(0,40);changed();};
$('follow-kart').onchange=e=>{follow=Number(e.target.value);lastEvent=game.eventId-1;hud();};
$('camera-seg').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;prefs.camera=b.value;savePrefs();renderSetup();});
for(const [id,key] of [['set-particles','particles'],['set-shake','shake'],['set-sound','sound']])$(id).onchange=e=>{prefs[key]=e.target.checked;savePrefs();};
$('open-run').onclick=()=>{selectTab('run');Fu.open('menu');};
$('career-chip').onclick=()=>{selectTab('career');Fu.open('menu');};
function selectTab(name){for(const t of ['run','rules','settings','career']){$('tab-'+t).setAttribute('aria-selected',String(t===name));$('panel-'+t).hidden=t!==name;}}
for(const t of ['run','rules','settings','career'])$('tab-'+t).onclick=()=>selectTab(t);
$('reset-career').onclick=()=>{if(!confirm('確定要清除這台裝置上的山路快遞等級與紀錄？'))return;profile=C.blank();C.save(storage,profile);sanitizePrefs();savePrefs();renderSetup();Fu.toast('生涯已重置',{tone:'info'});};
$('hotkey-list').innerHTML=[['← →','轉向（A / D）'],['↓','煞車（S）'],['Shift','衝刺'],['Space','護盾'],['F','雪球'],['P','暫停 / 繼續（Esc）'],['M','選單'],['Enter','出發 / 再送一趟']].map(([k,v])=>`<span class="fu-kbd">${k}</span><span>${v}</span>`).join('');

// ---------- Curtain & flow ----------
const curtain=$('curtain');
function showCurtain(mode){curtain.dataset.mode=mode;curtain.hidden=false;const target=mode==='lobby'?$('tux-play'):mode==='pause'?$('tux-resume'):$('tux-race-again');setTimeout(()=>{if(!curtain.hidden&&document.activeElement!==target&&!Fu.isOpen('menu'))target.focus({preventScroll:true});},40);}
function hideCurtain(){curtain.hidden=true;}
function clearInput(){keys.clear();touch.clear();pending=null;document.querySelectorAll('.pressed').forEach(b=>b.classList.remove('pressed'));}
function rebuild(){clearInput();clearTimeout(resultTimer);game=new E.Game(options());window.tux2dGame=game;lastEvent=-1;eventUntil=0;acc=0;finalized=false;report=null;if(follow&&!game.spectator)follow=0;$('race-event').textContent='';body.classList.toggle('is-spectator',game.spectator);hud();}
function start(){
 if(game.phase==='over'||game.phase==='ready')rebuild();
 game.start();clearInput();hideCurtain();Fu.close('menu');hud();canvas.focus({preventScroll:true});
}
function toLobby(){rebuild();renderSetup();showCurtain('lobby');}
function pause(){if(game.phase==='paused')start();else if(['racing','countdown'].includes(game.phase)){game.pause();clearInput();hud();showCurtain('pause');}}
$('tux-play').onclick=start;$('tux-resume').onclick=start;$('tux-pause').onclick=pause;
$('tux-race-again').onclick=()=>{rebuild();start();};$('tux-to-lobby').onclick=toLobby;
$('tux-abandon').onclick=toLobby;
$('tux-restart').onclick=()=>{rebuild();start();};

function finalize(){
 if(finalized)return;finalized=true;
 const s=game.summary(),before=profile;report=C.record(profile,s);
 if(!game.spectator){profile=report.profile;C.save(storage,profile);}
 const st=game.standings(),me=st.find(x=>x.id===follow),r=game.racers[follow];
 $('result-kicker').textContent=game.spectator?'AI 配送結算':r.finished?'Delivery report · 三站送達':'Delivery report · 時間到';
 $('tux-result-title').textContent=game.spectator?`${E.PROFILES[st[0].id].name} 奪下榜首`:`送達 ${r.parcels} / 3 站 · ${r.score} 分`;
 $('tux-result-copy').textContent=`${game.spectator?'觀戰結束':`本局積分第 ${me.rank} 名`} · 貨物完整 ${Math.round(r.cargo)}% · 用時 ${game.elapsed.toFixed(1)} 秒 · ${E.TIERS[game.tier].name}對手 · ${E.ROUTES[game.route].name}`;
 $('tux-final-standings').innerHTML=st.map(x=>`<li class="${x.id===follow?'me':''}"><span class="n">${x.rank}</span><span class="fu-side" style="--side:${E.PROFILES[x.id].color}"></span><span>${esc(nameOf(x.id))}${x.finished?' ✓':''}</span><span class="m">${x.parcels}/3 站 · ${x.cargo}%</span><span class="s">${x.score}</span></li>`).join('');
 const g=report.gain,c=game.contractResult();
 let lines='';if(!game.spectator){lines=g.lines.map(([k,v])=>`<dt>${esc(k)}</dt><dd>+${v}</dd>`).join('');if(c&&!c.ok)lines+=`<dt class="miss">委託未達成：${esc(c.name)}</dt><dd>—</dd>`;lines+=`<dt>倍率（對手 · 路線 · 天候 · 貨物）</dt><dd>×${g.mult.toFixed(2)}</dd><dt class="total">獲得經驗</dt><dd class="total">+${g.total} XP</dd>`;}
 $('xp-lines').innerHTML=lines;
 const lu=$('levelup');lu.hidden=!(report.after.level>report.before.level);
 if(!lu.hidden){const names=report.unlocked.map(u=>u.kind==='tier'?`${E.TIERS[u.id].name}對手`:u.kind==='route'?E.ROUTES[u.id].name:u.kind==='weather'?`${E.WEATHER[u.id].name}天候`:u.kind==='cargo'?E.CARGO[u.id].name:`委託「${E.CONTRACTS[u.id].name}」`);lu.innerHTML=`<b>升到 ${report.after.level} 級 · ${C.rankOf(report.after.level)}</b>${names.length?'<br>解鎖：'+names.map(esc).join('、'):''}`;}
 $('result-career').innerHTML=game.spectator?'':careerHTML(profile);
 renderSetup();
 if(!game.spectator&&r.finished)SFX.finish();
 clearTimeout(resultTimer);resultTimer=setTimeout(()=>{if(game.phase==='over'&&finalized)showCurtain('result');},700);
}

// ---------- HUD ----------
const eventCopy={energy:['電池 +18 能量 · +20 分','good'],supply:['補給完成 · 貨物 +25 / 能量 +45','good'],block:['護盾擋下撞擊','item'],boost:['衝刺！留意前方車流','item'],shield:['護盾啟動 · 4 秒內抵擋一次','item'],snowball:['雪球發射','item'],finish:['第三站送達！','good']};
const progress=$('tux-progress'),dots=E.PROFILES.map((p,i)=>{const d=document.createElement('i');d.className='dot'+(i===0?' me':'');d.style.setProperty('--side',p.color);progress.append(d);return d;});
for(let s=0;s<3;s++){for(const [z,cls] of [[s*2400+900,'stn fork'],[(s+1)*2400,'stn']]){const t=document.createElement('i');t.className=cls;t.style.left=(z/E.LENGTH*100)+'%';progress.prepend(t);}}
let shownCount='';
function say(msg,tone){const el=$('race-event');el.textContent=msg;el.className='tux-event '+(tone||'');void el.offsetWidth;eventUntil=game.elapsed+2;}
function hud(){
 const r=game.racers[follow],at=game.road(r.z),phase=game.phase;
 body.dataset.phase=phase;
 $('race-speed').textContent=Math.round(r.speed*2);$('race-time').textContent=Math.max(0,Math.ceil(E.LIMIT-game.elapsed));$('race-lap').textContent=r.parcels+' / 3';$('race-score').textContent=r.score;
 $('cargo-value').textContent=Math.round(r.cargo)+'%';$('energy-value').textContent=Math.floor(r.energy);$('cargo-meter').style.setProperty('--value',(r.cargo/100).toFixed(3));$('energy-meter').style.setProperty('--value',(r.energy/100).toFixed(3));
 document.querySelector('.tux-race').classList.toggle('is-low-cargo',r.cargo<40);
 const pb=$('tux-pause');pb.disabled=!['racing','countdown','paused'].includes(phase);pb.classList.toggle('is-paused',phase==='paused');pb.setAttribute('aria-label',phase==='paused'?'繼續遊戲':'暫停遊戲');
 const hint=$('route-hint'),warn=game.elapsed<warnUntil;
 hint.classList.toggle('fork',at.approach||at.fork);hint.classList.toggle('warn',warn);
 hint.textContent=warn?'前方山壁落石！看地上的預警圈，換線或開護盾':at.approach?'前方岔路：← 補給修復 ｜ 冰面快線 →':at.fork?(r.route==='supply'?'補給線 · 前方修復 +25 / 能量 +45':'冰面快線 · 轉向較滑，小心落石'):at.mainIce?'冰面路段 · 轉向打滑、煞車變長':`第 ${at.stage} 站 · ${E.STATIONS[at.stage-1]} · 距離 ${Math.max(0,Math.ceil((2400-at.local)/10)*10)} m`;
 $('road-name').textContent=`0${at.stage} · ${['松林公路','冰川隘口','雪港歸途'][at.stage-1]}`;
 for(const [action,item] of Object.entries(E.ITEMS)){const b=$('action-'+action),active=r[action]>0;b.classList.toggle('is-active',active);b.classList.toggle('is-low',r.energy<item.cost);b.style.setProperty('--ready',Math.min(1,r.energy/item.cost).toFixed(2));b.disabled=phase!=='racing'||game.spectator;b.setAttribute('aria-label',`${item.name}，消耗 ${item.cost} 能量${r.energy<item.cost?'，能量不足':''}`);}
 const standings=game.standings();$('race-position').textContent=standings.find(s=>s.id===follow).rank+' / 5';
 $('tux-standings').innerHTML=standings.map(s=>`<li class="${s.id===follow?'me':''}"><span class="n">${s.rank}</span><span class="fu-side" style="--side:${E.PROFILES[s.id].color}"></span><span>${esc(nameOf(s.id))}</span><span class="p">${s.parcels}/3</span><span class="s">${s.score}</span></li>`).join('');
 game.racers.forEach((o,i)=>{dots[i].style.left=(E.clamp(o.z,0,E.LENGTH)/E.LENGTH*100)+'%';dots[i].classList.toggle('me',i===follow);});
 // Countdown numerals and GO.
 const count=$('race-count');let c='';if(phase==='countdown')c=String(Math.ceil(game.countdown));else if(phase==='racing'&&game.elapsed<.7)c='出發';
 if(c!==shownCount){shownCount=c;count.textContent=c;count.classList.toggle('go',c==='出發');if(c==='出發')SFX.go();else if(c)SFX.count();}
 for(const e of game.events)if(e.id>lastEvent){lastEvent=e.id;
  if(e.type==='rockfall'){if(e.z-r.z>0&&e.z-r.z<800){warnUntil=game.elapsed+1.6;tone(110,.4,'sawtooth',.04,-40);}continue;}
  if(e.type==='hit'&&e.by===follow&&e.racer!==follow){say(`雪球命中 ${nameOf(e.racer)}！`,'good');SFX.energy();continue;}
  if(e.racer!==follow)continue;
  let msg=eventCopy[e.type],text=msg&&msg[0],tone2=msg&&msg[1];
  if(e.type==='hit'){text=e.by!==null&&e.by!==undefined?`被 ${nameOf(e.by)} 的雪球打中 · 貨物 −${game.mods.damage}`:`${{rock:'撞上落石',traffic:'擦撞貨車',racer:'車手碰撞'}[e.source]||'撞擊'} · 貨物 −${game.mods.damage}`;tone2='bad';app.shake=1;app.flash=1;}
  if(e.type==='route'){text=e.route==='supply'?'已選補給線 · 放慢腳步，修復貨物':'已選冰面快線 · 速度更高，小心落石';tone2='item';}
  if(e.type==='delivery'){text=`第 ${e.station} 站送達 · 貨物 ${e.cargo}% · +${e.points} 分`;tone2='good';}
  if(e.type==='block')app.shake=.4;
  if(text)say(text,tone2);if(SFX[e.type])SFX[e.type]();
 }
 if(game.elapsed>eventUntil&&$('race-event').textContent)$('race-event').textContent='';
}

// ---------- Input ----------
function action(name){if(game.phase!=='racing'||game.spectator)return;const r=game.racers[0];if(r.energy<E.ITEMS[name].cost){say('能量不足 · 撿電池或走左側補給線','bad');eventUntil=game.elapsed+1.5;}else pending=name;}
for(const name of Object.keys(E.ITEMS)){const b=$('action-'+name);b.addEventListener('pointerdown',e=>{e.preventDefault();action(name);});b.onclick=e=>{if(e.detail===0)action(name);};}
for(const name of ['left','right','brake']){const b=$('touch-'+name);b.addEventListener('pointerdown',e=>{e.preventDefault();try{b.setPointerCapture(e.pointerId);}catch(err){}touch.add(name);b.classList.add('pressed');});const release=()=>{touch.delete(name);b.classList.remove('pressed');};b.addEventListener('pointerup',release);b.addEventListener('pointercancel',release);b.addEventListener('lostpointercapture',release);b.addEventListener('contextmenu',e=>e.preventDefault());}
window.addEventListener('keydown',e=>{
 if(e.defaultPrevented)return;
 if(/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName))return;
 if(Fu.isOpen('menu')){if(e.code==='KeyM'){e.preventDefault();Fu.close('menu');}return;}
 if(e.code==='KeyM'){e.preventDefault();selectTab(game.phase==='ready'||game.phase==='over'?'run':'rules');Fu.open('menu');return;}
 if(['KeyP','Escape'].includes(e.code)){e.preventDefault();if(!e.repeat)pause();return;}
 if(e.code==='Enter'&&!curtain.hidden&&!e.target.closest('button')){e.preventDefault();if(curtain.dataset.mode==='result'){rebuild();start();}else start();return;}
 if(e.target.closest('button')&&['Space','Enter'].includes(e.code))return;
 const names={ShiftLeft:'boost',ShiftRight:'boost',Space:'shield',KeyF:'snowball'};
 if(names[e.code]){e.preventDefault();if(!e.repeat)action(names[e.code]);return;}
 if(['ArrowLeft','ArrowRight','ArrowDown','KeyA','KeyD','KeyS'].includes(e.code)){e.preventDefault();keys.add(e.code);}
});
window.addEventListener('keyup',e=>keys.delete(e.code));
const autoPause=()=>{if(['racing','countdown'].includes(game.phase)){game.pause();clearInput();hud();showCurtain('pause');}};
window.addEventListener('blur',autoPause);document.addEventListener('visibilitychange',()=>{if(document.hidden)autoPause();});
document.addEventListener('fu:open',e=>{if(e.target.id==='menu'&&['racing','countdown'].includes(game.phase)){game.pause();clearInput();hud();}});
document.addEventListener('fu:close',e=>{if(e.target.id==='menu'&&game.phase==='paused'&&curtain.hidden)showCurtain('pause');});

// ---------- Loop ----------
const steerInput=()=>(keys.has('ArrowRight')||keys.has('KeyD')||touch.has('right')?1:0)-(keys.has('ArrowLeft')||keys.has('KeyA')||touch.has('left')?1:0);
function frame(ts){
 const delta=last?Math.min((ts-last)/1000,.25):0;last=ts;
 if(['countdown','racing'].includes(game.phase)){acc+=delta;while(acc>=E.DT){const steer=steerInput();game.step({steer,brake:keys.has('ArrowDown')||keys.has('KeyS')||touch.has('brake'),action:pending});pending=null;acc-=E.DT;if(game.phase==='over')break;}}else acc=0;
 app.steer=game.spectator?0:steerInput();
 if(game.phase==='over'&&!finalized){hud();finalize();}
 if(ts-lastHUD>90){hud();lastHUD=ts;}
 requestAnimationFrame(frame);
}
renderSetup();hud();showCurtain('lobby');requestAnimationFrame(frame);
})();
