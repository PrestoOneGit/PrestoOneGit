// Moteur de run : une équipe de 5 agents grimpe la tour étage par étage
// jusqu'à la mort (ou le cap). Pur JS, déterministe à graine et génome
// égaux, sans dépendance — le même code tourne dans les Web Workers
// (évaluation accélérée) et dans le fil principal (visionneuse).
//
// Les agents n'ont AUCUN comportement écrit à la main : leurs réseaux
// (brain.js) décident de tout, jusqu'au choix de leurs améliorations.
// Le moteur n'applique que les règles (data.js).

import {
  AFFLICTION_DURATIONS, BLESS_DURATION, BLESS_FACTOR, BOSSES, BURN_DPS,
  CLASSES, ELITE_CHANCE, ELITE_FROM_FLOOR, ELITE_MULT, FLOOR_BUDGET,
  FLOOR_TIME_LIMIT, HERO_GROWTH, MAX_FLOOR, MOBILITY, MONSTERS,
  MONSTER_GROWTH, POISON_DPS_PER_STACK, POISON_MAX_STACKS,
  REGEN_BETWEEN_FLOORS, RESTS_PER_RUN, SLOW_FACTOR, STANCE_DURATION,
  STANCE_FACTOR, UPGRADES, UPGRADE_EFFECTS, UPGRADE_EVERY, VULN_FACTOR,
  tierForFloor,
} from './data.js'
import {
  INPUT_SIZE, OUTPUT_SIZE, OUT_ABILITY, OUT_BASIC, OUT_GATE, OUT_MOBILITY,
  OUT_REST, OUT_TARGET_PREF, OUT_UPGRADE, SLOTS, forward, slotClass,
} from './brain.js'

export const ARENA_RADIUS = 14
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

// Buffers partagés : sûr tant que les simulations s'exécutent
// séquentiellement dans un même thread (workers, visionneuse).
const obs = new Float32Array(INPUT_SIZE)
const act = new Float32Array(OUTPUT_SIZE)

function freshAfflictions() {
  return { burn: 0, poison: 0, poisonStacks: 0, slow: 0, stun: 0, vuln: 0 }
}

// Multiplicateurs dérivés des améliorations accumulées.
function upgradeMultipliers(counts) {
  const m = { hp: 1, dmg: 1, speed: 1, haste: 1, mana: 1, ability: 1, armor: 1, afflictionDuration: 1 }
  UPGRADES.forEach((up, i) => {
    const n = counts[i]
    if (n === 0) return
    const fx = UPGRADE_EFFECTS[up.id]
    for (const [key, value] of Object.entries(fx)) m[key] *= Math.pow(value, n)
  })
  return m
}

export class TowerRun {
  // `logging` active la collecte détaillée pour les rapports. Désactivé
  // par défaut : les workers d'évaluation ne paient pas ce coût.
  constructor(genome, seed, { logging = false } = {}) {
    this.genome = genome
    this.seed = seed
    this.rng = mulberry32(seed)
    this.logging = logging
    this.time = 0
    this.floor = 0
    this.floorTime = 0
    this.floorsCleared = 0
    this.restsLeft = RESTS_PER_RUN
    this.betweenFloors = 0
    this.events = []
    this.monsters = []
    this.nextMonsterId = 1
    this.over = false
    this.endReason = null
    this.timeline = []
    this.floorLog = []
    this.currentFloorLog = null

    this.heroes = Array.from({ length: SLOTS }, (_, s) => {
      const cls = slotClass(genome, s)
      const a = (s / SLOTS) * Math.PI * 2
      const hero = {
        slot: s,
        cls,
        classIndex: CLASSES.indexOf(cls),
        x: Math.cos(a) * 3,
        z: Math.sin(a) * 3,
        level: 0,
        upgrades: new Array(UPGRADES.length).fill(0),
        upMult: upgradeMultipliers(new Array(UPGRADES.length).fill(0)),
        maxHp: cls.hp,
        maxMana: cls.mana,
        hp: cls.hp,
        mana: cls.mana,
        dmgMult: 1,
        cdBasic: 0,
        cds: [0, 0, 0],
        mobilityCds: { dash: 0, sprint: 0, jump: 0 },
        sprintLeft: 0,
        airborne: 0,
        jumpFrom: null,
        jumpTo: null,
        alive: true,
        aff: freshAfflictions(),
        bless: 0,
        stance: 0,
        damage: 0,
        healing: 0,
        damageTaken: 0,
        lastRestWish: 0,
        // Statistiques de run (toujours comptées : c'est bon marché)
        stats: { abilities: [0, 0, 0], basic: 0, dash: 0, sprint: 0, jump: 0, deathFloor: null },
      }
      return hero
    })

    this.startFloor(1)
  }

