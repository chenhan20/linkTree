// Hero 鏡頭（景深層、對焦框、點對焦、兩秒自動對焦）的快速檢查（CDP headless）。
//   node hero.mjs <outdir>            1440×1000
//   MOBILE=1 node hero.mjs <outdir>   390×844
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
const CH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const OUT = process.argv[2] || '.', MOBILE = process.env.MOBILE === '1'
const W = MOBILE ? 390 : 1440, H = MOBILE ? 844 : 1000, PORT = 9360 + (MOBILE ? 1 : 0), TAG = MOBILE ? '_m' : ''
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=/tmp/cinema-hero-${Date.now()}`, `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' })
const sleep = ms => new Promise(r => setTimeout(r, ms))
let wsUrl = null
for (let i = 0; i < 40 && !wsUrl; i++) { await sleep(250); try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); const pg = j.find(t => t.type === 'page'); if (pg) wsUrl = pg.webSocketDebuggerUrl } catch (e) {} }
if (!wsUrl) { console.log('no target'); chrome.kill(); process.exit(1) }
const ws = new WebSocket(wsUrl); await new Promise(r => ws.addEventListener('open', r))
let id = 0; const pending = new Map(); const errors = []
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
  if (m.method === 'Runtime.exceptionThrown') errors.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').slice(0, 300))
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('ERR ' + m.params.args.map(a => a.value || a.description || '').join(' ').slice(0, 300))
})
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
await send('Page.enable'); await send('Runtime.enable'); await send('Animation.enable')
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: MOBILE ? 2 : 1, mobile: MOBILE })
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('cinema-fx-tier','quiet')}catch(e){}` })
const evalJs = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : (r.result && r.result.exceptionDetails ? 'EXC ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300) : null) }
const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/${name}${TAG}.png`, Buffer.from(r.result.data, 'base64')) }
const click = async (x, y) => { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await sleep(40); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }) }
const SAMPLE = `(()=>{const q=s=>document.querySelector(s),cs=(s,p)=>q(s)?getComputedStyle(q(s))[p]:null,blur=f=>{const m=/blur\\(([\\d.]+)px\\)/.exec(f||'');return m?+m[1]:0}
 const H=window.__cinemaHero,af=q('.td-af'),d=q('.td-dof'),ls=[...document.querySelectorAll('.td-dof-l')]
 return JSON.stringify({view:document.body.dataset.view||null,lens:document.body.dataset.lens||null,u:H?+H.u().toFixed(4):null,ready:H?H.ready():null,
  cvBlur:blur(cs('#cn-canvas','filter')),scBlur:blur(cs('.td-scene','filter')),scFilter:cs('.td-scene','filter'),
  layers:ls.length,masked:ls.filter(l=>l.style.maskImage||l.style.webkitMaskImage).length,dof:d?{l:Math.round(d.offsetLeft),t:Math.round(d.offsetTop),w:Math.round(d.offsetWidth),h:Math.round(d.offsetHeight)}:null,
  af:af?{cls:af.className,l:af.style.left,t:af.style.top}:null,vPaused:q('.td-video')?q('.td-video').paused:null})})()`
const sample = async () => { const v = await evalJs(SAMPLE); try { return JSON.parse(v) } catch (e) { return null } }
const report = {}
const note = (k, v) => { report[k] = v; console.log(k, typeof v === 'string' ? v : JSON.stringify(v)) }

// ── 1 首次進站：焦距程式 2 → ∞ → 車手；框 白→綠→淡出 ──
await send('Page.navigate', { url: `http://localhost:8934/strava_cinema.html?hero=${Date.now()}#today` })
const tl = []; let seen = false
for (let i = 0; i < 300; i++) {
  const s = await sample(); if (!s) { await sleep(25); continue }
  if (s.lens === '1') seen = true
  if (seen) { s.t = Date.now(); tl.push(s) }
  if (seen && !s.lens && !(s.af && s.af.cls.includes('is-on'))) break
  await sleep(25)
}
const t0 = tl.length ? tl[0].t : 0
note('intro samples', tl.length)
note('intro first', tl[0] && { u: tl[0].u, ready: tl[0].ready, layers: tl[0].layers, masked: tl[0].masked, dof: tl[0].dof, scBlur: tl[0].scBlur, cvBlur: tl[0].cvBlur })
note('intro u path', tl.filter((s, i) => i % 6 === 0).map(s => `${s.t - t0}:${s.u}`).join(' '))
note('intro af path', [...new Set(tl.map(s => s.af && s.af.cls))])
note('intro scene blur range', { min: Math.min(...tl.map(s => s.scBlur)), max: Math.max(...tl.map(s => s.scBlur)) })
note('intro end', await sample())
await sleep(1500)
await shot('h_today')

