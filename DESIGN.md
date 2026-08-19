---
name: Strava Telemetry Dashboard
description: 深空觀測站 — 近黑星空之上的高對比競賽讀數面板
colors:
  signal-orange: "#FC4C02"
  segment-amber: "#E87C1A"
  ascent-cyan: "#4AB4FF"
  duration-gold: "#FFD24D"
  cleared-green: "#5FD060"
  decline-red: "#FF6A6A"
  peak-flame: "#FF4500"
  crown-gold: "#FFD700"
  deep-space: "#0A0408"
  bulkhead: "#060810"
  readout-white: "#FFFFFF"
  ink-primary: "#DDDDDD"
  ink-secondary: "#AAAAAA"
  ink-muted: "#888888"
# 兩支字體：窄長讀數字體只給數字（≥26px），中性 grotesque 給拉丁標籤，
# 中文一律交還系統字（PingFang / JhengHei）—— 窄體拉丁不與正常寬度中文同行混排。
typography:
  readout:            # 首屏分段計時板的大讀數（上限與甲板的每日一句共用高度預算，見 Layout）
    fontFamily: "'Saira Condensed', 'Oswald', 'Arial Narrow', sans-serif"
    fontSize: "clamp(62px, 12vw, 132px)"
    fontWeight: 800
    lineHeight: 0.82
    letterSpacing: "-1.5px"
  numeral:            # 生涯 / ITT / 功率盤等一般數字
    fontFamily: "'Saira Condensed', 'Oswald', 'Arial Narrow', sans-serif"
    fontSize: "46px"
    fontWeight: 800
    lineHeight: 0.88
    letterSpacing: "-1px"
  display:            # 章節標題（中文）
    fontFamily: "'Archivo', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang TC', 'Microsoft JhengHei', sans-serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.6px"
  headline:
    fontFamily: "'Archivo', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang TC', 'Microsoft JhengHei', sans-serif"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "normal"
  title:
    fontFamily: "'Archivo', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang TC', 'Microsoft JhengHei', sans-serif"
    fontSize: "15px"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "normal"
  body:
    fontFamily: "'Archivo', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang TC', 'Microsoft JhengHei', sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:              # 章節量測窗口、拉丁副標
    fontFamily: "'Archivo', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang TC', 'Microsoft JhengHei', sans-serif"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "3px"
  micro:
    fontFamily: "'Archivo', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang TC', 'Microsoft JhengHei', sans-serif"
    fontSize: "9px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "0.3px"
rounded:
  chip: "4px"
  control: "6px"
  card: "10px"
  hero: "16px"
  panel: "20px"
  pill: "100px"
spacing:
  hairline: "3px"
  tight: "6px"
  base: "8px"
  card: "16px"
  hero: "22px"
components:
  button-primary:
    backgroundColor: "{colors.signal-orange}"
    textColor: "{colors.deep-space}"
    rounded: "{rounded.control}"
    padding: "6px 14px"
    typography: "{typography.micro}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.signal-orange}"
    rounded: "{rounded.control}"
    padding: "6px 14px"
  button-pill:
    backgroundColor: "rgba(255,255,255,.08)"
    textColor: "{colors.readout-white}"
    rounded: "{rounded.pill}"
    padding: "10px 0"
  chip-tab:
    backgroundColor: "rgba(252,76,2,.14)"
    textColor: "{colors.signal-orange}"
    rounded: "{rounded.pill}"
    padding: "5px 14px"
  card-stat:
    backgroundColor: "rgba(252,76,2,.05)"
    textColor: "{colors.ink-primary}"
    rounded: "{rounded.card}"
    padding: "16px"
  card-activity:
    backgroundColor: "rgba(10,4,0,.45)"
    textColor: "{colors.ink-primary}"
    rounded: "9px"
    padding: "14px 16px"
  card-hero:
    backgroundColor: "{colors.deep-space}"
    textColor: "{colors.ink-primary}"
    rounded: "{rounded.hero}"
    padding: "20px 26px"
  label-section:
    backgroundColor: "transparent"
    textColor: "{colors.signal-orange}"
    typography: "{typography.label}"
    padding: "0 0 8px"
  sub-label:          # 章節內的第二層標題（中文 12px + 拉丁小字寬字距）
    backgroundColor: "transparent"
    textColor: "{colors.ink-primary}"
    typography: "{typography.body}"
    padding: "0 0 14px"
  chapter-console:    # 章節儀表盤：週期／節奏共用的框
    backgroundColor: "rgba(6,3,2,.3)"
    textColor: "{colors.ink-primary}"
    rounded: "{rounded.hero}"
    padding: "18px 18px 16px"
