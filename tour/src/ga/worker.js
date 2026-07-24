import { runTower } from '../sim/engine.js'

// Un worker évalue des génomes en série, chacun sur plusieurs graines,
// à vitesse maximale. Il envoie régulièrement un instantané du run en
// cours pour alimenter les mini-tours du HUD.

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
    let floors = 0
    let lastPost = 0
    for (const seed of job.seeds) {
      const res = runTower(genome, seed, (snap) => {
        const now = performance.now()
        if (now - lastPost > 90) {
          lastPost = now
          self.postMessage({ type: 'snapshot', workerId, genomeIndex: job.index, snap })
        }
      })
      total += res.fitness
      floors = Math.max(floors, res.floors)
    }
    self.postMessage({
      type: 'result',
      workerId,
      index: job.index,
      fitness: total / job.seeds.length,
      floors,
    })
  }
  self.postMessage({ type: 'batchDone', workerId })
}
