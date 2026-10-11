"""Cards/boards visual regression: SVG faces, non-color states, geometry, input, four viewports."""
import hashlib,json,os,re,subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
BASE=os.environ.get('FUGAMES_BASE_URL','http://127.0.0.1:8000')
OUT=Path(os.environ.get('FUGAMES_TABLE_SCREENSHOTS','/tmp/fugames-revision-visual/tables-after'))
OUT.mkdir(parents=True,exist_ok=True)
PAGES=['blackjack','duplicate_bridge','flip_five','gravity_brawl']

def fit(page):
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), page.url+' overflow'
    findings=page.evaluate("""() => [...document.querySelectorAll('svg.page-icon,svg.ui-icon,svg.suit,svg.card-suit,svg.gravity-arrow')].filter(e=>e.getBoundingClientRect().width>0).map(e=>{const r=e.getBoundingClientRect(),box=e.querySelector('use')?.getBBox();return{class:e.getAttribute('class'),ratio:r.width/r.height,width:box?.width,height:box?.height}})""")
    for f in findings:
        assert abs(f['ratio']-1)<.02, f
        assert f['width'] and f['height'], ('empty SVG symbol',f)
    assert page.locator('h1 .page-icon').count()==1

def human_bridge(page):
    for _ in range(30):
        s=page.evaluate('BridgeUI.snapshot()')
        if s['human'] or s['phase']=='complete':return s
        page.clock.run_for(800)
    raise AssertionError('Bridge AI never yielded')

engines={}
for name in PAGES:
    now=(ROOT/(name+'.html')).read_text()
    old=subprocess.check_output(['git','show','HEAD:'+name+'.html'],cwd=ROOT,text=True)
    pattern=r'<script id="(?:blackjack|game|flip|brawl)-engine">([\s\S]*?)</script>'
    before=re.search(pattern,old).group(1);after=re.search(pattern,now).group(1)
    assert before==after, name+' engine changed during a visual-only revision'
    engines[name]=hashlib.sha256(after.encode()).hexdigest()

results=[];errors=[];failed=[]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
    for width,height,label in [(1366,1000,'desktop'),(390,844,'mobile'),(320,568,'narrow'),(844,390,'landscape')]:
        context=browser.new_context(viewport={'width':width,'height':height},has_touch=label!='desktop',is_mobile=label!='desktop')
        context.add_init_script('let visualSeed=71;Math.random=()=>((visualSeed=(Math.imul(visualSeed,1664525)+1013904223)>>>0)/4294967296);')
        for name in PAGES:
            page=context.new_page();page.clock.install(time=1791696000000)
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.on('console',lambda m:errors.append(m.text) if m.type=='error' else None)
            page.on('requestfailed',lambda r:failed.append(r.url))
            if name=='duplicate_bridge':page.add_init_script('Math.random=()=>0;Date.now=()=>1;')
            page.goto(BASE+'/'+name+'.html');page.wait_for_load_state('networkidle');fit(page)
            page.screenshot(path=str(OUT/f'{name}-{label}-ready.png'),full_page=True)
            if name=='blackjack':
                page.locator('#deal').click()
                assert page.locator('#player-cards svg.suit').count()==2
                assert page.locator('#dealer-cards .back').count()==1
                assert page.locator('#dealer-cards .back').inner_text()==''
                assert page.locator('#player-cards .bj-card').first.get_attribute('aria-label')
                page.locator('#stand').click();page.clock.run_for(700)
                assert page.locator('#pause').is_enabled()
                page.locator('#pause').click()
                assert page.locator('#pause-overlay').is_visible()
                page.locator('#resume').click()
            elif name=='duplicate_bridge':
                page.locator('#start').click();human_bridge(page)
                page.locator('#bid-level').select_option('7');page.locator('#bid-strain').select_option('4');page.locator('#bid').click()
                assert human_bridge(page)['phase']=='play'
                page.locator('#hint').click()
                assert page.locator('#hand .playing-card.hint').count()==1
                assert page.locator('#hand .playing-card:not(:disabled)').count()>0
                assert page.locator('#hand .card-suit').count()==page.locator('#hand .playing-card').count()
                assert page.evaluate("getComputedStyle(document.querySelector('#hand .hint')).outlineStyle")=='dashed'
                assert page.evaluate("getComputedStyle(document.querySelector('#hand .playing-card:not(:disabled)')).borderBottomWidth")=='4px'
                page.locator('#pause').click();page.locator('#pause').click()
            elif name=='flip_five':
                page.locator('#play').click();page.locator('[data-cell="24"]').click();page.clock.run_for(700)
                assert page.locator('.flip-cell[data-owner="1"]').count()==1
                assert page.locator('.flip-cell[data-owner="2"]').count()==1
                assert page.locator('.flip-cell[data-owner="1"] span').inner_text()==''
                assert page.evaluate("getComputedStyle(document.querySelector('.flip-cell[data-owner=\"2\"] span')).transform")!='none'
                page.locator('#pause').click();page.locator('#pause').click()
                square=page.locator('.flip-cell').first.bounding_box();assert abs(square['width']-square['height'])<.05
            else:
                page.locator('#play').click();page.locator('#drop').click();page.clock.run_for(300)
                page.locator('#pause').click();page.locator('#pause').click()
                for direction in range(4):
                    page.evaluate(f'game.gravity={direction};refresh()')
                    assert page.locator('#gravity use').get_attribute('href')=='icons.svg#'+['arrow-down','arrow-left','arrow-up','arrow-right'][direction]
                for selector in ['#board','#board-1','#board-2','#board-3']:
                    box=page.locator(selector).bounding_box();assert abs(box['width']-box['height'])<.1
                box=page.locator('#next').bounding_box();assert abs(box['width']/box['height']-160/104)<.02
            fit(page);page.screenshot(path=str(OUT/f'{name}-{label}.png'),full_page=True)
            if name=='flip_five':
                page.evaluate('flipGame.reset();flipGame.start();flipGame.board[37]=flipGame.board[38]=flipGame.board[39]=2;flipGame.board[40]=1;flipRender()')
                page.locator('[data-cell="36"]').click()
                assert page.locator('.flip-cell.winning').count()==5
                assert page.locator('.flip-cell.flipped').count()==3
                page.screenshot(path=str(OUT/f'{name}-capture-{label}.png'),full_page=True)
            results.append({'page':name,'viewport':label,'overflow':False,'icons':'rendered, square','geometry':'checked'})
            page.close()
        context.close()
    browser.close()
assert not errors, errors
assert not failed,failed
(OUT/'report.json').write_text(json.dumps({'engines_unchanged':engines,'results':results,'errors':errors,'failed_requests':failed},ensure_ascii=False,indent=2))
print(json.dumps({'pages':len(PAGES),'viewports':4,'checks':len(results),'screenshots':len(list(OUT.glob('*.png'))),'engines_unchanged':True,'errors':errors,'failed_requests':failed,'output':str(OUT)},ensure_ascii=False))
