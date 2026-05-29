// backfill-streams.js
// 為 data/strava.json 裡所有有 polyline 但缺 route_stream 的 ride
// 打 Strava streams API，補上 [lat, lng, hr, kmh] 降採樣路線資料
//
// 用法：node scripts/backfill-streams.js
// 可加旗標：
//   FORCE=1   — 無視快取，重新抓所有已有 route_stream 的 ride
//   DRY_RUN=1 — 只列出待抓清單，不打 API

'use strict'
const fs   = require('fs')
const path = require('path')
const https = require('https')

// ── 讀 .env（與 fetch-strava.js 相同邏輯）──
const envFile = path.join(__dirname, '.env')
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split(/\r?\n/).forEach(line => {
    const t = line.replace(/^\uFEFF/, '').trim()
    if (!t || t.startsWith('#')) return
    const eq = t.indexOf('=')
    if (eq < 1) return
    const k = t.slice(0, eq).trim(), v = t.slice(eq + 1).trim()
    if (k && v && !process.env[k]) process.env[k] = v
  })
  console.log('📁 已從 scripts/.env 讀取設定')
}

const CLIENT_ID     = process.env.STRAVA_CLIENT_ID
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET
const REFRESH_TOKEN = process.env.STRAVA_REFRESH_TOKEN

const DATA_FILE       = path.join(__dirname, '..', 'data', 'strava.json')
const CHECKPOINT_FILE = path.join(__dirname, '..', 'data', '.stream-checkpoint.json')

// ── HTTPS helper：回傳 { data, headers } ──
function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        try {
          const headers = {}
          for (const [k, v] of Object.entries(res.headers)) headers[k] = v
          resolve({ data: JSON.parse(raw), headers, status: res.statusCode })
        } catch (e) {
          reject(new Error('JSON parse error: ' + raw.slice(0, 200)))
        }
      })
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

// ── Rate limit state ──
const rl = {
  used15: 0, lim15: 100,
  usedDay: 0, limDay: 1000,
  window15Start: Date.now(),
  dayStart: Date.now(),
  retry: 0,
}

function parsePair(raw) {
  if (!raw) return [0, 0]
  const [a, b] = String(raw).split(',').map(v => Number(v.trim()))
  return [isFinite(a) ? a : 0, isFinite(b) ? b : 0]
}

function updateRl(headers) {
  const [u15, uDay] = parsePair(headers['x-ratelimit-usage'])
  const [l15, lDay] = parsePair(headers['x-ratelimit-limit'])
  const [ru15, ruDay] = parsePair(headers['x-readratelimit-usage'])
  const [rl15, rlDay] = parsePair(headers['x-readratelimit-limit'])
  rl.used15  = Math.max(u15, ru15)
  rl.lim15   = Math.min(l15  || 200, rl15  || 100)
  rl.usedDay = Math.max(uDay, ruDay)
  rl.limDay  = Math.min(lDay || 2000, rlDay || 1000)
  console.log(`  📊 Rate: ${rl.used15}/${rl.lim15} (15m) · ${rl.usedDay}/${rl.limDay} (day)`)
}

async function checkRateLimit() {
  const now = Date.now()
  // 跨 15 分鐘視窗後重置視窗計數
  if (now - rl.window15Start >= 15 * 60_000) {
    rl.window15Start = now
    rl.used15 = 0
  }
  const exhausted15  = rl.used15  >= rl.lim15  - 2  // 留 2 顆緩衝
  const exhaustedDay = rl.usedDay >= rl.limDay - 2

  if (exhaustedDay) {
    const wait = Math.max(0, rl.dayStart + 24 * 3600_000 - now) + 1000
    console.warn(`⏸  Day quota 用完，需等待 ${Math.ceil(wait / 60000)} 分鐘`)
    await new Promise(r => setTimeout(r, wait))
    rl.dayStart = Date.now(); rl.usedDay = 0; rl.window15Start = Date.now(); rl.used15 = 0
    return
  }
  if (exhausted15) {
    const wait = Math.max(0, rl.window15Start + 15 * 60_000 - now) + 1000
    console.warn(`⏸  15m quota 用完，等待 ${Math.ceil(wait / 1000)} 秒...`)
    await new Promise(r => setTimeout(r, wait))
    rl.window15Start = Date.now(); rl.used15 = 0
  }
}

// ── Token ──
async function getAccessToken() {
  const body = new URLSearchParams({
    client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
    refresh_token: REFRESH_TOKEN, grant_type: 'refresh_token',
  }).toString()
  const { data } = await request({
    hostname: 'www.strava.com', path: '/oauth/token', method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
  }, body)
  if (!data.access_token) throw new Error('Token 失敗：' + JSON.stringify(data))
  console.log('✅ access_token 取得')
  return data.access_token
}

