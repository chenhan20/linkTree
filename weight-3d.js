/* weight-3d.js — 重訓任務 Three.js 3D 場景
 * 自動偵測重訓 quest tile，注入 Three.js 3D 場景。
 *
 * ================================================================
 * MODEL_PATH: 換成 .glb 路徑即可更換模型，其他程式不需要修改。
 *   e.g.  const MODEL_PATH = 'athlete/eren.glb'
 *         設為 null → 使用內建「樂高戰士」程序模型
 * ================================================================
 */
;(function () {
  'use strict'

  // ================================================================
  // ↓ 換模型只改這一行
  // ================================================================
  const MODEL_PATH = null   // e.g. 'athlete/eren.glb'

  const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.min.js'
  const SCENE_H = 160  // px

  // GLB 載入等待逾時設定（總時長 = LOAD_POLL_INTERVAL × LOAD_MAX_TRIES）
  const LOAD_POLL_INTERVAL = 250   // ms
  const LOAD_MAX_TRIES     = 120   // 30 秒逾時

  // 重訓 tile 辨識關鍵字（支援 emoji、英文及中文）
  const WEIGHT_TILE_MATCHERS = [
    function (txt) { return txt.indexOf('🏋') !== -1 },
    function (txt) { return /\bTRAIN\b|\bGYM\b/.test(txt) },
    function (txt) { return txt.indexOf('重訓') !== -1 },
  ]

  // ── 樂高戰士色調（Strava orange 系） ──────────────────────────────
  const C_HEAD   = 0xFFCC80
  const C_BODY   = 0xFC4C02
  const C_LIMB   = 0xD03800
  const C_ACCENT = 0xFF7040

  // ── 建立「樂高戰士」程序模型 ──────────────────────────────────────
  function buildLegoWarrior(T) {
    const g = new T.Group()
    const mat = c => new T.MeshPhongMaterial({ color: c, shininess: 80 })

    // 頭
    const head = new T.Mesh(new T.BoxGeometry(.68, .68, .68), mat(C_HEAD))
    head.position.y = 2.05
    g.add(head)

    // 頭頂柱（Lego 特色）
    const stud = new T.Mesh(new T.CylinderGeometry(.18, .18, .12, 10), mat(C_HEAD))
    stud.position.y = 2.44
    g.add(stud)

    // 頸
    const neck = new T.Mesh(new T.CylinderGeometry(.16, .2, .2, 10), mat(C_HEAD))
    neck.position.y = 1.66
    g.add(neck)

    // 軀幹
    const torso = new T.Mesh(new T.BoxGeometry(.88, 1.0, .52), mat(C_BODY))
    torso.position.y = 1.1
    g.add(torso)

    // 腰
    const hips = new T.Mesh(new T.BoxGeometry(.84, .28, .5), mat(C_LIMB))
    hips.position.y = 0.56
    g.add(hips)

    // 手臂（左右各一，回傳用於動畫）
    function mkArm(x) {
      const arm = new T.Mesh(new T.BoxGeometry(.28, .88, .28), mat(C_LIMB))
      arm.position.set(x, 1.05, 0)
      g.add(arm)
      const fist = new T.Mesh(new T.BoxGeometry(.3, .3, .3), mat(C_ACCENT))
      fist.position.set(x, .56, 0)
      g.add(fist)
      return arm
    }
    const lArm = mkArm(-.62)
    const rArm = mkArm( .62)

    // 腿（左右各一）
    function mkLeg(x) {
      const leg = new T.Mesh(new T.BoxGeometry(.38, 1.0, .4), mat(C_BODY))
      leg.position.set(x, -.26, 0)
      g.add(leg)
      const foot = new T.Mesh(new T.BoxGeometry(.42, .2, .56), mat(C_LIMB))
      foot.position.set(x, -.8, .08)
      g.add(foot)
      return leg
    }
    const lLeg = mkLeg(-.24)
    const rLeg = mkLeg( .24)

    // 眼睛
    const eyeMat = new T.MeshPhongMaterial({ color: 0x000000 })
    function mkEye(ex) {
      const e = new T.Mesh(new T.SphereGeometry(.07, 8, 8), eyeMat)
      e.position.set(ex, 2.06, .35)
      g.add(e)
    }
    mkEye(-.13)
    mkEye( .13)

    // 嘴巴
    const mouth = new T.Mesh(
      new T.BoxGeometry(.22, .05, .04),
      new T.MeshPhongMaterial({ color: 0x3a0000 })
    )
    mouth.position.set(0, 1.93, .35)
    g.add(mouth)

    // 儲存動畫用參考
    g.userData.lArm = lArm
    g.userData.rArm = rArm
    g.userData.lLeg = lLeg
    g.userData.rLeg = rLeg
    g.userData.head = head

    return g
  }

  // ── 載入 GLB 模型（MODEL_PATH 不為 null 時呼叫） ──────────────────
  // 使用動態 ES module 載入 GLTFLoader；
  // 同時以 three.module.js 取得與 GLTFLoader 相容的 THREE instance。
  // 當 MODEL_PATH=null 時此函式不會被呼叫，僅作為架構骨架保留。
  function loadGLBModel(path, onLoad, onError) {
    const s = document.createElement('script')
    s.type = 'module'
    s.textContent = [
      "import * as T from 'https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.module.js';",
      "import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.158.0/examples/jsm/loaders/GLTFLoader.js';",
      "window.__w3d_three = T;",
      "new GLTFLoader().load(" + JSON.stringify(path) + ",",
      "  g => { window.__w3d_gltf = g; },",
      "  undefined,",
      "  e => { window.__w3d_gltf_err = String(e); }",
      ");"
    ].join('\n')
    document.head.appendChild(s)

    let tries = 0
    const timer = setInterval(function () {
      if (window.__w3d_gltf) {
        clearInterval(timer)
        const gltf = window.__w3d_gltf
        const threeInstance = window.__w3d_three
        delete window.__w3d_gltf
        onLoad(gltf, threeInstance)
      } else if (window.__w3d_gltf_err || ++tries > LOAD_MAX_TRIES) {
        clearInterval(timer)
        const err = window.__w3d_gltf_err || 'timeout'
        delete window.__w3d_gltf_err
        onError(new Error(err))
      }
    }, LOAD_POLL_INTERVAL)
  }

  // ── 初始化 Three.js 場景 ──────────────────────────────────────────
  function initScene(T, container, model) {
    const W = container.offsetWidth || 160

    const renderer = new T.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setSize(W, SCENE_H)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(renderer.domElement)

    const scene = new T.Scene()

    const cam = new T.PerspectiveCamera(36, W / SCENE_H, 0.1, 100)
    cam.position.set(0, 1.0, 8)
    cam.lookAt(0, 0.9, 0)

    // 光源
    scene.add(new T.AmbientLight(0xffffff, 0.55))

    const sun = new T.DirectionalLight(0xffeedd, 1.4)
    sun.position.set(2, 6, 5)
    scene.add(sun)

    const fill = new T.DirectionalLight(0x4060ff, 0.3)
    fill.position.set(-3, 2, -3)
    scene.add(fill)

    const rim = new T.DirectionalLight(0xFF7040, 0.45)
    rim.position.set(0, -1, -4)
    scene.add(rim)

    // 腳底光圈
    const ring = new T.Mesh(
      new T.RingGeometry(.5, .9, 40),
      new T.MeshBasicMaterial({ color: 0xFC4C02, side: T.DoubleSide, transparent: true, opacity: .25 })
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.y = -1.0
    scene.add(ring)

    // 置中模型
    scene.add(model)
    const box = new T.Box3().setFromObject(model)
    const center = new T.Vector3()
    box.getCenter(center)
    model.position.sub(center)
    model.position.y -= 0.1

    // 響應式縮放
    const ro = new ResizeObserver(function () {
      const nW = container.offsetWidth
      if (!nW) return
      renderer.setSize(nW, SCENE_H)
      cam.aspect = nW / SCENE_H
      cam.updateProjectionMatrix()
    })
    ro.observe(container)

    return { scene, cam, renderer, ring }
  }

  // ── 動畫迴圈 ─────────────────────────────────────────────────────
  function startAnimation(scene, cam, renderer, model, ring) {
    const ud = model.userData

    function loop() {
      requestAnimationFrame(loop)
      const t = performance.now() / 1000

      // 原地左右轉
      model.rotation.y = Math.sin(t * 0.4) * 0.35

      // 呼吸（輕微 Y scale）
      model.scale.y = 1 + Math.sin(t * 1.2) * 0.012

      // 手臂擺動
      if (ud.lArm) ud.lArm.rotation.x =  Math.sin(t * 1.1) * 0.18
      if (ud.rArm) ud.rArm.rotation.x = -Math.sin(t * 1.1) * 0.18

      // 腿部微偏
      if (ud.lLeg) ud.lLeg.rotation.x =  Math.sin(t * 1.1) * 0.06
      if (ud.rLeg) ud.rLeg.rotation.x = -Math.sin(t * 1.1) * 0.06

      // 頭部左右晃
      if (ud.head) ud.head.rotation.y = Math.sin(t * 0.6) * 0.15

      // 光圈脈動
      if (ring) ring.material.opacity = 0.18 + Math.abs(Math.sin(t * 1.2)) * 0.2

      renderer.render(scene, cam)
    }

    loop()
  }

  // ── 注入至重訓 quest tile ────────────────────────────────────────
  function injectIntoTile(tile, T) {
    if (tile.dataset.w3dDone) return
    tile.dataset.w3dDone = '1'

    // 移除舊 SVG bodymap（如有）
    tile.querySelectorAll('.bodymap-wrap, .qprog-wrap, .qpct, .qprog-or').forEach(function (n) { n.remove() })

    // Three.js 容器
    const wrap = document.createElement('div')
    wrap.className = 'w3d-wrap'
    tile.appendChild(wrap)

    function setup(model) {
      const { scene, cam, renderer, ring } = initScene(T, wrap, model)
      startAnimation(scene, cam, renderer, model, ring)
    }

    if (MODEL_PATH) {
      // 載入 .glb 模型（目前 MODEL_PATH=null，保留此路徑供未來換模型）
      loadGLBModel(MODEL_PATH, function (gltf, threeInstance) {
        // 使用載入模型的 THREE instance（確保與 GLTFLoader 同版本）
        var activeThree = threeInstance || T
        var model = gltf.scene
        // GLB rig 動畫骨架需自行對接；先清空 userData 讓動畫降級為整體旋轉
        model.userData.lArm = null
        model.userData.rArm = null
        model.userData.lLeg = null
        model.userData.rLeg = null
        model.userData.head = null
        const { scene, cam, renderer, ring } = initScene(activeThree, wrap, model)
        startAnimation(scene, cam, renderer, model, ring)
      }, function (err) {
        console.warn('[weight-3d] GLB 載入失敗，改用樂高戰士', err)
        setup(buildLegoWarrior(T))
      })
    } else {
      setup(buildLegoWarrior(T))
    }
  }

  // ── 找到重訓 quest tile ──────────────────────────────────────────
  function findWeightTile() {
    var tiles = document.querySelectorAll('.quest-tile, .wq-tile')
    for (var i = 0; i < tiles.length; i++) {
      var txt = tiles[i].textContent || ''
      if (WEIGHT_TILE_MATCHERS.some(function (fn) { return fn(txt) })) return tiles[i]
    }
    return null
  }

  // ── 確保 Three.js 已載入 ─────────────────────────────────────────
  function ensureThree(cb) {
    if (typeof THREE !== 'undefined') { cb(THREE); return }
    var s = document.createElement('script')
    s.src = THREE_CDN
    s.onload = function () { cb(THREE) }
    s.onerror = function () { console.warn('[weight-3d] Three.js CDN 載入失敗') }
    document.head.appendChild(s)
  }

  // ── 主流程 ──────────────────────────────────────────────────────
  var injected = false

  function tryInject(T) {
    if (injected) return
    var tile = findWeightTile()
    if (!tile) return
    injected = true
    injectIntoTile(tile, T)
  }

  function init() {
    ensureThree(function (T) {
      tryInject(T)
      var obs = new MutationObserver(function () { if (!injected) tryInject(T) })
      obs.observe(document.body, { childList: true, subtree: true })
    })
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})()
