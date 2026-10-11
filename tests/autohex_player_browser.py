"""Longer mobile human-control play plus touch and lifecycle acceptance.

Human choices come only from their own public observation. Virtual time moves
the five AI turns; this file does not claim ten minutes of real elapsed play.
"""
from pathlib import Path
from datetime import datetime, timezone
from collections import Counter
import json, os, time
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'docs/autohex-2026-10-11'
BASE=os.environ.get('FUGAMES_BASE_URL','http://127.0.0.1:8011')
report={'mode':'scripted human policy, real mobile controls, virtual AI clock','pageErrors':[]}
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    ctx=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=3,is_mobile=True,has_touch=True)
    p=ctx.new_page();p.clock.install(time=datetime(2026,10,11,13,0,tzinfo=timezone.utc));p.clock.pause_at(datetime(2026,10,11,13,1,tzinfo=timezone.utc))
    p.on('pageerror',lambda e:report['pageErrors'].append(str(e)))
    p.goto(BASE+'/autohex.html?seed=mobile-long-play');p.locator('#play').tap()
    used=Counter();latencies=[];start=time.monotonic()
    for turn in range(60):
        for _ in range(7):
            if p.evaluate('autoHexGame.turn')==1:break
            p.clock.run_for(300)
        assert p.evaluate('autoHexGame.turn')==1
        a=p.evaluate('AutoHex.chooseAction(autoHexGame.observation(1))')
        before=p.evaluate('autoHexGame.ply');t=time.monotonic();kind=a['type']
        if kind=='discard':
            p.locator('#discard-card').select_option(str(a['cardIndex']));p.locator('#discard').tap()
        elif kind in ['offer','betray']:
            p.locator('#diplomacy-target').select_option(str(a['target']));p.locator('#'+kind).tap()
        elif kind in ['accept','reject']:p.locator('#'+kind+'-'+str(a['target'])).tap()
        else:
            p.locator('#card-'+str(a['cardIndex']) if 'cardIndex' in a else '#'+kind).tap()
            for i in a.get('cells',[]):
                p.evaluate('(i)=>autoHexFocusCell(i)',i);p.locator('#board').scroll_into_view_if_needed()
                xy=p.evaluate('(i)=>autoHexCellPoint(i)',i);p.touchscreen.tap(xy['x'],xy['y'])
        assert p.evaluate('autoHexGame.ply')==before+1,(a,p.locator('#status').inner_text())
        latencies.append((time.monotonic()-t)*1000);used[kind]+=1
    p.locator('#pause').tap();report['humanActions']=dict(used);report['totalPly']=p.evaluate('autoHexGame.ply')
    report['wallSeconds']=time.monotonic()-start;report['telemetry']=p.evaluate('autoHexGame.telemetry')
    p.locator('#fit-map').tap();p.locator('#board').scroll_into_view_if_needed()
    box=p.locator('#board').bounding_box();x=box['x']+box['width']/2;y=box['y']+box['height']/2
    cdp=ctx.new_cdp_session(p);before=p.evaluate('autoHexUI().camera.scale')
    def points(gap):return [{'x':x-gap,'y':y,'id':1},{'x':x+gap,'y':y,'id':2}]
    cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':points(30)})
    for gap in [40,50,65,80]:cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':points(gap)})
    cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
    assert p.evaluate('autoHexUI().camera.scale')>before*1.5
    report['twoFingerPinch']=True
    assert p.evaluate('document.documentElement.scrollWidth<=innerWidth')
    p.screenshot(path=str(OUT/'screenshots/mobile-long-play.png'),full_page=True)
    p.goto(BASE+'/autohex.html?mode=spectator&seed=restart-check');p.locator('#play').tap()
    p.clock.run_for(300);assert p.evaluate('autoHexGame.ply')==1
    p.locator('#restart').tap();assert p.evaluate('autoHexGame.ply===0&&autoHexGame.activeMs===0&&autoHexGame.bridges.length===0&&autoHexGame.lastAction===null')
    p.clock.run_for(299);assert p.evaluate('autoHexGame.ply')==0
    p.clock.run_for(1);assert p.evaluate('autoHexGame.ply')==1
    p.evaluate('autoHexGame.activeMs=599900') # Explicit boundary fixture, not elapsed-time evidence.
    p.clock.run_for(200);assert p.evaluate('autoHexGame.phase')=='over';assert p.locator('#result').is_visible()
    recorded=p.evaluate('JSON.stringify(autoHexGame.result)');ply=p.evaluate('autoHexGame.ply');p.clock.run_for(1000)
    assert p.evaluate('autoHexGame.ply')==ply
    p.locator('#sandbox').tap();p.clock.run_for(1000)
    assert p.evaluate('autoHexGame.sandbox&&autoHexGame.phase==="running"&&autoHexGame.activeMs>600000')
    assert p.evaluate('JSON.stringify(autoHexGame.result)')==recorded
    report['lifecycle']=['restart clears state and schedules exactly one AI turn','timeout stops actions and renders result','sandbox resumes combat while preserving campaign result']
    browser.close()
assert not report['pageErrors'],report['pageErrors']
(OUT/'player-browser.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
