// Que font vraiment les agents ? Chasse aux comportements anormaux.
//
// Ce script ne cherche pas à prouver que l'apprentissage est réel — c'est
// le travail de `audit.mjs`. Il cherche des ÉCARTS entre ce que les agents
// pourraient faire et ce qu'ils font : capacités jamais lancées, mana
// gaspillée, repos mal placés, dash déclenchés à contretemps, équipe qui
// s'effondre d'un bloc.
//
// Lancer : node audit/comportements.mjs [générations]

import { TICK, TowerRun, runTower, mulberry32 } from '../src/sim/engine.js'
import { randomTeamGenome, crossoverTeams, mutateTeam, describeComposition } from '../src/sim/brain.js'
import { MOBILITY } from '../src/sim/engine.js'

const POP = 32
const GENS = Number(process.argv[2] ?? 20)
const SEEDS = Array.from({ length: 4 }, (_, i) => (11 + i * 104729) >>> 0)
const HELDOUT = Array.from({ length: 8 }, (_, i) => 800001 + i * 6151)
const rng = mulberry32(31415)

const evalTeam = (g) =>
  SEEDS.reduce((s, seed) => s + runTower(g, seed, null, 40, { emitEvents: false }).fitness, 0) / SEEDS.length

console.log('COMPORTEMENTS\n')
console.log(`Évolution de référence : ${GENS} générations, population ${POP}…`)
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
console.log(`Champion : ${describeComposition(best.g)} — fitness ${Math.round(best.f)}\n`)

const agg = {
  spread: 0, spreadN: 0,
  deathGaps: [], wipes: 0, runs: 0,
  dashHostile: 0, dashIdle: 0,
  manaFull: 0, manaTicks: 0,
  restLowHp: 0, restHighHp: 0,
  idleTicks: 0, actTicks: 0,
  neverCast: new Map(), cast: new Map(),
  levelSpread: [],
}

for (const seed of HELDOUT) {
  const run = new TowerRun(best.g, seed, { logging: true })
  const deaths = []
  let guard = 0
  const seen = new Set()
  while (!run.finished && guard++ < 500000) {
    const prevCd = run.heroes.map((h) => h.mobilityCds.dash)
    run.step(TICK)
    const alive = run.heroes.filter((h) => h.alive)

    // Écartement : l'équipe joue-t-elle groupée ?
    if (guard % 10 === 0 && alive.length >= 2) {
      let mx = 0
      for (let i = 0; i < alive.length; i++) {
        for (let k = i + 1; k < alive.length; k++) {
          const d = Math.hypot(alive[i].x - alive[k].x, alive[i].z - alive[k].z)
          if (d > mx) mx = d
        }
      }
      agg.spread += mx
      agg.spreadN++
    }

    for (let i = 0; i < run.heroes.length; i++) {
      const h = run.heroes[i]
      if (!h.alive) {
        if (!seen.has(i)) { seen.add(i); deaths.push({ t: run.time, slot: i, floor: run.floor }) }
        continue
      }
      // Un dash déclenché sans aucun monstre à portée utile est-il fréquent ?
      if (h.mobilityCds.dash > prevCd[i]) {
        const near = run.monsters.some((m) => Math.hypot(m.x - h.x, m.z - h.z) < 12)
        near ? agg.dashHostile++ : agg.dashIdle++
      }
      // Mana au plafond pendant un combat = ressource inutilisée.
      agg.manaTicks++
      if (h.mana >= h.maxMana * 0.98 && run.monsters.length > 0) agg.manaFull++
      // Tick sans action (ni attaque, ni capacité, ni déplacement).
      h.movedThisTick ? agg.actTicks++ : agg.idleTicks++
    }
  }
  agg.runs++
  const lvls = run.heroes.map((h) => h.level)
  agg.levelSpread.push(Math.max(...lvls) - Math.min(...lvls))
  // Cascade : les morts sont-elles rapprochées ?
  const real = deaths.sort((a, b) => a.t - b.t)
  if (real.length >= 3) {
    const gap = real.at(-1).t - real[real.length - 3].t
    agg.deathGaps.push(gap)
    if (gap < 60) agg.wipes++
  }
  for (const h of run.heroes) {
    for (const a of h.abilities) {
      const key = `${h.cls.label}/${a.label}`
      const n = h.stats.abilities[a.id] ?? 0
      agg.cast.set(key, (agg.cast.get(key) ?? 0) + n)
      if (n === 0) agg.neverCast.set(key, (agg.neverCast.get(key) ?? 0) + 1)
    }
  }
  for (const f of run.floorLog) {
    if (!f.restTaken) continue
    // Un repos pris à pleine vie est un repos gâché : il n'y en a que 3.
    f.survivors >= 4 ? agg.restHighHp++ : agg.restLowHp++
  }
}

const pct = (a, b) => `${((100 * a) / Math.max(b, 1)).toFixed(1)} %`
console.log(`Sur ${agg.runs} runs, graines inédites.\n`)
console.log('FORMATION')
console.log(`  écartement maximal moyen : ${(agg.spread / agg.spreadN).toFixed(1)} unités (plateau 32, diagonale 45)`)
console.log(`  écart de niveau dans l’équipe en fin de run : ${(agg.levelSpread.reduce((a, b) => a + b, 0) / agg.levelSpread.length).toFixed(1)}`)

console.log('\nEFFONDREMENT')
if (agg.deathGaps.length) {
  const g = agg.deathGaps.slice().sort((a, b) => a - b)
  console.log(`  délai entre la 3ᵉ mort et la dernière : médiane ${g[Math.floor(g.length / 2)].toFixed(0)} s`)
  console.log(`  runs où 3 agents tombent en moins de 60 s : ${agg.wipes}/${agg.deathGaps.length}`)
} else {
  console.log('  pas assez de morts pour conclure')
}

console.log('\nMOBILITÉ')
console.log(`  dash avec un monstre à moins de 12 unités : ${pct(agg.dashHostile, agg.dashHostile + agg.dashIdle)}`)
console.log(`  dash déclenchés à vide                    : ${pct(agg.dashIdle, agg.dashHostile + agg.dashIdle)}`)

console.log('\nRESSOURCES')
console.log(`  mana au plafond pendant un combat : ${pct(agg.manaFull, agg.manaTicks)} du temps`)
console.log(`  ticks sans déplacement             : ${pct(agg.idleTicks, agg.idleTicks + agg.actTicks)}`)
console.log(`  repos pris avec 4+ survivants      : ${agg.restHighHp} contre ${agg.restLowHp} en équipe entamée`)

console.log('\nCAPACITÉS JAMAIS LANCÉES (sur les runs où l’agent la portait)')
const never = [...agg.neverCast.entries()].filter(([k, n]) => n >= agg.runs * 0.8)
if (never.length) for (const [k, n] of never) console.log(`  ${k} — jamais utilisée dans ${n}/${agg.runs} runs`)
else console.log('  aucune : toutes les capacités draftées ont servi au moins une fois')

console.log('\nCAPACITÉS LES PLUS JOUÉES')
for (const [k, n] of [...agg.cast.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  if (n > 0) console.log(`  ${String(n).padStart(5)}  ${k}`)
}
