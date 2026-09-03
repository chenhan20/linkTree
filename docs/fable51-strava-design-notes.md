# STRAVA TELEMETRY · OVERDRIVE — 設計筆記

候選檔：`strava_fable51.html`（由工作樹的 `strava.html` 複製後以錨點補丁產生）＋ `theme-fable51.css` ＋ `strava-fable51-fx.js`。
驗收期間 `strava.html` 一個字元都沒改；候選版不依賴原版並存，改名即可接管（見測試報告最後一節）。

這份筆記回答四件事：新版**刻意避開**了哪兩個被否決的方向、既有功能一項一項對上去了沒（parity checklist）、
五張新圖各自回答什麼問題與用了哪些欄位、以及 Training Atmosphere 畫布的資料→視覺映射與降級。

---

## 0. 一句話的藝術方向

深空觀測艦的**指揮甲板**：每次騎乘是一束訊號、每個 PR 是一次能量釋放、訓練計畫是預定軌道、疲勞是艦體熱負荷、
地圖是飛行航跡、收成是投入之後延後出現的東西。原版「深空計時站」的 DNA（近黑星場、Saira 讀數、訊號橘、髮絲線）
全部保留，加上去的是**景深、分層、輝光、掃描、粒子、軌跡與資料事件的能量波**。

放寬 `DESIGN.md` 的兩條：不再限制「全站只有一個持續動畫」（改成背景／中景／前景三層，高顯著動畫不同時搶焦點）；
主要轉場允許到 480ms（操作回饋仍是即時的）。**沒有放寬**的：`#FC4C02` 是訊號不是文字色、語意色鎖、tabular numerals、
Saira 只給 ≥26px 數字、缺值不補、髮絲線分層、零 build step、GitHub Pages 相對路徑。

---

## 0.1 第二輪（2026-09-02 下午）：使用者回饋後的加碼

使用者看過第一輪之後的三點：字體有沒有更好的選擇；改動太少、很多頁面沒動到，**版面與功能分類可以整個重規劃**；
以及想要 Anthropic 發布頁 hero 那種「模糊飛行主體」的 Canvas 技術（主體可以換成太空相關的東西）。第二輪的回應：

### 七個艙室取代九個 view（舊 id 全部保留為別名）
| 艙室 | id | 收進來的東西 | 舊 hash 別名 |
|---|---|---|---|
| 01 指揮艙 Command deck | `deck` | Launch Hero（名片＋大讀數＋氣象列）、狀態核心、需要注意、當前週期×下一堂、本週、代辦、表現訊號、節奏日曆、最近活動、每日一句 | `#overview` |
| 02 訓練 Training | `train` | 訓練軌道、週期與下一堂、全部課表、PMC 預測、本週×本月、月目標環、重訓部位、**攻略**（子艙） | `#plan`、`#playbook`、`#plan/session/<d>` |
| 03 活動紀錄 Log | `log` | 不變 | — |
| 04 ITT 計時 | `itt` | 不變（測量檯＋挑戰簿） | `#itt/segment/<id>` |
| 05 引擎 Engine | `engine` | 功率曲線、功率時間切面、引擎變化、兩年互追、月度量、時段條、六圍、**收成**（子艙：四軌圖、延遲場、現存紀錄、刷新率）、生涯總量 | `#trends`、`#harvest`、`#harvest/month/<m>` |
| 06 地圖 Atlas | `atlas` | 不變 | — |
| 07 身體 Body | `body` | 不變（＋生命訊號星座） | — |

分類的邏輯換成**問題**而不是資料表：現在怎樣（指揮艙）→ 接下來做什麼、要改什麼（訓練）→ 剛剛做了什麼（紀錄）→ 我騎多快（計時）→
輸出的形狀與投入換到什麼（引擎）→ 騎到哪裡（地圖）→ 身體給不給（身體）。
`setView()` 與 `routeFromHash()` 吃 `VIEW_ALIAS`，`data-goto="plan"` 這類舊目標一個都不用改；`#plan/session/…`、`#harvest/month/…` 舊深連結照開。
側欄七項帶 01–07 的編號（JetBrains Mono，有 tnum）；手機底部膠囊七籤。

### Launch Hero（指揮艙頂端，全幅）
跟 Anthropic 發布頁 hero 學的是**舞台方法**（實際去看過：單一全幅 canvas、文字是 HTML 疊在上面、Noon／Night／Morning 三個看板切換整個場景、
前景樹枝與一隻偶爾飛過的鳥都在柔焦裡），素材與程式一個都沒拿。這裡的版本全部是程序式圖形：

| 層 | 內容 | 技法 |
|---|---|---|
| 遠 | 星野與星雲（頁面原本的 deepfield／star-canvas 透出來）＋ 場景色溫沖洗 | — |
| 中遠 | 弦月（銳利，畫面唯一對到焦的東西）＋ 繞著它的訊號軌道 | 徑向漸層＋偏移暗圓做弦月；軌道數＝CTL |
| 中 | 遙測霧（能量雲）、塵埃 bokeh | 預繪 sprite 放大貼（不在每幀建 gradient） |
| 近 | **行星邊緣**：畫面下緣的地平線、大氣輝光（場景色溫）、暗面 | 大圓的上弧；名片與大讀數壓在暗面上，暗面就是 scrim |
| 主體 | **騎士剪影**（那隻鳥）：沿平緩的弧從左飛到右，曲柄以 90 rpm 真的在轉，後面拖訊號尾跡 | 60×36 的離屏剪影放大 3–4 倍＝柔焦；三個位移殘影＝運動模糊；不用 `ctx.filter`（Safari） |
| 最近 | 失焦的艦體結構（樹枝的位置） | 1/10 解析度離屏畫粗線再放大＝對不到焦的前景；視差最強 |

場景（FRESH／BUILD／REDLINE／NO SIGNAL）＝看板：切換時色溫、霧密度、軌道傾角、光源、騎士的高度與速度一起插值 1.3 秒。
REDLINE 騎士飛得低又快、FRESH 高而慢、NO SIGNAL 沒有騎士（只剩診斷網格）。
主體要換成別的（探測器、彗星、他自己那趟騎乘的 GPS 軌跡當作飛過去的緞帶）都只是 `Rider` 這一個物件的事，路徑與柔焦管線共用。

