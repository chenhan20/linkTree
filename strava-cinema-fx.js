/* ═══════════════════════════════════════════════════════════════════════
   strava-cinema-fx.js · TAIWAN RIDE CINEMA 場景引擎

   純加法：只畫在 #cn-canvas（全螢幕、UI 底下）與 #td-canvas（TODAY hero 影片上方）。
   拔掉這支檔，九個模組的資料、導覽與互動照常 —— 背景不承擔唯一資訊。

   分層（由遠到近）：環境畫師的分層點陣（天空雲層 → 遠山 → 霧 → 中景 → 近景 → 芒草）
   → 真實海拔稜線 → 霧 → GPS 光軌 → 雨／光塵／散景 → 底片顆粒 → 閱讀場（CSS）。
   每一層各自的視差速率，指標與捲動帶動；芒草層以底部為軸受風傾斜。

   環境畫師（ENV）：不是向量插畫，是用雜訊生成、一次畫進離屏 canvas 的點陣素材：
   陽明山清晨（TODAY）、河濱黃昏（計畫）、山路藍調（攻略）、北海岸（活動紀錄）、
   山與霧（ITT，真實剖面的稜線由引擎疊上去）、台北盆地夜景（趨勢／地圖）、
   稻田晨光（收成）、森林霧氣（身體）、陽明山夜（ALL）。有 CC0 照片可用時
   （ENV.photos[scene]）照片會插進最底層當寫實底，其餘層照畫。

   資料控制的只有光線、霧、雨與光軌：
   · TODAY：今日結論（照表／保守／恢復）決定霧的濃度與有沒有雨；光軌＝近 7 天真實騎乘
   · TRAIN 計畫：路上的反光標＝主課表，亮的是做完的
   · TRAIN 攻略：選中那條坡的真實海拔剖面當稜線
   · RIDE 紀錄：最近騎乘的真實 GPS 光軌
   · RIDE ITT：選中路線的真實 GPS＋海拔
   · REVIEW 收成：過線月份越多，田裡升起的光塵越多
   · REVIEW 身體：霧像呼吸一樣起伏，幅度跟 HRV 相對基準帶

   三檔：OVERDRIVE（全部）／ACTIVE（粒子減半、30fps）／QUIET（只畫一張依狀態生成的靜態終態）。
   prefers-reduced-motion 一律 QUIET。分頁隱藏就停。
   ═══════════════════════════════════════════════════════════════════════ */
