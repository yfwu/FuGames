"""Browser interaction checks. Run against the local static server (see README).

Playwright is a development-only dependency; the game itself has no dependencies.
"""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = os.environ.get("FUGAMES_BASE_URL", "http://127.0.0.1:8000")
ARTIFACTS = Path(os.environ.get("FUGAMES_SCREENSHOTS", "/tmp/fugames-review"))
ARTIFACTS.mkdir(parents=True, exist_ok=True)


def until(page, expression, limit=100):
    for _ in range(limit):
        if page.evaluate(expression):
            return
        page.clock.run_for(50)
    raise AssertionError(f"Never reached: {expression}; state={page.evaluate('JSON.stringify(game.actors[0])')}")


def assert_fits(page):
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "Horizontal overflow"
    assert page.evaluate("""() => {
      const overlay = document.getElementById('overlay');
      if (overlay.hidden) return true;
      const board = document.querySelector('.board-wrap').getBoundingClientRect();
      const dialog = document.querySelector('.dialog').getBoundingClientRect();
      return dialog.top >= board.top && dialog.bottom <= board.bottom;
    }"""), "Dialog clipped by the board"


with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path=os.environ.get("CHROMIUM_PATH", "/usr/bin/chromium"),
        headless=True,
        args=["--no-sandbox"],
    )
    errors, failed_requests = [], []
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    page = context.new_page()
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("requestfailed", lambda request: failed_requests.append(request.url))
    page.clock.install()
    page.goto(BASE + "/index.html")
    assert page.get_by_text("西瓜棋").count() == 0
    assert context.request.get(BASE + "/watermelon_chess.html").status == 404
    page.locator('a[href="territory_loop.html"]').click()
    assert page.title() == "圈地漫遊 Territory Loop - FuGames"
    assert_fits(page)
    page.screenshot(path=str(ARTIFACTS / "desktop-ready.png"), full_page=True)
    page.get_by_role("button", name="開始圈地 →", exact=True).click()
    assert page.evaluate("game.phase") == "running"

    # A real keyboard loop closes back onto the starting territory.
    until(page, "game.actors[0].x === 9")
    page.keyboard.press("ArrowDown")
    until(page, "game.actors[0].y === 18")
    page.keyboard.press("ArrowLeft")
    until(page, "game.actors[0].x === 5")
    page.keyboard.press("ArrowUp")
    until(page, "game.actors[0].captures === 1")
    assert page.evaluate("game.counts()[1]") == 41
    assert page.locator("#score").inner_text() == "4.6"
    assert "圈地成功" in page.locator("#status").inner_text()
    page.screenshot(path=str(ARTIFACTS / "desktop-capture.png"), full_page=True)

    # Pause freezes the actual timer, all actors and their paths, then resumes.
    page.keyboard.press("Space")
    assert page.evaluate("game.phase") == "paused"
    snapshot = page.evaluate("JSON.stringify(game)")
    page.clock.run_for(3000)
    assert page.evaluate("JSON.stringify(game)") == snapshot
    page.get_by_role("button", name="繼續圈地 →", exact=True).click()
    until(page, "game.actors[0].y === 0")
    page.clock.run_for(1000)
    assert page.evaluate("game.actors[0].blocked && game.actors[0].alive")
    assert "邊界" in page.locator("#status").inner_text()
    assert page.evaluate("game.actors.slice(1).every(a => a.captures > 0)")
    page.keyboard.press("d")
    until(page, "game.actors[0].x === 6")
    assert page.evaluate("!game.actors[0].blocked")
    page.screenshot(path=str(ARTIFACTS / "desktop-playing.png"), full_page=True)

    # Switching away auto-pauses. Restart supports both cancellation and reset.
    page.evaluate("window.dispatchEvent(new Event('blur'))")
    assert page.evaluate("game.phase") == "paused"
    page.get_by_role("button", name="重新開始", exact=True).click()
    assert page.locator("#dialog-title").inner_text() == "重新開始這一局？"
    old_tick = page.evaluate("game.tick")
    page.get_by_role("button", name="保留本局，繼續", exact=True).click()
    assert page.evaluate("game.tick") == old_tick
    page.get_by_role("button", name="重新開始", exact=True).click()
    page.get_by_role("button", name="確定重開", exact=True).click()
    assert page.evaluate("game.tick") == 0
    assert page.evaluate("Array.from(game.counts()).join(',')") == "825,25,25,25"
    assert page.evaluate("game.actors.every(a => a.alive && !a.trail.length)")

    # Actual self-intersection displays a loss and replay gives a fresh running game.
    until(page, "game.actors[0].x === 9")
    page.keyboard.press("s"); until(page, "game.actors[0].y === 16")
    page.keyboard.press("a"); until(page, "game.actors[0].x === 8")
    page.keyboard.press("w"); until(page, "game.phase === 'over'")
    assert page.evaluate("game.result.outcome") == "loss"
    assert "自己" in page.locator("#dialog-copy").inner_text()
    page.screenshot(path=str(ARTIFACTS / "desktop-result.png"), full_page=True)
    page.get_by_role("button", name="再玩一局 →", exact=True).click()
    assert page.evaluate("game.tick === 0 && game.phase === 'running'")
    # Deterministic end-state fixtures verify the same UI for win and draw.
    for outcome in ["win", "draw"]:
        page.evaluate("""outcome => {
          game.board.fill(0); game.board.fill(1, 0, 25); game.board.fill(2, 30, 55); game.board.fill(3, 60, 85);
          if (outcome === 'win') game.board[29] = 1;
          game.tick = Territory.ROUND_TICKS - 1;
        }""", outcome)
        page.clock.run_for(250)
        assert page.evaluate("game.result.outcome") == outcome
        assert page.locator("#overlay").is_visible()
        assert "時間到" in page.locator("#dialog-copy").inner_text()
        page.get_by_role("button", name="再玩一局 →", exact=True).click()

    # Browser-level offline check: no game server or third-party requests needed.
    context.set_offline(True)
    page.clock.run_for(700)
    assert page.evaluate("game.tick") > 0
    context.set_offline(False)
    page.keyboard.press("Escape")
    page.get_by_role("link", name="← FuGames").click()
    for href in ["cyclic_tictactoe.html", "cyclic_connect4_torus.html", "trackgame.html"]:
        page.goto(BASE + "/" + href)
        assert page.locator("h1").is_visible()

    # Real mobile touch events: swipe and large direction buttons.
    mobile_context = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    mobile = mobile_context.new_page()
    mobile.on("pageerror", lambda error: errors.append(str(error)))
    mobile.clock.install()
    mobile.goto(BASE + "/territory_loop.html")
    assert_fits(mobile)
    mobile.screenshot(path=str(ARTIFACTS / "mobile-ready.png"), full_page=True)
    mobile.get_by_role("button", name="開始圈地 →", exact=True).tap()
    until(mobile, "game.actors[0].x === 8")
    box = mobile.locator("#board").bounding_box()
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    session = mobile_context.new_cdp_session(mobile)
    session.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
    session.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": y + 45}]})
    session.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    until(mobile, "game.actors[0].y === 18")
    mobile.get_by_role("button", name="向左", exact=True).tap()
    until(mobile, "game.actors[0].x === 5")
    mobile.get_by_role("button", name="向上", exact=True).tap()
    until(mobile, "game.actors[0].captures === 1")
    assert mobile.evaluate("game.counts()[1]") > 25
    mobile.screenshot(path=str(ARTIFACTS / "mobile-capture.png"), full_page=True)
    mobile.get_by_role("button", name="暫停", exact=True).tap()
    assert mobile.evaluate("game.phase") == "paused"
    mobile.get_by_role("button", name="重新開始", exact=True).tap()
    mobile.get_by_role("button", name="確定重開", exact=True).tap()
    assert mobile.evaluate("game.tick") == 0

    # Narrow phone, landscape phone, tablet and laptop layouts; overlays stay usable.
    for width, height in [(320, 568), (375, 667), (844, 390), (768, 1024), (1280, 720)]:
        mobile.set_viewport_size({"width": width, "height": height})
        mobile.goto(BASE + "/territory_loop.html")
        assert_fits(mobile)
        mobile.screenshot(path=str(ARTIFACTS / f"layout-{width}x{height}.png"), full_page=True)
        if (width, height) == (844, 390):
            mobile.get_by_role("button", name="開始圈地 →", exact=True).tap()
            assert mobile.locator("#board").bounding_box()["height"] < height
            for selector in ["#board", ".dpad", "#pause"]:
                rect = mobile.locator(selector).bounding_box()
                assert rect["y"] >= 0 and rect["y"] + rect["height"] <= height, selector
            mobile.get_by_role("button", name="向下", exact=True).tap()
            until(mobile, "game.actors[0].y === 15")
    # Reduced-motion rendering path also runs without errors.
    page.emulate_media(reduced_motion="reduce")
    page.goto(BASE + "/territory_loop.html")
    page.get_by_role("button", name="開始圈地 →", exact=True).click()
    page.clock.run_for(400)
    assert page.evaluate("game.tick > 0")
    assert not errors, errors
    assert not failed_requests, failed_requests
    print("PASS: desktop keyboard capture, AI expansion, boundary/turn, pause/resume, auto-pause,")
    print("restart/cancel, loss/replay, win/draw UI, offline play, existing game pages,")
    print("mobile touch swipe + d-pad capture, 5 responsive layouts, reduced motion.")
    print(f"No JavaScript errors or failed resource requests. Screenshots: {ARTIFACTS}")
    browser.close()
