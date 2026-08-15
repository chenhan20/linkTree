# 騎乘地圖（ride atlas）移植到 strava.html

把「軌跡疊圖 + 行政區歸戶」那張地圖接進 `strava.html`。
原型是在 scratchpad 做的淺底紙圖，strava.html 是深色世界，**色階與底圖要重做，資料管線可以整套搬**。

---

## 0. 狀態：已經接好了（2026-08-15）

`strava.html` 已經有 **Atlas 頁籤**（側欄「地圖 / Atlas」，網址 `#atlas`），
位置在 ITT 與趨勢之間。下面幾節是實作時的決定與踩過的坑，改之前先讀。

實際用的識別字：

| 東西 | 名字 |
|---|---|
| view id | `atlas`（`VIEWS` 陣列、`<section class="view" data-view="atlas">`） |
| 掛載 | `mountAtlas()`，由 `setView()` 在 `v === 'atlas'` 時呼叫 |
| 狀態物件 | `const AT = { ... }`，所有函式前綴 `at`（`atDraw` / `atResize` / `atReadout` …） |
| CSS 前綴 | `.at-*`，色階變數 `--at-r1..r6`（路線）、`--at-g1..g5`（行政區） |
| 資料 | `data/ride-atlas.json`，`fetchData()` 在 `mountAtlas()` 裡才發請求 |

相關檔案：

| 檔案 | 是什麼 |
|---|---|
| `scripts/build-ride-atlas.py` | 資料管線，唯一進入點，跑一次約 4 秒 |
| `data/geo/{towns,counties}-10t.json` | 內政部界線（taiwan-atlas） |
| `data/ride-atlas.json` | 產物，1.25 MB |
| `docs/ride-atlas-prototype.html` | 淺底原型，瀏覽器直接開，只當參考 |

> 原型是**淺底**、strava.html 是深色，色階不同（第 3 節）。原型會固定觸發
> impeccable 的 DESIGN.md 偏離檢查，那是刻意的另一個視覺世界，不是缺陷。
> 嫌吵：`/impeccable hooks ignore-file "docs/ride-atlas-prototype.html"`。

### 資料更新後要做什麼

騎乘或 ITT 設定有變動時：

```bash
python3 scripts/build-ride-atlas.py     # 重新產生 data/ride-atlas.json
```

`strava.html` 不用改。地名層是從 `itt-config.json` 的 `groups[]` 讀的，
新增母路線會自動出現在膠囊列與地圖上。

---

## 1. 資料管線

### 輸入

| 來源 | 用途 |
|---|---|
| `data/strava-archive/index.json` | 活動清單（320 筆，含各運動） |
| `data/strava-archive/activities/<id>.json` | 完整折線 `map.polyline`（**不是** summary） |
| `data/itt-config.json` | `segments[].nameZh` —— 地名庫 |
| `data/itt-segments.json` | `efforts[]` 長度 —— **你本人**的次數 |
| `data/geo/towns-10t.json` | 行政區界 |
| `data/geo/counties-10t.json` | 縣市界 + 海岸線 |

### 輸出：`data/ride-atlas.json`（約 1.25 MB）

```jsonc
{
  "meta": {
    "cell_m": 25,            // 網格邊長
    "rdp_m": 8,              // 折線簡化誤差
    "breaks": [1,2,4,8,16,32],
    "activities": 102,
    "max_n": 49,
    "total_km": 3470,
    "towns_ridden": 61,
    "projection": "EPSG:3826 TWD97/TM2"
  },
  // 6 個色階各自的折線集合。點是 [x, y, n]：
  //   x,y = TM2 公尺（整數），n = 該點所在 25 m 格的不重複騎乘趟數
  "routes": [ [ [[302145,2770310,35], ...], ... ], ... ],
  // 行政區：只收「騎過的 + 北北基」，共 80 個
  "towns":  [ { "name":"士林區","county":"台北市","km":1130.1,"rides":71,
                "rings":[[[121.5,25.1], ...]] }, ... ],
  // 你自己命名的路段（中點座標 + 你自己的次數）
  "places": [ { "name":"中社路","lng":121.56161,"lat":25.10755,"n":35 }, ... ],
  // 縮小到全台時的底圖（arc 拓樸，共用界線只存一份）
  "coast":  { "arcs":[...], "arcKind":[...], "counties":[...] }
}
```

