#!/usr/bin/env node
/* circuit.html ／ data/movements.json 的資料檢查。
   沒有 build step，所以這支是唯一的守門員：ID、參照、數值範圍、分類字彙，
   以及 16＋2 張菜單各自算出來的實際總長。

   估時不重寫一份 —— 直接把 circuit.html 裡 @estimate-core 那一段抽出來 eval，
   兩邊永遠是同一套規則。改了頁面裡的公式，這支跟著變，不會偷偷漂掉。

   用法：node scripts/check-circuit-data.js [--times] */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const db = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/movements.json'), 'utf8'));
const html = fs.readFileSync(path.join(ROOT, 'circuit.html'), 'utf8');

const errs = [], warns = [];
const E = m => errs.push(m);
const W = m => warns.push(m);

/* ── 從頁面抽出估時核心 ── */
const CORE = (() => {
  const a = html.indexOf('/* @estimate-core:start */');
  const b = html.indexOf('/* @estimate-core:end */');
  if (a < 0 || b < 0) { E('circuit.html 找不到 @estimate-core 標記'); return null; }
  return html.slice(a, b);
})();
const READY = 5, SIDE = 5;
const byId = id => db.moves.find(m => m.id === id);
const isTime = u => u === 'time' || u === 'time_each';
const isEach = u => u === 'reps_each' || u === 'time_each';
let estimate = null, blockSecs = null, planFromPreset = null;
if (CORE) {
  const f = new Function('byId', 'isEach', 'isTime', 'SIDE', 'READY',
    CORE + '\nreturn { estimate, blockSecs, stretchSecs, activeBlocks, planFromPreset };');
  const api = f(byId, isEach, isTime, SIDE, READY);
  estimate = api.estimate; blockSecs = api.blockSecs; planFromPreset = api.planFromPreset;
}

/* ── 動作 ── */
const seen = new Set();
const REQ = ['id','zh','en','pattern','tier','unit','default','kw','cue','gear','doms'];
db.moves.forEach(m => {
  REQ.forEach(k => { if (m[k] === undefined) E(`move ${m.id}: 缺欄位 ${k}`); });
  if (seen.has(m.id)) E(`move ${m.id}: ID 重複`);
  seen.add(m.id);
  if (!db.patterns[m.pattern]) E(`move ${m.id}: pattern ${m.pattern} 不存在`);
  if (!/^(C[1-4]|B[12])$/.test(m.tier)) E(`move ${m.id}: tier ${m.tier} 不合法`);
  if (!['time','time_each','reps','reps_each'].includes(m.unit)) E(`move ${m.id}: unit ${m.unit} 不合法`);
  if (!(m.default >= 1 && m.default <= 600)) E(`move ${m.id}: default ${m.default} 超出 1–600`);
  if (!(m.doms >= 0 && m.doms <= 5)) E(`move ${m.id}: doms ${m.doms} 超出 0–5`);
  (m.gear || []).forEach(g => { if (!['dumbbell','kettlebell'].includes(g)) W(`move ${m.id}: 沒看過的器材 ${g}`); });
});

/* ── 菜單 ── */
const CATS = ['full','prepost','targeted','weights'];
const TAGS = ['quiet','no-legs','low-doms','high-doms'];
const pseen = new Set();
/* 轉換也共用頁面那份 planFromPreset —— 只共用估時的話，
   「preset 的 stretches 被轉丟了」這種錯兩邊算出來的數字會不一樣卻都不報錯 */
const norm = x => typeof x === 'string' ? { id:x, amt:(byId(x)||{}).default } : x;
const blocksOf = p => p.blocks
  ? p.blocks.map(b => ({ ...b, moves:(b.moves||[]).map(norm) }))
  : [{ name:'', sets:p.sets, restMove:p.restMove, restSet:p.restSet, moves:(p.moves||[]).map(norm) }];

