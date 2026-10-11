"""IO visual regression: vector state rendering, pause controls and compact layouts."""
from pathlib import Path
import json, os, re, subprocess, hashlib
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=Path('/tmp/fugames-revision-visual/io-after');OUT.mkdir(parents=True,exist_ok=True)
NAMES=['territory_loop','star_feast','effect_snake','tank_arena','pulse_arena']
results=[]
engine_hashes={}
for name in NAMES:
 source=(ROOT/(name+'.html')).read_text()
 original=subprocess.check_output(['git','show','5711ea87c1cdf9537cb5b045a2f520a0833d6d26:'+name+'.html'],cwd=ROOT,text=True)
 pattern=r'<script id="[^\"]*engine">([\s\S]*?)</script>'
 current=re.search(pattern,source).group(1)
 assert current==re.search(pattern,original).group(1),name+' rules changed'
 engine_hashes[name]=hashlib.sha256(current.encode()).hexdigest()
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for width,height,mode in [(1366,1000,'desktop'),(390,844,'mobile'),(320,700,'narrow'),(844,390,'landscape')]:
  context=browser.new_context(viewport={'width':width,'height':height},is_mobile=mode!='desktop',has_touch=mode!='desktop')
  context.add_init_script('''let visualSeed=71;Math.random=()=>((visualSeed=(Math.imul(visualSeed,1664525)+1013904223)>>>0)/4294967296);
  window.drawnLabels=[];const originalText=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,...rest){window.drawnLabels.push(String(text));return originalText.call(this,text,...rest);};''')
  page=context.new_page();page.clock.install(time=1791696000000);page.clock.pause_at(1791696000000)
  for name in NAMES:
   errors=[]
   def error(e):errors.append(str(e))
   page.on('pageerror',error)
   page.goto(os.environ.get('FUGAMES_BASE_URL','http://127.0.0.1:8000')+'/'+name+'.html')
   assert page.locator('h1 .page-icon use').get_attribute('href')=='icons.svg#'+name
   assert page.locator('a[aria-label="所有遊戲 ↗"] .ui-icon').count()==1
   assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),(name,mode,'overflow')
   assert page.evaluate('''()=>{const a=document.querySelector('.io-stage').getBoundingClientRect(),b=document.querySelector('.game-dialog').getBoundingClientRect();return b.left>=a.left&&b.right<=a.right&&b.top>=a.top&&b.bottom<=a.bottom}'''),(name,mode,'dialog clipping')
   if mode in ['desktop','mobile']:page.screenshot(path=str(OUT/f'{name}-{mode}-ready.png'),full_page=True)
   page.locator('#play').click();page.clock.run_for(300)
   assert page.evaluate('game.phase')=='running'
   assert page.locator('#pause .ui-icon').count()==1
   if name=='star_feast':assert page.locator('#boost use').get_attribute('href')=='icons.svg#arrow-right'
   if name=='tank_arena':assert page.locator('#upgrade-fire use').get_attribute('href')=='icons.svg#turret'
   if page.locator('.dpad').count():assert page.locator('.dpad .ui-icon').count()==4
   if mode in ['desktop','mobile']:page.screenshot(path=str(OUT/f'{name}-{mode}.png'),full_page=True)
   if mode=='landscape':
    assert page.evaluate('''()=>{const b=document.querySelector('.io-stage').getBoundingClientRect(),s=document.querySelector('.io-support').getBoundingClientRect(),p=document.querySelector('#pause').getBoundingClientRect();return b.bottom<=innerHeight&&s.top>=b.top-4&&s.bottom<=innerHeight&&p.top>=s.top&&p.bottom<=s.bottom}'''),(name,'compact controls outside panel')
    page.screenshot(path=str(OUT/f'{name}-{mode}.png'),full_page=True)
   page.locator('#pause').click();assert page.evaluate('game.phase')=='paused'
   assert page.locator('#pause .ui-icon use').get_attribute('href')=='icons.svg#play'
   frozen=page.evaluate('JSON.stringify(game)');page.clock.run_for(500);assert page.evaluate('JSON.stringify(game)')==frozen
   page.locator('#play').click();assert page.evaluate('game.phase')=='running'
   assert page.locator('#pause .ui-icon use').get_attribute('href')=='icons.svg#pause'
   if mode in ['desktop','mobile'] and name in ['effect_snake','tank_arena','pulse_arena']:
    page.clock.run_for(160)
    if name=='effect_snake':page.evaluate("game.food=['fruit','star','shield','poison','slow'].map((type,i)=>({x:9+i*2,y:13,type,expires:game.tick+190}));game.actors[0].shield=20;game.actors[0].slow=20;hud();draw()")
    elif name=='tank_arena':page.evaluate('game.targets[0].hp=1;game.actors[0].hp=2;game.actors[0].xp=3;hud();draw()')
    else:page.evaluate('game.actors[0].x=640;game.actors[0].y=360;game.actors[0].charging=true;game.actors[0].charge=.65;hud();draw()')
    page.screenshot(path=str(OUT/f'{name}-{mode}-states.png'),full_page=True)
    if name=='pulse_arena':assert page.evaluate('''()=>{const s=document.querySelector('#pulse span');return s.getBoundingClientRect().height<=parseFloat(getComputedStyle(s).lineHeight)+1}'''),'pulse action label wrapped'
   forbidden=page.evaluate("drawnLabels.filter(t=>/[●✦◇≈↳⌂×]/.test(t))")
   assert not forbidden,(name,'font glyph visual assets',forbidden)
   assert not errors,(name,errors)
   results.append({'page':name,'viewport':mode,'overflow':False,'dialog_and_controls':'pass','persistent_svg_controls':'pass','canvas_glyph_assets':forbidden,'errors':errors})
   page.remove_listener('pageerror',error)
  context.close()
 browser.close()
(OUT/'results.json').write_text(json.dumps({'engine_hashes':engine_hashes,'results':results},ensure_ascii=False,indent=2))
print(json.dumps({'checks':len(results),'screenshots':len(list(OUT.glob('*.png'))),'engine_hashes':engine_hashes,'errors':[],'out':str(OUT)},ensure_ascii=False))