;(function () {
  'use strict'
  const main = document.getElementById('cn-canvas')
  if (!main || !main.getContext) return

  const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)')
  const mobileMQ = matchMedia('(max-width: 767px)')
  const TIERS = ['overdrive', 'active', 'quiet']
  const TIER_ZH = { overdrive: 'OVERDRIVE', active: 'ACTIVE', quiet: 'QUIET' }
  const LS = 'cinema-fx-tier'
  const autoTier = () => {
    if (reduceMQ.matches) return 'quiet'
    const c = navigator.connection || {}
    if (c.saveData) return 'quiet'
    if (mobileMQ.matches || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4)) return 'active'
    return 'overdrive'
  }
  let userTier = null
  try { const t = localStorage.getItem(LS); if (TIERS.includes(t)) userTier = t } catch (e) {}
  const tierNow = () => reduceMQ.matches ? 'quiet' : (userTier || autoTier())

  /* ══ 環境畫師 ═══════════════════════════════════════════════════════════ */
  const ENV = (function () {
    const rng = seed => { let a = seed | 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
    const smooth = t => t * t * (3 - 2 * t)
    const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v
    function noise1(seed) {
      const r = rng(seed), N = 1024, v = new Float32Array(N)
      for (let i = 0; i < N; i++) v[i] = r()
      return x => { const i = Math.floor(x), f = x - i, a = v[(i % N + N) % N], b = v[((i + 1) % N + N) % N]; return a + (b - a) * smooth(f) }
    }
    const fbm1 = (n, x, oct) => { let s = 0, a = .5, f = 1, norm = 0; for (let o = 0; o < (oct || 4); o++) { s += n(x * f) * a; norm += a; a *= .5; f *= 2 } return s / norm }
    function noise2(seed) {
      const r = rng(seed), N = 64, v = new Float32Array(N * N)
      for (let i = 0; i < N * N; i++) v[i] = r()
      const g = (a, b) => v[((b % N + N) % N) * N + ((a % N + N) % N)]
      return (x, y) => {
        const xi = Math.floor(x), yi = Math.floor(y), fx = smooth(x - xi), fy = smooth(y - yi)
        const top = g(xi, yi) + (g(xi + 1, yi) - g(xi, yi)) * fx, bot = g(xi, yi + 1) + (g(xi + 1, yi + 1) - g(xi, yi + 1)) * fx
        return top + (bot - top) * fy
      }
    }
    const fbm2 = (n, x, y, oct) => { let s = 0, a = .5, f = 1, norm = 0; for (let o = 0; o < (oct || 4); o++) { s += n(x * f, y * f) * a; norm += a; a *= .5; f *= 2 } return s / norm }
    const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c }

    // 雲／霧紋理：小圖算 fbm，放大時自然變軟
    function cloudTex(seed, tw, th, o) {
      const c = mk(tw, th), x = c.getContext('2d'), img = x.createImageData(tw, th), d = img.data, n = noise2(seed)
      const [r, g, b] = o.tint
      for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) {
        const v = fbm2(n, i / tw * o.scale, j / th * o.scale * (th / tw), o.oct || 4)
        const a = clamp01((v - o.lo) / (o.hi - o.lo))
        const k = (j * tw + i) * 4; d[k] = r; d[k + 1] = g; d[k + 2] = b; d[k + 3] = Math.round(a * a * 255 * o.alpha)
      }
      x.putImageData(img, 0, 0); return c
    }
    let grainTile = null
    function grain() {
      if (grainTile) return grainTile
      const t = mk(160, 160), x = t.getContext('2d'), img = x.createImageData(160, 160), d = img.data, r = rng(7)
      for (let i = 0; i < d.length; i += 4) { const v = 128 + (r() - .5) * 96; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255 }
      x.putImageData(img, 0, 0); grainTile = t; return t
    }

    /* ── 圖層畫法 ── */
    function sky(W, H, o) {
      const c = mk(W, H), x = c.getContext('2d')
      const g = x.createLinearGradient(0, 0, 0, H); o.stops.forEach(s => g.addColorStop(s[0], s[1])); x.fillStyle = g; x.fillRect(0, 0, W, H)
      if (o.glow) { const gg = x.createRadialGradient(o.glow.x * W, o.glow.y * H, 0, o.glow.x * W, o.glow.y * H, o.glow.r * W); gg.addColorStop(0, o.glow.col); gg.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = gg; x.fillRect(0, 0, W, H) }
      ;(o.clouds || []).forEach((cl, i) => { const t = cloudTex((o.seed || 1) + i * 13, 320, 160, cl); x.drawImage(t, 0, H * cl.y0, W, H * (cl.y1 - cl.y0)) })
      return c
    }
    function ridge(W, H, o) {
      const c = mk(W, H), x = c.getContext('2d'), n = noise1(o.seed), n2 = noise1(o.seed + 99)
      const xEnd = o.xEnd != null ? W * o.xEnd : W + 10, floor = o.floor != null ? H * o.floor : H + 10
      const ampAt = i => o.xEnd != null ? o.amp * smooth(clamp01((xEnd - i) / (W * .3))) : o.amp
      const y = i => H * o.base - fbm1(n, i / W * o.freq, 5) * H * ampAt(i) - (fbm1(n2, i / W * o.freq * 6, 3) - .5) * H * ampAt(i) * .14
      x.beginPath(); x.moveTo(-10, floor)
      for (let i = -10; i <= xEnd; i += 2) x.lineTo(i, y(i))
      x.lineTo(xEnd, floor); x.closePath()
      const g = x.createLinearGradient(0, H * (o.base - o.amp), 0, floor); g.addColorStop(0, o.top); g.addColorStop(1, o.bot); x.fillStyle = g; x.fill()
      if (o.trees) {
        x.strokeStyle = o.trees; x.lineWidth = 1.2
        const r = rng(o.seed + 5)
        for (let i = 0; i <= xEnd; i += 3) { const yy = y(i), h = 2 + r() * (o.treeH || 9); x.beginPath(); x.moveTo(i, yy + 1); x.lineTo(i + (r() - .5) * 2, yy - h); x.stroke() }
      }
      return c
    }
    function mist(W, H, o) {
      const c = mk(W, H), x = c.getContext('2d')
      const g = x.createLinearGradient(0, H * (o.y - o.h), 0, H * (o.y + o.h))
      g.addColorStop(0, `rgba(${o.col},0)`); g.addColorStop(.5, `rgba(${o.col},${o.a})`); g.addColorStop(1, `rgba(${o.col},0)`)
      x.fillStyle = g; x.fillRect(0, 0, W, H)
      if (o.tex) { const t = cloudTex(o.seed || 3, 320, 120, { tint: o.col.split(',').map(Number), scale: 3, lo: .38, hi: .8, alpha: o.a * 1.3 }); x.drawImage(t, 0, H * (o.y - o.h * 1.4), W, H * o.h * 2.8) }
      return c
    }
    function grass(W, H, o) {
      const c = mk(W, H), x = c.getContext('2d'), r = rng(o.seed)
      x.lineCap = 'round'
      if (o.ground) { const g = x.createLinearGradient(0, H * (o.y0 - .03), 0, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(.3, o.ground); g.addColorStop(1, o.ground); x.fillStyle = g; x.fillRect(0, H * (o.y0 - .03), W, H) }
      for (let k = 0; k < o.count; k++) {
        const bx = r() * W, by = H * (o.y0 + r() * o.yr), h = H * (o.hMin + r() * (o.hMax - o.hMin)), lean = (r() - .3) * .6
        const tipx = bx + lean * h, tipy = by - h
        x.strokeStyle = r() < .5 ? o.stem2 : o.stem; x.lineWidth = .8 + r() * 1.2
        x.beginPath(); x.moveTo(bx, by); x.quadraticCurveTo(bx + lean * h * .25, by - h * .6, tipx, tipy); x.stroke()
        if (o.plume) {
          x.strokeStyle = o.plume; x.lineWidth = 1
          const pn = 4 + Math.floor(r() * 4)
          for (let p = 0; p < pn; p++) { const a = -Math.PI / 2 + lean * .8 + (r() - .5) * 1.1, L = h * (.08 + r() * .1); x.globalAlpha = .45 + r() * .5; x.beginPath(); x.moveTo(tipx, tipy + p * 2); x.lineTo(tipx + Math.cos(a) * L, tipy + p * 2 + Math.sin(a) * L); x.stroke() }
          x.globalAlpha = 1
        }
      }
      return c
    }
    function sea(W, H, o) {
      const c = mk(W, H), x = c.getContext('2d'), r = rng(o.seed), n = noise1(o.seed)
      const hy = H * o.horizon
      const g = x.createLinearGradient(0, hy, 0, H); g.addColorStop(0, o.far); g.addColorStop(.5, o.mid); g.addColorStop(1, o.near); x.fillStyle = g; x.fillRect(0, hy, W, H - hy)
      const hl = x.createLinearGradient(0, hy - 2, 0, hy + 7); hl.addColorStop(0, `rgba(${o.glow},0)`); hl.addColorStop(.4, `rgba(${o.glow},.75)`); hl.addColorStop(1, `rgba(${o.glow},0)`); x.fillStyle = hl; x.fillRect(0, hy - 2, W, 9)
      x.lineCap = 'round'
      for (let k = 0; k < 90; k++) {
        const t = Math.pow(k / 90, 1.6), yy = hy + 6 + t * (H - hy - 10), seg = 6 + Math.floor(r() * 5)
        for (let s = 0; s < seg; s++) {
          const x0 = r() * W, L = (20 + r() * 120) * (.4 + t), a = (.06 + t * .25) * (.5 + fbm1(n, x0 / 200 + k, 3))
          x.strokeStyle = `rgba(${o.wave},${a.toFixed(3)})`; x.lineWidth = .6 + t * 1.8
          x.beginPath(); x.moveTo(x0, yy + (r() - .5) * 2); x.lineTo(x0 + L, yy + (r() - .5) * 2); x.stroke()
        }
      }
      for (let k = 0; k < 26; k++) {
        const bx = r() * W, by = H * (.86 + r() * .12), rw = 30 + r() * 120, rh = 4 + r() * 8
        const fg = x.createRadialGradient(bx, by, 0, bx, by, rw); fg.addColorStop(0, `rgba(${o.foam},${.18 + r() * .2})`); fg.addColorStop(1, `rgba(${o.foam},0)`)
        x.save(); x.translate(bx, by); x.scale(1, rh / rw); x.translate(-bx, -by); x.fillStyle = fg; x.fillRect(bx - rw, by - rw, rw * 2, rw * 2); x.restore()
      }
      return c
    }
    function city(W, H, o) {
      const c = mk(W, H), x = c.getContext('2d'), r = rng(o.seed)
      const hy = H * o.horizon
      const lg = x.createLinearGradient(0, hy - H * .16, 0, hy + 4); lg.addColorStop(0, `rgba(${o.haze},0)`); lg.addColorStop(1, `rgba(${o.haze},${o.hazeA})`); x.fillStyle = lg; x.fillRect(0, hy - H * .16, W, H * .16 + 4)
      let bx = -20
      while (bx < W + 20) { const bw = 14 + r() * 46, bh = 6 + Math.pow(r(), 2.2) * H * (o.tall || .12); x.fillStyle = o.block; x.fillRect(bx, hy - bh, bw, bh + 40); bx += bw + r() * 6 }
      if (o.tower) {
        const tx = W * o.tower, tw = 22, th = H * .3
        x.fillStyle = o.block; x.beginPath(); x.moveTo(tx - tw, hy + 30); x.lineTo(tx - tw * .45, hy - th); x.lineTo(tx - tw * .18, hy - th * 1.16); x.lineTo(tx, hy - th * 1.28); x.lineTo(tx + tw * .18, hy - th * 1.16); x.lineTo(tx + tw * .45, hy - th); x.lineTo(tx + tw, hy + 30); x.closePath(); x.fill()
        for (let k = 1; k < 8; k++) { const yy = hy - th * (k / 8); x.fillStyle = `rgba(${o.tint[0]},${.35 + r() * .3})`; x.fillRect(tx - tw * .4 * (1 - k / 14), yy, tw * .8 * (1 - k / 14), 1.2) }
      }
      for (let k = 0; k < o.count; k++) {
        const t = Math.pow(r(), 2.6), yy = hy + t * (H - hy) * o.depth - 2 + (r() - .5) * 6, xx = r() * W
        const col = o.tint[Math.floor(r() * o.tint.length)], sz = .6 + t * 2.2 + r() * .6, a = .35 + r() * .6
        x.fillStyle = `rgba(${col},${a})`; x.beginPath(); x.arc(xx, yy, sz, 0, 6.283); x.fill()
        if (r() < .06) { const gg = x.createRadialGradient(xx, yy, 0, xx, yy, sz * 8); gg.addColorStop(0, `rgba(${col},.35)`); gg.addColorStop(1, `rgba(${col},0)`); x.fillStyle = gg; x.fillRect(xx - sz * 8, yy - sz * 8, sz * 16, sz * 16) }
      }
      return c
    }
    function water(W, H, o) {
      const c = mk(W, H), x = c.getContext('2d'), hy = H * o.horizon
      const g = x.createLinearGradient(0, hy, 0, H); g.addColorStop(0, o.far); g.addColorStop(1, o.near); x.fillStyle = g; x.fillRect(0, hy, W, H - hy)
      if (o.src) {
        x.save(); x.beginPath(); x.rect(0, hy, W, H - hy); x.clip()
        const srcH = hy - H * o.srcTop
        for (let k = 0; k < 4; k++) { x.globalAlpha = o.alpha / (1 + k); x.drawImage(o.src, 0, H * o.srcTop, W, srcH, (k - 1.5) * 3, hy + srcH * o.stretch, W, -srcH * o.stretch) }
        x.restore()
      }
      const r = rng(o.seed || 11); x.globalAlpha = 1
      for (let k = 0; k < 60; k++) { const t = Math.pow(k / 60, 1.5), yy = hy + t * (H - hy); x.strokeStyle = `rgba(${o.ripple},${(.03 + t * .1).toFixed(3)})`; x.lineWidth = .8 + t; const x0 = r() * W; x.beginPath(); x.moveTo(x0, yy); x.lineTo(x0 + 40 + r() * 200, yy); x.stroke() }
      return c
    }
    function bridge(W, H, o) {
      const c = mk(W, H), x = c.getContext('2d'), y = H * o.y, x0 = W * o.x0, x1 = W * o.x1
      x.fillStyle = o.col; x.fillRect(x0, y - 3, x1 - x0, 5)
      for (let px = x0; px < x1; px += (x1 - x0) / o.piers) x.fillRect(px - 3, y, 6, H * .05)
      if (o.arch) { x.strokeStyle = o.col; x.lineWidth = 3; x.beginPath(); x.moveTo(x0, y); x.quadraticCurveTo((x0 + x1) / 2, y - H * .1, x1, y); x.stroke() }
      for (let px = x0 + 8; px < x1; px += 22) { const g = x.createRadialGradient(px, y - 5, 0, px, y - 5, 7); g.addColorStop(0, `rgba(${o.lamp},.8)`); g.addColorStop(1, `rgba(${o.lamp},0)`); x.fillStyle = g; x.fillRect(px - 7, y - 12, 14, 14) }
      return c
    }
    function lamps(W, H, o) {
      const c = mk(W, H), x = c.getContext('2d')
      for (let k = 0; k < o.n; k++) {
        const px = W * (o.x0 + k * o.dx), py = H * o.y
        x.fillStyle = o.post; x.fillRect(px - 1.5, py - 42, 3, 42)
        const g = x.createRadialGradient(px, py - 44, 0, px, py - 44, 26); g.addColorStop(0, `rgba(${o.col},.85)`); g.addColorStop(.3, `rgba(${o.col},.25)`); g.addColorStop(1, `rgba(${o.col},0)`); x.fillStyle = g; x.fillRect(px - 26, py - 70, 52, 52)
      }
      return c
    }
    function road(W, H, o) {
      const c = mk(W, H), x = c.getContext('2d')
      const pts = o.pts.map(p => [p[0] * W, p[1] * H])
      const along = t => {
        const n = pts.length - 1, i = Math.min(n - 1, Math.floor(t * n)), f = t * n - i
        const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)]
        const cr = (a, b, c2, d, u) => .5 * ((2 * b) + (-a + c2) * u + (2 * a - 5 * b + 4 * c2 - d) * u * u + (-a + 3 * b - 3 * c2 + d) * u * u * u)
        return [cr(p0[0], p1[0], p2[0], p3[0], f), cr(p0[1], p1[1], p2[1], p3[1], f)]
      }
      const N = 160, L = [], R = []
      for (let k = 0; k <= N; k++) {
        const t = k / N, [px, py] = along(t), [qx, qy] = along(Math.min(1, t + .01))
        const dx = qx - px, dy = qy - py, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len, w = o.w0 * H * (1 - t) + o.w1 * H * t
        L.push([px + nx * w, py + ny * w]); R.push([px - nx * w, py - ny * w])
      }
      x.beginPath(); L.forEach((p, i) => i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])); R.slice().reverse().forEach(p => x.lineTo(p[0], p[1])); x.closePath()
      const g = x.createLinearGradient(0, H * o.pts[o.pts.length - 1][1], 0, H); g.addColorStop(0, o.far); g.addColorStop(1, o.near); x.fillStyle = g; x.fill()
      x.strokeStyle = o.edge; x.lineWidth = 1.5; x.stroke()
      x.setLineDash([10, 14]); x.strokeStyle = o.dash; x.lineWidth = 1; x.beginPath()
      for (let k = 0; k <= N; k++) { const [px, py] = along(k / N); k ? x.lineTo(px, py) : x.moveTo(px, py) }
      x.stroke(); x.setLineDash([])
      for (let k = 4; k < N; k += 5) {
        const p = R[k], t = k / N, ph = 8 * (1 - t * .6)
        x.fillStyle = o.post; x.fillRect(p[0] - 1, p[1] - ph, 2, ph)
        if (k % 10 === 4) { const gg = x.createRadialGradient(p[0], p[1] - ph * .7, 0, p[0], p[1] - ph * .7, 5); gg.addColorStop(0, 'rgba(255,179,71,.9)'); gg.addColorStop(1, 'rgba(255,179,71,0)'); x.fillStyle = gg; x.fillRect(p[0] - 5, p[1] - ph * .7 - 5, 10, 10) }
      }
      return c
    }
    function paddy(W, H, o) {
      const c = mk(W, H), x = c.getContext('2d'), r = rng(o.seed), n = noise1(o.seed), hy = H * o.horizon, rows = 14
      for (let k = 0; k < rows; k++) {
        const t0 = Math.pow(k / rows, 1.7), t1 = Math.pow((k + 1) / rows, 1.7), y0 = hy + t0 * (H - hy), y1 = hy + t1 * (H - hy)
        const g = x.createLinearGradient(0, y0, 0, y1), v = .85 + fbm1(n, k * 1.7, 2) * .3
        g.addColorStop(0, o.mix(t0, v)); g.addColorStop(1, o.mix(t1, v)); x.fillStyle = g; x.fillRect(0, y0, W, y1 - y0 + 1)
        x.fillStyle = o.dike; x.fillRect(0, y1 - (.6 + t1 * 2), W, .8 + t1 * 2.4)
        if (t0 > .15) {
          x.strokeStyle = o.stalk; x.lineWidth = .7
          const cnt = Math.floor(W / (3 + (1 - t0) * 6))
          for (let s = 0; s < cnt; s++) { const sx = r() * W, sh = (y1 - y0) * (.25 + r() * .35); x.globalAlpha = .12 + t0 * .35; x.beginPath(); x.moveTo(sx, y1 - 1); x.lineTo(sx + (r() - .5) * 2, y1 - 1 - sh); x.stroke() }
          x.globalAlpha = 1
        }
      }
      const vx = W * .55
      for (let k = -3; k <= 3; k++) { x.strokeStyle = o.dike; x.lineWidth = 1.6; x.beginPath(); x.moveTo(vx + k * W * .06, hy + 2); x.lineTo(vx + k * W * .42, H + 10); x.stroke() }
      return c
    }
    function forest(W, H, o) {
      const c = mk(W, H), x = c.getContext('2d'), r = rng(o.seed)
      for (let k = 0; k < o.count; k++) {
        const bx = r() * W, w = o.wMin + r() * (o.wMax - o.wMin), lean = (r() - .5) * .08, top = H * (o.top + r() * .1)
        x.fillStyle = o.col
        x.beginPath(); x.moveTo(bx - w, H + 5); x.lineTo(bx + w, H + 5); x.lineTo(bx + w * .55 + lean * H, top); x.lineTo(bx - w * .55 + lean * H, top); x.closePath(); x.fill()
        for (let b = 0; b < 3; b++) { const by = top + r() * H * .3, L = w * (3 + r() * 5), a = (r() - .5) * .9; x.strokeStyle = o.col; x.lineWidth = w * .3; x.beginPath(); x.moveTo(bx + lean * (H - by), by); x.lineTo(bx + lean * (H - by) + Math.cos(a) * L * (r() < .5 ? -1 : 1), by - Math.abs(Math.sin(a)) * L); x.stroke() }
      }
      if (o.canopy) { const t = cloudTex(o.seed + 3, 240, 90, { tint: o.canopy, scale: 4, lo: .3, hi: .7, alpha: .95 }); x.drawImage(t, 0, -H * .05, W, H * .42) }
      return c
    }
    function shafts(W, H, o) {
      const c = mk(W, H), x = c.getContext('2d'), r = rng(o.seed)
      for (let k = 0; k < o.count; k++) {
        const sx = W * (.2 + r() * .7), w = 40 + r() * 90
        x.save(); x.translate(sx, 0); x.rotate((o.angle || -.35) + (r() - .5) * .1)
        const g = x.createLinearGradient(0, 0, 0, H * .9); g.addColorStop(0, `rgba(${o.col},${o.a})`); g.addColorStop(1, `rgba(${o.col},0)`)
        x.fillStyle = g; x.fillRect(-w / 2, -H * .2, w, H * 1.2); x.restore()
      }
      return c
    }
    function overlay(W, H, o) { const c = mk(W, H), x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 0, H); o.stops.forEach(s => g.addColorStop(s[0], s[1])); x.fillStyle = g; x.fillRect(0, 0, W, H); return c }
    function photo(W, H, img, o) {  // CC0 照片：cover 裁切、構圖焦點、壓暗與調色，保住閱讀場
      o = o || {}
      const c = mk(W, H), x = c.getContext('2d')
      const s = Math.max(W / img.naturalWidth, H / img.naturalHeight) * (o.zoom || 1), dw = img.naturalWidth * s, dh = img.naturalHeight * s
      const fx = o.focus ? o.focus[0] : .5, fy = o.focus ? o.focus[1] : .5
      x.drawImage(img, (W - dw) * fx, (H - dh) * fy, dw, dh)
      if (o.tint) { x.globalCompositeOperation = 'multiply'; x.fillStyle = o.tint; x.fillRect(0, 0, W, H); x.globalCompositeOperation = 'source-over' }
      if (o.desat) { x.globalCompositeOperation = 'saturation'; x.fillStyle = `rgba(128,128,128,${o.desat})`; x.fillRect(0, 0, W, H); x.globalCompositeOperation = 'source-over' }
      x.fillStyle = `rgba(8,12,11,${o.dark != null ? o.dark : .42})`; x.fillRect(0, 0, W, H)
      // 上緣壓一道暗，讓頂列與大標永遠站在穩定的暗場上
      const g = x.createLinearGradient(0, 0, 0, H * .35); g.addColorStop(0, 'rgba(8,12,11,.55)'); g.addColorStop(1, 'rgba(8,12,11,0)'); x.fillStyle = g; x.fillRect(0, 0, W, H * .35)
      return c
    }

    const SCENE_DEFS = {
      yangmingshan: (W, H) => [
        { rate: .04, cv: sky(W, H, { seed: 1, stops: [[0, '#1c2733'], [.42, '#54697a'], [.72, '#b39a7f'], [1, '#e2c39c']], glow: { x: .68, y: .62, r: .5, col: 'rgba(255,205,150,.34)' }, clouds: [{ tint: [200, 205, 208], scale: 3.2, lo: .48, hi: .78, alpha: .55, y0: .02, y1: .62 }, { tint: [70, 82, 92], scale: 2.4, lo: .5, hi: .9, alpha: .55, y0: -.05, y1: .4 }] }) },
        { rate: .1,  cv: ridge(W, H, { seed: 2, base: .66, amp: .12, freq: 2.2, top: 'rgba(146,168,178,.85)', bot: 'rgba(120,142,152,.9)' }) },
        { rate: .14, cv: mist(W, H, { y: .68, h: .07, a: .5, col: '214,222,222', tex: true, seed: 4 }) },
        { rate: .22, cv: ridge(W, H, { seed: 3, base: .78, amp: .16, freq: 1.6, top: '#4c6260', bot: '#2b3d38', trees: 'rgba(30,48,42,.9)', treeH: 7 }) },
        { rate: .3,  cv: mist(W, H, { y: .8, h: .06, a: .42, col: '206,218,214', tex: true, seed: 5 }) },
        { rate: .45, cv: ridge(W, H, { seed: 6, base: .92, amp: .17, freq: 1.1, top: '#243430', bot: '#111c17', trees: 'rgba(12,22,18,1)', treeH: 12 }) },
        { rate: .9, sway: 1, cv: grass(W, H, { seed: 8, count: 520, y0: .86, yr: .16, hMin: .1, hMax: .24, stem: 'rgba(196,188,168,.75)', stem2: 'rgba(120,118,104,.7)', plume: 'rgba(236,230,214,.9)', ground: '#0c1410' }) },
      ],
      'yangmingshan-night': (W, H) => [
        { rate: .04, cv: sky(W, H, { seed: 11, stops: [[0, '#070b11'], [.55, '#162029'], [1, '#2a3640']], clouds: [{ tint: [60, 72, 84], scale: 2.6, lo: .5, hi: .85, alpha: .6, y0: 0, y1: .55 }] }) },
        { rate: .1,  cv: ridge(W, H, { seed: 2, base: .66, amp: .12, freq: 2.2, top: 'rgba(40,54,64,.9)', bot: 'rgba(28,40,48,.95)' }) },
        { rate: .14, cv: mist(W, H, { y: .7, h: .07, a: .3, col: '150,170,176', tex: true, seed: 4 }) },
        { rate: .22, cv: ridge(W, H, { seed: 3, base: .78, amp: .16, freq: 1.6, top: '#1b2a2a', bot: '#101a18', trees: 'rgba(8,16,14,1)', treeH: 7 }) },
        { rate: .45, cv: ridge(W, H, { seed: 6, base: .92, amp: .17, freq: 1.1, top: '#0f1917', bot: '#080e0c', trees: 'rgba(5,10,8,1)', treeH: 12 }) },
        { rate: .9, sway: 1, cv: grass(W, H, { seed: 8, count: 360, y0: .87, yr: .15, hMin: .1, hMax: .22, stem: 'rgba(120,118,108,.6)', stem2: 'rgba(70,72,66,.6)', plume: 'rgba(170,168,156,.7)', ground: '#070b09' }) },
      ],
      'north-coast': (W, H) => [
        { rate: .04, cv: sky(W, H, { seed: 21, stops: [[0, '#222b33'], [.5, '#4f5d67'], [.72, '#9aa8b0'], [1, '#c2ccd0']], clouds: [{ tint: [40, 48, 56], scale: 2.2, lo: .42, hi: .85, alpha: .8, y0: -.05, y1: .5 }, { tint: [190, 198, 202], scale: 4, lo: .55, hi: .85, alpha: .4, y0: .3, y1: .66 }] }) },
        { rate: .12, cv: sea(W, H, { seed: 22, horizon: .64, far: '#4a5b63', mid: '#1d2c33', near: '#0a1418', glow: '188,200,204', wave: '196,212,218', foam: '226,236,238' }) },
        { rate: .16, cv: ridge(W, H, { seed: 23, base: .642, amp: .09, freq: 4, xEnd: .42, floor: .66, top: '#1a252a', bot: '#101a1e' }) },
        { rate: .3,  cv: mist(W, H, { y: .66, h: .05, a: .35, col: '190,204,208', tex: true, seed: 24 }) },
        { rate: .6,  cv: ridge(W, H, { seed: 26, base: 1.0, amp: .16, freq: 3, xEnd: .5, top: '#0d1417', bot: '#070c0e' }) },
        { rate: .9, sway: 1, cv: grass(W, H, { seed: 25, count: 200, y0: .9, yr: .12, hMin: .08, hMax: .18, stem: 'rgba(120,124,110,.6)', stem2: 'rgba(60,64,58,.7)', plume: 'rgba(196,196,184,.65)' }) },
      ],
      riverside: (W, H) => {
        const skyc = sky(W, H, { seed: 31, stops: [[0, '#141a2b'], [.45, '#3d3f5e'], [.66, '#8a6e6a'], [.78, '#c99a78'], [1, '#e0b58c']], glow: { x: .3, y: .74, r: .5, col: 'rgba(255,190,140,.3)' }, clouds: [{ tint: [40, 44, 64], scale: 2.8, lo: .5, hi: .9, alpha: .6, y0: 0, y1: .5 }] })
        const far = city(W, H, { seed: 32, horizon: .69, count: 900, depth: .02, tall: .1, block: '#0f131b', haze: '255,170,110', hazeA: .18, tint: ['255,196,120', '255,236,210', '170,200,230'], tower: .74 })
        const comp = mk(W, H); const cx = comp.getContext('2d'); cx.drawImage(skyc, 0, 0); cx.drawImage(far, 0, 0)
        return [
          { rate: .04, cv: skyc },
          { rate: .1,  cv: far },
          { rate: .16, cv: bridge(W, H, { y: .69, x0: .05, x1: .62, piers: 6, arch: true, col: '#0a0d13', lamp: '255,200,140' }) },
          { rate: .2,  cv: water(W, H, { horizon: .69, far: 'rgba(30,36,50,.9)', near: 'rgba(8,10,14,1)', src: comp, srcTop: .4, stretch: .55, alpha: .38, ripple: '200,210,230', seed: 33 }) },
          { rate: .55, cv: overlay(W, H, { stops: [[.84, 'rgba(6,8,11,0)'], [.86, '#0a0d10'], [1, '#05070a']] }) },
          { rate: .55, cv: lamps(W, H, { n: 7, x0: .08, dx: .14, y: .845, post: '#0d1116', col: '255,200,140' }) },
        ]
      },
      'mountain-road': (W, H) => [
        { rate: .04, cv: sky(W, H, { seed: 41, stops: [[0, '#121a22'], [.5, '#3e4f5b'], [.8, '#8c9ba2'], [1, '#aab6ba']], clouds: [{ tint: [160, 172, 178], scale: 3, lo: .5, hi: .85, alpha: .5, y0: .05, y1: .6 }] }) },
        { rate: .1,  cv: ridge(W, H, { seed: 42, base: .6, amp: .14, freq: 2.4, top: 'rgba(96,116,124,.9)', bot: 'rgba(70,88,96,.95)' }) },
        { rate: .16, cv: mist(W, H, { y: .62, h: .06, a: .5, col: '200,212,214', tex: true, seed: 43 }) },
        { rate: .24, cv: ridge(W, H, { seed: 44, base: .76, amp: .16, freq: 1.7, top: '#33463f', bot: '#1c2a25', trees: 'rgba(18,30,26,1)', treeH: 8 }) },
        { rate: .3,  cv: road(W, H, { seed: 45, pts: [[.42, 1.02], [.52, .86], [.34, .75], [.5, .66], [.68, .6], [.6, .54], [.7, .5]], w0: .075, w1: .006, far: '#5b6670', near: '#2c343a', edge: 'rgba(230,232,226,.28)', dash: 'rgba(230,232,226,.22)', post: '#1a2224' }) },
        { rate: .4,  cv: mist(W, H, { y: .8, h: .07, a: .38, col: '196,208,208', tex: true, seed: 46 }) },
        { rate: .9, sway: 1, cv: grass(W, H, { seed: 47, count: 300, y0: .9, yr: .12, hMin: .09, hMax: .2, stem: 'rgba(150,150,134,.7)', stem2: 'rgba(72,76,68,.7)', plume: 'rgba(210,208,196,.8)', ground: '#0a120f' }) },
      ],
      'mountain-mist': (W, H) => [
        { rate: .04, cv: sky(W, H, { seed: 51, stops: [[0, '#101820'], [.55, '#36474f'], [1, '#7a8a90']], clouds: [{ tint: [150, 164, 170], scale: 3, lo: .5, hi: .86, alpha: .45, y0: .05, y1: .6 }] }) },
        { rate: .1,  cv: ridge(W, H, { seed: 52, base: .58, amp: .12, freq: 2.6, top: 'rgba(84,104,112,.85)', bot: 'rgba(60,78,86,.9)' }) },
        { rate: .16, cv: mist(W, H, { y: .6, h: .07, a: .55, col: '196,208,210', tex: true, seed: 53 }) },
        { rate: .26, cv: ridge(W, H, { seed: 54, base: .74, amp: .14, freq: 1.9, top: '#2b3c38', bot: '#182521', trees: 'rgba(14,24,20,1)', treeH: 8 }) },
        { rate: .4,  cv: mist(W, H, { y: .78, h: .08, a: .45, col: '190,204,204', tex: true, seed: 55 }) },
      ],
      'basin-night': (W, H) => [
        { rate: .04, cv: sky(W, H, { seed: 61, stops: [[0, '#04070c'], [.5, '#0f1620'], [.8, '#2a2a34'], [1, '#4a3c36']], clouds: [{ tint: [40, 44, 56], scale: 2.4, lo: .5, hi: .9, alpha: .55, y0: 0, y1: .5 }] }) },
        { rate: .08, cv: ridge(W, H, { seed: 62, base: .56, amp: .1, freq: 2.8, top: '#0c1219', bot: '#080c12' }) },
        { rate: .14, cv: city(W, H, { seed: 63, horizon: .58, count: 2600, depth: .55, tall: .09, block: '#070a0f', haze: '255,170,120', hazeA: .22, tint: ['255,196,120', '255,236,214', '160,200,230', '255,150,90', '255,214,170'], tower: .66 }) },
        { rate: .3,  cv: mist(W, H, { y: .7, h: .12, a: .18, col: '255,190,140', tex: true, seed: 64 }) },
        { rate: .55, cv: overlay(W, H, { stops: [[.7, 'rgba(4,6,9,0)'], [1, 'rgba(4,6,9,.9)']] }) },
      ],
      'rice-paddies': (W, H) => [
        { rate: .04, cv: sky(W, H, { seed: 71, stops: [[0, '#5f7383'], [.5, '#b9b6a4'], [.72, '#e3ccab'], [1, '#f1dcbd']], glow: { x: .5, y: .66, r: .45, col: 'rgba(255,224,170,.5)' }, clouds: [{ tint: [230, 226, 214], scale: 3.4, lo: .5, hi: .8, alpha: .5, y0: .02, y1: .6 }] }) },
        { rate: .1,  cv: ridge(W, H, { seed: 72, base: .6, amp: .05, freq: 3, top: 'rgba(120,140,140,.8)', bot: 'rgba(96,116,116,.9)' }) },
        { rate: .16, cv: ridge(W, H, { seed: 73, base: .655, amp: .03, freq: 6, top: '#3a4d44', bot: '#2a3a33', trees: 'rgba(36,52,44,1)', treeH: 10 }) },
        { rate: .2,  cv: mist(W, H, { y: .66, h: .05, a: .55, col: '236,228,206', tex: true, seed: 74 }) },
        { rate: .3,  cv: paddy(W, H, { seed: 75, horizon: .655, dike: 'rgba(28,40,32,.85)', stalk: 'rgba(110,128,80,1)', mix: (t, v) => { const a = [214, 200, 172], b = [58, 78, 66]; const r = a.map((c, i) => Math.round((c + (b[i] - c) * t) * v)); return `rgb(${r[0]},${r[1]},${r[2]})` } }) },
        { rate: .55, cv: overlay(W, H, { stops: [[.8, 'rgba(10,14,12,0)'], [1, 'rgba(10,14,12,.85)']] }) },
      ],
      'forest-fog': (W, H) => [
        { rate: .03, cv: sky(W, H, { seed: 81, stops: [[0, '#222e2a'], [.5, '#66786f'], [1, '#9aaea3']] }) },
        { rate: .08, cv: forest(W, H, { seed: 82, count: 34, wMin: 4, wMax: 9, top: .05, col: 'rgba(70,90,82,.55)', canopy: [30, 44, 38] }) },
        { rate: .14, cv: mist(W, H, { y: .5, h: .25, a: .5, col: '190,206,196', tex: true, seed: 83 }) },
        { rate: .24, cv: forest(W, H, { seed: 84, count: 22, wMin: 7, wMax: 14, top: -.05, col: 'rgba(38,54,48,.85)' }) },
        { rate: .3,  cv: shafts(W, H, { seed: 85, count: 5, col: '226,238,224', a: .09, angle: -.3 }) },
        { rate: .38, cv: mist(W, H, { y: .75, h: .2, a: .4, col: '176,194,186', tex: true, seed: 86 }) },
        { rate: .6,  cv: forest(W, H, { seed: 87, count: 9, wMin: 14, wMax: 30, top: -.1, col: '#0b1411' }) },
        { rate: .6,  cv: overlay(W, H, { stops: [[.75, 'rgba(6,10,8,0)'], [1, 'rgba(6,10,8,.9)']] }) },
      ],
    }
    const VIEW_ENV = { overview: 'yangmingshan', all: 'yangmingshan-night', plan: 'riverside', playbook: 'mountain-road', log: 'north-coast', itt: 'mountain-mist', atlas: 'basin-night', trends: 'basin-night', harvest: 'rice-paddies', body: 'forest-fog' }
    /* CC0 照片底層（assets/strava-cinema/env/credits.json 有出處）。
       drop ＝ 照片取代掉的畫師層索引（天空、遠山、水面…），留下的多半是霧、芒草與底部壓暗。
       焦點、壓暗、調色都是為了讓照片退成場景而不是主角：文字永遠站在暗場上。 */
    const photos = {
      yangmingshan:    { src: 'assets/strava-cinema/env/yangmingshan-valley.jpg',   drop: [0, 1],       focus: [.5, .35], dark: .4,  tint: 'rgba(196,208,214,.9)', desat: .25 },
      riverside:       { src: 'assets/strava-cinema/env/tamsui-river-sunset.jpg',   drop: [0, 1, 2, 3, 5], focus: [.5, .58], dark: .26, tint: 'rgba(222,196,180,.95)' },
      'north-coast':   { src: 'assets/strava-cinema/env/northeast-coast.jpg',       drop: [0, 1, 2, 4], focus: [.5, .42], dark: .36, tint: 'rgba(176,200,212,.95)', desat: .2 },
      'mountain-road': { src: 'assets/strava-cinema/env/hehuanshan-night-road.jpg', drop: [0, 1, 3, 4], focus: [.4, .72], dark: .16 },
      'mountain-mist': { src: 'assets/strava-cinema/env/taroko-mist.jpg',           drop: [0, 1, 3],    focus: [.5, .3],  dark: .42, tint: 'rgba(184,204,204,.95)', desat: .3 },
      'basin-night':   { src: 'assets/strava-cinema/env/taipei-basin-night.jpg',    drop: [0, 1, 2],    focus: [.5, .6],  dark: .2 },
      'rice-paddies':  { src: 'assets/strava-cinema/env/changbin-rice-dawn.jpg',    drop: [0, 1, 2, 4], focus: [.5, .62], dark: .34, tint: 'rgba(230,214,186,.95)', desat: .15 },
    }
    const imgCache = {}
    const cache = new Map()
    function get(name, W, H, onPhoto) {
      const key = `${name}@${W}x${H}`
      if (cache.has(key)) { const v = cache.get(key); cache.delete(key); cache.set(key, v); return v }
      const def = SCENE_DEFS[name] || SCENE_DEFS.yangmingshan
      let layers = def(W, H)
      const ph = photos[name]
      if (ph) {
        // 就地換掉陣列內容：舞台握著的是同一個陣列參考，照片到了才看得到（先前重新指派過，舞台永遠停在畫師版）
        const put = img => { const keep = layers.filter((_, i) => !(ph.drop || []).includes(i)); layers.splice(0, layers.length, { rate: .05, cv: photo(W, H, img, ph) }, ...keep); if (onPhoto) onPhoto() }
        if (imgCache[ph.src] && imgCache[ph.src].complete && imgCache[ph.src].naturalWidth) put(imgCache[ph.src])
        else { const img = imgCache[ph.src] || (imgCache[ph.src] = new Image()); img.addEventListener('load', () => put(img), { once: true }); if (!img.src) img.src = ph.src }
      }
      cache.set(key, layers)
      while (cache.size > 2) cache.delete(cache.keys().next().value)
      return layers
    }
    return { get, VIEW_ENV, grain, photos }
  })()

  /* ── 場景動態參數：每個 view 一組，切換時逐幀往目標值走 ── */
  const SCENES = {
    overview: { fog: .32, tint: [214, 226, 222], rain: 0,   motes: 0,   bokeh: 0,   trails: 'week',  ridge: null,    road: 0, breathe: 0, warm: 0 },
    plan:     { fog: .16, tint: [214, 220, 232], rain: 0,   motes: 0,   bokeh: 0,   trails: null,    ridge: null,    road: 1, breathe: 0, warm: 0 },
    playbook: { fog: .3,  tint: [200, 214, 214], rain: .5,  motes: 0,   bokeh: 0,   trails: null,    ridge: 'climb', road: 0, breathe: 0, warm: 0 },
    log:      { fog: .22, tint: [170, 196, 210], rain: .3,  motes: 0,   bokeh: 0,   trails: 'log',   ridge: null,    road: 0, breathe: 0, warm: 0 },
    itt:      { fog: .28, tint: [196, 214, 208], rain: 0,   motes: 0,   bokeh: 0,   trails: 'route', ridge: 'route', road: 0, breathe: 0, warm: 0 },
    atlas:    { fog: .12, tint: [196, 214, 208], rain: 0,   motes: 0,   bokeh: .1,  trails: null,    ridge: null,    road: 0, breathe: 0, warm: 0 },
    trends:   { fog: .14, tint: [180, 200, 220], rain: 0,   motes: 0,   bokeh: .8,  trails: null,    ridge: null,    road: 0, breathe: 0, warm: 0 },
    harvest:  { fog: .18, tint: [236, 224, 196], rain: 0,   motes: 1,   bokeh: 0,   trails: null,    ridge: null,    road: 0, breathe: 0, warm: 1 },
    body:     { fog: .4,  tint: [196, 222, 206], rain: 0,   motes: .2,  bokeh: 0,   trails: null,    ridge: null,    road: 0, breathe: 1, warm: 0 },
    all:      { fog: .16, tint: [214, 226, 222], rain: 0,   motes: 0,   bokeh: 0,   trails: null,    ridge: null,    road: 0, breathe: 0, warm: 0 },
  }
  const NUM = ['fog', 'rain', 'motes', 'bokeh', 'road', 'breathe', 'warm']

  /* ── 資料轉接：全部讀既有的全域，沒有第二套計算 ── */
  const tpeToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
  const addDays = (d, k) => new Date(Date.parse(d) + k * 86400000).toISOString().slice(0, 10)
  const D = () => window.__cinemaData || {}
  const routesWeek = () => { const since = addDays(tpeToday(), -6); return (D().recent_rides || []).filter(a => a.date >= since && a.route_stream && a.route_stream.length > 2).map(a => a.route_stream) }
  const routesLog = () => (D().recent_rides || []).filter(a => a.route_stream && a.route_stream.length > 2).slice(0, 8).map(a => a.route_stream)
  const selectedTsv = () => { const el = document.querySelector('#tsv-stack > .tsv:not([hidden])'); return el ? el.dataset.tsv : null }
  const routeSel = () => { const id = selectedTsv(); const s = id && (window._segStreams || {})[id]; return s && s.pts && s.pts.length > 2 ? [s.pts] : [] }
  const profileOf = pts => {
    if (!pts || pts.length < 3) return null
    let lo = Infinity, hi = -Infinity, cnt = 0
    pts.forEach(p => { const a = p[2]; if (a == null) return; cnt++; if (a < lo) lo = a; if (a > hi) hi = a })
    if (cnt < 3) return null
    const span = (hi - lo) || 1, N = 160, out = []
    for (let i = 0; i < N; i++) { const p = pts[Math.round(i / (N - 1) * (pts.length - 1))]; out.push(((p[2] == null ? lo : p[2]) - lo) / span) }
    return out
  }
  const ridgeRoute = () => { const r = routeSel(); return r.length ? profileOf(r[0]) : null }
  const ridgeClimb = () => {
    const PB = window._playbook; if (!PB || !Array.isArray(PB.climbs)) return null
    const cur = document.querySelector('.pk-sel [aria-current="true"]')
    const c = PB.climbs[cur ? +cur.dataset.pk : 0] || PB.climbs[0]
    if (!c) return null
    const s = (window._segStreams || {})[c.id]
    if (s && s.pts) return profileOf(s.pts)
    const prof = c.trace && c.trace.prof
    if (!prof || prof.length < 3) return null
    const ys = prof.map(p => p[1]), lo = Math.min(...ys), hi = Math.max(...ys), span = (hi - lo) || 1, N = 160, out = []
    for (let i = 0; i < N; i++) out.push((prof[Math.round(i / (N - 1) * (prof.length - 1))][1] - lo) / span)
    return out
  }
  const reflectors = () => { const B = window._trainingBlock; if (!B || !Array.isArray(B.sessions)) return []; return B.sessions.filter(s => !s.support).sort((a, b) => a.date.localeCompare(b.date)).map(s => !!(s.actual && !s.actual.substituted)) }
  const verdictMul = () => { const v = (window.__cinemaState || {}).verdict; return v === 'rest' ? { fog: 1.6, rain: .35 } : v === 'ease' ? { fog: 1.25, rain: 0 } : v === 'nodata' ? { fog: 1, rain: 0 } : { fog: .75, rain: 0 } }
  const harvestMul = () => { const H = window.__harvest; if (!H || !H.stats || !H.stats.n) return .5; return Math.max(.25, Math.min(1.2, H.stats.over / H.stats.n * 3)) }
  const breatheAmp = () => {
    const w = window._wellness; if (!w) return .5
    const days = Object.keys(w).sort().filter(d => d <= tpeToday())
    let last = null; for (let i = days.length - 1; i >= 0 && last == null; i--) if (w[days[i]] && w[days[i]].hrv != null) last = w[days[i]].hrv
    const hist = days.slice(-30).map(d => w[d] && w[d].hrv).filter(v => v != null)
    if (last == null || hist.length < 8) return .5
    const mu = hist.reduce((a, b) => a + b, 0) / hist.length
    return Math.max(.25, Math.min(1, last / mu))
  }

  /* ── 投影：lat/lng → 畫面上的一個框，cos(lat) 修正 ── */
  function project(stream, box) {
    let la0 = Infinity, la1 = -Infinity, lo0 = Infinity, lo1 = -Infinity
    stream.forEach(p => { if (p[0] < la0) la0 = p[0]; if (p[0] > la1) la1 = p[0]; if (p[1] < lo0) lo0 = p[1]; if (p[1] > lo1) lo1 = p[1] })
    const cosL = Math.cos((la0 + la1) / 2 * Math.PI / 180)
    const dx = (lo1 - lo0) * cosL || 1e-6, dy = (la1 - la0) || 1e-6
    const sc = Math.min(box.w / dx, box.h / dy)
    const ox = box.x + (box.w - dx * sc) / 2, oy = box.y + (box.h - dy * sc) / 2
    const pts = stream.map(p => [ox + (p[1] - lo0) * cosL * sc, oy + (la1 - p[0]) * sc])
    const cum = [0]
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
    return { pts, cum, len: cum[cum.length - 1] || 1 }
  }
  const ptAt = (r, d) => {
    let lo = 0, hi = r.cum.length - 1
    while (lo < hi) { const m = (lo + hi) >> 1; r.cum[m] < d ? lo = m + 1 : hi = m }
    const i = Math.max(1, lo), a = r.pts[i - 1], b = r.pts[i], seg = (r.cum[i] - r.cum[i - 1]) || 1
    const t = Math.max(0, Math.min(1, (d - r.cum[i - 1]) / seg))
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  }

  /* ── 一座舞台＝一張 canvas ＋ 它自己的環境與粒子 ── */
  function Stage(cv, opts) {
    this.cv = cv; this.ctx = cv.getContext('2d'); this.opts = opts || {}
    this.W = 0; this.H = 0; this.cur = null; this.target = null; this.name = 'overview'
    this.fog = []; this.rain = []; this.motes = []; this.bokeh = []; this.trails = []; this.ridge = null; this.refl = []
    this.env = null; this.envPrev = null; this.envFade = 1; this.envName = null
    this.t = 0; this.px = 0; this.py = 0; this.scrollPar = 0; this.dirty = true
    this.defocus = 0     // 鏡頭失焦程度 0–1（轉場引擎給）：多畫幾顆軟 bokeh、霧更厚、光軌略暗，對到焦就淡掉
    // 霧／散景／光塵畫在 1/3 解析度的離屏再放大：軟的東西不需要每像素算，填充省九倍
    this.lo = document.createElement('canvas'); this.lctx = this.lo.getContext('2d')
  }
  Stage.prototype.resize = function () {
    // clientWidth 是版面尺寸，不受轉場的 transform:scale 影響（getBoundingClientRect 會跟著放大，畫布就會每幀重建）
    const w = Math.max(1, Math.round(this.cv.clientWidth || innerWidth)), h = Math.max(1, Math.round(this.cv.clientHeight || innerHeight))
    if (w === this.W && h === this.H) return
    this.W = w; this.H = h
    this.cv.width = w; this.cv.height = h        // 刻意不乘 DPR：霧本來就是軟的，省四倍像素
    this.lo.width = Math.ceil(w / 3); this.lo.height = Math.ceil(h / 3)
    this.envName = null; this.envPrev = null
    this.build()
    if (this.target) this.setScene(this.name, true)
    this.dirty = true
  }
  Stage.prototype.setScene = function (name, force) {
    const base = SCENES[name] || SCENES.all
    const s = Object.assign({}, base)
    if (name === 'overview') { const m = verdictMul(); s.fog *= m.fog; s.rain = Math.max(s.rain, m.rain) }
    if (name === 'harvest') s.motes *= harvestMul()
    if (name === 'body') s.breathe *= breatheAmp()
    if (this.opts.hero) { s.fog *= .8; s.bokeh = 0; s.motes = .25 }
    this.name = name; this.target = s
    if (!this.cur || force) this.cur = Object.assign({}, s, { tint: s.tint.slice() })
    if (!this.opts.hero) {
      const envName = ENV.VIEW_ENV[name] || 'yangmingshan'
      if (envName !== this.envName) {
        const ES = mobileMQ.matches ? .6 : .75
        this.padX = Math.round(this.W * .06); this.padY = Math.round(this.H * .06)
        this.LW = this.W + this.padX * 2; this.LH = this.H + this.padY * 2
        const layers = ENV.get(envName, Math.round(this.LW * ES), Math.round(this.LH * ES), () => { this.dirty = true })
        this.envPrev = force ? null : this.env; this.envFade = force ? 1 : 0
        this.env = { name: envName, layers, es: ES }
        this.envName = envName
      }
    }
    this.rebuildData()
    this.dirty = true
  }
  Stage.prototype.rebuildData = function () {
    const s = this.target; if (!s || !this.W) return
    const W = this.W, H = this.H, mobile = mobileMQ.matches
    let routes = []
    if (s.trails === 'week' || (this.opts.hero && this.name === 'overview')) routes = routesWeek()
    else if (s.trails === 'log') routes = routesLog()
    else if (s.trails === 'route') routes = routeSel()
    const box = this.opts.hero
      ? { x: W * .5, y: H * .4, w: W * .44, h: H * .48 }
      : mobile ? { x: W * .1, y: H * .42, w: W * .8, h: H * .4 } : { x: W * .6, y: H * .3, w: W * .36, h: H * .48 }
    this.trails = routes.slice(0, mobile ? 3 : 6).map((st, i) => {
      const sub = routes.length > 1 && !this.opts.hero
        ? { x: box.x + (i % 3) * box.w * .34, y: box.y + Math.floor(i / 3) * box.h * .52, w: box.w * .3, h: box.h * .46 }
        : box
      const r = project(st, sub)
      r.head = Math.random() * r.len; r.speed = (18 + Math.random() * 10) * (mobile ? .7 : 1)
      r.tail = Math.min(r.len * .35, 120 + r.len * .08)
      return r
    })
    this.ridge = s.ridge === 'route' ? ridgeRoute() : s.ridge === 'climb' ? ridgeClimb() : null
    this.refl = s.road ? reflectors() : []
  }
  Stage.prototype.build = function () {
    const mobile = mobileMQ.matches, rnd = (a, b) => a + Math.random() * (b - a), mul = mobile ? .5 : 1
    this.fog = Array.from({ length: Math.round(9 * mul) + 3 }, () => ({ x: rnd(-.1, 1.1), y: rnd(.25, 1.05), r: rnd(.22, .55), vx: rnd(-.004, .004), vy: rnd(-.0012, .0012), a: rnd(.35, 1), ph: rnd(0, 6.28), depth: rnd(.4, 1.4) }))
    this.rain = Array.from({ length: Math.round(220 * mul) }, () => ({ x: rnd(0, 1), y: rnd(0, 1), l: rnd(.012, .03), v: rnd(.9, 1.5), a: rnd(.08, .22) }))
    this.motes = Array.from({ length: Math.round(70 * mul) }, () => ({ x: rnd(0, 1), y: rnd(0, 1), r: rnd(.7, 2.2), v: rnd(.02, .06), ph: rnd(0, 6.28), a: rnd(.25, .8) }))
    this.bokeh = Array.from({ length: Math.round(44 * mul) }, () => ({ x: rnd(0, 1), y: rnd(.05, 1), r: rnd(6, 26), vx: rnd(-.006, .006), vy: rnd(-.004, .004), a: rnd(.04, .12), c: [[255, 190, 110], [255, 236, 200], [150, 210, 230], [255, 140, 90]][Math.floor(rnd(0, 4))] }))
    this.rebuildData()
  }
  Stage.prototype.step = function (dt) {
    const c = this.cur, tg = this.target
    if (!c || !tg) return
    const k = Math.min(1, dt / 1400)
    NUM.forEach(key => { c[key] += (tg[key] - c[key]) * k })
    if (!c.tint) c.tint = tg.tint.slice()
    for (let i = 0; i < 3; i++) c.tint[i] += (tg.tint[i] - c.tint[i]) * k
    if (this.envPrev) { this.envFade = Math.min(1, this.envFade + dt / 450); if (this.envFade >= 1) this.envPrev = null }
    this.t += dt
    const s = dt / 1000
    this.fog.forEach(f => { f.x += f.vx * s; f.y += f.vy * s; if (f.x < -.4) f.x = 1.3; if (f.x > 1.4) f.x = -.3; if (f.y < .1) f.y = 1.05; if (f.y > 1.15) f.y = .2 })
    if (c.rain > .02) this.rain.forEach(r => { r.y += r.v * s * .9; r.x -= s * .06; if (r.y > 1.05) { r.y = -.05; r.x = Math.random() * 1.1 } if (r.x < -.05) r.x = 1.05 })
    if (c.motes > .02) this.motes.forEach(m => { m.y -= m.v * s; m.x += Math.sin(this.t / 1000 + m.ph) * .0004; if (m.y < -.02) { m.y = 1.02; m.x = Math.random() } })
    if (c.bokeh > .02) this.bokeh.forEach(b => { b.x += b.vx * s; b.y += b.vy * s; if (b.x < -.05) b.x = 1.05; if (b.x > 1.05) b.x = -.05; if (b.y < 0) b.y = 1.05; if (b.y > 1.05) b.y = 0 })
    this.trails.forEach(r => { r.head += r.speed * s; if (r.head > r.len + r.tail) r.head = 0 })
  }
  /* ── 光圈（LENS）：F2.0 最淺、F8 幾乎全清楚。環境層依深度分開處理：遠景（天空、遠山、照片底）糊最多、
     中景不動（那是閱讀場所在的深度）、近景（芒草、路緣）稍糊；光點依光圈放大或收斂。
     糊的版本不是每幀算：每個圖層依目前光圈預先糊一次快取起來（換光圈才重算）。 ── */
  const APERTURE = { '2': { far: 3.2, near: 2.4, bokehR: 1.5, bokehA: 1.15 }, '2.8': { far: 1.6, near: 1.2, bokehR: 1, bokehA: 1 }, '5.6': { far: .6, near: .4, bokehR: .72, bokehA: .7 }, '8': { far: 0, near: 0, bokehR: .55, bokehA: .45 } }
  let apertureF = '2.8'
  const apNow = () => APERTURE[apertureF] || APERTURE['2.8']
  function layerBlurPx(L) { const a = apNow(); return L.rate < .12 ? a.far : L.rate >= .55 ? a.near : 0 }
  function blurredLayer(L, px) {
    if (!px) return L.cv
    if (L._bl && L._blPx === px) return L._bl
    const c = document.createElement('canvas'); c.width = L.cv.width; c.height = L.cv.height
    const x = c.getContext('2d')
    try { x.filter = `blur(${px}px)`; x.drawImage(L.cv, 0, 0); x.filter = 'none' } catch (e) { return L.cv }
    L._bl = c; L._blPx = px
    return c
  }
  Stage.prototype.drawEnv = function (env, alpha, quiet) {
    if (!env || !env.layers) return
    const ctx = this.ctx, px = quiet ? 0 : this.px, py = quiet ? 0 : this.py, sp = quiet ? 0 : this.scrollPar
    const LW = this.LW, LH = this.LH
    ctx.save(); ctx.globalAlpha = alpha
    env.layers.forEach(L => {
      const dx = -this.padX - px * L.rate * 30, dy = -this.padY - py * L.rate * 14 + sp * L.rate
      const cv = blurredLayer(L, layerBlurPx(L))
      if (L.sway && !quiet) {
        const sh = Math.sin(this.t / 2300) * .014 + Math.sin(this.t / 690) * .004
        ctx.save(); ctx.transform(1, 0, sh, 1, -sh * (this.H + this.padY), 0); ctx.drawImage(cv, dx, dy, LW, LH); ctx.restore()
      } else ctx.drawImage(cv, dx, dy, LW, LH)
    })
    ctx.restore()
  }
  Stage.prototype.draw = function (tier) {
    const ctx = this.ctx, W = this.W, H = this.H, c = this.cur
    if (!c) return
    ctx.clearRect(0, 0, W, H)
    const quiet = tier === 'quiet'
    const px = quiet ? 0 : this.px, py = quiet ? 0 : this.py
    const df = quiet ? 0 : this.defocus     // 靜態終態不烙上失焦的 bokeh
    const tint = c.tint || [214, 226, 222]
    const breathe = c.breathe > .02 ? 1 + .18 * c.breathe * Math.sin(this.t / 5200 * Math.PI * 2) : 1
    // ── 環境：分層點陣，場景切換時前後兩組交叉溶接（天氣在變，不是整頁淡出）──
    if (!this.opts.hero) { if (this.envPrev) this.drawEnv(this.envPrev, 1 - this.envFade, quiet); this.drawEnv(this.env, this.envPrev ? this.envFade : 1, quiet) }
    // ── 真實剖面的稜線：同一條剖面畫三層，越遠越淡越高 ──
    if (this.ridge) {
      const prof = this.ridge, n = prof.length
      const layers = [[.64, .26, .55, 1.6], [.74, .2, .7, 1.0], [.86, .15, .85, .5]]
      layers.forEach(([base, amp, alpha, par], li) => {
        const ox = px * 18 * par, oy = py * 8 * par
        ctx.beginPath(); ctx.moveTo(-40, H + 40)
        for (let i = 0; i < n; i++) ctx.lineTo((i / (n - 1)) * (W + 80) - 40 + ox, H * base - prof[i] * H * amp + oy)
        ctx.lineTo(W + 40, H + 40); ctx.closePath()
        const g = ctx.createLinearGradient(0, H * (base - amp), 0, H)
        g.addColorStop(0, `rgba(${tint[0] * .28 | 0},${tint[1] * .34 | 0},${tint[2] * .32 | 0},${alpha})`)
        g.addColorStop(1, `rgba(8,12,11,${alpha})`)
        ctx.fillStyle = g; ctx.fill()
        if (li === 0) {
          ctx.beginPath()
          for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * (W + 80) - 40 + ox, y = H * base - prof[i] * H * amp + oy; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y) }
          ctx.strokeStyle = 'rgba(255,179,71,.32)'; ctx.lineWidth = 1; ctx.stroke()
        }
      })
    }
    // ── 霧／散景／光塵：1/3 解析度離屏 → 放大貼回 ──
    const lctx = this.lctx
    const ap = apNow()
    const bk = Math.max(c.bokeh, df * .75) * ap.bokehA
    if (c.fog > .01 || bk > .02 || c.motes > .02) {
      lctx.setTransform(1, 0, 0, 1, 0, 0); lctx.clearRect(0, 0, this.lo.width, this.lo.height)
      lctx.setTransform(1 / 3, 0, 0, 1 / 3, 0, 0)
    // ── 霧 ──
    if (c.fog > .01) {
      const base = Math.min(W, H)
      this.fog.forEach(f => {
        const pulse = 1 + .08 * Math.sin(this.t / 7000 + f.ph)
        const r = f.r * base * pulse * breathe
        const x = f.x * W + px * 26 * f.depth, y = f.y * H + py * 12 * f.depth
        const g = lctx.createRadialGradient(x, y, 0, x, y, r)
        const a = .14 * c.fog * f.a * (c.warm ? 1.1 : 1) * (1 + .5 * df)
        const col = c.warm ? [tint[0], tint[1] - 8, tint[2] - 30] : tint
        g.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${a})`); g.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`)
        lctx.fillStyle = g; lctx.fillRect(x - r, y - r, r * 2, r * 2)
      })
    }
    // ── 散景 ──
    if (bk > .02) this.bokeh.forEach(b => {
      const x = b.x * W + px * 10, y = b.y * H + py * 5, r = b.r * (1 + 1.4 * df) * ap.bokehR     // 失焦時光點變大、變軟；光圈越大光點越大
      const g = lctx.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, `rgba(${b.c[0]},${b.c[1]},${b.c[2]},${b.a * bk})`); g.addColorStop(.7, `rgba(${b.c[0]},${b.c[1]},${b.c[2]},${b.a * bk * .5})`); g.addColorStop(1, `rgba(${b.c[0]},${b.c[1]},${b.c[2]},0)`)
      lctx.fillStyle = g; lctx.fillRect(x - r, y - r, r * 2, r * 2)
    })
    // ── 光塵 ──
    if (c.motes > .02) {
      const warm = c.warm > .5
      this.motes.forEach(m => {
        const x = m.x * W + px * 14, y = m.y * H + py * 6, a = m.a * c.motes * (.55 + .45 * Math.sin(this.t / 900 + m.ph))
        lctx.beginPath(); lctx.arc(x, y, m.r, 0, 6.283); lctx.fillStyle = warm ? `rgba(255,222,150,${a})` : `rgba(214,232,220,${a * .8})`; lctx.fill()
      })
    }
      lctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.drawImage(this.lo, 0, 0, this.lo.width, this.lo.height, 0, 0, W, H)
    }
    // ── 路上的反光標（計畫）──
    if (c.road > .02 && this.refl.length) {
      const n = this.refl.length, x0 = W * .06, y0 = H * .93, x1 = W * .86, y1 = H * .3, a = c.road
      ctx.save()
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(W * .45, H * .92, x1, y1)
      ctx.strokeStyle = `rgba(243,239,230,${.08 * a})`; ctx.lineWidth = 1; ctx.setLineDash([6, 12]); ctx.stroke(); ctx.setLineDash([])
      const at = t => { const u = 1 - t; return [u * u * x0 + 2 * u * t * W * .45 + t * t * x1, u * u * y0 + 2 * u * t * H * .92 + t * t * y1] }
      this.refl.forEach((lit, i) => {
        const t = (i + .5) / n, [x, y] = at(t), r = lit ? 3.2 : 2.2
        const g = ctx.createRadialGradient(x, y, 0, x, y, r * 5)
        g.addColorStop(0, lit ? `rgba(255,179,71,${.9 * a})` : `rgba(243,239,230,${.35 * a})`)
        g.addColorStop(.25, lit ? `rgba(255,179,71,${.35 * a})` : `rgba(243,239,230,${.08 * a})`)
        g.addColorStop(1, 'rgba(255,179,71,0)')
        ctx.fillStyle = g; ctx.fillRect(x - r * 5, y - r * 5, r * 10, r * 10)
      })
      if (!quiet) { const ph = (this.t % 9000) / 9000; if (ph < .55) { const [x, y] = at(ph / .55); const g = ctx.createRadialGradient(x, y, 0, x, y, 22); g.addColorStop(0, `rgba(255,236,200,${.5 * a})`); g.addColorStop(1, 'rgba(255,236,200,0)'); ctx.fillStyle = g; ctx.fillRect(x - 22, y - 22, 44, 44) } }
      ctx.restore()
    }
    // ── GPS 光軌 ──
    if (this.trails.length) {
      ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      ctx.globalAlpha = 1 - .35 * df     // 失焦時光軌略暗，鎖定那一刻回到正常
      this.trails.forEach(r => {
        ctx.beginPath(); r.pts.forEach((p, i) => i ? ctx.lineTo(p[0] + px * 6, p[1] + py * 3) : ctx.moveTo(p[0] + px * 6, p[1] + py * 3))
        ctx.strokeStyle = 'rgba(255,179,71,.14)'; ctx.lineWidth = 1.2; ctx.stroke()
        if (quiet) return
        const steps = 14, d1 = r.head, d0 = Math.max(0, d1 - r.tail)
        for (let k = 0; k < steps; k++) {
          const a = d0 + (d1 - d0) * k / steps, b = d0 + (d1 - d0) * (k + 1) / steps
          if (b <= 0 || a >= r.len) continue
          const p = ptAt(r, Math.min(r.len, a)), q = ptAt(r, Math.min(r.len, b)), al = (k + 1) / steps
          ctx.beginPath(); ctx.moveTo(p[0] + px * 6, p[1] + py * 3); ctx.lineTo(q[0] + px * 6, q[1] + py * 3)
          ctx.strokeStyle = `rgba(255,${190 + 40 * al | 0},${110 + 90 * al | 0},${.75 * al})`; ctx.lineWidth = 1.2 + 1.6 * al; ctx.stroke()
        }
        const hp = ptAt(r, Math.min(r.len, d1))
        const g = ctx.createRadialGradient(hp[0] + px * 6, hp[1] + py * 3, 0, hp[0] + px * 6, hp[1] + py * 3, 12)
        g.addColorStop(0, 'rgba(255,240,210,.85)'); g.addColorStop(1, 'rgba(255,179,71,0)')
        ctx.fillStyle = g; ctx.fillRect(hp[0] + px * 6 - 12, hp[1] + py * 3 - 12, 24, 24)
      })
      ctx.restore()
    }
    // ── 雨 ──
    if (c.rain > .02 && !quiet) {
      ctx.save(); ctx.strokeStyle = 'rgba(214,226,232,1)'; ctx.lineWidth = 1
      this.rain.forEach(r => { ctx.globalAlpha = r.a * c.rain; const x = r.x * W + px * 4, y = r.y * H; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - r.l * H * .12, y + r.l * H); ctx.stroke() })
      ctx.restore()
    }
    // ── 底片顆粒：整個畫面同一層薄薄的雜訊，動態時每幀換位置 ──
    if (!this.opts.hero) {
      ctx.save(); ctx.globalAlpha = .035
      const pat = ctx.createPattern(ENV.grain(), 'repeat'); ctx.fillStyle = pat
      if (!quiet) ctx.translate((this.t * .37) % 160, (this.t * .21) % 160)
      ctx.fillRect(-160, -160, W + 320, H + 320); ctx.restore()
    }
  }

  /* ── 引擎 ── */
  const stages = [new Stage(main, {})]
  let heroStage = null
  const findHero = () => {
    const cv = document.getElementById('td-canvas')
    if (!cv) { heroStage = null; return }
    if (!heroStage || heroStage.cv !== cv) { heroStage = new Stage(cv, { hero: true }); heroStage.resize(); heroStage.setScene('overview', true) }
  }
  let raf = 0, last = 0, acc = 0, running = false, view = 'overview'
  const activeStages = () => { const list = [stages[0]]; if (view === 'overview' && heroStage && heroStage.cv.isConnected) list.push(heroStage); return list }
  function frame(t) {
    raf = 0
    if (!running) return
    const tier = tierNow()
    const dt = last ? Math.min(80, t - last) : 16
    last = t
    if (tier === 'active') { acc += dt; if (acc < 30) { raf = requestAnimationFrame(frame); return } }
    const step = tier === 'active' ? acc : dt
    acc = 0
    activeStages().forEach(st => { st.resize(); st.step(step); st.draw(tier) })
    if (tier !== 'quiet') raf = requestAnimationFrame(frame)
  }
  function start() { if (document.hidden) return; running = true; last = 0; if (!raf) raf = requestAnimationFrame(frame) }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0 }
  function drawQuiet() {
    activeStages().forEach(st => { st.resize(); st.step(2000); st.cur = Object.assign(st.cur || {}, st.target, { tint: st.target.tint.slice() }); st.envPrev = null; st.envFade = 1; st.draw('quiet') })
  }
  function refresh() {
    findHero()
    activeStages().forEach(st => { st.resize(); st.setScene(view) })
    if (tierNow() === 'quiet') { stop(); drawQuiet() } else start()
  }

  // 指標與捲動視差：慢、輕、有景深
  let tx = 0, ty = 0
  addEventListener('pointermove', e => { if (tierNow() === 'quiet' || e.pointerType === 'touch') return; tx = (e.clientX / innerWidth - .5) * 2; ty = (e.clientY / innerHeight - .5) * 2 }, { passive: true })
  let parRaf = 0
  function parallaxTick() {
    parRaf = 0
    if (tierNow() === 'quiet') return
    const sp = -Math.min(900, scrollY) * .05
    stages.concat(heroStage ? [heroStage] : []).forEach(st => { st.px += (tx - st.px) * .03; st.py += (ty - st.py) * .03; st.scrollPar += (sp - st.scrollPar) * .08 })
    parRaf = requestAnimationFrame(parallaxTick)
  }
  const parallaxArm = () => { if (!parRaf) parRaf = requestAnimationFrame(parallaxTick) }

  addEventListener('strava:hub', e => { view = (e.detail && e.detail.view) || view; refresh() })
  addEventListener('strava:scene', () => refresh())
  addEventListener('resize', () => { stages.concat(heroStage ? [heroStage] : []).forEach(st => st.resize()); if (tierNow() === 'quiet') drawQuiet() })
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else refresh() })
  if (reduceMQ.addEventListener) reduceMQ.addEventListener('change', () => { applyTier(); refresh() })

  function applyTier() {
    const t = tierNow()
    document.body.dataset.fx = t
    parallaxArm()
    const b = document.getElementById('fx-tier')
    // reduced-motion 只鎖動態那一列（面板裡的三顆 disabled），底片與光圈照樣可以選，所以鈕本身不 disable
    if (b) { if (!b.dataset.dial) b.innerHTML = `<small>FX</small>${TIER_ZH[t]}`; if (window.__cinemaLook && window.__cinemaLook.paint) window.__cinemaLook.paint(); b.title = reduceMQ.matches ? '底片 · 光圈（系統要求減少動態：動態固定 QUIET）' : `底片 · 光圈 · 場景動態：${TIER_ZH[t]}`; b.disabled = false }
  }
  function mountButton() {
    const host = document.querySelector('.topbar .tb-r')
    if (!host || document.getElementById('fx-tier')) return
    const b = document.createElement('button')
    b.id = 'fx-tier'; b.type = 'button'; b.className = 'fx-tier fx-dial'
    // 點一下：開 FX 面板（底片／光圈／動態三列，檔尾的 __cinemaLook）；面板模組不在時退回原本的三檔循環
    b.addEventListener('click', () => {
      if (window.__cinemaLook) { window.__cinemaLook.step('tier', 1); return }
      const cur = tierNow(); setTier(TIERS[(TIERS.indexOf(cur) + 1) % TIERS.length])
    })
    b.setAttribute('aria-haspopup', 'dialog'); b.setAttribute('aria-expanded', 'false')
    host.insertBefore(b, host.firstChild)
    applyTier()
  }
  function setTier(t) { if (!TIERS.includes(t)) return; userTier = t; try { localStorage.setItem(LS, userTier) } catch (e) {}; applyTier(); refresh() }
  function setAperture(f) {
    const k = String(f); if (!APERTURE[k] || k === apertureF) return
    apertureF = k
    stages.forEach(st => { st.dirty = true })
    if (tierNow() === 'quiet') drawQuiet()
  }
  mountButton()
  applyTier()
  window.__cinemaFx = { refresh, tier: tierNow, tiers: TIERS, setTier, setAperture, aperture: () => apertureF, reduced: () => reduceMQ.matches, stages: () => activeStages(), env: ENV, setDefocus: v => { stages[0].defocus = v; if (heroStage) heroStage.defocus = v } }
  view = document.body.dataset.view || 'overview'
  stages[0].resize(); stages[0].setScene(view, true)
  refresh()
})()

