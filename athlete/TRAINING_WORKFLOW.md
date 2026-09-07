# 可延續的 AI 訓練規劃

採用方式：**每月規劃一次方向，每週用5分鐘回報微調，每次騎完由FIT留下量測。** 不需要每天換菜單，也不需要每天讓AI重新診斷你。

## 原本的檔案如何運作

| 檔案／程式 | 用途 |
|---|---|
| `athlete/好兄弟月平路四週課表.md` | 原本人工撰寫的教練長文 |
| `data/plan.json` | 原本的逐日處方：工作段、休息、時間、瓦數、FTP、計分規則 |
| `data/training-block.json` | 網頁目前顯示的週期、每日摘要、target／actual |
| `scripts/make-workout.py` | 把處方轉成ZWO／ERG／MRC |
| `tools/tcx/score.py` | FIT逐段對帳；結果存在`data/fit/_scores/` |
| `scripts/build-ride-reports.py` | 產生`rides/<日期>.html`，回填週期實際數據 |
| `scripts/build-coach-context.py` | 更新教練脈絡的auto區段；auto之外的舊教練文字原本不會更新 |

原本三份課表需要分別改，導致文字、計分與網頁可能不一致。十月起以月計畫JSON為唯一處方，閱讀版與網頁摘要由它產生。舊月資料與當時FTP保留，不能拿新月FTP改寫歷史。

## 現在的檔案

- **編輯主資料：**`data/plans/2026-10.json`，包含每天的戶外、雨備、選定版本、時間限制、工作FTP及檢討日期。以後依序新增月份，不能覆蓋舊月。
- **你平常看：**`athlete/plans/2026-10.md`，包括整月表與每堂細節。
- **網頁用：**`data/training-blocks/2026-10.json`。到週期開始，現有FIT同步流程會將它切為`data/training-block.json`；上一期連同actual存進`data/training-history/`。
- **你補資訊：**`athlete/training-log.md`，只補FIT無法知道的RPE、真實睡眠、未錄活動與漏課原因。
- **依據與限制：**`docs/review/fit-audit-2026-09-05/README.md`。舊教練文字中的DOMS診斷、固定月時數門檻、功率斷崖因果，不能直接延用。

讀取處方的Python已合併舊`plan.json`與每月檔案。每天採其月份的FTP，雨備版本經選定後，匯出與FIT對帳讀同一份。月計畫變更也會讓該日報告在下次同步時重新計算。這只解決月課表的版本問題，前次審查列出的其他FIT演算法風險仍待另修。

目前仍在九月，因此網站保留九月週期；十月檔已備妥。自動切換依賴這次變更部署到倉庫後的既有CI成功執行，並非本機已建立背景排程。沒有CI時，可手動執行sync。

## 每月一次：決定下一個訓練方向

月底最後一週，請AI先看當月結果再排下個月。十月目前以9/5資料排定，**9/28要複核九月結果與裝置狀態**，不是未來資料已經算進去。

每月至少檢查：最近4–6週實際騎乘頻率與時間、功率來源、主課工作段、RPE、測驗有效性、籃球／公司課負荷、睡眠，以及下月能用的日期。不只看A+、CTL、eFTP。先選一個主要目標，不同時要求減重、衝刺、長距離與所有爬坡都破PR。

可以直接在這個專案貼以下文字給任何AI：

> 請先讀 athlete/TRAINING_WORKFLOW.md、athlete/training-log.md、最近月份的 data/plans/*.json，以及 docs/review/fit-audit-2026-09-05/README.md。用最新FIT對帳、ITT成績與wellness檢討本月，再規劃 YYYY-MM。保留歷史；每個戶外主課都有雨備；週三不騎、週二150分、週四120分、週末每次60分內；依9/7紀錄，十月週六不排課。確認未錄的籃球／有氧負荷與感測器口徑。先更新新的月JSON，再驗證與產生閱讀版、網頁摘要及雨備ZWO。不要把DOMS或不同日期的最佳功率當成確定診斷，也不要只為追TSS補課。

若使用不能讀此專案檔案的外部AI，提供本檔、當月閱讀版、訓練日誌及最新對帳摘要；不要只貼舊對話記憶或一張功率曲線。新AI應先說明資料截至哪天、缺什麼，再排課。

## 每週一次：只改下一週

週末回報：主課是否完成、最吃力那組RPE、腿部痠痛0–10、實際睡眠、籃球／公司課有沒有參加、下週時段。AI只決定下週維持、進階或減量，不因一堂課數字差就重排整月。

可用一句話：

> 檢討本週，僅調整下週。FIT已同步；週二最後一組RPE__，腿痠__/10，實際睡眠__，籃球／公司課__，漏課原因__，下週可用時段__。請把變更理由寫進訓練日誌，再更新月主資料與衍生檔。

## 每次騎車：先選晴雨，再記錄結果

一般訓練遇雨，當天直接做已設計的雨備，不整週延期。出門前判斷雨勢、路面、能見度與下坡條件；十月的月計畫不是天氣預報。被交通打斷的工作段正常停踩，記下來，不為得分勉強維持功率。

你可以只說「10/13改雨備」，由AI替你選定。也能自行執行：

```bash
python3 scripts/training-cycle.py choose --month 2026-10 --date 2026-10-13 --variant rain
```

改回戶外把rain改成outdoor。**只匯出一個雨備檔不等於已選定雨備**，事後FIT對帳需要知道你實際採用哪版；如果臨時變更，回來補選即可，下次同步會重算。

中社測驗是例外：10/27下雨改45分恢復；10/29只有在未做10/27測驗、恢復正常且天候適合時才啟用。兩天不能都排測驗：

```bash
python3 scripts/training-cycle.py choose --month 2026-10 --date 2026-10-27 --variant rain
python3 scripts/training-cycle.py choose --month 2026-10 --date 2026-10-29 --variant reserve_test
```

10/29又下雨就選rain，把測驗交給十一月，沒有需要補回的欠課。10/29下坡與往返若塞不進120分也延期。室內能力測驗不能取代戶外中社秒數。

## 產檔與驗證

```bash
# 改月JSON後，檢查完整日期、晴雨版本、時間上限、週三休騎與測驗衝突
python3 scripts/training-cycle.py validate --month 2026-10

# 自動產閱讀版與網頁週期摘要；保留既有actual
python3 scripts/training-cycle.py render --month 2026-10

# 批次產生此月所有雨備提示檔（休息、無功率週末不產）
python3 scripts/make-workout.py --plan data/plans/2026-10.json --all --variant rain --out athlete/workouts/2026-10-rain

# 按今天日期啟用適用週期；沒有對應月計畫就保留現狀，不擅自延伸處方
python3 scripts/training-cycle.py sync
```

十月ZWO是 **FreeRide提示檔**：用slope／level與曲柄功率，避免尚未驗證的固定25W換算進ERG控制。完成同步校正後才討論ERG。檔案已做XML和時長檢查，但尚未在你的訓練台App實機匯入；文字提示若不顯示，以閱讀版與手錶lap計時照做。

之後新增月檔時，更新month、cycle起終、完整日期、revision、baseline來源、檢討日期與各日segments；星期規則和時間限制會驗證。週期可跨月，但不可重疊：十月延伸到11/1，因此下一期從11/2開始。改完主資料必須重生，不直接修改衍生Markdown或網頁摘要。

這次未替你建立提醒或讓AI每月自行排課。你每月請AI規劃一次即可；既有同步負責收資料與報告，主觀回報與下一期目標仍由你補充。
