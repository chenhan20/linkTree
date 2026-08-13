# intervals.icu 除了原始 FIT 之外的可用資料盤點

研究日期:2026-08-13。athlete id:i673882。
方法:抓 https://intervals.icu/api-docs.html 取得 OpenAPI spec 真實路徑 `https://intervals.icu/api/v1/docs`(OpenAPI 3.0.1,117 條路徑,已存本地 `scratchpad/openapi.json`),逐一解析 schema;佐以官方論壇 guide 貼文(thread 609)與 wellness 功能頁。未持 API key,未打任何認證端點——所有「文件確認」指 spec/官方文件確認,非實際回應驗證。

認證與共通事項(文件確認):basic auth,帳號字面量 `API_KEY`、密碼為 key(與 repo 現行 sync-intervals.py 相同);rate limit 5000/日、2500/滾動15分、10/秒/IP,回應帶 `X-RateLimit-Limit` / `X-RateLimit-Remaining`(格式 `<15m>,<daily>`),超限回 429 + `Retry-After`。多數 GET 支援 `fields=` 參數只取指定欄位並剔除 null,可大幅縮小回應。

---

## 1. Wellness(最大價值——HRV 目前手抄,可全自動化)

### 端點(文件確認,出自 OpenAPI spec)
- `GET /api/v1/athlete/{id}/wellness{ext}` — 日期範圍列表;`ext` 留空回 JSON、`.csv` 回 CSV。query:`oldest`、`newest`(ISO-8601 local date,皆 optional)、`cols`(CSV 欄選擇)、`fields`(JSON 欄選擇)。
- `GET /api/v1/athlete/{id}/wellness/{date}` — 單日記錄。
- 另有 PUT(單日/範圍)、`PUT /wellness-bulk`、`POST /wellness`(CSV 上傳)——若想把 athlete/ 手抄歷史回灌 intervals.icu 也做得到。

### Wellness schema 全欄位(文件確認,46 欄)
`id`(即日期)、`ctl`、`atl`、`rampRate`、`ctlLoad`、`atlLoad`、`sportInfo[]`(每筆 `{type, eftp, wPrime, pMax}` — 每日每運動的 eFTP 快照!)、`updated`、`weight`、`restingHR`、`hrv`(rMSSD)、`hrvSDNN`、`sleepSecs`、`sleepScore`、`sleepQuality`、`avgSleepingHR`、`spO2`、`respiration`、`readiness`、`steps`、`vo2max`、`restingHR`、`baevskySI`、`systolic/diastolic`、`bloodGlucose`、`lactate`、`bodyFat`、`abdomen`、`kcalConsumed`、`hydration`、`hydrationVolume`、主觀量表(`soreness/fatigue/stress/mood/motivation/injury`)、`menstrualPhase(Predicted)`、`carbohydrates/protein/fatTotal`、`comments`、`locked`、`tempWeight`、`tempRestingHR`。

### Garmin 自動餵哪些
- 文件確認(官方 wellness 功能頁):「Auto-sync from Garmin, Polar, Suunto, Coros, Huawei, Amazfit, Oura, WHOOP」,涵蓋 weight/sleep/HRV/readiness/SpO2 等。Athlete schema 也有 `icu_garmin_download_wellness`、`icu_garmin_wellness_keys`(哪些 wellness 欄位由 Garmin 餵是帳號層設定,key 清單存在 athlete 物件裡,可用 `GET /api/v1/athlete/{id}` 讀出自己實際啟用的清單)。
- 論壇佐證(用戶回報,接近文件確認):Garmin 正常會餵 `restingHR`、`hrv`(overnight HRV status)、`sleepScore`/sleep 相關、`steps`、卡路里、Body Battery、Training Readiness;手錶同步 Garmin Connect 後約 5 分鐘內到。
- 推測待驗:(a) Body Battery / Training Readiness 對應到 Wellness 哪個欄位(疑 `readiness`,或存自訂欄位);(b) `avgSleepingHR`/`spO2`/`respiration` 是否隨 Garmin 睡眠自動入庫(論壇有回報缺漏的 bug 討論,可能依裝置/授權 scope 而異);(c) 省略 `oldest` 時範圍預設值(可能全歷史,也可能有限)——拿到 key 後打一次 `wellness.csv` 即知;(d) 你的帳號實際啟用哪些 key,以 `GET /athlete/i673882` 的 `icu_garmin_wellness_keys` 為準。

