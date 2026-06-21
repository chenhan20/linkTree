// scripts/screenshot-ride.js
// 自動截圖最新公路車活動詳情 modal → 發送到 Telegram
//
// 環境變數（放在 scripts/.env 或 GitHub Secrets）：
//   TG_BOT_TOKEN  — Telegram Bot Token
//   TG_CHAT_ID    — 你的 Telegram Chat ID（個人 ID 或群組 ID）
//
// 用法：
//   node scripts/screenshot-ride.js          ← 自動找最新活動
//   node scripts/screenshot-ride.js <id>     ← 指定特定活動 ID
//   node scripts/screenshot-ride.js --force  ← 忽略「已發送」記錄，強制重發

'use strict'

const fs   = require('fs')
const path = require('path')
const os   = require('os')
const https = require('https')

// ── 讀取 .env（本機模式）──
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

const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN
const TG_CHAT_ID   = process.env.TG_CHAT_ID

const STRAVA_JSON  = path.join(__dirname, '..', 'data', 'strava.json')
const ITT_FILE     = path.join(__dirname, '..', 'data', 'itt-segments.json')
const SENT_FILE    = path.join(__dirname, '..', 'data', 'screenshot-sent.json')
const MODAL_CSS    = path.join(__dirname, '..', 'activity-modal.css')

// ── 引數解析 ──
const args  = process.argv.slice(2)
const force = args.includes('--force')
const targetId = args.find(a => /^\d+$/.test(a)) || null

// ── 工具：fmtDuration ──
function fmtDuration(sec) {
  if (!sec && sec !== 0) return '—'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h) return `${h} 小時 ${m} 分`
  if (m) return `${m} 分 ${s} 秒`
  return `${s} 秒`
}

