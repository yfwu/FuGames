"""Actual bounded Worker with adversarial delivery and identical fallback checks.
Virtual page clocks control the 450 ms UI timer; Worker computation is real.
"""
from pathlib import Path
from datetime import datetime,timezone
import os,json,hashlib,time
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=Path(os.environ.get('FLIP_REPORT_DIR',str(ROOT/'docs/flipfive-2026-10-11/ui')));BASE=os.environ.get('FUGAMES_BASE_URL','http://127.0.0.1:8011')
FILES=['flip_five.html','flip-five-engine.js','flip-five-ai.js','flip-five-ai-worker.js']
def hashes():return {f:hashlib.sha256((ROOT/f).read_bytes()).hexdigest() for f in FILES}
OUT.mkdir(parents=True,exist_ok=True)
report={'sourceSha256':hashes(),'method':__doc__,'checks':[],'errors':[]}
WRAP='''(()=>{const Native=Worker;const a=window.workerAudit={created:0,terminated:[],requests:[],queue:[],history:[]};window.Worker=class extends Native{constructor(...args){super(...args);this.auditId=++a.created;}terminate(){a.terminated.push(this.auditId);return super.terminate();}postMessage(job,...args){if(job.observation.player!==2||job.turn!==2||job.observation.board.filter(Boolean).length!==job.ply)throw Error('Mismatched board');a.requests.push({worker:this.auditId,id:job.id,generation:job.generation,ply:job.ply,turn:job.turn,options:job.options,observation:job.observation});return super.postMessage(job,...args);}addEventListener(type,cb,...args){if(type!=='message')return super.addEventListener(type,cb,...args);return super.addEventListener(type,event=>{const row={worker:this.auditId,data:event.data,cb};a.queue.push(row);a.history.push(row);},...args);}};window.releaseDecision=(patch=null,retain=false)=>{const row=a.queue[0];if(!row)throw Error('No reply');if(!retain)a.queue.shift();row.cb(new MessageEvent('message',{data:patch?{...row.data,...patch}:row.data}));};window.duplicateDecision=i=>{const row=a.history[i];row.cb(new MessageEvent('message',{data:row.data}));};})();'''
def until(p,test):
 deadline=time.monotonic()+30
 while not p.evaluate(test):
  if time.monotonic()>deadline:raise AssertionError('Timed out: '+test)
  time.sleep(.02)
def state(p):return p.evaluate('JSON.stringify({board:flipGame.board,ply:flipGame.ply,turn:flipGame.turn,first:flipGame.first,phase:flipGame.phase,last:flipGame.last})')
def begin(p,profile='architect'):
 p.goto(BASE+'/flip_five.html');p.select_option('#personality',profile);p.locator('#play').click();p.locator('[data-cell="40"]').click();p.clock.run_for(450);until(p,'workerAudit.queue.length===1');assert p.evaluate('flipGame.ply')==1;assert p.evaluate('!!flipUI().pending')
