// CDP 探針：導航到某個 view，等 ready，再 evaluate 一段 JS 印結果
import { spawn } from 'node:child_process'
const CH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9334, VIEW = process.argv[2], EXPR = process.argv[3], WAIT = +(process.env.WAIT || 2500)
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${PORT}`, `--user-data-dir=/tmp/cinema-probe-${Date.now()}`, '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' })
const sleep = ms => new Promise(r => setTimeout(r, ms))
let wsUrl = null
for (let i = 0; i < 40 && !wsUrl; i++) { await sleep(250); try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); const pg = j.find(t => t.type === 'page'); if (pg) wsUrl = pg.webSocketDebuggerUrl } catch (e) {} }
const ws = new WebSocket(wsUrl); await new Promise(r => ws.addEventListener('open', r))
let id = 0; const pending = new Map()
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
await send('Page.enable'); await send('Runtime.enable')
if (process.env.MOBILE === '1') await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
else if (process.env.W) await send('Emulation.setDeviceMetricsOverride', { width: +process.env.W, height: +(process.env.H || 1000), deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: `http://localhost:8934/strava_cinema.html?probe=${Date.now()}#${VIEW}` })
const evalJs = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : (r.result && r.result.exceptionDetails ? 'EXC ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300) : null) }
for (let i = 0; i < 80; i++) { await sleep(250); if (await evalJs(`!!document.querySelector('#content .view.is-on')`)) break }
await sleep(WAIT)
console.log(await evalJs(EXPR))
ws.close(); chrome.kill(); process.exit(0)
