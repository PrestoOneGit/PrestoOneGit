// Persistance de l'entraînement : la population, l'historique et les runs
// records survivent à un rechargement de page. Stockage dans IndexedDB
// (capacité bien supérieure à localStorage), plus export/import de fichier
// pour transporter une session entre machines — ou la reprendre après un
// entraînement lancé sur GPU loué.

const DB_NAME = 'tour-training'
const STORE = 'sessions'
const KEY = 'current'
export const SAVE_FORMAT = 2

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
// Format JSON lisible : les génomes deviennent des tableaux de nombres,
// arrondis à 4 décimales pour diviser la taille du fichier par ~2 sans
// effet mesurable sur le comportement des réseaux.

function genomeToArray(g) {
  const out = new Array(g.length)
  for (let i = 0; i < g.length; i++) out[i] = Math.round(g[i] * 10000) / 10000
  return out
}

export function exportSession(state) {
  return {
    format: SAVE_FORMAT,
    exportedAt: new Date().toISOString(),
    generation: state.generation,
    history: state.history,
    population: state.population.map(genomeToArray),
    records: state.records.map((r) => ({ ...r, genome: genomeToArray(r.genome) })),
    bestEver: state.bestEver ? { ...state.bestEver, genome: genomeToArray(state.bestEver.genome) } : null,
  }
}

export function importSession(json) {
  if (!json || json.format !== SAVE_FORMAT) {
    throw new Error(
      `Fichier incompatible (format ${json?.format ?? '?'}, attendu ${SAVE_FORMAT}). ` +
        'Il vient probablement d’une version où les règles ou les réseaux étaient différents.'
    )
  }
  return {
    generation: json.generation ?? 0,
    population: json.population.map((a) => Float32Array.from(a)),
    history: json.history ?? [],
    records: (json.records ?? []).map((r) => ({ ...r, genome: Float32Array.from(r.genome) })),
    bestEver: json.bestEver ? { ...json.bestEver, genome: Float32Array.from(json.bestEver.genome) } : null,
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
