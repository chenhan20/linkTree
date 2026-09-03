// fetch-strava.js
// 每天由 GitHub Actions 執行，抓 Strava 資料寫入 strava.json
// 本機測試：在 scripts/.env 填入憑證後執行 node scripts/fetch-strava.js
//
// 環境變數旗標：
//   FETCH_ALL=1       —— 分頁抓全部歷史活動（首次需要；之後預設只抓最近 100 筆即可）
//   SCAN_SEGMENTS=1   —— 對全史 ride 打 detail API，補抓 ITT segment efforts
//   SCAN_POWER=1      —— 以全史騎乘重建功率 PR（會自動走全量活動）
//   REFRESH_LAPS=1    —— 忽略 lap 快取重抓
//   LAP_FETCH_MAX=N   —— 單次執行最多打多少次 detail API 補 lap（預設 30）避免撞 Strava 限流
//   POWER_ONLY=1      —— 只做功率 PR 更新，跳過 laps/segments enrichment（省 read quota）
//   RESCAN_SEG_DAYS=N —— 無視快取重掃最近 N 天騎乘的 segment efforts。
//                        同一趟活動刷同一段多次（「劍 中 中 中 劍」）時要用它補齊，
//                        因為那些活動已被標記「掃過」，預設不會再打 detail API。
//
// 首次全量範例 (PowerShell)：
//   $env:FETCH_ALL="1"; $env:SCAN_SEGMENTS="1"; node scripts/fetch-strava.js

const fs = require('fs')
const path = require('path')
const https = require('https')

// ── 本機：自動讀取 scripts/.env（不裝 dotenv，純 fs 解析）──
const envFile = path.join(__dirname, '.env')
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split(/\r?\n/).forEach(line => {
    const trimmed = line.replace(/^\uFEFF/, '').trim()  // 去 BOM、去空白
    if (!trimmed || trimmed.startsWith('#')) return      // 跳過空行與註解
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx < 1) return
    const k = trimmed.slice(0, eqIdx).trim()
    const v = trimmed.slice(eqIdx + 1).trim()
    if (k && v && !process.env[k]) process.env[k] = v
  })
  console.log('📁 已從 scripts/.env 讀取設定（本機模式）')
}

// ── 從環境變數讀 secrets（GitHub Actions 會注入）──
const CLIENT_ID     = process.env.STRAVA_CLIENT_ID
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET
const REFRESH_TOKEN = process.env.STRAVA_REFRESH_TOKEN
const ATHLETE_ID    = process.env.STRAVA_ATHLETE_ID  // 你的 161539959

const OUT_FILE        = path.join(__dirname, '..', 'data', 'strava.json')
const ITT_FILE        = path.join(__dirname, '..', 'data', 'itt-segments.json')
const ITT_CONFIG_FILE = path.join(__dirname, '..', 'data', 'itt-config.json')
const POWER_FILE      = path.join(__dirname, '..', 'data', 'power-prs.json')
const ACTS_FILE       = path.join(__dirname, '..', 'data', 'fit', '_activities.json')
const EST_DIST_FILE   = path.join(__dirname, '..', 'data', 'fit', '_est_distance.json')

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
  // SCAN_POWER 需要全史活動，避免只掃到最近 100 筆導致 top3 不完整。
  const fetchAll = process.env.FETCH_ALL === '1' || process.env.SCAN_POWER === '1'

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

// ── ITT 區間設定 ──
// ── ITT 路段設定（從 data/itt-config.json 讀取，新增路段只改那個檔）──
const ittConfig = JSON.parse(fs.readFileSync(ITT_CONFIG_FILE, 'utf8'))
const SEGMENT_IDS = new Set(ittConfig.segments.map(s => s.id))
const SEGMENT_CUSTOM_NAMES = Object.fromEntries(
  ittConfig.segments.filter(s => s.nameApi).map(s => [s.id, s.nameApi])
)
console.log(`📋 ITT config 讀取成功：${ittConfig.segments.map(s => s.nameZh).join(' / ')}`)

