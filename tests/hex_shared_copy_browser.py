"""Targeted post-campaign text correction and full-hand UI fixtures.

Controlled state fixtures are explicitly used; these are not campaign outcomes.
Virtual timers hold the AI while real DOM/canvas actions exercise settlement.
"""
from pathlib import Path
from datetime import datetime,timezone
import os,json,hashlib
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ.get('HEX_REPORT_DIR',str(ROOT/'docs/hex-shared-core-2026-10-11/ui-post-copy')))
BASE=os.environ.get('FUGAMES_BASE_URL','http://127.0.0.1:8011')
FILES=['hex-core.js','hex-strategies.js','config/hex-strategies.json','autohex-planner.js','autohex-ui.js','autohex-ai-worker.js','card_hex.html','autohex.html']
def hashes():return {f:hashlib.sha256((ROOT/f).read_bytes()).hexdigest() for f in FILES}
OUT.mkdir(parents=True,exist_ok=True)
report={'method':__doc__,'sourceSha256':hashes(),'cases':[],'errors':[]}
def cards(p):return p.evaluate('({hand:hexGame.hands[1].slice(),ages:hexGame.handAges[1].slice(),draw:hexGame.drawPile.length,discard:hexGame.discardPile.length,ply:hexGame.ply,energy:hexGame.players[1].energy})')
try:
 with sync_playwright() as pw:
  b=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox'])
  c=b.new_context(viewport={'width':1280,'height':1000});p=c.new_page();p.on('pageerror',lambda e:report['errors'].append(str(e)))
  p.clock.install(time=datetime(2026,10,11,22,0,tzinfo=timezone.utc));p.clock.pause_at(datetime(2026,10,11,22,1,tzinfo=timezone.utc))
  p.goto(BASE+'/card_hex.html');p.select_option('#seat-count','2');p.select_option('#match-mode','allhuman');p.locator('#play').click()
  p.evaluate('''()=>{const g=hexGame;g.ply=199;g.turn=2;g.round=99;g.players[1].completedActions=100;g.players[2].completedActions=99;g.players[1].ownerTurns=g.players[2].ownerTurns=100;hexRender();}''')
  p.locator('#reveal-hand').click();p.locator('#rest').click()
  assert p.evaluate('hexGame.result.reason')=='turn-limit'
  text=p.locator('#event-log').inner_text();assert '達到行動上限，各方分數已結算。' in text;assert '十分鐘到' not in text
  report['normalCap']={'result':p.evaluate('hexGame.result'),'eventLog':text,'resultText':p.locator('#result').inner_text()}
  for page in ['card_hex.html','autohex.html']:
   for option in ['keep','timed']:
    p.goto(BASE+'/'+page);p.select_option('#timed-cards',option);p.locator('#play').click()
    p.evaluate('autoHexFocusCell(hexGame.players[1].home,24)');p.locator('#board').scroll_into_view_if_needed();at=p.evaluate('hexCellPoint(hexGame.players[1].home)')
    before=cards(p);assert len(before['hand'])==5
    p.mouse.click(at['x'],at['y']);assert cards(p)==before,'Invalid anchor deploy changed hand/energy'
    p.locator('#pause').click();p.clock.run_for(2000);assert cards(p)==before,'Paused hand aged'
    p.locator('#pause').click();p.locator('#rest').click();after=cards(p)
    assert after['hand']==before['hand'] and after['draw']==before['draw'] and after['discard']==before['discard']
    assert after['ages']==([1]*5 if option=='timed' else [0]*5)
    assert p.locator('#hand-count').inner_text()=='5 / 5'
    p.locator('.rules summary').click();rules=p.locator('.rules').inner_text();assert '滿 5 張' in rules and '不自動棄牌' in rules and '無效' in rules
    row={'page':page,'option':option,'invalidAndPauseUnchanged':True,'before':before,'afterFullHandAction':after}
    if option=='timed':
     # One existing card is about to expire; accepting a real rest ages it out,
     # then draws exactly one replacement, without touching the other four.
     p.goto(BASE+'/'+page);p.select_option('#timed-cards','timed');p.locator('#play').click();p.evaluate('hexGame.handAges[1]=[2,0,0,0,0];hexRender()')
     before=cards(p);p.locator('#rest').click();after=cards(p)
     assert after['hand'][:4]==before['hand'][1:]
     assert after['ages']==[1,1,1,1,0] and after['draw']==before['draw']-1 and after['discard']==before['discard']+1
     assert '剩 3 次己方行動' in p.locator('#hand').inner_text()
     row['expiryThenOneDraw']={'before':before,'after':after,'labels':p.locator('#hand').inner_text()}
    report['cases'].append(row)
   if page=='autohex.html':
    p.evaluate("hexGame._event('campaign-end',0,'fixture');hexRender()")
    assert '十分鐘到，六方分數已一起結算。' in p.locator('#event-log').inner_text()
  b.close()
 assert hashes()==report['sourceSha256'];assert not report['errors'],report['errors'];report['passed']=True
finally:(OUT/'browser.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'passed':report.get('passed'),'cases':len(report['cases']),'errors':report['errors']},ensure_ascii=False))
