#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────────
 * harvest-strava.js —— 訂閱到期前，把 Strava 上「之後拿不到」的東西全部落地
 *
 * 為什麼要有這支：
 *   成績本身已經不需要 Strava 了 —— 自建偵測器（tools/tcx/segments.py）跟官方對帳
 *   91 筆逐筆吻合、平均差 0.75 秒。真正搶不回來的是三樣：
 *
 *     ① 路段折線（/segments/{id}/streams）
 *        這是自建計時的閘門座標來源。有折線就永遠能自己計時；沒有就再也加不了新路段。
 *        ← 這才是「吃乾抹淨」的重點，不是成績。
 *     ② 路段 metadata：KOM、全站 effort 數、athlete 數 —— 全站資料只有 Strava 有。
 *     ③ 2025-08-13 以前的活動：那時候還沒有 Garmin 錶，本機沒有 FIT 可以重算。
 *        第一趟是 2025-04-27。那四個月的資料只存在於 Strava。
 *
 * 設計上的三個決定：
 *
 *   ‧ 抓取與分析分開。抓一次就存成檔案，之後改門檻用 --report 重算，不再打任何 API。
 *     門檻是會反覆調的東西（160W 對不對？15 分鐘會不會太長？），
 *     每調一次就重抓 140 趟是把額度燒在不需要的地方。
 *
 *   ‧ 一個活動一個檔（data/strava-archive/activities/<id>.json）。
 *     檔案存在 = 已抓過，這就是續跑狀態，不需要另外維護 state 檔；
 *     而且 git diff 只會出現新增的那幾個，不會整包重寫。
 *
 *   ‧ 節流看回應標頭，不猜。Strava 每個回應都帶 X-ReadRateLimit-Usage，
 *     直接讀它比自己數請求準（別的腳本、別的視窗也在花同一份額度）。
 *
 * 額度（讀取）：100 req / 15 分、1000 req / 日。全史 140 趟騎乘 →
 * 兩個 15 分鐘視窗跑完，吃掉當日額度約 14%。撞到 15 分鐘牆會自動睡到下一個整刻鐘。
 *
 * 用法：
 *   node scripts/harvest-strava.js                    # 全部階段，斷點續跑
 *   node scripts/harvest-strava.js --phase index      # 只抓活動清單
 *   node scripts/harvest-strava.js --phase details    # 只補活動明細
 *   node scripts/harvest-strava.js --phase segments   # 只抓入選路段的折線
 *   node scripts/harvest-strava.js --report           # 純本機重算，不打 API
 *   node scripts/harvest-strava.js --report --min-sec 600 --min-watts 150
 *   node scripts/harvest-strava.js --dry-run          # 只印會做什麼
 *
 * 篩選門檻（預設 = 使用者要的「可能是認真騎的路段」）：
 *   --min-sec 900          單次成績至少 15 分鐘（用 moving_time）
 *   --min-watts 160        平均功率至少 160W
 *   --min-rides 2          至少騎過幾次才算「常騎」
 *   --allow-estimated      放行估算功率（預設只採 device_watts=true 的實測功率）
 * ─────────────────────────────────────────────────────────────────────────── */
'use strict'

const fs = require('fs')
const path = require('path')
const https = require('https')

// ── 本機：自動讀取 scripts/.env（與 fetch-strava.js 同樣寫法）──
const envFile = path.join(__dirname, '.env')
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split(/\r?\n/).forEach(line => {
    const trimmed = line.replace(/^﻿/, '').trim()
    if (!trimmed || trimmed.startsWith('#')) return
    const eq = trimmed.indexOf('=')
    if (eq < 1) return
    const k = trimmed.slice(0, eq).trim()
    const v = trimmed.slice(eq + 1).trim()
    if (k && v && !process.env[k]) process.env[k] = v
  })
  console.log('📁 已從 scripts/.env 讀取設定（本機模式）')
}

