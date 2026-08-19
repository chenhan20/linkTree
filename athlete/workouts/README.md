# 訓練台課表檔

`scripts/make-workout.py` 從 `data/plan.json` 的逐段處方產生，一次輸出三種格式：

| 副檔名 | 內容 | 誰吃得下 |
|---|---|---|
| `.zwo` | Zwift workout XML，瓦數以 FTP 的比例表示 | Rouvy 匯入、Zwift、多數訓練 App |
| `.erg` | 絕對瓦數（CompuTrainer 格式） | Rouvy、TrainerRoad、Golden Cheetah、大部分老牌軟體 |
| `.mrc` | 同 `.erg` 但用 FTP 百分比 | 同上；App 的 FTP 設錯時瓦數會跟著錯 |

**先試 `.zwo`，不行再試 `.erg`。** `.erg` 寫的是絕對瓦數，App 裡的 FTP 設多少都不影響，
所以它最不容易出錯；`.zwo` 與 `.mrc` 都是比例，**匯入前要確認 App 的 FTP 是 238**。

## 兩個一定要懂的修正

**① 傳動損失（`--offset`，預設 3%）**
這個區塊所有數字都是**曲柄功率計**量的（FTP 238、8/13 前測、9/10 後測）。
直驅訓練台量的是鏈條之後，天生比曲柄低 2–3%。所以「戶外處方 185W」在訓練台上要設 179W
才是同一個努力。實際差值量出來之後改 `--offset` 就好。
差超過 5% 通常不是傳動損失，是曲柄那顆沒歸零（Giant 這類曲柄計對溫度敏感）。

**② 當天修正（`--adjust`）**
痠痛、HRV 掉了那種臨時下修，只作用在主課表段，熱身收操不動。

```bash
python3 scripts/make-workout.py 2026-08-20 --offset 3 --adjust -5 --warmup 12 --cooldown 8
```

## 室內跑這些課表的注意事項

- **風扇是必需品**。80 分鐘 tempo 沒風扇，心率會純粹因為體溫爬上去。
- 同瓦數的**心率比戶外高 5–10 bpm**，不要因此降瓦。
- **ERG 模式下的 VI 不算數**：室內天生 1.00–1.02，那是訓練台不讓你滑行，
  不是你學會了不滑行。紀錄要標 indoor，VI 不列入區塊檢核。
