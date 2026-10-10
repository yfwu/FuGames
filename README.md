# FuGames

FuLab 風格的靜態網頁遊戲集。遊戲與 AI 都在瀏覽器 JavaScript 內執行，不需要遊戲伺服器、帳號、外部資源或 npm 套件。各遊戲共用 `fulab-theme.css`。

## 本機預覽

在 repository 目錄執行：

```sh
python -m http.server 8000 --bind 0.0.0.0
```

開啟 `http://localhost:8000/`；圈地漫遊的網址是 `http://localhost:8000/territory_loop.html`。雲端環境可將 8000 port 轉送至本機預覽。此指令只提供本機靜態檔案，不會部署網站。

本次雲端 Chromium 的管理政策禁止 `file://`（`ERR_BLOCKED_BY_ADMINISTRATOR`），因此驗證與預覽使用本機 HTTP。遊戲不會向伺服器傳送遊戲狀態；頁面載入後已驗證可在離線模式繼續遊玩。

## 遊戲

- 三子循環棋：`cyclic_tictactoe.html`
- 環面直落四子：`cyclic_connect4_torus.html`
- 軌道棋：`trackgame.html`
- 圈地漫遊 Territory Loop：`territory_loop.html`

### 圈地漫遊

玩家為青綠圓形，兩名 AI 為珊瑚方形與紫色菱形。點「開始圈地」後持續前進：離開己方領地留下虛線路徑，回到己方領地時取得路徑及完整封閉的區域。可奪取敵方領地、切斷敵方路徑；自己撞線、被切線或領地全失會出局。出局者的剩餘領地回歸空白。

先取得 35% 領地或成為唯一存活者獲勝；120 秒結束時，在場者領地最多的一方獲勝，並列最高為平手。地圖四邊只會讓角色停住，不會穿越或出局；轉向可繼續，但時間仍會流逝。邊界本身不充當圈地的封閉線。

- 桌機：方向鍵或 WASD 轉向，不可直接反向折返；空白鍵／P 暫停或繼續，Esc 暫停。
- 手機：棋盤滑動或方向按鈕。直向及橫向都有適用版型。
- 切換視窗或分頁自動暫停；返回後手動繼續。
- 「重新開始」會先暫停並確認，可以保留本局繼續。

同一個 HTML 內的 `game-engine` script 提供純狀態模擬；`game-ui` script 處理 Canvas、固定步長更新及輸入。圈地採從四邊 flood fill 判斷封閉區域。AI 在瀏覽器內挑選短矩形路徑，評估新增領地與附近對手風險；必要時尋路返家，或切斷相鄰對手路徑。不做真實多人連線。

## 驗證

Repository 沒有建置指令、package manifest、lint 設定或自訂 CI workflow；既有 GitHub Pages 部署由儲存庫設定管理。新增測試不會引入遊戲執行依賴。

### 規則測試（Node.js 18 以上）

```sh
node --test tests/territory-loop.test.cjs
git diff --check
```

直接擷取 HTML 內實際使用的引擎執行，涵蓋圈地／搶地、開放邊界、自撞、切線、失地、快速輸入、暫停、重開、勝負、AI 返家與攻擊、30 場固定亂數種子的完整模擬，以及遊戲清單連結。

### 瀏覽器測試（開發工具：Python Playwright + Chromium）

先啟動上述靜態伺服器，再執行：

```sh
python tests/browser_smoke.py
```

若環境尚未有測試工具，可安裝 Python 的 `playwright` 並提供 Chromium 執行檔。環境變數：

- `FUGAMES_BASE_URL`：預設 `http://127.0.0.1:8000`
- `CHROMIUM_PATH`：預設 `/usr/bin/chromium`
- `FUGAMES_SCREENSHOTS`：預設 `/tmp/fugames-review`，不寫入 repository

測試使用 Chromium 實際鍵盤與觸控事件完成圈地，檢查 AI 擴張、邊界轉向、暫停／繼續、視窗離焦、重開／取消、出局／重玩、勝利／平手畫面、離線遊玩及既有遊戲頁面。另檢查 320px 窄手機、橫向手機、平板和桌機的版型、低動態偏好，並產生截圖。勝利／平手 UI 使用接近倒數結束的固定局面；圈地與自撞則透過實際輸入達成。

觸控驗證使用 Chromium 裝置模擬，不能代替實體 iOS Safari、Android 裝置及不同瀏覽器引擎的驗證。
