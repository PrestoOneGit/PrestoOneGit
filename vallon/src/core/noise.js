// Générateur pseudo-aléatoire déterministe (mulberry32) + bruit de valeur 2D.
// Tout le monde est reconstructible à partir d'une seule graine.

export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash2D(x, y, seed) {
  let h = seed + x * 374761393 + y * 668265263
  h = (h ^ (h >>> 13)) >>> 0
  h = Math.imul(h, 1274126177) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function smoothstep(t) {
  return t * t * (3 - 2 * t)
}

export function valueNoise2D(x, y, seed) {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const tx = smoothstep(x - x0)
  const ty = smoothstep(y - y0)
  const v00 = hash2D(x0, y0, seed)
  const v10 = hash2D(x0 + 1, y0, seed)
  const v01 = hash2D(x0, y0 + 1, seed)
  const v11 = hash2D(x0 + 1, y0 + 1, seed)
  const a = v00 + (v10 - v00) * tx
  const b = v01 + (v11 - v01) * tx
  return a + (b - a) * ty
}

export function fbm2D(x, y, seed, octaves = 4, lacunarity = 2, gain = 0.5) {
  let amp = 1
  let freq = 1
  let sum = 0
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2D(x * freq, y * freq, seed + i * 1013)
    norm += amp
    amp *= gain
    freq *= lacunarity
  }
  return sum / norm
}