---

# Design System: Strava Telemetry Dashboard

## Overview

**Creative North Star: "深空觀測站 (The Observatory)"**

背景是觀測站，前景是競賽讀數。這兩件事是刻意並存的張力，不是矛盾：底層是一片近黑的深空（`#0A0408`）、緩慢漂移的星野 canvas、呼吸的星雲光暈、22 秒轉一圈的星座環——那是安靜、遙遠、可以一直看著的。但浮在它之上的每一張卡片都在報成績：功率、排名、PR 皇冠、狀態評分、離月目標還差幾次。**環境負責讓人待著，前景負責讓人知道自己現在幾分。**

密度是這套系統的立場，不是缺陷。主要使用者是作者本人，他認得每一個縮寫，所以資訊可以擠得很近——實測全頁 2,099 個節點、常用字級落在 8–12px、間距用 3–8px。這種密度在一般產品會被判為過載，在這裡是正確的：它讓一屏塞得下一個月的訓練事實。但密度的代價必須用**顏色紀律**償還——這就是訊號橘只在需要被讀的地方出現的原因。

材質上，這套系統幾乎不用實體陰影。層級靠兩件事表達：**1px 的發絲邊框**（全頁 200+ 個，透明度從 .12 到 .55 分級）和**低透明度的背景疊層**（卡片是 `rgba(10,4,0,.45)` 這種讓星空透出來的半透明黑）。真正的投影只保留給三張主卡。光暈完全是狀態語言，不是裝飾。

**Key Characteristics:**
- 近黑深空底 + 半透明面板，星空永遠從卡片後面透出來
- 單一訊號色 + 六個語意色，各自綁死一個數據維度
- 發絲邊框分層，而非陰影分層
- 系統字體堆疊，零字體載入
- 大寫寬字距標籤作為結構訊號（`ls:3px`）
- 高密度：8–12px 為主字級，3–8px 為主間距

## Colors

近黑底上的單一暖訊號，加一組各自綁死數據維度的語意色；中性色全部是無彩灰，不參與意義。

### Primary
- **訊號橘 Signal Orange** (`#FC4C02`)：唯一的主色，也是 Strava 的品牌橘。用於區塊標題、主要數值、主按鈕、所有需要被優先讀到的東西。全頁字面出現 80 次、`rgba(252,76,2,·)` 另有 186 次，透明度階梯實際使用 `.08 / .1 / .15 / .18 / .2 / .25 / .3 / .35 / .4 / .5 / .6 / .7`——**這個階梯是既有事實，但太密**，見下方收斂規則。

### Secondary
- **路段琥珀 Segment Amber** (`#E87C1A`)：ITT 路段專屬。`data/itt-config.json` 的 `accent` 欄位預設值，路段卡片、路段彈窗的 `--modal-accent` 都吃它。它與訊號橘的分工是**內容領域**而非層級：橘是「整站」，琥珀是「路段」。

### Tertiary（語意色：每個綁定一個數據維度）
- **爬升青 Ascent Cyan** (`#4AB4FF`)：爬升公尺數。月度圖表的爬升條、爬升統計。
- **時數金 Duration Gold** (`#FFD24D`)：時數與心率。月度圖表的時數條、HR 讀數。
- **達標綠 Cleared Green** (`#5FD060`)：月目標達成、本週任務完成。
- **衰退紅 Decline Red** (`#FF6A6A`)：DECLINING 狀態、月增減為負。
- **巔峰焰 Peak Flame** (`#FF4500`)：僅限 PEAK 狀態（segScore ≥ 99%）。刻意比訊號橘更紅更燙，是全系統最高溫的顏色。
- **皇冠金 Crown Gold** (`#FFD700`)：PR 與 BREAKTHROUGH。只給「歷史最佳」，不給「本次不錯」。

