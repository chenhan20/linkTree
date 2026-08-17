/* itt-achievements.js — ITT「最佳結果」的共用計算
 *
 * 為什麼要這一支：
 *   活動卡（strava.html 的活動列表）與活動詳情彈窗（activity-modal.js，被七個主題頁共用）
 *   都要回答同一個問題 ——「這趟騎乘裡，哪幾段跑出值得說嘴的成績？」
 *   兩邊各算一次必然漂移，所以名次、層級、配對規則全部收在這裡，兩邊只負責畫。
 *
 * 門檻是抄 Strava 活動頁「最佳結果」那一塊的：只有前三名會浮到活動上，
 * 其餘收進抽屜。差別在多一個較弱的「今年最佳」層級 —— 同一條坡騎了二三十次之後，
 * 全時前三會愈來愈難碰到，但「今年最快」仍然是有意義的訊號。
 *
 * 用法：
 *   const itt = window.ittAchievements(segments, { meta: window._ittSegMeta })
 *   itt.byDate['2026-08-04']        // 那天的成就列（已排序）
 *   itt.assign(rides).get('123')    // 精準配對到某一趟活動的成就列
 */
;(function () {
  'use strict'

  /* 層級由強到弱。排序、配色、文案全部吃這個順序。 */
  var TIER_ORDER = { pr: 0, second: 1, third: 2, year: 3 }
  var TIER_LABEL = { pr: '個人紀錄', second: '第 2 快', third: '第 3 快', year: '今年最佳' }
  var TIER_MEDAL = { pr: '🏆', second: '🥈', third: '🥉', year: '📅' }
  /* 沿用 .pa-chip 既有的名次配色：金 / 銀 / 銅，第四級刻意用中性灰藍壓下去 */
  var TIER_CLASS = { pr: 'r1', second: 'r2', third: 'r3', year: 'ry' }

  /* 時間軸排序鍵：同一天的多趟靠 start_time 分先後（與 strava.html 的 effortTimeKey 同義） */
  function timeKey(e) {
    return String((e && e.date) || '') + ' ' + String((e && e.start_time) || '00:00')
  }

  /* 'HH:MM' → 分鐘數。拿不到就回 -1，讓呼叫端知道沒有時間可比。 */
  function toMin(hhmm) {
    var m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''))
    return m ? (+m[1]) * 60 + (+m[2]) : -1
  }

  /* 與 PR 的差距。秒數大了以後 "+312s" 難讀，換成 "+5:12"。 */
  function fmtDelta(sec) {
    if (sec == null) return ''
    var s = Math.round(sec)
    if (s <= 0) return '— PR'
    if (s < 60) return '+' + s + 's'
    return '+' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
  }

  function fmtElapsed(sec) {
    var s = Math.round(sec || 0)
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60
    return h > 0
      ? h + ':' + String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0')
      : m + ':' + String(ss).padStart(2, '0')
  }

  /* 這一組成就列該掛什麼標題。兩個渲染端共用同一份文案。 */
  function headline(rows) {
    var prs = rows.filter(function (r) { return r.tier === 'pr' })
    if (prs.length) {
      return { isPr: true, medal: '🏆', zh: '路段新猷 · 刷新 ' + prs.length + ' 項個人紀錄', en: 'SEGMENT PR' }
    }
    var top3 = rows.filter(function (r) { return r.tier === 'second' || r.tier === 'third' })
    if (top3.length) {
      var best = rows[0]
      return { isPr: false, medal: TIER_MEDAL[best.tier], zh: '路段佳績 · 擠進歷史前三', en: 'SEGMENT TOP 3' }
    }
    return { isPr: false, medal: '📅', zh: '今年最佳 · ' + rows.length + ' 段', en: 'SEASON BEST' }
  }

  function build(segments, opts) {
    opts = opts || {}
    var meta = opts.meta || null
    var all = []   // 每一筆 effort，成就與否都在裡面

    ;(segments || []).forEach(function (seg) {
      if (!seg) return
      var efforts = (seg.efforts || []).filter(function (e) { return e && e.elapsed_sec != null })
      if (!efforts.length) return

      /* 用包裝物件排名次，不用字串鍵 —— 449/542 筆 effort 的 activity_id 是 null
         （來源是自建 FIT），有 68 筆連 start_time 都沒有，任何字串鍵都可能撞在一起。 */
      var items = efforts.map(function (e) { return { e: e } })

      items.slice().sort(function (a, b) { return a.e.elapsed_sec - b.e.elapsed_sec })
        .forEach(function (it, i) { it.rank = i + 1 })

      items.slice().sort(function (a, b) { return timeKey(a.e).localeCompare(timeKey(b.e)) })
        .forEach(function (it, i) { it.attemptNum = i + 1 })

      var byYear = {}
      items.forEach(function (it) {
        var y = String(it.e.date || '').slice(0, 4)
        ;(byYear[y] = byYear[y] || []).push(it)
      })
      Object.keys(byYear).forEach(function (y) {
        byYear[y].sort(function (a, b) { return a.e.elapsed_sec - b.e.elapsed_sec })
          .forEach(function (it, i) { it.yearRank = i + 1 })
      })

      var prSec = Math.min.apply(null, efforts.map(function (e) { return e.elapsed_sec }))
      var m = meta && meta[seg.id] ? meta[seg.id] : null
      var name = (m && (m.nameZh || m.name)) || seg.name || '路段'

      items.forEach(function (it) {
        var tier = it.rank === 1 ? 'pr'
          : it.rank === 2 ? 'second'
            : it.rank === 3 ? 'third'
              : it.yearRank === 1 ? 'year' : null
        var e = it.e
        all.push({
          segId:       seg.id,
          segName:     name,
          date:        String(e.date || '').slice(0, 10),
          startTime:   e.start_time || null,
          activityId:  e.activity_id != null ? e.activity_id : null,
          elapsedSec:  e.elapsed_sec,
          elapsedStr:  e.elapsed_str || fmtElapsed(e.elapsed_sec),
          rank:        it.rank,
          total:       items.length,
          attemptNum:  it.attemptNum,
          yearRank:    it.yearRank,
          prSec:       prSec,
          deltaSec:    e.elapsed_sec - prSec,
          tier:        tier,
          tierLabel:   tier ? TIER_LABEL[tier] : '',
          medal:       tier ? TIER_MEDAL[tier] : '',
          rankClass:   tier ? TIER_CLASS[tier] : '',
          deltaStr:    fmtDelta(e.elapsed_sec - prSec),
          /* 「今年最佳」不等於名次好 —— 同一條坡騎到第 29 次，今年最快也可能只是全時第 9。
             不把全時名次寫出來就是在灌水，所以這一層額外帶一行註記。 */
          rankNote:    tier === 'year' ? '全時第 ' + it.rank : '',
          avgWatts:    e.avg_watts != null ? e.avg_watts : null,
          avgHr:       e.avg_heartrate != null ? e.avg_heartrate : null,
        })
      })
    })

    /* 強的排前面；同層級以「離 PR 多近」定序 —— ITT 看的是差距不是名次。 */
    function cmp(a, b) {
      return (TIER_ORDER[a.tier] - TIER_ORDER[b.tier]) || (a.deltaSec - b.deltaSec)
    }
    var rows = all.filter(function (r) { return !!r.tier })
    rows.sort(cmp)

    var byDate = {}
    rows.forEach(function (r) { (byDate[r.date] = byDate[r.date] || []).push(r) })
    Object.keys(byDate).forEach(function (d) { byDate[d].sort(cmp) })

    /* 一天兩趟的日子（recent_rides 裡有 13 天）不能只靠日期掛徽章，
       否則早上的中社成績會同時出現在傍晚那趟上。優先用 activity_id，
       沒有就用起跑時間落在哪一趟的窗口內。 */
    function assignRows(rides, source) {
      var out = new Map()
      var byDay = {}
      var rowsByDate = {}
      source.forEach(function (r) { (rowsByDate[r.date] = rowsByDate[r.date] || []).push(r) })
      ;(rides || []).forEach(function (r) {
        if (!r) return
        var d = String(r.date || '').slice(0, 10)
        ;(byDay[d] = byDay[d] || []).push(r)
      })
      function push(ride, row) {
        var k = String(ride.id)
        if (!out.has(k)) out.set(k, [])
        out.get(k).push(row)
      }
      Object.keys(byDay).forEach(function (d) {
        var dayRides = byDay[d].slice().sort(function (a, b) { return toMin(a.time) - toMin(b.time) })
        var dayRows = rowsByDate[d] || []
        dayRows.forEach(function (row) {
          if (row.activityId != null) {
            var hit = dayRides.filter(function (r) { return String(r.id) === String(row.activityId) })[0]
            /* 帶了 activity_id 卻不在清單裡 → 那是沒顯示的活動，不要亂猜 */
            if (hit) push(hit, row)
            return
          }
          if (dayRides.length === 1) { push(dayRides[0], row); return }
          var t = toMin(row.startTime)
          if (t >= 0) {
            var target = null
            dayRides.forEach(function (r) { if (toMin(r.time) <= t) target = r })
            if (target) { push(target, row); return }
          }
          /* 時間也對不上就退回舊行為：當天每一趟都掛 */
          dayRides.forEach(function (r) { push(r, row) })
        })
      })
      out.forEach(function (list) { list.sort(cmp) })
      return out
    }

    /* assign  → 只有成就列（活動卡與彈窗要畫的）
       assignAll → 每一筆 effort（抽屜鈕的「另外 N 次」要數的）。
       兩者共用同一套配對規則，所以「浮出 6 列、另外 7 次」加起來一定等於那趟的總數。 */
    function assign(rides) { return assignRows(rides, rows) }
    function assignAll(rides) { return assignRows(rides, all) }

    return { rows: rows, all: all, byDate: byDate, assign: assign, assignAll: assignAll, headline: headline }
  }

  build.TIER_LABEL = TIER_LABEL
  build.TIER_MEDAL = TIER_MEDAL
  build.TIER_CLASS = TIER_CLASS
  build.fmtDelta = fmtDelta
  build.headline = headline

  window.ittAchievements = build
})()
