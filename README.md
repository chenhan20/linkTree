# SteveChuang · Personal Hub

> 太空主題個人入口網站，整合線上履歷與 Strava 運動儀表板。
> 部署於 GitHub Pages，每天透過 GitHub Actions 自動同步 Strava 資料（台灣時間 10:00 / 18:00 / 22:00）。

🔗 **Live：** https://chenhan20.github.io/linkTree/linkTreeIndex.html

---

## 頁面預覽

> 截圖放在 `docs/` 資料夾，檔名 `preview-home.png` / `preview-strava.png`

---

## 🚴 Strava 儀表板 · 重點功能

> 太空主題運動儀表板，資料每天自動同步。以下為桌面版實際畫面。

### 星座名片 + 功率排行榜
即時星座動畫名片（FTP / 里程 / 爬升），下方為最佳功率 PR（5s ~ 60m）排行。

![名片與功率排行榜](docs/strava-hero.png)

### ITT 區間 · Fusion 卡片
自訂計時賽路段，液態玻璃 + 全息傾斜 + Bento 排版的卡片：卡片大小依挑戰次數自動縮放、內建依真實 altitude/grade stream 畫出的坡度示意曲線，滑鼠移過去有 3D 傾斜與全息光澤，並保留最佳成績、功率、狀態評分（UNTOUCHED / HEATING UP / PEAK...）等既有判斷邏輯。

![ITT 區間 Fusion 卡片](docs/strava-segments.png)

### 月度紀律 + 本週任務
各運動項目月度達標進度，以及單車 / 跑步 / 游泳 / 重訓的每週任務挑戰。

![月度紀律與本週任務](docs/strava-overview.png)

### 月度里程 / 爬升 + 活動紀錄

| 月度里程 / 爬升 | 活動紀錄時間軸 |
|------|------|
| ![月度里程爬升](docs/strava-chart.png) | ![活動紀錄](docs/strava-activity.png) |

---

## 頁面結構

### 🏠 首頁（linkTreeIndex.html）
- Canvas 星空 + 流星 + 粒子動畫
- 火箭導航動畫
- 社群連結按鈕（Instagram、Facebook、YouTube、Strava、LinkedIn、GitHub）
- 跳轉 Resume 頁面

### 📄 Resume（SPA 內頁）
- 工作經歷時間軸
- Side Projects 展示
- 技能進度條動畫
- 學歷、興趣標籤

### 🚴 Strava 儀表板（strava.html）
- 年度總覽：里程、爬升、次數、時數
- 功率 PR 紀錄（最佳 5s / 10s / 30s / 1m / 2m / 5m / 10m / 20m / 60m）
- 月度里程長條圖
- 活動紀錄：單車 / 跑步 / 游泳 / 重訓分頁
- All Time 累計數據
- 每天 10:00 / 18:00 / 22:00（台灣時間）自動更新

---

## 技術棧

| 類別 | 技術 |
|------|------|
| 前端 | 純 HTML / CSS / JS，無框架，無 build step |
| 動畫 | Canvas API、CSS Animation |
| 資料同步 | Strava OAuth 2.0 + GitHub Actions |
| 部署 | GitHub Pages（靜態，零後端） |

---

## 🔧 Fork 後自己用（給其他人完整串接教學）

> 想用自己的 Strava 帳號跑同一套？整套流程約 10–15 分鐘，**不需要寫任何程式**。

### 前置
- GitHub 帳號（要能開 GitHub Pages）
- Strava 帳號（有運動紀錄）

---

### Step 1 · Fork 此 repo

1. 點右上角 **Fork** → 建到自己的帳號下
2. **Settings → Pages** → Source 選 `main` branch，Folder 選 `/(root)`
3. 記下 Pages URL：`https://{你的帳號}.github.io/{repo名稱}/`

---

### Step 2 · 建立 Strava API App（拿 client_id / client_secret）

1. 前往 https://www.strava.com/settings/api
2. 點 **Create & Manage Your App**
3. 填寫：
   - **Application Name**：隨意（例：MyStravaSync）
   - **Category**：Data Importer
   - **Authorization Callback Domain**：填 `localhost`（給下一步授權用）
4. 建立後記下：
   - `Client ID`（純數字）
   - `Client Secret`（長字串）

---

### Step 3 · 取得 OAuth Refresh Token（一次性授權）

讓 GitHub Actions 機器人可以代你讀取資料。Refresh token 取得後**永久有效**（除非你撤銷）。

```powershell
# (a) 瀏覽器開以下 URL，把 YOUR_CLIENT_ID 換成 Step 2 的 Client ID
# https://www.strava.com/oauth/authorize?client_id=YOUR_CLIENT_ID&redirect_uri=http://localhost&response_type=code&scope=activity:read_all

# (b) 同意授權後瀏覽器會跳到 localhost（連線失敗沒關係）
#     從網址列複製 code= 後面那串：
#     http://localhost/?state=&code=abc123xyz&scope=read,activity:read_all
#                              ↑ 這段就是 code（只能用一次）

# (c) 用 code 換 refresh_token
$body = "client_id=YOUR_CLIENT_ID&client_secret=YOUR_CLIENT_SECRET&code=abc123xyz&grant_type=authorization_code"
Invoke-RestMethod -Method POST -Uri "https://www.strava.com/oauth/token" -Body $body
# 回傳 JSON 的 "refresh_token" 欄位，複製下來（很長一串）
```

