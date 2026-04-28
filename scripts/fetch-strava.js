// fetch-strava.js
// 每天由 GitHub Actions 執行，抓 Strava 資料寫入 strava.json
// 本機測試：在 scripts/.env 填入憑證後執行 node scripts/fetch-strava.js
//
// 環境變數旗標：
//   FETCH_ALL=1       —— 分頁抓全部歷史活動（首次需要；之後預設只抓最近 100 筆即可）
//   SCAN_SEGMENTS=1   —— 對全史 ride 打 detail API，補抓 ITT segment efforts
//   REFRESH_LAPS=1    —— 忽略 lap 快取重抓
//   LAP_FETCH_MAX=N   —— 單次執行最多打多少次 detail API 補 lap（預設 30）避免撞 Strava 限流
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

const OUT_FILE   = path.join(__dirname, '..', 'strava.json')
const ITT_FILE   = path.join(__dirname, '..', 'itt-segments.json')
const POWER_FILE = path.join(__dirname, '..', 'power-prs.json')

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

// ── ITT 區間設定 ──
const SEGMENT_IDS = new Set([641218, 1761462, 7032136])
// 自訂顯示名稱（覆蓋 Strava API 回傳的原始名稱）
const SEGMENT_CUSTOM_NAMES = {
  641218:  '風櫃嘴ITT',
  1761462: '中社路ITT',
  7032136: '圓山-社子島砍鴨頭ITT',
}

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

