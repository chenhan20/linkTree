// 3D 回放快檢：軟體 WebGL（swiftshader）開模態，三種鏡頭各截一張，播放、鍵盤、關閉
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
const CH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', PORT = 9390, MOBILE = process.env.MOBILE === '1'
const W = MOBILE ? 390 : 1440, H = MOBILE ? 844 : 900
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', '--hide-scrollbars', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${PORT}`, `--user-data-dir=/tmp/cinema-r3d-${Date.now()}`, `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' })
const sleep = ms => new Promise(r => setTimeout(r, ms))
let wsUrl = null
for (let i = 0; i < 40 && !wsUrl; i++) { await sleep(250); try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); const pg = j.find(t => t.type === 'page'); if (pg) wsUrl = pg.webSocketDebuggerUrl } catch (e) {} }
const ws = new WebSocket(wsUrl); await new Promise(r => ws.addEventListener('open', r))
let id = 0; const pending = new Map(); const errors = []
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') errors.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 220))
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('ERR ' + m.params.args.map(a => a.value || a.description).join(' ').slice(0, 220)) })
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: MOBILE ? 2 : 1, mobile: MOBILE })
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result?.result ? r.result.result.value : (r.result?.exceptionDetails ? 'EXC ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300) : null) }
const shot = async name => { const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`r3d_${name}${MOBILE ? '_m' : ''}.png`, Buffer.from(s.result.data, 'base64')) }
await send('Page.navigate', { url: `http://localhost:8934/strava_cinema.html?r3d=${Date.now()}#log` })
for (let i = 0; i < 80; i++) { await sleep(150); if (await ev(`!!document.querySelector('#content .view.is-on') && !!(window.__rideFeed||[]).length`)) break }
await sleep(1500)
console.log('webgl', await ev(`(()=>{const c=document.createElement('canvas');return !!(c.getContext('webgl2')||c.getContext('webgl'))})()`))
const act = await ev(`(window.__rideFeed||[]).filter(a=>a.route_stream&&a.route_stream.length>50).sort((a,b)=>(b.elevation_m||0)-(a.elevation_m||0))[0]?.id`)
const flat = await ev(`(window.__rideFeed||[]).filter(a=>a.route_stream&&a.route_stream.length>50&&a.id!==${JSON.stringify(await ev(`(window.__rideFeed||[]).filter(a=>a.route_stream&&a.route_stream.length>50).sort((a,b)=>(b.elevation_m||0)-(a.elevation_m||0))[0]?.id`))}).sort((a,b)=>(a.elevation_m||0)-(b.elevation_m||0))[0]?.id`)
console.log('flat', flat)
console.log('activity', act)
await ev(`openRoute3D(${JSON.stringify(act)})`)
for (let i = 0; i < 60; i++) { await sleep(250); if (await ev(`!!(typeof R3D !== "undefined" && R3D && R3D.tube)`)) break }
console.log('r3d', await ev(`JSON.stringify({ok:!!R3D, cam:R3D_CAM, rows:R3D&&R3D.tubRows, fog:!!(R3D&&R3D.scene.fog), tag:document.querySelector('#r3dCamTag span').textContent, strips:document.getElementById('rpStripCv').width, dim:document.getElementById('rpBox').dataset.dim, gain:Math.round(R3D.model.gain), tiles:[...document.querySelectorAll('.rp-tile b span')].map(e=>e.textContent).join('/')})`))
await sleep(800); await shot('orbit')
await ev(`rpSetU(.35); r3dSetCam('chase')`); await sleep(1400)
console.log('chase', await ev(`JSON.stringify({cam:R3D_CAM, tween:!!R3D.tween, d:+R3D.camera.position.distanceTo(R3D.marker.position).toFixed(1), tag:document.querySelector('#r3dCamTag span').textContent, active:document.querySelector('.rp-cams button.active').dataset.cam})`))
await shot('chase')
await ev(`r3dTogglePlay()`); await sleep(1200)
console.log('playing', await ev(`JSON.stringify({playing:RP.playing, u:+RP.u.toFixed(3), d:+R3D.camera.position.distanceTo(R3D.marker.position).toFixed(1)})`))
await ev(`r3dSetCam('top')`); await sleep(1400)
console.log('top', await ev(`JSON.stringify({cam:R3D_CAM, maxPolar:+R3D.controls.maxPolarAngle.toFixed(3), above:+(R3D.camera.position.y - R3D.marker.position.y).toFixed(1), playing:RP.playing})`))
await shot('top')
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', text: ' ' }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space' }); await sleep(100)
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: '1', code: 'Digit1', text: '1' }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: '1', code: 'Digit1' }); await sleep(1200)
console.log('keys', await ev(`JSON.stringify({playing:RP.playing, cam:R3D_CAM})`))
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(500)
console.log('closed', await ev(`JSON.stringify({open:document.getElementById('r3d-overlay').classList.contains('open'), r3d:!!(typeof R3D !== "undefined" && R3D), rp:!!window.RP})`))
// 再開一次：模式記住、資源沒殘留
await ev(`openRoute3D(${JSON.stringify(act)})`); for (let i = 0; i < 40; i++) { await sleep(250); if (await ev(`!!(typeof R3D !== "undefined" && R3D && R3D.tube)`)) break }
console.log('reopen', await ev(`JSON.stringify({cam:R3D_CAM, tags:document.querySelectorAll('.r3d-tag').length})`))
await ev(`closeRoute3D(); openRoute3D(${JSON.stringify(flat)})`); await sleep(900)
console.log('flat2d', await ev(`JSON.stringify({dim:RP.dim, gain:Math.round(RP.model.gain), range:Math.round(RP.model.elevRange), r3d:!!(typeof R3D !== "undefined" && R3D), cv:document.getElementById('rp2d').width})`)); await shot('flat2d')
await ev(`r3dTogglePlay()`); await sleep(1500); console.log('flat play', await ev(`JSON.stringify({u:+RP.u.toFixed(3), dist:document.getElementById('r3dDist').textContent, w:document.getElementById('r3dWatts').textContent})`))
await ev(`rpToggleDim()`); for (let i = 0; i < 40; i++) { await sleep(250); if (await ev(`!!(typeof R3D !== "undefined" && R3D && R3D.tube)`)) break }
console.log('flat->3d', await ev(`JSON.stringify({dim:RP.dim, r3d:!!(typeof R3D !== "undefined" && R3D), err:document.querySelector('.r3d-error')?.textContent, loading:document.getElementById('r3dLoading').style.display, three:!!window.THREE, wrapW:document.getElementById('r3dCanvasWrap').clientWidth})`)); await shot('flat3d')
console.log('errors', errors.length ? errors : 'none')
ws.close(); chrome.kill(); process.exit(0)
