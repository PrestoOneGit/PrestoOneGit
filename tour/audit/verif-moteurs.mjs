// Reproductibilité ENTRE MOTEURS JavaScript.
//
// L'audit principal vérifie le déterminisme à l'intérieur d'un processus
// Node. C'est nécessaire mais insuffisant : ECMAScript n'impose pas le
// dernier bit de Math.cos, Math.pow, Math.tanh, Math.exp ni Math.hypot, et
// deux moteurs en renvoient des valeurs distinctes. Une simulation chaotique
// amplifie cet écart jusqu'à changer complètement le résultat.
//
// Ce script exécute les mêmes runs dans Node et dans un vrai navigateur,
// puis compare au bit près. C'est le test qui a échoué avant l'introduction
// de `src/sim/exact.js`, et qui doit réussir maintenant.
//
// Lancer : node audit/verif-moteurs.mjs

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { runTower, mulberry32 } from '../src/sim/engine.js'
import { randomTeamGenome } from '../src/sim/brain.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const GRAINES = [11, 104740, 209469, 314198, 777, 900001]
const PORT = 5177

function local() {
  return GRAINES.map((g) => {
    const genome = randomTeamGenome(mulberry32(g))
    const r = runTower(genome, g, null, 40, { emitEvents: false })
    return { graine: g, fitness: r.fitness, etages: r.floors, issue: r.reason }
  })
}

async function navigateur() {
  let chromium
  try {
    ({ chromium } = await import('playwright'))
  } catch {
    console.log('Playwright absent : `npm i -D playwright` pour activer ce test.')
    return null
  }
  const vite = spawn('npx', ['vite', '--port', String(PORT), '--host', '127.0.0.1'], {
    cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32',
  })
  try {
    const exe = process.env.CHROMIUM_PATH
    const browser = await chromium.launch(exe ? { executablePath: exe, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] })
    const page = await browser.newPage()
    let ok = false
    for (let i = 0; i < 40 && !ok; i++) {
      try {
        await page.goto(`http://127.0.0.1:${PORT}/audit/verif-moteurs.html`, { waitUntil: 'networkidle' })
        await page.waitForFunction(() => typeof window.executer === 'function', { timeout: 2000 })
        ok = true
      } catch { await new Promise((r) => setTimeout(r, 500)) }
    }
    if (!ok) throw new Error('serveur Vite injoignable')
    const res = await page.evaluate((g) => window.executer(g), GRAINES)
    await browser.close()
    return res
  } finally {
    vite.kill()
  }
}

console.log('REPRODUCTIBILITÉ ENTRE MOTEURS\n')
const nodeRes = local()
const webRes = await navigateur()
if (!webRes) process.exit(2)

console.log('  graine        Node          navigateur    étages   identique')
console.log('  ' + '─'.repeat(66))
let same = 0
for (let i = 0; i < GRAINES.length; i++) {
  const a = nodeRes[i]
  const b = webRes[i]
  const eq = a.fitness === b.fitness && a.etages === b.etages && a.issue === b.issue
  if (eq) same++
  console.log(
    `  ${String(a.graine).padStart(7)}  ${a.fitness.toFixed(4).padStart(12)}  ${b.fitness.toFixed(4).padStart(12)}  ` +
      `${String(a.etages).padStart(4)}/${String(b.etages).padEnd(4)}  ${eq ? 'oui' : 'NON'}`
  )
}
console.log('\n' + '─'.repeat(68))
if (same === GRAINES.length) {
  console.log(`RÉUSSI : ${same}/${same} runs identiques au bit près entre Node et le navigateur.`)
} else {
  console.log(`ÉCHOUÉ : ${GRAINES.length - same}/${GRAINES.length} runs divergent entre les deux moteurs.`)
  process.exitCode = 1
}
