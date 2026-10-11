"""Capture shared SVG icons in homepage/header and compare baseline/new rasterization."""
from pathlib import Path
import subprocess,re,json
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'docs/hex-seeded-2026-10-11/screenshots/after'
old=subprocess.check_output(['git','show','fe26f199436b95896c41ed917dac2efd0e448585:icons.svg'],cwd=ROOT,text=True);new=(ROOT/'icons.svg').read_text();names=['gravity_brawl','duplicate_bridge'];report=[]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for label,w,h,dpr in [('desktop',1366,1000,1),('mobile',390,844,3)]:
  page=browser.new_page(viewport={'width':w,'height':h},device_scale_factor=dpr)
  for name in ['index',*names]:
   page.goto('http://127.0.0.1:8000/'+name+'.html');assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.screenshot(path=str(OUT/f'{name}-{label}.png'),full_page=True)
   for icon in names if name=='index' else [name]:
    selector=f'svg:has(use[href="icons.svg#{icon}"])';measure=page.locator(selector).evaluate('(e)=>({viewBox:e.getAttribute("viewBox"),size:e.getBoundingClientRect().width,geometry:{x:e.querySelector("use").getBBox().x,y:e.querySelector("use").getBBox().y,w:e.querySelector("use").getBBox().width,h:e.querySelector("use").getBBox().height}})');assert measure['viewBox']=='0 0 48 48';report.append({'page':name,'icon':icon,'viewport':label,'dpr':dpr,**measure})
  page.close()
 for dpr in [1,2,3]:
  page=browser.new_page(viewport={'width':720,'height':560},device_scale_factor=dpr)
  symbols='';rows=''
  for name in names:
   for tag,src in [('before',old),('after',new)]:
    symbol=re.search(r'<symbol id="'+name+r'"[\s\S]*?</symbol>',src)[0].replace(f'id="{name}"',f'id="{name}-{tag}"');symbols+=symbol
    rows+=f'<section><span>{name}<br>{tag}</span>'+''.join(f'<div><svg width="{size}" height="{size}" viewBox="0 0 48 48"><use href="#{name}-{tag}"/></svg><small>{size}px</small></div>' for size in [16,24,32,48,96])+'</section>'
  page.set_content('<!doctype html><html><head><style>body{margin:24px;background:#f8f9fb;color:#267477;font:14px system-ui}h1{font-size:18px}section{display:flex;align-items:center;gap:28px;margin:20px 0}span{width:150px;font-size:12px}div{width:56px;display:flex;align-items:center;flex-direction:column;gap:8px}small{font-size:10px;color:#657283}</style></head><body><h1>FuGames · shared icons · before / after · DPR '+str(dpr)+'</h1><svg width="0" height="0" style="position:absolute">'+symbols+'</svg>'+rows+'</body></html>');page.screenshot(path=str(OUT/f'icons-comparison-dpr{dpr}.png'),full_page=True);page.close()
 browser.close()
(ROOT/'docs/hex-seeded-2026-10-11/icons.json').write_text(json.dumps(report,indent=2)+'\n');print('Homepage/header shared geometry and overflow checks passed; DPR 1/2/3 contact sheets saved.')