  get finished() {
    return this.over
  }

  fitness() {
    const alive = this.heroes.filter((h) => h.alive).length
    return this.floorsCleared * 1000 + this.floorProgress() * 600 + alive * 50
  }

  floorProgress() {
    if (this.monsters.length === 0) return 0
    let hp = 0
    let max = 0
    for (const m of this.monsters) {
      hp += Math.max(m.hp, 0)
      max += m.maxHp
    }
    return max > 0 ? 1 - hp / max : 0
  }

  mark(type, data = {}) {
    if (!this.logging) return
    this.timeline.push({ t: Number(this.time.toFixed(1)), floor: this.floor, type, ...data })
  }

  // ---- Étages ----

  spawnMonster(type, scale, { elite = false, boss = null } = {}) {
    const t = MONSTERS[type]
    const a = this.rng() * Math.PI * 2
    const r = ARENA_RADIUS - 1.5 - this.rng() * 2
    let hp = t.hp * scale.hp
    let dmg = t.dmg * scale.dmg
    let size = t.size
    if (elite) {
      hp *= ELITE_MULT.hp
      dmg *= ELITE_MULT.dmg
      size *= 1.25
    }
    let slam = null
    if (boss) {
      hp *= boss.hpMult
      dmg *= boss.dmgMult
      size = boss.size
      slam = { cd: boss.slamCd, timer: boss.slamCd, radius: boss.slamRadius, mult: boss.slamMult }
    }
    this.monsters.push({
      id: this.nextMonsterId++,
      type,
      label: boss ? boss.label : t.label,
      x: Math.cos(a) * r,
      z: Math.sin(a) * r,
      hp,
      maxHp: hp,
      dmg,
      size,
      stats: t,
      elite,
      boss: !!boss,
      bossApplies: boss?.applies ?? null,
      slam,
      cd: 0.8 + this.rng() * 0.8,
      aff: freshAfflictions(),
      taunt: null,
    })
    if (this.currentFloorLog) {
      const key = boss ? `${type} (boss)` : elite ? `${type} (élite)` : type
      this.currentFloorLog.monsters[key] = (this.currentFloorLog.monsters[key] ?? 0) + 1
    }
  }

  startFloor(floor) {
    this.floor = floor
    this.floorTime = 0
    this.monsters = []
    const tier = tierForFloor(floor)
    const isBoss = floor % 10 === 0
    if (this.logging) {
      this.currentFloorLog = {
        floor,
        boss: isBoss,
        monsters: {},
        duration: 0,
        damageDealt: 0,
        damageTaken: 0,
        deaths: [],
        restTaken: false,
        upgrades: [],
      }
    }
    const scale = {
      hp: Math.pow(MONSTER_GROWTH, floor - 1),
      dmg: Math.pow(MONSTER_GROWTH, floor - 1),
    }
    let budget = FLOOR_BUDGET(floor)
    if (isBoss) {
      const boss = BOSSES[tier.boss]
      this.spawnMonster(boss.base, scale, { boss })
      budget = Math.floor(budget * 0.35)
    }
    let guard = 0
    while (budget > 0 && guard++ < 60) {
      const type = tier.pool[Math.floor(this.rng() * tier.pool.length)]
      const cost = MONSTERS[type].cost
      if (cost > budget && guard < 40) continue
      const elite = floor >= ELITE_FROM_FLOOR && this.rng() < ELITE_CHANCE
      this.spawnMonster(type, scale, { elite })
      budget -= cost
    }
    this.events.push({ t: 'floor', floor, boss: isBoss })
    this.mark('floorStart', { boss: isBoss })
  }

  // Recalcule les stats dérivées : niveau × améliorations. Recalcul
  // complet (pas incrémental) pour rester exactement déterministe.
  recomputeStats(hero, { healToFull = false } = {}) {
    const hpRatio = hero.maxHp > 0 ? hero.hp / hero.maxHp : 1
    const manaRatio = hero.maxMana > 0 ? hero.mana / hero.maxMana : 1
    const lvl = Math.pow(HERO_GROWTH, hero.level)
    const u = hero.upMult
    hero.maxHp = hero.cls.hp * lvl * u.hp
    hero.maxMana = hero.cls.mana * lvl * u.mana
    hero.dmgMult = lvl * u.dmg
    hero.hp = healToFull ? hero.maxHp : hero.maxHp * hpRatio
    hero.mana = healToFull ? hero.maxMana : hero.maxMana * manaRatio
  }