### 產生

```bash
python3 scripts/build-ride-atlas.py     # 約 4 秒，純本機，不打 API
```

### 演算法的三個關鍵決定

**1. 先重新取樣，再數趟數。**
Strava 按時間取樣，慢的地方點密、快的地方點疏。直接數點會把等紅燈的路口染成最熱。
軌跡先沿線**每 25 公尺插一點**，再數「有幾趟**不重複**的騎乘經過這一格」。

**2. 折線依所在格上色，不用加法混色。**
Strava 那種熱力圖是疊色：疊越多越亮。缺點是顏色不可控、疊十次就飽和、讀不出數字。
這裡是先把 25 m 格的趟數算好，再把簡化後的折線切成「同色階的連續段」。
線是銳利的，數字是精確的，hover 讀得出「這段 35 趟」。

> 切段時記得 `run = run[-1:]`，把上一段的最後一點接到下一段的開頭，否則色階交界會斷線。

**3. 資料清洗（不做的話圖會是錯的）**

| 要排除 | 為什麼 |
|---|---|
| `type === 'VirtualRide'` | ROUVY/Zwift 把課表掛在**歐洲、南非實景路線的真實座標**上。實測 9 趟落在挪威、法國、南非。 |
| 不在台灣 bbox 的 | 4 趟在日本直島（`直島騎腳踏車看南瓜`）。 |
| Strava 的 `effort_count` | 那是**全站所有人**的次數（中社路 34 萬次）。你自己的次數在 `itt-segments.json` 的 `efforts[]` 長度。 |

---

## 2. 接進 strava.html

### 2.1 新增一個 view

`strava.html` 的頁面切換是三塊：`const VIEWS = [` 陣列、`<section class="view" data-view="...">`、`initRouter()`。

> 這份文件一律用符號名定位，不寫行號——`strava.html` 一直在改，行號會漂。
> `grep -n 'const VIEWS = \[\|function mountItt\|Promise.all(\[' strava.html`

```js
// VIEWS 加一筆
{ id: 'atlas', zh: '地圖', en: 'ATLAS' }
```

```html
<!-- #content 裡加一個 section -->
<section class="view" data-view="atlas">
  <div class="atlas-rail" id="atlasRail"></div>
  <div class="atlas-stage"><canvas id="atlasMap"></canvas></div>
</section>
```

### 2.2 資料要**延後**載入

`data/ride-atlas.json` 有 1.25 MB。**不要**加進那個 `Promise.all([`（`grep -n 'Promise.all(\[' strava.html`）——
那會讓首屏多等一份四分之一 strava.json 大小的檔案，而這張圖多數時候不會被打開。

照 `mountItt()` 的既有慣例做 lazy mount（`grep -n 'function mountItt' strava.html`）：

```js
let _atlasReady = false
function mountAtlas() {
  if (_atlasReady) return
  if (!document.querySelector('#content .view[data-view="atlas"] canvas')) return
  _atlasReady = true
  fetchData('data/ride-atlas.json')
    .then(r => r.ok ? r.json() : null)
    .then(d => { if (!d) return; window._atlas = d; initAtlas(d) })
    .catch(() => {})   // 缺檔就是空白面板，不能讓整頁掛掉
}
```

在 router 切到 `atlas` 時呼叫 `mountAtlas()`，跟 `mountItt()` 同一個位置。

### 2.3 首次繪製的時機（**這裡會踩坑**）

隱藏的窗格量不到寬度、`requestAnimationFrame` 也不跑。
**初次 `draw()` 一定要在 view 真的顯示之後**，而且尺寸要用 DOM 量測，不要靠 rAF：

```js
function initAtlas(d) {
  // ...建好 typed array...
  requestAnimationFrame(() => {           // 讓 section 先完成 layout
    const r = canvas.parentElement.getBoundingClientRect()
    if (r.width < 10) return              // 還沒顯示，等下次進 view 再來
    resize(false)
  })
}
```

