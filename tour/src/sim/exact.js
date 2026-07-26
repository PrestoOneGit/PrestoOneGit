// Arithmétique reproductible entre moteurs JavaScript.
//
// Le problème : ECMAScript n'impose PAS le dernier bit des fonctions
// transcendantes. `Math.cos`, `Math.pow`, `Math.tanh`, `Math.exp` et
// `Math.hypot` sont explicitement « implementation-approximated ». Deux
// moteurs ont le droit de renvoyer des valeurs distinctes, et ils le font :
//
//   Math.cos(0.1)       Node 0.9950041652780257 · Chrome 0.9950041652780258
//   Math.pow(0.1, 1.4)  Node 1.4438453988846187 · Chrome 1.443845398884619
//
// Un bit d'écart sur les PV d'un monstre le fait mourir un tick plus tard,
// l'agent se replace autrement, et vingt étages plus loin les trajectoires
// n'ont plus rien de commun. Mesuré : le même génome sur la même graine
// donne 24 étages sous Node et 19 sous Chromium.
//
// Ce qui EST normé au bit près : + - * /, la comparaison, Math.sqrt (que
// tout moteur réel fait exécuter par l'instruction matérielle correctement
// arrondie), Math.abs, Math.floor, Math.round, Math.min, Math.max,
// Math.imul et Math.fround. Tout ce module n'utilise que ça.
//
// Enjeu : sans reproductibilité entre moteurs, impossible de vérifier dans
// le navigateur ce qu'un GPU loué aura calculé.

// ─── Longueurs ───

// `Math.hypot` évite les débordements intermédiaires, au prix d'un résultat
// non spécifié. Nos coordonnées tiennent dans un plateau de 32 unités : le
// carré ne déborde jamais, la forme naïve est donc à la fois sûre et exacte.
export function len2(dx, dz) {
  return Math.sqrt(dx * dx + dz * dz)
}

// ─── Rotations ───

// Faire pivoter un vecteur ne demande pas de trigonométrie : le cosinus et
// le sinus des angles utilisés sont des CONSTANTES, écrites ici en toutes
// lettres. La rotation elle-même n'est plus que quatre multiplications et
// deux additions — exactes partout.
//
// Chaque entrée est [angle en radians, cos, sin]. Les valeurs sont celles
// de la double précision la plus proche. À ±pi/2 on écrit 0 et 1 exacts :
// `Math.cos(Math.PI/2)` vaut 6.12e-17, non par imprécision du cosinus mais
// parce que Math.PI/2 n'est pas pi/2. Le quart de tour exact est meilleur.
export const TURNS = [
  [0.4, 0.9210609940028851, 0.3894183423086505],
  [-0.4, 0.9210609940028851, -0.3894183423086505],
  [0.8, 0.6967067093471654, 0.7173560908995228],
  [-0.8, 0.6967067093471654, -0.7173560908995228],
  [1.2, 0.3623577544766736, 0.9320390859672263],
  [-1.2, 0.3623577544766736, -0.9320390859672263],
  [1.5707963267948966, 0, 1],
  [-1.5707963267948966, 0, -1],
]

// Rotation d'un vecteur par un couple (cos, sin) déjà connu.
export function rotate(dx, dz, c, s) {
  return [dx * c - dz * s, dx * s + dz * c]
}

// ─── Puissance entière ───

// `Math.pow(base, n)` n'est pas spécifié au bit près, même pour n entier.
// L'exponentiation rapide n'utilise que des multiplications : elle l'est.
export function powInt(base, n) {
  let result = 1
  let b = base
  let e = n | 0
  if (e < 0) return 1 / powInt(base, -e)
  while (e > 0) {
    if (e & 1) result *= b
    b *= b
    e >>= 1
  }
  return result
}

// ─── Activations ───

// `Math.tanh` et `Math.exp` sont appelés ~40 000 fois par run et ne sont
// spécifiés ni l'un ni l'autre. On les remplace par des fonctions de forme
// équivalente — bornées, monotones, dérivable en 0 — mais construites
// uniquement sur des opérations exactes. Elles sont aussi plus rapides,
// puisqu'aucune ne passe par une routine transcendante.

// Softsign : borné dans (-1, 1), remplace tanh.
export function squash(x) {
  return x / (1 + (x < 0 ? -x : x))
}

// Version 0..1, remplace la sigmoïde logistique.
export function gate(x) {
  return 0.5 + 0.5 * squash(x)
}

// ─── Sinus d'une progression 0..1 ───

// Utilisé uniquement pour l'arc d'un saut : on veut une cloche qui vaut 0
// aux extrémités et 1 au milieu. Une parabole fait le même travail que
// sin(pi*p), en exact.
export function arch(p) {
  return 4 * p * (1 - p)
}

// Les six directions des capteurs de murs, à 60° d'écart. Valeurs exactes
// (±1, ±1/2, ±racine(3)/2) plutôt que celles de `Math.cos`, qui traîne
// l'erreur de représentation de Math.PI.
const R3 = 0.8660254037844386 // racine(3)/2
export const RAY_DIRS = [
  [1, 0],
  [0.5, R3],
  [-0.5, R3],
  [-1, 0],
  [-0.5, -R3],
  [0.5, -R3],
]

// ─── Points sur un cercle ───

// Placement initial des cinq agents : cinq directions fixes. Comme pour les
// rotations, les couples (cos, sin) sont des constantes.
export const RING5 = [
  [1, 0],
  [0.30901699437494745, 0.9510565162951535],
  [-0.8090169943749473, 0.5877852522924732],
  [-0.8090169943749475, -0.587785252292473],
  [0.30901699437494723, -0.9510565162951536],
]
