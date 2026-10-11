"""Independent native-icon, geometry and interaction QA for all 14 FuGames pages.

Serve the repository first. Read-only browser inspection plus actual DOM input;
no game-state fixtures or game-source modifications. Reports/screenshots go to
/tmp by default, and all failures are collected before the command exits.
"""
import json
import os
import traceback
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = os.environ.get('FUGAMES_BASE_URL', 'http://127.0.0.1:8000')
OUT = Path(os.environ.get('FUGAMES_QA_OUTPUT', '/tmp/fugames-revision-qa'))
OUT.mkdir(parents=True, exist_ok=True)
GAMES = ['cyclic_tictactoe','cyclic_connect4_torus','trackgame','card_hex',
         'gravity_brawl','flip_five','effect_snake','duplicate_bridge','blackjack',
         'tank_arena','pulse_arena','territory_loop','star_feast']
IO = ['effect_snake','tank_arena','pulse_arena','territory_loop','star_feast']
CLASSIC = ['cyclic_tictactoe','cyclic_connect4_torus','trackgame']
VIEWPORTS = [(1366,1000,'desktop'),(390,844,'mobile'),(320,568,'narrow'),(844,390,'landscape')]
SEED = 'let qaSeed=71; Math.random=()=>((qaSeed=(Math.imul(qaSeed,1664525)+1013904223)>>>0)/4294967296);'

GEOMETRY = """() => {
 const shown=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';};
 const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
 const icons=[...document.querySelectorAll('svg.page-icon,svg.ui-icon,svg.game-icon')].filter(shown).map(e=>{
  const r=e.getBoundingClientRect(),b=e.getBBox(),p=e.closest('button,a.btn');
  return {class:e.getAttribute('class'),href:e.querySelector('use')?.getAttribute('href'),viewBox:e.getAttribute('viewBox'),ariaHidden:e.getAttribute('aria-hidden'),nativeShapes:e.querySelectorAll('path,circle,rect,ellipse,line,polyline,polygon').length,box:box(e),geometry:{x:b.x,y:b.y,width:b.width,height:b.height},button:p?box(p):null};
 });
 const controls=[...document.querySelectorAll('button.btn,a.btn,select')].filter(shown).map(e=>({id:e.id,text:e.getAttribute('aria-label')||e.textContent.trim(),box:box(e)}));
 const canvases=[...document.querySelectorAll('canvas')].filter(shown).map(e=>({id:e.id,box:box(e),naturalWidth:e.width,naturalHeight:e.height}));
 const dialogs=[...document.querySelectorAll('.board-overlay .game-dialog,[role=dialog]')].filter(shown).map(e=>({box:box(e),parent:e.closest('.board-overlay')?box(e.closest('.board-overlay')):null,overflow:getComputedStyle(e).overflow}));
 const stones=[...document.querySelectorAll('.classic-stone,.pieceLayer .piece')].filter(shown).map(e=>({class:e.className,box:box(e),background:getComputedStyle(e).backgroundColor,border:getComputedStyle(e).borderColor}));
 const statuses=[...document.querySelectorAll('[role=status],.game-status,#statusText,#info')].filter(shown).map(e=>e.textContent.trim()).filter(Boolean);
 const clipped=[...document.querySelectorAll('.play-panel,.game-card,.site-nav,.page-header,.board,.hex-board,.bridge-table,.bj-table')].filter(shown).map(e=>({class:e.className,box:box(e)})).filter(e=>e.box.x<-.5||e.box.x+e.box.width>innerWidth+.5);
 return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,icons,controls,canvases,dialogs,stones,statuses,clipped,font:getComputedStyle(document.body).fontFamily};
}"""

