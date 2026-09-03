# Claude Fable 5.1 任務：Strava Telemetry OVERDRIVE 正式接管候選版

把本文件全文交給 Claude Fable 5.1，並讓它存取完整 repository。

一句話任務：**只以目前的 `strava.html` 為基礎，把它重新設計成更華麗、更多資料視覺化與 Canvas 動畫、但所有原功能完整保留的正式替換候選版。** 其他 Strava HTML 舊稿不是工作目標。

## 可直接貼給 Fable 5.1 的指令

```text
你現在在一個私人使用的 Strava 資料儀表板 repository 裡工作。請直接完成一個可執行、通過功能驗證、可直接替換正式頁面的最終候選版，不要只回覆建議或 mockup。

主要原始頁面：

strava.html

開發與驗收中的候選檔必須另存為：

strava_fable51.html

開發過程不要覆蓋或重寫原本的 `strava.html`，避免尚未完成的版本破壞現有頁面。但這不是只供展示的概念實驗：`strava_fable51.html` 是準備接管正式 `strava.html` 的 production replacement candidate。使用者驗收後會直接用它取代原版，因此它必須獨立、完整、可長期使用，不能依賴舊頁面並存，也不能用「實驗版」當成功能缺漏或品質下降的理由。

## 任務目標

把現有的「深空計時站」推進成一座真正活著的運動遙測指揮艙：大量資料視覺化、大量動畫、粒子、掃描、路線重播、狀態脈衝與圖表轉場可以同時存在。

這是私人作品，不需要迎合一般 SaaS、企業儀表板或極簡主義。使用者明確喜歡：

- 很多視覺化
- 很多特效
- 很多動畫
- 有遊戲 HUD、航太、計時板、遙測中心的感覺
- 每個 view 像走進不同艙室
- 可以有一點過量、戲劇性與炫技

但「很多」不等於隨機。請讓所有動畫像同一套機器在運作：有節奏、有因果、有資料語意、有舞台前後層。

## 先讀完再動手

必讀：

1. `strava.html`：完整讀取，不要只看檔頭。它約 62 萬字元、11,000 多行。
2. `DESIGN.md`：了解既有視覺規則與它們背後的理由。
3. `activity-modal.css`
4. `activity-modal.js`
5. `itt-achievements.js`
6. `theme-strava.css`：只讀；這是生成檔，不得直接修改。

非必讀舊稿：`strava_helicorder.html`、`strava_pitwall.html`。不要完整分析它們，也不要把時間花在整理舊稿；最多快速看檔頭的設計說明，知道不要沿用「記震紙」或「維修站牆」即可。

需要理解資料結構時再讀：

- `data/strava.json`：很大，先看頂層 keys 與代表性資料，不必把每筆活動全部塞進上下文。
- `data/training-block.json`
- `data/tasks.json`
- `data/playbook.json`
- `data/power-curve-windows.json`
- `data/fit/_wellness.json`
- `data/fit/_doms.json`
- `data/fit/_activities.json`
- `data/fit/_power_hr.json`
- `data/itt-segments.json`
- `data/segment-streams.json`
- `data/segment-terrain.json`

現有本地函式庫：

- `vendor-anime-4.esm.min.js`
- `vendor-three-r128.js`

不要閱讀或重寫 minified vendor；參考 `strava.html` 現有用法即可。

## 舊稿只是一句警告

唯一的產品、功能與設計 source of truth 是 `strava.html`。不要以 `strava_helicorder.html` 或 `strava_pitwall.html` 為基底，也不要複製它們的記震紙、粉筆計時板、長卷軸或雙軸 scroll-snap 方向。到此為止，不需要針對舊稿做稽核、比較、報告或逐項研究；把時間用在改好 `strava.html`。

## 現有產品不是空白頁

目前已有 9 個主 view，所有 view 都必須保留並可使用：

1. 現況 Overview
2. 計畫 Plan
3. 活動紀錄 Log
4. ITT
5. 攻略 Playbook
6. 地圖 Atlas
7. 趨勢 Trends
8. 收成 Harvest
9. 身體 Body

現有重要能力也必須保留：

- URL hash view routing 與重新整理回到原 view
- 手機底部可橫向捲動的 9-view 導覽
- 桌面側欄與 readiness 狀態板
- 共用 detail drawer
- Activity detail modal
- ITT 路段、挑戰紀錄與深連結
- Three.js 3D route replay
- Canvas Atlas GPS 地圖與全部控制項
- 訓練週期、下一堂、課表指南
- Wellness、DOMS、HRV、睡眠、靜息心率、功率心率
- 功率曲線、power shift、年度里程、月目標、六圍雷達
- Harvest 多軌時間圖
- 活動紀錄篩選、展開、詳情與 Strava 外連
- 資料缺失時的既有降級
- `prefers-reduced-motion`

不得刪除 view、圖表、資料欄位、互動或降級路徑來換取漂亮畫面。

## 功能完整接管契約

這次允許大幅修改 HTML、CSS、視覺層與互動呈現，但必須達成 **feature parity first, visual upgrade second**。新版不是從零重做一個長得相似的 dashboard，而是在完整保留產品能力的前提下重新編舞。

實作前先在 `docs/fable51-strava-design-notes.md` 建立功能盤點與 parity checklist。每一項至少記錄：原本入口、資料來源、互動、URL／hash 行為、手機行為、新版位置與驗證結果。至少涵蓋：

- 9 個主 view 與桌面／手機導覽
- browser back／forward、hash 深連結與初次載入
- Overview 所有狀態、任務、讀數與既有圖表
- Plan 的訓練週期、課表與狀態
- Log 的篩選、列表、展開、詳情 modal／drawer 與 Strava 外連
- ITT 的 segment 選擇、成就、terrain、3D replay、播放／暫停／拖曳／縮放／速度／重來
- Playbook 的內容、狀態與操作
- Atlas 的 Canvas 地圖、縮放、平移、chips 與顯示切換
- Trends 的所有圖表、期間切換、tooltip 與精確數值
- Harvest 的多軌時間圖與 hover／focus／touch 讀數
- Body 的 wellness、DOMS、HRV、睡眠、功率心率等切換與缺值
- loading、empty、error、資料缺失與 fetch 失敗時的既有降級
- keyboard、focus、touch、drawer／modal 返回與 reduced motion

可以重新安排資訊階層、控制密度和視覺順序，但不能靜默刪除任何既有能力。若某功能與新設計衝突，先調整新設計；不要以「視覺更乾淨」為理由移除功能。若真的無法判定既有行為，保留原行為並在測試報告標示，而不是自行簡化。

最終 `strava_fable51.html` 必須可以單獨改名為 `strava.html` 後直接運作：相對資料路徑、hash、外部深連結、localStorage keys 與 GitHub Pages 行為不能因檔名切換而失效。不得要求使用者手動補程式、搬資料、改 schema 或同時保留兩個 HTML 才能使用。

## 核心藝術方向

主題名稱：

STRAVA TELEMETRY · OVERDRIVE

敘事：

這不是網站，是一艘收集個人運動遙測的深空觀測艦。每次騎乘是一束訊號；每個 PR 是一次能量釋放；訓練計畫是預定軌道；疲勞是艦體熱負荷；地圖是飛行航跡；Harvest 是投入經過時間後生成的收成。

保留既有的深空、計時板、訊號橘與工程儀表語言，但允許候選版有更強的景深、分層、輝光、色散、掃描、粒子、軌跡與動態攝影機。

## 必做加碼：Fable 5.1 發布頁式 Canvas 舞台

先實際開啟並觀察這個官方頁面的 hero，不要只看截圖：

`https://www.anthropic.com/claude-fable-and-mythos-5-1`

