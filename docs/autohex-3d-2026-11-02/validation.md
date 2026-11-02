# AutoHex-3D 驗證（2026-11-02）

## 重現

```sh
node --test tests/*.test.cjs
AUTOHEX3D_FULL=1 node tests/autohex-3d-browser.cjs
git diff --check
```

## 規則測試

全站 `node --test tests/*.test.cjs`：465 / 465 通過，零失敗、零跳過（約 110 秒）；輸出見 [rules-tests.log](rules-tests.log)。新增 `tests/autohex-3d.test.cjs` 9 項：

- 3D 頁依 AutoHex 相同順序載入同一組規則腳本與同一個 AI Worker。
- 3D 程式碼不寫入任何棋盤欄位、不呼叫私有方法；對 `game` 只呼叫 `act / start / pause / advanceTime / continueSandbox / observation`。
- 補給弱點與 `supplyCutPreview` 逐格比對一致（兩個 seed、四個階段，所有己方連通棋子）。
- 補給報表與 `computeSupply`、陣地報表與公開欄位一致；牌池配方合計 13／78 張、護盾 1 張。
- 指令佇列 240 手：只會回傳 `legalAction` 通過的行動，卡牌在執行時重新對應手牌位置，失效指令移除。
- 3D 點選座標換算覆蓋全部 1,027 格。

既有目錄測試的遊戲數量隨新卡片更新（首頁 16、合計 18 款、圖示 43 個）。

## 瀏覽器試玩（Chromium 153，SwiftShader WebGL2）

下表為第二版戰場造型（地塊變色、粒子爆炸、轟炸機與卡車）後重跑的結果。十分鐘戰役由真實時間推進，AI 步速與計時的交錯不同，因此與前一輪手數不同；兩輪都要求重放一致。

詳見 [browser-report.json](browser-report.json)。每一例都把頁面的完整行動紀錄（人類、AI、佇列、逾時）在 Node 的 AutoHex 引擎重放，棋盤、存糧與分數完全一致。

| 情境 | 結果 |
| --- | --- |
| 桌機 1440 親自指揮 | 以真實滑鼠點 3D 畫面下令 30 次：鋪子 23、拆除敵方補給弱點 4、為己方弱點架盾 3；AI 行動中預約 2 個指令並自動執行；指揮時限逾時自動休整 1 次；暫停凍結計時；195 手，重放一致，無錯誤、無橫向溢出 |
| 桌機 1280 觀戰 | 六 AI 303 手，重放一致 |
| 手機 390／320 | 觸控點格下令各 4 次，重放一致，無橫向溢出 |
| 完整十分鐘戰役（觀戰） | 1,823 手至結算畫面：C 紫藤 96、B 珊瑚 85、D 藍灰 80、E 草綠 74、A 青綠 70、F 琥珀 38。攻占 251、擊毀 128、斷補撤退 544、接通對岸 6、用牌 80、炮擊 113、空投 6、轟炸 5、重洗 1。重放一致 |

畫面：[開局](desktop-ready.png) · [中局（陣地＋AI 路線）](desktop-midgame.png) · [指揮列](desktop-command.png) · [觀戰總覽](spectator-overview.png) · [十分鐘結算](full-campaign-result.png) · [手機 390](phone-390.png) · [手機 320](phone-320.png)

## 戰場造型的檢查

以暫停凍結動畫後逐張檢視：地塊變色與邊緣狀態、城堡、砲塔瞄準與後座、柏油路與軍用卡車、桁架橋、地道口、機場起降、砲彈飛行與煙跡、命中爆炸（閃光、火球、煙柱、土塊、塵環、焦痕）、轟炸機進場投彈。截圖見 [README](README.md#戰場造型2026-11-02-更新)。這是目視檢查，不是自動化的影像比對。

## 限制

- 本環境以 SwiftShader 軟體模擬 GPU，畫面約每秒數幀；每幀 JavaScript（建場景＋繪製呼叫）約 2 ms。實機 GPU 幀率未量測，不宣稱實機效能。
- 沒有 WebKit／Firefox 執行檔，未驗證 Safari 與 Firefox；手機為 Chromium 視窗與觸控模擬，不是實機。
- 試玩機器人是簡單的補給導向啟發式，用來操作真實介面；不代表平衡研究。完整戰役為單一 seed 的六 AI 對局。
- 需要 WebGL2；不支援時頁面顯示說明並連到平面版 AutoHex。