/* ══ 鏡頭轉場：defocus → focus pull → autofocus lock ═══════════════════════════
   參考攝影鏡頭：畫面一開始像還沒對到焦（照片與光線糊成大片柔和色階），焦距慢慢找到主體，最後清楚鎖定。
   沒有遮罩、沒有格子、沒有截圖、沒有第三方套件 —— 只對「背景場景層」動 filter（blur／saturate／contrast／
   brightness）與 transform:scale：`#cn-canvas`（全站場景）與 `.td-scene`（TODAY hero 的媒體層；<video> 在裡面，
   本身一個屬性都不碰，不會重新起播或閃黑）。文字、頂列、底列、數據永遠不進 blur。
   三個等級（入口只有 strava_cinema.html 的 navTo）：
     1 首次進站／重新載入 intro(swap)：~1100ms。這支檔一載入就先把場景層定在失焦（body.cn-defocused），資料到了才開始尋焦：
       150ms 還沒對到 → blur 24→8（非線性）→ 8→0 慢慢收 → 最後 150ms 對比、飽和、光軌亮度輕輕回到正常＝焦點鎖定。
       標題與核心資訊在後半段以 opacity＋6px 位移出現（CSS body.cn-focus）。canvas 只多畫幾顆軟的 bokeh 與霧光，隨對焦完成淡出。
     2 跨 hub go({level:2})：舊內容 100ms 淡出 → setView → 場景層 5px→0（~420ms）、標題與第一個區塊 opacity＋6px（動效層）。
     3 同 hub 的 rail／子頁 go({level:3})：只有 #content 的 ~200ms dissolve（CSS body.cn-in3），背景不動。
   鏡頭狀態是連續值：任何新程式都從當下的值接著走，快速連點不會跳、不會疊；永遠切到最後一次點的頁面。
   drawer／modal／tooltip／圖表範圍不經過 navTo，所以完全不會播。
   prefers-reduced-motion：沒有 blur／scale／bokeh，只有 ~120ms 的 opacity 淡入淡出。 */
