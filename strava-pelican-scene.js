/* strava-pelican-scene.js · 鵜鶘海岸的 3D 場景
 *
 * 北海岸台 2 線的黃昏：一隻戴安全帽的白鵜鶘騎公路車往西，海在右手邊，太陽落在前方偏右的海面上。
 * 全部程序化：幾何、路面貼圖、天空、海浪、消波塊、芒草、風車都是現算的，沒有外部圖檔。
 * 只依賴 vendor-three-r128.js 的全域 THREE。
 *
 * 座標（公尺）：車子永遠在原點、朝 -Z 前進，世界往 +Z 流過去（跑步機）。
 *   x > 0 是海側、x < 0 是山側；路面 y = 0，海平面 y = SEA_Y。
 *   物件有固定的「世界座標」Zw（負值＝前方），畫面上的 z = Zw + dist。
 *
 * 油門不是鍵盤：頁面把一趟真實騎乘的逐秒功率／踏頻／心率丟進 setReplay()，
 * 這裡用他的平路物理參數（跟 scripts/estimate-indoor-distance.py 同一組 CdA/Crr/rho）現算速度。
 * 所以畫面上的速度是「那一趟的瓦數搬到北海岸平路上」會騎出來的速度。
 *
 * 介面：PelicanCoast.mount(host, opts) → api；PelicanCoast.parseFit(arrayBuffer) → 逐秒資料
 */
(function () {
'use strict'
const THREE = window.THREE
if (!THREE) { window.PelicanCoast = null; return }

/* ── 常數 ─────────────────────────────────────────────────────────── */
const SEA_Y = -3.4
const ROAD_X0 = -8.9, ROAD_X1 = 1.45
const RAIL_X = 1.62
const CH = 96                          // 地形塊長度
const Z_AHEAD = 1500, Z_BEHIND = 720   // 地形塊涵蓋的範圍（騎士座標）
const LAMP_SP = 32, LAMP_X = 2.3, LAMP_H = 7.4, LAMP_ARM = 2.15
const SUN_AZ = 38 * Math.PI / 180      // 太陽在前方偏右（海那一側）
const MOON_DIR = new THREE.Vector3(-0.42, 0.5, 0.76).normalize()
// 平路物理：跟 estimate-indoor-distance.py 的 flat_distance_m 同一組參數；m = 80 kg 人 + 8 kg 車
const PHYS = { m: 88, g: 9.81, crr: 0.005, cda: 0.36, cdaStand: 0.41, rho: 1.18, eta: 0.975 }
// 傳動：data/drivetrain.json（50/34 × 11–34，輪周 2.111 m）；頁面有讀到會覆寫
const DRIVE = { rings: [34, 50], cogs: [11, 12, 13, 14, 15, 17, 19, 21, 24, 27, 30, 34], circ: 2.111, crank: 0.1725 }

/* ── 小工具 ───────────────────────────────────────────────────────── */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const lerp = (a, b, t) => a + (b - a) * t
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t) }
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt))
function hash1(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s) }
function rng(seed) {
  let s = (seed >>> 0) || 1
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
function vnoise1(x) { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(hash1(i), hash1(i + 1), u) }
function vnoise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy)
  const h = (a, b) => hash1(a * 57 + b * 131)
  return lerp(lerp(h(ix, iy), h(ix + 1, iy), ux), lerp(h(ix, iy + 1), h(ix + 1, iy + 1), ux), uy)
}
function fbm2(x, y, o) { let a = 0.5, s = 0; for (let i = 0; i < (o || 4); i++) { s += a * vnoise2(x, y); x = x * 2.03 + 17.1; y = y * 2.03 + 3.7; a *= 0.5 } return s }
const col = h => new THREE.Color(h)
const lin = h => new THREE.Color(h).convertSRGBToLinear()

// 海岸線：海水碰到岩坡的 x。GLSL 那份用 uShorePh 帶相位，兩邊必須是同一條式子。
const SHORE_K = [0.021, 0.057, 0.13]
const shoreX = zw => 8.2 + 1.9 * Math.sin(zw * SHORE_K[0]) + 0.9 * Math.sin(zw * SHORE_K[1] + 1.3) + 0.45 * Math.sin(zw * SHORE_K[2] + 0.4)

/* ── 地形高度 ─────────────────────────────────────────────────────── */
function landY(x, zw) {                       // x <= ROAD_X0：山側
  const d = ROAD_X0 - x
  if (d < 0.3) return 0.02
  const ditch = d < 1.3 ? -0.32 * Math.sin((d - 0.3) / 1.0 * Math.PI) : 0
  const ridge = 12 + 40 * vnoise1(zw * 0.0042 + 3.1)
  const hill = (1 - Math.exp(-d / 42)) * ridge + d * 0.16 * (0.55 + fbm2(x * 0.017, zw * 0.017, 3))
  const bump = (vnoise2(x * 0.045, zw * 0.045) - 0.5) * 1.0 * smooth(2, 12, d)
  return ditch + hill * smooth(0.8, 5, d) + bump
}
function stripY(x, zw) {                      // x >= ROAD_X1：海側岩坡
  if (x < 1.95) return 0.0
  const sx = shoreX(zw)
  const t = (x - 1.95) / (sx - 1.95)
  if (t < 1) return lerp(0, SEA_Y - 0.15, Math.pow(t, 1.3)) + (vnoise2(x * 0.7, zw * 0.7) - 0.5) * 0.55 * Math.sin(Math.PI * t)
  return SEA_Y - 0.15 - (x - sx) * 0.6
}

/* ── GLSL 共用段 ──────────────────────────────────────────────────── */
const GLSL_NOISE = `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f); i = mod(i, 256.0);
  return mix(mix(hash12(i), hash12(mod(i+vec2(1,0),256.)), u.x), mix(hash12(mod(i+vec2(0,1),256.)), hash12(mod(i+vec2(1,1),256.)), u.x), u.y); }
float fbm(vec2 p){ float a=.5, s=0.; for(int i=0;i<5;i++){ s+=a*vnoise(p); p=p*2.03+vec2(1.7,9.2); a*=.5; } return s; }
`
const GLSL_SKY_DECL = `
uniform vec3 uSunDir; uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uHorizonSun; uniform vec3 uSunGlow;
uniform float uFogDensity; uniform float uSeaY;
vec3 skyBase(vec3 d){
  vec2 a = normalize(d.xz + 1e-5), b = normalize(uSunDir.xz + 1e-5);
  float toward = pow(max(dot(a, b), 0.0), 3.0);
  vec3 hor = mix(uHorizon, uHorizonSun, toward);
  float h = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(hor, uZenith, pow(h, 0.5));
  c += hor * 0.12 * exp(-abs(d.y) * 28.0);
  float cs = dot(d, uSunDir);
  c += uSunGlow * (exp((cs - 1.0) * 5.0) * 0.42 + exp((cs - 1.0) * 55.0) * 0.75);
  if (d.y < 0.0) c = mix(c, uHorizon * 0.55, clamp(-d.y * 3.0, 0.0, 1.0));
  return c;
}
vec3 hazeCol(vec3 d){ return skyBase(normalize(vec3(d.x, max(d.y, 0.0) * 0.35, d.z))); }
float hazeAmt(float dist, float wy){
  float f = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
  return f * exp(-max(wy - uSeaY, 0.0) * 0.0045);
}
`
const GLSL_SKY_FULL = `
uniform vec3 uSunColor; uniform vec3 uCloudLit; uniform vec3 uCloudDark; uniform vec3 uMoonDir;
uniform float uStars; uniform float uTime; uniform float uSunDisc; uniform float uCloudAmt; uniform float uMoon; uniform float uDrift;
vec3 skyFull(vec3 d, float disc, float clouds){
  vec3 c = skyBase(d);
  float cs = dot(d, uSunDir);
  if (clouds > 0.0 && uCloudAmt > 0.0 && d.y > 0.0) {
    vec2 uv = d.xz / (d.y + 0.14) * 1.25 + vec2(uDrift, uDrift * 0.3);
    float n = fbm(uv * 0.85);
    float band = smoothstep(0.0, 0.06, d.y) * (1.0 - smoothstep(0.16, 0.42, d.y));
    float k = smoothstep(0.52, 0.8, n) * band * uCloudAmt;
    float lit = pow(max(cs, 0.0), 2.0) * 0.75 + 0.25 * (1.0 - smoothstep(0.0, 0.22, d.y));
    vec3 cc = mix(uCloudDark, uCloudLit, clamp(lit + (n - 0.62) * 1.2, 0.0, 1.0));
    c = mix(c, cc, k);
  }
  if (uStars > 0.0 && d.y > 0.0) {
    vec3 sp = d * 150.0; vec3 id = floor(sp); vec3 f = fract(sp) - 0.5;
    float hs = hash13(id);
    vec3 jit = vec3(hash13(id + 7.1), hash13(id + 3.7), hash13(id + 1.3)) - 0.5;
    float dd = length(f - jit * 0.6);
    float s = step(0.972, hs) * smoothstep(0.17, 0.0, dd) * (0.62 + 0.38 * sin(uTime * (1.3 + hs * 4.0) + hs * 60.0));
    s *= (hs - 0.972) / 0.028 * 2.4 + 0.35;
    c += vec3(0.86, 0.92, 1.0) * s * uStars * smoothstep(0.0, 0.12, d.y);
    vec3 mwN = normalize(vec3(0.62, 0.35, -0.7));
    float mw = exp(-pow(dot(d, mwN), 2.0) * 14.0);
    c += vec3(0.5, 0.56, 0.78) * mw * fbm(d.xy * 7.0 + d.z * 3.0) * 0.07 * uStars;
  }
  if (uMoon > 0.0) {
    float cm = dot(d, uMoonDir);
    c += vec3(0.88, 0.92, 1.0) * (smoothstep(0.99986, 0.99992, cm) * 2.6 + exp((cm - 1.0) * 380.0) * 0.22) * uMoon;
  }
  if (disc > 0.0) c += uSunColor * smoothstep(0.99962, 0.99978, cs) * uSunDisc;
  return c;
}
`

/* ── 時間 → 天色 ──────────────────────────────────────────────────── */
// 顏色寫成 sRGB，進 shader 前轉線性；e 是太陽仰角（度）。2026-09-23 台北日落 17:51。
const TOD_KEYS = [
  { e: 9,   zen: '#3a66b0', hor: '#c8b7b0', hsun: '#ffd596', sun: '#fff0d0', glow: '#ffbf78', cl: '#ffe2c0', cd: '#8a8699', li: 3.6, ex: 0.62, fog: 0.00095 },
  { e: 3,   zen: '#2d5098', hor: '#d09a8e', hsun: '#ffa55a', sun: '#ffb46a', glow: '#ff8c3c', cl: '#ffb27c', cd: '#7a5a72', li: 3.0, ex: 0.66, fog: 0.00105 },
  { e: 0,   zen: '#274081', hor: '#bf7486', hsun: '#ff7a38', sun: '#ff7c36', glow: '#ff6a2a', cl: '#ff8c5c', cd: '#5a4062', li: 1.6, ex: 0.72, fog: 0.00115 },
  { e: -3,  zen: '#20326a', hor: '#865878', hsun: '#e0563e', sun: '#ff6a3a', glow: '#d24e38', cl: '#e07070', cd: '#3e3252', li: 0.0, ex: 0.86, fog: 0.00115 },
  { e: -6,  zen: '#18234d', hor: '#4a4166', hsun: '#9c455a', sun: '#c04a40', glow: '#86394a', cl: '#86567a', cd: '#282440', li: 0.0, ex: 1.05, fog: 0.00105 },
  { e: -10, zen: '#0f1634', hor: '#222944', hsun: '#3a2a46', sun: '#3a2230', glow: '#2a1c30', cl: '#383250', cd: '#15192b', li: 0.0, ex: 1.5, fog: 0.00095 },
  { e: -16, zen: '#070b1b', hor: '#0e1428', hsun: '#12162a', sun: '#101020', glow: '#0a0a14', cl: '#1b1f33', cd: '#0a0d19', li: 0.0, ex: 1.75, fog: 0.00085 },
]
const TOD_LIN = TOD_KEYS.map(k => ({ e: k.e, li: k.li, ex: k.ex, fog: k.fog, zen: lin(k.zen), hor: lin(k.hor), hsun: lin(k.hsun), sun: lin(k.sun), glow: lin(k.glow), cl: lin(k.cl), cd: lin(k.cd) }))
const elevOf = tod => lerp(9, -16, clamp(tod, 0, 1))
const clockOf = e => 17 * 60 + 51 - e * 3.9            // 分鐘；仰角每掉 1° 大約 3.9 分鐘
function todSample(e) {
  const K = TOD_LIN
  let i = 0
  while (i < K.length - 2 && e < K[i + 1].e) i++
  const a = K[i], b = K[i + 1], t = clamp((a.e - e) / (a.e - b.e), 0, 1)
  const mix = k => a[k].clone().lerp(b[k], t)
  return { zen: mix('zen'), hor: mix('hor'), hsun: mix('hsun'), sun: mix('sun'), glow: mix('glow'), cl: mix('cl'), cd: mix('cd'), li: lerp(a.li, b.li, t), ex: lerp(a.ex, b.ex, t), fog: lerp(a.fog, b.fog, t) }
}

/* ── 材質：所有標準材質都換成「依視線方向取天色」的霧，並可加輪廓光／隨風擺 ── */
const U = {
  uSunDir: { value: new THREE.Vector3(0, 0.1, -1) }, uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
  uHorizonSun: { value: new THREE.Color() }, uSunGlow: { value: new THREE.Color() }, uSunColor: { value: new THREE.Color() },
  uCloudLit: { value: new THREE.Color() }, uCloudDark: { value: new THREE.Color() }, uMoonDir: { value: MOON_DIR.clone() },
  uStars: { value: 0 }, uTime: { value: 0 }, uSunDisc: { value: 0 }, uCloudAmt: { value: 0.85 }, uMoon: { value: 0 }, uDrift: { value: 0 },
  uFogDensity: { value: 0.001 }, uSeaY: { value: SEA_Y }, uCamRot: { value: new THREE.Matrix3() },
  uRim: { value: new THREE.Color(0, 0, 0) }, uWind: { value: 0.3 }, uNight: { value: 0 },
}
function patch(mat, key, opt) {
  opt = opt || {}
  mat.fog = false
  mat.onBeforeCompile = sh => {
    for (const k in U) sh.uniforms[k] = U[k]
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform mat3 uCamRot; uniform vec3 uRim; uniform float uNight;\n' + GLSL_SKY_DECL)
      .replace('#include <tonemapping_fragment>', `{
        vec3 vdW = normalize(uCamRot * (-vViewPosition));
        float dist = length(vViewPosition);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, hazeCol(vdW), hazeAmt(dist, cameraPosition.y + vdW.y * dist));
      }
      #include <tonemapping_fragment>`)
      .replace('#include <fog_fragment>', '')
    if (opt.rim) sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      { float ndv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0); totalEmissiveRadiance += uRim * pow(1.0 - ndv, 3.0) * ${opt.rim.toFixed(2)}; }`)
    if (opt.sway) {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = vec3(instanceMatrix[3].x, instanceMatrix[3].y, instanceMatrix[3].z);
        #else
          vec3 ip = vec3(0.0);
        #endif
        float sw = sin(uTime * 1.6 + ip.x * 0.31 + ip.z * 0.07) * 0.55 + sin(uTime * 2.7 + ip.x * 0.9) * 0.2;
        float hh = max(position.y, 0.0);
        transformed.x += (sw + 0.35) * uWind * hh * hh * 0.28;
        transformed.z += sw * uWind * hh * hh * 0.12;`)
    }
  }
  mat.customProgramCacheKey = () => 'pel-' + key
  return mat
}
function envI(m, p) { m.envMapIntensity = p.envMapIntensity != null ? p.envMapIntensity : 0.55; return m }
const std = (key, p, opt) => patch(envI(new THREE.MeshStandardMaterial(p), p), key, opt)
const phy = (key, p, opt) => patch(envI(new THREE.MeshPhysicalMaterial(p), p), key, opt)

/* ── 幾何小工具 ───────────────────────────────────────────────────── */
function merge(geos) {
  const parts = geos.map(g => (g.index ? g.toNonIndexed() : g))
  const hasCol = parts.every(g => g.attributes.color)
  let n = 0; parts.forEach(g => { n += g.attributes.position.count })
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), cl = hasCol ? new Float32Array(n * 3) : null
  let o = 0
  parts.forEach(g => {
    pos.set(g.attributes.position.array, o * 3)
    nor.set(g.attributes.normal.array, o * 3)
    if (cl) cl.set(g.attributes.color.array, o * 3)
    o += g.attributes.position.count
  })
  const m = new THREE.BufferGeometry()
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  m.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  if (cl) m.setAttribute('color', new THREE.BufferAttribute(cl, 3))
  return m
}
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3()
function xf(g, p, r, s) {
  _e.set(r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0)
  _m4.compose(_v.set(p ? p[0] : 0, p ? p[1] : 0, p ? p[2] : 0), _q.setFromEuler(_e), _v2.set(s ? s[0] : 1, s ? s[1] : 1, s ? s[2] : 1))
  g.applyMatrix4(_m4)
  return g
}
function tint(g, hex) {
  const c = col(hex).convertSRGBToLinear(), n = g.attributes.position.count, a = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3))
  return g
}
// 讓 obj 的 +Y 指向 a→b，+Z 盡量靠近 hint；scale.y＝長度（幾何要是高 1、置中的）
const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3()
function orient(obj, a, b, hint, alongScale) {
  _by.subVectors(b, a); const len = _by.length() || 1e-6; _by.multiplyScalar(1 / len)
  _bz.copy(hint || _v3.set(0, 0, 1)); _bz.addScaledVector(_by, -_bz.dot(_by))
  if (_bz.lengthSq() < 1e-8) _bz.set(1, 0, 0).addScaledVector(_by, -_by.x)
  _bz.normalize(); _bx.crossVectors(_by, _bz)
  _m4.makeBasis(_bx, _by, _bz); obj.quaternion.setFromRotationMatrix(_m4)
  obj.position.addVectors(a, b).multiplyScalar(0.5)
  if (alongScale !== false) obj.scale.y = len
  return len
}
// 沿路徑放樣：rings[i] = { c:Vector3, r:[rx,ry], frame:{t,n,b} } → 管狀 BufferGeometry（可就地更新）
function loftGeometry(nRing, nSide) {
  const g = new THREE.BufferGeometry()
  const pos = new Float32Array(nRing * (nSide + 1) * 3), nor = new Float32Array(pos.length), uv = new Float32Array(nRing * (nSide + 1) * 2)
  const idx = []
  for (let i = 0; i < nRing - 1; i++) for (let j = 0; j < nSide; j++) {
    const a = i * (nSide + 1) + j, b = a + nSide + 1
    idx.push(a, b, a + 1, b, b + 1, a + 1)
  }
  for (let i = 0; i < nRing; i++) for (let j = 0; j <= nSide; j++) { uv[(i * (nSide + 1) + j) * 2] = j / nSide; uv[(i * (nSide + 1) + j) * 2 + 1] = i / (nRing - 1) }
  g.setIndex(idx)
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  g.userData = { nRing, nSide }
  return g
}
function loftUpdate(g, pts, radii, up, shape) {
  const { nRing, nSide } = g.userData
  const P = g.attributes.position.array, N = g.attributes.normal.array
  const t = new THREE.Vector3(), n = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
  for (let i = 0; i < nRing; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(nRing - 1, i + 1)]
    t.subVectors(p1, p0).normalize()
    b.crossVectors(t, up || _v3.set(1, 0, 0)).normalize()
    if (b.lengthSq() < 1e-6) b.set(0, 1, 0)
    n.crossVectors(b, t).normalize()
    const rx = radii[i][0], ry = radii[i][1]
    for (let j = 0; j <= nSide; j++) {
      const a = j / nSide * Math.PI * 2
      let cx = Math.cos(a), cy = Math.sin(a)
      if (shape) { const s = shape(i / (nRing - 1), a); cx = s[0]; cy = s[1] }
      c.copy(pts[i]).addScaledVector(n, cx * rx).addScaledVector(b, cy * ry)
      const k = (i * (nSide + 1) + j) * 3
      P[k] = c.x; P[k + 1] = c.y; P[k + 2] = c.z
      const nx = n.x * cx / Math.max(rx, 1e-4) + b.x * cy / Math.max(ry, 1e-4)
      const ny = n.y * cx / Math.max(rx, 1e-4) + b.y * cy / Math.max(ry, 1e-4)
      const nz = n.z * cx / Math.max(rx, 1e-4) + b.z * cy / Math.max(ry, 1e-4)
      const l = Math.hypot(nx, ny, nz) || 1
      N[k] = nx / l; N[k + 1] = ny / l; N[k + 2] = nz / l
    }
  }
  g.attributes.position.needsUpdate = true
  g.attributes.normal.needsUpdate = true
  g.computeBoundingSphere()
}
function canvasTex(w, h, draw, srgb) {
  const c = document.createElement('canvas'); c.width = w; c.height = h
  draw(c.getContext('2d'), w, h)
  const t = new THREE.CanvasTexture(c)
  if (srgb !== false) t.encoding = THREE.sRGBEncoding
  return t
}