### 字體：Saira Condensed 其實沒有 tabular numerals
實測（headless 載入 Google Fonts 後量寬）：Saira Condensed 的 `1111` 與 `9999` 差 50px —— DESIGN.md 那條「所有會變動的數字用 tabular numerals」
在讀數字體上一直沒有生效（count-up 時寬度會抖）。候選裡有 tnum 的：**Barlow Condensed**（窄長讀數體、收筆圓，跟 Saira 同一個性格）、
Space Grotesk、JetBrains Mono；Rajdhani、Chakra Petch、Oswald 都沒有。所以：讀數 Barlow Condensed、拉丁標籤 Space Grotesk、代碼與時間戳 JetBrains Mono，
中文仍交還系統字。比較圖在 `docs/review/fable51-fontlab.png`。

## 0.2 第三輪（同日傍晚）：Pogačar、Ridge Dawn、使用者選的字體、側欄的 Signal Spine

### 騎士＝Pogačar 的 puppy paws
使用者給了一張 Pogačar 低趴的照片，說剪影很像他沒關係。`Rider.paint` 重畫：前臂平放在把手上、雙手併在龍頭前、平背（一條 quadratic 微拱）、頭低而前、
白色世界冠軍車衣、腰際五條彩虹（藍紅黑黃綠）、黑色車褲、白色空力車架、深框輪；曲柄仍以 90 rpm 轉。柔焦改成兩階：100×61 離屏先縮到 50×31 再放大 3 倍多，
彩虹條會糊成一抹顏色，正好是「柔焦裡的那抹白衣」。白色在亮天空上靠一圈 .35 的深色描邊撐住。

### hero 背景：Ridge Dawn（使用者說「給你設計」）
把行星／月體／軌道那套換掉。理由：Pogačar 的姿勢屬於山路，不屬於太空；而且 Anthropic hero 的力量來自「一個可信的世界＋柔焦」，不是來自太空。
| 層 | 內容 | 技法 |
|---|---|---|
| 天空 | 三段漸層（天頂／天中／地平線）＝場景色溫 | 一個 linearGradient |
| 星野 | 往地平線淡出，幾顆帶四芒的亮星；白天淡到沒有 | resize 時預繪一張 |
| 太陽 | 貼著地平線，下半被遠山吃掉（日出／日落） | 光暈 additive ＋ 圓盤；睡得少 → 太陽更貼地平線 |
| 高空雲 | 三到五條柔焦的長條，慢慢漂 | 徑向漸層 sprite 拉寬 |
| 四層山脊 | `1-|sin|` 疊三個頻率＝尖峰圓谷；越遠越被山谷霧染成天色，稜線受光 | 每層一張離屏（寬 1.16W 給視差），顏色變才重畫 |
| 山谷霧 | 每一層前面一道往上淡出的霧帶；疲勞佔比高 → 霧厚 | linearGradient |
| 騎士 | 在山脊上方的天空飛過（就是那隻鳥） | 見上 |
| 整體霧 | NO SIGNAL 幾乎把山蓋掉＝濃霧 | 一層 haze 色的 fill |
| 前景失焦 | 畫面兩下角的暗塊（1/10 解析度放大） | 視差最強 |
| 塵埃／事件波／診斷網格 | 沿用 | — |
四種氣象＝四種天光：FRESH 清冷晨光、BUILD 紫色暮色、REDLINE 燒起來的落日、NO SIGNAL 濃霧。
全站底（deepfield）也一併換掉：兩團星雲改成一道斜向靛紫薄霧帶＋下緣一抹晨光（跟 hero 同一個光源方向），星野稍收。

### 字體（使用者在比較圖上選的）
大讀數 **Michroma**（實測數字寬度差 2%，接近 tabular；count-up 那 1.6 秒最多抖一兩個像素，之後靜止）、內文 **Inter Tight**（有 tnum）、
代碼 JetBrains Mono。Michroma 很寬又只有一個字重，所以只給 ≥22px 的讀數且一律 400；表格與列裡的小數字留有 tnum 的 Barlow Condensed，
否則 4.4rem 的欄位會被撐爆。上一輪只把 Saira 換成 Barlow，使用者看不出差別 —— 那是我的問題，兩個都是窄體。

### 側欄：Signal Spine（使用者問「左側選單也能有類似效果嗎」）
桌機側欄是全站唯一「不管在哪個艙室都看得到」的位置，所以它的畫布不演天氣，演**船脊**：
一條垂直的軌、七站各一個刻度、現用站的鎖定光點（換站時沿軌**滑**過去，不是瞬移；`fx:wave` 來時多一圈）、
偶爾從頂端流下來的訊號包（換站時一顆、資料事件時兩顆、overdrive 每 5 秒左右隨機一顆，到站就熄）、極淡的塵埃。色溫跟著 hero 的氣象。
畫布掛在同一個 Ticker；ACTIVE 只留軌與光點、QUIET 靜態一張；手機沒有側欄，不做。
還能往下做的（沒做，等他挑）：把最近一趟騎乘的 GPS 軌跡當成軌本身（一條真的路）、每站旁邊一條 12px 高的迷你趨勢線（該艙室的活數字）、
readiness 面板的 TSB 數字換成一顆會呼吸的核心、側欄底部一條沿著時間走的「今天的課表進度」光條。

---

### 0.3 第四輪（2026-09-02 晚）：星野退役，整頁底圖換成他騎過的路

使用者看到指揮艙往下捲之後的畫面：「背景還是星空」。上一輪只換了星野的色調，星點本身還在。這一輪把 `#star-canvas`
與兩團星雲整個退役（fx 檔掛好底圖時在 `<html>` 標 `data-bg="roads"`；fx 檔擋掉就沒有這個屬性，原本的星野照舊），
底下鋪的是 **Ghost Roads**：

