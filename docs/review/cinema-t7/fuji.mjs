// 富士鏡頭模式首輪檢查：console 例外、開場時間軸、push-in、FX 面板、底片不進 UI
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
const CH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9341, OUT = process.argv[2], MOBILE = process.env.MOBILE === '1'
const W = MOBILE ? 390 : +(process.env.W || 1440), H = MOBILE ? 844 : +(process.env.H || 900)
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${PORT}`, `--user-data-dir=/tmp/cinema-fuji-${Date.now()}`, `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' })
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
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result?.result ? r.result.result.value : (r.result?.exceptionDetails ? 'EXC ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300) : null) }
const shot = async name => { const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/${name}${MOBILE ? '_m' : ''}.png`, Buffer.from(s.result.data, 'base64')) }
const t0 = Date.now()
await send('Page.navigate', { url: `http://localhost:8934/strava_cinema.html?fuji=${Date.now()}#today` })
let ready = false
for (let i = 0; i < 80; i++) { await sleep(100); ready = await ev(`!!document.querySelector('#content .view.is-on') && document.body.dataset.view==='overview'`); if (ready) break }
const state = () => ev(`JSON.stringify({t:Math.round(performance.now()), cls:document.body.className, film:document.body.dataset.film, ap:document.body.dataset.aperture, fx:document.body.dataset.fx, push:window.__cinemaLens&&+window.__cinemaLens.push().toFixed(4), pushDone:window.__cinemaLens&&window.__cinemaLens.pushDone(), sceneT:getComputedStyle(document.querySelector('.td-scene')||document.body).transform, sceneF:(document.querySelector('.td-scene')||{style:{}}).style.filter, u:window.__cinemaHero&&+window.__cinemaHero.u().toFixed(3), A:window.__cinemaHero&&window.__cinemaHero.aperture(), af:(document.querySelector('.td-af')||{className:'-'}).className, hud:getComputedStyle(document.querySelector('.td-hud')||document.body).opacity, video:!!document.querySelector('.td-video')&&!document.querySelector('.td-video').paused})`)
console.log('ready', ready, 'after', Date.now() - t0, 'ms')
for (const w of [0, 400, 700, 600, 600, 1500, 2000, 2500]) { await sleep(w); console.log(await state()) }
await shot('today_settled')
// 切 view 再回來：不重播、push 不縮回
await ev(`document.querySelector('.hub-i[data-hub="train"]').click()`); await sleep(900)
console.log('train', await state())
await ev(`document.querySelector('.hub-i[data-hub="today"]').click()`); await sleep(1200)
console.log('back', await state())
// FX 面板
await ev(`document.getElementById('fx-tier').click()`); await sleep(400)
console.log('panel', await ev(`JSON.stringify({open:window.__cinemaLook.isOpen(), w:document.getElementById('fx-panel').getBoundingClientRect().width, h:document.getElementById('fx-panel').getBoundingClientRect().height, btns:[...document.querySelectorAll('.fx-opt')].map(b=>b.dataset.val+':'+Math.round(b.getBoundingClientRect().height)).join(' '), on:[...document.querySelectorAll('.fx-opt.is-on')].map(b=>b.dataset.val).join(',')})`))
await shot('panel_open')
await ev(`window.__cinemaLook.setFilm('acros')`); await sleep(120); console.log('iris-mid', await state()); await sleep(400)
console.log('acros', await ev(`JSON.stringify({film:document.body.dataset.film, cinemaF:getComputedStyle(document.getElementById('cinema')).filter, videoF:getComputedStyle(document.querySelector('.td-video')).filter, panelF:getComputedStyle(document.querySelector('.td-panel')).filter, topbarF:getComputedStyle(document.querySelector('.topbar')).filter, verdictColor:getComputedStyle(document.querySelector('.td-verdict b')).color, ls:localStorage.getItem('cinema-film')})`))
await shot('acros')
await ev(`window.__cinemaLook.setLens('2')`); await sleep(500)
console.log('f2', await ev(`JSON.stringify({ap:document.body.dataset.aperture, A:window.__cinemaHero.aperture(), fxA:window.__cinemaFx.aperture(), hudF:document.querySelector('.td-hud-f b').textContent, ls:localStorage.getItem('cinema-lens')})`))
await shot('f2_acros')
await ev(`window.__cinemaLook.setFilm('cn'); window.__cinemaLook.setLens('auto')`); await sleep(500)
await shot('cn_auto')
await ev(`window.__cinemaLook.setFilm('auto')`); await sleep(400)
// Esc 收面板
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(300)
console.log('esc', await ev(`JSON.stringify({open:window.__cinemaLook.isOpen(), hidden:document.getElementById('fx-panel').hidden, focus:document.activeElement.id})`))
// ALL → 自動 F8 / CN
await ev(`document.querySelector('.hub-i[data-hub="all"]').click()`); await sleep(900)
console.log('all', await state()); await shot('all')
await ev(`document.querySelector('.hub-i[data-hub="ride"]').click()`); await sleep(900)
console.log('ride', await state()); await shot('ride')
console.log('errors', errors.length ? errors : 'none')
ws.close(); chrome.kill(); process.exit(0)
