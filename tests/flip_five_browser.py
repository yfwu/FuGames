"""Real foreground Flip Five games through trusted desktop clicks/mobile taps.

The human slot is driven by the published legacy public-board chooser; no game
state or actions are injected. This is UI acceptance, not an AI strength study.
No virtual clock is used. The new bounded AI runs in its real browser Worker.
"""
from pathlib import Path
from datetime import datetime, timezone
import os, json, hashlib, time, re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ.get('FLIP_REPORT_DIR',str(ROOT/'docs/flipfive-2026-10-11/ui')))
BASE=os.environ.get('FUGAMES_BASE_URL','http://127.0.0.1:8011')
FILES=['flip_five.html','flip-five-engine.js','flip-five-ai.js','flip-five-ai-worker.js']
def hashes():return {f:hashlib.sha256((ROOT/f).read_bytes()).hexdigest() for f in FILES}
OUT.mkdir(parents=True,exist_ok=True);(OUT/'screenshots').mkdir(exist_ok=True)
report={'startedUtc':datetime.now(timezone.utc).isoformat(),'sourceSha256':hashes(),
        'method':__doc__,'viewports':[],'games':[],'errors':[],'requests':[]}

def until(p,condition,seconds=30):
 end=time.monotonic()+seconds
 while not p.evaluate(condition):
  if time.monotonic()>end:raise AssertionError('Timed out: '+condition)
  p.wait_for_timeout(30)

def check_board(p):
 data=p.evaluate('''()=>({phase:flipGame.phase,ply:flipGame.ply,turn:flipGame.turn,
   board:flipGame.board,first:flipGame.first,result:flipGame.result,
   hidden:document.hidden,overflow:document.documentElement.scrollWidth>innerWidth,
   rendered:[...document.querySelectorAll('.flip-cell')].map(b=>Number(b.dataset.owner)),
   stats:flipAIStats(),pending:flipUI().pending,scheduled:flipUI().scheduled})''')
 assert not data['hidden'] and not data['overflow'],data
 assert len(data['board'])==81 and all(x in [0,1,2] for x in data['board'])
 assert sum(bool(x) for x in data['board'])==data['ply']
 assert data['rendered']==data['board']
 if data['stats']['lastSearch']:assert data['stats']['lastSearch']['nodes']<=36000
 return data

def activate(p,selector,mobile):
 locator=p.locator(selector)
 if mobile:locator.tap()
 else:locator.click()

def finish_game(p,mobile,label):
 start=time.monotonic();states=[];human_inputs=0
 while True:
  data=check_board(p)
  if not states or states[-1]['ply']!=data['ply']:
   states.append({'ply':data['ply'],'turn':data['turn'],'phase':data['phase']})
  if data['phase']=='over':break
  assert data['phase']=='running',data
  assert time.monotonic()-start<150,'Game did not finish'
  if data['turn']==1:
   move=p.evaluate("FlipFive.chooseLegacyMove({...flipGame.observation(1),profile:'architect'})")
   assert move and not data['board'][move['cell']]
   activate(p,f'[data-cell="{move["cell"]}"]',mobile);human_inputs+=1
  else:p.wait_for_timeout(40)
 assert data['ply']<=81 and data['result']
 assert not data['pending'] and not data['scheduled']
 assert p.locator('#result').is_visible()
 winning=p.evaluate('[...new Set(flipGame.result.lines.flat(2))].sort((a,b)=>a-b)')
 rendered=p.evaluate('[...document.querySelectorAll(".flip-cell.winning")].map(b=>Number(b.dataset.cell)).sort((a,b)=>a-b)')
 assert winning==rendered
 report['games'].append({'label':label,'wallSeconds':round(time.monotonic()-start,3),
                         'humanTrustedInputs':human_inputs,'states':states,'ending':data,
                         'resultText':p.locator('#result').inner_text(),
                         'acceptedActions':p.evaluate('window.flipAccepted')})
 p.screenshot(path=str(OUT/'screenshots'/f'{label}-result.png'),full_page=True)
 print(json.dumps({'game':label,'ply':data['ply'],'winner':data['result']['winner'],
                   'workerDecisions':data['stats']['workerCount']}),flush=True)

