// 活動詳情彈窗的「動畫／影片」切換回歸（2026-10-15）。headless Chrome + CDP，Node 24 內建 WebSocket。
// 用法：node docs/review/ride-video-modal.mjs <repo 根目錄> <輸出目錄>
// 會真的去 GitHub Release 抓一支 4 MB 的影片驗證能載、能播；離線跑那兩項會 FAIL，其餘不受影響。

// headless CDP regression for the ride-video toggle in activity-modal.js
// usage: node test-video-modal.mjs <siteRoot> <outDir>
import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const [ROOT, OUT] = process.argv.slice(2)
fs.mkdirSync(OUT, { recursive: true })
const HTTP_PORT = 8000 + Math.floor(Math.random() * 1000)
const CDP_PORT = 9300 + Math.floor(Math.random() * 500)
const CH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

// static server with a bigger backlog (python's default backlog of 5 drops parallel fetches)
const srvScript = `
import http.server, socketserver, sys, os
os.chdir(${JSON.stringify(ROOT)})
class S(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    request_queue_size = 128
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
S(('127.0.0.1', ${HTTP_PORT}), H).serve_forever()
`
const srv = spawn('python3', ['-c', srvScript], { stdio: 'ignore', detached: true })
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=/tmp/vm-test-${Date.now()}`, '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore', detached: true })
const cleanup = () => { for (const p of [chrome, srv]) { try { process.kill(-p.pid, 'SIGKILL') } catch (e) { try { p.kill('SIGKILL') } catch (e2) {} } } }
process.on('exit', cleanup)

const sleep = ms => new Promise(r => setTimeout(r, ms))
let ws, id = 0; const pending = new Map(); const consoleErrs = []
async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()
      const t = list.find(x => x.type === 'page')
      if (t) { ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r); break }
    } catch (e) {}
    await sleep(200)
  }
  if (!ws) throw new Error('no CDP target')
  ws.onmessage = m => {
    const j = JSON.parse(m.data)
    if (j.id && pending.has(j.id)) { pending.get(j.id)(j.result || j.error); pending.delete(j.id) }
    if (j.method === 'Runtime.exceptionThrown') consoleErrs.push(j.params.exceptionDetails.text + ' ' + (j.params.exceptionDetails.exception?.description || ''))
    if (j.method === 'Runtime.consoleAPICalled' && j.params.type === 'error') consoleErrs.push(j.params.args.map(a => a.value || a.description).join(' '))
  }
}
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value }
const waitFor = async (expr, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(150) } return false }
const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64')) }
const results = []
const check = (name, ok, info = '') => { results.push({ name, ok: !!ok, info }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')) }

try {
  await connect()
  await send('Runtime.enable'); await send('Page.enable')
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'document.addEventListener("DOMContentLoaded",()=>{const s=document.createElement("style");s.textContent="html,*{scroll-behavior:auto!important}";document.head.appendChild(s)})' })
  await send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/strava.html#log` })
  check('log view renders cards', await waitFor(`document.querySelectorAll('.activity-card').length > 10`, 20000))
  // 紀錄一開始只畫最近幾天，「顯示全部」展開後才看得到 80 幾趟
  await ev(`document.getElementById('show-more-btn')?.click()`)
  check('expanded to full log', await waitFor(`document.querySelectorAll('.activity-card').length > 150`, 20000), await ev(`document.querySelectorAll('.activity-card').length`))
  check('video buttons injected', await waitFor(`document.querySelectorAll('.act-video-btn').length > 0`, 15000))
  const counts = await ev(`JSON.stringify({video:document.querySelectorAll('.act-video-btn').length, detail:document.querySelectorAll('.act-detail-btn').length, cards:document.querySelectorAll('.activity-card').length})`)
  console.log('counts', counts)
  const c = JSON.parse(counts)
  check('video buttons <= detail buttons', c.video > 0 && c.video <= c.detail, counts)

  // which strava ids got a video button; cross-check with ride-videos.json by date+time on the node side
  const mapped = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('.act-video-btn')].map(b=>{const card=b.closest('.activity-card');return {id:b.dataset.actId}}))`))
  const strava = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/strava.json'), 'utf8'))
  const vids = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/ride-videos.json'), 'utf8')).videos
  const byId = new Map(strava.recent_rides.map(r => [String(r.id), r]))
  const expect = strava.recent_rides.filter(r => !r.trainer && Object.values(vids).some(v => {
    if (v.date !== r.date) return false
    const [h, m] = (r.time || '').split(':').map(Number); const vm = /T(\d\d):(\d\d)/.exec(v.start)
    return vm && Math.abs((+vm[1] * 60 + +vm[2]) - (h * 60 + m)) <= 10
  }))
  const got = new Set(mapped.map(x => x.id))
  const missing = expect.filter(r => !got.has(String(r.id))).map(r => r.date)
  const extra = [...got].filter(i => !expect.some(r => String(r.id) === i))
  check('video buttons match node-side expectation', missing.length === 0 && extra.length === 0, `expect ${expect.length} got ${got.size} missing=${JSON.stringify(missing)} extra=${JSON.stringify(extra)}`)
  // two-ride day: make sure a day with 2 rides only tags the one whose time matches
  const twoRideDays = [...new Set(strava.recent_rides.map(r => r.date))].filter(d => strava.recent_rides.filter(r => r.date === d && !r.trainer).length > 1)
  const twoDayInfo = twoRideDays.map(d => ({ d, rides: strava.recent_rides.filter(r => r.date === d && !r.trainer).map(r => r.time + (got.has(String(r.id)) ? '*' : '')), vids: Object.values(vids).filter(v => v.date === d).map(v => v.start.slice(11, 16)) }))
  console.log('two-ride days', JSON.stringify(twoDayInfo))
  check('two-ride days considered', twoRideDays.length > 0)

  // open via the ▶ button → video mode
  const firstId = mapped[0].id
  await ev(`document.querySelector('.act-video-btn[data-act-id="${firstId}"]').scrollIntoView({block:'center'})`)
  await ev(`document.querySelector('.act-video-btn[data-act-id="${firstId}"]').click()`)
  check('modal opens', await waitFor(`document.getElementById('am-overlay')?.classList.contains('open')`, 5000))
  check('opens in video mode', await waitFor(`!!document.querySelector('#am-overlay .am-route.is-video')`, 3000))
  const st = JSON.parse(await ev(`(()=>{const r=document.querySelector('#am-overlay .am-route');const v=r.querySelector('video');const vb=v.getBoundingClientRect();const lb=r.querySelector('.am-route-left').getBoundingClientRect();const right=r.querySelector('.am-route-right');const canvas=r.querySelector('.am-route-canvas');return JSON.stringify({src:v.getAttribute('src'),poster:v.getAttribute('poster'),vw:Math.round(vb.width),vh:Math.round(vb.height),lw:Math.round(lb.width),rightHidden:!right||right.offsetParent===null,canvasHidden:canvas.offsetParent===null,onBtn:r.querySelector('.am-mode-btn.on')?.dataset.mode,paused:v.paused})})()`))
  console.log('video state', JSON.stringify(st))
  check('video src is the release url', /releases\/download\/ride-videos\/i\d+\.mp4$/.test(st.src || ''), st.src)
  check('poster set', /posters\/i\d+\.jpg$/.test(st.poster || ''))
  check('video fills left column 16:9', st.vw === st.lw && Math.abs(st.vw / st.vh - 16 / 9) < 0.03, `${st.vw}x${st.vh} left=${st.lw}`)
  check('right gauge panel + canvas hidden in video mode', st.rightHidden && st.canvasHidden)
  check('toggle shows video as on', st.onBtn === 'video')
  // real network: wait for metadata from GitHub (release URL 302 → signed blob)
  const meta = await waitFor(`(()=>{const v=document.querySelector('#am-overlay video');return v && v.readyState>=1 && v.duration>80})()`, 25000)
  const vinfo = JSON.parse(await ev(`(()=>{const v=document.querySelector('#am-overlay video');return JSON.stringify({rs:v.readyState,dur:v.duration,err:v.error&&v.error.code,paused:v.paused,ct:v.currentTime,retried:v.dataset.retried||null})})()`))
  console.log('video load', JSON.stringify(vinfo))
  check('video metadata loaded from GitHub (duration ~91s, no error)', meta && !vinfo.err, JSON.stringify(vinfo))
  await sleep(2500)
  const playing = JSON.parse(await ev(`(()=>{const v=document.querySelector('#am-overlay video');return JSON.stringify({paused:v.paused,ct:v.currentTime})})()`))
  check('video actually plays (currentTime advances)', !playing.paused && playing.ct > 0.5, JSON.stringify(playing))
  await shot('modal-video-desktop.png')

  // switch to anim
  await ev(`document.querySelector('#am-overlay .am-mode-btn[data-mode="anim"]').click()`)
  await sleep(1200)
  const an = JSON.parse(await ev(`(()=>{const r=document.querySelector('#am-overlay .am-route');const v=r.querySelector('video');return JSON.stringify({isVideo:r.classList.contains('is-video'),paused:v.paused,popped:r.querySelectorAll('.am-star-popped').length,svgVisible:!!r.querySelector('.am-route-svg')&&r.querySelector('.am-route-canvas').offsetParent!==null,rightVisible:r.querySelector('.am-route-right').offsetParent!==null,onBtn:r.querySelector('.am-mode-btn.on')?.dataset.mode})})()`))
  console.log('anim state', JSON.stringify(an))
  check('switch back to anim: video paused, constellation animating, gauge back', !an.isVideo && an.paused && an.popped > 2 && an.svgVisible && an.rightVisible && an.onBtn === 'anim', JSON.stringify(an))
  await shot('modal-anim-desktop.png')

  // switch to video again then close with Escape → src removed
  await ev(`document.querySelector('#am-overlay .am-mode-btn[data-mode="video"]').click()`)
  await sleep(500)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(300)
  const closed = JSON.parse(await ev(`(()=>{const o=document.getElementById('am-overlay');const v=o.querySelector('video');return JSON.stringify({open:o.classList.contains('open'),src:v&&v.getAttribute('src'),paused:v&&v.paused})})()`))
  check('close: modal closed, video unloaded and paused', !closed.open && !closed.src && closed.paused, JSON.stringify(closed))

  // sticky mode: open 詳情 of another ride WITH video → should open in video mode
  const secondId = mapped[Math.min(1, mapped.length - 1)].id
  await ev(`document.querySelector('.act-detail-btn[data-act-id="${secondId}"]').scrollIntoView({block:'center'})`)
  await ev(`document.querySelector('.act-detail-btn[data-act-id="${secondId}"]').click()`)
  await waitFor(`document.getElementById('am-overlay')?.classList.contains('open')`, 5000)
  check('mode is sticky within the session (詳情 opens in video mode after choosing video)', await waitFor(`!!document.querySelector('#am-overlay .am-route.is-video') && !!document.querySelector('#am-overlay video').getAttribute('src')`, 3000))
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(300)

  // a ride with 詳情 but no video → no toggle, no video, constellation runs
  const noVid = await ev(`(()=>{const b=[...document.querySelectorAll('.act-detail-btn')].find(b=>!b.parentNode.querySelector('.act-video-btn[data-act-id="'+b.dataset.actId+'"]'));return b?b.dataset.actId:null})()`)
  check('found a ride without video', !!noVid, noVid)
  if (noVid) {
    await ev(`document.querySelector('.act-detail-btn[data-act-id="${noVid}"]').scrollIntoView({block:'center'});document.querySelector('.act-detail-btn[data-act-id="${noVid}"]').click()`)
    await waitFor(`document.getElementById('am-overlay')?.classList.contains('open')`, 5000)
    await sleep(800)
    const nv = JSON.parse(await ev(`(()=>{const o=document.getElementById('am-overlay');const r=o.querySelector('.am-route');return JSON.stringify({hasRoute:!!r,isVideo:r&&r.classList.contains('is-video'),toggle:!!o.querySelector('.am-mode'),video:!!o.querySelector('video'),popped:o.querySelectorAll('.am-star-popped').length})})()`))
    console.log('no-video ride', JSON.stringify(nv))
    check('ride without video: no toggle/video, animation runs (or no route at all)', !nv.toggle && !nv.video && !nv.isVideo && (!nv.hasRoute || nv.popped > 0), JSON.stringify(nv))
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  }

  // mobile
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await sleep(400)
  await ev(`document.querySelector('.act-video-btn[data-act-id="${firstId}"]').scrollIntoView({block:'center'});document.querySelector('.act-video-btn[data-act-id="${firstId}"]').click()`)
  await waitFor(`!!document.querySelector('#am-overlay .am-route.is-video')`, 5000)
  await sleep(600)
  const mb = JSON.parse(await ev(`(()=>{const v=document.querySelector('#am-overlay video');const b=v.getBoundingClientRect();const p=document.querySelector('#am-overlay .am-panel').getBoundingClientRect();return JSON.stringify({vw:Math.round(b.width),vh:Math.round(b.height),pw:Math.round(p.width),overflow:document.documentElement.scrollWidth>innerWidth})})()`))
  console.log('mobile', JSON.stringify(mb))
  check('mobile: video fits panel, no horizontal overflow', mb.vw <= mb.pw && !mb.overflow && mb.vw > 250, JSON.stringify(mb))
  await shot('modal-video-mobile.png')
  await ev(`document.querySelector('#am-overlay .activity-card, #am-overlay'); document.querySelectorAll('.act-video-btn').length`)
  await shot('log-row-mobile.png')

  check('no console errors / exceptions', consoleErrs.length === 0, consoleErrs.slice(0, 3).join(' | '))
} catch (e) {
  console.log('ERROR', e.message)
  results.push({ name: 'script error', ok: false, info: e.message })
}
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(results, null, 1))
console.log(`\n${results.filter(r => r.ok).length}/${results.length} passed`)
cleanup()
process.exit(results.every(r => r.ok) ? 0 : 1)
