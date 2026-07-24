// Cerveau d'un agent : MLP 65 → 28 → 18. Aucun comportement écrit à la
// main — le réseau décide du déplacement, de la mobilité (dash, course,
// bond), de l'action (attaque de base ou l'une des 3 capacités), du
// ciblage, de l'envie de repos et du CHOIX d'amélioration au niveau.
//
// Le génome d'une équipe = 5 slots, chacun portant SA CLASSE (entier,
// mutable) et SON cerveau. La composition d'équipe est donc elle-même
// un objet d'évolution : rien n'empêche 5 fois la même classe.

import { CLASSES, UPGRADES } from './data.js'

// 22 sur soi (état, mobilité, améliorations) + 20 monstres + 20 alliés + 4 contexte
export const INPUT_SIZE = 66
export const HIDDEN = 28

// Disposition des sorties :
//  0-1  déplacement (x, z)
//  2    porte d'action (agir ou non)
//  3    attaque de base
//  4-6  capacités 1..3
//  7    préférence de cible (0 = plus proche, 1 = plus faible)
//  8    envie de repos
//  9-11 mobilité : dash, course, bond
//  12-17 préférence pour chacune des 6 améliorations
export const OUT_MOVE = 0
export const OUT_GATE = 2
export const OUT_BASIC = 3
export const OUT_ABILITY = 4
export const OUT_TARGET_PREF = 7
export const OUT_REST = 8
export const OUT_MOBILITY = 9
export const OUT_UPGRADE = 12
export const OUTPUT_SIZE = OUT_UPGRADE + UPGRADES.length

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
    // Biais initial de la porte d'action vers le positif : les premières
    // équipes tentent au moins des actions, ce qui donne un gradient de
    // sélection au lieu d'un silence total.
    const outBias = base + INPUT_SIZE * HIDDEN + HIDDEN + HIDDEN * OUTPUT_SIZE
    g[outBias + OUT_GATE] = 1.2
  }
  return g
}

export function slotClass(genome, slot) {
  return CLASSES[Math.max(0, Math.min(CLASSES.length - 1, Math.round(genome[slot])))]
}

const hidden = new Float32Array(HIDDEN)

// Passe avant pour le slot s. Sorties 0-1 en tanh (déplacement signé),
// le reste en sigmoïde (décisions et préférences).
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
  // on recombine des agents entiers, cohérents.
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
  // Mutation des poids, auto-adaptative : évite les plateaux.
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

export function compositionList(genome) {
  return Array.from({ length: SLOTS }, (_, s) => slotClass(genome, s).id)
}
