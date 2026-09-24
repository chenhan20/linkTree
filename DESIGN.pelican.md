# DESIGN.pelican.md — 只管 `strava_pelican.html`（鵜鶘騎單車）＋ `strava-pelican-scene.js`

第七個視覺世界。根目錄的 `DESIGN.md` 只管 `strava.html`，對這一頁不適用；
impeccable hook 報的 `design-system-font` / `design-system-color` 在這裡是跨世界的預期 drift，不是缺陷。

## 概念

頁首是一個 3D 場景：戴安全帽的白鵜鶘騎公路車，油門是他真實某一趟 FIT 的逐秒功率。兩個地點，同一套引擎：

- **大稻埕**（預設）：小台北・淡水河右岸往南（環小台北逆時針的方向），河在右手邊。
  堤防壁畫、五號水門、貨櫃市集與燈串、藍色公路渡船、每 1300 m 一座橋、對岸三重的天際線（倒影是在水面 shader 裡解析算的）、
  沿河往下游看得到觀音山、左前方 6 km 的 101、往松山機場進場的飛機。重播挑最近一趟有「大稻埕→馬場町」的騎乘，從那一段開始（對到秒）。
- **北海岸**：台 2 線往西、海在右手邊。消波塊、芒草、木麻黃、石門風車、富貴角燈塔、漁火。重播最近一趟戶外騎乘。

HUD 左上的切換鈕換地點（整個場景拆掉重建，選擇記在 localStorage `pelican-env`）。
往下捲就是入夜——整頁的底色是夜的墨藍，文字是鵜鶘羽毛的暖白。
數據章節是「一條線＋留白」的編輯式版面，**不做卡片**（卡片形狀只留給 tooltip 這種真的浮起來的東西）。

### 計時賽（影子對手）

重播一定落在某一段計時段上，旁邊有半透明的「影子」一起騎：

- **影子是誰**：自己這段最快那次（標 `PR`；重播的就是 PR 時改成「第二快」）＋「上一次」。
  路段在 `data/rivals.json` 有同事成績（例如社子島砍鴨頭的 TONY／JERRY／MARTIN）就換成同事，他們沒有 FIT，照平均速度騎
- **位置是真的**：同一個經過秒數下，各自 FIT 的距離差。進度縮放到官方路段長，所以終點時間差＝成績差
  （9/17 大稻埕→馬場町：落後 PR 59 秒、領先 9/8 45 秒，跟 11:49 / 10:50 / 12:34 對得上）。
  真實公尺再乘場景比例 `k`（這段功率用平路物理騎一遍的距離 ÷ 路段長），爬坡段才不會黏在一起
- **起點**：重播從起點前 10 秒開始，影子先並排騎；`start_time` 只到分鐘，用「路段長度的平均功率」對到秒
- **路段清單**：大稻埕＝大稻埕→馬場町、社子島砍鴨頭、社子島→馬場町；北海岸＝其他母路線的「全段」。HUD 右側面板的路段鈕打開選單換段、挑哪一次
- 第 05 章每一筆有 FIT 的成績有「重騎 ↑」，按了捲回頁首重播那一次
- 影子顏色：PR `#ff9a5a`（他自己的橘）、上一次 `--dusk`、同事用 rivals.json 的顏色；疊加亮度一律拉到同一個 Y≈0.45
- 名牌是 DOM（`.pc-tag`，場景每一幀擺位置）；離很遠時身上多一顆同色光點，330 m 內都看得到名牌
- **平路段的「換算」**（`data/itt-conditions.json`，scripts/build-itt-conditions.py）：同樣的逐秒功率、單騎、無風、rho 1.18 的秒數。
  第 05 章表格多一欄＋「團騎／偏快」小標（`.ctag`）＋空心圈（`.crown.eq`）標換算最快；計時賽面板起跑前與完賽後多一行「換算成單騎、無風」。
  2026-09-24 驗過：單騎誤差 ±3.4%；風在河濱清晨很小（有效係數 0.2），**團騎才是大頭**（12/10 那次 PR 被帶了 100 秒）

### 其他 HUD