// ── 2 點對焦：天空 → u≈0；右緣芒草 → u≈.45；面板上點不變 ──
const heroBox = JSON.parse(await evalJs(`JSON.stringify(document.querySelector('.td-dof').getBoundingClientRect())`))
const at = (fx, fy) => [heroBox.x + heroBox.width * fx, heroBox.y + heroBox.height * fy]
const why = JSON.parse(await evalJs(`(()=>{const r=document.querySelector('.td-why').getBoundingClientRect();return JSON.stringify([r.left+20,r.top+r.height/2])})()`))
let [x, y] = MOBILE ? at(.40, .15) : at(.25, .15); await click(x, y)
const tap1 = []; for (let i = 0; i < 40; i++) { const s = await sample(); if (s) { s.t = i; tap1.push(s) } await sleep(40) }
note('tap sky u path', tap1.filter((s, i) => i % 4 === 0).map(s => s.u).join(' '))
note('tap sky af', [...new Set(tap1.map(s => s.af && s.af.cls))].join(' | '))
note('tap sky end', (s => ({ u: s.u, af: s.af }))(await sample()))
await shot('h_tap_sky')
;[x, y] = MOBILE ? at(.31, .85) : at(.965, .6); await click(x, y); await sleep(900)
note('tap near end', (s => ({ u: s.u, af: s.af }))(await sample()))
const before = (await sample()).u
await click(why[0], why[1]); await sleep(600)
note('tap panel text unchanged', { before, after: (await sample()).u, scrollY: await evalJs('scrollY') })
;[x, y] = at(.63, .55); await click(x, y); await sleep(900)
note('tap rider end', (s => ({ u: s.u, af: s.af }))(await sample()))