  chooseUpgrade(hero) {
    // Le réseau désigne l'amélioration qu'il veut : argmax des 6 sorties
    // dédiées. Aucune règle ne dit « le tank prend Vigueur ».
    const out = forward(this.genome, hero.slot, this.buildObservation(hero), act)
    let best = 0
    let bestScore = -Infinity
    for (let i = 0; i < UPGRADES.length; i++) {
      if (out[OUT_UPGRADE + i] > bestScore) {
        bestScore = out[OUT_UPGRADE + i]
        best = i
      }
    }
    hero.upgrades[best]++
    hero.upMult = upgradeMultipliers(hero.upgrades)
    this.recomputeStats(hero)
    if (this.currentFloorLog) {
      this.currentFloorLog.upgrades.push({ agent: hero.cls.label, slot: hero.slot, upgrade: UPGRADES[best].id })
    }
    this.mark('upgrade', { agent: hero.cls.label, slot: hero.slot, upgrade: UPGRADES[best].id })
    this.events.push({ t: 'upgrade', slot: hero.slot, upgrade: UPGRADES[best].id })
  }

  clearFloor() {
    this.floorsCleared++
    const survivors = this.heroes.filter((h) => h.alive)

    // Vote de repos : la moyenne des sorties « envie de repos » des
    // survivants décide (aucune règle codée sur QUAND se reposer).
    const wish = survivors.reduce((s, h) => s + h.lastRestWish, 0) / Math.max(survivors.length, 1)
    const rest = wish > 0.55 && this.restsLeft > 0
    const levelUpChoice = this.floor % UPGRADE_EVERY === 0

    for (const hero of survivors) {
      hero.level++
      this.recomputeStats(hero)
      if (rest) {
        hero.hp = hero.maxHp
        hero.mana = hero.maxMana
      } else {
        hero.hp = Math.min(hero.maxHp, hero.hp + (hero.maxHp - hero.hp) * REGEN_BETWEEN_FLOORS.hp)
        hero.mana = Math.min(hero.maxMana, hero.mana + (hero.maxMana - hero.mana) * REGEN_BETWEEN_FLOORS.mana)
      }
      hero.aff = freshAfflictions()
      hero.bless = 0
      hero.stance = 0
      hero.cds = [0, 0, 0]
      hero.cdBasic = 0
      hero.mobilityCds = { dash: 0, sprint: 0, jump: 0 }
      hero.sprintLeft = 0
      hero.airborne = 0
      if (levelUpChoice) this.chooseUpgrade(hero)
    }

    if (rest) {
      this.restsLeft--
      this.events.push({ t: 'rest', restsLeft: this.restsLeft })
      this.mark('rest', { restsLeft: this.restsLeft })
    }
    if (this.currentFloorLog) {
      this.currentFloorLog.duration = Number(this.floorTime.toFixed(1))
      this.currentFloorLog.restTaken = rest
      this.currentFloorLog.survivors = survivors.length
      this.floorLog.push(this.currentFloorLog)
      this.currentFloorLog = null
    }
    this.events.push({ t: 'floorClear', floor: this.floor })
    this.betweenFloors = 1.2
  }

  end(reason) {
    this.over = true
    this.endReason = reason
    if (this.currentFloorLog) {
      this.currentFloorLog.duration = Number(this.floorTime.toFixed(1))
      this.currentFloorLog.failed = true
      this.floorLog.push(this.currentFloorLog)
      this.currentFloorLog = null
    }
    this.mark('runEnd', { reason })
  }

  // ---- Dégâts, soins, afflictions ----

  heroOutgoing(hero, base, isAbility = false) {
    let dmg = base * hero.dmgMult
    if (isAbility) dmg *= hero.upMult.ability
    if (hero.bless > 0) dmg *= BLESS_FACTOR
    // Passif berserker : +40 % de dégâts sous 35 % de PV
    if (hero.cls.id === 'berserker' && hero.hp / hero.maxHp < 0.35) dmg *= 1.4
    return dmg
  }

  damageMonster(hero, monster, amount) {
    let dmg = amount
    if (monster.aff.vuln > 0) dmg *= VULN_FACTOR
    if (monster.stats.armor) dmg *= 1 - monster.stats.armor
    monster.hp -= dmg
    hero.damage += dmg
    if (this.currentFloorLog) this.currentFloorLog.damageDealt += dmg
  }

