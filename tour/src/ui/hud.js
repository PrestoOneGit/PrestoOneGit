import { HALF } from '../sim/engine.js'
import { CLASSES } from '../sim/data.js'

// Interface du tableau de bord. Trois zones de grille qui ne peuvent pas
// se chevaucher (barre, escouade + panneau latéral, frise), plus une
// modale pour le rapport.
//
// La frise est la pièce centrale : à 300 générations, une liste de
// records ne suffit plus à naviguer. La courbe entière est cliquable —
// on désigne un point, on rejoue le champion de cette génération.

export class HUD {
  constructor({
    workerCount, onPauseToggle, onReset, onReplaySpeed, onSelectRecord,
    onQualityToggle, onPickGeneration, onReport, onSessionAction,
  }) {
    this.ui = document.getElementById('ui')
    this.mGen = document.getElementById('m-gen')
    this.mBest = document.getElementById('m-best')
    this.mMean = document.getElementById('m-mean')
    this.mRun = document.getElementById('m-run')
    this.saveState = document.getElementById('save-state')
    this.squadList = document.getElementById('squad-list')
    this.squadGen = document.getElementById('squad-gen')
    this.recordsList = document.getElementById('records-list')
    this.runsHint = document.getElementById('runs-hint')
    this.log = document.getElementById('log')
    this.chart = document.getElementById('chart')
    this.onSelectRecord = onSelectRecord
    this.onPickGeneration = onPickGeneration
    this.history = []
    this.squadRows = []
    this.squadFor = null

    document.getElementById('workers-hint').textContent =
      `${workerCount} ascensions simulées en parallèle, une par cœur`

    // --- Vitesse de rejeu ---
    this.speedButtons = [...document.querySelectorAll('[data-rspeed]')]
    for (const btn of this.speedButtons) {
      btn.addEventListener('click', () => {
        this.speedButtons.forEach((b) => b.classList.remove('on'))
        btn.classList.add('on')
        onReplaySpeed(Number(btn.dataset.rspeed))
      })
    }

    // --- Onglets ---
    this.tabs = [...document.querySelectorAll('[role="tab"]')]
    this.panels = [...document.querySelectorAll('.tab-panel')]
    for (const tab of this.tabs) {
      tab.addEventListener('click', () => this.selectTab(tab.dataset.tab))
    }

    // --- Boutons de la barre ---
    this.pauseBtn = document.getElementById('pause-evo')
    this.pauseBtn.addEventListener('click', () => {
      const paused = onPauseToggle()
      this.pauseBtn.textContent = paused ? 'Reprendre' : 'Pause'
      this.pauseBtn.classList.toggle('on', paused)
    })

    this.qualityBtn = document.getElementById('quality')
    this.qualityBtn.addEventListener('click', () => {
      this.qualityBtn.textContent = onQualityToggle()
    })

    document.getElementById('report').addEventListener('click', () => onReport())

    // --- Panneau latéral repliable ---
    const dockToggle = document.getElementById('toggle-dock')
    dockToggle.addEventListener('click', () => {
      const hidden = this.ui.classList.toggle('dock-hidden')
      dockToggle.textContent = hidden ? '‹' : '›'
      // La caméra recadre le plateau sur la zone libre : elle doit
      // remesurer dès qu'un panneau apparaît ou disparaît.
      window.dispatchEvent(new Event('resize'))
    })

    const timelineToggle = document.getElementById('toggle-timeline')
    timelineToggle.addEventListener('click', () => {
      this.ui.classList.toggle('timeline-collapsed')
      this.resizeChart()
      window.dispatchEvent(new Event('resize'))
    })

    // --- Menu session ---
    this.sessionMenu = document.getElementById('session-menu')
    const menuBtn = document.getElementById('save-menu')
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      const open = this.sessionMenu.hidden
      this.sessionMenu.hidden = !open
      menuBtn.setAttribute('aria-expanded', String(open))
    })
    document.addEventListener('click', (e) => {
      if (!this.sessionMenu.hidden && !this.sessionMenu.contains(e.target)) {
        this.sessionMenu.hidden = true
        menuBtn.setAttribute('aria-expanded', 'false')
      }
    })
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return
      this.sessionMenu.hidden = true
      this.closeReport()
    })

    const actions = {
      'save-now': 'save',
      'export-session': 'export',
      'import-session': 'import',
      'wipe-session': 'wipe',
      reset: 'reset',
    }
    for (const [id, action] of Object.entries(actions)) {
      document.getElementById(id).addEventListener('click', () => {
        this.sessionMenu.hidden = true
        action === 'reset' ? onReset() : onSessionAction(action)
      })
    }

    // --- Saut vers une génération ---
    document.getElementById('gen-form').addEventListener('submit', (e) => {
      e.preventDefault()
      const value = Number.parseInt(document.getElementById('gen-input').value, 10)
      if (Number.isFinite(value)) onPickGeneration(value)
    })

    // --- Rapport ---
    this.reportOverlay = document.getElementById('report-overlay')
    this.reportBody = document.getElementById('report-body')
    document.getElementById('report-close').addEventListener('click', () => this.closeReport())
    this.reportOverlay.addEventListener('click', (e) => {
      if (e.target === this.reportOverlay) this.closeReport()
    })
    document.getElementById('report-copy').addEventListener('click', () => onSessionAction('copyReport'))
    document.getElementById('report-json').addEventListener('click', () => onSessionAction('exportReport'))

    // --- Mini-arènes, une par worker ---
    this.cells = []
    const grid = document.getElementById('workers-grid')
    for (let i = 0; i < workerCount; i++) {
      const cell = document.createElement('div')
      cell.className = 'worker'
      const canvas = document.createElement('canvas')
      canvas.width = 96
      canvas.height = 96
      const label = document.createElement('span')
      label.textContent = '—'
      cell.append(canvas, label)
      grid.appendChild(cell)
      this.cells.push({ ctx: canvas.getContext('2d'), label })
    }

    // --- Frise cliquable ---
    this.chart.addEventListener('click', (e) => this.pickFromChart(e))
    this.chart.addEventListener('mousemove', (e) => this.hoverChart(e))
    this.chart.addEventListener('mouseleave', () => {
      this.hoverGen = null
      this.drawChart(this.history)
    })
    this.resizeChart()
    window.addEventListener('resize', () => this.resizeChart())
  }

  selectTab(name) {
    for (const tab of this.tabs) {
      const on = tab.dataset.tab === name
      tab.classList.toggle('on', on)
      tab.setAttribute('aria-selected', String(on))
    }
    for (const panel of this.panels) {
      panel.classList.toggle('on', panel.dataset.panel === name)
    }
  }

  closeReport() {
    this.reportOverlay.hidden = true
  }

  resetControls() {
    this.pauseBtn.textContent = 'Pause'
    this.pauseBtn.classList.remove('on')
  }

  setSaveState(text, saved = false) {
    this.saveState.textContent = text
    this.saveState.title = text
    this.saveState.classList.toggle('saved', saved)
  }

  setGenInfo(generation, best, mean) {
    this.mGen.textContent = generation
    this.mBest.textContent = Math.round(best).toLocaleString('fr-FR')
    this.mMean.textContent = Math.round(mean).toLocaleString('fr-FR')
  }

  setReplayInfo(text) {
    this.mRun.textContent = text
    this.mRun.title = text
  }

  addLog(text) {
    const li = document.createElement('li')
    li.textContent = text
    this.log.prepend(li)
    while (this.log.children.length > 40) this.log.removeChild(this.log.lastChild)
  }

  // ─── Escouade ───

  buildTeamPanel(run) {
    this.squadList.innerHTML = ''
    this.squadRows = []
    this.squadFor = run
    for (const hero of run.heroes) {
      const li = document.createElement('li')
      li.className = 'agent'

      const mark = document.createElement('span')
      mark.className = 'agent-mark'
      mark.style.background = hero.cls.color

      const body = document.createElement('div')
      body.className = 'agent-body'

      const top = document.createElement('div')
      top.className = 'agent-top'
      const name = document.createElement('span')
      name.className = 'agent-name'
      name.textContent = hero.cls.label
      const stat = document.createElement('span')
      stat.className = 'agent-stat'
      stat.textContent = '—'
      top.append(name, stat)

      const bars = document.createElement('div')
      bars.className = 'bars'
      const mkBar = (color) => {
        const track = document.createElement('div')
        track.className = 'bar-track'
        const fill = document.createElement('div')
        fill.className = 'bar-fill'
        fill.style.background = color
        track.appendChild(fill)
        bars.appendChild(track)
        return fill
      }
      const hp = mkBar(hero.cls.color)
      const mana = mkBar('#4a7fb5')

      body.append(top, bars)
      li.append(mark, body)
      this.squadList.appendChild(li)
      this.squadRows.push({ li, stat, hp, mana })
    }
  }

  updateTeamStats(run, generation) {
    this.squadGen.textContent = `gén. ${generation}`
    if (this.squadFor !== run) this.buildTeamPanel(run)
    run.heroes.forEach((h, i) => {
      const row = this.squadRows[i]
      row.li.classList.toggle('down', !h.alive)
      row.hp.style.transform = `scaleX(${Math.max(h.hp / h.maxHp, 0)})`
      row.mana.style.transform = `scaleX(${Math.max(h.mana / h.maxMana, 0)})`
      row.stat.textContent =
        h.healing > h.damage ? `${Math.round(h.healing)} soins` : `${Math.round(h.damage)} dgt`
    })
  }

  // ─── Mini-arènes ───

  drawSnapshot(workerId, genomeIndex, snap) {
    const cell = this.cells[workerId]
    if (!cell) return
    const { ctx } = cell
    const size = 96
    const scale = size / 2 / (HALF + 1)
    ctx.fillStyle = '#0d1012'
    ctx.fillRect(0, 0, size, size)
    // Le plateau est carré : on trace son contour, pas un cercle.
    ctx.strokeStyle = 'rgba(255,255,255,0.1)'
    const side = HALF * 2 * scale
    ctx.strokeRect(size / 2 - side / 2, size / 2 - side / 2, side, side)
    for (const m of snap.monsters) {
      ctx.fillStyle = m.boss ? '#cf5f55' : '#6b7d5c'
      const r = 1.5 + m.size * 1.7
      ctx.fillRect(size / 2 + m.x * scale - r / 2, size / 2 + m.z * scale - r / 2, r, r)
    }
    for (const h of snap.heroes) {
      ctx.fillStyle = h.alive ? CLASSES[h.classIndex].color : '#3a4144'
      ctx.beginPath()
      ctx.arc(size / 2 + h.x * scale, size / 2 + h.z * scale, 2.2, 0, Math.PI * 2)
      ctx.fill()
    }
    cell.label.textContent = `étage ${snap.floor}`
  }

  // ─── Frise ───

  resizeChart() {
    const rect = this.chart.getBoundingClientRect()
    if (rect.width === 0) return
    const dpr = Math.min(window.devicePixelRatio, 2)
    this.chart.width = Math.round(rect.width * dpr)
    this.chart.height = Math.round(rect.height * dpr)
    this.chartCtx = this.chart.getContext('2d')
    this.chartCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.chartW = rect.width
    this.chartH = rect.height
    this.drawChart(this.history)
  }

  chartGeometry() {
    return { padL: 8, padR: 8, padT: 10, padB: 16 }
  }

  generationAt(clientX) {
    if (this.history.length === 0) return null
    const rect = this.chart.getBoundingClientRect()
    const { padL, padR } = this.chartGeometry()
    const usable = Math.max(rect.width - padL - padR, 1)
    const ratio = Math.min(Math.max((clientX - rect.left - padL) / usable, 0), 1)
    const index = Math.round(ratio * (this.history.length - 1))
    return this.history[index]?.gen ?? null
  }

  hoverChart(e) {
    const gen = this.generationAt(e.clientX)
    if (gen === this.hoverGen) return
    this.hoverGen = gen
    this.drawChart(this.history)
  }

  pickFromChart(e) {
    const gen = this.generationAt(e.clientX)
    if (gen != null) this.onPickGeneration(gen)
  }

  drawChart(history) {
    this.history = history ?? []
    const ctx = this.chartCtx
    if (!ctx) return
    const w = this.chartW
    const h = this.chartH
    ctx.clearRect(0, 0, w, h)

    if (this.history.length < 2) {
      ctx.fillStyle = '#5d666a'
      ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
      ctx.fillText('En attente de la deuxième génération…', 10, h / 2)
      return
    }

    const { padL, padR, padT, padB } = this.chartGeometry()
    const plotW = w - padL - padR
    const plotH = h - padT - padB
    const n = this.history.length
    // Échelle sur l'étendue réelle des valeurs, pas depuis zéro : après
    // 300 générations, une fitness qui passe de 8 000 à 12 000 serait
    // sinon une ligne plate collée en haut du cadre.
    const lo = Math.min(...this.history.map((p) => p.mean))
    const hi = Math.max(...this.history.map((p) => p.best))
    const span = Math.max(hi - lo, 1) * 1.15
    const base = lo - Math.max(hi - lo, 1) * 0.08
    const x = (i) => padL + (i / (n - 1)) * plotW
    const y = (v) => padT + plotH - ((v - base) / span) * plotH

    // Repères horizontaux
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'
    ctx.lineWidth = 1
    for (let g = 0; g <= 3; g++) {
      const gy = padT + (plotH / 3) * g
      ctx.beginPath()
      ctx.moveTo(padL, gy)
      ctx.lineTo(w - padR, gy)
      ctx.stroke()
    }

    // Bande entre moyenne et record : l'écart se lit d'un coup d'œil
    ctx.beginPath()
    this.history.forEach((p, i) => (i === 0 ? ctx.moveTo(x(i), y(p.best)) : ctx.lineTo(x(i), y(p.best))))
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(x(i), y(this.history[i].mean))
    ctx.closePath()
    ctx.fillStyle = 'rgba(63,184,168,0.09)'
    ctx.fill()

    const line = (key, color, width) => {
      ctx.strokeStyle = color
      ctx.lineWidth = width
      ctx.lineJoin = 'round'
      ctx.beginPath()
      this.history.forEach((p, i) => (i === 0 ? ctx.moveTo(x(i), y(p[key])) : ctx.lineTo(x(i), y(p[key]))))
      ctx.stroke()
    }
    line('mean', 'rgba(138,148,153,0.55)', 1.25)
    line('best', '#3fb8a8', 1.75)

    // Paliers d'étage franchis : là où le record d'étage progresse
    let seen = -1
    ctx.fillStyle = 'rgba(63,184,168,0.9)'
    this.history.forEach((p, i) => {
      if (p.floors > seen) {
        seen = p.floors
        ctx.beginPath()
        ctx.arc(x(i), y(p.best), 2.4, 0, Math.PI * 2)
        ctx.fill()
      }
    })

    // Curseur de survol
    if (this.hoverGen != null) {
      const i = this.history.findIndex((p) => p.gen === this.hoverGen)
      if (i >= 0) {
        const point = this.history[i]
        ctx.strokeStyle = 'rgba(255,255,255,0.22)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(x(i), padT)
        ctx.lineTo(x(i), padT + plotH)
        ctx.stroke()
        ctx.fillStyle = '#e6eaec'
        ctx.beginPath()
        ctx.arc(x(i), y(point.best), 3, 0, Math.PI * 2)
        ctx.fill()

        const label = `gén. ${point.gen} · étage ${point.floors + 1} · ${Math.round(point.best).toLocaleString('fr-FR')}`
        ctx.font = '10px ui-monospace, monospace'
        const tw = ctx.measureText(label).width
        const tx = Math.min(Math.max(x(i) - tw / 2, padL), w - padR - tw)
        ctx.fillStyle = 'rgba(11,13,14,0.9)'
        ctx.fillRect(tx - 4, padT + plotH + 3, tw + 8, 13)
        ctx.fillStyle = '#e6eaec'
        ctx.fillText(label, tx, padT + plotH + 13)
      }
    } else {
      // Bornes : première et dernière génération
      ctx.font = '10px ui-monospace, monospace'
      ctx.fillStyle = '#5d666a'
      ctx.fillText(`gén. ${this.history[0].gen}`, padL, h - 3)
      const last = `gén. ${this.history[n - 1].gen}`
      ctx.fillText(last, w - padR - ctx.measureText(last).width, h - 3)
    }
  }

  // ─── Rejeux ───

  renderRecords(records, activeGeneration) {
    this.recordsList.innerHTML = ''
    if (!records || records.length === 0) {
      this.runsHint.textContent = 'Aucun record pour l’instant — laissez l’entraînement tourner.'
      return
    }
    this.runsHint.textContent =
      `${records.length} record${records.length > 1 ? 's' : ''} · saisissez un numéro ou cliquez la courbe pour toute autre génération`
    for (const rec of records) {
      const li = document.createElement('li')
      const btn = document.createElement('button')
      const floor = document.createElement('span')
      floor.className = 'run-floor'
      floor.textContent = `étage ${rec.floors + 1}`
      const gen = document.createElement('span')
      gen.className = 'run-gen'
      gen.textContent = `gén. ${rec.generation}`
      btn.append(floor, gen)
      if (rec.generation === activeGeneration) btn.classList.add('on')
      btn.addEventListener('click', () => this.onSelectRecord(rec))
      li.appendChild(btn)
      this.recordsList.appendChild(li)
    }
  }

  // ─── Rapport ───

  showReport(report) {
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
    const m = report.meta
    const t = report.totaux

    const agents = report.agents
      .map((a) => {
        const up = a.ameliorations.map((u) => `${u.id} ×${u.rangs}`).join(', ') || '—'
        const caps =
          a.utilisation.capacites
            .filter((c) => c.fois > 0)
            .map((c) => `${c.label} ×${c.fois}`)
            .join(', ') || '—'
        return `<tr>
          <td>${esc(a.label)}</td>
          <td class="num">${a.niveau}</td>
          <td class="num">${a.degatsInfliges.toLocaleString('fr-FR')}</td>
          <td class="num">${a.soins.toLocaleString('fr-FR')}</td>
          <td class="num">${a.degatsSubis.toLocaleString('fr-FR')}</td>
          <td class="${a.etageDeMort ? '' : 'muted'}">${a.etageDeMort ? `tombé étage ${a.etageDeMort}` : 'survit'}</td>
          <td>${esc(up)}</td>
          <td class="num">${a.utilisation.dash}/${a.utilisation.course}/${a.utilisation.bond}</td>
          <td class="muted">${esc(caps)}</td>
        </tr>`
      })
      .join('')

    const floors = report.etages
      .map((f) => {
        const monstres = Object.entries(f.monstres).map(([k, v]) => `${v}× ${k}`).join(', ')
        const morts = f.morts.map((d) => d.agent).join(', ')
        return `<tr>
          <td class="num">${f.etage}${f.echec ? ' ✗' : ''}</td>
          <td class="muted">${f.boss ? 'boss' : ''}</td>
          <td class="num">${f.duree}s</td>
          <td class="muted">${esc(monstres)}</td>
          <td class="num">${f.degatsInfliges.toLocaleString('fr-FR')}</td>
          <td class="num">${f.degatsSubis.toLocaleString('fr-FR')}</td>
          <td class="${morts ? '' : 'muted'}">${esc(morts) || '—'}</td>
          <td class="muted">${f.reposApres ? 'repos' : ''}</td>
        </tr>`
      })
      .join('')

    this.reportBody.innerHTML = `
      <p class="lede">
        Génération <b>${m.generation ?? '?'}</b> · <b>${esc(m.compositionLisible)}</b> ·
        étage <b>${m.etageAtteint}</b> atteint, issue « ${esc(m.issue)} » ·
        ${m.dureeSecondes}s · ${m.survivants}/5 survivants · ${m.reposUtilises} repos ·
        <b>${t.degats.toLocaleString('fr-FR')}</b> dégâts (${t.degatsParSeconde}/s),
        ${t.soins.toLocaleString('fr-FR')} soins, ${t.degatsSubis.toLocaleString('fr-FR')} subis.
      </p>
      <h3>Agents</h3>
      <div class="table-scroll"><table>
        <thead><tr><th>Classe</th><th>Niv</th><th>Dégâts</th><th>Soins</th><th>Subis</th>
        <th>Fin</th><th>Améliorations</th><th>Dash/Course/Bond</th><th>Capacités</th></tr></thead>
        <tbody>${agents}</tbody>
      </table></div>
      <h3>Étage par étage</h3>
      <div class="table-scroll"><table>
        <thead><tr><th>Étage</th><th></th><th>Durée</th><th>Monstres</th><th>Dégâts</th>
        <th>Subis</th><th>Pertes</th><th></th></tr></thead>
        <tbody>${floors}</tbody>
      </table></div>`
    this.reportOverlay.hidden = false
  }
}