參考它的不是「天空長相」，而是 Canvas 的舞台方法：全幅畫布、遠中近多層景深、柔焦前景、持續但緩慢的環境運動，以及 Noon／Night／Morning 切換時整個場景共同轉換色溫、氣氛與元素狀態。不要下載、擷取或重用 Anthropic 的圖片、程式碼、shader、圖形或品牌素材；請用原創程序式圖形重新詮釋。

請為 `Overview · Flight Deck` 製作一個真正由 `<canvas>` 驅動的 **Training Atmosphere／訓練氣象層**，而不是用 CSS gradient 假裝完成。它是這次候選版的必做 signature canvas：

- Canvas 置於內容後方，主數據和操作仍是可存取的 HTML，不把文字畫進 Canvas。
- 畫面至少有 4 個可獨立運動的深度層：深空／網格背景、遙測霧或能量雲、中景軌道／訊號流、柔焦前景粒子或熱流。
- 使用目前真正的訓練資料決定環境狀態，例如 TSB、CTL、ATL、HRV、睡眠、資料新鮮度；不得用隨機狀態冒充資料結論。
- 建議把資料映射成 `FRESH / BUILD / REDLINE / NO SIGNAL` 四種氣象，而不是照抄 Noon／Night／Morning。
- `FRESH` 可是清晰冷色晨光與穩定軌道；`BUILD` 是較密集的藍紫流場；`REDLINE` 加入橘紅熱負荷、較快訊號與局部擾動；`NO SIGNAL` 回到安靜的診斷網格。
- 自動狀態必須明確顯示名稱與觸發它的主要資料，避免只靠顏色讓人猜。
- 可以提供一個小型 `SCENE LAB` 控制，讓私人使用者手動預覽四個場景；預覽時要標示 `SIMULATION`，不可讓人誤認為真實訓練狀態。
- 狀態切換不是硬切：在約 800–1600ms 內共同插值色盤、霧密度、粒子速度、軌道曲率與光源位置。
- 指標卡、圖表進場與 Canvas 事件要能互相呼應，例如 readiness 更新時向背景送出一圈能量波，而不是兩套互不相關的動畫。
- 加入非常輕微的 pointer／touch parallax 與 scroll depth，但幅度要小；手機陀螺儀不是必要條件，也不得主動要求權限。
- 使用 2D Canvas、OffscreenCanvas 或現有 Three.js 皆可，先選最簡單且穩定的方案；不要為了炫技建立第二個永遠運作的重型 WebGL renderer。

