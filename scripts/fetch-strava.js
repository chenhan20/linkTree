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
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
        catch (e) { reject(new Error('JSON parse error: ' + Buffer.concat(chunks).toString('utf8'))) }
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

// ── Step 3：抓活動（FETCH_ALL=1 時分頁抓全部，否則只抓最近 100 筆）──
async function fetchRecentActivities(token) {
  const fetchAll = process.env.FETCH_ALL === '1'

  if (!fetchAll) {
    const data = await request({
      hostname: 'www.strava.com',
      path:     '/api/v3/athlete/activities?per_page=100&page=1',
      method:   'GET',
      headers:  { Authorization: `Bearer ${token}` },
    })
    if (!Array.isArray(data)) throw new Error('activities API 回傳非陣列：' + JSON.stringify(data))
    console.log(`✅ 最近活動抓取成功，共 ${data.length} 筆`)
    return data
  }

  // 全量模式：逐頁抓直到空
  console.log('🔄 FETCH_ALL 模式：分頁抓取所有活動...')
  let all = [], page = 1
  while (true) {
    const data = await request({
      hostname: 'www.strava.com',
      path:     `/api/v3/athlete/activities?per_page=200&page=${page}`,
      method:   'GET',
      headers:  { Authorization: `Bearer ${token}` },
    })
    if (!Array.isArray(data)) throw new Error('activities API 回傳非陣列：' + JSON.stringify(data))
    if (data.length === 0) break
    all = all.concat(data)
    console.log(`  第 ${page} 頁：${data.length} 筆，累計 ${all.length} 筆`)
    page++
    if (data.length < 200) break // 最後一頁
    await new Promise(r => setTimeout(r, 300)) // 避免打太快
  }
  console.log(`✅ 全量活動抓取完成，共 ${all.length} 筆`)
  return all
}

// ── Step 4a：抓單一活動詳情（用於取得 laps）──
async function fetchActivityDetail(token, activityId) {
  const data = await request({
    hostname: 'www.strava.com',
    path:     `/api/v3/activities/${activityId}`,
    method:   'GET',
    headers:  { Authorization: `Bearer ${token}` },
  })
  if (data.errors) throw new Error(`activity detail 錯誤：${JSON.stringify(data.errors)}`)
  return data
}

// ── 從 laps 陣列找主課段：moving_time > 5 分，取 avg_heartrate 最高的 ──
function extractMainLap(laps) {
  if (!Array.isArray(laps) || laps.length === 0) return null
  const candidates = laps.filter(l => (l.moving_time || 0) > 300) // 5 min+
  if (candidates.length === 0) return null
  // 優先心率最高；無心率則功率最高；再無則時間最長
  candidates.sort((a, b) => {
    if (a.average_heartrate && b.average_heartrate) return b.average_heartrate - a.average_heartrate
    if (a.average_watts && b.average_watts) return b.average_watts - a.average_watts
    return b.moving_time - a.moving_time
  })
  const lap = candidates[0]
  const totalMin = Math.round((lap.moving_time || 0) / 60)
  const h = Math.floor(totalMin / 60), m = totalMin % 60
  const moving_time_str = h > 0 ? (m > 0 ? `${h} 小時 ${m} 分` : `${h} 小時`) : `${m} 分`
  return {
    name:              lap.name || 'Main Lap',
    moving_time_str,
    average_heartrate: lap.average_heartrate ? Math.round(lap.average_heartrate) : null,
    average_watts:     lap.average_watts     ? Math.round(lap.average_watts)     : null,
  }
}

