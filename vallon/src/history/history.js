import { mulberry32 } from '../core/noise.js'
import { makeNamePools } from './names.js'

// Moteur d'histoire événementiel : fait vivre le monde année par année,
// en agrégé (populations) ponctué d'événements discrets consignés dans
// la chronique. Des siècles se simulent en quelques millisecondes.

export const SITE_STATUS = {
  HAMEAU: 'hameau',
  VILLAGE: 'village',
  BOURG: 'bourg',
  RUINE: 'ruine',
}

const HOUSE_COLORS = [
  '#a34a3c', '#3c6e8f', '#7a6a2f', '#5c4a78', '#3f7a56',
  '#8f5a2c', '#804a5e', '#4a6e3c', '#6e3c3c', '#3c5a7a',
]

let siteId = 1
let houseId = 1

export class HistoryEngine {
  constructor(world, seed) {
    this.world = world
    this.rng = mulberry32(seed ^ 0x51ab7e21)
    this.names = makeNamePools(this.rng)
    this.year = 0
    this.sites = []
    this.houses = []
    this.relations = new Map() // "idA:idB" -> score -100..100
    this.chronicle = []
    this.spots = this.findSpots()
  }

  // ---- Terrain : emplacements plats et espacés pour bâtir ----

  findSpots() {
    const spots = []
    for (let i = 0; i < 400 && spots.length < 9; i++) {
      const p = this.world.randomLandPoint(1.2, 4.6)
      if (!p) continue
      const flat =
        Math.abs(this.world.heightAt(p.x + 3, p.z) - p.y) < 1.0 &&
        Math.abs(this.world.heightAt(p.x, p.z + 3) - p.y) < 1.0 &&
        Math.abs(this.world.heightAt(p.x - 3, p.z) - p.y) < 1.0
      if (!flat) continue
      if (spots.some((s) => s.distanceTo(p) < 22)) continue
      spots.push(p)
    }
    return spots
  }

  freeSpot() {
    const used = new Set(this.sites.map((s) => s.spot))
    const free = this.spots.filter((_, i) => !used.has(i))
    if (free.length === 0) return -1
    return this.spots.indexOf(free[Math.floor(this.rng() * free.length)])
  }

  // ---- Entités ----

  makeChief(house) {
    house.chief = {
      name: this.names.firstName(),
      epithet: this.rng() < 0.4 ? this.names.epithet() : null,
      birthYear: this.year - 18 - Math.floor(this.rng() * 14),
      deathYear: this.year + 20 + Math.floor(this.rng() * 35),
    }
  }

  chiefLabel(house) {
    const c = house.chief
    return c.epithet ? `${c.name} ${c.epithet}` : c.name
  }

  makeHouse() {
    const house = {
      id: houseId++,
      name: this.names.houseName(),
      color: HOUSE_COLORS[(houseId - 2) % HOUSE_COLORS.length],
      prestige: 8 + Math.floor(this.rng() * 8),
      alive: true,
    }
    this.makeChief(house)
    this.houses.push(house)
    for (const other of this.houses) {
      if (other.id !== house.id) {
        this.relations.set(this.relKey(house, other), (this.rng() - 0.5) * 40)
      }
    }
    return house
  }

