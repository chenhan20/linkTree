#!/usr/bin/env node
// scripts/gen-theme-fx.js — 為每個主題產生獨立的 fx CSS（power card + hover + bodymap accent）
// 不再共用 power-card-glow.css / card-hover.css / halo-hover.css，避免橘色殘留
const fs = require('fs')
const path = require('path')

const THEMES = [
  { key:'strava', accent:'#FC4C02', soft:'rgba(252,76,2,.18)', glow:'rgba(252,76,2,.55)', cardId:'hero-power-card', miniPx:'hpc' },
  { key:'maple',  accent:'#c54a0d', soft:'rgba(197,74,13,.2)', glow:'rgba(197,74,13,.55)', cardId:'maple-power-card', miniPx:'mpc' },
  { key:'aespa',  accent:'#a855f7', soft:'rgba(168,85,247,.2)', glow:'rgba(168,85,247,.6)', cardId:'aespa-power-card', miniPx:'apc' },
  { key:'halo',   accent:'#d4a72c', soft:'rgba(212,167,44,.18)', glow:'rgba(212,167,44,.55)', cardId:'hero-power-card', miniPx:'hpc' },
  { key:'lol',    accent:'#c89b3c', soft:'rgba(200,155,60,.2)', glow:'rgba(200,155,60,.55)', cardId:'lol-power-card', miniPx:'lpc' },
  { key:'cs',     accent:'#c8a800', soft:'rgba(200,168,0,.18)', glow:'rgba(200,168,0,.55)', cardId:'cs-power-card', miniPx:'cpc' },
]

