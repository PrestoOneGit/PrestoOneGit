// Moteur de combat pur : aucune dépendance à three.js, pour tourner aussi
// bien dans un Web Worker (simulations accélérées) que dans le fil principal
// (rejeu du meilleur match). Déterministe à graine et génome égaux.
//
// Les héros n'ont AUCUN comportement écrit à la main : chacun est piloté
// par son réseau de neurones (voir brain.js). Le moteur se contente des
// règles du jeu : portées, dégâts, vagues, monstres.

import { INPUT_SIZE, forward, randomTeamGenome } from './brain.js'

export const ARENA_RADIUS = 16
export const MATCH_MAX_TIME = 100
export const TICK = 0.1

export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export { randomTeamGenome }

export const HERO_CLASSES = [
  { id: 'guerrier', label: 'Guerrier', hp: 240, dmg: 17, range: 1.9, cooldown: 1.0, speed: 4.4, color: '#b0553a' },
  { id: 'archere', label: 'Archère', hp: 110, dmg: 12, range: 9.5, cooldown: 0.8, speed: 4.8, color: '#7a9e64' },
  { id: 'mage', label: 'Mage', hp: 90, dmg: 24, range: 7.5, cooldown: 2.4, speed: 4.0, aoe: 2.6, color: '#5d93b4' },
  { id: 'soigneuse', label: 'Soigneuse', hp: 105, heal: 16, range: 7, cooldown: 1.1, speed: 4.4, color: '#c9a96e' },
]

const MONSTER_TYPES = {
  gobelin: { hp: 38, dmg: 7, speed: 3.9, range: 1.2, cooldown: 0.9, size: 0.5 },
  brute: { hp: 130, dmg: 15, speed: 2.6, range: 1.6, cooldown: 1.4, size: 0.9 },
  troll: { hp: 420, dmg: 24, speed: 2.2, range: 2.0, cooldown: 1.8, size: 1.35 },
}

const obs = new Float32Array(INPUT_SIZE)
const act = new Float32Array(4)

export class Sim {
  constructor(genome, seed) {
    this.genome = genome
    this.rng = mulberry32(seed)
    this.time = 0
    this.wave = 0
    this.waveDelay = 0.8
    this.waveTimer = 0
    this.events = []
    this.stats = { damage: 0, healing: 0, waves: 0 }
    this.monsters = []
    this.nextMonsterId = 1

    this.heroes = HERO_CLASSES.map((cls, i) => {
      const a = (i / HERO_CLASSES.length) * Math.PI * 2
      return {
        id: i,
        cls,
        x: Math.cos(a) * 3.2,
        z: Math.sin(a) * 3.2,
        hp: cls.hp,
        maxHp: cls.hp,
        cd: 0,
        alive: true,
        damage: 0,
        healing: 0,
        survivedUntil: 0,
      }
    })
  }

  get finished() {
    return this.time >= MATCH_MAX_TIME || this.heroes.every((h) => !h.alive)
  }

  fitness() {
    const alive = this.heroes.filter((h) => h.alive).length
    return (
      this.stats.waves * 600 +
      this.stats.damage * 2 +
      this.stats.healing * 1.2 +
      this.time * 6 +
      alive * 150
    )
  }

  spawnWave() {
    this.wave++
    const n = this.wave
    const angle = this.rng() * Math.PI * 2
    // Les monstres se renforcent à chaque vague : toute équipe finit par
    // céder — c'est ce qui départage les stratégies.
    const scaleHp = 1 + 0.07 * (n - 1)
    const scaleDmg = 1 + 0.09 * (n - 1)
    const add = (type) => {
      const a = angle + (this.rng() - 0.5) * 1.6
      const r = ARENA_RADIUS - 1.2 - this.rng() * 1.5
      const t = MONSTER_TYPES[type]
      const hp = t.hp * scaleHp
      this.monsters.push({
        id: this.nextMonsterId++,
        type,
        ...{ x: Math.cos(a) * r, z: Math.sin(a) * r },
        hp,
        maxHp: hp,
        cd: 0.6 + this.rng() * 0.6,
        stats: { ...t, dmg: t.dmg * scaleDmg },
        // Les « chasseurs » traquent le héros le plus mal en point
        hunter: this.rng() < 0.3,
      })
    }
    const goblins = 2 + n
    for (let i = 0; i < goblins; i++) add('gobelin')
    for (let i = 0; i < Math.floor(n / 2); i++) add('brute')
    if (n % 4 === 0) add('troll')
    this.events.push({ t: 'wave', wave: n })
  }