  damageHero(monster, hero, amount) {
    // Un agent en l'air esquive les attaques de mêlée.
    if (hero.airborne > 0 && monster && monster.stats.range < 3) {
      this.events.push({ t: 'dodge', at: [hero.x, hero.z] })
      return
    }
    let dmg = amount
    if (hero.aff.vuln > 0) dmg *= VULN_FACTOR
    if (hero.stance > 0 && !monster?.stats?.pierceArmor) dmg *= STANCE_FACTOR
    dmg *= hero.upMult.armor
    hero.hp -= dmg
    hero.damageTaken += dmg
    if (this.currentFloorLog) this.currentFloorLog.damageTaken += dmg
    if (hero.hp <= 0) {
      hero.hp = 0
      hero.alive = false
      hero.stats.deathFloor = this.floor
      this.events.push({ t: 'heroDown', slot: hero.slot, at: [hero.x, hero.z] })
      if (this.currentFloorLog) {
        this.currentFloorLog.deaths.push({ agent: hero.cls.label, slot: hero.slot })
      }
      this.mark('agentDown', { agent: hero.cls.label, slot: hero.slot })
    }
  }

  applyAfflictions(target, applies) {
    if (!applies) return
    const scale = target.upMult ? target.upMult.afflictionDuration : 1
    for (const [name, stacks] of Object.entries(applies)) {
      if (name === 'poison') {
        target.aff.poisonStacks = Math.min(POISON_MAX_STACKS, target.aff.poisonStacks + stacks)
        target.aff.poison = AFFLICTION_DURATIONS.poison * scale
      } else {
        target.aff[name] = AFFLICTION_DURATIONS[name] * scale
      }
    }
  }

  tickAfflictions(entity, dt, isHero) {
    const a = entity.aff
    let dot = 0
    if (a.burn > 0) dot += BURN_DPS * dt
    if (a.poison > 0) dot += POISON_DPS_PER_STACK * a.poisonStacks * dt
    if (dot > 0) {
      entity.hp -= dot
      if (isHero) {
        entity.damageTaken += dot
        if (entity.hp <= 0 && entity.alive) {
          entity.hp = 0
          entity.alive = false
          entity.stats.deathFloor = this.floor
          this.events.push({ t: 'heroDown', slot: entity.slot, at: [entity.x, entity.z] })
          if (this.currentFloorLog) {
            this.currentFloorLog.deaths.push({ agent: entity.cls.label, slot: entity.slot, cause: 'affliction' })
          }
          this.mark('agentDown', { agent: entity.cls.label, slot: entity.slot, cause: 'affliction' })
        }
      }
    }
    a.burn = Math.max(0, a.burn - dt)
    a.slow = Math.max(0, a.slow - dt)
    a.stun = Math.max(0, a.stun - dt)
    a.vuln = Math.max(0, a.vuln - dt)
    a.poison = Math.max(0, a.poison - dt)
    if (a.poison === 0) a.poisonStacks = 0
  }

  // ---- Observations ----

  buildObservation(hero) {
    const R = ARENA_RADIUS
    let k = 0
    obs[k++] = hero.hp / hero.maxHp
    obs[k++] = hero.mana / hero.maxMana
    obs[k++] = hero.cdBasic <= 0 ? 1 : 0
    for (let i = 0; i < 3; i++) {
      const ab = hero.cls.abilities[i]
      const ready = hero.cds[i] <= 0 && hero.mana >= ab.cost
      obs[k++] = ready ? 1 : Math.max(0, 1 - hero.cds[i] / (ab.cd || 1)) * 0.5
    }
    obs[k++] = hero.aff.stun > 0 ? 1 : 0
    obs[k++] = Math.min(hero.aff.slow / AFFLICTION_DURATIONS.slow, 1)
    obs[k++] = Math.min((hero.aff.burn + hero.aff.poisonStacks) / 8, 1)
    obs[k++] = hero.x / R
    obs[k++] = hero.z / R
    // Mobilité
    obs[k++] = hero.mobilityCds.dash <= 0 ? 1 : 0
    obs[k++] = hero.mobilityCds.sprint <= 0 ? 1 : 0
    obs[k++] = hero.mobilityCds.jump <= 0 ? 1 : 0
    obs[k++] = hero.airborne > 0 ? 1 : 0
    obs[k++] = hero.sprintLeft > 0 ? 1 : 0
    // Améliorations accumulées
    for (let i = 0; i < UPGRADES.length; i++) obs[k++] = Math.min(hero.upgrades[i] / 4, 1)

    const sorted = this.monsters
      .map((m) => ({ m, d: (m.x - hero.x) ** 2 + (m.z - hero.z) ** 2 }))
      .sort((a, b) => a.d - b.d)
    for (let i = 0; i < 4; i++) {
      const e = sorted[i]
      if (e) {
        obs[k++] = (e.m.x - hero.x) / R
        obs[k++] = (e.m.z - hero.z) / R
        obs[k++] = e.m.hp / e.m.maxHp
        obs[k++] = Math.min((e.m.dmg / hero.maxHp) * 8, 1)
        obs[k++] = e.m.boss ? 1 : e.m.elite ? 0.5 : 0
      } else {
        obs[k++] = 0
        obs[k++] = 0
        obs[k++] = 0
        obs[k++] = 0
        obs[k++] = 0
      }
    }

    for (let s = 0; s < SLOTS; s++) {
      if (s === hero.slot) continue
      const h = this.heroes[s]
      if (h.alive) {
        obs[k++] = (h.x - hero.x) / R
        obs[k++] = (h.z - hero.z) / R
        obs[k++] = h.hp / h.maxHp
        obs[k++] = h.mana / h.maxMana
        obs[k++] = h.classIndex / (CLASSES.length - 1)
      } else {
        obs[k++] = 0
        obs[k++] = 0
        obs[k++] = 0
        obs[k++] = 0
        obs[k++] = 0
      }
    }

    obs[k++] = this.floor / MAX_FLOOR
    obs[k++] = Math.min(this.monsters.length / 10, 1)
    obs[k++] = this.restsLeft / RESTS_PER_RUN
    obs[k++] = this.floor % 10 === 0 ? 1 : 0
    return obs
  }

