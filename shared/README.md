# 朱墨 Vermilion Ink：FuGames 共用設計語言

所有要繼續打磨的遊戲與入口網站共用這套風格。一句話：**墨色為底、米紙為字、一方朱印**。遊戲畫面是滿版舞台，介面是疊在舞台上的儀表，設定收進抽屜。它應該讓人一眼認出「這是 FuGames」，而不是一組 HTML 元件。

範例頁：[`shared/demo.html`](demo.html)（本機 `python -m http.server 8000` 後開 `http://localhost:8000/shared/demo.html`）。

## 檔案

| 檔案 | 用途 | 載入方式 |
| --- | --- | --- |
| `shared/fu.css` | 色票 tokens、字體、滿版骨架與所有元件 | `<link rel="stylesheet" href="shared/fu.css">` |
| `shared/fu-shell.js` | `window.Fu`：抽屜／幕、吐司、熱鍵、偏好存取、設定綁定 | `<script src="shared/fu-shell.js" defer>` |
| `shared/fu-palette.js` | 同一組色票給 canvas / WebGL / Node | `<script src="shared/fu-palette.js">` → `window.FuPalette`；Node `require()` |
| `shared/fu-three.js` | three.js 舞台輔助：燈組、霧、色調映射、尺寸、暫停 | `import { THREE, createStage } from './shared/fu-three.js'` |
| `vendor/three/three.module.min.js` | three.js r170（MIT），本地檔，離線可玩 | 由 `fu-three.js` 匯入，或直接 `import * as THREE from './vendor/three/three.module.min.js'` |

原則不變：不用 CDN、不用外部字體或圖片、不用 npm 建置；遊戲與 AI 都在瀏覽器內執行。

## 五條規則

1. **滿版舞台。** 遊戲本體（canvas / WebGL）用 `.fu-stage` 佔滿整個視窗，不放在卡片裡、不留白邊框。頁面不捲動。
2. **介面是儀表，不是表單。** 戰況、分數、回合用 `.fu-hud` 疊在四角；主要動作放 `.fu-dock`（底部指令列）。同時可見的 HUD 面板不超過三塊。
3. **設定進抽屜。** 難度、地圖、規則開關、畫面選項、規則說明一律放 `.fu-drawer`，用頂列按鈕或熱鍵打開。開局用 `.fu-curtain` 給一個「開始」按鈕與最多兩個關鍵選項。
4. **一方朱印。** 朱色（`--fu-seal`）只給品牌、主要動作、玩家自己、選取狀態。畫面上大面積的朱色不超過一處。
5. **直線與切角。** 圓角幾乎為零（`--fu-radius: 2px`）；面板右上、左下切角，左上、右下有朱色定位角。不要加圓角卡片、膠囊按鈕、漸層按鈕。

## 色票

| Token | 值 | 用途 |
| --- | --- | --- |
| `--fu-ink-0` | `#07090c` | 頁面底色、3D 背景與霧 |
| `--fu-ink-1` | `#0d1116` | 面板底 |
| `--fu-ink-2` | `#151b23` | 抬升面、輸入框 |
| `--fu-ink-3` | `#212a35` | 格線、空格、hover |
| `--fu-paper` | `#ece4d0` | 主文字（米紙） |
| `--fu-paper-dim` | `#a8a08c` | 次要文字、標籤 |
| `--fu-mute` | `#6d7380` | 註解、停用 |
| `--fu-seal` | `#ff4b2b` | 朱印：品牌、主要動作、玩家一 |
| `--fu-seal-deep` | `#b92d17` | 朱印暗部 |
| `--fu-jade` | `#35d0a8` | 成功、友軍 |
| `--fu-gold` | `#e9b949` | 警示、資源 |
| `--fu-azure` | `#4fa3ff` | 資訊 |
| `--fu-orchid` | `#b98cff` | 特殊 |
| `--fu-bone` | `#d9d2c0` | 中立 |

**陣營色**固定順序：`--fu-side-1`…`--fu-side-6` ＝ 朱、青、玉、金、紫、骨白。多方遊戲（AutoHex、脈衝擂台、圈地漫遊…）都照這個順序，玩家永遠是朱。JS 端用 `FuPalette.side(i)` 或 `palette.sides[i]`（three）。

**米紙主題**：在 `<html>` 或任何容器加 `data-fu-theme="paper"` 會反轉成紙底墨字，用於規則說明頁、列印。

## 字體

- 標題 `--fu-font-display`：宋體／明體（Noto Serif TC、Songti TC、PMingLiU）。大、重、緊。類別 `.fu-display`、`.fu-title`、`.fu-heading`。
- 標籤 `--fu-font-mono`：等寬（Iosevka YFWU 優先）。全大寫、字距 .18em。類別 `.fu-label`，數字用 `.fu-num`。
- 內文 `--fu-font-body`：黑體（Noto Sans TC、PingFang TC）。

全部是系統字體，不下載字型；沒有宋體的裝置會退回系統襯線字。

## 版面骨架（遊戲頁）

```html
<body class="fu-app fu-vignette">
  <header class="fu-topbar">
    <a class="fu-brand" href="index.html"><span class="fu-seal" aria-hidden="true">福遊</span>FuGames</a>
    <div class="fu-topbar__title"><h1 class="fu-heading">遊戲名</h1><span class="fu-label">副標</span></div>
    <div class="fu-topbar__actions">
      <button class="fu-btn" data-fu-open="settings">設定 <span class="fu-kbd">S</span></button>
    </div>
  </header>
  <main class="fu-stage"><canvas></canvas></main>
  <div class="fu-hud fu-hud--tl"><section class="fu-panel">…</section></div>
  <nav class="fu-dock"><button class="fu-btn" aria-pressed="true">部署</button>…</nav>
  <aside class="fu-drawer" id="settings" aria-label="設定">
    <div class="fu-drawer__head">…<button class="fu-btn fu-btn--ghost fu-btn--icon" data-fu-close>✕</button></div>
    <div class="fu-drawer__body">…</div>
  </aside>
  <div class="fu-curtain" id="intro">…</div>
</body>
```

