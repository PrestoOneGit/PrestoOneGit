import { mulberry32 } from '../sim/engine.js'
import { crossoverTeams, mutateTeam, randomTeamGenome } from '../sim/brain.js'
// Worker inliné dans le bundle : permet la distribution en un seul fichier.
import TowerWorker from './worker.js?worker&inline'

// Neuro-évolution : une population d'équipes (composition + cerveaux),
// évaluée en parallèle dans un pool de Web Workers.

// ─── Réglages, ajustables SANS toucher au code ───
//
// L'audit a identifié la contrainte principale du projet : le génome fait
// ~21 900 paramètres pour une population de 32, soit près de 700 paramètres
// par individu évalué. Un algorithme génétique explore correctement
// quelques centaines de paramètres à cette taille de population. Ce n'est
// donc pas la vitesse par run qui bride, c'est le NOMBRE d'équipes par
// génération — et c'est le seul bouton qui vaille vraiment d'être tourné.
//
// D'où ces paramètres d'URL, pour pouvoir monter la population sur une
// machine qui a les cœurs, sans rien recompiler :
//
//   ?pop=96          population par génération  (défaut 32, max 512)
//   ?workers=11      workers en parallèle       (défaut : cœurs - 1)
//   ?seeds=4         graines par évaluation     (défaut 4)
//
// Élites et immigrants suivent la population pour garder les mêmes
// proportions : à pop 32 c'était 4 et 2, soit 12,5 % et 6 %.
const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '')
const lire = (nom, defaut, min, max) => {
  const v = Number.parseInt(params.get(nom) ?? '', 10)
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : defaut
}

export const POP_SIZE = lire('pop', 32, 8, 512)
const ELITES = Math.max(2, Math.round(POP_SIZE * 0.125))
const FRESH = Math.max(1, Math.round(POP_SIZE * 0.0625))
// Nombre de graines par évaluation. Mesuré (audit/experiment-seeds.mjs) :
// avec 2 graines, le champion est autant « chanceux sur ces deux
// configurations » que bon — 20 % de son score ne se transfère pas à des
// graines inédites, et cette part ne s'hérite pas. Avec 4, le biais tombe
// à 3-4 % et l'avantage sur une recherche aléatoire à budget égal est
// maximal (+1416 points contre +1007 à 2 graines, +473 à 8).
const SEEDS_PER_EVAL = lire('seeds', 4, 1, 16)
const ARCHIVE_LIMIT = 400 // champions conservés en mémoire, pour rejouer
const RECORD_LIMIT = 60 // records conservés et sauvegardés
export const AUTOSAVE_EVERY = 10

// Source unique pour le nombre de workers : le HUD s'aligne dessus.
export const WORKER_COUNT = lire(
  'workers',
  Math.min(11, Math.max(2, (navigator.hardwareConcurrency || 4) - 1)),
  1,
  32
)

export class Evolution {
  constructor({ onSnapshot, onGeneration, onNewBest, onAutosave, resumeFrom = null }) {
    this.rng = mulberry32((Math.random() * 2 ** 31) | 0)
    this.onSnapshot = onSnapshot
    this.onGeneration = onGeneration
    this.onNewBest = onNewBest
    this.onAutosave = onAutosave

    this.generation = resumeFrom?.generation ?? 0
    this.population =
      resumeFrom?.population ?? Array.from({ length: POP_SIZE }, () => randomTeamGenome(this.rng))
    this.history = resumeFrom?.history ?? [] // {gen, best, mean, floors}
    this.records = resumeFrom?.records ?? [] // runs record, du plus récent au plus ancien
    this.bestEver = resumeFrom?.bestEver ?? null
    this.resumed = !!resumeFrom
    // Champion de CHAQUE génération, pour pouvoir rejouer n'importe
    // laquelle — pas seulement celles qui ont battu un record.
    this.archive = new Map()
    for (const r of this.records) this.archive.set(r.generation, r)

    this.running = false
    this.paused = false

    this.workers = Array.from({ length: WORKER_COUNT }, (_, i) => {
      const w = new TowerWorker()
      w.postMessage({ type: 'init', workerId: i })
      w.onmessage = (e) => this.handleMessage(e.data)
      return w
    })
  }

  get workerCount() {
    return this.workers.length
  }

  // État sérialisable : ce qui part en sauvegarde et en export.
  snapshotState() {
    return {
      generation: this.generation,
      population: this.population,
      history: this.history,
      records: this.records,
      bestEver: this.bestEver,
    }
  }

