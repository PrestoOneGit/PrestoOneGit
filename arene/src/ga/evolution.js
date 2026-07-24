import { GENES, GENES_PER_HERO, GENOME_SIZE, HERO_CLASSES, mulberry32, randomGenome } from '../sim/engine.js'

// Algorithme génétique : une population d'équipes, évaluée en parallèle
// dans un pool de Web Workers, puis sélection, croisement, mutation.

const POP_SIZE = 32
const ELITES = 3
const FRESH = 2
const MUTATION_RATE = 0.25
const MUTATION_SIGMA = 0.14
const SEEDS_PER_EVAL = 3

export class Evolution {
  constructor({ onSnapshot, onGeneration, onNewBest }) {
    this.rng = mulberry32((Math.random() * 2 ** 31) | 0)
    this.onSnapshot = onSnapshot
    this.onGeneration = onGeneration
    this.onNewBest = onNewBest

    this.generation = 0
    this.population = Array.from({ length: POP_SIZE }, () => randomGenome(this.rng))
    this.history = [] // {gen, best, mean}
    this.bestEver = null // {genome, fitness, generation, seed, waves}
    this.running = false
    this.paused = false

    const n = Math.min(8, Math.max(2, (navigator.hardwareConcurrency || 4) - 1))
    this.workers = Array.from({ length: n }, (_, i) => {
      const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
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
      this.pendingResults?.set(msg.index, { fitness: msg.fitness, waves: msg.waves })
      this.checkGenerationDone?.()
    }
  }

  seedsForGeneration() {
    // Graines fixes pour tout le run : la tâche reste identique d'une
    // génération à l'autre, donc la courbe de fitness reflète bien
    // l'apprentissage et pas le hasard des vagues.
    return Array.from({ length: SEEDS_PER_EVAL }, (_, i) => (11 + i * 104729) >>> 0)
  }

  evaluate() {
    return new Promise((resolve) => {
      this.pendingResults = new Map()
      const seeds = this.seedsForGeneration(this.generation)
      this.checkGenerationDone = () => {
        if (this.pendingResults.size >= this.population.length) {
          this.checkGenerationDone = null
          resolve(this.pendingResults)
        }
      }
      // Répartition round-robin sur les workers
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

  crossover(a, b) {
    // Croisement par blocs : chaque héros hérite de tous les gènes d'un
    // même parent, pour préserver les stratégies cohérentes.
    const child = new Float32Array(GENOME_SIZE)
    for (let h = 0; h < HERO_CLASSES.length; h++) {
      const src = this.rng() < 0.5 ? a : b
      for (let i = 0; i < GENES_PER_HERO; i++) {
        child[h * GENES_PER_HERO + i] = src[h * GENES_PER_HERO + i]
      }
    }
    return child
  }

  mutate(genome) {
    for (let h = 0; h < HERO_CLASSES.length; h++) {
      for (let i = 0; i < GENES_PER_HERO; i++) {
        if (this.rng() < MUTATION_RATE) {
          const spec = GENES[i]
          const span = spec.max - spec.min
          // Approximation gaussienne (somme de 3 uniformes)
          const gauss = (this.rng() + this.rng() + this.rng()) / 1.5 - 1
          const idx = h * GENES_PER_HERO + i
          genome[idx] = Math.min(spec.max, Math.max(spec.min, genome[idx] + gauss * span * MUTATION_SIGMA))
        }
      }
    }
    return genome
  }

  async runGeneration() {
    const results = await this.evaluate()
    const scored = this.population.map((genome, i) => ({
      genome,
      fitness: results.get(i).fitness,
      waves: results.get(i).waves,
    }))
    scored.sort((a, b) => b.fitness - a.fitness)

    const best = scored[0]
    const mean = scored.reduce((s, x) => s + x.fitness, 0) / scored.length
    this.history.push({ gen: this.generation, best: best.fitness, mean })

    if (!this.bestEver || best.fitness > this.bestEver.fitness) {
      const previous = this.bestEver
      this.bestEver = {
        genome: best.genome.slice(),
        fitness: best.fitness,
        waves: best.waves,
        generation: this.generation,
        seed: this.seedsForGeneration(this.generation)[0],
      }
      this.onNewBest?.(this.bestEver, previous)
    }
    this.onGeneration?.(this.generation, best.fitness, mean, this.bestEver)

    // Nouvelle population : élites intactes + enfants + sang neuf
    const next = []
    for (let i = 0; i < ELITES; i++) next.push(scored[i].genome.slice())
    for (let i = 0; i < FRESH; i++) next.push(randomGenome(this.rng))
    while (next.length < POP_SIZE) {
      const child = this.crossover(this.tournament(scored), this.tournament(scored))
      next.push(this.mutate(child))
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
      // Laisse respirer le fil principal entre deux générations
      await new Promise((r) => setTimeout(r, 30))
    }
  }

  stop() {
    this.running = false
    for (const w of this.workers) w.terminate()
  }
}
