import { ARENA_RADIUS, GENES, GENES_PER_HERO, HERO_CLASSES } from '../sim/engine.js'

// HUD : mur de mini-arènes (une par worker), courbe de fitness, gènes de la
// meilleure équipe et journal d'apprentissage.
export class HUD {
  constructor({ workerCount, onPauseToggle, onReset }) {
    this.genInfo = document.getElementById('gen-info')
    this.replayInfo = document.getElementById('replay-info')
    this.teamGen = document.getElementById('team-gen')
    this.teamGrid = document.getElementById('team-grid')
    this.chart = document.getElementById('chart')
    this.log = document.getElementById('log')
    this.workersTitle = document.getElementById('workers-title')
    this.workersTitle.textContent = `Simulations parallèles — ${workerCount} cœurs`

    this.pauseBtn = document.getElementById('pause-evo')
    this.pauseBtn.addEventListener('click', () => {
      const paused = onPauseToggle()
      this.pauseBtn.textContent = paused ? 'Reprendre l’évolution' : 'Suspendre l’évolution'
    })
    document.getElementById('reset').addEventListener('click', onReset)

    // Mini-canvases, un par worker
    this.cells = []
    const grid = document.getElementById('workers-grid')
    for (let i = 0; i < workerCount; i++) {
      const cell = document.createElement('div')
      cell.className = 'worker-cell'
      const canvas = document.createElement('canvas')
      canvas.width = 104
      canvas.height = 104
      const label = document.createElement('span')
      label.textContent = `#${i + 1}`
      cell.append(canvas, label)
      grid.appendChild(cell)
      this.cells.push({ ctx: canvas.getContext('2d'), label })
    }

    this.buildTeamPanel()
  }

  buildTeamPanel() {
    this.geneFills = []
    this.teamGrid.innerHTML = ''
    HERO_CLASSES.forEach((cls) => {
      const block = document.createElement('div')
      block.className = 'hero-block'
      const title = document.createElement('h3')
      const dot = document.createElement('span')
      dot.className = 'hero-dot'
      dot.style.background = cls.color
      title.append(dot, document.createTextNode(cls.label))
      block.appendChild(title)
      const fills = []
      GENES.forEach((gene) => {
        const row = document.createElement('div')
        row.className = 'gene-row'
        const label = document.createElement('span')
        label.textContent = gene.label
        const bar = document.createElement('div')
        bar.className = 'gene-bar'
        const fill = document.createElement('div')
        fill.className = 'gene-fill'
        fill.style.background = cls.color
        bar.appendChild(fill)
        row.append(label, bar)
        block.appendChild(row)
        fills.push(fill)
      })
      this.teamGrid.appendChild(block)
      this.geneFills.push(fills)
    })
  }

  showGenome(genome, generation) {
    this.teamGen.textContent = `gén. ${generation}`
    for (let h = 0; h < HERO_CLASSES.length; h++) {
      for (let i = 0; i < GENES_PER_HERO; i++) {
        const spec = GENES[i]
        const v = genome[h * GENES_PER_HERO + i]
        const frac = (v - spec.min) / (spec.max - spec.min)
        this.geneFills[h][i].style.width = `${(frac * 100).toFixed(1)}%`
      }
    }
  }

  drawSnapshot(workerId, genomeIndex, snap) {
    const cell = this.cells[workerId]
    if (!cell) return
    const { ctx } = cell
    const size = 104
    const scale = size / 2 / (ARENA_RADIUS + 1)
    ctx.fillStyle = '#262019'
    ctx.fillRect(0, 0, size, size)
    ctx.strokeStyle = 'rgba(250,246,238,0.18)'
    ctx.beginPath()
    ctx.arc(size / 2, size / 2, ARENA_RADIUS * scale, 0, Math.PI * 2)
    ctx.stroke()
    for (const m of snap.monsters) {
      ctx.fillStyle = '#6e9e50'
      const r = 1.6 + m.size * 1.6
      ctx.fillRect(size / 2 + m.x * scale - r / 2, size / 2 + m.z * scale - r / 2, r, r)
    }
    snap.heroes.forEach((h, i) => {
      ctx.fillStyle = h.alive ? HERO_CLASSES[i].color : '#55504a'
      ctx.beginPath()
      ctx.arc(size / 2 + h.x * scale, size / 2 + h.z * scale, 2.4, 0, Math.PI * 2)
      ctx.fill()
    })
    cell.label.textContent = `#${genomeIndex + 1} — v${snap.wave}`
  }

  drawChart(history) {
    const ctx = this.chart.getContext('2d')
    const w = this.chart.width
    const h = this.chart.height
    ctx.clearRect(0, 0, w, h)
    if (history.length < 2) {
      ctx.fillStyle = '#8d857a'
      ctx.font = '12px sans-serif'
      ctx.fillText('En attente de la première génération…', 10, h / 2)
      return
    }
    const max = Math.max(...history.map((p) => p.best)) * 1.05
    const line = (key, color) => {
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.beginPath()
      history.forEach((p, i) => {
        const x = (i / (history.length - 1)) * (w - 12) + 6
        const y = h - 8 - (p[key] / max) * (h - 20)
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      })
      ctx.stroke()
    }
    line('mean', 'rgba(141,133,122,0.7)')
    line('best', '#c96f4a')
    ctx.fillStyle = '#8d857a'
    ctx.font = '10px sans-serif'
    ctx.fillText('record', w - 44, 12)
    ctx.fillStyle = '#c96f4a'
    ctx.fillRect(w - 58, 6, 9, 7)
  }

  setGenInfo(generation, best, mean) {
    this.genInfo.textContent = `Génération ${generation} — record ${Math.round(best)} · moyenne ${Math.round(mean)}`
  }

  setReplayInfo(text) {
    this.replayInfo.textContent = `Rejeu : ${text}`
  }

  addLog(text) {
    const li = document.createElement('li')
    li.textContent = text
    this.log.prepend(li)
    while (this.log.children.length > 4) this.log.removeChild(this.log.lastChild)
  }
}
