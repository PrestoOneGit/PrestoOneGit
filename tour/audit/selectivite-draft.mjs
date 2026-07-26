// Le réseau CHOISIT-IL sa carte, ou prend-il ce qui passe ?
//
// La fréquence brute des cartes prises ne répond pas : une carte rarement
// proposée ne peut pas être souvent prise. Le seul test propre compare le
// choix à ce qu'aurait fait un tirage au hasard PARMI LES MÊMES OFFRES.
//
// Pour chaque carte on calcule prises / proposées. Sous un choix aléatoire,
// ce taux vaut 1/3 pour toutes (trois cartes par draft). Un réseau qui juge
// vraiment produit un étalement autour de cette valeur.
//
// Lancer : node audit/selectivite-draft.mjs

import { TICK, TowerRun, runTower, mulberry32 } from '../src/sim/engine.js'
import { randomTeamGenome, crossoverTeams, mutateTeam } from '../src/sim/brain.js'
import { CARDS_PER_LEVEL } from '../src/sim/data.js'

const POP = 32
const GENS = Number(process.argv[2] ?? 20)
const SEEDS = Array.from({ length: 4 }, (_, i) => (11 + i * 104729) >>> 0)
const rng = mulberry32(20260725)

const evalTeam = (g) =>
  SEEDS.reduce((s, seed) => s + runTower(g, seed, null, 40, { emitEvents: false }).fitness, 0) / SEEDS.length

function evolve() {
  let pop = Array.from({ length: POP }, () => randomTeamGenome(rng))
  let best = null
  for (let gen = 0; gen < GENS; gen++) {
    const scored = pop.map((g) => ({ g, f: evalTeam(g) })).sort((a, b) => b.f - a.f)
    if (!best || scored[0].f > best.f) best = { g: scored[0].g.slice(), f: scored[0].f }
    const next = scored.slice(0, 4).map((s) => s.g.slice())
    next.push(randomTeamGenome(rng), randomTeamGenome(rng))
    const pick = () => {
      let w = null
      for (let i = 0; i < 3; i++) { const c = scored[Math.floor(rng() * scored.length)]; if (!w || c.f > w.f) w = c }
      return w.g
    }
    while (next.length < POP) next.push(mutateTeam(rng, crossoverTeams(rng, pick(), pick())))
    pop = next
  }
  return best
}

// Instrumente drawCards/applyCard pour enregistrer offres et choix.
function observe(genome, seeds) {
  const offered = new Map()
  const taken = new Map()
  const slotTaken = [0, 0, 0]
  let drafts = 0
  for (const seed of seeds) {
    const run = new TowerRun(genome, seed)
    const realDraw = run.drawCards.bind(run)
    let lastCards = null
    run.drawCards = (hero) => {
      lastCards = realDraw(hero)
      return lastCards
    }
    const realApply = run.applyCard.bind(run)
    run.applyCard = (hero, card) => {
      if (lastCards?.length) {
        drafts++
        for (const c of lastCards) offered.set(c.label, (offered.get(c.label) ?? 0) + 1)
        taken.set(card.label, (taken.get(card.label) ?? 0) + 1)
        const idx = lastCards.indexOf(card)
        if (idx >= 0) slotTaken[idx]++
      }
      return realApply(hero, card)
    }
    let guard = 0
    while (!run.finished && guard++ < 500000) run.step(TICK)
  }
  return { offered, taken, drafts, slotTaken }
}

console.log('SÉLECTIVITÉ DU DRAFT\n')
console.log(`Évolution de référence : ${GENS} générations, population ${POP}…`)
const champ = evolve()
const heldout = Array.from({ length: 20 }, (_, i) => 800001 + i * 6151)
const { offered, taken, drafts, slotTaken } = observe(champ.g, heldout)

console.log(`\n${drafts} drafts observés sur 20 graines inédites (fitness du champion ${Math.round(champ.f)})\n`)

// Biais de position : un réseau qui prendrait toujours la première carte
// serait dégénéré, quel que soit son encodage.
const posPct = slotTaken.map((n) => ((100 * n) / drafts).toFixed(0) + ' %')
console.log(`Position choisie dans la liste : ${posPct.join(' · ')}  (hasard = 33 % · 33 % · 33 %)`)

const rows = [...offered.entries()]
  .filter(([, n]) => n >= 8) // en dessous, le taux n'est pas interprétable
  .map(([label, n]) => ({ label, offered: n, taken: taken.get(label) ?? 0, rate: (taken.get(label) ?? 0) / n }))
  .sort((a, b) => b.rate - a.rate)

console.log('\n  taux   prises/proposées   carte')
console.log('  ' + '─'.repeat(62))
for (const r of rows.slice(0, 8)) {
  console.log(`  ${(r.rate * 100).toFixed(0).padStart(3)} %   ${String(r.taken).padStart(4)}/${String(r.offered).padEnd(4)}         ${r.label}`)
}
console.log('  ...')
for (const r of rows.slice(-8)) {
  console.log(`  ${(r.rate * 100).toFixed(0).padStart(3)} %   ${String(r.taken).padStart(4)}/${String(r.offered).padEnd(4)}         ${r.label}`)
}

// Écart-type des taux : la mesure synthétique de la sélectivité.
const mean = rows.reduce((s, r) => s + r.rate, 0) / rows.length
const sd = Math.sqrt(rows.reduce((s, r) => s + (r.rate - mean) ** 2, 0) / rows.length)
// Sous un choix aléatoire, chaque prise est un Bernoulli(1/3) : l'écart-type
// attendu des taux observés vaut racine(p(1-p)/n) par carte.
const expected = Math.sqrt(
  rows.reduce((s, r) => s + ((1 / CARDS_PER_LEVEL) * (1 - 1 / CARDS_PER_LEVEL)) / r.offered, 0) / rows.length
)
console.log('\n' + '─'.repeat(64))
console.log(`  taux moyen                     : ${(mean * 100).toFixed(1)} %  (hasard = 33,3 %)`)
console.log(`  écart-type observé             : ${(sd * 100).toFixed(1)} points`)
console.log(`  écart-type attendu si hasard   : ${(expected * 100).toFixed(1)} points`)
console.log(`  RAPPORT                        : ${(sd / expected).toFixed(2)}×`)
console.log('\n  Un rapport proche de 1 signifie que le réseau prend ce qui passe.')
console.log('  Au-delà de 2, il exprime de vraies préférences.')
