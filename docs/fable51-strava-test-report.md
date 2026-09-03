# STRAVA TELEMETRY · OVERDRIVE — 測試報告（2026-09-02）

候選檔 `strava_fable51.html`（＋ `theme-fable51.css`、`strava-fable51-fx.js`）。原版 `strava.html` 在整個開發與驗收期間沒有任何修改（`git status` 乾淨）。
設計決策與 parity checklist 在 `docs/fable51-strava-design-notes.md`。

## 1. 環境與方法
- 頁面靠 `fetch` 載 18 支 JSON，一律透過 `python3 -m http.server 8765` 走 HTTP，沒有用 `file://`。
- 驗證管線：本機 Google Chrome 152 的 `--headless=new` ＋ CDP（Node 24 內建 WebSocket），WebGL 走 `--use-angle=swiftshader`（軟體渲染）。
  腳本在 `docs/review/probe/`（README 有指令），每個尺寸跑同一份探針：等 `strava:data-ready`、逐一切九個 view 量 hash／`is-on`／導覽現用項／body 溢位、
  返回／前進、抽屜、Log 展開與活動 modal、3D 回放六種操作、ITT 深連結＋重播＋拖曳＋挑戰簿、Atlas 縮放／飛行／切換／拖曳、Trends 讀數與彈窗、
  Harvest hover／focus／抽屜／篩選、Body 指標與範圍切換、三種效果模式與 localStorage、分頁隱藏五輪、SCENE LAB、鍵盤 Esc、手機觸控靶與底部導覽、console。
- HTTP 快取關閉（`Network.setCacheDisabled`），所以「拔掉特效檔」的降級測試量到的是真的沒載入。
- **headless 的 rAF 計數不能當效能數字**：同一台機器上原版 `strava.html` 在 1440×1000 也只量到 0 次／秒。探針另外量「動效層 JS 端每幀成本」；raster 端要在真機看（見 §8）。

## 2. 結果總表（第五輪全尺寸，2026-09-02 晚）

**第六輪（攻擊式騎士、側欄全景、照片接口）只重跑了 1440 桌機：113／113、console 0**（使用者指示先著重 PC 版；
其餘尺寸沿用第五輪的結果，改動不碰版面，但手機的騎士姿勢混合與側欄不建畫布這兩點沒有重新量）。

### 第五輪全尺寸
| 尺寸 | 標籤 | 通過／失敗 | console 錯誤 | 備註 |
|---|---|---|---|---|
| 1440×1000 desktop | d1440 | 113／0 | 0 | 正式截圖來源；底圖畫布鋪滿、星野 display:none 且 loop 停、路網六階＋12 地點、OVERDRIVE 有光沿路跑 |
| 1440×1000 + `prefers-reduced-motion: reduce` | d1440r | 104／0 | 0 | QUIET 鎖定；底圖靜態一張、沒有光、Ticker 0 個工作 |
| 1024×768 compact，**改名為 `strava.html`** 從另一個目錄（symlink 資料）載入 | r1024 | 113／0 | 0 | 路網用相對路徑 `data/ride-atlas.json`，改名後照抓 |
| 390×844 phone（touch 模擬、DPR 2） | m390 | 110／0 | 0 | 手機不抓路網（`wantRoads=false`、`routes==null`），只鋪天光與山脊 |
| 360×800 narrow phone | m360 | 110／0 | 0 | 同上 |
| 2560×1440 large desktop | d2560 | 113／0 | 0 | 底圖 DPR 壓到 1 |
| 390×844 + `prefers-reduced-motion: reduce` | m390r | 101／0 | 0 | |
| 1440×1000，擋掉 `strava-fable51-fx.js` ＋ `theme-fable51.css` | nofx | 22／0 | 0 | 沒有 `data-bg`，原本的星野與星雲照舊 |
| 1440×1000，擋掉 `data/strava.json` | nofx | （含上列） | 0 | 底圖仍在（不靠主資料），data-error 後才去抓路網 |

**探針只能一次開一顆 Chrome。** 這一輪先把四到五顆軟體渲染的 Chrome 併跑，抽屜、tween、地圖籌碼的逾時全部打爆，
看起來像整批回歸；抽屜在候選版與原版單獨跑都是同一幀打開。上表是依序一顆一顆跑的結果（探針本身也改成「安定後才量」：進場 pop-in 的 transform 會短暫撐出 scrollWidth、no-fx 下抽屜在七個艙室都掛好之後要 1.5 秒才開，固定等待改成輪詢）。
第一到三輪的紀錄在 git 之前的版本；探針多了底圖的六條檢查（`docs/review/probe/probe.js`）。JSON 報告：`docs/review/probe/shots/*-report.json`。

