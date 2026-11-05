# HexBattle：Agent 介面

HexBattle 的規則全部在 `hexbattle/engine.js`。它是純函式、可 JSON 序列化的引擎，在瀏覽器和 Node 都能直接跑。同一個種子加同一串動作，一定重播出同一局。網頁、CLI、對戰場和內建 AI 都只透過下面這組 API 操作遊戲，所以 agent 拿到的資訊和人類玩家完全一樣，不多也不少。

有三種接法：

| 方式 | 適合 | 入口 |
| --- | --- | --- |
| 直接 `require` 引擎 | 自己寫搜尋、強化學習、批次模擬 | `hexbattle/engine.js` |
| 存檔式 CLI | 任何能執行 shell 指令的 agent（包含 LLM agent） | `tools/hexbattle.cjs` |
| JSON Lines 對戰場 | 長駐程式對戰內建 AI 或其他 agent、計戰績 | `tools/hexbattle-arena.cjs` |

瀏覽器頁面另外提供 `window.HexBattle`（舊名 `window.AutoHex3D` 仍可用），讓瀏覽器內的 agent 代替你操作席位 1（見最後一節）。

## 1. 引擎 API

```js
const E = require('./hexbattle/engine.js');
const st = E.createGame({ seed: 'abc', players: 4, maxRounds: 30, neutrals: true });
E.currentPlayer(st);            // 輪到誰（0 = 已結束）
E.observe(st, id);              // 該席位在迷霧下看得到的一切
E.legalActions(st, id);         // 目前所有合法動作（列表本身就是合法動作，直接傳回 act 即可）
E.act(st, id, action);          // → { ok, error?, events, battle? }；非法動作不改變狀態
E.catalog();                    // 卡牌、建築、兵種、地形、升級表
E.income(st, id);               // 下一輪收入預估（含糧食維護與缺糧停工）
E.previewBuild(st, id, type, cell); // 假設在某格蓋某建築，收入與領土的變化
```

`state` 是一般 JSON 物件，`JSON.parse(JSON.stringify(st))` 後可以繼續玩。亂數產生器的狀態也存在 `st.rng` 裡，所以存檔續玩後的抽牌順序不變。

內建 AI 在 `hexbattle/ai.js`：`AI.decide(st, id, profile)` 回傳一個動作，`AI.playTurn(st, id, profile)` 打完一整個回合。打法有 `balanced`（均衡）、`builder`（經營）、`warlord`（征伐）、`warden`（堅守）、`raider`（劫掠）。

## 2. 一輪的流程

1. 每輪所有存活的勢力依序行動。順序每兩輪輪替一次，偶數輪反向（蛇形），所以沒有人永遠先手。
2. 輪到你時抽到手牌上限（5，都城 Lv2 為 6），拿到 3 點指令點（都城 Lv3 為 4）。
3. 你可以做任意多個動作，直到送出 `end`。
4. 所有人都結束後，全場同時交戰 6 拍，接著計分、收入、維護、訓練，然後開始下一輪。

勝利條件：
- 輪結束時分數達到目標（2 方 30 分，其他人數 40 分）。
- 回合上限到時分數最高。
- 或摧毀所有敵方都城。

分數來源：
- 控制遺跡：外圈每輪 1 分，中央 2 分。遺跡上或旁邊有任何敵軍（包含中立守軍）時不計分。
- 遺跡上的神殿：再加 1 分，中央加 2 分，升級後再 +1。
- 摧毀建築 1 分，摧毀都城 5 分。
- 牌組裡的功勳牌：勳章 1、豐碑 2、王冠 3。

## 3. 動作

所有動作都是一個 JSON 物件。格子可以寫成索引 `95`、`[q, r]` 或 `{ "q": 1, "r": -2 }`。

