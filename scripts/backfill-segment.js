// backfill-segment.js
// 用 Strava /segment_efforts API 直接抓單一區間的全部歷史 efforts，
// 合併寫入 data/itt-segments.json
//
// 使用方式（在 linkTree/ 根目錄執行）：
//   node scripts/backfill-segment.js 956558

const fs    = require('fs')
const path  = require('path')
const https = require('https')

// ── 讀 .env ──
const envFile = path.join(__dirname, '.env')
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split(/\r?\n/).forEach(line => {
    const t = line.replace(/^\uFEFF/, '').trim()
    if (!t || t.startsWith('#')) return
    const eq = t.indexOf('='); if (eq < 1) return
    const k = t.slice(0, eq).trim(), v = t.slice(eq + 1).trim()
    if (k && v && !process.env[k]) process.env[k] = v
  })
}

const CLIENT_ID     = process.env.STRAVA_CLIENT_ID
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET
const REFRESH_TOKEN = process.env.STRAVA_REFRESH_TOKEN
const ITT_FILE      = path.join(__dirname, '..', 'data', 'itt-segments.json')

const SEGMENT_CUSTOM_NAMES = {
  956558: '劍南路（回程）ITT',
}

function req(options, body = null) {
  return new Promise((resolve, reject) => {
    const r = https.request(options, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }) }
        catch (e) { reject(new Error('JSON parse: ' + raw.slice(0, 200))) }
      })
    })
    r.on('error', reject)
    if (body) r.write(body)
    r.end()
  })
}