## 3. 逐項驗證（對應 prompt 的 Phase 4 清單）
- URL hash：七個艙室 `#<deck>` 正確；舊名 `#overview`／`#plan`／`#playbook`／`#trends`／`#harvest` 全部別名到新艙室；深連結 `#itt/segment/<id>`、`#train/session/<date>`（舊的 `#plan/session/` 也通）、`#engine/month/<m>`（舊的 `#harvest/month/` 也通）各自開到對的東西。
- 返回／前進：`history.back()` 回 `#deck`、`forward()` 回 `#engine`，`appState.view` 同步。
- 抽屜：課表列、訓練軌道節點、收成月份三個入口開同一個抽屜；`✕`／`‹ 返回`／Esc 都關；手機是整屏子頁面。
- 活動 modal：`.act-detail-btn` 由 activity-modal.js 注入（三個 class 沒改名），開關正常。
- ITT 深連結：捲到 `scroll-margin-top` 64px 對齊並打光；12 座檯全部建出（headless 用 swiftshader）；重播 PR 有里程／海拔／坡度即時讀數與進度條，停止、自轉切換、拖曳轉檯、挑戰簿展開都正常；離開 ITT 後 loop 自停（`__tsv.raf == null`）。
- 3D route replay（Log 的 🛰️）：開、three 載入、播放推進、2× 切換、拖曳到 0.5、重來、關閉。
- Atlas：放大、膠囊飛行＋鎖定環、暈染／行政區切換、台北回復、拖曳平移。
- Trends：月度量指標×範圍切換、功率曲線讀數、功率時間切面三個數字、功率彈窗開關；兩年互追、時段條、雷達、環形都在。
- Harvest：hover 與 focus 讀數（touch 鎖定走同一條 focus 路徑）、月細目抽屜、篩選；配對弧線在收成 lane 裡；動畫跑完 inline transform 清乾淨。
- Body：星座六列讀數、指標切換、範圍切換、DOMS、功率-心率曲線。
- 效果模式：ACTIVE（星野停、名片星座停、畫布 lite、30fps、localStorage 記住、重整仍是 ACTIVE）、QUIET（畫布靜態、Ticker 閒置、rAF 近零）、回 OVERDRIVE。
- 背景分頁：`document.hidden` → Ticker 停；回來只恢復同一個 loop；連續五輪 hide／show 後 rAF 排程量沒有累積。
- SCENE LAB：四個場景可預覽，場景名前加 `SIMULATION ·`、說明改成「這是預覽，真實判讀是 BUILD」；回 LIVE 完整還原；場景切換是 1.3 秒插值不是硬切。
- 手機：重要觸控靶 ≥ 44px（底部籤、模式循環鈕 40px 高＋44px 寬、軌道節點 44px、SCENE LAB 鈕 36px 高）；底部 7 籤；沒有 body 橫向溢位。
- Launch Hero（Ridge Dawn）：畫布在 `#hero` 裡、鋪滿主欄（1440 → 1252px、2560 → 2276px、390 → 390px）；大讀數 Michroma、UI Inter Tight、表格數字 Barlow Condensed（computed style 驗證）；Pogačar 姿勢的騎士在 BUILD／FRESH／REDLINE 都飛在大讀數上方（截圖 `fable51-hero-rider-*.png`、`fable51-hero-scenelab-*.png`）；NO SIGNAL 沒有騎士只有濃霧與診斷網格。
- Ghost Roads 底圖：`html[data-bg=roads]` 之後 `#star-canvas` display:none 且 `__starfield.paused===true`（display:none 的畫布不該跑 rAF）；`#bgfield` 與 `innerWidth×innerHeight` 相差 <2px；桌機在閒置回呼裡抓到路網（實測 data-ready 後 300–600ms），六階折線＋12 個 ITT 地點畫進離屏層；OVERDRIVE 9 秒內有光沿路跑（串 5–16 段折線、700–1600px）；捲頁視差讀 window.scrollY（實測 1180／1710 都跟上）；髒矩形補回的畫面跟整張重畫逐像素比對差異 0（截圖 `fable51-background-*.png`、`fable51-overview-desktop-scrolled.png`）。
- 騎士：`__fx.Rider.paint` 在一張 400×250 畫布上畫一次要有像素、不丟例外；離線跑 4.8 秒的 step 要站起來（stand=1）、速度到 2.5 倍以上、還在畫面裡；DPR 2 特寫 `fable51-hero-rider-seated-zoom.png`／`fable51-hero-rider-attack-zoom.png`（凍住 loop 手動 spawn 再 step 到指定時刻拍的）。
- 側欄全景：量到 hero 幾何（W>600、top≥0）、山脊層畫好、畫布有像素、OVERDRIVE 在跑／reduced motion 靜態（截圖 `fable51-sidebar-panorama.png`）。
- console：所有輪次 0 個新錯誤（名言 CDN jsDelivr 在離線時的 404 屬原版既有行為，不計）。