;(function () {
  'use strict'
  const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)')
  const mobileMQ = matchMedia('(max-width: 767px)')
  const B = document.body
  const q = s => document.querySelector(s)
  const mainEl = () => q('.app > .main')
  const contentEl = () => document.getElementById('content')
  const media = () => [q('#cn-canvas'), q('.td-scene')].filter(Boolean)
  const ID = { blur: 0, scale: 1, sat: 1, con: 1, bri: 1, bokeh: 0 }
  const DEFOCUS = { blur: 14, scale: 1, sat: .86, con: .94, bri: .78, bokeh: .8 }   // 跟 CSS body.cn-defocused 同一組值：半按快門，畫面稍暗、輕微失焦；scale 留在 1＝開場是原始尺寸，之後只往裡推
  const cur = Object.assign({}, ID)
  const easeOut = p => 1 - Math.pow(1 - p, 3)
  const easeIn = p => p * p * p
  const easeInOut = p => p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2
  let segs = [], raf = 0
  let phase = 'idle', level = 0, swapFn = null, swapAt = 0, endAt = 0, guardTimer = 0, fadeTimer = 0, introTimer = 0
  /* 一次性的開場運鏡（2026-09-04 第四版，他要的順序）：
       ① 0–0.9s   一進來就貼很近（1.6×）對著畫面最左邊，半按快門、失焦；
       ② 0.9–1.8s 掃到最右邊（山坡那側），還是近的、還是糊的——像鏡頭在找人；
       ③ 1.8–2.8s 往中間靠、同時拉遠到原始尺寸，整個人入鏡；
       ④ 2.8–3.3s 對焦框在頭部尋焦、鎖定（鏡頭停住）；
       ⑤ 3.3–4.6s 依框猛推到 1.3×（快進慢停，轉播那一下）；4.6–7.5s 再慢飄到 1.36× 停住。不縮回、不循環。
     整個頁面生命週期只演一次；深連結先進別的 view 時，等第一次顯示 TODAY 再演。
     取景中心＝origin 與 scale 一起算（origin 只在 scale>1 時有作用），關鍵格之間 easeInOut。 */
  const CAM = () => mobileMQ.matches
    ? [{ t: 0, s: 1.5, x: 20, y: 50 }, { t: 900, s: 1.5, x: 10, y: 48 }, { t: 1800, s: 1.4, x: 90, y: 44 }, { t: 2800, s: 1, x: 52, y: 42 }, { t: 3300, s: 1, x: 52, y: 42, ease: 'out' }, { t: 4600, s: 1.25, x: 52, y: 42 }, { t: 7500, s: 1.3, x: 52, y: 42 }]
    : [{ t: 0, s: 1.6, x: 0, y: 58 }, { t: 900, s: 1.55, x: 4, y: 56 }, { t: 1800, s: 1.45, x: 85, y: 52 }, { t: 2800, s: 1, x: 63, y: 52 }, { t: 3300, s: 1, x: 63, y: 52, ease: 'out' }, { t: 4600, s: 1.3, x: 63, y: 52 }, { t: 7500, s: 1.36, x: 63, y: 52 }]
  const LOCK_AT = 3300
  let push = CAM()[0].s, pushOx = CAM()[0].x, pushOy = CAM()[0].y, pushStart = 0, pushEnd = 0, pushDone = false
  function pushTick(now) {
    if (pushDone || !pushEnd) return false
    const K = CAM(), t = now - pushStart
    let a = K[0], b = K[K.length - 1]
    for (let i = 0; i < K.length - 1; i++) if (t >= K[i].t && t < K[i + 1].t) { a = K[i]; b = K[i + 1]; break }
    if (t >= b.t) { push = b.s; pushOx = b.x; pushOy = b.y; pushDone = true; return false }
    if (t < 0) { push = K[0].s; pushOx = K[0].x; pushOy = K[0].y; return true }
    const p = (t - a.t) / (b.t - a.t), e = a.ease === 'out' ? easeOut(p) : easeInOut(p)
    push = a.s + (b.s - a.s) * e; pushOx = a.x + (b.x - a.x) * e; pushOy = a.y + (b.y - a.y) * e
    return true
  }
  function pushFinal() { const K = CAM(), b = K[K.length - 1]; push = b.s; pushOx = b.x; pushOy = b.y; pushDone = true; pushEnd = 0; clearTimeout(lockTimer); clearTimeout(settleTimer); B.classList.add('cn-locked', 'cn-settled') }
  let lockTimer = 0, settleTimer = 0, pushArmed = false
  function armPush(delay) {      // 從「現在 + delay」開始跑整段關鍵格
    if (pushDone || pushArmed) return
    pushArmed = true
    const K = CAM(), t0 = performance.now(), total = K[K.length - 1].t
    pushStart = t0 + delay; pushEnd = pushStart + total
    clearTimeout(lockTimer); clearTimeout(settleTimer)
    lockTimer = setTimeout(() => B.classList.add('cn-locked'), delay + LOCK_AT)     // HUD 降到第二層
    settleTimer = setTimeout(() => B.classList.add('cn-settled'), delay + total)     // 推鏡停住，HUD 再淡一階
    if (!raf) raf = requestAnimationFrame(tick)
  }
  const armPushOnToday = () => {
    if (B.dataset.view === 'overview') { armPush(0); return }
    const once = e => { if (e.detail && e.detail.view === 'overview') { removeEventListener('strava:hub', once); armPush(0) } }
    addEventListener('strava:hub', once)
  }
  const isQuiet = () => reduceMQ.matches || !!(window.__cinemaFx && window.__cinemaFx.tier() === 'quiet')

  // scale 的中心：TODAY 是右側車手，其它 view 用場景照片的 focus 座標（沒有照片的場景取畫面中央偏上）
  const focusOrigin = () => {
    const fx = window.__cinemaFx, env = fx && fx.env
    const name = env && env.VIEW_ENV[B.dataset.view || 'overview'], ph = env && env.photos[name]
    const f = ph && ph.focus ? ph.focus : [.5, .45]
    return { canvas: `${Math.round(f[0] * 100)}% ${Math.round(f[1] * 100)}%`, hero: mobileMQ.matches ? '52% 42%' : '63% 52%' }
  }
  function apply() {
    const idle = cur.blur < .05 && Math.abs(cur.scale - 1) < .0005 && Math.abs(cur.sat - 1) < .003 && Math.abs(cur.con - 1) < .003 && Math.abs(cur.bri - 1) < .003
    const o = focusOrigin()
    const dof = window.__cinemaHero && window.__cinemaHero.ready()   // hero 有景深層時，它的 blur 由景深層負責，這裡只管色調與呼吸
    media().forEach(el => {
      const isHero = el.id !== 'cn-canvas'
      // hero：filter 套在 .td-scene（景深層在裡面，blur 交給它），運鏡 transform 只套在 .td-media（景深層不能跟著縮放）
      const tEl = isHero ? (el.querySelector('.td-media') || el) : el
      const heroOrigin = `${pushOx.toFixed(2)}% ${pushOy.toFixed(2)}%`
      const heroScale = (idle ? 1 : cur.scale) * push
      if (idle) {   // 對到焦就一個 filter 都不留；hero 只留運鏡的 transform
        el.style.filter = ''
        if (isHero && heroScale > 1.0005) { tEl.style.transformOrigin = heroOrigin; tEl.style.transform = `scale(${heroScale.toFixed(4)})` }
        else { tEl.style.transform = ''; tEl.style.transformOrigin = '' }
      } else {
        tEl.style.transformOrigin = isHero ? heroOrigin : o.canvas
        const blur = isHero && dof ? 0 : cur.blur
        el.style.filter = `blur(${blur.toFixed(2)}px) saturate(${cur.sat.toFixed(3)}) contrast(${cur.con.toFixed(3)}) brightness(${cur.bri.toFixed(3)})`
        tEl.style.transform = `scale(${(isHero ? heroScale : cur.scale).toFixed(4)})`
      }
      if (isHero && window.__cinemaHero && window.__cinemaHero.camera) window.__cinemaHero.camera(heroScale > 1.0005 ? heroScale : 1, pushOx, pushOy)
    })
    const fx = window.__cinemaFx
    if (fx && fx.setDefocus) fx.setDefocus(idle ? 0 : cur.bokeh)
  }
  function setProgram(list) {     // 新程式一律從當下的值接著走；時間軸是絕對時間，掉幀不會讓段落累積延遲
    let t = performance.now(), from = Object.assign({}, cur)
    segs = list.map(s => { const to = Object.assign({}, from, s.to); const seg = { start: t, end: t + s.dur, dur: s.dur, from, to, ease: s.ease || easeInOut }; t += s.dur; from = to; return seg })
    if (!raf) raf = requestAnimationFrame(tick)
  }
  function tick(now) {
    raf = 0
    const pushing = pushTick(now)
    if (segs.length) {
      while (segs.length > 1 && now >= segs[0].end) segs.shift()
      const s = segs[0], p = Math.min(1, (now - s.start) / s.dur), e = s.ease(p)
      Object.keys(ID).forEach(k => { cur[k] = s.from[k] + (s.to[k] - s.from[k]) * e })
      if (p >= 1) segs.shift()
      apply()
    } else if (pushing || (pushDone && pushEnd)) { apply(); if (pushDone) pushEnd = 0 }
    if (phase === 'out' && now >= swapAt) doSwap(now)
    if (phase === 'in' && now >= endAt) settle()
    if (segs.length || phase !== 'idle' || pushing) raf = requestAnimationFrame(tick)
  }
  const run = f => { try { f && f() } catch (e) { console.error('[cinema] lens swap failed', e) } }
  function startOut(lvl) {
    const main = mainEl(), content = contentEl()
    if (lvl === 2) {
      if (main) { main.style.transition = 'opacity .1s ease-in'; main.style.opacity = '0' }
      setProgram([{ dur: 110, to: { blur: 5, scale: 1.006, sat: .96, con: .98, bri: 1, bokeh: .15 }, ease: easeIn }])
    } else if (content) { content.style.transition = 'opacity .09s ease-in'; content.style.opacity = '0' }
  }
  function doSwap(now) {
    const f = swapFn; swapFn = null
    B.dataset.lens = String(level)          // 動效層看這個決定要不要接手區塊 stagger
    run(f)
    phase = 'in'
    const main = mainEl(), content = contentEl()
    if (level === 2) {
      if (main) { main.style.transition = 'opacity .16s ease-out'; main.style.opacity = '' }
      B.classList.add('cn-in2')
      setProgram([{ dur: 420, to: ID, ease: easeOut }])
      endAt = now + 470
      if (B.dataset.view === 'overview' && window.__cinemaHero) window.__cinemaHero.arrive()   // 回到 TODAY：hero 也短暫重新尋焦
    } else {
      if (content) { content.style.transition = ''; content.style.opacity = '' }
      B.classList.add('cn-in3')
      endAt = now + 230
    }
  }
  function settle() {
    phase = 'idle'; level = 0
    const main = mainEl(), content = contentEl()
    if (main) { main.style.transition = ''; main.style.opacity = '' }
    if (content) { content.style.transition = ''; content.style.opacity = '' }
    B.classList.remove('cn-in2', 'cn-in3', 'cn-focus')
    delete B.dataset.lens
    clearTimeout(guardTimer)
  }
  function finish() {     // 保險：分頁隱藏、或 rAF 停了 —— 立刻換頁、鏡頭歸零、全部清乾淨
    const f = swapFn; swapFn = null
    if (f) { B.dataset.lens = String(level || 2); run(f) }
    segs = []; Object.assign(cur, ID)
    if (pushEnd) pushFinal()
    apply()
    B.classList.remove('cn-defocused')
    settle()
    if (raf) cancelAnimationFrame(raf); raf = 0
  }
  const armGuard = () => { clearTimeout(guardTimer); guardTimer = setTimeout(() => { if (phase !== 'idle' || segs.length) finish() }, 5000) }

  function goFade(o) {      // reduced motion：120ms 淡出淡入，鏡頭不動
    const main = mainEl(), lvl = o.level === 3 ? 3 : 2
    swapFn = o.swap
    if (!main) { const f = swapFn; swapFn = null; run(f); return }
    clearTimeout(fadeTimer)
    main.style.transition = 'opacity .06s linear'; main.style.opacity = '0'
    fadeTimer = setTimeout(() => {
      const f = swapFn; swapFn = null
      B.dataset.lens = String(lvl); run(f); delete B.dataset.lens
      main.style.opacity = ''
      fadeTimer = setTimeout(() => { main.style.transition = '' }, 90)
    }, 70)
  }
  function go(o) {
    o = o || {}
    const lvl = o.level === 3 ? 3 : 2
    if (reduceMQ.matches) return goFade(o)
    if (document.hidden) { B.dataset.lens = String(lvl); run(o.swap); delete B.dataset.lens; return }
    const now = performance.now()
    swapFn = o.swap
    if (phase === 'out') {    // 還沒換頁：只換目標；子頁升級成跨 hub 就把整個 .main 一起淡出
      if (lvl === 2 && level !== 2) { level = 2; startOut(2); swapAt = Math.max(swapAt, now + 70) }
      return
    }
    // idle 或正在淡入：從當下的狀態重新淡出（CSS transition 會從目前的 opacity 接著走）
    B.classList.remove('cn-in2', 'cn-in3', 'cn-focus'); delete B.dataset.lens
    if (window.__cinemaHero) window.__cinemaHero.reset()
    level = lvl
    startOut(lvl)
    swapAt = now + (lvl === 2 ? 110 : 90)
    phase = 'out'
    armGuard()
    if (!raf) raf = requestAnimationFrame(tick)
  }
  function intro(swap) {      // 首次進站：完整的電影式自動對焦
    clearTimeout(introTimer)
    if (isQuiet() || document.hidden) {
      B.classList.remove('cn-defocused')
      pushFinal(); apply()     // reduced-motion／QUIET：直接停在鎖定後的最終構圖
      B.classList.add('cn-locked', 'cn-settled')
      const main = mainEl()
      run(swap)
      if (main && !document.hidden) {
        main.style.transition = 'none'; main.style.opacity = '0'; void main.offsetWidth
        main.style.transition = 'opacity .12s ease-out'; main.style.opacity = ''
        setTimeout(() => { main.style.transition = '' }, 160)
      }
      return
    }
    Object.assign(cur, DEFOCUS)     // CSS 已經把場景層定在這組值；先接手成 inline 再拿掉 class，沒有任何一幀是清晰的
    B.dataset.lens = '1'
    B.classList.add('cn-focus')
    run(swap)
    apply(); B.classList.remove('cn-defocused')
    // 半按快門到鎖定（跟 hero 景深層的焦距程式同一條時間軸）：
    // 0–500 畫面稍暗、輕微失焦（曝光資訊淡淡地在）→ 500–1200 光圈張開：亮度與景深一起回來
    // → 1200–1700 對焦框在車手頭部搜尋、鎖定 → 1700–8000 極慢的 tracking push-in（只推這一次）
    const t0 = performance.now()
    Object.assign(cur, { blur: 14, scale: 1, sat: .86, con: .94, bri: .78, bokeh: .8 })
    apply()
    // 0–500 暗、失焦（鏡頭貼很近）→ 500–2200 光圈張開、拉遠到全景 → 2200–2700 尋焦、鎖定 → 之後依框推近（關鍵格在 CAM）
    setProgram([
      { dur: 900,  to: { blur: 12, scale: 1, sat: .86, con: .94, bri: .8, bokeh: .8 }, ease: easeInOut },     // 貼左
      { dur: 900,  to: { blur: 8, scale: 1, sat: .9, con: .96, bri: .9, bokeh: .6 }, ease: easeInOut },       // 掃到右
      { dur: 1000, to: { blur: 3, scale: 1, sat: .95, con: .98, bri: 1.02, bokeh: .3 }, ease: easeInOut },    // 往中間靠、拉遠
      { dur: 260,  to: { blur: 1.6, scale: 1, sat: .97, con: .99, bri: 1, bokeh: .12 }, ease: easeInOut },
      { dur: 120,  to: { blur: 2.4 }, ease: easeInOut },
      { dur: 120,  to: { blur: 0, scale: 1, sat: 1.02, con: 1.02, bri: 1, bokeh: 0 }, ease: easeOut },
      { dur: 140,  to: ID, ease: easeInOut },
    ])
    if (window.__cinemaHero) window.__cinemaHero.intro()
    armPushOnToday()
    phase = 'in'; level = 1; endAt = t0 + 3500
    armGuard()
  }
  /* 換底片：約 250ms 的微型光圈閉合 → 換色 → 張開。不黑屏、不重播開場；reduced-motion 直接換。 */
  let irisTimer = 0
  function iris(fn) {
    if (isQuiet() || document.hidden || phase !== 'idle') { run(fn); return }
    clearTimeout(irisTimer)
    setProgram([
      { dur: 120, to: { blur: 1.5, scale: 1.004, sat: .9, con: .96, bri: .62, bokeh: .1 }, ease: easeIn },
      { dur: 130, to: ID, ease: easeOut },
    ])
    irisTimer = setTimeout(() => run(fn), 120)
  }
  // 載入就失焦（資料到了 navTo 會呼叫 intro）；資料一直不來也不能永遠糊著
  if (!reduceMQ.matches && !document.hidden) {
    B.classList.add('cn-defocused')
    introTimer = setTimeout(() => { if (B.classList.contains('cn-defocused')) { Object.assign(cur, DEFOCUS); apply(); B.classList.remove('cn-defocused'); setProgram([{ dur: 900, to: ID, ease: easeOut }]) } }, 9000)
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden && (phase !== 'idle' || segs.length || B.classList.contains('cn-defocused'))) finish() })
  window.__cinemaLens = { go, intro, finish, iris, active: () => phase !== 'idle', level: () => level, push: () => push, pushDone: () => pushDone, cam: () => ({ s: push, x: pushOx, y: pushOy }) }
})()

