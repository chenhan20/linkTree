# 可延續的 AI 訓練規劃

**每四週規劃一次方向，每週回報微調；FIT同步負責留下實際量測。週期不必從每月1號開始。**

## 目前有效時程

- 依使用者指定，山路限制為8/12子時起至9/10；9/8與9/10既有處方本次保留。
- 9/11–21是回山過渡：9/15中社單次計時；9/17完整風櫃嘴控制騎，已確認該日150分窗口。9/15未測且9/17恢復正常，才改中社雨延，不兩條都做。
- **四週主週期9/22–10/19**：W1 9/22–28、W2 9/29–10/5、W3 10/6–12、W4 10/13–19。10/13中社驗收、10/15條件雨延。
- 10/18檢討；下一期從10/20開始。原本10月整月草案與10/27測驗已取消，封存在`athlete/plans/archive/2026-09-07-superseded-october/`，其中ZWO不要匯入執行。

## 檔案怎麼設計

| 檔案 | 用途 |
|---|---|
| `data/plan.json` | 歷史處方，包含9/8、9/10；保留當時FTP與協定 |
| `data/plans/2026-09.json` | **有效主資料**，覆蓋9/11–10/19，含過渡週與跨月四週、晴雨版本、時段、工作FTP |
| `athlete/plans/2026-09.md` | 由主資料產生的完整閱讀版 |
| `data/training-blocks/2026-09.json` | 網頁週期摘要；9/11起FIT同步選定此週期 |
| `data/training-block.json` | 網頁目前顯示的週期；9/7現在仍是舊期至9/10，保留actual |
| `tools/tcx/plan_store.py` | 合併歷史與有效月檔，依日期選處方／FTP，重複日期直接拒絕 |
| `scripts/training-cycle.py` | validate／render／choose／sync；以cycle起終判斷，不以檔名月份判斷 |
| `scripts/make-workout.py` | 匯出已指定版本的ZWO；匯出本身不會替換已選版本 |
| `tools/tcx/score.py`、`scripts/build-ride-reports.py` | 讀同一份主資料，FIT對帳、報告、actual回填 |
| `athlete/training-log.md` | FIT無法知道的RPE、真實睡眠、漏課與籃球／公司課負荷 |

`2026-09`是此計畫的索引，並不代表9/30停止；每天只能存在一份有效處方。此期延伸到10/19，下期可用`2026-10.json`但必須10/20才開始，不要把10/1–19再排一份。

## 每四週一次：產生下期

10/18前後可直接請AI：

> 請讀 athlete/TRAINING_WORKFLOW.md、athlete/training-log.md、data/plans/2026-09.json 和 docs/review/fit-audit-2026-09-05/README.md。依最新FIT、有效中社測驗與主觀回報，檢討9/22–10/19，再從10/20規劃四週。保留歷史與actual；主目標中社PR，每堂戶外附雨備，週二150分、週四120分、週三不騎、週六不排、週日每次60分內且可選。9/17的150分是單日例外。先看實際籃球／公司課及功率來源，再決定進階。修改新主資料後驗證、產生閱讀版／網頁摘要／雨備ZWO，不讓日期重疊，也不以TSS或月時數補欠課。

不需要每天重新排整份。一週回報一次，僅決定下週維持、進階或減量。9/14先確認能否9/15測驗；9/21用9/10、15實際結果複核第一週；10/4決定2×15是否適合；10/11確認10/13測驗狀態。這些日期是人工複核點，尚未建立提醒或AI自動重排。

## 每次出門：先選版本

```bash
# 例如9/29下雨
python3 scripts/training-cycle.py choose --month 2026-09 --date 2026-09-29 --variant rain

# 改回戶外
python3 scripts/training-cycle.py choose --month 2026-09 --date 2026-09-29 --variant outdoor
```

`choose`是修改有效處方；若臨時改騎，回來補選，下次報告才能對同一版。主課雨備保留工作段，縮短通勤／額外續騎，不要求TSS相同。週末社區飛輪只用RPE，不把不明瓦數當曲柄功率。

測驗有兩組條件雨延（或原日未能測驗）：9/15→9/17、10/13→10/15。先將原日設為rain（恢復版，未騎仍需在日誌記未完成），再選備用日；這不是宣稱有下雨或已完成。

```bash
python3 scripts/training-cycle.py choose --month 2026-09 --date 2026-09-15 --variant rain
python3 scripts/training-cycle.py choose --month 2026-09 --date 2026-09-17 --variant reserve_test
```

備用測驗取代當天原課，不能加做風櫃嘴。原日已完成測驗就不能用雨備選項假裝未測。備用日恢復差或天候不佳改rain，不把欠測塞進隔天。9/10若無法測，不自動把前置／後測移到9/15、17，9/15可改成新戶外基準；原疲勞後20分與中社全段不是同一個指標。

## 產檔與驗證

```bash
python3 scripts/training-cycle.py validate --month 2026-09
python3 scripts/training-cycle.py render --month 2026-09
python3 scripts/make-workout.py --plan data/plans/2026-09.json --all --variant rain --out athlete/workouts/2026-09-cycle-rain
python3 scripts/test-training-cycle.py
python3 scripts/training-cycle.py sync
```

sync依台北當天日期啟用週期，換期前把舊摘要連同actual存進`data/training-history/`。自動換期依賴程式已推送且既有FIT CI成功執行；本機目前的修改不等於已部署排程。

ZWO是FreeRide提示，採slope／level看曲柄，不預設固定扣25W進ERG。已做XML及時長檢查，尚未在你的訓練台App實機匯入；提示未顯示就以閱讀版與手動lap執行。工作段關Auto Lap、起終手動lap；路口與下坡正常停踩，不能為計分冒險。

FIT報告仍有已記錄的功率曲線、掉訊與因果判讀限制，詳見審查文件。工作FTP234W是暫定分區值；不拿疲勞後20分直接乘0.95改FTP，不用不同日期的最佳20／60分判定唯一弱點。中社16:25、風櫃嘴28:29是歷史PR；控制騎與室內雨備不能冒充全力路段測驗。
