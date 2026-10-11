# Hex 三方升級與全站視覺整合

基線：同步 origin/main 後仍為 `5711ea87c1cdf9537cb5b045a2f520a0833d6d26`。工作樹原本乾淨，未發現 AGENTS.md 或本地 .agents/skills。修改前 `node --test tests/*.test.cjs` 149/149 通過。

## 修改前盤點

`python tests/visual_audit.py --label before` 已保存 14 頁 × 桌機1366×1000／手機390×844 × 開局前／後，共56張實際Chromium截圖及 inventory.json，在 `/tmp/fugames-revision-visual/before`。逐頁未發現溢出或JS錯誤，但首頁13圖示筆畫、留白、中心不同，早期棋盤圓點依賴字型；部分卡牌、效果物件及方向鈕也是字型符號。桌面與手機拼圖已目視盤點。

## 分工與檔案界線

- Hex worker：只改 `card_hex.html`、`tests/card-hex.test.cjs`，新增自己專用Hex browser/balance測試與文件。原本1人+1AI，新增1AI；採放大的正六邊形場地、三組旋轉對稱對邊目標。量化削減護盾，有限洗牌道具，炮台預告無差別攻擊且有期限，僅owner可見的陷阱。純觀察狀態AI、反偷看、輪位平衡與長局模擬。
- Icons worker：只改 `index.html`，新增 `icons.svg`、圖示規格／測試。統一48×48 viewBox、2px描邊、圓角端點與接合、至少6px安全留白、视觉中心；symbol IDs 使用遊戲檔名stem。額外共用symbol命名：arrow-up/down/left/right, launch, play, pause, restart, rotate, undo, hint, shield, turret, trap, double, remove, bridge, suit-club/diamond/heart/spade, fruit, star, poison, slow。
- Classic worker：只改 `fulab-theme.css` 及 `cyclic_tictactoe.html`、`cyclic_connect4_torus.html`、`trackgame.html` 和自己新增的visual tests。統一設計token、header icon、HUD、棋盤幾何棋子、狀態、按鈕、規則、touch，但保留各自玩法。
- IO worker：只改 `territory_loop.html`、`star_feast.html`、`effect_snake.html`、`tank_arena.html`、`pulse_arena.html` 的視覺層和自己的新增視覺測試。遊戲邏輯保持，Canvas圖標用幾何繪製、CSS/SVG圖示替代字型資產、必要狀態加入形狀或線型標示。
- Cards/boards visual worker：只改 `blackjack.html`、`duplicate_bridge.html`、`flip_five.html`、`gravity_brawl.html` 的視覺層和自己新增測試。保留引擎規則，卡牌花色／棋子／方向圖標使用原生SVG/CSS。
- QA worker：只讀稽核與新增獨立 `tests/revision_visual.test.cjs`、`tests/revision_browser.py`；在以上各worker完成後檢查全站icons、形狀/比例/對比、restart/pause/input、desktop/mobile。不得修改其他worker檔案。
- 主worker：整合、更新既有受Hex改版影響的browserfixtures（保留其他12款回歸）、README與說明、保留前後截圖證據、提交並推送main、追蹤對應CI與既有Pages至terminal。所有子worker不得commit/push。

共用header icon形式：`<svg class="page-icon" viewBox="0 0 48 48" aria-hidden="true"><use href="icons.svg#GAME_STEM"></use></svg>` 放在h1內。玩法內裝飾圖標 `class="ui-icon"`，尺寸由共享CSS管理；維持可讀文字或aria-label。SVG不依賴外部服務，採固定幾何，不以emoji作資產。

## 驗收

保留舊149測試的非Hex規則覆蓋；Hex11個既有規則案例調整新座位／幾何，擴增砲台、陷阱、weighted shuffle、反偷看、平衡測試。全部Node規則、9個既有browser套件、新增Hex/visual套件、逐頁before/after桌機手機截圖、320窄屏和橫屏裁切／伸縮／overflow檢查；明示實體裝置與公開URL未驗證範圍。

## 完成證據

所有分工已完成，保留13款既有遊戲。最終185/185 Node測試、九支既有與六支新增瀏覽器套件通過；Hex另完成108局平衡／標籤置換／基準研究。詳見[驗證紀錄](validation.md)、[逐頁前後與狀態畫面](comparison.md)及[三方Hex規則](hex.md)。發布commit及CI／Pages terminal結果由主代理交付訊息附上。
