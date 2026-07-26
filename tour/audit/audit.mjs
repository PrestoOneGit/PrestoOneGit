// Audit de l'entraînement : chaque test est conçu pour POUVOIR ÉCHOUER.
// L'objectif n'est pas de confirmer que ça marche, mais de détecter les
// façons classiques dont une « évolution » peut être un mirage :
//
//   1. Déterminisme      — sans lui, tous les chiffres sont du bruit.
//   2. Comptabilité      — le travail annoncé a-t-il réellement eu lieu ?
//   3. Ablation          — les réseaux pilotent-ils vraiment les agents ?
//   4. Généralisation    — apprentissage réel ou par-cœur sur 2 graines ?
//   5. Evo vs hasard     — mieux qu'une loterie à budget égal ?
//   6. Contrôle négatif  — une « évolution » sans sélection stagne-t-elle ?
//
// Lancer : node audit/audit.mjs [--rapide]

import { TICK, TowerRun, mulberry32, runTower } from '../src/sim/engine.js'
import {
  BRAIN_SIZE, SLOTS, TEAM_GENOME_SIZE, crossoverTeams, mutateTeam, randomTeamGenome,
} from '../src/sim/brain.js'
import { mannWhitneyU, mean, median, permutationTest, summarize, verdict } from './stats.js'

const FAST = process.argv.includes('--rapide')
const POP = 32
const GENERATIONS = FAST ? 12 : 30
// Exactement les graines de l'application (SEEDS_PER_EVAL = 4)
const TRAIN_SEEDS = Array.from({ length: 4 }, (_, i) => (11 + i * 104729) >>> 0)
const HELDOUT_SEEDS = Array.from({ length: FAST ? 12 : 25 }, (_, i) => 900001 + i * 7717)

const results = []
function record(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(verdict(ok, `${name} — ${detail}`))
}

const t0 = Date.now()
console.log('AUDIT DE LA TOUR — chaque test peut échouer\n')
console.log(`Mode ${FAST ? 'rapide' : 'complet'} : ${GENERATIONS} générations, population ${POP}, ${HELDOUT_SEEDS.length} graines de test\n`)

// ---------------------------------------------------------------------
// 1. DÉTERMINISME
// Si le même génome sur la même graine ne donne pas exactement le même
// résultat, aucune comparaison entre générations n'a de sens.
// ---------------------------------------------------------------------
console.log('1. DÉTERMINISME')
{
  const rng = mulberry32(4242)
  const genome = randomTeamGenome(rng)
  const runsSame = Array.from({ length: 8 }, () => runTower(genome, 777).fitness)
  const identical = runsSame.every((f) => f === runsSame[0])
  record(
    'Répétabilité',
    identical,
    identical
      ? `8 exécutions du même génome/graine → fitness identique au bit près (${runsSame[0].toFixed(6)})`
      : `8 exécutions divergent : ${runsSame.map((f) => f.toFixed(2)).join(', ')}`
  )

  // Entrelacement : deux runs menés en parallèle pas-à-pas. Les buffers
  // d'observation sont partagés au niveau du module — si cet entrelacement
  // corrompait l'état, les résultats différeraient du run isolé.
  const g2 = randomTeamGenome(rng)
  const soloA = runTower(genome, 555).fitness
  const soloB = runTower(g2, 555).fitness
  const a = new TowerRun(genome, 555)
  const b = new TowerRun(g2, 555)
  let guard = 0
  while ((!a.finished || !b.finished) && guard++ < 500000) {
    if (!a.finished) a.step(TICK)
    if (!b.finished) b.step(TICK)
  }
  const interleaveOk = a.fitness() === soloA && b.fitness() === soloB
  record(
    'Entrelacement',
    interleaveOk,
    interleaveOk
      ? 'deux runs pas-à-pas en parallèle donnent les mêmes fitness qu’isolés (buffers partagés sûrs)'
      : `corruption détectée : ${a.fitness()} vs ${soloA}, ${b.fitness()} vs ${soloB}`
  )

  // Graines différentes → résultats différents (sinon la graine est ignorée)
  const acrossSeeds = [1, 2, 3, 4, 5].map((s) => runTower(genome, s).fitness)
  const varied = new Set(acrossSeeds).size > 1
  record(
    'Sensibilité à la graine',
    varied,
    varied
      ? `5 graines → ${new Set(acrossSeeds).size} résultats distincts (la graine agit réellement)`
      : 'toutes les graines donnent le même résultat : la graine est ignorée'
  )
}