  // ---- Ciblage : pref 0 = au plus proche, 1 = au plus faible ----

  pickMonster(hero, range, pref) {
    let best = null
    let bestScore = Infinity
    for (const m of this.monsters) {
      const d = Math.hypot(m.x - hero.x, m.z - hero.z)
      if (d > range) continue
      const score = (1 - pref) * (d / ARENA_RADIUS) + pref * (m.hp / m.maxHp)
      if (score < bestScore) {
        bestScore = score
        best = m
      }
    }
    return best
  }

  pickAlly(hero, range, pref, includeSelf = true) {
    let best = null
    let bestScore = Infinity
    for (const h of this.heroes) {
      if (!h.alive) continue
      if (!includeSelf && h === hero) continue
      const d = Math.hypot(h.x - hero.x, h.z - hero.z)
      if (d > range) continue
      const score = (1 - pref) * (d / ARENA_RADIUS) + pref * (h.hp / h.maxHp)
      if (score < bestScore) {
        bestScore = score
        best = h
      }
    }
    return best
  }

  clampToArena(hero) {
    const r = Math.hypot(hero.x, hero.z)
    if (r > ARENA_RADIUS - 0.8) {
      hero.x *= (ARENA_RADIUS - 0.8) / r
      hero.z *= (ARENA_RADIUS - 0.8) / r
    }
  }

  // ---- Un pas pour un agent ----