const CLIENT_ID     = process.env.STRAVA_CLIENT_ID
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET
const REFRESH_TOKEN = process.env.STRAVA_REFRESH_TOKEN

const ROOT       = path.join(__dirname, '..')
const ARCHIVE    = path.join(ROOT, 'data', 'strava-archive')
const ACT_DIR    = path.join(ARCHIVE, 'activities')
const SEG_DIR    = path.join(ARCHIVE, 'segments')
const INDEX_FILE = path.join(ARCHIVE, 'index.json')
const CATALOG    = path.join(ARCHIVE, 'segment-catalog.json')
const ITT_CONFIG = path.join(ROOT, 'data', 'itt-config.json')

const RIDE_TYPES = new Set(['Ride', 'VirtualRide', 'EBikeRide', 'MountainBikeRide', 'GravelRide'])

// ── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = {
    phase: 'all', report: false, dryRun: false, noWait: false,
    minSec: 900, minWatts: 160, minRides: 2, allowEstimated: false,
    maxRequests: Infinity,
  }
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], next = () => argv[++i]
    if (k === '--phase') a.phase = next()
    else if (k === '--report') a.report = true
    else if (k === '--dry-run') a.dryRun = true
    else if (k === '--no-wait') a.noWait = true
    else if (k === '--min-sec') a.minSec = +next()
    else if (k === '--min-watts') a.minWatts = +next()
    else if (k === '--min-rides') a.minRides = +next()
    else if (k === '--allow-estimated') a.allowEstimated = true
    else if (k === '--max-requests') a.maxRequests = +next()
    else if (k === '-h' || k === '--help') { printHelp(); process.exit(0) }
    else { console.error(`未知參數：${k}（--help 看用法）`); process.exit(2) }
  }
  if (!['all', 'index', 'details', 'segments'].includes(a.phase)) {
    console.error(`--phase 只能是 all / index / details / segments`); process.exit(2)
  }
  return a
}
function printHelp() {
  console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*[\s─]*\n?/, '').replace(/^ \* ?/gm, ''))
}

// ── HTTP：回傳 body 與 headers（節流要讀標頭）─────────────────────────────────
function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let json = null
        try { json = JSON.parse(text) } catch (e) { /* 429/5xx 可能不是 JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, json, text })
      })
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

// ── 節流：以 Strava 回應標頭為準 ─────────────────────────────────────────────
// X-ReadRateLimit-Limit / -Usage 是「讀取」額度（100,1000）；
// X-RateLimit-* 是總額度（200,2000）。兩個都看，取比較緊的那個。
const gov = {
  short: { used: 0, limit: 100 },
  day:   { used: 0, limit: 1000 },
  sent: 0,
  update(headers) {
    const pick = (a, b) => headers[a] || headers[b]
    const lim = pick('x-readratelimit-limit', 'x-ratelimit-limit')
    const use = pick('x-readratelimit-usage', 'x-ratelimit-usage')
    if (lim) { const [s, d] = String(lim).split(',').map(Number); if (s) this.short.limit = s; if (d) this.day.limit = d }
    if (use) { const [s, d] = String(use).split(',').map(Number); if (!isNaN(s)) this.short.used = s; if (!isNaN(d)) this.day.used = d }
  },
  get shortLeft() { return this.short.limit - this.short.used },
  get dayLeft()   { return this.day.limit - this.day.used },
  line() { return `額度 15分 ${this.short.used}/${this.short.limit}・當日 ${this.day.used}/${this.day.limit}` },
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const msToNextQuarter = () => {
  const now = new Date()
  const next = new Date(now)
  next.setMinutes(Math.floor(now.getMinutes() / 15) * 15 + 15, 5, 0)  // +5 秒保險
  return next - now
}

class DailyLimitReached extends Error {}

/** 送出一個讀取請求，自動節流、429 退避、標頭回寫。 */
async function apiGet(token, pathname, args) {
  // 留 3 個請求的緩衝：別的腳本可能同時在花同一份額度
  if (gov.dayLeft <= 3) throw new DailyLimitReached('當日讀取額度用盡')
  if (gov.shortLeft <= 3) {
    if (args.noWait) throw new DailyLimitReached('15 分鐘額度用盡（--no-wait）')
    const wait = msToNextQuarter()
    console.log(`  ⏸️  15 分鐘額度用盡，睡 ${Math.ceil(wait / 1000)} 秒到下一個整刻鐘…（${gov.line()}）`)
    await sleep(wait)
    gov.short.used = 0
  }
  if (gov.sent >= args.maxRequests) throw new DailyLimitReached(`已達 --max-requests ${args.maxRequests}`)

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await request({
      hostname: 'www.strava.com', path: pathname, method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    })
    gov.sent++
    gov.update(res.headers)
    if (res.status === 429) {
      const wait = msToNextQuarter()
      console.log(`  ⚠️  429，睡 ${Math.ceil(wait / 1000)} 秒後重試（${gov.line()}）`)
      await sleep(wait)
      gov.short.used = 0
      continue
    }
    if (res.status === 404) return null                    // 路段被刪 / 私人，跳過不算失敗
    if (res.status >= 400) throw new Error(`${pathname} → HTTP ${res.status}：${res.text.slice(0, 200)}`)
    return res.json
  }
  throw new Error(`${pathname}：重試四次仍失敗`)
}