Canvas 實作必須有獨立 lifecycle：`init`、`resize`、`setScene`、`start`、`pause`、`destroy`。離開 Overview、頁籤進背景或切至 QUIET 時必須停止 RAF；回來只能恢復同一個 loop，不得疊加 loop。

三種 FX 模式中的行為：

- OVERDRIVE：完整多層動態、平滑場景轉換、互動視差與資料事件波。
- ACTIVE：降低粒子與更新頻率，保留場景色調與資料事件。
- QUIET／reduced motion：Canvas 顯示一張由真實狀態產生的穩定終態，不做持續運動。

在設計筆記中另外說明：每個資料欄位控制哪個視覺參數、資料缺失如何降級、Canvas 如何避免蓋住內容，以及為什麼這個場景能幫助使用者一眼感受今天適合恢復、累積或輸出。

## 必須保留的設計 DNA

即使做得更狂，以下規則仍要保留：

- `#FC4C02` 是主要訊號色，不是整頁預設文字色。
- 綠／黃／紅／金／青仍保留既有資料語意，不能只為裝飾亂用。
- 所有會變動的數字使用 tabular numerals。
- Saira Condensed 給讀數；中文仍用系統字，不把窄體和中文塞在同一元素。
- 缺值不補假資料、不補零、不生成看似合理的 placeholder 數字。
- 資料列仍以髮絲線和節奏分層，不要把一切改成同重量的大圓角卡。
- 不引入 build step、框架、npm runtime 或外部 UI kit。
- GitHub Pages 的相對路徑必須可用。
- 所有效果都是 progressive enhancement；特效檔載入失敗時，資料與操作仍完整可用。

這個 lab 版本可以刻意放寬 `DESIGN.md` 的兩條原有限制：

1. 不再限制「全站只能一個持續動畫」。可以有多個環境動畫，但要分成前景、中景、背景，且高顯著動畫不可全部同時搶焦點。
2. 主要轉場可以比原本 130–200ms 更具戲劇性，但操作回饋仍需立即；view transition 建議控制在 320–650ms。

不要把放寬理解成忽略可讀性、效能或 reduced motion。

## 動態系統：不要只加 hover

建立一個完整的 Motion Orchestrator，而不是在 CSS 到處散落無法協調的 infinite animation。

至少要有以下層級：

### 1. Ambient layer

持續但低顯著：

- 多層星場與視差
- 星雲呼吸與色溫漂移
- 很淡的掃描線、粒子塵、訊號噪點
- 側欄／頂部狀態的遙測掃描
- 與 TSB 或資料新鮮度連動的環境亮度
- Overview 的 Training Atmosphere Canvas 是 ambient 主舞台；其他 view 不要各自再複製一張同重量的全螢幕 Canvas

Ambient layer 不得讓文字閃爍，也不能持續觸發布局。

### 2. Navigation layer

切 view 像艙室轉位：

- 有方向的 shared-axis 或 orbital transition
- 當前 view 導覽點像鎖定目標
- view 標題、主讀數、圖表依閱讀順序分批進場
- 手機底部 tab 切換也有方向，但不可整頁劇烈甩動

### 3. Visualization layer

每類圖表使用符合資料形狀的動態：

