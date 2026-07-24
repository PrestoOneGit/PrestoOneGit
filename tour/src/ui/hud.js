import { ARENA_RADIUS } from '../sim/engine.js'
import { CLASSES } from '../sim/data.js'

// HUD : mur de mini-tours (une par worker), courbe de l'étage record,
// équipe en rejeu (classes, vie, mana, stats) et journal d'ascension.
export class HUD {
  constructor({
    workerCount, onPauseToggle, onReset, onReplaySpeed, onSelectRecord,
    onQualityToggle, onPickGeneration, onReport, onSessionAction,
  }) {
    this.genInfo = document.getElementById('gen-info')
    this.replayInfo = document.getElementById('replay-info')
    this.teamGen = document.getElementById('team-gen')
    this.teamGrid = document.getElementById('team-grid')
    this.chart = document.getElementById('chart')
    this.log = document.getElementById('log')
    this.recordsList = document.getElementById('records-list')
    this.onSelectRecord = onSelectRecord
    this.workersTitle = document.getElementById('workers-title')
    this.workersTitle.textContent = `Ascensions parallèles — ${workerCount} cœurs`
    this.heroRows = []
    this.rowsFor = null

    this.pauseBtn = document.getElementById('pause-evo')
    this.pauseBtn.title = 'Met l’évolution en pause (le rejeu continue)'
    this.pauseBtn.addEventListener('click', () => {
      const paused = onPauseToggle()
      this.pauseBtn.textContent = paused ? 'Reprendre' : 'Suspendre'
    })
    document.getElementById('reset').addEventListener('click', onReset)

    this.replaySpeedButtons = [...document.querySelectorAll('[data-rspeed]')]
    for (const btn of this.replaySpeedButtons) {
      btn.addEventListener('click', () => {
        this.replaySpeedButtons.forEach((b) => b.classList.remove('active'))
        btn.classList.add('active')
        onReplaySpeed(Number(btn.dataset.rspeed))
      })
    }

    this.qualityBtn = document.getElementById('quality')
    this.qualityBtn.title = 'Niveau de détail du rejeu — sans effet sur la vitesse d’apprentissage'
    this.qualityBtn.addEventListener('click', () => {
      this.qualityBtn.textContent = onQualityToggle()
    })

    // Rejouer une génération précise, pas seulement les records
    document.getElementById('gen-form').addEventListener('submit', (e) => {
      e.preventDefault()
      const input = document.getElementById('gen-input')
      const gen = Number.parseInt(input.value, 10)
      if (Number.isFinite(gen)) onPickGeneration(gen)
    })

    // Rapport
    this.reportPanel = document.getElementById('report-panel')
    this.reportBody = document.getElementById('report-body')
    document.getElementById('report').addEventListener('click', () => onReport())
    document.getElementById('report-close').addEventListener('click', () => {
      this.reportPanel.hidden = true
    })
    document.getElementById('report-copy').addEventListener('click', () => onSessionAction('copyReport'))
    document.getElementById('report-json').addEventListener('click', () => onSessionAction('exportReport'))

    // Menu session (sauvegarde / export / import)
    this.saveState = document.getElementById('save-state')
    this.sessionMenu = document.getElementById('session-menu')
    const menuBtn = document.getElementById('save-menu')
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      this.sessionMenu.hidden = !this.sessionMenu.hidden
    })
    document.addEventListener('click', (e) => {
      if (!this.sessionMenu.hidden && !this.sessionMenu.contains(e.target)) {
        this.sessionMenu.hidden = true
      }
    })
    const menuActions = {
      'save-now': 'save',
      'export-session': 'export',
      'import-session': 'import',
      'wipe-session': 'wipe',
    }
    for (const [id, action] of Object.entries(menuActions)) {
      document.getElementById(id).addEventListener('click', () => {
        this.sessionMenu.hidden = true
        onSessionAction(action)
      })
    }

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
  }

  resetControls() {
    this.pauseBtn.textContent = 'Suspendre'
  }

  setSaveState(text, saved = false) {
    this.saveState.textContent = text
    this.saveState.classList.toggle('saved', saved)
  }

  // Le rapport est rendu en tableaux lisibles ; le JSON et le markdown
  // sont récupérables via les boutons d'export.
  showReport(report) {
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
    const m = report.meta
    const rows = report.agents
      .map((a) => {
        const up = a.ameliorations.map((u) => `${u.id}×${u.rangs}`).join(', ') || '—'
        const caps =
          a.utilisation.capacites
            .filter((c) => c.fois > 0)
            .map((c) => `${c.label} ${c.fois}×`)
            .join(', ') || '—'
        return `<tr>
          <td>${esc(a.label)}</td><td>${a.niveau}</td>
          <td>${a.degatsInfliges}</td><td>${a.soins}</td><td>${a.degatsSubis}</td>
          <td>${a.etageDeMort ? `étage ${a.etageDeMort}` : 'survit'}</td>
          <td>${esc(up)}</td>
          <td>${a.utilisation.dash}/${a.utilisation.course}/${a.utilisation.bond}</td>
          <td>${esc(caps)}</td>
        </tr>`
      })
      .join('')
    const floors = report.etages
      .map((f) => {
        const monstres = Object.entries(f.monstres).map(([k, v]) => `${v}× ${k}`).join(', ')
        const morts = f.morts.map((d) => d.agent).join(', ') || '—'
        return `<tr>
          <td>${f.etage}${f.echec ? ' ✗' : ''}</td><td>${f.boss ? 'boss' : ''}</td>
          <td>${f.duree}s</td><td>${esc(monstres)}</td>
          <td>${f.degatsInfliges}</td><td>${f.degatsSubis}</td>
          <td>${esc(morts)}</td><td>${f.reposApres ? 'oui' : ''}</td>
        </tr>`
      })
      .join('')

    this.reportBody.innerHTML = `
      <h3>Génération ${m.generation ?? '?'} — étage ${m.etageAtteint}, issue « ${esc(m.issue)} »</h3>
      <p>${esc(m.compositionLisible)} · ${m.dureeSecondes}s · ${m.survivants}/5 survivants ·
      ${m.reposUtilises} repos · ${report.totaux.degats} dégâts (${report.totaux.degatsParSeconde}/s),
      ${report.totaux.soins} soins, ${report.totaux.degatsSubis} subis.</p>
      <h3>Agents</h3>
      <div class="report-scroll"><table>
        <tr><th>Classe</th><th>Niv</th><th>Dégâts</th><th>Soins</th><th>Subis</th><th>Fin</th>
        <th>Améliorations</th><th>Dash/Course/Bond</th><th>Capacités</th></tr>
        ${rows}
      </table></div>
      <h3>Étages</h3>
      <div class="report-scroll"><table>
        <tr><th>Étage</th><th></th><th>Durée</th><th>Monstres</th><th>Dégâts</th><th>Subis</th>
        <th>Morts</th><th>Repos</th></tr>
        ${floors}
      </table></div>`
    this.reportPanel.hidden = false
  }

  // Le panneau équipe se reconstruit à chaque nouveau rejeu : la
  // composition (les classes) change d'une équipe à l'autre.
  buildTeamPanel(run) {
    this.teamGrid.innerHTML = ''
    this.heroRows = []
    this.rowsFor = run
    for (const hero of run.heroes) {
      const block = document.createElement('div')
      block.className = 'hero-block'
      const title = document.createElement('h3')
      const dot = document.createElement('span')
      dot.className = 'hero-dot'
      dot.style.background = hero.cls.color
      const state = document.createElement('em')
      state.className = 'hero-state'
      title.append(dot, document.createTextNode(hero.cls.label), state)
      block.appendChild(title)

      const makeRow = (labelText, fillColor) => {
        const row = document.createElement('div')
        row.className = 'gene-row'
        const label = document.createElement('span')
        label.textContent = labelText
        const bar = document.createElement('div')
        bar.className = 'gene-bar'
        const fill = document.createElement('div')
        fill.className = 'gene-fill'
        fill.style.background = fillColor
        bar.appendChild(fill)
        row.append(label, bar)
        block.appendChild(row)
        return fill
      }
      const hpFill = makeRow('Vie', hero.cls.color)
      const manaFill = makeRow('Mana', '#5d93d4')

      const statLine = document.createElement('p')
      statLine.className = 'hero-stat'
      statLine.textContent = '—'
      block.appendChild(statLine)

      this.teamGrid.appendChild(block)
      this.heroRows.push({ state, hpFill, manaFill, statLine })
    }
  }

  updateTeamStats(run, generation) {
    this.teamGen.textContent = `gén. ${generation}`
    if (this.rowsFor !== run) this.buildTeamPanel(run)
    run.heroes.forEach((h, i) => {
      const row = this.heroRows[i]
      row.state.textContent = h.alive ? '' : ' — à terre'
      row.hpFill.style.width = `${((h.hp / h.maxHp) * 100).toFixed(0)}%`
      row.manaFill.style.width = `${((h.mana / h.maxMana) * 100).toFixed(0)}%`
      row.statLine.textContent =
        h.healing > h.damage
          ? `${Math.round(h.healing)} PV soignés`
          : `${Math.round(h.damage)} dégâts infligés`
    })
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
      ctx.fillStyle = m.boss ? '#c95a4a' : '#6e9e50'
      const r = 1.6 + m.size * 1.8
      ctx.fillRect(size / 2 + m.x * scale - r / 2, size / 2 + m.z * scale - r / 2, r, r)
    }
    for (const h of snap.heroes) {
      ctx.fillStyle = h.alive ? CLASSES[h.classIndex].color : '#55504a'
      ctx.beginPath()
      ctx.arc(size / 2 + h.x * scale, size / 2 + h.z * scale, 2.4, 0, Math.PI * 2)
      ctx.fill()
    }
    cell.label.textContent = `#${genomeIndex + 1} — é${snap.floor}`
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
    const last = history[history.length - 1]
    ctx.fillStyle = '#8d857a'
    ctx.font = '10px sans-serif'
    ctx.fillText(`étage ${last.floors + 1}`, w - 52, 12)
  }

  renderRecords(records, activeGeneration) {
    this.recordsList.innerHTML = ''
    records.forEach((rec) => {
      const li = document.createElement('li')
      const btn = document.createElement('button')
      btn.textContent = `Étage ${rec.floors + 1} — gén. ${rec.generation}`
      if (rec.generation === activeGeneration) btn.classList.add('active')
      btn.addEventListener('click', () => this.onSelectRecord(rec))
      li.appendChild(btn)
      this.recordsList.appendChild(li)
    })
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
