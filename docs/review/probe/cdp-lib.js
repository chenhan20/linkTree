/* headless Chrome + CDP helper (Node 24 built-in WebSocket). ASCII-only output. */
const { spawn } = require('child_process')
const fs = require('fs')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function launch(port, W, H) {
  const dir = `/tmp/fxchrome-${port}`
  const p = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check',
    '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--hide-scrollbars', `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' })
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) return p } catch (e) {} await sleep(250) }
  throw new Error('chrome did not start')
}
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pend = new Map(); this.handlers = {}; ws.onmessage = e => this.onmsg(JSON.parse(e.data)) }
  static async open(port) {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
    const t = list.find(x => x.type === 'page')
    const ws = new WebSocket(t.webSocketDebuggerUrl)
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
    return new CDP(ws)
  }
  onmsg(m) {
    if (m.id && this.pend.has(m.id)) { const { res, rej } = this.pend.get(m.id); this.pend.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); return }
    if (m.method && this.handlers[m.method]) this.handlers[m.method].forEach(h => h(m.params))
  }
  on(method, fn) { (this.handlers[method] = this.handlers[method] || []).push(fn) }
  send(method, params) { const id = ++this.id; return new Promise((res, rej) => { const tm = setTimeout(() => { if (this.pend.has(id)) { this.pend.delete(id); rej(new Error('CDP timeout: ' + method)) } }, 40000); this.pend.set(id, { res: v => { clearTimeout(tm); res(v) }, rej: e => { clearTimeout(tm); rej(e) } }); this.ws.send(JSON.stringify({ id, method, params: params || {} })) }) }
  async eval(expr, awaitPromise) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: !!awaitPromise })
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text))
    return r.result.value
  }
  async waitFor(expr, timeout, step) { const t0 = Date.now(); while (Date.now() - t0 < (timeout || 15000)) { try { if (await this.eval(expr)) return true } catch (e) {} await sleep(step || 120) } return false }
  async shot(path, full) {
    const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !!full })
    fs.writeFileSync(path, Buffer.from(r.data, 'base64')); return path
  }
  async viewport(W, H, mobile) {
    await this.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: mobile ? 2 : 1, mobile: !!mobile })
    if (mobile) await this.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  }
  async goto(url) { await this.send('Page.navigate', { url }) }
  close() { try { this.ws.close() } catch (e) {} }
}
module.exports = { launch, CDP, sleep }
