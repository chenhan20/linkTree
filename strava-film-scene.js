/* strava-film-scene.js —— 微電影《十六分二十五秒》（strava_film.html）的 3D 世界
 *
 * three r128（vendor-three-r128.js），全部程序化，只吃 data/film.json：
 *   真實地形（兩層 DEM）→ 水墨著色器；米點樹；霧帶；城市與 101；淡水河、基隆河；
 *   他常爬的路；一條「毛筆字」軌跡（筆畫粗細＝功率）；騎士與影子；雨、花瓣；
 *   另外一個場景是紙上的台灣地圖（一日北彰、三鐵）。
 * 導演（鏡頭、時間、字幕、聲音）在頁面裡；這支只負責「畫得出來」。
 * 設計系統：DESIGN.film.md。
 */
;(function () {
'use strict'
const THREE = window.THREE
const EXAG = 1.6                     // 地形垂直誇張：山水畫本來就把山拉高

// ── 小工具 ────────────────────────────────────────────────────────────
const clamp = (v, a, b) => v < a ? a : v > b ? b : v
const lerp = (a, b, t) => a + (b - a) * t
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t) }
const col = h => new THREE.Color(h)
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
function hash2(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s) }
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz)
  return lerp(lerp(hash2(ix, iz), hash2(ix + 1, iz), u), lerp(hash2(ix, iz + 1), hash2(ix + 1, iz + 1), u), v)
}

// GLSL 共用：雜訊、fbm、霧
const GLSL_NOISE = `
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1.,0.)), u.x), mix(hash(i+vec2(0.,1.)), hash(i+vec2(1.,1.)), u.x), u.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a*noise(p); p = p*2.03 + 17.1; a *= 0.5; } return s; }
`
const GLSL_FOG = `
uniform vec3 uFog; uniform float uFogD; uniform vec3 uCam; uniform float uMistH; uniform float uMistAmt; uniform float uTime;
vec3 applyFog(vec3 c, vec3 w){
  float d = length(uCam - w);
  float f = 1.0 - exp(-pow(d * uFogD, 1.25));
  float m = smoothstep(uMistH, uMistH - 140.0, w.y) * uMistAmt * (0.55 + 0.45 * fbm(w.xz * 0.0012 + vec2(uTime * 0.004, 0.0)));
  float basin = smoothstep(90.0, 5.0, w.y) * (0.1 + 0.7 * uMistAmt);       // 盆地罩著一層薄霧（霧越重越濃）
  return mix(c, uFog, clamp(max(f, max(m, basin) * smoothstep(60.0, 900.0, d)), 0.0, 1.0));
}
`

// ── 地形資料 ──────────────────────────────────────────────────────────
function decodeGrid(g) {
  const bin = atob(g.h), u8 = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
  const u16 = new Uint16Array(u8.buffer), n = g.nx * g.nz, hf = new Float32Array(n)
  for (let i = 0; i < n; i++) hf[i] = u16[i] / 10 - 10
  return { x0: g.x0, z0: g.z0, dx: g.dx, nx: g.nx, nz: g.nz, hf, x1: g.x0 + (g.nx - 1) * g.dx, z1: g.z0 + (g.nz - 1) * g.dx }
}
function sampleGrid(g, x, z) {
  const fx = (x - g.x0) / g.dx, fz = (z - g.z0) / g.dx
  if (fx < 0 || fz < 0 || fx > g.nx - 1 || fz > g.nz - 1) return null
  const ix = Math.min(g.nx - 2, Math.floor(fx)), iz = Math.min(g.nz - 2, Math.floor(fz)), tx = fx - ix, tz = fz - iz, h = g.hf, nx = g.nx
  return (h[iz * nx + ix] * (1 - tx) + h[iz * nx + ix + 1] * tx) * (1 - tz) + (h[(iz + 1) * nx + ix] * (1 - tx) + h[(iz + 1) * nx + ix + 1] * tx) * tz
}

// ── 路徑：重新取樣、弧長、航向（鏡頭用的平滑航向）─────────────────────────
class Path {
  constructor(pts, Y, opts = {}) {
    const step = opts.step || 5, lift = opts.lift == null ? 1.2 : opts.lift
    // Catmull-Rom 補點到每 step 公尺
    const P = pts.map(p => [p[0], p[1]])
    const out = []
    for (let i = 0; i < P.length - 1; i++) {
      const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)]
      const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), n = Math.max(1, Math.ceil(L / step))
      for (let k = 0; k < n; k++) {
        const t = k / n, t2 = t * t, t3 = t2 * t
        const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
        out.push([cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])])
      }
    }
    out.push(P[P.length - 1])
    const n = out.length
    this.x = new Float32Array(n); this.z = new Float32Array(n); this.y = new Float32Array(n); this.s = new Float32Array(n)
    this.hd = new Float32Array(n); this.hs = new Float32Array(n); this.gr = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      this.x[i] = out[i][0]; this.z[i] = out[i][1]; this.y[i] = Y(out[i][0], out[i][1]) + lift
      if (i) this.s[i] = this.s[i - 1] + Math.hypot(this.x[i] - this.x[i - 1], this.z[i] - this.z[i - 1])
    }
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1)
      this.hd[i] = Math.atan2(this.x[b] - this.x[a], -(this.z[b] - this.z[a]))       // 0＝北，順時針
      const ds = this.s[b] - this.s[a] || 1
      this.gr[i] = (this.y[b] - this.y[a]) / EXAG / ds
    }
    // 鏡頭用的航向：前後 90 m 的平均方向（之字坡不會甩頭）
    const W = opts.smoothM || 90
    for (let i = 0; i < n; i++) {
      let sx = 0, sz = 0
      for (let j = i; j >= 0 && this.s[i] - this.s[j] < W; j--) { sx += Math.sin(this.hd[j]); sz += Math.cos(this.hd[j]) }
      for (let j = i + 1; j < n && this.s[j] - this.s[i] < W; j++) { sx += Math.sin(this.hd[j]); sz += Math.cos(this.hd[j]) }
      this.hs[i] = Math.atan2(sx, sz)
    }
    this.n = n; this.L = this.s[n - 1]
  }
  idx(s) {
    s = clamp(s, 0, this.L)
    let lo = 0, hi = this.n - 1
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.s[m] <= s) lo = m; else hi = m }
    return [lo, hi, this.s[hi] > this.s[lo] ? (s - this.s[lo]) / (this.s[hi] - this.s[lo]) : 0]
  }
  at(s) {
    const [a, b, t] = this.idx(s), ang = (p, q) => p + Math.atan2(Math.sin(q - p), Math.cos(q - p)) * t
    return { x: lerp(this.x[a], this.x[b], t), y: lerp(this.y[a], this.y[b], t), z: lerp(this.z[a], this.z[b], t),
      h: ang(this.hd[a], this.hd[b]), hs: ang(this.hs[a], this.hs[b]), g: lerp(this.gr[a], this.gr[b], t) }
  }
}