/* ══ Hero 鏡頭：景深、對焦框、點對焦（TODAY 的影片）═══════════════════════════
   影片是平的，沒有深度資料，所以先替這支構圖畫一張 192×108 的深度圖（每個像素一個 1/距離）：
   天空 ∞、遠山與雲海 600 m、右側山坡 40 m、車手 6 m、路面依透視平面連續（落地點 6 m → 下緣 3 m）、
   兩側芒草 2–2.5 m，邊界全部柔邊。模糊量用薄透鏡公式 CoC = A·|1/d − 1/f|（A = 60 px·m，上限 22px）。
   畫面上只有三層 backdrop-filter（4／9／20px）疊在影片上，每個像素依它的 CoC 把三個檔位按比例混合：
   遮罩＝從深度圖算出來的 alpha 圖（每個焦距一組，算過就快取），逐幀換 mask-image。影片本身不碰。
   景深層放在 .td-scene 裡：跟影片一起呼吸（scale），backdrop 也只取影片本身。
   富士對焦框：DOM 元素，1.5px 白線加暗邊、直角、瞬間出現不縮放；尋焦白、合焦綠停 800ms 淡出。
   首次進站（intro）：焦距 0.5 m（全糊）→ ∞（遠景先對到）→ 6 m（車手）→ hunt → 鎖定，框在車手身上。
   點對焦：輕點影片區（面板以外；手指滑動仍是捲頁）→ 讀該點深度 → 焦距滑過去、小 hunt、框在點的位置。
   reduced-motion：不做景深，只有框（瞬間白→綠→淡出）。 */
