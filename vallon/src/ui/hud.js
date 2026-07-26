import { SITE_STATUS } from '../history/history.js'

// Interface : horloge, population, vitesse, chronique, panneaux créature et village.
export class HUD {
  constructor({ onSpeedChange, onNewWorld, onClosePanel, onAdvanceYears }) {
    this.clock = document.getElementById('clock')
    this.popCount = document.getElementById('pop-count')
    this.popLabel = document.getElementById('pop-label')
    this.hint = document.getElementById('hint')
    this.ticker = document.getElementById('ticker')

    this.panel = document.getElementById('creature-panel')
    this.cName = document.getElementById('c-name')
    this.cMeta = document.getElementById('c-meta')
    this.cState = document.getElementById('c-state')
    this.barFaim = document.getElementById('bar-faim')
    this.barSoif = document.getElementById('bar-soif')
    this.barEnergie = document.getElementById('bar-energie')

    this.villagePanel = document.getElementById('village-panel')
    this.vName = document.getElementById('v-name')
    this.vMeta = document.getElementById('v-meta')
    this.vHouse = document.getElementById('v-house')
    this.vEvents = document.getElementById('v-events')

    this.chronicle = document.getElementById('chronicle')
    this.chronicleList = document.getElementById('chronicle-list')
    this.renderedEvents = 0

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
    document.getElementById('village-close').addEventListener('click', onClosePanel)
    document.getElementById('advance-years').addEventListener('click', onAdvanceYears)
    document.getElementById('toggle-chronicle').addEventListener('click', () => {
      this.chronicle.hidden = !this.chronicle.hidden
    })
    document.getElementById('chronicle-close').addEventListener('click', () => {
      this.chronicle.hidden = true
    })

    setTimeout(() => this.hint.classList.add('faded'), 9000)
  }

  resetChronicle() {
    this.chronicleList.innerHTML = ''
    this.renderedEvents = 0
  }

  syncChronicle(history) {
    // Les nouveaux événements sont insérés en tête (plus récents d'abord).
    while (this.renderedEvents < history.chronicle.length) {
      const ev = history.chronicle[this.renderedEvents]
      const li = document.createElement('li')
      li.dataset.type = ev.type
      li.textContent = ev.text
      this.chronicleList.prepend(li)
      this.renderedEvents++
    }
    const last = history.chronicle[history.chronicle.length - 1]
    if (last) this.ticker.textContent = last.text
  }

  statusLabel(site) {
    if (site.status === SITE_STATUS.RUINE) return 'Ruines'
    return site.status.charAt(0).toUpperCase() + site.status.slice(1)
  }

  update(sim, history, selected, selectedSite) {
    this.clock.textContent = `An ${history.year} — ${sim.momentLabel()}`
    this.popCount.textContent = history.totalPopulation()
    const nSites = history.activeSites().length
    this.popLabel.textContent = `âmes — ${nSites} village${nSites > 1 ? 's' : ''}`
    this.syncChronicle(history)

    if (selected && !selected.isDead) {
      this.panel.hidden = false
      this.cName.textContent = selected.name
      const age = selected.ageDays
      const ageLabel = age < 1 ? 'moins d’un jour' : `${Math.floor(age)} jour${age >= 2 ? 's' : ''}`
      this.cMeta.textContent = `Créature sauvage — ${selected.isAdult ? 'adulte' : 'petit'}, ${ageLabel}`
      this.cState.textContent = selected.state.charAt(0).toUpperCase() + selected.state.slice(1)
      this.barFaim.style.width = `${selected.faim.toFixed(0)}%`
      this.barSoif.style.width = `${selected.soif.toFixed(0)}%`
      this.barEnergie.style.width = `${selected.energie.toFixed(0)}%`
    } else {
      this.panel.hidden = true
    }

    if (selectedSite) {
      this.villagePanel.hidden = false
      this.vName.textContent = selectedSite.name
      const pop = Math.round(selectedSite.population)
      this.vMeta.textContent =
        selectedSite.status === SITE_STATUS.RUINE
          ? `Ruines — fondé en l’an ${selectedSite.foundedYear}`
          : `${this.statusLabel(selectedSite)} — ${pop} âmes — fondé en l’an ${selectedSite.foundedYear}`
      const house = history.houseOf(selectedSite)
      this.vHouse.textContent =
        selectedSite.status === SITE_STATUS.RUINE || !house
          ? 'Plus personne ne revendique ces pierres.'
          : `Maison ${house.name} — ${history.chiefLabel(house)}`
      this.vEvents.innerHTML = ''
      for (const ev of history.eventsForSite(selectedSite.id, 4)) {
        const li = document.createElement('li')
        li.textContent = ev.text
        this.vEvents.appendChild(li)
      }
    } else {
      this.villagePanel.hidden = true
    }
  }
}