| 層 | 內容 | 資料 |
|---|---|---|
| 天光 | 頂端是氣象的天空色，往下沉進近黑；左上一抹晨光（跟 hero 的太陽同一側）；一道斜向的靛紫薄霧帶 | `SCENES[scene]` 的 bg／fog2／haze |
| 路網 | 他真的騎過的路，騎越多趟越亮（1／2／4／8／16／32 趟以上六階，.04 → .27）；32 趟以上先鋪一層 7px 的柔光 | `data/ride-atlas.json` 的 `routes`（跟地圖艙室同一份、同一個 TM2 投影） |
| 地點 | 十二個 ITT 地點是稍亮的節點＋光暈 | `places`，用頁面自己的 `atTm()` 投影 |
| 一趟騎乘 | OVERDRIVE 每 2.4–5.6 秒一道光從 8 趟以上的路出發，到了折線尾端就接同一個路口的下一條（優先騎最多趟的那條），串到 700–1600px | 路網的端點索引（6px 網格） |
| 谷霧、山脊、暗角 | 下方一條霧帶壓在路網上；兩層 `1-|sin|` 山脊剪影（跟 hero 同一族）；暗角保住讀數對比 | 純裝飾 |

視窗用 4 趟以上的路的 3–97 百分位框住（偶爾騎一次的遠征被裁掉不心疼），cover 到整個視口再往下多留 360px 給捲頁視差。
1.2MB 的路網只在桌機、主資料到了之後的閒置時段才抓（`requestIdleCallback`，上限 2.5 秒）；手機與 `saveData` 只鋪天光與山脊。
色溫跟著 hero 的氣象走：`fx:scene` 來時用 **目標色**（`Atmo.to`）重畫路網，OVERDRIVE 下 1.3 秒交叉淡入。
ACTIVE 只有捲頁視差、QUIET 靜態一張；畫布 30fps 上限、沒東西動就不重畫；2560 以上 DPR 壓到 1 省記憶體。

跟「假資料」的界線：底圖上每一條線都是他的 GPS，山脊與霧是裝飾但不冒充地形（沒有畫等高線，因為那會是一張假地圖）。

### 0.4 第五輪（2026-09-02 晚）：騎士重畫、側欄改成爬坡牆

使用者把 hero 的騎士放大看：「跟我給的圖片差太多…超像亂畫的」，側欄則是「我沒看到你畫了什麼，該不會是上下點來點去那個點點」。兩個都是同一種錯：
**把「柔焦」做成「低解析」**。騎士原本在 100px 的離屏畫布畫完、縮到 50px 再放大，想仿發布頁那隻鳥的景深，結果是一團糊；
側欄的訊號脊柱是 1px 的軌加幾顆流下來的點，設計上就是「不搶眼」，對他來說等於沒有。

- **騎士**：改成向量直接畫在 hero 畫布上（跟著 DPR，永遠清楚），局部座標 400×250：正常公路車幾何（立管、上管、頭管、下管、
  後上下叉、微彎前叉、52px 高框碳輪、大盤與曲柄）、兩節 IK 的腿（大腿 82、小腿 80，膝蓋取在前的解，90 rpm 轉）、趴平的背、
  垂直的上臂＋平放的前臂＋握在龍頭前的手（puppy paws）、壓低的頭與帽尾在後的空力帽、胸前五道世界冠軍彩虹條。
  動態感交給後輪後面三條漸淡的速度線和兩層 6%／12% 的殘影，本體不再模糊。寬度 max(150px, 15% 舞台寬)。
- **側欄「爬坡牆」（取代 Signal Spine；第六輪又被全景取代，見 §0.5）**：把他測驗用的 ITT 路段（`data/segment-grades.json` 的「中社路 全段」，3.95 km、+242 m；
  沒有就拿最長的那段）的剖面豎起來貼在側欄左緣：起點在下、山頂在上，海拔映成往右的位移（10 → 40px），每 25m 一條橫紋鋪成山體，
  顏色跟坡度（<4% 綠、4–8% 琥珀、8–12% 橘紅、≥12% 白，跟 ITT 檯同一套眼睛）。七個艙室的刻度刻在最左緣（不劃過 01–07 的編號），
  現用站的鎖定光點就落在剖面上、換站時沿山壁滑；OVERDRIVE 有一道光沿剖面往上爬（一趟測驗壓成 26 秒，到頂停 5 秒再從山腳出發）；
  ACTIVE 光不爬、只有換站的滑動；QUIET 靜態一張。山腳一行 9px 小標寫路段、距離、爬升。
- **驗證的坑**：DPR 2 的 headless 一秒只推得動一兩幀，騎士自然出場要等十幾秒、截圖還比程式狀態慢好幾幀；特寫要先
  `Ticker.jobs.clear()` 凍住 loop、手動 `Rider.spawn()` 到畫面中間、等 2.5 秒讓 compositor 追上再拍。

### 0.5 第六輪（2026-09-02 深夜）：攻擊式的騎士、側欄變成全景的左半邊、照片接口

使用者三句話：「先不用跑這麼多測試 主要先著重 PC 版」「這側邊欄我實在是看不懂在幹啥 重作」「Pogačar 的爬坡 設計成在衝刺 要加速」，
之後補一句「還是很不像，不如我給你圖？」。

- **騎士＝爬坡攻擊**：先坐在 aero tuck 裡等速騎 2.4 秒，然後站起來（兩個姿勢的關鍵點用 stand 0→1 線性混合：臀到 BB 正上方、
  身體前傾、拉著把手、頭抬起來、整台車繞著接地點左右搖、身體跟著曲柄上下），踏頻 86 → 128 rpm，速度每秒加、上限 3.4 倍，
  往右上爬出畫面；速度線與殘影跟著速度變長變亮（殘影只留一層 4–11%，不再疊三層）。畫框從 400×250 加高到 400×300，
  車子往下墊 50 讓站起來的人有頭的空間。
- **側欄＝全景的左半邊**：不做圖表了。hero 那片山景直接延伸進側欄：同一條天空漸層（對齊 hero 的頂邊與底邊）、星野、
  地平線的餘暉、**同一組山脊函數往左接過去**（hero 的 x 往左延伸成負數，垂直位置對齊 hero 的頂邊，配色跟 hero 的 ensureRidges 同一套：
  暗色混霧色、遠淡近深、稜線受光、每層前面墊山谷霧）、山谷霧；整層壓 36% 的暗讓側欄的字好讀。OVERDRIVE 星星呼吸、雲慢慢飄、
  偶爾一顆流星；ACTIVE／QUIET 靜態。離開 deck 之後 hero 不在畫面上，沿用上一次量到的 hero 幾何，所以每個艙室的側欄都是同一幅景。