// ── Step 4b：Lap enrichment（ID-based 快取，避免重複打 API）──
async function enrichRideLaps(token, recentRides, existingRides) {
  // 從舊 JSON 建 id → main_lap 快取（null 也要快取，代表已試過無資料）
  const cache = {}
  for (const r of (existingRides || [])) {
    if (r.id != null) cache[String(r.id)] = r.main_lap ?? null
  }

  let fetchCount = 0
  for (const ride of recentRides) {
    if (ride.id == null) { ride.main_lap = null; continue }
    const key = String(ride.id)
    if (key in cache) {
      // 快取命中：直接沿用，不打 API
      ride.main_lap = cache[key]
      continue
    }
    // 新活動：打 detail API
    try {
      await new Promise(r => setTimeout(r, 350)) // 避免打太快
      const detail = await fetchActivityDetail(token, ride.id)
      ride.main_lap = extractMainLap(detail.laps)
      fetchCount++
      console.log(`  🔍 ${ride.name}：main_lap = ${ride.main_lap ? ride.main_lap.name + ' ❤️' + ride.main_lap.average_heartrate : '無'}`)
    } catch (e) {
      console.warn(`  ⚠️  Lap 抓取失敗 (id=${ride.id})：${e.message}`)
      ride.main_lap = null
    }
  }
  console.log(`✅ Lap enrichment 完成，新打 API ${fetchCount} 次（快取命中 ${recentRides.length - fetchCount} 次）`)
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

  // ── 計算 monthly_history（FETCH_ALL 時算全部月份，否則只算本月）──
  const fetchAll = process.env.FETCH_ALL === '1'
  // 用 start_date_local 切日（台灣時間區）
  const monthsToCalc = fetchAll
    ? [...new Set(activities.map(a => (a.start_date_local || a.start_date).slice(0, 7)))].sort()
    : [thisMonth]

  function calcMonthData(month) {
    const acts = activities.filter(a => (a.start_date_local || a.start_date).slice(0, 7) === month)
    const rides   = acts.filter(a => isType(a, RIDE_TYPES))
    const runs    = acts.filter(a => isType(a, RUN_TYPES))
    const swims   = acts.filter(a => isType(a, SWIM_TYPES))
    const weights = acts.filter(a => isType(a, WEIGHT_TYPES))
    return {
      month,
      ride:            { distance_km: sumDist(rides), elevation_m: sumElev(rides), count: rides.length },
      run:             { distance_km: sumDist(runs),  count: runs.length },
      swim:            { distance_km: sumDist(swims), count: swims.length },
      weight_training: { count: weights.length },
    }
  }

  // 更新 monthly_history：覆寫計算的月份，保留其他歷史
  const history = existing.monthly_history || []
  for (const month of monthsToCalc) {
    const data = calcMonthData(month)
    const idx = history.findIndex(h => h.month === month)
    if (idx >= 0) history[idx] = data
    else history.push(data)
  }
  history.sort((a, b) => a.month.localeCompare(b.month))

  // ── 最近各類型活動（各取最近 10 筆）──

  // 配速 min/km，格式 "M:SS"
  function fmtPaceKm(speed_ms) {
    if (!speed_ms || speed_ms <= 0) return null
    const secPerKm = 1000 / speed_ms
    const m = Math.floor(secPerKm / 60)
    const s = Math.round(secPerKm % 60)
    return `${m}:${String(s).padStart(2,'0')}`
  }

  // 游泳配速 /100m，格式 "M:SS"
  function fmtPace100m(distance_m, moving_time_s) {
    if (!distance_m || distance_m <= 0) return null
    const secPer100m = (moving_time_s / distance_m) * 100
    const m = Math.floor(secPer100m / 60)
    const s = Math.round(secPer100m % 60)
    return `${m}:${String(s).padStart(2,'0')}`
  }

  // 用 start_date_local 切日切時（台灣時間）
  function localDate(a) { return (a.start_date_local || a.start_date).slice(0, 10) }
  function localTime(a) { return (a.start_date_local || a.start_date).slice(11, 16) }

  const recentRides = activities.filter(a => isType(a, RIDE_TYPES)).slice(0, 10).map(a => ({
    id:             a.id,
    name:           a.name,
    date:           localDate(a),
    time:           localTime(a),
    distance_km:    Math.round(a.distance / 10) / 100,
    moving_time_hr: Math.round(a.moving_time / 360) / 10,
    elevation_m:    Math.round(a.total_elevation_gain),
    avg_speed_kmh:  Math.round(a.average_speed * 36) / 10,
    avg_heartrate:  a.average_heartrate ? Math.round(a.average_heartrate) : null,
    avg_watts:      a.average_watts     ? Math.round(a.average_watts)     : null,
  }))

  const recentRuns = activities.filter(a => isType(a, RUN_TYPES)).slice(0, 10).map(a => ({
    name:           a.name,
    date:           localDate(a),
    time:           localTime(a),
    distance_km:    Math.round(a.distance / 10) / 100,
    moving_time_hr: Math.round(a.moving_time / 360) / 10,
    elevation_m:    Math.round(a.total_elevation_gain),
    avg_pace_km:    fmtPaceKm(a.average_speed),
    avg_cadence_spm: a.average_cadence ? Math.round(a.average_cadence * 2) : null,
    avg_heartrate:  a.average_heartrate ? Math.round(a.average_heartrate) : null,
  }))

  const recentSwims = activities.filter(a => isType(a, SWIM_TYPES)).slice(0, 10).map(a => ({
    name:             a.name,
    date:             localDate(a),
    time:             localTime(a),
    distance_km:      Math.round(a.distance / 10) / 100,
    moving_time_hr:   Math.round(a.moving_time / 360) / 10,
    pace_per_100m:    fmtPace100m(a.distance, a.moving_time),
    avg_heartrate:    a.average_heartrate ? Math.round(a.average_heartrate) : null,
  }))

  const recentWeights = activities.filter(a => isType(a, WEIGHT_TYPES)).slice(0, 10).map(a => ({
    name:          a.name,
    date:          localDate(a),
    time:          localTime(a),
    moving_time_hr: Math.round(a.moving_time / 360) / 10,
    avg_heartrate: a.average_heartrate ? Math.round(a.average_heartrate) : null,
  }))

  // ── Monthly Summary / Goals & Weekly Quest（PRD v1：FR-1 / FR-2 / FR-3）──
  // 區間皆以 Asia/Taipei 為準；activity.start_date_local 已是 TPE 牆鐘時間字串
  function statusOf(count, target) {
    const ratio = target > 0 ? count / target : 0
    if (ratio >= 1.5) return 'over'
    if (ratio >= 1.0) return 'done'
    if (ratio >= 0.5) return 'warning'
    return 'danger'
  }

  // 取得 TPE 當下時間（用 UTC getters 讀出 TPE 牆鐘）
  const tpeNow = new Date(Date.now() + 8 * 3600 * 1000)
  const tpeYear  = tpeNow.getUTCFullYear()
  const tpeMonth = tpeNow.getUTCMonth()
  const tpeDate  = tpeNow.getUTCDate()
  const tpeDow   = tpeNow.getUTCDay() // 0=Sun..6=Sat

  // 本月開頭：YYYY-MM
  const monthPrefix = `${tpeYear}-${String(tpeMonth + 1).padStart(2, '0')}`

  // 本週一 00:00 (TPE) 的字串前綴 YYYY-MM-DD
  const daysFromMon = (tpeDow + 6) % 7 // Sun→6, Mon→0
  const mondayUtc = new Date(Date.UTC(tpeYear, tpeMonth, tpeDate - daysFromMon))
  const weekStartPrefix = `${mondayUtc.getUTCFullYear()}-${String(mondayUtc.getUTCMonth() + 1).padStart(2, '0')}-${String(mondayUtc.getUTCDate()).padStart(2, '0')}`

  function startLocal(a) { return (a.start_date_local || a.start_date) }
  function inThisMonth(a) { return startLocal(a).slice(0, 7) === monthPrefix }
  function inThisWeek(a)  { return startLocal(a).slice(0, 10) >= weekStartPrefix }

  const monthActs = activities.filter(inThisMonth)
  const monthRides   = monthActs.filter(a => isType(a, RIDE_TYPES))
  const monthRuns    = monthActs.filter(a => isType(a, RUN_TYPES))
  const monthSwims   = monthActs.filter(a => isType(a, SWIM_TYPES))
  const monthWeights = monthActs.filter(a => isType(a, WEIGHT_TYPES))

  const monthly_summary = {
    ride_km:      Math.round(monthRides.reduce((s, a) => s + (a.distance || 0), 0) / 10) / 100,
    run_km:       Math.round(monthRuns.reduce((s, a) => s + (a.distance || 0), 0) / 10) / 100,
    swim_m:       Math.round(monthSwims.reduce((s, a) => s + (a.distance || 0), 0)),
    weight_count: monthWeights.length,
  }

  const TARGET = 4
  const monthly_goals = {
    ride:   { count: monthRides.length,   target: TARGET, status: statusOf(monthRides.length,   TARGET) },
    run:    { count: monthRuns.length,    target: TARGET, status: statusOf(monthRuns.length,    TARGET) },
    swim:   { count: monthSwims.length,   target: TARGET, status: statusOf(monthSwims.length,   TARGET) },
    weight: { count: monthWeights.length, target: TARGET, status: statusOf(monthWeights.length, TARGET) },
  }

  const weekActs = activities.filter(inThisWeek)
  const weekly_quest = {
    ride:   weekActs.some(a => isType(a, RIDE_TYPES)),
    run:    weekActs.some(a => isType(a, RUN_TYPES)),
    swim:   weekActs.some(a => isType(a, SWIM_TYPES)),
    weight: weekActs.some(a => isType(a, WEIGHT_TYPES)),
  }

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
    monthly_summary,
    monthly_goals,
    weekly_quest,
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

  // 讀舊 JSON 供 lap 快取使用（buildJSON 內部也會讀，此處獨立讀取供 enrichRideLaps）
  let existingData = { recent_rides: [] }
  if (fs.existsSync(OUT_FILE)) {
    try { existingData = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')) }
    catch (e) { /* 讀失敗就當空 */ }
  }

  const result     = buildJSON(stats, activities)

  // ── Lap enrichment：只針對單車，ID-based 快取 ──
  await enrichRideLaps(token, result.recent_rides, existingData.recent_rides)

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