// ── 貼圖（全部用 canvas 畫）────────────────────────────────────────────
function inkDotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64
  const x = c.getContext('2d'), r = rng(7)
  // 米點：橫向略扁的一團墨，邊緣有幾顆飛出去的小點
  for (let k = 0; k < 26; k++) {
    const a = r() * Math.PI * 2, d = Math.pow(r(), 1.6) * 18, rad = 4 + r() * 9
    const cx = 32 + Math.cos(a) * d * 1.2, cy = 34 + Math.sin(a) * d * 0.7
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, rad)
    g.addColorStop(0, 'rgba(0,0,0,0.7)'); g.addColorStop(0.6, 'rgba(0,0,0,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0)')
    x.fillStyle = g; x.fillRect(0, 0, 64, 64)
  }
  const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter; return t
}
function treeAtlas() {
  // 2×2：松、點葉樹、介字點的雜樹、矮灌木。alpha＝墨的濃淡（淡的是渲染的底，濃的是筆）
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S * 2
  const x = c.getContext('2d'), r = rng(21)
  const ink = a => `rgba(0,0,0,${a})`
  const trunk = (ox, oy, h, w0, w1, bend) => {
    x.fillStyle = ink(0.92); x.beginPath()
    const pts = []
    for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push([ox + Math.sin(t * 3.1 + bend) * bend * 9 * t, oy - t * h, lerp(w0, w1, t)]) }
    pts.forEach(([px, py, w], i) => i ? x.lineTo(px - w / 2, py) : x.moveTo(px - w / 2, py))
    for (let i = pts.length - 1; i >= 0; i--) x.lineTo(pts[i][0] + pts[i][2] / 2, pts[i][1])
    x.fill()
    return pts
  }
  const dot = (cx, cy, rx, ry, a) => { x.fillStyle = ink(a); x.beginPath(); x.ellipse(cx, cy, rx, ry, (r() - 0.5) * 0.6, 0, Math.PI * 2); x.fill() }
  const wash = (cx, cy, rx, ry, a) => { const g = x.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry)); g.addColorStop(0, ink(a)); g.addColorStop(1, ink(0)); x.save(); x.translate(cx, cy); x.scale(1, ry / rx); x.translate(-cx, -cy); x.fillStyle = g; x.beginPath(); x.arc(cx, cy, rx, 0, Math.PI * 2); x.fill(); x.restore() }
  // 0 松：斜幹＋一層一層扁平的針葉團
  {
    const ox = 128, oy = 252, pts = trunk(ox, oy, 215, 13, 4, 0.9)
    for (let k = 0; k < 6; k++) {
      const t = 0.35 + k * 0.12, p = pts[Math.min(12, Math.round(t * 12))], w = 70 - k * 8, side = k % 2 ? 1 : -1
      const cx = p[0] + side * w * 0.35, cy = p[1] + 6
      wash(cx, cy + 4, w * 0.75, 16, 0.4)
      x.strokeStyle = ink(0.9); x.lineWidth = 2.2; x.lineCap = 'round'
      for (let n = 0; n < 34; n++) { const a = -Math.PI / 2 + (r() - 0.5) * 2.2, px = cx + (r() - 0.5) * w * 1.3, py = cy + (r() - 0.5) * 12; x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * 11, py + Math.sin(a) * 7); x.stroke() }
      x.lineWidth = 3; x.beginPath(); x.moveTo(p[0], p[1]); x.lineTo(cx, cy + 2); x.stroke()
    }
  }
  // 1 點葉樹：兩根幹、圓的一團米點
  {
    const ox = 256 + 128, oy = 252
    trunk(ox - 6, oy, 120, 10, 4, 0.4); trunk(ox + 8, oy, 100, 8, 3, -0.5)
    wash(ox, 100, 92, 78, 0.45)
    for (let n = 0; n < 150; n++) { const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 80; dot(ox + Math.cos(a) * d, 104 + Math.sin(a) * d * 0.8, 5 + r() * 6, 3 + r() * 3, 0.55 + r() * 0.4) }
  }
  // 2 介字點雜樹：細高的幹、一簇一簇的「介」字葉
  {
    const ox = 128, oy = 256 + 252, pts = trunk(ox, oy, 225, 9, 3, -0.6)
    wash(ox, 256 + 90, 70, 90, 0.35)
    x.strokeStyle = ink(0.88); x.lineWidth = 2.4; x.lineCap = 'round'
    for (let n = 0; n < 60; n++) {
      const cx = ox + (r() - 0.5) * 120, cy = 256 + 30 + r() * 140
      x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx - 7, cy + 10); x.moveTo(cx, cy); x.lineTo(cx + 7, cy + 10); x.moveTo(cx - 3, cy + 5); x.lineTo(cx - 3, cy + 13); x.moveTo(cx + 3, cy + 5); x.lineTo(cx + 3, cy + 13); x.stroke()
    }
  }
  // 3 矮灌木：貼地的一團點
  {
    const ox = 256 + 128, oy = 256 + 250
    wash(ox, oy - 40, 110, 45, 0.45)
    for (let n = 0; n < 120; n++) { const a = Math.PI + r() * Math.PI, d = Math.sqrt(r()) * 100; dot(ox + Math.cos(a) * d, oy - 8 + Math.sin(a) * d * 0.55, 5 + r() * 5, 3 + r() * 3, 0.5 + r() * 0.45) }
  }
  const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; return t
}
function roofAtlas() {
  // 2×2 的屋頂記號：城市不畫方塊，畫成一片片淡墨的瓦與樓
  const S = 64, c = document.createElement('canvas'); c.width = c.height = S * 2
  const x = c.getContext('2d'), ink = a => `rgba(0,0,0,${a})`
  x.lineCap = 'round'
  const roof = (ox, oy, w, h) => { x.fillStyle = ink(0.28); x.fillRect(ox - w / 2 + 3, oy, w - 6, h); x.strokeStyle = ink(0.85); x.lineWidth = 4; x.beginPath(); x.moveTo(ox - w / 2, oy + 3); x.quadraticCurveTo(ox, oy - 6, ox + w / 2, oy + 3); x.stroke() }
  roof(32, 30, 44, 18)
  roof(64 + 22, 26, 30, 14); roof(64 + 42, 38, 30, 14)
  x.strokeStyle = ink(0.8); x.lineWidth = 3.2
  for (let k = 0; k < 4; k++) { x.beginPath(); x.moveTo(10 + (k % 2) * 6, 64 + 16 + k * 10); x.lineTo(52 - (k % 2) * 4, 64 + 16 + k * 10); x.stroke() }
  x.fillStyle = ink(0.22); x.fillRect(64 + 22, 64 + 8, 20, 50); x.strokeStyle = ink(0.8); x.lineWidth = 2.6; x.strokeRect(64 + 22, 64 + 8, 20, 50)
  for (let k = 0; k < 5; k++) { x.beginPath(); x.moveTo(64 + 24, 64 + 16 + k * 9); x.lineTo(64 + 40, 64 + 16 + k * 9); x.stroke() }
  const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter; return t
}
function mistTexture(seed) {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S
  const x = c.getContext('2d'), img = x.createImageData(S, S), r = rng(seed)
  const ox = r() * 100, oz = r() * 100
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    let v = 0, a = 0.5, f = 1 / 48
    for (let o = 0; o < 4; o++) { v += a * vnoise(ox + i * f, oz + j * f); f *= 2.1; a *= 0.5 }
    // 讓貼圖能無縫接續：邊緣往中間淡
    const e = Math.min(i, j, S - 1 - i, S - 1 - j) / 30
    const k = (j * S + i) * 4
    img.data[k] = img.data[k + 1] = img.data[k + 2] = 255
    img.data[k + 3] = clamp((v - 0.42) * 3.2, 0, 1) * clamp(e, 0, 1) * 255
  }
  x.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter; return t
}
function discTexture(soft) {
  const c = document.createElement('canvas'); c.width = c.height = 128
  const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(soft ? 0.35 : 0.72, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)')
  x.fillStyle = g; x.beginPath(); x.arc(64, 64, 64, 0, Math.PI * 2); x.fill()
  const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter; return t
}
const FONT = "'LXGW WenKai TC','Kaiti TC','BiauKai','STKaiti','KaiTi',serif"
function labelSprite(text, opts = {}) {
  const px = opts.px || 30, pad = 10, c = document.createElement('canvas'), x = c.getContext('2d')
  x.font = `${px}px ${FONT}`
  const w = Math.ceil(x.measureText(text).width) + pad * 2 + (opts.dot ? px * 0.8 : 0), h = px + pad * 2
  c.width = w * 2; c.height = h * 2; x.scale(2, 2)
  x.font = `${px}px ${FONT}`; x.textBaseline = 'middle'
  let tx = pad
  if (opts.dot) { x.fillStyle = opts.dotColor || '#a8322b'; x.beginPath(); x.arc(pad + px * 0.28, h / 2, px * 0.2, 0, Math.PI * 2); x.fill(); tx += px * 0.8 }
  x.lineWidth = 5; x.strokeStyle = 'rgba(243,236,223,0.85)'; x.strokeText(text, tx, h / 2 + 1)
  x.fillStyle = opts.color || '#2a2622'; x.fillText(text, tx, h / 2 + 1)
  const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter
  const m = new THREE.SpriteMaterial({ map: t, sizeAttenuation: false, depthWrite: false, depthTest: false, fog: false, transparent: true })
  const s = new THREE.Sprite(m)
  const k = (opts.scale || 1) * 0.0009
  s.scale.set(w * k, h * k, 1)
  s.center.set(opts.dot ? (pad + px * 0.28) / w : 0.5, 0.5)
  s.renderOrder = 20
  return s
}