/* ── 發光點（路燈燈頭、車燈、風車警示燈、漁火）：一個 InstancedMesh 的面向鏡頭四邊形 ── */
function makeGlowField(max) {
  const geo = new THREE.PlaneGeometry(1, 1)
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: true,
    uniforms: {},
    vertexShader: `
      attribute vec4 aCol; attribute float aSize; varying vec4 vCol; varying vec2 vUv;
      void main(){
        vUv = uv; vCol = aCol;
        vec4 c = modelViewMatrix * vec4(instanceMatrix[3].xyz, 1.0);
        c.xy += position.xy * aSize;
        gl_Position = projectionMatrix * c;
      }`,
    fragmentShader: `
      varying vec4 vCol; varying vec2 vUv;
      void main(){
        float d = length(vUv - 0.5) * 2.0;
        float g = exp(-d * d * 7.0) * 0.85 + exp(-d * 18.0) * 1.4;
        g *= smoothstep(1.0, 0.7, d);
        gl_FragColor = vec4(vCol.rgb * vCol.a * g, 1.0);
        #include <tonemapping_fragment>
        #include <encodings_fragment>
      }`,
  })
  const mesh = new THREE.InstancedMesh(geo, mat, max)
  const aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4)
  const aSize = new THREE.InstancedBufferAttribute(new Float32Array(max), 1)
  geo.setAttribute('aCol', aCol); geo.setAttribute('aSize', aSize)
  mesh.frustumCulled = false; mesh.count = 0; mesh.renderOrder = 5
  const m = new THREE.Matrix4()
  return {
    mesh, n: 0,
    reset() { this.n = 0 },
    add(x, y, z, size, c, a) {
      if (this.n >= max) return
      const i = this.n++
      m.makeTranslation(x, y, z); mesh.setMatrixAt(i, m)
      aCol.array[i * 4] = c.r; aCol.array[i * 4 + 1] = c.g; aCol.array[i * 4 + 2] = c.b; aCol.array[i * 4 + 3] = a
      aSize.array[i] = size
    },
    commit() { mesh.count = this.n; mesh.instanceMatrix.needsUpdate = true; aCol.needsUpdate = true; aSize.needsUpdate = true },
  }
}

/* ══ 世界 ════════════════════════════════════════════════════════════ */
function roadTexture(aniso) {
  const W = 1024, H = 1024
  const px = x => (x - ROAD_X0) / (ROAD_X1 - ROAD_X0) * W
  const t = canvasTex(W, H, (g) => {
    g.fillStyle = '#434346'; g.fillRect(0, 0, W, H)
    g.fillStyle = '#4b4a4c'; g.fillRect(px(-0.62), 0, W - px(-0.62), H)
    g.fillStyle = '#48474a'; g.fillRect(0, 0, px(-7.8), H)
    ;[-1.7, -3.1, -5.3, -6.7].forEach(x => {
      const gr = g.createLinearGradient(px(x - 0.5), 0, px(x + 0.5), 0)
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(18,18,20,.2)'); gr.addColorStop(1, 'rgba(0,0,0,0)')
      g.fillStyle = gr; g.fillRect(px(x - 0.5), 0, px(x + 0.5) - px(x - 0.5), H)
    })
    const r = rng(11)
    for (let i = 0; i < 9; i++) {                       // 補丁：舊柏油修補的深色塊
      const x = r() * W, y = r() * H, w = 40 + r() * 160, h = 60 + r() * 260
      g.fillStyle = `rgba(28,28,30,${0.12 + r() * 0.12})`
      for (const dy of [0, -H, H]) g.fillRect(x, y + dy, w, h)
    }
    for (let i = 0; i < 30000; i++) {
      const x = r() * W, y = r() * H, s = r() * 1.7 + 0.4, v = r()
      g.fillStyle = v < 0.52 ? `rgba(16,16,18,${0.22 + r() * 0.3})` : `rgba(160,156,150,${0.1 + r() * 0.22})`
      g.fillRect(x, y, s, s); if (y > H - 3) g.fillRect(x, y - H, s, s)
    }
    const line = (x, w, c) => { g.fillStyle = c; g.fillRect(px(x - w / 2), 0, px(x + w / 2) - px(x - w / 2), H) }
    line(-0.62, 0.15, '#e6e2d8'); line(-7.8, 0.15, '#e6e2d8')
    line(-4.12, 0.11, '#dcae3e'); line(-4.30, 0.11, '#dcae3e')
    for (let i = 0; i < 2600; i++) {                    // 標線磨耗
      const xs = [-0.62, -7.8, -4.12, -4.3][i % 4], x = px(xs) + (r() - 0.5) * 16, y = r() * H
      g.fillStyle = `rgba(60,60,62,${0.25 + r() * 0.35})`; g.fillRect(x, y, 1 + r() * 2, 1 + r() * 3)
    }
    g.fillStyle = '#8f8d87'; g.fillRect(0, 0, px(-8.62), H)          // 山側水泥溝
  })
  t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso
  return t
}

// W 型護欄橫梁：沿 -z 拉長的一條開放斷面帶
function railBeamGeometry(len) {
  const prof = [[0, 0], [-0.075, 0.05], [-0.075, 0.1], [0, 0.155], [-0.075, 0.21], [-0.075, 0.26], [0, 0.31]]
  const nz = 3, pos = [], nor = [], idx = []
  const pn = []
  for (let i = 0; i < prof.length; i++) {
    const a = prof[Math.max(0, i - 1)], b = prof[Math.min(prof.length - 1, i + 1)]
    const tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty)
    pn.push([ty / l, -tx / l])                           // 朝路面那一側
  }
  for (let k = 0; k < nz; k++) {
    const z = -len * k / (nz - 1)
    prof.forEach((p, i) => { pos.push(p[0], p[1], z); nor.push(-Math.abs(pn[i][0]), pn[i][1], 0) })
  }
  const np = prof.length
  for (let k = 0; k < nz - 1; k++) for (let i = 0; i < np - 1; i++) {
    const a = k * np + i, b = a + np
    idx.push(a, b, a + 1, b, b + 1, a + 1)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setIndex(idx)
  return g
}

// 消波塊：四支圓錐腳沿四面體方向
function tetrapodGeometry() {
  const dirs = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]].map(d => new THREE.Vector3(...d).normalize())
  const parts = dirs.map(d => {
    const g = new THREE.CylinderGeometry(0.17, 0.34, 0.78, 9, 1)
    g.translate(0, 0.39, 0)
    const o = new THREE.Object3D(); o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d); o.updateMatrix()
    g.applyMatrix4(o.matrix)
    return g
  })
  parts.push(new THREE.SphereGeometry(0.36, 10, 8))
  return merge(parts)
}
function rockGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 1)
  const p = g.attributes.position, r = rng(seed)
  const off = []
  for (let i = 0; i < 12; i++) off.push(0.75 + r() * 0.5)
  for (let i = 0; i < p.count; i++) {
    _v.fromBufferAttribute(p, i)
    const k = 0.72 + 0.28 * vnoise2(_v.x * 1.7 + seed, _v.z * 1.7 + _v.y) + 0.12 * off[i % 12]
    _v.multiplyScalar(k); _v.y *= 0.62
    p.setXYZ(i, _v.x, _v.y, _v.z)
  }
  g.computeVertexNormals()
  return g
}
// 芒草叢：幾根細葉＋頂端的淡金色花穗（頂點色）
function silvergrassGeometry() {
  const parts = [], r = rng(5)
  for (let i = 0; i < 8; i++) {
    const h = 0.55 + r() * 0.55, a = r() * Math.PI * 2, lean = 0.1 + r() * 0.22
    const blade = new THREE.PlaneGeometry(0.02, h, 1, 5)
    blade.translate(0, h / 2, 0)
    const p = blade.attributes.position
    for (let k = 0; k < p.count; k++) { const y = p.getY(k); p.setX(k, p.getX(k) + Math.pow(y / h, 2) * lean * h) }
    blade.rotateY(a); blade.computeVertexNormals()
    tint(blade, i % 3 ? '#66733a' : '#8c8748')
    parts.push(blade)
  }
  // 花穗：一根細莖頂端垂下來的幾條細絲，淡銀帶粉
  for (let i = 0; i < 4; i++) {
    const h = 1.05 + r() * 0.45, a = r() * Math.PI * 2, bend = 0.25 + r() * 0.2
    const stem = new THREE.PlaneGeometry(0.012, h, 1, 4); stem.translate(0, h / 2, 0)
    const sp = stem.attributes.position
    for (let k = 0; k < sp.count; k++) { const y = sp.getY(k); sp.setX(k, sp.getX(k) + Math.pow(y / h, 3) * bend * 0.4) }
    stem.rotateY(a); stem.computeVertexNormals(); tint(stem, '#9a9255'); parts.push(stem)
    for (let f = 0; f < 5; f++) {
      const L = 0.22 + r() * 0.12
      const fil = new THREE.PlaneGeometry(0.03, L, 1, 3)
      fil.translate(0, -L / 2, 0)
      const fp = fil.attributes.position
      for (let k = 0; k < fp.count; k++) { const y = -fp.getY(k) / L; fp.setX(k, fp.getX(k) * (1 - y * 0.7)); fp.setZ(k, y * y * 0.08) }
      fil.rotateZ(-0.6 - f * 0.12 - bend); fil.rotateY((f - 2) * 0.35)
      fil.translate(bend * 0.4, h, 0); fil.rotateY(a); fil.computeVertexNormals()
      tint(fil, f % 2 ? '#e6d6c4' : '#d9c3b4')
      parts.push(fil)
    }
  }
  return merge(parts)
}