SPRITE_GEOMETRY = """async () => {
 const response=await fetch('icons.svg'),source=await response.text(),doc=new DOMParser().parseFromString(source,'image/svg+xml');
 const mount=document.createElement('div');mount.style.cssText='position:absolute;left:-10000px;top:0;';document.body.append(mount);
 const ns='http://www.w3.org/2000/svg',records=[];
 for(const symbol of doc.querySelectorAll('symbol')){
  const svg=document.createElementNS(ns,'svg');svg.setAttribute('width','48');svg.setAttribute('height','48');
  for(const a of symbol.attributes)if(a.name!=='id')svg.setAttribute(a.name,a.value);
  svg.innerHTML=symbol.innerHTML;mount.append(svg);
  let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
  const shapes=[...svg.querySelectorAll('path,circle,ellipse,rect,line,polyline,polygon')].map(e=>{
   const b=e.getBBox(),style=getComputedStyle(e),stroke=style.stroke!=='none'?parseFloat(style.strokeWidth):0;
   const padding=stroke/2;left=Math.min(left,b.x-padding);top=Math.min(top,b.y-padding);right=Math.max(right,b.x+b.width+padding);bottom=Math.max(bottom,b.y+b.height+padding);
   return {stroke:style.stroke,strokeWidth:parseFloat(style.strokeWidth),cap:style.strokeLinecap,join:style.strokeLinejoin,fill:style.fill};
  });
  records.push({id:symbol.id,viewBox:symbol.getAttribute('viewBox'),bounds:{left,top,right,bottom},margin:Math.min(left,top,48-right,48-bottom),shapes});
 }
 mount.remove();return {status:response.status,parserError:!!doc.querySelector('parsererror'),records};
}"""


def check_geometry(page, name, stage, report):
    g = page.evaluate(GEOMETRY)
    report['geometry'].append({'stage':stage, **g})
    assert g['scrollWidth'] <= g['width'], f"horizontal overflow {g['scrollWidth']} > {g['width']}"
    assert not g['clipped'], 'offscreen shell/board ' + str(g['clipped'])
    for control_id in ['play','start','pause','restart','resume','newGame','undo','hint','deal']:
        control=page.locator('button#'+control_id)
        if control.count() and control.is_visible():
            assert control.locator('svg.ui-icon use').count()>0, 'native control icon disappeared: '+control_id
    expected = f'icons.svg#{name}'
    if name == 'index':
        catalogue = [i for i in g['icons'] if 'game-icon' in i['class']]
        assert len(catalogue)==13, f'catalogue icon count: {len(catalogue)}'
        assert {i['href'] for i in catalogue} == {f'icons.svg#{n}' for n in GAMES}
    else:
        headers = [i for i in g['icons'] if 'page-icon' in i['class']]
        assert page.locator(f'h1 svg.page-icon use[href="{expected}"]').count()==1, 'wrong header icon identity'
        if not headers:
            assert name in IO and g['height']<=600 and g['width']>=600, 'unexpected hidden heading'
        else:
            assert len(headers)==1 and headers[0]['href']==expected, 'wrong visible header icon identity'
        assert g['statuses'], 'no visible status text'
    for i in g['icons']:
        b=i['box']
        assert i['viewBox']=='0 0 48 48', str(i)
        assert i['ariaHidden']=='true', 'decorative SVG should not replace control name: '+str(i)
        if i['href']:
            assert i['href'].startswith('icons.svg#'), str(i)
        else:
            assert not i['button'] and i['nativeShapes']>0, 'control must reference shared icon; legend may use native geometry: '+str(i)
        assert abs(b['width']-b['height'])<=.75, 'stretched icon '+str(i)
        assert i['geometry']['width']>0 and i['geometry']['height']>0, 'empty or unresolved external <use> '+str(i)
        if i['button']:
            p=i['button']
            assert b['x']>=p['x']-1 and b['x']+b['width']<=p['x']+p['width']+1, 'icon clipped in button '+str(i)
    for c in g['controls']:
        assert c['text'], 'unlabelled control '+str(c)
        assert c['box']['height']>=43.5, 'action control below 44px: '+str(c)
        assert c['box']['x']>=-.5 and c['box']['x']+c['box']['width']<=g['width']+.5, 'control clipped '+str(c)
    for c in g['canvases']:
        ratio=(c['box']['width']/c['box']['height'])/(c['naturalWidth']/c['naturalHeight'])
        assert abs(ratio-1)<.025, 'distorted canvas '+str(c)
    for d in g['dialogs']:
        if not d['parent']: continue
        b,p=d['box'],d['parent']
        assert b['x']>=p['x']-1 and b['x']+b['width']<=p['x']+p['width']+1, 'horizontally clipped overlay '+str(d)
        assert b['y']>=p['y']-1 and b['y']+b['height']<=p['y']+p['height']+1, 'vertically clipped overlay '+str(d)
    for s in g['stones']:
        b=s['box']
        assert abs(b['width']-b['height'])<1, 'distorted geometric stone '+str(s)
    page.screenshot(path=str(OUT/f'{name}-{report["viewport"]}-{stage}.png'),full_page=True)