- **照片接口**：在 `<html>` 標 `data-rider-img="assets/pogacar.png"`（面向左再加 `data-rider-flip`）就用去背照片取代向量騎士，
  速度線、殘影、抽車的搖晃、加速全部沿用；沒宣告就不發請求（免得 404 進 console）。等他給圖。
- **測試範圍**：這輪只跑 1440 桌機（113／113、console 0）與截圖；手機、2560、reduced motion、no-fx 沒重跑（他說先著重 PC 版）。

## 1. Rejected Direction Audit

兩個舊方向都完整讀過（`strava_helicorder.html` 1,616 行、`strava_pitwall.html` 5,406 行，後者另以 headless Chrome 實際渲染量測）。
它們只當負面參考：新版不從它們複製任何 markup、CSS、版型、導覽模型、命名、資料子集或視覺隱喻。
唯一的 source of truth 是目前的 `strava.html`。

### 1.1 `strava_helicorder.html`（記震紙）

| 維度 | 舊版的辨識特徵（證據） | 新版如何刻意避開 |
|---|---|---|
| 主隱喻 | 地震測報中心的記震紙：淡青灰製圖紙 `#DCE2D5`、鏽紅預印格線 `rgba(150,62,40,.11/.24)`、`feTurbulence` 紙紋 multiply 疊層、**合成波形**（背景噪訊＋衰減震盪的載波，「包絡是資料、載波是記法」）、測站代碼 `TW.STEVE.BIKE`、通道 `BHT/BHD/BHL`、增益 ×1/×2/×4、斜線 hatch、空心方框缺值符號、正片／負片沖印 | 沒有紙、墨、印刷、沖印、底片的任何詞彙與裝置；**沒有任何合成波形**——每一條線都是真實時序（CTL/ATL、功率、TSS 累積、wellness）；缺值用斷線、空心節點與「— 無資料」；背景是 canvas 的星場＋氣象層，不是紙紋 |
| 頁面結構 | 單一長捲動、七節錨點（`01 記震紙 … 07 事件目錄`）、方框相接（`border-top:0`）、探頭「其後尚有 5 節」 | 9-view app shell 一次只掛一個 view，hash 路由，view 內自然高度；面板靠間距／透明度／輝光分層，沒有 1px 黑框相接 |
| 導覽 | 黏頂報頭 + 編號錨點 + IntersectionObserver 反白成黑塊；手機兩列報頭橫滑 | 桌機常駐側欄（現用項有鎖定光點與取景框角標）＋手機底部可橫捲的 9 籤玻璃膠囊；切 view 不捲頁，有方向性的光帶轉場 |
| 字體 | 全頁單一等寬字、斜線零、最大數字 17px、唯一 display 字是 52px 的「記震紙」大標 | 三個字體角色（Archivo UI／Saira Condensed 讀數／mono 只給代碼與時間戳）；甲板讀數 62–132px；新圖的核心數字 44px Saira；沒有斜線零 |
| 色盤 | 紙 `#DCE2D5/#D3DACB/#E7EBE2`、墨 `#14171A`、鏽紅 `#9C2F1C`、普魯士藍 `#1B3F7A`、橄欖綠 `#2F5218`；負片 `#191C18` + 桃色格線；零圓角、零陰影、零發光、零 gradient | 深空近黑 `#0A0408` 徑向漸層底、暖白墨 `#F4F0EA`、訊號橘 `#FC4C02` 發光；場景色溫（青／紫／橘紅／灰藍）疊在星場上；圓角 2–14px、輝光、內光、`backdrop-filter` 都在用 |
| 圖表形式 | SVG-only 的 strip chart、登錄表、反應譜、泳道長條、事件目錄（每 20 列重印欄頭） | canvas 氣象層、Three.js 地形、Canvas atlas、PMC、功率曲線切面、雷達與環形；活動紀錄是可展開的列不是印刷表 |
| 動態策略 | 全站唯一一段動畫（筆尖描紙 1s）、transition 只有 `.12s linear` 的底色與文字色、明文反發光／反大數字／反儀表板 | 五層動態（ambient／navigation／visualization／interaction／event）、一個共用的 rAF、480ms 轉場、事件爆發；明文**要**發光、**要**大讀數、**要**資料舞台 |
| 資料範圍 | 只抓 3 支 JSON（`strava.json`、`itt-config.json`、死抓取的 `power-prs.json`）；plan／playbook／atlas／harvest／body 五個 view 不存在；體重、月數、筆數寫死 | 接齊 `strava.html` 的 18 支資料源，9 個 view 全部保留；沒有任何寫死的數字文案 |
| 一眼辨識 | 淡青灰紙＋鏽紅格線＋一疊 18 列地震波＋編號錨點＋黑底反白按鈕＋全頁等寬字＋負片 | 黑底星場＋氣象層色溫、橘色訊號光、側欄／底部 9 籤、發光的狀態核心、Saira 大讀數 |

第二次反相似度審查（桌面與手機截圖）：見測試報告 §7。逐項否定清單：無紙紋、無鏽紅格線、無疊列波形、無編號錨點列、無反白按鈕、
無等寬斜線零、無 1px 黑框直角、無正片／負片、無 `ND`、無斜線 hatch、無「n 筆」右欄——十一項在候選版全部為零。

### 1.2 `strava_pitwall.html`（維修站牆）