  // ---- Observations : ce que « voit » le réseau d'un héros ----

  buildObservation(hero) {
    const R = ARENA_RADIUS
    let k = 0
    obs[k++] = hero.hp / hero.maxHp
    obs[k++] = hero.cd <= 0 ? 1 : Math.max(0, 1 - hero.cd / hero.cls.cooldown)
    obs[k++] = hero.x / R
    obs[k++] = hero.z / R

    // Les 3 monstres les plus proches (position relative, PV, gabarit)
    const sorted = this.monsters
      .map((m) => ({ m, d: (m.x - hero.x) ** 2 + (m.z - hero.z) ** 2 }))
      .sort((a, b) => a.d - b.d)
    for (let i = 0; i < 3; i++) {
      const e = sorted[i]
      if (e) {
        obs[k++] = (e.m.x - hero.x) / R
        obs[k++] = (e.m.z - hero.z) / R
        obs[k++] = e.m.hp / e.m.maxHp
        obs[k++] = e.m.stats.size > 1 ? 1 : e.m.stats.size > 0.6 ? 0.5 : 0
      } else {
        obs[k++] = 0
        obs[k++] = 0
        obs[k++] = 0
        obs[k++] = 0
      }
    }

    // L'allié vivant le plus blessé
    let weak = null
    let weakFrac = 1.01
    let cx = 0
    let cz = 0
    let count = 0
    for (const h of this.heroes) {
      if (!h.alive || h === hero) continue
      cx += h.x
      cz += h.z
      count++
      const f = h.hp / h.maxHp
      if (f < weakFrac) {
        weakFrac = f
        weak = h
      }
    }
    if (weak) {
      obs[k++] = (weak.x - hero.x) / R
      obs[k++] = (weak.z - hero.z) / R
      obs[k++] = weakFrac
    } else {
      obs[k++] = 0
      obs[k++] = 0
      obs[k++] = 1
    }

    // Centre de gravité des alliés vivants
    if (count > 0) {
      obs[k++] = (cx / count - hero.x) / R
      obs[k++] = (cz / count - hero.z) / R
    } else {
      obs[k++] = 0
      obs[k++] = 0
    }

    obs[k++] = Math.min(this.wave / 10, 1)
    obs[k++] = Math.min(this.monsters.length / 12, 1)
    return obs
  }

  // ---- Un pas de simulation pour un héros : le réseau décide ----

  stepHero(hero, dt) {
    if (!hero.alive) return
    hero.cd -= dt
    hero.survivedUntil = this.time

    const out = forward(this.genome, hero.id, this.buildObservation(hero), act)
    const mx = out[0]
    const mz = out[1]
    const wantAct = out[2] > 0.5
    const pref = out[3] // 0 = au plus proche, 1 = au plus faible

    // Déplacement : direction et intensité décidées par le réseau
    const mag = Math.min(Math.hypot(mx, mz), 1)
    if (mag > 0.05) {
      const sp = hero.cls.speed * mag * dt
      hero.x += (mx / (mag || 1)) * sp * mag
      hero.z += (mz / (mag || 1)) * sp * mag
    }

    // Règle du jeu : on ne sort pas de l'arène, on ne se superpose pas
    const r = Math.hypot(hero.x, hero.z)
    if (r > ARENA_RADIUS - 0.8) {
      hero.x *= (ARENA_RADIUS - 0.8) / r
      hero.z *= (ARENA_RADIUS - 0.8) / r
    }
    for (const h of this.heroes) {
      if (h === hero || !h.alive) continue
      const dx = hero.x - h.x
      const dz = hero.z - h.z
      const d = Math.hypot(dx, dz)
      if (d < 0.9 && d > 0.001) {
        hero.x += (dx / d) * (0.9 - d) * 0.5
        hero.z += (dz / d) * (0.9 - d) * 0.5
      }
    }

    // Action : choisir une cible À PORTÉE selon la préférence du réseau
    if (!wantAct || hero.cd > 0) return
    const isHealer = hero.cls.id === 'soigneuse'
    let best = null
    let bestScore = Infinity
    if (isHealer) {
      for (const h of this.heroes) {
        if (!h.alive || h === hero) continue
        const d = Math.hypot(h.x - hero.x, h.z - hero.z)
        if (d > hero.cls.range || h.hp >= h.maxHp - 0.5) continue
        const score = (1 - pref) * (d / ARENA_RADIUS) + pref * (h.hp / h.maxHp)
        if (score < bestScore) {
          bestScore = score
          best = h
        }
      }
      if (!best) return
      hero.cd = hero.cls.cooldown
      const amount = Math.min(hero.cls.heal, best.maxHp - best.hp)
      best.hp += amount
      this.stats.healing += amount
      hero.healing += amount
      this.events.push({ t: 'heal', from: [hero.x, hero.z], to: [best.x, best.z] })
      return
    }

    for (const m of this.monsters) {
      const d = Math.hypot(m.x - hero.x, m.z - hero.z)
      if (d > hero.cls.range) continue
      const score = (1 - pref) * (d / ARENA_RADIUS) + pref * (m.hp / m.maxHp)
      if (score < bestScore) {
        bestScore = score
        best = m
      }
    }
    if (!best) return
    hero.cd = hero.cls.cooldown
    if (hero.cls.aoe) {
      for (const m of this.monsters) {
        if (Math.hypot(m.x - best.x, m.z - best.z) <= hero.cls.aoe) {
          m.hp -= hero.cls.dmg
          this.stats.damage += hero.cls.dmg
          hero.damage += hero.cls.dmg
        }
      }
      this.events.push({ t: 'bolt', from: [hero.x, hero.z], to: [best.x, best.z] })
      this.events.push({ t: 'aoe', at: [best.x, best.z], r: hero.cls.aoe })
    } else {
      best.hp -= hero.cls.dmg
      this.stats.damage += hero.cls.dmg
      hero.damage += hero.cls.dmg
      this.events.push({
        t: hero.cls.range > 3 ? 'arrow' : 'slash',
        from: [hero.x, hero.z],
        to: [best.x, best.z],
      })
    }
  }