;(function () {
  'use strict'
  const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)')
  const mobileMQ = matchMedia('(max-width: 767px)')
  const DW = 192, DH = 108, CMAX = 22, STEPS = 64, INF = 1e-4, U_RIDER = 1 / 6
  // A ＝ 光圈：CoC = A·|1/d − 1/f|（px·m）。F2.0 最淺、F8 幾乎全清楚；由 __cinemaLook 依 LENS 選項設定
  const APERTURE_A = { '2': 60, '2.8': 38, '5.6': 16, '8': 6 }   // headless 實測：60 已經是「背景全化開」的上限，F2.8 要留得住路面
  let A = 38
  const RIDER = { x: .63, y: .56 }, RIDER_AF = { x: .635, y: .42 }   // 橢圓中心／對焦框（臉）
  const easeOut = p => 1 - Math.pow(1 - p, 3)
  const easeInOut = p => p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2
  const sm = (a, b, t) => { t = Math.max(0, Math.min(1, (t - a) / (b - a))); return t * t * (3 - 2 * t) }
  let hero = null, scene = null, dof = null, layers = [], af = null, depth = null
  let uCur = 2, segs = [], raf = 0, lastK = -1, afTimer = 0, mode = 'auto', armed = false
  const cache = new Map()
  const mcv = document.createElement('canvas'); mcv.width = DW; mcv.height = DH
  const mctx = mcv.getContext('2d')

  function buildDepth() {
    const d = new Float32Array(DW * DH), yh = .46
    for (let j = 0; j < DH; j++) for (let i = 0; i < DW; i++) {
      const x = (i + .5) / DW, y = (j + .5) / DH
      let u = y <= yh ? INF : y <= .9 ? INF + (U_RIDER - INF) * (y - yh) / (.9 - yh) : U_RIDER + (1 / 3 - U_RIDER) * (y - .9) / .1
      const mix = (uu, w) => { u = u + (uu - u) * w }
      mix(1 / 600, sm(.28, .34, y) * (1 - sm(.47, .53, y)) * (1 - sm(.70, .80, x)))          // 遠山與雲海
      const xb = .62 + .21 * Math.min(1, y / .55)                                              // 右側山坡的左緣：從上方往右下斜
      mix(1 / 40, sm(xb - .03, xb + .03, x) * (1 - sm(.56, .64, y)))                          // 右側山坡與護欄
      mix(1 / 2.2, sm(.90, .95, x) * sm(.33, .40, y) * (1 - sm(.82, .90, y)))                 // 右緣芒草（近）
      mix(1 / 2.5, (1 - sm(.08, .14, x)) * sm(.72, .80, y))                                   // 左下角路緣（近）
      const e = ((x - RIDER.x) / .075) ** 2 + ((y - RIDER.y) / .30) ** 2
      mix(U_RIDER, 1 - sm(.85, 1.15, e))                                                      // 車手：橢圓，邊緣羽化
      d[j * DW + i] = u
    }
    return d
  }
  const stepU = k => k >= STEPS ? 2 : k / (STEPS - 1)
  const stepOf = u => u >= 1.5 ? STEPS : Math.round(Math.max(0, Math.min(1, u)) * (STEPS - 1))
  function masks(k) {
    const key = A + ':' + k
    if (cache.has(key)) return cache.get(key)
    const uf = stepU(k), bufs = [0, 1, 2].map(() => new Uint8ClampedArray(DW * DH * 4))
    for (let p = 0; p < DW * DH; p++) {
      const c = Math.min(CMAX, A * Math.abs(depth[p] - uf)), o = p * 4 + 3
      bufs[0][o] = Math.round(Math.min(1, c / 4) * 255)
      bufs[1][o] = Math.round(Math.min(1, Math.max(0, (c - 4) / 5)) * 255)
      bufs[2][o] = Math.round(Math.min(1, Math.max(0, (c - 9) / 11)) * 255)
    }
    const urls = bufs.map(b => { mctx.putImageData(new ImageData(b, DW, DH), 0, 0); return `url(${mcv.toDataURL('image/png')})` })
    if (cache.size > 160) cache.clear()
    cache.set(key, urls); return urls
  }
  function applyU(u) {
    uCur = u
    if (!layers.length) return
    const k = stepOf(u)
    if (k === lastK) return
    lastK = k
    const m = masks(k)
    layers.forEach((el, i) => { el.style.webkitMaskImage = m[i]; el.style.maskImage = m[i] })
    updateScale(u)
  }
  // 顯示中的影片矩形（object-fit:cover 之後）：用 layout 尺寸，不受 .td-scene 的 scale 影響
  let laidOut = false, geom = null, afPos = { x: RIDER_AF.x, y: RIDER_AF.y }
  // 運鏡狀態（__cinemaLens 每幀餵進來）：.td-media 以 (x%,y%) 為中心放大 s 倍；景深層與框留在原地，靠這組值對位
  const cam = { s: 1, x: 63, y: 52 }
  const camRect = () => {     // 顯示中的影片矩形經過運鏡之後的位置（相對 .td-dof）
    const Ox = cam.x / 100 * geom.W, Oy = cam.y / 100 * geom.H
    return { x: Ox + (geom.ox - Ox) * cam.s, y: Oy + (geom.oy - Oy) * cam.s, w: geom.dw * cam.s, h: geom.dh * cam.s }
  }
  function placeMedia() {
    if (!geom) return
    const r = camRect(), ms = `${r.w.toFixed(1)}px ${r.h.toFixed(1)}px`, mp = `${r.x.toFixed(1)}px ${r.y.toFixed(1)}px`
    layers.forEach(l => { l.style.webkitMaskSize = ms; l.style.maskSize = ms; l.style.webkitMaskPosition = mp; l.style.maskPosition = mp })
    placePeak(); positionAf()
  }
  function camera(s, x, y) {
    if (cam.s === s && cam.x === x && cam.y === y) return
    cam.s = s; cam.x = x; cam.y = y
    if (laidOut || layout()) placeMedia()
  }
  // .td-dof ＝ 可見的影片框（.td-still 的盒子），不伸出畫面：backdrop-filter 的元素伸出視窗外時 Chrome 會把採樣到的背景畫偏（手機會多出一個鬼影）。
  // 顯示中的影片矩形（object-fit:cover 之後，可能比框大、偏移）用 mask-size／mask-position 對齊，框與峰值也照同一組幾何算。
  function layout() {
    if (!hero || !dof) return false
    const still = hero.querySelector('.td-still'), v = hero.querySelector('.td-video')
    if (!still) return false
    const W = still.offsetWidth, H = still.offsetHeight
    if (!W || !H) { laidOut = false; return false }     // view 還是 display:none（mount 時 TODAY 尚未顯示）：用到的時候再量
    const sc = Math.max(W / 1280, H / 720), dw = 1280 * sc, dh = 720 * sc
    const pos = (v ? getComputedStyle(v).objectPosition : '50% 50%').split(' ').map(parseFloat)
    const px = (isNaN(pos[0]) ? 50 : pos[0]) / 100, py = (isNaN(pos[1]) ? 50 : pos[1]) / 100
    geom = { W, H, dw, dh, ox: (W - dw) * px, oy: (H - dh) * py }
    dof.style.left = '0px'; dof.style.top = '0px'; dof.style.width = W + 'px'; dof.style.height = H + 'px'
    laidOut = true
    placeMedia()
    return true
  }
  const ensureLayout = () => laidOut || layout()
  function positionAf() {
    if (!af || !geom) return
    const r = camRect(), sz = r.h * (mobileMQ.matches ? .12 : .09)
    af.style.width = sz + 'px'; af.style.height = sz + 'px'
    af.style.left = (r.x + afPos.x * r.w) + 'px'; af.style.top = (r.y + afPos.y * r.h) + 'px'
  }
  function placePeak() {
    if (!peak || !geom) return
    const r = camRect()
    peak.style.left = r.x + 'px'; peak.style.top = r.y + 'px'; peak.style.width = r.w + 'px'; peak.style.height = r.h + 'px'
  }
  function setProgram(list) {
    let t = performance.now(), from = uCur
    segs = list.map(s => { const seg = { start: t, end: t + s.dur, dur: s.dur, from, to: s.to, ease: s.ease || easeInOut, done: s.done }; t += s.dur; from = s.to; return seg })
    if (!raf) raf = requestAnimationFrame(tick)
  }
  function tick(now) {
    raf = 0
    while (segs.length > 1 && now >= segs[0].end) { const d = segs.shift(); if (d.done) d.done() }
    if (!segs.length) return
    const s = segs[0], p = Math.min(1, (now - s.start) / s.dur)
    applyU(s.from + (s.to - s.from) * s.ease(p))
    if (p >= 1) { segs.shift(); if (s.done) s.done() }
    if (segs.length) raf = requestAnimationFrame(tick)
  }
  const stop = () => { segs = []; if (raf) cancelAnimationFrame(raf); raf = 0 }
  // 對焦框
  function showAf(x, y) {
    if (!af) return
    clearTimeout(afTimer)
    afPos = { x, y }; positionAf()
    af.classList.remove('is-lock', 'is-out'); af.classList.add('is-on')
  }
  function lockAf() {
    if (!af || !af.classList.contains('is-on')) return
    af.classList.add('is-lock')
    clearTimeout(afTimer)
    afTimer = setTimeout(() => { af.classList.add('is-out'); afTimer = setTimeout(hideAf, 320) }, 800)
  }
  function hideAf() { if (!af) return; clearTimeout(afTimer); af.classList.remove('is-on', 'is-lock', 'is-out') }
  // 尋焦到 uT：越過一點再回來（hunt），到了鎖框
  function rackTo(uT, opts) {
    opts = opts || {}
    const d = uT - uCur, dist = Math.abs(d)
    if (dist < .015) { setProgram([{ dur: 200, to: uT, ease: easeOut, done: lockAf }]); return }
    const over = Math.sign(d) * Math.min(.035, dist * .25)
    const clampU = v => Math.max(0, Math.min(1, v))     // 鏡頭到 ∞ 就是硬點，不會越過去
    setProgram([
      { dur: opts.dur || 320, to: clampU(uT + over), ease: easeInOut },
      { dur: 110, to: clampU(uT - over * .5), ease: easeInOut },
      { dur: 70, to: uT, ease: easeOut, done: opts.noLock ? null : lockAf },
    ])
  }
  function intro() {
    if (!armed || reduceMQ.matches) return
    ensureLayout()
    mode = 'auto'; hideAf()
    applyU(2)
    // 跟鏡頭層同一條時間軸：0–500 還沒對到（畫面偏暗）→ 500–1200 光圈張開、遠景先對到 → 1200–1700 框在車手頭部尋焦、鎖定
    setProgram([
      { dur: 900,  to: 1.4, ease: easeInOut },                                                  // 貼左：還沒對到
      { dur: 900,  to: 1.0, ease: easeInOut },                                                  // 掃到右
      { dur: 1000, to: .02, ease: easeInOut, done: () => showAf(RIDER_AF.x - .012, RIDER_AF.y + .01) },  // 往中間靠、拉遠；到全景時框出現在頭部附近開始搜尋
      { dur: 260, to: U_RIDER + .05, ease: easeInOut, done: () => showAf(RIDER_AF.x + .008, RIDER_AF.y - .006) },   // 拉到車手，框微調
      { dur: 120, to: U_RIDER - .025, ease: easeInOut, done: () => showAf(RIDER_AF.x, RIDER_AF.y) },   // hunt
      { dur: 120, to: U_RIDER, ease: easeOut, done: lockAf },                                   // 1700：鎖定，框亮綠一下
    ])
  }
  function arrive() {   // 跨 hub 回到 TODAY：短暫重新尋焦，不顯示框
    if (!armed || reduceMQ.matches) return
    ensureLayout()
    mode = 'auto'; hideAf(); stop()
    applyU(1 / 12)
    setProgram([{ dur: 420, to: U_RIDER, ease: easeOut }])
  }
  function reset() { if (!armed) return; stop(); hideAf(); mode = 'auto'; peakOff(0); if (mf) mf.classList.remove('is-on'); applyU(U_RIDER) }
  // 點對焦：輕點（沒有拖、沒有捲）才算；面板、簽名、距離尺上的點擊不算
  function bindTap() {
    let sx = 0, sy = 0, st = 0, id = null
    const panel = hero.querySelector('.td-panel')
    hero.addEventListener('pointerdown', e => {
      if (e.button !== 0 && e.pointerType === 'mouse') return
      // 面板「內容」上的點擊不算（手機的面板用 padding 蓋在影片上，padding 本身仍算影片區）
      const t = e.target
      if (t.closest('.td-sign,.td-mf,button,a') || (t !== panel && t.closest('.td-panel'))) { id = null; return }
      id = e.pointerId; sx = e.clientX; sy = e.clientY; st = performance.now()
    })
    hero.addEventListener('pointerup', e => {
      if (id !== e.pointerId) return
      id = null
      if (Math.hypot(e.clientX - sx, e.clientY - sy) > 8 || performance.now() - st > 450) return
      focusAt(e.clientX, e.clientY)
    })
    hero.addEventListener('pointercancel', () => { id = null })
  }
  function focusAt(cx, cy) {
    if (!dof || !ensureLayout()) return
    const r = dof.getBoundingClientRect()
    if (!r.width || !r.height || !geom) return
    const k = r.width / geom.W, c = camRect()     // .td-dof 本身不縮放（k≈1）；影片的位置由運鏡決定
    const fx = ((cx - r.left) / k - c.x) / c.w, fy = ((cy - r.top) / k - c.y) / c.h
    if (!(fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1)) return
    mode = 'auto'; peakOff(0)
    showAf(fx, fy)
    if (reduceMQ.matches || !layers.length) { lockAf(); return }     // 沒有景深層（reduced-motion／手機）：只有框
    const uT = depth[Math.min(DH - 1, Math.floor(fy * DH)) * DW + Math.min(DW - 1, Math.floor(fx * DW))]
    stop(); rackTo(uT)
  }
  /* ── 距離尺（富士手動對焦尺）：1 m 在左、∞ 在右，刻度非線性（線性在 1/d）；白線＝目前焦距，藍帶＝景深
     （可接受模糊 2px，帶寬固定在 1/d 空間，換算成公尺就是越遠越寬）。游標進入／手指碰到影片區才淡入，
     2.5 秒沒動作淡出；拖白線＝手動拉焦（框消失、峰值出現），放開停在原地，再輕點影片就回到 AF。 ── */
  let mf = null, mfInd = null, mfBand = null, mfTimer = 0, dragging = false
  const TICKS = [[1, '1'], [1.5, '1.5'], [2, '2'], [3, '3'], [5, '5'], [10, '10'], [0, '∞']]
  const xOf = u => (1 - Math.max(0, Math.min(1, u))) * 100
  function buildScale() {
    mf = document.createElement('div'); mf.className = 'td-mf'; mf.setAttribute('aria-hidden', 'true')
    mf.innerHTML = `<i class="td-mf-line"></i>${TICKS.map(([d, l]) => `<i class="td-mf-t" style="left:${xOf(d ? 1 / d : 0).toFixed(2)}%"><b>${l}</b></i>`).join('')}<i class="td-mf-band"></i><i class="td-mf-ind"></i><em class="td-mf-unit">m</em>`
    hero.appendChild(mf)
    mfInd = mf.querySelector('.td-mf-ind'); mfBand = mf.querySelector('.td-mf-band')
    const panelEl = hero.querySelector('.td-panel')
    const sleepOut = ms => { clearTimeout(mfTimer); mfTimer = setTimeout(() => { if (!dragging) mf.classList.remove('is-on') }, ms) }
    const wake = () => { mf.classList.add('is-on'); sleepOut(2500) }
    hero.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' && !(e.target !== panelEl && e.target.closest('.td-panel'))) wake() }, { passive: true })
    hero.addEventListener('pointerdown', e => { if (e.target === panelEl || !e.target.closest('.td-panel')) wake() }, { passive: true })
    hero.addEventListener('pointerleave', () => sleepOut(300))
    mf.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation()
      dragging = true; mf.classList.add('is-on', 'is-drag')
      try { mf.setPointerCapture(e.pointerId) } catch (x) {}
      manualAt(e.clientX)
    })
    mf.addEventListener('pointermove', e => { if (dragging) manualAt(e.clientX) })
    const end = e => { if (!dragging) return; dragging = false; mf.classList.remove('is-drag'); try { mf.releasePointerCapture(e.pointerId) } catch (x) {} ; peakOff(600); wake() }
    mf.addEventListener('pointerup', end); mf.addEventListener('pointercancel', end)
    updateScale(uCur)
  }
  function manualAt(cx) {
    const r = mf.getBoundingClientRect()
    if (!r.width) return
    const u = 1 - Math.max(0, Math.min(1, (cx - r.left) / r.width))
    if (mode !== 'manual') { stop(); hideAf(); mode = 'manual' }
    applyU(u); peakOn()
  }
  function updateScale(u) {
    if (!mfInd) return
    const x = xOf(u), half = 2 / A * 100
    mfInd.style.left = x + '%'
    const lo = Math.max(0, x - half), hi = Math.min(100, x + half)
    mfBand.style.left = lo + '%'; mfBand.style.width = (hi - lo) + '%'
  }

  /* ── 峰值（富士 MF 輔助）：手動拉焦期間把影片縮成 480×270 抽邊緣（Sobel），只描在對到焦的深度帶裡，
     畫在景深層上面的一張小 canvas，放開 600ms 後淡出。影片不同源時 canvas 會被污染，這裡安靜地關掉。 ── */
  const PW = 640, PH = 360
  let peak = null, pctx = null, pcv = null, poctx = null, peakRaf = 0, peakLast = 0, peakOffTimer = 0, peakActive = false, posterImg = null, peakDead = false, depthIdx = null
  function peakSource() {
    const v = hero.querySelector('.td-video')
    if (v && !hero.classList.contains('is-poster') && v.readyState >= 2) return v
    if (!posterImg) { posterImg = new Image(); posterImg.src = (v && v.getAttribute('poster')) || '' }
    return posterImg.complete && posterImg.naturalWidth ? posterImg : null
  }
  /* 峰值關掉（2026-09-04）：640×360 的 Sobel 邊緣放大到全幅之後是一圈白色像素描邊，拖距離尺時整個車手像被打成點陣——
     跟「不要像素格、不要馬賽克」的原則相反，也不是相機觀景窗最有魅力的那幾個訊號。程式留著，要回來把 PEAK 改 true。 */
  const PEAK = false
  function peakOn() {
    if (!PEAK || peakDead || reduceMQ.matches || !dof || !layers.length) return
    if (!peak) {
      peak = document.createElement('canvas'); peak.className = 'td-peak'; peak.width = PW; peak.height = PH; dof.appendChild(peak); pctx = peak.getContext('2d'); placePeak()
      pcv = document.createElement('canvas'); pcv.width = PW; pcv.height = PH; poctx = pcv.getContext('2d', { willReadFrequently: true })
      depthIdx = new Int32Array(PW * PH)
      for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) depthIdx[y * PW + x] = Math.min(DH - 1, Math.floor(y / PH * DH)) * DW + Math.min(DW - 1, Math.floor(x / PW * DW))
    }
    clearTimeout(peakOffTimer); peakActive = true; peak.classList.add('is-on')
    if (!peakRaf) peakRaf = requestAnimationFrame(peakFrame)
  }
  function peakOff(delay) { clearTimeout(peakOffTimer); peakOffTimer = setTimeout(() => { peakActive = false; if (peak) peak.classList.remove('is-on') }, delay || 0) }
  function peakFrame(now) {
    peakRaf = 0
    if (!peakActive) { if (pctx) pctx.clearRect(0, 0, PW, PH); return }
    if (now - peakLast >= 33) { peakLast = now; drawPeak() }
    peakRaf = requestAnimationFrame(peakFrame)
  }
  function drawPeak() {
    const src = peakSource(); if (!src) return
    let img
    try { poctx.drawImage(src, 0, 0, PW, PH); img = poctx.getImageData(0, 0, PW, PH) } catch (e) { peakDead = true; peakActive = false; if (peak) peak.classList.remove('is-on'); return }
    const d = img.data, N = PW * PH, g = new Float32Array(N), mag = new Float32Array(N), hor = new Uint8Array(N)
    for (let p = 0, o = 0; p < N; p++, o += 4) g[p] = d[o] * .299 + d[o + 1] * .587 + d[o + 2] * .114
    for (let y = 1; y < PH - 1; y++) for (let x = 1; x < PW - 1; x++) {
      const p = y * PW + x
      const gx = -g[p - PW - 1] - 2 * g[p - 1] - g[p + PW - 1] + g[p - PW + 1] + 2 * g[p + 1] + g[p + PW + 1]
      const gy = -g[p - PW - 1] - 2 * g[p - PW] - g[p - PW + 1] + g[p + PW - 1] + 2 * g[p + PW] + g[p + PW + 1]
      mag[p] = Math.abs(gx) + Math.abs(gy); hor[p] = Math.abs(gx) >= Math.abs(gy) ? 1 : 0
    }
    const out = pctx.createImageData(PW, PH), od = out.data, T = 60, tol = 3 / A     // 3px 以內算對到焦
    for (let y = 1; y < PH - 1; y++) for (let x = 1; x < PW - 1; x++) {
      const p = y * PW + x, m = mag[p]
      if (m < T || Math.abs(depth[depthIdx[p]] - uCur) > tol) continue
      const a = hor[p] ? mag[p - 1] : mag[p - PW], b = hor[p] ? mag[p + 1] : mag[p + PW]
      if (m < a || m < b) continue          // 非極大值抑制：只留一像素寬的脊線，放大後不會變成色塊
      const o = p * 4; od[o] = 255; od[o + 1] = 255; od[o + 2] = 255; od[o + 3] = Math.min(230, (m - T) * 2 + 70)
    }
    pctx.putImageData(out, 0, 0)
  }

  function mount(el) {
    if (!el || el === hero) return
    hero = el; scene = el.querySelector('.td-scene')
    if (!scene) return
    if (!depth) depth = buildDepth()
    dof = document.createElement('div'); dof.className = 'td-dof'; dof.setAttribute('aria-hidden', 'true')
    layers = []
    /* 手機（≤767px）不做景深層也不做距離尺／峰值（2026-09-04）：
       三層 backdrop-filter 疊在播放中的影片上，在手機是最貴的一組東西；而且 192×108 的遮罩鋪到 cover 裁切後的畫面，
       在 2× DPR 下每個遮罩像素 ~4.5px，車手邊緣會有一圈光暈，加上 Chrome 對伸出視窗的 backdrop 元素會採樣偏移，
       就是之前看到的「手機景深怪怪」。影片本身有真實景深，手機只留影片、對焦框、HUD。
       距離尺在手機上沒有常駐的可見形態，只能靠誤觸摸到，乾脆不建。 */
    const lite = reduceMQ.matches || mobileMQ.matches
    if (!lite) [1, 2, 3].forEach(n => { const l = document.createElement('div'); l.className = 'td-dof-l l' + n; dof.appendChild(l); layers.push(l) })
    af = document.createElement('div'); af.className = 'td-af'; dof.appendChild(af)
    scene.appendChild(dof)
    if (!lite) buildScale()
    layout()
    lastK = -1
    applyU(reduceMQ.matches ? U_RIDER : (document.body.classList.contains('cn-defocused') ? 2 : U_RIDER))
    bindTap()
    armed = true
    const L = window.__cinemaLens; if (L && L.cam) { const c = L.cam(); camera(c.s, c.x, c.y) }
  }
  addEventListener('resize', () => { laidOut = false; layout() })
  addEventListener('strava:hub', e => { if (e.detail && e.detail.view === 'overview') requestAnimationFrame(() => layout()) })   // TODAY 顯示出來那一刻重量一次
  function setAperture(f) {      // 換光圈：遮罩全部重算（快取依 A 分開），焦距不動
    const a = APERTURE_A[String(f)] || 60
    if (a === A) return
    A = a; lastK = -1
    if (layers.length) applyU(uCur)
    else updateScale(uCur)
  }
  window.__cinemaHero = { mount, intro, arrive, reset, focusAt, setAperture, camera, aperture: () => A, ready: () => armed && layers.length > 0, u: () => uCur, mode: () => mode, peaking: () => peakActive }
  const existing = document.querySelector('.td-hero')
  if (existing) mount(existing)
})()