---

### Step 4 · 設定 GitHub Secrets（把 4 個值塞進 repo）

前往 **Settings → Secrets and variables → Actions → New repository secret**，逐一建立：

| Secret 名稱 | 值來源 |
|------------|--------|
| `STRAVA_CLIENT_ID` | Step 2 |
| `STRAVA_CLIENT_SECRET` | Step 2 |
| `STRAVA_REFRESH_TOKEN` | Step 3 |
| `STRAVA_ATHLETE_ID` | Strava 登入後網址 `/athletes/數字`，那個數字就是 |

---

### Step 5 · 首次全量同步

**GitHub repo → Actions → Strava Daily Sync → Run workflow**，勾選「全量抓取」後按 Run。

> 首次跑完，`data/strava.json` 和 `data/itt-segments.json` 會被 commit 回 repo，之後每天台灣時間 10:00 / 18:00 / 22:00 自動增量更新。

---

### Step 6 · 設定 ITT 路段（選用）

想追蹤特定 Strava Segment 的計時成績，編輯 [data/itt-config.json](data/itt-config.json)：

```json
{
  "segments": [
    {
      "id": 641218,
      "nameZh": "風櫃嘴",
      "nameApi": "風櫃嘴ITT",
      "type": "CLIMB",
      "accent": "#e87c1a"
    }
  ]
}
```

- **找 Segment ID**：Strava 網頁開啟路段，URL 中的數字 `https://www.strava.com/segments/`**`641218`**
- **`type` 可選**：`CLIMB` / `SPRINT` / `ENDURANCE`
- 加完後重跑 Step 5 即可，`strava.html` 不需要改

---

## Strava 自動同步流程

### 🍼 笨蛋版（30 秒看懂）

> 想像 Strava 是「便利商店」、`strava.json` 是「冰箱裡的便當」、網頁是「飯桌」。

```
台灣時間每天三次（10:00 / 18:00 / 22:00）
   ↓
機器人（GitHub Actions）拿著鑰匙去 Strava 便利商店
   ↓
把所有運動紀錄打包成一個便當盒（strava.json）
   ↓
放回家裡冰箱（commit + push 回 repo）
   ↓
你打開網頁 → 網頁從冰箱拿便當出來顯示
```

**重點**：網頁本身**不會**直接打 Strava，它只看「冰箱裡那個便當」。
所以如果剛運動完、便當還沒更新，網頁就還是舊的 → 這時候去手動催一下機器人就好。

**手動催機器人的 3 個情境**：

| 情境 | 怎麼做 |
|------|-------|
| 平常剛運動完想立刻看到 | GitHub repo → Actions → **Strava Daily Sync** → Run workflow |
| 想拉「以前全部」歷史活動（首次或重灌） | 本機跑 `$env:FETCH_ALL="1"; $env:SCAN_SEGMENTS="1"; node scripts/fetch-strava.js` |
| 想補抓特定 ITT 區段最新成績 | 同上，或直接讓每天的 cron 自動跑 |

**便當盒裡有什麼**（`strava.json` 結構）：
- 🏆 年度/全時間統計（YTD、All Time）
- ⚡ 功率 PR 紀錄（best watts by duration: 5s–60m）
- 📅 每月里程歷史
- 🚴 / 🏃 / 🏊 / 🏋️ 全部活動清單（含 Strava activity_id）
- ⛰️ ITT 區段成績（風櫃嘴 / 中社路 / 圓山-社子島）

---

### 🛠️ 工程師版（可實作細節）

> 完整流程圖（含分支、API 細節、快取邏輯）見 [docs/data-flow.md](docs/data-flow.md)

```mermaid
flowchart TD
  Cron(["⏰ 台灣 10:00 / 18:00 / 22:00<br/>UTC 02:00 / 10:00 / 14:00"]) --> Token
  Token["① POST /oauth/token<br/>refresh_token → access_token"] --> Stats
  Stats["② GET /athletes/{id}/stats<br/>YTD / All-time"] --> Acts
  Acts{"③ GET /athlete/activities<br/>FETCH_ALL=1?"}
  Acts -- 否 --> ActsR["page=1, per_page=100"]
  Acts -- 是 --> ActsA["分頁直到空<br/>per_page=200"]
  ActsR --> Build
  ActsA --> Build
  Build["④ buildJSON 純運算<br/>monthly_summary / goals / quest<br/>recent_rides/runs/swims/weights"] --> Mode
  Mode{"⑤ Detail enrichment<br/>SCAN_SEGMENTS / SCAN_POWER?"}
  Mode -- 否（日常） --> Daily["enrichRideLaps<br/>LAP_FETCH_MAX=30<br/>cache by ride.id"]
  Mode -- 是 --> Scan["scanSegmentsHistory<br/>全史 ride 補打 detail"]
  Daily --> Detail
  Scan --> Detail
  Detail["GET /activities/{id}<br/>• laps → 篩 avg_watts ≥ 150W<br/>  SCAN_POWER: 掃全史找最佳功率 PR<br/>• segment_efforts → ITT 三個 ID"]
  Detail --> Power["⑥a buildPowerPRs<br/>best watts per duration<br/>5s/10s/30s/1m/2m/5m/10m/20m/60m<br/>→ power_prs in strava.json"]
  Detail --> Segs["⑥b buildSegmentsData<br/>合併去重 by activity_id<br/>PR = min(elapsed_sec)"]
  Power --> Write
  Segs --> Write
  Write["⑦ 寫檔<br/>strava.json + itt-segments.json"]
  Write --> Push["git commit/push<br/>(GITHUB_TOKEN)"]
  Push --> Pages["GitHub Pages CDN<br/>5 個前端 fetch 渲染"]

  style Cron fill:#FC4C02,color:#fff
  style Push fill:#2ea043,color:#fff
  style Pages fill:#a855f7,color:#fff
```

