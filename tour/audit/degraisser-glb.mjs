// Dégraisser et renommer les modèles bruts.
//
// Entrée  : `modeles-brut/` — les fichiers tels que sortis du générateur,
//           avec leurs noms illisibles et leurs textures PBR 2048².
// Sortie  : `modeles/` — un fichier par identifiant du catalogue, sans la
//           moindre image, couleurs reportées dans la géométrie.
//
// Pourquoi : 15 à 20 Mo par créature pour un pion de 27 pixels à l'écran.
// Le rendu du jeu est facetté et sans reflets — les cartes normales,
// rugosité et occlusion ne changent strictement rien à l'image, elles
// rendent seulement le projet inchargeable dans un navigateur.
//
// La correspondance nom-de-fichier → identifiant est dans
// `audit/noms-modeles.json`.
//
// Lancer : node audit/degraisser-glb.mjs

import { spawn } from 'node:child_process'
import { readdirSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const SOURCE = resolve(ROOT, 'modeles-brut')
const SORTIE = resolve(ROOT, 'modeles')
const PORT = 5192

if (!existsSync(SOURCE)) {
  console.error(`Dossier introuvable : ${SOURCE}\nY déposer les .glb bruts, puis relancer.`)
  process.exit(2)
}
const noms = JSON.parse(readFileSync(resolve(HERE, 'noms-modeles.json'), 'utf8'))
const fichiers = readdirSync(SOURCE).filter((f) => f.toLowerCase().endsWith('.glb'))
if (!fichiers.length) {
  console.log('Aucun .glb dans modeles-brut/.')
  process.exit(0)
}
mkdirSync(SORTIE, { recursive: true })

let chromium
try {
  ({ chromium } = await import('playwright'))
} catch {
  console.error('Playwright absent. Installer avec : npm i -D playwright && npx playwright install chromium')
  process.exit(2)
}

const vite = spawn('npx', ['vite', '--port', String(PORT), '--host', '127.0.0.1'], {
  cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32',
})

const mo = (o) => (o / 1048576).toFixed(1).padStart(5) + ' Mo'
let avant = 0, apres = 0, faits = 0, ignores = 0

try {
  const exe = process.env.CHROMIUM_PATH
  const browser = await chromium.launch(
    exe ? { executablePath: exe, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] }
  )
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.warn('  erreur page :', e.message))

  let ok = false
  for (let i = 0; i < 40 && !ok; i++) {
    try {
      await page.goto(`http://127.0.0.1:${PORT}/audit/degraisser.html`, { waitUntil: 'networkidle' })
      await page.waitForFunction(() => window.pret === true, { timeout: 2000 })
      ok = true
    } catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  if (!ok) throw new Error('serveur Vite injoignable')

  for (const f of fichiers) {
    const id = noms[f]
    if (id === undefined) {
      console.log(`  ${f}\n    → absent de noms-modeles.json, ignoré`)
      ignores++
      continue
    }
    if (id === null) {
      console.log(`  ${f}\n    → écarté volontairement`)
      ignores++
      continue
    }
    const poidsAvant = statSync(resolve(SOURCE, f)).size
    const { rapport, donnees } = await page.evaluate(
      (u) => window.degraisser(u), `/modeles-brut/${encodeURIComponent(f)}`
    )
    const cible = resolve(SORTIE, `${id}.glb`)
    writeFileSync(cible, Buffer.from(donnees))
    avant += poidsAvant
    apres += rapport.octets
    faits++
    console.log(
      `  ${id.padEnd(14)} ${String(rapport.triangles).padStart(5)} tri · ` +
        `${rapport.textures} texture(s) retirée(s) · ${mo(poidsAvant)} → ${mo(rapport.octets)}`
    )
  }
  await browser.close()
} finally {
  vite.kill()
}

console.log(
  `\n${faits} modèle(s) écrit(s) dans modeles/, ${ignores} ignoré(s).\n` +
    `Poids total : ${mo(avant)} → ${mo(apres)} ` +
    `(${avant ? (100 - (apres / avant) * 100).toFixed(1) : 0} % en moins)`
)