/* ══ 騎士：公路車＋鵜鶘 ══════════════════════════════════════════════ */
function buildRider(Q) {
  const rider = new THREE.Group()                  // 側傾（lean）繞地面接觸點
  const bike = new THREE.Group(); rider.add(bike)
  const M = {
    frame: phy('frame', { color: col('#20325c').convertSRGBToLinear(), metalness: 0.25, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 }),
    accent: phy('accent', { color: lin('#ff8a45'), metalness: 0.1, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.1 }),
    carbon: std('carbon', { color: lin('#141518'), metalness: 0.35, roughness: 0.34 }),
    tire: std('tire', { color: lin('#1a1a1b'), roughness: 0.92 }),
    gum: std('gum', { color: lin('#a47a45'), roughness: 0.85 }),
    metal: std('metal', { color: lin('#c9ccd1'), metalness: 1, roughness: 0.28 }),
    dark: std('dark', { color: lin('#2a2b2f'), metalness: 0.6, roughness: 0.4 }),
    black: std('black', { color: lin('#101012'), roughness: 0.6 }),
    tape: std('tape', { color: lin('#f1ece2'), roughness: 0.7 }),
    bottle: std('bottle', { color: lin('#eef0ee'), roughness: 0.4 }),
    feather: std('feather', { color: lin('#f4efe6'), roughness: 0.82, vertexColors: true }, { rim: 1.0 }),
    featherPlain: std('featherP', { color: lin('#f4efe6'), roughness: 0.84 }, { rim: 1.0 }),
    primaries: std('prim', { color: lin('#1c1b1d'), roughness: 0.7 }, { rim: 0.35 }),
    beak: std('beak', { color: lin('#ffffff'), roughness: 0.42, vertexColors: true }, { rim: 0.4 }),
    pouch: std('pouch', { color: lin('#f2a24e'), roughness: 0.5 }, { rim: 0.7 }),
    leg: std('leg', { color: lin('#f08a4b'), roughness: 0.55 }, { rim: 0.4 }),
    skin: std('skin', { color: lin('#f2b38a'), roughness: 0.55 }),
    iris: std('iris', { color: lin('#5a2418'), roughness: 0.15, metalness: 0.1 }),
    pupil: std('pupil', { color: lin('#050505'), roughness: 0.1 }),
    shine: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    helmet: phy('helmet', { color: lin('#ffffff'), roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12, vertexColors: true }),
    lens: phy('lens', { color: lin('#2a1e1a'), metalness: 0.9, roughness: 0.08, clearcoat: 1 }),
    saddle: std('saddle', { color: lin('#18181a'), roughness: 0.55 }),
    screen: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    lightW: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.97, 0.9) }),
    lightR: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.08, 0.05) }),
  }
  const cyl = (r0, r1, seg) => new THREE.CylinderGeometry(r1, r0, 1, seg || 12, 1)
  const add = (geo, mat, parent, cast) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast !== false; m.receiveShadow = true; (parent || bike).add(m); return m }
  const V = (x, y, z) => new THREE.Vector3(x, y, z)
  const tube = (a, b, r0, r1, mat, parent, hint) => { const m = add(cyl(r0, r1 == null ? r0 : r1, 14), mat, parent); orient(m, a, b, hint); return m }

  // 幾何（公尺，BB 在 (0,.27,0)，前進方向 -Z）
  const BB = V(0, 0.27, 0), RA = V(0, 0.336, 0.405), FA = V(0, 0.336, -0.585)
  const SC = V(0, 0.775, 0.148), HT = V(0, 0.83, -0.39), HB = V(0, 0.69, -0.435)
  tube(SC, HT, 0.017, 0.019, M.frame)                                 // 上管
  tube(BB, HB, 0.027, 0.024, M.frame)                                 // 下管
  tube(BB, SC, 0.021, 0.018, M.frame)                                 // 立管
  tube(HB, HT, 0.024, 0.021, M.frame)                                 // 頭管
  for (const s of [-1, 1]) {
    tube(V(0.02 * s, 0.27, 0.03), V(0.063 * s, 0.336, 0.405), 0.012, 0.01, M.frame)        // 後下叉
    tube(V(0.018 * s, 0.745, 0.158), V(0.063 * s, 0.336, 0.405), 0.009, 0.008, M.frame)    // 後上叉
    tube(V(0.042 * s, 0.665, -0.448), V(0.053 * s, 0.336, -0.585), 0.014, 0.009, M.accent) // 前叉
  }
  add(xf(new THREE.BoxGeometry(0.1, 0.035, 0.05), [0, 0.672, -0.447]), M.accent)            // 前叉肩
  const seatDir = V(0, 0.505, 0.148).normalize()
  tube(SC.clone().addScaledVector(seatDir, -0.02), BB.clone().addScaledVector(seatDir, 0.705), 0.013, 0.013, M.carbon) // 座管
  // 座墊
  const sad = new THREE.SphereGeometry(1, 18, 10); xf(sad, [0, 0.965, 0.2], [0.08, 0, 0], [0.06, 0.022, 0.14])
  const sadNose = new THREE.SphereGeometry(1, 14, 8); xf(sadNose, [0, 0.967, 0.1], [0.05, 0, 0], [0.028, 0.02, 0.09])
  add(sad, M.saddle); add(sadNose, M.saddle)
  // 龍頭、把手
  tube(V(0, 0.855, -0.395), V(0, 0.846, -0.505), 0.016, 0.016, M.carbon)
  add(xf(cyl(0.013, 0.013), [0, 0.846, -0.505], [0, 0, Math.PI / 2], [1, 0.4, 1]), M.tape)
  for (const s of [-1, 1]) {
    const curve = new THREE.CatmullRomCurve3([V(0.19 * s, 0.846, -0.505), V(0.205 * s, 0.85, -0.565), V(0.21 * s, 0.82, -0.622), V(0.214 * s, 0.76, -0.64), V(0.215 * s, 0.722, -0.6), V(0.215 * s, 0.716, -0.54)])
    add(new THREE.TubeGeometry(curve, 24, 0.0125, 8, false), M.tape)
    const hood = new THREE.SphereGeometry(1, 12, 8); xf(hood, [0.207 * s, 0.868, -0.592], [-0.5, 0, 0], [0.018, 0.022, 0.042]); add(hood, M.black)
    add(xf(new THREE.BoxGeometry(0.012, 0.11, 0.018), [0.21 * s, 0.81, -0.625], [0.35, 0, 0]), M.black)   // 煞變把
  }
  // 碼表＋前燈
  add(xf(new THREE.BoxGeometry(0.028, 0.01, 0.07), [0, 0.852, -0.56]), M.dark)
  add(xf(new THREE.BoxGeometry(0.052, 0.014, 0.078), [0, 0.866, -0.585], [-0.22, 0, 0]), M.black)
  const scrTex = canvasTex(128, 96, () => {})
  const scr = add(xf(new THREE.PlaneGeometry(0.042, 0.06), [0, 0.8738, -0.587], [-Math.PI / 2 - 0.22, 0, 0]), new THREE.MeshBasicMaterial({ map: scrTex, toneMapped: false }), bike, false)
  add(xf(cyl(0.013, 0.013), [0, 0.835, -0.585], [Math.PI / 2, 0, 0], [1, 0.05, 1]), M.dark)
  add(xf(new THREE.CircleGeometry(0.011, 16), [0, 0.835, -0.611], [Math.PI, 0, 0]), M.lightW, bike, false)
  // 尾燈
  add(xf(new THREE.BoxGeometry(0.03, 0.05, 0.022), [0, 0.86, 0.205], [0.28, 0, 0]), M.black)
  const tailLens = add(xf(new THREE.PlaneGeometry(0.024, 0.04), [0, 0.86, 0.218], [0.28, 0, 0]), M.lightR, bike, false)
  // 水壺
  add(xf(cyl(0.035, 0.035, 16), [0, 0.52, -0.2], [-0.95, 0, 0], [1, 0.2, 1]), M.bottle)
  add(xf(cyl(0.017, 0.02, 10), [0, 0.61, -0.264], [-0.95, 0, 0], [1, 0.03, 1]), M.accent)

  // 輪組
  function wheel(center, front) {
    const g = new THREE.Group(); g.position.copy(center); bike.add(g)
    const rimProf = [V(0.262, 0, 0), V(0.27, 0.011, 0), V(0.305, 0.0122, 0), V(0.312, 0.0105, 0), V(0.312, -0.0105, 0), V(0.305, -0.0122, 0), V(0.27, -0.011, 0), V(0.262, 0, 0)].map(p => new THREE.Vector2(p.x, p.y))
    const rim = new THREE.LatheGeometry(rimProf, 64); rim.rotateZ(Math.PI / 2)
    add(rim, M.carbon, g)
    const tireG = new THREE.TorusGeometry(0.3245, 0.0135, 10, 72); tireG.rotateY(Math.PI / 2)
    add(tireG, M.tire, g)
    const gumG = new THREE.TorusGeometry(0.3165, 0.0052, 6, 72); gumG.rotateY(Math.PI / 2)
    for (const s of [-1, 1]) { const gg = gumG.clone(); gg.translate(0.0115 * s, 0, 0); add(gg, M.gum, g, false) }
    const decal = new THREE.TorusGeometry(0.287, 0.0055, 4, 24, 1.1); decal.rotateY(Math.PI / 2)
    for (const s of [-1, 1]) for (const k of [0, Math.PI]) { const d = decal.clone(); d.rotateX(k); d.translate(0.0128 * s, 0, 0); add(d, M.tape, g, false) }
    add(xf(cyl(0.02, 0.02), [0, 0, 0], [0, 0, Math.PI / 2], [1, 0.11, 1]), M.dark, g)
    const spokes = []; const nSp = front ? 20 : 24
    for (let i = 0; i < nSp; i++) {
      const a = i / nSp * Math.PI * 2, side = i % 2 ? 1 : -1
      const hub = V(0.034 * side, Math.cos(a) * 0.024, Math.sin(a) * 0.024)
      const rimP = V(0.002 * side, Math.cos(a + 0.12 * side) * 0.262, Math.sin(a + 0.12 * side) * 0.262)
      const sp = new THREE.CylinderGeometry(0.0011, 0.0011, 1, 4, 1)
      const o = new THREE.Object3D(); orient(o, hub, rimP); o.updateMatrix(); sp.applyMatrix4(o.matrix)
      spokes.push(sp)
    }
    add(merge(spokes), M.dark, g, false)
    const rotor = xf(cyl(0.08, 0.08, 32), [-0.052, 0, 0], [0, 0, Math.PI / 2], [1, 0.0018, 1]); add(rotor, M.metal, g)
    add(xf(cyl(0.05, 0.05, 6), [-0.05, 0, 0], [0, 0, Math.PI / 2], [1, 0.004, 1]), M.dark, g)
    return g
  }
  const wheelF = wheel(FA, true), wheelR = wheel(RA, false)
  add(xf(new THREE.BoxGeometry(0.02, 0.05, 0.06), [-0.06, 0.4, 0.37]), M.dark)          // 後卡鉗
  add(xf(new THREE.BoxGeometry(0.02, 0.05, 0.06), [-0.06, 0.4, -0.555]), M.dark)        // 前卡鉗
  // 飛輪（跟著後輪轉）
  const cas = []
  DRIVE.cogs.slice().reverse().forEach((t, i) => {
    const r = t * 0.00202
    cas.push(xf(cyl(r, r, 24), [0.026 + i * 0.0036, 0, 0], [0, 0, Math.PI / 2], [1, 0.0019, 1]))
  })
  add(merge(cas), M.metal, wheelR)
  // 大齒盤＋曲柄
  const crank = new THREE.Group(); crank.position.copy(BB); bike.add(crank)
  function ringGeo(teeth, r) {
    const sh = new THREE.Shape(), n = teeth * 2
    for (let i = 0; i <= n; i++) { const a = i / n * Math.PI * 2, rr = i % 2 ? r : r - 0.004; const x = Math.cos(a) * rr, y = Math.sin(a) * rr; i ? sh.lineTo(x, y) : sh.moveTo(x, y) }
    const hole = new THREE.Path(); hole.absarc(0, 0, r - 0.017, 0, Math.PI * 2, true); sh.holes.push(hole)
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.003, bevelEnabled: false, curveSegments: 4 })
    g.rotateY(Math.PI / 2)
    return g
  }
  add(xf(ringGeo(50, 0.101), [0.047, 0, 0]), M.metal, crank)
  add(xf(ringGeo(34, 0.069), [0.04, 0, 0]), M.metal, crank)
  const spider = []
  for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2 + 0.4; spider.push(xf(new THREE.BoxGeometry(0.006, 0.075, 0.016), [0.046, Math.cos(a) * 0.045, -Math.sin(a) * 0.045], [a, 0, 0])) }
  add(merge(spider), M.black, crank)
  add(xf(cyl(0.012, 0.012), [0, 0, 0], [0, 0, Math.PI / 2], [1, 0.14, 1]), M.dark, crank)
  const armGeo = new THREE.BoxGeometry(0.013, DRIVE.crank, 0.024); armGeo.translate(0, DRIVE.crank / 2, 0)
  add(xf(armGeo.clone(), [0.066, 0, 0]), M.black, crank)
  add(xf(armGeo.clone(), [-0.066, 0, 0], [Math.PI, 0, 0]), M.black, crank)
  const pedalR = new THREE.Group(); pedalR.position.set(0.1, DRIVE.crank, 0); crank.add(pedalR)
  const pedalL = new THREE.Group(); pedalL.position.set(-0.1, -DRIVE.crank, 0); crank.add(pedalL)
  for (const p of [pedalR, pedalL]) { add(new THREE.BoxGeometry(0.06, 0.016, 0.085), M.black, p); add(xf(new THREE.BoxGeometry(0.03, 0.003, 0.05), [0, 0.009, 0]), M.accent, p) }
  // 鏈條：一條管子，貼圖捲動模擬鏈節
  const chainTex = canvasTex(64, 8, (g, w, h) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#8d9096' : '#3a3c40'; g.fillRect(i * 8, 0, 8, h) } }, false)
  chainTex.wrapS = THREE.RepeatWrapping
  const chainMat = std('chain', { color: 0xffffff, map: chainTex, metalness: 0.8, roughness: 0.35 })
  let chainMesh = null
  function buildChain(ring, cog) {
    const rr = ring * 0.00202, rc = cog * 0.00202, x = 0.043
    const pts = [V(x, BB.y + rr, BB.z), V(x, RA.y + rc + 0.001, RA.z - rc * 0.2), V(x, RA.y + rc * 0.2, RA.z + rc), V(x, RA.y - rc * 0.9, RA.z + rc * 0.2),
      V(x, RA.y - 0.066, RA.z + 0.012), V(x, RA.y - 0.13, RA.z - 0.02), V(x, BB.y - rr * 0.6, BB.z + rr * 0.9), V(x, BB.y - rr, BB.z), V(x, BB.y - rr * 0.2, BB.z - rr), V(x, BB.y + rr * 0.8, BB.z - rr * 0.6)]
    const curve = new THREE.CatmullRomCurve3(pts, true)
    if (chainMesh) { chainMesh.geometry.dispose(); bike.remove(chainMesh) }
    chainMesh = add(new THREE.TubeGeometry(curve, 160, 0.0034, 5, true), chainMat, bike, false)
    chainTex.repeat.set(curve.getLength() / 0.0254, 1)
  }
  buildChain(50, 17)
  // 後變速器
  const rd = new THREE.Group(); rd.position.set(0.05, RA.y - 0.1, RA.z + 0.0); bike.add(rd)
  add(xf(new THREE.BoxGeometry(0.014, 0.1, 0.03), [0, 0.02, 0], [0.3, 0, 0]), M.black, rd)
  const jock1 = add(xf(cyl(0.012, 0.012), [0, 0.034, 0.012], [0, 0, Math.PI / 2], [1, 0.006, 1]), M.dark, rd)
  const jock2 = add(xf(cyl(0.012, 0.012), [0, -0.03, -0.02], [0, 0, Math.PI / 2], [1, 0.006, 1]), M.dark, rd)
  add(xf(new THREE.BoxGeometry(0.012, 0.035, 0.045), [0.028, 0.61, 0.16], [0.3, 0, 0]), M.black)   // 前變速器

  /* ── 鵜鶘 ── */
  const pel = new THREE.Group(); rider.add(pel)
  const body = new THREE.Group(); pel.add(body)
  // 沿 -z 放樣：fn(t, a) → [x, y, z]；每一幀可以就地重寫
  function sweepZ(nRing, nSide, fn, g) {
    g = g || loftGeometry(nRing, nSide + 0)
    const P = g.attributes.position.array
    for (let i = 0; i < nRing; i++) for (let j = 0; j <= nSide; j++) {
      const q = fn(i / (nRing - 1), j / nSide * Math.PI * 2), k = (i * (nSide + 1) + j) * 3
      P[k] = q[0]; P[k + 1] = q[1]; P[k + 2] = q[2]
    }
    g.attributes.position.needsUpdate = true
    g.computeVertexNormals(); g.computeBoundingSphere()
    return g
  }
  // 身體：接近水平的鳥身，腹側與背側有一點深淺；胸前那塊帶淡黃（大白鵜鶘的胸斑）
  const bodyG = new THREE.SphereGeometry(1, 40, 28)
  {
    const p = bodyG.attributes.position, c = new Float32Array(p.count * 3)
    const white = lin('#f7f3eb'), belly = lin('#dcd4c8'), chest = lin('#f2dfa4'), back = lin('#efe9df')
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), z = p.getZ(i)
      const k = white.clone().lerp(belly, smooth(0.0, -0.95, y)).lerp(back, smooth(0.4, 0.95, y) * 0.4)
      k.lerp(chest, smooth(-0.45, -0.92, z) * smooth(-0.5, 0.35, y) * 0.6)
      c[i * 3] = k.r; c[i * 3 + 1] = k.g; c[i * 3 + 2] = k.b
    }
    bodyG.setAttribute('color', new THREE.BufferAttribute(c, 3))
  }
  const bodyMesh = add(xf(bodyG, [0, 0.15, -0.12], [0, 0, 0], [0.2, 0.19, 0.34]), M.feather, body)
  // 尾羽：身體後端往後平伸
  const tail = []
  for (let i = 0; i < 6; i++) {
    const f = new THREE.SphereGeometry(1, 10, 6); xf(f, [0, 0, 0.075], [0, 0, 0], [0.028, 0.009, 0.085])
    const m = add(f, M.featherPlain, body); m.position.set((i - 2.5) * 0.022, 0.16, 0.19); m.rotation.set(-0.18, (i - 2.5) * 0.16, 0)
    tail.push(m)
  }
  // 翅膀（上臂、前臂、初級飛羽）：黑色的飛羽剛好像握著變把的手套
  function wingParts(s) {
    const up = add(new THREE.SphereGeometry(0.5, 18, 12), M.featherPlain, pel)
    const foreG = new THREE.SphereGeometry(0.5, 20, 12)
    {
      const p = foreG.attributes.position, c = new Float32Array(p.count * 3), w = lin('#f3eee5'), k = lin('#242328')
      for (let i = 0; i < p.count; i++) {
        const cc = w.clone().lerp(k, smooth(0.14, 0.44, p.getX(i) * s)); c[i * 3] = cc.r; c[i * 3 + 1] = cc.g; c[i * 3 + 2] = cc.b
      }
      foreG.setAttribute('color', new THREE.BufferAttribute(c, 3))
    }
    const fore = add(foreG, M.feather, pel)
    const hand = new THREE.Group(); pel.add(hand)
    for (let i = 0; i < 5; i++) {
      const f = new THREE.SphereGeometry(1, 10, 6)
      xf(f, [0.01 * s, 0.03 - i * 0.022, 0.018 + i * 0.006], [0.25 - i * 0.2, 0, 0.35 * s], [0.016, 0.085, 0.03])
      add(f, M.primaries, hand)
    }
    return { up, fore, hand, s }
  }
  const wings = [wingParts(1), wingParts(-1)]
  // 腿：白色羽毛大腿、橘色小腿、蹼
  function legParts(s) {
    const thigh = add(cyl(0.062, 0.045, 14), M.featherPlain, pel)
    const knee = add(new THREE.SphereGeometry(0.046, 14, 10), M.featherPlain, pel)
    const shin = add(cyl(0.019, 0.015, 10), M.leg, pel)
    const footG = new THREE.ConeGeometry(0.042, 0.095, 3, 1); footG.rotateX(-Math.PI / 2); footG.scale(1, 0.22, 1)
    const foot = add(footG, M.leg, pel)
    return { thigh, knee, shin, foot, s }
  }
  const legs = [legParts(1), legParts(-1)]
  // 頸：每一幀重算的放樣管
  const neckG = loftGeometry(16, 12)
  const neck = add(neckG, M.featherPlain, pel)
  neck.frustumCulled = false
  // 頭
  const head = new THREE.Group(); pel.add(head)
  const skull = add(xf(new THREE.SphereGeometry(1, 28, 20), [0, 0, 0], [0, 0, 0], [0.07, 0.068, 0.088]), M.featherPlain, head)
  const eyes = []
  for (const s of [-1, 1]) {
    const ring = add(xf(new THREE.SphereGeometry(1, 16, 10), [0.05 * s, 0.014, -0.03], [0, 0.4 * s, 0], [0.022, 0.018, 0.024]), M.skin, head, false)
    const eye = new THREE.Group(); eye.position.set(0.061 * s, 0.016, -0.032); head.add(eye)
    add(new THREE.SphereGeometry(0.0098, 14, 10), M.iris, eye, false)
    add(xf(new THREE.SphereGeometry(0.0052, 10, 8), [0.0055 * s, 0.001, -0.0035]), M.pupil, eye, false)
    add(xf(new THREE.SphereGeometry(0.0019, 6, 5), [0.0088 * s, 0.0045, -0.005]), M.shine, eye, false)
    const lid = add(xf(new THREE.SphereGeometry(0.0108, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), [0, 0, 0]), M.featherPlain, eye, false)
    lid.scale.set(1, 0.05, 1)
    eyes.push({ eye, lid, ring })
  }
  // 冠羽（從安全帽後緣冒出來）
  const crest = []
  for (let i = 0; i < 3; i++) {
    const f = new THREE.ConeGeometry(0.007, 0.06, 5); f.translate(0, 0.03, 0)
    const m = add(f, M.featherPlain, head, false); m.position.set((i - 1) * 0.013, 0.012, 0.075); m.rotation.set(1.35 + i * 0.1, 0, (i - 1) * 0.3)
    crest.push(m)
  }
  // 安全帽：白底、日落橘中線、黑色通風孔（頂點色），後緣往後拉長
  const helmG = new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI * 0.6)
  {
    const p = helmG.attributes.position, c = new Float32Array(p.count * 3), w = lin('#f7f5f0'), o = lin('#ff8a45'), k = lin('#16171a'), g = lin('#55575c')
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i)
      if (z > 0) { p.setZ(i, z * (1 + 0.32 * (1 - y))); p.setY(i, y * (1 - 0.2 * z)) }
      let cc = w
      const ax = Math.abs(x)
      if (ax < 0.14 && y > 0.3) cc = o
      if (((ax > 0.27 && ax < 0.38) || (ax > 0.52 && ax < 0.62)) && y > 0.4 && z > -0.6 && z < 0.55) cc = k
      if (y < -0.24) cc = g
      c[i * 3] = cc.r; c[i * 3 + 1] = cc.g; c[i * 3 + 2] = cc.b
    }
    helmG.setAttribute('color', new THREE.BufferAttribute(c, 3))
    helmG.computeVertexNormals()
  }
  const helmet = add(xf(helmG, [0, 0.022, 0.018], [0.2, 0, 0], [0.086, 0.078, 0.114]), M.helmet, head)
  for (const s of [-1, 1]) {                                          // 帽帶
    const c = new THREE.CatmullRomCurve3([V(0.072 * s, 0.0, 0.03), V(0.064 * s, -0.035, 0.0), V(0.03 * s, -0.056, -0.04)])
    add(new THREE.TubeGeometry(c, 8, 0.0017, 4, false), M.black, head, false)
  }
  // 嘴：上喙＋兩支下喙＋喉囊。長度 0.46 m，往下壓 0.22 rad
  const beak = new THREE.Group(); beak.position.set(0, -0.014, -0.07); beak.rotation.x = -0.22; head.add(beak)
  const BL = 0.46
  const bw = t => 0.032 * Math.pow(1 - t, 0.6) + 0.009 - (t > 0.94 ? (t - 0.94) * 0.12 : 0)
  const bh = t => 0.019 * Math.pow(1 - t, 0.8) + 0.006
  const by = t => -0.012 * t * t - (t > 0.93 ? (t - 0.93) * 0.38 : 0)
  const upG = sweepZ(24, 14, (t, a) => {
    const sa = Math.sin(a)
    return [bw(t) * Math.cos(a), by(t) + (sa > 0 ? bh(t) * sa : 0.35 * bh(t) * sa), -BL * t]
  })
  {
    const p = upG.attributes.position, c = new Float32Array(p.count * 3), a0 = lin('#f0c089'), b0 = lin('#ee944c'), tip = lin('#c6401c')
    const ridge = lin('#d9773d')
    for (let i = 0; i < p.count; i++) {
      const t = -p.getZ(i) / BL, cc = a0.clone().lerp(b0, smooth(0.15, 0.8, t)).lerp(tip, smooth(0.9, 0.98, t))
      if (Math.abs(p.getX(i)) < bw(t) * 0.16 && p.getY(i) > by(t)) cc.lerp(ridge, 0.7)            // 喙脊
      c[i * 3] = cc.r; c[i * 3 + 1] = cc.g; c[i * 3 + 2] = cc.b
    }
    upG.setAttribute('color', new THREE.BufferAttribute(c, 3))
  }
  add(upG, M.beak, beak)
  const ramY = t => by(t) - 0.35 * bh(t) - 0.002
  for (const s of [-1, 1]) {
    const pts = []
    for (let i = 0; i <= 12; i++) { const t = i / 12 * 0.97; pts.push(V(s * Math.max(bw(t) - 0.005, 0.001), ramY(t), -BL * t)) }
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.0042, 5, false), M.beak, beak, false)
  }
  // 喉囊：U 形斷面、只有下半圈；底部跟著彈簧晃，被點到會鼓起來
  const pouchMat = M.pouch; pouchMat.side = THREE.DoubleSide
  const POUCH_T = 0.9
  let pouchG = null
  function pouchShape(jx, jy, inflate) {
    pouchG = sweepZ(18, 12, (u, a) => {
      const t = u * POUCH_T
      const w = Math.max(bw(t) - 0.005, 0.002)
      const d = (0.1 + inflate * 0.045) * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.8)), 1.1) + 0.003
      const aa = Math.PI + a / 2                                 // π → 2π：下半圈
      const sa = Math.sin(aa), k = -sa
      return [w * Math.cos(aa) * (1 + 0.18 * k) + jx * k * d * 0.35, ramY(t) + d * sa + jy * k * d * 0.3, -BL * t]
    }, pouchG)
  }
  pouchShape(0, 0, 0)
  const pouch = add(pouchG, pouchMat, beak)
  pouch.frustumCulled = false

  const hoods = [V(0.207, 0.874, -0.588), V(-0.207, 0.874, -0.588)]
  const state = { theta: 0, wheel: 0, stand: 0, gear: [50, 17], pouchY: 0, pouchV: 0, pouchX: 0, pouchVX: 0, blink: 2, glance: 0, glanceT: 7, gulp: 0, lastChainRing: 50, lastChainCog: 17 }
  const tmpBody = new THREE.Matrix4(), tp = new THREE.Vector3()
  const SEAT = V(0, 0.985, 0.2), STAND = V(0, 1.1, 0.04)
  let screenTimer = 0, lastHeadPos = V(0, 1.5, -0.37)

  function bodyPoint(x, y, z, out) { return out.set(x, y, z).applyMatrix4(tmpBody) }
  function ik(h, p, l1, l2, pole, knee) {
    _v.subVectors(p, h); let d = _v.length(); d = clamp(d, Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3)
    _v.normalize()
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), hh = Math.sqrt(Math.max(l1 * l1 - a * a, 0))
    _v2.copy(pole).addScaledVector(_v, -pole.dot(_v)).normalize()
    return knee.copy(h).addScaledVector(_v, a).addScaledVector(_v2, hh)
  }
  const knee = V(0, 0, 0), elbow = V(0, 0, 0), hip = V(0, 0, 0), ank = V(0, 0, 0), pedal = V(0, 0, 0), sh = V(0, 0, 0), hand = V(0, 0, 0)
  const poleLeg = V(0, 0, -1), poleWing = V(0, 0, 0)

  function drawScreen(kmh, pw, gear) {
    const c = scrTex.image, g = c.getContext('2d')
    g.fillStyle = '#0c0d0f'; g.fillRect(0, 0, 128, 96)
    g.fillStyle = '#f2efe8'; g.font = 'bold 40px Overpass, Helvetica, Arial, sans-serif'; g.textAlign = 'center'
    g.fillText(kmh.toFixed(1), 64, 46)
    g.font = '15px Overpass, Helvetica, Arial, sans-serif'; g.fillStyle = '#ff9a5a'; g.fillText(`${Math.round(pw)} W · ${gear[0]}×${gear[1]}`, 64, 74)
    g.fillStyle = '#ff9a5a'; g.fillRect(8, 84, clamp(pw / 400, 0, 1) * 112, 5)
    scrTex.needsUpdate = true
  }

  function update(dt, s) {
    // s: { v, cad, pw, coast, t, standWant }
    const st = state
    if (!s.coast) st.theta += (s.cad / 60) * Math.PI * 2 * dt
    else {                                                   // 滑行時曲柄慢慢停到水平
      const target = Math.round((st.theta - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2
      st.theta = damp(st.theta, target, 3, dt)
    }
    st.wheel += s.v / 0.336 * dt
    st.stand = damp(st.stand, s.standWant ? 1 : 0, 4, dt)
    wheelF.rotation.x = -st.wheel; wheelR.rotation.x = -st.wheel
    crank.rotation.x = -st.theta
    const ankle = 0.18 * Math.sin(st.theta + 0.5)
    pedalR.rotation.x = st.theta - ankle; pedalL.rotation.x = st.theta + ankle
    jock1.rotation.x = -st.theta * 3; jock2.rotation.x = -st.theta * 3
    chainTex.offset.x = -(st.theta * 0.101) / 0.0254 / chainTex.repeat.x * chainTex.repeat.x % 1
    if (st.gear[0] !== st.lastChainRing || st.gear[1] !== st.lastChainCog) { buildChain(st.gear[0], st.gear[1]); st.lastChainRing = st.gear[0]; st.lastChainCog = st.gear[1] }
    // 側傾：站起來抽車時左右擺
    const roll = (0.012 + st.stand * 0.085) * Math.sin(st.theta) * (s.coast ? 0 : 1)
    rider.rotation.z = damp(rider.rotation.z, roll, 10, dt)
    rider.position.y = Math.sin(s.t * 23.0) * 0.0012 * clamp(s.v / 8, 0, 1)      // 路面細震
    // 身體
    const bob = s.coast ? 0 : 0.006 * Math.sin(st.theta * 2) + st.stand * 0.02 * Math.abs(Math.sin(st.theta))
    const pelv = V(0, 0, 0).lerpVectors(SEAT, STAND, st.stand); pelv.y += bob
    pelv.x = st.stand * 0.02 * Math.sin(st.theta)
    const pitch = lerp(-0.12, -0.34, st.stand) + (s.coast ? 0.05 : 0)
    body.position.copy(pelv); body.rotation.set(pitch, 0, -roll * 0.6)
    body.updateMatrix(); tmpBody.copy(body.matrix)
    // 腿
    const c = Math.cos(st.theta) * DRIVE.crank, sn = Math.sin(st.theta) * DRIVE.crank
    legs.forEach((L, i) => {
      const s2 = L.s
      bodyPoint(0.085 * s2, 0.0, 0.02, hip)
      pedal.set(0.105 * s2, 0.27 + c * s2, -sn * s2)
      ank.copy(pedal).add(_v3.set(0, 0.04, 0.035))
      poleLeg.set(0.12 * s2, 0.1, -1).normalize()
      ik(hip, ank, 0.47, 0.44, poleLeg, knee)
      orient(L.thigh, hip, knee, V(1, 0, 0))
      L.knee.position.copy(knee)
      orient(L.shin, knee, ank, V(1, 0, 0))
      L.foot.position.copy(pedal).add(_v3.set(0, 0.012, -0.012))
      L.foot.rotation.set(i ? ankle : -ankle, 0, 0)
    })
    // 翅膀：肩 → 手（煞變把）
    wings.forEach((W, i) => {
      const s2 = W.s
      bodyPoint(0.15 * s2, 0.12, -0.3, sh)
      hand.copy(hoods[i]); hand.y += 0.012
      poleWing.set(0.9 * s2, 0.55, 0.35).normalize()
      ik(sh, hand, 0.28, 0.31, poleWing, elbow)
      orient(W.up, sh, elbow, V(s2, 0.2, 0))
      W.up.scale.set(0.15, W.up.scale.y * 1.2, 0.07)
      orient(W.fore, elbow, hand, V(s2, 0.3, 0))
      W.fore.scale.set(0.17, W.fore.scale.y * 1.16, 0.065)
      W.hand.position.copy(hand); W.hand.quaternion.copy(W.fore.quaternion)
    })
    // 頸與頭：頭部防震（鳥類招牌動作），頭位置只慢慢跟身體走
    const neckBase = bodyPoint(0, 0.2, -0.36, V(0, 0, 0))
    const headWant = V(0, 1.5, -0.37).lerp(V(0, 1.58, -0.5), st.stand)
    headWant.y += bob * 0.25
    lastHeadPos.x = damp(lastHeadPos.x, headWant.x, 6, dt); lastHeadPos.y = damp(lastHeadPos.y, headWant.y, 6, dt); lastHeadPos.z = damp(lastHeadPos.z, headWant.z, 6, dt)
    const hp = lastHeadPos
    const np = [neckBase, neckBase.clone().add(V(0, 0.09, 0.06)), V(0, lerp(neckBase.y, hp.y, 0.6), lerp(neckBase.z, hp.z, 0.45) + 0.085), V(0, hp.y - 0.07, hp.z + 0.05), V(0, hp.y - 0.02, hp.z + 0.015)]
    const curve = new THREE.CatmullRomCurve3(np)
    const npts = [], nr = []
    for (let i = 0; i < 16; i++) { const t = i / 15; npts.push(curve.getPoint(t)); const r = lerp(0.07, 0.05, smooth(0, 0.6, t)); nr.push([r, r * 1.06]) }
    loftUpdate(neckG, npts, nr, V(1, 0, 0))
    head.position.copy(hp)
    // 偶爾轉頭看海
    st.glanceT -= dt
    if (st.glanceT < 0) { st.glance = st.glance ? 0 : 1; st.glanceT = st.glance ? 2.4 + Math.random() * 1.5 : 9 + Math.random() * 9 }
    head.rotation.y = damp(head.rotation.y, st.glance ? -0.55 : 0, 3.5, dt)
    head.rotation.x = damp(head.rotation.x, st.stand * 0.12 - 0.05, 4, dt)
    // 眨眼
    st.blink -= dt
    const lidOpen = st.blink < 0 && st.blink > -0.13 ? 1 : 0.05
    if (st.blink < -0.13) st.blink = 2 + Math.random() * 4
    eyes.forEach(E => { E.lid.scale.y = damp(E.lid.scale.y, lidOpen ? 1.9 : 0.05, 30, dt) })
    // 喉囊：阻尼彈簧，被上下起伏與路面震動推著跑
    const acc = -bob * 90 - (Math.random() - 0.5) * s.v * 0.35
    st.pouchV += (-80 * st.pouchY - 4.2 * st.pouchV + acc) * dt; st.pouchY += st.pouchV * dt
    st.pouchVX += (-60 * st.pouchX - 3.6 * st.pouchVX + roll * 30 + (Math.random() - 0.5) * s.v * 0.2) * dt; st.pouchX += st.pouchVX * dt
    st.gulp = Math.max(0, st.gulp - dt * 0.6)
    pouchShape(clamp(st.pouchX, -1.2, 1.2), clamp(st.pouchY, -1.4, 1.4), Math.sin(Math.min(st.gulp, 1) * Math.PI) * 1.4)
    // 冠羽隨風
    crest.forEach((m, i) => { m.rotation.x = 1.35 + i * 0.1 + Math.min(s.v / 12, 1) * 0.25 + Math.sin(s.t * (9 + i * 2.3) + i) * 0.07 * Math.min(s.v / 8, 1) })
    tail.forEach((m, i) => { m.rotation.x = -0.18 + Math.sin(s.t * (7 + i * 1.7) + i * 2) * 0.05 * Math.min(s.v / 8, 1) })
    // 尾燈閃爍
    tailLens.material.color.setRGB(1, 0.08, 0.05).multiplyScalar(Math.sin(s.t * 12) > 0 ? 1 : 0.15)
    screenTimer -= dt
    if (screenTimer < 0) { drawScreen(s.v * 3.6, s.pw, st.gear); screenTimer = 0.5 }
  }
  return { rider, bike, pel, head, skull, helmet, eyes, neck, state, update, M, wheelF, wheelR, body: bodyMesh }
}

/* ══ 相機 ════════════════════════════════════════════════════════════ */
const SHOTS = [
  { name: 'front', dur: 8.5, a: { p: [-1.55, 1.25, -4.4], t: [0.05, 1.08, -0.1], f: 36 }, b: { p: [-1.05, 1.15, -3.5], t: [0.05, 1.12, -0.15], f: 36 } },
  { name: 'backlit', dur: 8, a: { p: [0.42, 0.3, 2.9], t: [0.1, 1.05, -1.2], f: 40 }, b: { p: [0.62, 0.36, 2.3], t: [0.1, 1.12, -1.2], f: 40 } },
  { name: 'drone', dur: 10, a: { p: [2.6, 3.2, 5.5], t: [0, 1.0, -4], f: 48 }, b: { p: [11, 24, 12], t: [0, 0, -22], f: 50 } },
  { name: 'face', dur: 7, a: { p: [0.95, 1.7, -1.75], t: [0, 1.6, -0.62], f: 30 }, b: { p: [0.62, 1.64, -1.42], t: [0, 1.61, -0.66], f: 30 } },
  { name: 'drive', dur: 6, a: { p: [0.78, 0.44, 0.95], t: [0.05, 0.33, 0.22], f: 38 }, b: { p: [0.7, 0.38, 0.12], t: [0.05, 0.3, 0.12], f: 38 } },
  { name: 'seaside', dur: 9, a: { p: [3.0, 1.45, 1.4], t: [0, 1.0, -0.3], f: 44 }, b: { p: [3.0, 1.35, -1.3], t: [0, 1.0, -0.6], f: 44 } },
]
const CAM_FIXED = {
  chase: { p: [1.0, 1.6, 3.7], t: [0, 1.05, -2.2], f: 50 },
  side: { p: [-3.9, 1.1, -0.25], t: [0, 0.95, -0.2], f: 40 },
}

/* ══ 後製：bloom＋ACES＋暗角＋顆粒（只有高畫質路徑） ═══════════════ */
function makePost(renderer, w, h, msaa) {
  const pars = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: true }
  const rtScene = msaa && THREE.WebGLMultisampleRenderTarget ? new THREE.WebGLMultisampleRenderTarget(w, h, pars) : new THREE.WebGLRenderTarget(w, h, pars)
  if (rtScene.samples !== undefined) rtScene.samples = 4
  const small = (d) => new THREE.WebGLRenderTarget(Math.max(1, w >> d), Math.max(1, h >> d), { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false })
  const rtA = [small(1), small(2), small(3)], rtB = [small(1), small(2), small(3)]
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const tri = new THREE.BufferGeometry()
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3))
  tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2))
  const quad = new THREE.Mesh(tri); quad.frustumCulled = false
  const sc = new THREE.Scene(); sc.add(quad)
  const vs = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }'
  const bright = new THREE.ShaderMaterial({ uniforms: { tSrc: { value: null }, uThr: { value: 1.0 } }, vertexShader: vs, depthTest: false, depthWrite: false, toneMapped: false,
    fragmentShader: `uniform sampler2D tSrc; uniform float uThr; varying vec2 vUv;
      void main(){ vec3 c = texture2D(tSrc, vUv).rgb; float l = max(max(c.r, c.g), c.b); float k = smoothstep(uThr, uThr * 2.2, l); gl_FragColor = vec4(min(c * k, vec3(40.0)), 1.0); }` })
  const blur = new THREE.ShaderMaterial({ uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } }, vertexShader: vs, depthTest: false, depthWrite: false, toneMapped: false,
    fragmentShader: `uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
      void main(){ vec3 s = texture2D(tSrc, vUv).rgb * 0.227027;
        s += (texture2D(tSrc, vUv + uDir * 1.3846).rgb + texture2D(tSrc, vUv - uDir * 1.3846).rgb) * 0.3162162;
        s += (texture2D(tSrc, vUv + uDir * 3.2308).rgb + texture2D(tSrc, vUv - uDir * 3.2308).rgb) * 0.0702703;
        gl_FragColor = vec4(s, 1.0); }` })
  const copy = new THREE.ShaderMaterial({ uniforms: { tSrc: { value: null } }, vertexShader: vs, depthTest: false, depthWrite: false, toneMapped: false,
    fragmentShader: 'uniform sampler2D tSrc; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(tSrc, vUv).rgb, 1.0); }' })
  const comp = new THREE.ShaderMaterial({
    uniforms: { tScene: { value: null }, tB0: { value: null }, tB1: { value: null }, tB2: { value: null }, uExp: { value: 1 }, uBloom: { value: 0.6 }, uTime: { value: 0 }, uFade: { value: 1 }, uRes: { value: new THREE.Vector2(w, h) } },
    vertexShader: vs, depthTest: false, depthWrite: false, toneMapped: false,
    fragmentShader: `uniform sampler2D tScene, tB0, tB1, tB2; uniform float uExp, uBloom, uTime, uFade; uniform vec2 uRes; varying vec2 vUv;
      vec3 RRTAndODTFit(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
      vec3 aces(vec3 c){
        const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
        const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
        c = I * c; c = RRTAndODTFit(c); c = O * c; return clamp(c, 0.0, 1.0); }
      vec3 srgb(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
      float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      void main(){
        vec3 c = texture2D(tScene, vUv).rgb;
        vec3 b = texture2D(tB0, vUv).rgb * 0.6 + texture2D(tB1, vUv).rgb * 0.45 + texture2D(tB2, vUv).rgb * 0.3;
        c += b * uBloom;
        c *= uExp / 0.6;
        c = aces(c);
        vec2 q = vUv - 0.5; c *= 1.0 - dot(q, q) * 0.55;
        c = srgb(c);
        c += (h12(vUv * uRes + fract(uTime * 7.13) * 100.0) - 0.5) * 0.018;
        gl_FragColor = vec4(c * uFade, 1.0);
      }` })
  function pass(mat, target) { quad.material = mat; renderer.setRenderTarget(target); renderer.render(sc, cam) }
  return {
    rtScene,
    setSize(W, H) {
      rtScene.setSize(W, H)
      for (let i = 0; i < 3; i++) { rtA[i].setSize(Math.max(1, W >> (i + 1)), Math.max(1, H >> (i + 1))); rtB[i].setSize(Math.max(1, W >> (i + 1)), Math.max(1, H >> (i + 1))) }
      comp.uniforms.uRes.value.set(W, H)
    },
    render(exp, bloom, t, fade) {
      bright.uniforms.tSrc.value = rtScene.texture; pass(bright, rtA[0])
      for (let i = 0; i < 3; i++) {
        if (i) { copy.uniforms.tSrc.value = rtA[i - 1].texture; pass(copy, rtA[i]) }
        const W2 = rtA[i].width, H2 = rtA[i].height
        blur.uniforms.tSrc.value = rtA[i].texture; blur.uniforms.uDir.value.set(1 / W2, 0); pass(blur, rtB[i])
        blur.uniforms.tSrc.value = rtB[i].texture; blur.uniforms.uDir.value.set(0, 1 / H2); pass(blur, rtA[i])
      }
      comp.uniforms.tScene.value = rtScene.texture; comp.uniforms.tB0.value = rtA[0].texture; comp.uniforms.tB1.value = rtA[1].texture; comp.uniforms.tB2.value = rtA[2].texture
      comp.uniforms.uExp.value = exp; comp.uniforms.uBloom.value = bloom; comp.uniforms.uTime.value = t; comp.uniforms.uFade.value = fade
      pass(comp, null)
    },
    dispose() { rtScene.dispose(); rtA.concat(rtB).forEach(r => r.dispose()) },
  }
}