// ── 材質 ──────────────────────────────────────────────────────────────
function makeShared() {
  return {
    uFog: { value: col('#e9dfcd') }, uFogD: { value: 1 / 9000 }, uCam: { value: new THREE.Vector3() },
    uMistH: { value: 200 }, uMistAmt: { value: 0.5 }, uTime: { value: 0 },
  }
}
function terrainMaterial(sh) {
  return new THREE.ShaderMaterial({
    uniforms: Object.assign({
      uPaper: { value: col('#efe6d3') }, uInk: { value: col('#23201d') }, uWash: { value: col('#9fae8f') }, uWash2: { value: col('#7d8f8a') },
      uSun: { value: new THREE.Vector3(-0.5, 0.6, -0.6).normalize() }, uInkAmt: { value: 0.85 }, uWet: { value: 0 },
    }, sh),
    vertexShader: `attribute float aCurv; varying vec3 vW; varying vec3 vN; varying float vC;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normal; vC = aCurv; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uPaper, uInk, uWash, uWash2, uSun; uniform float uInkAmt, uWet; varying vec3 vW; varying vec3 vN; varying float vC;
      ${GLSL_NOISE}${GLSL_FOG}
      void main(){
        vec3 n = normalize(vN);
        float slope = 1.0 - n.y;
        float ndl = dot(n, normalize(uSun));
        // 皴：順著坡向拉長的筆觸
        vec2 g = normalize(n.xz + vec2(1e-4));
        vec2 q = vec2(dot(vW.xz, g), dot(vW.xz, vec2(-g.y, g.x)));
        float cun = fbm(q * vec2(0.025, 0.11)) * 0.6 + fbm(vW.xz * 0.02) * 0.4;
        float tex = fbm(vW.xz * 0.0025);
        float valley = smoothstep(0.0, 0.9, vC);                 // 凹處（溝谷）積墨
        float ridge = smoothstep(0.0, -0.9, vC);                 // 凸處（稜線）留白
        float shade = 1.0 - clamp(ndl * 0.7 + 0.5, 0.0, 1.0);
        float ink = 0.06 + smoothstep(0.04, 0.5, slope) * 0.34 + shade * 0.42 + valley * 0.5 - ridge * 0.22;
        ink *= 0.55 + 0.95 * cun;
        // 分層：像一層一層罩上去的墨，邊緣是毛的
        float lv = floor(clamp(ink * uInkAmt, 0.0, 1.0) * 4.0 + cun * 0.8) / 4.0;
        float dcam = length(uCam - vW);
        lv = clamp(mix(lv, ink * uInkAmt, mix(0.8, 0.45, smoothstep(150.0, 900.0, dcam))), 0.0, 0.92);
        vec3 base = mix(uPaper, uWash, clamp(smoothstep(0.02, 0.3, slope) * 0.7 + tex * 0.4 - 0.12, 0.0, 1.0));
        base = mix(base, uWash2, smoothstep(250.0, 1000.0, vW.y) * 0.5);
        vec3 c = mix(base, uInk, lv * 0.9);
        // 苔點：稜線上的小墨點
        float moss = step(0.86, noise(vW.xz * 0.11)) * step(0.4, ridge + slope * 0.6) * 0.55 * smoothstep(140.0, 420.0, dcam);
        c = mix(c, uInk, moss * uInkAmt);
        // 近景的披麻皴：順坡的細長筆觸，只在鏡頭附近出現
        float nearK = 1.0 - smoothstep(90.0, 480.0, dcam);
        float fine = fbm(q * vec2(0.075, 0.5)) * 0.75 + noise(vW.xz * 0.9) * 0.25;
        c = mix(c, uInk, smoothstep(0.6, 0.8, fine) * (0.12 + slope * 0.4) * nearK * uInkAmt);
        c = mix(c, uPaper, smoothstep(0.34, 0.2, fine) * 0.15 * nearK);
        // 視線掠過稜線的地方加一道墨（輪廓）
        vec3 v = normalize(uCam - vW);
        float rim = 1.0 - abs(dot(n, v));
        c = mix(c, uInk, smoothstep(0.8, 0.98, rim) * 0.55 * uInkAmt);
        c = mix(c, c * 0.8, uWet);
        gl_FragColor = vec4(applyFog(c, vW), 1.0);
      }`,
  })
}
function waterMaterial(sh) {
  return new THREE.ShaderMaterial({
    uniforms: Object.assign({ uPaper: { value: col('#efe6d3') }, uWater: { value: col('#9fb1b3') }, uInk: { value: col('#23201d') } }, sh),
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uPaper, uWater, uInk; varying vec3 vW; ${GLSL_NOISE}${GLSL_FOG}
      void main(){
        float r = sin(vW.x * 0.045 + fbm(vW.xz * 0.004) * 7.0 + uTime * 0.25);
        float lines = smoothstep(0.93, 0.99, r) * 0.35 * (0.5 + fbm(vW.xz * 0.01));
        vec3 c = mix(uWater, uPaper, 0.25 + 0.25 * fbm(vW.xz * 0.002));
        c = mix(c, uInk, lines);
        gl_FragColor = vec4(applyFog(c, vW), 1.0);
      }`,
  })
}
function skyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTop: { value: col('#d8d3cc') }, uHor: { value: col('#efe2cf') }, uSunDir: { value: new THREE.Vector3(0, 0.1, -1) }, uSunCol: { value: col('#e8b89a') }, uGlow: { value: 0.35 }, uTime: { value: 0 }, uWisp: { value: 0.5 } },
    vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `uniform vec3 uTop, uHor, uSunDir, uSunCol; uniform float uGlow, uTime, uWisp; varying vec3 vD; ${GLSL_NOISE}
      void main(){
        vec3 d = normalize(vD);
        float h = clamp(d.y, -0.2, 1.0);
        vec3 c = mix(uHor, uTop, smoothstep(0.0, 0.55, h));
        float s = max(dot(d, normalize(uSunDir)), 0.0);
        c = mix(c, uSunCol, pow(s, 24.0) * uGlow);
        float w = fbm(vec2(atan(d.x, d.z) * 3.0 + uTime * 0.002, h * 9.0));
        c = mix(c, uHor * 1.02, smoothstep(0.55, 0.8, w) * uWisp * smoothstep(0.02, 0.18, h) * (1.0 - smoothstep(0.35, 0.7, h)));
        gl_FragColor = vec4(c, 1.0);
      }`,
    side: THREE.BackSide, depthWrite: false, depthTest: true,
  })
}
function pointsMaterial(sh, tex) {
  return new THREE.ShaderMaterial({
    uniforms: Object.assign({ uDot: { value: tex }, uInk: { value: col('#1d1b19') }, uTint: { value: col('#4d5a4c') }, uScale: { value: 600 } }, sh),
    vertexShader: `attribute float aSize; attribute float aShade; attribute float aNear; varying float vShade; varying vec3 vW; uniform float uScale;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mv = viewMatrix * w;
        float far = smoothstep(1500.0, 4000.0, -mv.z) * aNear;
        float rnd = fract(sin(dot(position.xz, vec2(12.9898, 78.233))) * 43758.5453);
        if (rnd > mix(1.0, 0.075, far)) { gl_PointSize = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        gl_PointSize = clamp(aSize * mix(1.0, 2.4, far) * uScale / -mv.z, 1.5, 22.0); gl_Position = projectionMatrix * mv; vShade = aShade; }`,
    fragmentShader: `uniform sampler2D uDot; uniform vec3 uInk, uTint; varying float vShade; varying vec3 vW; ${GLSL_NOISE}${GLSL_FOG}
      void main(){ vec4 t = texture2D(uDot, gl_PointCoord); if (t.a < 0.32) discard; vec3 c = mix(uInk, uTint, vShade); gl_FragColor = vec4(applyFog(c, vW), 1.0); }`,
  })
}
function billboardMaterial(sh, tex) {
  return new THREE.ShaderMaterial({
    uniforms: Object.assign({ uTex: { value: tex }, uInk: { value: col('#1d1b19') }, uTint: { value: col('#4d5a4c') }, uWashC: { value: col('#9aa491') } }, sh),
    vertexShader: `attribute vec2 aCorner; attribute vec2 aSize; attribute float aVar; attribute float aShade; varying vec2 vUv; varying float vShade; varying float vFade; varying vec3 vW;
      void main(){
        vec4 mv = viewMatrix * vec4(position, 1.0);
        vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
        vec3 rightV = normalize(cross(upV, vec3(0.0, 0.0, 1.0)));
        mv.xyz += rightV * aCorner.x * aSize.x + upV * aCorner.y * aSize.y;
        vW = position + vec3(0.0, aCorner.y * aSize.y, 0.0);
        float cx = mod(aVar, 2.0), cy = floor(aVar / 2.0);
        vUv = vec2((aCorner.x + 0.5 + cx) * 0.5, (aCorner.y + 1.0 - cy) * 0.5);
        vShade = aShade;
        vFade = (1.0 - smoothstep(0.62, 0.9, abs(upV.z))) * (1.0 - smoothstep(700.0, 1300.0, -mv.z));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform sampler2D uTex; uniform vec3 uInk, uTint, uWashC; varying vec2 vUv; varying float vShade; varying float vFade; varying vec3 vW; ${GLSL_NOISE}${GLSL_FOG}
      void main(){
        float a = texture2D(uTex, vUv).a * vFade;
        if (a < 0.22) discard;
        vec3 c = mix(mix(uWashC, uTint, vShade), uInk, smoothstep(0.45, 0.85, a));
        gl_FragColor = vec4(applyFog(c, vW), 1.0);
      }`,
  })
}
function roofMaterial(sh, tex) {
  return new THREE.ShaderMaterial({
    uniforms: Object.assign({ uTex: { value: tex }, uInk: { value: col('#2a2724') }, uScale: { value: 600 } }, sh),
    vertexShader: `attribute float aSize; attribute float aVar; varying float vVar; varying vec3 vW; uniform float uScale;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mv = viewMatrix * w; gl_PointSize = clamp(aSize * uScale / -mv.z, 1.0, 26.0); vVar = aVar; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D uTex; uniform vec3 uInk; varying float vVar; varying vec3 vW; ${GLSL_NOISE}${GLSL_FOG}
      void main(){
        vec2 uv = (gl_PointCoord + vec2(mod(vVar, 2.0), floor(vVar / 2.0))) * 0.5;
        uv.y = 1.0 - uv.y;
        float a = texture2D(uTex, uv).a;
        if (a < 0.16) discard;
        vec3 c = mix(vec3(0.72, 0.69, 0.64), uInk, smoothstep(0.3, 0.75, a));
        gl_FragColor = vec4(applyFog(c, vW), 1.0);
      }`,
  })
}
function strokeMaterial(sh, color) {
  return new THREE.ShaderMaterial({
    uniforms: Object.assign({ uColor: { value: col(color || '#1f1c1a') }, uHead: { value: 1e9 }, uTail: { value: -1 }, uAlpha: { value: 1 }, uTip: { value: col('#a8322b') }, uTipAmt: { value: 0 }, uNearW: { value: 0.3 }, uFarW: { value: 1.5 } }, sh),
    // 筆畫寬度跟著鏡頭距離變：貼近看是一道輪胎寬的墨，從空中看才是有粗細的一筆
    vertexShader: `attribute float aS; attribute float aU; attribute vec3 aOff; uniform vec3 uCam; uniform float uNearW, uFarW; varying float vS; varying float vU; varying vec3 vW; varying float vFar;
      void main(){
        float d = length(uCam - position);
        float k = mix(uNearW, uFarW, smoothstep(30.0, 900.0, d)) * max(1.0, d / 1500.0);
        vS = aS; vU = aU; vFar = smoothstep(50.0, 220.0, d);
        vec4 w = modelMatrix * vec4(position + aOff * k + vec3(0.0, d * 0.0015, 0.0), 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uColor, uTip; uniform float uHead, uTail, uAlpha, uTipAmt; varying float vS; varying float vU; varying vec3 vW; varying float vFar; ${GLSL_NOISE}${GLSL_FOG}
      void main(){
        if (vS > uHead || vS < uTail) discard;
        float edge = smoothstep(0.0, 0.2, vU) * smoothstep(1.0, 0.8, vU);
        float streak = noise(vec2(vS * 0.05, vU * 9.0)) * 0.7 + noise(vec2(vS * 0.013, vU * 3.0)) * 0.3;
        // 飛白：筆畫邊緣與乾掉的段落露出紙
        float dry = smoothstep(0.18, 0.45, streak + edge * 0.45 - 0.12);
        float a = edge * dry * uAlpha;
        float wet = smoothstep(7.0, 0.0, uHead - vS) * vFar;             // 筆尖：遠看時剛寫下的那一點是朱紅的
        vec3 c = mix(uColor, uTip, wet * uTipAmt * 0.85);
        a = max(a, wet * edge * uAlpha * 0.9);
        a *= smoothstep(3.0, 12.0, length(uCam - vW));                   // 貼在鏡頭前的那一段淡掉
        if (a < 0.02) discard;
        gl_FragColor = vec4(applyFog(c, vW), a);
      }`,
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  })
}
function atlasMaterial(sh, color) {
  return new THREE.ShaderMaterial({
    uniforms: Object.assign({ uColor: { value: col(color) }, uAlpha: { value: 0 } }, sh),
    vertexShader: `attribute vec3 aOff; uniform vec3 uCam; varying vec3 vW;
      void main(){ float d = length(uCam - position); vec4 w = modelMatrix * vec4(position + aOff * clamp(d / 1100.0, 1.0, 11.0) + vec3(0.0, d * 0.003, 0.0), 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uAlpha; varying vec3 vW; ${GLSL_NOISE}${GLSL_FOG}
      void main(){ gl_FragColor = vec4(applyFog(uColor, vW), uAlpha); }`,
    transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
  })
}
function flatMaterial(sh, color, opacity) {
  return new THREE.ShaderMaterial({
    uniforms: Object.assign({ uColor: { value: col(color) }, uAlpha: { value: opacity == null ? 1 : opacity } }, sh),
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uAlpha; varying vec3 vW; ${GLSL_NOISE}${GLSL_FOG}
      void main(){ gl_FragColor = vec4(applyFog(uColor, vW), uAlpha); }`,
    transparent: opacity != null && opacity < 1, depthWrite: !(opacity != null && opacity < 1),
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  })
}

// ── 條帶（路、筆畫、他騎過的每一條路）────────────────────────────────────
function ribbonGeometry(path, widthAt, opts = {}) {
  const s0 = opts.s0 || 0, s1 = opts.s1 == null ? path.L : opts.s1, step = opts.step || 4, off = opts.offset || 0, lift = opts.lift || 0
  const n = Math.max(2, Math.ceil((s1 - s0) / step) + 1)
  const pos = new Float32Array(n * 2 * 3), aS = new Float32Array(n * 2), aU = new Float32Array(n * 2), idx = []
  const ofs = opts.center ? new Float32Array(n * 2 * 3) : null
  for (let i = 0; i < n; i++) {
    const s = s0 + (s1 - s0) * i / (n - 1), p = path.at(s), w = widthAt(s) / 2
    const nx = Math.cos(p.h), nz = Math.sin(p.h)                   // 航向的右手法線（x 東、z 南）
    const cx = p.x + nx * off, cz = p.z + nz * off
    const y = (opts.Y ? opts.Y(cx, cz) + 0.8 : p.y) + lift
    if (ofs) { pos.set([cx, y, cz, cx, y, cz], i * 6); ofs.set([-nx * w, 0, -nz * w, nx * w, 0, nz * w], i * 6) }
    else pos.set([cx - nx * w, y, cz - nz * w, cx + nx * w, y, cz + nz * w], i * 6)
    aS[i * 2] = aS[i * 2 + 1] = s; aU[i * 2] = 0; aU[i * 2 + 1] = 1
    if (i < n - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2) }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aS', new THREE.BufferAttribute(aS, 1))
  g.setAttribute('aU', new THREE.BufferAttribute(aU, 1))
  if (ofs) g.setAttribute('aOff', new THREE.BufferAttribute(ofs, 3))
  g.setIndex(idx)
  return g
}

// ── 騎士（方盒風格的小人＋墨線外框）─────────────────────────────────────
function buildRider(opts = {}) {
  const ghost = !!opts.ghost
  const root = new THREE.Group(), rig = new THREE.Group()
  root.add(rig)
  const C = ghost ? { jersey: opts.color || '#6b665f', skin: opts.color || '#8d877e', ink: opts.color || '#4a4540', helm: opts.color || '#a7a097', bike: opts.color || '#4a4540' }
    : { jersey: '#c23b25', skin: '#e3b48f', ink: '#1f1c1a', helm: '#efe6d3', bike: '#1f1c1a' }
  const mats = {}
  const mat = k => mats[k] || (mats[k] = ghost
    ? new THREE.MeshBasicMaterial({ color: C[k], transparent: true, opacity: 0.42, depthWrite: false, fog: true })
    : new THREE.MeshLambertMaterial({ color: C[k], fog: true }))
  const outline = ghost ? null : new THREE.MeshBasicMaterial({ color: '#15130f', side: THREE.BackSide, fog: true })
  const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 7)
  const unitBox = new THREE.BoxGeometry(1, 1, 1)
  const parts = []
  const add = (geo, m, withOutline = true) => {
    const mesh = new THREE.Mesh(geo, mat(m)); rig.add(mesh)
    if (outline && withOutline) { const o = new THREE.Mesh(geo, outline); o.scale.setScalar(1.18); mesh.add(o) }
    parts.push(mesh); return mesh
  }
  const seg = (mesh, a, b, r) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz) || 1e-4
    mesh.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2)
    mesh.scale.set(r, L, r)
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / L, dy / L, dz / L))
  }
  // 車：本地座標 x 向前、y 向上、z 向右
  const wheelGeo = new THREE.TorusGeometry(0.34, 0.028, 6, 22)
  const wr = add(wheelGeo, 'bike'), wf = add(wheelGeo, 'bike')
  wr.position.set(-0.5, 0.34, 0); wf.position.set(0.5, 0.34, 0)
  const tubes = [[[-0.5, 0.34, 0], [-0.02, 0.28, 0]], [[-0.5, 0.34, 0], [-0.16, 0.8, 0]], [[-0.02, 0.28, 0], [-0.2, 0.86, 0]],
    [[-0.18, 0.78, 0], [0.38, 0.82, 0]], [[-0.02, 0.28, 0], [0.4, 0.78, 0]], [[0.38, 0.86, 0], [0.5, 0.34, 0]], [[0.36, 0.9, 0], [0.5, 0.92, 0]]]
  for (const [a, b] of tubes) seg(add(unitCyl, 'bike', false), a, b, 0.022)
  const saddle = add(unitBox, 'ink'); saddle.scale.set(0.26, 0.04, 0.1); saddle.position.set(-0.22, 0.9, 0)
  // 人
  const torso = add(unitBox, 'jersey'), head = add(new THREE.SphereGeometry(0.11, 10, 8), 'skin'), helm = add(new THREE.SphereGeometry(0.13, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), 'helm')
  const limbs = {}
  for (const k of ['thighL', 'shinL', 'thighR', 'shinR', 'armL', 'armR']) limbs[k] = add(unitCyl, k.startsWith('arm') ? 'jersey' : (k.startsWith('thigh') ? 'ink' : 'skin'))
  const crankM = add(unitCyl, 'bike', false)
  const state = { crank: 0, pose: 'seat' }
  function legIK(hip, foot, L1, L2, side) {
    const dx = foot[0] - hip[0], dy = foot[1] - hip[1], d0 = Math.hypot(dx, dy)
    const d = clamp(d0, Math.abs(L1 - L2) + 0.01, L1 + L2 - 0.01), a = (L1 * L1 - L2 * L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - a * a))
    const ux = dx / d0, uy = dy / d0
    return [[hip[0] + ux * a + uy * h, hip[1] + uy * a - ux * h, side], [hip[0] + ux * d, hip[1] + uy * d, side]]
  }
  function pose(crank, kind) {
    const stand = kind === 'stand', coast = kind === 'coast'
    const hip = stand ? [-0.02, 1.0 + Math.sin(crank * 2) * 0.02] : [-0.2, 0.95]
    const sh = stand ? [0.32, 1.28] : [0.24, 1.3]
    torso.position.set((hip[0] + sh[0]) / 2, (hip[1] + sh[1]) / 2, 0)
    torso.scale.set(0.22, Math.hypot(sh[0] - hip[0], sh[1] - hip[1]), 0.34)
    torso.rotation.set(0, 0, -Math.atan2(sh[0] - hip[0], sh[1] - hip[1]))
    head.position.set(sh[0] + 0.12, sh[1] + 0.12, 0); helm.position.copy(head.position); helm.position.y += 0.02
    const BB = [-0.02, 0.28], cr = 0.17
    for (const [side, ph] of [[-0.11, crank], [0.11, crank + Math.PI]]) {
      const ped = [BB[0] + Math.cos(ph) * cr, BB[1] + Math.sin(ph) * cr]
      const foot = coast ? [0.3, 0.48] : ped
      const [knee, f] = legIK(hip, foot, 0.46, 0.47, side)
      const L = side < 0 ? 'L' : 'R'
      seg(limbs['thigh' + L], [hip[0], hip[1], side], knee, 0.06)
      seg(limbs['shin' + L], knee, f, 0.045)
    }
    seg(limbs.armL, [sh[0], sh[1] - 0.04, -0.16], [0.45, 0.92, -0.2], 0.04)
    seg(limbs.armR, [sh[0], sh[1] - 0.04, 0.16], [0.45, 0.92, 0.2], 0.04)
    seg(crankM, [BB[0] + Math.cos(crank) * 0.17, BB[1] + Math.sin(crank) * 0.17, 0], [BB[0] - Math.cos(crank) * 0.17, BB[1] - Math.sin(crank) * 0.17, 0], 0.015)
  }
  pose(0, 'seat')
  root.userData = { rig, wr, wf, pose }
  return {
    obj: root,
    set(p) {                                                // p: {x,y,z,h,g,crank,pose,visible}
      root.visible = p.visible !== false
      if (!root.visible) return
      root.position.set(p.x, p.y, p.z)
      rig.rotation.set(0, -(p.h - Math.PI / 2) * 1, 0)      // 航向 0＝北（-z）；本地 x 向前
      rig.rotation.order = 'YZX'
      rig.rotation.z = Math.atan(p.g || 0) * EXAG * 0.9
      const kind = p.pose || 'seat'
      if (kind !== state.pose || Math.abs(p.crank - state.crank) > 0.01) { pose(p.crank, kind); state.pose = kind; state.crank = p.crank }
      wr.rotation.z = wf.rotation.z = -(p.wheel || 0)
      root.scale.setScalar(p.scale || 1)
    },
  }
}

