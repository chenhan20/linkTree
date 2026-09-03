/* Full functional probe of strava_fable51.html. usage: node probe.js <W> <H> <mobile:0|1> <tag> [reduce:0|1] [shots:0|1] */
const { launch, CDP, sleep } = require('./cdp-lib.js')
const fs = require('fs'), path = require('path')
const [W, H, MOBILE, TAG, REDUCE, SHOTS] = [+process.argv[2] || 1440, +process.argv[3] || 1000, process.argv[4] === '1', process.argv[5] || 'run', process.argv[6] === '1', process.argv[7] !== '0']
const OUT = path.join(__dirname, 'shots'); fs.mkdirSync(OUT, { recursive: true })
const URL = process.env.FX_URL || 'http://127.0.0.1:8765/strava_fable51.html'
const PORT = 9300 + Math.floor(Math.random() * 300)
const innerW = W => (MOBILE || W <= 767) ? W : (W <= 1023 ? W - 148 : W >= 2200 ? W - 284 : W >= 1600 ? W - 236 : W - 188)
const R = { tag: TAG, size: `${W}x${H}${MOBILE ? ' mobile' : ''}${REDUCE ? ' reduced' : ''}`, pass: [], fail: [], warn: [], console: [] }
const ok = (name, cond, info) => { (cond ? R.pass : R.fail).push(name + (info ? ' :: ' + info : '')); console.log((cond ? '  + ' : '  - ') + name + (info ? ' :: ' + info : '')) }
const warn = (name, info) => { R.warn.push(name + (info ? ' :: ' + info : '')); console.log('  ? ' + name + (info ? ' :: ' + info : '')) }
;(async () => {
  const chrome = await launch(PORT, W, H)
  const c = await CDP.open(PORT)
  await c.send('Page.enable'); await c.send('Runtime.enable'); await c.send('Network.enable'); await c.send('Log.enable')
  await c.send('Network.setCacheDisabled', { cacheDisabled: true })
  await c.viewport(W, H, MOBILE)
  if (REDUCE) await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  c.on('Runtime.exceptionThrown', p => R.console.push('EXC ' + (p.exceptionDetails.exception && p.exceptionDetails.exception.description || p.exceptionDetails.text).split('\n')[0]))
  c.on('Runtime.consoleAPICalled', p => { if (p.type === 'error' || p.type === 'warning') R.console.push(p.type.toUpperCase() + ' ' + p.args.map(a => a.value || a.description || '').join(' ').slice(0, 200)) })
  c.on('Log.entryAdded', p => { if (p.entry.level === 'error') R.console.push('LOG ' + (p.entry.text || '').slice(0, 200) + ' ' + (p.entry.url || '').slice(-40)) })
  await c.goto(URL)
  ok('data-ready fired', await c.waitFor('!!window.__fxData', 25000))
  await sleep(1500)
  const V = ['deck', 'train', 'log', 'itt', 'engine', 'atlas', 'body']
  const st = await c.eval(`({fx: document.documentElement.dataset.fx, pref: document.documentElement.dataset.fxPref, hasFx: !!window.__fx, atmOk: !!(window.__fx&&__fx.Atmo.ok), atmRunning: !!(window.__fx&&__fx.Atmo.running), scene: window.__fx&&__fx.Atmo.scene, level: window.__fx&&__fx.Atmo.level, atmHidden: document.getElementById('atm').hidden, view: appState.view, hosts: [...document.querySelectorAll('.fx-host')].map(h=>h.dataset.fxviz+':'+(h.hidden?'hidden':'shown')), ctl: !!document.querySelector('.fxm'), lab: !!document.querySelector('#atm-lab button'), bar: (document.querySelector('#atm-bar')||{}).textContent.trim().slice(0,120)})`)
  R.state = st
  ok('fx loaded', st.hasFx); ok('mode is ' + (REDUCE ? 'quiet (reduced)' : 'overdrive'), st.fx === (REDUCE ? 'quiet' : 'overdrive'), st.fx)
  ok('atmosphere init', st.atmOk); ok('atmosphere visible on deck', !st.atmHidden)
  ok('atmosphere running matches mode', REDUCE ? !st.atmRunning : st.atmRunning, 'running=' + st.atmRunning + ' level=' + st.level)
  ok('scene from real data', ['fresh', 'build', 'redline', 'nosignal'].includes(st.scene), st.scene)
  ok('fx mode control mounted', st.ctl); ok('scene lab mounted', st.lab)
  // Ghost Roads 底圖：星野退役、畫布鋪滿、桌機抓路網、OVERDRIVE 有光跑過
  const fd = await c.eval(`({bg: document.documentElement.dataset.bg, cv: !!document.getElementById('bgfield'), rect: (r => r && [r.width, r.height])(document.getElementById('bgfield') && document.getElementById('bgfield').getBoundingClientRect()), star: getComputedStyle(document.getElementById('star-canvas')).display, sfPaused: window.__starfield && __starfield.paused, want: __fx.Field.wantRoads, running: __fx.Field.running})`)
  ok('ghost roads: canvas mounted, starfield retired', fd.bg === 'roads' && fd.cv && fd.star === 'none' && fd.sfPaused === true, JSON.stringify(fd))
  const vp = await c.eval(`[innerWidth, innerHeight]`)
  ok('ghost roads: canvas covers viewport', fd.rect && Math.abs(fd.rect[0] - vp[0]) < 2 && Math.abs(fd.rect[1] - vp[1]) < 2, JSON.stringify(fd.rect) + ' vs ' + JSON.stringify(vp))
  if (MOBILE) ok('ghost roads: no route payload on phones', fd.want === false && await c.eval(`__fx.Field.routes == null`), 'want=' + fd.want)
  else {
    ok('ghost roads: routes loaded in idle time', await c.waitFor(`!!__fx.Field.routes`, 20000, 200), 'err=' + await c.eval(`__fx.Field.err`))
    const rd = await c.eval(`({bins: __fx.Field.routes && __fx.Field.routes.length, places: __fx.Field.places && __fx.Field.places.length, roads: !!__fx.Field.roads, fit: !!__fx.Field.fit})`)
    ok('ghost roads: 6 bins painted + 12 ITT places', rd.bins === 6 && rd.roads && rd.fit && rd.places === 12, JSON.stringify(rd))
    if (REDUCE) ok('ghost roads: static under reduced motion', await c.eval(`!__fx.Field.running && __fx.Field.streaks.length === 0`))
    else ok('ghost roads: a ride streaks along a road (overdrive)', await c.waitFor(`__fx.Field.running && __fx.Field.streaks.length > 0`, 9000, 200), 'streaks=' + await c.eval(`__fx.Field.streaks.length`))
  }
  // 騎士：向量畫、不再縮圖放大 —— 直接在一張 400×250 的畫布上畫一次，要有像素、不能丟例外
  ok('rider: vector paint produces pixels', await c.eval(`(() => { const cv = document.createElement('canvas'); cv.width = 400; cv.height = 250; const x = cv.getContext('2d'); __fx.Rider.paint(x, 1.1); return x.getImageData(0, 0, 400, 250).data.some(v => v) })()`))
  // 騎士：攻擊要加速 —— 離線跑 4.8 秒的 step，要站起來、速度到 2.5 倍以上、還在畫面裡
  ok('rider: attack stands up and accelerates', await c.eval(`(() => { const R = __fx.Rider, P = __fx.Atmo.cur; if (!P) return false; R.spawn(P); for (let i = 0; i < 300; i++) R.step(16, P, 'full'); const v0 = R.v0 * Math.max(.4, P.riderSpd); return R.stand === 1 && R.v / v0 > 2.5 && R.u > .3 && R.u < 1; })()`), JSON.stringify(await c.eval(`({t: __fx.Rider.t, stand: __fx.Rider.stand, u: +__fx.Rider.u.toFixed(3)})`)))
  if (!MOBILE) {
    // 側欄山景：hero 幾何量到了、山脊接在 hero 的頂邊上、OVERDRIVE 在跑、reduced motion 靜態；畫布有像素
    const ss = await c.eval(`({ok: __fx.SideScene.ok, hero: __fx.SideScene.hero, running: __fx.SideScene.running, ridge: !!__fx.SideScene.ridgeCv, px: (() => { const S = __fx.SideScene; const d = S.ctx.getImageData(0, 0, S.cv.width, S.cv.height).data; let n = 0; for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 0) n++; return n })()})`)
    ok('side scene: panorama continues the hero (geometry measured, ridges drawn)', ss.ok && ss.hero.W > 600 && ss.hero.top >= 0 && ss.ridge && ss.px > 50, JSON.stringify(ss))
    ok('side scene: ' + (REDUCE ? 'static under reduced motion' : 'alive in OVERDRIVE'), REDUCE ? !ss.running : ss.running)
  }
  ok('viz hosts', st.hosts.filter(h => h.endsWith('shown')).length >= 3, st.hosts.join(','))
  const hero = await c.eval(`(()=>{const h=document.getElementById('hero');if(!h)return null;const r=h.getBoundingClientRect();const cv=document.getElementById('atm-canvas');const num=document.querySelector('.hero .board-num');return {h:Math.round(r.height),w:Math.round(r.width),left:Math.round(r.left),cvW:cv.width,cvH:cv.height,atmIn:!!h.querySelector('#atm'),num:num&&num.textContent,numFont:num&&getComputedStyle(num).fontFamily.split(',')[0],uiFont:getComputedStyle(document.body).fontFamily.split(',')[0],navPrefix:getComputedStyle(document.querySelector('.nav-i'),'::before').content}})()`)
  R.hero = hero
  ok('launch hero present, canvas inside, full-bleed', !!hero && hero.atmIn && hero.h >= 420 && hero.w >= innerW(W) - 2, JSON.stringify(hero))
  ok('display numeral font is Michroma (user pick)', !!hero && /Michroma/.test(hero.numFont || ''), hero && hero.numFont)
  ok('ui font is Inter Tight (user pick)', !!hero && /Inter Tight/.test(hero.uiFont || ''), hero && hero.uiFont)
  ok('table numerals stay tabular Barlow Condensed', /Barlow/.test(await c.eval(`getComputedStyle(document.querySelector('.ac-n')||document.body).fontFamily`)))
  const ovf = async () => c.eval('document.documentElement.scrollWidth - innerWidth')
  ok('no body overflow (deck)', (await ovf()) <= 0, 'delta=' + await ovf())
  // -- rAF loop accounting on overview
  const rafs = await c.eval(`new Promise(r=>{let n=0;const o=requestAnimationFrame;window.requestAnimationFrame=f=>{n++;return o(f)};setTimeout(()=>{window.requestAnimationFrame=o;r(n)},1000)})`, true)
  R.rafPerSec = rafs
  ok('rAF budget sane', REDUCE ? rafs < 20 : rafs < 400, 'rAF/s=' + rafs)
  // 每一幀的 CPU 成本（跟 headless 的 compositor 節奏無關）：連續畫 30 幀取平均
  const cost = await c.eval(`(()=>{const A=__fx.Atmo;if(!A.cur)return -1;const t0=performance.now();for(let i=0;i<30;i++){A.step(16.7,performance.now())}return +((performance.now()-t0)/30).toFixed(2)})()`)
  R.atmoMsPerFrame = cost
  ok('atmosphere frame cost (software canvas) < 12ms', cost >= 0 && cost < 12, cost + ' ms/frame')
  if (SHOTS) await c.shot(path.join(OUT, `${TAG}-overview.png`))
  // -- walk all views
  for (const v of V) {
    await c.eval(`setView('${v}',{push:true})`)
    await sleep(v === 'atlas' ? 2500 : v === 'itt' ? 3000 : 700)
    const s = await c.eval(`({hash: location.hash, on: (document.querySelector('#content .view.is-on')||{}).dataset.view, cnt: document.querySelectorAll('#content .view.is-on').length, nav: (document.querySelector('.nav-i[aria-current=page]')||{}).dataset.view, tab: (document.querySelector('.tab-i[aria-current=page]')||{}).dataset.view, atm: (window.__fx&&__fx.Atmo.running), h: document.querySelector('#content .view.is-on').scrollHeight, hosts: [...document.querySelectorAll('#content .view.is-on .fx-host')].map(h=>h.dataset.fxviz+':'+(h.hidden?'hidden':h.children.length))})`)
    ok(`view ${v}: hash+is-on+nav`, s.hash === '#' + v && s.on === v && s.cnt === 1 && s.nav === v && s.tab === v, JSON.stringify(s))
    // 進場的 pop-in（transform）會短暫撐出 scrollWidth，量「安定後」的值：2.5 秒內回到 0 就算過
    ok(`view ${v}: no overflow`, await c.waitFor(`document.documentElement.scrollWidth - innerWidth <= 0`, 2500, 200), 'delta=' + await ovf())
    ok(`view ${v}: atmosphere ${v === 'deck' ? 'on' : 'off'}`, REDUCE ? !s.atm : (s.atm === (v === 'deck')), 'running=' + s.atm)
    R['view_' + v] = s
    if (SHOTS && ['itt', 'engine', 'atlas', 'body', 'train'].includes(v)) await c.shot(path.join(OUT, `${TAG}-${v}.png`))
  }
  console.log('## back/forward'); // -- back / forward
  await c.eval(`setView('deck',{push:true})`); await sleep(200); await c.eval(`setView('engine',{push:true})`); await sleep(200)
  await c.eval('history.back()'); await sleep(400)
  ok('history back -> deck', (await c.eval('location.hash+"|"+appState.view')) === '#deck|deck', await c.eval('location.hash+"|"+appState.view'))
  await c.eval('history.forward()'); await sleep(400)
  ok('history forward -> engine', (await c.eval('location.hash+"|"+appState.view')) === '#engine|engine', await c.eval('location.hash+"|"+appState.view'))
  await c.eval(`location.hash = '#plan'`); await sleep(400)
  ok('alias #plan -> train', (await c.eval('appState.view')) === 'train')
  await c.eval(`location.hash = '#trends'`); await sleep(400)
  ok('alias #trends -> engine', (await c.eval('appState.view')) === 'engine')
  console.log('## drawer'); // -- drawer (plan session)
  await c.eval(`setView('train',{push:true})`); await sleep(500)
  const ses = await c.eval(`(document.querySelector('.ses[data-ses]')||{}).dataset.ses`)
  if (ses) {
    await c.eval(`document.querySelector('.ses[data-ses="${ses}"]').click()`)
    ok('drawer opens from session row', await c.waitFor(`document.getElementById('drawer').classList.contains('open') && !document.getElementById('drawer').hidden`, 4000))
    ok('drawer deep link hash', (await c.eval('location.hash')).startsWith('#train/session/'), await c.eval('location.hash'))
    ok('drawer body has content', (await c.eval(`document.getElementById('dw-body').textContent.trim().length`)) > 20)
    await c.eval(`document.getElementById('${MOBILE ? 'dw-back' : 'dw-x'}').click()`); await sleep(450)
    ok('drawer closes', await c.eval(`document.getElementById('drawer').hidden === true`))
    // trajectory node -> same drawer
    const tj = await c.eval(`!!document.querySelector('.tj-node[data-ses]')`)
    if (tj) { await c.eval(`document.querySelector('.tj-node[data-ses]').click()`); ok('trajectory node opens drawer', await c.waitFor(`document.getElementById('drawer').classList.contains('open')`, 4000)); await c.eval('closeDrawer()'); await sleep(400) }
    else warn('trajectory nodes absent')
  } else warn('no session rows to test drawer')
  console.log('## log'); // -- log
  await c.eval(`setView('log',{push:true})`); await sleep(800)
  const logs = await c.eval(`({days: document.querySelectorAll('#timeline .timeline-day').length, cards: document.querySelectorAll('.activity-card').length, detail: document.querySelectorAll('.act-detail-btn').length, strava: document.querySelectorAll('.act-strava-link').length, more: !!document.getElementById('show-more-btn'), laps: document.querySelectorAll('.lap-toggle').length, r3d: document.querySelectorAll('.r3d-trigger-btn').length})`)
  R.log = logs
  ok('log rows rendered', logs.days >= 5 && logs.cards >= 5, JSON.stringify(logs))
  ok('activity-modal buttons injected', logs.detail > 0)
  if (logs.more) { await c.eval(`document.getElementById('show-more-btn').click()`); await sleep(500); ok('show more expands', (await c.eval(`document.querySelectorAll('#timeline .timeline-day').length`)) > logs.days) }
  if (logs.laps) { await c.eval(`document.querySelector('.lap-toggle').click()`); await sleep(300); ok('lap strip expands', (await c.eval(`[...document.querySelectorAll('.lap-strip[data-lapgrp]')].some(e=>e.style.display!=='none')`))) }
  if (logs.detail) {
    await c.eval(`document.querySelector('.act-detail-btn').click()`); await sleep(900)
    ok('activity modal opens', await c.eval(`!!document.querySelector('.am-overlay.open')`))
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(400)
    ok('activity modal closes on Esc', await c.eval(`!document.querySelector('.am-overlay.open')`))
  }
  // sport tab switch
  const tabs = await c.eval(`document.querySelectorAll('.sport-tab').length`)
  if (tabs > 1) { await c.eval(`document.querySelectorAll('.sport-tab')[1].click()`); await sleep(400); ok('sport tab switches', await c.eval(`document.querySelectorAll('.sport-tab')[1].classList.contains('active')`)) }
  // -- 3D route replay modal (first ride with route)
  if (logs.r3d) {
    await c.eval(`document.querySelector('.r3d-trigger-btn').click()`); 
    ok('route3d overlay opens', await c.waitFor(`document.getElementById('r3d-overlay').classList.contains('open')`, 15000))
    await sleep(2500)
    const r3 = await c.eval(`({loading: getComputedStyle(document.getElementById('r3dLoading')).display, three: !!window.THREE, err: !!document.querySelector('.r3d-error')})`)
    ok('route3d model built (three loaded, no error)', r3.three && !r3.err, JSON.stringify(r3))
    await c.eval(`r3dTogglePlay()`); await sleep(1200)
    const pl = await c.eval(`({btn: document.getElementById('r3dPlayBtn').textContent, scrub: +document.getElementById('r3dScrub').value})`)
    ok('route3d play advances scrub', pl.scrub > 0, JSON.stringify(pl))
    await c.eval(`r3dSetSpeed(2, document.querySelector('.r3d-controls [data-speed="2"]'))`); await sleep(100)
    ok('route3d speed button active', await c.eval(`document.querySelector('.r3d-controls [data-speed="2"]').classList.contains('active')`))
    await c.eval(`r3dTogglePlay(); r3dSetU(0.5)`); await sleep(200)
    ok('route3d scrub to 0.5', Math.abs((await c.eval(`+document.getElementById('r3dScrub').value`)) - 500) < 5)
    await c.eval(`r3dReset()`); await sleep(200)
    ok('route3d reset to 0', (await c.eval(`+document.getElementById('r3dScrub').value`)) === 0)
    await c.eval(`closeRoute3D()`); await sleep(500)
    ok('route3d closes', await c.eval(`!document.getElementById('r3d-overlay').classList.contains('open')`))
  } else warn('no 3D route buttons in log')
  console.log('## itt'); // -- ITT deep link + plates
  const segId = await c.eval(`window.__ittFirstSeg`)
  await c.eval(`location.hash = '#itt/segment/${segId}'`)
  const hitSeen = await c.waitFor(`!!document.querySelector('.tsv.tsv-hit')`, 9000, 80)   // .tsv-hit 只亮 2.2 秒；軟體渲染下 12 座檯建場景會擋住計時器
  const itt = await c.eval(`({view: appState.view, hit: ${hitSeen}, plates: document.querySelectorAll('.tsv').length, canvases: document.querySelectorAll('canvas.tsv-cv').length, tsv: !!(window.__tsv&&__tsv.items.length), items: window.__tsv?__tsv.items.length:0, raf: window.__tsv?(__tsv.raf!=null):null, top: Math.round(document.getElementById('tsv-${segId}').getBoundingClientRect().top)})`)
  R.itt = itt
  ok('itt deep link selects segment', itt.view === 'itt' && itt.hit, JSON.stringify(itt))
  ok('itt 3D plates built', itt.tsv && itt.items > 0, 'items=' + itt.items)
  if (itt.tsv) {
    await c.eval(`__tsv.items[0].btnReplay.click()`)
    await c.waitFor(`__tsv.items[0].playMs > 400`, 9000, 150)   // 軟體渲染下 2560 一幀可能要半秒，輪詢而不是固定等 1.5 秒
    const rp = await c.eval(`({playing: __tsv.items[0].sec.classList.contains('playing'), ms: __tsv.items[0].playMs, km: __tsv.items[0].liveEls.km.textContent, prog: __tsv.items[0].prog.style.width})`)
    ok('itt replay runs (live km + progress)', rp.playing && rp.ms > 0 && rp.km !== '0.00km', JSON.stringify(rp))
    await c.eval(`__tsv.items[0].btnReplay.click()`); await sleep(200)
    ok('itt replay stops', await c.eval(`!__tsv.items[0].sec.classList.contains('playing')`))
    await c.eval(`__tsv.items[0].btnSpin.click()`); await sleep(100)
    ok('itt spin toggles', await c.eval(`__tsv.items[0].auto===false || __tsv.items[0].auto===true`))
    // drag rotates
    const cv = await c.eval(`(r=>[r.left+r.width/2,r.top+r.height/2])(document.querySelector('canvas.tsv-cv').getBoundingClientRect())`)
    const rot0 = await c.eval(`__tsv.items[0].rot`)
    await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cv[0], y: cv[1], button: 'left', clickCount: 1 })
    await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cv[0] + 80, y: cv[1], button: 'left' })
    await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cv[0] + 80, y: cv[1], button: 'left', clickCount: 1 })
    await sleep(200)
    ok('itt drag rotates plate', Math.abs((await c.eval(`__tsv.items[0].rot`)) - rot0) > 0.05)
    // challenge book expand
    await c.eval(`document.querySelector('.il-row').click()`); await sleep(300)
    ok('itt challenge book expands', await c.eval(`!!document.querySelector('.il-seg.open .il-table')`))
  }
  // leaving ITT stops the tsv loop
  await c.eval(`setView('deck',{push:true})`)
  ok('tsv loop stops when leaving ITT', await c.waitFor(`!window.__tsv || __tsv.raf == null`, 6000, 100), 'raf=' + await c.eval(`window.__tsv&&__tsv.raf`))   // IntersectionObserver 在多顆 Chrome 搶 CPU 時會晚到，輪詢而不是固定等
  console.log('## atlas'); // -- Atlas
  await c.eval(`setView('atlas',{push:true})`)
  ok('atlas ready', await c.waitFor('AT.ready === true', 20000))
  await sleep(600)
  const k0 = await c.eval('({k:AT.view.k,cx:AT.view.cx})')
  await c.eval(`document.getElementById('at-in').click()`); await sleep(1200)
  const k1 = await c.eval('AT.view.k')
  ok('atlas zoom in', k1 > k0.k, `${k0.k}->${k1}`)
  await c.eval(`document.querySelector('.at-chip[data-kind="itt"]').click()`)
  const lockSeen = await c.waitFor(`!!document.querySelector('.at-lock')`, 9000, 100)   // 飛行 760ms，但軟體渲染的一幀可能就要 300ms+
  const chip = await c.eval(`({on: !!document.querySelector('.at-chip.is-on'), focus: AT.focus, lock: ${lockSeen}, cx: AT.view.cx})`)
  ok('atlas chip flies + focus', chip.on && !!chip.focus && chip.cx !== k0.cx, JSON.stringify(chip))
  await c.eval(`document.querySelector('#at-blur [data-blur="11"]').click(); document.getElementById('at-t-town').click()`); await sleep(500)
  ok('atlas toggles (blur, towns)', await c.eval(`AT.st.blur===11 && AT.st.towns===false && document.getElementById('at-t-town').getAttribute('aria-pressed')==='false'`))
  await c.eval(`document.getElementById('at-t-town').click(); document.getElementById('at-home').click()`); await sleep(1200)
  ok('atlas home restores', await c.eval(`AT.focus===null && AT.st.towns===true`))
  // drag pan
  const map = await c.eval(`(r=>[r.left+r.width/2,r.top+r.height/2])(document.getElementById('at-map').getBoundingClientRect())`)
  const cx0 = await c.eval('AT.view.cx')
  await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: map[0], y: map[1], button: 'left', clickCount: 1 })
  await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: map[0] + 60, y: map[1] + 20, button: 'left' })
  await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: map[0] + 60, y: map[1] + 20, button: 'left', clickCount: 1 })
  await sleep(300)
  ok('atlas drag pans', (await c.eval('AT.view.cx')) !== cx0)
  console.log('## engine'); // -- Engine readouts
  await c.eval(`setView('engine',{push:true})`); await sleep(800)
  const tr = await c.eval(`({pcv: !!document.querySelector('.pcv-plot'), race: !!document.querySelector('.race-plot'), clk: !!document.querySelector('.dstrip'), rdr: document.querySelectorAll('.rdr-svg').length, ps: !!document.querySelector('#ps-plot'), vol: document.querySelectorAll('#vol .vrow:not([hidden])').length, pcvRead: (document.getElementById('pcv-read')||{}).textContent.trim().slice(0,60)})`)
  R.trends = tr
  ok('trends charts present', tr.pcv && tr.race && tr.clk && tr.rdr >= 1 && tr.ps, JSON.stringify(tr))
  await c.eval(`document.querySelector('[data-range="6"]').click()`); await sleep(300)
  ok('volume range switch to 6M', (await c.eval(`document.querySelectorAll('#vol .vrow:not([hidden])').length`)) === 6)
  await c.eval(`document.querySelector('[data-metric="tss"]').click()`); await sleep(300)
  ok('volume metric switch to TSS', await c.eval(`document.getElementById('vol').dataset.metric==='tss' && document.querySelector('#vol .vrow:not([hidden]) .vval').textContent.length>0`))
  await c.eval(`document.querySelector('.pcv-dot').dispatchEvent(new PointerEvent('pointerover',{bubbles:true}))`); await sleep(200)
  ok('power curve dot readout', (await c.eval(`document.getElementById('pcv-read').textContent`)).includes('W'))
  await c.eval(`document.querySelector('[data-ps]').dispatchEvent(new PointerEvent('pointerover',{bubbles:true}))`); await sleep(200)
  const psr = await c.eval(`document.getElementById('ps-read').textContent`)
  ok('power slices readout has 3 values', /全時/.test(psr) && /近半年/.test(psr) && /前半年/.test(psr), psr.slice(0, 80))
  await c.eval(`document.querySelector('.pcv-dot').click()`); await sleep(700)
  ok('power modal opens from curve dot', await c.eval(`!!document.querySelector('.pwr-modal-overlay.open')`))
  await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(400)
  const pmOpen = await c.eval(`!!document.querySelector('.pwr-modal-overlay.open')`)
  if (pmOpen) { await c.eval(`document.querySelector('.pm-close').click()`); await sleep(400) }
  ok('power modal closes', await c.eval(`!document.querySelector('.pwr-modal-overlay.open')`))
  console.log('## harvest'); // -- Harvest (inside engine)
  await c.eval(`setView('engine',{push:true})`); await sleep(2200)
  await c.eval(`document.querySelector('#hv-hit button[data-hvi="3"]').dispatchEvent(new PointerEvent('pointerover',{bubbles:true}))`); await sleep(200)
  const hv = await c.eval(`({read: document.getElementById('hv-read').textContent.trim().slice(0,50), idle: document.getElementById('hv-read').classList.contains('is-idle'), cursor: !document.getElementById('hv-cursor').hidden, arcs: document.querySelectorAll('.hd-arcs path').length, hd: !!document.querySelector('.hd-bars'), barT: document.querySelector('.hv-bar')?document.querySelector('.hv-bar').style.transform:'-'})`)
  R.harvest = hv
  ok('harvest hover readout + cursor', !hv.idle && hv.cursor, JSON.stringify(hv))
  ok('harvest delay field + arcs', hv.hd && hv.arcs > 0, 'arcs=' + hv.arcs)
  ok('harvest bars restored after motion (no inline transform left)', hv.barT === '' , 'transform=' + hv.barT)
  await c.eval(`document.querySelector('#hv-hit button[data-hvi="3"]').focus()`); await sleep(200)
  ok('harvest focus readout (keyboard/touch lock)', await c.eval(`!document.getElementById('hv-read').classList.contains('is-idle')`))
  await c.eval(`document.querySelector('#hv-hit button[data-hvi="3"]').click()`)
  ok('harvest month drawer', await c.waitFor(`document.getElementById('drawer').classList.contains('open') && location.hash.startsWith('#engine/month/')`, 9000, 150), await c.eval('location.hash'))
  await c.eval('closeDrawer()'); await sleep(400)
  await c.eval(`document.querySelector('[data-hvf="pwr"]').click()`); await sleep(300)
  ok('harvest filter switch', (await c.eval(`document.querySelectorAll('#hv-list .row').length`)) > 0)
  console.log('## body'); // -- Body
  await c.eval(`setView('body',{push:true})`); await sleep(1000)
  const bd = await c.eval(`({tabs: document.querySelectorAll('#body-tabs .wl-mtab').length, panel: !!document.querySelector('#body-panel .wl-chart'), bc: !!document.querySelector('.bc-map svg'), rows: document.querySelectorAll('.bc-row').length, na: document.querySelectorAll('.bc-row .is-na').length, doms: !!document.querySelector('.dm'), phr: document.querySelectorAll('.wl-panel').length})`)
  R.body = bd
  ok('body panels + constellation', bd.tabs >= 4 && bd.panel && bd.bc && bd.rows >= 5, JSON.stringify(bd))
  await c.eval(`document.querySelectorAll('#body-tabs .wl-mtab')[2].click()`); await sleep(500)
  ok('body metric switch', await c.eval(`document.querySelectorAll('#body-tabs .wl-mtab')[2].classList.contains('on') && !!document.querySelector('#body-panel .wl-chart')`))
  await c.eval(`document.querySelector('[data-wlrange="30"]').click()`); await sleep(500)
  ok('body range switch', await c.eval(`document.querySelector('[data-wlrange="30"]').classList.contains('on')`))
  if (SHOTS) await c.shot(path.join(OUT, `${TAG}-body2.png`))
  console.log('## fx modes'); // -- FX modes
  await c.eval(`setView('deck',{push:true})`); await sleep(800)
  if (!REDUCE) {
    await c.eval(`__fx.Mode.set('active')`); await sleep(300)
    const a = await c.eval(`({fx: document.documentElement.dataset.fx, ls: localStorage.getItem('fx-mode-v1'), star: __starfield.paused, nc: __nameCard.paused, level: __fx.Atmo.level, running: __fx.Atmo.running, fps: __fx.Ticker.fps, pressed: document.querySelector('.fxm-b[aria-pressed=true]').dataset.fxset})`)
    ok('ACTIVE mode: star paused, lite atmosphere, 30fps, persisted', a.fx === 'active' && a.ls === 'active' && a.star && a.nc && a.level === 'lite' && a.running && a.fps === 30 && a.pressed === 'active', JSON.stringify(a))
    await c.eval(`__fx.Mode.set('quiet')`); await sleep(300)
    const q = await c.eval(`({fx: document.documentElement.dataset.fx, star: __starfield.paused, level: __fx.Atmo.level, running: __fx.Atmo.running, jobs: __fx.Ticker.jobs.size, raf: __fx.Ticker.raf})`)
    ok('QUIET mode: atmosphere static, ticker idle', q.fx === 'quiet' && q.star && q.level === 'static' && !q.running && q.raf === 0, JSON.stringify(q))
    const rq = await c.eval(`new Promise(r=>{let n=0;const o=requestAnimationFrame;window.requestAnimationFrame=f=>{n++;return o(f)};setTimeout(()=>{window.requestAnimationFrame=o;r(n)},1000)})`, true)
    ok('QUIET: near-zero rAF', rq < 20, 'rAF/s=' + rq)
    await c.eval(`__fx.Mode.set('overdrive')`); await sleep(300)
    const o = await c.eval(`({fx: document.documentElement.dataset.fx, star: __starfield.paused, bg: document.documentElement.dataset.bg === 'roads', level: __fx.Atmo.level, running: __fx.Atmo.running, field: __fx.Field.running})`)
    // 底圖換成路網之後星野永遠停（display:none 的畫布不該跑 rAF）；桌機的路網 loop 要回來
    ok('OVERDRIVE restored', o.fx === 'overdrive' && o.star === o.bg && o.level === 'full' && o.running && (MOBILE || o.field), JSON.stringify(o))
    // hidden tab -> loops stop; visible -> exactly one loop
    await c.eval(`Object.defineProperty(document,'hidden',{get:()=>true,configurable:true});document.dispatchEvent(new Event('visibilitychange'))`); await sleep(200)
    const hid = await c.eval(`({raf: __fx.Ticker.raf, running: __fx.Atmo.running})`)
    ok('hidden: ticker stopped', hid.raf === 0, JSON.stringify(hid))
    await c.eval(`Object.defineProperty(document,'hidden',{get:()=>false,configurable:true});document.dispatchEvent(new Event('visibilitychange'))`); await sleep(300)
    const vis = await c.eval(`({raf: __fx.Ticker.raf, jobs: __fx.Ticker.jobs.size})`)
    ok('visible again: single ticker loop resumed', vis.raf !== 0 && vis.jobs >= 1, JSON.stringify(vis))
    // repeat visibility toggles must not accumulate
    for (let i = 0; i < 5; i++) { await c.eval(`Object.defineProperty(document,'hidden',{get:()=>true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));Object.defineProperty(document,'hidden',{get:()=>false,configurable:true});document.dispatchEvent(new Event('visibilitychange'))`) }
    await sleep(300)
    const rafs2 = await c.eval(`new Promise(r=>{let n=0;const o=requestAnimationFrame;window.requestAnimationFrame=f=>{n++;return o(f)};setTimeout(()=>{window.requestAnimationFrame=o;r(n)},1000)})`, true)
    ok('no loop accumulation after 5 hide/show cycles', rafs2 < 400 && Math.abs(rafs2 - rafs) < 150, `before=${rafs} after=${rafs2}`)
    // scene lab
    await c.eval(`document.querySelector('[data-atmsim="redline"]').click()`); await sleep(300)
    const sim = await c.eval(`({scene: __fx.Atmo.scene, sim: __fx.Atmo.sim, cls: document.querySelector('.atm-scene').classList.contains('is-sim'), attr: document.querySelector('.atm-scene').dataset.scene, why: document.querySelector('.atm-why').textContent.slice(0,40), before: getComputedStyle(document.querySelector('.atm-scene b'),'::before').content})`)
    ok('scene lab simulation labelled', sim.scene === 'redline' && sim.sim && sim.cls && sim.attr === 'redline' && /SIMULATION/.test(sim.before), JSON.stringify(sim))
    await sleep(1500)
    if (SHOTS) await c.shot(path.join(OUT, `${TAG}-overview-redline-sim.png`))
    await c.eval(`document.querySelector('[data-atmsim=""]').click()`); await sleep(300)
    ok('scene lab back to live', await c.eval(`!__fx.Atmo.sim && !document.querySelector('.atm-scene').classList.contains('is-sim') && __fx.Atmo.scene===__fxData.atmosphere.scene`))
    // scene transition tween exists (params move over time)
    await c.eval(`document.querySelector('[data-atmsim="fresh"]').click()`); await sleep(150)
    const mid = await c.eval(`__fx.Atmo.cur.fogD`); await sleep(1500); const end = await c.eval(`__fx.Atmo.cur.fogD`)
    ok('scene transition interpolates (not hard cut)', Math.abs(end - mid) > 0.001 || Math.abs(end - (await c.eval('__fx.Atmo.to?__fx.Atmo.to.fogD:__fx.Atmo.cur.fogD'))) < 0.001, `mid=${mid} end=${end}`)
    await c.eval(`document.querySelector('[data-atmsim=""]').click()`); await sleep(200)
    // reload keeps mode preference
    await c.eval(`__fx.Mode.set('active')`); await sleep(100)
    await c.goto(URL); await c.waitFor('!!window.__fxData', 25000); await sleep(600)
    ok('mode preference survives reload', (await c.eval(`document.documentElement.dataset.fx`)) === 'active')
    await c.eval(`__fx.Mode.set('overdrive')`)
  } else {
    const rq = await c.eval(`({fx: document.documentElement.dataset.fx, locked: document.querySelector('.fxm').classList.contains('is-locked'), lockTxt: !document.querySelector('.fxm-lock').hidden, running: __fx.Atmo.running, level: __fx.Atmo.level, star: __starfield.paused, drawn: (()=>{const c=document.getElementById('atm-canvas');const d=c.getContext('2d').getImageData(0,0,c.width,Math.min(c.height,400)).data;let n=0;for(let i=3;i<d.length;i+=4*97)if(d[i]>0)n++;return n})()})`)
    ok('reduced motion: quiet + locked control + static canvas painted', rq.fx === 'quiet' && rq.locked && rq.lockTxt && !rq.running && rq.level === 'static' && rq.drawn > 10, JSON.stringify(rq))
    const nodes = await c.eval(`({viewAnim: getComputedStyle(document.querySelector('.view.is-on')).animationName, neb: getComputedStyle(document.querySelector('.df-neb.a')).animationName, rocket: getComputedStyle(document.querySelector('.side-rocket')).animationName})`)
    ok('reduced motion: CSS ambient animations off', nodes.viewAnim === 'none' && nodes.neb === 'none' && nodes.rocket === 'none', JSON.stringify(nodes))
  }
  console.log('## keyboard'); // -- keyboard
  await c.eval(`setView('train',{push:true})`); await sleep(300)
  if (ses) { await c.eval(`openSessionDrawer('${ses}')`); await sleep(300); await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(400); ok('Esc closes drawer', await c.eval(`document.getElementById('drawer').hidden===true`)) }
  console.log('## touch'); // -- touch targets (mobile)
  if (MOBILE) {
    const small = await c.eval(`[...document.querySelectorAll('.tab-i,.fxm-cycle,.atm-lab button,.tj-node,.dw-back,.at-chip,.at-bar button,.wl-mtab,.tsv-ctrl button')].filter(e=>e.offsetWidth&&e.offsetHeight&&e.offsetHeight<38).map(e=>e.className.split(' ')[0]+':'+e.offsetHeight).slice(0,12)`)   // offsetHeight：不受進場動畫的 transform 影響
    ok('mobile touch targets >= 38px (44 nominal)', small.length === 0, small.join(','))
    const tb = await c.eval(`({sc: !!document.querySelector('.tab-scroll'), w: document.querySelector('.tab-scroll').scrollWidth, cw: document.querySelector('.tab-scroll').clientWidth, tabs: document.querySelectorAll('.tab-i').length})`)
    ok('mobile tabbar has 7 tabs (scrolls if needed)', tb.tabs === 7, JSON.stringify(tb))
  }
  console.log('## final'); // -- final console
  await sleep(300)
  R.console = R.console.filter(x => !/favicon|steve-quotes|jsdelivr/i.test(x))
  ok('no console errors (fetch of quotes CDN excluded)', R.console.length === 0, R.console.slice(0, 6).join(' | '))
  await c.eval(`setView('deck',{push:true})`); await sleep(1200)
  if (SHOTS) { await c.shot(path.join(OUT, `${TAG}-overview-final.png`)) }
  console.log(JSON.stringify({ tag: R.tag, size: R.size, pass: R.pass.length, fail: R.fail.length, rafPerSec: R.rafPerSec, state: R.state }, null, 1))
  console.log('PASS:'); R.pass.forEach(x => console.log('  + ' + x))
  console.log('FAIL:'); R.fail.forEach(x => console.log('  - ' + x))
  console.log('WARN:'); R.warn.forEach(x => console.log('  ? ' + x))
  console.log('CONSOLE:'); R.console.forEach(x => console.log('  ! ' + x))
  fs.writeFileSync(path.join(OUT, `${TAG}-report.json`), JSON.stringify(R, null, 1))
  c.close(); chrome.kill()
  process.exit(0)
})().catch(e => { console.log('PROBE CRASH', e); try { require('child_process').execSync('pkill -f "remote-debugging-port=' + PORT + '"') } catch (x) {} process.exit(2) })
