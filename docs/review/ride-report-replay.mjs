// 騎乘報告頁的回放海報（2026-10-15）：版面、點了換 <video> 真的從 Release 載、手機出血。headless CDP。
// 用法：node docs/review/ride-report-replay.mjs <repo 根目錄> <輸出目錄> rides/<date>.html

// headless check of the replay poster in a ride report: layout, click → video plays, mobile
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
const [ROOT, OUT, PAGE] = process.argv.slice(2)
fs.mkdirSync(OUT, { recursive: true })
const HTTP_PORT = 8000 + Math.floor(Math.random() * 1000), CDP_PORT = 9300 + Math.floor(Math.random() * 500)
const CH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const srv = spawn('python3', ['-c', `
import http.server, socketserver, os
os.chdir(${JSON.stringify(ROOT)})
class S(socketserver.ThreadingTCPServer):
    allow_reuse_address = True; request_queue_size = 128
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
S(('127.0.0.1', ${HTTP_PORT}), H).serve_forever()`], { stdio: 'ignore', detached: true })
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=/tmp/rr-test-${Date.now()}`, '--window-size=1280,1100', 'about:blank'], { stdio: 'ignore', detached: true })
const cleanup = () => { for (const p of [chrome, srv]) { try { process.kill(-p.pid, 'SIGKILL') } catch (e) { try { p.kill('SIGKILL') } catch (e2) {} } } }
process.on('exit', cleanup)
const sleep = ms => new Promise(r => setTimeout(r, ms))
let ws, id = 0; const pending = new Map(); const errs = []
for (let i = 0; i < 50 && !ws; i++) { try { const l = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json(); const t = l.find(x => x.type === 'page'); if (t) { ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r) } } catch (e) {} if (!ws) await sleep(200) }
ws.onmessage = m => { const j = JSON.parse(m.data); if (j.id && pending.has(j.id)) { pending.get(j.id)(j.result || j.error); pending.delete(j.id) }
  if (j.method === 'Runtime.exceptionThrown') errs.push(j.params.exceptionDetails.text); if (j.method === 'Runtime.consoleAPICalled' && j.params.type === 'error') errs.push(j.params.args.map(a => a.value || a.description).join(' ')) }
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value }
const waitFor = async (e, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e)) return true; await sleep(150) } return false }
const shot = async (name, clip) => { const r = await send('Page.captureScreenshot', Object.assign({ format: 'png' }, clip ? { clip: Object.assign({ scale: 1 }, clip) } : {})); fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64')) }
const res = []; const check = (n, ok, info = '') => { res.push({ n, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + n + (info ? '  ' + info : '')) }
try {
  await send('Runtime.enable'); await send('Page.enable')
  await send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/${PAGE}` })
  check('page renders', await waitFor(`document.querySelectorAll('.sec:not([hidden])').length > 2`, 15000))
  check('replay figure present', await ev(`!!document.getElementById('replay')`))
  const g = JSON.parse(await ev(`(()=>{const f=document.getElementById('replay');const b=document.getElementById('rp-play');const img=b.querySelector('img');const r=b.getBoundingClientRect();const strip=document.getElementById('strip').getBoundingClientRect();const assess=document.getElementById('s-assess').getBoundingClientRect();const page=document.querySelector('.page').getBoundingClientRect();return JSON.stringify({w:Math.round(r.width),h:Math.round(r.height),pageW:Math.round(page.width),belowStrip:r.top>=strip.bottom,aboveAssess:r.bottom<=assess.top,imgLoaded:img.complete&&img.naturalWidth>0,imgSrc:img.getAttribute('src'),badge:b.querySelector('.rp-badge').textContent.trim()})})()`))
  console.log(JSON.stringify(g))
  check('poster fills page width, 16:9, between strip and assessment', g.w === g.pageW - 68 && Math.abs(g.w / g.h - 16 / 9) < 0.03 && g.belowStrip && g.aboveAssess, JSON.stringify(g))
  check('poster image loads (relative ../assets path)', g.imgLoaded, g.imgSrc)
  await ev(`document.getElementById('replay').scrollIntoView({block:'center'})`); await sleep(300)
  await shot('report-replay-desktop.png')
  await ev(`document.getElementById('rp-play').click()`)
  check('click swaps in a <video> with release src', await waitFor(`(()=>{const v=document.querySelector('#rp-play video');return v&&/releases\\/download\\/ride-videos\\//.test(v.src)})()`, 3000))
  const loaded = await waitFor(`(()=>{const v=document.querySelector('#rp-play video');return v&&v.readyState>=1&&v.duration>80})()`, 25000)
  await sleep(2500)
  const vs = JSON.parse(await ev(`(()=>{const v=document.querySelector('#rp-play video');const r=v.getBoundingClientRect();return JSON.stringify({dur:v.duration,ct:v.currentTime,paused:v.paused,err:v.error&&v.error.code,w:Math.round(r.width),h:Math.round(r.height)})})()`))
  console.log(JSON.stringify(vs))
  check('video loads from GitHub and plays', loaded && !vs.err && !vs.paused && vs.ct > 0.5, JSON.stringify(vs))
  check('video keeps the poster box size', vs.w === g.w && vs.h === g.h, `${vs.w}x${vs.h} vs ${g.w}x${g.h}`)
  await shot('report-replay-playing.png')
  // mobile
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/${PAGE}` })
  await waitFor(`!!document.getElementById('rp-play')`, 15000); await sleep(800)
  const m = JSON.parse(await ev(`(()=>{const r=document.getElementById('rp-play').getBoundingClientRect();return JSON.stringify({l:Math.round(r.left),w:Math.round(r.width),overflow:document.documentElement.scrollWidth>innerWidth})})()`))
  console.log('mobile', JSON.stringify(m))
  check('mobile: poster bleeds full width, no horizontal overflow', m.l === 0 && m.w === 390 && !m.overflow, JSON.stringify(m))
  await ev(`document.getElementById('replay').scrollIntoView({block:'center'})`); await sleep(300)
  await shot('report-replay-mobile.png')
  check('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '))
} catch (e) { console.log('ERROR', e.message); res.push({ n: 'script', ok: false }) }
console.log(`${res.filter(r => r.ok).length}/${res.length} passed`)
cleanup(); process.exit(res.every(r => r.ok) ? 0 : 1)
