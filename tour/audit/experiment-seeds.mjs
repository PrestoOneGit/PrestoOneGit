// Pourquoi l'évolution n'écrase-t-elle pas la recherche aléatoire ?
//
// Hypothèse : avec seulement 2 graines d'évaluation, le champion est le
// maximum d'une distribution bruitée — il est autant « chanceux sur ces
// deux configurations » que « bon ». On sélectionne donc en partie du
// hasard, et cette part ne se transmet pas aux enfants.
//
// Ce script fait varier le nombre de graines à BUDGET DE RUNS CONSTANT :
// plus de graines = évaluation plus fiable mais moins de génomes essayés.
// S'il existe un optimum net, c'est la preuve que le réglage compte, et
// on saura lequel choisir pour la phase GPU.
//
// Lancer : node audit/experiment-seeds.mjs

import { runTower, mulberry32 } from '../src/sim/engine.js'
import { crossoverTeams, mutateTeam, randomTeamGenome } from '../src/sim/brain.js'
import { mannWhitneyU, mean, summarize } from './stats.js'

const BUDGET = 2400 // runs de tour, identique pour toutes les conditions
const POP = 32
const HELDOUT = Array.from({ length: 25 }, (_, i) => 900001 + i * 7717)
const TRIALS = 3 // répétitions indépendantes, pour ne pas conclure sur un coup de chance

function trainSeeds(n) {
  return Array.from({ length: n }, (_, i) => (11 + i * 104729) >>> 0)
}

function evolve({ seedCount, budget, rngSeed }) {
  const rng = mulberry32(rngSeed)
  const seeds = trainSeeds(seedCount)
  let population = Array.from({ length: POP }, () => randomTeamGenome(rng))
  let best = null
  let used = 0

  const evalGenome = (g) => {
    let total = 0
    for (const s of seeds) {
      total += runTower(g, s).fitness
      used++
    }
    return total / seeds.length
  }
  const tournament = (scored) => {
    let w = null
    for (let i = 0; i < 3; i++) {
      const c = scored[Math.floor(rng() * scored.length)]
      if (!w || c.fitness > w.fitness) w = c
    }
    return w.genome
  }

  let generations = 0
  while (used + POP * seedCount <= budget) {
    const scored = population.map((genome) => ({ genome, fitness: evalGenome(genome) }))
    scored.sort((a, b) => b.fitness - a.fitness)
    if (!best || scored[0].fitness > best.fitness) {
      best = { genome: scored[0].genome.slice(), fitness: scored[0].fitness }
    }
    const next = []
    for (let i = 0; i < 4; i++) next.push(scored[i].genome.slice())
    next.push(randomTeamGenome(rng), randomTeamGenome(rng))
    while (next.length < POP) {
      next.push(mutateTeam(rng, crossoverTeams(rng, tournament(scored), tournament(scored))))
    }
    population = next
    generations++
  }
  return { best, generations, used }
}

function randomSearch({ seedCount, budget, rngSeed }) {
  const rng = mulberry32(rngSeed)
  const seeds = trainSeeds(seedCount)
  let best = null
  let used = 0
  while (used + seedCount <= budget) {
    const g = randomTeamGenome(rng)
    let total = 0
    for (const s of seeds) {
      total += runTower(g, s).fitness
      used++
    }
    const fitness = total / seeds.length
    if (!best || fitness > best.fitness) best = { genome: g, fitness }
  }
  return { best, used }
}

// Vérité terrain : la performance sur 25 graines jamais vues.
function heldout(genome) {
  return HELDOUT.map((s) => runTower(genome, s).fitness)
}

console.log('EXPÉRIENCE : combien de graines par évaluation ?\n')
console.log(`Budget constant : ${BUDGET} runs par condition · population ${POP} · ${TRIALS} répétitions`)
console.log(`Vérité terrain : ${HELDOUT.length} graines jamais vues à l’entraînement\n`)

const conditions = [2, 4, 8]
const table = []

for (const seedCount of conditions) {
  const evoScores = []
  const randScores = []
  let gens = 0
  for (let trial = 0; trial < TRIALS; trial++) {
    const e = evolve({ seedCount, budget: BUDGET, rngSeed: 1000 + trial * 97 })
    const r = randomSearch({ seedCount, budget: BUDGET, rngSeed: 5000 + trial * 97 })
    gens = e.generations
    evoScores.push(mean(heldout(e.best.genome)))
    randScores.push(mean(heldout(r.best.genome)))
    // Biais de sélection : écart entre score annoncé et score réel
    const bias = ((e.best.fitness - evoScores[evoScores.length - 1]) / e.best.fitness) * 100
    console.log(
      `  ${seedCount} graines · essai ${trial + 1} : ${e.generations} générations · ` +
        `évolution ${evoScores[evoScores.length - 1].toFixed(0)} (annoncé ${e.best.fitness.toFixed(0)}, biais ${bias.toFixed(0)} %) · ` +
        `aléatoire ${randScores[randScores.length - 1].toFixed(0)}`
    )
  }
  table.push({ seedCount, gens, evo: mean(evoScores), rand: mean(randScores), evoScores, randScores })
}

console.log('\n' + '─'.repeat(78))
console.log('RÉSULTATS (moyenne sur graines inédites, plus haut = mieux)\n')
console.log('  graines  générations   évolution   aléatoire   avantage')
console.log('  ' + '─'.repeat(56))
for (const row of table) {
  const adv = row.evo - row.rand
  console.log(
    `    ${String(row.seedCount).padStart(2)}        ${String(row.gens).padStart(3)}       ` +
      `${row.evo.toFixed(0).padStart(7)}     ${row.rand.toFixed(0).padStart(7)}     ${adv >= 0 ? '+' : ''}${adv.toFixed(0).padStart(6)}`
  )
}

// Test global : toutes conditions confondues, l'évolution devance-t-elle ?
const allEvo = table.flatMap((r) => r.evoScores)
const allRand = table.flatMap((r) => r.randScores)
const test = mannWhitneyU(allEvo, allRand)
console.log('\n  ' + summarize('évolution (toutes)', allEvo))
console.log('  ' + summarize('aléatoire (toutes)', allRand))
console.log(`\n  Mann-Whitney : p=${test.p.toFixed(3)}, taille d’effet ${(test.effectSize * 100).toFixed(0)} %`)

const bestRow = table.reduce((a, b) => (b.evo - b.rand > a.evo - a.rand ? b : a))
console.log(
  `\n  Meilleur réglage : ${bestRow.seedCount} graines par évaluation ` +
    `(avantage ${(bestRow.evo - bestRow.rand).toFixed(0)} points sur la recherche aléatoire).`
)