try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox'])
  for name,width,height,dpr,mobile in [('desktop',1280,1000,1,False),('mobile',390,844,3,True)]:
   context=browser.new_context(viewport={'width':width,'height':height},device_scale_factor=dpr,has_touch=mobile,is_mobile=mobile)
   page=context.new_page();page.on('pageerror',lambda e:report['errors'].append(str(e)))
   page.on('response',lambda r:report['requests'].append({'url':r.url,'status':r.status}) if re.search(r'flip[-_]five|flip-five',r.url) else None)
   page.goto(BASE+'/flip_five.html');page.bring_to_front()
   page.evaluate('''()=>{window.flipAccepted=[];const act=FlipFive.Game.prototype.act;
     FlipFive.Game.prototype.act=function(cell,...args){const before=this.board.slice();
       const ok=act.call(this,cell,...args);if(ok)flipAccepted.push({ply:this.ply,player:this.last.player,
         cell,flipped:this.last.flipped.slice(),changed:this.board.map((v,i)=>v!==before[i]?i:-1).filter(i=>i>=0)});return ok;};}''')
   assert len(page.locator('.flip-cell').all())==81
   # Match the saved baseline: architect, human opens at E5, then pause at ply 2.
   if mobile:activate(page,'#play',True)
   else:
    page.locator('#play').focus();page.keyboard.press('Space')
    assert page.evaluate('flipGame.phase')=='running'
    assert page.evaluate('document.activeElement.dataset.cell')=='40'
    page.keyboard.press('ArrowRight');assert page.evaluate('document.activeElement.dataset.cell')=='41'
    page.keyboard.press('ArrowLeft');assert page.evaluate('document.activeElement.dataset.cell')=='40'
   activate(page,'[data-cell="40"]',mobile)
   until(page,'flipGame.ply===2');activate(page,'#pause',mobile)
   frozen=check_board(page);page.wait_for_timeout(600);assert check_board(page)==frozen
   assert frozen['phase']=='paused' and not frozen['pending']
   page.screenshot(path=str(OUT/'screenshots'/f'after-{name}.png'),full_page=True)
   report['viewports'].append({'name':name,'width':width,'height':height,'dpr':dpr,'baselineComparison':frozen})
   if mobile:activate(page,'#pause',True)
   else:page.locator('#pause').focus();page.keyboard.press('Space')
   assert page.evaluate('flipGame.phase')=='running'
   if not mobile:
    # Actual keyboard placement, including a live preview, before the controller takes over.
    cell=page.evaluate('flipGame.board.findIndex(v=>!v)')
    page.locator(f'[data-cell="{cell}"]').focus()
    assert '落子後翻轉' in page.locator('#preview').inner_text()
    page.keyboard.press('Enter');until(page,'flipGame.ply>=4')
   finish_game(page,mobile,name+'-architect-human-first')
   # A real result-screen profile change and rematch alternate the starter.
   page.select_option('#personality','flipper');page.evaluate('window.flipAccepted=[]');activate(page,'#play',mobile)
   assert page.evaluate('flipGame.first')==2 and page.evaluate('flipGame.profile')=='flipper'
   assert page.evaluate('flipGame.ply')==0
   assert page.locator('#personality').is_disabled()
   finish_game(page,mobile,name+'-flipper-ai-first')
   activate(page,'#restart',mobile)
   assert page.evaluate('flipGame.first')==1 and page.evaluate('flipGame.ply')==0
   assert page.evaluate('flipGame.board.every(v=>v===0)')
   activate(page,'#pause',mobile);context.close()
  browser.close()
 assert not report['errors'],report['errors']
 assert all(row['status']==200 for row in report['requests']),report['requests']
 assert hashes()==report['sourceSha256'],'Source changed during acceptance'
 before=json.loads((OUT/'before-browser.json').read_text())
 css=re.search(r'<style>(.*?)</style>',(ROOT/'flip_five.html').read_text(),re.S).group(1)
 report['stylesheetSha256']=hashlib.sha256(css.encode()).hexdigest()
 report['stylesheetPreserved']=report['stylesheetSha256']==before['cssSha256']
 assert report['stylesheetPreserved'],'Existing game stylesheet changed'
 report['passed']=True
finally:
 report['finishedUtc']=datetime.now(timezone.utc).isoformat()
 (OUT/'browser.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'passed':report.get('passed'),'games':len(report['games']),'errors':report['errors']}))
