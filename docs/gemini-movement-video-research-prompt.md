# Gemini 任務：替 Circuit 動作庫研究 YouTube 教學影片

請把本文件全文與 `data/movements.json` 一起交給 Gemini。

## 可直接貼給 Gemini 的指令

```text
你現在是這個專案的 YouTube 動作教學研究員。請讀取我提供的 `data/movements.json`，只研究影片資料，不要修改 `circuit.html`、`data/movements.json` 或其他程式碼。

你的唯一交付檔案是：

data/movement-videos.json

## 任務目標

`data/movements.json` 目前有 120 個 moves。請替每個 movement 找到 3 支 YouTube 教學影片，共 360 支。

這三支的定義是「與該動作正確版本高度相關的候選中，觀看數最高的三支」，UI 會稱為「熱門教學」，不是「最佳教學」或「最安全教學」。

每個 movement 已有：

- `id`：資料鍵
- `zh`：中文名
- `en`：英文名
- `kw`：既有 YouTube 搜尋關鍵字
- `tier`、`pattern`、`gear`：用來核對動作版本與器材
- `steps`、`wrong`、`cue`：用來判斷影片示範的是否為同一個動作

不要只看影片標題。必須用 movement 的名稱、器材、步驟與常見錯誤核對內容。

## 搜尋方法

每個 movement 至少使用以下搜尋式：

1. `{kw} exercise tutorial proper form`
2. `{en} how to correct form`
3. 如果前兩個結果不足，再搜尋 `{zh} 正確動作 教學`

先建立最多 10 支相關候選，再套用資格規則，最後依公開觀看數由高到低取 3 支。

「相關性資格」一定先於「觀看數」。一支 5,000 萬觀看但示範不同變化式的影片，不得勝過一支 100 萬觀看但動作完全正確的影片。

## 合格規則

影片必須：

1. 是指定 movement 的相同版本，例如單腳、屈膝、等長、負重、每側等差異不可混用。
2. 器材相符；啞鈴、壺鈴、徒手版本不可因名稱相似而混在一起。
3. 能看到完整起始姿勢與主要動作過程。
4. 是公開且目前可播放的 YouTube 影片。
5. 可嵌入其他網站；若無法可靠確認，列入 issues，不要猜。
6. 內容以教學、正確姿勢或技術示範為主。
7. 建議片長 45 秒至 12 分鐘；超出時只有在沒有足夠合格候選的情況下才能採用，並在 `selectionNote` 說明。

排除：

- YouTube Shorts 或純直式短片
- 30 天挑戰、跟練合集、完整 workout
- 反應、搞笑、比賽剪輯、廣告或器材開箱
- 只談好處但沒有完整示範
- 標題相同但實際是不同變化式
- 明顯危險、失控、速度過快或把錯誤姿勢當標準的示範
- 只有音樂、無法判斷技術重點的 montage
- 已下架、私人、地區封鎖或禁止嵌入的影片

語言不限。不要為了湊中文而犧牲相關性或熱門度；請正確填 `language`。若前三支都是英文也可以。

## 排名規則

1. 先通過上述資格規則。
2. 合格候選依目前公開觀看數由高到低排序。
3. 取前三名。
4. 同一支影片不得重複。
5. 不強制三個不同頻道；但若同頻道影片內容重複，保留觀看數較高者。
6. `viewCountAtSelection` 必須是研究當天看到的整數，不可使用「1.2M」字串，也不可估算。
7. 找不到 3 支合格影片時，寧可只留 1～2 支並寫進 `issues`，不可捏造 videoId、觀看數或可嵌入狀態。

## 輸出格式

輸出必須是可直接解析的 UTF-8 JSON，不要加註解，不要用 Markdown code fence 包住 JSON。

格式如下：

{
  "version": 1,
  "generatedAt": "ISO-8601 UTC 時間",
  "source": "gemini-youtube-research",
  "selectionPolicy": "relevance-gate-then-view-count",
  "movementCount": 120,
  "videoCount": 360,
  "movements": {
    "sq-bw": [
      {
        "videoId": "11 字元 YouTube video ID",
        "title": "影片原始標題",
        "channel": "頻道名稱",
        "watchUrl": "https://www.youtube.com/watch?v=VIDEO_ID",
        "durationSec": 192,
        "viewCountAtSelection": 12800000,
        "language": "en",
        "checkedAt": "YYYY-MM-DD",
        "embeddable": true,
        "approved": true,
        "selectionNote": "一句話說明為何確定是正確版本"
      }
    ]
  },
  "issues": []
}

`movements` 的 key 必須使用來源 movement 的 `id`，不是中文名或 `kw`。

如果某動作不足 3 支，格式仍保留已有影片，並加入：

{
  "movementId": "動作 ID",
  "found": 2,
  "reason": "找不到第三支可嵌入且版本相符的教學",
  "queriesTried": ["實際用過的搜尋詞"]
}

此時 `videoCount` 必須填實際數量，不可仍寫 360。

## 分批執行方式

120 個動作很大，請每 20 個 movement 做一批，依 `data/movements.json` 原始順序處理。每批完成後先自行驗證，再繼續下一批。

如果你的工作環境允許寫檔：

1. 直接持續更新 `data/movement-videos.json`。
2. 每批保留前面已完成的資料，不要覆蓋掉。
3. 全部完成後再更新頂層的 `movementCount`、`videoCount`、`generatedAt`。

如果你的環境不能寫檔或一次做不完：

1. 依序輸出 `movement-videos.part-01.json` 到 `movement-videos.part-06.json`。
2. 每個 part 都必須是合法 JSON，包含該批 movement 與 issues。
3. 不要用摘要取代尚未完成的資料，也不要聲稱 120 個都完成。

## 完成前自我檢查

請逐項驗證：

1. `data/movements.json` 的每個 movement id 都在輸出中出現一次。
2. 輸出沒有來源檔不存在的 movement id。
3. 正常完成時每個 movement 恰好 3 支影片。
4. 同一 movement 沒有重複 videoId。
5. 每個 videoId、title、channel、durationSec、viewCountAtSelection、checkedAt、embeddable 都有實際查證。
6. `videoCount` 等於所有影片陣列長度總和。
7. `issues` 與不足 3 支的 movement 完全對得上。
8. JSON 可解析，沒有 trailing comma、註解或 Markdown 標記。
9. 沒有修改任何 HTML、CSS、JavaScript 或原始 movement 資料。

完成後請只回報：

- 產出的檔名
- 完成 movement 數
- 影片總數
- issues 數量與 movement id
- 你實際執行過的驗證

不要另外提出 UI 改版，也不要實作影片播放器。這次只負責影片研究資料。
```