### Neutral
- **深空底 Deep Space** (`#0A0408`)：body 底色。帶一點紫的近黑，不是純黑——這讓橘色不刺眼。
- **艙壁 Bulkhead** (`#060810`)：sticky topbar 底色（`.95` 透明度 + `blur(8px)`）。比深空底更冷更藍，是唯一偏冷的表面，用來把導覽列從內容裡分出來。
- **讀數白 Readout White** (`#FFFFFF`)：最高階數值。
- **主文灰** (`#DDDDDD`)：body 預設文字。
- **次文灰** (`#AAAAAA`)：輔助說明。
- **弱文灰** (`#888888`)：目前的最低可用灰。

### Named Rules

**The One Signal Rule.** 訊號橘只出現在需要被優先讀到的地方。它不是「品牌色所以到處撒」，是「這裡有值得看的數字」。任一屏若橘色元素超過視覺面積的 15%，訊號就失效了。

**The Semantic Lock Rule.** 六個語意色各自綁死一個數據維度：青=爬升、金=時數/HR、綠=達標、紅=下滑、焰=巔峰、皇冠金=PR。**不得為了配色好看而借用**。要表達新的維度就要新增一個語意色並登記在此，不能挪用既有的。

**The Consolidation Rule.**（待執行的收斂，使用者已確認方向）目前同一語意存在多個近似值，屬技術債而非制度：
- **暖橘系 6 個重複值**應收斂進 `#FC4C02`：`#ff7040`(4) `#ff8a3d`(3) `#ff7a3c`(2) `#ff6b35`(2) `#ff6a00`(2) `#ffb066`(2)。
  （`#ff9142` 已於 2026-08-12 隨節奏章改版收斂完畢，全頁 0 次。）
- **金系 5 個重複值**應收斂進 `#FFD24D`：`#f0c040`(3) `#ffce5e`(2) `#ffd27a`(2) `#f2c14e`(1) `#d29a1e`(2)。
- **綠系**：`#3fcc4a`(1) 收斂進 `#5FD060`。
- **弱灰 `#555`(21 次) 與 `#666`(9 次) 對比度不足**（實測 2.72:1 / 3.54:1），應提升至 `#8A8A8A` 或更亮。

**The Transparency Ladder Rule.** 訊號橘的透明度目前有 12 階，過密。收斂為 5 階：`.08`（極淡填色）、`.15`（面板填色）、`.3`（靜態邊框）、`.55`（強調邊框）、`1`（文字與圖示）。

## Typography

**唯一字體：** `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`（實測 1,061 個元素）

**Character:** 沒有 webfont，沒有字體載入，沒有 FOUT。這是刻意的——與「零 build step、零依賴」的產品定位一致。系統字體堆疊在 macOS/iOS 呈現 SF Pro，在 Windows 呈現 Segoe UI，兩者都是中性的資訊型無襯線，正好符合「儀器面板」而非「編輯設計」的角色。所有性格由**字重、字距、大小寫**承擔，不由字體承擔。

### Hierarchy
- **Display** (600, 26px)：車手姓名（hero）。全頁唯一的最大字。名片內的變體為 800 / 24px / `ls:1px`。
- **Headline** (700, 18px)：卡片標題、彈窗標題。
- **Title** (800, 15px)：統計數值。這是儀表板的主角字級——粗、密、緊。
- **Body** (400, 12px / 11px)：說明文字、表格內容。11px 是全頁最高頻字級（81 個節點）。
- **Sub-label** (700, 12px)：章節內的第二層標題，只在一章包含兩塊獨立資料時出現（目前只有節奏章的「本週 × 本月」）。規格是 `.section-title` 的降階版——中文 12px `ls:.6px` + 拉丁 8.5px `ls:2.4px` 訊號橘，**不得再開第三階**。
- **Label** (600, 11px, `ls:3px`, uppercase)：**系統的簽名**。所有區塊標題都是這個規格。寬字距 + 全大寫讓它在高密度版面中讀起來像刻在面板上的標示，而不是內容。
- **Micro** (600–700, 8–9px)：單位、次要標記、狀態副標。