  handleMessage(msg) {
    if (msg.type === 'snapshot') {
      this.onSnapshot?.(msg.workerId, msg.genomeIndex, msg.snap)
    } else if (msg.type === 'result') {
      this.pendingResults?.set(msg.index, { fitness: msg.fitness, floors: msg.floors })
      this.checkGenerationDone?.()
    }
  }

  seedsForGeneration() {
    // Graines fixes pour tout le run : la tâche reste identique d'une
    // génération à l'autre — la courbe reflète l'apprentissage.
    return Array.from({ length: SEEDS_PER_EVAL }, (_, i) => (11 + i * 104729) >>> 0)
  }

  evaluate() {
    return new Promise((resolve) => {
      this.pendingResults = new Map()
      const seeds = this.seedsForGeneration()
      this.checkGenerationDone = () => {
        if (this.pendingResults.size >= this.population.length) {
          this.checkGenerationDone = null
          resolve(this.pendingResults)
        }
      }
      const jobsPerWorker = this.workers.map(() => [])
      this.population.forEach((genome, index) => {
        jobsPerWorker[index % this.workers.length].push({
          index,
          genome: Array.from(genome),
          seeds,
        })
      })
      this.workers.forEach((w, i) => {
        if (jobsPerWorker[i].length > 0) w.postMessage({ type: 'eval', jobs: jobsPerWorker[i] })
      })
    })
  }

  tournament(scored) {
    let best = null
    for (let i = 0; i < 3; i++) {
      const c = scored[Math.floor(this.rng() * scored.length)]
      if (!best || c.fitness > best.fitness) best = c
    }
    return best.genome
  }

  trimArchive() {
    if (this.archive.size <= ARCHIVE_LIMIT) return
    const recordGens = new Set(this.records.map((r) => r.generation))
    // On sacrifie les plus anciennes générations ordinaires ; les runs
    // records sont conservés quoi qu'il arrive.
    const gens = [...this.archive.keys()].sort((a, b) => a - b)
    for (const gen of gens) {
      if (this.archive.size <= ARCHIVE_LIMIT) break
      if (recordGens.has(gen)) continue
      this.archive.delete(gen)
    }
  }

  async runGeneration() {
    const results = await this.evaluate()
    const scored = this.population.map((genome, i) => ({
      genome,
      fitness: results.get(i).fitness,
      floors: results.get(i).floors,
    }))
    scored.sort((a, b) => b.fitness - a.fitness)

    const best = scored[0]
    const mean = scored.reduce((s, x) => s + x.fitness, 0) / scored.length
    this.history.push({ gen: this.generation, best: best.fitness, mean, floors: best.floors })

    const entry = {
      generation: this.generation,
      genome: best.genome.slice(),
      seed: this.seedsForGeneration()[0],
      fitness: best.fitness,
      floors: best.floors,
    }
    this.archive.set(this.generation, entry)
    this.trimArchive()

    const isRecord = !this.bestEver || best.fitness > this.bestEver.fitness
    if (isRecord) {
      const previous = this.bestEver
      this.bestEver = entry
      this.records.unshift(entry)
      if (this.records.length > RECORD_LIMIT) this.records.pop()
      this.onNewBest?.(entry, previous)
    }
    this.onGeneration?.(this.generation, best.fitness, mean, this.bestEver)

    const next = []
    for (let i = 0; i < ELITES; i++) next.push(scored[i].genome.slice())
    for (let i = 0; i < FRESH; i++) next.push(randomTeamGenome(this.rng))
    while (next.length < POP_SIZE) {
      const child = crossoverTeams(this.rng, this.tournament(scored), this.tournament(scored))
      next.push(mutateTeam(this.rng, child))
    }
    this.population = next
    this.generation++

    if (this.generation % AUTOSAVE_EVERY === 0) this.onAutosave?.()
  }

  // Champion d'une génération donnée, s'il est encore en mémoire.
  championOf(generation) {
    return this.archive.get(generation) ?? null
  }

  archivedGenerations() {
    return [...this.archive.keys()].sort((a, b) => b - a)
  }

  async start() {
    if (this.running) return
    this.running = true
    while (this.running) {
      if (this.paused) {
        await new Promise((r) => setTimeout(r, 200))
        continue
      }
      await this.runGeneration()
      await new Promise((r) => setTimeout(r, 30))
    }
  }

  stop() {
    this.running = false
    for (const w of this.workers) w.terminate()
  }
}
