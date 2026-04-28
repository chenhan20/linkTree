/* weight-bodymap.js — 自動：偵測本週重訓活動標題，將練到的部位 (胸/背/腿/肩/手) 染色
 * 1. fetch strava.json，取本週 recent_weights，名稱掃描關鍵字
 * 2. 在所有顯示「重訓」的 quest tile 內注入 SVG 身體部位圖
 * 3. 命中部位 path 變成主題 accent 色（橘色預設）
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

  /* SVG 人像（正視圖，分區可染色） */
  const SVG = `
<svg class="bodymap" viewBox="0 0 120 200" xmlns="http://www.w3.org/2000/svg" aria-label="練到的部位">
  <!-- head -->
  <circle cx="60" cy="22" r="14" />
  <!-- neck -->
  <rect x="54" y="34" width="12" height="8" />
  <!-- shoulders (兩塊三角肌) -->
  <path data-bp="shoulder" d="M30 50 Q40 42 54 44 L54 60 Q42 60 32 64 Z" />
  <path data-bp="shoulder" d="M90 50 Q80 42 66 44 L66 60 Q78 60 88 64 Z" />
  <!-- chest (左右胸) -->
  <path data-bp="chest" d="M40 56 Q50 52 58 56 L58 82 Q48 84 38 80 Z" />
  <path data-bp="chest" d="M80 56 Q70 52 62 56 L62 82 Q72 84 82 80 Z" />
  <!-- abs / torso filler (灰色，不染) -->
  <path d="M44 84 L76 84 L74 116 L46 116 Z" />
  <!-- back hint：在腰側標兩塊背部塊（從正面也能看到）-->
  <path data-bp="back" d="M30 64 L42 76 L42 110 L28 100 Z" />
  <path data-bp="back" d="M90 64 L78 76 L78 110 L92 100 Z" />
  <!-- arms：左右上臂 + 前臂 -->
  <path data-bp="arm" d="M22 64 Q18 80 22 100 L32 100 Q30 80 32 66 Z" />
  <path data-bp="arm" d="M98 64 Q102 80 98 100 L88 100 Q90 80 88 66 Z" />
  <path data-bp="arm" d="M22 102 Q20 122 24 138 L32 138 Q32 120 32 102 Z" />
  <path data-bp="arm" d="M98 102 Q100 122 96 138 L88 138 Q88 120 88 102 Z" />
  <!-- legs：左右大腿 + 小腿 -->
  <path data-bp="legs" d="M44 118 L58 118 L58 158 L46 158 Z" />
  <path data-bp="legs" d="M62 118 L76 118 L74 158 L62 158 Z" />
  <path data-bp="legs" d="M46 160 L58 160 L58 192 L48 192 Z" />
  <path data-bp="legs" d="M62 160 L74 160 L72 192 L62 192 Z" />
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

  function buildBodymap(hits) {
    const wrap = document.createElement('div')
    wrap.className = 'bodymap-wrap'
    wrap.innerHTML = SVG
    const svg = wrap.querySelector('svg')
    svg.querySelectorAll('[data-bp]').forEach(el => {
      if (hits.has(el.getAttribute('data-bp'))) el.classList.add('bp-on')
    })
    const legend = document.createElement('div')
    legend.className = 'bodymap-legend'
    legend.innerHTML = LEGEND_ORDER.map(p =>
      `<span class="${hits.has(p.key) ? 'on' : ''}">${p.label}</span>`
    ).join('')
    wrap.appendChild(legend)
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
    // 移除既有的進度條/百分比/打勾，保留 icon + label
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
      const obs = new MutationObserver(() => { injected = false; tryInject(data) })
      obs.observe(document.body, { childList: true, subtree: true })
    })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})()