- 折線：沿時間方向描出，游標掃過時有同步讀數
- 長條：從共同基線生長
- 環形：依目標比例充能
- 雷達：節點先定位、輪廓拉開、填色最後出現
- 路線：像訊號沿 GPS 軌跡傳播
- 地圖：路段與行政區以不同頻率脈衝
- 3D：攝影機與路線資料同步，不只讓模型自轉
- PR：能量聚焦、短暫超曝、粒子散射後回到可讀終態

### 4. Interaction layer

- hover、focus、touch 都能觸發，不可只做滑鼠版
- 圖表 crosshair、資料 tooltip、scrub、拖曳要有物理回應
- 點活動、ITT、月分或身體指標時，來源元素與 drawer 之間有 shared-origin 感
- 所有返回按鈕清楚，不讓效果遮蔽命中區

### 5. Event layer

只有真正的重要事件才能用最高強度：

- All-time PR
- 本週任務完成
- 月目標達成
- 下一堂訓練進入今天
- TSB 進入極端疲勞或新鮮窗口

不要讓普通 hover 使用和 PR 一樣強的粒子或輝光。

## Motion 模式控制

在 app chrome 加入一個小型但明確的效果模式控制：

- OVERDRIVE：預設。全部環境、轉場、圖表與事件特效。
- ACTIVE：保留圖表與 view transition，關閉大部分持續背景效果。
- QUIET：保留即時操作回饋，關閉裝飾性動態。

使用 localStorage 記住選擇。

系統 `prefers-reduced-motion: reduce` 必須優先於 localStorage，直接進 QUIET 等級，且保留所有動畫最終狀態。

## 9 個 view 的艙室個性

不要把九頁套同一個進場 preset。每個 view 至少有一個辨識度高的 signature moment：

### Overview · Flight Deck

- 將 TSB、CTL、ATL、睡眠、HRV、下一堂與本月狀態組成一個真正的 launch readiness sequence。
- 大讀數像點火前的主儀表。
- 建議新增一個由現有資料推導的 Readiness Reactor／Energy Core，但不可發明新指標。

### Plan · Trajectory Room

- 訓練週期像未來軌道，過去／今天／未來要有時間方向。
- 下一堂是當前鎖定目標，其他課表後退。
- 進度、完成、替代執行與延期使用不同軌跡語言。

### Log · Black Box

- 活動列表仍是高密度列，不改成卡片牆。
- 日期進場像飛行紀錄解碼；PR 日才出現高能掃光。
- 展開 lap strip 時可像遙測封包解壓縮。

### ITT · Terrain Chamber

- 強化 3D route、坡度、速度、功率、心率與路段時間之間的同步。
- 選路段像把地形載入測量艙。
- PR 與分段落後的動畫必須來自真實差值。

### Playbook · Pit Wall

- 讓「問題 → 證據 → 處方 → 中止條件」形成可見因果鏈。
- 換檔軌跡與逐段對帳可以有示波器／賽事工程台的感覺。

### Atlas · Orbital Survey

- GPS 軌跡像多次飛越後留下的電離航跡。
- 路線熱度與行政區里程保持兩套可辨識編碼。
- 點選路段時產生鏡頭飛行與訊號鎖定，但控制項與地圖仍可快速操作。

### Trends · Engine Observatory

- 功率曲線、power shift、年度競賽、訓練時段、六圍要像同一座引擎觀測台。
- 建議把不同時間窗的功率曲線做成具有深度感的 ridgeline／時間切片，但保留精確讀值。

### Harvest · Growth Chamber

- 這頁的核心是「投入不會立刻收成」。動畫要沿同一根 x 軸讓投入先發生，產出延後出現。
- 不要把四條 lane 拆成四張互不相關的卡。

### Body · Biosignal Lab

- HRV、睡眠、靜息心率、DOMS、eFTP、功率心率像一組生命訊號。
- 可以新增 biometric constellation／signal braid，但仍要能讀出日期、值、基準帶與缺值。
- 缺資料時線應中斷，不能用動畫補平。

## 新視覺化的選擇原則

不要為了數量重畫所有既有圖表。請先盤點資料，再選 3～5 個最值得新增或重構的 signature visualization。

優先候選：

1. Readiness Reactor：TSB／CTL／ATL／HRV／睡眠的狀態核心。
2. Training Trajectory：週期課表的過去、今日、未來軌道。
3. Power Time Slices：多時間窗功率曲線的深度切片。
4. Harvest Delay Field：投入到收成的時間延遲視覺。
5. Biometric Constellation：身體資料彼此關係與缺值。

