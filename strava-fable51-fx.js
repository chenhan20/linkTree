/* ══════════════════════════════════════════════════════════════════════════
   strava-fable51-fx.js — STRAVA TELEMETRY · OVERDRIVE
   動效協調器（Motion Orchestrator）＋ Training Atmosphere 畫布 ＋ 五個 signature visualization。

   契約（跟頁尾那段 anime.js 動效層同一條）：純加法。
     · 它只讀 strava:data-ready 給的資料與既有 DOM；資料計算、路由、抽屜、彈窗、3D、地圖一律不經過它。
     · 拔掉這支檔案，strava_fable51.html 的九個 view、深連結、返回鍵照常 —— 只是沒有氣象層、沒有五張新圖。
     · 每個模組都包在 safe() 裡：一張圖畫壞不會讓其他圖跟著掛。
     · 缺值就是缺值：畫成斷線、空心點、「— 無資料」，不補零、不補平均。

   五層動態（設計筆記 docs/fable51-strava-design-notes.md 有完整說明）：
     ambient       Training Atmosphere（只在 Overview）＋ CSS 的星雲／掃描（theme-fable51.css）
     navigation    艙室轉位：方向性光帶、導覽亮點鎖定、標題底線描出
     visualization 圖表依資料形狀進場（本檔的五張新圖 ＋ 既有 anime 層負責的舊圖）
     interaction   點按漣漪、抽屜的 shared-origin、touch 可鎖定的讀數
     event         只有真的事件才用最高強度：全時 PR、本週任務完成、月目標達成、下一堂就是今天、TSB 極端

   三個效果模式（<html data-fx>）：overdrive 全部 ／ active 降低粒子與更新率、關掉持續背景 ／
   quiet 只留操作回饋、畫布停在一張由真實狀態畫出的靜態終態。prefers-reduced-motion 直接鎖成 quiet。

   效能底線：全站只有一個 rAF（Ticker）；document.hidden 一律停；離開 Overview 停畫布；
   devicePixelRatio 上限 2（手機 1.5）；粒子有固定上限；每一 frame 不呼叫 getBoundingClientRect。
   ══════════════════════════════════════════════════════════════════════════ */
