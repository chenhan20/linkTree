/* baseline: original strava.html overflow per view + rAF/s, at a given size */
const { launch, CDP, sleep } = require('./cdp-lib.js')
const [W, H, MOBILE] = [+process.argv[2] || 1440, +process.argv[3] || 1000, process.argv[4] === '1']
;(async () => {
  const PORT = 9700 + Math.floor(Math.random() * 200)
  const chrome = await launch(PORT, W, H); const c = await CDP.open(PORT)
  await c.send('Page.enable'); await c.send('Runtime.enable'); await c.send('Network.enable'); await c.send('Network.setCacheDisabled', { cacheDisabled: true })
  await c.viewport(W, H, MOBILE)
  await c.goto('http://127.0.0.1:8765/strava.html')
  await c.waitFor('!!window.__harvest && document.querySelector("#content .view")', 25000); await sleep(1500)
  const out = { size: `${W}x${H}${MOBILE ? ' mobile' : ''}` }
  out.raf = await c.eval(`new Promise(r=>{let n=0;const o=requestAnimationFrame;window.requestAnimationFrame=f=>{n++;return o(f)};setTimeout(()=>{window.requestAnimationFrame=o;r(n)},1000)})`, true)
  for (const v of ['overview', 'plan', 'log', 'itt', 'playbook', 'atlas', 'trends', 'harvest', 'body']) {
    await c.eval(`setView('${v}',{push:true})`); await sleep(v === 'atlas' ? 2000 : 700)
    out[v] = await c.eval('document.documentElement.scrollWidth - innerWidth')
  }
  console.log(JSON.stringify(out))
  c.close(); chrome.kill(); process.exit(0)
})().catch(e => { console.log('BASE CRASH', e); process.exit(2) })