每個新圖必須在設計筆記中回答：

- 它回答什麼問題？
- 使用哪些現有欄位？
- 為何既有圖不夠？
- 動畫如何幫助理解，而不是只增加熱鬧？
- 手機上如何降級？

## 技術架構

建議交付：

- `strava_fable51.html`：由當前 `strava.html` 建立、可直接取代正式頁面的完整候選版本。
- `theme-fable51.css`：OVERDRIVE 專屬視覺層，載在既有 CSS 之後。
- `strava-fable51-fx.js`：動效協調器與額外視覺化。
- `docs/fable51-strava-design-notes.md`：設計決策、資料來源、刻意偏離 `DESIGN.md` 的地方。
- `docs/fable51-strava-test-report.md`：測試結果與已知問題。

不要直接修改 `theme-strava.css`；它是生成檔。

盡量讓新增效果透過事件、MutationObserver、IntersectionObserver 與獨立 layer 接入，少改原本的資料計算。若需要讓 FX 讀到主資料，可在 `strava_fable51.html` 的 render 完成後派發一個只讀事件，例如：

`strava:data-ready`

但不得把資料邏輯搬進 FX 檔。

## 效能底線

這次可以華麗，但不能靠燒毀手機換效果。

- Canvas／WebGL devicePixelRatio 上限 2。
- `document.hidden` 時暫停所有 requestAnimationFrame loop。
- view 不可見時停止該 view 的 Canvas／WebGL／高頻動畫。
- 重型圖表 lazy init；第一次進 view 才建立。
- 不在每一 frame 呼叫大量 `getBoundingClientRect()` 或觸發布局。
- 粒子使用物件池或固定上限，不無限建立 DOM。
- 避免在全螢幕大區域持續使用高半徑 blur/filter。
- 連續動畫以 transform、opacity、Canvas、WebGL 為主。
- 只有一個主 Three.js renderer 活躍；離開 ITT 時停止渲染。
- OVERDRIVE 在手機可以降低粒子數，但不能偷換成完全沒有特效。
- QUIET 與 reduced motion 必須完整可讀、完整可操作。

## 手機要求

這頁會在手機上看，不能只做 1440px 展示：

- 360px、390px、430px 都不能橫向溢出頁面本體。
- 底部 9-view tabbar 保留並可橫向捲動。
- 所有重要 touch target 至少 44px。
- Tooltip 不依賴 hover；touch 能鎖定，再點空白或返回解除。
- Drawer 在手機仍是整屏子頁面，返回鍵明顯。
- 圖表標籤不能因特效被遮住。
- 手機的動態優先順序：讀數 > 互動 > 圖表 > 環境粒子。
- 橫向圖表可以在自己的容器內捲，不得讓 body 橫向捲。

## 不要做的事

- 不要把它改成白底、玻璃卡片 SaaS dashboard。
- 不要把它做成 `strava_helicorder.html` 的記震紙／科學報表近親。
- 不要把它做成 `strava_pitwall.html` 的維修站牆／雙軸計時板近親。
- 不要把所有資訊塞成 12 張同樣大的 KPI 卡。
- 不要刪除低頻 view 來「簡化資訊架構」。
- 不要用假資料讓新圖看起來漂亮。
- 不要更改任何資料生成 script 或 JSON schema。
- 不要新增需要 npm install、bundler 或 server runtime 的依賴。
- 不要從 CDN 引入新的動畫或 3D 函式庫。
- 開發與驗收期間不要把 `strava.html` 改名或覆蓋；正式替換由使用者在驗收後執行。
- 不要執行 git reset、checkout 或清除既有工作樹變更。
- 不要只做配色與 hover；這次目標是完整的視覺敘事與動態系統。
- 不要因為效果很多就忽略 focus、keyboard、touch、返回與 reduced motion。

## 工作流程

### Phase 1：盤點

1. 讀完必要檔案。
2. 列出 9 個 view 的功能、資料來源、現有效果與不可破壞互動。
3. 寫 `docs/fable51-strava-design-notes.md`，先記錄你選擇的 3～5 個 signature visualization 與 motion grammar。
4. 不需要等待我確認，合理決定後繼續實作。

### Phase 2：建立可接管正式頁面的候選版本

1. 從目前工作樹的 `strava.html` 複製成 `strava_fable51.html`。
2. 加入獨立 theme 與 FX 檔。
3. 開發與驗收期間保持原始 `strava.html` 完全不變，但候選版本身不得依賴原版並存。
4. 先讓九個 view 和所有舊互動通過，再加入新視覺。

