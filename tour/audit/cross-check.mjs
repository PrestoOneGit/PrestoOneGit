// Contre-vérification indépendante : les chiffres affichés par
// l'application sont-ils reproductibles hors de l'application ?
//
// Le navigateur entraîne, puis exporte sa session (génomes + fitness
// annoncées). Ce script recalcule ces fitness dans un processus Node
// séparé, avec le même moteur mais sans rien emprunter à l'interface.
// Si les valeurs coïncident, les chiffres du HUD viennent bien de
// simulations réelles ; s'ils divergent, quelque chose est inventé.
//
// Lancer : node audit/cross-check.mjs chemin/vers/tour-session-genN.json

import { readFileSync } from 'node:fs'
import { runTower } from '../src/sim/engine.js'
import { describeComposition } from '../src/sim/brain.js'

const path = process.argv[2]
if (!path) {
  console.error('Usage : node audit/cross-check.mjs <session.json exportée depuis le navigateur>')
  process.exit(2)
}

const session = JSON.parse(readFileSync(path, 'utf8'))
console.log('CONTRE-VÉRIFICATION NAVIGATEUR → NODE\n')
console.log(`Session exportée le ${session.exportedAt}, génération ${session.generation}`)
console.log(`${session.records?.length ?? 0} runs records à vérifier\n`)

// L'application moyenne la fitness sur les graines d'évaluation ; on
// reproduit exactement ce calcul.
const SEEDS_PER_EVAL = 4
const trainSeeds = Array.from({ length: SEEDS_PER_EVAL }, (_, i) => (11 + i * 104729) >>> 0)

let checked = 0
let matches = 0
const tolerance = 1e-6

console.log('  gén.   fitness annoncée   fitness recalculée   écart      étages   composition')
console.log('  ' + '─'.repeat(94))

// Le format d'export encode les génomes en base64 des octets bruts.
function decodeGenome(g) {
  if (typeof g !== 'string') return Float32Array.from(g)
  const binary = atob(g)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Float32Array(bytes.buffer)
}

for (const record of session.records ?? []) {
  const genome = decodeGenome(record.genome)
  let total = 0
  let floors = 0
  for (const seed of trainSeeds) {
    const r = runTower(genome, seed)
    total += r.fitness
    floors = Math.max(floors, r.floors)
  }
  const recomputed = total / trainSeeds.length
  const delta = Math.abs(recomputed - record.fitness)
  // L'export est exact au bit près : on exige une correspondance stricte,
  // à l'arrondi flottant de la moyenne près.
  const ok = delta < tolerance * Math.max(record.fitness, 1)
  checked++
  if (ok) matches++
  console.log(
    `  ${String(record.generation).padStart(4)}   ${record.fitness.toFixed(1).padStart(16)}   ` +
      `${recomputed.toFixed(1).padStart(18)}   ${delta.toFixed(2).padStart(8)}   ` +
      `${String(floors).padStart(6)}   ${describeComposition(genome)}${ok ? '' : '   ← DIVERGENCE'}`
  )
}

console.log('\n' + '─'.repeat(96))
if (checked === 0) {
  console.log('Aucun run record dans la session : laissez l’entraînement tourner plus longtemps avant d’exporter.')
  process.exitCode = 2
} else if (matches === checked) {
  console.log(
    `RÉUSSI : les ${checked} fitness annoncées par le navigateur se reproduisent dans un processus Node indépendant.\n` +
      'Les chiffres du HUD proviennent bien de simulations réellement exécutées.'
  )
} else {
  console.log(`ÉCHOUÉ : ${checked - matches} run(s) sur ${checked} ne se reproduisent pas.`)
  process.exitCode = 1
}
