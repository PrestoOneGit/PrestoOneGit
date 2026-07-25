// Moteur de run : une équipe de 5 agents grimpe la tour étage par étage.
// Pur JS, déterministe à graine et génome égaux, sans dépendance — le même
// code tourne dans les Web Workers (évaluation accélérée) et dans le fil
// principal (visionneuse).
//
// Les agents n'ont AUCUN comportement écrit à la main : leurs réseaux
// (brain.js) décident de tout, jusqu'à la carte qu'ils prennent au draft.
// Le moteur n'applique que les règles (data.js) et le terrain (terrain.js).

import {
  CARDS_PER_LEVEL, CLASSES, ELITE_CHANCE, ELITE_FROM_FLOOR, ELITE_MULT,
  FLOOR_BUDGET, FLOOR_TIME_LIMIT, HEAVY_HIT_THRESHOLD, INTERACTIONS, MAX_FLOOR,
  MONSTERS, MONSTER_GROWTH, PASSIVES, REGEN_BETWEEN_FLOORS, REINFORCEMENTS,
  RESTS_PER_RUN, REVIVES_PER_AGENT, STATES, SUMMONS, tierForFloor,
} from './data.js'
import { Terrain, BOARD, HALF } from './terrain.js'
import { RING5, arch, len2, powInt } from './exact.js'
import {
  ABILITY_SLOTS, INPUT_SIZE, OUTPUT_SIZE, OUT_ABILITY, OUT_BASIC, OUT_CARD,
  OUT_GATE, OUT_MOBILITY, OUT_REST, OUT_TARGET_PREF, SLOTS, WALL_RAYS,
  forward, slotClass,
} from './brain.js'

export const TICK = 0.1
export { BOARD, HALF } // le HUD et la visionneuse dimensionnent le plateau dessus

// Inertie du déplacement : part de la direction demandée absorbée par tick.
// À 0.35 et TICK = 0.1 s, un demi-tour complet prend environ une demi-seconde.
const TURN_BLEND = 0.35

export const MOBILITY = {
  dash: { distance: 4.2, cd: 5 },
  sprint: { speedMult: 1.6, duration: 3, cd: 12 },
  jump: { distance: 6.5, airTime: 0.45, cd: 10 },
}

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
const rays = new Float32Array(WALL_RAYS)

// Sélection des N plus proches, sans allocation.
const NEAR = 4
const nearEntity = new Array(NEAR)
const nearDist = new Float64Array(NEAR)

function selectNearest(list, x, z, filter) {
  for (let i = 0; i < NEAR; i++) {
    nearEntity[i] = null
    nearDist[i] = Infinity
  }
  for (let i = 0; i < list.length; i++) {
    const e = list[i]
    if (filter && !filter(e)) continue
    const dx = e.x - x
    const dz = e.z - z
    const d = dx * dx + dz * dz
    if (d >= nearDist[NEAR - 1]) continue
    let slot = NEAR - 1
    while (slot > 0 && nearDist[slot - 1] > d) {
      nearDist[slot] = nearDist[slot - 1]
      nearEntity[slot] = nearEntity[slot - 1]
      slot--
    }
    nearDist[slot] = d
    nearEntity[slot] = e
  }
}

function freshStates() {
  return {
    burn: 0, poison: 0, poisonStacks: 0, shock: 0, freeze: 0, slow: 0,
    stun: 0, vuln: 0, bleed: 0, terror: 0,
    bless: 0, haste: 0, shield: 0, shieldAmount: 0, regen: 0, stance: 0, intangible: 0,
  }
}

export class TowerRun {
  // `logging` active la collecte détaillée pour les rapports.
  // `emitEvents` produit le flux consommé par la vue 3D ; les workers
  // d'évaluation n'en lisent aucun et le désactivent.
  constructor(genome, seed, { logging = false, emitEvents = true } = {}) {
    this.genome = genome
    this.seed = seed
    this.rng = mulberry32(seed)
    this.logging = logging
    this.emitEvents = emitEvents
    this.time = 0
    this.floor = 0
    this.floorTime = 0
    this.floorsCleared = 0
    this.restsLeft = RESTS_PER_RUN
    this.betweenFloors = 0
    this.events = []
    this.monsters = []
    this.summons = []
    this.corpses = []
    this.zones = [] // sanctuaires, nuées, poussières
    this.nextId = 1
    this.monstersKilled = 0
    this.over = false
    this.endReason = null
    this.timeline = []
    this.floorLog = []
    this.currentFloorLog = null
    this.terrain = null

    this.heroes = Array.from({ length: SLOTS }, (_, s) => {
      const cls = slotClass(genome, s)
      // Cinq positions en cercle : directions tabulées dans exact.js.
      const [rc, rs] = RING5[s % RING5.length]
      return {
        slot: s,
        cls,
        classIndex: CLASSES.indexOf(cls),
        x: rc * 2.5,
        z: rs * 2.5,
        headX: rc, // cap courant, lissé (voir TURN_BLEND)
        headZ: rs,
        level: 1,
        // Le draft : on démarre avec la seule capacité de départ.
        abilities: [cls.abilities.find((ab) => ab.id === cls.starter) ?? cls.abilities[0]].map(clone),
        passives: [],
        mult: baseMult(),
        immunities: new Set(),
        lifesteal: 0,
        dodge: 0,
        executeBonus: 0,
        maxHp: cls.hp,
        maxMana: cls.mana,
        hp: cls.hp,
        mana: cls.mana,
        cdBasic: 0,
        cds: [0, 0, 0, 0],
        mobilityCds: { dash: 0, sprint: 0, jump: 0 },
        sprintLeft: 0,
        airborne: 0,
        jumpFrom: null,
        jumpTo: null,
        jumpHeight: 0,
        alive: true,
        revivesLeft: REVIVES_PER_AGENT,
        st: freshStates(),
        damage: 0,
        healing: 0,
        damageTaken: 0,
        lastRestWish: 0,
        pendingCards: null,
        stats: {
          abilities: {}, basic: 0, dash: 0, sprint: 0, jump: 0,
          deathFloor: null, revived: 0, summoned: 0, cards: [],
        },
      }
    })

    this.startFloor(1)
  }

  get finished() {
    return this.over
  }

  // ---- Score ----
  // Termes continus cumulés : sans eux le paysage est un escalier à
  // marches plates où aucune mutation ne peut être récompensée tant
  // qu'elle ne fait pas gagner un étage entier.
  fitness() {
    const alive = this.heroes.filter((h) => h.alive).length
    const totalDamage = this.heroes.reduce((s, h) => s + h.damage, 0)
    const hpFraction = this.heroes.reduce((s, h) => s + (h.alive ? h.hp / h.maxHp : 0), 0) / SLOTS
    return (
      this.floorsCleared * 1000 +
      this.floorProgress() * 500 +
      this.monstersKilled * 12 +
      totalDamage * 0.05 +
      hpFraction * 200 +
      alive * 60 +
      this.time * 2
    )
  }

  floorProgress() {
    const spawned = this.floorSpawned || 0
    if (spawned === 0) return 0
    return Math.min(this.floorKilled / spawned, 1)
  }

  mark(type, data = {}) {
    if (!this.logging) return
    this.timeline.push({ t: Number(this.time.toFixed(1)), floor: this.floor, type, ...data })
  }

  emit(event) {
    if (this.emitEvents) this.events.push(event)
  }

  // ─────────────────────────── ÉTAGES ───────────────────────────