| 維度 | 舊版的辨識特徵（證據） | 新版如何刻意避開 |
|---|---|---|
| 主隱喻 | F1 pit wall：消光石板 `#101215`、陽極鋁面板 `#191C20/#22262B`、粉筆白 `#EDEAE3`、板牌巨數、計時紙表格 01–35、起跑燈、排行條；「材質是暗示不是模擬」「石板不會發光」 | 指揮甲板：畫面有縱深與大氣，材質可以「模擬」（玻璃膠囊、發光核心、HUD 括號）；文案、class 名、註解裡沒有板牌／計時紙／席／面／石板／粉筆／chalk／slate／rail 這些詞 |
| 頁面結構 | 6 站 × 10 面，每面 `min-height:100%` 滿版、內容釘頂釘底留大片空白、`scrHead/scrCue` 三段骨架 | 9 個 view 自然高度、往下自然捲；沒有「一面一構圖」、沒有「↓ 下一面／下一站 ——」提示 |
| 導覽 | 雙軸 scroll-snap（x mandatory／y proximity）、六格雙語底軌、右緣 vdots、方角「← BACK」框鈕、`#站/面` 二層 hash、方向鍵換站換面 | 沒有任何 scroll-snap；側欄＋底部膠囊都是 9 項；hash 一層 `#view`（子狀態 `#view/kind/id`）；不接管方向鍵；返回連結在側欄底部與手機 page-links |
| 字體 | 零 webfont、系統 sans 800 負字距巨數、8–11px mono 大寫寬字距微標籤 | Google Fonts 的 Saira Condensed 讀數（原版簽名）＋ Archivo；巨數帶橘暈 `text-shadow`；標籤用 UI sans，中文不加寬字距 |
| 色盤 | 石板三階＋粉筆三階，彩色只剩紫／綠／黃／灰四功能色；零發光、零漸層、零 backdrop-filter；emoji 去飽和 | 深空徑向漸層底、`#FC4C02` 全站訊號色並允許 `box-shadow`／`drop-shadow` 發光；場景色溫四套；語意色（綠／黃／紅／金／青）全部帶光；emoji 保留原色 |
| 圖表形式 | 表優先：計時紙、賽季長表、右軸鍵值清單；長條當格子底；方點方牌 canvas 疊層 | 圖優先：氣象層、狀態核心（環＋衛星）、訓練軌道、功率切面、收成延遲、生命訊號星座；標記用圓點／圓角 pill／光環 |
| 動態策略 | 只有 `.15s` hover 色變、bar scaleX、count-up、彈窗淡入；無環境動畫；「不該有東西一直在閃」 | 常駐氣象層（`document.hidden`、離開 Overview、QUIET 時停）、方向性轉場、脈衝核心、事件爆發、stagger 進場 |
| 資料範圍 | 只讀 strava.json 快照＋4 支輔助檔；沒有 itt-segments 併檔、沒有 playbook／atlas／harvest／body；detail drawer 不存在 | 18 支資料源、itt-segments 併檔、9 個 view、共用 detail drawer（桌機右側抽屜／手機整屏子頁面）全部沿用 `strava.html` |
| 一眼辨識 | 平黑底＋六格雙語底軌＋框式 ← BACK＋`站 · 面 · n/m`＋右緣直條＋髮絲清單＋右軸巨數＋mono 大寫微標籤；手機底軌懸空 80px | 第一屏同時有：氣象層色溫、橘色訊號光、側欄／底部膠囊 9 籤、發光的狀態核心與 Saira 大讀數；手機底部膠囊貼齊視窗（原版本來就是） |

兩個舊方向共同的坑，新版的對應決策：不讓單一隱喻壓過訓練用途（每張新圖都有讀數列與缺值標示）；不縮減資料源與 view；
不重新命名到要猜（九個 view 名稱與原版一字不差）；不是一次性展示頁（每個 view 都是可日用的工具）；
不是換配色加 glow（五層動態＋五張新圖＋氣象層是新的東西）；不混合「記震紙內容結構＋維修站導覽＋深空背景」——
內容結構與導覽都是 `strava.html` 的，只有視覺與動態層是新的。

---

## 2. 功能盤點與 Parity Checklist

「新版位置」第一輪＝原版位置；第二輪把九個 view 收成七個艙室（§0.1 的表），區塊本身的 DOM 與函式沒有改、只是搬了艙室，舊 hash 全部保留為別名。「驗證」欄對應 `docs/fable51-strava-test-report.md` 的自動探針名稱；
探針在 1440×1000、1024×768、390×844、360×800、2560×1440 五個尺寸各跑一輪（其中 390×844 另跑一輪 reduced motion）。