| 動作 | 格式 | 花費 | 說明 |
| --- | --- | --- | --- |
| 打牌 | `{"type":"play","card":17,"target":95}` | 卡牌的資源與指令點 | 建築牌的 target 是要蓋的格子；兵種牌的 target 是要徵召的都城、兵營或工坊；有目標的戰術牌 target 是目標格；經濟牌和無目標戰術牌不用 target |
| 整編 | `{"type":"play","card":21,"targets":[3,9]}` | 免費 | 從手牌永久移除 1 到 2 張其他牌 |
| 變賣 | `{"type":"sell","card":17}` | 無 | 手牌進棄牌堆，得 1 金 |
| 購買 | `{"type":"buy","slot":2}` | 金 | 市場欄位 0 到 5，買到的牌進棄牌堆 |
| 下令 | `{"type":"order","unit":"all","stance":"advance","target":120}` | 無 | `unit` 可以是部隊 id、id 陣列或 `"all"`；`stance` 是 `advance`（進攻目標格）、`guard`（駐守，可給據點格）或 `hold`（原地） |
| 升級 | `{"type":"upgrade","target":95}` | 資源 | 只花資源，不花指令點；建築必須連回都城 |
| 訓練 | `{"type":"train","target":95,"unit":"spear"}` | 每輪結算時付該兵種的牌面費用 | 都城、兵營、工坊每輪自動出兵；`unit:null` 停止訓練；兵種牌要在牌組裡（民兵永遠可以） |
| 交易 | `{"type":"trade","give":"food","get":"gold","times":1}` | 3 換 1 | 有連通的市集時 2 換 1 |
| 結束 | `{"type":"end","keep":17}` | 無 | 可以保留 1 張手牌到下回合，其餘進棄牌堆 |

非法動作會回傳 `{ok:false, error:"中文原因"}`，狀態不變。

## 4. 觀察（`observe`）

只會包含該席位看得到的東西。別人的手牌、牌組、資源與伏兵永遠不公開；迷霧中的敵軍不出現；敵方部隊的姿態與目標不公開。

| 欄位 | 內容 |
| --- | --- |
| `round`, `maxRounds`, `vpTarget`, `phase`, `turn`, `order` | 進度與本輪行動順序 |
| `you` | 你的席位 |
| `players[]` | 每方的公開資訊：`vp`（含功勳牌）、`territory`、`buildings`、`units`、`deckSize`、`handCount`、`alive` |
| `market[]`, `marketDeck` | 市場 `{slot, card, k, price}`。最左邊的牌每輪會被移除 |
| `buildings[]` | 看得到的建築：`type`, `owner`, `cell`, `hp`, `max`, `armor`, `lvl`, `hungry`, `connected`, `disabled`，自己的建築還有 `train` |
| `units[]` | 看得到的部隊：`type`, `owner`, `cell`, `hp`, `max`；自己的部隊還有 `stance`, `goal`, `anchor` |
| `territory[]` | 每格的擁有者。0 是無主，-1 是爭奪中，`null` 是看不到 |
| `visible[]` | 每格是否可見（1/0） |
| `intel[]` | 曾看過、現在看不到的敵方建築記憶 `{cell, type, owner, round}` |
| `lastBattle` | 上一輪交戰的逐拍事件（已依視野過濾）與計分 |
| `ap`, `res`, `cap`, `tradeRate`, `handSize` | 你的指令點、資源、資源上限、銀行匯率與手牌上限 |
| `income` | 下輪收入預估：`food`, `mat`, `gold`, `upkeep`（部隊吃糧）, `workers`（建築工人吃糧）, `idle`（會缺糧停工的建築 id）, `net`, `buildings[]` |
| `hand[]` | `{id, k, cost}`。cost 已含同類建築的加價 |
| `drawPile`, `discard[]`, `deckList[]`, `trashed` | 牌組狀態。`deckList` 是排序過的抽牌堆內容，不洩漏順序 |
| `traps[]`, `buffs`, `reveal[]`, `recruited[]` | 你的伏兵、本輪增益、偵察揭露、本回合已徵召的建築 |
| `map` | `R`、`cells[{i, q, r, t, f}]`（地形 t，特徵 f：fertile / gold / relic）、`relics[]`、`center` |

卡牌、建築、兵種的完整數值請用 `E.catalog()` 或 `node tools/hexbattle.cjs catalog` 查。規則重點：

- **領土**：建築向周圍投射影響力（都城與前哨半徑 2），影響力最高的一方擁有該格，平手就是爭奪地。只能在己方領土建築。領土要連回都城，斷聯的建築不生產、不能升級。
- **產量看布局**：
  - 農田：靠水域、沃土、成片農田與倉庫。
  - 伐木場：靠森林。
  - 礦場：靠丘陵、山與金脈。
  - 市集：靠周圍的己方建築。
  - 每類建築每多兩座，造價多 1 材。
