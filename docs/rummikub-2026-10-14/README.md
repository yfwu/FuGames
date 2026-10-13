# 四人拉密整合驗證

## 原始檔

使用者指定的 Studio 本地原始檔：`/Users/yfwu/Documents/Codex/2026-10-01/ni/outputs/FuLab-Rummikub.html`，55,942 bytes。

SHA-256：`0f16bc3fcfb26b7ce5fc74df8487bfbbe382204d632e459fd7626f500c8ecf5b`。

已靜態檢查後匯入 `rummikub.html`。兩段 JavaScript 與原始檔逐字相同，保留規則、AI、拖放、提示、撤回、存檔及 Worker fallback。僅整合首頁入口、共享 CSS／favicon／SVG、導航、玩法速覽與網站存檔說明。未修改其他遊戲或共用 CSS。

基底：`de52777d73f1b9bcba18eaa9f006aab5a81cf4ca`。此 checkout 與適用父目錄沒有 `AGENTS.md` 或 `.agents/skills`；按照 README 與既有 GitHub workflow 驗證。

## 本次實測

- `node --test tests/*.test.cjs`：422 項全部通過，見 `node-tests.log`。
- `git diff --check`：通過。
- `tests/rummikub-browser.cjs`：22 項 Chromium 實測通過，見 `browser-report.json`。
- 桌面 1440×1000：首頁入口、滑鼠拖放與新牌發光、撤回、30 點起手、三位 AI 的 Blob Worker 與返回玩家、存檔重新載入、設定／規則、新局取消與回首頁。
- 手機 390×844：Chromium CDP 原生模擬觸控拖放、撤回、多選組牌。390×844、320×568、844×390 無水平溢出。小高度視窗可垂直捲動。
- 頁面載入後斷網且禁用 Worker：提示合法擺牌且可撤回。
- 無 JavaScript 錯誤、無外部網路依賴。
- 人工檢視 `desktop.png`、`mobile.png`，導航、牌桌、手牌、操作鈕皆可見。

重跑瀏覽器測試需要開發環境安裝 Playwright 與 Chromium：`node tests/rummikub-browser.cjs`。測試自行啟動臨時 localhost 伺服器；工具不屬於遊戲執行依賴。可用 `NODE_PATH`、`PLAYWRIGHT_BROWSERS_PATH` 指向外部開發工具。

## 限制

未在實體手機或 Safari 實測；未執行額外的大量平衡模擬。本次新增六項小型規則測試，並執行 repository 既有完整測試。網站與原本本機 HTML 的存檔依 origin 分開；沒有承諾離線重新載入。AI 沿用原始有時限的搜尋，不保證最優解。