### Phase 3：視覺與動效

1. 完成 OVERDRIVE／ACTIVE／QUIET 模式。
2. 先完成 Overview 的 Training Atmosphere Canvas，驗證四種資料場景、lifecycle 與降階。
3. 完成 ambient、navigation、visualization、interaction、event 五層 motion。
4. 完成 3～5 個新 signature visualization。
5. 為 9 個 view 各做至少一個辨識度高的 signature moment。
6. 為所有新增動畫完成 reduced-motion 最終狀態。

### Phase 4：實際驗證

必須透過 HTTP server 開啟，不能用 `file://`，因為頁面需要 fetch JSON。

至少測試：

- 1440 × 1000 desktop
- 1024 × 768 compact desktop/tablet
- 390 × 844 phone
- 360 × 800 narrow phone
- 2560 × 1440 large desktop

逐一點過 9 個 view，並驗證：

- URL hash 正確
- 返回／前進正常
- drawer 開關與返回正常
- activity modal 正常
- ITT segment 深連結正常
- 3D route 可播放、暫停、拖曳、縮放、切速度、重來
- Atlas 縮放、平移、chips 與顯示切換正常
- Trends 所有圖表可見且有精確讀數
- Harvest hover／focus／touch 讀數正常
- Body 指標切換正常
- reduced motion 正常
- 三種 FX 模式可切換並記住
- console 沒有新 error
- 沒有 body-level horizontal overflow
- 切到背景再回來，不會累積多個動畫 loop
- Training Atmosphere 能依真實資料呈現四種場景，SCENE LAB 預覽清楚標示 SIMULATION
- Canvas 在 Overview 外、QUIET 與背景頁籤中正確 pause，回來沒有重複 RAF

如果可以截圖，保存：

- `docs/review/fable51-overview-desktop.png`
- `docs/review/fable51-itt-desktop.png`
- `docs/review/fable51-trends-desktop.png`
- `docs/review/fable51-atlas-desktop.png`
- `docs/review/fable51-overview-mobile.png`
- `docs/review/fable51-body-mobile.png`

## 驗收標準

完成版必須同時滿足：

1. 開發與驗收期間原始 `strava.html` 沒有任何修改。
2. `strava_fable51.html` 可直接由本機 HTTP server 與 GitHub Pages 相對路徑載入，改名為 `strava.html` 後仍完全正常。
3. 9 個 view、drawer、modal、3D、Atlas 與所有原互動都仍可使用。
4. 至少新增 3 個真正使用現有資料的視覺化。
5. 9 個 view 各有自己的 signature moment。
6. OVERDRIVE 明顯比原版更華麗，不只是改顏色。
7. ACTIVE 與 QUIET 提供可控的降階。
8. 手機沒有不可操作的小控制、遮擋或 body 橫向捲動。
9. reduced motion 保留完整終態與資料。
10. 特效檔失敗時，資料與導覽仍正常。
11. 沒有假資料、沒有 schema 變更、沒有 build step。
12. 提供設計筆記與測試報告，不只交程式碼。
13. Overview 有原創、資料驅動、多層且可降階的 Training Atmosphere Canvas；不是 Anthropic 發布頁的素材或程式碼複製品。

## 最後回報格式

完成後請回報：

1. 新增／修改的檔案清單
2. 3～5 個新視覺化各回答了什麼問題
3. 9 個 view 的 signature moment
4. 三種 FX 模式的差異
5. 實際測過的尺寸與互動
6. 效能措施
7. reduced-motion 行為
8. 已知問題
9. 如何將候選版安全替換為正式 `strava.html`，以及需要回復時如何還原

不要在最後要求我自己補完核心功能。請把安全、合理、可驗證的下一步直接做完。
```

## 給使用者的使用方式

1. 在 Claude Code／可存取 repository 的 Fable 5.1 工作階段中，附上本文件。
2. 指示它：「完整執行這份 MD，不要只做分析。」
3. 確認它先建立 `strava_fable51.html` 做完整驗收，而不是在開發中途覆蓋 `strava.html`。
4. 完成後先看 `docs/fable51-strava-test-report.md` 與 parity checklist；通過後即可直接將候選版換成正式 `strava.html`。

預期主要輸出：

- `strava_fable51.html`
- `theme-fable51.css`
- `strava-fable51-fx.js`
- `docs/fable51-strava-design-notes.md`
- `docs/fable51-strava-test-report.md`
