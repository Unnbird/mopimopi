# MopiMopi（Unnbird fork）

[haeruhaeru/mopimopi](https://github.com/haeruhaeru/mopimopi) 的分支。多出 **rDPS 家族**（rDPS / aDPS / nDPS / cDPS / ±Buff / rD%）與 **GCD 運轉率**（GCD% / GCDs / Lost / GCD）幾個欄位。

這些數字不在頁面裡算。[OverlayPluginAddon](https://github.com/Unnbird/OverlayPluginAddon) 在 ACT 裡算好之後，當成 CombatData 的額外欄位送過來，這個頁面只負責顯示。

**為什麼不在頁面裡算**：以前是在頁面裡算的 —— 每個懸浮窗各跑一份 1.1MB 的 FFLogs 解析器，重整頁面整場資料就歸零，而同一套 GCD 邏輯在頁面和外掛裡各有一份、慢慢就漂移了。搬進外掛之後只剩一份計算、一個來源。

## 安裝

1. **外掛**：裝 [OverlayPluginAddon](https://github.com/Unnbird/OverlayPluginAddon)。載入順序必須是 `FFXIV_ACT_Plugin.dll` → `OverlayPlugin.dll` → `OverlayPluginAddon.dll`。
2. **懸浮窗**：OverlayPlugin → 新增懸浮窗 → 選 MiniParse 類型，網址填 `https://unnbird.github.io/mopimopi/`（外掛註冊的 preset **MopiMopiCustom** 指向同一個網址，直接選也可以）。
3. **欄位**：`rDPS` 與 `GCD%` 預設就開著；其餘到設定 → 數據 → 格式勾起來。

沒裝外掛也能用，只是 rDPS 家族與 GCD 欄位會是空的，其餘照 ACT 的數字顯示。

預設欄位是 `職業` / `名字` / `DPS` / `rDPS` / `D%` / `GCD%` / `傷害` / `揮擊數` / `直擊%` / `爆擊%` / `爆直%` / `最大傷害` / `死亡`。**改過設定的人不會被改動**：欄位順序存在 localStorage，新的預設只對第一次開的人生效。

## 介面欄位與來源

| mopimopi 欄位 | 數字從哪來 |
|---|---|
| **rDPS / aDPS / nDPS / cDPS / ±Buff / rD%** | 外掛，而且只有外掛。它跑 FFLogs 自己的解析器，算完直接送過來 —— 頁面原樣顯示，不再除以任何東西。沒有外掛時這幾欄是 0 |
| **GCD% / GCDs / Lost / GCD** | 外掛。同樣是算好的值，原樣顯示 |
| **DPS / HPS** | 外掛，而且也是**在那邊除好的**（`fflogsDps` / `fflogsHps`），跟 rDPS 家族同一個時鐘。寵物併進主人時是把各列的值加起來 —— 同一場的每一列都除以同一個數，所以率可以像量一樣相加。舊版外掛沒送這兩個 key 時，退回這裡自己除 |
| 傷害、傷害%、命中數、爆擊/直擊/爆直、最大傷害（含技能名）、死亡、全隊 DPS／HPS | **一律外掛的**。FFLogs 對這一列沒有數字，就顯示沒有，不會退回 ACT 的。標題列會顯示 `FFLogs` 或 `ACT` 說明這一場有沒有對上 |
| 治療、HPS、溢療、治療數、爆擊治療、最大治療 | 同上。不過這版 FFLogs 解析器對玩家不記治療，所以這幾欄實務上是 0 |
| 揮擊數、miss、命中率、承受傷害/治療、盾、Last 10/30/60/180 DPS、標題列時間 | ACT |

`Limit Break` 在 FFLogs 與 ACT 都是獨立角色，不收不給 buff，所以它的 rDPS 等於自己的 DPS。

## 資料怎麼流

```
OverlayPlugin（ACTWebSocket 相容模式）
  └─ CombatData ──→ preferFflogs()：每一列在 ACT 的數字與外掛的數字之間挑一個
                 ──→ Combatant / Person 照常解析、排序、歷史
```

Chat（每一行原始 log）還是會送到頁面，但頁面不再讀它們 —— 外掛在 ACT 讀 log 的那條執行緒上就先看到同樣的行了。

頁面不會呼叫 `callOverlayHandler`：那會讓 OverlayPlugin 切到現代 API 並取消 mopimopi 賴以維生的 CombatData 訂閱。

### 一列上為什麼會有兩份數字

ACT 的 export variable **只能新增欄位、不能覆蓋**。`damage`、`healed`、`maxhit`、`DURATION` 這些名字都是 ACT 的，外掛蓋不掉，只能另外送一份 `fflogsDamage`、`fflogsHealed`⋯ 過來。所以兩邊的數字並排存在，`js/core.js` 的 `preferFflogs()` 決定顯示哪一個。

**規則只有一條：外掛送來的就用，空的也用。** 不做「沒收到就退回 ACT」這種判斷 —— 表格要嘛講的是 FFLogs 眼中的這一場，要嘛什麼都不講。一列上混兩個來源，等於把同一場戰鬥的兩種量法並排放在相鄰欄位，D% 也就不再加得到 100%。

所以 FFLogs 不認得的列（NPC、兩邊名字拼法不同的）會顯示 0，而不是 ACT 的數字。已經被解析器折進主人的寵物（Carbuncle、Eos）同樣是 0 —— 這一格要是退回 ACT 的數字，主人會被加到兩次。

唯一不會被蓋掉的是**外掛根本沒送的欄位**：沒裝外掛時這些 key 一個都不存在，什麼都不會被複製，頁面就是原本的 mopimopi。

rDPS 家族不在這個機制裡：ACT 沒有叫 `rdps` 的欄位，外掛直接用這個名字送過來。`fflogsDps` / `fflogsHps` 則是在這個機制裡的 —— 設定關掉時 DPS 欄位就回到 ACT 自己那個數字，rDPS 家族不受影響。這也是**唯一**會讓 DPS 跟 rDPS 在單人時對不上的情況，而且那是刻意的：那一刻表格講的是 ACT 的量法。

### 兩個時鐘

FFLogs 的傷害除以「戰鬥時長 − downtime」，治療除以整場。外掛把兩個時鐘分別送成 `fflogsDuration` 與 `fflogsHealDuration`，`preferFflogs()` 放進 `DURATION` 與 `HEALDURATION`。沒有外掛時沒有 `HEALDURATION`，兩者都退回 ACT 原本那一個時長。

**每秒的欄位現在不在這裡除了。** 單人時 rDPS 照定義就等於 DPS（沒人給你團輔、你也沒給別人），而只要這兩欄不是同一個地方除出來的，它們就會差一點：先是時鐘被捨成整數，一個除 30.4、一個除 30；外掛改送帶小數的秒數之後，換成這裡的通用解析把 30.456 讀成 30.45。所以 DPS/HPS 跟 rDPS 家族一樣由外掛除好送來，`Person.recalculate()` 原樣採用。

時鐘還是照用：舊版外掛沒送 `fflogsDps` 時這裡仍然自己除，所以 `keepFflogsPrecision()` 讓這兩個值**繞過那道兩位小數的解析**，保住毫秒。

為什麼是兩個時鐘、downtime 又是怎麼算的，見 [OverlayPluginAddon 的 README](https://github.com/Unnbird/OverlayPluginAddon#兩個時鐘)。

### 寵物

解析器把「鏡射 buff」的寵物（Carbuncle、Eos 等）併進主人，所以這些寵物列顯示 0；Demi-Bahamut、Phoenix、Solar Bahamut 這類獨立角色保留自己的量，主人列是「總量 − 這些寵物」。兩邊加起來正好是 FFLogs 的總量，寵物子條照常。

### 設定

設定 → 數據 → 一般 → **優先使用 FFLogs 解析器數據**（也在標題列的更多選單裡）。這是**顯示**的選擇，不是開關計算：關掉之後表格顯示 ACT 自己的數字，外掛那邊照算不誤。rDPS 家族不受影響，因為那本來就不是 ACT 有的東西。

## 限制

- 沒有外掛就沒有 rDPS 與 GCD 欄位。這是刻意的：頁面不再有自己的一份。
- **這一場沒對上時，整張表的傷害相關欄位是 0**，不是 ACT 的數字。標題列的 `ACT` 就是在講這件事。這是「不做備援」的代價，也是它的重點：看到的數字永遠只有一個來源。
- 這版 FFLogs 解析器對玩家**不記治療**，治療欄位因此幾乎都是 ACT 的。
- 命中數來自 FFLogs 但揮擊數與 miss 是 ACT 的，命中率是混源。
- ACT 把多次 pull 合成一個 encounter 時，只會對到解析器的最後一場。
- 「這一場對不對得上」由外掛判斷。標題列顯示 `ACT` 就是沒對上；原因寫在外掛的診斷檔裡。
- 副本內的**換場**（M8S 兩個本體之間那種）ACT 會判定脫戰、另開一個 encounter，所以歷史紀錄會多出一列。這不是錯誤 —— 後面那一列帶的是整場（P1+P2）的數字，因為 FFLogs 把整場當一場。GCD 欄位也跟著整場走，不會在換場時歸零。

## 檔案

| 檔案 | 用途 |
|---|---|
| `js/core.js` | `onBroadcastMessage` 的接點、`preferFflogs()` / `keepFflogsPrecision()`、`Person` / `Combatant` |
| `js/process.js` | 欄位格式化與表格繪製 |
| `js/ui.js` | 設定畫面 |
| `js/init.js` + `dic.js` + `lang.js` | 預設值、字串、設定樹 |

## 測試

```
node tests/test-core-person.js
```

把 `js/core.js` 放進 Node vm 跑真正的 `Person` / `Combatant`，檢查這個頁面現在唯一還在做的判斷：每一列在 ACT 的數字與外掛的數字之間挑哪一個。涵蓋兩個時鐘、空字串與 0 的差別（寵物那條）、rDPS 家族與 GCD 欄位原樣通過不被再除、FFLogs 不認得的列保留 ACT 的數字、設定關掉時整張表回到 ACT、以及沒有外掛的訊息長什麼樣。

**單人那一段是這裡的主測試**：同一場用外掛實際會送的毫秒時鐘（`30.456`，不是好整除的 `30.4`），確認 DPS 與 rDPS 一模一樣 —— 送 `fflogsDps` 的新版外掛如此，沒送的舊版靠保住毫秒的時鐘自己除也如此。緊接著的寵物那一段確認寵物列的率加進主人之後，正好是 rDPS 量的那個折疊總量，關掉寵物又會退回主人自己那一份。

計算本身的測試在外掛那邊（`Test-Gcd.ps1` / `Test-Downtime.ps1` / `Test-Fflogs.ps1`，以及拿真實 log 對帳的 `Replay-Log.ps1`）。