  startFloor(floor) {
    this.floor = floor
    this.floorTime = 0
    this.monsters = []
    this.corpses = []
    this.zones = []
    this.floorKilled = 0
    this.terrain = new Terrain(this.rng, floor)

    const isBoss = floor % 10 === 0
    const budget = Math.floor(FLOOR_BUDGET(floor))
    this.floorSpawned = 0

    // Le budget est réparti entre les portails : ils cracheront au fil du
    // temps plutôt que de tout déverser d'un coup.
    const share = budget / this.terrain.portals.length
    for (const p of this.terrain.portals) p.remaining = share

    if (isBoss) {
      const boss = tierForFloor(floor).boss
      this.spawnMonster(boss, { boss: true, at: [0, -HALF + 4] })
    }

    // Les agents reprennent au centre, sur des cases libres.
    this.heroes.forEach((h, i) => {
      const [rc, rs] = RING5[i % RING5.length]
      h.x = rc * 2.5
      h.z = rs * 2.5
      h.headX = rc
      h.headZ = rs
    })

    if (this.logging) {
      this.currentFloorLog = {
        floor, boss: isBoss, archetype: this.terrain.archetype,
        portals: this.terrain.portals.length, traps: this.terrain.traps.length,
        monsters: {}, duration: 0, damageDealt: 0, damageTaken: 0,
        deaths: [], restTaken: false, cards: [],
      }
    }
    this.emit({ t: 'floor', floor, boss: isBoss, archetype: this.terrain.archetype })
    this.mark('floorStart', { boss: isBoss, archetype: this.terrain.archetype })
  }

  spawnMonster(type, { boss = false, elite = false, at = null, summonedBy = null } = {}) {
    const t = MONSTERS[type]
    if (!t) return null
    const scale = powInt(MONSTER_GROWTH, this.floor - 1)
    let hp = t.hp * scale
    let dmg = t.dmg * scale
    let size = t.size
    if (elite) {
      hp *= ELITE_MULT.hp
      dmg *= ELITE_MULT.dmg
      size *= 1.2
    }
    if (boss) {
      hp *= 6
      dmg *= 1.6
      size *= 1.5
    }
    let x
    let z
    if (at) {
      ;[x, z] = at
    } else {
      ;[x, z] = this.terrain.freePoint(this.rng, 6)
    }
    const m = {
      id: this.nextId++,
      type, label: t.label, stats: t,
      x, z, hp, maxHp: hp, dmg, size,
      elite, boss, summonedBy,
      cd: 0.6 + this.rng() * 0.8,
      st: freshStates(),
      taunt: null,
      revivesLeft: t.revive ?? 0,
      splitLeft: t.split ?? 0,
      webCd: 0,
      spellCd: 2,
    }
    this.monsters.push(m)
    this.floorSpawned++
    if (this.currentFloorLog) {
      const key = boss ? `${type} (boss)` : elite ? `${type} (élite)` : type
      this.currentFloorLog.monsters[key] = (this.currentFloorLog.monsters[key] ?? 0) + 1
    }
    return m
  }

  stepPortals(dt) {
    const tier = tierForFloor(this.floor)
    for (const p of this.terrain.portals) {
      if (p.sealed > 0 || p.remaining <= 0) continue
      p.timer -= dt
      if (p.timer > 0) continue
      p.timer = p.cadence
      const type = tier.pool[Math.floor(this.rng() * tier.pool.length)]
      const cost = MONSTERS[type].cost
      const elite = this.floor >= ELITE_FROM_FLOOR && this.rng() < ELITE_CHANCE
      this.spawnMonster(type, { elite, at: [p.x, p.z] })
      p.remaining -= cost
      this.emit({ t: 'portalSpawn', at: [p.x, p.z] })
    }
  }

  floorCleared() {
    // Un étage est franchi quand tous les portails sont taris et qu'il ne
    // reste plus rien à combattre.
    return (
      this.monsters.length === 0 &&
      this.terrain.portals.every((p) => p.remaining <= 0)
    )
  }

  // ─────────────────────────── DRAFT ───────────────────────────
  // Trois cartes tirées au sort ; le réseau en choisit une. Il les VOIT
  // dans ses observations — sans ça il choisirait à l'aveugle par position.

  drawCards(hero) {
    const cards = []
    const known = new Set(hero.abilities.map((a) => a.id))
    const owned = new Set(hero.passives.map((p) => p.id))

    // Capacités de classe encore inconnues
    const locked = hero.cls.abilities.filter((a) => !known.has(a.id))
    // Passifs non encore pris
    const freePassives = PASSIVES.filter((p) => !owned.has(p.id))

    const pools = []
    if (locked.length && hero.abilities.length < ABILITY_SLOTS) pools.push('ability')
    if (freePassives.length) pools.push('passive')
    if (hero.abilities.length) pools.push('reinforce')

    let guard = 0
    while (cards.length < CARDS_PER_LEVEL && guard++ < 40) {
      const kind = pools[Math.floor(this.rng() * pools.length)]
      if (kind === 'ability') {
        const ab = locked[Math.floor(this.rng() * locked.length)]
        if (cards.some((c) => c.kind === 'ability' && c.ability.id === ab.id)) continue
        cards.push({ kind: 'ability', ability: ab, label: ab.label })
      } else if (kind === 'passive') {
        const p = freePassives[Math.floor(this.rng() * freePassives.length)]
        if (cards.some((c) => c.kind === 'passive' && c.passive.id === p.id)) continue
        cards.push({ kind: 'passive', passive: p, label: p.label })
      } else {
        const target = hero.abilities[Math.floor(this.rng() * hero.abilities.length)]
        const candidates = REINFORCEMENTS.filter((r) => !r.needs || target[r.needs] != null)
        if (!candidates.length) continue
        const r = candidates[Math.floor(this.rng() * candidates.length)]
        if (cards.some((c) => c.kind === 'reinforce' && c.reinf.id === r.id && c.target.id === target.id)) continue
        cards.push({ kind: 'reinforce', reinf: r, target, label: `${target.label} : ${r.label}` })
      }
    }
    return cards
  }

  applyCard(hero, card) {
    if (card.kind === 'ability') {
      hero.abilities.push(clone(card.ability))
    } else if (card.kind === 'passive') {
      const p = card.passive
      hero.passives.push(p)
      if (p.mult) for (const [k, v] of Object.entries(p.mult)) hero.mult[k] *= v
      if (p.lifesteal) hero.lifesteal += p.lifesteal
      if (p.dodge) hero.dodge += p.dodge
      if (p.executeBonus) hero.executeBonus += p.executeBonus
      if (p.immune) for (const s of p.immune) hero.immunities.add(s)
      this.recomputeStats(hero)
    } else {
      const t = hero.abilities.find((a) => a.id === card.target.id)
      if (t && t[card.reinf.field] != null) t[card.reinf.field] *= card.reinf.mult
    }
    hero.stats.cards.push(card.label)
    if (this.currentFloorLog) {
      this.currentFloorLog.cards.push({ agent: hero.cls.label, slot: hero.slot, card: card.label })
    }
    this.mark('draft', { agent: hero.cls.label, slot: hero.slot, card: card.label })
    this.emit({ t: 'draft', slot: hero.slot, card: card.label })
  }

  recomputeStats(hero) {
    const hpRatio = hero.maxHp > 0 ? hero.hp / hero.maxHp : 1
    const manaRatio = hero.maxMana > 0 ? hero.mana / hero.maxMana : 1
    hero.maxHp = hero.cls.hp * hero.mult.hp
    hero.maxMana = hero.cls.mana * hero.mult.mana
    hero.hp = hero.maxHp * hpRatio
    hero.mana = hero.maxMana * manaRatio
  }

