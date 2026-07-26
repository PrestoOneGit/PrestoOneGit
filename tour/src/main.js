import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TICK, TowerRun, mulberry32 } from './sim/engine.js'
import { describeComposition, randomTeamGenome } from './sim/brain.js'
import { analyzeRun, compareReports, reportToMarkdown } from './sim/report.js'
import { AUTOSAVE_EVERY, Evolution, POP_SIZE, WORKER_COUNT } from './ga/evolution.js'
import {
  clearSession, downloadJson, exportSession, importSession, loadSession, saveSession,
} from './ga/persistence.js'
import { QUALITY_LEVELS, Tower3D } from './view/tower3d.js'
import { Enregistreur, enregistrementDisponible, telechargerVideo } from './view/enregistreur.js'
import { HUD } from './ui/hud.js'

// ---- Scène ----

const canvas = document.getElementById('scene')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap

const scene = new THREE.Scene()
renderer.setClearColor('#0e1214')
// Le brouillard commence au-delà du coin le plus lointain du plateau
// (32 unités de côté) : sinon la moitié arrière vire au noir.
scene.fog = new THREE.Fog('#0e1214', 78, 190)

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300)
camera.position.set(30, 27, 30)

const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true
controls.dampingFactor = 0.06
controls.maxPolarAngle = Math.PI * 0.46
controls.minDistance = 9
controls.maxDistance = 90
controls.autoRotate = true
controls.autoRotateSpeed = 0.5
controls.target.set(0, 1, 0)

const hemi = new THREE.HemisphereLight('#9d8b78', '#4a3d33', 0.95)
scene.add(hemi)

const sunlight = new THREE.DirectionalLight('#ffd9a8', 1.8)
sunlight.position.set(34, 48, 20)
sunlight.castShadow = true
sunlight.shadow.mapSize.set(2048, 2048)
// L'ombre doit couvrir la diagonale du plateau, pas seulement son côté.
sunlight.shadow.camera.left = -30
sunlight.shadow.camera.right = 30
sunlight.shadow.camera.top = 30
sunlight.shadow.camera.bottom = -30
sunlight.shadow.camera.far = 110
sunlight.shadow.bias = -0.0004
scene.add(sunlight)

const tower = new Tower3D(scene, 'pions')
let qualityIndex = QUALITY_LEVELS.findIndex((q) => q.id === 'pions')

// ---- Rejeu ----

let replaySpeed = 1
let evolution = null
let hud = null
let lastReport = null

// Les runs sont déterministes : {genome, seed} suffit à revoir une passe.
let replayRun = null
let replayMeta = null
let pinned = false
let pendingRecord = null
let replayRestartTimer = 0
let simAccumulator = 0
let enregistreur = null

const bootstrap = {
  generation: 0,
  genome: randomTeamGenome(mulberry32(42)),
  seed: 11,
  fitness: 0,
  floors: 0,
  bootstrap: true,
}

