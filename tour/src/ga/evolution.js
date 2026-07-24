import { mulberry32 } from '../sim/engine.js'
import { crossoverTeams, mutateTeam, randomTeamGenome } from '../sim/brain.js'
// Worker inliné dans le bundle : permet la distribution en un seul fichier.
import TowerWorker from './worker.js?worker&inline'

// Neuro-évolution : une population d'équipes (composition + cerveaux),
// évaluée en parallèle dans un pool de Web Workers.

const POP_SIZE = 32
const ELITES = 4
const FRESH = 2
const SEEDS_PER_EVAL = 2
const ARCHIVE_LIMIT = 400 // champions conservés en mémoire, pour rejouer
const RECORD_LIMIT = 60 // records conservés et sauvegardés
export const AUTOSAVE_EVERY = 10

// Source unique pour le nombre de workers : le HUD s'aligne dessus.
export const WORKER_COUNT = Math.min(11, Math.max(2, (navigator.hardwareConcurrency || 4) - 1))

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
