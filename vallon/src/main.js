import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { World } from './world/world.js'
import { Villages } from './world/villages.js'
import { Simulation } from './sim/simulation.js'
import { HistoryEngine } from './history/history.js'
import { HUD } from './ui/hud.js'

const GENESIS_YEARS = 400

const SKY = {
  day: new THREE.Color('#c9e6ef'),
  dusk: new THREE.Color('#f0a873'),
  night: new THREE.Color('#141d33'),
}
const SUN = {
  day: new THREE.Color('#fff4dd'),
  dusk: new THREE.Color('#ff9a5c'),
}

const canvas = document.getElementById('scene')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap

const scene = new THREE.Scene()
scene.fog = new THREE.Fog('#c9e6ef', 90, 260)

const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 600)
camera.position.set(48, 42, 48)

const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true
controls.dampingFactor = 0.06
controls.maxPolarAngle = Math.PI * 0.46
controls.minDistance = 8
controls.maxDistance = 160
controls.target.set(0, 4, 0)

const hemi = new THREE.HemisphereLight('#cfe5f2', '#7a8a66', 0.7)
scene.add(hemi)

const sun = new THREE.DirectionalLight('#fff4dd', 1.4)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.camera.left = -95
sun.shadow.camera.right = 95
sun.shadow.camera.top = 95
sun.shadow.camera.bottom = -95
sun.shadow.camera.far = 320
sun.shadow.bias = -0.0004
scene.add(sun)
scene.add(sun.target)

const moon = new THREE.DirectionalLight('#8ea6d4', 0)
moon.position.set(-40, 60, -30)
scene.add(moon)

let world = null
let sim = null
let history = null
let villages = null
let selected = null // créature sauvage suivie
let selectedSite = null // village sélectionné
let hud = null
let seed = Math.floor(Math.random() * 2 ** 31)

function buildWorld(newSeed) {
  if (sim) {
    scene.remove(sim.group)
    sim.dispose()
  }
  if (villages) {
    scene.remove(villages.group)
    villages.dispose()
  }
  if (world) {
    scene.remove(world.group)
    world.dispose()
  }
  seed = newSeed
  world = new World(seed)
  sim = new Simulation(world, seed)
  history = new HistoryEngine(world, seed).genesis(GENESIS_YEARS)
  villages = new Villages(world, history, seed)
  scene.add(world.group)
  scene.add(sim.group)
  scene.add(villages.group)
  selected = null
  selectedSite = null
  if (hud) hud.resetChronicle()
}

buildWorld(seed)

hud = new HUD({
  onSpeedChange: (s) => {
    sim.speed = s
  },
  onNewWorld: () => {
    const speed = sim.speed
    buildWorld(Math.floor(Math.random() * 2 ** 31))
    sim.speed = speed
  },
  onClosePanel: () => {
    selected = null
    selectedSite = null
  },
  onAdvanceYears: () => {
    for (let i = 0; i < 10; i++) history.tickYear()
    villages.rebuildAll()
  },
})

// Sélection au clic (en distinguant clic et rotation de caméra)
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
let downPos = null

canvas.addEventListener('pointerdown', (e) => {
  downPos = { x: e.clientX, y: e.clientY }
})

canvas.addEventListener('pointerup', (e) => {
  if (!downPos) return
  const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y)
  downPos = null
  if (moved > 6) return
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1
  raycaster.setFromCamera(pointer, camera)
  const hits = raycaster.intersectObjects([sim.group, villages.group], true)
  const creatureHit = hits.find(
    (h) => h.object.userData.creature && !h.object.userData.creature.isDead
  )
  const siteHit = hits.find((h) => h.object.userData.site)
  if (creatureHit) {
    selected = creatureHit.object.userData.creature
    selectedSite = null
  } else if (siteHit) {
    selectedSite = siteHit.object.userData.site
    selected = null
  } else {
    selected = null
    selectedSite = null
  }
})

function resize() {
  const w = window.innerWidth
  const h = window.innerHeight
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}
window.addEventListener('resize', resize)
resize()

// Ambiance : position du soleil, couleurs du ciel et intensités selon l'heure.
const skyColor = new THREE.Color()
const sunColor = new THREE.Color()

function updateAtmosphere() {
  const elev = sim.sunElevation
  const daylight = THREE.MathUtils.smoothstep(elev, -0.14, 0.28)
  const duskAmount = Math.max(0, 1 - Math.abs(elev) * 3.2) * daylight

  skyColor.copy(SKY.night).lerp(SKY.day, daylight).lerp(SKY.dusk, duskAmount * 0.75)
  renderer.setClearColor(skyColor)
  scene.fog.color.copy(skyColor)

  const sunAngle = (sim.dayTime - 0.25) * Math.PI * 2
  sun.position.set(Math.cos(sunAngle) * 120, Math.sin(sunAngle) * 120, 45)
  sunColor.copy(SUN.day).lerp(SUN.dusk, duskAmount)
  sun.color.copy(sunColor)
  sun.intensity = 1.55 * daylight
  moon.intensity = 0.22 * (1 - daylight)
  hemi.intensity = 0.18 + 0.55 * daylight

  return 1 - daylight
}

const clock = new THREE.Clock()
let elapsed = 0

function animate() {
  requestAnimationFrame(animate)
  const rawDt = clock.getDelta()
  elapsed += rawDt * Math.max(sim.speed, 0.2)

  sim.update(rawDt)
  const nightFactor = updateAtmosphere()
  world.update(rawDt * Math.max(sim.speed, 1), elapsed, nightFactor)
  villages.update(Math.min(rawDt, 0.1) * sim.speed, elapsed, sim.isNight)

  if (selected) {
    if (selected.isDead && selected.deathTimer <= 0) {
      selected = null
    } else {
      controls.target.lerp(
        new THREE.Vector3(
          selected.mesh.position.x,
          selected.mesh.position.y + 0.5,
          selected.mesh.position.z
        ),
        0.06
      )
    }
  }

  controls.update()
  hud.update(sim, history, selected, selectedSite)
  renderer.render(scene, camera)
}

animate()

// Accès de débogage depuis la console du navigateur
window.vallon = {
  get sim() {
    return sim
  },
  get history() {
    return history
  },
  get villages() {
    return villages
  },
  suivre(i = 0) {
    selected = sim.creatures[i] ?? null
  },
  village(i = 0) {
    selectedSite = history.sites[i] ?? null
  },
}
