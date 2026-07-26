// Outils statistiques pour l'audit. Volontairement non paramétriques :
// les distributions de fitness sont bornées, asymétriques et pleines
// d'ex æquo (mêmes étages atteints), donc un test de Student serait mal
// adapté. Mann-Whitney et permutation ne supposent rien de la forme.

export function mean(xs) {
  return xs.reduce((s, x) => s + x, 0) / xs.length
}

export function median(xs) {
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function stdev(xs) {
  const m = mean(xs)
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(xs.length - 1, 1))
}

// Test U de Mann-Whitney (bilatéral), avec correction pour les ex æquo
// et approximation normale — nos échantillons sont assez grands (n ≥ 20).
export function mannWhitneyU(a, b) {
  const all = [...a.map((v) => ({ v, g: 0 })), ...b.map((v) => ({ v, g: 1 }))]
  all.sort((x, y) => x.v - y.v)

  // Rangs moyens en cas d'ex æquo
  const ranks = new Array(all.length)
  let tieCorrection = 0
  let i = 0
  while (i < all.length) {
    let j = i
    while (j + 1 < all.length && all[j + 1].v === all[i].v) j++
    const avgRank = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) ranks[k] = avgRank
    const t = j - i + 1
    if (t > 1) tieCorrection += t ** 3 - t
    i = j + 1
  }

  let rankSumA = 0
  all.forEach((item, idx) => {
    if (item.g === 0) rankSumA += ranks[idx]
  })

  const n1 = a.length
  const n2 = b.length
  const u1 = rankSumA - (n1 * (n1 + 1)) / 2
  const u2 = n1 * n2 - u1
  const u = Math.min(u1, u2)

  const n = n1 + n2
  const muU = (n1 * n2) / 2
  const sigmaU = Math.sqrt(
    ((n1 * n2) / 12) * ((n + 1) - tieCorrection / (n * (n - 1)))
  )
  const z = sigmaU > 0 ? (u - muU) / sigmaU : 0
  const p = 2 * (1 - normalCdf(Math.abs(z)))

  // Taille d'effet : probabilité qu'un tirage de A dépasse un tirage de B
  const effectSize = u1 / (n1 * n2)
  return { u, z, p: Math.min(1, p), effectSize, n1, n2 }
}

function normalCdf(x) {
  // Approximation d'Abramowitz-Stegun 26.2.17
  const t = 1 / (1 + 0.2316419 * x)
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2)
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  return 1 - d * poly
}

// Test de permutation sur la différence des moyennes : aucune hypothèse
// de distribution, on rebat les étiquettes et on regarde à quelle
// fréquence le hasard produit un écart au moins aussi grand.
export function permutationTest(a, b, iterations = 20000, rng = Math.random) {
  const observed = mean(a) - mean(b)
  const pooled = [...a, ...b]
  const n1 = a.length
  let atLeastAsExtreme = 0

  for (let it = 0; it < iterations; it++) {
    // Mélange de Fisher-Yates partiel : seuls les n1 premiers comptent
    for (let i = pooled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      const tmp = pooled[i]
      pooled[i] = pooled[j]
      pooled[j] = tmp
    }
    let sumA = 0
    for (let i = 0; i < n1; i++) sumA += pooled[i]
    let sumB = 0
    for (let i = n1; i < pooled.length; i++) sumB += pooled[i]
    const diff = sumA / n1 - sumB / (pooled.length - n1)
    if (Math.abs(diff) >= Math.abs(observed)) atLeastAsExtreme++
  }
  return { observed, p: (atLeastAsExtreme + 1) / (iterations + 1), iterations }
}

export function summarize(label, xs) {
  return `${label.padEnd(22)} n=${String(xs.length).padStart(3)}  moyenne=${mean(xs).toFixed(0).padStart(6)}  médiane=${median(xs).toFixed(0).padStart(6)}  écart-type=${stdev(xs).toFixed(0).padStart(5)}  min=${Math.min(...xs).toFixed(0)}  max=${Math.max(...xs).toFixed(0)}`
}

export function verdict(ok, text) {
  return `${ok ? '  RÉUSSI ' : '  ÉCHOUÉ '} ${text}`
}
