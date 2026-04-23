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

// ── Step 3：抓最近 100 筆活動（涵蓋多種運動類型）──
async function fetchRecentActivities(token) {
  const data = await request({
    hostname: 'www.strava.com',
    path:     '/api/v3/athlete/activities?per_page=100&page=1',
    method:   'GET',
    headers:  { Authorization: `Bearer ${token}` },
  })
  if (!Array.isArray(data)) {
    throw new Error('activities API 回傳非陣列：' + JSON.stringify(data))
  }
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

  const now = new Date()
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  // ── 判斷運動類型 ──
  const RIDE_TYPES   = ['Ride', 'VirtualRide', 'EBikeRide', 'MountainBikeRide']
  const RUN_TYPES    = ['Run', 'VirtualRun', 'TrailRun']
  const SWIM_TYPES   = ['Swim']
  const WEIGHT_TYPES = ['WeightTraining', 'Workout', 'CrossFit', 'Yoga', 'Pilates']

  function isType(a, types) { return types.includes(a.type) }
  function sumDist(arr) { return Math.round(arr.reduce((s, a) => s + a.distance, 0) / 10) / 100 }
  function sumElev(arr) { return Math.round(arr.reduce((s, a) => s + a.total_elevation_gain, 0)) }

  // ── 本月各類型活動 ──
  const thisMonthActs = activities.filter(a => a.start_date.startsWith(thisMonth))
  const monthRides   = thisMonthActs.filter(a => isType(a, RIDE_TYPES))
  const monthRuns    = thisMonthActs.filter(a => isType(a, RUN_TYPES))
  const monthSwims   = thisMonthActs.filter(a => isType(a, SWIM_TYPES))
  const monthWeights = thisMonthActs.filter(a => isType(a, WEIGHT_TYPES))

  const thisMonthData = {
    month: thisMonth,
    ride: {
      distance_km: sumDist(monthRides),
      elevation_m: sumElev(monthRides),
      count: monthRides.length,
    },
    run: {
      distance_km: sumDist(monthRuns),
      count: monthRuns.length,
    },
    swim: {
      distance_km: sumDist(monthSwims),
      count: monthSwims.length,
    },
    weight_training: {
      count: monthWeights.length,
    },
  }

  // 更新 monthly_history
  const history = existing.monthly_history || []
  const idx = history.findIndex(h => h.month === thisMonth)
  if (idx >= 0) history[idx] = thisMonthData
  else history.push(thisMonthData)
  history.sort((a, b) => a.month.localeCompare(b.month))

  // ── 最近各類型活動（各取最近 10 筆）──
  function mapActivity(a) {
    return {
      name:           a.name,
      date:           a.start_date.slice(0, 10),
      distance_km:    Math.round(a.distance / 10) / 100,
      moving_time_hr: Math.round(a.moving_time / 360) / 10,
      elevation_m:    Math.round(a.total_elevation_gain),
      avg_speed_kmh:  Math.round(a.average_speed * 36) / 10,
    }
  }

  const recentRides   = activities.filter(a => isType(a, RIDE_TYPES)).slice(0, 10).map(mapActivity)
  const recentRuns    = activities.filter(a => isType(a, RUN_TYPES)).slice(0, 10).map(mapActivity)
  const recentSwims   = activities.filter(a => isType(a, SWIM_TYPES)).slice(0, 10).map(mapActivity)
  const recentWeights = activities.filter(a => isType(a, WEIGHT_TYPES)).slice(0, 10).map(a => ({
    name: a.name,
    date: a.start_date.slice(0, 10),
    moving_time_hr: Math.round(a.moving_time / 360) / 10,
  }))

  return {
    updated_at: new Date().toISOString(),
    summary: {
      ytd_distance_km:      Math.round(s.ytd_ride_totals.distance / 10) / 100,
      ytd_elevation_m:      Math.round(s.ytd_ride_totals.elevation_gain),
      ytd_rides:            s.ytd_ride_totals.count,
      ytd_moving_time_hr:   Math.round(s.ytd_ride_totals.moving_time / 360) / 10,
      ytd_run_distance_km:  Math.round(s.ytd_run_totals.distance / 10) / 100,
      ytd_runs:             s.ytd_run_totals.count,
      ytd_swim_distance_km: Math.round((s.ytd_swim_totals?.distance || 0) / 10) / 100,
      ytd_swims:            s.ytd_swim_totals?.count || 0,
      all_time_distance_km: Math.round(s.all_ride_totals.distance / 10) / 100,
      all_time_rides:       s.all_ride_totals.count,
      all_time_elevation_m: Math.round(s.all_ride_totals.elevation_gain),
    },
    recent_rides:    recentRides,
    recent_runs:     recentRuns,
    recent_swims:    recentSwims,
    recent_weights:  recentWeights,
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
  console.log(`   單車 YTD：${result.summary.ytd_distance_km} km / ${result.summary.ytd_rides} rides`)
  console.log(`   跑步 YTD：${result.summary.ytd_run_distance_km} km / ${result.summary.ytd_runs} runs`)
  console.log(`   游泳 YTD：${result.summary.ytd_swim_distance_km} km / ${result.summary.ytd_swims} swims`)
}

main().catch(err => {
  console.error('❌ 錯誤：', err.message)
  process.exit(1)  // 非 0 exit code 讓 GitHub Actions 標記為失敗
})
