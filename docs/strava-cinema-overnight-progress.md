# strava_cinema.html · 整夜作業進度

> 唯一程式來源：`strava.html`。輸出：`strava_cinema.html`、`theme-strava-cinema.css`、`strava-cinema-fx.js`。
> 對 `strava_fable51.*`、`strava_helicorder.html`、`strava_pitwall.html` 採零時間政策，整晚沒開過。

## 來源索引（strava.html，2026-09-02 快照，11120 行）

| 區段 | 行號 | 備註 |
|---|---|---|
| `<style>` | 11–3012 | :root 字體/墨階 21–28；app shell 85–830；drawer 1296–1357 |
| body 背景層 | 3015–3396 | `#deepfield`、`#star-canvas`、兩片 `.ss-pad` 火箭 SVG（cinema 版整組換掉） |
| ITT 等級說明彈窗 | 3398–3529 | `#itt-level-popup`，保留 |
| 3D replay modal | 3532–3579 | `#r3d-overlay`，保留 |
| app shell | 3581–3627 | `.app > .side + .main`，`#nav`、`#tabbar`（cinema 版換成 hub shell） |
| drawer | 3630–3641 | `#drawer`，保留 |
| 主 script | 3643–10750 | 星野 IIFE 3644–3774（cinema 版移除，否則沒有 canvas 會在頂層 throw） |
| 訓練區塊／課表 | 4008–4540 | renderTrainingBlock、renderMesocycle 4139、renderGuide 4313、openSessionDrawer 4347、renderTrainingCalendar 4397 |
| ITT | 4542–6098 | renderSegments 4545、selectSegment 4794、3D replay 4891–5397、tsv 測量檯 5398–5865、mini map 5885–6049 |
| Log timeline | 6099–6219 | groupByDate、renderTimeline |
| render(data) | 6220–6987 | 九個 `<section class="view" data-view=…>` 在 6796–6906 |
| Playbook | 6988–7141 | pbChart、pbClimb、pbArticle、renderPlaybook |
| Harvest | 7142–7629 | buildHarvest、renderHarvest、openHarvestMonth、initHarvest |
| Trends 元件 | 7630–8400 | applyVolume/initVolume、PowerShift、Radar、PartsBalance、GoalRings、YearRace、HexCard、TrainingClock、PowerCurve |
| NameCard／功率彈窗／drawer | 8398–8905 | renderNameCard、bindNameCard(nc-canvas)、openPowerModal、openDrawer/closeDrawer/initDrawer、openIttDayDrawer |
| Atlas | 8905–9404 | atInit、atDraw、atBind… 全 canvas |
| VIEWS／router | 9413–9430、10366–10590 | VIEWS 九個 id、setView、routeFromHash、initRouter、focusActivity |
| 側欄狀態儀表 | 9514–9656 | tsbMood、latestField、renderReadiness（TODAY 狀態結論的資料來源） |
| PMC | 9657–9878 | pmcProject、renderPmc |
| Body | 9879–10355 | wellnessSeries、wellnessPlot、wellnessPanel、domsPanel 10184、powerHrPanel、renderBodyView 10310 |
| 資料載入 | 10583–10750 | Promise.all 18 個 fetch → render → initRouter → mountReadiness → updateNavBadges |
| 動效層 | 10778–11108 | anime.js module，聽 `strava:view` 事件 |
| 外掛 | 11111–11118 | activity-modal.css/js、theme-strava.css、itt-achievements.js |

### 九模組相容入口（全部保留）

`#overview` `#plan` `#log` `#itt` `#playbook` `#atlas` `#trends` `#harvest` `#body`
子路由：`#itt/segment/<id>`、`#log/activity/<date>`、`#plan/session/<date>`、`#harvest/month/<YYYY-MM>`
跨 view 跳轉屬性：`data-goto`、`data-actdate`、`data-ses`、`data-ittday`、`data-hvm`、`data-power`、`data-wellness`

### Hero 素材（已核准，不重做）

- `assets/strava-cinema/hero-climb-desktop-v1.mp4`：h264 1280×720 24fps 10s 無音訊 2.6 MB
- `assets/strava-cinema/hero-yangmingshan-desktop-v2.png`：1672×941 2.4 MB（poster／reduced-motion 降級；車手在右 2/3、道路由左下往右上、左上遠景是台北盆地與雲）

## Task 狀態

