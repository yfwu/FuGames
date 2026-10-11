# 三方 Hex 與全站視覺修訂驗證

2026-10-11。修改前再次同步 `origin/main`，基線仍為 `5711ea87c1cdf9537cb5b045a2f520a0833d6d26`，工作樹原本乾淨。沒有新增服務、執行套件或部署途徑；沿用既有 GitHub Pages。遊戲與 AI 都在瀏覽器本地執行。

## 規則與回歸

修改前 **149/149** 通過。最終 `node --test tests/*.test.cjs` 為 **185/185 通過，0 失敗、取消、跳過**，本次整合執行約 51.4 秒。新增的 Hex 測試保留原 11 個案例的規則意圖，改為三方與新幾何，再擴充炮台、陷阱、飛橋及座位互換邊界。

| 範圍 | 測試數 | 主要涵蓋 |
| --- | ---: | --- |
| 三方 Hex | 21 | 91 格及旋轉對稱、角格、有限牌池／唯一護盾、非法操作不變狀態、三方拆除反制、雙鋪、炮台同步齊射／自傷／到期、陷阱隱藏／重疊／新落子、飛橋、效果先於勝負、滿盤／180 手、AI 即勝／阻擋／個性／反偷看、6 場完整輪位局、浮點同分回歸 |
| 重力大亂鬥 | 13 | 合法落點、四向重力、干擾抵銷、淘汰／結算、60 局 AI |
| 翻轉五子棋 | 10 | 同回合翻轉／五連、雙方五連、滿盤、即勝／防守、12 局 AI |
| 效果貪食蛇 | 15 | 食物、效果期限、同步碰撞、安全補入、30 種子長局 |
| 複式橋牌 | 24 | 合法叫牌／出牌、夢家、跟牌、計分、反偷看、512 副 AI 牌局 |
| 經典 21 點 | 17 | A／S17、blackjack／和局／爆牌、double、虛擬籌碼、暗牌隔離、1,500 局 |
| 鋼芯競技場 | 12 | 子彈碰撞、傷害／重生、升級、勝負、30 局 AI |
| 脈衝擂台 | 12 | 慣性／碰撞／擊退、縮圈、同步出界／和局、60 局 AI |
| 星點吞噬 | 11 | 收集／吞噬、衝刺、AI、勝負、30 局 AI、全頁腳本與本地資產 |
| 圈地漫遊 | 24 | 領地／補給／倒戈／重生、長期有界狀態、6×20 分鐘模擬 |
| 共用圖示 | 6 | 38 個真實幾何、描邊留白、鏡射／旋轉對稱、花色、首頁對應 |
| 獨立全站與 Hex 審查 | 20 | 14 頁 SVG 契約、完整幾何旋轉、三位觀察者秘密狀態置換、輪次／牌池公平 |

九款視覺修訂頁的 engine script 與基線逐字相同，SHA-256 保存於 [engine-hashes.json](engine-hashes.json)。三款早期棋盤保留原玩法，以實際鍵盤／觸控驗證落子、AI、勝負、環面連線、旋轉、悔棋、提示與動畫中重開。

本地資產測試也配合原生 SVG 更新：只豁免 `document.createElementNS` 的標準 SVG namespace（它不發出網路請求），仍禁止遠端遊戲依賴、fetch 與 WebSocket；靜態 `icons.svg#symbol` 會同時檢查檔案及 symbol，動態引用由 Chromium 實際載入檢查。沒有刪除規則斷言來適應視覺變更。

## Hex 平衡與策略

完整資料與 engine hash 在 [balance.json](balance.json)，可重跑 `node tests/hex-balance.cjs`。這是額外的本機研究，不放進每次 CI 的一般測試時間。