;(function () {
'use strict'
const doc = document, root = doc.documentElement, win = window
const REDUCE = matchMedia('(prefers-reduced-motion: reduce)')
const isMobile = () => matchMedia('(max-width:767px)').matches
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const lerp = (a, b, t) => a + (b - a) * t
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const rgba = (c, a) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`
const ease = t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const easeOut = t => 1 - Math.pow(1 - t, 3)
/* 讀頁面的全域宣告（appState、AT、wellnessSeries…都是 classic script 的頂層 const／function）。
   名字不存在就回 undefined，不丟 ReferenceError —— 主頁改了名這一層只是少一個功能。 */
const g = n => { try { return Function('return ' + n)() } catch (e) { return undefined } }
const $ = (s, r) => (r || doc).querySelector(s)
const $$ = (s, r) => Array.from((r || doc).querySelectorAll(s))
const on = (t, ev, fn, o) => t && t.addEventListener(ev, fn, o)
const emit = (name, detail) => win.dispatchEvent(new CustomEvent('fx:' + name, { detail }))
const safe = (label, fn) => { try { return fn() } catch (e) { console.warn('[fx] ' + label + ':', e); return undefined } }
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const md = d => d ? String(d).slice(5, 10).replace('-', '/') : ''
const todayTPE = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
const ALIAS = { overview: 'deck', plan: 'train', playbook: 'train', trends: 'engine', harvest: 'engine' }
const curView = () => { const v = ((g('appState') || {}).view) || (location.hash.replace(/^#/, '').split('/')[0]) || 'deck'; return ALIAS[v] || v }
const quiet = () => root.dataset.fx === 'quiet'
const overdrive = () => root.dataset.fx === 'overdrive'
/* WAAPI 的薄包裝：quiet 模式直接跳到終態（fill forwards ＋ duration 0）。 */
const anim = (el, kf, opt) => {
  if (!el || !el.animate) return null
  const o = Object.assign({ fill: 'both', easing: 'cubic-bezier(.2,.9,.25,1)' }, opt || {})
  if (quiet()) { o.duration = 0; o.delay = 0 }
  try { return el.animate(kf, o) } catch (e) { return null }
}

/* ══ Ticker：全站唯一的 rAF loop ══════════════════════════════════════════
   畫布、粒子爆發、鏡頭飛行全部掛在這一個 loop 上；沒有工作就停，分頁進背景就停。
   ACTIVE 模式降到 30fps（傳給工作的 dt 仍是真實累計，動畫速度不變）。 */
const Ticker = {
  jobs: new Set(), raf: 0, last: 0, fps: 60, acc: 0,
  add(fn) { this.jobs.add(fn); this.kick() },
  remove(fn) { this.jobs.delete(fn); if (!this.jobs.size) this.stop() },
  kick() {
    if (this.raf || doc.hidden || !this.jobs.size) return
    this.last = 0; this.acc = 0
    this.raf = requestAnimationFrame(t => this.tick(t))
  },
  stop() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; this.last = 0 },
  tick(t) {
    this.raf = 0
    if (doc.hidden || !this.jobs.size) return
    const dt = this.last ? Math.min(120, t - this.last) : 16
    this.last = t
    this.acc += dt
    const step = 1000 / this.fps
    if (this.acc >= step - 0.5) {
      const d = this.acc; this.acc = 0
      for (const j of Array.from(this.jobs)) safe('tick', () => j(d, t))
    }
    if (this.jobs.size) this.raf = requestAnimationFrame(t2 => this.tick(t2))
  },
}
on(doc, 'visibilitychange', () => { if (doc.hidden) Ticker.stop(); else Ticker.kick() })

/* ══ View：現在在哪個艙室 ═══════════════════════════════════════════════ */
const View = { cur: curView(), prev: null }

/* ══ Mode：效果模式（OVERDRIVE / ACTIVE / QUIET）══════════════════════════
   偏好存 localStorage（fx-mode-v1）；系統 reduced motion 永遠壓過偏好，控制項鎖住並標示。 */
const Mode = {
  KEY: 'fx-mode-v1', list: ['overdrive', 'active', 'quiet'],
  meta: { overdrive: ['OVERDRIVE', '全部：環境、轉場、圖表、事件'], active: ['ACTIVE', '轉場與圖表；關掉持續的背景效果'], quiet: ['QUIET', '只留即時操作回饋'] },
  get cur() { return root.dataset.fx || 'overdrive' },
  get locked() { return REDUCE.matches },
  pref() { try { const p = localStorage.getItem(this.KEY); return this.list.includes(p) ? p : 'overdrive' } catch (e) { return 'overdrive' } },
  set(m, persist) {
    if (!this.list.includes(m)) m = 'overdrive'
    if (persist !== false) { try { localStorage.setItem(this.KEY, m) } catch (e) {} root.dataset.fxPref = m }
    const eff = this.locked ? 'quiet' : m
    const was = root.dataset.fx
    root.dataset.fx = eff
    this.paint()
    if (was !== eff) { this.apply(); emit('mode', { mode: eff }) }
  },
  /* 把模式套到頁面自己的 loop 上：星野、名片星座、畫布 */
  apply() {
    const m = this.cur
    const sf = win.__starfield, nc = win.__nameCard
    safe('starfield', () => { if (sf) ((m === 'overdrive' && !Field.ok) ? sf.resume() : sf.pause()) })   // 底圖換成路網後星野永遠停
    safe('namecard', () => { if (nc) ((m === 'overdrive' && curView() === 'deck') ? nc.resume() : nc.pause()) })
    Ticker.fps = m === 'active' ? 30 : 60
    Atmo.sync()
    SideScene.sync()
    Field.sync()
  },
  mount() {
    const head = $('.apphead'); if (!head || $('.fxm', head)) return
    const box = doc.createElement('div')
    box.className = 'fxm'; box.setAttribute('role', 'group'); box.setAttribute('aria-label', '效果模式')
    box.innerHTML = this.list.map(m => `<button class="fxm-b" type="button" data-fxset="${m}" aria-pressed="false" title="${this.meta[m][1]}">${this.meta[m][0]}</button>`).join('')
      + `<button class="fxm-cycle" type="button" data-fxcycle aria-label="效果模式，點一下切換"><i></i><span></span></button>`
      + `<span class="fxm-lock" hidden title="系統的 reduced motion 已啟用，效果鎖在 QUIET">REDUCED MOTION</span>`
    head.insertBefore(box, $('.ah-r', head))
    on(box, 'click', e => {
      if (this.locked) return
      const b = e.target.closest('[data-fxset]')
      if (b) { this.set(b.dataset.fxset); return }
      if (e.target.closest('[data-fxcycle]')) {
        const i = this.list.indexOf(this.pref())
        this.set(this.list[(i + 1) % this.list.length])
      }
    })
    this.paint()
  },
  paint() {
    const box = $('.fxm'); if (!box) return
    const cur = this.cur
    box.classList.toggle('is-locked', this.locked)
    $$('[data-fxset]', box).forEach(b => {
      b.setAttribute('aria-pressed', String(b.dataset.fxset === cur))
      b.disabled = this.locked
    })
    const cyc = $('.fxm-cycle span', box); if (cyc) cyc.textContent = this.meta[cur][0]
    const cb = $('.fxm-cycle', box); if (cb) cb.disabled = this.locked
    const lk = $('.fxm-lock', box); if (lk) lk.hidden = !this.locked
  },
}
on(REDUCE, 'change', () => Mode.set(Mode.pref(), false))

/* ══ Training Atmosphere · 訓練氣象層 ══════════════════════════════════════
   Overview 背後的全幅 2D 畫布。場景（FRESH／BUILD／REDLINE／NO SIGNAL）由頁面的
   buildAtmosphere() 從真實 wellness 判定，這裡只把它畫出來；SCENE LAB 的預覽一律標 SIMULATION。

   四個可獨立運動的深度層（由遠到近）：
     L0 診斷網格   透視地板網格，緩慢向觀者流動；NO SIGNAL 最清晰
     L1 遙測霧     4–6 團徑向漸層的能量雲（additive），色溫＝場景；密度＝ATL/CTL
     L2 訊號軌道   2–6 條橢圓軌道（數量＝CTL），每條一顆帶尾的訊號；速度＝ATL；REDLINE 加擾動
     L3 柔焦前景   16–48 顆 bokeh 粒子，視差最強；REDLINE 變成向上的熱流
     ＋ 事件波     readiness 更新、PR、進站時從內容元素的位置向外送一圈能量波

   資料 → 視覺參數（inputs 來自 buildAtmosphere）：
     TSB            場景本身（門檻同側欄 tsbMood）
     ATL/CTL        霧密度（疲勞佔比高 → 霧厚）
     CTL            軌道數（round(CTL/8)，2–6 條）
     ATL            訊號速度（ATL/35，0.5–1.6 倍）
     睡眠時數       光源高度（睡得少 → 光源壓低、畫面沉）
     HRV 低於基準帶 擾動（軌道與粒子抖動）
     資料新鮮度     網格清晰度（超過一天沒同步 → 網格更亮，像診斷模式）
   缺值降級：沒有 wellness → NO SIGNAL；單一欄位缺就用該場景的預設，不補值。 */
const SCENES = {
  /* Ridge Dawn：四種氣象＝四種天光。bg 天頂、fog 天中、fog2 地平線、haze 山谷霧、head 太陽核心、fore 塵埃 bokeh、grid 診斷網格。
     FRESH 清冷的晨光、BUILD 紫色暮色、REDLINE 燒起來的落日、NO SIGNAL 濃霧（山幾乎看不見）。 */
  fresh:    { bg: [8, 16, 42], fog: [52, 118, 190], fog2: [236, 214, 168], haze: [150, 190, 225], head: [255, 246, 220], fore: [230, 240, 255], grid: [120, 190, 255],
              fogD: .35, speed: .55, tilt: .16, lx: .72, ly: .50, gridA: .085, turb: .06, sig: .6, wash: .05, gridOn: 0,
              riderY: .26, riderSpd: .8, sunA: .9, sunR: .075, starA: .55, cloudA: .35, fogA: .18 },
  build:    { bg: [16, 8, 42], fog: [98, 58, 152], fog2: [226, 122, 108], haze: [138, 92, 150], head: [255, 196, 150], fore: [200, 180, 255], grid: [140, 120, 255],
              fogD: .55, speed: .85, tilt: .27, lx: .70, ly: .52, gridA: .06, turb: .18, sig: 1.0, wash: .07, gridOn: 0,
              riderY: .30, riderSpd: 1.0, sunA: .8, sunR: .085, starA: .25, cloudA: .5, fogA: .30 },
  redline:  { bg: [28, 4, 10], fog: [164, 40, 20], fog2: [255, 138, 40], haze: [206, 72, 30], head: [255, 228, 182], fore: [255, 200, 140], grid: [255, 130, 60],
              fogD: .8, speed: 1.5, tilt: .36, lx: .66, ly: .53, gridA: .05, turb: .6, sig: 1.6, wash: .09, gridOn: 0,
              riderY: .32, riderSpd: 1.5, sunA: 1, sunR: .11, starA: .05, cloudA: .6, fogA: .45 },
  nosignal: { bg: [30, 34, 44], fog: [82, 90, 102], fog2: [152, 158, 168], haze: [132, 138, 148], head: [204, 208, 216], fore: [200, 210, 225], grid: [170, 190, 220],
              fogD: .16, speed: .22, tilt: .10, lx: .70, ly: .50, gridA: .17, turb: 0, sig: .3, wash: .03, gridOn: 1,
              riderY: .34, riderSpd: 0, sunA: .25, sunR: .07, starA: 0, cloudA: .8, fogA: .85 },
}
const SCENE_LABEL = { fresh: ['FRESH', '新鮮'], build: ['BUILD', '累積中'], redline: ['REDLINE', '熱負荷'], nosignal: ['NO SIGNAL', '無訊號'] }
const NUM_KEYS = ['fogD', 'speed', 'tilt', 'lx', 'ly', 'gridA', 'turb', 'sig', 'wash', 'gridOn', 'riderY', 'riderSpd', 'sunA', 'sunR', 'starA', 'cloudA', 'fogA']
const COL_KEYS = ['bg', 'fog', 'fog2', 'fore', 'grid', 'head', 'haze']

/* ── 飛行主體：Pogačar 的 puppy paws ──────────────────────────────────────
   Anthropic 發布頁 hero 那隻在柔焦裡飛過的鳥，在這裡是他的偶像：低趴的空力姿勢（前臂平放在把手上、雙手併在龍頭前、
   平背、頭低）、白色世界冠軍車衣腰際五條彩虹、白色空力車架、深框輪。曲柄以 90 rpm 真的在轉。
   柔焦＝100×61 的離屏先縮到 50×31 再放大 3 倍多（不用 ctx.filter，Safari 也吃）；後面拖三個殘影＝運動模糊。
   REDLINE 飛得低又快、FRESH 高而慢、NO SIGNAL 沒有他。 */
const TAU = 6.2832
const Rider = {
  active: false, t: 0, u: 0, v: 0, v0: .09, stand: 0, crank: 0, trail: [], wait: 1800, T1: 2400,
  img: null, imgFlip: false,
  /* 使用者給的去背 PNG：在 <html> 標 data-rider-img="assets/pogacar.png"（面向左再加 data-rider-flip）才會去載，
     沒宣告就不發請求（免得 404 進 console）、用向量畫。 */
  loadImage(src) {
    src = src || root.dataset.riderImg; if (!src) return
    this.imgFlip = root.dataset.riderFlip != null
    const im = new Image(); im.decoding = 'async'
    im.onload = () => { if (im.naturalWidth > 10) this.img = im }
    im.onerror = () => {}
    im.src = src
  },
  /* Pogačar 的爬坡攻擊：先坐在 aero tuck 裡等速騎 2.4 秒，然後站起來、踏頻拉高、一路加速衝出畫面（速度線與殘影跟著變長變亮）。
     向量直接畫在 hero 畫布上（跟著 DPR，永遠清楚）。局部座標：車子在 400×250、畫框 400×300、車子往下墊 50 讓站起來的人有頭的空間。
     兩個姿勢的關鍵點用 stand 0→1 線性混合：坐姿（背趴平、前臂平放、雙手握在龍頭前）↔ 站姿（臀在 BB 正上方、身體前傾、拉著把手、頭抬起來）。 */
  POSE: {
    seat:  { hip: [160, 92], sh: [248, 70], ctl: [205, 62], elb: [262, 112], hand: [303, 105], neck: [280, 62], chin: [296, 70], head: [279, 57], tilt: -.22, visor: [299, 66] },
    stand: { hip: [186, 64], sh: [254, 22], ctl: [224, 30], elb: [284, 58], hand: [298, 92], neck: [270, 10], chin: [286, 14], head: [272, 0], tilt: -.08, visor: [291, 8] },
  },
  pose(k) {
    const A = this.POSE.seat, B = this.POSE.stand, o = {}
    for (const key in A) o[key] = Array.isArray(A[key]) ? [A[key][0] + (B[key][0] - A[key][0]) * k, A[key][1] + (B[key][1] - A[key][1]) * k] : A[key] + (B[key] - A[key]) * k
    return o
  },
  paint(c, crank, stand) {
    const k = clamp(stand || 0, 0, 1), Q = this.pose(k)
    const bob = Math.sin(crank * 2) * 3 * k                       // 站著踩，身體跟著曲柄上下
    for (const key of ['hip', 'sh', 'ctl', 'neck', 'chin', 'head', 'visor']) Q[key][1] += bob
    const white = '#f6f3ec', ink = '#17161c', skin = '#dcae86', tire = '#141318', rim = '#2b2932', dark = '#23212a'
    const L = (a, b, w, col) => { c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke() }
    c.lineCap = 'round'; c.lineJoin = 'round'
    c.save(); c.translate(185, 242); c.rotate(Math.sin(crank) * .05 * k); c.translate(-185, -242)   // 站著抽車：整台車繞著接地點左右搖
    const BB = [185, 190], RW = [95, 190], FW = [300, 190], R = 52
    const SC = [150, 100], HT = [262, 96], HB = [274, 128], HIP = Q.hip, SH = Q.sh
    // 輪組：胎 → 高框碳輪 → 框緣亮線 → 花鼓
    for (const w of [RW, FW]) {
      c.beginPath(); c.arc(w[0], w[1], R - 4, 0, TAU); c.lineWidth = 8; c.strokeStyle = tire; c.stroke()
      c.beginPath(); c.arc(w[0], w[1], R - 15, 0, TAU); c.lineWidth = 15; c.strokeStyle = rim; c.stroke()
      c.beginPath(); c.arc(w[0], w[1], R - 8.5, 0, TAU); c.lineWidth = 1.2; c.strokeStyle = 'rgba(246,243,236,.55)'; c.stroke()
      c.beginPath(); c.arc(w[0], w[1], R - 22.5, 0, TAU); c.lineWidth = 1; c.strokeStyle = 'rgba(246,243,236,.18)'; c.stroke()
      c.beginPath(); c.arc(w[0], w[1], 5, 0, TAU); c.fillStyle = white; c.fill()
    }
    // 腿：兩節 IK（大腿 82、小腿 80，膝蓋取在前的解）；遠腿先畫、顏色壓暗
    const leg = (ph, far) => {
      const P = [BB[0] + Math.cos(crank + ph) * 34, BB[1] + Math.sin(crank + ph) * 34]
      const dx = P[0] - HIP[0], dy = P[1] - HIP[1], dd = Math.max(1e-6, Math.hypot(dx, dy)), d = Math.min(161, dd)
      const L1 = 82, L2 = 80, a = (L1 * L1 - L2 * L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - a * a))
      const ux = dx / dd, uy = dy / dd, mx = HIP[0] + ux * a, my = HIP[1] + uy * a
      const k1 = [mx + uy * h, my - ux * h], k2 = [mx - uy * h, my + ux * h], K = k1[0] > k2[0] ? k1 : k2
      L(HIP, K, 24, far ? 'rgba(23,22,28,.85)' : ink)
      L(K, P, 15, far ? 'rgba(220,174,134,.7)' : skin)
      L([P[0] - 9, P[1] + 3], [P[0] + 13, P[1] + 1], 11, far ? 'rgba(16,16,20,.8)' : '#101014')
      L(BB, P, far ? 4 : 5, far ? 'rgba(23,22,28,.7)' : ink)
    }
    leg(Math.PI, true)
    // 車架（白）
    c.strokeStyle = white; c.lineWidth = 10; c.beginPath()
    c.moveTo(BB[0], BB[1]); c.lineTo(SC[0], SC[1]); c.lineTo(HT[0], HT[1]); c.lineTo(HB[0], HB[1]); c.lineTo(BB[0], BB[1])
    c.moveTo(BB[0], BB[1]); c.lineTo(RW[0], RW[1]); c.moveTo(SC[0], SC[1]); c.lineTo(RW[0], RW[1])
    c.moveTo(HB[0], HB[1]); c.quadraticCurveTo(292, 160, FW[0], FW[1])
    c.stroke()
    L(SC, [143, 78], 7, dark); L([120, 76], [170, 73], 9, dark); L(HT, [288, 90], 7, dark)
    c.strokeStyle = dark; c.lineWidth = 6; c.beginPath(); c.moveTo(288, 90); c.quadraticCurveTo(312, 92, 308, 112); c.quadraticCurveTo(304, 124, 294, 120); c.stroke()
    c.beginPath(); c.arc(BB[0], BB[1], 22, 0, TAU); c.lineWidth = 3; c.strokeStyle = 'rgba(23,22,28,.9)'; c.stroke()
    c.beginPath(); c.arc(BB[0], BB[1], 6, 0, TAU); c.fillStyle = ink; c.fill()
    leg(0, false)
    // 軀幹：胸前一圈世界冠軍彩虹條
    c.strokeStyle = white; c.lineWidth = 30; c.beginPath(); c.moveTo(HIP[0] - 2, HIP[1] - 6); c.quadraticCurveTo(Q.ctl[0], Q.ctl[1], SH[0], SH[1]); c.stroke()
    const qb = t => [(1 - t) * (1 - t) * (HIP[0] - 2) + 2 * (1 - t) * t * Q.ctl[0] + t * t * SH[0], (1 - t) * (1 - t) * (HIP[1] - 6) + 2 * (1 - t) * t * Q.ctl[1] + t * t * SH[1]]
    ;['#2f6fd6', '#d42a2a', '#17161c', '#f0c020', '#2a9a4a'].forEach((col, i) => {
      const q = qb(.42 + i * .045), q2 = qb(.44 + i * .045), nx = -(q2[1] - q[1]), ny = q2[0] - q[0], nl = Math.hypot(nx, ny) || 1
      L([q[0] + nx / nl * 15, q[1] + ny / nl * 15], [q[0] - nx / nl * 15, q[1] - ny / nl * 15], 3.4, col)   // 條紋垂直於脊線
    })
    // 手臂、頭
    L(SH, Q.elb, 15, white); L(Q.elb, Q.hand, 12, skin)
    c.fillStyle = ink; c.beginPath(); c.arc(Q.hand[0] + 3, Q.hand[1] - 1, 7.5, 0, TAU); c.fill()
    L(SH, Q.neck, 16, skin)
    c.fillStyle = skin; c.beginPath(); c.ellipse(Q.chin[0], Q.chin[1], 9, 8, 0, 0, TAU); c.fill()
    c.fillStyle = white; c.beginPath(); c.ellipse(Q.head[0], Q.head[1], 27, 18, Q.tilt, 0, TAU); c.fill()
    c.fillStyle = ink; c.beginPath(); c.ellipse(Q.visor[0], Q.visor[1], 12, 5.5, Q.tilt - .13, 0, TAU); c.fill()
    c.strokeStyle = 'rgba(23,22,28,.35)'; c.lineWidth = 1.2; c.beginPath(); c.ellipse(Q.head[0], Q.head[1], 27, 18, Q.tilt, 0, TAU); c.stroke()
    c.restore()
  },
  spawn(P) { this.active = true; this.t = 0; this.u = 0; this.stand = 0; this.v = this.v0 * Math.max(.4, P.riderSpd); this.trail.length = 0 },
  step(dt, P, level) {
    if (P.riderSpd <= .05 || (level === 'lite' && isMobile())) { this.active = false; return }
    if (!this.active) { this.wait -= dt; if (this.wait <= 0) this.spawn(P); return }
    this.t += dt
    const v0 = this.v0 * Math.max(.4, P.riderSpd)
    this.stand = clamp((this.t - this.T1) / 600, 0, 1)                                       // 2.4 秒後站起來
    this.v = this.t < this.T1 ? v0 : Math.min(v0 * 3.4, this.v + dt / 1000 * v0 * 1.8)      // 站起來就加速，到 3.4 倍
    this.u += this.v * dt / 1000
    const rpm = 86 + 22 * this.stand + 20 * clamp((this.v / v0 - 1) / 2.4, 0, 1)               // 86 → 128 rpm
    this.crank += dt * rpm / 60 * TAU / 1000
    if (this.u >= 1.12) { this.active = false; this.wait = 9000 + Math.random() * 8000 }
  },
  draw(c, W, H, P, px, py) {
    if (!this.active) return
    const u = this.u, v0 = this.v0 * Math.max(.4, P.riderSpd), boost = clamp((this.v / v0 - 1) / 2.4, 0, 1)
    const x = W * (-.14 + 1.26 * u) + px * 18
    const y = H * (P.riderY + .02) - H * .20 * u + py * 10                                    // 往右上爬
    const ang = -Math.atan2(H * .20, W * 1.26) + Math.sin(this.crank) * .03 * this.stand
    const w = Math.max(150, W * .15), s = w / 400, h = 300 * s
    this.trail.push([x, y]); if (this.trail.length > 26) this.trail.shift()
    c.save(); c.globalCompositeOperation = 'lighter'
    for (let i = 1; i < this.trail.length; i++) {
      const kk = i / this.trail.length
      c.beginPath(); c.moveTo(this.trail[i - 1][0], this.trail[i - 1][1] + h * .30); c.lineTo(this.trail[i][0], this.trail[i][1] + h * .30)
      c.strokeStyle = rgba(P.head, (.10 + .16 * boost) * kk); c.lineWidth = .8 + (3 + 3 * boost) * kk; c.stroke()
    }
    c.restore()
    c.save(); c.translate(x, y); c.rotate(ang)
    // 速度線：越快越長越亮
    const len = w * (.4 + .7 * boost), A = .16 + .34 * boost
    for (let i = 0; i < 4; i++) {
      const yy = (.02 + i * .10) * h, g = c.createLinearGradient(-w * .36 - len, 0, -w * .36, 0)
      g.addColorStop(0, rgba(P.head, 0)); g.addColorStop(1, rgba(P.head, Math.max(0, A - i * .05)))
      c.strokeStyle = g; c.lineWidth = 1.2; c.beginPath(); c.moveTo(-w * .36 - len, yy); c.lineTo(-w * .36, yy); c.stroke()
    }
    // 殘影：越快越明顯；再畫清楚的本體（有去背照片就畫照片，同一套速度線／殘影／搖晃）
    const ga = .04 + .07 * boost
    const body = (ctx) => {
      if (this.img) {
        const iw = w * 1.05, ih = iw * this.img.naturalHeight / this.img.naturalWidth, bob = Math.sin(this.crank * 2) * 2 * this.stand
        ctx.save(); ctx.translate(0, bob); if (this.imgFlip) ctx.scale(-1, 1)
        ctx.rotate(Math.sin(this.crank) * .03 * this.stand); ctx.drawImage(this.img, -iw / 2, -ih / 2 + h * .05, iw, ih); ctx.restore()
      } else { ctx.save(); ctx.translate(-w / 2, -h / 2 + 50 * s); ctx.scale(s, s); this.paint(ctx, this.crank, this.stand); ctx.restore() }
    }
    c.save(); c.globalAlpha = ga; c.translate(-.06 * w, 0); body(c); c.restore()
    body(c)
    c.restore()
  },
}

/* ── Ridge Dawn：hero 的舞台 ─────────────────────────────────────────────
   跟發布頁 hero 學的是方法（全幅畫布、遠中近景深、柔焦前景、慢速環境運動、看板切換整個場景一起變），
   內容是自己的：層疊的山脊（1-|sin| 疊出來的尖峰）、地平線上的太陽、山谷裡的霧、高空的雲、失焦的前景。
   遠 → 近：天空漸層 → 星野 → 太陽 → 高空雲 → 四層山脊（越遠越被霧染成天色）→ 騎士 → 前景失焦 → 塵埃 bokeh → 事件波 → 診斷網格。 */
const Atmo = {
  el: null, cv: null, ctx: null, W: 0, H: 0, DPR: 1, ok: false, running: false, level: 'off',
  cur: null, from: null, to: null, t0: 0, dur: 1200, scene: 'nosignal', sim: null, inputs: {},
  fore: [], clouds: [], waves: [], gridZ: 0, ptr: { x: 0, y: 0, tx: 0, ty: 0 }, time: 0,
  job: null, sprites: { key: '', fore: null, cloud: null }, stars: null, ridges: [], ridgeKey: '', fg: null, fgKey: '',
  sprite(col, size, stops) {
    const cv = doc.createElement('canvas'); cv.width = cv.height = size
    const x = cv.getContext('2d'), r = size / 2
    const gr = x.createRadialGradient(r, r, 0, r, r, r)
    stops.forEach(([o, a]) => gr.addColorStop(o, rgba(col, a)))
    x.fillStyle = gr; x.fillRect(0, 0, size, size)
    return cv
  },
  ensureSprites(P) {
    const key = [P.fore, P.fog2].map(c => c.map(v => Math.round(v / 8)).join(',')).join('|')
    if (key === this.sprites.key) return
    this.sprites.key = key
    this.sprites.fore = this.sprite(P.fore, 64, [[0, 1], [.5, .35], [1, 0]])
    this.sprites.cloud = this.sprite(mixc(P.fog2, [255, 255, 255], .45), 192, [[0, .9], [.35, .5], [1, 0]])
  },
  init() {
    this.el = $('#atm'); this.cv = $('#atm-canvas')
    if (!this.el || !this.cv || this.ok) return
    this.ctx = this.cv.getContext('2d', { alpha: true })
    if (!this.ctx) return
    this.ok = true
    this.job = (dt, t) => this.step(dt, t)
    this.resize()
    this.buildLayers()
    on(win, 'resize', () => { this.resize(); this.buildLayers(true); if (!this.running) this.drawOnce() }, { passive: true })
    on(win, 'pointermove', e => {
      if (!this.running || this.level !== 'full') return
      this.ptr.tx = (e.clientX / Math.max(1, win.innerWidth) - .5)
      this.ptr.ty = (e.clientY / Math.max(1, win.innerHeight) - .5)
    }, { passive: true })
    on(doc.documentElement, 'mouseleave', () => { this.ptr.tx = 0; this.ptr.ty = 0 })
  },
  box() { const h = this.el.parentElement || this.el; return { w: h.clientWidth || win.innerWidth, h: h.clientHeight || Math.round(win.innerHeight * .7) } },
  resize() {
    if (!this.ok) return
    const b = this.box()
    this.DPR = Math.min(win.devicePixelRatio || 1, isMobile() ? 1.5 : 2)
    this.W = b.w; this.H = b.h
    this.cv.width = Math.round(this.W * this.DPR); this.cv.height = Math.round(this.H * this.DPR)
    this.ctx.setTransform(this.DPR, 0, 0, this.DPR, 0, 0)
    this.stars = null; this.ridgeKey = ''; this.fgKey = ''
  },
  counts() {
    const m = isMobile(), lite = this.level === 'lite'
    return { fore: Math.round((m ? 16 : 36) * (lite ? .5 : 1)), clouds: m ? 3 : 5 }
  },
  buildLayers(keep) {
    if (!this.ok) return
    const c = this.counts(), W = this.W, H = this.H
    const rnd = (a, b) => a + Math.random() * (b - a)
    if (!keep || this.fore.length !== c.fore) {
      this.fore = Array.from({ length: c.fore }, () => ({ x: rnd(0, W), y: rnd(0, H), r: rnd(2, 14), ph: rnd(0, 6.28), a: rnd(.04, .16), depth: rnd(.5, 1), v: rnd(.5, 1.3) }))
    }
    if (!keep || this.clouds.length !== c.clouds) {
      this.clouds = Array.from({ length: c.clouds }, (_, i) => ({ x: rnd(-.2, 1), y: rnd(.08, .40), w: rnd(.30, .58), h: rnd(.05, .09), spd: rnd(.000012, .00003), a: rnd(.5, 1), depth: .3 + i * .1 }))
    }
  },
  applyInputs(base, inp) {
    const p = Object.assign({}, base)
    inp = inp || {}
    if (inp.ctl != null && inp.atl != null) {
      const ratio = clamp((inp.atl / Math.max(1, inp.ctl) - 1), -.6, .9)
      p.fogD = clamp(p.fogD + ratio * .35, .08, 1)
      p.fogA = clamp(p.fogA + ratio * .25, .05, 1)          // 疲勞佔比高 → 山谷的霧厚
      p.riderSpd = p.riderSpd * clamp(inp.atl / 35, .6, 1.5)  // 疲勞高 → 騎士快（訊號急）
    }
    if (inp.sleepSecs != null) p.ly = clamp(p.ly + clamp((6.5 - inp.sleepSecs / 3600) * .03, -.08, .10), .38, .62)   // 睡得少 → 太陽更貼地平線
    if (inp.hrvLow) p.turb = clamp(p.turb + .3, 0, 1)
    if (inp.ageDays != null && inp.ageDays > 1) p.gridA = p.gridA * 1.4
    return p
  },
  setScene(name, opts) {
    if (!this.ok) return
    const base = SCENES[name] || SCENES.nosignal
    const p = this.applyInputs(base, opts && opts.sim ? {} : this.inputs)
    this.scene = SCENES[name] ? name : 'nosignal'
    this.sim = !!(opts && opts.sim)
    this.el.hidden = false
    this.from = this.cur ? Object.assign({}, this.cur) : null
    this.to = p
    this.t0 = performance.now()
    this.dur = (quiet() || !this.from) ? 0 : 1300
    if (!this.cur) this.cur = Object.assign({}, p)
    this.sync()
    emit('scene', { scene: this.scene, sim: this.sim })
  },
  start() { if (!this.ok || this.running) return; this.running = true; Ticker.add(this.job) },
  pause() { if (!this.running) return; this.running = false; Ticker.remove(this.job) },
  destroy() { this.pause(); if (this.el) this.el.hidden = true; this.ok = false },
  sync() {
    if (!this.ok) return
    if (!this.cur) { this.pause(); this.el.classList.remove('is-on'); return }
    const want = curView() === 'deck'
    this.el.classList.toggle('is-on', want)
    if (!want) { this.pause(); return }
    const m = Mode.cur
    const lv = m === 'overdrive' ? 'full' : m === 'active' ? 'lite' : 'static'
    if (lv !== this.level) { this.level = lv; this.buildLayers(true) }
    if (lv === 'static') { this.pause(); this.drawOnce() } else this.start()
  },
  step(dt, t) {
    if (!this.cur) return
    this.time += dt
    if (this.to) {
      const k = this.dur ? clamp((performance.now() - this.t0) / this.dur, 0, 1) : 1
      const e = ease(k), f = this.from || this.to
      NUM_KEYS.forEach(kk => { this.cur[kk] = lerp(f[kk], this.to[kk], e) })
      COL_KEYS.forEach(kk => { this.cur[kk] = mixc(f[kk], this.to[kk], e) })
      if (k >= 1) { this.from = null; this.to = null }
    }
    const P = this.cur, spd = P.speed
    this.ptr.x += (this.ptr.tx - this.ptr.x) * .06
    this.ptr.y += (this.ptr.ty - this.ptr.y) * .06
    this.gridZ = (this.gridZ + dt * spd * .00009) % 1
    const H = this.H, W = this.W
    for (const p of this.fore) {
      p.y -= dt * spd * .009 * p.v * (p.r / 10)
      p.x += Math.sin(this.time * .0004 + p.ph) * .16 * spd + (P.turb * (Math.random() - .5) * 1.2)
      if (p.y < -20) { p.y = H + 16; p.x = Math.random() * W }
      if (p.x < -30) p.x = W + 20; else if (p.x > W + 30) p.x = -20
    }
    for (const cl of this.clouds) { cl.x += dt * cl.spd * spd; if (cl.x > 1.25) cl.x = -cl.w - .05 }
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i]; w.r += dt * .38; w.a -= dt / 1400
      if (w.a <= 0) this.waves.splice(i, 1)
    }
    Rider.step(dt, P, this.level)
    this.draw(false)
  },
  drawOnce() { if (!this.ok || !this.cur) return; this.draw(true) },
  /* 山脊：1-|sin| 疊三個頻率 → 尖的峰、圓的谷；四層各自有 base 與振幅，越遠越高、越被霧染成天色 */
  ridgeY(k, x, W, H) {
    const base = H * [.745, .665, .585, .505][k], amp = H * [.048, .072, .092, .108][k]
    const t = x / W, s = [0.3, 1.7, 2.9, 4.1][k]
    const f1 = 2.2 + k * .7, f2 = 5.1 + k * 1.3, f3 = 11 + k * 2
    return base - amp * (0.55 * (1 - Math.abs(Math.sin(t * f1 + s))) + 0.30 * (1 - Math.abs(Math.sin(t * f2 + s * 1.3))) + 0.15 * Math.abs(Math.sin(t * f3 + s * .7)))
  },
  ensureRidges(P) {
    const key = Math.round(this.W) + 'x' + Math.round(this.H) + '|' + [P.haze, P.fog2].map(c => c.map(v => Math.round(v / 10)).join(',')).join('|') + '|' + Math.round(P.fogA * 10)
    if (key === this.ridgeKey) return
    this.ridgeKey = key
    const W = this.W, H = this.H, w = Math.ceil(W * 1.16)
    const dark = [10, 9, 16]
    this.ridges = [3, 2, 1, 0].map(k => {
      const cv = doc.createElement('canvas'); cv.width = w; cv.height = H
      const x = cv.getContext('2d')
      const mixK = [.06, .30, .52, .72][k] * (0.6 + P.fogA * .6)
      x.fillStyle = rgba(mixc(dark, P.haze, clamp(mixK, 0, .92)), 1)
      x.beginPath(); x.moveTo(0, H)
      for (let px = 0; px <= w; px += 5) x.lineTo(px, this.ridgeY(k, px, W, H))
      x.lineTo(w, H); x.closePath(); x.fill()
      if (k > 0) {   // 稜線受光
        x.strokeStyle = rgba(P.fog2, .18 + .1 * (3 - k) / 3); x.lineWidth = 1
        x.beginPath(); for (let px = 0; px <= w; px += 5) { const y = this.ridgeY(k, px, W, H); px ? x.lineTo(px, y) : x.moveTo(px, y) } x.stroke()
      }
      return { k, cv }
    })
  },
  ensureStars() {
    if (this.stars) return
    const W = this.W, H = this.H
    const cv = doc.createElement('canvas'); cv.width = Math.round(W * this.DPR); cv.height = Math.round(H * this.DPR)
    const x = cv.getContext('2d'); x.setTransform(this.DPR, 0, 0, this.DPR, 0, 0)
    const n = Math.round(W * H / 3200)
    for (let i = 0; i < n; i++) {
      const sx = Math.random() * W, sy = Math.random() * H * .62, r = .5 + Math.random() * 1.1
      const a = (1 - sy / (H * .7)) * (.35 + Math.random() * .65)
      x.fillStyle = `rgba(255,${240 + (Math.random() * 15 | 0)},${225 + (Math.random() * 30 | 0)},${a.toFixed(2)})`
      x.beginPath(); x.arc(sx, sy, r, 0, TAU); x.fill()
    }
    for (let i = 0; i < 4; i++) {   // 幾顆亮星帶四芒
      const sx = Math.random() * W, sy = Math.random() * H * .4, L = 6 + Math.random() * 8
      x.strokeStyle = 'rgba(255,250,240,.55)'; x.lineWidth = 1
      x.beginPath(); x.moveTo(sx - L, sy); x.lineTo(sx + L, sy); x.moveTo(sx, sy - L); x.lineTo(sx, sy + L); x.stroke()
      x.fillStyle = 'rgba(255,255,255,.95)'; x.beginPath(); x.arc(sx, sy, 1.6, 0, TAU); x.fill()
    }
    this.stars = cv
  },
  ensureFg(P) {
    const key = Math.round(this.W) + 'x' + Math.round(this.H) + '|' + P.bg.map(v => Math.round(v / 24)).join(',')
    if (this.fg && this.fgKey === key) return
    this.fgKey = key
    const sw = Math.max(24, Math.round(this.W / 10)), sh = Math.max(16, Math.round(this.H / 10))
    const cv = doc.createElement('canvas'); cv.width = sw; cv.height = sh
    const x = cv.getContext('2d'); x.fillStyle = 'rgba(6,5,10,.92)'
    x.beginPath(); x.ellipse(sw * .08, sh * 1.02, sw * .30, sh * .22, -.25, 0, TAU); x.fill()
    x.beginPath(); x.ellipse(sw * .96, sh * 1.06, sw * .34, sh * .26, .22, 0, TAU); x.fill()
    this.fg = cv
  },
  draw(isStatic) {
    const c = this.ctx, W = this.W, H = this.H, P = this.cur
    if (!P) return
    const px = this.ptr.x, py = this.ptr.y
    // ── 天空
    const sky = c.createLinearGradient(0, 0, 0, H)
    sky.addColorStop(0, rgba(P.bg, 1)); sky.addColorStop(.5, rgba(P.fog, 1)); sky.addColorStop(.8, rgba(P.fog2, 1)); sky.addColorStop(1, rgba(P.fog2, 1))
    c.fillStyle = sky; c.fillRect(0, 0, W, H)
    // ── 星野（往地平線淡出；白天淡到沒有）
    if (P.starA > .01) { this.ensureStars(); c.globalAlpha = P.starA; c.drawImage(this.stars, px * 6, py * 4, W, H); c.globalAlpha = 1 }
    // ── 太陽：貼著地平線，下半被遠山吃掉
    const SX = W * (P.lx + px * .015), SY = H * (P.ly + py * .012)
    const sr = Math.min(W, H) * P.sunR, gr = Math.max(W, H) * .5 * P.sunA
    c.save(); c.globalCompositeOperation = 'lighter'
    const glow = c.createRadialGradient(SX, SY, 0, SX, SY, gr)
    glow.addColorStop(0, rgba(P.head, .55 * P.sunA)); glow.addColorStop(.18, rgba(P.fog2, .32 * P.sunA)); glow.addColorStop(.6, rgba(P.fog2, .06 * P.sunA)); glow.addColorStop(1, rgba(P.fog2, 0))
    c.fillStyle = glow; c.fillRect(SX - gr, SY - gr, gr * 2, gr * 2)
    c.restore()
    const disc = c.createRadialGradient(SX, SY, 0, SX, SY, sr)
    disc.addColorStop(0, rgba(P.head, .98 * P.sunA + .02)); disc.addColorStop(.75, rgba(P.head, .92 * P.sunA)); disc.addColorStop(1, rgba(mixc(P.head, P.fog2, .6), 0))
    c.beginPath(); c.arc(SX, SY, sr, 0, TAU); c.fillStyle = disc; c.fill()
    // ── 高空雲（柔焦的長條）
    this.ensureSprites(P)
    c.save(); c.globalCompositeOperation = 'lighter'
    for (const cl of this.clouds) {
      const cw = W * cl.w, ch = H * cl.h
      c.globalAlpha = P.cloudA * cl.a * .5
      c.drawImage(this.sprites.cloud, W * cl.x + px * 14 * cl.depth, H * cl.y + py * 8 * cl.depth, cw, ch)
    }
    c.restore(); c.globalAlpha = 1
    // ── 四層山脊，遠 → 近；每一層前面墊一層山谷霧
    this.ensureRidges(P)
    for (const r of this.ridges) {
      const k = r.k, base = H * [.745, .665, .585, .505][k], amp = H * [.048, .072, .092, .108][k]
      const hz = c.createLinearGradient(0, base - amp * 1.15, 0, base + amp * .2)
      hz.addColorStop(0, rgba(P.haze, 0)); hz.addColorStop(1, rgba(P.haze, P.fogA * (k ? .45 : .28)))
      c.fillStyle = hz; c.fillRect(0, base - amp * 1.15, W, amp * 1.35)
      const par = px * (14 + (3 - k) * 12)
      c.drawImage(r.cv, -W * .08 + par, py * (2 + (3 - k) * 2))
    }
    // ── 騎士（在山脊上方的天空裡飛過）
    if (!isStatic || Rider.active) Rider.draw(c, W, H, P, px, py)
    // ── 整體的霧（NO SIGNAL 幾乎把山蓋掉）
    c.fillStyle = rgba(P.haze, P.fogA * .22); c.fillRect(0, 0, W, H)
    // ── 前景失焦（畫面下角的暗塊）＋ 塵埃 bokeh
    this.ensureFg(P)
    c.save(); c.globalAlpha = .85; c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'
    c.drawImage(this.fg, px * 40 - 20, py * 20 - 8, W + 40, H + 20); c.restore()
    c.save(); c.globalCompositeOperation = 'lighter'
    for (const p of this.fore) {
      const x = p.x + px * 26 * p.depth, y = p.y + py * 14 * p.depth
      c.globalAlpha = Math.min(1, p.a * (1 + P.fogD * .4))
      c.drawImage(this.sprites.fore, x - p.r, y - p.r, p.r * 2, p.r * 2)
    }
    c.globalAlpha = 1
    for (const w of this.waves) {
      c.beginPath(); c.arc(w.x, w.y, w.r, 0, TAU)
      c.strokeStyle = rgba(w.col, Math.max(0, w.a) * .6); c.lineWidth = 1.5; c.stroke()
      c.beginPath(); c.arc(w.x, w.y, w.r * .82, 0, TAU)
      c.strokeStyle = rgba(w.col, Math.max(0, w.a) * .22); c.lineWidth = 6; c.stroke()
    }
    c.restore()
    // ── 診斷網格（只在 NO SIGNAL 淡入）
    if (P.gridOn > .02) this.drawGrid(c, W, H, P, SX)
    // ── 底緣：讓 hero 跟頁面的深空底接起來
    const foot = c.createLinearGradient(0, H * .82, 0, H)
    foot.addColorStop(0, 'rgba(5,3,9,0)'); foot.addColorStop(1, 'rgba(5,3,9,.85)')
    c.fillStyle = foot; c.fillRect(0, H * .82, W, H * .18)
  },
  drawGrid(c, W, H, P, vx) {
    const hy = H * (.56 + P.tilt * .18)
    const a = P.gridA * P.gridOn
    if (a <= .002) return
    c.save()
    c.strokeStyle = rgba(P.grid, a); c.lineWidth = 1
    c.beginPath()
    const rows = 11
    for (let k = 0; k <= rows; k++) {
      const z = ((k + this.gridZ) / rows)
      if (z > 1) continue
      const y = hy + (H - hy) * z * z
      c.globalAlpha = .25 + z * .75
      c.moveTo(0, y); c.lineTo(W, y)
    }
    c.stroke()
    c.beginPath(); c.globalAlpha = .55
    const cols = 9, span = W * .16
    for (let i = -cols; i <= cols; i++) { const xb = vx + i * span * 1.9; c.moveTo(vx + i * span * .06, hy); c.lineTo(xb, H) }
    c.stroke()
    c.restore()
  },
  wave(x, y, col) {
    if (!this.ok || quiet() || this.level === 'static') return
    const r = this.el.getBoundingClientRect()
    const lx = x - r.left, ly = y - r.top
    if (lx < -40 || ly < -40 || lx > r.width + 40 || ly > r.height + 40) return
    if (this.waves.length > 4) this.waves.shift()
    this.waves.push({ x: lx, y: ly, r: 12, a: 1, col: col || (this.cur ? this.cur.head : [252, 76, 2]) })
    emit('wave', { x, y })
    if (!this.running && this.el.classList.contains('is-on')) this.start()
  },
  waveFrom(el, col) {
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.width || r.height) this.wave(r.left + r.width / 2, r.top + r.height / 2, col)
  },
}

/* ══ Side Scene：側欄背後的畫布 ═══════════════════════════════════════════
   前兩版（訊號脊柱、爬坡牆）他一個看不見、一個看不懂。這版不做圖表：hero 那片山景直接延伸進側欄，
   側欄就是同一幅全景的左半邊 —— 同一組天空漸層、星野、地平線的晨光、同一組山脊函數往左接過去
   （山脊線在側欄與 hero 的交界是連續的：hero 的 x 往左延伸成負數，垂直位置對齊 hero 的頂邊）、山谷霧；
   色溫跟 hero 同一個氣象。OVERDRIVE：星星閃、雲慢慢飄、偶爾一顆流星；ACTIVE／QUIET 靜態一張。
   整層壓一道暗色讓側欄的字保持好讀。不在 deck 時 hero 不在畫面上，就沿用上一次量到的 hero 幾何。 */
const SideScene = {
  side: null, cv: null, ctx: null, W: 0, H: 0, DPR: 1, ok: false, running: false, job: null, ro: null,
  t: 0, acc: 0, P: null, stars: null, twinkle: [], ridgeCv: null, hero: { W: 1252, H: 779, top: 44, left: 188 }, clouds: [], meteor: null, nextMeteor: 7000,
  init() {
    this.side = $('.side'); if (!this.side || this.ok || isMobile()) return
    this.cv = doc.createElement('canvas'); this.cv.className = 'side-cv'; this.cv.setAttribute('aria-hidden', 'true')
    this.side.insertBefore(this.cv, this.side.firstChild)
    this.ctx = this.cv.getContext('2d'); if (!this.ctx) { this.cv.remove(); return }
    this.ok = true
    this.P = Atmo.to || Atmo.cur || SCENES.build
    this.clouds = [{ x: .05, y: .17, w: 1.4, h: .05, v: .0035, a: .5 }, { x: .55, y: .27, w: 1.1, h: .04, v: .0025, a: .35 }]
    this.job = dt => this.step(dt)
    this.measure()
    if (win.ResizeObserver) { this.ro = new ResizeObserver(() => this.measure()); this.ro.observe(this.side) }
    on(win, 'fx:scene', () => { this.P = Atmo.to || Atmo.cur || this.P; this.ridgeCv = null; if (!this.running) this.draw(true) })
    on(win, 'strava:view', () => requestAnimationFrame(() => this.measureHero()))
    this.sync()
  },
  measureHero() {
    if (!this.ok) return
    const h = $('#hero'), r = h && h.getBoundingClientRect()
    if (r && r.width > 100 && r.height > 100) {
      const s = this.side.getBoundingClientRect()
      const nxt = { W: r.width, H: r.height, top: r.top - s.top, left: r.left - s.left }
      if (JSON.stringify(nxt) !== JSON.stringify(this.hero)) { this.hero = nxt; this.ridgeCv = null; if (!this.running) this.draw(true) }
    }
  },
  measure() {
    if (!this.ok) return
    const r = this.side.getBoundingClientRect()
    this.DPR = Math.min(win.devicePixelRatio || 1, 2)
    this.W = Math.max(1, Math.round(r.width)); this.H = Math.max(1, Math.round(r.height))
    this.cv.width = Math.round(this.W * this.DPR); this.cv.height = Math.round(this.H * this.DPR)
    this.ctx.setTransform(this.DPR, 0, 0, this.DPR, 0, 0)
    this.stars = null; this.ridgeCv = null
    this.measureHero()
    if (!this.running) this.draw(true)
  },
  mk(w, h) { const c = doc.createElement('canvas'); c.width = Math.round(w * this.DPR); c.height = Math.round(h * this.DPR); const x = c.getContext('2d'); x.setTransform(this.DPR, 0, 0, this.DPR, 0, 0); return [c, x] },
  // 側欄 x → hero 的山脊函數：hero 把山脊畫布往左挪了 8% 寬，所以 hero 像素 X 對應函數的 X + .08W
  ridgeY(k, x) {
    const hw = this.hero.W, hh = this.hero.H, hx = x - this.hero.left + hw * .08
    const y = Atmo.ridgeY ? Atmo.ridgeY(k, hx, hw, hh) : hh * .6
    return y + this.hero.top
  },
  ensureRidges() {
    const W = this.W, H = this.H, P = this.P, [cv, x] = this.mk(W, H)
    const dark = [10, 9, 16], hh = this.hero.H, fogA = P.fogA == null ? .3 : P.fogA
    for (const k of [3, 2, 1, 0]) {                                             // 遠 → 近，跟 hero 同一套配色
      const base = this.hero.top + hh * [.745, .665, .585, .505][k], amp = hh * [.048, .072, .092, .108][k]
      const hz = x.createLinearGradient(0, base - amp * 1.15, 0, base + amp * .2)   // 每層前面墊一層山谷霧
      hz.addColorStop(0, rgba(P.haze, 0)); hz.addColorStop(1, rgba(P.haze, fogA * (k ? .45 : .28)))
      x.fillStyle = hz; x.fillRect(0, base - amp * 1.15, W, amp * 1.35)
      const mixK = [.06, .30, .52, .72][k] * (0.6 + fogA * .6)
      x.fillStyle = rgba(mixc(dark, P.haze, clamp(mixK, 0, .92)), 1)
      x.beginPath(); x.moveTo(0, H + 2)
      for (let px = 0; px <= W + 2; px += 2) x.lineTo(px, this.ridgeY(k, px))
      x.lineTo(W + 2, H + 2); x.closePath(); x.fill()
      if (k > 0) {                                                             // 稜線受光
        x.strokeStyle = rgba(P.fog2, .18 + .1 * (3 - k) / 3); x.lineWidth = 1
        x.beginPath(); for (let px = 0; px <= W + 2; px += 2) { const y = this.ridgeY(k, px); px ? x.lineTo(px, y) : x.moveTo(px, y) } x.stroke()
      }
    }
    this.ridgeCv = cv
  },
  ensureStars() {
    const W = this.W, H = this.H, [cv, x] = this.mk(W, H), n = Math.round(W * H / 2600)
    this.twinkle = []
    for (let i = 0; i < n; i++) {
      const sx = Math.random() * W, sy = Math.random() * H * .62, r = Math.random() < .12 ? 1.3 : .7, a = .25 + Math.random() * .55
      x.fillStyle = `rgba(255,244,228,${a.toFixed(2)})`; x.beginPath(); x.arc(sx, sy, r, 0, TAU); x.fill()
      if (r > 1 && this.twinkle.length < 12) this.twinkle.push({ x: sx, y: sy, ph: Math.random() * TAU })
    }
    this.stars = cv
  },
  start() { if (!this.ok || this.running) return; this.running = true; Ticker.add(this.job) },
  pause() { if (!this.running) return; this.running = false; Ticker.remove(this.job) },
  sync() {
    if (!this.ok) return
    if (Mode.cur === 'overdrive') { this.start(); return }
    this.pause(); this.meteor = null; this.draw(true)
  },
  step(dt) {
    this.t += dt; this.acc += dt
    for (const cl of this.clouds) { cl.x += dt * cl.v / 1000; if (cl.x > 1.1) cl.x = -cl.w }
    if (this.meteor) { this.meteor.p += dt / 700; if (this.meteor.p >= 1) this.meteor = null }
    else { this.nextMeteor -= dt; if (this.nextMeteor <= 0) { this.meteor = { x: .3 + Math.random() * .7, y: .04 + Math.random() * .25, p: 0 }; this.nextMeteor = 9000 + Math.random() * 12000 } }
    if (this.acc < 33) return
    this.acc = 0; this.draw(false)
  },
  draw(isStatic) {
    const c = this.ctx, W = this.W, H = this.H, P = this.P, hr = this.hero
    if (!P) return
    // 天空：跟 hero 同一條漸層，對齊 hero 的頂邊與底邊（側欄比 hero 高的部分自然延伸兩端的顏色）
    const sky = c.createLinearGradient(0, hr.top, 0, hr.top + hr.H)
    sky.addColorStop(0, rgba(P.bg, 1)); sky.addColorStop(.5, rgba(P.fog, 1)); sky.addColorStop(.8, rgba(P.fog2, 1)); sky.addColorStop(1, rgba(P.fog2, 1))
    c.fillStyle = sky; c.fillRect(0, 0, W, H)
    // 星野（往地平線淡出），OVERDRIVE 幾顆亮星會呼吸
    if ((P.starA || 0) > .01) {
      if (!this.stars) this.ensureStars()
      c.globalAlpha = P.starA; c.drawImage(this.stars, 0, 0, W, H); c.globalAlpha = 1
      if (!isStatic) for (const s of this.twinkle) { const a = .35 + .45 * (.5 + .5 * Math.sin(this.t / 900 + s.ph)); c.fillStyle = `rgba(255,246,230,${(a * P.starA).toFixed(2)})`; c.beginPath(); c.arc(s.x, s.y, 1.6, 0, TAU); c.fill() }
    }
    // 晨光：hero 的太陽在右邊很遠，這裡只留地平線上一抹餘暉
    const gy = hr.top + hr.H * (P.ly || .5)
    const gl = c.createRadialGradient(W + 120, gy, 0, W + 120, gy, W * 2.2)
    gl.addColorStop(0, rgba(P.fog2, .22 * (P.sunA || 0))); gl.addColorStop(.5, rgba(P.fog2, .06 * (P.sunA || 0))); gl.addColorStop(1, rgba(P.fog2, 0))
    c.fillStyle = gl; c.fillRect(0, 0, W, H)
    // 高空雲：兩條柔的長條慢慢飄
    for (const cl of this.clouds) {
      const cx = W * cl.x, cy = hr.top + hr.H * cl.y, cw = W * cl.w, ch = hr.H * cl.h
      const g = c.createLinearGradient(cx, 0, cx + cw, 0)
      g.addColorStop(0, rgba(P.fore, 0)); g.addColorStop(.5, rgba(P.fore, (P.cloudA || .3) * cl.a * .5)); g.addColorStop(1, rgba(P.fore, 0))
      c.fillStyle = g; c.beginPath(); c.ellipse(cx + cw / 2, cy, cw / 2, ch / 2, 0, 0, TAU); c.fill()
    }
    // 流星（只在 OVERDRIVE）
    if (this.meteor) {
      const m = this.meteor, x0 = W * m.x, y0 = hr.top + hr.H * m.y, len = 90, dx = -.8, dy = .6
      const hx = x0 + dx * len * m.p * 2, hy = y0 + dy * len * m.p * 2
      const g = c.createLinearGradient(hx - dx * len, hy - dy * len, hx, hy); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, `rgba(255,255,255,${(.8 * (1 - m.p)).toFixed(2)})`)
      c.strokeStyle = g; c.lineWidth = 1.4; c.beginPath(); c.moveTo(hx - dx * len, hy - dy * len); c.lineTo(hx, hy); c.stroke()
    }
    // 山脊（跟 hero 同一組函數接過來）＋ 山谷霧
    if (!this.ridgeCv) this.ensureRidges()
    c.drawImage(this.ridgeCv, 0, 0, W, H)
    const base = this.ridgeY(3, W * .5)
    const fg = c.createLinearGradient(0, base - 30, 0, base + 90)
    fg.addColorStop(0, rgba(P.fog, 0)); fg.addColorStop(.6, rgba(P.fog, .16 * (P.fogA || .3) / .3)); fg.addColorStop(1, rgba(P.fog, 0))
    c.fillStyle = fg; c.fillRect(0, base - 30, W, 120)
    // 壓暗：側欄的字要好讀（比 hero 暗一截）
    c.fillStyle = 'rgba(5,3,9,.36)'; c.fillRect(0, 0, W, H)
  },
}

/* ── Scene Lab：hero 看板上的場景預覽（SIMULATION，不是真實狀態）───────────────────────── */
const SceneLab = {
  liveHtml: null, liveScene: null,
  mount(atm) {
    const host = $('#atm-lab'); if (!host || !Atmo.ok) return
    this.liveScene = (atm && atm.scene) || 'nosignal'
    const sc = $('#atm-bar .atm-scene'), why = $('#atm-bar .atm-why')
    this.liveHtml = { scene: sc ? sc.innerHTML : '', why: why ? why.innerHTML : '', attr: sc ? sc.dataset.scene : '' }
    host.innerHTML = `<u>SCENE LAB</u>` + ['fresh', 'build', 'redline', 'nosignal'].map(k =>
      `<button type="button" data-atmsim="${k}" aria-pressed="false" title="預覽 ${SCENE_LABEL[k][0]} 場景（模擬，不是真實狀態）">${SCENE_LABEL[k][0]}</button>`).join('')
      + `<button type="button" class="live" data-atmsim="" aria-pressed="true" title="回到由真實資料決定的場景">● LIVE</button>`
    on(host, 'click', e => {
      const b = e.target.closest('[data-atmsim]'); if (!b) return
      const k = b.dataset.atmsim
      $$('[data-atmsim]', host).forEach(x => x.setAttribute('aria-pressed', String(x === b)))
      if (!k) {
        Atmo.setScene(this.liveScene, { sim: false })
        if (sc) { sc.innerHTML = this.liveHtml.scene; sc.dataset.scene = this.liveHtml.attr; sc.classList.remove('is-sim') }
        if (why) why.innerHTML = this.liveHtml.why
        return
      }
      Atmo.setScene(k, { sim: true })
      if (sc) { sc.dataset.scene = k; sc.classList.add('is-sim'); sc.innerHTML = `<i></i><b>${SCENE_LABEL[k][0]}</b><small>${SCENE_LABEL[k][1]}</small>` }
      if (why) why.innerHTML = `這是 SCENE LAB 的預覽，不是今天的訓練狀態 —— 真實判讀是 <b>${SCENE_LABEL[this.liveScene][0]}</b>`
    })
  },
}

/* ══ Bursts：事件層的粒子爆發（物件池、固定上限、跟 Ticker 共用 loop）════════ */
const Burst = {
  cv: null, ctx: null, pool: [], live: 0, MAX: 140, job: null, W: 0, H: 0,
  ensure() {
    if (this.cv) return true
    this.cv = doc.createElement('canvas'); this.cv.className = 'fx-burst'; this.cv.setAttribute('aria-hidden', 'true')
    doc.body.appendChild(this.cv)
    this.ctx = this.cv.getContext('2d'); if (!this.ctx) { this.cv.remove(); this.cv = null; return false }
    this.resize()
    on(win, 'resize', () => this.resize(), { passive: true })
    this.job = dt => this.step(dt)
    for (let i = 0; i < this.MAX; i++) this.pool.push({ on: false })
    return true
  },
  resize() {
    if (!this.cv) return
    const d = Math.min(win.devicePixelRatio || 1, 2)
    this.W = win.innerWidth; this.H = win.innerHeight
    this.cv.width = this.W * d; this.cv.height = this.H * d
    this.ctx.setTransform(d, 0, 0, d, 0, 0)
  },
  /* tier: 'pr'（金，最強）｜'goal'（綠）｜'ok'（訊號橘，中等） */
  fire(x, y, tier, n) {
    if (quiet() || !this.ensure()) return
    const col = tier === 'pr' ? [255, 215, 0] : tier === 'goal' ? [95, 208, 96] : [252, 76, 2]
    const count = Math.min(n || (tier === 'pr' ? 90 : 40), this.MAX - this.live)
    let made = 0
    for (const p of this.pool) {
      if (made >= count) break
      if (p.on) continue
      const a = Math.random() * 6.2832, sp = (tier === 'pr' ? 2.6 : 1.8) + Math.random() * (tier === 'pr' ? 4.2 : 2.6)
      Object.assign(p, { on: true, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.2, r: 1 + Math.random() * 2.4, life: 0, ttl: 600 + Math.random() * 500, col })
      made++; this.live++
    }
    if (made && !Ticker.jobs.has(this.job)) Ticker.add(this.job)
  },
  step(dt) {
    const c = this.ctx; c.clearRect(0, 0, this.W, this.H)
    const k = dt / 16.7
    let alive = 0
    for (const p of this.pool) {
      if (!p.on) continue
      p.life += dt
      if (p.life > p.ttl) { p.on = false; this.live--; continue }
      p.x += p.vx * k; p.y += p.vy * k; p.vy += .07 * k; p.vx *= Math.pow(.985, k); p.vy *= Math.pow(.985, k)
      const f = 1 - p.life / p.ttl
      c.beginPath(); c.arc(p.x, p.y, p.r * (0.6 + f * .6), 0, 6.2832)
      c.fillStyle = rgba(p.col, f); c.fill()
      alive++
    }
    if (!alive) { Ticker.remove(this.job); c.clearRect(0, 0, this.W, this.H) }
  },
  /* 超曝閃光：一個貼著目標元素外框的短暫光框 */
  flash(el) {
    if (!el || quiet()) return
    const r = el.getBoundingClientRect(); if (!r.width) return
    const f = doc.createElement('i'); f.className = 'fx-flash'
    f.style.cssText = `position:fixed;left:${r.left - 4}px;top:${r.top - 4}px;width:${r.width + 8}px;height:${r.height + 8}px;z-index:71`
    doc.body.appendChild(f)
    setTimeout(() => f.remove(), 1200)
  },
}

/* ══ Navigation layer：艙室轉位 ═════════════════════════════════════════ */
const Nav = {
  sweep(dir) {
    const main = $('.main'); if (!main || quiet()) return
    // 光帶包在一個 overflow:hidden 的外框裡：飛出去的那一段不能把文件撐寬（實測會撐出 600px 的橫向溢位）
    const wrap = doc.createElement('div'); wrap.className = 'fx-sweep-wrap'
    const s = doc.createElement('div'); s.className = 'fx-sweep'
    wrap.appendChild(s); main.appendChild(wrap)
    const from = dir > 0 ? 'translateX(-110%)' : 'translateX(290%)'
    const to = dir > 0 ? 'translateX(290%)' : 'translateX(-110%)'
    const a = anim(s, [{ transform: from, opacity: 0 }, { opacity: 1, offset: .3 }, { transform: to, opacity: 0 }], { duration: 480, easing: 'cubic-bezier(.16,1,.3,1)' })
    const done = () => wrap.remove()
    if (a) { a.onfinish = done; a.oncancel = done; setTimeout(done, 1200) } else done()
  },
  lock() {
    if (quiet()) return
    const dot = $('.nav-i[aria-current="page"]'); if (!dot) return
    const ring = doc.createElement('i'); ring.className = 'fx-lockring'
    dot.appendChild(ring)
    const a = anim(ring, [{ transform: 'scale(3.2)', opacity: 0 }, { transform: 'scale(1.6)', opacity: 1, offset: .5 }, { transform: 'scale(1)', opacity: 0 }], { duration: 520, easing: 'cubic-bezier(.16,1,.3,1)' })
    if (a) a.onfinish = () => ring.remove(); else ring.remove()
    const tab = $('.tab-i[aria-current="page"]')
    if (tab) { tab.classList.remove('fx-hit'); void tab.offsetWidth; tab.classList.add('fx-hit'); setTimeout(() => tab.classList.remove('fx-hit'), 700) }
  },
  head(el) {
    const h = el && el.querySelector('.view-h'); if (!h) return
    h.classList.remove('fx-in'); void h.offsetWidth; h.classList.add('fx-in')
  },
}

/* ══ Interaction layer ═══════════════════════════════════════════════════ */
const RIPPLE_SEL = '.row,.ses,.nav-i,.tab-i,.at-chip,.seg button,.wl-mtab,.wl-tab,.il-row,.tsv-ctrl button,.fxm-b,.qb-tab,.sport-tab,.dw-cta,.row-more,.at-bar button,.tj-node,.gu>summary,.show-more-btn,.pb-go,.deck-stat'
const Interact = {
  lastOrigin: null,
  init() {
    on(doc, 'pointerdown', e => {
      const host = e.target.closest && e.target.closest(RIPPLE_SEL)
      if (host) {
        this.lastOrigin = e.target.closest('.ses,.row,[data-drawer],[data-hvm],[data-ittday],.rdy-row,.tj-node') || null
        if (!quiet()) this.ripple(host, e)
      }
    }, { passive: true, capture: true })
    // 抽屜：開啟時給來源一圈光、抽屜一道掃描（shared-origin）
    const dw = $('#drawer')
    let wasOpen = false   // 只在 關→開 的那一次反應；自己加的 fx-arrive 也會觸發 observer，不擋會無限迴圈
    if (dw && win.MutationObserver) new MutationObserver(() => {
      const isOpen = dw.classList.contains('open')
      if (isOpen === wasOpen) return
      wasOpen = isOpen
      if (!isOpen || quiet()) return
      dw.classList.remove('fx-arrive'); void dw.offsetWidth; dw.classList.add('fx-arrive')
      setTimeout(() => dw.classList.remove('fx-arrive'), 800)
      const o = this.lastOrigin
      if (o && o.isConnected) { o.classList.add('fx-origin'); setTimeout(() => o.classList.remove('fx-origin'), 900) }
    }).observe(dw, { attributes: true, attributeFilter: ['class'] })
  },
  ripple(host, e) {
    const r = host.getBoundingClientRect()
    if (!r.width) return
    host.classList.add('fx-rip-host')
    const i = doc.createElement('i'); i.className = 'fx-ripple'
    i.style.left = (e.clientX - r.left) + 'px'; i.style.top = (e.clientY - r.top) + 'px'
    host.appendChild(i)
    setTimeout(() => i.remove(), 600)
  },
  /* touch 可鎖定的讀數：引擎變化的長條原本只有 pointerover，手指一離開就清掉。
     給它 tabindex，頁面既有的 focusin 路徑就會把讀數留住（點空白處 focus 走掉才解除）。 */
  touchLock() {
    $$('.pcw-b').forEach(b => { if (!b.hasAttribute('tabindex')) b.setAttribute('tabindex', '0') })
  },
}

/* ══ Event layer：只有真的事件才有最高強度 ══════════════════════════════ */
const Events = {
  list: [], fired: new Set(),
  load() { try { this.fired = new Set(JSON.parse(sessionStorage.getItem('fx-ev-v1') || '[]')) } catch (e) { this.fired = new Set() } },
  save() { try { sessionStorage.setItem('fx-ev-v1', JSON.stringify(Array.from(this.fired))) } catch (e) {} },
  detect(D) {
    const data = D.data || {}, today = todayTPE()
    const upd = (D.updatedAt || today).slice(0, 10)
    const within = (d, n) => d && (Date.parse(upd) - Date.parse(d.slice(0, 10))) / 86400e3 <= n
    this.list = []
    // 1. 全時 PR（最近 14 天）—— 功率或路段
    ;(data.power_prs || []).forEach(p => { if (within(p.date, 14)) this.list.push({ id: `pr-p-${p.duration_sec}-${p.date}`, tier: 'pr', view: 'deck', sel: '.row-st.pr', label: `${p.duration_label} ${p.watts} W 全時最佳` }) })
    ;(data.segments || []).forEach(s => (s.efforts || []).forEach(e => { if (e.is_pr && within(e.date, 14)) this.list.push({ id: `pr-s-${s.id}-${e.date}`, tier: 'pr', view: 'deck', sel: '.row-st.pr', label: `${s.name} PR ${e.elapsed_str}` }) }))
    // 2. 本週任務全部完成
    const wq = data.weekly_quest
    if (wq && ['ride', 'run', 'swim', 'weight'].every(k => wq[k] && wq[k].done)) this.list.push({ id: `week-${today.slice(0, 10)}`, tier: 'goal', view: 'deck', sel: '.meters', label: '本週四項任務全部完成' })
    // 3. 月目標達成
    const mg = data.monthly_goals || {}
    Object.keys(mg).forEach(k => { const s = mg[k] && mg[k].status; if (s === 'done' || s === 'over') this.list.push({ id: `month-${k}-${today.slice(0, 7)}`, tier: 'goal', view: 'train', sel: `.gring-i[data-fxgoal="${k}"]`, label: `${k} 月目標達成` }) })
    // 4. 下一堂就是今天（持續脈衝，不爆發）
    const S = ((D.block || {}).sessions || []).slice().sort((a, b) => a.date.localeCompare(b.date))
    const next = S.find(x => !x.actual && !x.support && x.date >= today)
    if (next && next.date === today) this.list.push({ id: `today-${today}`, tier: 'today', view: '*', sel: '.ov-cell.is-next,.nx', label: `${next.name} 就是今天` })
    // 5. TSB 進入極端窗口
    const sc = D.atmosphere && D.atmosphere.scene
    if (sc === 'fresh' || sc === 'redline') this.list.push({ id: `tsb-${sc}-${(D.atmosphere.inputs || {}).date || today}`, tier: 'ok', view: 'deck', sel: '.atm-scene', label: `TSB 進入 ${sc === 'fresh' ? '新鮮' : '高負荷'} 窗口` })
    // 月目標環：給 renderGoalRings 的每一環掛上 key，事件才找得到它（純 data-*，不改內容）
    $$('.gring-i').forEach(el => { const k = el.querySelector('svg') && (el.querySelector('svg').getAttribute('aria-label') || '').split(' ')[0]; const map = { 騎乘: 'ride', 跑步: 'run', 游泳: 'swim', 重訓: 'weight' }; if (map[k]) el.dataset.fxgoal = map[k] })
    this.applyPersistent()
  },
  applyPersistent() {
    this.list.filter(e => e.tier === 'today').forEach(e => $$(e.sel).forEach(el => el.classList.add('fx-today')))
  },
  onView(view) {
    if (quiet()) return
    const due = this.list.filter(e => (ALIAS[e.view] || e.view) === view && e.tier !== 'today' && !this.fired.has(e.id))
    if (!due.length) return
    // 同一個目標只爆一次（多筆 PR 落在同一列）；最強的 tier 決定強度
    const byTarget = new Map()
    due.forEach(e => { const cur = byTarget.get(e.sel); if (!cur || (e.tier === 'pr' && cur.tier !== 'pr')) byTarget.set(e.sel, e) })
    let delay = 700
    byTarget.forEach(e => {
      const el = $(e.sel)
      due.forEach(x => this.fired.add(x.id))
      if (!el) return
      setTimeout(() => {
        if (curView() !== view) return
        const r = el.getBoundingClientRect()
        Burst.fire(r.left + r.width / 2, r.top + r.height / 2, e.tier, e.tier === 'pr' ? 96 : 44)
        if (e.tier === 'pr') Burst.flash(el.closest('.row') || el)
        Atmo.waveFrom(el, e.tier === 'pr' ? [255, 215, 0] : e.tier === 'goal' ? [95, 208, 96] : undefined)
        emit('event', { id: e.id, tier: e.tier, label: e.label })
      }, delay)
      delay += 500
    })
    this.save()
  },
}

/* ══ Signature moments：九個艙室各自的進場 ═════════════════════════════ */
const Sig = {
  deck(el) {
    const meters = $$('.meter', el)
    meters.forEach((m, i) => { m.style.setProperty('--i', i); m.classList.remove('fx-ignite'); void m.offsetWidth; m.classList.add('fx-ignite') })
    setTimeout(() => Atmo.waveFrom($('.board-num', el)), 260)
    Viz.replay('reactor')
  },
  train(el) {
    $$('.ses', el).forEach((s, i) => { s.style.setProperty('--i', Math.min(i, 24)); s.classList.remove('fx-in'); void s.offsetWidth; s.classList.add('fx-in') })
    Viz.replay('trajectory')
    Cause.arm(el)
  },
  log(el) { Decode.arm(el) },
  itt() {},
  atlas() {},
  engine(el) { Viz.replay('powerslices'); Viz.replay('harvestdelay'); HarvestMotion.play(el) },
  body(el) {
    $$('.wl-mtab', el).forEach((t, i) => { t.style.setProperty('--i', i); t.classList.remove('fx-in'); void t.offsetWidth; t.classList.add('fx-in') })
    Viz.replay('constellation')
  },
  run(view, el) { const fn = this[view]; if (fn) safe('sig:' + view, () => fn.call(this, el)) },
}

/* Log · Black Box：日期列像飛行紀錄解碼 —— 數字先亂跳 6 格再落定。只動第一個文字節點，
   `.td-pr` 那顆徽章不碰。每個日期只解碼一次（換運動別重畫會生出新節點，那是新的一次）。 */
const Decode = {
  done: new WeakSet(), io: null,
  arm(root) {
    if (quiet()) return
    if (!this.io) this.io = new IntersectionObserver(es => es.forEach(e => {
      if (!e.isIntersecting) return
      this.io.unobserve(e.target); this.play(e.target)
    }), { threshold: .2 })
    $$('.timeline-date', root).forEach(d => { if (!this.done.has(d)) { this.done.add(d); this.io.observe(d) } })
  },
  play(el) {
    const tn = Array.from(el.childNodes).find(n => n.nodeType === 3 && /\d/.test(n.nodeValue))
    if (!tn) return
    const orig = tn.nodeValue
    let n = 0
    el.classList.add('fx-decode')
    const tick = () => {
      if (!el.isConnected) return
      if (n++ >= 6) { tn.nodeValue = orig; el.classList.remove('fx-decode'); return }
      tn.nodeValue = orig.replace(/\d/g, () => String(Math.random() * 10 | 0))
      setTimeout(tick, 42)
    }
    tick()
  },
}

/* Playbook · Pit Wall：問題 → 證據 → 處方 → 中止條件 依序點亮成一條因果鏈 */
const Cause = {
  done: new WeakSet(), io: null,
  arm(root) {
    if (!this.io) this.io = new IntersectionObserver(es => es.forEach(e => {
      if (!e.isIntersecting) return
      this.io.unobserve(e.target); this.play(e.target)
    }), { threshold: .08 })
    $$('.pb-climb', root).forEach(c => { if (!this.done.has(c)) { this.done.add(c); this.io.observe(c) } })
  },
  play(climb) {
    if (quiet()) return
    $$('.pb-sub', climb).forEach((s, i) => { s.style.setProperty('--i', i); s.classList.add('fx-in') })
    $$('.pb-rule,.pb-flag', climb).forEach((r, i) => { r.style.setProperty('--i', i); r.classList.add('fx-in') })
    // 換檔軌跡：階梯線像示波器一樣描出來
    $$('.pb-svg path', climb).forEach((p, i) => {
      let len = 0; try { len = p.getTotalLength() } catch (e) { return }
      if (!(len > 1)) return
      p.style.strokeDasharray = len + ' ' + len; p.style.strokeDashoffset = String(len)
      const a = anim(p, [{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 1100, delay: 200 + i * 140, easing: 'cubic-bezier(.4,0,.2,1)' })
      const clear = () => { p.style.strokeDasharray = ''; p.style.strokeDashoffset = '' }
      if (a) a.onfinish = clear; else clear()
    })
  },
}

/* ITT · Terrain Chamber：每座測量檯第一次進入視野 → 掃描一次（地形載入測量艙） */
const Terrain = {
  done: new WeakSet(), io: null,
  arm() {
    if (!this.io) this.io = new IntersectionObserver(es => es.forEach(e => {
      if (!e.isIntersecting) return
      this.io.unobserve(e.target)
      if (quiet()) return
      e.target.classList.add('fx-loaded')
      setTimeout(() => e.target.classList.remove('fx-loaded'), 2200)
    }), { threshold: .25 })
    $$('.tsv').forEach(t => { if (!this.done.has(t)) { this.done.add(t); this.io.observe(t) } })
  },
}

/* Harvest · Growth Chamber：沿同一根 x 軸，投入（柱）先長、引擎（線）跟上、收成（方塊）最後落下。
   全部用 transform／stroke-dash 的 WAAPI，跑完把 inline 清掉 —— 終態跟沒有動效層時逐屬性相同。 */
const HarvestMotion = {
  play(root) {
    const body = $('#hv-body', root); if (!body) return
    const N = parseInt(getComputedStyle(body).getPropertyValue('--hv-n')) || 1
    const per = Math.max(18, Math.min(60, 1400 / N))
    $$('.hv-bar', body).forEach(b => {
      const i = +b.dataset.i || 0
      b.style.transformOrigin = 'bottom'
      const a = anim(b, [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], { duration: 520, delay: i * per, easing: 'cubic-bezier(.16,1,.3,1)' })
      if (a) a.onfinish = () => { b.style.transform = ''; b.style.transformOrigin = '' }
    })
    $$('.hv-line path', body).forEach((p, k) => {
      let len = 0; try { len = p.getTotalLength() } catch (e) { return }
      if (!(len > 1) || p.classList.contains('fill')) return
      p.style.strokeDasharray = len + ' ' + len; p.style.strokeDashoffset = String(len)
      const a = anim(p, [{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 1200, delay: 300 + k * 120, easing: 'cubic-bezier(.4,0,.2,1)' })
      const clear = () => { p.style.strokeDasharray = ''; p.style.strokeDashoffset = '' }
      if (a) a.onfinish = clear; else clear()
    })
    $$('.hv-plot .hv-dot,.hv-tag', body).forEach(d => {
      const a = anim(d, [{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: 1100 })
      if (a) a.onfinish = () => { d.style.opacity = '' }
    })
    $$('.hv-c', body).forEach((c, i) => $$('.hv-m', c).forEach((m, k) => {
      const a = anim(m, [{ transform: 'scale(0) translateY(-12px)', opacity: 0 }, { transform: '', opacity: 1 }], { duration: 420, delay: 900 + i * per + k * 70, easing: 'cubic-bezier(.34,1.56,.64,1)' })
      if (a) a.onfinish = () => { m.style.transform = ''; m.style.opacity = '' }
    }))
    $$('.hd-arcs path', body).forEach((p, k) => {
      let len = 0; try { len = p.getTotalLength() } catch (e) { return }
      p.style.strokeDasharray = len + ' ' + len; p.style.strokeDashoffset = String(len)
      const a = anim(p, [{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 700, delay: 1500 + k * 60 })
      const clear = () => { p.style.strokeDasharray = '3 4'; p.style.strokeDashoffset = '' }
      if (a) a.onfinish = clear; else clear()
    })
  },
}

/* Atlas · Orbital Survey：膠囊點了不是瞬移，是鏡頭飛行 ＋ 訊號鎖定。
   做法：capture 階段先把 atDraw 換成空函式（讓原本的處理器算好目標視角但不畫），
   microtask 裡讀出目標、把視角退回起點、再用 Ticker 插值飛過去。原本的邏輯一個字沒改。 */
const Flight = {
  armed: false, job: null, from: null, to: null, t0: 0, dur: 760,
  arm() {
    if (this.armed) return
    const rail = $('.at-rail'), bar = $('.at-bar'); if (!rail) return
    this.armed = true
    const hook = e => {
      const AT = g('AT'); if (!AT || !AT.ready || quiet()) return
      const orig = win.atDraw
      if (typeof orig !== 'function') return
      const before = { cx: AT.view.cx, cy: AT.view.cy, k: AT.view.k }
      win.atDraw = function () {}
      queueMicrotask(() => {
        win.atDraw = orig
        const after = { cx: AT.view.cx, cy: AT.view.cy, k: AT.view.k }
        if (after.cx === before.cx && after.cy === before.cy && after.k === before.k) { orig(); return }
        AT.view.cx = before.cx; AT.view.cy = before.cy; AT.view.k = before.k
        this.fly(AT, before, after, orig, !!(e.target.closest && e.target.closest('.at-chip')))
      })
    }
    on(rail, 'click', hook, true)
    if (bar) on(bar, 'click', e => { if (e.target.closest('#at-home,#at-all')) hook(e) }, true)
  },
  fly(AT, from, to, draw, lock) {
    if (this.job) { Ticker.remove(this.job); this.job = null }
    this.from = from; this.to = to; this.t0 = performance.now()
    const stage = $('.at-stage')
    this.job = () => {
      const k = clamp((performance.now() - this.t0) / this.dur, 0, 1), e = ease(k)
      // 縮放走對數插值，飛行途中的速度感才均勻
      AT.view.k = Math.exp(lerp(Math.log(from.k), Math.log(to.k), e))
      AT.view.cx = lerp(from.cx, to.cx, e); AT.view.cy = lerp(from.cy, to.cy, e)
      draw()
      if (k >= 1) {
        Ticker.remove(this.job); this.job = null
        if (lock && stage) {
          let ring = $('.at-lock', stage)
          if (!ring) { ring = doc.createElement('i'); ring.className = 'at-lock'; stage.appendChild(ring) }
          ring.classList.remove('on'); void ring.offsetWidth; ring.classList.add('on')
        }
      }
    }
    Ticker.add(this.job)
  },
}

/* ══ Orchestrator：把上面幾層串起來 ═══════════════════════════════════ */
const Orch = {
  init() {
    on(win, 'strava:view', e => {
      const d = e.detail || {}
      View.prev = d.from; View.cur = d.to
      Atmo.sync()
      safe('namecard', () => { const nc = win.__nameCard; if (nc) ((overdrive() && d.to === 'deck') ? nc.resume() : nc.pause()) })
      if (!quiet()) { Nav.sweep(d.dir || 1); Nav.lock(); Nav.head(d.el) }
      Sig.run(d.to, d.el)
      if (d.to === 'itt') Terrain.arm()
      if (d.to === 'atlas') Flight.arm()
      Events.onView(d.to)
    })
    // 分段展開（Log 的 lap strip）像封包解壓：style.display 從 none 變回來的那一刻加動畫
    if (win.MutationObserver) new MutationObserver(muts => {
      let k = 0
      for (const m of muts) {
        const t = m.target
        if (!(t instanceof Element) || !t.matches('.lap-strip[data-lapgrp]')) continue
        if (t.style.display === 'none') { t.dataset.fxShown = '0'; continue }
        // 自己寫的 --i 也是 style 變動，observer 會再進來一次：已經處理過的就跳過（dataset 不在觀察範圍內）
        if (t.dataset.fxShown === '1' || quiet()) continue
        t.dataset.fxShown = '1'
        t.style.setProperty('--i', k++); t.classList.remove('fx-unpack'); void t.offsetWidth; t.classList.add('fx-unpack')
      }
    }).observe($('#content') || doc.body, { attributes: true, attributeFilter: ['style'], subtree: true })
    // Log 換運動別頁籤會整塊重畫 timeline：新的日期列要重新武裝解碼
    const tl = $('#timeline')
    if (tl && win.MutationObserver) new MutationObserver(() => { if (curView() === 'log') Decode.arm(tl) }).observe(tl, { childList: true })
  },
}

/* ══ Viz：五張新圖的登記處 ═══════════════════════════════════════════════
   每張圖：renderer(host, D) → 畫得出來就回 true（宿主拿掉 hidden），畫不出來（資料不足）就回 false，
   宿主維持 hidden —— 不會有空框或假圖。host.__replay 是進場動畫，切回該 view 時重播一次。 */
const Viz = {
  reg: {},
  add(name, fn) { this.reg[name] = fn },
  renderAll(D) {
    Object.keys(this.reg).forEach(n => {
      const host = $(`.fx-host[data-fxviz="${n}"]`); if (!host) return
      const ok = safe('viz:' + n, () => this.reg[n](host, D))
      host.hidden = !ok
      if (!ok) host.innerHTML = ''
    })
  },
  replay(name) {
    const host = $(`.fx-host[data-fxviz="${name}"]`)
    if (host && !host.hidden && typeof host.__replay === 'function') safe('replay:' + name, () => host.__replay())
  },
}
const title = (zh, en) => `<div class="section-title">${zh} <span class="muted">· ${en}</span></div>`
const hhmm = s => s == null ? '—' : `${Math.floor(s / 3600)}:${String(Math.round(s % 3600 / 60)).padStart(2, '0')}`
const drawPath = (p, dur, delay, easing) => {
  let len = 0; try { len = p.getTotalLength() } catch (e) { return }
  if (!(len > 1)) return
  p.style.strokeDasharray = len + ' ' + len; p.style.strokeDashoffset = String(len)
  const a = anim(p, [{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: dur, delay: delay || 0, easing: easing || 'cubic-bezier(.4,0,.2,1)' })
  const clear = () => { p.style.strokeDasharray = ''; p.style.strokeDashoffset = '' }
  if (a) a.onfinish = clear; else clear()
}
const fadeIn = (el, dur, delay) => { const a = anim(el, [{ opacity: 0 }, { opacity: 1 }], { duration: dur, delay: delay || 0 }); if (a) a.onfinish = () => { el.style.opacity = '' } }
const popIn = (el, delay) => { const a = anim(el, [{ transform: 'scale(0)' }, { transform: 'scale(1)' }], { duration: 420, delay: delay || 0, easing: 'cubic-bezier(.34,1.56,.64,1)' }); if (a) a.onfinish = () => { el.style.transform = '' } }

/* ── 7a · Readiness Reactor（Overview · Flight Deck）─────────────────────
   回答：今天適合恢復、累積、還是輸出？
   資料：wellness 的 CTL／ATL（同一個刻度：外圈體能、內圈疲勞，疲勞蓋過體能的形狀一眼看得到）、
   TSB（核心色＝側欄 tsbMood 的四階）、HRV 對 60 天基準帶、靜息心率對 60 天基準帶、睡眠對 28 天均值。
   沒有發明新指標：全部是既有欄位，門檻沿用側欄與身體頁。缺值＝虛線空環＋「—」。 */
Viz.add('reactor', (host, D) => {
  const A = D.atmosphere, I = (A && A.inputs) || {}
  if (I.ctl == null || I.atl == null) return false
  const ws = g('wellnessSeries'), rb = g('rollingBand'), tm = g('tsbMood')
  const mood = tm ? tm(I.tsb) : { txt: '—', cls: '' }
  const scale = Math.max(I.ctlMax90 || 0, I.ctl, I.atl) * 1.15 || 1
  const C = 170   // viewBox 340：衛星要坐在兩個環（r 118／102）外面，標籤才不會壓在弧上
  const arc = (r, frac) => {
    const f = clamp(frac, 0, .9999), a0 = -Math.PI / 2, a1 = a0 + Math.PI * 2 * f
    return `M${(C + r * Math.cos(a0)).toFixed(1)} ${(C + r * Math.sin(a0)).toFixed(1)}A${r} ${r} 0 ${f > .5 ? 1 : 0} 1 ${(C + r * Math.cos(a1)).toFixed(1)} ${(C + r * Math.sin(a1)).toFixed(1)}`
  }
  // 三顆衛星：HRV（基準帶）、睡眠（28 天均值）、靜息（基準帶）
  const series = k => (ws ? ws(k, 90) : [])
  const band = k => { const s = series(k); const b = rb ? rb(s, 60) : []; return [...b].reverse().find(Boolean) || null }
  const mean = (k, n) => { const v = series(k).slice(-n).map(p => p[1]).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }
  const hb = I.hrvBand || band('hrv'), rbnd = band('restingHR'), sm = mean('sleepSecs', 28)
  const sats = [
    { k: 'HRV', v: I.hrv, date: I.hrvDate, unit: 'ms', frac: (I.hrv != null && hb) ? clamp((I.hrv - hb[0]) / Math.max(1, hb[1] - hb[0]), 0, 1) : null,
      st: I.hrv == null ? 'na' : !hb ? 'mid' : I.hrv < hb[0] ? 'bad' : 'good', note: hb ? `基準帶 ${Math.round(hb[0])}–${Math.round(hb[1])}` : '基準帶不足 60 天' },
    { k: '睡眠', v: I.sleepSecs, date: I.sleepDate, unit: '', fmt: hhmm, frac: (I.sleepSecs != null && sm) ? clamp(I.sleepSecs / (sm * 1.25), 0, 1) : null,
      st: I.sleepSecs == null ? 'na' : !sm ? 'mid' : I.sleepSecs >= sm ? 'good' : I.sleepSecs < sm * .85 ? 'bad' : 'mid', note: sm ? `28 天均 ${hhmm(sm)}` : '沒有 28 天均值' },
    { k: '靜息', v: I.restingHR, date: I.restingDate, unit: 'bpm', frac: (I.restingHR != null && rbnd) ? 1 - clamp((I.restingHR - rbnd[0]) / Math.max(1, rbnd[1] - rbnd[0]), 0, 1) : null,
      st: I.restingHR == null ? 'na' : !rbnd ? 'mid' : I.restingHR > rbnd[1] ? 'bad' : 'good', note: rbnd ? `基準帶 ${Math.round(rbnd[0])}–${Math.round(rbnd[1])}` : '基準帶不足 60 天' },
  ]
  const SAT_COL = { good: '#4AD07A', mid: '#FFB020', bad: '#FF6A6A', na: 'rgba(244,240,234,.3)' }
  const satHtml = sats.map((s, i) => {
    const ang = (-150 + i * 60) * Math.PI / 180, R = 148, cx = C + R * Math.cos(ang), cy = C + R * Math.sin(ang), r = 13
    const a0 = -Math.PI / 2, f = s.frac == null ? 0 : clamp(s.frac, .02, .9999), a1 = a0 + Math.PI * 2 * f
    const d = `M${(cx + r * Math.cos(a0)).toFixed(1)} ${(cy + r * Math.sin(a0)).toFixed(1)}A${r} ${r} 0 ${f > .5 ? 1 : 0} 1 ${(cx + r * Math.cos(a1)).toFixed(1)} ${(cy + r * Math.sin(a1)).toFixed(1)}`
    const val = s.v == null ? '—' : (s.fmt ? s.fmt(s.v) : Math.round(s.v))
    return `<g class="r-satg" data-i="${i}">
      <circle class="r-satbg" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r}"${s.frac == null ? ' stroke-dasharray="2 3"' : ''}/>
      ${s.frac == null ? '' : `<path class="r-sat" d="${d}" stroke="${SAT_COL[s.st]}"/>`}
      <text class="r-lab" x="${cx.toFixed(1)}" y="${(cy - 21).toFixed(1)}" text-anchor="middle">${s.k}</text>
      <text class="r-sub" x="${cx.toFixed(1)}" y="${(cy + 30).toFixed(1)}" text-anchor="middle" fill="${SAT_COL[s.st]}">${val}${s.unit ? ' ' + s.unit : ''}</text>
    </g>`
  }).join('')
  const MOOD_COL = { 'rdy-fresh': '#4AD07A', 'rdy-ok': '#f4f0ea', 'rdy-tired': '#FFB020', 'rdy-deep': '#FC4C02', '': 'rgba(244,240,234,.4)' }
  const coreCol = MOOD_COL[mood.cls] || MOOD_COL['']
  const period = clamp(3.0 - (I.atl / 40) * 1.8, 1.0, 3.0).toFixed(2)
  const f1 = v => (v > 0 ? '+' : '') + v.toFixed(1)
  // TSB 刻度：底部 200°→340° 的一段弧，−30 … +30
  const tsbArc = (() => { const r = 132, s = 200 * Math.PI / 180, e = 340 * Math.PI / 180
    return `M${(C + r * Math.cos(s)).toFixed(1)} ${(C + r * Math.sin(s)).toFixed(1)}A${r} ${r} 0 0 1 ${(C + r * Math.cos(e)).toFixed(1)} ${(C + r * Math.sin(e)).toFixed(1)}` })()
  const nAng = (200 + clamp((I.tsb + 30) / 60, 0, 1) * 140) * Math.PI / 180
  const needle = `<line class="r-needle" x1="${(C + 122 * Math.cos(nAng)).toFixed(1)}" y1="${(C + 122 * Math.sin(nAng)).toFixed(1)}" x2="${(C + 140 * Math.cos(nAng)).toFixed(1)}" y2="${(C + 140 * Math.sin(nAng)).toFixed(1)}"/>`
  const ticks = Array.from({ length: 24 }, (_, i) => { const a = i / 24 * Math.PI * 2; return `<line class="r-tick" x1="${(C + 88 * Math.cos(a)).toFixed(1)}" y1="${(C + 88 * Math.sin(a)).toFixed(1)}" x2="${(C + 92 * Math.cos(a)).toFixed(1)}" y2="${(C + 92 * Math.sin(a)).toFixed(1)}"/>` }).join('')
  const cxy = (r) => `cx="${C}" cy="${C}" r="${r}"`
  const row = (k, v, unit, s, cls) => `<div class="rx-row${cls ? ' ' + cls : ''}"><span class="k">${k}</span><span class="s">${s}</span><span class="v${v == null ? ' is-na' : ''}">${v == null ? '— 無資料' : v}${v != null && unit ? `<small>${unit}</small>` : ''}</span></div>`
  const stCls = st => st === 'good' ? 'is-good' : st === 'bad' ? 'is-bad' : st === 'mid' ? 'is-warn' : ''
  const ramp = I.rampRate
  host.innerHTML = title('狀態核心', 'READINESS REACTOR · CTL／ATL／TSB · HRV · 睡眠 · 靜息') + `
    <div class="rx" style="--rx-period:${period}s">
      <div class="rx-core"><svg viewBox="0 0 340 340" role="img" aria-label="狀態核心：TSB ${f1(I.tsb)}，CTL ${I.ctl.toFixed(1)}，ATL ${I.atl.toFixed(1)}">
        <defs><radialGradient id="rxg"><stop offset="0" stop-color="${coreCol}" stop-opacity=".95"/><stop offset=".55" stop-color="${coreCol}" stop-opacity=".25"/><stop offset="1" stop-color="${coreCol}" stop-opacity="0"/></radialGradient></defs>
        <circle class="r-halo" ${cxy(70)} fill="url(#rxg)"/>
        <circle class="r-core" ${cxy(46)} fill="url(#rxg)"/>
        ${ticks}
        <circle class="r-bg" ${cxy(118)}/><circle class="r-bg" ${cxy(102)}/>
        <path class="r-ctl" d="${arc(118, I.ctl / scale)}"/>
        <path class="r-atl${I.atl > I.ctl ? ' is-over' : ''}" d="${arc(102, I.atl / scale)}"/>
        <path class="r-tick" d="${tsbArc}" fill="none" stroke="rgba(255,255,255,.18)"/>
        ${needle}
        <text class="r-num${I.tsb == null ? ' is-na' : ''}" x="${C}" y="${C + 10}" text-anchor="middle">${f1(I.tsb)}</text>
        <text class="r-sub" x="${C}" y="${C + 32}" text-anchor="middle">TSB · ${mood.txt}</text>
        <text class="r-lab" x="${C - 122}" y="${C + 4}" text-anchor="end">CTL</text>
        <text class="r-lab" x="${C + 122}" y="${C + 4}" text-anchor="start">ATL</text>
        <text class="r-sub" x="${C}" y="${C + 148}" text-anchor="middle">−30 ◂ TSB ▸ +30</text>
        ${satHtml}
        <circle class="r-wave" ${cxy(118)}/>
      </svg></div>
      <div class="rx-side">
        <div class="rx-rows">
          ${row('CTL 體能', I.ctl.toFixed(1), '', `外圈 · 90 天最高 ${I.ctlMax90 != null ? I.ctlMax90.toFixed(1) : '—'}`)}
          ${row('ATL 疲勞', I.atl.toFixed(1), '', `內圈 · 疲勞是體能的 ${Math.round(I.atl / Math.max(1, I.ctl) * 100)}%${I.atl > I.ctl ? '，蓋過體能' : ''}`, I.atl > I.ctl * 1.15 ? 'is-warn' : '')}
          ${row('TSB', f1(I.tsb), '', `體能 − 疲勞 · ${mood.txt}${I.date ? ' · ' + md(I.date) : ''}`, mood.cls === 'rdy-fresh' ? 'is-good' : mood.cls === 'rdy-tired' ? 'is-warn' : mood.cls === 'rdy-deep' ? 'is-bad' : '')}
          ${sats.map(s => row(s.k, s.v == null ? null : (s.fmt ? s.fmt(s.v) : Math.round(s.v)), s.unit, `${s.note}${s.date ? ' · ' + md(s.date) : ''}`, stCls(s.st))).join('')}
          ${ramp != null ? row('負荷爬升', (ramp > 0 ? '+' : '') + ramp.toFixed(1), '/週', 'CTL 一週的變化量', ramp > 8 ? 'is-warn' : '') : ''}
        </div>
        <p class="fxv-note">核心的顏色就是側欄 TSB 的四階（新鮮／平衡／疲勞中／高負荷）；脈動快慢跟著 ATL。
          外圈與內圈共用同一把尺，內圈追過外圈＝疲勞蓋過體能。三顆衛星各自對「自己平常」比，不是對別人。</p>
      </div>
    </div>`
  const svg = $('svg', host)
  const wave = $('.r-wave', svg)
  on(win, 'fx:wave', () => { if (!wave || quiet()) return; wave.classList.remove('go'); void wave.getBBox(); wave.classList.add('go') })
  host.__replay = () => {
    $$('.r-ctl,.r-atl,.r-sat', svg).forEach((p, i) => drawPath(p, 1100, 120 + i * 140, 'cubic-bezier(.16,1,.3,1)'))
    popIn($('.r-core', svg), 80)
    fadeIn($('.r-needle', svg), 500, 900)
  }
  host.__replay()
  return true
})

/* ── 7b · Training Trajectory（Plan · Trajectory Room）───────────────────
   回答：照課表走，累積負荷該在哪裡？實際走到哪裡？下一個鎖定目標是哪一堂？
   資料：training-block.json 的 sessions（目標 TSS 累積＝預定軌道；SES_DONE 的實際 TSS 累積＝實際軌道）、
   每一堂的狀態沿用 renderMesocycle 已經算好的 window.__mcDetail，沒有第二套判定。
   節點是真的 button（data-ses → 既有的抽屜），hover／focus／touch 都有讀數。 */
Viz.add('trajectory', (host, D) => {
  const B = D.block
  if (!B || !Array.isArray(B.sessions) || !B.sessions.length || !B.start || !B.end) return false
  const S = B.sessions.slice().sort((a, b) => a.date.localeCompare(b.date))
  const det = win.__mcDetail || {}
  const today = todayTPE()
  const t0 = Date.parse(B.start), t1 = Date.parse(B.end), span = Math.max(1, t1 - t0)
  const X = d => clamp((Date.parse(d) - t0) / span, 0, 1)
  const key = S.filter(s => !s.support)
  if (key.length < 2) return false
  let cp = 0
  const plan = key.map(s => { cp += (s.target && s.target.tss) || 0; return { s, x: X(s.date), y: cp } })
  const maxY = Math.max(1, cp)
  let ca = 0
  const act = []
  key.forEach(s => {
    if (s.date > today) return
    if (s.actual && !s.actual.substituted && s.actual.tss != null) ca += s.actual.tss
    act.push({ x: X(s.date), y: ca, s })
  })
  const xNow = X(today)
  const W = 1000, H = 210, PAD = 14
  const px = x => (x * W).toFixed(1), py = y => (H - PAD - (y / maxY) * (H - PAD * 2)).toFixed(1)
  const planD = `M${px(0)} ${py(0)}` + plan.map(p => `L${px(p.x)} ${py(p.y)}`).join('')
  const planF = planD + `L${px(plan[plan.length - 1].x)} ${py(0)}Z`
  const actPts = [{ x: 0, y: 0 }].concat(act.map(p => ({ x: p.x, y: p.y })))
  if (actPts[actPts.length - 1].x < xNow) actPts.push({ x: xNow, y: ca })
  const actD = actPts.map((p, i) => `${i ? 'L' : 'M'}${px(p.x)} ${py(p.y)}`).join('')
  const planAt = x => { let y = 0; for (const p of plan) { if (p.x <= x) y = p.y; else break } return y }
  const gapD = actPts.map((p, i) => `${i ? 'L' : 'M'}${px(p.x)} ${py(p.y)}`).join('') + actPts.slice().reverse().map(p => `L${px(p.x)} ${py(planAt(p.x))}`).join('') + 'Z'
  const ahead = ca >= planAt(xNow)
  const planNow = planAt(xNow)
  const WD = ['日', '一', '二', '三', '四', '五', '六']
  const wd = d => WD[new Date(d + 'T00:00:00Z').getUTCDay()]
  const n2 = v => v == null ? '—' : (+v).toFixed(2).replace(/^0/, '')
  const nodes = S.map(s => {
    const d = det[s.date] || {}, st = d.st || {}
    const cls = s.support ? 'is-sup' : ('is-' + (st.cls || 'sched') + (st.extra === 'is-sub' ? ' is-sub' : ''))
    const p = s.support ? null : plan.find(q => q.s === s)
    const x = X(s.date) * 100, y = s.support ? 100 : (100 - (p.y / maxY) * (1 - 2 * PAD / H) * 100 - PAD / H * 100)
    const lab = `${md(s.date)} 週${wd(s.date)} · ${s.name || ''}${st.badge ? ' · ' + st.badge : ''}`
    return `<button class="tj-node ${cls}" type="button" data-ses="${s.date}" data-tj="${s.date}" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%" aria-label="${esc(lab)}" title="${esc(lab)}"></button>`
  }).join('')
  const yl = v => `<span class="tj-yl" style="top:${(100 - (v / maxY) * (1 - 2 * PAD / H) * 100 - PAD / H * 100).toFixed(2)}%">${Math.round(v)}</span>`
  const ses = det, nextS = key.find(s => !s.actual && s.date >= today)
  const idle = `到今天為止：預定累積 <b>${Math.round(planNow)}</b> TSS，實際 <b>${Math.round(ca)}</b> TSS <em>· ${ahead ? '領先' : '落後'} ${Math.abs(Math.round(ca - planNow))}</em>${
    nextS ? `<br><em>鎖定目標 ${md(nextS.date)} 週${wd(nextS.date)} · ${esc(nextS.name || '')}${nextS.target ? ` · 目標 IF ${n2(nextS.target.if)} · TSS ${nextS.target.tss ?? '—'}` : ''}</em>` : '<br><em>週期已排完</em>'}`
  host.innerHTML = title('訓練軌道', `TRAINING TRAJECTORY · ${md(B.start)} – ${md(B.end)}`) + `
    <div class="tj"><div class="tj-wrap">
      <div class="tj-plot" id="tj-plot">
        <svg class="tj-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
          <rect class="t-fut" x="${px(xNow)}" y="0" width="${(W - xNow * W).toFixed(1)}" height="${H}"/>
          <line class="t-grid" x1="0" x2="${W}" y1="${py(maxY / 2)}" y2="${py(maxY / 2)}"/>
          <line class="t-grid" x1="0" x2="${W}" y1="${py(0)}" y2="${py(0)}"/>
          <path class="t-planf" d="${planF}"/>
          <path class="t-gap${ahead ? ' is-ahead' : ''}" d="${gapD}"/>
          <path class="t-plan" d="${planD}"/>
          <path class="t-act" d="${actD}"/>
          <line class="t-now" x1="${px(xNow)}" x2="${px(xNow)}" y1="0" y2="${H}"/>
        </svg>
        ${yl(0)}${yl(maxY / 2)}${yl(maxY)}
        <span class="tj-lab" style="left:0;top:-14px">${md(B.start)}</span>
        <span class="tj-lab is-hi" style="left:${(xNow * 100).toFixed(2)}%;top:-14px;transform:translateX(-50%)">今天</span>
        <span class="tj-lab" style="right:0;top:-14px">${md(B.end)}</span>
        ${nodes}
      </div>
      <div class="tj-leg">
        <span><i style="background:#5FD060"></i>達標</span><span><i style="background:#FF6A6A"></i>未達</span>
        <span><i style="border:1.5px dashed rgba(255,106,106,.7)"></i>未執行</span><span><i style="border:1.5px dashed #FFB020"></i>替代</span>
        <span><i style="background:#FC4C02;box-shadow:0 0 8px rgba(252,76,2,.8)"></i>下一堂（鎖定）</span>
        <span><i style="border:1.5px solid rgba(244,240,234,.5)"></i>排定</span><span><i style="width:6px;height:6px;border:1px dashed rgba(252,76,2,.6)"></i>輔助（底線）</span>
        <span><i style="width:14px;height:0;border-top:1.5px dashed rgba(244,240,234,.5);border-radius:0"></i>預定軌道（目標 TSS 累積）</span>
        <span style="color:#FC4C02"><i style="width:14px;height:0;border-top:2px solid #FC4C02;border-radius:0"></i>實際軌道</span>
      </div>
      <div class="fxv-read" id="tj-read" data-idle="${esc(idle)}">${idle}</div>
      <p class="fxv-note">上面那條虛線是「照課表走，累積 TSS 該長成什麼樣」，橘線是實際做到的；兩線之間的色塊＝落後（紅）或領先（綠）。
        點任何一顆節點開它的課表細節（跟下面的清單同一個抽屜）。輔助課表不計進度，所以貼著底線。</p>
    </div></div>`
  const read = $('#tj-read', host)
  const show = el => {
    if (!read) return
    if (!el) { read.innerHTML = read.dataset.idle; return }
    const d = ses[el.dataset.tj]; if (!d) return
    const s = d.s, st = d.st || {}, t = s.target || {}, a = s.actual
    const actTxt = a && !a.substituted && !s.support ? `實際 IF ${n2(a.if)} · TSS ${Math.round(a.tss ?? 0)} · VI ${n2(a.vi)}` : a && a.substituted ? `替代：${esc(a.sub_name || '')}` : ''
    read.innerHTML = `${md(s.date)} 週${wd(s.date)} · <b>${esc(s.name || '')}</b> <em>· ${st.badge || ''}</em><br><em>${s.support ? esc(s.metrics || s.plan || '') : `目標 IF ${n2(t.if)} · TSS ${t.tss ?? '—'} · VI ≤${n2(t.vi)}${actTxt ? '　' + actTxt : ''}`}</em>`
  }
  const plot = $('#tj-plot', host)
  on(plot, 'pointerover', e => { const n = e.target.closest('.tj-node'); if (n) { $$('.tj-node.is-hot', plot).forEach(x => x.classList.remove('is-hot')); n.classList.add('is-hot'); show(n) } })
  on(plot, 'focusin', e => { const n = e.target.closest('.tj-node'); if (n) show(n) })
  on(plot, 'pointerleave', () => { $$('.tj-node.is-hot', plot).forEach(x => x.classList.remove('is-hot')); show(null) })
  on(plot, 'focusout', e => { if (!plot.contains(e.relatedTarget)) show(null) })
  host.__replay = () => {
    drawPath($('.t-plan', host), 900, 0)
    drawPath($('.t-act', host), 1100, 300, 'cubic-bezier(.16,1,.3,1)')
    fadeIn($('.t-gap', host), 500, 1000)
    $$('.tj-node', host).forEach(n => popIn(n, 200 + parseFloat(n.style.left) * 9))
  }
  host.__replay()
  return true
})

