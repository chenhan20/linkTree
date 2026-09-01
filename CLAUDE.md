# 給 AI 的常駐指示

## 一、開場先看代辦

**每次 session 開始，先讀 `data/tasks.json` 的 `tasks[]`。**
有未完成的就在第一次回覆裡用一兩行帶過，並且**問他要不要順手做掉**——不要自己默默動手，
也不要每次把整份清單複述一遍。沒有代辦就什麼都不用提。

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
python3 scripts/build-ride-reports.py --min-tss 100   # 產單日報告與評分
python3 scripts/backfill-itt-efforts.py --quiet       # 從 FIT 重建 ITT 成績
python3 scripts/tag-itt-sources.py
python3 scripts/estimate-indoor-distance.py            # 室內沒有距離，估等效平路里程（漏跑月里程會少一整趟）
python3 scripts/build-coach-context.py                # 貼給外部 AI 的脈絡檔，漏跑就停在上次那天
node scripts/fetch-strava.js                          # 總覽的年度統計還住在 strava.json
python3 scripts/build-tasks.py                        # 最後：把上面產生的新代辦收進清單
```

**這串跟 `.github/workflows/fit-sync.yml` 是同一套**，本機手動跑等於搶了 CI 的工作 ——
跑完就把結果推上去，不然下一班 CI 會做一次一樣的事然後 push 被拒。

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
