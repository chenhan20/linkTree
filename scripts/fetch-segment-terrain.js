#!/usr/bin/env node
/**
 * fetch-segment-terrain.js — 抓 ITT 路段周邊的真實地形高程，存成 data/segment-terrain.json
 *
 * 為什麼是 CI 抓、不是前端抓：
 *   前端永遠只讀 repo 內已 commit 的 JSON（PRODUCT.md 的定位）。地形是靜態資料
 *   （山不會動），抓一次就能一直用，放進 CI 完全符合現有的資料管線模型，
 *   也不會讓頁面在執行期依賴任何第三方服務。
 *
 * 資料來源：AWS Open Data 上的 Tilezen Terrarium 高程圖磚（無需帳號、無需金鑰）
 *   https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
 *   解碼公式：elevation_m = (R * 256 + G + B / 256) - 32768
 *   授權與來源標註：https://github.com/tilezen/joerd/blob/master/docs/attribution.md
 *
 * 零依賴：PNG 解碼用 Node 內建的 zlib 自己做（圖磚固定是 8-bit RGB、非交錯，
 *   所以不需要完整的 PNG 函式庫）。
 *
 * 用法：
 *   node scripts/fetch-segment-terrain.js            # 只補還沒抓過的路段
 *   FORCE=1 node scripts/fetch-segment-terrain.js    # 全部重抓
 *   GRID=128 node scripts/fetch-segment-terrain.js   # 改網格解析度（預設 96）
 */
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const ROOT = path.join(__dirname, '..')
const STREAMS = path.join(ROOT, 'data', 'segment-streams.json')
const OUT = path.join(ROOT, 'data', 'segment-terrain.json')

const GRID = Math.max(32, Math.min(192, parseInt(process.env.GRID, 10) || 96))
const FORCE = process.env.FORCE === '1'
const PAD = 0.18            // bbox 外擴比例：讓路線兩側看得到山坡，而不是切齊路線邊緣
const MAX_TILES = 30        // 單一路段的圖磚上限，超過就降一級 zoom
const TILE = 256

/* ── Web Mercator 圖磚座標 ── */
const lon2tile = (lon, z) => (lon + 180) / 360 * Math.pow(2, z)
const lat2tile = (lat, z) =>
  (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z)

/* ── 最小 PNG 解碼器：8-bit truecolour（colorType 2）、非交錯 ── */
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let off = 8, width = 0, height = 0, bitDepth = 0, colorType = 0
  const idat = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4)
      bitDepth = data[8]; colorType = data[9]
      if (data[12] !== 0) throw new Error('interlaced PNG unsupported')
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`unsupported PNG: depth=${bitDepth} colorType=${colorType}`)
  }
  const bpp = colorType === 2 ? 3 : 4
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * bpp
  const out = Buffer.alloc(height * stride)
  // PNG 逐列濾波器還原（None/Sub/Up/Average/Paeth）
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    const cur = out.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0
      const b = prev ? prev[i] : 0
      const c = (prev && i >= bpp) ? prev[i - bpp] : 0
      let v = src[i]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c)
      } else if (filter !== 0) throw new Error('bad filter ' + filter)
      cur[i] = v & 0xff
    }
  }
  return { width, height, bpp, data: out }
}