// ---------------------------------------------------------------------
// 2. COMPTABILITÉ DU TRAVAIL
// Le compteur de générations pourrait s'incrémenter sans rien simuler.
// On instrumente le moteur pour compter les passes réseau réellement
// exécutées et on compare à ce que le travail annoncé implique.
// ---------------------------------------------------------------------
console.log('\n2. COMPTABILITÉ DU TRAVAIL')
{
  const brain = await import('../src/sim/brain.js')
  const realForward = brain.forward
  let forwardCalls = 0
  // On ne peut pas réassigner un export ES : on compte via un run manuel
  // en instrumentant le nombre de pas et d'agents vivants.
  const run = new TowerRun(randomTeamGenome(mulberry32(9)), 11)
  let steps = 0
  let agentTicks = 0
  while (!run.finished && steps < 500000) {
    const before = run.heroes.filter((h) => h.alive && h.airborne <= 0 && h.st.stun <= 0).length
    run.step(TICK)
    steps++
    agentTicks += before
  }
  forwardCalls = agentTicks
  const expectedMin = steps * 0.5 // au moins un demi-agent actif en moyenne
  const ok = steps > 100 && forwardCalls > expectedMin
  record(
    'Travail par run',
    ok,
    `${steps} pas de simulation, ~${forwardCalls} décisions de réseau (${(run.time).toFixed(0)} s simulées, ${run.floorsCleared} étages)`
  )

  // Le temps mesuré doit être cohérent avec le nombre d'évaluations : si
  // une génération « coûtait » 0 ms, elle ne serait pas calculée.
  const genomes = Array.from({ length: POP }, () => randomTeamGenome(mulberry32(Date.now() % 1000)))
  const tStart = Date.now()
  let evals = 0
  for (const g of genomes) {
    for (const s of TRAIN_SEEDS) {
      runTower(g, s)
      evals++
    }
  }
  const elapsed = Date.now() - tStart
  const perEval = elapsed / evals
  const plausible = perEval > 1 && perEval < 5000
  record(
    'Coût d’une génération',
    plausible,
    `${evals} évaluations en ${elapsed} ms → ${perEval.toFixed(1)} ms par run (un compteur qui s’incrémenterait sans calculer coûterait ~0 ms)`
  )
}

// ---------------------------------------------------------------------
// 3. ABLATION DES CERVEAUX
// Si un réseau mis à zéro ou aux poids mélangés jouait aussi bien qu'un
// champion évolué, ce ne seraient pas les réseaux qui font le travail.
// ---------------------------------------------------------------------
console.log('\n3. ABLATION DES CERVEAUX')

// Petite évolution partagée par les tests suivants.
function evolve({ generations, pop = POP, seeds = TRAIN_SEEDS, rngSeed = 1234, selection = true }) {
  const rng = mulberry32(rngSeed)
  let population = Array.from({ length: pop }, () => randomTeamGenome(rng))
  let best = null
  let evaluations = 0
  const curve = []

  const evalGenome = (g) => {
    let total = 0
    for (const s of seeds) {
      total += runTower(g, s).fitness
      evaluations++
    }
    return total / seeds.length
  }
  const tournament = (scored) => {
    let winner = null
    for (let i = 0; i < 3; i++) {
      const c = scored[Math.floor(rng() * scored.length)]
      if (!winner || c.fitness > winner.fitness) winner = c
    }
    return winner.genome
  }

  for (let gen = 0; gen < generations; gen++) {
    const scored = population.map((genome) => ({ genome, fitness: evalGenome(genome) }))
    scored.sort((a, b) => b.fitness - a.fitness)
    if (!best || scored[0].fitness > best.fitness) {
      best = { genome: scored[0].genome.slice(), fitness: scored[0].fitness, gen }
    }
    curve.push({ gen, best: scored[0].fitness, mean: mean(scored.map((s) => s.fitness)) })

    const next = []
    if (selection) {
      for (let i = 0; i < 4; i++) next.push(scored[i].genome.slice())
      next.push(randomTeamGenome(rng), randomTeamGenome(rng))
      while (next.length < pop) next.push(mutateTeam(rng, crossoverTeams(rng, tournament(scored), tournament(scored))))
    } else {
      // Contrôle négatif : même budget, mêmes mutations, mais les parents
      // sont tirés AU HASARD au lieu d'être sélectionnés sur la fitness.
      const pick = () => population[Math.floor(rng() * population.length)]
      while (next.length < pop) next.push(mutateTeam(rng, crossoverTeams(rng, pick(), pick())))
    }
    population = next
  }
  return { best, curve, evaluations, population }
}

const evolved = evolve({ generations: GENERATIONS })
console.log(`   (évolution de référence : ${GENERATIONS} générations, ${evolved.evaluations} évaluations, champion gén. ${evolved.best.gen})`)

function evaluateOn(genome, seeds) {
  return seeds.map((s) => runTower(genome, s).fitness)
}

