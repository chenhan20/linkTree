# 訓練報告管線：TCX / FIT / Strava API 的取捨

> 2026-08-12 的調查與決策紀錄，供下次接續討論。
> 所有數字都是實測值，不是推論 —— 對照樣本是 **activity 23929795272**
> （2026-08-11 劍中中中中劍，47.36 km / 2:43:41），同一趟活動同時有 TCX 與 FIT 可比對。

---

## 一、結論摘要

1. **手動匯出 TCX 沒有意義。** TCX 是 Garmin 的簡化交換格式，每點只有 8 個欄位，
   而 Strava API 的 stream 是它的**超集**。TCX 拿不到任何 API 拿不到的東西。
2. **FIT 才是真正多資料的那份**，而且多的不只是欄位 ——
   它帶著錶上真正設定的 FTP 與心率，讓區間分析從「推估」變成「正確」。
3. **Garmin 自動匯入沒有官方路可走**，非官方套件可行但脆弱，
   **不該放進 GitHub Action**。
4. 因此建議兩層架構：**Strava API 當全自動基線，FIT 當半自動加值**。

---

## 二、三種資料來源的實測比較

### 每個資料點有什麼

| | TCX（現況） | Strava API stream | FIT |
|---|---|---|---|
| 時間 / 座標 / 高度 / 距離 | ✓ | ✓ | ✓ |
| 心率 / 迴轉 / 速度 / 功率 | ✓ | ✓ | ✓ |
| 坡度 `grade_smooth` | ✗ | ✓ | （可自算） |
| 移動判定 `moving` | ✗ | ✓ | ✗ |
| **左右功率平衡** | ✗ | ✗ | **✓** |

TCX 全部欄位（掃過整份 7.1 MB 檔案確認）：
`Time, Position, AltitudeMeters, DistanceMeters, HeartRateBpm, Cadence, Speed, Watts`
——**沒有**左右平衡、踩踏效率、溫度。

### 只有 FIT 有的（這趟實際有值）

| 項目 | 值 |
|---|---|
| 左右功率平衡 | **左 43.5% / 右 56.5%**（明顯偏一側） |
| 錶上設定 FTP | 234 W |
| 最大 / 靜息 / 閾值心率 | 188 / 70 / 163 bpm |
| 心率區間邊界 | 94 / 113 / 132 / 150 / 169 / 188 |
| 功率區間邊界 | 131 / 176 / 212 / 246 / 282 / 353 |
| 各區間實際時間 | Garmin 自己算的 |
| 訓練效果 | 有氧 4.6 / 無氧 0.7 |
| 訓練負荷 | 224 |
| 裝置 | Garmin + Giant（雙邊功率計） |

### 左右平衡：兩趟都偏右，不是單次雜訊

| 日期 | 左 / 右 |
|---|---|
| 2026-08-11 | 43.5% / **56.5%** |
| 2026-08-06 | 41.1% / **58.9%** |

一般 52/48 以內算正常。連續兩趟都偏右 6–9%，**是穩定的個人特徵而非量測噪音**，
值得看坐墊高度／前後位置或請人看踩踏。這個數字 TCX 與 Strava API 都拿不到。

### FIT 有欄位但**這台裝置錄不到**（全部是空的）

`rmssd_hrv`、`sdrr_hrv`、呼吸速率、`avg_stress`、`avg_spo2`、
`time_standing`、`stand_count`、`total_grit`、`avg_flow`、溫度

→ 這些要**手錶**才會錄。用 Edge 車錶騎車的檔案裡沒有，報告會自動略過。
**不要拿這些當採用 FIT 的理由。**

---

## 三、交叉驗證（重要）

**FIT 與 TCX 算出來完全一致**，證明 `parse_fit()` 產出的三元組與 `parse_tcx()` 等價：

| | FIT | TCX | 差 |
|---|---|---|---|
| NP | 195.3 | 195.3 | 0 |
| TSS | 182 | 182 | 0 |
| IF | 0.817 | 0.817 | 0 |
| 平均功率 | 152.3 | 152.3 | 0 |
| 分圈數 | 13 | 13 | 0 |

**真正的差別在於不必再猜。** 不給任何 CLI 參數時：

| | 舊行為 | 有 FIT 之後 |
|---|---|---|
| FTP | 20 分 × 0.95 推估 | 讀錶上設定 **234** |
| 最大心率 | 年齡公式或本次觀測值 | 讀錶上設定 **188** |
| 算出的 TSS / IF | 182 / 0.817 | **190 / 0.835** |
| Garmin 自己寫的 | — | **189.9 / 0.835** ← 一致 |

### 一個被更正的判斷

先前以為爬升 1239（報告）vs 1252（Strava）的差距是「Strava 的 elevation correction」。
**錯了。** FIT 裡 Garmin 自己寫的 `total_ascent = 1252`，與 Strava 一致；
**異數是 1239 —— 我們自己 `elevation_gain()` 的演算法**（threshold=1.0 / win=15）。
要對齊的話該調的是這個函式，不是懷疑 Strava。

---

## 四、Garmin 自動匯入：三條路

