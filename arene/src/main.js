import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { Sim, TICK, mulberry32, randomTeamGenome } from './sim/engine.js'
import { Evolution } from './ga/evolution.js'
import { Arena3D } from './view/arena3d.js'
import { HUD } from './ui/hud.js'

// ---- Scène ----

const canvas = document.getElementById('scene')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap

const scene = new THREE.Scene()
renderer.setClearColor('#2b2320')
scene.fog = new THREE.Fog('#2b2320', 55, 120)

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300)
camera.position.set(24, 20, 24)

const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true
controls.dampingFactor = 0.06
controls.maxPolarAngle = Math.PI * 0.46
controls.minDistance = 10
controls.maxDistance = 60
controls.autoRotate = true
controls.autoRotateSpeed = 0.6
controls.target.set(0, 1, 0)

const hemi = new THREE.HemisphereLight('#8a7a6a', '#3a2f28', 0.65)
scene.add(hemi)

const sunlight = new THREE.DirectionalLight('#ffd9a8', 1.5)
sunlight.position.set(30, 42, 18)
sunlight.castShadow = true
sunlight.shadow.mapSize.set(2048, 2048)
sunlight.shadow.camera.left = -28
sunlight.shadow.camera.right = 28
sunlight.shadow.camera.top = 28
sunlight.shadow.camera.bottom = -28
sunlight.shadow.camera.far = 120
sunlight.shadow.bias = -0.0004
scene.add(sunlight)

const arena = new Arena3D(scene)

// ---- Rejeu du meilleur match dans le fil principal ----

let replaySim = null
let replayMeta = null // {generation, fitness}
let replayRestartTimer = 0

function startReplay(genome, seed, meta) {
  replaySim = new Sim(genome, seed)
  replayMeta = meta
  arena.attach(replaySim)
}

// Le premier rejeu montre une équipe aléatoire, le temps que l'évolution démarre.
startReplay(randomTeamGenome(mulberry32(42)), 1, { generation: 0, fitness: 0 })

// ---- Évolution ----

let evolution = null
let hud = null

function describeImprovement(best, previous) {
  if (!previous) {
    return `Gén. ${best.generation} — première équipe de référence (fitness ${Math.round(best.fitness)}, vague ${best.waves}).`
  }
  const gain = (((best.fitness - previous.fitness) / previous.fitness) * 100).toFixed(1)
  return `Gén. ${best.generation} — nouveau record ${Math.round(best.fitness)} (vague ${best.waves}, +${gain} %). Les cerveaux s’affinent.`
}

function createEvolution() {
  evolution = new Evolution({
    onSnapshot: (workerId, genomeIndex, snap) => hud.drawSnapshot(workerId, genomeIndex, snap),
    onGeneration: (gen, best, mean) => {
      hud.setGenInfo(gen, best, mean)
      hud.drawChart(evolution.history)
    },
    onNewBest: (best, previous) => {
      hud.addLog(describeImprovement(best, previous))
      // Le rejeu bascule sur la nouvelle meilleure équipe
      startReplay(best.genome, best.seed, { generation: best.generation, fitness: best.fitness })
    },
  })
  evolution.start()
  return evolution
}

hud = new HUD({
  workerCount: Math.min(8, Math.max(2, (navigator.hardwareConcurrency || 4) - 1)),
  onPauseToggle: () => {
    evolution.paused = !evolution.paused
    return evolution.paused
  },
  onReset: () => {
    evolution.stop()
    hud.addLog('Nouveau départ : population réinitialisée, tout est à réapprendre.')
    createEvolution()
  },
})

createEvolution()

// ---- Boucle de rendu ----

function resize() {
  const w = window.innerWidth
  const h = window.innerHeight
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}
window.addEventListener('resize', resize)
resize()

const clock = new THREE.Clock()
let elapsed = 0
let simAccumulator = 0

function animate() {
  requestAnimationFrame(animate)
  const dt = Math.min(clock.getDelta(), 0.1)
  elapsed += dt

  if (replaySim) {
    if (replaySim.finished) {
      replayRestartTimer += dt
      if (replayRestartTimer > 1.6) {
        replayRestartTimer = 0
        // Rejoue la meilleure équipe connue (ou la même équipe aléatoire au début)
        const best = evolution?.bestEver
        if (best) startReplay(best.genome, best.seed, { generation: best.generation, fitness: best.fitness })
        else replaySim = new Sim(replaySim.genome, 1)
        if (!best) arena.attach(replaySim)
      }
    } else {
      simAccumulator += dt
      while (simAccumulator >= TICK) {
        simAccumulator -= TICK
        replaySim.step(TICK)
      }
    }
    const alive = replaySim.heroes.filter((h) => h.alive).length
    hud.setReplayInfo(
      `équipe gén. ${replayMeta.generation} — vague ${replaySim.wave}, ${alive}/4 debout`
    )
    hud.updateTeamStats(replaySim, replayMeta.generation)
  }

  arena.update(dt, elapsed, camera)
  controls.update()
  renderer.render(scene, camera)
}

animate()

// Accès de débogage depuis la console du navigateur
window.arene = {
  get evolution() {
    return evolution
  },
  get replay() {
    return replaySim
  },
}