// ── Power PR 更新：對新的有功率外騎打 streams，比對並更新 PR ──
// 開關：SCAN_POWER=1 才執行（預設跳過，日常 fetch 不多打 streams）
// SCAN_POWER=1 → 只掃未掃描過的；SCAN_POWER=1 + FETCH_ALL=1 → 忽略快取全掃
// POWER_FETCH_MAX=N → 單次上限（預設無限，SCAN_POWER 時不限）
async function updatePowerPRs(token, activities) {
  const RIDE_TYPES = ['Ride', 'VirtualRide', 'EBikeRide', 'MountainBikeRide']
  const forceRescan = process.env.SCAN_POWER === '1'  // 只有明確設 SCAN_POWER=1 才完整重掃
  const maxFetch    = parseInt(process.env.POWER_FETCH_MAX || '99999', 10)

  // 讀獨立的 power-prs.json
  let powerFile = { prs: [], scanned_ids: [] }
  if (fs.existsSync(POWER_FILE) && !forceRescan) {
    try { powerFile = JSON.parse(fs.readFileSync(POWER_FILE, 'utf8')) } catch (e) {}
  }

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
    return powerFile.prs || []
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
      if (!wattsArr) { scannedIds.add(String(act.id)); continue }

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
  }, null, 2), 'utf8')
  console.log(`✅ power-prs.json 寫入完成`)

  return prsResult
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

  // 新收集的 segment efforts：{ [segId]: [...] }
  const newSegEfforts = {}

  let detailBudget = LAP_FETCH_MAX
  let fetchCount = 0
  for (const ride of recentRides) {
    if (ride.id == null) { ride.top_laps = []; continue }
    const key = String(ride.id)
    const needsLaps = !(key in cache)
    const needsDesc = !(key in descCache)
    // needsSegs：沒有 ITT effort 且沒被掃描過
    const needsSegs = !knownActivityIds.has(key) && !segScanIds.has(key)

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
          for (const se of detail.segment_efforts) {
            if (se.segment && SEGMENT_IDS.has(se.segment.id)) {
              const sid = se.segment.id
              if (!newSegEfforts[sid]) newSegEfforts[sid] = []
              newSegEfforts[sid].push({
                activity_id:   ride.id,
                date:          ride.date,
                elapsed_sec:   se.elapsed_time,
                elapsed_str:   fmtElapsed(se.elapsed_time),
                avg_watts:     se.average_watts     ? Math.round(se.average_watts)     : null,
                avg_heartrate: se.average_heartrate ? Math.round(se.average_heartrate) : null,
              })
            }
          }
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

    // 更新 segment info（距離）；名稱固定用自訂名稱
    try {
      await new Promise(r => setTimeout(r, 300))
      const info = await fetchSegmentInfo(token, segId)
      existing.distance_km  = info.distance ? Math.round(info.distance / 10) / 100 : existing.distance_km
    } catch (e) {
      console.warn(`⚠️  Segment info ${segId} 失敗：${e.message}`)
    }
    // 永遠套用自訂名稱
    existing.name = SEGMENT_CUSTOM_NAMES[segId] || existing.name

    // 合併新 efforts（去重）
    const existingEfforts = existing.efforts || []
    const knownIds = new Set(existingEfforts.map(e => String(e.activity_id)))
    for (const e of (newSegEfforts[segId] || [])) {
      if (!knownIds.has(String(e.activity_id))) {
        existingEfforts.push(e)
        knownIds.add(String(e.activity_id))
      }
    }

    // 日期降冪排序
    existingEfforts.sort((a, b) => b.date.localeCompare(a.date))

    // PR 標記
    const prTime = existingEfforts.length > 0
      ? Math.min(...existingEfforts.map(e => e.elapsed_sec))
      : null

    const efforts = existingEfforts.map(e => ({ ...e, is_pr: e.elapsed_sec === prTime }))

    result.push({
      id:          segId,
      name:        existing.name,
      distance_km: existing.distance_km,
      pr_time_str: prTime ? fmtElapsed(prTime) : null,
      efforts,
    })
    console.log(`✅ Segment ${segId} (${existing.name})：共 ${efforts.length} 次`)
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

  const unknownRides = allRides.filter(a => !knownActivityIds.has(String(a.id)))
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
            newSegEfforts[sid].push({
              activity_id:   a.id,
              date,
              elapsed_sec:   se.elapsed_time,
              elapsed_str:   fmtElapsed(se.elapsed_time),
              avg_watts:     se.average_watts     ? Math.round(se.average_watts)     : null,
              avg_heartrate: se.average_heartrate ? Math.round(se.average_heartrate) : null,
            })
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

  const now = new Date()
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

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
    const w = a.average_watts || 0
    const t = a.moving_time   || 0
    const ifScore = (w > 0 && FTP > 0) ? +(w / FTP).toFixed(3) : null
    const tss     = (w > 0 && t > 0 && FTP > 0) ? Math.round((t * w * (w / FTP)) / (FTP * 3600) * 100) : null
    return {
      id:             a.id,
      name:           a.name,
      date:           localDate(a),
      time:           localTime(a),
      distance_km:    Math.round(a.distance / 10) / 100,
      moving_time_hr: Math.round(a.moving_time / 360) / 10,
      elevation_m:    Math.round(a.total_elevation_gain),
      avg_speed_kmh:  Math.round(a.average_speed * 36) / 10,
      avg_heartrate:  a.average_heartrate ? Math.round(a.average_heartrate) : null,
      avg_watts:      w > 0 ? Math.round(w) : null,
      trainer:        a.trainer || false,
      sport_type:     a.type,
      if_score:       ifScore,
      tss:            tss,
      description:    null,  // 由 enrichRideLaps 補入
    }
  })

  const recentRuns = activities.filter(a => isType(a, RUN_TYPES)).map(a => ({
    id:             a.id,
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

  const recentSwims = activities.filter(a => isType(a, SWIM_TYPES)).map(a => ({
    id:               a.id,
    name:             a.name,
    date:             localDate(a),
    time:             localTime(a),
    distance_km:      Math.round(a.distance / 10) / 100,
    moving_time_hr:   Math.round(a.moving_time / 360) / 10,
    pace_per_100m:    fmtPace100m(a.distance, a.moving_time),
    avg_heartrate:    a.average_heartrate ? Math.round(a.average_heartrate) : null,
  }))

  const recentWeights = activities.filter(a => isType(a, WEIGHT_TYPES)).map(a => ({
    id:            a.id,
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

  const wRideDist = Math.round(weekRides.reduce((s, a) => s + (a.distance || 0), 0) / 100) / 10
  const wRideHr   = Math.round(weekRides.reduce((s, a) => s + (a.moving_time || 0), 0) / 360) / 10
  const wRunDist  = Math.round(weekRuns.reduce((s, a)  => s + (a.distance || 0), 0) / 100) / 10
  const wRunHr    = Math.round(weekRuns.reduce((s, a)  => s + (a.moving_time || 0), 0) / 360) / 10
  const wSwimM    = Math.round(weekSwims.reduce((s, a) => s + (a.distance || 0), 0))
  const wWeightCt = weekWeights.length

  const weekly_quest = {
    ride:   { done: wRideDist >= 30 || wRideHr >= 1, distance_km: wRideDist, moving_time_hr: wRideHr, target_km: 30, target_hr: 1 },
    run:    { done: wRunDist >= 10  || wRunHr >= 1,  distance_km: wRunDist,  moving_time_hr: wRunHr,  target_km: 10, target_hr: 1 },
    swim:   { done: wSwimM >= 1000,                   distance_m: wSwimM,    target_m: 1000 },
    weight: { done: wWeightCt >= 1,                   count: wWeightCt,      target: 1 },
  }

  return {
    updated_at: new Date().toISOString(),
    summary: {
      ytd_distance_km:      Math.round(s.ytd_ride_totals.distance / 100) / 10,
      ytd_elevation_m:      Math.round(s.ytd_ride_totals.elevation_gain),
      ytd_rides:            s.ytd_ride_totals.count,
      ytd_moving_time_hr:   Math.round(s.ytd_ride_totals.moving_time / 360) / 10,
      ytd_run_distance_km:  Math.round(s.ytd_run_totals.distance / 100) / 10,
      ytd_runs:             s.ytd_run_totals.count,
      ytd_swim_distance_km: Math.round((s.ytd_swim_totals?.distance || 0) / 100) / 10,
      ytd_swims:            s.ytd_swim_totals?.count || 0,
      all_time_distance_km: Math.round(s.all_ride_totals.distance / 100) / 10,
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
  // ITT 歷史另存檔優先：若存在且 efforts 更多，以它為準
  if (fs.existsSync(ITT_FILE)) {
    try {
      const ittData = JSON.parse(fs.readFileSync(ITT_FILE, 'utf8'))
      const ittSegs = Array.isArray(ittData) ? ittData : ittData.segments
      if (ittSegs && ittSegs.length > 0) {
        const ittTotal   = ittSegs.reduce((n, s) => n + (s.efforts || []).length, 0)
        const mainTotal  = (existingData.segments || []).reduce((n, s) => n + (s.efforts || []).length, 0)
        if (ittTotal >= mainTotal) existingData.segments = ittSegs
      }
    } catch (e) { /* 讀失敗忽略 */ }
  }

  const result     = buildJSON(stats, activities)

  // ── Detail enrichment：Laps + Description + Segment efforts（一次 API call 搞定）──
  // enrichRideLaps 現在同時處理 segment 掃描（用 seg_scan_ids 快取避免重複打）
  // SCAN_SEGMENTS=1 → 清除 seg_scan_ids 快取，重新掃；REFRESH_LAPS=1 → 清除 laps 快取
  const { newSegEfforts, segScanIds } = await enrichRideLaps(
    token, result.recent_rides, existingData.recent_rides, existingData.segments, existingData.seg_scan_ids
  )
  result.seg_scan_ids = segScanIds  // 存回 JSON 供下次跳過已掃描的 segment

  // ── ITT 區間：合併新 efforts + 取 segment meta ──
  result.segments = await buildSegmentsData(token, newSegEfforts, existingData.segments)

  // ── Power PR：自動補新活動；SCAN_POWER=1 才全史重掃 ──
  result.power_prs = await updatePowerPRs(token, activities)

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
