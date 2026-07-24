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

// Source unique pour le nombre de workers : le HUD s'aligne dessus.
export const WORKER_COUNT = Math.min(11, Math.max(2, (navigator.hardwareConcurrency || 4) - 1))

export class Evolution {
  constructor({ onSnapshot, onGeneration, onNewBest }) {
    this.rng = mulberry32((Math.random() * 2 ** 31) | 0)
    this.onSnapshot = onSnapshot
    this.onGeneration = onGeneration
    this.onNewBest = onNewBest

    this.generation = 0
    this.population = Array.from({ length: POP_SIZE }, () => randomTeamGenome(this.rng))
    this.history = [] // {gen, best, mean, floors}
    this.bestEver = null // {genome, fitness, floors, generation, seed}
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

    if (!this.bestEver || best.fitness > this.bestEver.fitness) {
      const previous = this.bestEver
      this.bestEver = {
        genome: best.genome.slice(),
        fitness: best.fitness,
        floors: best.floors,
        generation: this.generation,
        seed: this.seedsForGeneration()[0],
      }
      this.onNewBest?.(this.bestEver, previous)
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
