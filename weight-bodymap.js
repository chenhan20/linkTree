/* weight-bodymap.js — 自動：偵測本週重訓活動標題，將練到的部位 (胸/背/腿/肩/手) 染色
/* weight-bodymap.js — 重訓任務肌群熱度圖
 * 強度等級：1次=lv1(amber) / 2次=lv2(orange) / 3+次=lv3(red+pulse)
 */
(function () {
  'use strict'
  const STRAVA_JSON = 'data/strava.json'
  const KEYWORDS = {
    chest:    ['胸', 'chest', 'bench', 'push'],
    back:     ['背', 'back',  'pull',  'row',  'lat'],
    legs:     ['腿', 'leg',   'squat', 'lunge', 'deadlift', 'leg day'],
    shoulder: ['肩', 'shoulder', 'press', 'delt'],
    arm:      ['手', '臂', 'arm', 'bicep', 'tricep', 'curl'],
  }
  const PART_LABEL = {
    chest: '胸', back: '背', legs: '腿', shoulder: '肩', arm: '手',
  }

  /* SVG 人像（正視圖）—— 預設空白，命中才染色 */
  /* ── SVG 正面（Anterior view）── */
  const SVG_FRONT = `
<svg class="bodymap" data-view="front" viewBox="0 0 120 210" xmlns="http://www.w3.org/2000/svg" aria-label="正面">
  <circle class="neutral" cx="60" cy="15" r="12"/>
  <path class="neutral" d="M55 26 Q55 34 57 35 L63 35 Q65 34 65 26 Z"/>
  <path class="neutral" d="M37 37 Q49 30 57 35 L63 35 Q71 30 83 37 L79 44 Q60 40 41 44 Z"/>
  <path data-bp="shoulder" d="M19 49 Q17 38 37 37 L41 44 Q34 47 30 58 Q23 57 19 49 Z"/>
  <path data-bp="shoulder" d="M101 49 Q103 38 83 37 L79 44 Q86 47 90 58 Q97 57 101 49 Z"/>
  <path data-bp="chest" d="M41 44 Q53 36 60 43 L60 76 Q50 81 39 73 Q36 59 41 44 Z"/>
  <path data-bp="chest" d="M79 44 Q67 36 60 43 L60 76 Q70 81 81 73 Q84 59 79 44 Z"/>
  <rect data-bp="chest" x="45" y="79" width="13" height="10" rx="3"/>
  <rect data-bp="chest" x="62" y="79" width="13" height="10" rx="3"/>
  <rect data-bp="chest" x="45" y="91" width="13" height="10" rx="3"/>
  <rect data-bp="chest" x="62" y="91" width="13" height="10" rx="3"/>
  <rect data-bp="chest" x="45" y="103" width="13" height="10" rx="3"/>
  <rect data-bp="chest" x="62" y="103" width="13" height="10" rx="3"/>
  <path class="neutral" d="M37 74 Q39 78 41 116 L45 116 Q43 78 41 74 Z"/>
  <path class="neutral" d="M83 74 Q81 78 79 116 L75 116 Q77 78 79 74 Z"/>
  <path class="neutral" d="M37 118 Q60 126 83 118 L81 130 Q60 136 39 130 Z"/>
  <path data-bp="arm" d="M17 50 Q13 68 17 97 L28 97 Q26 68 25 52 Q21 46 17 50 Z"/>
  <path data-bp="arm" d="M17 99 Q15 118 19 135 L28 133 Q27 114 28 99 Z"/>
  <path data-bp="arm" d="M103 50 Q107 68 103 97 L92 97 Q94 68 95 52 Q99 46 103 50 Z"/>
  <path data-bp="arm" d="M103 99 Q105 118 101 135 L92 133 Q93 114 92 99 Z"/>
  <path data-bp="legs" d="M39 132 Q46 128 55 130 L54 175 Q46 178 40 175 Z"/>
  <path data-bp="legs" d="M81 132 Q74 128 65 130 L66 175 Q74 178 80 175 Z"/>
  <ellipse class="neutral" cx="47" cy="179" rx="8" ry="5"/>
  <ellipse class="neutral" cx="73" cy="179" rx="8" ry="5"/>
  <path data-bp="legs" d="M41 185 Q47 183 55 184 L53 206 Q47 208 43 206 Z"/>
  <path data-bp="legs" d="M79 185 Q73 183 65 184 L67 206 Q73 208 77 206 Z"/>
  <rect class="scan-line" x="0" y="0" width="120" height="2"/>
</svg>`

  /* ── SVG 背面（Posterior view）── */
  const SVG_BACK = `
<svg class="bodymap" data-view="back" viewBox="0 0 120 210" xmlns="http://www.w3.org/2000/svg" aria-label="背面">
  <circle class="neutral" cx="60" cy="15" r="12"/>
  <path class="neutral" d="M55 26 Q55 34 57 35 L63 35 Q65 34 65 26 Z"/>
  <path data-bp="shoulder" d="M37 37 Q49 28 60 30 Q71 28 83 37 L79 48 Q60 42 41 48 Z"/>
  <path data-bp="shoulder" d="M19 49 Q17 38 37 37 L41 48 Q34 51 30 62 Q23 60 19 49 Z"/>
  <path data-bp="shoulder" d="M101 49 Q103 38 83 37 L79 48 Q86 51 90 62 Q97 60 101 49 Z"/>
  <path data-bp="back" d="M41 48 Q60 42 79 48 L76 78 Q60 82 44 78 Z"/>
  <path data-bp="back" d="M42 80 L78 80 L76 122 L44 122 Z"/>
  <path data-bp="arm" d="M17 50 Q13 68 17 97 L28 97 Q26 68 25 52 Q21 46 17 50 Z"/>
  <path data-bp="arm" d="M17 99 Q15 118 19 135 L28 133 Q27 114 28 99 Z"/>
  <path data-bp="arm" d="M103 50 Q107 68 103 97 L92 97 Q94 68 95 52 Q99 46 103 50 Z"/>
  <path data-bp="arm" d="M103 99 Q105 118 101 135 L92 133 Q93 114 92 99 Z"/>
  <path data-bp="legs" d="M39 124 L57 124 L57 144 Q47 150 39 144 Z"/>
  <path data-bp="legs" d="M63 124 L81 124 L81 144 Q73 150 63 144 Z"/>
  <path data-bp="legs" d="M39 146 Q46 143 57 144 L55 176 Q46 179 40 176 Z"/>
  <path data-bp="legs" d="M81 146 Q74 143 63 144 L65 176 Q74 179 80 176 Z"/>
  <ellipse class="neutral" cx="47" cy="180" rx="8" ry="5"/>
  <ellipse class="neutral" cx="73" cy="180" rx="8" ry="5"/>
  <path data-bp="legs" d="M40 186 Q47 182 56 184 L54 205 Q47 210 42 206 Z"/>
  <path data-bp="legs" d="M80 186 Q73 182 64 184 L66 205 Q73 210 78 206 Z"/>
  <rect class="scan-line" x="0" y="0" width="120" height="2"/>
</svg>`

  const LEGEND_ORDER = [
    { key: 'chest',    label: '胸' },
    { key: 'back',     label: '背' },
    { key: 'legs',     label: '腿' },
    { key: 'shoulder', label: '肩' },
    { key: 'arm',      label: '手' },
  ]

  function detectParts(weights) {
    const counts = new Map()
    weights.forEach(w => {
      const name = (w.name || '').toLowerCase()
      Object.entries(KEYWORDS).forEach(([part, words]) => {
        if (words.some(kw => name.includes(kw.toLowerCase())))
          counts.set(part, (counts.get(part) || 0) + 1)
      })
    })
    return counts
  }

  function lvClass(count) {
    if (count >= 3) return 'bp-lv3'
    if (count >= 2) return 'bp-lv2'
    if (count >= 1) return 'bp-lv1'
    return ''
  }

  function thisWeekWeights(data) {
    if (!data || !data.recent_weights) return []
    // TPE 週一 00:00
    const tpeNow = new Date(Date.now() + 8 * 3600 * 1000)
    const dow = (tpeNow.getUTCDay() + 6) % 7 // Mon=0
    const monday = new Date(tpeNow)
    monday.setUTCDate(tpeNow.getUTCDate() - dow)
    const ymd = monday.toISOString().slice(0, 10)
    return data.recent_weights.filter(w => (w.date || '') >= ymd)
  }

  /* 在指定 SVG 內，對命中部位的第一個 path 上方加文字 label */
  function addLabels(svg, counts) {
    const SVG_NS = 'http://www.w3.org/2000/svg'
    const seen = new Set()
    svg.querySelectorAll('[data-bp]').forEach(el => {
      const bp = el.getAttribute('data-bp')
      if (!counts.has(bp) || seen.has(bp)) return
      seen.add(bp)
      let bbox
      try { bbox = el.getBBox() } catch (_) { bbox = { x: 0, y: 0, width: 0, height: 0 } }
      const cx = bbox.x + bbox.width / 2
      const cy = bbox.y + bbox.height / 2 + 3 // 視覺上偏下一點對齊區塊中心
      const text = document.createElementNS(SVG_NS, 'text')
      text.setAttribute('class', 'bp-label')
      text.setAttribute('x', cx.toFixed(1))
      text.setAttribute('y', cy.toFixed(1))
      text.setAttribute('text-anchor', 'middle')
      text.setAttribute('data-bp-label', bp)
      text.textContent = PART_LABEL[bp] || bp
      svg.appendChild(text)
    })
  }

  function buildBodymap(hits) {
      function buildBodymap(counts) {
    const wrap = document.createElement('div')
    wrap.className = 'bodymap-wrap'

    const views = document.createElement('div')
    views.className = 'bodymap-views'
    views.innerHTML = `
      <div class="bodymap-view">
        <div class="bodymap-view-label">FRONT</div>
        ${SVG_FRONT}
      </div>
      <div class="bodymap-view">
        <div class="bodymap-view-label">BACK</div>
        ${SVG_BACK}
      </div>`
    wrap.appendChild(views)

    const legend = document.createElement('div')
    legend.className = 'bodymap-legend'
    legend.innerHTML = LEGEND_ORDER.map(p => {
      const c = counts.get(p.key) || 0
      const lv = c ? lvClass(c) : ''
      return `<span class="bl-item${lv ? ' ' + lv : ''}"><span class="bl-dot"></span>${p.label}${c ? `<span class="bl-count">×${c}</span>` : ''}</span>`
    }).join('')
    wrap.appendChild(legend)

    const guide = document.createElement('div')
    guide.className = 'bodymap-guide'
    guide.innerHTML = `<span class="bg-swatch" style="background:#ffc732"></span>×1<span class="bg-swatch" style="background:#ff7814;margin-left:5px"></span>×2<span class="bg-swatch" style="background:#ff3014;margin-left:5px"></span>×3+`
    wrap.appendChild(guide)

    const svgs = wrap.querySelectorAll('svg.bodymap')

    /* 動畫排程：t=0 空白 → 文字 → 填色 */
    requestAnimationFrame(() => {
      // 啟動 scan-line 動畫（純 CSS，加 class 觸發）
      svgs.forEach(svg => svg.classList.add('scanning'))

      // Phase 1: 文字標記
      setTimeout(() => {
        svgs.forEach(svg => {
          addLabels(svg, counts)
          requestAnimationFrame(() => {
            svg.querySelectorAll('.bp-label').forEach(t => t.classList.add('bp-label-show'))
          })
        })
      }, 300)

      // Phase 2: 填色（強度等級）
      setTimeout(() => {
        svgs.forEach(svg => {
          svg.querySelectorAll('[data-bp]').forEach(el => {
            const bp = el.getAttribute('data-bp')
            const c = counts.get(bp) || 0
            if (c > 0) el.classList.add(lvClass(c))
          })
        })
      }, 900)
    })

    return wrap
  }

  /* 找重訓 quest tile：包含 🏋️ icon 或 TRAIN/GYM 文字的 quest tile */
  function findWeightTile() {
    const tiles = document.querySelectorAll('.quest-tile, .wq-tile')
    for (const t of tiles) {
      const txt = t.textContent || ''
      if (txt.includes('🏋') || /\bTRAIN\b|\bGYM\b|重訓/.test(txt)) return t
    }
    return null
  }

  let injected = false
  function tryInject(data) {
    if (injected) return
    const tile = findWeightTile()
    if (!tile) return
    const oldMap = tile.querySelector('.bodymap-wrap')
    if (oldMap) return // 已注入
    const hits = detectParts(thisWeekWeights(data))
    const counts = detectParts(thisWeekWeights(data))
    const map = buildBodymap(counts)
    tile.querySelectorAll('.qprog-wrap, .qpct, .qprog-or').forEach(n => n.remove())
    tile.appendChild(map)
    if (counts.size > 0 && !tile.classList.contains('on') && !tile.classList.contains('done')) {
      tile.classList.add('on')
      tile.classList.add('done')
    }
    injected = true
  }

  let dataPromise = null
  function loadData() {
    if (dataPromise) return dataPromise
    dataPromise = fetch(STRAVA_JSON, { cache: 'force-cache' }).then(r => r.json()).catch(() => null)
    return dataPromise
  }

  function init() {
    loadData().then(data => {
      if (!data) return
      tryInject(data)
      const obs = new MutationObserver(() => { if (!injected) tryInject(data) })
      obs.observe(document.body, { childList: true, subtree: true })
    })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})()