// ── 3 TRAIN 再回 TODAY：arrive 短暫尋焦、框不出現、影片照播 ──
const hub = async h => JSON.parse(await evalJs(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(MOBILE ? `.tab-i[data-hub="${h}"]` : `.hub-i[data-hub="${h}"]`)})].find(e=>e.offsetParent);const r=el.getBoundingClientRect();return JSON.stringify([r.left+r.width/2,r.top+r.height/2])})()`))
;[x, y] = await hub('train'); await click(x, y); await sleep(1200)
;[x, y] = await hub('today'); await click(x, y)
const arr = []; for (let i = 0; i < 30; i++) { const s = await sample(); if (s) arr.push(s); await sleep(40) }
note('arrive u path', arr.filter((s, i) => i % 3 === 0).map(s => `${s.view}:${s.u}`).join(' '))
note('arrive af seen', [...new Set(arr.map(s => s.af && s.af.cls))].join(' | '))
note('arrive end', (s => ({ u: s.u, lens: s.lens, scFilter: s.scFilter, vPaused: s.vPaused }))(await sample()))

// ── 3b 距離尺與峰值：hover 淡入、拖白線手動拉焦、峰值有像素、放開停住、輕點回 AF ──
await sleep(1200)
const mfBox = JSON.parse(await evalJs(`(()=>{const r=document.querySelector('.td-mf').getBoundingClientRect();return JSON.stringify({x:r.left,y:r.top,w:r.width,h:r.height})})()`))
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mfBox.x + mfBox.w * .5, y: mfBox.y - 60 }); await sleep(400)
note('scale after hover', await evalJs(`JSON.stringify({on:document.querySelector('.td-mf').classList.contains('is-on'),op:getComputedStyle(document.querySelector('.td-mf')).opacity,box:${JSON.stringify(mfBox)},ind:document.querySelector('.td-mf-ind').style.left,band:document.querySelector('.td-mf-band').style.width})`))
const yMid = mfBox.y + mfBox.h * .7
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mfBox.x + mfBox.w * .995, y: yMid })
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: mfBox.x + mfBox.w * .995, y: yMid, button: 'left', clickCount: 1 }); await sleep(80)
const peakPx = `(()=>{const c=document.querySelector('.td-peak');if(!c)return null;const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i]>0)n++;return n})()`
for (const f of [.95, .9, .86, .833]) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mfBox.x + mfBox.w * f, y: yMid, button: 'left' }); await sleep(120) }
await sleep(350)
note('drag at rider', await evalJs(`JSON.stringify({u:+window.__cinemaHero.u().toFixed(3),mode:window.__cinemaHero.mode(),peaking:window.__cinemaHero.peaking(),peakOn:!!document.querySelector('.td-peak.is-on'),af:document.querySelector('.td-af').className,peakPx:${peakPx},vReady:document.querySelector('.td-video').readyState})`))
await shot('h_manual_rider')
for (const f of [.75, .65, .55]) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mfBox.x + mfBox.w * f, y: yMid, button: 'left' }); await sleep(120) }
await sleep(350)
note('drag at grass', await evalJs(`JSON.stringify({u:+window.__cinemaHero.u().toFixed(3),peakPx:${peakPx}})`))
await shot('h_manual_grass')
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: mfBox.x + mfBox.w * .55, y: yMid, button: 'left', clickCount: 1 }); await sleep(1000)
note('drag released', await evalJs(`JSON.stringify({u:+window.__cinemaHero.u().toFixed(3),mode:window.__cinemaHero.mode(),peaking:window.__cinemaHero.peaking(),scaleOn:document.querySelector('.td-mf').classList.contains('is-on')})`))
;[x, y] = at(.63, .55); await click(x, y); await sleep(900)
note('tap after manual', await evalJs(`JSON.stringify({u:+window.__cinemaHero.u().toFixed(3),mode:window.__cinemaHero.mode(),af:document.querySelector('.td-af').className})`))
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: H - 5 }); await sleep(3200)
note('scale idle hidden', await evalJs(`JSON.stringify({on:document.querySelector('.td-mf').classList.contains('is-on'),peakOn:!!document.querySelector('.td-peak.is-on')})`))

// ── 4 放慢 8 倍截中途幀 ──
const slow = await send('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{const P=performance.now.bind(performance);const base=P();const S=1/8;performance.now=()=>base+(P()-base)*S;const R=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>R(()=>cb(performance.now()));const ST=window.setTimeout.bind(window);window.setTimeout=(fn,ms,...a)=>ST(fn,(ms||0)/S,...a)})()` })
await send('Animation.setPlaybackRate', { playbackRate: 0.125 })
await send('Page.navigate', { url: `http://localhost:8934/strava_cinema.html?heroslow=${Date.now()}#today` })
let started = false
for (let i = 0; i < 400 && !started; i++) { await sleep(30); const s = await sample(); if (s && s.lens === '1') started = true }
const ts = Date.now()
await sleep(900); await shot('h_intro_1defocus'); note('slow1', (s => ({ u: s.u, af: s.af && s.af.cls, cvBlur: s.cvBlur }))(await sample()))
await sleep(5600); await shot('h_intro_2far'); note('slow2', (s => ({ u: s.u, af: s.af && s.af.cls, cvBlur: s.cvBlur }))(await sample()))
await sleep(2600); await shot('h_intro_3rider'); note('slow3', (s => ({ u: s.u, af: s.af && s.af.cls, cvBlur: s.cvBlur }))(await sample()))
await sleep(3400); await shot('h_intro_4lock'); note('slow4', (s => ({ u: s.u, af: s.af && s.af.cls, cvBlur: s.cvBlur }))(await sample()))
note('slow real ms', Date.now() - ts)
await sleep(9000)
;[x, y] = MOBILE ? at(.40, .15) : at(.25, .15); await click(x, y); await sleep(1600); await shot('h_tap_mid'); note('slow tap mid', (s => ({ u: s.u, af: s.af && s.af.cls }))(await sample()))
await sleep(3500); await shot('h_tap_lock'); note('slow tap lock', (s => ({ u: s.u, af: s.af && s.af.cls }))(await sample()))
await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: slow.result.identifier }); await send('Animation.setPlaybackRate', { playbackRate: 1 })
note('console errors', errors)
writeFileSync(`${OUT}/hero-report${TAG}.json`, JSON.stringify(report, null, 2))
ws.close(); chrome.kill(); process.exit(0)
