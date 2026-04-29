/* weight-bodymap.js — 自動：偵測本週重訓活動標題，將練到的部位 (胸/背/腿/肩/手) 染色
 * 1. fetch strava.json，取本週 recent_weights，名稱掃描關鍵字
 * 2. 在所有顯示「重訓」的 quest tile 內注入 SVG 身體部位圖（正面 + 背面）
 * 3. 先呈現空白人形，依序「文字標記 → 填色」，命中部位 path 變成主題 accent 色
 */
(function () {
  'use strict'
  const STRAVA_JSON = 'strava.json'
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
  const SVG_FRONT = `
<svg class="bodymap" data-view="front" viewBox="0 0 120 200" xmlns="http://www.w3.org/2000/svg" aria-label="正面">
  <!-- head -->
  <circle cx="60" cy="22" r="14" />
  <!-- neck -->
  <rect x="54" y="34" width="12" height="8" />
  <!-- shoulders (前束三角肌) -->
  <path data-bp="shoulder" d="M30 50 Q40 42 54 44 L54 60 Q42 60 32 64 Z" />
  <path data-bp="shoulder" d="M90 50 Q80 42 66 44 L66 60 Q78 60 88 64 Z" />
  <!-- chest (左右胸) -->
  <path data-bp="chest" d="M40 56 Q50 52 58 56 L58 82 Q48 84 38 80 Z" />
  <path data-bp="chest" d="M80 56 Q70 52 62 56 L62 82 Q72 84 82 80 Z" />
  <!-- abs / torso filler (灰色，不染) -->
  <path d="M44 84 L76 84 L74 116 L46 116 Z" />
  <!-- arms：左右上臂 (二頭) + 前臂 -->
  <path data-bp="arm" d="M22 64 Q18 80 22 100 L32 100 Q30 80 32 66 Z" />
  <path data-bp="arm" d="M98 64 Q102 80 98 100 L88 100 Q90 80 88 66 Z" />
  <path data-bp="arm" d="M22 102 Q20 122 24 138 L32 138 Q32 120 32 102 Z" />
  <path data-bp="arm" d="M98 102 Q100 122 96 138 L88 138 Q88 120 88 102 Z" />
  <!-- legs：左右大腿 (股四頭) + 小腿 (脛) -->
  <path data-bp="legs" d="M44 118 L58 118 L58 158 L46 158 Z" />
  <path data-bp="legs" d="M62 118 L76 118 L74 158 L62 158 Z" />
  <path data-bp="legs" d="M46 160 L58 160 L58 192 L48 192 Z" />
  <path data-bp="legs" d="M62 160 L74 160 L72 192 L62 192 Z" />
  <!-- scan line (overlay) -->
  <rect class="scan-line" x="0" y="0" width="120" height="2" />
</svg>`

  /* SVG 人像（背視圖） */
  const SVG_BACK = `
<svg class="bodymap" data-view="back" viewBox="0 0 120 200" xmlns="http://www.w3.org/2000/svg" aria-label="背面">
  <!-- head (back of head) -->
  <circle cx="60" cy="22" r="14" />
  <!-- neck -->
  <rect x="54" y="34" width="12" height="8" />
  <!-- traps / shoulders (後三角) -->
  <path data-bp="shoulder" d="M30 50 Q40 42 54 44 L54 60 Q42 60 32 64 Z" />
  <path data-bp="shoulder" d="M90 50 Q80 42 66 44 L66 60 Q78 60 88 64 Z" />
  <!-- upper back (斜方 / 闊背上段) -->
  <path data-bp="back" d="M40 50 Q60 46 80 50 L78 78 Q60 80 42 78 Z" />
  <!-- lower back (下背) -->
  <path data-bp="back" d="M44 80 L76 80 L74 116 L46 116 Z" />
  <!-- arms：上臂 (三頭) + 前臂 -->
  <path data-bp="arm" d="M22 64 Q18 80 22 100 L32 100 Q30 80 32 66 Z" />
  <path data-bp="arm" d="M98 64 Q102 80 98 100 L88 100 Q90 80 88 66 Z" />
  <path data-bp="arm" d="M22 102 Q20 122 24 138 L32 138 Q32 120 32 102 Z" />
  <path data-bp="arm" d="M98 102 Q100 122 96 138 L88 138 Q88 120 88 102 Z" />
  <!-- glutes (臀) -->
  <path data-bp="legs" d="M44 118 L58 118 L58 134 Q50 138 44 134 Z" />
  <path data-bp="legs" d="M62 118 L76 118 L76 134 Q70 138 62 134 Z" />
  <!-- hamstrings (腿後) -->
  <path data-bp="legs" d="M44 136 L58 136 L58 158 L46 158 Z" />
  <path data-bp="legs" d="M62 136 L76 136 L74 158 L62 158 Z" />
  <!-- calves (小腿) -->
  <path data-bp="legs" d="M46 160 L58 160 L58 192 L48 192 Z" />
  <path data-bp="legs" d="M62 160 L74 160 L72 192 L62 192 Z" />
  <!-- scan line (overlay) -->
  <rect class="scan-line" x="0" y="0" width="120" height="2" />
</svg>`

  const LEGEND_ORDER = [
    { key: 'chest',    label: '胸' },
    { key: 'back',     label: '背' },
    { key: 'legs',     label: '腿' },
    { key: 'shoulder', label: '肩' },
    { key: 'arm',      label: '手' },
  ]

  function detectParts(weights) {
    const hits = new Set()
    weights.forEach(w => {
      const name = (w.name || '').toLowerCase()
      Object.entries(KEYWORDS).forEach(([part, words]) => {
        if (words.some(kw => name.includes(kw.toLowerCase()))) hits.add(part)
      })
    })
    return hits
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
  function addLabels(svg, hits) {
    const SVG_NS = 'http://www.w3.org/2000/svg'
    const seen = new Set()
    svg.querySelectorAll('[data-bp]').forEach(el => {
      const bp = el.getAttribute('data-bp')
      if (!hits.has(bp) || seen.has(bp)) return
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
    legend.innerHTML = LEGEND_ORDER.map(p =>
      `<span class="${hits.has(p.key) ? 'on' : ''}">${p.label}</span>`
    ).join('')
    wrap.appendChild(legend)

    const svgs = wrap.querySelectorAll('svg.bodymap')

    /* 動畫排程：t=0 空白 → 文字 → 填色 */
    requestAnimationFrame(() => {
      // 啟動 scan-line 動畫（純 CSS，加 class 觸發）
      svgs.forEach(svg => svg.classList.add('scanning'))

      // Phase 1: 文字標記
      setTimeout(() => {
        svgs.forEach(svg => {
          addLabels(svg, hits)
          // 下一幀加 show class，觸發 transition
          requestAnimationFrame(() => {
            svg.querySelectorAll('.bp-label').forEach(t => t.classList.add('bp-label-show'))
          })
        })
      }, 300)

      // Phase 2: 填色
      setTimeout(() => {
        svgs.forEach(svg => {
          svg.querySelectorAll('[data-bp]').forEach(el => {
            if (hits.has(el.getAttribute('data-bp'))) el.classList.add('bp-on')
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
    const map = buildBodymap(hits)
    // 保留 icon、label、check；其餘進度條移除
    tile.querySelectorAll('.qprog-wrap, .qpct, .qprog-or').forEach(n => n.remove())
    tile.appendChild(map)
    // 若至少命中一個部位，補一個 done 樣式
    if (hits.size > 0 && !tile.classList.contains('on') && !tile.classList.contains('done')) {
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