/* ── 7c · Power Time Slices（Trends · Engine Observatory）────────────────
   回答：同一條功率曲線，在三個時間切面上長什麼形狀？哪一段時長在變強、哪一段在退？
   資料：power_prs（全時最佳）＋ power-curve-windows.json 的 prev／now 兩個 182 天視窗。
   三片切面共用同一把瓦數尺，基線各退一階做出深度（ridgeline）；精確值指到任一時長就有。 */
Viz.add('powerslices', (host, D) => {
  const prs = (D.data || {}).power_prs || []
  const PW = g('PWR_DURATIONS') || [5, 10, 30, 60, 120, 300, 600, 1200, 3600].map(s => ({ sec: s, label: s + 's' }))
  const ws = (D.powerShift && D.powerShift.windows) || []
  const prev = ws.find(w => w.key === 'prev') || ws[0] || null, now = ws.find(w => w.key === 'now') || ws[1] || null
  const mapOf = list => new Map((list || []).map(b => [b.secs, b.watts]))
  const all = new Map(prs.filter(p => p.watts > 0).map(p => [p.duration_sec, p.watts]))
  const slices = [
    { k: 'prev', zh: prev ? `前半年 ${md(prev.from)}–${md(prev.to)}` : '', m: prev ? mapOf(prev.best) : new Map(), base: .70 },
    { k: 'now', zh: now ? `近半年 ${md(now.from)}–${md(now.to)}` : '', m: now ? mapOf(now.best) : new Map(), base: .85 },
    { k: 'all', zh: '全時最佳', m: all, base: 1 },
  ].filter(s => s.m.size >= 4)
  if (slices.length < 2) return false
  const durs = PW.map(d => d.sec).filter(sec => slices.some(s => s.m.has(sec)))
  if (durs.length < 4) return false
  const W = 1000, H = 250, PADX = 16
  const L = Math.log(durs[0]), R = Math.log(durs[durs.length - 1])
  const X = sec => PADX + (Math.log(sec) - L) / (R - L) * (W - PADX * 2)
  const wHi = Math.max(...slices.flatMap(s => Array.from(s.m.values())))
  const top = Math.ceil(wHi * 1.06 / 200) * 200
  const hScale = .78   // 瓦數佔畫布高的比例（留出三層基線的位移）
  const Y = (w, base) => H * base - (w / top) * H * hScale
  const paths = slices.map(s => {
    const pts = durs.filter(sec => s.m.has(sec)).map(sec => [X(sec), Y(s.m.get(sec), s.base)])
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('')
    const fill = line + `L${pts[pts.length - 1][0].toFixed(1)} ${(H * s.base).toFixed(1)}L${pts[0][0].toFixed(1)} ${(H * s.base).toFixed(1)}Z`
    return `<g class="s-${s.k}"><path class="s-fill" d="${fill}"/><path class="s-line" d="${line}"/></g>`
  }).join('')
  const ticks = []; for (let v = 200; v <= top; v += 200) ticks.push(v)
  const front = slices[slices.length - 1]
  const yls = ticks.map(v => `<span class="ps-yl" style="top:${(Y(v, front.base) / H * 100).toFixed(2)}%">${v}</span>`).join('')
  const COL = { all: '#FFD700', now: '#FC4C02', prev: 'rgba(244,240,234,.6)' }
  const dots = slices.filter(s => s.k !== 'prev').flatMap(s => durs.filter(sec => s.m.has(sec)).map(sec =>
    `<i class="ps-dot" style="left:${(X(sec) / W * 100).toFixed(2)}%;top:${(Y(s.m.get(sec), s.base) / H * 100).toFixed(2)}%;background:${COL[s.k]}"></i>`)).join('')
  const labOf = sec => (PW.find(d => d.sec === sec) || {}).label || sec + 's'
  const hits = durs.map((sec, i) => {
    const x0 = i ? (X(durs[i - 1]) + X(sec)) / 2 : 0, x1 = i < durs.length - 1 ? (X(sec) + X(durs[i + 1])) / 2 : W
    return `<button type="button" data-ps="${sec}" style="position:absolute;top:0;bottom:0;left:${(x0 / W * 100).toFixed(2)}%;width:${((x1 - x0) / W * 100).toFixed(2)}%" aria-label="${labOf(sec)}"></button>`
  }).join('')
  const ax = durs.map(sec => `<span style="left:${(X(sec) / W * 100).toFixed(2)}%">${labOf(sec)}</span>`).join('')
  const idle = `三片切面共用同一把瓦數尺；<em>指到任何一個時長看三個數字。</em>`
  host.innerHTML = title('功率時間切面', 'POWER TIME SLICES · 全時 × 近半年 × 前半年') + `
    <div class="ps">
      <div class="ps-plot" id="ps-plot">
        <svg class="ps-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
          ${ticks.map(v => `<line class="s-grid" x1="0" x2="${W}" y1="${Y(v, front.base).toFixed(1)}" y2="${Y(v, front.base).toFixed(1)}"/>`).join('')}
          ${paths}
        </svg>
        ${yls}${dots}
        <i class="ps-col" id="ps-col"></i>
        <div class="ps-hit">${hits}</div>
      </div>
      <div class="ps-ax">${ax}</div>
      <div class="ps-leg">${slices.slice().reverse().map(s => `<span style="color:${COL[s.k]}"><i${s.k === 'prev' ? ' style="border-top-style:dashed"' : ''}></i>${s.zh}</span>`).join('')}</div>
      <div class="fxv-read" id="ps-read" data-idle="${esc(idle)}">${idle}</div>
      <p class="fxv-note">橫軸是對數時長（跟上面的功率曲線同一把尺）。三片切面由後到前：前半年、近半年、全時最佳 —— 每片的基線往後退一階，
        才看得出「同一個時長，三個時期的高度差」；瓦數尺是共用的，切面之間的高度差就是真的差。
        兩個半年視窗來自本機 FIT 逐秒功率重算（沒有錄製中斷的連續 N 秒），數字可能比 Strava 略低，那是口徑不同不是誤差。</p>
    </div>`
  const read = $('#ps-read', host), col = $('#ps-col', host)
  const show = sec => {
    if (!read) return
    if (sec == null) { read.innerHTML = read.dataset.idle; if (col) col.classList.remove('on'); return }
    const v = k => { const s = slices.find(x => x.k === k); return s && s.m.has(sec) ? s.m.get(sec) : null }
    const a = v('all'), n = v('now'), p = v('prev')
    const pct = (x, y) => (x != null && y != null && y > 0) ? ` <span style="color:${x >= y ? '#5FD060' : '#FFB020'};font-weight:700">${x >= y ? '+' : ''}${Math.round((x - y) / y * 100)}%</span>` : ''
    read.innerHTML = `${labOf(sec)} · 全時 <b>${a ?? '—'}</b><em>W</em> · 近半年 <b>${n ?? '—'}</b><em>W</em>${pct(n, p)} · 前半年 <b>${p ?? '—'}</b><em>W</em><br><em>近半年對全時最佳${n != null && a != null ? `：${Math.round(n / a * 100)}%` : '：—'}${n != null && p != null ? `　近半年比前半年 ${n - p >= 0 ? '+' : ''}${n - p} W` : ''}</em>`
    if (col) { col.style.left = (X(sec) / W * 100).toFixed(2) + '%'; col.classList.add('on') }
  }
  const plot = $('#ps-plot', host)
  on(plot, 'pointerover', e => { const b = e.target.closest('[data-ps]'); if (b) show(+b.dataset.ps) })
  on(plot, 'focusin', e => { const b = e.target.closest('[data-ps]'); if (b) show(+b.dataset.ps) })
  on(plot, 'pointerleave', () => show(null))
  on(plot, 'focusout', e => { if (!plot.contains(e.relatedTarget)) show(null) })
  host.__replay = () => {
    $$('.ps-svg g', host).forEach((gEl, i) => {
      drawPath($('.s-line', gEl), 1000, i * 260)
      fadeIn($('.s-fill', gEl), 600, 400 + i * 260)
    })
    $$('.ps-dot', host).forEach((d, i) => popIn(d, 900 + i * 40))
  }
  host.__replay()
  return true
})

