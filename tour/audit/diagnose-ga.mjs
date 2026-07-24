// Diagnostic de l'algorithme génétique lui-même.
//
// L'audit a montré qu'à budget égal, l'évolution ne devançait pas encore
// la recherche aléatoire. Deux explications possibles, et elles ne se
// corrigent pas de la même façon :
//
//   (a) il faut simplement plus de générations — l'avantage de
//       l'évolution se compose, celui du tirage aléatoire plafonne ;
//   (b) les mutations sont trop destructrices — les enfants n'héritent
//       de rien d'exploitable et chaque génération repart de zéro.
//
// Ce script mesure directement (b) : à quelle fréquence un enfant fait-il
// mieux que ses parents, et comment cela dépend-il de l'intensité de
// mutation ? Un taux de réussite proche de zéro signerait une évolution
// qui « bricole du hasard » au lieu de raffiner.
//
// Lancer : node audit/diagnose-ga.mjs

import { runTower, mulberry32 } from '../src/sim/engine.js'
import { SLOTS, TEAM_GENOME_SIZE, crossoverTeams, randomTeamGenome } from '../src/sim/brain.js'
import { mean, median, summarize } from './stats.js'

const SEEDS = [11, 104740]
const rng = mulberry32(20260724)

function evaluate(genome) {
  let total = 0
  for (const s of SEEDS) total += runTower(genome, s).fitness
  return total / SEEDS.length
}

function gauss(r) {
  return (r() + r() + r()) / 1.5 - 1
}

// Mutation à paramètres imposés, pour balayer l'espace (rate, sigma).
function mutateWith(genome, rate, sigma) {
  const g = genome.slice()
  for (let i = SLOTS; i < g.length; i++) {
    if (rng() < rate) g[i] += gauss(rng) * sigma
  }
  return g
}

console.log('DIAGNOSTIC DE L’ALGORITHME GÉNÉTIQUE\n')
console.log(`Génome : ${TEAM_GENOME_SIZE} paramètres (${SLOTS} agents)\n`)

// ---------------------------------------------------------------------
// 1. Un parent décent, obtenu par une courte évolution
// ---------------------------------------------------------------------
console.log('Préparation d’un parent de référence…')
let population = Array.from({ length: 24 }, () => randomTeamGenome(rng))
let parent = null
for (let gen = 0; gen < 8; gen++) {
  const scored = population.map((g) => ({ g, f: evaluate(g) }))
  scored.sort((a, b) => b.f - a.f)
  parent = scored[0]
  const next = scored.slice(0, 4).map((s) => s.g.slice())
  while (next.length < 24) {
    const a = scored[Math.floor(rng() * 8)].g
    const b = scored[Math.floor(rng() * 8)].g
    next.push(mutateWith(crossoverTeams(rng, a, b), 0.06, 0.2))
  }
  population = next
}
console.log(`Parent de référence : fitness ${parent.f.toFixed(0)}\n`)

// ---------------------------------------------------------------------
// 2. Balayage : quelle intensité de mutation produit des enfants utiles ?
// ---------------------------------------------------------------------
console.log('Taux d’enfants meilleurs que leur parent, par intensité de mutation')
console.log('(40 enfants par réglage — un taux nul signifierait que la mutation détruit tout)\n')
console.log('  taux    sigma   enfants>parent   fitness médiane   meilleur')
console.log('  ' + '─'.repeat(62))

const CHILDREN = 40
const settings = [
  { rate: 0.01, sigma: 0.05 },
  { rate: 0.02, sigma: 0.1 },
  { rate: 0.04, sigma: 0.15 },
  { rate: 0.06, sigma: 0.2 },
  { rate: 0.1, sigma: 0.3 },
  { rate: 0.12, sigma: 0.4 },
  // Réglages actuels de l'application : tirés au hasard par enfant
  { rate: 0.07, sigma: 0.2, label: '≈ actuel (moyen)' },
]

const rows = []
for (const s of settings) {
  const scores = []
  for (let i = 0; i < CHILDREN; i++) {
    scores.push(evaluate(mutateWith(parent.g, s.rate, s.sigma)))
  }
  const better = scores.filter((f) => f > parent.f).length
  rows.push({ ...s, better, med: median(scores), best: Math.max(...scores) })
  console.log(
    `  ${s.rate.toFixed(2)}    ${s.sigma.toFixed(2)}    ${String(better).padStart(3)}/${CHILDREN} (${((better / CHILDREN) * 100).toFixed(0)}%)` +
      `        ${median(scores).toFixed(0).padStart(6)}          ${Math.max(...scores).toFixed(0).padStart(6)}` +
      (s.label ? `   ${s.label}` : '')
  )
}

// ---------------------------------------------------------------------
// 3. Comparaison : enfants mutés contre génomes entièrement aléatoires
// ---------------------------------------------------------------------
console.log('\nEnfants mutés contre génomes entièrement aléatoires')
const best = rows.reduce((a, b) => (b.better > a.better ? b : a))
const mutatedScores = Array.from({ length: 40 }, () =>
  evaluate(mutateWith(parent.g, best.rate, best.sigma))
)
const randomScores = Array.from({ length: 40 }, () => evaluate(randomTeamGenome(rng)))
console.log('  ' + summarize('enfants (meilleur réglage)', mutatedScores))
console.log('  ' + summarize('génomes aléatoires', randomScores))
console.log(`  parent : ${parent.f.toFixed(0)}`)

const heritability = mean(mutatedScores) / mean(randomScores)
console.log(
  `\n  Héritabilité : les enfants valent ${heritability.toFixed(2)}× un génome aléatoire.`
)
console.log(
  heritability > 1.15
    ? '  → La descendance hérite bien de la qualité du parent : la recombinaison a du sens.'
    : '  → La descendance ne vaut pas mieux qu’un tirage au hasard : la mutation efface l’acquis.'
)

console.log(`\n  Meilleur réglage observé : taux ${best.rate}, sigma ${best.sigma} (${best.better}/${CHILDREN} enfants meilleurs)`)
