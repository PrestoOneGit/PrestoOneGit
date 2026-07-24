import * as THREE from 'three'
import { ARENA_RADIUS } from '../sim/engine.js'

const SAND = '#dbc394'
const STONE = '#9a8f80'
const STONE_DARK = '#7d7367'

// Vue 3D low poly de l'arène : décor fixe + entités synchronisées sur la
// simulation rejouée dans le fil principal, avec petits effets de combat.
export class Arena3D {
  constructor(scene) {
    this.scene = scene
    this.group = new THREE.Group()
    this.heroMeshes = []
    this.monsterMeshes = new Map()
    this.vfx = []
    this.sim = null
    scene.add(this.group)
    this.buildArena()
  }

  buildArena() {
    const flat = (color, rough = 1) =>
      new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: rough })

    // Sol de sable
    const floor = new THREE.Mesh(
      new THREE.CylinderGeometry(ARENA_RADIUS + 1.5, ARENA_RADIUS + 2.5, 1.2, 28),
      flat(SAND)
    )
    floor.position.y = -0.6
    floor.receiveShadow = true
    this.group.add(floor)

    // Cercle de combat marqué au sol
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(ARENA_RADIUS - 0.6, 0.09, 4, 48),
      new THREE.MeshStandardMaterial({ color: '#b09468', roughness: 1 })
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.02
    this.group.add(ring)

    // Muraille : blocs de pierre irréguliers en couronne
    const segs = 26
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2
      const h = 2.2 + Math.sin(i * 7.3) * 0.5
      const block = new THREE.Mesh(new THREE.BoxGeometry(3.4, h, 1.6), flat(i % 3 ? STONE : STONE_DARK))
      const r = ARENA_RADIUS + 3.4
      block.position.set(Math.cos(a) * r, h / 2 - 0.1, Math.sin(a) * r)
      block.rotation.y = -a
      block.castShadow = true
      block.receiveShadow = true
      this.group.add(block)
    }

    // Quatre piliers avec braseros
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4
      const r = ARENA_RADIUS + 2.2
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.55, 4.4, 6), flat(STONE_DARK))
      pillar.position.set(Math.cos(a) * r, 2.2, Math.sin(a) * r)
      pillar.castShadow = true
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.42, 0.9, 6),
        new THREE.MeshStandardMaterial({
          color: '#ff9a3c',
          emissive: '#ff7a1c',
          emissiveIntensity: 1.6,
          flatShading: true,
        })
      )
      flame.position.set(Math.cos(a) * r, 4.75, Math.sin(a) * r)
      flame.userData.flicker = Math.random() * Math.PI * 2
      this.group.add(pillar, flame)
      this.vfxStatic = this.vfxStatic || []
      this.vfxStatic.push(flame)
    }
  }

  makeHeroMesh(hero) {
    const color = new THREE.Color(hero.cls.color)
    const mat = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85 })
    const g = new THREE.Group()

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.38, 1.0, 6), mat)
    body.position.y = 0.5
    body.castShadow = true
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 6, 5),
      new THREE.MeshStandardMaterial({ color: '#dbb896', flatShading: true, roughness: 0.9 })
    )
    head.position.y = 1.22
    g.add(body, head)

    // Signature visuelle par classe
    if (hero.cls.id === 'guerrier') {
      const sword = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.0, 0.16), new THREE.MeshStandardMaterial({ color: '#c9c9c9', flatShading: true, roughness: 0.4 }))
      sword.position.set(0.42, 0.85, 0)
      const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.08, 6), mat)
      shield.rotation.z = Math.PI / 2
      shield.position.set(-0.42, 0.7, 0)
      g.add(sword, shield)
    } else if (hero.cls.id === 'archere') {
      const bow = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.04, 4, 10, Math.PI), new THREE.MeshStandardMaterial({ color: '#8a5a3b', flatShading: true, roughness: 1 }))
      bow.position.set(0.4, 0.85, 0)
      bow.rotation.y = Math.PI / 2
      g.add(bow)
    } else if (hero.cls.id === 'mage') {
      const hat = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.6, 6), mat)
      hat.position.y = 1.55
      const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.5, 5), new THREE.MeshStandardMaterial({ color: '#8a5a3b', flatShading: true, roughness: 1 }))
      staff.position.set(0.42, 0.8, 0)
      const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 0), new THREE.MeshStandardMaterial({ color: '#7fd4ff', emissive: '#3c9ed4', emissiveIntensity: 1.2, flatShading: true }))
      orb.position.set(0.42, 1.62, 0)
      g.add(hat, staff, orb)
    } else {
      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.04, 4, 10), new THREE.MeshStandardMaterial({ color: '#ffe9a3', emissive: '#e8c96a', emissiveIntensity: 0.9, flatShading: true }))
      halo.rotation.x = Math.PI / 2
      halo.position.y = 1.62
      g.add(halo)
    }

    // Barre de vie
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.09, 0.09),
      new THREE.MeshBasicMaterial({ color: '#57c46a' })
    )
    bar.position.y = 1.95
    g.add(bar)
    g.userData.bar = bar
    g.userData.mat = mat
    return g
  }

  makeMonsterMesh(m) {
    const isBig = m.stats.size > 0.8
    const color = m.type === 'troll' ? '#5a7a4a' : m.type === 'brute' ? '#8f5a4a' : '#6e9e50'
    const mat = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9 })
    const g = new THREE.Group()
    const s = m.stats.size
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55 * (0.8 + s * 0.5), 0), mat)
    body.position.y = 0.5 * s + 0.25
    body.scale.y = 1.15
    body.castShadow = true
    const eyeMat = new THREE.MeshBasicMaterial({ color: '#ffd23c' })
    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.07 * (1 + s * 0.4), 5, 5), eyeMat)
    eyeL.position.set(0.16 * (1 + s), 0.62 * s + 0.3, 0.3 * (1 + s * 0.4))
    const eyeR = eyeL.clone()
    eyeR.position.x *= -1
    g.add(body, eyeL, eyeR)
    if (isBig) {
      const hornMat = new THREE.MeshStandardMaterial({ color: '#e8dcc0', flatShading: true, roughness: 0.7 })
      const hornL = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.4, 4), hornMat)
      hornL.position.set(0.3, 0.95 * s + 0.4, 0)
      hornL.rotation.z = -0.4
      const hornR = hornL.clone()
      hornR.position.x *= -1
      hornR.rotation.z = 0.4
      g.add(hornL, hornR)
    }
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(0.8 * (0.7 + s * 0.5), 0.07, 0.07),
      new THREE.MeshBasicMaterial({ color: '#d1584a' })
    )
    bar.position.y = 1.2 * s + 0.7
    g.add(bar)
    g.userData.bar = bar
    return g
  }

  attach(sim) {
    // Nettoie les entités du match précédent
    for (const m of this.heroMeshes) this.group.remove(m)
    for (const [, m] of this.monsterMeshes) this.group.remove(m)
    for (const v of this.vfx) this.group.remove(v.mesh)
    this.heroMeshes = []
    this.monsterMeshes.clear()
    this.vfx = []
    this.sim = sim
    for (const hero of sim.heroes) {
      const mesh = this.makeHeroMesh(hero)
      this.heroMeshes.push(mesh)
      this.group.add(mesh)
    }
  }

  spawnVfx(kind, from, to) {
    let mesh
    let life = 0.35
    if (kind === 'arrow') {
      mesh = new THREE.Mesh(
        new THREE.ConeGeometry(0.06, 0.5, 4),
        new THREE.MeshBasicMaterial({ color: '#e8dcc0' })
      )
      life = 0.22
    } else if (kind === 'bolt') {
      mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.16, 0),
        new THREE.MeshBasicMaterial({ color: '#7fd4ff' })
      )
      life = 0.25
    } else if (kind === 'heal') {
      mesh = new THREE.Mesh(
        new THREE.TorusGeometry(0.3, 0.05, 4, 12),
        new THREE.MeshBasicMaterial({ color: '#8fe89a', transparent: true })
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
      // slash / bite : petit éclat
      mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.14, 0),
        new THREE.MeshBasicMaterial({ color: kind === 'bite' ? '#d1584a' : '#fff4dd' })
      )
      life = 0.16
    }
    mesh.position.set(from[0], 0.9, from[1])
    this.group.add(mesh)
    this.vfx.push({ mesh, kind, life, maxLife: life, from, to })
  }

  update(dt, elapsed, camera) {
    if (!this.sim) return

    // Héros
    this.sim.heroes.forEach((hero, i) => {
      const mesh = this.heroMeshes[i]
      mesh.position.set(hero.x, 0, hero.z)
      const bar = mesh.userData.bar
      const frac = Math.max(hero.hp / hero.maxHp, 0)
      bar.scale.x = Math.max(frac, 0.001)
      bar.material.color.set(frac > 0.5 ? '#57c46a' : frac > 0.25 ? '#e8b93c' : '#d1584a')
      bar.lookAt(camera.position)
      if (!hero.alive) {
        mesh.rotation.z = Math.min(mesh.rotation.z + dt * 4, Math.PI / 2)
        mesh.userData.mat.transparent = true
        mesh.userData.mat.opacity = 0.5
      } else {
        mesh.rotation.z = 0
        mesh.position.y = Math.abs(Math.sin(elapsed * 8 + i)) * 0.06
      }
    })

    // Monstres : création / synchronisation / suppression
    const seen = new Set()
    for (const m of this.sim.monsters) {
      seen.add(m.id)
      let mesh = this.monsterMeshes.get(m.id)
      if (!mesh) {
        mesh = this.makeMonsterMesh(m)
        this.monsterMeshes.set(m.id, mesh)
        this.group.add(mesh)
      }
      mesh.position.set(m.x, Math.abs(Math.sin(elapsed * 7 + m.id)) * 0.08, m.z)
      const bar = mesh.userData.bar
      bar.scale.x = Math.max(m.hp / m.maxHp, 0.001)
      bar.lookAt(camera.position)
      const target = this.sim.heroes.find((h) => h.alive)
      if (target) mesh.lookAt(target.x, mesh.position.y, target.z)
    }
    for (const [id, mesh] of this.monsterMeshes) {
      if (!seen.has(id)) {
        this.group.remove(mesh)
        this.monsterMeshes.delete(id)
      }
    }

    // Événements du tick → effets
    for (const ev of this.sim.events) {
      if (ev.t === 'arrow' || ev.t === 'bolt') this.spawnVfx(ev.t, ev.from, ev.to)
      else if (ev.t === 'heal') this.spawnVfx('heal', ev.to, ev.to)
      else if (ev.t === 'monsterDie') this.spawnVfx('die', ev.at, ev.at)
      else if (ev.t === 'slash' || ev.t === 'bite') this.spawnVfx(ev.t, ev.to, ev.to)
    }

    // Animation des effets
    for (let i = this.vfx.length - 1; i >= 0; i--) {
      const v = this.vfx[i]
      v.life -= dt
      const p = 1 - v.life / v.maxLife
      if (v.kind === 'arrow' || v.kind === 'bolt') {
        v.mesh.position.set(
          v.from[0] + (v.to[0] - v.from[0]) * p,
          0.9 + Math.sin(p * Math.PI) * 0.4,
          v.from[1] + (v.to[1] - v.from[1]) * p
        )
        if (v.kind === 'arrow') {
          v.mesh.lookAt(v.to[0], 0.9, v.to[1])
          v.mesh.rotateX(Math.PI / 2)
        }
      } else if (v.kind === 'heal') {
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

    // Flammes des braseros
    if (this.vfxStatic) {
      for (const f of this.vfxStatic) {
        f.scale.y = 1 + Math.sin(elapsed * 9 + f.userData.flicker) * 0.25
      }
    }
  }
}
