# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**主要使用者：Steve Chuang 本人**，作為自己的訓練管理工具。日常情境是運動結束後或訓練規劃時打開，查看 ITT 路段狀態、功率 PR、月度達標進度、本週任務。資訊密度就是價值 —— 他認得每一個縮寫，不需要被解釋。

**次要對象：專業訪客與招募方。** 站台入口是 `linkTreeIndex.html`（含 Resume SPA 內頁、社群連結），Strava 儀表板同時扮演「這個人很認真」的佐證。使用者確認優先序是**自己優先**，但關鍵數字必須具備自我解釋能力 —— 不能出現只有作者看得懂的裸數字。`strava.html` 已內建 segScore 的說明彈窗（`#itt-level-popup`，四個分頁講解狀態、計算方式、判斷流程、實例），這個模式是正確方向，應延續。

**非目標對象：fork 自用者。** README 有完整的六步串接教學，但使用者未將其列為主要對象。教學保持正確即可，不需要為它投入設計工作。

## Product Purpose

把 Strava 的原始活動紀錄，轉成一份**可以拿來做訓練決策**的儀表板。Strava 官方能回答「我做了什麼」，這個站要回答「我現在狀態如何、離目標還有多遠、哪個路段該去挑戰了」。

成功的定義：使用者打開頁面後，不需要再去 Strava 或試算表補算，就能決定下一次訓練要做什麼。

## Positioning

**零後端全自動資料管線。**（使用者確認）

GitHub Actions 一天三次（台灣時間 10:00 / 18:00 / 22:00）用 OAuth refresh token 抓 Strava、在 CI 內完成所有運算、把結果 commit 回 repo，GitHub Pages 直接靜態供檔。**沒有伺服器、沒有資料庫、沒有 build step，卻是全自動的。**

關鍵推論：**前端永遠不直接呼叫 Strava API**，它只讀 repo 裡那份已 commit 的 JSON。這代表資料新鮮度上限是最近一次 cron，而非即時 —— 任何「即時同步」的設計暗示都是錯的，未來工作不得製造這種期待。

## Operating Context

- **部署**：GitHub Pages，`https://chenhan20.github.io/linkTree/linkTreeIndex.html`
- **資料流**：`refresh_token → access_token` → 抓 stats／activities → CI 內建構 `monthly_summary` / `goals` / `quest` / `power_prs` / `segments` → 寫 `data/strava.json` + `data/itt-segments.json` → commit/push → Pages CDN → 前端 `fetch()` 渲染
- **手動觸發**：GitHub repo → Actions → Strava Daily Sync → Run workflow；或本機 `node scripts/fetch-strava.js` 搭配 `FETCH_ALL` / `SCAN_SEGMENTS` / `SCAN_POWER` / `POWER_ONLY` 等環境變數
- **手動維護的唯一資料檔**：`data/itt-config.json`（ITT 路段的中文名、類型、代表色）。其餘 `data/*.json` 皆為自動產生，不得手改。
- **本機開發**：`python -m http.server`，無需安裝套件。專案 `.claude/launch.json` 已設定 port 4173。

## Capabilities and Constraints

### 已確認功能
- 年度／全時間總覽（里程、爬升、次數、時數）
- 功率 PR：5s / 10s / 30s / 1m / 2m / 5m / 10m / 20m / 60m
- 月度里程／爬升／時數長條圖，含 TSS 與月增減百分比
- 活動紀錄分頁：單車 / 跑步 / 游泳 / 重訓
- ITT 路段計時與狀態評分、3D 軌跡回放、OSM 台北市界小地圖、對手 PK 面板、每日一句

### 術語（使用者的既有詞彙，不得改寫）
ITT、segScore、FTP、TSS、PR、以及狀態詞 NEW / BREAKTHROUGH / HEATING UP / UNTOUCHED / PEAK / RISING / HOLD / DECLINING。

`segScore = powerScore × 0.7 + timeScore × 0.3`，基準線優先取 90 天內功率前 5 名平均（標示 TOP5 AVG），不足 3 筆改用全時間（ALL-TIME AVG），再不足則 NO BENCHMARK。

### 技術限制
- **無 build step。** 純 HTML/CSS/JS，CSS 與 JS 全部 inline 在單一檔案（`strava.html` 4,997 行）。任何打包工具或拆檔重構都會破壞部署模型。
- **無後端、無資料庫。** 所有運算必須在 CI 或瀏覽器端完成。
- **Strava API rate limit**：讀取類 100 requests / 15 min、1000 / day。全史掃描需分批節流（`setTimeout(400ms)`、`LAP_FETCH_MAX` 預設 30）。
- **`vendor-three-r128.js`（630 KB）為第三方 minified 程式碼**，非自撰，不列入品質稽核範圍。

