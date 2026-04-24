# PRD: Strava Dashboard Monthly Goals & Consistency Upgrade

## 文件資訊
- **文件名稱**: Strava Dashboard Monthly Goals & Consistency Upgrade
- **文件類型**: Product Requirements Document (PRD)
- **適用頁面**: `strava.html`, `strava_aespa.html`
- **相關資料來源**: `strava.json`, GitHub Actions / Strava data sync script
- **版本**: v2 (含 System Monitor Edition 增補)
- **狀態**: v1 已完成 ✅ / v2 Planning

---

## 1. 背景與目的

目前 Strava 頁面主要扮演「活動紀錄展示」的角色，能夠呈現：
- 年度與累積 summary
- 月度里程圖表
- 活動紀錄 timeline

但從訓練管理角度來看，現有頁面缺少「目標追蹤」能力。使用者希望這個 dashboard 不只是回顧過去，而是能夠提供：
- 本月四大訓練項目的量化進度
- 本月最低訓練頻率是否達標
- 本週任務是否完成
- 更直觀、無歧義的活動時間顯示方式

本次升級的目的是將頁面從單純的紀錄展示頁，提升為具備「月度目標追蹤」與「訓練紀律管理」能力的 dashboard。

---

## 2. Product Goal

將 Strava Dashboard 升級為一個同時具備以下能力的訓練儀表板：

1. **月度訓練量總覽**
   - 直接顯示本月單車、跑步、游泳、重訓的核心數據
2. **月度訓練紀律追蹤**
   - 以每月 4 次作為最低訓練目標，追蹤各項運動的達成狀態
3. **每週任務檢查**
   - 顯示當週四個訓練項目是否至少完成一次
4. **改善活動時間顯示**
   - 避免 `1:00` 這種有歧義的格式，改為明確顯示小時/分鐘

---

## 3. Scope

### In Scope
- 更新 `strava.json` 資料結構，新增 monthly summary / monthly goals / weekly quest 欄位
- 更新 `strava.html` 畫面排版
- 更新 `strava_aespa.html` 畫面排版
- 調整 activity duration 顯示邏輯
- 讓兩種風格頁面共用相同資料邏輯，但保有不同視覺樣式

### Out of Scope
- 新增後端服務
- 改變 Strava 原始抓取機制
- 使用者自訂目標次數（例如從 4 改成 5）
- 新增管理後台
- 即時同步（Real-time sync）

---

## 4. User Problem Statement

使用者目前在頁面上可以看到很多歷史活動資料，但無法快速回答以下問題：
- 我這個月單車到底累積了多少公里？
- 我這個月跑步 / 游泳 / 重訓有沒有達到最低頻率？
- 我這週還缺哪一項訓練沒做？
- 活動時間顯示的 `1:00` 到底是一小時還是一分鐘？

這些資訊對於持續訓練與維持紀律非常重要，因此需要在頁面中被更清楚地呈現。

---

## 5. Target User

### Primary User
- 專案本人（Steve）
- 有持續三鐵 / 多項運動訓練需求的使用者
- 希望透過 dashboard 快速掌握本月 / 本週訓練狀態的人

### Secondary User
- 查看此頁面的朋友或訪客
- 想快速理解訓練狀態的人

---

## 6. Functional Requirements

> ✅ v1 (FR-1 ~ FR-4) 已於 commit `2957a4d` 完成並推上 master。

### FR-1: 月度 summary 改為四大運動主指標 ✅

頁面最上方 summary 卡片需改為顯示四個運動項目的本月數據：

- 🚴 單車：本月累計 `XX 公里`
- 🏃 跑步：本月累計 `XX 公里`
- 🏊 游泳：本月累計 `XX 公尺`
- 🏋️ 重訓：本月累計 `XX 次`

#### Requirement details
- 單車單位固定為 `km`
- 跑步單位固定為 `km`
- 游泳單位固定為 `m`
- 重訓單位固定為 `count` / `次`
- 資料區間為「當月 1 號 00:00 至最新同步資料時間」

#### Purpose
讓使用者一進頁面就能知道本月四個訓練項目的累積量。

---

### FR-2: 新增 Monthly Consistency 區塊 ✅

在月度 summary 區塊下方新增 **Monthly Consistency** 區塊。

#### 顯示內容
每個運動項目顯示：
- icon / 名稱
- 本月次數 / 4
- progress bar
- status badge

#### 四個運動項目
- 🚴 單車
- 🏃 跑步
- 🏊 游泳
- 🏋️ 重訓