/* ══ 聲音（預設關）：浪、風、飛輪棘輪、跟踏頻走的五聲音階 ═══════════ */
function makeAudio() {
  let ctx = null, master, surfG, windG, windF, fwOsc, fwG, music, next = 0, step = 0, chord = 0
  const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21]                 // D 大調五聲
  const CHORDS = [[0, 4, 7], [9, 12, 16], [5, 9, 12], [7, 11, 14]]
  function build() {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return false
    ctx = new AC()
    master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination)
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0)
    let b = 0
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = 0.985 * b + 0.09 * w; d[i] = b * 0.5 + w * 0.05 }
    const src = () => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, Math.random() * 2); return s }
    const sf = ctx.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 480
    surfG = ctx.createGain(); surfG.gain.value = 0.3; src().connect(sf); sf.connect(surfG); surfG.connect(master)
    windF = ctx.createBiquadFilter(); windF.type = 'bandpass'; windF.frequency.value = 800; windF.Q.value = 0.5
    windG = ctx.createGain(); windG.gain.value = 0; src().connect(windF); windF.connect(windG); windG.connect(master)
    fwOsc = ctx.createOscillator(); fwOsc.type = 'square'; fwOsc.frequency.value = 60
    const fwHp = ctx.createBiquadFilter(); fwHp.type = 'highpass'; fwHp.frequency.value = 2400
    fwG = ctx.createGain(); fwG.gain.value = 0; fwOsc.connect(fwHp); fwHp.connect(fwG); fwG.connect(master); fwOsc.start()
    music = ctx.createGain(); music.gain.value = 0.13; music.connect(master)
    const conv = ctx.createConvolver(), il = ctx.sampleRate * 2.8, ir = ctx.createBuffer(2, il, ctx.sampleRate)
    for (let ch = 0; ch < 2; ch++) { const x = ir.getChannelData(ch); for (let i = 0; i < il; i++) x[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / il, 2.6) }
    conv.buffer = ir; const wet = ctx.createGain(); wet.gain.value = 0.55; music.connect(conv); conv.connect(wet); wet.connect(master)
    return true
  }
  function note(t, semi, vel, dur) {
    const f = 293.66 * Math.pow(2, semi / 12)
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain()
    o.type = 'triangle'; o.frequency.value = f; o2.type = 'sine'; o2.frequency.value = f * 2.003
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0008, t + dur)
    o.connect(g); o2.connect(g); g.connect(music); o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05)
  }
  return {
    get on() { return !!(ctx && ctx.state === 'running' && master.gain.value > 0.01) },
    start() { if (!ctx && !build()) return false; ctx.resume(); master.gain.setTargetAtTime(0.85, ctx.currentTime, 0.5); next = ctx.currentTime + 0.1; return true },
    stop() { if (ctx) master.gain.setTargetAtTime(0, ctx.currentTime, 0.2) },
    blup() { if (!ctx || ctx.state !== 'running') return; const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(420, t + 0.12); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3); o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.35) },
    update(st) {
      if (!ctx || ctx.state !== 'running') return
      const now = ctx.currentTime
      surfG.gain.setTargetAtTime(0.2 + 0.14 * Math.sin(now * 0.37) * Math.sin(now * 0.13 + 1), now, 0.6)
      windG.gain.setTargetAtTime(Math.min(0.45, st.v * st.v * 0.0035), now, 0.3)
      windF.frequency.setTargetAtTime(420 + st.v * 70, now, 0.3)
      fwOsc.frequency.setTargetAtTime(Math.max(8, st.v / DRIVE.circ * 36), now, 0.05)
      fwG.gain.setTargetAtTime(st.coast && st.v > 1 ? 0.035 : 0, now, 0.05)
      if (!st.coast && st.cad > 20) {
        const beat = 60 / st.cad
        while (next < now + 0.25) {
          if (next < now - 0.2) next = now
          const ch = CHORDS[chord]
          if (step % 8 === 0) ch.forEach(n => note(next, n - 12, 0.05 * (1 - st.night * 0.4), beat * 8))
          if (Math.random() < 0.78 - st.night * 0.3) {
            const base = ch[Math.floor(Math.random() * 3)] + (Math.random() < 0.5 ? 12 : 0)
            const s2 = SCALE.reduce((m, x) => (Math.abs(x - base) < Math.abs(m - base) ? x : m), SCALE[0])
            note(next, s2, 0.1 + Math.random() * 0.05, beat * 3)
          }
          next += beat; step++
          if (step % 16 === 0) chord = (chord + 1) % CHORDS.length
        }
      } else next = now + 0.1
    },
  }
}

