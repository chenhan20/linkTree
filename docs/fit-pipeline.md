# FIT 自動同步：`ride-report-pipeline.md` 第四節的更正

> 2026-08-12。這份取代該文件第四節與第五節的結論。

## 一句話

**Garmin 自動匯入有第四條路，而且能放進 GitHub Action。** 走 Garmin 官方核准的 partner
（**intervals.icu**）當中繼：Garmin 用官方 webhook 主動 push 活動給它，你再用它的開放 API
拿**原始 FIT**。沒有 Garmin 帳密、沒有 MFA、沒有 Cloudflare、不挑 IP、免費。

原文件第四節的三條路各自的判斷都是對的，只是漏了第四條：

| 路徑 | 原文判斷 | 現在 |
|---|---|---|
| 官方 Connect Developer API | ✗ 法人限定，2026 整個暫停 | **仍然正確**，個人拿不到 |
| 非官方 `garminconnect` | △ 能動但脆，MFA 無頭 CI 做不到 | **仍然正確**，留作備援 |
| 本機 USB 同步 | ✓ 最穩但要插線 | 仍可用，但不再需要 |
| **partner 中繼（intervals.icu）** | — 未考慮 | **✓ 全自動，本機不用開** |

關鍵洞察：**你申請不到官方 API，但你可以免費用別人已經拿到的。**

第七節第 1 點「Edge 接 USB 會不會掛載成隨身碟」因此不必再驗 —— 不需要了。

---

## 架構改動

原文件第五節提的兩層架構，**加值層從「半自動」升級成「全自動」**：

```
基線層（不變）
  strava-sync.yml（每天三班）
    └─ Strava API → data/strava.json → 前端 5 個總覽頁

加值層（本次新增，全自動）
  fit-sync.yml（每天 22:30 TPE，排在 strava 最後一班之後）
    └─ intervals.icu → data/fit/*.fit
         └─ analyze_tcx.py → render_dashboard.py → rides/<date>.html
              └─ build_index.py → rides/index.{html,json}
```

兩條路**完全獨立**。`fetch-strava.js` 一行都沒動，`data/strava.json` 也不受影響 ——
Strava 訂閱還在的期間可以拿兩邊的數字互相對照，之後要拆掉 Strava 只要停用
`strava-sync.yml` 就好。

`analyze_tcx.py` / `render_dashboard.py` / `build_index.py` 也都沒動。

---

## 新增檔案

| 檔案 | 做什麼 |
|---|---|
| `scripts/sync-intervals.py` | intervals.icu → `data/fit/*.fit`（純標準函式庫） |
| `scripts/build-ride-reports.py` | `data/fit/` → `rides/<date>.html`，含門檻判斷 |
| `.github/workflows/fit-sync.yml` | 排程 |

---

## 兩個原文件的未解問題，答案

### 第七節第 2 點：教練評語留在哪？會不會被重生洗掉？

**答案：在 repo 裡，`rides/notes/<date>.json`。** `2026-08-06.json`（1.4 KB）和
`2026-08-11.json`（2.1 KB）兩份都在。原文件寫「repo 裡找不到」應該是當時還沒建，或是找錯位置。

**所以重生是安全的。** `build-ride-reports.py` 會自動偵測 `rides/notes/<date>.json`
並帶 `--notes` 給 `render_dashboard.py`。評語不會掉。

### 第七節第 3 點：自動產報告的門檻？

採用原文件的初步建議並補了兩個例外。預設是 **有功率 且 TSS ≥ 100**，另外三種無條件放行：

- 這天有 `rides/notes/<date>.json` —— 你花時間寫了評語，就是想要這頁
- 這天有 ITT 成績（從 `data/itt-segments.json` 讀）
- `--force`

門檻可用 `--min-tss` 或 workflow 的 `min_tss` 輸入調整。

---

## 設定

1. intervals.icu 註冊免費帳號 → Settings → 连接 → 授權 Garmin（勾「下載活動」）
2. Settings 最下方 Developer Settings 複製 API key
3. repo → Settings → Secrets and variables → Actions → New repository secret
   名稱 `INTERVALS_API_KEY`
4. （選用）Variables 分頁設 `ATHLETE_WEIGHT` / `ATHLETE_HEIGHT`，預設 80 / 173
5. Actions → FIT Sync → Run workflow，第一次可以填 `backfill = 90`

---

## 幾個實作上的決定

**抓 `/file` 不是 `/fit-file`。** intervals.icu 有兩個很像的端點：`/activity/{id}/file`
是**原始上傳檔**原封不動，`/activity/{id}/fit-file` 是它用處理過的資料**重新生成**的
—— 分圈會變成用 interval 重建、自訂欄位變成 developer field、原始檔沒被讀進去的東西會掉。
抓錯就失去採用 FIT 的全部意義（左右平衡、錶上 FTP、真實區間邊界）。

