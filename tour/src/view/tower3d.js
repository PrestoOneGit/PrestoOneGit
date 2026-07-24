import * as THREE from 'three'
import { ARENA_RADIUS } from '../sim/engine.js'
import { CLASSES, tierForFloor } from '../sim/data.js'

const STONE = '#8a8276'
const STONE_DARK = '#6e675c'

// Niveaux de qualité — purement visuels. Le rendu se fait sur le fil
// principal + GPU, l'évolution dans les Web Workers : changer de qualité
// ne change RIEN à la vitesse d'apprentissage. Et sur les milliers de
// runs simulés, un seul est rendu (le rejeu).
export const QUALITY_LEVELS = [
  { id: 'capsules', label: 'Capsules', shadows: false, lathe: false, emblems: false, hitFx: false, seals: false },
  { id: 'pions', label: 'Pions', shadows: true, lathe: true, emblems: true, hitFx: false, seals: true },
  { id: 'deluxe', label: 'Deluxe', shadows: true, lathe: true, emblems: true, hitFx: true, seals: true },
]

// Profil tourné d'une pièce de jeu (socle, fût, collerette, tête).
// LatheGeometry le fait pivoter autour de Y : x = rayon, y = hauteur.
const PION_PROFILE = [
  [0.0, 0.0], [0.4, 0.0], [0.42, 0.06], [0.34, 0.12], [0.26, 0.18],
  [0.17, 0.3], [0.15, 0.52], [0.23, 0.62], [0.24, 0.68], [0.15, 0.74],
  [0.24, 0.86], [0.27, 0.98], [0.2, 1.1], [0.0, 1.18],
]

// Les monstres sont des pions plus trapus et plus larges d'épaules.
const MONSTER_PROFILE = [
  [0.0, 0.0], [0.46, 0.0], [0.48, 0.08], [0.36, 0.16], [0.28, 0.26],
  [0.34, 0.44], [0.41, 0.6], [0.35, 0.74], [0.2, 0.86], [0.0, 0.94],
]

function latheGeometry(profile, segments) {
  return new THREE.LatheGeometry(
    profile.map(([x, y]) => new THREE.Vector2(x, y)),
    segments
  )
}

// Vue 3D de l'étage courant. Les entités sont reconstruites à chaque
// changement de qualité — comme un réglage graphique de jeu vidéo.
export class Tower3D {
  constructor(scene, quality = 'pions') {
    this.scene = scene
    this.group = new THREE.Group()
    this.heroMeshes = []
    this.monsterMeshes = new Map()
    this.vfx = []
    this.run = null
    this.quality = QUALITY_LEVELS.find((q) => q.id === quality) ?? QUALITY_LEVELS[1]
    this.geoCache = new Map()
    scene.add(this.group)
    this.buildStage()
  }

  geo(key, build) {
    if (!this.geoCache.has(key)) this.geoCache.set(key, build())
    return this.geoCache.get(key)
  }

  setQuality(id) {
    const level = QUALITY_LEVELS.find((q) => q.id === id)
    if (!level || level === this.quality) return
    this.quality = level
    // Les géométries dépendent du niveau : on repart d'un cache propre.
    for (const g of this.geoCache.values()) g.dispose()
    this.geoCache.clear()
    if (this.run) this.attach(this.run)
  }