| 路徑 | 可行性 | 說明 |
|---|---|---|
| **官方 Connect Developer API** | ✗ 走不通 | 申請者必須是法人（公司／大學／醫院），個人用途一律駁回；且該計畫 2026 年**整個暫停中** |
| **非官方 `garminconnect`** | △ 能動但脆 | 2026-03 Garmin 改認證打掛絕大多數非官方工具；靠 `curl_cffi` 假扮官方 Android app 才活下來（v0.3.5, 2026-06）。**MFA 需要 callback，無頭 CI 做不到**；有 ECG 裝置的帳號還關不掉 MFA |
| **本機 USB 同步** | ✓ 最穩 | Edge 接 USB 通常掛載成隨身碟，活動檔在 `/GARMIN/ACTIVITY/*.fit`。無登入、無 MFA、無逆向工程，Garmin 改什麼都不會壞 |

**結論：不要把 `garminconnect` 放進 GitHub Action。** 真要自動抓 Connect，
放本機 launchd —— MFA 要你點的時候你人在旁邊，壞了也看得見。

---

## 五、建議架構：兩層

```
基線層（全自動，永不壞）
  現有 GitHub Action（每天三班）
    └─ Strava API stream + laps  ──►  analyze  ──►  rides/<date>.html
       涵蓋每一趟，資料等同 TCX

加值層（半自動，資料最完整）
  插上 Edge / 從 Connect 下載
    └─ *.fit  ──►  同一支 analyze  ──►  重生同一頁
       多出：左右平衡、真實區間邊界、訓練效果
```

**關鍵設計：降級要安靜。** 同一支 `analyze_tcx.py` 兩種來源都吃，
沒有 FIT 就出基線版（`meta.fit` 不存在 → 報告的「裝置原始數據」卡自動隱藏），
有 FIT 就自動升級。忘了插線只是少一張卡，不會壞。

### 基線層已經萬事俱備

現有 Action **已經在抓** analyze 需要的全部東西，只是用完就丟：

| analyze 要的 | 現在哪裡有 |
|---|---|
| trackpoints | `scripts/fetch-strava.js:289` 已抓 `latlng,heartrate,velocity_smooth,altitude,watts,time`（差 cadence，加一個 key） |
| laps | Step 4a 已抓**完整** laps，寫檔前才砍成 `top_laps` |
| meta | 活動詳情已抓 |

`parse_tcx` / `parse_fit` 的介面是 `(meta, laps, points)`，
再加一個 `from_strava(activity_id)` 回傳同樣三元組即可，下游一行都不用改。

---

## 六、目前進度

### 已完成（commit `4c01409`）

- `parse_fit()`：回傳與 `parse_tcx()` 相同的 `(meta, laps, points)`，
  FIT 專屬欄位收在 `meta["fit"]`
- `parse_ride()`：依副檔名分派；`.tcx` 路徑維持只用標準函式庫
- 錶上設定值自動採用（CLI 參數仍優先）
- 報告新增「裝置原始數據」卡（左右平衡條、生理參數、真實區間圖）
- `tools/tcx/requirements.txt`（`fitdecode`，只有讀 FIT 需要）
- README 更新

### 尚未完成

- **`rides/*.html` 還沒重生** —— 線上那兩頁仍是舊的 TCX 版，沒有新卡片
- Strava API adapter（基線層）
- Action 自動產報告的步驟與門檻
- FIT 同步腳本

---

## 七、下次要先決定的事

1. **Edge 接 USB 會不會掛載成隨身碟？裡面有沒有 `GARMIN/ACTIVITY/`？**
   → 決定第三條路可不可行。插一下就知道。
2. **舊報告的 `notes.json`（教練評語）留在哪裡？**
   → repo 裡找不到。如果評語是一次性寫進 HTML 的，**重生會把它洗掉**。
   動 `rides/*.html` 之前必須先確認。
3. **自動產報告的門檻？**
   一年 150+ 趟，全出會讓 `rides/` 變垃圾場。
   初步建議：有功率 **且**（TSS ≥ 100 或當天有 ITT effort）。
4. ~~08-06 那趟沒有對應的 FIT~~ → **兩趟都有了**（2026-08-12 補）：
   - `~/Desktop/23929795272_ACTIVITY.fit`（08-11）
   - `~/Desktop/23868826419_ACTIVITY.fit`（08-06，已驗證：04:47 TPE / 39.48 km / NP 178 / 訓練效果 4.2）
   - 注意桌面上有一份同名的 `... .fit 2`，**檔頭損毀讀不開**（下載重複產生的），別誤用。
   兩頁都可以重生，唯一的阻礙是上面第 2 點的評語問題。

---

## 八、建議的執行順序

1. **基線層先做** —— 收益最大、風險已驗掉（Strava streams 與 TCX 數字一致）
2. 重生 08-11 與 08-06 報告（先產暫存檔確認，再覆蓋；**先解決第七節第 2 點的評語問題**）
3. FIT 同步腳本（等第七節第 1 點確認後）

---

## 附：驗證環境

Chrome 擴充功能連不上時的替代管線見 memory `headless-chrome-cdp-verification`。
本次 FIT 解析用 `fitdecode 0.11.0`，裝在 scratchpad 的 venv，未動系統 Python。