### Named Rules

**The Engraved Label Rule.** 結構性標籤（區塊標題、導覽列標題、統計標籤）一律大寫 + 寬字距（`2.5px`–`3px`）+ 訊號橘。內容文字一律小寫混排 + 中性灰 + 正常字距。**看到寬字距大寫就知道那是結構，不是資料。**

**The 11px Floor Rule.**（修補目標，非現況）目前有 255 個文字節點小於 11px，其中 30 個在 7–7.5px。標籤字級下限應為 11px、數值下限 13px；密度靠字距與顏色回收，不靠縮字級。

## Layout

單欄置中，`#app` 最大寬度 **800px**，左右內距 `1.2rem`，底部留白 `5rem`。**沒有多欄版面**——即使在 1440px 桌機，內容仍維持 800px 並置中，兩側是純星空。這是刻意的：這是一份讀物，不是一個工作台。

Sticky topbar 高 58px，用負 margin（`margin:0 -1.2rem`）撐滿容器寬度，底部 1px 橘色發絲線 + `blur(8px)` 毛玻璃。

**間距節奏：** 實測 gap 值為 `2 / 3 / 4 / 5 / 6 / 7 / 8 / 9 / 10 / 11 / 22px`——這是 1px 步進的臨場值，**不是正式的 4/8 scale**。誠實記錄：目前沒有間距制度。收斂建議為 `3 / 6 / 8 / 16 / 22` 五階。

**甲板高度預算（`max-height` 分級）：** `880 / 820 / 740 / 660 / 620px`（5 階）。首屏必須完整落在一屏內——超過就破壞「一手勢一章」的捲動。名片與每日一句共用這份預算，所以計時板讀數的上限（132px）與句子的行數是綁在一起的：矮螢幕依序讓出**原文 → 收藏/複製 → 句子收成一行 → 作品名與來源分頁**，最後一階把 🎲 改成絕對定位釘右上角以省下整整一行。實測 22 個尺寸 × 25 次隨機句子皆吻合，唯一例外是 320×480（該尺寸在加入每日一句之前就已超出 14px，屬既有限制）。

**斷點：** `360 / 420 / 480 / 520 / 600 / 640 / 760 / 1000px`（8 個）。主要行為是 640px 以下摺疊次要資訊——`.pkb-foes`、`.pk-meta`、`.fc-self-btn .pkb-main` 直接 `display:none`，而非重排。**這是刻意的資訊取捨**：小螢幕上先保成績，捨對戰細節。

## Elevation & Depth

**色調分層為主，光暈只做狀態。**（使用者確認）

這套系統的預設是**平的**。深度由兩件事表達，都不是投影：

1. **發絲邊框**：1px，顏色是訊號橘或白的低透明度。透明度即層級——`.12`（最淺，活動卡）→ `.2`（統計卡）→ `.3`（名片）→ `.35`（功率卡）→ `.55`（強調）。全頁 200+ 個邊框走這套。
2. **背景疊層**：面板用半透明黑（`rgba(10,4,0,.45)`）或極淡橘（`rgba(252,76,2,.05)`），讓星空從卡片後面透出來。**表面永遠不是不透明的**——這是「觀測站」隱喻在材質上的實現。

真正的投影只保留給三張主卡（名片、功率卡、路段卡）。

### Shadow Vocabulary
- **發絲暗環** (`box-shadow: 0 0 0 1px rgba(0,0,0,.5)`)：28 處。不是陰影，是把元素從亮背景上切出來的暗描邊。
- **主卡浮起** (`box-shadow: 0 20px 50px -22px rgba(0,0,0,.8)`)：路段卡。負 spread 讓陰影只在正下方，不外擴。
- **名片浮起** (`box-shadow: 0 16px 46px rgba(0,0,0,.55)`)：名片。
- **狀態光暈** (`box-shadow: 0 0 8px rgba(252,76,2,.18), inset 0 0 0 1px rgba(252,76,2,.18)`)：**唯一允許的彩色光暈**，只在 hover / PR / 選中時出現。