---

## 增補：只補新加的幾個動作

動作庫之後會繼續長。**不要為了幾個新動作重跑整份 360 支** —— 既有資料已經逐一驗證過，
重跑只會多出一堆沒必要的變動，也可能把好的挑選換成差的。

判斷哪些動作缺影片，直接跑：

```bash
node scripts/check-circuit-data.js
```

它會印出 `! N 個動作還沒有教學影片：<id> <id> …`。

給 Gemini 的增補指令用下面這個模板。重點是：

1. **只研究列出來的 id**，不要碰既有的動作。
2. 交付的是**片段**，不是完整檔案 —— 只有 `movements` 與 `issues` 兩個 key。
   合併與頂層欄位（`movementCount`、`videoCount`、`generatedAt`）由我們這邊處理。
3. 每個動作的 `zh`／`en`／`kw`／`steps`／`wrong` 直接寫在指令裡，
   不必再附整份 `data/movements.json`。
4. **一定要點名容易混淆的變化式**。新動作最常見的失敗不是找不到影片，
   而是找到「名字很像但做的是另一個東西」的影片。

```text
你是這個專案的 YouTube 動作教學研究員。這次是增補，不是重做。

只研究下面列出的動作。不要碰、不要重新產生、不要提及其他既有動作。

交付內容是「片段 JSON」，只有兩個 key：

{
  "movements": { "<動作 id>": [ 三支影片 ] },
  "issues": []
}

不要輸出 version / generatedAt / movementCount / videoCount，那些由我們合併時處理。
不要用 Markdown code fence 包住 JSON。

每支影片的欄位（全部都要實際查證，不可估算、不可捏造）：

{
  "videoId": "11 字元 YouTube video ID",
  "title": "影片原始標題",
  "channel": "頻道名稱",
  "watchUrl": "https://www.youtube.com/watch?v=VIDEO_ID",
  "durationSec": 192,
  "viewCountAtSelection": 12800000,
  "language": "en",
  "checkedAt": "YYYY-MM-DD",
  "embeddable": true,
  "approved": true,
  "selectionNote": "一句話說明為何確定是正確版本"
}

規則跟之前完全一樣：

- 相關性資格先於觀看數。合格候選再依觀看數由高到低取前三。
- 每個動作恰好 3 支，同一動作內不得重複 videoId。
- 必須是公開、目前可播放、**允許嵌入其他網站**的影片。無法確認就寫進 issues，不要猜。
- 建議片長 45 秒～12 分鐘。超出只在候選不足時採用，並在 selectionNote 說明。
- 排除：YouTube Shorts、30 天挑戰、跟練合集、完整 workout、反應／搞笑、
  只談好處沒有完整示範、只有音樂的 montage、把錯誤姿勢當標準的示範。
- 語言不限，正確填 language。
- 找不到 3 支就寧可只留 1～2 支並寫進 issues，格式：
  { "movementId": "...", "found": 2, "reason": "...", "queriesTried": ["..."] }

<<在這裡貼上這一批動作的清單與「不要挑錯」提醒>>

完成後只回報：每個動作找到幾支、issues 有哪些、你實際做過哪些查證。
不要提出 UI 建議，不要動任何程式碼。
```

### 合併回來之後要做的

1. 把片段的 `movements` 併進 `data/movement-videos.json`，更新 `movementCount`、
   `videoCount`、`generatedAt`。
2. **逐一打官方 oEmbed 驗證新的 videoId**（`https://www.youtube.com/oembed?format=json&url=…`）——
   回 200 才算數。videoId 是最容易被憑空生出來的欄位。
3. `node scripts/check-circuit-data.js` 應該不再出現「還沒有教學影片」的警告。

## 要提供給 Gemini 的檔案

必要：

1. `data/movements.json`
2. `docs/gemini-movement-video-research-prompt.md`（本文件）

不必提供：

- `circuit.html`
- 其他 Strava／訓練資料
- API key 或任何憑證

## Gemini 應回傳的檔案

- 完整完成：`data/movement-videos.json`
- 若必須分批：`movement-videos.part-01.json` ～ `movement-videos.part-06.json`

分批檔先不要放進正式 `data/` 路徑；全部合併並驗證後，才建立最終的 `data/movement-videos.json`。