  clearFloor() {
    this.floorsCleared++
    const survivors = this.heroes.filter((h) => h.alive)
    const wish = survivors.reduce((s, h) => s + h.lastRestWish, 0) / Math.max(survivors.length, 1)
    const rest = wish > 0.55 && this.restsLeft > 0

    for (const hero of survivors) {
      hero.level++
      if (rest) {
        hero.hp = hero.maxHp
        hero.mana = hero.maxMana
      } else {
        hero.hp = Math.min(hero.maxHp, hero.hp + (hero.maxHp - hero.hp) * REGEN_BETWEEN_FLOORS.hp)
        hero.mana = Math.min(hero.maxMana, hero.mana + (hero.maxMana - hero.mana) * REGEN_BETWEEN_FLOORS.mana)
      }
      hero.st = freshStates()
      hero.cds = [0, 0, 0, 0]
      hero.cdBasic = 0
      hero.mobilityCds = { dash: 0, sprint: 0, jump: 0 }
      hero.sprintLeft = 0
      hero.airborne = 0
      hero.jumpHeight = 0

      // Draft : on tire, le réseau choisit.
      const cards = this.drawCards(hero)
      if (cards.length) {
        hero.pendingCards = cards
        const out = forward(this.genome, hero.slot, this.buildObservation(hero), act)
        let bestIndex = 0
        let bestScore = -Infinity
        for (let i = 0; i < cards.length; i++) {
          if (out[OUT_CARD + i] > bestScore) {
            bestScore = out[OUT_CARD + i]
            bestIndex = i
          }
        }
        hero.pendingCards = null
        this.applyCard(hero, cards[bestIndex])
      }
    }

    this.summons = [] // les invocations ne survivent pas à l'étage
    if (rest) {
      this.restsLeft--
      this.emit({ t: 'rest', restsLeft: this.restsLeft })
      this.mark('rest', { restsLeft: this.restsLeft })
    }
    if (this.currentFloorLog) {
      this.currentFloorLog.duration = Number(this.floorTime.toFixed(1))
      this.currentFloorLog.restTaken = rest
      this.currentFloorLog.survivors = survivors.length
      this.floorLog.push(this.currentFloorLog)
      this.currentFloorLog = null
    }
    this.emit({ t: 'floorClear', floor: this.floor })
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

  // ─────────────────────────── ÉTATS ───────────────────────────

  applyStates(target, applies, scale = 1) {
    if (!applies) return
    for (const [name, amount] of Object.entries(applies)) {
      if (target.immunities?.has(name)) continue
      const spec = STATES[name]
      if (!spec) continue
      const dur = (spec.duration ?? 1) * amount * scale * (target.mult?.afflictionDuration ?? 1)
      if (name === 'poison') {
        target.st.poisonStacks = Math.min(spec.stacks, target.st.poisonStacks + 1)
      }
      // En feu et Gelé s'annulent mutuellement.
      if (INTERACTIONS.fireCancelsFreeze) {
        if (name === 'burn' && target.st.freeze > 0) {
          target.st.freeze = 0
          continue
        }
        if (name === 'freeze' && target.st.burn > 0) {
          target.st.burn = 0
          continue
        }
      }
      target.st[name] = Math.max(target.st[name], dur)
    }
  }

  tickStates(entity, dt, isHero) {
    const st = entity.st
    let dot = 0
    if (st.burn > 0) dot += STATES.burn.dot * dt
    if (st.poison > 0) {
      // Combustion toxique : le poison fait double sur une cible en feu.
      const mult = st.burn > 0 ? INTERACTIONS.toxicCombustion : 1
      dot += STATES.poison.dot * st.poisonStacks * mult * dt
    }
    if (st.shock > 0) dot += STATES.shock.dot * dt
    if (st.bleed > 0) dot += STATES.bleed.dot * dt * (entity.movedThisTick ? 2 : 1)
    if (st.regen > 0) {
      const heal = STATES.regen.heal * dt
      entity.hp = Math.min(entity.maxHp, entity.hp + heal)
      if (isHero) entity.healing += heal
    }
    if (dot > 0) this.rawDamage(entity, dot, isHero, 'affliction')

    for (const key of ['burn', 'poison', 'shock', 'freeze', 'slow', 'stun', 'vuln',
      'bleed', 'terror', 'bless', 'haste', 'shield', 'regen', 'stance', 'intangible']) {
      if (st[key] > 0) st[key] = Math.max(0, st[key] - dt)
    }
    if (st.poison === 0) st.poisonStacks = 0
    if (st.shield === 0) st.shieldAmount = 0
    entity.movedThisTick = false
  }

  // ─────────────────────────── DÉGÂTS ───────────────────────────

  outgoing(hero, base, isAbility) {
    let dmg = base
    if (hero.st.bless > 0) dmg *= STATES.bless.outgoingMult
    if (hero.cls.passive === 'rageEchoes') {
      const missing = 1 - hero.hp / hero.maxHp
      dmg *= 1 + missing * 0.9
    }
    if (isAbility) dmg *= hero.mult.ability ?? 1
    return dmg
  }

  hurtMonster(source, m, amount, { heavy = false } = {}) {
    let dmg = amount
    if (source?.executeBonus && m.hp / m.maxHp < 0.4) dmg *= 1 + source.executeBonus
    if (m.st.vuln > 0) dmg *= STATES.vuln.incomingMult
    if (m.stats.armor) dmg *= 1 - m.stats.armor
    // Gel brisé par un coup lourd : dégâts doublés.
    if (m.st.freeze > 0 && (heavy || dmg >= HEAVY_HIT_THRESHOLD)) {
      dmg *= INTERACTIONS.freezeShatter.multiplier
      m.st.freeze = 0
      this.emit({ t: 'shatter', at: [m.x, m.z] })
    }
    m.hp -= dmg
    if (source && source.damage !== undefined) {
      source.damage += dmg
      if (source.lifesteal) {
        const heal = Math.min(dmg * source.lifesteal, source.maxHp - source.hp)
        source.hp += heal
        source.healing += heal
      }
    }
    if (this.currentFloorLog) this.currentFloorLog.damageDealt += dmg
  }

  rawDamage(entity, amount, isHero, cause) {
    if (entity.st.intangible > 0) return
    let dmg = amount
    if (entity.st.vuln > 0) dmg *= STATES.vuln.incomingMult
    if (entity.st.stance > 0) dmg *= STATES.stance.incomingMult
    if (entity.st.shield > 0 && entity.st.shieldAmount > 0) {
      const absorbed = Math.min(entity.st.shieldAmount, dmg)
      entity.st.shieldAmount -= absorbed
      dmg -= absorbed
      if (entity.st.shieldAmount <= 0) entity.st.shield = 0
    }
    entity.hp -= dmg
    if (isHero) {
      entity.damageTaken += dmg
      if (this.currentFloorLog) this.currentFloorLog.damageTaken += dmg
      if (entity.hp <= 0 && entity.alive) this.downHero(entity, cause)
    }
  }

  hurtHero(monster, hero, amount) {
    if (hero.st.intangible > 0) {
      this.emit({ t: 'dodge', at: [hero.x, hero.z] })
      return
    }
    if (hero.airborne > 0 && monster && monster.stats.range < 3) {
      this.emit({ t: 'dodge', at: [hero.x, hero.z] })
      return
    }
    if (hero.dodge > 0 && this.rng() < hero.dodge) {
      this.emit({ t: 'dodge', at: [hero.x, hero.z] })
      return
    }
    this.rawDamage(hero, amount, true, 'coup')
  }

  downHero(hero, cause) {
    hero.hp = 0
    hero.alive = false
    hero.stats.deathFloor = this.floor
    // Le cadavre d'un agent n'est pas exploitable par le Nécromancien.
    this.emit({ t: 'heroDown', slot: hero.slot, at: [hero.x, hero.z] })
    if (this.currentFloorLog) {
      this.currentFloorLog.deaths.push({ agent: hero.cls.label, slot: hero.slot, cause })
    }
    this.mark('agentDown', { agent: hero.cls.label, slot: hero.slot, cause })
  }

  killMonster(m, index) {
    this.monstersKilled++
    this.floorKilled++
    this.emit({ t: 'monsterDie', at: [m.x, m.z], size: m.size })
    // Cadavre exploitable par le Nécromancien et les goules.
    this.corpses.push({ id: this.nextId++, x: m.x, z: m.z, life: 12, type: m.type })
    // Un slime se scinde ; un squelette ou une goule peut se relever.
    if (m.splitLeft > 0) {
      for (let i = 0; i < 2; i++) {
        const child = this.spawnMonster(m.type, { at: [m.x + (this.rng() - 0.5) * 2, m.z + (this.rng() - 0.5) * 2] })
        if (child) {
          child.splitLeft = m.splitLeft - 1
          child.hp = child.maxHp = m.maxHp * 0.45
          child.size = m.size * 0.7
        }
      }
    } else if (m.revivesLeft > 0 && this.rng() < 0.6) {
      const back = this.spawnMonster(m.type, { at: [m.x, m.z] })
      if (back) {
        back.revivesLeft = 0
        back.hp = back.maxHp * 0.5
        this.emit({ t: 'revive', at: [m.x, m.z] })
      }
    }
    this.monsters.splice(index, 1)
  }

  // ─────────────────────────── CIBLAGE ───────────────────────────

  pickMonster(hero, range, pref, needsSight = true) {
    let best = null
    let bestScore = Infinity
    const r2 = range * range
    for (const m of this.monsters) {
      const dx = m.x - hero.x
      const dz = m.z - hero.z
      const d2 = dx * dx + dz * dz
      if (d2 > r2) continue
      if (needsSight && !this.terrain.hasLineOfSight(hero.x, hero.z, m.x, m.z)) continue
      const score = (1 - pref) * (Math.sqrt(d2) / BOARD) + pref * (m.hp / m.maxHp)
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
      const d = len2(h.x - hero.x, h.z - hero.z)
      if (d > range) continue
      const score = (1 - pref) * (d / BOARD) + pref * (h.hp / h.maxHp)
      if (score < bestScore) {
        bestScore = score
        best = h
      }
    }
    return best
  }

  // ─────────────────────────── OBSERVATIONS ───────────────────────────

  buildObservation(hero) {
    const R = HALF
    let k = 0
    const st = hero.st
    obs[k++] = hero.hp / hero.maxHp
    obs[k++] = hero.mana / hero.maxMana
    obs[k++] = hero.cdBasic <= 0 ? 1 : 0
    obs[k++] = hero.x / R
    obs[k++] = hero.z / R
    obs[k++] = st.stun > 0 ? 1 : 0
    obs[k++] = st.freeze > 0 ? 1 : 0
    obs[k++] = st.slow > 0 ? 1 : 0
    obs[k++] = Math.min((st.burn + st.shock + st.bleed) / 6, 1)
    obs[k++] = Math.min(st.poisonStacks / 5, 1)
    obs[k++] = st.bless > 0 ? 1 : 0
    obs[k++] = st.haste > 0 ? 1 : 0
    obs[k++] = st.shield > 0 ? 1 : 0
    obs[k++] = st.stance > 0 ? 1 : 0
    obs[k++] = st.intangible > 0 ? 1 : 0
    obs[k++] = hero.revivesLeft / Math.max(REVIVES_PER_AGENT, 1)

    // Capacités : possédée + prête, pour chacun des 4 emplacements
    for (let i = 0; i < ABILITY_SLOTS; i++) obs[k++] = hero.abilities[i] ? 1 : 0
    for (let i = 0; i < ABILITY_SLOTS; i++) {
      const ab = hero.abilities[i]
      obs[k++] = ab && hero.cds[i] <= 0 && hero.mana >= ab.cost ? 1 : 0
    }

    // Mobilité
    obs[k++] = hero.mobilityCds.dash <= 0 ? 1 : 0
    obs[k++] = hero.mobilityCds.sprint <= 0 ? 1 : 0
    obs[k++] = hero.mobilityCds.jump <= 0 ? 1 : 0
    obs[k++] = hero.airborne > 0 ? 1 : 0
    obs[k++] = hero.sprintLeft > 0 ? 1 : 0

    // Monstres proches
    selectNearest(this.monsters, hero.x, hero.z)
    for (let i = 0; i < NEAR; i++) {
      const m = nearEntity[i]
      if (m) {
        obs[k++] = (m.x - hero.x) / R
        obs[k++] = (m.z - hero.z) / R
        obs[k++] = m.hp / m.maxHp
        obs[k++] = Math.min((m.dmg / hero.maxHp) * 8, 1)
        obs[k++] = m.boss ? 1 : m.elite ? 0.5 : 0
        obs[k++] = this.terrain.hasLineOfSight(hero.x, hero.z, m.x, m.z) ? 1 : 0
      } else {
        for (let j = 0; j < 6; j++) obs[k++] = 0
      }
    }

    // Alliés
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
        obs[k++] = -1 // allié à terre : signal distinct de « absent »
      }
    }