/* ── 7d · Harvest Delay Field（Harvest · Growth Chamber）──────────────────
   回答：投入之後隔多久才收成？
   資料：收成頁已經算好的 window.__harvest —— 過線月份（months[].over）與每一項現存紀錄立下的月份（recs[].m）。
   每一項紀錄往回找最近的過線月（最多回看 3 個月），延遲幾個月就落進哪一格；前面 3 個月都沒過線的另列一格
   （多半是首登或探路，不是訓練換來的）。同時在上面那張圖疊一層弧線：從過線的那一格連到紀錄落下的那一格。 */
Viz.add('harvestdelay', (host, D) => {
  const H = D.harvest
  if (!H || !Array.isArray(H.recs) || !H.recs.length || !Array.isArray(H.months)) return false
  const mi = m => +m.slice(0, 4) * 12 + (+m.slice(5, 7))
  const over = H.months.filter(r => r.over).map(r => r.m)
  const idx = Object.fromEntries(H.keys.map((k, i) => [k, i]))
  const delayOf = rec => { let best = null; over.forEach(s => { const d = mi(rec.m) - mi(s); if (d >= 0 && d <= 3 && (best == null || d < best)) best = d }); return best }
  const B = { 0: [], 1: [], 2: [], 3: [], none: [] }
  const pairs = new Map()
  H.recs.forEach(r => {
    const d = delayOf(r)
    if (d == null) { B.none.push(r); return }
    B[d].push(r)
    if (d > 0) { const seed = over.filter(s => mi(r.m) - mi(s) === d)[0]; const k = seed + '>' + r.m; pairs.set(k, (pairs.get(k) || 0) + 1) }
  })
  const n = H.recs.length
  const max = Math.max(1, ...Object.values(B).map(a => a.length))
  const cols = [['0', '當月', '過線的同一個月'], ['1', '＋1 月', '過線的次月'], ['2', '＋2 月', ''], ['3', '＋3 月', ''], ['none', '無', '前 3 個月都沒過線']]
  const bars = cols.map(([k, zh, sub]) => `<div class="hd-b${k === 'none' ? ' is-none' : ''}"><b>${B[k].length}</b><i style="height:${(B[k].length / max * 100).toFixed(1)}%" title="${zh}：${B[k].length} 項"></i></div>`).join('')
  const axis = cols.map(([k, zh, sub]) => `<span>${zh}<em>${sub || '&nbsp;'}</em></span>`).join('')
  const inWin = B[0].length + B[1].length
  const lateN = B[2].length + B[3].length
  host.innerHTML = title('收成延遲', 'HARVEST DELAY · 從過線到紀錄落下隔幾個月') + `
    <div class="hd">
      <div class="hd-bars">${bars}</div>
      <div class="hd-ax">${axis}</div>
      <div class="fxv-read"><b>${n}</b> 項現存紀錄裡，<b>${inWin}</b> 項（${Math.round(inWin / n * 100)}%）落在過線的當月或次月，
        <b>${lateN}</b> 項隔了 2–3 個月，<b>${B.none.length}</b> 項前面三個月都沒過線<em>（首登或探路，不是訓練換來的）</em>。</div>
      <p class="fxv-note">上面那張圖裡的虛弧就是這些配對：起點是過線的那個月，落點是紀錄立下的那個月；弧線越粗＝那一對月份之間換到的紀錄越多。
        當月立下的不畫弧（同一格），沒過線的也不畫。損益線與過線的定義沿用收成頁（${g('HV_BREAKEVEN') || '—'} h／月）。</p>
    </div>`
  // ── 疊在收成圖上的弧線層 ──
  const body = $('#hv-body')
  const drawArcs = () => {
    if (!body) return
    // 收成 view 還是 display:none 的時候 offsetTop 全是 0（隱藏窗格量不到幾何）——
    // 那時候畫出來的弧會整個飛到圖外。沒尺寸就不畫，等進到這個 view 再（由 __replay）畫。
    if (!body.clientHeight) return
    $$('.hd-arcs', body).forEach(x => x.remove())
    const lanes = $$('.hv-lane', body)
    if (lanes.length < 4) return
    const plot4 = $('.hv-plot', lanes[3])
    if (!plot4) return
    // 拱橋全部住在收成 lane 裡：兩端都落在 lane 4 的上緣，拱頂只往上探 26px（不會跑出圖表壓到說明文字）
    const y0 = lanes[3].offsetTop + plot4.offsetTop + 6
    const hgt = Math.max(1, body.clientHeight - 26)
    const N = H.keys.length
    const cx = i => ((i + .5) / N * 100).toFixed(3)
    const paths = []
    pairs.forEach((cnt, k) => {
      const [s, m] = k.split('>'), i0 = idx[s], i1 = idx[m]
      if (i0 == null || i1 == null) return
      const xm = ((+cx(i0)) + (+cx(i1))) / 2, ym = y0 - 26 - Math.min(3, i1 - i0) * 4
      paths.push(`<path class="${i1 - i0 >= 3 ? 'is-far' : ''}" d="M${cx(i0)} ${y0}Q${xm.toFixed(3)} ${ym.toFixed(1)} ${cx(i1)} ${y0}" style="stroke-width:${Math.min(3, cnt)}px"/>`)
    })
    if (!paths.length) return
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('class', 'hd-arcs'); svg.setAttribute('viewBox', `0 0 100 ${hgt}`); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-hidden', 'true')
    svg.innerHTML = paths.join('')
    body.appendChild(svg)
  }
  drawArcs()
  let rt = 0
  on(win, 'resize', () => { clearTimeout(rt); rt = setTimeout(drawArcs, 180) }, { passive: true })
  host.__replay = () => {
    drawArcs()   // 進到 view 之後才量得到 lane 的位置
    $$('.hd-b i', host).forEach((b, i) => { const a = anim(b, [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], { duration: 600, delay: 1400 + i * 90, easing: 'cubic-bezier(.16,1,.3,1)' }); if (a) a.onfinish = () => { b.style.transform = '' } })
  }
  host.__replay()
  return true
})