// ── 世界 ──────────────────────────────────────────────────────────────
function create(canvas, film, opts = {}) {
  const lowPower = !!opts.low
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowPower, alpha: false, powerPreference: 'high-performance', stencil: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowPower ? 1.25 : 2))
  renderer.setClearColor('#e9dfcd')
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.5, 90000)
  scene.fog = new THREE.FogExp2('#e9dfcd', 1 / 9000)
  const sh = makeShared()
  const hemi = new THREE.HemisphereLight('#f3ecdf', '#6d665c', 0.9), sun = new THREE.DirectionalLight('#fff4e0', 0.55)
  scene.add(hemi, sun)

  const near = decodeGrid(film.terrain.near), wide = decodeGrid(film.terrain.wide)
  const hRaw = (x, z) => { const a = sampleGrid(near, x, z); if (a != null) return a; const b = sampleGrid(wide, x, z); return b == null ? 2 : b }
  const Y = (x, z) => Math.max(hRaw(x, z), -3) * EXAG

  // 地形網格
  const terrMat = terrainMaterial(sh)
  // near 的最外十格往 wide 的高度漸變：兩層解析度不同，不這樣接縫會是一道牆
  {
    const { nx, nz, dx, x0, z0, hf } = near, B = 10
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const e = Math.min(i, j, nx - 1 - i, nz - 1 - j)
      if (e >= B) continue
      const w = sampleGrid(wide, x0 + i * dx, z0 + j * dx)
      if (w != null) hf[j * nx + i] = lerp(w, hf[j * nx + i], smooth(e / B))
    }
  }
  // 路要切進山坡：沿路的高度（沿路平滑過）寫回 near 網格，兩側 40 m 內漸變
  {
    const { nx, nz, dx, x0, z0, hf } = near, acc = new Float32Array(nx * nz), ws = new Float32Array(nx * nz), R = 40
    for (const pts of Object.values(film.roads || {})) {
      const tmp = new Path(pts, (x, z) => hRaw(x, z), { step: 5, lift: 0, smoothM: 30 })
      const hs = new Float32Array(tmp.n)
      for (let i = 0; i < tmp.n; i++) { let a = 0, c = 0; for (let j = Math.max(0, i - 8); j <= Math.min(tmp.n - 1, i + 8); j++) { a += tmp.y[j]; c++ } hs[i] = a / c }
      for (let i = 0; i < tmp.n; i++) {
        const ci = Math.round((tmp.x[i] - x0) / dx), cj = Math.round((tmp.z[i] - z0) / dx), r = Math.ceil(R / dx)
        for (let j = cj - r; j <= cj + r; j++) for (let k = ci - r; k <= ci + r; k++) {
          if (k < 0 || j < 0 || k >= nx || j >= nz) continue
          const d = Math.hypot(x0 + k * dx - tmp.x[i], z0 + j * dx - tmp.z[i]), w = smooth((R - d) / (R - 10))
          if (w <= 0) continue
          const id = j * nx + k
          if (w > ws[id]) { ws[id] = w; acc[id] = hs[i] }
        }
      }
    }
    for (let i = 0; i < nx * nz; i++) if (ws[i] > 0) hf[i] = lerp(hf[i], acc[i], ws[i] * 0.85)
  }
  function gridMesh(g, skip) {
    const { nx, nz, dx, x0, z0, hf } = g, n = nx * nz
    const pos = new Float32Array(n * 3), curv = new Float32Array(n)
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i
      pos[k * 3] = x0 + i * dx; pos[k * 3 + 1] = Math.max(hf[k], -3) * EXAG - (skip && pos[k * 3] > near.x0 && pos[k * 3] < near.x1 && z0 + j * dx > near.z0 && z0 + j * dx < near.z1 ? 3 : 0); pos[k * 3 + 2] = z0 + j * dx
      // 曲率：跟 60 m 外四鄰的平均比，高出＝稜線（負）、低於＝溝谷（正）
      const r = Math.max(1, Math.round(60 / dx)), H = (a, b) => hf[clamp(b, 0, nz - 1) * nx + clamp(a, 0, nx - 1)]
      const avg = (H(i - r, j) + H(i + r, j) + H(i, j - r) + H(i, j + r)) / 4
      curv[k] = clamp((avg - hf[k]) / 9, -1.5, 1.5)
    }
    const idx = []
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
      if (skip) {
        const xa = x0 + i * dx, xb = xa + dx, za = z0 + j * dx, zb = za + dx
        if (xa > skip.x0 && xb < skip.x1 && za > skip.z0 && zb < skip.z1) continue
      }
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1
      idx.push(a, c, b, b, c, d)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('aCurv', new THREE.BufferAttribute(curv, 1))
    geo.setIndex(new THREE.BufferAttribute(n > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1))
    geo.computeVertexNormals()
    return new THREE.Mesh(geo, terrMat)
  }
  const pad = wide.dx * 1.5
  const wideMesh = gridMesh(wide, { x0: near.x0 + pad, x1: near.x1 - pad, z0: near.z0 + pad, z1: near.z1 - pad })
  const nearMesh = gridMesh(near, null)
  scene.add(wideMesh, nearMesh)
  // near 的邊緣往下拉一圈裙邊，兩層網格接縫就不會露出天空
  {
    const { nx, nz, dx, x0, z0, hf } = near, ring = []
    for (let i = 0; i < nx; i++) ring.push([i, 0]); for (let j = 1; j < nz; j++) ring.push([nx - 1, j])
    for (let i = nx - 2; i >= 0; i--) ring.push([i, nz - 1]); for (let j = nz - 2; j > 0; j--) ring.push([0, j])
    ring.push(ring[0])
    const pos = [], idx = []
    ring.forEach(([i, j], k) => { const y = Math.max(hf[j * nx + i], -3) * EXAG; pos.push(x0 + i * dx, y, z0 + j * dx, x0 + i * dx, y - 90, z0 + j * dx); if (k) { const a = (k - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2) } })
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx)
    g.setAttribute('aCurv', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3), 1)); g.computeVertexNormals()
    const skirt = new THREE.Mesh(g, terrMat); scene.add(skirt)
  }

  // 水
  const waterMat = waterMaterial(sh)
  const water = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000), waterMat)
  water.rotation.x = -Math.PI / 2; water.position.y = -1.2; scene.add(water)

  // 天空、太陽
  const skyMat = skyMaterial(), sky = new THREE.Mesh(new THREE.SphereGeometry(70000, 32, 16), skyMat)
  sky.renderOrder = -10; scene.add(sky)
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: discTexture(false), color: '#c9432c', fog: false, depthWrite: false, transparent: true }))
  sunSprite.renderOrder = -9; scene.add(sunSprite)

  // 城市：盆地裡低平、不在水上的地方，畫成一片片淡墨的屋頂記號；越靠近 101 越密
  const places = Object.fromEntries((film.places || []).map(p => [p[0], [p[1], p[2]]]))
  const p101 = places['台北 101'] || [0, 8000]
  let roofs
  {
    const r = rng(101), P = [], Sz = [], Vr = []
    // 下雨那場的鏡頭貼著街面：沿線 70 m 內不放
    const clear = new Set()
    const rainPts = (film.rides && film.rides.rain && film.rides.rain.pts) || []
    for (const q of rainPts) for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) clear.add((Math.round(q[1] / 35) + a) + ',' + (Math.round(q[2] / 35) + b))
    const step = lowPower ? 44 : 31
    for (let z = wide.z0; z < wide.z1; z += step) for (let x = wide.x0; x < wide.x1; x += step) {
      const jx = x + (r() - 0.5) * step * 0.8, jz = z + (r() - 0.5) * step * 0.8, h = hRaw(jx, jz)
      if (h < 0.6 || h > 18) continue
      if (clear.has(Math.round(jx / 35) + ',' + Math.round(jz / 35))) continue
      const d101 = Math.hypot(jx - p101[0], jz - p101[1])
      if (r() > 0.3 + 0.45 * Math.exp(-d101 / 4200)) continue
      let nearWater = false
      for (const [ox, oz] of [[70, 0], [-70, 0], [0, 70], [0, -70]]) if (hRaw(jx + ox, jz + oz) < 0) nearWater = true
      if (nearWater) continue
      const tall = d101 < 2500 && r() < 0.35
      P.push(jx, Math.max(0, h) * EXAG + 6, jz); Sz.push(tall ? 38 + r() * 20 : 18 + r() * 16); Vr.push(tall ? 3 : Math.floor(r() * 3))
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3))
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(Sz, 1))
    g.setAttribute('aVar', new THREE.Float32BufferAttribute(Vr, 1))
    roofs = new THREE.Points(g, roofMaterial(sh, roofAtlas()))
    roofs.frustumCulled = false
    scene.add(roofs)
  }
  {
    // 101：底座＋八節＋塔冠＋天線
    const t = new THREE.Group(), tm = new THREE.MeshLambertMaterial({ color: '#6f7479', fog: true })
    const add = (g, y) => { const mm = new THREE.Mesh(g, tm); mm.position.y = y; t.add(mm) }
    add(new THREE.CylinderGeometry(44, 52, 90, 4), 45)
    for (let k = 0; k < 8; k++) add(new THREE.CylinderGeometry(40, 30, 40, 4), 90 + k * 40 + 20)
    add(new THREE.CylinderGeometry(20, 26, 30, 4), 425); add(new THREE.CylinderGeometry(2, 5, 70, 6), 475)
    t.rotation.y = Math.PI / 4
    t.position.set(p101[0], Math.max(0, hRaw(p101[0], p101[1])) * EXAG, p101[1])
    scene.add(t)
  }

  // 路
  const roadMat = flatMaterial(sh, '#ece4d5'), roadEdge = flatMaterial(sh, '#4a4540', 0.8)
  const paths = {}
  for (const [name, pts] of Object.entries(film.roads || {})) {
    const p = new Path(pts, Y, { step: 5, lift: 1.4 })
    paths[name] = p
    const r = new THREE.Mesh(ribbonGeometry(p, () => 5, { step: 5 }), roadMat); r.renderOrder = 3
    const eL = new THREE.Mesh(ribbonGeometry(p, () => 0.55, { step: 5, offset: -2.7, lift: 0.1 }), roadEdge); eL.renderOrder = 4
    const eR = new THREE.Mesh(ribbonGeometry(p, () => 0.55, { step: 5, offset: 2.7, lift: 0.1 }), roadEdge); eR.renderOrder = 4
    scene.add(r, eL, eR)
  }

  // 路邊的樹：近景用的整棵畫出來的樹（松、點葉、介字點、灌木），永遠直立面向鏡頭
  let roadTrees
  {
    const r = rng(77), P = [], Cn = [], Sz = [], Vr = [], Sh = [], idx = []
    const add = (x, y, z, w, h, v, shade) => {
      const base = P.length / 3
      for (const [cx, cy] of [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]]) { P.push(x, y, z); Cn.push(cx, cy); Sz.push(w, h); Vr.push(v); Sh.push(shade) }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }
    for (const [name, p] of Object.entries(paths)) {
      const dens = name === '中社路' ? 1 : 0.55
      for (let s = 0; s < p.L; s += lowPower ? 8 : 5) {
        const q = p.at(s), [rx, rz] = [Math.cos(q.h), Math.sin(q.h)]
        for (const side of [-1, 1]) {
          if (r() > 0.8 * dens) continue
          const bush = r() < 0.22
          const d = bush ? 5 + r() * 9 : 8 + Math.pow(r(), 1.5) * 44
          const x = q.x + rx * d * side + (r() - 0.5) * 4, z = q.z + rz * d * side + (r() - 0.5) * 4
          const h0 = hRaw(x, z)
          if (h0 < 22) continue                               // 盆地裡不種（那裡是城市）
          const v = bush ? 3 : [0, 0, 1, 1, 1, 2][Math.floor(r() * 6)]
          const ht = bush ? 2.6 + r() * 2.4 : v === 0 ? 10 + r() * 7 : v === 2 ? 9 + r() * 6 : 7 + r() * 6
          add(x, Y(x, z) - 0.6, z, ht * (bush ? 1.8 : v === 1 ? 0.95 : 0.7), ht, v, r())
        }
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3))
    g.setAttribute('aCorner', new THREE.Float32BufferAttribute(Cn, 2))
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(Sz, 2))
    g.setAttribute('aVar', new THREE.Float32BufferAttribute(Vr, 1))
    g.setAttribute('aShade', new THREE.Float32BufferAttribute(Sh, 1))
    g.setIndex(idx)
    roadTrees = new THREE.Mesh(g, billboardMaterial(sh, treeAtlas()))
    roadTrees.frustumCulled = false
    scene.add(roadTrees)
  }

  // 米點樹：陡坡與山上，避開路、水、城市
  let trees
  {
    const roadCells = new Set()
    for (const p of Object.values(paths)) for (let i = 0; i < p.n; i += 2) roadCells.add(Math.round(p.x[i] / 20) + ',' + Math.round(p.z[i] / 20))
    const r = rng(33), P = [], S = [], Sh = [], Nr = []
    const slopeAt = (x, z) => { const e = 20, a = hRaw(x + e, z) - hRaw(x - e, z), b = hRaw(x, z + e) - hRaw(x, z - e); return Math.hypot(a, b) / (2 * e) }
    const scatter = (g, step, keep, sizeK) => {
      for (let z = g.z0; z < g.z1; z += step) for (let x = g.x0; x < g.x1; x += step) {
        const jx = x + (r() - 0.5) * step, jz = z + (r() - 0.5) * step
        if (g === wide && jx > near.x0 && jx < near.x1 && jz > near.z0 && jz < near.z1) continue
        const h = hRaw(jx, jz)
        if (h < 28) continue
        const sl = slopeAt(jx, jz)
        const forest = smooth((vnoise(jx / 520, jz / 520) * 0.65 + vnoise(jx / 170, jz / 170) * 0.35 - 0.42) / 0.22)
        if (r() > keep * forest * (sl < 0.6 ? 1 : 0.4)) continue
        if (roadCells.has(Math.round(jx / 20) + ',' + Math.round(jz / 20))) continue
        P.push(jx, Y(jx, jz) + 4, jz); S.push((8 + r() * r() * 26) * sizeK); Sh.push(clamp(r() * 0.55 + (1 - forest) * 0.3, 0, 1)); Nr.push(g === near ? 1 : 0)
      }
    }
    scatter(near, lowPower ? 18 : 13, 0.62, 1)
    scatter(wide, lowPower ? 70 : 50, 0.62, 2.4)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3))
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(S, 1))
    g.setAttribute('aShade', new THREE.Float32BufferAttribute(Sh, 1))
    g.setAttribute('aNear', new THREE.Float32BufferAttribute(Nr, 1))
    trees = new THREE.Points(g, pointsMaterial(sh, inkDotTexture()))
    trees.frustumCulled = false
    scene.add(trees)
  }

  // 霧帶：幾層水平的紙色薄紗，山頭從裡面冒出來
  const mists = []
  for (let k = 0; k < 5; k++) {
    const tex = mistTexture(11 + k); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(3, 3)
    const m = new THREE.MeshBasicMaterial({ map: tex, color: '#efe6d3', transparent: true, opacity: 0.45, depthWrite: false, fog: true })
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(26000, 26000), m)
    plane.rotation.x = -Math.PI / 2; plane.position.set(0, (70 + k * 65) * EXAG, 2000); plane.renderOrder = 8
    plane.userData.drift = [(k % 2 ? 1 : -1) * (0.002 + k * 0.001), 0.001 * k]
    mists.push(plane); scene.add(plane)
  }

  // 他騎過的每一條路（片尾用）：六個層級，越常騎越粗
  const atlas = []
  {
    const widths = [5, 6, 8, 11, 15, 20]
    ;(film.atlas || []).forEach((lines, tier) => {
      const pos = [], idx = [], off = []
      for (const flat of lines) {
        const pts = []; let x = 0, z = 0
        for (let i = 0; i < flat.length; i += 2) { x += flat[i]; z += flat[i + 1]; pts.push([x, z]) }
        // 長線段要切細才能貼著地形
        const dense = []
        for (let i = 0; i < pts.length - 1; i++) {
          const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / 30))
          for (let k = 0; k < n; k++) dense.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n])
        }
        dense.push(pts[pts.length - 1])
        const w = widths[tier] / 2
        dense.forEach(([x2, z2], i) => {
          const a = dense[Math.max(0, i - 1)], b = dense[Math.min(dense.length - 1, i + 1)]
          let dx = b[0] - a[0], dz = b[1] - a[1]; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L
          const y = Math.max(Y(x2, z2), 0) + 3 + tier * 0.4, base = pos.length / 3
          pos.push(x2, y, z2, x2, y, z2); off.push(-dz * w, 0, dx * w, dz * w, 0, -dx * w)
          if (i) idx.push(base - 2, base - 1, base, base - 1, base + 1, base)
        })
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aOff', new THREE.Float32BufferAttribute(off, 3)); g.setIndex(idx)
      const m = atlasMaterial(sh, tier >= 4 ? '#8f2a20' : '#2a2622')
      const mesh = new THREE.Mesh(g, m); mesh.renderOrder = 6; mesh.visible = false
      scene.add(mesh); atlas.push(mesh)
    })
  }

  // 地名
  const labels = {}
  for (const [name, x, z] of film.places || []) {
    const s = labelSprite(name, { dot: true, px: 28 })
    s.position.set(x, Math.max(Y(x, z), 0) + 60, z); s.visible = false
    scene.add(s); labels[name] = s
  }

  // 雨（相機周圍的一盒線段，頂點著色器自己往下掉）
  const rain = (() => {
    const N = lowPower ? 1400 : 2600, pos = new Float32Array(N * 6), r = rng(5)
    for (let i = 0; i < N; i++) { const x = (r() - 0.5) * 320, y = r() * 220, z = (r() - 0.5) * 320; pos.set([x, y, z, x - 1.0, y - 9, z], i * 6) }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const m = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uC: { value: new THREE.Vector3() }, uA: { value: 0 } },
      vertexShader: `uniform float uT; uniform vec3 uC; varying float vA; void main(){ vec3 p = position; p.y = mod(p.y - uT * 60.0, 220.0) - 90.0; p.x = mod(p.x - uC.x + 160.0, 320.0) - 160.0; p.z = mod(p.z - uC.z + 160.0, 320.0) - 160.0; vec4 mv = viewMatrix * vec4(p + uC, 1.0); vA = clamp(1.0 - (-mv.z) / 260.0, 0.0, 1.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uA; varying float vA; void main(){ gl_FragColor = vec4(0.2, 0.2, 0.22, uA * vA * 0.8); }`,
      transparent: true, depthWrite: false,
    })
    const L = new THREE.LineSegments(g, m); L.frustumCulled = false; L.renderOrder = 30; L.visible = false
    scene.add(L)
    return { mesh: L, mat: m }
  })()

  // 花瓣／落葉
  const petals = (() => {
    const N = 700, pos = new Float32Array(N * 3), r = rng(9)
    for (let i = 0; i < N; i++) pos.set([(r() - 0.5) * 240, r() * 120, (r() - 0.5) * 240], i * 3)
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const m = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uC: { value: new THREE.Vector3() }, uA: { value: 0 }, uCol: { value: col('#e7a3a8') } },
      vertexShader: `uniform float uT; uniform vec3 uC; varying float vA; void main(){ vec3 p = position; float ph = p.x * 0.13 + p.z * 0.07; p.y = mod(p.y - uT * 3.0, 120.0) - 40.0; p.x = mod(p.x + uT * 5.0 + sin(uT * 0.8 + ph) * 3.0 - uC.x + 120.0, 240.0) - 120.0; p.z = mod(p.z - uC.z + 120.0, 240.0) - 120.0; vec4 mv = viewMatrix * vec4(p + uC, 1.0); gl_PointSize = clamp(260.0 / -mv.z, 1.5, 7.0); vA = clamp(1.0 - (-mv.z) / 200.0, 0.0, 1.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uA; uniform vec3 uCol; varying float vA; void main(){ vec2 d = gl_PointCoord - 0.5; if (dot(d, d) > 0.2) discard; gl_FragColor = vec4(uCol, uA * vA); }`,
      transparent: true, depthWrite: false,
    })
    const P = new THREE.Points(g, m); P.frustumCulled = false; P.renderOrder = 31; P.visible = false
    scene.add(P)
    return { mesh: P, mat: m }
  })()

  // 騎士、影子、遠景的朱紅點
  const rider = buildRider()
  scene.add(rider.obj)
  const ghosts = [0, 1, 2, 3].map(() => { const g = buildRider({ ghost: true }); scene.add(g.obj); g.obj.visible = false; return g })
  const dot = (color, px) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: discTexture(false), color, sizeAttenuation: false, depthTest: false, depthWrite: false, fog: false, transparent: true })); s.scale.set(px, px, 1); s.renderOrder = 25; s.visible = false; scene.add(s); return s }
  const riderDot = dot('#b8321f', 0.014)
  const ghostDots = [0, 1, 2, 3].map(() => dot('#4a4540', 0.011))

  // 筆畫
  const strokes = []
  function makeStroke(path, widthAt, o = {}) {
    const m = strokeMaterial(sh, o.color)
    const mesh = new THREE.Mesh(ribbonGeometry(path, widthAt, { step: o.step || 3, offset: o.offset || 0, lift: o.lift == null ? 0.35 : o.lift, s0: o.s0, s1: o.s1, Y: o.terrain ? Y : null, center: true }), m)
    mesh.renderOrder = 5 + (o.order || 0); scene.add(mesh)
    const st = { mesh, mat: m, set(head, alpha, tail) { m.uniforms.uHead.value = head; if (alpha != null) m.uniforms.uAlpha.value = alpha; if (tail != null) m.uniforms.uTail.value = tail; mesh.visible = alpha !== 0 }, tip(a) { m.uniforms.uTipAmt.value = a }, dispose() { scene.remove(mesh); mesh.geometry.dispose(); m.dispose() } }
    strokes.push(st)
    return st
  }
  function pathFromPoints(pts, o) { return new Path(pts, Y, o || {}) }

  // ── 紙上的台灣（一日北彰、三鐵）：單位＝公里 ──────────────────────────
  const map = (() => {
    const ms = new THREE.Scene(), tw = film.taiwan || { arcs: [] }
    ms.background = col('#efe6d3')
    ms.fog = new THREE.Fog('#efe6d3', 700, 1800)
    const E0 = 250, N0 = 2640, toXZ = (E, N) => [E - E0, N0 - N]
    const W = 420, H = 420, R = 2048, c = document.createElement('canvas'); c.width = c.height = R
    const x = c.getContext('2d'), px = (E, N) => { const [a, b] = toXZ(E, N); return [(a + W / 2) / W * R, (b + H / 2) / H * R] }
    // 紙與海
    x.fillStyle = '#efe6d3'; x.fillRect(0, 0, R, R)
    const rr = rng(4)
    for (let i = 0; i < 2600; i++) { x.fillStyle = `rgba(80,70,60,${rr() * 0.035})`; x.fillRect(rr() * R, rr() * R, 1 + rr() * 3, 1 + rr() * 3) }
    // 海岸線：海用淡靛青暈在外側
    x.lineJoin = 'round'; x.lineCap = 'round'
    tw.arcs.forEach((arc, i) => {
      const coast = !tw.kind || tw.kind[i] === 0 || tw.kind[i] === 'coast'
      x.beginPath(); arc.forEach(([E, N], k) => { const [a, b] = px(E, N); k ? x.lineTo(a, b) : x.moveTo(a, b) })
      if (coast) { x.strokeStyle = 'rgba(95,120,128,0.18)'; x.lineWidth = 26; x.stroke(); x.strokeStyle = 'rgba(95,120,128,0.14)'; x.lineWidth = 60; x.stroke(); x.strokeStyle = '#2a2622'; x.lineWidth = 3.2 }
      else { x.strokeStyle = 'rgba(42,38,34,0.28)'; x.lineWidth = 1.4; x.setLineDash([6, 7]) }
      x.stroke(); x.setLineDash([])
    })
    // 中央山脈：沿著島的脊梁點米點
    const spine = [[292, 2770], [300, 2700], [280, 2620], [262, 2560], [250, 2500], [230, 2450]]
    for (let k = 0; k < 4200; k++) {
      const t = rr(), i = Math.min(spine.length - 2, Math.floor(t * (spine.length - 1))), f = t * (spine.length - 1) - i
      const E = lerp(spine[i][0], spine[i + 1][0], f) + (rr() - 0.5) * 44 * (0.4 + rr()), N = lerp(spine[i][1], spine[i + 1][1], f) + (rr() - 0.5) * 30
      const [a, b] = px(E, N)
      x.fillStyle = `rgba(40,36,32,${0.08 + rr() * 0.16})`; x.beginPath(); x.ellipse(a, b, 2 + rr() * 3.5, 1.2 + rr() * 2, 0, 0, Math.PI * 2); x.fill()
    }
    // 地名
    x.font = `32px ${FONT}`; x.fillStyle = '#2a2622'; x.textBaseline = 'middle'
    for (const [n, E, N] of tw.places || []) { const [a, b] = px(E, N); x.fillStyle = '#a8322b'; x.beginPath(); x.arc(a, b, 5, 0, Math.PI * 2); x.fill(); x.fillStyle = '#2a2622'; x.fillText(n, a + 11, b) }
    const tex = new THREE.CanvasTexture(c); tex.anisotropy = 4
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: tex, fog: true }))
    plane.rotation.x = -Math.PI / 2; ms.add(plane)
    // 軌跡：平貼在紙上的毛筆條帶
    const flatPath = (pts, step) => {
      const P2 = pts.map(p => toXZ(p[1], p[2]))
      return new Path(P2.map(p => [p[0], p[1]]), () => 0.05, { step: step || 0.25, lift: 0, smoothM: 3 })
    }
    const tracks = {}
    const mk = (key, pts, width, color) => {
      const p = flatPath(pts)
      const m = strokeMaterial({ uFog: { value: col('#efe6d3') }, uFogD: { value: 0 }, uCam: { value: new THREE.Vector3() }, uMistH: { value: -1e4 }, uMistAmt: { value: 0 }, uTime: { value: 0 } }, color)
      m.uniforms.uNearW.value = m.uniforms.uFarW.value = 1
      const mesh = new THREE.Mesh(ribbonGeometry(p, () => width, { step: 0.12, lift: 0.02, center: true }), m)
      mesh.renderOrder = 4; ms.add(mesh)
      tracks[key] = { path: p, mesh, mat: m, t: pts.map(q => q[0]), set(head, a) { m.uniforms.uHead.value = head; if (a != null) m.uniforms.uAlpha.value = a } }
    }
    const far = film.rides && film.rides.far
    if (far) mk('far', far.pts, 1.8, '#1f1c1a')
    const tri = (film.rides && film.rides.tri) || []
    for (const leg of tri) mk(leg.kind, leg.pts, leg.kind === 'swim' ? 0.7 : 1.1, leg.kind === 'swim' ? '#3f5f6f' : leg.kind === 'run' ? '#6b4f3a' : '#1f1c1a')
    const mdot = new THREE.Sprite(new THREE.SpriteMaterial({ map: discTexture(false), color: '#b8321f', sizeAttenuation: false, depthTest: false, depthWrite: false, fog: false, transparent: true }))
    mdot.scale.set(0.016, 0.016, 1); mdot.renderOrder = 10; ms.add(mdot)
    ms.add(new THREE.HemisphereLight('#ffffff', '#888888', 1))
    return { scene: ms, tracks, dot: mdot, toXZ, plane }
  })()

  // ── 天色／季節預設 ─────────────────────────────────────────────────
  const TOD = {
    dawn:   { top: '#d6d0c9', hor: '#efe0cb', fog: '#ebdfcc', fogD: 1 / 7400, sun: [-0.62, 0.1, 0.72], sunCol: '#c24a33', glow: 0.14, sunVis: 1, sunPx: 0.075, ink: 0.85, mist: 0.62, mistH: 190, light: 0.8, wisp: 0.6, water: '#a9b6b4' },
    morning:{ top: '#cfd6d6', hor: '#efe6d6', fog: '#ece4d6', fogD: 1 / 9500, sun: [-0.4, 0.35, 0.6], sunCol: '#d8a07a', glow: 0.3, sunVis: 0.55, sunPx: 0.05, ink: 0.85, mist: 0.45, mistH: 160, light: 0.95, wisp: 0.5, water: '#a2b4b4' },
    noon:   { top: '#c6cfcf', hor: '#ece5d8', fog: '#e8e2d5', fogD: 1 / 14000, sun: [0.1, 0.9, 0.3], sunCol: '#e2c9a2', glow: 0.1, sunVis: 0.2, sunPx: 0.04, ink: 1.0, mist: 0.2, mistH: 110, light: 1.0, wisp: 0.4, water: '#93a9ab' },
    dusk:   { top: '#a19ea2', hor: '#e9cfae', fog: '#e0cfb7', fogD: 1 / 7400, sun: [0.7, 0.08, 0.6], sunCol: '#b8321f', glow: 0.22, sunVis: 1, sunPx: 0.09, ink: 0.92, mist: 0.5, mistH: 170, light: 0.7, wisp: 0.7, water: '#a5a6a3' },
    winter: { top: '#aeb0b2', hor: '#d9d6d0', fog: '#d6d3cd', fogD: 1 / 5200, sun: [0.2, 0.5, -0.6], sunCol: '#d9d6d0', glow: 0.1, sunVis: 0, sunPx: 0.04, ink: 0.95, mist: 0.75, mistH: 240, light: 0.6, wisp: 0.2, water: '#9aa2a4' },
    storm:  { top: '#6f7276', hor: '#a9aaa8', fog: '#a7a8a6', fogD: 1 / 3600, sun: [0.2, 0.5, -0.6], sunCol: '#999999', glow: 0.0, sunVis: 0, sunPx: 0.04, ink: 1.0, mist: 0.8, mistH: 260, light: 0.45, wisp: 0.1, water: '#8a9092' },
    night:  { top: '#2f3440', hor: '#5b5d63', fog: '#4d5058', fogD: 1 / 7000, sun: [-0.3, 0.6, 0.7], sunCol: '#efe6d3', glow: 0.2, sunVis: 0.9, sunPx: 0.03, ink: 0.7, mist: 0.35, mistH: 140, light: 0.35, wisp: 0.15, water: '#3d4148' },
  }
  const SEASON = {
    spring: { wash: '#a7b791', wash2: '#8fa29a', tree: '#4d5f48', petal: '#e3a6ab' },
    summer: { wash: '#8fab8f', wash2: '#6f9190', tree: '#3d5647', petal: '#f3ecdf' },
    autumn: { wash: '#bba27e', wash2: '#958d80', tree: '#4f4a3c', petal: '#b5652f' },
    winter: { wash: '#a4a5a1', wash2: '#8e9396', tree: '#4c4f4c', petal: '#d8d6d0' },
  }
  const cur = {}
  const P3 = ['top', 'hor', 'fog', 'sunCol', 'water']
  function blendPreset(a, b, t) {
    const A = typeof a === 'string' ? TOD[a] : a, B = typeof b === 'string' ? TOD[b] : b, o = {}
    for (const k in A) {
      if (P3.includes(k)) o[k] = new THREE.Color(A[k]).lerp(new THREE.Color(B[k]), t)
      else if (Array.isArray(A[k])) o[k] = A[k].map((v, i) => lerp(v, B[k][i], t))
      else o[k] = lerp(A[k], B[k], t)
    }
    return o
  }
  function applyTOD(p, season, extra = {}) {
    const S = SEASON[season] || SEASON.spring
    skyMat.uniforms.uTop.value.set(p.top); skyMat.uniforms.uHor.value.set(p.hor)
    const sd = new THREE.Vector3(...p.sun).normalize()
    skyMat.uniforms.uSunDir.value.copy(sd); skyMat.uniforms.uSunCol.value.set(p.sunCol); skyMat.uniforms.uGlow.value = p.glow; skyMat.uniforms.uWisp.value = p.wisp
    sh.uFog.value.set(p.fog); sh.uFogD.value = p.fogD * (extra.fogK || 1); sh.uMistAmt.value = p.mist * (extra.mistK == null ? 1 : extra.mistK); sh.uMistH.value = p.mistH * EXAG
    scene.fog.color.set(p.fog); scene.fog.density = sh.uFogD.value; renderer.setClearColor(p.fog)
    terrMat.uniforms.uSun.value.copy(sd); terrMat.uniforms.uInkAmt.value = p.ink; terrMat.uniforms.uWet.value = extra.wet || 0
    terrMat.uniforms.uWash.value.set(S.wash); terrMat.uniforms.uWash2.value.set(S.wash2)
    trees.material.uniforms.uTint.value.set(S.tree)
    roadTrees.material.uniforms.uTint.value.set(S.tree); roadTrees.material.uniforms.uWashC.value.set(S.wash)
    waterMat.uniforms.uWater.value.set(p.water)
    petals.mat.uniforms.uCol.value.set(S.petal)
    sunSprite.material.color.set(p.sunCol); sunSprite.material.opacity = p.sunVis
    sunSprite.userData.dir = sd; sunSprite.userData.px = p.sunPx
    hemi.intensity = 0.55 + p.light * 0.45; sun.intensity = p.light * 0.55; sun.position.copy(sd).multiplyScalar(1000)
    for (const m of mists) m.material.color.set(p.fog), m.material.opacity = 0.18 + p.mist * 0.45 * (extra.mistK == null ? 1 : extra.mistK)
    Object.assign(cur, { p, season })
  }
  applyTOD(TOD.dawn, 'autumn')

  // ── 每一格 ─────────────────────────────────────────────────────────
  let mode = 'world'
  function resize(w, h) {
    renderer.setSize(w, h, false)
    camera.aspect = w / h; camera.updateProjectionMatrix()
    trees.material.uniforms.uScale.value = h / (2 * Math.tan(camera.fov * Math.PI / 360))
  }
  function frame(t, fx = {}) {
    sh.uTime.value = t; skyMat.uniforms.uTime.value = t
    if (mode === 'map') {
      camera.updateMatrixWorld()
      renderer.render(map.scene, camera)
      return
    }
    sh.uCam.value.copy(camera.position)
    sky.position.copy(camera.position)
    const d = sunSprite.userData.dir || new THREE.Vector3(0, 0.2, -1)
    sunSprite.position.copy(camera.position).addScaledVector(d, 50000)
    const k = sunSprite.userData.px || 0.06
    sunSprite.scale.set(50000 * k, 50000 * k, 1)
    for (const m of mists) { m.material.map.offset.x = t * m.userData.drift[0]; m.material.map.offset.y = t * m.userData.drift[1] }
    trees.material.uniforms.uScale.value = roofs.material.uniforms.uScale.value = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360))
    const ra = fx.rain || 0
    rain.mesh.visible = ra > 0.01; rain.mat.uniforms.uA.value = ra; rain.mat.uniforms.uT.value = t; rain.mat.uniforms.uC.value.copy(camera.position)
    const pa = fx.petals || 0
    petals.mesh.visible = pa > 0.01; petals.mat.uniforms.uA.value = pa; petals.mat.uniforms.uT.value = t; petals.mat.uniforms.uC.value.copy(camera.position)
    renderer.render(scene, camera)
  }

  return {
    THREE, renderer, scene, camera, EXAG, Y, hRaw, paths, rider, ghosts, riderDot, ghostDots, labels, atlas, map, TOD, SEASON,
    makeStroke, pathFromPoints, blendPreset, applyTOD, resize, frame,
    setMode(m) { mode = m },
    get mode() { return mode },
  }
}

window.FilmScene = { create, EXAG, Path }
})()
