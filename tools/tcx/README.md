# TCX 訓練報告產生器

把 Garmin 匯出的 `.tcx` 變成一頁自包含 HTML 報告，放在 `rides/` 下由 GitHub Pages 直接服務。

## 目錄

```
rides/
  index.html          清單頁（手動更新，或用下面的腳本重生）
  2026-08-11.html     單次訓練報告（自包含，無外部依賴）
  2026-08-06.html
tools/tcx/
  analyze_tcx.py      解析 TCX → 結構化 JSON
  render_dashboard.py JSON → 一頁 HTML
  README.md           這份文件
```

## 產一份新報告

```bash
# 1) 解析（只用 Python 標準函式庫，不必裝任何套件）
python3 tools/tcx/analyze_tcx.py ~/Downloads/activity_123.tcx \
  --ftp 239 --weight 80 --height 173 \
  --strava https://raw.githubusercontent.com/chenhan20/linkTree/master/data/strava.json \
  --json /tmp/ride.json --charts /tmp/chart.json

# 2) 產頁面（--notes 可省略，省略時文案自動生成）
python3 tools/tcx/render_dashboard.py /tmp/ride.json /tmp/chart.json \
  --notes /tmp/notes.json -o rides/2026-08-11.html

# 3) 更新清單頁後推上去
git add rides/ && git commit -m "ride: 2026-08-11" && git push
```

檔名用 `rides/YYYY-MM-DD.html`，清單頁靠這個規則排序。

## `notes.json`（教練評語，選用）

腳本只負責畫圖與算數字，**文字評語由人或 AI 寫**。格式：

```json
{
  "title": "劍 中中中中 劍",
  "lede": "一句話結論，講故事不講數字。可用 <b> 標記重點。",
  "cards": [
    {"level": "good",     "tag": "做得好 · 配速", "title": "教科書等級的負分割", "body": "…"},
    {"level": "warn",     "tag": "注意 · 恢復",   "title": "本週降到 TSS ≤ 250", "body": "…"},
    {"level": "serious",  "tag": "校正 · 數據",   "title": "重測 20 分 FTP",     "body": "…"},
    {"level": "critical", "tag": "最優先",        "title": "重訓拉到每週 2 次",   "body": "…"}
  ],
  "hero": {"title": "體重是爬坡最快的槓桿", "figure": "18:04", "caption": "…"},
  "footnote": "功率為 TCR Pro 0 預設功率計推估值，趨勢比絕對值可靠"
}
```

`level` 只有四個值，對應四個狀態色：`good` / `warn` / `serious` / `critical`。

## 頁面會自動長出什麼

`render_dashboard.py` 依資料決定要畫哪些區塊，沒資料的區塊自動隱藏：

| 區塊 | 出現條件 |
|---|---|
| KPI 列（最多 6 格） | 一定有 |
| 反覆段對比（時間↓／功率↑） | 偵測到 2 趟以上距離相近、爬升 ≥ 60 m、時長 ≥ 5 分的分圈 |
| 全程剖面（海拔＋功率） | 一定有；爬坡分圈打橘底、長停等打灰條 |
| 時間軸帶狀圖 | 有 `blocks` 時；三色分「有效訓練／低強度移動／休息區段」 |
| 四週訓練負荷 | 有帶 `--strava` 時 |
| 功率曲線 vs 個人最佳 | 有帶 `--strava` 且 `power_prs` 有值時 |
| 強度分布 | 有心率或功率時 |
| 教練評語卡 / hero 大數字 | `notes.json` 有給時 |

## 幾個算法上的決定（跟 Strava 對過）

- **NP / IF / TSS 只採計移動中的資料。** 把停等的 0 瓦算進去，實測一趟停等 53 分鐘的騎乘會讓 NP 少 13 W、TSS 多 23。改成移動制之後，兩個測試檔的 NP 與 TSS 都跟 Strava 吻合到 1–2 的誤差內。
- **分圈索引用時間對齊，不是點位序號。** TCX 訊號有缺口時序號會漂移，實測差到 174 秒，會讓分圈功率整個算錯。
- **停等分類**：≤ 90 秒＝路口／紅燈，90–420 秒＝短休，> 420 秒＝長休。
- **心率漂移**在前後半平均功率差 > 25% 時標記為 `reliable: false`，那種數字不該拿來評體能。
- **跟車偵測**只在時速 > 25 km/h 的平路計算，且低於單騎理論功率 18% 以上才回報。

## 環境需求

Python 3.9+，不需要任何第三方套件。`analyze_tcx.py` 處理一個 47 km / 2.8 小時的檔案約 1 秒。
產出的 HTML 約 50 KB，CSS/JS/資料全部內嵌，離線可開，深淺色模式跟隨系統。
