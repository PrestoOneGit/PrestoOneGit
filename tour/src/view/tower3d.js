import * as THREE from 'three'
import { ARENA_RADIUS } from '../sim/engine.js'
import { CLASSES, tierForFloor } from '../sim/data.js'

const STONE = '#8a8276'
const STONE_DARK = '#6e675c'

// Vue 3D minimale : des capsules colorées sur le plateau d'un étage de la
// tour. L'ambiance (couleur du sol, brouillard) change avec les paliers.
export class Tower3D {
  constructor(scene) {
    this.scene = scene
    this.group = new THREE.Group()
    this.heroMeshes = []
    this.monsterMeshes = new Map()
    this.vfx = []
    this.run = null
    scene.add(this.group)
    this.buildStage()
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

    // Muraille basse en blocs
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

    // Braseros
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

  makeHeroMesh(hero) {
    const color = new THREE.Color(hero.cls.color)
    const mat = new THREE.MeshStandardMaterial({
      color,
      flatShading: true,
      roughness: 0.75,
      emissive: color,
      emissiveIntensity: 0.12,
    })
    const g = new THREE.Group()
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.75, 3, 8), mat)
    body.position.y = 0.72
    body.castShadow = true
    g.add(body)
    const hpBar = this.makeBar(0.9, 1.78, '#57c46a')
    const manaBar = this.makeBar(0.9, 1.62, '#5d93d4')
    g.add(hpBar, manaBar)
    g.userData = { hpBar, manaBar, mat }
    return g
  }

  makeMonsterMesh(m) {
    const color = m.boss ? '#7a3c3c' : m.elite ? '#8f6e3c' : '#6e8557'
    const mat = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9 })
    const g = new THREE.Group()
    const s = m.size
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3 * (0.9 + s), 0.4 * (0.7 + s), 3, 7), mat)
    body.position.y = 0.55 * (0.7 + s)
    body.castShadow = true
    g.add(body)
    if (m.boss || m.elite) {
      const crown = new THREE.Mesh(
        new THREE.ConeGeometry(0.16, 0.3, 5),
        new THREE.MeshStandardMaterial({ color: '#e8c96a', emissive: '#a8873c', flatShading: true })
      )
      crown.position.y = 1.2 * s + 0.75
      g.add(crown)
    }
    const hpBar = this.makeBar(0.8 * (0.7 + s * 0.5), 1.2 * s + 0.95, '#d1584a')
    g.add(hpBar)
    g.userData = { hpBar }
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

  spawnVfx(kind, from, to, { radius = 1, color = '#fff4dd' } = {}) {
    let mesh
    let life = 0.3
    if (kind === 'arrow') {
      mesh = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.5, 4), new THREE.MeshBasicMaterial({ color: '#e8dcc0' }))
      life = 0.2
    } else if (kind === 'cast' || kind === 'drain') {
      mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 0), new THREE.MeshBasicMaterial({ color }))
      life = 0.22
    } else if (kind === 'aoe' || kind === 'taunt' || kind === 'slam') {
      mesh = new THREE.Mesh(
        new THREE.TorusGeometry(0.4, 0.07, 4, 20),
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
    mesh.position.set(from[0], kind === 'aoe' || kind === 'taunt' || kind === 'slam' ? 0.12 : 0.9, from[1])
    this.group.add(mesh)
    this.vfx.push({ mesh, kind, life, maxLife: life, from, to, radius })
  }

  update(dt, elapsed, camera) {
    if (!this.run) return

    // Ambiance du palier : le sol se teinte avec la profondeur
    const tier = tierForFloor(Math.max(this.run.floor, 1))
    this.floorMat.color.lerp(new THREE.Color(tier.ambiance), 0.03)

    this.run.heroes.forEach((hero, i) => {
      const mesh = this.heroMeshes[i]
      mesh.position.set(hero.x, 0, hero.z)
      const { hpBar, manaBar, mat } = mesh.userData
      const frac = Math.max(hero.hp / hero.maxHp, 0)
      hpBar.scale.x = Math.max(frac, 0.001)
      hpBar.material.color.set(frac > 0.5 ? '#57c46a' : frac > 0.25 ? '#e8b93c' : '#d1584a')
      manaBar.scale.x = Math.max(hero.mana / hero.maxMana, 0.001)
      hpBar.lookAt(camera.position)
      manaBar.lookAt(camera.position)
      if (!hero.alive) {
        mesh.rotation.z = Math.min(mesh.rotation.z + dt * 4, Math.PI / 2)
        mat.transparent = true
        mat.opacity = 0.5
      } else {
        mesh.rotation.z = 0
        mat.opacity = 1
        mesh.position.y = Math.abs(Math.sin(elapsed * 8 + i)) * 0.06
        // Étourdi : la capsule vacille
        if (hero.aff.stun > 0) mesh.rotation.z = Math.sin(elapsed * 30) * 0.15
      }
    })

    const seen = new Set()
    for (const m of this.run.monsters) {
      seen.add(m.id)
      let mesh = this.monsterMeshes.get(m.id)
      if (!mesh) {
        mesh = this.makeMonsterMesh(m)
        this.monsterMeshes.set(m.id, mesh)
        this.group.add(mesh)
      }
      mesh.position.set(m.x, Math.abs(Math.sin(elapsed * 7 + m.id)) * 0.07, m.z)
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

    for (const ev of this.run.events) {
      if (ev.t === 'arrow') this.spawnVfx('arrow', ev.from, ev.to)
      else if (ev.t === 'cast') this.spawnVfx('cast', ev.from, ev.to, { color: ev.color })
      else if (ev.t === 'drain') this.spawnVfx('drain', ev.from, ev.to, { color: '#7a5f9e' })
      else if (ev.t === 'aoe') this.spawnVfx('aoe', ev.at, ev.at, { radius: ev.r, color: ev.color })
      else if (ev.t === 'taunt') this.spawnVfx('taunt', ev.at, ev.at, { radius: ev.r })
      else if (ev.t === 'slam') this.spawnVfx('slam', ev.at, ev.at, { radius: ev.r })
      else if (ev.t === 'heal') this.spawnVfx('heal', ev.to, ev.to)
      else if (ev.t === 'buff') this.spawnVfx('buff', ev.to, ev.to, { color: ev.color })
      else if (ev.t === 'monsterDie') this.spawnVfx('die', ev.at, ev.at)
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
        v.mesh.geometry.dispose()
        v.mesh.material.dispose()
        this.vfx.splice(i, 1)
      }
    }

    for (const f of this.flames) {
      f.scale.y = 1 + Math.sin(elapsed * 9 + f.userData.flicker) * 0.25
    }
  }
}

export { CLASSES }