/* ── 7e · Biometric Constellation（Body · Biosignal Lab）─────────────────
   回答：六條身體訊號今天各自落在自己平常的哪裡？彼此的形狀最近 14 天怎麼變？
   資料：wellness 的 HRV／靜息／睡眠時數／睡眠分數／eFTP ＋ _doms.json 的早上痠痛估計，各自對近 90 天的
   P10–P90 正規化（跟六圍卡一樣：軸與軸之間不可比，只有「相對自己」有意義）。
   14 天的辮子：一天一圈，缺值的那一段就斷開 —— 不補平。 */
Viz.add('constellation', (host, D) => {
  const ws = g('wellnessSeries')
  if (!ws || !D.wellness) return false
  const today = todayTPE()
  const M = [
    { k: 'hrv', zh: 'HRV', unit: 'ms', better: 'high', fmt: v => String(Math.round(v)) },
    { k: 'restingHR', zh: '靜息', unit: 'bpm', better: 'low', fmt: v => String(Math.round(v)) },
    { k: 'sleepSecs', zh: '睡眠', unit: '', better: 'high', fmt: hhmm },
    { k: 'sleepScore', zh: '睡眠分數', unit: '', better: 'high', fmt: v => String(Math.round(v)) },
    { k: 'eftp', zh: 'eFTP', unit: 'W', better: 'high', fmt: v => String(Math.round(v)) },
    { k: 'doms', zh: '痠痛', unit: '', better: 'low', fmt: v => String(Math.round(v)), src: 'doms' },
  ]
  const NDAYS = 90
  const dayList = ws('hrv', NDAYS).map(p => p[0])
  if (dayList.length < 14) return false
  const dd = (D.doms && D.doms.daily) || null
  const seriesOf = m => m.src === 'doms'
    ? dayList.map(d => [d, (dd && dd[d] && dd[d].am != null && d <= today) ? dd[d].am : null])
    : ws(m.k, NDAYS)
  const info = M.map(m => {
    const s = seriesOf(m)
    const vals = s.map(p => p[1]).filter(v => v != null).sort((a, b) => a - b)
    const q = f => vals.length ? vals[Math.max(0, Math.min(vals.length - 1, Math.round(f * (vals.length - 1))))] : null
    const p10 = q(.1), p50 = q(.5), p90 = q(.9)
    const latest = [...s].reverse().find(p => p[1] != null) || null
    const norm = v => (v == null || p10 == null || p90 == null || p90 === p10) ? null : clamp((v - p10) / (p90 - p10), 0, 1)
    const score = v => { const nv = norm(v); return nv == null ? null : (m.better === 'low' ? 1 - nv : nv) }
    const st = v => { const sc = score(v); return sc == null ? 'na' : sc >= .6 ? 'good' : sc >= .35 ? 'mid' : 'bad' }
    return { m, s, vals, p10, p50, p90, latest, norm, score, st, enough: vals.length >= 8 }
  })
  if (!info.some(x => x.latest)) return false
  const S = 340, C = S / 2, R0 = 28, R1 = 118
  const n = M.length
  const pol = (r, i) => { const th = (i / n) * Math.PI * 2 - Math.PI / 2; return [C + r * Math.cos(th), C + r * Math.sin(th)] }
  const rOf = (x, v) => { const nv = x.enough ? x.norm(v) : null; return nv == null ? null : R0 + (x.m.better === 'low' ? 1 - nv : nv) * (R1 - R0) }
  const rings = [.25, .5, .75, 1].map(f => `<path class="b-ring" d="${M.map((_, i) => pol(R0 + f * (R1 - R0), i)).map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('')}Z"/>`).join('')
  const spokes = M.map((_, i) => { const [x, y] = pol(R1, i); return `<line class="b-spoke" x1="${C}" y1="${C}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>` }).join('')
  const median = `<path class="b-band" d="${M.map((_, i) => pol(R0 + .5 * (R1 - R0), i)).map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('')}Z"/>`
  // 14 天辮子：每一天一條折線，缺值就斷
  const last14 = dayList.slice(-14)
  const polyFor = d => {
    const pts = info.map((x, i) => { const p = x.s.find(q => q[0] === d); const r = p ? rOf(x, p[1]) : null; return r == null ? null : pol(r, i) })
    let dstr = '', open = false
    pts.forEach((p, i) => { if (!p) { open = false; return } dstr += `${open ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`; open = true })
    if (pts[0] && pts[n - 1] && open) dstr += `L${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`
    return { d: dstr, count: pts.filter(Boolean).length }
  }
  const braid = last14.map((d, j) => { const p = polyFor(d); return p.count >= 2 ? `<path class="b-braid" data-d="${d}" d="${p.d}" style="opacity:${(.08 + j / 13 * .5).toFixed(2)}"/>` : '' }).join('')
  const focusDay = [...last14].reverse().find(d => polyFor(d).count >= 3) || null
  const todayPoly = focusDay ? polyFor(focusDay) : null
  const nodes = info.map((x, i) => {
    const v = x.latest ? x.latest[1] : null
    const r = v == null ? null : rOf(x, v)
    const [nx, ny] = pol(r == null ? R0 : r, i)
    const st = v == null ? 'na' : (x.enough ? x.st(v) : 'mid')
    const [lx, ly] = pol(R1 + 30, i)
    const anchor = Math.abs(lx - C) < 4 ? 'middle' : (lx > C ? 'start' : 'end')
    const dx = anchor === 'middle' ? 0 : (lx > C ? -4 : 4)
    return `<circle class="b-node is-${st}" cx="${nx.toFixed(1)}" cy="${ny.toFixed(1)}" r="${st === 'na' ? 4 : 4.5}"/>
      <text class="b-ax" x="${(lx + dx).toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="${anchor}">${x.m.zh}</text>
      <text class="b-axv${v == null ? ' is-na' : ''}" x="${(lx + dx).toFixed(1)}" y="${(ly + 17).toFixed(1)}" text-anchor="${anchor}">${v == null ? '無資料' : x.m.fmt(v) + (x.m.unit ? ' ' + x.m.unit : '')}</text>`
  }).join('')
  const stCls = st => st === 'good' ? 'is-good' : st === 'mid' ? 'is-mid' : st === 'bad' ? 'is-bad' : ''
  const rows = info.map(x => {
    const v = x.latest ? x.latest[1] : null, d = x.latest ? x.latest[0] : null
    const st = v == null ? 'na' : (x.enough ? x.st(v) : 'mid')
    const bandTxt = x.enough ? `P10–P90 ${x.m.fmt(x.p10)}–${x.m.fmt(x.p90)}` : `近 90 天只有 ${x.vals.length} 筆，不足以定基準`
    const stale = d && (Date.parse(today) - Date.parse(d)) / 86400e3 > 2
    return `<div class="bc-row ${stCls(st)}"><span class="k">${x.m.zh}</span><span class="v${v == null ? ' is-na' : ''}">${v == null ? '— 無資料' : x.m.fmt(v)}${v != null && x.m.unit ? `<small>${x.m.unit}</small>` : ''}</span><span class="s">${v == null ? '近 90 天沒有這個欄位' : `${md(d)}${stale ? '（不是今天的）' : ''} · ${bandTxt}`}</span></div>`
  }).join('')
  host.innerHTML = title('生命訊號星座', `BIOMETRIC CONSTELLATION · 近 90 天基準 · ${focusDay ? md(focusDay) + ' 的形狀' : '缺資料'}`) + `
    <div class="bc">
      <div class="bc-map"><svg viewBox="0 0 ${S} ${S}" role="img" aria-label="六條身體訊號相對自己近 90 天基準的位置">
        ${rings}${spokes}${median}${braid}
        ${todayPoly ? `<path class="b-today" d="${todayPoly.d}${todayPoly.count === n ? 'Z' : ''}"/>` : ''}
        ${nodes}
      </svg></div>
      <div class="bc-side"><div class="bc-rows">${rows}</div>
        <p class="fxv-note">越靠外圈＝相對自己近 90 天越「好」的那一端（HRV、睡眠、eFTP 高＝好；靜息、痠痛低＝好）。
          虛線環是各自的中位數。淡線是最近 14 天一天一圈的形狀，缺值的那一段就是斷的 —— 沒戴錶不等於數值持平。
          眼下亮的那一圈是最近一天有至少三條訊號的日子。</p></div>
    </div>`
  host.__replay = () => {
    const svg = $('svg', host)
    $$('.b-braid', svg).forEach((p, i) => { const to = p.style.opacity; const a = anim(p, [{ opacity: 0 }, { opacity: to }], { duration: 300, delay: i * 60 }); if (a) a.onfinish = () => { p.style.opacity = to } })
    const t = $('.b-today', svg); if (t) drawPath(t, 900, 800)
    $$('.b-node', svg).forEach((nd, i) => { const a = anim(nd, [{ r: 0 }, { r: nd.getAttribute('r') }], { duration: 400, delay: 1100 + i * 70, easing: 'cubic-bezier(.34,1.56,.64,1)' }); if (a) a.onfinish = () => {} })
  }
  host.__replay()
  return true
})

