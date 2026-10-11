"""Seeded airport presentation, actual human controls, and opposite-edge scoring.

AI turns use a virtual browser clock; this is not elapsed-time acceptance.
Airport unlock and last-gap scoring use disclosed controlled board fixtures.
All tested human actions go through the real DOM/canvas controls.
"""
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import urlparse
from collections import Counter
import hashlib, json, os, subprocess
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/autohex-goals-2026-10-11'
BASE = os.environ.get('FUGAMES_BASE_URL', 'http://127.0.0.1:8012')
SOURCES = ['autohex-engine.js', 'autohex-ui.js', 'autohex-visuals.js', 'autohex.html', 'autohex.css']
BASELINE = 'f3d50e7'
SEEDS = ['goal-ui-alpha', 'goal-ui-bravo']
OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'screenshots').mkdir(exist_ok=True)
def hashes():
    return {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in SOURCES}
def new_page(browser, width, height, mobile):
    ctx = browser.new_context(viewport={'width': width, 'height': height},
                              device_scale_factor=3 if mobile else 1, is_mobile=mobile, has_touch=mobile)
    p = ctx.new_page()
    p.clock.install(time=datetime(2026, 10, 11, 15, 0, tzinfo=timezone.utc))
    p.clock.pause_at(datetime(2026, 10, 11, 15, 1, tzinfo=timezone.utc))
    p.on('pageerror', lambda error: report['errors'].append(str(error)))
    return ctx, p

def hit(p, selector, mobile):
    p.locator(selector).tap() if mobile else p.locator(selector).click()

def cell_click(p, cell, mobile):
    p.evaluate('(cell) => autoHexFocusCell(cell)', cell)
    p.locator('#board').scroll_into_view_if_needed()
    point = p.evaluate('(cell) => autoHexCellPoint(cell)', cell)
    p.touchscreen.tap(point['x'], point['y']) if mobile else p.mouse.click(point['x'], point['y'])

def action_click(p, action, mobile):
    kind = action['type']
    if kind == 'discard':
        p.locator('#discard-card').select_option(str(action['cardIndex'])); hit(p, '#discard', mobile)
    elif kind in ['offer', 'betray']:
        p.locator('#diplomacy-target').select_option(str(action['target'])); hit(p, '#' + kind, mobile)
    elif kind in ['accept', 'reject']:
        hit(p, '#' + kind + '-' + str(action['target']), mobile)
    else:
        hit(p, '#card-' + str(action['cardIndex']) if 'cardIndex' in action else '#' + kind, mobile)
        for cell in action.get('cells', []):
            cell_click(p, cell, mobile)

FIXTURE_HELPERS = '''
 const E=AutoHex,g=autoHexGame;
 g.reset(g.seed,1,0);
 g.neutralEvents=false;
 for(const key of ['board','terrain','roads','shields','unsupplied','age','fortified'])g[key].fill(0);
 for(const p of E.PLAYERS)g.board[g.players[p].home]=p;
 const ownHome=g.players[1].home;
 function pathTo(accept,forbidden=new Set()) {
   const queue=[ownHome],parents=new Map([[ownHome,-1]]);
   for(let head=0;head<queue.length;head++) {
     const cell=queue[head];
     if(accept(cell)) {const path=[];for(let i=cell;i!==-1;i=parents.get(i))path.push(i);return path.reverse();}
     for(const next of E.ADJ[cell])if(!parents.has(next)&&!forbidden.has(next)&&(!g.anchors[next]||next===ownHome)){parents.set(next,cell);queue.push(next);}
   }
   throw Error('No fixture route');
 }
'''
AIR_FIXTURE = '() => {' + FIXTURE_HELPERS + '''
 const airport=g.airports.slice().sort((a,b)=>E.distance(a.cell,ownHome)-E.distance(b.cell,ownHome)||a.id-b.id)[0].cell;
 for(const i of pathTo(i=>i===airport))g.board[i]=1;
 for(const c of E.CELLS)if(E.distance(c.i,airport)<=2)g.board[c.i]=1;
 g._countStones();g.start();
 for(let n=0;n<18;n++)if(!g.act({type:'rest',cells:[]}))throw Error('Unlock fixture rest failed');
 g.players[1].energy=8;g.players[1].supplies=6;
 const view=g.observation(1);
 const target=E.CELLS.find(c=>!E.inRange(view,1,c.i)&&E.legalAction(view,{type:'airdrop',cells:[airport,c.i]}))?.i;
 const far=E.CELLS.find(c=>!g.board[c.i]&&!g.anchors[c.i]&&E.distance(c.i,airport)>12)?.i;
 if(target===undefined||far===undefined)throw Error('Missing dynamic air targets');
 autoHexRender();autoHexSchedule();return {airport,target,far};
}'''
GOAL_FIXTURE = '() => {' + FIXTURE_HELPERS + '''
 const airports=new Set(g.airports.map(a=>a.cell));
 const path=pathTo(i=>E.goalCell(g,1,i),airports),target=path[path.length-1];
 for(const i of path.slice(0,-1))g.board[i]=1;
 g._countStones();g.start();autoHexRender();autoHexSchedule();
 return {path,target,airportCells:[...airports]};
}'''