### Named Rules

**The Transparent Surface Rule.** 面永遠半透明，星空永遠透得出來。不得使用不透明的實色卡片背景——那會把觀測站變成一般儀表板。

**The Glow-Is-State Rule.** 彩色光暈只表達狀態（hover、PR、選中、巔峰），永遠不表達靜態層級。靜態層級一律用邊框透明度。**看到光就代表有事發生了。**

## Shapes

圓角依尺度分級，越大的容器越圓：

- **3–6px**：微型晶片、表格列、標記。`6px` 是最高頻（77 處）。
- **9–10px**：標準卡片（活動卡 9px、統計卡 10px）。
- **14–16px**：主卡（功率卡 14px、名片 16px）。
- **20px**：大型面板（路段卡）。
- **100px / 20px 膠囊**：所有分頁晶片與次要按鈕。
- **50%**：頭像與圓形浮動按鈕（70 處）。

**邊框一律 1px**，唯一例外是主要按鈕與強調環用 `1.5px`。沒有 2px 以上的邊框。

裝飾性幾何：彈窗與主卡用**角標記**（`::before` / `::after` 畫出 10–18px 的 L 形角框），這是全系統的簽名幾何，來自 HUD／取景框的語彙。

### Named Rules

**The Radius-Follows-Scale Rule.** 圓角與容器尺度成正比。晶片 6px、卡片 10px、主卡 16px、面板 20px。不得讓小元件用大圓角（那會變成藥丸）或大面板用小圓角（那會變成表格）。

## Components

### Buttons

三種變體，**形狀就是層級**：

- **Primary（實心橘）**：`linear-gradient(135deg, #FC4C02, #FC4C02 60%, rgba(255,255,255,.4))` 底 + `#0A0604` 深色字 + `1.5px` 實橘邊 + `6px` 圓角 + `ls:1px` + 800 字重。深色字壓在亮橘上（實測 5.6:1，合格）。用於單一主要動作，如「詳情」。
- **Ghost（描邊橘）**：透明底 + `1.5px` 實橘邊 + 橘字 + `6px` 圓角。用於次要動作與外連，如「Strava ↗」。
- **Pill（中性膠囊）**：`rgba(255,255,255,.08)` 底 + `1px rgba(255,255,255,.16)` 邊 + 白字 + `100px` 圓角 + `ls:1.5px`。滿寬。用於卡片內的展開型 CTA，如「▶ REVIEW ATTEMPT」。**刻意不用橘**——它是容器內的動作，不該跟區塊標題搶訊號。
- **Hover：** 背景透明度提升一階（`.1` → `.2`），`.15s ease`。不位移、不放大。

### Chips

- **Style：** `rgba(252,76,2,.14)` 底 + `1px` 實橘邊 + 橘字 + `14–20px` 圓角 + `ls:1px`。
- **State：** 未選中為透明底 + 低透明度邊 + 灰字；選中為上述橘色態。用於運動類型分頁、語錄來源分頁。

### Cards / Containers

- **Corner：** 標準卡 9–10px，主卡 14–16px，面板 20px。
- **Background：** 半透明——活動卡 `rgba(10,4,0,.45)`、統計卡 `rgba(252,76,2,.05)`。
- **Shadow：** 預設無（見 Elevation）。僅主卡有投影。
- **Border：** 1px 發絲，透明度即層級。
- **Padding：** 標準卡 `14–16px`，主卡 `20–22px`。

### Inputs

系統只有一個真實輸入元件：3D 回放的 `<input type="range">` 進度軸。滿寬、橘色軌道。**沒有文字輸入、沒有表單**——這是唯讀儀表板，資料來自 cron。

### Navigation

- **Topbar：** sticky、58px 高、`rgba(6,8,16,.95)` + `blur(8px)`、底部 1px 橘色發絲線。左側膠囊返回鍵（`20px` 圓角、`rgba(252,76,2,.1)` 底），右側大寫寬字距標題（`ls:2.5px`）。
- **浮動按鈕：** 右下角，`50%` 圓角，42px（主題）與 38px（回頂）。回頂鍵捲動超過 300px 才出現，
  `bottom` 必須讓開手機選單（`78px + safe-area`）—— 420px 那條斷點原本把它壓到 18px，正好疊在選單上。