  stepHero(hero, dt) {
    if (!hero.alive) return
    this.tickAfflictions(hero, dt, true)
    if (!hero.alive) return

    const haste = hero.upMult.haste
    hero.cdBasic -= dt
    for (let i = 0; i < 3; i++) hero.cds[i] -= dt
    for (const key of Object.keys(hero.mobilityCds)) hero.mobilityCds[key] -= dt
    hero.sprintLeft = Math.max(0, hero.sprintLeft - dt)
    hero.bless = Math.max(0, hero.bless - dt)
    hero.stance = Math.max(0, hero.stance - dt)
    hero.mana = Math.min(hero.maxMana, hero.mana + hero.cls.manaRegen * hero.upMult.mana * dt)

    // En plein bond : trajectoire imposée, aucune action possible.
    if (hero.airborne > 0) {
      hero.airborne -= dt
      const total = MOBILITY.jump.airTime
      const p = Math.min(1, 1 - hero.airborne / total)
      hero.x = hero.jumpFrom[0] + (hero.jumpTo[0] - hero.jumpFrom[0]) * p
      hero.z = hero.jumpFrom[1] + (hero.jumpTo[1] - hero.jumpFrom[1]) * p
      hero.jumpHeight = Math.sin(p * Math.PI) * 1.6
      if (hero.airborne <= 0) hero.jumpHeight = 0
      return
    }
    if (hero.aff.stun > 0) return

    const out = forward(this.genome, hero.slot, this.buildObservation(hero), act)
    const mx = out[0]
    const mz = out[1]
    const gate = out[OUT_GATE]
    const pref = out[OUT_TARGET_PREF]
    hero.lastRestWish = out[OUT_REST]

    const mag = Math.min(Math.hypot(mx, mz), 1)
    const dirX = mag > 0.001 ? mx / mag : 0
    const dirZ = mag > 0.001 ? mz / mag : 0

    // --- Mobilité : le réseau décide, le moteur applique les règles ---
    if (mag > 0.05) {
      if (out[OUT_MOBILITY + 2] > 0.5 && hero.mobilityCds.jump <= 0) {
        // Bond : trajectoire aérienne, esquive la mêlée
        const j = MOBILITY.jump
        hero.mobilityCds.jump = j.cd
        hero.airborne = j.airTime
        hero.jumpFrom = [hero.x, hero.z]
        let tx = hero.x + dirX * j.distance
        let tz = hero.z + dirZ * j.distance
        const r = Math.hypot(tx, tz)
        if (r > ARENA_RADIUS - 0.8) {
          tx *= (ARENA_RADIUS - 0.8) / r
          tz *= (ARENA_RADIUS - 0.8) / r
        }
        hero.jumpTo = [tx, tz]
        hero.stats.jump++
        this.events.push({ t: 'jump', from: [hero.x, hero.z], to: [tx, tz], slot: hero.slot })
        return
      }
      if (out[OUT_MOBILITY] > 0.5 && hero.mobilityCds.dash <= 0) {
        const d = MOBILITY.dash
        hero.mobilityCds.dash = d.cd
        const fromX = hero.x
        const fromZ = hero.z
        hero.x += dirX * d.distance
        hero.z += dirZ * d.distance
        this.clampToArena(hero)
        hero.stats.dash++
        this.events.push({ t: 'dash', from: [fromX, fromZ], to: [hero.x, hero.z], slot: hero.slot })
      }
      if (out[OUT_MOBILITY + 1] > 0.5 && hero.mobilityCds.sprint <= 0) {
        hero.mobilityCds.sprint = MOBILITY.sprint.cd
        hero.sprintLeft = MOBILITY.sprint.duration
        hero.stats.sprint++
        this.events.push({ t: 'sprint', slot: hero.slot })
      }
    }

    // --- Déplacement ---
    if (mag > 0.05) {
      const slowMult = hero.aff.slow > 0 ? SLOW_FACTOR : 1
      const sprintMult = hero.sprintLeft > 0 ? MOBILITY.sprint.speedMult : 1
      const sp = hero.cls.speed * hero.upMult.speed * slowMult * sprintMult * mag * dt
      hero.x += dirX * sp
      hero.z += dirZ * sp
    }
    this.clampToArena(hero)
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

    // --- Action : argmax parmi ce qui est DISPONIBLE ---
    if (gate <= 0.5) return
    let bestAction = -1
    let bestScore = -Infinity
    if (hero.cdBasic <= 0 && out[OUT_BASIC] > bestScore) {
      bestScore = out[OUT_BASIC]
      bestAction = 0
    }
    for (let i = 0; i < 3; i++) {
      const ab = hero.cls.abilities[i]
      if (hero.cds[i] <= 0 && hero.mana >= ab.cost && out[OUT_ABILITY + i] > bestScore) {
        bestScore = out[OUT_ABILITY + i]
        bestAction = i + 1
      }
    }
    if (bestAction < 0) return

    if (bestAction === 0) {
      const target = this.pickMonster(hero, hero.cls.range, pref)
      if (!target) return
      hero.cdBasic = hero.cls.cooldown * haste
      hero.stats.basic++
      this.damageMonster(hero, target, this.heroOutgoing(hero, hero.cls.dmg))
      this.events.push({
        t: hero.cls.range > 3 ? 'arrow' : 'slash',
        from: [hero.x, hero.z],
        to: [target.x, target.z],
      })
      return
    }

    const abIndex = bestAction - 1
    const ab = hero.cls.abilities[abIndex]
    const power = this.heroOutgoing(hero, ab.power, true)

    switch (ab.kind) {
      case 'dmg': {
        const target = this.pickMonster(hero, ab.range, pref)
        if (!target) return
        this.commit(hero, abIndex, ab, haste)
        this.damageMonster(hero, target, power)
        this.applyAfflictions(target, ab.applies)
        this.events.push({ t: 'cast', from: [hero.x, hero.z], to: [target.x, target.z], color: hero.cls.color, ability: ab.id })
        break
      }
      case 'aoe': {
        let cx = hero.x
        let cz = hero.z
        if (ab.center !== 'self') {
          const target = this.pickMonster(hero, ab.range, pref)
          if (!target) return
          cx = target.x
          cz = target.z
        } else if (!this.pickMonster(hero, ab.radius, pref)) {
          return
        }
        this.commit(hero, abIndex, ab, haste)
        for (const m of this.monsters) {
          if (Math.hypot(m.x - cx, m.z - cz) <= ab.radius) {
            this.damageMonster(hero, m, power)
            this.applyAfflictions(m, ab.applies)
          }
        }
        this.events.push({ t: 'aoe', at: [cx, cz], r: ab.radius, color: hero.cls.color, seal: true, ability: ab.id })
        break
      }
      case 'heal': {
        const target = this.pickAlly(hero, ab.range, Math.max(pref, 0.5))
        if (!target || target.hp >= target.maxHp - 1) return
        this.commit(hero, abIndex, ab, haste)
        const amount = Math.min(power, target.maxHp - target.hp)
        target.hp += amount
        hero.healing += amount
        this.events.push({ t: 'heal', to: [target.x, target.z], ability: ab.id })
        break
      }
      case 'aoeheal': {
        const wounded = this.heroes.some(
          (h) => h.alive && h.hp < h.maxHp - 1 && Math.hypot(h.x - hero.x, h.z - hero.z) <= ab.radius
        )
        if (!wounded) return
        this.commit(hero, abIndex, ab, haste)
        for (const h of this.heroes) {
          if (!h.alive || Math.hypot(h.x - hero.x, h.z - hero.z) > ab.radius) continue
          const amount = Math.min(power, h.maxHp - h.hp)
          h.hp += amount
          hero.healing += amount
        }
        this.events.push({ t: 'aoe', at: [hero.x, hero.z], r: ab.radius, color: '#8fe89a', seal: true, ability: ab.id })
        break
      }
      case 'buff': {
        const target = ab.target === 'self' ? hero : this.pickAlly(hero, ab.range, 1 - pref, false) ?? hero
        this.commit(hero, abIndex, ab, haste)
        if (ab.buff === 'bless') target.bless = BLESS_DURATION
        else if (ab.buff === 'stance') target.stance = STANCE_DURATION
        this.events.push({ t: 'buff', to: [target.x, target.z], color: hero.cls.color, ability: ab.id })
        break
      }
      case 'taunt': {
        let taunted = 0
        for (const m of this.monsters) {
          if (Math.hypot(m.x - hero.x, m.z - hero.z) <= ab.range) {
            m.taunt = { hero, t: ab.duration }
            taunted++
          }
        }
        if (taunted === 0) return
        this.commit(hero, abIndex, ab, haste)
        this.events.push({ t: 'taunt', at: [hero.x, hero.z], r: ab.range, ability: ab.id })
        break
      }
      case 'drain': {
        const target = this.pickMonster(hero, ab.range, pref)
        if (!target) return
        this.commit(hero, abIndex, ab, haste)
        this.damageMonster(hero, target, power)
        const heal = Math.min(power * 0.8, hero.maxHp - hero.hp)
        hero.hp += heal
        hero.healing += heal
        this.events.push({ t: 'drain', from: [target.x, target.z], to: [hero.x, hero.z], ability: ab.id })
        break
      }
    }
    hero.stats.abilities[abIndex]++
  }

