// 鏡頭轉場（defocus → focus pull → lock）的快速檢查（CDP，headless Chrome，不開任何視窗）。
//   node lens.mjs <outdir>            桌機 1440×1000
//   MOBILE=1 node lens.mjs <outdir>   390×844
// 先起 python3 -m http.server 8934 --bind 127.0.0.1
// 五個人工觀察項都有對應探針：首次進站失焦→鎖定、TODAY→TRAIN 只有輕微重新對焦、計畫→攻略只有 dissolve、
// REVIEW→TODAY 沒有全屏遮蔽、390 的底列在對焦期間不受影響。最後用放慢 8 倍的時鐘截轉場中途幀。
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
const CH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const OUT = process.argv[2] || '.', MOBILE = process.env.MOBILE === '1'
const W = MOBILE ? 390 : 1440, H = MOBILE ? 844 : 1000, PORT = 9350 + (MOBILE ? 1 : 0), TAG = MOBILE ? '_m' : ''
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=/tmp/cinema-lens-${Date.now()}`, `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' })
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
const centerOf = async sel => JSON.parse(await evalJs(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(sel)})].find(e=>e.offsetParent);if(!el)return 'null';const r=el.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2})})()`))
const click = async ({ x, y }) => { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }) }
// 一筆取樣：鏡頭在哪、內容淡到哪、影片有沒有在播
const SAMPLE = `(()=>{const q=s=>document.querySelector(s),cs=(s,p)=>q(s)?getComputedStyle(q(s))[p]:null,blur=f=>{const m=/blur\\(([\\d.]+)px\\)/.exec(f||'');return m?+m[1]:0}
 const v=q('.td-video');return JSON.stringify({view:document.body.dataset.view||null,lens:document.body.dataset.lens||null,cls:document.body.className,
 cvBlur:blur(cs('#cn-canvas','filter')),cvT:cs('#cn-canvas','transform'),scBlur:blur(cs('.td-scene','filter')),scInline:q('.td-scene')?q('.td-scene').style.filter:null,cvInline:q('#cn-canvas')?q('#cn-canvas').style.filter:null,
 mainOp:+cs('.app>.main','opacity'),contentOp:+cs('#content','opacity'),tabOp:q('.tabbar')?+cs('.tabbar','opacity'):null,tabFilter:q('.tabbar')?cs('.tabbar','filter'):null,topFilter:cs('.topbar','filter'),
 vTime:v?+v.currentTime.toFixed(2):null,vPaused:v?v.paused:null,vMark:v?!!v.__mark:null,active:!!(window.__cinemaLens&&window.__cinemaLens.active()),veil:!!document.getElementById('cn-veil')})})()`
const sample = async () => { const v = await evalJs(SAMPLE); try { return JSON.parse(v) } catch (e) { return null } }   // 導航中 context 會消失：回 null
const poll = async (ms, step = 40) => { const out = []; const t0 = Date.now(); while (Date.now() - t0 < ms) { const s = await sample(); if (s) { s.t = Date.now() - t0; out.push(s) } await sleep(step) } return out }
const summarize = (arr, keys) => { const o = {}; keys.forEach(k => { const vs = arr.map(s => s[k]).filter(v => typeof v === 'number'); o[k] = vs.length ? { min: +Math.min(...vs).toFixed(3), max: +Math.max(...vs).toFixed(3) } : null }); return o }
const report = {}
const note = (k, v) => { report[k] = v; console.log(k, typeof v === 'string' ? v : JSON.stringify(v)) }
const clean = s => !s ? null : ({ view: s.view, lens: s.lens, cls: s.cls, cvBlur: s.cvBlur, cvInline: s.cvInline, scInline: s.scInline, mainOp: s.mainOp, contentOp: s.contentOp, active: s.active, veil: s.veil, vPaused: s.vPaused, vTime: s.vTime })

// ── 1 首次進站：失焦 → 對到焦 → 鎖定；影片一直播、元素沒重建 ──
await send('Page.navigate', { url: `http://localhost:8934/strava_cinema.html?lens=${Date.now()}#today` })
const intro = []; let seenIntro = false
for (let i = 0; i < 400; i++) {
  const s = await sample(); if (!s) { await sleep(30); continue } s.t = i
  if (s.lens === '1') { seenIntro = true; if (s.vMark === false) await evalJs(`(()=>{const v=document.querySelector('.td-video');if(v)v.__mark=1})()`) }
  if (seenIntro) intro.push(s)
  if (seenIntro && !s.lens && !s.active) break
  await sleep(30)
}
note('intro samples', intro.length)
note('intro first', clean(intro[0] || {}))
note('intro range', summarize(intro, ['cvBlur', 'scBlur', 'mainOp', 'tabOp']))
note('intro topbar/tabbar filter', [...new Set(intro.map(s => s.topFilter + '|' + s.tabFilter))])
note('intro end', clean(await sample()))
await sleep(1200)
note('video after intro', await evalJs(`(()=>{const v=document.querySelector('.td-video');return JSON.stringify({mark:!!v.__mark,paused:v.paused,t:+v.currentTime.toFixed(2),inScene:!!v.closest('.td-scene'),sceneFilter:getComputedStyle(v.closest('.td-scene')).filter})})()`))
await shot('l_today')
note('updated@1440', await evalJs(`getComputedStyle(document.getElementById('ah-upd')).display`))

