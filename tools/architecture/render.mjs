/**
 * render.mjs — 把 docs/architecture/src/*.mmd 畫成窄版 SVG。
 *
 * 為什麼要有這支：原本的 5 張架構圖只有 SVG 產物、沒有原始碼，寬度 1435~1684px，
 * 在 GitHub 的內文欄（約 830px）會被壓到 49~58%，13px 的字變成 5~7px，等於看不見。
 * 要重畫卻沒有來源可改 —— 這支連同 src/*.mmd 就是為了不要再發生一次。
 *
 * 用法：node tools/architecture/render.mjs [檔名...]
 *   需要網路（第一次會抓 mermaid bundle 到 .cache/）與本機 Chrome。
 *   不帶參數＝重畫 src/ 底下全部。
 *
 * 硬規則：**產出超過 MAX_W 就是錯的**，會 exit 1。窄到不用點開放大才是這批圖的重點，
 * 太寬就回去把 .mmd 拆小，不要調這個常數。
 */
import { readFile, writeFile, readdir, mkdir, access } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const SRC = path.join(ROOT, 'docs/architecture/src')
const OUT = path.join(ROOT, 'docs/architecture')
const CACHE = path.join(import.meta.dirname, '.cache')
const MERMAID_URL = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const MAX_W = 800          // GitHub 內文欄約 830px，留一點邊
const PORT = 9401

// Tokyo Night。沿用原本那批圖的色票，換掉圖不該連帶換掉文件的視覺語言。
const THEME = {
  background: '#1a1b26', primaryColor: '#24283b', primaryTextColor: '#c0caf5',
  primaryBorderColor: '#3d59a1', lineColor: '#7aa2f7', secondaryColor: '#1f2335',
  tertiaryColor: '#1f2335', textColor: '#a9b1d6', fontSize: '15px',
  fontFamily: '-apple-system,"Noto Sans TC","PingFang TC",system-ui,sans-serif',
  nodeBorder: '#3d59a1', clusterBkg: '#16161e', clusterBorder: '#3d59a1',
  titleColor: '#7aa2f7', edgeLabelBackground: '#1a1b26',
  actorBkg: '#24283b', actorBorder: '#3d59a1', actorTextColor: '#c0caf5',
  signalColor: '#a9b1d6', signalTextColor: '#a9b1d6',
  labelBoxBkg: '#24283b', labelBoxBorderColor: '#3d59a1', labelTextColor: '#c0caf5',
  loopTextColor: '#a9b1d6', noteBkgColor: '#2a2e3f', noteTextColor: '#c0caf5',
  noteBorderColor: '#565f89', sequenceNumberColor: '#1a1b26',
}

async function mermaidSource() {
  await mkdir(CACHE, { recursive: true })
  const f = path.join(CACHE, 'mermaid.min.js')
  try { await access(f) } catch {
    process.stderr.write('抓 mermaid bundle…\n')
    const r = await fetch(MERMAID_URL)
    if (!r.ok) throw new Error('抓 mermaid 失敗: ' + r.status)
    await writeFile(f, Buffer.from(await r.arrayBuffer()))
  }
  return readFile(f, 'utf8')
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function connect() {
  const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless=new',
    '--disable-gpu', '--no-sandbox', `--user-data-dir=${CACHE}/profile`, 'about:blank'],
    { stdio: 'ignore' })
  let list
  for (let i = 0; i < 60; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (list.length) break } catch {}
    await sleep(250)
  }
  if (!list?.length) { chrome.kill(); throw new Error('連不上 headless Chrome') }
  const ws = new WebSocket(list[0].webSocketDebuggerUrl)
  await new Promise(r => ws.onopen = r)
  let id = 0; const pend = new Map()
  ws.onmessage = e => { const m = JSON.parse(e.data); if (pend.has(m.id)) pend.get(m.id)(m) }
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    const rr = r.result || {}
    if (rr.exceptionDetails) throw new Error(rr.exceptionDetails.exception?.description || rr.exceptionDetails.text)
    return rr.result?.value
  }
  await send('Runtime.enable'); await send('Page.enable')
  return { evaluate, send, close: () => { ws.close(); chrome.kill() } }
}

