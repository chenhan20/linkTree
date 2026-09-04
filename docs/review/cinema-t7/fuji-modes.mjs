// MODE=reduced | quiet | deep | iris ；PORT 各自不同
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
const CH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const MODE = process.env.MODE || 'deep', PORT = +(process.env.PORT || 9350), OUT = process.argv[2], MOBILE = process.env.MOBILE === '1'
const W = MOBILE ? 390 : 1440, H = MOBILE ? 844 : 900
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${PORT}`, `--user-data-dir=/tmp/cinema-fuji-${MODE}-${Date.now()}`, `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' })
const sleep = ms => new Promise(r => setTimeout(r, ms))
let wsUrl = null
for (let i = 0; i < 40 && !wsUrl; i++) { await sleep(250); try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); const pg = j.find(t => t.type === 'page'); if (pg) wsUrl = pg.webSocketDebuggerUrl } catch (e) {} }
const ws = new WebSocket(wsUrl); await new Promise(r => ws.addEventListener('open', r))
let id = 0; const pending = new Map(); const errors = []
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') errors.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 200))
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('ERR ' + m.params.args.map(a => a.value || a.description).join(' ').slice(0, 200)) })
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: MOBILE ? 2 : 1, mobile: MOBILE })
if (MODE === 'reduced') await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result?.result ? r.result.result.value : (r.result?.exceptionDetails ? 'EXC ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300) : null) }
const shot = async name => { const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/${name}${MOBILE ? '_m' : ''}.png`, Buffer.from(s.result.data, 'base64')) }
const state = () => ev(`JSON.stringify({t:Math.round(performance.now()), view:document.body.dataset.view, cls:document.body.className, film:document.body.dataset.film, ap:document.body.dataset.aperture, fx:document.body.dataset.fx, push:window.__cinemaLens&&+window.__cinemaLens.push().toFixed(4), sceneT:getComputedStyle(document.querySelector('.td-scene')||document.body).transform, sceneF:(document.querySelector('.td-scene')||{style:{}}).style.filter, canvasF:document.getElementById('cn-canvas').style.filter, u:window.__cinemaHero&&+window.__cinemaHero.u().toFixed(3), hud:getComputedStyle(document.querySelector('.td-hud')||document.body).opacity, dofLayers:document.querySelectorAll('.td-dof-l').length, sw:document.documentElement.scrollWidth, hash:location.hash})`)
const nav = async (hash, wait) => { await send('Page.navigate', { url: `http://localhost:8934/strava_cinema.html?x=${Date.now()}${hash}` }); for (let i = 0; i < 80; i++) { await sleep(100); if (await ev(`!!document.querySelector('#content .view.is-on')`)) break }; await sleep(wait || 800) }
if (MODE === 'quiet') { await send('Page.navigate', { url: 'http://localhost:8934/strava_cinema.html?pre=1' }); await sleep(600); await ev(`localStorage.setItem('cinema-fx-tier','quiet')`) }
if (MODE === 'reduced' || MODE === 'quiet') {
  const t0 = Date.now(); await nav('#today', 200)
  for (const w of [0, 500, 1500]) { await sleep(w); console.log(MODE, await state()) }
  await shot(MODE + '_today')
  await ev(`document.getElementById('fx-tier').click()`); await sleep(400)
  console.log(MODE, 'panel', await ev(`JSON.stringify({open:window.__cinemaLook.isOpen(), tierDisabled:[...document.querySelectorAll('.fx-opt[data-group=tier]')].map(b=>b.disabled).join(','), on:[...document.querySelectorAll('.fx-opt.is-on')].map(b=>b.dataset.val).join(',')})`))
  await shot(MODE + '_panel')
  await ev(`window.__cinemaLook.setFilm('cc')`); await sleep(400); console.log(MODE, 'cc', await state())
  await ev(`document.querySelector('.hub-i[data-hub="review"]')?.click() || document.querySelector('.tab-i[data-hub="review"]').click()`); await sleep(700); console.log(MODE, 'review', await state())
}
if (MODE === 'iris') {
  await nav('#today', 9000)
  await ev(`window.__cinemaLook.setFilm('std')`)
  const out = []
  for (let i = 0; i < 9; i++) { out.push(await ev(`Math.round(performance.now())+' '+document.body.dataset.film+' '+((document.querySelector('.td-scene').style.filter.match(/brightness\\(([\\d.]+)/)||[])[1]||'-')`)); await sleep(35) }
  console.log('iris samples', out.join(' | '))
  console.log('after', await state())
}
if (MODE === 'deep') {
  await nav('#itt/segment/641218', 2500); console.log('itt deep', await ev(`JSON.stringify({view:document.body.dataset.view, hash:location.hash, tsv:document.querySelector('#tsv-stack > .tsv:not([hidden])')?.dataset.tsv, three:!!window.__tsv, film:document.body.dataset.film, ap:document.body.dataset.aperture})`)); await shot('deep_itt')
  await nav('#log/activity/2026-09-03', 1500); console.log('log deep', await ev(`JSON.stringify({view:document.body.dataset.view, hash:location.hash, open:!!document.querySelector('.fs-day.is-open'), film:document.body.dataset.film})`))
  await nav('#trends', 1500); console.log('trends', await state()); await shot('deep_trends')
  await nav('#atlas', 3000); console.log('atlas', await ev(`JSON.stringify({view:document.body.dataset.view, svg:!!document.querySelector('.view[data-view="atlas"] svg, .view[data-view="atlas"] canvas'), film:document.body.dataset.film, ap:document.body.dataset.aperture})`)); await shot('deep_atlas')
  await nav('#harvest', 1500); await shot('deep_harvest')
  await nav('#body', 1500); await shot('deep_body')
  // 舊 hash + back/forward
  await nav('#overview', 800); console.log('overview alias', await ev(`document.body.dataset.view+' '+location.hash`))
  await ev(`document.querySelector('.hub-i[data-hub="train"]').click()`); await sleep(700)
  await ev(`history.back()`); await sleep(900); console.log('back', await ev(`document.body.dataset.view+' '+location.hash`))
  await ev(`history.forward()`); await sleep(900); console.log('fwd', await ev(`document.body.dataset.view+' '+location.hash`))
  // drawer / modal 還在
  await nav('#today', 1200)
  await ev(`document.querySelector('.td-card.is-next')?.click()`); await sleep(600); console.log('drawer', await ev(`JSON.stringify({drawer:!!document.querySelector('.drawer.is-on, #drawer.is-on, .dw.is-on, [class*=drawer][class*=on]'), cls:document.body.className})`))
  await shot('deep_drawer')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(400)
  console.log('after esc', await ev(`JSON.stringify({drawer:!!document.querySelector('[class*=drawer][class*=on]'), cls:document.body.className})`))
}
console.log(MODE, 'errors', errors.length ? errors : 'none')
ws.close(); chrome.kill(); process.exit(0)
