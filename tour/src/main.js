import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TICK, TowerRun, mulberry32 } from './sim/engine.js'
import { describeComposition, randomTeamGenome } from './sim/brain.js'
import { Evolution, WORKER_COUNT } from './ga/evolution.js'
import { Tower3D } from './view/tower3d.js'
import { HUD } from './ui/hud.js'

// ---- Scène ----

const canvas = document.getElementById('scene')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap

const scene = new THREE.Scene()
renderer.setClearColor('#2b2320')
scene.fog = new THREE.Fog('#2b2320', 50, 110)

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300)
camera.position.set(22, 18, 22)

const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true
controls.dampingFactor = 0.06
controls.maxPolarAngle = Math.PI * 0.46
controls.minDistance = 9
controls.maxDistance = 55
controls.autoRotate = true
controls.autoRotateSpeed = 0.5
controls.target.set(0, 1, 0)

const hemi = new THREE.HemisphereLight('#8a7a6a', '#3a2f28', 0.65)
scene.add(hemi)

const sunlight = new THREE.DirectionalLight('#ffd9a8', 1.5)
sunlight.position.set(28, 40, 16)
sunlight.castShadow = true
sunlight.shadow.mapSize.set(2048, 2048)
sunlight.shadow.camera.left = -26
sunlight.shadow.camera.right = 26
sunlight.shadow.camera.top = 26
sunlight.shadow.camera.bottom = -26
sunlight.shadow.camera.far = 110
sunlight.shadow.bias = -0.0004
scene.add(sunlight)

const tower = new Tower3D(scene)

// ---- Rejeu : records, contrôles ----

let replaySpeed = 1
let nextRecordId = 1
let evolution = null
let hud = null

// Les runs sont déterministes : {genome, seed} suffit à revoir une passe.
const records = [] // {id, genome, seed, generation, fitness, floors}
let replayRun = null
let replayMeta = null
let pinned = false
let pendingRecord = null
let replayRestartTimer = 0
let simAccumulator = 0

function startReplay(record) {
  replayRun = new TowerRun(record.genome, record.seed)
  replayMeta = record
  simAccumulator = 0
  tower.attach(replayRun)
  hud?.buildTeamPanel(replayRun)
  hud?.renderRecords(records, record.id)
}

function latestRecord() {
  return records[0] ?? null
}

const bootstrap = {
  id: 0,
  genome: randomTeamGenome(mulberry32(42)),
  seed: 11,
  generation: 0,
  fitness: 0,
  floors: 0,
}
startReplay(bootstrap)

// ---- Évolution ----

function describeImprovement(best, previous) {
  const compo = describeComposition(best.genome)
  if (!previous) {
    return `Gén. ${best.generation} — première équipe de référence : étage ${best.floors + 1}. Compo : ${compo}.`
  }
  const floorNote =
    best.floors > previous.floors
      ? `étage ${best.floors + 1} atteint (record précédent : ${previous.floors + 1})`
      : `étage ${best.floors + 1}, run plus efficace`
  return `Gén. ${best.generation} — ${floorNote}. Compo : ${compo}.`
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
        floors: best.floors,
      }
      records.unshift(record)
      if (records.length > 20) records.pop()
      hud?.renderRecords(records, replayMeta?.id)
      // On ne vole pas le run en cours — sauf pour remplacer l'équipe
      // aléatoire de démarrage.
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
    hud.addLog('Nouveau départ : population réinitialisée, la tour attend de nouveaux prétendants.')
    hud.resetControls()
    hud.renderRecords(records, null)
    startReplay(bootstrap)
    createEvolution()
  },
  onReplaySpeed: (s) => {
    replaySpeed = s
  },
  onSelectRecord: (record) => {
    pinned = true
    pendingRecord = null
    startReplay(record)
  },
})

createEvolution()
hud.renderRecords(records, bootstrap.id)
hud.buildTeamPanel(replayRun)

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
  if (!replayRun) return
  if (replayRun.finished) {
    replayRestartTimer += dt
    if (replayRestartTimer > 1.8) {
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
    replayRun.step(TICK)
  }
}

function animate() {
  requestAnimationFrame(animate)
  const dt = Math.min(clock.getDelta(), 0.1)
  elapsed += dt

  stepReplay(dt)

  if (replayRun) {
    const alive = replayRun.heroes.filter((h) => h.alive).length
    const label = pinned ? 'épinglé — ' : ''
    const boss = replayRun.floor % 10 === 0 ? ' (BOSS)' : ''
    const end = replayRun.finished ? ` — fin : ${replayRun.endReason}` : ''
    hud.setReplayInfo(
      `${label}gén. ${replayMeta.generation} — étage ${replayRun.floor}${boss}, ${alive}/5 debout, ${replayRun.restsLeft} repos${end}`
    )
    hud.updateTeamStats(replayRun, replayMeta.generation)
  }

  tower.update(dt, elapsed, camera)
  controls.update()
  renderer.render(scene, camera)
}

animate()

// Accès de débogage depuis la console du navigateur
window.tour = {
  get evolution() {
    return evolution
  },
  get replay() {
    return replayRun
  },
  get records() {
    return records
  },
}
