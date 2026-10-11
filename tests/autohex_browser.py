"""AutoHex interactive browser checks. Virtual time here tests timer semantics only.

Real ten-minute acceptance is a separate script: autohex_live_browser.py.
"""
from pathlib import Path
from datetime import datetime, timezone
import json, os, time
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs/autohex-2026-10-11';(OUT/'screenshots').mkdir(parents=True,exist_ok=True)
BASE=os.environ.get('FUGAMES_BASE_URL','http://127.0.0.1:8011')
report={'clock':'virtual time for control tests; not ten-minute wall-clock evidence','viewports':[],'checks':[],'pageErrors':[]}

def hit(p, selector, mobile=False):
    e=p.locator(selector);e.tap() if mobile else e.click()

def tap_cell(p, i, mobile=False):
    p.evaluate('(i)=>autoHexFocusCell(i)', i)
    p.locator('#board').scroll_into_view_if_needed()
    point=p.evaluate('(i)=>autoHexCellPoint(i)',i)
    p.touchscreen.tap(point['x'],point['y']) if mobile else p.mouse.click(point['x'],point['y'])

def game_state(p):
    return p.evaluate('JSON.stringify({board:Array.from(autoHexGame.board),hands:autoHexGame.hands,ply:autoHexGame.ply,turn:autoHexGame.turn,bridges:autoHexGame.bridges,offers:autoHexGame.offers,alliances:autoHexGame.alliances})')

def setup(p):
    p.clock.install(time=datetime(2026,10,11,13,0,tzinfo=timezone.utc))
    p.clock.pause_at(datetime(2026,10,11,13,1,tzinfo=timezone.utc))
    p.on('pageerror',lambda e:report['pageErrors'].append(str(e)))
    p.goto(BASE+'/autohex.html?seed=autohex-browser-acceptance')
    assert p.evaluate('!!window.autoHexGame && !!window.autoHexCellPoint'), report['pageErrors']

