---
name: Strava Telemetry Dashboard
description: 深空計時站 — 近黑星場之上的分段計時讀數面板
colors:
  signal-orange: "#FC4C02"
  segment-amber: "#E87C1A"
  ascent-cyan: "#4AB4FF"
  duration-gold: "#FFD24D"
  crown-gold: "#FFD700"
  cleared-green: "#5FD060"
  fresh-green: "#4AD07A"
  caution-amber: "#FFB020"
  decline-red: "#FF6A6A"
  peak-flame: "#FF4500"
  deep-space: "#0A0408"
  bulkhead: "#060810"
  readout-white: "#FFFFFF"
  ink-primary: "#F4F0EA"
  ink-secondary: "rgba(244,240,234,.66)"
  ink-muted: "rgba(244,240,234,.38)"
  hairline: "rgba(255,255,255,.065)"
  hairline-strong: "rgba(255,255,255,.11)"
  signal-hairline: "rgba(252,76,2,.14)"
  surface: "rgba(255,255,255,.02)"
  # 星場：程序化背景的五個色層。既然星空是現行身分，它的調色盤就是系統的一部分。
  field-crown: "#0D0510"
  field-floor: "#050308"
  nebula-warm: "rgba(140,44,8,.08)"
  nebula-cool: "rgba(74,120,255,.11)"
  aurora-violet: "rgba(96,42,150,.06)"
  vignette: "rgba(2,1,4,.72)"
# 兩支字體，各有不可跨越的職務：窄長讀數體只給數字，中性 grotesque 給拉丁標籤，
# 中文一律交還系統字（PingFang / Noto / JhengHei）。窄體拉丁絕不與正常寬度中文同行混排。
typography:
  board-readout:      # 甲板的單一巨大讀數（一屏只有一個）
    fontFamily: "'Saira Condensed', 'Oswald', 'Arial Narrow', sans-serif"
    fontSize: "clamp(62px, 12vw, 132px)"
    fontWeight: 800
    lineHeight: 0.82
    letterSpacing: "-1.5px"
  numeral:            # 生涯／ITT／功率盤／KPI 的一般數字
    fontFamily: "'Saira Condensed', 'Oswald', 'Arial Narrow', sans-serif"
    fontSize: "clamp(30px, 4.5vw, 43px)"
    fontWeight: 800
    lineHeight: 0.9
    letterSpacing: "-1px"
  headline:           # 區塊內的主數值／課表名（中文）
    fontFamily: "'Archivo', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang TC', 'Noto Sans TC', 'Microsoft JhengHei', sans-serif"
    fontSize: "19px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "0.4px"
  title:              # 章節標題 .section-title
    fontFamily: "'Archivo', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang TC', 'Noto Sans TC', 'Microsoft JhengHei', sans-serif"
    fontSize: "13.5px"
    fontWeight: 700
    lineHeight: 1.35
    letterSpacing: "0.5px"
  body:
    fontFamily: "'Archivo', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang TC', 'Noto Sans TC', 'Microsoft JhengHei', sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  nav:                # 側欄導覽項
    fontFamily: "'Archivo', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang TC', 'Noto Sans TC', 'Microsoft JhengHei', sans-serif"
    fontSize: "12.5px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.5px"
  label:              # 拉丁副標、量測窗口、章節英文名
    fontFamily: "'Archivo', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang TC', 'Noto Sans TC', 'Microsoft JhengHei', sans-serif"
    fontSize: "8.5px"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "2.4px"
  micro:              # 徽章、單位、腳註
    fontFamily: "'Archivo', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang TC', 'Noto Sans TC', 'Microsoft JhengHei', sans-serif"
    fontSize: "9px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "0.3px"
rounded:
  hair: "2px"
  chip: "3px"
  tab: "4px"
  soft: "5px"
  control: "6px"
  card: "8px"
  nub: "9px"
  well: "10px"
  panel: "12px"
  modal: "16px"
  hero: "20px"
  pill: "100px"
  dot: "50%"
