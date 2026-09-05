# strava_cinema.html · Task 7 回歸腳本（CDP）

三支都是 Node 24 內建 WebSocket 直接講 CDP，不用裝套件。先起靜態伺服器：

```bash
python3 -m http.server 8934 --bind 127.0.0.1
```

- `test-pc.mjs <outdir>`：桌機 1440×1000 全套回歸（hub／舊 hash／子路由／back-forward、TODAY 互動、drawer、
  功率彈窗、活動彈窗、3D 回放、ITT 測量檯、Atlas、趨勢工作台與 tooltip、收成、身體、ALL、reduced motion、
  資料降級、命中區、效能）。`ONLY="關鍵字,關鍵字"` 只跑名稱含這些字的測試；跑子集時記得把 `load #today` 帶上，
  很多測試假設頁面已經載入。結果印在 stdout，`t7-report.json` 與 `t7_*.png` 寫到 outdir。
- `shoot.mjs <outdir> view…`：真實渲染截圖（`W=390 H=844 MOBILE=1` 切手機）。
- `probe.mjs <view> "<js>"`：導航到某個 view、等 ready、印一段 JS 的結果（`MOBILE=1`、`WAIT=ms`）。

測試環境的三個陷阱（都寫在 memory 裡）：headless 的影片是軟體解碼會拖慢 rAF、原版 CSS 的 smooth scroll 會讓點擊落到別處、
場景引擎 OVERDRIVE 在軟體 GL 太重 —— 腳本已經處理（play 打樁、注入 scroll-behavior:auto、預設 QUIET）。
- `lens.mjs <outdir>`：鏡頭轉場（defocus → focus pull → lock）的快速檢查：首次進站的 blur 曲線與影片是否一直播、跨 hub 只有 5px 重新對焦、
  同 hub rail 只有 dissolve、REVIEW→TODAY、快速連點、back／forward、reduced-motion；最後把該頁面的時鐘（rAF／now／setTimeout 走 shim，
  CSS 動畫走 `Animation.setPlaybackRate`）放慢 8 倍截中途幀。`MOBILE=1` 切 390×844。`probe.mjs` 也吃 `W=`/`H=` 模擬窄桌機。
- `hero.mjs <outdir>`：Hero 鏡頭（景深層、對焦框、點對焦、兩秒自動對焦、距離尺、峰值）的快檢；`MOBILE=1` 切 390×844；最後一段放慢 8 倍截中途幀。
- `fuji.mjs <outdir>`：富士鏡頭模式（2026-09-04）快檢：開場時間軸（0.5／1.2／1.7 秒）、push-in 是否推到 1.05 後停住且切 view 不重播、
  FX 面板（底片／光圈／動態）開關與 Esc、ACROS 只套到媒體層（.td-panel／.topbar 的 filter 必須是 none）、AUTO 依 hub 換檔。`MOBILE=1` 切 390×844。
- `fuji-modes.mjs <outdir>`：`MODE=reduced|quiet|iris|deep`（`PORT=` 各自不同才能並行）：reduced-motion／QUIET 直接停在最終構圖、換底片的光圈閉合取樣、
  深連結（#itt/segment、#log/activity、#atlas）、舊 hash、back／forward、drawer 與 Esc。headless 沒有 WebGL，`THREE ... Error creating WebGL context` 是環境的，不是回歸。
- `r3d.mjs`：3D 回放（2026-09-05 三種鏡頭版）快檢：用 `--use-angle=swiftshader --enable-unsafe-swiftshader` 拿到軟體 WebGL，
  開 #log 第一筆有 route_stream 的活動，鳥瞰／追蹤／俯視各截一張、播放、鍵盤（空白／1／Esc）、關閉再開。`MOBILE=1` 切 390×844。
