# SteveChuang · Personal Hub

> 個人入口網站，整合線上履歷與運動儀表板。部署於 GitHub Pages，靜態、零後端、無 build step。
>
> 核心是一條**把 Garmin 手錶的原始訓練檔自動變成每日訓練報告**的管線 ——
> 全自動、免費、**沒有任何 LLM 參與、零推論成本**。

🔗 **Live：** https://chenhan20.github.io/linkTree/linkTreeIndex.html

---

## 資料從哪來

```
   ⌚ Garmin 手錶
        │  Garmin 官方 webhook（主動 push）
        ▼
   intervals.icu          ← Garmin 官方核准的 partner
        │  開放 API：GET /activity/{id}/file  → 原封不動的原始 FIT
        ▼
   GitHub Actions（每天 10:30 / 22:30 台灣時間）
        │
        ├──► data/fit/*.fit          原始訓練檔
        ├──► data/fit/_wellness.json 每日 HRV / 靜息心率 / 睡眠 / eFTP
        ├──► rides/<date>.html       單日訓練報告（含課表對帳評分）
        └──► data/itt-segments.json  自建 ITT 計時成績
```

### 為什麼繞道 intervals.icu

Garmin 官方 Developer API 是**法人限定**，個人申請不到。
[intervals.icu](https://intervals.icu) 是 Garmin **官方核准的 partner**，
Garmin 用官方 webhook 主動把活動 push 給它，你再用它的開放 API 把檔案拿回來。

**關鍵洞察：你申請不到官方 API，但可以免費用別人已經拿到的。**

這條路的好處是連鎖的：

| | 說明 |
|---|---|
| 不需要 Garmin 帳密 | 也不存任何 Garmin token |
| 沒有 Cloudflare、沒有 429、沒有鎖帳號風險 | 走的是正規 API，不是爬蟲 |
| **不挑 IP** | 機房、雲端、GitHub Actions 都能跑，你的電腦不用開 |
| 免費 | 個人 API key 額度 5000/日、2500/15 分、10/秒 |
| 拿得到**原始**檔 | 左右平衡、錶上 FTP、真實功率區間邊界、逐秒功率 |

> ⚠️ **要抓 `/file`，不要抓 `/fit-file`。**
> `/file` 是你手錶產出的原始 FIT，原封不動（gzip 壓縮過）；
> `/fit-file` 是 intervals.icu 用處理過的資料**重新生成**的，會掉東西。

完整脈絡與驗證紀錄見 [docs/fit-pipeline.md](docs/fit-pipeline.md)、
API 盤點見 [docs/intervals-api-survey.md](docs/intervals-api-survey.md)。

> 📎 **Strava 那條路已棄用**（仍在跑，等訂閱到期就拆）。
> 它的完整教學、流程圖、環境變數都搬到 [docs/strava-pipeline.md](docs/strava-pipeline.md)。
> 簡單說：Strava 的 ITT 路段成績**需要付費訂閱**，給的是處理過的數字，而且**會漏配對**
> —— 實測有一趟 25:07 的成績自建偵測器抓到、Strava 全史 0 筆。

---

## 完整串接教學（Garmin → intervals.icu → 這個 repo）

> 約 10 分鐘，**不需要寫任何程式**，也**不需要付費**。
> 前置：GitHub 帳號、Garmin 帳號（有運動紀錄且會同步到 Garmin Connect）。

### Step 1 · 註冊 intervals.icu 並接上 Garmin

1. 前往 https://intervals.icu 註冊（免費，可用 Google / Strava / Email 登入）
2. 右上角頭像 → **Settings**
3. 找到 **Connections**（連線）區塊 → 點 **Garmin Connect** 的 **Connect**
4. 跳到 Garmin 官方授權頁 → 登入並同意
5. 回到 intervals.icu，Garmin 那格會變成已連線

> ✅ **驗收**：手錶同步到 Garmin Connect 之後，**約 5 分鐘內**活動就會出現在
> intervals.icu 的行事曆上。沒出現就先別往下走。
>
> 💡 這是**主動 push**，不是輪詢 —— 你在 Garmin Connect 或 intervals.icu
> **改活動名稱，改動也會傳過來**，下一班同步會偵測到標題變了並自動重生報告。
> （只有名稱與描述會同步，且 Garmin 那邊是覆寫。）

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

就這一個。athlete ID 預設用 `0`（代表「我自己」），不必填。

> 🔒 金鑰只放 GitHub Secrets。本機要跑的話放 `scripts/.env`（已在 `.gitignore`），
> **絕對不要 commit**。

### Step 5 · 首次回補歷史

**Actions → FIT Sync → Run workflow**，`backfill` 填天數（例如 `365` 拉一年）。

| 欄位 | 意思 |
|---|---|
| `backfill` | 回補過去 N 天。**留空 = 日常增量**（只掃最近 14 天） |
| `min_tss` | 產報告的 TSS 門檻，預設 `100` |
| `rebuild` | 重生所有報告（會保留教練評語，肌力訓練不會蓋掉騎乘） |

跑完之後，`data/fit/`、`rides/`、`data/itt-segments.json` 會被 commit 回你的 repo，
之後每天台灣時間 **10:30 / 22:30** 自動增量更新。

### Step 6 · 設定課表對帳（選用）

想讓報告拿**當天的處方**跟實際騎乘逐段對帳，編輯 [`data/plan.json`](data/plan.json)。
那個檔開頭的 `_howToAdd` / `_roles` / `_ruleKinds` 就是完整規格，照著加即可。
沒有寫處方的日子一律不評分 —— **絕不拿課表標準去打一趟自由騎**。

### Step 7 · 設定 ITT 路段（選用）

自訂計時賽路段。設定在 [`data/itt-config.json`](data/itt-config.json)：

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
> 因為閘門座標來自官方路段資料。拿到之後計時就**完全不靠 Strava**了。
> 詳見 [docs/strava-pipeline.md](docs/strava-pipeline.md) 的 Step 6。

---

## 單日訓練報告裡有什麼

### 產報告的門檻

一年 150+ 趟全出會讓 `rides/` 變垃圾場，所以預設是 **有功率 且 TSS ≥ 100**，
外加兩個例外：當天有教練評語（完全豁免）、當天有 ITT 成績（**只豁免 TSS，
沒有功率仍然不合格**）。同一天有多個 FIT 時做同日去重，且**有功率的檔優先於無功率的**
—— 不然肌力訓練會蓋掉同一天的騎乘報告。

### 課表對帳評分

報告原本用一個通用指標判斷「有沒有在練」：IF < 0.75 的時間算「移動但沒在練」。
**那是爬坡指標** —— 爬坡低功率＝滑行＝真沒練，但平路課表的低功率是**處方寫死的**
熱身與恢復。校準日那種協定光是熱身＋緩衝＋收操就有 40 分鐘照規定該低於門檻，
於是指標會給出「你在爽騎」這種與事實相反的結論。

現在改成：**有處方就對帳處方**（`data/plan.json`），沒處方的自由騎才退回通用邏輯。
逐段列出「處方 vs 實際」，規則寫成可執行的形式（例如「功率不得低於 165W 超過 10 秒」
會真的逐秒去數並列出每次發生的時間點），四個維度各自附原始數字：

| 維度 | 看什麼 |
|---|---|
| 執行度 | 主課段的**平均功率** × **落在處方區間的時間佔比** × 時間完成率 |
| 紀律 | 逐秒執行 `plan.json` 的 `rules[]` |
| 續航 | 主課段前半 vs 後半的衰減（前半沒踩到處方的「負分割」不算撐得住） |
| 迴轉 | **踩踏秒數**中落在目標迴轉區間的佔比 |

> **為什麼執行度要看時間佔比而不是只看平均**：只看平均會被
> 「坡上 300W、坡下滑行」平均成剛好達標。實測一趟爬坡硬套平路減量課表，
> 段平均 168W 正中 160-175W 紅心，但只有 7.5% 的秒數真的在區間內、
> 18.2% 的秒數功率低於 20W。**那正是課表要修的問題，評分器不能反過來獎勵它。**

分數會回填進 `data/training-block.json` 的 `sessions[].actual`，
儀表板的「週期」章與活動卡徽章就是讀那裡。

### 自建 ITT 計時（去 Strava 化的關鍵）

`tools/tcx/segments.py` 用 `data/segment-streams.json` 的折線做**垂直閘門線＋
相鄰兩點插值**求穿越時刻（不能用半徑判定 —— 50 km/h 每秒跳 13.9 m，會整段跨過去），
加上起點方位角同向判斷與折線中點檢查，擋掉反向與抄捷徑。

實測與 Strava 官方在可比的 19 筆 effort 上**全數吻合，最大差 2.0 秒**；
新增路段第一次上場也只差 0.6 秒。而且它抓到過 Strava 沒配對到的成績。

`scripts/backfill-itt-efforts.py` 把偵測到的成績**合併**進 `itt-segments.json`
（不是覆寫；Strava 事後補配對到時會把多餘的那筆清掉）。已接進 FIT Sync，每班自動跑。

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
> design-system drift 是預期的，不要照著改 —— 那會把各世界拉成同一種語言。
> 同理，任何設計指令都要指定單一檔案，不要掃全 repo。

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
| `data/itt-segments.json` | ITT 成績（Strava 配對 + 自建偵測，兩邊合併） | 自動（兩條管線） |
| `data/segment-streams.json` | ITT 路段官方折線（每條 140 點，給 3D 路線圖與自建偵測器） | 自動（新增路段後跑一次） |
| `data/segment-terrain.json` | ITT 路段地形高程（Tilezen DEM） | 自動（新增路段後跑一次） |
| `data/strava.json` | 儀表板的活動列表／年度統計／功率 PR | 自動（Strava Sync，**已棄用**） |
| `data/power-prs.json` | 功率 PR 快取 | 自動（Strava Sync，**已棄用**） |
| **`data/itt-config.json`** | **ITT 路段設定（中文名、類型、顏色、要不要 3D）** | **手動** |
| **`data/plan.json`** | **課表處方（每段目標瓦數／迴轉／可執行的規則／評分參數）** | **手動** |
| **`data/training-block.json`** | **訓練週期計畫；`target` 手寫，`actual` 由 FIT Sync 回填** | **半自動** |

> 名言語錄已搬到獨立 repo [steve-quotes](https://github.com/chenhan20/steve-quotes)，
> 前端走 jsDelivr 取用，本 repo 不再存放語錄資料。

---

## 技術棧

| 類別 | 技術 |
|------|------|
| 前端 | 純 HTML / CSS / JS，無框架，**無 build step** |
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

# 單獨用某支工具
python3 tools/tcx/score.py    data/fit/2026-08-13_*.fit --date 2026-08-13  # 課表對帳評分卡
python3 tools/tcx/segments.py data/fit/2026-08-13_*.fit                    # 自建 ITT 計時
python3 scripts/backfill-itt-efforts.py --dry-run                          # ITT 成績回補
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
| 新增 ITT 路段 | 見上面 Step 7 |
| 想用 Strava 而不是 Garmin | 見 [docs/strava-pipeline.md](docs/strava-pipeline.md)（**需付費訂閱**才有 ITT 成績） |

---

## 文件索引

| 文件 | 內容 |
|---|---|
| [docs/fit-pipeline.md](docs/fit-pipeline.md) | FIT 管線全貌與驗證紀錄 |
| [docs/intervals-api-survey.md](docs/intervals-api-survey.md) | intervals.icu API 盤點（還有哪些沒挖） |
| [docs/strava-pipeline.md](docs/strava-pipeline.md) | **已棄用**的 Strava 路線，完整教學保留 |
| [docs/data-flow.md](docs/data-flow.md) | Strava 資料流程圖 |
| [DESIGN.md](DESIGN.md) | `strava.html` 的設計系統（**只管這一個檔**） |
