---
version: 1
slug: "strava-html"
primary_target: "strava.html"
related_targets: ["linkTreeIndex.html"]
---

# Surface brief — strava.html + linkTreeIndex.html

## Scope & mode

兩個表面共用一個視覺世界，不同語域：

- **`strava.html` — Operate.** 使用者完成任務：判斷這次表現在歷史裡的位置、決定下次練什麼。
- **`linkTreeIndex.html` — Persuade.** 訪客決定並行動：認識這個人、點進履歷或社群。

## Audience & job

主要使用者是作者本人（訓練管理，自己優先），次要是專業訪客與招募方。詳見 PRODUCT.md。此處只記本表面策略。

**核心任務**：騎完車回家，晚上用手機，一眼看出「比 PR 慢多少、本月還差幾次」。

## Chosen direction — 維修站牆 The Pit Wall

方向骰 seed `0eec39da`，scope `direction`，mode `operate`，指派 index 4（我方推導清單第 4 項）。使用者於決策頁核定 `assigned`，無 steer。挑戰者 TDR info-noise sleeve 與 rain-night cityscape 經融合後在「受眾識別感」軸落敗，已具名提出並被放棄。

**世界**：維修站牆上只有兩種東西 —— 舉給車手看的**板牌**（極少字、極大字：位置、差距、還剩多少）與工程師桌上的**計時紙**（密集分段秒數）。兩個 register 就是組織原則：頭條夠狠，細節夠密。材質是消光石板黑與陽極鋁，主墨是粉筆白，不是發光霓虹。

**構圖（comp A，使用者於 2026-07-27 核定）**：`.impeccable/mocks/comp-a-board-dominant.html`。第一屏是板牌三槽；捲動後板牌壓縮成固定三格條（comp B 的頂部條，未被丟棄，成為 A 的捲動狀態）；計時紙接續。

**核定後的必要修正（comp A 未解、建置時必須做）**：
1. 板牌**不做滿 100svh**，留一截計時紙探頭 —— 滿版第一屏缺導引，使用者只會看第一屏。
2. 頁尾**明說章節數**（「計時紙 · 6 個路段 · 12 個月」），不用含糊的 TIMING SHEET。
3. **常駐頂欄**：捲動後板牌壓縮成固定條。
4. 桌機標籤與數值間的空溝是版面缺陷，不是設計，不得照抄。

## Colour system — 分段計時色（功能性，非裝飾）

| 色 | 語意 | 對應既有狀態 |
|---|---|---|
| 紫 | **90 天內最佳** | 沿用 segScore 既有的 90 天基準線窗口（2026-07-27 確認，取代賽車原制的「全場最速」，因單人計時永無全場） |
| 綠 | 歷史 PR / 個人最佳 | `👑 PR`、`🚀 BREAKTHROUGH` |
| 黃 | 比自己慢 | `📉 DECLINING` |
| 灰 | 尚未計時 / 缺資料 | `💀 UNTOUCHED`、`NO POWER DATA` |

紫與綠可同時存在於同一路段（近期最佳 ≠ 歷史最佳）。

## Constraints（本表面）

- 區塊順序與資訊密度**原封不動**（使用者指定）。只換視覺語言。
- 完整保留：3D 軌跡回放場景本體、每日一句語錄、星座名片（改置於車手識別證的頭盔徽記位置）。
- `linkTreeIndex.html` 的火箭導覽動畫未列入保留 —— 那是太空語彙，與新世界衝突。
- 無 build step、無 webfont（見 PRODUCT.md）。字體用系統堆疊，簽名是 `tabular-nums`（計時表本來就必須對齊欄位），不是字體。

## 失敗長相（使用者指定的反面）

1. 堆滿賽車裝飾元素（格子旗、輪胎痕、贊助貼紙）—— 形式對了但變成 cosplay
2. 資訊變少了 —— 為了視覺乾淨而拿掉數據
3. 兩頁看起來像兩個網站

## Implementation fidelity inventory

| 元素 | 媒材 | 備註 |
|---|---|---|
| 板牌三槽、計時紙表格 | 語意 HTML/CSS | 純程式碼，不得點陣化文字或控制項 |
| 坡度剖面 | 內嵌 SVG | comp 中對比過低（`#31363D` 壓在 `#191C20`），必須提高 |
| 分段計時色點 | CSS | 需搭配非顏色的第二編碼（形狀或文字），色盲不得只靠顏色分辨 |
| 星座名片 canvas | 現有專案資產 | 保留現有 canvas 邏輯，改殼為頭盔徽記 |
| 3D 軌跡回放 | 現有專案資產（Three.js） | 場景不動，僅 HUD 改為賽車遙測語彙 |
| 台北小地圖 | 現有專案資產 | OSM 邊界資料，維持 |
| 頭像 | 現有 raster | `docs/avatar.jpg` 需縮至 128px（現為 1024px／1.57 MB） |
| 太空背景 | **淘汰** | `docs/space_bg.png`（2.25 MB）隨主題退役，不替換為等價大圖 |
| 材質（石板／陽極鋁） | CSS | **材質暗示，非材質模擬**。不得使用寫實粉筆／黑板貼圖，會變黑板報 |

## Unresolved

- `linkTreeIndex.html` 的 Resume SPA 內頁在新世界的語域尚未決定（車手履歷？隊伍檔案？）。建置 `strava.html` 時一併想清楚。
- 五個舊主題檔（aespa/lol/halo/cs/maple）的切換器已決定收掉，但舊檔本身去留未定。
- `docs/strava-*.png` 截圖與 README 第 46–47 行的頁面結構描述，建置後會過時，需回頭更新。