/* ══ mount ═══════════════════════════════════════════════════════════ */
function mount(host, opts) {
  opts = opts || {}
  const isMobile = matchMedia('(max-width: 760px)').matches || /Mobi|Android|iPhone|iPad/.test(navigator.userAgent)
  const qp = new URLSearchParams(location.search).get('q')
  let quality = qp === 'low' || qp === 'high' ? qp : (isMobile || (navigator.hardwareConcurrency || 4) < 4 ? 'low' : 'high')
  const canvas = document.createElement('canvas')
  canvas.className = 'pc-canvas'
  host.appendChild(canvas)
  let renderer
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: quality === 'low', powerPreference: 'high-performance', alpha: false, stencil: false })
  } catch (e) { host.removeChild(canvas); return null }
  if (!renderer.capabilities.isWebGL2) quality = 'low'
  const HIGH = quality === 'high'
  renderer.physicallyCorrectLights = true
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  if (HIGH) { renderer.toneMapping = THREE.NoToneMapping; renderer.outputEncoding = THREE.LinearEncoding }
  else { renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputEncoding = THREE.sRGBEncoding }
  const maxPR = HIGH ? Math.min(window.devicePixelRatio || 1, 1.5) : Math.min(window.devicePixelRatio || 1, 1.35)
  let pr = maxPR
  const aniso = renderer.capabilities.getMaxAnisotropy()

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 12000)
  scene.add(camera)

  /* 天空 */
  const skyMat = new THREE.ShaderMaterial({
    uniforms: U, side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w * 0.99999; }',
    fragmentShader: GLSL_NOISE + GLSL_SKY_DECL + GLSL_SKY_FULL + `varying vec3 vDir;
      void main(){ vec3 d = normalize(vDir); gl_FragColor = vec4(skyFull(d, 1.0, 1.0), 1.0);
        #include <tonemapping_fragment>
        #include <encodings_fragment>
      }`,
  })
  const sky = new THREE.Mesh(new THREE.SphereGeometry(9000, 48, 24), skyMat)
  sky.frustumCulled = false; sky.renderOrder = -10
  scene.add(sky)
  // 環境光：用同一顆天空烘一張 PMREM（時間變了才重烘）
  const envScene = new THREE.Scene()
  const envSkyMat = skyMat.clone(); envSkyMat.uniforms = U
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), envSkyMat))
  const pmrem = new THREE.PMREMGenerator(renderer)
  let envRT = null, envStamp = -99

  /* 光 */
  const sun = new THREE.DirectionalLight(0xffffff, 2.5)
  sun.castShadow = true
  const shadowSize = HIGH ? 2048 : 1024
  sun.shadow.mapSize.set(shadowSize, shadowSize)
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 90 })
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.025
  scene.add(sun); scene.add(sun.target)
  const lampLights = []
  const nLampLights = HIGH ? 3 : 1
  for (let i = 0; i < nLampLights; i++) { const l = new THREE.PointLight(0xffd6a0, 0, 26, 2); scene.add(l); lampLights.push(l) }
  const headLight = new THREE.SpotLight(0xfff4e0, 0, 38, 0.42, 0.55, 2)
  headLight.position.set(0, 0.84, -0.62); headLight.target.position.set(0, 0, -9)
  scene.add(headLight); scene.add(headLight.target)

  /* 海 */
  const W5 = [
    { d: [-0.95, 0.31], A: 0.26, L: 19, Q: 0.55 }, { d: [-0.8, -0.6], A: 0.15, L: 11.5, Q: 0.5 }, { d: [-0.99, 0.12], A: 0.085, L: 7.1, Q: 0.45 },
    { d: [-0.6, 0.8], A: 0.045, L: 4.3, Q: 0.4 }, { d: [-0.9, -0.44], A: 0.028, L: 2.7, Q: 0.35 },
  ].map(w => { const l = Math.hypot(w.d[0], w.d[1]); const k = Math.PI * 2 / w.L; return { dx: w.d[0] / l, dz: w.d[1] / l, A: w.A, k, Q: w.Q, w: Math.sqrt(9.81 * k), ph0: Math.random() * 6.28 } })
  // 細漣漪：六道小波的解析斜率（相位也在 JS 算，捲動不會跳）
  const RIP = [[-0.92, 0.39, 2.3], [-0.55, -0.83, 1.6], [-0.99, -0.1, 1.15], [-0.3, 0.95, 0.9], [-0.8, 0.6, 0.62], [-0.97, -0.25, 0.44]].map((r, i) => {
    const l = Math.hypot(r[0], r[1]), k = Math.PI * 2 / r[2]
    return { dx: r[0] / l, dz: r[1] / l, k, s: 0.1 - i * 0.008, w: Math.sqrt(9.81 * k), ph0: i * 1.7 }
  })
  const seaU = {
    uW: { value: W5.map(w => new THREE.Vector4(w.dx, w.dz, w.A, w.k)) }, uQ: { value: W5.map(w => w.Q) }, uPh: { value: W5.map(() => 0) },
    uScrollMod: { value: 0 }, uShorePh: { value: new THREE.Vector3() }, uDeep: { value: lin('#0a2634') }, uShallow: { value: lin('#174c4a') },
    uSunVis: { value: 1 }, uAmb: { value: 1 },
    uRip: { value: RIP.map(r => new THREE.Vector4(r.dx, r.dz, r.s, r.k)) }, uRipPh: { value: RIP.map(() => 0) },
  }
  const seaMat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, U, seaU), toneMapped: true,
    defines: { HIGHQ: HIGH ? 1 : 0 },
    vertexShader: `
      uniform vec4 uW[5]; uniform float uQ[5]; uniform float uPh[5];
      varying vec3 vW; varying vec3 vN; varying float vFoam;
      void main(){
        vec3 p = position; float dist = length(p.xz);
        float fade = exp(-dist / 700.0);
        vec3 disp = vec3(0.0); vec3 n = vec3(0.0, 1.0, 0.0); float jac = 0.0;
        for (int i = 0; i < 5; i++) {
          vec4 w = uW[i]; float f = w.z * (i < 2 ? max(fade, 0.2) : fade);
          float th = w.w * (w.x * p.x + w.y * p.z) + uPh[i];
          float C = cos(th), S = sin(th);
          disp.x += uQ[i] * f * w.x * C; disp.z += uQ[i] * f * w.y * C; disp.y += f * S;
          n.x -= w.x * w.w * f * C; n.z -= w.y * w.w * f * C; n.y -= uQ[i] * w.w * f * S; jac += uQ[i] * w.w * f * S;
        }
        p += disp;
        vW = (modelMatrix * vec4(p, 1.0)).xyz; vN = normalize(n); vFoam = jac;
        gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
      }`,
    fragmentShader: GLSL_NOISE + GLSL_SKY_DECL + GLSL_SKY_FULL + `
      uniform float uScrollMod; uniform vec3 uShorePh; uniform vec3 uDeep; uniform vec3 uShallow; uniform float uSunVis; uniform float uAmb;
      uniform vec4 uRip[6]; uniform float uRipPh[6];
      varying vec3 vW; varying vec3 vN; varying float vFoam;
      void main(){
        vec3 V = normalize(cameraPosition - vW);
        float dist = length(cameraPosition - vW);
        vec2 gp = vec2(vW.x, vW.z - uScrollMod);
        float det = exp(-dist / 160.0);
        vec3 N = normalize(mix(vN, vec3(0.0, 1.0, 0.0), 1.0 - exp(-dist / 260.0)));
        if (det > 0.02) {
          vec2 sl = vec2(0.0);
          for (int i = 0; i < 6; i++) {
            vec4 r = uRip[i];
            float th = r.w * (r.x * vW.x + r.y * vW.z) + uRipPh[i];
            sl += r.xy * r.z * cos(th);
          }
          N = normalize(N - vec3(sl.x, 0.0, sl.y) * det);
        }
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        vec3 R = reflect(-V, N); R.y = max(R.y, 0.004);
        #if HIGHQ
          vec3 refl = skyFull(normalize(R), 0.0, 1.0);
        #else
          vec3 refl = skyBase(normalize(R));
        #endif
        float sx = 8.2 + 1.9 * sin(vW.z * ${SHORE_K[0]} - uShorePh.x) + 0.9 * sin(vW.z * ${SHORE_K[1]} + 1.3 - uShorePh.y) + 0.45 * sin(vW.z * ${SHORE_K[2]} + 0.4 - uShorePh.z);
        float dxs = vW.x - sx;
        float shallow = exp(-max(dxs, 0.0) / 7.0) * step(0.0, vW.x);
        vec3 water = mix(uDeep, uShallow, shallow * 0.8) * uAmb;
        float sss = pow(max(dot(-V, uSunDir), 0.0), 3.0) * clamp(vW.y - uSeaY + 0.2, 0.0, 1.0) * uSunVis;
        water += vec3(0.05, 0.22, 0.18) * sss * 0.8;
        vec3 col = mix(water, refl, fres);
        float cs = max(dot(R, uSunDir), 0.0);
        col += uSunColor * (pow(cs, 700.0) * 30.0 * det * det + pow(cs, 60.0) * 0.9 + pow(cs, 8.0) * 0.06) * uSunVis;
        float cm = max(dot(R, uMoonDir), 0.0);
        col += vec3(0.8, 0.86, 1.0) * (pow(cm, 900.0) * 8.0 + pow(cm, 80.0) * 0.12) * uMoon;
        float foam = smoothstep(0.35, 0.95, vFoam) * 0.5;
        float surge = 0.55 + 0.45 * sin(uTime * 1.25 - dxs * 2.2 + vnoise(gp * 0.45) * 4.0);
        foam += smoothstep(2.4, 0.0, dxs) * step(0.0, vW.x) * surge * (0.55 + 0.45 * vnoise(gp * 2.2 + uTime * 0.3));
        col = mix(col, vec3(0.86, 0.9, 0.92) * (0.25 + 0.75 * uAmb), clamp(foam, 0.0, 1.0) * 0.85);
        col = mix(col, hazeCol(-V), hazeAmt(dist, vW.y));
        gl_FragColor = vec4(min(col, vec3(24.0)), 1.0);
        #include <tonemapping_fragment>
        #include <encodings_fragment>
      }`,
  })
  {
    const nx = HIGH ? 150 : 100, nz = HIGH ? 170 : 110
    const xs = [], zs = []
    for (let i = 0; i <= nx; i++) { const t = i / nx * 2 - 1; xs.push(Math.sign(t) * Math.pow(Math.abs(t), 2.35) * 7000) }
    for (let j = 0; j <= nz; j++) { const t = j / nz * 2 - 1; zs.push(Math.sign(t) * Math.pow(Math.abs(t), 2.2) * (t < 0 ? 7500 : 3200)) }
    const pos = new Float32Array((nx + 1) * (nz + 1) * 3), idx = []
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { const k = (j * (nx + 1) + i) * 3; pos[k] = xs[i]; pos[k + 1] = 0; pos[k + 2] = zs[j] }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + nx + 1; idx.push(a, b, a + 1, b, b + 1, a + 1) }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx)
    const sea = new THREE.Mesh(g, seaMat); sea.position.y = SEA_Y; sea.frustumCulled = false; sea.receiveShadow = false
    scene.add(sea)
  }

  /* 遠景：山稜三層、燈塔岬角（跟著騎士走，不捲動） */
  const farMat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, U, { uBase: { value: lin('#27304a') }, uHazeMul: { value: 1 } }),
    vertexShader: 'attribute float aHaze; varying vec3 vW; varying float vHaze; varying vec3 vNr; void main(){ vHaze = aHaze; vNr = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: GLSL_SKY_DECL + `uniform vec3 uBase; uniform vec3 uSunColor; uniform float uHazeMul; uniform float uNight; varying vec3 vW; varying float vHaze; varying vec3 vNr;
      void main(){
        vec3 V = normalize(vW - cameraPosition);
        float lit = max(dot(normalize(vNr), uSunDir), 0.0);
        vec3 c = uBase * (0.35 + 0.65 * (1.0 - uNight)) + uSunColor * lit * 0.12;
        vec3 hz = skyBase(normalize(vec3(V.x, max(V.y, 0.0) * 0.6 + 0.004, V.z)));
        c = mix(c, hz, clamp(vHaze * uHazeMul, 0.0, 0.97));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <encodings_fragment>
      }`,
  })
  const farGroup = new THREE.Group(); scene.add(farGroup)
  ;[{ R: 2600, h0: 90, h1: 330, haze: 0.5, seed: 3 }, { R: 5200, h0: 220, h1: 620, haze: 0.66, seed: 7 }, { R: 9500, h0: 420, h1: 1050, haze: 0.8, seed: 11 }].forEach(L => {
    const n = 160, pos = [], hz = [], idx = []
    const a0 = -0.25, a1 = 2.75                         // 從正前方偏右一點，一路繞到左後方
    for (let i = 0; i <= n; i++) {
      const a = lerp(a0, a1, i / n)
      const x = -Math.sin(a) * L.R, z = -Math.cos(a) * L.R
      const k = i / n
      let h = lerp(L.h0, L.h1, 0.5 + 0.5 * Math.sin(k * 5.1 + L.seed)) * (0.55 + 0.45 * fbm2(k * 9 + L.seed, L.seed, 4)) * (0.35 + 0.65 * smooth(0.0, 0.18, k))
      if (L.seed === 11) h += 420 * Math.exp(-Math.pow((k - 0.22) / 0.05, 2)) + 380 * Math.exp(-Math.pow((k - 0.3) / 0.04, 2))   // 大屯山、七星山
      pos.push(x, SEA_Y - 30, z, x, h, z); hz.push(L.haze + 0.12, L.haze)
    }
    for (let i = 0; i < n; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3) }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aHaze', new THREE.Float32BufferAttribute(hz, 1)); g.setIndex(idx); g.computeVertexNormals()
    const m = new THREE.Mesh(g, farMat); m.frustumCulled = false; m.renderOrder = -5; farGroup.add(m)
  })
  // 富貴角：低矮岬角＋黑白橫紋燈塔（岬角遠在前方偏右的海上）
  const capeMat = farMat.clone(); capeMat.uniforms = Object.assign({}, U, { uBase: { value: lin('#2d3346') }, uHazeMul: { value: 1 } })
  const CAPE = new THREE.Vector3(560, SEA_Y, -1350)
  {
    const g = new THREE.SphereGeometry(1, 40, 14, 0, Math.PI * 2, 0, Math.PI / 2)
    const p = g.attributes.position, hz = []
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, p.getY(i) * (0.8 + 0.4 * vnoise2(x * 3, z * 3))); hz.push(0.42) }
    g.setAttribute('aHaze', new THREE.Float32BufferAttribute(hz, 1)); g.computeVertexNormals()
    const m = new THREE.Mesh(g, capeMat); m.scale.set(260, 34, 150); m.position.copy(CAPE); m.rotation.y = -0.5; farGroup.add(m)
  }
  const lhMat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, U),
    vertexShader: 'varying vec3 vW; varying vec3 vNr; varying float vY; void main(){ vY = position.y; vNr = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: GLSL_SKY_DECL + `uniform vec3 uSunColor; uniform float uNight; varying vec3 vW; varying vec3 vNr; varying float vY;
      void main(){ vec3 V = normalize(vW - cameraPosition);
        float band = step(0.5, fract(vY / 3.2));
        vec3 c = mix(vec3(0.03), vec3(0.75), band) * (0.25 + 0.75 * (1.0 - uNight));
        c += uSunColor * max(dot(normalize(vNr), uSunDir), 0.0) * 0.35 * band;
        c = mix(c, skyBase(normalize(vec3(V.x, 0.01, V.z))), 0.36);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <encodings_fragment>
      }`,
  })
  const LH_TOP = new THREE.Vector3(CAPE.x - 40, CAPE.y + 34 + 16, CAPE.z + 30)
  {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.1, 16, 8), lhMat); t.position.set(LH_TOP.x, CAPE.y + 34 + 8, LH_TOP.z); farGroup.add(t)
  }
  const beamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uI: { value: 0 } },
    vertexShader: 'varying float vT; varying vec3 vP; void main(){ vT = uv.y; vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform float uI; varying float vT; void main(){ float a = pow(1.0 - vT, 1.6) * uI; gl_FragColor = vec4(vec3(1.0, 0.93, 0.78) * a, 1.0);\n#include <tonemapping_fragment>\n#include <encodings_fragment>\n}',
  })
  const beamG = new THREE.ConeGeometry(55, 1400, 20, 1, true); beamG.translate(0, -700, 0); beamG.rotateZ(Math.PI / 2)
  const beam = new THREE.Mesh(beamG, beamMat); beam.position.copy(LH_TOP); beam.frustumCulled = false; farGroup.add(beam)

  /* 發光點 */
  const glow = makeGlowField(160)
  scene.add(glow.mesh)
  const FISH = []
  { const r = rng(21); for (let i = 0; i < 9; i++) FISH.push(new THREE.Vector3(900 + r() * 4200, SEA_Y + 1.5, -1500 - r() * 5200)) }

  /* 材質（世界） */
  const MW = {
    road: std('road', { map: roadTexture(aniso), roughness: 0.9, metalness: 0 }),
    ground: std('ground', { vertexColors: true, roughness: 0.95, metalness: 0 }),
    rail: std('rail', { color: lin('#b9bcc1'), metalness: 0.65, roughness: 0.42, side: THREE.DoubleSide }),
    post: std('post', { color: lin('#9fa3a8'), metalness: 0.55, roughness: 0.5 }),
    concrete: std('concrete', { color: lin('#a9a59c'), roughness: 0.92 }),
    rock: std('rock', { color: lin('#ffffff'), roughness: 0.88, vertexColors: false }),
    pole: std('pole', { color: lin('#8d9396'), metalness: 0.5, roughness: 0.45 }),
    lampHead: std('lamphead', { color: lin('#3c3f44'), metalness: 0.4, roughness: 0.5 }),
    lampLens: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.86, 0.6) }),
    grass: std('grass', { vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }, { sway: true, rim: 0.9 }),
    shrub: std('shrub', { color: lin('#ffffff'), roughness: 0.9, flatShading: true }, { rim: 0.35 }),
    turbine: std('turbine', { color: lin('#e9e9e6'), roughness: 0.55, metalness: 0.05 }),
    sign: std('sign', { color: 0xffffff, roughness: 0.6 }),
    deli: std('deli', { color: lin('#ff9a3c'), roughness: 0.4, emissive: lin('#ff7a1c'), emissiveIntensity: 0 }),
  }

  /* 地形塊 */
  const chunks = new Map(), chunkPool = []
  const LX = [-8.9, -9.2, -9.55, -10.2, -11.2, -12.6, -14.5, -17, -20, -24, -29, -35, -42, -51, -62, -75, -90, -108, -130, -156, -186, -220, -260]
  const SX = [1.45, 1.95, 2.0, 2.6, 3.3, 4.2, 5.2, 6.3, 7.5, 8.8, 10.2, 12, 14.5, 18]
  const NZ = 25
  const railGeo = railBeamGeometry(CH)
  function buildGround(geo, c) {
    const zw0 = -c * CH
    const nL = LX.length, nS = SX.length, n = (nL + nS) * NZ
    let pos = geo.attributes.position, nor, cl
    if (!pos) {
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
      geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
      const idx = []
      for (const [off, cols] of [[0, nL], [nL * NZ, nS]]) for (let j = 0; j < NZ - 1; j++) for (let i = 0; i < cols - 1; i++) {
        const a = off + j * cols + i, b = a + cols
        if (off === 0) idx.push(a, b, a + 1, a + 1, b, b + 1); else idx.push(a, a + 1, b, a + 1, b + 1, b)
      }
      geo.setIndex(idx)
      pos = geo.attributes.position
    }
    nor = geo.attributes.normal; cl = geo.attributes.color
    const P = pos.array, N = nor.array, C = cl.array
    const cGrass = lin('#4f7630'), cDry = lin('#7d8246'), cDark = lin('#35502a'), cSoil = lin('#6f6048'), cConc = lin('#8e8b84'), cForest = lin('#2c4428')
    const cRock = lin('#5e574e'), cWet = lin('#34322d'), cAlgae = lin('#3c6a37'), cStripGrass = lin('#56702f')
    const tmp = new THREE.Color()
    let k = 0
    const put = (x, y, z, zw, fnY, colorFn) => {
      const e = 0.35
      const hx = fnY(x + e, zw) - fnY(x - e, zw), hz = fnY(x, zw + e) - fnY(x, zw - e)
      let nx = -hx / (2 * e), ny = 1, nz = -hz / (2 * e)
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l
      P[k * 3] = x; P[k * 3 + 1] = y; P[k * 3 + 2] = z
      N[k * 3] = nx; N[k * 3 + 1] = ny; N[k * 3 + 2] = nz
      colorFn(tmp, x, y, zw, ny)
      C[k * 3] = tmp.r; C[k * 3 + 1] = tmp.g; C[k * 3 + 2] = tmp.b
      k++
    }
    for (let j = 0; j < NZ; j++) {
      const lz = -CH * j / (NZ - 1), zw = zw0 + lz
      for (let i = 0; i < nL; i++) {
        const x = LX[i]
        put(x, landY(x, zw), lz, zw, landY, (t, x2, y, zw2, ny) => {
          const d = ROAD_X0 - x2
          if (d < 1.4) { t.copy(cConc); return }
          const n = fbm2(x2 * 0.06, zw2 * 0.06, 3)
          t.copy(cGrass).lerp(cDry, clamp(n * 1.4 - 0.35, 0, 1))
          t.lerp(cSoil, smooth(0.8, 0.55, ny) * 0.8)
          t.lerp(cDark, smooth(0.45, 0.7, vnoise2(x2 * 0.15, zw2 * 0.15)) * 0.55)
          t.lerp(cForest, smooth(30, 120, d) * 0.8)
        })
      }
    }
    for (let j = 0; j < NZ; j++) {
      const lz = -CH * j / (NZ - 1), zw = zw0 + lz, sx = shoreX(zw)
      for (let i = 0; i < nS; i++) {
        const x = SX[i]
        put(x, stripY(x, zw), lz, zw, stripY, (t, x2, y, zw2) => {
          if (x2 < 2.0) { t.copy(cConc); return }
          if (x2 < 3.3) { t.copy(cStripGrass).lerp(cDry, vnoise2(x2 * 2, zw2 * 0.2) * 0.5); return }
          t.copy(cRock).lerp(cWet, smooth(SEA_Y + 1.4, SEA_Y + 0.2, y))
          const tide = smooth(SEA_Y + 1.1, SEA_Y + 0.3, y) * smooth(SEA_Y - 0.6, SEA_Y, y)
          t.lerp(cAlgae, tide * smooth(0.35, 0.65, vnoise2(x2 * 0.8, zw2 * 0.12)))
        })
      }
    }
    pos.needsUpdate = true; nor.needsUpdate = true; cl.needsUpdate = true
    geo.computeBoundingSphere()
  }
  function makeChunk(c) {
    let ch = chunkPool.pop()
    if (!ch) {
      const g = new THREE.Group()
      const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_X1 - ROAD_X0, CH, 1, 1), MW.road)
      road.rotation.x = -Math.PI / 2; road.position.set((ROAD_X0 + ROAD_X1) / 2, 0, -CH / 2); road.receiveShadow = true
      MW.road.map.repeat.set(1, CH / 12)
      const ground = new THREE.Mesh(new THREE.BufferGeometry(), MW.ground); ground.receiveShadow = true; ground.castShadow = false
      const rail = new THREE.Mesh(railGeo, MW.rail); rail.position.set(RAIL_X, 0.5, 0); rail.castShadow = true; rail.receiveShadow = true
      g.add(road, ground, rail)
      ch = { g, ground }
      scene.add(g)
    }
    ch.c = c
    buildGround(ch.ground.geometry, c)
    ch.g.visible = true
    return ch
  }

  /* 近景道具（Instanced；位置每幀依 dist 重算） */
  const R = rng(99)
  const inst = (geo, mat, max, cast) => { const m = new THREE.InstancedMesh(geo, mat, max); m.castShadow = !!cast; m.receiveShadow = true; m.frustumCulled = false; m.count = 0; scene.add(m); return m }
  const postI = inst(xf(new THREE.BoxGeometry(0.1, 0.84, 0.12), [0, 0.42, 0]), MW.post, 140, true)
  const deliI = inst(xf(new THREE.BoxGeometry(0.02, 0.1, 0.07), [0, 0.66, 0]), MW.deli, 50, false)
  const poleGeo = merge([
    xf(new THREE.CylinderGeometry(0.07, 0.12, LAMP_H, 10), [0, LAMP_H / 2, 0]),
    xf(new THREE.CylinderGeometry(0.045, 0.05, LAMP_ARM + 0.2, 8), [-LAMP_ARM / 2, LAMP_H + 0.28, 0], [0, 0, Math.PI / 2 - 0.12]),
    xf(new THREE.CylinderGeometry(0.16, 0.2, 0.3, 10), [0, 0.15, 0]),
  ])
  const poleI = inst(poleGeo, MW.pole, 32, true)
  const headI = inst(xf(new THREE.BoxGeometry(0.62, 0.12, 0.26), [-LAMP_ARM - 0.12, LAMP_H + 0.4, 0]), MW.lampHead, 32, true)
  const lensI = inst(xf(new THREE.PlaneGeometry(0.5, 0.18), [-LAMP_ARM - 0.12, LAMP_H + 0.335, 0], [Math.PI / 2, 0, 0]), MW.lampLens, 32, false)
  const poolMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uI: { value: 0 }, uC: { value: lin('#ffcf8a') } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform float uI; uniform vec3 uC; varying vec2 vUv; void main(){ float d = length(vUv - 0.5) * 2.0; float a = pow(max(1.0 - d, 0.0), 2.2) * uI; gl_FragColor = vec4(uC * a * 0.22, 1.0);\n#include <tonemapping_fragment>\n#include <encodings_fragment>\n}',
  })
  const poolI = new THREE.InstancedMesh(xf(new THREE.PlaneGeometry(1, 1), [0, 0, 0], [-Math.PI / 2, 0, 0]), poolMat, 32)
  poolI.frustumCulled = false; poolI.count = 0; poolI.renderOrder = 2; scene.add(poolI)
  const tetraI = inst(tetrapodGeometry(), MW.concrete, 260, true)
  const rockGeos = [rockGeometry(1), rockGeometry(2)]
  const rockI = [inst(rockGeos[0], MW.rock, 110, true), inst(rockGeos[1], MW.rock, 110, true)]
  const grassI = inst(silvergrassGeometry(), MW.grass, HIGH ? 520 : 260, false)
  const shrubI = inst(merge([xf(new THREE.IcosahedronGeometry(0.7, 1), [0, 0.2, 0]), xf(new THREE.IcosahedronGeometry(0.55, 1), [0.55, 0.1, 0.2]), xf(new THREE.IcosahedronGeometry(0.5, 1), [-0.45, 0.05, -0.25]), xf(new THREE.IcosahedronGeometry(0.45, 1), [0.1, 0.55, -0.1])]), MW.shrub, 200, true)
  // 木麻黃防風林：細高的樹幹＋幾層下垂的針葉（頂點色）
  const treeGeo = (() => {
    const parts = [tint(xf(new THREE.CylinderGeometry(0.07, 0.13, 3.2, 6), [0, 1.6, 0]), '#5b4d42')]
    const r = rng(17)
    for (let i = 0; i < 5; i++) {
      const y = 2.4 + i * 1.05, rr = 1.25 - i * 0.18
      const c = new THREE.ConeGeometry(rr, 1.7, 7, 1, true); c.translate((r() - 0.5) * 0.4, y, (r() - 0.5) * 0.4)
      tint(c, i % 2 ? '#3d4b31' : '#4a5a38'); parts.push(c)
    }
    return merge(parts)
  })()
  const treeI = inst(treeGeo, std('tree', { vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }, { rim: 0.5 }), 120, true)
  // 風車
  const turb = []
  {
    const tower = xf(new THREE.CylinderGeometry(1.0, 2.1, 46, 12), [0, 23, 0])
    const nac = xf(new THREE.BoxGeometry(2.2, 2.4, 6.2), [0, 47.2, 1.2])
    const towerG = merge([tower, nac])
    const bladeShape = new THREE.Shape(); bladeShape.moveTo(-0.9, 0); bladeShape.quadraticCurveTo(-1.0, 6, -0.3, 21); bladeShape.lineTo(0.15, 21); bladeShape.quadraticCurveTo(0.7, 7, 0.9, 0); bladeShape.lineTo(-0.9, 0)
    const bl = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.25, bevelEnabled: false, curveSegments: 6 })
    const rotorG = merge([0, 1, 2].map(i => { const g = bl.clone(); g.translate(0, 1.1, -0.12); g.rotateZ(i / 3 * Math.PI * 2); return g }).concat([xf(new THREE.SphereGeometry(1.25, 12, 10), [0, 0, 0], [0, 0, 0], [1, 1, 1.4])]))
    for (let i = 0; i < 9; i++) {
      const g = new THREE.Group()
      const t = new THREE.Mesh(towerG, MW.turbine); t.castShadow = false
      const r = new THREE.Mesh(rotorG, MW.turbine); r.position.set(0, 47.3, -2.1)
      g.add(t, r); g.visible = false; scene.add(g)
      turb.push({ g, r, k: null })
    }
  }
  // 里程牌、路面「慢」字
  const kmSigns = []
  for (let i = 0; i < 2; i++) {
    const tex = canvasTex(256, 160, () => {})
    const g = new THREE.Group()
    const post = new THREE.Mesh(xf(new THREE.CylinderGeometry(0.035, 0.035, 1.3, 8), [0, 0.65, 0]), MW.pole)
    const board = new THREE.Mesh(xf(new THREE.PlaneGeometry(0.62, 0.39), [0, 1.42, 0]), std('signb' + i, { map: tex, roughness: 0.55 }))
    const back = new THREE.Mesh(xf(new THREE.PlaneGeometry(0.62, 0.39), [0, 1.42, -0.004], [0, Math.PI, 0]), MW.post)
    post.castShadow = board.castShadow = true
    g.add(post, board, back); g.visible = false; scene.add(g)
    kmSigns.push({ g, tex, k: null })
  }
  function drawKm(tex, k) {
    const c = tex.image, g = c.getContext('2d')
    g.fillStyle = '#1e6b45'; g.fillRect(0, 0, 256, 160)
    g.strokeStyle = '#f4f1e8'; g.lineWidth = 6; g.strokeRect(9, 9, 238, 142)
    g.fillStyle = '#f4f1e8'; g.textAlign = 'center'
    g.font = 'bold 34px "Noto Sans TC", "PingFang TC", sans-serif'; g.fillText('台2線', 128, 60)
    g.font = 'bold 58px Overpass, Helvetica, Arial, sans-serif'; g.fillText(`${k}K`, 128, 128)
    tex.needsUpdate = true
  }
  const slowTex = canvasTex(256, 384, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.fillStyle = 'rgba(236,232,222,0.92)'
    g.font = 'bold 300px "Noto Sans TC", "PingFang TC", "Heiti TC", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'
    g.save(); g.translate(w / 2, h / 2); g.scale(1, 1.45); g.fillText('慢', 0, 6); g.restore()
    g.globalCompositeOperation = 'destination-out'; const r = rng(3)
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.7})`; g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3) }
  })
  const slowMat = std('slow', { map: slowTex, transparent: true, roughness: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })
  const slowI = []
  for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(xf(new THREE.PlaneGeometry(2.3, 3.4), [0, 0, 0], [-Math.PI / 2, 0, 0]), slowMat); m.receiveShadow = true; m.visible = false; m.renderOrder = 1; scene.add(m); slowI.push(m) }

  const dummy = new THREE.Object3D()
  const cRockA = lin('#6e665c'), cRockB = lin('#4a4640'), cShrubA = lin('#5b7f36'), cShrubB = lin('#86a04a'), tmpC = new THREE.Color()
  function span(sp, zNear, zFar, dist, cb) {
    const kMin = Math.ceil((dist - zNear) / sp), kMax = Math.floor((dist - zFar) / sp)
    for (let k = kMin; k <= kMax; k++) cb(k, -sp * k + dist)
  }
  let lampOn = 0
  const lampZ = []
  function placeProps(dist, night, t) {
    // 護欄立柱 4 m 一支、反光片 12 m
    let n = 0, nd = 0
    span(4, 60, -420, dist, (k, z) => {
      dummy.position.set(RAIL_X + 0.1, 0, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); postI.setMatrixAt(n++, dummy.matrix)
      if (k % 3 === 0 && nd < 50) { dummy.position.set(RAIL_X - 0.09, 0, z); dummy.updateMatrix(); deliI.setMatrixAt(nd++, dummy.matrix) }
    })
    postI.count = n; postI.instanceMatrix.needsUpdate = true; deliI.count = nd; deliI.instanceMatrix.needsUpdate = true
    // 路燈
    n = 0; lampZ.length = 0
    span(LAMP_SP, 140, -760, dist, (k, z) => {
      dummy.position.set(LAMP_X, 0, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix()
      poleI.setMatrixAt(n, dummy.matrix); headI.setMatrixAt(n, dummy.matrix); lensI.setMatrixAt(n, dummy.matrix)
      dummy.position.set(LAMP_X - LAMP_ARM - 0.12, 0.03, z); dummy.scale.set(11, 1, 11); dummy.updateMatrix(); poolI.setMatrixAt(n, dummy.matrix)
      lampZ.push({ z, k }); n++
    })
    poleI.count = headI.count = lensI.count = poolI.count = n
    ;[poleI, headI, lensI, poolI].forEach(m => { m.instanceMatrix.needsUpdate = true })
    // 岸邊：消波塊段落與礁岩段落
    let nt = 0; const nr = [0, 0]
    span(1.7, 70, -330, dist, (k, z) => {
      const zw = z - dist, sec = Math.floor(-zw / 48)
      const tetraSec = hash1(sec * 3.1) < 0.46
      const sx = shoreX(zw)
      if (tetraSec) {
        for (let row = 0; row < 2; row++) {
          const hsh = hash1(k * 7.3 + row * 1.7)
          dummy.position.set(sx - 1.3 + row * 1.5 + (hsh - 0.5) * 0.5, SEA_Y + 0.35 + row * -0.25 + hsh * 0.3, z + (hash1(k + row) - 0.5) * 0.8)
          dummy.rotation.set(hsh * 6.28, hash1(k * 1.3 + row) * 6.28, hash1(k * 2.1 + row) * 6.28)
          const s = 0.95 + hsh * 0.25; dummy.scale.set(s, s, s); dummy.updateMatrix()
          if (nt < 260) tetraI.setMatrixAt(nt++, dummy.matrix)
        }
      } else if (k % 2 === 0) {
        for (let q = 0; q < 2; q++) {
          const hsh = hash1(k * 5.7 + q * 3.3), which = hsh < 0.5 ? 0 : 1
          dummy.position.set(sx + (hsh - 0.55) * 4.2, SEA_Y + (hash1(k + q * 9) - 0.4) * 0.9, z + (hash1(k * 3 + q) - 0.5) * 1.6)
          dummy.rotation.set(0, hsh * 6.28, (hsh - 0.5) * 0.5)
          const s = 0.45 + hash1(k * 2.9 + q) * 1.05; dummy.scale.set(s * (1 + hsh * 0.5), s, s); dummy.updateMatrix()
          if (nr[which] < 110) { const i = nr[which]++; rockI[which].setMatrixAt(i, dummy.matrix); tmpC.copy(cRockA).lerp(cRockB, hash1(k * 11 + q)); rockI[which].setColorAt(i, tmpC) }
        }
      }
    })
    tetraI.count = nt; tetraI.instanceMatrix.needsUpdate = true
    rockI.forEach((m, i) => { m.count = nr[i]; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true })
    // 芒草
    n = 0
    const gMax = grassI.instanceMatrix.count
    span(HIGH ? 0.9 : 1.6, 40, -230, dist, (k, z) => {
      const zw = z - dist, h = hash1(k * 1.37)
      if (vnoise1(zw * 0.05) < 0.35 && h < 0.6) return
      const side = h < 0.86 ? -1 : 1
      const x = side < 0 ? ROAD_X0 - 1.6 - hash1(k * 2.3) * 14 : 2.1 + hash1(k * 4.1) * 1.1
      const y = side < 0 ? landY(x, zw) : stripY(x, zw)
      dummy.position.set(x, y - 0.05, z); dummy.rotation.set(0, h * 6.28, 0)
      const s = (side < 0 ? 0.8 : 0.62) + hash1(k * 6.7) * 0.45; dummy.scale.set(s, s, s); dummy.updateMatrix()
      if (n < gMax) grassI.setMatrixAt(n++, dummy.matrix)
    })
    grassI.count = n; grassI.instanceMatrix.needsUpdate = true
    // 灌木
    n = 0
    span(3.1, 60, -420, dist, (k, z) => {
      const zw = z - dist, h = hash1(k * 9.1)
      if (h < 0.6) return
      const x = ROAD_X0 - 2.2 - hash1(k * 3.7) * 16
      const s = 0.45 + hash1(k * 4.4) * 1.0
      dummy.position.set(x, landY(x, zw) - 0.15 * s, z); dummy.rotation.set(0, h * 6, 0)
      dummy.scale.set(s * 1.4, s * 0.95, s * 1.3); dummy.updateMatrix()
      if (n < 200) { shrubI.setMatrixAt(n, dummy.matrix); tmpC.copy(cShrubA).lerp(cShrubB, hash1(k * 7.7)); shrubI.setColorAt(n, tmpC); n++ }
    })
    shrubI.count = n; shrubI.instanceMatrix.needsUpdate = true; if (shrubI.instanceColor) shrubI.instanceColor.needsUpdate = true
    n = 0
    span(4.2, 80, -520, dist, (k, z) => {
      const zw = z - dist, h = hash1(k * 5.3)
      if (vnoise1(zw * 0.012 + 7) < 0.42 || h < 0.25) return
      const x = ROAD_X0 - 5 - hash1(k * 8.1) * 22
      const s = 0.8 + hash1(k * 2.2) * 0.55
      dummy.position.set(x, landY(x, zw) - 0.2, z); dummy.rotation.set((h - 0.5) * 0.08, h * 6.3, (hash1(k) - 0.5) * 0.08)
      dummy.scale.set(s, s * (0.85 + h * 0.4), s); dummy.updateMatrix()
      if (n < 120) treeI.setMatrixAt(n++, dummy.matrix)
    })
    treeI.count = n; treeI.instanceMatrix.needsUpdate = true
    // 風車：大約 270 m 一座，有的位置空著
    const want = new Map()
    span(270, 500, -1500, dist, (k, z) => { if (hash1(k * 13.7) < 0.72) want.set(k, z) })
    turb.forEach(T => { if (T.k !== null && !want.has(T.k)) { T.k = null; T.g.visible = false } })
    want.forEach((z, k) => {
      let T = turb.find(x => x.k === k)
      if (!T) { T = turb.find(x => x.k === null); if (!T) return; T.k = k; T.g.visible = true; T.x = -175 - hash1(k * 2.9) * 110; T.ph = hash1(k) * 6.28 }
      const zw = z - dist
      T.g.position.set(T.x, landY(T.x, zw) - 1, z)
      T.g.rotation.y = -0.35
      T.r.rotation.z = T.ph + t * 1.45
    })
    // 里程牌 1 km 一面
    const wantKm = []
    span(1000, 120, -800, dist, (k, z) => { if (k > 0) wantKm.push([k, z]) })
    kmSigns.forEach(S => { if (S.k !== null && !wantKm.some(w => w[0] === S.k)) { S.k = null; S.g.visible = false } })
    wantKm.forEach(([k, z]) => {
      let S = kmSigns.find(x => x.k === k)
      if (!S) { S = kmSigns.find(x => x.k === null); if (!S) return; S.k = k; drawKm(S.tex, k); S.g.visible = true }
      S.g.position.set(ROAD_X0 - 0.55, landY(ROAD_X0 - 0.55, z - dist), z)
    })
    // 慢：每 260 m 一個（右車道）
    let si = 0
    span(260, 60, -600, dist, (k, z) => { if (si < slowI.length) { const m = slowI[si++]; m.visible = true; m.position.set(-2.35, 0.012, z - 40) } })
    for (; si < slowI.length; si++) slowI[si].visible = false
    // 發光點：路燈燈頭、風車警示燈、漁火、燈塔燈室
    glow.reset()
    const lampCol = lin('#ffd08a')
    lampZ.forEach(L => {
      const on = clamp(lampOn * 1.6 - hash1(L.k * 3.3) * 0.6, 0, 1)
      L.on = on
      if (on > 0.01) glow.add(LAMP_X - LAMP_ARM - 0.12, LAMP_H + 0.3, L.z, 2.4, lampCol, on * (1.2 + 0.8 * night))
    })
    const blink = Math.sin(t * Math.PI) > 0.2 ? 1 : 0
    const red = lin('#ff2a1a')
    if (night > 0.05) turb.forEach(T => { if (T.k !== null) glow.add(T.g.position.x, T.g.position.y + 48.8, T.g.position.z, 9, red, blink * night * 3.0) })
    const fishCol = lin('#fff1c8')
    if (night > 0.2) FISH.forEach((f, i) => glow.add(f.x, f.y, f.z, 30 + (i % 3) * 8, fishCol, night * (2.2 + Math.sin(t * 0.7 + i) * 0.4)))
    const lhFlash = Math.pow(Math.max(Math.sin(t * 0.63), 0), 12)
    if (night > 0.1) glow.add(LH_TOP.x, LH_TOP.y + 1, LH_TOP.z, 24, lin('#fff4d6'), night * (0.8 + lhFlash * 6))
    return lampZ
  }

  /* 騎士 */
  const R1 = buildRider()
  scene.add(R1.rider)
  R1.rider.traverse(o => { if (o.isMesh) o.userData.pelican = true })

  /* 狀態 */
  const S = {
    t: 0, dist: 0, v: 8.2, tod: opts.tod != null ? opts.tod : 0.2, todAuto: true, todRate: 0.0026, paused: false,
    cam: opts.cam || 'cinema', shot: 0, shotT: 0, orbitAz: 0.62, orbitEl: 0.2, orbitIdle: 0, drag: null,
    rep: null, ri: 0, riF: 0, rate: 1, boost: 0, brake: 0, gearIdx: [1, 5], cad: 0, pw: 0, hr: 0, coast: false, stand: false,
    fade: 1, cutFade: 0, frameMs: 16, prT: 0, lastHud: 0, skipNote: null, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
  }
  const camPos = new THREE.Vector3(-1.5, 1.2, -4.4), camTgt = new THREE.Vector3(0, 1.1, 0)
  const desP = new THREE.Vector3(), desT = new THREE.Vector3()
  let camFov = 36, camK = 2.5
  camera.position.copy(camPos); camera.lookAt(camTgt)

  /* 大小 */
  let post = null, W = 1, H = 1
  let raf = 0, last = 0, visible = true, running = false
  function resize() {
    const r = host.getBoundingClientRect()
    W = Math.max(2, Math.round(r.width)); H = Math.max(2, Math.round(r.height))
    renderer.setPixelRatio(pr)
    renderer.setSize(W, H, false)
    camera.aspect = W / H; camera.updateProjectionMatrix()
    const bw = Math.round(W * pr), bh = Math.round(H * pr)
    if (HIGH) { if (!post) post = makePost(renderer, bw, bh, true); else post.setSize(bw, bh) }
    // 暫停中被改尺寸（例如手機網址列收合）：畫布會被清空，補畫一張，不然滑回來先看到一片黑
    if (!running && S.t > 0) requestAnimationFrame(t => { if (!running) { frame(t); cancelAnimationFrame(raf) } })
  }
  resize()
  const ro = new ResizeObserver(() => resize()); ro.observe(host)

  /* 天色 */
  const todState = { night: 0, e: 0 }
  function applyTod() {
    const e = elevOf(S.tod), k = todSample(e)
    todState.e = e
    const ce = Math.cos(e * Math.PI / 180), se = Math.sin(e * Math.PI / 180)
    U.uSunDir.value.set(Math.sin(SUN_AZ) * ce, se, -Math.cos(SUN_AZ) * ce).normalize()
    U.uZenith.value.copy(k.zen); U.uHorizon.value.copy(k.hor); U.uHorizonSun.value.copy(k.hsun)
    U.uSunGlow.value.copy(k.glow).multiplyScalar(1.6 * smooth(-9, 1, e))
    U.uSunColor.value.copy(k.sun).multiplyScalar(22 * smooth(-1.6, 1.2, e))
    U.uCloudLit.value.copy(k.cl); U.uCloudDark.value.copy(k.cd)
    U.uSunDisc.value = 1
    U.uStars.value = smooth(-3, -11, e)
    U.uMoon.value = smooth(-2, -8, e)
    U.uFogDensity.value = k.fog
    const night = smooth(0.5, -7, e); todState.night = night; U.uNight.value = night
    // 直射光：太陽 → 月光
    const sunI = k.li, moonI = 0.85 * U.uMoon.value
    if (sunI > 0.05) { sun.color.copy(k.sun); sun.intensity = sunI; sun.userData.dir = U.uSunDir.value }
    else { sun.color.set('#a9bcff'); sun.intensity = moonI; sun.userData.dir = MOON_DIR }
    U.uRim.value.copy(k.sun).multiplyScalar(0.55 * smooth(-1.5, 2, e)).add(_v3.set(0.05, 0.07, 0.12).multiplyScalar(night) && new THREE.Color(0.02 * night, 0.03 * night, 0.06 * night))
    seaMat.uniforms.uSunVis.value = smooth(-1.2, 0.8, e)
    seaMat.uniforms.uAmb.value = lerp(1, 0.18, night)
    lampOn = smooth(1.5, -1.5, e)
    beamMat.uniforms.uI.value = night * 0.08
    MW.deli.emissiveIntensity = night * 0.8
    headLight.intensity = night * 55
    for (const E of R1.eyes) E.ring.visible = true
    // 環境光重烘
    if (Math.abs(S.tod - envStamp) > 0.02) {
      if (envRT) envRT.dispose()
      const keepT = renderer.toneMapping
      envRT = pmrem.fromScene(envScene, 0.02, 0.1, 100)
      renderer.toneMapping = keepT
      scene.environment = envRT.texture
      envStamp = S.tod
    }
  }

  /* 重播與物理 */
  function setReplay(rep) {
    S.rep = rep
    S.ri = rep && rep.start ? rep.start : 0
    S.riF = S.ri
    if (rep) { const p0 = rep.pw[S.ri] || 150; S.v = terminalV(p0) }
  }
  function terminalV(P) {
    let v = 8
    for (let i = 0; i < 30; i++) { const f = PHYS.m * PHYS.g * PHYS.crr + 0.5 * PHYS.rho * PHYS.cda * v * v; v = clamp(Math.max(P, 30) * PHYS.eta / f, 1, 25) * 0.5 + v * 0.5 }
    return v
  }
  function pickGear(v, cad) {
    const ratio = v / Math.max(cad / 60, 0.3) / DRIVE.circ
    let ri = S.gearIdx[0]
    const big = DRIVE.rings.length - 1
    if (ri === big && ratio < 1.72) ri = 0
    else if (ri === 0 && ratio > 2.15) ri = big
    const ring = DRIVE.rings[ri]
    let ci = S.gearIdx[1], best = 1e9
    const cur = ring / DRIVE.cogs[ci]
    if (ri !== S.gearIdx[0] || Math.abs(cur - ratio) / ratio > 0.06) {
      DRIVE.cogs.forEach((cog, k) => { const e = Math.abs(ring / cog - ratio); if (e < best) { best = e; ci = k } })
    }
    S.gearIdx = [ri, ci]
    return [DRIVE.rings[ri], DRIVE.cogs[ci]]
  }
  function stepRide(dt) {
    const rep = S.rep
    let pw = 0, cad = 0, hr = 0
    if (rep && rep.n) {
      if (!S.paused) S.riF += dt * S.rate
      if (S.riF >= rep.n - 1) S.riF = rep.start || 0
      let i = Math.floor(S.riF)
      if (rep.skip && rep.skip[i] > i) {                                 // 長時間滑行／停等直接跳過
        const gone = rep.skip[i] - i
        S.riF = rep.skip[i]; i = rep.skip[i]
        S.skipNote = { sec: gone, at: S.t }
      }
      const f = S.riF - i, j = Math.min(i + 1, rep.n - 1)
      pw = lerp(rep.pw[i], rep.pw[j], f); cad = lerp(rep.cad[i], rep.cad[j], f); hr = lerp(rep.hr[i], rep.hr[j], f)
      S.ri = i
    } else { pw = 185 + Math.sin(S.t * 0.2) * 40; cad = 88; hr = 150 }
    pw = Math.max(0, pw + S.boost)
    if (pw > 5 && cad < 20) cad = 70
    S.coast = pw < 3 && cad < 5
    S.stand = pw > 290 && cad < 90
    const cda = S.stand ? PHYS.cdaStand : PHYS.cda
    const drive = pw * PHYS.eta / Math.max(S.v, 1.5)
    const res = PHYS.m * PHYS.g * PHYS.crr + 0.5 * PHYS.rho * cda * S.v * S.v + S.brake * 180
    S.v = Math.max(0.6, S.v + (drive - res) / PHYS.m * dt)
    S.dist += S.v * dt
    S.pw = pw; S.cad = S.coast ? 0 : cad; S.hr = hr
    if (!S.coast) R1.state.gear = pickGear(S.v, cad)
  }

  /* 相機 */
  // 換鏡頭一律硬切＋一下暗場：用內插滑過去會穿過鵜鶘的身體
  let snapNext = false
  function setCamera(mode) {
    if (mode === S.cam) return
    S.cam = mode; S.holdShot = false
    if (mode === 'cinema') { S.shot = 0; S.shotT = 0; cutTo(0) } else { snapNext = true; S.cutFade = 1 }
    if (mode === 'orbit') S.orbitIdle = 0
    if (!running) requestAnimationFrame(t => { if (!running) { frame(t); frame(t + 16); cancelAnimationFrame(raf) } })
  }
  function cutTo(i) {
    const sh = SHOTS[i]
    camPos.fromArray(sh.a.p); camTgt.fromArray(sh.a.t); camFov = sh.a.f; camK = 40
    S.cutFade = 1
  }
  function updateCamera(dt) {
    let f = 40
    const sway = Math.sin(S.t * 0.7) * 0.05
    if (S.cam === 'cinema') {
      S.shotT += dt
      const sh = SHOTS[S.shot]
      if (S.shotT > sh.dur && !S.holdShot) { S.shot = (S.shot + 1) % SHOTS.length; S.shotT = 0; cutTo(S.shot); if (opts.onShot) opts.onShot(SHOTS[S.shot].name) }
      const s2 = SHOTS[S.shot], u = smooth(0, 1, S.shotT / s2.dur)
      desP.fromArray(s2.a.p).lerp(_v.fromArray(s2.b.p), u); desT.fromArray(s2.a.t).lerp(_v.fromArray(s2.b.t), u)
      desP.y += sway * 0.3; f = lerp(s2.a.f, s2.b.f, u)
      camK = Math.min(camK, 40) > 10 ? 40 : camK
    } else if (S.cam === 'chase' || S.cam === 'side') {
      const c = CAM_FIXED[S.cam]
      desP.fromArray(c.p); desT.fromArray(c.t); f = c.f
      desP.x += sway * 0.4; desP.y += Math.sin(S.t * 1.1) * 0.03
    } else if (S.cam === 'pov') {
      R1.head.updateMatrixWorld()
      desP.set(0.05, 0.045, 0.0).applyMatrix4(R1.head.matrixWorld)          // 鵜鶘的眼睛在頭的兩側
      desT.set(0.03, -0.36, -1).applyMatrix4(R1.head.matrixWorld)
      f = 68; camK = Math.max(camK, 30)
    } else {                                                        // orbit
      if (!S.drag) { S.orbitIdle += dt; if (S.orbitIdle > 3) S.orbitAz += dt * 0.12 }
      const r = 5.4
      desP.set(Math.sin(S.orbitAz) * Math.cos(S.orbitEl) * r, 1.0 + Math.sin(S.orbitEl) * r, -Math.cos(S.orbitAz) * Math.cos(S.orbitEl) * r)
      desT.set(0, 1.0, -0.15); f = 42
    }
    const hideHead = S.cam === 'pov'
    R1.skull.visible = !hideHead; R1.helmet.visible = !hideHead
    R1.eyes.forEach(E => { E.eye.visible = !hideHead; E.ring.visible = !hideHead })
    camK = damp(camK, 2.6, 1.2, dt)
    const k = S.cam === 'cinema' ? 40 : camK
    if (snapNext) { camPos.copy(desP); camTgt.copy(desT); camFov = f; snapNext = false }
    camPos.x = damp(camPos.x, desP.x, k, dt); camPos.y = damp(camPos.y, desP.y, k, dt); camPos.z = damp(camPos.z, desP.z, k, dt)
    camTgt.x = damp(camTgt.x, desT.x, k, dt); camTgt.y = damp(camTgt.y, desT.y, k, dt); camTgt.z = damp(camTgt.z, desT.z, k, dt)
    camFov = damp(camFov, f, Math.min(k, 8), dt)
    const shake = clamp(S.v / 10, 0, 1) * (S.cam === 'pov' ? 0.004 : 0.0015)
    camera.position.copy(camPos).add(_v.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, 0))
    camera.lookAt(camTgt)
    if (Math.abs(camera.fov - camFov) > 0.01) { camera.fov = camFov; camera.updateProjectionMatrix() }
  }

  /* 指標互動：環繞模式水平拖曳；點鵜鶘會「咕嚕」 */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2()
  canvas.addEventListener('pointerdown', e => {
    S.drag = { x: e.clientX, y: e.clientY, az: S.orbitAz, moved: false }
  })
  window.addEventListener('pointermove', e => {
    if (!S.drag) return
    const dx = e.clientX - S.drag.x
    if (Math.abs(dx) > 4) S.drag.moved = true
    if (S.cam === 'orbit') { S.orbitAz = S.drag.az - dx * 0.008; S.orbitIdle = 0 }
  })
  window.addEventListener('pointerup', e => {
    if (!S.drag) return
    const d = S.drag; S.drag = null
    if (d.moved) return
    const r = canvas.getBoundingClientRect()
    ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1)
    ray.setFromCamera(ndc, camera)
    const hit = ray.intersectObject(R1.pel, true)[0]
    if (hit) { R1.state.gulp = 1.6; audio.blup(); if (opts.onGulp) opts.onGulp() }
  })

  /* 主迴圈 */
  const audio = makeAudio()
  const hudOut = { kmh: 0, cad: 0, pw: 0, hr: 0, gear: '', km: 0, clock: '', ri: 0, n: 0, cam: '', night: 0, stand: false, coast: false, tod: 0 }
  function frame(now) {
    raf = requestAnimationFrame(frame)
    const dtRaw = last ? (now - last) / 1000 : 0.016; last = now
    const dt = Math.min(0.05, dtRaw)
    S.frameMs = lerp(S.frameMs, dtRaw * 1000, 0.05)
    S.t += dt; U.uTime.value = S.t; U.uDrift.value = S.t * 0.004
    if (S.todAuto && !S.reduced) S.tod = Math.min(0.92, S.tod + dt * S.todRate)
    applyTod()
    stepRide(dt)
    // 海浪相位（雙精度在 JS 算好再丟 uniform）
    W5.forEach((w, i) => { seaU.uPh.value[i] = ((-w.k * w.dz * S.dist - w.w * S.t + w.ph0) % (Math.PI * 2)) })
    RIP.forEach((r, i) => { seaU.uRipPh.value[i] = ((-r.k * r.dz * S.dist - r.w * S.t + r.ph0) % (Math.PI * 2)) })
    seaU.uScrollMod.value = S.dist % 800
    seaU.uShorePh.value.set((S.dist * SHORE_K[0]) % (Math.PI * 2), (S.dist * SHORE_K[1]) % (Math.PI * 2), (S.dist * SHORE_K[2]) % (Math.PI * 2))
    U.uWind.value = 0.25 + Math.min(S.v / 14, 1) * 0.35
    // 地形塊
    const cMin = Math.floor((S.dist - Z_BEHIND) / CH), cMax = Math.floor((S.dist + Z_AHEAD) / CH)
    chunks.forEach((ch, c) => { if (c < cMin || c > cMax) { ch.g.visible = false; chunkPool.push(ch); chunks.delete(c) } })
    let built = 0
    for (let c = cMin; c <= cMax; c++) { if (!chunks.has(c) && built < 3) { chunks.set(c, makeChunk(c)); built++ } }
    chunks.forEach((ch, c) => { ch.g.position.z = -c * CH + S.dist })
    const lamps = placeProps(S.dist, todState.night, S.t)
    // 最近的幾盞路燈給真的點光源
    const near = lamps.filter(L => L.on > 0.02).sort((a, b) => Math.abs(a.z + 2) - Math.abs(b.z + 2)).slice(0, lampLights.length)
    lampLights.forEach((l, i) => {
      const L = near[i]
      if (L) { l.position.set(LAMP_X - LAMP_ARM - 0.12, LAMP_H + 0.1, L.z); l.intensity = 95 * L.on * smooth(60, 10, Math.abs(L.z)) } else l.intensity = 0
    })
    poolMat.uniforms.uI.value = lampOn
    // 燈塔光束
    beam.rotation.y = S.t * 0.63
    // 騎士
    R1.update(dt, { v: S.v, cad: S.cad, pw: S.pw, coast: S.coast, t: S.t, standWant: S.stand })
    // 陰影跟著騎士
    const ld = sun.userData.dir || U.uSunDir.value
    sun.target.position.set(0, 0.6, -2.5)
    sun.position.copy(sun.target.position).addScaledVector(ld, 45)
    // 相機與天空
    updateCamera(dt)
    sky.position.copy(camera.position)
    farGroup.position.set(camera.position.x * 0, 0, 0)
    U.uCamRot.value.setFromMatrix4(camera.matrixWorld)
    // 車燈
    glow.add(0, 0.835, -0.64, 0.12 + 0.14 * todState.night, lin('#fff6e6'), 0.8 + todState.night * 2.2)
    glow.add(0, 0.86, 0.24, 0.16 + 0.08 * todState.night, lin('#ff2a1a'), (Math.sin(S.t * 12) > 0 ? 1 : 0.12) * (0.8 + todState.night * 2))
    glow.commit()
    // 剪接淡入
    S.cutFade = Math.max(0, S.cutFade - dt * 5)
    const fade = S.fade * (1 - S.cutFade * 0.55)
    // 算圖
    const k = todSample(todState.e)
    if (HIGH) {
      renderer.setRenderTarget(post.rtScene); renderer.render(scene, camera)
      post.render(k.ex, 0.55 + todState.night * 0.35, S.t, fade)
    } else {
      renderer.toneMappingExposure = k.ex * fade
      renderer.setRenderTarget(null); renderer.render(scene, camera)
    }
    // 動態解析度
    S.prT += dtRaw
    if (S.prT > 2) {
      S.prT = 0
      if (S.frameMs > 24 && pr > 0.6) { pr = Math.max(0.6, pr - 0.15); resize() }
      else if (S.frameMs < 13 && pr < maxPR) { pr = Math.min(maxPR, pr + 0.1); resize() }
    }
    audio.update({ v: S.v, cad: S.cad, coast: S.coast, night: todState.night })
    if (opts.onFrame && now - S.lastHud > 90) {
      S.lastHud = now
      const m = clockOf(todState.e)
      Object.assign(hudOut, {
        kmh: S.v * 3.6, cad: S.cad, pw: S.pw, hr: S.hr, gear: R1.state.gear[0] + '×' + R1.state.gear[1], km: S.dist / 1000,
        clock: String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(Math.floor(m % 60)).padStart(2, '0'),
        ri: S.ri, n: S.rep ? S.rep.n : 0, cam: S.cam, shot: S.cam === 'cinema' ? SHOTS[S.shot].name : '', night: todState.night,
        stand: S.stand, coast: S.coast, tod: S.tod, skip: S.skipNote && S.t - S.skipNote.at < 3 ? S.skipNote.sec : 0, paused: S.paused,
      })
      opts.onFrame(hudOut)
    }
  }
  function start() { if (running) return; running = true; last = 0; raf = requestAnimationFrame(frame) }
  function stop() { running = false; cancelAnimationFrame(raf) }
  const io = new IntersectionObserver(es => { visible = es[0].isIntersecting; if (visible && !document.hidden && !S.reduced) start(); else stop() }, { threshold: 0.02 })
  io.observe(host)
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else if (visible && !S.reduced) start() })
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); stop(); if (opts.onLost) opts.onLost() })

  // 第一幀：先把相機擺好、畫一張（reduced-motion 就停在這張）
  applyTod(); cutTo(0)
  if (S.reduced) { stop(); requestAnimationFrame(t => { frame(t); cancelAnimationFrame(raf) }) }
  else start()

  return {
    quality,
    setCamera,
    shot(i, hold) { S.cam = 'cinema'; S.shot = ((i % SHOTS.length) + SHOTS.length) % SHOTS.length; S.shotT = hold ? SHOTS[S.shot].dur * 0.5 : 0; S.holdShot = !!hold; cutTo(S.shot) },
    get shots() { return SHOTS.map(x => x.name) },
    get camera() { return S.cam },
    setTod(v) { S.tod = clamp(v, 0, 1); S.todAuto = false; if (!running) requestAnimationFrame(t => { frame(t); if (!running) cancelAnimationFrame(raf) }) },
    get tod() { return S.tod },
    setAuto(b) { S.todAuto = !!b },
    setPaused(b) { S.paused = !!b },
    get paused() { return S.paused },
    get still() { return !running && S.reduced },
    setReplay, seek(i) { if (S.rep) { S.riF = clamp(i, 0, S.rep.n - 2) } },
    setBoost(w) { S.boost = w }, setBrake(b) { S.brake = b ? 1 : 0 },
    setDrive(d) { if (d.rings) DRIVE.rings = d.rings.slice().sort((a, b) => a - b); if (d.cogs) DRIVE.cogs = d.cogs.slice().sort((a, b) => a - b); if (d.circ) DRIVE.circ = d.circ },
    sound(on) { if (on) return audio.start(); audio.stop(); return false },
    get soundOn() { return audio.on },
    play() { S.reduced = false; start() },
    renderOnce() { requestAnimationFrame(t => { frame(t); if (!running) cancelAnimationFrame(raf) }) },
    _dbg: () => ({ glow: glow.mesh, farGroup, sky, beam, scene }),
    stats() { return { pr, frameMs: S.frameMs, quality, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, dist: S.dist, v: S.v, tod: S.tod, cam: S.cam, shot: SHOTS[S.shot].name } },
    dispose() { stop(); ro.disconnect(); io.disconnect(); renderer.dispose(); if (post) post.dispose() },
  }
}

