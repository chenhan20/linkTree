/* ══ 月總結 · MONTH IN REVIEW ═══════════════════════════════════════════
   抄 Strava 的每月總結：全螢幕、上方進度條、點右半邊下一張、點左半邊上一張、
   按住暫停、Esc 關。

   什麼時候出現：月底最後三天（本月，標「截至 M/D」）、月初前七天（上個月）。
   其他日子總覽上沒有入口，但 #recap 與 #recap/2026-08 隨時都打得開。

   資料全部是頁面已經載好的東西現算，不加產生器、不動同步管線：
     window._activities   手錶那份（intervals.icu），總量與每日格子
     window._ittEfforts   併過 FIT 自建的 ITT 成績，排名次
     window._ittSegMeta   itt-config.json，同一組路段只挑一張獎盃
     window.__powerPrs    功率 PR 的 top3
   另外自己抓兩個小檔：_est_distance.json（室內等效里程）、monthly-hours.json
   （2026-07 以前的月時數快照，15.3 h 損益線就是用那份口徑迴歸的）。

   口徑刻意跟 Strava 不一樣的地方：Rouvy 自己上傳的那份不算（虛擬距離會灌里程），
   所以距離與爬升會比 Strava 的月總結少一點 —— 這裡的才是訓練資料。

   跟主頁的接點只有三個：#recap-slot（總覽裡的入口）、strava:ready 事件、
   window.__stravaReady。這支檔載不到，總覽只是少一個入口。 */