| # | 能力 | 原本入口 | 資料來源 | 互動 | URL／hash | 手機行為 | 新版位置 | 驗證 |
|---|---|---|---|---|---|---|---|---|
| 1 | 9 個主 view | 側欄 `.nav-i` ／ 底部 `.tab-i` | `VIEWS` | 點擊切換、不捲頁 | `#<view>` | 底部膠囊橫捲、現用籤置中 | 同 | `view <v>: hash+is-on+nav` ×9 |
| 2 | 初次載入／重整回原 view | `routeFromHash()` | — | — | `#<view>`、`#itt/segment/<id>`、`#log/activity/<date>`、`#plan/session/<date>`、`#harvest/month/<m>` | 同 | 同 | `itt deep link selects segment`、`drawer deep link hash`、`harvest month drawer` |
| 3 | browser back／forward | `popstate → routeFromHash` | — | — | pushState | 同 | 同 | `history back -> overview`、`history forward -> trends` |
| 4 | Overview 讀數、任務、代辦、節奏日曆、當前週期、PMC、本週、注意事項、表現訊號、最近活動、每日一句 | `render()` overview 區段 | strava.json、training-block、wellness、tasks、quotes CDN | `data-goto`、`data-power`、日曆翻頁、語錄換句／收藏 | — | `#rdy-mobile` 狀態儀表 | 同，多了氣象列（`#atm-bar`）與狀態核心宿主 | `view overview`、截圖 |
| 5 | 側欄 readiness 狀態板 | `mountReadiness()` | `_wellness.json`（切到今天） | 量測列可點 → Body 該指標 | — | 掛在 `#rdy-mobile` | 同 | `view overview`（`.rdy` 存在）、截圖 |
| 6 | Plan：週期、下一堂、全部課表、修訂紀錄、課表指南、本週×本月、月目標環、重訓部位 | `renderMesocycle()` 等 | training-block.json、strava.json | 課表列 → 抽屜；`toggleMore` | `#plan/session/<date>` | 同（抽屜整屏） | 同，多了訓練軌道宿主 | `drawer opens from session row`、`trajectory node opens drawer` |
| 7 | 共用 detail drawer | `openDrawer()` | — | Esc／點外面／返回鍵關 | replaceState 子路由 | 整屏子頁面＋`‹ 返回` | 同（多一道進場掃描與來源發光） | `drawer closes`、`Esc closes drawer` |
| 8 | Log：篩選頁籤、列表、顯示全部、分段展開、詳情 modal、報告連結、Strava 外連、3D 鈕、ITT 成就列與抽屜 | `renderTimeline()`、activity-modal.js | strava.json、itt-achievements.js、rides/index.json | 全部沿用 | `#log/activity/<date>` | 同 | 同（`.activity-card`／`.activity-meta`／`.act-strava-link` 三個 class 沒改名） | `log rows rendered`、`activity-modal buttons injected`、`show more expands`、`lap strip expands`、`activity modal opens/closes`、`sport tab switches` |
| 9 | Three.js 3D route replay（Log 的 🛰️ 3D） | `openRoute3D()` | route_stream、taipei-outline、landmarks | 播放／暫停、1×2×4×、拖曳、縮放、重來、自轉、指北 | — | 全屏 | 同 | `route3d *` 6 條 |
| 10 | ITT 測量檯（3D 地形＋路線＋重播 PR＋自轉＋回正北＋挑戰簿） | `setupIttPlates()` | segment-streams／terrain／grades、itt-segments 併檔 | 拖曳轉檯、重播、挑戰簿收合 | `#itt/segment/<id>` | 單指垂直照常捲頁 | 同（loop 在無檯可見時會自停、由 IO 叫醒） | `itt 3D plates built`、`itt replay runs`、`itt drag rotates`、`itt challenge book expands`、`tsv loop stops when leaving ITT` |
| 11 | ITT 狀態說明彈窗 | `toggleIttLevel()` | — | 四個頁籤 | — | 同 | 同 | 手動 |
| 12 | Playbook | `renderPlaybook()` | playbook.json | `.pb-go` → ITT | — | 逐段表四欄不橫捲 | 同（因果鏈進場） | `view playbook` |
| 13 | Atlas Canvas 地圖：縮放、平移、膠囊、暈染、描邊樣式、行政區／區名／路段名切換、讀數 | `atInit()`… | ride-atlas.json（lazy） | 滾輪／拖曳／按鈕 | — | 觸控拖曳 | 同（膠囊變成鏡頭飛行＋鎖定環） | `atlas *` 6 條 |
| 14 | Trends：月度量（指標×範圍）、兩年互追、時段條、功率曲線＋排行、引擎變化、六圍、生涯總量 | `render()` trends 區段 | strava.json、power-curve-windows | 讀數列（pointerover＋focusin） | `data-power` → 功率彈窗 | 同 | 同，多了功率時間切面宿主 | `trends charts present`、`volume *`、`power curve dot readout`、`power modal *` |
| 15 | 功率彈窗 | `openPowerModal()` | power_prs | 頁籤、Esc | — | 同 | 同 | `power modal opens/closes` |
| 16 | Harvest 多軌時間圖、現存紀錄、刷新率、月細目抽屜 | `renderHarvest()`、`initHarvest()` | 現算 | hover／focus 讀數、點月開抽屜、篩選 | `#harvest/month/<m>` | 同 | 同，多了延遲場宿主與弧線層 | `harvest *` 5 條 |
| 17 | Body：DOMS、九個 wellness 指標頁籤、範圍切換、功率-心率曲線 | `renderBodyView()` | `_wellness`、`_doms`、`_activities`、`_power_hr` | 頁籤、範圍 | — | 同 | 同，多了生命訊號星座宿主 | `body panels + constellation`、`body metric switch`、`body range switch` |
| 18 | 資料缺失降級 | 每支 fetch 各自 `.catch(() => null)` | — | — | — | — | 同；新圖資料不足 → 宿主保持 hidden | `viz hosts`（宿主狀態列印） |
| 19 | fetch 失敗 | `.catch(err => …)` 顯示 Data unavailable | — | — | — | — | 同；另派發 `strava:data-error` → 畫布銷毀 | 手動（阻擋 strava.json 後檢查） |
| 20 | 特效檔載入失敗 | — | — | — | — | — | 拔掉 `strava-fable51-fx.js`／`theme-fable51.css` 後九個 view 照常，宿主全 hidden、氣象列仍是純文字 | `no-fx probe` |
| 21 | keyboard／focus | 既有 focus-visible 樣式 | — | Tab、Enter、Esc | — | — | 同；新節點都是 `<button>` | `Esc closes drawer`、focus 讀數探針 |
| 22 | touch 讀數鎖定 | 收成／功率曲線／時段條靠 focusin | — | — | — | 點一下鎖住，點空白解除 | 同；引擎變化長條補 `tabindex` | `harvest focus readout` |
| 23 | reduced motion | 十個 `@media` 區塊＋anime 層不載入 | — | — | — | — | 頁面開場把 `data-fx` 壓成 quiet；控制項鎖住；畫布靜態終態 | `reduced motion *` 2 條 |
| 24 | localStorage | `qbFav:*`、`itt-card-order-v1` | — | — | — | — | 同，新增 `fx-mode-v1`（效果模式）；改名檔案不影響 key | `mode preference survives reload` |
| 25 | 導覽徽章活數字 | `updateNavBadges()` | — | — | — | — | 同 | 截圖 |

沒有任何一項被靜默移除；找不到的行為一律保留原版並在測試報告標示。

---

## 3. 五個 signature visualization

選圖原則：先盤點資料，只做「既有圖回答不了、而且資料真的撐得起」的圖；每一張都用現有欄位、不補假值、手機有降級。

