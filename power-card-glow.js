/* power-card-glow.js — 自動為 6 個主題的功率卡片注入榮譽榜裝飾
 * 不修改原本的 click→openModal 綁定，只在卡片內加入裝飾元素 + CTA bar。
 * CTA bar 點擊會冒泡到卡片，觸發既有的 openPowerModal。
 */
(function () {
  'use strict'
  const SELECTORS = [
    '#hero-power-card',
    '#maple-power-card',
    '#cs-power-card',
    '#aespa-power-card',
    '#lol-power-card',
  ]

  function decorate(card) {
    if (!card || card.dataset.pcgDone) return
    card.dataset.pcgDone = '1'

    // 4 個邊角閃爍框
    ;['tl', 'tr', 'bl', 'br'].forEach(p => {
      const c = document.createElement('span')
      c.className = 'pcg-corner ' + p
      card.appendChild(c)
    })

    // 浮動獎盃
    const trophy = document.createElement('span')
    trophy.className = 'pcg-trophy'
    trophy.textContent = '🏆'
    card.appendChild(trophy)

    // CTA bar
    const cta = document.createElement('div')
    cta.className = 'pcg-cta'
    cta.innerHTML = '<span class="star">✨</span><span>點我看完整排行</span><span class="arrow">▾</span>'
    cta.setAttribute('role', 'button')
    cta.setAttribute('tabindex', '0')
    // 點擊冒泡讓既有的卡片 click handler 觸發 openModal
    cta.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.click() }
    })
    card.appendChild(cta)
  }

  function scan() {
    SELECTORS.forEach(sel => {
      const el = document.querySelector(sel)
      if (el) decorate(el)
    })
  }

  function init() {
    scan()
    const obs = new MutationObserver(() => scan())
    obs.observe(document.body, { childList: true, subtree: true })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})()