async function getAccessToken() {
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    throw new Error('缺少 STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET / STRAVA_REFRESH_TOKEN（放 scripts/.env）')
  }
  const body = new URLSearchParams({
    client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
    refresh_token: REFRESH_TOKEN, grant_type: 'refresh_token',
  }).toString()
  const res = await request({
    hostname: 'www.strava.com', path: '/oauth/token', method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
  }, body)
  if (!res.json || !res.json.access_token) throw new Error('Token 換取失敗：' + res.text.slice(0, 200))
  console.log('✅ access_token 取得成功')
  return res.json.access_token
}

const ensureDir = d => fs.mkdirSync(d, { recursive: true })
const writeJSON = (f, o) => fs.writeFileSync(f, JSON.stringify(o, null, 2), 'utf8')
const readJSON  = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch (e) { return null } }

// ── Phase 1：活動清單 ────────────────────────────────────────────────────────
async function phaseIndex(token, args) {
  console.log('\n── Phase 1 · 活動清單 ─────────────────────────────')
  if (args.dryRun) { console.log('  [dry-run] 會分頁抓 /athlete/activities 直到抓完'); return readJSON(INDEX_FILE) || [] }
  const all = []
  for (let page = 1; ; page++) {
    const batch = await apiGet(token, `/api/v3/athlete/activities?per_page=200&page=${page}`, args)
    if (!Array.isArray(batch) || batch.length === 0) break
    all.push(...batch)
    console.log(`  第 ${page} 頁：${batch.length} 筆（累計 ${all.length}）`)
    if (batch.length < 200) break
  }
  all.sort((a, b) => String(a.start_date_local).localeCompare(String(b.start_date_local)))
  ensureDir(ARCHIVE)
  writeJSON(INDEX_FILE, all)
  const rides = all.filter(a => RIDE_TYPES.has(a.type))
  const first = all[0] && String(all[0].start_date_local).slice(0, 10)
  const last  = all[all.length - 1] && String(all[all.length - 1].start_date_local).slice(0, 10)
  console.log(`✅ 共 ${all.length} 筆活動（其中騎乘 ${rides.length} 筆），${first} → ${last}`)
  return all
}