/* ══ Ghost Roads：全站底圖 ═══════════════════════════════════════════════
   星野退役。整頁底下鋪的是「他真的騎過的路」：data/ride-atlas.json 的路網（跟地圖艙室同一份、同一個 TM2 投影），
   極淡的線畫在固定的畫布上，騎越多趟的路越亮；十二個 ITT 地點是稍亮的節點。上面壓一層谷霧、兩層山脊剪影與暗角，
   色溫跟著 hero 的氣象走（fx:scene 用目標色，不是起點色）。OVERDRIVE：每隔幾秒一道光沿著某條常騎的路跑過去（一趟騎乘），
   捲頁時路網慢半拍的視差；ACTIVE：只有視差；QUIET：靜態一張。
   路網 1.2MB 只在桌機、主資料到了之後的閒置時段才抓；手機與 saveData 只鋪天光與山脊。fx 檔擋掉時原本的星野照舊。 */
const Field = {
  cv: null, ctx: null, W: 0, H: 0, DPR: 1, ok: false, running: false, job: null, loading: false, wantRoads: false, err: null, pend: 0,
  routes: null, places: null, fit: null, pool: null, idx: null, scroller: null, roads: null, roadsOld: null, fade: 1,
  P: null, Pold: null, streaks: [], nextStreak: 0, sy: 0, dirty: true, acc: 0, t: 0, BLEED: 360,
  comp: null, compP: null, parDrawn: null, marks: [],   // 合成層：光以外的全部；每幀只補光走過的小塊
  init() {
    if (this.ok) return
    const df = $('#deepfield'); if (!df) return
    this.cv = doc.createElement('canvas'); this.cv.id = 'bgfield'; this.cv.setAttribute('aria-hidden', 'true')
    df.parentNode.insertBefore(this.cv, df.nextSibling)
    this.ctx = this.cv.getContext('2d'); if (!this.ctx) { this.cv.remove(); return }
    this.ok = true
    root.dataset.bg = 'roads'
    this.P = SCENES.build
    this.wantRoads = !isMobile() && !(navigator.connection && navigator.connection.saveData)
    this.job = (dt, t) => this.step(dt, t)
    this.resize()
    let rt = 0
    on(win, 'resize', () => { clearTimeout(rt); rt = setTimeout(() => this.resize(), 180) })
    // 捲動視差：app shell 是 .main 在捲（不是 window）；兩邊都聽，哪個在動就讀哪個
    const m = $('.main'); this.scroller = (m && /(auto|scroll)/.test(getComputedStyle(m).overflowY)) ? m : null
    const onScroll = () => {
      this.sy = this.scroller ? this.scroller.scrollTop : (win.scrollY || 0)
      if (quiet() || !this.roads) return
      this.dirty = true
      if (!this.running && !this.pend) this.pend = requestAnimationFrame(() => { this.pend = 0; this.draw() })
    }
    on(win, 'scroll', onScroll, { passive: true }); if (this.scroller) on(this.scroller, 'scroll', onScroll, { passive: true })
    on(win, 'fx:scene', () => { const P = Atmo.to || Atmo.cur; if (P && P !== this.P) this.recolor(P) })
    this.sync()
  },
  resize() {
    if (!this.ok) return
    this.W = Math.max(1, win.innerWidth); this.H = Math.max(1, win.innerHeight)
    this.DPR = Math.min(win.devicePixelRatio || 1, (isMobile() || this.W > 1920) ? 1 : 1.5)   // 底圖是柔的，不需要 retina；2560 以上省記憶體
    this.cv.width = Math.round(this.W * this.DPR); this.cv.height = Math.round(this.H * this.DPR)
    this.ctx.setTransform(this.DPR, 0, 0, this.DPR, 0, 0)
    this.fit = null; this.pool = null; this.idx = null; this.roadsOld = null; this.Pold = null; this.fade = 1; this.comp = null; this.compP = null
    this.roads = this.routes ? this.paintRoads(this.P) : null
    this.dirty = true; this.draw(true)
  },
  mk(w, h) { const c = doc.createElement('canvas'); c.width = Math.round(w * this.DPR); c.height = Math.round(h * this.DPR); const x = c.getContext('2d'); x.setTransform(this.DPR, 0, 0, this.DPR, 0, 0); return [c, x] },
  load() {
    if (!this.ok || !this.wantRoads || this.routes || this.loading) return
    this.loading = true
    const go = () => fetch('data/ride-atlas.json').then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))).then(d => {
      if (!d || !Array.isArray(d.routes) || !d.routes.length) return
      this.routes = d.routes
      const tm = win.atTm   // 頁面自己的 TWD97/TM2（跟 build-ride-atlas.py 同一組公式）；沒有就不畫地點
      this.places = (typeof tm === 'function' && Array.isArray(d.places)) ? d.places.map(p => { const q = tm(p.lng, p.lat); return { x: q[0], y: q[1], n: p.n } }) : null
      this.fit = null; this.pool = null
      this.roads = this.paintRoads(this.P)
      this.dirty = true; this.sync(); this.draw()
      emit('roads', { polylines: this.routes.reduce((n, b) => n + b.length, 0) })
    }).catch(e => { this.err = String(e && e.message || e) }).then(() => { this.loading = false })
    const idle = win.requestIdleCallback ? f => win.requestIdleCallback(f, { timeout: 2500 }) : f => setTimeout(f, 1500)
    idle(go)
  },
  fitRoutes() {
    const R = this.routes, xs = [], ys = []
    const take = b => { for (const pl of R[b]) for (const p of pl) { xs.push(p[0]); ys.push(p[1]) } }
    for (let b = 2; b < R.length; b++) take(b)          // 4 趟以上的路決定視窗；偶爾騎一次的遠征被裁掉不心疼
    if (xs.length < 50) for (let b = 0; b < Math.min(2, R.length); b++) take(b)
    const q = (arr, t) => { const s = arr.slice().sort((a, b) => a - b); return s[Math.floor((s.length - 1) * t)] }
    const x0 = q(xs, .03), x1 = q(xs, .97), y0 = q(ys, .03), y1 = q(ys, .97)
    const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0), W = this.W, H = this.H + this.BLEED
    const s = Math.max(W / bw, H / bh) * 1.04            // cover：鋪滿視口＋下方留給視差的 BLEED
    this.fit = { s, ox: W / 2 - (x0 + x1) / 2 * s, oy: H / 2 + (y0 + y1) / 2 * s }   // TM2 的 y 朝北，畫布 y 朝下
  },
  px(p) { const f = this.fit; return [f.ox + p[0] * f.s, f.oy - p[1] * f.s] },
  paintRoads(P) {
    if (!this.fit) this.fitRoutes()
    const W = this.W, H = this.H + this.BLEED, [c, x] = this.mk(W, H), R = this.routes
    const STY = [[.04, .7], [.06, .8], [.09, 1], [.13, 1.2], [.19, 1.5], [.27, 1.9]]   // 1 / 2 / 4 / 8 / 16 / 32 趟以上
    x.lineCap = 'round'; x.lineJoin = 'round'
    const trace = pl => { let q = this.px(pl[0]); x.moveTo(q[0], q[1]); for (let i = 1; i < pl.length; i++) { q = this.px(pl[i]); x.lineTo(q[0], q[1]) } }
    x.beginPath(); for (let b = 4; b < R.length; b++) for (const pl of R[b]) trace(pl)
    x.strokeStyle = rgba(P.head, .04); x.lineWidth = 7; x.stroke()                    // 常騎的路先鋪一層寬的柔光
    for (let b = 0; b < R.length; b++) {
      const st = STY[Math.min(b, STY.length - 1)]
      x.beginPath(); for (const pl of R[b]) trace(pl)
      x.strokeStyle = rgba(b >= 3 ? P.head : P.fog2, st[0]); x.lineWidth = st[1]; x.stroke()
    }
    if (this.places) for (const p of this.places) {                                    // 十二個 ITT 地點：稍亮的節點＋光暈
      const q = this.px([p.x, p.y]), X = q[0], Y = q[1]
      const h = x.createRadialGradient(X, Y, 0, X, Y, 14); h.addColorStop(0, rgba(P.head, .22)); h.addColorStop(1, rgba(P.head, 0))
      x.fillStyle = h; x.fillRect(X - 14, Y - 14, 28, 28)
      x.fillStyle = 'rgba(255,255,255,.55)'; x.beginPath(); x.arc(X, Y, 1.6, 0, TAU); x.fill()
    }
    x.globalCompositeOperation = 'destination-out'                                     // 往下淡出，沉進山脊
    const fo = x.createLinearGradient(0, H * .58, 0, H); fo.addColorStop(0, 'rgba(0,0,0,0)'); fo.addColorStop(1, 'rgba(0,0,0,.9)')
    x.fillStyle = fo; x.fillRect(0, H * .58, W, H * .42)
    return c
  },
  buildIndex() {
    // 路網的端點索引：每條折線的兩端以 6px 網格當 key（25m 一格的路網在這個比例下一格約 3px），光到了路口才查能接哪一條
    const idx = new Map(), R = this.routes
    const key = (gx, gy) => gx + ',' + gy
    for (let b = 2; b < R.length; b++) for (let i = 0; i < R[b].length; i++) {
      const pl = R[b][i]; if (pl.length < 2) continue
      const a = this.px(pl[0]), z = this.px(pl[pl.length - 1])
      for (const [q, end] of [[a, 0], [z, 1]]) { const k = key((q[0] / 6) | 0, (q[1] / 6) | 0); let arr = idx.get(k); if (!arr) idx.set(k, arr = []); arr.push({ b, i, end }) }
    }
    this.idx = idx
  },
  near(q) {
    const gx = (q[0] / 6) | 0, gy = (q[1] / 6) | 0, out = []
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const arr = this.idx.get((gx + dx) + ',' + (gy + dy)); if (arr) for (const c of arr) out.push(c) }
    return out
  },
  spawnStreak() {
    if (!this.routes || !this.fit) return
    if (!this.idx) this.buildIndex()
    if (!this.pool) { this.pool = []; for (let b = 3; b < this.routes.length; b++) for (const pl of this.routes[b]) if (pl.length > 3) this.pool.push(pl) }   // 從 8 趟以上的路出發
    if (!this.pool.length) return
    const plen = a => { let L = 0; for (let i = 1; i < a.length; i++) L += Math.hypot(a[i][0] - a[i - 1][0], a[i][1] - a[i - 1][1]); return L }
    const seed = this.pool[Math.floor(Math.random() * this.pool.length)], used = new Set([seed])
    let pts = seed.map(p => this.px(p)); if (Math.random() < .5) pts.reverse()
    // 到了折線尾端就接下一條（同一個路口、沒走過、優先騎最多趟的那條），串到 700–1600px 像一趟騎乘
    const target = 700 + Math.random() * 900
    let L = plen(pts), hops = 0
    while (L < target && hops++ < 16) {
      const tail = pts[pts.length - 1]
      const cands = this.near(tail).filter(c => !used.has(this.routes[c.b][c.i]))
      if (!cands.length) break
      cands.sort((a, b) => b.b - a.b); const top = cands.filter(c => c.b === cands[0].b)
      const c = top[Math.floor(Math.random() * top.length)], pl = this.routes[c.b][c.i]; used.add(pl)
      const seg = pl.map(p => this.px(p)); if (c.end === 1) seg.reverse()   // 接上的是它的尾端就反著走
      pts = pts.concat(seg); L = plen(pts)
    }
    const cum = [0]; let acc = 0
    for (let i = 1; i < pts.length; i++) { acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); cum.push(acc) }
    if (acc < 60) return
    this.streaks.push({ pts, cum, L: acc, d: -10, v: 80 + Math.random() * 60, hops })
  },
  at(k, d) {
    const cum = k.cum, pts = k.pts
    if (d <= 0) return pts[0]
    if (d >= k.L) return pts[pts.length - 1]
    let lo = 0, hi = cum.length - 1
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= d) lo = m; else hi = m }
    const f = (d - cum[lo]) / Math.max(1e-6, cum[hi] - cum[lo])
    return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * f, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * f]
  },
  drawStreak(c, k, par, P) {
    const N = 10, seg = 11
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9
    const bb = q => { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1] }
    c.lineCap = 'round'
    let prev = this.at(k, k.d); bb(prev)
    for (let i = 1; i <= N; i++) {
      const d = k.d - i * seg; if (d < 0) break
      const p = this.at(k, d); bb(p)
      c.strokeStyle = rgba(P.head, (1 - i / N) * .75); c.lineWidth = 2.4 - i * .14
      c.beginPath(); c.moveTo(prev[0], prev[1] + par); c.lineTo(p[0], p[1] + par); c.stroke()
      prev = p
    }
    if (k.d <= k.L) {   // 光頭：一圈柔光＋白點
      const h = this.at(k, k.d), hx = h[0], hy = h[1] + par
      const gl = c.createRadialGradient(hx, hy, 0, hx, hy, 10); gl.addColorStop(0, rgba(P.head, .5)); gl.addColorStop(1, rgba(P.head, 0))
      c.fillStyle = gl; c.fillRect(hx - 10, hy - 10, 20, 20)
      c.fillStyle = 'rgba(255,255,255,.95)'; c.beginPath(); c.arc(hx, hy, 1.9, 0, TAU); c.fill()
    }
    // 回傳這道光碰到的方框（含視差位移），下一幀從合成層把這塊補回來
    const X0 = Math.max(0, Math.floor(x0 - 12)), Y0 = Math.max(0, Math.floor(y0 + par - 12))
    const X1 = Math.min(this.W, Math.ceil(x1 + 12)), Y1 = Math.min(this.H, Math.ceil(y1 + par + 12))
    return (X1 > X0 && Y1 > Y0) ? [X0, Y0, X1 - X0, Y1 - Y0] : null
  },
  start() { if (!this.ok || this.running) return; this.running = true; Ticker.add(this.job) },
  pause() { if (!this.running) return; this.running = false; Ticker.remove(this.job) },
  sync() {
    if (!this.ok) return
    const live = Mode.cur === 'overdrive' && (this.roads || this.fade < 1)
    if (live) { this.start(); return }
    this.pause(); this.streaks.length = 0; this.fade = 1; this.roadsOld = null; this.Pold = null; this.dirty = true; this.draw(true)
  },
  recolor(P) {
    const prev = this.P; this.P = P
    const nxt = this.routes ? this.paintRoads(P) : null
    if (Mode.cur === 'overdrive' && !doc.hidden) { this.Pold = prev; this.roadsOld = this.roads; this.fade = 0 } else { this.Pold = null; this.roadsOld = null; this.fade = 1 }
    this.roads = nxt; this.dirty = true; this.sync(); if (!this.running) this.draw()
  },
  step(dt) {
    this.t += dt; this.acc += dt
    if (this.fade < 1) {
      this.fade = Math.min(1, this.fade + dt / 1300); this.dirty = true
      if (this.fade >= 1) { this.roadsOld = null; this.Pold = null; if (!this.roads) { this.draw(); this.sync(); return } }
    }
    if (this.roads) {
      if (this.t > this.nextStreak && this.streaks.length < 2) { this.spawnStreak(); this.nextStreak = this.t + 2400 + Math.random() * 3200 }
      for (let i = this.streaks.length - 1; i >= 0; i--) { const k = this.streaks[i]; k.d += dt * k.v / 1000; if (k.d - 120 > k.L) this.streaks.splice(i, 1) }
      if (this.streaks.length) this.dirty = true
    }
    if (this.acc < 30 || !this.dirty) return   // 30fps 上限；沒東西動就不重畫
    this.acc = 0; this.dirty = false; this.draw()
  },
  par() { return this.roads ? -clamp(this.sy * .12, 0, this.BLEED) : 0 },
  draw(full) {
    if (!this.ok) return
    const c = this.ctx, W = this.W, H = this.H, DPR = this.DPR
    const P = (this.Pold && this.fade < 1) ? mixP(this.Pold, this.P, this.fade) : this.P
    const par = this.par()
    // 合成層（光以外的全部）只在尺寸、色溫、視差變了才重畫；其餘每幀只把上一幀的光從合成層補掉
    if (full || !this.comp || P !== this.compP || par !== this.parDrawn) {
      this.paintComposite(P, par); this.compP = P; this.parDrawn = par
      c.drawImage(this.comp, 0, 0, W, H)
    } else for (const m of this.marks) c.drawImage(this.comp, m[0] * DPR, m[1] * DPR, m[2] * DPR, m[3] * DPR, m[0], m[1], m[2], m[3])
    this.marks.length = 0
    for (const k of this.streaks) { const r = this.drawStreak(c, k, par, P); if (r) this.marks.push(r) }
  },
  paintComposite(P, par) {
    const W = this.W, H = this.H
    if (!this.comp) { const [cv, x] = this.mk(W, H); this.comp = cv; this.compCtx = x }
    const c = this.compCtx
    c.globalAlpha = 1
    // 天光：頂端是氣象的天空色，往下沉進近黑
    const g = c.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, rgba(mixc(P.bg, [6, 4, 12], .3), 1)); g.addColorStop(.55, rgba(mixc(P.bg, [6, 4, 12], .72), 1)); g.addColorStop(1, 'rgb(5,3,8)')
    c.fillStyle = g; c.fillRect(0, 0, W, H)
    // 晨光：左上一抹暖暈（跟 hero 的太陽同一側）
    const gl = c.createRadialGradient(W * .16, -H * .12, 0, W * .16, -H * .12, Math.max(W, H) * .75)
    gl.addColorStop(0, rgba(P.fog2, .15)); gl.addColorStop(.45, rgba(P.fog2, .04)); gl.addColorStop(1, rgba(P.fog2, 0))
    c.fillStyle = gl; c.fillRect(0, 0, W, H)
    // 高空薄霧帶：一道斜向的靛紫
    c.save(); c.translate(W * .55, H * .36); c.rotate(-.42)
    const hb = c.createLinearGradient(0, -H * .24, 0, H * .24)
    hb.addColorStop(0, rgba(P.haze, 0)); hb.addColorStop(.5, rgba(P.haze, .075)); hb.addColorStop(1, rgba(P.haze, 0))
    c.fillStyle = hb; c.fillRect(-W * 1.2, -H * .24, W * 2.4, H * .48); c.restore()
    // 路網（捲頁時慢半拍；換氣象時新舊交叉淡入）
    const xf = !!(this.roadsOld && this.fade < 1)
    if (xf) { c.globalAlpha = 1 - this.fade; c.drawImage(this.roadsOld, 0, par, W, H + this.BLEED) }
    if (this.roads) { c.globalAlpha = xf ? this.fade : 1; c.drawImage(this.roads, 0, par, W, H + this.BLEED) }
    c.globalAlpha = 1
    // 谷霧：下方一條橫向的霧帶，壓在路網上
    const fg = c.createLinearGradient(0, H * .6, 0, H)
    fg.addColorStop(0, rgba(P.fog, 0)); fg.addColorStop(.6, rgba(P.fog, .09)); fg.addColorStop(1, rgba(P.fog, .15))
    c.fillStyle = fg; c.fillRect(0, H * .6, W, H * .4)
    // 兩層山脊剪影（跟 hero 同一族的 1-|sin| 山形）
    this.ridge(c, 0, H * .055, H * .12, rgba(mixc(P.bg, [4, 2, 6], .82), .97), rgba(P.head, .11))
    this.ridge(c, 2, H * .005, H * .075, 'rgb(4,2,6)', rgba(P.head, .06))
    // 暗角：保住讀數對比
    const vg = c.createRadialGradient(W * .5, H * .42, Math.min(W, H) * .38, W * .5, H * .42, Math.max(W, H) * .8)
    vg.addColorStop(0, 'rgba(2,1,4,0)'); vg.addColorStop(1, 'rgba(2,1,4,.62)')
    c.fillStyle = vg; c.fillRect(0, 0, W, H)
  },
  ridge(c, k, lift, amp, fill, edge) {
    const W = this.W, H = this.H, pts = []
    for (let x = 0; x <= W + 4; x += 4) {
      const u = x / W
      const h = (1 - Math.abs(Math.sin(u * 5.3 + k * 1.7))) * .55 + (1 - Math.abs(Math.sin(u * 13.1 + k * 3.1))) * .3 + (1 - Math.abs(Math.sin(u * 31 + k))) * .15
      pts.push([x, H - lift - h * amp])
    }
    c.beginPath(); c.moveTo(0, H + 2); for (const p of pts) c.lineTo(p[0], p[1]); c.lineTo(W + 4, H + 2); c.closePath(); c.fillStyle = fill; c.fill()
    c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]); c.strokeStyle = edge; c.lineWidth = 1; c.stroke()
  },
}
const mixP = (A, B, t) => { const o = {}; for (const k of ['bg', 'fog', 'fog2', 'haze', 'head']) o[k] = (A[k] && B[k]) ? mixc(A[k], B[k], t) : (B[k] || A[k]); return o }