#### 環境變數（`scripts/.env` 或 GitHub Secrets）

| 變數 | 必填 | 用途 |
|------|------|------|
| `STRAVA_CLIENT_ID` | ✅ | Strava App ID |
| `STRAVA_CLIENT_SECRET` | ✅ | Strava App Secret |
| `STRAVA_REFRESH_TOKEN` | ✅ | OAuth refresh token（需 `activity:read_all` scope） |
| `STRAVA_ATHLETE_ID` | ✅ | 自己的 athlete ID |
| `FETCH_ALL` | ⬜ | `=1` 拉全史；省略則只拉最近 100 筆 |
| `SCAN_SEGMENTS` | ⬜ | `=1` 對全史 ride 掃 ITT segment efforts |
| `SCAN_POWER` | ⬜ | `=1` 重掃功率 PR（會搭配全量活動，避免只掃最近 100 筆） |
| `POWER_ONLY` | ⬜ | `=1` 只更新功率 PR，跳過 laps/segments enrichment |
| `REFRESH_LAPS` | ⬜ | `=1` 忽略 lap 快取重新抓 |
| `LAP_FETCH_MAX` | ⬜ | 單次最多打多少 detail call（預設 30，避 rate limit） |

#### Strava API rate limit
- **100 requests / 15 min**, **1000 / day**（讀取類）
- 全史掃描 263 筆活動 ≈ 263 detail calls → 必須分批 + `setTimeout(400ms)` 節流
- 全量首跑建議分兩次：先 `FETCH_ALL=1` 拉清單，等 15 分後再 `SCAN_SEGMENTS=1` 掃 segment

#### 前端讀取
- 6 個主題（[strava.html](strava.html) / [strava_aespa.html](strava_aespa.html) / [strava_cs.html](strava_cs.html) / [strava_maple.html](strava_maple.html) / [strava_lol.html](strava_lol.html) / [strava_halo.html](strava_halo.html)）共用同一份 `strava.json`
- 純 `fetch()` + 字串模板渲染，無框架、無 build step
- 每張活動卡右上角 `↗` 直連 `https://www.strava.com/activities/{id}`
- ITT 區段表格點任一列 → 自動切到「全部」tab + 展開 Show More + 捲動高亮對應活動

#### 本機快速測試

```powershell
# 1. 建 scripts/.env（複製 4 個 secret）
# 2. 連線測試
.\scripts\test-strava-api.ps1                       # 看 token + 最近 10 筆
.\scripts\test-strava-api.ps1 -ActivityId 12345678  # 看單筆 lap

# 3. 跑同步（本機寫 strava.json）
node scripts/fetch-strava.js                                    # 增量
$env:FETCH_ALL="1"; $env:SCAN_SEGMENTS="1"; node scripts/fetch-strava.js  # 全量
$env:FETCH_ALL="1"; $env:SCAN_SEGMENTS="1"; $env:SCAN_POWER="1"; node scripts/fetch-strava.js  # 全量含功率 PR
$env:SCAN_POWER="1"; $env:POWER_ONLY="1"; node scripts/fetch-strava.js  # 只補功率 PR（建議日常補全）

# 4. 單獨重掃功率 PR（快取清乾淨）
rm -f power-prs.json power-prs-cache.json && $env:SCAN_POWER="1"; node scripts/fetch-strava.js
```

#### 手動觸發 GitHub Actions
**GitHub repo → Actions → Strava Daily Sync → Run workflow**

---

## 資料檔結構

| 檔案 | 角色 | 誰維護 |
|------|------|--------|
| `data/strava.json` | 主資料：stats / 活動清單 / ITT segments / 功率 PR | 自動 |
| `data/itt-segments.json` | ITT 努力紀錄備份 | 自動 |
| `data/power-prs.json` | 功率 PR 快取 | 自動 |
| **`data/itt-config.json`** | **ITT 路段設定（中文名、類型、顏色）** | **手動** |

---

## 本機開發

不需要安裝任何套件，直接用 VS Code Live Server 或：

```bash
# 用 Python 起一個 static server
python -m http.server 8080
```

開啟 http://localhost:8080/linkTreeIndex.html