#### Status 規則
依達成比例計算：
- `< 50%` → `danger` → 顯示「🔴 嚴重落後」
- `50% ~ 99%` → `warning` → 顯示「🟡 近期需補課」
- `100% ~ 149%` → `done` → 顯示「🟢 達標」
- `>= 150%` → `over` → 顯示「🔥 超標」

#### Default Target
- 每個項目的 monthly target 預設為 `4`

#### Purpose
提供每月訓練頻率最低標的追蹤能力。

---

### FR-3: 新增 Weekly Quest 區塊 ✅

在 Monthly Consistency 下方新增 **Weekly Quest** 區塊。

#### 顯示內容
- ⬜ / ✅ 🚴 單車
- ⬜ / ✅ 🏃 跑步
- ⬜ / ✅ 🏊 游泳
- ⬜ / ✅ 🏋️ 重訓

#### 判定方式
- 計算區間：本週一 00:00 到 `updated_at`
- 該區間內若某運動至少出現一次，即標記為 `true / ✅`
- 否則為 `false / ⬜`

#### Purpose
提供「本週任務清單」視角，強化訓練完成感與紀律感。

---

### FR-4: 修正活動 duration 顯示規則 ✅

目前 activity 顯示中的 `moving_time_hr` 會被格式化為 `1:00` 之類的字串，容易產生歧義。

#### 新規則
所有頁面統一使用明確文字顯示：
- 小於 1 小時：`XX 分`
- 等於 1 小時：`1 小時`
- 大於 1 小時：`X 小時 Y 分`

#### 範例
- `0.3` → `18 分`
- `1.0` → `1 小時`
- `1.5` → `1 小時 30 分`
- `2.2` → `2 小時 12 分`

#### Requirement details
- 前端應避免再顯示 `1:00` 這種可被誤解的格式
- 兩個 Strava 主題頁都必須一致

---

## 7. Data Requirements

### 7.1 現況
目前 `strava.json` 主要包含：
- `updated_at`
- `summary`
- `recent_rides`
- `recent_runs`
- `recent_swims`
- `recent_weights`
- `monthly_history`

### 7.2 需新增欄位

```json
{
  "monthly_summary": {
    "ride_km": 180.51,
    "run_km": 25.06,
    "swim_m": 6830,
    "weight_count": 11
  },
  "monthly_goals": {
    "ride": { "count": 3, "target": 4, "status": "warning" },
    "run": { "count": 5, "target": 4, "status": "done" },
    "swim": { "count": 2, "target": 4, "status": "danger" },
    "weight": { "count": 8, "target": 4, "status": "over" }
  },
  "weekly_quest": {
    "ride": false,
    "run": true,
    "swim": false,
    "weight": true
  }
}
```

### 7.3 Data calculation rules

#### monthly_summary
- `ride_km`: 本月單車累積公里
- `run_km`: 本月跑步累積公里
- `swim_m`: 本月游泳累積公尺（km × 1000 或直接用 meter）
- `weight_count`: 本月重訓活動次數

#### monthly_goals
- `count`: 本月該活動總次數
- `target`: 固定為 4
- `status`: 根據 count / target 計算

#### weekly_quest
- 以布林值表達當週是否完成至少一次該項訓練

---

## 8. UX / UI Requirements

### Layout order
頁面資訊層級建議如下：

1. Hero
2. 月度 summary（四大運動主指標）
3. Monthly Consistency
4. Weekly Quest
5. 月度里程圖表
6. 活動紀錄
7. 總累積 summary / CTA / footer

### Visual principles
- 資料密度增加，但仍需保持一眼可讀
- Monthly summary 與 Monthly Consistency 應明顯區分
- Weekly Quest 應輕量、直覺、可快速掃讀
- 兩個主題頁保留相同資訊結構，但樣式可不同：
  - `strava.html`：太空 / 橘色風格
  - `strava_aespa.html`：紫色 / glassmorphism / aespa 風格

---

## 9. Non-Functional Requirements

- 前端仍為純靜態頁面，可透過 GitHub Pages 部署
- 所有新增資料需來自既有 GitHub Actions / script 產出的 `strava.json`
- 前端不應在 runtime 再做大量複雜聚合計算
- 頁面必須維持手機可讀性
- 若新欄位不存在，前端需具備基本 fallback 顯示能力（避免整頁失敗）

---

## 10. Success Criteria