## 4. 真實資料下的四種氣象
今天（2026-09-02）判讀為 **BUILD**（TSB −0.2）。09/02 的 CTL／ATL 是 intervals.icu 在 09-01 那班同步寫進來的推算值；氣象列跟側欄狀態儀表用的是同一條 `wellnessDays()` 切到今天的規則，兩邊永遠同一個數字。
四種場景的判定門檻與參數映射在設計筆記 §4；FRESH／REDLINE／NO SIGNAL 由 SCENE LAB 預覽驗證（截圖 `fable51-overview-desktop-scenelab-redline.png`）。
NO SIGNAL 的自動觸發路徑（沒有 wellness／超過 3 天沒同步）以 `buildAtmosphere()` 的分支覆蓋，沒有假造資料去觸發。

## 5. 效能措施與量測
- 全站唯一一個 rAF（`Ticker`）：氣象層、粒子爆發、地圖飛行共用；沒有工作就停，`document.hidden` 就停。
- 畫布 DPR 上限 2（手機 1.5）；霧與 bokeh 用預繪 sprite 貼圖，不在每幀建 gradient；粒子固定上限（桌機 48、手機 22、ACTIVE 減半）；粒子爆發物件池 140。
- 每幀不呼叫 `getBoundingClientRect`（事件波、爆發只在觸發那一刻量一次）。
- 頁面自己的三個 loop 多了把手：星野（ACTIVE／QUIET 停在靜態星圖）、名片星座（不在 Overview 就停 —— 原版它是永遠在跑的）、ITT 測量檯（沒有檯可見就停，IntersectionObserver 叫醒）。
- 量到的動效層 JS 端每幀成本：1440×1000 0.13 ms、390×844 0.15 ms（canvas 指令排入時間；raster 在 GPU）。
- 只有一個 Three.js renderer（原版設計）；離開 ITT 後 loop 停。

## 6. reduced motion 行為
`<head>` 開場腳本讀到 `prefers-reduced-motion: reduce` 就把 `html[data-fx]` 壓成 `quiet`（優先於 localStorage），控制項鎖住並標 `REDUCED MOTION`；
畫布畫一張由真實場景生成的靜態終態（探針驗證 canvas 有像素）；原版的十個 reduced-motion 區塊照舊；anime 動效層不載入；
theme 的 `@media (prefers-reduced-motion:reduce)` 再保險一次（不靠 JS 也成立）。所有新動畫的終態＝CSS 預設值，圖表與讀數完整。

## 7. 第二次反相似度審查（桌面與手機截圖）
看的是 `docs/review/fable51-*.png`（第三輪重拍 18 張：1440 桌機十一張、390 手機三張、360 一張、2560 一張、字體比較一張）。
- 記震紙的十一項否定清單：紙紋、鏽紅格線、疊列合成波形、編號錨點列、黑底反白按鈕、等寬斜線零、1px 黑框直角、正片／負片、`ND`、斜線 hatch、「n 筆」右欄 —— 候選版全部為零。
  唯一的斜線是收成頁「室內／訓練台」時數柱的紋理，那是 `strava.html` 原本就有的語意編碼，不是記震紙的缺值符號。
- 維修站牆的辨識組合：平黑底、六格雙語底軌、框式 ← BACK、`站 · 面 · n/m`、右緣直條、面尾去向提示、灰階 emoji、手機底軌懸空 —— 全部沒有。
  底色是深空徑向漸層加氣象層色溫；導覽是原版的側欄／九籤玻璃膠囊；狀態核心與大讀數帶橘暈；emoji 原色。
- 第一眼：桌機是「全幅 Ridge Dawn hero（層疊山脊、地平線上的太陽、柔焦的高空雲與前景、白衣彩虹條的騎士飛過）＋壓在山脊暗面上的 Michroma 大讀數＋帶編號與訊號脊柱的側欄」，手機是「全幅 hero ＋底部七籤膠囊」。沒有一張截圖會被誤認成那兩個舊方向。