def activate(page, selector, mobile, keyboard=False):
    target=page.locator(selector).first
    if keyboard and not mobile:
        target.focus();page.keyboard.press('Enter')
    elif mobile: target.tap()
    else: target.click()


def state(page, name):
    if name=='duplicate_bridge': return page.evaluate('BridgeUI.snapshot()')
    if name=='blackjack':
        return page.evaluate("({phase:document.querySelector('#phase-label').textContent,cards:[...document.querySelectorAll('.playing-card,.bj-card')].map(e=>e.outerHTML),balance:document.querySelector('#balance').textContent})")
    key='hexGame' if name=='card_hex' else 'flipGame' if name=='flip_five' else 'game'
    return page.evaluate('JSON.parse(JSON.stringify('+key+'))')


def advance_to_human(page, name):
    if name=='duplicate_bridge':
        for _ in range(30):
            s=state(page,name)
            if s['human'] or s['phase']=='complete': return
            page.clock.run_for(800)
    elif name=='card_hex':
        for _ in range(20):
            if page.evaluate("hexGame.phase!=='running'||(hexGame.turn===1&&!hexGame.pending)"): return
            for selector in ['#accept','#counter']:
                if page.locator(selector).count() and page.locator(selector).is_visible() and page.locator(selector).is_enabled():
                    page.locator(selector).click();break
            page.clock.run_for(800)


def touch_motion(page):
    page.locator('#board').scroll_into_view_if_needed()
    r=page.locator('#board').bounding_box()
    x,y=r['x']+r['width']*.45,r['y']+r['height']*.5
    cdp=page.context.new_cdp_session(page)
    cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
    cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x+28,'y':y+12}]})
    page.clock.run_for(330)
    cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
    cdp.detach()


