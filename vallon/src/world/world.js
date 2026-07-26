import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { mulberry32, fbm2D } from '../core/noise.js'

export const WORLD_SIZE = 150
export const WATER_LEVEL = 0

const COLORS = {
  sable: new THREE.Color('#e3d3a4'),
  herbe: new THREE.Color('#8fba6d'),
  herbeSeche: new THREE.Color('#b9bb70'),
  roche: new THREE.Color('#98917f'),
  tronc: new THREE.Color('#8a5a3b'),
  feuillage: new THREE.Color('#4c8a55'),
  feuillageClair: new THREE.Color('#6ba05e'),
  buisson: new THREE.Color('#57945c'),
  baie: new THREE.Color('#d1584a'),
  eau: new THREE.Color('#4f9ec4'),
  nuage: new THREE.Color('#f7f4ec'),
}

// Le monde : terrain procédural, eau, flore et points d'intérêt pour la simulation.
export class World {
  constructor(seed) {
    this.seed = seed
    this.rng = mulberry32(seed)
    this.group = new THREE.Group()
    this.bushes = []
    this.shorePoints = []
    this.clouds = []

    this.buildTerrain()
    this.buildWater()
    this.buildFlora()
    this.buildClouds()
    this.buildFireflies()
  }

  heightAt(x, z) {
    const s = 0.016
    const n = fbm2D(x * s + 40, z * s + 40, this.seed, 4)
    const r = Math.sqrt(x * x + z * z) / (WORLD_SIZE * 0.52)
    const falloff = 1 - Math.pow(Math.min(r, 1), 2.4)
    return (n * 16 - 4.6) * falloff - 1.2 * Math.pow(Math.min(r, 1), 3)
  }

  groundColor(h, steep) {
    if (h < WATER_LEVEL + 0.9) return COLORS.sable
    if (steep > 0.55 || h > 7.2) return COLORS.roche
    if (h > 4.6) return COLORS.herbeSeche
    return COLORS.herbe
  }