- **糧食**：先餵部隊（騎兵吃 2，其他兵種吃 1），再餵建築工人（伐木場、礦場、市集、前哨、兵營、工坊、箭塔、神殿各 1）。餵不飽的建築那一輪不生產、不射擊、不訓練；餵不飽的部隊受 3 傷害。
- **資源上限**：基本 20，每座倉庫加 8（升級再加 8）。超出上限的收入會浪費。
- **戰鬥**：
  - 6 拍，每拍先同時攻擊，再移動。
  - 槍兵剋騎兵、騎兵剋弓兵與投石車、弓兵剋步兵；投石車對建築造成 6 傷害。
  - 森林與丘陵掩護 +1，站在己方建築上 +1，丘陵上的遠程單位射程 +1。

## 5. 存檔式 CLI

每一步都是一條指令，狀態存在 JSON 檔裡。沒有列在 `--seat` 的席位由內建 AI 自動打完，指令會在輪到你時才返回。

```sh
node tools/hexbattle.cjs new --players 4 --seed demo --seat 1 --bots warlord,builder,warden --file g.json
node tools/hexbattle.cjs show  --file g.json          # 中文戰況簡報 + ASCII 地圖
node tools/hexbattle.cjs legal --file g.json          # 合法動作列表
node tools/hexbattle.cjs act '{"type":"play","card":2,"target":212}' --file g.json
node tools/hexbattle.cjs act '{"type":"end"}' --file g.json
node tools/hexbattle.cjs verify --file g.json         # 從種子重播動作紀錄，確認存檔沒被竄改
node tools/hexbattle.cjs catalog
```

- 加 `--json` 會輸出機器可讀的 `{ok, observation, ...}`（`act` 另附 `events` 與 AI 的行動摘要）；`legal --json` 輸出 `{ok, player, actions}`。加 `--no-map` 可在 JSON 中省略地圖。
- `--seat 1,3` 可以列多個席位，讓多個 agent 共用一個存檔輪流下。
- 存檔格式是 `{format:"hexbattle-save", version, config, actions, state}`（舊的 `autohex3d-save` 存檔仍可讀）。`actions` 是完整動作紀錄，`verify` 會用它重播比對。

## 6. JSON Lines 對戰場

```sh
node tools/hexbattle-arena.cjs \
  --seat "cmd:node my-agent.js" --seat bot:warlord --seat bot:builder --seat bot:warden \
  --games 8 --seed league --timeout 10000 --log out.jsonl [--rotate]
```

每個 `cmd:` 席位是一個長駐程式，透過 stdin/stdout 每行收發一個 JSON 物件：

```text
arena → agent  {"type":"hello","game":0,"player":2,"players":4,"seed":"...","catalog":{...}}
arena → agent  {"type":"turn","game":0,"player":2,"observation":{...},"legal":[...]}
agent → arena  {"type":"play","card":17,"target":95}          ← 任一動作物件
arena → agent  {"type":"result","ok":true,"events":[...]}     或 {"ok":false,"error":"..."}
arena → agent  {"type":"over","game":0,"player":2,"result":{...}}
```

- 每回合會收到多次 `turn`，每次回一個動作，直到你送出 `end`。
- 送出非法動作、逾時，或同一回合超過 200 個動作時，對戰場會替你結束該回合，並記入戰績表的「無效」或「逾時」。
- `--rotate` 讓參賽者在各局之間輪換席位，抵銷座位差。
- 結束時印出每個參賽者的勝場、平均分數、無效與逾時次數。
- `--log` 會把每個動作寫成 JSONL，方便事後重播。

`tools/hexbattle-example-agent.cjs` 是一個約 50 行、只看觀察與合法動作的範例 agent，可以直接複製來改。它打不贏內建 AI，這是預期中的結果。

## 7. 瀏覽器內的 agent

`hexbattle.html` 載入後提供：