/* ══ 外觀：底片模擬（FILM SIMULATION）、光圈（LENS）、FX 面板 ═══════════════════════════
   富士觀景窗借來的三個訊號，全部只作用在媒體層（#cinema 的照片／canvas、TODAY hero 的影片與 canvas）：
   UI、文字、數字、圖表永遠不進濾鏡（CSS 選擇器就只指到那幾個元素，見 theme-strava-cinema.css「底片與光圈」）。
   · FILM：AUTO 依 hub（TODAY ETERNA／RIDE CC／TRAIN·REVIEW STD／ALL CN）；STD 中性、CC 低飽和暖高光、
     ETERNA 柔和低對比、CN 冷陰影暖主體、ACROS 黑白（只在使用者主動選）。第一版沒有高飽和檔。
   · LENS：AUTO 依 hub（TODAY·RIDE F2.8／TRAIN·REVIEW F5.6／ALL F8）；hero 的景深層改 CoC 係數、
     環境層依深度分開糊、光點依光圈放大或收斂。
   · 換檔走 __cinemaLens.iris：約 250ms 的微型光圈閉合→換色→張開，不黑屏、不重播開場。
   · 選項存 localStorage（cinema-film／cinema-lens），AUTO 就是把鍵刪掉。
   面板：桌機掛在頂列 FX 鈕下方（≤360px）、手機是底部 sheet（鈕 ≥44px）；點外側、Esc、關閉鈕都收起。 */