若功能完成，使用者應能在 5 秒內回答以下問題：
- 我這個月單車騎了多少公里？
- 我這個月跑步有沒有達到 4 次？
- 我這週還缺哪個項目沒完成？
- 某次活動的 duration 到底是幾小時幾分鐘？

---

## 11. Open Questions

> ✅ v1 關鍵項目已決定：
> 1. 單車包含 `VirtualRide` / 飛輪 ✅
> 2. 重訓只統計 activity count ✅
> 3. 游泳 summary 固定顯示 `m`，不自動轉 km ✅
> 4. Weekly Quest 包含重訓 ✅
> 5. monthly target 固定 4，不做可設定值 ✅

---

## 12. Implementation Recommendation

### Recommended approach
採用 **方案二**：
由資料產生流程直接把 monthly summary / monthly goals / weekly quest 計算好並寫入 `strava.json`，前端只負責渲染。

### Why
- 邏輯集中
- 前端簡潔
- 更容易維護
- 更容易在不同主題頁共用
- 未來擴充指標時也比較一致

---

## 13. Suggested Next Steps

> ✅ v1 已完成（commit `2957a4d`）。以下原始步驟供歷史參考：

1. 確認 open questions ✅
2. 更新資料同步腳本 / workflow 輸出 `strava.json` ✅
3. 更新 `strava.html` ✅
4. 更新 `strava_aespa.html` ✅
5. 修正 duration formatter ✅
6. 驗證 desktop / mobile 版面 ✅（待使用者實際驗收）

---

# 📡 Addendum v2 — System Monitor Edition (三鐵訓練監控儀表板)

> 本章節為 Gemini 提案版本之整合，將 v1 的「月度目標」延伸為「系統級監控儀表板 (System Monitor)」。新增功能與 v1 不衝突，視為 v1 的 superset。

## A1. 專案背景與目標 (Context & Objective)

- **使用者 Persona**: 資深 Java 後端工程師、備戰 113km 半程鐵人三項的業餘運動員、新手爸爸。需要兼顧工作、高額房貸與育兒壓力。
- **目標**: 將現有的 Strava 靜態展示頁，升級為具備「目標追蹤 (Goal Tracking)」、「疲勞預警 (Fatigue Warning)」與「精準數據萃取 (Data Extraction)」的系統級監控儀表板。
- **核心痛點**:
  1. 無法快速看出當月四項主要運動 (單車、跑步、游泳、重訓) 的紀律達標率。
  2. 單次活動的「平均數據」會被暖身 / 緩和稀釋，無法反映主課表真實強度。
  3. 時間格式 (如 `1:00`) 容易產生歧義。
  4. 缺乏整體系統的疲勞度 (System Load) 監控。

---

## A2. 新增 / 強化功能需求 (Functional Requirements v2)

### FR-V2-1: 月度目標與紀律追蹤 (Monthly SLA)
> 對應 v1 FR-2，僅微調命名與燈號文案，**狀態值定義對齊如下**：

- **指標項目**: 🚴 單車 (含 `VirtualRide` 飛輪)、🏃 跑步、🏊 游泳、🏋️ 重訓
- **目標設定**: 每項預設 `4 次/月`
- **狀態燈號 (count / target)**:
  - `< 50%` → 🔴 嚴重落後 (`danger`)
  - `50% ~ 99%` → 🟡 近期需補課 (`warning`)
  - `100% ~ 149%` → 🟢 達標 (`success` / 對應 v1 `done`)
  - `>= 150%` → 🔥 超標運作 (`over`)

> ⚠️ 命名對齊決策：JSON `status` 欄位以 v1 既有為準（`danger` / `warning` / `done` / `over`），若採 Gemini 命名 `success`，需於資料同步階段做 alias 對應。

### FR-V2-2: 本週任務清單 (Weekly Quest)
> 與 v1 FR-3 相同；保留 ✅ / ⬜ Checkbox 視角，計算區間為「本週一 00:00 → 當前時間」。

### FR-V2-3: 系統負載監控 (7-Day System Load) 🆕
使用 Strava API 的 `suffer_score` (心率相對努力積分) 作為系統壓力指標，置於 Hero 下方明顯位置。

- **計算方式**: 加總過去 7 天內所有活動的 `suffer_score`
- **燈號邏輯**:
  - `< 200` → 🟢 系統穩定 (`idle`)
  - `200 ~ 400` → 🟡 高負載 (`warning`)
  - `> 400` → 🔴 降頻保護中 (`overloaded`)

### FR-V2-4: 時間格式無歧義化 (Duration Formatting)
> 與 v1 FR-4 完全一致，作為強制驗收條件：禁止任何頁面渲染 `1:00` 這種格式。

