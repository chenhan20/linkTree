/* activity-modal.js — 跨主題共用：單車活動詳情彈窗
 * 用法：在 <body> 結束前 <script src="activity-modal.js" defer></script>
 * 自動：
 *  1. fetch strava.json（瀏覽器已快取，幾乎零成本）建立活動 lookup map
 *  2. 監聽 DOM 變化，為每張包含 .act-strava-link 的「單車卡片」注入「詳情 ▾」按鈕
 *  3. 點擊按鈕開啟詳情彈窗，僅顯示 strava.json 已有資料（不額外打 API）
 */
(function () {
  'use strict'

  const STRAVA_JSON = 'data/strava.json'
  const ICON_RIDE = '🚴'
  let dataPromise = null
  let rideMap = null
  let ittByDate = null
  let _routeStream = null   // 目前彈窗的 route_stream（供動畫 + 重播）
  let _animTimer    = null   // JS 逐點動畫計時器

  function loadData() {
    if (dataPromise) return dataPromise
    dataPromise = fetch(STRAVA_JSON, { cache: 'force-cache' })
      .then(r => r.json())
      .then(d => {
        rideMap = new Map()
        ;(d.recent_rides || []).forEach(r => { if (r.id) rideMap.set(String(r.id), r) })
        // 建立 ITT 對照（依日期）
        ittByDate = {}
        ;(d.itt_segments || []).forEach(seg => {
          ;(seg.efforts || []).forEach(ef => {
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
        return d
      })
      .catch(err => { console.warn('[activity-modal] load strava.json failed', err); return null })
    return dataPromise
  }

  /* ── DOM：彈窗骨架 ── */
  function ensureModal() {
    let el = document.getElementById('am-overlay')
    if (el) return el
    el = document.createElement('div')
    el.id = 'am-overlay'
    el.className = 'am-overlay'
    el.innerHTML = `<div class="am-panel" role="dialog" aria-modal="true" aria-labelledby="am-name"></div>`
    document.body.appendChild(el)
    el.addEventListener('click', e => { if (e.target === el) closeModal() })
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal() })
    return el
  }
  function openModal(html) {
    const el = ensureModal()
    el.querySelector('.am-panel').innerHTML = html
    el.classList.add('open')
    document.body.style.overflow = 'hidden'
    if (_animTimer) { clearTimeout(_animTimer); _animTimer = null }
    if (_routeStream) startRouteAnim()
  }
  function closeModal() {
    const el = document.getElementById('am-overlay')
    if (el) el.classList.remove('open')
    document.body.style.overflow = ''
    if (_animTimer) { clearTimeout(_animTimer); _animTimer = null }
    _routeStream = null
  }
  window.closeActivityModal = closeModal

  /* ── 工具 ── */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  function fmtDuration(sec) {
    if (!sec && sec !== 0) return '—'
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = sec % 60
    if (h) return `${h} 小時 ${m} 分`
    if (m) return `${m} 分 ${s} 秒`
    return `${s} 秒`
  }
  function cell(lbl, val, unit, mod) {
    if (val == null || val === '' || (typeof val === 'number' && !isFinite(val))) return ''
    return `<div class="am-cell ${mod || ''}"><div class="lbl">${esc(lbl)}</div><div class="val">${esc(val)}${unit ? `<small>${esc(unit)}</small>` : ''}</div></div>`
  }

  /* ── 路線剪影：解碼 Strava encoded polyline → SVG（無依賴、零額外 API） ── */
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
  function routeSvgLegacy(pts) {
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
    const targetN = 44
    const step = Math.max(1, Math.floor(screen.length / targetN))
    const nodes = screen.filter((_, i) => i % step === 0)
    if (nodes[nodes.length - 1] !== screen[screen.length - 1]) nodes.push(screen[screen.length - 1])
    const STAGGER = 0.085
    let ambient = ''
    for (let i = 0; i < 26; i++) {
      const cx = (Math.random() * SZ).toFixed(1), cy = (Math.random() * SZ).toFixed(1)
      const r = (Math.random() * 0.9 + 0.2).toFixed(2), op = (Math.random() * 0.35 + 0.08).toFixed(2)
      ambient += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#9fb4ff" opacity="${op}"/>`
    }
    let links = '', stars = ''
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i], d = (i * STAGGER).toFixed(2)
      if (i > 0) {
        const p = nodes[i - 1]
        const len = Math.hypot(n.x - p.x, n.y - p.y).toFixed(1)
        links += `<line x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${n.x.toFixed(1)}" y2="${n.y.toFixed(1)}" class="am-link" style="stroke-dasharray:${len};stroke-dashoffset:${len};animation-delay:${d}s"/>`
      }
      const isStart = i === 0, isEnd = i === nodes.length - 1
      const hub = i % 7 === 0
      const rr = isStart || isEnd ? 4 : (hub ? 3 : 1.9)
      const fill = isStart ? '#19d76b' : isEnd ? '#ff3b30' : '#dbe4ff'
      const tw = (2 + Math.random() * 1.6).toFixed(2)
      const twDelay = (-Math.random() * 3).toFixed(2)
      stars += `<g class="am-star" style="animation-delay:${d}s"><circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${rr}" fill="${fill}" filter="url(#amStarGlow)" style="animation-duration:${tw}s;animation-delay:${twDelay}s"/></g>`
    }
    return `<svg viewBox="0 0 ${SZ} ${SZ}" class="am-route-svg" preserveAspectRatio="xMidYMid meet" aria-label="GPS 路線星座">
      <defs><filter id="amStarGlow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="1.8"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
      ${ambient}
      <g class="am-links">${links}</g>
      <g class="am-stars">${stars}</g>
    </svg>`
  }

  // ── 新版：route_stream 渲染（JS 驅動逐點動畫，心率漸層路線）──
  function routeSvg(stream) {
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
    for (let i = 0; i < 18; i++) {
      const cx = (Math.random() * SZ).toFixed(1), cy = (Math.random() * SZ).toFixed(1)
      const r = (Math.random() * 0.9 + 0.2).toFixed(2), op = (Math.random() * 0.28 + 0.06).toFixed(2)
      ambient += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#9fb4ff" opacity="${op}"/>`
    }
    let links = '', stars = ''
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]
      if (i > 0) {
        const p = nodes[i - 1]
        const avgHR = (n.hr != null && p.hr != null) ? (n.hr + p.hr) / 2 : (n.hr ?? p.hr)
        const len = Math.hypot(n.x - p.x, n.y - p.y).toFixed(1)
        links += `<line x1="${p.x}" y1="${p.y}" x2="${n.x}" y2="${n.y}" class="am-link-js" data-idx="${i}" stroke="${zoneColor(avgHR)}" stroke-dasharray="${len}" stroke-dashoffset="${len}" opacity="0"/>`
      }
      const isStart = i === 0, isEnd = i === nodes.length - 1
      const hub = i % 8 === 0
      const rr = (isStart || isEnd) ? 4 : (hub ? 2.8 : 1.8)
      const fill = isStart ? '#19d76b' : isEnd ? '#ff3b30' : zoneColor(n.hr)
      stars += `<g class="am-star-js" data-idx="${i}" style="opacity:0"><circle cx="${n.x}" cy="${n.y}" r="${rr}" fill="${fill}" filter="url(#amStarGlow)"/></g>`
    }
    const c0 = nodes[0]
    return `<svg viewBox="0 0 ${SZ} ${SZ}" class="am-route-svg" preserveAspectRatio="xMidYMid meet" aria-label="GPS 路線星座">
      <defs><filter id="amStarGlow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="1.8"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
      ${ambient}
      <g class="am-links">${links}</g>
      <g class="am-stars">${stars}</g>
      <circle class="am-cursor" cx="${c0.x}" cy="${c0.y}" r="5.5" fill="rgba(255,255,255,.9)" opacity="0" filter="url(#amStarGlow)"/>
    </svg>`
  }

  // ── 轉速表（心率儀表板）SVG ──
  function buildGaugeSvg() {
    const cx = 90, cy = 90, R = 68
    const startD = 240, totalD = 240  // 8點→4點 240° 順時針掃
    function pt(deg) {
      const rad = (deg - 90) * Math.PI / 180
      return [+(cx + R * Math.cos(rad)).toFixed(2), +(cy + R * Math.sin(rad)).toFixed(2)]
    }
    function arcPath(d1, d2) {
      const [sx, sy] = pt(d1), [ex, ey] = pt(d2)
      const large = (d2 - d1) > 180 ? 1 : 0
      return `M${sx} ${sy} A${R} ${R} 0 ${large} 1 ${ex} ${ey}`
    }
    function hrDeg(hr) { return startD + (Math.min(Math.max(hr, 0), 200) / 200) * totalD }
    const track = `<path d="${arcPath(startD, startD + totalD)}" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="10" stroke-linecap="round"/>`
    const zones = [
      [0,   119, 'rgba(80,110,220,.65)'],
      [121, 139, '#19d76b'],
      [141, 159, '#f5c518'],
      [161, 179, '#ff8c00'],
      [181, 200, '#ff3b30'],
    ]
    const zoneArcs = zones.map(([h1, h2, col]) =>
      `<path d="${arcPath(hrDeg(h1), hrDeg(h2))}" fill="none" stroke="${col}" stroke-width="10" stroke-linecap="butt" opacity=".8"/>`
    ).join('')
    // 刻度標記（每 20 bpm 一條）
    let ticks = ''
    for (let hr = 0; hr <= 200; hr += 20) {
      const d = hrDeg(hr), innerR = hr % 40 === 0 ? R - 16 : R - 12
      const [ox1, oy1] = pt(d), [ox2, oy2] = (() => {
        const rad = (d - 90) * Math.PI / 180
        return [+(cx + innerR * Math.cos(rad)).toFixed(2), +(cy + innerR * Math.sin(rad)).toFixed(2)]
      })()
      ticks += `<line x1="${ox1}" y1="${oy1}" x2="${ox2}" y2="${oy2}" stroke="rgba(255,255,255,.25)" stroke-width="${hr % 40 === 0 ? 1.5 : 1}"/>`
    }
    // 指針：指向正上方，JS 旋轉到正確位置
    const initAngle = hrDeg(0)  // 240°（8點鐘 = 0 bpm）
    const needle = `<line class="am-gauge-needle" x1="${cx}" y1="${cy + 6}" x2="${cx}" y2="${cy - R + 10}" stroke="white" stroke-width="2.5" stroke-linecap="round" style="transform-box:view-box;transform-origin:${cx}px ${cy}px;transform:rotate(${initAngle}deg)"/>`
    return `<div class="am-gauge-wrap">
      <svg class="am-gauge-svg" viewBox="0 0 180 145" aria-hidden="true">
        <defs>
          <filter id="amNdGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.8" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        ${track}${zoneArcs}${ticks}
        <g filter="url(#amNdGlow)">${needle}</g>
        <circle cx="${cx}" cy="${cy}" r="5" fill="rgba(255,255,255,.35)"/>
        <text x="${cx}" y="${cy + 30}" class="am-gauge-val" id="am-gval" text-anchor="middle">—</text>
        <text x="${cx}" y="${cy + 43}" class="am-gauge-unit" text-anchor="middle">bpm</text>
      </svg>
      <div class="am-gauge-live-row">
        <span class="am-gauge-zone-lbl" id="am-gzone">—</span>
        <span class="am-gauge-spd"><span class="am-gauge-spd-val" id="am-gspeed">—</span><small> km/h</small></span>
      </div>
    </div>`
  }

  // ── JS 逐點動畫：星座游標 + 儀表板同步 ──
  function startRouteAnim() {
    if (_animTimer) { clearTimeout(_animTimer); _animTimer = null }
    const overlay = document.getElementById('am-overlay')
    if (!overlay || !overlay.classList.contains('open') || !_routeStream) return
    const svg = overlay.querySelector('.am-route-svg')
    if (!svg) return
    const stars    = [...svg.querySelectorAll('.am-star-js')]
    const links    = [...svg.querySelectorAll('.am-link-js')]
    const cursor   = svg.querySelector('.am-cursor')
    const statEls  = [...overlay.querySelectorAll('.am-route-right .am-rs[data-stat]')]
    const stream   = _routeStream
    const total    = stars.length
    let i = 0
    // 重置數據欄位
    statEls.forEach(rs => { const v = rs.querySelector('.am-stat-val'); if (v) v.textContent = '—' })
    function step() {
      // 顯示當前星星（pop 動畫）
      if (stars[i]) {
        stars[i].style.opacity = '1'
        stars[i].classList.add('am-star-popped')
      }
      // 連線（前一段 draw-on）
      if (i > 0 && links[i - 1]) {
        const lk = links[i - 1]
        lk.style.transition = 'stroke-dashoffset .22s ease-out, opacity .1s'
        lk.style.strokeDashoffset = '0'
        lk.style.opacity = '0.65'
      }
      // 游標跟著走
      if (cursor && stars[i]) {
        const c = stars[i].querySelector('circle')
        if (c) {
          cursor.setAttribute('cx', c.getAttribute('cx'))
          cursor.setAttribute('cy', c.getAttribute('cy'))
          cursor.style.opacity = '0.9'
        }
      }
      // 更新儀表板
      const pt = stream[i] || []
      updateGauge(pt[2], pt[3])
      // 更新距離 / 爬升 / 時間（依進度比例推進）
      const progress = i / Math.max(total - 1, 1)
      statEls.forEach(rs => {
        const key   = rs.dataset.stat
        const final = parseFloat(rs.dataset.final)
        const valEl = rs.querySelector('.am-stat-val')
        if (!valEl || isNaN(final)) return
        const cur = progress * final
        if (key === 'dist')      valEl.textContent = cur.toFixed(2)
        else if (key === 'elev') valEl.textContent = Math.round(cur)
        else if (key === 'time') valEl.textContent = fmtDuration(Math.round(cur))
      })
      i++
      if (i < total) {
        _animTimer = setTimeout(step, 88)
      } else {
        // 動畫播完 → 10 秒後重播
        _animTimer = setTimeout(() => {
          const canvas = overlay.querySelector('.am-route-canvas')
          if (canvas && _routeStream && overlay.classList.contains('open')) {
            canvas.innerHTML = routeSvg(_routeStream)
            startRouteAnim()
          }
        }, 10000)
      }
    }
    step()
  }

  // ── 更新儀表板數值 ──
  function updateGauge(hr, kmh) {
    const overlay = document.getElementById('am-overlay')
    if (!overlay) return
    const needle = overlay.querySelector('.am-gauge-needle')
    const val    = overlay.querySelector('#am-gval')
    const zone   = overlay.querySelector('#am-gzone')
    const spd    = overlay.querySelector('#am-gspeed')
    if (needle && hr != null) {
      const angle = 240 + (Math.min(Math.max(hr, 0), 200) / 200) * 240
      needle.style.transform = `rotate(${angle.toFixed(1)}deg)`
    }
    if (val) val.textContent  = hr  != null ? hr  : '—'
    if (spd) spd.textContent  = kmh != null ? kmh.toFixed(1) : '—'
    if (zone && hr != null) {
      const z = hr < 120 ? 'Z1' : hr < 140 ? 'Z2' : hr < 160 ? 'Z3' : hr < 180 ? 'Z4' : 'Z5'
      zone.textContent = z
      zone.className = `am-gauge-zone-lbl am-gz-${z.toLowerCase()}`
    }
  }
  function routeBlock(a) {
    const stat = (v, u, l) => v == null || v === '' ? '' :
      `<div class="am-rs"><div class="v">${esc(v)}${u ? `<small>${esc(u)}</small>` : ''}</div><div class="l">${esc(l)}</div></div>`

    // ── 有 route_stream → 左星座 + 右儀表板（JS 動畫）──
    if (a.route_stream && a.route_stream.length >= 2) {
      _routeStream = a.route_stream
      const hasHR = a.route_stream.some(p => p[2] != null)
      const aStat = (v, u, l, key) => v == null || v === '' ? '' :
        `<div class="am-rs" data-stat="${key}" data-final="${v}">
          <div class="v"><span class="am-stat-val">—</span>${u ? `<small>${esc(u)}</small>` : ''}</div>
          <div class="l">${esc(l)}</div>
        </div>`
      return `
        <div class="am-route">
          <div class="am-route-left">
            <div class="am-route-canvas">${routeSvg(a.route_stream)}</div>
            <div class="am-route-footer">
              <span class="am-route-brand">★ RIDE CONSTELLATION</span>
              <button class="am-replay-btn" type="button" onclick="replayRouteAnim()">▶ 重播</button>
            </div>
          </div>
          <div class="am-route-right">
            ${hasHR ? buildGaugeSvg() : ''}
            <div class="am-route-stats">
              ${aStat(a.distance_km, 'km', '距離', 'dist')}
              ${aStat(a.elevation_m, 'm', '爬升', 'elev')}
              ${aStat(a.moving_time_sec, '', '時間', 'time')}
            </div>
          </div>
        </div>`
    }

    // ── Fallback：只有 polyline（舊 CSS 動畫，無儀表板）──
    if (a.polyline) {
      const pts = decodePolyline(a.polyline)
      if (pts.length < 2) { _routeStream = null; return '' }
      _routeStream = null
      return `
        <div class="am-route">
          <div class="am-route-canvas">${routeSvgLegacy(pts)}</div>
          <div class="am-route-stats">
            ${stat(a.distance_km, 'km', '距離')}
            ${stat(a.elevation_m, 'm', '爬升')}
            ${stat(fmtDuration(a.moving_time_sec), '', '時間')}
          </div>
          <div class="am-route-brand">★ RIDE CONSTELLATION</div>
        </div>`
    }

    _routeStream = null
    return ''
  }


  /* ── 內容渲染：單車 ── */
  function renderRide(a) {
    const date = (a.date || '').slice(5).replace('-', '/')
    const dur = fmtDuration(a.moving_time_sec)
    const isIndoor = !!a.trainer
    const tag = isIndoor ? '🏠 室內' : '🚴 公路車'
    const stravaUrl = `https://www.strava.com/activities/${a.id}`

    const sub = [
      date ? `<span>📅 ${esc(date)}</span>` : '',
      a.time ? `<span>· ${esc(a.time)}</span>` : '',
      a.distance_km ? `<span>· <b>${esc(a.distance_km)}</b>km</span>` : '',
      `<span>· ${esc(dur)}</span>`,
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
    const lapsHtml = laps.length ? `
      <div class="am-section">
        <h4 class="am-section-h">分段摘要 · Top ${laps.length}</h4>
        <div class="am-laps">
          ${laps.map(l => `
            <div class="am-lap">
              <span class="am-lap-name">🏁 ${esc(l.name || '—')}</span>
              ${l.moving_time_str ? `<span class="am-lap-tag">⏱ ${esc(l.moving_time_str)}</span>` : ''}
              ${l.average_heartrate ? `<span class="am-lap-tag hr">♥️ ${esc(l.average_heartrate)} bpm</span>` : ''}
              ${l.average_watts ? `<span class="am-lap-tag w">⚡ ${esc(l.average_watts)} W</span>` : ''}
            </div>
          `).join('')}
        </div>
      </div>` : ''

    const itts = (ittByDate && ittByDate[a.date]) ? ittByDate[a.date] : []
    const ittHtml = itts.length ? `
      <div class="am-section">
        <h4 class="am-section-h">ITT 計時段</h4>
        <div class="am-itt">
          ${itts.map(it => `
            <div class="am-itt-item ${it.is_pr ? 'pr' : ''}">
              <div class="am-itt-crown">${it.is_pr ? '👑' : '🏁'}</div>
              <div class="am-itt-info">
                <div class="am-itt-seg">${esc(it.segName)}</div>
                <div class="am-itt-meta">第 ${esc(it.attemptNum)} / ${esc(it.total)} 次${it.rank ? ` · 第 ${esc(it.rank)} 名` : ''}${it.is_pr ? ' · 🏆 PR' : ''}</div>
              </div>
              <div class="am-itt-time">${esc(it.elapsed_str || '')}</div>
            </div>
          `).join('')}
        </div>
      </div>` : ''

    const desc = a.description ? `
      <div class="am-section">
        <h4 class="am-section-h">活動筆記</h4>
        <div class="am-desc">${esc(a.description)}</div>
      </div>` : ''

    return `
      <div class="am-head">
        <div class="am-icon">${ICON_RIDE}</div>
        <div class="am-title-wrap">
          <div><span class="am-tag">${esc(tag)}</span><span class="am-name" id="am-name">${esc(a.name || '—')}</span></div>
          <div class="am-sub">${sub}</div>
        </div>
        <a class="am-strava" href="${esc(stravaUrl)}" target="_blank" rel="noopener">Strava ↗</a>
        <button class="am-close" type="button" aria-label="關閉" onclick="closeActivityModal()">×</button>
      </div>
      <div class="am-body">
        ${routeBlock(a)}
        <div class="am-section">
          <h4 class="am-section-h">關鍵指標</h4>
          <div class="am-grid">${metrics || '<div class="am-empty">沒有可顯示的指標</div>'}</div>
        </div>
        ${lapsHtml}
        ${ittHtml}
        ${desc}
      </div>
    `
  }

  function openRide(id) {
    loadData().then(() => {
      const a = rideMap && rideMap.get(String(id))
      if (!a) {
        openModal(`
          <div class="am-head">
            <div class="am-title-wrap"><div class="am-name">查無此活動詳情</div><div class="am-sub">活動 ID: ${esc(id)}</div></div>
            <a class="am-strava" href="https://www.strava.com/activities/${esc(id)}" target="_blank" rel="noopener">Strava ↗</a>
            <button class="am-close" type="button" onclick="closeActivityModal()">×</button>
          </div>
          <div class="am-body"><div class="am-empty">該活動可能不在最近記錄中，請點右上角前往 Strava。</div></div>
        `)
        return
      }
      openModal(renderRide(a))
    })
  }
  window.openActivityModal = openRide
  window.replayRouteAnim = function () {
    if (_animTimer) { clearTimeout(_animTimer); _animTimer = null }
    const overlay = document.getElementById('am-overlay')
    if (!overlay || !_routeStream) return
    const canvas = overlay.querySelector('.am-route-canvas')
    if (!canvas) return
    canvas.innerHTML = routeSvg(_routeStream)
    startRouteAnim()
  }

  /* ── 注入「詳情」按鈕：只處理戶外單車卡片（排除室內飛輪/重訓/跑步/游泳） ── */
  function injectButtons() {
    if (!rideMap) return // 等資料載入完才能精準判斷
    const links = document.querySelectorAll('.act-strava-link:not([data-am-injected])')
    links.forEach(link => {
      link.dataset.amInjected = '1'
      const m = (link.getAttribute('href') || '').match(/activities\/(\d+)/)
      if (!m) return
      const id = m[1]
      const ride = rideMap.get(id)
      // 只有：在 recent_rides 裡 且 非 trainer (室內飛輪)
      if (!ride) return
      if (ride.trainer) return
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'act-detail-btn'
      btn.innerHTML = `
        <svg class="am-eye" viewBox="0 0 24 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path class="am-eye-lid" d="M1 8 Q12 -2 23 8 Q12 18 1 8 Z"/>
          <circle class="am-eye-iris" cx="12" cy="8" r="3.2" fill="currentColor" stroke="none"/>
          <circle class="am-eye-pupil" cx="13" cy="7" r="1" fill="#fff" stroke="none"/>
        </svg>
        <span class="am-label">詳情</span>
        <span class="am-arrow">▾</span>`
      btn.setAttribute('data-act-id', id)
      btn.addEventListener('click', e => {
        e.preventDefault()
        e.stopPropagation()
        openRide(id)
      })
      link.parentNode.insertBefore(btn, link)
    })
  }

  function init() {
    loadData().then(() => {
      injectButtons()
      const obs = new MutationObserver(() => injectButtons())
      obs.observe(document.body, { childList: true, subtree: true })
    })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})()