/* ══ Bootstrap ══════════════════════════════════════════════════════════ */
function onData(D) {
  if (!D) return
  safe('events:detect', () => Events.detect(D))
  safe('viz:render', () => Viz.renderAll(D))
  safe('atmo:data', () => {
    Atmo.init()   // hero 在 render() 之後才存在
    Atmo.inputs = (D.atmosphere && D.atmosphere.inputs) || {}
    Atmo.setScene((D.atmosphere && D.atmosphere.scene) || 'nosignal', { sim: false })
    SceneLab.mount(D.atmosphere)
  })
  safe('touchlock', () => Interact.touchLock())
  safe('sidescene', () => SideScene.init())
  safe('field:load', () => Field.load())   // 主資料到了才去抓路網（閒置時段）
  Mode.apply()
  const v = curView(), el = $(`#content .view[data-view="${v}"]`)
  requestAnimationFrame(() => {
    Sig.run(v, el)
    if (v === 'itt') Terrain.arm()
    if (v === 'atlas') Flight.arm()
    Events.onView(v)
    // readiness 剛掛好 → 向 hero 送一圈能量波（指標卡與畫布互相呼應）
    setTimeout(() => Atmo.waveFrom($('.hero .board-num') || $('.atm-scene')), 900)
  })
}
safe('field:init', () => Field.init())
safe('rider:image', () => Rider.loadImage())   // <html data-rider-img> 有宣告才用照片版騎士   // 底圖最先掛，星野從第一幀就不畫
safe('mode:mount', () => Mode.mount())
safe('interact:init', () => Interact.init())
safe('orch:init', () => Orch.init())
safe('events:load', () => Events.load())
Mode.apply()
if (win.__fxData) onData(win.__fxData)
else on(win, 'strava:data-ready', e => onData(e.detail), { once: true })
on(win, 'strava:data-error', () => { safe('atmo:destroy', () => Atmo.destroy()); safe('field:load', () => Field.load()) })
// 除錯／自動化測試的把手（不是 API）
win.__fx = { Mode, Atmo, Rider, SideScene, Field, Ticker, Viz, Events, Burst, SceneLab, version: '2026-09-02e' }
})()