;(function () {
  'use strict'
  const B = document.body
  const FILMS = [
    { id: 'auto',   label: 'AUTO',   zh: '依畫面' },
    { id: 'std',    label: 'STD',    zh: '中性' },
    { id: 'cc',     label: 'CC',     zh: '紀實' },
    { id: 'eterna', label: 'ETERNA', zh: '電影' },
    { id: 'cn',     label: 'CN',     zh: '冷暖' },
    { id: 'acros',  label: 'ACROS',  zh: '黑白' },
  ]
  const LENSES = [
    { id: 'auto', label: 'AUTO', zh: '依畫面' },
    { id: '2',    label: 'F2.0', zh: '最淺' },
    { id: '2.8',  label: 'F2.8', zh: '預設' },
    { id: '5.6',  label: 'F5.6', zh: '閱讀' },
    { id: '8',    label: 'F8',   zh: '全清楚' },
  ]
  const TIERS = [
    { id: 'overdrive', label: 'OVERDRIVE', zh: '全部' },
    { id: 'active',    label: 'ACTIVE',    zh: '省電' },
    { id: 'quiet',     label: 'QUIET',     zh: '靜態' },
  ]
  const AUTO_FILM = { today: 'eterna', train: 'std', ride: 'cc', review: 'std', all: 'cn' }
  const AUTO_LENS = { today: '2.8', ride: '2.8', train: '5.6', review: '5.6', all: '8' }
  const LS_FILM = 'cinema-film', LS_LENS = 'cinema-lens'
  const FILM_IDS = FILMS.map(f => f.id), LENS_IDS = LENSES.map(l => l.id)
  let userFilm = 'auto', userLens = 'auto'
  try {
    const f = localStorage.getItem(LS_FILM); if (FILM_IDS.includes(f)) userFilm = f
    const l = localStorage.getItem(LS_LENS); if (LENS_IDS.includes(l)) userLens = l
  } catch (e) {}
  const save = (k, v) => { try { if (v === 'auto') localStorage.removeItem(k); else localStorage.setItem(k, v) } catch (e) {} }
  const hub = () => B.dataset.hub || 'today'
  const filmNow = () => userFilm === 'auto' ? (AUTO_FILM[hub()] || 'std') : userFilm
  const lensNow = () => userLens === 'auto' ? (AUTO_LENS[hub()] || '2.8') : userLens
  const fx = () => window.__cinemaFx, hero = () => window.__cinemaHero, lens = () => window.__cinemaLens
  const fLabel = id => (LENSES.find(l => l.id === id) || {}).label || ('F' + id)

  function applyFilm() { B.dataset.film = filmNow() }
  function applyLens() {
    const f = lensNow()
    B.dataset.aperture = f
    if (fx() && fx().setAperture) fx().setAperture(f)
    if (hero() && hero().setAperture) hero().setAperture(f)
    document.querySelectorAll('.td-hud-f b').forEach(b => { b.textContent = fLabel(f).slice(1) })
  }
  function applyAll() { applyFilm(); applyLens(); paint() }
  function setFilm(id, animated) {
    if (!FILM_IDS.includes(id)) return
    userFilm = id; save(LS_FILM, id)
    const swap = () => { applyFilm(); paint() }
    if (animated !== false && lens() && lens().iris && filmNow() !== B.dataset.film) lens().iris(swap); else swap()
  }
  function setLens(id, animated) {
    if (!LENS_IDS.includes(id)) return
    userLens = id; save(LS_LENS, id)
    const swap = () => { applyLens(); paint() }
    if (animated !== false && lens() && lens().iris && lensNow() !== B.dataset.aperture) lens().iris(swap); else swap()
  }

  /* ── 機頂三顆圓轉盤（照富士 X-T 的頂蓋：刻度刻在盤緣、盤上方一個固定指標、轉盤自己轉到目前值）──
     FILM／LENS／FX 各一顆 SVG：外圈滾花、盤面刻字、目前值轉到 12 點鐘的指標下方並亮起。
     點一下＝轉一格；滾輪、方向鍵＝撥格；按著拖＝真的轉（每跨過一格的角度就撥一格）。
     hero 底部的 F 值是鏡頭上的光圈環，點一下換下一檔。 */
  const GROUPS = { film: FILMS, lens: LENSES, tier: TIERS }
  const PLATE = { film: 'FILM', lens: 'LENS', tier: 'FX' }
  const RIM = { film: { auto: 'A', std: 'STD', cc: 'CC', eterna: 'ETERNA', cn: 'CN', acros: 'ACROS' }, lens: { auto: 'A', '2': '2', '2.8': '2.8', '5.6': '5.6', '8': '8' }, tier: { overdrive: 'OVER', active: 'ACT', quiet: 'QUIET' } }
  const curOf = g => g === 'film' ? userFilm : g === 'lens' ? userLens : (fx() ? fx().tier() : 'overdrive')
  function setOf(g, v) { if (g === 'film') setFilm(v); else if (g === 'lens') setLens(v); else if (fx() && fx().setTier) { fx().setTier(v); paint() } }
  function step(g, dir) {
    const list = GROUPS[g].map(o => o.id), i = list.indexOf(curOf(g))
    rot[g] = (rot[g] || 0) - dir * 360 / list.length     // 連續累積：從最後一格轉到第一格不會倒轉一大圈
    setOf(g, list[(i + dir + list.length) % list.length])
  }
  const rot = {}, dials = {}
  function dialSvg(g) {
    const list = GROUPS[g], n = list.length, R = 28, C = 28
    const ticks = Array.from({ length: n * 3 }, (_, i) => { const a = i * 360 / (n * 3), main = i % 3 === 0; return `<line x1="${C}" y1="${C - R + 1.5}" x2="${C}" y2="${C - R + (main ? 6 : 3.5)}" transform="rotate(${a} ${C} ${C})" class="${main ? 'tk' : 'tk tk-s'}"/>` }).join('')
    const labels = list.map((o, i) => `<text x="${C}" y="${C - R + 13.5}" transform="rotate(${i * 360 / n} ${C} ${C})" data-val="${o.id}" class="lb${o.id === 'auto' ? ' lb-a' : ''}">${RIM[g][o.id] || o.label}</text>`).join('')
    return `<svg viewBox="0 0 56 56" aria-hidden="true">
      <circle cx="${C}" cy="${C}" r="${R}" class="knurl"/>
      <circle cx="${C}" cy="${C}" r="${R - 2.2}" class="face"/>
      <g class="rot" style="transform-origin:${C}px ${C}px">${ticks}${labels}<circle cx="${C}" cy="${C}" r="7" class="hub"/></g>
      <path d="M${C - 3.2} 1.2 L${C + 3.2} 1.2 L${C} 6.4 Z" class="idx"/>
    </svg>`
  }
  function mountDials() {
    const host = document.querySelector('.topbar .tb-r'), tier = document.getElementById('fx-tier')
    if (!host || document.querySelector('.fx-dials')) return
    const strip = document.createElement('div'); strip.className = 'fx-dials'
    ;['film', 'lens', 'tier'].forEach(g => {
      const b = g === 'tier' && tier ? tier : document.createElement('button')
      b.type = 'button'; b.className = 'fx-dial'; b.id = g === 'tier' ? 'fx-tier' : 'fx-' + g; b.dataset.dial = g
      b.innerHTML = `${dialSvg(g)}<small>${PLATE[g]}</small>`
      strip.appendChild(b); dials[g] = b
      if (g !== 'tier') b.addEventListener('click', e => { if (b._dragged) { b._dragged = false; return } step(g, 1) })
      else b.addEventListener('click', e => { if (b._dragged) { b._dragged = false; e.stopImmediatePropagation() } }, true)   // 拖完放開的 click 不算
      // 按著拖＝轉盤：以盤心為軸算角度，每跨過一格就撥一格
      let dragging = false, lastA = 0, acc = 0, pid = null
      const ang = e => { const r = b.getBoundingClientRect(); return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI }
      b.addEventListener('pointerdown', e => { dragging = true; pid = e.pointerId; lastA = ang(e); acc = 0; try { b.setPointerCapture(pid) } catch (x) {} })
      b.addEventListener('pointermove', e => {
        if (!dragging || e.pointerId !== pid) return
        let d = ang(e) - lastA; if (d > 180) d -= 360; if (d < -180) d += 360
        lastA = ang(e); acc += d
        const det = 360 / GROUPS[g].length
        while (acc >= det * .6) { acc -= det; b._dragged = true; step(g, 1) }
        while (acc <= -det * .6) { acc += det; b._dragged = true; step(g, -1) }
      })
      const up = e => { if (e.pointerId !== pid) return; dragging = false; try { b.releasePointerCapture(pid) } catch (x) {} }
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up)
    })
    host.insertBefore(strip, host.firstChild)
    strip.addEventListener('wheel', e => { const b = e.target.closest('.fx-dial'); if (!b) return; e.preventDefault(); const d = e.deltaY || e.deltaX; if (Math.abs(d) < 4) return; step(b.dataset.dial, d > 0 ? 1 : -1) }, { passive: false })
    strip.addEventListener('keydown', e => { const b = e.target.closest('.fx-dial'); if (!b) return; const g = b.dataset.dial; if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); step(g, 1) } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); step(g, -1) } })
    // hero 底部的 F 值＝光圈環：點一下換下一檔（AUTO 之外的四檔輪流）
    document.addEventListener('click', e => {
      const ring = e.target.closest('.td-hud-f'); if (!ring) return
      const list = LENS_IDS.filter(v => v !== 'auto'), i = list.indexOf(lensNow())
      setLens(list[(i + 1) % list.length])
    })
  }
  function paint() {
    const F = fx(), reduced = F && F.reduced && F.reduced()
    ;['film', 'lens', 'tier'].forEach(g => {
      const b = dials[g]; if (!b) return
      const list = GROUPS[g], cur = curOf(g), i = Math.max(0, list.findIndex(o => o.id === cur)), det = 360 / list.length
      // 目標角度＝把第 i 格轉到 12 點；rot 累積值只用來決定轉向（走最短路，跨首尾不倒轉）
      const target = -i * det, have = rot[g] || 0
      let k = Math.round((have - target) / 360); let deg = target + k * 360
      if (deg - have > 180) deg -= 360; if (have - deg > 180) deg += 360
      rot[g] = deg
      const gr = b.querySelector('.rot'); if (gr) gr.style.transform = `rotate(${deg}deg)`
      b.querySelectorAll('.lb').forEach(t => t.classList.toggle('is-on', t.dataset.val === cur))
      const auto = (g === 'film' && userFilm === 'auto') || (g === 'lens' && userLens === 'auto')
      const res = g === 'film' ? (FILMS.find(f => f.id === filmNow()) || {}).label : g === 'lens' ? fLabel(lensNow()) : (TIERS.find(t => t.id === cur) || {}).label
      b.classList.toggle('is-auto', auto)
      b.querySelector('small').textContent = auto ? `A · ${res}` : res     // 盤下只放值（盤名在 title）：三個 52px 擠不下「FILM · ETERNA」
      b.title = g === 'film' ? `底片：${res}${auto ? '（AUTO 依畫面）' : ''}。點一下轉一格，滾輪或拖著轉` : g === 'lens' ? `光圈：${res}${auto ? '（AUTO 依畫面）' : ''}。點一下轉一格，滾輪或拖著轉` : (reduced ? '場景動態：系統要求減少動態，固定 QUIET' : `場景動態：${res}。點一下轉一格`)
      if (g === 'tier') b.disabled = !!reduced
      b.setAttribute('aria-label', b.title)
    })
  }

  addEventListener('strava:hub', applyAll)        // AUTO 跟著 hub 走；換頁本身已經是鏡頭轉場，這裡不再加 iris
  mountDials()
  applyAll()
  window.__cinemaLook = { step, paint, setFilm, setLens, film: filmNow, lens: lensNow, userFilm: () => userFilm, userLens: () => userLens, apply: applyAll, films: FILM_IDS, lenses: LENS_IDS }
})()