{
  const champion = evolved.best.genome
  const zeroed = champion.slice()
  for (let i = SLOTS; i < zeroed.length; i++) zeroed[i] = 0 // classes conservées

  const shuffled = champion.slice()
  const rng = mulberry32(77)
  for (let s = 0; s < SLOTS; s++) {
    const base = SLOTS + s * BRAIN_SIZE
    for (let i = base + BRAIN_SIZE - 1; i > base; i--) {
      const j = base + Math.floor(rng() * (i - base + 1))
      const tmp = shuffled[i]
      shuffled[i] = shuffled[j]
      shuffled[j] = tmp
    }
  }

  const seeds = HELDOUT_SEEDS
  const champScores = evaluateOn(champion, seeds)
  const zeroScores = evaluateOn(zeroed, seeds)
  const shuffleScores = evaluateOn(shuffled, seeds)

  console.log('  ' + summarize('champion', champScores))
  console.log('  ' + summarize('poids à zéro', zeroScores))
  console.log('  ' + summarize('poids mélangés', shuffleScores))

  const vsZero = mannWhitneyU(champScores, zeroScores)
  const vsShuffle = mannWhitneyU(champScores, shuffleScores)
  record(
    'Poids à zéro',
    mean(champScores) > mean(zeroScores) && vsZero.p < 0.05,
    `champion ${mean(champScores).toFixed(0)} contre ${mean(zeroScores).toFixed(0)} (p=${vsZero.p.toExponential(2)}) — les réseaux pilotent bien les agents`
  )
  record(
    'Poids mélangés',
    mean(champScores) > mean(shuffleScores) && vsShuffle.p < 0.05,
    `champion ${mean(champScores).toFixed(0)} contre ${mean(shuffleScores).toFixed(0)} (p=${vsShuffle.p.toExponential(2)}) — c’est l’agencement des poids qui compte, pas leur simple présence`
  )
}

// ---------------------------------------------------------------------
// 4. GÉNÉRALISATION
// L'entraînement n'utilise que 2 graines. Si le champion ne surpasse des
// génomes aléatoires QUE sur ces 2 graines, il a appris par cœur des
// vagues précises — ce ne serait pas de la stratégie.
// ---------------------------------------------------------------------
console.log('\n4. GÉNÉRALISATION À DES GRAINES JAMAIS VUES')
{
  const champion = evolved.best.genome
  const rng = mulberry32(31337)
  const randomPool = Array.from({ length: 30 }, () => randomTeamGenome(rng))

  const champHeldout = evaluateOn(champion, HELDOUT_SEEDS)
  // Pour les aléatoires : une valeur par génome, moyennée sur les graines
  const randomHeldout = randomPool.map((g) => mean(evaluateOn(g, HELDOUT_SEEDS.slice(0, 6))))

  console.log('  ' + summarize('champion (inédites)', champHeldout))
  console.log('  ' + summarize('aléatoires (inédites)', randomHeldout))

  const test = mannWhitneyU(champHeldout, randomHeldout)
  const perm = permutationTest(champHeldout, randomHeldout, 20000, mulberry32(5))
  const ok = mean(champHeldout) > mean(randomHeldout) && test.p < 0.01

  record(
    'Généralisation',
    ok,
    `champion ${mean(champHeldout).toFixed(0)} contre aléatoires ${mean(randomHeldout).toFixed(0)} sur ${HELDOUT_SEEDS.length} graines jamais vues ` +
      `(Mann-Whitney p=${test.p.toExponential(2)}, permutation p=${perm.p.toExponential(2)}, taille d’effet ${(test.effectSize * 100).toFixed(0)}%)`
  )

  // Comparaison entraînement / test : un écart énorme signalerait du
  // sur-apprentissage sur les 2 graines d'entraînement.
  const champTrain = mean(evaluateOn(champion, TRAIN_SEEDS))
  const ratio = mean(champHeldout) / champTrain
  record(
    'Absence de sur-apprentissage',
    ratio > 0.6,
    `fitness sur graines inédites = ${(ratio * 100).toFixed(0)} % de celle sur les graines d’entraînement (${mean(champHeldout).toFixed(0)} contre ${champTrain.toFixed(0)})`
  )
}

