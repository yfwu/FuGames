"""Homepage navigation/layout and rendered native SVG geometry checks.
Requires local server at :8000, Chromium, Playwright and Pillow.
Screenshots and measurements: /tmp/fugames-revision-icons.
"""
from pathlib import Path
import json
import re
from io import BytesIO
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=Path('/tmp/fugames-revision-icons');OUT.mkdir(exist_ok=True)
BASE='http://127.0.0.1:8000/'
ids=re.findall(r'<symbol id="([^"]+)"',(ROOT/'icons.svg').read_text())
report={'homepage':[],'icons':[]}
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    for label,w,h in [('desktop',1366,1000),('mobile',390,844),('narrow',320,740),('landscape',844,390)]:
        page=browser.new_page(viewport={'width':w,'height':h},device_scale_factor=1)
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.on('console',lambda m:errors.append(m.text) if m.type=='error' else None)
        page.goto(BASE+'index.html');page.wait_for_load_state('networkidle')
        assert page.locator('.game-card').count()==13
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        measures=page.locator('.game-icon').evaluate_all('(nodes)=>nodes.map(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height,view:n.getAttribute("viewBox"),use:{width:n.querySelector("use").getBBox().width,height:n.querySelector("use").getBBox().height}}))')
        assert len({(i['width'],i['height']) for i in measures})==1
        assert all(i['width']==i['height'] and i['view']=='0 0 48 48' and i['use']['width']>0 for i in measures)
        names=page.get_by_role('link',name=re.compile('開始遊玩')).all()
        assert len(names)==13
        for link in names:
            target=link.get_attribute('href')
            assert target.endswith('.html') and (ROOT/target).is_file()
            assert link.get_attribute('aria-label').startswith('開始遊玩')
        assert not errors,errors
        page.screenshot(path=str(OUT/f'homepage-{label}.png'),full_page=True)
        report['homepage'].append({'viewport':[w,h],'cards':13,'uniform_square_icons':True,'overflow':False,'console_errors':errors})
        page.close()
    page=browser.new_page(viewport={'width':1020,'height':1300},device_scale_factor=1)
    page.goto(BASE+'index.html')
    tiles=''.join(f'<article><svg class="sample" id="i-{name}" viewBox="0 0 48 48" aria-label="{name}"><use href="icons.svg#{name}"></use></svg><svg class="small" viewBox="0 0 48 48" aria-hidden="true"><use href="icons.svg#{name}"></use></svg><p>{name}</p></article>' for name in ids)
    page.set_content('<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:24px;background:#f8f9fb;color:#267477;font-family:ui-monospace,monospace}h1{font-size:21px;margin:0 0 6px}header p{font-size:12px;margin:0 0 18px;color:#657283}.grid{display:grid;grid-template-columns:repeat(6,1fr);gap:10px}article{position:relative;border:1px solid #d8dee9;background:white;border-radius:12px;text-align:center;padding:14px 5px 8px;min-width:0}.sample{display:block;width:96px;height:96px;margin:auto;color:#000;background:white}.small{position:absolute;right:8px;top:8px;width:20px;height:20px;color:#267477}article p{font-size:10px;margin:10px 0 0;overflow-wrap:anywhere;min-height:26px}</style></head><body><header><h1>FuGames / 原生圖示集</h1><p>48 × 48 座標 · 2 px 描邊 · 至少 6 px 安全留白 · 右上為實際 20 px 控制尺寸</p></header><div class="grid">'+tiles+'</div></body></html>')
    page.wait_for_timeout(350)
    for name in ids:
        el=page.locator('#i-'+name)
        bbox=el.locator('use').evaluate('(n)=>{const b=n.getBBox();return{x:b.x,y:b.y,width:b.width,height:b.height}}')
        assert bbox['width']>0 and bbox['height']>0,name
        assert bbox['x']>=7-1e-5 and bbox['y']>=7-1e-5 and bbox['x']+bbox['width']<=41+1e-5 and bbox['y']+bbox['height']<=41+1e-5,(name,bbox)
        im=Image.open(BytesIO(el.screenshot())).convert('RGB')
        ink=[]
        for y in range(im.height):
            for x in range(im.width):
                weight=1-sum(im.getpixel((x,y)))/(255*3)
                if weight>.03:ink.append((x,y,weight))
        assert len(ink)>80,name+' failed to render'
        xs=[x for x,y,v in ink];ys=[y for x,y,v in ink];mass=sum(v for x,y,v in ink)
        painted=[min(xs),min(ys),max(xs),max(ys)]
        assert min(xs)>=11 and min(ys)>=11 and max(xs)<=84 and max(ys)<=84,(name,painted)
        centroid=[sum((x+.5)*v for x,y,v in ink)/mass/2,sum((y+.5)*v for x,y,v in ink)/mass/2]
        report['icons'].append({'id':name,'geometry_bbox':bbox,'painted_bbox_at_96px':painted,'ink_centroid_in_48px':centroid})
    page.screenshot(path=str(OUT/'contact-sheet.png'),full_page=True)
    browser.close()
(OUT/'measurements.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps({'homepage_viewports':len(report['homepage']),'icons_rendered':len(report['icons']),'output':str(OUT)},ensure_ascii=False))