| Task | 狀態 | 修改檔案 | smoke check |
|---|---|---|---|
| 0 安全斷點 | DONE | `strava_cinema.html`（原樣複製）、本檔 | — |
| 1 App shell 與相容路由 | DONE | `strava_cinema.html`（頭部連結、#cinema 舞台取代太空層、hub shell 取代側欄、星野 IIFE 移除、VIEWS 加 hub／新增 HUBS／setView 接受 hub id／routeFromHash 預設 today／render 後呼叫 `__cinemaMount`、ALL 索引頁）、`theme-strava-cinema.css`（新）、`strava-cinema-fx.js`（空殼，Task 6 填） | 四個 script 區塊 node --check 通過；#today 開得起來、console 無錯；hub／舊 hash／子路由／back 都能切 |
| 2 TODAY hub | DONE | `strava_cinema.html`（shell script：todayVerdict／todayHeroHTML／seasonSnapHTML／initHeroVideo／mountToday，`__cinemaView` 切頁暫停影片）、`theme-strava-cinema.css`（.td-*） | 桌機 1440：hero 影片區＋決策面板（結論由 tsbMood／domsBand／HRV 30 天帶／rampRate 推導，睡眠只列不扣分）、7 個籌碼、NEXT／LAST／DATA 三張卡、賽季快照列；手機 390 無橫向溢出；console 無錯。內嵌窗格擋 autoplay → 走 poster 降級並在首次互動重試 |
| 3 TRAIN hub | DONE | `strava_cinema.html`（shell script：monoPath／trainRoadHTML／pkWrapSteps／pkCondHTML／mountTrain）、`theme-strava-cinema.css`（.rd-*、.pl-all、.pk-*） | #plan：負荷之路（路＝累積目標 TSS、9 key 節點＋12 輔助小石子、今天線、週帶、前後測門）；點節點開抽屜、hash 變 #plan/session/<date>；全部課表收進 details。#playbook：坡選擇器（2）＋條件列＋五段決策路徑；換坡正常。桌機／手機無溢出，console 無錯 |
| 4 RIDE hub | DONE | `strava_cinema.html`（shell script：rideDayIndex／routeThumbSVG／profileSVG／decorateLog／mountRide；包一層 `focusActivity` 與 `selectSegment`；`__ittShow`／`__ittRebuild`）、`theme-strava-cinema.css`（.fs-*、.rt-*、.at-wrap） | #log：膠卷日摘要（真實 route_stream 縮圖、日統計、PR／ITT／3D／室內徽章），活動卡收合、換頁籤重裝飾、深連結展開；#itt：12 條路線選擇器（真實海拔剖面）一次一座測量檯，切換後重建 3D、hash 同步；#atlas：控制列浮在圖上，canvas 1180×760 正常。手機 390 無溢出，console 無錯 |
| 5 REVIEW hub | DONE | `strava_cinema.html`（shell script：TR_Q／bodySignalsHTML／mountReview）、`theme-strava-cinema.css`（.tw-*、.hv-head、.hv-cols、.bs-*） | #trends：7 個問題籤一次一張圖；#harvest：頭條（本月距損益線、月均、過線月、現存紀錄與延遲）＋ 四線圖 ＋ 現存紀錄／刷新率並排；#body：DOMS → 9 格訊號（最新值、7 天對 28 天、基準帶、28 天有值天數）→ 指標頁籤與完整圖。點格會換指標。手機 390 無溢出，console 無錯 |
| 6 場景統一與動態 | DONE | `strava-cinema-fx.js`（引擎：Stage、SCENES、霧／雨／光塵／散景／GPS 光軌／稜線／反光標、OVERDRIVE／ACTIVE／QUIET、指標與捲動視差、FX 三檔鈕）、`theme-strava-cinema.css`（每個 view 的 poster 裁切、.fx-tier、quiet／reduced-motion 規則）、`strava_cinema.html`（`__cinemaData`、ITT 換路線／攻略換坡發 `strava:scene`） | DOM 驗證：overview 光軌＝近 7 天 1 趟、hero 舞台 1276×778；plan 反光標 9；itt 稜線 160 點且換路線會重建；playbook 雨 .5＋稜線；三檔切換正確、QUIET 有靜態畫面；手機自動 ACTIVE（霧 8／雨 110／光塵 35）；console 無錯。截圖在這個窗格不可靠（分頁被視為 hidden，rAF 凍結），正式截圖留給 Task 7 |
| 7 全站回歸（閘門後） | 桌機 DONE（手機待使用者說開始） | `theme-strava-cinema.css`（命中區）、`docs/review/cinema-t7/`（測試腳本） | 見下方「Task 7 桌機回歸」 |

## Shell 契約（Task 1 之後的檔案，行號會漂，用標記找）