  commit(hero, abilityIndex, ab, haste = 1) {
    hero.cds[abilityIndex] = ab.cd * haste
    hero.mana -= ab.cost
  }

  // ---- Un pas pour un monstre ----

  stepMonster(m, dt) {
    this.tickAfflictions(m, dt, false)
    if (m.hp <= 0) return
    m.cd -= dt
    if (m.taunt) {
      m.taunt.t -= dt
      if (m.taunt.t <= 0 || !m.taunt.hero.alive) m.taunt = null
    }
    if (m.stats.regen) m.hp = Math.min(m.maxHp, m.hp + m.stats.regen * dt)
    if (m.aff.stun > 0) return

    if (m.slam) {
      m.slam.timer -= dt
      if (m.slam.timer <= 0) {
        m.slam.timer = m.slam.cd
        for (const h of this.heroes) {
          if (h.alive && Math.hypot(h.x - m.x, h.z - m.z) <= m.slam.radius) {
            this.damageHero(m, h, m.dmg * m.slam.mult)
            if (m.bossApplies) this.applyAfflictions(h, m.bossApplies)
          }
        }
        this.events.push({ t: 'slam', at: [m.x, m.z], r: m.slam.radius })
        return
      }
    }

    if (m.stats.ai === 'healer' && m.cd <= 0) {
      let target = null
      let worst = 0.99
      for (const o of this.monsters) {
        if (o === m || o.hp <= 0) continue
        const frac = o.hp / o.maxHp
        if (frac < worst && Math.hypot(o.x - m.x, o.z - m.z) < 8) {
          worst = frac
          target = o
        }
      }
      if (target) {
        m.cd = m.stats.cooldown
        target.hp = Math.min(target.maxHp, target.hp + m.stats.heal * Math.pow(MONSTER_GROWTH, this.floor - 1))
        this.events.push({ t: 'heal', to: [target.x, target.z] })
        return
      }
    }

    let target = m.taunt?.hero ?? null
    if (!target) {
      let bd = Infinity
      for (const h of this.heroes) {
        if (!h.alive) continue
        const d = Math.hypot(h.x - m.x, h.z - m.z)
        if (d < bd) {
          bd = d
          target = h
        }
      }
    }
    if (!target) return

    const dist = Math.hypot(target.x - m.x, target.z - m.z)
    const slowMult = m.aff.slow > 0 ? SLOW_FACTOR : 1
    const isRanged = m.stats.ai === 'ranged' || m.stats.ai === 'healer'

    if (isRanged && dist < m.stats.range * 0.5) {
      const dx = m.x - target.x
      const dz = m.z - target.z
      m.x += (dx / dist) * m.stats.speed * slowMult * dt
      m.z += (dz / dist) * m.stats.speed * slowMult * dt
    } else if (dist > m.stats.range) {
      const enrage = 1 + Math.max(0, this.floorTime - FLOOR_TIME_LIMIT * 0.6) * 0.06
      const dx = target.x - m.x
      const dz = target.z - m.z
      m.x += (dx / dist) * m.stats.speed * slowMult * enrage * dt
      m.z += (dz / dist) * m.stats.speed * slowMult * enrage * dt
    } else if (m.cd <= 0) {
      m.cd = m.stats.cooldown
      if (m.stats.aoe) {
        for (const h of this.heroes) {
          if (h.alive && Math.hypot(h.x - target.x, h.z - target.z) <= m.stats.aoe) {
            this.damageHero(m, h, m.dmg)
            this.applyAfflictions(h, m.stats.applies)
          }
        }
        this.events.push({ t: 'aoe', at: [target.x, target.z], r: m.stats.aoe, color: '#d1584a' })
      } else {
        this.damageHero(m, target, m.dmg)
        this.applyAfflictions(target, m.stats.applies)
        this.events.push({ t: 'bite', to: [target.x, target.z] })
      }
    }
  }

