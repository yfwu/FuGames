# 獨立 QA：2026-10-11 視覺與 Hex 改版

結論：本輪獨立 QA 通過，未留阻擋項目。來源檔只讀；QA 新增本文件、`tests/revision_visual.test.cjs` 與 `tests/revision_browser.py`。主 worker 已完成修改前 149/149 baseline，本角色未重跑該 baseline。

## 實際執行結果

| 檢查 | 結果 | 證據 |
|---|---|---|
| 全站靜態 SVG 契約＋獨立 Hex 審查 | 20/20 通過 | `node --test tests/revision_visual.test.cjs` |
| 38 個共用 symbol 的實際繪圖邊界 | 38/38 通過 | Chromium `getBBox()` 加上各圖形的半描邊寬，最小墨跡安全留白 **6px** |
| 首頁＋13 遊戲，四種 viewport | **56/56 通過** | `/tmp/fugames-revision-qa/report.json` |
| Hex 放大／縮回與手機真實 touch 平移補驗 | **4/4 通過** | `/tmp/fugames-revision-qa/hex-zoom/report.json`；390px 與 320px 均可平移 |
| Browser console／page error／失敗請求／HTTP error | 全部 0 | 上述兩份報告 |
| 截圖 | 全站 240 張＋Hex 補驗 22 張 | `/tmp/fugames-revision-qa/` 與其 `hex-zoom/` 子目錄 |

Viewport 為 1366×1000 桌面、390×844 手機、320×568 窄手機、844×390 橫向。修改前的 56 張截圖在 `/tmp/fugames-revision-visual/before/`，完整 before／after 彙整由主 worker 負責。

## 視覺、互動與狀態

- 首頁 13 款圖示與各頁 header 都正確引用對應 `icons.svg#遊戲檔名`，使用 48×48 viewBox；sprite 描邊 2px，端點與接合為 round。沒有字型、圖片或外部服務依賴。少數遊戲圖例使用直接繪製的 SVG/CSS 圓形與屋形，仍為原生幾何。
- 實際 DOM 量測未發現頁面水平溢出、shell／棋盤越界、Canvas／棋子／圖示伸縮、圖示被按鈕裁切或 overlay 被容器裁切。操作按鈕與 select 維持至少 44px 高。
- ready、active、rules 展開、paused、restart 狀態皆檢查；有計時或 AI 排程的頁面，暫停和 window blur 後狀態完全凍結，只有手動恢復才繼續。三款舊回合制棋盤無持續計時，不把不存在的 pause 當成缺陷。
- 全站使用真實鍵盤或 touch 事件完成至少一個有效操作及重新開始；橋牌叫牌、21 點停牌、方塊轉向／落下、棋盤落子、IO 移動皆可操作。此獨立套件沒有用強制修改遊戲狀態來替代互動。
- 手機 Hex 放大後，只有 `.hex-scroll` 形成可捲動區域，document 寬度保持不變；實際 touch 橫移後可縮回。測試等待原生 compositor 捲動慣性停止，再點縮回，避免把虛擬 JS 時鐘誤當成瀏覽器慣性時鐘。
- 短橫向的 IO 頁沿用隱藏 header、保留牌場與操作區的配置；圖示仍存在 DOM，未把這項刻意配置判為圖示遺失。
- 已目視首頁桌面、橋牌手機、重力方塊 320px、Hex 320px 畫面。不同陣營有形狀／實線／虛線／輪廓或文字輔助；可操作與暫停狀態不只靠顏色表示。

## Hex 獨立規則與資訊隔離審查

- 檢查全部 91 格的 120° 旋轉對應、全部鄰接關係、三組對邊各 6 格、空盤最短路均為 11。另用 20 種盤面檢查實際連線與終局代價在旋轉後完全相等。
- 分別由玩家 1／2／3 先手，確認相同 13 張有限牌池、每人只有 1 張護盾、回合循環及 180 手上限為完整三方輪轉。這證明幾何與資源對稱，不代表任何策略組合的勝率必定相等；多局勝率統計由 Hex owner 另行提交。
- 對每位觀察者 1／2／3、各 3 個固定 seed，交換敵方秘密陷阱中心，重新分配敵方手牌與牌堆（保留其完整 13 張牌池），並更換敵方私有 seed。`observation(observer)` 與 `chooseAction(observation)` 結果完全不變。
- 確認觀察狀態只含自己的 `hand`、`ownTraps` 與 seed；沒有原始 `hands`／`decks`／`traps`／`seeds`。敵方暗伏的 `last.cells` 只保留正常鋪子格；公開部署次數、手牌數量、已揭露陷阱及公開炮台屬規則允許資訊。
- 源碼審查確認炮台先收集所有同時到期者再齊射，清除區域內所有陣營棋子，包含己方；被同批炮擊擊中的到期炮台仍會開火。陷阱先處理本手新落子，炮擊完成後才判連線；反制完成才結束攻擊者的回合。
- AI 接收的是遮蔽後 observation，未傳入 raw Game。攻擊評估同時考慮兩位對手，沒有硬編碼只針對人類玩家。

## 已修正的審查發現

問題均交由擁有該檔案的 worker 修正，QA 沒有修改遊戲：

1. Hex 開始／再來一局按鈕缺共用 SVG，且 render 會覆蓋 icon：改為保留 SVG＋文字，所有四種 viewport 已重驗。
2. Hex 放大控制原本 36px 高：改成 44px。
3. 暗伏說明沒有區分正常落子與秘密中心：現在明示正常落子仍可觸發既有陷阱，秘密中心不會觸發。
4. AI 即勝說明過度保證未知陷阱結算後結果：改成依公開炮擊預估嘗試接通，未知敵方陷阱仍可能攔截。
5. AI 暗伏候選原先只對自己的既有中心扣分：改為直接排除，避免產生引擎拒絕的候選。主 worker 同時要求對手回應候選使用預測局面的完整空格集合。

## 重現

先提供本機靜態伺服器（預設 `http://127.0.0.1:8000`）：

```sh
node --test tests/revision_visual.test.cjs
python tests/revision_browser.py
```

Hex 補驗可縮小範圍且另存報告：

```sh
FUGAMES_QA_PAGES=card_hex FUGAMES_QA_OUTPUT=/tmp/fugames-revision-qa/hex-zoom python tests/revision_browser.py
```

最終全站 56/56 報告與新增放大測試後的 Hex 4/4 補驗互相補足；其餘頁面的測試邏輯未更動。

## 未驗證範圍

本角色使用 Chromium 桌面／手機 emulation，沒有實體 iOS／Android、Safari／Firefox 測試；沒有獨立重做整套遊戲規則與長局勝率測試。公開 GitHub Pages URL、最終 commit、CI 與部署 terminal 結果由主 worker 驗收。