- 快轉 1× / 2× / 4×（`F`）：整個世界一起快（踏頻、輪子、路），物理照樣逐步積分
- 拍照（`K`）：場景那一格＋底下一條圖說（日期、那趟、路段成績、當下速度功率踏頻），存成 PNG；手機走系統分享

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
| `--hud-accent` | `#ff9a5a` | HUD（壓在 3D 畫面上那一層）的日落橘：速度弧、功率走勢條、計時賽進度、PR 影子 |
| `--hud-up` / `--hud-dn` | `#8fe0bf` / `#ffa39b` | HUD 上的「領先／落後」；`--good`／`--warn` 的亮版，毛玻璃上才讀得到，一樣只跟文字一起出現 |

HUD 的底一律是夜色毛玻璃 `rgba(10, 13, 24, .3–.5)`＋`rgba(246, 239, 228, …)` 的暖白細框與字（選單 `.96` 近乎實底）；
影子對手的顏色見下面「計時賽」。impeccable hook 會把這些報成 `design-system-color`——它只讀根目錄的 DESIGN.md，這是預期的。

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

- 只依賴 `vendor-three-r128.js`；全部程序化，沒有外部圖檔。介面：`PelicanCoast.mount(host, { env: 'river'|'coast', … })`、`parseFit(buf)`（含 GPS）、`toReplay(fit, {start})`、
  `api.setRace({ s0, T, L, rep, ghosts })`、`api.setRate(r)`、`api.snapshot(maxW)`、`api.dispose()`
- 影子＝同一副骨架 `buildRider()` 換全息材質（菲涅耳邊緣光＋加法混色＋掃描線），`rigid` 零件群先併成一個網格：一隻 23 個 draw call（本尊 123）。手機最多三隻
- 兩個地點的差異都在 `ENVS`（水面高度、路寬、欄杆、路燈、太陽方位、浪的大小）；只在其中一個地點出現的道具用 `COAST`／`RIVER` 分支建
- 座標：車子永遠在原點朝 −Z；世界往 +Z 流（跑步機）。x>0 水那一側、x<0 陸地。物件有固定的世界座標 Zw，畫面上 z = Zw + dist
- **速度不是亂給的**：油門是那一趟的逐秒功率／踏頻／心率，速度用 `scripts/estimate-indoor-distance.py` 同一組平路參數現算
  （CdA 0.36、Crr 0.005、rho 1.18、人車 88 kg）。檔位從 `data/drivetrain.json` 挑最接近的齒比。連續 ≥25 秒沒出力直接跳過
- 解析度：起跳＝裝置像素密度（最多 2），最近 90 幀中位數 > 22 ms 才降 0.25、跑得順每 8 秒試著升回來，下限 1.0；密度 ≥ 1.5 不開 MSAA
- 高畫質（桌機 WebGL2）：HalfFloat 場景 → bloom → 自己做 ACES + sRGB + 暗角 + 顆粒；低畫質（手機）：three 內建 ACES
- 標準材質都經過 `patch()`：霧換成「依視線方向取天色」、可加輪廓光、芒草隨風擺。
  **每個變體都要自己的 `customProgramCacheKey`**，r128 用 `onBeforeCompile.toString()` 當快取鍵，同字串會撞
- 捲出畫面就停（IntersectionObserver）；`prefers-reduced-motion` 停在一張靜止畫面，暫停鈕改當播放
- 踩過的坑：InstancedMesh 的 `setColorAt` 會用「當下的 count」開陣列（先把 count 設 0 就全黑）；
  `dispose()` 裡強制丟 context 會觸發舊畫布的 contextlost，要先拆掉那個 listener；負數開非整數次方＝NaN（護岸斜坡）

## 驗證

- 上班時間只用 headless（見 memory）。WebGL 要 `--use-angle=swiftshader --enable-unsafe-swiftshader`
- 靜態伺服器要**多執行緒**（`python3 -m http.server` 同時十幾個 fetch 會 ERR_CONNECTION_RESET）
- 除錯把手：`window.__pelican`（`stats()`（含 `riF`、每隻影子的 `z`／透明度）、`race`（階段、每隻影子的時間差）、`seek(秒)`、`shot(i, hold)`、`setCamera()`、`setTod()`、`_warp(公尺)`、`_pr(密度)`、`_dbg()`）
- headless 的軟體 GPU 大概 1 fps，場景時間幾乎不走：測計時賽要等 `__pelican.race` 出現後用 `seek(起點 + 秒數)` 跳過去，
  起點＝`stats().riF − race.tau`。`seek` 會擋 NaN（race 還沒載到就 seek 曾經讓整個場景變 NaN）