spacing:
  hairline: "3px"
  tight: "5px"
  base: "8px"
  row: "11px"
  card: "16px"
  block: "34px"
components:
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.control}"
    padding: "7px 9px"
    typography: "{typography.nav}"
  nav-item-current:
    backgroundColor: "rgba(252,76,2,.07)"
    textColor: "{colors.signal-orange}"
    rounded: "{rounded.control}"
    padding: "7px 9px"
  side-link:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.control}"
    padding: "6px 9px"
    typography: "{typography.micro}"
  cta-drawer:
    backgroundColor: "rgba(252,76,2,.09)"
    textColor: "{colors.signal-orange}"
    rounded: "{rounded.card}"
    padding: "11px 14px"
  cta-drawer-hover:
    backgroundColor: "rgba(252,76,2,.2)"
    textColor: "{colors.signal-orange}"
  chip-tab:
    backgroundColor: "rgba(232,124,26,.06)"
    textColor: "rgba(232,124,26,.8)"
    rounded: "22px"
    padding: "10px 18px"
  chip-tab-active:
    backgroundColor: "rgba(232,124,26,.2)"
    textColor: "{colors.segment-amber}"
    rounded: "22px"
    padding: "10px 18px"
  data-row:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.hair}"
    padding: "11px 8px"
  session-row:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    rounded: "0 5px 5px 0"
    padding: "12px 8px 12px 10px"
  cell-button:
    backgroundColor: "transparent"
    textColor: "{colors.ink-primary}"
    rounded: "{rounded.control}"
    padding: "2px 0 4px"
---

# Design System: Strava Telemetry Dashboard

## Overview

**Creative North Star: "深空計時站"（The Deep-Space Timing Post）**

這是一座架在近黑星場之上的分段計時站。背景是程序化生成的深空——雙星雲核交替呼吸、極光慢旋、暗角向內收束保住讀數對比；前景是賽道邊的計時板與工程師桌上的計時紙。兩個 register 疊在一起：**極少字、極大字的板牌**（甲板那個 132px 的單一讀數），與**密集分段秒數的計時紙**（7–13.5px 半階梯的表格與列）。中間沒有第三種尺度，這個斷裂就是版面的組織原則。

密度是給主要使用者的，不是疏漏。他認得每一個縮寫，所以介面不解釋術語、不加圖示、不用卡片包裝每一列資料。畫面上絕大多數的分隔工作由 6.5% 白的髮絲線完成，不由邊框、陰影或圓角完成。橘色是訊號不是裝飾：中性墨階（`--ink-1/2/3`，暖白 `#F4F0EA` 往下衰減）承擔所有預設文字，橘色只在「這件事需要你現在看」時出現。

深度完全不靠投影。這個系統是**平的、但會發光**：作用中的狀態靠橘色輝光（`box-shadow:0 0 6px rgba(252,76,2,.75)`）、面板靠內陰影微微透出橘、甲板讀數靠 `text-shadow` 的橘暈浮起來。星場本身是唯一的空間感來源。

**Key Characteristics:**
- 近黑星場底（`#0A0408`）＋ 程序化星雲／極光，無圖片負載
- 兩個字體 register：Saira Condensed 只給數字，Archivo 只給拉丁標籤，中文交還系統字
- 7–13.5px 的**半階字級梯**（8.5 / 9.5 / 10.5 / 11.5 / 12.5 / 13.5 全在重度使用）
- 髮絲線做分隔，不用卡片；圓角小（2–8px 佔絕大多數）
- 橘 `#FC4C02` 是訊號色，中性暖墨階是預設文字色
- 平面＋發光，零投影式抬升
- 動態極快（.13s / .15s 為主），十個 `prefers-reduced-motion` 區塊且**保留動畫終態**

## Colors

近黑底上的一支高彩度訊號橘，配一組暖白墨階；其餘顏色各自綁定一個資料語意，不作裝飾使用。