function tpl(t) {
  const T = t.key.toUpperCase()
  return `/* theme-${t.key}.css — ${t.key} 專屬視覺 fx（不與其他主題共用，避免色彩污染）
 * 生成自 scripts/gen-theme-fx.js（請勿手動修改；改完請重跑）
 */
:root{
  --bp-on-color: ${t.accent};
  --bp-on-glow:  ${t.glow};
}

/* ── Power Card Glow：榮譽榜呼吸＋掃光＋角點＋獎盃＋CTA ── */
@keyframes ${t.key}-pcg-glow{
  0%,100%{box-shadow:0 0 18px ${t.soft},0 0 0 1px ${t.soft} inset}
  50%   {box-shadow:0 0 36px ${t.accent},0 0 0 1.5px ${t.accent} inset, 0 0 60px ${t.soft}}
}
@keyframes ${t.key}-pcg-sweep{
  0%{transform:translateX(-150%) skewX(-25deg)}
  100%{transform:translateX(250%) skewX(-25deg)}
}
@keyframes ${t.key}-pcg-cta-pulse{
  0%,100%{transform:translateY(0);text-shadow:0 0 6px ${t.soft}}
  50%   {transform:translateY(-2px);text-shadow:0 0 14px ${t.accent},0 0 30px ${t.soft}}
}
@keyframes ${t.key}-pcg-arrow-bounce{
  0%,100%{transform:translateY(0)}
  50%   {transform:translateY(3px)}
}
@keyframes ${t.key}-pcg-corner-blink{
  0%,100%{opacity:.85}
  50%   {opacity:.25}
}
@keyframes ${t.key}-pcg-trophy-spin{
  0%,100%{transform:rotate(-8deg) scale(1)}
  50%   {transform:rotate(8deg) scale(1.15)}
}

#${t.cardId}{
  position:relative;
  padding:22px 22px 20px !important;
  border-radius:14px !important;
  animation:${t.key}-pcg-glow 2.6s ease-in-out infinite;
  overflow:hidden;
  isolation:isolate;
}
#${t.cardId}::before{
  content:"";position:absolute;top:0;left:0;height:100%;width:35%;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.18),transparent);
  pointer-events:none;
  animation:${t.key}-pcg-sweep 3.8s ease-in-out infinite;
  z-index:0;
}
#${t.cardId} .${t.miniPx}-title{
  font-size:18px !important;letter-spacing:2.5px !important;
  font-weight:800 !important;text-shadow:0 0 10px ${t.soft};
}
#${t.cardId} .${t.miniPx}-title-en{
  font-size:11px !important;letter-spacing:3.5px !important;
}
#${t.cardId} .${t.miniPx}-mini{padding:9px 4px !important}
#${t.cardId} .${t.miniPx}-mini-lbl{font-size:11px !important;letter-spacing:.5px !important}
#${t.cardId} .${t.miniPx}-mini-val{
  font-size:20px !important;font-weight:800 !important;
  text-shadow:0 0 8px ${t.soft};
}
#${t.cardId} .${t.miniPx}-mini-val small{font-size:10px !important}

/* 角點＋獎盃 — 由 power-card-glow.js 注入的 .pcg-corner / .pcg-trophy */
#${t.cardId} .pcg-corner{
  position:absolute;width:14px;height:14px;
  border:2px solid ${t.accent};
  pointer-events:none;z-index:1;
  animation:${t.key}-pcg-corner-blink 2.6s ease-in-out infinite;
}
#${t.cardId} .pcg-corner.tl{top:6px;left:6px;border-right:none;border-bottom:none}
#${t.cardId} .pcg-corner.tr{top:6px;right:6px;border-left:none;border-bottom:none;animation-delay:.65s}
#${t.cardId} .pcg-corner.bl{bottom:6px;left:6px;border-right:none;border-top:none;animation-delay:1.3s}
#${t.cardId} .pcg-corner.br{bottom:6px;right:6px;border-left:none;border-top:none;animation-delay:1.95s}
#${t.cardId} .pcg-trophy{
  position:absolute;top:-8px;right:14px;font-size:24px;line-height:1;
  filter:drop-shadow(0 0 8px ${t.accent});
  animation:${t.key}-pcg-trophy-spin 1.6s ease-in-out infinite;
  pointer-events:none;z-index:2;
}
#${t.cardId} .pcg-cta{
  display:flex;align-items:center;justify-content:center;gap:10px;
  margin-top:14px;padding:10px 16px;
  font-size:14px;font-weight:800;letter-spacing:2px;
  color:${t.accent};
  background:linear-gradient(90deg,transparent,${t.soft},transparent);
  border-top:1px solid ${t.soft};border-bottom:1px solid ${t.soft};
  border-radius:6px;text-transform:uppercase;
  animation:${t.key}-pcg-cta-pulse 1.6s ease-in-out infinite;
  cursor:pointer;user-select:none;position:relative;z-index:1;
}
#${t.cardId} .pcg-cta .arrow{
  display:inline-block;font-size:18px;
  animation:${t.key}-pcg-arrow-bounce 1.1s ease-in-out infinite;
}
#${t.cardId} .pcg-cta .star{
  display:inline-block;
  animation:${t.key}-pcg-trophy-spin 1.6s ease-in-out infinite reverse;
}
#${t.cardId} > *:not(.pcg-corner):not(.pcg-trophy){position:relative;z-index:1}

/* ── Card hover：使用 ${t.key} 主題色，不再 fallback 到橘色 ── */
.stat-card,.consistency-row,.quest-tile,.wq-tile,.seg-card,.activity-card,.act-card,
.am-cell,.am-lap,.am-itt-item{
  transition:transform .22s cubic-bezier(.2,1,.4,1), border-color .2s ease,
             box-shadow .25s ease, background-color .2s ease;
}
.stat-card:hover,.consistency-row:hover,.quest-tile:hover,.wq-tile:hover,
.seg-card:hover,.activity-card:hover,.act-card:hover,
.am-cell:hover,.am-lap:hover,.am-itt-item:hover{
  transform:translateY(-2px);
  border-color:${t.accent} !important;
  box-shadow:0 6px 18px -4px rgba(0,0,0,.45),0 0 18px ${t.soft};
}
.section-title{position:relative;transition:color .2s ease,text-shadow .2s ease}
.section-title::after{
  content:"";position:absolute;left:0;right:0;bottom:0;height:1px;
  background:linear-gradient(90deg,transparent,${t.accent},transparent);
  transform:scaleX(0);transform-origin:center;
  transition:transform .35s cubic-bezier(.2,1,.4,1);
}
.section-title:hover{text-shadow:0 0 8px ${t.soft}}
.section-title:hover::after{transform:scaleX(1)}
.lap-strip:hover{
  border-color:${t.accent} !important;transform:translateX(2px);
  transition:all .2s ease;
}

@media (prefers-reduced-motion:reduce){
  #${t.cardId},#${t.cardId}::before,
  #${t.cardId} .pcg-corner,#${t.cardId} .pcg-trophy,
  #${t.cardId} .pcg-cta,#${t.cardId} .pcg-cta .arrow,#${t.cardId} .pcg-cta .star,
  .stat-card,.consistency-row,.quest-tile,.wq-tile,.seg-card,.activity-card,.act-card,
  .section-title,.section-title::after,.lap-strip{animation:none;transition:none}
}
@media (max-width:560px){
  #${t.cardId}{padding:16px 14px 14px !important}
  #${t.cardId} .${t.miniPx}-title{font-size:15px !important}
  #${t.cardId} .pcg-cta{font-size:12px;padding:8px 10px;letter-spacing:1.5px}
  #${t.cardId} .pcg-trophy{font-size:18px}
}
`
}

const root = path.join(__dirname, '..')
for (const t of THEMES) {
  const out = path.join(root, `theme-${t.key}.css`)
  fs.writeFileSync(out, tpl(t), 'utf8')
  console.log('✅ wrote', out)
}
