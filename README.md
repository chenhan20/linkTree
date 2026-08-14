# SteveChuang · Personal Hub

> 個人入口網站 + 運動儀表板。部署在 GitHub Pages，**純靜態、零後端、沒有 build step**。
>
> 核心是一條**把 Garmin 手錶的原始訓練檔自動變成每日訓練報告與計時成績**的管線 ——
> 全自動、免費、**沒有任何 LLM 參與、零推論成本**。

🔗 **Live：** https://chenhan20.github.io/linkTree/linkTreeIndex.html

---

## 目錄

- [這條管線在做什麼](#這條管線在做什麼)
- [為什麼是 intervals.icu](#為什麼是-intervalsicu)
- [完整串接教學（Garmin → intervals.icu → 這個 repo）](#完整串接教學garmin--intervalsicu--這個-repo)
- [每天自動跑什麼](#每天自動跑什麼)
- [單日訓練報告](#單日訓練報告)
- [自建 ITT 計時](#自建-itt-計時)
- [頁面結構](#頁面結構)
- [資料檔結構](#資料檔結構)
- [技術棧](#技術棧)
- [本機開發](#本機開發)
- [附錄：Strava（歷史資料與唯一殘留的相依）](#附錄strava歷史資料與唯一殘留的相依)
- [文件索引](#文件索引)

---

## 這條管線在做什麼

```
   ⌚ Garmin 手錶
        │  Garmin 官方 webhook（手錶同步完 → 主動 push，不是輪詢）
        ▼
   intervals.icu                    ← Garmin 官方核准的 partner
        │  開放 API：GET /activity/{id}/file → 原封不動的原始 FIT
        ▼
   GitHub Actions（每天 10:30 / 22:30 台灣時間）
        │
        ├──► data/fit/*.fit            原始訓練檔（目前 254 個，約 50 MB / 一年份）
        ├──► data/fit/_wellness.json   每日 HRV / 靜息心率 / 睡眠 / eFTP
        ├──► rides/<date>.html         單日訓練報告（含課表對帳評分）
        ├──► data/itt-segments.json    ITT 計時成績（自建偵測器算的）
        └──► data/training-block.json  評分回填進訓練週期
```

整條路上**沒有帳號密碼、沒有爬蟲、沒有 LLM**。要設定的祕密只有一個 API key。

---

## 為什麼是 intervals.icu

要拿到「手錶原封不動吐出來的那個檔」，帳面上有三條路，只有一條走得通：

| 路 | 結論 |
|---|---|
| **Garmin 官方 Developer API** | ❌ **法人限定**，個人申請不到 |
| **Strava API** | ⚠️ 拿得到活動，但資料是**處理過**的；路段成績**需付費訂閱**，而且**會漏配對** |
| **intervals.icu 開放 API** | ✅ 免費、拿得到**原始 FIT**、不挑 IP |

**關鍵洞察：你申請不到 Garmin 官方 API，但可以免費用別人已經拿到的。**
[intervals.icu](https://intervals.icu) 是 Garmin **官方核准的 partner**，Garmin 用官方 webhook
主動把活動 push 給它，你再用它的開放 API 把檔案原封不動拿回來。

這條路的好處是連鎖的：

| | 說明 |
|---|---|
| 不需要 Garmin 帳密 | 也不存任何 Garmin token |
| 沒有 Cloudflare、沒有 429、沒有鎖帳號風險 | 走的是正規 API，不是爬蟲 |
| **不挑 IP** | 機房、雲端、GitHub Actions 都能跑，你的電腦不用開 |
| 免費 | 個人 API key 額度 5000/日、2500/15 分、10/秒 |
| 拿得到**原始**檔 | 左右平衡、錶上 FTP、真實功率區間邊界、**逐秒**功率與座標 |

### ⚠️ 唯一要背起來的坑：`/file` 不是 `/fit-file`

> `/file` 是**你手錶產出的原始 FIT**，原封不動（gzip 壓縮過）。
> `/fit-file` 是 intervals.icu 用**處理過的資料重新生成**的，會掉東西。
>
> 抓錯的話後面所有東西都會歪：ITT 計時吃的是逐秒座標，功率評分吃的是逐秒功率。

完整脈絡與驗證紀錄見 [docs/fit-pipeline.md](docs/fit-pipeline.md)，
還有哪些欄位沒挖見 [docs/intervals-api-survey.md](docs/intervals-api-survey.md)。

---

## 完整串接教學（Garmin → intervals.icu → 這個 repo）

> 約 10 分鐘，**不需要寫任何程式**，也**不需要付費**。
>
> **前置**：GitHub 帳號、Garmin 帳號（有運動紀錄，而且會同步到 Garmin Connect）。

### Step 1 · 註冊 intervals.icu 並接上 Garmin

1. 前往 https://intervals.icu 註冊（免費，可用 Google / Strava / Email 登入）
2. 右上角頭像 → **Settings**
3. 找到 **Connections**（連線）區塊 → 點 **Garmin Connect** 的 **Connect**
4. 跳到 Garmin 官方授權頁 → 登入並同意
5. 回到 intervals.icu，Garmin 那格會變成已連線

> ✅ **這一步的驗收**：手錶同步到 Garmin Connect 之後，**約 5 分鐘內**活動就會自己出現在
> intervals.icu 的行事曆上。**沒出現就先別往下走** —— 後面每一步都建立在這條 webhook 上。
>
> 💡 因為是**主動 push** 而不是輪詢，所以你在 Garmin Connect 或 intervals.icu
> **改活動名稱，改動也會傳過來**；下一班同步會偵測到標題變了並自動重生報告。
> （只有名稱與描述會同步，而且 Garmin 那邊是覆寫。）

### Step 2 · 拿 API key

1. 一樣在 **Settings** 頁，捲到**最下方**的 **Developer Settings**
2. 複製 **API Key**（一串英數字）

> 🔑 **這把金鑰的用法是 HTTP Basic auth，但很反直覺**：
> 使用者名稱是**字面上的 `API_KEY` 這五個字**，密碼才是你的金鑰。
> 填反了會拿到 401 —— `scripts/sync-intervals.py` 已經幫你在錯誤訊息裡註明這件事。

### Step 3 · Fork 這個 repo 並開 Pages

1. 右上角 **Fork** → 建到自己的帳號下
2. **Settings → Pages** → Source 選 `main` branch，Folder 選 `/(root)`
3. 記下 Pages URL：`https://{你的帳號}.github.io/{repo名稱}/`

### Step 4 · 把金鑰放進 GitHub Secrets

**Settings → Secrets and variables → Actions → New repository secret**

| Secret 名稱 | 值 | 必填 |
|---|---|---|
| `INTERVALS_API_KEY` | Step 2 複製的那串 | ✅ |

**就這一個。** athlete ID 預設用 `0`（intervals.icu 的慣例，代表「我自己」），不必填。

> 🔒 金鑰只放 GitHub Secrets。本機要跑的話放 `scripts/.env`（已在 `.gitignore`），
> **絕對不要 commit**。

### Step 5 · 首次回補歷史

**Actions → FIT Sync (intervals.icu) → Run workflow**，`backfill` 填天數（例如 `365` 拉一年）。

| 欄位 | 意思 |
|---|---|
| `backfill` | 回補過去 N 天。**留空 = 日常增量**（只掃最近 14 天） |
| `min_tss` | 產報告的 TSS 門檻，預設 `100` |
| `rebuild` | 重生所有報告（會保留教練評語，肌力訓練不會蓋掉騎乘） |

跑完之後 `data/fit/`、`rides/`、`data/itt-segments.json` 會被 commit 回你的 repo，
之後每天台灣時間 **10:30 / 22:30** 自動增量更新。

> 📦 一年份大約是 **254 個 FIT、50 MB**。這是 repo 裡最大的一塊，但換來的是
> 「重跑任何分析都不用再打任何 API」—— 評分邏輯改了就重掃本機檔案，成本是零。

### Step 6 · 設定課表對帳（選用）

想讓報告拿**當天的處方**跟實際騎乘逐段對帳，編輯 [`data/plan.json`](data/plan.json)。
那個檔開頭的 `_howToAdd` / `_roles` / `_ruleKinds` 就是完整規格，照著加即可。

**沒有寫處方的日子一律不評分** —— 絕不拿課表標準去打一趟自由騎。

### Step 7 · 設定 ITT 路段（選用）

自訂計時賽路段，設定在 [`data/itt-config.json`](data/itt-config.json)：

```json
{
  "segments": [
    { "id": 641218, "nameZh": "風櫃嘴", "nameApi": "風櫃嘴ITT",
      "type": "CLIMB", "accent": "#e87c1a" }
  ]
}
```

- **`type`**：`CLIMB` / `SPRINT` / `ENDURANCE`。
  `ENDURANCE`（河濱平路）預設**不畫 3D 路線圖** —— 平路的立體圖是一條沒有起伏的線，
  佔掉整張卡的高度卻什麼也沒說明。要逐條覆寫就加 `"route3d": true / false`。
- **`accent` 配色有語意**：山路走暖色家族（橘／琥珀／金／珊瑚），河濱平路走藍色家族。

> ⚠️ **路段折線目前仍要跟 Strava 拿一次**（`scripts/fetch-segment-streams.js`），
> 因為閘門座標來自官方路段資料。**拿到之後計時就完全不靠 Strava 了**，
> 之後每一次計時都是本機從 FIT 算出來的。詳見[附錄](#附錄strava歷史資料與唯一殘留的相依)。

### 驗收清單

| 檢查 | 該看到什麼 |
|---|---|
| Step 1 之後 | 騎完 5 分鐘內，活動自己出現在 intervals.icu 行事曆 |
| Step 5 之後 | repo 多出 `data/fit/*.fit`，Actions 綠燈 |
| Step 5 之後 | `rides/` 出現達標日的 HTML 報告 |
| Step 7 之後 | 儀表板 ITT 區塊的挑戰次數不是 0 |

---

## 每天自動跑什麼

`.github/workflows/fit-sync.yml`，台灣時間 **10:30 / 22:30**：

1. **抓 FIT** —— `scripts/sync-intervals.py`，只抓本機還沒有的（增量預設掃 14 天）
2. **抓 wellness** —— 每日 HRV / 靜息心率 / 睡眠 / 步數 / VO2max / CTL-ATL / eFTP
3. **產報告** —— `scripts/build-ride-reports.py`，達標的日子寫出 `rides/<date>.html`
4. **回補 ITT** —— `scripts/backfill-itt-efforts.py`，用自建偵測器掃出計時成績
5. **回填評分** —— 分數寫回 `data/training-block.json` 的 `sessions[].actual`
6. **commit + push** 回 repo，GitHub Pages 自動重新部署

---

## 單日訓練報告

### 產報告的門檻

一年 150+ 趟全出會讓 `rides/` 變垃圾場，所以預設是 **有功率 且 TSS ≥ 100**，
外加兩個例外：

- 當天有**教練評語** → 完全豁免
- 當天有 **ITT 成績** → **只豁免 TSS**，沒有功率仍然不合格

同一天有多個 FIT 時做同日去重，且**有功率的檔優先於無功率的** ——
不然肌力訓練會蓋掉同一天的騎乘報告。

### 課表對帳評分

報告原本用一個通用指標判斷「有沒有在練」：IF < 0.75 的時間算「移動但沒在練」。

**那是爬坡指標。** 爬坡低功率＝滑行＝真的沒在練；但平路課表的低功率是**處方寫死的**
熱身與恢復。校準日那種協定光是熱身＋緩衝＋收操就有 40 分鐘照規定該低於門檻，
於是指標會給出「你在爽騎」這種與事實相反的結論。

現在改成：**有處方就對帳處方**（`data/plan.json`），沒處方的自由騎才退回通用邏輯。
逐段列出「處方 vs 實際」，規則寫成可執行的形式（例如「功率不得低於 165W 超過 10 秒」
會**真的逐秒去數**並列出每次發生的時間點），四個維度各自附原始數字：

| 維度 | 看什麼 |
|---|---|
| 執行度 | 主課段的**平均功率** × **落在處方區間的時間佔比** × 時間完成率 |
| 紀律 | 逐秒執行 `plan.json` 的 `rules[]` |
| 續航 | 主課段前半 vs 後半的衰減（前半沒踩到處方的「負分割」不算撐得住） |
| 迴轉 | **踩踏秒數**中落在目標迴轉區間的佔比 |

> **為什麼執行度要看時間佔比而不是只看平均**：只看平均會被
> 「坡上 300W、坡下滑行」平均成剛好達標。實測一趟爬坡硬套平路減量課表，
> 段平均 168W 正中 160–175W 紅心，但只有 **7.5%** 的秒數真的在區間內、
> **18.2%** 的秒數功率低於 20W。**那正是課表要修的問題，評分器不能反過來獎勵它。**

---

## 自建 ITT 計時

這是整條管線裡去 Strava 化最關鍵的一塊：**計時完全在本機從 FIT 算出來**，不打任何 API。

### 演算法

`tools/tcx/segments.py` 用 `data/segment-streams.json` 的參考折線（端點即官方閘門）做：

1. **垂直閘門線 + 相鄰兩點線性插值**求穿越時刻。
   **不能用半徑判定** —— 50 km/h 每秒跳 13.9 m，判定圈會被整段跨過去。
2. 一律跑**原始 GPS 點**，不重採樣（補洞會複製座標，會種出假的群集）。
3. **方向判斷**：穿越起點閘門時的行進方位角要與參考折線起段同向（夾角 < 90°）。
4. **中途檢查點**：折線 50% 處設一個 50 m 半徑的檢查點，擋掉抄捷徑。
5. 一趟多次通過各自成一筆；起點穿越後在合理上限內沒等到終點就丟棄該次繼續掃。

### 準不準：跟 Strava 官方對帳

隨時可以自己重跑：

```bash
python3 scripts/backfill-itt-efforts.py --compare -q
```

目前這份資料的結果（2026-08-14，掃完 254 個 FIT）：

| 指標 | 數字 |
|---|---|
| 兩邊都有、可直接比對 | **82 筆** |
| 平均差 | **0.79 秒** |
| 最大差 | **2.7 秒** |
| FIT 檔涵蓋範圍內「Strava 有但自建沒抓到」 | **0 筆** |
| 「自建抓到但 Strava 從未配對」 | **9 筆** |

還有 11 筆是 Strava 獨有的，但那些全都**早於本機 FIT 檔的起始日**（2025-08-13）——
是原始檔不存在，不是偵測失敗。`--compare` 會自動把這兩種情況分開列，
不然會把「檔案沒有」誤讀成「演算法有洞」。

**結論：去 Strava 化不但沒有失去資料，還多拿到 9 筆 Strava 從來沒配對到的成績。**
其中包含一趟「關渡→美堤 25:07」——自建偵測器抓到，Strava 全史 0 筆。

### 成績來源標籤

每一筆 effort 都帶 `source` 欄位，儀表板的路段明細表有一欄「來源」：

| 標籤 | 意思 |
|---|---|
| `STRAVA` | Strava 官方配對的成績（需付費訂閱，舊管線留下的歷史資料） |
| `自建計時` | 由 Garmin 原始 FIT 逐秒座標自行判定閘門通過 —— **我自己算的** |

目前 **102 筆成績 / 9 條路段**，其中 93 筆是 Strava 時代的歷史資料、9 筆是自建計時。
**今天之後新增的每一筆都會是自建計時。**

> 2026-08-14 以前寫入的紀錄沒有 `source` 欄位（那時只有一個來源）。
> `scripts/tag-itt-sources.py` 已經把它們一次性補成 `strava`，
> 之後 `scripts/fetch-strava.js` 寫入時會自己標。

### 兩份檔案不要再漂移

`data/itt-segments.json` 是 ITT 成績的**權威檔**（自建偵測器寫這裡）。
`data/strava.json` 裡也有一份 `segments` 副本，但那份只有 Strava 同步跑過才會更新。

實測撞過這個洞：三條新路段在 `itt-segments.json` 有 10 筆，`strava.json` 只有 1 筆，
**畫面就是空的**。現在 `strava.html` 直接讀 `itt-segments.json` 並就地 union 合併，
FIT 回補的成績不必等 Strava 同步就會出現。
`scripts/tag-itt-sources.py` 可以隨時把兩份檔案重新對齊。

---

## 頁面結構

### 🏠 首頁（`linkTreeIndex.html`）
Canvas 星空 + 流星 + 粒子動畫、火箭導航動畫、社群連結、跳轉 Resume。

### 📄 Resume（SPA 內頁）
工作經歷時間軸、Side Projects、技能進度條、學歷與興趣標籤。

### 🚴 運動儀表板（**四個**世界共用同一份資料）

從首頁的 STEVE 專用版那一列選一個進入。共通內容：年度總覽、功率 PR（5s–60m）、
月度里程長條圖、四種運動的活動紀錄、ITT 區間、All Time 累計。

| 檔案 | 世界 | 視覺語言 |
|------|------|----------|
| `strava.html` | 深空觀測站 | 星空背景、signal-orange、液態玻璃 + 全息傾斜 + Bento 卡片 |
| `strava_pitwall.html` | 維修站牆 | 消光石板黑 + 粉筆白，板牌（極大字）與計時紙（密集分段秒數）兩個語域；分段計時四色（紫＝90 天內最佳／綠＝歷史 PR／黃＝比自己慢／灰＝尚未計時）是唯一彩色，且只表功能。無發光、無毛玻璃、無 webfont |
| `strava_helicorder.html` | 記震紙 | 地震儀記錄紙：訓練連續紀錄畫成連續走紙的波形 |
| `strava_opus5_max.html` | 遙測 OPUS MAX | 青色遙測 |

`strava_aespa.html` / `strava_maple.html` / `strava_cs.html` / `strava_lol.html` /
`strava_halo.html` 是更早的五個主題頁，檔案保留、直接開網址仍可用，
但不再出現在任何導覽裡。

> ⚠️ **`DESIGN.md` 只管 `strava.html` 一個世界。** 設計工具對其他世界報的
> design-system drift 是**預期的**，不要照著改 —— 那會把各世界拉成同一種語言。
> 同理，任何設計指令都要**指定單一檔案**，不要掃全 repo。
>
> 檔名裡的 `strava` 是歷史包袱，不是資料來源 —— 這四個世界現在吃的都是 Garmin FIT。

---

## 資料檔結構

| 檔案 | 角色 | 誰維護 |
|------|------|--------|
| `data/fit/*.fit` | **Garmin 原始 FIT** —— 訓練報告、評分、ITT 偵測器的資料源 | 自動（FIT Sync） |
| `data/fit/_activities.json` | 活動 metadata（**FIT 格式沒有活動名稱欄位**，標題唯一來源）＋ intervals 算好的負荷／區間／功率模型／裝置欄位 | 自動（FIT Sync） |
| `data/fit/_wellness.json` | 每日 HRV / 靜息心率 / 睡眠 / 步數 / VO2max / CTL-ATL / eFTP 快照 | 自動（FIT Sync） |
| `data/fit/_reports.json` | 哪些 FIT 已產過報告、用了什麼標題 | 自動（FIT Sync） |
| `rides/<date>.html` | 單日訓練報告 | 自動（FIT Sync） |
| `rides/notes/<date>.json` | 教練評語（有的話標題與評語都以它為準，重生不會洗掉） | **手動** |
| **`data/itt-segments.json`** | **ITT 成績權威檔**（自建計時 + Strava 歷史，靠 `source` 分辨） | 自動（FIT Sync） |
| `data/segment-streams.json` | ITT 路段官方折線（每條 140 點，給 3D 路線圖與自建偵測器） | 自動（新增路段後跑一次） |
| `data/segment-terrain.json` | ITT 路段地形高程（Tilezen DEM） | 自動（新增路段後跑一次） |
| `data/strava.json` | 儀表板的活動列表／年度統計／功率 PR。ITT 那段只是副本，以 `itt-segments.json` 為準 | 自動（Strava Sync，**已棄用**） |
| `data/power-prs.json` | 功率 PR 快取 | 自動（Strava Sync，**已棄用**） |
| **`data/itt-config.json`** | **ITT 路段設定（中文名、類型、顏色、要不要 3D）** | **手動** |
| **`data/plan.json`** | **課表處方（每段目標瓦數／迴轉／可執行的規則／評分參數）** | **手動** |
| **`data/training-block.json`** | **訓練週期計畫；`target` 手寫，`actual` 由 FIT Sync 回填** | **半自動** |
| `data/rivals.json` | 同事對戰名單（格式見檔案裡的 `_howToAdd`） | **手動** |
| `data/landmarks.json` | 3D 路線圖上的地標 | **手動** |
| `data/taipei-outline.json` | 台北市界 + 淡水河／基隆河（給小地圖） | 靜態 |
| `athlete/*.json` | 車手基本資料、FTP、功率區段紀錄、游泳／跑步能力 | **手動** |

> 名言語錄已搬到獨立 repo [steve-quotes](https://github.com/chenhan20/steve-quotes)，
> 前端走 jsDelivr 取用，本 repo 不再存放語錄資料。

---

## 技術棧

| 類別 | 技術 |
|------|------|
| 前端 | 純 HTML / CSS / JS，無框架，**無 build step**，CSS/JS 大多 inline |
| 動畫 | Canvas API、CSS Animation、Three.js（3D 路線，lazy-load） |
| 資料管線 | Python 3.12（`fitdecode`）＋ Node，跑在 GitHub Actions |
| 資料來源 | intervals.icu 開放 API（Garmin 官方 partner） |
| 部署 | GitHub Pages（靜態，零後端） |

---

## 本機開發

前端不需要安裝任何套件：

```bash
python3 -m http.server 8080     # 然後開 http://localhost:8080/linkTreeIndex.html
```

### FIT 管線

```bash
pip install -r tools/tcx/requirements.txt      # 只需要 fitdecode

# 金鑰放 scripts/.env（gitignore），或直接帶環境變數
set -a; . ./scripts/.env; set +a

# 抓 FIT + wellness
python3 scripts/sync-intervals.py --status
python3 scripts/sync-intervals.py --backfill 365

# 產報告（--dry-run 只看判斷不寫檔）
python3 scripts/build-ride-reports.py --dry-run
python3 scripts/build-ride-reports.py --only 2026-08-13 --overwrite

# ITT 計時
python3 tools/tcx/segments.py data/fit/2026-08-13_*.fit        # 單檔偵測
python3 scripts/backfill-itt-efforts.py --dry-run              # 全量回補（不寫檔）
python3 scripts/backfill-itt-efforts.py --compare -q           # 跟 Strava 官方對帳
python3 scripts/tag-itt-sources.py --dry-run                   # 補來源標記 + 對齊兩份檔案

# 課表對帳評分卡
python3 tools/tcx/score.py data/fit/2026-08-13_*.fit --date 2026-08-13
```

> 🍎 **macOS 專屬的坑**：python.org 的 framework build 沒有 CA bundle，
> 任何 https 都會 `CERTIFICATE_VERIFY_FAILED`。不必裝 certifi，
> **每個指令前面帶 `SSL_CERT_FILE=/etc/ssl/cert.pem` 就好**（系統內建的 bundle）。
> CI 的 ubuntu runner 沒有這個問題。

### 常見情境

| 想做什麼 | 怎麼做 |
|---|---|
| 剛騎完想立刻看到報告 | Actions → **FIT Sync** → Run workflow（留空就是日常增量） |
| 回補歷史 | 同上，`backfill` 填天數 |
| 改了活動名稱想讓報告標題跟著變 | 在 Garmin Connect 或 intervals.icu 改名即可，下次 FIT Sync 會偵測到並自動重生 |
| 改了評分邏輯想重算全部 | FIT Sync 的 `rebuild` 勾起來（保留教練評語，肌力訓練不會蓋掉騎乘） |
| 新增 ITT 路段 | 見 [Step 7](#step-7--設定-itt-路段選用) |
| 懷疑 ITT 計時不準 | `python3 scripts/backfill-itt-efforts.py --compare -q` |
| ITT 成績有資料但畫面是空的 | `python3 scripts/tag-itt-sources.py` 把 `itt-segments.json` 併回 `strava.json` |

---

## 附錄：Strava（歷史資料與唯一殘留的相依）

> **Strava 已經不是主力。** 訂閱到期就會把那條管線拆掉。
> 完整教學、OAuth 流程、環境變數、rate limit 都保留在
> [docs/strava-pipeline.md](docs/strava-pipeline.md)。

### 為什麼降級

| | Strava | intervals.icu + 自建 |
|---|---|---|
| 費用 | 路段成績配對**要付費訂閱** | 免費 |
| 資料 | 處理過的數字 | **手錶原始 FIT，原封不動** |
| 左右平衡 / 錶上 FTP / 逐秒功率 | 拿不到 | 有 |
| ITT 計時 | 靠它配對，**會漏**（實測漏掉 9 筆） | 自建偵測器，跟官方差 0.79 秒 |
| 額度 | 100 req / 15 分、1000 / 日 | 5000 / 日、2500 / 15 分 |

### 現在還跟 Strava 有關的只剩三件事

1. **歷史資料** —— `data/itt-segments.json` 裡 93 筆標著 `STRAVA` 的成績，
   涵蓋 FIT 檔開始之前（2025-08-13 以前）的年代。**保留當歷史參考，不會再長。**
2. **新增路段時拿一次官方折線** —— `scripts/fetch-segment-streams.js`。
   閘門座標來自官方路段資料，拿到之後計時就完全不靠 Strava。
3. **KOM / 全站排名** —— 這種全站資料只有 Strava 有，搬不走。

### 只有 Strava 沒有 Garmin 的人

`docs/strava-pipeline.md` 裡的完整教學仍然可用，但要注意
**ITT 路段成績是 Strava 的付費功能**，沒訂閱就只有活動列表與統計。

---

## 文件索引

| 文件 | 內容 |
|---|---|
| [docs/fit-pipeline.md](docs/fit-pipeline.md) | FIT 管線全貌與驗證紀錄 |
| [docs/intervals-api-survey.md](docs/intervals-api-survey.md) | intervals.icu API 盤點（還有哪些欄位沒挖） |
| [docs/ride-report-pipeline.md](docs/ride-report-pipeline.md) | 單日訓練報告的產生流程 |
| [docs/strava-pipeline.md](docs/strava-pipeline.md) | **已棄用**的 Strava 路線，完整教學保留 |
| [docs/data-flow.md](docs/data-flow.md) | Strava 時代的資料流程圖（**歷史文件**） |
| [DESIGN.md](DESIGN.md) | `strava.html` 的設計系統（**只管這一個檔**） |
| [PRODUCT.md](PRODUCT.md) | 產品事實與方向契約 |
