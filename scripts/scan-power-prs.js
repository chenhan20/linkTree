// scan-power-prs.js
// 全史掃描功率 PR：找出所有有功率計的騎乘，計算各時段 Peak Power 最高紀錄
//
// 使用方式：
//   node scripts/scan-power-prs.js
//
// 結果會寫入 strava.json 的 power_prs 欄位
// 同時輸出 power-prs-cache.json 作為快取（避免重複打 API）
//
// ⚙️  環境變數：
//   RESCAN=1   —— 忽略快取，重新掃描全部（通常不需要）

const fs   = require('fs')
const path = require('path')
const https = require('https')

// ── 讀 .env ──
const envFile = path.join(__dirname, '.env')
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split(/\r?\n/).forEach(line => {
    const trimmed = line.replace(/^\uFEFF/, '').trim()
    if (!trimmed || trimmed.startsWith('#')) return
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx < 1) return
    const k = trimmed.slice(0, eqIdx).trim()
    const v = trimmed.slice(eqIdx + 1).trim()
    if (k && v && !process.env[k]) process.env[k] = v
  })
}

const CLIENT_ID     = process.env.STRAVA_CLIENT_ID
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET
const REFRESH_TOKEN = process.env.STRAVA_REFRESH_TOKEN

const STRAVA_JSON  = path.join(__dirname, '..', 'strava.json')
const CACHE_FILE   = path.join(__dirname, '..', 'power-prs-cache.json')

// ── 標準功率時段（秒）──
const DURATIONS = [5, 10, 30, 60, 120, 300, 600, 1200, 3600]
const DURATION_LABELS = {
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

// ── HTTPS helper ──
function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) }) }
        catch (e) { reject(new Error('JSON parse error')) }
      })
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

// ── 等待（避免 Strava 限流）──
const sleep = ms => new Promise(r => setTimeout(r, ms))

