"""Actual foreground normal-Hex games through the UI Worker; no virtual clock or state writes."""
from pathlib import Path
import hashlib,json,os,time
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=Path(os.environ.get('HEX_REPORT_DIR',str(ROOT/'docs/hex-shared-core-2026-10-11/ui-live')));BASE=os.environ.get('FUGAMES_BASE_URL','http://127.0.0.1:8011')
FILES=['config/hex-strategies.json','hex-core.js','hex-strategies.js','autohex-planner.js','autohex-ai-worker.js','cardhex-engine.js','autohex-ui.js','autohex-visuals.js','autohex.css','card_hex.html']
def hashes():return {f:hashlib.sha256((ROOT/f).read_bytes()).hexdigest() for f in FILES}
OUT.mkdir(parents=True,exist_ok=True);(OUT/'screenshots').mkdir(exist_ok=True)
report={'sourceSha256':hashes(),'method':'Real foreground normal games via UI Worker with 0.05-second interval. No virtual clocks, engine mutation, or bulk actions. CPU may be shared with development studies; not a performance benchmark.','games':[],'human':{},'errors':[]}
try:
 with sync_playwright() as pw:
  b=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox'])
  for count in [2,6]:
   c=b.new_context(viewport={'width':1440,'height':1100});p=c.new_page();p.on('pageerror',lambda e:report['errors'].append(str(e)))
   p.goto(BASE+'/card_hex.html?seed=shared-live-'+str(count));p.select_option('#seat-count',str(count));p.select_option('#match-mode','spectator');p.locator('#step-seconds').fill('0.05');p.locator('#step-seconds').dispatch_event('change');p.bring_to_front();p.locator('#play').click();started=time.monotonic();last_log=0;samples=[]
   while True:
    time.sleep(.4);state=p.evaluate('''()=>({phase:hexGame.phase,ply:hexGame.ply,activeMs:hexGame.activeMs,round:hexGame.round,observer:hexUI().observer,hidden:document.hidden,handButtons:document.querySelectorAll('#hand button').length,goals:hexGame.telemetry.goalArrivals})''')
    assert not state['hidden'] and state['observer']==0 and state['handButtons']==0
    elapsed=time.monotonic()-started;assert elapsed<240,(count,state)
    if elapsed-last_log>=10 or state['phase']=='over':samples.append({'wallSeconds':round(elapsed,3),**state});last_log=elapsed;print(count,samples[-1],flush=True)
    if state['phase']=='over':break
   ending=p.evaluate('''()=>({result:hexGame.result,telemetry:hexGame.telemetry,planning:autoHexPlanningDebug(),config:hexGame.observation(0).coreConfig,strategyConfigId:hexGame.strategyConfigId,players:hexGame.observation(0).players,overflow:document.documentElement.scrollWidth>innerWidth+1})''')
   assert ending['result']['reason'] in ['connection','turn-limit'];assert ending['result']['winners'];assert state['ply']<=count*100;assert ending['planning']['workerCount']==state['ply'];assert ending['planning']['synchronousCount']==0;assert not ending['overflow'];assert p.locator('#result').is_visible();assert p.locator('#sandbox').is_hidden();assert p.locator('#pause').is_disabled()
   p.locator('#result').scroll_into_view_if_needed();p.screenshot(path=str(OUT/'screenshots'/f'normal-{count}-result.png'))
   p.locator('#board').screenshot(path=str(OUT/'screenshots'/f'normal-{count}-board.png'))
   report['games'].append({'playerCount':count,'samples':samples,'ending':ending});(OUT/'browser.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');c.close()
  c=b.new_context(viewport={'width':390,'height':844},device_scale_factor=3,is_mobile=True,has_touch=True);p=c.new_page();p.on('pageerror',lambda e:report['errors'].append(str(e)))
  p.goto(BASE+'/card_hex.html?seed=shared-human-resume');p.locator('#step-seconds').fill('0.05');p.locator('#step-seconds').dispatch_event('change')
  p.locator('.ah-config summary').click();config=p.evaluate('HexStrategies.normalize(HexStrategies.DEFAULT_CONFIG)');config['profiles'][1]['name']='測試航空策略';config['profiles'][1]['route']['side']=1
  p.locator('#strategy-file').set_input_files({'name':'strategy-test.json','mimeType':'application/json','buffer':json.dumps(config,ensure_ascii=False).encode()});p.wait_for_function("document.getElementById('strategy-status').textContent.includes('驗證成功')")
  custom=p.evaluate('hexGame.strategyConfigId');assert custom==p.evaluate('HexStrategies.id',config)
  p.select_option('#seat-profile-2','flanker');p.select_option('#timed-cards','timed');p.select_option('#terrain-mode','plain');p.locator('.ah-config summary').click();p.locator('#play').tap()
  assert p.evaluate('hexGame.players[2].strategyId')=='flanker';assert p.evaluate('hexGame.terrain.every(v=>v===0)');assert p.evaluate('hexGame.timedCards')
  actions=[]
  for n in range(3):
   p.wait_for_function('hexGame.turn===1 || hexGame.phase==="over"');assert p.evaluate('hexGame.phase')=='running'
   p.locator('#pause').tap();before=p.evaluate('({ply:hexGame.ply,ms:hexGame.activeMs})');time.sleep(.25);assert p.evaluate('({ply:hexGame.ply,ms:hexGame.activeMs})')==before;p.locator('#pause').tap()
   target=p.evaluate('''()=>{const v=hexGame.observation(1);return HexAPI.CELLS.find(c=>HexAPI.legalAction(v,{type:'deploy',cells:[c.i]})&&!v.board[c.i]).i;}''');p.evaluate('autoHexFocusCell',target);p.locator('#deploy').tap();p.locator('#board').scroll_into_view_if_needed();point=p.evaluate('hexCellPoint',target);before=p.evaluate('hexGame.ply');p.touchscreen.tap(point['x'],point['y']);assert p.evaluate('i=>hexGame.board[i]===1',target);actions.append({'cell':target,'beforePly':before})
   assert p.evaluate('hexUI().observer')==1
   cards=p.locator('#hand button').evaluate_all('(els)=>els.map(e=>e.dataset.action)');assert cards==p.evaluate('hexGame.observation(1).hand')
  p.wait_for_function('hexGame.turn===1');p.locator('#pause').tap();report['human']={'actions':actions,'ply':p.evaluate('hexGame.ply'),'strategyConfigId':custom,'timedCardLabels':p.locator('#hand').inner_text(),'pauseResume':True,'worker':p.evaluate('autoHexPlanningDebug()')};p.locator('#board').screenshot(path=str(OUT/'screenshots'/'mobile-human-board.png'))
  p.locator('#replay').tap();assert p.evaluate('hexGame.strategyConfigId')==custom;assert p.evaluate('hexGame.players[2].strategyId')=='flanker';assert p.evaluate('hexGame.timedCards');assert p.evaluate('hexGame.terrain.every(v=>v===0)');assert p.evaluate('hexGame.ply')==0;report['human']['replayPreservedSetup']=True
  c.close();b.close()
 assert not report['errors'],report['errors'];report['sourceEndSha256']=hashes();report['sourcesUnchanged']=report['sourceEndSha256']==report['sourceSha256'];report['passed']=True
finally:(OUT/'browser.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'passed':report.get('passed'),'games':[{'seats':g['playerCount'],'result':g['ending']['result']} for g in report['games']],'human':report['human'],'errors':report['errors']},ensure_ascii=False),flush=True)
