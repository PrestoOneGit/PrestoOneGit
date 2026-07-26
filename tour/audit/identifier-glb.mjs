// Reconnaître des .glb mal nommés.
//
// Rend chaque fichier de `modeles/` en image sur fond blanc, sous trois
// angles, dans `audit/glb-apercu/`. Il n'y a plus qu'à regarder les images
// et renommer les fichiers d'après le catalogue de data.js.
//
// Écrit aussi `audit/glb-apercu/inventaire.json` : dimensions, nombre de
// triangles et couleurs dominantes de chaque modèle — souvent suffisant
// pour trancher sans même ouvrir les images.
//
// Lancer : node audit/identifier-glb.mjs

import { spawn } from 'node:child_process'
import { readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const DOSSIER = resolve(ROOT, 'modeles')
const SORTIE = resolve(HERE, 'glb-apercu')
const PORT = 5191

if (!existsSync(DOSSIER)) {
  console.error(`Dossier introuvable : ${DOSSIER}`)
  process.exit(2)
}
const fichiers = readdirSync(DOSSIER).filter((f) => f.toLowerCase().endsWith('.glb'))
if (!fichiers.length) {
  console.log('Aucun .glb dans modeles/ — rien à identifier.')
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

console.log(`${fichiers.length} fichier(s) à rendre…\n`)
const vite = spawn('npx', ['vite', '--port', String(PORT), '--host', '127.0.0.1'], {
  cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32',
})

const inventaire = []
try {
  const exe = process.env.CHROMIUM_PATH
  const browser = await chromium.launch(
    exe ? { executablePath: exe, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] }
  )
  const page = await browser.newPage({ viewport: { width: 640, height: 640 } })
  page.on('pageerror', (e) => console.warn('  erreur page :', e.message))

  let ok = false
  for (let i = 0; i < 40 && !ok; i++) {
    try {
      await page.goto(`http://127.0.0.1:${PORT}/audit/apercu-glb.html`, { waitUntil: 'networkidle' })
      await page.waitForFunction(() => window.pret === true, { timeout: 2000 })
      ok = true
    } catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  if (!ok) throw new Error('serveur Vite injoignable')

  for (const f of fichiers) {
    const url = `/modeles/${encodeURIComponent(f)}`
    const base = f.replace(/\.glb$/i, '').replace(/[^\w.-]/g, '_')
    let infos = null
    // Trois angles : face, trois-quarts, profil. Une créature se reconnaît
    // rarement sous un seul angle.
    for (const [angle, suffixe] of [[0, 'face'], [35, '3-4'], [90, 'profil']]) {
      infos = await page.evaluate(([u, a]) => window.charger(u, a), [url, angle])
      await page.screenshot({ path: resolve(SORTIE, `${base}__${suffixe}.png`) })
    }
    inventaire.push({ fichier: f, ...infos })
    console.log(
      `  ${f.padEnd(34)} ${String(infos.triangles).padStart(6)} tri · ` +
        `${infos.dimensions.join(' × ')} · ${infos.couleurs.join(' ')}`
    )
  }
  await browser.close()
} finally {
  vite.kill()
}

writeFileSync(resolve(SORTIE, 'inventaire.json'), JSON.stringify(inventaire, null, 2))
console.log(`\nImages et inventaire écrits dans audit/glb-apercu/`)
console.log('Renomme ensuite les fichiers de modeles/ d’après les identifiants de data.js.')