// ── Token ──
async function getAccessToken() {
  const body = new URLSearchParams({
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: REFRESH_TOKEN,
    grant_type:    'refresh_token',
  }).toString()

  const { data } = await request({
    hostname: 'www.strava.com',
    path:     '/oauth/token',
    method:   'POST',
    headers:  { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
  }, body)

  if (!data.access_token) throw new Error('Token 換取失敗：' + JSON.stringify(data))
  return data.access_token
}

// ── 全史活動列表（只需一次，直接從列表就可過濾有功率的騎乘）──
async function fetchAllActivities(token) {
  console.log('📋 抓取全史活動列表...')
  let all = [], page = 1
  while (true) {
    const { data } = await request({
      hostname: 'www.strava.com',
      path:     `/api/v3/athlete/activities?per_page=200&page=${page}`,
      method:   'GET',
      headers:  { Authorization: `Bearer ${token}` },
    })
    if (!Array.isArray(data) || data.length === 0) break
    all = all.concat(data)
    process.stdout.write(`\r   第 ${page} 頁 → 累計 ${all.length} 筆...`)
    if (data.length < 200) break
    page++
    await sleep(300)
  }
  console.log(`\n✅ 共 ${all.length} 筆活動`)
  return all
}

// ── 過濾：有功率計的騎乘（排除室內騎和估算功率）──
function filterPowerRides(activities) {
  return activities.filter(a =>
    (a.sport_type === 'Ride' || a.sport_type === 'VirtualRide' || a.type === 'Ride') &&
    a.device_watts === true &&
    !a.trainer  // 排除室內騎（通常沒裝功率）
  )
}

// ── 抓 Watts Stream ──
async function fetchWattsStream(token, activityId) {
  const { status, data } = await request({
    hostname: 'www.strava.com',
    path:     `/api/v3/activities/${activityId}/streams?keys=watts,time&key_by_type=true`,
    method:   'GET',
    headers:  { Authorization: `Bearer ${token}` },
  })
  if (status === 429) return null  // 限流，稍後重試
  return data
}

// ── 滑動視窗計算各時段 Peak Power ──
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

function calcAllPeaks(wattsArr) {
  const result = {}
  for (const dur of DURATIONS) {
    result[dur] = calcPeakPower(wattsArr, dur)
  }
  return result
}

// ── 主程式 ──
async function main() {
  console.log('\n⚡ Power PR 全史掃描\n')

  // 讀快取
  let cache = {}  // { activityId: { peaks: {...}, date: '...' } }
  if (fs.existsSync(CACHE_FILE) && process.env.RESCAN !== '1') {
    cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))
    console.log(`📦 快取已載入（${Object.keys(cache).length} 筆）`)
  }

  const token = await getAccessToken()
  console.log('✅ Token 取得成功\n')

  // 抓全史活動列表
  const allActivities = await fetchAllActivities(token)
  const powerRides    = filterPowerRides(allActivities)
  console.log(`🚴 有功率計的外騎：${powerRides.length} 筆`)

  // 找出還沒掃過的
  const toScan = powerRides.filter(a => !cache[String(a.id)])
  console.log(`🔍 需要掃描：${toScan.length} 筆（已快取 ${powerRides.length - toScan.length} 筆）\n`)

  if (toScan.length === 0) {
    console.log('✅ 所有活動都已在快取中，直接計算 PR...')
  }

  // 掃描未快取的活動
  let done = 0
  for (const act of toScan) {
    process.stdout.write(`\r⏳ [${done + 1}/${toScan.length}] ${act.name} (${act.start_date_local?.slice(0, 10)})...`)

    let streams = null
    let retries = 0
    while (retries < 3) {
      streams = await fetchWattsStream(token, act.id)
      if (streams !== null) break
      console.log(`\n⚠️  限流，等 15 秒後重試...`)
      await sleep(15000)
      retries++
    }

    if (!streams?.watts?.data) {
      // 沒有 watts stream（即使 device_watts=true 有時仍無資料）
      cache[String(act.id)] = { date: act.start_date_local?.slice(0, 10), name: act.name, peaks: null }
    } else {
      const wattsArr = streams.watts.data
      const peaks    = calcAllPeaks(wattsArr)
      cache[String(act.id)] = {
        date:  act.start_date_local?.slice(0, 10),
        name:  act.name,
        peaks,
      }
    }

    done++
    // 每 50 筆存一次快取
    if (done % 50 === 0) {
      fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2))
      console.log(`\n💾 中途儲存快取（${done} 筆）`)
    }

    await sleep(200)  // 避免太快打 API
  }

  if (toScan.length > 0) {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2))
    console.log(`\n💾 快取已儲存 → power-prs-cache.json`)
  }

  // ── 計算全史 PR（各時段前三）──
  console.log('\n📊 計算全史 Power PR（前三）...\n')

  const top3 = {}  // { dur: [ { watts, activity_id, date, activity_name }, ... ] }
  for (const dur of DURATIONS) top3[dur] = []

  for (const [actId, entry] of Object.entries(cache)) {
    if (!entry.peaks) continue
    for (const dur of DURATIONS) {
      const w = entry.peaks[dur]
      if (!w) continue
      top3[dur].push({ watts: w, activity_id: Number(actId), date: entry.date, activity_name: entry.name })
    }
  }

  // 每個時段按 watts 降冪排序，取前三
  for (const dur of DURATIONS) {
    top3[dur].sort((a, b) => b.watts - a.watts)
    top3[dur] = top3[dur].slice(0, 3)
  }

  // ── 輸出結果 ──
  const MEDALS = ['🥇', '🥈', '🥉']
  console.log('🏅 全史 Peak Power 前三：')
  console.log('─'.repeat(70))
  console.log('  時段    | Rank | Peak W  | 活動日期   | 活動名稱')
  console.log('─'.repeat(70))
  for (const dur of DURATIONS) {
    for (const [i, t] of top3[dur].entries()) {
      const label = i === 0 ? DURATION_LABELS[dur].padEnd(6) : '      '
      const watts = String(t.watts + ' W').padEnd(8)
      const date  = (t.date || '---').padEnd(11)
      console.log(`  ${label}  | ${MEDALS[i]}   | ${watts}| ${date}| ${t.activity_name || '---'}`)
    }
  }
  console.log('─'.repeat(70))

  // ── 寫入 strava.json ──
  const stravaData = JSON.parse(fs.readFileSync(STRAVA_JSON, 'utf8'))

  stravaData.power_prs = DURATIONS.map(dur => {
    const list = top3[dur]
    const best = list[0] || {}
    return {
      duration_sec:   dur,
      duration_label: DURATION_LABELS[dur],
      watts:          best.watts || null,
      activity_id:    best.activity_id || null,
      date:           best.date || null,
      activity_name:  best.activity_name || null,
      top3:           list.map((t, i) => ({ rank: i + 1, ...t })),
    }
  })
  stravaData.power_prs_updated_at = new Date().toISOString()

  fs.writeFileSync(STRAVA_JSON, JSON.stringify(stravaData, null, 2))
  console.log('\n✅ power_prs 已寫入 strava.json')
  console.log('✅ 完成！')
}

main().catch(err => {
  console.error('\n❌ 錯誤：', err.message)
  process.exit(1)
})