async function main() {
  await mermaidSource()
  const want = process.argv.slice(2)
  const files = (await readdir(SRC)).filter(f => f.endsWith('.mmd'))
    .filter(f => !want.length || want.some(w => f.includes(w))).sort()
  if (!files.length) { console.error('src/ 裡沒有符合的 .mmd'); process.exit(1) }

  // 3.5MB 的 bundle 不要透過 Runtime.evaluate 的字串塞進去（CDP 訊息會爆），
  // 寫一個 file:// 的載入頁、用一般的 <script src> 引同目錄的檔案最穩。
  await writeFile(path.join(CACHE, 'render.html'),
    '<!doctype html><meta charset="utf-8"><script src="mermaid.min.js"></' + 'script><body></body>', 'utf8')
  const br = await connect()
  await br.send('Page.navigate', { url: 'file://' + path.join(CACHE, 'render.html') })
  let loaded = false
  for (let i = 0; i < 60; i++) {
    await sleep(200)
    if (await br.evaluate(`typeof mermaid === 'object' && !!mermaid.render`)) { loaded = true; break }
  }
  if (!loaded) { br.close(); throw new Error('mermaid bundle 載入失敗') }
  // htmlLabels **一定要關**：開著的話 node 標籤會變成 <foreignObject>，
  // 而 SVG 被 Markdown 當 <img> 載入時 foreignObject 完全不渲染 —— 圖上會只剩線和箭頭。
  // 這個要在 root 和 flowchart 兩層都設，只設一層 mermaid 11 仍會用 HTML 標籤。
  await br.evaluate(`mermaid.initialize({startOnLoad:false,theme:'base',darkMode:true,
    securityLevel:'loose',htmlLabels:false,
    flowchart:{htmlLabels:false,curve:'basis',padding:14,nodeSpacing:34,rankSpacing:44,wrappingWidth:460},
    sequence:{useMaxWidth:false,width:150,boxMargin:8,mirrorActors:false},
    themeVariables:${JSON.stringify(THEME)}});1`)

  let bad = 0
  for (const f of files) {
    const src = await readFile(path.join(SRC, f), 'utf8')
    let svg
    try {
      svg = await br.evaluate(`mermaid.render('d'+Date.now(), ${JSON.stringify(src)}).then(r=>r.svg)`)
    } catch (e) { console.error(`✗ ${f}: ${String(e.message).slice(0, 200)}`); bad++; continue }

    // mermaid 預設吐 style="max-width:...px" 且沒有 width/height。
    // Markdown 需要固定的 intrinsic 尺寸，否則不同 renderer 行為不一致。
    const vb = svg.match(/viewBox="([\d.\-\s]+)"/)
    if (!vb) { console.error(`✗ ${f}: 產出沒有 viewBox`); bad++; continue }
    const [, , w, h] = vb[1].trim().split(/\s+/).map(Number)
    const W = Math.ceil(w), H = Math.ceil(h)
    svg = svg.replace(/<svg([^>]*)>/, (m0, attrs) => {
      attrs = attrs.replace(/\s(width|height|style)="[^"]*"/g, '')
      return `<svg${attrs} width="${W}" height="${H}" style="background:${THEME.background}">`
    })
    if (svg.includes('<foreignObject')) {
      console.error(`✗ ${f}: 產出含 foreignObject，當成 <img> 載入時會空白`); bad++; continue
    }
    const outName = f.replace(/\.mmd$/, '.svg')
    await writeFile(path.join(OUT, outName), svg, 'utf8')
    const ok = W <= MAX_W
    if (!ok) bad++
    console.log(`${ok ? '✓' : '✗ 太寬'} ${outName.padEnd(34)} ${W}×${H}${ok ? '' : `  ← 超過 ${MAX_W}px，把 .mmd 拆小`}`)
  }
  br.close()
  process.exit(bad ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
