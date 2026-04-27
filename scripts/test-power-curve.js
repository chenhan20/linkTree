// test-power-curve.js
// 測試：用 Strava Streams API 拿某活動的功率資料，計算各時段 Peak Power
//
// 使用方式：
//   node scripts/test-power-curve.js
//   node scripts/test-power-curve.js 18210555161   (指定 activity ID)
//
// API 端點：GET /api/v3/activities/{id}/streams?keys=watts,time&key_by_type=true

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

// ── 預設測試的 activity ID（可從 command line 覆蓋）──
const ACTIVITY_ID = process.argv[2] || '18210555161'

// ── 標準功率區段時長（秒）──
const DURATIONS = [5, 10, 30, 60, 120, 300, 600, 1200, 3600]
const DURATION_LABELS = {
  5:    '5 秒',
  10:   '10 秒',
  30:   '30 秒',
  60:   '1 分',
  120:  '2 分',
  300:  '5 分',
  600:  '10 分',
  1200: '20 分',
  3600: '60 分',
}

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
        catch (e) { reject(new Error('JSON parse error: ' + Buffer.concat(chunks).toString('utf8').slice(0, 200))) }
      })
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

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
  return data.access_token
}

// ── 抓活動基本資訊 ──
async function fetchActivityDetail(token, id) {
  return request({
    hostname: 'www.strava.com',
    path:     `/api/v3/activities/${id}`,
    method:   'GET',
    headers:  { Authorization: `Bearer ${token}` },
  })
}

// ── 抓 Streams（watts + time）──
async function fetchWattsStream(token, id) {
  return request({
    hostname: 'www.strava.com',
    path:     `/api/v3/activities/${id}/streams?keys=watts,time&key_by_type=true`,
    method:   'GET',
    headers:  { Authorization: `Bearer ${token}` },
  })
}

// ── 計算各時段 Peak Power（滑動視窗平均最大值）──
// Strava streams 是 per-second 的稀疏陣列，需先依 time 對齊
function calcPeakPower(timeArr, wattsArr, durationSec) {
  if (!timeArr || !wattsArr || wattsArr.length < durationSec) return null

  // 建立以 time 為 key 的 map
  const wByTime = new Map()
  for (let i = 0; i < timeArr.length; i++) {
    if (wattsArr[i] != null) wByTime.set(timeArr[i], wattsArr[i])
  }

  const totalTime = timeArr[timeArr.length - 1]
  if (totalTime < durationSec) return null

  // 滑動視窗：用 wattsArr index 方式（Strava 通常 1Hz，但有時有空缺）
  // 用 index-based 滑動（假設已 1Hz），更快速
  const n = wattsArr.length
  let maxAvg = 0
  let windowSum = 0

  // 初始化視窗
  for (let i = 0; i < durationSec && i < n; i++) {
    windowSum += (wattsArr[i] ?? 0)
  }

  maxAvg = windowSum / durationSec

  for (let i = durationSec; i < n; i++) {
    windowSum += (wattsArr[i] ?? 0)
    windowSum -= (wattsArr[i - durationSec] ?? 0)
    const avg = windowSum / durationSec
    if (avg > maxAvg) maxAvg = avg
  }

  return Math.round(maxAvg)
}

// ── 主程式 ──
async function main() {
  console.log(`\n🔍 Activity ID: ${ACTIVITY_ID}\n`)

  const token  = await getAccessToken()
  console.log('✅ Token 取得成功')

  // 抓活動詳情
  const detail = await fetchActivityDetail(token, ACTIVITY_ID)
  if (detail.errors) throw new Error('Activity detail 錯誤：' + JSON.stringify(detail.errors))

  console.log(`\n📋 活動名稱 : ${detail.name}`)
  console.log(`📅 日期     : ${detail.start_date_local?.slice(0, 10)}`)
  console.log(`⚡ 平均功率 : ${detail.average_watts ?? 'N/A'} W`)
  console.log(`🏆 最大功率 : ${detail.max_watts ?? 'N/A'} W`)
  console.log(`⚙️  Weighted Power (NP): ${detail.weighted_average_watts ?? 'N/A'} W`)
  console.log(`📊 有功率資料: ${detail.device_watts ? '✅ 是' : '❌ 否（估算）'}`)

  if (!detail.device_watts) {
    console.log('\n⚠️  此活動沒有功率計，watts 為 Strava 估算值，Peak Power 仍可計算但不代表真實功率。')
  }

  // 抓 Streams
  console.log('\n⏳ 抓取 watts stream...')
  const streams = await fetchWattsStream(token, ACTIVITY_ID)

  if (streams.message === 'Authorization Error') {
    throw new Error('沒有此活動的存取權限')
  }

  const timeStream  = streams.time?.data
  const wattsStream = streams.watts?.data

  if (!wattsStream) {
    console.log('\n❌ 此活動沒有 watts stream（可能沒有功率計也沒有估算資料）')
    return
  }

  console.log(`✅ Watts stream 長度: ${wattsStream.length} 個資料點`)
  console.log(`   活動時長: ${Math.round(timeStream[timeStream.length - 1] / 60)} 分鐘`)

  const validPts = wattsStream.filter(w => w != null && w > 0).length
  console.log(`   有效功率點: ${validPts}/${wattsStream.length}`)

  // 計算各時段 Peak Power
  console.log('\n🏅 Peak Power 紀錄：')
  console.log('─'.repeat(35))
  console.log('  時段        | Peak Power')
  console.log('─'.repeat(35))

  const results = {}
  for (const dur of DURATIONS) {
    const peak = calcPeakPower(timeStream, wattsStream, dur)
    results[dur] = peak
    if (peak !== null) {
      console.log(`  ${DURATION_LABELS[dur].padEnd(12)}| ${peak} W`)
    } else {
      console.log(`  ${DURATION_LABELS[dur].padEnd(12)}| （活動太短）`)
    }
  }

  console.log('─'.repeat(35))
  console.log('\n✅ 完成！')
  console.log('\n💡 這些數據可以整合到 strava.json 中，')
  console.log('   掃全部歷史騎乘就能建出你的功率最高紀錄表（Power PR Table）。')
}

main().catch(err => {
  console.error('\n❌ 錯誤：', err.message)
  process.exit(1)
})
