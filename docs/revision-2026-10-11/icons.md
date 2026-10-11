# FuGames 共用圖示規格與驗收

2026-10-11 修訂。首頁原本十三個圖示各自使用 60×60 的內嵌圖形，圖形比例、描邊、留白及中心不一。現在首頁及遊戲頁共用根目錄 `icons.svg`，包含十三個遊戲符號與二十五個控制／道具符號；全部為本專案自行繪製的 SVG 幾何，不使用 emoji、字型字符、遠端圖示服務或第三方素材。

## 幾何與使用合約

- 每個 `<symbol>` 都明列 `viewBox="0 0 48 48"`、`stroke="currentColor"`、`stroke-width="2"`、`stroke-linecap="round"`、`stroke-linejoin="round"`、`fill="none"`。
- 含描邊後的實際繪圖範圍不得超出 `[6, 42] × [6, 42]`，亦即四周最少 6 座標單位留白。只有小圓點及四個花色以明確的 `fill="currentColor"` 填色；花色用幾何外形辨識。
- 所有線條、形狀都以 SVG 的 `path`、`rect`、`circle` 繪製，沒有文字、圖片、巢狀引用、變形或外部資源。曲線採原生三次／二次 Bézier。
- 對稱圖形以 `(24,24)` 為基準。Hex 圖示保持 120° 旋轉對稱，複式橋牌的四席保持 90° 旋轉對稱，循環棋和旋轉控制保持 180° 旋轉對稱；盾牌、花色、陷阱、沙漏等保持左右對稱。
- 方向箭頭保留一致旋轉中心。播放三角形以墨色輪廓的視覺中心定位，不能只用外接框中心判定；坦克本體與炮台底座已在圖示對照表目視檢查後上移，以平衡上方炮管。
- 圖示採 `currentColor`，由頁面或共用 CSS 決定顏色及顯示尺寸。不得用通配 CSS 強制覆蓋子圖形的 `fill`；否則花色及圓點會失去語義。

遊戲頁標題：

```html
<svg class="page-icon" viewBox="0 0 48 48" aria-hidden="true">
  <use href="icons.svg#card_hex"></use>
</svg>
```

控制按鈕：

```html
<button class="btn" type="button">
  <svg class="ui-icon" viewBox="0 0 48 48" aria-hidden="true">
    <use href="icons.svg#restart"></use>
  </svg>
  重新開始
</button>
```

文字標籤或既有 `aria-label` 仍然承擔無障礙名稱。純裝飾圖示設 `aria-hidden="true"`；SVG 不是按鈕名稱或遊戲說明的替代品。首頁十三個入口保留既有 `aria-label="開始遊玩…"`。

## 遊戲符號

| Symbol ID | 圖形語彙 |
| --- | --- |
| `card_hex` | 正六邊形、三條等角連線與三個端點 |
| `gravity_brawl` | 四個方塊與弧形重力轉向箭頭 |
| `flip_five` | 五子斜線與雙向翻轉箭頭 |
| `effect_snake` | 連續蛇身、眼點與食物 |
| `duplicate_bridge` | 四席旋轉排列的牌張 |
| `blackjack` | 兩張錯位牌張、菱形花色 |
| `tank_arena` | 左右對稱履帶、炮塔與炮管 |
| `pulse_arena` | 擂台邊界、圓盤與左右脈衝波 |
| `star_feast` | 大圓球及三個分散小圓球 |
| `territory_loop` | 領地、未閉合的虛線路徑 |
| `cyclic_tictactoe` | 三子連線與循環角標 |
| `cyclic_connect4_torus` | 四子橫排與首尾循環箭頭 |
| `trackgame` | 內外軌道與左右棋子 |

## 共用符號

- 導航／控制：`arrow-up`、`arrow-down`、`arrow-left`、`arrow-right`、`launch`、`play`、`pause`、`restart`、`rotate`、`undo`、`hint`。
- Hex 道具：`shield`、`turret`、`trap`、`double`、`remove`、`bridge`。
- 花色：`suit-club`、`suit-diamond`、`suit-heart`、`suit-spade`。
- 食物／效果：`fruit`（蘋果）、`star`（五角星）、`poison`（骷髏）、`slow`（沙漏）。護盾效果重用 `shield`。

`launch` 是指向右上、離開方框的箭頭。陷阱為對稱齒口及中央觸發點；橋接是拱橋；雙鋪為兩格六角形與加號。這些符號仍搭配遊戲內的明文名稱及操作說明。

## 首頁整合

十三張卡片都以檔名 stem 直接引用對應遊戲符號，桌面圖示容器統一 64×64、手機 56×56，內距皆 8px。棋盤、動作、牌桌以既有 FuLab 的青綠、靛藍、梅紫淡底區分，圖形與文字也能在不辨顏色時辨識。

「開始遊玩」的字型箭頭改為 `launch`。Hex 文案已與規則實作者確認為「單人 × 2 AI」及「91 格六邊形棋盤，三方搶線；炮台與暗伏改寫戰局。」，移除舊版保證留護盾的暗示。

## 已執行驗證

`node --test tests/icons.test.cjs`：**6/6 通過**。

1. 全部 38 個 ID 與各符號共用屬性精確對應，禁止文字／圖像資產／外部依賴。
2. 實際 path、rect、circle 幾何加半個描邊寬度後維持 6px 安全範圍；檢查非零尺寸、有限座標及合理外接框中心。
3. 檢查指定圖形左右／上下對稱。
4. 檢查 Hex 120°、橋牌 90°、循環圖形 180° 旋轉對稱，以及四方向箭頭互相旋轉後的幾何一致性。
5. 檢查四個花色的填色輪廓、尺寸與不同幾何。
6. 首頁十三個遊戲對應到自己的 symbol，保留可讀連結名稱、有效頁面路徑與新 Hex 文案。

Node 測試直接解析真實 SVG 命令，Bézier 以每段 240 個區間取樣，避免只有「檔案存在」的載入測試；取樣邊界另經瀏覽器原生 `getBBox()` 驗證。

`python tests/icons_browser.py`：**4 個首頁 viewport 及 38 個符號均通過**。Chromium 實際載入本機 `icons.svg`，不是替換成測試假圖形。

- 首頁：1366×1000、390×844、320×740、844×390，十三個等比例方形圖示、十三個可讀入口、無水平溢出、無 console／JavaScript 錯誤。
- 符號：逐一檢查原生 `<use>` 外接框、非空渲染；在 96px 截圖逐像素量測實際墨色範圍及中心。
- 人工檢視：桌機首頁、手機首頁、包含 96px 主圖及 20px 控制尺寸的 38 圖示對照表。檢查筆畫、對稱、視覺重心、可辨識度及截切。
- 本機證據：`/tmp/fugames-revision-icons/contact-sheet.png`、`homepage-desktop.png`、`homepage-mobile.png`、`homepage-narrow.png`、`homepage-landscape.png`、`measurements.json`。主整合流程負責保存前後截圖及發布結果。

未宣稱已驗證實體手機、Safari 或 Firefox。圖示與首頁沒有修改遊戲引擎；全站規則回歸、其餘頁面操作及既有 Pages 發布由主整合流程驗收。
