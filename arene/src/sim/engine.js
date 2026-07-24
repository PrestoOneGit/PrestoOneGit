// Moteur de combat pur : aucune dépendance à three.js, pour tourner aussi
// bien dans un Web Worker (simulations accélérées) que dans le fil principal
// (rejeu du meilleur match). Déterministe à graine et génome égaux.

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

// Les « gènes » de comportement, communs à toutes les classes mais appris
// séparément par chaque héros. C'est ce que l'évolution fait varier.
export const GENES = [
  { key: 'portee', label: 'Distance préférée', min: 1.2, max: 11 },
  { key: 'prudence', label: 'Prudence (repli)', min: 0, max: 0.6 },
  { key: 'focus', label: 'Focus cibles faibles', min: 0, max: 1 },
  { key: 'esquive', label: 'Esquive / kiting', min: 0, max: 1 },
  { key: 'entraide', label: 'Entraide', min: 0, max: 1 },
  { key: 'agressivite', label: 'Agressivité', min: 0.2, max: 1 },
]
export const GENES_PER_HERO = GENES.length

export const HERO_CLASSES = [
  { id: 'guerrier', label: 'Guerrier', hp: 240, dmg: 17, range: 1.9, cooldown: 1.0, speed: 4.4, color: '#b0553a' },
  { id: 'archere', label: 'Archère', hp: 110, dmg: 12, range: 9.5, cooldown: 0.8, speed: 4.8, color: '#7a9e64' },
  { id: 'mage', label: 'Mage', hp: 90, dmg: 24, range: 7.5, cooldown: 2.4, speed: 4.0, aoe: 2.5, color: '#5d93b4' },
  { id: 'soigneuse', label: 'Soigneuse', hp: 105, heal: 16, range: 7, cooldown: 1.1, speed: 4.4, color: '#c9a96e' },
]
export const GENOME_SIZE = HERO_CLASSES.length * GENES_PER_HERO

export function randomGenome(rng) {
  const g = new Float32Array(GENOME_SIZE)
  for (let h = 0; h < HERO_CLASSES.length; h++) {
    for (let i = 0; i < GENES_PER_HERO; i++) {
      const spec = GENES[i]
      g[h * GENES_PER_HERO + i] = spec.min + rng() * (spec.max - spec.min)
    }
  }
  return g
}

export function geneValue(genome, heroIndex, geneKey) {
  const i = GENES.findIndex((g) => g.key === geneKey)
  return genome[heroIndex * GENES_PER_HERO + i]
}

const MONSTER_TYPES = {
  gobelin: { hp: 38, dmg: 7, speed: 3.9, range: 1.2, cooldown: 0.9, size: 0.5 },
  brute: { hp: 130, dmg: 15, speed: 2.6, range: 1.6, cooldown: 1.4, size: 0.9 },
  troll: { hp: 420, dmg: 24, speed: 2.2, range: 2.0, cooldown: 1.8, size: 1.35 },
}