def exercise(page,name,mobile,report):
    if name=='index':
        with page.expect_navigation(wait_until='load'):
            activate(page,'a[href="card_hex.html"]',mobile,keyboard=True)
        assert page.url.endswith('/card_hex.html'), page.url
        page.go_back();report['interactions'].append('catalogue navigation via keyboard/touch')
        return
    if name in CLASSIC:
        cell='.cell:enabled' if name=='cyclic_tictactoe' else '[data-col="0"]' if name=='cyclic_connect4_torus' else '[data-idx="0"]'
        activate(page,cell,mobile,keyboard=True)
        page.clock.run_for(400)
        page.locator('.piece').evaluate_all('es=>es.forEach(e=>e.getAnimations().forEach(a=>a.finish()))')
        if name=='cyclic_tictactoe':
            assert page.locator('#moveCount').inner_text()=='2'
            assert page.locator('#board .classic-stone,.board .classic-stone').count()>=2
        else:
            assert page.locator('#turnKpi').inner_text()=='1'
            assert page.locator('.classic-stone,.piece').count()>0
        report['interactions'].append('actual move via keyboard/touch; geometric stones')
        check_geometry(page,name,'active',report)
        button='button[onclick="resetGame()"]' if name=='cyclic_tictactoe' else '#newGame'
        activate(page,button,mobile)
        indicator='#moveCount' if name=='cyclic_tictactoe' else '#turnKpi'
        assert page.locator(indicator).inner_text()=='0'
        report['interactions'].append('restart reset move count')
        return
    starter='#start' if name=='duplicate_bridge' else '#deal' if name=='blackjack' else '#play'
    activate(page,starter,mobile,keyboard=True)
    if name=='duplicate_bridge':
        advance_to_human(page,name)
        previous=state(page,name)
        if previous['phase']=='auction':activate(page,'#pass',mobile,keyboard=True)
        elif previous['phase']=='play':activate(page,'#hand button:enabled',mobile,keyboard=True)
        assert state(page,name)!=previous
    elif name=='blackjack':
        for _ in range(3):
            if page.locator('#pause').is_enabled():break
            activate(page,'#deal',mobile,keyboard=True)
        if page.locator('#stand').is_enabled():
            if mobile:activate(page,'#stand',True)
            else:page.keyboard.press('s')
    elif name in ['card_hex','flip_five']:
        advance_to_human(page,name)
        stem='hex' if name=='card_hex' else 'flip'
        previous=state(page,name)['ply']
        cells=page.locator(f'.{stem}-cell:enabled[data-owner="0"]')
        if not cells.count():cells=page.locator(f'.{stem}-cell:enabled')
        cell=cells.nth(cells.count()//2)
        if mobile:cell.tap()
        else:cell.focus();page.keyboard.press('Enter')
        page.clock.run_for(850)
        assert state(page,name)['ply']>previous
    elif name=='gravity_brawl':
        if mobile:
            activate(page,'#rotate',True);activate(page,'#drop',True)
        else:
            page.keyboard.press('ArrowUp');page.keyboard.press('Space')
        assert page.evaluate('game.wave')==2
    else:
        previous=page.evaluate('JSON.stringify(game.actors[0])')
        if mobile:
            if name in ['territory_loop','effect_snake']:
                activate(page,'[data-direction="down"]',True);page.clock.run_for(330)
            else:touch_motion(page)
        else:
            page.keyboard.down('ArrowDown');page.clock.run_for(330);page.keyboard.up('ArrowDown')
        assert page.evaluate('JSON.stringify(game.actors[0])')!=previous
    report['interactions'].append('actual keyboard/touch game input')
    check_geometry(page,name,'active',report)
    if page.locator('#pause').is_enabled():
        activate(page,'#pause',mobile)
        before=state(page,name)
        page.clock.run_for(1800)
        assert state(page,name)==before, 'state advanced while paused'
        phase=page.locator('#phase-label').inner_text()
        assert '暫停' in phase or '休息' in phase, 'paused state has no readable label'
        check_geometry(page,name,'paused',report)
        resume='#resume' if name=='blackjack' else '#play' if name in IO+['gravity_brawl'] else '#pause'
        activate(page,resume,mobile)
        assert '暫停' not in page.locator('#phase-label').inner_text()
        # A real dispatched window blur executes the app's tab/window handler.
        page.evaluate("window.dispatchEvent(new Event('blur'))")
        before=state(page,name)
        assert '暫停' in page.locator('#phase-label').inner_text()
        page.clock.run_for(1600)
        assert state(page,name)==before, 'state advanced after blur'
        activate(page,resume,mobile)
        report['interactions'].append('pause freezes state, explicit resume, blur freezes state')
    else:
        raise AssertionError('scenario reached terminal before pause validation')
    activate(page,'#restart',mobile)
    if name in ['territory_loop','star_feast']:
        assert page.locator('#dialog-title').inner_text()=='重新開始這一局？'
        activate(page,'#play',mobile)
    if name=='duplicate_bridge':assert state(page,name)['played']==0
    elif name=='blackjack':assert page.locator('#balance').inner_text()=='100'
    elif name in ['card_hex','flip_five']:assert state(page,name)['ply']==0
    elif name=='gravity_brawl':assert page.evaluate('game.wave')==1
    else:assert page.evaluate('game.tick')<=2
    report['interactions'].append('restart resets running state')
    check_geometry(page,name,'restart',report)
    if name=='card_hex' and page.viewport_size['width']<=390:
        activate(page,'#pause',mobile)
        activate(page,'#zoom',mobile)
        assert page.locator('#zoom').get_attribute('aria-pressed')=='true'
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        assert page.locator('#board-scroll').evaluate('e=>e.scrollWidth>e.clientWidth')
        page.locator('#board-scroll').scroll_into_view_if_needed()
        r=page.locator('#board-scroll').bounding_box()
        x,y=r['x']+r['width']*.6,max(50,min(page.viewport_size['height']-50,r['y']+r['height']*.5))
        cdp=page.context.new_cdp_session(page)
        cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
        for step in range(1,5):
            cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x-step*27,'y':y}]})
            page.clock.run_for(40)
        cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
        # Let native touch-scroll momentum settle before tapping the zoom toggle.
        page.clock.run_for(650)
        # Browser compositor momentum uses wall time, not Playwright's JS clock.
        last_scroll=-1; stable=0
        for _ in range(30):
            scroll=page.locator('#board-scroll').evaluate('e=>e.scrollLeft')
            stable=stable+1 if abs(scroll-last_scroll)<.5 else 0
            last_scroll=scroll
            if stable>=4:break
            page.wait_for_timeout(50)
        cdp.detach()
        assert page.locator('#board-scroll').evaluate('e=>e.scrollLeft')>20, 'zoomed board could not pan with real touch'
        page.screenshot(path=str(OUT/f'{name}-{report["viewport"]}-zoom.png'),full_page=True)
        activate(page,'#zoom',mobile)
        assert page.locator('#zoom').get_attribute('aria-pressed')=='false'
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        report['interactions'].append('zoom preserves document width; actual touch pans only the board')


