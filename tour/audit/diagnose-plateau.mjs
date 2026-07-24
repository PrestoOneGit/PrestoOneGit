// Pourquoi la progression plafonne-t-elle ?
//
// Trois causes possibles, qui ne se corrigent pas du tout pareil :
//
//   (a) MUR ARITHMÉTIQUE — les monstres montent en puissance plus vite
//       que les agents. Aucun jeu, même parfait, ne passe l'étage N.
//   (b) SATURATION DE LA RECHERCHE — le génome est trop grand pour la
//       population : l'évolution n'explore plus rien d'utile.
//   (c) MANQUE DE LEVIERS — les agents jouent déjà au maximum de ce que
//       les règles permettent ; il faut enrichir le jeu, pas l'algo.
//
// Ce script mesure les trois. Lancer : node audit/diagnose-plateau.mjs

import { TowerRun, runTower, mulberry32, TICK } from '../src/sim/engine.js'
import { randomTeamGenome, crossoverTeams, mutateTeam, TEAM_GENOME_SIZE, describeComposition } from '../src/sim/brain.js'
import {
  CLASSES, FLOOR_BUDGET, HERO_GROWTH, MONSTER_GROWTH, MONSTERS, UPGRADES, tierForFloor,
} from '../src/sim/data.js'
import { mean } from './stats.js'

const SEEDS = [11, 104740, 209469, 314198]

console.log('DIAGNOSTIC DU PLATEAU\n')

// ---------------------------------------------------------------------
// (a) LE MUR ARITHMÉTIQUE
// Rapport de puissance entre ce que l'équipe encaisse/inflige et ce que
// l'étage oppose, en supposant un jeu parfait.
// ---------------------------------------------------------------------
console.log('(a) MUR ARITHMÉTIQUE — croissance comparée\n')
console.log('  étage   agents   monstres   budget   PV totaux étage   ratio monstres/agents')
console.log('  ' + '─'.repeat(74))

const baseHeroHp = CLASSES.reduce((s, c) => s + c.hp, 0)
for (const floor of [1, 5, 10, 15, 20, 25, 30, 40]) {
  const heroMult = Math.pow(HERO_GROWTH, floor - 1)
  const monMult = Math.pow(MONSTER_GROWTH, floor - 1)
  const tier = tierForFloor(floor)
  const avgCost = mean(tier.pool.map((t) => MONSTERS[t].cost))
  const avgHp = mean(tier.pool.map((t) => MONSTERS[t].hp))
  const count = FLOOR_BUDGET(floor) / avgCost
  const floorHp = count * avgHp * monMult
  const teamHp = baseHeroHp * heroMult
  console.log(
    `  ${String(floor).padStart(4)}    ${heroMult.toFixed(2)}×     ${monMult.toFixed(2)}×    ${String(FLOOR_BUDGET(floor)).padStart(4)}    ` +
      `${Math.round(floorHp).toLocaleString('fr-FR').padStart(10)}        ${(floorHp / teamHp).toFixed(1)}×`
  )
}
console.log(
  `\n  Les monstres croissent de ${((MONSTER_GROWTH - 1) * 100).toFixed(1)} % par étage, les agents de ${((HERO_GROWTH - 1) * 100).toFixed(1)} %.`
)
const gapDouble = Math.log(2) / Math.log(MONSTER_GROWTH / HERO_GROWTH)
console.log(`  L'écart de puissance DOUBLE tous les ${gapDouble.toFixed(0)} étages, et le nombre de monstres croît en plus linéairement.`)

// ---------------------------------------------------------------------
// (b) SATURATION DE LA RECHERCHE
// Un génome de ~12 000 paramètres exploré par 32 individus : combien de
// dimensions une génération peut-elle réellement tester ?
// ---------------------------------------------------------------------
console.log('\n(b) SATURATION DE LA RECHERCHE\n')
const POP = 32
console.log(`  Génome            : ${TEAM_GENOME_SIZE.toLocaleString('fr-FR')} paramètres`)
console.log(`  Population        : ${POP} équipes par génération`)
console.log(`  Rapport           : ${(TEAM_GENOME_SIZE / POP).toFixed(0)} paramètres par individu évalué`)
console.log('  Repère : un algorithme génétique explore correctement jusqu’à quelques')
console.log('  centaines de paramètres avec une population de cette taille. Au-delà,')
console.log('  chaque génération ne teste qu’une fraction infime de l’espace.')

// ---------------------------------------------------------------------
// (c) LES LEVIERS SONT-ILS DÉJÀ SATURÉS ?
// Si les agents utilisent déjà tout ce que les règles offrent, le plafond
// vient du jeu et non de l'apprentissage.
// ---------------------------------------------------------------------
console.log('\n(c) LEVIERS TACTIQUES — que fait une équipe entraînée ?\n')
console.log('  (courte évolution pour obtenir un champion, puis analyse de son run)')

