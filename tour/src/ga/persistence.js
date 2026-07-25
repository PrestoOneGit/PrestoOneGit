// Persistance de l'entraînement : la population, l'historique et les runs
// records survivent à un rechargement de page. Stockage dans IndexedDB
// (capacité bien supérieure à localStorage), plus export/import de fichier
// pour transporter une session entre machines — ou la reprendre après un
// entraînement lancé sur GPU loué.

const DB_NAME = 'tour-training'
const STORE = 'sessions'
const KEY = 'current'
export const SAVE_FORMAT = 6

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const store = t.objectStore(STORE)
    const req = fn(store)
    t.oncomplete = () => resolve(req?.result)
    t.onerror = () => reject(t.error)
  })
}

// Les génomes sont des Float32Array : on les stocke en ArrayBuffer, ce
// qu'IndexedDB sait faire nativement et sans conversion coûteuse.
function packGenome(g) {
  return g.buffer.slice(g.byteOffset, g.byteOffset + g.byteLength)
}

function unpackGenome(buf) {
  return new Float32Array(buf)
}

function packRecord(r) {
  return { ...r, genome: packGenome(r.genome) }
}

function unpackRecord(r) {
  return { ...r, genome: unpackGenome(r.genome) }
}

export async function saveSession(state) {
  const payload = {
    format: SAVE_FORMAT,
    savedAt: new Date().toISOString(),
    generation: state.generation,
    population: state.population.map(packGenome),
    history: state.history,
    records: state.records.map(packRecord),
    bestEver: state.bestEver ? packRecord(state.bestEver) : null,
  }
  const db = await openDb()
  await tx(db, 'readwrite', (store) => store.put(payload, KEY))
  db.close()
  return payload.savedAt
}

export async function loadSession() {
  let db
  try {
    db = await openDb()
  } catch {
    return null
  }
  const payload = await tx(db, 'readonly', (store) => store.get(KEY))
  db.close()
  if (!payload) return null
  if (payload.format !== SAVE_FORMAT) {
    // Les règles du jeu ou la taille des réseaux ont changé : une
    // reprise silencieuse produirait des génomes incohérents.
    return { incompatible: true, savedAt: payload.savedAt, format: payload.format }
  }
  return {
    generation: payload.generation,
    population: payload.population.map(unpackGenome),
    history: payload.history ?? [],
    records: (payload.records ?? []).map(unpackRecord),
    bestEver: payload.bestEver ? unpackRecord(payload.bestEver) : null,
    savedAt: payload.savedAt,
  }
}

export async function clearSession() {
  const db = await openDb()
  await tx(db, 'readwrite', (store) => store.delete(KEY))
  db.close()
}

// ---- Export / import fichier ----
// Les génomes sont encodés en base64 des octets bruts du Float32Array.
//
// Une version précédente les écrivait en tableaux de nombres arrondis à
// 4 décimales, pour alléger le fichier. Un audit a montré que c'était
// destructeur : un run sur vingt seulement se reproduisait à l'identique
// (écarts jusqu'à 2600 points de fitness). L'arrondi déplace chaque poids
// d'un rien, mais sur ~12 000 poids cela suffit à faire basculer une
// décision de réseau — et un run diverge alors complètement. Le base64
// est à la fois exact et deux fois plus compact que les décimales.

function genomeToBase64(g) {
  const bytes = new Uint8Array(g.buffer, g.byteOffset, g.byteLength)
  let binary = ''
  const CHUNK = 0x8000 // évite de dépasser la taille d'argument de apply()
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

function base64ToGenome(encoded) {
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Float32Array(bytes.buffer)
}

export function exportSession(state) {
  return {
    format: SAVE_FORMAT,
    encoding: 'base64-float32',
    exportedAt: new Date().toISOString(),
    generation: state.generation,
    history: state.history,
    population: state.population.map(genomeToBase64),
    records: state.records.map((r) => ({ ...r, genome: genomeToBase64(r.genome) })),
    bestEver: state.bestEver ? { ...state.bestEver, genome: genomeToBase64(state.bestEver.genome) } : null,
  }
}

export function importSession(json) {
  if (!json || json.format !== SAVE_FORMAT) {
    throw new Error(
      `Fichier incompatible (format ${json?.format ?? '?'}, attendu ${SAVE_FORMAT}). ` +
        'Il vient probablement d’une version où les règles ou les réseaux étaient différents.'
    )
  }
  const decode = (g) => (typeof g === 'string' ? base64ToGenome(g) : Float32Array.from(g))
  return {
    generation: json.generation ?? 0,
    population: json.population.map(decode),
    history: json.history ?? [],
    records: (json.records ?? []).map((r) => ({ ...r, genome: decode(r.genome) })),
    bestEver: json.bestEver ? { ...json.bestEver, genome: decode(json.bestEver.genome) } : null,
  }
}

export function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, json2Space(data))], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// Les sessions (gros tableaux de poids) sont écrites compactes ; les
// rapports, destinés à être lus, sont indentés.
function json2Space(data) {
  return data?.population ? 0 : 2
}