### 3.1 Readiness Reactor · 狀態核心（Overview）
- **回答什麼**：今天適合恢復、累積還是輸出？疲勞有沒有蓋過體能？
- **欄位**：`_wellness.json` 的 `ctl`、`atl`（同一把尺：外圈體能、內圈疲勞）、TSB＝ctl−atl（核心色＝側欄 `tsbMood` 四階；針在 −30…+30 的弧上）、`hrv` 對 60 天 `rollingBand`、`restingHR` 對 60 天基準帶、`sleepSecs` 對 28 天均值、`rampRate`。
- **為何既有圖不夠**：側欄的 sparkline 說「這 90 天怎麼走」，PMC 說「接下來會到哪」，但沒有一張圖把「現在」的五個維度放在同一個核心裡讓人一眼感受。
- **動畫怎麼幫助理解**：環從 12 點方向充能，內圈追過外圈的那一刻就是「疲勞蓋過體能」；核心脈動的週期跟著 ATL（疲勞越高跳越快）；readiness 更新時核心向外送一圈波，同一圈波同時出現在背景畫布。
- **手機降級**：核心縮到 220px 置中，讀數列直排；QUIET／reduced motion 沒有脈動與充能，終態完整。
- **沒有發明新指標**：所有門檻沿用側欄與身體頁。

### 3.2 Training Trajectory · 訓練軌道（Plan）
- **回答什麼**：照課表走，累積負荷該在哪裡？實際走到哪裡？下一個鎖定目標是哪一堂？
- **欄位**：`training-block.json` 的 `sessions[].target.tss`（累積＝預定軌道）、`SES_DONE` 的 `actual.tss`（累積＝實際軌道）、每一堂的狀態沿用 `renderMesocycle` 已算好的 `window.__mcDetail`（沒有第二套判定）；`start`／`end` 決定 x 軸。
- **為何既有圖不夠**：`.mc-track` 是一排等寬色塊，看得出哪堂達標，看不出「負荷有沒有照計畫累積」與「落後多少」。
- **動畫**：預定軌道先描出、實際軌道再追上去，兩線之間的色塊（紅＝落後、綠＝領先）最後出現；下一堂是脈衝的鎖定框。
- **互動**：節點是真的 `<button data-ses>`，hover／focus／touch 給讀數，點了開同一個抽屜。
- **手機**：節點放大到 38px 命中區；y 軸標籤縮到 30px 內縮。

### 3.3 Power Time Slices · 功率時間切面（Trends）
- **回答什麼**：同一條功率曲線，在「全時最佳／近半年／前半年」三個切面上各是什麼形狀？哪段時長變強、哪段退？
- **欄位**：`power_prs`（全時）＋ `power-curve-windows.json` 的 `windows[prev/now].best[]`（182 天視窗）。
- **為何既有圖不夠**：功率曲線只有全時；引擎變化只比兩期的差；三者疊在一起、用深度分層才看得到「時間切片」。
- **動畫**：由後到前一片一片描出；指到任何時長，三個值與百分比出現在讀數列。
- **精確值**：三片共用同一把瓦數尺，基線各退一階做深度；讀數列給精確值，不靠眼睛量高度。
- **手機**：高度 200px、左內縮 30px；hit 區是整欄。

### 3.4 Harvest Delay Field · 收成延遲場（Harvest）
- **回答什麼**：投入之後隔多久才收成？
- **欄位**：收成頁現算的 `window.__harvest`（`months[].over` 過線月、`recs[].m` 紀錄立下的月）。每項紀錄往回找最近的過線月（≤3 個月）。
- **為何既有圖不夠**：四條 lane 疊在同一根 x 軸上能「看出」延遲，但沒有把延遲數出來；也沒有把過線月與紀錄月的配對畫成連線。
- **動畫**：沿同一根 x 軸——柱子先長（投入）、線再描（引擎）、方塊最後落下（收成）、弧線最後連上（配對）。
- **手機**：五根長條等寬，標籤兩行；弧線層用 % 定位不量寬度。

### 3.5 Biometric Constellation · 生命訊號星座（Body）
- **回答什麼**：六條身體訊號今天各自落在「自己平常」的哪裡？形狀最近 14 天怎麼變？哪幾天缺資料？
- **欄位**：`hrv`、`restingHR`、`sleepSecs`、`sleepScore`、`sportInfo[Ride].eftp`、`_doms.json.daily[d].am`（切到今天），各自對近 90 天 P10–P90 正規化。
- **為何既有圖不夠**：身體頁一次一個指標；六條訊號彼此的形狀與「哪一條今天缺」看不到。
- **動畫**：14 天的辮子由舊到新淡入，最新一圈描出，節點最後彈出；缺值那一段就是斷的，不補平。
- **手機**：星座全寬、讀數列在下。

---

## 4. Training Atmosphere（訓練氣象層）

`Overview · Flight Deck` 背後的全幅 2D canvas（`#atm-canvas`，fixed，星野之上、內容之下）。文字與操作全部是 HTML；畫布不畫字。
場景由頁面的 `buildAtmosphere()` 從 wellness 判定，動效層只負責畫；SCENE LAB 的預覽一律標 `SIMULATION`。

### 4.1 四種氣象與門檻（沿用側欄 `tsbMood` 與身體頁 `rollingBand`）
| 場景 | 條件 | 視覺 |
|---|---|---|
| NO SIGNAL | 沒有 wellness、沒有 CTL/ATL、或最後一筆真實 CTL/ATL 超過 3 天 | 灰藍診斷網格最清晰、霧最薄、訊號最慢、2 條軌道 |
| REDLINE | TSB ≤ −20，或 TSB ≤ −10 且近 7 天 HRV 低於 60 天基準帶 | 橘紅熱負荷、霧最厚、訊號最快、軌道與粒子擾動、偶發火花、粒子成向上的熱流 |
| FRESH | TSB > +5 | 清晰冷色（青白）晨光、光源高、穩定軌道、小而亮的粒子 |
| BUILD | 其餘（−20 < TSB ≤ +5） | 藍紫流場、中等霧密度、4 條軌道 |

### 4.2 資料欄位 → 視覺參數
| 欄位 | 視覺參數 | 映射 |
|---|---|---|
| TSB | 場景本身 | 上表 |
| ATL／CTL | 霧密度 `fogD` | `+ clamp((ATL/CTL − 1) × .35, −.2, +.3)` |
| CTL | 軌道數 `orbitN` | `clamp(round(CTL/8), 2, 6)` |
| ATL | 訊號速度 `sig` | `× clamp(ATL/35, .5, 1.6)` |
| 睡眠時數 | 光源高度 `ly` | `+ clamp((6.5 − h) × .04, −.12, +.14)`：睡得少光源壓低 |
| HRV 低於基準帶 | 擾動 `turb` | `+ .3`（軌道頭與粒子抖動、火花） |
| 資料新鮮度 | 網格清晰度 `gridA` | 最後一筆超過 1 天 → `× 1.4`（像診斷模式） |