- **72 局主樣本**：24 個獨立牌序種子，各 3 組先手／目標軸／個性配置；實際輪換手牌、牌堆及私有同分種子等座位資料。不是所有組合的完整因子設計，同牌序的三局相關。
- 座位 1／2／3 勝局為 **20／21／16**，和局 **15**；行動次序第 1／2／3 位勝局 **20／18／19**。目標軸勝局 **22／21／14**。這個有限樣本沒有出現一個座位極端壟斷，並不證明所有策略或人類玩家的勝率相等。
- **55 局連線、17 局滿盤，0 局觸及 180 手上限**。平均 71.18 手、中位數 63、P95 116、最長 119。
- 道具使用：雙鋪 **855**、拆除 **412**、炮台 **421**、暗伏 **425**、飛橋 **272**、護盾 **122**；陷阱觸發 **393**、炮擊 **671** 次。所有行動合法，有限牌池每步守恆。
- **18 局座位標籤審查**：6 個種子各輪換三種完整玩家標籤，包含先手、目標、手牌、牌堆、個性及私有同分種子；**6/6 組完整行動軌跡與還原後勝負完全一致**。
- **18 局策略基準**：新版 AI 對兩位只重自身最短路、普通鋪子／雙鋪的簡單機器人，輪座後 **18 勝、0 敗、0 和**。這個基準刻意較少戰術能力，不是舊版引擎、專家、真人難度或排名。
- 5,125 次 `chooseAction`，本 Linux Node runner 平均 **7.75ms**、P95 **13.38ms**、最大 **36.08ms**；不是實體手機效能測量。

最初四組牌序重複排列的研究混雜了牌序與固定少數派個性，不能用來宣稱座位平衡。擴大樣本後，完整標籤置換還抓到評分同分的浮點問題：對手編號改變加總順序，會讓 `25` 與 `25.000000000000004` 改變落點。現在依實際相對行動次序評估，保留一半自身評分及兩位對手各四分之一回應權重，並以 1e-6 穩定比較。具體失敗局面已成回歸測試；上述數據全部來自修正後引擎。

## Chromium 實際操作

既有九支瀏覽器套件全部通過：

```sh
python tests/browser_smoke.py
python tests/site_browser.py
python tests/expansion_browser.py
python tests/board_expansion_browser.py
python tests/gravity_brawl_browser.py
python tests/effect-snake.browser.py
python tests/duplicate_bridge_browser.py
python tests/blackjack.browser.py
python tests/arena_browser.py
```

桌機／手機執行真實 keyboard、mouse、touch；包含開局、完整棋局或持續模式、勝負、重開、暫停、切頁後保持暫停及手動恢復、導航與離線持續遊玩。Hex 完整 DOM 對局與原有拆除／護盾 fixture 已改成三位玩家，沒有略過新增的第二位 AI。

六支新增專項套件：

```sh
python tests/classic_visual_browser.py
python tests/table_visual_browser.py
python tests/io_visual_browser.py
python tests/hex_revision_browser.py
python tests/icons_browser.py
python tests/revision_browser.py
```

獨立全站 QA 為 **14 頁×4 尺寸＝56/56 通過**，另補 **Hex 放大／縮回 4/4**；390px／320px 用真 touch 平移放大棋盤，只有棋盤容器捲動，document 不溢出。38 個 SVG 實際 `getBBox()` 與墨跡量測通過；圖示／Canvas／棋子比例、44px 控制、overlay 裁切及動態 SVG 保留均檢查。console、pageerror、HTTP error、失敗請求為 **0**。完整方法與限制見 [獨立 QA](qa.md)、[全站報告](browser-report.json)、[Hex 放大報告](hex-zoom-report.json)。

## 可 review 的畫面證據

[逐頁前後比對](comparison.md) 保存 **75 張 PNG**：14 頁的桌機／手機 before／after 共 56 張、三款早期棋盤相同走棋狀態的 12 張配對、38 圖示對照表 1 張、Hex 特殊規則與手機結算 6 張。最初 before 在修改前擷取；額外棋盤狀態的 before 明確來自基線 commit 隔離副本，附有 hash 與操作來源。

`python tests/visual_audit.py --label after` 產生的最終全站清單與圖片也無錯誤／溢出。更多 ready／active／paused／restart／窄屏／橫屏證據保存在執行環境的各 `/tmp/fugames-revision-*` 目錄；未將所有重複中間圖片塞入 repository。

## 驗證限制與發布

- 尚未驗證實體 iOS／Android、Safari／Firefox、螢幕閱讀器或實體手機 FPS；手機輸入是 Chromium emulation。
- AI 為本地啟發式與有限搜尋；沒有模型 API、隱藏牌偷看、真人連線或專家能力宣稱。
- `Game rules` CI 執行全部 Node 測試及 diff whitespace 檢查，瀏覽器套件仍在本機執行。部署只沿用原 GitHub Pages。
- 此文件記錄已完成的本機驗收。最終 commit、對應 Actions／Pages run ID 與 terminal 結果由交付訊息附上，避免先把未發生的發布寫成成功。
