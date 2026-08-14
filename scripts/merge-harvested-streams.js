#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────────
 * merge-harvested-streams.js —— 把 harvest 抓下來的路段折線併進 data/segment-streams.json
 *
 * harvest-strava.js 存的是完整原始 stream（data/strava-archive/segments/<id>.json，
 * 動輒上千點）。自建偵測器與 3D 路線圖吃的是 data/segment-streams.json 的
 * 140 點格式。這支負責轉換與合併，**完全不打 API** —— 所以 Strava 訂閱到期之後，
 * 只要 archive 還在，隨時都能把任何一條已封存的路段接上線。
 *
 * 降採樣邏輯與 scripts/fetch-segment-streams.js 完全一致（140 點、座標 5 位小數、
 * 高程 1 位小數），這樣兩條路徑產出的檔案可以混用而不會有精度落差。
 *
 * 名稱優先序：data/itt-config.json 的 nameZh > Strava 原名。
 * 已存在的路段預設不覆寫（--force 才會），避免手工調過的中文名被英文原名蓋掉。
 *
 * 用法：
 *   node scripts/merge-harvested-streams.js               # 只補缺的
 *   node scripts/merge-harvested-streams.js --dry-run
 *   node scripts/merge-harvested-streams.js --force       # 連已存在的也重算
 *   node scripts/merge-harvested-streams.js --only 641218 1761462
 * ─────────────────────────────────────────────────────────────────────────── */
'use strict'

const fs = require('fs')
const path = require('path')

const ROOT       = path.join(__dirname, '..')
const SEG_DIR    = path.join(ROOT, 'data', 'strava-archive', 'segments')
const OUT_FILE   = path.join(ROOT, 'data', 'segment-streams.json')
const ITT_CONFIG = path.join(ROOT, 'data', 'itt-config.json')

const TARGET_PTS = 140

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const force  = args.includes('--force')
const onlyIx = args.indexOf('--only')
const only   = onlyIx >= 0 ? new Set(args.slice(onlyIx + 1).filter(a => /^\d+$/.test(a))) : null

const readJSON = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch (e) { return null } }

/** 原始 stream → 140 點的 [[lat, lng, alt], ...]（與 fetch-segment-streams.js 同一套）。 */
function downsample(streams) {
  const latlng = streams?.latlng?.data   || []
  const alt    = streams?.altitude?.data || []
  const n = latlng.length
  if (n < 2) return null
  const step = n <= TARGET_PTS ? 1 : (n - 1) / (TARGET_PTS - 1)
  const indices = n <= TARGET_PTS
    ? Array.from({ length: n }, (_, i) => i)
    : Array.from({ length: TARGET_PTS }, (_, i) => Math.round(i * step))
  return indices.map(i => [
    Math.round(latlng[i][0] * 1e5) / 1e5,
    Math.round(latlng[i][1] * 1e5) / 1e5,
    alt[i] != null ? Math.round(alt[i] * 10) / 10 : null,
  ])
}

function main() {
  if (!fs.existsSync(SEG_DIR)) {
    console.error(`❌ 找不到 ${path.relative(ROOT, SEG_DIR)}，先跑 node scripts/harvest-strava.js`)
    process.exit(1)
  }
  const nameZh = new Map((readJSON(ITT_CONFIG)?.segments || []).map(s => [String(s.id), s.nameZh]))
  const existing = readJSON(OUT_FILE) || {}

  const files = fs.readdirSync(SEG_DIR).filter(f => f.endsWith('.json'))
  let added = 0, updated = 0, skipped = 0, bad = 0
  for (const f of files) {
    const id = f.replace(/\.json$/, '')
    if (only && !only.has(id)) continue
    if (existing[id] && !force) { skipped++; continue }

    const rec = readJSON(path.join(SEG_DIR, f))
    const pts = downsample(rec?.streams)
    if (!pts) { console.log(`  ⚠️  ${id}：archive 裡沒有可用的折線，跳過`); bad++; continue }

    const name = nameZh.get(id) || rec?.meta?.name || id
    const was = existing[id]
    existing[id] = { name, pts }
    if (was) { updated++; console.log(`  ~ ${id} ${name}：${was.pts?.length ?? 0} → ${pts.length} 點`) }
    else     { added++;   console.log(`  + ${id} ${name}：${pts.length} 點`) }
  }

  console.log(`\n新增 ${added}、更新 ${updated}、已存在略過 ${skipped}、無折線 ${bad}` +
              `，合併後共 ${Object.keys(existing).length} 條`)
  if (dryRun) { console.log('[dry-run] 未寫檔。'); return }
  if (!added && !updated) { console.log('沒有變更，不寫檔。'); return }
  // 與 fetch-segment-streams.js 一致：不縮排（這個檔是給程式讀的，而且會進 git）
  fs.writeFileSync(OUT_FILE, JSON.stringify(existing), 'utf8')
  console.log(`✅ 寫入 ${path.relative(ROOT, OUT_FILE)}`)
  console.log('   接著可以跑：python3 scripts/backfill-itt-efforts.py --dry-run')
}

main()
