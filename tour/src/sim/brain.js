// Cerveau d'un aventurier : MLP 55 → 24 → 9. Aucun comportement écrit à
// la main — le réseau décide du déplacement, de l'action (attaque de base
// ou l'une des 3 capacités), du ciblage et de l'envie de repos.
//
// Le génome d'une équipe = 5 slots, chacun portant SA CLASSE (entier,
// mutable) et SON cerveau. La composition d'équipe est donc elle-même
// un objet d'évolution : rien n'empêche 5 fois la même classe.

import { CLASSES } from './data.js'

export const INPUT_SIZE = 55
export const HIDDEN = 24
export const OUTPUT_SIZE = 9 // [mx, mz, gate, act0..act3, targetPref, restWish]

export const BRAIN_SIZE = INPUT_SIZE * HIDDEN + HIDDEN + HIDDEN * OUTPUT_SIZE + OUTPUT_SIZE
export const SLOTS = 5
// Génome plat : [classe_slot0..classe_slot4, cerveau0, ..., cerveau4]
export const TEAM_GENOME_SIZE = SLOTS + BRAIN_SIZE * SLOTS

function gauss(rng) {
  return (rng() + rng() + rng()) / 1.5 - 1
}

export function randomTeamGenome(rng) {
  const g = new Float32Array(TEAM_GENOME_SIZE)
  for (let s = 0; s < SLOTS; s++) {
    g[s] = Math.floor(rng() * CLASSES.length)
    const base = SLOTS + s * BRAIN_SIZE
    for (let i = 0; i < BRAIN_SIZE; i++) g[base + i] = gauss(rng) * 0.5
    // Biais initial de la sortie « agir » vers le positif pour amorcer
    // un gradient de sélection dès les premières équipes aléatoires.
    const outBias = base + INPUT_SIZE * HIDDEN + HIDDEN + HIDDEN * OUTPUT_SIZE
    g[outBias + 2] = 1.2
  }
  return g
}

export function slotClass(genome, slot) {
  return CLASSES[Math.max(0, Math.min(CLASSES.length - 1, Math.round(genome[slot])))]
}

const hidden = new Float32Array(HIDDEN)

// Passe avant pour le slot s. `out` reçoit les 9 sorties.
// Sorties 0-1 en tanh (déplacement), le reste en sigmoïde.
export function forward(genome, slot, input, out) {
  const base = SLOTS + slot * BRAIN_SIZE
  const w1 = base
  const b1 = base + INPUT_SIZE * HIDDEN
  const w2 = b1 + HIDDEN
  const b2 = w2 + HIDDEN * OUTPUT_SIZE

  for (let j = 0; j < HIDDEN; j++) {
    let sum = genome[b1 + j]
    const row = w1 + j * INPUT_SIZE
    for (let i = 0; i < INPUT_SIZE; i++) sum += genome[row + i] * input[i]
    hidden[j] = Math.tanh(sum)
  }
  for (let k = 0; k < OUTPUT_SIZE; k++) {
    let sum = genome[b2 + k]
    const row = w2 + k * HIDDEN
    for (let j = 0; j < HIDDEN; j++) sum += genome[row + j] * hidden[j]
    out[k] = k < 2 ? Math.tanh(sum) : 1 / (1 + Math.exp(-sum))
  }
  return out
}

export function crossoverTeams(rng, a, b) {
  // Chaque slot hérite de sa classe ET de son cerveau du même parent :
  // on recombine des aventuriers entiers, cohérents.
  const child = new Float32Array(TEAM_GENOME_SIZE)
  for (let s = 0; s < SLOTS; s++) {
    const src = rng() < 0.5 ? a : b
    child[s] = src[s]
    const base = SLOTS + s * BRAIN_SIZE
    child.set(src.subarray(base, base + BRAIN_SIZE), base)
  }
  return child
}

export function mutateTeam(rng, genome) {
  // Mutation de classe : rare, mais c'est elle qui explore la méta
  // (la composition d'équipe). Le cerveau du slot est conservé —
  // entrées/sorties identiques, l'évolution le réadaptera.
  for (let s = 0; s < SLOTS; s++) {
    if (rng() < 0.03) genome[s] = Math.floor(rng() * CLASSES.length)
  }
  // Mutation des poids, auto-adaptative (voir arène : évite les plateaux)
  const rate = 0.02 + rng() * 0.1
  const sigma = 0.05 + rng() * 0.35
  if (rng() < 0.25) {
    const s = Math.floor(rng() * SLOTS)
    const base = SLOTS + s * BRAIN_SIZE
    for (let i = base; i < base + BRAIN_SIZE; i++) {
      if (rng() < rate * 3) genome[i] += gauss(rng) * sigma
    }
    return genome
  }
  for (let i = SLOTS; i < genome.length; i++) {
    if (rng() < rate) genome[i] += gauss(rng) * sigma
  }
  return genome
}

export function describeComposition(genome) {
  const counts = new Map()
  for (let s = 0; s < SLOTS; s++) {
    const label = slotClass(genome, s).label
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([label, n]) => (n > 1 ? `${n}× ${label}` : label))
    .join(' / ')
}