- `strava_cinema.html`：`#cinema`（.cn-photo／#cn-canvas／.cn-fog／.cn-scrim）→ `.app > .topbar(#nav 五個 .hub-i) + .main > .hubhead(#ah-title #ah-sub #rail) + .viewport(#content)` → `#tabbar`（手機五個 .tab-i）
- `body[data-hub]`／`body[data-view]` 由 setView 設；CSS 用它決定 poster 裁切
- 事件：`strava:hub {hub, view, from}`（給場景引擎）、`strava:view`（原動效層）
- 掛勾：`window.__cinemaMount(data)` 在 render 之後、initRouter 之前跑；`window.__cinemaView(v, hub, was)` 每次切 view 呼叫（尚未定義，Task 2 起用）
- 徽章：`_badgeCache` + `applyBadges(root)`；任何 `em[data-badge=id]` 都會被填

## TODAY 契約
- overview section 順序：view-h(隱藏) → #rdy-mobile(隱藏) → .td-hero → .td-snap → 需要注意 → 代辦[data-anchor=tasks] → 當前週期 → PMC[data-anchor=pmc] → 本週 → .td-rhythm → 表現訊號 → 最近活動 → rider-card(縮小) → 語錄
- `window.__cinemaState = {verdict: go|ease|rest|nodata, tsb, ctl, atl, tss7, doms}` 給場景引擎（Task 6）
- 籌碼點擊：`data-wellness`→goBodyMetric（原有）、`data-goto=body`（原有）、`data-scroll=pmc|tasks`（shell 內處理）

## TRAIN 契約
- plan：view-h → .rd（負荷之路）→ .block.mc → 本週×本月 → next(.nx) → 本月目標 → 重訓平衡 → details.pl-all(全部課表) → 課表指南 → view-sub.is-foot
- playbook：view-h → .pk-sel → .pk-cond → .pk-stage(.pk-path + .pk-steps > .pb-climb[hidden 除了選中]) → details.pk-more(文章＋method) → view-sub
- 節點狀態全部讀 `window.__mcDetail[date].st.cls`

## RIDE 契約
- log：`.timeline-day.fs-day` > `.fs-frame`（按鈕）＋ 原活動卡；`.is-open` 才顯示卡；`#timeline` childList observer 重裝飾
- itt：view-h → .itt-bar → .rt-sel（12 個 .rt-i[data-rt=id]）→ .rt-cap → #tsv-stack（只有一座 .tsv 沒 hidden）；`setupIttPlates` 只為可見 canvas 建場景，切換後 `__ittRebuild()` 重建
- atlas：.at-wrap > (.at-stage + .at-bar) → .at-rail 在後

