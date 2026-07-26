import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { mulberry32 } from '../core/noise.js'
import { SITE_STATUS } from '../history/history.js'

const WALL_COLORS = ['#e8dcc0', '#dccdae', '#c9b490', '#b09877']
const ROOF_COLORS = ['#9c4a38', '#7d5a3a', '#6e4a3c', '#8a6242']
const RUIN_COLOR = new THREE.Color('#8f897d')

// Traduit l'état des sites du moteur d'histoire en bâtiments low poly,
// bannières aux couleurs des maisons, ruines, et villageois qui déambulent.
export class Villages {
  constructor(world, history, seed) {
    this.world = world
    this.history = history
    this.rng = mulberry32(seed ^ 0x33cd11f7)
    this.group = new THREE.Group()
    this.villagers = new THREE.Group()
    this.group.add(this.villagers)
    this.siteMeshes = new Map()
    this.rebuildAll()
  }

  houseCountFor(site) {
    if (site.status === SITE_STATUS.RUINE) return 4
    if (site.status === SITE_STATUS.BOURG) return 11
    if (site.status === SITE_STATUS.VILLAGE) return 7
    return 3
  }

  rebuildAll() {
    for (const [, obj] of this.siteMeshes) {
      this.group.remove(obj)
      obj.traverse((o) => {
        if (o.geometry) o.geometry.dispose()
        if (o.material && o.material.dispose) o.material.dispose()
      })
    }
    this.siteMeshes.clear()
    this.villagers.clear()

    for (const site of this.history.sites) {
      const obj = this.buildSite(site)
      this.siteMeshes.set(site.id, obj)
      this.group.add(obj)
      if (site.status !== SITE_STATUS.RUINE) this.spawnVillagers(site)
    }
  }

