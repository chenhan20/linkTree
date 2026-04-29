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
  }
  function closeModal() {
    const el = document.getElementById('am-overlay')
    if (el) el.classList.remove('open')
    document.body.style.overflow = ''
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
