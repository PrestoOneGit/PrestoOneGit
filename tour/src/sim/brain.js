// Cerveau d'un agent : MLP à une couche cachée. Aucun comportement écrit
// à la main — le réseau décide du déplacement, de la mobilité, de l'action,
// du ciblage, du repos, et de la carte qu'il prend au draft.
//
// Le génome d'une équipe = 5 slots, chacun portant SA CLASSE (entier,
// mutable) et SON cerveau. La composition d'équipe est donc elle-même un
// objet d'évolution : rien n'empêche 5 fois la même classe.

import { CARDS_PER_LEVEL, CLASSES } from './data.js'
import { gate, squash } from './exact.js'

export const WALL_RAYS = 6
export const ABILITY_SLOTS = 4 // un agent ne porte jamais plus de 4 capacités

// Découpage des entrées :
//   16  soi  (PV, mana, états, position)
//    8  capacités possédées et prêtes (4 + 4)
//    5  mobilité (3 recharges + en l'air + course active)
//   24  4 monstres proches × 6
//   20  4 alliés × 5
//    6  capteurs de murs
//   10  portail / piège / cadavre proches + invocations
//    4  contexte (étage, densité, repos, boss)
//   63  cartes du draft (3 × 21 : type, axes d'effet, famille, échelles)
export const INPUT_SIZE = 156
export const HIDDEN = 24

// Découpage des sorties :
//   0-1  déplacement (x, z)
//   2    porte d'action
//   3    attaque de base
//   4-7  les 4 emplacements de capacité
//   8    préférence de cible (0 = plus proche, 1 = plus faible)
//   9    envie de repos
//   10-12 mobilité : dash, course, bond
//   13-15 choix de carte au draft
export const OUT_GATE = 2
export const OUT_BASIC = 3
export const OUT_ABILITY = 4
export const OUT_TARGET_PREF = OUT_ABILITY + ABILITY_SLOTS
export const OUT_REST = OUT_TARGET_PREF + 1
export const OUT_MOBILITY = OUT_REST + 1
export const OUT_CARD = OUT_MOBILITY + 3
export const OUTPUT_SIZE = OUT_CARD + CARDS_PER_LEVEL

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

// Passe avant pour le slot s. Sorties 0-1 bornées dans (-1, 1) pour le
// déplacement signé, le reste dans (0, 1) pour les décisions.
//
// Les activations viennent de `exact.js` : ni `Math.tanh` ni `Math.exp` ne
// sont spécifiés au bit près par ECMAScript, et ils sont appelés ~40 000
// fois par run. Les remplacer est ce qui rend le moteur reproductible d'un
// navigateur à l'autre — et accessoirement plus rapide.
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
    hidden[j] = squash(sum)
  }
  for (let k = 0; k < OUTPUT_SIZE; k++) {
    let sum = genome[b2 + k]
    const row = w2 + k * HIDDEN
    for (let j = 0; j < HIDDEN; j++) sum += genome[row + j] * hidden[j]
    out[k] = k < 2 ? squash(sum) : gate(sum)
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
  // Mutation de classe : rare, mais c'est elle qui explore la méta.
  //
  // Le cerveau du slot était auparavant conservé tel quel, au motif que les
  // entrées et les sorties ne changent pas. En pratique c'est faux : les
  // observations décrivent les capacités PORTÉES, et les sorties 4 à 7
  // désignent des emplacements dont le contenu vient de changer du tout au
  // tout. L'agent muté continue donc de jouer la politique de son ancienne
  // classe — mesuré sur un champion réel à la génération 4703, dont le
  // Lutin fraîchement muté mourait à l'étage 2 sur six graines sur six, au
  // niveau 3,3 quand ses coéquipiers atteignaient le niveau 22. Un
  // cinquième de l'équipe perdu, et l'évolution s'en accommodait.
  //
  // On perturbe donc fortement le cerveau muté au lieu de le recopier : il
  // garde les régularités générales (fuir, viser, se déplacer) mais perd
  // les réflexes propres à l'ancien kit. Une réinitialisation complète
  // serait pire — elle jetterait aussi tout ce qui est transférable.
  for (let s = 0; s < SLOTS; s++) {
    if (rng() >= 0.03) continue
    genome[s] = Math.floor(rng() * CLASSES.length)
    const base = SLOTS + s * BRAIN_SIZE
    // Les poids de la couche de sortie sont ceux qui encodent « quelle
    // capacité lancer » : ce sont eux qui n'ont plus de sens. On les
    // rebrasse le plus fort.
    const outStart = base + INPUT_SIZE * HIDDEN + HIDDEN
    for (let i = base; i < genome.length && i < base + BRAIN_SIZE; i++) {
      genome[i] += gauss(rng) * (i >= outStart ? 0.6 : 0.2)
    }
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
