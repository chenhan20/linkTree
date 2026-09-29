#!/usr/bin/env node
/* 放映室的預覽圖：headless Chrome（swiftshader）開三支片真正的頁面，截一格，裁成正方形。
 * 不開任何有視窗的瀏覽器；Node 24 內建 WebSocket，不必裝套件。
 *
 *   node scripts/shoot-theatre-previews.mjs            # 三張都重拍
 *   node scripts/shoot-theatre-previews.mjs film       # 只重拍水墨那張
 *
 * 輸出 assets/theatre/{pelican,film}-{lg,sm}.jpg、chronicle-{lg,sm}.png（lg 給放映室大圓，sm 給首頁與封面小圓）：
 *   pelican   __pelican.snapshot()：只有 3D 畫面（沒有 HUD），以鵜鶘為中心裁正方形。
 *             影子是當下那一趟的 PR／上一次／全力預估，所以每次重拍畫面會不一樣（換趟、換時段的天色）
 *   film      ?t=118，中社路「巔」卷的後跟鏡頭；隱藏所有 DOM 介面，只留 WebGL 畫布
 *   chronicle __chronicle.render(5.2)：「READY　PLAYER 1　STEVE」那一格（沒有 HUD、字短、START 牌在右邊），取 x 90–256、y 14–180（去掉上緣 HUD）的 166×166，整數倍放大（×5／×3）保持像素邊緣
 * 換畫面就改下面 SHOTS 裡的 t／裁切位置。
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'assets', 'theatre')
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.fit': 'application/octet-stream' }
const want = new Set(process.argv.slice(2))

const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  const p = path.join(ROOT, u.endsWith('/') ? u + 'index.html' : u)
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' })
  fs.createReadStream(p).pipe(res)
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const BASE = `http://127.0.0.1:${server.address().port}`

async function launch(w, h) {
  const port = 20000 + Math.floor(Math.random() * 20000)
  const proc = spawn(CHROME, ['--headless=new', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--hide-scrollbars', '--mute-audio',
    `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/theatre-shoot-${port}`, `--window-size=${w},${h}`, 'about:blank'], { detached: true, stdio: 'ignore' })
  let page
  for (let i = 0; i < 80 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page') } catch (e) {} if (!page) await new Promise(r => setTimeout(r, 250)) }
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise(r => ws.addEventListener('open', r))
  let id = 0; const pend = new Map()
  ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); const p = m.id && pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result) } })
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })) })
  await send('Page.enable'); await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value }
  const until = async (expr, ms = 90000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await ev(expr)) return } catch (e) {} await new Promise(r => setTimeout(r, 250)) } throw new Error('timeout: ' + expr) }
  return { send, ev, until, nav: url => send('Page.navigate', { url }), sleep: ms => new Promise(r => setTimeout(r, ms)), close: () => { try { process.kill(-proc.pid) } catch (e) {} } }
}

// 在頁面裡把 dataURL 裁切＋縮放成指定大小（整數倍放大時關掉平滑，像素邊緣才會銳利）
const RESIZE = `window.__rs = (url, sx, sy, sw, sh, size, mime, q, smooth) => new Promise(res => {
  const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = c.height = size
    const g = c.getContext('2d'); g.imageSmoothingEnabled = smooth; g.imageSmoothingQuality = 'high'
    g.drawImage(im, sx, sy, sw, sh, 0, 0, size, size); res(c.toDataURL(mime, q)) }; im.src = url })`
const save = (name, dataUrl) => { const b = Buffer.from(dataUrl.split(',')[1], 'base64'); fs.writeFileSync(path.join(OUT, name), b); console.log(name.padEnd(20), (b.length / 1024).toFixed(0) + ' KB') }

const SHOTS = {
  async pelican() {
    const c = await launch(1800, 1000)
    try {
      await c.nav(`${BASE}/strava_pelican.html`)
      await c.until('window.__pelican && document.fonts.status === "loaded"')
      await c.sleep(9000)                       // 等 FIT 載入、影子就位
      await c.ev(RESIZE)
      const snap = await c.ev(`(() => { const s = __pelican.snapshot(2000); return JSON.stringify({ w: s.width, h: s.height, url: s.toDataURL('image/png') }) })()`)
      const { w, h, url } = JSON.parse(snap)
      // 取高度的 88%、去掉最上面 12% 的空天：鵜鶘在 60% 高、兩側的影子都留在圓裡
      const side = Math.round(h * 0.88), sx = Math.round(w * 0.5 - side / 2), sy = Math.round(h * 0.12)
      for (const [name, size] of [['pelican-lg.jpg', 1000], ['pelican-sm.jpg', 480]])
        save(name, await c.ev(`__rs(${JSON.stringify(url)}, ${sx}, ${sy}, ${side}, ${side}, ${size}, 'image/jpeg', .86, true)`))
    } finally { c.close() }
  },
  async film() {
    const c = await launch(1600, 1000)
    try {
      await c.nav(`${BASE}/strava_film.html?t=118`)
      await c.until('window.__film && window.__film.M && document.fonts.status === "loaded"')
      await c.ev(`(() => { const s = document.createElement('style'); s.textContent = '#film>*:not(#gl),.back{display:none!important}'; document.head.appendChild(s) })()`)
      await c.ev('__film.render(118)'); await c.sleep(2500)
      const shot = await c.send('Page.captureScreenshot', { format: 'png', clip: { x: 400, y: 0, width: 1000, height: 1000, scale: 1 } })
      const url = 'data:image/png;base64,' + shot.data
      await c.ev(RESIZE)
      for (const [name, size] of [['film-lg.jpg', 1000], ['film-sm.jpg', 480]])
        save(name, await c.ev(`__rs(${JSON.stringify(url)}, 0, 0, 1000, 1000, ${size}, 'image/jpeg', .86, true)`))
    } finally { c.close() }
  },
  async chronicle() {
    const c = await launch(1400, 900)
    try {
      await c.nav(`${BASE}/strava_chronicle.html`)
      await c.until('window.__chronicle && document.querySelector("canvas") && document.fonts.status === "loaded"')
      await c.sleep(1500)
      await c.ev('__chronicle.render(5.2)'); await c.sleep(400)
      const url = await c.ev(`document.querySelector('canvas').toDataURL('image/png')`)
      await c.ev(RESIZE)
      for (const [name, size] of [['chronicle-lg.png', 830], ['chronicle-sm.png', 498]])
        save(name, await c.ev(`__rs(${JSON.stringify(url)}, 90, 14, 166, 166, ${size}, 'image/png', 1, false)`))
    } finally { c.close() }
  },
}

fs.mkdirSync(OUT, { recursive: true })
for (const [k, fn] of Object.entries(SHOTS)) if (!want.size || want.has(k)) { console.log('→', k); await fn() }
server.close()
process.exit(0)