  stepMonster(m, dt) {
    m.cd -= dt
    // Cible : le plus proche — ou le plus blessé pour un chasseur
    let target = null
    let bd = Infinity
    for (const h of this.heroes) {
      if (!h.alive) continue
      const d = Math.hypot(h.x - m.x, h.z - m.z)
      const score = m.hunter ? d * 0.3 + (h.hp / h.maxHp) * 20 : d
      if (score < bd) {
        bd = score
        target = h
      }
    }
    if (!target) return
    bd = Math.hypot(target.x - m.x, target.z - m.z)
    if (bd > m.stats.range) {
      // Enrage : une vague qui s'éternise accélère — impossible de kiter à l'infini
      const enrage = 1 + Math.max(0, this.waveTimer - 18) * 0.05
      const dx = target.x - m.x
      const dz = target.z - m.z
      m.x += (dx / bd) * m.stats.speed * enrage * dt
      m.z += (dz / bd) * m.stats.speed * enrage * dt
    } else if (m.cd <= 0) {
      m.cd = m.stats.cooldown
      target.hp -= m.stats.dmg
      this.events.push({ t: 'bite', from: [m.x, m.z], to: [target.x, target.z] })
      if (target.hp <= 0) {
        target.alive = false
        target.hp = 0
        this.events.push({ t: 'heroDown', id: target.id, at: [target.x, target.z] })
      }
    }
  }

  step(dt = TICK) {
    this.events = []
    this.time += dt
    this.waveTimer += dt

    if (this.monsters.length === 0) {
      this.waveDelay -= dt
      if (this.waveDelay <= 0) {
        if (this.wave > 0) this.stats.waves++
        this.spawnWave()
        this.waveDelay = 1.5
        this.waveTimer = 0
      }
    }

    for (const h of this.heroes) this.stepHero(h, dt)
    for (const m of this.monsters) this.stepMonster(m, dt)

    for (let i = this.monsters.length - 1; i >= 0; i--) {
      const m = this.monsters[i]
      if (m.hp <= 0) {
        this.events.push({ t: 'monsterDie', at: [m.x, m.z], size: m.stats.size })
        this.monsters.splice(i, 1)
      }
    }
  }

  snapshot() {
    return {
      wave: this.wave,
      time: this.time,
      heroes: this.heroes.map((h) => ({ x: h.x, z: h.z, hp: h.hp / h.maxHp, alive: h.alive })),
      monsters: this.monsters.map((m) => ({ x: m.x, z: m.z, size: m.stats.size })),
    }
  }
}

// Fait tourner un match complet à vitesse maximale (usage worker).
export function runMatch(genome, seed, onSnapshot = null, snapshotEvery = 30) {
  const sim = new Sim(genome, seed)
  let tick = 0
  while (!sim.finished) {
    sim.step(TICK)
    tick++
    if (onSnapshot && tick % snapshotEvery === 0) onSnapshot(sim.snapshot())
  }
  return { fitness: sim.fitness(), waves: sim.stats.waves, time: sim.time }
}