const rows = [];
db.presets.forEach(p => {
  if (pseen.has(p.id)) E(`preset ${p.id}: ID 重複`);
  pseen.add(p.id);
  ['name','sub','note'].forEach(k => { if (!p[k]) E(`preset ${p.id}: 缺 ${k}`); });
  if (!CATS.includes(p.category)) E(`preset ${p.id}: category ${p.category} 不合法`);
  (p.tags || []).forEach(t => { if (!TAGS.includes(t)) E(`preset ${p.id}: tag ${t} 不在字彙裡`); });
  if (typeof p.featured !== 'boolean') E(`preset ${p.id}: featured 必須是 boolean`);

  const bs = blocksOf(p);
  let nMove = 0, warm = 0;
  bs.forEach((b, i) => {
    const w = `preset ${p.id} block ${b.name || i}`;
    if (!(b.sets >= 1 && b.sets <= 10)) E(`${w}: sets ${b.sets} 超出 1–10`);
    if (!(b.restMove >= 0 && b.restMove <= 180)) E(`${w}: restMove ${b.restMove} 超出 0–180`);
    if (!(b.restSet >= 0 && b.restSet <= 600)) E(`${w}: restSet ${b.restSet} 超出 0–600`);
    if (b.warm) warm++;
    b.moves.forEach(r => {
      const m = byId(r.id);
      if (!m) return E(`${w}: 動作 ${r.id} 不存在`);
      if (m.pattern === 'stretch') E(`${w}: ${r.id} 是伸展，應該放在 stretches`);
      if (!(r.amt >= 1 && r.amt <= 600)) E(`${w}: ${r.id} 的 amt ${r.amt} 超出 1–600`);
      nMove++;
    });
  });
  if (warm > 1) W(`preset ${p.id}: 有 ${warm} 段標了 warm，只做熱身會全部跑`);
  (p.stretches || []).map(norm).forEach(r => {
    const m = byId(r.id);
    if (!m) return E(`preset ${p.id}: 伸展 ${r.id} 不存在`);
    if (m.pattern !== 'stretch') E(`preset ${p.id}: ${r.id} 不是伸展`);
  });
  if (!nMove && !(p.stretches || []).length) E(`preset ${p.id}: 既沒有動作也沒有伸展`);
  if (planFromPreset) {
    const pl = planFromPreset(p);
    if (pl.stretches.length !== (p.stretches || []).length)
      E(`preset ${p.id}: 轉換後伸展 ${pl.stretches.length} 筆，原始 ${(p.stretches||[]).length} 筆`);
    const nb = pl.blocks.reduce((t,b) => t + b.moves.length, 0);
    if (nb !== nMove) E(`preset ${p.id}: 轉換後動作 ${nb} 個，原始 ${nMove} 個`);
  }
  const shift = p.shift != null ? p.shift : 8;
  if (!(shift >= 5 && shift <= 10)) E(`preset ${p.id}: shift ${shift} 超出 5–10`);

  if (estimate) {
    const pl = planFromPreset(p);
    rows.push({ id:p.id, name:p.name, cat:p.category, feat:p.featured,
      secs:estimate(pl, 'full'), warm:warm ? estimate(pl, 'warmup') : 0,
      st:pl.stretches.length ? estimate(pl, 'stretch') : 0, n:nMove, blocks:bs.length });
  }
});

const nFeat = db.presets.filter(p => p.featured).length;
if (nFeat !== 6) E(`精選菜單有 ${nFeat} 張，首屏規格是 6 張`);

/* ── 六張新菜單的估時基準（計畫 §1E-2）──
   計畫寫的 10:45／21:00／22:45／11:35／19:55／15:40 是「收操沒有換位時間」
   那版公式算的。加了每側 5 秒換邊與伸展間 shift 秒之後，含收操的菜單會變長；
   下面是新公式的基準值，收操本身的秒數沒有變。 */
const EXPECT = {
  'quick-full': 658, 'upper-core': 1281, 'home-dumbbell-b1': 1391,
  'ride-primer': 695, 'posterior-hip': 1226, 'ankle-knee': 971,
};
Object.entries(EXPECT).forEach(([id, want]) => {
  const r = rows.find(x => x.id === id);
  if (!r) return E(`找不到菜單 ${id}`);
  if (r.secs !== want) E(`菜單 ${id} 估時 ${r.secs}s，基準是 ${want}s`);
});

const mmss = s => Math.floor(s/60) + ':' + String(Math.round(s%60)).padStart(2,'0');
/* CJK 是全形,padEnd 用字元數會對不齊 —— 照顯示寬度補 */
const wide = s => [...s].reduce((n,c) => n + (c.charCodeAt(0) > 0x2e7f ? 2 : 1), 0);
const pad = (s, n) => s + ' '.repeat(Math.max(1, n - wide(s)));
if (process.argv.includes('--times') || errs.length) {
  console.log('\n' + pad('菜單', 24) + pad('分類', 11) + pad('段', 4) + pad('動作', 7) +
    pad('完整', 9) + pad('只熱身', 9) + '只收操');
  rows.forEach(r => console.log(
    pad(r.name + (r.feat ? ' *' : ''), 24) + pad(r.cat, 11) + pad(String(r.blocks), 4) +
    pad(String(r.n), 7) + pad(mmss(r.secs), 9) + pad(r.warm ? mmss(r.warm) : '-', 9) + (r.st ? mmss(r.st) : '-')));
}
console.log(`\n動作 ${db.moves.length} · 菜單 ${db.presets.length}（精選 ${nFeat}）`);
warns.forEach(w => console.log('  ! ' + w));
if (errs.length) { errs.forEach(e => console.log('  ✗ ' + e)); process.exit(1); }
console.log('✓ 全部通過');