### 資料完整性（2026-07-26 實測，未來工作必須處理缺值）
`recent_rides` 共 **133 筆**，其中 **24 筆無功率、29 筆無心率、19 筆無 route_stream**（爬升 133 筆全有）。其他：runs 37、swims 28、weights 108、segments 6、power_prs 9、monthly_history 16 個月。

**任何顯示功率、心率或 3D 軌跡的元件都必須有明確的缺值狀態**，不得以 0 或空白呈現 —— 現有的 `💀 UNTOUCHED · NO POWER DATA` 與「此路線尚無高度資料」標籤是正確做法。

### 已決定的產品變更
**六主題切換器收掉，只保留橘色版**（使用者於 2026-07-26 確認）。`strava_aespa` / `maple` / `cs` / `lol` / `halo` 五個變體最後更新於 2026-05-04，缺 3D 回放、每日一句、對手 PK，切過去等同掉進舊版產品。切換器 UI 應從 `strava.html` 移除；舊檔可留在 repo 但不再連結。

### 明確未決
- `strava_opus5_max.html`（"TELEMETRY // OPUS MAX"，2,070 行，未追蹤）是另一套設計語言的實驗，擁有 22 個 CSS 變數的完整 token 系統，但缺 3D 回放與每日一句。**目前不列入維護範圍**，其 token 系統是否回收進 `strava.html` 未定。
- `motionworld/`、`linkTreeIndex_1.html`、`linkTreeIndex_lab.html` 的去留未討論。

## Brand Commitments

- **名稱**：SteveChuang · Personal Hub
- **語言**：繁體中文（`zh-TW`）為主，搭配英文大寫標籤作為次級資訊層（如 `SEGMENT EFFORTS`、`ALL STATUS TABLE`）。此雙語混排是既有慣例，非疏漏。
- **主題**：README 自述為「太空主題」，`linkTreeIndex.html` 與 `strava.html` 皆有 canvas 星空／流星／粒子動畫。此為既有身分，非本次可自由更換的裝飾。
- **既有資產**：`docs/avatar.jpg`、`docs/space_bg.png`、`docs/strava_icon.png`、`logo.ico`
- **對外連結**：Instagram、Facebook、YouTube、Strava、LinkedIn、GitHub

## Evidence on Hand

**真實資料，全部可用：**
- `data/strava.json`（1.8 MB）— 主資料，自動更新
- `data/itt-segments.json`、`data/power-prs.json`、`data/segment-streams.json` — 自動
- `data/itt-config.json` — 手動維護的 ITT 路段設定
- `data/rivals.json`、`data/landmarks.json`、`data/taipei-outline.json`（OSM 台北市界＋淡水河／基隆河）
- `data/life-quotes.json`、`data/movie-life-quotes.json` — 每日一句語錄庫
- `athlete/` — 使用者的教練前提資料：`基本資料.json`、`游泳能力資料.json`、`跑步能力資料.json`、`公路車-功率區段最高紀錄.json`、`gpt_教練前提資訊.json`
- `docs/strava-*.png` — 既有頁面截圖；`docs/strava-goals-prd.md` — 月度目標與紀律追蹤的 PRD（v1 已完成、v2 規劃中）
- `docs/data-flow.md` — 完整資料流程圖

**不得虛構：** 這是單一使用者的個人站，**沒有**客戶、推薦語、使用者數、營收、定價、團隊或合作案例。任何「使用者好評」「多少人在用」類型的內容都是捏造。

## Product Principles

1. **資料誠實優先於畫面完整。** 133 筆騎乘裡有 24 筆沒功率。缺值要說出來，不要補零、不要留白假裝正常。
2. **前端不即時。** 資料新鮮度上限是最近一次 cron。不做、也不暗示即時同步。
3. **密度是給自己的，解釋是給訪客的。** 主要使用者認得所有縮寫；但任何關鍵評分都要有可點開的說明入口 —— `#itt-level-popup` 是既有正解。
4. **零依賴是特性，不是限制。** 無 build step、無後端、無框架是這個專案的定位本身。任何改動若需要引入建置流程，就是走錯方向。
5. **一份資料，一個前端。** 六份分岔檔案的維護模式已證明失敗（五個變體落後三個月）。未來的變化性靠 token 表達，不靠複製檔案。

## Accessibility & Inclusion

使用者未提出外部法規或客戶要求的無障礙標準。**WCAG 2.1 AA 為本專案自訂的修補基準**，來自 2026-07-26 的技術稽核，該次稽核在 `strava.html` 實測出 187 個文字節點對比度不足、零地標元素、90/100 觸控目標小於 44px。

已確認的既有優勢應予保留：`prefers-reduced-motion` 在三個檔案中有十個針對性區塊，且皆保留動畫終態（而非一刀切關閉），這是超出一般水準的處理，不得在後續工作中被簡化掉。