// ── Phase 2：逐趟明細（含全部 segment efforts）───────────────────────────────
async function phaseDetails(token, args, index) {
  console.log('\n── Phase 2 · 活動明細（include_all_efforts=true）───')
  ensureDir(ACT_DIR)
  const rides = index.filter(a => RIDE_TYPES.has(a.type))
  const todo = rides.filter(a => !fs.existsSync(path.join(ACT_DIR, `${a.id}.json`)))
  console.log(`  騎乘 ${rides.length} 筆，已存檔 ${rides.length - todo.length} 筆，待抓 ${todo.length} 筆`)
  if (args.dryRun) { console.log(`  [dry-run] 會送出 ${todo.length} 個請求`); return }
  let done = 0
  for (const a of todo) {
    // include_all_efforts=true 是關鍵：預設 false 時 Strava 只回「重點」efforts
    // （星號路段／PR／KOM），新加的路段沒有 PR 也沒被星號，整批就不會回傳。
    const detail = await apiGet(token, `/api/v3/activities/${a.id}?include_all_efforts=true`, args)
    if (detail) {
      writeJSON(path.join(ACT_DIR, `${a.id}.json`), detail)
      const n = Array.isArray(detail.segment_efforts) ? detail.segment_efforts.length : 0
      done++
      if (done % 10 === 0 || n > 0) {
        console.log(`  [${done}/${todo.length}] ${String(a.start_date_local).slice(0, 10)} ${(a.name || '').slice(0, 20)} → ${n} 段 effort（${gov.line()}）`)
      }
    }
    await sleep(120)   // 均勻散開，避免瞬間打滿
  }
  console.log(`✅ 本輪新增 ${done} 筆明細`)
}

// ── Phase 3：聚合 + 篩選（純本機，不打 API）──────────────────────────────────
function buildCatalog(args) {
  if (!fs.existsSync(ACT_DIR)) return { segments: [], scanned: 0 }
  const files = fs.readdirSync(ACT_DIR).filter(f => f.endsWith('.json'))
  const bySeg = new Map()
  for (const f of files) {
    const d = readJSON(path.join(ACT_DIR, f))
    if (!d || !Array.isArray(d.segment_efforts)) continue
    const date = String(d.start_date_local || d.start_date || '').slice(0, 10)
    for (const se of d.segment_efforts) {
      const seg = se.segment
      if (!seg || !seg.id) continue
      if (!bySeg.has(seg.id)) {
        bySeg.set(seg.id, {
          id: seg.id, name: seg.name,
          distance_km: seg.distance ? +(seg.distance / 1000).toFixed(2) : null,
          average_grade: seg.average_grade ?? null,
          elevation_gain_m: seg.elevation_high != null && seg.elevation_low != null
            ? Math.round(seg.elevation_high - seg.elevation_low) : null,
          start_latlng: seg.start_latlng || null,
          end_latlng: seg.end_latlng || null,
          activity_type: seg.activity_type || null,
          private: !!seg.private,
          efforts: [],
        })
      }
      bySeg.get(seg.id).efforts.push({
        activity_id: d.id,
        date,
        start_time: String(se.start_date_local || '').slice(11, 16) || null,
        elapsed_sec: se.elapsed_time ?? null,
        moving_sec: se.moving_time ?? null,
        avg_watts: se.average_watts != null ? Math.round(se.average_watts) : null,
        device_watts: !!se.device_watts,
        avg_heartrate: se.average_heartrate != null ? Math.round(se.average_heartrate) : null,
        avg_cadence: se.average_cadence != null ? Math.round(se.average_cadence) : null,
        pr_rank: se.pr_rank ?? null,
        kom_rank: se.kom_rank ?? null,
      })
    }
  }

  const median = arr => {
    const v = arr.filter(x => x != null).sort((a, b) => a - b)
    if (!v.length) return null
    const m = Math.floor(v.length / 2)
    return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2)
  }

  const segments = [...bySeg.values()].map(s => {
    // 「認真騎」的判定用每一次成績自己的數字，不是路段平均 ——
    // 同一條路段可能既被拿來當恢復騎、也被拿來全力衝。
    const qualifying = s.efforts.filter(e => {
      const secs = e.moving_sec ?? e.elapsed_sec ?? 0
      if (secs < args.minSec) return false
      if (e.avg_watts == null || e.avg_watts < args.minWatts) return false
      if (!args.allowEstimated && !e.device_watts) return false
      return true
    })
    const dates = s.efforts.map(e => e.date).filter(Boolean).sort()
    const secs = s.efforts.map(e => e.moving_sec ?? e.elapsed_sec).filter(x => x != null)
    return {
      ...s,
      total_efforts: s.efforts.length,
      qualifying_efforts: qualifying.length,
      ride_days: new Set(dates).size,
      first_date: dates[0] || null,
      last_date: dates[dates.length - 1] || null,
      best_sec: secs.length ? Math.min(...secs) : null,
      median_sec: median(secs),
      median_watts: median(s.efforts.map(e => e.avg_watts)),
      device_watts_ratio: s.efforts.length
        ? +(s.efforts.filter(e => e.device_watts).length / s.efforts.length).toFixed(2) : 0,
      qualifies: qualifying.length >= args.minRides,
    }
  })

  segments.sort((a, b) =>
    (b.qualifying_efforts - a.qualifying_efforts) ||
    (b.total_efforts - a.total_efforts) ||
    (b.median_sec || 0) - (a.median_sec || 0))
  return { segments, scanned: files.length }
}