  buildTerrain() {
    const segments = 110
    let geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, segments, segments)
    geo.rotateX(-Math.PI / 2)
    const pos = geo.attributes.position
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, this.heightAt(pos.getX(i), pos.getZ(i)))
    }
    geo = geo.toNonIndexed()
    geo.computeVertexNormals()

    // Couleur par face pour le rendu facetté, avec une légère variation par face.
    const p = geo.attributes.position
    const colors = new Float32Array(p.count * 3)
    const c = new THREE.Color()
    for (let i = 0; i < p.count; i += 3) {
      const h = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3
      const dy =
        Math.max(p.getY(i), p.getY(i + 1), p.getY(i + 2)) -
        Math.min(p.getY(i), p.getY(i + 1), p.getY(i + 2))
      c.copy(this.groundColor(h, dy / 1.6))
      const v = 0.94 + this.rng() * 0.12
      c.r *= v
      c.g *= v
      c.b *= v
      for (let j = 0; j < 3; j++) {
        colors[(i + j) * 3] = c.r
        colors[(i + j) * 3 + 1] = c.g
        colors[(i + j) * 3 + 2] = c.b
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 1,
    })
    this.terrain = new THREE.Mesh(geo, mat)
    this.terrain.receiveShadow = true
    this.group.add(this.terrain)

    // Points de rivage : là où les créatures viennent boire.
    const step = 3
    for (let x = -WORLD_SIZE / 2; x <= WORLD_SIZE / 2; x += step) {
      for (let z = -WORLD_SIZE / 2; z <= WORLD_SIZE / 2; z += step) {
        const h = this.heightAt(x, z)
        if (h > WATER_LEVEL + 0.25 && h < WATER_LEVEL + 0.7) {
          this.shorePoints.push(new THREE.Vector3(x, h, z))
        }
      }
    }
  }

  buildWater() {
    const geo = new THREE.PlaneGeometry(WORLD_SIZE * 1.6, WORLD_SIZE * 1.6, 28, 28)
    geo.rotateX(-Math.PI / 2)
    const mat = new THREE.MeshStandardMaterial({
      color: COLORS.eau,
      flatShading: true,
      transparent: true,
      opacity: 0.82,
      roughness: 0.35,
      metalness: 0.05,
    })
    this.water = new THREE.Mesh(geo, mat)
    this.water.position.y = WATER_LEVEL
    this.waterBase = geo.attributes.position.array.slice()
    this.group.add(this.water)
  }

  randomLandPoint(minH, maxH, tries = 60) {
    for (let i = 0; i < tries; i++) {
      const x = (this.rng() - 0.5) * WORLD_SIZE * 0.92
      const z = (this.rng() - 0.5) * WORLD_SIZE * 0.92
      const h = this.heightAt(x, z)
      if (h > minH && h < maxH) return new THREE.Vector3(x, h, z)
    }
    return null
  }

  buildFlora() {
    const treeGeos = []
    const tmp = new THREE.Object3D()

    const pushColored = (geo, color, obj) => {
      obj.updateMatrix()
      let g = geo.clone().applyMatrix4(obj.matrix)
      if (g.index) g = g.toNonIndexed()
      const count = g.attributes.position.count
      const colors = new Float32Array(count * 3)
      const v = 0.9 + this.rng() * 0.2
      for (let i = 0; i < count; i++) {
        colors[i * 3] = color.r * v
        colors[i * 3 + 1] = color.g * v
        colors[i * 3 + 2] = color.b * v
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      treeGeos.push(g)
    }

    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 1.6, 5)
    const pinGeo = new THREE.ConeGeometry(1.5, 3.4, 6)
    const boule1 = new THREE.IcosahedronGeometry(1.5, 0)
    const rockGeo = new THREE.IcosahedronGeometry(0.8, 0)

    // Arbres
    for (let i = 0; i < 130; i++) {
      const p = this.randomLandPoint(1.4, 6.8)
      if (!p) continue
      const s = 0.75 + this.rng() * 0.8
      const rot = this.rng() * Math.PI * 2
      tmp.position.set(p.x, p.y + 0.75 * s, p.z)
      tmp.scale.setScalar(s)
      tmp.rotation.set(0, rot, 0)
      pushColored(trunkGeo, COLORS.tronc, tmp)
      if (this.rng() < 0.55) {
        tmp.position.set(p.x, p.y + (1.5 + 1.6) * s, p.z)
        pushColored(pinGeo, this.rng() < 0.5 ? COLORS.feuillage : COLORS.feuillageClair, tmp)
      } else {
        tmp.position.set(p.x, p.y + 2.4 * s, p.z)
        pushColored(boule1, this.rng() < 0.5 ? COLORS.feuillage : COLORS.feuillageClair, tmp)
      }
    }

    // Rochers
    for (let i = 0; i < 40; i++) {
      const p = this.randomLandPoint(0.6, 8.5)
      if (!p) continue
      const s = 0.4 + this.rng() * 1.1
      tmp.position.set(p.x, p.y + 0.25 * s, p.z)
      tmp.scale.set(s, s * (0.6 + this.rng() * 0.5), s)
      tmp.rotation.set(0, this.rng() * Math.PI * 2, 0)
      pushColored(rockGeo, COLORS.roche, tmp)
    }

    // Buissons à baies (nourriture des créatures)
    const bushGeo = new THREE.IcosahedronGeometry(0.85, 0)
    const bushCount = 34
    for (let i = 0; i < bushCount; i++) {
      const p = this.randomLandPoint(1.1, 5.2)
      if (!p) continue
      const s = 0.8 + this.rng() * 0.4
      tmp.position.set(p.x, p.y + 0.5 * s, p.z)
      tmp.scale.set(s, s * 0.8, s)
      tmp.rotation.set(0, this.rng() * Math.PI * 2, 0)
      pushColored(bushGeo, COLORS.buisson, tmp)
      this.bushes.push({
        position: new THREE.Vector3(p.x, p.y + 0.5 * s, p.z),
        berries: 3 + Math.floor(this.rng() * 3),
        maxBerries: 5,
        regenTimer: 0,
        scale: s,
      })
    }

    if (treeGeos.length > 0) {
      const merged = mergeGeometries(treeGeos)
      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        flatShading: true,
        roughness: 0.95,
      })
      this.flora = new THREE.Mesh(merged, mat)
      this.flora.castShadow = true
      this.flora.receiveShadow = true
      this.group.add(this.flora)
    }

    // Les baies : un seul InstancedMesh, masquées via une échelle nulle quand mangées.
    const berryGeo = new THREE.IcosahedronGeometry(0.14, 0)
    const berryMat = new THREE.MeshStandardMaterial({ color: COLORS.baie, roughness: 0.6 })
    this.berryMesh = new THREE.InstancedMesh(berryGeo, berryMat, this.bushes.length * 5)
    this.berrySlots = []
    let idx = 0
    for (const bush of this.bushes) {
      bush.slots = []
      for (let j = 0; j < 5; j++) {
        const a = this.rng() * Math.PI * 2
        const b = this.rng() * Math.PI
        const r = 0.78 * bush.scale
        const offset = new THREE.Vector3(
          Math.cos(a) * Math.sin(b) * r,
          Math.abs(Math.cos(b)) * r * 0.7 + 0.1,
          Math.sin(a) * Math.sin(b) * r
        )
        bush.slots.push(idx)
        this.berrySlots.push({ bush, offset })
        idx++
      }
      this.syncBerries(bush)
    }
    this.group.add(this.berryMesh)
  }

  syncBerries(bush) {
    const m = new THREE.Matrix4()
    for (let j = 0; j < bush.slots.length; j++) {
      const slot = bush.slots[j]
      const { offset } = this.berrySlots[slot]
      const visible = j < bush.berries
      m.makeScale(visible ? 1 : 0.0001, visible ? 1 : 0.0001, visible ? 1 : 0.0001)
      m.setPosition(
        bush.position.x + offset.x,
        bush.position.y + offset.y,
        bush.position.z + offset.z
      )
      this.berryMesh.setMatrixAt(slot, m)
    }
    this.berryMesh.instanceMatrix.needsUpdate = true
  }

  buildClouds() {
    const mat = new THREE.MeshStandardMaterial({
      color: COLORS.nuage,
      flatShading: true,
      transparent: true,
      opacity: 0.92,
      roughness: 1,
    })
    for (let i = 0; i < 7; i++) {
      const parts = []
      const n = 3 + Math.floor(this.rng() * 3)
      for (let j = 0; j < n; j++) {
        const g = new THREE.IcosahedronGeometry(1.6 + this.rng() * 1.6, 0)
        g.translate((j - n / 2) * 2.2, (this.rng() - 0.5) * 0.8, (this.rng() - 0.5) * 1.6)
        parts.push(g)
      }
      const cloud = new THREE.Mesh(mergeGeometries(parts), mat)
      cloud.position.set(
        (this.rng() - 0.5) * WORLD_SIZE * 1.3,
        38 + this.rng() * 14,
        (this.rng() - 0.5) * WORLD_SIZE * 1.3
      )
      cloud.userData.speed = 0.4 + this.rng() * 0.5
      this.clouds.push(cloud)
      this.group.add(cloud)
    }
  }

  buildFireflies() {
    const count = 90
    const positions = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const p = this.randomLandPoint(0.8, 6) || new THREE.Vector3(0, 3, 0)
      positions[i * 3] = p.x + (this.rng() - 0.5) * 4
      positions[i * 3 + 1] = p.y + 0.8 + this.rng() * 2.4
      positions[i * 3 + 2] = p.z + (this.rng() - 0.5) * 4
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    this.fireflyBase = positions.slice()
    const mat = new THREE.PointsMaterial({
      color: '#ffe9a3',
      size: 0.35,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    })
    this.fireflies = new THREE.Points(geo, mat)
    this.group.add(this.fireflies)
  }

  nearestBushWithBerries(pos) {
    let best = null
    let bestD = Infinity
    for (const bush of this.bushes) {
      if (bush.berries <= 0) continue
      const d = pos.distanceToSquared(bush.position)
      if (d < bestD) {
        bestD = d
        best = bush
      }
    }
    return best
  }

  nearestShore(pos) {
    let best = null
    let bestD = Infinity
    for (const p of this.shorePoints) {
      const d = pos.distanceToSquared(p)
      if (d < bestD) {
        bestD = d
        best = p
      }
    }
    return best
  }

  // Animation continue du monde : vagues, dérive des nuages, lucioles.
  update(dt, elapsed, nightFactor) {
    const pos = this.water.geometry.attributes.position
    const base = this.waterBase
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3]
      const z = base[i * 3 + 2]
      pos.setY(i, Math.sin(elapsed * 1.2 + x * 0.12 + z * 0.09) * 0.14)
    }
    pos.needsUpdate = true

    for (const cloud of this.clouds) {
      cloud.position.x += cloud.userData.speed * dt
      if (cloud.position.x > WORLD_SIZE * 0.85) cloud.position.x = -WORLD_SIZE * 0.85
    }

    const fPos = this.fireflies.geometry.attributes.position
    const fBase = this.fireflyBase
    for (let i = 0; i < fPos.count; i++) {
      fPos.setX(i, fBase[i * 3] + Math.sin(elapsed * 0.8 + i * 1.7) * 0.9)
      fPos.setY(i, fBase[i * 3 + 1] + Math.sin(elapsed * 1.3 + i * 0.9) * 0.5)
      fPos.setZ(i, fBase[i * 3 + 2] + Math.cos(elapsed * 0.7 + i * 2.3) * 0.9)
    }
    fPos.needsUpdate = true
    this.fireflies.material.opacity = nightFactor * (0.55 + 0.45 * Math.sin(elapsed * 2.1))

    // Repousse des baies
    for (const bush of this.bushes) {
      if (bush.berries < bush.maxBerries) {
        bush.regenTimer += dt
        if (bush.regenTimer > 22) {
          bush.regenTimer = 0
          bush.berries++
          this.syncBerries(bush)
        }
      }
    }
  }

  dispose() {
    this.group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose()
      if (obj.material) obj.material.dispose()
    })
  }
}