**報告日期用 `analyze` 算出的 `when.date`，不是檔名。** 檔名日期來自 intervals.icu 的
`start_date_local`，`when.date` 來自 `analyze_tcx.py` 自己的時區換算，**跨午夜的活動兩者會差一天**。
用 `when.date` 才會跟既有的 `rides/*.html` 命名和 `build_index.py` 對齊。

**`data/fit/_reports.json` 記錄已處理過的檔案。** 不然每次 Action 都要對所有 FIT 重跑一次
`analyze`（一趟約 1 秒，一年 150 趟就是兩分半）。有這個檔案的話重跑是 0.05 秒。

**FIT 有 commit 進 repo。** 一趟約 200–400 KB，一年 150 趟約 45 MB，GitHub 吃得下。
好處是原始檔永久保存在你自己手上 —— intervals.icu 哪天收掉或改政策都不影響。
不想要的話把 workflow 存檔那步的 `data/fit` 拿掉，改成只留 `rides`。

**429 不重試。** intervals.icu 的限制是 5000/日、2500/15 分、10/秒，日常同步用不到零頭，
但腳本遇到 429 還是會直接中止而不是重試。

---

## 已驗證

### 2026-08-12：本機對真實 API 全鏈實測，前提成立 ✅

原本這節寫「尚未驗證：intervals.icu 的實際 API 回應」。**現在驗過了**，
在 macOS 本機對真實帳號（`steveChuang` / `i673882`）跑完六步。

#### 抓取結果

`--backfill 30`（2026-07-13 ~ 2026-08-13）：**17 筆，全部是 `.fit`，6.0 MB**。
零個 `.gpx`/`.tcx` —— 30 天內每一筆都是 Garmin 裝置錄的。17 份的 byte 8–11 全是 `.FIT`，無損毀檔。
內容為 12 趟 Ride + 5 次 WeightTraining。

#### 核心驗證：`/file` 給的確實不是重新生成的檔

對照組是 2026-08-11 那趟（Strava activity `23929795272`，47.36 km），
拿 intervals.icu 的檔跟從 Garmin Connect 下載的原始檔各跑一次 `analyze_tcx.py --weight 80 --height 173`：

| 檢查項 | 期望 | intervals.icu | Connect 匯出 |
|---|---|---|---|
| `athlete.ftp_estimated` | `false` | `false` ✅ | `false` |
| 錶上 FTP | 234 | 234 ✅ | 234 |
| 左右平衡 右% | 56.5 | 56.5 ✅ | 56.5 |
| NP（`power.np_w`） | 195.3 | 195.3 ✅ | 195.3 |
| TSS | 190 | 190 ✅ | 190 |
| IF | 0.835 | 0.835 ✅ | 0.835 |
| 錶上最大心率 | 188 | 188 ✅ | 188 |
| Garmin `total_ascent` | 1252 | 1252 ✅ | 1252 |
| 分圈數 | 13 | 13 ✅ | 13 |

`ftp_source` / `max_hr_source` 兩份都是「裝置設定值」而非推估。
**兩份 analyze 輸出（16.8 KB JSON）逐鍵比對只差一個 `file` 欄位。**

FIT 訊息層也完全等價：**33 種 message type 數量零差異、總計 41,072 筆訊息、
developer field 出現次數 0 vs 0**。最後這項最關鍵 —— 下面「抓 `/file` 不是 `/fit-file`」那節說
`/fit-file` 的徵狀是「自訂欄位變成 developer field」，實測**沒有**，確認拿到的不是重新生成的那份。

#### ⚠️ checksum 不能拿來當驗收標準

兩個檔案 **sha256 不同、大小差 45,953 bytes**（intervals.icu 698,994 / Connect 744,947）。
原因是容器編碼不同，不是內容缺漏：

```
intervals.icu   FIT proto 2.0 · profile 211.98 · body 698,978
Connect 匯出     FIT proto 1.0 · profile 212.1  · body 744,931
```

不同版本的 FIT SDK 重新打包同一批訊息。嚴格說**兩份都不是對方的 byte-copy，
鏈路上至少有一端重新編碼過**，但 41,072 筆訊息一筆不少。
下次驗證請用上面的數字表，不要用 checksum，否則會誤判成失敗。

#### 端到端：重生結果 byte-identical

`build-ride-reports.py --overwrite --only 2026-08-11` 產出的 HTML 與
commit `746eba8`（當時用 Connect 那份 FIT 產的）**sha256 完全相同**
（`6fd05715199ad04879d272d809d6141dae6f681c5a5e231b8e653ee58e289f84`）。
兩個不同來源的檔案產出同一份報告。教練評語 12 條長字串 12 條全在。

`rides/index.json` 由 2 筆變 9 筆，既有兩筆數值未變。

---

### 踩到的坑（照順序，下次不用再撞一次）

**1. Cloudflare 擋 urllib —— 已修 `sync-intervals.py`**