### Primary
- **訊號橘 Signal Orange** (#FC4C02): 全站唯一的主訊號。作用中的導覽項、CTA、當前狀態、破紀錄標記、輝光。全檔 120 次使用，是出現最多的字面色——但它**不是文字色**，是狀態色。

### Secondary
- **路段琥珀 Segment Amber** (#E87C1A): ITT 路段世界的專屬色。路段分頁鈕、路段卡邊框、路段圖例。它與訊號橘刻意拉開一個色階，讓「路段」與「全站訊號」在同一畫面上不會混淆。
- **爬升青 Ascent Cyan** (#4AB4FF): 爬升與高度相關的讀數。冷色在暖底上自然後退，適合次要度量。

### Tertiary
- **時長金 Duration Gold** (#FFD24D): 時數與耗時類數值。
- **冠軍金 Crown Gold** (#FFD700): PR／KOM／排名徽記，只給「站上頒獎台」的語意。
- **達標綠 Cleared Green** (#5FD060) 與 **新鮮綠 Fresh Green** (#4AD07A): 前者是目標達成，後者是 TSB 新鮮狀態。
- **警示琥珀 Caution Amber** (#FFB020): 疲勞中、需要注意、未達標。
- **衰退紅 Decline Red** (#FF6A6A): 退步、逾期、失敗。
- **峰焰 Peak Flame** (#FF4500): 峰值標記，橘系的最高溫端。

### Neutral
- **深空 Deep Space** (#0A0408): 頁面底色，帶一點紫紅的近黑，不是純黑。
- **艙壁 Bulkhead** (#060810): 星場漸層的外緣與側欄底。
- **暖白墨 Ink Primary** (#F4F0EA): 預設文字色。**不是純白**——純白只留給甲板讀數。
- **次墨 Ink Secondary** (rgba(244,240,234,.66)) 與 **弱墨 Ink Muted** (rgba(244,240,234,.38)): 說明文字與標籤。
- **髮絲 Hairline** (rgba(255,255,255,.065)): 系統裡幾乎所有的分隔線。
- **微表面 Surface** (rgba(255,255,255,.02)): 需要極輕微區隔的面板底。

### Starfield（背景層）
背景不是一張圖，是五個色層疊出來的：**冠頂 Field Crown** (#0D0510) 往 **深空** (#0A0408) 再往 **場底 Field Floor** (#050308) 的徑向漸層，之上疊 **暖星雲** (rgba(140,44,8,.08))、**冷星雲** (rgba(74,120,255,.11))、**極光紫** (rgba(96,42,150,.06)) 三團 `filter:blur(56px)` 的 `mix-blend-mode:screen` 光斑，最外層再蓋 **暗角 Vignette** (rgba(2,1,4,.72))。暖冷兩個星雲核交替呼吸，極光慢旋。**零圖片負載**——整個氛圍是 CSS 算出來的。

### Named Rules

**The Signal-Not-Ink Rule.** 橘色不得作為預設文字色。任何一段連續閱讀的文字都走 `--ink-1/2/3`；橘色只用於狀態、作用中、與需要立刻被看見的單一數值。這條規則是 2026-07 的中性墨階改造換來的，退回去就是把整頁洗成橘色。

**The One Readout Rule.** 一屏只有一個 `board-readout` 尺度的數字。甲板讓「今年騎了多遠」獨佔版面，其餘三項降一階當儀表列——四個等寬大數字會互相抵消，誰都不是重點。

## Typography

**Readout Font:** Saira Condensed（fallback Oswald → Arial Narrow）
**Label / UI Font:** Archivo（fallback 系統 UI → PingFang TC / Noto Sans TC / JhengHei）
**Mono:** ui-monospace / SF Mono / Menlo（只給檔名、程式碼片段）

**Character:** 窄長的計時板讀數字體收筆帶圓角，壓在一條髮絲標籤之上——那是賽道邊計時牌的形狀。中性 grotesque 承擔所有拉丁標籤與中文旁的說明文字。中文一律交還系統字：窄體拉丁與正常寬度的中文**不可同行混排**，所以兩者永遠分屬不同元素。

### Hierarchy
- **Board Readout**（800, clamp(62–132px), lh .82, ls −1.5px）: 甲板的單一巨大讀數，白色，帶橘色 text-shadow 暈。
- **Numeral**（800, clamp(30–43px), lh .9）: KPI、生涯總量、ITT 成績。一律 `font-variant-numeric:tabular-nums`。
- **Headline**（700, 19px, lh 1.25）: 區塊內的主數值與課表名稱。
- **Title**（700, 13.5px, ls .5px）: 章節標題 `.section-title`，底下壓一條髮絲線。
- **Nav**（600, 12.5px）: 側欄導覽項。
- **Body**（400, 12px, lh 1.5）: 說明文字。長段落封頂 46–70ch。
- **Label**（700, 8.5px, ls 2.4px, uppercase）: 章節英文副標、量測窗口、欄位名。
- **Micro**（700, 9px）: 徽章、單位、腳註。

### Named Rules

**The Half-Step Rule.** 小字級走 0.5px 半階（8.5 / 9.5 / 10.5 / 11.5 / 12.5 / 13.5），不是整數階。在 7–14px 這個帶裡，1px 的跳躍會讓相鄰兩層對比過強；半階讓密集表格能排出五、六層資訊而不吵。**新增小字時沿用半階，不要改成整數。**

**The Tabular Rule.** 任何會隨資料更新的數字都必須 `font-variant-numeric:tabular-nums`＋`font-feature-settings:"tnum" 1`。等寬數字避免滾動或倒數時字寬抖動。

**The Two-Register Rule.** 板牌與計時紙之間沒有中間尺度。要嘛是 ≥30px 的 Saira 讀數，要嘛是 ≤13.5px 的 Archivo／系統字。14–29px 只留給少數過渡元件，不建立新層級。

## Layout

**App shell，不是 landing page。** 版面是 `grid: var(--side-w) minmax(0,1fr)`：左側常駐側欄，右側單一 viewport。切換 view 不捲動，網址是 `#<view>`。

**容器隨螢幕放大，但有硬上限：**

| 斷點 | `--side-w` | `--main-max` |
|---|---|---|
| 預設 | 188px | 1140px |
| ≥1600px | 236px | 1280px |
| ≥2200px | 284px | 1440px |

上限的存在是為了避免 4K 下變成「粗側欄 ＋ 窄內文 ＋ 兩側大片空白」。

**Viewport padding** `26px 26px 72px`（≤1023px 收成 `22px 18px 64px`）。**區塊之間** `margin-bottom:34px`，這是唯一的大間距；區塊內部一律走 3 / 5 / 8 / 11 / 16px。

**響應式轉折：**
- **≤1023px**：側欄收窄到 148px，導覽字級降到 12px。
- **≤767px**：側欄整個 `display:none`，換成底部固定 `tabbar`（橫向捲動，不做漢堡選單——每一個 view 都是 primary destination）。
- **≤640 / 600 / 520px**：逐級收合表格欄位與甲板尺度。

**列的網格**由 `--row-cols` 自訂屬性驅動（`grid-template-columns`），每種列自己宣告欄寬，共用同一個 `.row` 外觀。

### Named Rules

**The No-Card Rule.** 資料列不包卡片。分隔靠 `border-bottom:1px solid var(--hair)`，不靠邊框＋圓角＋投影。九堂課如果每一堂都是一張卡，九堂就一樣重，等於沒有層級。

## Elevation & Depth

**這個系統沒有投影式抬升。** 沒有 `0 4px 12px rgba(0,0,0,...)` 那類的浮起陰影。深度由三件事構成：

1. **星場本身**——`#deepfield` 的徑向漸層與暗角是唯一的空間縱深。
2. **髮絲線與微表面**——6.5% 白的線、2% 白的面，靠明度差分層而不靠陰影。
3. **發光**——作用中的狀態發橘光，不是被打光。

### Shadow Vocabulary
- **訊號輝光**（`box-shadow:0 0 6px rgba(252,76,2,.75)`）: 作用中的導覽圓點、當前狀態指示。
- **路段輝光**（`box-shadow:0 0 12px rgba(232,124,26,.25)`）: 作用中的路段分頁鈕。
- **內緣橘暈**（`box-shadow:inset 0 0 18–30px rgba(252,76,2,.05–.06)`）: 需要「這一塊是熱的」的面板。
- **讀數暈**（`text-shadow:0 0 34px rgba(252,76,2,.22)`，點亮時 `.45`）: 只給甲板讀數。
- **模態底座**（`box-shadow:0 6px 22px rgba(0,0,0,.5), inset 0 0 0 1px rgba(255,255,255,.04)`）: 全站唯一的真陰影，只給浮在內容之上的彈窗。

### Named Rules

**The Emissive Depth Rule.** 需要一個元素往前站，就讓它**發光**，不要給它投影。投影屬於彈窗那一層，其餘一律平面。

## Shapes

圓角小而克制：**2–8px 承擔絕大多數**（2px 17 次、3px 15 次、6px 15 次、8px 13 次）。這個尺度讓元件看起來像儀表面板上的按鍵，而不是消費級 App 的圓潤卡片。

- `hair 2px`：進度條、微標籤、資料列。
- `chip 3px` / `tab 4px` / `soft 5px`：徽章、小標籤、分頁。
- `control 6px`：導覽項、可點的儲存格、側欄連結——**互動元件的預設值**。
- `card 8px` / `nub 9px`：抽屜 CTA、有實體邊框的面板、狀態面板。
- `well 10px` / `panel 12px` / `modal 16px` / `hero 20px`：大面積容器與彈窗。
- `pill 100px`：分頁鈕、狀態膠囊。
- `dot 50%`：狀態圓點（20 次），一律 4px 見方。

邊框幾乎都是 1px 髮絲。唯一的例外是 session row 的 `border-left:2px solid`，用來標記「下一堂」——**左緣色條是這個系統標記當前項的手法**，不是加底色。

### Named Rules

**The Hairline-First Rule.** 需要分隔，先用 `1px solid var(--hair)`。只有當髮絲線不足以表達層級時才升級到背景色差，最後才是邊框＋圓角。

## Components

### Navigation（側欄導覽 `.nav-i`）
- **Shape:** 6px 圓角，整寬按鈕，`padding:7px 9px`
- **Default:** 透明底、`--ink-2` 文字、左側 4px 透明圓點
- **Hover:** 底 `rgba(255,255,255,.04)`、文字升到 `--ink-1`
- **Current** (`[aria-current="page"]`): 底 `rgba(252,76,2,.07)`、文字轉橘、**左側圓點亮橘並發輝光**
- **Focus:** `outline:1px solid rgba(252,76,2,.6)`，offset 1px
- **右側槽位** `em` 掛一個活數字（等寬、弱墨），不是重複英文名
- **Mobile (≤767px):** 換成底部 `tabbar`，橫向捲動

### Buttons
- **抽屜 CTA** (`.dw-cta`): 8px 圓角、`rgba(252,76,2,.09)` 底＋`rgba(252,76,2,.45)` 邊、橘字、12px/700/ls 1.4px uppercase、`padding:11px 14px`。Hover 底加深到 `.2`。這是全站最強的行動召喚，一個 view 不應出現兩個。
- **側欄連結** (`.side-lnk`): 6px 圓角、透明底、弱墨、11px/ls 1.2px。純導向，不搶注意力。
- **儲存格按鈕** (`.ov-cell`): 看起來不像按鈕——透明底、6px 圓角，只有 hover 時浮出 2.5% 白。用在「整格可點進去看詳情」的場合。

### Chips（路段分頁 `.itt-tab-btn`）
- **Style:** 22px 圓角、`rgba(232,124,26,.06)` 底、`rgba(232,124,26,.35)` 邊、14px/700
- **Active / Hover:** 底 `.2`、字與邊轉實琥珀、外加 12px 琥珀輝光
- 這是唯一使用路段琥珀而非訊號橘的互動元件——它屬於 ITT 世界

### Data Rows（`.row` / `.ses`）
- **Grid:** `grid-template-columns:var(--row-cols)`，每種列自訂欄寬
- **分隔:** `border-bottom:1px solid var(--hair)`，無卡片、無投影
- **Hover:** 極輕的背景提升，`transition:background .13s`
- **Session row 三層級:** 過去低對比、未來低對比、**下一堂最高優先**（左緣 2px 橘條）
- **Padding:** `11px 8px`（`.row`）／`12px 8px 12px 10px`（`.ses`）

### Section Header（`.section-title`）
- 13.5px/700 中文標題 ＋ 8.5px/600/ls 2.4px 的橘色 uppercase 拉丁副標（`.muted`，`rgba(252,76,2,.55)`）
- 底部 `border-bottom:1px solid var(--hair)`，`padding-bottom:.45rem`
- 這個「中文主標 ＋ 橘色拉丁副標 ＋ 髮絲底線」是全站最高頻的結構，新區塊一律沿用

### Sidebar Readout Panel（`.rdy`，簽名元件）
側欄底部的常駐狀態面板：TSB 大數字（依 `tsbMood` 分成新鮮／平衡／疲勞中／高負荷四色）、CTL/ATL 雙線迷你圖、以及一條沿 CTL 線跑的**心電圖掃描光點**（`.rdy-scan`，3.6s 線性循環）。下方是可點開趨勢抽屜的量測列（HRV／靜息／睡眠）。

**這是全站唯一持續運動的元素。** 其餘動畫都是狀態轉換觸發的。

## Do's and Don'ts

### Do:
- **Do** 用 `--ink-1/2/3` 當文字色，把橘色留給狀態與訊號（The Signal-Not-Ink Rule）。
- **Do** 小字級沿用 0.5px 半階（8.5 / 9.5 / 10.5 / 11.5 / 12.5 / 13.5）。
- **Do** 所有會更新的數字加 `font-variant-numeric:tabular-nums`。
- **Do** 用 `1px solid var(--hair)` 做分隔，優先於卡片、邊框與背景色差。
- **Do** 要讓元素往前站時用**輝光**（`box-shadow:0 0 Npx rgba(252,76,2,α)`），不用投影。
- **Do** 新區塊沿用「中文主標 ＋ 8.5px 橘色 uppercase 拉丁副標 ＋ 髮絲底線」的章節結構。
- **Do** 互動元件預設 6px 圓角；狀態圓點一律 4px `border-radius:50%`。
- **Do** 缺值時明說（`💀 UNTOUCHED · NO POWER DATA`、「此路線尚無高度資料」），不要補零或留白。
- **Do** 為每個新動畫寫 `prefers-reduced-motion` 區塊，**且保留動畫終態**——這是本專案既有的超規格處理，不得簡化成一刀切關閉。
- **Do** 動態時長維持在 .13s–.2s；主要 easing 用 `cubic-bezier(.2,.9,.25,1)`。

### Don't:
- **Don't** 讓橘色兼任預設文字色——那會把整頁洗成橘色，也是 2026-07 中性墨階改造要解決的問題。
- **Don't** 在一屏放第二個 `board-readout` 尺度的數字。
- **Don't** 把窄體拉丁（Saira Condensed）與正常寬度中文排在同一個元素裡。
- **Don't** 用投影做抬升。真陰影只屬於彈窗那一層。
- **Don't** 把資料列包成卡片——九張等重的卡等於沒有層級。
- **Don't** 建立 14–29px 的新字級層。板牌與計時紙之間刻意沒有中間尺度。
- **Don't** 引入任何需要 build step 的東西（打包工具、框架、CSS 前處理器）。零依賴是這個專案的定位本身。
- **Don't** 用整數階取代半階小字級。
- **Don't** 為了裝飾使用語意色（達標綠／衰退紅／冠軍金各自綁定一個資料意義）。
