# fable51 驗證探針（headless Chrome + CDP）

用本機 Chrome 的 headless 模式實際載入頁面、切九個 view、開抽屜與彈窗、跑 3D 與地圖、切三種效果模式，
量 hash／溢位／rAF loop／console，並存截圖。Node 24 內建 WebSocket，不需要安裝任何套件。

```bash
# 1. 先起 HTTP server（fetch JSON 不能走 file://）
python3 -m http.server 8765 --bind 127.0.0.1
# 2. 完整探針：<寬> <高> <手機 0|1> <標籤> [reduced 0|1] [截圖 0|1]
node docs/review/probe/probe.js 1440 1000 0 d1440 0 1
node docs/review/probe/probe.js 390 844 1 m390 0 1
node docs/review/probe/probe.js 390 844 1 m390r 1 1        # prefers-reduced-motion
FX_URL=http://127.0.0.1:8765/strava.html node docs/review/probe/probe.js 1024 768 0 r1024 0 1   # 換名之後
# 3. 降級：擋掉 fx／theme、擋掉 strava.json
node docs/review/probe/nofx.js
# 4. 原版基準（溢位）
node docs/review/probe/base.js 1440 1000 0
```
截圖與 JSON 報告落在 `docs/review/probe/shots/`。headless 的 rAF 計數不能拿來當效能數字（軟體渲染下原版也只量到 0），
探針另外量「動效層 JS 端每幀成本」；raster 端的成本要在真機看。