  // ---- Boucle ----

  step(dt = TICK) {
    this.events = []
    if (this.over) return
    this.time += dt

    if (this.betweenFloors > 0) {
      this.betweenFloors -= dt
      if (this.betweenFloors <= 0) {
        if (this.floor >= MAX_FLOOR) {
          this.end('sommet')
          return
        }
        this.startFloor(this.floor + 1)
      }
      return
    }

    this.floorTime += dt
    for (const h of this.heroes) this.stepHero(h, dt)
    for (const m of this.monsters) this.stepMonster(m, dt)

    for (let i = this.monsters.length - 1; i >= 0; i--) {
      const m = this.monsters[i]
      if (m.hp <= 0) {
        this.events.push({ t: 'monsterDie', at: [m.x, m.z], size: m.size })
        this.monsters.splice(i, 1)
      }
    }

    if (this.heroes.every((h) => !h.alive)) {
      this.end('mort')
      return
    }
    if (this.monsters.length === 0) {
      this.clearFloor()
      return
    }
    if (this.floorTime > FLOOR_TIME_LIMIT) {
      this.end('enlisement')
    }
  }

  snapshot() {
    return {
      floor: this.floor,
      time: this.time,
      restsLeft: this.restsLeft,
      heroes: this.heroes.map((h) => ({
        x: h.x,
        z: h.z,
        hp: h.hp / h.maxHp,
        mana: h.mana / h.maxMana,
        alive: h.alive,
        classIndex: h.classIndex,
      })),
      monsters: this.monsters.map((m) => ({
        x: m.x,
        z: m.z,
        hp: m.hp / m.maxHp,
        size: m.size,
        boss: m.boss,
      })),
    }
  }
}

// Fait tourner un run complet à vitesse maximale (usage worker).
export function runTower(genome, seed, onSnapshot = null, snapshotEvery = 40, options = {}) {
  const run = new TowerRun(genome, seed, options)
  let tick = 0
  let guard = 0
  while (!run.finished && guard++ < 500000) {
    run.step(TICK)
    tick++
    if (onSnapshot && tick % snapshotEvery === 0) onSnapshot(run.snapshot())
  }
  return {
    fitness: run.fitness(),
    floors: run.floorsCleared,
    time: run.time,
    reason: run.endReason,
    run,
  }
}
