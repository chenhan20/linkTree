#!/usr/bin/env node
/* 社群分享預覽圖（Open Graph，1200×630）：headless Chrome 開首頁真正的畫面，隱藏連結清單與雜訊，只留
 * 火箭＋名字＋「T-00:00:00 · ALL SYSTEMS GO」，截成 assets/og/linktree-og.jpg。不手繪、不開有視窗的瀏覽器。
 * Node 24 內建 WebSocket，不必裝套件。
 *
 *   node scripts/shoot-og-image.mjs
 *
 * linkTreeIndex.html 的 og:image／twitter:image 指向這張的絕對網址。首頁畫面（火箭、星空、名字）改了就重拍。
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'assets', 'og')
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' }

const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  const p = path.join(ROOT, u)
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' })
  fs.createReadStream(p).pipe(res)
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const BASE = `http://127.0.0.1:${server.address().port}`

const port = 20000 + Math.floor(Math.random() * 20000)
const proc = spawn(CHROME, ['--headless=new', '--hide-scrollbars', '--mute-audio', `--remote-debugging-port=${port}`,
  `--user-data-dir=/tmp/og-shoot-${port}`, '--window-size=1200,630', 'about:blank'], { detached: true, stdio: 'ignore' })
let page
for (let i = 0; i < 80 && !page; i++) {
  try { page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page') } catch (e) {}
  if (!page) await new Promise(r => setTimeout(r, 250))
}
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise(r => ws.addEventListener('open', r))
let id = 0; const pend = new Map()
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); const p = m.id && pend.get(m.id); if (p) { pend.delete(m.id); p(m) } })
const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async expr => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value
const sleep = ms => new Promise(r => setTimeout(r, ms))

try {
  await send('Page.enable'); await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: `${BASE}/linkTreeIndex.html` })
  for (let i = 0; i < 60; i++) { if (await ev(`!!document.querySelector('.lt-name') && document.fonts.status === 'loaded'`)) break; await sleep(300) }
  await ev(`(() => { const s = document.createElement('style'); s.textContent = [
    '.links,.musk-q,.lt-footer,.op-corner,.telemetry,.hud,.launch-seq,.ver-switch{display:none!important}',
    '.lt-page{min-height:630px!important;height:630px!important;justify-content:center!important;padding:0!important}',
    '.rocket-scene{transform:scale(1.35);margin-bottom:34px}',
    '.lt-name{font-size:76px!important;letter-spacing:6px!important}',
    '.lt-tagline{font-size:22px!important;letter-spacing:7px!important}',
    '.lt-sub{font-size:19px!important;letter-spacing:5px!important;margin-top:14px!important}'
  ].join('\\n'); document.head.appendChild(s) })()`)
  await sleep(2500)   // 讓火焰動畫與星空畫幾幀
  const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 88, clip: { x: 0, y: 0, width: 1200, height: 630, scale: 1 } })
  fs.mkdirSync(OUT, { recursive: true })
  const buf = Buffer.from(shot.result.data, 'base64')
  fs.writeFileSync(path.join(OUT, 'linktree-og.jpg'), buf)
  console.log('assets/og/linktree-og.jpg', (buf.length / 1024).toFixed(0) + ' KB')
} finally {
  try { process.kill(-proc.pid) } catch (e) {}
  server.close()
}
process.exit(0)
