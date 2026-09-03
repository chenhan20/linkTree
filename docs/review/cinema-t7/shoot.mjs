// CDP 截圖管線：不用 --screenshot 的 virtual-time（頁面有常駐 rAF 與影片，永遠等不到靜止）
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
const CH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9333, OUT = process.argv[2], VIEWS = process.argv.slice(3)
const W = +(process.env.W || 1440), H = +(process.env.H || 1000), MOBILE = process.env.MOBILE === '1'
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=/tmp/cinema-shoot-${Date.now()}`, `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' })
const sleep = ms => new Promise(r => setTimeout(r, ms))
let wsUrl = null
for (let i = 0; i < 40 && !wsUrl; i++) { await sleep(250); try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); const pg = j.find(t => t.type === 'page'); if (pg) wsUrl = pg.webSocketDebuggerUrl } catch (e) {} }
if (!wsUrl) { console.log('no target'); chrome.kill(); process.exit(1) }
const ws = new WebSocket(wsUrl)
await new Promise(r => ws.addEventListener('open', r))
let id = 0; const pending = new Map()
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
await send('Page.enable'); await send('Runtime.enable')
if (MOBILE) await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true })
else await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false })
const evalJs = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null }
for (const v of VIEWS) {
  await send('Page.navigate', { url: `http://localhost:8934/strava_cinema.html?shoot=${Date.now()}#${v}` })
  let ok = false
  for (let i = 0; i < 80; i++) { await sleep(250); ok = await evalJs(`!!document.querySelector('#content .view.is-on') && document.body.dataset.view === ${JSON.stringify(v === 'today' ? 'overview' : v)}`); if (ok) break }
  await sleep(2600)   // 場景溶接 1.5s ＋ 光軌走一段
  const info = await evalJs(`JSON.stringify({view:document.body.dataset.view, fx:document.body.dataset.fx, env:(window.__cinemaFx&&window.__cinemaFx.stages()[0].env||{}).name, layers:(window.__cinemaFx&&window.__cinemaFx.stages()[0].env||{layers:[]}).layers.length, sw:document.documentElement.scrollWidth})`)
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${OUT}/shot_${v}${MOBILE ? '_m' : ''}.png`, Buffer.from(shot.result.data, 'base64'))
  console.log(v, ok ? 'ready' : 'timeout', info)
}
ws.close(); chrome.kill(); process.exit(0)
