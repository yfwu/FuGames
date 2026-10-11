"""Shared UI functional checks. Controlled board fixtures are explicit, not full-game outcomes."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib,json,os,time
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ.get('HEX_REPORT_DIR',str(ROOT/'docs/hex-shared-core-2026-10-11/ui')))
BASE=os.environ.get('FUGAMES_BASE_URL','http://127.0.0.1:8011')
SOURCES=['config/hex-strategies.json','hex-core.js','hex-strategies.js','autohex-planner.js','autohex-ai-worker.js','cardhex-engine.js','autohex-engine.js','autohex-ui.js','autohex-visuals.js','autohex.css','card_hex.html','autohex.html']
def hashes():return {f:hashlib.sha256((ROOT/f).read_bytes()).hexdigest() for f in SOURCES}
OUT.mkdir(parents=True,exist_ok=True);(OUT/'screenshots').mkdir(exist_ok=True)
report={'sourceSha256':hashes(),'method':'Real DOM/canvas input; virtual timer holds AI during controlled terrain/structure fixtures. Setup and hotseat use normal UI. Not campaign acceptance.','errors':[],'cases':[]}
FIXTURE='''kind=>{const E=HexAPI,g=hexGame;g.pause();autoHexSchedule();g.board.set(g.anchors);g.terrain.fill(0);g.roads.fill(0);g.shields.fill(0);g.hillAge.fill(0);g.unsupplied.fill(0);g.age.fill(0);g.fortified.fill(0);g.turrets=[];g.bridges=[];g.tunnels=[];g.neutralEvents=false;g.neutralWarning=null;g.turn=1;g.phase='running';g.players[1].energy=8;g.hands[1]=['bridge','shield','destroy','reroute','turret'];g.handAges[1]=[0,0,0,0,0];
 const sites=new Set([...g.airports,...g.depots].map(a=>a.cell));
 const base=E.CELLS.find(c=>E.distance(c,E.index(0,0))<4&&[E.index(c.q,c.r),E.index(c.q+1,c.r),E.index(c.q+1,c.r+1),E.index(c.q+2,c.r)].every(i=>i>=0&&!g.anchors[i]&&!sites.has(i)));
 const a=base.i,mid=E.index(base.q+1,base.r),bend=E.index(base.q+1,base.r+1),end=E.index(base.q+2,base.r);g.board[a]=1;g.board[end]=1;
 if(kind==='river'||kind==='bridge')g.terrain[mid]=1;
 if(kind==='hill'){g.terrain[mid]=2;g.board[mid]=1;g.hillAge[mid]=2;g.turrets=[{owner:1,cell:mid,countdown:3,life:30}];}
 if(kind==='tunnel'){g.terrain[mid]=1;g.terrain[bend]=2;g.board[bend]=1;}
 autoHexRender();autoHexSchedule();document.getElementById('show-range').checked=false;document.getElementById('supply-mode').value='off';document.getElementById('plan-faction').value='off';document.getElementById('plan-faction').dispatchEvent(new Event('change'));autoHexFocusCell(mid,32);autoHexRender();
 return {a,mid,bend,end,ply:g.ply,energy:g.players[1].energy,terrain:Array.from(g.terrain)};}'''
def hit(p,sel,mobile):p.locator(sel).tap() if mobile else p.locator(sel).click()
def cell(p,i,mobile):
 p.locator('#board').scroll_into_view_if_needed();point=p.evaluate('hexCellPoint',i)
 p.touchscreen.tap(point['x'],point['y']) if mobile else p.mouse.click(point['x'],point['y'])
def white_sample(p,i):
 return p.evaluate('''i=>{const c=document.getElementById('board'),r=c.getBoundingClientRect(),p=hexCellPoint(i),scale=hexUI().camera.scale,dpr=c.width/r.width;return Array.from(c.getContext('2d').getImageData(Math.floor((p.x-r.left+.68*scale)*dpr),Math.floor((p.y-r.top+.23*scale)*dpr),1,1).data);}''',i)
try:
 with sync_playwright() as pw:
  b=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox'])
  for name,w,h,dpr,mobile in [('desktop',1440,1100,1,False),('mobile',390,844,3,True),('narrow',320,740,2,True)]:
   c=b.new_context(viewport={'width':w,'height':h},device_scale_factor=dpr,is_mobile=mobile,has_touch=mobile)
   p=c.new_page();p.on('pageerror',lambda e:report['errors'].append(str(e)))
   p.clock.install(time=datetime(2026,10,11,20,0,tzinfo=timezone.utc));p.clock.pause_at(datetime(2026,10,11,20,1,tzinfo=timezone.utc))
   p.goto(BASE+'/card_hex.html');p.select_option('#match-mode','allhuman');p.select_option('#seat-count','2');hit(p,'#play',mobile)
   for expected in [1,2,1]:
    assert p.locator('#handoff').is_visible();assert p.evaluate('hexUI().observer')==0;assert p.locator('#hand button').count()==0
    assert p.evaluate('hexGame.turn')==expected;hit(p,'#reveal-hand',mobile);assert p.evaluate('hexUI().observer')==expected;assert p.locator('#hand button').count()>0
    if expected==2:p.screenshot(path=str(OUT/'screenshots'/f'{name}-handoff-revealed.png'),full_page=True)
    hit(p,'#rest',mobile)
   p.screenshot(path=str(OUT/'screenshots'/f'{name}-handoff.png'))
   hit(p,'#reveal-hand',mobile);hit(p,'#restart',mobile);assert p.evaluate('hexGame.phase')=='ready'
   for count in ['2','3','4','5','6']:
    p.select_option('#seat-count',count);assert p.evaluate('HexAPI.PLAYERS.length')==int(count);assert p.locator('#players article').count()==int(count)
   p.select_option('#match-mode','spectator');hit(p,'#play',mobile);p.clock.run_for(300)
   deadline=time.monotonic()+10
   while p.evaluate('hexGame.ply')<1 and time.monotonic()<deadline:time.sleep(.02)
   assert p.evaluate('hexGame.ply')==1;assert p.locator('#handoff').is_hidden();assert p.locator('#hand button').count()==0;assert p.evaluate('autoHexPlanningDebug().workerCount')==1
   hit(p,'#pause',mobile);before=p.evaluate('({ply:hexGame.ply,ms:hexGame.activeMs})');p.clock.run_for(2000);assert p.evaluate('({ply:hexGame.ply,ms:hexGame.activeMs})')==before
   hit(p,'#restart',mobile);p.locator('.ah-config summary').click();old=p.evaluate('hexGame.strategyConfigId');p.locator('#strategy-json').fill('{"version":9}');hit(p,'#play',mobile);assert p.evaluate('hexGame.phase')=='ready';assert p.evaluate('hexGame.strategyConfigId')==old;assert '策略 JSON' in p.locator('#strategy-status').inner_text();hit(p,'#strategy-default',mobile)
   assert p.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
   for file in ['card_hex.html','autohex.html']:
    p.goto(BASE+'/'+file);hit(p,'#play',mobile)
    fixtures={}
    for kind in ['river','hill','bridge','tunnel']:
     f=p.evaluate(FIXTURE,kind);before=white_sample(p,f['mid'])
     if kind in ['river','hill']:
      hit(p,'#engineer',mobile);cell(p,f['mid'],mobile)
      assert p.evaluate('i=>hexGame.terrain[i]',f['mid'])==0;assert p.evaluate('i=>hexGame.roads[i]',f['mid'])==0
      if kind=='hill':assert p.evaluate('i=>hexGame.board[i]===1&&hexGame.turrets.some(t=>t.cell===i)&&hexGame.hillAge[i]===0',f['mid'])
     elif kind=='bridge':
      hit(p,'#card-0',mobile);cell(p,f['a'],mobile);assert p.evaluate('hexGame.ply')==f['ply'];cell(p,f['end'],mobile);assert p.evaluate('hexGame.bridges.length')==1;assert p.evaluate('i=>hexGame.terrain[i]',f['mid'])==1
     else:
      hit(p,'#tunnel',mobile);cell(p,f['a'],mobile);cell(p,f['mid'],mobile);assert p.locator('#confirm-selection').is_disabled();cell(p,f['bend'],mobile);assert p.locator('#confirm-selection').is_enabled();assert p.evaluate('hexGame.ply')==f['ply'];hit(p,'#back-selection',mobile);assert p.locator('#confirm-selection').is_disabled();cell(p,f['bend'],mobile);hit(p,'#confirm-selection',mobile);assert p.evaluate('hexGame.tunnels.length')==1;assert p.evaluate('i=>hexGame.terrain[i]',f['mid'])==1
     assert p.evaluate('hexGame.ply')==f['ply']+1
     p.evaluate('hexGame.pause();autoHexRender();autoHexSchedule()');after=white_sample(p,f['mid'])
     if kind=='river':assert after[:3]==[255,255,255],(name,file,before,after)
     fixtures[kind]={'beforeRGBA':before,'afterRGBA':after,'actualTerrain':p.evaluate('i=>hexGame.terrain[i]',f['mid'])}
     p.locator('#board').screenshot(path=str(OUT/'screenshots'/f'{name}-{file[:-5]}-{kind}.png'))
    report['cases'].append({'viewport':name,'mode':file,'dpr':dpr,'fixtures':fixtures,'overflow':p.evaluate('document.documentElement.scrollWidth>innerWidth+1')})
    assert not report['cases'][-1]['overflow']
   c.close()
  b.close()
 assert not report['errors'],report['errors'];report['sourceEndSha256']=hashes();report['sourcesUnchanged']=report['sourceEndSha256']==report['sourceSha256'];assert report['sourcesUnchanged'],'Runtime sources changed';report['passed']=True
finally:
 (OUT/'browser.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'passed':report.get('passed'), 'cases':len(report['cases']), 'errors':report['errors']},ensure_ascii=False))
