# MopiMopi（Unnbird fork）

[haeruhaeru/mopimopi](https://github.com/haeruhaeru/mopimopi) 的分支。在原版之上多了兩件事，**都在頁面裡算，不需要任何額外的 ACT 外掛**：

1. **內建 FFLogs 官方解析器**：`js/fflogs/parser-ff.js` 是 FFLogs Archon 上傳器內嵌的 `LogParser`（版本見 [js/fflogs/PARSER-VERSION.md](js/fflogs/PARSER-VERSION.md)）。mopimopi 自己餵它 log、自己讀它的即時 meters，**FFLogs 有提供的數值一律優先顯示**（傷害、DPS、爆擊/直擊%、最大傷害、死亡、時長，以及 rDPS / aDPS / nDPS / cDPS），ACT 的只補它沒有的。
2. **內建 GCD 運轉率**（`GCD%`、`GCDs`、`Lost`、`GCD`）：`js/gcd/` 從 OverlayPlugin 送進頁面的同一批原始 log 行，即時算出每個玩家的 GCD 運轉率、GCD 次數、空窗秒數與推估的 GCD。演算法是 [xivanalysis](https://github.com/xivanalysis/xivanalysis) 的模型，程式碼逐行移植自 [OverlayPluginAddon](https://github.com/Unnbird/OverlayPluginAddon)。

> **RdpsOverlay 與 OverlayPluginAddon 都不再需要。** rDPS 拆帳由內建的 FFLogs 解析器接手（數字與 FFLogs 網站同源）；GCD 運轉率由頁面自己算。舊版 RdpsOverlay 送來的 `rdpsTotal`、`rdps`、`rawdps` 等欄位會被**忽略**（`js/core.js` 的 `legacyRdpsKeys`）。OverlayPluginAddon 若還裝著也無妨：頁面內建的 GCD 算好後會**覆蓋**它注入的同名欄位。

## 安裝

1. **懸浮窗**：OverlayPlugin → 新增懸浮窗 → 選 MiniParse 類型，網址填 `https://unnbird.github.io/mopimopi/`（若曾裝過 OverlayPluginAddon，它註冊的 preset **MopiMopiCustom** 指向同一個網址，直接選也可以）。
2. **GCD 欄位**：設定 → 數據 → 格式 把 `GCD%` / `GCDs` / `Lost` / `GCD` 勾起來。不用裝任何外掛，也沒有開關：頁面一律計算。
3. **rDPS 等 FFLogs 數值**：設定 → 數據 → 一般 → 「優先使用 FFLogs 解析器數據」預設開啟，不用動；標題列會顯示 `FFLogs` 或 `ACT` 說明此刻顯示的是哪一邊。

## 介面欄位與來源

| mopimopi 欄位 | 數字從哪來 | 需要什麼 |
|---|---|---|
| DPS、傷害、傷害%、命中數、爆擊/直擊/爆直（數與 %）、最大傷害（含技能名）、死亡、標題列時間、全隊 DPS | 內建 FFLogs 解析器（對得上這場時）；否則 ACT | 無 |
| **rDPS / aDPS / nDPS / cDPS / ±Buff** | 內建 FFLogs 解析器，且只有它：`apply.js` 把每人的 `amount / amountTaken / singleTargetAmountTaken / amountGiven` 寫進該列，`Person.recalculate()` 用 `amount − amountTaken + amountGiven` 等四式除以時長。解析器沒接上（標題列顯示 `ACT`）時這幾欄是 0 | 無 |
| 治療、HPS、溢療、治療數、爆擊治療、最大治療 | ACT。這版解析器的 meters 對玩家不記治療（見〈限制〉），只有 HPS 改用 fight 時長去除 | 無 |
| **GCD%（運轉率）、GCDs（次數）、Lost（空窗秒數）、GCD（推估 recast）** | 頁面內建 `js/gcd/`：`meter.js` 吃 20/21/22/23 行記 GCD、26/30 行記加速狀態，`apply.js` 把 `gcdUptime / gcdCount / gcdClip / gcdOccupied / gcdRecast` 寫進該列。`GCD%` 是每次按出 GCD 時量好的百分比，原樣顯示、不再除 | 無 |
| 揮擊數、miss、命中率、承受傷害/治療、盾、Last 10/30/60/180 DPS | ACT | 無 |

`Limit Break` 在 FFLogs 與 ACT 都是獨立角色，不收不給 buff，所以它的 rDPS 等於自己的 DPS。

## 資料怎麼流

```
OverlayPlugin（ACTWebSocket 相容模式）
  ├─ Chat(每一行原始 log) ──┬─→ js/fflogs/meter.js → LogParser.parseLine（每 100 ms 一批）
  │                         └─→ js/gcd/meter.js    → 20/21/22/23 行記 GCD、26/30 行記加速狀態、02/03 行認玩家
  └─ CombatData ──→ FflogsMeter.overlay()：對得上這場 encounter 才把 FFLogs 的值寫進 CombatData 字串欄位
                 ──→ GcdMeter.overlay()：讀 isActive / DURATION 判斷是否換場，把五個 GCD 欄位寫進每一列
                 → Combatant / Person 照常解析、排序、歷史
```

頁面不會呼叫 `callOverlayHandler`：那會讓 OverlayPlugin 切到現代 API 並取消 mopimopi 賴以維生的 CombatData 訂閱。兩個解析器都只在懸浮窗頁面裡跑，不連網。

## FFLogs 模式怎麼運作

「對得上」= 解析器那場 fight 有人出手、最近 10 秒內有回報、且 ACT encounter 時長與 fight 時長相差不超過 90 秒（滅團後 ACT 開新場、解析器還在報舊場時會退回 ACT，直到新場首擊）。

### 寵物

解析器已把「鏡射 buff」的寵物（Carbuncle、Eos 等）併進主人，沒有分量 → 這些寵物列顯示 0；Demi-Bahamut、Phoenix、Solar Bahamut 這類獨立角色則保留自己的量，主人列是「總量 − 這些寵物」，兩邊加起來正好是 FFLogs 的總量，寵物子條照常。

### 設定

- 設定 → 數據 → 一般 → **優先使用 FFLogs 解析器數據**（也在標題列的更多選單裡），關掉即回 ACT 數值。
- **FFLogs 解析器區域**：只決定 log 時間戳對到哪個 patch 日程（國際服 / 中國服 / 韓服）。設錯不會報錯，只會讓版本相關的 buff 數值偏掉。

### 限制

- 解析器版本釘在 PARSER-VERSION.md 所記的版本；新 patch 加了新狀態要更新 `parser-ff.js`。
- 這版解析器的 meters 對玩家**不記治療**（`processMeterHealing` 要求來源帶友方旗標，而解析器只對 NPC 與寵物設定它），治療欄位因此保留 ACT 的值。
- 頁面要在進副本前就開著；中途載入會錯過 03 AddCombatant，職業/等級要等下次換區才知道。
- 命中數來自 FFLogs 但揮擊數與 miss 是 ACT 的，命中率是混源。
- ACT 把多次 pull 合成一個 encounter 時只會對到解析器的最後一場。
- 這是 FFLogs 的私有混淆程式碼，放在這個 repo（與 GitHub Pages）散布的 ToS／著作權風險由維護者自負。

## GCD 運轉率

演算法沿用 xivanalysis 的模型（`SpeedStatsAdapterStep` + `AlwaysBeCasting` + `speedStatMapper`），程式碼是 OverlayPluginAddon 的 `GcdTracker` / `StatusTracker` / `ActionData` 逐行移植成 JS（`js/gcd/tracker.js` / `status-tracker.js` / `action-data.js`），同一組測試情境一起搬過來。

### 寫進 CombatData 的欄位

| key | 說明 |
|---|---|
| `gcdUptime` | GCD 運轉率（%）：第一次按鍵到最新一次按鍵之間，GCD 在轉的比例。**已經除好的值，原樣顯示、不要自己再除**：它在每次打出 GCD 的當下量一次 |
| `gcdCount` | GCD 次數（只計戰技與魔法） |
| `gcdClip` | GCD 之間空窗損失的總秒數 |
| `gcdOccupied` | 已結束的 GCD 佔用的總秒數（`gcdUptime` 的分子）。分母是該玩家**自己的按鍵區間**，不是戰鬥時長 |
| `gcdRecast` | 該玩家 2.5 秒基準的 GCD，由推估出的速度屬性算出；樣本不足時是 2.5 |

### 模型

```
單次施放佔用 = max(recast, castTime + (castTime ≥ GCD ? 100ms 詠唱稅 : 0))
運轉率       = 1 − Σ 空窗 / (最新一次按鍵 − 第一次按鍵)
空窗         = Σ max(0, 間隔 − 佔用)      （超過 slack 才算）

以上整組在「打出 GCD 的當下」量一次，之後定住；分母是自己的按鍵區間，不是戰鬥時長
```

**每次施放記它完整的 GCD 佔用，不看到下一次的間隔**：log 時間戳有 ~45ms 的批次抖動，一個乾淨的 2.5 秒輪替會量出 2.46～2.54 的間隔；如果拿 `min(recast, 間隔)`，每個「看起來早了 40ms」的按鍵都會被削掉，永遠到不了 100%。

**進行中的那個 GCD 兩邊都不算**：它的 recast 還在轉、後面的間隔還沒關上，所以它在 `gcdCount` 裡，但不在分子也不在分母。

**運轉率是在打出 GCD 的那一刻量的，量完就定住，直到下一次 GCD。** 分母不用戰鬥時長的原因在時鐘：ACT 的時長是傷害驅動的，有傷害落地才往前走；而 GCD 是按下去就記（20 行），硬詠唱的傷害要一整段詠唱之後才落地，用戰鬥時長當分母，瞬發之後接任何硬詠唱都會讓運轉率鋸齒一次。代價：戰鬥開始到第一次按鍵之間不算；最後一次按鍵之後的閒置要等下一次按鍵才會被算進去，中途倒地的人運轉率停在倒下那一刻。

**空窗（lost）** 對應 xivanalysis 的 downtime windows：`間隔 > recast + 150ms` 才算，150ms 是 100ms 詠唱稅加 50ms 抖動（`GCD_ERROR_OFFSET`）；硬詠唱後再多給 500ms 的滑步窗（`SLIDECAST_OFFSET`）。

**GCD 是按下去就開始轉。** 硬詠唱在 20 行（StartsCasting）收到時就記錄，傷害落地時帶著同一個時間戳會被去重擋掉；23 行（詠唱中斷）把那筆暫記移除。20 行帶的詠唱條長度（已含速度、加速與職業機制）優先於資料表的值。AoE 一次打八個目標會有八行，用「同一施放者 + 同一技能 id + 同一時間戳」去重。

### 每個技能的 recast 不一樣

舞步 1 秒、忍術 1.5 秒、六合星 5 秒、彩虹點滴 6 秒。xivanalysis 的解法：每個技能的基礎 recast 是已知資料（`js/gcd/actions-data.js`）；觀測到的間隔除掉開啟該間隔那個技能的基礎 recast 與當下的加速倍率後，整場所有間隔塌縮到同一個分布；分布的眾數就是該玩家 2.5 秒基準的 GCD，反解成單一個技速／詠速屬性值，再回推他按的每一個技能的真實 recast。沒有 `speedAttribute` 的技能（舞步這種固定秒數的）不參與估計，但仍照它的固定 recast 計入佔用。

```
node tools/Build-ActionData.js [xivanalysis 路徑]      # 重新產生 js/gcd/actions-data.js
```

抽出 recast 覆蓋（500ms 到 6000ms）與加速狀態（神速咏唱 0.80、內丹 0.85、風雅 0.87、疾走 0.85、靈感 0.75，靈感只作用於指定技能）。

### 怎麼分辨 GCD 和 oGCD

FFXIV_ACT_Plugin 內嵌的 `ActionCategoryList` 就是 `技能id | 分類`：分類 2（魔法）與 3（戰技）是 GCD，1（自動攻擊）與 4（能力技）不是。外掛可以在 ACT 程序裡直接讀這張表，網頁不能，所以這裡帶一份快照 `js/gcd/action-categories-data.js`：每個技能 id 一個字元（index = id、base-36 數字 = 分類），約 49 KB。

```powershell
.\tools\Build-ActionCategories.ps1                      # 從 %APPDATA%\Advanced Combat Tracker\Plugins\FFXIV_ACT_Plugin.dll 重新產生
.\tools\Build-ActionCategories.ps1 <FFXIV_ACT_Plugin.dll 或 FFXIV_ACT_Plugin.Resource.dll 路徑>
```

給它發行版的 `FFXIV_ACT_Plugin.dll` 即可，它會自己把 Costura 壓在裡面的 Resource 組件解出來。**每次遊戲改版後重跑一次**：快照裡沒有的技能 id（改版新增的）只有在出現詠唱條時才算 GCD，瞬發的一律不算。

### 場次邊界

外掛靠 ACT 的 `ActiveEncounter` 換了才清空；頁面只能從 CombatData 看到 `isActive` 變 true 或 `DURATION` 變小。偵測到新場後，把「最後一個 21/22 行的時間 − (DURATION + 1) 秒 − 1 秒」之前的按鍵丟掉：ACT 的時長只在戰鬥動作時前進、又被截成整數秒，所以這個估計一定落在真正開場之前，寧可多留一兩個開場前的按鍵，也不會丟掉場內的。中途才開頁面沒關係：玩家從 21/22 行與 20 行就認得出來，最多漏第一下。

### 還沒做到的

- **分母沒有扣掉 downtime。** xivanalysis 的分母是「戰鬥時長 − boss 無敵時間」，這裡沒有 targetability 追蹤，有 phase 轉換的戰鬥每個人的運轉率都會偏低。
- **MNK / NIN 的職業基礎加成沒有單獨套用**（資料檔裡有，但沒接上）。
- **第一次按鍵之前、最後一次按鍵之後都不算**（見上）。

### 除錯

在懸浮窗的開發者工具 console 裡：

```js
GcdMeter.state              // 每個計數器：收到幾行、幾個 20/21 行、記了幾個 GCD、分類表與 recast 表有沒有載到
GcdMeter.snapshot()         // 每人的統計與推估的速度屬性
GcdMeter.dump('角色名')     // 逐 GCD 一行：時間、技能 id、硬詠唱與否、記入的 recast、到下一次的間隔、佔用、損失
lastCombatRaw.gcd           // 最近一次 CombatData 有沒有寫入、寫了幾列、原因
```

| 症狀 | 意義 |
|---|---|
| `state.available` 是 false | 分類表沒載到；看 `state.reason` |
| `state.lines` 是 0 | 沒收到 Chat 行：懸浮窗不是 ACTWebSocket 相容模式 |
| `state.abilityLines` 有數字但 `gcdsRecorded` 是 0 | 21 行的來源不是玩家（id 不是 1 開頭），或分類表把它們都判成 oGCD |
| `state.unknownActions` 一直漲 | 分類表快照過期，重跑 `Build-ActionCategories.ps1` |

## 檔案

| 檔案 | 用途 |
|---|---|
| `js/fflogs/parser-ff.js` | FFLogs 官方解析器 |
| `js/fflogs/host-logic.js` | 選最新一場、寵物併入主人、治療/死亡/最大傷害的純函式 |
| `js/fflogs/apply.js` | 把 FFLogs 數值寫進 CombatData 字串欄位的純函式 |
| `js/fflogs/meter.js` | 在頁面裡跑解析器、吃 Chat 行、每 0.5 秒 collect、決定要不要覆蓋 |
| `js/gcd/tracker.js` | GCD 運轉率模型（xivanalysis）：速度屬性推估、佔用、空窗、一次 GCD 量一次、換場截斷 |
| `js/gcd/status-tracker.js` | 誰身上掛著什麼狀態、誰是玩家、`YOU` 對應真名 |
| `js/gcd/action-data.js` + `actions-data.js` | 每個技能的 recast / 詠唱時間 / 速度屬性、加速狀態，與速度公式（Allagan Studies） |
| `js/gcd/categories.js` + `action-categories-data.js` | GCD / oGCD 分類表快照與讀取 |
| `js/gcd/apply.js` | 把五個 GCD 欄位寫進 CombatData 字串欄位的純函式 |
| `js/gcd/meter.js` | 吃 Chat 行、配對詠唱條、判斷換場、呼叫 apply；`window.GcdMeter` |
| `tools/Build-ActionCategories.ps1` | 從 FFXIV_ACT_Plugin.dll 產生分類表快照 |
| `tools/Build-ActionData.js` | 從 xivanalysis 產生 recast 資料 |
| `js/core.js` | `onBroadcastMessage` 的接點（`Chat` → 兩個 feed、`CombatData` → 兩個 overlay） |

## 測試

```
node tests/test-fflogs-overlay.js
node tests/test-core-person.js
node tests/test-gcd-tracker.js
node tests/test-gcd-meter.js
node tests/test-gcd-categories.js
node tests/test-gcd-columns.js
```

- `test-fflogs-overlay.js`：假 CombatData + 假 fight 過一遍覆蓋邏輯（每個欄位、`YOU` 對應本機玩家真名、寵物三種情形、Limit Break、不對場保留原樣、沒有治療表時保留 ACT 治療、時長格式）。
- `test-core-person.js`：把 `js/core.js` 放進 Node vm 跑真正的 `Person`，確認 rDPS 四欄只從 FFLogs 的四個總量算出、舊 RdpsOverlay 的匝出欄位被忽略、GCD 欄位原樣通過不被再除。
- `test-gcd-tracker.js`：OverlayPluginAddon `Test-Gcd.ps1` 的全部情境逐字搬過來（乾淨輪轉、技速推估、舞步與忍術的固定 recast、加速窗口、靈感只作用於指定技能、長詠唱與詠唱稅、真實空窗、AoE 去重、瞬發 vs 硬詠唱、連續魔法的交替輪替、硬詠唱開始不會讓運轉率飆高、一次 GCD 只量一次、時間戳抖動、150ms 損失 slack、運轉率不超過 100%、樣本不足退回預設），加上詠唱中斷回捲與換場截斷。改動 `js/gcd/tracker.js` / `action-data.js` / `actions-data.js` 後都該重跑。
- `test-gcd-meter.js`：用合成的網路 log 行餵 `meter.js`：誰是玩家、oGCD 與自動攻擊不算、詠唱條與落地配對去重、詠唱中斷、過期詠唱條、加速狀態、快照沒有的技能、`YOU` 對應（含 02 行）、CombatData 判斷換場、缺資料表時的行為、壞行不會拋錯。
- `test-gcd-categories.js`：分類表快照載得起來、筆數對、已知技能分類正確（Cascade / Fire IV 是 GCD，Fan Dance / 戰鬥連禱 / 夜殺 / 自動攻擊不是）。
- `test-gcd-columns.js`：照 `index.html` 的順序把 `js/gcd/*.js` 當成 `<script>` 載進假的 window，確認 `window.GcdMeter` 起得來、寫得進 CombatData；再確認四個 GCD 欄位在 init / dic / lang / process 四個檔裡都有對應，且沒有任何開關混進設定樹。