## 8. 已知問題
0. 原版的 `.side-rocket` 小火箭與名片的星座 canvas 都還在（前者在 ACTIVE／QUIET 停），hero 裡的星座畫布壓到 .42 透明度 —— 若嫌畫面太滿，拿掉星座畫布是一行 CSS。
0b. Michroma 的數字寬度差 2%（`1111` 304px、`9999` 310px），不是嚴格 tabular：大讀數 count-up 那 1.6 秒最多抖一兩個像素，之後靜止；表格與列裡的小數字仍是有 tnum 的 Barlow Condensed。
0d. 底圖的路網是「路網分類後的折線」，每段只到路口為止；一道光要看起來像一趟騎乘得在路口接下一段（端點索引 6px 網格）。極少數孤立的短段（<60px 又接不到別條）會被跳過不發光。
0c. 騎士出場的時序是用累計 dt 算的：軟體渲染的 headless 一幀要 300–500ms，所以探針裡他 7 秒才出場、19 秒才飛到三成；真機 60fps 是 1.8 秒出場、9 秒飛完。
1. headless 只能證明「loop 有沒有停、有沒有累積」，證明不了真機 fps；氣象層的 raster 成本沒有在手機實測（sprite 化之後理論上是 60 次 drawImage／幀）。
2. 390px 下 SCENE LAB 的五顆鈕會折成兩行；apphead 的更新時間折成兩行（刻意，字不掉）。
3. 收成延遲場的弧線只畫「隔 1–3 個月」的配對，目前資料只有兩對，弧線稀。
4. Log 的日期解碼只做進入視野的日期列；PR 掃光只出現在真的功率 PR 日（`.td-pr`）。
5. Atlas 鏡頭飛行靠在點擊瞬間暫時替換 `window.atDraw`；若日後地圖程式改了函式名，飛行退回原版的瞬移，不會壞。
6. 首次進站 `setView` 不發 `strava:view`（原版行為），動效層改在 `data-ready` 後補跑進站艙室的 signature。
7. `docs/review/` 的截圖共約 11 MB。
8. 名言 CDN（jsDelivr）是外部請求，離線時 404 走原版降級。

## 9. 如何替換正式頁、如何還原
替換（原版由 git 保管，不必另存備份）：
```bash
git pull --rebase                       # CI 每天自己 commit
cp strava_fable51.html strava.html
git add strava.html theme-fable51.css strava-fable51-fx.js docs/fable51-strava-design-notes.md docs/fable51-strava-test-report.md docs/review
git commit -m "feat(strava): OVERDRIVE 接管正式頁"
```
之後 `strava_fable51.html` 可以刪掉（它跟 `strava.html` 會是同一份）。改名不影響任何相對路徑、hash、localStorage key（`fx-mode-v1`、`qbFav:*`、`itt-card-order-v1`）。
還原：`git checkout HEAD~1 -- strava.html`（或 `git show <commit>:strava.html > strava.html`），把 `theme-fable51.css`／`strava-fable51-fx.js` 留著也無害（沒有頁面引用）。
GitHub Pages 會快取這兩支新檔，日後改動記得推 `?v=` 日期。

## 10. 候選版對原版 HTML 的補丁清單（第一輪 24 個錨點 ＋ 第二輪 12 個 ＋ 第三輪 1 個，全部在 `strava_fable51.html`）
`<head>`：效果模式開場腳本、`theme-fable51.css` link、`.fx-host`／`.atm-bar` 的基礎樣式。
`<body>`：`#atm` 畫布；星野 loop 的 pause／resume 把手；名片星座 loop 的把手；ITT 測量檯 loop 的自停與叫醒；`buildAtmosphere()`／`renderAtmosphereBar()`；
Overview 氣象列與狀態核心宿主、Plan／Trends／Harvest／Body 各一個宿主；render 完成派發 `strava:data-ready`（失敗 `strava:data-error`）；
anime 動效層在 QUIET 模式落到終態；尾端載入 `strava-fable51-fx.js`。
第二輪：`VIEWS` 換成七艙室＋`VIEW_ALIAS`／`viewId()`；`setView`／`routeFromHash`／抽屜 hash／導覽徽章改用新 id；`viewsHtml` 重新分配區塊並在指揮艙頂端加 `#hero`（畫布搬進去）；Google Fonts 加 Barlow Condensed／Space Grotesk／JetBrains Mono。
第三輪：Google Fonts 換成 Barlow Condensed／Michroma／Inter Tight／JetBrains Mono（其餘全在 theme 與 fx 兩支檔）。
第四輪：只動了兩支檔的 `?v=` 快取戳記；底圖全在 theme 第 14 節與 fx 的 `Field` 模組。
頂層宣告比對：原版的每一個都在，多了 `buildAtmosphere`、`renderAtmosphereBar`、`VIEW_ALIAS`、`viewId`。