    // Murs
    this.terrain.wallSensors(hero.x, hero.z, rays)
    for (let i = 0; i < WALL_RAYS; i++) obs[k++] = rays[i]

    // Portail, piège visible et cadavre les plus proches, invocations
    k = this.writeNearest(k, this.terrain.portals, hero, (p) => p.sealed <= 0 && p.remaining > 0)
    k = this.writeNearest(k, this.terrain.traps, hero, (t) => t.stats.visible)
    k = this.writeNearest(k, this.corpses, hero, null)
    obs[k++] = Math.min(this.summons.filter((s) => s.owner === hero.slot).length / 3, 1)

    // Contexte
    obs[k++] = this.floor / MAX_FLOOR
    obs[k++] = Math.min(this.monsters.length / 12, 1)
    obs[k++] = this.restsLeft / RESTS_PER_RUN
    obs[k++] = this.floor % 10 === 0 ? 1 : 0

    // Cartes du draft : l'agent doit VOIR ce qu'on lui propose, et assez
    // finement pour distinguer deux passifs différents.
    for (let i = 0; i < CARDS_PER_LEVEL; i++) {
      k = writeCard(obs, k, hero.pendingCards?.[i])
    }
    return obs
  }

  writeNearest(k, list, hero, filter) {
    let best = null
    let bd = Infinity
    for (const e of list) {
      if (filter && !filter(e)) continue
      const d = (e.x - hero.x) ** 2 + (e.z - hero.z) ** 2
      if (d < bd) {
        bd = d
        best = e
      }
    }
    if (best) {
      obs[k++] = (best.x - hero.x) / HALF
      obs[k++] = (best.z - hero.z) / HALF
      obs[k++] = 1
    } else {
      obs[k++] = 0
      obs[k++] = 0
      obs[k++] = 0
    }
    return k
  }

  // ─────────────────────────── AGENTS ───────────────────────────

  stepHero(hero, dt) {
    if (!hero.alive) return
    this.tickStates(hero, dt, true)
    if (!hero.alive) return

    const cdMult = hero.mult.cooldown * (hero.st.haste > 0 ? STATES.haste.cooldownMult : 1)
    hero.cdBasic -= dt
    for (let i = 0; i < hero.cds.length; i++) hero.cds[i] -= dt
    for (const key of Object.keys(hero.mobilityCds)) hero.mobilityCds[key] -= dt
    hero.sprintLeft = Math.max(0, hero.sprintLeft - dt)
    hero.mana = Math.min(hero.maxMana, hero.mana + hero.cls.manaRegen * hero.mult.mana * dt)

    if (hero.airborne > 0) {
      hero.airborne -= dt
      const p = Math.min(1, 1 - hero.airborne / MOBILITY.jump.airTime)
      hero.x = hero.jumpFrom[0] + (hero.jumpTo[0] - hero.jumpFrom[0]) * p
      hero.z = hero.jumpFrom[1] + (hero.jumpTo[1] - hero.jumpFrom[1]) * p
      hero.jumpHeight = arch(p) * 1.6
      if (hero.airborne <= 0) hero.jumpHeight = 0
      return
    }
    if (hero.st.stun > 0 || hero.st.freeze > 0) return

    const out = forward(this.genome, hero.slot, this.buildObservation(hero), act)
    const mx = out[0]
    const mz = out[1]
    hero.lastRestWish = out[OUT_REST]
    const pref = out[OUT_TARGET_PREF]
    const mag = Math.min(len2(mx, mz), 1)
    const dirX = mag > 0.001 ? mx / mag : 0
    const dirZ = mag > 0.001 ? mz / mag : 0

    // Mobilité générique
    if (mag > 0.05) {
      if (out[OUT_MOBILITY + 2] > 0.5 && hero.mobilityCds.jump <= 0) {
        const j = MOBILITY.jump
        hero.mobilityCds.jump = j.cd * cdMult
        hero.airborne = j.airTime
        hero.jumpFrom = [hero.x, hero.z]
        hero.jumpTo = this.clampTarget(hero.x + dirX * j.distance, hero.z + dirZ * j.distance)
        hero.stats.jump++
        this.emit({ t: 'jump', from: [hero.x, hero.z], to: hero.jumpTo, slot: hero.slot })
        return
      }
      if (out[OUT_MOBILITY] > 0.5 && hero.mobilityCds.dash <= 0) {
        hero.mobilityCds.dash = MOBILITY.dash.cd * cdMult
        const from = [hero.x, hero.z]
        this.terrain.move(hero, dirX * MOBILITY.dash.distance, dirZ * MOBILITY.dash.distance)
        hero.stats.dash++
        this.emit({ t: 'dash', from, to: [hero.x, hero.z], slot: hero.slot })
      }
      if (out[OUT_MOBILITY + 1] > 0.5 && hero.mobilityCds.sprint <= 0) {
        hero.mobilityCds.sprint = MOBILITY.sprint.cd * cdMult
        hero.sprintLeft = MOBILITY.sprint.duration
        hero.stats.sprint++
        this.emit({ t: 'sprint', slot: hero.slot })
      }
    }

    // Déplacement
    if (mag > 0.05) {
      // Inertie. Le réseau redonne une direction à chaque tick, sans mémoire
      // du pas précédent : appliquée telle quelle, elle produit un
      // tremblement (mesuré : 16 % des pas repartaient à plus de 90° même en
      // terrain dégagé, 52 % contre un mur). On donne donc une masse au
      // corps — le cap vire progressivement vers la direction demandée.
      //
      // C'est de la mécanique, pas de la décision : le réseau choisit
      // toujours OÙ aller, il ne peut simplement plus pivoter sur place en
      // un dixième de seconde.
      hero.headX += (dirX - hero.headX) * TURN_BLEND
      hero.headZ += (dirZ - hero.headZ) * TURN_BLEND
      const hl = len2(hero.headX, hero.headZ)
      const hx = hl > 0.001 ? hero.headX / hl : dirX
      const hz = hl > 0.001 ? hero.headZ / hl : dirZ

      let speed = hero.cls.speed * hero.mult.speed
      if (hero.st.slow > 0 && !hero.immunities.has('slow')) speed *= STATES.slow.speedMult
      if (hero.st.haste > 0) speed *= STATES.haste.speedMult
      if (hero.sprintLeft > 0) speed *= MOBILITY.sprint.speedMult
      const step = speed * mag * dt
      if (hero.st.intangible > 0) {
        // Intangible : traverse les murs.
        hero.x = Math.max(-HALF + 1, Math.min(HALF - 1, hero.x + hx * step))
        hero.z = Math.max(-HALF + 1, Math.min(HALF - 1, hero.z + hz * step))
      } else {
        this.terrain.move(hero, hx * step, hz * step)
      }
      hero.movedThisTick = true
    }
    this.separate(hero)
    this.checkTraps(hero, true)

    // Action : argmax parmi ce qui est disponible
    if (out[OUT_GATE] <= 0.5) return
    let bestAction = -1
    let bestScore = -Infinity
    if (hero.cdBasic <= 0 && out[OUT_BASIC] > bestScore) {
      bestScore = out[OUT_BASIC]
      bestAction = -2 // attaque de base
    }
    for (let i = 0; i < hero.abilities.length; i++) {
      const ab = hero.abilities[i]
      if (hero.cds[i] <= 0 && hero.mana >= ab.cost && out[OUT_ABILITY + i] > bestScore) {
        bestScore = out[OUT_ABILITY + i]
        bestAction = i
      }
    }
    if (bestAction === -1) return

    if (bestAction === -2) {
      const target = this.pickMonster(hero, hero.cls.range * hero.mult.range, pref)
      if (!target) return
      hero.cdBasic = hero.cls.cooldown * cdMult
      hero.stats.basic++
      this.hurtMonster(hero, target, this.outgoing(hero, hero.cls.dmg, false))
      this.emit({
        t: hero.cls.range > 3 ? 'arrow' : 'slash',
        from: [hero.x, hero.z], to: [target.x, target.z], color: hero.cls.color,
      })
      return
    }

    this.castAbility(hero, bestAction, pref, cdMult, dirX, dirZ)
  }

  clampTarget(x, z) {
    return [Math.max(-HALF + 1, Math.min(HALF - 1, x)), Math.max(-HALF + 1, Math.min(HALF - 1, z))]
  }

  separate(hero) {
    for (const h of this.heroes) {
      if (h === hero || !h.alive) continue
      const dx = hero.x - h.x
      const dz = hero.z - h.z
      const d = len2(dx, dz)
      if (d < 0.9 && d > 0.001) {
        this.terrain.move(hero, (dx / d) * (0.9 - d) * 0.5, (dz / d) * (0.9 - d) * 0.5)
      }
    }
  }

  checkTraps(entity, isHero) {
    for (const trap of this.terrain.traps) {
      if (trap.armed > 0) continue
      if (len2(entity.x - trap.x, entity.z - trap.z) > trap.stats.radius) continue
      trap.armed = trap.stats.rearm || 0.5
      trap.triggered = true
      if (trap.stats.damage) {
        isHero ? this.rawDamage(entity, trap.stats.damage, true, 'piège')
               : this.hurtMonster(null, entity, trap.stats.damage)
      }
      this.applyStates(entity, trap.stats.applies)
      this.emit({ t: 'trap', at: [trap.x, trap.z], type: trap.type })
    }
  }

  // ─────────────────────────── CAPACITÉS ───────────────────────────

  castAbility(hero, index, pref, cdMult, dirX, dirZ) {
    const ab = hero.abilities[index]
    const power = this.outgoing(hero, ab.power ?? 0, true)
    const range = (ab.range ?? 0) * hero.mult.range
    const commit = () => {
      hero.cds[index] = ab.cd * cdMult
      hero.mana -= ab.cost
      hero.stats.abilities[ab.id] = (hero.stats.abilities[ab.id] ?? 0) + 1
    }

    switch (ab.kind) {
      case 'bolt':
      case 'melee': {
        const target = this.pickMonster(hero, range, pref, ab.kind === 'bolt')
        if (!target) return
        commit()
        this.hurtMonster(hero, target, power, { heavy: ab.heavy })
        this.applyStates(target, ab.applies)
        if (ab.siphon) {
          const heal = Math.min(power * 0.6, hero.maxHp - hero.hp)
          hero.hp += heal
          hero.healing += heal
        }
        this.emit({
          t: ab.kind === 'bolt' ? 'bolt' : 'slash',
          from: [hero.x, hero.z], to: [target.x, target.z], color: hero.cls.color, ability: ab.id,
        })
        break
      }
      case 'pierce': {
        const target = this.pickMonster(hero, range, pref)
        if (!target) return
        commit()
        // Tout ce qui est aligné entre l'agent et la cible, et au-delà.
        const dx = target.x - hero.x
        const dz = target.z - hero.z
        const len = len2(dx, dz) || 1
        const ux = dx / len
        const uz = dz / len
        let hits = 0
        for (const m of this.monsters) {
          const rx = m.x - hero.x
          const rz = m.z - hero.z
          const along = rx * ux + rz * uz
          if (along < 0 || along > range) continue
          const perp = Math.abs(rx * uz - rz * ux)
          if (perp > 0.9) continue
          this.hurtMonster(hero, m, power, { heavy: true })
          this.applyStates(m, ab.applies)
          hits++
        }
        if (hits === 0) return
        this.emit({
          t: 'pierce', from: [hero.x, hero.z],
          to: [hero.x + ux * range, hero.z + uz * range], color: hero.cls.color,
        })
        break
      }
      case 'aoe':
      case 'selfAoe': {
        let cx = hero.x
        let cz = hero.z
        if (ab.kind === 'aoe') {
          const target = this.pickMonster(hero, range, pref)
          if (!target) return
          cx = target.x
          cz = target.z
        } else if (!this.pickMonster(hero, ab.radius, pref, false)) return
        commit()
        const radius = ab.radius * (hero.mult.range ?? 1)
        for (const m of this.monsters) {
          if (len2(m.x - cx, m.z - cz) > radius) continue
          this.hurtMonster(hero, m, power, { heavy: ab.heavy })
          this.applyStates(m, ab.applies)
        }
        this.emit({ t: 'aoe', at: [cx, cz], r: radius, color: hero.cls.color, seal: true, ability: ab.id })
        break
      }
      case 'heal': {
        const target = this.pickAlly(hero, range, Math.max(pref, 0.5))
        if (!target || target.hp >= target.maxHp - 1) return
        commit()
        const amount = Math.min(power || 50, target.maxHp - target.hp)
        target.hp += amount
        hero.healing += amount
        this.emit({ t: 'heal', to: [target.x, target.z] })
        break
      }
      case 'shieldAlly': {
        const target = this.pickAlly(hero, range, Math.max(pref, 0.5), false)
        if (!target) return
        commit()
        target.st.shield = STATES.shield.duration
        target.st.shieldAmount = ab.shield
        if (ab.pull) {
          const [nx, nz] = this.clampTarget(hero.x + (this.rng() - 0.5), hero.z + (this.rng() - 0.5))
          target.x = nx
          target.z = nz
        }
        this.emit({ t: 'shield', to: [target.x, target.z], color: hero.cls.color })
        break
      }
      case 'buffSelf': {
        commit()
        if (ab.buff === 'shield') {
          let amount = ab.shield
          if (ab.consumesSummons) {
            const mine = this.summons.filter((s) => s.owner === hero.slot)
            amount += mine.length * 25
            for (const s of mine) s.hp = 0
          }
          hero.st.shield = STATES.shield.duration
          hero.st.shieldAmount = amount
        } else {
          hero.st[ab.buff] = STATES[ab.buff].duration
        }
        if (ab.selfDamage) this.rawDamage(hero, hero.maxHp * ab.selfDamage, true, 'rage')
        if (ab.extra === 'frenzy') hero.st.haste = STATES.haste.duration
        this.emit({ t: 'buff', to: [hero.x, hero.z], color: hero.cls.color })
        break
      }
      case 'buffTeam': {
        commit()
        for (const h of this.heroes) {
          if (!h.alive || len2(h.x - hero.x, h.z - hero.z) > range) continue
          h.st[ab.buff] = STATES[ab.buff].duration
        }
        this.emit({ t: 'aoe', at: [hero.x, hero.z], r: range * 0.4, color: hero.cls.color, seal: true })
        break
      }
      case 'zone': {
        let cx = hero.x
        let cz = hero.z
        if (!ab.allies) {
          const target = this.pickMonster(hero, range, pref)
          if (!target) return
          cx = target.x
          cz = target.z
        }
        commit()
        this.zones.push({
          id: this.nextId++, x: cx, z: cz, radius: ab.radius,
          life: ab.duration, applies: ab.applies, damage: ab.damage ?? 0,
          allies: !!ab.allies, owner: hero.slot, color: hero.cls.color, tick: 0,
        })
        this.emit({ t: 'zone', at: [cx, cz], r: ab.radius, color: hero.cls.color })
        break
      }
      case 'summon': {
        const mine = this.summons.filter((s) => s.owner === hero.slot && s.type === ab.summon)
        if (mine.length >= ab.max) return
        commit()
        this.spawnSummon(hero, ab.summon)
        hero.stats.summoned++
        break
      }
      case 'raise': {
        const near = this.corpses.filter((c) => len2(c.x - hero.x, c.z - hero.z) <= range)
        if (near.length === 0) return
        const mine = this.summons.filter((s) => s.owner === hero.slot)
        const room = ab.max - mine.length
        if (room <= 0) return
        commit()
        for (const c of near.slice(0, room)) {
          this.spawnSummon(hero, ab.summon, [c.x, c.z])
          c.life = 0
          hero.stats.summoned++
        }
        this.emit({ t: 'raise', at: [hero.x, hero.z] })
        break
      }
      case 'corpseBoom': {
        let best = null
        let bd = Infinity
        for (const c of this.corpses) {
          const d = len2(c.x - hero.x, c.z - hero.z)
          if (d > range || d >= bd) continue
          bd = d
          best = c
        }
        if (!best) return
        commit()
        for (const m of this.monsters) {
          if (len2(m.x - best.x, m.z - best.z) > ab.radius) continue
          this.hurtMonster(hero, m, power)
        }
        best.life = 0
        this.emit({ t: 'aoe', at: [best.x, best.z], r: ab.radius, color: hero.cls.color, seal: true })
        break
      }
      case 'wall': {
        const target = this.pickMonster(hero, range, pref, false)
        if (!target) return
        commit()
        // Un segment perpendiculaire à la direction de la menace.
        const dx = target.x - hero.x
        const dz = target.z - hero.z
        const len = len2(dx, dz) || 1
        const px = -dz / len
        const pz = dx / len
        const midX = hero.x + (dx / len) * 2
        const midZ = hero.z + (dz / len) * 2
        let placed = 0
        for (let i = -Math.floor(ab.length / 2); i <= Math.floor(ab.length / 2); i++) {
          if (this.terrain.addTempWall(midX + px * i, midZ + pz * i, ab.duration)) placed++
        }
        if (placed) this.emit({ t: 'wall', at: [midX, midZ], dir: [px, pz], length: ab.length })
        break
      }
      case 'trap': {
        commit()
        this.terrain.traps.push({
          id: this.terrain.traps.length, x: hero.x + dirX * 2, z: hero.z + dirZ * 2,
          type: 'piege_agent', armed: 0, triggered: false,
          stats: { damage: ab.damage, applies: ab.applies, radius: 1.2, rearm: 3, visible: true },
        })
        this.emit({ t: 'trapPlaced', at: [hero.x + dirX * 2, hero.z + dirZ * 2] })
        break
      }
      case 'taunt': {
        let taunted = 0
        for (const m of this.monsters) {
          if (len2(m.x - hero.x, m.z - hero.z) > range) continue
          m.taunt = { hero, t: ab.duration }
          taunted++
        }
        if (!taunted) return
        commit()
        this.emit({ t: 'taunt', at: [hero.x, hero.z], r: range })
        break
      }
      case 'charge': {
        const target = this.pickMonster(hero, range, pref, false)
        if (!target) return
        commit()
        const dx = target.x - hero.x
        const dz = target.z - hero.z
        const len = len2(dx, dz) || 1
        const from = [hero.x, hero.z]
        this.terrain.move(hero, (dx / len) * (len - 1.2), (dz / len) * (len - 1.2))
        // Renverse tout ce qui se trouvait sur le trajet.
        for (const m of this.monsters) {
          const rx = m.x - from[0]
          const rz = m.z - from[1]
          const along = (rx * dx + rz * dz) / len
          if (along < 0 || along > len) continue
          if (Math.abs(rx * (dz / len) - rz * (dx / len)) > 1.1) continue
          this.hurtMonster(hero, m, power, { heavy: true })
          this.applyStates(m, ab.applies)
        }
        this.emit({ t: 'charge', from, to: [hero.x, hero.z], color: hero.cls.color })
        break
      }
      case 'dash':
      case 'blink': {
        commit()
        const from = [hero.x, hero.z]
        if (ab.kind === 'blink') {
          // Traverse les murs : téléportation pure.
          const [nx, nz] = this.clampTarget(hero.x + dirX * ab.distance, hero.z + dirZ * ab.distance)
          hero.x = nx
          hero.z = nz
        } else {
          this.terrain.move(hero, dirX * ab.distance, dirZ * ab.distance)
        }
        this.applyStates(hero, ab.applies)
        if (ab.blessAlly) {
          const ally = this.pickAlly(hero, 6, 1, false)
          if (ally) ally.st.intangible = Math.max(ally.st.intangible, 0.8)
        }
        this.emit({ t: ab.kind, from, to: [hero.x, hero.z], color: hero.cls.color })
        break
      }
      case 'swap': {
        const mine = this.summons.filter((s) => s.owner === hero.slot && s.hp > 0)
        if (!mine.length) return
        commit()
        const s = mine[Math.floor(this.rng() * mine.length)]
        const hx = hero.x
        const hz = hero.z
        hero.x = s.x
        hero.z = s.z
        s.x = hx
        s.z = hz
        this.applyStates(hero, ab.applies)
        this.emit({ t: 'swap', from: [hx, hz], to: [hero.x, hero.z], color: hero.cls.color })
        break
      }
      case 'seal': {
        let best = null
        let bd = Infinity
        for (const p of this.terrain.portals) {
          if (p.sealed > 0) continue
          const d = len2(p.x - hero.x, p.z - hero.z)
          if (d > range || d >= bd) continue
          bd = d
          best = p
        }
        if (!best) return
        commit()
        best.sealed = ab.duration
        this.emit({ t: 'seal', at: [best.x, best.z] })
        break
      }
    }
  }

  spawnSummon(hero, type, at = null) {
    const spec = SUMMONS[type]
    const [x, z] = at ?? [hero.x + (this.rng() - 0.5) * 2, hero.z + (this.rng() - 0.5) * 2]
    this.summons.push({
      id: this.nextId++, type, owner: hero.slot, spec,
      x, z, hp: spec.hp, maxHp: spec.hp, life: spec.life,
      cd: 0.5, st: freshStates(), size: spec.size,
    })
    this.emit({ t: 'summon', at: [x, z], color: spec.color })
  }

  // ─────────────────────────── MONSTRES ───────────────────────────

  stepMonster(m, dt) {
    this.tickStates(m, dt, false)
    if (m.hp <= 0) return
    m.cd -= dt
    if (m.taunt) {
      m.taunt.t -= dt
      if (m.taunt.t <= 0 || !m.taunt.hero.alive) m.taunt = null
    }
    if (m.stats.regen && m.st.burn <= 0) m.hp = Math.min(m.maxHp, m.hp + m.stats.regen * dt)
    if (m.st.stun > 0 || m.st.freeze > 0) return
    if (!m.stats.flying) this.checkTraps(m, false)

    // Cible : provocation d'abord, puis le plus proche (ou le plus blessé
    // pour les chasseurs de meute).
    let target = m.taunt?.hero ?? null
    if (!target) {
      let bd = Infinity
      const candidates = [...this.heroes.filter((h) => h.alive), ...this.summons.filter((s) => s.hp > 0)]
      for (const h of candidates) {
        const d = len2(h.x - m.x, h.z - m.z)
        const score = m.stats.packHunt ? d * 0.4 + (h.hp / h.maxHp) * 18 : d
        if (score < bd) {
          bd = score
          target = h
        }
      }
    }
    if (!target) return

    const dist = len2(target.x - m.x, target.z - m.z)
    let speed = m.stats.speed
    if (m.st.slow > 0) speed *= STATES.slow.speedMult
    if (m.st.terror > 0) speed *= 1.2

    // Terreur : fuit au lieu d'attaquer.
    if (m.st.terror > 0) {
      const dx = m.x - target.x
      const dz = m.z - target.z
      const l = len2(dx, dz) || 1
      this.moveMonster(m, (dx / l) * speed * dt, (dz / l) * speed * dt)
      return
    }

    // La liche lance des sorts à distance.
    if (m.stats.ai === 'caster') {
      m.spellCd -= dt
      if (m.spellCd <= 0 && dist < m.stats.range) {
        m.spellCd = m.stats.cooldown * 2.4
        if (m.stats.summons && this.rng() < 0.4) {
          this.spawnMonster(m.stats.summons, { at: [m.x + (this.rng() - 0.5) * 3, m.z + (this.rng() - 0.5) * 3] })
          this.emit({ t: 'raise', at: [m.x, m.z] })
        } else {
          const spell = m.stats.spells[Math.floor(this.rng() * m.stats.spells.length)]
          for (const h of this.heroes) {
            if (!h.alive) continue
            if (spell.radius > 0 && len2(h.x - target.x, h.z - target.z) > spell.radius) continue
            if (spell.radius === 0 && h !== target) continue
            this.hurtHero(m, h, m.dmg * 0.8 + spell.power)
            this.applyStates(h, spell.applies)
          }
          this.emit({ t: 'aoe', at: [target.x, target.z], r: spell.radius || 1.2, color: '#8a6ec9' })
        }
        return
      }
    }

    // L'araignée pose des toiles.
    if (m.stats.webs) {
      m.webCd -= dt
      if (m.webCd <= 0 && dist < 6) {
        m.webCd = 7
        this.zones.push({
          id: this.nextId++, x: m.x, z: m.z, radius: 2.0, life: 6,
          applies: { slow: 1 }, damage: 0, allies: false, hostile: true,
          color: '#9a9a86', tick: 0,
        })
        this.emit({ t: 'zone', at: [m.x, m.z], r: 2.0, color: '#9a9a86' })
      }
    }

    // Le golem brise les murs temporaires devant lui.
    if (m.stats.breaksWalls) {
      const c = this.terrain.cellOf(m.x + (target.x - m.x) * 0.15, m.z + (target.z - m.z) * 0.15)
      if (c >= 0 && this.terrain.temp.has(c)) this.terrain.temp.delete(c)
    }

    const isRanged = m.stats.ai === 'ranged' || m.stats.ai === 'caster'
    if (isRanged && dist < m.stats.range * 0.55) {
      const dx = m.x - target.x
      const dz = m.z - target.z
      const l = len2(dx, dz) || 1
      this.moveMonster(m, (dx / l) * speed * dt, (dz / l) * speed * dt)
    } else if (dist > m.stats.range) {
      const enrage = 1 + Math.max(0, this.floorTime - FLOOR_TIME_LIMIT(this.floor) * 0.7) * 0.05
      const dx = target.x - m.x
      const dz = target.z - m.z
      this.moveMonster(m, (dx / dist) * speed * enrage * dt, (dz / dist) * speed * enrage * dt)
    } else if (m.cd <= 0) {
      m.cd = m.stats.cooldown
      const isHero = target.slot !== undefined && target.cls !== undefined
      if (isHero) {
        this.hurtHero(m, target, m.dmg)
        this.applyStates(target, m.stats.applies)
      } else {
        target.hp -= m.dmg
      }
      if (m.stats.drain) {
        m.hp = Math.min(m.maxHp, m.hp + m.dmg * m.stats.drain)
      }
      if (m.stats.hitAndRun) {
        const dx = m.x - target.x
        const dz = m.z - target.z
        const l = len2(dx, dz) || 1
        this.moveMonster(m, (dx / l) * 2, (dz / l) * 2)
      }
      this.emit({ t: 'bite', to: [target.x, target.z] })
    }
  }

  moveMonster(m, dx, dz) {
    // Les spectres traversent les murs, les autres non.
    if (m.stats.phasing || m.stats.flying) {
      m.x = Math.max(-HALF + 1, Math.min(HALF - 1, m.x + dx))
      m.z = Math.max(-HALF + 1, Math.min(HALF - 1, m.z + dz))
    } else {
      this.terrain.move(m, dx, dz, 0.4)
    }
    m.movedThisTick = true
  }

  stepSummon(s, dt) {
    this.tickStates(s, dt, false)
    s.life -= dt
    if (s.hp <= 0 || s.life <= 0) return
    s.cd -= dt
    let target = null
    let bd = Infinity
    for (const m of this.monsters) {
      const d = len2(m.x - s.x, m.z - s.z)
      if (d < bd) {
        bd = d
        target = m
      }
    }
    if (!target) return
    if (bd > s.spec.range) {
      const dx = target.x - s.x
      const dz = target.z - s.z
      this.terrain.move(s, (dx / bd) * s.spec.speed * dt, (dz / bd) * s.spec.speed * dt, 0.35)
    } else if (s.cd <= 0) {
      s.cd = s.spec.cooldown
      this.hurtMonster(null, target, s.spec.dmg)
      this.applyStates(target, s.spec.applies)
      if (s.spec.taunts) target.taunt = { hero: s, t: 2 }
      this.emit({ t: 'slash', from: [s.x, s.z], to: [target.x, target.z], color: s.spec.color })
    }
  }

  stepZones(dt) {
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i]
      z.life -= dt
      z.tick -= dt
      if (z.tick <= 0) {
        z.tick = 0.5
        if (z.allies) {
          for (const h of this.heroes) {
            if (!h.alive || len2(h.x - z.x, h.z - z.z) > z.radius) continue
            this.applyStates(h, z.applies)
          }
        } else {
          for (const m of this.monsters) {
            if (len2(m.x - z.x, m.z - z.z) > z.radius) continue
            if (z.damage) this.hurtMonster(null, m, z.damage)
            this.applyStates(m, z.applies)
          }
          if (z.hostile) {
            for (const h of this.heroes) {
              if (!h.alive || len2(h.x - z.x, h.z - z.z) > z.radius) continue
              this.applyStates(h, z.applies)
            }
          }
        }
      }
      if (z.life <= 0) this.zones.splice(i, 1)
    }
  }

  // Électrifié se propage d'un ennemi au suivant.
  spreadShock() {
    for (const m of this.monsters) {
      if (m.st.shock <= 0 || m.shockSpread) continue
      m.shockSpread = true
      const chains = m.st.freeze > 0 ? INTERACTIONS.shockChainOnFrozen : 1
      let done = 0
      for (const o of this.monsters) {
        if (done >= chains) break
        if (o === m || o.st.shock > 0) continue
        if (len2(o.x - m.x, o.z - m.z) > INTERACTIONS.shockChainRange) continue
        o.st.shock = STATES.shock.duration * 0.7
        this.emit({ t: 'chain', from: [m.x, m.z], to: [o.x, o.z] })
        done++
      }
    }
  }

  // ─────────────────────────── BOUCLE ───────────────────────────

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
    this.terrain.update(dt)
    this.stepPortals(dt)

    for (const h of this.heroes) this.stepHero(h, dt)
    for (const m of this.monsters) this.stepMonster(m, dt)
    for (const s of this.summons) this.stepSummon(s, dt)
    this.stepZones(dt)
    this.spreadShock()

    for (let i = this.monsters.length - 1; i >= 0; i--) {
      if (this.monsters[i].hp <= 0) this.killMonster(this.monsters[i], i)
    }
    for (let i = this.summons.length - 1; i >= 0; i--) {
      const s = this.summons[i]
      if (s.hp <= 0 || s.life <= 0) {
        this.emit({ t: 'summonDie', at: [s.x, s.z] })
        this.summons.splice(i, 1)
      }
    }
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      this.corpses[i].life -= dt
      if (this.corpses[i].life <= 0) this.corpses.splice(i, 1)
    }

    if (this.heroes.every((h) => !h.alive)) {
      this.end('mort')
      return
    }
    if (this.floorCleared()) {
      this.clearFloor()
      return
    }
    if (this.floorTime > FLOOR_TIME_LIMIT(this.floor)) {
      this.end('enlisement')
    }
  }

  snapshot() {
    return {
      floor: this.floor,
      time: this.time,
      restsLeft: this.restsLeft,
      heroes: this.heroes.map((h) => ({
        x: h.x, z: h.z, hp: h.hp / h.maxHp, mana: h.mana / h.maxMana,
        alive: h.alive, classIndex: h.classIndex,
      })),
      monsters: this.monsters.map((m) => ({
        x: m.x, z: m.z, hp: m.hp / m.maxHp, size: m.size, boss: m.boss,
      })),
    }
  }
}