```js
HexBattle.observe()   // 席位 1 的觀察
HexBattle.legal()     // 合法動作
HexBattle.act(action) // 以席位 1 執行；畫面同步更新
HexBattle.describe()  // 中文戰況簡報
HexBattle.myTurn()    // 是否輪到席位 1，且沒有在播放動畫
HexBattle.newGame({ seed, players, mode })   // mode: 'play' | 'watch' | 'stream'
HexBattle.replay()    // 種子 + 本局完整動作紀錄
HexBattle.pause()  /  HexBattle.resume()  /  HexBattle.next()   // 觀戰／直播控制
HexBattle.standings() // 目前各方分數、打法
HexBattle.series()    // 觀戰系列戰績：{ matches, doctrines: { balanced: { g, w, vp } … }, recent: [...] }
const off = HexBattle.on(e => console.log(e.type, e))   // 訂閱事件，回傳取消函式
```

舊名 `window.AutoHex3D` 指向同一個物件。

## 8. 直播／自動戰鬥平台

`hexbattle.html` 有三種模式：

| 模式 | 說明 |
| --- | --- |
| 親征 `play` | 你坐席位 1。手牌下方的提示列說明下一步；「提示」（I）顯示內建 AI 建議的一步，按「照做」（Enter）執行；「代打」讓 AI 打完這回合。 |
| 觀戰 `watch` | 全部由 AI 操作。底部控制列：暫停（空白鍵）、速度、導播鏡頭（C）、自動連播、下一場（N）、純畫面（O）、全螢幕。 |
| 直播 `stream` | 觀戰加上轉播版面：收起頂列、放大計分板、精彩快報、滑鼠靜止後控制列與游標自動隱藏；一局結束顯示結果與系列戰績，休息幾秒後自動開下一局。 |

連播時打法每場輪換座位，戰績依打法累計（存在瀏覽器的 localStorage，可在設定裡清除）。固定種子時，第 2 場以後依序用「種子·2」「種子·3」…，整個系列可以重現。

### 網址參數（OBS 瀏覽器來源）

在 OBS 等直播軟體新增「瀏覽器來源」，寬高設 1920×1080，網址例如：

```text
https://<你的網站>/hexbattle.html?mode=stream&players=6&speed=normal&rounds=30&intermission=12&hud=0
```

| 參數 | 值 | 預設 |
| --- | --- | --- |
| `mode` | `play`、`watch`、`stream`；有這個參數就跳過開場直接開始 | 開場選單 |
| `players` | 2–6 | 4 |
| `seed` | 戰場種子（最多 40 字） | 隨機 |
| `rounds` | 20、30、40 | 30 |
| `speed` | `slow`、`normal`、`fast`、`skip`（極速） | `normal` |
| `doctrine` | `mixed` 或 `balanced`、`builder`、`warlord`、`warden`、`raider` | `mixed` |
| `intermission` | 場間休息秒數 | 12 |
| `loop` | `0` 關閉自動連播 | 開 |
| `director` | `0` 關閉導播鏡頭 | 開 |
| `hud` | `0` 隱藏控制列（純畫面，O 鍵可切回） | 顯示 |

網址參數只影響那一次載入，不會覆寫瀏覽器裡存的設定。設定抽屜的「觀戰與直播」區會依目前設定組出網址，可以直接複製。舊網址 `autohex_3d.html?…` 會帶著參數轉到新頁。

### 事件

每個開局、行動、每輪結算、精彩時刻與終局都會在 `window` 上發出 `hexbattle` 事件；頁面被嵌在 iframe 裡時，同一份資料也會用 `postMessage({ source: 'hexbattle', ... })` 送給上層頁面。可以拿來做自訂疊加層、聊天室預測或機器人播報。

| `type` | 內容（另外都有 `match`、`round`） |
| --- | --- |
| `match-start` | `seed`、`target`、`maxRounds`、`players[{id, name, doctrine, human}]` |
| `turn` | `player`、`name`、`doctrine` |
| `round` | `standings[{id, name, doctrine, vp, alive}]`、`scoring[{player, gain}]` |
| `highlight` | `text`（中文一句話，例如「青嵐奪下中央遺跡」）、`side`（勢力 id）；滅亡另有 `kind: 'eliminated'` |
| `match-end` | `winner`、`name`、`doctrine`、`reason`、`rounds`、`standings`、`series` |

```js
// 例：在上層頁面接收
window.addEventListener('message', e => { if (e.data && e.data.source === 'hexbattle') console.log(e.data.type, e.data); });
```

## 9. 平衡驗證

`node tools/hexbattle-sim.cjs --games 40 --players 4` 會跑內建 AI 互打。結果記錄在 [design.md](design.md)。
