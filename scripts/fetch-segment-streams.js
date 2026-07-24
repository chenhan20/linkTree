#!/usr/bin/env node
// ── 抓 ITT 區段的官方路線 stream（latlng + altitude + distance）──
// 給 strava.html 的區段卡迷你 3D 用。區段路線不會變，抓一次存檔即可；
// 新增區段到 itt-config.json 後重跑一次本腳本。
// 用法：node scripts/fetch-segment-streams.js
const fs = require('fs')
const path = require('path')
const https = require('https')

// 本機：自動讀取 scripts/.env（與 fetch-strava.js 同樣寫法）
const envFile = path.join(__dirname, '.env')
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split(/\r?\n/).forEach(line => {
    const trimmed = line.replace(/^﻿/, '').trim()
    if (!trimmed || trimmed.startsWith('#')) return
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx < 1) return
    const k = trimmed.slice(0, eqIdx).trim()
    const v = trimmed.slice(eqIdx + 1).trim()
    if (k && v && !process.env[k]) process.env[k] = v
  })
  console.log('📁 已從 scripts/.env 讀取設定（本機模式）')
}

const CLIENT_ID     = process.env.STRAVA_CLIENT_ID
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET
const REFRESH_TOKEN = process.env.STRAVA_REFRESH_TOKEN

const CONFIG_FILE = path.join(__dirname, '..', 'data', 'itt-config.json')
const OUT_FILE    = path.join(__dirname, '..', 'data', 'segment-streams.json')

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
        catch (e) { reject(new Error('JSON parse error: ' + Buffer.concat(chunks).toString('utf8'))) }
      })
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

async function getAccessToken() {
  const body = new URLSearchParams({
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: REFRESH_TOKEN,
    grant_type:    'refresh_token',
  }).toString()
  const data = await request({
    hostname: 'www.strava.com',
    path:     '/oauth/token',
    method:   'POST',
    headers:  {
      'Content-Type':   'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
    },
  }, body)
  if (!data.access_token) throw new Error('Token 換取失敗：' + JSON.stringify(data))
  console.log('✅ access_token 取得成功')
  return data.access_token
}

// 區段 stream：回傳 [[lat, lng, elev(m)], ...]，downsample 至 ≤140 點
async function fetchSegmentStream(token, segId) {
  const data = await request({
    hostname: 'www.strava.com',
    path:     `/api/v3/segments/${segId}/streams?keys=latlng,altitude,distance&key_by_type=true`,
    method:   'GET',
    headers:  { Authorization: `Bearer ${token}` },
  })
  const latlng = data.latlng?.data   || []
  const alt    = data.altitude?.data || []
  const n = latlng.length
  if (n < 2) return null
  const target = 140
  const step = n <= target ? 1 : (n - 1) / (target - 1)
  const indices = n <= target
    ? Array.from({ length: n }, (_, i) => i)
    : Array.from({ length: target }, (_, i) => Math.round(i * step))
  return indices.map(i => [
    Math.round(latlng[i][0] * 1e5) / 1e5,
    Math.round(latlng[i][1] * 1e5) / 1e5,
    alt[i] != null ? Math.round(alt[i] * 10) / 10 : null,
  ])
}

async function main() {
  for (const [k, v] of Object.entries({ CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN })) {
    if (!v) { console.error(`❌ 缺少環境變數 ${k}`); process.exit(1) }
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
  let existing = {}
  if (fs.existsSync(OUT_FILE)) {
    try { existing = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')) } catch (e) { /* 讀失敗當空 */ }
  }
  const todo = config.segments.filter(s => !existing[s.id])
  if (todo.length === 0) {
    console.log('✅ 所有區段皆已有 stream 快取，無需抓取')
    return
  }
  const token = await getAccessToken()
  for (const seg of todo) {
    await new Promise(r => setTimeout(r, 380))
    try {
      const pts = await fetchSegmentStream(token, seg.id)
      if (pts) {
        existing[seg.id] = { name: seg.nameZh, pts }
        console.log(`  🏔  ${seg.nameZh} (${seg.id})：${pts.length} pts`)
      } else {
        console.log(`  ⚠️  ${seg.nameZh} (${seg.id})：無 stream`)
      }
    } catch (e) {
      console.warn(`  ⚠️  ${seg.nameZh} (${seg.id}) 失敗：${e.message}`)
    }
  }
  fs.writeFileSync(OUT_FILE, JSON.stringify(existing))
  console.log(`✅ 寫入 ${OUT_FILE}（${Object.keys(existing).length} 區段）`)
}

main().catch(e => { console.error('❌', e); process.exit(1) })