// ── 2 TODAY → TRAIN（跨 hub）：舊內容 ~100ms 淡出、背景 5px→0、沒有遮罩 ──
const hub = h => centerOf(MOBILE ? `.tab-i[data-hub="${h}"]` : `.hub-i[data-hub="${h}"]`)
await click(await hub('train'))
const l2 = await poll(900)
note('hub range', summarize(l2, ['cvBlur', 'mainOp']))
note('hub mid', l2.slice(0, 6).map(s => `${s.t}ms v=${s.view} lens=${s.lens} blur=${s.cvBlur} main=${s.mainOp}`))
note('hub end', clean(await sample()))
await sleep(500); await shot('l_train')

// ── 3 計畫 → 攻略（同 hub rail）：只有內容 dissolve，背景不動 ──
await click(await centerOf('.rail-i[data-view="playbook"]'))
const l3 = await poll(500)
note('rail range', summarize(l3, ['cvBlur', 'contentOp', 'mainOp']))
note('rail lens values', [...new Set(l3.map(s => s.lens))])
note('rail end', clean(await sample()))
await sleep(300); await shot('l_playbook')

// ── 4 REVIEW → TODAY：沒有全屏遮蔽，回到 TODAY 影片照播 ──
await click(await hub('review')); await sleep(1200)
await click(await hub('today'))
const l4 = await poll(900)
note('review→today range', summarize(l4, ['cvBlur', 'scBlur', 'mainOp']))
note('review→today end', clean(await sample()))
await sleep(600)
note('video after return', await evalJs(`(()=>{const v=document.querySelector('.td-video');return JSON.stringify({mark:!!v.__mark,paused:v.paused,t:+v.currentTime.toFixed(2)})})()`))

// ── 5 快速連點：TRAIN 再 RIDE → 停在 RIDE；rail 再 hub → 停在 hub ──
await click(await hub('train')); await sleep(40); await click(await hub('ride')); await sleep(1400)
note('rapid hub end', clean(await sample()))
await click(await centerOf('.rail-i[data-view="itt"]')); await sleep(30); await click(await hub('review')); await sleep(1400)
note('rapid rail→hub end', clean(await sample()))
await evalJs('history.back()'); await sleep(1200); note('back end', clean(await sample()))
await evalJs('history.forward()'); await sleep(1200); note('forward end', clean(await sample()))

// ── 6 reduced motion：鏡頭完全不動，只有 120ms 淡入淡出 ──
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }); await sleep(300)
await click(await hub('today'))
const rm = await poll(500, 25)
note('rm range', summarize(rm, ['cvBlur', 'scBlur', 'mainOp']))
note('rm end', clean(await sample()))
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
if (MOBILE) note('mobile sw', await evalJs('JSON.stringify({sw:document.documentElement.scrollWidth,iw:innerWidth})'))

// ── 7 放慢 8 倍的時鐘截轉場中途幀（rAF／performance.now／setTimeout 走 JS shim，CSS 動畫走 Animation.setPlaybackRate）──
const slow = await send('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{const P=performance.now.bind(performance);const base=P();const S=1/8;performance.now=()=>base+(P()-base)*S;const R=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>R(()=>cb(performance.now()));const ST=window.setTimeout.bind(window);window.setTimeout=(fn,ms,...a)=>ST(fn,(ms||0)/S,...a)})()` })
await send('Animation.setPlaybackRate', { playbackRate: 0.125 })
await send('Page.navigate', { url: `http://localhost:8934/strava_cinema.html?lensslow=${Date.now()}#today` })
let started = false
for (let i = 0; i < 400 && !started; i++) { await sleep(30); const s = await sample(); if (s && s.lens === '1') started = true }
note('slow intro started', started)
const t0 = Date.now()
await sleep(300); await shot('l_intro_1defocus'); note('slow shot1 state', clean(await sample()))
await sleep(2500); await shot('l_intro_2pull'); note('slow shot2 state', clean(await sample()))
await sleep(3200); await shot('l_intro_3lock'); note('slow shot3 state', clean(await sample()))
await sleep(4000); note('slow intro end', clean(await sample()))
note('slow shots at real ms', Date.now() - t0)
await click(await hub('train'))
await sleep(600); await shot('l_hub_1out'); note('slow hub out', clean(await sample()))
await sleep(1500); await shot('l_hub_2refocus'); note('slow hub refocus', clean(await sample()))
await sleep(4500); note('slow hub end', clean(await sample()))
await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: slow.result.identifier })
await send('Animation.setPlaybackRate', { playbackRate: 1 })
note('console errors', errors)
writeFileSync(`${OUT}/lens-report${TAG}.json`, JSON.stringify(report, null, 2))
ws.close(); chrome.kill(); process.exit(0)