const rng = mulberry32(4242)
let population = Array.from({ length: POP }, () => randomTeamGenome(rng))
let best = null
for (let gen = 0; gen < 25; gen++) {
  const scored = population.map((g) => {
    let f = 0
    for (const s of SEEDS) f += runTower(g, s, null, 40, { emitEvents: false }).fitness
    return { g, f: f / SEEDS.length }
  })
  scored.sort((a, b) => b.f - a.f)
  if (!best || scored[0].f > best.f) best = scored[0]
  const next = scored.slice(0, 4).map((s) => s.g.slice())
  next.push(randomTeamGenome(rng), randomTeamGenome(rng))
  const pick = () => {
    let w = null
    for (let i = 0; i < 3; i++) {
      const c = scored[Math.floor(rng() * scored.length)]
      if (!w || c.f > w.f) w = c
    }
    return w.g
  }
  while (next.length < POP) next.push(mutateTeam(rng, crossoverTeams(rng, pick(), pick())))
  population = next
}

const run = new TowerRun(best.g, SEEDS[0], { logging: true })
let guard = 0
while (!run.finished && guard++ < 500000) run.step(TICK)

console.log(`\n  Champion : ${describeComposition(best.g)} — étage ${run.floor}, issue « ${run.endReason} »`)
console.log('\n  agent          niv  capacité 1  capacité 2  capacité 3  base   dash  course  bond')
console.log('  ' + '─'.repeat(80))
for (const h of run.heroes) {
  const a = h.stats.abilities
  console.log(
    `  ${h.cls.label.padEnd(12)}  ${String(h.level).padStart(3)}  ${String(a[0]).padStart(9)}  ${String(a[1]).padStart(10)}  ` +
      `${String(a[2]).padStart(10)}  ${String(h.stats.basic).padStart(4)}  ${String(h.stats.dash).padStart(5)}  ` +
      `${String(h.stats.sprint).padStart(6)}  ${String(h.stats.jump).padStart(4)}`
  )
}

const totalAbility = run.heroes.reduce((s, h) => s + h.stats.abilities.reduce((x, y) => x + y, 0), 0)
const totalBasic = run.heroes.reduce((s, h) => s + h.stats.basic, 0)
const unusedAbilities = run.heroes.flatMap((h) =>
  h.stats.abilities.map((n, i) => (n === 0 ? `${h.cls.label}/${h.cls.abilities[i].label}` : null))
).filter(Boolean)

console.log(`\n  Capacités lancées : ${totalAbility} · attaques de base : ${totalBasic}`)
console.log(`  Part des capacités dans les actions : ${((100 * totalAbility) / (totalAbility + totalBasic)).toFixed(0)} %`)
if (unusedAbilities.length) {
  console.log(`  JAMAIS utilisées (${unusedAbilities.length}) : ${unusedAbilities.join(', ')}`)
} else {
  console.log('  Toutes les capacités de l’équipe ont servi.')
}

// Diversité des améliorations choisies
const upCounts = new Array(UPGRADES.length).fill(0)
for (const h of run.heroes) h.upgrades.forEach((n, i) => (upCounts[i] += n))
const totalUp = upCounts.reduce((a, b) => a + b, 0)
console.log(
  '\n  Améliorations choisies : ' +
    (totalUp === 0
      ? 'aucune (le run s’arrête avant l’étage 5)'
      : UPGRADES.map((u, i) => `${u.label} ${upCounts[i]}`).join(' · '))
)

// Où meurent les équipes, et comment ?
console.log('\n  Fin de run sur 12 graines inédites :')
const outcomes = {}
const floors = []
for (let i = 0; i < 12; i++) {
  const r = runTower(best.g, 700001 + i * 5171, null, 40, { emitEvents: false })
  outcomes[r.reason] = (outcomes[r.reason] ?? 0) + 1
  floors.push(r.floors + 1)
}
console.log(
  `    étage atteint : min ${Math.min(...floors)}, médian ${floors.sort((a, b) => a - b)[6]}, max ${Math.max(...floors)}`
)
console.log(`    causes : ${Object.entries(outcomes).map(([k, v]) => `${k} ×${v}`).join(', ')}`)

console.log('\n' + '─'.repeat(78))
console.log('LECTURE : si les capacités sont largement utilisées et la mort survient')
console.log('toujours au même étage, le plafond vient du MUR (a), pas de l’apprentissage.')
console.log('Des capacités jamais lancées signalent au contraire des leviers inexploités.')