- **手機底部選單（≤767px）：** 浮起來的玻璃膠囊，不是貼底的實心列。`left/right:10px`、
  `bottom:9px + safe-area`、`radius:26px`、`rgba(10,7,6,.55)` + `backdrop-filter:blur(20px) saturate(160%)`、
  1px `rgba(252,76,2,.2)` 發絲邊 + `inset 0 1px 0 rgba(255,255,255,.07)` 的頂緣高光。
  裡面是可橫向捲動的字籤（每籤 ≥62px、12px 字），現用的那一籤是 `rgba(252,76,2,.14)` 填色膠囊
  ＋橘字＋下方 4px 圓點（顏色不是唯一訊號）。切 view 會自動把現用的那一籤捲到中央。
  **為什麼不是平均分配的實心列**：七個 view 在 390px 寬平均分只剩 54px，那個寬度會逼字級降到 11px
  ——正是 11px 樓地板要擋的事。捲動版讓字級回到 12px，第六籤露頭就是捲動提示。
  淡出遮罩掛在內層捲動容器（掛外層會把膠囊自己的背景與邊框一起吃掉），
  而且捲到底的那一端要把淡出關掉，否則最後一籤（常常正是現用的）看起來像被切掉一半。

### 簽名元件：狀態徽章 (Status Badge)

ITT 路段的狀態評分是這個產品的核心機制，也是最具識別度的元件。格式固定為 **`{emoji} {ENGLISH_STATUS}` + 一行小寫副標**，顏色由語意色鎖定：

`🔥 PEAK`（巔峰焰）· `⚡ RISING`（訊號橘）· `➖ HOLD`（時數金）· `📉 DECLINING`（衰退紅）· `🚀 BREAKTHROUGH`（皇冠金）· `🆕 NEW`（爬升青）· `💀 UNTOUCHED`（弱灰）

副標永遠說明「為什麼是這個狀態」（`97% OF PEAK (ALL-TIME)`、`NO POWER DATA`、`3 STREAK`），不得省略——它是密度介面裡唯一的自我解釋機制。

**週期章沿用同一個元件**，六個狀態全部落在既有語意色上，沒有新增顏色：

`⚡ EXCEEDED`（達標綠 + 光暈）· `✓ ON TARGET`（達標綠）· `📉 UNDER`（衰退紅）· `⚡ TODAY` / `➖ NEXT UP`（訊號橘 + 光暈）· `➖ SCHEDULED`（弱文灰）· `💀 MISSED`（弱文灰 + 紅邊）· `🔁 SUBSTITUTED`（弱文灰 + 紅邊，同 MISSED）

`➖ SUPPORT`（弱文灰）是**輔助課表**——週六輕鬆跑那種，為了補空窗而排，不是這個區塊的主線。
它在列表裡「在場但不搶」：虛線左緣、名稱字重降一階、右欄印自己的量（`TL ~30 · 心率 ≤147`）而不是 IF/TSS/VI。
**它不計入完成度、不進進度軌、不會變成「下一堂」**——那三處全走 `SES_DONE()` / `SES_KEY()`，
判斷不散落在各處。做了不算進度、沒做也不算欠帳，這是它跟 MISSED 的根本差別。

`🔁 SUBSTITUTED` 是「原課表沒做，但做了別的」（下雨改跑步機那種）。它**刻意跟 MISSED 共用弱文灰**——沒按處方執行就是沒按處方執行，不能給它一顆自己的顏色，否則語意色會開始通膨。兩者的差別只在資訊量：MISSED 的列是空的、透明度 `.55`；SUBSTITUTED 的列有副標（做了什麼）與負荷欄（`TL 74 · TRIMP 127`），透明度提到 `.82`——它看起來要像「這裡有東西可讀」，而不是像被塗掉。計數（`n / 9 完成`）、進度軌、「下一課」三處一律不算它，判斷集中在 `SES_DONE()` 一個地方。