// 秒 → "M:SS" 或 "H:MM:SS"
function fmtElapsed(seconds) {
  const s = Math.round(seconds)
  if (s < 3600) {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${String(sec).padStart(2, '0')}`
  }
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

// ── 單筆 segment effort → 內部格式 ─────────────────────────────────
// 一次活動可以刷同一段很多次（「劍 中中中中 劍」= 一趟裡四次中社），所以 effort
// 的身分不能是 activity_id。這裡用 activity_id + start_time 當自然鍵：
// 同一段不可能在同一分鐘內起跑兩次，所以它唯一，而且精確、看得懂。
//
// 刻意不存 Strava 的 segment_effort.id：新制 effort id 約 3.5e18，超過 JS 的
// Number.MAX_SAFE_INTEGER (9.0e15)，JSON.parse 當場就把尾數算掉了（會看到 ...656000
// 這種假尾巴）。存下去等於在公開資料裡放一個打 API 會 404 的假 ID。
function mapSegEffort(se, activityId, date) {
  const startLocal = se.start_date_local || se.start_date || ''
  return {
    activity_id:   activityId,
    date,
    start_time:    startLocal.length >= 16 ? startLocal.slice(11, 16) : null,
    elapsed_sec:   se.elapsed_time,
    elapsed_str:   fmtElapsed(se.elapsed_time),
    avg_watts:     se.average_watts     ? Math.round(se.average_watts)     : null,
    avg_heartrate: se.average_heartrate ? Math.round(se.average_heartrate) : null,
    pr_rank:       se.pr_rank           || null,
    // 來源標記。Strava 給的是它自己配對出來的官方成績，自建偵測器寫的是 'fit'。
    // 兩者混在同一個 efforts 陣列裡，前端要能分辨哪些是官方計時、哪些是我自己算的。
    source:        'strava',
  }
}

// effort 身分（精確鍵）：同一趟裡的第 n 次靠 start_time 分辨
const segEffortKey = e => `${e.activity_id}|${e.start_time}`
// 舊格式鍵：2026-08-11 之前寫入的紀錄沒有 start_time，重掃時要靠這個鍵認出
// 「同一筆」並就地補欄位，而不是變成重複列。
const segEffortLegacyKey = e => `${e.activity_id}|${e.elapsed_sec}`
// 日期降冪；同一天用開始時間排（沒有 start_time 的舊紀錄排在同日最後）
const segEffortSortKey = e => `${e.date} ${e.start_time || '00:00'}`

async function fetchSegmentInfo(token, segmentId) {
  const data = await request({
    hostname: 'www.strava.com',
    path:     `/api/v3/segments/${segmentId}`,
    method:   'GET',
    headers:  { Authorization: `Bearer ${token}` },
  })
  if (data.errors) throw new Error(`segment info 錯誤：${JSON.stringify(data.errors)}`)
  return data
}

// 嘗試抓 segment leaderboard（需 Summit；失敗時靜默忽略）
async function fetchSegmentLeaderboard(token, segmentId, athleteId) {
  try {
    const data = await request({
      hostname: 'www.strava.com',
      path:     `/api/v3/segments/${segmentId}/leaderboard?per_page=200`,
      method:   'GET',
      headers:  { Authorization: `Bearer ${token}` },
    })
    if (!data.entries) return null
    const entry = data.entries.find(e => String(e.athlete_id) === String(athleteId))
    return {
      entry_count: data.entry_count || null,
      rank:        entry ? entry.rank : null,
    }
  } catch (e) {
    return null
  }
}

// ── Step 4a：抓單一活動詳情（用於取得 laps）──
// include_all_efforts=true 是必要的，預設是 false。
// 不帶的時候 Strava 只回「重點」segment efforts（星號路段、PR、KOM），不是全部 ——
// 這很可能就是新增路段之後歷史成績配對不到的原因：段是新的，自然沒有 PR 也沒被星號，
// 於是整批被判為不重要而沒回傳。帶了之後回傳量會變大，但不多花任何一個請求。
async function fetchActivityDetail(token, activityId) {
  const data = await request({
    hostname: 'www.strava.com',
    path:     `/api/v3/activities/${activityId}?include_all_efforts=true`,
    method:   'GET',
    headers:  { Authorization: `Bearer ${token}` },
  })
  if (data.errors) throw new Error(`activity detail 錯誤：${JSON.stringify(data.errors)}`)
  return data
}

// ── 從 laps 陣列取所有合格分段：moving_time > 5 分 且 avg_watts ≥ 150W ──
function extractTopLaps(laps) {
  if (!Array.isArray(laps) || laps.length === 0) return []
  // 保留有功率且夠長的 lap，但維持原始 lap_index 順序
  const candidates = laps
    .filter(l => (l.average_watts || 0) >= 150)
    .sort((a, b) => (a.lap_index ?? 0) - (b.lap_index ?? 0))
  if (candidates.length === 0) return []
  return candidates.map(lap => {
    const totalMin = Math.round((lap.moving_time || 0) / 60)
    const h = Math.floor(totalMin / 60), m = totalMin % 60
    const moving_time_str = h > 0 ? (m > 0 ? `${h} 小時 ${m} 分` : `${h} 小時`) : `${m} 分`
    return {
      name:              lap.name || 'Lap',
      moving_time_str,
      average_heartrate: lap.average_heartrate ? Math.round(lap.average_heartrate) : null,
      average_watts:     lap.average_watts     ? Math.round(lap.average_watts)     : null,
    }
  })
}

// ────────────────────────────────────────────────────────────────
// ── Power PR：時段定義 ──
// ────────────────────────────────────────────────────────────────
const POWER_DURATIONS = [5, 10, 30, 60, 120, 300, 600, 1200, 3600]
const POWER_DURATION_LABELS = {
  5:    '5秒',
  10:   '10秒',
  30:   '30秒',
  60:   '1分',
  120:  '2分',
  300:  '5分',
  600:  '10分',
  1200: '20分',
  3600: '60分',
}

// 抓單筆活動的 watts stream
async function fetchWattsStream(token, activityId) {
  const data = await request({
    hostname: 'www.strava.com',
    path:     `/api/v3/activities/${activityId}/streams?keys=watts,time&key_by_type=true`,
    method:   'GET',
    headers:  { Authorization: `Bearer ${token}` },
  })
  return data
}

// 抓 GPS + 心率 + 速度 stream，降採樣至 ~120 點，回傳 [[lat,lng,hr,kmh], ...]
async function fetchRouteStream(token, activityId) {
  const data = await request({
    hostname: 'www.strava.com',
    path:     `/api/v3/activities/${activityId}/streams?keys=latlng,heartrate,velocity_smooth,altitude,watts,time&key_by_type=true`,
    method:   'GET',
    headers:  { Authorization: `Bearer ${token}` },
  })
  const latlng = data.latlng?.data   || []
  const hr     = data.heartrate?.data || []
  const vel    = data.velocity_smooth?.data || []
  const alt    = data.altitude?.data  || []
  const watts  = data.watts?.data     || []
  const n = latlng.length
  if (n < 2) return null
  const target = 120
  const step = n <= target ? 1 : (n - 1) / (target - 1)
  const indices = n <= target
    ? Array.from({ length: n }, (_, i) => i)
    : Array.from({ length: target }, (_, i) => Math.round(i * step))
  // 格式：[lat, lng, hr(bpm), speed(km/h), elev(m), watts] —— index 2 是心率不是高度
  return indices.map(i => [
    Math.round(latlng[i][0] * 1e5) / 1e5,
    Math.round(latlng[i][1] * 1e5) / 1e5,
    hr[i]    != null ? Math.round(hr[i])          : null,
    vel[i]   != null ? Math.round(vel[i] * 36) / 10 : null,
    alt[i]   != null ? Math.round(alt[i])         : null,
    watts[i] != null ? Math.round(watts[i])       : null,
  ])
}

// ── Route stream enrichment：為沒有 route_stream 的外騎補齊 ──
// SCAN_STREAMS=1 → 強制重抓；STREAM_FETCH_MAX=N（預設 8，日常省 quota）
async function enrichRouteStreams(token, rides, existingRides) {
  const scanStreams  = process.env.SCAN_STREAMS === '1'
  const maxFetch    = parseInt(process.env.STREAM_FETCH_MAX || (scanStreams ? '999' : '8'), 10)

  // 把舊有 route_stream 合併進來（避免重跑時洗掉）
  const oldStreamMap = new Map(
    (existingRides || []).filter(r => r.route_stream).map(r => [String(r.id), r.route_stream])
  )
  for (const ride of rides) {
    if (!ride.route_stream && oldStreamMap.has(String(ride.id))) {
      ride.route_stream = oldStreamMap.get(String(ride.id))
    }
  }

  // 舊快取欄位不足六欄（缺 elev 或 watts 欄位）視為待補，讓每日跑批逐步升級。
  // 用「欄位數」判斷而非值：沒功率計的騎乘 watts 全 null 但仍是六欄，不會重抓
  const needsFetch = r => !r.route_stream || (r.route_stream[0] || []).length < 6
  const todo = rides.filter(r =>
    r.polyline && !r.trainer && (scanStreams ? true : needsFetch(r))
  ).slice(0, maxFetch)

  if (todo.length === 0) {
    console.log('✅ Route stream：全部已有快取，跳過')
    return
  }
  console.log(`🛰  Route stream：待補 ${todo.length} 筆（上限 ${maxFetch}）`)

  let done = 0
  for (const ride of todo) {
    try {
      await new Promise(r => setTimeout(r, 380))
      const stream = await fetchRouteStream(token, ride.id)
      if (stream) {
        ride.route_stream = stream
        const hasHR  = stream.some(p => p[2] != null)
        const hasSpd = stream.some(p => p[3] != null)
        const hasAlt = stream.some(p => p[4] != null)
        const hasW   = stream.some(p => p[5] != null)
        console.log(`  🛰  ${ride.date} ${ride.name}：${stream.length} pts HR=${hasHR} spd=${hasSpd} alt=${hasAlt} watts=${hasW}`)
        done++
      } else {
        console.log(`  ⚠️  ${ride.name}：無 GPS stream`)
      }
    } catch (e) {
      console.warn(`  ⚠️  route stream 失敗 (${ride.id})：${e.message}`)
    }
  }
  console.log(`✅ Route stream 完成：${done} 筆新增`)
}

// 滑動視窗計算指定秒數的最高平均功率
function calcPeakPower(wattsArr, durationSec) {
  const n = wattsArr.length
  if (n < durationSec) return null
  let windowSum = 0
  for (let i = 0; i < durationSec; i++) windowSum += (wattsArr[i] ?? 0)
  let maxAvg = windowSum / durationSec
  for (let i = durationSec; i < n; i++) {
    windowSum += (wattsArr[i] ?? 0)
    windowSum -= (wattsArr[i - durationSec] ?? 0)
    const avg = windowSum / durationSec
    if (avg > maxAvg) maxAvg = avg
  }
  return Math.round(maxAvg)
}

// 以 30 秒滑動均值計算 Normalized Power（NP）。
function calcNormalizedPower(wattsArr) {
  const n = wattsArr.length
  if (n < 30) return null

  let sum30 = 0
  for (let i = 0; i < 30; i++) sum30 += (wattsArr[i] ?? 0)

  let sumFourth = 0
  let count = 0

  let avg30 = sum30 / 30
  sumFourth += Math.pow(avg30, 4)
  count++

  for (let i = 30; i < n; i++) {
    sum30 += (wattsArr[i] ?? 0)
    sum30 -= (wattsArr[i - 30] ?? 0)
    avg30 = sum30 / 30
    sumFourth += Math.pow(avg30, 4)
    count++
  }

  if (count === 0) return null
  return Math.round(Math.pow(sumFourth / count, 0.25))
}

// ── Power PR 更新：對新的有功率外騎打 streams，比對並更新 PR ──
// 開關：SCAN_POWER=1 才執行（預設跳過，日常 fetch 不多打 streams）
// SCAN_POWER=1 → 只掃未掃描過的；SCAN_POWER=1 + FETCH_ALL=1 → 忽略快取全掃
// POWER_FETCH_MAX=N → 單次上限（預設無限，SCAN_POWER 時不限）
async function updatePowerPRs(token, activities) {
  const RIDE_TYPES = ['Ride', 'VirtualRide', 'EBikeRide', 'MountainBikeRide']
  const forceRescan = process.env.SCAN_POWER === '1'  // 只有明確設 SCAN_POWER=1 才完整重掃
  const maxFetch    = parseInt(process.env.POWER_FETCH_MAX || '99999', 10)

  // 讀獨立的 power-prs.json
  let powerFile = { prs: [], scanned_ids: [], activity_metrics: {} }
  if (fs.existsSync(POWER_FILE) && !forceRescan) {
    try { powerFile = JSON.parse(fs.readFileSync(POWER_FILE, 'utf8')) } catch (e) {}
  }

  const activityMetrics = { ...(powerFile.activity_metrics || {}) }

  // 篩：外騎 + 有功率計
  const powerRides = activities.filter(a =>
    RIDE_TYPES.includes(a.type) &&
    a.device_watts === true &&
    !a.trainer
  )

  const scannedIds = new Set((powerFile.scanned_ids || []).map(String))
  const toScan     = powerRides.filter(a => !scannedIds.has(String(a.id)))
  console.log(`⚡ Power PR：有功率外騎 ${powerRides.length} 筆，待掃描 ${toScan.length} 筆`)

  if (toScan.length === 0) {
    console.log('   ✅ Power PR 快取完整，跳過掃描')
    return {
      prs: powerFile.prs || [],
      activityMetrics,
    }
  }

  // 現有 PR 表（以 duration_sec 為 key，維護前三名列表）
  const prs = {}
  for (const dur of POWER_DURATIONS) {
    const existing = (powerFile.prs || []).find(p => p.duration_sec === dur)
    if (existing && existing.top3 && existing.top3.length) {
      prs[dur] = { top3: existing.top3.map(t => ({ ...t })) }
    } else if (existing && existing.watts) {
      prs[dur] = { top3: [{ rank: 1, watts: existing.watts, activity_id: existing.activity_id, date: existing.date, activity_name: existing.activity_name }] }
    } else {
      prs[dur] = { top3: [] }
    }
  }

  let fetchCount = 0
  for (const act of toScan) {
    if (fetchCount >= maxFetch) break
    try {
      await new Promise(r => setTimeout(r, 350))
      const streams = await fetchWattsStream(token, act.id)
      fetchCount++

      const wattsArr = streams?.watts?.data
      if (!wattsArr) {
        activityMetrics[String(act.id)] = {
          np_watts: null,
          max_watts_stream: null,
        }
        scannedIds.add(String(act.id))
        continue
      }

      const npWatts = calcNormalizedPower(wattsArr)
      const maxWattsStream = wattsArr.length > 0 ? Math.round(Math.max(...wattsArr)) : null
      activityMetrics[String(act.id)] = {
        np_watts: npWatts,
        max_watts_stream: maxWattsStream,
      }

      const date = (act.start_date_local || act.start_date).slice(0, 10)
      let hasPR  = false
      for (const dur of POWER_DURATIONS) {
        const peak = calcPeakPower(wattsArr, dur)
        if (!peak) continue
        const list = prs[dur].top3
        const worst = list.length >= 3 ? list[list.length - 1].watts : 0
        if (list.length < 3 || peak > worst) {
          // 移除同一活動的舊紀錄（去重）
          const idx = list.findIndex(t => t.activity_id === act.id)
          if (idx !== -1) list.splice(idx, 1)
          list.push({ rank: 0, watts: peak, activity_id: act.id, date, activity_name: act.name })
          list.sort((a, b) => b.watts - a.watts)
          if (list.length > 3) list.pop()
          list.forEach((t, i) => { t.rank = i + 1 })
          hasPR = true
        }
      }
      scannedIds.add(String(act.id))
      if (hasPR) console.log(`  🏅 新前三！${act.name} (${date})`)
      else       process.stdout.write('.')
    } catch (e) {
      console.warn(`\n  ⚠️  Streams 失敗 (id=${act.id})：${e.message}`)
      scannedIds.add(String(act.id))
    }
  }
  if (fetchCount > 0) console.log(`\n✅ Power PR 掃描完成，打 API ${fetchCount} 次`)

  // 組成輸出格式（保留 #1 的扁平欄位供向後相容，同時加入 top3 陣列）
  const prsResult = POWER_DURATIONS.map(dur => {
    const list = prs[dur].top3
    const best = list[0] || {}
    return {
      duration_sec:   dur,
      duration_label: POWER_DURATION_LABELS[dur],
      watts:          best.watts || null,
      activity_id:    best.activity_id || null,
      date:           best.date || null,
      activity_name:  best.activity_name || null,
      top3:           list,
    }
  })

  // 寫回獨立的 power-prs.json
  fs.writeFileSync(POWER_FILE, JSON.stringify({
    updated_at:  new Date().toISOString(),
    prs:         prsResult,
    scanned_ids: [...scannedIds],
    activity_metrics: activityMetrics,
  }, null, 2), 'utf8')
  console.log(`✅ power-prs.json 寫入完成`)

  return {
    prs: prsResult,
    activityMetrics,
  }
}

// ── Step 4b：Lap enrichment（ID-based 快取，避免重複打 API）──
// LAP_FETCH_MAX：對沒有 cache 的 ride，最多打多少次 detail API（避免拉到全史時撞 Strava 限流）。
//   REFRESH_LAPS=1 會無視快取重新抓（仍受 LAP_FETCH_MAX 限制）
//   SCAN_SEGMENTS=1 會無視 seg_scan_ids 快取，重新抓 segment efforts
// 回傳 { newSegEfforts, segScanIds }：segScanIds 存回 strava.json 避免重複打 segment
async function enrichRideLaps(token, recentRides, existingRides, existingSegments, existingSegScanIds) {
  const LAP_FETCH_MAX = parseInt(process.env.LAP_FETCH_MAX || '30', 10)

  // 從舊 JSON 建 id → top_laps 快取
  const cache = {}
  // 從舊 JSON 建 id → description 快取
  const descCache = {}
  if (process.env.REFRESH_LAPS !== '1') {
    for (const r of (existingRides || [])) {
      if (r.id != null && Array.isArray(r.top_laps)) cache[String(r.id)] = r.top_laps
      if (r.id != null && r.description !== undefined) descCache[String(r.id)] = r.description
    }
  }

  // 已有 ITT effort 紀錄的 activity_id
  const knownActivityIds = new Set()
  for (const seg of (existingSegments || [])) {
    for (const e of (seg.efforts || [])) {
      if (e.activity_id) knownActivityIds.add(String(e.activity_id))
    }
  }

  // 已掃描過 segment 的 activity_id（即使結果是 0 effort 也記錄，避免重複打）
  const segScanIds = new Set(
    process.env.SCAN_SEGMENTS === '1'
      ? []  // SCAN_SEGMENTS=1 → 清除快取，重新掃
      : (existingSegScanIds || []).map(String)
  )

  // RESCAN_SEG_DAYS=N：無視兩層快取，強制重掃最近 N 天的騎乘。
  // 2026-08-11 之前的掃描用 activity_id 去重，同一趟活動裡的第 2..n 次 effort 被吃掉，
  // 所以補齊歷史必須能重掃「已經有 effort、也標記掃過」的活動。
  const RESCAN_SEG_DAYS = parseInt(process.env.RESCAN_SEG_DAYS || '0', 10)
  const rescanCutoff = RESCAN_SEG_DAYS > 0
    ? new Date(Date.now() + 8 * 3600 * 1000 - RESCAN_SEG_DAYS * 86400000).toISOString().slice(0, 10)
    : null
  if (rescanCutoff) console.log(`🔁 RESCAN_SEG_DAYS=${RESCAN_SEG_DAYS}：${rescanCutoff} 之後的騎乘一律重掃 segment efforts`)

  // 新收集的 segment efforts：{ [segId]: [...] }
  const newSegEfforts = {}

  let detailBudget = LAP_FETCH_MAX
  let fetchCount = 0
  for (const ride of recentRides) {
    if (ride.id == null) { ride.top_laps = []; continue }
    const key = String(ride.id)
    const needsLaps = !(key in cache)
    const needsDesc = !(key in descCache)
    // needsSegs：沒有 ITT effort 且沒被掃描過（或落在 RESCAN_SEG_DAYS 視窗內）
    const forceSegRescan = rescanCutoff != null && String(ride.date || '') >= rescanCutoff
    const needsSegs = forceSegRescan || (!knownActivityIds.has(key) && !segScanIds.has(key))

    if (!needsLaps && !needsSegs && !needsDesc) {
      ride.top_laps    = cache[key] || []
      ride.description = descCache[key] || null
      continue
    }
    if (detailBudget <= 0) {
      ride.top_laps    = cache[key] || []
      ride.description = descCache[key] || null
      continue
    }
    detailBudget--
    try {
      await new Promise(r => setTimeout(r, 350))
      const detail = await fetchActivityDetail(token, ride.id)
      fetchCount++

      if (needsLaps) {
        ride.top_laps = extractTopLaps(detail.laps)
        cache[key] = ride.top_laps
        console.log(`  🔍 ${ride.name}：${ride.top_laps.length} 分段合格`)
      } else {
        ride.top_laps = cache[key] || []
      }
      ride.description = detail.description || null
      descCache[key]   = ride.description

      // 從 segment_efforts 提取目標分段
      if (needsSegs) {
        segScanIds.add(key)  // 無論有無 ITT 都記錄「已掃描」
        if (Array.isArray(detail.segment_efforts)) {
          let hitCount = 0
          for (const se of detail.segment_efforts) {
            if (se.segment && SEGMENT_IDS.has(se.segment.id)) {
              const sid = se.segment.id
              if (!newSegEfforts[sid]) newSegEfforts[sid] = []
              newSegEfforts[sid].push(mapSegEffort(se, ride.id, ride.date))
              hitCount++
            }
          }
          if (hitCount > 1) console.log(`  🔁 ${ride.name}：同一趟命中 ${hitCount} 段 ITT effort`)
        }
      }
    } catch (e) {
      console.warn(`  ⚠️  Detail 抓取失敗 (id=${ride.id})：${e.message}`)
      ride.top_laps    = cache[key] || []
      ride.description = descCache[key] || null
    }
  }
  console.log(`✅ Detail enrichment 完成，新打 API ${fetchCount} 次（快取命中 ${recentRides.length - fetchCount} 次）`)
  return { newSegEfforts, segScanIds: [...segScanIds] }
}

// ── Segment 資料合併＋PR 標記 ──
async function buildSegmentsData(token, newSegEfforts, existingSegments) {
  const result = []
  for (const segId of SEGMENT_IDS) {
    // 取舊有資料（或建空殼）
    const existing = (existingSegments || []).find(s => s.id === segId)
      || { id: segId, name: `Segment ${segId}`, distance_km: null, efforts: [] }

    // 更新 segment info（距離、KOM、leaderboard）
    try {
      await new Promise(r => setTimeout(r, 300))
      const info = await fetchSegmentInfo(token, segId)
      existing.distance_km      = info.distance            ? Math.round(info.distance / 10) / 100     : existing.distance_km
      existing.athlete_count     = info.athlete_count       || existing.athlete_count     || null
      existing.effort_count      = info.effort_count        || existing.effort_count      || null
      existing.elevation_gain_m  = info.total_elevation_gain != null ? Math.round(info.total_elevation_gain)    : existing.elevation_gain_m
      existing.average_grade     = info.average_grade        != null ? +info.average_grade.toFixed(1)           : existing.average_grade
      // KOM time → parse to seconds
      const komStr = info.xoms && (info.xoms.kom || info.xoms.overall)
      if (komStr && /^\d/.test(komStr)) {
        existing.kom_time_str = komStr
        const parts = komStr.split(':').map(Number)
        existing.kom_elapsed_sec = parts.length === 3
          ? parts[0]*3600 + parts[1]*60 + parts[2]
          : parts[0]*60  + (parts[1] || 0)
      }
    } catch (e) {
      console.warn(`⚠️  Segment info ${segId} 失敗：${e.message}`)
    }
    // leaderboard（Summit 限制時會靜默失敗）
    try {
      await new Promise(r => setTimeout(r, 300))
      const board = await fetchSegmentLeaderboard(token, segId, ATHLETE_ID)
      if (board) {
        if (board.entry_count) existing.leaderboard_total = board.entry_count
        if (board.rank)        existing.pr_rank           = board.rank
      }
    } catch (e) { /* Summit 限制，跳過 */ }
    // 永遠套用自訂名稱
    existing.name = SEGMENT_CUSTOM_NAMES[segId] || existing.name

    // ── 合併新 efforts ──
    // 去重鍵是 activity_id + start_time（同一趟刷四次中社 = 四個不同起跑時間），
    // 不是 activity_id —— 用 activity_id 去重會吃掉同一趟裡的第 2..n 次。
    // 舊紀錄沒有 start_time，用 activity_id|elapsed_sec 認出同一筆並就地補欄位，
    // 這樣重掃既有活動只會「升級」原本那筆，不會把它變成兩列。
    const existingEfforts = existing.efforts || []
    const byKey    = new Map()
    const byLegacy = new Map()
    for (const e of existingEfforts) {
      if (e.start_time) byKey.set(segEffortKey(e), e)
      if (!byLegacy.has(segEffortLegacyKey(e))) byLegacy.set(segEffortLegacyKey(e), e)
    }
    let added = 0
    for (const e of (newSegEfforts[segId] || [])) {
      const hit = e.start_time ? byKey.get(segEffortKey(e)) : null
      if (hit) { Object.assign(hit, e); continue }
      const legacy = byLegacy.get(segEffortLegacyKey(e))
      if (legacy && !legacy.start_time) {
        Object.assign(legacy, e)                 // 舊紀錄升級：補上 start_time
        if (legacy.start_time) byKey.set(segEffortKey(legacy), legacy)
        continue
      }
      existingEfforts.push(e)
      added++
      if (e.start_time) byKey.set(segEffortKey(e), e)
      if (!byLegacy.has(segEffortLegacyKey(e))) byLegacy.set(segEffortLegacyKey(e), e)
    }

    // 日期降冪；同一天照開始時間由晚到早
    existingEfforts.sort((a, b) => segEffortSortKey(b).localeCompare(segEffortSortKey(a)))

    // PR 標記：同秒數並列時只標最早達成的那一筆，避免出現兩頂皇冠
    const prTime = existingEfforts.length > 0
      ? Math.min(...existingEfforts.map(e => e.elapsed_sec))
      : null
    const prHolder = prTime === null ? null : existingEfforts
      .filter(e => e.elapsed_sec === prTime)
      .sort((a, b) => segEffortSortKey(a).localeCompare(segEffortSortKey(b)))[0]

    const efforts = existingEfforts.map(e => ({ ...e, is_pr: e === prHolder }))

    result.push({
      id:               segId,
      name:             existing.name,
      distance_km:      existing.distance_km,
      pr_time_str:      prTime ? fmtElapsed(prTime) : null,
      athlete_count:    existing.athlete_count    || null,
      effort_count:     existing.effort_count     || null,
      leaderboard_total:existing.leaderboard_total|| null,
      pr_rank:          existing.pr_rank          || null,
      kom_time_str:     existing.kom_time_str     || null,
      kom_elapsed_sec:  existing.kom_elapsed_sec  || null,
      efforts,
    })
    console.log(`✅ Segment ${segId} (${existing.name})：共 ${efforts.length} 次${added ? `（新增 ${added}）` : ''}`)
  }
  return result
}

// ── 全史 segment 掃描（SCAN_SEGMENTS=1 時使用）──
// 走全部騎乘 activities，對每筆未掃描過的 ride 打 detail API，提取 segment efforts
async function scanSegmentsHistory(token, activities, existingSegments) {
  const RIDE_TYPES = ['Ride', 'VirtualRide', 'EBikeRide', 'MountainBikeRide']
  const allRides   = activities.filter(a => RIDE_TYPES.includes(a.type))

  // 已知的 activity_id（三個 segment 合計）
  const knownActivityIds = new Set()
  for (const seg of (existingSegments || [])) {
    for (const e of (seg.efforts || [])) {
      if (e.activity_id) knownActivityIds.add(String(e.activity_id))
    }
  }

  // 已有 effort 的活動預設跳過，但 RESCAN_SEG_DAYS 視窗內的一律重掃 ——
  // 舊資料每趟活動最多只留一筆 effort，不重掃就補不回同一趟裡的第 2..n 次。
  const RESCAN_SEG_DAYS = parseInt(process.env.RESCAN_SEG_DAYS || '0', 10)
  const rescanCutoff = RESCAN_SEG_DAYS > 0
    ? new Date(Date.now() + 8 * 3600 * 1000 - RESCAN_SEG_DAYS * 86400000).toISOString().slice(0, 10)
    : null
  const unknownRides = allRides.filter(a => {
    const date = (a.start_date_local || a.start_date || '').slice(0, 10)
    if (rescanCutoff && date >= rescanCutoff) return true
    return !knownActivityIds.has(String(a.id))
  })
  console.log(`🔍 SCAN_SEGMENTS：全史 ${allRides.length} 筆騎乘，待掃描 ${unknownRides.length} 筆`)

  const newSegEfforts = {}
  let done = 0
  for (const a of unknownRides) {
    try {
      await new Promise(r => setTimeout(r, 400))
      const detail = await fetchActivityDetail(token, a.id)
      const date = (a.start_date_local || a.start_date).slice(0, 10)
      if (Array.isArray(detail.segment_efforts)) {
        for (const se of detail.segment_efforts) {
          if (se.segment && SEGMENT_IDS.has(se.segment.id)) {
            const sid = se.segment.id
            if (!newSegEfforts[sid]) newSegEfforts[sid] = []
            newSegEfforts[sid].push(mapSegEffort(se, a.id, date))
          }
        }
      }
      done++
      if (done % 20 === 0) console.log(`  進度：${done}/${unknownRides.length}`)
    } catch (e) {
      console.warn(`  ⚠️  掃描失敗 (id=${a.id})：${e.message}`)
    }
  }

  // 統計命中
  let hits = 0
  for (const sid of SEGMENT_IDS) hits += (newSegEfforts[sid] || []).length
  console.log(`✅ 全史掃描完成：命中 ${hits} 次 segment efforts`)
  return newSegEfforts
}


// ── 室內重複紀錄：同一趟被手錶與 Rouvy 各推一次到 Strava ────────────────
//
// 室內一堂課在 Strava 會留下兩筆：手錶錄的（曲柄功率，資料管線的正主）與
// Rouvy 自己推的。兩筆都收會讓月時數、月距離、趟數全部灌水 —— 實測 2026-08
// 帳面 17.7 h、去重後 14.4 h，而 eFTP 損益線是 15.3 h，結論從「已過線」
// 翻成「還差 0.9 h」。這個數字是他這半年最重要的單一指標，不能錯。
//
// 規則刻意不是「一律信手錶」：2026-08-19 手錶只錄到 3 分鐘、Rouvy 那份才是
// 完整的 36 分鐘 —— 兩邊都可能是漏錄的那一方。改成把同一天的室內活動分成
// 手錶堆與 Rouvy 堆，**只留移動時間比較長的那一堆**。
//
// 這裡砍在最上游（剛從 API 拿到活動就砍），所以 monthly_history、recent_rides、
// 功率 PR、路線串流全部一次乾淨，不必每個消費端各自去重。
// Strava 訂閱到期後只剩手錶那一份，這支會自然退化成原樣通過。
function dropDuplicateIndoor(list, acc) {
  // 只看騎乘。重訓在 Strava 也可能帶 trainer=true，不限定型別的話會被算進
  // 「手錶那一堆」，於是拿重訓的時數去跟 Rouvy 比長短，砍錯邊。實測撞過：
  // 8/19 的 56 分鐘重訓讓手錶堆從 0.05 h 變成 0.99 h。
  const isRide = a => !acc.rideType || acc.rideType(a)
  const isRouvy = a => String(acc.name(a) || '').toUpperCase().startsWith('ROUVY')
  const isIndoor = a => isRide(a) && (acc.trainer(a) === true || acc.virtual(a) || isRouvy(a))
  const byDay = new Map()
  for (const a of list) {
    if (!isIndoor(a)) continue
    const d = (acc.date(a) || '').slice(0, 10)
    if (!d) continue
    if (!byDay.has(d)) byDay.set(d, { watch: [], rouvy: [] })
    byDay.get(d)[isRouvy(a) ? 'rouvy' : 'watch'].push(a)
  }
  const drop = new Set()
  let droppedSec = 0
  for (const [d, g] of byDay) {
    if (!g.watch.length || !g.rouvy.length) continue      // 只有一邊就沒有重複
    const sec = arr => arr.reduce((n, a) => n + (acc.secs(a) || 0), 0)
    const keepWatch = sec(g.watch) >= sec(g.rouvy)
    const loser = keepWatch ? g.rouvy : g.watch
    const winner = keepWatch ? g.watch : g.rouvy
    for (const a of loser) drop.add(a)
    droppedSec += sec(loser)
    // 距離要從被砍的那份接過來。手錶室內錄不到距離（訓練台沒配成速度來源，
    // 曲柄功率計只廣播功率與迴轉，逐秒 distance 全是 0），而 Rouvy 那份有
    // 虛擬路線的真實里程。時數用手錶的、距離用 Rouvy 的，才是這一趟的全貌。
    // 砍掉不接的話里程會憑空消失 —— 8 月會少掉 108 km。
    let grafted = 0
    if (keepWatch && acc.dist && acc.setDist) {
      const km = g.rouvy.reduce((n, a) => n + (acc.dist(a) || 0), 0)
      const cur = winner.reduce((n, a) => n + (acc.dist(a) || 0), 0)
      if (km > 0 && cur === 0 && winner.length) { acc.setDist(winner[0], km); grafted = km }
    }
    console.log(`   🧹 ${d} 室內重複：砍掉 ${keepWatch ? 'Rouvy' : '手錶'} 那份 `
      + `${(sec(loser) / 3600).toFixed(2)} h（留下 ${(Math.max(sec(g.watch), sec(g.rouvy)) / 3600).toFixed(2)} h）`
      + (grafted ? `，里程 ${grafted.toFixed(1)} km 從 Rouvy 接過來` : ''))
  }
  if (drop.size) {
    console.log(`✅ 室內去重：砍掉 ${drop.size} 筆、合計 ${(droppedSec / 3600).toFixed(1)} 小時`)
  }
  // 把砍掉的東西記下來：summary 的 YTD 是 Strava 自己的 stats API 算的，
  // 它照樣把兩筆都算進去，我們這邊砍了它不會知道。要手動扣掉才會跟
  // monthly_history 對得起來（不扣的話儀表板會出現「62 趟 vs 59 趟」兩個數字）。
  // 依呼叫端分開記：YTD 要對的是「Strava 自己那份原始清單裡有幾筆重複」，
  // 也就是 raw 這一趟。合併後那一趟通常是 0（上游已經砍過了），拿它去扣會扣不到。
  dropDuplicateIndoor.dropped = dropDuplicateIndoor.dropped || {}
  dropDuplicateIndoor.dropped[acc.tag || 'unknown'] = {
    count: drop.size,
    hours: droppedSec / 3600,
    byYear: [...drop].reduce((m, a) => {
      const y = (acc.date(a) || '').slice(0, 4)
      m[y] = m[y] || { count: 0, sec: 0 }
      m[y].count += 1
      m[y].sec += acc.secs(a) || 0
      return m
    }, {}),
  }
  return list.filter(a => !drop.has(a))
}

const RIDE_TYPE_NAMES = ['Ride', 'VirtualRide', 'EBikeRide', 'MountainBikeRide']
const RAW_ACC = {
  tag: 'raw',
  name: a => a.name,
  date: a => a.start_date_local || a.start_date,
  secs: a => a.moving_time,
  trainer: a => a.trainer,
  virtual: a => a.sport_type === 'VirtualRide' || a.type === 'VirtualRide',
  rideType: a => RIDE_TYPE_NAMES.includes(a.type) || RIDE_TYPE_NAMES.includes(a.sport_type),
  dist: a => (a.distance || 0) / 1000,
  setDist: (a, km) => { a.distance = km * 1000; a.distance_from_rouvy = true },
}
const RIDE_ACC = {
  tag: 'ride',
  name: a => a.name,
  date: a => a.date,
  secs: a => a.moving_time_sec,
  trainer: a => a.trainer,
  virtual: a => a.sport_type === 'VirtualRide' || a.type === 'VirtualRide',
  dist: a => a.distance_km || 0,
  setDist: (a, km) => { a.distance_km = Math.round(km * 100) / 100; a.distance_from_rouvy = true },
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

  // ── 讀取 FTP（用於 IF / TSS 計算）──
  let FTP = 238  // 預設值
  try {
    const athleteFile = path.join(__dirname, '../athlete/gpt_教練前提資訊.json')
    FTP = JSON.parse(fs.readFileSync(athleteFile, 'utf8')).cycling.ftp_watts.latest || 238
  } catch (e) { console.warn('⚠️  無法讀取 FTP，使用預設 238W') }

  // Use Asia/Taipei month boundary so month rollover is correct for local usage.
  const tpeNowForMonth = new Date(Date.now() + 8 * 3600 * 1000)
  const thisMonth = `${tpeNowForMonth.getUTCFullYear()}-${String(tpeNowForMonth.getUTCMonth() + 1).padStart(2, '0')}`

  // ── 判斷運動類型 ──
  const RIDE_TYPES   = ['Ride', 'VirtualRide', 'EBikeRide', 'MountainBikeRide']
  const RUN_TYPES    = ['Run', 'VirtualRun', 'TrailRun']
  const SWIM_TYPES   = ['Swim']
  const WEIGHT_TYPES = ['WeightTraining', 'Workout', 'CrossFit', 'Yoga', 'Pilates']

  function isType(a, types) { return types.includes(a.type) }
  function sumDist(arr) { return Math.round(arr.reduce((s, a) => s + a.distance, 0) / 100) / 10 }
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

  // 保留所有活動（不再 slice），並都帶上 id 以便 UI 顯示「前往 Strava」連結
  const recentRides = activities.filter(a => isType(a, RIDE_TYPES)).map(a => {
    const w  = a.average_watts || 0
    // NP proxy：優先使用 weighted_average_watts（Garmin/Strava 已做加權平均，比 avg_watts 接近真實 NP）
    // 注意：weighted_average_watts 仍略低於真實 NP（本例 201 vs Garmin 211），是可接受的近似。
    const np = (a.device_watts && a.weighted_average_watts) ? a.weighted_average_watts : w
    const t  = a.moving_time   || 0
    const ifScore = (np > 0 && FTP > 0) ? +(np / FTP).toFixed(3) : null
    const tss     = (np > 0 && t > 0 && FTP > 0) ? Math.round((t * np * (np / FTP)) / (FTP * 3600) * 100) : null
    return {
      id:             a.id,
      name:           a.name,
      date:           localDate(a),
      time:           localTime(a),
      distance_km:    Math.round(a.distance / 10) / 100,
      moving_time_sec: a.moving_time || 0,
      moving_time_hr: Math.round(a.moving_time / 360) / 10,
      elevation_m:    Math.round(a.total_elevation_gain),
      avg_speed_kmh:  Math.round(a.average_speed * 36) / 10,
      avg_cadence_rpm: a.average_cadence ? Math.round(a.average_cadence) : null,
      avg_heartrate:  a.average_heartrate ? Math.round(a.average_heartrate) : null,
      max_heartrate:  a.max_heartrate ? Math.round(a.max_heartrate) : null,
      avg_watts:      w > 0 ? Math.round(w) : null,
      max_watts:      a.max_watts ? Math.round(a.max_watts) : null,
      np_watts:       np > 0 ? Math.round(np) : null,
      trainer:        a.trainer || false,
      // 室內去重時把 Rouvy 那份的里程接過來的話，這裡留個記號，
      // 免得半年後看到「室內 56 km」不知道那個數字打哪來。
      ...(a.distance_from_rouvy ? { distance_from_rouvy: true } : {}),
      sport_type:     a.type,
      if_score:       ifScore,
      tss:            tss,
      calories_kcal:  a.calories ? Math.round(a.calories) : null,
      description:    a.description || null,  // 由 enrichRideLaps 可再補全
      polyline:       (a.map && a.map.summary_polyline) ? a.map.summary_polyline : null,
    }
  })

  const recentRuns = activities.filter(a => isType(a, RUN_TYPES)).map(a => ({
    id:             a.id,
    name:           a.name,
    date:           localDate(a),
    time:           localTime(a),
    distance_km:    Math.round(a.distance / 10) / 100,
    moving_time_sec: a.moving_time || 0,
    moving_time_hr: Math.round(a.moving_time / 360) / 10,
    elevation_m:    Math.round(a.total_elevation_gain),
    avg_speed_kmh:  Math.round(a.average_speed * 36) / 10,
    max_speed_kmh:  a.max_speed ? Math.round(a.max_speed * 36) / 10 : null,
    avg_pace_km:    fmtPaceKm(a.average_speed),
    avg_cadence_spm: a.average_cadence ? Math.round(a.average_cadence * 2) : null,
    avg_heartrate:  a.average_heartrate ? Math.round(a.average_heartrate) : null,
    max_heartrate:  a.max_heartrate ? Math.round(a.max_heartrate) : null,
    calories_kcal:  a.calories ? Math.round(a.calories) : null,
    description:    a.description || null,
    polyline:       (a.map && a.map.summary_polyline) ? a.map.summary_polyline : null,
  }))

  const recentSwims = activities.filter(a => isType(a, SWIM_TYPES)).map(a => ({
    id:               a.id,
    name:             a.name,
    date:             localDate(a),
    time:             localTime(a),
    distance_km:      Math.round(a.distance / 10) / 100,
    moving_time_sec:   a.moving_time || 0,
    moving_time_hr:   Math.round(a.moving_time / 360) / 10,
    avg_speed_kmh:    Math.round(a.average_speed * 36) / 10,
    pace_per_100m:    fmtPace100m(a.distance, a.moving_time),
    avg_heartrate:    a.average_heartrate ? Math.round(a.average_heartrate) : null,
    max_heartrate:    a.max_heartrate ? Math.round(a.max_heartrate) : null,
    calories_kcal:    a.calories ? Math.round(a.calories) : null,
    description:      a.description || null,
    polyline:         (a.map && a.map.summary_polyline) ? a.map.summary_polyline : null,
  }))

  const recentWeights = activities.filter(a => isType(a, WEIGHT_TYPES)).map(a => ({
    id:            a.id,
    name:          a.name,
    date:          localDate(a),
    time:          localTime(a),
    moving_time_hr: Math.round(a.moving_time / 360) / 10,
    avg_heartrate: a.average_heartrate ? Math.round(a.average_heartrate) : null,
    max_heartrate: a.max_heartrate ? Math.round(a.max_heartrate) : null,
    description:   a.description || null,
  }))

  // 非 FETCH_ALL 模式下，保留既有歷史活動，避免每次被最近 100 筆覆蓋。
  function mergeActivityLists(newList, oldList) {
    const byId = new Map()
    for (const a of (oldList || [])) {
      if (!a || a.id == null) continue
      byId.set(String(a.id), a)
    }
    for (const a of (newList || [])) {
      if (!a || a.id == null) continue
      const key = String(a.id)
      const prev = byId.get(key)
      byId.set(key, prev ? { ...prev, ...a } : a)
    }
    return [...byId.values()].sort((a, b) => {
      const dc = (b.date || '').localeCompare(a.date || '')
      if (dc !== 0) return dc
      return (b.time || '').localeCompare(a.time || '')
    })
  }

  // 合併之後再過一次：上游只管這次抓到的，舊 JSON 裡早就存下來的重複筆
  // （8/19、8/20、8/25 的 Rouvy 那份）要在這裡才砍得掉。
  const mergedRecentRides = dropDuplicateIndoor(fetchAll
    ? recentRides
    : mergeActivityLists(recentRides, existing.recent_rides), RIDE_ACC)
  const mergedRecentRuns = fetchAll
    ? recentRuns
    : mergeActivityLists(recentRuns, existing.recent_runs)
  const mergedRecentSwims = fetchAll
    ? recentSwims
    : mergeActivityLists(recentSwims, existing.recent_swims)
  const mergedRecentWeights = fetchAll
    ? recentWeights
    : mergeActivityLists(recentWeights, existing.recent_weights)

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
    ride_km:      Math.round(monthRides.reduce((s, a) => s + (a.distance || 0), 0) / 100) / 10,
    ride_hr:      Math.round(monthRides.reduce((s, a) => s + (a.moving_time || 0), 0) / 360) / 10,
    run_km:       Math.round(monthRuns.reduce((s, a) => s + (a.distance || 0), 0) / 100) / 10,
    run_hr:       Math.round(monthRuns.reduce((s, a) => s + (a.moving_time || 0), 0) / 360) / 10,
    swim_m:       Math.round(monthSwims.reduce((s, a) => s + (a.distance || 0), 0)),
    swim_hr:      Math.round(monthSwims.reduce((s, a) => s + (a.moving_time || 0), 0) / 360) / 10,
    weight_count: monthWeights.length,
    weight_hr:    Math.round(monthWeights.reduce((s, a) => s + (a.moving_time || 0), 0) / 360) / 10,
  }

  const TARGET = 4
  const TARGET_WEIGHT = 10
  const monthly_goals = {
    ride:   { count: monthRides.length,   target: TARGET,        status: statusOf(monthRides.length,   TARGET)        },
    run:    { count: monthRuns.length,    target: TARGET,        status: statusOf(monthRuns.length,    TARGET)        },
    swim:   { count: monthSwims.length,   target: TARGET,        status: statusOf(monthSwims.length,   TARGET)        },
    weight: { count: monthWeights.length, target: TARGET_WEIGHT, status: statusOf(monthWeights.length, TARGET_WEIGHT) },
  }

  const weekActs    = activities.filter(inThisWeek)
  const weekRides   = weekActs.filter(a => isType(a, RIDE_TYPES))
  const weekRuns    = weekActs.filter(a => isType(a, RUN_TYPES))
  const weekSwims   = weekActs.filter(a => isType(a, SWIM_TYPES))
  const weekWeights = weekActs.filter(a => isType(a, WEIGHT_TYPES))

  function detectTrainPartsFromActivities(weightActs) {
    const text = (weightActs || [])
      .map(a => (a && a.name ? String(a.name) : ''))
      .join(' ')
      .toLowerCase()
    return {
      chest: text.includes('胸') || text.includes('chest'),
      back: text.includes('背') || text.includes('back'),
      legs: text.includes('腿') || text.includes('leg') || text.includes('legs'),
      shoulders: text.includes('肩') || text.includes('shoulder') || text.includes('shoulders'),
      arms: text.includes('手') || text.includes('arm') || text.includes('arms') || text.includes('三頭') || text.includes('二頭'),
    }
  }

  const wRideDist = Math.round(weekRides.reduce((s, a) => s + (a.distance || 0), 0) / 100) / 10
  const wRideHr   = Math.round(weekRides.reduce((s, a) => s + (a.moving_time || 0), 0) / 360) / 10
  const wRunDist  = Math.round(weekRuns.reduce((s, a)  => s + (a.distance || 0), 0) / 100) / 10
  const wRunHr    = Math.round(weekRuns.reduce((s, a)  => s + (a.moving_time || 0), 0) / 360) / 10
  const wSwimM    = Math.round(weekSwims.reduce((s, a) => s + (a.distance || 0), 0))
  const wSwimHr   = Math.round(weekSwims.reduce((s, a) => s + (a.moving_time || 0), 0) / 360) / 10
  const wWeightCt = weekWeights.length
  const wWeightParts = detectTrainPartsFromActivities(weekWeights)

  const weekly_quest = {
    ride:   { done: wRideDist >= 30 || wRideHr >= 1, distance_km: wRideDist, moving_time_hr: wRideHr, target_km: 30, target_hr: 1 },
    run:    { done: wRunDist >= 10  || wRunHr >= 1,  distance_km: wRunDist,  moving_time_hr: wRunHr,  target_km: 10, target_hr: 1 },
    swim:   { done: wSwimM >= 1000 || wSwimHr >= 1,  distance_m: wSwimM,     moving_time_hr: wSwimHr, target_m: 1000, target_hr: 1 },
    weight: { done: wWeightCt >= 1,                   count: wWeightCt,      target: 1, parts: wWeightParts },
  }

  // YTD 來自 Strava 自己的 stats API，它把室內的兩筆都算進去。我們上游砍掉了
  // 幾筆，這裡要照樣扣掉，否則同一個儀表板會出現「YTD 62 趟」與
  // 「monthly_history 加總 59 趟」兩個互相矛盾的數字。距離不扣：手錶那份室內
  // 是 0 km，Rouvy 的里程已經接到留下來的那筆上，總距離本來就沒變。
  const thisYear = String(new Date(Date.now() + 8 * 3600 * 1000).getUTCFullYear())
  const dropY = (((dropDuplicateIndoor.dropped || {}).raw || {}).byYear || {})[thisYear]
                || { count: 0, sec: 0 }
  if (dropY.count) {
    console.log(`   ↩︎ YTD 扣掉 ${dropY.count} 趟、${(dropY.sec / 3600).toFixed(1)} h 的室內重複`)
  }

  // ── 只活在 intervals、Strava 上沒有的室內趟 ────────────────────────────
  // 室內一趟可能只留在手錶那條路（Rouvy 那份被手動刪掉、或 Strava 根本沒收到）。
  // YTD 走 Strava 自己的 stats API，這種趟對它來說不存在，於是整趟從年度統計
  // 消失 —— 而它明明是真的訓練，FIT 也在 data/fit 裡。
  //
  // 里程用 scripts/estimate-indoor-distance.py 估的等效平路距離，**不是** Rouvy
  // 的虛擬里程：Rouvy 的距離是虛擬路線的口徑，跟他的戶外不是同一把尺（8/25
  // Rouvy 說 56.69 km、估算是 51.15）。詳見那支腳本的檔頭。
  //
  // 判定「Strava 沒有」＝當天沒有任何一筆騎乘的移動時間落在 ±5 分內。用時間而
  // 不只是日期，才不會被同一天的戶外趟蓋掉。Strava 停掉之後這段會自動接管，
  // 不需要再改。
  const orphan = { count: 0, m: 0, sec: 0, days: [] }
  try {
    const acts = JSON.parse(fs.readFileSync(ACTS_FILE, 'utf8'))
    const est  = JSON.parse(fs.readFileSync(EST_DIST_FILE, 'utf8'))
    for (const [aid, v] of Object.entries(acts)) {
      if (!RIDE_TYPE_NAMES.includes(v.type)) continue
      const day = String(v.start_date_local || '').slice(0, 10)
      if (day.slice(0, 4) !== thisYear) continue
      if (v.distance) continue                       // 有距離＝戶外，Strava 一定也有
      const sec = v.moving_time || 0
      const seen = mergedRecentRides.some(r => r.date === day
        && Math.abs((r.moving_time_sec || 0) - sec) <= 300)
      if (seen) continue
      const km = (est[aid] || {}).km || 0
      if (!km) continue                              // 沒估算就不硬湊，寧可少算
      orphan.count += 1
      orphan.m     += km * 1000
      orphan.sec   += sec
      orphan.days.push(`${day} ${km.toFixed(1)}km`)
    }
  } catch (e) {
    console.log(`   ⚠️ 讀不到 _activities.json／_est_distance.json，YTD 不補室內孤兒：${e.message}`)
  }
  if (orphan.count) {
    console.log(`   ➕ YTD 補回 ${orphan.count} 趟只在手錶的室內（估算里程）：${orphan.days.join('、')}`)
  }

  return {
    updated_at: new Date().toISOString(),
    summary: {
      ytd_distance_km:      Math.round((s.ytd_ride_totals.distance + orphan.m) / 100) / 10,
      ytd_elevation_m:      Math.round(s.ytd_ride_totals.elevation_gain),
      ytd_rides:            s.ytd_ride_totals.count - dropY.count + orphan.count,
      ytd_moving_time_hr:   Math.round((s.ytd_ride_totals.moving_time - dropY.sec + orphan.sec) / 360) / 10,
      ytd_run_distance_km:  Math.round(s.ytd_run_totals.distance / 100) / 10,
      ytd_runs:             s.ytd_run_totals.count,
      ytd_swim_distance_km: Math.round((s.ytd_swim_totals?.distance || 0) / 100) / 10,
      ytd_swims:            s.ytd_swim_totals?.count || 0,
      all_time_distance_km: Math.round(s.all_ride_totals.distance / 100) / 10,
      all_time_rides:       s.all_ride_totals.count,
      all_time_elevation_m: Math.round(s.all_ride_totals.elevation_gain),
    },
    recent_rides:    mergedRecentRides,
    recent_runs:     mergedRecentRuns,
    recent_swims:    mergedRecentSwims,
    recent_weights:  mergedRecentWeights,
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
  const activities = dropDuplicateIndoor(await fetchRecentActivities(token), RAW_ACC)

  // 讀舊 JSON 供 lap 快取使用（buildJSON 內部也會讀，此處獨立讀取供 enrichRideLaps）
  let existingData = { recent_rides: [] }
  if (fs.existsSync(OUT_FILE)) {
    try { existingData = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')) }
    catch (e) { /* 讀失敗就當空 */ }
  }
  // ITT 歷史另存檔優先：逐一區段比較 efforts 數量，哪邊較多就採用哪邊。
  // 注意：不可用「全部區段加總」比較（舊寫法），否則新增區段時，其他已追蹤
  // 區段在 main/itt 兩邊的加總差異會蓋掉這個新區段僅有的少量資料，
  // 導致新區段顯示 0 次 ——「碧山露營場」剛加入時就是撞到這個問題。
  if (fs.existsSync(ITT_FILE)) {
    try {
      const ittData = JSON.parse(fs.readFileSync(ITT_FILE, 'utf8'))
      const ittSegs = Array.isArray(ittData) ? ittData : ittData.segments
      if (ittSegs && ittSegs.length > 0) {
        const mainSegs  = existingData.segments || []
        const mainById  = new Map(mainSegs.map(s => [s.id, s]))
        for (const ittSeg of ittSegs) {
          const mainSeg   = mainById.get(ittSeg.id)
          const ittCount  = (ittSeg.efforts || []).length
          const mainCount = mainSeg ? (mainSeg.efforts || []).length : 0
          if (ittCount >= mainCount) {
            if (mainSeg) Object.assign(mainSeg, ittSeg)
            else mainSegs.push(ittSeg)
          }
        }
        existingData.segments = mainSegs
      }
    } catch (e) { /* 讀失敗忽略 */ }
  }

  const result     = buildJSON(stats, activities)

  const powerOnly = process.env.POWER_ONLY === '1'
  if (powerOnly) {
    console.log('⏭️  POWER_ONLY=1：跳過 laps/segments enrichment，專注更新功率 PR')
    result.seg_scan_ids = existingData.seg_scan_ids || []
    result.segments = existingData.segments || []
    // 即使跳過 enrichment，也要把舊有的 description / top_laps 從 existingData 合併回來，
    // 否則 strava.json 會被清空這兩個欄位（過去曾發生）。
    const oldRideMap = new Map(
      (existingData.recent_rides || []).map(r => [String(r.id), r])
    )
    let mergedDesc = 0, mergedLaps = 0, mergedStreams = 0
    for (const ride of result.recent_rides) {
      const old = oldRideMap.get(String(ride.id))
      if (!old) continue
      if (old.description != null && ride.description == null) {
        ride.description = old.description
        mergedDesc++
      }
      if (Array.isArray(old.top_laps) && !Array.isArray(ride.top_laps)) {
        ride.top_laps = old.top_laps
        if (old.top_laps.length) mergedLaps++
      }
      if (old.route_stream && !ride.route_stream) {
        ride.route_stream = old.route_stream
        mergedStreams++
      }
    }
    console.log(`   🔁 從舊 JSON 合併 description ${mergedDesc} 筆、top_laps ${mergedLaps} 筆、route_stream ${mergedStreams} 筆`)
  } else {
    // ── Detail enrichment：Laps + Description + Segment efforts（一次 API call 搞定）──
    // enrichRideLaps 現在同時處理 segment 掃描（用 seg_scan_ids 快取避免重複打）
    // SCAN_SEGMENTS=1 → 清除 seg_scan_ids 快取，重新掃；REFRESH_LAPS=1 → 清除 laps 快取
    const { newSegEfforts, segScanIds } = await enrichRideLaps(
      token, result.recent_rides, existingData.recent_rides, existingData.segments, existingData.seg_scan_ids
    )
    result.seg_scan_ids = segScanIds  // 存回 JSON 供下次跳過已掃描的 segment

    // ── ITT 區間：合併新 efforts + 取 segment meta ──
    result.segments = await buildSegmentsData(token, newSegEfforts, existingData.segments)
  }

  // ── Power PR：自動補新活動；SCAN_POWER=1 才全史重掃 ──
  const powerUpdate = await updatePowerPRs(token, activities)
  result.power_prs = powerUpdate.prs

  // ── Route stream：補齊 GPS + 心率 + 速度（新 ride 最多 8 筆，SCAN_STREAMS=1 全掃）──
  await enrichRouteStreams(token, result.recent_rides, existingData.recent_rides)

  // 以 streams 精算值覆寫單車活動關鍵指標（NP 與最大功率），提高和 Garmin 對齊度。
  let ftpForRideScores = 238
  try {
    const athleteFile = path.join(__dirname, '../athlete/gpt_教練前提資訊.json')
    ftpForRideScores = JSON.parse(fs.readFileSync(athleteFile, 'utf8')).cycling.ftp_watts.latest || 238
  } catch (e) { /* 保持預設 238 */ }

  const streamMetrics = powerUpdate.activityMetrics || {}
  for (const ride of result.recent_rides) {
    const m = streamMetrics[String(ride.id)]
    if (!m) continue
    if (m.np_watts) {
      ride.np_watts = m.np_watts
      if (ftpForRideScores > 0) {
        ride.if_score = +(m.np_watts / ftpForRideScores).toFixed(3)
        ride.tss = ride.moving_time_sec > 0
          ? Math.round((ride.moving_time_sec * m.np_watts * (m.np_watts / ftpForRideScores)) / (ftpForRideScores * 3600) * 100)
          : ride.tss
      }
    }
    if (m.max_watts_stream) {
      ride.max_watts = Math.max(ride.max_watts || 0, m.max_watts_stream)
    }
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(result, null, 2), 'utf8')
  console.log(`✅ strava.json 寫入完成 (${OUT_FILE})`)
  // ITT 歷史另存（獨立備份，避免 strava.json 被清空時丟失）
  fs.writeFileSync(ITT_FILE, JSON.stringify(result.segments, null, 2), 'utf8')
  console.log(`✅ itt-segments.json 備份完成 (${ITT_FILE})`)
  console.log(`   單車 YTD：${result.summary.ytd_distance_km} km / ${result.summary.ytd_rides} rides`)
  console.log(`   跑步 YTD：${result.summary.ytd_run_distance_km} km / ${result.summary.ytd_runs} runs`)
  console.log(`   游泳 YTD：${result.summary.ytd_swim_distance_km} km / ${result.summary.ytd_swims} swims`)
}

main().catch(err => {
  console.error('❌ 錯誤：', err.message)
  process.exit(1)  // 非 0 exit code 讓 GitHub Actions 標記為失敗
})
