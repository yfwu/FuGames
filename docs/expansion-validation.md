# 八款擴充驗證紀錄

2026-10-10；基線 `b2cbd26ab2bea526de6b5fe2805fc1fb64107c20`。遊戲與所有 AI 在瀏覽器執行，沒有新增執行套件或服務。只沿用 `yfwu/FuGames` 的 GitHub Pages。

## 核心規則與 AI

`node --test tests/*.test.cjs`：**149 個測試全部通過，0 失敗／跳過**。整合執行約 58 秒（容器同時執行瀏覽器測試，並非裝置效能基準）。其中既有遊戲 35 個、新遊戲 114 個；測試直接擷取實際 HTML 引擎，並非另寫的替身。

|遊戲|測試數／模擬|驗證重點|
|---|---|---|
|抽牌 Hex|11；20 盤完整 AI 棋局|六角相鄰／連線、雙鋪原子性、拆除／護盾、有限牌組、非法操作不變狀態、64 回合／滿盤、即勝與阻斷、手牌隔離、個性差異。|
|重力大亂鬥|13；60 局完整 AI 對戰|四種座標轉換、合法落點搜尋、消行與沉降、攻擊抵銷與延遲、淘汰／同時全滅、24 拍／平手、七袋、公平序列、AI 個性。|
|翻轉五子棋|10；12 盤完整 AI 棋局|八向同時翻轉、不連鎖、翻轉後五連／超五、雙方五連、無合法步／滿盤子數、即勝／防堵／防守翻轉、個性差異。|
|效果貪食蛇|15；30 固定種子長局，每局至 2,500 步或死亡|好壞食物、護盾最後一 tick、緩速、毒菇取消待長格数、同時撞頭／換頭／尾巴、AI 避障與空間、預告區失效後延後重生、食物更新與有界資源。|
|複式橋牌|24；512 副完整 AI 牌局＋80 組隨機合法叫牌／打牌|35 種 bid、pass／X／XX、首次叫出最終花色者主打、身價循環、首攻後夢家、跟牌、52 唯一牌／13 墩、完整複式計分 fixtures、64 條反偷看軌跡、同牌不可變重打、自然制狀態收斂。512 副中 491 副打完、21 副全 Pass；最長叫牌 13 次。|
|經典 21 點|17；1,500 局完整模擬|A 軟硬點、S17、natural／普通 21／和局／爆牌、3:2 精確籌碼、加倍前莊家檢查、合法餘額與下注、重複點擊／結算／過期回呼、固定公開狀態交換暗牌不改 AI 選擇。未提供 split。|
|鋼芯競技場|12；30 局完整 AI 對戰|高速子彈線段碰撞與首次命中、護盾／擊毀唯一得分、2 秒重生、升級實際影響與上限、位置與彈體上限、30 分／90 秒／平手、AI 走位／目標／升級差異。|
|脈衝擂台|12；60 局完整 AI 對戰|慣性／圓盤碰撞、蓄力範圍／衝量／冷卻、縮圈、全滅與同分、出界／終局、AI 戰術與有界位置／速度／事件。|

既有圈地漫遊另含 6 種子 × 20 分鐘（合計 120 模擬分鐘）的領地、補給、倒戈、助手及安全補入驗證；既有星點吞噬另含 30 場完整比賽。

## 實際瀏覽器

Python Playwright 1.62 + `/usr/bin/chromium`，以本機靜態 HTTP 執行。整合指令：

```sh
python tests/browser_smoke.py
python tests/site_browser.py
python tests/expansion_browser.py
```

三者皆通過。整站包含首頁＋13 款遊戲。既有五款完成原有規則、輸入、AI、重開、離線與畫面回歸；八款新遊戲在 1366×900、390×844、320×568、844×390 檢查導覽、收合規則、共用字體／主要按鈕、橫向溢出、實際截圖。新遊戲桌機／手機實際互動、AI 回應、暫停與凍結、手動恢復、重開與結算／持續遊戲都已驗證。主整合檢查未排除 favicon 錯誤；補上本地 favicon 後，**console error、pageerror、failed request 均為 0**。

各款深入互動測試均通過，可個別重跑：

```sh
python tests/board_expansion_browser.py
python tests/gravity_brawl_browser.py
python tests/effect-snake.browser.py
python tests/duplicate_bridge_browser.py
python tests/blackjack.browser.py
python tests/arena_browser.py
```

其中橋牌完成桌機、窄屏、橫屏、手機夢家、手機防守五盤 52 張牌的真實 UI 遊玩；脈衝擂台用 Chromium 原生 CDP 觸控驗證雙指同時移動與蓄力／釋放。棋盤測試包含完整 DOM 對局及 Hex 反制，方塊包含自然玩到結算與四向重力。終局固定局面只用來驗證 UI 呈現，規則本身另外由單元測試覆蓋。

## 截圖

以下是 Chromium 真實頁面畫面；已檢視手機與桌機樣式。完整原始證據另保留在執行環境 `/tmp/fugames-expansion/` 與各子項測試指定目錄。

|遊戲|桌機|手機|
|---|---|---|
|抽牌 Hex|[桌機](screenshots/card_hex-desktop.png)|[手機](screenshots/card_hex-mobile.png)|
|重力大亂鬥|[桌機](screenshots/gravity_brawl-desktop.png)|[手機](screenshots/gravity_brawl-mobile.png)|
|翻轉五子棋|[桌機](screenshots/flip_five-desktop.png)|[手機](screenshots/flip_five-mobile.png)|
|效果貪食蛇|[桌機](screenshots/effect_snake-desktop.png)|[手機](screenshots/effect_snake-mobile.png)|
|複式橋牌|[桌機](screenshots/duplicate_bridge-desktop.png)|[手機](screenshots/duplicate_bridge-mobile.png)|
|經典 21 點|[桌機](screenshots/blackjack-desktop.png)|[手機](screenshots/blackjack-mobile.png)|
|鋼芯競技場|[桌機](screenshots/tank_arena-desktop.png)|[手機](screenshots/tank_arena-mobile.png)|
|脈衝擂台|[桌機](screenshots/pulse_arena-desktop.png)|[手機](screenshots/pulse_arena-mobile.png)|

## 限制與發布邊界

- 尚未驗證實體 iOS／Android、Safari、Firefox、螢幕閱讀器與實體手機 FPS；觸控為 Chromium 裝置模擬，不能等同實機測試。
- AI 為可解釋啟發式，沒有宣稱專家／最優；橋牌採簡化五張高花自然制，非完整 SAYC。基準僅一張真實重打的本地 AI 桌，不宣稱真人排名或母體百分位。
- 棋盤遊戲為雙人（人＋AI）；標示四人的競技／牌桌為一人＋三名 AI，沒有網路真人多人。
- GitHub `Game rules` CI 僅執行 Node 規則與 AI 模擬、diff 檢查；瀏覽器套件並未納入 CI。Pages 仍使用原有自動部署。發布 commit、Actions run 與部署 URL 由最終交付訊息附上，避免將尚未發生的部署寫成成功。