// ── 抓 streams ──
async function fetchStream(token, actId) {
  await checkRateLimit()
  const { data, headers, status } = await request({
    hostname: 'www.strava.com',
    path: `/api/v3/activities/${actId}/streams?keys=latlng,heartrate,velocity_smooth,time&key_by_type=true`,
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (headers) updateRl(headers)
  if (status === 429) throw Object.assign(new Error('Rate limit 429'), { status: 429 })
  if (status === 404) return null  // activity not found / no GPS
  if (data.errors) throw new Error(JSON.stringify(data.errors))
  return data
}

// ── 降採樣：取 ~targetN 個均勻分布的 index ──
function evenIndices(n, targetN) {
  if (n <= targetN) return Array.from({ length: n }, (_, i) => i)
  const indices = []
  for (let i = 0; i < targetN; i++) {
    indices.push(Math.round(i * (n - 1) / (targetN - 1)))
  }
  return indices
}

// ── 把 streams 物件轉成 [[lat,lng,hr,kmh], ...] ──
function buildRouteStream(raw) {
  const latlng   = raw.latlng?.data   || []
  const hr       = raw.heartrate?.data || []
  const vel      = raw.velocity_smooth?.data || []
  const n = latlng.length
  if (n < 2) return null
  const indices = evenIndices(n, 120)
  return indices.map(i => {
    const [lat, lng] = latlng[i]
    const hrVal  = hr[i]  != null ? Math.round(hr[i])        : null
    const kmhVal = vel[i] != null ? Math.round(vel[i] * 36) / 10 : null
    return [
      Math.round(lat * 1e5) / 1e5,   // 5 位小數足夠精度
      Math.round(lng * 1e5) / 1e5,
      hrVal,
      kmhVal,
    ]
  })
}

// ── 主流程 ──
async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    throw new Error('缺少 STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET / STRAVA_REFRESH_TOKEN')
  }

  // 讀現有資料
  const json = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
  const rides = json.recent_rides || []

  // 讀 checkpoint（已成功抓過的 id set）
  let checkpoint = new Set()
  if (fs.existsSync(CHECKPOINT_FILE)) {
    try { checkpoint = new Set(JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8')).done || []) }
    catch (e) {}
  }

  const force  = process.env.FORCE   === '1'
  const dryRun = process.env.DRY_RUN === '1'

  // 篩出需要抓的 ride
  const todo = rides.filter(r =>
    r.polyline &&
    !r.trainer &&
    (force ? true : !r.route_stream) &&
    !checkpoint.has(String(r.id))
  )

  console.log(`📋 待補 route_stream：${todo.length} 筆（共 ${rides.length} 筆 ride，${rides.filter(r=>r.route_stream).length} 已有）`)

  if (dryRun || todo.length === 0) {
    if (dryRun) todo.forEach(r => console.log(`  ${r.id}  ${r.date}  ${r.name}`))
    console.log(todo.length === 0 ? '✅ 全部完成，無需補抓' : '（DRY_RUN 模式，跳過 API）')
    return
  }

  const token = await getAccessToken()
  rl.window15Start = Date.now()
  rl.dayStart      = Date.now()

  let ok = 0, skip = 0, fail = 0

  // 建 ride id → index map 方便更新
  const rideIndex = new Map(rides.map((r, i) => [String(r.id), i]))

  for (let i = 0; i < todo.length; i++) {
    const ride = todo[i]
    console.log(`[${i + 1}/${todo.length}] ${ride.date} ${ride.name} (${ride.id})`)

    try {
      await new Promise(r => setTimeout(r, 380))  // 基本間隔（≈ 2.6 req/s，遠低於 100/15m）
      const raw = await fetchStream(token, ride.id)

      if (!raw || !raw.latlng) {
        console.log('  ⚠️  無 GPS stream，跳過')
        checkpoint.add(String(ride.id))
        skip++
        continue
      }

      const routeStream = buildRouteStream(raw)
      if (!routeStream) {
        console.log('  ⚠️  降採樣後無資料，跳過')
        checkpoint.add(String(ride.id))
        skip++
        continue
      }

      const hasHR  = routeStream.some(p => p[2] != null)
      const hasVel = routeStream.some(p => p[3] != null)
      console.log(`  ✅ ${routeStream.length} pts | HR: ${hasHR} | Speed: ${hasVel}`)

      // 更新記憶體中的 ride
      const idx = rideIndex.get(String(ride.id))
      if (idx !== undefined) {
        json.recent_rides[idx] = { ...json.recent_rides[idx], route_stream: routeStream }
      }

      checkpoint.add(String(ride.id))
      ok++

      // 每 10 筆存一次（checkpoint + 資料），避免中斷損失太多
      if (ok % 10 === 0) {
        json.updated_at = new Date().toISOString()
        fs.writeFileSync(DATA_FILE, JSON.stringify(json, null, 2), 'utf8')
        fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify({ done: [...checkpoint] }), 'utf8')
        console.log(`  💾 中途存檔（${ok} 筆完成）`)
      }
    } catch (e) {
      if (e.status === 429) {
        // 罕見，但若真的 429 就等 5 分鐘重試一次
        console.warn(`  ⛔ 429！等待 5 分鐘後重試...`)
        await new Promise(r => setTimeout(r, 5 * 60_000))
        i--  // 重試同一筆
        continue
      }
      console.warn(`  ❌ 失敗：${e.message}`)
      fail++
    }
  }

  // 最終寫檔
  json.updated_at = new Date().toISOString()
  fs.writeFileSync(DATA_FILE, JSON.stringify(json, null, 2), 'utf8')
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify({ done: [...checkpoint] }), 'utf8')

  console.log(`\n🏁 完成！成功 ${ok} 筆 · 跳過（無GPS）${skip} 筆 · 失敗 ${fail} 筆`)
  console.log(`📝 strava.json 已更新`)
}

main().catch(e => { console.error('💥', e.message); process.exit(1) })
