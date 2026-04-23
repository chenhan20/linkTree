# SteveChuang · Personal Hub

> 太空主題個人入口網站，整合線上履歷與 Strava 運動儀表板。
> 部署於 GitHub Pages，每天自動透過 GitHub Actions 同步 Strava 資料。

🔗 **Live：** https://chenhan20.github.io/linkTree/linkTreeIndex.html

---

## 頁面預覽

| 首頁 | Strava 儀表板 |
|------|--------------|
| ![Home](docs/preview-home.png) | ![Strava](docs/preview-strava.png) |

> 截圖放在 `docs/` 資料夾，檔名 `preview-home.png` / `preview-strava.png`

---

## 頁面結構

### 🏠 首頁（linkTreeIndex.html）
- Canvas 星空 + 流星 + 粒子動畫
- 火箭導航動畫
- 社群連結按鈕（Instagram、Facebook、YouTube、Strava、LinkedIn、GitHub）
- 跳轉 Resume 頁面

### 📄 Resume（SPA 內頁）
- 工作經歷時間軸
- Side Projects 展示
- 技能進度條動畫
- 學歷、興趣標籤

### 🚴 Strava 儀表板（strava.html）
- 年度總覽：里程、爬升、次數、時數
- 月度里程長條圖
- 活動紀錄：單車 / 跑步 / 游泳 / 重訓分頁
- All Time 累計數據
- 每天 08:00（台灣時間）自動更新

---

## 技術棧

| 類別 | 技術 |
|------|------|
| 前端框架 | Vue 3 (CDN, Composition API) |
| 動畫 | Canvas API、CSS Animation |
| 資料同步 | Strava OAuth 2.0 + GitHub Actions |
| 部署 | GitHub Pages（靜態，零後端） |

---

## Strava 自動同步流程

```
每天 08:00 (UTC+8)
    ↓
GitHub Actions 執行 scripts/fetch-strava.js
    ↓
用 refresh_token 換 access_token
    ↓
呼叫 Strava API 抓統計 + 活動（單車/跑步/游泳/重訓）
    ↓
寫入 strava.json → commit → push 回 repo
    ↓
GitHub Pages 前端直接 fetch 靜態 JSON
```

手動觸發：**GitHub repo → Actions → Strava Daily Sync → Run workflow**

---

## 本機開發

不需要安裝任何套件，直接用 VS Code Live Server 或：

```bash
# 用 Python 起一個 static server
python -m http.server 8080
```

開啟 http://localhost:8080/linkTreeIndex.html

---

## GitHub Secrets 設定

需要在 **Settings → Secrets and variables → Actions** 設定：

| Secret | 說明 |
|--------|------|
| `STRAVA_CLIENT_ID` | Strava App Client ID |
| `STRAVA_CLIENT_SECRET` | Strava App Client Secret |
| `STRAVA_REFRESH_TOKEN` | OAuth 2.0 Refresh Token（需含 `activity:read_all` scope） |
| `STRAVA_ATHLETE_ID` | 你的 Strava Athlete ID |