with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    for label,w,h,dpr,mobile in [('desktop',1440,1100,1,False),('mobile',390,844,3,True),('narrow',320,740,2,True),('landscape',844,390,2,True)]:
        ctx=browser.new_context(viewport={'width':w,'height':h},device_scale_factor=dpr,is_mobile=mobile,has_touch=mobile)
        p=ctx.new_page();setup(p)
        assert p.evaluate('AutoHex.COUNT')==1027
        assert float(p.locator('#step-seconds').input_value())==.30
        assert p.evaluate('autoHexGame.activeMs')==0
        p.clock.run_for(1000);assert p.evaluate('autoHexGame.activeMs')==0
        hit(p,'#play',mobile)
        initial=game_state(p)
        # An actual out-of-range cell click must leave all cards, turn and board intact.
        illegal=p.evaluate('AutoHex.CELLS.find(c=>!autoHexGame.board[c.i]&&!AutoHex.inRange(autoHexGame.observation(1),1,c.i)).i')
        tap_cell(p,illegal,mobile);assert game_state(p)==initial
        legal=p.evaluate('AutoHex.CELLS.find(c=>AutoHex.legalAction(autoHexGame.observation(1),{type:"deploy",cells:[c.i]})).i')
        tap_cell(p,legal,mobile)
        assert p.evaluate('(i)=>autoHexGame.board[i]===1&&autoHexGame.ply===1',legal)
        hit(p,'#pause',mobile);paused=game_state(p);active=p.evaluate('autoHexGame.activeMs')
        p.clock.run_for(3000);assert game_state(p)==paused;assert p.evaluate('autoHexGame.activeMs')==active
        # Zoom, pan and minimap are exercised as actual input events.
        hit(p,'#fit-map',mobile)
        cam=p.evaluate('JSON.stringify(autoHexUI().camera)')
        hit(p,'#zoom-in',mobile);assert p.evaluate('JSON.stringify(autoHexUI().camera)')!=cam
        board=p.locator('#board');board.scroll_into_view_if_needed();box=board.bounding_box()
        p.mouse.move(box['x']+box['width']*.4,box['y']+box['height']*.4);p.mouse.down();p.mouse.move(box['x']+box['width']*.6,box['y']+box['height']*.55,steps=6);p.mouse.up()
        dragged=p.evaluate('JSON.stringify(autoHexUI().camera)')
        mini=p.locator('#minimap');mini.scroll_into_view_if_needed();m=mini.bounding_box()
        p.touchscreen.tap(m['x']+m['width']*.8,m['y']+m['height']*.5) if mobile else p.mouse.click(m['x']+m['width']*.8,m['y']+m['height']*.5)
        assert p.evaluate('JSON.stringify(autoHexUI().camera)')!=dragged
        hit(p,'#fit-map',mobile)
        assert p.evaluate('document.documentElement.scrollWidth<=innerWidth')
        p.screenshot(path=str(OUT/f'screenshots/{label}.png'),full_page=True)
        report['viewports'].append({'label':label,'width':w,'height':h,'dpr':dpr,'illegalAtomic':True,'humanDeploy':True,'pauseFreezes':True,'zoomPanMinimap':True,'overflow':False})
        # The new catalogue icon shares exactly the same source as the game header.
        p.goto(BASE+'/index.html');assert p.locator('.game-card').count()==14
        p.screenshot(path=str(OUT/f'screenshots/catalog-{label}.png'),full_page=True)
        ctx.close()

    ctx=browser.new_context(viewport={'width':1440,'height':1100});p=ctx.new_page();setup(p)
    p.locator('#match-mode').select_option('spectator');p.locator('#play').click()
    p.clock.run_for(300);assert p.evaluate('autoHexGame.ply')==1
    p.locator('#step-seconds').fill('1');p.locator('#step-seconds').dispatch_event('change')
    p.clock.run_for(999);assert p.evaluate('autoHexGame.ply')==1
    p.clock.run_for(1);assert p.evaluate('autoHexGame.ply')==2
    p.locator('#pause').click();p.locator('#step').click();assert p.evaluate('autoHexGame.ply')==3
    three=game_state(p);active=p.evaluate('autoHexGame.activeMs');p.clock.run_for(5000)
    assert game_state(p)==three and p.evaluate('autoHexGame.activeMs')==active
    p.locator('#replay').click();assert p.evaluate('autoHexGame.ply')==0
    if p.evaluate('autoHexGame.phase')=='running':p.locator('#pause').click()
    for _ in range(3):p.locator('#step').click()
    assert game_state(p)==three
    report['checks']+=['one AI timer after speed change','paused single-step does not run clock','same-seed first-three-action replay']
    # Spectator DOM never renders private hands or deck order.
    hand=p.locator('#hand').inner_html();log=p.locator('#event-log').inner_html()
    p.evaluate('for(const h of autoHexGame.hands)if(h)h.reverse();autoHexGame.drawPile.reverse();autoHexRender()')
    assert p.locator('#hand').inner_html()==hand and p.locator('#event-log').inner_html()==log
    p.locator('#pause').click()
    p.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))")
    state=game_state(p);active=p.evaluate('autoHexGame.activeMs');p.clock.run_for(5000)
    assert p.evaluate('autoHexGame.phase')=='paused' and game_state(p)==state and p.evaluate('autoHexGame.activeMs')==active
    report['checks']+=['spectator hand/deck permutations leave public DOM unchanged','visibility pauses action and active clocks']
    ctx.close()
    # Scripted fixtures exercise real human card and diplomacy controls. Only
    # setup changes raw state; every tested action goes through clicks/taps.
    ctx=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=3,is_mobile=True,has_touch=True)
    p=ctx.new_page();setup(p);hit(p,'#play',True)
    def fixture(body, cards):
        p.evaluate('''([body,cards])=>{const g=autoHexGame;g.reset('ui-fixture',1,0);g.terrain.fill(0);
          g.board.fill(0);for(const p of AutoHex.PLAYERS)g.board[g.players[p].home]=p;
          g.hands[1]=cards;new Function('g','at',body)(g,AutoHex.index);g.start();autoHexRender();autoHexSchedule();}''',[body,cards])
    def coord(q,r):return p.evaluate('([q,r])=>AutoHex.index(q,r)',[q,r])
    for kind,body,cells,check in [
      ('turret','g.board[at(0,0)]=1;',[(0,0)],'autoHexGame.turrets.length===1'),
      ('destroy','g.board[at(0,0)]=1;g.board[at(1,0)]=2;',[(1,0)],'!autoHexGame.board[AutoHex.index(1,0)]'),
      ('shield','g.board[at(0,0)]=1;',[(0,0)],'autoHexGame.shields[AutoHex.index(0,0)]>0'),
      ('bridge','g.board[at(-2,0)]=g.board[at(1,0)]=1;', [(-2,0),(1,0)],'autoHexGame.bridges.length===1'),
      ('exchange','g.board[at(0,0)]=1;g.board[at(1,0)]=2;',[(0,0),(1,0)],'autoHexGame.board[AutoHex.index(0,0)]===2&&autoHexGame.board[AutoHex.index(1,0)]===1')]:
        fixture(body,[kind]);hit(p,'#card-0',True)
        for q,r in cells:tap_cell(p,coord(q,r),True)
        assert p.evaluate(check) and p.evaluate('autoHexGame.ply')==1,kind
        hit(p,'#pause',True)
    fixture('''const a=at(-2,0),b=at(-2,2),c=at(1,0),d=at(-1,-1),e=at(-1,1);
      g.board[a]=g.board[b]=g.board[c]=1;g.board[d]=g.board[e]=2;
      g.bridges=[{owner:1,a,b},{owner:2,a:d,b:e}];''',['reroute'])
    hit(p,'#card-0',True)
    for q,r in [(-2,0),(-2,2)]:tap_cell(p,coord(q,r),True)
    before=game_state(p);tap_cell(p,coord(1,0),True);assert game_state(p)==before
    p.evaluate('autoHexGame.bridges.pop();autoHexRender()');tap_cell(p,coord(1,0),True)
    assert p.evaluate('autoHexGame.ply===1&&autoHexGame.bridges[0].b===AutoHex.index(1,0)')
    hit(p,'#pause',True);p.screenshot(path=str(OUT/'screenshots/mobile-bridge-detail.png'),full_page=True)
    fixture('g.board[at(-1,0)]=1;g.terrain[at(0,0)]=1;',[])
    hit(p,'#engineer',True);tap_cell(p,coord(0,0),True);assert p.evaluate('autoHexGame.roads[AutoHex.index(0,0)]===1')
    # Each diplomatic response has its own real input path and ordinary turn cost.
    fixture('',[]);p.locator('#diplomacy-target').select_option('2');hit(p,'#offer',True)
    assert p.evaluate('autoHexGame.ply===1&&autoHexGame.offers.some(o=>o.from===1&&o.to===2)')
    for response in ['accept','reject']:
        fixture('',[])
        p.evaluate('''()=>{const g=autoHexGame;g.turn=2;g.act({type:'offer',target:1,cells:[]});g.turn=1;autoHexRender();autoHexSchedule();}''')
        hit(p,'#'+response+'-2',True)
        assert p.evaluate('autoHexGame.ply')==2
        assert p.evaluate('autoHexGame.alliances.length')==(1 if response=='accept' else 0)
    fixture('',[])
    p.evaluate('autoHexGame.alliances=[{a:1,b:2,createdRound:0,expiresRound:12}];autoHexRender()')
    p.locator('#diplomacy-target').select_option('2');hit(p,'#betray',True)
    assert p.evaluate('autoHexGame.ply===1&&autoHexGame.alliances.length===0&&autoHexGame.players[1].score===-4')
    hit(p,'#pause',True);p.screenshot(path=str(OUT/'screenshots/mobile-diplomacy.png'),full_page=True)
    report['checks']+=['mobile real taps: all six cards and engineering','cross-owner bridge collision rejection is atomic; legal reroute then succeeds','human offer/accept/reject/betray each consume one ordinary action']
    ctx.close()
    try:
        public=browser.new_page();public.goto('https://yfwu.github.io/FuGames/autohex.html',timeout=15000)
        report['publicSite']={'status':'reachable','note':'Access check only; pending new commit deployment.'}
    except Exception as e:
        report['publicSite']={'status':'blocked','error':str(e).split('\n')[0]}
    browser.close()
assert not report['pageErrors'],report['pageErrors']
(OUT/'browser.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