  relKey(a, b) {
    return a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`
  }

  relation(a, b) {
    return this.relations.get(this.relKey(a, b)) ?? 0
  }

  foundSite(house, pop, reason) {
    const spot = this.freeSpot()
    if (spot < 0) return null
    const site = {
      id: siteId++,
      name: this.names.villageName(),
      spot,
      position: this.spots[spot],
      foundedYear: this.year,
      population: pop,
      status: SITE_STATUS.HAMEAU,
      houseId: house.id,
    }
    this.sites.push(site)
    this.log('fondation', `${reason} ${site.name} est fondé par la maison ${house.name}.`, site, house)
    return site
  }

  houseOf(site) {
    return this.houses.find((h) => h.id === site.houseId)
  }

  sitesOf(house) {
    return this.sites.filter((s) => s.houseId === house.id && s.status !== SITE_STATUS.RUINE)
  }

  activeSites() {
    return this.sites.filter((s) => s.status !== SITE_STATUS.RUINE)
  }

  totalPopulation() {
    return this.activeSites().reduce((sum, s) => sum + Math.round(s.population), 0)
  }

  log(type, text, site = null, house = null) {
    this.chronicle.push({
      year: this.year,
      type,
      text: `An ${this.year} — ${text}`,
      siteId: site ? site.id : null,
      houseId: house ? house.id : null,
    })
  }

  // ---- Genèse ----

  genesis(years = 400) {
    this.year = 1
    const firstHouse = this.makeHouse()
    this.foundSite(firstHouse, 28, 'Venus d’au-delà des mers, des colons débarquent :')
    const secondHouse = this.makeHouse()
    this.foundSite(secondHouse, 22, 'Un second navire accoste sur l’autre rive :')
    this.log('merveille', 'Les anciens disent que l’Esprit du Vallon veillait déjà sur l’île.')

    for (let y = 1; y < years; y++) {
      this.tickYear()
    }
    return this
  }

  // ---- Une année ----

  tickYear() {
    this.year++
    const rng = this.rng

    // Croissance démographique de base, freinée à l'approche de la capacité
    // des terres (saturation logistique).
    for (const site of this.activeSites()) {
      const over = site.population / (this.capFor(site) * 1.25)
      site.population *= 1 + (0.015 + rng() * 0.012) * Math.max(0, 1 - over)
      this.updateStatus(site)
    }

    // Dérive des relations entre maisons
    const alive = this.houses.filter((h) => h.alive)
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const key = this.relKey(alive[i], alive[j])
        const v = (this.relations.get(key) ?? 0) + (rng() - 0.5) * 7
        this.relations.set(key, Math.max(-100, Math.min(100, v)))
      }
    }

    this.checkSuccessions()
    this.checkMigration()
    this.rollEvents()
    this.checkRuins()
  }

  updateStatus(site) {
    const old = site.status
    if (site.population >= 150) site.status = SITE_STATUS.BOURG
    else if (site.population >= 45) site.status = SITE_STATUS.VILLAGE
    else site.status = SITE_STATUS.HAMEAU
    if (old !== site.status && site.status === SITE_STATUS.VILLAGE && old === SITE_STATUS.HAMEAU) {
      this.log('statut', `${site.name} a grandi : le hameau devient un vrai village.`, site)
    } else if (old === SITE_STATUS.VILLAGE && site.status === SITE_STATUS.BOURG) {
      const house = this.houseOf(site)
      if (house) house.prestige += 6
      this.log('statut', `${site.name} prospère et gagne le rang de bourg, fierté de la maison ${house?.name ?? '?'}.`, site)
    }
  }

  checkSuccessions() {
    for (const house of this.houses.filter((h) => h.alive)) {
      if (this.year < house.chief.deathYear) continue
      const oldLabel = this.chiefLabel(house)
      if (this.rng() < 0.14 && house.prestige < 14) {
        // Crise : la lignée s'éteint, une nouvelle maison prend la relève
        const sites = this.sitesOf(house)
        house.alive = false
        if (sites.length > 0) {
          const heirHouse = this.makeHouse()
          for (const s of sites) s.houseId = heirHouse.id
          this.log(
            'succession',
            `${oldLabel} meurt sans héritier : la maison ${house.name} s’éteint. La maison ${heirHouse.name} prend ${sites.map((s) => s.name).join(' et ')}.`,
            sites[0],
            heirHouse
          )
        } else {
          this.log('succession', `La maison ${house.name} s’éteint avec ${oldLabel}.`, null, house)
        }
      } else {
        this.makeChief(house)
        this.log(
          'succession',
          `${oldLabel} s’éteint. ${this.chiefLabel(house)} prend la tête de la maison ${house.name}.`,
          this.sitesOf(house)[0] ?? null,
          house
        )
      }
    }
  }

  capFor(site) {
    if (site.status === SITE_STATUS.BOURG) return 320
    if (site.status === SITE_STATUS.VILLAGE) return 140
    return 55
  }

  checkMigration() {
    // Un site surpeuplé essaime vers un emplacement libre
    for (const site of this.activeSites()) {
      const cap = this.capFor(site)
      if (site.population > cap * 0.82 && this.rng() < 0.16) {
        const settlers = site.population * (0.25 + this.rng() * 0.1)
        const house = this.rng() < 0.45 ? this.makeHouse() : this.houseOf(site)
        const founded = this.foundSite(
          house,
          settlers,
          `Trop à l’étroit à ${site.name}, des familles partent vers de nouvelles terres :`
        )
        if (founded) site.population -= settlers
      }
    }
  }

  rollEvents() {
    const rng = this.rng
    const sites = this.activeSites()
    if (sites.length === 0) {
      if (rng() < 0.1) {
        const house = this.makeHouse()
        this.foundSite(house, 18, 'Des colons reviennent sur l’île désertée :')
      }
      return
    }
    const randomSite = () => sites[Math.floor(rng() * sites.length)]

    // Guerre entre maisons rivales
    const alive = this.houses.filter((h) => h.alive && this.sitesOf(h).length > 0)
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i]
        const b = alive[j]
        if (this.relation(a, b) < -45 && rng() < 0.3) {
          this.war(a, b)
          return // une seule guerre par an
        }
      }
    }

    // Mariage / alliance
    if (alive.length >= 2 && rng() < 0.07) {
      const a = alive[Math.floor(rng() * alive.length)]
      let b = alive[Math.floor(rng() * alive.length)]
      if (a !== b && this.relation(a, b) > -20) {
        this.relations.set(this.relKey(a, b), Math.min(100, this.relation(a, b) + 45))
        this.log(
          'alliance',
          `Mariage entre ${this.names.firstName()} de la maison ${a.name} et ${this.names.firstName()} de la maison ${b.name} : les deux lignées sont désormais liées.`,
          null,
          a
        )
      }
    }

    // Famine
    if (rng() < 0.025) {
      for (const s of sites) s.population *= 0.85 + rng() * 0.07
      this.log('famine', 'Les récoltes pourrissent sous des pluies sans fin : la famine frappe toute l’île.')
    }

    // Épidémie — parfois dévastatrice au point de vider un site
    if (rng() < 0.022) {
      const s = randomSite()
      const severe = rng() < 0.22
      s.population *= severe ? 0.28 : 0.68 + rng() * 0.12
      this.log(
        'epidemie',
        severe
          ? `La Fièvre Cendrée ravage ${s.name} : on brûle les portes marquées, les survivants fuient sur les routes.`
          : `Une fièvre grise se répand à ${s.name} : les cloches sonnent pendant tout l’hiver.`,
        s
      )
    }

    // Merveilles et présages
    if (rng() < 0.05) {
      const s = randomSite()
      const merveilles = [
        `Une comète fend le ciel au-dessus de ${s.name} : les anciens y lisent un présage.`,
        `On raconte qu’un esprit du lac est apparu à un pêcheur de ${s.name}, une couronne d’algues à la main.`,
        `Le forgeron de ${s.name} aurait forgé une lame qui chante au clair de lune.`,
        `La forêt près de ${s.name} a murmuré toute une nuit. Nul n’ose plus y couper du bois.`,
        `Une pierre de lune est découverte dans les collines de ${s.name} : pèlerins et curieux affluent.`,
      ]
      const house = this.houseOf(s)
      if (house) house.prestige += 2
      this.log('merveille', merveilles[Math.floor(rng() * merveilles.length)], s)
    }

    // Catastrophe fantastique
    if (rng() < 0.012) {
      const s = randomSite()
      s.population *= 0.86
      const catas = [
        `Un dragon a survolé ${s.name} : des granges brûlent, le bétail s’enfuit.`,
        `Le drac du lac a renversé des barques à ${s.name}. On ne pêche plus qu’en priant.`,
        `Un hiver de givre s’abat sur ${s.name} en plein été : on parle d’une malédiction.`,
      ]
      this.log('catastrophe', catas[Math.floor(rng() * catas.length)], s)
    }

    // Prospérité
    if (rng() < 0.05) {
      const s = randomSite()
      s.population *= 1.12
      const house = this.houseOf(s)
      if (house) house.prestige += 1
      this.log('prosperite', `Récoltes dorées et foires animées : ${s.name} connaît une année faste.`, s)
    }
  }

  war(a, b) {
    const rng = this.rng
    const sitesA = this.sitesOf(a)
    const sitesB = this.sitesOf(b)
    for (const s of [...sitesA, ...sitesB]) s.population *= 0.9 - rng() * 0.06
    const scoreA = a.prestige + rng() * 20
    const scoreB = b.prestige + rng() * 20
    const [winner, loser] = scoreA >= scoreB ? [a, b] : [b, a]
    const loserSites = this.sitesOf(loser)
    winner.prestige += 5
    loser.prestige = Math.max(0, loser.prestige - 5)
    this.relations.set(this.relKey(a, b), -15)

    if (loserSites.length > 0 && rng() < 0.45) {
      const taken = loserSites[Math.floor(rng() * loserSites.length)]
      taken.houseId = winner.id
      taken.population *= 0.8
      this.log(
        'guerre',
        `Guerre entre les maisons ${a.name} et ${b.name}. Après un siège, ${taken.name} tombe aux mains de la maison ${winner.name}.`,
        taken,
        winner
      )
    } else {
      this.log(
        'guerre',
        `Guerre entre les maisons ${a.name} et ${b.name} : escarmouches et champs brûlés. La maison ${winner.name} impose sa paix.`,
        loserSites[0] ?? null,
        winner
      )
    }
  }

  checkRuins() {
    for (const site of this.activeSites()) {
      if (site.population < 6) {
        site.status = SITE_STATUS.RUINE
        site.population = 0
        this.log('ruine', `Les derniers feux de ${site.name} s’éteignent. Il n’en restera que des pierres.`, site)
      }
    }
    // Une maison sans terre finit par disparaître
    for (const house of this.houses.filter((h) => h.alive)) {
      if (this.sitesOf(house).length === 0 && this.rng() < 0.25) {
        house.alive = false
        this.log('succession', `Sans terres ni bannière, la maison ${house.name} se disperse aux quatre vents.`, null, house)
      }
    }
  }

  // ---- Aides pour l'interface ----

  eventsForSite(id, count = 5) {
    const out = []
    for (let i = this.chronicle.length - 1; i >= 0 && out.length < count; i--) {
      if (this.chronicle[i].siteId === id) out.push(this.chronicle[i])
    }
    return out
  }
}
