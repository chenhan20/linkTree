<!-- Governs `rides/*.html` and `rides/index.html` ONLY — one of five independent visual worlds in this repo.
     The root DESIGN.md governs `strava.html` (深空觀測站) and is NOT superseded by this file; its rules
     （近黑底、禁白底、禁藍色主色、800px 單欄）are deliberately inverted here and must not be applied to rides.
     Sibling worlds: `strava_helicorder.html` (記震紙), `strava_pitwall.html` (維修站牆),
     `strava_opus5_max.html` (TELEMETRY // OPUS MAX).
     版面不在 HTML 檔裡：真正的來源是 `tools/tcx/render_dashboard.py` 的 `TEMPLATE` 字串
     （報告本體）與 `tools/tcx/build_index.py` 的 page 字串（清單頁）。兩份 CSS 各自獨立，改配色要兩邊一起改。
     Every value below was extracted from the shipped 2026-08-14 output, not from the direction contract. -->
---
name: Cycling Lab Report
description: 一份由教練、運動科學分析師與資料視覺化設計師共同署名的騎乘分析報告 — editorial data visualization on paper, not a dashboard.
colors:
  # 一個強調色。橘只給「結論與處方」，藍只給圖表裡的海拔線，不做 UI 強調。
  accent-rust: "#C8541C"        # --s2  強調色：頭號數字的等第、章節拉丁標籤、圖表功率線、命中處方的分段條
  series-blue: "#2A6FB5"        # --s1  圖表第二序列：海拔線、左右平衡的右腳、功率曲線的「本次」
  paper: "#F6F5F1"              # --paper 暖白紙面。全頁唯一的背景色
  raised: "#FDFCFA"             # --surface-1 只用在 tooltip
  ink-primary: "#15150F"        # --ink-1
  ink-secondary: "#55534B"      # --ink-2
  ink-muted: "#8A877C"          # --ink-3
  rule: "#E2E0D6"               # --rule    列與列之間的髮絲線
  rule-strong: "#CDCABC"        # --rule-2  章節分隔、表頭底線
  grid: "#EAE8DF"               # --grid    圖表格線（比 rule 更淡，刻意讓它幾乎消失）
  axis: "#C4C1B3"               # --axis    圖表基線
  dim: "#D4D1C5"               # --dim     圖表中性條：非最佳的那幾趟、低於處方的分段
  pass-green: "#2B6E2E"         # --good-ink
  attention-amber: "#A06A00"    # --warn
  concern-orange: "#BB5722"     # --serious
  fail-red: "#AD2B21"           # --critical
  # dark（charcoal，不是純黑；不是高對比 gamer UI）
  paper-dark: "#121211"
  raised-dark: "#1B1B19"
  ink-primary-dark: "#F3F2EC"
  ink-secondary-dark: "#A6A39A"
  ink-muted-dark: "#75726A"
  rule-dark: "#282825"
  rule-strong-dark: "#3B3A36"
  grid-dark: "#232320"
  axis-dark: "#3F3E39"
  dim-dark: "#393834"
  accent-rust-dark: "#DD6A35"
  series-blue-dark: "#5B9ADE"
# 兩支系統字，零字體載入。等寬字給所有小標與所有數字，中文正文交還系統無襯線。
# 中文永遠不進等寬堆疊裡當正文 —— 等寬只包住拉丁字與數字。
typography:
  verdict:            # 全頁唯一的頭號數字：課表總分 / 評語指定數字 / NP
    fontFamily: "{fonts.sans}"
    fontSize: "66px"      # ≤820px 收到 52px
    fontWeight: 700
    lineHeight: 0.9
    letterSpacing: "-0.045em"
    fontVariantNumeric: "tabular-nums"
  calibration:        # 校準產出的結果字（撐得住 / 208 W）
    fontFamily: "{fonts.sans}"
    fontSize: "42px"      # ≤560px 收到 34px
    fontWeight: 700
    lineHeight: 1.04
    letterSpacing: "-0.035em"
  masthead:           # 報頭標題（活動名稱）
    fontFamily: "{fonts.sans}"
    fontSize: "34px"      # ≤820px 收到 27px
    fontWeight: 700
    lineHeight: 1.16
    letterSpacing: "-0.024em"
  figure-lg:          # 章節右側結論（總分）、評語 hero
    fontFamily: "{fonts.sans}"
    fontSize: "29px"
    fontWeight: 700
    letterSpacing: "-0.03em"
  readout:            # 量測列的讀數
    fontFamily: "{fonts.sans}"
    fontSize: "22px"
    fontWeight: 650
    lineHeight: 1.22
    letterSpacing: "-0.022em"
    fontVariantNumeric: "tabular-nums"
  heading:            # 章節標題（中文）
    fontFamily: "{fonts.sans}"
    fontSize: "19px"      # ≤560px 收到 17px
    fontWeight: 680
    letterSpacing: "-0.018em"
  lede:               # 報頭敘事
    fontFamily: "{fonts.sans}"
    fontSize: "16px"
    lineHeight: 1.62
    maxWidth: "64ch"
  finding:            # 頭條發現（第一屏回答「最大的問題是什麼」）
    fontFamily: "{fonts.sans}"
    fontSize: "15.5px"
    lineHeight: 1.6
    maxWidth: "58ch"
  subheading:         # 小節標題（中文）
    fontFamily: "{fonts.sans}"
    fontSize: "14.5px"
    fontWeight: 650
  body:
    fontFamily: "{fonts.sans}"
    fontSize: "14.5px"
    lineHeight: 1.62
  data:               # 表格儲存格
    fontFamily: "{fonts.sans}"
    fontSize: "13.5px"
    fontVariantNumeric: "tabular-nums"
  caption:            # 圖說、章節說明
    fontFamily: "{fonts.sans}"
    fontSize: "12.5px"
    lineHeight: 1.65
    maxWidth: "76ch"
  log:                # 稽核紀錄的每一列
    fontFamily: "{fonts.mono}"
    fontSize: "11.5px"
    fontVariantNumeric: "tabular-nums"
  label:              # 章節拉丁標籤（大寫寬字距，橘）
    fontFamily: "{fonts.mono}"
    fontSize: "10px"
    letterSpacing: "0.18em"
    textTransform: "uppercase"
  eyebrow:            # 報頭的日期／路線列
    fontFamily: "{fonts.mono}"
    fontSize: "10.5px"
    letterSpacing: "0.17em"
    textTransform: "uppercase"
  micro:              # 讀數的欄名、表頭
    fontFamily: "{fonts.mono}"
    fontSize: "9.5px"
    letterSpacing: "0.14em"
    textTransform: "uppercase"
fonts:
  sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif"
  mono: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace"
rounded:
  everything: "0"     # 全頁只有一個圓角：狀態圓點
  status-dot: "50%"
spacing:
  hairline: "1px"     # 唯一的分隔手段
  row: "7px"          # 區間表 / 定義列的上下內距
  cell: "12px"        # 表格儲存格
  strip: "14px"       # 量測列
  block: "26px"       # 章節頭到內容
  section: "58px"     # 章節與章節之間
  page-x: "34px"      # ≤820px 收到 20px
layout:
  maxWidth: "1120px"
  sectionHeader: "3.1rem minmax(0,1fr) auto"   # 編號吊在左邊界（marginalia），內容滿版
  columns: "1fr 1fr"                            # 只有並排比較才分欄，中間一條 1px 直線
  breakpoints: ["900px（收起置頂章節導覽）", "820px（章節頭改單欄、並排改直排）", "560px（讀數改兩欄）"]
components:
  metric-strip:       # 一排儀器讀數
    backgroundColor: "transparent"
    border: "1px solid {colors.rule} (上下)"
    divider: "1px solid {colors.rule} (每格左側)"
    padding: "13px 0 14px 17px"
    typography: "{typography.readout} + {typography.micro} 欄名"
  section-header:
    number: "{typography.log} {colors.ink-muted} — 「01 /」吊在內容左邊界外"
    label: "{typography.label} {colors.accent-rust}"
    title: "{typography.heading} {colors.ink-primary}"
    aside: "右側靠齊的結論數字（總分 / 等第），非必要不出現"
  ledger-row:         # 課表逐段對帳的一列
    backgroundColor: "transparent"
    borderBottom: "1px solid {colors.rule}"
    padding: "14px 12px"
    detailRow: "同一列底下 colspan 掛分段條與一行灰字，不另開卡片"
  split-strip:        # 分段功率條（只給主課表段）
    height: "36px"
    gap: "3px"
    barColor: "{colors.accent-rust}（達處方）/ {colors.dim}（低於處方）"
    reference: "1px dashed {colors.ink-muted} 橫過整條，右端標「處方 185 W」"
    maxWidth: "470px"
  audit-log:          # 規則違規逐次紀錄
    typography: "{typography.log}"
    borderBottom: "1px solid {colors.rule}"
    padding: "5px 0"
    columns: "時間點 4.2em / 秒數 4.2em 靠右 / 說明 flex / 段落名靠右"
  zone-row:           # 心率與功率區間
    stackedBar: "9px 高、無圓角、無間隙，放在表格上方當總覽"
    table: "區間名 / 範圍 / 時間 / 佔比 / 條，五欄靠右對齊"
    barColor: "單向藍階 --q1..--q5（見 Colors；dark 模式整組反轉）"
  status-flag:        # 全頁唯一允許的容器
    backgroundColor: "transparent"
    borderLeft: "2px solid {colors.attention-amber}"
    padding: "6px 0 6px 14px"
    usage: "只給擦邊過關、資料品質警語這類「需要被當成狀態」的內容"
  topbar:
    height: "40px"
    backgroundColor: "{colors.paper}"
    borderBottom: "1px solid {colors.rule}"
    behavior: "捲過報頭才淡入；左為身分、中為章節導覽、右永遠是當天結論"
  tooltip:
    backgroundColor: "{colors.raised}"
    border: "1px solid {colors.ring}"
    shadow: "0 4px 18px rgba(0,0,0,.10)"
    usage: "只放次要細節。重要的話必須直接畫在圖上"
---

# Design System: Cycling Lab Report

## Overview

**Creative North Star: 「一份真的有人署名的測試報告」**

這一頁的參照不是 SaaS 儀表板，也不是行銷頁。比例是：
**40% Our World in Data**（資料敘事、圖上標註、editorial hierarchy）、
**30% Linear**（資訊密度、列式 UI、低視覺噪音、次要資訊的退位）、
**20% Vercel**（字體、細線分隔、克制、精準）、
**10% 運動科學實驗報告**（測試協定、儀器讀數、判定條件）。

判準只有一句：**把內容換成假的 SaaS 數據，這個版面還會不會像一般儀表板？**
如果會，就是還不夠。它必須看得出來是專門為 endurance cycling performance analysis 設計的。

這套系統與 `strava.html`（深空觀測站）是**刻意相反**的兩極。那邊是環境優先、近黑底、
半透明面板浮在星野上、密度靠顏色紀律償還；這邊是**紙面優先**：暖白底、零面板、
所有層級只由字級與髮絲線構成。同一份資料在四個世界各講一次，這是其中最安靜的那一個。

**這一頁要在第一屏回答三件事**（不必往下捲）：今天做的是什麼訓練、做得如何、最大的問題是什麼。
依序由 protocol 列（`CALIBRATION · 校準日`）、頭號數字（`81.7 B+` 與四個面向拆解）、
頭條發現（從對帳摘要拉上來的那一句）承擔。三者缺一，第一屏就失效。

**Key Characteristics:**
- 零卡片。章節之間只有 1px 髮絲線與 58px 留白
- 層級全部由字級／字重／字距／顏色／留白建立，不由盒子建立
- 一個強調色（rust）。藍只活在圖表裡當第二序列，不做 UI 強調
- 等寬字給所有小標與所有數字；中文正文交還系統無襯線；零字體載入
- 章節編號吊在左邊界，依「真的顯示出來的章節」動態編號
- 圖表是主角：格線幾乎消失、軸字 9.5px、重要的話直接標在圖上

## Colors

暖白紙面上的單一鏽橘，加一組只表達「判定」的狀態色。中性色是暖灰，不參與意義。

| 角色 | Light | Dark | 用在哪 |
|---|---|---|---|
| accent-rust | `#C8541C` | `#DD6A35` | 頭號數字的等第、章節拉丁標籤、功率線、命中處方的分段條、清單頁的分數 |
| series-blue | `#2A6FB5` | `#5B9ADE` | **只在圖表裡**：海拔線、功率曲線的「本次」、左右平衡的右腳 |
| paper | `#F6F5F1` | `#121211` | 全頁唯一背景。dark 是 charcoal，不是純黑 |
| ink 1/2/3 | `#15150F` / `#55534B` / `#8A877C` | `#F3F2EC` / `#A6A39A` / `#75726A` | 正文三級 |
| rule / rule-2 | `#E2E0D6` / `#CDCABC` | `#282825` / `#3B3A36` | 列間線 / 章節線與表頭線 |
| grid / axis / dim | `#EAE8DF` / `#C4C1B3` / `#D4D1C5` | `#232320` / `#3F3E39` / `#393834` | 圖表格線 / 基線 / 中性條 |
| pass / attention / concern / fail | `#2B6E2E` / `#A06A00` / `#BB5722` / `#AD2B21` | `#4C9A4F`+ / `#C99022` / `#D97A45` / `#E0574A` | **只表達判定**，不做裝飾 |

藍橘這一對本身就是色盲安全的組合（這是原版就選定的，沿用）。
`q1..q5` 是單向藍階（light 由淺到深 `#C4D9F1`→`#1D4C7E`；dark **整組反轉**由深到淺
`#1F4A76`→`#AECDEE`，因為底色反了，序列的方向必須跟著反）。

狀態色的四個名字 `good | warn | serious | critical` 是**與 `rides/notes/*.json` 的資料契約**，
不能改名。

## Typography

單一比例尺，兩支系統字。**巨大字級只給真正重要的數字**——全頁只有一個 66px：
有處方的日子是課表總分，其次是評語指定的數字，再其次是 NP。不是每個 KPI 都放大。

66 → 42 → 34 → 29 → 22 → 19 → 16 → 15.5 → 14.5 → 13.5 → 12.5 → 11.5 → 10.5 → 10 → 9.5

等寬字負責「這是儀器讀出來的」那種語氣：章節拉丁標籤、表頭、欄名、時間點、稽核紀錄、
清單頁的日期與數據欄。中文正文一律回到系統無襯線——**窄字距的大寫拉丁不與中文同行混排**。

所有數字都帶 `font-variant-numeric: tabular-nums`。這不是可選項：逐段對帳表、稽核紀錄、
區間表都靠欄位對齊來掃讀，比例數字會讓整張表失效。

大寫寬字距（`0.14em`–`0.18em`）是結構訊號，只給拉丁標籤，永遠不給內容文字。

## Layout

單一內容欄，最大寬 1120px，左右留白 34px（≤820px 收到 20px）。

章節頭是三欄格線 `3.1rem | 1fr | auto`：編號吊在內容左邊界外（marginalia），
標籤與標題在中欄，右欄放該章的結論數字。**內容本身滿版**——圖表需要寬度，不跟著縮排。

分欄只用在「並排比較」：兩個校準產出、心率 vs 功率區間、負荷 vs 功率曲線。
中間永遠是一條 1px 直線，不是 gap。≤820px 全部改直排，直線改成上邊線。

長表格（逐段對帳 700px、附錄明細 660px）包在 `overflow-x: auto` 裡橫向捲動，
**頁面本身永遠不橫向捲**。

章節順序固定，缺資料就整節不出現，編號在最後依實際顯示的章節重編：
`Assessment → Calibration → Execution → Ride profile → Physiology → Context → Device → Appendix`。
次要資料（裝置原始數據、左右平衡、完整分圈、路段分類、停等）一律往後放並縮小字級，
但**不刪除**。

## Elevation & Depth

這套系統**沒有深度**。全頁只有兩個非零的陰影／圓角：

- `#tip` 的 `0 4px 18px rgba(0,0,0,.10)`——tooltip 必須浮起來才讀得到
- 狀態圓點的 `border-radius: 50%`——6px，是形狀不是容器

其他所有層級都由 1px 髮絲線與留白表達。`rule` 分列、`rule-2` 分章與表頭、`grid` 畫圖表格線。
三者的差異刻意做得很小：在紙面上，線只需要「存在」，不需要「被看見」。

## Motion

兩個 opacity 過場，各一次：置頂列淡入 `.18s`、tooltip 淡入 `.1s`。**沒有其他動態。**
沒有數字滾動、沒有進場動畫、沒有 hover 位移、沒有發光。
清單頁的 hover 只換背景色，不移動。

## Charts

圖表全部是行內 SVG，由頁面內的 vanilla JS 依資料繪製。沒有函式庫、沒有網路請求。

- 序列線 `stroke-width: 1.6`；標註線 `1px` + `dasharray 4 3`
- 軸字 9.5px 等寬；格線用 `--grid`（幾乎看不見）；基線用 `--axis`
- 刻度取 1 / 2 / 2.5 / 5 的整數倍（`niceScale()`）。研究報告的軸不會出現 175 或 394
- **海拔軸不從 0 起算**：平路那趟（最高 14 公尺）硬要 0–100 就是一條貼底直線，等於沒有這張圖。
  取實際區間往外墊，刻度取整之後再把底下多出來的整格收回來
- **重要的話直接畫在圖上**：處方瓦數是虛線橫過功率面板並標字；課表段落標在時間軸上方
  （那是唯一時間軸與課表能精確對齊的地方）。tooltip 只放次要細節
- 條形圖用矩形，不用圓角路徑。強調用顏色（rust vs dim），不用尺寸

## Components

`.strip / .mx`（量測列）、`.verdict`（頭號數字）、`.finding`（頭條發現）、`.sec-h`（章節頭）、
`.act`（評語列）、`.cal`（校準並排）、`.cliff`（功率斷崖階梯）、`.led`（逐段對帳表）、
`.sp`（分段功率條）、`.dims`（分數拆解）、`.rule / .log`（規則稽核）、`.zt`（區間表）、
`.facts`（生理讀數列）、`.dev`（裝置定義列）、`.lr`（左右平衡）、`.tbl`（附錄表）、
`.topbar`、`#tip`。

新的區塊請從這裡挑一個沿用。**不要發明新的容器樣式**——這套系統的一致性來自「可用的形狀很少」。

## Do's and Don'ts

### Do:
- **Do** 讓新區塊直接坐在紙面上，用 1px 髮絲線與留白分隔。需要容器時只用 `.flag`（一條左邊線）。
- **Do** 把重複出現的資料收斂到一處：報頭的 lede 已經講過 TSS／IF，頭號數字旁邊就換講別的。
  **同一個數字在第一屏出現兩次，是這套版面最容易犯的錯。**
- **Do** 讓狀態只用小字、顏色或很小的 marker 表達（6px 圓點、有顏色的數字）。
- **Do** 讓時間點寫成可以拿碼錶對回去的格式（`21:48`，不是「第 21.8 分」）。
- **Do** 在圖上直接標註結論性的線與段落名，tooltip 只留次要細節。
- **Do** 讓次要資料退位（更小、更淡、更後面），但保留全部資料，不刪。
- **Do** 讓章節編號由 JS 依實際顯示的章節重編——大部分章節是有資料才出現的。
- **Do** 保持 dark mode 是 charcoal + 柔化強調色的科學軟體感。
- **Do** 讓所有數字帶 `tabular-nums`。

### Don't:
- **Don't** 把區塊包成卡片（白底 + border + 圓角 + padding + margin）。**這是這次改版要拆掉的東西本身。**
- **Don't** 用漸層、毛玻璃、backdrop blur、發光、投影、彈跳緩動、動畫計數器、裝飾性插圖。
- **Don't** 用 emoji 當 UI。原版的 `⚠️` 已經換成一條左邊線。
- **Don't** 加第二個強調色。藍色只准活在圖表裡；要新增維度就用既有的藍階或狀態色。
- **Don't** 借用狀態色來配色。看到綠或紅，就該代表有判定發生。
- **Don't** 寫 "Insights"、"AI powered"、"Performance intelligence"、"Your journey" 這種
  generic AI product 文案。保留原本直接、具體、帶數據的中文。
- **Don't** 把 Linear 的外觀整套搬過來——不要 sidebar、不要 issue icon、不要 command palette、
  不要 status pill。借的只有密度、層級、列式與低噪音。
- **Don't** 在手機版把所有東西疊成一長串卡片。表格橫向捲、讀數兩欄、主要數字先出現。
- **Don't** 把 `DESIGN.md`（深空觀測站）的規則套到這裡。那份文件禁白底、禁藍色主色、
  規定 800px 單欄——三條在這個世界都是反的。
- **Don't** 引入任何需要 build step 的東西：webfont、CSS 預處理器、打包工具。
  這一頁必須離線打開就是完整的。

## 三條會出事的硬約束

動 `TEMPLATE` 之前先讀這三條，每一條都真的踩過：

1. **輸出的第一個字串必須是字面的 `<!DOCTYPE html>`**，而且 `<!-- ride-meta … -->` 必須留在
   **前 4096 bytes**。`render_dashboard.py:main()` 靠 replace doctype 來插入那行註解，
   而 `tools/tcx/build_index.py` 只讀每頁前 4 KB 找它。掉出去，那一天就從 `rides/index.html`
   與 `rides/index.json` 消失（strava.html 的活動彈窗也連不到）。
2. **版型裡不能出現任何 `__大寫__` 形式的字面字串**，會跟
   `__TITLE__ __EYEBROW__ __H1__ __LEDE__ __RIDE__ __CHART__ __NOTES__ __SCORE__` 這組佔位符碰撞。
3. **`notes.json` 的 `level` 只有 `good | warn | serious | critical`**，是與 `rides/notes/*.json`
   的資料契約。狀態色可以換值，不能換名字。

另外：改了模版**不會自動傳播**到既有的 `rides/*.html`。排程的 workflow 不帶 `--overwrite`，
已存在的日期一律跳過。重生方式見 memory `ride-report-rebuild-does-not-propagate`。