### FR-V2-5: 活動日誌進階渲染 (Activity Log Upgrade) 🆕
將活動列表升級為「膠囊標籤 (Pill Tags)」風格，並具備以下能力：

1. **外部跳轉**
   - 活動名稱包 `<a>`，連結至 `https://www.strava.com/activities/{id}`
   - 在新分頁開啟（`target="_blank" rel="noopener"`）

2. **單次疲勞燈號**
   - 依該活動 `suffer_score` 標示 Emoji：
     - `> 70` → 🔴
     - `30 ~ 70` → 🟡
     - `< 30` → 🟢

3. **主課表自動擷取 (Lap Extraction)**
   - 適用 Type：`Ride` / `VirtualRide` / `Run`
   - 從 `laps` 陣列中找出：`average_heartrate` 最高且 `moving_time > 5 分鐘` 的 Lap
   - 在該活動卡片下方縮排顯示：Lap 名稱 / 時間 / 心率 / 平均功率 (AP)

4. **AI 教練短評 (LLM Integration)**
   - 讀取 JSON 內 `ai_comment` 欄位
   - 顯示於活動卡片底部，視為可選欄位（缺失時不顯示區塊）

---

## A3. 資料結構契約 v2 (Data Schema Contract)

> 此為 v1 schema 的 superset，欄位皆為新增/可選；前端需具備 fallback 能力。

```json
{
  "system_load": {
    "7_day_suffer_score": 285,
    "status": "warning"
  },
  "monthly_summary": {
    "ride_km": 180.51,
    "run_km": 25.06,
    "swim_m": 6830,
    "weight_count": 11
  },
  "monthly_goals": {
    "ride":   { "count": 3, "target": 4, "status": "warning" },
    "run":    { "count": 5, "target": 4, "status": "done" },
    "swim":   { "count": 2, "target": 4, "status": "danger" },
    "weight": { "count": 8, "target": 4, "status": "over" }
  },
  "weekly_quest": {
    "ride": false,
    "run": true,
    "swim": false,
    "weight": true
  },
  "recent_activities": [
    {
      "id": 12345678,
      "name": "劍中劍菜單",
      "type": "Ride",
      "suffer_score": 85,
      "suffer_status": "danger",
      "moving_time_str": "1 小時 18 分",
      "distance_km": 23.44,
      "elevation_m": 532,
      "average_heartrate": 136,
      "main_lap": {
        "name": "Lap 2",
        "moving_time_str": "14 分 30 秒",
        "average_heartrate": 168,
        "average_watts": 245
      },
      "ai_comment": "🤖 輸出及格，但心率偏高，記得回家幫女兒換尿布收心。"
    }
  ]
}
```

---

## A4. v2 Layout 調整建議

更新後頁面層級（在 v1 基礎上插入 System Load 與升級活動卡片）：

1. Hero
2. **🆕 System Load Monitor (7-day suffer score)**
3. 月度 summary（四大運動主指標）
4. Monthly Consistency
5. Weekly Quest
6. 月度里程圖表
7. **活動紀錄（Pill Tags 升級版 + Main Lap + AI Comment）**
8. 總累積 summary / CTA / footer

---

## A5. v2 Open Questions

1. `suffer_score` 在 Strava API 為 Summit 功能，free tier 帳號是否一定有值？fallback 策略？
2. `ai_comment` 由誰產生？（GitHub Actions 內呼叫 LLM？手動填入？）成本與頻率限制？
3. Lap Extraction 對於沒有功率計的跑步活動，`average_watts` 應顯示為 `—` 還是隱藏？
4. 單次活動疲勞燈號是否要與 `system_load` 共用同一套門檻邏輯？
5. v2 status 命名（`success` vs v1 `done`）最終以何者為準？

---

## A6. v2 Suggested Next Steps

1. 確認 A5 open questions（特別是 `suffer_score` 與 `ai_comment` 的資料來源）
2. 擴充資料同步 script，輸出 `system_load` / `recent_activities[].suffer_*` / `main_lap` / `ai_comment`
3. 在 `strava.html` 與 `strava_aespa.html` 加入 System Load 卡片
4. 重構活動列表為 Pill Tags 元件（含外部連結、Emoji 燈號、Main Lap 縮排、AI 短評）
5. 加入 schema fallback 防呆，確保舊版 `strava.json` 不會讓頁面崩潰
6. desktop / mobile 雙版面驗收