export class Sim {
  constructor(genome, seed) {
    this.genome = genome
    this.rng = mulberry32(seed)
    this.time = 0
    this.wave = 0
    this.waveDelay = 0.8
    this.events = []
    this.stats = { damage: 0, healing: 0, waves: 0 }
    this.monsters = []
    this.nextMonsterId = 1
    this.waveTimer = 0

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
        genes: Object.fromEntries(
          GENES.map((g, gi) => [g.key, genome[i * GENES_PER_HERO + gi]])
        ),
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

  nearestMonster(x, z) {
    let best = null
    let bd = Infinity
    for (const m of this.monsters) {
      const d = (m.x - x) ** 2 + (m.z - z) ** 2
      if (d < bd) {
        bd = d
        best = m
      }
    }
    return best
  }

  pickTarget(hero) {
    // Compromis distance / points de vie restants, dosé par le gène « focus ».
    let best = null
    let bestScore = Infinity
    for (const m of this.monsters) {
      const d = Math.hypot(m.x - hero.x, m.z - hero.z)
      const score = d * (1 - hero.genes.focus * 0.65) + (m.hp / m.maxHp) * 14 * hero.genes.focus
      if (score < bestScore) {
        bestScore = score
        best = m
      }
    }
    return best
  }

  weakestAlly(hero) {
    let best = null
    let bestFrac = 1.01
    for (const h of this.heroes) {
      if (!h.alive || h === hero) continue
      const f = h.hp / h.maxHp
      if (f < bestFrac) {
        bestFrac = f
        best = h
      }
    }
    return best
  }

  stepHero(hero, dt) {
    if (!hero.alive) return
    hero.cd -= dt
    const g = hero.genes
    const isHealer = hero.cls.id === 'soigneuse'
    const hpFrac = hero.hp / hero.maxHp

    const target = isHealer ? this.weakestAlly(hero) : this.pickTarget(hero)
    const nearest = this.nearestMonster(hero.x, hero.z)

    // --- Déplacement : somme de forces pondérées par les gènes ---
    let vx = 0
    let vz = 0
    // La distance préférée n'est PAS bridée par la portée de la classe :
    // un guerrier qui « préfère » rester loin ne frappera jamais. C'est à
    // l'évolution de découvrir la bonne distance pour chaque rôle.
    const desired = g.portee

    if (target) {
      const dx = target.x - hero.x
      const dz = target.z - hero.z
      const d = Math.hypot(dx, dz) || 0.001
      if (d > desired) {
        vx += (dx / d) * 1.0
        vz += (dz / d) * 1.0
      } else if (d < desired * 0.75) {
        vx -= (dx / d) * (0.4 + g.esquive)
        vz -= (dz / d) * (0.4 + g.esquive)
      }
    }

    // Kiting : s'écarter du monstre le plus proche s'il colle
    if (nearest && !isHealer) {
      const dx = nearest.x - hero.x
      const dz = nearest.z - hero.z
      const d = Math.hypot(dx, dz) || 0.001
      if (d < desired * 0.9) {
        vx -= (dx / d) * g.esquive * 1.1
        vz -= (dz / d) * g.esquive * 1.1
      }
    }

    // Repli quand les PV passent sous le seuil de prudence
    if (nearest && hpFrac < g.prudence) {
      const dx = nearest.x - hero.x
      const dz = nearest.z - hero.z
      const d = Math.hypot(dx, dz) || 0.001
      vx -= (dx / d) * 1.6
      vz -= (dz / d) * 1.6
    }

    // Entraide : rester proche de l'allié le plus mal en point
    const ally = this.weakestAlly(hero)
    if (ally && !isHealer) {
      const dx = ally.x - hero.x
      const dz = ally.z - hero.z
      const d = Math.hypot(dx, dz)
      if (d > 4) {
        vx += (dx / d) * g.entraide * 0.6
        vz += (dz / d) * g.entraide * 0.6
      }
    }

    // Séparation entre héros
    for (const h of this.heroes) {
      if (h === hero || !h.alive) continue
      const dx = hero.x - h.x
      const dz = hero.z - h.z
      const d = Math.hypot(dx, dz)
      if (d < 1.1 && d > 0.001) {
        vx += (dx / d) * 0.6
        vz += (dz / d) * 0.6
      }
    }

    const len = Math.hypot(vx, vz)
    if (len > 0.01) {
      const sp = hero.cls.speed * dt
      hero.x += (vx / len) * sp
      hero.z += (vz / len) * sp
    }

    // Rester dans l'arène
    const r = Math.hypot(hero.x, hero.z)
    if (r > ARENA_RADIUS - 0.8) {
      hero.x *= (ARENA_RADIUS - 0.8) / r
      hero.z *= (ARENA_RADIUS - 0.8) / r
    }

    // --- Action ---
    if (!target || hero.cd > 0) return
    const dist = Math.hypot(target.x - hero.x, target.z - hero.z)
    if (dist > hero.cls.range) return
    // Un héros en repli n'attaque que s'il est assez agressif
    if (hpFrac < g.prudence && this.rng() > g.agressivite) return

    hero.cd = hero.cls.cooldown
    if (isHealer) {
      const amount = Math.min(hero.cls.heal, target.maxHp - target.hp)
      if (amount <= 0.5) return
      target.hp += amount
      this.stats.healing += amount
      this.events.push({ t: 'heal', from: [hero.x, hero.z], to: [target.x, target.z], targetId: target.id })
    } else if (hero.cls.aoe) {
      for (const m of this.monsters) {
        if (Math.hypot(m.x - target.x, m.z - target.z) <= hero.cls.aoe) {
          m.hp -= hero.cls.dmg
          this.stats.damage += hero.cls.dmg
        }
      }
      this.events.push({ t: 'bolt', from: [hero.x, hero.z], to: [target.x, target.z] })
    } else {
      target.hp -= hero.cls.dmg
      this.stats.damage += hero.cls.dmg
      this.events.push({
        t: hero.cls.range > 3 ? 'arrow' : 'slash',
        from: [hero.x, hero.z],
        to: [target.x, target.z],
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