完整可執行的版本見 `shared/demo.html`。朱印裡固定放兩個字（預設「福遊」），換字要保持兩字。

## 元件一覽

| 類別 | 說明 |
| --- | --- |
| `.fu-topbar` `.fu-brand` `.fu-seal` | 固定頂列、品牌、朱印（`.fu-seal--lg` 大印、`.fu-stamp` 蓋印動畫） |
| `.fu-stage` `.fu-canvas` | 滿版舞台 |
| `.fu-hud--tl/tr/bl/br/top` | 疊加儀表位置；手機寬度下右上自動移到下方 |
| `.fu-panel` (`--tight` `--flat` `--quiet`) `.fu-panel__head` | 切角半透明面板 |
| `.fu-dock` | 底部指令列；`aria-pressed="true"` 為目前模式 |
| `.fu-btn` (`--seal` `--ghost` `--icon` `--sm` `--lg` `--block`) | 按鈕 |
| `.fu-kbd` `[data-fu-tip]` | 鍵帽、提示泡泡 |
| `.fu-stat` `.fu-stats` `.fu-meter` (`--jade` `--gold` `--azure`) | 數值、十格計量條（`style="--value:.6"`） |
| `.fu-chip` (`--seal` `--jade` `--gold` `--azure` `--live`) `.fu-side` | 狀態標籤、陣營菱形 |
| `.fu-list` `.fu-table` `.fu-rule` | 清單、表格、刻度線 |
| `.fu-field` `.fu-input` `.fu-select` `.fu-range` `.fu-seg` `.fu-switch` | 表單（放在抽屜裡） |
| `.fu-drawer` (`--left`) `.fu-scrim` | 側邊抽屜 |
| `.fu-curtain` | 開場、暫停、結算全螢幕幕 |
| `.fu-page` | 不需滿版舞台的捲動頁（封存、說明） |
| `.fu-rise` (`style="--i:n"`) | 依序浮現 |
| `.fu-hide-sm` `.fu-show-sm` `.fu-sr-only` | 響應式、讀屏 |

## `window.Fu`（fu-shell.js）

```js
Fu.open('settings'); Fu.close('settings'); Fu.toggle('rules'); Fu.isOpen('settings');
Fu.toast('補給線被切斷', { tone: 'warn', ms: 2600 });   // tone: seal | ok | warn | info
Fu.hotkey('s', '開關設定', () => Fu.toggle('settings'), { when: () => !paused });
Fu.hotkeyList();                                         // [{key,label}]，做熱鍵說明用
const store = Fu.prefs('autohex3d', { difficulty: 'normal' });   // localStorage: fugames:autohex3d
store.get('difficulty'); store.set('fog', true);
Fu.bindSettings('settingsForm', store, (name, value, all) => restart(all));  // 帶 name 的欄位自動存取
Fu.reducedMotion();
```

宣告式：`data-fu-open="id"`、`data-fu-toggle="id"`、`data-fu-close`（關閉所在抽屜或幕）。Esc 關最上層。`.fu-seg` 內按鈕自動單選並發出 `fu:select` 事件。抽屜開關會發出 `fu:open`／`fu:close`。

遊戲規則核心不應依賴 `fu-shell.js`，這樣 Node 測試與 agent 的無頭模式不必載入介面。

## three.js 舞台（fu-three.js）

```js
import { THREE, createStage, inkMaterial, glowMaterial, palette } from './shared/fu-three.js';
const stage = createStage(document.querySelector('.fu-stage canvas'), { fog: [30, 160], shadows: false });
stage.scene.add(new THREE.Mesh(geo, inkMaterial('ink3')));
stage.loop((dt, t, { reducedMotion }) => { /* 更新 */ });
```

`createStage` 統一：墨色背景與同色霧、ACES 色調映射、sRGB 輸出、像素比上限 2、三盞標準燈（米紙天光、偏暖主光、**朱色背光勾邊**）、ResizeObserver、分頁隱藏時停幀。材質偏霧面、`flatShading`，避免塑膠感與高光反射。InstancedMesh 上色時把材質底色設成白色（`inkMaterial(0xffffff)`），否則顏色會被乘暗。

## 從 `fulab-theme.css` 遷移

舊頁面繼續用 `fulab-theme.css`，不會壞。改版一款遊戲時：

1. `<body class="fu-app">`，改連 `shared/fu.css`（測試接受 `fulab-theme.css` 或 `shared/fu.css` 擇一）。
2. 把 `.play-panel` 內的 canvas 搬到 `.fu-stage`，讓它滿版；重新計算 canvas 尺寸。
3. `.settings-grid` 的選項搬進 `.fu-drawer`；`details.rules` 的內容搬進左側規則抽屜。
4. 狀態列拆成 HUD 面板；按鈕列改成 `.fu-dock`。
5. canvas 繪圖改用 `FuPalette` 的顏色；多方顏色照陣營順序。
6. 手機 390px 寬與桌面 1280px 各截一張圖確認：沒有水平捲動、HUD 不擋住主要操作區。