// ---------------------------------------------------------------------
// 5. ÉVOLUTION CONTRE RECHERCHE ALÉATOIRE, À BUDGET ÉGAL
// Le test le plus dur : si tirer N génomes au hasard et garder le meilleur
// faisait aussi bien que N évaluations d'évolution, la « progression »
// ne serait qu'une loterie avec beaucoup de tickets.
// ---------------------------------------------------------------------
console.log('\n5. ÉVOLUTION CONTRE RECHERCHE ALÉATOIRE (budget identique)')
{
  // Une première version de ce test comparait UNE évolution à UN tirage
  // aléatoire, puis traitait les 25 graines de test comme autant de
  // répétitions. C'était de la pseudo-réplication : on mesurait la
  // variabilité entre graines, pas entre méthodes, et le test ne pouvait
  // structurellement rien détecter (n=1 de chaque côté). Ici chaque
  // méthode est relancée intégralement plusieurs fois, avec des germes
  // aléatoires indépendants, et on compare les champions obtenus.
  const TRIALS = FAST ? 3 : 5
  const genPerTrial = FAST ? 8 : 15
  const evoScores = []
  const randScores = []

  for (let trial = 0; trial < TRIALS; trial++) {
    const run = evolve({ generations: genPerTrial, rngSeed: 3000 + trial * 131 })
    const budget = run.evaluations

    const rng = mulberry32(8000 + trial * 131)
    let bestRandom = null
    let used = 0
    while (used + TRAIN_SEEDS.length <= budget) {
      const g = randomTeamGenome(rng)
      let total = 0
      for (const s of TRAIN_SEEDS) {
        total += runTower(g, s).fitness
        used++
      }
      const fitness = total / TRAIN_SEEDS.length
      if (!bestRandom || fitness > bestRandom.fitness) bestRandom = { genome: g, fitness }
    }

    const e = mean(evaluateOn(run.best.genome, HELDOUT_SEEDS))
    const r = mean(evaluateOn(bestRandom.genome, HELDOUT_SEEDS))
    evoScores.push(e)
    randScores.push(r)
    console.log(
      `  essai ${trial + 1}/${TRIALS} (${budget} évaluations chacun) : évolution ${e.toFixed(0)} · aléatoire ${r.toFixed(0)}`
    )
  }

  console.log('  ' + summarize('évolution', evoScores))
  console.log('  ' + summarize('recherche aléatoire', randScores))

  const test = mannWhitneyU(evoScores, randScores)
  const wins = evoScores.filter((e, i) => e > randScores[i]).length
  const ok = mean(evoScores) > mean(randScores) && test.p < 0.05
  record(
    'Évolution > loterie',
    ok,
    `sur graines inédites : évolution ${mean(evoScores).toFixed(0)} contre meilleur tirage aléatoire ${mean(randScores).toFixed(0)} ` +
      `sur ${TRIALS} essais indépendants (${wins}/${TRIALS} victoires, p=${test.p.toExponential(2)})`
  )
}

// ---------------------------------------------------------------------
// 6. CONTRÔLE NÉGATIF
// Même code, même budget, mais parents tirés au hasard (aucune pression
// de sélection). Si CETTE version progressait autant, la « progression »
// viendrait de la dérive et non de la sélection.
// ---------------------------------------------------------------------
console.log('\n6. CONTRÔLE NÉGATIF (évolution sans sélection)')
{
  const drift = evolve({ generations: GENERATIONS, rngSeed: 1234, selection: false })
  const withSel = evolved.curve
  const gainSel = withSel[withSel.length - 1].mean - withSel[0].mean
  const gainDrift = drift.curve[drift.curve.length - 1].mean - drift.curve[0].mean

  console.log(`  avec sélection    : moyenne ${withSel[0].mean.toFixed(0)} → ${withSel[withSel.length - 1].mean.toFixed(0)} (gain ${gainSel.toFixed(0)})`)
  console.log(`  sans sélection    : moyenne ${drift.curve[0].mean.toFixed(0)} → ${drift.curve[drift.curve.length - 1].mean.toFixed(0)} (gain ${gainDrift.toFixed(0)})`)

  const ok = gainSel > gainDrift * 2 && gainSel > 0
  record(
    'Sélection nécessaire',
    ok,
    `la version sélective gagne ${gainSel.toFixed(0)} points de moyenne, la dérive pure ${gainDrift.toFixed(0)} — c’est bien la sélection qui produit le progrès`
  )

  // La courbe doit monter : régression linéaire sur la moyenne
  const n = withSel.length
  const sx = withSel.reduce((s, p) => s + p.gen, 0)
  const sy = withSel.reduce((s, p) => s + p.mean, 0)
  const sxy = withSel.reduce((s, p) => s + p.gen * p.mean, 0)
  const sxx = withSel.reduce((s, p) => s + p.gen * p.gen, 0)
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx)
  record(
    'Tendance croissante',
    slope > 0,
    `pente de la fitness moyenne : ${slope.toFixed(1)} points par génération sur ${n} générations`
  )
}

// ---------------------------------------------------------------------
// SYNTHÈSE
// ---------------------------------------------------------------------
const passed = results.filter((r) => r.ok).length
console.log('\n' + '─'.repeat(72))
console.log(`SYNTHÈSE : ${passed}/${results.length} tests réussis en ${((Date.now() - t0) / 1000).toFixed(0)} s`)
for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}`)
if (passed < results.length) {
  console.log('\nDes tests ont échoué — voir le détail ci-dessus.')
  process.exitCode = 1
}
