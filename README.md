# MopiMopi（Unnbird fork）

[haeruhaeru/mopimopi](https://github.com/haeruhaeru/mopimopi) 的分支。在原版之上多了兩件事：

1. **內建 FFLogs 官方解析器**：`js/fflogs/parser-ff.js` 是 FFLogs Archon 上傳器內嵌的 `LogParser`（版本見 [js/fflogs/PARSER-VERSION.md](js/fflogs/PARSER-VERSION.md)）。mopimopi 自己餵它 log、自己讀它的即時 meters，**FFLogs 有提供的數值一律優先顯示**（傷害、DPS、爆擊/直擊%、最大傷害、死亡、時長，以及 rDPS / aDPS / nDPS / cDPS），ACT 的只補它沒有的。**不需要任何額外的 ACT 外掛。**
2. **GCD 運轉率欄位**（`GCD%`、`GCDs`、`Lost`、`GCD`）：這些數字不是 log 裡現成的，要由 ACT 外掛 **[OverlayPluginAddon](https://github.com/Unnbird/OverlayPluginAddon)** 算好、注入 CombatData，mopimopi 只負責顯示。**沒裝 OverlayPluginAddon，這幾欄會是 0。**

> **RdpsOverlay 已廢棄。** 它原本負責的 rDPS 拆帳改由本頁內建的 FFLogs 解析器取代（數字與 FFLogs 網站同源，不再是逼近值），GCD 運轉率則獨立成 OverlayPluginAddon。舊版 RdpsOverlay 送來的 `rdpsTotal`、`rdps`、`rawdps` 等欄位會被**忽略**（`js/core.js` 的 `legacyRdpsKeys`），不必再安裝它，裝著也不會影響顯示。

## 安裝

1. **懸浮窗**：OverlayPlugin → 新增懸浮窗 → preset 選 **MopiMopiCustom**（OverlayPluginAddon 啟動時會註冊這個 preset；沒裝外掛就選 MiniParse 類型，網址填 `https://unnbird.github.io/mopimopi/`）。
2. **要看 GCD 欄位**：安裝 [OverlayPluginAddon](https://github.com/Unnbird/OverlayPluginAddon)（ACT → Plugins → Browse → `OverlayPluginAddon.dll`；載入順序 `FFXIV_ACT_Plugin.dll` → `OverlayPlugin.dll` → `OverlayPluginAddon.dll`，`data/actions.json` 要跟 dll 放在一起）。之後在 mopimopi 設定 → 數據 → 格式 把 `GCD%` / `GCDs` / `Lost` 勾起來。
3. **rDPS 等 FFLogs 數值**：設定 → 數據 → 一般 → 「優先使用 FFLogs 解析器數據」預設開啟，不用動；標題列會顯示 `FFLogs` 或 `ACT` 說明此刻顯示的是哪一邊。

## 介面欄位與來源

| mopimopi 欄位 | 數字從哪來 | 需要什麼 |
|---|---|---|
| DPS、傷害、傷害%、命中數、爆擊/直擊/爆直（數與 %）、最大傷害（含技能名）、死亡、標題列時間、全隊 DPS | 內建 FFLogs 解析器（對得上這場時）；否則 ACT | 無 |
| **rDPS / aDPS / nDPS / cDPS / ±Buff** | 內建 FFLogs 解析器，且只有它：`apply.js` 把每人的 `amount / amountTaken / singleTargetAmountTaken / amountGiven` 寫進該列，`Person.recalculate()` 用 `amount − amountTaken + amountGiven` 等四式除以時長。解析器沒接上（標題列顯示 `ACT`）時這幾欄是 0 | 無 |
| 治療、HPS、溢療、治療數、爆擊治療、最大治療 | ACT。這版解析器的 meters 對玩家不記治療（見〈限制〉），只有 HPS 改用 fight 時長去除 | 無 |
| **GCD%（運轉率）、GCDs（次數）、Lost（空窗秒數）、GCD（推估 recast）** | OverlayPluginAddon 注入的 `gcdUptime` / `gcdCount` / `gcdClip` / `gcdRecast`。`GCD%` 是外掛在每次按出 GCD 時量好的百分比，mopimopi 原樣顯示、不再除 | **OverlayPluginAddon** |
| 揮擊數、miss、命中率、承受傷害/治療、盾、Last 10/30/60/180 DPS | ACT | 無 |

`Limit Break` 在 FFLogs 與 ACT 都是獨立角色，不收不給 buff，所以它的 rDPS 等於自己的 DPS。

## FFLogs 模式怎麼運作

```
OverlayPlugin（ACTWebSocket 相容模式）
  ├─ Chat(每一行原始 log) ──→ js/fflogs/meter.js → LogParser.parseLine（每 100 ms 一批）
  └─ CombatData ───────────→ FflogsMeter.overlay()：collectMeters → 選最新一場 → 併寵物
                                  → 對得上這場 encounter 才把 FFLogs 的值寫進 CombatData 字串欄位
                             → Combatant / Person 照常解析、排序、歷史
```

「對得上」= 解析器那場 fight 有人出手、最近 10 秒內有回報、且 ACT encounter 時長與 fight 時長相差不超過 90 秒（滅團後 ACT 開新場、解析器還在報舊場時會退回 ACT，直到新場首擊）。

解析器本身不連網，只在懸浮窗頁面裡跑。頁面不會呼叫 `callOverlayHandler`：那會讓 OverlayPlugin 切到現代 API 並取消 mopimopi 賴以維生的 CombatData 訂閱。

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

## 檔案

| 檔案 | 用途 |
|---|---|
| `js/fflogs/parser-ff.js` | FFLogs 官方解析器 |
| `js/fflogs/host-logic.js` | 選最新一場、寵物併入主人、治療/死亡/最大傷害的純函式（共用邏輯的正本放在這裡） |
| `js/fflogs/apply.js` | 把 FFLogs 數值寫進 CombatData 字串欄位的純函式 |
| `js/fflogs/meter.js` | 在頁面裡跑解析器、吃 Chat 行、每 0.5 秒 collect、決定要不要覆蓋 |
| `js/core.js` | `onBroadcastMessage` 的兩個接點（`Chat` → feed、`CombatData` → overlay） |

## 測試

```
node tests/test-fflogs-overlay.js
node tests/test-core-person.js
```

前者：假 CombatData + 假 fight 過一遍覆蓋邏輯（每個欄位、`YOU` 對應本機玩家真名、寵物三種情形、Limit Break、不對場保留原樣、沒有治療表時保留 ACT 治療、時長格式）。後者：把 `js/core.js` 放進 Node vm 跑真正的 `Person`，確認 rDPS 四欄只從 FFLogs 的四個總量算出、舊 RdpsOverlay 的匝出欄位被忽略、OverlayPluginAddon 的 GCD 欄位原樣通過。