副標同樣帶原因（`三項全中`、`2/3 項達標`、`還有 4 天`）。**三個指標（IF / TSS / VI）各自帶自己的 ✓✗，不合成一顆燈**——它們的意義不同，VI 沒中比 TSS 沒中嚴重，合成一顆會把最重要的訊息吃掉。

前後測若超越前測則用**皇冠金**，這符合「皇冠金只給歷史最佳」的既有規則。未測的數字用 `--` 並交回 UI 字體降一階——窄體 800 字重的破折號會變成一條粗黑條，看起來像被塗掉的數字而不是「還沒有」。

### 圖表刻度 (Chart Ticks)

身體頁的長期曲線帶三條水平參考線（資料的最低／中間／最高，**不含上下 8% 的呼吸空間**——
標出來的必須是量到的值，不是畫布邊界）與一條時間軸。**軸標一律用 HTML 疊在 SVG 外面**：
那支 svg 是 `preserveAspectRatio="none"` 拉滿框的，文字放進去會被橫向拉長。
Y 標靠右側 34px 的排水溝，不壓在曲線上。

時間軸的標籤密度按區間換檔，不是同一套硬套：**30 天** 標到日（每七天，月界只給長刻度不給字，
兩套標籤混在一起會排出 07/29、08/01、08/05 這種不等距的節奏）；**90 天** 每月；
**365 天** 標單數月。年份只在「這一頁的第一個標籤」與每年一月出現（`2025/09` → `11` → `2026/01` → `03`），
其餘只給兩位數的月——每個標籤都寫完整年月的話，365 天那張會變成六串一模一樣的前綴。
區間左緣通常切在月中（90 天那張是 05/21），那裡標月份既不準又會跟下一個標籤疊在一起——
只有落在月初三天內才標，刻度照給。最右邊只給刻度不給日期——
今天的日期已經印在上面那行讀數裡，再標一次會跟最後一個月份標籤相黏（手機實測 `JUL` 與 `08/19` 直接貼住）。

**缺值畫成灰底，不是只把線斷開。** 線斷開只說得出「這裡斷了」，說不出斷多久，
而斷三天跟斷三週對判讀的意義完全不同（後者在復播之後有好幾天的 7 日平均只靠零星幾筆撐著）。
只有**連續三天以上**才畫底——一兩天多半是那晚沒戴錶，全畫出來會變成一排柵欄。
不用虛線把缺口接起來：那等於憑空生出資料。

### 痠痛預估 (DOMS)

身體頁的第一塊。四天一排長條（今天起算），值是**早上七點**那個時刻——因為他的訓練窗口都在早上，
全天最高值對決策沒有用。判讀對準「下一個有課的早上」而不是今天：今天多半已經練完或本來就休。

顏色沿用既有語意色，沒有新增：**很高 ≥65 衰退紅**、**高 ≥45 訊號橘**、**中 ≥25 時數金**、
**低與無 弱灰**。每一列右邊接的是那天的課表名（有課）或痠痛的主因活動（沒課）。
說明列一律帶「**這是估計不是量測**」與已知盲點——這塊的數字沒有量測基礎，
不寫清楚就會被當成體重計那種讀數看。

### 簽名元件：角標記 (Corner Marks)

主卡與彈窗四角的 L 形細線（10–18px、1.5–2px、訊號橘）。純裝飾但是全系統的識別記號，來自 HUD 取景框。用於：功率卡、路段彈窗、功率彈窗、**章節儀表盤**（見下）。

**角標記代表「這是一台獨立的儀器」**，不代表「這裡重要」。所以彈窗與儀表盤有，一般卡片沒有——加到普通卡片上會讓整頁變成一片取景框，記號就失效了。

### 簽名元件：章節儀表盤 (Chapter Console)

「週期」與「節奏」共用的框：`16px` 圓角 + `1px rgba(252,76,2,.22)` 發絲邊 + 角標記 + 半透明面（`radial-gradient(120% 90% at 50% 0%, rgba(252,76,2,.05), transparent 60%)` 疊在 `rgba(6,3,2,.3)` 上）。內距 `18px 18px 16px`（≤520px 收成 `15px 14px 14px`）。