try:
 with sync_playwright() as pw:
  b=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox']);c=b.new_context();c.add_init_script(WRAP);p=c.new_page();p.on('pageerror',lambda e:report['errors'].append(str(e)));p.clock.install(time=datetime(2026,10,11,21,0,tzinfo=timezone.utc));p.clock.pause_at(datetime(2026,10,11,21,1,tzinfo=timezone.utc))
  begin(p);before=state(p)
  for key in ['id','generation','ply','turn']:
   p.evaluate('key=>releaseDecision({[key]:workerAudit.queue[0].data[key]+1},true)',key);assert state(p)==before;assert p.evaluate('!!flipUI().pending')
  expected=p.evaluate('FlipFiveAI.chooseMove(flipGame.observation(2),flipUI().searchOptions)');p.evaluate('releaseDecision()');until(p,'flipGame.ply===2');assert p.evaluate('flipGame.last.cell')==expected['cell'];p.evaluate('duplicateDecision(0)');assert p.evaluate('flipGame.ply')==2
  cell=p.evaluate('flipGame.board.findIndex(v=>!v)');p.locator(f'[data-cell="{cell}"]').click();p.clock.run_for(450);until(p,'workerAudit.queue.length===1');assert p.evaluate('workerAudit.created')==1;p.evaluate('releaseDecision()');until(p,'flipGame.ply===4');assert p.evaluate('flipAIStats().workerCount')==2
  assert p.evaluate('flipAIStats().lastSearch.nodes<=flipUI().searchOptions.nodeBudget')
  report['checks'].append('generation/id/ply/turn mismatches and duplicate replies rejected; identical new-algorithm decision; idle Worker reused; bounded nodes')
  for operation in ['pause','restart','visibility','blur']:
   begin(p)
   if operation in ['pause','restart']:p.locator('#'+operation).click()
   elif operation=='visibility':p.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))")
   else:p.evaluate("window.dispatchEvent(new Event('blur'))")
   assert not p.evaluate('!!flipUI().pending');assert p.evaluate('workerAudit.terminated.length')==1;after=state(p);p.evaluate('releaseDecision()');assert state(p)==after
   if operation!='restart':p.clock.run_for(1000);assert state(p)==after
   if operation=='visibility':p.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'))");assert p.evaluate('flipGame.phase')=='paused'
   if operation!='restart':p.locator('#pause').click()
   else:assert p.evaluate('flipGame.first')==2 and p.evaluate('flipGame.ply')==0
   p.clock.run_for(450);until(p,'workerAudit.queue.length===1');p.evaluate('releaseDecision()');until(p,'flipGame.ply==='+('1' if operation=='restart' else '2'));assert p.evaluate('workerAudit.created')==2
   report['checks'].append(operation+' cancels in-flight work; stale reply ignored; explicit resume/new game gets one fresh decision')
  begin(p)
  for _ in range(8):p.locator('#restart').click()
  clean=state(p);p.evaluate('releaseDecision()');assert state(p)==clean;assert p.evaluate('flipGame.first')==1;assert p.evaluate('flipGame.ply')==0
  p.locator('[data-cell="40"]').click();p.clock.run_for(450);until(p,'workerAudit.queue.length===1');p.evaluate('releaseDecision()');until(p,'flipGame.ply===2');p.evaluate('duplicateDecision(0);duplicateDecision(1)');assert p.evaluate('flipGame.ply')==2
  report['checks'].append('eight rapid restarts alternate starter, clear board and reject old/duplicate decisions')
  report['requests']=p.evaluate('workerAudit.requests');report['stats']=p.evaluate('flipAIStats()');c.close()
  fallback=[]
  for profile in ['architect','flipper']:
   c=b.new_context();c.add_init_script('window.Worker=undefined');p=c.new_page();p.on('pageerror',lambda e:report['errors'].append(str(e)));p.clock.install(time=datetime(2026,10,11,21,0,tzinfo=timezone.utc));p.clock.pause_at(datetime(2026,10,11,21,1,tzinfo=timezone.utc));p.goto(BASE+'/flip_five.html');p.select_option('#personality',profile);p.locator('#play').click();p.locator('[data-cell="40"]').click();before=p.evaluate('JSON.stringify(flipGame.board)');expected=p.evaluate('FlipFiveAI.chooseMove(flipGame.observation(2),flipUI().searchOptions)');assert p.evaluate('JSON.stringify(flipGame.board)')==before;p.clock.run_for(450);until(p,'flipGame.ply===2');assert p.evaluate('flipGame.last.cell')==expected['cell'];assert p.evaluate('flipAIStats().lastMode')=='fallback';assert p.evaluate('flipAIStats().lastSearch.nodes')==expected['stats']['nodes'];fallback.append({'profile':profile,'cell':expected['cell'],'stats':p.evaluate('flipAIStats()')});c.close()
  report['fallback']=fallback;report['checks'].append('missing Worker uses identical deterministic bounded algorithm for both personalities; public input unmodified');b.close()
 assert not report['errors'],report['errors'];assert hashes()==report['sourceSha256'];report['passed']=True
finally:(OUT/'worker-browser.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'passed':report.get('passed'),'checks':report['checks'],'errors':report['errors']},ensure_ascii=False))
