"""Whole-site visual and interaction regression. Serve the repo first; see README."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = os.environ.get("FUGAMES_BASE_URL", "http://127.0.0.1:8000")
ARTIFACTS = Path(os.environ.get("FUGAMES_SCREENSHOTS", "/tmp/fugames-style-review"))
ARTIFACTS.mkdir(parents=True, exist_ok=True)
PAGES = ["index", "cyclic_tictactoe", "cyclic_connect4_torus", "trackgame", "territory_loop", "star_feast"]


def fits(page):
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), page.url
    assert page.evaluate("""() => {
      const overlay = document.getElementById('overlay');
      if (!overlay || overlay.hidden) return true;
      const dialog = document.querySelector('[role=dialog]').getBoundingClientRect();
      const stage = document.querySelector('.io-stage').getBoundingClientRect();
      return dialog.top >= stage.top && dialog.bottom <= stage.bottom && dialog.left >= stage.left && dialog.right <= stage.right;
    }"""), "Clipped start dialog: " + page.url


def activate(page, selector, mobile):
    element = page.locator(selector)
    element.tap() if mobile else element.click()


def board_games(page, mobile, label):
    page.goto(BASE + "/cyclic_tictactoe.html")
    if mobile:
        page.locator(".cell").first.tap()
    else:
        page.locator(".cell").first.focus()
        page.keyboard.press("Enter")
    assert page.locator("#moveCount").inner_text() == "2", "Player and AI should each move"
    assert page.locator(".cell:disabled").count() == 2
    assert page.locator(".cell:disabled").first.evaluate("el => getComputedStyle(el).color") == "rgb(46, 52, 64)", "Occupied pieces must not fade to disabled gray"
    page.screenshot(path=str(ARTIFACTS / f"tictactoe-playing-{label}.png"), full_page=True)
    # A winning fixture verifies that changing hint settings cannot reopen a finished round.
    page.evaluate("""() => { board=['X','X','X','','O','','O','','']; placedPieces={X:3,O:2}; placeOrder={X:[0,1,2],O:[4,6]}; checkAndNext('X'); }""")
    page.locator("summary").click()
    page.locator("#toggleNext").uncheck()
    assert page.locator(".cell:disabled").count() == 9
    assert page.locator(".cell.highlight").count() == 3
    page.get_by_role("button", name="重新開始", exact=True).click()
    assert page.locator("#moveCount").inner_text() == "0"
    assert page.locator(".cell:disabled").count() == 0

    page.goto(BASE + "/cyclic_connect4_torus.html")
    for column in [0, 1, 0, 1, 0, 1, 0]:
        activate(page, f'[data-col="{column}"]', mobile)
    assert "連成四子" in page.locator("#statusText").inner_text()
    assert page.locator(".colBtn:disabled").count() == 7
    page.screenshot(path=str(ARTIFACTS / f"connect4-win-{label}.png"), full_page=True)
    page.locator("#newGame").click()
    assert page.locator("#turnKpi").inner_text() == "0"
    assert page.locator(".cell.win").count() == 0
    assert page.evaluate("""() => { board=Array.from({length:6},()=>Array(7).fill('')); [5,6,0,1].forEach(c=>board[5][c]='B'); player='B'; return checkWin(5,1).length===4; }"""), "Wrapped line preserved"

    page.goto(BASE + "/trackgame.html")
    activate(page, '[data-idx="0"]', mobile)
    page.clock.run_for(400)
    page.locator(".piece").evaluate_all("pieces => pieces.forEach(el => el.getAnimations().forEach(animation => animation.finish()))")
    assert page.locator("#turnKpi").inner_text() == "1"
    # Pawn must be centred on the rotated destination, including on a narrow phone.
    pawn, cell = page.locator(".piece").bounding_box(), page.locator('[data-idx="1"]').bounding_box()
    assert abs((pawn["x"] + pawn["width"] / 2) - (cell["x"] + cell["width"] / 2)) < 2
    assert abs((pawn["y"] + pawn["height"] / 2) - (cell["y"] + cell["height"] / 2)) < 5
    page.screenshot(path=str(ARTIFACTS / f"track-playing-{label}.png"), full_page=True)
    activate(page, "#undo", mobile)
    assert page.locator("#turnKpi").inner_text() == "0"
    activate(page, "#hint", mobile)
    assert page.locator(".cell.hint").count() == 1
    activate(page, '[data-idx="0"]', mobile)
    activate(page, "#newGame", mobile)  # restart before the pending animation completes
    page.clock.run_for(450)
    assert page.locator("#turnKpi").inner_text() == "0"
    assert page.locator("#playerKpi").inner_text() == "黑"
    assert page.locator(".piece").count() == 0
    page.locator("summary").click()
    page.locator("#mode").select_option("ai")
    page.locator("#aiLevel").select_option("easy")
    page.locator("summary").click()
    activate(page, '[data-idx="0"]', mobile)
    page.clock.run_for(900)
    assert page.locator("#turnKpi").inner_text() == "2"
    assert page.locator(".piece").count() == 2
    activate(page, "#newGame", mobile)
    assert page.locator("#turnKpi").inner_text() == "0"


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH", "/usr/bin/chromium"), headless=True, args=["--no-sandbox"])
    errors, failed = [], []
    signatures = []
    for width, height, label in [(1366, 900, "desktop"), (390, 844, "mobile"), (320, 568, "narrow"), (844, 390, "landscape")]:
        mobile = label != "desktop"
        context = browser.new_context(viewport={"width": width, "height": height}, is_mobile=mobile, has_touch=mobile)
        context.add_init_script("let seed=71; Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);")
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("requestfailed", lambda request: failed.append(request.url))
        page.clock.install()
        for name in PAGES:
            page.goto(BASE + "/index.html")
            if name != "index":
                page.locator(f'a[href="{name}.html"]').click()
                assert page.locator("details").evaluate("el => !el.open")
            fits(page)
            signatures.append(page.evaluate("""() => {
              const btn=getComputedStyle(document.querySelector('.btn.primary'));
              return [getComputedStyle(document.body).fontFamily,btn.backgroundColor,btn.borderRadius,btn.minHeight].join('|');
            }"""))
            page.screenshot(path=str(ARTIFACTS / f"{name}-{label}.png"), full_page=True)
            if name != "index":
                page.locator("summary").click(); fits(page)
                page.locator("summary").click()
                page.get_by_role("link", name="所有遊戲 ↗", exact=True).click()
                assert page.locator(".game-card").count() == 5
        if label in ["desktop", "mobile"]:
            board_games(page, mobile, label)
        if label == "landscape":
            for name in ["territory_loop", "star_feast"]:
                page.goto(BASE + "/" + name + ".html")
                page.locator("#play").tap()
                for selector in ["#board", "#pause", ".dpad" if name == "territory_loop" else "#boost"]:
                    rect = page.locator(selector).bounding_box()
                    assert rect and rect["y"] >= 0 and rect["y"] + rect["height"] <= height, (name, selector, rect)
        context.close()
    assert len(set(signatures)) == 1, "Shared font/button tokens differ between pages"

    # Actual keyboard, mouse and touch controls in the new game.
    context = browser.new_context(viewport={"width": 1366, "height": 900})
    context.add_init_script("let seed=71; Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);")
    page = context.new_page(); page.clock.install()
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(BASE + "/star_feast.html")
    page.locator("#play").click()
    initial_ai = page.evaluate("JSON.stringify(game.actors.slice(1))")
    page.keyboard.down("ArrowRight"); page.clock.run_for(800); page.keyboard.up("ArrowRight")
    assert page.evaluate("game.actors[0].mass > 20 && game.collected > 0")
    assert page.evaluate("JSON.stringify(game.actors.slice(1))") != initial_ai
    stopped = page.evaluate("game.actors[0].x")
    page.clock.run_for(100); assert page.evaluate("game.actors[0].x") == stopped
    page.keyboard.press("Space"); assert page.evaluate("game.boostTime > 0 && game.cooldown > 0")
    page.clock.run_for(250); assert page.locator("#boost").is_disabled()
    box = page.locator("#board").bounding_box()
    page.mouse.move(box["x"] + box["width"] * .45, box["y"] + box["height"] * .65)
    page.clock.run_for(200)
    assert page.evaluate("game.actors[0].y > 360")
    page.screenshot(path=str(ARTIFACTS / "star-playing-desktop.png"), full_page=True)
    page.keyboard.press("p"); assert page.evaluate("game.phase") == "paused"
    snapshot = page.evaluate("JSON.stringify(game)"); page.clock.run_for(2500)
    assert page.evaluate("JSON.stringify(game)") == snapshot
    page.locator("#play").click(); page.evaluate("window.dispatchEvent(new Event('blur'))")
    assert page.evaluate("game.phase") == "paused"
    page.locator("#restart").click(); old_tick = page.evaluate("game.tick")
    page.locator("#dialog-secondary").click(); assert page.evaluate("game.tick") == old_tick
    page.locator("#restart").click(); page.locator("#play").click()
    assert page.evaluate("game.tick === 0 && game.actors[0].mass === 20 && game.cooldown === 0")

    # Engine fixtures drive real animation-frame/UI end-state handling.
    for outcome in ["win", "loss", "draw"]:
        page.evaluate("""outcome => {
          game.food=[];
          if(outcome==='win') game.actors[0].mass=160;
          if(outcome==='loss') {const enemy=game.actors[1]; enemy.mass=50; enemy.x=game.actors[0].x;enemy.y=game.actors[0].y;}
          if(outcome==='draw') {game.actors.forEach(a=>a.mass=40);game.tick=StarFeast.ROUND_TICKS-1;}
        }""", outcome)
        page.clock.run_for(100)
        assert page.evaluate("game.result.outcome") == outcome
        assert page.locator("#overlay").is_visible()
        page.screenshot(path=str(ARTIFACTS / f"star-{outcome}.png"), full_page=True)
        page.locator("#play").click()
    context.set_offline(True)
    page.keyboard.down("d"); page.clock.run_for(350); page.keyboard.up("d")
    assert page.evaluate("game.tick > 0 && game.actors[0].x > 180")
    context.close()

    mobile_context = browser.new_context(viewport={"width":390,"height":844}, is_mobile=True, has_touch=True, device_scale_factor=2)
    page = mobile_context.new_page(); page.clock.install()
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(BASE + "/star_feast.html"); page.locator("#play").tap()
    box = page.locator("#board").bounding_box(); x, y = box["x"] + 90, box["y"] + box["height"] * .7
    cdp = mobile_context.new_cdp_session(page)
    cdp.send("Input.dispatchTouchEvent", {"type":"touchStart","touchPoints":[{"x":x,"y":y}]})
    cdp.send("Input.dispatchTouchEvent", {"type":"touchMove","touchPoints":[{"x":x+55,"y":y}]})
    page.clock.run_for(650)
    assert page.evaluate("game.actors[0].x > 210 && game.actors[0].mass > 20")
    page.screenshot(path=str(ARTIFACTS / "star-playing-mobile.png"), full_page=True)
    cdp.send("Input.dispatchTouchEvent", {"type":"touchEnd","touchPoints":[]})
    stopped = page.evaluate("game.actors[0].x"); page.clock.run_for(100)
    assert page.evaluate("game.actors[0].x") == stopped
    page.locator("#boost").tap(); assert page.evaluate("game.cooldown > 0")
    page.locator("#pause").tap(); assert page.evaluate("game.phase") == "paused"
    page.locator("#restart").tap(); page.locator("#play").tap()
    assert page.evaluate("game.tick === 0 && game.actors[0].mass === 20")
    mobile_context.close()
    assert not errors, errors
    assert not failed, failed
    print("PASS: all 6 pages at desktop, mobile, 320px and landscape; shared style tokens; no overflow/clipped dialogs; navigation and collapsed rules.")
    print("PASS: chess keyboard/touch + AI, win/reset, torus wrap, track rotation/undo/hint/AI and restart during animation.")
    print("PASS: growth keyboard/mouse/touch collection, AI, boost, release-to-stop, pause/blur/restart, win/loss/draw screens, offline play.")
    print(f"No JavaScript errors or failed requests. Screenshots: {ARTIFACTS}")
    browser.close()
