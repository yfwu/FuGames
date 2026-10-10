# FuGames 八款擴充計畫

基線：`b2cbd26ab2bea526de6b5fe2805fc1fb64107c20`。保留五款既有遊戲，沿用 `fulab-theme.css`、導覽、白底低彩度 FuLab 視覺及收合規則。2026-10-10 檢查 repository、workspace 及 `.agents`，未發現 AGENTS.md 或本地 SKILL.md。

## 實作與分工

所有遊戲及 AI 在本機 JavaScript 執行，不使用模型 API、多人伺服器、外部素材或新增部署服務。每款獨立 HTML，純引擎 script 與 UI 分離；規則測試直接執行該引擎。子代理只修改自己列出的 HTML 及 test，主代理負責整合文件、首頁與跨頁驗證。

|負責區塊|頁面|規則方向|AI 與必要驗證|
|---|---|---|---|
|board agent|`card_hex.html`|雙人連線 Hex，抽牌雙鋪／拆除／護盾反制；有限道具與回合上限|連線最短路、阻斷、有限手牌；反制和終局邊界|
|board agent|`flip_five.html`|落空格、八向夾翻，落子與翻轉後一起檢查五連|即勝／防敗搜尋；雙方五連、滿盤、無合法步|
|blocks agent|`gravity_brawl.html`|一人加三 AI，預告旋轉重力的方塊競技；攻擊先抵消再送出|搜尋合法落點；旋轉、清線、攻擊抵消、淘汰與平手|
|snake agent|`effect_snake.html`|效果食物競逐、可辨識好壞效果、持續補入 AI|避障與空間評估、搶食／截擊個性；碰撞、效果、重生|
|bridge agent|`duplicate_bridge.html`|經典合法叫牌與打牌、複式計分、相同不可變牌局獨立 AI 桌重打|簡化五張高花自然制、公開資訊推論；52 張／13 墩、叫牌與計分 fixtures、反偷看|
|blackjack agent|`blackjack.html`|免費虛擬籌碼，S17、natural 3:2、double（split 若實作則完整規則）|固定莊家規則、AI 牌友個性／下注；軟硬點、結算、反偷看與重入|
|arena agent|`tank_arena.html`|原創坦克升級射擊競技場，破壞靶標取得升級與得分|瞄準預測、走位與升級差異；子彈／碰撞／升級／重生|
|arena agent|`pulse_arena.html`|原創物理擊退生存，縮圈與蓄力脈衝|邊緣回避、出擊時機與空間控制；擊退／出界／勝負|

## 整合與驗收

1. 每頁清楚介紹操作、勝負及特殊規則，立即可玩；AI 明確標示為本機 AI。
2. 鍵盤與手機觸控、暫停／切頁後手動恢復、結算或持續補入、重新開始。
3. 子代理執行核心規則邊界測試與長時間固定種子 AI 模擬，回報限制；主代理執行全部 Node tests、既有 browser regressions、新遊戲 Chromium 實際互動與截圖、console errors、窄螢幕溢出。
4. 主代理整合首頁與 README、記錄每款規則及驗證結果。禁止子代理 commit/push，避免共享工作樹競爭。
5. 使用者已授權將 FuGames 修改 commit 並推送 `yfwu/FuGames main`，沿用既有 GitHub Pages；主代理追蹤該 commit 的 CI/Pages 至 terminal，確認公開 URL，任何阻擋如實記錄。

## 橋牌依據

採 WBF/ACBL duplicate laws（合法操作由 UI 約束，不模擬違規裁判程序）：https://www.worldbridge.org/wp-content/uploads/2017/03/2017LawsofDuplicateBridge-nohighlights.pdf 。研究者另提供 ACBL 規則與完整計分 fixture。叫牌僅稱簡化自然制練習 AI，不宣稱完整 SAYC 或專家系統；參考桌必須真正獨立重打同牌，結果統一 NS 視角。