  colored(geo, colorHex, variance = 0.08) {
    const g = geo.index ? geo.toNonIndexed() : geo
    const count = g.attributes.position.count
    const colors = new Float32Array(count * 3)
    const c = new THREE.Color(colorHex)
    const v = 1 - variance / 2 + this.rng() * variance
    for (let i = 0; i < count; i++) {
      colors[i * 3] = c.r * v
      colors[i * 3 + 1] = c.g * v
      colors[i * 3 + 2] = c.b * v
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return g
  }

  buildSite(site) {
    const container = new THREE.Group()
    const parts = []
    const center = site.position
    const rng = this.rng
    const isRuin = site.status === SITE_STATUS.RUINE
    const n = this.houseCountFor(site)

    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng() * 0.8
      const r = i === 0 ? 0 : 2.6 + rng() * 4.5
      const x = center.x + Math.cos(a) * r
      const z = center.z + Math.sin(a) * r
      const y = this.world.heightAt(x, z)
      if (y < 0.5) continue
      const rot = rng() * Math.PI * 2

      if (isRuin) {
        // Pans de murs effondrés et gravats
        const wall = new THREE.BoxGeometry(1.3, 0.4 + rng() * 0.5, 0.22)
        wall.rotateY(rot)
        wall.translate(x, y + 0.25, z)
        parts.push(this.colored(wall, RUIN_COLOR.getStyle(), 0.15))
        if (rng() < 0.6) {
          const rubble = new THREE.IcosahedronGeometry(0.3 + rng() * 0.25, 0)
          rubble.translate(x + (rng() - 0.5) * 1.4, y + 0.18, z + (rng() - 0.5) * 1.4)
          parts.push(this.colored(rubble, RUIN_COLOR.getStyle(), 0.2))
        }
      } else {
        const w = 1.3 + rng() * 0.5
        const d = 1.1 + rng() * 0.4
        const h = 0.9 + rng() * 0.3
        const body = new THREE.BoxGeometry(w, h, d)
        body.rotateY(rot)
        body.translate(x, y + h / 2, z)
        parts.push(this.colored(body, WALL_COLORS[Math.floor(rng() * WALL_COLORS.length)]))

        // Toit : pyramide à 4 pans aplatie
        const roof = new THREE.ConeGeometry(Math.max(w, d) * 0.82, 0.7 + rng() * 0.25, 4)
        roof.rotateY(rot + Math.PI / 4)
        roof.translate(x, y + h + 0.35, z)
        parts.push(this.colored(roof, ROOF_COLORS[Math.floor(rng() * ROOF_COLORS.length)]))
      }
    }

    if (parts.length > 0) {
      const merged = mergeGeometries(parts)
      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        flatShading: true,
        roughness: 0.95,
      })
      const mesh = new THREE.Mesh(merged, mat)
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.userData.site = site
      container.add(mesh)
    }

    // Bannière de la maison (mât + fanion), sauf sur les ruines
    if (!isRuin) {
      const house = this.history.houseOf(site)
      const y = center.y
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.07, 3.2, 5),
        new THREE.MeshStandardMaterial({ color: '#6b5138', roughness: 1 })
      )
      pole.position.set(center.x + 1.2, y + 1.6, center.z + 1.2)
      const flag = new THREE.Mesh(
        new THREE.PlaneGeometry(1.1, 0.6),
        new THREE.MeshStandardMaterial({
          color: house ? house.color : '#888888',
          side: THREE.DoubleSide,
          roughness: 0.9,
        })
      )
      flag.position.set(center.x + 1.2 + 0.58, y + 2.85, center.z + 1.2)
      pole.userData.site = site
      flag.userData.site = site
      container.add(pole, flag)
      container.userData.flag = flag
    }

    container.userData.site = site
    return container
  }

  spawnVillagers(site) {
    const house = this.history.houseOf(site)
    const tunic = new THREE.Color(house ? house.color : '#777777')
    const count =
      site.status === SITE_STATUS.BOURG ? 5 : site.status === SITE_STATUS.VILLAGE ? 3 : 2

    for (let i = 0; i < count; i++) {
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.22, 0.55, 6),
        new THREE.MeshStandardMaterial({
          color: tunic.clone().offsetHSL(0, -0.08, 0.08 + this.rng() * 0.1),
          flatShading: true,
          roughness: 0.9,
        })
      )
      body.position.y = 0.28
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.14, 6, 5),
        new THREE.MeshStandardMaterial({ color: '#dbb896', flatShading: true, roughness: 0.9 })
      )
      head.position.y = 0.68
      const villager = new THREE.Group()
      villager.add(body, head)
      villager.castShadow = true
      body.castShadow = true

      const a = this.rng() * Math.PI * 2
      const r = 1.5 + this.rng() * 4
      const x = site.position.x + Math.cos(a) * r
      const z = site.position.z + Math.sin(a) * r
      villager.position.set(x, this.world.heightAt(x, z), z)
      villager.userData = {
        site,
        home: site.position,
        target: null,
        pause: this.rng() * 3,
        phase: this.rng() * Math.PI * 2,
      }
      villager.traverse((o) => (o.userData.site = site))
      this.villagers.add(villager)
    }
  }

  update(dt, elapsed, isNight) {
    // La nuit, tout le monde est rentré : les silhouettes disparaissent.
    this.villagers.visible = !isNight
    if (isNight) return

    for (const v of this.villagers.children) {
      const d = v.userData
      if (d.pause > 0) {
        d.pause -= dt
        continue
      }
      if (!d.target) {
        const a = this.rng() * Math.PI * 2
        const r = 1 + this.rng() * 5.5
        const x = d.home.x + Math.cos(a) * r
        const z = d.home.z + Math.sin(a) * r
        if (this.world.heightAt(x, z) < 0.5) continue
        d.target = { x, z }
      }
      const dx = d.target.x - v.position.x
      const dz = d.target.z - v.position.z
      const dist = Math.hypot(dx, dz)
      if (dist < 0.3) {
        d.target = null
        d.pause = 1 + this.rng() * 4
        continue
      }
      const step = Math.min((1.1 * dt) / dist, 1)
      const nx = v.position.x + dx * step
      const nz = v.position.z + dz * step
      v.position.set(nx, this.world.heightAt(nx, nz) + Math.abs(Math.sin(elapsed * 7 + d.phase)) * 0.05, nz)
      v.rotation.y = Math.atan2(dx, dz)
    }
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose()
      if (o.material && o.material.dispose) o.material.dispose()
    })
  }
}
