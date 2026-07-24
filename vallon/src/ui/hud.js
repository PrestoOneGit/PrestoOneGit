// Interface : horloge, population, vitesse, panneau de la créature suivie.
export class HUD {
  constructor({ onSpeedChange, onNewWorld, onClosePanel }) {
    this.clock = document.getElementById('clock')
    this.popCount = document.getElementById('pop-count')
    this.hint = document.getElementById('hint')
    this.panel = document.getElementById('creature-panel')
    this.cName = document.getElementById('c-name')
    this.cMeta = document.getElementById('c-meta')
    this.cState = document.getElementById('c-state')
    this.barFaim = document.getElementById('bar-faim')
    this.barSoif = document.getElementById('bar-soif')
    this.barEnergie = document.getElementById('bar-energie')
    this.statBirths = document.getElementById('stat-births')
    this.statDeaths = document.getElementById('stat-deaths')

    this.speedButtons = [...document.querySelectorAll('.hud-speed button')]
    for (const btn of this.speedButtons) {
      btn.addEventListener('click', () => {
        this.speedButtons.forEach((b) => b.classList.remove('active'))
        btn.classList.add('active')
        onSpeedChange(Number(btn.dataset.speed))
      })
    }

    document.getElementById('new-world').addEventListener('click', onNewWorld)
    document.getElementById('panel-close').addEventListener('click', onClosePanel)

    setTimeout(() => this.hint.classList.add('faded'), 9000)
  }

  update(sim, selected) {
    const day = Math.floor(sim.elapsedDays) + 1
    this.clock.textContent = `Jour ${day} — ${sim.momentLabel()}`
    this.popCount.textContent = sim.creatures.length
    this.statBirths.textContent = `${sim.births} naissance${sim.births > 1 ? 's' : ''}`
    this.statDeaths.textContent = `${sim.deaths} disparition${sim.deaths > 1 ? 's' : ''}`

    if (selected && !selected.isDead) {
      this.panel.hidden = false
      this.cName.textContent = selected.name
      const age = selected.ageDays
      const ageLabel = age < 1 ? 'moins d’un jour' : `${Math.floor(age)} jour${age >= 2 ? 's' : ''}`
      this.cMeta.textContent = `${selected.isAdult ? 'Adulte' : 'Petit'} — ${ageLabel}`
      this.cState.textContent = selected.state.charAt(0).toUpperCase() + selected.state.slice(1)
      this.barFaim.style.width = `${selected.faim.toFixed(0)}%`
      this.barSoif.style.width = `${selected.soif.toFixed(0)}%`
      this.barEnergie.style.width = `${selected.energie.toFixed(0)}%`
    } else {
      this.panel.hidden = true
    }
  }
}
