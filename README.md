# MopiMopi（Unnbird fork）

[haeruhaeru/mopimopi](https://github.com/haeruhaeru/mopimopi) 的分支，配合 [RdpsOverlay](https://github.com/Unnbird/RdpsOverlay) 使用。多了兩件事：

1. **rDPS / aDPS / nDPS / cDPS / GCD 欄位**（`rdps`、`adps`、`ndps`、`cdps`、`rdpsDelta`、`gcdUptime`、`gcdCount`、`gcdClip`），讀 RdpsOverlay 注入 CombatData 的匝出變數。
2. **內建 FFLogs 官方解析器**：`js/fflogs/parser-ff.js` 是 FFLogs Archon 上傳器內嵌的 `LogParser`（版本見 [js/fflogs/PARSER-VERSION.md](js/fflogs/PARSER-VERSION.md)）。mopimopi 自己餵它 log、自己讀它的即時 meters，**FFLogs 有提供的數值一律優先顯示**，ACT 的只補它沒有的。

用 OverlayPlugin 的 preset **MopiMopiCustom**（RdpsOverlay 會註冊）新增即可，不需要別的懸浮窗。

## FFLogs 模式怎麼運作

```
OverlayPlugin（ACTWebSocket 相容模式）
  ├─ Chat(每一行原始 log) ──→ js/fflogs/meter.js → LogParser.parseLine（每 100 ms 一批）
  └─ CombatData ───────────→ FflogsMeter.overlay()：collectMeters → 選最新一場 → 併寵物
                                  → 對得上這場 encounter 才把 FFLogs 的值寫進 CombatData 字串欄位
                             → Combatant / Person 照常解析、排序、歷史
```

「對得上」= 解析器那場 fight 有人出手、最近 10 秒內有回報、且 ACT encounter 時長與 fight 時長相差不超過 90 秒（滅團後 ACT 開新場、解析器還在報舊場時會退回 ACT，直到新場首擊）。標題列會顯示 `FFLogs` 或 `ACT` 說明此刻顯示的是哪一邊。

### FFLogs 優先的欄位

| mopimopi 欄位 | 來源 |
|---|---|
| 傷害、DPS、傷害% | `amount`；每秒值除以 fight 時長 |
| 命中數、爆擊、直擊、爆直（數與 %） | `hitDetails` |
| 最大傷害（含技能名） | `hitDetails.maxHit` + `abilities` |
| 死亡 | `deaths` |
| 治療、HPS、溢療、治療數、爆擊治療、最大治療 | `friendlyHealing`（`healed = amount + over`）。**只在解析器有回報治療時才覆蓋**：實測這版解析器的 meters 對玩家不記治療（`processMeterHealing` 要求來源帶友方旗標，而解析器只對 NPC 與寵物設定它），所以治療欄位實際上仍是 ACT 的，只有 HPS 改用 fight 時長去除 |
| rDPS / aDPS / nDPS / cDPS | `amount − amountTaken + amountGiven` 等四式，不再需要 RdpsOverlay 也能顯示 |
| 標題列時間、全隊 DPS/HPS | fight 起迄與 Σ |

保留 ACT：揮擊數與 miss（FFLogs 沒有，所以命中率是混源）、承受傷害/治療、盾、Last10/30/60/180 DPS、GCD 欄位（RdpsOverlay）。

### 寵物

解析器已把「鏡射 buff」的寵物（Carbuncle、Eos 等）併進主人，沒有分量 → 這些寵物列顯示 0；Demi-Bahamut、Phoenix、Solar Bahamut 這類獨立角色則保留自己的量，主人列是「總量 − 這些寵物」，兩邊加起來正好是 FFLogs 的總量，寵物子條照常。

### 設定

- 設定 → 數據 → 一般 → **優先使用 FFLogs 解析器數據**（也在標題列的更多選單裡），關掉即回 ACT 數值。
- **FFLogs 解析器區域**：只決定 log 時間戳對到哪個 patch 日程（國際服 / 中國服 / 韓服）。設錯不會報錯，只會讓版本相關的 buff 數值偏掉。

### 限制

- 解析器版本釘在 PARSER-VERSION.md 所記的版本；新 patch 加了新狀態要更新 `parser-ff.js`。
- 頁面要在進副本前就開著；中途載入會錯過 03 AddCombatant，職業/等級要等下次換區才知道。
- 這是 FFLogs 的私有混淆程式碼，放在這個 repo（與 GitHub Pages）散布的 ToS／著作權風險由維護者自負。

## 測試

```
node tests/test-fflogs-overlay.js
```

沿用 RdpsOverlay 的 `tools/Test-OverlayFields.js` 會把這裡的 `core.js` 放進 Node vm 跑一遍，並檢查 `js/fflogs/host-logic.js` 與 RdpsOverlay 的 `data/fflogs/host-logic.js` 逐字相同（後者是正本）。
