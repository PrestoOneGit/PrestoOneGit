import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { Sim, TICK, mulberry32, randomTeamGenome } from './sim/engine.js'
import { Evolution, WORKER_COUNT } from './ga/evolution.js'
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

// ---- Rejeu : bibliothèque de records, fantômes, contrôles ----

const GHOST_CYCLE = [3, 6, 0]
let ghostCount = 3
let replaySpeed = 1
let nextRecordId = 1
let evolution = null
let hud = null

// Les matchs sont déterministes : {genome, seed} suffit à revoir une passe.
const records = [] // {id, genome, seed, generation, fitness, waves}
let replaySim = null
let replayMeta = null // record en cours de rejeu
let pinned = false // true si l'utilisateur a choisi un rejeu à la main
let pendingRecord = null // nouveau record à jouer à la fin du match en cours
let replayRestartTimer = 0
let simAccumulator = 0

function startReplay(record) {
  replaySim = new Sim(record.genome, record.seed)
  replayMeta = record
  simAccumulator = 0
  arena.attach(replaySim)

  // Fantômes : les records précédents rejoués sur la même graine.
  const ghosts = records
    .filter((r) => r.id !== record.id)
    .slice(0, ghostCount)
    .map((r) => new Sim(r.genome, record.seed))
  arena.attachGhosts(ghosts)
  hud?.renderRecords(records, record.id)
}

function latestRecord() {
  return records[0] ?? null
}

// Équipe aléatoire en attendant le premier record de l'évolution.
const bootstrap = {
  id: 0,
  genome: randomTeamGenome(mulberry32(42)),
  seed: 11,
  generation: 0,
  fitness: 0,
  waves: 0,
}
startReplay(bootstrap)

// ---- Évolution ----

function describeImprovement(best, previous) {
  if (!previous) {
    return `Gén. ${best.generation} — première équipe de référence (fitness ${Math.round(best.fitness)}, vague ${best.waves}).`
  }
  const gain = (((best.fitness - previous.fitness) / previous.fitness) * 100).toFixed(1)
  return `Gén. ${best.generation} — nouveau record ${Math.round(best.fitness)} (vague ${best.waves}, +${gain} %).`
}

function createEvolution() {
  evolution = new Evolution({
    onSnapshot: (workerId, genomeIndex, snap) => hud?.drawSnapshot(workerId, genomeIndex, snap),
    onGeneration: (gen, best, mean) => {
      hud?.setGenInfo(gen, best, mean)
      hud?.drawChart(evolution.history)
    },
    onNewBest: (best, previous) => {
      hud?.addLog(describeImprovement(best, previous))
      const record = {
        id: nextRecordId++,
        genome: best.genome.slice(),
        seed: best.seed,
        generation: best.generation,
        fitness: best.fitness,
        waves: best.waves,
      }
      records.unshift(record)
      if (records.length > 20) records.pop()
      hud?.renderRecords(records, replayMeta?.id)
      // On ne vole pas le match en cours : le nouveau record passera
      // en rejeu à la fin de la passe actuelle (sauf rejeu épinglé).
      // Exception : le tout premier record remplace tout de suite
      // l'équipe aléatoire de démarrage.
      if (!pinned) {
        if (replayMeta?.id === 0) startReplay(record)
        else pendingRecord = record
      }
    },
  })
  evolution.start()
  return evolution
}

hud = new HUD({
  workerCount: WORKER_COUNT,
  onPauseToggle: () => {
    evolution.paused = !evolution.paused
    return evolution.paused
  },
  onReset: () => {
    evolution.stop()
    records.length = 0
    pendingRecord = null
    pinned = false
    hud.addLog('Nouveau départ : population réinitialisée, tout est à réapprendre.')
    hud.resetControls()
    hud.renderRecords(records, null)
    startReplay(bootstrap)
    createEvolution()
  },
  onReplaySpeed: (s) => {
    replaySpeed = s
  },
  onGhostsToggle: () => {
    ghostCount = GHOST_CYCLE[(GHOST_CYCLE.indexOf(ghostCount) + 1) % GHOST_CYCLE.length]
    if (replayMeta) startReplay(replayMeta)
    return ghostCount
  },
  onSelectRecord: (record) => {
    // Rejeu choisi à la main : on l'épingle le temps de la passe.
    pinned = true
    pendingRecord = null
    startReplay(record)
  },
})

createEvolution()
hud.renderRecords(records, bootstrap.id)

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

function stepReplay(dt) {
  if (!replaySim) return
  if (replaySim.finished) {
    replayRestartTimer += dt
    if (replayRestartTimer > 1.6) {
      replayRestartTimer = 0
      pinned = false
      startReplay(pendingRecord ?? latestRecord() ?? replayMeta)
      pendingRecord = null
    }
    return
  }
  simAccumulator += dt * replaySpeed
  while (simAccumulator >= TICK) {
    simAccumulator -= TICK
    replaySim.step(TICK)
    // Les fantômes avancent au même rythme que le match principal
    for (const g of arena.ghosts) {
      if (!g.sim.finished) g.sim.step(TICK)
    }
  }
}

function animate() {
  requestAnimationFrame(animate)
  const dt = Math.min(clock.getDelta(), 0.1)
  elapsed += dt

  stepReplay(dt)

  if (replaySim) {
    const alive = replaySim.heroes.filter((h) => h.alive).length
    const label = pinned ? 'épinglé — ' : ''
    hud.setReplayInfo(
      `${label}équipe gén. ${replayMeta.generation} — vague ${replaySim.wave}, ${alive}/4 debout`
    )
    hud.updateTeamStats(replaySim, replayMeta.generation)
  }

  arena.update(dt, elapsed, camera)
  arena.updateGhosts()
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
  get records() {
    return records
  },
}