  buildStage() {
    const flat = (color) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 1 })

    this.floorMat = flat('#dbc394')
    const floor = new THREE.Mesh(
      new THREE.CylinderGeometry(ARENA_RADIUS + 1.5, ARENA_RADIUS + 2.5, 1.2, 24),
      this.floorMat
    )
    floor.position.y = -0.6
    floor.receiveShadow = true
    this.group.add(floor)

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(ARENA_RADIUS - 0.5, 0.09, 4, 44),
      flat('#a89574')
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.02
    this.group.add(ring)

    const segs = 22
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2
      const h = 1.6 + Math.sin(i * 5.1) * 0.4
      const block = new THREE.Mesh(new THREE.BoxGeometry(3.6, h, 1.5), flat(i % 3 ? STONE : STONE_DARK))
      const r = ARENA_RADIUS + 3.2
      block.position.set(Math.cos(a) * r, h / 2 - 0.1, Math.sin(a) * r)
      block.rotation.y = -a
      block.castShadow = true
      block.receiveShadow = true
      this.group.add(block)
    }

    this.flames = []
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4
      const r = ARENA_RADIUS + 2
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 3.6, 6), flat(STONE_DARK))
      pillar.position.set(Math.cos(a) * r, 1.8, Math.sin(a) * r)
      pillar.castShadow = true
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.38, 0.8, 6),
        new THREE.MeshStandardMaterial({
          color: '#ff9a3c',
          emissive: '#ff7a1c',
          emissiveIntensity: 1.6,
          flatShading: true,
        })
      )
      flame.position.set(Math.cos(a) * r, 4.0, Math.sin(a) * r)
      flame.userData.flicker = Math.random() * Math.PI * 2
      this.flames.push(flame)
      this.group.add(pillar, flame)
    }
  }

  makeBar(width, y, color) {
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(width, 0.08, 0.08),
      new THREE.MeshBasicMaterial({ color })
    )
    bar.position.y = y
    return bar
  }

  // Emblème posé sur la tête du pion : signature visuelle de la classe.
  makeEmblem(classId, mat) {
    const metal = new THREE.MeshStandardMaterial({
      color: '#d8d2c4', flatShading: true, roughness: 0.45, metalness: 0.2,
    })
    const g = new THREE.Group()
    switch (classId) {
      case 'chevalier': {
        // Couronne crénelée
        const ring = new THREE.Mesh(this.geo('crown', () => new THREE.CylinderGeometry(0.19, 0.21, 0.1, 8)), metal)
        ring.position.y = 1.22
        g.add(ring)
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2
          const spike = new THREE.Mesh(this.geo('crownSpike', () => new THREE.ConeGeometry(0.05, 0.14, 4)), metal)
          spike.position.set(Math.cos(a) * 0.16, 1.33, Math.sin(a) * 0.16)
          g.add(spike)
        }
        break
      }
      case 'berserker': {
        // Deux cornes
        for (const side of [-1, 1]) {
          const horn = new THREE.Mesh(this.geo('horn', () => new THREE.ConeGeometry(0.07, 0.32, 5)), metal)
          horn.position.set(side * 0.15, 1.3, 0)
          horn.rotation.z = side * 0.5
          g.add(horn)
        }
        break
      }
      case 'archere': {
        // Arc dressé
        const bow = new THREE.Mesh(
          this.geo('bow', () => new THREE.TorusGeometry(0.22, 0.035, 4, 12, Math.PI * 1.2)),
          new THREE.MeshStandardMaterial({ color: '#8a5a3b', flatShading: true, roughness: 1 })
        )
        bow.position.y = 1.32
        bow.rotation.y = Math.PI / 2
        bow.rotation.z = -0.3
        g.add(bow)
        break
      }
      case 'mage': {
        // Chapeau pointu
        const hat = new THREE.Mesh(this.geo('hat', () => new THREE.ConeGeometry(0.24, 0.46, 7)), mat)
        hat.position.y = 1.38
        g.add(hat)
        break
      }
      case 'clerc': {
        // Auréole
        const halo = new THREE.Mesh(
          this.geo('halo', () => new THREE.TorusGeometry(0.2, 0.035, 4, 14)),
          new THREE.MeshStandardMaterial({ color: '#ffe9a3', emissive: '#e8c96a', emissiveIntensity: 0.9, flatShading: true })
        )
        halo.rotation.x = Math.PI / 2
        halo.position.y = 1.34
        g.add(halo)
        break
      }
      case 'occultiste': {
        // Orbe flottante
        const orb = new THREE.Mesh(
          this.geo('orb', () => new THREE.IcosahedronGeometry(0.13, 0)),
          new THREE.MeshStandardMaterial({ color: '#b78fe0', emissive: '#7a5f9e', emissiveIntensity: 1.1, flatShading: true })
        )
        orb.position.y = 1.36
        g.add(orb)
        g.userData.floating = orb
        break
      }
    }
    return g
  }

  makeHeroMesh(hero) {
    const color = new THREE.Color(hero.cls.color)
    const q = this.quality
    const mat = new THREE.MeshStandardMaterial({
      color,
      flatShading: true,
      roughness: q.lathe ? 0.55 : 0.75,
      metalness: q.lathe ? 0.15 : 0,
      emissive: color,
      emissiveIntensity: q.id === 'deluxe' ? 0.18 : 0.12,
    })
    const g = new THREE.Group()

    let body
    if (q.lathe) {
      body = new THREE.Mesh(this.geo('pion', () => latheGeometry(PION_PROFILE, 12)), mat)
      // Socle sombre : le pion se détache du sol
      const base = new THREE.Mesh(
        this.geo('pionBase', () => new THREE.CylinderGeometry(0.44, 0.5, 0.07, 12)),
        new THREE.MeshStandardMaterial({ color: '#3a332c', flatShading: true, roughness: 0.9 })
      )
      base.position.y = 0.035
      g.add(base)
    } else {
      body = new THREE.Mesh(this.geo('capsule', () => new THREE.CapsuleGeometry(0.34, 0.75, 3, 8)), mat)
      body.position.y = 0.72
    }
    body.castShadow = q.shadows
    g.add(body)

    let emblem = null
    if (q.emblems) {
      emblem = this.makeEmblem(hero.cls.id, mat)
      g.add(emblem)
    }

    const hpBar = this.makeBar(0.9, q.lathe ? 1.85 : 1.78, '#57c46a')
    const manaBar = this.makeBar(0.9, q.lathe ? 1.69 : 1.62, '#5d93d4')
    g.add(hpBar, manaBar)
    g.userData = { hpBar, manaBar, mat, body, emblem, baseColor: color.clone(), lunge: 0, lungeDir: [0, 0], flash: 0 }
    return g
  }

  makeMonsterMesh(m) {
    const q = this.quality
    const color = m.boss ? '#7a3c3c' : m.elite ? '#8f6e3c' : '#6e8557'
    const mat = new THREE.MeshStandardMaterial({
      color, flatShading: true, roughness: 0.9, metalness: q.lathe ? 0.1 : 0,
    })
    const g = new THREE.Group()
    const s = m.size

    let body
    if (q.lathe) {
      body = new THREE.Mesh(this.geo('mpion', () => latheGeometry(MONSTER_PROFILE, 9)), mat)
      body.scale.setScalar(0.85 + s * 0.55)
    } else {
      body = new THREE.Mesh(
        this.geo(`mcap${s.toFixed(2)}`, () => new THREE.CapsuleGeometry(0.3 * (0.9 + s), 0.4 * (0.7 + s), 3, 7)),
        mat
      )
      body.position.y = 0.55 * (0.7 + s)
    }
    body.castShadow = q.shadows
    g.add(body)

    if (m.boss || m.elite) {
      const crown = new THREE.Mesh(
        this.geo('mcrown', () => new THREE.ConeGeometry(0.16, 0.3, 5)),
        new THREE.MeshStandardMaterial({ color: '#e8c96a', emissive: '#a8873c', flatShading: true })
      )
      crown.position.y = (q.lathe ? 0.95 : 1.2) * s + 0.75
      g.add(crown)
    }

    const hpBar = this.makeBar(0.8 * (0.7 + s * 0.5), (q.lathe ? 1.05 : 1.2) * s + 0.95, '#d1584a')
    g.add(hpBar)
    g.userData = { hpBar, mat, body, baseColor: new THREE.Color(color), lunge: 0, lungeDir: [0, 0], flash: 0 }
    return g
  }

  attach(run) {
    for (const m of this.heroMeshes) this.group.remove(m)
    for (const [, m] of this.monsterMeshes) this.group.remove(m)
    for (const v of this.vfx) this.group.remove(v.mesh)
    this.heroMeshes = []
    this.monsterMeshes.clear()
    this.vfx = []
    this.run = run
    for (const hero of run.heroes) {
      const mesh = this.makeHeroMesh(hero)
      this.heroMeshes.push(mesh)
      this.group.add(mesh)
    }
  }

  // ---- Réactions aux coups (qualité Deluxe) ----
  // Le moteur reste intact : on retrouve les entités touchées par leur
  // position dans les événements, côté vue uniquement.

  nearestMesh(list, x, z, maxDist = 1.4) {
    let best = null
    let bestD = maxDist * maxDist
    for (const { mesh, ex, ez } of list) {
      const d = (ex - x) ** 2 + (ez - z) ** 2
      if (d < bestD) {
        bestD = d
        best = mesh
      }
    }
    return best
  }

  entityIndex() {
    const heroes = this.run.heroes
      .map((h, i) => ({ mesh: this.heroMeshes[i], ex: h.x, ez: h.z }))
      .filter((e) => e.mesh)
    const monsters = []
    for (const m of this.run.monsters) {
      const mesh = this.monsterMeshes.get(m.id)
      if (mesh) monsters.push({ mesh, ex: m.x, ez: m.z })
    }
    return { heroes, monsters }
  }

  reactToHits() {
    if (!this.quality.hitFx) return
    const { heroes, monsters } = this.entityIndex()

    const lunge = (mesh, from, to) => {
      if (!mesh) return
      const dx = to[0] - from[0]
      const dz = to[1] - from[1]
      const d = Math.hypot(dx, dz) || 1
      mesh.userData.lunge = 1
      mesh.userData.lungeDir = [dx / d, dz / d]
    }
    const flash = (mesh) => {
      if (mesh) mesh.userData.flash = 1
    }

    for (const ev of this.run.events) {
      switch (ev.t) {
        case 'slash':
        case 'arrow':
        case 'cast':
          if (ev.from) lunge(this.nearestMesh(heroes, ev.from[0], ev.from[1]), ev.from, ev.to)
          flash(this.nearestMesh(monsters, ev.to[0], ev.to[1]))
          break
        case 'drain':
          flash(this.nearestMesh(monsters, ev.from[0], ev.from[1]))
          break
        case 'bite':
          flash(this.nearestMesh(heroes, ev.to[0], ev.to[1]))
          break
        case 'slam':
          for (const e of heroes) {
            if (Math.hypot(e.ex - ev.at[0], e.ez - ev.at[1]) <= ev.r) flash(e.mesh)
          }
          break
        case 'aoe': {
          // Zone rouge = attaque de monstre sur les héros ; zone verte =
          // soin (pas de flash) ; sinon zone de héros sur les monstres.
          if (ev.color === '#8fe89a') break
          const targets = ev.color === '#d1584a' ? heroes : monsters
          for (const e of targets) {
            if (Math.hypot(e.ex - ev.at[0], e.ez - ev.at[1]) <= ev.r) flash(e.mesh)
          }
          break
        }
      }
    }
  }

  animateReaction(mesh, dt) {
    const u = mesh.userData
    if (!this.quality.hitFx) return [0, 0]
    let offX = 0
    let offZ = 0
    if (u.lunge > 0) {
      u.lunge = Math.max(0, u.lunge - dt * 5)
      // Aller-retour : pic à mi-parcours
      const p = Math.sin(u.lunge * Math.PI)
      offX = u.lungeDir[0] * p * 0.35
      offZ = u.lungeDir[1] * p * 0.35
    }
    if (u.flash > 0) {
      u.flash = Math.max(0, u.flash - dt * 4.5)
      u.mat.emissive.copy(u.baseColor).lerp(new THREE.Color('#ffffff'), u.flash * 0.9)
      u.mat.emissiveIntensity = 0.18 + u.flash * 1.4
      if (u.body) u.body.scale.setScalar((u.bodyScale ?? 1) * (1 + u.flash * 0.12))
    } else if (u.mat.emissiveIntensity !== 0.18) {
      u.mat.emissive.copy(u.baseColor)
      u.mat.emissiveIntensity = 0.18
      if (u.body) u.body.scale.setScalar(u.bodyScale ?? 1)
    }
    return [offX, offZ]
  }

  // Sceau magique : deux anneaux concentriques, des marques radiales et
  // des glyphes — un cercle d'invocation qui se déploie au sol.
  makeSeal(radius, color) {
    const g = new THREE.Group()
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 })
    g.userData.materials = [mat]

    const outer = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 3, 40), mat)
    outer.rotation.x = -Math.PI / 2
    const inner = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.022, 3, 32), mat)
    inner.rotation.x = -Math.PI / 2
    g.add(outer, inner)

    // Marques radiales entre les deux anneaux
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      const tick = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.05), mat)
      tick.position.set(Math.cos(a) * 0.81, 0, Math.sin(a) * 0.81)
      tick.rotation.y = -a
      g.add(tick)
    }
    // Glyphes sur l'anneau extérieur
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3
      const glyph = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.09), mat)
      glyph.position.set(Math.cos(a) * 1.0, 0, Math.sin(a) * 1.0)
      glyph.rotation.y = a
      g.add(glyph)
    }
    // Triangle central
    const tri = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.02, 3, 3), mat)
    tri.rotation.x = -Math.PI / 2
    g.add(tri)

    g.scale.setScalar(radius)
    return g
  }

  spawnVfx(kind, from, to, { radius = 1, color = '#fff4dd' } = {}) {
    let mesh
    let life = 0.3
    const seg = this.quality.id === 'capsules' ? 12 : 20
    if (kind === 'arrow') {
      mesh = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.5, 4), new THREE.MeshBasicMaterial({ color: '#e8dcc0' }))
      life = 0.2
    } else if (kind === 'cast' || kind === 'drain') {
      mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 0), new THREE.MeshBasicMaterial({ color }))
      life = 0.22
    } else if (kind === 'seal') {
      mesh = this.makeSeal(radius, color)
      life = 0.85
    } else if (kind === 'dashTrail') {
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.06, 0.5),
        new THREE.MeshBasicMaterial({ color, transparent: true })
      )
      life = 0.35
    } else if (kind === 'aoe' || kind === 'taunt' || kind === 'slam') {
      mesh = new THREE.Mesh(
        new THREE.TorusGeometry(0.4, 0.07, 4, seg),
        new THREE.MeshBasicMaterial({
          color: kind === 'taunt' ? '#e8c96a' : kind === 'slam' ? '#d1584a' : color,
          transparent: true,
        })
      )
      mesh.rotation.x = -Math.PI / 2
      life = 0.45
    } else if (kind === 'heal' || kind === 'buff') {
      mesh = new THREE.Mesh(
        new THREE.TorusGeometry(0.3, 0.05, 4, 12),
        new THREE.MeshBasicMaterial({ color: kind === 'heal' ? '#8fe89a' : color, transparent: true })
      )
      mesh.rotation.x = -Math.PI / 2
      life = 0.5
    } else if (kind === 'die') {
      mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.4, 0),
        new THREE.MeshBasicMaterial({ color: '#c9c2b4', transparent: true })
      )
      life = 0.4
    } else {
      mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.13, 0),
        new THREE.MeshBasicMaterial({ color: kind === 'bite' ? '#d1584a' : '#fff4dd' })
      )
      life = 0.15
    }
    const grounded = kind === 'aoe' || kind === 'taunt' || kind === 'slam' || kind === 'seal' || kind === 'dashTrail'
    mesh.position.set(from[0], grounded ? 0.12 : 0.9, from[1])
    this.group.add(mesh)
    this.vfx.push({ mesh, kind, life, maxLife: life, from, to, radius })
  }

  update(dt, elapsed, camera) {
    if (!this.run) return
    const q = this.quality

    const tier = tierForFloor(Math.max(this.run.floor, 1))
    this.floorMat.color.lerp(new THREE.Color(tier.ambiance), 0.03)

    // Les monstres d'abord : reactToHits a besoin de leurs meshes.
    const seen = new Set()
    for (const m of this.run.monsters) {
      seen.add(m.id)
      let mesh = this.monsterMeshes.get(m.id)
      if (!mesh) {
        mesh = this.makeMonsterMesh(m)
        mesh.userData.bodyScale = mesh.userData.body.scale.x
        this.monsterMeshes.set(m.id, mesh)
        this.group.add(mesh)
      }
      const [ox, oz] = this.animateReaction(mesh, dt)
      mesh.position.set(m.x + ox, Math.abs(Math.sin(elapsed * 7 + m.id)) * 0.07, m.z + oz)
      mesh.userData.hpBar.scale.x = Math.max(m.hp / m.maxHp, 0.001)
      mesh.userData.hpBar.lookAt(camera.position)
      const target = this.run.heroes.find((h) => h.alive)
      if (target) mesh.lookAt(target.x, mesh.position.y, target.z)
    }
    for (const [id, mesh] of this.monsterMeshes) {
      if (!seen.has(id)) {
        this.group.remove(mesh)
        this.monsterMeshes.delete(id)
      }
    }

    this.reactToHits()

    this.run.heroes.forEach((hero, i) => {
      const mesh = this.heroMeshes[i]
      const [ox, oz] = this.animateReaction(mesh, dt)
      mesh.position.set(hero.x + ox, 0, hero.z + oz)
      const { hpBar, manaBar, mat, emblem } = mesh.userData
      const frac = Math.max(hero.hp / hero.maxHp, 0)
      hpBar.scale.x = Math.max(frac, 0.001)
      hpBar.material.color.set(frac > 0.5 ? '#57c46a' : frac > 0.25 ? '#e8b93c' : '#d1584a')
      manaBar.scale.x = Math.max(hero.mana / hero.maxMana, 0.001)
      hpBar.lookAt(camera.position)
      manaBar.lookAt(camera.position)
      if (emblem?.userData.floating) {
        emblem.userData.floating.position.y = 1.36 + Math.sin(elapsed * 2 + i) * 0.06
        emblem.userData.floating.rotation.y += dt * 1.5
      }
      if (!hero.alive) {
        mesh.rotation.z = Math.min(mesh.rotation.z + dt * 4, Math.PI / 2)
        mat.transparent = true
        mat.opacity = 0.5
      } else {
        mesh.rotation.z = hero.aff.stun > 0 ? Math.sin(elapsed * 30) * 0.15 : 0
        mat.opacity = 1
        // En plein bond, l'agent décolle réellement du sol.
        mesh.position.y =
          (hero.jumpHeight ?? 0) + Math.abs(Math.sin(elapsed * 8 + i)) * (q.lathe ? 0.04 : 0.06)
        // Le pion s'oriente vers le monstre le plus proche
        if (q.lathe && this.run.monsters.length > 0) {
          let bx = 0
          let bz = 0
          let bd = Infinity
          for (const m of this.run.monsters) {
            const d = (m.x - hero.x) ** 2 + (m.z - hero.z) ** 2
            if (d < bd) {
              bd = d
              bx = m.x
              bz = m.z
            }
          }
          mesh.rotation.y = Math.atan2(bx - hero.x, bz - hero.z)
        }
      }
    })

    for (const ev of this.run.events) {
      if (ev.t === 'arrow') this.spawnVfx('arrow', ev.from, ev.to)
      else if (ev.t === 'cast') this.spawnVfx('cast', ev.from, ev.to, { color: ev.color })
      else if (ev.t === 'drain') this.spawnVfx('drain', ev.from, ev.to, { color: '#7a5f9e' })
      else if (ev.t === 'aoe') {
        this.spawnVfx('aoe', ev.at, ev.at, { radius: ev.r, color: ev.color })
        // Les capacités de zone posent en plus un sceau runique au sol.
        if (ev.seal && q.seals) this.spawnVfx('seal', ev.at, ev.at, { radius: ev.r, color: ev.color })
      } else if (ev.t === 'taunt') this.spawnVfx('taunt', ev.at, ev.at, { radius: ev.r })
      else if (ev.t === 'slam') this.spawnVfx('slam', ev.at, ev.at, { radius: ev.r })
      else if (ev.t === 'heal') this.spawnVfx('heal', ev.to, ev.to)
      else if (ev.t === 'buff') {
        this.spawnVfx('buff', ev.to, ev.to, { color: ev.color })
        if (q.seals) this.spawnVfx('seal', ev.to, ev.to, { radius: 1.1, color: ev.color })
      } else if (ev.t === 'upgrade' && q.seals) {
        const h = this.run.heroes[ev.slot]
        this.spawnVfx('seal', [h.x, h.z], [h.x, h.z], { radius: 1.3, color: '#e8c96a' })
      } else if (ev.t === 'dash') {
        this.spawnVfx('dashTrail', ev.from, ev.to, { color: this.run.heroes[ev.slot]?.cls.color ?? '#fff' })
      } else if (ev.t === 'jump') {
        this.spawnVfx('dashTrail', ev.from, ev.from, { color: '#e8dcc0' })
      } else if (ev.t === 'monsterDie') this.spawnVfx('die', ev.at, ev.at)
      else if (ev.t === 'slash' || ev.t === 'bite') this.spawnVfx(ev.t, ev.to, ev.to)
    }

    for (let i = this.vfx.length - 1; i >= 0; i--) {
      const v = this.vfx[i]
      v.life -= dt
      const p = 1 - v.life / v.maxLife
      if (v.kind === 'arrow' || v.kind === 'cast' || v.kind === 'drain') {
        v.mesh.position.set(
          v.from[0] + (v.to[0] - v.from[0]) * p,
          0.9 + Math.sin(p * Math.PI) * 0.4,
          v.from[1] + (v.to[1] - v.from[1]) * p
        )
        if (v.kind === 'arrow') {
          v.mesh.lookAt(v.to[0], 0.9, v.to[1])
          v.mesh.rotateX(Math.PI / 2)
        }
      } else if (v.kind === 'seal') {
        // Le sceau se déploie puis tourne en s'effaçant
        const grow = Math.min(1, p * 4)
        v.mesh.scale.setScalar(v.radius * (0.2 + grow * 0.8))
        v.mesh.rotation.y = p * 1.2
        for (const mat of v.mesh.userData.materials) mat.opacity = 0.85 * (1 - p * p)
      } else if (v.kind === 'dashTrail') {
        v.mesh.position.set(
          v.from[0] + (v.to[0] - v.from[0]) * p,
          0.12,
          v.from[1] + (v.to[1] - v.from[1]) * p
        )
        v.mesh.material.opacity = 0.55 * (1 - p)
      } else if (v.kind === 'aoe' || v.kind === 'taunt' || v.kind === 'slam') {
        const s = 0.4 + p * v.radius * 2.2
        v.mesh.scale.set(s, s, 1)
        v.mesh.material.opacity = 0.9 * (1 - p)
      } else if (v.kind === 'heal' || v.kind === 'buff') {
        v.mesh.position.y = 0.2 + p * 1.4
        v.mesh.material.opacity = 1 - p
      } else if (v.kind === 'die') {
        v.mesh.scale.setScalar(1 + p * 1.6)
        v.mesh.material.opacity = 0.7 * (1 - p)
      } else {
        v.mesh.scale.setScalar(1 + p * 0.8)
      }
      if (v.life <= 0) {
        this.group.remove(v.mesh)
        // Un sceau est un groupe de plusieurs meshes, pas un mesh unique.
        v.mesh.traverse((o) => {
          if (o.geometry) o.geometry.dispose()
          if (o.material?.dispose) o.material.dispose()
        })
        this.vfx.splice(i, 1)
      }
    }

    for (const f of this.flames) {
      f.scale.y = 1 + Math.sin(elapsed * 9 + f.userData.flicker) * 0.25
    }
  }
}