report = {'baseline': BASELINE, 'clock': 'virtual AI timer control; no real-time claim',
          'controlledFixtures': ['dynamic airport supply path and cluster, unlocked with 18 legal rest actions',
                                 'all but final opposite-edge route cell, then real human deploy and legal round settlement'],
          'sourceSha256': hashes(), 'errors': [], 'viewports': []}
try:
    baseline = {name: subprocess.check_output(['git', 'show', BASELINE + ':' + name], cwd=ROOT) for name in SOURCES}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), args=['--no-sandbox'])
        for label, width, height, mobile in [('desktop', 1440, 1100, False), ('mobile', 390, 844, True)]:
            ctx, p = new_page(browser, width, height, mobile)
            def route_old(route):
                name = Path(urlparse(route.request.url).path).name
                if name in baseline:
                    route.fulfill(body=baseline[name], content_type='text/html' if name.endswith('.html') else 'text/css' if name.endswith('.css') else 'text/javascript')
                else:
                    route.continue_()
            ctx.route('**/*', route_old)
            p.goto(BASE + '/autohex.html?seed=' + SEEDS[0]); hit(p, '#play', mobile); hit(p, '#fit-map', mobile)
            old_cells = p.evaluate('autoHexGame.observation(1).airports.map(a=>a.cell)')
            p.locator('#board-wrap').screenshot(path=str(OUT / f'screenshots/before-{label}-airports.png'))
            ctx.close()
            ctx, p = new_page(browser, width, height, mobile)
            p.goto(BASE + '/autohex.html?seed=' + SEEDS[0])
            first = p.evaluate('autoHexGame.observation(1).airports.map(a=>a.cell)')
            assert first == p.evaluate('(seed)=>AutoHex.airportCells(seed)', SEEDS[0])
            assert first != old_cells
            assert first == p.locator('[data-airport]').evaluate_all('(nodes)=>nodes.map(n=>Number(n.dataset.airport))')
            assert first == p.evaluate('autoHexVisualDebug().airports.map(a=>a.cell)')
            hit(p, '#play', mobile); hit(p, '#fit-map', mobile)
            p.locator('#board-wrap').screenshot(path=str(OUT / f'screenshots/after-{label}-airports.png'))
            p.goto(BASE + '/autohex.html?seed=' + SEEDS[0])
            p.locator('#seed').fill(SEEDS[1]); p.locator('#seed').press('Tab')
            second = p.evaluate('autoHexGame.observation(1).airports.map(a=>a.cell)')
            assert second == p.evaluate('(seed)=>AutoHex.airportCells(seed)', SEEDS[1]) and second != first
            hit(p, '#play', mobile); hit(p, '#replay', mobile)
            assert second == p.evaluate('autoHexGame.observation(1).airports.map(a=>a.cell)')
            assert p.evaluate('autoHexGame.ply===0 && autoHexGame.activeMs===0')
            hit(p, '#fit-map', mobile)
            p.locator('#board-wrap').screenshot(path=str(OUT / f'screenshots/after-{label}-second-seed.png'))
            for cell in second:
                hit(p, f'[data-airport="{cell}"]', mobile)
                assert '機場' in p.locator('#turret-info').inner_text()
                pt = p.evaluate('(cell)=>autoHexCellPoint(cell)', cell)
                box = p.locator('#board').bounding_box()
                assert abs(pt['x'] - box['x'] - box['width']/2) < 2
                assert abs(pt['y'] - box['y'] - box['height']/2) < 2
            hit(p, '#inspect-mode', mobile)
            used = Counter()
            for turn in range(12):
                for _ in range(7):
                    if p.evaluate('autoHexGame.turn') == 1:
                        break
                    p.clock.run_for(300)
                assert p.evaluate('autoHexGame.turn') == 1
                action = p.evaluate('AutoHex.chooseAction(autoHexGame.observation(1))')
                ply = p.evaluate('autoHexGame.ply')
                action_click(p, action, mobile)
                assert p.evaluate('autoHexGame.ply') == ply + 1, (action, p.locator('#status').inner_text())
                used[action['type']] += 1
            ids = p.evaluate(AIR_FIXTURE)
            assert p.evaluate('(cell)=>autoHexGame.observation(1).airports.some(a=>a.cell===cell&&a.active&&a.owner===1)', ids['airport'])
            snap = p.evaluate('JSON.stringify({board:Array.from(autoHexGame.board),ply:autoHexGame.ply,player:autoHexGame.players[1]})')
            hit(p, '#airdrop', mobile); cell_click(p, ids['airport'], mobile); cell_click(p, ids['far'], mobile)
            assert p.evaluate('JSON.stringify({board:Array.from(autoHexGame.board),ply:autoHexGame.ply,player:autoHexGame.players[1]})') == snap
            hit(p, '#airdrop', mobile); cell_click(p, ids['airport'], mobile); cell_click(p, ids['target'], mobile)
            assert p.evaluate('(cell)=>autoHexGame.board[cell]===1&&autoHexGame.turrets.some(t=>t.cell===cell)', ids['target'])
            assert p.evaluate('autoHexGame.players[1].supplies') == 3
            hit(p, '#fit-map', mobile)
            p.locator('#board-wrap').screenshot(path=str(OUT / f'screenshots/after-{label}-airdrop.png'))
            bombard = p.evaluate('''airport=>{
              const E=AutoHex,g=autoHexGame;
              for(let i=0;i<41;i++)if(!g.act({type:'rest',cells:[]}))throw Error('Cooldown rest failed');
              if(g.turn!==1||g.players[1].airCooldown)throw Error('Cooldown did not finish');
              const target=E.CELLS.find(c=>!g.board[c.i]&&!g.anchors[c.i]&&E.distance(c.i,airport)>5&&E.distance(c.i,airport)<=12).i;
              g.board[target]=2;g.players[1].energy=8;g.players[1].supplies=6;g._countStones();autoHexRender();autoHexSchedule();return target;
            }''', ids['airport'])
            hit(p, '#bombard', mobile); cell_click(p, ids['airport'], mobile); cell_click(p, bombard, mobile)
            assert p.evaluate('(cell)=>autoHexGame.board[cell]===0', bombard)
            goal = p.evaluate(GOAL_FIXTURE)
            assert not set(goal['path']) & set(goal['airportCells']), 'Goal fixture must need no airport'
            hit(p, '#deploy', mobile); cell_click(p, goal['target'], mobile)
            p.evaluate('''()=>{for(let i=0;i<5;i++)if(!autoHexGame.act({type:'rest',cells:[]}))throw Error('Round fixture');autoHexRender();autoHexSchedule();}''')
            assert p.evaluate('autoHexGame.players[1].goalActive&&autoHexGame.players[1].score===12&&autoHexGame.phase==="running"')
            p.evaluate('''()=>{for(let i=0;i<6;i++)autoHexGame.act({type:'rest',cells:[]});autoHexRender();autoHexSchedule();}''')
            assert p.evaluate('autoHexGame.players[1].score') == 14
            hit(p, '#fit-map', mobile)
            p.locator('#board-wrap').screenshot(path=str(OUT / f'screenshots/after-{label}-goal-route.png'))
            hit(p, '#replay', mobile)
            assert second == p.evaluate('autoHexGame.observation(1).airports.map(a=>a.cell)')
            assert p.evaluate('autoHexGame.ply===0&&autoHexGame.players[1].score===0&&!autoHexGame.turrets.length')
            assert not p.evaluate('autoHexVisualDebug().activeEffects')
            assert p.evaluate('autoHexGame.observation(0).hand.length===0')
            assert p.evaluate('document.documentElement.scrollWidth<=innerWidth')
            report['viewports'].append({'label': label, 'beforeAirportCells': old_cells, 'firstSeed': first, 'secondSeed': second,
                                        'dynamicNavigation': True, 'humanActions': dict(used), 'remoteAirActionsViaUi': True,
                                        'invalidAirActionAtomic': True, 'goalRouteWithoutAirport': goal['path'],
                                        'goalArrivalScore': 12, 'holdingScore': 14, 'replayRestoresSeedAndClearsState': True,
                                        'spectatorHandPrivate': True, 'overflow': False})
            ctx.close()
        browser.close()
    assert not report['errors'], report['errors']
    assert hashes() == report['sourceSha256'], 'Source changed during browser checks'
    report['pass'] = True
except Exception as error:
    report['pass'] = False; report['failure'] = repr(error)
    raise
finally:
    (OUT / 'browser.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps(report, indent=2, ensure_ascii=False))