### 能餵 repo 什麼
- `athlete/` 手抄 HRV 基線、體重 → 直接淘汰手抄:每天一次 `GET /athlete/i673882/wellness?oldest=<上次抓到>&fields=id,hrv,hrvSDNN,restingHR,sleepSecs,sleepScore,avgSleepingHR,weight,steps,readiness` 併入 sync-intervals.py。
- 單日報告可加「當日晨間狀態」區塊(HRV vs 基線、RHR、睡眠)——與現有「裝置原始數據」同層級的新素材。
- `sportInfo.eftp` 每日快照 → FTP 也不必手抄,還能畫 eFTP 趨勢線。

### 拉取成本
增量:1 call/日。全歷史回補:1 call(CSV 或大範圍 JSON)。對 5000/日毫無壓力。

---

## 2. 活動計算欄位(intervals.icu 已替你算好的東西)

### 2a. 活動摘要(training load、強度、區間時間)
- 端點:`GET /api/v1/athlete/{id}/activities?oldest=&newest=&fields=`(list,desc 順序;`oldest` 必填)或 `GET /api/v1/activity/{id}`(單筆)。文件確認。
- Activity schema 183 欄,關鍵欄位(文件確認):
  - 負荷/強度:`icu_training_load`、`icu_atl`、`icu_ctl`(該活動當下的 ATL/CTL!)、`icu_intensity`(≒IF)、`icu_weighted_avg_watts`(≒NP)、`trimp`、`power_load`/`hr_load`/`pace_load`、`session_rpe`、`strain_score`、`icu_efficiency_factor`、`decoupling`、`icu_variability_index`、`polarization_index`。
  - 區間時間:`icu_zone_times[]`(功率區間,`{id, secs}`)、`icu_hr_zone_times[]`、`pace_zone_times[]`、`gap_zone_times[]`、外加當時 zone 定義 `icu_power_zones`/`icu_hr_zones`、`icu_ftp`、`lthr`。→ 報告「強度分布」可直接用官方數字對帳或取代自算。
  - 功率模型(eFTP 家族):`icu_pm_cp`、`icu_pm_w_prime`、`icu_pm_p_max`、`icu_pm_ftp`(活動當時 power model 的 eFTP)、`icu_pm_ftp_secs/watts`(達成該 eFTP 的努力段)、`icu_rolling_ftp`、`icu_rolling_ftp_delta`、`ss_cp/ss_w_prime/ss_p_max`。
  - 裝置:`device_name`、`power_meter`、`power_meter_serial`、`power_meter_battery`、`crank_length`、`file_type`、`power_field_names` → 可補強報告「裝置原始數據」。
  - 其他有趣:`icu_joules_above_ftp`、`icu_max_wbal_depletion`(W'bal 最大耗盡)、`icu_hrr`(HR recovery)、`carbs_used`、`coasting_time`、天氣欄位(見第 6 節)。
- 成本:repo 既有的每日列活動 call 已經拿回這整包——加 `fields=` 反而更省。額外成本 0。

### 2b. eFTP / 功率模型
- `GET /api/v1/athlete/{id}/mmp-model?type=Ride` → PowerModel `{type, criticalPower, wPrime, pMax, ftp, inputPointIndexes}`(現行模型)。文件確認。
- eFTP 時間序列兩條路:Wellness `sportInfo`(第 1 節)或逐活動 `icu_pm_ftp`。文件確認。
- `GET /api/v1/athlete/{athleteId}/sport-settings` → 正式 FTP、zones、W'、Pmax、LTHR、max HR 設定值(手抄 FTP 的另一個替代源)。文件確認。
- 成本:各 1 call,偶爾拉即可。

### 2c. Power curve / MMP
- 單活動:`GET /api/v1/activity/{id}/power-curve{ext}`(`.csv` 可)→ PowerCurve:`secs[]`、`watts[]`、`watts_per_kg[]`、`submax_values[]`、以及 fitted `powerModels[]`;query `fatigue=kj0|kj1` 可拿疲勞後曲線。文件確認。
- 個人最佳(跨活動):`GET /api/v1/athlete/{id}/power-curves{ext}?type=Ride&curves=...`(預設近一年)→ DataCurveSet,每條曲線含 `secs[]`、`values[]`、`activity_id[]`(每個 duration 的 PB 出自哪筆活動)。文件確認;`curves` 參數的合法 token(如 `42d`、`1y`、`all`、season 代號)文件沒列舉——推測待驗,拿 key 打一次或看瀏覽器 devtools 即知。
- 範圍最佳:`GET /api/v1/athlete/{id}/activity-power-curves{ext}?oldest=&newest=&secs=5,60,300,1200` → 指定日期窗、指定 duration 的最佳功率。文件確認。
- 也有 hr-curve、pace-curve、power-histogram(`bucketSize` 預設 25W)、power-vs-hr、time-at-hr 同構端點。文件確認。
- 能餵 repo:報告「功率曲線 vs 個人最佳」現在大概是自己從 FIT 算——這裡兩條 call 就拿到官方版本(活動曲線 + PB 曲線含出處活動),還附 submax 與模型擬合。
- 成本:每份單日報告 +1~2 call;PB 曲線可日更 1 call 共用。

### 2d. 自動偵測 intervals
- `GET /api/v1/activity/{id}/intervals` → IntervalsDTO:`icu_intervals[]`(84 欄/段:`type`(WORK/RECOVERY)、`start_time/end_time`、`average_watts`、`weighted_average_watts`、`intensity`、`training_load`、`w5s_variability`、`wbal_start/wbal_end`、`decoupling`、`average_heartrate`、`average_cadence`、`zone`、`label`、`group_id`…)+ `icu_groups[]`(重複組彙總)。文件確認。
- 佐以 `GET /api/v1/activity/{id}/best-efforts?stream=watts&duration=...`(找活動內最佳努力段)、`PUT` 系列可改段(不需要)。
- 能餵 repo:單日報告可新增「課表段落自動拆解」表(每組 on/off 的實際功率/目標達成),比自己從 FIT 找 lap 可靠——intervals.icu 有自動偵測非 lap 的結構。
- 成本:每活動 +1 call。

---

## 3. CTL/ATL/TSB 體能曲線時間序列

- 直接答案:可以,而且就是第 1 節的 wellness 端點——每日一筆 `ctl`、`atl`、`rampRate`、`ctlLoad`/`atlLoad`(當日入帳的 load)。TSB 自己一減(`ctl - atl`,或用前一日值,口徑推測待驗:intervals.icu 圖上 form 用的是「昨日 CTL−ATL」還是當日,拿資料對一天即知)。文件確認(欄位存在)。
- 佐證:活動物件上的 `icu_ctl`/`icu_atl` 是活動時點快照,可交叉核對。
- `GET /api/v1/athlete/{id}/fitness-model-events` 列出影響 fitness 計算的事件(FITNESS_DAYS 改時間常數、SET_FITNESS 設起點、SET_EFTP)——想完全重現官方曲線時的必要輸入。文件確認。
- 能餵 repo:報告「四週訓練負荷」目前自己算——可改成(或對帳)官方 42/7 天 EWMA 序列,一次 call 拉 60 天 `fields=id,ctl,atl,ctlLoad,rampRate` 即可;總覽頁也能加 fitness 迷你圖。
- 成本:1 call/日(可與第 1 節同一個 call——同端點同 payload)。

---

## 4. 批次匯出(全歷史一次拉)

- `GET /api/v1/athlete/{id}/activities.csv` — 全部活動摘要 CSV,無日期參數=整個歷史,1 call。文件確認(官方 guide 的示範指令就是這條)。
- `GET /api/v1/athlete/{id}/wellness.csv`(即 wellness{ext} 帶 `.csv`,可加 `oldest/newest/cols`)— wellness 全歷史 1 call。文件確認。
- `POST /api/v1/athlete/{id}/download-fit-files` — 一個 zip 打包多活動的 intervals.icu 生成 FIT(非原始檔;原始檔仍是逐活動 `/activity/{id}/file`)。文件確認。
- `GET /api/v1/athlete/{id}/gear{ext}`、`GET /api/v1/athlete/{id}/events.csv`(行事曆/課表)同樣有 CSV。文件確認。
- 能餵 repo:初始化/校驗用——activities.csv 拿全史 `icu_training_load` 重建負荷曲線起點;wellness.csv 一次補齊 HRV/體重歷史取代 athlete/ 手抄檔的過去值。
- 成本:各 1 call,一次性。

---

## 5. Rate limit 總評(已知 5000/日、2500/15分、10/秒)

| 用途 | calls | 評估 |
|---|---|---|
| 每日增量:wellness(含 CTL/ATL/eFTP)| 1 | 可忽略 |
| 每日增量:activities 列表(現有 call,改加 fields)| 0 新增 | 可忽略 |
| 每份單日報告:intervals + power-curve(+PB 曲線)| 2~3 | 可忽略 |
| 一次性回補:activities.csv + wellness.csv | 2 | 可忽略 |
| 一次性回補:全部活動的 intervals/curve(N 筆活動)| 2N | N=1000 也只 2000 call,分兩個 15 分窗跑完;請守 10/秒 |
| 現行 FIT 抓檔 | 1+M | 不變 |

結論:所有新增資料面的成本都在額度的零頭;唯一要節流的是全歷史逐活動回補,batch 時 sleep 0.15s/call 即可。429 時看 `Retry-After`。

---

## 6. 加碼(順手盤到、價值次一級)

- 天氣:Activity 內建 `average_weather_temp`、`average_wind_speed/gust`、`headwind_percent`、`tailwind_percent`、`prevailing_wind_deg` 等欄位,另有 `GET /api/v1/activity/{id}/weather-summary`。單日報告可加「當日風況」一行。文件確認。
- 課表雙向:`GET/POST /api/v1/athlete/{id}/events(.csv)`、`POST /events/bulk` — repo 的好兄弟月四週課表可以推上 intervals.icu 行事曆(再由它推去 Garmin 裝置);反向也能拉計畫 vs 實際的 `compliance` 欄位(Activity.compliance,配對 `paired_event_id`)。文件確認(推 Garmin 裝置那段是 intervals.icu 產品功能,非 API spec 內容——推測待驗設定面)。
- 連線狀態:`GET /api/v1/athlete/{id}/connections` → `garmin_health_connected`/`garmin_training_connected` 等布林,sync 腳本可用來自我診斷「wellness 沒資料是斷線還是沒測」。文件確認。
- Streams:`GET /api/v1/activity/{id}/streams{ext}` 拿解析好的每秒串流(含 fixed 版),不用自己解 FIT;但 repo 已有 FIT 管線,價值低。文件確認。
- 段落/segments:`GET /api/v1/activity/{id}/segments`(intervals.icu 自家 segment effort)。與 repo 現行 Strava ITT effort 天然鍵體系是兩套 id,混用要小心。文件確認(端點),對接方式推測待驗。
- 每週/期間彙總:`GET /api/v1/athlete/{id}/athlete-summary{ext}` 回 `CategorySummary`(含 `training_load`、`eftp`、`eftpPerKg`、`distance`…)。參數細節未深挖——推測待驗。

---

## 建議落地順序(價值/成本比)

1. sync-intervals.py 加一支 wellness 增量抓取(1 call/日)→ 淘汰 athlete/ 手抄 HRV/體重/FTP,並順手拿到官方 CTL/ATL 序列(問題 1+3 一起解)。
2. 活動列表 call 加 `fields=`,把 `icu_training_load`、`icu_zone_times`、`icu_intensity`、`icu_pm_ftp`、裝置欄位存進 ride-meta → 報告「強度分布」「四週負荷」「裝置原始數據」有官方對帳源。
3. 報告生成時每活動加打 `/intervals` 與 `/power-curve.csv`,PB 曲線日更一份共用 → 「功率曲線 vs 個人最佳」升級。
4. 一次性:`activities.csv` + `wellness.csv` 回補全史。
5. 選配:課表推送 events/bulk、天氣一行、connections 自診斷。

## 待驗清單(拿到 API key 後各打一發即可)

- `icu_garmin_wellness_keys` 實際內容(你的帳號 Garmin 餵哪些欄位)。
- Body Battery / Training Readiness 落在哪個欄位。
- wellness 省略 `oldest` 的預設範圍。
- `power-curves` 的 `curves` 合法 token 清單。
- TSB 口徑(當日或前日 CTL−ATL)。
- athlete-summary 參數。

---

## 對抗驗證補正（2026-08-13，第二位 agent 逐項重驗後）

上面的盤點經獨立重驗（spec 逐位元組相同、117 端點逐一比對），以下修正與補充：

**可從待驗清單劃掉：**
- `power-curves` 的 `curves` token 其實就寫在 spec 的 operation description：
  `1y`/`2y`…、`42d`…、`s0`（本季）/`s1`（上季）、`all`、`r.YYYY-MM-DD.YYYY-MM-DD`
  日期區間，可加 `-kj0`/`-kj1` 後綴取疲勞後曲線，預設 last year。
  另注意 spec 把 `f1`/`f2`/`f3` 標成 required（疑為產生器瑕疵）——被 400 就補空值試。

**重大遺漏補充：**
- `GET /athlete/{id}/activities/{ids}?intervals=true` —— **批量**抓多筆活動含
  `icu_intervals`/`icu_groups`，全史回補 intervals 不必逐活動 N 個 call。
- `GET /activity/{id}/interval-stats?start_index=&end_index=` —— 對活動**任意時間切片**
  回官方 interval 級統計。這是 ITT effort（activity_id+start_time 天然鍵）對接
  intervals.icu 資料最乾淨的橋，比 segments 兩套 id 體系互配好走。
- 課表側整層 workout library / plan 機制：`POST /athlete/{id}/workouts`（原生
  description 或 zwo/mrc/erg/fit，含 `/bulk`）、`POST /folders`（建 plan）、
  `PUT /training-plan`、`PUT /apply-plan-changes`、`POST /duplicate-events|workouts`。
  可重複使用的四週課表模板走這層，不是 events/bulk。
- 課表匯出裝置可用檔：`GET /events/{eventId}/download{ext}` 與
  `POST /download-workout{ext}` 轉 `.fit`/`.zwo`/`.mrc`/`.erg`；Athlete schema 有
  `icu_garmin_upload_workouts`，events 參數描述直接提到 settings 的 Garmin 選項
  —— 課表推 Garmin 裝置**接近文件確認**，不是純推測。
- `GET /athlete/{id}/power-hr-curve?start=&end=`（必填區間）—— athlete 級跨期
  power-vs-HR，可做有氧體能趨勢區塊。
- 次要：`/activities/interval-search`（找歷史同型 interval）、`/activity/{id}/map`、
  `/athlete/{id}/routes` 與 route similarity（固定路線分組）、`/weather-forecast`。

**出處等級下修（結論不變、引用要小心）：**
- 「Auto-sync from Garmin/Polar/…/Oura/WHOOP」在 wellness 功能頁抓不到（SPA 空殼），
  廠商清單改由 app JS bundle 的 i18n 字串間接佐證 —— 大概率為真但非官方文字頁面。
- 論壇串 130093 是單篇零回覆的故障回報帖：能證明使用者預期 Garmin 餵
  RHR/HRV/steps/Body Battery 且**曾發生部分欄位漏同步**；「5 分鐘內到」與完整餵入
  清單無出處。自動化 wellness 後務必加缺值告警。
- Strava 來源活動在 API 只回 empty stub、`/activity/{id}/file` 不支援 —— 本 repo
  走 Garmin push 不受影響，但別拿這條 API 去撈 Strava 端的活動。