function fetchTile(z, x, y, tries = 3) {
  const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`
  return fetch(url).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`)
    return r.arrayBuffer()
  }).then(ab => Buffer.from(ab)).catch(err => {
    if (tries <= 1) throw err
    return new Promise(res => setTimeout(res, 600)).then(() => fetchTile(z, x, y, tries - 1))
  })
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function terrainFor(id, pts) {
  const lats = pts.map(p => p[0]), lngs = pts.map(p => p[1])
  let minLat = Math.min(...lats), maxLat = Math.max(...lats)
  let minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
  // 外擴，並保底一個最小視野（很短的路段不外擴會只剩一條走廊）
  const padLat = Math.max((maxLat - minLat) * PAD, 0.0035)
  const padLng = Math.max((maxLng - minLng) * PAD, 0.0035)
  minLat -= padLat; maxLat += padLat; minLng -= padLng; maxLng += padLng

  // 選 zoom：能塞進 MAX_TILES 的最高解析度（z14 在台北緯度約 8.7 m/px）
  let z = 15, tiles = null
  for (; z >= 10; z--) {
    const x0 = Math.floor(lon2tile(minLng, z)), x1 = Math.floor(lon2tile(maxLng, z))
    const y0 = Math.floor(lat2tile(maxLat, z)), y1 = Math.floor(lat2tile(minLat, z))
    const count = (x1 - x0 + 1) * (y1 - y0 + 1)
    if (count <= MAX_TILES) { tiles = { x0, x1, y0, y1, count }; break }
  }
  if (!tiles) throw new Error('bbox too large for tile budget')

  // 抓 + 解碼整片馬賽克
  const mosaicW = (tiles.x1 - tiles.x0 + 1) * TILE
  const mosaicH = (tiles.y1 - tiles.y0 + 1) * TILE
  const elev = new Float32Array(mosaicW * mosaicH)
  let fetched = 0
  for (let ty = tiles.y0; ty <= tiles.y1; ty++) {
    for (let tx = tiles.x0; tx <= tiles.x1; tx++) {
      const png = decodePNG(await fetchTile(z, tx, ty))
      const ox = (tx - tiles.x0) * TILE, oy = (ty - tiles.y0) * TILE
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const i = (y * png.width + x) * png.bpp
          elev[(oy + y) * mosaicW + (ox + x)] =
            (png.data[i] * 256 + png.data[i + 1] + png.data[i + 2] / 256) - 32768
        }
      }
      fetched++
      await sleep(60)   // 對公開服務客氣一點
    }
  }

  // 從馬賽克雙線性取樣出 GRID×GRID 的規則網格（north→south 逐列，west→east 逐欄）
  const h = new Array(GRID * GRID)
  let lo = Infinity, hi = -Infinity
  for (let gy = 0; gy < GRID; gy++) {
    const lat = maxLat - (maxLat - minLat) * (gy / (GRID - 1))
    const py = (lat2tile(lat, z) - tiles.y0) * TILE
    for (let gx = 0; gx < GRID; gx++) {
      const lng = minLng + (maxLng - minLng) * (gx / (GRID - 1))
      const px = (lon2tile(lng, z) - tiles.x0) * TILE
      const x0 = Math.max(0, Math.min(mosaicW - 1, Math.floor(px)))
      const y0 = Math.max(0, Math.min(mosaicH - 1, Math.floor(py)))
      const x1 = Math.min(mosaicW - 1, x0 + 1), y1 = Math.min(mosaicH - 1, y0 + 1)
      const fx = px - x0, fy = py - y0
      const v = elev[y0 * mosaicW + x0] * (1 - fx) * (1 - fy)
              + elev[y0 * mosaicW + x1] * fx * (1 - fy)
              + elev[y1 * mosaicW + x0] * (1 - fx) * fy
              + elev[y1 * mosaicW + x1] * fx * fy
      const r = Math.round(v * 10) / 10     // 0.1m 精度就夠，小數再多只是撐大檔案
      h[gy * GRID + gx] = r
      if (r < lo) lo = r
      if (r > hi) hi = r
    }
  }
  return {
    n: GRID, z, tiles: tiles.count,
    minLat: +minLat.toFixed(6), maxLat: +maxLat.toFixed(6),
    minLng: +minLng.toFixed(6), maxLng: +maxLng.toFixed(6),
    minElev: lo, maxElev: hi, h,
  }
}

async function main() {
  if (typeof fetch !== 'function') {
    console.error('需要 Node 18+（內建 fetch）'); process.exit(1)
  }
  const streams = JSON.parse(fs.readFileSync(STREAMS, 'utf8'))
  const out = (!FORCE && fs.existsSync(OUT)) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {}
  const ids = Object.keys(streams)
  for (const id of ids) {
    const s = streams[id]
    if (!s || !s.pts || s.pts.length < 2) { console.log(`· ${id} 無 stream，跳過`); continue }
    if (!FORCE && out[id] && out[id].n === GRID) { console.log(`· ${id} ${s.name || ''} 已有資料，跳過`); continue }
    process.stdout.write(`↓ ${id} ${s.name || ''} … `)
    try {
      const t = await terrainFor(id, s.pts)
      t.name = s.name || ''
      out[id] = t
      console.log(`z${t.z} ${t.tiles} 磚 → ${t.n}×${t.n}  高程 ${t.minElev}~${t.maxElev} m`)
    } catch (e) {
      console.log(`失敗：${e.message}`)
    }
  }
  fs.writeFileSync(OUT, JSON.stringify(out))
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0)
  console.log(`\n寫入 ${path.relative(ROOT, OUT)}（${kb} KB，${Object.keys(out).length} 個路段）`)
  console.log('資料來源：Tilezen / AWS Open Data terrain tiles — https://github.com/tilezen/joerd/blob/master/docs/attribution.md')
}
main().catch(e => { console.error(e); process.exit(1) })