（同樣的坑在 `docs/` 其他地方也記過：strava.html 的截圖會空白／陳舊，就是這個原因。）

---

## 3. 深色版色階（已驗證）

原型是淺底紙圖，那組色在 `#0a0408` 上不成立，必須重配。
下面兩組是在 strava.html 的實際底色 `#0a0408` 上跑過 `validate_palette.js --ordinal --mode dark` 的結果。

### 路線（6 階，全數通過）

```css
--atlas-r1:#7a3410;  /* 1 趟   —— 對底色 2.25:1，剛好讀得出來 */
--atlas-r2:#a84a12;  /* 2–3   */
--atlas-r3:#d0611a;  /* 4–7   */
--atlas-r4:#ec8340;  /* 8–15  */
--atlas-r5:#f5a771;  /* 16–31 */
--atlas-r6:#fbc9a6;  /* 32+   */
```

> 注意方向反過來：淺底是「越常騎越深」，深底是**「越常騎越亮」**。
> 最亮那階刻意不用 `--sig`（#FC4C02）——那顆橘在 DESIGN.md 裡是「訊號色」，
> 拿來當序列的一階會讓它失去訊號的身分。

驗證結果：亮度單調 PASS、階距 ≥0.06 PASS、最暗階對底色 2.25:1 PASS、單一色相（色相跨度 12°）PASS。

### 行政區（5 階，中性暖灰）

```css
--atlas-g1:#241e18;  /* <5 km    */
--atlas-g2:#382e25;  /* 5–30     */
--atlas-g3:#4e4234;  /* 30–120   */
--atlas-g4:#665744;  /* 120–450  */
--atlas-g5:#816f57;  /* 450+     */
```

驗證結果：亮度單調 PASS、階距 PASS、單一色相 PASS。
**最暗階對底色只有 1.23:1，這是刻意的**——這是 sequential choropleth 不是 ordinal，
「幾乎沒騎過的區」本來就該退到背景。規範要求的補償是「顏色不能是唯一線索」，
所以每個區一律附**區名 + 公里數**，而且 hover 有精確讀數。移植時這三件事不能拿掉。

---

## 4. 繪製層順序

由下而上，順序錯了會互相蓋掉：

```
1. 海         填 --surface 或更暗一階
2. 陸地       coast.counties 的 main 群組，evenodd（台北市是新北市裡的洞）
3. 行政區填色 灰階，整層 globalAlpha = 0.72（讓它退到背景）
4. 行政區界   1px hairline，globalAlpha 記得復原成 1
5. 海岸線     arcKind === 0
6. 暈染層     見下節
7. 路線       6 個色階分批 stroke，淺的先畫、深的壓上面
8. 標籤       行政區名 → 路段名（共用同一份碰撞盒）
9. 比例尺
```

### 暈染（區塊感）

同一組線畫粗、模糊後墊在銳利線底下。密的地方連成一塊、疏的地方仍是一條線，
所以「區塊感」跟「路線輪廓」可以同時成立。

**必須降解析度做，否則會卡。** 模糊的成本跟「像素數 × 半徑」成正比：

| | 無 | 淡（5px） | 濃（11px） |
|---|---|---|---|
| 全解析度 | 2.9 ms | 35.4 ms | **147.5 ms**（7 fps，不能用） |
| 降到 1/2 | 3.2 ms | 28.7 ms | **37.3 ms** |

做法：縮到 `1/S` 的離屏畫布上畫線 → 在那個尺寸模糊 `半徑/S` → 放大回來。
模糊本來就是低頻訊號，視覺上分不出差別。拖曳時 `S = 4`，靜止 `S = 2`。

模糊半徑用**螢幕像素**固定，縮放時區塊感的強度才不會變。
關掉暈染時要補一道底色 casing（`lineWidth + 1.5`），否則深色線會糊進深色的行政區。

---

## 5. 標名門檻

| 圖層 | 門檻 | 結果 |
|---|---|---|
| 路段名 | `n >= 5` | 12 條母路線剩 8 條 |
| 行政區名 | `km >= 10` | 61 個標 35 個。**未達門檻的仍然填色**，所以「有沒有騎過」看得出來 |
| 行政區名 | 螢幕寬 < 42px 不標 | 縮小時免得糊成一團 |

