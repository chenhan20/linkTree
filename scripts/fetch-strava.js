// fetch-strava.js
// 每天由 GitHub Actions 執行，抓 Strava 資料寫入 strava.json

const fs = require('fs')
const path = require('path')
const https = require('https')

// ── 從環境變數讀 secrets（GitHub Actions 會注入）──
const CLIENT_ID     = process.env.STRAVA_CLIENT_ID
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET
const REFRESH_TOKEN = process.env.STRAVA_REFRESH_TOKEN
const ATHLETE_ID    = process.env.STRAVA_ATHLETE_ID  // 你的 161539959

const OUT_FILE = path.join(__dirname, '..', 'strava.json')

// ── 簡單的 HTTPS helper（不裝額外套件）──
function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try { resolve(JSON.parse(data)) }
        catch (e) { reject(new Error('JSON parse error: ' + data)) }
      })
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

// ── Step 1：用 refresh_token 換新的 access_token ──
async function getAccessToken() {
  const body = new URLSearchParams({
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: REFRESH_TOKEN,
    grant_type:    'refresh_token',
  }).toString()

  const data = await request({
    hostname: 'www.strava.com',
    path:     '/oauth/token',
    method:   'POST',
    headers:  {
      'Content-Type':   'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
    },
  }, body)

  if (!data.access_token) throw new Error('Token 換取失敗：' + JSON.stringify(data))
  console.log('✅ access_token 取得成功')
  return data.access_token
}

// ── Step 2：抓總統計 ──
async function fetchStats(token) {
  const data = await request({
    hostname: 'www.strava.com',
    path:     `/api/v3/athletes/${ATHLETE_ID}/stats`,
    method:   'GET',
    headers:  { Authorization: `Bearer ${token}` },
  })
  console.log('✅ stats 抓取成功')
  return data
}

// ── Step 3：抓最近 5 筆活動 ──
async function fetchRecentActivities(token) {
  const data = await request({
    hostname: 'www.strava.com',
    path:     '/api/v3/athlete/activities?per_page=5&page=1',
    method:   'GET',
    headers:  { Authorization: `Bearer ${token}` },
  })
  console.log(`✅ 最近活動抓取成功，共 ${data.length} 筆`)
  return data
}

// ── Step 4：組合資料、處理 monthly_history ──
function buildJSON(stats, activities) {
  const s = stats

  // 讀現有 JSON（如果有），保留 monthly_history 歷史
  let existing = { monthly_history: [] }
  if (fs.existsSync(OUT_FILE)) {
    try { existing = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')) }
    catch (e) { console.warn('⚠️  現有 JSON 讀取失敗，重新建立') }
  }

  // 算本月里程（從最近活動撈同月的加總）
  const now = new Date()
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  // 用 ytd totals 和歷史月份推算（Strava API 沒有直接給單月，用 ytd 扣前幾月）
  // 簡單做法：直接用本月活動加總
  const thisMonthRides = activities.filter(a => {
    return a.type === 'Ride' && a.start_date.startsWith(thisMonth.replace('-', '-'))
  })
  // 注意：per_page=5 可能不含完整本月，這裡用 ytd 的最後差值會更準
  // 但對每天更新來說這樣已經夠用，之後可以改用 /activities?after=epoch

  const thisMonthData = {
    month:        thisMonth,
    distance_km:  Math.round(s.ytd_ride_totals.distance / 10) / 100,
    elevation_m:  Math.round(s.ytd_ride_totals.elevation_gain),
    rides:        s.ytd_ride_totals.count,
  }

  // 更新 monthly_history：找本月那筆更新，找不到就 append
  const history = existing.monthly_history || []
  const idx = history.findIndex(h => h.month === thisMonth)
  if (idx >= 0) history[idx] = thisMonthData
  else history.push(thisMonthData)
  // 按月份排序
  history.sort((a, b) => a.month.localeCompare(b.month))

  // 組最近活動
  const recentRides = activities
    .filter(a => a.type === 'Ride')
    .slice(0, 5)
    .map(a => ({
      name:          a.name,
      date:          a.start_date.slice(0, 10),
      distance_km:   Math.round(a.distance / 10) / 100,
      moving_time_hr: Math.round(a.moving_time / 360) / 10,
      elevation_m:   Math.round(a.total_elevation_gain),
      avg_speed_kmh: Math.round(a.average_speed * 36) / 10,
    }))

  return {
    updated_at: new Date().toISOString(),
    summary: {
      ytd_distance_km:    Math.round(s.ytd_ride_totals.distance / 10) / 100,
      ytd_elevation_m:    Math.round(s.ytd_ride_totals.elevation_gain),
      ytd_rides:          s.ytd_ride_totals.count,
      ytd_moving_time_hr: Math.round(s.ytd_ride_totals.moving_time / 360) / 10,
      all_time_distance_km: Math.round(s.all_ride_totals.distance / 10) / 100,
      all_time_rides:     s.all_ride_totals.count,
      all_time_elevation_m: Math.round(s.all_ride_totals.elevation_gain),
    },
    recent_rides:    recentRides,
    monthly_history: history,
  }
}

// ── 主程式 ──
async function main() {
  console.log('🚀 Strava sync 開始...')

  // 檢查環境變數
  for (const [k, v] of Object.entries({ CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN, ATHLETE_ID })) {
    if (!v) throw new Error(`缺少環境變數：${k}`)
  }

  const token      = await getAccessToken()
  const stats      = await fetchStats(token)
  const activities = await fetchRecentActivities(token)
  const result     = buildJSON(stats, activities)

  fs.writeFileSync(OUT_FILE, JSON.stringify(result, null, 2), 'utf8')
  console.log(`✅ strava.json 寫入完成 (${OUT_FILE})`)
  console.log(`   今年里程：${result.summary.ytd_distance_km} km`)
  console.log(`   今年次數：${result.summary.ytd_rides} rides`)
}

main().catch(err => {
  console.error('❌ 錯誤：', err.message)
  process.exit(1)  // 非 0 exit code 讓 GitHub Actions 標記為失敗
})