/* ══ FIT 解析（只取重播要的欄位）════════════════════════════════════
   record(20)：timestamp 253、power 7、cadence 4、heart_rate 3、distance 5、altitude 2 / enhanced_altitude 78
   event(21)：event 0 == 42/43（換檔）時，data 3 的四個位元組依序是 rear_num、rear_teeth、front_num、front_teeth
   （2026-09-23 那趟用 fitdecode 對過：570494728 = 34 × 15）。 */
function parseFit(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf)
  const hs = u8[0], dataSize = dv.getUint32(4, true)
  if (String.fromCharCode(u8[8], u8[9], u8[10], u8[11]) !== '.FIT') throw new Error('不是 FIT 檔')
  const end = Math.min(hs + dataSize, buf.byteLength)
  const defs = [], recs = [], gears = []
  let p = hs, lastTs = 0
  const INV = { 1: 0xFF, 2: 0xFFFF, 4: 0xFFFFFFFF }
  function val(off, size, type, le) {
    const bt = type & 0x1f
    if (size === 1) { const v = u8[off]; return v === 0xFF || (bt === 1 && v === 0x7F) ? null : (bt === 1 ? (v << 24 >> 24) : v) }
    if (size === 2) { const v = dv.getUint16(off, le); if (bt === 3) { return v === 0x7FFF ? null : (v << 16 >> 16) } return v === 0xFFFF ? null : v }
    if (size === 4) {
      if (bt === 8) return dv.getFloat32(off, le)
      const v = dv.getUint32(off, le)
      if (bt === 5) return v === 0x7FFFFFFF ? null : (v | 0)
      return v === INV[4] ? null : v
    }
    return null
  }
  function readData(def, off, ts) {
    const o = {}
    for (const f of def.fields) { if (f.size <= 4) o[f.num] = val(off, f.size, f.type, def.le); off += f.size }
    off += def.dev
    if (o[253] != null) lastTs = o[253]
    const t = ts != null ? ts : (o[253] != null ? o[253] : lastTs)
    if (def.g === 20) {
      recs.push({ t, pw: o[7], cad: o[4], hr: o[3], dist: o[5] != null ? o[5] / 100 : null, alt: o[78] != null ? o[78] / 5 - 500 : (o[2] != null ? o[2] / 5 - 500 : null) })
    } else if (def.g === 21 && (o[0] === 42 || o[0] === 43)) {
      const d = o[3]
      if (d != null) gears.push({ t, front: (d >>> 24) & 0xff, rear: (d >>> 8) & 0xff })
      else if (o[10] != null && o[12] != null) gears.push({ t, front: o[10], rear: o[12] })
    }
    return off
  }
  while (p < end) {
    const h = u8[p++]
    if (h & 0x80) {
      const lt = (h >> 5) & 3, offs = h & 0x1f
      let ts = (lastTs & ~0x1f) + offs; if (offs < (lastTs & 0x1f)) ts += 0x20
      lastTs = ts
      const def = defs[lt]; if (!def) throw new Error('FIT：未定義的訊息 ' + lt)
      p = readData(def, p, ts)
      continue
    }
    const lt = h & 0x0f
    if (h & 0x40) {
      const hasDev = h & 0x20
      p++
      const le = u8[p++] === 0
      const g = le ? dv.getUint16(p, true) : dv.getUint16(p, false); p += 2
      const nf = u8[p++], fields = []
      for (let i = 0; i < nf; i++) { fields.push({ num: u8[p], size: u8[p + 1], type: u8[p + 2] }); p += 3 }
      let dev = 0
      if (hasDev) { const nd = u8[p++]; for (let i = 0; i < nd; i++) { dev += u8[p + 1]; p += 3 } }
      defs[lt] = { g, le, fields, dev }
    } else {
      const def = defs[lt]; if (!def) throw new Error('FIT：未定義的訊息 ' + lt)
      p = readData(def, p, null)
    }
  }
  return { recs, gears }
}

