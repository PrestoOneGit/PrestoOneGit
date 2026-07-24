import { runMatch } from '../sim/engine.js'

// Un worker évalue des génomes en série, chacun sur plusieurs graines,
// à vitesse maximale. Il envoie régulièrement un instantané du combat en
// cours pour alimenter les mini-arènes du HUD.

let workerId = -1

self.onmessage = (e) => {
  const msg = e.data
  if (msg.type === 'init') {
    workerId = msg.workerId
    return
  }
  if (msg.type !== 'eval') return

  for (const job of msg.jobs) {
    const genome = new Float32Array(job.genome)
    let total = 0
    let waves = 0
    let lastPost = 0
    for (const seed of job.seeds) {
      const res = runMatch(genome, seed, (snap) => {
        // Limite le débit vers le fil principal (les matchs sont très rapides)
        const now = performance.now()
        if (now - lastPost > 90) {
          lastPost = now
          self.postMessage({ type: 'snapshot', workerId, genomeIndex: job.index, snap })
        }
      })
      total += res.fitness
      waves = Math.max(waves, res.waves)
    }
    self.postMessage({
      type: 'result',
      workerId,
      index: job.index,
      fitness: total / job.seeds.length,
      waves,
    })
  }
  self.postMessage({ type: 'batchDone', workerId })
}
