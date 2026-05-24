---
name: linktree-itt-config
description: 'Use when working on ITT segment cards in strava.html, adding new Strava segments, editing itt-config.json, or modifying fetch-strava.js segment logic. Covers the config-driven segment system, SEG_META loading, elevation fields, and status scoring.'
---

# LinkTree · ITT Segment Config System

## 架構概覽

ITT 路段資料分三層：

| 檔案 | 角色 | 誰維護 |
|------|------|--------|
| `data/itt-config.json` | 路段「設定」（中文名、類型、顏色） | **手動維護**，新增路段改這裡 |
| `data/itt-segments.json` | 路段「成績」（每次努力的時間/功率/HR） | fetch-strava.js 自動寫入 |
| `data/strava.json` | 主資料，`segments` 欄位同步自 itt-segments.json | fetch-strava.js 自動寫入 |

---

## 新增一個 ITT 路段

### 唯一需要改的檔案：`data/itt-config.json`

```json
{
  "segments": [
    {
      "id": 641218,
      "nameZh": "風櫃嘴",
      "nameApi": "風櫃嘴ITT",
      "type": "CLIMB",
      "accent": "#e87c1a",
      "note": "選填說明"
    },
    {
      "id": 新路段ID,
      "nameZh": "路段中文名",
      "nameApi": "Strava API 顯示名稱（可省略）",
      "type": "CLIMB",
      "accent": "#4ab4ff"
    }
  ]
}
```

**`type` 可選值：** `CLIMB` / `SPRINT` / `ENDURANCE`

**如何找 Segment ID：** 在 Strava 網頁開啟路段，URL 中的數字就是 ID  
`https://www.strava.com/segments/`**`641218`**

### 加完後重新同步

```powershell
# 本機
$env:FETCH_ALL="1"; $env:SCAN_SEGMENTS="1"; node scripts/fetch-strava.js

# 或在 GitHub Actions 手動觸發，勾選「全量抓取」
```

`strava.html` 不需要改，會自動顯示新路段。

---

## 程式碼如何讀取 config

### fetch-strava.js

```js
// 啟動時讀取（約 line 138）
const ittConfig = JSON.parse(fs.readFileSync(ITT_CONFIG_FILE, 'utf8'))
const SEGMENT_IDS = new Set(ittConfig.segments.map(s => s.id))
const SEGMENT_CUSTOM_NAMES = Object.fromEntries(
  ittConfig.segments.filter(s => s.nameApi).map(s => [s.id, s.nameApi])
)
```

### strava.html

```js
// fetch 時同時載入 config（接近檔案結尾）
Promise.all([
  fetch('data/strava.json').then(r => r.json()),
  fetch('data/itt-config.json').then(r => r.json()),
]).then(([data, ittConfig]) => {
  window._ittSegMeta = Object.fromEntries(ittConfig.segments.map(s => [s.id, s]))
  render(data)
  ...
})

// renderSegments 內（約 line 1087）
const SEG_META = window._ittSegMeta || {}
// meta.nameZh / meta.type / meta.accent 直接使用
```

---

## Segment 資料欄位（itt-segments.json）

```json
{
  "id": 641218,
  "name": "風櫃嘴ITT",
  "distance_km": 6.13,
  "pr_time_str": "28:29",
  "elevation_gain_m": 340,
  "average_grade": 5.5,
  "kom_elapsed_sec": 983,
  "efforts": [
    {
      "activity_id": 16143867118,
      "date": "2025-10-15",
      "elapsed_sec": 1820,
      "elapsed_str": "30:20",
      "avg_watts": 241,
      "avg_heartrate": 170,
      "is_pr": false
    }
  ]
}
```

`elevation_gain_m` 和 `average_grade` 由 `fetchSegmentInfo()` 從 `/api/v3/segments/{id}` 撈取並存入。

---

## Status System V2（卡片狀態計算）

### PeakBenchmark 邏輯

```
1. 優先取 90 天內有功率的 efforts，依瓦數排序前 5
2. 若 90 天內 < 3 筆 → 改用全時間前 5
3. 若全時間也 < 3 筆 → hasBench = false，顯示 NO BENCHMARK
peakAvgPow  = 前 5 筆平均瓦數
peakAvgTime = 前 5 筆平均秒數
```

### segmentScore 公式

```
powerScore   = latestWatts / peakAvgPow
timeScore    = peakAvgTime / latestElapsedSec
segmentScore = powerScore × 0.7 + timeScore × 0.3
```

### 狀態判斷優先順序（第一個符合即生效）

| 優先 | 條件 | 狀態 |
|------|------|------|
| 1 | attempts === 1 | 🆕 NEW |
| 2 | latest === PR（非首次） | 🚀 BREAKTHROUGH |
| 3 | 最近 3 次連續進步 AND segScore ≥ 0.88 | 🔥 HEATING UP |
| 4 | 最新紀錄無功率資料 | 💀 UNTOUCHED |
| 5 | daysSinceLast > 45 OR segScore < 0.88 | 💀 UNTOUCHED |
| 6 | segScore ≥ 0.99 | 🔥 PEAK |
| 7 | segScore ≥ 0.96 | ⚡ RISING |
| 8 | segScore ≥ 0.92 | ➖ HOLD |
| 9 | else | 📉 DECLINING |

---

## 卡片 HTML 結構（renderSegments，約 line 1207）

```html
<div class="s2-card" style="--s2-accent:{accent};--s2-status-color:{statusCol}">
  <div class="s2-hd">
    <span class="s2-num">{numBadge}</span>
    <span class="s2-kom-hd">{komGapHtml}</span>   <!-- +12:06 TO KOM -->
    <span class="s2-type-tag">{meta.type}</span>
  </div>
  <div class="s2-namblk">
    <div class="s2-name-zh">{meta.nameZh}</div>
  </div>
  <div class="s2-timblk">
    <div class="s2-best-time">{pr_time_str}</div>
    <div class="s2-time-lbl">BEST TIME</div>
    <div class="s2-status-block">
      <div class="s2-status-line">{statusEmoji} {statusLine}</div>
      <div class="s2-status-sub">{scoreDisplay} · {statusSub}</div>
    </div>
  </div>
  <!-- AVG POWER / W/KG row ... -->
  <!-- bottom row: VS PEAK benchmark / REVIEW button -->
</div>
```

---

## ITT Info Popup（4 tab 按鈕）

按鈕在 section title 下方（約 line 1251）：

```html
<div class="itt-tabs">
  <button class="itt-tab-btn" onclick="toggleIttLevel(this,'status')">📋 狀態一覽</button>
  <button class="itt-tab-btn" onclick="toggleIttLevel(this,'calc')">⚙️ 計算方式</button>
  <button class="itt-tab-btn" onclick="toggleIttLevel(this,'flow')">🔀 判斷流程</button>
  <button class="itt-tab-btn" onclick="toggleIttLevel(this,'example')">📊 範例</button>
</div>
```

Popup 內容在 `<div id="itt-level-popup">` 裡，每個 panel 用 `data-panel="status|calc|flow|example"`。  
JS 函式：`toggleIttLevel(btn, panelId)` / `closeIttLevel()` / `_ittOutside(e)`。