// 中日文字元在終端機佔兩格，String.padEnd 只數字元數，路段名一長表格就歪。
const dispWidth = s => [...String(s)].reduce((w, c) => w + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/.test(c) ? 2 : 1), 0)
const padDisp = (s, width) => {
  let out = ''
  let w = 0
  for (const c of String(s)) {
    const cw = dispWidth(c)
    if (w + cw > width) break
    out += c; w += cw
  }
  return out + ' '.repeat(Math.max(0, width - w))
}

const fmtSec = s => {
  if (s == null) return '—'
  const t = Math.round(s), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), ss = t % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`
}

function report(args) {
  const { segments, scanned } = buildCatalog(args)
  const hit = segments.filter(s => s.qualifies)
  const known = new Set((readJSON(ITT_CONFIG)?.segments || []).map(s => s.id))

  console.log('\n' + '='.repeat(92))
  console.log(`常騎路段探勘　掃過 ${scanned} 趟騎乘，出現過的路段 ${segments.length} 條`)
  console.log(`門檻：單次 ≥ ${args.minSec}s（${fmtSec(args.minSec)}）、平均 ≥ ${args.minWatts}W、` +
              `${args.allowEstimated ? '含估算功率' : '只採功率計實測'}、至少 ${args.minRides} 次`)
  console.log('='.repeat(92))
  if (!hit.length) {
    console.log('  沒有路段通過門檻。試著放寬 --min-sec / --min-watts，或先跑 --phase details。')
  } else {
    console.log('   #  ' + padDisp('路段', 26) + '合格 總數     最佳     中位  中位W     距離  期間')
    hit.forEach((s, i) => {
      const mark = known.has(s.id) ? '★' : ' '   // ★ = 已經在 itt-config.json 裡
      console.log(`  ${String(i + 1).padStart(2)}${mark} ${padDisp(s.name, 26)}` +
        `${String(s.qualifying_efforts).padStart(4)} ${String(s.total_efforts).padStart(4)} ` +
        `${fmtSec(s.best_sec).padStart(8)} ${fmtSec(s.median_sec).padStart(8)} ` +
        `${String(s.median_watts ?? '—').padStart(6)} ${String(s.distance_km ?? '—').padStart(6)}km  ` +
        `${s.first_date} → ${s.last_date}`)
    })
    console.log(`\n  ★ = 已經在 data/itt-config.json 裡（共 ${hit.filter(s => known.has(s.id)).length} 條）`)
    console.log(`  未收錄但通過門檻的有 ${hit.filter(s => !known.has(s.id)).length} 條 —— 這些就是「你常騎但還沒設成 ITT」的路段`)
  }

  ensureDir(ARCHIVE)
  writeJSON(CATALOG, {
    generated_for: { min_sec: args.minSec, min_watts: args.minWatts, min_rides: args.minRides,
                     allow_estimated: args.allowEstimated },
    scanned_activities: scanned,
    segments,
  })
  console.log(`\n📄 完整目錄（含每一筆 effort）寫入 ${path.relative(ROOT, CATALOG)}`)
  return hit
}

// ── Phase 4：入選路段的折線與 metadata ───────────────────────────────────────
// 這是整支腳本最重要的一步。折線 = 自建偵測器的閘門座標，
// 抓到手之後那條路段就永遠能自己計時，不再需要 Strava。
async function phaseSegments(token, args, candidates) {
  console.log('\n── Phase 3 · 路段折線與 metadata ──────────────────')
  ensureDir(SEG_DIR)
  const known = (readJSON(ITT_CONFIG)?.segments || []).map(s => s.id)
  const wanted = [...new Set([...known, ...candidates.map(s => s.id)])]
  const todo = wanted.filter(id => !fs.existsSync(path.join(SEG_DIR, `${id}.json`)))
  console.log(`  目標 ${wanted.length} 條（itt-config ${known.length} + 探勘入選 ${candidates.length}，去重後）`)
  console.log(`  已存檔 ${wanted.length - todo.length} 條，待抓 ${todo.length} 條 → 每條 2 個請求`)
  if (args.dryRun) { console.log(`  [dry-run] 會送出 ${todo.length * 2} 個請求`); return }
  let ok = 0
  for (const id of todo) {
    const meta = await apiGet(token, `/api/v3/segments/${id}`, args)
    if (!meta) { console.log(`  ⚠️  ${id}：拿不到（已刪除或私人），跳過`); continue }
    const streams = await apiGet(token,
      `/api/v3/segments/${id}/streams?keys=latlng,altitude,distance&key_by_type=true`, args)
    writeJSON(path.join(SEG_DIR, `${id}.json`), { meta, streams })
    const pts = streams?.latlng?.data?.length || 0
    ok++
    console.log(`  [${ok}/${todo.length}] ${String(meta.name).slice(0, 24)} → 折線 ${pts} 點（${gov.line()}）`)
    await sleep(150)
  }
  console.log(`✅ 本輪存下 ${ok} 條路段`)
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.report) { report(args); return }

  const token = args.dryRun ? null : await getAccessToken()
  try {
    let index = readJSON(INDEX_FILE) || []
    if (args.phase === 'all' || args.phase === 'index') index = await phaseIndex(token, args)
    if (!index.length) { console.log('⚠️  沒有活動清單，先跑 --phase index'); return }

    if (args.phase === 'all' || args.phase === 'details') await phaseDetails(token, args, index)

    const candidates = report(args)

    if (args.phase === 'all' || args.phase === 'segments') await phaseSegments(token, args, candidates)
  } catch (e) {
    if (e instanceof DailyLimitReached) {
      console.log(`\n⏹️  ${e.message}。已抓到的都存好了，明天（或下一個整刻鐘）重跑同一行指令就會接著跑。`)
      console.log(`   ${gov.line()}・本次送出 ${gov.sent} 個請求`)
      return
    }
    throw e
  }
  console.log(`\n🏁 完成。本次送出 ${gov.sent} 個請求・${gov.line()}`)
  console.log(`   下一步：把想長期計時的路段加進 data/itt-config.json，`)
  console.log(`   再跑 node scripts/merge-harvested-streams.js 把折線併進 data/segment-streams.json。`)
}

main().catch(err => { console.error('❌ 錯誤：', err.message); process.exit(1) })
