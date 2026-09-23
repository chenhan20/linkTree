# DESIGN.pelican.md — 只管 `strava_pelican.html`（鵜鶘海岸）＋ `strava-pelican-scene.js`

第七個視覺世界。根目錄的 `DESIGN.md` 只管 `strava.html`，對這一頁不適用；
impeccable hook 報的 `design-system-font` / `design-system-color` 在這裡是跨世界的預期 drift，不是缺陷。

## 概念

北海岸台 2 線的黃昏。頁首是一個 3D 場景：戴安全帽的白鵜鶘騎公路車往西，海在右手邊，太陽落在前方偏右的海上。
往下捲就是入夜——整頁的底色是夜海的墨藍，文字是鵜鶘羽毛的暖白。
數據章節是「一條線＋留白」的編輯式版面，**不做卡片**（卡片形狀只留給 tooltip 這種真的浮起來的東西）。

## 色彩

| token | 值 | 用途 |
|---|---|---|
| `--ink-0` | `#0d1322` | 頁面底（也是圖表的 surface） |
| `--ink-1/2/3` | `#121a2d` `#1a2338` `#242e47` | 軌道、熱力圖空格、未填的條 |
| `--text` / `-2` / `-3` | `#efe8dc` `#b4b7c3` `#7e8599` | 主文／次文／註腳與軸 |
| `--sun` | `#dc7336` | 圖表 slot 1：他自己、主序列（CTL、歷來最佳、月時數） |
| `--dusk` | `#8878e4` | 圖表 slot 2（ATL、最近 182 天） |
| `--sea` | `#1f9f95` | 圖表 slot 3（TSB、前 182 天、損益線、HRV 平均） |
| `--sun-ink` | `#ffb07a` | 文字用的日落橘（連結、章節編號），不是圖表色 |
| `--lamp` | `#f3c969` | 紀錄／PR 的標記點，只有這個用途 |
| `--warn` / `--good` | `#e8736a` / `#5cc29a` | 狀態色，只跟文字標籤一起出現 |

三個圖表色在深底上跑過 dataviz 驗證器（`--mode dark --surface #0d1322 --pairs all`）：
亮度帶、彩度、CVD（最差 ΔE 12.4）、一般視覺（20.6）、對比全部 PASS。**換色要重跑。**

序列色階（熱力圖、坡度、地圖亮度）只用日落橘一個色相，由暗到亮：
`#2b2230 → #4c2f2e → #7a3f2b → #a9552e → #d16e35 → #f29458 → #ffc28f`（深底上越亮＝越多）。

## 字體

- 章節大標：Noto Serif TC 700（中文標題是書頁感的來源）
- 其餘全部：Overpass（公路標誌字 Highway Gothic 的後代，跟「台 2 線」同一個語彙）＋系統中文
- 等寬：Overpass Mono，只給章節編號、軸刻度、鍵盤提示
- **大數字（TSB 那個 hero figure、讀數）一律無襯線**，不用襯線體；`tabular-nums` 只用在會上下對齊的欄

## 版面規則

- 常駐頂列 56px，捲動 40px 後轉實底；8 章的錨點＋目前所在章節高亮（手機橫向捲）
- Hero 高 `100svh − 88px`，第一章的標題列一定要「探頭」露在第一屏底部；中間那顆「往下 8 章」要寫出數字
- 章節頭：`01 / 08 · TODAY` → 襯線大標 → 一句**從資料算出來**的導言（不寫行銷句）
- 讀數：`dt`（小、灰）＋`dd`（大、白）＋一行對照，上下各一條細線
- 圖表：2px 線、4px 圓角柱頭、細實線格線（不用虛線）、≥2 條序列一定有圖例、每張圖都有 tooltip，
  主要圖表附「看表格」
- 一頁只有一個滿版飽和色塊：就是 3D hero 本身

## 3D 場景（`strava-pelican-scene.js`）

- 只依賴 `vendor-three-r128.js`；全部程序化，沒有外部圖檔。介面：`PelicanCoast.mount(host, opts)`、`parseFit(buf)`、`toReplay(fit, {start})`
- 座標：車子永遠在原點朝 −Z；世界往 +Z 流（跑步機）。x>0 海側、x<0 山側。物件有固定的世界座標 Zw，畫面上 z = Zw + dist
- **速度不是亂給的**：油門是最近一趟戶外騎乘 FIT 的逐秒功率／踏頻／心率，速度用
  `scripts/estimate-indoor-distance.py` 同一組平路參數現算（CdA 0.36、Crr 0.005、rho 1.18、人車 88 kg）。
  檔位從 `data/drivetrain.json` 的齒數挑最接近的組合。連續 ≥25 秒沒出力（下坡、停等）直接跳過
- 高畫質（桌機 WebGL2）：HalfFloat 場景 → bloom → 自己做 ACES + sRGB + 暗角 + 顆粒；
  低畫質（手機）：直接畫到螢幕、three 內建 ACES。動態解析度 0.6–1.5
- 標準材質都經過 `patch()`：霧換成「依視線方向取天色」、可加輪廓光（羽毛逆光）、芒草隨風擺。
  **每個變體都要自己的 `customProgramCacheKey`**，r128 用 `onBeforeCompile.toString()` 當快取鍵，同字串會撞
- 捲出畫面就停（IntersectionObserver）；`prefers-reduced-motion` 停在一張靜止畫面，暫停鈕改當播放
- 在地細節：消波塊、芒草、木麻黃防風林、石門風車（夜裡紅燈同步閃）、富貴角燈塔（旋轉光束）、漁火、路面「慢」字、台 2 線里程牌（數字是平路里程）

## 驗證

- 上班時間只用 headless（見 memory）。WebGL 要 `--use-angle=swiftshader --enable-unsafe-swiftshader`
- 靜態伺服器要**多執行緒**（`python3 -m http.server` 同時十幾個 fetch 會 ERR_CONNECTION_RESET）
- 除錯把手：`window.__pelican`（`stats()`、`shot(i, hold)`、`setCamera()`、`setTod()`、`_dbg()`）
