# test-strava-api.ps1
# 手動測試 Strava API，不需要跑 GitHub Actions
# 用法：先填入下方三個變數，再執行這個腳本
#
# .\scripts\test-strava-api.ps1
#
# 或指定要查的 activity ID：
# .\scripts\test-strava-api.ps1 -ActivityId 12345678

param(
  [string]$ActivityId = ""
)

# ── 自動讀取同目錄的 .env 檔（不存在也沒關係，改用環境變數）──
$envFile = Join-Path $PSScriptRoot ".env"
if (Test-Path $envFile) {
  Get-Content $envFile | Where-Object { $_ -match '^\s*([^#][^=]+)=(.*)$' } | ForEach-Object {
    $parts = $_ -split '=', 2
    $key   = $parts[0].Trim()
    $value = $parts[1].Trim()
    if ($value -and -not (Get-Item "env:$key" -ErrorAction SilentlyContinue)) {
      Set-Item "env:$key" $value
    }
  }
  Write-Host "✅ 從 .env 讀取設定" -ForegroundColor DarkGray
}

# ── 填入你的 Strava OAuth 資訊 ──
# 可在 https://www.strava.com/settings/api 取得
$CLIENT_ID     = $env:STRAVA_CLIENT_ID     # 或直接貼值，例如 "12345"
$CLIENT_SECRET = $env:STRAVA_CLIENT_SECRET # 例如 "abc123..."
$REFRESH_TOKEN = $env:STRAVA_REFRESH_TOKEN # 例如 "def456..."
$ATHLETE_ID    = $env:STRAVA_ATHLETE_ID    # 例如 "161539959"

if (-not $CLIENT_ID) {
  Write-Error "請設定環境變數 STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET / STRAVA_REFRESH_TOKEN / STRAVA_ATHLETE_ID"
  exit 1
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host " Step 1: 換 access_token" -ForegroundColor Cyan
Write-Host "========================================`n"

# curl 等效說明（你可以直接貼進 terminal 測試）：
# curl -X POST https://www.strava.com/oauth/token \
#   -d client_id=YOUR_CLIENT_ID \
#   -d client_secret=YOUR_CLIENT_SECRET \
#   -d refresh_token=YOUR_REFRESH_TOKEN \
#   -d grant_type=refresh_token

$tokenResp = Invoke-RestMethod -Method POST -Uri "https://www.strava.com/oauth/token" -Body @{
  client_id     = $CLIENT_ID
  client_secret = $CLIENT_SECRET
  refresh_token = $REFRESH_TOKEN
  grant_type    = "refresh_token"
}
$TOKEN = $tokenResp.access_token
Write-Host "✅ access_token: $($TOKEN.Substring(0,12))... (已截短)" -ForegroundColor Green

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host " Step 2: 抓 Athlete Stats" -ForegroundColor Cyan
Write-Host "========================================`n"

# curl 等效：
# curl -H "Authorization: Bearer YOUR_TOKEN" \
#   https://www.strava.com/api/v3/athletes/ATHLETE_ID/stats

$stats = Invoke-RestMethod -Uri "https://www.strava.com/api/v3/athletes/$ATHLETE_ID/stats" `
  -Headers @{ Authorization = "Bearer $TOKEN" }
Write-Host "YTD 騎車距離: $([Math]::Round($stats.ytd_ride_totals.distance/1000,1)) km"
Write-Host "YTD 跑步距離: $([Math]::Round($stats.ytd_run_totals.distance/1000,1)) km"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host " Step 3: 抓最近 10 筆活動" -ForegroundColor Cyan
Write-Host "========================================`n"

# curl 等效：
# curl -H "Authorization: Bearer YOUR_TOKEN" \
#   "https://www.strava.com/api/v3/athlete/activities?per_page=10&page=1"

$activities = Invoke-RestMethod -Uri "https://www.strava.com/api/v3/athlete/activities?per_page=10&page=1" `
  -Headers @{ Authorization = "Bearer $TOKEN" }

foreach ($a in $activities) {
  $dist = if ($a.distance -gt 0) { "$([Math]::Round($a.distance/1000,1)) km" } else { "室內" }
  Write-Host "[$($a.type.PadRight(12))] $($a.start_date_local.Substring(0,10))  $($a.name.PadRight(30)) $dist  id=$($a.id)"
}

if ($ActivityId) {
  Write-Host "`n========================================" -ForegroundColor Cyan
  Write-Host " Step 4: 抓指定活動 Laps (id=$ActivityId)" -ForegroundColor Cyan
  Write-Host "========================================`n"

  # curl 等效：
  # curl -H "Authorization: Bearer YOUR_TOKEN" \
  #   https://www.strava.com/api/v3/activities/ACTIVITY_ID

  $detail = Invoke-RestMethod -Uri "https://www.strava.com/api/v3/activities/$ActivityId" `
    -Headers @{ Authorization = "Bearer $TOKEN" }

  Write-Host "活動名稱: $($detail.name)"
  Write-Host "類型: $($detail.type)"
  Write-Host "總 Lap 數: $($detail.laps.Count)`n"

  foreach ($lap in $detail.laps) {
    $min = [Math]::Round($lap.moving_time / 60)
    $watts = if ($lap.average_watts) { "$($lap.average_watts)W" } else { "—" }
    $hr = if ($lap.average_heartrate) { "$([Math]::Round($lap.average_heartrate))bpm" } else { "—" }
    Write-Host "  Lap $($lap.lap_index): $min 分  $watts  $hr  移動時間>5min=$($lap.moving_time -gt 300)"
  }
} else {
  Write-Host "`n💡 提示：加上 -ActivityId <id> 參數可以查看特定活動的 Lap 詳情" -ForegroundColor Yellow
  Write-Host "   例如: .\scripts\test-strava-api.ps1 -ActivityId $($activities[0].id)" -ForegroundColor Yellow
}

Write-Host "`n✅ 測試完成`n" -ForegroundColor Green
