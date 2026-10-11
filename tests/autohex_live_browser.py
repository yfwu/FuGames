"""Actual foreground Chromium campaign at default pacing, never a virtual clock.

Run only after engine/UI validation. This intentionally takes at least ten minutes.
The ordinary Node suite does not run this browser acceptance experiment.
"""
from pathlib import Path
from datetime import datetime, timezone
from collections import Counter
import hashlib, json, os, time
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('AUTOHEX_REPORT_DIR', str(ROOT/'docs/autohex-2026-10-11')))
BASE = os.environ.get('FUGAMES_BASE_URL', 'http://127.0.0.1:8011')
FILES = ['autohex-engine.js', 'autohex-ui.js', 'autohex.html', 'autohex.css', 'autohex-visuals.js']
def hashes():
    return {f: hashlib.sha256((ROOT/f).read_bytes()).hexdigest() for f in FILES}

report = {'kind':'real wall-clock foreground Chromium; no virtual time',
          'seed':'autohex-live-2026-10-11', 'startedUtc':datetime.now(timezone.utc).isoformat(),
          'sourceHashes':hashes(), 'snapshots':[], 'pageErrors':[], 'consoleErrors':[]}
OUT.mkdir(parents=True, exist_ok=True)
(OUT/'screenshots').mkdir(exist_ok=True)
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    ctx = browser.new_context(viewport={'width':1440,'height':1100}, device_scale_factor=1)
    p = ctx.new_page()
    p.on('pageerror', lambda e: report['pageErrors'].append(str(e)))
    p.on('console', lambda m: report['consoleErrors'].append(m.text) if m.type=='error' else None)
    p.goto(BASE+'/autohex.html?seed='+report['seed'])
    p.wait_for_function('window.autoHexGame && window.AutoHex')
    assert p.locator('#step-seconds').input_value() in ['0.3','0.30'], 'default speed changed'
    p.locator('#match-mode').select_option('spectator')
    p.evaluate('''() => {
      window.liveAcceptance={actions:[], hiddenEvents:0};
      document.addEventListener('visibilitychange',()=>{if(document.hidden)liveAcceptance.hiddenEvents++});
      const original=AutoHex.Game.prototype.act;
      AutoHex.Game.prototype.act=function(action){
        const before=Array.from(this.board), active=this.activeMs, player=this.turn;
        const ok=original.call(this,action);
        if(ok){
          let changes=0, losses=0;
          for(let i=0;i<before.length;i++)if(before[i]!==this.board[i]){changes++;if(before[i])losses++;}
          liveAcceptance.actions.push({activeMs:active,type:action.type,player,changes,losses});
        }
        return ok;
      };
    }''')
    p.bring_to_front()
    start = time.monotonic()
    p.locator('#play').click()
    next_sample = 0
    shot_mid = False
    while True:
        wall = time.monotonic()-start
        if wall > 780:
            raise AssertionError('Campaign did not finish within 13 wall minutes')
        info = p.evaluate('''() => ({phase:autoHexGame.phase,activeMs:autoHexGame.activeMs,
          ply:autoHexGame.ply,round:autoHexGame.round,hidden:document.hidden,
          speed:document.querySelector('#step-seconds').value,
          players:autoHexGame.observation(0).players,
          boardCounts:Array.from({length:7},(_,n)=>Array.from(autoHexGame.board).filter(x=>x===n).length),
          bridges:autoHexGame.bridges.length,turrets:autoHexGame.turrets.length,
          alliances:autoHexGame.observation(0).alliances,
          drawCount:autoHexGame.observation(0).drawCount,discardCount:autoHexGame.observation(0).discardCount,
          actions:liveAcceptance.actions.length,hiddenEvents:liveAcceptance.hiddenEvents,
          overflow:document.documentElement.scrollWidth>innerWidth,
          visuals:window.autoHexVisualDebug ? {activeEffects:autoHexVisualDebug().activeEffects,seenCount:autoHexVisualDebug().seenCount} : null,
          strategic:{airports:autoHexGame.airports,neutralWarning:autoHexGame.neutralWarning,telemetry:autoHexGame.telemetry}})''')
        wall = time.monotonic()-start
        assert not info['hidden'] and not info['hiddenEvents'], 'Live campaign left foreground'
        assert not info['overflow']
        if info['visuals']:
            assert info['visuals']['activeEffects'] <= 64 and info['visuals']['seenCount'] <= 256
        assert float(info['speed']) == .30
        assert info['activeMs'] <= wall*1000+150, 'Active clock outran wall clock'
        if wall >= next_sample or info['phase']=='over':
            report['snapshots'].append(dict(wallSeconds=round(wall,3), **info))
            print(json.dumps({'wallSeconds':round(wall,1),'activeMs':info['activeMs'],
                              'ply':info['ply'],'phase':info['phase'],'counts':info['boardCounts']}), flush=True)
            next_sample = wall+30
        if not shot_mid and info['activeMs']>=300000:
            p.screenshot(path=str(OUT/'screenshots/live-mid-desktop.png'),full_page=True)
            shot_mid=True
        if info['phase']=='over':
            break
        p.wait_for_timeout(1000)
    report['wallSeconds'] = time.monotonic()-start
    report['activeMs'] = p.evaluate('autoHexGame.activeMs')
    report['result'] = p.evaluate('autoHexGame.result')
    actions = p.evaluate('liveAcceptance.actions')
    report['actions'] = len(actions)
    report['actionTypes'] = dict(Counter(x['type'] for x in actions))
    report['minuteActivity'] = []
    for minute in range(10):
        rows=[x for x in actions if minute*60000<=x['activeMs']<(minute+1)*60000]
        report['minuteActivity'].append({'minute':minute+1,'actions':len(rows),
            'types':dict(Counter(x['type'] for x in rows)),
            'changedCells':sum(x['changes'] for x in rows),'lostOrExchangedStones':sum(x['losses'] for x in rows)})
    report['actionsPerSecond'] = len(actions)/report['wallSeconds']
    report['finalUi'] = p.locator('#result').inner_text()
    p.screenshot(path=str(OUT/'screenshots/live-result-desktop.png'),full_page=True)
    assert report['wallSeconds']>=600 and report['activeMs']>=600000
    assert not report['pageErrors'] and not report['consoleErrors']
    assert report['sourceHashes']==hashes(), 'Source changed during live acceptance; rerun frozen build'
    report['sourceUnchanged'] = True
    # A long clock alone is insufficient: record and require continuing board activity.
    assert report['minuteActivity'][-1]['actions']>=60
    assert report['minuteActivity'][-1]['changedCells']>=20
    (OUT/'live-browser.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    browser.close()
print(json.dumps({k:v for k,v in report.items() if k!='snapshots'},ensure_ascii=False,indent=2))
