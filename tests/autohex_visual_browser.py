"""Public board legibility and interaction acceptance. Baseline is routed from Git, never reset."""
from pathlib import Path
from datetime import datetime, timezone
import argparse, json, os, subprocess
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs/autohex-visual-2026-10-11';(OUT/'screenshots').mkdir(parents=True,exist_ok=True)
BASE=os.environ.get('FUGAMES_BASE_URL','http://127.0.0.1:8011')
args=argparse.ArgumentParser();args.add_argument('--baseline',action='store_true');opt=args.parse_args()
report={'baseline':'13c94a8' if opt.baseline else None,'clock':'virtual time for lifecycle assertions only','viewports':[],'errors':[]}
FIXTURE='''() => {
 const E=AutoHex,g=autoHexGame,at=E.index;g.reset('legibility-fixture',6,0);
 for(const k of ['board','terrain','roads','shields','unsupplied'])g[k].fill(0);
 for(const p of E.PLAYERS)g.board[g.players[p].home]=p;
 for(let q=0;q<=18;q++)g.board[at(q,-9)]=1;
 for(let r=-9;r<=0;r++)g.board[at(0,r)]=1;
 for(let r=-9;r<=-5;r++)g.board[at(5,r)]=1;
 g.board[at(2,-4)]=g.board[at(3,-4)]=1;
 g.bridges=[{owner:1,a:at(0,-4),b:at(2,-4)}];
 g.board[at(1,0)]=2;g.board[at(6,-5)]=3;g.shields[at(6,-5)]=7;
 for(const [q,r] of [[5,3],[6,3],[5,4]]){g.board[at(q,r)]=4;g.unsupplied[at(q,r)]=3;}
 g.board[at(-5,0)]=5;
 g.turrets=[{owner:1,cell:at(0,0),countdown:1,life:20},{owner:1,cell:at(5,-5),countdown:1,life:20},{owner:5,cell:at(-5,0),countdown:2,life:20}];
 g.hands[1]=['destroy','turret','shield'];g.start();g.pause();autoHexRender();autoHexSchedule();
 return {center:at(0,0),other:at(5,-5),target:at(1,0),blocked:at(6,-5)};
}'''
def state(p):return p.evaluate('JSON.stringify({board:Array.from(autoHexGame.board),hands:autoHexGame.hands,ply:autoHexGame.ply,turn:autoHexGame.turn,energy:autoHexGame.players.map(p=>p&&p.energy)})')
def clickcell(p,i,mobile=False):
 p.locator('#board').scroll_into_view_if_needed();pt=p.evaluate('(i)=>autoHexCellPoint(i)',i)
 p.touchscreen.tap(pt['x'],pt['y']) if mobile else p.mouse.click(pt['x'],pt['y'])
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for label,w,h,dpr,mobile in [('desktop',1440,1100,1,False),('mobile',390,844,3,True),('narrow',320,740,2,True)]:
  ctx=browser.new_context(viewport={'width':w,'height':h},device_scale_factor=dpr,is_mobile=mobile,has_touch=mobile)
  p=ctx.new_page();p.on('pageerror',lambda e:report['errors'].append(str(e)))
  p.clock.install(time=datetime(2026,10,11,14,0,tzinfo=timezone.utc));p.clock.pause_at(datetime(2026,10,11,14,1,tzinfo=timezone.utc))
  if opt.baseline:
   for f in ['autohex-engine.js','autohex-ui.js','autohex.html','autohex.css']:
    source=subprocess.check_output(['git','show','13c94a8:'+f],cwd=ROOT)
    mime='text/html' if f.endswith('html') else 'text/css' if f.endswith('css') else 'application/javascript'
    p.route('**/'+f+'*',lambda route,request,body=source,mime=mime:route.fulfill(status=200,body=body,content_type=mime))
  p.goto(BASE+'/autohex.html?seed=legibility-fixture');p.wait_for_function('window.autoHexGame')
  p.locator('#match-mode').select_option('spectator');ids=p.evaluate(FIXTURE)
  p.locator('#fit-map').click();p.locator('#board-wrap').screenshot(path=str(OUT/f"screenshots/{'before' if opt.baseline else 'after'}-{label}-whole.png"))
  assert p.evaluate('document.documentElement.scrollWidth<=innerWidth')
  row={'label':label,'width':w,'height':h,'dpr':dpr,'overflow':False}
  if not opt.baseline:
   debug=p.evaluate('autoHexVisualDebug()');assert debug['turretCount']==3 and debug['minTurretPixel']>=12
   assert len(debug['supplyLinks'])>=30
   before=state(p);p.locator('#inspect-mode').click();clickcell(p,ids['center'],mobile)
   debug=p.evaluate('autoHexVisualDebug()');assert state(p)==before and debug['range']['radius']==3
   assert ids['target'] in debug['range']['targets'];assert len(debug['range']['cells'])==37
   p.locator('#board-wrap').screenshot(path=str(OUT/f'screenshots/after-{label}-range.png'))
   p.locator('#supply-mode').select_option('off');assert not p.evaluate('autoHexVisualDebug().supplyLinks.length')
   p.locator('#supply-mode').select_option('1');assert all(x['owner']==1 for x in p.evaluate('autoHexVisualDebug().supplyLinks'))
   p.locator('#supply-mode').select_option('all')
  # Same genuine simultaneous public battery resolution on both builds.
  p.evaluate("autoHexGame.start();autoHexGame.act({type:'rest',cells:[]});autoHexGame.pause();autoHexRender();autoHexSchedule()")
  p.locator('#board-wrap').screenshot(path=str(OUT/f"screenshots/{'before' if opt.baseline else 'after'}-{label}-impacts.png"))
  p.evaluate('(i)=>autoHexFocusCell(i)',ids['center'])
  p.locator('#board-wrap').screenshot(path=str(OUT/f"screenshots/{'before' if opt.baseline else 'after'}-{label}-detail.png"))
  if not opt.baseline:
   debug=p.evaluate('autoHexVisualDebug()');shots=[e for e in debug['effects'] if e['source']=='turret']
   assert len(shots)==2 and {e['type'] for e in shots}=={'destroy','shield-block'}
   frozen=p.evaluate('JSON.stringify(autoHexVisualDebug().effects)');p.clock.run_for(5000)
   assert p.evaluate('JSON.stringify(autoHexVisualDebug().effects)')==frozen
   p.evaluate('autoHexRender();autoHexRender()');assert p.evaluate('JSON.stringify(autoHexVisualDebug().effects)')==frozen
   # No private hand/deck or made-up hidden trap can influence this public canvas.
   canvas=p.locator('#board').evaluate('(c)=>c.toDataURL()');dom=p.locator('#event-log').inner_html()
   p.evaluate("for(const h of autoHexGame.hands)h.reverse();autoHexGame.drawPile.reverse();autoHexGame.traps=[{owner:2,cell:0}];autoHexGame.fog={secret:true};autoHexRender()")
   assert p.locator('#board').evaluate('(c)=>c.toDataURL()')==canvas and p.locator('#event-log').inner_html()==dom
   p.emulate_media(reduced_motion='reduce');p.evaluate('autoHexRender()');assert p.evaluate('autoHexVisualDebug().reduced')
   p.locator('#board-wrap').screenshot(path=str(OUT/f'screenshots/after-{label}-reduced-motion.png'))
   p.locator('#pause').click();p.clock.run_for(2200);p.locator('#pause').click()
   assert all(e['age']<e['duration'] for e in p.evaluate('autoHexVisualDebug().effects'))
   p.locator('#replay').click();assert not p.evaluate('autoHexVisualDebug().activeEffects')
   p.clock.run_for(1000);assert p.evaluate('autoHexGame.ply')==0
   row.update(turretMinCssPixels=12,publicSupplyLinks=len(debug['supplyLinks']),rangeCells=37,simultaneousShots=2,pausedEffectsFrozen=True,privateDataCanvasInvariant=True,reducedMotion=True,replayClears=True)
  report['viewports'].append(row);ctx.close()
 if not opt.baseline:
  ctx=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=3,is_mobile=True,has_touch=True)
  p=ctx.new_page();p.on('pageerror',lambda e:report['errors'].append(str(e)))
  p.goto(BASE+'/card_hex.html');p.wait_for_function('window.hexGame')
  p.evaluate("hexGame.traps=[{owner:1,cell:45},{owner:2,cell:15}];hexRender()")
  own_count=p.locator('.own-trap').count();assert own_count==7
  before=p.locator('#board').inner_html()
  p.evaluate("hexGame.traps[1].cell=70;hexGame.hands[2].reverse();hexGame.decks[3].reverse();hexRender()")
  assert p.locator('#board').inner_html()==before
  p.locator('#board').screenshot(path=str(OUT/'screenshots/original-hex-own-trap-mobile.png'))
  p.locator('#match-mode').select_option('spectator');p.evaluate("hexGame.traps=[{owner:1,cell:45},{owner:2,cell:15}];hexRender()")
  assert p.locator('.own-trap').count()==0
  report['originalHexTrapPrivacy']={'ownZoneCells':own_count,'enemyPermutationsLeaveBoardIdentical':True,'spectatorHiddenZones':0}
  ctx.close()
 browser.close()
assert not report['errors'],report['errors']
(OUT/('before-browser.json' if opt.baseline else 'visual-browser.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
