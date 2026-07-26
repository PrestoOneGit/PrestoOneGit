// Cerveau d'un héros : un petit réseau de neurones (MLP 23 → 16 → 4).
// Aucun comportement n'est écrit à la main : le réseau reçoit des
// observations brutes et décide seul du déplacement, du moment d'agir
// et du choix de cible. C'est l'évolution qui façonne les poids.

export const INPUT_SIZE = 23
export const HIDDEN = 16
export const OUTPUT_SIZE = 4 // [dépl. x, dépl. z, agir, préférence de cible]

export const BRAIN_SIZE = INPUT_SIZE * HIDDEN + HIDDEN + HIDDEN * OUTPUT_SIZE + OUTPUT_SIZE
export const HEROES = 4
export const TEAM_GENOME_SIZE = BRAIN_SIZE * HEROES

// Approximation gaussienne (somme d'uniformes)
function gauss(rng) {
  return (rng() + rng() + rng()) / 1.5 - 1
}

export function randomTeamGenome(rng) {
  const g = new Float32Array(TEAM_GENOME_SIZE)
  for (let i = 0; i < g.length; i++) g[i] = gauss(rng) * 0.5
  // Biais initial de la sortie « agir » vers le positif : les toutes
  // premières équipes tentent au moins des actions, ce qui donne un
  // gradient de sélection au lieu d'un silence total.
  for (let h = 0; h < HEROES; h++) {
    const biasStart = h * BRAIN_SIZE + INPUT_SIZE * HIDDEN + HIDDEN + HIDDEN * OUTPUT_SIZE
    g[biasStart + 2] = 1.2
  }
  return g
}

const hidden = new Float32Array(HIDDEN)

// Passe avant pour le héros h. `out` reçoit [mx, mz, act, pref].
export function forward(genome, heroIndex, input, out) {
  const base = heroIndex * BRAIN_SIZE
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
    // Déplacement en tanh (-1..1), décisions en sigmoïde (0..1)
    out[k] = k < 2 ? Math.tanh(sum) : 1 / (1 + Math.exp(-sum))
  }
  return out
}

export function crossoverTeams(rng, a, b) {
  // Chaque héros hérite du cerveau COMPLET d'un des deux parents :
  // on recombine des rôles entiers, pas des moitiés de réseau.
  const child = new Float32Array(TEAM_GENOME_SIZE)
  for (let h = 0; h < HEROES; h++) {
    const src = rng() < 0.5 ? a : b
    child.set(src.subarray(h * BRAIN_SIZE, (h + 1) * BRAIN_SIZE), h * BRAIN_SIZE)
  }
  return child
}

export function mutateTeam(rng, genome) {
  // Mutation auto-adaptative : chaque enfant tire sa propre intensité —
  // tantôt un réglage fin, tantôt une grande exploration. Ça évite les
  // plateaux où une mutation à taille fixe n'apporte plus rien.
  const rate = 0.02 + rng() * 0.1
  const sigma = 0.05 + rng() * 0.35
  if (rng() < 0.25) {
    // Un quart des enfants ne retravaille qu'UN héros, à fond : on
    // affine un rôle sans casser le reste de l'équipe.
    const h = Math.floor(rng() * HEROES)
    for (let i = h * BRAIN_SIZE; i < (h + 1) * BRAIN_SIZE; i++) {
      if (rng() < rate * 3) genome[i] += gauss(rng) * sigma
    }
    return genome
  }
  for (let i = 0; i < genome.length; i++) {
    if (rng() < rate) genome[i] += gauss(rng) * sigma
  }
  return genome
}
