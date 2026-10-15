# 給 AI 的常駐指示

## 一、代辦

Session 開始時 hook 會把 `data/tasks.json` 裡未完成的代辦印出來。有的話在第一次回覆用一兩行帶過並問要不要順手做，不要自己默默動手，也不要複述整份清單。

代辦是**推導出來的**，不是手動維護的狀態：

- 事情做完了（`rides/notes/<date>.json` 出現了、重複的活動刪掉了），重跑 `build-tasks.py` 它自己就消失
- 不要手改 `tasks[]`。要壓下某筆用 `--dismiss <id>`，要自己加一筆用 `--add "..."`
- 四條自動規則與門檻寫在 `scripts/build-tasks.py` 的檔頭與 `tasks.json` 的 `config`

最常出現的一種是「報告產了但教練評語沒寫」。要寫評語就走 `coach` skill，
產出丟到 `rides/notes/<date>.json`（格式照 `rides/notes/2026-08-11.json`）。

## 二、他說「拉一下 API／打 API 更新」時的順序

主線是 intervals.icu，不是 Strava。Python 腳本不會自己讀 `.env`，要先 source：

```bash
set -a && . scripts/.env && set +a
export SSL_CERT_FILE=$(python3 -c "import certifi;print(certifi.where())")   # 不設會 CERTIFICATE_VERIFY_FAILED
python3 scripts/sync-intervals.py                     # 抓 FIT + wellness
python3 scripts/build-route-signatures.py             # 路線簽章快取（報告的「同一條路線」章要查它，排在產報告前）
python3 scripts/build-ride-reports.py --min-tss 100   # 產單日報告與評分
python3 scripts/backfill-itt-efforts.py --quiet       # 從 FIT 重建 ITT 成績
python3 scripts/tag-itt-sources.py
python3 scripts/build-itt-conditions.py               # 平路 ITT 換算成單騎無風（會打 Open-Meteo 抓風，有快取）
python3 scripts/build-fit-extras.py -q                # 器材電量／左右平衡／Body Battery（build-tasks 的 gear 規則讀它）
python3 scripts/build-pacing.py                       # 計時段最佳配速＋照目前體能的全力預估（排在條件校正之後）
python3 scripts/build-itt-progress.py                # 爬坡路段的同功率換算時間（ITT 頁每段的進步趨勢；排在 build-pacing 之後）
python3 scripts/build-distance-prs.py -q               # 各距離最快連續 N 公里（現況／ITT 頁的「距離最佳」；增量，首跑約兩分鐘）
python3 scripts/estimate-indoor-distance.py            # 室內沒有距離，估等效平路里程（漏跑月里程會少一整趟）
python3 scripts/build-coach-context.py                # 貼給外部 AI 的脈絡檔，漏跑就停在上次那天
python3 scripts/build-chronicle.py                    # 運動編年史動畫的資料（strava_chronicle.html）
python3 scripts/build-home-stats.py                 # 首頁按鈕的即時副標（本月小時、最近一趟、最新報告、commit 數）
python3 scripts/build-tasks.py                        # 最後：把上面產生的新代辦收進清單
```

**這串跟 `.github/workflows/fit-sync.yml` 是同一套**，本機手動跑等於搶了 CI 的工作 ——
跑完就把結果推上去，不然下一班 CI 會做一次一樣的事然後 push 被拒。

**Strava API 已於 2026-10-12 停用**（`Application Inactive`），所以這串不再有 `fetch-strava.js`，
`strava-sync.yml` 也已拿掉排程。`data/strava.json` 只有 `segments`（ITT 成績）還會被 `tag-itt-sources.py`
併 FIT 更新，其餘欄位（`recent_rides`／`summary`／`monthly_*`／`weekly_quest`／`power_prs`）凍結在 2026-10-11；
腳本與 Secrets 都留著，細節與復活方式在 `.github/workflows/strava-sync.yml` 檔頭。

有新的**戶外** FIT 而且含 ITT 路段時，再多跑一支 `python3 scripts/build-segment-grades.py`
（室內不用，沒有路段）。push 前先 `git pull --rebase`——CI 每天自己 commit，本機基底常常落後。

## 三、幾個踩過的坑

- **ITT 的坡度不要用 Strava 的高程。** 路段 altitude stream 均坡對、局部坡度在山壁窄路上高估 2–3 倍
  （碧山 31.9% vs FIT 15.4%）。畫面讀的是 `data/segment-grades.json`，細節在
  `scripts/build-segment-grades.py` 檔頭。
- **室內騎乘一律以手錶那份為準。** Rouvy 自己會上傳一份到 Strava（虛擬距離會灌進年度里程），
  那份不是訓練資料。`data/fit/_ignore_activities.json` 是來源刪不掉時的補救。
- **`_wellness.json` 有未來日的推算值**，任何統計都要切到今天為止。
- **DESIGN.md 只管 `strava.html`。** `strava_*.html` 是另外幾個視覺世界，
  設計指令永遠指定單一檔案，不要掃全 repo。

## 四、騎乘回放影片

每趟超過一小時的戶外騎乘各有一支 91 秒回放動畫（路線＋騎士＋速度／心率儀表）。**影片不進 repo**：
放在 GitHub Release `ride-videos`（prerelease、不標 latest，只是儲存桶），repo 只放 `data/ride-videos.json`
（intervals ID → 下載網址／海報／長度）和 `assets/ride-videos/posters/<id>.jpg`。頁面永遠只讀那個 json。

- 渲染器在 `tools/ride-video/`（純 Python PIL + fitdecode + ffmpeg，用 macOS 字型），**本機手動跑、不進 CI**：
  `batch_fast.py` 產母檔 → `compress_all.sh` 壓成 960×540 → `scripts/publish-ride-videos.py --src <dir>/small`
  上傳缺的、抽海報、重建 json。壞檔用 `--clobber <id>` 重傳。
- Release 附件的下載網址會 302 到一小時過期的簽章網址、沒有 CORS、沒有快取：海報一定要在本機抽好 commit，
  播放端 `preload="auto"` 一次抓完 4 MB。
- 露出的地方：`activity-modal.js` 詳情彈窗「動畫／影片」切換＋紀錄列「▶ 影片」鈕（strava.html 與 strava_cinema.html
  等所有載這支的主題都有）；報告頁量測列下的回放海報（`tools/tcx/render_dashboard.py` 從 `--fit` 檔名取 id 對 json，
  新報告自動長，舊的要逐日 `--overwrite --only`）。回歸腳本在 `docs/review/ride-video-modal.mjs`、`ride-report-replay.mjs`。