### 4.3 四個深度層（都可獨立運動）
L0 透視地板網格（向觀者流動）→ L1 4–6 團徑向漸層能量雲（additive、慢漂）→ L2 橢圓訊號軌道與帶尾的訊號頭（速度＝ATL）→ L3 16–48 顆柔焦 bokeh 粒子（視差最強）＋ 事件波。
視差：pointer／touch 位移 ±14px（前景最強），scroll depth 每層不同係數；不碰陀螺儀、不要權限。

### 4.4 Lifecycle 與模式
`init` → `resize` → `setScene(name,{sim})`（800–1600ms 內共同插值色盤、霧密度、粒子速度、軌道曲率、光源位置；實作 1300ms）→ `start`／`pause`／`destroy`。
離開 Overview、`document.hidden`、QUIET 都停 rAF；回來只恢復同一個 Ticker，不疊加（測試報告 §5 有 hide/show 五輪的 rAF 計數）。
OVERDRIVE：全部；ACTIVE：粒子減半、30fps、關掉星雲呼吸與星野漂移；QUIET／reduced motion：一張由真實場景畫出的靜態終態。

### 4.5 缺值降級
沒有 wellness → NO SIGNAL；單一欄位缺 → 該參數用場景預設，不補值；氣象列只印有值的欄位。
畫布蓋不住內容：它在 `.app`（z-index 2）之下，內容本身沒有背景的區域才透出來；側欄與 app chrome 有 .86／.93 的底。

### 4.6 為什麼這個場景幫得上忙
側欄的 TSB 是一個數字，要讀。氣象是**在讀任何數字之前**先感受到的：冷而清＝可以輸出、藍紫流動＝正在累積、橘紅擾動＝該收、灰網格＝資料斷了先去同步。
場景名與觸發它的數字永遠印在氣象列上，不靠顏色猜。

---

## 5. Motion grammar（五層）
- **Ambient**（低顯著、持續）：氣象層（只在 Overview）、星雲呼吸、星野漂移、side rocket、rdy-scan、app chrome 的 7s 巡線、極淡靜態掃描線（桌機、overdrive）。不會讓文字閃爍、不觸發布局。
- **Navigation**：方向性光帶（480ms）、導覽亮點鎖定環、view 標題底線描出、手機籤方向閃光；既有 anime 層的 shared-axis 位移保留。
- **Visualization**：既有 anime 層（wellness／功率曲線／互追／時段／雷達／環形）不動；新增收成 lane 的 x 軸時序、playbook 換檔軌跡描線、五張新圖各自的進場。
- **Interaction**：點按漣漪（列／籤／膠囊／節點）、抽屜 shared-origin（來源發光＋抽屜掃描）、游標帶有 120ms 物理回應、touch 可鎖定讀數。
- **Event**（最高強度，只給真的事件，一個 session 只爆一次）：全時 PR（金、96 顆粒子＋超曝框）、本週任務全部完成（綠）、月目標達成（綠）、下一堂就是今天（鎖定框持續脈衝）、TSB 進入極端窗口（能量波）。

## 6. 九個 view 的 signature moment
| view | moment |
|---|---|
| Overview · Flight Deck | 氣象層＋狀態核心充能＋本週四個讀數依序點火＋大讀數送出能量波 |
| Plan · Trajectory Room | 訓練軌道：預定虛線先描、實際橘線追上、落後／領先色塊最後出現；課表列沿時間方向進場；下一堂鎖定框脈衝 |
| Log · Black Box | 日期像飛行紀錄解碼（數字亂跳 6 格再落定）；PR 日日期列的金色掃光；分段展開像封包解壓 |
| ITT · Terrain Chamber | 每座測量檯第一次進視野一道掃描（地形載入測量艙）；重播中舞台邊光與遙測讀數發光；3D 燈絲揭幕沿用 |
| Playbook · Pit Wall | 問題→證據→處方→中止依序點亮成因果鏈；換檔軌跡像示波器描出 |
| Atlas · Orbital Survey | 膠囊點了是鏡頭飛行（對數縮放插值）＋訊號鎖定環；台北／全台按鈕同樣飛行 |
| Trends · Engine Observatory | 功率時間切面由後到前描出；功率曲線與互追線帶輝光 |
| Harvest · Growth Chamber | 沿同一根 x 軸：投入柱先長、引擎線再描、收成方塊延後落下、配對弧線最後連上 |
| Body · Biosignal Lab | 生命訊號星座 14 天辮子由舊到新淡入；指標頁籤 stagger |

## 7. 效果模式
| | OVERDRIVE | ACTIVE | QUIET |
|---|---|---|---|
| 氣象層 | 全部四層、視差、事件波 | 粒子減半、30fps、無視差 | 靜態終態一張 |
| 星野／星雲／火箭／rdy-scan | 動 | 停（星野畫成靜態星圖） | 停 |
| 轉場、圖表進場 | 有 | 有 | 落到終態（duration 0） |
| 事件爆發 | 有 | 有 | 無 |
| 操作回饋 | 即時 | 即時 | 即時 |
偏好存 `localStorage['fx-mode-v1']`；系統 `prefers-reduced-motion: reduce` 在第一次 paint 前就壓成 QUIET，控制項鎖住並標 `REDUCED MOTION`。

## 8. 刻意偏離 DESIGN.md 的地方
1. 「全站唯一持續運動的元素是 `.rdy-scan`」→ 改成三層環境動畫（見 §5）。
2. 動態時長 .13–.2s → 轉場 480ms、圖表進場 0.9–1.3s；hover／focus 仍 .13s。
3. 投影：新圖沒有投影；深度靠輝光與內光（The Emissive Depth Rule 沒破）。
4. 半階字級、兩個字體 register、髮絲線分層、缺值明說：全部沿用。