def main():
    reports,issues=[],[]
    sprite_report=None
    selected=os.environ.get('FUGAMES_QA_PAGES')
    pages=selected.split(',') if selected else ['index']+GAMES
    assert pages and all(n in ['index']+GAMES for n in pages), pages
    with sync_playwright() as pw:
        browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
        for width,height,label in VIEWPORTS:
            mobile=label!='desktop'
            context=browser.new_context(viewport={'width':width,'height':height},is_mobile=mobile,has_touch=mobile)
            context.add_init_script(SEED)
            page=context.new_page()
            page.clock.install()
            page.clock.set_fixed_time(1791696000)
            for name in pages:
                report={'page':name,'viewport':label,'geometry':[],'interactions':[],'errors':[],'failedRequests':[],'httpErrors':[]}
                reports.append(report)
                listeners={
                    'pageerror':lambda error,r=report:r['errors'].append(str(error)),
                    'console':lambda msg,r=report:r['errors'].append(msg.text) if msg.type=='error' else None,
                    'requestfailed':lambda req,r=report:r['failedRequests'].append(req.url),
                    'response':lambda response,r=report:r['httpErrors'].append({'status':response.status,'url':response.url}) if response.status>=400 else None,
                }
                for event,listener in listeners.items():page.on(event,listener)
                try:
                    page.goto(BASE+'/'+name+'.html')
                    if sprite_report is None:
                        sprite_report=page.evaluate(SPRITE_GEOMETRY)
                        assert sprite_report['status']==200 and not sprite_report['parserError']
                        for icon in sprite_report['records']:
                            assert icon['viewBox']=='0 0 48 48',icon
                            assert icon['margin']>=5.98, 'sprite ink violates 6px safe margin: '+str(icon)
                            for shape in icon['shapes']:
                                if shape['stroke']!='none':
                                    assert shape['strokeWidth']==2 and shape['cap']=='round' and shape['join']=='round',icon
                    check_geometry(page,name,'ready',report)
                    if name!='index':
                        activate(page,'details.rules > summary',mobile)
                        check_geometry(page,name,'rules',report)
                        activate(page,'details.rules > summary',mobile)
                    exercise(page,name,mobile,report)
                    assert not report['errors'],report['errors']
                    assert not report['failedRequests'],report['failedRequests']
                    assert not report['httpErrors'],report['httpErrors']
                    report['passed']=True
                    (OUT/f'{name}-{label}-FAIL.png').unlink(missing_ok=True)
                    print(f'PASS {name} {label}',flush=True)
                except Exception as error:
                    report['passed']=False;report['failure']=str(error)
                    issues.append({'page':name,'viewport':label,'error':str(error),'traceback':traceback.format_exc(limit=3)})
                    try:page.screenshot(path=str(OUT/f'{name}-{label}-FAIL.png'),full_page=True)
                    except Exception:pass
                    print(f'FAIL {name} {label}: {error}',flush=True)
                finally:
                    for event,listener in listeners.items():page.remove_listener(event,listener)
            context.close()
        browser.close()
    result={'pages':len(pages),'viewports':len(VIEWPORTS),'cases':len(reports),'passed':sum(r.get('passed',False) for r in reports),'issues':issues,'sprite':sprite_report,'reports':reports,'limits':['Chromium emulation; not physical iOS/Android','No Safari/Firefox verification','Public deployed URL belongs to root release verification']}
    (OUT/'report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
    print(json.dumps({'cases':len(reports),'passed':result['passed'],'issues':len(issues),'output':str(OUT)},ensure_ascii=False))
    assert not issues, f'{len(issues)} QA failures; see {OUT}/report.json'


if __name__=='__main__':
    main()