// ── HTML 生成：完整詳情 panel ──
// 所有渲染函式都在這個字串裡（會嵌入 HTML <script> 內執行）
const RENDER_FUNCTIONS = /* js */`
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

  function fmtDuration(sec) {
    if (!sec && sec !== 0) return '—'
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = sec % 60
    if (h) return h + ' 小時 ' + m + ' 分'
    if (m) return m + ' 分 ' + s + ' 秒'
    return s + ' 秒'
  }

  function cell(lbl, val, unit, mod) {
    if (val == null || val === '' || (typeof val === 'number' && !isFinite(val))) return ''
    return '<div class="am-cell ' + (mod || '') + '"><div class="lbl">' + esc(lbl) + '</div><div class="val">' + esc(val) + (unit ? '<small>' + esc(unit) + '</small>' : '') + '</div></div>'
  }

  function decodePolyline(str, precision) {
    if (!str) return []
    let index = 0, lat = 0, lng = 0, byte, shift, result
    const coords = [], factor = Math.pow(10, precision || 5)
    while (index < str.length) {
      shift = 0; result = 0
      do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5 } while (byte >= 0x20)
      lat += (result & 1) ? ~(result >> 1) : (result >> 1)
      shift = 0; result = 0
      do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5 } while (byte >= 0x20)
      lng += (result & 1) ? ~(result >> 1) : (result >> 1)
      coords.push([lat / factor, lng / factor])
    }
    return coords
  }

  // 靜態版 routeSvg（所有線條和節點直接可見，不需 JS 動畫）
  function routeSvgStatic(stream) {
    const SZ = 300, PAD = 28
    const meanLat = stream.reduce((s, p) => s + p[0], 0) / stream.length
    const k = Math.cos(meanLat * Math.PI / 180) || 1
    const proj = stream.map(p => [p[1] * k, -p[0]])
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const [x, y] of proj) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y }
    const w = (maxX - minX) || 1, h = (maxY - minY) || 1
    const scale = Math.min((SZ - PAD * 2) / w, (SZ - PAD * 2) / h)
    const ox = (SZ - w * scale) / 2, oy = (SZ - h * scale) / 2
    const X = x => (x - minX) * scale + ox, Y = y => (y - minY) * scale + oy
    const nodes = proj.map(([x, y], i) => ({
      x: +X(x).toFixed(1), y: +Y(y).toFixed(1), hr: stream[i][2], kmh: stream[i][3]
    }))
    function zoneColor(hr) {
      if (hr == null) return '#7d96ff'
      if (hr < 120) return '#6688cc'
      if (hr < 140) return '#19d76b'
      if (hr < 160) return '#f5c518'
      if (hr < 180) return '#ff8c00'
      return '#ff3b30'
    }
    let ambient = ''
    const seed = stream.length
    for (let i = 0; i < 18; i++) {
      const cx = ((seed * (i + 1) * 73 % 997) / 997 * SZ).toFixed(1)
      const cy = ((seed * (i + 2) * 137 % 997) / 997 * SZ).toFixed(1)
      const r = (0.2 + (seed * i * 41 % 100) / 100 * 0.9).toFixed(2)
      const op = (0.06 + (seed * i * 53 % 100) / 100 * 0.22).toFixed(2)
      ambient += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="#9fb4ff" opacity="' + op + '"/>'
    }
    let links = '', stars = ''
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]
      if (i > 0) {
        const p = nodes[i - 1]
        const avgHR = (n.hr != null && p.hr != null) ? (n.hr + p.hr) / 2 : (n.hr != null ? n.hr : p.hr)
        links += '<line x1="' + p.x + '" y1="' + p.y + '" x2="' + n.x + '" y2="' + n.y + '" stroke="' + zoneColor(avgHR) + '" stroke-width="1.2" opacity="0.65"/>'
      }
      const isStart = i === 0, isEnd = i === nodes.length - 1
      const hub = i % 8 === 0
      const rr = (isStart || isEnd) ? 4 : (hub ? 2.8 : 1.8)
      const fill = isStart ? '#19d76b' : isEnd ? '#ff3b30' : zoneColor(n.hr)
      stars += '<circle cx="' + n.x + '" cy="' + n.y + '" r="' + rr + '" fill="' + fill + '" filter="url(#amStarGlow)"/>'
    }
    return '<svg viewBox="0 0 ' + SZ + ' ' + SZ + '" class="am-route-svg" preserveAspectRatio="xMidYMid meet" aria-label="GPS 路線">' +
      '<defs><filter id="amStarGlow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="1.8"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>' +
      ambient +
      '<g>' + links + '</g>' +
      '<g>' + stars + '</g>' +
    '</svg>'
  }

  // 靜態版 legacy polyline SVG
  function routeSvgLegacyStatic(pts) {
    const SZ = 300, PAD = 30
    const meanLat = pts.reduce((s, p) => s + p[0], 0) / pts.length
    const k = Math.cos(meanLat * Math.PI / 180) || 1
    const proj = pts.map(p => [p[1] * k, -p[0]])
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const [x, y] of proj) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y }
    const w = (maxX - minX) || 1, h = (maxY - minY) || 1
    const scale = Math.min((SZ - PAD * 2) / w, (SZ - PAD * 2) / h)
    const ox = (SZ - w * scale) / 2, oy = (SZ - h * scale) / 2
    const X = x => (x - minX) * scale + ox, Y = y => (y - minY) * scale + oy
    const screen = proj.map(([x, y]) => ({ x: X(x), y: Y(y) }))
    const step = Math.max(1, Math.floor(screen.length / 44))
    const nodes = screen.filter((_, i) => i % step === 0)
    if (nodes[nodes.length - 1] !== screen[screen.length - 1]) nodes.push(screen[screen.length - 1])
    let polyline = ''
    polyline = nodes.map(n => n.x.toFixed(1) + ',' + n.y.toFixed(1)).join(' ')
    let stars = ''
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]
      const isStart = i === 0, isEnd = i === nodes.length - 1
      const fill = isStart ? '#19d76b' : isEnd ? '#ff3b30' : '#dbe4ff'
      const rr = isStart || isEnd ? 4 : 1.9
      stars += '<circle cx="' + n.x.toFixed(1) + '" cy="' + n.y.toFixed(1) + '" r="' + rr + '" fill="' + fill + '" filter="url(#amStarGlow)"/>'
    }
    return '<svg viewBox="0 0 ' + SZ + ' ' + SZ + '" class="am-route-svg" preserveAspectRatio="xMidYMid meet">' +
      '<defs><filter id="amStarGlow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="1.8"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>' +
      '<polyline points="' + polyline + '" fill="none" stroke="#7d96ff" stroke-width="1.2" opacity="0.7" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<g>' + stars + '</g>' +
    '</svg>'
  }

  // 靜態版 Gauge（顯示 avgHR）
  function buildGaugeSvgStatic(avgHR) {
    const cx = 90, cy = 90, R = 68
    const startD = 240, totalD = 240
    function pt(deg) {
      const rad = (deg - 90) * Math.PI / 180
      return [+(cx + R * Math.cos(rad)).toFixed(2), +(cy + R * Math.sin(rad)).toFixed(2)]
    }
    function arcPath(d1, d2) {
      const [sx, sy] = pt(d1), [ex, ey] = pt(d2)
      const large = (d2 - d1) > 180 ? 1 : 0
      return 'M' + sx + ' ' + sy + ' A' + R + ' ' + R + ' 0 ' + large + ' 1 ' + ex + ' ' + ey
    }
    function hrDeg(hr) { return startD + (Math.min(Math.max(hr, 0), 200) / 200) * totalD }
    const track = '<path d="' + arcPath(startD, startD + totalD) + '" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="10" stroke-linecap="round"/>'
    const zones = [
      [0,   119, 'rgba(80,110,220,.65)'],
      [121, 139, '#19d76b'],
      [141, 159, '#f5c518'],
      [161, 179, '#ff8c00'],
      [181, 200, '#ff3b30'],
    ]
    const zoneArcs = zones.map(([h1, h2, col]) =>
      '<path d="' + arcPath(hrDeg(h1), hrDeg(h2)) + '" fill="none" stroke="' + col + '" stroke-width="10" stroke-linecap="butt" opacity=".8"/>'
    ).join('')
    let ticks = ''
    for (let hr = 0; hr <= 200; hr += 20) {
      const d = hrDeg(hr), innerR = hr % 40 === 0 ? R - 16 : R - 12
      const [ox1, oy1] = pt(d)
      const rad = (d - 90) * Math.PI / 180
      const ox2 = +(cx + innerR * Math.cos(rad)).toFixed(2), oy2 = +(cy + innerR * Math.sin(rad)).toFixed(2)
      ticks += '<line x1="' + ox1 + '" y1="' + oy1 + '" x2="' + ox2 + '" y2="' + oy2 + '" stroke="rgba(255,255,255,.25)" stroke-width="' + (hr % 40 === 0 ? 1.5 : 1) + '"/>'
    }
    const needleAngle = avgHR ? hrDeg(avgHR) : startD
    const needle = '<line x1="' + cx + '" y1="' + (cy + 6) + '" x2="' + cx + '" y2="' + (cy - R + 10) + '" stroke="white" stroke-width="2.5" stroke-linecap="round" style="transform-box:view-box;transform-origin:' + cx + 'px ' + cy + 'px;transform:rotate(' + needleAngle.toFixed(1) + 'deg)"/>'
    const z = !avgHR ? '—' : (avgHR < 120 ? 'Z1' : avgHR < 140 ? 'Z2' : avgHR < 160 ? 'Z3' : avgHR < 180 ? 'Z4' : 'Z5')
    const spd = window._activity ? (window._activity.avg_speed_kmh != null ? window._activity.avg_speed_kmh.toFixed(1) : '—') : '—'
    return '<div class="am-gauge-wrap">' +
      '<svg class="am-gauge-svg" viewBox="0 0 180 145" aria-hidden="true">' +
        '<defs><filter id="amNdGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>' +
        track + zoneArcs + ticks +
        '<g filter="url(#amNdGlow)">' + needle + '</g>' +
        '<circle cx="' + cx + '" cy="' + cy + '" r="5" fill="rgba(255,255,255,.35)"/>' +
        '<text x="' + cx + '" y="' + (cy + 30) + '" class="am-gauge-val" text-anchor="middle">' + (avgHR || '—') + '</text>' +
        '<text x="' + cx + '" y="' + (cy + 43) + '" class="am-gauge-unit" text-anchor="middle">bpm</text>' +
      '</svg>' +
      '<div class="am-gauge-live-row">' +
        '<span class="am-gauge-zone-lbl am-gz-' + z.toLowerCase() + '">' + z + '</span>' +
        '<span class="am-gauge-spd"><span class="am-gauge-spd-val">' + spd + '</span><small> km/h</small></span>' +
      '</div>' +
    '</div>'
  }

  function routeBlock(a) {
    const stat = (v, u, l) => v == null || v === '' ? '' :
      '<div class="am-rs"><div class="v">' + esc(v) + (u ? '<small>' + esc(u) + '</small>' : '') + '</div><div class="l">' + esc(l) + '</div></div>'

    if (a.route_stream && a.route_stream.length >= 2) {
      const hasHR = a.route_stream.some(p => p[2] != null)
      window._activity = a
      return '<div class="am-route">' +
        '<div class="am-route-left">' +
          '<div class="am-route-canvas">' + routeSvgStatic(a.route_stream) + '</div>' +
          '<div class="am-route-footer"><span class="am-route-brand">★ RIDE CONSTELLATION</span></div>' +
        '</div>' +
        '<div class="am-route-right">' +
          (hasHR ? buildGaugeSvgStatic(a.avg_heartrate) : '') +
          '<div class="am-route-stats">' +
            stat(a.distance_km, 'km', '距離') +
            stat(a.elevation_m, 'm', '爬升') +
            stat(fmtDuration(a.moving_time_sec), '', '時間') +
          '</div>' +
        '</div>' +
      '</div>'
    }

    if (a.polyline) {
      const pts = decodePolyline(a.polyline)
      if (pts.length < 2) return ''
      return '<div class="am-route">' +
        '<div class="am-route-canvas">' + routeSvgLegacyStatic(pts) + '</div>' +
        '<div class="am-route-stats">' +
          stat(a.distance_km, 'km', '距離') +
          stat(a.elevation_m, 'm', '爬升') +
          stat(fmtDuration(a.moving_time_sec), '', '時間') +
        '</div>' +
        '<div class="am-route-brand">★ RIDE CONSTELLATION</div>' +
      '</div>'
    }
    return ''
  }

  function renderRide(a, ittByDate) {
    const date = (a.date || '').slice(5).replace('-', '/')
    const dur = fmtDuration(a.moving_time_sec)
    const isIndoor = !!a.trainer
    const tag = isIndoor ? '🏠 室內' : '🚴 公路車'
    const stravaUrl = 'https://www.strava.com/activities/' + a.id

    const sub = [
      date ? '<span>📅 ' + esc(date) + '</span>' : '',
      a.time ? '<span>· ' + esc(a.time) + '</span>' : '',
      a.distance_km ? '<span>· <b>' + esc(a.distance_km) + '</b>km</span>' : '',
      '<span>· ' + esc(dur) + '</span>',
    ].filter(Boolean).join(' ')

    const metrics = [
      cell('最大功率', a.max_watts, 'W', 'accent'),
      cell('NP 平均功率', a.np_watts, 'W', 'accent'),
      cell('IF 強度因子', a.if_score, '', 'accent'),
      cell('TSS 訓練負荷', a.tss, '', 'accent'),
      cell('平均功率', a.avg_watts, 'W'),
      cell('平均踏頻', a.avg_cadence_rpm, 'rpm'),
      cell('平均心率', a.avg_heartrate, 'bpm', 'hr'),
      cell('最大心率', a.max_heartrate, 'bpm', 'hr'),
      cell('平均速度', a.avg_speed_kmh, 'km/h'),
      cell('累積爬升', a.elevation_m, 'm'),
      cell('總卡路里', a.calories_kcal, 'kcal'),
    ].filter(Boolean).join('')

    const laps = (a.top_laps || []).slice(0, 10)
    const lapsHtml = laps.length ? '<div class="am-section"><h4 class="am-section-h">分段摘要 · Top ' + laps.length + '</h4><div class="am-laps">' +
      laps.map(l =>
        '<div class="am-lap">' +
        '<span class="am-lap-name">🏁 ' + esc(l.name || '—') + '</span>' +
        (l.moving_time_str ? '<span class="am-lap-tag">⏱ ' + esc(l.moving_time_str) + '</span>' : '') +
        (l.average_heartrate ? '<span class="am-lap-tag hr">♥️ ' + esc(l.average_heartrate) + ' bpm</span>' : '') +
        (l.average_watts ? '<span class="am-lap-tag w">⚡ ' + esc(l.average_watts) + ' W</span>' : '') +
        '</div>'
      ).join('') +
    '</div></div>' : ''

    const itts = (ittByDate && ittByDate[a.date]) ? ittByDate[a.date] : []
    const ittHtml = itts.length ? '<div class="am-section"><h4 class="am-section-h">ITT 計時段</h4><div class="am-itt">' +
      itts.map(it =>
        '<div class="am-itt-item ' + (it.is_pr ? 'pr' : '') + '">' +
        '<div class="am-itt-crown">' + (it.is_pr ? '👑' : '🏁') + '</div>' +
        '<div class="am-itt-info"><div class="am-itt-seg">' + esc(it.segName) + '</div>' +
        '<div class="am-itt-meta">第 ' + esc(it.attemptNum) + ' / ' + esc(it.total) + ' 次' + (it.rank ? ' · 第 ' + esc(it.rank) + ' 名' : '') + (it.is_pr ? ' · 🏆 PR' : '') + '</div></div>' +
        '<div class="am-itt-time">' + esc(it.elapsed_str || '') + '</div>' +
        '</div>'
      ).join('') +
    '</div></div>' : ''

    const desc = a.description ? '<div class="am-section"><h4 class="am-section-h">活動筆記</h4><div class="am-desc">' + esc(a.description) + '</div></div>' : ''

    return '<div class="am-head">' +
      '<div class="am-icon">🚴</div>' +
      '<div class="am-title-wrap">' +
        '<div><span class="am-tag">' + esc(tag) + '</span><span class="am-name" id="am-name">' + esc(a.name || '—') + '</span></div>' +
        '<div class="am-sub">' + sub + '</div>' +
      '</div>' +
      '<a class="am-strava" href="' + esc(stravaUrl) + '" target="_blank" rel="noopener">Strava ↗</a>' +
    '</div>' +
    '<div class="am-body">' +
      routeBlock(a) +
      '<div class="am-section"><h4 class="am-section-h">關鍵指標</h4><div class="am-grid">' + (metrics || '<div class="am-empty">沒有可顯示的指標</div>') + '</div></div>' +
      lapsHtml +
      ittHtml +
      desc +
    '</div>'
  }
`