// ─────────────────────────── AIDES ───────────────────────────

function clone(ability) {
  return { ...ability, applies: ability.applies ? { ...ability.applies } : undefined }
}

function baseMult() {
  return {
    hp: 1, mana: 1, speed: 1, cooldown: 1, range: 1, ability: 1, afflictionDuration: 1,
  }
}

// Encodage d'une carte pour que le réseau puisse la JUGER — sans qu'on lui
// apprenne laquelle est bonne.
//
// La version précédente résumait chaque carte à deux scores flous
// (offense, défense). Conséquence mesurée : les dix passifs se réduisaient
// à trois signatures seulement, donc « Célérité » et « Concentration »
// étaient littéralement indiscernables et le choix se faisait sur la
// position dans la liste. Les fréquences de prise étaient plates à 4 %
// chacune — le draft ne draftait rien.
//
// Chaque carte est désormais projetée sur les axes de jeu qu'elle
// modifie réellement. Les renforts partagent ces axes avec les passifs :
// « Ampleur » et « Allonge » agissent tous deux sur la portée utile, et
// le réseau peut l'apprendre au lieu de le deviner.
const EFFECT_AXES = [
  'vitesse', 'recharge', 'pv', 'mana', 'vampirisme',
  'esquive', 'portee', 'resilience', 'curee', 'antiRalentissement',
]
export const CARD_EFFECTS = EFFECT_AXES.length

