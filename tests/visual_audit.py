"""Whole-site visual inventory. Run before/after edits with a static server running."""
import argparse, json, os
from pathlib import Path
from playwright.sync_api import sync_playwright
PAGES=['index','cyclic_tictactoe','cyclic_connect4_torus','trackgame','card_hex','gravity_brawl','flip_five','effect_snake','duplicate_bridge','blackjack','tank_arena','pulse_arena','territory_loop','star_feast']
parser=argparse.ArgumentParser();parser.add_argument('--label',default='after');parser.add_argument('--out',default='/tmp/fugames-revision-visual');args=parser.parse_args()
OUT=Path(args.out)/args.label;OUT.mkdir(parents=True,exist_ok=True)
results=[]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox'])
 for w,h,label in [(1366,1000,'desktop'),(390,844,'mobile')]:
  context=browser.new_context(viewport={'width':w,'height':h},is_mobile=label=='mobile',has_touch=label=='mobile')
  context.add_init_script('let visualSeed=71;Math.random=()=>((visualSeed=(Math.imul(visualSeed,1664525)+1013904223)>>>0)/4294967296);')
  page=context.new_page();page.clock.install(time=1791696000000)
  for name in PAGES:
   errors=[];console_errors=[];failed_requests=[]
   def error_listener(e): errors.append(str(e))
   def console_listener(message):
    if message.type=='error':console_errors.append(message.text)
   def request_listener(request):failed_requests.append(request.url)
   page.on('pageerror',error_listener)
   page.on('console',console_listener)
   page.on('requestfailed',request_listener)
   page.goto(os.environ.get('FUGAMES_BASE_URL','http://127.0.0.1:8000')+'/'+name+'.html')
   page.screenshot(path=str(OUT/f'{name}-{label}-ready.png'),full_page=True)
   for selector in ['#play','#start','#deal']:
    button=page.locator(selector)
    if button.count() and button.is_visible() and button.is_enabled():
     button.tap() if label=='mobile' else button.click()
     page.clock.run_for(300)
     break
   page.screenshot(path=str(OUT/f'{name}-{label}.png'),full_page=True)
   results.append({'page':name,'viewport':label,'width':w,'height':h,'overflow':page.evaluate('document.documentElement.scrollWidth>innerWidth'),'errors':errors,'console_errors':console_errors,'failed_requests':failed_requests,'font':page.evaluate('getComputedStyle(document.body).fontFamily'),'screenshots':[f'{name}-{label}-ready.png',f'{name}-{label}.png']})
   page.remove_listener('pageerror',error_listener)
   page.remove_listener('console',console_listener)
   page.remove_listener('requestfailed',request_listener)
  context.close()
 browser.close()
(OUT/'inventory.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
issues=[r for r in results if r['overflow'] or r['errors'] or r['console_errors'] or r['failed_requests']]
print(json.dumps({'label':args.label,'pages':len(PAGES),'screenshots':len(results)*2,'issues':issues,'output':str(OUT)},ensure_ascii=False))
assert not issues,issues