// ── 建立截圖用獨立 HTML ──
function buildHtml(activity, ittByDate, css) {
  const actJson    = JSON.stringify(activity)
  const ittJson    = JSON.stringify(ittByDate)
  const dur        = fmtDuration(activity.moving_time_sec)
  const date       = (activity.date || '').slice(5).replace('-', '/')
  const caption    = `${activity.name || '—'} · ${date} · ${activity.distance_km ?? '—'}km · ${dur}`

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${caption}</title>
  <style>
    *, *::before, *::after {
      margin: 0; padding: 0; box-sizing: border-box;
      /* 截圖不需要動畫 */
      animation-duration: 0.001ms !important;
      animation-delay: 0ms !important;
      transition-duration: 0.001ms !important;
    }
    body {
      background: #0a0604;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      padding: 0;
    }
    /* 讓 panel 展開到全高（移除 max-height 限制） */
    .am-panel {
      max-height: none !important;
      overflow: visible !important;
      width: 920px !important;
      border-radius: 0 !important;
    }
    .am-overlay.open .am-panel {
      transform: none !important;
    }
    /* ── activity-modal.css ── */
    ${css}
  </style>
</head>
<body>
  <div class="am-panel" id="panel"></div>

  <script>
    window._activity = null;
    ${RENDER_FUNCTIONS}

    const activity  = ${actJson};
    const ittByDate = ${ittJson};

    document.getElementById('panel').innerHTML = renderRide(activity, ittByDate);
  </script>
</body>
</html>`
}

// ── Telegram：傳圖 ──
function tgSendPhoto(imgBuffer, caption) {
  return new Promise((resolve, reject) => {
    if (!TG_BOT_TOKEN || !TG_CHAT_ID) {
      console.warn('⚠️  TG_BOT_TOKEN 或 TG_CHAT_ID 未設定，略過發送')
      return resolve(null)
    }

    const boundary = '----TGFormBoundary' + Date.now()
    const capBuf   = Buffer.from(caption, 'utf8')
    const cidBuf   = Buffer.from(String(TG_CHAT_ID), 'utf8')
    const fname    = 'ride.png'

    // 手動組裝 multipart/form-data
    const parts = [
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n`),
      cidBuf,
      Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n`),
      capBuf,
      Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="${fname}"\r\nContent-Type: image/png\r\n\r\n`),
      imgBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]
    const body = Buffer.concat(parts)

    const options = {
      hostname: 'api.telegram.org',
      path:     `/bot${TG_BOT_TOKEN}/sendPhoto`,
      method:   'POST',
      headers:  {
        'Content-Type':   `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    }

    const req = https.request(options, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const txt = Buffer.concat(chunks).toString('utf8')
        try {
          const json = JSON.parse(txt)
          if (json.ok) { console.log('✅ Telegram 已送出圖片'); resolve(json) }
          else { reject(new Error('Telegram API error: ' + txt)) }
        } catch { reject(new Error('Telegram response parse error: ' + txt)) }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// ── 主流程 ──
async function main() {
  // 1. 讀取資料
  const stravaData = JSON.parse(fs.readFileSync(STRAVA_JSON, 'utf8'))
  const ittData    = fs.existsSync(ITT_FILE) ? JSON.parse(fs.readFileSync(ITT_FILE, 'utf8')) : []
  const css        = fs.readFileSync(MODAL_CSS, 'utf8')

  // 2. 找最新戶外公路車活動
  const rides = (stravaData.recent_rides || []).filter(r =>
    !r.trainer && ['Ride', 'GravelRide', 'MountainBikeRide'].includes(r.sport_type)
  )
  if (!rides.length) { console.log('沒有公路車活動，略過'); return }

  let activity
  if (targetId) {
    activity = rides.find(r => String(r.id) === targetId)
    if (!activity) { console.error(`找不到活動 ID: ${targetId}`); process.exit(1) }
  } else {
    activity = rides[0]
  }

  // 3. 檢查是否已發送（避免重複）
  if (!force && !targetId) {
    const sentData = fs.existsSync(SENT_FILE) ? JSON.parse(fs.readFileSync(SENT_FILE, 'utf8')) : {}
    if (String(sentData.lastId) === String(activity.id)) {
      console.log(`⏭️  活動 ${activity.id}（${activity.name}）已發送過，略過`)
      console.log('   使用 --force 強制重發')
      return
    }
  }

  console.log(`🚴 截圖活動：${activity.name} (${activity.id}) · ${activity.date}`)

  // 4. 建立 ITT 對照表（依日期）
  const ittByDate = {}
  ittData.forEach(seg => {
    (seg.efforts || []).forEach(ef => {
      const date = (ef.start_date_local || '').slice(0, 10)
      if (!date) return
      ;(ittByDate[date] = ittByDate[date] || []).push({
        segName: seg.name,
        elapsed_str: ef.elapsed_str,
        attemptNum: ef.attemptNum,
        total: seg.efforts.length,
        rank: ef.rank,
        is_pr: ef.is_pr,
        activity_id: ef.activity_id,
      })
    })
  })

  // 5. 建立 HTML，寫入暫存檔
  const html    = buildHtml(activity, ittByDate, css)
  const tmpHtml = path.join(os.tmpdir(), `ride-${activity.id}.html`)
  fs.writeFileSync(tmpHtml, html, 'utf8')
  console.log(`📄 暫存 HTML：${tmpHtml}`)

  // 6. Puppeteer 截圖
  let puppeteer
  try {
    puppeteer = require('puppeteer')
  } catch {
    console.error('❌ 找不到 puppeteer，請先執行 npm install')
    process.exit(1)
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })

  let imgBuffer
  const allScreenshots = []  // 收集所有截圖 buffer（單張或兩張）
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 980, height: 1200, deviceScaleFactor: 2 })

    await page.goto(`file://${tmpHtml}`, { waitUntil: 'networkidle0' })

    // 等待面板渲染完成
    await page.waitForSelector('.am-panel .am-head')

    // 取得 panel 完整高度，判斷是否要分兩張
    const panelHandle = await page.$('.am-panel')
    const box = await panelHandle.boundingBox()
    console.log(`📐 Panel 尺寸：${Math.round(box.width)} × ${Math.round(box.height)} px`)

    const MAX_SINGLE = 1600  // px（邏輯，2x 後實際為 3200px）

    if (box.height <= MAX_SINGLE) {
      // 單張截圖
      imgBuffer = await panelHandle.screenshot({ type: 'png' })
      allScreenshots.push(imgBuffer)
      console.log(`📸 單張截圖 (${imgBuffer.length} bytes)`)
      await tgSendRidePhoto(imgBuffer, activity, '詳情截圖', false)
    } else {
      // 分兩張：上半 + 下半
      console.log(`📸 Panel 較高 (${Math.round(box.height)}px)，分為上下兩張`)

      // 確保頁面夠高
      await page.setViewport({ width: 980, height: Math.ceil(box.height) + 40, deviceScaleFactor: 2 })
      await page.goto(`file://${tmpHtml}`, { waitUntil: 'networkidle0' })
      await page.waitForSelector('.am-panel .am-head')

      const splitY = Math.floor(box.height * 0.52)  // 52% 為分割點

      const imgTop = await page.screenshot({
        type: 'png',
        clip: { x: box.x, y: box.y, width: box.width, height: splitY },
      })
      const imgBot = await page.screenshot({
        type: 'png',
        clip: { x: box.x, y: box.y + splitY, width: box.width, height: box.height - splitY },
      })
      console.log(`📸 上半 (${imgTop.length} bytes) + 下半 (${imgBot.length} bytes)`)
      allScreenshots.push(imgTop, imgBot)
      imgBuffer = imgTop  // 儲存第一張供 SAVE_PREVIEW
      await tgSendRidePhoto(imgTop, activity, '詳情截圖 (1/2)', false)
      await tgSendRidePhoto(imgBot, activity, '詳情截圖 (2/2)', true)
    }
  } finally {
    await browser.close()
    // 清理暫存 HTML
    try { fs.unlinkSync(tmpHtml) } catch {}
  }

  // 7. 如果有設定 SAVE_PREVIEW，把所有截圖存到本機路徑（本機測試用）
  const savePreview = process.env.SAVE_PREVIEW
  if (savePreview && allScreenshots.length > 0) {
    allScreenshots.forEach((buf, i) => {
      const outPath = allScreenshots.length === 1
        ? savePreview
        : savePreview.replace(/\.png$/, '') + `-${i + 1}.png`
      fs.writeFileSync(outPath, buf)
      console.log(`💾 預覽圖已存至：${outPath}`)
    })
  }

  // 8. 記錄已發送 ID
  fs.writeFileSync(SENT_FILE, JSON.stringify({ lastId: String(activity.id), sentAt: new Date().toISOString() }), 'utf8')
  console.log(`✅ 完成！已記錄 lastId = ${activity.id}`)
}

// ── 組 Telegram caption + 發送 ──
async function tgSendRidePhoto(imgBuffer, activity, suffix, isContinuation) {
  const dur    = fmtDuration(activity.moving_time_sec)
  const date   = (activity.date || '').slice(5).replace('-', '/')
  let caption
  if (isContinuation) {
    caption = `${activity.name} — ${suffix}`
  } else {
    caption = [
      `🚴 ${activity.name}`,
      `📅 ${date}  ⏱ ${dur}`,
      activity.distance_km ? `📏 ${activity.distance_km} km` : '',
      activity.elevation_m ? `⛰ ${activity.elevation_m} m` : '',
      activity.np_watts    ? `⚡ NP ${activity.np_watts}W  TSS ${activity.tss || '—'}` : '',
      activity.avg_heartrate ? `❤️ avg ${activity.avg_heartrate} / max ${activity.max_heartrate || '—'} bpm` : '',
      `🔗 https://www.strava.com/activities/${activity.id}`,
      suffix !== '詳情截圖' ? suffix : '',
    ].filter(Boolean).join('\n')
  }
  await tgSendPhoto(imgBuffer, caption)
}

main().catch(err => {
  console.error('❌ 截圖失敗：', err)
  process.exit(1)
})