intervals.icu 在 Cloudflare 後面，會擋掉 urllib 預設的 `User-Agent: Python-urllib/3.x`。
**金鑰完全正確也是 403，而且回的是 HTML 錯誤頁不是 JSON**，`show_status()` 只印前 300 字元，
看起來就是一坨 `<!doctype html>`，極容易誤判成金鑰填錯。三方交叉確認：

| 打法 | 結果 |
|---|---|
| `curl -u API_KEY:<金鑰>` | HTTP 200 |
| urllib + 預設 UA | HTTP 403（Cloudflare HTML） |
| urllib + 具名 UA | HTTP 200 |

已加 `USER_AGENT` 常數（可用 `INTERVALS_UA` 覆寫）並在 `_request()` 帶上。
**這個 bug 會讓 workflow 第一步 `--status` 就紅燈，而錯誤訊息會把你導去檢查 secret，方向完全錯。**

**2. 本機 TLS（只影響 macOS，CI 無此問題）**

python.org 的 Python 3.12 framework build 沒有 CA bundle
（`/Library/Frameworks/.../etc/openssl/cert.pem` 不存在），任何 https 都是
`CERTIFICATE_VERIFY_FAILED`。不必跑 `Install Certificates.command`、不必裝 certifi，
**本機每個指令前面帶 `SSL_CERT_FILE=/etc/ssl/cert.pem`（macOS 內建 bundle）即可**。
`analyze_tcx.py --strava <URL>` 也吃這條，沒帶的話 Strava 脈絡會靜默變成 None。

---

### 兩個尚未處理的問題（實測才浮出來，不屬於本次範圍）

**A. 門檻幾乎沒有在發揮作用，而且例外會繞過 `has_power`**

`data/itt-segments.json` 有 **54 天**有 ITT 成績，所以「當天有 ITT 成績」這條例外
放行了**全部 8 筆**通過的活動，**`TSS ≥ 100` 一次都沒有真正決定過任何事**。
原文件想解決的「一年 150 趟會變垃圾場」其實沒被這個門檻擋住。

更具體的問題在 `build-ride-reports.py:103-119` 的 `qualifies()`：
`--force` → notes → ITT 三條例外都排在 `has_power` 檢查**之前**。
所以 2026-07-22 的**肌力訓練**（`sport=Training`、`has_power=False`、`distance 0.0 km`）
也「合格」了，而它跟同一天的騎乘共用 `rides/2026-07-22.html`：

```
2026-07-22_i175154483_內湖區-公路車.fit   ← 排序在前
2026-07-22_i175154485_肌力訓練.fit        ← 排序在後
```

- **平常跑安全**：第二個檔會被 `:174` 的「HTML 已存在就跳過」擋掉，騎乘那份勝出
  （dry-run 顯示 8 筆、實跑 7 筆，差的就是這筆）
- **`--overwrite` 會出事**：`:174` 被繞過，**肌力訓練會覆蓋掉騎乘的報告**，
  變成一份 0 km、沒有功率的「訓練報告」。而 workflow 的 `rebuild: true` 走的正是這條

建議修法是把 `has_power` 檢查移到三條例外之前（notes 那條可能要保留豁免）。
**本次沒有動它** —— 這會改變產出政策，該由你決定。

**B. 沒有 notes 的日期，報告標題是通用的**

`render_dashboard.py:612`：`title = a.title or notes.get("title") or f"{date} 訓練報告"`。
7 份新報告都沒有 `rides/notes/<date>.json`，所以標題是「2026-08-04 訓練報告」，
而 08-11 的「劍 中中中中 劍」是從 notes 來的，不是從 Strava。

但活動名稱其實就在 analyze 輸出裡：`strava.this_ride.name`（08-04 = `晨間騎乘-露營場風櫃嘴`）。
FIT 本身沒有活動名稱欄位，intervals.icu 給的是地點式命名（`內湖區 公路車`）。
要去 Strava 化的話，這個 fallback 鏈需要另外想 —— 目前唯一的名稱來源仍然是 Strava。

---

### 先前在容器內用合成 FIT 驗過的（仍然有效）

- `analyze_tcx.py` 吃 FIT 在 Python 3.12 + fitdecode 環境正常（本次實測為 fitdecode 0.11.0）
- 全鏈 FIT → `analyze` → `render_dashboard` → HTML → `build_index` 重建清單
- 門檻判斷：TSS 62 的活動在預設門檻 100 下被擋、`--min-tss 50` 下通過
- 有 `notes/<date>.json` 時無條件放行並自動帶 `--notes`
- 沒有功率的活動（跑步）正確被擋
- 重跑第二次 0.05 秒，沒有重算

**仍未驗證**：GitHub Actions 上的實際執行。本機已經把 API、金鑰、資料正確性都驗掉了，
CI 那邊剩下的風險是 runner 的對外連線與 secret 設定。workflow 第一步就是 `--status`，
會立刻紅燈，不會靜默失敗。