function fmtElapsed(s) {
  s = Math.round(s)
  if (s < 3600) {
    const m = Math.floor(s / 60), sec = s % 60
    return `${m}:${String(sec).padStart(2, '0')}`
  }
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

async function getToken() {
  const body = new URLSearchParams({
    client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
    refresh_token: REFRESH_TOKEN, grant_type: 'refresh_token',
  }).toString()
  const { data } = await req({
    hostname: 'www.strava.com', path: '/oauth/token', method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
  }, body)
  if (!data.access_token) throw new Error('Token 失敗：' + JSON.stringify(data))
  console.log('✅ access_token 取得成功')
  return data.access_token
}

async function fetchSegmentInfo(token, segId) {
  const { data } = await req({
    hostname: 'www.strava.com', path: `/api/v3/segments/${segId}`,
    method: 'GET', headers: { Authorization: `Bearer ${token}` },
  })
  return data
}

async function fetchSegmentEffortsAPI(token, segId) {
  const all = []
  let page = 1
  while (true) {
    await new Promise(r => setTimeout(r, 400))
    const { data } = await req({
      hostname: 'www.strava.com',
      path: `/api/v3/segment_efforts?segment_id=${segId}&per_page=200&page=${page}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!Array.isArray(data) || data.length === 0) break
    console.log(`  第 ${page} 頁：${data.length} 筆`)
    all.push(...data)
    if (data.length < 200) break
    page++
  }
  return all
}
// DELAY_MS 預設 5000ms，控制在 Strava 100 reads/15min 限制內
async function scanActivitiesForSegment(token, segId) {
  const DELAY_MS = parseInt(process.env.SCAN_DELAY_MS || '5000', 10)
  const data = JSON.parse(fs.readFileSync(ITT_FILE.replace('itt-segments.json', 'strava.json'), 'utf8'))
  const activities = data.recent_rides || []
  console.log(`  掃描 ${activities.length} 筆活動（delay=${DELAY_MS}ms，預計 ${Math.ceil(activities.length * DELAY_MS / 60000)} 分鐘）`)

  const found = []
  for (let i = 0; i < activities.length; i++) {
    const act = activities[i]
    await new Promise(r => setTimeout(r, DELAY_MS))
    try {
      const { status, data: det } = await req({
        hostname: 'www.strava.com',
        path: `/api/v3/activities/${act.id}`,
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (status === 429) {
        console.warn('\n⚠️  Rate limit 429，暫停 60 秒...')
        await new Promise(r => setTimeout(r, 60000))
        i--  // retry
        continue
      }
      const hits = (det.segment_efforts || []).filter(e => e.segment && e.segment.id === segId)
      if (hits.length > 0) {
        const date = (act.date || det.start_date_local || det.start_date || '').slice(0, 10)
        hits.forEach(se => {
          found.push({
            activity_id:   act.id,
            date,
            elapsed_sec:   se.elapsed_time,
            elapsed_str:   fmtElapsed(se.elapsed_time),
            avg_watts:     se.average_watts     ? Math.round(se.average_watts)     : null,
            avg_heartrate: se.average_heartrate ? Math.round(se.average_heartrate) : null,
            is_pr: false,
          })
        })
        process.stdout.write(`✓`)
      } else {
        process.stdout.write('.')
      }
    } catch (e) {
      console.warn(`\n  ⚠️  id=${act.id} 失敗：${e.message}`)
    }
    if ((i + 1) % 50 === 0) console.log(` [${i + 1}/${activities.length}]`)
  }
  console.log(`\n  掃描完成，找到 ${found.length} 筆 effort`)
  return found
}

async function main() {
  const segId = parseInt(process.argv[2] || '956558', 10)
  console.log(`\n🚀 補抓 segment ${segId} 的歷史 efforts...\n`)

  const token   = await getToken()

  // 取區間資訊（名稱、距離）
  console.log('📍 取得 segment 資訊...')
  const info = await fetchSegmentInfo(token, segId)
  const distance_km = info.distance ? +(info.distance / 1000).toFixed(2) : null
  const segName = SEGMENT_CUSTOM_NAMES[segId] || info.name || `Segment ${segId}`
  console.log(`   名稱：${segName}，距離：${distance_km} km`)

  // 先試 segment_efforts API
  console.log('📊 嘗試 /segment_efforts API...')
  let rawEfforts = await fetchSegmentEffortsAPI(token, segId)

  if (rawEfforts.length === 0) {
    console.log('  ⚠️  API 返回 0 筆（Strava 未索引），改為掃描活動 detail...')
    rawEfforts = await scanActivitiesForSegment(token, segId)
    if (rawEfforts.length === 0) {
      console.log('⚠️  掃描全部活動後仍無 effort，結束。')
      return
    }
    // rawEfforts 已是正確格式，跳過轉換
    const efforts = rawEfforts.sort((a, b) => b.date.localeCompare(a.date))
    const bestSec = Math.min(...efforts.map(e => e.elapsed_sec))
    const prIdx = efforts.findIndex(e => e.elapsed_sec === bestSec)
    if (prIdx !== -1) efforts[prIdx].is_pr = true
    const pr_time_str = fmtElapsed(bestSec)
    console.log(`🏆 PR：${pr_time_str}（${efforts[prIdx].date}）`)
    let existing = []
    if (fs.existsSync(ITT_FILE)) { try { existing = JSON.parse(fs.readFileSync(ITT_FILE, 'utf8')) } catch (e) {} }
    const filtered = existing.filter(s => s.id !== segId)
    filtered.push({ id: segId, name: segName, distance_km, pr_time_str, efforts })
    fs.writeFileSync(ITT_FILE, JSON.stringify(filtered, null, 2), 'utf8')
    console.log(`\n✅ 已寫入 data/itt-segments.json（共 ${filtered.length} 個區間）`)
    return
  }

  console.log(`✅ 共 ${rawEfforts.length} 筆 effort`)

  // 轉換格式，由新到舊排序
  const efforts = rawEfforts
    .map(e => ({
      activity_id:   e.activity?.id || e.activity_id || null,
      date:          (e.start_date_local || e.start_date || '').slice(0, 10),
      elapsed_sec:   e.elapsed_time,
      elapsed_str:   fmtElapsed(e.elapsed_time),
      avg_watts:     e.average_watts     ? Math.round(e.average_watts)     : null,
      avg_heartrate: e.average_heartrate ? Math.round(e.average_heartrate) : null,
      is_pr:         false,
    }))
    .sort((a, b) => b.date.localeCompare(a.date))

  // 標記 PR（最短 elapsed_sec）
  const bestSec = Math.min(...efforts.map(e => e.elapsed_sec))
  const prIdx = efforts.findIndex(e => e.elapsed_sec === bestSec)
  if (prIdx !== -1) efforts[prIdx].is_pr = true

  const pr_time_str = fmtElapsed(bestSec)
  console.log(`🏆 PR：${pr_time_str}（第 ${prIdx + 1} 筆，${efforts[prIdx].date}）`)

  // 讀現有 itt-segments.json
  let existing = []
  if (fs.existsSync(ITT_FILE)) {
    try { existing = JSON.parse(fs.readFileSync(ITT_FILE, 'utf8')) } catch (e) {}
  }

  // 移除舊的同 ID（若有），插入新資料
  const filtered = existing.filter(s => s.id !== segId)
  const newSeg = { id: segId, name: segName, distance_km, pr_time_str, efforts }
  filtered.push(newSeg)

  fs.writeFileSync(ITT_FILE, JSON.stringify(filtered, null, 2), 'utf8')
  console.log(`\n✅ 已寫入 data/itt-segments.json（共 ${filtered.length} 個區間）`)
}

main().catch(e => { console.error('❌', e.message); process.exit(1) })