**刻意不給投影。** 投影仍然只保留給名片、功率卡、路段卡三張主卡；儀表盤靠邊框與半透明面分層。這讓「浮起」維持稀有，不會因為多了兩個大面板就通膨。

這個元件是為了解決一個真實的失衡：節奏章原本上半是自帶框的日曆卡、下半是**裸的**四運動表格直接躺在星空上，一張卡配一張裸表，讀起來不像同一頁。收進同一個框之後，「週期」與「節奏」才像同一台儀器上的兩個錶。

**內部分隔用量尺（`.console-tape`）而不是素線**——與計時板下緣同一組 recipe（1px 漸層橫線 + 14px 週期的刻度）。素線的意思是「這裡斷了」，量尺的意思是「同一台儀器換一個刻度」。分隔用負邊距推到面板兩側切齊，日曆的橫向捲動區也一樣，讓熱圖能貼齊面板邊緣。

**新增章節就用這個框**，不要再自己發明面板樣式。

## Do's and Don'ts

### Do:
- **Do** 讓面保持半透明，星空要從卡片後面透出來（`rgba(10,4,0,.45)` 這類）。
- **Do** 用邊框透明度表達靜態層級（`.12` → `.2` → `.3` → `.35` → `.55`），用光暈表達狀態。
- **Do** 讓結構性標籤一律大寫 + `ls:2.5–3px` + 訊號橘；內容文字一律小寫 + 中性灰 + 正常字距。
- **Do** 讓語意色綁死數據維度：青=爬升、金=時數/HR、綠=達標、紅=下滑、焰=巔峰、皇冠金=PR。
- **Do** 讓圓角與容器尺度成正比（晶片 6px / 卡片 10px / 主卡 16px / 面板 20px）。
- **Do** 讓狀態徽章永遠帶「為什麼」的副標——`97% OF PEAK` 而不只是 `RISING`。
- **Do** 在缺資料時明說（`NO POWER DATA`、`此路線尚無高度資料`），不得補零或留白。
- **Do** 保留現有的 `prefers-reduced-motion` 處理方式：針對性關閉並保留動畫終態，不要改成一刀切。
- **Do** 讓新的章節區塊用 `.console` 儀表盤框，不要自己發明面板樣式。
- **Do** 在改動甲板任何元素的高度後重跑高度預算驗證——句子是隨機抽的，只看一次會漏掉最長的那句。

### Don't:
- **Don't** 讓它看起來像一般 SaaS 儀表板——不要白底、不要 Material 卡片投影、不要藍色主色、不要引入 Inter 之類的 webfont。**（使用者確認的反面參照）**
- **Don't** 讓它變成 Strava 官方 App 的複製品。這個站的價值正是官方沒有的（ITT 評分、3D 回放、對手 PK）。**（使用者確認的反面參照）**
- **Don't** 用彩色光暈表達靜態層級。看到光就該代表有事發生。
- **Don't** 為了配色好看而挪用語意色。新的維度要新增顏色並登記，不能借用。
- **Don't** 新增第 8 個近似橘或第 6 個近似金。目前已有 7 個重複暖橘與 5 個重複金待收斂。
- **Don't** 使用 `#555` / `#666` 作為文字色（實測 2.72:1 / 3.54:1，不合格）。
- **Don't** 用 2px 以上的邊框，也不要在單邊加粗色條當作強調（偵測器已標記兩處 `border-left` 強調線）。
- **Don't** 使用彈跳或彈性緩動（目前有兩處 `cubic-bezier(...1.4)` 與 `(...1.2...)`）。這套系統的動作是儀器式的減速，不是玩具式的回彈。
- **Don't** 引入多欄版面。800px 單欄置中是刻意的閱讀節奏。
- **Don't** 在同一章裡混用「有框的卡」與「裸的表格」。要嘛都進 `.console`，要嘛都不進——這正是節奏章 2026-08-12 改版前的失衡。
- **Don't** 給儀表盤加投影。投影是三張主卡的專屬，多加會讓「浮起」失去意義。
- **Don't** 引入任何需要 build step 的東西——字體託管、CSS 預處理器、打包工具都會破壞部署模型。