## REVIEW 契約
- trends：view-h → .tw-sel（7 籤）→ .tw-stage（7 個 .block，只有一個沒 hidden）
- harvest：view-h → .hv-head → chart block(#hv-body) → .hv-cols(現存紀錄＋刷新率) → view-sub.is-foot
- body：view-h → .block.dm → .block.bs(訊號格) → #body-tabs → #body-panel → 功率-心率

## 場景引擎契約（strava-cinema-fx.js）
- 舞台：`#cn-canvas`（全螢幕、DPR 1）＋ `#td-canvas`（TODAY hero 上方，只在 overview 時畫）
- 事件：`strava:hub`（setView）與 `strava:scene`（ITT 換路線、攻略換坡）→ `refresh()`；`window.__cinemaFx = {refresh, tier, stages}`
- 資料：`window.__cinemaData.recent_rides[].route_stream`（光軌）、`window._segStreams[id].pts`（ITT 稜線／光軌）、`_playbook.climbs[i]`（攻略稜線）、`_trainingBlock.sessions`（反光標）、`__cinemaState.verdict`（今日霧雨）、`__harvest.stats`（光塵）、`_wellness` HRV（呼吸幅度）
- 三檔：localStorage `cinema-fx-tier`；reduced-motion 永遠 QUIET；`body[data-fx]`

## 2026-09-03 第二輪（使用者回饋後）

回饋：右側空一大塊、字太小、背景別用馬路照片改成台灣環境、影片重新產生了、先顧 TODAY。做了：

- Hero 換成 `assets/strava-cinema/hero-climb-desktop-v2.mp4`（使用者 9/2 深夜重生，男性車手、有 AAC 音軌但一律 muted），poster 改從影片 4.2 秒抽的 `hero-poster-v3.jpg`；影片右下角有生成工具的星芒標記：桌機把 video 元素做成 hero 的 114% 寬、靠左對齊（`object-position:0% 50%`），右緣 14% 落在 overflow:hidden 之外，不放大也不裁底；手機影片只佔上面 58vh、車手完整在畫面裡，面板從影片底往上疊 90px 用漸層接
- 版面：`--main-max` 1180 → 1480（≥1600 是 1560），內容置中；TODAY hero 之後改雙欄 `.td-grid`（左：注意／代辦／週期／PMC／訊號，右：本週／節奏／最近／身分卡／語錄），手機單欄
- 字級：html 15px；shell、TODAY、rows／meters／section-title、各 hub 的元件全部放大一到兩階（見 theme 檔「字級整體放大」一段）
- 背景：poster 裁切整組拿掉，改成 `strava-cinema-fx.js` 的環境畫師（ENV）：雜訊生成的分層點陣（天空雲層、多層山稜、霧帶、芒草、海面浪紋、河面倒影、盆地燈海、水田格、樹幹霧束），每個 view 一部台灣短片：陽明山清晨（TODAY）、河濱黃昏（計畫）、山路藍調（攻略）、東北角海岸（紀錄）、山與霧（ITT）、台北盆地夜景（地圖／趨勢）、稻田晨光（收成）、森林霧氣（身體）、陽明山夜（ALL）
- 照片底層：Wikimedia Commons CC0 七張放在 `assets/strava-cinema/env/`（出處在 `credits.json`，ALL 頁列出）；`ENV.photos` 指定每個場景取代哪些畫師層、構圖焦點、壓暗、調色；森林霧氣與陽明山芒草找不到 CC0 照片，維持畫師版
- 動效層修正：hub 重組把已渲染的節點搬到新容器，原本的 MutationObserver 在「移除」時解除觀察、「加入」時因為武裝過而略過 → 停在 opacity 0。改成搬動過的節點只把 IntersectionObserver 接回去（`rearm`／`rereveal`）
- 驗證管線：Chrome `--screenshot --virtual-time-budget` 在這頁永遠等不到靜止（常駐 rAF＋影片），改用 CDP `Page.captureScreenshot`（scratchpad 的 shoot.mjs／probe.mjs，見 memory）
- 手機溢出：模組 rail 的籤被「字級放大」蓋成 128px 三個放不下、`.td-grid` 的 1fr 被節奏日曆撐開、頂列的 UPDATED 文字放不下 → 三處都修了，390 寬的 `innerWidth`／`scrollWidth` 回到 390
- 本輪 CDP 截圖看過：桌機 TODAY／計畫／攻略／紀錄／ITT／趨勢／收成／身體／ALL，手機 TODAY／計畫／紀錄／ITT

## Task 7 桌機回歸（2026-09-03，使用者說「開始測試PC版」）

工具：`docs/review/cinema-t7/test-pc.mjs`，CDP 真實輸入（滑鼠／鍵盤／拖曳／滾輪），headless Chrome 1440×1000，WebGL 用 swiftshader。

**覆蓋**（67 項）：進站與首屏、五個 hub 點擊、rail、九個舊 hash、back／forward、四種子路由深連結（ITT 路線／活動日／課表日／收成月）、
TODAY 的籌碼（HRV→身體、DOMS→身體、7 天→捲到 PMC）、NEXT／LAST／DATA 三張卡、賽季快照 FTP → 功率彈窗、名片 FTP 鈕、FX 三檔、
drawer（Esc／×／點外面）、計畫（9 節點＋12 小石子、下一堂／輔助／前測開抽屜、全部課表 details、課表指南）、攻略（換坡、路徑捲動、看那一堂、延伸閱讀）、
活動紀錄（膠卷 10→229 天、換運動頁籤重裝飾、frame 開合、詳情彈窗、3D 回放開／播／拉桿／關）、ITT（選路線→測量檯重建、重播／回正北／自轉、說明彈窗、挑戰簿展開、ITT 日抽屜）、
Atlas（載入、縮放鈕、台北／全台／路段膠囊、拖曳、滾輪、三個開關、hover 讀數）、趨勢（七張圖揭幕、指標＋範圍、三種 tooltip）、收成（hover／月抽屜／篩選）、
身體（訊號格→頁籤、範圍頁籤、DOMS／功率-心率面板）、ALL（九格＋出處）、reduced motion（QUIET＋poster＋鈕停用）、資料降級（wellness／DOMS／課表／攻略／地圖／ITT 權威檔全部抓不到：TODAY 顯示資料不足、計畫與攻略空狀態、其餘不崩）、命中區 ≥24px、九個 view 無橫向溢出、console 零例外。

**結果**：兩輪完整跑分別 55/62 與 62/67，剩下的項目全部用單獨重跑或直接探針驗證通過（收成月深連結、drawer 三種關法、ITT 日抽屜、Atlas 五步、趨勢七張圖揭幕、影片播放、`<details>` 展開、TODAY 無溢出）。最後一輪完整跑遇到機器本身的 softwareupdated 與防毒吃掉 CPU，Atlas 載入超時、一項互動花了 773 秒，那輪作廢。過程中的假失敗全是測試環境：軟體 GL 的 rAF 只有 2–11 fps（smooth scroll 滑不完、drawer 的 `.open` 在 rAF 裡加）、影片軟體解碼、我自己的探針跟回歸同時跑互搶 CPU、以及測試判定的口徑（把 `display:none` 的月份列與 `opacity:0.4` 算成卡住）。

**修掉的真問題**：命中區太小 —— FX 鈕 22px、路上的輔助小石子 7×7、名片星座鈕與語錄按鈕 19–22px、活動卡的詳情／報告／Strava／3D 鈕 23px、素材出處連結 17px，全部拉到 ≥24px（theme 檔最後一段）。

**環境限制（真實瀏覽器要自己看一眼）**：① 效能 —— headless 不論 GPU 與否 BeginFrame 都被節流，QUIET 也只有 11–16 fps，量不到真數字；已把霧／散景／光塵改成 1/3 解析度離屏、顆粒拿掉 soft-light 混合。② Atlas 首次繪製在軟體光柵化要 60–120 秒（原版同一份程式，GPU 下應為 1–2 秒）。③ 功率曲線的 `.pcv-dot` hover 點只有 9px（原版設計，另有鍵盤 focus 路徑），沒動。

## 方向確認閘門（手機版）

- 預覽：`python3 -m http.server 8934 --bind 127.0.0.1` 後開 `http://localhost:8934/strava_cinema.html`（本 session 的預覽伺服器也還開著）
- 桌機已測完；手機 390×844 等使用者說「開始測試手機版」再跑（腳本已支援 `MOBILE=1`）

## Task 7 待驗清單（方向確認後）

1. 九個模組逐一：hash、back／forward、drawer、modal（功率排行、活動詳情）、3D replay、Atlas 拖曳縮放、圖表 tooltip、touch
2. Hero 影片：真實瀏覽器的 autoplay（這個窗格擋 autoplay，走 poster＋首次互動重試）、iPhone 的 playsinline
3. 趨勢工作台：隱藏中的圖表被 anime 動效層設成 opacity 0，切籤時 IntersectionObserver 應把它們揭開 —— 要在真實瀏覽器確認每一張都會出現
4. ITT：切路線後 3D 重建、深連結 `#itt/segment/<id>`、reduced-motion 下的測量檯
5. 手機：hero 首屏高度、膠卷 frame 的換行、rail 橫向捲動、底列命中區
6. 效能：OVERDRIVE 在 1440 的 fps、ACTIVE 在手機、QUIET 的靜態畫面
7. 已知取捨：睡眠只列不扣分（他自己的資料裡睡眠不預測表現）；DOMS 對準下一個有主課表的早上；賽季快照的 FTP 走 data-power=1200 開功率彈窗

## 2026-09-03 第三輪（視覺收尾：轉場、字體、版面、新影片）

桌機 67 項回歸使用者已視為有效；這輪只做視覺收尾，沒有重跑全套。修改檔案：`strava_cinema.html`、`theme-strava-cinema.css`、`strava-cinema-fx.js`、
`assets/strava-cinema/hero-poster-lightning-v2.jpg`（新）、`docs/review/cinema-t7/veil.mjs`（新）、`probe.mjs`（加 `W=`/`H=`）。

### Hero 影片
- `HERO_MP4 = assets/strava-cinema/hero-climb-lightning-v2.mp4`（1280×720 24fps 17s，無音軌）。**之後換影片只要覆寫這個檔**；
  poster 是同一支影片第 4 秒抽的 `hero-poster-lightning-v2.jpg`（JS 的 `POSTER` 與 CSS 的 `.td-still` 都指它），只在 reduced-motion／autoplay 被擋時出現。
- `<video muted loop playsinline preload="metadata">`、poster 降級、首次互動重試、桌機 114% 寬靠左裁掉右緣星芒標記、手機 58vh —— 全部沒動。

### 轉場（鏡頭：defocus → focus pull → autofocus lock；2026-09-03 下午依使用者更正重做）
- 第一版做成「霧面玻璃＋馬賽克窗格逐格打開」是名詞誤會，整組拿掉（`#cn-veil`、tiles、makeSprite、schedule、點擊位置擴散、`.main` 重度模糊）。
- 入口不變：`navTo(name, opts, after)`（`strava_cinema.html`）。頂部 hub／手機底列／rail、ALL 入口、`data-goto`、ITT 成績列→紀錄、`goBodyMetric`、
  `routeFromHash`（上一頁／下一頁）全部走它；`setView` 仍是同步的真切換。drawer／modal／tooltip／圖表範圍／按鈕／卡片／篩選器不經過，完全不播。
- 引擎 `window.__cinemaLens = { go({level, swap}), intro(swap), finish(), active(), level() }` 在 `strava-cinema-fx.js` 檔尾（獨立 IIFE）。
  只對「背景場景層」動 inline `filter:blur/saturate/contrast/brightness`＋`transform:scale`：`#cn-canvas`（全站場景）與 `.td-scene`
  （TODAY hero 新加的媒體層包層：`.td-still`＋`.td-video`＋`#td-canvas`；<video> 本身一個屬性都不碰，實測元素沒重建、currentTime 一直走）。
  頂列、底列、標題、數據永遠不進 blur。鏡頭狀態是連續值，新程式從當下的值接著走，快速連點不跳不疊、永遠切到最後一次。
- 三級：
  1. 首次進站 `intro(swap)` ~1100ms：fx 一載入就加 `body.cn-defocused`（CSS 把場景層定在 blur 22px／scale 1.038／sat .82／contrast .92／
     brightness 1.05），資料到了 navTo 呼叫 intro：先 150ms 再糊到 24px（還沒對到）→ 530ms 非線性降到 8px → 270ms 慢慢到 0 → 80ms 鎖定
     （sat／contrast 1.03 極輕過衝）→ 70ms 回 1。scale 的中心：TODAY 是右側車手（72% 50%，手機 52% 42%），其它 view 用 `ENV.photos[scene].focus`。
     canvas 多畫的東西只有：bokeh 光點變大變軟（`Stage.defocus`）、霧厚 50%、光軌暗 35%，隨對焦淡掉；QUIET 靜態圖不烙上。
     標題與核心資訊由 CSS `body.cn-focus` 在 .5s／.62s 之後以 opacity＋6px 出現。資料 9 秒還不來就自己對焦（不會永遠糊著）。
  2. 跨 hub `go({level:2})`：`.main` 100ms 淡出、場景層 110ms 到 5px → setView → `.main` 160ms 淡入、場景層 420ms 回 0、
     `body.cn-in2` 讓 hub 標題與 rail 淡入，動效層（anime）做 view-h＋前四個大區塊（TODAY 是 hero 的文字面板）的 opacity＋6px、60ms stagger。
     場景引擎的環境交叉溶接從 1.5s 改成 450ms，跟重新對焦同步。
  3. 同 hub 子頁 `go({level:3})`：只有 `#content` 90ms 淡出 → setView → `body.cn-in3` 的 180ms dissolve（opacity＋4px），背景不動、動效層不動。
- reduced-motion：三級都只剩 `.main` 的 ~120ms 淡出淡入；`cn-defocused` 與所有 cnRise／cnDissolve 動畫在 media query 裡關掉。
- 保險：分頁隱藏、3 秒沒收尾 → `finish()` 立刻換頁、鏡頭歸零、class 全清。
- `Stage.resize` 改用 `clientWidth/Height`（場景層被 scale 時 `getBoundingClientRect` 會放大，畫布會每幀重建）。

### 字體
- 載入 `Noto Sans TC` 500／700／900；`--f-disp` 改成 Noto Sans TC；`--f-ui` 在 Archivo 之後接 Noto Sans TC（內文中文不再回退 PingFang）。
- `.hh-title`／`.td-verdict b`／`.view-h b` 900、`.section-title` 700、`.rd-hd b`／`.pk-step-h b`／`.tw-sel b`／`.all-i b`／`.dw-t` 800，字距 .02em。
  `Noto Serif TC`（只載 500／700）只剩 `.qb-text` 每日一句。brand 改回 Archivo。

### 版面
- `.hubhead{width:100%;box-sizing:border-box}`：`.main` 是 column flex，之前 `margin:auto` 讓它縮成內容寬浮在中央。現在標題左緣＝內容左緣（48px），rail 靠右。
- hub 中英文 `white-space:nowrap`；≤1279 藏 UPDATED、≤1120 縮 padding、≤900／≤840 再縮 brand 與字距。實測 1280／1024／900／800 都不斷行、頂列不溢出。
- TODAY hero 只留：判斷、原因、三顆核心籌碼（優先 TSB／DOMS／HRV，驅動結論的那顆一定在）、NEXT。其餘籌碼、備註、LAST、DATA 移到 hero 正下方的
  `.block.td-evidence`「今日依據」（`todayEvidenceHTML()`），互動屬性不變。
- 高密度圖表容器（TODAY PMC、節奏 console、收成主圖、身體 DOMS／指標／功率-心率、趨勢舞台、負荷之路）背景 .5–.55 → .64–.66，加 `backdrop-filter:blur(5–7px)`。
- 年度騎士卡：橘色系全部換成 amber／hair，背景改 `rgba(cn-bg,.64)`＋blur 8px；nc-canvas 星座、星座鈕、FTP 鈕、count-up 全部保留。
- 手機：hubhead padding 18→10、標題 30→26、rail 縮、viewport 上緣 14→10、view-h 收緊（合計約 28px）；`.rt-sel`／`.tw-sel`／`.rail`／`.pk-path` 右緣留 32px 讓下一張露出；
  viewport 底 padding 112px＋safe-area。

### 快速檢查（headless CDP，`docs/review/cinema-t7/lens.mjs`，桌機 1440×1000 與 390×844 各跑一次）
- 首次進站：場景層 blur 24 → 0，`#cn-canvas` 與 `.td-scene` 同步；`.topbar`／`.tabbar` 全程 filter none、opacity 1；`.td-video` 元素沒重建
  （標記還在）、沒暫停、currentTime 一直走；結束 body 沒有 class、inline filter 清空。
- TODAY→TRAIN：`.main` 淡到 0 再回 1，場景層最高 5px，結束乾淨；計畫→攻略：場景層全程 0px、只有 `#content` opacity 走一趟、`data-lens=3`；
  REVIEW→TODAY：最高 5px，回來影片照播；快速連點 TRAIN→RIDE 停 log、rail ITT→REVIEW 停 trends；back／forward 乾淨；reduced-motion 全程 0px。
- 1280 寬 UPDATED 已隱藏（breakpoint 1320）、1330 寬完整顯示（216px，不截斷）。390 無橫向溢出。console 零錯誤。
- 中途幀：`lens.mjs` 最後把該頁面的 rAF／`performance.now`／`setTimeout` 放慢 8 倍、CSS 動畫用 `Animation.setPlaybackRate(0.125)`，
  截到失焦（23.7px）、尋焦（12px）、鎖定（0px）與跨 hub 的淡出／重新對焦。

## 2026-09-03 第四輪（全幅 hero、簽名、景深、對焦框、距離尺、峰值）

修改：`strava_cinema.html`、`theme-strava-cinema.css`、`strava-cinema-fx.js`、`assets/strava-cinema/hero-climb-lightning-v2-clean.mp4`（新）、
`hero-poster-lightning-v2-clean.jpg`（新，舊 poster 刪）、`docs/review/cinema-t7/hero.mjs`（新）。

### 素材與版面
- 星芒：`delogo x=1126 y=566 w=68 h=68`（靜態標記，三個抽樣幀確認），libx264 crf 19 重編成 `-clean.mp4`（6.2 MB），原檔保留；poster 從新檔第 4 秒抽。
  **之後換影片：覆寫 `hero-climb-lightning-v2-clean.mp4`（HERO_MP4）與 poster**；深度圖是為這支構圖寫的（見下），構圖差很多時要調。
- hero 全幅：桌機 `aspect-ratio:16/9`、`max-height:calc(100vh - topbar)`、`width:100vw; margin-left:calc(50% - 50vw)` 貼到視窗兩緣（`.main{overflow-x:clip}` 收掉捲軸寬度的溢出）；
  `overflow:clip` 不是 hidden（hidden 會讓自動最小高度歸零、面板被切頭）。影片 100%、`object-position:50% 50%`，整格不裁。1440→810 高、1920→1020（上限）、1280→720。手機不變（58vh 裁切）。
- 簽名 `.td-sign`「Made with Claude Fable 5.1」：hero 右下角，Archivo 10px、字距 1.6px、墨色 45%，純文字、不動畫。ALL 頁出處多兩行（設計協作、Hero 影片 Gemini 生成）。
- 自動對焦中心 63% 52%（手機 52% 42%）。

### Hero 鏡頭（`__cinemaHero`，fx 檔尾）
- 深度圖 192×108（每像素 1/距離）：天空 ∞、遠山雲海 600 m（y .28–.53，右側 x>.7 淡出）、右側山坡 40 m（左緣從 (.62,0) 斜到 (.83,.55)）、
  車手 6 m（橢圓 (.63,.56) 半徑 (.075,.30)，羽化 .85–1.15）、路面透視平面（地平線 .46 → 落地點 .9＝6 m → 下緣 3 m）、右緣芒草 2.2 m、左下角 2.5 m。
- 模糊：薄透鏡 CoC = 60·|1/d − 1/f|（上限 22px）。畫面上只有三層 backdrop-filter（4／9／20px，最糊那層加 contrast 1.12 brightness 1.04 留亮部），
  每個像素依 CoC 把三檔混合：遮罩＝alpha 圖（64 個焦距步驟快取，逐幀換 mask-image）。景深層放在 `.td-scene` 裡跟影片一起呼吸；影片本身不碰。
- `.td-dof` 對齊顯示中的影片矩形（object-fit:cover 之後，用 offsetWidth 不受 scale 影響）；hero 在 mount 時還是 display:none，所以「用到才量」（intro／arrive／focusAt／resize／進 TODAY）。
- 首次進站 2 秒：焦距 0.5 m（全糊）300ms → ∞ 800ms（遠景先對到，框白）→ 6 m 400ms → hunt（+.04/−.02）→ 鎖定（框綠 800ms 淡出）。
  `#cn-canvas` 的鏡頭程式同一條時間軸（24→6→2→hunt→0）；標題與核心資訊 1.25s／1.4s 之後淡入。
- 點對焦：輕點（<8px、<450ms）影片區（面板內容、簽名、距離尺、按鈕除外；手機面板的 padding 仍算影片）→ 讀該點深度 → 320ms 尋焦＋hunt（∞ 是硬點不越過）→ 框白→綠→淡出。
  焦點停到下一次點；離開 TODAY reset 回 6 m；跨 hub 回來 `arrive()` 從 12 m 短暫尋焦（不顯示框）。
- 距離尺 `.td-mf`（桌機右下、簽名上方；手機影片區上緣）：1 m 在左、∞ 在右、線性在 1/d；白線＝焦距、藍帶＝景深（可接受 2px）。
  游標進入／手指碰到影片區淡入、2.5s 沒動作淡出；拖白線＝手動（框消失、峰值亮），放開停在原地，輕點回 AF。
- 峰值 `.td-peak`：480×270 Sobel（每 33ms 一次，只在拖的時候跑），只描 |CoC| ≤ 3px 的深度帶，白色 screen 混合，放開 600ms 淡出；canvas 被污染就安靜關掉。
- reduced-motion：不做景深、尺與峰值不顯示；點對焦只剩框瞬間白→綠→淡出。

### 快速檢查（`hero.mjs`，1440 與 390）
- 首次進站 u 路徑 2→∞→6 m→hunt→鎖定；`.td-scene` 全程沒有 blur（景深層負責）；框 白→綠→淡出；影片元素沒重建、一直播。
- 點天空 u→∞、點右緣芒草 u→1/2.2、點面板文字不動也不捲、點車手 u→1/6；TRAIN 回 TODAY 短暫尋焦、框不出現。
- hover 尺淡入（.88）、拖到車手峰值 8.6k 像素、拖到芒草 930、放開停住、輕點回 AF、閒置尺與峰值都收掉。console 零錯誤。
- headless 驗不了三層 backdrop-filter 的真實 GPU 成本，iPhone 要真機看；不行就降兩層。

### 同日補：身體頁訊號工作台、頂列兩個小調整
- 身體頁：九格訊號就是選擇器（`#body-tabs` 頁籤列 `hidden`，資料天數搬進格子小字；`paintBodyView` 與 mountReview 都會把選中那格標 `.is-on`）。
  桌機 ≥1100 是 `.bs-work` 兩欄：左 3×3（`grid-auto-rows:1fr` 撐到跟圖一樣高）、右 `#body-panel` 撐滿剩下寬度，圖表標頭壓成一行；標題橫跨兩欄。
  痠痛預估 ≥900 改兩欄（長條左、說明右）；`.wl-panel`／`.dm` 解除 820 上限。手機九格改成橫向滑動露出下一張。
- 頂列：選中 hub 不再有色塊與底線，只留白色英文＋琥珀中文；FX 檔位鈕不再用琥珀強調（OVERDRIVE 跟其他檔一樣灰）。
- `linkTreeIndex.html`：Strava 專用版那一列改成「STEVE · RIDE CINEMA／個人騎行資料與訓練控制台」：主卡（`assets/strava-cinema/ride-cinema-icon.svg`＋poster 預覽＋橘金亮邊）進 `strava_cinema.html`；
  四個歷代實驗版本收在「歷代實驗版本 · ARCHIVE 4」（`archiveOpen` 預設收合，展開是細小灰色清單，hover 才亮）。舊的四顆鈕與 STEVE 徽章拿掉。
- `linkTreeIndex.html` 立體感：星空每顆星有深度（近的大、亮、視差大），滑鼠視差（觸控裝置改慢速自動漂移）也帶動格線與星雲；
  固定 `.vignette` 暗角；卡片改浮起（頂緣亮邊、雙層陰影、hover 往上抬）；進場動畫加 translateZ／rotateX；
  主卡真 3D（`.rc-pv` 預覽當底層自己裁圓角，icon／文字 translateZ，游標帶動 ±5° 傾斜與預覽反向位移，離開回正）；火箭底下一圈暖光。reduced-motion 全關只留陰影。