兩層標籤共用同一個碰撞盒陣列，先畫的先佔位。順序是「行政區名 → 路段名」，
所以擠不下時犧牲的是路段名（行政區是底圖，位置固定比較重要）。

### 地名要收斂到「母路線」，不能用個別分段

ITT 改成「母路線 + 分段」之後，`itt-config.json` 的 `segments[]` 有 27 條，
光中社路就 6 條、至善路 5 條、風櫃嘴 6 條，**每條都超過標名門檻**，
會在同一條路上疊成一坨。

命名層要用 `itt-config.json` 的 `groups[]`：一組出一個名字，
名字取 `groups[].nameZh`，次數取**該組所有分段裡最高的**
（分段常常比全段筆數多，例如至善路的「中社橋→明德坡頂」14 次 > 全段），
座標用那條最高分段的中點。收斂後是 12 條：

```
 35 中社路          22 劍中劍            5 關渡–美堤河濱
 29 劍南路・至善側    14 至善路・明德坡      4 碧山
 26 劍南路・北安側    12 風櫃嘴            4 基隆河東段
                   11 社子島砍鴨頭        3 南深路 / 2 河濱10K
```

---

## 6. 預設視角（踩過的坑）

**不要用 bbox，也不要用 x/y 各自的分位數。**

- bbox：一趟騎到彰化就把畫面整個拉開，退到 1 px ≈ 370 m，線細得跟頭髮一樣。
- 行政區 bbox：士林區一路延伸到陽明山，退到 1 px ≈ 36 m，一樣看不到輪廓。
- x/y 各自的加權分位數：騎乘分布是 **L 形**（台北一團 + 往西南一條），
  兩軸獨立取分位數算出的中心會落在中間那塊**沒有資料的空地**上，
  一放大就整片空白（實測最近的格子在 24.7 km 外）。

可用的版本：**只框「騎過 8 趟以上」的路段**（`r.b >= 3`）。
現在的預設是 1 px ≈ 20.7 m，社子島環線、基隆河兩岸、內湖那張網都分得出來。

另外「＋」鍵的錨點要取**畫面內趟數最高的那一格**，不是畫面正中央——
重心常常落在兩條路之間的空地，朝那裡放大會愈放愈空。

---

## 7. 驗收清單

- [ ] `python3 scripts/build-ride-atlas.py` 產出 `data/ride-atlas.json`，`towns_ridden` = 61
- [ ] 切到 atlas view 才發出 `ride-atlas.json` 的請求（Network 面板確認）
- [ ] 刪掉 `data/ride-atlas.json` 後整頁仍正常，只是 atlas 面板空白
- [ ] 首次進 view 就畫得出來（不是切走再切回來才出現）
- [ ] hover 同時報「路段趟數」與「行政區 km / 趟數」
- [ ] 暈染切到「濃」時拖曳仍然順（降解析度有生效）
- [ ] 縮到全台看得到環島那幾趟；放到 1 px ≈ 20 m 看得到街廓
- [ ] 行政區名與公里數在（顏色不是唯一線索）

---

## 8. 之後可以做的

- **速度／心率上色**：現在的線是「騎過幾趟」。要換成速度或心率就得改用
  `data/fit/*.fit`（91 個公路車檔）的 1 秒級資料。解析器已經有了，
  在 `tools/tcx/analyze_tcx.py` 的 `parse_ride`，接法照抄
  `scripts/backfill-itt-efforts.py` 開頭那段 `sys.path.insert(ROOT/tools/tcx)`。
  archive 的 polyline 沒有這些欄位。
- **時間軸**：`index.json` 有 `start_date_local`，可以做「這一年新開發的路」——
  只畫某段期間第一次出現的格子。
- **取代舊的台北小地圖**：`buildTaipeiMiniMap()` 用的是手工描的
  `data/taipei-outline.json`，只有台北市、河流是手繪的。這份 atlas 的資料是官方測繪，
  可以整個取代掉。