function startReplay(entry) {
  replayRun = new TowerRun(entry.genome, entry.seed)
  replayMeta = entry
  simAccumulator = 0
  tower.attach(replayRun)
  hud?.buildTeamPanel(replayRun)
  hud?.renderRecords(evolution?.records ?? [], entry.generation)
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

async function autosave(manual = false) {
  if (!evolution) return
  try {
    const at = await saveSession(evolution.snapshotState())
    const time = new Date(at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    hud?.setSaveState(`Session sauvegardée à ${time} (gén. ${evolution.generation})`, true)
  } catch (err) {
    hud?.setSaveState(`Échec de la sauvegarde : ${err.message}`)
    if (manual) hud?.addLog(`La sauvegarde a échoué : ${err.message}`)
  }
}

function createEvolution(resumeFrom = null) {
  evolution = new Evolution({
    resumeFrom,
    onSnapshot: (workerId, genomeIndex, snap) => hud?.drawSnapshot(workerId, genomeIndex, snap),
    onGeneration: (gen, best, mean) => {
      hud?.setGenInfo(gen, best, mean)
      hud?.drawChart(evolution.history)
    },
    onNewBest: (best, previous) => {
      hud?.addLog(describeImprovement(best, previous))
      hud?.renderRecords(evolution.records, replayMeta?.generation)
      // On ne vole pas le run en cours — sauf pour remplacer l'équipe
      // aléatoire de démarrage.
      if (!pinned) {
        if (replayMeta?.bootstrap) startReplay(best)
        else pendingRecord = best
      }
    },
    onAutosave: () => autosave(),
  })
  evolution.start()
  return evolution
}

// ---- Actions du menu session ----

async function handleSessionAction(action) {
  switch (action) {
    case 'save':
      await autosave(true)
      break
    case 'export':
      downloadJson(exportSession(evolution.snapshotState()), `tour-session-gen${evolution.generation}.json`)
      break
    case 'import':
      document.getElementById('import-file').click()
      break
    case 'wipe':
      await clearSession()
      hud.setSaveState('Sauvegarde effacée')
      break
    case 'copyReport': {
      if (!lastReport) return
      const md = reportToMarkdown(lastReport)
      try {
        await navigator.clipboard.writeText(md)
        hud.addLog('Rapport copié dans le presse-papier (format markdown).')
      } catch {
        // Le presse-papier peut être refusé hors contexte sécurisé :
        // on retombe sur un téléchargement, jamais sur un échec muet.
        downloadJson(md, `rapport-gen${lastReport.meta.generation}.md`)
        hud.addLog('Presse-papier indisponible : le rapport a été téléchargé.')
      }
      break
    }
    case 'exportReport':
      if (lastReport) downloadJson(lastReport, `rapport-gen${lastReport.meta.generation}.json`)
      break
  }
}

document.getElementById('import-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0]
  if (!file) return
  try {
    const state = importSession(JSON.parse(await file.text()))
    evolution.stop()
    pinned = false
    pendingRecord = null
    createEvolution(state)
    hud.drawChart(evolution.history)
    hud.renderRecords(evolution.records, null)
    hud.addLog(`Session importée : reprise à la génération ${state.generation}.`)
    startReplay(evolution.bestEver ?? bootstrap)
  } catch (err) {
    hud.addLog(`Import impossible : ${err.message}`)
  }
  e.target.value = ''
})

// ---- Enregistrement vidéo ----

// Rejoue l'ascension affichée DEPUIS LE DÉBUT et l'encode en 60 images/s.
// On repart de zéro plutôt que de filmer la suite : une vidéo qui commence
// au milieu d'un étage n'a pas d'intérêt, et la run est déterministe donc
// la reprise est exacte.
async function enregistrerRun() {
  if (enregistreur?.actif) {
    enregistreur.arreter()
    return
  }
  if (!replayMeta) return
  if (!enregistrementDisponible()) {
    hud.addLog('Ce navigateur ne sait pas encoder de vidéo.')
    return
  }
  const meta = replayMeta
  const etaitEpingle = pinned
  pinned = true // pas question qu'un nouveau record vole la run en cours
  startReplay(meta)
  hud.setRecording(true)

  enregistreur = new Enregistreur({
    canvas,
    dessiner: (dt) => renderFrame(dt),
    terminee: () => replayRun?.finished ?? true,
    onProgress: (s) => hud.setRecording(true, s),
  })
  try {
    const { blob, ext, secondes } = await enregistreur.enregistrer()
    telechargerVideo(blob, `tour-gen${meta.generation}-etage${replayRun.floor}.${ext}`)
    hud.addLog(
      `Vidéo exportée : génération ${meta.generation}, étage ${replayRun.floor}, ` +
        `${secondes.toFixed(0)} s à 60 images/s.`
    )
  } catch (err) {
    hud.addLog(`Enregistrement impossible : ${err.message}`)
  } finally {
    hud.setRecording(false)
    pinned = etaitEpingle
    enregistreur = null
  }
}

// ---- HUD ----

hud = new HUD({
  workerCount: WORKER_COUNT,
  popSize: POP_SIZE,
  onPauseToggle: () => {
    evolution.paused = !evolution.paused
    if (evolution.paused) autosave()
    return evolution.paused
  },
  onReset: async () => {
    evolution.stop()
    await clearSession()
    pendingRecord = null
    pinned = false
    hud.addLog('Nouveau départ : population réinitialisée, la tour attend de nouveaux prétendants.')
    hud.resetControls()
    hud.renderRecords([], null)
    hud.setSaveState('Session non sauvegardée')
    startReplay(bootstrap)
    createEvolution()
  },
  onReplaySpeed: (s) => {
    replaySpeed = s
  },
  onQualityToggle: () => {
    // Réglage purement visuel : l'évolution tourne dans les workers,
    // elle n'est pas affectée.
    qualityIndex = (qualityIndex + 1) % QUALITY_LEVELS.length
    const level = QUALITY_LEVELS[qualityIndex]
    tower.setQuality(level.id)
    return level.label
  },
  onSelectRecord: (record) => {
    pinned = true
    pendingRecord = null
    startReplay(record)
  },
  onPickGeneration: (gen) => {
    const champion = evolution.championOf(gen)
    if (!champion) {
      const available = evolution.archivedGenerations()
      const range = available.length
        ? `générations en mémoire : ${available[available.length - 1]} à ${available[0]}`
        : 'aucune génération archivée pour l’instant'
      hud.addLog(`Génération ${gen} introuvable — ${range}.`)
      hud.selectTab('log')
      return
    }
    pinned = true
    pendingRecord = null
    startReplay(champion)
  },
  onRecord: () => enregistrerRun(),
  onReport: () => {
    if (!replayMeta) return
    // Le rapport rejoue le run en mode journalisé : mêmes graine et
    // génome, donc exactement le run qu'on regarde.
    lastReport = analyzeRun({
      genome: replayMeta.genome,
      seed: replayMeta.seed,
      generation: replayMeta.generation,
      fitness: replayMeta.fitness,
    })
    hud.showReport(lastReport)
  },
  onSessionAction: handleSessionAction,
})

// ---- Démarrage : reprise de session si elle existe ----

async function boot() {
  const saved = await loadSession()
  if (saved?.incompatible) {
    hud.setSaveState('Sauvegarde ignorée (format obsolète)')
    hud.addLog(
      'Une sauvegarde a été trouvée mais elle date d’une version où les règles avaient changé : ' +
        'reprendre dessus donnerait des agents incohérents. Nouvel entraînement démarré.'
    )
    createEvolution()
  } else if (saved) {
    createEvolution(saved)
    hud.drawChart(evolution.history)
    hud.renderRecords(evolution.records, null)
    const time = new Date(saved.savedAt).toLocaleString('fr-FR')
    hud.setSaveState(`Reprise de la session du ${time}`, true)
    hud.addLog(`Entraînement repris à la génération ${saved.generation}.`)
    if (evolution.bestEver) startReplay(evolution.bestEver)
  } else {
    createEvolution()
    hud.setSaveState(`Sauvegarde auto toutes les ${AUTOSAVE_EVERY} générations`)
  }
  hud.buildTeamPanel(replayRun)
}

boot()

// Dernière sauvegarde avant fermeture de l'onglet (best-effort).
window.addEventListener('pagehide', () => {
  if (evolution) saveSession(evolution.snapshotState()).catch(() => {})
})

// ---- Boucle de rendu ----

// Le canvas occupe toute la fenêtre, mais les panneaux en recouvrent les
// bords. On décale le centre optique pour que le plateau soit cadré dans
// la zone réellement visible, sinon il déborde sous le panneau latéral.
function resize() {
  const w = window.innerWidth
  const h = window.innerHeight
  renderer.setSize(w, h, false)
  camera.aspect = w / h

  const ui = document.getElementById('ui')
  const box = (sel) => {
    const el = ui?.querySelector(sel)
    if (!el || el.offsetParent === null) return { width: 0, height: 0 }
    return el.getBoundingClientRect()
  }
  const dock = ui?.classList.contains('dock-hidden') ? 0 : box('.dock').width
  const bar = box('.bar').height
  const strip = box('.timeline').height

  // Décaler la fenêtre de rendu vers la droite/le bas fait glisser le
  // décor vers la gauche/le haut — exactement ce qu'il faut ici.
  camera.setViewOffset(w, h, dock / 2, (strip - bar) / 2, w, h)
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
      startReplay(pendingRecord ?? evolution?.bestEver ?? replayMeta)
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

// Une image : avance la simulation de dt, met le HUD à jour, rend la scène.
// L'enregistreur vidéo l'appelle avec un dt fixe de 1/60 s, la boucle
// interactive avec le temps réellement écoulé.
function renderFrame(dt, { avancer = true } = {}) {
  elapsed += dt
  if (avancer) stepReplay(dt)

  if (replayRun) {
    const alive = replayRun.heroes.filter((h) => h.alive).length
    const parts = [`gén. ${replayMeta.generation}`, `étage ${replayRun.floor}`]
    if (replayRun.floor > 0 && replayRun.floor % 10 === 0) parts.push('BOSS')
    parts.push(`${alive}/5 debout`, `${replayRun.restsLeft} repos`)
    if (pinned) parts.push('épinglé')
    if (replayRun.finished) parts.push(replayRun.endReason)
    hud.setReplayInfo(parts.join(' · '))
    hud.updateTeamStats(replayRun, replayMeta.generation)
  }

  tower.update(dt, elapsed, camera)
  controls.update()
  renderer.render(scene, camera)
}

function animate() {
  requestAnimationFrame(animate)
  // Pendant un enregistrement, c'est l'enregistreur qui pilote les images :
  // la boucle interactive se met en retrait pour ne pas doubler la
  // simulation, ce qui accélérerait la run dans la vidéo.
  if (enregistreur?.actif) return
  renderFrame(Math.min(clock.getDelta(), 0.1))
}

animate()

// Accès de débogage depuis la console du navigateur
window.__cam = { camera, controls, tower } // caméra et vue, pour inspecter de près
window.tour = {
  get evolution() {
    return evolution
  },
  get replay() {
    return replayRun
  },
  get records() {
    return evolution?.records ?? []
  },
  get quality() {
    return tower.quality.id
  },
  setQuality(id) {
    const i = QUALITY_LEVELS.findIndex((q) => q.id === id)
    if (i < 0) return
    qualityIndex = i
    tower.setQuality(id)
    document.getElementById('quality').textContent = QUALITY_LEVELS[i].label
  },
  playGeneration(gen) {
    const champion = evolution?.championOf(gen)
    if (champion) {
      pinned = true
      startReplay(champion)
    }
    return !!champion
  },
  report(gen = replayMeta?.generation) {
    const entry = gen === replayMeta?.generation ? replayMeta : evolution?.championOf(gen)
    if (!entry) return null
    lastReport = analyzeRun({
      genome: entry.genome,
      seed: entry.seed,
      generation: entry.generation,
      fitness: entry.fitness,
    })
    return lastReport
  },
  markdown(gen) {
    const r = this.report(gen)
    return r ? reportToMarkdown(r) : null
  },
  // Comparer plusieurs générations d'un coup : « qu'est-ce qui a changé
  // entre la 20 et la 300 ? », à coller dans un prompt.
  comparer(generations) {
    const reports = generations
      .map((g) => this.report(g))
      .filter(Boolean)
    return reports.length ? compareReports(reports) : null
  },
}