/* 逐秒陣列：以時間戳對齊、空洞補 0（停表的地方就是停等），並預先算好「長滑行」的跳點 */
function toReplay(fit, opt) {
  opt = opt || {}
  const R = fit.recs.filter(r => r.t)
  if (R.length < 60) return null
  const t0 = R[0].t, n = Math.min(R[R.length - 1].t - t0 + 1, 6 * 3600)
  const pw = new Uint16Array(n), cad = new Uint8Array(n), hr = new Uint8Array(n), alt = new Float32Array(n), dist = new Float32Array(n)
  let lastAlt = R[0].alt || 0, lastD = 0, lastHr = R[0].hr || 0
  let ri = 0
  for (let i = 0; i < n; i++) {
    while (ri < R.length - 1 && R[ri].t - t0 < i) ri++
    const r = R[ri]
    if (r.t - t0 === i) {
      pw[i] = r.pw || 0; cad[i] = r.cad || 0; if (r.hr) lastHr = r.hr; hr[i] = lastHr
      if (r.alt != null) lastAlt = r.alt; if (r.dist != null) lastD = r.dist
    } else { hr[i] = lastHr }
    alt[i] = lastAlt; dist[i] = lastD
  }
  // 連續 >= 25 秒沒出力就整段跳過
  const skip = new Int32Array(n)
  for (let i = 0; i < n;) {
    if (pw[i] === 0 && cad[i] === 0) { let j = i; while (j < n && pw[j] === 0 && cad[j] === 0) j++; if (j - i >= 25 && j < n) for (let k = i; k < j - 3; k++) skip[k] = j - 3; i = j } else i++
  }
  return { n, t0, pw, cad, hr, alt, dist, skip, gears: fit.gears, start: opt.start || 0 }
}

window.PelicanCoast = { mount, parseFit, toReplay, PHYS, DRIVE }
})()