// Familles de capacité : 21 natures distinctes, mais seules six comptent
// pour décider si l'on prend la carte.
const ABILITY_FAMILIES = [
  ['bolt', 'melee', 'pierce'],                   // dégâts directs
  ['aoe', 'selfAoe', 'zone', 'corpseBoom'],      // zone
  ['heal', 'shieldAlly', 'buffSelf', 'buffTeam'],// soutien
  ['wall', 'taunt', 'trap', 'seal'],             // contrôle et terrain
  ['dash', 'blink', 'charge', 'swap'],           // mobilité
  ['summon', 'raise'],                           // invocation
]
export const CARD_FAMILIES = ABILITY_FAMILIES.length

// Un axe par passif, plus les renforts qui retombent sur les mêmes axes.
const PASSIVE_AXIS = {
  celerite: 0, vivacite: 1, endurance: 2, concentration: 3, vampirisme: 4,
  esquive: 5, allonge: 6, resilience: 7, curee: 8, pas_assure: 9,
}
const REINFORCE_AXIS = { promptitude: 1, economie: 3, portee_sort: 6, ampleur: 6, puissance: 8 }

export const CARD_STRIDE = 3 + CARD_EFFECTS + CARD_FAMILIES + 2

// Écrit CARD_STRIDE valeurs dans obs à partir de k, renvoie le nouveau k.
function writeCard(obs, k, card) {
  const start = k
  for (let i = 0; i < CARD_STRIDE; i++) obs[k + i] = 0
  if (!card) return start + CARD_STRIDE

  // Type de carte
  obs[k + (card.kind === 'ability' ? 0 : card.kind === 'passive' ? 1 : 2)] = 1
  k += 3

  // Axes d'effet
  if (card.kind === 'passive') {
    const a = PASSIVE_AXIS[card.passive.id]
    if (a !== undefined) obs[k + a] = 1
  } else if (card.kind === 'reinforce') {
    const a = REINFORCE_AXIS[card.reinf.id]
    if (a !== undefined) obs[k + a] = 1
  }
  k += CARD_EFFECTS

  // Famille de capacité
  if (card.kind === 'ability') {
    const f = ABILITY_FAMILIES.findIndex((fam) => fam.includes(card.ability.kind))
    if (f >= 0) obs[k + f] = 1
  }
  k += CARD_FAMILIES

  // Deux échelles continues : ce que la carte coûte et ce qu'elle frappe.
  const ab = card.kind === 'ability' ? card.ability : card.kind === 'reinforce' ? card.target : null
  obs[k++] = ab ? Math.min((ab.power ?? 0) / 90, 1) : 0
  obs[k++] = ab ? Math.min((ab.cost ?? 0) / 60, 1) : 0
  return k
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