;(function () {
  'use strict'

  const MONTH_ZH = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']
  const BREAKEVEN_H = 15.3            // 月騎乘時數損益線（見 memory: monthly-volume-breakeven）
  const SLIDE_MS = 7000
  const ROUVY = /rouvy/i

  const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
  const pad = n => String(n).padStart(2, '0')
  const ymOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
  const todayStr = () => { const d = new Date(); return `${ymOf(d)}-${pad(d.getDate())}` }
  const shiftYm = (ym, k) => { const [y, m] = ym.split('-').map(Number); return ymOf(new Date(y, m - 1 + k, 1)) }
  const daysIn = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate() }
  const md = s => `${+s.slice(5, 7)}/${+s.slice(8, 10)}`
  const fmtClock = sec => {
    const s = Math.round(sec), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60
    return h ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`
  }
  const fmtInt = n => Math.round(n).toLocaleString('en-US')

  /* ── 哪一個月該出現 ───────────────────────────────────────────── */
  function windowMonth(now = new Date()) {
    const d = now.getDate(), last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    if (d >= last - 2) return ymOf(now)
    if (d <= 7) return shiftYm(ymOf(now), -1)
    return null
  }

  /* ── 資料 ─────────────────────────────────────────────────────── */
  let extras = null
  function loadExtras() {
    if (extras) return extras
    const get = u => fetch(u, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null)
    extras = Promise.all([get('data/fit/_est_distance.json'), get('data/monthly-hours.json'), get('data/fit/_reports.json')])
      .then(([est, hours, reports]) => ({ est: est || {}, hours: hours || {}, reports: reports || {} }))
    return extras
  }

  function sportOf(type) {
    if (/Ride/.test(type)) return 'ride'
    if (type === 'WeightTraining') return 'lift'
    if (/Run/.test(type)) return 'run'
    if (/Swim/.test(type)) return 'swim'
    return 'other'
  }
  const SPORT_ZH = { ride: '騎車', lift: '重訓', run: '跑步', swim: '游泳', other: '其他' }

  function allActs(ex) {
    const today = todayStr()
    return Object.entries(window._activities || {})
      .filter(([, a]) => a && a.start_date_local && !ROUVY.test(a.device_name || ''))
      .map(([id, a]) => {
        const sport = sportOf(a.type)
        const outdoorKm = (a.distance || 0) / 1000
        const e = ex.est[id]
        const km = sport === 'ride' ? (outdoorKm || (e && typeof e === 'object' ? e.km || 0 : 0)) : outdoorKm
        return {
          id, date: a.start_date_local.slice(0, 10), sport, type: a.type,
          indoor: /Virtual/.test(a.type), km, outdoorKm,
          sec: a.moving_time || 0, elev: a.total_elevation_gain || 0,
          tss: a.icu_training_load || 0, np: a.icu_weighted_avg_watts || 0, name: a.name || '',
        }
      })
      .filter(a => a.date <= today)
  }

  function totalsOf(list) {
    const rides = list.filter(a => a.sport === 'ride')
    return {
      days: new Set(list.map(a => a.date)).size,
      km: rides.reduce((s, a) => s + a.km, 0),
      hours: list.reduce((s, a) => s + a.sec, 0) / 3600,
      elev: rides.reduce((s, a) => s + a.elev, 0),
      rideHours: rides.reduce((s, a) => s + a.sec, 0) / 3600,
    }
  }

  function rideHoursOf(ym, acts, ex) {
    const frozen = ex.hours.frozen_through, snap = (ex.hours.months || {})[ym]
    if (frozen && ym <= frozen && snap) return snap.hours
    return acts.filter(a => a.sport === 'ride' && a.date.startsWith(ym)).reduce((s, a) => s + a.sec, 0) / 3600
  }

  function ittTrophies(ym) {
    const year = ym.slice(0, 4), meta = window._ittSegMeta || {}
    const byGroup = new Map()
    Object.entries(window._ittEfforts || {}).forEach(([id, raw]) => {
      const seen = new Set()
      const efforts = (raw || []).filter(e => e && e.elapsed_sec > 0 && e.date).filter(e => {
        const k = `${e.date.slice(0, 10)} ${e.start_time || ''}`
        if (seen.has(k)) return false
        seen.add(k); return true
      })
      const mine = efforts.filter(e => e.date.startsWith(ym))
      if (!mine.length) return
      const best = mine.reduce((m, e) => e.elapsed_sec < m.elapsed_sec ? e : m)
      const allRank = 1 + efforts.filter(e => e.elapsed_sec < best.elapsed_sec).length
      const yrList = efforts.filter(e => e.date.startsWith(year))
      const yrRank = 1 + yrList.filter(e => e.elapsed_sec < best.elapsed_sec).length
      if (allRank > 3 && yrRank > 3) return
      const m = meta[id] || {}
      const kicker = allRank === 1 ? '史上最快' : allRank <= 3 ? `史上第 ${allRank} 快`
                   : yrRank === 1 ? `${year} 最快` : `${year} 第 ${yrRank} 快`
      const score = allRank <= 3 ? allRank : 10 + yrRank
      const card = {
        kind: 'itt', score, kicker, value: fmtClock(best.elapsed_sec),
        name: m.nameZh || String(id), date: best.date.slice(0, 10),
        foot: `${efforts.length} 次挑戰裡`, badge: allRank <= 3 ? allRank : yrRank,
        dist: m.distance_km || 0, isFull: m.label === '全段',
      }
      // 一趟「劍中中中中劍」會同時刷掉母路線＋四等分，全部攤開等於一面牆 —— 一組只留一張
      const g = m.group || `solo-${id}`, cur = byGroup.get(g)
      if (!cur || card.score < cur.score || (card.score === cur.score && card.isFull && !cur.isFull)) byGroup.set(g, card)
    })
    return [...byGroup.values()]
  }

  function powerTrophies(ym) {
    const out = []
    ;(window.__powerPrs || []).forEach(pr => {
      const hit = (pr.top3 || []).filter(t => (t.date || '').startsWith(ym)).sort((a, b) => a.rank - b.rank)[0]
      if (!hit) return
      out.push({
        kind: 'power', score: hit.rank, kicker: hit.rank === 1 ? '史上最佳' : `史上第 ${hit.rank}`,
        value: `${hit.watts}`, unit: 'W', name: `${pr.duration_label} 功率`, date: hit.date,
        foot: md(hit.date), badge: hit.rank,
      })
    })
    return out
  }

  function rideTrophies(ym, acts) {
    const year = ym.slice(0, 4)
    const yr = acts.filter(a => a.sport === 'ride' && a.date.startsWith(year))
    const mo = yr.filter(a => a.date.startsWith(ym))
    if (!mo.length) return []
    const defs = [
      { f: a => a.elev, label: '大爬升', unit: 'm', fmt: v => fmtInt(v), pool: yr, mpool: mo },
      { f: a => a.outdoorKm, label: '長距離', unit: 'km', fmt: v => v.toFixed(1), pool: yr.filter(a => !a.indoor), mpool: mo.filter(a => !a.indoor) },
      { f: a => a.tss, label: '高負荷', unit: 'TSS', fmt: v => fmtInt(v), pool: yr, mpool: mo },
    ]
    return defs.map(d => {
      if (!d.mpool.length) return null
      const top = d.mpool.reduce((m, a) => d.f(a) > d.f(m) ? a : m)
      const v = d.f(top)
      if (!v) return null
      const rank = 1 + d.pool.filter(a => d.f(a) > v).length
      if (rank > 3) return null
      return {
        kind: 'ride', score: 10 + rank, kicker: `${year} 第 ${rank} ${d.label}`,
        value: d.fmt(v), unit: d.unit, name: md(top.date), date: top.date, foot: `今年 ${d.pool.length} 趟裡`, badge: rank,
      }
    }).filter(Boolean)
  }

  function longestStreak(dates) {
    const set = new Set(dates); let best = 0
    set.forEach(d => {
      const prev = new Date(d); prev.setDate(prev.getDate() - 1)
      if (set.has(`${ymOf(prev)}-${pad(prev.getDate())}`)) return
      let n = 0, c = new Date(d)
      while (set.has(`${ymOf(c)}-${pad(c.getDate())}`)) { n++; c.setDate(c.getDate() + 1) }
      best = Math.max(best, n)
    })
    return best
  }

  function buildRecap(ym, ex) {
    const acts = allActs(ex)
    const mine = acts.filter(a => a.date.startsWith(ym))
    if (!mine.length) return null
    const prevYm = shiftYm(ym, -1)
    const cur = totalsOf(mine), prev = totalsOf(acts.filter(a => a.date.startsWith(prevYm)))
    const today = todayStr(), live = today.startsWith(ym)
    const nDays = daysIn(ym)

    const counts = {}
    mine.forEach(a => { counts[a.sport] = (counts[a.sport] || 0) + 1 })
    const hoursBy = {}
    mine.forEach(a => { hoursBy[a.sport] = (hoursBy[a.sport] || 0) + a.sec / 3600 })
    const top = Object.entries(hoursBy).sort((a, b) => b[1] - a[1])[0][0]

    const byDay = {}
    mine.forEach(a => {
      const d = byDay[a.date] || (byDay[a.date] = { sports: new Set(), tss: 0 })
      d.sports.add(a.sport); d.tss += a.tss
    })

    const hist = []
    for (let k = -11; k <= 0; k++) { const m = shiftYm(ym, k); hist.push({ ym: m, h: rideHoursOf(m, acts, ex) }) }

    const rides = mine.filter(a => a.sport === 'ride')
    const hardest = rides.length ? rides.reduce((m, a) => a.tss > m.tss ? a : m) : null
    let hardestSegs = []
    if (hardest) {
      const meta = window._ittSegMeta || {}, names = new Set()
      const byGrp = new Map()
      Object.entries(window._ittEfforts || {}).forEach(([id, list]) => {
        if (!(list || []).some(e => (e.date || '').startsWith(hardest.date))) return
        const m = meta[id]
        if (!m || !m.nameZh) return
        const g = m.group || id, had = byGrp.get(g)
        if (!had || (m.label === '全段' && had.label !== '全段') || (m._idx < had._idx && had.label !== '全段')) byGrp.set(g, m)
      })
      byGrp.forEach(m => names.add(m.nameZh.replace(/\s*全段$/, '')))
      hardestSegs = [...names].slice(0, 3)
    }

    const trophies = [...ittTrophies(ym), ...powerTrophies(ym), ...rideTrophies(ym, acts)]
      .sort((a, b) => a.score - b.score || (b.dist || 0) - (a.dist || 0)).slice(0, 7)

    return {
      ym, prevYm, live, today, nDays, cur, prev, counts, top, byDay, hist, hardest, hardestSegs, trophies,
      streak: longestStreak(Object.keys(byDay)),
      daysLeft: live ? nDays - +today.slice(8, 10) : 0,
      hasReport: !!(hardest && Object.values(ex.reports).some(r => r && r.date === hardest.date && !r.skipped)),
      year: +ym.slice(0, 4), month: +ym.slice(5, 7),
    }
  }

  /* ── 圖示（不用 emoji，見 ai-look-tells）───────────────────────── */
  const ICON = {
    ride: `<svg viewBox="0 0 64 40" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13" cy="27" r="10"/><circle cx="51" cy="27" r="10"/><path d="M13 27 24 10h20L51 27M24 10l9 17h-20M33 27l11-17M21 4h7M42 4h6l-4 6"/></svg>`,
    lift: `<svg viewBox="0 0 64 40" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 20h28M8 12v16M14 8v24M50 8v24M56 12v16"/></svg>`,
    run: `<svg viewBox="0 0 64 40" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="38" cy="6" r="3.5"/><path d="M22 18l10-6 8 7 8 1M32 12l-4 12 10 6-2 9M28 24l-10 10"/></svg>`,
    swim: `<svg viewBox="0 0 64 40" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="44" cy="12" r="3.5"/><path d="M14 20l12-8 10 8M6 30c5 0 5-3 10-3s5 3 10 3 5-3 10-3 5 3 10 3 5-3 10-3"/></svg>`,
    other: `<svg viewBox="0 0 64 40" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"><circle cx="32" cy="20" r="12"/></svg>`,
  }
  const tri = up => `<svg class="mr-tri" viewBox="0 0 10 8" aria-hidden="true"><path d="${up ? 'M5 0 10 8H0z' : 'M0 0h10L5 8z'}"/></svg>`

  function delta(cur, prev, label) {
    if (!prev) return `<div class="mr-d"><span class="mr-d-n">—</span><small>上個月沒有${label}</small></div>`
    const p = Math.round((cur - prev) / prev * 100)
    return `<div class="mr-d"><span class="mr-d-n">${p === 0 ? '' : tri(p > 0)}${p > 0 ? '+' : ''}${p}%</span><small>比上個月</small></div>`
  }

  /* ── 投影片 ───────────────────────────────────────────────────── */
  function slides(R) {
    const M = MONTH_ZH[R.month - 1], PM = MONTH_ZH[+R.prevYm.slice(5, 7) - 1]
    const asOf = R.live ? `截至 ${md(R.today)}` : `${R.nDays} 天全月`
    const out = []

    // 1 · 封面：每天的訓練負荷當天際線
    const maxT = Math.max(1, ...Object.values(R.byDay).map(d => d.tss))
    const sky = Array.from({ length: R.nDays }, (_, i) => {
      const ds = `${R.ym}-${pad(i + 1)}`, d = R.byDay[ds], fut = ds > R.today
      const h = d ? 6 + 94 * d.tss / maxT : 2
      return `<i class="${fut ? 'fut' : d && d.sports.has('ride') ? 'on' : d ? 'mid' : ''}" style="--h:${h.toFixed(1)}%"></i>`
    }).join('')
    out.push({ key: 'cover', html: `
      <div class="mr-cover">
        <div class="mr-kick">${R.year} · MONTH IN REVIEW</div>
        <h2 class="mr-month" style="--len:${M.length}">${M}</h2>
        <p class="mr-lede">${R.cur.days} 天、${R.cur.km.toFixed(0)} 公里、${R.cur.hours.toFixed(1)} 小時。<br>${asOf}。</p>
        <div class="mr-sky" aria-hidden="true">${sky}</div>
        <div class="mr-sky-cap"><span>1</span><span>每天的訓練負荷</span><span>${R.nDays}</span></div>
      </div>` })

    // 2 · 總量（照 Strava 那張）
    const c = R.cur, p = R.prev
    out.push({ key: 'totals', html: `
      <div class="mr-panel">
        <div class="mr-top">
          <div><div class="mr-lab">花最多時間的運動</div><div class="mr-icon">${ICON[R.top]}</div><div class="mr-top-n">${SPORT_ZH[R.top]}</div></div>
          <div class="mr-asof">${asOf}</div>
        </div>
        <div class="mr-metric"><div><div class="mr-lab">活動天數</div><b class="mr-big">${c.days}</b></div>${delta(c.days, p.days, '活動')}</div>
        <div class="mr-metric"><div><div class="mr-lab">騎乘距離</div><b class="mr-big">${fmtInt(c.km)}<small>公里</small></b></div>${delta(c.km, p.km, '騎乘')}</div>
        <div class="mr-metric"><div><div class="mr-lab">總時間</div><b class="mr-big">${c.hours.toFixed(1)}<small>小時</small></b></div>${delta(c.hours, p.hours, '活動')}</div>
        <div class="mr-metric"><div><div class="mr-lab">騎乘爬升</div><b class="mr-big">${fmtInt(c.elev)}<small>公尺</small></b></div>${delta(c.elev, p.elev, '爬升')}</div>
        <div class="mr-foot">室內騎乘用功率換算的平路等效里程；Rouvy 自己上傳的那份不算。</div>
      </div>` })

    // 3 · 每一天
    const [y, m] = R.ym.split('-').map(Number)
    const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7
    const cells = Array.from({ length: lead }, () => '<i class="pad"></i>').concat(
      Array.from({ length: R.nDays }, (_, i) => {
        const ds = `${R.ym}-${pad(i + 1)}`, d = R.byDay[ds]
        const cls = ds > R.today ? 'fut' : d && d.sports.has('ride') ? 'ride' : d ? 'train' : 'rest'
        const tag = d ? [...d.sports].map(s => SPORT_ZH[s]).join('＋') : ds > R.today ? '還沒到' : '休息'
        return `<i class="${cls}${ds === R.today ? ' today' : ''}" title="${md(ds)} ${tag}"><span>${i + 1}</span></i>`
      })).join('')
    const mix = ['ride', 'lift', 'run', 'swim', 'other'].filter(s => R.counts[s])
      .map(s => `<span><b>${R.counts[s]}</b>${s === 'ride' ? '趟' : '次'}${SPORT_ZH[s]}</span>`).join('')
    out.push({ key: 'days', html: `
      <div class="mr-panel">
        <div class="mr-lab">動了幾天</div>
        <div class="mr-hero-n">${R.cur.days}<small>／${R.live ? +R.today.slice(8, 10) : R.nDays} 天</small></div>
        <div class="mr-cal">
          <div class="mr-cal-h"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div>
          <div class="mr-cal-g">${cells}</div>
        </div>
        <div class="mr-legend"><span><i class="ride"></i>有騎車</span><span><i class="train"></i>其他訓練</span><span><i class="rest"></i>沒紀錄</span></div>
        <div class="mr-mix">${mix}</div>
        <div class="mr-foot">最長連續 ${R.streak} 天有紀錄。籃球、有氧課不戴錶的話這裡看不到。</div>
      </div>` })

    // 4 · 15.3 h 損益線
    const rh = R.cur.rideHours, gap = BREAKEVEN_H - rh
    const hmax = Math.max(BREAKEVEN_H * 1.35, ...R.hist.map(x => x.h))
    const bars = R.hist.map((x, i) => {
      const last = i === R.hist.length - 1
      return `<div class="mr-bar${last ? ' now' : ''}${x.h >= BREAKEVEN_H ? ' over' : ''}">
        <i style="--h:${(x.h / hmax * 100).toFixed(1)}%"></i><span>${+x.ym.slice(5, 7)}</span></div>`
    }).join('')
    const overN = R.hist.filter(x => x.h >= BREAKEVEN_H).length
    const verdict = gap <= 0 ? `過線 ${(-gap).toFixed(1)} 小時。這個量撐得住體能。`
      : R.live && R.daysLeft > 0 ? `還差 ${gap.toFixed(1)} 小時，這個月還剩 ${R.daysLeft} 天。`
      : `差 ${gap.toFixed(1)} 小時沒過線。低於這條線，eFTP 就在往下掉。`
    out.push({ key: 'line', html: `
      <div class="mr-panel">
        <div class="mr-lab">騎乘時數 vs 損益線</div>
        <div class="mr-hero-n">${rh.toFixed(1)}<small>／${BREAKEVEN_H} 小時</small></div>
        <p class="mr-say">${verdict}</p>
        <div class="mr-bars" style="--line:${(BREAKEVEN_H / hmax * 100).toFixed(1)}%">${bars}<div class="mr-line"><span>${BREAKEVEN_H} h</span></div></div>
        <div class="mr-foot">近 12 個月有 ${overN} 個月過線。線是用自己 17 個月的月時數對 eFTP 變化迴歸出來的。</div>
      </div>` })

    // 5 · 獎盃櫃
    if (R.trophies.length) {
      out.push({ key: 'trophy', ms: SLIDE_MS + 2000, html: `
        <div class="mr-trophy">
          <div class="mr-lab mr-center">獎盃櫃</div>
          <div class="mr-hero-n mr-center">${R.trophies.length}<small> 項前三名</small></div>
          <div class="mr-fan" data-fan>${R.trophies.map((t, i) => `
            <div class="mr-card" data-i="${i}">
              <div class="mr-gem"><div><b>${t.badge}</b><small>${t.kind === 'itt' ? 'ITT' : t.kind === 'power' ? 'POWER' : 'RIDE'}</small></div></div>
              <div class="mr-card-k">${esc(t.kicker)}</div>
              <div class="mr-card-v">${esc(t.value)}${t.unit ? `<small>${t.unit}</small>` : ''}</div>
              <div class="mr-card-n">${esc(t.name)}</div>
              <div class="mr-card-f">${esc(t.foot)}${t.kind !== 'ride' && t.kind !== 'power' ? ` · ${md(t.date)}` : ''}</div>
            </div>`).join('')}
          </div>
          <button class="mr-shuffle" type="button" data-shuffle>換一張到前面</button>
        </div>` })
    }

    // 6 · 最硬的一趟
    const H = R.hardest
    if (H) out.push({ key: 'hardest', html: `
      <div class="mr-panel">
        <div class="mr-lab">這個月最硬的一趟</div>
        <div class="mr-date">${md(H.date)}<small>週${['日', '一', '二', '三', '四', '五', '六'][new Date(H.date).getDay()]}</small></div>
        ${R.hardestSegs.length ? `<p class="mr-say">${R.hardestSegs.map(esc).join(' · ')}</p>` : `<p class="mr-say">${H.indoor ? '室內' : esc(H.name)}</p>`}
        <div class="mr-grid">
          <div><div class="mr-lab">訓練負荷</div><b class="mr-mid">${fmtInt(H.tss)}<small>TSS</small></b></div>
          <div><div class="mr-lab">標準化功率</div><b class="mr-mid">${H.np ? fmtInt(H.np) : '—'}<small>W</small></b></div>
          <div><div class="mr-lab">${H.indoor ? '等效距離' : '距離'}</div><b class="mr-mid">${H.km.toFixed(1)}<small>km</small></b></div>
          <div><div class="mr-lab">爬升</div><b class="mr-mid">${H.indoor ? '—' : fmtInt(H.elev)}<small>m</small></b></div>
          <div><div class="mr-lab">移動時間</div><b class="mr-mid">${fmtClock(H.sec)}</b></div>
        </div>
        ${R.hasReport ? `<a class="mr-link" href="rides/${H.date}.html">看那天的報告 →</a>` : ''}
      </div>` })

    // 7 · 收尾
    const NM = MONTH_ZH[R.month % 12]
    const next = R.live && R.daysLeft > 0
      ? (gap > 0 ? `還剩 ${R.daysLeft} 天，再 ${gap.toFixed(1)} 小時就過線。` : `還剩 ${R.daysLeft} 天。`)
      : `${PM}到${M}：${delta(c.km, p.km, '騎乘').includes('—') ? '' : `里程 ${c.km >= p.km ? '多' : '少'}了 ${Math.abs(c.km - p.km).toFixed(0)} 公里。`}`
    out.push({ key: 'end', html: `
      <div class="mr-cover mr-end">
        <div class="mr-kick">${R.year} · ${M}</div>
        ${(t => `<h2 class="mr-month" style="--len:${t.length}">${t}</h2>`)(R.live && R.daysLeft > 0 ? '最後衝刺' : `${NM}見`)}
        <p class="mr-lede">${next}</p>
        <div class="mr-actions">
          ${R.liveNext ? `<button type="button" data-goym="${R.liveNext.ym}">看${MONTH_ZH[R.liveNext.month - 1]}至今</button>` : `<button type="button" data-replay>重看一次</button>`}
          <button type="button" data-close class="solid">回到現況</button>
        </div>
      </div>` })
    return out
  }

  /* ── 樣式 ─────────────────────────────────────────────────────── */
  const CSS = `
.mr-entry{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:14px;width:100%;
  padding:14px 16px 14px 14px;margin:0 0 18px;background:linear-gradient(100deg,rgba(252,76,2,.16),rgba(252,76,2,.03) 60%);
  border:1px solid var(--sig-hair,rgba(252,76,2,.14));border-radius:8px;color:var(--ink-1,#f4f0ea);
  font:inherit;text-align:left;cursor:pointer;transition:background .2s}
.mr-entry:hover{background:linear-gradient(100deg,rgba(252,76,2,.26),rgba(252,76,2,.05) 60%)}
.mr-entry:focus-visible{outline:2px solid var(--sig,#FC4C02);outline-offset:2px}
.mr-entry-m{font:800 30px/0.9 var(--f-ui);letter-spacing:.5px}
.mr-entry-t{min-width:0}
.mr-entry-t i{display:block;font:700 8.5px/1.4 var(--f-ui);letter-spacing:2.4px;color:var(--sig,#FC4C02);font-style:normal}
.mr-entry-t b{display:block;font:700 15px/1.35 var(--f-ui);margin-top:2px}
.mr-entry-t span{display:block;font-size:12px;color:var(--ink-2);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mr-entry-go{font:700 12.5px var(--f-ui);color:var(--sig,#FC4C02);white-space:nowrap}
.mr-entry:has(+ .mr-entry-live){margin-bottom:6px}
.mr-entry-live{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:12px;align-items:center;width:100%;margin:0 0 18px;
  padding:9px 16px;border:1px solid var(--hair-2,rgba(255,255,255,.11));border-radius:8px;background:transparent;
  color:var(--ink-2);font:600 12.5px var(--f-ui);text-align:left;cursor:pointer}
.mr-entry-live span:first-child{color:var(--ink-1,#f4f0ea)}
.mr-entry-live span:nth-child(2){white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mr-entry-live b{color:var(--sig,#FC4C02);font-weight:700;white-space:nowrap}
.mr-entry-live:hover{border-color:var(--sig-hair,rgba(252,76,2,.14))}

.mr-ov{position:fixed;inset:0;width:100%;height:100%;z-index:10050;display:flex;align-items:center;justify-content:center;
  background:rgba(4,2,4,.82);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);opacity:0;transition:opacity .25s}
.mr-ov.open{opacity:1}
.mr-ov[hidden]{display:none!important}
.mr-stage{position:relative;width:min(430px,100%);height:min(860px,100%);overflow:hidden;color:#fff;container-type:inline-size;text-transform:none;letter-spacing:normal;text-align:left;
  font-family:var(--f-ui);border-radius:20px;box-shadow:0 30px 90px rgba(0,0,0,.6);
  background:radial-gradient(130% 62% at 50% 112%,#ffb070 0%,#FC4C02 20%,#9a2203 44%,#2a0805 70%,#0a0408 100%)}
.mr-stage[data-k="cover"],.mr-stage[data-k="end"]{background:radial-gradient(120% 70% at 30% 100%,#ffb070 0%,#FC4C02 24%,#8a1c02 50%,#1a0604 78%,#0a0408 100%)}
.mr-stage[data-k="trophy"]{background:radial-gradient(140% 55% at 50% 118%,#ffa060 0%,#FC4C02 18%,#6a1602 46%,#0a0408 78%)}
@media (max-width:520px){.mr-stage{position:absolute;inset:0;width:auto;height:auto;border-radius:0}}
.mr-head{position:absolute;inset:0 0 auto 0;z-index:4;padding:14px 16px 0;pointer-events:none}
.mr-prog{display:flex;gap:4px}
.mr-prog i{flex:1;height:3px;border-radius:2px;background:rgba(255,255,255,.28);overflow:hidden}
.mr-prog i b{display:block;height:100%;width:0;background:#fff}
.mr-prog i.done b{width:100%}
.mr-bar-row{display:flex;align-items:center;justify-content:space-between;margin-top:12px}
.mr-brand{font:700 8.5px/1 var(--f-ui);letter-spacing:2.4px;color:rgba(255,255,255,.8)}
.mr-x{pointer-events:auto;width:40px;height:40px;border-radius:50%;border:0;background:rgba(255,255,255,.1);color:#fff;
  display:grid;place-items:center;cursor:pointer}
.mr-x:hover{background:rgba(255,255,255,.2)}
.mr-x svg{width:16px;height:16px}
.mr-body{position:absolute;inset:0;padding:92px 24px 30px;display:flex;flex-direction:column}
.mr-body.in{animation:mr-in .45s cubic-bezier(.2,.7,.2,1) both}
@keyframes mr-in{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
.mr-tap{position:absolute;inset:80px 0 0;z-index:2;display:grid;grid-template-columns:1fr 2fr}
.mr-tap button{border:0;background:transparent;cursor:pointer;-webkit-tap-highlight-color:transparent}
.mr-tap button:focus-visible{outline:2px solid rgba(255,255,255,.6);outline-offset:-6px}
.mr-body a,.mr-body [data-shuffle],.mr-body [data-fan],.mr-body .mr-actions{position:relative;z-index:3}

.mr-lab{font-size:13px;color:rgba(255,255,255,.72);letter-spacing:.5px}
.mr-center{text-align:center}
.mr-foot{margin-top:auto;font-size:11.5px;line-height:1.5;color:rgba(255,255,255,.62)}
.mr-say{margin:6px 0 0;font-size:15px;line-height:1.5;color:rgba(255,255,255,.92)}
.mr-kick{font:700 9px/1.4 var(--f-ui);letter-spacing:2.6px;color:rgba(255,255,255,.75)}
.mr-cover{display:flex;flex-direction:column;height:100%;justify-content:flex-end}
.mr-month{margin:6px 0 0;font:800 clamp(84px,27vw,124px)/0.95 var(--f-ui);letter-spacing:2px;white-space:nowrap;
  font-size:min(124px,calc((100cqw - 52px) / var(--len,2)))}
.mr-lede{margin:18px 0 0;font-size:17px;line-height:1.55;color:rgba(255,255,255,.9)}
.mr-sky{margin-top:34px;height:120px;display:flex;align-items:flex-end;gap:3px}
.mr-sky i{flex:1;height:var(--h);min-height:2px;border-radius:2px 2px 0 0;background:rgba(255,255,255,.2)}
.mr-sky i.on{background:#fff}
.mr-sky i.mid{background:rgba(255,255,255,.55)}
.mr-sky i.fut{background:transparent;border-top:1px dashed rgba(255,255,255,.35)}
.mr-body.in .mr-sky i{animation:mr-grow .8s cubic-bezier(.2,.7,.2,1) both;animation-delay:calc(var(--d,0) * 1ms)}
@keyframes mr-grow{from{transform:scaleY(0);transform-origin:bottom}to{transform:scaleY(1);transform-origin:bottom}}
.mr-sky-cap{display:flex;justify-content:space-between;margin-top:8px;font-size:10.5px;color:rgba(255,255,255,.6)}

.mr-panel{display:flex;flex-direction:column;height:100%}
.mr-top{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,.14)}
.mr-icon{width:92px;color:#ff7a2a;margin-top:10px;filter:drop-shadow(0 4px 12px rgba(252,76,2,.45))}
.mr-top-n{font-weight:700;font-size:15px;margin-top:6px}
.mr-asof{font-size:11.5px;color:rgba(255,255,255,.6);padding-top:2px}
.mr-metric{display:flex;justify-content:space-between;align-items:flex-end;padding:13px 0;border-bottom:1px solid rgba(255,255,255,.08)}
.mr-big{display:block;font:800 46px/0.95 var(--f-num);letter-spacing:-.5px;margin-top:4px}
.mr-big small,.mr-hero-n small,.mr-mid small,.mr-card-v small,.mr-date small{font:600 15px var(--f-ui);letter-spacing:0;margin-left:5px;color:rgba(255,255,255,.8)}
.mr-d{text-align:right}
.mr-d-n{display:inline-flex;align-items:center;gap:5px;font:800 26px/1 var(--f-num)}
.mr-tri{width:12px;height:10px;fill:currentColor}
.mr-d small{display:block;font-size:11.5px;color:rgba(255,255,255,.6);margin-top:3px}
.mr-hero-n{font:800 64px/0.95 var(--f-num);margin-top:6px}

.mr-cal{margin-top:22px}
.mr-cal-h,.mr-cal-g{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}
.mr-cal-h span{text-align:center;font-size:11px;color:rgba(255,255,255,.5);padding-bottom:4px}
.mr-cal-g i{aspect-ratio:1;border-radius:7px;display:grid;place-items:center;font:600 11px var(--f-ui);font-style:normal;color:rgba(255,255,255,.45);background:rgba(255,255,255,.06)}
.mr-cal-g i.pad{background:none}
.mr-cal-g i.ride{background:#fff;color:#8a1c02}
.mr-cal-g i.train{background:rgba(255,255,255,.3);color:#fff}
.mr-cal-g i.fut{background:none;border:1px dashed rgba(255,255,255,.22)}
.mr-cal-g i.today{box-shadow:0 0 0 2px #0a0408,0 0 0 3.5px #fff}
.mr-legend{display:flex;gap:16px;margin-top:14px;font-size:11.5px;color:rgba(255,255,255,.7)}
.mr-legend span{display:flex;align-items:center;gap:6px}
.mr-legend i{width:10px;height:10px;border-radius:3px;background:rgba(255,255,255,.06)}
.mr-legend i.ride{background:#fff}.mr-legend i.train{background:rgba(255,255,255,.3)}
.mr-mix{display:flex;flex-wrap:wrap;gap:6px 18px;margin-top:22px;font-size:14px;color:rgba(255,255,255,.85)}
.mr-mix b{font:800 26px/1 var(--f-num);margin-right:4px;color:#fff}

.mr-bars{position:relative;margin-top:28px;height:190px;display:flex;align-items:flex-end;gap:6px;padding-bottom:20px}
.mr-bar{flex:1;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;position:relative}
.mr-bar i{width:100%;height:var(--h);border-radius:3px 3px 0 0;background:rgba(255,255,255,.22)}
.mr-bar.over i{background:rgba(255,255,255,.55)}
.mr-bar.now i{background:#fff}
.mr-bar span{position:absolute;bottom:-18px;font-size:10px;color:rgba(255,255,255,.55)}
.mr-bar.now span{color:#fff;font-weight:700}
.mr-body.in .mr-bar i{animation:mr-grow .7s cubic-bezier(.2,.7,.2,1) both}
.mr-line{position:absolute;left:0;right:0;border-top:1.5px dashed rgba(255,255,255,.85)}
.mr-line span{position:absolute;right:0;top:-18px;font:700 11px var(--f-ui);color:#fff}

.mr-trophy{display:flex;flex-direction:column;height:100%}
.mr-fan{position:relative;flex:1;min-height:300px;margin:8px -24px 0;cursor:pointer}
.mr-card{position:absolute;left:50%;top:44%;width:170px;height:230px;margin:-115px 0 0 -85px;padding:16px 14px;border-radius:16px;
  background:linear-gradient(160deg,#2a2226,#141013);border:1px solid rgba(255,255,255,.1);box-shadow:0 18px 40px rgba(0,0,0,.5);
  display:flex;flex-direction:column;transition:transform .55s cubic-bezier(.2,.7,.2,1),filter .4s}
.mr-card.side{filter:brightness(.55) saturate(.8)}
.mr-gem{width:78px;height:78px;margin:4px auto 14px;transform:rotate(45deg);border-radius:16px;display:grid;place-items:center;
  background:linear-gradient(135deg,#ff9a4a,#FC4C02 55%,#c93a02);box-shadow:inset 0 2px 0 rgba(255,255,255,.35),0 8px 18px rgba(252,76,2,.35)}
.mr-gem>div{transform:rotate(-45deg);text-align:center}
.mr-gem b{display:block;font:800 40px/0.9 var(--f-num);color:#fff}
.mr-gem small{display:block;font:700 7.5px var(--f-ui);letter-spacing:1.6px;color:rgba(255,255,255,.85);margin-top:2px}
.mr-card-k{font-size:12px;font-weight:700;color:#ff8a3a}
.mr-card-v{font:800 34px/1 var(--f-num);margin-top:4px}
.mr-card-v small{font-size:12px}
.mr-card-n{font-size:12.5px;font-weight:600;margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mr-card-f{font-size:10.5px;color:rgba(255,255,255,.55);margin-top:auto}
.mr-shuffle{align-self:center;margin-top:8px;padding:9px 16px;border-radius:100px;border:1px solid rgba(255,255,255,.4);background:rgba(0,0,0,.25);color:#fff;font:600 13px var(--f-ui);cursor:pointer}

.mr-date{font:800 76px/0.95 var(--f-num);margin-top:6px}
.mr-date small{font-size:20px;font-weight:700}
.mr-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px 12px;margin-top:26px;padding-top:18px;border-top:1px solid rgba(255,255,255,.14)}
.mr-mid{display:block;font:800 34px/1 var(--f-num);margin-top:4px}
.mr-link{margin-top:auto;align-self:flex-start;color:#fff;font-weight:700;font-size:14px;text-decoration:none;padding:10px 0;border-bottom:1.5px solid rgba(255,255,255,.6)}

.mr-actions{display:flex;gap:10px;margin-top:40px}
.mr-actions button{flex:1;padding:14px 10px;border-radius:100px;border:1px solid rgba(255,255,255,.5);background:transparent;color:#fff;font:700 14px var(--f-ui);cursor:pointer}
.mr-actions button.solid{background:#fff;color:#1a0604;border-color:#fff}
@media (prefers-reduced-motion:reduce){.mr-body.in,.mr-body.in *{animation:none!important}.mr-card{transition:none}}
`

  /* ── 播放器 ───────────────────────────────────────────────────── */
  let ov, stage, body, prog, list = [], idx = 0, t0 = 0, elapsed = 0, paused = false, raf = 0, lastFocus = null, pushed = false
  let fanOrder = []

  function ensureDom() {
    if (ov) return
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st)
    ov = document.createElement('div')
    ov.className = 'mr-ov'; ov.hidden = true
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', '月總結')
    ov.innerHTML = `<div class="mr-stage">
      <div class="mr-head"><div class="mr-prog"></div>
        <div class="mr-bar-row"><span class="mr-brand">MONTH IN REVIEW</span>
          <button class="mr-x" type="button" aria-label="關閉" data-close><svg viewBox="0 0 16 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 2l12 12M14 2 2 14"/></svg></button></div></div>
      <div class="mr-tap"><button type="button" aria-label="上一張" data-prev></button><button type="button" aria-label="下一張" data-next></button></div>
      <div class="mr-body" aria-live="polite"></div>
    </div>`
    document.body.appendChild(ov)
    stage = ov.querySelector('.mr-stage'); body = ov.querySelector('.mr-body'); prog = ov.querySelector('.mr-prog')

    ov.addEventListener('click', e => {
      if (e.target === ov) return close()
      const b = e.target.closest('[data-close],[data-prev],[data-next],[data-replay],[data-shuffle],[data-fan],[data-goym]')
      if (!b) return
      if (b.hasAttribute('data-goym')) {
        const ym = b.dataset.goym
        if (/^#recap/.test(location.hash)) history.replaceState(history.state, '', `#recap/${ym}`)
        return show(ym)
      }
      if (b.hasAttribute('data-close')) return close()
      if (b.hasAttribute('data-replay')) return go(0)
      if (b.hasAttribute('data-shuffle') || b.hasAttribute('data-fan')) { shuffleFan(); elapsed = 0; t0 = performance.now(); return }
      if (heldLong) return
      if (b.hasAttribute('data-prev')) return go(idx - 1)
      if (b.hasAttribute('data-next')) return go(idx + 1)
    })
    // 按住暫停（Strava 的行為）；短按照常翻頁
    let holdT = 0, heldLong = false
    stage.addEventListener('pointerdown', e => {
      if (!e.target.closest('.mr-tap')) return
      heldLong = false
      holdT = setTimeout(() => { heldLong = true; paused = true }, 220)
    })
    const release = () => { clearTimeout(holdT); if (heldLong) { paused = false; t0 = performance.now() - elapsed } }
    stage.addEventListener('pointerup', release)
    stage.addEventListener('pointercancel', release)
    document.addEventListener('keydown', e => {
      if (ov.hidden) return
      if (e.key === 'Escape') { e.preventDefault(); close() }
      else if (e.key === 'ArrowRight') go(idx + 1)
      else if (e.key === 'ArrowLeft') go(idx - 1)
      else if (e.key === ' ' && !e.target.closest('button')) { e.preventDefault(); paused = !paused; t0 = performance.now() - elapsed }
    })
    document.addEventListener('visibilitychange', () => { if (!ov.hidden && !document.hidden) t0 = performance.now() - elapsed })
  }

  function layoutFan() {
    const cards = [...body.querySelectorAll('.mr-card')]
    const n = cards.length, mid = (n - 1) / 2
    fanOrder.forEach((ci, pos) => {
      const k = pos - mid
      const el = cards[ci]
      el.style.zIndex = String(100 - Math.abs(Math.round(k * 2)) + (pos === Math.round(mid) ? 50 : 0))
      el.classList.toggle('side', pos !== Math.round(mid))
      el.style.transform = `translateX(${k * 62}px) translateY(${Math.abs(k) * 14}px) rotate(${k * 9}deg)`
    })
  }
  function shuffleFan() {
    if (!fanOrder.length) return
    // 把最右邊那張移到正中間 —— 每點一次換一張到前面，而不是真的隨機（隨機會連兩次看到同一張）
    const mid = Math.round((fanOrder.length - 1) / 2)
    const last = fanOrder.pop(); fanOrder.splice(mid, 0, last)
    layoutFan()
  }

  function go(i) {
    if (i < 0) i = 0
    if (i >= list.length) { idx = list.length - 1; elapsed = cur().ms; paint(); return }
    idx = i; elapsed = 0; t0 = performance.now()
    const s = list[idx]
    stage.dataset.k = s.key
    body.classList.remove('in'); void body.offsetWidth
    body.innerHTML = s.html
    body.classList.add('in')
    body.querySelectorAll('.mr-sky i').forEach((el, k) => el.style.setProperty('--d', k * 18))
    const bars = body.querySelector('.mr-bars')
    if (bars) {
      const line = bars.querySelector('.mr-line')
      line.style.bottom = `calc(20px + (100% - 20px) * ${parseFloat(bars.style.getPropertyValue('--line')) / 100})`
    }
    if (body.querySelector('[data-fan]')) {
      const n = body.querySelectorAll('.mr-card').length
      // 最好的一張（排序第一）放正中間
      const mid = Math.round((n - 1) / 2), order = Array(n)
      let l = mid - 1, r = mid + 1; order[mid] = 0
      for (let c = 1; c < n; c++) { if (c % 2) { if (r < n) order[r++] = c; else order[l--] = c } else { if (l >= 0) order[l--] = c; else order[r++] = c } }
      fanOrder = order
      layoutFan()
    } else fanOrder = []
    paint()
  }
  const cur = () => ({ ms: list[idx].ms || SLIDE_MS })

  function paint() {
    const bars = prog.children
    for (let k = 0; k < bars.length; k++) {
      bars[k].classList.toggle('done', k < idx)
      bars[k].firstChild.style.width = k < idx ? '100%' : k > idx ? '0' : `${Math.min(100, elapsed / cur().ms * 100)}%`
    }
  }

  function tick(now) {
    raf = requestAnimationFrame(tick)
    if (paused || document.hidden) return
    elapsed = now - t0
    // 最後一張不自動關，停在那裡讓人按「重看」或「回到現況」
    if (elapsed >= cur().ms && idx < list.length - 1) return go(idx + 1)
    if (idx === list.length - 1) elapsed = Math.min(elapsed, cur().ms)
    paint()
  }

  async function show(ym) {
    const ex = await loadExtras()
    const R = buildRecap(ym, ex)
    if (!R) return null
    const nowYm = ymOf(new Date())
    if (ym < nowYm) R.liveNext = buildRecap(nowYm, ex)
    ensureDom()
    list = slides(R)
    prog.innerHTML = list.map(() => '<i><b></b></i>').join('')
    go(0)
    return R
  }

  async function open(ym, opts = {}) {
    if (!await show(ym)) return false
    lastFocus = document.activeElement
    ov.hidden = false
    requestAnimationFrame(() => ov.classList.add('open'))
    document.documentElement.style.overflow = 'hidden'
    paused = false
    cancelAnimationFrame(raf); raf = requestAnimationFrame(tick)
    ov.querySelector('.mr-x').focus({ preventScroll: true })
    if (opts.push) { history.pushState({ recap: ym }, '', `#recap/${ym}`); pushed = true }
    return true
  }

  function close(fromPop) {
    if (!ov || ov.hidden) return
    cancelAnimationFrame(raf)
    ov.classList.remove('open')
    ov.hidden = true
    document.documentElement.style.overflow = ''
    if (!fromPop) {
      if (pushed) history.back()
      else if (/^#recap/.test(location.hash)) history.replaceState(null, '', '#overview')
    }
    pushed = false
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true })
  }

  /* ── 入口與路由 ───────────────────────────────────────────────── */
  /* 月初那一週主角是上個月，但新的這個月也已經開始累積 —— 給它一條次要入口，
     這個月還沒有任何活動就不出現（buildRecap 回 null）。 */
  function liveLink(R, ex) {
    const nowYm = ymOf(new Date())
    if (R.ym === nowYm) return ''
    const L = buildRecap(nowYm, ex)
    if (!L) return ''
    return `<button class="mr-entry-live" type="button" data-recap="${nowYm}">
      <span>${MONTH_ZH[L.month - 1]}至今</span><span>${L.cur.days} 天 · ${fmtInt(L.cur.km)} km · ${L.cur.hours.toFixed(1)} h</span><b>看 →</b></button>`
  }

  async function mountEntry() {
    const slot = document.getElementById('recap-slot')
    const ym = windowMonth()
    if (!slot || !ym) return
    const ex = await loadExtras()
    const R = buildRecap(ym, ex)
    if (!R) return
    const M = MONTH_ZH[R.month - 1]
    slot.innerHTML = `<button class="mr-entry" type="button" data-recap="${ym}">
      <span class="mr-entry-m">${R.month}<small style="font-size:13px;font-weight:700;margin-left:2px">月</small></span>
      <span class="mr-entry-t"><i>MONTH IN REVIEW${R.live ? ` · 截至 ${md(R.today)}` : ''}</i>
        <b>${M}總結出來了</b>
        <span>${R.cur.days} 天 · ${fmtInt(R.cur.km)} km · ${R.cur.hours.toFixed(1)} h${R.trophies.length ? ` · ${R.trophies.length} 項前三名` : ''}</span></span>
      <span class="mr-entry-go">看 →</span></button>${liveLink(R, ex)}`
    ensureDom()
    slot.querySelectorAll('[data-recap]').forEach(b =>
      b.addEventListener('click', e => open(e.currentTarget.dataset.recap, { push: true })))
  }

  function fromHash() {
    const m = /^#recap(?:\/(\d{4}-\d{2}))?/.exec(location.hash || '')
    if (!m) { close(true); return }
    const ym = m[1] || windowMonth() || shiftYm(ymOf(new Date()), -1)
    if (ov && !ov.hidden) return
    open(ym)
  }

  function boot() {
    mountEntry()
    fromHash()
    addEventListener('popstate', fromHash)
  }

  window.__openRecap = ym => open(ym || windowMonth() || shiftYm(ymOf(new Date()), -1), { push: true })
  if (window.__stravaReady) boot()
  else addEventListener('strava:ready', boot, { once: true })
})()
